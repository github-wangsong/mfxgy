# 05 · SSE 流式响应实现

> 所属：阶段 4 · 执行引擎
> 本篇覆盖：`POST /apps/{id}/run` 的**服务端**如何把执行器产出的事件「**不结束响应地**」持续写回前端——TS 侧 `RunController`（用底层 `Response` 手写流），Py 侧 `run_app` 路由（用 `StreamingResponse` 包一个异步生成器）。**引擎主体**（把图编译成 LangGraph、按拓扑序执行、构造事件、事件队列）见本阶段 `01-运行契约与SSE事件协议.md`（契约与事件协议）/ `02-LangGraph编译图-TS.md`（TS 引擎与事件队列）/ `03-节点运行时与变量池.md`（节点与模板语义）/ `04-LangGraph与引擎-Python.md`（Py 引擎）；**前端消费与渲染**见下一篇 `06-前端SSE客户端与运行面板.md`，**端到端验收**见 `07-验收.md`。
> **本篇首次教学**：**服务端「不结束响应」地持续写**（NestJS 用底层 `Response` 手写流：`res.setHeader` / `flushHeaders` / `res.write`；FastAPI 用 `StreamingResponse` 包一个**异步生成器**）· **为什么本项目不用 NestJS 的 `@Sse()` 装饰器**（`@Sse()` 的序列化细节不可控，而我们要**固定帧格式**保证两端逐字节一致）· `content-type` 必须**严格**为 `text/event-stream`（Starlette 默认会追加 `; charset=utf-8`，已显式去掉以对齐）· **事件队列 → 流的桥接**（`RunEventQueue` / `asyncio.Queue` 把「执行器产出」与「HTTP 响应」解耦）· 响应头为何要 `Cache-Control: no-cache` 与 `Connection: keep-alive` · **错误分流**：请求级错误（图非法 / 草稿为空 / 未认证 / 归属不符）在**开流之前**就返回普通 JSON —— 一旦开始写流就无法再改状态码，讲清「**先校验、后开流**」的顺序必要性
> （NestJS 装饰器 `@Controller`/`@Post`/`@Res` 见阶段 0 · 05；Express `Response` 见阶段 0 · 05；FastAPI `APIRouter`/`Depends`/`HTTPException` 见阶段 0 · 06 与阶段 1 · 05；`JwtAuthGuard` / `CurrentUser` 见阶段 1 · 03；`_find_owned` 归属校验见阶段 2 · 05；LangGraph 编译与事件构造见本阶段 02 / 03 / 04——本篇**只引用、不重讲**）

---

## 1. 本篇目标

做完这一篇，你能：

- 讲清楚**服务端怎么做到「不结束响应、持续往外写」**：HTTP 本是一次「请求 → 响应 → 结束」，SSE 借「**不结束**这次响应、分多次写同一具 body」实现推送。
- 用 **NestJS 底层 `Response`** 手写一条 SSE 流（`setHeader` → `flushHeaders` → 循环 `write` → `end`），并理解为什么**不用** `@Sse()`。
- 用 **FastAPI `StreamingResponse`** 包一个**异步生成器**产出同一套帧，并理解 `media_type` 与 `content-type` 的关系。
- 讲清楚**事件队列 → 流**的桥接：执行器（LangGraph）在后台跑、把事件塞进队列；路由从队列另一端逐条取出、写进 HTTP body。
- 讲清楚**为什么必须先校验、后开流**：请求级错误在返回流之前就以 400 JSON 出去；一旦 `flushHeaders` 之后写错了，状态码也改不回来。
- 理解 `Cache-Control: no-cache` 为什么对 SSE 必需。

**验收标准（对齐总纲 §6 阶段 4）**

> 调试页能逐字输出。

