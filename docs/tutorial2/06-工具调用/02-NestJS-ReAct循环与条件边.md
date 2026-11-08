# 02 · NestJS ReAct 循环与条件边（工具调用）

> 阶段 6 · 第 2 步
>
> 做完：`llm.data.tools` 非空时，`llm` 节点变成 ReAct 循环——模型可以「想 → 调工具 → 看结果 → 再想」，直到不再调用工具才输出最终文本；过程产生 `tool_call` / `tool_result` 事件；未知工具在预检阶段 400；轮次有硬上限。
>
> **本篇面试考点**：ReAct 的本质 · 为什么用「条件边 + 环」而不是 `while` · 流式 `tool_calls` 分片怎么聚合 · 为什么必须回填 assistant 消息 · `ToolMessage` 的 `tool_call_id` 为什么不能错 · 并行工具调用的顺序 · `node_started` / `node_finished` 为什么只在首末轮发 · 轮次上限防的是什么 · 未知工具为什么必须预检 · 参数宽松解析与事件顺序 · `recursionLimit` 怎么算。

---

## 1. ReAct 是什么

ReAct = **Reason + Act**。模型不是一次生成答案，而是循环：

```text
Thought（这一轮生成文本 / 决定调工具）
  → Action（tool_calls）
  → Observation（tool_result）
  → Thought（基于结果继续）
  → ... 直到不再调用工具，输出最终答案
```

在消息层面，一次完整的「调一次工具」是四条消息：

```text
system    你是...
user      2+3*4 等于多少？
assistant (content: "", tool_calls: [{ id, name: "calculator", args: { expression: "2+3*4" } }])
tool      (tool_call_id: <上一条的 id>, content: "14")
assistant 最终回答
```

关键点：**工具结果不是“注入到 prompt 里的一段文本”，而是一条 `tool` 角色的消息，必须通过 `tool_call_id` 与那条 assistant 消息配对。**

> **面试考点 · 为什么不用「把工具结果拼进 prompt 再问一次」？**
> 那是“手写 ReAct”，能跑但会丢结构：
>
> - 模型不知道自己**调用过什么**（没有 `tool_calls` 记录）；
> - 无法并行调用多个工具；
> - 无法区分“工具返回的内容”和“用户说的话”（提示注入风险更高）；
> - 与 provider 的原生 function calling 不兼容。
>
> 用原生消息结构，模型能精确看到“我调了 `calculator`，参数是 X，结果是 Y”。**结构化的历史，比拼接的文本更可靠。**

---

## 2. 事件协议增量

**完整文件路径：`packages/contract/sse-events.md`** §3.1

两个新事件，都在 `llm` 节点作用域内：

```text
event: tool_call
data: {"nodeId":"llm1","toolName":"calculator","args":{"expression":"2+3*4"},"round":1}

event: tool_result
data: {"nodeId":"llm1","toolName":"calculator","result":"14","elapsedMs":3,"round":1}
```

| 字段 | 说明 |
| --- | --- |
| `nodeId` | 发起工具调用的 `llm` 节点 id（不是工具节点） |
| `toolName` | 工具名 |
| `args` | **解析后的对象**；参数非法时为 `{}`（随后 `run_failed`） |
| `result` | 工具返回值，**一律字符串** |
| `elapsedMs` | 工具执行耗时（毫秒） |
| `round` | 工具轮次，从 1 开始 |

事件顺序（一个 `llm` 节点启用工具后）：

```text
node_started(llm1)
  token(llm1) ...              ← 每一轮模型的文本增量（可能为空）
  tool_call  × N               ← 同一轮的 N 个并行调用
  tool_result × N
  token(llm1) ...              ← 下一轮
  ...
node_finished(llm1, {text, model, usage?})
```

注意：

1. `node_started` 只在**第一轮之前**发一次；
2. `node_finished` 只在**最后一轮（不再调工具）之后**发一次；
3. 中间的每一轮都**不发** `node_started` / `node_finished`。

> **面试考点 · 为什么中间轮次不发节点事件？**
> 事件协议里 `node_started` 的语义是“这个节点开始执行”，`node_finished` 是“这个节点执行完成并产出输出”。
> ReAct 的多轮是**节点内部的循环**，对外仍是一个节点的一次执行：
>
> - 如果每轮都发 `node_finished`，前端会把中间结果当成最终输出（日志会显示 5 个 `llm1` 完成）；
> - `run_finished.outputs` 只能有一个 `llm1` 的值，中间轮次没有合法输出；
> - 两套后端的轮次划分可能不同（模型行为差异），事件数就不可比了。
>
> **事件的粒度是“节点执行”，不是“内部循环次数”。** 循环细节用 `tool_call.round` 表达。

