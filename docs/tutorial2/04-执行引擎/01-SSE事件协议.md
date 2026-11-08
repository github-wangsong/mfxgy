# 01 · SSE 事件协议（执行引擎 MVP）

> 阶段 4 · 第 1 步
>
> 做完：契约版本 `0.4.0 → 0.5.0`；新增 `POST /apps/{id}/run`、`RunRequest`、六个运行期事件；`events.ts` 提供帧序列化、事件构造器与执行期队列；`RunController` 用底层 `Response` 手写 SSE。
>
> **本篇面试考点**：SSE vs WebSocket vs 长轮询 · 为什么不能用 `EventSource` · 为什么不用 Nest 的 `@Sse()` · 帧格式为什么必须逐字节固定 · 运行前失败（HTTP 400）与运行中失败（`run_failed`）的分界 · 终态唯一 · `@Res()` 之后不能再走 Nest 异常管道 · 背压（`write()` 返回 `false`）。

---

## 1. 为什么是 SSE

| 方案 | 方向 | 协议 | 自定义头 | 断线重连 | 适用 |
| --- | --- | --- | --- | --- | --- |
| 轮询 | 客户端拉 | HTTP | 可以 | 自己实现 | 低频状态 |
| 长轮询 | 客户端拉 | HTTP | 可以 | 自己实现 | 兼容性兜底 |
| WebSocket | 双向 | ws | 握手时可带 | 自己实现 | 双向实时（聊天室、协同编辑） |
| **SSE** | **服务端推** | **HTTP** | **可以** | **浏览器 `EventSource` 自动** | **单向流式输出（LLM token、进度）** |

本项目的运行是**单向**的：客户端发一次 `POST`，服务端持续推事件直到结束。用 WebSocket 属于杀鸡用牛刀：还要处理心跳、鉴权、连接状态机、反向代理升级。

SSE 的代价：

- 只支持文本（二进制要 base64）；
- HTTP/1.1 下浏览器对**同域**并发连接有 6 条限制（HTTP/2 无此问题）；
- 中间代理可能缓冲，导致“后端已经推了，浏览器迟迟收不到”。

---

## 2. 契约

**完整文件路径：`packages/contract/openapi.yaml`**（运行接口节选）

```yaml
  /apps/{id}/run:
    post:
      operationId: runApp
      summary: 运行应用（SSE 流式）
      description: >-
        运行**草稿**图。成功时返回 `text/event-stream`，逐条推送事件；
        运行前的校验失败（图非法、输入缺失、无 LLM key 等）在写响应头之前返回普通 JSON 错误。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/RunRequest"
      responses:
        "200":
          description: SSE 事件流（协议见 packages/contract/sse-events.md）
          content:
            text/event-stream:
              schema:
                type: string
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

```yaml
    RunRequest:
      type: object
      additionalProperties: false
      required: [inputs]
      properties:
        inputs:
          type: object
          description: 运行输入，键为输入变量名
          additionalProperties: true
        conversationId:
          type: string
          description: 可选。会话 id（阶段 9 起生效）
        userMessage:
          type: string
          maxLength: 4000
          description: 可选。本轮原始用户消息（阶段 9 起生效）
```

**完整文件路径：`packages/contract/src/index.ts`**（阶段 4 的事件类型，节选）

```ts
/** SSE 事件名。阶段 4 只有前六种；后续阶段追加。 */
export type RunEventName =
  | 'run_started'
  | 'node_started'
  | 'token'
  | 'node_finished'
  | 'run_finished'
  | 'run_failed'

/** `run_started`：流的第一帧，客户端据此拿到 runId。 */
export interface RunStartedData {
  runId: string
  appId: string
}

/** `node_started`：某节点开始执行。 */
export interface NodeStartedData {
  nodeId: string
  nodeType: GraphNodeType
}

/** `token`：LLM 节点的增量文本（可能 0~N 次）。 */
export interface TokenData {
  nodeId: string
  text: string
}

/** `node_finished`：节点执行完成，`output` 为该节点的输出对象。 */
export interface NodeFinishedData {
  nodeId: string
  nodeType: GraphNodeType
  output: Record<string, unknown>
}

