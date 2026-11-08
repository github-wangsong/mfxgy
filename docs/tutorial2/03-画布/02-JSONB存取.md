# 02 · JSONB 存取（画布）

> 阶段 3 · 第 2 步
>
> 做完：`apps` 表加三列（`graph_json` / `published_graph_json` / `published_at`）；TS 侧 `GraphService` + `GraphController` 提供四个接口；Python 侧用 `JSONB` 映射同一批列并实现同一行为；两端存下的 JSON 形状逐字节一致。
>
> **本篇面试考点**：JSONB vs JSON · 为什么画布不拆成 nodes/edges 两张表 · 草稿与发布快照为什么分两列 · 读取时合成空图 · `JSON.parse(JSON.stringify())` 与 `model_dump(exclude_unset=True)` 的对齐 · `Prisma.InputJsonValue` 断言 · POST 发布为何显式 200。

---

## 1. 决策表

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 存储形态 | 整图一个 `JSONB` 列 | 图是“整体读写”的文档，不需要按节点查询 |
| 草稿 / 发布 | `graph_json` + `published_graph_json` 两列 | 发布是**快照**，之后继续改草稿不能影响线上 |
| 发布时间 | `published_at` 单独一列 | 列表页要展示“什么时候发布的”，不想解析 JSON |
| 可空性 | 三列都 `NULL` | 老数据没有图；`NULL` 表示“从未编辑 / 从未发布” |
| 空图 | 读取时合成，不落库 | 库里保持“没编辑过”的事实，不伪造一行空数据 |
| 校验时机 | PUT / publish | 草稿允许半成品；发布必须完整 |
| 节点表 | 不建 | 拆表会带来顺序、坐标、任意 `data` 的建模成本，收益为零 |

> **面试考点 · JSONB 和 JSON 有什么区别？**
>
> | | `json` | `jsonb` |
> | --- | --- | --- |
> | 存储 | 原始文本 | 解析后的二进制 |
> | 键顺序 | 保留 | 不保留（按规范化顺序） |
> | 重复键 | 保留 | 后者覆盖前者 |
> | 写入速度 | 快（不解析） | 慢（要解析） |
> | 查询 / 索引 | 几乎不能 | 支持 `->`、`@>`、GIN 索引 |
>
> 画布需要“按节点类型筛应用”“按 input 名查”等潜在查询，也可能要建 GIN 索引，所以选 `jsonb`。
> **注意：JSONB 不保留键顺序。** 如果业务依赖“节点在 JSON 里的书写顺序”，必须用数组（`nodes: []`）而不是对象键——本项目的 `nodes` 就是数组，顺序由数组下标保证。

> **面试考点 · 为什么不把 nodes / edges 拆成两张表？**
> 拆表意味着：
>
> - 每次保存要 diff 增删改，写一堆 `upsert` / `deleteMany`；
> - 节点 `data` 是任意结构，要么再拆十几张表，要么留一个 JSON 列（等于没拆）；
> - 读取要 `join` 两次再在应用层组装顺序；
> - 而画布的访问模式是**整图读写**，从来不单独查“第 3 个节点”。
>
> **建模跟着访问模式走。** 整图读写 → 文档存储；需要按字段查询 → 拆列或建 GIN 索引。反过来做就是过度设计。

> **面试考点 · 草稿和发布快照为什么必须是两份数据？**
> 用户正在编辑草稿（可能只画了一半），线上运行的应用必须继续用上一版可用的图。如果只有一份：
>
> - 保存草稿的瞬间，线上行为就变了；
> - 草稿校验不过时，线上直接挂掉。
>
> 发布 = `publishedGraphJson = graphJson` 的**值拷贝**（数据库里是两份独立 JSON），之后改草稿不影响快照。这也是阶段 10 对外 API 只跑 `published_graph_json` 的原因。

---

## 2. 迁移

```powershell
pnpm --filter @mini-dify/api-ts db:migrate --name add_app_graph
```

**完整文件路径：`apps/api-ts/prisma/migrations/20261018124928_add_app_graph/migration.sql`**

```sql
-- AlterTable
ALTER TABLE "apps" ADD COLUMN     "graph_json" JSONB,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_graph_json" JSONB;
```

三列都可空，所以对已有数据安全：老应用就是“没画过图、没发布过”。

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**（`App` 的增量片段）

