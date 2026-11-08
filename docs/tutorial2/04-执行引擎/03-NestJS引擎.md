# 03 · NestJS 引擎（执行引擎 MVP）

> 阶段 4 · 第 3 步
>
> 做完：`EngineModule` 接进 `AppModule`；`POST /apps/{id}/run` 能稳定产出六种事件；预检失败返回普通 JSON 4xx，执行期失败只产生一帧 `run_failed`；客户端拿到的第一个字节一定是 `run_started`。
>
> 前两篇已经给出协议与图编译的完整代码，本篇只讲**接线与失败路径**：请求进来之后，错误在哪一层被拦下、事件在哪个时刻产生、流在什么条件下结束。
>
> **本篇面试考点**：预检顺序（404 先于 400）· `void` 后台任务的未捕获拒绝 · 异步生成器的执行时机 · `@Res()` 与全局异常过滤器的边界 · 客户端断开后的资源回收 · 为什么没有 `compression` 中间件 · 可观测性（`runId` / `elapsedMs`）。

---

## 1. 文件与接线

阶段 4 新增/修改的文件：

```text
apps/api-ts/src/
├── engine/
│   ├── dto/run.dto.ts          ← RunRequestDto（01 篇）
│   ├── events.ts               ← 帧序列化、事件构造器、RunEventQueue（01 篇）
│   ├── template.ts             ← 变量池与模板（02 篇）
│   ├── nodes/
│   │   ├── start.node.ts
│   │   ├── llm.node.ts
│   │   └── end.node.ts
│   ├── engine.service.ts       ← 预检、编译、执行（02 篇）
│   ├── run.controller.ts       ← SSE 响应（01 篇）
│   └── engine.module.ts
├── app.module.ts               ← 注册 EngineModule
└── main.ts                     ← 不变（全局 ValidationPipe 已就位）
```

**完整文件路径：`apps/api-ts/src/engine/engine.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { EngineService } from './engine.service'
import { RunController } from './run.controller'

/**
 * 执行引擎模块。
 *
 * - `PrismaService` 来自全局 `PrismaModule`，不在这里 imports；
 * - `JwtAuthGuard` 由 `AuthModule` 提供并导出，所以必须 imports `AuthModule`；
 * - `EngineService` 只被本模块的 `RunController` 使用，不需要 exports。
 */
@Module({
  imports: [AuthModule],
  controllers: [RunController],
  providers: [EngineService],
})
export class EngineModule {}
```

**完整文件路径：`apps/api-ts/src/app.module.ts`**（阶段 4 版本）

```ts
import { Module } from '@nestjs/common'

import { AppsModule } from './apps/apps.module'
import { AuthModule } from './auth/auth.module'
import { EngineModule } from './engine/engine.module'
import { GraphModule } from './graph/graph.module'
import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
import { PrismaModule } from './prisma/prisma.module'

/** 根模块（阶段 4）：后续每加一个阶段，就在 imports 里追加对应模块。 */
@Module({
  imports: [PrismaModule, AuthModule, AppsModule, GraphModule, EngineModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

> **面试考点 · 为什么 `EngineModule` 要 `imports: [AuthModule]`？**
> `RunController` 用了 `@UseGuards(JwtAuthGuard)`，而 `JwtAuthGuard` 的依赖（`JwtService`）由 `AuthModule` 提供。
> Nest 的模块是**封闭作用域**：除非 provider 被标记 `@Global()` 或从别的模块 `exports` 出来，否则看不到。
> 即使 `JwtModule.register({ global: true })` 让 `JwtService` 全局可用，`JwtAuthGuard` 这个**类**仍然要通过 `AuthModule` 导出。两者不是一回事。

---

## 2. 请求生命周期

```text
POST /apps/:id/run
  │
  ├─ CORS 中间件
  ├─ body-parser：JSON 解析（失败 → 400）
  ├─ ValidationPipe：RunRequestDto
  │     ├─ inputs 不是对象        → 400（class-validator）
  │     └─ userMessage 超 4000    → 400
  ├─ JwtAuthGuard：验签
  │     └─ 缺失/过期/伪造          → 401（普通 JSON）
  ├─ RunController.run
  │     ├─ EngineService.run（await）
  │     │     ├─ 应用不存在/非本人  → 404
  │     │     ├─ graphJson 为 null → 400 Graph is empty
  │     │     └─ validateGraph / validateNodeData → 400（多条 "; " 拼接）
  │     ├─ response.setHeader(...) + flushHeaders()   ← 从这里开始是 SSE
  │     └─ for await (event of events) response.write(frame)
  │           └─ 执行期异常 → run_failed 事件（状态码保持 200）
  └─ response.end()
