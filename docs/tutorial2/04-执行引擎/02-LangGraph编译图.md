# 02 · LangGraph 编译图（执行引擎 MVP）

> 阶段 4 · 第 2 步
>
> 做完：`Graph`（JSON）→ `StateGraph`（LangGraph）→ 按拓扑序执行；`pool` 变量池累积各节点输出；`{{ path }}` 模板解析；`start` / `llm`（占位）/ `end` 三个节点运行时；事件在节点边界成对发出。
>
> **本篇面试考点**：为什么用 LangGraph 而不是手写遍历 · `Annotation` 与 reducer（合并而非覆盖）· 节点返回值是“状态更新”而不是副作用 · 为什么自己实现模板而不用 `eval` / 模板引擎 · 缺失变量为什么抛错 · 跨语言字符串化规则 · 事件为什么在包装层发 · 多个 `end` 谁说了算 · `recursionLimit`。

---

## 1. 编译总览

```text
数据库 graphJson（契约 Graph）
        │
        ├─ precheck：validateGraph（结构/语义）+ validateNodeData（节点 data）
        │      失败 → 普通 JSON 400（不写 SSE 头）
        ▼
new StateGraph(RunState)
        │  for node of graph.nodes  → addNode(node.id, action)
        │  for edge of graph.edges  → addEdge(source, target)
        │  START → start 节点
        │  end 节点 → END
        ▼
compile().invoke({ pool: { inputs } })
        │
        ▼
每个节点：emit(node_started) → 执行 → emit(node_finished) → 返回 { pool: { [id]: output } }
        │
        ▼
成功 emit(run_finished) / 失败 emit(run_failed) → close()
```

`StateGraph` 在这里承担三件事：

1. **拓扑序执行**——你只声明边，不手写“下一个是谁”；
2. **状态合并**——每个节点返回的状态更新，由 reducer 合并进全局状态；
3. **为后续阶段留口**——阶段 6 的条件边 + 环（ReAct）、阶段 8 的分支，都是同一个构建器的能力。

---

## 2. 状态：`pool` 与 reducer

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（阶段 4 的状态定义）

```ts
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type { Pool } from './template'

/**
 * 运行状态只有一份：变量池 `pool`。
 *
 * 初始 `{ pool: { inputs } }`；每个节点执行完返回 `{ pool: { <nodeId>: <output> } }`，
 * 由 reducer **合并**进已有对象——不是替换。
 */
const RunState = Annotation.Root({
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
})

/** 节点函数拿到的完整状态（阶段 4 只有 pool）。 */
type RunStateValue = { pool: Pool }
```

> **面试考点 · 为什么 reducer 是“合并”而不是“覆盖”？**
> 节点只返回自己那一片更新：`{ pool: { llm1: { text: '...' } } }`。
> 如果 reducer 用 `update` 直接覆盖，`pool.inputs` 和之前所有节点的输出都会消失。
> 用 `{ ...previous, ...update }` 才能让：
>
> - 后续节点的模板 `{{ llm1.text }}` 取到值；
> - 并行分支各自写 `pool[startBranch]` / `pool[otherBranch]` 时不互相踩。
>
> **reducer 决定了“状态是累积的还是瞬时的”。** 写错这一行，所有模板都会“变量不存在”。

> **面试考点 · 节点的返回值是“副作用”吗？**
> 不是。LangGraph 把节点函数视为**纯状态变换**：`(state) => partialState`。
> 真正的副作用（发 `token` 事件、写数据库）通过闭包里的 `queue` 完成，而不是塞进状态。
>
> 好处：状态可序列化、可快照（阶段 11 的 checkpoint / 事件重放都依赖这一点）；状态里塞一个 `EventEmitter` 或 `Response` 对象，就无法持久化。
> **状态放数据，副作用走通道。**

---

## 3. 模板解析

**完整文件路径：`apps/api-ts/src/engine/template.ts`**（阶段 4 版本；`tryRenderTemplate` 在阶段 8 追加）

