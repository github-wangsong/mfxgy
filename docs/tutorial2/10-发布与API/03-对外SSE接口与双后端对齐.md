# 03 · 对外 SSE 接口与双后端对齐（发布与 API）

> 阶段 10 · 第 3 步
>
> 做完：NestJS 的 `PublicModule` / `PublicController` / `EngineService.runPublished`；Python 的 `ApiKey` 映射、`api_keys` 服务与路由、`public.py`、`run_published`；两端 4xx 文案与 SSE 帧逐字节一致。
>
> **本篇面试考点**：为什么先认证再比对 `appId` · 为什么「key 不属于该应用」可能是 404 · 为什么 4xx 是普通 JSON 而不是 SSE · 为什么不用 NestJS 的 `@Sse()` · `@Res()` 手动写流要注意什么 · 对外运行为什么复用 `precheck` · `run_started` 为什么没有 `conversationId` · `hasConversation=false` 会拦下什么 · 同一把 key 为什么两端通用 · Python `StreamingResponse` 为什么要显式 `Content-Type` · `len()` 与 `[...str].length` 为什么一致 · 两端的已知边界差异是什么。

---

## 1. 对外接口的五步判断

```text
POST /public/apps/{appId}/run   { inputs }   +   X-API-Key: sk-...
  │
  ├─ 1. 取 key（X-API-Key 优先，其次 Authorization: Bearer）
  │       都没有 → 401 Missing API key
  ├─ 2. sha256(key) 查 api_keys，且 revoked_at 为空
  │       查不到 / 已撤销 → 401 Invalid API key
  ├─ 3. key.app_id === 路径 appId？
  │       否 → 查 app 是否存在：
  │             不存在 → 404 App not found
  │             存在   → 401 Invalid API key
  ├─ 4. 读 published_graph_json
  │       为 null → 400 App is not published
  └─ 5. precheck → 执行图 → SSE 流
```

### 1.1 为什么先认证再比对 `appId`

如果先查应用：

```text
查 app → 不存在 404 → 存在再认证
```

攻击者可以用 404 / 401 的差异枚举「哪些 appId 存在」。先认证后，**没有有效 key 的请求在第 2 步就被拦下**，根本走不到「查应用」。

但第 3 步又必须查应用，否则「拿 A 的 key 调不存在的 B」会被误报成 `Invalid API key`，而契约要求 404 `App not found`。所以顺序是：

```text
先证明「你有钥匙」→ 再告诉你「这扇门存不存在」
```

### 1.2 为什么「key 不属于该应用」可能是 404

```text
拿 A 的 key 调 B：
  B 存在   → 401 Invalid API key   （你有合法 key，但不是这扇门的）
  B 不存在 → 404 App not found     （门都不存在，与 key 无关）
```

这不是「泄露 B 是否存在」吗？是，但前提是**调用者已经持有一把合法 key**。能通过第 2 步的人已经是系统里的合法租户，告诉他「这个 appId 不存在」不构成对匿名攻击者的信息泄露。

### 1.3 4xx 为什么不是 SSE

```text
认证 / 预检失败 → 普通 JSON（Content-Type: application/json）
进入执行之后   → text/event-stream
```

原因：

- SSE 是「一条长连接 + 持续事件」，一旦开始写流，HTTP 状态码已经发出，无法再改成 400/401；
- 客户端（`curl`、SDK）需要根据 `Content-Type` 决定用「普通 JSON 解析」还是「SSE 解析」；
- 契约里 4xx 引用的是 `ErrorResponse`，只有 200 是 `text/event-stream`。

**状态码必须在第一帧之前确定**，这是流式接口的硬约束。

---

## 2. TS：请求体与控制器

### 2.1 DTO：只有 `inputs`

**完整文件路径：`apps/api-ts/src/public/dto/public-run.dto.ts`**

```ts
import { IsObject } from 'class-validator'

/**
 * POST /public/apps/{appId}/run 请求体 —— 对应契约 `PublicRunRequest`。
 *
 * **不支持会话**：没有 `conversationId` / `userMessage`；请求里带上它们会被
 * `forbidNonWhitelisted` 判为 `... should not exist`（400）。
 */
export class PublicRunRequestDto {
  /** 运行输入，键为输入变量名（内部键不校验，原样透传给引擎）。 */
  @IsObject()
  inputs!: Record<string, unknown>
}
```

`@IsObject()` 的边界：

- `{"inputs": {}}` → 通过；
- `{"inputs": []}` → 失败（数组不是 plain object）；
- `{"inputs": null}` → 失败；
- `{"inputs": {}, "conversationId": "x"}` → `conversationId should not exist`（全局 `forbidNonWhitelisted`）。

> 这就是契约层「砍字段」的实际效果：**不是运行期忽略，而是请求直接被拒**。

### 2.2 `PublicController` 全文

**完整文件路径：`apps/api-ts/src/public/public.controller.ts`**

