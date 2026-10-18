# 03 · NestJS 图模块

> 所属：阶段 3 · 画布
> 本篇覆盖：`apps/api-ts` 的 `/apps/{id}/graph` 与 `/apps/{id}/graph/publish`、`/apps/{id}/graph/published` —— 画布（Graph）草稿的**读取 / 保存**、**发布快照**，以及支撑它们的控制器、服务、DTO、**纯函数校验器**与**校验错误收集器的一次改动**
> **本篇首次教学**：
> - **嵌套路由**：把 `/apps/{id}/graph` 拆成**独立模块**（`GraphModule` + `GraphController`），讲为什么按资源再拆一个模块，而不是继续堆在 `AppsController`
> - **「业务规则校验」与「结构校验」的分层**：结构交给 `class-validator` + `ValidationPipe`；业务规则交给**纯函数** `validateGraph(graph): string[]`，并讲清**为什么业务规则不写成自定义校验装饰器**
> - **嵌套 DTO + `@ValidateNested({ each: true })` + `@Type(() => ...)`**：`@Body()` 接收复杂对象，讲 `class-transformer` 的必要性
> - **`ValidationPipe.exceptionFactory` 对 `ValidationError.children` 的递归收集**：`validation-exception-factory.ts` 本轮新增递归（画布错误藏在 `children` 里），讲改动前后与原因
> - **`null` 与「空图」语义**：草稿为 `null` 时 `GET` 返回合法空图，以及「读取不校验、写入才校验」的分工
>
> **不再重讲**（只引用）：
> - TypeScript 装饰器 / 依赖注入 / NestJS 模块系统 / `NestFactory` 启动 / CORS → `00-项目初始化/05-NestJS起步.md`
> - 契约类型与「TS 类型运行期被擦除」→ `00-项目初始化/04-契约包与TypeScript类型.md`
> - DTO 与 `class-validator`、`ValidationPipe`（`whitelist` / `forbidNonWhitelisted` / `transform`）→ `01-账号与认证/03-NestJS认证.md`
> - Guard / `CanActivate` / `@UseGuards`、`@CurrentUser`（`createParamDecorator`）、异常过滤器（`@Catch` / `ArgumentsHost`）→ `01-账号与认证/03-NestJS认证.md`
> - Prisma（`PrismaService` / `migrate` / `Json` 列）、`NotFoundException` → `01-账号与认证/02-Prisma.md`
> - **资源归属（ownership）与「404 而非 403」**、模块复用与 DI 边界（`exports` / `imports` / `global: true`）、实体出参映射 → `02-应用管理/03-NestJS应用模块.md`
> - 错误信封与错误文案真源 `packages/contract/error-messages.md` → `02-应用管理/07-验收.md`
>
> **与任务描述的一处出入（按源码为准）**：任务简述里写的是 `@Controller('apps/:id/graph')`，但**源码实际用的是 `@Controller('apps')` + 方法路径 `':id/graph'` 等**。本篇按源码逐字写，并在 §6 说明这两种写法为何等价、源码为何选后者。

---

## 1. 本篇目标

做完本篇，`apps/api-ts` 应能对外提供契约 `openapi.yaml` 定义的 `/apps/{id}/graph*` 三组接口，行为与契约、与 FastAPI 侧**逐字节一致**。

**验收标准（均为本地实测结果）**

| 场景 | 请求 | 状态码 | 响应体要点 |
| --- | --- | --- | --- |
| 读取未编辑的草稿 | `GET /apps/{id}/graph`（带 token，本人） | **200** | `{"version":"1","nodes":[],"edges":[]}`（合法空图） |
| 保存草稿 | `PUT /apps/{id}/graph`（start/end/llm 三节点 + 两条边） | **200** | 返回保存后的草稿；随后 `GET` 与请求体**逐字段一致**（`sourceHandle:"out"` 与 `sourceHandle:null` 都被保留） |
| 发布 | `POST /apps/{id}/graph/publish` | **200** | `PublishGraphResponse`：`publishedAt` 形如 `2026-10-18T13:40:03.893Z`，`graph` 为快照 |
| 读已发布图 | `GET /apps/{id}/graph/published`（已发布过） | **200** | `Graph` |
| 读未发布图 | `GET /apps/{id}/graph/published`（从未发布） | **404** | `{"statusCode":404,"message":"Graph not published","error":"Not Found"}` |
| 缺 token | 任一 `/apps/{id}/graph*` 无 Authorization 头 | **401** | `{statusCode:401, message:"Missing bearer token", error:"Unauthorized"}` |
| **归属验证** | 用户 B 读用户 A 的图 | **404** | `{"statusCode":404,"message":"App not found","error":"Not Found"}` |
| 语义校验（7 组） | `PUT` 违反规则 | **400** | 形状 `{"statusCode":400,"message":"...","error":"Bad Request"}`，`message` 见 §7.3 |
| 结构校验（多组） | `PUT` 字段类型/必填/枚举/额外字段违规 | **400** | 同为上述 400 形状，文案如 `position is required`、`type must be one of: start, end, llm` |
| **跨后端一致性** | api-py `PUT` 的图，api-ts `GET` | **200** | 两端读到**同一份**图，逐字段一致 |

关键点三条：

1. **三层防护**：`JwtAuthGuard`（鉴权）+ `ValidationPipe`（结构）+ `validateGraph`（业务规则）。
2. **读取不校验、写入才校验**：草稿为 `null` 的读取豁免，`PUT` / `publish` 才跑语义校验（见 §10）。
3. **归属失败一律 404**（沿用阶段 2 惯例，见 §7.3 引用）。

## 2. 前置条件

- 阶段 0 的 **Step 05（NestJS 起步）** 已完成：会写 `@Module` / `@Controller` / `@Injectable`，懂构造函数注入。
- 阶段 1 的 **03（NestJS 认证）** 已完成：`JwtAuthGuard` / `@CurrentUser` / 全局 `ValidationPipe` / 全局 `HttpErrorFilter` 均已就位。
- 阶段 1 的 **02（Prisma）** 已完成：`PrismaService` 可用。
- 阶段 2 的 **01 / 03** 已完成：契约 `AppResponse` 等、`AppsModule`、`findOwned` 惯例、模块复用边界（`AuthModule` `exports` `JwtAuthGuard`）均已具备。
- 阶段 3 的 **01（契约扩展）** 已完成：契约里有 `Graph` / `NodePosition` / `GraphNode` / `GraphEdge` / `PublishGraphResponse`，以及 `/apps/{id}/graph*` 三条 `path`。
- 本地 PostgreSQL 容器已启动（`docker compose up -d`）；`apps/api-ts/.env` 的 `DATABASE_URL` 指向本地库，且 `apps` 表已加 `graph_json` / `published_graph_json` / `published_at` 三列（见 §5.8 迁移）。

> 若 `apps` 表缺这三列，`PUT` 会报 500（见 §12 常见坑）。

---

## 3. 先看清要做什么

阶段 3 在阶段 2「应用 CRUD」之上，加一条「**画布 JSON 存取**」链路。它比 CRUD 多了一道**业务规则校验**：

