# 02 · LangGraph 编译图（TS）

> 所属：阶段 4 · 执行引擎
> 本篇覆盖：新建 `apps/api-ts/src/engine/` 模块——用 **LangGraph** 把契约里的 `Graph` **动态编译**成 `StateGraph` 并按**拓扑序**执行；用自建的 **`RunEventQueue`** 把过程事件交给 SSE 传输层；按 `start` / `llm` / `end` 三种节点桩执行，其中 `llm` 节点按**每 8 个 Unicode 码点**切片发 `token`；模板按 `{{ path }}` 从**变量池**渲染；运行前做**预检**（草稿非空 / 图合法 / 节点数据形状），失败即普通 JSON 400。
> **本篇首次教学（本项目的学习核心）：① LangGraph 的心智模型（`StateGraph` = 状态机；节点 = 读 state 返回「增量」的函数；边 = 转移；`START`/`END` 是虚拟起止节点）；② 用 `Annotation` 定义状态与 **reducer / 合并函数**（为什么多节点写同一 channel 需要它）；③ **动态构建**（从 `Graph` JSON 循环 `addNode` / `addEdge`，`START → start`、`end → END`）；④ `compile()` 与 `invoke()` / `ainvoke()`，编译期做了什么（拓扑校验、构建执行通道）；⑤ **为什么用 LangGraph 而不是手写 for 循环**；⑥ **本项目的一处关键取舍：事件用自建队列 `RunEventQueue` 往外发，而不是用 LangGraph 的 custom stream**（保证两端事件顺序与 payload 可控可比、执行器与传输解耦）**
> （SSE 帧格式 / 6 种事件与顺序 / 两类错误通道 / 节点 data 形状见 `04-执行引擎/01-运行契约与SSE事件协议.md`；错误文案 §4 见该篇 §8；`validateGraph` 纯函数见 `03-画布/01-图JSON契约与校验.md`；NestJS 装饰器 / DI / 模块系统见 `00-项目初始化/05-NestJS起步.md`；DTO 与 `class-validator` 见 `01-账号与认证/03-NestJS认证.md`，本篇只引用不重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 4 的立论：把「一份 JSON 图」编译成「可执行的程序」

阶段 3 结束时，我们手里已经有了：一份 `Graph`（`nodes[]` + `edges[]`）、一个 `validateGraph` 纯函数、和一套「存草稿 / 发布」的接口。

> **但「数据结构合法」不等于「能跑」。** `Graph` 只是**描述**（谁连谁、每个节点配了什么），要把它**跑起来**，需要一个**执行器**：读节点配置 → 按边的方向决定执行顺序 → 逐个执行 → 把每个节点的输出传给下游。

本阶段就做这个执行器。它要做四件事：

```
Graph（JSON）
  │
  ├─ ① 编译：把 nodes/edges 翻译成「可执行图」        ← LangGraph StateGraph
  ├─ ② 调度：按拓扑序（边决定先后）逐个执行节点        ← LangGraph 的 compile().invoke()
  ├─ ③ 执行：每种节点类型一个「算子」                  ← nodes/、template.ts
  └─ ④ 上报：执行过程实时吐出事件                      ← RunEventQueue → SSE
```

本篇只讲 **TS 端**（api-ts）。TS 端**真的用了 LangGraph**：`@langchain/langgraph@1.5.1`。它是本阶段的学习核心——因为这可能是你第一次接触「**图的执行引擎**」这一类框架，它和「写个函数一把梭」完全不同。

---

## 1. 本篇目标

- 新建 `apps/api-ts/src/engine/`：`EngineModule` + `EngineService` + `RunController` + `events.ts` + `template.ts` + `nodes/`。
- 用 **LangGraph** 动态构建 `StateGraph`：`addNode(nodeId, fn)`、按 `edges` 连边、`START → start`、`end → END`，然后 `compile().invoke()` 执行。
- 用自建的 **`RunEventQueue`** 桥接「执行」与「SSE 传输」：执行侧 `emit`，传输侧 `drain`。
- 实现三种节点的桩语义（`start` 校验输入、`llm` 渲染并切片吐 token、`end` 渲染输出）+ 模板解析。
- 把「预检」放在**开流之前**：草稿为空 / 图不合法 / 节点数据形状非法 → 普通 JSON 400。

**验收标准**

1. `pnpm --filter @mini-dify/api-ts build`（`nest build`）通过。
2. 跑一张 `start → llm → end` 的图，能按固定顺序收到 6 类事件：首帧 `run_started`、`llm` 节点穿插 `token`、末帧 `run_finished`（见 §16 实测）。
3. 反向用例行为正确：草稿为空 → `400 {"message":"Graph is empty"}`；图非法 → 400 图校验文案；模板变量不存在 → 流内 `run_failed`；缺必填输入 → 流内 `run_failed`。

---

## 2. 前置条件

- 阶段 4 · 01 已完成：契约里有 `POST /apps/{id}/run`、`RunRequest`、`RunEvent`，且 `sse-events.md` / `error-messages.md §4` 已就位（契约已 `pnpm run build:contract`）。
- 阶段 3 的 `validateGraph`（`apps/api-ts/src/graph/graph.validator.ts`）与 `PrismaService`（全局模块）可用。
- 阶段 1 的 `JwtAuthGuard` 与 `CurrentUser` 装饰器可用（`AuthModule` 导出）。
- `pnpm install` 已执行过。

---

## 3. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行（或按列注明）。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm --filter @mini-dify/api-ts add @langchain/langgraph @langchain/core` | 仓库根 | 安装 **LangGraph** 与其基础包。`langgraph` 依赖 `core`（`Annotation` 等从 `langgraph` 导入，消息/工具等从 `core` 来） | `apps/api-ts/package.json` 出现 `"@langchain/langgraph": "^1.5.1"`、`"@langchain/core": "^1.2.18"` |
| `pnpm run build:contract` | 仓库根 | 编译契约（新类型 `RunEvent` 等） | 无报错 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 编译 NestJS（`nest build`），验证引擎能编译通过 | 无报错，产出 `apps/api-ts/dist` |
| `pnpm --filter @mini-dify/api-ts start:dev` | 仓库根 | 启动 api-ts（开发态热重载） | 监听 `http://localhost:3001` |
| `curl -N -X POST …/apps/{id}/run` | 任一端 | 以 `-N`（禁用缓冲）观察 SSE 流 | 逐帧打印 `event: …` / `data: …` |

> 依赖版本：本仓库 `apps/api-ts/package.json` 里写的是 `"@langchain/langgraph": "^1.5.1"`、`"@langchain/core": "^1.2.18"`。`^1.5.1` 表示「兼容 1.x 的 ≥1.5.1」，实测安装到的即 `@langchain/langgraph@1.5.1`。