本篇只负责**服务端把帧发对**；「前端逐字显示」在下一篇验收。具体化到本篇可执行层面：

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 用 `curl -N` 打 `POST /apps/{id}/run`（合法图） | 帧**逐条、有时间间隔地**到达终端（不是等全部算完一次性刷出） |
| 2 | 响应头 | `content-type: text/event-stream`（**不带** `; charset=utf-8`）、`cache-control: no-cache` |
| 3 | 帧格式 | 每个事件恰好是 `event: <name>\n` + `data: <单行 JSON>\n\n` |
| 4 | `llm` 节点流式 | 能看到**多条** `token` 帧，`text` 依次拼接出完整文本 |
| 5 | 成功收束 | 以 `run_finished` 帧结束，其 `outputs` 为 end 节点渲染结果 |
| 6 | 草稿为空直接运行 | HTTP **400**、`content-type: application/json`、body 为 `{"statusCode":400,"message":"Graph is empty","error":"Bad Request"}`（**不是流**） |
| 7 | 非法图（如删掉 end）运行 | 同上，`message` 为后端图校验原文（如 `graph must contain at least one end node`） |
| 8 | 两套后端（`api-ts` / `api-py`） | **逐字节相同**的帧与事件序列 |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| Node / pnpm、`pnpm install` 已执行 | 阶段 0 · 01 / 03 |
| PostgreSQL 容器在跑（引擎要读草稿 `graphJson`） | 阶段 0 · 02 |
| 契约包已构建（`RunEvent` 等类型） | 阶段 0 · 04；本阶段 `01-运行契约与SSE事件协议.md` |
| `POST /apps/{id}/run` 已进契约（`openapi.yaml` 的 `/apps/{id}/run`，`RunRequest`） | 本阶段 `01-运行契约与SSE事件协议.md` |
| 唯一真源事件协议 `packages/contract/sse-events.md` 已冻结 | 本阶段 `01-运行契约与SSE事件协议.md` |
| 执行引擎已实现：`EngineService.run`（TS）与 `run_stream`（Py）能产出 `AsyncGenerator<RunEvent>` | 本阶段 `02-LangGraph编译图-TS.md` / `04-LangGraph与引擎-Python.md` |
| 节点执行器已实现（`start` / `llm` / `end` + 模板） | 本阶段 `03-节点运行时与变量池.md` |
| 已注册并登录过一个用户，且**有一个合法草稿图**（`start → llm → end`，start 声明了输入、end 声明了输出 `result`） | 阶段 1 · 07；阶段 2 · 06；阶段 3 · 06 |
| **至少一套后端在跑**（`api-ts` → 3001，或 `api-py` → 8000） | 阶段 0 · 05 / 06 |

> 契约一致（阶段 0 · 08）⇒ 两套后端对同一请求产出**逐字节相同**的 SSE 帧。把 `api-ts` 换成 `api-py`，本篇的 curl 观察结果一致。

---

## 3. 命令清单（逐条说明）

本篇不新增依赖，主要是**启动 + 观察流**。所有命令都在**仓库根**（`mini-dify/`）执行；Windows PowerShell 下 `curl` 是 `Invoke-WebRequest` 的别名，请显式用 **`curl.exe`**（Windows 10+ 自带）。

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `docker compose up -d db` | 仓库根 | 起 PostgreSQL（引擎读草稿） | 容器 `Up`（`docker compose ps` 可见） |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001），含本轮 `RunController` | `api-ts listening on http://localhost:3001` |
| （或）`pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000），含本轮 `run_app` | `Uvicorn running on http://127.0.0.1:8000` |
| `curl.exe -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" -d "{\"email\":\"alice@example.com\",\"password\":\"<你的密码>\"}"` | 任意终端 | 登录拿 token | 返回 `{"accessToken":"...","expiresIn":3600}`（阶段 1 · 07） |
| `curl.exe -N -X POST http://localhost:3001/apps/<APP_ID>/run -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" -d "{\"inputs\":{}}"` | 任意终端 | **观察流**：`-N`（`--no-buffer`）关闭 curl 自己的缓冲，才能看到**逐帧到达** | 见第 6 节实测回放 |
| `curl.exe -i -X POST .../run ... -d "{\"inputs\":{}}"` | 任意终端 | 观察**错误分流**：草稿为空 / 图非法时是 400 JSON | `HTTP/1.1 400 Bad Request` + `content-type: application/json` + 错误信封 |

> `pnpm dev:api-ts` / `pnpm dev:api-py` 是根脚本（分别见阶段 0 · 05 / 06），**只引用不重讲**。
>
> `-N` 是关键：curl 默认会缓冲输出、等响应结束才打印；`-N` 让它**收到多少就吐多少**，这才看得出「流」。

---

## 4. 完整代码

本步**新增两个路由文件**（引擎主体已在 02/03 落地）。路由文件与引擎的分工：

```
apps/api-ts/src/engine/
├── engine.module.ts      # 注册 RunController + EngineService（未改）
├── engine.service.ts     # 引擎主体：预检 + 编译执行 + 事件队列（见 02）
├── events.ts             # 事件构造 + formatSseFrame + RunEventQueue（见 02）
├── dto/run.dto.ts        # RunRequestDto（见 01）
├── run.controller.ts     # ← 本篇：HTTP 路由，手写 SSE 流
└── nodes/…               # 节点执行器（见 04）

apps/api-py/app/
├── engine/engine.py      # 引擎主体：预检 + 编译执行 + asyncio.Queue（见 03）
├── engine/events.py      # 事件构造 + format_sse_frame（见 03）
└── api/run.py            # ← 本篇：HTTP 路由，StreamingResponse
```