```
                 请求进入 Nest 应用
                         │
      ┌──────────────────┼───────────────────────────────────┐
      │ 1) Guard  JwtAuthGuard（贴在控制器类上）              │
      │    验 Bearer <jwt> → 写 request.user                 │
      ├──────────────────────────────────────────────────────┤
      │ 2) Pipe   ValidationPipe（仅 PUT 有 @Body）          │
      │    GraphDto 的 class-validator 装饰器校验「结构」      │
      │    → 非法抛 400（validationExceptionFactory 组装文案） │
      ├──────────────────────────────────────────────────────┤
      │ 3) Controller  GraphController                       │
      │    @CurrentUser() 取 ownerId；@Param('id') 取应用 id   │
      │    @Body() body: GraphDto（复杂嵌套对象）              │
      ├──────────────────────────────────────────────────────┤
      │ 4) Service  GraphService                             │
      │    findOwned(ownerId, id)：查不到 / 非本人 → 404        │
      │    assertValid(graph)：validateGraph 业务规则 → 400     │
      │    getDraft / saveDraft / publish / getPublished      │
      │     草稿为 null → 返回合法空图 EMPTY_GRAPH             │
      │     Prisma Json 列原样落库                             │
      └──────────────────────────────────────────────────────┘
                         │
              ┌──────────┴───────────┐
              │ 成功：Graph JSON       │
              │ 失败：HttpException    │
              │  → HttpErrorFilter 归一 │
              └──────────────────────┘
```

一句话概括：

1. **入参**：`@CurrentUser()` 拿「我是谁」，`@Param('id')` 拿「操作哪个应用」，`@Body()` + `GraphDto` 保证「结构合规」。
2. **归属**：`GET` / `PUT` / `publish` / `published` 四条**都先过 `findOwned`**，不满足即 404。
3. **两层校验**：结构（DTO）与业务规则（纯函数 `validateGraph`）**分开**——这是本篇的重点（§7）。

---

## 4. 命令清单（逐条说明）

> 除「实测接口」外，其余命令均在**仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm --filter @mini-dify/api-ts db:migrate` | 仓库根 | 应用 Prisma 迁移（新增 `graph_json` / `published_graph_json` / `published_at` 三列） | 若已是最新会提示 `Already in sync` |
| `pnpm dev:api-ts` | 仓库根 | 先编译契约，再以 watch 模式启动 NestJS（`:3001`） | 末尾打印 `api-ts listening on http://localhost:3001` |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 用 `nest build` 编译到 `dist` | 产出 `apps/api-ts/dist/main.js` 等 |
| 画布四组请求 | 任意目录 | 验证 `GET` / `PUT` / `publish` / `published` 与错误 | 见 §11 |

> 「在哪执行」的缘由（`dotenv` 从当前工作目录读 `.env`、`apps/api-ts/.env` 自包含连接串）见 `01-账号与认证/03-NestJS认证.md` §4，此处不重讲。

---

## 5. 完整代码

> 以下文件均为 `apps/api-ts` 侧当前**完整内容**（逐字照抄）。

### 5.1 画布模块（graph.module.ts）

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

**说明**：与 `AppsModule` **完全同构**——`providers` 只有本模块自己的 `GraphService`；`PrismaService` 走全局 `PrismaModule`、`JwtAuthGuard` 走 `AuthModule` 的 `exports`（配 `imports: [AuthModule]` 引入）。这套「一处注册 + 导出复用」的边界模式已在 `02-应用管理/03-NestJS应用模块.md` §8 讲透，这里**只是复用同一模式**，不重讲。

### 5.2 画布控制器（graph.controller.ts）

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

**几处对照契约的细节**：

- `@Controller('apps')`：路由前缀 `/apps`；四条方法再拼上 `:id/graph` / `:id/graph/publish` / `:id/graph/published`。**注意**：这与「直接写 `@Controller('apps/:id/graph')`」是两种等价表达，见 §6。
- `@UseGuards(JwtAuthGuard)` **贴在类上**：整个控制器四条路由全部要登录（阶段 2 同款用法，见 `02-应用管理/03-NestJS应用模块.md` §9）。
- **`@Put(':id/graph')` 没写 `@HttpCode`**：NestJS 中 `@Put` 默认就是 **200**，与契约 `saveGraph` 一致。
- **`@Post(':id/graph/publish')` 写了 `@HttpCode(200)`**：`@Post` 默认 **201**，而契约 `publishGraph` 要 **200**，故须覆盖（对照登录用 `@HttpCode(200)`）。
- `toPlainGraph(body)`：把 class-transformer 实例转成普通对象再交给 service——理由见 §8.4。
- 每个方法都把 `@CurrentUser()` 的 `payload.sub` 当 `ownerId` 传给 service——**归属由令牌决定**（同阶段 2）。

