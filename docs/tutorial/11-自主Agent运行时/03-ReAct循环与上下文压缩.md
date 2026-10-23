# 03 · ReAct 循环与上下文压缩：自主 Agent 的「核心循环」与「裁上下文」

> 所属：阶段 11 · 自主 Agent 运行时
> 本篇覆盖：**ReAct 循环为什么从「节点里的能力」变成「整个运行的核心」**；`llm` 层内部那张小图怎么搭、`round` 到底数的是什么、`maxRounds` 的两道闸；**上下文压缩**为什么必须做、两种做法（LLM 摘要 vs 确定性截断）如何取舍、本项目的两步规则与实测结果；以及**框架取舍**——总纲原本写的是「TS 用 LangGraph、Python 用 Pydantic AI」，为什么最终两侧都用 LangGraph。
> **本篇首次教学**：`ReAct` 作为运行核心（层内子图）与阶段 6 的差别；`round` / `rounds` 的语义（工具执行轮次，从 1 开始）；`agent rounds exceeded` 与「语义闸 + `recursionLimit` 结构闸」；Agent 事件粒度（token 逐片、`tool_*` 每次调用一对、`layer_*` 每层一对）；**上下文压缩（context compaction）** 的问题与两条实现路线；**确定性截断**的两步规则与两个保护；「压缩 → 窗口」的顺序耦合；把「可复现」当作架构约束；**框架取舍的判断标准**（显式循环 vs 框架自带 Agent）。
> **不重讲**：`StateGraph` / `Annotation` / reducer / `compile`-`invoke` 见 `04-执行引擎/02-LangGraph编译图-TS.md` 与 `04-执行引擎/04-LangGraph与引擎-Python.md`；条件边、环、跳过普通边的陷阱、superstep、`recursionLimit`、`ToolMessage`、`bindTools` / `bind_tools`、工具注册表与 `ToolError` 见 `06-工具调用/02-NestJS-ReAct循环与条件边.md`、`06-工具调用/03-Python工具与ReAct对齐.md`；token 分片、`run_failed` 双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`05-LLM节点/03-LLM错误映射.md`；mock LLM 的 `[[call:...]]` / `[[next]]` 语法见 `05-LLM节点/04-mock-LLM与无密钥自测.md`；阶段 9 的 `MAX_HISTORY_MESSAGES` 窗口裁剪见 `09-会话与记忆/02-历史加载与上下文注入-NestJS.md`；checkpointer 与业务表的分工见 `09-会话与记忆/03-checkpointer与自建消息表.md`。
> 下文所有「文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`；项目文件代码块上方标注**绝对路径**。

---

## 0. 先给结论

三句话：

1. **阶段 6 的 ReAct 是「一个节点会调工具」，阶段 11 的 ReAct 是「整个运行就是一个会调工具的循环」。** 技术没换（`StateGraph` + 条件边 + 环），换的是**所有权**：循环图从「工作流引擎的整张图」搬进了「`llm` 层内部的一张私有小图」。
2. **上下文压缩不是「优化」，是「必须做的资源管理」。** 历史消息 + 工具结果会把上下文撑爆；本项目选**确定性截断**，不是因为它更好，而是因为「同一契约、双实现、逐字节一致」这条最高约定要求它**可复现、零成本、两端可对齐**。代价是**只保留「有多少条被省略」这一条信息**。
3. **没有用 Pydantic AI，是一次有意识的取舍。** 总纲 §3.10 原本规划「TS 用 LangGraph、Python 用 Pydantic AI」（刻意例外），但 Pydantic AI 有自己的事件模型和「工具参数校验失败就回喂模型重试」的默认语义，会与我们的**事件契约**和**错误契约**正面冲突。在「契约优先」的项目里，**显式循环的可控性 > 框架的省代码**。我们**如实记账**：失去了框架对照价值与 dify-agent 源码对齐。

---

## 1. 本篇目标

读完本篇，你应该能：

1. 用一张表说清「阶段 6 的 ReAct」与「阶段 11 的 ReAct」在**位置、状态范围、事件、上限**四处的差别。
2. 独立画出 `llm ↔ tools` 这张小图，并说清 `messages` / `rounds` / `toolCalls` 三个状态槽各自由谁写、给谁看。
3. 准确解释 `round` 数的是**工具执行轮次**（从 1 开始），并说明「第 1 次模型调用不属于任何一轮」。
4. 说清 `maxRounds` 的**三个来源**与**两道闸**（语义闸 `agent rounds exceeded` + 结构闸 `recursionLimit`），以及为什么 `recursionLimit` 必须随 `maxRounds` 计算。
5. 说清 Agent 事件的**三种粒度**：`token` 逐片、`tool_call` / `tool_result` 每次调用一对、`layer_started` / `layer_finished` 每层一对。
6. 解释上下文为什么会膨胀（跨请求的历史 + 单次运行内的工具结果），并说清本项目压缩只发生在**入口（`history` 层）**、不在循环中。
7. 逐条讲出确定性压缩的两步规则、三个默认值、两个保护（`min(keepRecent, len)` 与 `omitted > 0`），并能手算出「20 条 → 7 条 → 模型实收 8 条」。
8. 说清「LLM 摘要」与「确定性截断」的取舍，以及升级到摘要需要补的工程条件（异步、缓存、幂等、失败回退、契约变更）。
9. 逐条论证「为什么没用 Pydantic AI」，并能用判断标准为一个新项目选型。

**验收标准**

1. 不看笔记，能写出 `rounds` 从 0 开始、`round` 从 1 开始、超限检查发生在**执行第 `maxRounds + 1` 轮之前**，并解释「超限那一轮不会发出 `tool_call`」。
2. 能解释为什么固定 `recursionLimit = 25` 会让 `maxRounds = 20` 在约第 12 轮就被框架打断，且报错文案**不是**契约文案。
3. 能手工算出：13 条历史 + `compactionThreshold=12`、`keepRecent=6` → 7 条，marker 文案是 `[compacted] 7 earlier messages omitted`。
4. 能说出「`maxMessages=6` 且 `keepRecent=6` 时，压缩标记会被窗口裁掉」这一现象，并解释它为什么是**可达配置**（契约允许）。
5. 能对着 §5.5 的对照表，为一个「需要强类型结构化输出、单语言、事件不对外」的 Python 项目做出「选 Pydantic AI」的判断，并给出理由。

---

## 2. 前置条件

- 阶段 4~8 已完成：你知道 LangGraph 把图编译成 `StateGraph`，用 `invoke()` / `ainvoke()` 跑完；知道条件边、环、superstep、`recursionLimit` 是什么。
- 阶段 9 已完成：你知道业务表 `messages` 与图状态 `messages` **同名不同义**；知道「先读历史、再写用户消息」的顺序语义。
- 阶段 10 已完成：你知道「事件先写库、再推订阅者」是断线重连不丢事件的前提；知道 SSE 帧里 `id:` 行与 `Last-Event-ID` 的用途。
- 读过本阶段的前序篇（`01`、`02`），知道 `composition.layers` 的五个层名与执行顺序；本篇默认你已经知道「Run 是异步受理 + 事件流可重放」这套骨架。
- 本地有 mock LLM（`node tools/mock-llm/server.mjs`），无需真实 API Key；数据库 `mini-dify-db` 容器健康。

---

## 3. ReAct 循环：从「节点里的能力」到「运行的核心」

> **ReAct**（Reasoning + Acting）= 让模型「先想一步、需要时调用工具、拿到结果再想一步」的循环范式。阶段 6 已首次教学，这里只留一句提醒：**模型只负责产出「要调用什么」，程序负责真正执行并把结果回填。**

### 3.1 阶段 6 与阶段 11：同一个机制，两种位置

| 维度 | 阶段 6（工作流 `llm` 节点） | 阶段 11（Agent `llm` 层） |
| --- | --- | --- |
| **循环在哪** | 整张工作流图里：`llm` 节点用条件边跳到 `tools`，再回到 `llm` | `llm` 层**自己编译的一张私有小图**：节点 `llm` ↔ `tools` |
| **谁触发** | 画布上的节点与连线（`edge.sourceHandle` 决定多出口） | 层配置 `composition.llm.config`（无画布、无连线） |
| **状态范围** | 整张图共享 `RunState`；`messages` **按节点 id 分桶**（`Record<nodeId, BaseMessage[]>`） | 循环图私有 `LlmLoopState`；跨层只共享一个**扁平** `messages` 数组 |
| **轮次上限** | `MAX_TOOL_ROUNDS`（默认 5） | `maxRounds`（默认 5，硬上限 20） |
| **超限文案** | `tool call rounds exceeded: {max}` | `agent rounds exceeded: {max}` |
| **过程事件** | `node_started` / `token` / `tool_call` / `tool_result` / `node_finished` | `layer_started` / `token` / `tool_call` / `tool_result` / `layer_finished` |
| **目的** | 让**一个节点**具备调用工具的能力 | 让**整个运行**就是一次 Agent 循环 |

一句话：**阶段 6 是「在一个节点里嵌入循环」，阶段 11 是「循环本身就是运行」。** 技术复用到了，但「谁拥有这个循环」变了——这也解释了为什么本篇的 `round`、上限、事件粒度都与阶段 6 不同（阶段 6 的轮次是「节点的」，这里的是「层的」）。

另外注意一个**刻意的文案差异**：阶段 6 是 `tool call rounds exceeded: 5`，阶段 11 是 `agent rounds exceeded: 5`。同一类失败、两套契约文案——因为它们属于**两个不同的接口**（`/apps/{id}/run` 与 `/agent/runs`），各自的错误表独立演进。

### 3.2 TS 侧：`runLlmLayer` 逐行拆解

> 文件：`d:\user\my_project\github\mini-dify\apps\api-ts\src\agent\layers\llm.layer.ts`

```ts
import { ToolMessage, type BaseMessage } from '@langchain/core/messages' // 工具结果的「消息化」载体；必须回填给模型，循环才能继续
import { Annotation, END, START, StateGraph } from '@langchain/langgraph' // 本层内部再编译一张小图：声明状态槽、入口/出口、条件边、环

import { runLlmStep, type ToolCallRequest } from '../../engine/nodes/llm.node' // 复用阶段 5/6 的「一轮模型调用」：真流式 + bindTools
import { executeTool } from '../../tools/registry' // 复用阶段 6 的工具注册表（超时 / 体积上限 / 安全限制都在里面）
import { ToolError } from '../../tools/tool-error' // 工具失败的固定分类（invalid arguments / timeout / ...）
import type { AgentEmit } from '../agent-events' // 发事件的同步回调：只入队，真正的写库由 runner 串行化
import { llmNodeDataOf, type AgentRunState } from '../agent-state' // 把跨层共享状态翻译成 runLlmStep 需要的 LlmNodeData

/** `maxRounds` 默认值与上限（见 agent-events.md §3.4）。 */
const DEFAULT_MAX_ROUNDS = 5 // 默认最多执行 5 轮工具
const MAX_ROUNDS_LIMIT = 20 // 硬上限：配置或环境变量超过它一律回退默认，防止「设 1000 轮」烧钱

/**
 * ReAct 循环的图状态：`messages` 是上下文，`rounds` 是已执行的工具轮数
 * （从 1 开始计），`toolCalls` 是上一轮 LLM 产出的待执行调用（条件边的路由依据）。
 */
const LlmLoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ // 送给模型的完整上下文（含 ToolMessage）
    reducer: (_previous: BaseMessage[], update: BaseMessage[]) => update, // 覆盖式 reducer：节点返回的数组就是新值
    default: () => [], // 初值空数组；实际 invoke 时会被显式赋值
  }),
  rounds: Annotation<number>({ // 已完成的工具轮数
    reducer: (_previous: number, update: number) => update, // 覆盖，不做累加（累加会让重入时翻倍）
    default: () => 0, // 从 0 开始：第 1 次模型调用不属于任何一轮
  }),
  toolCalls: Annotation<ToolCallRequest[]>({ // 上一轮模型产出的待执行调用
    reducer: (_previous: ToolCallRequest[], update: ToolCallRequest[]) => update, // 覆盖；条件边只看这个数组
    default: () => [],
  }),
}) // 循环图的「子状态」与跨层 AgentRunState 刻意分开：瞬时状态不外泄