---

## 3. 状态：三份按节点隔离的切片

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（阶段 6 版本）

```ts
const RunState = Annotation.Root({
  /** 变量池：键为节点 id / `inputs`；合并 reducer */
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  /** 启用了工具的 llm 节点：**该节点自己的**消息数组（多轮共享，键为节点 id） */
  messages: Annotation<Record<string, BaseMessage[]>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  /** 已执行的工具轮次数（键为节点 id，从 1 开始计） */
  rounds: Annotation<Record<string, number>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  /** 上一轮 LLM 产出、尚未执行的工具调用（条件边的路由依据） */
  toolCalls: Annotation<Record<string, ToolCallRequest[]>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
})
```

为什么三份都是 `Record<nodeId, ...>` 而不是全局单值：

- 一张图里可以有**多个**启用工具的 `llm` 节点；
- 每个节点的消息历史、轮次数、待执行调用**互不相干**；
- 用节点 id 做键，然后用同一个“合并”reducer，新增节点无需改状态定义。

> **面试考点 · 为什么不用一个 `Record<nodeId, {messages, rounds, toolCalls}>`？**
> 可以，但更新会变麻烦：LangGraph 的 reducer 是**按 key 合并**的，拆成三个切片后，每个节点的动作只需返回自己那一小块（`{ rounds: { llm1: 2 } }`），不会意外覆盖别的字段。
> 如果合成一个大对象，每次返回都要小心“我有没有把 messages 弄丢”。
> **状态切片的粒度，应该与“谁会独立更新它”对齐。**

---

## 4. 一轮带工具的 LLM 调用

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`**（阶段 6 版本，节选）

```ts
/** 一次 LLM 调用请求的工具调用（参数为原始 JSON 文本，解析推迟到执行工具时）。 */
export interface ToolCallRequest {
  id: string
  name: string
  argsText: string
}