```prisma
model App {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  description String?
  mode        String   @default("chatflow")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")

  // 画布（阶段 3）：草稿图与已发布快照。
  // graphJson 为 null 表示「尚未编辑」；读取时返回合法空图 {"version":"1","nodes":[],"edges":[]}。
  // publishedAt 为 null 表示「从未发布过」（此时 GET .../graph/published 返回 404）。
  graphJson          Json?     @map("graph_json")
  publishedGraphJson Json?     @map("published_graph_json")
  publishedAt        DateTime? @map("published_at")

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId])
  @@map("apps")
}
```

---

## 3. TS 侧：Service

**完整文件路径：`apps/api-ts/src/graph/graph.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Graph, PublishGraphResponse } from '@mini-dify/contract'
import { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { validateGraph } from './graph.validator'

/** 草稿为 null（从未编辑）时对外返回的合法空图。 */
const EMPTY_GRAPH: Graph = { version: '1', nodes: [], edges: [] }

/**
 * 画布（Graph）读写。
 *
 * 「图 = 数据」：后端只负责**存取与校验**，把这段 JSON 原样保存；
 * 执行引擎（阶段 4）再把 `Graph` 编译成可执行的图。
 *
 * 归属校验与 `/apps` 一致：查不到、或不属于当前用户，一律 404。
 */
@Injectable()
export class GraphService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /apps/{id}/graph：草稿为 null 时返回合法空图（读取不校验）。 */
  async getDraft(ownerId: string, id: string): Promise<Graph> {
    return this.draftOf(await this.findOwned(ownerId, id))
  }

  /** PUT /apps/{id}/graph：校验草稿后原样保存，返回保存后的草稿。 */
  async saveDraft(ownerId: string, id: string, graph: Graph): Promise<Graph> {
    await this.findOwned(ownerId, id)
    this.assertValid(graph)
    const app = await this.prisma.app.update({
      where: { id },
      // Prisma 的 Json 字段要求 InputJsonValue；契约类型是 interface，需要一次断言
      data: { graphJson: graph as unknown as Prisma.InputJsonValue },
    })
    return this.draftOf(app)
  }

  /** POST /apps/{id}/graph/publish：校验**当前草稿**，通过后快照为已发布图。 */
  async publish(ownerId: string, id: string): Promise<PublishGraphResponse> {
    const app = await this.findOwned(ownerId, id)
    // 注意：发布校验的是「库里的草稿」，不是请求体（发布接口没有 body）
    const draft = this.draftOf(app)
    this.assertValid(draft)
    const updated = await this.prisma.app.update({
      where: { id },
      data: {
        // 值拷贝：草稿之后再改，不会影响快照
        publishedGraphJson: draft as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
    })
    return {
      // 断言非空：上面刚写入 publishedAt
      publishedAt: (updated.publishedAt as Date).toISOString(),
      graph: this.publishedOf(updated),
    }
  }

  /** GET /apps/{id}/graph/published：从未发布过时 404 `Graph not published`。 */
  async getPublished(ownerId: string, id: string): Promise<Graph> {
    const app = await this.findOwned(ownerId, id)
    if (app.publishedGraphJson === null) {
      throw new NotFoundException('Graph not published')
    }
    return this.publishedOf(app)
  }

  /** 语义校验；多个错误用 "; " 拼接成单一 message（与 Python 一致）。 */
  private assertValid(graph: Graph): void {
    const errors = validateGraph(graph)
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
  }

  private async findOwned(ownerId: string, id: string) {
    const app = await this.prisma.app.findUnique({ where: { id } })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
    return app
  }

  /**
   * 草稿对外视图：`graphJson` 为 null（从未编辑）时返回合法空图。
   * 注意该空图**不通过**校验规则 3/4，但读取时正常返回，只有 PUT / publish 才校验。
   */
  private draftOf(app: { graphJson: Prisma.JsonValue | null }): Graph {
    return app.graphJson === null ? EMPTY_GRAPH : (app.graphJson as unknown as Graph)
  }

  private publishedOf(app: { publishedGraphJson: Prisma.JsonValue }): Graph {
    return app.publishedGraphJson as unknown as Graph
  }
}
```

