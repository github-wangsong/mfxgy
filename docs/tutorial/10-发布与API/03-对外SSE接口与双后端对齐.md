# 03 · 对外 SSE 接口与双后端对齐

> 所属：阶段 10 · 发布与 API
> 本篇覆盖：`POST /public/apps/{appId}/run` 的两套实现（`api-ts` 的 `PublicController`、`api-py` 的 `public.py`）、引擎侧的 `precheck()` 抽取与 `runPublished()` / `run_published()`、`ApiKeysService.authenticate()`、对外请求体 `PublicRunRequest` 的「只允许 `inputs`」约束。
> **本篇首次教学（本阶段的学习核心）：① ⭐「同一套引擎、两套入口」——`/apps/{id}/run`（JWT、草稿）与 `/public/apps/{appId}/run`（API Key、快照）不是两套执行器，只在「鉴权 / 图来源 / 是否有会话」三处分叉；② ⭐ 为什么必须把预检抽成 `precheck()`——两份预检的复制粘贴会让规则漂移，且漂移的表现是「一个入口 400、另一个入口流内 `run_failed`」；③ `runPublished` 与 `run` 的差异只有三处，其余（事件构造、帧序列化、SSE 头、终态）完全复用；④ 认证头的两种写法（`X-API-Key` 优先，`Authorization: Bearer <key>` 兜底）与「只在缺失时回退、不在校验失败时回退」的语义；⑤ 对外运行的校验顺序，以及「未发布为什么是 400 而不是 404」「appId 不匹配为什么存在给 401、不存在给 404」；⑥ `PublicRunRequest` 只有 `inputs`：`additionalProperties: false` + `forbidNonWhitelisted` / `extra="forbid"` 使 `conversationId` 被 DTO 直接拒绝（400 `conversationId should not exist`）；⑦ `lastUsedAt` 在认证成功时即写入（包括 appId 不匹配那次，两端一致，属可接受的小瑕疵）；⑧ ⭐ 对外运行的事件流与调试运行**完全一致**——对外不是另一套协议；⑨ 「`async def` 返回异步生成器 + `await`」这一写法如何保证 400/404 发生在**开流之前**；⑩ 框架层的请求体校验（DTO / Pydantic）发生在 handler 的 key 校验**之前**。**
> **不重讲**：SSE 帧格式、事件协议、双通道错误（请求级 4xx vs 流内 `run_failed`）见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；草稿 / 发布快照两态建模与 `POST /apps/{id}/graph/publish` 见 `03-画布/02-Prisma-JSONB与两态.md`；`ValidationPipe` 的 `whitelist` / `forbidNonWhitelisted` 与错误文案归一见 `01-账号与认证/03-NestJS认证.md`、`02-应用管理/07-验收.md`；`extra="forbid"` 与 `extra_forbidden` 的映射见 `00-项目初始化/06-FastAPI起步.md`、`apps/api-py/app/errors.py`；API Key 的建表、哈希存储与「明文只返回一次」见本阶段第 `01`、`02` 篇；`EngineService.run` 的会话分支（读历史 / 写消息）见 `09-会话与记忆/02-历史加载与上下文注入-NestJS.md`；变量池与模板解析见 `04-执行引擎/03-节点运行时与变量池.md`；`knowledge` 节点的归属预检见 `07-知识库RAG/03-NestJS检索与检索节点.md`。

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 本篇在阶段 10 的位置

阶段 10 之前，应用只有**一个**运行入口：

```
POST /apps/{id}/run       ← 登录用户（JWT）跑自己的「草稿图」
```

这个入口解决的是「作者调试」：一边在画布上改，一边点运行看效果。它天然假定调用者**就是应用的所有者**，并且**应该是当前草稿**。

但「发布」之后，应用要给别人用：

- 调用者不是登录用户，而是第三方脚本 / 客服机器人 / SDK；
- 调用者不该能改图，也不该看到草稿；
- 调用者只需要一个稳定的 key 和一段固定的 URL。

于是阶段 10 加了**第二个入口**：

```
POST /public/apps/{appId}/run   ← 第三方（API Key）跑「已发布快照」
```

### 0.1 两个入口，一套引擎

```
                         ┌──────────────────────────────┐
 JWT + 草稿               │                              │        API Key + 快照
 POST /apps/{id}/run ────▶│   EngineService / engine.py  │◀──── POST /public/apps/{appId}/run
                         │                              │
 RunController            │  precheck()                  │        PublicController
 @UseGuards(JwtAuthGuard) │  execute() / run_stream()    │        无 Guard（自定义 key 校验）
                         │  run_started → ... → 终态    │
                         └──────────────────────────────┘
```

**执行器是同一份。** 对外接口不是「另一套 SSE 协议」，也不是「复制一份引擎再改」——它只是**换了门卫、换了图的来源、关掉了会话**，然后把请求交给同一个 `execute()` / `run_stream()`。

这张图是本篇的骨架，后文所有小节都在解释它的三个接缝：**门卫**（§13、§14）、**图来源**（§12）、**会话开关**（§12.3）。

### 0.2 本篇的增量清单

| 增量 | 位置 | 本篇小节 |
| --- | --- | --- |
| 对外路由（TS） | `apps/api-ts/src/public/public.controller.ts` | §4、§13、§14 |
| 对外路由（Py） | `apps/api-py/app/api/public.py` | §5、§14 |
| 预检抽取 | `EngineService.precheck()` / `engine.py` 的 `precheck()` | §6、§7、§11 |
| 对外运行 | `EngineService.runPublished()` / `run_published()` | §6、§7、§12 |
| key 校验 | `ApiKeysService.authenticate()` / `app/api_keys/service.py` 的 `authenticate()` | §8、§16 |
| 请求体只允许 `inputs` | `public-run.dto.ts` / `PublicRunRequest` | §9、§15 |

**图的形状、事件的形状、帧的格式都没有变。** 阶段 4 定下的事件协议在阶段 10 仍然是唯一真源。

### 0.3 一次对外运行的完整时序（含校验顺序）

```
POST /public/apps/{appId}/run   { inputs }
  │
  ├─ ① 框架层：请求体校验（PublicRunRequest / PublicRunRequestDto）
  │       多传 conversationId ........................ 400 conversationId should not exist
  │
  ├─ ② 取 key：X-API-Key → Authorization: Bearer <key>
  │       两者都没有 / 都是空白 ..................... 401 Missing API key
  │
  ├─ ③ authenticate：sha256(key) 命中且未撤销
  │       查不到 / 已撤销 .......................... 401 Invalid API key
  │       命中 → 更新 lastUsedAt
  │
  ├─ ④ key.appId 与路径 appId 比对
  │       不符且 app 不存在 ......................... 404 App not found
  │       不符且 app 存在 ........................... 401 Invalid API key
  │
  ├─ ⑤ runPublished / run_published
  │       app 不存在 ............................... 404 App not found
  │       published_graph_json 为 null ............. 400 App is not published
  │
  ├─ ⑥ precheck(app.ownerId, 快照图, false) ......... 400（普通 JSON，文案 "; " 连接）
  │
  ├─ ⑦ 设置 SSE 响应头 + flushHeaders
  └─ ⑧ run_started → 节点事件 → run_finished / run_failed（流内）
```

三个位置必须记住：

1. **① 在 ② 之前**——框架的 DTO 校验比 handler 里的 key 校验更早（§14.4）。
2. **②~⑥ 都在 ⑦ 之前**——所有 4xx 都是普通 JSON，绝不会先开流再报错（§5.1 的 `await` 机制）。
3. **⑧ 与调试运行完全相同**——同一个引擎，同一套事件（§17）。

---

## 1. 本篇目标

- 能画出「两个入口 → 一个引擎」的结构，并指出三个分叉点。
- 能解释 `precheck()` 为什么必须抽出来，以及不抽会怎样「漂移」。
- 能逐条说出 `runPublished` 与 `run` 的差异，并说明为什么只差这三处。
- 能说清两种认证头的优先级、回退条件与大小写语义。
- 能按顺序复述对外运行的校验步骤，并解释 400 / 401 / 404 的选择理由。
- 能解释为什么 `conversationId` 在对外接口会被 **DTO 层**拒绝，而不是被忽略。
- 能指出 `lastUsedAt` 在什么时候被写、为什么 appId 不匹配那一次也会写。
- 能证明对外运行的事件流与调试运行是**同一套协议**。

**验收标准**

1. `pnpm run build:contract`、`pnpm --filter @mini-dify/api-ts build` 均通过。
2. `X-API-Key` 与 `Authorization: Bearer` 两种头都能拿到 200 + SSE，且归一化 `runId` / `elapsedMs` 后帧相同（§18.2）。
3. 对外跑出的 SSE 事件序列与调试运行一致，`run_started` 只有 `runId` / `appId`（§18.3）。
4. 修改草稿后，对外运行仍输出旧快照的结果；`GET /graph/published` 仍是旧图（§18.4）。
5. 两套后端归一化后 `normalized PY == TS: True`（§18.5）。
6. 9 组错误文案两端**逐字节相等**（§18.6）。
7. 阶段 5~9 的验收全部仍然通过（§18.7）。

---

## 2. 前置条件