### 4.1 `apps/api-ts/src/engine/run.controller.ts`（新增）

**完整文件路径：`apps/api-ts/src/engine/run.controller.ts`**

```ts
import { Body, Controller, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'

import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard'
import { RunRequestDto } from './dto/run.dto'
import { EngineService } from './engine.service'
import { formatSseFrame } from './events'

/**
 * `POST /apps/{id}/run` —— 契约见 packages/contract/openapi.yaml，
 * 事件协议见 packages/contract/sse-events.md。
 *
 * 帧格式（`event: <name>\n` + `data: <单行 JSON>\n\n`）要求完全可控，故**不使用** `@Sse()`：
 * NestJS 的 `@Sse()` 序列化细节会引入偏差，这里直接用底层 `Response` 手写 SSE 帧。
 *
 * 预检失败时 `EngineService.run` 会在**写任何响应头之前**抛出
 * `BadRequestException` / `NotFoundException`，由全局 `HttpErrorFilter` 归成普通 JSON。
 */
@Controller('apps')
@UseGuards(JwtAuthGuard)
export class RunController {
  constructor(private readonly engineService: EngineService) {}

  @Post(':id/run')
  @HttpCode(200)
  async run(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() body: RunRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    const events = await this.engineService.run(payload.sub, id, body.inputs)
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
```

### 4.2 `apps/api-py/app/api/run.py`（新增）

**完整文件路径：`apps/api-py/app/api/run.py`**

```python
"""`POST /apps/{id}/run` 路由 —— 契约见 packages/contract/openapi.yaml，
事件协议见 packages/contract/sse-events.md。

行为与 api-ts 的 `RunController` / `EngineService` 保持一致：
- 运行当前**草稿**图；草稿为 NULL 即 400 `Graph is empty`；
- 运行前预检（`validate_graph` + 节点数据形状），不通过即 400（**普通 JSON**，不是流）；
- 归属校验复用 `app.api.apps._find_owned`（查不到 / 非本人一律 404）；
- 预检全部通过后才用 `StreamingResponse(media_type="text/event-stream")` 手写 SSE 帧。
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.apps import _find_owned
from app.api.deps import get_current_user, get_db
from app.engine.engine import run_stream, validate_node_data
from app.graph.validator import validate_graph
from app.models.user import User

router = APIRouter(prefix="/apps", tags=["apps"])


class RunRequest(BaseModel):
    """对应契约 `RunRequest`。"""

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any]


@router.post("/{id}/run", operation_id="runApp")
async def run_app(
    id: str,
    body: RunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    app = _find_owned(db, current_user.id, id)
    if app.graph_json is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Graph is empty")
    graph = app.graph_json
    errors = [*validate_graph(graph), *validate_node_data(graph)]
    if errors:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors))
    return StreamingResponse(
        run_stream(app.id, graph, body.inputs),
        media_type="text/event-stream",
        # 显式给出 content-type，避免 Starlette 追加 `; charset=utf-8`，与 api-ts 的响应头对齐
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
    )
```

**逐项解释**

- `run.controller.ts` 的 `@Controller('apps')` + `@Post(':id/run')`：拼出 `POST /apps/{id}/run`。`@UseGuards(JwtAuthGuard)` 复用阶段 1 · 03 的守卫，未带 Bearer 令牌即为 401（`CurrentUser` 从 `JwtPayload` 取 `sub` 作 `ownerId`）。
- `@HttpCode(200)`：NestJS 对 `@Post` 默认返回 **201**；SSE 必须是 **200**，故显式改回。
- `@Res() response: Response`：**手动接管响应**。一旦注入 `@Res()`，NestJS 就**不再**帮你序列化返回值——你得自己写完再 `response.end()`（这也是它能「不结束地写」的前提）。
- `@Body() body: RunRequestDto`：`inputs` 走全局 `ValidationPipe`（阶段 1 · 03）；`RunRequestDto` 只要求 `inputs` 是对象（本阶段 01）。
- `engineService.run(...)` 返回 `AsyncGenerator<RunEvent>`（本阶段 02）：**注意它 `await` 在 `setHeader` 之前**——预检失败会在这里就直接抛异常（见 5.6）。
- `setHeader` × 3 + `flushHeaders()`：**先把响应头冲出去**再开始写 body（见 5.1 / 5.5）。
- `for await (const event of events) response.write(formatSseFrame(event))` + `response.end()`：逐事件序列化成帧、写进 body，最后收流（见 5.1）。
- `run.py` 的 `RunRequest`：Pydantic `extra="forbid"`（阶段 0 · 06）——请求体多字段即 400。
- `_find_owned(db, current_user.id, id)`：归属校验（阶段 2 · 05），非本人 / 不存在都抛 `HTTPException(404)`。
- `if app.graph_json is None: raise HTTPException(400, "Graph is empty")`：**草稿为空短路**（文案见 `error-messages.md` §4.1.1）。
- `errors = [*validate_graph(graph), *validate_node_data(graph)]`：先图校验（阶段 3 · 01/05）再节点数据校验（本阶段 02 / 04 的引擎预检），多条 `"; "` 连接（`error-messages.md` §4.1）。
- `return StreamingResponse(run_stream(...), media_type=..., headers=...)`：**校验全部通过后**才构造流（见 5.6）。
- `media_type="text/event-stream"` + 显式 `headers={"Content-Type": "text/event-stream"}`：见 5.3。