```ts
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import type { Response } from 'express'

import { ApiKeysService } from '../api-keys/api-keys.service'
import { EngineService } from '../engine/engine.service'
import { formatSseFrame } from '../engine/events'
import { PrismaService } from '../prisma/prisma.service'
import { PublicRunRequestDto } from './dto/public-run.dto'

/**
 * 对外运行接口（阶段 10）：`POST /public/apps/{appId}/run`。
 *
 * **不用** `JwtAuthGuard`：鉴权改为 API Key（契约里的 `apiKeyAuth`）。
 * 支持的两种传法（`X-API-Key` 优先，其次 `Authorization: Bearer <key>`）。
 *
 * 校验顺序（见 error-messages.md §10）：
 * 1. 没有 key → 401 `Missing API key`；
 * 2. key 无效 / 已撤销 → 401 `Invalid API key`；
 * 3. key 不属于路径里的 `appId` → 401 `Invalid API key`
 *    （但若该 `appId` 根本不存在，则按「应用不存在」给 404 `App not found`）；
 * 4. 走 `EngineService.runPublished`：应用不存在 404、未发布 400。
 *
 * SSE 帧与 `POST /apps/{id}/run` 完全一致（同一套事件构造器与序列化）。
 */
@Controller('public/apps')
export class PublicController {
  constructor(
    private readonly apiKeysService: ApiKeysService,   // key 校验（02 篇）
    private readonly engineService: EngineService,     // 已发布快照执行
    private readonly prisma: PrismaService,            // 仅用于「应用是否存在」
  ) {}

  @Post(':appId/run')
  @HttpCode(200)                                       // 流式响应固定 200
  async run(
    @Param('appId') appId: string,                     // 路径里的应用 id
    @Headers('x-api-key') apiKeyHeader: string | undefined,   // 首选传法
    @Headers('authorization') authorization: string | undefined, // 兼容传法
    @Body() body: PublicRunRequestDto,                 // 只有 inputs
    @Res() response: Response,                         // 手动写 SSE，不走 Nest 的响应封装
  ): Promise<void> {
    // 1. 取明文 key；两种头都没有（或都是空白）→ 401
    const rawKey = extractApiKey(apiKeyHeader, authorization)
    if (rawKey === undefined) {
      throw new UnauthorizedException('Missing API key')
    }
    // 生产环境应在此处加限流（按 key / 应用维度），本阶段不实现。

    // 2. 哈希查找 + 未撤销校验；失败统一 401 `Invalid API key`
    const authenticated = await this.apiKeysService.authenticate(rawKey)
    if (authenticated.appId !== appId) {
      // 3. 不是这个应用的 key。先确认应用是否存在，避免把「应用不存在」误报成「key 无效」。
      const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
      if (app === null) {
        throw new NotFoundException('App not found')
      }
      throw new UnauthorizedException('Invalid API key')
    }

    // 4. 只读已发布快照；未发布会抛 400（在写任何 SSE 头之前）
    const events = await this.engineService.runPublished(appId, body.inputs)

    // 5. 这里才进入流式：头一旦发出，状态码就固定为 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()

    // 6. 逐帧写：与草稿运行共用 `formatSseFrame`
    for await (const event of events) {
      response.write(formatSseFrame(event))
    }
    response.end()
  }
}

/**
 * 取明文 key：`X-API-Key` 优先，其次 `Authorization: Bearer <key>`。
 * 空白值视为「未提供」（→ `Missing API key`）。
 */
function extractApiKey(
  apiKeyHeader: string | undefined,
  authorization: string | undefined,
): string | undefined {
  // `X-API-Key`：trim 后非空才算提供
  const fromApiKeyHeader = apiKeyHeader?.trim()
  if (fromApiKeyHeader !== undefined && fromApiKeyHeader !== '') {
    return fromApiKeyHeader
  }
  // `Authorization: Bearer <key>`：必须严格以 `Bearer ` 开头
  if (authorization?.startsWith('Bearer ') === true) {
    const token = authorization.slice(7).trim()   // 7 = 'Bearer '.length
    return token === '' ? undefined : token
  }
  return undefined
}
```

### 2.3 `extractApiKey` 的四个边界

| 输入 | 结果 | 原因 |
| --- | --- | --- |
| `X-API-Key: "  sk-abc  "` | `"sk-abc"` | trim 后非空 |
| `X-API-Key: "   "` | 继续看 `Authorization` | 空白视为未提供 |
| `Authorization: "Bearer sk-abc"` | `"sk-abc"` | 去掉前缀再 trim |
| `Authorization: "bearer sk-abc"` | `undefined` | 大小写敏感，必须 `Bearer ` |

为什么 `X-API-Key` 优先：两个头同时存在时，必须有一个确定规则；选更专用的头，`Authorization` 留给 JWT 或其他方案。

### 2.4 为什么不用 NestJS 的 `@Sse()`

NestJS 的 `@Sse()` 要求返回 `Observable<MessageEvent>`，它会把每个对象序列化成：

```text
data: {"data":...,"id":...,"type":...}\n\n
```

而本项目的 SSE 帧格式是：

```text
event: run_started
data: {"runId":"...","appId":"..."}

```

两者不兼容：

- `@Sse()` 把 `event` 放在 JSON 内部，不是 `event:` 行；
- 无法复用已有的 `formatSseFrame`；
- 草稿运行（阶段 4）已经用 `@Res()` 手写流，对外运行必须与它**逐字节一致**。

所以这里直接注入 Express 的 `Response`，手动 `write` / `end`。

### 2.5 `@Res()` 的三个注意点

1. **写了 `@Res()` 就等于接管响应**
   NestJS 不会再帮你序列化返回值；方法返回 `void`，必须自己 `end()`。

2. **错误必须在 `flushHeaders()` 之前抛出**
   一旦写了头，`throw new BadRequestException` 也改不了状态码，只会变成流里的一段错误文本。

3. **`@HttpCode(200)` 仍然要写**
   `POST` 默认 201；这里是流式读取，语义是 200。

---

## 3. TS：`runPublished`

### 3.1 代码

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（阶段 10 增量）

```ts
  /**
   * 对外运行（阶段 10）：只读已发布快照，不支持会话。
   *
   * 与 `run()` 的差异只有三处：
   * 1. 图来自 `app.publishedGraphJson`，不是 `app.graphJson`；
   * 2. `precheck(..., false)`：没有会话，`useHistory` 节点会预检失败；
   * 3. `execute()` 不传 `conversation`，`run_started` 不带 `conversationId`。
   */
  async runPublished(
    appId: string,
    inputs: Record<string, unknown>,
  ): Promise<AsyncGenerator<RunEvent>> {
    // 1. 应用必须存在（正常情况下 PublicController 已确认过，这里兜底）
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    if (app === null) {
      throw new NotFoundException('App not found')
    }

    // 2. 没有发布过 → 400，不是 404（应用存在，只是没有可运行的快照）
    if (app.publishedGraphJson === null) {
      throw new BadRequestException('App is not published')
    }

    // 3. JSONB → 强类型图；快照在发布时已校验过，这里不再重复校验结构
    const graph = app.publishedGraphJson as unknown as Graph

    // 4. 预检：knowledge 节点归属取应用所有者；hasConversation=false
    await this.precheck(app.ownerId, graph, false)

    // 5. 执行：不传 conversation
    return this.execute(appId, graph, inputs)
  }
```

### 3.2 与草稿运行的四个差异

| 维度 | `run()`（草稿） | `runPublished()`（对外） |
| --- | --- | --- |
| 图来源 | `app.graphJson` | `app.publishedGraphJson` |
| 未保存/未发布 | 草稿可以为空图 | `publishedGraphJson === null` → 400 |
| `precheck` 的 `hasConversation` | 看请求是否带 `conversationId` | 恒为 `false` |
| `execute` 的 `conversation` | 可能传 | 不传 |
| `run_started` | 可能带 `conversationId` | **不带** |
| 写 `messages` 表 | 可能写 | 不写 |

### 3.3 `run_started` 为什么没有 `conversationId`

`execute` 的签名是：