- 阶段 3 已完成：`POST /apps/{id}/graph/publish` 能把草稿快照进 `published_graph_json`，`GET /apps/{id}/graph/published` 能读回快照。
- 阶段 4~9 已完成：引擎能编译图、发事件、写会话。
- 本阶段第 `01`、`02` 篇已完成：API Key 的表结构、创建 / 列表 / 撤销接口已就绪，且已能拿到一条明文 `sk-...`。
- `apps/api-ts/.env` 指向 mock LLM（无真实密钥也能跑）：

```dotenv
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=test
LLM_MODEL=mock-model
LLM_TIMEOUT_MS=3000
```

- 两个后端都已启动（`3001` / `8000`），且连的是**同一个数据库**。

---

## 3. 命令清单

> 除特别注明外，命令均在仓库根 `d:\user\my_project\github\mini-dify` 执行。Windows PowerShell 的续行符是反引号 `` ` ``。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 编译契约（`PublicRunRequest` / `apiKeyAuth`） | 无报错 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 编译 NestJS（`PublicModule` / `precheck` / `runPublished`） | 无报错 |
| `node tools/mock-llm/server.mjs` | 仓库根（**另开终端**） | 起 mock provider | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| `pnpm --filter @mini-dify/api-ts start:dev` | 仓库根 | 启动 api-ts | 监听 `http://localhost:3001` |
| `pnpm dev:api-py` | 仓库根 | 启动 api-py | 监听 `http://localhost:8000` |
| `curl.exe -s -X POST .../apps/{id}/graph/publish` | 任一端 | 把当前草稿快照为已发布图 | 返回 `publishedAt` + `graph` |
| `curl.exe -s -X POST .../apps/{id}/api-keys` | 任一端 | 新建 key（**明文只返回一次**） | 返回 `{ ..., "key": "sk-..." }` |
| `curl.exe -N -X POST .../public/apps/{appId}/run` | 任一端 | 逐帧看对外运行 | `run_started` / `token` / `run_finished` |

---

## 4. 完整代码：`public.controller.ts`（api-ts）

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
    private readonly apiKeysService: ApiKeysService,
    private readonly engineService: EngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':appId/run')
  @HttpCode(200)
  async run(
    @Param('appId') appId: string,
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PublicRunRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    const rawKey = extractApiKey(apiKeyHeader, authorization)
    if (rawKey === undefined) {
      throw new UnauthorizedException('Missing API key')
    }
    // 生产环境应在此处加限流（按 key / 应用维度），本阶段不实现。

    const authenticated = await this.apiKeysService.authenticate(rawKey)
    if (authenticated.appId !== appId) {
      // 不是这个应用的 key。先确认应用是否存在，避免把「应用不存在」误报成「key 无效」。
      const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
      if (app === null) {
        throw new NotFoundException('App not found')
      }
      throw new UnauthorizedException('Invalid API key')
    }

    const events = await this.engineService.runPublished(appId, body.inputs)
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
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
  const fromApiKeyHeader = apiKeyHeader?.trim()
  if (fromApiKeyHeader !== undefined && fromApiKeyHeader !== '') {
    return fromApiKeyHeader
  }
  if (authorization?.startsWith('Bearer ') === true) {
    const token = authorization.slice(7).trim()
    return token === '' ? undefined : token
  }
  return undefined
}
```

### 4.1 `@Res()`：为什么继续手写 SSE，而不用 `@Sse()`

这与 `RunController` 的选择完全相同（教学见 `04-执行引擎/05-SSE流式响应实现.md`）：NestJS 的 `@Sse()` 的序列化细节不可控，而本项目要求「帧逐字节可比」。所以两个入口都用底层 `Response`：

```ts
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
    for await (const event of events) {
      response.write(formatSseFrame(event))
    }
    response.end()
```

三行响应头、一次 `flushHeaders()`、一个 `for await`、一次 `end()`——**一个字都不差**。这不是巧合，而是「对外不是另一套协议」的直接体现（§17）。

### 4.2 `@HttpCode(200)`

NestJS 的 `@Post()` 默认返回 **201 Created**。SSE 不是「创建资源」，且客户端通常只接受 200，所以这里显式 `@HttpCode(200)`。Python 侧 `@router.post` 默认就是 200，无需额外声明。

### 4.3 `extractApiKey`：只判「有没有」，不判「对不对」

```ts
  const fromApiKeyHeader = apiKeyHeader?.trim()
  if (fromApiKeyHeader !== undefined && fromApiKeyHeader !== '') {
    return fromApiKeyHeader
  }
  if (authorization?.startsWith('Bearer ') === true) {
    const token = authorization.slice(7).trim()
    return token === '' ? undefined : token
  }
```

四个细节：

| 细节 | 行为 |
| --- | --- |
| `trim()` | 头值前后的空格不算 key 的一部分 |
| 空串 / 全空白 | 视为「没提供」，**继续尝试下一个头** |
| `startsWith('Bearer ')` | 只认**精确大小写**的 `Bearer `（含一个空格） |
| `slice(7)` | 去掉 `Bearer ` 这 7 个字符，再 `trim()` |

注意它的**回退条件**：只有在 `X-API-Key` **缺失或空白**时才看 `Authorization`。如果 `X-API-Key` 有值但**是错的**，它**不会**再退回 Bearer——错误会直接在 §14 的第 2 步变成 401。这个语义在 §13.2 展开。

### 4.4 错误为什么能是普通 JSON

`@Res()` 一旦调用 `flushHeaders()`，状态码和响应头就发出去了，之后只能写流。本控制器把所有会失败的判断（取 key、`authenticate`、`appId` 比对、`runPublished` 的 404/400/precheck）都放在 `flushHeaders()` **之前**，所以它们抛出的 `HttpException` 会被全局 `HttpErrorFilter` 归一成普通 JSON。顺序见 §14。

---

## 5. 完整代码：`public.py`（api-py）

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

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any]


def _extract_api_key(x_api_key: str | None, authorization: str | None) -> str | None:
    """`X-API-Key` 优先，其次 `Authorization: Bearer <key>`；空白值视为未提供。"""
    if x_api_key is not None:
        trimmed = x_api_key.strip()
        if trimmed != "":
            return trimmed
    if authorization is not None and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
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
    raw_key = _extract_api_key(x_api_key, authorization)
    if raw_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing API key"
        )
    # 与 TS 一致：先认证（并刷新 last_used_at），再比对路径里的 appId
    authenticated = service.authenticate(db, raw_key)
    if authenticated["appId"] != app_id:
        # 不是这个应用的 key。先确认应用是否存在，避免把「应用不存在」误报成「key 无效」。
        if db.get(App, app_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="App not found"
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
        )
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

### 5.1 ⭐ 为什么是 `await run_published(...)`，而不是直接把它交给 `StreamingResponse`

这是本篇最容易被忽略、但**最影响错误形态**的一行：

```python
    return StreamingResponse(
        await run_published(db, app_id, body.inputs),
        media_type="text/event-stream",
        ...
    )
```

先看 `run_published` 的定义（§7）：

```python
async def run_published(
    db: Session, app_id: str, inputs: dict[str, Any]
) -> AsyncGenerator[str, None]:
    ...
    return run_stream(app.id, graph, inputs, db)
```

它虽然是 `async def`，但**函数体里没有 `yield`**。这在 Python 里意味着：

| 写法 | 类型 | 什么时候执行函数体 |
| --- | --- | --- |
| `async def f(): yield ...` | **异步生成器函数** | 调用时不执行；**第一次 `__anext__`（即开始迭代）时**才执行 |
| `async def f(): return g()`（本例） | **协程函数** | `await f()` 时**立刻**执行完，返回一个异步生成器 `g()` |

所以 `await run_published(...)` 会在 `StreamingResponse` 构造**之前**把「应用是否存在」「是否已发布」「预检」全部跑完：

- 任何 404 / 400 都在这里抛出 → 由 `register_error_handlers` 归一成普通 JSON；
- 只有全部通过，才把一个**已经可以迭代**的生成器交给 `StreamingResponse`；
- 响应头此时还没发，所以错误能带上正确的状态码。

反过来，如果写成 `yield`（异步生成器函数）并把生成器直接交给 `StreamingResponse`，那么函数体会等到**响应开始迭代**才执行——此时 `200 OK` 与 `text/event-stream` 已经发出，404 / 400 只能变成「流里的一帧」，或者直接导致连接中断。这就是阶段 4 反复强调的「**先校验、后开流**」在 Python 里的类型级保证。

api-ts 侧用的是同构的写法：

```ts
    const events = await this.engineService.runPublished(appId, body.inputs)
```

`runPublished` 是 `async` 方法（返回 `Promise<AsyncGenerator>`），`await` 同样会把「404 / 400 / 预检」全部跑完，再拿到生成器。**两端都不是「惰性校验」**。

### 5.2 显式 `Content-Type`：去掉 `; charset=utf-8`

`StreamingResponse(media_type="text/event-stream")` 默认会被 Starlette 补成 `text/event-stream; charset=utf-8`，而 api-ts 发出的是 `text/event-stream`。前序阶段已经把「JSON 响应必须带 charset」与「SSE 响应必须不带」的两种取舍分别定死，这里用 `headers=` 显式覆盖，保证两端响应头对齐。

### 5.3 `Header(alias="X-API-Key")`

FastAPI 的参数名是 `x_api_key`（Python 的蛇形命名），对外头名是 `X-API-Key`（HTTP 的连字符命名），所以必须给 `alias`。Starlette 的头查找是**大小写不敏感**的，客户端写 `x-api-key` / `X-Api-Key` 都能命中；但 `Authorization` 的**值**里那个 `Bearer ` 前缀仍是大小写敏感的（§13.3）。

---

## 6. 完整代码：api-ts 引擎的 `run` / `runPublished` / `precheck`

为看清「三处差异」，把三个方法放在一起。`run` 的会话细节已在 `09-会话与记忆/02-历史加载与上下文注入-NestJS.md` 完整讲过，这里只作为**对照物**。

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`（节选：`run` / `runPublished` / `precheck`）**