---

## 5. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 4 · 05」并直接使用。

### 5.1 服务端怎么「不结束响应」地持续写

**一次普通 HTTP 响应的生命**：客户端发请求 → 服务端算出完整结果 → **一次性**写回响应体和 `Content-Length` → 连接（这次响应）结束。客户端拿不到「中间态」。

**SSE（Server-Sent Events）想要的东西**：服务端**不一次性算完**，而是**把同一次响应拆成很多次写**，每次写一小块、客户端每次收到就立刻处理——这就是「流式」。它与「普通响应」的唯一区别是：**服务端迟迟不 `end()`，body 一点一点追加**。

DSL 上，SSE 只是一份「**约定好的纯文本格式**」：每条消息叫一帧，形如

```
event: <name>\n
data: <单行 JSON>\n\n
```

浏览器/客户端按这个格式切帧。本项目把这个格式**逐字节固定**（唯一真源 `packages/contract/sse-events.md` §1），才能保证两套后端产出一致。

**服务端「持续写」在两种框架里怎么落地**：

| | NestJS（TS） | FastAPI（Py） |
| --- | --- | --- |
| 拿到底层响应 | `@Res() response: Response`（Express `Response`，见阶段 0 · 05） | 由框架把「可迭代/可异步迭代的产物」包成响应 |
| 「先冲头」 | `response.setHeader(...)` + **`response.flushHeaders()`** | `StreamingResponse(..., headers={...})`（头在开始发 body 前自动送出） |
| 「一块一块写」 | 循环里 `response.write(chunk)` | 框架 `async for` 迭代生成器，逐块写入 |
| 「收流」 | `response.end()` | 生成器**耗尽**（`StopAsyncIteration`）即自动结束 |

**为什么 NestJS 端要 `flushHeaders()`**：`setHeader` 只是把响应头塞进缓冲，真正发出去要等「第一次写 body」或显式 `flushHeaders()`。先 `flushHeaders()`，客户端才能立刻进入「已开始接收流」的状态；否则要等第一块 body 才看到头。对 SSE 而言，**头越早到达越好**（前端据此判断 `content-type`，见 06）。

**为什么 TS 用「底层 Response」，Py 用「生成器包装」**：这不是框架能力差异，而是**两层抽象的分工不同**。NestJS 把「HTTP 响应对象」直接交到你手里（express 的 `res`），你自己 `write`；FastAPI 则鼓励「你只负责**产出数据**，怎么发由 `StreamingResponse` 管」。两者本质完全一样：**都是一次响应、多次写、最后结束**。

### 5.2 为什么本项目**不用** NestJS 的 `@Sse()` 装饰器

NestJS 提供了现成的 `@Sse()` 装饰器，配 `Observable` 用起来很省事：

```ts
// 本项目**没有**这么写（示意）
@Sse(':id/run')
run(...): Observable<MessageEvent> {
  return new Observable((sub) => { sub.next({ data: '...' }) })
}
```

它的问题在于「**替你决定帧格式**」：

- `@Sse()` 走的是浏览器 `EventSource` 那套约定，它会把每个 `MessageEvent` 序列化成 `data:` 行（可带 `event:` / `id:`），**具体字节由框架决定**；
- 我们要的是**逐字节可控**：`event:` 行在前、`data:` 行恰好一行 JSON、以 `\n\n` 结束，且 TS 与 Py **完全一致**（`sse-events.md` §1 明文固定）；
- `@Sse()` 的 `Observable` 还牵出一套 RxJS 心智，而我们的引擎是**自建 `RunEventQueue`**（见 5.4）——两者耦合反而别扭。

**取舍结论**：为了「**帧格式可控 + 两端一致**」这条硬约束，放弃 `@Sse()` 的便利，改用底层 `Response` 手写。代价是几行样板代码（`setHeader` / `flushHeaders` / `write` / `end`），换来的是契约可验证。