```ts
private async *execute(
  appId: string,
  graph: Graph,
  inputs: Record<string, unknown>,
  conversation?: ConversationContext,       // 可选
): AsyncGenerator<RunEvent> {
  const queue = new RunEventQueue()
  const runId = randomUUID()
  queue.emit(runStarted(runId, appId, conversation?.id))   // undefined → 省略键
  void this.runGraph(graph, inputs, queue, runId, conversation)
  yield* queue.drain()
}
```

`runStarted` 的实现：

```ts
/** 构造 `run_started` 事件（无会话时不带 `conversationId` 键）。 */
export function runStarted(runId: string, appId: string, conversationId?: string): RunEvent {
  return conversationId === undefined
    ? { event: 'run_started', data: { runId, appId } }              // 对外运行走这里
    : { event: 'run_started', data: { runId, appId, conversationId } } // 草稿 + 会话
}
```

注意是**省略键**，不是 `conversationId: null`。前端/测试如果用「键是否存在」判断会话，`null` 会误判成「有会话但 id 为空」。

### 3.4 `hasConversation=false` 会拦下什么

`precheck` 里的 `validateNodeData(graph, hasConversation)` 有一条规则：

```text
llm.useHistory === true 且没有会话
  → 400 `llm node {nodeId} useHistory requires a conversation`
```

对外运行恒为 `false`，所以：

- 图里没有任何 `useHistory` 节点 → 正常执行；
- 图里有 `useHistory: true` 的节点 → 运行前就 400，不会执行到一半才失败。

这是一个**发布期无法发现、运行期才暴露**的问题：

- 发布只校验图结构（节点/边/字段），不校验「运行时会话」；
- 同一张图在草稿运行（带会话）能跑，在对外运行（无会话）会 400；
- 所以发布前的自测应该用**无会话**方式跑一次，或者用对外接口跑一次。

---

## 4. TS：`PublicModule`

**完整文件路径：`apps/api-ts/src/public/public.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { ApiKeysModule } from '../api-keys/api-keys.module'
import { EngineModule } from '../engine/engine.module'
import { PublicController } from './public.controller'

/**
 * 对外运行模块（阶段 10）。`PrismaService` 来自全局 `PrismaModule`；
 * 复用 `ApiKeysService`（key 校验）与 `EngineService`（已发布快照执行）。
 */
@Module({
  imports: [ApiKeysModule, EngineModule],   // 两个 Service 都从各自模块导出
  controllers: [PublicController],
})
export class PublicModule {}
```

依赖图：

```text
PublicController
   ├─ ApiKeysService   ← ApiKeysModule.exports
   ├─ EngineService    ← EngineModule.exports
   └─ PrismaService    ← 全局 PrismaModule
```

`ApiKeysModule` 在 02 篇已经 `exports: [ApiKeysService]`；`EngineModule` 在阶段 4 已经 `exports: [EngineService]`。这里不需要重新 `providers`，否则会创建第二个实例。

---

## 5. Python：`ApiKey` 模型

**完整文件路径：`apps/api-py/app/models/api_key.py`**

```python
"""`api_keys` 表模型（阶段 10）。

重要：该表的 DDL 由 TS 侧 Prisma 迁移拥有
（`apps/api-ts/prisma/migrations/20261023115759_add_api_keys`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。

安全要点：表里只存 `sha256(明文 key)`（`key_hash`，唯一）与 `key_prefix`；
明文 key 只在创建响应里返回一次。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ApiKey(Base):
    """API Key 行：一个应用可以有多把，一把 key 只属于一个应用。"""

    __tablename__ = "api_keys"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    # 所属应用：级联删除；索引支撑「列出某应用的 key」
    app_id: Mapped[str] = mapped_column(
        String, ForeignKey("apps.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 所属用户：冗余，便于单表做归属校验
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # 人读名称
    name: Mapped[str] = mapped_column(String, nullable=False)
    # 明文前 11 字符（`sk-` + 8 hex），仅用于列表辨识
    key_prefix: Mapped[str] = mapped_column(String, nullable=False)
    # sha256(明文 key) 的 64 位十六进制；唯一
    key_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    # 创建时间：数据库默认 CURRENT_TIMESTAMP（与 Prisma 的 @default(now()) 对应）
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # 物理列均为 timestamp(3)（无时区），写入时按 UTC 取 naive 值
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    # 多对一：删除应用 / 用户时，key 一并删除（数据库层面已由 FK 保证）
    app: Mapped["App"] = relationship("App", back_populates="api_keys")
    owner: Mapped["User"] = relationship("User", back_populates="api_keys")
```

三个「不做」：

| 不做 | 原因 |
| --- | --- |
| 不用 `server_default=text("gen_random_uuid()")` | 数据库列没有默认值；Prisma 在客户端生成 |
| 不建表 / 不写 Alembic | 表由 Prisma 迁移拥有，Python 只映射 |
| 不把 `key_hash` 当主键 | 主键是 `id`；哈希只做唯一索引 |

---

## 6. Python：`api_keys` 服务

**完整文件路径：`apps/api-py/app/api_keys/service.py`**

```python
"""API Key 读写与校验（阶段 10）。

与 api-ts 的 `apps/api-ts/src/api-keys/api-keys.service.ts` 对齐：
- 只存哈希：`sha256(明文 key)` 落 `key_hash`，明文只在创建响应返回一次；
- `prefix` 为明文 key 前 11 个字符（列表展示用，泄露它无法还原 key）；
- 撤销只置 `revoked_at`，不物理删除，已撤销的 key 立即失效；
- 归属校验与 `/apps` 一致：查不到、或不属于当前用户，一律 404（不泄露存在性）。

错误文案见 `packages/contract/error-messages.md` §10，必须与 api-ts 逐字节一致。
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.api_key import ApiKey
from app.models.app import App

# key 名称长度上限（契约 `CreateApiKeyRequest.name.maxLength`）
MAX_API_KEY_NAME_LENGTH = 60
# 明文 key 前 11 个字符（`sk-` + 8 位十六进制）
KEY_PREFIX_LENGTH = 11


def _bad_request(message: str) -> HTTPException:
    """构造 400；`detail` 会被 `register_error_handlers` 归一成 `message`。"""
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _not_found(message: str) -> HTTPException:
    """构造 404。"""
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)


def hash_key(key: str) -> str:
    """`sha256(明文 key)` 的十六进制摘要（64 字符，与 TS 的 `createHash` 同算法）。"""
    return hashlib.sha256(key.encode()).hexdigest()
```