```

关键：**竖线的位置**。`flushHeaders()` 之前的一切错误都能变成普通 JSON；之后的一切错误只能变成事件。

> **面试考点 · 为什么 404 要排在 400 之前？**
> 顺序决定信息泄露：
>
> - 先查归属 → 别人的应用直接 404，攻击者无法区分“不存在”和“不是你的”；
> - 如果先校验图、再查归属，攻击者传一个非法图就能得到 400，传合法图得到 404——**通过状态码差异探测应用是否存在**。
>
> 同理，`Graph is empty`（400）也必须放在归属校验之后：否则“空图 vs 非空图”的差异又会变成探测信号。
>
> **安全相关的判断永远最先执行，且失败时返回最少的 information。**

> **面试考点 · 为什么 `inputs` 只校验“是对象”，不校验每个键？**
> 键名由 `start` 节点的 `data.inputs` 决定，而那是**图的一部分**，DTO 看不到。
> 在 DTO 里穷举会写死业务；正确的分层：
>
> - DTO：`inputs` 必须是对象（防止传字符串/数组）；
> - `start` 节点：按声明校验必填项（缺失 → `run_failed`）。
>
> 一个在 HTTP 层，一个在引擎层，**各自只知道自己该知道的事**。

---

## 3. 预检：把错误挡在流外

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`run` 与 `precheck`，阶段 4 版本）

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Graph } from '@mini-dify/contract'

import { validateGraph } from '../graph/graph.validator'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class EngineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 预检并返回事件流。
   *
   * 顺序（不能调整）：
   * 1. 应用存在且属于当前用户 → 否则 404；
   * 2. 草稿非 null → 否则 400 `Graph is empty`；
   * 3. 图语义规则 → 400；
   * 4. 节点 data 形状 → 400。
   *
   * 任何一步失败都在**写响应头之前**抛异常，由全局 `HttpErrorFilter` 转成统一 JSON。
   */
  async run(
    ownerId: string,
    appId: string,
    inputs: Record<string, unknown>,
  ): Promise<AsyncGenerator<RunEvent>> {
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
    if (app.graphJson === null) {
      throw new BadRequestException('Graph is empty')
    }
    const graph = app.graphJson as unknown as Graph
    this.precheck(graph)
    return this.execute(appId, graph, inputs)
  }

  /** 图规则 + 节点 data 规则，一次性收集所有错误。 */
  private precheck(graph: Graph): void {
    const errors = [...validateGraph(graph), ...validateNodeData(graph)]
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
  }
}
```

预检覆盖的错误（阶段 4）：

| 场景 | 文案 | 状态码 |
| --- | --- | --- |
| 应用不存在 / 非本人 | `App not found` | 404 |
| 从未保存草稿 | `Graph is empty` | 400 |
| 版本不是 `"1"` | `graph version must be 1` | 400 |
| 节点 id 重复 | `node id must be unique: {id}` | 400 |
| 不是恰好一个 start | `graph must contain exactly one start node` | 400 |
| 没有 end | `graph must contain at least one end node` | 400 |
| 边悬空 / 自环 | `edge ...` | 400 |
| `start.data.inputs` 不是数组 | `start node {id} inputs must be an array` | 400 |
| `llm.data.prompt` 不是字符串 | `llm node {id} prompt must be a string` | 400 |
| `end.data.outputs` 形状错误 | `end node {id} ...` | 400 |

> **面试考点 · 为什么预检要“收集所有错误”，而不是遇到第一个就抛？**
> 和画布保存时一样：用户希望一次看到所有问题。
> 实现上把各校验函数的返回值拼成一个数组，最后 `join('; ')` 抛一次。这样：
>
> - 只产生一个 HTTP 响应；
> - 文案顺序稳定、可被两套后端逐字节比对；
> - 前端一次能列出全部问题。
>
> 代价是**校验函数必须无副作用**（不能边查边写库），否则收集过程本身会改变状态。

---

## 4. 事件流的启动时机

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`execute` 与 `runGraph` 的骨架）