```ts
  /**
   * 预检并返回 SSE 事件流。
   *
   * 预检失败（草稿为空 / 图不合法 / 节点数据形状非法 / 未知工具 / `useHistory`
   * 缺会话）抛 `BadRequestException`（普通 JSON 400）；归属不符抛 `NotFoundException`
   * （404）。这些都发生在**打开流之前**，故不会污染 SSE 帧。
   *
   * 阶段 9：带 `conversationId` 时先校验归属，再**读取历史（不含本轮）**，
   * 然后写入本轮用户消息，构造 `pool.conversation`。
   * 用户消息写入失败即 400 `failed to persist conversation message`。
   */
  async run(
    ownerId: string,
    appId: string,
    inputs: Record<string, unknown>,
    conversationId?: string,
    userMessage?: string,
  ): Promise<AsyncGenerator<RunEvent>> {
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
    if (conversationId !== undefined) {
      await this.conversations.assertOwnedByApp(ownerId, appId, conversationId)
    }
    if (app.graphJson === null) {
      throw new BadRequestException('Graph is empty')
    }
    const graph = app.graphJson as unknown as Graph
    await this.precheck(ownerId, graph, conversationId !== undefined)

    let conversation: ConversationContext | undefined
    if (conversationId !== undefined) {
      // 顺序很重要：**先读历史、再写本轮用户消息**。
      // 反过来的话，本轮 user 消息会混进历史，模型会看到「两条相同的用户话」。
      const history = await this.conversations.loadHistory(
        conversationId,
        maxHistoryMessages(),
      )
      if (userMessage !== undefined && userMessage !== '') {
        try {
          await this.conversations.appendMessage(conversationId, 'user', userMessage)
        } catch {
          throw new BadRequestException('failed to persist conversation message')
        }
      }
      conversation = buildConversationContext(conversationId, history)
    }
    return this.execute(appId, graph, inputs, conversation)
  }

  /**
   * 对外运行：**只读已发布快照**（`published_graph_json`），不带会话。
   *
   * 顺序与 `/apps/{id}/run` 的归属校验不同：这里没有 JWT，key 的归属已由
   * `PublicController` 校验；本方法只负责「应用是否存在 → 是否已发布 → 预检」。
   * 未发布 → 400 `App is not published`（见 error-messages.md §10）。
   *
   * 预检与执行复用 `precheck` / `execute`，保证事件序列与草稿运行**完全一致**；
   * knowledge 节点的 `ownerId` 取应用所有者（`app.ownerId`）。
   */
  async runPublished(
    appId: string,
    inputs: Record<string, unknown>,
  ): Promise<AsyncGenerator<RunEvent>> {
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    if (app === null) {
      throw new NotFoundException('App not found')
    }
    if (app.publishedGraphJson === null) {
      throw new BadRequestException('App is not published')
    }
    const graph = app.publishedGraphJson as unknown as Graph
    // 对外运行不支持会话：`hasConversation = false`（`useHistory` 节点会预检失败）
    await this.precheck(app.ownerId, graph, false)
    return this.execute(appId, graph, inputs)
  }

  /**
   * 运行前预检（草稿运行与对外运行共用）。
   *
   * 失败抛 `BadRequestException`（普通 JSON 400），文案见 error-messages.md §3 / §4.1 /
   * §6.1 / §7.2 / §8.1，多条用 `"; "` 连接。
   */
  private async precheck(ownerId: string, graph: Graph, hasConversation: boolean): Promise<void> {
    const errors = [
      ...validateGraph(graph),
      ...validateNodeData(graph, hasConversation),
      // 预检需要知道 ownerId：其他用户的知识库一律视为不存在（见 error-messages.md §7.2）
      ...(await validateKnowledgeNodes(this.prisma, ownerId, graph)),
    ]
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
  }
```

> `precheck` 之前是**内联在 `run()` 里的**（阶段 9 的 `run()` 直接把三个展开式写在数组里）。阶段 10 把它提取出来，是因为出现了第二个调用方（§11）。

---

## 7. 完整代码：api-py 引擎的 `precheck` / `run_published`

**完整文件路径：`apps/api-py/app/engine/engine.py`（节选：`precheck` / `run_published`）**

```python
async def precheck(
    db: Session, owner_id: str, graph: dict[str, Any], has_conversation: bool = False
) -> list[str]:
    """运行前预检（草稿运行与对外运行共用）。

    返回错误文案列表（多条用 `"; "` 连接后由路由转成 400），见
    error-messages.md §3 / §4.1 / §6.1 / §7.2 / §8.1。
    knowledge 节点的归属以 `owner_id` 为准：对外运行时传应用所有者。
    """
    return [
        *validate_graph(graph),
        *validate_node_data(graph, has_conversation),
        *await validate_knowledge_nodes(db, owner_id, graph),
    ]


async def run_published(
    db: Session, app_id: str, inputs: dict[str, Any]
) -> AsyncGenerator[str, None]:
    """对外运行：只读已发布快照（`published_graph_json`），不带会话。

    与 api-ts 的 `EngineService.runPublished` 对齐：应用不存在 → 404
    `App not found`；未发布 → 400 `App is not published`；预检复用 `precheck`
    （knowledge 节点归属取**应用所有者**），保证事件序列与草稿运行完全一致。
    对外运行不支持会话：`has_conversation=False`（`useHistory` 节点会预检失败）。
    """
    app = db.get(App, app_id)
    if app is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")
    if app.published_graph_json is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="App is not published"
        )
    graph = app.published_graph_json
    errors = await precheck(db, app.owner_id, graph, False)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors)
        )
    return run_stream(app.id, graph, inputs, db)
```

草稿运行（`app/api/run.py`）的对应片段：

```python
    graph = app.graph_json
    # 预检需要知道 ownerId：其他用户的知识库一律视为不存在（见 error-messages.md §7.2）
    errors = await precheck(db, current_user.id, graph, body.conversationId is not None)
    if errors:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors))
```

### 7.1 两端的「形态差异」：抛异常 vs 返回列表

| 维度 | api-ts `precheck` | api-py `precheck` |
| --- | --- | --- |
| 返回 | `Promise<void>` | `list[str]` |
| 失败表达 | 直接 `throw BadRequestException(errors.join('; '))` | 把列表交回调用方 |
| 谁负责 400 | `precheck` 内部 | 每个路由自己 `raise HTTPException` |

这不是「两边写法不统一」，而是各自语言/框架的惯例：

- NestJS 里「服务方法抛 `HttpException`、全局过滤器统一包信封」是标准做法；
- FastAPI 里函数返回值更像数据，`HTTPException` 留给路由层，`precheck` 保持「纯计算」也便于单测。

关键不在形态，而在**文案的拼接规则**：两端都在错误非空时用 `"; "` 连接，并作为**单一 `message` 字符串**返回。实测 9 组错误逐字节相等（§18.6）证明了这个约定被真正执行。

---

## 8. 完整代码：`authenticate`（API Key 校验）

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.service.ts`（节选：`authenticate` 与 `hashKey`）**

```ts
  /**
   * 校验明文 key（对外运行用）：哈希匹配且未撤销才算通过。
   * 命中后顺手更新 `lastUsedAt`，返回该 key 所属的应用与用户。
   */
  async authenticate(rawKey: string): Promise<AuthenticatedApiKey> {
    const found = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashKey(rawKey) },
      select: { id: true, appId: true, ownerId: true, revokedAt: true },
    })
    if (found === null || found.revokedAt !== null) {
      throw new UnauthorizedException('Invalid API key')
    }
    await this.prisma.apiKey.update({
      where: { id: found.id },
      data: { lastUsedAt: new Date() },
    })
    return { appId: found.appId, ownerId: found.ownerId }
  }