type LlmLoopStateValue = { // 与图状态同形的普通类型，供回调参数标注使用
  messages: BaseMessage[]
  rounds: number
  toolCalls: ToolCallRequest[]
}

/**
 * `llm` 层：ReAct 循环（LangGraph `StateGraph` + 条件边 + 环，节点 `llm` 与 `tools`）。
 *
 * - 每轮逐 chunk 发 `token`；
 * - 有 `tool_calls` → 发 `tool_call` → 执行（复用 `executeTool`）→ 发 `tool_result`
 *   → 追加 `ToolMessage` → 回到 `llm`；
 * - `round` 超过 `maxRounds` → 抛 `agent rounds exceeded: {max}`。
 *
 * 取消在**工具轮边界**检查（每轮 LLM 调用前后、每个工具执行前），
 * 抛出后由执行器发唯一一帧 `run_cancelled`。
 */
export async function runLlmLayer(
  state: AgentRunState, // 跨层共享状态：读 state.messages / state.toolNames，写 state.llm 与 state.messages
  config: Record<string, unknown>, // 该层的 config（model / maxRounds / temperature）
  emit: AgentEmit, // 发事件（token / tool_call / tool_result）
): Promise<void> {
  const maxRounds = resolveMaxRounds(config.maxRounds) // 配置 → 环境变量 → 默认 5；非法值静默回落
  state.llm = { // 先把层配置写进共享状态
    model: typeof config.model === 'string' && config.model !== '' ? config.model : undefined, // 空串视为「未指定」，由 runLlmStep 回退 LLM_MODEL
    maxRounds, // 记下来，便于调试与后续层读取
    temperature: typeof config.temperature === 'number' ? config.temperature : undefined, // 仅接受 number，字符串不转换
  }

  const llmAction = async (loop: LlmLoopStateValue): Promise<Partial<LlmLoopStateValue>> => { // 节点 1：一轮模型推理
    await state.checkCancelled() // 调用前检查取消：模型请求可能很贵，先看要不要发
    const step = await runLlmStep(llmNodeDataOf(state), loop.messages, (text) => // 复用阶段 5/6：绑定工具、真流式
      emit('token', { text }), // 每个 provider chunk 立刻发一片 token（边收边发）
    )
    await state.checkCancelled() // 调用后再查一次：取消可能发生在模型流式期间
    return {
      messages: [...loop.messages, step.assistantMessage], // 把本轮 assistant 消息（含 tool_calls）追加进上下文
      toolCalls: step.toolCalls, // 交给条件边：有调用就去 tools，没有就结束
    }
  }

  const toolsAction = async (loop: LlmLoopStateValue): Promise<Partial<LlmLoopStateValue>> => { // 节点 2：执行工具
    await state.checkCancelled() // 每个工具轮开始前检查取消
    const round = loop.rounds + 1 // 本轮编号 = 已完成轮数 + 1（第一次进入就是 1）
    if (round > maxRounds) { // 语义闸：在执行第 maxRounds+1 轮之前就拒绝
      throw new Error(`agent rounds exceeded: ${maxRounds}`) // 文案进契约（error-messages.md §11），必须逐字节一致
    }
    let messages = loop.messages // 局部变量累积：一轮内多个工具调用会依次追加
    for (const call of loop.toolCalls) { // 同一轮可能有多个并行调用：逐个执行
      await state.checkCancelled() // 每个工具执行前检查取消：长工具期间的空窗只能靠这里缩短
      let args: Record<string, unknown>
      try {
        args = parseArgsOrFail(call) // 严格解析参数：非 JSON、非对象、数组都算失败
      } catch (error) {
        // 参数解析失败仍先发 `tool_call`（args 为 `{}`），保持事件顺序可读
        emit('tool_call', { toolName: call.name, args: {}, round }) // 先让前端看到「模型要调什么」，再让运行失败
        throw error // 抛给 runner → 唯一一帧 `run_failed`
      }
      emit('tool_call', { toolName: call.name, args, round }) // 参数已定，发 tool_call（带上轮次）
      const startedAt = Date.now() // 开始计时
      const result = await executeOrFail(call.name, args) // 执行工具；内部失败会归一为 `tool {name} failed: {reason}`
      emit('tool_result', { // 执行完成，发 tool_result
        toolName: call.name,
        result, // 字符串结果（工具契约规定返回 string）
        elapsedMs: Date.now() - startedAt, // 耗时（不参与逐字节比对）
        round, // 与 tool_call 的 round 对应
      })
      messages = [
        ...messages,
        new ToolMessage({ content: result, tool_call_id: call.id, name: call.name }), // OpenAI 协议要求 role=tool + tool_call_id 才能对上
      ]
    }
    return { messages, rounds: round, toolCalls: [] } // 轮数推进；清空待执行调用，条件边据此回到 llm
  }

  const graph = new StateGraph(LlmLoopState) // 用循环图自己的状态声明建图
    .addNode('llm', llmAction) // 节点 llm：模型推理 + 发 token
    .addNode('tools', toolsAction) // 节点 tools：执行工具 + 发 tool_call/tool_result
    .addEdge(START, 'llm') // 入口固定进 llm
    .addConditionalEdges( // 条件边：唯一的「分叉点」
      'llm',
      (loop: LlmLoopStateValue) => (loop.toolCalls.length > 0 ? 'tools' : 'done'), // 有调用就去 tools，否则结束
      { tools: 'tools', done: END }, // 路由表：字符串 → 目标节点 / END
    )
    .addEdge('tools', 'llm') // 回边：形成环（这就是 ReAct）
    .compile() // 编译成可执行图；不传 checkpointer

  const result = await graph.invoke( // 跑完整个循环（内部可能走很多个 superstep）
    { messages: state.messages, rounds: 0, toolCalls: [] }, // 只把「上下文」带进循环图；轮次与待执行调用从零开始
    { recursionLimit: Math.max(25, maxRounds * 2 + 10) }, // 结构闸：superstep 上限跟着 maxRounds 算（见 §3.5）
  )
  state.messages = result.messages // 只写回 messages：轮次/待执行调用是循环内部状态，不污染跨层状态
}

/** `maxRounds`：层配置优先，其次环境变量 `AGENT_MAX_ROUNDS`，最后默认 5。 */
function resolveMaxRounds(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ROUNDS_LIMIT) { // 合法整数直接采用
    return value
  }
  const fromEnv = Number(process.env.AGENT_MAX_ROUNDS ?? DEFAULT_MAX_ROUNDS) // 读环境变量；缺失则用默认值
  if (Number.isInteger(fromEnv) && fromEnv >= 1 && fromEnv <= MAX_ROUNDS_LIMIT) { // 环境变量也要过同一道范围检查
    return fromEnv
  }
  return DEFAULT_MAX_ROUNDS // 任何非法值都静默回落，不让运行因配置问题崩掉
}

/** 严格解析工具参数：非 JSON、非对象一律 `tool {name} failed: invalid arguments`。 */
function parseArgsOrFail(call: ToolCallRequest): Record<string, unknown> {
  const trimmed = call.argsText.trim() // 去掉空白；空串视为「无参数」
  if (trimmed === '') {
    return {} // 空参数是合法的：等价于空对象
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown // 解析 JSON
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) { // 只接受「非 null 的对象」，数组不行
      return parsed as Record<string, unknown>
    }
  } catch {
    // 落到下面的统一失败
  }
  throw new Error(`tool ${call.name} failed: invalid arguments`) // 固定 reason，两端逐字节一致
}

/** 执行工具并把内部失败归一为 `tool {name} failed: {reason}`。 */
async function executeOrFail(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    return await executeTool(name, args) // 真正执行（超时 / 体积 / 安全限制在注册表内）
  } catch (error) {
    const reason = error instanceof ToolError ? error.reason : 'error' // 已知分类用 reason；未知一律 `error`
    throw new Error(`tool ${name} failed: ${reason}`) // 统一成契约文案
  }
}
```

**这段在干什么**

`runLlmLayer` 做了四件事，顺序很重要：

1. **解析配置**：`maxRounds` 按「层配置 → `AGENT_MAX_ROUNDS` → 5」取值，并把 `model` / `temperature` / `maxRounds` 写进 `state.llm`。写进共享状态是为了让 `llmNodeDataOf(state)` 能组装出 `runLlmStep` 认的 `LlmNodeData`——**复用阶段 6 的节点实现，而不是复制一份模型调用代码**。
2. **定义两个节点**：`llmAction` 调一次模型、发 `token`；`toolsAction` 执行工具、发 `tool_call` / `tool_result`、把结果变成 `ToolMessage`。
3. **建图并编译**：`START → llm`，`llm` 用条件边分流到 `tools` 或 `END`，`tools → llm` 形成环。
4. **运行并写回**：`invoke` 时只把 `state.messages` 带进去，跑完后只把 `messages` 写回 `state.messages`。

三个容易被忽略的设计细节：

- **循环图是「私有」的**：它没有 `pool`、没有 `branches`、没有节点 id 分桶——因为 Agent 运行没有画布，只有一条直线 + 一个环。把「哪些状态需要跨层共享」压到最小，是这一层能保持简单的关键。
- **`rounds` / `toolCalls` 不外泄**：`invoke` 的输入和写回都只碰 `messages`。否则 `rounds` 会带着上一层的残留值进入下一次调用，轮次就数错了。
- **`compile()` 不传 checkpointer**：循环图是「一次运行内」的临时结构，断点恢复不在本阶段范围（参见 `09-会话与记忆/03-checkpointer与自建消息表.md` §8.2 的讨论）。

### 3.3 Python 侧：`run_llm_layer` 逐行拆解

> 文件：`d:\user\my_project\github\mini-dify\apps\api-py\app\agent\layers\llm.py`

```python
"""`llm` 层：ReAct 循环（LangGraph `StateGraph` + 条件边 + 环，节点 `llm` 与 `tools`）。

- 每轮逐 chunk 发 `token`；
- 有 `tool_calls` → 发 `tool_call` → 执行（复用工具注册表）→ 发 `tool_result`
  → 追加 `ToolMessage` → 回到 `llm`；
- `round` 从 1 开始；超过 `maxRounds` → `run_failed`，`message` 为
  `agent rounds exceeded: {max}`。

取消在**工具轮边界**检查（每轮 LLM 调用前后、每个工具执行前），
抛出后由运行器发唯一一帧 `run_cancelled`。
"""

import json  # 解析模型产出的工具参数（严格 JSON）
import time  # 工具耗时用 perf_counter（单调时钟，避免系统时间跳变）
from typing import Annotated, Any, TypedDict  # TypedDict 声明图状态；Annotated 挂 reducer

from langchain_core.messages import BaseMessage, ToolMessage  # 消息类型；ToolMessage 用于回填工具结果
from langgraph.graph import END, START, StateGraph  # Python 版 LangGraph 的建图原语

from app.agent.events import AgentEmit, AgentRunCancelled  # 事件回调（async）与「已取消」信号
from app.agent.state import AgentLlmConfig, AgentRunState, llm_node_data_of  # 跨层状态与节点数据组装
from app.config import settings  # 配置统一走 Settings（不要直接读 os.environ）
from app.engine.events import RunError  # 执行期错误（runner 归一为 run_failed）
from app.engine.nodes.llm import ToolCallRequest, run_llm_step  # 复用阶段 5/6 的一轮模型调用
from app.tools.registry import execute_tool  # 复用工具注册表
from app.tools.tool_error import ToolError  # 工具失败分类

# `maxRounds` 默认值与上限（见 agent-events.md §3.4）
DEFAULT_MAX_ROUNDS = 5  # 默认 5 轮
MAX_ROUNDS_LIMIT = 20  # 硬上限


def _replace(_previous: Any, update: Any) -> Any:
    """reducer：新值直接覆盖旧值（与 api-ts 的 Annotation reducer 一致）。"""
    return update  # 与 TS 的 `(_previous, update) => update` 完全同义