---

## 4. 先看清要做什么

```
apps/api-ts/src/engine/
  ├── engine.module.ts      ← NestJS 模块（挂 RunController + EngineService）            （本篇 §5）
  ├── events.ts             ← 事件构造 + 帧序列化 + 运行期队列 RunEventQueue               （本篇 §6）
  ├── engine.service.ts     ← 预检 + 动态编译 LangGraph + 执行 + 事件上报                 （本篇 §7）
  ├── run.controller.ts     ← POST /apps/{id}/run，手写 SSE 帧写进 express Response       （本篇 §8）
  ├── dto/run.dto.ts        ← RunRequestDto（@IsObject 校验 inputs）                      （本篇 §8）
  ├── template.ts           ← 变量池 Pool + 模板解析 renderTemplate / resolvePath         （本篇 §9）
  └── nodes/
       ├── start.node.ts    ← start 节点桩                                                （本篇 §9）
       ├── llm.node.ts      ← llm 节点桩（渲染 + 8 码点切片吐 token）                       （本篇 §9）
       └── end.node.ts      ← end 节点桩                                                  （本篇 §9）
```

一次 run 的数据流：

```
POST /apps/{id}/run  { inputs }
  │
  ▼ RunController（@UseGuards(JwtAuthGuard)）
  │   ① engineService.run(...)  ← **预检**（查库、validateGraph、节点数据形状）
  │        预检失败 → 抛 HttpException → 全局过滤器 → 普通 JSON 400（**流还没开**）
  │        预检通过 → 返回 AsyncGenerator<RunEvent>
  │   ② response.setHeader(...) + flushHeaders()   ← 此刻才开流（200 定死）
  ▼   ③ for await (event of events) response.write(formatSseFrame(event))
  │
  ▼ EngineService.execute
        queue.emit(run_started)；后台 void this.runGraph(...)；yield* queue.drain()
          │
          ▼ runGraph：StateGraph 动态建图 → compile() → invoke({ pool: { inputs } })
               └─ 每个节点（LangGraph node）：emit node_started → 执行 → emit node_finished
                        └─ llm：渲染 prompt → 每 8 码点切片 → emit token
               └─ 结束：emit run_finished（成功） / emit run_failed（出错），queue.close()
```

**关键点**：**传输（SSE）与执行（LangGraph）之间隔着一个 `RunEventQueue`**——这是本项目的核心取舍（§15）：执行器只管「把事件塞进队列」，控制器只管「把队列里的事件写成 SSE 帧」，两边**谁也不认识谁**。

---

## 5. 完整代码：模块（engine.module.ts）

**完整文件路径：`apps/api-ts/src/engine/engine.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { EngineService } from './engine.service'
import { RunController } from './run.controller'

/**
 * 执行引擎模块（阶段 4）。`PrismaService` 来自全局 `PrismaModule`，
 * `JwtAuthGuard` 由 `AuthModule` 提供并导出，均无需在此声明。
 */
@Module({
  imports: [AuthModule],
  controllers: [RunController],
  providers: [EngineService],
})
export class EngineModule {}
```

> `@Module` / `imports` / `controllers` / `providers` 见 `00-项目初始化/05-NestJS起步.md`；`PrismaModule` 是 `@Global()`（见 `01-账号与认证/02-Prisma.md`），所以此处**不用** import 它；`AuthModule` 导出了 `JwtAuthGuard`（见 `02-应用管理/03-NestJS应用模块.md` 的 DI 边界）。
>
> 最后要在 `apps/api-ts/src/app.module.ts` 的 `imports` 里加入 `EngineModule`（阶段 4 的新增一行）。

---

## 6. 完整代码：事件与队列（events.ts）

**完整文件路径：`apps/api-ts/src/engine/events.ts`**

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

**要点**：

- **`RunEvent` 从契约包 import**：事件的**形状真源**在 `@mini-dify/contract`（见阶段 4 · 01 的 `src/index.ts`），本文件只负责**构造**它们。
- **`formatSseFrame` 是「帧序列化的唯一实现」**：`event: ${name}\n` + `data: ${JSON.stringify(data)}\n\n`——`JSON.stringify` 默认输出单行（符合 `sse-events.md` §1 的「单行 JSON」）。
- **`RunError` 是运行期错误的统一类型**：`start` / 模板解析抛它，`runGraph` 捕获后把 `message` 塞进 `run_failed`。
- **`RunEventQueue` 是一个「异步生产者 / 消费者」桥**：`emit` 是同步入队（生产者 = 执行的节点函数），`drain` 是异步生成器（消费者 = SSE 控制器）。详见 §15。

---

## 7. 完整代码：引擎核心（engine.service.ts）

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**

