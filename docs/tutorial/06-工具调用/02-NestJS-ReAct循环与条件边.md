# 02 · NestJS：ReAct 循环与条件边

> 所属：阶段 6 · 工具调用
> 本篇覆盖：把 `llm` 节点的 `data.tools` 变成**真的能调工具**——用 `client.bindTools(...)` 让模型返回 `tool_calls`；新增内部节点 `<llmId>__tools` 执行工具并以 `ToolMessage` 回填；用 **`addConditionalEdges`（条件边）+ `addEdge(<llmId>__tools, <llmId>)`（回边）** 构成 ReAct 循环；用 `messages` / `rounds` / `toolCalls` 三份**按节点隔离**的状态承载循环；用 `MAX_TOOL_ROUNDS` 兜住无限循环。
> **本篇首次教学（本阶段的学习核心）：① ReAct = Reason + Act 的交替循环；② 为什么「不新增 Agent 节点」，而用「LLM 节点 + tools 配置 + 条件边」；③ LangGraph 的条件边 `addConditionalEdges`（运行时路由 vs 静态连线）；④ 「环」是 LangGraph 的一等公民（回边、superstep、与 for 循环的区别）；⑤ 关键陷阱：从该 llm 出发的普通边必须跳过；⑥ 按节点隔离的状态 `Record<nodeId, ...>`；⑦ `ToolMessage` 的「工具角色」语义；⑧ 轮次保护 `MAX_TOOL_ROUNDS`；⑨ `bindTools` 与流式 `tool_call_chunks` 聚合；⑩ 工具轮的事件语义（`node_started` / `node_finished` 各只发一次，`tool_call` / `tool_result` 带 `round`）**
> （LangGraph 心智模型 / `Annotation` / reducer / 动态建图 / `compile`-`invoke` 见 `04-执行引擎/02-LangGraph编译图-TS.md`；SSE 帧格式与事件顺序见 `04-执行引擎/01-运行契约与SSE事件协议.md`；`ChatOpenAI` 与真流式见 `05-LLM节点/02-真实模型调用与流式.md`；错误映射见 `05-LLM节点/03-LLM错误映射.md`；mock-LLM 见 `05-LLM节点/04-mock-LLM与无密钥自测.md`；工具契约 / 注册表 / 三个内置工具的实现细节见本阶段第 `01` 篇，本篇只引用不重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 本篇在阶段 6 的位置

阶段 5 结束时，`llm` 节点已经能真调模型、真流式。但它只会「说」，不会「做」：

```
用户：2+3*4 等于多少？
LLM：  （只能凭参数记忆回答，或直接算错）
```

阶段 6 要让它**先请求工具、看到工具结果、再据此回答**：

```
LLM：我要调 calculator(expression="2+3*4")     ← Reason + Act（请求行动）
工具：14                                        ← Observation（工具结果回灌）
LLM：answer: 14                                 ← 再 Reason，这次不需要工具了
```

这个「**想 → 调工具 → 看结果 → 再想 → …**」的交替过程就是 **ReAct**。本篇只讲 **TS/NestJS 端怎么用 LangGraph 把它画成图并跑起来**；工具契约、工具注册表与三个内置工具的实现，见同阶段第 `01` 篇。

---

## 1. 本篇目标

- 让 `llm` 节点的 `data.tools: string[]` 生效：模型能返回 `tool_calls`，引擎能执行工具。
- 用 **条件边 + 回边**在 LangGraph 里构造 ReAct 循环，且**不新增节点类型**。
- 循环状态按 `llm` 节点 id 隔离（多工具节点互不干扰）。
- 工具轮事件语义与契约一致：`node_started` / `node_finished` 各一次，`tool_call` / `tool_result` 带 `round`。
- 有轮次上限，超限走 `run_failed`。

**验收标准**

1. `pnpm --filter @mini-dify/api-ts build` 通过。
2. 配 `tools: ["calculator"]` + mock-LLM，能收到 `tool_call(round=1)` → `tool_result(round=1)` → `token` → `node_finished`（见 §19.1）。
3. 多轮工具调用：两轮 `tool_call` 的 `round` 分别为 `1`、`2`（§19.2）。
4. 同一轮多个工具：两个 `tool_call` 的 `round` **相同**（§19.3）。
5. 编译后的图里有 `llm1 → llm1__tools`（条件边）与 `llm1__tools → llm1`（回边）（§19.4）。
6. `MAX_TOOL_ROUNDS=1` 且模型要两轮工具时，流内 `run_failed`，文案 `tool call rounds exceeded: 1`（§19.5）。
7. 回归：不配 `tools` 的 `llm` 节点行为与阶段 5 **逐字节一致**（§19.6）。

---

## 2. 前置条件

- 阶段 4 已完成：`engine.service.ts` / `events.ts` / `nodes/` 能在 LangGraph 上跑 `start → llm → end`。
- 阶段 5 已完成：`runLlmStep` 用 `ChatOpenAI` 真流式；`node_finished.output` 为 `{ text, model, usage? }`。
- 本阶段第 `01` 篇已完成：契约里 `LlmNodeData.tools?: string[]`、`ToolDefinition`、`GET /tools`、`tool_call` / `tool_result` 事件已就位；`apps/api-ts/src/tools/` 已有注册表与三个工具。
- 本地能启动 mock-LLM（无密钥自测）或配好真实 provider。

---

## 3. 命令清单

> 命令均在仓库根 `d:\user\my_project\github\mini-dify` 执行（或按列注明）。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 编译契约（`tools` / `ToolDefinition` / 新事件类型） | 无报错 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 编译 NestJS，验证条件边与工具类型 | 无报错 |
| `node tools/mock-llm/server.mjs` | 仓库根 | 启动无密钥 mock-LLM（默认 `127.0.0.1:11435`） | 打印监听端口 |
| `pnpm --filter @mini-dify/api-ts start:dev` | 仓库根 | 启动 api-ts（读 `apps/api-ts/.env`） | 监听 `http://localhost:3001` |
| `curl.exe -N -X POST .../apps/{id}/run` | 任一端 | `-N` 禁用缓冲，逐帧看 SSE | 逐帧打印 `event:` / `data:` |

mock 自测时 `apps/api-ts/.env` 里三项要改（`LLM_API_KEY` 必须非空，否则 `runLlmStep` 直接抛 `llm provider not configured`）：

```dotenv
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=test
LLM_MODEL=mock-model
```

---

## 4. 先看清：循环在图里长什么样

### 4.1 一张图

原来的直线（阶段 4/5）：

```
START → start_1 → llm_1 → end_1 → END
```

开启工具后，`llm_1` 的出边被**替换**成「条件边二选一」，并多出一个内部工具节点 `llm_1__tools` 与一条**回边**：

```
START → start_1 → llm_1 ──────────── continue ─────────────→ end_1 → END
                    │  ▲
          tools     │  │   addEdge('llm_1__tools', 'llm_1')   ←「环」
                    ▼  │
                 llm_1__tools   （执行 tool_calls，追加 ToolMessage）
```

- `llm_1` 跑完，**条件边**看「本轮有没有 `tool_calls`」：
  - 有 → 走 `tools` 分支到 `llm_1__tools`；
  - 没有 → 走 `continue` 分支到原图下游（这里是 `end_1`）。
- `llm_1__tools` 执行工具、把结果作为 `ToolMessage` 回填消息数组，然后**沿回边**回到 `llm_1`，开始下一轮。

### 4.2 一次 ReAct 与图的对应

| ReAct 步骤 | 图里的动作 |
| --- | --- |
| **Reason（想）** | `llm_1` 调模型；模型返回 `tool_calls` |
| **Act（做）** | 条件边 → `llm_1__tools`，逐个执行工具 |
| **Observe（看结果）** | 工具结果包成 `ToolMessage` 追加进 `messages[llm_1]` |
| **再 Reason** | 回边 → `llm_1`，带着完整历史再调模型 |
| **收敛** | 某轮模型不再返回 `tool_calls` → 条件边走 `continue` → 下游 |

> 关键：**下游 `end_1` 只在最后一次（无 `tool_calls`）才被走到**，所以 `end_1` 渲染 `{{ llm_1.text }}` 得到的是最终答复，而不是中间轮的空文本。

---

## 5. 完整代码：工具注册表（registry.ts）

工具定义是 `bindTools` 的输入（OpenAI function calling 的 `parameters` 就是 JSON Schema），执行则按名字分派。

**完整文件路径：`apps/api-ts/src/tools/registry.ts`**