/** 一轮 LLM 调用（可能带工具）的结果。 */
export interface LlmStepResult {
  text: string
  model: string
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  toolCalls: ToolCallRequest[]
  /** 本轮 assistant 消息（含 `tool_calls`），必须回填到消息数组以维持对话历史。 */
  assistantMessage: AIMessage
}
```

```ts
export async function runLlmStep(
  data: LlmNodeData,
  messages: BaseMessage[],
  emitToken: (text: string) => void,
): Promise<LlmStepResult> {
  // ...创建 client（同阶段 5）

  // 1. 解析工具定义；只有非空时才 bindTools
  const toolDefs = resolveToolDefs(data.tools)
  const runnable = toolDefs.length > 0 ? client.bindTools(toolDefs) : client

  let text = ''
  let usage: LlmStepResult['usage']
  // 2. 流式工具调用分片：按 `index` 聚合 id / name / 参数文本
  const partial = new Map<number, { id: string; name: string; argsText: string }>()

  try {
    for await (const chunk of await runnable.stream(messages)) {
      const piece = stringifyContent(chunk.content)
      if (piece !== '') {
        text += piece
        emitToken(piece)
      }
      // 3. 聚合 tool_call_chunks
      for (const toolCallChunk of chunk.tool_call_chunks ?? []) {
        const index = typeof toolCallChunk.index === 'number' ? toolCallChunk.index : 0
        const current = partial.get(index) ?? { id: '', name: '', argsText: '' }
        if (typeof toolCallChunk.id === 'string' && toolCallChunk.id !== '') {
          current.id = toolCallChunk.id
        }
        if (typeof toolCallChunk.name === 'string' && toolCallChunk.name !== '') {
          current.name = current.name + toolCallChunk.name
        }
        if (typeof toolCallChunk.args === 'string') {
          current.argsText += toolCallChunk.args
        }
        partial.set(index, current)
      }
      // ...usage
    }
  } catch (error) {
    throw new RunError(mapLlmError(error))
  }

  // 4. 按 index 排序，生成稳定的调用数组
  const toolCalls: ToolCallRequest[] = [...partial.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, value], position) => ({
      // provider 偶尔不给 id：用 index + 位置兜底，保证 tool_call_id 非空
      id: value.id !== '' ? value.id : `call_${index}_${position}`,
      name: value.name,
      argsText: value.argsText,
    }))

  // 5. 回填 assistant 消息（含 tool_calls）
  const assistantMessage = new AIMessage({
    content: text,
    tool_calls: toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      args: parseArgsLeniently(call.argsText),
    })),
  })

  return { text, model, usage, toolCalls, assistantMessage }
}
```

### 4.1 为什么按 `index` 聚合

流式工具调用长这样（OpenAI 协议）：

```text
chunk1: choices[0].delta.tool_calls = [{ index: 0, id: "call_abc", function: { name: "calculator", arguments: "" } }]
chunk2: choices[0].delta.tool_calls = [{ index: 0, function: { arguments: "{\"expr" } }]
chunk3: choices[0].delta.tool_calls = [{ index: 0, function: { arguments: "ession\":\"2+3*4\"}" } }]
```

- `id` 只在第一片出现；
- `name` 可能被拆成多片（跨片拼接）；
- `arguments` 一定是**逐片拼接的 JSON 文本**。

所以必须按 `index` 归组、逐字段拼接，最后才得到完整调用。**不能假设“一个 chunk = 一个完整 tool_call”。**

> **面试考点 · 参数为什么要保留 `argsText`，而不是边流边 `JSON.parse`？**
> 因为流式分片里绝大多数时刻**不是合法 JSON**（`{"expr` 解析必然失败）。
> 正确做法：流式阶段只做字符串拼接；拿到完整文本后，**在执行工具前**解析一次。
> 这也解释了 `ToolCallRequest.argsText: string` 这个字段——它刻意保留“原始文本”，把解析职责交给执行阶段（这样参数非法时，事件顺序仍是 `tool_call` → `run_failed`）。

> **面试考点 · 为什么必须把 `assistantMessage` 回填？**
> 工具结果消息（`ToolMessage`）必须“回答”某条 assistant 的 `tool_calls`。如果历史里只有 `tool` 消息、没有对应的 assistant 消息，provider 会直接报错：
>
> ```text
> messages with role 'tool' must be a response to a preceding message with 'tool_calls'
> ```
>
> 更本质的原因：模型下一轮要看到“我上一轮调了什么、参数是什么”。缺了这条，它会重复调用同一个工具——**因为历史里没有“已经调过”的证据**。

> **面试考点 · `parseArgsLeniently` 为什么返回 `{}` 而不是直接抛错？**
> 为了让事件顺序稳定：
>
> ```text
> tool_call(args={})  →  run_failed(tool calculator failed: invalid arguments)
> ```
>
> 如果这里直接抛，错误发生在“发 `tool_call` 之前”，客户端只看到 `run_failed`，不知道模型想调什么。
> 宽松解析 + 执行阶段严格校验，能保留“意图”这条信息。**解析失败也是数据，不要提前丢掉。**

```ts
/** 宽松解析工具参数：非法 JSON 或非对象时返回 `{}`。 */
export function parseArgsLeniently(argsText: string): Record<string, unknown> {
  const trimmed = argsText.trim()
  if (trimmed === '') {
    return {}
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 交给工具执行阶段报 `invalid arguments`
  }
  return {}
}
```

---

## 5. 编译图：条件边 + 环

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`runGraph` 节选）

```ts
const maxRounds = maxToolRounds()
// 启用了工具的 llm 节点：这些节点改成「条件边 + 环」
const toolNodes = graph.nodes.filter((node) => node.type === 'llm' && toolNamesOf(node).length > 0)

const builder = new StateGraph(RunState) as unknown as DynamicStateGraph

// 1. 每个业务节点照旧
for (const node of graph.nodes) {
  builder.addNode(node.id, this.makeNodeAction(node, context, toolNodes))
}
// 2. 每个「带工具的 llm 节点」额外挂一个内部工具节点
for (const node of toolNodes) {
  builder.addNode(`${node.id}__tools`, this.makeToolsAction(node, context, maxRounds))
}
// 3. 连普通边，但跳过两类 source：
//    - 带工具的 llm 节点（改由条件边分派）
//    - condition 节点（阶段 8，按 sourceHandle 分派）
for (const edge of graph.edges) {
  if (toolNodes.some((node) => node.id === edge.source)) {
    continue
  }
  if (conditionNodes.some((node) => node.id === edge.source)) {
    continue
  }
  builder.addEdge(edge.source, edge.target)
}
// 4. 条件边 + 回环
for (const node of toolNodes) {
  const downstream = firstDownstream(graph, node)
  builder.addConditionalEdges(
    node.id,
    (state: RunStateValue) => ((state.toolCalls[node.id] ?? []).length > 0 ? 'tools' : 'continue'),
    { tools: `${node.id}__tools`, continue: downstream },
  )
  builder.addEdge(`${node.id}__tools`, node.id)   // ← 环
}
```

编译后的形状：

```text
        ┌──────────────────────────────┐
        │                              │
        ▼                              │
 [llm1] ──有 tool_calls──▶ [llm1__tools]
   │
   └──无 tool_calls──▶ [end1]
```

对照 ReAct：

| 图元素 | ReAct 阶段 |
| --- | --- |
| `llm1` 节点 | Thought（生成 + 决定是否 Action） |
| 条件边 | 判断“要不要 Act” |
| `llm1__tools` | Action + Observation（执行 + 结果回填） |
| 回环边 | 回到 Thought |

> **面试考点 · 为什么用图的条件边 + 环，而不是在 `llm` 节点里写 `while (true)`？**
> 三个理由：
>
> 1. **可观测**：每个节点是一次独立的图节点执行，LangGraph 能给出步进信息；`while` 循环是一个黑盒长任务；
> 2. **状态一致**：消息历史、轮次、待执行调用都由图状态承载，而不是节点内的局部变量——与 Python 侧的结构完全对应；
> 3. **可中断/可限流**：图有 `recursionLimit` 和天然的“步进边界”，将来做取消、审批（Human-in-the-loop）时可以卡在边上。
>
> 代价：图会多出一个内部节点 `<id>__tools`，且必须处理“普通出边与条件边冲突”（所以第 3 步要跳过其普通出边）。

> **面试考点 · 为什么第 3 步必须跳过 `llm` 的普通出边？**
> LangGraph 的语义：**一个节点要么走普通边，要么走条件边**。同时加会导致：
>
> - 同一个 superstep 里两个分支都被调度，工具节点和下游节点**并行执行**；
> - 下游节点拿不到工具结果就开始跑（`end` 会渲染空值）；
> - 事件顺序变成“交错”，两端无法对齐。
>
> 这是个很容易漏的细节：**改成条件边之后，原来的普通边必须删除**，而不是共存。

### 5.1 `firstDownstream` 的取舍

```ts
/** 取该节点在图中第一条普通出边的目标（多条时取第一条）。 */
function firstDownstream(graph: Graph, node: GraphNode): string {
  const edge = graph.edges.find((candidate) => candidate.source === node.id)
  return edge === undefined ? END : edge.target
}
```

当前实现：启用工具的 `llm` 节点**只支持一条出边**（多条时取第一条）。

为什么可以接受：

- 想分支就应该用 `condition` 节点（阶段 8），而不是给 `llm` 接多条边；
- 取第一条的行为是确定的（按 `edges` 数组顺序），两端可复现；
- 真正需要多分支时，图校验应该直接拦掉，而不是“悄悄取第一条”。

> 这是一个**已知限制**，不是“正确设计”。面试时应当主动说明：**“我这里为了简化取了第一条，正确做法是在图校验里禁止带工具的 llm 节点有多条出边。”**
> 能指出自己代码的边界，比假装它没有边界更有说服力。

### 5.2 `recursionLimit`

```ts
await builder.compile().invoke(
  { pool: { inputs }, messages: {}, rounds: {}, toolCalls: {}, branches: {} },
  { recursionLimit: Math.max(25, maxRounds * 2 + graph.nodes.length * 3 + 20) },
)
```

LangGraph 默认 `recursionLimit: 25`（superstep 数）。一次工具轮次占 **2 个 superstep**（`llm` + `tools`），所以：

```text
maxRounds(5) * 2 = 10
+ 节点数 * 3（普通节点 + 迭代内部循环余量）
+ 20（安全余量）
```

必须显式抬高，否则会出现：

```text
GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition
```

但**不能无上限**：`recursionLimit` 是“图级别的死循环保险”，`MAX_TOOL_ROUNDS` 是“业务级别的轮次限制”。两层都要有——前者防图结构错误，后者防模型无限调工具烧钱。

---

## 6. LLM 节点动作（Thought）

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（节选）

```ts
private makeLlmWithToolsAction(
  node: GraphNode,
  context: RunContext,
): (state: RunStateValue) => Promise<Partial<RunStateValue>> {
  return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
    const nodeId = node.id
    try {
      // 首轮：该节点还没有消息数组 → 发 node_started，构造 system/user
      const firstRound = state.messages[nodeId] === undefined
      if (firstRound) {
        context.queue.emit(nodeStarted(nodeId, 'llm'))
      }
      const history = firstRound
        ? buildInitialMessages(node, state.pool)
        : (state.messages[nodeId] as BaseMessage[])

      const step = await runLlmStep(
        node.data as unknown as LlmNodeData,
        history,
        (text) => context.queue.emit(token(nodeId, text)),
      )

      // assistant 消息（含 tool_calls）必须进入历史
      const messages = [...history, step.assistantMessage]

      // 有工具调用：只更新状态，交给条件边
      if (step.toolCalls.length > 0) {
        return {
          messages: { [nodeId]: messages },
          toolCalls: { [nodeId]: step.toolCalls },
        }
      }

      // 没有工具调用：这是最后一轮，发 node_finished 并写回变量池
      const output: Record<string, unknown> = { text: step.text, model: step.model }
      if (step.usage !== undefined) {
        output.usage = step.usage
      }
      context.queue.emit(nodeFinished(nodeId, 'llm', output))
      return {
        messages: { [nodeId]: messages },
        toolCalls: { [nodeId]: [] },
        pool: { [nodeId]: output },
      }
    } catch (error) {
      context.failedNodeId = nodeId
      throw error
    }
  }
}
```

`state.messages[nodeId] === undefined` 作为“首轮”的判据：

- 初始状态 `messages: {}`，第一次进这个节点必然 undefined；
- 工具节点执行后会写入 `messages[nodeId]`，再回到 `llm` 时就有了；
- **不要用 `rounds` 判断**：`rounds` 在工具节点里自增，第一轮 LLM 时它是 0/undefined，语义容易绕。

> **面试考点 · `usage` 只取最后一轮，合理吗？**
> 不严谨，但符合契约：`node_finished.output.usage` 描述的是“这次节点执行”的用量，而一次 ReAct 有 N 次 LLM 调用，真正的总用量应该是**各轮之和**。
> 当前实现取“最后一次调用的 usage”（后写覆盖先写），会**低估**总 token。
> 正确做法：在 `context` 里累加每轮 usage，最后输出总和。这是一个**已知简化**——面试时如果被问“你怎么统计多轮工具调用的 token”，应该承认这点并给出累加方案。

---

## 7. 工具节点动作（Act + Observation）

```ts
private makeToolsAction(
  node: GraphNode,
  context: RunContext,
  maxRounds: number,
): (state: RunStateValue) => Promise<Partial<RunStateValue>> {
  return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
    const nodeId = node.id
    const round = (state.rounds[nodeId] ?? 0) + 1
    try {
      // 1. 轮次上限：第一层保护（业务级）
      if (round > maxRounds) {
        throw new RunError(`tool call rounds exceeded: ${maxRounds}`)
      }
      let messages = state.messages[nodeId] ?? []
      // 2. 逐个执行本轮调用（同一轮的多个调用是「并行产生、串行执行」）
      for (const call of state.toolCalls[nodeId] ?? []) {
        const startedAt = Date.now()
        let args: Record<string, unknown>
        try {
          args = parseArgsOrFail(call)
        } catch (error) {
          // 参数非法：仍先发 tool_call（args 为 {}），保留模型意图
          context.queue.emit(toolCall(nodeId, call.name, {}, round))
          throw error
        }
        context.queue.emit(toolCall(nodeId, call.name, args, round))
        const result = await executeToolOrFail(call.name, args)
        context.queue.emit(toolResult(nodeId, call.name, result, Date.now() - startedAt, round))
        // 3. 工具结果作为 ToolMessage 追加，tool_call_id 必须与请求一致
        messages = [
          ...messages,
          new ToolMessage({ content: result, tool_call_id: call.id, name: call.name }),
        ]
      }
      // 4. 清空待执行调用，轮次 +1；条件边会把控制权交回 llm
      return {
        messages: { [nodeId]: messages },
        toolCalls: { [nodeId]: [] },
        rounds: { [nodeId]: round },
      }
    } catch (error) {
      context.failedNodeId = nodeId
      throw error
    }
  }
}
```

### 7.1 失败即终止

任一工具失败 → 抛 `RunError` → 整张图终止 → `run_failed`。

为什么不做“把错误当成工具结果喂回模型”？

- 模型可能会把错误文本当成正常结果继续编（“工具说 42”）；
- 失败重试是编排层策略，不是节点行为（与阶段 5 的 429 同理）；
- 契约已经把工具失败定义为**运行失败**（`tool {name} failed: {reason}`）。

> **面试考点 · 并行工具调用为什么是“串行执行”？**
> 模型可以在一轮里请求多个工具（`tool_calls: [A, B]`）。当前实现按数组顺序**依次**执行。
> 取舍：
>
> - 串行：事件顺序确定、两端一致、结果可复现；但总耗时是各工具之和；
> - 并行（`Promise.all`）：快，但事件交错顺序不确定，且某个失败时其它仍在跑。
>
> 我们的首要目标是**两端逐字节可比**，所以选串行。若将来要并行，需要定义“事件按调用顺序缓冲、全部完成后按序发出”的规则。

### 7.2 参数与执行的两层校验

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（文件底部辅助函数）

```ts
/** 严格解析参数：非 JSON / 非对象 → 规范文案。 */
function parseArgsOrFail(call: ToolCallRequest): Record<string, unknown> {
  const trimmed = call.argsText.trim()
  if (trimmed === '') {
    return {}
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (isPlainObject(parsed)) {
      return parsed
    }
  } catch {
    // 落到下面的统一失败
  }
  throw new RunError(`tool ${call.name} failed: invalid arguments`)
}

/** 执行工具，把内部失败归一为 `tool {name} failed: {reason}`。 */
async function executeToolOrFail(name: string, args: Record<string, unknown>): Promise<string> {
  if (!hasTool(name)) {
    throw new RunError(`tool ${name} failed: error`)
  }
  try {
    return await executeTool(name, args)
  } catch (error) {
    const reason = error instanceof ToolError ? error.reason : 'error'
    throw new RunError(`tool ${name} failed: ${reason}`)
  }
}
```

三层防线：

| 层 | 位置 | 作用 |
| --- | --- | --- |
| 预检 | `validateNodeData` | 图里的**工具名**必须已注册 → 400 |
| 参数 | `parseArgsOrFail` | 模型给的 JSON 必须可解析为对象 → `invalid arguments` |
| 执行 | 工具内部 | 参数类型/业务约束（如 URL 协议）→ 具体 reason |

> **面试考点 · 为什么工具名既预检又运行时再查一次？**
> 预检拦的是**图配置错误**（作者写了一个不存在的工具名），应该在保存/运行前就 400，而不是等模型决定调用它才炸。
> 运行时再查，是防止“预检之后注册表被改动”（热更新、代码回滚）——属于**兜底**，不是主路径。
> 两层成本都很低，收益是“错误尽早、错误可控”。

---

## 8. 预检：未知工具

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`validateNodeData` 节选）

```ts
} else if (node.type === 'llm') {
  if (typeof data.prompt !== 'string') {
    errors.push(`llm node ${node.id} prompt must be a string`)
  }
  if (Array.isArray(data.tools)) {
    for (const name of data.tools) {
      if (typeof name !== 'string' || !hasTool(name)) {
        errors.push(`llm node ${node.id} references unknown tool: ${String(name)}`)
      }
    }
  }
}
```

规则（`error-messages.md` §6.1）：

```text
llm node {nodeId} references unknown tool: {name}
```

- 多个未知工具**按 `tools` 数组顺序各报一条**；
- 与节点数据校验的错误**合并**成同一条 `message`（`join('; ')`）；
- 发生在**打开 SSE 流之前**，所以是普通 JSON 400。

> **面试考点 · 为什么不能在运行时才报未知工具？**
> 因为“图里有不存在的工具名”是**配置错误**，不是运行期偶发：
>
> - 作者保存了错名字，应该立刻知道；
> - 等到模型恰好调用它才报错，可能几分钟后才暴露；
> - 客户端已经收到 `run_started` 和一堆 `token`，最后来一个 `run_failed`，体验很差。
>
> **能在预检阶段判定的事情，不要留到运行时。**

---

## 9. 验证（用 mock 驱动）

mock 的工具调用标记（`tools/mock-llm/server.mjs`）：

```text
[[call:<name>:<jsonArgs>]]
```

- user 消息里出现该标记，且请求带 `tools` → mock 返回 `tool_calls`；
- 消息里已有 `role: "tool"` 后 → mock 返回最终文本 `answer: <工具结果>`（截断 200 字符）；
- 一个标记 = 一次调用；同一批多个标记 = **一轮并行**；
- `[[next]]` 分隔多个批次 = **多轮**。

### 9.1 单工具单轮

节点 `prompt`：

```text
请计算 {{ inputs.expr }}，标记：[[call:calculator:{"expression":"2+3*4"}]]
```

`start` 声明 `expr`，运行输入 `expr=2+3*4`。

预期事件：

```text
event: node_started
data: {"nodeId":"llm1","nodeType":"llm"}

event: tool_call
data: {"nodeId":"llm1","toolName":"calculator","args":{"expression":"2+3*4"},"round":1}

event: tool_result
data: {"nodeId":"llm1","toolName":"calculator","result":"14","elapsedMs":2,"round":1}

event: token
data: {"nodeId":"llm1","text":"answer: 14"}

event: node_finished
data: {"nodeId":"llm1","nodeType":"llm","output":{"text":"answer: 14","model":"mock-model",...}}
```

### 9.2 并行调用

```text
[[call:calculator:{"expression":"1+1"}]][[call:get_current_time:{}]]
```

预期同一 `round` 下两条 `tool_call`，然后是两条 `tool_result`（顺序与调用一致）。

### 9.3 多轮

```text
[[call:calculator:{"expression":"1+1"}]] [[next]] [[call:calculator:{"expression":"2+2"}]]
```

预期：

```text
tool_call(round=1) → tool_result(round=1)
tool_call(round=2) → tool_result(round=2)
token → node_finished
```

### 9.4 轮次上限

```powershell
# .env 里设 MAX_TOOL_ROUNDS=1，重启后端
# 用 9.3 的两批标记
```

预期：

```text
tool_call(round=1) → tool_result(round=1)
event: run_failed
data: {"nodeId":"llm1","message":"tool call rounds exceeded: 1"}
```

### 9.5 未知工具（预检 400）

```powershell
curl.exe -s -i -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d "{\"inputs\":{}}"
```

把节点 `data.tools` 改成 `["nope"]` 后保存，再运行。

预期：`HTTP/1.1 400`，**普通 JSON**（不是 SSE）：

```json
{"statusCode":400,"message":"llm node llm1 references unknown tool: nope","error":"Bad Request"}
```

### 9.6 参数非法

```text
[[call:calculator:{"foo":1}]]
```

预期：

```text
tool_call(args={})          ← 先发，保留意图
run_failed(tool calculator failed: invalid arguments)
```

### 9.7 工具内部失败

```text
[[call:calculator:{"expression":"1/0"}]]
```

预期：

```text
tool_call → run_failed(tool calculator failed: invalid arguments)
```

---

## 10. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| ReAct 消息结构 | assistant(`tool_calls`) + tool(`tool_call_id`) 成对出现 |
| 为什么条件边 + 环 | 可观测、状态一致、可中断；与 Python 图结构对应 |
| 普通出边冲突 | 必须删除，否则工具节点与下游并行 |
| 流式 tool_calls | 按 `index` 聚合；`args` 逐片拼接，完整后再解析 |
| 回填 assistant | 否则模型不知道调过什么，provider 也可能直接报错 |
| `tool_call_id` | 必须与请求一致，是 tool 消息的配对键 |
| 中间轮不发节点事件 | 事件粒度是节点执行，不是内部循环 |
| 轮次上限 | 防无限调用/烧钱；与 `recursionLimit` 两层保护 |
| 未知工具预检 | 配置错误尽早 400，不要留到运行时 |
| 参数宽松解析 | 先发 `tool_call` 保留意图，再 `run_failed` |
| 并行调用串行执行 | 事件顺序确定、两端一致；代价是耗时 |
| `usage` 多轮 | 当前只取最后一轮，会低估；应累加（已知简化） |

---

## 11. 下一步

- `03-Python工具与ReAct对齐.md`：同一注册表（`Literal` 版）、同一循环（`add_conditional_edges`）、事件逐字节对齐。
- `04-前端工具选择面板.md`：`GET /tools` + 勾选写入 `data.tools`。
- `05-验收.md`：单工具/并行/多轮/上限/未知工具/参数非法，两后端逐项对比。