```ts
import { randomUUID } from 'node:crypto'

import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Graph, GraphNode } from '@mini-dify/contract'

import { validateGraph } from '../graph/graph.validator'
import { PrismaService } from '../prisma/prisma.service'
import {
  formatSseFrame,
  nodeFinished,
  nodeStarted,
  RunEventQueue,
  runFailed,
  runFinished,
  runStarted,
  token,
  type RunEvent,
} from './events'
import { runEndNode } from './nodes/end.node'
import { runLlmNode } from './nodes/llm.node'
import { runStartNode } from './nodes/start.node'
import type { Pool } from './template'

/**
 * 变量池状态注解：`pool` 用「合并」reducer，节点返回 `{ pool: { <nodeId>: <output> } }`
 * 逐步累积；初始输入 `{ pool: { inputs } }` 先与默认空对象合并。
 */
const RunState = Annotation.Root({
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
})

type RunStateValue = { pool: Pool }

/**
 * `StateGraph` 是「不可变类型累积」的构建器：动态按节点 id 建图时，其泛型参数无法静态收敛。
 * 这里用等价的结构类型做一次转换，仅约束用到的三个方法（运行时实现不变）。
 */
interface DynamicStateGraph {
  addNode(key: string, action: (state: RunStateValue) => Promise<Partial<RunStateValue>>): DynamicStateGraph
  addEdge(from: string, to: string): DynamicStateGraph
  compile(): { invoke(input: RunStateValue): Promise<RunStateValue> }
}

/** 一次运行中由节点函数回写的共享状态。 */
interface RunContext {
  queue: RunEventQueue
  failedNodeId: string | null
  lastOutputs: Record<string, unknown>
}

/**
 * 执行引擎（阶段 4）。
 *
 * 用 **LangGraph** 把契约里的 `Graph` 编译成 `StateGraph` 并按拓扑序执行（见 sse-events.md §4）：
 * 动态 `addNode(nodeId, fn)`、按 `edges` 连边、`START → start`、`end → END`。
 * 运行前先做预检（草稿非空、`validateGraph`、节点数据形状），不通过即 400（普通 JSON）。
 *
 * 说明（自行做主的设计决定）：事件通过自建的 `RunEventQueue` 传出，而非 LangGraph 的
 * custom stream —— 这样两端事件顺序与 payload 完全可控、逐字节可比，且与执行器解耦。
 */
@Injectable()
export class EngineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 预检并返回 SSE 事件流。
   *
   * 预检失败（草稿为空 / 图不合法 / 节点数据形状非法）抛 `BadRequestException`（普通 JSON 400）；
   * 归属不符抛 `NotFoundException`（404）。这些都发生在**打开流之前**，故不会污染 SSE 帧。
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
    const errors = [...validateGraph(graph), ...validateNodeData(graph)]
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
    return this.execute(appId, graph, inputs)
  }

  /** 写一帧 `run_started`，后台执行图，并把队列里的事件转成异步生成器。 */
  private async *execute(
    appId: string,
    graph: Graph,
    inputs: Record<string, unknown>,
  ): AsyncGenerator<RunEvent> {
    const queue = new RunEventQueue()
    const runId = randomUUID()
    queue.emit(runStarted(runId, appId))
    void this.runGraph(graph, inputs, queue, runId)
    yield* queue.drain()
  }

  /** 编译并执行整张图，把过程事件写入队列；结束（成功/失败）后关闭队列。 */
  private async runGraph(
    graph: Graph,
    inputs: Record<string, unknown>,
    queue: RunEventQueue,
    runId: string,
  ): Promise<void> {
    const startedAt = Date.now()
    const context: RunContext = { queue, failedNodeId: null, lastOutputs: {} }
    try {
      const builder = new StateGraph(RunState) as unknown as DynamicStateGraph
      for (const node of graph.nodes) {
        builder.addNode(node.id, this.makeNodeAction(node, context))
      }
      for (const edge of graph.edges) {
        builder.addEdge(edge.source, edge.target)
      }
      const startNode = graph.nodes.find((node) => node.type === 'start') as GraphNode
      builder.addEdge(START, startNode.id)
      for (const node of graph.nodes) {
        if (node.type === 'end') {
          builder.addEdge(node.id, END)
        }
      }
      await builder.compile().invoke({ pool: { inputs } })
      queue.emit(runFinished(runId, context.lastOutputs, Date.now() - startedAt))
    } catch (error) {
      queue.emit(runFailed(runId, context.failedNodeId, messageOf(error)))
    } finally {
      queue.close()
    }
  }

  /** 生成某节点的执行动作（LangGraph node）：发出开始/结束事件，失败时记录出错节点。 */
  private makeNodeAction(
    node: GraphNode,
    context: RunContext,
  ): (state: RunStateValue) => Promise<Partial<RunStateValue>> {
    return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
      context.queue.emit(nodeStarted(node.id, node.type))
      try {
        const output = this.executeNode(node, state.pool, context.queue)
        context.queue.emit(nodeFinished(node.id, node.type, output))
        if (node.type === 'end') {
          context.lastOutputs = output.outputs as Record<string, unknown>
        }
        return { pool: { [node.id]: output } }
      } catch (error) {
        context.failedNodeId = node.id
        throw error
      }
    }
  }

  /** 按节点类型分派执行（`llm` 节点在执行中穿插 `token` 事件）。 */
  private executeNode(node: GraphNode, pool: Pool, queue: RunEventQueue): Record<string, unknown> {
    switch (node.type) {
      case 'start':
        return runStartNode(node, pool)
      case 'llm':
        return runLlmNode(node, pool, (text) => queue.emit(token(node.id, text)))
      case 'end':
        return runEndNode(node, pool)
    }
  }
}

/** 节点数据形状校验（引擎侧，见 error-messages.md §4.1）。 */
function validateNodeData(graph: Graph): string[] {
  const errors: string[] = []
  for (const node of graph.nodes) {
    const data = (node.data ?? {}) as Record<string, unknown>
    if (node.type === 'start') {
      const inputs = data.inputs
      if (!Array.isArray(inputs)) {
        errors.push(`start node ${node.id} inputs must be an array`)
        continue
      }
      for (const item of inputs) {
        if (!isPlainObject(item) || typeof item.name !== 'string') {
          errors.push(`start node ${node.id} input must have a name`)
        }
      }
    } else if (node.type === 'llm') {
      if (typeof data.prompt !== 'string') {
        errors.push(`llm node ${node.id} prompt must be a string`)
      }
    } else if (node.type === 'end') {
      const outputs = data.outputs
      if (!Array.isArray(outputs)) {
        errors.push(`end node ${node.id} outputs must be an array`)
        continue
      }
      for (const item of outputs) {
        const output = isPlainObject(item) ? item : {}
        if (typeof output.name !== 'string') {
          errors.push(`end node ${node.id} output must have a name`)
        }
        if (typeof output.value !== 'string') {
          errors.push(`end node ${node.id} output must have a value`)
        }
      }
    }
  }
  return errors
}

/** 是否为「普通对象」（数组与 null 不算）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 取错误文案（用于 `run_failed` 的 `message`）。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

**要点（读法指南）**：

- **`RunState`（§7 顶部）= 图的「共享状态」**：只有一个 channel `pool`（变量池），带一个**合并 reducer**（`{...previous, ...update}`）。每个节点返回 `{ pool: { [nodeId]: output } }`，Reducer 把它并进大 `pool` 里——这就是「变量池逐步累积」的实现（详见 §11）。
- **`run()` = 预检**：查归属（404）→ 草稿为空 `Graph is empty`（400）→ `validateGraph` + `validateNodeData` 合并成一条 `"; "` 文案（400）。**全部发生在开流之前**（见阶段 4 · 01 §13）。
- **`execute()` = 开流侧**：先 `emit(run_started)`，再 `void this.runGraph(...)`（**不 await**，让图在后台跑），最后 `yield* queue.drain()` 把队列里的事件**作为异步生成器吐出**。
- **`runGraph()` = 编译 + 执行**：动态建图（见 §12）→ `compile().invoke({ pool: { inputs } })`（见 §13）→ 结束后 `run_finished` / `run_failed`，并 `queue.close()` 收束流。
- **`makeNodeAction()` = 每个节点的「壳」**：发 `node_started` → 执行 → 发 `node_finished` → 返回**增量** `{ pool: { [node.id]: output } }`；失败则记录 `failedNodeId` 后**重新抛出**（让 LangGraph 中止、`runGraph` 捕获转成 `run_failed`）。
- **`executeNode()` = 按类型分派**：`llm` 的 `emitToken` 回调把它接成 `queue.emit(token(node.id, text))`。

---

## 8. 完整代码：控制器与 DTO（run.controller.ts / dto/run.dto.ts）

控制器负责把「事件生成器」**写成 SSE 帧**并推给客户端。

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

**完整文件路径：`apps/api-ts/src/engine/dto/run.dto.ts`**

```ts
import { IsObject } from 'class-validator'