```ts
import { RunError } from './events'

/**
 * 模板解析（引擎语义，两端必须一致）。
 *
 * 变量池 `pool` 初始为 `{ inputs: <RunRequest.inputs> }`，每个节点执行完把自身输出
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

使用示例：

| 模板 | `pool` | 结果 |
| --- | --- | --- |
| `你好，{{ inputs.name }}` | `{ inputs: { name: '小明' } }` | `你好，小明` |
| `{{ llm1.text }}` | `{ llm1: { text: '答案是 42' } }` | `答案是 42` |
| `{{ inputs.tags }}` | `{ inputs: { tags: ['a', 'b'] } }` | `["a","b"]` |
| `{{ inputs.missing }}` | `{ inputs: {} }` | `RunError: template variable not found: inputs.missing` |

> **面试考点 · 为什么不用 `eval` / `new Function` / 现成模板引擎？**
> 1. **安全**：`eval` 直接执行任意 JS，用户写一句 `{{ process.exit() }}` 就能搞垮进程。
> 2. **跨语言一致**：Python 侧要实现完全相同的行为，`eval` 无法对齐。这里语法简单到只有“点路径取值”一条，手写 20 行两端都能逐字符对上。
> 3. **错误可预期**：缺变量要抛 `template variable not found: xxx`，而不是 `ReferenceError: xxx is not defined` 这种引擎内部信息。
>
> **模板语言是产品语义的一部分，不是实现细节。** 一旦开放给用户，语法、错误、字符串化规则都进了契约。

> **面试考点 · 为什么缺失变量要抛错，而不是替换成空串？**
> 空串会**静默产生错误结果**：`写一首关于{{ inputs.topic }}的诗` → `写一首关于的诗`，模型照样能编，用户根本不知道输入丢了。
> 抛错能让 `run_failed` 的 `message` 明确指出 `template variable not found: inputs.topic`，`nodeId` 指出是哪个节点。
>
> 例外是阶段 8 的分支节点：未执行的分支变量本来就不存在，必须允许“缺失即空串”（`tryRenderTemplate`）。**同一套语法，不同节点用不同缺失策略**——策略由语义决定，不是全局一刀切。

> **面试考点 · 为什么非字符串值要 `JSON.stringify`？**
> `pool.llm1.text` 是字符串，直接拼；`pool.llm1.usage` 是对象，如果直接 `String(obj)` 会得到 `[object Object]`，信息全丢。
> 用紧凑 JSON（无空格）字符串化，既保留结构，又能让 Python 侧用 `json.dumps(value, separators=(',', ':'), ensure_ascii=False)` 产出**完全相同的字符串**。
> 注意 `ensure_ascii=False`：默认 `ensure_ascii=True` 会把中文转成 `\u4f60`，与 JS 的 `JSON.stringify` 不一致。

---

## 4. 节点运行时

### 4.1 `start`

**完整文件路径：`apps/api-ts/src/engine/nodes/start.node.ts`**

```ts
import type { GraphNode, StartNodeData } from '@mini-dify/contract'

import { RunError } from '../events'
import type { Pool } from '../template'

/**
 * `start` 节点：把 `RunRequest.inputs` 按 `data.inputs` 声明逐条校验（缺必填即失败），
 * 输出 `{ inputs: <运行输入> }`。
 */
export function runStartNode(node: GraphNode, pool: Pool): Record<string, unknown> {
  // data.inputs: [{ name, type: 'string', required }]
  const declared = (node.data as unknown as StartNodeData).inputs
  // 运行输入在 pool.inputs（由 run() 初始化）
  const provided = (pool.inputs ?? {}) as Record<string, unknown>
  for (const input of declared) {
    // 只校验 required；未声明 required 的键允许缺失
    if (input.required === true && !(input.name in provided)) {
      throw new RunError(`missing required input: ${input.name}`)
    }
  }
  // 输出原样透传：后续节点通过 {{ inputs.xxx }} 取
  return { inputs: provided }
}
```

> **面试考点 · 为什么 `start` 节点还要“再检查一遍”输入？**
> HTTP 层只保证 `inputs` 是对象（`@IsObject()`），不知道这张图声明了哪些必填项。`data.inputs` 是**图的一部分**，只有引擎看得到。
> 这就是分层：**DTO 校验请求形状，节点校验业务前置条件。**

> **面试考点 · 输入校验失败为什么是 `run_failed`，而不是 HTTP 400？**
> 因为它发生在 `start` 节点执行期间——此时 SSE 头已经写出（`run_started` 已经发了一帧）。
> 另一种做法是把它挪进 `precheck`（写头之前），返回 400。两种都合理；本项目选择“`start` 节点负责自己的输入”，因为：
>
> - `start` 节点的语义就是“入口校验”，放到引擎外会让节点变空；
> - 事件流里能看到 `node_started(start) → run_failed(nodeId=start)`，前端能高亮出错的节点。
>
> **关键是统一：两套后端必须选同一种，并写进协议。**

### 4.2 `llm`（阶段 4 的占位实现）

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`**（阶段 4 版本）