class LlmLoopState(TypedDict):
    """ReAct 循环的图状态：`messages` 是上下文，`rounds` 是已执行的工具轮数。"""

    messages: Annotated[list[BaseMessage], _replace]  # 完整上下文（含 ToolMessage）
    rounds: Annotated[int, _replace]  # 已完成的工具轮数
    tool_calls: Annotated[list[ToolCallRequest], _replace]  # 上一轮待执行调用（注意：Python 用 snake_case）


async def run_llm_layer(
    state: AgentRunState, config: dict[str, Any], emit: AgentEmit
) -> None:
    max_rounds = _resolve_max_rounds(config.get("maxRounds"))  # 配置 → AGENT_MAX_ROUNDS → 默认 5
    model = config.get("model")  # 原始值，下面做类型收窄
    temperature = config.get("temperature")
    state.llm = AgentLlmConfig(  # 写进共享状态，供 llm_node_data_of 组装
        model=model if isinstance(model, str) and model != "" else None,  # 空串视为未指定
        max_rounds=max_rounds,
        temperature=(
            float(temperature)
            if isinstance(temperature, (int, float)) and not isinstance(temperature, bool)  # bool 是 int 的子类，要排除
            else None
        ),
    )

    async def check_cancelled() -> None:  # 把「可选的取消回调」包成可直接 await 的函数
        if state.check_cancelled is not None:
            await state.check_cancelled()

    async def emit_token(text: str) -> None:  # run_llm_step 内部是 `await emit(piece)`，所以回调必须是 async；这里转调外层 emit
        await emit("token", {"text": text})

    async def llm_action(loop: LlmLoopState) -> dict[str, Any]:
        await check_cancelled()  # 模型调用前检查取消
        step = await run_llm_step(llm_node_data_of(state), loop["messages"], emit_token)  # 一轮模型推理（真流式）
        await check_cancelled()  # 模型调用后再检查一次
        return {
            "messages": [*loop["messages"], step.assistant_message],  # 追加本轮 assistant（含 tool_calls）
            "tool_calls": step.tool_calls,  # 条件边的路由依据
        }

    async def tools_action(loop: LlmLoopState) -> dict[str, Any]:
        await check_cancelled()  # 轮边界检查取消
        round_no = loop["rounds"] + 1  # 本轮编号 = 已完成轮数 + 1
        if round_no > max_rounds:  # 语义闸：第 max_rounds+1 轮直接拒绝
            raise RunError(f"agent rounds exceeded: {max_rounds}")  # 契约文案，逐字节一致
        messages = list(loop["messages"])  # 浅拷贝：逐个调用追加，不修改图状态里的原列表
        for call in loop["tool_calls"]:
            await check_cancelled()  # 每个工具执行前检查
            try:
                args = _parse_args_or_fail(call)  # 严格解析参数
            except RunError:
                # 参数解析失败仍先发 `tool_call`（args 为 `{}`），保持事件顺序可读
                await emit("tool_call", {"toolName": call.name, "args": {}, "round": round_no})
                raise  # 继续抛：runner 发 run_failed
            await emit("tool_call", {"toolName": call.name, "args": args, "round": round_no})
            started_at = time.perf_counter()  # 单调时钟开始计时
            result = await _execute_or_fail(call.name, args)  # 执行工具并把失败归一
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)  # 秒 → 整毫秒（与 TS 的 Date.now 差值同量级）
            await emit(
                "tool_result",
                {
                    "toolName": call.name,
                    "result": result,
                    "elapsedMs": elapsed_ms,
                    "round": round_no,
                },
            )
            messages.append(ToolMessage(content=result, tool_call_id=call.id, name=call.name))  # 回填工具结果
        return {"messages": messages, "rounds": round_no, "tool_calls": []}  # 推进轮数并清空待执行调用

    graph = StateGraph(LlmLoopState)  # 建图
    graph.add_node("llm", llm_action)  # 节点 llm
    graph.add_node("tools", tools_action)  # 节点 tools
    graph.add_edge(START, "llm")  # 入口
    graph.add_conditional_edges(
        "llm",
        lambda loop: "tools" if loop["tool_calls"] else "done",  # 有调用 → tools；否则 → done
        {"tools": "tools", "done": END},  # 路由表
    )
    graph.add_edge("tools", "llm")  # 回边：成环
    compiled = graph.compile()  # 编译（不传 checkpointer）

    result = await compiled.ainvoke(
        {"messages": state.messages, "rounds": 0, "tool_calls": []},  # 只带上下文进循环
        config={"recursion_limit": max(25, max_rounds * 2 + 10)},  # 结构闸
    )
    state.messages = result["messages"]  # 只写回 messages


def _resolve_max_rounds(value: Any) -> int:
    """`maxRounds`：层配置优先，其次环境变量 `AGENT_MAX_ROUNDS`，最后默认 5。"""
    if _valid_rounds(value):
        return int(value)  # 合法配置优先
    from_env = settings.agent_max_rounds  # 走 Settings，而不是 os.environ（见 INDEX「已知遗留」）
    if _valid_rounds(from_env):
        return int(from_env)  # 合法环境变量次之
    return DEFAULT_MAX_ROUNDS  # 回落默认


def _valid_rounds(value: Any) -> bool:
    if isinstance(value, bool):
        return False  # bool 不是合法轮数
    if isinstance(value, float) and value.is_integer():
        value = int(value)  # 5.0 视为 5（对齐 JS Number.isInteger(5.0) === true）
    if not isinstance(value, int):
        return False
    return 1 <= value <= MAX_ROUNDS_LIMIT  # 闭区间 1..20


def _parse_args_or_fail(call: ToolCallRequest) -> dict[str, Any]:
    """严格解析工具参数：非 JSON、非对象一律 `tool {name} failed: invalid arguments`。"""
    trimmed = call.args_text.strip()  # 去空白
    if trimmed == "":
        return {}  # 空串 = 无参数
    try:
        parsed = json.loads(trimmed)  # 解析 JSON
    except ValueError:
        parsed = None  # 解析失败落到统一失败
    if isinstance(parsed, dict):
        return parsed  # 只接受对象
    raise RunError(f"tool {call.name} failed: invalid arguments")


async def _execute_or_fail(name: str, args: dict[str, Any]) -> str:
    """执行工具并把内部失败归一为 `tool {name} failed: {reason}`。"""
    try:
        return await execute_tool(name, args)  # 真正执行
    except ToolError as error:
        raise RunError(f"tool {name} failed: {error.reason}") from error  # 已知分类
    except AgentRunCancelled:
        raise  # 取消必须原样上抛，不能被归一成工具失败
    except Exception as error:
        raise RunError(f"tool {name} failed: error") from error  # 未知一律 error
```

**这段在干什么**

与 TS 版**一一对应**：同样的三槽状态、同样的两个节点、同样的条件边 + 回边、同样的 `recursionLimit` 公式。差异只有四处，而且都在「语言层」而非「语义层」：

| 差异 | TS | Python | 为什么 |
| --- | --- | --- | --- |
| 图状态声明 | `Annotation.Root` | `TypedDict` + `Annotated` 挂 reducer | 语言习惯；语义等价（见阶段 4） |
| reducer | `(_previous, update) => update` | `_replace(_previous, update)` | 同名同义 |
| 运行 | `invoke(...)` | `ainvoke(...)` | Python 侧整个执行器是 async |
| 事件发射 | 同步 `emit(...)` | `await emit(...)` | Python 的写库/推送是 await 链 |
| 报错类型 | `throw new Error(...)` | `raise RunError(...)` | 由 runner 统一归一为 `run_failed` |
| 取消回调 | `state.checkCancelled()` | `state.check_cancelled()`（可选） | Python 侧用「可选回调 + 包装函数」表达「未接取消」 |
| 状态键名 | `toolCalls` | `tool_calls` | **图内部状态键名不进契约**，不必对齐（只有事件 payload 必须一致） |

特别记一句：**`except AgentRunCancelled: raise` 必须放在通用 `except Exception` 之前**（Python 的 except 按顺序匹配）。否则「用户取消」会被归一成 `tool {name} failed: error`，终态事件就从 `run_cancelled` 变成 `run_failed`——这是很容易写错、且很致命的一处。

### 3.4 `round` 到底是几：语义与时间线

**定义**：`round` = **工具执行轮次**，从 1 开始；对应状态槽 `rounds` = 已完成的工具轮数，从 0 开始。

> 源码 docstring 写的是「`rounds` 是已执行的工具轮数（从 1 开始计）」，这句话要拆开读：**轮次的编号**从 1 开始，而**计数槽 `rounds` 的初始值是 0**；完成第 1 轮后才变成 1。两句话并不矛盾，但混着读很容易算错——以代码为准（`round = loop.rounds + 1`，`rounds` 初值 0）。

| 时刻 | `rounds` | `round` 变量 | 事件 |
| --- | --- | --- | --- |
| 第 1 次进入 `llm` 节点 | 0 | — | `token*`（可能为空） |
| 模型返回 `tool_calls`，条件边去 `tools` | 0 | — | — |
| 进入 `tools` 节点，算出 `round = 0 + 1` | 0 | 1 | `tool_call(round:1)` / `tool_result(round:1)` |
| `tools` 返回，`rounds` 被覆盖为 1 | 1 | — | — |
| 第 2 次进入 `llm` | 1 | — | `token*` |
| 第 2 次进入 `tools` | 1 | 2 | `tool_call(round:2)` / `tool_result(round:2)` |
| 模型不再要工具 → `tools` 永不执行 | — | — | `layer_finished` |

**三个容易数错的地方**：

1. **第 1 次模型调用不属于任何一轮**。`round` 只在 `tools` 节点里产生，所以「模型想了 3 次」与「工具跑了 2 轮」是两个不同的数。
2. **一轮里可以有多个调用**。同一轮模型一次返回 3 个 `tool_calls` 时，`round` 都是同一个值，但会发 3 对 `tool_call` / `tool_result`。
3. **超限那一轮没有 `tool_call`**。`round > maxRounds` 的检查在循环之前、`emit` 之前，所以第 `maxRounds + 1` 轮只表现为「该轮的 token 之后紧跟 `run_failed`」。

### 3.5 `maxRounds`：三个来源与两道闸

**来源优先级**：

| 来源 | 取值 | 校验 | 备注 |
| --- | --- | --- | --- |
| 层配置 `llm.config.maxRounds` | 整数 1..20 | 接受运行前 400（`llm layer maxRounds must be between 1 and 20`）；运行期再校验一次 | 最高优先级 |
| 环境变量 `AGENT_MAX_ROUNDS` | 整数 1..20 | 越界 / 非整数 → 忽略，回落默认 | TS 读 `process.env`；Python 读 `settings.agent_max_rounds`（**`.env` 与进程环境都要经 `Settings` 读取**；直接读 `os.environ` 会漏掉 `.env`，见 INDEX 已知遗留） |
| 内置默认 | 5 | — | `DEFAULT_MAX_ROUNDS` |

**两道闸，职责不同**：

| 闸 | 位置 | 作用 | 超限表现 |
| --- | --- | --- | --- |
| **语义闸** | `tools` 节点开头：`round > maxRounds` | 真正防「无限要工具」 | `run_failed`，`message = agent rounds exceeded: {max}`（契约文案） |
| **结构闸** | `invoke` 的 `recursionLimit = max(25, maxRounds * 2 + 10)` | 防 LangGraph 自己跑飞；也是「框架兜底」 | LangGraph 抛 `GraphRecursionError`，被 runner 归一为 `run_failed`，**文案不是契约文案** |

**为什么公式是 `maxRounds * 2 + 10`**：每完成一轮工具调用要跨 **2 个 superstep**（`llm` 一步、`tools` 一步），所以 `2 * maxRounds` 是主循环的步数上界；`+10` 是入口、条件边、结束与版本差异的余量；`max(25, ...)` 保证小 `maxRounds`（比如 1）也不会因为框架内部计数偏紧而误伤。

**这里有个很实在的坑**：如果把 `recursionLimit` 写死成默认的 `25`，那么**合法的** `maxRounds = 20` 会在约第 12 轮（`25 / 2`）被 LangGraph 提前打断。此时两种后端的报错文案会变成框架自己的文字（版本之间还可能不同），既不符合契约，也让「同一输入两端一致」的验收直接失败。**上限与兜底必须联动**。

### 3.6 事件粒度与实测序列

| 粒度 | 事件 | 谁发 | 说明 |
| --- | --- | --- | --- |
| **每一片** | `token` | `llmAction` → `runLlmStep` 的分片回调 | provider 的真实流式片段；mock 每 5 个字符一片（见 `05-LLM节点/04`） |
| **每一次调用** | `tool_call` + `tool_result` | `toolsAction` | 同一轮多个并行调用 → 按调用顺序**多对**；`round` 相同 |
| **每一层** | `layer_started` + `layer_finished` | runner（`agent-runner.service.ts` / `runner.py`） | 5 层 → 5 对；`index` 从 1 开始 |
| **每次运行** | `run_queued` / `run_started` / 终态 | runner | `run_queued` 恒为 seq 1；终态三者恰有其一 |

**实测事件序列**（默认 5 层 `history → prompt → tools → llm → output`，工具跑 1 轮，两端**完全一致**）：

```text
 run_queued                              # 1  accept 时写入（seq 1）
 run_started                             # 2  status → running
 layer_started(history, 1)               # 3  ┐ 只改 state.messages，不发事件
 layer_finished(history, 1)              # 4  ┘
 layer_started(prompt, 2)                # 5  ┐ 只追加 system/user
 layer_finished(prompt, 2)               # 6  ┘
 layer_started(tools, 3)                 # 7  ┐ 只写 state.toolNames，不发事件
 layer_finished(tools, 3)                # 8  ┘
 layer_started(llm, 4)                   # 9
 tool_call        {round: 1}             # 10 tools 节点：参数解析成功
 tool_result      {round: 1}             # 11
 token                                   # 12 第二轮模型调用的分片（最终答案）
 token                                   # 13
 layer_finished(llm, 4)                  # 14
 layer_started(output, 5)                # 15 ┐ 只取最后一条 assistant，不发事件
 layer_finished(output, 5)               # 16 ┘
 run_finished                            # 17 output + elapsedMs