/** POST /apps/{id}/run 请求体 —— 对应契约 `RunRequest`。 */
export class RunRequestDto {
  /** 运行输入，键为输入变量名（内部键不校验，原样透传给引擎）。 */
  @IsObject()
  inputs!: Record<string, unknown>
}
```

**要点**：

- **为什么不用 `@Sse()`**：NestJS 有个 `@Sse()` 装饰器专门做 SSE，但它对帧的序列化细节（`data:` 行怎么拼、`id:`/`retry:` 怎么加）有自己的实现，**本项目要求帧逐字节可控**（要与 api-py 对齐），所以**绕过它**，直接用 express 的 `Response` **手写帧**（`setHeader` + `flushHeaders` + `write`）。
- **`flushHeaders()` 是分水岭**：这一行**之前**抛异常 → 普通 JSON 400；这一行**之后** → 已是 `200` 流，只能靠 `run_failed` 事件报错（见阶段 4 · 01 §13）。
- **`@Res()` + `{ passthrough: false }` 语义**：一旦用了 `@Res()`，Nest 不再自动处理返回值，响应完全由我们手动收尾（`response.end()`）。
- **`RunRequestDto` 的 `@IsObject()`**：只校验「`inputs` 是个对象」，**不校验内部键**（键由所选图的 `start` 节点约定，运行期才知道）。DTO 与 `class-validator` 见 `01-账号与认证/03-NestJS认证.md`。

---

## 9. 完整代码：节点与模板（nodes / template.ts）

这些是「每种节点类型怎么跑」的**算子**，以及它们共用的**模板解析**。

**完整文件路径：`apps/api-ts/src/engine/template.ts`**

```ts
import { RunError } from './events'

/**
 * 模板解析（引擎语义，两端必须一致，见 sse-events.md §4）。
 *
 * 变量池 `pool` 初始为 `{ "inputs": <RunRequest.inputs> }`，每个节点执行完把自身输出
 * 写入 `pool[<nodeId>]`。字符串里的 `{{ a.b }}`（花括号内允许空格）按点路径取值并替换。
 */

/** 变量池：键为 `inputs` 或节点 id，值为该键下的 JSON 对象。 */
export type Pool = Record<string, unknown>

/** 匹配 `{{ path }}`：花括号内不含花括号，允许首尾空格。 */
const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

/** 把 `text` 中的模板片段按 `pool` 渲染（模板外的文本原样保留）。 */
export function renderTemplate(text: string, pool: Pool): string {
  return text.replace(TEMPLATE_PATTERN, (_match: string, rawPath: string) =>
    stringifyValue(resolvePath(rawPath.trim(), pool)),
  )
}