`hashlib.sha256(key.encode())` 与 TS 的 `createHash('sha256').update(key)`：

- 默认都是 UTF-8 编码；
- 都输出 32 字节，`hexdigest()` / `digest('hex')` 都转成 64 位小写十六进制；
- 同一把 key 在两端得到**完全相同**的 `key_hash`。

```python
def _find_owned_app(db: Session, owner_id: str, app_id: str) -> App:
    """应用必须存在且属于当前用户；否则 404 `App not found`。"""
    app = db.get(App, app_id)
    if app is None or app.owner_id != owner_id:
        raise _not_found("App not found")
    return app


def to_response_fields(api_key: ApiKey) -> dict[str, Any]:
    """对外视图的字段（`prefix` 而非 key；时间由路由层的序列化器统一成 ISO-Z）。"""
    return {
        "id": api_key.id,
        "appId": api_key.app_id,
        "name": api_key.name,
        "prefix": api_key.key_prefix,      # 字段改名：key_prefix → prefix
        "createdAt": api_key.created_at,
        "lastUsedAt": api_key.last_used_at,
        "revokedAt": api_key.revoked_at,
    }
```

### 6.1 `create`

```python
def create(
    db: Session, owner_id: str, app_id: str, name: str | None
) -> tuple[dict[str, Any], str]:
    """`POST /apps/{id}/api-keys`：校验归属 → 重名 → 生成 → 存哈希。

    返回 `(视图字段, 一次性明文 key)`。名称的「缺失 / 空」校验顺序与 TS 的
    DTO（`@IsString` + `@MinLength(1)`，在进入服务前执行）保持一致。
    """
    # 缺失（`null`）与「类型不对」要分开：项目约定缺失统一报 `{field} is required`
    # （与 `/apps`、`/knowledge-bases` 两端一致），只有存在但类型不符才报 must be a string。
    if name is None:
        raise _bad_request("name is required")
    if not isinstance(name, str):
        raise _bad_request("name must be a string")
    if len(name) < 1:
        raise _bad_request("name must be at least 1 characters")

    # 1. 应用必须存在且属于当前用户
    _find_owned_app(db, owner_id, app_id)

    # 2. 超过 60 才是 §10 的专用文案（不能用 DTO 的 maxLength，否则文案会落到 §1.1）
    if len(name) > MAX_API_KEY_NAME_LENGTH:
        raise _bad_request("API key name is too long")

    # 3. 只有「未撤销」的重名才算冲突：撤销后可复用同名，便于轮换
    duplicate = db.scalar(
        select(ApiKey.id)
        .where(ApiKey.app_id == app_id, ApiKey.name == name, ApiKey.revoked_at.is_(None))
        .limit(1)
    )
    if duplicate is not None:
        raise _bad_request("API key name already exists")

    # 4. 生成明文 key：`secrets.token_hex(16)` = 16 字节 → 32 位十六进制
    key = f"sk-{secrets.token_hex(16)}"

    # 5. 落库：只存 prefix 与哈希；id 由应用侧生成（数据库无默认）
    api_key = ApiKey(
        id=str(uuid.uuid4()),
        app_id=app_id,
        owner_id=owner_id,
        name=name,
        key_prefix=key[:KEY_PREFIX_LENGTH],
        key_hash=hash_key(key),
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    # 6. 唯一的明文出口
    return to_response_fields(api_key), key
```

`len(name)` 与 TS 的 `[...name].length`：

| 字符串 | `len()` | `[...str].length` | `str.length` |
| --- | --- | --- | --- |
| `"abc"` | 3 | 3 | 3 |
| `"中文"` | 2 | 2 | 2 |
| `"😀"` | 1 | 1 | **2**（UTF-16 代理对） |

Python 的 `len` 按**码点**计数，JS 的 `[...str].length` 也按码点计数，所以两端一致；如果 TS 用 `name.length`，emoji 会多算 1，导致「120 个 emoji」在 TS 被拒、在 Python 通过。02 篇的 `create` 用的是 `[...name].length`，这里保持一致。

> **重名检查的竞态**：`select` 与 `commit` 之间没有锁，两个并发请求可能都查不到重名、都插入成功。数据库层没有 `(app_id, name)` 唯一约束（因为「已撤销可复用同名」无法用普通唯一索引表达）。本阶段接受这个窗口；生产可以用部分唯一索引 `WHERE revoked_at IS NULL` 解决。

### 6.2 `list` 与 `revoke`

```python
def list_api_keys(db: Session, owner_id: str, app_id: str) -> list[dict[str, Any]]:
    """`GET /apps/{id}/api-keys`：全部 key（含已撤销的），按创建时间倒序。"""
    _find_owned_app(db, owner_id, app_id)
    api_keys = db.scalars(
        select(ApiKey).where(ApiKey.app_id == app_id).order_by(ApiKey.created_at.desc())
    ).all()
    return [to_response_fields(api_key) for api_key in api_keys]


def revoke(db: Session, owner_id: str, key_id: str) -> None:
    """`DELETE /api-keys/{id}`：撤销（置 `revoked_at`），找不到/不属于自己一律 404。"""
    api_key = db.get(ApiKey, key_id)
    if api_key is None or api_key.owner_id != owner_id:
        raise _not_found("API key not found")
    # 列在 PG 上为 timestamp（无时区）；写 naive-UTC，读取时 iso_z 按 UTC 解释
    api_key.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
```

`created_at.desc()` 对应 TS 的 `orderBy: { createdAt: 'desc' }`。两端都没有分页：key 数量通常是个位数，不需要 `limit/offset`。

### 6.3 `authenticate`

```python
def authenticate(db: Session, raw_key: str) -> dict[str, str]:
    """校验明文 key：哈希匹配且未撤销才算通过，并更新 `last_used_at`。

    返回 `{"appId": ..., "ownerId": ...}`。与 TS 一致：**先**更新 `last_used_at`，
    再由调用方比对路径里的 `appId`（因此「拿 A 的 key 调 B」也会刷新该 key 的使用时间）。
    """
    # 1. 哈希精确查找（key_hash 上有唯一索引）
    api_key = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_key(raw_key)))

    # 2. 不存在 / 已撤销：同一个 401 文案
    if api_key is None or api_key.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
        )

    # 3. 刷新最近使用时间（naive UTC）
    api_key.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    # 4. 返回归属；路径 appId 的比对在 `public.py` 里做
    return {"appId": api_key.app_id, "ownerId": api_key.owner_id}
```

Python 用 `db.scalar(select(...))` 而不是 `findUnique`：