```

**为什么第 1 轮 `tool_call` 之前没有 `token`**：mock 在「只返回 `tool_calls`」的那一轮，`content` 是空串；`runLlmStep` 只在 `piece !== ''` 时发 `token`，所以这一段没有 token 事件。真实 provider 在「只产出工具调用」时通常也是空正文。**不要把「没有 token」误判成「模型没调用」**——判断依据是 `tool_call`，不是 token。

另外两条：

- `tool_call` 的 `args` 是**解析后的对象**（不是原始 JSON 字符串）；原始文本解析失败时，仍会先发一条 `args: {}` 的 `tool_call`，再失败——这样前端能看到「模型想调什么」，事件顺序也不会出现「凭空多出一个 result」。
- `tool_result` 的 `elapsedMs` 两端都用本地时钟测量，**不参与逐字节比对**；契约比对的是事件名序列、payload 键集合与其余字段（见 `04-执行引擎/07-验收.md` 的分层方法）。

---

## 4. 上下文压缩：把「会撑爆的上下文」变成「可控的上下文」

> **上下文窗口（context window）** = 模型一次请求能接收的最大 token 数。超过就直接报错或被截断。
> **上下文压缩（compaction）** = 在把消息交给模型之前，把「早期内容」换成更短的表示，从而控制长度。

### 4.1 为什么必须做：三笔账

1. **钱**：每次调用都按输入 token 计费；历史越长，**每一轮**都更贵。ReAct 多轮里，同一批历史会被反复计费。
2. **窗口**：模型有硬上限。超了不是「变慢」，而是**请求失败**。
3. **注意力**：即使没超限，过长的上下文也会稀释关键信息，回答质量下降。

本项目的上下文有两个来源，**只有第一个被压缩**：

| 来源 | 例子 | 谁负责控制 | 本阶段是否压缩 |
| --- | --- | --- | --- |
| **跨请求带进来的历史** | `history.config.messages`（客户端从会话记录里取） | `history` 层（本篇） | **是**（确定性截断） |
| **单次运行内累积的工具结果** | ReAct 每轮追加的 `ToolMessage` | `maxRounds` + 工具结果体积上限 | **否** |

**这一点必须说清楚**：`history` 层只在**入口**压一次；进入 `llm` 层之后，循环里的 `messages` 会随着每轮 `ToolMessage` 变长，**运行中不再压缩**。所以本项目的压缩是「入口压缩」，不是「运行中压缩」。真正防止单次运行撑爆的，是 `maxRounds`（最多 20 轮）和工具注册表的**结果体积上限**（见 `06-工具调用/01`）——这两道是「资源上限」，不是「语义压缩」。

### 4.2 两条路线：LLM 摘要 vs 确定性截断

| 维度 | **LLM 摘要**（真实系统常用） | **确定性截断**（本项目采用） |
| --- | --- | --- |
| 做法 | 调一次模型，把早期对话压成一段自然语言摘要 | 按条数砍掉最早的一批，用一条固定文案占位 |
| 质量 | 好：保住事实、约束、语气 | 差：只保留「有多少条被省略」 |
| 成本 | 每次压缩都要花钱 + 延迟 | 零成本、零延迟 |
| 可复现 | 否：同输入两次可能得到不同摘要（温度、模型版本、并发） | 是：纯函数，同输入同输出 |
| 两端一致 | 否：两侧可能用不同模型/不同 prompt，摘要天然不同 | 是：规则一致即可逐字节相同 |
| 可测试 | 需要 mock 模型、需要处理不确定性 | 是：单测直接断言字符串 |
| 失败模式 | provider 错误会让「压缩」这一步失败，可能连累整次运行 | 无外部依赖，不会失败 |

一句话：**摘要优化「质量」，截断优化「确定性」。** 在一个把「同一契约、双实现、逐字节一致」当作最高约定的项目里，确定性是硬约束，质量是软指标——所以选截断，并且**诚实记账**它丢了什么。

### 4.3 TS 侧：`runHistoryLayer` 逐行拆解

> 文件：`d:\user\my_project\github\mini-dify\apps\api-ts\src\agent\layers\history.layer.ts`

```ts
import type { AgentEmit } from '../agent-events' // 层签名统一带 emit（本层不发事件）
import { toLangChainMessage, type AgentRunState } from '../agent-state' // 角色 → LangChain 消息；未知角色丢弃

/** `history` 层默认值（见 agent-events.md §3.1）。 */
const DEFAULT_MAX_MESSAGES = 20 // 压缩后保留的最后 N 条
const DEFAULT_COMPACTION_THRESHOLD = 12 // 超过它才触发压缩
const DEFAULT_KEEP_RECENT = 6 // 压缩时原样保留的最后 N 条

interface HistoryEntry { // 净化后的历史条目
  role: string
  content: string
}

/**
 * `history` 层：载入历史消息并做**确定性压缩**（两端逐字节一致）。
 *
 * 1. `len > compactionThreshold` 时，把前 `len - keepRecent` 条替换成一条
 *    `{"role":"system","content":"[compacted] {n} earlier messages omitted"}`；
 * 2. 再按 `maxMessages` 保留最后 N 条。
 *
 * 真实系统会用模型做摘要，本项目为**可复现**选择确定性截断。
 */
export function runHistoryLayer(
  state: AgentRunState,
  config: Record<string, unknown>,
  _emit: AgentEmit, // 刻意不用：history 层只改上下文，不发事件
): void {
  const raw = Array.isArray(config.messages) ? config.messages : [] // 非数组一律当空（校验在 composition 层）
  const maxMessages = integerOr(config.maxMessages, DEFAULT_MAX_MESSAGES) // 缺失/非法 → 默认 20
  const compactionThreshold = integerOr(config.compactionThreshold, DEFAULT_COMPACTION_THRESHOLD) // 缺失/非法 → 默认 12
  const keepRecent = integerOr(config.keepRecent, DEFAULT_KEEP_RECENT) // 缺失/非法 → 默认 6

  let messages: HistoryEntry[] = [] // 先净化，后压缩：保证压缩只面对「确定形状」
  for (const item of raw) {
    if (!isPlainObject(item)) { // 非对象条目直接跳过（不让脏数据影响两端一致）
      continue
    }
    messages.push({
      role: String(item.role ?? ''), // 对齐 Python `nullish_string`：null/undefined → 空串
      content: typeof item.content === 'string' ? item.content : String(item.content ?? ''), // 非字符串按 JS String() 归一
    })
  }

  if (messages.length > compactionThreshold) { // 第 1 步：阈值触发
    const keep = Math.min(keepRecent, messages.length) // 保护①：保留数不能超过总条数（否则 omitted 为负）
    const omitted = messages.length - keep // 被替换的条数
    if (omitted > 0) { // 保护②：真有条目可省略时才插入标记
      messages = [
        { role: 'system', content: `[compacted] ${omitted} earlier messages omitted` }, // 唯一一条「占位」system 消息
        ...messages.slice(omitted), // 原样保留最后 keep 条
      ]
    }
  }
  if (messages.length > maxMessages) { // 第 2 步：窗口裁剪（发生在压缩「之后」）
    messages = messages.slice(messages.length - maxMessages) // 只留最后 N 条
  }

  for (const message of messages) { // 转成 LangChain 消息并 append 到共享上下文
    const converted = toLangChainMessage(message.role, message.content) // user/assistant/system → Human/AI/System
    if (converted !== null) { // 未知角色返回 null → 丢弃
      state.messages.push(converted) // 注意：是 append，不是替换
    }
  }
}

/** 取整数配置项；缺失 / 非法时回退默认值（非法值已由 composition 校验拦截）。 */
function integerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback // 只接受整数（5.0 也算整数）
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) // 排除 null 与数组
}
```

**这段在干什么**

三步，顺序不能换：

1. **净化**：把契约里的 `{role, content}` 收敛成「一定是字符串」的形状，非对象条目丢弃。这一步是为了让「两端逐字节一致」不受客户端脏数据影响。
2. **压缩**（第一步规则）：超过阈值就把「最早的一批」换成**恰好一条** system 消息；数量写进文案。
3. **窗口**（第二步规则）：再按 `maxMessages` 保留最后 N 条。

两个保护（`Math.min` + `if (omitted > 0)`）是这段代码最容易被「简化掉」的部分，也是「写错会怎样」的第一条（§7.1）。**注意 `state.messages.push(...)` 是追加**：`history` 层不负责清空上下文，它只负责「往里放」。

### 4.4 Python 侧：`run_history_layer` 逐行拆解

> 文件：`d:\user\my_project\github\mini-dify\apps\api-py\app\agent\layers\history.py`

```python
"""`history` 层：载入历史消息并做**确定性压缩**（两端逐字节一致）。

1. `len > compactionThreshold` 时，把前 `len - keepRecent` 条替换成一条
   `{"role":"system","content":"[compacted] {n} earlier messages omitted"}`；
2. 再按 `maxMessages` 保留最后 N 条。
"""

from typing import Any

from app.agent.state import AgentRunState, nullish_string, to_langchain_message  # 归一函数与角色转换

# `history` 层默认值（见 agent-events.md §3.1）
DEFAULT_MAX_MESSAGES = 20  # 压缩后保留的最后 N 条
DEFAULT_COMPACTION_THRESHOLD = 12  # 超过它才触发压缩
DEFAULT_KEEP_RECENT = 6  # 压缩时原样保留的最后 N 条