/** 按点路径从 `pool` 取值；任一段不存在即抛 `RunError`。 */
export function resolvePath(path: string, pool: Pool): unknown {
  let current: unknown = pool
  for (const segment of path.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      throw new RunError(`template variable not found: ${path}`)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** 渲染值转字符串：字符串原样，其余按紧凑 JSON 序列化（与 api-py 对齐）。 */
function stringifyValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
```

**完整文件路径：`apps/api-ts/src/engine/nodes/start.node.ts`**

```ts
import type { GraphNode, StartNodeData } from '@mini-dify/contract'

import { RunError } from '../events'
import type { Pool } from '../template'

/**
 * `start` 节点：把 `RunRequest.inputs` 按 `data.inputs` 声明逐条校验（缺必填即失败），
 * 输出 `{ inputs: <运行输入> }`。失败文案见 error-messages.md §4.2。
 */
export function runStartNode(node: GraphNode, pool: Pool): Record<string, unknown> {
  const declared = (node.data as unknown as StartNodeData).inputs
  const provided = (pool.inputs ?? {}) as Record<string, unknown>
  for (const input of declared) {
    if (input.required === true && !(input.name in provided)) {
      throw new RunError(`missing required input: ${input.name}`)
    }
  }
  return { inputs: provided }
}
```

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`**

```ts
import type { GraphNode, LlmNodeData } from '@mini-dify/contract'

import { renderTemplate, type Pool } from '../template'

/** 流式分片大小：每个 Unicode 码点 8 个字符一片（两端一致，见 sse-events.md §4）。 */
const TOKEN_SIZE = 8

/**
 * `llm` 节点（本阶段为**桩**）：把 `data.prompt` 用池渲染，输出 `{ text: <渲染后文本> }`，
 * 并把该文本按固定切片逐片交给 `emitToken`，以演示流式。
 */
export function runLlmNode(
  node: GraphNode,
  pool: Pool,
  emitToken: (text: string) => void,
): Record<string, unknown> {
  const prompt = String((node.data as unknown as LlmNodeData).prompt)
  const rendered = renderTemplate(prompt, pool)
  for (const chunk of chunkByCodePoints(rendered, TOKEN_SIZE)) {
    emitToken(chunk)
  }
  return { text: rendered }
}

/** 按 Unicode 码点切分（与 api-py 的按码点切片一致）。 */
function chunkByCodePoints(text: string, size: number): string[] {
  const codePoints = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < codePoints.length; i += size) {
    chunks.push(codePoints.slice(i, i + size).join(''))
  }
  return chunks
}
```

**完整文件路径：`apps/api-ts/src/engine/nodes/end.node.ts`**

```ts
import type { EndNodeData, GraphNode } from '@mini-dify/contract'

import { renderTemplate, type Pool } from '../template'

/**
 * `end` 节点：把 `data.outputs[].value` 逐条渲染，输出 `{ outputs: { name: 渲染值 } }`。
 * 该对象即 `run_finished` 的 `outputs`（多 `end` 时取拓扑序最后一个）。
 */
export function runEndNode(node: GraphNode, pool: Pool): Record<string, unknown> {
  const declared = (node.data as unknown as EndNodeData).outputs
  const outputs: Record<string, unknown> = {}
  for (const output of declared) {
    outputs[output.name] = renderTemplate(output.value, pool)
  }
  return { outputs }
}
```

**要点**：

- **变量池 `pool`**：初始 `{ inputs: <RunRequest.inputs> }`；每个节点跑完把自己的输出写进 `pool[<nodeId>]`（由 §7 的 reducer 完成）。于是 `end` 节点的 `value: "{{ llm_1.text }}"` 就能取到 `llm` 节点的输出。
- **`start`**：逐条校验必填输入（`required` 为真且缺失 → `RunError('missing required input: topic')`）；输出 `{ inputs }`。
- **`llm`（本阶段是桩）**：不真调模型，只是把 `prompt` 渲染后**原样返回**为 `text`，并把它切碎成 token。**「桩」= 先把管道跑通，阶段 5 再接真模型**（`data.model` 就是为此预留）。
- **token 切片**：`Array.from(text)` 先按 **Unicode 码点**拆（不是按 UTF-16 码元！这样 emoji / 中文不会被切坏），每 `8` 个码点一片。`"Hello mini-dify"`（15 码点）→ `"Hello mi"` + `"ni-dify"`（与阶段 4 · 01 §11.3 实测一致）。
- **`end`**：逐条渲染 `value`，得到 `{ name: 渲染值 }`；多个 `end` 时 `context.lastOutputs` 取**最后执行的那个**（`runGraph` 里 `context.lastOutputs = output.outputs`）。

---

## 10. 【技术教学 · 首次】LangGraph 的心智模型：StateGraph = 状态机

### 10.1 先抛开框架：一张「图」怎么执行？

给定 `nodes` 和 `edges`，最朴素的执行方式就是**按拓扑序**（谁是谁的前驱决定先后）逐个跑节点，并把**共享数据**（变量池）一路传下去：

```
开始 → start 节点 → llm 节点 → end 节点 → 结束
         │             │           │
         └── 都读写同一个「变量池」──┘
```

「**节点**」是**做什么**，「**边**」是**下一步去谁**，「**共享状态**」是**它们之间传递的东西**。LangGraph 就是把这三件事标准化成一个**状态机**：

| 概念 | LangGraph 里是什么 | 本项目对应 |
| --- | --- | --- |
| **状态（State）** | 一张「共享数据表」，若干 **channel**（字段） | `{ pool }`（变量池 channel） |
| **节点（Node）** | 一个函数：**读 state → 返回 state 的「增量」** | `makeNodeAction(node)` 返回的那个 async 函数 |
| **边（Edge）** | 一条转移：`A → B` 表示 A 跑完去 B | `graph.edges` 里每条边 `source → target` |
| **`START`** | **虚拟**起始节点（不是真节点） | `START → start`（图的入口） |
| **`END`** | **虚拟**结束节点 | `end → END`（图的出口） |

### 10.2 「节点 = 函数返回增量」是关键

别把节点想成「修改全局变量」的过程式函数。在 LangGraph 里：

- 节点函数**接收当前 state**（本项目只用到 `state.pool`）；
- 干完活**返回一个「部分 state」**（partial）——只写**它要更新的那部分**；
- 由**框架**把这个 partial **合并进** state，再决定下一个该跑谁。

本项目里，节点返回的就是：

```ts
return { pool: { [node.id]: output } }   // 「我只往 pool 里加一项：我这个节点的输出」
```

框架收到后，用 **reducer** 把它并进大 `pool`（见 §11）——于是下游节点读到的 `pool` 就多了一项。

### 10.3 为什么这比「一把梭的函数」好

一次 run 里，节点是按控制流（边）**逐步**跑的，state 在**每个节点前后**都要是可读的、可合并的。把这套「状态 + 转移」抽象出来，框架才能**替你**管：

- 谁是下一个（调度）；
- 多个节点写同一字段时怎么合并（reducer）；
- 将来加条件边 / 循环 / 持久化（checkpoint）时，怎么统一处理。

这正是 §14 要展开的「为什么不用手写 for 循环」。

---

## 11. 【技术教学 · 首次】用 `Annotation` 定义状态与 reducer

### 11.1 基本语法：`Annotation.Root`

```ts
import { Annotation } from '@langchain/langgraph'

const RunState = Annotation.Root({
  pool: Annotation<Pool>({                  // ← 定义名为 pool 的 channel
    reducer: (previous, update) => ({ ...previous, ...update }),  // ← 合并函数
    default: () => ({}),                    // ← 初值（未传输入时）
  }),
})
```

- **`Annotation.Root({...})`**：声明「这份 state 有哪些 channel」。键名就是 channel 名（这里是 `pool`）。
- **`Annotation<T>({...})`**：为某个 channel 指定类型 `T` 及其行为（`reducer` / `default`）。
- 于是 `state.pool` 的类型就是 `Pool`。

### 11.2 什么是 reducer（合并函数）

当一个节点返回 `{ pool: <update> }`，框架不能直接「覆盖」原本的 `pool`——因为**别的节点也可能写过它**。它需要一个**合并规则**：

```ts
reducer: (previous, update) => ({ ...previous, ...update })
//                                    ↑ 旧池全保留      ↑ 新的项并进来
```

这就是**浅合并**：`pool` 是一个「节点 id → 输出」的字典，每个节点只往里面**加一个新的键**，永不删旧键。所以 reducer 用 `{...previous, ...update}` 刚好——**旧键全留、新键加入**。

**为什么必须有 reducer**：如果**没有** reducer，LangGraph 对「同一 channel 被多次写」的默认行为是**后写覆盖先写**（last-write-wins）。那 `start` 节点写的 `pool.inputs` 就会被 `llm` 节点写的 `pool` **整份覆盖**掉——`end` 再也读不到 `inputs`。**reducer 就是告诉框架「这个 channel 允许多次写，按这个规则合并」**。

### 11.3 本项目里的完整流程

```
invoke({ pool: { inputs } })                 ← 初始：pool = { inputs: <RunRequest.inputs> }
   │  start 节点返回 { pool: { start_1: { inputs } } }
   ▼  reducer(合并)：pool = { inputs, start_1: { inputs } }
   │  llm 节点返回 { pool: { llm_1: { text } } }
   ▼  reducer：pool = { inputs, start_1: {...}, llm_1: { text } }
   │  end 节点读 pool.llm_1.text（模板 {{ llm_1.text }}）→ 返回 { outputs }
   ▼  最终 pool 里有全部节点的输出
```

注意注释里那句：**「初始输入 `{ pool: { inputs } }` 先与默认空对象合并」**——`default: () => ({})` 保证即使不传初始值也有一个空 `pool`，避免 `undefined`。

> 口诀：**channel 是「共享数据表的一列」，reducer 是「这一列允许多次写时的合并规则」；同字段多写就必须配 reducer。**

---

## 12. 【技术教学 · 首次】动态构建：从 `Graph` JSON 循环 `addNode` / `addEdge`

LangGraph 的常见写法是**静态**的：写死 `graph.addNode('a', fnA); graph.addNode('b', fnB); graph.addEdge('a','b')`（节点名是代码里的常量）。但本项目的图是**运行期从数据库读出来的 JSON**——节点 id、边的拓扑**事先不知道**。所以要**动态**建图：

```ts
const builder = new StateGraph(RunState) as unknown as DynamicStateGraph

// ① 每个契约节点 → 一个 LangGraph 节点（key = node.id）
for (const node of graph.nodes) {
  builder.addNode(node.id, this.makeNodeAction(node, context))
}

// ② 每条契约边 → 一条 LangGraph 边
for (const edge of graph.edges) {
  builder.addEdge(edge.source, edge.target)
}

// ③ 入口：START（虚拟）→ start 节点
const startNode = graph.nodes.find((node) => node.type === 'start') as GraphNode
builder.addEdge(START, startNode.id)

// ④ 出口：每个 end 节点 → END（虚拟）
for (const node of graph.nodes) {
  if (node.type === 'end') {
    builder.addEdge(node.id, END)
  }
}
```

对照关系：

| 本项目 | 写到哪 |
| --- | --- |
| `Graph.nodes[].id` | `addNode(key, ...)` 的 `key` |
| `Graph.nodes[].type` | 决定用哪个算子（`start`/`llm`/`end`） |
| `Graph.edges[].source / target` | `addEdge(from, to)` |
| （图没有显式入口） | 固定 `START → 唯一的 start` 节点 |
| （图没有显式出口） | 每个 `end` 节点 `→ END` |

**那行 `as unknown as DynamicStateGraph`（类型断言）是怎么回事？** `StateGraph` 的类型是「**逐步累积**」的：每 `addNode` / `addEdge` 一次，泛型就精确一分。可是我们**动态循环**地去加，编译器**没法静态知道**最终会长成什么类型，于是泛型收敛不了、直接写会类型报错。这里用 `DynamicStateGraph`（一个只包含我们用到的三个方法 `addNode` / `addEdge` / `compile` 的**结构类型**）做一次断言——**运行时实现完全没变**，只是**把动态建图那一小段从静态类型系统里「豁免」出来**。这也是「动态图的本质」：类型系统在运行期才知道的拓扑上使不上劲，只能退化成结构化接口。

> 本阶段的 `START` / `END` 是**固定接线**：图必须「恰好一个 start」（`validateGraph` 规则 3 保证），所以入口永远从它出发；出口则是每个 `end` 都接 `END`（`validateGraph` 规则 4 保证至少一个）。

---

## 13. 【技术教学 · 首次】`compile()` 与 `invoke()`：编译期做了什么

### 13.1 构建 vs 编译 vs 执行，是三件事

```
new StateGraph(RunState)      ← 构建：声明 state 形状
  .addNode(...).addEdge(...)  ← 搭建：加节点、连边（此时只是「图纸」）
  .compile()                  ← 编译：检查 + 装配成「可执行对象」
  .invoke({ pool: { inputs } })  ← 执行：真正跑起来
```

- **`compile()`**：把「图纸」变成一个**可执行**的对象。它在这一步做**校验与装配**：

  | 编译期做的事 | 说明 |
  | --- | --- |
  | **拓扑检查** | 入口/出口是否可达？有没有悬空节点？本项目因前置 `validateGraph`（规则 3/4/6/7）已保证合法，所以基本不会在此报错 |
  | **通道装配（Pregel）** | 把各 channel 的 reducer / default 装成执行期的「消息通道」，决定多节点写同字段时怎么合并（§11） |
  | **调度计划** | 依据边计算出「谁跑完轮到谁」的调度 |

  > 简单说：`compile()` 是「**从声明到可运行**」的那一步——它把「图纸」翻译成「执行器能用的东西」。

- **`invoke(input)`**：**同步式**（对调用方表现为 `Promise`）执行整张图，一路跑到 `END`，返回**最终 state**。本项目只 `await builder.compile().invoke({ pool: { inputs } })`，**不关心返回值**（因为输出已经通过事件发出去了）。另有 `ainvoke()` 是**原生异步**版本——`invoke` 内部其实就是包了 `ainvoke`，本项目用 `invoke` 即可。

### 13.2 节点按什么顺序执行？

`compile()` 后，框架按**拓扑序**跑：入口 `START → start` 先跑 `start`，跑完沿边到 `llm`，再到 `end`，最后到 `END`。**每个节点执行一次**（本阶段的图无环、无分支，`validateGraph` 规则 7 禁止自环）。

实测（见 §16）：`start_1 → llm_1 → end_1` 正是拓扑序。

### 13.3 出错时怎么终止？

`makeNodeAction` 里节点抛错 → 该 action 的 `Promise` reject → `invoke()` reject → `runGraph` 的 `catch` 捕获 → `emit(run_failed)`。**已发出的帧保持原样，末尾追加 `run_failed`，不再发 `run_finished`**（与 `sse-events.md` §3 一致）。

---

## 14. 【技术教学 · 首次】为什么用 LangGraph，而不是手写 for 循环

面对「start → llm → end」这么简单的图，**完全可以**手写：

```ts
// 反面写法：手写一条直线
const pool = { inputs }
pool['start_1'] = runStartNode(startNode, pool)
pool['llm_1'] = runLlmNode(llmNode, pool, emit)
pool['end_1'] = runEndNode(endNode, pool)
```

那为什么还要引入 LangGraph？因为它**替你做**（且将来能继续替你做）这些：

| 能力 | 手写 for 循环 | LangGraph |
| --- | --- | --- |
| **状态管理** | 自己维护一个 `pool`，手动传 | channel + reducer，框架合并（§11） |
| **拓扑调度** | 自己写「谁先谁后」，图一复杂就乱 | 按边自动算拓扑序（§13） |
| **分支 / 条件边** | 要手写 if/else 跳转 | 加条件边即可（阶段 5+ 会用） |
| **循环 / 迭代** | 手写 while，容易写出死循环 | 图里加回边，框架管（将来） |
| **持久化（checkpoint）** | 得自己存/恢复中间态 | 框架原生支持（将来做「断点续跑」） |
| **可观测 / 追踪** | 得自己插桩 | 框架有 callback / stream 机制 |

**本阶段的图确实是直线**——引入 LangGraph 的价值不在「这一张图更省代码」，而在**它是这个领域公认的「图执行引擎」心智模型**：学会用它，就等于学会了「把一段图数据用状态机跑起来」这件事本身；阶段 5 起（真模型、条件分支、循环、持久化）它的收益会越来越大。**用简单例子学一个通用抽象，是划算的。**

> 一句话：**手写 for 循环只能跑今天的直线图；LangGraph 把「状态 + 调度 + 扩展点」都规范化了，是给「图会越长越复杂」的未来留的路。**

---

## 15. 【技术教学 · 首次】关键取舍：自建 `RunEventQueue`，而不是 LangGraph 的 custom stream

### 15.1 LangGraph 其实能「流式吐事件」

LangGraph 有 streaming 能力（`streamMode` / `custom` stream 等）：执行时可以边跑边把中间态吐出来。那为什么不直接用它，反而**自己写了一个 `RunEventQueue`**？

### 15.2 三个理由

| 理由 | 说明 |
| --- | --- |
| **帧要逐字节可控、可比** | 契约要求 api-ts 与 api-py 产出**完全一致**的事件序列与帧格式（`sse-events.md`）。框架的 stream 输出有自己的**事件形状、时机、字段**，抹平到「和 Python 端一致」成本高且脆弱；**自己构造 6 种事件**（`runStarted` / `nodeStarted` / `token` / …）则**完全掌控** |
| **执行器与传输解耦** | `EngineService` 只管「跑图 + `emit` 事件」；`RunController` 只管「`drain` 事件 + 写 SSE 帧」。**互不认识**：换传输（比如换 WebSocket）、换执行器（比如不换 LangGraph）都不用改另一边 |
| **顺序确定性** | `RunEventQueue` 是**单线程 FIFO**：`emit` 同步入队，`drain` 逐条出队。**谁先 emit 谁先出**，顺序天然确定（§15.3 解释为什么不会乱） |

### 15.3 `RunEventQueue` 是怎么做到「先 emit 后 drain 顺序不乱」的

看 `events.ts` 的实现，它就是个**缓冲区 + 等待者**：

```
emit(event)：buffer.push(event) → wake()（若有等待的 drain，唤醒它）
drain()：   while buffer 非空 → yield buffer.shift()   ← 逐条吐
            若 buffer 空且已 close → return（流结束）
            否则 await 一个 Promise，把自己注册成 waiter
close()：  closed = true → wake()
```

- **生产者（节点函数）是同步的**：`emit` 立即把事件 push 进数组，**不 await**。所以「执行到哪、事件就排到哪」的顺序**与执行顺序完全一致**。
- **消费者（SSE 控制器）是异步的**：`for await (const event of events)` 逐条取。取空时它挂起等待；一有 `emit` 就被唤醒。
- **JS 单线程事件循环**保证：同一个 tick 里 `push` 的顺序 = 数组里的顺序，消费者**只会按数组顺序取**——不会乱序。
- **`close()` 收束**：`runGraph` 无论成功/失败都在 `finally` 里 `close()`，消费者取完剩余事件后 `drain` 返回，`for await` 结束，控制器 `response.end()` → SSE 流正常收尾。

### 15.4 与 LangGraph 的边界

LangGraph 仍然**负责执行与调度**（`invoke`），只是「事件怎么传出去」这件**跨端一致性要求极高**的事，**交给自己控制**的工具。换句话说：

> **执行用 LangGraph，上报用自建队列**——各取所长：框架给「跑图的骨架」，我们控「事件的皮」。

---

## 16. 实测：事件序列与反向用例

### 16.1 正向：一张 `start → llm → end` 的图

图（草稿）大意：

```jsonc
{
  "version": "1",
  "nodes": [
    { "id": "start_1", "type": "start", "position": {"x":0,"y":0},
      "data": { "inputs": [{ "name": "topic", "type": "string", "required": true }] } },
    { "id": "llm_1", "type": "llm", "position": {"x":100,"y":0},
      "data": { "title": "LLM", "model": "stub", "prompt": "Hello mini-dify" } },
    { "id": "end_1", "type": "end", "position": {"x":200,"y":0},
      "data": { "outputs": [{ "name": "result", "value": "{{ llm_1.text }}" }] } }
  ],
  "edges": [
    { "id": "e1", "source": "start_1", "target": "llm_1" },
    { "id": "e2", "source": "llm_1", "target": "end_1" }
  ]
}
```

请求 `POST /apps/{id}/run`，body `{ "inputs": { "topic": "x" } }`。**SSE 原始输出**（token 文本可截断，但保留首尾）：

```
run_started
node_started(start_1)     →  node_finished(start_1)
node_started(llm_1)       →  token("Hello mi") → token("ni-dify") → node_finished(llm_1)
node_started(end_1)       →  node_finished(end_1)
run_finished(outputs={"result":"Hello mini-dify"})
```

对照 §11（心智模型）与 §9（节点桩）：

- `start_1` 校验输入后输出 `{ inputs: { topic: "x" } }`；
- `llm_1` 把 `prompt`（`"Hello mini-dify"`，无模板）原样作为 `text` 返回，并**每 8 码点**切两片 → `token("Hello mi")`、`token("ni-dify")`；
- `end_1` 渲染 `{{ llm_1.text }}` → `"Hello mini-dify"`，最终 `run_finished.outputs = { result: "Hello mini-dify" }`。

### 16.2 反向用例

| 用例 | 形态 | 结果 |
| --- | --- | --- |
| **草稿为空** | 普通 JSON 400 | `{"statusCode":400,"message":"Graph is empty","error":"Bad Request"}` |
| **图非法**（如 version≠1 / 无 start） | 普通 JSON 400 | 图校验文案（见 `03-画布/01-图JSON契约与校验.md` §3） |
| **模板变量不存在**（prompt 写 `{{ inputs.nope }}`） | **流内** `run_failed` | `{"nodeId":"llm_1","message":"template variable not found: inputs.nope"}` |
| **缺必填输入**（`topic` 为 required 但没给） | **流内** `run_failed` | `{"nodeId":"start_1","message":"missing required input: topic"}` |

> 前两者在**开流前**返回普通 JSON 400（连接都没进流）；后两者在**流内**以 `run_failed` 事件报出（状态码已是 200）——正是阶段 4 · 01 §13 的两类通道。

---

## 17. 构建与运行验证

**① 编译**

```bash
pnpm --filter @mini-dify/api-ts build
```

**目的**：`nest build` 编译 TS，验证引擎（含 LangGraph 用法）类型正确、能产出 `dist`。
**预期**：无报错；`apps/api-ts/dist/engine/` 下有编译产物。

**② 启动**

```bash
pnpm --filter @mini-dify/api-ts start:dev
```

**预期**：Nest 启动，监听 `http://localhost:3001`。

**③ 观察 SSE（先用 `-N` 关掉 curl 缓冲，否则看不到逐帧输出）**

```bash
# 1) 登录拿令牌（阶段 1 已有）
# 2) 给某应用 PUT 一张 start→llm→end 的草稿图（阶段 3 已有）
# 3) 运行
curl -N -X POST "http://localhost:3001/apps/<APP_ID>/run" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"inputs":{"topic":"x"}}'
```

**预期**：逐帧打印，形如

```
event: run_started
data: {"runId":"...","appId":"..."}

event: node_started
data: {"nodeId":"start_1","nodeType":"start"}
...
event: run_finished
data: {"runId":"...","outputs":{"result":"Hello mini-dify"},"elapsedMs":1}
```

**反向**：对草稿为空的应用请求，应收到**普通 JSON**（响应头 `Content-Type: application/json`），不是流。

---

## 18. 验收自测

| 检查项 | 命令 / 做法 | 预期 |
| --- | --- | --- |
| 引擎可编译 | `pnpm --filter @mini-dify/api-ts build` | 无报错 |
| 依赖已装 | 看 `apps/api-ts/package.json` | 有 `@langchain/langgraph`（`^1.5.1`）与 `@langchain/core`（`^1.2.18`） |
| 模块已挂 | 看 `apps/api-ts/src/app.module.ts` | `imports` 含 `EngineModule` |
| 正向能出事件 | 跑 §16.1 的图，`curl -N` | 依次收到 `run_started` / `started+finished`×3（llm 中间夹 `token`）/ `run_finished` |
| token 分片正确 | 看 `"Hello mini-dify"` | `token("Hello mi")` + `token("ni-dify")`（8 码点/片） |
| 输出正确 | 看 `run_finished` | `outputs={"result":"Hello mini-dify"}` |
| 草稿为空 | 对未编辑的应用请求 | `400 {"message":"Graph is empty"}`（普通 JSON） |
| 图非法 | 存一张非法图后请求 | 400 图校验文案（普通 JSON） |
| 模板变量不存在 | prompt 写 `{{ inputs.nope }}` | 流内 `run_failed {"nodeId":"llm_1","message":"template variable not found: inputs.nope"}` |
| 缺必填输入 | 不给 required 输入 | 流内 `run_failed {"nodeId":"start_1","message":"missing required input: topic"}` |
| 预检在开流前 | 看 400 响应的 `Content-Type` | `application/json`（**不是** `text/event-stream`） |

---

## 19. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 忘了配 reducer | 后跑的节点把 `pool` **整份覆盖**，下游读不到前面的输出 | 同 channel 多写必须配 `reducer`（§11）；本项目用 `{...previous, ...update}` 浅合并 |
| 把节点写成「改全局变量/过程式」 | 返回值形状不对、框架合并不上 | LangGraph 节点**返回增量**（`{ pool: { [id]: output } }`），不是去改共享对象（§10.2） |
| 动态建图时类型报错 | `addNode` / `addEdge` 泛型收敛不了 | 用 `DynamicStateGraph` 结构类型断言（§12）；运行时不变 |
| 忘了 `START`/`END` 接线 | 图「没有入口/出口」，`invoke` 跑不动或报错 | 固定 `START → start`、每个 `end → END`（§12） |
| 以为 `compile()` 才加节点 | 边加边错 | 顺序是 构建 → `addNode`/`addEdge` → `compile()` → `invoke()`（§13） |
| 在预检里就想发 `run_failed` | 客户端拿到的是流而不是 400 | 预检错误在**开流前**抛 `HttpException` → 普通 JSON 400（§7、阶段 4 · 01 §13） |
| 用 `@Sse()` 但帧对不上 | 与 Python 端逐字节比对失败 | 绕过 `@Sse()`，用 `@Res()` 手写帧（§8） |
| 忘了 `flushHeaders()` | 事件「攒着」直到结束才一次性到 | 开流后要 `flushHeaders()`，让帧即时推送（§8） |
| 用 LangGraph custom stream 直接吐事件 | 事件形状/时机与 Python 端不一致 | **自建 `RunEventQueue`**，事件由 `events.ts` 6 个构造函数掌控（§15） |
| 按 UTF-16 码元切片 | emoji / 部分中文被切坏 | 用 `Array.from(text)` 按 **Unicode 码点**切，每 8 片（§9） |
| 忘了 `queue.close()` | SSE 流**不结束**，客户端一直挂着 | `runGraph` 的 `finally` 里 `close()`（§7、§15.3） |
| `invoke` 里 `await` 了却忘了后台跑 | 流卡住（事件要先等图跑完才吐） | `execute` 里 `void this.runGraph(...)`（**不 await**），靠队列边跑边吐（§7） |
| DTO 去校验 `inputs` 内部的键 | 运行期才知道的键被静态拒绝 | `@IsObject()` 只校验「是个对象」，内部键不校验（§8） |

---

## 20. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **LangGraph 心智模型**：`StateGraph` = 状态机；节点 = 读 state 返回**增量**的函数；边 = 转移；`START`/`END` 是虚拟起止节点 | **首次教学于本篇** |
| **`Annotation` 定义状态 + reducer / 合并函数**：channel 是共享数据表的一列；同 channel 多写必须配 reducer，否则后写覆盖先写 | **首次教学于本篇** |
| **动态构建 `StateGraph`**：从 `Graph` JSON 循环 `addNode(node.id, fn)` / `addEdge(source, target)`；固定 `START → start`、`end → END`；泛型收敛不了时用结构类型断言 | **首次教学于本篇** |
| **`compile()` 与 `invoke()` / `ainvoke()`**：`compile()` = 拓扑校验 + 装配执行通道，是「声明→可运行」的一步；`invoke()` 跑到 `END` 返回最终 state | **首次教学于本篇** |
| **为什么用 LangGraph 而非手写 for 循环**：状态管理、拓扑调度、条件边/循环/持久化（checkpoint）都是原生能力；简单例子学通用抽象 | **首次教学于本篇** |
| **关键取舍：自建 `RunEventQueue` 而非 LangGraph custom stream**：为保证两端事件顺序与 payload 可控可比、执行器与传输解耦；单线程 FIFO + `close()` 收束 | **首次教学于本篇** |
| **引擎实现（TS）**：三种节点桩（`start` 校验输入 / `llm` 渲染 + 8 码点切片吐 token / `end` 渲染输出）、变量池 `pool`、`{{ path }}` 模板解析、运行前预检（`Graph is empty` / `validateGraph` / 节点数据形状）、绕过 `@Sse()` 用 `@Res()` 手写 SSE 帧 | 本篇 |

> 已在前序篇教学、本篇仅引用不重讲的：SSE 帧格式 / 6 种事件与顺序 / 两类错误通道 / 节点 data 形状见 `04-执行引擎/01-运行契约与SSE事件协议.md`；`validateGraph` 纯函数见 `03-画布/01-图JSON契约与校验.md`；NestJS 装饰器 / DI / 模块系统见 `00-项目初始化/05-NestJS起步.md`；DTO 与 `class-validator` / `ValidationPipe` 见 `01-账号与认证/03-NestJS认证.md`；Guard / `CurrentUser` 自定义装饰器见 `01-账号与认证/03-NestJS认证.md`；`PrismaService` 与 `@Global()` 模块见 `01-账号与认证/02-Prisma.md`；模块复用与 DI 边界（`AuthModule` 导出 Guard）见 `02-应用管理/03-NestJS应用模块.md`。