> 反过来，Py 侧若想用 FastAPI 的 `EventSourceResponse`（`sse-starlette` 库）也会遇到同样的「帧格式不可控」问题；本项目直接用原生 `StreamingResponse` 手写，同样是为了可控。

> **与相邻篇的分工**：`02-LangGraph编译图-TS.md` §8 在列 `run.controller.ts` 源码要点时已点到「为什么不用 `@Sse()`」；本篇把它作为**取舍**讲透（§5.1–5.3 聚焦「手写流」本身）。「为什么不用 LangGraph 的 custom stream」在 `02` §15 / `04` §8 有完整论述，本篇不重复。

### 5.3 `content-type` 必须严格为 `text/event-stream`

浏览器/客户端**靠 `content-type` 判断这是一条 SSE 流**。它的值必须是：

```
text/event-stream
```

**Starlette（FastAPI 底层）的默认坑**：给 `StreamingResponse` 传 `media_type="text/event-stream"` 时，Starlette 对「非二进制」媒体类型会**自动追加 `; charset=utf-8`**，实际发出的是：

```
text/event-stream; charset=utf-8     ← 默认行为
```

本项目要两端**响应头逐字节对齐**，故在 `StreamingResponse` 上**显式覆盖** `Content-Type`：

```python
StreamingResponse(
    run_stream(...),
    media_type="text/event-stream",
    headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},  # 覆盖，去掉 charset
)
```

（源码注释即写明：「显式给出 content-type，避免 Starlette 追加 `; charset=utf-8`，与 api-ts 的响应头对齐」。）

TS 侧 `response.setHeader('Content-Type', 'text/event-stream')` 本就**不加 charset**，所以两端最终一致。

> **注意**：`; charset=utf-8` 本身对 SSE **无害**，甚至更正确（SSE 规范默认 UTF-8）。前端 `content-type.includes('text/event-stream')` 的判断（见 06）也照样成立。这里去掉它，纯粹是为了满足「**响应头也逐字节一致**」的契约约束——这是本项目的**自我要求**，不是浏览器要求。

### 5.4 事件队列 → 流的桥接（`RunEventQueue` / `asyncio.Queue`）

引擎执行图（LangGraph）与「往 HTTP 里写」是**两件事**：前者是「算 + 产事件」，后者是「发字节」。本项目用**一个队列**把两者解耦：

```
执行器（后台跑）                    路由（前台写）
─────────────                     ─────────────
run started ─ emit(event) ─┐
                           ▼
                    ┌───────────────┐
node exec  ─ emit ─▶│ RunEventQueue │─▶ for await … drain() ─▶ response.write(frame)
     …              │ / asyncio.Queue│
node exec  ─ emit ─▶└───────────────┘
run finished ─ emit ─┘        close() / put(None) ─▶ drain 结束 ─▶ response.end()
```

- **TS**：`RunEventQueue`（本阶段 02 的 `events.ts`）——`emit` 入队并唤醒等待者；`drain()` 是异步生成器，返回到此为止的所有事件、队列 `close()` 后结束。单线程事件循环下「先 emit 后被 drain」的顺序天然保持。
- **Py**：直接用标准库 `asyncio.Queue`——`await queue.put(event)` 入队；`while True: event = await queue.get()` 取出，取到哨兵 `None`（`put(None)`）就 `break`，把生成器收束。

**为什么要队列，而不是让路由直接 `await 执行器()`**：执行器要**边跑边产事件**，若同步等它跑完再一次性把事件发出去，就**没有流式**（前端会看到「卡一下、然后一次性全出来」）。队列让「产」与「发」**同时进行**：后台任务跑一步产一帧，前台立刻取走发一帧。引擎主体里正是 `void this.runGraph(...)` / `asyncio.create_task(...)` 起了后台任务，再 `yield* queue.drain()` / 循环 `queue.get()`（见本阶段 02 / 04）。

> 这也解释了为什么不直接复用 LangGraph 的 stream：LangGraph 有自己的事件流，但其事件形状不受本项目控制；自建队列能做到「**两端事件顺序与 payload 完全可控、逐字节可比**」（见 `engine.service.ts` 顶注）。

### 5.5 响应头：`Cache-Control` 与 `Connection`

SSE 流要**如实、实时**地到达客户端，不能被中间层缓存或攒着。相关头：