> **面试考点 · 为什么 `publish` 校验的是“库里的草稿”而不是请求体？**
> 发布接口**没有请求体**——它发布的是已经保存的草稿。如果允许带 body，就会产生“发布的图和保存的图不一致”的歧义：用户以为发布的是刚保存的版本，实际发布的是前端临时拼的版本。
> **发布是“把草稿提升为线上”的动作，不是“再提交一次图”。**

> **面试考点 · `as unknown as Prisma.InputJsonValue` 是什么？为什么不是 `as any`？**
> Prisma 的 `Json` 字段只接受 `InputJsonValue`（`string | number | boolean | null | InputJsonObject | InputJsonArray`）。契约的 `Graph` 是 `interface`，TS 不认为它“可索引”成 JSON 值，所以要断言。
> 用 `as unknown as` 而不是 `as any`：
>
> - `any` 会关闭后续所有类型检查，错到 `InputJsonValue` 之外也发现不了；
> - `as unknown as X` 是“明确承认这次转换不安全”，但转换后的类型仍然受约束。
>
> 这类断言应该**集中在持久化边界**，且旁边必须有一句注释说明为什么安全（这里：`Graph` 的全部字段都是 JSON 可序列化类型）。

> **面试考点 · `EMPTY_GRAPH` 是常量，返回给多个请求会不会被改坏？**
> 这个对象只被读取并序列化成 JSON 响应，Nest 不会原地修改它。但**共享可变对象永远是隐患**：万一将来有人写了 `graph.nodes.push(...)`，就会污染所有后续请求。
> 更稳的写法是每次返回 `{ version: '1', nodes: [], edges: [] }` 或 `structuredClone(EMPTY_GRAPH)`。本项目选择了共享常量，因为当前没有任何修改路径——**知道风险在哪，再决定省不省这次分配。**

---

## 4. TS 侧：Controller 与模块

**完整文件路径：`apps/api-ts/src/graph/graph.controller.ts`**

```ts
import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common'
import type { Graph, PublishGraphResponse } from '@mini-dify/contract'

import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard'
import { GraphDto } from './dto/graph.dto'
import { GraphService } from './graph.service'

/** 契约见 packages/contract/openapi.yaml 的 `/apps/{id}/graph*`。 */
@Controller('apps')
@UseGuards(JwtAuthGuard)
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get(':id/graph')
  getDraft(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<Graph> {
    return this.graphService.getDraft(payload.sub, id)
  }

  @Put(':id/graph')
  saveDraft(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() body: GraphDto,
  ): Promise<Graph> {
    return this.graphService.saveDraft(payload.sub, id, toPlainGraph(body))
  }

  @Post(':id/graph/publish')
  // POST 默认 201；契约规定发布是 200
  @HttpCode(200)
  publish(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<PublishGraphResponse> {
    return this.graphService.publish(payload.sub, id)
  }

  @Get(':id/graph/published')
  getPublished(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<Graph> {
    return this.graphService.getPublished(payload.sub, id)
  }
}

/**
 * DTO 实例（class-transformer）→ 普通对象，供 Prisma `Json` 原样落库。
 * 序列化会丢弃值为 `undefined` 的可选句柄字段，保证「存下的形状 = 请求体的形状」。
 */
function toPlainGraph(body: GraphDto): Graph {
  return JSON.parse(JSON.stringify(body)) as Graph
}
```

**完整文件路径：`apps/api-ts/src/graph/graph.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { GraphController } from './graph.controller'
import { GraphService } from './graph.service'

/**
 * 画布模块（阶段 3）。`PrismaService` 来自全局 `PrismaModule`，
 * `JwtAuthGuard` 由 `AuthModule` 提供并导出，均无需在此声明。
 */
@Module({
  imports: [AuthModule],
  controllers: [GraphController],
  providers: [GraphService],
})
export class GraphModule {}
```

**完整文件路径：`apps/api-ts/src/app.module.ts`** 的 `imports` 追加：

```ts
imports: [PrismaModule, AuthModule, AppsModule, GraphModule],
```

> **面试考点 · `JSON.parse(JSON.stringify(body))` 到底在做什么？**
> `body` 是 `GraphDto` 的**类实例**，`position` 是 `NodePositionDto` 实例，`sourceHandle` 可能存在但值为 `undefined`。
> 直接 `prisma.app.update({ data: { graphJson: body } })` 会有两个问题：
>
> 1. 类实例带原型，Prisma 序列化时行为不确定；
> 2. `JSON.stringify` 会丢掉 `undefined` 的键——这正是我们想要的：请求里没写 `sourceHandle`，库里就**没有这个键**，而不是 `"sourceHandle": null`。
>
> 所以这行不是“脱裤子放屁”，而是**把类实例归一化成纯 JSON 形状**。`structuredClone` 做不到丢 `undefined`，`JSON.parse(JSON.stringify())` 才可以。