### 5.3 画布服务（graph.service.ts）

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
      data: { graphJson: graph as unknown as Prisma.InputJsonValue },
    })
    return this.draftOf(app)
  }

  /** POST /apps/{id}/graph/publish：校验**当前草稿**，通过后快照为已发布图。 */
  async publish(ownerId: string, id: string): Promise<PublishGraphResponse> {
    const app = await this.findOwned(ownerId, id)
    const draft = this.draftOf(app)
    this.assertValid(draft)
    const updated = await this.prisma.app.update({
      where: { id },
      data: {
        publishedGraphJson: draft as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
    })
    return {
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

**要点**：

- `findOwned` 与 `AppsService` 的同名方法**逻辑一致**（`null` 或非本人 → 404 `App not found`）。归属惯例见 `02-应用管理/03-NestJS应用模块.md` §7，此处不重讲。
- `assertValid` 把纯函数 `validateGraph` 的结果用 `"; "` 连接成一个 `message`，抛 `BadRequestException`（→ 400）。
- `publish` 校验的是**当前草稿**（`this.draftOf(app)`，从库里读出的），**不是**请求体——publish 根本没有 body。这一点对 §7「为什么不用装饰器」很关键。
- `graphJson as unknown as Prisma.InputJsonValue`：Prisma 的 `Json` 列在类型层要求 `InputJsonValue`，这里显式断言（`Graph` 是契约类型，不含 Prisma 的内部标记）。

### 5.4 图语义校验器（graph.validator.ts）—— 纯函数

**完整文件路径：`apps/api-ts/src/graph/graph.validator.ts`**

```ts
import type { Graph } from '@mini-dify/contract'

/**
 * 图**语义**校验（纯函数）。
 *
 * 与 api-py 的 `app/graph/validator.py::validate_graph` 逐条对齐：
 * 规则顺序、同规则内的遍历顺序、文案模板完全一致，见
 * `packages/contract/error-messages.md` §3。
 *
 * 返回错误文案数组（可能为空）；调用方用 `"; "` 连接成一个 `message`。
 * 注意：本函数**不含**「读取草稿」时的豁免 —— 草稿为 null 时读取返回合法空图，
 * 不走本校验；只有 `PUT` / `publish` 才调用本函数（空图会因规则 3/4 不通过）。
 */
export function validateGraph(graph: Graph): string[] {
  const errors: string[] = []

  // 规则 1：version 必须为 "1"
  if (graph.version !== '1') {
    errors.push('graph version must be 1')
  }

  // 规则 2：节点 id 必须唯一（按数组顺序，每个重复 id 只报一次）
  const seenNodeIds = new Set<string>()
  const reportedNodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (seenNodeIds.has(node.id) && !reportedNodeIds.has(node.id)) {
      errors.push(`node id must be unique: ${node.id}`)
      reportedNodeIds.add(node.id)
    }
    seenNodeIds.add(node.id)
  }

  // 规则 3：恰好一个 start 节点（0 个或 ≥2 个都报此条）
  if (graph.nodes.filter((node) => node.type === 'start').length !== 1) {
    errors.push('graph must contain exactly one start node')
  }

  // 规则 4：至少一个 end 节点
  if (graph.nodes.filter((node) => node.type === 'end').length === 0) {
    errors.push('graph must contain at least one end node')
  }

  // 规则 5：边 id 必须唯一（按数组顺序，每个重复 id 只报一次）
  const seenEdgeIds = new Set<string>()
  const reportedEdgeIds = new Set<string>()
  for (const edge of graph.edges) {
    if (seenEdgeIds.has(edge.id) && !reportedEdgeIds.has(edge.id)) {
      errors.push(`edge id must be unique: ${edge.id}`)
      reportedEdgeIds.add(edge.id)
    }
    seenEdgeIds.add(edge.id)
  }

  // 规则 6：边的 source/target 必须指向存在的节点（先 source 后 target）
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`edge ${edge.id} references unknown node: ${edge.source}`)
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`edge ${edge.id} references unknown node: ${edge.target}`)
    }
  }

  // 规则 7：不允许自环（source === target）
  for (const edge of graph.edges) {
    if (edge.source === edge.target) {
      errors.push(`edge ${edge.id} must not connect a node to itself`)
    }
  }

  return errors
}
```

> 规则清单与文案模板的唯一真源是 `packages/contract/error-messages.md` §3；api-py 的 `app/graph/validator.py` 与之逐条对齐。本篇只讲 TS 侧实现与设计取舍（§7）。

### 5.5 画布 DTO（dto/graph.dto.ts）

**完整文件路径：`apps/api-ts/src/graph/dto/graph.dto.ts`**

```ts
import { Type } from 'class-transformer'
import { IsArray, IsDefined, IsIn, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'

const NODE_TYPES = ['start', 'end', 'llm'] as const

/** 对应契约 `NodePosition`。 */
class NodePositionDto {
  @IsNumber()
  x!: number

  @IsNumber()
  y!: number
}

/** 对应契约 `GraphNode`。`data` 为节点各自的配置（自由结构，不做内部约束）。 */
class GraphNodeDto {
  @IsString()
  id!: string

  @IsIn(NODE_TYPES)
  type!: (typeof NODE_TYPES)[number]

  @IsDefined()
  @ValidateNested()
  @Type(() => NodePositionDto)
  position!: NodePositionDto

  @IsObject()
  data!: Record<string, unknown>
}

/** 对应契约 `GraphEdge`（`sourceHandle` / `targetHandle` 可选，可为 null）。 */
class GraphEdgeDto {
  @IsString()
  id!: string

  @IsString()
  source!: string

  @IsString()
  target!: string

  @IsOptional()
  @IsString()
  sourceHandle?: string | null

  @IsOptional()
  @IsString()
  targetHandle?: string | null
}

/** PUT /apps/{id}/graph 的请求体 —— 对应契约 `Graph`。 */
export class GraphDto {
  @IsString()
  version!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GraphNodeDto)
  nodes!: GraphNodeDto[]

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GraphEdgeDto)
  edges!: GraphEdgeDto[]
}
```

> 装饰器与 `class-validator` 基础见 `01-账号与认证/03-NestJS认证.md` §6。这里只补**嵌套 DTO** 的部分，见 §8。

### 5.6 校验错误收集器（validation-exception-factory.ts）—— 本轮**改动后**的样子

**完整文件路径：`apps/api-ts/src/common/validation-exception-factory.ts`**

```ts
import { BadRequestException } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

/**
 * `ValidationPipe.exceptionFactory`：把 class-validator 的 `ValidationError[]`
 * 映射成契约规定的**单一 message 字符串**（见 packages/contract/error-messages.md）。
 *
 * 契约要点：多个错误按字段声明顺序排列、同一字段内按规则顺序排列，用 `"; "` 连接；
 * `statusCode` 仍为 400、`error` 仍为 `Bad Request`（由 HttpErrorFilter 统一包装）。
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException(collectMessages(errors).join('; '))
}

/**
 * 递归收集错误文案。
 *
 * 平铺 DTO（如 `/auth`、`/apps` 的请求体）没有子错误，行为与原先的
 * `errors.map(toMessage)` 完全一致；嵌套 DTO（如画布 `Graph`）的父级
 * `ValidationError` 只带 `children`、自身无 `constraints`，此时只下钻到叶子，
 * 使文案落到具体字段（与 FastAPI 侧 `loc[-1]` 的取法对齐）。
 */
function collectMessages(errors: ValidationError[]): string[] {
  const messages: string[] = []
  for (const error of errors) {
    const constraints = error.constraints ?? {}
    if ('whitelistValidation' in constraints || Object.keys(constraints).length > 0) {
      messages.push(toMessage(error))
    }
    if (error.children !== undefined && error.children.length > 0) {
      messages.push(...collectMessages(error.children))
    }
  }
  return messages
}

function toMessage(error: ValidationError): string {
  const field = error.property
  const constraints = error.constraints ?? {}
  const value: unknown = error.value

  // 额外字段（whitelist + forbidNonWhitelisted）
  if ('whitelistValidation' in constraints) {
    return `${field} should not exist`
  }
  // 必填字段缺失
  if (value === undefined || 'isDefined' in constraints) {
    return `${field} is required`
  }
  // 类型不是字符串（class-validator 的 isString 只在非字符串时失败）
  if ('isString' in constraints) {
    return `${field} must be a string`
  }
  if ('isEmail' in constraints) {
    // email 字段没有 isString 装饰器，非字符串会落到这里
    return typeof value === 'string' ? `${field} must be a valid email` : `${field} must be a string`
  }
  if ('minLength' in constraints) {
    return `${field} must be at least ${firstNumber(constraints.minLength)} characters`
  }
  if ('isLength' in constraints) {
    // @Length(min, max) 的默认文案会按实际越界方向给出「longer」或「shorter」
    const message = constraints.isLength
    if (message.includes('shorter than or equal to')) {
      return `${field} must be at most ${firstNumber(message)} characters`
    }
    return `${field} must be at least ${firstNumber(message)} characters`
  }
  if ('maxLength' in constraints) {
    return `${field} must be at most ${firstNumber(constraints.maxLength)} characters`
  }
  if ('isIn' in constraints) {
    return `${field} must be one of: ${enumValues(constraints.isIn)}`
  }
  // 兜底：契约已覆盖全部规则，正常不应到达
  return `${field} is invalid`
}

/** 取文案中的第一个整数（长度类默认文案里含声明的 N）。 */
function firstNumber(message: string): number {
  const matched = message.match(/\d+/)
  return matched === null ? 0 : Number(matched[0])
}

/** 从 isIn 默认文案里取出枚举值列表，如 "... following values: chatflow, workflow"。 */
function enumValues(message: string): string {
  const marker = 'following values:'
  const index = message.indexOf(marker)
  return index >= 0 ? message.slice(index + marker.length).trim() : message
}
```

> 文件**只在 `validationExceptionFactory` 与 `collectMessages` 两处做了改动**（改动前后对照见 §9）；`toMessage` / `firstNumber` / `enumValues` 与阶段 2 一致，不重讲。

### 5.7 根模块（app.module.ts）

**完整文件路径：`apps/api-ts/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AppsModule } from './apps/apps.module'
import { AuthModule } from './auth/auth.module'
import { GraphModule } from './graph/graph.module'
import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
import { PrismaModule } from './prisma/prisma.module'

/**
 * 根模块。阶段 1 加入：
 * - `PrismaModule`（全局数据库访问）
 * - `AuthModule`（注册 / 登录 / 当前用户）
 * 阶段 2 加入 `AppsModule`（应用管理）。
 * 阶段 3 加入 `GraphModule`（画布存取与校验）。
 */
@Module({
  imports: [PrismaModule, AuthModule, AppsModule, GraphModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

> 只多了一行 `GraphModule`，模块系统见 `00-项目初始化/05-NestJS起步.md`。

### 5.8 数据模型（prisma/schema.prisma）—— `App` 模型新增三列

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**

```prisma
// mini-dify（TS 侧）数据模型
// 契约：packages/contract/openapi.yaml（UserResponse 的字段与 role 取值）

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         String   @default("member")
  createdAt    DateTime @default(now()) @map("created_at")

  apps App[]

  @@map("users")
}

model App {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  description String?
  mode        String   @default("chatflow")
  createdAt   DateTime @default(now()) @map("created_at")
  // @default(now()) 与迁移 add_updated_at_default_and_trigger 的 DB 默认值保持一致
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

**对应的迁移文件（完整文件路径）：`apps/api-ts/prisma/migrations/20261018124928_add_app_graph/migration.sql`**

```sql
-- AlterTable
ALTER TABLE "apps" ADD COLUMN     "graph_json" JSONB,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_graph_json" JSONB;
```

> 三列**都可空**：`graphJson` 为 `null` 即「从未编辑」、`publishedAt` 为 `null` 即「从未发布」——这是 §10 空图语义的**存储层基础**。Prisma / 迁移机制见 `01-账号与认证/02-Prisma.md`。

### 5.9 全局校验管道与错误过滤器（main.ts）—— 仅引用，不重讲

**完整文件路径：`apps/api-ts/src/main.ts`**

```ts
// 必须最先执行：Prisma 在运行期需要 process.env.DATABASE_URL
import 'dotenv/config'

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { HttpErrorFilter } from './common/http-error.filter'
import { validationExceptionFactory } from './common/validation-exception-factory'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  // 前端（localhost:3000）与后端（localhost:3001）跨域，阶段 0 直接放开。
  app.enableCors({ origin: true })
  // 全局校验管道：让 class-validator 装饰器生效，并把校验错误统一成 400。
  // exceptionFactory 把错误文案归一成契约规定的单一 message（见 error-messages.md）。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  )
  // 把错误体归一化成契约的 { statusCode, message, error }（message 统一为字符串）。
  app.useGlobalFilters(new HttpErrorFilter())
  await app.listen(3001)
  // eslint-disable-next-line no-console
  console.log('api-ts listening on http://localhost:3001')
}

void bootstrap()
```

> 这里 `exceptionFactory: validationExceptionFactory` 就是本篇改动的**挂载点**——没有它，`collectMessages` 的递归便无处生效（`ValidationPipe` 默认产出的 `message` 是数组，`HttpErrorFilter` 再 join）。`ValidationPipe` 选项、`HttpErrorFilter` 均见 `01-账号与认证/03-NestJS认证.md`，此处只引用。

---

## 6. 【技术教学 · 首次】嵌套路由与「按资源再拆一个模块」

### 6.1 什么是嵌套路由

**嵌套路由**：一条路由的路径由「父资源」+「子资源」两层组成，形如 `/apps/{id}/graph`。子资源**必须依附于某个父资源实例**（某应用的画布）才存在——没有「全局的 graph」这种概念。

对照阶段 2 的 `/apps/{id}` 只操作「应用本身」；本篇的 `/apps/{id}/graph` 操作的是「某个应用**下面**的画布」。这就是嵌套。

### 6.2 NestJS 里表达嵌套的两种写法（等价）

```ts
// 写法 A（本篇采用的）：@Controller 只写父资源前缀，方法里补子路径
@Controller('apps')
export class GraphController {
  @Get(':id/graph') ...
  @Put(':id/graph') ...
  @Post(':id/graph/publish') ...
  @Get(':id/graph/published') ...
}

// 写法 B：把 :id 也写进 @Controller 前缀
@Controller('apps/:id/graph')
export class GraphController {
  @Get() ...
  @Put() ...
  @Post('publish') ...
  @Get('published') ...
}
```

两者**最终路由完全相同**（`/apps/:id/graph` 等）。区别只在「`:id` 这个路径参数写在哪一层」：

| | 写法 A（`@Controller('apps')`） | 写法 B（`@Controller('apps/:id/graph')`） |
| --- | --- | --- |
| `@Param('id')` 取值 | 方法参数按名取 `id`，**同一写法** | 同样按名取 `id`，**同一写法** |
| 路由前缀冲突 | 与 `AppsController` 的 `@Controller('apps')` **前缀相同** | 前缀不同 |
| 可读性 | 一个控制器内能一眼看到「子路径长什么样」 | 前缀决定了公共部分，方法更短 |

**本项目为什么选 A**：`GraphController` 与 `AppsController` **都以 `@Controller('apps')` 起头**。NestJS **允许**多个控制器声明同一前缀——它只是把各自的方法**拼进同一棵路由树**，只要**完整路径不冲突**就不会有问题（`AppsController` 是 `:id`，`GraphController` 是 `:id/graph`，二者不撞）。这样 `GraphController` 内的四条方法**并列、直观**地展示 `graph` 及其子动作，无需在脑子里把前缀和方法名两段拼起来看。

> **注意任务简述与源码的出入**：任务描述里把装饰器写成 `@Controller('apps/:id/graph')`（写法 B），但**源码实际是写法 A**（`@Controller('apps')` + `':id/graph'` 方法路径）。本篇以源码为准；两种写法在本项目里行为等价。

### 6.3 为什么按资源再拆一个模块，而不是继续堆在 `AppsController`

`/apps/{id}/graph` 明明和 `/apps` 共用 `apps` 前缀，最省事的做法是**继续往 `AppsController` 里加四个方法**。本项目**没这么做**，理由是：

1. **职责不同**：`AppsController` 管的是「应用这条记录」的 CRUD（名字、模式、删除……）；画布管的是「应用**内部的**一张图 JSON」的存取与校验。两者的**领域**不同、**变因**不同（应用字段变 vs 图结构变），混在一个类里会让这个类同时承担两件事。
2. **校验逻辑自成一体**：画布引入了 DTO 嵌套（`GraphDto`）、纯函数校验器（`graph.validator.ts`）。把它们塞进 `AppsModule` 会污染「应用 CRUD」这个相对简单的模块。
3. **模块边界 = 依赖边界**：`GraphModule` 能独立声明自己的 `controllers` / `providers`，DI 关系清晰（它同样 `imports: [AuthModule]` 只为拿 `JwtAuthGuard`）。将来「图」相关能力（比如阶段 4 的执行引擎要读图）可以只依赖 `GraphModule`/`GraphService`，而不必牵出整个应用模块。
4. **前缀复用不需要合并控制器**：如上 §6.2，NestJS 天然支持「多个控制器共享前缀」，所以「拆分」在这里**几乎零成本**——不需要为了共用 `apps` 前缀而牺牲职责划分。

> 一句话：**路由的「前缀」是 URL 层面的组织，模块的「边界」是代码层面的组织，两者不必一一对应**。同一前缀下挂多个控制器，正是把「URL 组织」和「代码组织」解耦的体现。

---

## 7. 【技术教学 · 首次】业务规则校验 vs 结构校验：分层与纯函数

> 这是本篇的**核心设计**。请务必分清两层各管什么、为什么分开。

### 7.1 两层校验各管什么

| | **结构校验** | **业务规则校验（语义）** |
| --- | --- | --- |
| 管什么 | 字段的**存在性 / 类型 / 必填 / 枚举 / 额外字段** | 整张图的**语义约束**（恰好一个 start、边指向存在的节点……） |
| 单字段还是跨字段 | **逐字段**独立判断 | **跨字段、跨数组**（要看全部节点/边才能判） |
| 谁来做 | `class-validator` 装饰器 + `ValidationPipe` | 纯函数 `validateGraph(graph)` |
| 在哪定义 | DTO 类（`GraphDto` / `GraphNodeDto` / `GraphEdgeDto`） | `graph.validator.ts` |
| 什么时机跑 | 仅**请求体**经过 `@Body()` 时（Pipe 阶段） | `PUT` / `publish` 在 **service** 里显式调用 |
| 能覆盖「库里读出的草稿」吗 | **不能**（Pipe 只作用于请求体） | **能**（就是个普通函数，任何 `Graph` 都能传进去） |
| 错误文案 | 由 `validationExceptionFactory` 归一 | 由 `validateGraph` 直接返回 |
| 状态码 | 400 | 400 |

举几个例子看清边界：

- `nodes` 不是数组 → **结构**问题（`@IsArray`）。
- 某节点 `type` 是 `"bogus"`（不在 `start/end/llm`）→ **结构**问题（`@IsIn(NODE_TYPES)`）。
- 某节点 `position` 缺失 → **结构**问题（`@IsDefined`）→ 文案 `position is required`。
- 整图有 **0 个或 2 个** start 节点 → **业务规则**问题（`validateGraph` 规则 3）——`class-validator` **管不了**，因为「恰好一个」是**跨字段**判断。
- 边 `e1` 的 `target` 指向一个不存在的节点 id → **业务规则**问题（规则 6）——也需要看**全部节点**才能判断。

### 7.2 业务规则校验为什么写成「纯函数」

`validateGraph` 的签名是：

```ts
export function validateGraph(graph: Graph): string[]   // 入参是图，出参是错误文案数组
```

**纯函数**的三条特征它全占：**① 无 IO**（不读写数据库、不打网络、不打印）；**② 无副作用**（不改入参、不改外部状态）；**③ 同入同出**（同样一张图，永远得到同样的错误数组，且**顺序确定**）。好处：

1. **易测**：直接 `validateGraph({...}).length === 0` 或比对错误数组即可，**不需要**起 Nest 应用、不需要数据库、不需要 HTTP。一张图 = 一个断言。
2. **可复用（关键）**：**阶段 4 的执行引擎**要把 `Graph` 编译成 LangGraph 图；编译前**同样**需要「这张图能不能跑」的语义判断。届时直接 `validateGraph(graph)` 即可——它是**框架无关**的（连 `@nestjs/common` 都不 import，只 import 契约类型 `Graph`）。
3. **职责单一**：service 只负责「调用 + 把错误拼成一个 400」，规则细节全在函数里，改规则不动 controller/service。
4. **两端一致好对齐**：api-py 有一份**逐条对齐**的 `validate_graph`（见 `apps/api-py/app/graph/validator.py`）。两边都是「普通函数」，规则顺序、遍历顺序、文案模板能**逐行对照**，比「两套框架各自的校验机制」好对齐得多。

### 7.3 规则清单与实测文案

规则定义与文案模板唯一真源：`packages/contract/error-messages.md` §3。**实测**（`PUT /apps/{id}/graph`，违反单条规则时各返回一个 400）：

| 序 | 违规构造 | `message`（实测） |
| --- | --- | --- |
| 1 | `version` 传 `"2"` | `graph version must be 1` |
| 2 | 两节点同 id | `node id must be unique: {id}` |
| 3 | 无 start / 两个 start | `graph must contain exactly one start node` |
| 4 | 无 end 节点 | `graph must contain at least one end node` |
| 5 | 两条边同 id | `edge id must be unique: e1` |
| 6 | 边 `e1` 的 target 指向 `nZz`（不存在） | `edge e1 references unknown node: nZz` |
| 7 | 边 `e1` 自环（`source === target`） | `edge e1 must not connect a node to itself` |

全部响应体形状同为：

```json
{"statusCode":400,"message":"graph version must be 1","error":"Bad Request"}
```

多条同时违规时用 `"; "` 连接（如 `graph version must be 1; graph must contain exactly one start node`）。**顺序**有讲究：先按规则 1→7 走，同规则内按数组顺序（见 error-messages.md §3「组装细则」）。

### 7.4 为什么业务规则**不**写成自定义校验装饰器（取舍）

`class-validator` **确实支持**「类级自定义校验」——你可以写一个 `@Validate(SomeConstraint)` 贴在 `GraphDto` 类上，让约束拿到整个 DTO 对象、在里面判「恰好一个 start」。所以「能不能用装饰器做」的答案是：**技术上能**。本项目仍选择纯函数，取舍如下：

| 维度 | 自定义校验装饰器（未采用） | 纯函数 `validateGraph`（采用） |
| --- | --- | --- |
| **能覆盖 publish 吗** | **不能**。`publish` 没有请求体，它校验的是**从库里读出的草稿**；装饰器只在 `@Body()` 经 Pipe 时跑，对「非请求体来源的数据」无能为力 | **能**。任何 `Graph` 都能传进去——这正是 publish 需要的 |
| **能覆盖已存草稿的其他场景吗** | 不能 | 能（未来执行引擎也用） |
| **测试成本** | 要起 Pipe / 构造 `ValidationError`，或至少依赖 class-validator 的运行期 | 直接调用，零依赖 |
| **复用范围** | 绑在 DTO 上，只服务「HTTP 请求体校验」 | 框架无关，服务所有「拿到一份图」的地方 |
| **文案控制** | 要走 class-validator 的约束→`ValidationError`→`exceptionFactory` 这条链，文案被间接化 | 直接返回字符串数组，`"; "` 一拼即得 |
| **与 py 侧对齐** | 两套框架的自定义校验写法差异大 | 两边都是「普通函数」，逐条对齐最省事 |
| **依赖方向** | DTO 依赖 class-validator 运行期机制 | 校验器只 import 契约类型（零框架依赖） |

**结论**：结构校验（字段级、只作用于请求体）用装饰器**最省事**；业务规则（跨字段、**且要作用于存储中的草稿与非请求体场景**）用纯函数**最合适**。这条「**装饰器做结构、纯函数做业务**」的分界，是本项目校验设计的原则，后续阶段（节点库、执行引擎）会继续沿用。

> 特别注意第 1 行那个**硬性理由**：`publish` 的校验对象是 `this.draftOf(app)`（库里读的），压根不经过 `ValidationPipe`。**只要 publish 存在，纯函数就几乎是唯一选择**——装饰器方案在这里直接失效。

---

## 8. 【技术教学 · 首次】嵌套 DTO、`@ValidateNested` 与 `@Type`

### 8.1 问题：一个 DTO 里装另一个 DTO

契约的 `Graph` 不是「一层平对象」，它内嵌两段数组，数组元素又是对象：

```
Graph
 ├─ version: string
 ├─ nodes: GraphNode[]        ← 数组
 │    └─ GraphNode
 │         ├─ id / type
 │         ├─ position: NodePosition   ← 再嵌一层对象
 │         └─ data
 └─ edges: GraphEdge[]        ← 数组
      └─ GraphEdge { id, source, target, sourceHandle?, targetHandle? }
```

`class-validator` 的装饰器默认**只校验被装饰的那一层**。如果 `GraphDto` 里只写：

```ts
@IsArray()
nodes!: GraphNodeDto[]   // 只保证 nodes 是数组；数组里每个元素的内容没人管
```

那么「每个节点的 `type` 是不是合法枚举」「`position` 在不在」**统统不会被校验**——前端传一堆垃圾也能过。要往下钻一层，需要两个装饰器**配合**：

```ts
@IsArray()
@ValidateNested({ each: true })   // ← 让 class-validator 对数组的每个元素也做嵌套校验
@Type(() => GraphNodeDto)         // ← 让 class-transformer 把元素实例化成 GraphNodeDto
nodes!: GraphNodeDto[]
```

### 8.2 `@ValidateNested({ each: true })` 做什么

它告诉 `class-validator`：「这个属性的值是**（数组里的）对象**，请对其中**每个元素**递归执行其自身类上的校验装饰器」。

- `each: true`：因为值是**数组**，要对**每个元素**都做（若值是单个对象则不需要 `each`）。
- 校验的规则来自**目标元素的类**（这里是 `GraphNodeDto` 上的 `@IsString` / `@IsIn` / `@IsDefined`…）——所以元素类**必须先存在**且它的装饰器齐全。

### 8.3 `@Type(() => GraphNodeDto)` 与 class-transformer 的必要性（关键）

**这是最容易漏、也最隐蔽的一点**。

`ValidationPipe({ transform: true })` 的工作流程是：**先**用 class-transformer 把「纯 JSON 对象」**实例化**成 DTO 类的实例，**再**让 class-validator 去校验这些实例。而 class-transformer 默认**不知道**「`nodes` 数组里的元素应该被实例化成哪个类」——JSON 里它们只是 `object`。于是：

- 没有 `@Type(() => GraphNodeDto)`：`nodes[0]` 只是普通对象，**不是** `GraphNodeDto` 实例。此时 `@ValidateNested` 找不到它的类元数据，**它的字段级装饰器不会被触发**——校验静默失效。
- 有 `@Type(() => GraphNodeDto)`：class-transformer 明确知道「把这里的每个元素 new 成 `GraphNodeDto`」，实例带上了类原型；随后 `@ValidateNested` 才能顺着类元数据往下校验。

> **为什么用 `() => GraphNodeDto` 这种「返回类」的箭头函数**：`@Type` 的参数是一个**工厂函数**而非类本身。原因与循环引用有关——类在定义时可能还没就绪，延迟到真正调用时才去取 `GraphNodeDto`，可避免「类还没定义就被引用」。本项目 `GraphNodeDto` 定义在 `GraphDto` 之前，本可直写，但 `@Type(() => ...)` 是 class-transformer 的**约定写法**，照约定写最稳妥。
>
> **注意**：`@Type` 来自 **`class-transformer`**，`@ValidateNested` / `@IsArray` 等来自 **`class-validator`**——两者是**两个不同的库**，`ValidationPipe` 内部同时用到了它们（`transform: true` 才启用 class-transformer 这段）。`GraphDto` 正是本项目**第一次**同时用上这两个库的地方。

### 8.4 为什么还要 `toPlainGraph(body)`（实例 → 普通对象）

```ts
function toPlainGraph(body: GraphDto): Graph {
  return JSON.parse(JSON.stringify(body)) as Graph
}
```

经过 Pipe 之后，`@Body() body` 已经是**`GraphDto` 的类实例**（带类原型）。service 想把它当**纯数据**塞进 Prisma 的 `Json` 列，做两件事更干净：

1. **抹掉类实例痕迹**：`JSON.parse(JSON.stringify(x))` 得到的是**普通对象**，没有原型、没有类方法，正是 Prisma `Json` 列和契约类型 `Graph` 期望的「纯 JSON 值」。
2. **对齐「存下的形状 = 请求体的形状」**：`JSON.stringify` 会**丢弃值为 `undefined` 的属性**。`GraphEdgeDto` 的 `sourceHandle` / `targetHandle` 是可选（`@IsOptional()`）；**没传**这两个字段时它们是 `undefined`，序列化后该键直接消失——**缺省就是缺省**。而**显式传 `null`** 时键被保留为 `null`（`JSON.stringify` 保留 `null`）。实测正是如此：请求里 `sourceHandle:"out"` 与 `sourceHandle:null` 都被原样存下、原样读回。

> 顺带：结构校验的 `whitelist: true` 已在 Pipe 阶段把**非契约字段**剔除，`forbidNonWhitelisted: true` 又把**多出来的字段**判为 400（文案 `{field} should not exist`）。所以进到 service 的 `GraphDto` 只剩契约字段，`toPlainGraph` 再做一次「纯化」即可。

---

## 9. 【技术教学 · 首次】`ValidationError.children` 的递归收集（本轮改动）

### 9.1 改动前后

阶段 2 的 `validationExceptionFactory`（见 `02-应用管理/07-验收.md`）是**平铺**处理：

```ts
// 改动前（阶段 2）
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException(errors.map(toMessage).join('; '))   // ← 只处理顶层 errors
}
```

阶段 3 引入**嵌套 DTO** 后，改成**递归**：

```ts
// 改动后（阶段 3）
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException(collectMessages(errors).join('; '))  // ← 递归收集
}

function collectMessages(errors: ValidationError[]): string[] {        // ← 新增函数
  const messages: string[] = []
  for (const error of errors) {
    const constraints = error.constraints ?? {}
    if ('whitelistValidation' in constraints || Object.keys(constraints).length > 0) {
      messages.push(toMessage(error))
    }
    if (error.children !== undefined && error.children.length > 0) {
      messages.push(...collectMessages(error.children))                // ← 下钻到 children
    }
  }
  return messages
}
```

### 9.2 为什么必须改：嵌套 DTO 的错误藏在 `children` 里

`class-validator` 校验嵌套结构时，产出的 `ValidationError` 是一棵**树**，而**父级节点常常自己没有 `constraints`**（它没有「自己的字段规则」失败，只是「孩子有问题」）。以「某节点的 `type` 不是合法枚举」为例，大致结构是：

```
ValidationError[0]                      property = "nodes"     ← 顶层：nodes 是数组，本身合法
  └─ children[0]                        property = "0"         ← 下标 0（无 constraints，只带孩子）
       └─ children[0]                   property = "type"      ← 真正出错的字段
            constraints = { isIn: "...must be one of..." }
```

`toMessage` 只认 `error.constraints`；顶层那条**没有** `constraints`，`toMessage` 会给不出正确文案（会落到兜底）。所以必须**沿着 `children` 下钻**，把文案落到**叶子**（真正带 `constraints` 的那一层）——`collectMessages` 里那两句：

- `if (constraints 非空) → toMessage(error)`：只对**带 `constraints` 的节点**产出文案（叶子）；
- `if (children 非空) → 递归`：继续往下一层收集。

于是父级「空转」的节点**不产出**多余文案，最终只留下具体字段的错误——文案如 `type must be one of: start, end, llm`（**多个枚举值**的文案：`enumValues` 从 `isIn` 的默认文案里截出 `start, end, llm`）。实测：这类结构校验文案（含 `position is required`、多值枚举）**两端一致**。

### 9.3 为什么对平铺 DTO「行为不变」

平铺 DTO（`/auth` 的注册体、`/apps` 的创建体）**没有嵌套**，其 `ValidationError` 都是**叶子**、没有 `children`。对照 `collectMessages`：

- 叶子有 `constraints` → 走 `toMessage`，**与改动前逐条一致**；
- 叶子 `children` 为空 → 不再递归。

所以对阶段 1/2 的接口，输出**字节不变**（阶段 2 的 12/12 用例仍成立）；只有嵌套结构才会走到「下钻」这条新路径。这正是「**向后兼容的增量改动**」——新增能力不改变既有行为。

> 对照 Python 侧：FastAPI 的 `RequestValidationError` 给出的是 `loc` 数组（路径，如 `["body","nodes",0,"type"]`），处理器取 `loc[-1]` 即「最末字段名」。TS 侧的「下钻到叶子」与 py 侧的「`loc[-1]`」是**同一意图的两种实现**——都为了「让文案定位到**真正出错的字段**」。两端文案逐字节一致，见 `packages/contract/error-messages.md` §1/§3。

---

## 10. 【技术教学 · 首次】`null` 与「空图」语义

### 10.1 存储层的两种「没有」

`apps` 表新增的三列都可空（§5.8），各自表达一种「没有」：

| 列 | `null` 的含义 | 对外行为 |
| --- | --- | --- |
| `graph_json` | **从未编辑过草稿** | `GET /apps/{id}/graph` 返回**合法空图**（见 10.2） |
| `published_graph_json` | **从未发布过** | `GET /apps/{id}/graph/published` → **404** `Graph not published` |
| `published_at` | 同上 | —— |

### 10.2 草稿为 `null` 时，为什么返回「合法空图」而不是 404 或 `null`

契约在 `GET /apps/{id}/graph` 里明确：从未保存过草稿时返回 `{"version":"1","nodes":[],"edges":[]}`。service 用一句三元的映射实现：

```ts
const EMPTY_GRAPH: Graph = { version: '1', nodes: [], edges: [] }

private draftOf(app: { graphJson: Prisma.JsonValue | null }): Graph {
  return app.graphJson === null ? EMPTY_GRAPH : (app.graphJson as unknown as Graph)
}
```

**为什么空图，而不是 404 / `null`**：

- 画布页面前端**总是需要一张图**来渲染。返回一个结构完整的空图，前端可以直接「当空画布打开」，**无需**为「从未编辑」写单独的 404 分支——API 形状**恒定**（永远是一份 `Graph`）。
- 对比 `published`：**发布与否是业务状态**，从未发布的「已发布图」本就**不该存在**，用 404 表达「它还没有」更贴切。**草稿**则不同——「没有草稿」等价于「一张空的草稿」，语义上返回空图更自然。

> 这是同一种存储 `null`、两种对外语义的**有意设计**：**草稿的 `null` → 空图（可用时刻都有图）**；**发布快照的 `null` → 404（它真的还没有）**。

### 10.3 「读取不校验、写入才校验」

注意 `EMPTY_GRAPH` **本身不通过**业务规则（它没有 start、也没有 end，违反规则 3/4）。但 `draftOf` 在**读取**路径上**不调用** `assertValid`——所以 `GET` 返回这个空图**完全正常**。这印证了两条分工：

- **读取（`GET`）不校验**：只是把存储里的图（或空图）**原样吐出**，不做语义判断。
- **写入（`PUT`）/ 发布（`publish`）才校验**：`PUT` 校验请求体；`publish` 校验**当前草稿**——所以一个从没 `PUT` 过的应用直接 `publish`，会因为「空图违反规则 3/4」而 **400**（`graph must contain exactly one start node; graph must contain at least one end node`）。

> 这道分工在 `validateGraph` 的注释、`draftOf` 的注释、以及 `error-messages.md` 的脚注里**三处**都被显式写明——因为它容易被误改成「读取也校验」，而那样会让「空画布打开」直接报错。

---

## 11. 验收自测

前提：`pnpm dev:api-ts` 已启动（打印 `api-ts listening on http://localhost:3001`），且 `apps` 表已迁移（含三个画布列）。

### 11.1 PowerShell（推荐，避免引号问题）

```powershell
$base  = 'http://localhost:3001'
$email = "g$(Get-Random)@example.com"

# 1) 注册 + 登录 → 拿 token
Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' `
  -Body (@{ email = $email; password = 'secret123' } | ConvertTo-Json) | Out-Null
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' `
  -Body (@{ email = $email; password = 'secret123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.accessToken)" }

# 2) 建应用 → 拿 id
$app = Invoke-RestMethod -Method Post -Uri "$base/apps" -Headers $h -ContentType 'application/json' `
  -Body (@{ name = '画布演示' } | ConvertTo-Json)
$id = $app.id

# 3) 读取未编辑的草稿 → 200 {"version":"1","nodes":[],"edges":[]}
Invoke-RestMethod -Uri "$base/apps/$id/graph" -Headers $h

# 4) 保存一份合法图（start/end/llm 三节点 + 两条边，含 sourceHandle:"out" 与 sourceHandle:null）
$graph = @{
  version = '1'
  nodes = @(
    @{ id='n1'; type='start'; position=@{x=0;y=0}; data=@{} },
    @{ id='n2'; type='llm';   position=@{x=200;y=0}; data=@{ prompt='你好' } },
    @{ id='n3'; type='end';   position=@{x=400;y=0}; data=@{} }
  )
  edges = @(
    @{ id='e1'; source='n1'; target='n2'; sourceHandle='out'; targetHandle=$null },
    @{ id='e2'; source='n2'; target='n3' }
  )
}
$body = $graph | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Put -Uri "$base/apps/$id/graph" -Headers $h -ContentType 'application/json' -Body $body

# 5) 再 GET → 与请求体逐字段一致（sourceHandle:"out" 与 null 都被保留）
(Invoke-RestMethod -Uri "$base/apps/$id/graph" -Headers $h).edges

# 6) 发布 → 200，返回 publishedAt + graph 快照
Invoke-RestMethod -Method Post -Uri "$base/apps/$id/graph/publish" -Headers $h

# 7) 读已发布图 → 200
Invoke-RestMethod -Uri "$base/apps/$id/graph/published" -Headers $h
```

**看错误体（PS 5 用 `$_.ErrorDetails.Message`）**

```powershell
function Show-Err($method, $path, $headers, $body) {
  try {
    if ($body) { Invoke-RestMethod -Method $method -Uri "http://localhost:3001$path" @headers -ContentType 'application/json' -Body $body }
    else       { Invoke-RestMethod -Method $method -Uri "http://localhost:3001$path" @headers }
  } catch { Write-Output ("HTTP " + [int]$_.Exception.Response.StatusCode + " " + $_.ErrorDetails.Message) }
}

# 语义校验：version 不是 1 → 400 "graph version must be 1"
Show-Err Put "/apps/$id/graph" $h ((@{ version='2'; nodes=@(); edges=@() } | ConvertTo-Json -Depth 10))
# 语义校验：无 start → 400
Show-Err Put "/apps/$id/graph" $h ((@{ version='1'; nodes=@(@{id='n1';type='end';position=@{x=0;y=0};data=@{}}); edges=@() } | ConvertTo-Json -Depth 10))
# 结构校验：type 非法 → 400 "type must be one of: start, end, llm"
Show-Err Put "/apps/$id/graph" $h ((@{ version='1'; nodes=@(@{id='n1';type='bogus';position=@{x=0;y=0};data=@{}}); edges=@() } | ConvertTo-Json -Depth 10))
```

### 11.2 curl（cmd / Git Bash 可用；PowerShell 请用 `curl.exe`）

```bash
# 读草稿 → 200（未编辑时为空图）
curl -i http://localhost:3001/apps/<ID>/graph -H "Authorization: Bearer <TOKEN>"

# 保存草稿 → 200
curl -i -X PUT http://localhost:3001/apps/<ID>/graph \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"version":"1","nodes":[{"id":"n1","type":"start","position":{"x":0,"y":0},"data":{}},{"id":"n2","type":"end","position":{"x":200,"y":0},"data":{}}],"edges":[{"id":"e1","source":"n1","target":"n2","sourceHandle":"out"}]}'

# 发布 → 200
curl -i -X POST http://localhost:3001/apps/<ID>/graph/publish -H "Authorization: Bearer <TOKEN>"

# 读已发布 → 200
curl -i http://localhost:3001/apps/<ID>/graph/published -H "Authorization: Bearer <TOKEN>"

# 从未发布 → 404 {"message":"Graph not published"}
curl -i http://localhost:3001/apps/<ID2>/graph/published -H "Authorization: Bearer <TOKEN>"

# 语义校验 → 400 "graph version must be 1"
curl -i -X PUT http://localhost:3001/apps/<ID>/graph \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"version":"2","nodes":[],"edges":[]}'
```

### 11.3 逐项核对表

| 检查项 | 命令 / 操作 | 预期 |
| --- | --- | --- |
| 读未编辑草稿 | `GET /apps/{id}/graph` | **200** `{"version":"1","nodes":[],"edges":[]}` |
| 保存草稿 | `PUT /apps/{id}/graph` 合法图 | **200**；随后 `GET` 与请求体**逐字段一致**（`sourceHandle:"out"` 与 `null` 均保留） |
| 发布 | `POST /apps/{id}/graph/publish` | **200**，`publishedAt` 形如 `2026-10-18T13:40:03.893Z` |
| 读已发布 | `GET /apps/{id}/graph/published` | **200** `Graph` |
| 从未发布 | `GET .../published` | **404** `{"statusCode":404,"message":"Graph not published","error":"Not Found"}` |
| 缺 token | 任一 `.../graph*` 无头 | **401** `message:"Missing bearer token"` |
| **归属** | 用户 B 读 A 的图 | **404** `{"statusCode":404,"message":"App not found","error":"Not Found"}` |
| 语义：version | `version:"2"` | **400** `graph version must be 1` |
| 语义：无 start | 无 start 节点 | **400** `graph must contain exactly one start node` |
| 语义：无 end | 无 end 节点 | **400** `graph must contain at least one end node` |
| 语义：边指向未知节点 | `target:"nZz"` | **400** `edge e1 references unknown node: nZz` |
| 语义：边 id 重复 | 两条 `id:"e1"` | **400** `edge id must be unique: e1` |
| 语义：自环 | `source===target` | **400** `edge e1 must not connect a node to itself` |
| 结构：position 缺失 | 节点无 `position` | **400** `position is required` |
| 结构：type 枚举 | `type:"bogus"` | **400** `type must be one of: start, end, llm` |
| **跨后端** | api-py `PUT` 的图，api-ts `GET` | **200**，两端**同一份图**、逐字段一致 |

> 跨后端那条的前提是同一认证域（`JWT_SECRET` 同值）与**同一张 `apps` 表**——详见 `01-账号与认证/06-JWT与密码哈希.md` 与 `03-画布` 的验收篇。

---

## 12. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **`@ValidateNested` 漏了 `@Type`** | 节点/边字段非法却过了校验（静默失效） | class-transformer 不知道数组元素该实例化成哪个类，字段级装饰器不触发。必须**成对**写 `@ValidateNested({ each: true })` + `@Type(() => GraphNodeDto)`（§8.3） |
| **`@ValidateNested` 缺 `each: true`** | 数组元素**不被校验** | `each: true` 表示对数组的**每个**元素递归校验（§8.2） |
| **只改 `errors.map` 没改递归** | 嵌套 DTO 的 400 文案落在 `nodes` / 下标上，或落到兜底 `is invalid` | 没沿 `ValidationError.children` 下钻；须用 `collectMessages` 递归（§9） |
| **`publish` 拿请求体校验** | `POST .../publish` 无 body 可校验，或校验了错误的对象 | `publish` 必须校验**当前草稿**（`this.draftOf(app)`），不是请求体（§7.4） |
| **读取时也跑 `validateGraph`** | `GET .../graph` 对空图报 400 | 读取**不校验**；空图 `{version:"1",nodes:[],edges:[]}` 本就不满足规则 3/4（§10.3） |
| **草稿 `null` 当成 404 或直接返回 `null`** | 前端打开空画布报错 | 草稿为 `null` 时应返回 `EMPTY_GRAPH`（契约要求合法空图，§10.2）；只有 `published` 的 `null` 才 404 |
| **`published` 未发布返回 200 / 空图** | 与契约不符 | 从未发布**必须 404** `Graph not published`（`publishedGraphJson === null` 判断，§10.1） |
| **`PUT` 状态码当成 201** | 期望 200 得 201 | `@Put` 默认 **200**，本无需 `@HttpCode`；而 `@Post` 默认 201，`publish` 必须写 `@HttpCode(200)`（§5.2） |
| **`sourceHandle` 缺省变成了 `null`** | 请求没传的句柄字段，存下/读回却成了 `null` | `toPlainGraph` 的 `JSON.stringify` 会丢 `undefined` 键——**缺省就该缺省**；只有**显式传 `null`** 才存 `null`（§8.4） |
| **`graph_json` 三列不存在** | `PUT` 报 **500** | 没跑迁移（`pnpm --filter @mini-dify/api-ts db:migrate`），见 §5.8 |
| **`GraphModule` 缺 `imports: [AuthModule]`** | `JwtAuthGuard` 注入失败 / `Nest can't resolve dependencies` | 与阶段 2 同理：`AuthModule` `exports` `JwtAuthGuard` + 下游 `imports` 是**配对**的（`02-应用管理/03-NestJS应用模块.md` §8） |
| **两后端图不一致** | api-py 存、api-ts 读，字段或文案对不上 | 校验器与文案须**逐条对齐**（规则顺序、遍历顺序、模板）；真源是 `packages/contract/error-messages.md` §3 |
| **归属失败返回 403** | 违反惯例 | 与 `/apps` 一致，一律 404 掩盖存在性（`02-应用管理/03-NestJS应用模块.md` §7） |

---

## 13. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **嵌套路由与「按资源拆独立模块」** | **首次教学于本篇**：`/apps/{id}/graph` 挂成独立 `GraphModule`/`GraphController`；同一 `@Controller('apps')` 前缀下挂多个控制器的两种等价写法与取舍（§6） |
| **业务规则校验与结构校验的分层**；纯函数 `validateGraph(graph): string[]` | **首次教学于本篇**：结构交给 `class-validator`，业务规则交给纯函数；含「为什么不用自定义校验装饰器」的取舍表，及其**可被阶段 4 执行引擎复用**的理由（§7） |
| **嵌套 DTO + `@ValidateNested({ each: true })` + `@Type(() => ...)`** | **首次教学于本篇**：`@Body()` 接收复杂对象、内嵌数组 DTO；class-transformer（`@Type`）为何是 `@ValidateNested` 生效的前提（§8） |
| **`ValidationPipe.exceptionFactory` 对 `ValidationError.children` 的递归收集** | **首次教学于本篇**：`collectMessages` 递归下钻，覆盖嵌套 DTO；对平铺 DTO 保持字节不变（§9） |
| **`null` 与「空图」语义 / 读取不校验·写入才校验** | **首次教学于本篇**：草稿 `null` → 合法空图；发布 `null` → 404；`EMPTY_GRAPH` 不参与读取校验（§10） |
| `Prisma` `Json?` 列存图（`graphJson` / `publishedGraphJson` / `publishedAt`） | 首次用于本篇；Prisma 机制见 `01-账号与认证/02-Prisma.md` |
| （未使用）`ParseUUIDPipe` | 与阶段 2 一致，路径参数 `id` 直接按 `string` 接收，本篇不讲解 |