```ts
import type { ToolDefinition } from '@mini-dify/contract'

import { runCalculator } from './calculator.tool'
import { runGetCurrentTime } from './current-time.tool'
import { runHttpGet } from './http-get.tool'

/**
 * 内置工具注册表（唯一真源，见 packages/contract/openapi.yaml 的 `ToolDefinition`）。
 *
 * `TOOL_DEFINITIONS[].parameters` 是 JSON Schema 形状，可直接作为 OpenAI
 * function calling 的 `parameters` 交给模型；`executeTool` 按名字分派执行。
 * 返回值一律为**字符串**（与 `tool_result.result` 的契约一致）。
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'calculator',
    description: '安全地计算一个四则运算表达式，支持 + - * /、括号、小数与一元负号。',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '要计算的表达式，例如 "2+3*4"',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_current_time',
    description: '返回当前 UTC 时间（ISO-8601、毫秒精度、以 Z 结尾）。无参数。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'http_get',
    description: '对给定 URL 发起 HTTP GET，返回响应体文本。仅允许 http/https。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要请求的 http:// 或 https:// URL',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
]

/** 工具名是否已注册。 */
export function hasTool(name: string): boolean {
  return TOOL_DEFINITIONS.some((definition) => definition.name === name)
}

/** 按名字取工具定义（未注册时返回 undefined）。 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((definition) => definition.name === name)
}

/**
 * 执行一个工具，返回**字符串**结果。
 *
 * 未注册的工具名由引擎在预检阶段拦截；此处再抛普通 Error 作为兜底。
 * 工具内部失败一律抛 `ToolError`（带固定 `reason`），由引擎拼成规范文案。
 */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'calculator':
      return runCalculator(args)
    case 'get_current_time':
      return runGetCurrentTime()
    case 'http_get':
      return runHttpGet(args)
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
```

**要点**（工具实现本身见本阶段第 `01` 篇）：

- **`name` / `description` / `parameters` 三者缺一不可**：模型靠 `description` 判断「什么时候该用」，靠 `parameters` 生成参数 JSON。
- **`parameters` 是 JSON Schema**：OpenAI 兼容协议直接吃这个形状，不需要再转换。
- **返回值一律字符串**：`executeTool` 的签名就是 `Promise<string>`，与 `tool_result.result` 的契约（一律字符串）对齐。

---

## 6. 完整代码：LLM 节点（llm.node.ts）

阶段 6 的 `llm.node.ts` 做了三件新事：**构造带 system 的初始消息**、**`bindTools`**、**把流式的 `tool_call_chunks` 聚合成完整调用**。

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`**

```ts
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
  type MessageContent,
} from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import type { GraphNode, LlmNodeData, ToolDefinition } from '@mini-dify/contract'

import { RunError } from '../events'
import { getToolDefinition } from '../../tools/registry'
import { renderTemplate, type Pool } from '../template'

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

/**
 * 构造 `llm` 节点的初始消息：`system`（非空时）+ 渲染后的 `prompt`。
 * 启用工具的节点只在第一轮用它，后续轮次沿用节点自己的消息数组。
 */
export function buildInitialMessages(node: GraphNode, pool: Pool): BaseMessage[] {
  const data = node.data as unknown as LlmNodeData
  const messages: BaseMessage[] = []
  if (typeof data.system === 'string' && data.system !== '') {
    messages.push(new SystemMessage(data.system))
  }
  messages.push(new HumanMessage(renderTemplate(String(data.prompt), pool)))
  return messages
}

/**
 * 执行一轮 LLM 调用（阶段 6：可选绑定工具）。
 *
 * 逐 chunk 取 `chunk.content`（字符串化后）**立即**发 `token` 事件（provider 的真实流式片段），
 * 同时累积全文与 `tool_calls`（流式分片按 `index` 聚合，参数解析延迟到工具执行时）。
 * 任何调用错误都经 `mapLlmError` 归一为规范文案（见 error-messages.md §5）。
 */
export async function runLlmStep(
  data: LlmNodeData,
  messages: BaseMessage[],
  emitToken: (text: string) => void,
): Promise<LlmStepResult> {
  const apiKey = process.env.LLM_API_KEY ?? ''
  if (apiKey === '') {
    throw new RunError('llm provider not configured: LLM_API_KEY')
  }

  const model = data.model ? data.model : (process.env.LLM_MODEL ?? '')
  const client = new ChatOpenAI({
    apiKey,
    model,
    configuration: { baseURL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1' },
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
    // 不重试（LangChain AsyncCaller 默认重试 6 次会让 5xx/超时长时间挂起）；两端一致
    maxRetries: 0,
    ...(typeof data.temperature === 'number' ? { temperature: data.temperature } : {}),
    ...(typeof data.maxTokens === 'number' ? { maxTokens: data.maxTokens } : {}),
  })

  const toolDefs = resolveToolDefs(data.tools)
  const runnable = toolDefs.length > 0 ? client.bindTools(toolDefs) : client

  let text = ''
  let usage: LlmStepResult['usage']
  // 流式工具调用分片：按 `index` 聚合 id / name / 参数文本
  const partial = new Map<number, { id: string; name: string; argsText: string }>()
  try {
    for await (const chunk of await runnable.stream(messages)) {
      const piece = stringifyContent(chunk.content)
      if (piece !== '') {
        text += piece
        emitToken(piece)
      }
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
      const meta = chunk.usage_metadata
      if (meta && typeof meta.input_tokens === 'number') {
        usage = {
          promptTokens: meta.input_tokens,
          completionTokens: meta.output_tokens,
          totalTokens: meta.total_tokens,
        }
      }
    }
  } catch (error) {
    throw new RunError(mapLlmError(error))
  }

  const toolCalls: ToolCallRequest[] = [...partial.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, value], position) => ({
      id: value.id !== '' ? value.id : `call_${index}_${position}`,
      name: value.name,
      argsText: value.argsText,
    }))

  // 回填 assistant 消息（含 tool_calls），保证下一轮对话历史完整
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

/**
 * `llm` 节点（阶段 5 的向后兼容路径）：未启用工具的节点只调用一次，输出 `{ text, model, usage? }`。
 */
export async function runLlmNode(
  node: GraphNode,
  pool: Pool,
  emitToken: (text: string) => void,
): Promise<Record<string, unknown>> {
  const data = node.data as unknown as LlmNodeData
  const step = await runLlmStep(data, buildInitialMessages(node, pool), emitToken)
  const output: Record<string, unknown> = { text: step.text, model: step.model }
  if (step.usage !== undefined) {
    output.usage = step.usage
  }
  return output
}

/** 把契约里的工具名列表解析为 OpenAI function 定义（只取已注册的名字，预检已拦截未知名字）。 */
function resolveToolDefs(names: string[] | undefined): ToolDefinition[] {
  if (!Array.isArray(names) || names.length === 0) {
    return []
  }
  const definitions: ToolDefinition[] = []
  for (const name of names) {
    const definition = getToolDefinition(name)
    if (definition !== undefined) {
      definitions.push(definition)
    }
  }
  return definitions
}

/**
 * 宽松解析工具参数：非法 JSON 或非对象时返回 `{}`（真正的报错在执行工具时，
 * 保证事件顺序仍是 `tool_call` → `run_failed`）。
 */
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

/** chunk.content 字符串化：字符串原样；数组拼各 text 部分；其余紧凑 JSON（与 api-py 对齐）。 */
function stringifyContent(content: MessageContent): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        const text = (part as unknown as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      })
      .join('')
  }
  if (content === null || content === undefined) {
    return ''
  }
  return JSON.stringify(content)
}

/**
 * 把 LangChain / 底层异常映射为规范文案（规则与 api-py 的 `map_llm_error` 一致，见 error-messages.md §5）。
 * 映射为纯函数：HTTP 状态码优先，其次超时，最后归入 unknown。
 */
export function mapLlmError(error: unknown): string {
  const status = statusCodeOf(error)
  if (status !== null) {
    if (status === 401 || status === 403) {
      return 'llm request unauthorized'
    }
    if (status === 429) {
      return 'llm rate limited'
    }
    return `llm request failed: ${status}`
  }
  if (isTimeout(error)) {
    return 'llm request timed out'
  }
  return 'llm request failed: unknown'
}

/** 取异常的 HTTP 状态码（OpenAI SDK 的 APIError 带 `status`）。 */
function statusCodeOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') {
      return status
    }
  }
  return null
}