```ts
import type { GraphNode } from '@mini-dify/contract'

import { renderTemplate, type Pool } from '../template'

/**
 * `llm` 节点（阶段 4 占位）：渲染 prompt 后原样回显，并发一帧 `token`。
 *
 * 阶段 5 会替换成真实模型调用（ChatOpenAI + 流式），输出 `{ text, model, usage? }`；
 * 这里保留同样的输出形状，保证引擎与前端不需要改动。
 */
export async function runLlmNode(
  node: GraphNode,
  pool: Pool,
  emitToken: (text: string) => void,
): Promise<Record<string, unknown>> {
  const data = node.data as unknown as { prompt?: unknown }
  const prompt = renderTemplate(String(data.prompt ?? ''), pool)
  const text = `Echo: ${prompt}`
  // 占位实现也发 token：让前端流式渲染链路在阶段 4 就能端到端验证
  emitToken(text)
  return { text, model: 'stub' }
}
```

> **面试考点 · 为什么占位实现也要发 `token`、也要保持 `{ text, model }` 输出？**
> 因为**协议先于实现**。阶段 4 要验证的是“整条 SSE 链路 + 变量池 + 前端渲染”，不是模型质量。
> 占位实现只要遵守同样的输出形状和事件语义，阶段 5 换真实模型时：
>
> - 引擎不用改；
> - 前端不用改；
> - 契约测试不用改。
>
> **先固定接口，再替换实现**，是让每一步都能独立验收的关键。

### 4.3 `end`

**完整文件路径：`apps/api-ts/src/engine/nodes/end.node.ts`**

```ts
import type { EndNodeData, GraphNode } from '@mini-dify/contract'

import { renderTemplate, type Pool } from '../template'

/**
 * `end` 节点：把 `data.outputs[].value` 逐条渲染，输出 `{ outputs: { name: 渲染值 } }`。
 * 该对象即 `run_finished` 的 `outputs`（多个 `end` 时取最后执行完的那个）。
 */
export function runEndNode(node: GraphNode, pool: Pool): Record<string, unknown> {
  // data.outputs: [{ name: 'result', value: '{{ llm1.text }}' }]
  const declared = (node.data as unknown as EndNodeData).outputs
  const outputs: Record<string, unknown> = {}
  for (const output of declared) {
    // value 支持模板；渲染结果始终是字符串
    outputs[output.name] = renderTemplate(output.value, pool)
  }
  return { outputs }
}
```

> **面试考点 · 有多个 `end` 节点时，`run_finished.outputs` 用哪个？**
> 取**最后执行完**的那个。LangGraph 里多个 `end` 都可能被到达（例如两条分支各连一个 end），执行顺序不一定等于数组顺序。
> 实现上在包装层维护 `context.lastOutputs`，每执行完一个 `end` 就覆盖一次。
>
> 这不是“随便选一个”——它要求图设计者理解：**多个 end 意味着多个可能的返回值，最后一个到达的胜出。** 如果业务需要“所有分支的结果合并”，应该用一个 `end` 汇总，或阶段 8 的 `aggregator`。

---

## 5. 引擎：编译与执行

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（阶段 4 版本）