```ts
import { randomUUID } from 'node:crypto'

private async *execute(
  appId: string,
  graph: Graph,
  inputs: Record<string, unknown>,
): AsyncGenerator<RunEvent> {
  const queue = new RunEventQueue()
  const runId = randomUUID()

  // 先入队 run_started：保证客户端拿到的第一帧一定是它
  queue.emit(runStarted(runId, appId))

  // 后台执行：注意是 `void`，不 await。
  // runGraph 内部用 try/catch/finally 包住全部逻辑，且 finally 一定 close 队列，
  // 因此这里不会产生未捕获的 Promise 拒绝，drain() 也一定会结束。
  void this.runGraph(graph, inputs, queue, runId)

  // 把队列暴露成异步生成器：控制器 for await 消费
  yield* queue.drain()
}

private async runGraph(
  graph: Graph,
  inputs: Record<string, unknown>,
  queue: RunEventQueue,
  runId: string,
): Promise<void> {
  const startedAt = Date.now()
  const context: RunContext = { queue, failedNodeId: null, lastOutputs: {} }
  try {
    // ...建图、invoke（见 02 篇）
    queue.emit(runFinished(runId, context.lastOutputs, Date.now() - startedAt))
  } catch (error) {
    queue.emit(runFailed(runId, context.failedNodeId, messageOf(error)))
  } finally {
    queue.close()
  }
}
```

执行时序（单线程事件循环）：

```text
t0  run() 返回 AsyncGenerator（此时函数体还没执行）
t1  controller: for await → 触发第一次 next()
t2  execute() 开始执行：
      emit(run_started)     ← 入队
      void runGraph(...)    ← 同步执行到第一个 await（建图、invoke）
      yield* drain()        ← 立刻取走 run_started 并 yield 给 controller
t3  controller 写第一帧
t4  runGraph 在后台继续，事件陆续入队 / 被 drain 取走
t5  runGraph 结束 → close()
t6  drain 取完剩余事件 → 结束 → response.end()
```

> **面试考点 · 为什么 `run_started` 要在 `void runGraph` 之前 `emit`？**
> `runGraph` 里第一个节点可能非常快（甚至没有 `await` 就完成）。如果先启动执行再发 `run_started`，事件顺序可能变成：
>
> ```text
> node_started → node_finished → run_started   ← 协议被破坏
> ```
>
> 先把 `run_started` 放进队列，再启动执行，**队列的 FIFO 顺序**就保证了它一定是第一帧。这是“用数据结构保证顺序”，而不是“靠执行时机碰运气”。

> **面试考点 · `void promise` 会不会产生未捕获拒绝？**
> 会——如果 `runGraph` 内部没有把所有路径都 catch 住。
> 这里的保证来自 `try { ... } catch { ... } finally { ... }`：**执行体里的任何同步/异步异常都被 catch 转成 `run_failed`，`finally` 一定 `close()`**。所以 `runGraph` 返回的 Promise 永远 resolve。
> 如果漏掉 catch，Node 会触发 `unhandledRejection`；进程是否退出取决于启动参数（Node 15+ 默认直接退出）。**后台任务必须自己兜住所有错误，调用方是 `void` 的，没人接。**

> **面试考点 · 异步生成器什么时候开始执行？**
> 调用 `execute()` 只创建生成器对象，**函数体一行都不执行**；第一次 `next()`（`for await` 的第一次迭代）才开始。
> 这带来一个好处：`EngineService.run()` 里 `return this.execute(...)` 不会提前启动任何东西，预检失败时连队列都不会创建。
> 也带来一个坑：如果想“返回前先做点事”，不能写在生成器函数体里，要写在 `run()` 里。

---

## 5. 失败路径逐个走

### 5.1 预检失败

```text
POST /run → 401/404/400 + application/json
{"statusCode":404,"message":"App not found","error":"Not Found"}
```

此时**没有创建队列、没有写 SSE 头**。`@Res()` 虽然注入了 `response`，但只要没有 `setHeader` / `write`，全局过滤器仍能正常返回 JSON。

### 5.2 执行期失败

```text
POST /run → 200 + text/event-stream
event: run_started
...
event: run_failed
data: {"runId":"...","nodeId":"llm1","message":"template variable not found: inputs.nope"}
```

状态码已经是 200，不能改。客户端必须检查 `run_failed`，不能只看 `res.ok`。

### 5.3 控制器自身的异常

```ts
for await (const event of events) {
  response.write(formatSseFrame(event))
}
```

如果 `response.write` 本身抛错（客户端已断开、socket 已销毁），异常会从 `run()` 冒出去，进入 Nest 的异常过滤器——但响应头已发，过滤器写不回 JSON，只能记日志。
**这是当前实现的已知边界**：没有监听 `request.on('close')` 主动取消执行，执行器会继续跑完（浪费 token/CPU），写帧时才发现没人接收。

改进方向（阶段 11 的 Agent 运行需要）：

```ts
// 尚未实现，示意：
request.on('close', () => {
  // 标记取消：执行器在节点边界检查后停止
  cancellation.cancelled = true
})
```