| 头 | 值 | 作用 |
| --- | --- | --- |
| `Content-Type` | `text/event-stream` | 声明这是 SSE 流（见 5.3） |
| `Cache-Control` | `no-cache` | **禁止中间代理缓存**响应；否则某些代理会把流缓存住、攒够才发，前端就看不到「流」了。本项目两端都设（Py 在 `headers=` 里，TS 在 `setHeader`） |
| `Connection` | `keep-alive` | TS 侧显式声明保持连接（HTTP/1.1 默认即 keep-alive）。Py 侧未显式设置，由 uvicorn/ASGI 管理连接 |

> **两端差异（照实说明）**：TS 显式写了 `Connection: keep-alive`，Py 没写第三条头——这是与「HTTP 服务器如何管理连接」相关的实现细节，不影响帧内容与 `content-type`/`cache-control` 这两条**契约关注**的头。契约只要求 `content-type` 严格一致。

### 5.6 错误分流：为什么必须「先校验、后开流」

一次响应的 **HTTP 状态码只能发一次**，且在开始写 body **之前**随响应头发出。对 SSE 来说这是致命的约束：

- 一旦 `flushHeaders()` / 开始写流（200 + `text/event-stream` **已经发出去**），**再出任何错都改不了状态码**；
- 所以「图非法 / 草稿为空 / 未认证 / 归属不符」这类**请求级错误**，必须在**返回流之前**就判掉、以**普通 JSON** 出去。

本项目正是这么分流的：

| 错误类别 | 何时发生 | 出去的样子 | 实现位置 |
| --- | --- | --- | --- |
| 未认证（无/坏令牌） | **开流前** | 401 JSON | `JwtAuthGuard` / `get_current_user` |
| 归属不符 | **开流前** | 404 JSON（`App not found`） | `_find_owned` / `prisma.findUnique` |
| 草稿为空 | **开流前** | 400 JSON（`Graph is empty`） | `run_app` / `EngineService.run` |
| 图非法 / 节点数据非法 | **开流前** | 400 JSON（多条 `"; "`） | `validate_graph` + `validate_node_data` |
| 运行期错误（缺必填输入、模板取值失败） | **已开流后** | 流里的 `run_failed` 帧（HTTP 仍是 200） | 节点执行器 + `runGraph` / `_run_graph` |

对应的代码顺序，两端一致：

```ts
// TS：await run(...) 先跑预检（可能抛异常）——此时还没写任何头
const events = await this.engineService.run(payload.sub, id, body.inputs)
response.setHeader(...)   // 预检通过，才开始写头
response.flushHeaders()   // 开流
```

```python
# Py：预检 + 校验都可能 raise（走全局异常处理器 → JSON 400）——此时还没构造流
errors = [*validate_graph(graph), *validate_node_data(graph)]
if errors:
    raise HTTPException(status_code=400, detail="; ".join(errors))
return StreamingResponse(run_stream(...), ...)   # 全通过，才构造流
```

> **反面教材**：若把校验写进生成器内部（等开始写流后再抛），客户端会先收到 200 响应头，再看到一段「半截的流 + 报错」——状态码却永远是 200，前端无法区分「真失败」和「正常结束」。所以顺序**不能反**。

### 5.7 对照表：TS 与 Python 的写帧代码并排

两端对同一件事的写法逐一对照（`formatSseFrame` / `format_sse_frame` 见本阶段 02 / 04，此处只看「路由怎么用」）：

| 环节 | TypeScript（`run.controller.ts`） | Python（`run.py`） |
| --- | --- | --- |
| 路由声明 | `@Controller('apps')` + `@Post(':id/run')` | `APIRouter(prefix="/apps")` + `@router.post("/{id}/run")` |
| 状态码 | `@HttpCode(200)`（覆盖 `@Post` 默认 201） | 默认 200，无需声明 |
| 鉴权 | `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` | `Depends(get_current_user)` |
| 请求体 | `@Body() body: RunRequestDto`（class-validator） | `body: RunRequest`（Pydantic `extra="forbid"`） |
| 拿流对象 | `const events = await this.engineService.run(...)` → `AsyncGenerator<RunEvent>`（事件对象） | `run_stream(app.id, graph, body.inputs)` → `AsyncGenerator[str]`（**已格式化的帧字符串**） |
| 设响应头 | `setHeader('Content-Type', 'text/event-stream')` 等 | `media_type=...` + `headers={...}` |
| 开始写 | `flushHeaders()` | —（`StreamingResponse` 自动） |
| 逐事件写 | `for await (const e of events) response.write(formatSseFrame(e))` | 生成器内 `yield format_sse_frame(event)` |
| 写帧函数 | `formatSseFrame(event)`（`events.ts`） | `format_sse_frame(event)`（`events.py`） |
| 收流 | `response.end()` | 生成器耗尽（取到 `None` → `return`） |