```ts
import { randomUUID } from 'node:crypto'

import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Graph, GraphNode } from '@mini-dify/contract'

import { validateGraph } from '../graph/graph.validator'
import { PrismaService } from '../prisma/prisma.service'
import {
  nodeFinished,
  nodeStarted,
  RunError,
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
 * 运行状态只有一份：变量池 `pool`。
 * `reducer` 用「合并」：节点只返回自己那一片，不能覆盖别人的输出。
 */
const RunState = Annotation.Root({
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
})

/** 节点函数拿到的完整状态（阶段 4 只有 pool）。 */
type RunStateValue = { pool: Pool }

/**
 * `StateGraph` 是「不可变类型累积」的构建器：动态按节点 id 建图时，泛型无法静态收敛。
 * 这里用等价的结构类型约束实际用到的方法（运行时实现不变）。
 */
interface DynamicStateGraph {
  addNode(
    key: string,
    action: (state: RunStateValue) => Promise<Partial<RunStateValue>>,
  ): DynamicStateGraph
  addEdge(from: string, to: string): DynamicStateGraph
  compile(): {
    invoke(input: RunStateValue, config?: { recursionLimit?: number }): Promise<RunStateValue>
  }
}

/** 一次运行中由节点包装层回写的共享结果。 */
interface RunContext {
  queue: RunEventQueue
  /** 出错节点 id（`run_failed.nodeId`）；null 表示错误不归属某个节点 */
  failedNodeId: string | null
  /** 最后一个 `end` 节点的输出 */
  lastOutputs: Record<string, unknown>
}

/**
 * 执行引擎（阶段 4）：把契约 `Graph` 编译成 LangGraph 并按拓扑序执行。
 *
 * 预检（草稿为空 / 图不合法 / 节点 data 形状非法）在打开流之前完成，
 * 失败抛普通 JSON 400/404；执行期错误一律转成 `run_failed`。
 */
@Injectable()
export class EngineService {
  constructor(private readonly prisma: PrismaService) {}

  /** 预检并返回 SSE 事件流（调用方负责写响应头）。 */
  async run(
    ownerId: string,
    appId: string,
    inputs: Record<string, unknown>,
  ): Promise<AsyncGenerator<RunEvent>> {
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    // 查不到 / 非本人：统一 404，不泄露“存在但不属于你”
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
    // 从未保存过草稿：没有图可跑（注意与「空图」不同，空图会被 validateGraph 拦）
    if (app.graphJson === null) {
      throw new BadRequestException('Graph is empty')
    }
    const graph = app.graphJson as unknown as Graph
    this.precheck(graph)
    return this.execute(appId, graph, inputs)
  }

  /** 写头之前的全部校验；多条错误用 "; " 拼接（与 Python 一致）。 */
  private precheck(graph: Graph): void {
    const errors = [...validateGraph(graph), ...validateNodeData(graph)]
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
  }

  /**
   * 事件流：先同步发 `run_started`，再后台执行图，最后把队列暴露成异步生成器。
   *
   * 注意 `void this.runGraph(...)`：执行是后台任务，SSE 消费者只负责从队列取事件。
   * `runGraph` 内部 `finally` 会 close 队列，因此 `drain()` 必然结束。
   */
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

  /** 编译并执行整张图；无论成功失败都关闭队列。 */
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

      // 1. 每个图节点注册成一个 LangGraph 节点（key 用节点 id）
      for (const node of graph.nodes) {
        builder.addNode(node.id, this.makeNodeAction(node, context))
      }

      // 2. 按契约里的边连线
      for (const edge of graph.edges) {
        builder.addEdge(edge.source, edge.target)
      }

      // 3. 入口：START → start 节点（validateGraph 保证恰好一个 start）
      const startNode = graph.nodes.find((node) => node.type === 'start') as GraphNode
      builder.addEdge(START, startNode.id)

      // 4. 出口：每个 end 节点 → END（可能多条）
      for (const node of graph.nodes) {
        if (node.type === 'end') {
          builder.addEdge(node.id, END)
        }
      }

      // 5. 执行。初始状态只放 inputs；pool 的 reducer 会合并后续更新
      await builder.compile().invoke(
        { pool: { inputs } },
        // 节点数越多，LangGraph 的默认 25 步越容易误伤；给足余量
        { recursionLimit: Math.max(25, graph.nodes.length * 3 + 20) },
      )

      queue.emit(runFinished(runId, context.lastOutputs, Date.now() - startedAt))
    } catch (error) {
      // 只发一帧 run_failed；message 直接取 RunError / 其他异常的 message
      queue.emit(runFailed(runId, context.failedNodeId, messageOf(error)))
    } finally {
      queue.close()
    }
  }

  /**
   * 把一个图节点包装成 LangGraph 动作。
   *
   * 事件在**包装层**发，而不是节点函数内部：
   * - `node_started` 一定先于执行；
   * - 只有成功才发 `node_finished`，异常时不会出现“finished 了但失败了”的矛盾。
   */
  private makeNodeAction(
    node: GraphNode,
    context: RunContext,
  ): (state: RunStateValue) => Promise<Partial<RunStateValue>> {
    return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
      context.queue.emit(nodeStarted(node.id, node.type))
      try {
        const output = await this.executeNode(node, state.pool, context.queue)
        context.queue.emit(nodeFinished(node.id, node.type, output))
        // 多个 end 时，最后执行完的胜出
        if (node.type === 'end') {
          context.lastOutputs = output.outputs as Record<string, unknown>
        }
        // 只回写自己那一片：pool[nodeId] = output
        return { pool: { [node.id]: output } }
      } catch (error) {
        // 记录出错节点，供 run_failed.nodeId 使用
        context.failedNodeId = node.id
        throw error
      }
    }
  }

  /** 按节点类型分派；阶段 4 只实现三种（其余类型留到后续阶段）。 */
  private async executeNode(
    node: GraphNode,
    pool: Pool,
    queue: RunEventQueue,
  ): Promise<Record<string, unknown>> {
    switch (node.type) {
      case 'start':
        return runStartNode(node, pool)
      case 'llm':
        // llm 节点在执行中穿插 token 事件
        return runLlmNode(node, pool, (text) => queue.emit(token(node.id, text)))
      case 'end':
        return runEndNode(node, pool)
      default:
        throw new RunError(`node type not supported yet: ${node.type}`)
    }
  }
}

/** 节点 data 形状校验（阶段 4 版本；后续阶段按节点类型追加）。 */
function validateNodeData(graph: Graph): string[] {
  const errors: string[] = []
  for (const node of graph.nodes) {
    const data = (node.data ?? {}) as Record<string, unknown>
    if (node.type === 'start') {
      if (!Array.isArray(data.inputs)) {
        errors.push(`start node ${node.id} inputs must be an array`)
        continue
      }
      for (const item of data.inputs) {
        if (!isPlainObject(item) || typeof item.name !== 'string') {
          errors.push(`start node ${node.id} input must have a name`)
        }
      }
    } else if (node.type === 'llm') {
      if (typeof data.prompt !== 'string') {
        errors.push(`llm node ${node.id} prompt must be a string`)
      }
    } else if (node.type === 'end') {
      if (!Array.isArray(data.outputs)) {
        errors.push(`end node ${node.id} outputs must be an array`)
        continue
      }
      for (const item of data.outputs) {
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

/** 取错误文案（用于 run_failed.message）。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

**完整文件路径：`apps/api-ts/src/engine/engine.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { EngineService } from './engine.service'
import { RunController } from './run.controller'