/** `run_finished`：成功终态。 */
export interface RunFinishedData {
  runId: string
  outputs: Record<string, unknown>
  elapsedMs: number
}

/** `run_failed`：失败终态。`nodeId` 为 null 表示错误不属于某个节点。 */
export interface RunFailedData {
  runId: string
  nodeId: string | null
  message: string
}

/** 单个 SSE 事件的逻辑表示（`event` + `data`），帧序列化由两端分别完成。 */
export interface RunEvent {
  event: RunEventName
  data:
    | RunStartedData
    | NodeStartedData
    | TokenData
    | NodeFinishedData
    | RunFinishedData
    | RunFailedData
}
```

```ts
export const CONTRACT_VERSION = '0.5.0'
```

---

## 3. 帧格式（逐字节固定）

不算“大致长这样”，而是**必须完全等于**：

```text
event: <事件名>\n
data: <单行 JSON>\n
\n
```

一次完整运行的真实字节：

```text
event: run_started
data: {"runId":"0f8fad5b-d9cb-469f-a165-70867728950e","appId":"6b1d0f1e-..."}

event: node_started
data: {"nodeId":"s","nodeType":"start"}

event: node_finished
data: {"nodeId":"s","nodeType":"start","output":{"inputs":{}}}

event: node_started
data: {"nodeId":"e","nodeType":"end"}

event: node_finished
data: {"nodeId":"e","nodeType":"end","output":{"result":"你好"}}

event: run_finished
data: {"runId":"0f8fad5b-...","outputs":{"result":"你好"},"elapsedMs":12}

```

约定：

1. 每个事件是 `event:` 行 + `data:` 行 + **空行**；
2. `data:` 后是**单行** JSON，不允许换行；
3. 不发送 `id:` 行（阶段 11 的 Agent 事件才用 `id:` 支持 `Last-Event-ID` 重放）；
4. 不发送注释行（`: keep-alive`）——本项目运行时间短，暂不做心跳。

> **面试考点 · 为什么非要“单行 JSON”？**
> SSE 规范允许一个事件有多行 `data:`，客户端会把它们用 `\n` 拼接。多行 JSON 虽然理论上可行，但：
>
> - 解析要从“按行”变成“按事件”，实现复杂；
> - 任何一个字段里出现真实换行（比如 LLM 输出），就会破坏帧边界；
> - 两套后端很难保证缩进/空格一致，逐字节比对直接失效。
>
> `JSON.stringify` 默认输出单行，且会把字符串里的换行转义成 `\n`（两个字符）。**用序列化器保证边界，而不是靠手写字符串拼接。**

> **面试考点 · 为什么不用 `\r\n`？**
> SSE 规范兼容 `\r\n`、`\n`、`\r`，但本项目固定 `\n`。原因同上：两套后端 + 契约测试要逐字节比对，**换行符也是协议的一部分**。

---

## 4. 事件时序

成功：

```text
run_started
  ├─ node_started(start)
  ├─ node_finished(start)
  ├─ node_started(llm)
  ├─ token(llm) × N        ← 只有 LLM 节点会发
  ├─ node_finished(llm)
  ├─ node_started(end)
  ├─ node_finished(end)
run_finished
```

失败：

```text
run_started
  ├─ node_started(llm)
  └─ run_failed            ← 到此为止