---

## 5. Python 侧：JSONB 映射

**完整文件路径：`apps/api-py/app/models/app.py`**（阶段 3 的增量片段）

```python
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class App(Base):
    __tablename__ = "apps"

    # ...阶段 2 的 id / owner_id / name / description / mode / created_at / updated_at...

    # 画布（阶段 3）。DDL 由 TS 侧 Prisma 拥有（迁移 add_app_graph），此处只映射。
    # 列在 PG 上为 jsonb；graph_json 为 NULL 表示「尚未编辑」，读取时返回合法空图。
    graph_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    published_graph_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # 物理列是 `timestamp(3)`（无时区，由 Prisma `DateTime?` 生成），故用 naive `DateTime()`
    # 与之对齐；写入时按 UTC 取值（见 `app/timefmt.py` 的 `iso_z()`，它按 UTC 处理 naive 值）。
    published_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    owner: Mapped["User"] = relationship("User", back_populates="apps")
```

> **面试考点 · 为什么用 `JSONB` 而不是 `JSON`？**
> SQLAlchemy 的 `sqlalchemy.JSON` 是一个跨数据库的通用类型：在 PG 上它默认映射 `json`（不是 `jsonb`），在 MySQL 上映射 `JSON`。
> 我们的列是 Prisma 建的 `jsonb`，Python 如果映射成 `JSON`，SQLAlchemy 读的时候会因为类型不匹配（`json` vs `jsonb`）在比较/查询上出问题，`create_all` 场景下甚至会生成不同的 DDL。
> **列是什么类型，映射就写什么类型。** 用 `from sqlalchemy.dialects.postgresql import JSONB` 精确对应。

> **面试考点 · `published_at` 为什么是 naive `DateTime`？**
> Prisma 的 `DateTime` 在 PostgreSQL 上生成 `timestamp(3)`（**without time zone**），不是 `timestamptz`。
> 如果 Python 用 `DateTime(timezone=True)` 映射，SQLAlchemy 会以为列带时区，读出来是 aware datetime，写进去可能带偏移量——与 Prisma 的 naive 值混在一起，比较和序列化都会出问题。
> 本项目的约定：**库里一律存 UTC 的 naive 时间**，序列化时按 UTC 解释并加 `Z`（`iso_z()`）。类型必须与物理列一致，约定才有意义。

---

## 6. Python 侧：路由

**完整文件路径：`apps/api-py/app/api/graph.py`**