/** 执行引擎模块（阶段 4）。`PrismaService` 由全局 PrismaModule 提供。 */
@Module({
  imports: [AuthModule],
  controllers: [RunController],
  providers: [EngineService],
})
export class EngineModule {}
```

`app.module.ts` 的 `imports` 追加 `EngineModule`。

> **面试考点 · 为什么用 LangGraph，而不是手写 BFS / DFS？**
> 阶段 4 的线性图确实用 30 行 BFS 就够。但接下来马上要：
>
> - 阶段 6：`llm` 节点后面接**条件边 + 回边**（ReAct 循环）；
> - 阶段 8：`condition` 按 `sourceHandle` 分派、`aggregator` 汇合多条分支；
> - 阶段 9：会话历史与 checkpoint；
> - 阶段 11：事件重放与中断恢复。
>
> LangGraph 已经把这些抽象成 `addConditionalEdges` / 环 / 状态 reducer / checkpoint。手写遍历每加一种能力都要改核心循环，最终会写成一个“残缺的 LangGraph”。
> **选型看的是接下来的路线图，不是当前这一行代码。**

> **面试考点 · 动态按 id 建图，TypeScript 泛型为什么搞不定？**
> `StateGraph` 的泛型参数随 `addNode` 的累积而增长（不可变构建器）。节点 id 来自运行时 JSON，编译期无法枚举，所以类型只能是 `unknown` 的无限展开。
> 这里的处理：内部用 `as unknown as DynamicStateGraph` 收窄到**实际用到的方法**，并自己写好参数/返回类型。
> 代价是失去 LangGraph 的完整类型推导；收益是动态图能通过编译且核心调用有类型保护。**断言集中在一处，并写清楚为什么。**

> **面试考点 · `recursionLimit` 是什么？**
> LangGraph 限制一次 `invoke` 的 superstep 数量（默认 25），防止环无限执行。每次节点执行算一步，条件边/环会持续消耗。
> 这里按 `nodes.length * 3 + 20` 放宽：节点越多，正常执行需要的步数越多。阶段 6 引入工具环后还要按工具轮次再放宽。
> **没有这个上限，用户画一个环就能把进程跑死。**

> **面试考点 · 不可达节点会执行吗？**
> 不会。LangGraph 从 `START` 出发，只执行能沿边到达的节点。
> 所以“图里有 5 个节点”不等于“运行了 5 个节点”。前端如果显示“全部完成”，必须依据 `node_finished` 事件，而不是节点总数。
> 这也是为什么事件流里必须有 `node_started` / `node_finished`——**它是唯一的执行事实来源。**

---

## 6. 验证

准备一张最小图（`start → llm → end`）：

```text
start.data.inputs   = [{ name: 'topic', type: 'string', required: true }]
llm.data.prompt     = '介绍一下 {{ inputs.topic }}'
end.data.outputs    = [{ name: 'result', value: '{{ llm1.text }}' }]
```

在画布上连好后保存、发布，然后：

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json)
$token = $login.accessToken
```