```

规则：

| # | 规则 |
| --- | --- |
| 1 | 第一帧永远是 `run_started` |
| 2 | `token` 只出现在 `node_started` 与对应 `node_finished` 之间 |
| 3 | 每个 `node_started` 最多有一个 `node_finished` |
| 4 | **终态唯一**：要么一个 `run_finished`，要么一个 `run_failed`，不会同时出现 |
| 5 | 终态之后不再有任何事件 |
| 6 | `runId` 在 `run_started` 与终态中一致 |

> **面试考点 · 为什么“终态唯一”这么重要？**
> 客户端（以及阶段 11 的事件重放）需要一个明确的“流结束了”信号。如果既能收到 `run_finished` 又能收到 `run_failed`，前端就无法判断该展示成功结果还是错误：
>
> - 先成功、后失败 → 用户看到结果又看到报错；
> - 先失败、后成功 → 错误提示永远不消失。
>
> 实现上要做到：**一旦决定失败，就不再继续执行后续节点；一旦发出成功，就不再捕获新错误。** 这正是“状态机只能进入终态一次”的体现。

> **面试考点 · 运行前错误为什么不用 `run_failed`，而是 HTTP 400？**
> 分界是“响应头有没有写出去”：
>
> - **写头之前**：图非法、输入缺失、应用不存在、未登录。此时还是普通 HTTP 请求，用 `400` / `401` / `404` + 统一错误体，客户端用 `fetch` 的 `res.ok` 就能判断，不需要解析流。
> - **写头之后**：已经返回 `200 text/event-stream`，不能再改状态码。此时只能用 `run_failed` 把错误“当作一条消息”推给客户端。
>
> 所以 `RunController` 必须**先 `await engineService.run(...)` 完成所有预检**，拿到事件流之后才 `setHeader` / `flushHeaders`。顺序反了，预检错误就会变成“200 + 半截流”。

---

## 5. 事件构造与帧序列化

**完整文件路径：`apps/api-ts/src/engine/events.ts`**（阶段 4 版本）

```ts
import type { GraphNodeType, RunEvent } from '@mini-dify/contract'

/** 便于引擎内部从 `events.ts` 统一取用事件类型。 */
export type { RunEvent }

/**
 * SSE 事件（唯一真源：`packages/contract/sse-events.md`）。
 *
 * 两套后端（api-ts / api-py）必须产出**逐字节相同**的帧格式与**完全一致**的事件序列。
 * 本文件负责：构造各事件的逻辑表示、序列化帧，以及执行期的事件队列。
 */

/** 运行期错误：其 `message` 经 `run_failed` 事件传出（见 error-messages.md §4.2）。 */
export class RunError extends Error {}

/** 帧格式（固定）：`event: <name>\n` + `data: <单行 JSON>\n\n`。 */
export function formatSseFrame(event: RunEvent): string {
  return `event: ${event.event}\n` + `data: ${JSON.stringify(event.data)}\n\n`
}

/** 构造 `run_started` 事件。 */
export function runStarted(runId: string, appId: string): RunEvent {
  return { event: 'run_started', data: { runId, appId } }
}

/** 构造 `node_started` 事件。 */
export function nodeStarted(nodeId: string, nodeType: GraphNodeType): RunEvent {
  return { event: 'node_started', data: { nodeId, nodeType } }
}

/** 构造 `token` 事件。 */
export function token(nodeId: string, text: string): RunEvent {
  return { event: 'token', data: { nodeId, text } }
}

/** 构造 `node_finished` 事件。 */
export function nodeFinished(
  nodeId: string,
  nodeType: GraphNodeType,
  output: Record<string, unknown>,
): RunEvent {
  return { event: 'node_finished', data: { nodeId, nodeType, output } }
}

/** 构造 `run_finished` 事件。 */
export function runFinished(
  runId: string,
  outputs: Record<string, unknown>,
  elapsedMs: number,
): RunEvent {
  return { event: 'run_finished', data: { runId, outputs, elapsedMs } }
}

/** 构造 `run_failed` 事件。 */
export function runFailed(runId: string, nodeId: string | null, message: string): RunEvent {
  return { event: 'run_failed', data: { runId, nodeId, message } }
}

/**
 * 执行期事件队列：图执行（后台）`emit`，SSE 消费方 `drain` 逐条取走。
 *
 * 单线程事件循环下「先 emit 后被 drain」的顺序天然保持；
 * `close()` 后 `drain` 结束，从而收束 SSE 流。
 */
export class RunEventQueue {
  private readonly buffer: RunEvent[] = []
  private waiter: (() => void) | null = null
  private closed = false

  /** 入队一个事件，并唤醒等待中的消费方。 */
  emit(event: RunEvent): void {
    this.buffer.push(event)
    this.wake()
  }

  /** 关闭队列：消费方取完剩余事件后 `drain` 结束。 */
  close(): void {
    this.closed = true
    this.wake()
  }

  /** 逐条产出事件，直到队列被 `close()`。 */
  async *drain(): AsyncGenerator<RunEvent> {
    for (;;) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift() as RunEvent
      }
      if (this.closed) {
        return
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }

  private wake(): void {
    const waiter = this.waiter
    this.waiter = null
    waiter?.()
  }
}
```

> `tool_call` / `tool_result` / `retrieval` / `branch_taken` / `iteration_item` 的构造器在阶段 6~8 追加；`runStarted` 的 `conversationId` 参数在阶段 9 追加。

> **面试考点 · 为什么用“队列 + 异步迭代器”，而不是直接 `response.write`？**
> 执行图是**生产者**，SSE 输出是**消费者**，两者速率不同（LLM 可能瞬间吐 50 个 token，网络只能慢慢发）。队列把两者解耦：
>
> - 生产者只管 `emit`，不关心网络；
> - 消费者用 `for await` 逐条取，天然支持背压式消费（取一条、发一条）；
> - 将来换成 WebSocket / 消息队列 / Agent 事件表，执行器代码不变，只换消费者。
>
> **这是“事件流”最基础的架构模式：生产与传输分离。**

> **面试考点 · `waiter` 这样写有并发安全问题吗？**
> Node.js 是单线程事件循环，`buffer.push` 与 `waiter` 赋值不会真正并发。但这段实现有一个隐含假设：**只有一个消费者**。如果两个 `drain()` 同时跑，`this.waiter` 会被后者覆盖，前一个永远等不到唤醒（丢事件）。
> 本项目一个运行只有一个 SSE 消费者，所以成立。多消费者要用真正的异步队列（`events.once` + 队列，或 `p-queue`、`ReadableStream`）。**知道假设在哪，才知道什么时候会坏。**

---

## 6. 控制器：手写 SSE

**完整文件路径：`apps/api-ts/src/engine/dto/run.dto.ts`**

```ts
import { IsObject, IsString, MaxLength, ValidateIf } from 'class-validator'

/** POST /apps/{id}/run 请求体 —— 对应契约 `RunRequest`。 */
export class RunRequestDto {
  /** 运行输入，键为输入变量名（内部键不校验，原样透传给引擎）。 */
  @IsObject()
  inputs!: Record<string, unknown>

  /**
   * 可选。会话 id（阶段 9 起生效）。
   * 用 `ValidateIf` 而非 `IsOptional`：显式传 `null` 视为类型错误（与 FastAPI 一致）。
   */
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  conversationId?: string

  /** 可选。本轮原始用户消息（阶段 9 起生效），最多 4000 字符。 */
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  userMessage?: string
}
```

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
  // SSE 是 200，不是 POST 默认的 201
  @HttpCode(200)
  async run(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() body: RunRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    // 第一步：完成预检并拿到事件流（此处的异常仍会变成普通 JSON 400/404）
    const events = await this.engineService.run(payload.sub, id, body.inputs)
    // 第二步：写 SSE 头。注意 charset：JSON 是 UTF-8，声明清楚避免客户端猜
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
    // 第三步：逐条写帧；for await 会在队列 close 后自然结束
    for await (const event of events) {
      response.write(formatSseFrame(event))
    }
    response.end()
  }
}
```

> **面试考点 · 为什么不用 Nest 的 `@Sse()`？**
> `@Sse()` 要求返回 `Observable<MessageEvent>`，内部会把对象序列化成 `data:` 行，并可能补充 `id:` / `retry:` 字段。这些细节由框架版本决定。
> 本项目的硬要求是“**两套后端逐字节一致**”。任何框架的默认行为都可能引入：
>
> - 字段顺序差异（`JSON.stringify` 顺序由对象构造顺序决定）；
> - 额外字段（`id` / `retry`）；
> - 换行符或空格差异。
>
> 手写 3 行序列化，比读完框架源码再对齐便宜得多。**当协议是产品的一部分时，自己控制序列化。**

> **面试考点 · `@Res()` 之后 Nest 的异常过滤器还生效吗？**
> `@Res()`（不带 `{ passthrough: true }`）表示“我自己管响应”，Nest 不再套用标准的响应处理。**一旦你已经 `flushHeaders` 或 `write`，再抛异常也无法改状态码**，客户端只会看到一条断裂的流。
> 所以顺序必须是：
>
> 1. 所有可能失败的预检放前面，抛异常 → 由全局过滤器返回 JSON；
> 2. 写头；
> 3. 写流期间**不再抛异常**，错误一律转成 `run_failed` 事件。
>
> **“错误处理的时机”比“错误处理的方式”更重要。**