/** 判定是否为超时（OpenAI SDK 的 `APIConnectionTimeoutError` / AbortError，或消息含 timeout）。 */
function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const name = (error as { name?: unknown }).name
  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError' || name === 'AbortError') {
    return true
  }
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /timed? ?out|timeout/i.test(message)
}
```

**要点**：

- **`buildInitialMessages`** 只在**第一轮**用：`system`（有则加）+ 渲染后的 `prompt`。之后每轮都用 `messages[nodeId]`（历史 + 工具结果 + 上轮 assistant）。
- **`bindTools` 是「让模型知道有工具」的唯一开关**：不 bind，模型永远不会返回 `tool_calls`；它只会把工具名当普通文本吐出来。
- **流式 `tool_calls` 是分片来的**：同一个调用的 `id` / `name` / `args` 可能分散在多个 chunk（`name` 甚至会被切成几段，所以代码用 `current.name + toolCallChunk.name` **累加**而不是赋值）。
- **`argsText` 保留原始 JSON 文本**，不在流式期间解析：参数可能被切成 `{"expr` + `ession":"2+` + `3*4"}`；聚合完再解析才安全。
- **`assistantMessage` 必须回填**（含 `tool_calls`）：下一轮请求里，带 `tool_calls` 的 assistant 消息与对应的 `tool` 消息必须成对；少一条，多数 OpenAI 兼容 provider 会直接 400（消息序列不合法）。
- **`usage` 取本轮最后一次出现的 `usage_metadata`**；`node_finished.output` 里的 `usage` 是**最后一轮**的用量。
- `mapLlmError` / `statusCodeOf` / `isTimeout` 与阶段 5 相同，见 `05-LLM节点/03-LLM错误映射.md`。

---

## 7. 完整代码：事件（events.ts）

阶段 6 在阶段 4 的事件集上新增 **`tool_call` / `tool_result`** 两个构造函数，其余（帧序列化、队列）不变。

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

/** 构造 `tool_call` 事件（`round` 从 1 开始）。 */
export function toolCall(
  nodeId: string,
  toolName: string,
  args: Record<string, unknown>,
  round: number,
): RunEvent {
  return { event: 'tool_call', data: { nodeId, toolName, args, round } }
}

/** 构造 `tool_result` 事件（`result` 一律为字符串）。 */
export function toolResult(
  nodeId: string,
  toolName: string,
  result: string,
  elapsedMs: number,
  round: number,
): RunEvent {
  return { event: 'tool_result', data: { nodeId, toolName, result, elapsedMs, round } }
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

- `tool_call.args` 是**已解析的对象**（不是 JSON 字符串），因为事件要给前端直接展示；`tool_result.result` 是**字符串**，与工具返回值类型一致。
- `round` 由调用方传入，`events.ts` 不负责计数——计数器在引擎的 `rounds` 状态里。
- `formatSseFrame` / `RunEventQueue` 与阶段 4 完全相同，见 `04-执行引擎/02-LangGraph编译图-TS.md` §6 / §15。

---

## 8. 完整代码：引擎核心（engine.service.ts）

这是本篇的核心文件：**三份状态 + 条件边 + 回边 + 工具节点**。

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**

```ts
import { randomUUID } from 'node:crypto'

import { ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Graph, GraphNode, LlmNodeData } from '@mini-dify/contract'

import { validateGraph } from '../graph/graph.validator'
import { PrismaService } from '../prisma/prisma.service'
import { executeTool, hasTool } from '../tools/registry'
import { ToolError } from '../tools/tool-error'
import {
  formatSseFrame,
  nodeFinished,
  nodeStarted,
  RunError,
  RunEventQueue,
  runFailed,
  runFinished,
  runStarted,
  token,
  toolCall,
  toolResult,
  type RunEvent,
} from './events'
import { runEndNode } from './nodes/end.node'
import {
  buildInitialMessages,
  runLlmNode,
  runLlmStep,
  type ToolCallRequest,
} from './nodes/llm.node'
import { runStartNode } from './nodes/start.node'
import type { Pool } from './template'

/**
 * 变量池状态注解：`pool` 用「合并」reducer，节点返回 `{ pool: { <nodeId>: <output> } }`
 * 逐步累积；初始输入 `{ pool: { inputs } }` 先与默认空对象合并。
 *
 * 阶段 6 另加三份**按节点 id 隔离**的状态（同样用「合并」reducer，键为节点 id）：
 * - `messages`：启用了工具的 `llm` 节点自己的消息数组（多轮共享同一份）；
 * - `rounds`：该节点已执行的工具轮次数（从 1 开始计）；
 * - `toolCalls`：上一轮 LLM 产出的、尚未执行的工具调用（条件边的路由依据）。
 */