> **面试考点 · 客户端断开后，后端知道吗？**
> 知道，但要主动监听。HTTP 响应对象在连接断开时会触发 `close`。如果什么都不做：
>
> - 执行器继续跑（LLM 继续计费）；
> - `response.write` 变成空操作或抛错；
> - 队列一直堆积到执行结束。
>
> 对短流程（几秒）影响小；对阶段 11 的自主 Agent（可能跑几分钟）必须做取消。
> **流式接口的资源回收，重点不是“响应结束”，而是“消费者消失”。**

### 5.4 超时

Nest/Express 默认没有响应超时（Node 的 `server.requestTimeout` 默认 300s，只针对请求体接收）。SSE 长连接需要：
- 反向代理层（nginx `proxy_read_timeout`）配置足够长；
- 或自己加心跳注释帧（`: ping\n\n`）保活。

本项目运行时间短，未做心跳。

---

## 6. 验证矩阵

前置：

```powershell
pnpm --filter @mini-dify/api-ts start:dev
```

| # | 请求 | 期望 |
| --- | --- | --- |
| 1 | 不带 `Authorization` | `401`，`Content-Type: application/json` |
| 2 | 用 bob 的 token 跑 alice 的应用 | `404`，`App not found` |
| 3 | 新建应用、不保存草稿就运行 | `400`，`Graph is empty` |
| 4 | 保存非法图（无 end）后运行 | `400`，`graph must contain at least one end node` |
| 5 | 缺必填输入 | `200` 流，`run_failed`，`nodeId` 是 start |
| 6 | 模板变量不存在 | `200` 流，`run_failed`，`nodeId` 是 llm |
| 7 | 正常图 | `200` 流，`run_finished`，`outputs` 正确 |
| 8 | 同一请求打两次 | 两个不同的 `runId`，事件序列结构相同 |
| 9 | `Content-Type` | `text/event-stream; charset=utf-8` |
| 10 | 帧格式 | 每帧 `event:` + `data:` + 空行；`data` 单行 |

```powershell
# 批量检查 1~4（不解析流，只看状态码）
$base = 'http://localhost:3001'
$token = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email='alice@example.com'; password='password123' } | ConvertTo-Json)).accessToken

foreach ($case in @(
  @{ name='no-token';        headers=@{} },
  @{ name='with-token';      headers=@{ Authorization="Bearer $token" } }
)) {
  try {
    $res = Invoke-WebRequest -Method Post -Uri "$base/apps/<APP_ID>/run" `
      -Headers $case.headers -ContentType 'application/json' -Body '{"inputs":{}}'
    "{0}: {1} {2}" -f $case.name, $res.StatusCode, $res.Headers['Content-Type']
  } catch {
    "{0}: {1}" -f $case.name, $_.Exception.Response.StatusCode.value__
  }
}
```

> **面试考点 · 为什么用 `Invoke-WebRequest` 而不是 `Invoke-RestMethod` 检查？**
> `Invoke-RestMethod` 会把响应体直接反序列化成对象，SSE 的 `text/event-stream` 不是合法 JSON，容易报解析错误；`Invoke-WebRequest` 保留原始文本与响应头，适合检查协议层。
> 反过来，检查 JSON 错误体时用 `Invoke-RestMethod` 更省事。**工具要匹配被测对象的形态。**

---

## 7. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 预检顺序 | 401 → 404（归属）→ 400（草稿/图/节点 data）；安全判断最先，避免状态码泄露存在性 |
| 错误分层 | 写头前 = HTTP JSON；写头后 = `run_failed` 事件 |
| `@Res()` 的代价 | 绕过 Nest 响应管道，之后抛异常无法改状态码 |
| `void` 后台任务 | 必须自带 try/catch/finally；否则 `unhandledRejection` |
| 第一帧保证 | `run_started` 先入队再启动执行，FIFO 保证顺序 |
| 异步生成器 | 调用不执行，首次 `next()` 才跑；预检失败不会创建队列 |
| 队列关闭 | `finally { queue.close() }`；`drain()` 取完即结束，控制器才能 `end()` |
| 客户端断开 | 需监听 `request.close` 主动取消；当前未实现，执行会跑完 |
| 为什么没有 compression | 压缩中间件会缓冲 SSE，破坏“逐帧到达” |
| 可观测性 | `runId` 贯穿日志与事件；`elapsedMs` 用于性能对比 |

---

## 8. 下一步

- `04-Python引擎.md`：FastAPI 侧同一套语义（`StreamingResponse`、`asyncio.Queue`、`LangGraph` Python 版），并逐项对齐事件顺序与文案。
- `05-前端流式面板.md`：`fetch` + `ReadableStream` 切帧、Zod 校验、token 增量渲染与终态处理。