两端的 `formatSseFrame` / `format_sse_frame` 都产出**同一串字节**：

```
`event: ${name}\n` + `data: ${JSON.stringify(data)}\n\n`
f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"
```

> 注意 Py 侧 `json.dumps(..., ensure_ascii=False, separators=(",", ":"))`：`ensure_ascii=False` 保证中文不被转义成 `\uXXXX`，紧凑分隔符保证与 JS `JSON.stringify` 的**单行紧凑**输出对齐（本阶段 03 已讲）。`JSON.stringify` 天然**不含裸换行**，因此 `data:` 永远只占一行（`sse-events.md` §1）。

---

## 6. 验收自测

先起 `docker compose up -d db` 与 `pnpm dev:api-ts`（3001）；准备一个合法草稿图（`start → llm → end`，start 声明输入变量、end 声明输出 `result`，`{{ <llmId>.text }}`）。已登录拿到 `<TOKEN>` 与 `<APP_ID>`。

```powershell
# 观察流：-N 关闭 curl 缓冲，才能看到逐帧到达
curl.exe -N -X POST http://localhost:3001/apps/<APP_ID>/run `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <TOKEN>" `
  -d "{\"inputs\":{}}"
```

**实测回放（照实记录）**

```
event: run_started
data: {"runId":"…","appId":"…"}

event: node_started
data: {"nodeId":"n-start","nodeType":"start"}

event: node_finished
data: {"nodeId":"n-start","nodeType":"start","output":{"inputs":{}}}

event: node_started
data: {"nodeId":"n-llm","nodeType":"llm"}

event: token
data: {"nodeId":"n-llm","text":"Hello mi"}

event: token
data: {"nodeId":"n-llm","text":"mini-dify"}

event: node_finished
data: {"nodeId":"n-llm","nodeType":"llm","output":{"text":"Hello mini-dify"}}

event: node_started
data: {"nodeId":"n-end","nodeType":"end"}

event: node_finished
data: {"nodeId":"n-end","nodeType":"end","output":{"outputs":{"result":"Hello mini-dify"}}}