- SQLAlchemy 没有「唯一查找」的专用 API，`select().where()` + `scalar()` 是等价写法；
- 生成的 SQL 是 `SELECT ... FROM api_keys WHERE key_hash = $1`，走唯一索引；
- 如果 `key_hash` 没有唯一约束，`scalar()` 在命中多行时只返回第一行而不报错——数据库的唯一索引是最后的保证。

---

## 7. Python：`api_keys` 路由

**完整文件路径：`apps/api-py/app/api/api_keys.py`**

```python
"""`/apps/{id}/api-keys` 与 `/api-keys/{id}` 路由（阶段 10）。

契约见 packages/contract/openapi.yaml；错误文案见 error-messages.md §10。
管理类接口用 JWT 鉴权（复用 `get_current_user`）；对外运行走 API Key，
见 `app/api/public.py`。

创建响应附带**一次性明文 key**；列表响应只有 `prefix`，**没有** `key` 字段。
"""

from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, field_serializer
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.api_keys import service
from app.models.user import User
from app.timefmt import iso_z

router = APIRouter(tags=["api-keys"])       # 无 prefix：两个资源前缀在装饰器里写全


class ApiKeyResponse(BaseModel):
    """对应契约 `ApiKeyResponse`（**无**明文 key）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    appId: str
    name: str
    prefix: str
    createdAt: datetime
    lastUsedAt: datetime | None
    revokedAt: datetime | None

    @field_serializer("createdAt", "lastUsedAt", "revokedAt")
    def _serialize_timestamps(self, value: datetime | None) -> str | None:
        """时间统一成 UTC + 毫秒 + Z（与 TS 的 `toISOString()` 一致）。"""
        return None if value is None else iso_z(value)


class ApiKeyListResponse(BaseModel):
    """对应契约 `ApiKeyListResponse`。"""

    model_config = ConfigDict(extra="forbid")

    items: list[ApiKeyResponse]


class CreateApiKeyRequest(BaseModel):
    """对应契约 `CreateApiKeyRequest`。

    `name` 允许缺省为 `None`：缺失时的 `name is required` 与空串时的
    `name must be at least 1 characters` 都由服务层给出（与 api-ts 的 DTO 文案一致）。
    上限 60 也由服务层给出 §10 的专用文案，故此处**不**加 `max_length`。
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class CreateApiKeyResponse(ApiKeyResponse):
    """对应契约 `CreateApiKeyResponse`（含一次性明文 key）。"""

    key: str


@router.get(
    "/apps/{id}/api-keys", response_model=ApiKeyListResponse, operation_id="listApiKeys"
)
def list_api_keys(
    id: str,
    current_user: User = Depends(get_current_user),   # JWT 当前用户
    db: Session = Depends(get_db),                     # 请求级 session
) -> ApiKeyListResponse:
    return ApiKeyListResponse(
        items=[
            ApiKeyResponse(**fields)
            for fields in service.list_api_keys(db, current_user.id, id)
        ]
    )


@router.post(
    "/apps/{id}/api-keys",
    response_model=CreateApiKeyResponse,
    status_code=status.HTTP_201_CREATED,                # 契约要求 201
    operation_id="createApiKey",
)
def create_api_key(
    id: str,
    body: CreateApiKeyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CreateApiKeyResponse:
    fields, key = service.create(db, current_user.id, id, body.name)
    return CreateApiKeyResponse(**fields, key=key)     # 明文只在这里出现


@router.delete(
    "/api-keys/{id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="revokeApiKey"
)
def revoke_api_key(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    service.revoke(db, current_user.id, id)
```

三个对齐点：

| 点 | TS | Python |
| --- | --- | --- |
| 鉴权 | `@UseGuards(JwtAuthGuard)` | `Depends(get_current_user)` |
| 201 | `@Post` 默认 | `status.HTTP_201_CREATED` |
| 204 | `@HttpCode(204)` | `status.HTTP_204_NO_CONTENT` + 返回 `None` |
| 额外字段 | 全局 `forbidNonWhitelisted` | `ConfigDict(extra="forbid")` |
| 时间 | `.toISOString()` | `field_serializer` + `iso_z` |

---

## 8. Python：`public.py`

**完整文件路径：`apps/api-py/app/api/public.py`**

```python
"""`POST /public/apps/{appId}/run` 路由（阶段 10）。

契约见 packages/contract/openapi.yaml，鉴权方案为 `apiKeyAuth`（**不用** JWT）。
取 key 的两种传法与 api-ts 的 `PublicController.extractApiKey` 完全一致：
`X-API-Key` 优先（去掉首尾空白后非空才算提供），其次 `Authorization: Bearer <key>`。

校验顺序（见 error-messages.md §10）：
1. 没有 key → 401 `Missing API key`；
2. 哈希不匹配 / 已撤销 → 401 `Invalid API key`；
3. key 不属于路径里的 `appId`：应用不存在 → 404 `App not found`，存在 → 401 `Invalid API key`；
4. 走引擎的 `run_published`：应用不存在 404、未发布 400 `App is not published`。

SSE 帧与 `POST /apps/{id}/run` **完全一致**（同一套事件构造器与序列化）。
"""

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api_keys import service
from app.engine.engine import run_published
from app.models.app import App

router = APIRouter(prefix="/public", tags=["public"])


class PublicRunRequest(BaseModel):
    """对应契约 `PublicRunRequest`：**只有 `inputs`**（不支持会话）。"""

    model_config = ConfigDict(extra="forbid")   # 多余字段 400

    inputs: dict[str, Any]


def _extract_api_key(x_api_key: str | None, authorization: str | None) -> str | None:
    """`X-API-Key` 优先，其次 `Authorization: Bearer <key>`；空白值视为未提供。"""
    if x_api_key is not None:
        trimmed = x_api_key.strip()
        if trimmed != "":
            return trimmed
    if authorization is not None and authorization.startswith("Bearer "):
        token = authorization[7:].strip()       # 7 = len("Bearer ")
        return token if token != "" else None
    return None


@router.post("/apps/{app_id}/run", operation_id="runPublicApp")
async def run_public_app(
    app_id: str,
    body: PublicRunRequest,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # 1. 取 key；两种头都没有 → 401
    raw_key = _extract_api_key(x_api_key, authorization)
    if raw_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing API key"
        )

    # 2. 先认证（并刷新 last_used_at），再比对路径里的 appId
    authenticated = service.authenticate(db, raw_key)

    # 3. key 不属于该应用
    if authenticated["appId"] != app_id:
        # 应用不存在 → 404；存在 → 401（避免把「不存在」误报成「key 无效」）
        if db.get(App, app_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="App not found"
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
        )

    # 4. 只读已发布快照；未发布会在返回 StreamingResponse 之前抛 400
    return StreamingResponse(
        await run_published(db, app_id, body.inputs),
        media_type="text/event-stream",
        # 显式给出 content-type，避免 Starlette 追加 `; charset=utf-8`，与 api-ts 的响应头对齐
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
```