```python
"""`/apps/{id}/graph*` 路由 —— 契约见 packages/contract/openapi.yaml。

行为与 api-ts 的 `GraphController` / `GraphService` 保持一致：
- 归属校验复用 `app.api.apps._find_owned`（查不到 / 非本人一律 404 `App not found`）；
- 语义校验用纯函数 `app.graph.validator.validate_graph`，文案与 api-ts 逐条对齐；
- 草稿为 NULL（从未编辑）时，GET 返回合法空图（读取不校验，只有 PUT / publish 校验）。
"""

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.apps import _find_owned
from app.api.deps import get_current_user, get_db
from app.graph.validator import validate_graph
from app.models.app import App
from app.models.user import User
from app.timefmt import iso_z

router = APIRouter(prefix="/apps", tags=["apps"])

# 草稿为 NULL（从未编辑）时对外返回的合法空图
_EMPTY_GRAPH: dict[str, Any] = {"version": "1", "nodes": [], "edges": []}


class NodePosition(BaseModel):
    """对应契约 `NodePosition`。"""

    model_config = ConfigDict(extra="forbid")

    # JSON number：int 与 float 都接受，且保持原样（避免 1 → 1.0 的漂移）
    x: int | float
    y: int | float


class GraphNode(BaseModel):
    """对应契约 `GraphNode`。`data` 为节点各自的配置（自由结构）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["start", "end", "llm", "knowledge", "condition", "aggregator", "iteration"]
    position: NodePosition
    data: dict[str, Any]


class GraphEdge(BaseModel):
    """对应契约 `GraphEdge`（句柄字段可选，可为 null）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    source: str
    target: str
    sourceHandle: str | None = None
    targetHandle: str | None = None


class Graph(BaseModel):
    """对应契约 `Graph`（PUT 请求体）。"""

    model_config = ConfigDict(extra="forbid")

    version: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]


def _draft_of(app: App) -> dict[str, Any]:
    # 草稿为 NULL 表示尚未编辑：返回合法空图（注意它不通过校验规则 3/4，但读取正常返回）
    return _EMPTY_GRAPH if app.graph_json is None else app.graph_json


def _assert_valid(graph: dict[str, Any]) -> None:
    errors = validate_graph(graph)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors)
        )


@router.get("/{id}/graph", operation_id="getGraph")
def get_graph(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _draft_of(_find_owned(db, current_user.id, id))


@router.put("/{id}/graph", operation_id="saveGraph")
def save_graph(
    id: str,
    body: Graph,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    app = _find_owned(db, current_user.id, id)
    # 先落成普通 dict（camelCase 键名原样保留），再校验、再落库
    graph = body.model_dump(exclude_unset=True)
    _assert_valid(graph)
    app.graph_json = graph
    db.commit()
    db.refresh(app)
    return _draft_of(app)


@router.post("/{id}/graph/publish", operation_id="publishGraph")
def publish_graph(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    app = _find_owned(db, current_user.id, id)
    draft = _draft_of(app)
    _assert_valid(draft)
    app.published_graph_json = draft
    # 列在 PG 上为 timestamp（无时区）；写 naive-UTC，读取时 iso_z 按 UTC 解释
    app.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(app)
    return {"publishedAt": iso_z(app.published_at), "graph": app.published_graph_json}


@router.get("/{id}/graph/published", operation_id="getPublishedGraph")
def get_published_graph(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    app = _find_owned(db, current_user.id, id)
    if app.published_graph_json is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph not published")
    return app.published_graph_json
```

`main.py` 追加：

```python
from app.api.graph import router as graph_router

# ...

app.include_router(graph_router)
```

> **面试考点 · `model_dump(exclude_unset=True)` 在这里解决什么？**
> 对应 TS 侧的 `JSON.parse(JSON.stringify(body))`：
>
> - 请求里没写 `sourceHandle` → Pydantic 用默认值 `None`，但 `model_fields_set` 里没有它；
> - `exclude_unset=True` 把它排除 → 存进 JSONB 的对象**没有这个键**；
> - 如果不加，存进去的是 `"sourceHandle": null`。
>
> 两者都符合契约（`["string", "null"]`），但“存下的形状 = 请求体的形状”是更严格、也更容易跨语言比对的目标。
> **契约允许的，不等于你该随便选一种。** 两套后端必须选同一种。

> **面试考点 · 为什么这些路由不写 `response_model`？**
> 因为响应要**原样返回库里的 JSON**：
>
> - 用 `response_model=Graph` 会经过一次 Pydantic 重新校验与再序列化；
> - `NodePosition` 的 `x: int | float` 在再序列化时可能把 `1` 变成 `1.0`（或反之），导致两套后端的字节不一致；
> - 节点 `data` 是自由结构，模型化收益为零。
>
> 代价是失去了响应结构校验。这里用契约测试来补：测试直接比对返回的 JSON 与契约结构。
> **要么让框架校验，要么让测试校验，不能两边都不校验。**

---

## 7. 验证

```powershell
pnpm --filter @mini-dify/api-ts db:migrate
pnpm --filter @mini-dify/api-ts db:generate
```

```powershell
# 1. 三列存在且可空
docker exec -it mini-dify-db psql -U postgres -d minidify -c "\d apps"
```

预期新增：

```text
 graph_json           | jsonb                          |          |
 published_graph_json | jsonb                          |          |
 published_at        | timestamp(3) without time zone |          |
```

```powershell
# 2. 空应用读取草稿 → 合法空图，而不是 null
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.accessToken)" }
$app = Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ name = 'canvas-test' } | ConvertTo-Json)

Invoke-RestMethod -Uri "http://localhost:3001/apps/$($app.id)/graph" -Headers $h | ConvertTo-Json -Depth 5
```

预期：

```json
{ "version": "1", "nodes": [], "edges": [] }
```