/** `sha256(明文 key)` 的十六进制摘要（64 字符）。 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
```

**完整文件路径：`apps/api-py/app/api_keys/service.py`（节选：`authenticate`）**

```python
def authenticate(db: Session, raw_key: str) -> dict[str, str]:
    """校验明文 key：哈希匹配且未撤销才算通过，并更新 `last_used_at`。

    返回 `{"appId": ..., "ownerId": ...}`。与 TS 一致：**先**更新 `last_used_at`，
    再由调用方比对路径里的 `appId`（因此「拿 A 的 key 调 B」也会刷新该 key 的使用时间）。
    """
    api_key = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_key(raw_key)))
    if api_key is None or api_key.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
        )
    api_key.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"appId": api_key.app_id, "ownerId": api_key.owner_id}
```

三个对齐点：

| 点 | TS | Py |
| --- | --- | --- |
| 匹配方式 | `keyHash` 唯一索引查 `sha256(rawKey)` | `where key_hash == hash_key(raw_key)` |
| 撤销判定 | `revokedAt !== null` | `revoked_at is not None` |
| 失败文案 | `Invalid API key`（401） | `Invalid API key`（401） |

「查不到」与「已撤销」**故意合并成同一条文案**：否则攻击者可以拿一个随机 key 反复试，通过「`Invalid` vs `Revoked`」的差别判断某个 key 是否存在过。这属于认证接口的常见防泄露做法。

> 哈希存储、`prefix` 的作用、明文只返回一次等设计，见本阶段第 `01`、`02` 篇；本篇只关心 `authenticate` 被**谁调用、什么时候调用**。

---

## 9. 完整代码：请求体只允许 `inputs`

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

它依赖**全局**校验管道才能生效：

**完整文件路径：`apps/api-ts/src/main.ts`（节选）**

```ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  )
```

- `whitelist: true`：剥掉 DTO 里没有声明的属性；
- `forbidNonWhitelisted: true`：不剥，而是**报错**——这一步才有 `should not exist`；
- `exceptionFactory`：把 class-validator 的 `whitelistValidation` 归一成 `conversationId should not exist`（`common/validation-exception-factory.ts`）。

Python 侧用 Pydantic 的等价开关：

```python
    model_config = ConfigDict(extra="forbid")
```

`app/errors.py` 把它映射成同一句文案：

```python
    if err_type == "extra_forbidden":
        return "unknown", f"{field} should not exist"
```

契约本身也写死了这条边界（`packages/contract/openapi.yaml`）：

```yaml
    PublicRunRequest:
      type: object
      additionalProperties: false
      required: [inputs]
      properties:
        inputs:
          type: object
          additionalProperties: true
```

注意内外有别：**外层** `additionalProperties: false`（只允许 `inputs`），**`inputs` 内部** `additionalProperties: true`（输入变量的键由图的 `start` 节点决定，服务端不逐个校验）。

---

## 10. 【技术教学 · 首次】同一套引擎、两套入口

### 10.1 什么叫「入口」与「引擎」

| 层 | 职责 | 本项目里是谁 |
| --- | --- | --- |
| **入口（门卫）** | 认人、认资源、决定「用哪张图」 | `RunController` / `PublicController`、`app/api/run.py`、`app/api/public.py` |
| **引擎（执行）** | 预检图、编译图、跑节点、发事件 | `EngineService` / `app/engine/engine.py` |

入口的差异是**业务差异**：谁能调、调哪张图、带不带会话。引擎的职责是**执行语义**：同一张图必须产生同一串事件。把这两层混在一起（比如在引擎里判断「这次是 JWT 还是 API Key」）会让引擎变成「知道所有入口」的上帝对象，也让新增入口必须改引擎。

本项目的切法：

```
入口层：鉴权 → 归属/存在性 → 选图 → 调用引擎
引擎层：precheck(graph) → execute(graph) → 事件
```

引擎**只认识 `Graph`、`inputs`、`conversation`**，不认识用户、不认识 key、不认识「草稿还是快照」。这三样东西在入口层被解析成引擎能理解的参数。

### 10.2 两个入口的完整对照

| 维度 | `POST /apps/{id}/run`（调试） | `POST /public/apps/{appId}/run`（对外） |
| --- | --- | --- |
| 鉴权 | JWT（`JwtAuthGuard` + `@CurrentUser`） | API Key（controller 内自定义） |
| 身份来源 | `payload.sub`（用户 id） | `authenticate(key)` 返回的 `{appId, ownerId}` |
| 归属校验 | `app.ownerId === ownerId`，否则 404 | key 的 `appId` 必须等于路径 `appId`，否则 401/404 |
| 图的来源 | `app.graphJson`（草稿） | `app.publishedGraphJson`（快照） |
| 空图/未发布 | `Graph is empty`（400） | `App is not published`（400） |
| 会话 | 可选 `conversationId` / `userMessage` | **不支持** |
| 预检 | `precheck(ownerId, graph, hasConversation)` | `precheck(app.ownerId, graph, false)` |
| 执行 | `execute(appId, graph, inputs, conversation?)` | `execute(appId, graph, inputs)` |
| 事件 | `run_started` / 节点事件 / 终态 | **完全相同** |
| 帧序列化 | `formatSseFrame` | **完全相同** |
| 请求级错误 | 普通 JSON | **完全相同** |

### 10.3 为什么「复制一份引擎」是错的

一个常见的偷懒方案是：`public` 模块里写一个「简化版引擎」，只跑 LLM、不跑工具 / 分支 / 迭代。它的代价：

| 代价 | 说明 |
| --- | --- |
| 行为分叉 | 同一张图在调试时能跑通、对外时 400 或结果不同——用户无法解释 |
| 事件分叉 | 调试有 `branch_taken`，对外没有；客户端要么写两套解析，要么放弃可解释性 |
| 修 bug 要改两处 | 阶段 5 的错误映射、阶段 6 的 ReAct、阶段 8 的分支——每加一个能力都要同步两次 |
| 验收失效 | 阶段 4 定下的「逐帧一致」只能在两个入口内部各自成立，跨入口不成立 |

本项目的选择是**只复制「门卫」，绝不复制「执行」**。于是「对外运行和调试运行事件一致」不是靠人工同步，而是**结构上必然**——因为它们调用的是同一个函数。

### 10.4 为什么对外要读快照，而不是「当前草稿」

`published_graph_json` 是 `POST /apps/{id}/graph/publish` 时对草稿的**深拷贝**（两态建模见 `03-画布/02-Prisma-JSONB与两态.md`）。对外读快照有三个直接后果：

1. **可回滚**：作者把草稿改坏了，线上仍按上一版跑；重新发布才更新。
2. **可审计**：线上行为对应一个确定的图，而不是「某个时刻作者正在编辑的内容」。
3. **可复现**：同一个 key、同一组输入，今天和昨天跑出来一致（除非重新发布）。

实测（§18.4）：把草稿改成 `DRAFT-CHANGED {{ inputs.topic }}` 后，对外运行仍输出 `echo: Hello mini-dify`，`GET /graph/published` 仍是 `{{ inputs.topic }}`——**草稿与线上彻底隔离**。

> 注意：发布时 `publish()` 会校验图的结构（`assertValid`），但**不会**校验运行时才需要的信息（知识库归属、工具名、`useHistory` 是否有会话）。这些仍然由 `precheck` 在每次运行时检查——所以一个「发布时合法」的快照，在知识库被删掉之后，对外运行会 400（普通 JSON，开流之前）。

---

## 11. 【技术教学 · 首次】⭐ 为什么要把 `precheck()` 抽出来

### 11.1 抽取之前长什么样

阶段 9 的 `run()` 是这么写的（内联）：

```ts
    const errors = [
      ...validateGraph(graph),
      ...validateNodeData(graph, conversationId !== undefined),
      ...(await validateKnowledgeNodes(this.prisma, ownerId, graph)),
    ]
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
```

阶段 10 出现第二个调用方 `runPublished()`。最自然的写法是**复制这一段**、把 `ownerId` 换成 `app.ownerId`、把 `conversationId !== undefined` 换成 `false`。抽取之后变成：

```ts
  private async precheck(ownerId: string, graph: Graph, hasConversation: boolean): Promise<void> {
    const errors = [
      ...validateGraph(graph),
      ...validateNodeData(graph, hasConversation),
      ...(await validateKnowledgeNodes(this.prisma, ownerId, graph)),
    ]
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
  }
```

两个调用方都只剩一行：

```ts
    await this.precheck(ownerId, graph, conversationId !== undefined)   // 草稿
    await this.precheck(app.ownerId, graph, false)                      // 对外
```

### 11.2 复制粘贴的代价：规则漂移

「两份一样的代码」在**写完的当天**是等价的；问题出在**下一次修改**。预检是一个会不断长大的函数：阶段 4 加 `validateGraph`，阶段 5 加 LLM 节点形状，阶段 6 加未知工具，阶段 7 加知识库归属，阶段 8 加分支规则，阶段 9 加 `useHistory`。每一次都只改一处，另一处就悄悄落后。

举三个**真实会发生的**漂移场景：

| 场景 | 复制版会怎样 | 抽取版的后果 |
| --- | --- | --- |
| 阶段 9 给 `run()` 加 `useHistory requires a conversation` | 如果只改了草稿那份，对外运行**不会**在开流前拒绝；请求会进入执行，LLM 节点发现没有会话，最终发一帧 `run_failed` | 两个入口同时获得该规则，且都是开流前 400 |
| 阶段 6 给 `llm` 加「未知工具」预检 | 对外漏检 → 运行到一半才在节点里报错 → 又是 `run_failed` | 同时生效 |
| 阶段 7 给 `knowledge` 加「不属于当前用户视为不存在」 | 对外那份若忘记传 `ownerId`，会把**所有**知识库都当成不存在（或反过来，错误地放开） | 参数化后不存在「忘记传」的第二种写法 |

漂移最难查的地方是**错误形态不一致**：

```
调试入口：400 + 普通 JSON {"statusCode":400,"message":"..."}
对外入口：200 + SSE + 流内 run_failed
```

两边的客户端代码完全不同，测试也必须分别写。而「同一张图、同一组输入，为什么调试能跑、对外不能跑」这个问题，用户几乎无法自己定位。

### 11.3 三个参数把差异收敛干净

抽取后的签名是：

```ts
precheck(ownerId: string, graph: Graph, hasConversation: boolean)
```

| 参数 | 草稿运行 | 对外运行 | 为什么要参数化 |
| --- | --- | --- | --- |
| `ownerId` | `payload.sub`（当前用户） | `app.ownerId`（应用所有者） | 知识库归属的判定基准 |
| `graph` | `app.graphJson` | `app.publishedGraphJson` | 预检对象随入口而变 |
| `hasConversation` | `conversationId !== undefined` | `false` | `useHistory` 是**图**的属性，必须结合**请求**判断 |

换句话说：**两个入口的预检差异，恰好就是这三个值**。函数体里没有一处 `if (isPublic)`，也没有一处入口相关的分支。这是「把差异提到参数、把共性留在函数体」的标准做法。

### 11.4 抽取的边界：为什么不把「应用不存在 / 未发布」也放进 `precheck`

`precheck` 的入参是 `Graph`，不是 `appId`。它**不查应用**，只检查一张已经拿到的图。原因：

| 检查 | 为什么不放进 `precheck` |
| --- | --- |
| 应用是否存在 | 这是**资源解析**，发生在选图之前；两个入口的判定依据不同（JWT 归属 vs key 归属） |
| 草稿是否为空 / 是否已发布 | 这是**状态检查**，文案不同（`Graph is empty` vs `App is not published`） |
| 会话归属 | 这是**请求参数校验**，只对草稿入口存在 |

所以流水线是：

```
入口层：解析应用 → 选图（草稿/快照）→ 处理入口特有状态
引擎层：precheck(图, 请求上下文) → execute
```

`precheck` 只负责「**这张图能不能在这个请求上下文里安全运行**」。边界清楚，才不会把入口的业务判断重新塞回引擎。

### 11.5 Python 侧同理

`app/api/run.py` 与 `app/api/public.py` 都调用同一个 `precheck(db, owner_id, graph, has_conversation)`；`run_published` 传 `app.owner_id` 与 `False`。差别只在「谁来提供这三个值」，不在「检查什么」。

---

## 12. 【技术教学 · 首次】`runPublished` 与 `run` 只差三处

### 12.1 三处差异

| # | 差异 | `run`（调试） | `runPublished`（对外） |
| --- | --- | --- | --- |
| ① | **鉴权方式** | JWT：入口用 `JwtAuthGuard`；方法内用 `ownerId` 校验归属 | API Key：入口用 `authenticate`；方法内**不再**校验用户归属 |
| ② | **图来源** | `app.graphJson`（草稿） | `app.publishedGraphJson`（快照） |
| ③ | **是否有会话** | 可选 `conversationId` / `userMessage`；读历史、写 user、构造 `pool.conversation`、写 assistant | 无；`hasConversation = false` |

其余**全部复用**：

- 同一个 `precheck`（§11）；
- 同一个 `execute` / `run_stream`；
- 同一套 `runStarted` / `nodeStarted` / `token` / `runFinished` / `runFailed` 构造器；
- 同一个 `formatSseFrame` / `format_sse_frame`；
- 同一套「请求级 4xx 用普通 JSON、流内失败用 `run_failed`」的双通道错误。

### 12.2 逐行读 `runPublished`

```ts
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    if (app === null) {
      throw new NotFoundException('App not found')
    }
    if (app.publishedGraphJson === null) {
      throw new BadRequestException('App is not published')
    }
    const graph = app.publishedGraphJson as unknown as Graph
    await this.precheck(app.ownerId, graph, false)
    return this.execute(appId, graph, inputs)
```

| 行 | 含义 | 与 `run` 的差别 |
| --- | --- | --- |
| `app === null` | 应用不存在 | `run` 把「不存在」与「非本人」合并成 404；这里只判存在性（归属已由 key 决定） |
| `publishedGraphJson === null` | 从未发布过 | `run` 判的是 `graphJson === null` → `Graph is empty` |
| `app.publishedGraphJson` | 取快照 | `run` 取 `app.graphJson` |
| `precheck(app.ownerId, graph, false)` | 知识库归属取**应用所有者**；无会话 | `run` 用 `ownerId` 与真实的 `hasConversation` |
| `execute(appId, graph, inputs)` | 不传 `conversation` | `run` 可能传 `conversation` |

### 12.3 为什么对外不带会话

不是「还没做」，而是**语义上不应该**：

| 理由 | 说明 |
| --- | --- |
| 第三方没有会话的所有权 | 会话属于「登录用户 + 应用」；API Key 只代表「可以运行这个应用」，不代表某个人的聊天历史 |
| 快照与历史会打架 | 会话历史是在某个版本的图下产生的；图重新发布后，旧历史可能对应不同的 prompt 语义 |
| 契约收窄 | `PublicRunRequest` 只有 `inputs`，从协议层就关掉这条路（§15） |
| 实现简单 | `hasConversation = false` 让 `useHistory` 节点在预检阶段直接 400，而不是运行时悄悄没有历史 |

因此：**一张带 `useHistory: true` 的图，不能对外运行**。它会得到开流前的 400 `llm node xxx useHistory requires a conversation`——这是刻意的，而不是 bug。要对外，就把该节点的 `useHistory` 关掉（或改成显式把 `{{ conversation.history }}` 写进 prompt 的设计，但对外没有会话，同样不成立）。

### 12.4 「没有会话」不等于「引擎有第二套执行路径」

`execute` 的签名是：

```ts
  private async *execute(
    appId: string,
    graph: Graph,
    inputs: Record<string, unknown>,
    conversation?: ConversationContext,
  ): AsyncGenerator<RunEvent> {
```

`conversation` 是可选的。没传时：

- `runStarted(runId, appId, conversation?.id)` 得到 `undefined` → 事件只有两个键（`09-会话与记忆/02-...` §7）；
- `runGraph` 的 `pool` 是 `{ inputs }`，没有 `conversation` 键；
- 成功收口时**不写** assistant 消息。

这三件事都是同一个可选参数的自然结果，不是「if public then ...」的分支。**对外运行在引擎里没有任何专属代码**——这是本节最重要的一句话。

---

## 13. 【技术教学 · 首次】认证头的两种写法

### 13.1 为什么支持两种

| 客户端类型 | 习惯写法 | 例子 |
| --- | --- | --- |
| curl / 手工调试 | `X-API-Key: sk-...` | `curl -H "X-API-Key: $KEY" ...` |
| SDK / 通用 HTTP 客户端 | `Authorization: Bearer <token>` | 大多数 OpenAPI 生成器只认 `http`/`bearer` 方案；很多团队也统一用 Bearer 管所有凭证 |
| OpenAI 兼容生态 | `Authorization: Bearer <key>` | 大量脚本是从「调 OpenAI」改过来的，第一反应就是 Bearer |

契约的**规范写法**是 `X-API-Key`：

```yaml
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: >-
        对外运行应用的 API Key（创建时返回一次）。也可用
        `Authorization: Bearer <key>` 传递，两者等价。
```

但只支持一种会制造无谓的集成摩擦：用户拿到 key 后，第一件事往往是 `curl -H "Authorization: Bearer $KEY"`。支持两种、并在契约里写清楚「等价」，可以显著降低「401 了但不知道为什么」的支持成本。

### 13.2 优先级与回退语义

```
X-API-Key 有非空值？
  ├─ 是 → 用它（不再看 Authorization）
  └─ 否（缺失 / 空串 / 全空白） → Authorization 以 "Bearer " 开头？
        ├─ 是 → 取后面的部分（空则视为未提供）
        └─ 否 → 未提供
```

关键是一条：**回退只看「有没有」，不看「对不对」**。

| 请求头 | 结果 |
| --- | --- |
| `X-API-Key` 缺失 + Bearer 有效 | ✅ 用 Bearer |
| `X-API-Key: "  "` + Bearer 有效 | ✅ 空白视为缺失，用 Bearer |
| `X-API-Key` 有效 + Bearer 无效 | ✅ 用 X-API-Key（Bearer 被忽略） |
| `X-API-Key` **无效** + Bearer 有效 | ❌ **401 `Invalid API key`**（不会回退） |

最后一行是**有意**的。如果「X-API-Key 校验失败就再试 Bearer」，那么：

- 同一次请求可能被两条不同的凭证先后认证，语义模糊；
- 日志里无法判断到底用了哪条；
- 攻击面变大（可以同时塞多个猜测）。

「先声明用哪个、就用哪个」比「挨个试」更可预测。两端实现完全一致（§4.3、§5 的 `_extract_api_key`）。

### 13.3 大小写：头名不敏感，`Bearer ` 敏感

- **头名**：HTTP/1.1 规定字段名大小写不敏感；Express 与 Starlette 都按不敏感处理，`x-api-key` / `X-API-Key` / `X-Api-Key` 等价。
- **头的值**：两端都写成 `startsWith('Bearer ')` / `startswith("Bearer ")`，即**精确大小写**。

所以：

```powershell
# ✅ 两种都可以
curl.exe -H "X-API-Key: $KEY" ...
curl.exe -H "Authorization: Bearer $KEY" ...

# ❌ 会被当作「没提供」→ 401 Missing API key
curl.exe -H "Authorization: bearer $KEY" ...
curl.exe -H "Authorization: BEARER $KEY" ...
```

按 RFC 7235，认证方案名本身是大小写不敏感的；这里为了「两端逐字节一致、行为可预测」选择了**只认精确形式**。这是有意简化，不是协议缺陷——但集成方必须知道（常见坑 §20）。

### 13.4 为什么不用 `EventSource`

浏览器原生 `EventSource` **不能自定义请求头**（阶段 4 已教学，见 `04-执行引擎/06-前端SSE客户端与运行面板.md`）。所以对外接口的浏览器调用方仍然要用 `fetch` + `getReader()`：

```js
const response = await fetch(`/public/apps/${appId}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
  body: JSON.stringify({ inputs }),
})
```

`Authorization` 也不能靠浏览器自动带（那是给 `fetch` 手动设的），所以「两种头」对前端没有额外收益，但也没有坏处。**真正的收益在服务端到服务端（脚本 / SDK）**。

---

## 14. 【技术教学 · 首次】校验顺序的工程意义

### 14.1 五步顺序

（handler 内，按源码顺序）

| 步 | 检查 | 失败结果 | 为什么不换顺序 |
| --- | --- | --- | --- |
| 1 | 能否取到 key | 401 `Missing API key` | 「你没带凭证」必须先说，这是最基础的调用错误 |
| 2 | key 是否有效且未撤销 | 401 `Invalid API key` | 凭证无效时，后面的任何判断都没有意义 |
| 3 | key 的 `appId` 与路径是否一致 | app 不存在 → 404 `App not found`；app 存在 → 401 `Invalid API key` | 先确认「这个 key 是否属于这个应用」，再进入执行 |
| 4 | 应用是否存在 / 已发布 | 404 `App not found` / 400 `App is not published` | 资源状态检查，必须在预检之前 |
| 5 | 图预检 | 400（文案 `"; "` 连接） | 最贵的检查放最后；且必须在开流之前 |

### 14.2 为什么「未发布」是 400 而不是 404

| 候选 | 为什么不用 |
| --- | --- |
| 404 Not Found | 应用**确实存在**。用 404 会让调用方以为 URL 写错了，于是去改 `appId`——越改越错。而且 `GET /apps/{id}`、key 列表都能证明它存在，前后矛盾 |
| 403 Forbidden | 调用方**有**这个应用的合法 key，不是权限不足；问题是「这个应用还没上线」 |
| 409 Conflict | 语义上可以争论（「资源状态与请求冲突」），但契约已经统一用 400 表达「请求在当前状态下无法处理」；409 在本项目里留给别的场景 |
| 200 + 流内 `run_failed` | 最糟：客户端已经准备好解析 SSE，却收到一个「执行失败」；但根本没有执行，也没有 `runId` 语义 |

**400 + `App is not published`** 的语义是：

> 请求本身合法、凭证也合法，但**应用的状态**不满足这次调用；请先发布，再用同一个请求重试。

它是**可操作的**：错误文案直接告诉调用方「该做什么」。这与阶段 8「分支预检」、阶段 9「`useHistory` 缺会话」选 400 的理由一致——**资源在、状态不对，用 400**。

### 14.3 appId 不匹配：为什么「应用存在给 401、不存在给 404」

```ts
    if (authenticated.appId !== appId) {
      const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
      if (app === null) {
        throw new NotFoundException('App not found')
      }
      throw new UnauthorizedException('Invalid API key')
    }
```

两种情况的本质不同：

| 情况 | 语义 | 状态 |
| --- | --- | --- |
| 路径里的 `appId` **根本不存在** | 你请求的**资源**不存在 | 404 `App not found` |
| 路径里的 `appId` **存在**，但 key 不是它的 | 资源在，但**这张凭证不认证这个资源** | 401 `Invalid API key` |

为什么不是 403？因为「我有一张 A 应用的 key」并不等于「我已经通过了 B 应用的认证」。401 的含义是「你没有（对这张资源的）有效认证凭证」，正好对应；403 是「认证过了，但不允许」，这里没有「认证过」。

为什么允许对「存在性」给 404？因为调用方**已经持有一张有效 key**（第 2 步已通过）。对「已认证的调用方」泄露一个 `appId` 是否存在，风险可接受；而区分 404 / 401 能显著降低排障成本：

- 404 → 「你的 `appId` 写错了 / 应用被删了」；
- 401 → 「`appId` 是对的，但你拿的是别的应用的 key」。

这与阶段 1/2 的「非本人一律 404 不泄露存在性」**不冲突**：那里的调用方是「任意登录用户」，这里是「某个应用的合法 key 持有者」。信任级别不同，信息暴露的边界也不同。

### 14.4 补充：框架层的 DTO 校验比 handler 更早

源码里 `@Body() body: PublicRunRequestDto` 会先经过全局 `ValidationPipe`，然后才进入 `run()` 方法体；FastAPI 也是在进入 `run_public_app` 之前完成 `PublicRunRequest` 解析。所以真实顺序的最前面还有一步：

```
0. 请求体校验（DTO / Pydantic）
1. 取 key
2. authenticate
3. appId 比对
4. 应用存在 / 已发布
5. precheck
```

这意味着：

| 请求 | 实际结果 |
| --- | --- |
| 无 key + 合法 body | 401 `Missing API key` |
| 无 key + body 里有 `conversationId` | **400 `conversationId should not exist`**（第 0 步先失败） |
| 有无效 key + body 里有 `conversationId` | 400 `conversationId should not exist` |

也就是说，§14.1 的「五步顺序」描述的是 **handler 内部**的顺序；整体顺序还要把框架的 body 校验放在最前。这一点在两端的表现完全一致（都先解析 body）。

> 如果你在写测试，请**每组只测一个变量**：测 401 就用合法 body；测 DTO 拒绝就带上任意 key。否则会得到「看起来矛盾」的状态码。

---

## 15. 【技术教学 · 首次】对外接口不支持的字段

### 15.1 现象

```powershell
curl.exe -s -X POST "http://localhost:3001/public/apps/$APP_ID/run" `
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"hello\"},\"conversationId\":\"c1\"}"
```

两端都是 **400**，普通 JSON：

```json
{
  "statusCode": 400,
  "message": "conversationId should not exist",
  "error": "Bad Request"
}
```

### 15.2 它是怎么被拒绝的

| 端 | 机制 | 具体 |
| --- | --- | --- |
| TS | `whitelist` + `forbidNonWhitelisted` | `PublicRunRequestDto` 只有 `inputs`；`conversationId` 不在白名单 → `whitelistValidation` → `conversationId should not exist` |
| Py | Pydantic `extra="forbid"` | 模型只有 `inputs`；多出的键 → `extra_forbidden` → 同一句文案 |

契约层再兜一层：

```yaml
      additionalProperties: false
```

所以「只允许 `inputs`」在**三个层次**同时成立：契约文档、框架校验、错误文案目录（`packages/contract/error-messages.md` §10 之外的通用规则 §2）。这比「在 handler 里手动删掉 `conversationId`」可靠得多——后者会让 OpenAPI 与实际行为不一致，也会让 SDK 生成出错误的类型。

### 15.3 为什么是「拒绝」而不是「忽略」

| 方案 | 后果 |
| --- | --- |
| 静默忽略 `conversationId` | 调用方以为「多轮对话生效了」，实际上每轮都是全新的；这种 bug 不报错、只表现为「AI 记不住」，极难归因 |
| 接受但不用 | 同上，且契约撒谎 |
| **拒绝（400）** | 调用方立刻知道「这个接口不支持会话」，要么改用调试接口，要么去掉字段 |

这是「**显式失败优于静默降级**」的又一例：与阶段 9 的「`useHistory` 缺会话 → 400 而不是空历史」同构。

### 15.4 边界：`inputs` 内部不限制键

```yaml
        inputs:
          type: object
          additionalProperties: true
```

`inputs` 里的键由图的 `start` 节点声明（`data.inputs[].name`），服务端不逐个校验：

- 多传的键不会报错，只是模板里用不到；
- 少传的必填键也不会在 DTO 层报错（`start` 节点在运行时按 `required` 处理）。

**外层严格、内层宽松**是刻意的：外层的字段是**协议**（版本 1 只有 `inputs`），内层的字段是**用户图的变量**（每个应用都不同）。

---

## 16. 【技术教学 · 首次】`lastUsedAt` 的更新位置

### 16.1 代码位置

```ts
    if (found === null || found.revokedAt !== null) {
      throw new UnauthorizedException('Invalid API key')
    }
    await this.prisma.apiKey.update({
      where: { id: found.id },
      data: { lastUsedAt: new Date() },
    })
    return { appId: found.appId, ownerId: found.ownerId }
```

`lastUsedAt` 在 `authenticate` **内部**、校验通过后立刻写，然后才返回；`PublicController` 拿到返回值**之后**才比对 `appId`。所以：

```
authenticate（更新 lastUsedAt） → 比对 appId（可能 401） → 运行（可能 404/400）
```

### 16.2 这带来一个「小瑕疵」

| 场景 | `lastUsedAt` 会更新吗 | 结果 |
| --- | --- | --- |
| key 有效，appId 匹配，运行成功 | ✅ | 合理 |
| key 有效，appId 匹配，但应用未发布 | ✅ | 可接受（key 确实被用过） |
| key 有效，appId **不匹配**，目标应用存在 → 401 | ✅ | **小瑕疵**：这次请求没有获得任何执行权限，却刷新了使用时间 |
| key 有效，appId **不匹配**，目标应用不存在 → 404 | ✅ | 同上 |
| key 无效 / 已撤销 | ❌ | 正确（在更新之前就抛错） |

两端**完全一致**：Python 的 `authenticate` 也是先 `commit` 新的 `last_used_at`，再返回给路由比对 `appId`，注释里甚至写明了这个行为。

### 16.3 为什么接受它

- 语义可以解释为「**key 被成功出示过**」，而不是「key 被成功用于它自己的应用」；
- 要在 appId 比对之后再更新，必须把「key 的 id」或「路径 appId」传进服务层，让 `authenticate` 从「认证」变成「认证 + 授权」，职责变混；
- 或者让路由在校验完再调一次 `touchLastUsed(keyId)`，多一次 DB 写、多一个公开方法；
- 影响面很小：只是一个展示字段（key 列表里的「最近使用」），不参与任何鉴权或计费。

**如实记录**：如果以后要按 `lastUsedAt` 做计费 / 配额 / 审计，必须先把更新点移到「认证 + 授权都通过」之后，否则「拿 A 的 key 探测 B」也会计入使用量。

### 16.4 发布 / 未发布也更新，是同一类语义

即使 key 完全正确、`appId` 匹配，只要应用未发布，运行会 400，但 `lastUsedAt` 已经更新。这同样是「出示成功 ≠ 运行成功」。如果产品上要区分「尝试」与「成功」，应另设字段（例如 `lastRunAt`），而不是复用 `lastUsedAt`。

---

## 17. 【技术教学 · 首次】对外运行的事件流与调试运行完全一致

### 17.1 同一套构造器

`runPublished` 最后一行是：

```ts
    return this.execute(appId, graph, inputs)
```

`execute` 与草稿运行共用：

```ts
    const queue = new RunEventQueue()
    const runId = randomUUID()
    queue.emit(runStarted(runId, appId, conversation?.id))
    void this.runGraph(graph, inputs, queue, runId, conversation)
    yield* queue.drain()
```

事件对象由 `events.ts` 的同一批函数构造，帧由同一个 `formatSseFrame` 序列化。Python 侧同理：`run_published` 返回 `run_stream(...)`，而 `run_stream` 是草稿运行也在用的同一个函数。

### 17.2 对外运行的 SSE 实样

```text
event: run_started
data: {"runId":"...","appId":"..."}

event: token
data: {"nodeId":"llm","text":"echo:"}

event: run_finished
data: {"runId":"...","outputs":{"text":"echo: Hello mini-dify"},"elapsedMs":67}
```

（节选；`run_started` 与第一帧 `token` 之间还有各节点的 `node_started` / `node_finished`。每帧以一个空行结束，帧与帧之间恰好一个空行。）

与调试运行对比，**事件名、顺序、payload 键集合、帧格式完全相同**。唯一不同的是**值**：`runId` 是随机的、`elapsedMs` 取决于机器与 mock 延迟；`run_started` 里**没有** `conversationId`（因为对外没有会话）。

### 17.3 「对外不是另一套协议」意味着什么

| 如果对外是另一套协议 | 本项目的做法 |
| --- | --- |
| 客户端要写两套解析器 | 一套解析器同时支持调试与对外 |
| 事件名可能不同（如 `public_token`） | 同名同形 |
| 终态语义可能不同 | 同样是 `run_finished` / `run_failed`，同样「终态唯一」 |
| 帧格式可能不同（如 NDJSON） | 同样是 `event:` + `data:` + 空行 |
| 验收要分别做 | 阶段 4 的帧级断言可以直接复用；阶段 10 只需再加「归一化后 PY==TS」 |

**「对外」改变的是「谁能调、跑哪张图」，不是「跑起来长什么样」。** 这句话既是设计原则，也是验收方法：只要对外的帧与调试的帧在归一化后相同，就说明两个入口没有悄悄分叉。

### 17.4 流内仍然可能失败

对外运行同样会有 `run_failed`：

- 模板变量缺失（严格解析）；
- LLM provider 报错（阶段 5 的规范化文案）；
- 工具超时 / 错误；
- assistant 消息写入失败（但对外没有会话，不会触发这条）。

它们仍然是 **200 + SSE + 一帧 `run_failed`**，与调试运行一致。4xx 与 `run_failed` 的分工没有因为「对外」而改变（双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`）。

---

## 18. 实测

以下结果在 Windows + `apps/api-ts` / `apps/api-py` + `tools/mock-llm` 上实跑得到。

### 18.1 测试图与准备

一张最小的 start → llm → end 图（`prompt` 为 `echo:` 前缀的 mock 模板），先 `publish`，再用 key 对外运行。

```jsonc
{
  "version": "1",
  "nodes": [
    { "id": "start_1", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "inputs": [{ "name": "topic", "required": true }] } },
    { "id": "llm", "type": "llm", "position": { "x": 160, "y": 0 },
      "data": { "title": "回答", "prompt": "{{ inputs.topic }}" } },
    { "id": "end_1", "type": "end", "position": { "x": 320, "y": 0 },
      "data": { "outputs": [{ "name": "text", "value": "{{ llm.text }}" }] } }
  ],
  "edges": [
    { "id": "e1", "source": "start_1", "target": "llm" },
    { "id": "e2", "source": "llm", "target": "end_1" }
  ]
}
```

### 18.2 两种认证头都能跑通

| 请求头 | 结果 |
| --- | --- |
| `X-API-Key: <KEY>` | 200 + SSE |
| `Authorization: Bearer <KEY>` | 200 + SSE |

两组 SSE 在**归一化 `runId` / `elapsedMs` 后完全相同**；未归一化时只有这两个值不同（它们是每次运行随机 / 计时的）。

### 18.3 完整 SSE（节选）

```text
event: run_started
data: {"runId":"...","appId":"..."}
event: token
data: {"nodeId":"llm","text":"echo:"}
...
event: run_finished
data: {"runId":"...","outputs":{"text":"echo: Hello mini-dify"},"elapsedMs":67}
```

- `run_started` 的键集合是 `["runId","appId"]`，**没有** `conversationId`；
- `run_finished` 的 `outputs` 与调试运行同形；
- `elapsedMs` 每次不同，不能作为稳定性断言。

### 18.4 草稿隔离

把草稿 `prompt` 改成 `DRAFT-CHANGED {{ inputs.topic }}` 后：

| 检查 | 结果 |
| --- | --- |
| 对外运行输出 | 仍是 `echo: Hello mini-dify`（旧快照） |
| `GET /apps/{id}/graph/published` | 仍是 `{{ inputs.topic }}`（旧快照） |
| 重新发布后再运行 | 才变成 `echo: DRAFT-CHANGED Hello mini-dify` |

这条实测直接证明了 §10.4：对外读的是 `published_graph_json`，与 `graph_json` 无关。

### 18.5 两端一致

同一张图、同一组 `inputs`、同一组 key，在 `api-ts` 与 `api-py` 上各跑一次，归一化 `runId` / `appId` / `elapsedMs` / `usage` 后逐帧比较：

```text
normalized PY == TS: True
```

这意味着：事件序列、每帧键集合、payload 内容、帧格式在两端完全相同。`precheck` 的抽取、`runPublished` 的三处差异、SSE 头与帧序列化，都没有引入分叉。

### 18.6 9 组错误文案逐字节相等

| # | 触发方式 | HTTP | message |
| --- | --- | --- | --- |
| 1 | 不带任何 key 头 | 401 | `Missing API key` |
| 2 | 随机 / 乱码 key | 401 | `Invalid API key` |
| 3 | 先撤销，再用旧 key | 401 | `Invalid API key` |
| 4 | 拿 A 应用的 key 调 B 应用（B 存在） | 401 | `Invalid API key` |
| 5 | key 正确，但应用从未发布 | 400 | `App is not published` |
| 6 | key 正确，但路径 `appId` 不存在 | 404 | `App not found` |
| 7 | 新建 key 重名（同应用、未撤销） | 400 | `API key name already exists` |
| 8 | 新建 key 名称超过 60 字符 | 400 | `API key name is too long` |
| 9 | 撤销一个不存在 / 不属于自己的 key id | 404 | `API key not found` |

两端这 9 组 `message` **byte-equal**（完整信封形状见阶段 1 的 `ErrorResponse`；这里只断言文案与状态码）。

> 注意第 4 组与第 5 组的分工：`appId` 不匹配是**鉴权**问题（401），未发布是**状态**问题（400）。如果实现把两者都写成 401，客户端就无法区分「key 错了」和「还没发布」。

### 18.7 回归

阶段 5~9 的全部验收重新跑过，**全部通过**。这说明：

- `precheck` 抽取没有改变草稿运行的任何文案与顺序；
- `runPublished` 的加入没有影响 `/apps/{id}/run`；
- 事件构造器与帧序列化仍然是同一份。

---

## 19. 验收自测

| 检查项 | 做法 | 预期 |
| --- | --- | --- |
| 契约编译 | `pnpm run build:contract` | 无报错 |
| NestJS 编译 | `pnpm --filter @mini-dify/api-ts build` | 无报错 |
| `X-API-Key` | 用 `-H "X-API-Key: $KEY"` 运行 | 200 + SSE |
| Bearer | 用 `-H "Authorization: Bearer $KEY"` 运行 | 200 + SSE，归一化后与上项相同 |
| 无 key | 去掉 key 头 | 401 `Missing API key` |
| 乱码 key | `-H "X-API-Key: sk-nope"` | 401 `Invalid API key` |
| 撤销后 | `DELETE /api-keys/{id}` 后再用 | 401 `Invalid API key` |
| A key 调 B | A 的 key + B 的 appId | B 存在 → 401；B 不存在 → 404 |
| 未发布 | 新建应用（不发布）→ 建 key → 运行 | 400 `App is not published` |
| 草稿隔离 | 改草稿后不发布，再对外运行 | 输出不变 |
| 会话字段 | body 加 `conversationId` | 400 `conversationId should not exist` |
| 预检前置 | 对外跑一张引用不存在知识库的已发布图 | 400（普通 JSON，不是 SSE） |
| 事件一致 | 同一图分别调两个入口 | 归一化 `runId` / `elapsedMs` 后帧相同 |
| 双端一致 | 同一请求分别打 3001 / 8000 | `normalized PY == TS: True` |
| 回归 | 阶段 5~9 验收 | 全部通过 |

**可复现的最小命令序列**（PowerShell，api-ts 为例）：

```powershell
# 0) 另开终端常驻 mock provider
node tools/mock-llm/server.mjs

# 1) 启动 api-ts
pnpm --filter @mini-dify/api-ts start:dev

# 2) 登录拿 JWT（沿用阶段 1 的账号）
$LOGIN = curl.exe -s -X POST "http://localhost:3001/auth/login" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"demo@example.com\",\"password\":\"password123\"}"
$TOKEN = ($LOGIN | ConvertFrom-Json).accessToken

# 3) 建应用并写入 §18.1 的图
$APP_ID = "<APP_ID>"

# 4) 发布快照
curl.exe -s -X POST "http://localhost:3001/apps/$APP_ID/graph/publish" `
  -H "Authorization: Bearer $TOKEN"

# 5) 建 key（明文只返回一次）
$KEY = (curl.exe -s -X POST "http://localhost:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d "{\"name\":\"demo\"}" | ConvertFrom-Json).key

# 6) 对外运行（X-API-Key）
curl.exe -N -X POST "http://localhost:3001/public/apps/$APP_ID/run" `
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"Hello mini-dify\"}}"

# 7) 对外运行（Bearer）
curl.exe -N -X POST "http://localhost:3001/public/apps/$APP_ID/run" `
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"Hello mini-dify\"}}"

# 8) 不支持的字段
curl.exe -s -X POST "http://localhost:3001/public/apps/$APP_ID/run" `
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"x\"},\"conversationId\":\"c1\"}"

# 9) 草稿隔离：改草稿（不发布），再跑第 6 步
curl.exe -s -X PUT "http://localhost:3001/apps/$APP_ID/graph" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d "@graph-draft-changed.json"
```

---

## 20. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **★ 用 JWT 调对外接口** | 401 `Invalid API key` | 对外只认 API Key；JWT 不是 key（`authenticate` 按哈希查不到） |
| **★ 用 API Key 调调试接口** | 401（JWT Guard 报未授权） | `/apps/{id}/run` 只认 `Authorization: Bearer <JWT>` |
| **★ 改成草稿后期待对外立刻生效** | 输出还是旧的 | 对外读 `published_graph_json`；必须重新 `POST /graph/publish`（§18.4） |
| **★ 传 `conversationId` 给对外接口** | 400 `conversationId should not exist` | `PublicRunRequest` 只有 `inputs` + `additionalProperties: false`（§15） |
| 小写 `bearer` / 大写 `BEARER` | 401 `Missing API key` | 两端只认精确 `Bearer ` 前缀（§13.3） |
| `Authorization` 里带 token 但没写 `Bearer` | 401 `Missing API key` | 不是合法前缀，视为未提供 |
| 同时带错误 `X-API-Key` 与正确 Bearer | 401 `Invalid API key` | 优先级只看「有没有」，不回退（§13.2） |
| `X-API-Key` 是空白串 + Bearer 正确 | 200 | 空白视为未提供，回退到 Bearer（两端一致） |
| **A 的 key 调 B（B 不存在）** | 404 `App not found`，但 A 的 `lastUsedAt` 被刷新 | 先认证再比 appId；这是已知小瑕疵（§16） |
| **未发布** | 400 `App is not published` | 不是 404：应用存在、状态不满足（§14.2） |
| 把 `Graph not published` 与 `App is not published` 搞混 | 管理端 `GET /graph/published` 是 404 `Graph not published`；对外运行是 400 `App is not published` | 前者是「图资源不存在」，后者是「应用状态未发布」 |
| 以为 `useHistory` 的图能对外跑 | 400 `llm node xxx useHistory requires a conversation` | 对外 `hasConversation = false`（§12.3） |
| 以为对外会「自动忽略」会话字段 | 实际 400 | 这是显式失败，防止「以为有记忆」（§15.3） |
| 发布后删掉知识库 | 对外运行 400 `references unknown knowledge base` | `publish` 只校验图结构；运行时 `precheck` 仍查归属（§10.4 末尾） |
| 改了 `.env` 不重启 | 配置不生效 | `process.env` / `Settings` 在进程启动时确定（阶段 9 已记录） |
| 既没 key 又传了非法 body | 400 `... should not exist`，不是 401 | 框架层 body 校验先于 handler（§14.4） |
| 以为「200 就代表跑成功」 | 流里可能有 `run_failed` | SSE 的双通道错误：4xx 在流外，执行失败在流内（§17.4） |
| 在生产直接暴露 `/public` 不限流 | 可被刷 key / 刷模型费用 | 控制器注释已标注「生产应加限流」，本阶段未实现 |
| 以为 key 明文可再次查看 | 列表只有 `prefix` | 明文只在创建响应里出现一次（本阶段第 01/02 篇） |

---

## 21. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **⭐ 同一套引擎、两套入口** | `/apps/{id}/run`（JWT、草稿）与 `/public/apps/{appId}/run`（API Key、快照）只复制「门卫」，不复制「执行」；事件协议因此结构性地一致 | **首次教学于本篇** |
| **⭐ `precheck()` 抽取** | 两个入口的预检差异被收敛为 `(ownerId, graph, hasConversation)` 三个实参；复制粘贴会让规则漂移，表现为「一个入口 400、另一个入口流内 `run_failed`」 | **首次教学于本篇** |
| **`runPublished` 与 `run` 的三处差异** | 鉴权方式、图来源（快照 vs 草稿）、是否有会话；其余（`execute` / 事件 / 帧 / 双通道错误）完全复用 | **首次教学于本篇** |
| **API Key 双头的优先级与回退** | `X-API-Key` 优先，`Authorization: Bearer <key>` 兜底；只在「缺失 / 空白」时回退，校验失败不回退；`Bearer ` 大小写敏感 | **首次教学于本篇** |
| **对外运行校验顺序与状态码语义** | 无 key 401 → 无效/撤销 401 → appId 不匹配（存在 401 / 不存在 404）→ 未发布 400 → 预检 400；未发布用 400 是因为「资源在、状态不对」 | **首次教学于本篇** |
| **框架层 body 校验先于 handler** | DTO / Pydantic 在进入 handler 前完成，所以「无 key + 多字段」得到 400 而不是 401 | **首次教学于本篇** |
| **`PublicRunRequest` 只允许 `inputs`** | `additionalProperties: false` + `whitelist/forbidNonWhitelisted` / `extra="forbid"` → 400 `conversationId should not exist`；显式失败而非静默忽略 | **首次教学于本篇** |
| **`lastUsedAt` 的更新位置** | 认证成功即写，早于 appId 比对，因此 A key 调 B 也会刷新；两端一致，属可接受小瑕疵（对计费/配额不适用） | **首次教学于本篇** |
| **对外事件流与调试完全一致** | 同一 `execute` / `run_stream`、同一事件构造器、同一帧序列化；对外不新增事件名、不新增 payload 键 | **首次教学于本篇** |
| **「`async def` 返回生成器 + `await`」保证先校验后开流** | 非生成器协程在 `await` 时执行完全部检查，404/400 才能是普通 JSON；若写成 `yield` 则会等迭代才执行 | **首次教学于本篇** |
| **`App is not published`（400）vs `Graph not published`（404）** | 前者是应用状态，后者是图资源不存在；两个接口的语义不同 | 本篇（支撑说明，发布语义见本阶段第 `01`/`02` 篇） |
| **key 校验的防泄露文案** | 「查不到」与「已撤销」合并为 `Invalid API key`，避免 key 存在性被探测 | 本篇（`authenticate` 的实现细节） |

> 已在前序篇教学、本篇仅引用不重讲的：SSE 帧格式与双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；`ChatOpenAI` / 真流式见 `05-LLM节点/02-真实模型调用与流式.md`；`knowledge` 预检见 `07-知识库RAG/03-NestJS检索与检索节点.md`；`ValidationPipe` 与错误文案归一见 `01-账号与认证/03-NestJS认证.md`、`02-应用管理/07-验收.md`；草稿/快照两态见 `03-画布/02-Prisma-JSONB与两态.md`；会话注入见 `09-会话与记忆/02-历史加载与上下文注入-NestJS.md`。