### 8.1 为什么 `StreamingResponse` 要显式写 `Content-Type`

Starlette 的 `StreamingResponse(media_type="text/event-stream")` 会生成：

```text
Content-Type: text/event-stream; charset=utf-8
```

而 Express 的 `response.setHeader('Content-Type', 'text/event-stream')` 是：

```text
Content-Type: text/event-stream
```

两端响应头不一致，跨端对比脚本如果检查 `Content-Type` 就会失败。在 `headers` 里显式给 `Content-Type` 会覆盖 Starlette 的默认拼接，得到与 TS 一致的值。

### 8.2 `db` 在流式响应期间的生命周期

```text
请求进入
  → get_db() 创建 Session
  → run_published() 预检（同步 SQL）
  → 返回 StreamingResponse（生成器持有 db）
  → 流式迭代：_run_graph 后台任务继续用 db
  → 流结束
  → get_db() 的 finally: db.close()
```

FastAPI 的依赖清理发生在**响应完成之后**，所以流式期间 `db` 仍然可用。这与阶段 9 的「后台任务复用请求作用域 session」是同一类约束：

- 不要在流结束后再启动「比响应活得更久」的后台任务；
- 本项目 `run_stream` 在生成器结束时 `await task`，保证任务先结束、连接才归还。

---

## 9. Python：`run_published`

**完整文件路径：`apps/api-py/app/engine/engine.py`**（阶段 10 增量）

```python
async def run_published(
    db: Session, app_id: str, inputs: dict[str, Any]
) -> AsyncGenerator[str, None]:
    """对外运行：只读已发布快照（`published_graph_json`），不带会话。

    与 api-ts 的 `EngineService.runPublished` 对齐：应用不存在 → 404
    `App not found`；未发布 → 400 `App is not published`；预检复用 `precheck`
    （knowledge 节点归属取**应用所有者**），保证事件序列与草稿运行完全一致。
    对外运行不支持会话：`has_conversation=False`（`useHistory` 节点会预检失败）。
    """
    # 1. 应用必须存在
    app = db.get(App, app_id)
    if app is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")

    # 2. 未发布：400（应用存在，只是没有快照）
    if app.published_graph_json is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="App is not published"
        )

    # 3. 预检：knowledge 节点归属取应用所有者；has_conversation=False
    graph = app.published_graph_json
    errors = await precheck(db, app.owner_id, graph, False)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors)
        )

    # 4. 执行：不传 conversation
    return run_stream(app.id, graph, inputs, db)
```

`run_stream` 的关键一行：

```python
await queue.put(
    run_started(run_id, app_id, conversation["id"] if conversation is not None else None)
)
```

`conversation=None` → `run_started` 的第三个参数为 `None` → 事件构造器省略 `conversationId` 键（与 TS 的 `runStarted` 同一规则）。

---

## 10. Python：`main.py` 注册

**完整文件路径：`apps/api-py/app/main.py`**（阶段 10 增量）

```python
from app.api.api_keys import router as api_keys_router
from app.api.public import router as public_router

app.include_router(api_keys_router)   # 3 个管理接口（JWT）
app.include_router(public_router)     # 1 个对外接口（API Key）
```

注册顺序不影响路由匹配：`api_keys` 的路径是 `/apps/{id}/api-keys` 与 `/api-keys/{id}`，`public` 的路径是 `/public/apps/{appId}/run`，没有前缀冲突。

---

## 11. 双后端对齐的七个点

| # | 对齐点 | TS | Python | 必须逐字节 |
| --- | --- | --- | --- | --- |
| 1 | key 格式 | `sk-` + `randomBytes(16).toString('hex')` | `sk-` + `secrets.token_hex(16)` | 长度 35、前缀 `sk-` |
| 2 | 哈希 | `createHash('sha256').update(key).digest('hex')` | `hashlib.sha256(key.encode()).hexdigest()` | 64 位小写 hex |
| 3 | prefix | `key.slice(0, 11)` | `key[:11]` | 11 字符 |
| 4 | 校验顺序 | 五步 | 五步 | 顺序一致 |
| 5 | 文案 | §10 七条 | §10 七条 | ✅ |
| 6 | SSE 帧 | `formatSseFrame` | `format_sse_frame` | `event:` + `data:` + 空行 |
| 7 | 时间戳 | `.toISOString()` | `iso_z()` | 24 字符、毫秒、Z |

### 11.1 同一把 key 为什么两端通用

因为两端操作**同一个数据库**，且哈希算法一致：

```text
TS 创建：key = sk-abc... → sha256 → key_hash = "9f2c..."
Python 认证：收到 sk-abc... → sha256 → "9f2c..." → 命中同一行
```

只要满足：

- 编码一致（UTF-8）；
- 算法一致（SHA-256）；
- 输出格式一致（小写十六进制，不带 `0x`）；

两端就能互相认证。这也是为什么 `hash_key` / `hashKey` 必须用**标准库**，不能自己做「加盐」或「截断」。

### 11.2 已知边界差异：`name` 显式 `null`

这是两端目前**唯一**没有完全对齐的边界：

| 请求体 | TS | Python |
| --- | --- | --- |
| `{}` | `name is required` | `name is required` |
| `{"name": ""}` | `name must be at least 1 characters` | `name must be at least 1 characters` |
| `{"name": null}` | `name must be a string`（`@IsString` 失败） | `name is required`（`name is None`） |

原因：Python 的 `name: str | None = None` 无法区分「字段缺失」与「显式 null」——两者都变成 `None`。如果要对齐，需要：

```python
# 方案 A：用 model_validator(mode='before') 检查原始 dict 是否包含 name
@model_validator(mode="before")
@classmethod
def _check_name_present(cls, data: Any) -> Any:
    if isinstance(data, dict) and "name" in data and data["name"] is None:
        raise ValueError("name must be a string")
    return data
```

或者方案 B：把字段声明为必填 `name: str`，让 Pydantic 对 `null` 直接报类型错误（但缺失文案会变成 Pydantic 的默认文案，需要 `errors.py` 映射）。