event: run_finished
data: {"runId":"…","outputs":{"result":"Hello mini-dify"},"elapsedMs":3}
```

（`llm` 节点为**桩**：把 `prompt` 渲染后按「每个码点 8 字符一片」切分，故 `Hello mini-dify` 切成 `Hello mi` + `mini-dify` 两片 `token` —— 见本阶段 03。）

| 检查项 | 操作 | 预期（**实测**） |
| --- | --- | --- |
| 响应头 | `curl.exe -i -N …` | `content-type: text/event-stream`（**无** `; charset=utf-8`）；`cache-control: no-cache` |
| 逐帧到达 | `curl.exe -N …` | 帧**一条条**出现（`token` 帧先于 `run_finished`），不是一次性刷出 |
| 帧格式 | 肉眼核对 | 每帧 `event:` 一行 + `data:` 单行 JSON + 空行 |
| 流式 | 多条 `token` | 依次 `Hello mi` / `mini-dify`，拼出 `Hello mini-dify` |
| 成功收束 | 末帧 | `run_finished`，`outputs = {"result":"Hello mini-dify"}` |
| **草稿为空** | 直接对一个空草稿应用 `POST .../run` | `HTTP 400` + `application/json` + `{"statusCode":400,"message":"Graph is empty","error":"Bad Request"}` |
| **图非法** | 删掉 end 节点保存后再 run | `HTTP 400` + `{"statusCode":400,"message":"graph must contain at least one end node","error":"Bad Request"}` |
| **运行期失败** | start 声明了必填输入 `nope` 却不在 `inputs` 里 | HTTP 仍 **200**，流里出现 `run_failed` 帧：`{"nodeId":"n-start","message":"missing required input: nope"}`，随后**无** `run_finished` |
| 跨后端一致 | 把 base 换成 8000（`api-py`）重跑 | 帧与事件序列**逐字节相同** |

> 想更直接地看「运行期失败」，可把 `llm` 的 prompt 写成引用了不存在的路径，如 `{{ inputs.nope }}`，会得到 `run_failed` 的 `message = template variable not found: inputs.nope`（下一篇前端会展示这条）。

---

## 7. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **漏了 `flushHeaders()`** | 客户端要等很久才看到响应头，甚至以为「卡住」 | 头只在「首次写 body」或显式 flush 时才发出。先 `setHeader(...)` 再 `flushHeaders()`（第 5.1 节） |
| 2 | **用了 `@Sse()`** | 帧字节与契约不符，Py 侧对不上 | `@Sse()` 替你定序列化。改用底层 `Response` + `formatSseFrame` 手写（第 5.2 节） |
| 3 | **忘了 `@HttpCode(200)`** | 响应是 `201 Created` 而不是 `200` | NestJS `@Post` 默认 201；SSE 必须 200，加 `@HttpCode(200)` |
| 4 | **`@Res()` 后忘了 `response.end()`** | 连接**一直挂着**、永不结束 | 注入 `@Res()` 后 Nest 不再自动结束；循环写完必须 `response.end()`（第 5.1 节） |
| 5 | **Py 侧 `content-type` 带了 `; charset=utf-8`** | 与 api-ts 响应头不一致 | Starlette 对非二进制媒体类型自动追加 charset；显式 `headers={"Content-Type": "text/event-stream"}` 覆盖（第 5.3 节） |
| 6 | **没有 `Cache-Control: no-cache`** | 经某些代理时「流」变成「攒够一次性发」 | SSE 必须禁止缓存；两端都设（第 5.5 节） |
| 7 | **先开流、后校验** | 客户端先收 200 头，再收到半截流 + 报错，无法区分失败 | 校验必须在 `flushHeaders()` / 构造 `StreamingResponse` **之前**；请求级错误走普通 JSON（第 5.6 节） |
| 8 | **`data` 里出现裸换行** | 帧被截断、前端解析错乱 | 用 `JSON.stringify` / `json.dumps` 序列化（转义 `\n`），保证 `data:` 始终单行（第 5.7 节） |
| 9 | **curl 没加 `-N`** | 「看不到流」，输出一次性刷出 | curl 默认缓冲；`-N`/`--no-buffer` 关闭缓冲才能观察逐帧到达 |
| 10 | **草稿为空却当成功** | 以为「跑通了」其实 400 | 空草稿是 `graph_json === null`，`POST /run` 直接 400 `Graph is empty`（不是流） |

---

## 8. 本篇复盘与知识点

**一句话总结本篇**：SSE 服务端 = **「一次响应、多次写、不结束」**。NestJS 用底层 `Response`（`setHeader` → `flushHeaders` → 循环 `write` → `end`）手写帧，FastAPI 用 `StreamingResponse` 包异步生成器；两端各有一个队列把「执行器产出」与「HTTP 写出」解耦；帧格式被契约**逐字节固定**，故宁可放弃 `@Sse()` 的便利也要手写；且**校验永远在开流之前**。

**本篇学到的工程要点**

1. **不结束响应**：SSE 靠「迟迟不 `end()`、body 分次追加」实现推送；这是它与普通请求的唯一本质区别。
2. **两种手写姿势**：TS 拿底层 `Response` 自己 `write`；Py 交给 `StreamingResponse` 迭代生成器。异曲同工。
3. **为何不用 `@Sse()`**：帧格式要**可控且两端一致** → 手写优于框架代劳。
4. **`content-type` 严格化**：Starlette 会追加 `; charset=utf-8`，显式覆盖以对齐。
5. **队列桥接**：`RunEventQueue` / `asyncio.Queue` 让「产」与「发」并行，才有流式；也保证两端事件序列可比。
6. **先校验后开流**：状态码只能发一次；请求级错误走 JSON，运行期错误走 `run_failed` 帧。

**遗留 / 后续**

- 背压与客户端断线（客户端提前断开时服务端应停止执行）暂未处理——总纲把 SSE 深入放在阶段 10。
- `llm` 节点目前是**桩**（无真实模型），真实模型与 token 真流式见阶段 5。

---

## 9. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| 服务端「不结束响应」地持续写：NestJS 底层 `Response` 手写 SSE 流（`setHeader`/`flushHeaders`/`write`/`end`） | **首次教学于本篇** |
| FastAPI `StreamingResponse` 包异步生成器产出 SSE 帧 | **首次教学于本篇** |
| 为何本项目不用 NestJS `@Sse()`（帧格式需逐字节可控、两端一致） | **首次教学于本篇** |
| `content-type` 严格 `text/event-stream`（Starlette 默认追加 `; charset=utf-8`，显式覆盖） | **首次教学于本篇** |
| 事件队列 → 流的桥接（`RunEventQueue` / `asyncio.Queue` 解耦执行器与 HTTP 响应） | **首次教学于本篇** |
| SSE 响应头 `Cache-Control: no-cache`（及 TS 侧 `Connection: keep-alive`） | **首次教学于本篇** |
| 错误分流：「先校验、后开流」（请求级错误 → 开流前 JSON；运行期错误 → `run_failed` 帧） | **首次教学于本篇** |
| `@HttpCode(200)` 覆盖 `@Post` 默认 201；`@Res()` 手动接管响应 | **首次教学于本篇** |