def run_history_layer(state: AgentRunState, config: dict[str, Any]) -> None:
    raw = config.get("messages")  # 原始历史
    if not isinstance(raw, list):  # 非数组一律当空
        raw = []
    max_messages = _integer_or(config.get("maxMessages"), DEFAULT_MAX_MESSAGES)  # 默认 20
    compaction_threshold = _integer_or(
        config.get("compactionThreshold"), DEFAULT_COMPACTION_THRESHOLD
    )  # 默认 12
    keep_recent = _integer_or(config.get("keepRecent"), DEFAULT_KEEP_RECENT)  # 默认 6

    messages: list[dict[str, str]] = []  # 净化后的条目
    for item in raw:
        if not isinstance(item, dict):  # 非对象跳过
            continue
        messages.append(
            {
                "role": nullish_string(item.get("role")),  # 对齐 JS `String(role ?? '')`
                "content": item["content"]
                if isinstance(item.get("content"), str)  # 字符串原样
                else nullish_string(item.get("content")),  # 其他按 JS String() 归一
            }
        )

    if len(messages) > compaction_threshold:  # 第 1 步：阈值触发
        keep = min(keep_recent, len(messages))  # 保护①：keep 不超过总条数
        omitted = len(messages) - keep  # 被替换条数
        if omitted > 0:  # 保护②：确实有可省略项才插入标记
            messages = [
                {"role": "system", "content": f"[compacted] {omitted} earlier messages omitted"},
                *messages[omitted:],  # 原样保留最后 keep 条
            ]
    if len(messages) > max_messages:  # 第 2 步：窗口裁剪
        messages = messages[len(messages) - max_messages :]  # 只留最后 N 条

    for message in messages:  # 转成 LangChain 消息并 append
        converted = to_langchain_message(message["role"], message["content"])
        if converted is not None:  # 未知角色丢弃
            state.messages.append(converted)


def _integer_or(value: Any, fallback: int) -> int:
    """取整数配置项；缺失 / 非法时回退默认值（非法值已由 composition 校验拦截）。"""
    if isinstance(value, bool):
        return fallback  # bool 不是整数配置
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)  # 5.0 → 5
    return fallback
```

**这段在干什么**

与 TS 版**同规则、同默认值、同保护**。三处「语言差异」值得对照：

| 环节 | TS | Python |
| --- | --- | --- |
| 角色归一 | `String(item.role ?? '')` | `nullish_string(...)`（内部模拟 JS 的 `String`） |
| 内容归一 | `typeof === 'string' ? : String(content ?? '')` | `isinstance(str) ? : nullish_string(...)` |
| 截断 | `messages.slice(omitted)` / `slice(len - max)` | `messages[omitted:]` / `[len - max:]` |

`nullish_string` 的存在说明一件事：**「两端一致」不只靠「写一样的算法」，还要靠「模拟对方语言的值转换」**。比如 JS 的 `String({})` 是 `"[object Object]"`、`String(null ?? '')` 是 `""`——Python 必须显式模仿，否则同一份脏数据在两端会产出不同的历史。

### 4.5 规则与参数：必须能背下来

| 参数 | 类型 | 默认 | 契约校验范围 | 作用 |
| --- | --- | --- | --- | --- |
| `messages` | `Array<{role, content}>` | `[]` | — | 输入历史；`role` 取 `user` / `assistant` / `system` |
| `compactionThreshold` | integer | `12` | `1..100` | **超过**该条数才触发压缩 |
| `keepRecent` | integer | `6` | `1..50` | 触发时原样保留的**最后 N 条** |
| `maxMessages` | integer | `20` | `1..100` | 压缩后保留的**最后 N 条** |

**两步（顺序不可换）**：

```text
第 1 步（压缩）
  if len(messages) > compactionThreshold:
      keep    = min(keepRecent, len)          # 保护①
      omitted = len - keep                     # 被替换条数
      if omitted > 0:                          # 保护②
          messages = [ {role:"system", content:"[compacted] {omitted} earlier messages omitted"} ]
                     + messages[omitted:]      # 最后 keep 条原样

第 2 步（窗口）
  if len(messages) > maxMessages:
      messages = messages[len - maxMessages:]  # 只留最后 N 条
```

四个必须讲清的点：

1. **阈值是「超过才压」，不是「达到就压」**：`len == 12` 不触发，`len == 13` 触发。
2. **`omitted` 数的是「被替换掉的条数」**，不是总数，也不是保留下来的条数。13 条 → `omitted = 7`，文案是 `[compacted] 7 earlier messages omitted`。
3. **压缩后是「1 + keep」条**：一条标记 + `keepRecent` 条原文。默认就是 7 条。
4. **窗口在压缩之后**：所以 `maxMessages` 看到的是「压缩后的 7 条」，而不是原始 20 条。这个顺序决定了 §4.8 的边界现象。

### 4.6 实测：20 条历史 → 模型实收 8 条

**输入**：20 条历史（`msg-1` … `msg-20`），`compactionThreshold = 12`、`keepRecent = 6`、`maxMessages = 20`。

| 阶段 | 条数 | 内容 |
| --- | --- | --- |
| 输入 | 20 | `msg-1` … `msg-20` |
| 第 1 步：`20 > 12` 触发 | 7 | `[compacted] 14 earlier messages omitted` + `msg-15` … `msg-20` |
| 第 2 步：`7 > 20`？否 | 7 | 不变 |
| `prompt` 层追加 1 条 user（`template` 渲染结果） | 8 | 1 条 marker + 6 条历史 + 1 条本轮提问 |
| `llm` 层实际发给模型 | **8** | 同上 |

**实测结论（照实记录）**：

- **TS 侧**：用透传代理（transparent proxy，即把 `LLM_BASE_URL` 指向一个只记录请求体再转发的本地代理）抓到真实请求体，`messages` 数组长度为 **8**；第 1 条 `role = "system"`、`content = "[compacted] 14 earlier messages omitted"`，随后是 `msg-15` … `msg-20`，最后是 prompt 层渲染出的那条 user。
- **Python 侧**：为**代码级核对**（同一规则实现，逐行对照源码；用仓库里的临时脚本 `apps/api-py/_tmp_hist.py` 直接调用 `run_history_layer` 验证，输出 `count = 7`，首条为 `('system', '[compacted] 14 earlier messages omitted')`，其余为 `msg-15` … `msg-20`）。**没有像 TS 侧那样抓过 Python 的真实请求体**——如实标注，避免把「代码级核对」写成「端到端实测」。
- **两端一致**：`history` 层输出 7 条完全相同；`+1` 条 prompt user 后为 8 条。差别只在「有没有被代理抓包」。

> 为什么不直接看数据库？因为压缩结果**不落库**。它只存在于一次运行的内存上下文里（`state.messages`）。要观测它，要么抓 provider 请求体，要么直接调用这一层的纯函数（`_tmp_hist.py` 就是后者）。

### 4.7 为什么选确定性：可复现是架构约束，不是口味

**收益**：

| 收益 | 具体表现 |
| --- | --- |
| **可复现** | 同一输入、同一配置 → 同一上下文。调试、验收、事故复盘都能重放。 |
| **零成本** | 不调模型、不花钱、不增加延迟。 |
| **两端可对齐** | 规则一致即可逐字节相同；没有「模型差异」这个变量。 |
| **可测试** | 纯函数，单测不需要 mock provider，也不需要容忍不确定性。 |
| **不引入新失败点** | 压缩这一步永远不会因为 provider 超时/限流而失败。 |

**代价（诚实）**：

- **信息丢失**：只保留「有 14 条被省略」，不保留它们说了什么。早期约束（比如「回答必须用中文」「金额单位是元」）一旦落在被砍掉的那段，模型就再也不知道了。
- **`[compacted]` 是 system 消息**：它会被模型当成系统指令来读；文案里只有计数，没有语义，模型可能对它有各种反应（通常无害，但不是「无感」）。
- **按条数，不按 token**：20 条短消息可能只有 500 token，20 条长消息可能 5 万 token。真正的「token 预算」没有建模。
- **只压入口**：运行中工具结果累积导致的膨胀，这一层管不到（§4.1）。

### 4.8 压缩与窗口的顺序耦合：两个「合法但反常」的配置

因为「先压缩、后窗口」，两个参数的组合会产生两种值得知道的现象。

#### 现象一：`maxMessages` 太小 → 压缩标记被窗口裁掉

配置：`compactionThreshold = 12`、`keepRecent = 6`、`maxMessages = 6`，输入 20 条。

| 步骤 | 结果 |
| --- | --- |
| 压缩 | 7 条：`[marker]` + `msg-15` … `msg-20` |
| 窗口（`7 > 6`） | 取最后 6 条：`msg-15` … `msg-20` —— **marker 被裁掉** |

结果：模型看到 6 条历史，但**完全不知道「前面还有 14 条被省略」**。它会把 `msg-15` 当成对话的开头。契约允许 `maxMessages = 1`、`keepRecent = 50` 这种组合（两个范围是独立校验的），所以这是**可达配置**，不是理论假设。

#### 现象二：`threshold < keepRecent` → 「触发了压缩，却几乎没压」

配置：`compactionThreshold = 5`、`keepRecent = 6`、`maxMessages = 20`，输入 7 条。

| 步骤 | 结果 |
| --- | --- |
| `7 > 5` 触发 | `keep = min(6, 7) = 6`，`omitted = 1` |
| 压缩后 | 7 条：`[compacted] 1 earlier messages omitted` + `msg-2` … `msg-7` |

**总条数没变**（7 → 7），却丢了 `msg-1`、多了一条标记。压缩的「收益」是负数（信息少了，长度没减）。

更极端的组合：`compactionThreshold = 3`、`keepRecent = 6`、输入 4 条 → `keep = min(6, 4) = 4`、`omitted = 0` → 保护②生效，**什么都不发生**。也就是说：**阈值触发了，压缩却没执行**。

> 契约层没有 `compactionThreshold >= keepRecent` 这条交叉校验，所以这些配置都能通过 400 校验。这是本阶段一个**已知的设计缝隙**（见 §11）。工程上要么在契约里补交叉校验，要么在文档里明确「`keepRecent` 应小于 `compactionThreshold`」。

### 4.9 升级路径：把「确定性截断」换成「LLM 摘要」需要什么

这不是改一行代码，而是把一个**纯函数**换成一个**带外部依赖的异步步骤**。按顺序需要补六件事：

| # | 需要什么 | 为什么 | 具体做法 |
| --- | --- | --- | --- |
| 1 | **层变异步** | 摘要要调 provider，必然 async | `history` 层改为 `async`；两侧 runner 的 `runLayer` 对 `history` 也要 `await`（当前 TS 是同步调用） |
| 2 | **缓存** | 同一批历史反复运行，不该反复付费；也是复现的前提 | 以 `sha256(规范化 messages + 参数 + prompt 版本 + 模型 id)` 为 key，落一张新表（如 `agent_history_summaries`）或 KV |
| 3 | **幂等** | 重试、并发、断线重跑不能生成两份摘要 | 唯一约束 + 「存在即复用」；并发冲突时读回已有值（参考阶段 9 的 `seq` 唯一约束 + 重试） |
| 4 | **失败回退** | 摘要失败不能连累整次运行 | provider 错误/超时 → **降级为确定性截断**，并记录降级原因；绝不让 `run_failed` 由「压缩」触发 |
| 5 | **契约变更** | 摘要策略、参数、版本必须可声明 | 新增 `strategy: "truncate" \| "summarize"`、`summaryModel`、`summaryPromptVersion`；可能要新增 `compaction` 事件让前端可见 |
| 6 | **验收口径降级** | 摘要文本不可逐字节保证（模型/版本/温度都会影响） | 从「逐字节一致」降为「结构一致 + 关键事实抽样一致」；这会**动摇项目主线**，必须显式决策 |

还有一个隐藏成本：**跨语言一致性**。如果 TS 与 Python 各自调不同 provider / 不同模型，摘要必然不同；要一致，只能约定「同一个模型 + 同一份 prompt + 同一版本」，而这会把「双实现」变成「双实现 + 共享外部状态」。

一句话：**确定性截断是「零依赖的工程解」，LLM 摘要是「质量更高但要多背一套缓存与契约的产品解」**。本项目停在前者，是有意识的边界。

---

## 5. ⭐ 框架取舍：为什么最终没用 Pydantic AI

### 5.1 总纲原本怎么规划的

`docs/00-开发总纲.md` §3.10 写得很清楚：

> **实现分工（刻意例外）**：TS 侧用 **LangGraph**（ReAct agent），Python 侧用 **Pydantic AI**（直接对齐 dify-agent 源码）——**同一契约、两套框架**，是绝佳的框架对照素材。

§3.2 的模块表也写着：`自主 Agent 运行时 | AgentModule（LangGraph） | agent_runtime（Pydantic AI）`。

**但最终实现不是这样**：

- `apps/api-py/pyproject.toml` 里只有 `langgraph>=1.2.16`，**没有** `pydantic-ai`；
- `apps/api-py/app/agent/layers/llm.py` 直接 `from langgraph.graph import END, START, StateGraph`；
- 两侧的 `llm` 层结构**一一对应**（同样的三槽状态、两个节点、条件边 + 回边）。

也就是说：**「刻意例外」没有落地，两侧都用了各自语言的原生 LangGraph 显式 ReAct 循环。** 下面逐条论证为什么。

### 5.2 三条理由（按优先级）

#### 理由一：事件契约要求「精确控制顺序与 payload」，Pydantic AI 的事件模型是有损映射

我们的契约（`packages/contract/agent-events.md` §2）只允许这些事件：`token` / `tool_call` / `tool_result` / `layer_*` / 终态。它们不是「框架自然吐出来的东西」，而是**我们定义的观察面**。三个具体冲突：

1. **`tool_call` 的时机与内容**：本项目要求「**参数解析失败也要先发一条 `args: {}` 的 `tool_call`，然后再失败**」（`llm.layer.ts` / `llm.py` 都有这个刻意的 `emit` 后再 `throw`）。在 Pydantic AI 里，工具参数由框架用 Pydantic 模型校验，**校验失败的处理权在框架手里**：默认行为是把校验错误回喂给模型让它重试。要做到我们的语义，必须**关掉/改写框架的重试**，并且在校验之前拿到原始参数文本——这已经是在和框架的默认生命周期对抗。
2. **`round` 是我们自己的编号**：`round = rounds + 1`，只在 `tools` 节点里产生。Pydantic AI 没有「工具轮次」这个对外概念（它有 step/message 的内部计数），映射时只能自己维护一个计数器，而计数器与框架的重试/步进不一定同频。
3. **`tool_result.elapsedMs` 是我们围绕 `executeTool` 亲自量的**：框架的 result 事件通常不提供「工具函数内耗时」这个精确边界（它包了校验、序列化等）。要么接受近似值，要么自己 hook。

结论：Pydantic AI 的事件流**可以用**，但要映射成契约里的 10 个事件，**顺序、payload、失败时机都会有损耗**，而这恰恰是本项目最在意的东西。

#### 理由二：跨实现逐字节一致——换框架会让事件序列天然分叉

项目主线是「同一契约、双实现、行为一致」，验收方式是「同一输入打两端，比对事件名序列 / payload 键集合 / token 字节」（见 `04-执行引擎/07-验收.md`、`06-工具调用/05-验收.md`）。框架一换，至少三处分叉：

| 分叉点 | 显式循环（现状） | 换成 Pydantic AI |
| --- | --- | --- |
| **发给模型的请求体** | 我们决定消息顺序、system 位置、工具 schema 序列化 | 框架决定消息装配（system prompt 注入方式、历史格式），与本项目不同 |
| **工具参数校验失败** | 直接 `run_failed`（固定文案） | 框架默认回喂模型重试 → **事件序列完全不同**（多出模型调用、可能多出 token） |
| **重试** | `maxRetries=0`（阶段 5 的对齐取舍） | 框架有自己的重试策略，需要额外关掉并对齐 |

这不是「多写几行适配」能解决的：**事件序列是行为的骨架**，骨架不同，「两端一致」这个验收命题就不成立了。

#### 理由三：教学连贯——同一机制，两种规模，学习者能看出「同一个东西」

阶段 6 已经用 `StateGraph` + `addConditionalEdges` + 回边实现过 ReAct。阶段 11 再写一遍，但换到「层内小图」：

- 阶段 4 学 `StateGraph` / reducer / `compile`-`invoke`；
- 阶段 6 学「条件边 + 环」怎么表达 ReAct；
- 阶段 11 看到**同一套零件**被装进一个层里，让「整个运行」成为一个循环。

这条线的认知收益是「**同一个机制的不同用法**」。如果 Python 侧突然换成 Pydantic AI，学习者看到的是两套互不相干的写法，反而丢失了「机制复用」这条主线。

### 5.3 代价：诚实记账

| 失去了什么 | 具体说明 |
| --- | --- |
| **框架对照价值** | 原本想对照 Pydantic AI 的 `Agent` / `@agent.tool` / `structured output` / `deps` 注入风格；现在这个素材没了 |
| **`dify-agent` 源码对齐** | 总纲 §3.10 的目标之一是「Python 侧直接对齐 dify-agent 源码」；现在 Python 侧是自写 LangGraph 循环，没有对齐 |
| **语言差异的教学面变窄** | 两侧结构同构，学习者感受到的是「同一设计的两种语法」，而不是「两种框架哲学」 |
| **结构化输出能力没学到** | Pydantic AI 的 `output_type`（模型输出必须是某个 Pydantic 模型，自动校验/重试）在本项目中仍靠手写 |
| **内置测试模型没用上** | Pydantic AI 的 `TestModel` / `FunctionModel` 适合无密钥单测；本项目仍用 mock LLM 服务 |

**换来了什么**：

- 事件顺序与 payload **完全可控**；
- 两端**同一机制**，验收口径（逐字节）继续成立；
- 复用阶段 5/6 的节点与工具注册表，**没有新增依赖**（LangGraph 本来就在 `pyproject.toml` 里）；
- 取消、上限、错误文案都能在**同一层**实现，不需要和框架的默认行为博弈。

### 5.4 什么时候**应该**选 Pydantic AI

判断标准（按重要性）：

1. **需要强类型结构化输出**：模型的最终回答必须是某个 Pydantic 模型（例如「必须返回 `{answer, citations[]}`，字段缺失就重试」）。Pydantic AI 的 `output_type` 直接给你校验 + 自动重试；自己写要一轮轮磨。
2. **需要 Python 原生 asyncio 风格与依赖注入**：工具/模型需要注入用户身份、DB 会话、租户配置（`RunContext[Deps]`）。Pydantic AI 的 deps 机制比手写闭包干净。
3. **事件不是契约**：产品只关心「最终答案 + 工具有没有被调」，不要求事件序列逐字节可复现。这时框架的省代码优势才真正兑现。
4. **单语言 / Python 优先**：不存在「和 TS 侧对齐」的约束，`dify-agent` 这类 Python 源码对齐才有意义。
5. **需要框架级的测试替身**：`TestModel` / `FunctionModel` 能在不联网的情况下驱动完整 Agent 生命周期。

反过来说：**只要「事件契约 + 双实现一致性」是最高优先级，显式循环就更划算。**

### 5.5 对照表：`LangGraph 显式循环` vs `Pydantic AI Agent`

| 维度 | LangGraph 显式循环（本项目两侧） | Pydantic AI `Agent` |
| --- | --- | --- |
| **控制力** | 高：状态、节点、条件边、每次 emit 都由我们写 | 中：循环、校验、重试由框架驱动，只能挂钩子/事件 |
| **事件粒度** | 精确到「每次工具调用」「每个 token chunk」；顺序我们定 | 框架事件模型（step / part delta / tool call / result）；需映射，部分信息有损 |
| **类型安全** | 中：TS 静态类型 + Python `TypedDict`；工具参数是 `dict[str, Any]` | 高：`output_type` 结构化输出；工具参数用 Pydantic 模型校验 |
| **代码量** | 多：状态声明 + 两个节点 + 条件边 + 上限 + 取消检查 | 少：一个 `Agent(...)` + 若干 `@agent.tool` |
| **跨语言一致** | 高：同一机制、同一事件序列，可逐字节比对 | 低：与 TS 侧实现天然分叉 |
| **错误语义** | 完全自定义：`tool {name} failed: invalid arguments` 直接终止 | 框架默认「把校验错误回喂模型重试」，需显式关闭/改写 |
| **上下文压缩** | 自己实现（确定性截断） | 仍是自己的事（框架管 `message_history`，不管压缩策略） |
| **学习价值** | 看得见循环的全部零件 | 看得见「框架替你做了什么」 |
| **适合场景** | 契约优先、双实现、需要精确事件 | 单语言、结构化输出、事件不重要 |

### 5.6 Pydantic AI 的等价写法（示意，非本项目文件）

```python
# 示意代码（非本项目文件）：Pydantic AI 的写法，仅用于对照；本项目两侧都没有 pydantic-ai 依赖
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext


class Deps(BaseModel):
    user_id: str


class Answer(BaseModel):
    text: str
    used_calculator: bool


agent = Agent(
    "openai:gpt-4o-mini",   # 模型用 provider 字符串声明
    deps_type=Deps,          # 依赖注入的类型（对标手写闭包传参）
    output_type=Answer,      # 结构化输出：框架负责校验，失败会自动重试
    system_prompt="You are terse.",
)


@agent.tool
async def calculator(ctx: RunContext[Deps], expression: str) -> str:
    # 参数由框架做 Pydantic 校验；校验失败默认回喂模型重试
    return str(safe_eval(expression))


result = await agent.run("2+3*4", deps=Deps(user_id="u1"))
print(result.output)  # Answer 实例，而不是我们契约里的字符串
```

**这段在干什么**：它用**一个对象**就替代了 `LlmLoopState` + 两个节点 + 条件边 + 回边 + 轮次上限 + 参数解析 + `ToolMessage` 回填。省下的代码是真实收益；但代价是**循环的每一步都不再受我们控制**——尤其是「校验失败怎么办」「轮次怎么数」「事件什么时候发」。

> 版本说明：Pydantic AI 的 API 名称随版本演进（例如早期的 `result_type` / `result.data` 后来改名为 `output_type` / `result.output`）。上面的片段只用于**对照心智**，具体签名请以你安装的版本文档为准——本项目**没有**引入该依赖，不涉及版本兼容问题。

### 5.7 如果将来真要换，需要改什么

| 改动点 | 内容 |
| --- | --- |
| `tools` 层 | 把工具注册表映射成 Pydantic AI 的 toolset；`ToolError` 分类要映射成框架的异常/返回值 |
| 事件适配 | 框架事件 → 契约里的 10 个事件；必须做到「event 名 + payload 键集合」一致 |
| 错误语义 | **显式关闭**「参数校验失败回喂模型重试」，改成终止 + 固定文案 |
| 轮次 | 自己维护 `round` 计数，且在框架重试/内部步进之外单独计数 |
| 取消 | 用框架的取消/超时机制，对齐「工具轮边界检查」的粒度 |
| 压缩 | 仍然自己实现（`message_history` 只是载体，策略不变） |
| 验收 | 从「逐字节」降级为「行为等价」——这一步会动摇项目主线，必须慎用 |

一句话总结这一节：**不是 Pydantic AI 不好，而是它的「默认替你做的事」恰好是我们要亲手做的事。** 在契约优先的项目里，**显式循环的确定性 > 框架的便利性**。

---

## 6. 与 TS 侧的对照（汇总）

| 概念 | TS（`apps/api-ts`） | Python（`apps/api-py`） |
| --- | --- | --- |
| 循环图状态 | `Annotation.Root({...})` | `class LlmLoopState(TypedDict)` + `Annotated[..., _replace]` |
| reducer | `(_previous, update) => update` | `def _replace(_previous, update): return update` |
| 建图 | `new StateGraph(LlmLoopState)` | `StateGraph(LlmLoopState)` |
| 条件边 | `.addConditionalEdges('llm', fn, { tools: 'tools', done: END })` | `.add_conditional_edges('llm', lambda ..., {'tools': 'tools', 'done': END})` |
| 回边（环） | `.addEdge('tools', 'llm')` | `.add_edge('tools', 'llm')` |
| 编译 / 运行 | `.compile()` + `graph.invoke(...)` | `.compile()` + `compiled.ainvoke(...)` |
| 结构闸 | `{ recursionLimit: Math.max(25, maxRounds * 2 + 10) }` | `config={"recursion_limit": max(25, max_rounds * 2 + 10)}` |
| 工具绑定 | `client.bindTools(toolDefs)` | `client.bind_tools(...)` |
| 工具消息 | `new ToolMessage({ content, tool_call_id, name })` | `ToolMessage(content=..., tool_call_id=..., name=...)` |
| 参数解析 | `JSON.parse` + 非数组对象校验 | `json.loads` + `isinstance(parsed, dict)` |
| 轮次来源 | `process.env.AGENT_MAX_ROUNDS` | `settings.agent_max_rounds` |
| 计时 | `Date.now()` | `time.perf_counter()` → 整毫秒 |
| 事件发射 | 同步 `emit(...)`（入队） | `await emit(...)` |
| 取消 | `state.checkCancelled()`（必填） | `check_cancelled()` 包装可选回调 |
| 超限错误 | `new Error(\`agent rounds exceeded: ${maxRounds}\`)` | `raise RunError(f"agent rounds exceeded: {max_rounds}")` |

**两条结论**：

1. **图内部状态键名不必一致**（`toolCalls` vs `tool_calls`）——它不进契约，也没有任何对外可见性。
2. **事件 payload 必须一致**——键名（`toolName` / `args` / `round` / `result` / `elapsedMs`）、类型（`round` 是 number）、文案（`agent rounds exceeded: {max}`）全部逐字节对齐。

---

## 7. 写错会怎样

> 这一节是「反向教学」：先看错误写法会把系统弄成什么样，再看本项目为什么那么写。

### 7.1 压缩阈值 < `keepRecent`：被替换条数为负

**错误写法**（把保护去掉，直接照文档公式字面实现）：

```ts
if (messages.length > compactionThreshold) {
  const omitted = messages.length - keepRecent     // 错误：可能为负
  messages = [
    { role: 'system', content: `[compacted] ${omitted} earlier messages omitted` },
    ...messages.slice(omitted),                    // 错误：负数下标 = 从尾部取
  ]
}
```

配置 `compactionThreshold = 3`、`keepRecent = 6`、输入 4 条时：

| 项 | 值 |
| --- | --- |
| `omitted` | `4 - 6 = -2` |
| `messages.slice(-2)` | 只剩最后 **2** 条 |
| marker 文案 | `[compacted] -2 earlier messages omitted` |

**现象**：历史从 4 条变成 3 条（2 条原文 + 一条写着负数的标记），**凭空丢了 2 条本来该保留的消息**，而且文案里出现 `-2`。更糟的是它**不会报错**——运行正常结束，只是模型看到的历史悄悄少了。

**本项目的两道保护**：

- `keep = Math.min(keepRecent, messages.length)`（`min(keep_recent, len)`）：保证 `keep` 不会超过总数；
- `if (omitted > 0)`：没有可省略项时**不插入标记**，数组原样。

**结果**：不会出现负数；但「配置语义反常」这件事仍在（§4.8 现象二），属于「合法但不好用」的配置，需要契约层补交叉校验或文档约定。

### 7.2 用 LLM 摘要但没做缓存：每次运行历史都不同

**现象**：

1. 同一份 20 条历史，第一次运行得到「用户在讨论退款政策，决定 7 天内可退」，第二次得到「用户问了退款，客服说要审核」——**模型看到的历史不一样**，输出自然不一样。
2. 验收时「同一输入打两端」失败，但双方都说「我们逻辑一样」——因为双方的摘要调用永远不可能逐字节相同。
3. `Last-Event-ID` 重放只重放**事件流**，不会重算摘要；于是「重放时用户看到的上下文」与「当时模型真正拿到的上下文」**不一致**，事故复盘会得出错误结论。
4. 每次都多一次模型调用：延迟增加、成本翻倍；流量高峰时摘要请求还可能被限流，压缩步骤成为新的失败点。

**本项目的做法**：不调模型，纯函数截断。如果将来升级，必须同时上「缓存 + 幂等 + 失败回退」，否则问题 1~3 会立刻出现。

### 7.3 `maxRounds` 不设上限：死循环烧钱

**现象**：模型反复调工具（尤其是工具一直返回错误时，模型会不断「换个参数再试」）。没有上限 = 永远不结束：

- 每一轮都在花 token 钱；
- 每一轮都在写事件（`agent_run_events` 表持续膨胀）；
- 用户只能点取消，而取消是**协作式**的（§7.4），可能还要再等一轮；
- LangGraph 最终会用 `recursionLimit` 抛错兜底，但那是**框架文案**，不是契约文案，两端不一致。

**本项目的两道闸**：

1. **语义闸**：`round > maxRounds` → `agent rounds exceeded: {max}`（契约文案，发生在执行第 `max+1` 轮**之前**）；
2. **结构闸**：`recursionLimit = max(25, maxRounds * 2 + 10)`（防框架跑飞）。

**特别注意**：只设语义闸、不管 `recursionLimit`，`maxRounds = 20` 会先被框架的默认 25 步打断（约第 12 轮），报错变成框架文案。**两道上限必须联动**。

### 7.4 取消只在「层边界」检查：长工具调用期间取消失效

**错误写法**：只在 runner 的 `for (layer of layers)` 循环开头查一次取消标记。

**现象**：`llm` 层内部可能跑 5 轮工具；如果某个工具要 30 秒，用户点「取消」后要等**这一整层跑完**才生效——可能几分钟后，钱已经花完。用户看到的是「取消按钮点了没反应」。

**本项目的做法**（在**工具轮边界**加密检查）：

| 检查点 | 位置 |
| --- | --- |
| 每层开始前 | runner 的层循环（`assertNotCancelled` / `_assert_not_cancelled`） |
| 每次 LLM 调用**前** | `llmAction` 开头 |
| 每次 LLM 调用**后** | `llmAction` 返回前（覆盖「流式期间用户点了取消」） |
| 每个工具执行**前** | `toolsAction` 的 `for` 循环开头 |

**仍然存在的空窗**：**单次** LLM 流式调用 / **单次** 工具执行期间无法中断，只能等它自己结束或超时。要真正做到「秒级取消」，需要把取消信号传进 provider 请求（`AbortController` / httpx 超时与取消）和工具执行内部——这属于「协作式取消」的下一层优化。

**权衡**：检查点越密，取消越灵敏，但每次检查都是一次 DB 查询（`SELECT cancelRequestedAt`）。本项目选择「每轮 + 每次工具」这个粒度：足够灵敏，查询次数也有界（≤ `2 * maxRounds + 层数`）。

### 7.5 事件先推后写库：断线重连丢事件

**错误写法**：`publish(seq, event)` 之后才 `INSERT`；或者并发地「边推边写」。

**现象**：

1. 订阅者收到 `seq = 7`，立刻断线；重连时带 `Last-Event-ID: 7`。
2. 服务端按「`seq > 7` 从 DB 重放」→ DB 里**还没有** seq 7 的行（写入还没完成或失败了）。
3. 结果：seq 7 **永久丢失**，且 seq 序列出现空洞。前端会看到「事件跳号」，重放也不补。

**本项目的做法（顺序不可换）**：

```text
写 DB（成功）  →  publish 给内存订阅者
```

- TS 用一个**串行 Promise 链**（`writer.chain`）保证 token 这类高频事件**不乱序**；
- Python 用 `await emit(...)` 逐条写库再 `publish`；
- **终态更严**：`run_finished` / `run_failed` / `run_cancelled` 的事件写入与 `AgentRun` 状态更新在**同一个事务**里提交，提交后才 `publish`——这样「重放看到终态」与「查询状态是终态」不会出现空窗。

### 7.6 其他三个容易踩的坑（简表）

| 错误写法 | 会怎样 | 正确做法 |
| --- | --- | --- |
| 在 `llm` 节点发 `tool_call` | 参数还没解析完就发，`args` 可能是半成品；`round` 也无从归属 | 在 `tools` 节点、解析成功后发；解析失败先发 `args: {}` 再抛 |
| `maxMessages < 1 + keepRecent` | 压缩标记被窗口裁掉，模型不知道历史被截断（§4.8 现象一） | 契约补交叉校验，或约定 `maxMessages ≥ keepRecent + 1` |
| 用「往 user 消息里塞 JSON」回填工具结果 | 模型会把工具结果当用户输入，行为不可控；`tool_call_id` 也对不上 | 必须用 `ToolMessage`（`role: tool` + `tool_call_id`），这是 OpenAI 协议要求 |

---

## 8. 验收自测

> 前提：两端服务已启动、`web` 可登录、mock LLM 已启动（`node tools/mock-llm/server.mjs`，默认端口 11435），两端的 `LLM_BASE_URL` 指向它。令牌与端口按本机实际情况替换。
> 本节命令用于**复现**本篇引用的实测事实；执行时不要改动源码。

### 8.1 工具轮：事件序列两端一致

先建一次运行（`input` 里带 mock 的工具标记）：

```powershell
$TOKEN = "<登录响应里的 accessToken>"

$body = @'
{"input":"2+3*4 [[call:calculator:{\"expression\":\"2+3*4\"}]]","composition":{"version":"1","layers":[{"name":"history","config":{}},{"name":"prompt","config":{"template":"Q: {{ input }}"}},{"name":"tools","config":{"names":["calculator"]}},{"name":"llm","config":{"maxRounds":5}},{"name":"output","config":{}}]}}
'@

curl.exe -s -X POST "http://127.0.0.1:3001/agent/runs" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary $body
```

**预期**：返回 `202`，body 形如 `{"id":"<runId>","status":"queued"}`。把 `id` 记为 `$RUN`。

再打开事件流：

```powershell
curl.exe -s -N -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3001/agent/runs/$RUN/events"
```

**预期**帧序列（`id:` 从 1 递增；payload 可按运行变化）：

```text
id: 1   event: run_queued       data: {"runId":"...","status":"queued"}
id: 2   event: run_started      data: {"runId":"..."}
id: 3   event: layer_started    data: {"layer":"history","index":1}
id: 4   event: layer_finished   data: {"layer":"history","index":1}
id: 5   event: layer_started    data: {"layer":"prompt","index":2}
id: 6   event: layer_finished   data: {"layer":"prompt","index":2}
id: 7   event: layer_started    data: {"layer":"tools","index":3}
id: 8   event: layer_finished   data: {"layer":"tools","index":3}
id: 9   event: layer_started    data: {"layer":"llm","index":4}
id: 10  event: tool_call        data: {"toolName":"calculator","args":{"expression":"2+3*4"},"round":1}
id: 11  event: tool_result      data: {"toolName":"calculator","result":"14","elapsedMs":...,"round":1}
id: 12  event: token            data: {"text":"..."}
id: 13  event: token            data: {"text":"..."}
id: 14  event: layer_finished   data: {"layer":"llm","index":4}
id: 15  event: layer_started    data: {"layer":"output","index":5}
id: 16  event: layer_finished   data: {"layer":"output","index":5}
id: 17  event: run_finished     data: {"output":"answer: 14","elapsedMs":...}
```

**与实测事实对照**：事件名序列正是

```text
run_queued > run_started > layer_started > layer_finished > layer_started > layer_finished
> layer_started > tool_call > tool_result > token > token > layer_finished
> layer_started > layer_finished > run_finished
```

`tool_call` 的 `args` 为 `{"expression":"2+3*4"}`、`round` 为 1；`tool_result` 的 `result` 为 `"14"`；最终 `run_finished.output` 为 `answer: 14`——**两端完全一致**。

**只比事件名**（排除 `runId` / `elapsedMs` 的干扰）：

```powershell
curl.exe -s -N -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3001/agent/runs/$RUN/events" |
  Select-String -Pattern '^event:' | ForEach-Object { $_.Line.Substring(7) }
```

把同一份 composition 打到 `http://127.0.0.1:8000`（Python 侧），各自取出事件名序列，`Compare-Object` **预期无输出**。

### 8.2 上下文压缩：20 条 → 7 条（+1 = 8）

**方式 A（代码级核对，可精确看到 7 条）**：

```powershell
uv run --directory apps/api-py python _tmp_hist.py
```

**预期输出**：

```text
count = 7
first = ('system', '[compacted] 14 earlier messages omitted')
rest  = ['msg-15', 'msg-16', 'msg-17', 'msg-18', 'msg-19', 'msg-20']
```

**说明**：这个临时脚本（`apps/api-py/_tmp_hist.py`）只调用 `run_history_layer`，不启动服务、不连模型；它验证的是「压缩规则本身」。

**方式 B（端到端，看模型实收几条）**：把 `history.config.messages` 填满 20 条、`compactionThreshold=12`、`keepRecent=6`、`maxMessages=20`，`prompt.config` **只给 `template`（不给 `system`）**，然后按 §8.1 的方式建运行。要看到「模型实收几条」，需要一个**透传代理**：把 `LLM_BASE_URL` 指向「记录请求体后原样转发到 mock」的本地代理，数一下 `messages.length`。

**预期**：`8`（1 条 marker + `msg-15..msg-20` + 1 条 prompt user）。

> 本次实测：TS 侧用透传代理抓到请求体，确认为 8；Python 侧为**代码级核对**（方式 A 的等价脚本），未抓真实请求体。两者规则一致、输出一致。

### 8.3 `maxRounds` 超限：固定文案

把 `llm.config.maxRounds` 改成 `1`，`input` 里写**两批**工具标记（用 `[[next]]` 分隔）：

```text
2+3*4 [[call:calculator:{"expression":"2+3*4"}]][[next]][[call:calculator:{"expression":"1+1"}]]
```

**预期**：第 1 轮工具执行完后，模型第 2 次返回工具调用 → `tools` 节点算出 `round = 2 > 1` → 抛错 → 事件流以 `run_failed` 结束：

```json
{"message":"agent rounds exceeded: 1"}
```

**注意两点**：①超限那一轮**没有** `tool_call`（检查发生在发事件之前）；②默认 `maxRounds = 5` 时，写 6 批标记会得到实测文案 **`agent rounds exceeded: 5`**（远端与本机一致，无端口/身份差异）。

### 8.4 取消的「空窗期」（可选）

用同样的 composition，把 `input` 换成 `[[mock-delay:10000]] 2+3*4` 再建一次运行（得到新的 `$RUN`）。mock 的延迟注入（`[[mock-delay:10000]]`）会让模型响应慢 10 秒；运行开始约 1 秒后调用取消：

```powershell
curl.exe -s -X POST "http://127.0.0.1:3001/agent/runs/$RUN/cancel" -H "Authorization: Bearer $TOKEN"
```

**预期**：`cancel` 立刻返回 `202`（`"status":"running"`，因为取消是异步的）；但事件流要**等延迟结束、`llmAction` 的第二次 `checkCancelled` 执行后**才出现 `run_cancelled`；终态是 `run_cancelled`，**没有** `run_finished`。

**这是代码级推导的预期（本次未单独计时）**：它恰好说明「取消是协作式的」——检查点之间的长调用无法被打断。

---

## 9. 常见坑

| 坑 | 现象 | 原因 / 正解 |
| --- | --- | --- |
| 把 `round` 当成「模型调用次数」 | 以为「模型想了一次」就是 round 1 | `round` 只在 `tools` 节点产生；第一次模型调用不属于任何轮 |
| 以为每轮固定「一条 `tool_call` + 一条 `tool_result`」 | 并行工具调用时数量对不上 | 同一轮多个调用会发**多对**，`round` 相同、按调用顺序排列 |
| 以为超限时会先发 `tool_call` 再失败 | 事件流里只看到 token 后直接 `run_failed` | 检查在 `emit` 之前；超限轮不产生工具事件 |
| 以为 `token` 每轮都有 | 工具调用轮「一个 token 都没有」 | 该轮正文为空串；`runLlmStep` 只在 `piece !== ''` 时发 |
| 以为压缩是「按 token 预算」 | 20 条短消息被砍掉 14 条 | 本项目按**条数**；token 预算未建模 |
| 以为压缩后的 marker 一定会在上下文里 | 模型像失忆一样从头开始 | `maxMessages` 太小会把 marker 裁掉（§4.8 现象一） |
| 以为「触发阈值」=「一定压缩」 | 配了 `threshold=3` 却什么也没发生 | `keepRecent ≥ len` 时 `omitted = 0`，保护②跳过 |
| 以为 `history` 层会发事件 | 事件流里这一层「什么都没有」 | 它只改 `state.messages`；`layer_started/finished` 由 runner 发 |
| 以为 `[compacted]` 是「摘要」 | 期待它包含早期内容 | 它只有计数；语义全丢 |
| 以为 `maxRounds` 只需在配置里限制 | 环境变量把上限抬到 1000 也能跑 | `MAX_ROUNDS_LIMIT = 20` 是硬上限，越界一律回落默认 |
| 以为 `recursionLimit` 与 `maxRounds` 无关 | `maxRounds=20` 在第 12 轮就报框架错误 | 必须按 `max(25, maxRounds*2+10)` 动态计算 |
| 以为 Python 读 `os.environ` 就行 | `.env` 里的 `AGENT_MAX_ROUNDS` 不生效 | 走 `settings.agent_max_rounds`（pydantic-settings 把 `.env` 读进 `Settings`，**不回写** `os.environ`；阶段 6 的同款教训） |
| 以为两端图状态键名要对齐 | 纠结 `toolCalls` vs `tool_calls` | 图内部状态**不进契约**；只有事件 payload 要对齐 |
| 以为取消能「立刻」生效 | 点了取消还在跑几十秒 | 协作式取消：只在检查点生效；长调用期间是空窗 |
| 以为「先推后写」只是性能问题 | 断线重连后事件跳号、缺一条 | 必须先写库成功再 publish；终态要同事务 |

---

## 10. 复盘与技术点登记

### 10.1 五条结论

1. **同一个机制，两种规模。** 阶段 6 把 ReAct 装进一个节点；阶段 11 把 ReAct 装进一个层，让整个运行成为循环。复用 `StateGraph` + 条件边 + 回边，是教学连贯性的来源。
2. **`round` 是「工具执行轮次」，不是「模型调用次数」。** 它只在 `tools` 节点产生，从 1 开始；超限检查发生在执行第 `max+1` 轮之前，所以超限轮没有工具事件。
3. **两道闸必须联动。** 语义闸给契约文案，`recursionLimit` 给框架兜底；只设一道，另一道就会以「框架文案 / 提前中断」的形式破坏两端一致。
4. **确定性截断是「可复现性」的工程解，不是质量最优解。** 它零成本、纯函数、两端可逐字节对齐；代价是只保留「省略了多少条」。真正的语义压缩需要异步 + 缓存 + 幂等 + 失败回退 + 契约变更，是一整套工程，而不是一行代码。
5. **框架取舍的标准是「契约是否最高优先级」。** 当事件顺序、payload、错误文案都必须逐字节一致时，显式循环的可控性胜过框架的省代码；当需求是「强类型结构化输出、单语言、事件不重要」时，Pydantic AI 更划算。我们没有用 Pydantic AI，是取舍，不是否定。

### 10.2 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 | 备注 |
| --- | --- | --- |
| **ReAct 作为运行核心（层内子图）** | 阶段 6 的循环在节点/整图；阶段 11 的循环在 `llm` 层内部；技术同为 `StateGraph` + 条件边 + 环 | **首次教学于本篇** |
| **`round` / `rounds` 语义** | `rounds` 为已完成工具轮数（0 起），`round = rounds + 1`（1 起）；每次工具调用都带 `round` | **首次教学于本篇** |
| **轮次双闸** | 语义闸 `round > maxRounds` → `agent rounds exceeded: {max}`；结构闸 `recursionLimit = max(25, maxRounds*2+10)` | **首次教学于本篇** |
| **Agent 事件粒度** | `token` 逐片；`tool_call` / `tool_result` 每次调用一对；`layer_*` 每层一对；无 `round_started` 事件 | **首次教学于本篇** |
| **上下文压缩（compaction）** | 为什么需要（token 成本 / 窗口 / 注意力）；入口压缩 ≠ 运行中压缩 | **首次教学于本篇** |
| **确定性截断的两步规则** | 先按阈值替换为 1 条 `[compacted] {n} earlier messages omitted`，再按 `maxMessages` 保留最后 N 条 | **首次教学于本篇** |
| **两个保护** | `keep = min(keepRecent, len)`、`if omitted > 0`；缺一就会出现负数 / 假标记 | **首次教学于本篇** |
| **「压缩 → 窗口」顺序耦合** | `maxMessages < 1 + keepRecent` 会裁掉 marker；`threshold < keepRecent` 会出现「触发但几乎不压」 | **首次教学于本篇** |
| **可复现性作为架构约束** | 为什么不用 LLM 摘要；升级摘要需要的六件事（异步 / 缓存 / 幂等 / 回退 / 契约 / 验收降级） | **首次教学于本篇** |
| **框架取舍：显式循环 vs Pydantic AI** | 事件契约 / 跨实现一致 / 教学连贯三条理由；代价（失去框架对照与 dify-agent 对齐）；适用场景 | **首次教学于本篇** |
| **跨语言图状态键名不对齐** | `toolCalls` vs `tool_calls` 不进契约；事件 payload 必须对齐 | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：`StateGraph` / `Annotation` / reducer / compile-invoke（`04-执行引擎/02`、`04-执行引擎/04`）；条件边、环、`recursionLimit`、`ToolMessage`、`bindTools` / `bind_tools`、工具注册表与 `ToolError`（`06-工具调用/02`、`06-工具调用/03`）；token 分片与 `run_failed` 双通道（`04-执行引擎/01`、`05-LLM节点/03`）；mock 工具标记（`05-LLM节点/04`）；`MAX_HISTORY_MESSAGES` 窗口裁剪（`09-会话与记忆/02`）；checkpointer 与业务表分工（`09-会话与记忆/03`）；「先写库再推送」对重放的意义（`packages/contract/agent-events.md` §4、`10-发布与API/03`）。

---

## 11. 与源码 / 任务描述的差异（诚实记录）

这一节记录「任务描述」与「当前源码」不一致的地方，避免后续复述时以讹传讹。

| # | 任务描述的表述 | 源码实际 | 说明 |
| --- | --- | --- | --- |
| 1 | 「`tool_call` / `tool_result` **每轮各一条**」 | 是**每次调用**一对；同一轮有多个并行调用时，会连发多对（`for (const call of loop.toolCalls)` / `for call in loop["tool_calls"]`），`round` 相同 | 「每轮各一条」只在「一轮一个调用」时成立 |
| 2 | 「压缩阈值 < keepRecent → 逻辑异常（**被替换条数为负**）」 | 当前源码有 `min(keepRecent, len)` 与 `if omitted > 0` 两道保护，**不会**出现负数；实际表现是「触发压缩但几乎不压 / 完全不动」 | 「负条数」是**去掉保护后**的错误写法（§7.1），不是现状 |
| 3 | 「取消只在**层边界**检查 → 长工具调用期间取消失效」 | 现状是**层边界 + 工具轮边界**（每次 LLM 调用前后、每个工具执行前）都检查；但**单次**长调用期间仍无法中断 | 描述的是「要避免的写法」；现状已比它更密，仍有空窗 |
| 4 | 「事件**先推后写库** → 断线重连丢事件」 | 现状是**先写库、再推订阅者**；终态事件与状态更新同事务提交 | 同上：描述的是错误写法，不是现状 |
| 5 | 「`tool_call {"args":...,"round":1}`」 | 实际 payload 还包含 **`toolName`**（`{"toolName","args","round"}`） | 任务里是简写；契约 §2 有完整键集合 |
| 6 | 「Python 侧同规则实现」 | 压缩规则确实同规则；但**实测**只有 TS 侧抓过请求体，Python 侧是代码级核对（`_tmp_hist.py`） | 本篇已按「代码级核对」标注，未夸大为端到端实测 |
| 7 | 总纲 §3.10「Python 侧用 Pydantic AI」 | 实际**两侧都用 LangGraph**，`pyproject.toml` 无 `pydantic-ai` 依赖 | §5 已作为本篇的设计论证核心展开 |

另外两处**实现细节**，不构成「不符」，但容易被误读：

- **`agent rounds exceeded` 与阶段 6 的 `tool call rounds exceeded` 是两套文案**（它们属于两个不同接口），不是笔误；
- **`history` 层是同步函数**，而 `llm` 层是 async；如果将来把压缩换成 LLM 摘要，`history` 层必须变成 async，两侧 runner 的 `runLayer` 也要相应 `await`。