本阶段**接受这个差异**：契约里 `name` 是 `required` 且类型是 `string`，`null` 本来就不是合法值；两端都返回 400，只是文案不同。验收矩阵不覆盖 `{"name": null}`。

> **面试考点 · 跨语言对齐为什么要列「已知差异」？**
> 因为「完全一致」是一个需要证明的命题。列出差异有三个好处：
>
> 1. 测试知道哪些用例不该断言逐字节；
> 2. 后续修复有明确入口（不是「好像哪里不对」）；
> 3. 面试时能说清「哪些是设计选择，哪些是待办」。

### 11.3 `last_used_at` 的更新时机

两端都是「认证通过后立即更新，再比对 appId」：

```text
拿 A 的 key 调 B（B 存在）
  → 401 Invalid API key
  → 但 A 的 last_used_at 已经被刷新
```

这是**有意的**：认证和授权是两步；key 本身是合法的，只是没有这个应用的权限。如果希望「无权限的调用不刷新」，要把 `last_used_at` 的更新移到 appId 比对之后——但那样 `authenticate` 就要知道 `appId`，职责变重。本阶段保持「认证即刷新」。

---

## 12. 验证

> 前置：数据库 `healthy`，api-ts `:3001`，api-py `:8000`，mock-llm `:11435`。
> 两端 `.env` 的 `LLM_*` 四项保持一致。

```powershell
# 终端 1
pnpm --filter @mini-dify/api-ts start:dev

# 终端 2（cwd = apps/api-py）
uv run uvicorn app.main:app --port 8000 --reload

# 终端 3
node tools/mock-llm/server.mjs
```

### 12.1 建应用与 key（TS）

```powershell
# 登录
$tsLogin = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType "application/json" `
  -Body '{"email":"alice@example.com","password":"password123"}'
$tsToken = $tsLogin.accessToken

# 建应用
$app = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps `
  -Headers @{ Authorization = "Bearer $tsToken" } `
  -ContentType "application/json" `
  -Body '{"name":"public-demo"}').id

# 建 key（明文只出现这一次）
$key = (Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/$app/api-keys" `
  -Headers @{ Authorization = "Bearer $tsToken" } `
  -ContentType "application/json" `
  -Body '{"name":"demo"}').key

$key.Length        # 35
```

### 12.2 未发布：400 普通 JSON

```powershell
curl.exe -i -s -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "X-API-Key: $key" `
  -H "Content-Type: application/json" `
  -d '{"inputs":{"topic":"hello"}}'
```

预期：

```text
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"statusCode":400,"message":"App is not published","error":"Bad Request"}
```

关键：`Content-Type` 是 `application/json`，**不是** `text/event-stream`。

### 12.3 发布一张最小图

```powershell
# 图：start → llm → end；llm 的 prompt 引用 inputs.topic
$graph = @'
{
  "version": "1",
  "nodes": [
    { "id": "s1", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "inputs": [{ "name": "topic", "type": "string", "required": true }] } },
    { "id": "l1", "type": "llm", "position": { "x": 1, "y": 0 },
      "data": { "title": "回答", "model": "", "prompt": "{{ inputs.topic }}", "system": "" } },
    { "id": "e1", "type": "end", "position": { "x": 2, "y": 0 },
      "data": { "outputs": [{ "name": "answer", "value": "{{ l1.text }}" }] } }
  ],
  "edges": [
    { "id": "e-s-l", "source": "s1", "target": "l1" },
    { "id": "e-l-e", "source": "l1", "target": "e1" }
  ]
}
'@

# 无 BOM 写入
[System.IO.File]::WriteAllText("$PWD\_p10_graph.json", $graph, [System.Text.UTF8Encoding]::new($false))

# 保存草稿 + 发布
curl.exe -s -X PUT "http://localhost:3001/apps/$app/graph" `
  -H "Authorization: Bearer $tsToken" -H "Content-Type: application/json" `
  --data-binary "@_p10_graph.json"

curl.exe -s -X POST "http://localhost:3001/apps/$app/graph/publish" `
  -H "Authorization: Bearer $tsToken"
```

预期发布响应包含 `publishedAt` 与 `graph`。

### 12.4 发布后：TS 对外运行

```powershell
curl.exe -s -N -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "X-API-Key: $key" `
  -H "Content-Type: application/json" `
  -d '{"inputs":{"topic":"hello"}}'
```

预期事件序列（`runId` / `elapsedMs` 会变）：

```text
event: run_started
data: {"runId":"...","appId":"..."}

event: node_started
data: {"nodeId":"s1","nodeType":"start"}

event: node_finished
data: {"nodeId":"s1","nodeType":"start","outputs":{...}}

event: node_started
data: {"nodeId":"l1","nodeType":"llm"}

event: token
data: {"nodeId":"l1","text":"echo: "}

event: token
data: {"nodeId":"l1","text":"hello"}

event: node_finished
data: {"nodeId":"l1","nodeType":"llm","outputs":{"text":"echo: hello",...}}

event: node_started
data: {"nodeId":"e1","nodeType":"end"}

event: node_finished
data: {"nodeId":"e1","nodeType":"end","outputs":{...}}

event: run_finished
data: {"outputs":{"answer":"echo: hello"},"elapsedMs":...}
```

三个断言：

```powershell
$raw = curl.exe -s -N -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "X-API-Key: $key" -H "Content-Type: application/json" `
  -d '{"inputs":{"topic":"hello"}}'

# 1. run_started 不带 conversationId
($raw -split "`n" | Select-String 'event: run_started' -Context 0,1).Context.PostContext

# 2. 有 token 事件（真实流式，不是一次性返回）
($raw -split "`n" | Select-String '^event: token$').Count

# 3. 最终输出
($raw -split "`n" | Select-String '^event: run_finished$' -Context 0,1).Context.PostContext
```

### 12.5 同一把 key 调 Python

```powershell
curl.exe -s -N -X POST "http://localhost:8000/public/apps/$app/run" `
  -H "X-API-Key: $key" `
  -H "Content-Type: application/json" `
  -d '{"inputs":{"topic":"hello"}}'
```

预期与 12.4 的事件序列一致（`runId` / `elapsedMs` 除外）。

> 如果这里返回 401，说明两端哈希不一致——检查 Python 的 `hashlib.sha256(key.encode())` 与 TS 的编码是否都是 UTF-8。

### 12.6 三类 401 / 404