```powershell
# 3. 保存一份合法草稿（start → end，边不写 sourceHandle）
$graph = @{
  version = '1'
  nodes = @(
    @{ id = 's'; type = 'start'; position = @{ x = 0; y = 0 }; data = @{ inputs = @() } },
    @{ id = 'e'; type = 'end';   position = @{ x = 320; y = 0 }; data = @{ outputs = @() } }
  )
  edges = @(
    @{ id = 'e1'; source = 's'; target = 'e' }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Put -Uri "http://localhost:3001/apps/$($app.id)/graph" `
  -Headers $h -ContentType 'application/json' -Body $graph | ConvertTo-Json -Depth 10
```

```powershell
# 4. 从未发布 → 404 Graph not published
try {
  Invoke-RestMethod -Uri "http://localhost:3001/apps/$($app.id)/graph/published" -Headers $h
} catch { $_.ErrorDetails.Message }
```

```powershell
# 5. 发布 → 200 { publishedAt, graph }
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/$($app.id)/graph/publish" -Headers $h | ConvertTo-Json -Depth 10
```

```powershell
# 6. 改草稿后，已发布快照不变
Invoke-RestMethod -Method Put -Uri "http://localhost:3001/apps/$($app.id)/graph" `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ version='1'; nodes=@(@{ id='s'; type='start'; position=@{x=0;y=0}; data=@{} }); edges=@() } | ConvertTo-Json -Depth 10) | Out-Null

Invoke-RestMethod -Uri "http://localhost:3001/apps/$($app.id)/graph/published" -Headers $h | ConvertTo-Json -Depth 10
```

预期仍是两份节点（`start` + `end`），不是刚存的一份。

```powershell
# 7. 空图/非法图保存 → 400，多条错误用 "; " 拼接
try {
  Invoke-RestMethod -Method Put -Uri "http://localhost:3001/apps/$($app.id)/graph" `
    -Headers $h -ContentType 'application/json' `
    -Body (@{ version='2'; nodes=@(); edges=@() } | ConvertTo-Json) 
} catch { $_.ErrorDetails.Message }
```

预期：

```json
{"statusCode":400,"message":"graph version must be 1; graph must contain exactly one start node; graph must contain at least one end node","error":"Bad Request"}
```

```powershell
# 8. JSONB 里到底存了什么（键名、缺省键）
docker exec -it mini-dify-db psql -U postgres -d minidify -c "SELECT jsonb_pretty(graph_json) FROM apps WHERE id = '$($app.id)';"
```

重点看边对象：**没有 `sourceHandle` 这个键**（不是 `"sourceHandle": null`）。

```powershell
# 9. 跨后端：用 api-py 读同一份草稿，再发布
$py = Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json)
$pyh = @{ Authorization = "Bearer $($py.accessToken)" }

Invoke-RestMethod -Uri "http://localhost:8000/apps/$($app.id)/graph" -Headers $pyh | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/apps/$($app.id)/graph/publish" -Headers $pyh | ConvertTo-Json -Depth 10
```

```powershell
# 10. 清理
curl.exe -i -X DELETE "http://localhost:3001/apps/$($app.id)" -H "Authorization: Bearer $($login.accessToken)"
```

---

## 8. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| JSONB vs JSON | jsonb 解析存储、可索引、不保留键序；json 保留原始文本、写入快 |
| 画布为什么用一个 JSON 列 | 整图读写，不需要按节点查询；拆表只会带来 diff 与 join 成本 |
| 草稿 / 发布为什么分两列 | 发布是快照，编辑草稿不能影响线上行为 |
| `graphJson` 为什么可空 | “从未编辑”是真实状态，不能伪造一行空图数据 |
| 空图为什么读时合成 | 读宽容、写严格；空图不满足规则 3/4，但用户要能打开画布 |
| 两端 JSON 形状怎么对齐 | TS 用 `JSON.parse(JSON.stringify())` 丢 `undefined`；Python 用 `exclude_unset=True` 丢未设置字段 |
| 为什么 `published_at` 是 naive | Prisma 生成 `timestamp(3)`，与 `timestamptz` 混用会错位 |
| 什么时候该给 JSONB 建 GIN 索引 | 当出现 `WHERE graph_json @> ...` 这类按内容查询时；现在没有，就不建 |

---

## 9. 下一步

- `03-ReactFlow画布.md`：`@xyflow/react` 画布、节点面板、连线校验、保存与发布、未保存提示。