const RunState = Annotation.Root({
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  messages: Annotation<Record<string, BaseMessage[]>>({
    reducer: (previous: Record<string, BaseMessage[]>, update: Record<string, BaseMessage[]>) => ({
      ...previous,
      ...update,
    }),
    default: () => ({}),
  }),
  rounds: Annotation<Record<string, number>>({
    reducer: (previous: Record<string, number>, update: Record<string, number>) => ({
      ...previous,
      ...update,
    }),
    default: () => ({}),
  }),
  toolCalls: Annotation<Record<string, ToolCallRequest[]>>({
    reducer: (
      previous: Record<string, ToolCallRequest[]>,
      update: Record<string, ToolCallRequest[]>,
    ) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
})

type RunStateValue = {
  pool: Pool
  messages: Record<string, BaseMessage[]>
  rounds: Record<string, number>
  toolCalls: Record<string, ToolCallRequest[]>
}

/**
 * `StateGraph` 是「不可变类型累积」的构建器：动态按节点 id 建图时，其泛型参数无法静态收敛。
 * 这里用等价的结构类型做一次转换，仅约束用到的方法（运行时实现不变）。
 */
interface DynamicStateGraph {
  addNode(key: string, action: (state: RunStateValue) => Promise<Partial<RunStateValue>>): DynamicStateGraph
  addEdge(from: string, to: string): DynamicStateGraph
  addConditionalEdges(
    source: string,
    path: (state: RunStateValue) => string,
    pathMap: Record<string, string>,
  ): DynamicStateGraph
  compile(): {
    invoke(input: RunStateValue, config?: { recursionLimit?: number }): Promise<RunStateValue>
  }
}

/** 一次运行中由节点函数回写的共享状态。 */
interface RunContext {
  queue: RunEventQueue
  failedNodeId: string | null
  lastOutputs: Record<string, unknown>
}

/** 工具轮次的默认上限（可由环境变量 `MAX_TOOL_ROUNDS` 覆盖）。 */
const DEFAULT_MAX_TOOL_ROUNDS = 5

/** 工具轮次上限。 */
function maxToolRounds(): number {
  const raw = Number(process.env.MAX_TOOL_ROUNDS ?? DEFAULT_MAX_TOOL_ROUNDS)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_TOOL_ROUNDS
}

/**
 * 执行引擎（阶段 4 → 阶段 6）。
 *
 * 用 **LangGraph** 把契约里的 `Graph` 编译成 `StateGraph` 并按拓扑序执行（见 sse-events.md §4）：
 * 动态 `addNode(nodeId, fn)`、按 `edges` 连边、`START → start`、`end → END`。
 * 运行前先做预检（草稿非空、`validateGraph`、节点数据形状、工具名存在），不通过即 400（普通 JSON）。
 *
 * 阶段 6：**不新增节点类型**，`llm` 节点的 `data.tools` 非空时用
 * 「LLM 节点 + 工具 + 条件边 + 环」实现 ReAct：
 * - 额外加一个内部节点 `<llmId>__tools`，`addConditionalEdges(<llmId>, router, { tools, continue })`；
 * - `addEdge(<llmId>__tools, <llmId>)` 形成环；
 * - 从该 `llm` 节点出发的普通边被跳过（与条件边二选一），其下游作为 `continue` 分支。
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
   * 预检失败（草稿为空 / 图不合法 / 节点数据形状非法 / 未知工具）抛 `BadRequestException`
   * （普通 JSON 400）；归属不符抛 `NotFoundException`（404）。这些都发生在**打开流之前**，
   * 故不会污染 SSE 帧。
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
    const maxRounds = maxToolRounds()
    // 启用了工具的 llm 节点：别的照旧，这些节点改成「条件边 + 环」
    const toolNodes = graph.nodes.filter((node) => node.type === 'llm' && toolNamesOf(node).length > 0)
    try {
      const builder = new StateGraph(RunState) as unknown as DynamicStateGraph
      for (const node of graph.nodes) {
        builder.addNode(node.id, this.makeNodeAction(node, context, toolNodes))
      }
      for (const node of toolNodes) {
        builder.addNode(`${node.id}__tools`, this.makeToolsAction(node, context, maxRounds))
      }
      for (const edge of graph.edges) {
        // 启用了工具的 llm 节点改由条件边分派，跳过其普通出边（否则两者冲突）
        if (toolNodes.some((node) => node.id === edge.source)) {
          continue
        }
        builder.addEdge(edge.source, edge.target)
      }
      for (const node of toolNodes) {
        // 条件边 + 环：有 tool_calls 走内部工具节点，否则走原图下游（多条下游时取第一条）
        const downstream = firstDownstream(graph, node)
        builder.addConditionalEdges(
          node.id,
          (state: RunStateValue) => ((state.toolCalls[node.id] ?? []).length > 0 ? 'tools' : 'continue'),
          { tools: `${node.id}__tools`, continue: downstream },
        )
        builder.addEdge(`${node.id}__tools`, node.id)
      }
      const startNode = graph.nodes.find((node) => node.type === 'start') as GraphNode
      builder.addEdge(START, startNode.id)
      for (const node of graph.nodes) {
        if (node.type === 'end') {
          builder.addEdge(node.id, END)
        }
      }
      await builder.compile().invoke(
        { pool: { inputs }, messages: {}, rounds: {}, toolCalls: {} },
        // 每轮工具调用占 2 个 superstep，留足余量避免 LangGraph 的默认 25 步上限先触发
        { recursionLimit: Math.max(25, maxRounds * 2 + graph.nodes.length * 2 + 10) },
      )
      queue.emit(runFinished(runId, context.lastOutputs, Date.now() - startedAt))
    } catch (error) {
      queue.emit(runFailed(runId, context.failedNodeId, messageOf(error)))
    } finally {
      queue.close()
    }
  }

  /**
   * 生成某节点的执行动作（LangGraph node）。
   *
   * 未启用工具的节点：发出一次 `node_started` / `node_finished`。
   * 启用了工具的 `llm` 节点由 `makeLlmWithToolsAction` 处理（事件只在首/末轮发）。
   */
  private makeNodeAction(
    node: GraphNode,
    context: RunContext,
    toolNodes: GraphNode[],
  ): (state: RunStateValue) => Promise<Partial<RunStateValue>> {
    if (toolNodes.some((toolNode) => toolNode.id === node.id)) {
      return this.makeLlmWithToolsAction(node, context)
    }
    return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
      context.queue.emit(nodeStarted(node.id, node.type))
      try {
        const output = await this.executeNode(node, state.pool, context.queue)
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

  /**
   * 启用了工具的 `llm` 节点（ReAct 的「LLM + 条件判断」部分）。
   *
   * 首轮（该节点还没有消息）发 `node_started` 并构造 system/user 消息；
   * 之后每轮沿用该节点自己的消息数组。有 `tool_calls` → 只更新状态，由条件边转到
   * `<nodeId>__tools`；无 `tool_calls` → 这是最后一轮，发 `node_finished` 并写回变量池。
   */
  private makeLlmWithToolsAction(
    node: GraphNode,
    context: RunContext,
  ): (state: RunStateValue) => Promise<Partial<RunStateValue>> {
    return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
      const nodeId = node.id
      try {
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
        const messages = [...history, step.assistantMessage]
        if (step.toolCalls.length > 0) {
          return {
            messages: { [nodeId]: messages },
            toolCalls: { [nodeId]: step.toolCalls },
          }
        }
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

  /**
   * 内部工具节点 `<llmId>__tools`（ReAct 的「Act」部分）：执行上一轮的 `tool_calls`。
   *
   * 逐个发 `tool_call` → 执行 → 发 `tool_result` → 以 `ToolMessage` 追加回该节点的消息数组；
   * 任一工具失败即抛 `RunError`（文案见 error-messages.md §6.2），不会继续下一轮。
   */
  private makeToolsAction(
    node: GraphNode,
    context: RunContext,
    maxRounds: number,
  ): (state: RunStateValue) => Promise<Partial<RunStateValue>> {
    return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
      const nodeId = node.id
      const round = (state.rounds[nodeId] ?? 0) + 1
      try {
        if (round > maxRounds) {
          throw new RunError(`tool call rounds exceeded: ${maxRounds}`)
        }
        let messages = state.messages[nodeId] ?? []
        for (const call of state.toolCalls[nodeId] ?? []) {
          const startedAt = Date.now()
          let args: Record<string, unknown>
          try {
            args = parseArgsOrFail(call)
          } catch (error) {
            // 参数解析失败也仍先发 `tool_call`（args 为 `{}`），保持事件顺序可读
            context.queue.emit(toolCall(nodeId, call.name, {}, round))
            throw error
          }
          context.queue.emit(toolCall(nodeId, call.name, args, round))
          const result = await executeToolOrFail(call.name, args)
          context.queue.emit(toolResult(nodeId, call.name, result, Date.now() - startedAt, round))
          messages = [
            ...messages,
            new ToolMessage({ content: result, tool_call_id: call.id, name: call.name }),
          ]
        }
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

  /** 按节点类型分派执行（`llm` 节点在执行中穿插 `token` 事件）。 */
  private async executeNode(
    node: GraphNode,
    pool: Pool,
    queue: RunEventQueue,
  ): Promise<Record<string, unknown>> {
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

/** 取某节点的第一条下游边（没有则指向 `END`）。 */
function firstDownstream(graph: Graph, node: GraphNode): string {
  const edge = graph.edges.find((candidate) => candidate.source === node.id && candidate.target !== node.id)
  return edge === undefined ? END : edge.target
}

/** `llm` 节点声明的工具名列表（非数组或空数组视为未启用工具）。 */
function toolNamesOf(node: GraphNode): string[] {
  const data = (node.data ?? {}) as Record<string, unknown>
  const tools = data.tools
  if (!Array.isArray(tools)) {
    return []
  }
  return tools.filter((name): name is string => typeof name === 'string')
}

/** 严格解析工具参数：非 JSON、非对象一律 `invalid arguments`（见 error-messages.md §6.2）。 */
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

/** 执行工具并把内部失败归一为 `tool {name} failed: {reason}`。 */
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

/** 节点数据形状校验（引擎侧，见 error-messages.md §4.1 与 §6.1）。 */
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
      // §6.1：tools 里每个名字都必须已注册（预检即 400，不等运行时）
      if (Array.isArray(data.tools)) {
        for (const name of data.tools) {
          if (typeof name !== 'string' || !hasTool(name)) {
            errors.push(`llm node ${node.id} references unknown tool: ${String(name)}`)
          }
        }
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

**与阶段 4/5 的差异（读代码时先看这 5 处）**：

| 位置 | 阶段 4/5 | 阶段 6 |
| --- | --- | --- |
| `RunState` | 只有 `pool` | 多 `messages` / `rounds` / `toolCalls`（都是 `Record<nodeId, ...>`） |
| `runGraph` | 每条边 `addEdge` | 工具节点的出边**跳过**，改 `addConditionalEdges` + `addEdge(__tools, llm)` |
| `makeNodeAction` | 所有节点同一套壳 | 工具版 `llm` 转给 `makeLlmWithToolsAction` |
| `executeNode` | 同步 | **`async`**（`runLlmStep` 是异步的） |
| 预检 | 3 类 | 多一类「未知工具」`references unknown tool` |

---

## 9. 【技术教学 · 首次】ReAct 是什么

### 9.1 一句话

**ReAct = Reasoning + Acting**：让模型把「推理」与「调用外部工具」**交替**进行，而不是一次答复定生死。

```
循环（最多 N 轮）：
  ① Reason：把当前对话历史交给模型，让它决定「直接回答」还是「先调某个工具」
  ② Act   ：若它要求调工具，就真的执行，得到结果
  ③ Observe：把结果作为一条「工具消息」追加进历史
  ④ 回到 ①（模型现在能看到工具结果了）
退出条件：某轮模型不再要求调工具 → 它的文本就是最终答复
```

### 9.2 为什么必须「循环」

单次调用做不到，是因为：

- 模型**不知道**工具会返回什么（它只能「请求」）；
- 工具结果必须**回灌**成一条新消息，模型才能基于它继续推理；
- 有些任务需要**连续多个工具**（先算 A，再拿 A 去查 B），轮数事先不可知。

所以 ReAct 的本质不是「一个函数」，而是「**一段带状态的循环**」。这段循环用图的说法就是：**节点 + 条件边 + 回边**。

### 9.3 本项目里每一步落在哪

| ReAct 阶段 | 代码位置 | 关键数据 |
| --- | --- | --- |
| Reason | `makeLlmWithToolsAction` → `runLlmStep` | `messages[nodeId]`、`bindTools` |
| 判断 | 条件边的 router | `toolCalls[nodeId].length > 0` |
| Act + Observe | `makeToolsAction` | `executeTool`、`ToolMessage` |
| 计数 | `makeToolsAction` 的 `round` | `rounds[nodeId]` |

> 记住：**ReAct 不是某个库的专利**，它就是「模型请求工具 → 执行 → 回灌 → 再请求」的循环控制。LangGraph 只是把这个控制流**画出来**。

---

## 10. 【技术教学 · 首次】为什么「不新增 Agent 节点」

### 10.1 总纲的硬性约束

`docs/00-开发总纲.md` §3.5 明确写着：

> **Agent：不加「Agent 节点」也行——LLM 节点 + 工具 + 条件边即可构成 ReAct 循环（这正是学习价值所在）。**

所以本项目的图里 `GraphNode.type` 仍然只有 `start` / `llm` / `end` 三种（阶段 6 不改契约的节点枚举）。Agent 能力通过 `llm.data.tools` 这个**配置项**开启。

### 10.2 为什么这是一个好设计（四条理由）

| 理由 | 说明 |
| --- | --- |
| **复用已有节点** | `llm` 节点已经拥有 `prompt` / `system` / `model` / `temperature` / `maxTokens`；Agent 需要的「提示词 + 模型 + 工具」与它**完全重叠**。再加一个 Agent 节点，等于把同一批配置复制一遍 |
| **图模型更简单** | 节点枚举是契约的一部分：新增类型要同时改 `openapi.yaml`、`GraphNode` 联合类型、两端校验器、前端画布节点面板、两套引擎。收益却只是「换个名字」 |
| **学习重点在循环机制** | 本阶段要学的是 **条件边 / 回边 / 状态隔离 / 轮次保护**——这些是任何 Agent 框架的共性。若把循环藏进一个「Agent 节点」内部，恰恰把最有价值的部分封装掉了 |
| **前端零改动** | 画布上仍是一个 LLM 节点，只是在配置面板里多勾几个工具（工具选择属于节点配置，不是新节点） |

### 10.3 与阶段 11 的「自主 Agent」不是一回事

阶段 11 会做**独立于工作流**的 `AgentModule`（Run / 事件流 / 记忆 / 上下文压缩）。那是**自主 Agent 运行时**，不塞进工作流图。本阶段做的是「**工作流里的一个 LLM 节点会调工具**」，两者边界清晰：

- 本篇：图内 ReAct，节点是图的一部分，受图的拓扑与超步约束；
- 阶段 11：独立 Run 模型，没有图、没有连线。

> 一句话：**「Agent 节点」是把循环封装成一个黑盒；「LLM + tools + 条件边」是把循环摊开给你看。教学项目选后者。**

---

## 11. 【技术教学 · 首次】条件边 `addConditionalEdges`

### 11.1 与普通边 `addEdge` 的本质区别

```ts
// 普通边：建图时就定死
builder.addEdge('llm_1', 'end_1')          // llm_1 跑完，永远去 end_1

// 条件边：运行时才决定去哪
builder.addConditionalEdges(
  'llm_1',                                  // 从哪出发
  (state) => ...,                           // router：跑完 llm_1 后调用，返回「分支名」
  { tools: 'llm_1__tools', continue: 'end_1' },  // 分支名 → 目标节点
)
```

| | `addEdge` | `addConditionalEdges` |
| --- | --- | --- |
| 决定时机 | **建图时**（静态） | **运行时**（source 节点每次跑完） |
| 目标个数 | 固定 1 个 | 由 router 返回值从 `pathMap` 选 1 个 |
| 依赖 | 无 | router **读当前 state** |
| 典型用途 | 直线拓扑 | 分支、循环出口判断 |

### 11.2 参数形状

```ts
addConditionalEdges(
  source: string,                       // 起点节点 id
  router: (state) => string,            // 返回 pathMap 的键
  pathMap: Record<string, string>,      // 分支名 → 目标节点 id（或 END）
)
```

- **`router` 的返回值必须是 `pathMap` 里存在的键**；实测返回未知键会抛：`Branch condition returned unknown or null destination`。
- **`pathMap` 的值必须是已 `addNode` 的节点 id**（或虚拟的 `END`）。本项目先 `addNode(llm_1__tools)`、再连条件边，读起来也更顺。
- `router` 可以返回数组做「多分支并行」，本阶段不用。

### 11.3 本项目的 router 读什么

```ts
(node.id) =>
  (state: RunStateValue) =>
    (state.toolCalls[node.id] ?? []).length > 0 ? 'tools' : 'continue'
```

它读的是 **`toolCalls[nodeId]`**——即「这个 llm 节点**本轮**产出的工具调用列表」。

- 为什么必须放进 state？因为 `router` 是**独立函数**，由 LangGraph 在节点执行完之后调用；它拿不到 `makeLlmWithToolsAction` 的局部变量，**只能读 state**。这就是 `toolCalls` 这个 channel 存在的根本原因。
- 为什么不是读 `rounds`？`rounds` 只表示「已经执行过几轮工具」，它**不告诉你这一轮模型还想不想再调工具**。判断下一步走向，必须看**本轮**的 `tool_calls`。

### 11.4 条件边只在「工具版 llm」上生效

`runGraph` 只为 `toolNodes`（`type === 'llm' && tools.length > 0`）添加条件边。未配工具的 `llm` 节点**仍然走普通边**，行为与阶段 5 完全一致 —— 这是「按节点开启、不影响其它节点」的开关式设计。

---

## 12. 【技术教学 · 首次】「环」是 LangGraph 的一等公民

### 12.1 回边就是普通边

```ts
builder.addEdge(`${node.id}__tools`, node.id)   // llm_1__tools → llm_1
```

这条边和 `start_1 → llm_1` 是同一种东西。**LangGraph 允许图里有环**，只要：

- 环上有**条件边**作为出口（否则永远出不来）；
- `recursionLimit` 足够大（否则框架自己会中止）。

### 12.2 环的每一圈发生了什么

```
第 1 圈：llm_1（Reason，产出 tool_calls） → llm_1__tools（Act + Observe，round=1）
第 2 圈：llm_1（带着 ToolMessage 再 Reason）→ 若还要工具 → llm_1__tools（round=2）
…
最后一圈：llm_1 不再产出 tool_calls → continue → end_1
```

每一圈里 state 的变化：

```
messages[llm_1]  ← 初始 [system?, user]（有 system 才加）
                 ← 第 1 圈后 [..., assistant(tool_calls), tool(result)]
                 ← 第 2 圈后 [..., assistant(tool_calls), tool(result), ...]
rounds[llm_1]    ← 0 → 1 → 2
toolCalls[llm_1] ← [] → [call1] → [] → [call2] → []
```

### 12.3 与「普通 for 循环」的区别（必读）

| 维度 | 手写 `for` / `while` | LangGraph 的环 |
| --- | --- | --- |
| 状态存放 | 函数局部变量 | **channel**（`messages` / `rounds` / `toolCalls`），框架负责合并 |
| 循环边界 | 代码里写死的 `if` / `break` | **条件边**（数据驱动，改图不改代码） |
| 执行单位 | 一次函数调用栈 | **superstep**：每个节点执行算一步，边决定下一步 |
| 中断 / 恢复 | 很难（栈没法序列化） | 每个 superstep 边界天然可停；接 **checkpointer** 即可持久化、断点续跑（本项目暂未接，阶段 9/11 的扩展点） |
| 可观测 | 自己插桩 | 框架有 stream / callback（本项目仍用自建 `RunEventQueue`，见阶段 4 · 02 §15） |
| 上限 | 自己写计数器 | `recursionLimit`（框架层）+ `MAX_TOOL_ROUNDS`（业务层）双保险 |

**「状态在 checkpointer 中流转」是什么意思**：LangGraph 的执行模型是 Pregel 式的超步——每一步的输入是上一步的 state，输出是 state 的增量。如果把每一步的 state 存下来（checkpointer），就能在任意一步之后暂停、恢复、甚至换台机器继续。手写 `for` 循环的局部变量做不到这一点（栈不可序列化）。本阶段**没有接** checkpointer，但代码结构已经为它留好了位置：所有跨轮信息都在 state 里，没有藏在闭包里。

### 12.4 `recursionLimit` 为什么必须调大

LangGraph 默认上限是 **25 个 superstep**。每轮 ReAct 占 **2 步**（`llm` + `__tools`），再加上 `start` / `end` 与其它节点，5 轮就可能逼近默认值。代码里：

```ts
{ recursionLimit: Math.max(25, maxRounds * 2 + graph.nodes.length * 2 + 10) }
```

- `maxRounds * 2`：工具轮；
- `graph.nodes.length * 2`：原图节点 + 内部 `__tools` 节点各算一步的余量；
- `+10`：`START` / `END` / 条件边判断的余量。

> 如果不调大，可能在 `MAX_TOOL_ROUNDS` 触发前先撞上 LangGraph 的 `GraphRecursionError`，而那个文案**不是**契约规定的 `tool call rounds exceeded`，两端就对不齐了。

---

## 13. 【技术教学 · 首次】关键陷阱：普通边必须跳过

### 13.1 冲突从哪来

原图里有一条 `llm_1 → end_1` 的边。如果你**既**保留它，**又**给 `llm_1` 加条件边，那么 `llm_1` 就有了两种出边：

- 普通边：跑完**一定**去 `end_1`；
- 条件边：跑完**可能**去 `llm_1__tools`。

别以为 LangGraph 会替你报错——**它不会**。普通边会被当成**又一条无条件分支**，于是 `llm_1` 跑完，条件边选的节点与普通边的目标**都会执行**。

本仓库实测（一个节点同时有普通边 `a → b` 与条件边 `a → c`）：

```
ran = a,b,c        ← 两条分支都跑了，没有冲突报错
```

放到本项目会是什么后果：

- `llm_1` 第一轮刚产出 `tool_calls`，`end_1` 就**提前执行**（此时 `llm_1` 还没写 `pool`，`{{ llm_1.text }}` 会渲染失败或拿到中途文本）；
- 同时 `llm_1__tools` 也在跑，之后回边又回到 `llm_1`，可能**再次走到 `end_1`**；
- 事件序列里 `node_started/end` 重复、顺序错乱，与契约对不上。

所以必须**在建图时把这条普通边跳过**，只保留条件边。

### 13.2 本项目的做法：跳过，并把下游「借」给条件边

```ts
for (const edge of graph.edges) {
  // 启用了工具的 llm 节点改由条件边分派，跳过其普通出边（否则两者冲突）
  if (toolNodes.some((node) => node.id === edge.source)) {
    continue
  }
  builder.addEdge(edge.source, edge.target)
}
```

跳过之后，原来的下游不能丢——它变成条件边的 `continue` 分支：

```ts
const downstream = firstDownstream(graph, node)
builder.addConditionalEdges(node.id, router, {
  tools: `${node.id}__tools`,
  continue: downstream,
})
```

`firstDownstream` 的实现：

```ts
function firstDownstream(graph: Graph, node: GraphNode): string {
  const edge = graph.edges.find(
    (candidate) => candidate.source === node.id && candidate.target !== node.id,
  )
  return edge === undefined ? END : edge.target
}
```

- **排除自环**（`target !== node.id`）：免得把「自己」当成下游；
- **没有下游 → `END`**：允许工具版 `llm` 是图的终点；
- **多条下游只取第一条**：这是本阶段的**已知简化**（原图若在 `llm` 后分叉，条件边只会走 `edges` 数组里的第一条）。要做真正的多分支，需要阶段 8 的「条件节点」来提供完整路由。

### 13.3 怎么证明「环真的建成了」

编译后对图做内省（读取编译产物的图结构）：

```
source='llm1'          target='end'            conditional=True
source='llm1'          target='llm1__tools'    conditional=True
source='llm1__tools'   target='llm1'           conditional=False
```

解读：

- `llm1` 有**两条条件出边**（`continue` → `end`、`tools` → `llm1__tools`）；
- `llm1__tools` 有一条**普通出边**回到 `llm1`——这就是环；
- 原图的普通边 `llm1 → end` **没有**作为 `conditional=False` 出现，说明「跳过」生效了。

> 如果你看到 `source='llm1' target='end' conditional=False`，说明忘了跳过普通边——循环永远进不去。

---

## 14. 【技术教学 · 首次】按节点隔离的状态：`messages` / `rounds` / `toolCalls`

### 14.1 三个注解

```ts
messages: Annotation<Record<string, BaseMessage[]>>({
  reducer: (previous, update) => ({ ...previous, ...update }),
  default: () => ({}),
}),
rounds: Annotation<Record<string, number>>({ ... }),
toolCalls: Annotation<Record<string, ToolCallRequest[]>>({ ... }),
```

三个 channel 都是 **`Record<nodeId, ...>`**，而不是「单个数组 / 单个数字」。（上面是示意，`rounds` / `toolCalls` 的完整写法与 `messages` 同构，见 §8 的完整文件。）

### 14.2 为什么必须是 `Record<nodeId, ...>`

因为一张图里可能同时存在**多个工具版 `llm` 节点**：

```
start_1 → llm_A（工具：calculator）→ llm_B（工具：http_get）→ end_1
```

它们的对话历史、轮次数、待执行工具**完全独立**：

- `llm_A` 的 `messages` 不能混进 `llm_B` 的历史（否则 B 会看到 A 的 system prompt 和工具结果）；
- `llm_A` 的 `rounds` 不能算到 B 头上；
- 条件边的 router 是**按节点**读 `toolCalls[node.id]` 的。

如果只用一个全局 `messages` 数组：

| 问题 | 后果 |
| --- | --- |
| 两个 llm 共享历史 | 第二个节点看到第一个节点的 system / prompt，输出被污染 |
| 两个 llm 共享 `toolCalls` | 条件边无法判断「**我**这一轮」要不要工具 |
| 两个 llm 共享 `rounds` | 一个节点耗尽了所有轮次配额 |

### 14.3 reducer 的语义：按 key 覆盖

```ts
(previous, update) => ({ ...previous, ...update })
```

- 键是节点 id，所以 `llm_A` 的更新**不会覆盖** `llm_B` 的键；
- 同一个节点再次更新时，**整个数组被替换**（`messages[nodeId]` 是新数组），这正是我们要的——历史由节点自己维护并整体回写。

### 14.4 「首轮」的判定

```ts
const firstRound = state.messages[nodeId] === undefined
```

- 初始 state 传的是 `messages: {}`，所以工具版 `llm` 第一次被执行时 `undefined` → 构造初始消息、发 `node_started`；
- 之后 `messages[nodeId]` 已存在 → 沿用历史、**不再发** `node_started`。

> 这是一个**隐式约定**：不要图省事在初始 state 里给每个 `llm` 节点塞 `[]`，否则首轮会被误判为「非首轮」，`node_started` 就永远不发了。

---

## 15. 【技术教学 · 首次】`ToolMessage` 的作用

### 15.1 它是什么

`ToolMessage` 是 LangChain / OpenAI 消息协议里的「**工具角色**」消息（`role: "tool"`）：

```ts
new ToolMessage({
  content: result,            // 工具返回值（字符串）
  tool_call_id: call.id,      // 对应哪一次调用
  name: call.name,            // 工具名（可选，便于阅读）
})
```

### 15.2 为什么不能只把结果拼成普通文本

模型不是「读一个字符串」就能理解工具结果的。OpenAI 协议要求：

```
assistant: { tool_calls: [ {id: "call_x", function: {name, arguments}} ] }
tool:      { tool_call_id: "call_x", content: "14" }
```

- `assistant` 消息里的 `tool_calls` 是**请求**；
- `tool` 消息里的 `tool_call_id` 是**回执编号**；
- 两者**必须成对出现**：少了 assistant 的 `tool_calls`，或 `tool_call_id` 对不上，下一次请求的消息序列就不合法（多数 provider 直接 400）。

所以 `makeToolsAction` 里：

```ts
messages = [...messages, new ToolMessage({ content: result, tool_call_id: call.id, name: call.name })]
```

把结果以「工具角色」追加进**该节点自己的**历史；下一轮 `runLlmStep` 把整段历史发给模型，模型才知道「我刚才要的计算，结果是 14」。

### 15.3 `AIMessage` 也必须回填

`runLlmStep` 返回的 `assistantMessage` 包含 `tool_calls`：

```ts
new AIMessage({
  content: text,
  tool_calls: toolCalls.map((call) => ({ id: call.id, name: call.name, args: parseArgsLeniently(call.argsText) })),
})
```

`makeLlmWithToolsAction` 每轮都做 `const messages = [...history, step.assistantMessage]`——**请求与回执成对**，历史才合法。

---

## 16. 【技术教学 · 首次】`bindTools`：让模型「知道」有工具

### 16.1 不 bind 会怎样

```ts
const runnable = toolDefs.length > 0 ? client.bindTools(toolDefs) : client
```

- **不 bind**：请求里没有 `tools` 字段，模型只能输出文本；它可能嘴里说「我要调用 calculator」，但**不会**返回结构化的 `tool_calls`，引擎也就无从执行。
- **bind**：`tools` 字段随每次请求发出（含 `name` / `description` / JSON Schema `parameters`），模型就能返回 `tool_calls`。

### 16.2 工具定义从哪来

```ts
function resolveToolDefs(names: string[] | undefined): ToolDefinition[] {
  if (!Array.isArray(names) || names.length === 0) return []
  const definitions: ToolDefinition[] = []
  for (const name of names) {
    const definition = getToolDefinition(name)
    if (definition !== undefined) definitions.push(definition)
  }
  return definitions
}
```

- 契约里 `data.tools` 只是**字符串名字**；定义从注册表 `TOOL_DEFINITIONS` 查。
- 未注册的名字在**预检**就 400（`llm node {id} references unknown tool: {name}`），所以这里只可能取到已注册的。
- 这里的 `ToolDefinition` 直接就是 OpenAI function 的形状，不需要二次转换。

### 16.3 流式 `tool_calls` 为什么要「聚合」

OpenAI 流式返回的工具调用是**碎片**：

```
chunk1: { index: 0, id: "call_abc", name: "calculator", args: "{\"expr" }
chunk2: { index: 0, name: "",           args: "ession\":\"2+" }
chunk3: { index: 0, name: "",           args: "3*4\"}" }
```

于是代码按 `index` 建 Map：

```ts
const partial = new Map<number, { id: string; name: string; argsText: string }>()
```

- `id`：只在非空时覆盖（通常第一片带）；
- `name`：**累加**（可能被切开）；
- `args`：`argsText +=` 累加字符串，**不解析**（等聚合完再解析）；
- 最后按 `index` 排序，得到稳定的调用顺序（并行工具调用也各占一个 index）。

### 16.4 两种参数解析：宽松 vs 严格

| 位置 | 函数 | 策略 | 为什么 |
| --- | --- | --- | --- |
| 构造 `AIMessage` | `parseArgsLeniently` | 解析失败 → `{}` | 历史必须能构造出来，否则连下一轮都发不出去 |
| 真正执行工具 | `parseArgsOrFail` | 解析失败 → `RunError('tool {name} failed: invalid arguments')` | 错误要按契约在正确的位置报出（`tool_call` 之后 → `run_failed`） |

这个「**先宽松构造历史、后严格执行**」的分工，保证了错误发生时的事件顺序仍然是「`tool_call`（args 为 `{}`）→ `run_failed`」，前端不会看到「凭空冒出的失败」。

---

## 17. 【技术教学 · 首次】轮次保护 `MAX_TOOL_ROUNDS`

### 17.1 为什么必须有上限

ReAct 的退出条件是「模型不再要工具」，而这个条件**由模型自己决定**。模型可能：

- 反复要同一个工具（死循环）；
- 每轮都「再确认一下」；
- 被提示词诱导无限调用。

每一轮都是一次**真实 LLM 请求 + 工具执行**：没有上限 = 账单和延迟都不可控，SSE 流可能永远不结束。

### 17.2 实现

```ts
const DEFAULT_MAX_TOOL_ROUNDS = 5

function maxToolRounds(): number {
  const raw = Number(process.env.MAX_TOOL_ROUNDS ?? DEFAULT_MAX_TOOL_ROUNDS)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_TOOL_ROUNDS
}
```

- 环境变量覆盖，默认 **5**；
- 非正整数（`0`、`-1`、`abc`、`1.5`）一律**回退默认 5**，避免「配错就无限跑」。

计数发生在**工具节点**里（只有真正执行了一轮工具才 +1）：

```ts
const round = (state.rounds[nodeId] ?? 0) + 1
if (round > maxRounds) {
  throw new RunError(`tool call rounds exceeded: ${maxRounds}`)
}
```

- 第 1 轮工具：`round = 1`，通过；
- 第 `maxRounds + 1` 轮：抛错 → `runGraph` 捕获 → `run_failed`（`nodeId` 是该 `llm` 节点）；
- 因为异常发生在工具节点里，`node_finished` **不会**发出（与契约一致）。

### 17.3 三层保护，各司其职

| 层 | 上限 | 作用 |
| --- | --- | --- |
| 模型侧 | —— | 模型自己决定不再调用 |
| 业务侧 | `MAX_TOOL_ROUNDS`（默认 5） | 保证文案是契约规定的 `tool call rounds exceeded: {max}` |
| 框架侧 | `recursionLimit` | 防止图本身无限转；但它的错误文案不符合契约，所以要**先**被业务侧兜住 |

---

## 18. 【技术教学 · 首次】工具轮的事件语义

### 18.1 `node_started` / `node_finished` 各只发一次

工具轮发生在 **`llm` 节点的内部循环**里（图上是环，但对事件观察者来说仍是同一个节点）：

```ts
const firstRound = state.messages[nodeId] === undefined
if (firstRound) {
  context.queue.emit(nodeStarted(nodeId, 'llm'))   // ← 只在第一轮
}
...
if (step.toolCalls.length > 0) {
  return { messages: ..., toolCalls: ... }          // ← 不发 node_finished
}
context.queue.emit(nodeFinished(nodeId, 'llm', output))  // ← 只在最后一轮
```

所以事件序列是：

```
node_started(llm)
  token*                 ← 工具调用轮的文本（通常为空）
  tool_call(round=1)
  tool_result(round=1)
  token*
  tool_call(round=2)
  tool_result(round=2)
  token*                 ← 最后一轮文本
node_finished(llm)       ← 只此一次
```

**为什么不能每轮都发**：`node_started` / `node_finished` 的语义是「**节点**开始/结束」，不是「**轮**开始/结束」。`__tools` 是**内部实现细节**，不能作为独立节点出现在事件里（它的 `nodeId` 是 `llm_1__tools`，前端根本不认识）。

### 18.2 `round` 从 1 开始

```ts
toolCall(nodeId, call.name, args, round)
toolResult(nodeId, call.name, result, elapsed, round)
```

- 同一轮里的多个工具调用，`round` **相同**（并行工具调用属于同一轮）；
- 本实现是**串行执行**同一轮的多个工具：`tool_call(a)` → `tool_result(a)` → `tool_call(b)` → `tool_result(b)`，两者 `round` 都是 1；
- 前端只要按 `round` 分组，就能把「同一轮的并行调用」画在一起。

### 18.3 失败时的事件

| 失败点 | 已发出的事件 | 随后 |
| --- | --- | --- |
| 参数解析失败 | `tool_call`（`args` 为 `{}`） | `run_failed`（`tool {name} failed: invalid arguments`） |
| 工具执行失败 | `tool_call`（真实 args） | `run_failed`（`tool {name} failed: {reason}`） |
| 轮次超限 | 无（进入工具节点即检查） | `run_failed`（`tool call rounds exceeded: {max}`） |

三种情况都**不发**该 `llm` 节点的 `node_finished`。

---

## 19. 实测

以下结果均用 mock-LLM（`LLM_MODEL=mock-model`）实跑得到。

### 19.1 单工具

图：`start_1 → llm1 → end_1`，`llm1.data.tools = ["calculator"]`，prompt 含 `[[call:calculator:{"expression":"2+3*4"}]]`。

SSE（节选，省略 `run_started` / `node_started`）：

```
event: tool_call
data: {"nodeId":"llm1","toolName":"calculator","args":{"expression":"2+3*4"},"round":1}

event: tool_result
data: {"nodeId":"llm1","toolName":"calculator","result":"14","elapsedMs":0,"round":1}

event: token
data: {"nodeId":"llm1","text":"answe"}
event: token
data: {"nodeId":"llm1","text":"r: 14"}

event: node_finished
data: {"nodeId":"llm1","nodeType":"llm","output":{"text":"answer: 14","model":"mock-model","usage":{"promptTokens":60,"completionTokens":10,"totalTokens":70}}}
```

读法：

- 工具轮本身没有文本，所以 `tool_call` / `tool_result` 先出现；
- 最后一轮模型给出 `answer: 14`，按 mock 的 5 码点切片 → `"answe"` + `"r: 14"`；
- `node_started` 只有一次、`node_finished` 只有一次，都在**节点**层面。

### 19.2 多轮

prompt：`[[call:calculator:{"expression":"1+1"}]] [[next]] [[call:calculator:{"expression":"2+2"}]]`

| 事件 | 关键字段 |
| --- | --- |
| 第 1 个 `tool_call` | `expression: "1+1"`、`round: 1` |
| 第 1 个 `tool_result` | `result: "2"`、`round: 1` |
| 第 2 个 `tool_call` | `expression: "2+2"`、`round: 2` |
| 第 2 个 `tool_result` | `result: "4"`、`round: 2` |

说明回边真的把控制权交回了 `llm1`，且 `rounds[llm1]` 从 0→1→2。

### 19.3 同一轮并行

prompt：`[[call:calculator:{"expression":"6*7"}]] [[call:get_current_time:{}]]`

| 事件 | 关键字段 |
| --- | --- |
| `tool_call` calculator | `{"expression":"6*7"}`、`round: 1` |
| `tool_result` calculator | `"42"`、`round: 1` |
| `tool_call` get_current_time | `{}`、`round: 1` |
| `tool_result` get_current_time | `"2026-10-20T16:15:57.595Z"`、`round: 1` |

两个工具共享 `round: 1` —— 它们属于**同一轮**的并行请求（实现上是串行执行，语义上是同一轮）。

### 19.4 图内省（环真的存在）

```
source='llm1'          target='end'            conditional=True
source='llm1'          target='llm1__tools'    conditional=True
source='llm1__tools'   target='llm1'           conditional=False
```

与 §13.3 完全一致：两条条件出边 + 一条回边，原普通边已被跳过。

### 19.5 轮次超限

`MAX_TOOL_ROUNDS=1` + 两轮工具：

```
event: run_failed
data: {"runId":"...","nodeId":"llm1","message":"tool call rounds exceeded: 1"}
```

### 19.6 回归：不配 `tools`

同一张 `start → llm → end` 图，`llm1` 不配 `tools`：token 序列仍是

```
["echo:"," Hell","o min","i-dif","y"]
```

`node_finished.output.usage` 仍是 `{promptTokens:15, completionTokens:21, totalTokens:36}`。说明未启用工具的分支**完全没有被阶段 6 改动影响**。

---

## 20. 验收自测

| 检查项 | 命令 / 做法 | 预期 |
| --- | --- | --- |
| 契约已编译 | `pnpm run build:contract` | 无报错 |
| 引擎可编译 | `pnpm --filter @mini-dify/api-ts build` | 无报错 |
| 单工具 | §19.1 的图与 prompt，`curl.exe -N` | `tool_call` → `tool_result` → `token` → `node_finished` |
| 工具结果进历史 | 看第二轮请求是否带 `role:"tool"` | mock 返回 `answer: 14`（说明它读到了 ToolMessage） |
| 多轮 | §19.2 的 prompt | `round` 依次为 1、2 |
| 并行 | §19.3 的 prompt | 两个 `tool_call` 的 `round` 都是 1 |
| 环存在 | 编译后内省 | 两条 `conditional=True` + 一条 `conditional=False` 回边 |
| 普通边已跳过 | 内省 | 没有 `llm1 → end conditional=False` |
| 轮次上限 | `MAX_TOOL_ROUNDS=1` + 两轮 prompt | `run_failed "tool call rounds exceeded: 1"` |
| 未知工具 | `tools: ["nope"]` | **开流前** 400：`llm node llm1 references unknown tool: nope` |
| 工具失败 | prompt 用 `[[call:calculator:{"expression":"2+"}]]` | `tool_call` 后 `run_failed "tool calculator failed: invalid arguments"` |
| 无 `node_finished` | 失败用例 | 流内**没有**该 `llm` 的 `node_finished` |
| 回归 | 去掉 `tools` | token 序列与 usage 同 §19.6 |

**可复现的最小命令序列**（Windows PowerShell）：

```powershell
# 1) mock-LLM
node tools/mock-llm/server.mjs

# 2) 另一个终端：让 api-ts 指向 mock（或直接改 apps/api-ts/.env）
$env:LLM_BASE_URL = "http://127.0.0.1:11435/v1"
$env:LLM_API_KEY = "test"
$env:LLM_MODEL = "mock-model"
pnpm --filter @mini-dify/api-ts start:dev

# 3) 按阶段 3 的方式把图 PUT 成草稿，然后运行
curl.exe -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{"inputs":{}}'
```

图 JSON 示例（单工具）：

```jsonc
{
  "version": "1",
  "nodes": [
    { "id": "start_1", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "inputs": [] } },
    { "id": "llm1", "type": "llm", "position": { "x": 120, "y": 0 },
      "data": {
        "title": "LLM",
        "model": "mock-model",
        "prompt": "[[call:calculator:{\"expression\":\"2+3*4\"}]]",
        "tools": ["calculator"]
      } },
    { "id": "end_1", "type": "end", "position": { "x": 240, "y": 0 },
      "data": { "outputs": [{ "name": "result", "value": "{{ llm1.text }}" }] } }
  ],
  "edges": [
    { "id": "e1", "source": "start_1", "target": "llm1" },
    { "id": "e2", "source": "llm1", "target": "end_1" }
  ]
}
```

---

## 21. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **同时保留普通边与条件边** | **不报错**，但下游被提前执行、分支重复（实测两条都跑），事件序列错乱 | 遍历 `edges` 时跳过 `source` 是工具版 `llm` 的边，把下游交给 `continue`（§13.1） |
| **忘了回边** | 工具执行完图就结束了 | `addEdge(<llmId>__tools, <llmId>)` 不能少（§12.1） |
| **`pathMap` 指向未注册的节点** | 编译或运行时报错（找不到目标节点） | 先 `addNode(llm__tools)` 再 `addConditionalEdges`（§11.2） |
| **router 读错字段** | 每轮都走 `tools`（死循环）或永远不走 `tools` | router 读 `state.toolCalls[node.id]`，不是 `rounds`（§11.3、§17） |
| **`toolCalls` 用全局数组** | 多个工具版 `llm` 互相串线 | 三份状态都要 `Record<nodeId, ...>`（§14） |
| **初始 state 给 `messages[id] = []`** | 首轮被当成非首轮，`node_started` 缺失 | 初始传 `messages: {}`，用 `=== undefined` 判首轮（§14.4） |
| **工具调用轮就发 `node_finished`** | 事件序列出现多个 `node_finished` | 只有 `step.toolCalls.length === 0` 时才发（§18.1） |
| **没回填 `assistantMessage`** | 下一轮 provider 400（`tool` 消息没有对应的 `tool_calls`） | `[...history, step.assistantMessage]` 必须做（§15.3） |
| **`ToolMessage` 缺 `tool_call_id`** | 同上，provider 报错 | `tool_call_id: call.id` 必须与 assistant 的 `id` 一致（§15.1） |
| **没调 `bindTools`** | 模型永远不返回 `tool_calls`，只会「嘴上说要调」 | `client.bindTools(resolveToolDefs(data.tools))`（§16.1） |
| **`name` 用赋值而非累加** | 工具名被流式分片截断（如 `calc`） | `current.name = current.name + chunk.name`（§16.3） |
| **流式期间就解析 args** | 参数 JSON 不完整 → 解析失败 | 先聚合 `argsText`，执行时再 `parseArgsOrFail`（§6、§16.4） |
| **没有轮次上限** | 流永远不结束 / 费用失控 | `MAX_TOOL_ROUNDS`（默认 5）+ `recursionLimit`（§12.4、§17） |
| **`recursionLimit` 没调大** | 先撞 `GraphRecursionError`，文案不符合契约 | 按 `max(25, maxRounds*2 + nodes*2 + 10)` 计算（§12.4） |
| **`MAX_TOOL_ROUNDS=0`** | 意外回退到 5 | 只接受正整数，其它值回退默认（§17.2） |
| **多下游只走第一条** | 原图在 `llm` 后分叉时行为不符预期 | 本阶段已知简化；完整分支等阶段 8 的条件节点（§13.2） |

---

## 22. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **ReAct**（Reason + Act 交替循环）：想 → 调工具 → 看结果 → 再想，直到不再需要工具 | **首次教学于本篇** |
| **为什么不新增「Agent 节点」**：复用 `llm` 节点 + `data.tools` + 条件边；图模型更简单、学习重点在循环机制、前端零改动 | **首次教学于本篇** |
| **LangGraph 条件边 `addConditionalEdges`**：`(from, router, { 分支名: 目标 })`；与 `addEdge` 的「运行时决定 vs 静态连线」区别；router 读 `state.toolCalls[nodeId]` | **首次教学于本篇** |
| **「环」是 LangGraph 的一等公民**：回边 `addEdge(__tools, llm)`；superstep 执行模型；与手写 for 循环的区别（状态在 channel / checkpointer / 可中断恢复）；`recursionLimit` | **首次教学于本篇** |
| **关键陷阱：跳过工具版 llm 的普通出边**：否则与条件边冲突；下游通过 `firstDownstream` 借给 `continue` 分支（多条下游取第一条为已知简化） | **首次教学于本篇** |
| **按节点隔离的状态**：`messages` / `rounds` / `toolCalls` 三个 `Annotation<Record<nodeId, ...>>`，多 llm 节点互不干扰；按 key 覆盖的 reducer | **首次教学于本篇** |
| **`ToolMessage` 的工具角色语义**：结果以 `role:"tool"` 追加，`tool_call_id` 与 assistant 的 `tool_calls` 成对；必须回填 `AIMessage` | **首次教学于本篇** |
| **`bindTools`**：把 `ToolDefinition`（JSON Schema）绑定给模型才会返回 `tool_calls`；流式 `tool_call_chunks` 按 `index` 聚合（`name` 累加、args 延后解析） | **首次教学于本篇** |
| **轮次保护 `MAX_TOOL_ROUNDS`**：默认 5、env 覆盖、非正整数回退；超限 `tool call rounds exceeded: {max}` | **首次教学于本篇** |
| **工具轮事件语义**：`node_started` / `node_finished` 每个 llm 节点各只一次；`tool_call` / `tool_result` 带 `round`（并行同 round）；失败不发 `node_finished` | **首次教学于本篇** |
| **引擎实现（TS · 阶段 6）**：`<llmId>__tools` 内部节点、`ToolMessage` 回填、`parseArgsOrFail` / `executeToolOrFail` 的错误归一、预检「未知工具」400 | 本篇 |

> 已在前序篇教学、本篇仅引用不重讲的：LangGraph 心智模型 / `Annotation` / reducer / 动态建图 / `compile`-`invoke` 见 `04-执行引擎/02-LangGraph编译图-TS.md`；SSE 帧格式 / 事件协议 / 双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`；`ChatOpenAI` 与 `.stream()` 见 `05-LLM节点/02-真实模型调用与流式.md`；`mapLlmError` 与 6 条文案见 `05-LLM节点/03-LLM错误映射.md`；mock-LLM 与无密钥自测见 `05-LLM节点/04-mock-LLM与无密钥自测.md`；工具契约 / 注册表 / 内置工具实现见本阶段第 `01` 篇。