```powershell
# 1. 正常运行
curl.exe -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"LangGraph\"}}"
```

预期事件顺序：

```text
run_started
node_started(start)
node_finished(start)      output: {"inputs":{"topic":"LangGraph"}}
node_started(llm)
token                     text: "Echo: 介绍一下 LangGraph"
node_finished(llm)        output: {"text":"Echo: 介绍一下 LangGraph","model":"stub"}
node_started(end)
node_finished(end)        output: {"outputs":{"result":"Echo: 介绍一下 LangGraph"}}
run_finished              outputs: {"result":"Echo: 介绍一下 LangGraph"}
```

```powershell
# 2. 缺必填输入 → start 节点失败
curl.exe -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" -d "{\"inputs\":{}}"
```

预期：

```text
event: run_started

event: node_started
data: {"nodeId":"s","nodeType":"start"}

event: run_failed
data: {"runId":"...","nodeId":"s","message":"missing required input: topic"}

```

注意：**没有 `node_finished(start)`**——失败节点不会发完成事件。

```powershell
# 3. 模板引用了不存在的变量 → llm 节点失败
```

把 `llm.data.prompt` 改成 `{{ inputs.nope }}` 后重新保存，再运行：

```text
event: node_started
data: {"nodeId":"llm1","nodeType":"llm"}

event: run_failed
data: {"runId":"...","nodeId":"llm1","message":"template variable not found: inputs.nope"}
```

```powershell
# 4. 从未保存草稿 → 普通 JSON 400（不是流）
curl.exe -i -X POST "http://localhost:3001/apps/<NEW_APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" -d "{\"inputs\":{}}"
```

预期：

```text
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"statusCode":400,"message":"Graph is empty","error":"Bad Request"}
```

```powershell
# 5. 两套后端同一份图、同一份输入，事件序列应完全一致
curl.exe -N -X POST "http://localhost:8000/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"LangGraph\"}}"
```

去掉 `runId` / `elapsedMs` 后，两边应逐行相同。

---

## 7. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 为什么用 LangGraph | 条件边/环/状态合并/checkpoint 都在路线图上，手写遍历会演化成残缺框架 |
| `Annotation` reducer 为什么合并 | 节点只回写自己那一片，覆盖会丢掉 `inputs` 与之前节点的输出 |
| 节点函数是纯的吗 | 状态变换是纯的；副作用（事件、DB）走闭包通道，状态保持可序列化 |
| 模板为什么不用 `eval` | 安全、跨语言一致、错误文案可控 |
| 缺变量为什么抛错 | 空串会静默产出错误结果；错误要能被 `run_failed` 精确定位 |
| 字符串化规则 | 字符串原样，其余紧凑 JSON；Python 需 `ensure_ascii=False` |
| 事件为什么在包装层发 | 保证 `started` 必发、`finished` 只在成功时发，异常时成对关系不破坏 |
| 多个 `end` | 最后执行完的胜出；要合并就用一个 end 或 aggregator |
| 不可达节点 | 不执行；执行事实只认 `node_started` / `node_finished` |
| `recursionLimit` | 防止环导致无限执行；按节点数/工具轮次放宽 |

---

## 8. 下一步

- `03-NestJS引擎.md`：`RunController` 与 `EngineService` 的接线、预检顺序、`RunEventQueue` 消费与错误分层。
- `04-Python引擎.md`：同一套语义的 FastAPI + LangGraph 实现，跨语言数值/字符串对齐。
- `05-前端流式面板.md`：读取 SSE、切帧、Zod 校验、token 增量渲染。