> **面试考点 · `response.write()` 返回 `false` 说明什么？**
> 说明内核发送缓冲区已满，**背压**出现。正确做法是 `await once(response, 'drain')` 再继续写。
> 当前实现没有等待（LLM token 量级小，缓冲区足够），所以这是一个已知取舍：流量大时内存里会堆积待发数据。
> 面试里能指出这一点，比背出“SSE 是服务端推送”有价值得多——**知道自己的实现什么时候会坏。**

---

## 7. 验证

先启动一个带 LLM 节点的应用。阶段 4 的 `llm` 节点是**占位实现**：把渲染后的 prompt 原样回显并发一帧 `token`，不需要任何 key（阶段 5 才换成真实模型）。

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json)
$token = $login.accessToken
```

```powershell
# 1. 不加 -N：PowerShell 会等流结束才输出，仍然能拿到完整帧
curl.exe -s -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{}}"
```

```text
# 2. 直接看原始帧（-N 关闭 curl 自己的缓冲）
curl.exe -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{}}"
```

预期输出（`runId` 不同）：

```text
event: run_started
data: {"runId":"...","appId":"..."}

event: node_started
data: {"nodeId":"s","nodeType":"start"}

event: node_finished
data: {"nodeId":"s","nodeType":"start","output":{"inputs":{}}}

event: node_started
data: {"nodeId":"e","nodeType":"end"}

event: node_finished
data: {"nodeId":"e","nodeType":"end","output":{"result":"..."}}

event: run_finished
data: {"runId":"...","outputs":{"result":"..."},"elapsedMs":12}

```

```powershell
# 3. 运行前失败 → 普通 JSON 400（Content-Type: application/json）
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/<APP_ID>/run" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType 'application/json' -Body '{"inputs":{}}'
} catch {
  $_.Exception.Response.StatusCode.value__
  $_.ErrorDetails.Message
}
```

```powershell
# 4. 未登录 → 401，且不是 event-stream
curl.exe -i -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Content-Type: application/json" -d "{\"inputs\":{}}"
```

重点看响应头：

```text
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
```

```powershell
# 5. 对比 Python 侧：同一应用、同一图，帧格式与事件序列应完全一致
curl.exe -N -X POST "http://localhost:8000/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" -d "{\"inputs\":{}}"
```

把两边的输出保存成文件，去掉 `runId` / `elapsedMs` 后 `diff`，应该没有任何差异。

---

## 8. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 为什么选 SSE 不选 WebSocket | 单向推送、复用 HTTP 鉴权、实现简单；双向才需要 WS |
| 为什么不用 `EventSource` | 只能 GET、不能带 `Authorization`；前端用 `fetch` + `ReadableStream` |
| 帧格式为什么固定 | 两套后端逐字节一致，契约测试才能比对 |
| `data` 为什么单行 | 避免字符串内换行破坏帧边界；`JSON.stringify` 天然转义 |
| 预检错误 vs `run_failed` | 写响应头之前 → HTTP 4xx JSON；之后 → 流内事件 |
| 为什么先 `await` 再写头 | 保证所有预检异常还能变成普通 HTTP 响应 |
| `@Res()` 的代价 | 绕过 Nest 响应管道，之后的异常无法转成 JSON |
| 终态为什么必须唯一 | 客户端需要确定的结束信号，状态机只能进终态一次 |
| `write()` 返回 false | 背压；应等 `drain` 事件（当前实现未处理） |
| 事件为什么要有队列 | 解耦生产者与消费者，便于换传输层、做重放 |

---

## 9. 下一步

- `02-LangGraph编译图.md`：把 `Graph` 编译成 LangGraph（TS），`start` / `end` / `llm` 节点工厂、变量池、`{{ }}` 模板。
- `03-NestJS引擎.md`：`EngineService` 的预检、事件驱动与 `RunEventQueue` 消费。
- `04-Python引擎.md`：同一协议的 FastAPI 实现。
- `05-前端流式面板.md`：`fetch` 读取流、按 `\n\n` 切帧、Zod 校验每个 `data`、渲染 token 与终态。