```powershell
# 1. 不带 key → 401 Missing API key
curl.exe -s -i -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "Content-Type: application/json" -d '{"inputs":{}}'

# 2. 乱写 key → 401 Invalid API key
curl.exe -s -i -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "X-API-Key: sk-00000000000000000000000000000000" `
  -H "Content-Type: application/json" -d '{"inputs":{}}'

# 3. 拿 A 的 key 调不存在的 app → 404 App not found
curl.exe -s -i -X POST "http://localhost:3001/public/apps/not-exist/run" `
  -H "X-API-Key: $key" `
  -H "Content-Type: application/json" -d '{"inputs":{}}'

# 4. 拿 A 的 key 调 B（B 存在）→ 401 Invalid API key
$appB = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps `
  -Headers @{ Authorization = "Bearer $tsToken" } `
  -ContentType "application/json" `
  -Body '{"name":"public-demo-b"}').id
curl.exe -s -i -X POST "http://localhost:3001/public/apps/$appB/run" `
  -H "X-API-Key: $key" `
  -H "Content-Type: application/json" -d '{"inputs":{}}'
```

四条都必须返回 `application/json`，不能是 SSE。

### 12.7 草稿改动不影响线上

```powershell
# 1. 把草稿的 prompt 改成 "{{ inputs.topic }} (draft B)"，但不发布
$draftB = $graph.Replace('"prompt": "{{ inputs.topic }}"', '"prompt": "{{ inputs.topic }} (draft B)"')
[System.IO.File]::WriteAllText("$PWD\_p10_graph_b.json", $draftB, [System.Text.UTF8Encoding]::new($false))
curl.exe -s -X PUT "http://localhost:3001/apps/$app/graph" `
  -H "Authorization: Bearer $tsToken" -H "Content-Type: application/json" `
  --data-binary "@_p10_graph_b.json"

# 2. 对外运行：仍然是旧快照的 "echo: hello"
curl.exe -s -N -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "X-API-Key: $key" -H "Content-Type: application/json" `
  -d '{"inputs":{"topic":"hello"}}'

# 3. 再发布后，才变成 "echo: hello (draft B)"
curl.exe -s -X POST "http://localhost:3001/apps/$app/graph/publish" `
  -H "Authorization: Bearer $tsToken"
```

这是「发布 = 复制」的直接证据：**草稿变了，线上不变**。

### 12.8 `useHistory` 在对外运行预检失败

把 `l1.data` 改成：

```json
{ "title": "回答", "model": "", "prompt": "{{ inputs.topic }}", "system": "", "useHistory": true }
```

保存并发布，然后对外运行：

```powershell
curl.exe -s -i -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "X-API-Key: $key" `
  -H "Content-Type: application/json" -d '{"inputs":{"topic":"hello"}}'
```

预期：

```text
HTTP/1.1 400 Bad Request
{"statusCode":400,"message":"llm node l1 useHistory requires a conversation","error":"Bad Request"}
```

注意：**发布本身成功**，因为发布只校验图结构；错误发生在运行前的 `precheck`。这验证了「发布通过 ≠ 对外可运行」。

### 12.9 事件级 diff

```powershell
# 只比较「事件名 + data 的键名」，忽略 runId / elapsedMs 等变化值
function Get-EventShape([string[]] $lines) {
  $shape = @()
  $event = $null
  foreach ($line in $lines) {
    if ($line -like 'event: *') {
      $event = $line.Substring(7).Trim()
    } elseif ($line -like 'data: *' -and $event -ne $null) {
      $obj = $line.Substring(6) | ConvertFrom-Json
      $keys = ($obj.PSObject.Properties.Name | Sort-Object) -join ','
      $shape += "$event($keys)"
      $event = $null
    }
  }
  return $shape
}

$body = '{"inputs":{"topic":"hello"}}'
$tsRaw = curl.exe -s -N -X POST "http://localhost:3001/public/apps/$app/run" `
  -H "X-API-Key: $key" -H "Content-Type: application/json" -d $body
$pyRaw = curl.exe -s -N -X POST "http://localhost:8000/public/apps/$app/run" `
  -H "X-API-Key: $key" -H "Content-Type: application/json" -d $body

Compare-Object (Get-EventShape ($tsRaw -split "`n")) (Get-EventShape ($pyRaw -split "`n"))
```

预期：**无输出**（两个序列完全相同）。

---

## 13. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 为什么先认证再查应用 | 没有有效 key 就不查，避免用 404/401 差异枚举 appId |
| key 不属于该应用为什么可能 404 | 应用不存在给 404；存在但 key 不匹配才是 401 |
| 4xx 为什么不是 SSE | 状态码必须在第一帧前确定；写流后无法改状态码 |
| 为什么不用 `@Sse()` | 它把 event 放 JSON 内，无法复用 `formatSseFrame`，帧格式不兼容 |
| `@Res()` 要注意什么 | 接管响应、必须自己 `end()`、错误必须在 `flushHeaders()` 前抛 |
| 对外运行为什么复用 `precheck` | 保证与草稿运行的事件序列一致；knowledge 归属取应用所有者 |
| `hasConversation=false` 拦什么 | `useHistory: true` 的 llm 节点 → 400 |
| 发布通过是否等于对外可运行 | 否：发布只校验图结构；`useHistory` 问题运行期才暴露 |
| 同一把 key 为什么两端通用 | 同一数据库 + 同一 SHA-256 + 同一 hex 输出 |
| Python 为什么要显式 `Content-Type` | 否则 Starlette 追加 `; charset=utf-8`，与 TS 不一致 |
| `len()` 与 `[...str].length` | 都按码点；`str.length` 按 UTF-16 码元，emoji 会多算 |
| 两端的已知差异 | `{"name": null}`：TS `name must be a string`，Python `name is required` |
| `last_used_at` 何时刷新 | 认证通过后立即刷新，早于 appId 比对 |
| 流式期间 `db` 为什么可用 | 依赖清理在响应完成后；不要启动比响应更久的后台任务 |
| 事件 diff 为什么只比键名 | 值里有 `runId` / `elapsedMs`，每次不同 |

---

## 14. 下一步

`04-前端发布面板与调用示例.md`：

- 应用详情页的「发布」按钮：调用 `POST /apps/{id}/graph/publish`，显示 `publishedAt`；
- API Key 面板：列表（含已撤销）、创建（一次性明文弹窗 + 复制）、撤销；
- 调用示例：生成可直接复制的 `curl` / `fetch` 片段；
- 前端 Zod schema：`apiKeyResponseSchema` / `createApiKeyResponseSchema`，禁止 `as` 断言。
