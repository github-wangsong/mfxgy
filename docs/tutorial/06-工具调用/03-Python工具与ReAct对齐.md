# 03 · Python 工具与 ReAct 对齐

> 所属：阶段 6 · 工具调用 / Agent
> 本篇覆盖：Python 侧**内置工具层**（`apps/api-py/app/tools/` 的注册表、`ToolError`、`calculator` / `get_current_time` / `http_get`）、`GET /tools` 路由、以及引擎里用「**LLM 节点 + 工具 + 条件边 + 环**」实现的 **ReAct 循环**（`engine.py` 的 `RunState` / `_make_llm_with_tools_action` / `_make_tools_action` / `nodes/llm.py` 的 `bind_tools` 与流式 `tool_call_chunks` 聚合）。
> **本篇首次教学：① 工具定义 = OpenAI function calling 的 JSON Schema（数据，不是代码）；② 工具失败的 `ToolError` 与五个固定 `reason`；③ `calculator` 的安全递归下降解析；④ `httpx.AsyncClient` 的流式 GET（对照 `fetch`）；⑤ Python 侧条件边 + 环的写法（`add_conditional_edges` 的映射字典）；⑥ 按节点 id 隔离的 `messages` / `rounds` / `tool_calls` 状态；⑦ `bind_tools` 与流式工具调用分片聚合；⑧ 两端（TS / Python）在工具调用场景下的逐字节对齐。**
> （前置引用：Python 语言基础见 `00-项目初始化/00-Python与FastAPI基础.md`；Python 版 LangGraph（`StateGraph` / `TypedDict` + `Annotated` reducer / `ainvoke` / `asyncio.Queue`）见 `04-执行引擎/04-LangGraph与引擎-Python.md`；LLM 节点真实调用与流式见 `05-LLM节点/02-真实模型调用与流式.md`；LLM 错误映射见 `05-LLM节点/03-LLM错误映射.md`；mock provider 见 `05-LLM节点/04-mock-LLM与无密钥自测.md`；SSE 帧与事件协议唯一真源是 `packages/contract/sse-events.md`；工具错误文案唯一真源是 `packages/contract/error-messages.md` §6；工具定义形状唯一真源是 `packages/contract/openapi.yaml` 的 `ToolDefinition` / `LlmNodeData.tools`。）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 定位：TS 先行，Python 补齐同一套语义

阶段 6 仍然是**双栈同契约**：

```text
同一份契约（openapi.yaml 的 ToolDefinition / LlmNodeData.tools；sse-events.md §3.1；error-messages.md §6）
   ├── TS  : apps/api-ts/src/tools/*、apps/api-ts/src/engine/engine.service.ts
   └── Py  : apps/api-py/app/tools/*、apps/api-py/app/engine/engine.py
                     │
                     ▼ 两边都不新增节点类型
        llm 节点内部用「LLM + 工具 + 条件边 + 环」跑 ReAct
                     │
                     ▼
        同一张图、同一 prompt：事件名序列 / payload 键集合 / result / text / usage 全部一致
```

Python 侧**没有**为了「更像 Agent」而另造一套机制；它把 TS 侧已经确定的拓扑（条件边 + 环）、状态形状（按节点 id 隔离的字典）、事件顺序（`tool_call` → `tool_result` → `token` → `node_finished`），用 Python 的语法**一比一复刻**。本篇的重点因此不是「发明新东西」，而是：

1. 讲清工具层为什么是**数据表 + 纯函数**，不是装饰器魔法；
2. 讲清 **ReAct 在本项目里到底长什么样**（没有新节点类型，只有内部节点与两条边）；
3. 讲清 Python 与 TS 在**语言机制**上的差异，以及为什么这些差异**不影响协议**。

### 0.1 术语先立住（首次出现，一句话解释）

| 术语 | 一句话解释 |
| --- | --- |
| **工具调用（tool calling / function calling）** | 模型不直接回答问题，而是输出「我要调用哪个函数、参数是什么」；由宿主程序真正执行函数，再把结果喂回模型。 |
| **ReAct** | Reasoning + Acting：模型先「想」（产出工具调用），宿主「做」（执行工具），把观测结果回填，再让模型继续，直到它不再要工具。本项目不解析自然语言里的「思考」，**工具调用本身就是决策**。 |
| **`ToolDefinition`** | 一份描述工具的 JSON：`name` / `description` / `parameters`（JSON Schema）。它既能展示给前端（`GET /tools`），也能直接交给模型的 function calling。 |
| **`ToolMessage`** | LangChain 的消息类型，表示「某个工具的执行结果」。它必须带 `tool_call_id`，与上一轮 `AIMessage.tool_calls` 里的 id 对应。 |
| **条件边（conditional edge）** | 一条「由函数现场决定下一个节点是谁」的边。函数返回一个**逻辑名**，再由映射字典翻译成真实节点名。 |
| **环（cycle）** | 图里指回自己的路径。本项目是 `llm1 → llm1__tools → llm1`，让同一个 LLM 节点被反复执行。 |
| **轮次（round）** | 一次「模型要工具 → 执行工具」的完整往返。`round` 从 **1** 开始；同一轮里模型要多个工具，算**同一 round**。 |
| **内部节点 `<llmId>__tools`** | 只为工具执行而存在的图节点，**不是**契约里的节点类型；它不发 `node_started` / `node_finished`。 |

---

## 1. 本篇目标与验收

### 1.1 做完你能做到

| 能力 | 判定 |
| --- | --- |
| 读懂一个工具定义 | 能说出 `parameters` 是 JSON Schema，会直接成为 OpenAI function calling 的 `parameters` |
| 自己加一个工具 | 在 `TOOL_DEFINITIONS` 加一条、写一个纯函数、在 `execute_tool` 加一个分支，三步到位 |
| 讲清 ReAct 的图结构 | 能画出 `llm1` 的两条条件出边与 `llm1__tools` 的一条普通回边 |
| 讲清状态隔离 | 能说出 `messages[nodeId]` 为什么不能退化成单一的 `messages` 列表 |
| 讲清两端为什么能逐字节一致 | 事件由同一份协议构造、值规范由纯函数对齐；只有 `runId` / `appId` / `elapsedMs` 天生不同 |

### 1.2 验收标准（本篇实测口径）

1. `GET /tools` 两端 JSON **逐字段相等**（`items[].name` / `description` / `parameters` 全同）。
2. 单工具图（`start → llm1 → end`，`llm1.data.tools=["calculator"]`）跑出 **12 帧**：`run_started` → `node_started(start)` → `node_finished(start)` → `node_started(llm1)` → `tool_call` → `tool_result` → `token` ×2 → `node_finished(llm1)` → `node_started(end)` → `node_finished(end)` → `run_finished`。
3. 该次运行：`tool_result.result = "14"`、`node_finished(llm1).output.text = "answer: 14"`、`usage = 60/10/70`。
4. 两端对比：**事件名序列一致、payload 键集合一致、`args` / `result` / `text` / usage 完全一致**；仅 `runId` / `appId` / `elapsedMs` 不同。
5. 多轮：`round` 依次为 `1`、`2`；并行：同一 `round` 两个工具（`calculator` `6*7` → `42`，`get_current_time` → `2026-10-20T16:15:57.595Z`）。
6. 错误文案：`llm node llm1 references unknown tool: xxx`（400）、`tool calculator failed: invalid arguments`、`tool call rounds exceeded: 1`、`tool http_get failed: not allowed`。
7. 回归：`tools` 为空 / 未设置时，行为与阶段 5 完全一致——token 序列 `["echo:"," Hell","o min","i-dif","y"]`、usage `15/21/36`。

---

## 2. 前置条件与「当场补课」

### 2.1 你需要先有的东西

| 依赖 | 来自 |
| --- | --- |
| Python 语法最小集（`async def` / `with` / 异常 / 类型注解 / 推导式） | `00-项目初始化/00-Python与FastAPI基础.md` |
| Python 版 LangGraph 能建图、编译、执行 | `04-执行引擎/04-LangGraph与引擎-Python.md` |
| `llm` 节点已能真实调用 `ChatOpenAI` 并逐 chunk 发 `token` | `05-LLM节点/02-真实模型调用与流式.md` |
| 引擎能把执行期错误归一为 `run_failed` | `05-LLM节点/03-LLM错误映射.md` |
| 有一个能返回固定结果的 mock provider | `05-LLM节点/04-mock-LLM与无密钥自测.md` |
| 契约已含 `/tools`、`ToolDefinition`、`LlmNodeData.tools`、`sse-events.md` §3.1、`error-messages.md` §6 | `packages/contract/openapi.yaml`、`packages/contract/sse-events.md`、`packages/contract/error-messages.md` |

### 2.2 四个前置概念，当场解释（不让你去猜）

**① `StateGraph` 是什么。** 一张「状态在节点之间流动」的图：每个节点是一个 `async def action(state) -> dict`，返回**状态的一部分更新**；边决定下一个跑谁。`builder.compile()` 把它变成可执行图，`await compiled.ainvoke(初始状态)` 跑完整图。细节见 `04-执行引擎/04-LangGraph与引擎-Python.md` §5，这里只需要记住：**节点接收状态、返回增量**。

**② reducer 是什么。** 当多个节点都更新同一个状态键时，LangGraph 需要一个「怎么合并」的函数。`Annotated[dict, _merge_dict]` 就是把 `_merge_dict` 挂在这个键上；每次更新时 LangGraph 调用 `_merge_dict(旧值, 增量)`。阶段 4 只有 `pool` 一个键；本篇有 `pool` / `messages` / `rounds` / `tool_calls` 四个键，**后三个的值又都是「节点 id → 该节点的东西」的字典**。

**③ `ChatOpenAI.astream` 是什么。** 对 `ChatOpenAI` 调用 `.astream(messages)` 会得到一个**异步迭代器**，每个 `chunk` 是一小片模型输出（文本片段、工具调用参数片段、usage 等）。阶段 5 已经用它发 `token`；阶段 6 只是**额外**从同一个 chunk 里收集 `tool_call_chunks`。

**④ `asyncio.Queue` 与事件外发。** 图在**后台协程**里跑，节点动作用 `await queue.put(event)` 把事件放进队列；`run_stream` 在**前台**用 `await queue.get()` 逐条取出、`yield` 成 SSE 帧。队列空时 `get()` 会挂起等待（让出控制权），结束时生产者放一个 `None` 哨兵让消费方 `break`。细节见 `04-执行引擎/04-LangGraph与引擎-Python.md` §7；本篇只需知道「`await queue.put(...)` = 发一个事件」。

> SSE 帧格式（`event: <name>\n` + `data: <单行 JSON>\n\n`）与六种基础事件已在 `04-执行引擎/01-运行契约与SSE事件协议.md` 讲透，本篇直接使用，只新增 `tool_call` / `tool_result` 两种事件。

---

## 3. 先看清要做什么

### 3.1 工具层的形状

```text
GET /tools
   └── 返回 TOOL_DEFINITIONS（name / description / parameters）

llm 节点的 data.tools = ["calculator", ...]
   └── 预检：每个名字必须已注册（否则 400）
   └── 运行时：client.bind_tools(定义) → 模型可以产出 tool_calls
   └── 引擎：execute_tool(name, args) → 字符串结果
```

**关键点**：工具层与 LangGraph **完全解耦**。`registry.py` 不知道图、不知道事件、不知道 LLM；它只是「名字 → 定义」「名字 + 参数 → 字符串结果」。ReAct 的编排全部在 `engine.py`。

### 3.2 ReAct 的图结构（本项目版）

```text
                    ┌── router 返回 "continue" ──────────────────────────▶ end ──▶ END
                    │
start ──▶ llm1 ─────┤
          ▲         └── router 返回 "tools" ──▶ llm1__tools ──(普通边)──▶ llm1
          │                                        │
          └────────────────────────────────────────┘
```

用文字说清三件事：

1. `llm1` 有**两条从它出发的边**，但都是**条件边**（`add_conditional_edges`）。router 读 `state["tool_calls"]["llm1"]`：
   - 非空 → 返回 `"tools"`，映射到内部节点 `llm1__tools`；
   - 空 → 返回 `"continue"`，映射到原图的下游（这里是 `end`）。
2. `llm1__tools` 只有一条**普通边**指回 `llm1`（`add_edge`），这就是「环」。
3. 原图里 `llm1 → end` 这条普通边**被跳过**，否则会与条件边同时生效。

编译后的图内省（实测，`compiled.get_graph().edges`）：

```text
source='llm1'          target='end'           conditional=True
source='llm1'          target='llm1__tools'   conditional=True
source='llm1__tools'   target='llm1'          conditional=False
```

> 注意：`llm1` → `end` 在编译后仍显示 `conditional=True`——因为它是**条件边映射出来的具体目标**，不是原图那条普通边。原图的 `llm1 → end` 已被 `if edge["source"] in tool_node_ids: continue` 跳过。

### 3.3 一次单工具运行的事件流

```text
run_started
node_started(start)
node_finished(start)
node_started(llm1)                 ← 只发一次（首轮）
tool_call(round=1)                 ← 模型要计算
tool_result(round=1)               ← 引擎算出 "14"
token("answer: ")                  ← 第二轮模型文本
token("14")
node_finished(llm1)                ← 只在最后一轮（无 tool_calls）发
node_started(end)
node_finished(end)
run_finished
```

`node_started` / `node_finished` **不会**每轮重复——这是 `sse-events.md` §3.1 的硬性约定，也是前端能稳定渲染「一个节点」的前提。

---

## 4. 命令清单（逐条说明）

> 全部在仓库根目录 `d:\user\my_project\github\mini-dify` 执行。Windows PowerShell 下 `curl` 是 `Invoke-WebRequest` 的别名，**一律用 `curl.exe`**。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | 仓库根 | 按 `uv.lock` 拉齐依赖（含 `httpx`、`langchain-openai`、`langgraph`） | 无报错 |
| `node tools/mock-llm/server.mjs` | 仓库根 | 起 mock provider（阶段 6 版，支持 `[[call:...]]`） | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| 编辑 `apps/api-py/.env`：`LLM_BASE_URL=http://127.0.0.1:11435/v1`、`LLM_API_KEY=test`、`LLM_MODEL=mock-model`、`LLM_TIMEOUT_MS=3000` | 编辑器 | 把 Python 后端指向 mock，**无需真实密钥** | — |
| `$env:MAX_TOOL_ROUNDS = "1"`（PowerShell，**起后端之前**） | 任意终端 | 覆盖工具轮次上限（默认 5） | 改完**重启后端**后生效；也可直接写进 `apps/api-py/.env`（Py 侧经 `Settings.max_tool_rounds` 读取，见 §13） |
| `pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000） | `Uvicorn running on http://127.0.0.1:8000` |
| `curl.exe -s http://localhost:8000/tools -H "Authorization: Bearer $TOKEN"` | 任意终端 | 验证工具列表 | `{"items":[{"name":"calculator",...},...]}` |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001），用于**两端对比** | `api-ts listening on http://localhost:3001` |
| `curl.exe -N -s -X POST "http://localhost:8000/apps/$APP_ID/run" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"inputs":{}}'` | 任意终端 | 跑带工具的图，观察 SSE | 12 帧，见 §11 |

**依赖声明（`apps/api-py/pyproject.toml` 相关行）**：

```toml
dependencies = [
    # …（fastapi / uvicorn / pydantic / sqlalchemy / …）
    "langgraph>=1.2.16",
    "langchain-openai>=1.0.0",
    "httpx>=0.28.1",          # ← 阶段 6：http_get 是运行期代码，httpx 从 dev 组提升到运行期依赖
]

[dependency-groups]
dev = [
    "pytest>=8.3.0",
    "ruff>=0.6.0",
    # 阶段 5 时 httpx 在这里；阶段 6 已移走
]
```

**为什么 `httpx` 要从 dev 挪到 dependencies**：阶段 5 的测试用 `httpx` 发请求，它只是「开发期工具」；阶段 6 的 `http_get` 工具**在运行期**用它发 GET，所以必须成为运行期依赖——否则生产环境装不到它，工具一调用就 `ModuleNotFoundError`。

---

## 5. 【技术教学 · 首次】工具层：数据表 + 纯函数

### 5.1 一个工具 = 一份 JSON Schema + 一个纯函数

OpenAI 的 function calling 要求把工具描述成 JSON：

```json
{
  "name": "calculator",
  "description": "安全地计算一个四则运算表达式……",
  "parameters": {
    "type": "object",
    "properties": { "expression": { "type": "string", "description": "……" } },
    "required": ["expression"],
    "additionalProperties": false
  }
}
```

**是什么**：`parameters` 是一份 **JSON Schema**——它告诉模型「这个函数收什么参数、哪些必填、能不能加别的键」。模型据此生成合法的 `arguments`。

**TS 里对应什么**：完全同一份形状，TS 侧把它声明为 `ToolDefinition[]`（来自 `@mini-dify/contract`）。

**这里为什么这么写**：

- 同一份数据既服务于 `GET /tools`（展示给前端），又直接交给 `bind_tools`（给模型）——**一份真源，两处使用**。
- `additionalProperties: false` 与契约一致，防止模型塞多余字段；`required` 明确必填。
- 定义是**纯数据**，不绑定 Python 函数对象，所以两端可以逐字段比对。

### 5.2 `ToolError`：五个固定 `reason`

**完整文件路径：`apps/api-py/app/tools/tool_error.py`（逐字 + 讲解注释）**

```python
"""工具执行失败（见 error-messages.md §6.2）。

`reason` 只能取契约规定的固定值；引擎据此拼出
`tool {name} failed: {reason}`，两端逐字节一致。
"""

from typing import Literal                                                    # ← Literal：限定「只能是这几个字符串之一」

ToolFailureReason = Literal["invalid arguments", "timeout", "not allowed", "too large", "error"]
# ↑ 这是一个「类型别名」：五个合法 reason。注意它在运行期【不强制】——写错字符串不会报错，
#   但会破坏两端文案一致性，所以只能从这五个里选。


class ToolError(Exception):                                                   # ← 继承内置 Exception（≈ TS 的 class ToolError extends Error）
    """工具内部失败：`reason` 为契约固定的五个取值之一。"""

    def __init__(self, reason: ToolFailureReason) -> None:                    # ← 构造方法，只接收一个 reason
        super().__init__(reason)                                              # ← 调父类构造：让 str(error) 就等于 reason
        self.reason = reason                                                  # ← 同时把 reason 存成属性，引擎要读它拼文案
```

**这段在干什么（按执行顺序）**：

1. `ToolFailureReason = Literal[...]`：声明「合法 reason 的集合」。它**只是标注**，Python 不会拦你传 `"boom"`；真正的约束靠**代码只写这五个字面量** + 测试。
2. `class ToolError(Exception)`：自定义异常，继承 `Exception`。这样 `raise ToolError(...)` 抛出的东西能被 `except ToolError` 精确捕获。
3. `super().__init__(reason)`：把 reason 交给 `Exception` 的构造器，于是 `str(ToolError("timeout")) == "timeout"`。这是「异常自带消息」的标准写法。
4. `self.reason = reason`：额外保存结构化字段。引擎拼文案时**读字段**，而不是去解析字符串。

**与 TS 的对照**：

```ts
export type ToolFailureReason =
  | 'invalid arguments' | 'timeout' | 'not allowed' | 'too large' | 'error'

export class ToolError extends Error {
  constructor(readonly reason: ToolFailureReason) {
    super(reason)          // 让 error.message === reason
  }
}
```

机制差异：TS 的 `readonly reason` 是**构造参数属性**（一行同时完成赋值），Python 必须**先 `super().__init__` 再 `self.reason =`**。语义完全一样。

### 5.3 `calculator`：不用 `eval` 的安全递归下降

**为什么要自己写解析器**：`eval("2+3")` 会执行任意 Python 代码；模型生成的表达式不可信，必须只允许四则运算。TS 侧同样不用 `eval` / `Function`，而是手写递归下降——两端算法一致，结果才能逐字节相同。

**关键代码（`apps/api-py/app/tools/calculator.py`，逐字 + 讲解注释）**

```python
def run_calculator(args: dict[str, Any]) -> str:                              # ← 工具入口：入参是模型给的 args
    expression = args.get("expression")                                       # ← 取 expression；取不到是 None
    if not isinstance(expression, str) or expression.strip() == "":           # ← 类型不对 / 空白 → 参数非法
        raise ToolError("invalid arguments")
    value = _ExpressionParser(expression).parse()                             # ← 递归下降求值（见下）
    if math.isnan(value) or math.isinf(value):                                # ← NaN / Inf 也归为非法（≈ Number.isFinite）
        raise ToolError("invalid arguments")
    return _format_number(value)                                              # ← 统一数值字符串化，见下


def _format_number(value: float) -> str:
    """数值字符串化：消除浮点噪声（如 0.1+0.2 → "0.3"），并把 -0 归一为 "0"。"""
    if value == 0:                                                            # ← -0.0 == 0 为真，统一成 "0"
        return "0"
    # 对齐 JS 的 `Number(value.toPrecision(12))`
    normalized = float(f"{value:.12g}")                                       # ← .12g = 12 位有效数字（≈ toPrecision(12)）
    # 对齐 JS `String(number)`：整数不带 ".0"
    if normalized.is_integer() and abs(normalized) < 1e21:                    # ← 整数且不是科学计数区间 → 输出纯整数
        return str(int(normalized))
    # Python repr 的指数会补零（1e-07），JS 不补（1e-7）
    return re.sub(r"e([+-])0+(\d+)", r"e\1\2", repr(normalized))              # ← 把 1e-07 改成 1e-7，对齐 JS
```

**这段在干什么（按执行顺序）**：

1. `args.get("expression")`：从字典取参数。模型可能没给、给 `null`、给数字——所以下一步先判类型。
2. `isinstance(expression, str)` + `strip() == ""`：**类型与空串校验**。不通过就抛 `invalid arguments`。
3. `_ExpressionParser(expression).parse()`：真正求值。它只认 `+ - * /`、括号、小数、一元正负号；遇到别的字符会在 `parse()` 末尾发现「还有剩余字符」而报错。
4. `math.isnan/isinf`：浮点运算可能产出 `NaN` / `Infinity`（例如溢出），一律归为 `invalid arguments`，不让它们变成 `"nan"` 之类的怪结果。
5. `_format_number`：把 Python 的浮点表现**磨成 JS `String(number)` 的样子**。这一步是「两端逐字节一致」的关键——不是数学需要，而是**对齐需要**。

**递归下降的核心（同一文件，逐字 + 注释）**

```python
    def parse(self) -> float:
        value = self._parse_expression()                                       # ← 先解析一个完整表达式
        self._skip_spaces()                                                    # ← 跳过尾部空格
        if self.position < len(self.text):                                     # ← 还有剩余字符 → 语法非法（如 "1+2)"）
            raise ToolError("invalid arguments")
        return value

    def _parse_expression(self) -> float:                                      # ← expression := term (('+'|'-') term)*
        value = self._parse_term()                                             # ← 先取一个 term
        while True:
            self._skip_spaces()
            char = self._char()                                                # ← 看当前字符（越界返回空串）
            if char == "+":
                self.position += 1                                             # ← 吃掉 '+'
                value += self._parse_term()                                    # ← 再加下一个 term
            elif char == "-":
                self.position += 1
                value -= self._parse_term()
            else:
                return value                                                   # ← 不是加减 → 本层结束

    def _parse_term(self) -> float:                                            # ← term := unary (('*'|'/') unary)*
        value = self._parse_unary()
        while True:
            self._skip_spaces()
            char = self._char()
            if char == "*":
                self.position += 1
                value *= self._parse_unary()
            elif char == "/":
                self.position += 1
                divisor = self._parse_unary()
                if divisor == 0:                                               # ← 除零 → 非法（不是让 Python 抛 ZeroDivisionError）
                    raise ToolError("invalid arguments")
                value /= divisor
            else:
                return value

    def _parse_unary(self) -> float:                                           # ← unary := ('+'|'-')? primary
        self._skip_spaces()
        char = self._char()
        if char == "+":
            self.position += 1
            return self._parse_unary()                                         # ← 一元正号：递归吃掉
        if char == "-":
            self.position += 1
            return -self._parse_unary()                                        # ← 一元负号：取负
        return self._parse_primary()                                           # ← 没有符号 → 解析括号或数字

    def _parse_primary(self) -> float:
        self._skip_spaces()
        if self._char() == "(":                                                # ← 括号：递归回到最外层表达式
            self.position += 1
            value = self._parse_expression()
            self._skip_spaces()
            if self._char() != ")":                                            # ← 括号没闭合 → 非法
                raise ToolError("invalid arguments")
            self.position += 1
            return value
        return self._parse_number()

    def _parse_number(self) -> float:
        start = self.position
        seen_dot = False                                                       # ← 只允许一个小数点
        while self.position < len(self.text):
            char = self.text[self.position]
            if "0" <= char <= "9":                                             # ← 数字：继续
                self.position += 1
            elif char == "." and not seen_dot:                                 # ← 第一个 '.'：继续
                seen_dot = True
                self.position += 1
            else:
                break                                                          # ← 其它字符：数字到此为止
        text = self.text[start : self.position]                                # ← 切片取出数字文本
        if text == "" or text == ".":                                          # ← 空 / 只有一个点 → 非法
            raise ToolError("invalid arguments")
        try:
            value = float(text)                                                # ← 转浮点
        except ValueError as error:
            raise ToolError("invalid arguments") from error                    # ← 理论上不会走到，兜底
        return value

    def _char(self) -> str:
        """当前位置字符（越界返回空串，与 JS 的 `input[position]` 为 undefined 对齐）。"""
        return self.text[self.position] if self.position < len(self.text) else ""   # ← 越界不抛 IndexError
```

**这段在干什么（按执行顺序，以 `2+3*4` 为例）**：

1. `parse()` → `_parse_expression()`。
2. `_parse_expression()` 先 `_parse_term()`：term 先 `_parse_unary()` → `_parse_primary()` → `_parse_number()` 吃掉 `2`。
3. 回到 term 的 `while`：当前字符是 `+`，不是 `*` / `/`，于是 `return 2`。
4. 回到 expression 的 `while`：看到 `+`，吃掉，再 `_parse_term()`：解析 `3`，看到 `*`，吃掉，再 `_parse_unary()` 解析 `4`，于是 term 返回 `12`。
5. expression 得到 `2 + 12 = 14`；再看不剩字符，返回 `14`。
6. `run_calculator` 格式化后返回 `"14"`。

**为什么 `_char()` 越界返回 `""` 而不是抛错**：TS 的 `input[position]` 越界是 `undefined`，与任何字符比较都为假。Python 若直接 `self.text[self.position]` 会抛 `IndexError`，两端行为就分叉了。返回 `""` 是**刻意对齐 JS**。

**为什么 `_format_number` 要这么绕**：Python 的 `0.1 + 0.2` 是 `0.30000000000000004`，`repr(1e-7)` 是 `'1e-07'`；JS 的 `Number((0.1+0.2).toPrecision(12))` 然后 `String(...)` 得到 `"0.3"`，`String(1e-7)` 是 `"1e-7"`。不磨平这两处，`tool_result.result` 就会两端不同。

### 5.4 `get_current_time`：一行工具

**完整文件路径：`apps/api-py/app/tools/current_time.py`（逐字 + 讲解注释）**

```python
"""`get_current_time`：无参数，返回当前 UTC 时间。

格式与全站一致：ISO-8601、毫秒精度、以 `Z` 结尾（固定 24 字符），
复用 `app.timefmt.iso_z`，与 api-ts 的 `new Date().toISOString()` 逐字节一致。
"""

from datetime import UTC, datetime                                            # ← UTC 是时区常量（Python 3.11+）
from app.timefmt import iso_z                                                 # ← 项目自带的 ISO-Z 序列化（阶段 2 讲透）


def run_get_current_time() -> str:                                            # ← 无参数：模型传 {} 即可
    return iso_z(datetime.now(UTC))                                           # ← 取当前 UTC 时间并格式化为 24 字符
```

**这段在干什么**：`datetime.now(UTC)` 取「带 UTC 时区的时间」，`iso_z` 把它格式化成 `2026-10-20T16:15:57.595Z`——**UTC、毫秒精度、`Z` 结尾、固定 24 字符**。`app/timefmt.py` 的 `iso_z` 已在 `02-应用管理/07-验收.md` 首次教学（当时解决「Python 的 `+00:00` 与 TS 的 `Z` 不一致」），这里直接复用。

> 无参数工具的 `parameters.properties` 是 `{}`，没有 `required`；模型会传 `{}`。

### 5.5 `http_get`：`httpx.AsyncClient` 的流式 GET

**完整文件路径：`apps/api-py/app/tools/http_get.py`（逐字 + 讲解注释）**

```python
from typing import Any
from urllib.parse import urlsplit                                              # ← 解析 URL（≈ new URL）

import httpx                                                                  # ← 运行期 HTTP 客户端（异步）

from app.tools.tool_error import ToolError

# 响应体上限：64KB（见契约 §6.2 的 `too large`）
MAX_BODY_BYTES = 64 * 1024                                                     # ← 65536

# 超时：5 秒（见契约 §6.2 的 `timeout`）
TIMEOUT_SECONDS = 5.0                                                          # ← httpx 的 timeout 单位是【秒】


async def run_http_get(args: dict[str, Any]) -> str:                           # ← 注意是 async def：内部要 await
    url = args.get("url")
    if not isinstance(url, str) or url == "":                                   # ← 类型 / 空串校验
        raise ToolError("invalid arguments")
    try:
        target = urlsplit(url)                                                 # ← 拆 scheme / netloc / path
    except ValueError as error:
        raise ToolError("invalid arguments") from error                        # ← 畸形 URL（如坏 IPv6）→ 参数非法
    if target.scheme not in ("http", "https"):                                 # ← 只允许 http/https
        # `file:` 等协议 → not allowed；无协议（如 "foo"，对应 `new URL` 抛错）→ invalid arguments
        raise ToolError("not allowed" if target.scheme else "invalid arguments")
    if not target.netloc:                                                      # ← 如 "http://" 没有主机 → 参数非法
        # 如 "http://"（对应 `new URL` 抛错）→ invalid arguments
        raise ToolError("invalid arguments")

    try:
        async with (                                                           # ← 同时进入两个异步上下文（Python 3.10+ 括号写法）
            httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=True) as client,
            # ↑ 建异步客户端：5s 超时；自动跟随重定向（fetch 默认跟随，httpx 默认不跟随）
            client.stream("GET", url) as response,                              # ← 发起请求但【不】把 body 读进内存
        ):
            chunks: list[bytes] = []                                            # ← 收集字节块
            total = 0                                                           # ← 已读字节数
            async for chunk in response.aiter_bytes():                          # ← 逐块异步读（≈ reader.read() 循环）
                total += len(chunk)
                if total > MAX_BODY_BYTES:                                      # ← 超过 64KB
                    raise ToolError("too large")                                # ← 立刻中止（退出上下文会关闭连接）
                chunks.append(chunk)
            return b"".join(chunks).decode("utf-8", errors="replace")           # ← 合并字节并解码（≈ TextDecoder）
    except ToolError:                                                           # ← 自己抛的 ToolError：原样上抛（必须在前！）
        raise
    except httpx.TimeoutException as error:                                     # ← 超时 → timeout
        raise ToolError("timeout") from error
    except Exception as error:                                                  # ← 其它一切 → error
        raise ToolError("error") from error
```

**这段在干什么（按执行顺序）**：

1. 取 `url`，判类型与空串。
2. `urlsplit(url)` 拆 URL；畸形 URL 抛 `ValueError` → `invalid arguments`。
3. 协议检查：`file:` / `ftp:` 等**有协议但不允许** → `not allowed`；`"foo"` 这种**没有协议**的 → `invalid arguments`（对齐 `new URL("foo")` 抛错的行为）。
4. 主机检查：`"http://"` 没有 `netloc` → `invalid arguments`。
5. 进入 `async with`：先建 `AsyncClient`，再用 `client.stream("GET", url)` 打开一个**流式响应**。此时**只拿到响应头**，body 还没读。
6. `async for chunk in response.aiter_bytes()`：一块一块读；累计 `total`；超过 64KB 立刻抛 `too large`。**边读边判**，所以超大响应不会被完整读进内存。
7. 读完：`b"".join(chunks)` 合并字节，`decode("utf-8", errors="replace")` 解码；非法字节用替换符，与 JS `TextDecoder` 的默认行为对齐。
8. 异常分流：`ToolError` 最先原样上抛；`TimeoutException` → `timeout`；其余 → `error`。

**`httpx` 与 TS `fetch` 的机制对照（讲透）**

| 关注点 | TS `fetch`（`http-get.tool.ts`） | Python `httpx`（`http_get.py`） | 关键差异 |
| --- | --- | --- | --- |
| 发请求 | `await fetch(target, { signal })` | `async with httpx.AsyncClient(...) as client` + `client.stream("GET", url)` | `fetch` 是**函数**；`httpx` 要先建**客户端对象**（连接池、默认头、超时都挂在客户端上） |
| 超时 | 自己 `AbortController` + `setTimeout` | 构造参数 `timeout=5.0`（**秒**） | httpx 内建超时；TS 要手动做取消信号 |
| 跟随重定向 | `fetch` **默认跟随** | `httpx` **默认不跟随**，要显式 `follow_redirects=True` | 不写这个参数，`http_get` 遇到 301 会直接返回重定向响应体（通常为空），两端结果不同 |
| 流式读 body | `response.body.getReader()` + `await reader.read()` | `client.stream(...)` + `async for chunk in response.aiter_bytes()` | 语义同：一块块拿；Python 用**异步迭代器**，TS 用 **ReadableStream reader** |
| 中止 | `reader.cancel()` / `controller.abort()` | 抛 `ToolError` 退出 `async with`，连接自动关闭 | 两者都靠「退出作用域」释放连接 |
| 解码 | `new TextDecoder().decode(bytes)` | `bytes.decode("utf-8", errors="replace")` | 默认都是 UTF-8 + 替换非法字节 |
| 失败捕获 | `try/catch` + `instanceof ToolError` / `AbortError` | 多个 `except`，**子类在前** | Python 按 `except` 顺序匹配，顺序错会把 `ToolError` 吞成 `error` |

> `async with (A as a, B as b):` 是 **Python 3.10+** 的「括号化多上下文管理器」写法，等价于嵌套两层 `async with`。本项目 `requires-python = ">=3.12"`，可以放心用。它保证**离开缩进块时**（含异常路径）两个资源都按**逆序**自动关闭。

### 5.6 `registry`：数据表 + 显式分派

**完整文件路径：`apps/api-py/app/tools/registry.py`（逐字 + 讲解注释）**

```python
from typing import Any

from app.tools.calculator import run_calculator                                # ← 三个工具的真实实现
from app.tools.current_time import run_get_current_time
from app.tools.http_get import run_http_get

TOOL_DEFINITIONS: list[dict[str, Any]] = [                                     # ← 唯一真源：一份「纯数据」列表
    {
        "name": "calculator",
        "description": "安全地计算一个四则运算表达式，支持 + - * /、括号、小数与一元负号。",
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": '要计算的表达式，例如 "2+3*4"',
                },
            },
            "required": ["expression"],                                        # ← 必填
            "additionalProperties": False,                                     # ← 禁止多余字段
        },
    },
    {
        "name": "get_current_time",
        "description": "返回当前 UTC 时间（ISO-8601、毫秒精度、以 Z 结尾）。无参数。",
        "parameters": {
            "type": "object",
            "properties": {},                                                  # ← 无参数
            "additionalProperties": False,
        },
    },
    {
        "name": "http_get",
        "description": "对给定 URL 发起 HTTP GET，返回响应体文本。仅允许 http/https。",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "要请求的 http:// 或 https:// URL",
                },
            },
            "required": ["url"],
            "additionalProperties": False,
        },
    },
]


def has_tool(name: str) -> bool:                                               # ← 预检用：名字是否注册
    """工具名是否已注册。"""
    return any(definition["name"] == name for definition in TOOL_DEFINITIONS)  # ← any：任意一个匹配即 True


def get_tool_definition(name: str) -> dict[str, Any] | None:                   # ← 按名字取定义
    """按名字取工具定义（未注册时返回 None）。"""
    return next((definition for definition in TOOL_DEFINITIONS if definition["name"] == name), None)
    # ↑ next(生成器, 默认值)：取第一个匹配；没有就返回 None（而不是抛 StopIteration）


async def execute_tool(name: str, args: dict[str, Any]) -> str:                # ← 统一异步入口，返回值一律字符串
    """执行一个工具，返回**字符串**结果。

    未注册的工具名由引擎在预检阶段拦截；此处再抛普通 Error 作为兜底。
    """
    if name == "calculator":                                                   # ← 显式分派（对照 TS 的 switch）
        return run_calculator(args)                                            # ← 同步函数：直接返回
    if name == "get_current_time":
        return run_get_current_time()                                          # ← 无参数
    if name == "http_get":
        return await run_http_get(args)                                        # ← 异步函数：必须 await
    raise ValueError(f"unknown tool: {name}")                                  # ← 兜底：预检已拦截，正常不会走到
```

**这段在干什么（按执行顺序）**：

1. 模块导入时，`TOOL_DEFINITIONS` 这个**列表字面量**被创建——里面全是字典和字符串，**不包含任何函数对象**。
2. `has_tool("calculator")`：遍历列表，任一 `definition["name"]` 相等即返回 `True`。预检与运行时兜底都用它。
3. `get_tool_definition("http_get")`：`next(...)` 取第一个匹配项；没有匹配则返回 `None`（`next` 的第二个参数是默认值）。
4. `execute_tool(name, args)`：按名字走 `if` 分支。`calculator` / `get_current_time` 是同步函数，直接 `return`；`http_get` 是 `async def`，必须 `await`。未知名字抛 `ValueError`。

**为什么用 `if` 而不是「名字 → 函数」的字典**：两种都能工作。这里选 `if` 是为了与 TS 的 `switch` **结构对齐**，代码审阅时两边可以逐行对照。若工具数量变大，改成 `_HANDLERS = {"calculator": run_calculator, ...}` 会更优雅——但要注意同步/异步混装时统一用 `await` 的写法，本项目暂时没这个必要。

**为什么 `execute_tool` 是 `async def`**：三个工具里 `http_get` 是异步的；把统一入口做成异步，调用方（引擎）只写一种 `await execute_tool(...)`，不用判断「这个工具是不是异步」。同步工具在 `async def` 里直接 `return` 完全合法。

### 5.7 `GET /tools`：认证 + 原样返回定义

**完整文件路径：`apps/api-py/app/api/tools.py`（逐字 + 讲解注释）**

```python
from typing import Any

from fastapi import APIRouter, Depends                                         # ← APIRouter：路由组；Depends：函数级依赖注入
from app.api.deps import get_current_user                                      # ← 复用阶段 1 的鉴权依赖
from app.models.user import User
from app.tools.registry import TOOL_DEFINITIONS

router = APIRouter(tags=["tools"])                                             # ← 不设 prefix，路径在装饰器里写全


@router.get("/tools", operation_id="listTools")                                # ← operationId 对齐契约
def list_tools(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    # ↑ 同步 def：函数体没有 I/O（只是返回常量），FastAPI 会丢线程池，无妨
    # ↑ current_user 虽然没用到，但它的存在强制了「必须带有效 Bearer 令牌」
    return {"items": TOOL_DEFINITIONS}                                         # ← 原样返回，JSON 形状 { items: [...] }
```

**这段在干什么（按执行顺序）**：

1. `router = APIRouter(tags=["tools"])`：建一个路由组。`tags` 只影响自动文档分组，不改变路径。
2. `@router.get("/tools", operation_id="listTools")`：注册 `GET /tools`；`operation_id` 与契约的 `operationId` 对齐。
3. `current_user: User = Depends(get_current_user)`：FastAPI 在调用 `list_tools` 前先执行 `get_current_user`——解析 `Authorization: Bearer ...`、校验 JWT、查用户；失败直接 401。**这就是 Python 侧的「Guard」**。
4. 返回 `{"items": TOOL_DEFINITIONS}`：FastAPI 直接把它序列化成 JSON。列表里的字典**原样**输出，键顺序就是字面量里的顺序（`name` → `description` → `parameters`）。

**与 TS 的对照**：

```ts
@Controller('tools')
@UseGuards(JwtAuthGuard)                 // ← 类级 Guard
export class ToolsController {
  @Get()
  list(): ToolListResponse {             // ← 静态类型来自契约
    return { items: TOOL_DEFINITIONS }
  }
}
```

机制差异：NestJS 用「**类 + 类级 Guard + 装饰器元数据**」；FastAPI 用「**函数 + 参数上的 `Depends`**」。目标一样：**未认证不给数据**。Python 侧没有 `response_model`，所以不会做运行期形状校验；形状靠 `TOOL_DEFINITIONS` 的字面量保证——这也是为什么实测能逐字段相等。

---

## 6. 【技术教学 · 首次】Python 侧 ReAct：条件边 + 环 + 按节点隔离的状态

### 6.1 状态：四个键，后三个都是「节点 id → 该节点的东西」

**关键代码（`apps/api-py/app/engine/engine.py`，逐字 + 讲解注释）**

```python
def _merge_dict(previous: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """合并 reducer：节点返回 `{<key>: {<nodeId>: <value>}}` 逐步累积。"""
    return {**previous, **update}                                              # ← 浅合并：update 的同名节点键覆盖旧值


class RunState(TypedDict):                                                     # ← 用类写法声明「状态字典」的形状（运行期仍是 dict）
    """变量池 + 三份**按节点 id 隔离**的状态（键为节点 id）。"""

    pool: Annotated[dict[str, Any], _merge_dict]                               # ← pool[nodeId] = 节点输出
    # 启用了工具的 llm 节点自己的消息数组（多轮共享同一份）
    messages: Annotated[dict[str, list[BaseMessage]], _merge_dict]             # ← messages[nodeId] = 该节点的完整对话历史
    # 该节点已执行的工具轮次数（从 1 开始计）
    rounds: Annotated[dict[str, int], _merge_dict]                             # ← rounds[nodeId] = 已执行到第几轮
    # 上一轮 LLM 产出的、尚未执行的工具调用（条件边的路由依据）
    tool_calls: Annotated[dict[str, list[ToolCallRequest]], _merge_dict]       # ← tool_calls[nodeId] = 待执行的调用列表
```

**这段在干什么（按执行顺序）**：

1. `_merge_dict(previous, update)`：一个**普通函数**，两个字典浅合并。它此刻只被定义，不执行。
2. `class RunState(TypedDict)`：声明状态的形状。运行期它就是个 `dict`，不产生对象、不校验。
3. 四个键各自用 `Annotated[类型, _merge_dict]` 挂上**同一个合并规则**。LangGraph 在**编译图时**读取这些注解，知道「这个键被更新时怎么合并」。
4. 每个键的值都是「字典」：`pool` 是 `nodeId → 输出`，`messages` 是 `nodeId → 消息列表`，`rounds` 是 `nodeId → 整数`，`tool_calls` 是 `nodeId → 调用列表`。**外层键（nodeId）就是隔离边界**。

**为什么必须这样隔离（讲透）**：

假设图里有 `llm1` 和 `llm2` 两个都启用工具的节点。如果 `messages` 退化成**一个列表**：

- `llm1` 第一轮把 `[system, user, assistant(tool_calls)]` 写进去；
- `llm1__tools` 把 `ToolMessage` 追加进去；
- 轮到 `llm2` 执行时，它读到的就是**`llm1` 的历史**——`llm2` 的 prompt 被淹没，甚至 `tool_call_id` 对不上。

用 `messages[nodeId]` 后，`llm1` 只读写 `messages["llm1"]`，`llm2` 只读写 `messages["llm2"]`，互不可见。

> 这正是 `sse-events.md` §4 那句「同一 `llm` 节点的多轮共享同一份消息数组，不同 `llm` 节点互不干扰」的实现方式。

**初始状态必须四个键都给**（`_run_graph` 里）：

```python
await compiled.ainvoke(
    {"pool": {"inputs": inputs}, "messages": {}, "rounds": {}, "tool_calls": {}},   # ← 四个键都显式给空
    config={"recursion_limit": max(25, max_rounds * 2 + len(graph["nodes"]) * 2 + 10)},
)
```

- `pool` 初始为 `{"inputs": <运行输入>}`（阶段 4 的约定）。
- 另外三个初始为 `{}`。**不能省**：`TypedDict` 没有默认值（这点与 TS 的 `Annotation({ default: () => ({}) })` 不同），省了之后 `state["messages"]` 可能直接 `KeyError`。

### 6.2 建图：跳过普通出边、加内部节点、加条件边与回边

**关键代码（`engine.py` 的 `_run_graph` 节选，逐字 + 讲解注释）**

```python
    context: dict[str, Any] = {"failed_node_id": None, "last_outputs": {}}
    max_rounds = _max_tool_rounds()                                            # ← 读 MAX_TOOL_ROUNDS（默认 5）
    # 启用了工具的 llm 节点：别的照旧，这些节点改成「条件边 + 环」
    tool_nodes = [
        node for node in graph["nodes"] if node["type"] == "llm" and _tool_names_of(node)
    ]                                                                          # ← 只挑 data.tools 非空的 llm 节点
    tool_node_ids = {node["id"] for node in tool_nodes}                        # ← 集合：后面 O(1) 判断
    try:
        builder = StateGraph(RunState)                                         # ← ① 建空图
        for node in graph["nodes"]:
            builder.add_node(node["id"], _make_node_action(node, queue, context, tool_node_ids))
            # ↑ 每个契约节点一个图节点；启用工具的 llm 会在 _make_node_action 里换成专用 action
        for node in tool_nodes:
            builder.add_node(
                f"{node['id']}__tools", _make_tools_action(node, queue, context, max_rounds)
            )                                                                  # ← ② 每个工具节点加一个内部执行节点
        for edge in graph["edges"]:
            # 启用了工具的 llm 节点改由条件边分派，跳过其普通出边（否则两者冲突）
            if edge["source"] in tool_node_ids:                                # ← ③ 关键：跳过 llm1 → end 这条普通边
                continue
            builder.add_edge(edge["source"], edge["target"])                   # ← 其它边照旧
        for node in tool_nodes:
            # 条件边 + 环：有 tool_calls 走内部工具节点，否则走原图下游（多条下游时取第一条）
            node_id = node["id"]
            downstream = _first_downstream(graph, node)                        # ← 取原图下游；没有则 END
            builder.add_conditional_edges(
                node_id,                                                       # ← 从哪个节点出发
                lambda state, nid=node_id: "tools"                             # ← router：读该节点自己的 tool_calls
                if (state["tool_calls"].get(nid) or [])
                else "continue",
                {"tools": f"{node_id}__tools", "continue": downstream},        # ← 映射字典：逻辑名 → 真实节点
            )
            builder.add_edge(f"{node_id}__tools", node_id)                     # ← ④ 回边（普通边）：形成环
        start_node = next(node for node in graph["nodes"] if node["type"] == "start")
        builder.add_edge(START, start_node["id"])                              # ← 虚拟入口 → start
        for node in graph["nodes"]:
            if node["type"] == "end":
                builder.add_edge(node["id"], END)                              # ← 每个 end → 虚拟出口
        compiled = builder.compile()
```

**这段在干什么（按执行顺序）**：

1. 先算出 `tool_nodes`：类型是 `llm` **且** `data.tools` 是非空列表的节点。只有这些节点才进入 ReAct 形态；其余节点（`start` / `end` / 没工具的 `llm`）行为与阶段 5 一模一样。
2. `tool_node_ids`：把它们的 id 放进 `set`，后面判断「这条边是不是从工具节点出发」时 O(1)。
3. `builder.add_node(...)`：所有契约节点都注册。`_make_node_action` 内部会判断「这个节点在不在 `tool_node_ids`」，是则返回专用 action（§6.4），否则返回普通 action（发一次 `node_started` / `node_finished`）。
4. 给每个工具节点加内部节点 `<id>__tools`（§6.5 的 action）。
5. 遍历契约边：**跳过 `source` 属于工具节点的普通出边**。以本图为例，`llm1 → end` 被跳过；`start → llm1` 保留。
6. 给每个工具节点加条件边：router 返回 `"tools"` 或 `"continue"`，第三个参数把这两个**逻辑名**翻译成真实节点名。
7. `add_edge(f"{node_id}__tools", node_id)`：内部工具节点执行完，**无条件**回到 LLM 节点。这就是环。
8. 接 `START → start` 与 `end → END`，最后 `compile()`。

**`downstream` 怎么来（`_first_downstream`）**：

```python
def _first_downstream(graph: dict[str, Any], node: dict[str, Any]) -> str:
    """取某节点的第一条下游边（没有则指向 `END`）。"""
    for edge in graph["edges"]:
        if edge["source"] == node["id"] and edge["target"] != node["id"]:      # ← 排除自环，避免把环当下游
            return edge["target"]
    return END                                                                 # ← 没有下游 → 直接结束
```

- 原图允许多条下游（例如 `llm1 → end` 与 `llm1 → 另一个节点`）。这里按契约边数组顺序**取第一条**。
- `END` 是 LangGraph 的特殊常量（字符串 `"__end__"`），可以作为条件边的目标。
- 排除 `target == node["id"]` 是为了不把「自环」误当成下游。

**编译后内省（实测）**：

| source | target | conditional | 含义 |
| --- | --- | --- | --- |
| `llm1` | `end` | `True` | 条件边的 `continue` 分支（映射出来的具体目标） |
| `llm1` | `llm1__tools` | `True` | 条件边的 `tools` 分支 |
| `llm1__tools` | `llm1` | `False` | 普通回边，形成环 |

### 6.3 router 里的 `lambda` 默认参数：一个必须知道的 Python 坑

看这一行：

```python
lambda state, nid=node_id: "tools" if (state["tool_calls"].get(nid) or []) else "continue"
```

**为什么要写 `nid=node_id`**：Python 的闭包**晚绑定（late binding）**——`lambda` 里的自由变量在**调用时**才取值。如果写成：

```python
lambda state: "tools" if state["tool_calls"].get(node_id) else "continue"
```

那么所有 router 都引用**同一个** `node_id` 变量；`for` 循环结束后它等于最后一个工具节点的 id，于是**每个节点的 router 都在读最后一个节点的 `tool_calls`**。默认参数 `nid=node_id` 在**定义 lambda 的那一刻**求值并绑定，相当于「快照」。

**TS 里对应什么**：TS 的 `for (const node of toolNodes)` 每次迭代都是**块级新变量**，箭头函数捕获的是当次迭代的 `node`，所以不会踩这个坑。这是 Python 从 TS 迁移时**最隐蔽**的差异之一。

### 6.4 LLM 节点（带工具）：发一次开始、多轮跑、最后一轮发结束

**关键代码（`engine.py` 的 `_make_llm_with_tools_action`，逐字 + 讲解注释）**

```python
    async def action(state: RunState) -> dict[str, Any]:
        node_id = node["id"]
        try:
            first_round = node_id not in state["messages"]                     # ← 该节点还没有消息 = 首轮
            if first_round:
                await queue.put(node_started(node_id, "llm"))                  # ← 只在首轮发 node_started
            history = (
                build_initial_messages(node, state["pool"])                    # ← 首轮：system + 渲染后的 prompt
                if first_round
                else state["messages"][node_id]                                # ← 后续轮：沿用该节点自己的历史
            )

            async def emit(text: str) -> None:                                 # ← 异步闭包：发 token
                await queue.put(token(node_id, text))

            step = await run_llm_step(node["data"], history, emit)             # ← 调一轮模型（可能产出 tool_calls）
            messages = [*history, step.assistant_message]                      # ← 列表解包：历史 + 本轮 assistant
            if step.tool_calls:                                                # ← 有工具调用
                return {
                    "messages": {node_id: messages},                           # ← 只更新消息
                    "tool_calls": {node_id: step.tool_calls},                  # ← 交给条件边路由
                }                                                              # ← 注意：不发 node_finished、不写 pool
            output: dict[str, Any] = {"text": step.text, "model": step.model}  # ← 最后一轮：组装节点输出
            if step.usage is not None:
                output["usage"] = step.usage
            await queue.put(node_finished(node_id, "llm", output))             # ← 只在最后一轮发 node_finished
            return {
                "messages": {node_id: messages},
                "tool_calls": {node_id: []},                                   # ← 清空：条件边下次走 continue
                "pool": {node_id: output},                                     # ← 写回变量池（end 节点要读）
            }
        except Exception:
            context["failed_node_id"] = node_id                                # ← 出错节点 = 这个 llm 节点
            raise
```

**这段在干什么（按执行顺序）**：

1. `first_round = node_id not in state["messages"]`：靠「该节点有没有历史」判断首轮。首次进来时 `messages` 里没有这个 key。
2. 首轮：发 `node_started`，用 `build_initial_messages` 构造 `[system?, user]`——user 是**渲染后的 prompt**（模板变量从 `pool` 取）。
3. 非首轮：直接取 `state["messages"][node_id]`——里面有上一轮的 assistant（含 `tool_calls`）和工具结果 `ToolMessage`。
4. `run_llm_step(...)`：调一轮模型，**边流式边发 token**，同时收集 `tool_calls`。
5. `messages = [*history, step.assistant_message]`：把本轮的 assistant 消息追加进历史。**必须追加**，否则下一轮模型不知道自己刚才要过工具。
6. 如果 `step.tool_calls` 非空：只返回 `messages` 与 `tool_calls`，**不**发 `node_finished`、**不**写 `pool`。条件边会看到 `tool_calls` 非空，转到 `llm1__tools`。
7. 如果为空：这是最后一轮。组装 `{text, model, usage?}`，发 `node_finished`，返回 `messages` + **清空的 `tool_calls`** + `pool` 输出。条件边看到空列表，走 `continue` → `end`。

**为什么 `node_finished` 只在最后一轮发**：契约 §3.1 要求「一个节点只发一对 started/finished」。中间轮次属于**节点内部**，前端不应看到「节点反复结束」。`text` 取**最后一轮**的文本（前几轮通常只有工具调用、没有正文）。

### 6.5 内部工具节点：执行、发事件、把结果追加为 `ToolMessage`

**关键代码（`engine.py` 的 `_make_tools_action`，逐字 + 讲解注释）**

```python
    async def action(state: RunState) -> dict[str, Any]:
        node_id = node["id"]
        round_no = (state["rounds"].get(node_id) or 0) + 1                     # ← 轮次 +1（从 1 开始）
        try:
            if round_no > max_rounds:                                          # ← 超限：直接按契约文案报错
                raise RunError(f"tool call rounds exceeded: {max_rounds}")
            messages = list(state["messages"].get(node_id) or [])              # ← 拷贝该节点当前历史
            for call in state["tool_calls"].get(node_id) or []:                # ← 本轮可能有多个调用（并行）
                started_at = time.perf_counter()                               # ← 计时（比 time.time 精度高，单调）
                try:
                    args = _parse_args_or_fail(call)                           # ← 严格解析参数
                except Exception:
                    # 参数解析失败也仍先发 `tool_call`（args 为 `{}`），保持事件顺序可读
                    await queue.put(tool_call(node_id, call.name, {}, round_no))
                    raise                                                      # ← 再上抛，走 run_failed
                await queue.put(tool_call(node_id, call.name, args, round_no)) # ← 发 tool_call（带 args 与 round）
                result = await _execute_tool_or_fail(call.name, args)          # ← 执行工具，失败归一为 RunError
                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                await queue.put(
                    tool_result(node_id, call.name, result, elapsed_ms, round_no)
                )                                                              # ← 发 tool_result（result 一定是字符串）
                messages.append(
                    ToolMessage(content=result, tool_call_id=call.id, name=call.name)
                )                                                              # ← 关键：把结果作为 ToolMessage 追加
            return {
                "messages": {node_id: messages},                               # ← 更新历史（含 tool 消息）
                "tool_calls": {node_id: []},                                   # ← 清空待执行列表
                "rounds": {node_id: round_no},                                 # ← 记录轮次
            }
        except Exception:
            context["failed_node_id"] = node_id                                # ← 出错节点 = 该 llm 节点（不是 __tools）
            raise
```

**这段在干什么（按执行顺序）**：

1. `round_no = (state["rounds"].get(node_id) or 0) + 1`：读该节点已执行轮次，+1。首次是 1。
2. 超限检查：`round_no > max_rounds` 抛 `RunError("tool call rounds exceeded: 5")`。**在真正执行工具之前**检查。
3. 取该节点历史并**拷贝**成新列表（后面 append 不影响旧状态）。
4. 遍历本轮所有调用（同一轮可能有多个，即并行工具调用）：
   - `time.perf_counter()` 开始计时。
   - `_parse_args_or_fail(call)` 严格解析参数；失败时**先发** `tool_call(..., {}, round)` 再抛，保证事件顺序仍是 `tool_call` → `run_failed`。
   - 发 `tool_call(nodeId, toolName, args, round)`。
   - `_execute_tool_or_fail` 执行工具；工具内部错误在这里被拼成 `tool {name} failed: {reason}`。
   - 发 `tool_result(..., result, elapsedMs, round)`。
   - **追加 `ToolMessage`**：`content=result`、`tool_call_id=call.id`、`name=call.name`。这三项缺一不可——下一轮模型要靠 `tool_call_id` 把结果对回自己刚才的调用。
5. 返回 `messages`（含新 tool 消息）、`tool_calls` 清空、`rounds` 更新。
6. 条件边下一轮看到 `tool_calls` 为空，走 `continue`；LLM 节点带着完整历史再跑一轮，产出最终文本。

**为什么工具失败时 `run_failed.nodeId` 是 `llm1` 而不是 `llm1__tools`**：`llm1__tools` 是**内部节点**，不是契约节点。契约要求 `run_failed.nodeId` 指向「出错节点」，对用户来说就是那个 LLM 节点。所以 `context["failed_node_id"] = node_id`（`node` 是外层闭包里的 LLM 节点）。

**同一轮多个工具是串行还是并行**：循环是 `for call in ...`，所以**按调用顺序串行**执行；但它们属于**同一个 `round`**。事件顺序是 `tool_call` → `tool_result` → `tool_call` → `tool_result`，不会交错。

### 6.6 一轮模型调用：`bind_tools` 与流式 `tool_call_chunks` 聚合

**关键代码（`apps/api-py/app/engine/nodes/llm.py` 的 `run_llm_step`，逐字 + 讲解注释）**

```python
    client = ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=settings.llm_base_url,                                        # ← OpenAI 兼容 base_url（必须含 /v1）
        timeout=settings.llm_timeout_ms / 1000,                                # ← Python SDK 的 timeout 单位是【秒】
        # 不重试（与 api-ts 的 maxRetries: 0 对齐，保证错误快速、归一）
        max_retries=0,
        **extra,                                                               # ← temperature / max_tokens 等可选参数
    )
    tool_defs = _resolve_tool_defs(data.get("tools"))                          # ← 工具名 → 定义（过滤未注册的）
    runnable = client.bind_tools(tool_defs) if tool_defs else client           # ← 有工具才绑定；返回 Runnable

    text = ""
    usage: dict[str, int] | None = None
    # 流式工具调用分片：按 `index` 聚合 id / name / 参数文本
    partial: dict[int, dict[str, str]] = {}
    try:
        async for chunk in runnable.astream(list(messages)):                   # ← 异步流式调用（≈ TS 的 stream）
            piece = _stringify_content(chunk.content)                          # ← 文本片段字符串化
            if piece:
                text += piece
                await emit(piece)                                              # ← 立刻发 token
            for tool_call_chunk in getattr(chunk, "tool_call_chunks", None) or []:
                # ↑ 每个 chunk 可能带若干「工具调用分片」；没有则为空
                index = tool_call_chunk.get("index")
                if not isinstance(index, int):
                    index = 0                                                  # ← 缺 index 归到 0（对齐 TS）
                current = partial.setdefault(index, {"id": "", "name": "", "args_text": ""})
                # ↑ setdefault：该 index 第一次出现时建累加器
                call_id = tool_call_chunk.get("id")
                if isinstance(call_id, str) and call_id != "":
                    current["id"] = call_id                                    # ← id 只取非空（通常第一片带）
                call_name = tool_call_chunk.get("name")
                if isinstance(call_name, str) and call_name != "":
                    current["name"] += call_name                               # ← name 逐片【拼接】
                call_args = tool_call_chunk.get("args")
                if isinstance(call_args, str):
                    current["args_text"] += call_args                          # ← 参数 JSON 文本逐片【拼接】
                partial[index] = current
            meta = getattr(chunk, "usage_metadata", None)                      # ← 最后一个 chunk 通常带 usage
            if isinstance(meta, dict) and isinstance(meta.get("input_tokens"), int):
                usage = {
                    "promptTokens": meta["input_tokens"],                      # ← 内部 snake → 契约 camelCase
                    "completionTokens": meta.get("output_tokens"),
                    "totalTokens": meta.get("total_tokens"),
                }
    except Exception as error:
        raise RunError(map_llm_error(error)) from error                        # ← 错误归一为规范文案（阶段 5 已讲）

    tool_calls: list[ToolCallRequest] = []
    for position, index in enumerate(sorted(partial)):                         # ← 按 index 升序还原调用顺序
        value = partial[index]
        tool_calls.append(
            ToolCallRequest(
                id=value["id"] if value["id"] != "" else f"call_{index}_{position}",  # ← id 缺失时兜底
                name=value["name"],
                args_text=value["args_text"],
            )
        )

    # 回填 assistant 消息（含 tool_calls），保证下一轮对话历史完整
    assistant_message = AIMessage(
        content=text,
        tool_calls=[
            {
                "id": call.id,
                "name": call.name,
                "args": _parse_args_leniently(call.args_text),                  # ← 宽松解析：非法也得给个 dict
                "type": "tool_call",
            }
            for call in tool_calls
        ],
    )
```

**这段在干什么（按执行顺序）**：

1. 构造 `ChatOpenAI`：`timeout` 用**秒**（环境变量是毫秒，所以 `/1000`）；`max_retries=0` 与 TS 对齐。
2. `_resolve_tool_defs(data["tools"])`：把工具名列表映射成定义列表。预检已保证名字都注册，这里再过滤一次是防御。
3. `client.bind_tools(tool_defs)`：把工具定义**绑到模型上**，返回一个 `Runnable`。它**不会**执行工具，只是让后续请求带上 `tools` 字段。
4. `async for chunk in runnable.astream(list(messages))`：真正调用。每个 chunk：
   - 文本片段：累加 `text`，**立即** `await emit(piece)` 发 `token`。
   - 工具调用分片：按 `index` 聚合。`id` 取非空值（通常只有第一片带，重复出现时以最后一片为准）；`name` 与 `args` 是**逐片拼接**的（OpenAI 流式协议会把一个工具调用拆成很多片）。
   - `usage_metadata`：最后一个 chunk 通常带 token 用量，转成契约的 `promptTokens` / `completionTokens` / `totalTokens`。
5. 流结束后，按 `sorted(partial)` 还原顺序，生成 `ToolCallRequest`（`args_text` 仍是**原始 JSON 文本**，不急着解析）。
6. 构造 `AIMessage`，把 `tool_calls` 回填进去。`args` 用**宽松解析**（解析失败给 `{}`）——真正报错留到执行工具时，保证事件顺序是 `tool_call` → `run_failed`。

**为什么参数要「宽松解析一次、严格解析一次」**：

| 阶段 | 函数 | 目的 | 失败时 |
| --- | --- | --- | --- |
| 构造 `AIMessage` | `_parse_args_leniently` | 让消息历史合法（`args` 必须是对象） | 返回 `{}`，不报错 |
| 执行工具前 | `_parse_args_or_fail` | 真正校验模型给的参数 | 抛 `RunError("tool X failed: invalid arguments")` |

如果第一步就用严格解析，非法参数会在**还没发 `tool_call`** 时就抛错，事件顺序变成 `node_started` → `run_failed`，与契约 §3.1（先 `tool_call` 再失败）不符。

### 6.7 事件：`tool_call` / `tool_result` 的 payload

**完整文件路径：`apps/api-py/app/engine/events.py`（新增的两个构造器，逐字 + 注释）**

```python
def tool_call(
    node_id: str, tool_name: str, args: dict[str, Any], round_no: int
) -> dict[str, Any]:
    """`tool_call`（`round` 从 1 开始）。"""
    return {
        "event": "tool_call",
        "data": {"nodeId": node_id, "toolName": tool_name, "args": args, "round": round_no},
        # ↑ 键名 camelCase：这是【协议字段】，不是内部状态，两端必须一致
    }


def tool_result(
    node_id: str, tool_name: str, result: str, elapsed_ms: int, round_no: int
) -> dict[str, Any]:
    """`tool_result`（`result` 一律为字符串）。"""
    return {
        "event": "tool_result",
        "data": {
            "nodeId": node_id,
            "toolName": tool_name,
            "result": result,                                                  # ← 一定是字符串（http_get 的 body 文本、calculator 的数字）
            "elapsedMs": elapsed_ms,                                            # ← 唯一允许两端不同的执行耗时
            "round": round_no,
        },
    }
```

**这段在干什么**：两个纯构造函数，把「事件名 + payload」拼成引擎内部表示；之后统一由 `format_sse_frame` 序列化。**注意区分两套命名**：

- **协议字段**（`nodeId` / `toolName` / `args` / `round` / `elapsedMs`）——camelCase，两端必须一致；
- **内部状态**（`tool_calls` / `args_text` / `round_no`）——Python 用 snake_case，TS 用 camelCase，**不进协议**，所以不影响逐字节比对。

### 6.8 单工具运行的完整时序（对照事件）

以 `llm1.data.tools = ["calculator"]`、prompt 里含 `[[call:calculator:{"expression":"6+8"}]]` 为例（mock provider）：

| # | 事件 | 关键 payload | 谁发出 |
| --- | --- | --- | --- |
| 1 | `run_started` | `runId` / `appId` | `run_stream` |
| 2 | `node_started` | `nodeId:"start"` | start action |
| 3 | `node_finished` | `output:{"inputs":{}}` | start action |
| 4 | `node_started` | `nodeId:"llm1"` | 带工具的 llm action（**首轮**） |
| 5 | `tool_call` | `toolName:"calculator"`、`args:{"expression":"6+8"}`、`round:1` | `llm1__tools` |
| 6 | `tool_result` | `result:"14"`、`round:1` | `llm1__tools` |
| 7 | `token` | `"answer: "` | 带工具的 llm action（**第二轮**） |
| 8 | `token` | `"14"` | 同上 |
| 9 | `node_finished` | `output:{"text":"answer: 14","model":"mock-model","usage":{...}}` | 同上（**最后一轮**） |
| 10 | `node_started` | `nodeId:"end"` | end action |
| 11 | `node_finished` | `output:{"outputs":{"result":"answer: 14"}}` | end action |
| 12 | `run_finished` | `outputs:{"result":"answer: 14"}`、`elapsedMs` | `_run_graph` |

> `token` 为什么是两片：mock 按**每 5 个码点**分片，`"answer: 14"` → `"answer: "` + `"14"`。这与阶段 5 的回归口径完全一致。

---

## 7. 【加厚】与 NestJS / TS 侧的对照（讲差异，不只列名）

### 7.1 工具层的对照

| 关注点 | NestJS / TS | FastAPI / Python | 机制差异（重点） |
| --- | --- | --- | --- |
| 路由 | `@Controller('tools')` + `@Get()` | `APIRouter(tags=[...])` + `@router.get("/tools")` | Controller 是**类**；APIRouter 是**对象**，路由挂在普通函数上 |
| 鉴权 | `@UseGuards(JwtAuthGuard)`（类级元数据） | `current_user: User = Depends(get_current_user)`（**函数参数**） | Guard 由框架在方法调用前按元数据执行；`Depends` 是「声明式前置函数」，粒度到**每个路由** |
| 工具定义 | `TOOL_DEFINITIONS: ToolDefinition[]`（编译期类型来自契约包） | `TOOL_DEFINITIONS: list[dict[str, Any]]`（只是注解，**不做运行期校验**） | TS 有共享类型包；Python 没有，形状靠字面量 + 测试保证 |
| 定义内容 | `{name, description, parameters}` | 同左（逐字段相同） | 都是**纯数据**，因此 `GET /tools` 能逐字段相等 |
| 分派 | `switch (name)` + `throw new Error` | `if name == ...` + `raise ValueError` | 语义同；Python 的 `executeTool` 必是 `async`，TS 也返回 `Promise<string>` |
| 工具失败 | `class ToolError extends Error` + `instanceof` 判断 | `class ToolError(Exception)` + 多个 `except` 顺序判断 | TS 一个 `catch` 里做 `instanceof`；Python 靠 `except` **从上到下匹配**，子类必须写前面 |
| HTTP 工具 | `fetch` + `AbortController` + `getReader()` | `httpx.AsyncClient` + `stream` + `aiter_bytes()` | `fetch` 默认跟随重定向、超时靠手动取消；`httpx` 默认**不**跟随、超时是构造参数（秒） |
| 同步/异步工具 | 所有工具都是 `async`（返回 Promise） | `calculator` / `get_current_time` 是**同步**，`http_get` 是异步 | Python 可以在同一个异步入口里「同步直接 return、异步 await」；TS 统一 `async` 更省心 |

### 7.2 ReAct / LangGraph 的对照

| 关注点 | TS（`engine.service.ts`） | Python（`engine.py`） | 机制差异（重点） |
| --- | --- | --- | --- |
| 状态定义 | `Annotation.Root({...})`——**运行期对象** | `class RunState(TypedDict)`——**类型声明**，运行期是 `dict` | TS 用对象承载 reducer；Python 用 `Annotated` 元数据承载 |
| 状态默认值 | 每个 `Annotation({ default: () => ({}) })` | **没有默认值**，`ainvoke` 必须显式给四个键 | Python 的 `TypedDict` 不会自动补键，漏了会 `KeyError` |
| 状态键命名 | `pool` / `messages` / `rounds` / `toolCalls` | `pool` / `messages` / `rounds` / `tool_calls` | 内部状态命名不同；**协议 payload 不受影响** |
| 加节点 | `builder.addNode(id, fn)` | `builder.add_node(id, fn)` | 驼峰 vs 下划线 |
| 加条件边 | `builder.addConditionalEdges(source, path, pathMap)` | `builder.add_conditional_edges(source, router, mapping)` | 第三个参数都是「逻辑名 → 实际节点」的映射字典 |
| 加普通边 | `builder.addEdge(from, to)` | `builder.add_edge(from, to)` | 同 |
| 执行 | `compiled.invoke(initial, { recursionLimit })`（**同步**） | `await compiled.ainvoke(initial, config={"recursion_limit": ...})`（**异步**） | Python 的 `a` 前缀 = async；参数名从 camelCase 变 snake_case |
| 事件外发 | 自建 `RunEventQueue`（`emit` / `drain`） | 自建 `asyncio.Queue`（`put` / `get`） | TS 单线程同步入队；Python 必须 `await put/get` |
| 绑定工具 | `client.bindTools(toolDefs)` | `client.bind_tools(tool_defs)` | 同一个 API 的两种命名；都接收 `{name, description, parameters}` 形状 |
| 流式调用 | `await runnable.stream(messages)` + `for await` | `async for chunk in runnable.astream(messages)` | TS 的 `stream` 返回 AsyncIterable；Python 的 `astream` 是异步生成器 |
| 工具调用分片 | `chunk.tool_call_chunks`（对象数组） | `chunk.tool_call_chunks`（**dict 数组**） | Python 的 LangChain 用字典；字段名 `index` / `id` / `name` / `args` 相同 |
| 工具结果消息 | `new ToolMessage({ content, tool_call_id, name })` | `ToolMessage(content=result, tool_call_id=call.id, name=call.name)` | 构造参数写法不同，语义相同 |
| 轮次上限 | `process.env.MAX_TOOL_ROUNDS`（`import 'dotenv/config'` 载入 `.env`） | `settings.max_tool_rounds`（pydantic-settings 读 `.env`） | 同一个环境变量名，**两者现在都能读 `.env`**；Py 侧不能直接读 `os.environ`——pydantic-settings 不回写进程环境 |
| 递归上限 | `recursionLimit` | `recursion_limit` | 同一个 LangGraph 概念 |

### 7.3 为什么这些差异不会破坏「逐字节一致」

1. **协议字段由同一份 `sse-events.md` 定义**：两端构造事件时都写 `nodeId` / `toolName` / `args` / `round` / `result` / `elapsedMs`，不把自己的内部命名漏出去。
2. **值规范由纯函数对齐**：`_format_number` 对齐 `String(number)`；`iso_z` 对齐 `toISOString()`；`_js_string` 对齐 `String(value)`；`json.dumps(..., separators=(",", ":"), ensure_ascii=False)` 对齐 `JSON.stringify`。
3. **事件顺序由同一套图拓扑决定**：两端的条件边、回边、跳过普通出边的规则**逐条对应**，所以 `llm1__tools` 的插入位置一致。
4. **天生不同的只有三类值**：`runId`（每次随机 UUID）、`appId`（两个数据库里的应用 id 不同）、`elapsedMs`（执行耗时）。对比时必须先归一化这三项。

---

## 8. 【加厚】本篇首次出现的 Python 机制

### 8.1 `@tool` / 字典注册表 vs TS 的 `TOOL_DEFINITIONS` 数组

**是什么**：LangChain 提供了一个 `@tool` 装饰器，把一个普通函数变成 `BaseTool` 对象，并从**函数签名 + docstring** 自动推断参数 Schema：

```python
# 最小示例 · 非项目文件：@tool 的用法
from langchain_core.tools import tool

@tool
def calculator(expression: str) -> str:
    """安全地计算一个四则运算表达式。"""
    return str(eval(expression))          # ⚠️ 仅演示装饰器，真实项目绝不能用 eval

model.bind_tools([calculator])            # 直接传 BaseTool 对象
```

**TS 里对应什么**：`@langchain/core/tools` 的 `tool(fn, { name, description, schema })`，通常配 `zod` 定义参数；`bindTools([myTool])`。

**这里为什么不用 `@tool`**（这是本篇最需要讲清的一个取舍）：

1. **Schema 必须逐字段可控**。`@tool` 自动生成的描述、参数说明、`required`、`additionalProperties` 与契约未必一致；而 `GET /tools` 必须两端逐字段相等。
2. **工具定义是「契约数据」**，不是「代码的副产品」。本项目的 `TOOL_DEFINITIONS` 是 JSON 形状的常量，既能返回给前端，又能直接交给模型。
3. **两端结构要能逐行对照**。TS 侧本来就没有「装饰器自动生成 Schema」这一步；Python 侧若用 `@tool`，两边就变成两套心智。
4. **错误语义要统一**。这里工具失败统一抛 `ToolError(reason)`，由引擎拼文案；`@tool` 体系更偏向抛 `ToolException` 并配置 `handle_tool_error`，会多一层框架行为。

所以本项目的「注册表」是**字典（数据）列表**，不是 `BaseTool` 列表。`execute_tool` 用显式 `if` 分派，**不依赖 LangChain 的工具执行器**——这样事件顺序（`tool_call` → `tool_result`）完全由我们自己控制。

> 结论：`@tool` 是 LangChain 的**可选便利**，不是「Python 工具调用的必答题」。本项目选择「数据 + 纯函数」，与 TS 的 `TOOL_DEFINITIONS` 数组完全同构。

### 8.2 `ToolError(Exception)` 与 `except` 捕获顺序

**是什么**：Python 用「继承 `Exception` 的类」定义自定义异常；`except` **从上到下匹配第一个**能接住的类型。子类必须写在父类前面，否则会被父类「截胡」。

```python
# 最小示例 · 非项目文件：except 顺序
class ToolError(Exception):
    pass

try:
    risky()
except ToolError:                 # ✅ 子类在前：优先精确捕获
    raise                          # 裸 raise：原样继续上抛，保留 traceback
except TimeoutError as error:      # 具体的内置异常
    raise ToolError("timeout") from error   # from：记录「因果链」
except Exception as error:         # ⚠️ 兜底必须最后
    raise ToolError("error") from error
```

**TS 里对应什么**：

```ts
try {
  risky()
} catch (error) {
  if (error instanceof ToolError) throw error          // 一个 catch 里按类型分流
  if (isTimeout(error)) throw new ToolError('timeout')
  throw new ToolError('error')
}
```

**这里为什么这么写**：

- `http_get` 里 `ToolError`（`too large` / `not allowed`）必须**原样上抛**；如果把它落到 `except Exception`，就会被改写成 `error`，契约文案直接错。
- `httpx.TimeoutException` 是 `Exception` 的子类，所以必须写在 `Exception` 前面。
- `raise ... from error` 不是装饰：它把原始异常挂在 `__cause__` 上，排错时能看到「真正的底层错误」。`str(RunError)` 仍然只取我们拼的 message，所以不影响协议。
- 引擎里 `_execute_tool_or_fail` 同样遵循这个顺序：`except ToolError` → `except Exception`。

### 8.3 `httpx` 的异步客户端（`async with` + `timeout`） vs TS `fetch`

**是什么**：`httpx.AsyncClient` 是一个**异步 HTTP 客户端对象**，支持连接池、默认头、超时、重定向策略；它实现了异步上下文管理器，所以能 `async with` 自动关闭。

```python
# 最小示例 · 非项目文件：httpx 异步流式 GET
import httpx

async def fetch_text(url: str) -> str:
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
        async with client.stream("GET", url) as response:
            chunks = []
            async for chunk in response.aiter_bytes():
                chunks.append(chunk)
            return b"".join(chunks).decode("utf-8", errors="replace")
```

**TS 里对应什么**：

```ts
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 5000)
try {
  const response = await fetch(url, { signal: controller.signal })
  const reader = response.body!.getReader()
  const { value } = await reader.read()
  return new TextDecoder().decode(value)
} finally {
  clearTimeout(timer)
}
```

**这里为什么这么写**：

- **超时单位**：`httpx` 的 `timeout` 是**秒**；项目配置 `LLM_TIMEOUT_MS` 是毫秒，所以代码里 `/1000`。TS 的 `fetch` 没有 `timeout` 选项，只能 `AbortController`。
- **重定向**：`fetch` 默认跟随，`httpx` 默认**不**跟随；必须显式 `follow_redirects=True`，否则两端对 301 的结果不同。
- **流式**：`client.stream(...)` 先只拿响应头，`aiter_bytes()` 才逐块读 body。这样「超过 64KB 就中止」才能真的**不读进内存**。
- **异常映射**：`httpx.TimeoutException` → `timeout`；其它 → `error`。这与 TS 的 `AbortError` → `timeout` 对应。
- **资源释放**：`async with` 在异常路径也会关闭连接——不需要像 TS 那样手写 `finally`（但仍要 `finally clearTimeout`）。

### 8.4 `Annotated` + 合并 reducer 在条件边 / 环里的作用

**是什么**：`Annotated[T, metadata]` 给类型 `T` 附加一段元数据。LangGraph 把「reducer 函数」当作这个元数据，在每次状态更新时调用：

```text
新状态[键] = reducer(旧状态[键], 节点返回的增量[键])
```

**TS 里对应什么**：`Annotation<T>({ reducer, default })`——用**运行期对象**承载同样的信息。

**这里为什么这么写（本篇聚焦「按节点隔离的 `dict` 状态」）**：

- 环意味着 `llm1` 会被执行多次，每次都更新 `messages` / `rounds` / `tool_calls`。**没有 reducer** 时，LangGraph 对同键更新采用「后写覆盖」，`messages` 会被本轮的新列表整体替换——看起来单节点也能跑，但**多节点时会把别的节点的消息抹掉**。
- 有了 `_merge_dict`，更新 `{"llm1": [...]}` 只是**并入**外层字典，`messages["llm2"]` 原样保留。
- 每个节点的**内层值**（消息列表、轮次、调用列表）由该节点自己的 action 负责「完整写回」：例如 `_make_tools_action` 返回 `messages[nodeId] = 拷贝 + 新 ToolMessage`。reducer 只负责**外层合并**，不负责内层追加——这是理解本设计的关键。
- `pool` 与阶段 4 一样，靠 reducer 累积各节点输出；`end` 节点读 `pool["llm1"]` 拿最终文本。

**一句话**：`Annotated[...]` 管「**不同节点之间不要互相覆盖**」，节点 action 管「**自己这个键的完整值是什么**」。两者配合，环才能安全地转。

### 8.5 `add_conditional_edges` 的第三个参数（映射字典）

**是什么**：

```python
builder.add_conditional_edges(
    "llm1",                                  # 起点
    router,                                  # (state) -> "tools" | "continue"
    {"tools": "llm1__tools", "continue": "end"},   # 逻辑名 → 真实节点名
)
```

router **只表达语义**（「要工具」还是「继续」），映射字典负责**拓扑**（这两个语义分别去哪）。如果 router 返回了映射里没有的键，编译/运行会报错。

**TS 里对应什么**：

```ts
builder.addConditionalEdges('llm1', router, {
  tools: 'llm1__tools',
  continue: 'end',
})
```

**这里为什么这么写**：

- `continue` 的目标是**运行时算出来的**（`_first_downstream`），可能不同图不同；映射字典让 router 不必知道具体节点名。
- `tools` 的目标固定是 `<id>__tools`，但写在映射里后，拓扑一眼可见。
- 条件边的目标可以是 `END`（`_first_downstream` 没有下游时），所以「无下游」也能统一处理。

### 8.6 `bind_tools`（Python）与 `bindTools`（TS）的差异

| 关注点 | TS `bindTools` | Python `bind_tools` | 说明 |
| --- | --- | --- | --- |
| 命名 | camelCase | snake_case | 同一 API |
| 入参 | `ToolDefinition[]`（`{name, description, parameters}`） | 同样的 `list[dict]`，也可传 `BaseTool` 列表 | 本项目传**原始契约定义** |
| 返回值 | 新的 Runnable（不修改原 client） | `RunnableBinding`（不修改原 client） | 都是**不可变**风格：绑完得到新对象 |
| 执行 | `runnable.stream(messages)` | `runnable.astream(messages)` | Python 的 `a` 前缀 = async |
| 分片字段 | `chunk.tool_call_chunks`（对象） | `chunk.tool_call_chunks`（**dict**） | 字段名相同，访问方式不同（`.index` vs `.get("index")`） |
| 结果消息 | `new ToolMessage({...})` | `ToolMessage(...)` | 语义相同 |

**为什么 Python 能直接吃 `TOOL_DEFINITIONS`**：LangChain 会把 `{name, description, parameters}` 转成 OpenAI 的 `{"type":"function","function":{...}}`。所以契约里的 JSON Schema **不需要**再手写一遍。TS 的 `bindTools` 同样接受这个形状。

### 8.7 额外三个小机制（读源码时会遇到）

| 机制 | 是什么 | TS 里对应 | 本篇为什么出现 |
| --- | --- | --- | --- |
| **lambda 默认参数捕获** | `lambda state, nid=node_id: ...` 在定义时把 `node_id` 快照进 `nid` | `for (const node of ...)` 的块级作用域 | 避免闭包晚绑定导致所有 router 读最后一个节点（§6.3） |
| **`next(生成器, 默认值)`** | 取生成器第一个值；没有则返回默认值，不抛 `StopIteration` | `array.find(...) ?? undefined` | `get_tool_definition` / 找 `start` 节点 |
| **`f"{value:.12g}"`** | 格式说明符：12 位有效数字、自动选择定点/科学计数 | `value.toPrecision(12)` | `calculator` 数值字符串化对齐 JS |

---

## 9. 【加厚】写错会怎样

### 9.1 条件边与原普通边**同时存在** → 路径重复 / 死循环

**现象**：

- 模型明明要了工具，`end` 也照样执行了（甚至 `run_finished` 先于 `tool_result`）；
- 或者同一轮里 `llm1__tools` 与 `end` 都被调度，事件序列出现「两个分支交错」；
- 严重时环与下游互相触发，直到 `GraphRecursionError`。

**原因**：LangGraph 对「一个节点的多条出边」是**同时生效**的，不是「二选一」。如果原图的 `llm1 → end` 还在，它和条件边 `llm1 → {tools|continue}` 会一起被考虑，于是 `end` 被无条件执行。

**正解**（源码里的那行）：

```python
for edge in graph["edges"]:
    if edge["source"] in tool_node_ids:      # ← 工具节点的普通出边全部跳过
        continue
    builder.add_edge(edge["source"], edge["target"])
```

**验证**：编译后 `llm1` 的出边只有两条，且都是 `conditional=True`（§3.2）。

### 9.2 `messages` 不按 `nodeId` 隔离 → 多个 llm 节点「串话」

**现象**：

- 第二个 LLM 节点一上来就「记得」第一个节点的对话；
- 两个节点的 `tool_call_id` 对不上，真实 provider 可能直接 400；
- 最终文本混入了另一个节点的 prompt/工具结果。

**原因**：把 `messages` 写成单一 `list[BaseMessage]`，所有节点共用一条历史。环里的 `llm1` 与 `llm2` 都会往里追加。

**正解**：

```python
messages: Annotated[dict[str, list[BaseMessage]], _merge_dict]   # ← nodeId → 该节点历史
...
history = state["messages"][node_id]                              # ← 只读自己的
return {"messages": {node_id: messages}}                          # ← 只写自己的
```

**验证**：同一张图放两个带工具的 `llm` 节点，分别跑，两个节点的 `messages` 键各自独立；`GET` 不到对方的历史。

### 9.3 `ToolMessage` 不追加 → 模型反复要同一个工具

**现象**：

- 每一轮模型都返回同样的 `tool_calls`，`round` 一路涨到上限；
- 最终 `run_failed`：`tool call rounds exceeded: 5`；
- 真实 provider 还可能直接报错：`tool_calls` 后面必须跟 `tool` 消息。

**原因**：只把 `assistant_message`（含 `tool_calls`）追加进历史，却没把工具结果作为 `ToolMessage` 追加。模型看到「自己上次要了工具，但对话里没有结果」，只能再要一次。

**正解**：

```python
messages.append(
    ToolMessage(content=result, tool_call_id=call.id, name=call.name)
)
```

三个字段缺一不可：

- `content`：工具返回值（字符串）；
- `tool_call_id`：与 `AIMessage.tool_calls[i].id` **严格对应**；
- `name`：工具名（便于模型理解，也便于调试）。

**另一个必须做的收尾**：工具执行完把 `tool_calls` 清空（`{node_id: []}`）。否则条件边下一轮仍看到旧调用，会**再次**进入工具节点，重复执行同一个工具。

### 9.4 忘记轮次上限 → 无限循环

**现象**：

- SSE 一直不结束，`tool_call` / `tool_result` 不断刷；
- 最终可能收到 `run_failed`，但 message 是 LangGraph 的 `GraphRecursionError` 之类——**不是**契约文案；
- 两端在这一步的文案可能不同，验收直接失败。

**原因**：模型（或 mock 的标记）可以永远要工具；图里的环 `llm1 → llm1__tools → llm1` 没有自然出口。

**正解（双保险）**：

1. **业务上限**：`rounds` 计数 + `if round_no > max_rounds: raise RunError(f"tool call rounds exceeded: {max_rounds}")`。这是契约文案，两端一致。
2. **框架上限**：`recursion_limit = max(25, max_rounds * 2 + len(nodes) * 2 + 10)`。每轮工具调用占 2 个 superstep（LLM + tools），所以按轮次放大；避免 LangGraph 默认 25 步先触发、抢在业务上限之前报框架错误。

**为什么两个都要**：业务上限保证「文案可控」；框架上限保证「即使业务逻辑写错，也不会真的把进程转死」。

**读取方式也是坑**：`_max_tool_rounds()` 必须经 `Settings.max_tool_rounds` 读取，不能直接 `os.environ.get("MAX_TOOL_ROUNDS")`——pydantic-settings 只把 `.env` 读进 `Settings` 对象、**不回写进程环境**，直接读 `os.environ` 会让 `.env` 里的值**静默失效**（永远用默认 5）。改完 `.env` 后仍需**重启后端**。

### 9.5 其它三个常见误写

| 误写 | 现象 | 原因 / 正解 |
| --- | --- | --- |
| 初始状态漏给 `messages` / `rounds` / `tool_calls` | 首个工具节点 `KeyError`，或 router 读不到键 | `TypedDict` 无默认值；`ainvoke` 必须四个键都给（§6.1） |
| 用 `state["tool_calls"][node_id]` 而不是 `.get(...)` | 节点第一次执行就 `KeyError` | 初始是 `{}`；用 `.get(node_id) or []` |
| 在 `run_llm_step` 里严格解析参数 | 事件顺序变成 `node_started` → `run_failed`，缺 `tool_call` | 构造 `AIMessage` 用宽松解析；严格解析放到 `_parse_args_or_fail`（§6.6） |
| 工具轮次上限直接读 `os.environ`、绕开 `Settings` | `.env` 里写的 `MAX_TOOL_ROUNDS` 静默失效，永远用默认 5 | 走 `Settings.max_tool_rounds`：`int` 转换由 pydantic-settings 负责（非法值启动即报错），`_max_tool_rounds()` 只再兜底正数校验 |
| 多个 `end` 节点时随便取一个 | `run_finished.outputs` 与 TS 不一致 | 与阶段 4 一样，取**拓扑序最后一个**被执行的 `end`（`context["last_outputs"]` 覆盖） |

---

## 10. 完整代码（逐字照抄）

> 本节所有代码块都是**源码原文**，不加讲解注释（讲解注释版见 §5 / §6）。文件路径在每块上方标注。

### 10.1 `apps/api-py/app/tools/__init__.py`

**完整文件路径：`apps/api-py/app/tools/__init__.py`**

```python
"""内置工具（阶段 6），与 api-ts 的 `apps/api-ts/src/tools/` 对齐。

工具定义（`registry.TOOL_DEFINITIONS`）与执行结果一律为字符串；
工具内部失败抛 `ToolError(reason)`，由引擎拼成 `tool {name} failed: {reason}`。
"""
```

### 10.2 `apps/api-py/app/tools/tool_error.py`

**完整文件路径：`apps/api-py/app/tools/tool_error.py`**

```python
"""工具执行失败（见 error-messages.md §6.2）。

`reason` 只能取契约规定的固定值；引擎据此拼出
`tool {name} failed: {reason}`，两端逐字节一致。
"""

from typing import Literal

ToolFailureReason = Literal["invalid arguments", "timeout", "not allowed", "too large", "error"]


class ToolError(Exception):
    """工具内部失败：`reason` 为契约固定的五个取值之一。"""

    def __init__(self, reason: ToolFailureReason) -> None:
        super().__init__(reason)
        self.reason = reason
```

### 10.3 `apps/api-py/app/tools/calculator.py`

**完整文件路径：`apps/api-py/app/tools/calculator.py`**

```python
"""`calculator`：对 `{ expression: string }` 做**安全**四则运算求值。

与 api-ts 的 `calculator.tool.ts` 逐字对齐：不使用 `eval` / `exec`，而是手写
最小递归下降解析器，支持 `+ - * /`、括号、小数与一元正负号。
语法或数值非法（如 `2+`、除零）一律抛 `ToolError("invalid arguments")`。
"""

import math
import re
from typing import Any

from app.tools.tool_error import ToolError


def run_calculator(args: dict[str, Any]) -> str:
    expression = args.get("expression")
    if not isinstance(expression, str) or expression.strip() == "":
        raise ToolError("invalid arguments")
    value = _ExpressionParser(expression).parse()
    if math.isnan(value) or math.isinf(value):
        raise ToolError("invalid arguments")
    return _format_number(value)


def _format_number(value: float) -> str:
    """数值字符串化：消除浮点噪声（如 0.1+0.2 → "0.3"），并把 -0 归一为 "0"。"""
    if value == 0:
        return "0"
    # 对齐 JS 的 `Number(value.toPrecision(12))`
    normalized = float(f"{value:.12g}")
    # 对齐 JS `String(number)`：整数不带 ".0"
    if normalized.is_integer() and abs(normalized) < 1e21:
        return str(int(normalized))
    # Python repr 的指数会补零（1e-07），JS 不补（1e-7）
    return re.sub(r"e([+-])0+(\d+)", r"e\1\2", repr(normalized))


class _ExpressionParser:
    """最小表达式解析器（递归下降）：expression := term (('+'|'-') term)*。"""

    def __init__(self, text: str) -> None:
        self.text = text
        self.position = 0

    def parse(self) -> float:
        value = self._parse_expression()
        self._skip_spaces()
        if self.position < len(self.text):
            raise ToolError("invalid arguments")
        return value

    def _parse_expression(self) -> float:
        value = self._parse_term()
        while True:
            self._skip_spaces()
            char = self._char()
            if char == "+":
                self.position += 1
                value += self._parse_term()
            elif char == "-":
                self.position += 1
                value -= self._parse_term()
            else:
                return value

    def _parse_term(self) -> float:
        value = self._parse_unary()
        while True:
            self._skip_spaces()
            char = self._char()
            if char == "*":
                self.position += 1
                value *= self._parse_unary()
            elif char == "/":
                self.position += 1
                divisor = self._parse_unary()
                if divisor == 0:
                    raise ToolError("invalid arguments")
                value /= divisor
            else:
                return value

    def _parse_unary(self) -> float:
        self._skip_spaces()
        char = self._char()
        if char == "+":
            self.position += 1
            return self._parse_unary()
        if char == "-":
            self.position += 1
            return -self._parse_unary()
        return self._parse_primary()

    def _parse_primary(self) -> float:
        self._skip_spaces()
        if self._char() == "(":
            self.position += 1
            value = self._parse_expression()
            self._skip_spaces()
            if self._char() != ")":
                raise ToolError("invalid arguments")
            self.position += 1
            return value
        return self._parse_number()

    def _parse_number(self) -> float:
        start = self.position
        seen_dot = False
        while self.position < len(self.text):
            char = self.text[self.position]
            if "0" <= char <= "9":
                self.position += 1
            elif char == "." and not seen_dot:
                seen_dot = True
                self.position += 1
            else:
                break
        text = self.text[start : self.position]
        if text == "" or text == ".":
            raise ToolError("invalid arguments")
        try:
            value = float(text)
        except ValueError as error:
            raise ToolError("invalid arguments") from error
        return value

    def _char(self) -> str:
        """当前位置字符（越界返回空串，与 JS 的 `input[position]` 为 undefined 对齐）。"""
        return self.text[self.position] if self.position < len(self.text) else ""

    def _skip_spaces(self) -> None:
        while self.position < len(self.text) and self.text[self.position].isspace():
            self.position += 1
```

### 10.4 `apps/api-py/app/tools/current_time.py`

**完整文件路径：`apps/api-py/app/tools/current_time.py`**

```python
"""`get_current_time`：无参数，返回当前 UTC 时间。

格式与全站一致：ISO-8601、毫秒精度、以 `Z` 结尾（固定 24 字符），
复用 `app.timefmt.iso_z`，与 api-ts 的 `new Date().toISOString()` 逐字节一致。
"""

from datetime import UTC, datetime

from app.timefmt import iso_z


def run_get_current_time() -> str:
    return iso_z(datetime.now(UTC))
```

### 10.5 `apps/api-py/app/tools/http_get.py`

**完整文件路径：`apps/api-py/app/tools/http_get.py`**

```python
"""`http_get`：对 `{ url: string }` 发起 GET，返回响应体文本。

与 api-ts 的 `http-get.tool.ts` 对齐的安全约束：
- 仅允许 `http:` / `https:` 协议，否则 `not allowed`；
- 5s 超时 → `timeout`；
- 响应体超过 64KB → `too large`（读取过程中即中止，不把大响应读进内存）；
- 其它异常 → `error`。
"""

from typing import Any
from urllib.parse import urlsplit

import httpx

from app.tools.tool_error import ToolError

# 响应体上限：64KB（见契约 §6.2 的 `too large`）
MAX_BODY_BYTES = 64 * 1024

# 超时：5 秒（见契约 §6.2 的 `timeout`）
TIMEOUT_SECONDS = 5.0


async def run_http_get(args: dict[str, Any]) -> str:
    url = args.get("url")
    if not isinstance(url, str) or url == "":
        raise ToolError("invalid arguments")
    try:
        target = urlsplit(url)
    except ValueError as error:
        raise ToolError("invalid arguments") from error
    if target.scheme not in ("http", "https"):
        # `file:` 等协议 → not allowed；无协议（如 "foo"，对应 `new URL` 抛错）→ invalid arguments
        raise ToolError("not allowed" if target.scheme else "invalid arguments")
    if not target.netloc:
        # 如 "http://"（对应 `new URL` 抛错）→ invalid arguments
        raise ToolError("invalid arguments")

    try:
        async with (
            httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=True) as client,
            client.stream("GET", url) as response,
        ):
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > MAX_BODY_BYTES:
                    raise ToolError("too large")
                chunks.append(chunk)
            return b"".join(chunks).decode("utf-8", errors="replace")
    except ToolError:
        raise
    except httpx.TimeoutException as error:
        raise ToolError("timeout") from error
    except Exception as error:
        raise ToolError("error") from error
```

### 10.6 `apps/api-py/app/tools/registry.py`

**完整文件路径：`apps/api-py/app/tools/registry.py`**

```python
"""内置工具注册表（唯一真源，见 packages/contract/openapi.yaml 的 `ToolDefinition`）。

与 api-ts 的 `tools/registry.ts` 逐字段对齐：`TOOL_DEFINITIONS[].parameters` 是
JSON Schema 形状，可直接作为 OpenAI function calling 的 `parameters` 交给模型；
`execute_tool` 按名字分派执行，返回值一律为**字符串**（与 `tool_result.result` 一致）。

工具内部失败一律抛 `ToolError`（带固定 `reason`），由引擎拼成规范文案。
"""

from typing import Any

from app.tools.calculator import run_calculator
from app.tools.current_time import run_get_current_time
from app.tools.http_get import run_http_get

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "calculator",
        "description": "安全地计算一个四则运算表达式，支持 + - * /、括号、小数与一元负号。",
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": '要计算的表达式，例如 "2+3*4"',
                },
            },
            "required": ["expression"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_current_time",
        "description": "返回当前 UTC 时间（ISO-8601、毫秒精度、以 Z 结尾）。无参数。",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "http_get",
        "description": "对给定 URL 发起 HTTP GET，返回响应体文本。仅允许 http/https。",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "要请求的 http:// 或 https:// URL",
                },
            },
            "required": ["url"],
            "additionalProperties": False,
        },
    },
]


def has_tool(name: str) -> bool:
    """工具名是否已注册。"""
    return any(definition["name"] == name for definition in TOOL_DEFINITIONS)


def get_tool_definition(name: str) -> dict[str, Any] | None:
    """按名字取工具定义（未注册时返回 None）。"""
    return next((definition for definition in TOOL_DEFINITIONS if definition["name"] == name), None)


async def execute_tool(name: str, args: dict[str, Any]) -> str:
    """执行一个工具，返回**字符串**结果。

    未注册的工具名由引擎在预检阶段拦截；此处再抛普通 Error 作为兜底。
    """
    if name == "calculator":
        return run_calculator(args)
    if name == "get_current_time":
        return run_get_current_time()
    if name == "http_get":
        return await run_http_get(args)
    raise ValueError(f"unknown tool: {name}")
```

### 10.7 `apps/api-py/app/api/tools.py`

**完整文件路径：`apps/api-py/app/api/tools.py`**

```python
"""`GET /tools` 路由 —— 契约见 packages/contract/openapi.yaml。

行为与 api-ts 的 `ToolsController` 一致：需 Bearer 认证（复用 `get_current_user`，
缺失/无效令牌的 401 文案由 `app.api.deps` 统一给出），返回 `{ items: TOOL_DEFINITIONS }`。
"""

from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models.user import User
from app.tools.registry import TOOL_DEFINITIONS

router = APIRouter(tags=["tools"])


@router.get("/tools", operation_id="listTools")
def list_tools(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {"items": TOOL_DEFINITIONS}
```

### 10.8 `apps/api-py/app/engine/engine.py`

**完整文件路径：`apps/api-py/app/engine/engine.py`**

```python
"""执行引擎（阶段 4 → 阶段 6）核心：用 **LangGraph** 把契约里的 `Graph` 编译成
`StateGraph` 并执行。

与 api-ts 的 `apps/api-ts/src/engine/engine.service.ts` 对齐（见 sse-events.md §4）：
动态 `add_node(node_id, fn)`、按 `edges` 连边、`START → start`、`end → END`。
运行前先做预检（草稿非空、`validate_graph`、节点数据形状、工具名存在），
不通过即 400（普通 JSON）。

阶段 6：**不新增节点类型**，`llm` 节点的 `data.tools` 非空时用
「LLM 节点 + 工具 + 条件边 + 环」实现 ReAct：
- 额外加一个内部节点 `<llmId>__tools`，`add_conditional_edges(<llmId>, router, {tools, continue})`；
- `add_edge(<llmId>__tools, <llmId>)` 形成环；
- 从该 `llm` 节点出发的普通边被跳过（与条件边二选一），其下游作为 `continue` 分支。

说明（自行做主的设计决定）：事件通过自建 `asyncio.Queue` 传出，而非 LangGraph 的 custom
stream —— 这样两端事件顺序与 payload 完全可控、可比，且与执行器解耦。
"""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated, Any, TypedDict

from langchain_core.messages import BaseMessage, ToolMessage
from langgraph.graph import END, START, StateGraph

from app.config import settings
from app.engine.events import (
    RunError,
    format_sse_frame,
    node_finished,
    node_started,
    run_failed,
    run_finished,
    run_started,
    token,
    tool_call,
    tool_result,
)
from app.engine.nodes.end import run_end_node
from app.engine.nodes.llm import (
    ToolCallRequest,
    build_initial_messages,
    run_llm_node,
    run_llm_step,
)
from app.engine.nodes.start import run_start_node
from app.tools.registry import execute_tool, has_tool
from app.tools.tool_error import ToolError

# 工具轮次的默认上限（可由环境变量 `MAX_TOOL_ROUNDS` 覆盖）
DEFAULT_MAX_TOOL_ROUNDS = 5


def _merge_dict(previous: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """合并 reducer：节点返回 `{<key>: {<nodeId>: <value>}}` 逐步累积。"""
    return {**previous, **update}


class RunState(TypedDict):
    """变量池 + 三份**按节点 id 隔离**的状态（键为节点 id）。"""

    pool: Annotated[dict[str, Any], _merge_dict]
    # 启用了工具的 llm 节点自己的消息数组（多轮共享同一份）
    messages: Annotated[dict[str, list[BaseMessage]], _merge_dict]
    # 该节点已执行的工具轮次数（从 1 开始计）
    rounds: Annotated[dict[str, int], _merge_dict]
    # 上一轮 LLM 产出的、尚未执行的工具调用（条件边的路由依据）
    tool_calls: Annotated[dict[str, list[ToolCallRequest]], _merge_dict]


def _max_tool_rounds() -> int:
    """工具轮次上限（经 `Settings` 读 `MAX_TOOL_ROUNDS`，默认 5）。

    注意：必须走 `settings` 而不是 `os.environ` —— pydantic-settings 只把 `.env`
    读进配置对象、**不回写进程环境**，直接读 `os.environ` 会让 `.env` 里的值失效。
    """
    value = settings.max_tool_rounds
    return value if value > 0 else DEFAULT_MAX_TOOL_ROUNDS


def _tool_names_of(node: dict[str, Any]) -> list[str]:
    """`llm` 节点声明的工具名列表（非数组或空数组视为未启用工具）。"""
    tools = (node.get("data") or {}).get("tools")
    if not isinstance(tools, list):
        return []
    return [name for name in tools if isinstance(name, str)]


def _js_string(value: Any) -> str:
    """错误文案里的非字符串取值：对齐 JS `String(value)` 的常见标量表现。"""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def validate_node_data(graph: dict[str, Any]) -> list[str]:
    """节点数据形状校验（引擎侧，见 error-messages.md §4.1 与 §6.1）。"""
    errors: list[str] = []
    for node in graph.get("nodes") or []:
        data: dict[str, Any] = node.get("data") or {}
        node_id = node.get("id")
        node_type = node.get("type")
        if node_type == "start":
            inputs = data.get("inputs")
            if not isinstance(inputs, list):
                errors.append(f"start node {node_id} inputs must be an array")
                continue
            for item in inputs:
                if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                    errors.append(f"start node {node_id} input must have a name")
        elif node_type == "llm":
            if not isinstance(data.get("prompt"), str):
                errors.append(f"llm node {node_id} prompt must be a string")
            # §6.1：tools 里每个名字都必须已注册（预检即 400，不等运行时）
            tools = data.get("tools")
            if isinstance(tools, list):
                for name in tools:
                    if not isinstance(name, str) or not has_tool(name):
                        errors.append(
                            f"llm node {node_id} references unknown tool: {_js_string(name)}"
                        )
        elif node_type == "end":
            outputs = data.get("outputs")
            if not isinstance(outputs, list):
                errors.append(f"end node {node_id} outputs must be an array")
                continue
            for item in outputs:
                output = item if isinstance(item, dict) else {}
                if not isinstance(output.get("name"), str):
                    errors.append(f"end node {node_id} output must have a name")
                if not isinstance(output.get("value"), str):
                    errors.append(f"end node {node_id} output must have a value")
    return errors


async def run_stream(
    app_id: str, graph: dict[str, Any], inputs: dict[str, Any]
) -> AsyncGenerator[str, None]:
    """产出 SSE 帧的异步生成器：先 `run_started`，后台执行图，逐帧产出直至队列关闭。"""
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    run_id = str(uuid.uuid4())
    await queue.put(run_started(run_id, app_id))
    task = asyncio.create_task(_run_graph(graph, inputs, queue, run_id))
    while True:
        event = await queue.get()
        if event is None:
            break
        yield format_sse_frame(event)
    await task


async def _run_graph(
    graph: dict[str, Any],
    inputs: dict[str, Any],
    queue: asyncio.Queue[dict[str, Any] | None],
    run_id: str,
) -> None:
    started_at = time.time()
    context: dict[str, Any] = {"failed_node_id": None, "last_outputs": {}}
    max_rounds = _max_tool_rounds()
    # 启用了工具的 llm 节点：别的照旧，这些节点改成「条件边 + 环」
    tool_nodes = [
        node for node in graph["nodes"] if node["type"] == "llm" and _tool_names_of(node)
    ]
    tool_node_ids = {node["id"] for node in tool_nodes}
    try:
        builder = StateGraph(RunState)
        for node in graph["nodes"]:
            builder.add_node(node["id"], _make_node_action(node, queue, context, tool_node_ids))
        for node in tool_nodes:
            builder.add_node(
                f"{node['id']}__tools", _make_tools_action(node, queue, context, max_rounds)
            )
        for edge in graph["edges"]:
            # 启用了工具的 llm 节点改由条件边分派，跳过其普通出边（否则两者冲突）
            if edge["source"] in tool_node_ids:
                continue
            builder.add_edge(edge["source"], edge["target"])
        for node in tool_nodes:
            # 条件边 + 环：有 tool_calls 走内部工具节点，否则走原图下游（多条下游时取第一条）
            node_id = node["id"]
            downstream = _first_downstream(graph, node)
            builder.add_conditional_edges(
                node_id,
                lambda state, nid=node_id: "tools"
                if (state["tool_calls"].get(nid) or [])
                else "continue",
                {"tools": f"{node_id}__tools", "continue": downstream},
            )
            builder.add_edge(f"{node_id}__tools", node_id)
        start_node = next(node for node in graph["nodes"] if node["type"] == "start")
        builder.add_edge(START, start_node["id"])
        for node in graph["nodes"]:
            if node["type"] == "end":
                builder.add_edge(node["id"], END)
        compiled = builder.compile()
        await compiled.ainvoke(
            {"pool": {"inputs": inputs}, "messages": {}, "rounds": {}, "tool_calls": {}},
            # 每轮工具调用占 2 个 superstep，留足余量避免 LangGraph 的默认 25 步上限先触发
            config={"recursion_limit": max(25, max_rounds * 2 + len(graph["nodes"]) * 2 + 10)},
        )
        elapsed_ms = int((time.time() - started_at) * 1000)
        await queue.put(run_finished(run_id, context["last_outputs"], elapsed_ms))
    except Exception as error:  # noqa: BLE001 - 任何执行期错误都归一为 run_failed
        await queue.put(run_failed(run_id, context["failed_node_id"], str(error)))
    finally:
        await queue.put(None)


def _make_node_action(
    node: dict[str, Any],
    queue: asyncio.Queue[Any],
    context: dict[str, Any],
    tool_node_ids: set[str],
):
    """生成某节点的执行动作（LangGraph node）。

    未启用工具的节点：发出一次 `node_started` / `node_finished`。
    启用了工具的 `llm` 节点由 `_make_llm_with_tools_action` 处理（事件只在首/末轮发）。
    """
    if node["id"] in tool_node_ids:
        return _make_llm_with_tools_action(node, queue, context)

    async def action(state: RunState) -> dict[str, Any]:
        await queue.put(node_started(node["id"], node["type"]))
        try:
            output = await _execute_node(node, state["pool"], queue)
            await queue.put(node_finished(node["id"], node["type"], output))
            if node["type"] == "end":
                context["last_outputs"] = output["outputs"]
            return {"pool": {node["id"]: output}}
        except Exception:
            context["failed_node_id"] = node["id"]
            raise

    return action


def _make_llm_with_tools_action(
    node: dict[str, Any],
    queue: asyncio.Queue[Any],
    context: dict[str, Any],
):
    """启用了工具的 `llm` 节点（ReAct 的「LLM + 条件判断」部分）。

    首轮（该节点还没有消息）发 `node_started` 并构造 system/user 消息；
    之后每轮沿用该节点自己的消息数组。有 `tool_calls` → 只更新状态，由条件边转到
    `<nodeId>__tools`；无 `tool_calls` → 这是最后一轮，发 `node_finished` 并写回变量池。
    """

    async def action(state: RunState) -> dict[str, Any]:
        node_id = node["id"]
        try:
            first_round = node_id not in state["messages"]
            if first_round:
                await queue.put(node_started(node_id, "llm"))
            history = (
                build_initial_messages(node, state["pool"])
                if first_round
                else state["messages"][node_id]
            )

            async def emit(text: str) -> None:
                await queue.put(token(node_id, text))

            step = await run_llm_step(node["data"], history, emit)
            messages = [*history, step.assistant_message]
            if step.tool_calls:
                return {
                    "messages": {node_id: messages},
                    "tool_calls": {node_id: step.tool_calls},
                }
            output: dict[str, Any] = {"text": step.text, "model": step.model}
            if step.usage is not None:
                output["usage"] = step.usage
            await queue.put(node_finished(node_id, "llm", output))
            return {
                "messages": {node_id: messages},
                "tool_calls": {node_id: []},
                "pool": {node_id: output},
            }
        except Exception:
            context["failed_node_id"] = node_id
            raise

    return action


def _make_tools_action(
    node: dict[str, Any],
    queue: asyncio.Queue[Any],
    context: dict[str, Any],
    max_rounds: int,
):
    """内部工具节点 `<llmId>__tools`（ReAct 的「Act」部分）：执行上一轮的 `tool_calls`。

    逐个发 `tool_call` → 执行 → 发 `tool_result` → 以 `ToolMessage` 追加回该节点的消息数组；
    任一工具失败即抛 `RunError`（文案见 error-messages.md §6.2），不会继续下一轮。
    """

    async def action(state: RunState) -> dict[str, Any]:
        node_id = node["id"]
        round_no = (state["rounds"].get(node_id) or 0) + 1
        try:
            if round_no > max_rounds:
                raise RunError(f"tool call rounds exceeded: {max_rounds}")
            messages = list(state["messages"].get(node_id) or [])
            for call in state["tool_calls"].get(node_id) or []:
                started_at = time.perf_counter()
                try:
                    args = _parse_args_or_fail(call)
                except Exception:
                    # 参数解析失败也仍先发 `tool_call`（args 为 `{}`），保持事件顺序可读
                    await queue.put(tool_call(node_id, call.name, {}, round_no))
                    raise
                await queue.put(tool_call(node_id, call.name, args, round_no))
                result = await _execute_tool_or_fail(call.name, args)
                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                await queue.put(
                    tool_result(node_id, call.name, result, elapsed_ms, round_no)
                )
                messages.append(
                    ToolMessage(content=result, tool_call_id=call.id, name=call.name)
                )
            return {
                "messages": {node_id: messages},
                "tool_calls": {node_id: []},
                "rounds": {node_id: round_no},
            }
        except Exception:
            context["failed_node_id"] = node_id
            raise

    return action


def _first_downstream(graph: dict[str, Any], node: dict[str, Any]) -> str:
    """取某节点的第一条下游边（没有则指向 `END`）。"""
    for edge in graph["edges"]:
        if edge["source"] == node["id"] and edge["target"] != node["id"]:
            return edge["target"]
    return END


def _parse_args_or_fail(call: ToolCallRequest) -> dict[str, Any]:
    """严格解析工具参数：非 JSON、非对象一律 `invalid arguments`（见 error-messages.md §6.2）。"""
    trimmed = call.args_text.strip()
    if trimmed == "":
        return {}
    try:
        parsed = json.loads(trimmed)
        if isinstance(parsed, dict):
            return parsed
    except ValueError:
        pass
    raise RunError(f"tool {call.name} failed: invalid arguments")


async def _execute_tool_or_fail(name: str, args: dict[str, Any]) -> str:
    """执行工具并把内部失败归一为 `tool {name} failed: {reason}`。"""
    if not has_tool(name):
        raise RunError(f"tool {name} failed: error")
    try:
        return await execute_tool(name, args)
    except ToolError as error:
        raise RunError(f"tool {name} failed: {error.reason}") from error
    except Exception as error:
        raise RunError(f"tool {name} failed: error") from error


async def _execute_node(node: dict[str, Any], pool: dict[str, Any], queue: asyncio.Queue[Any]):
    """按节点类型分派执行（`llm` 节点在执行中穿插 `token` 事件）。"""
    if node["type"] == "start":
        return run_start_node(node, pool)
    if node["type"] == "llm":

        async def emit(text: str) -> None:
            await queue.put(token(node["id"], text))

        return await run_llm_node(node, pool, emit)
    return run_end_node(node, pool)
```

### 10.9 `apps/api-py/app/engine/nodes/llm.py`

**完整文件路径：`apps/api-py/app/engine/nodes/llm.py`**

```python
"""`llm` 节点（阶段 5 → 阶段 6）：把 `data.prompt` 用池渲染后作为 user 消息，
调用 LangChain `ChatOpenAI`；`data.tools` 非空时用 `bind_tools` 交给模型。

逐 chunk 取 `chunk.content`（字符串化后）**立即**经 `emit` 发 `token` 事件
（provider 的真实流式片段），同时累积全文与流式 `tool_calls`。
任何调用错误都经 `map_llm_error` 归一为规范文案（见 error-messages.md §5），
不透出库的原始 message，与 api-ts 的 `mapLlmError` 规则一致。
"""

import json
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.config import settings
from app.engine.events import RunError
from app.engine.template import render_template
from app.tools.registry import get_tool_definition

EmitToken = Callable[[str], Awaitable[None]]


@dataclass
class ToolCallRequest:
    """一次 LLM 调用请求的工具调用（参数为原始 JSON 文本，解析推迟到执行工具时）。"""

    id: str
    name: str
    args_text: str


@dataclass
class LlmStepResult:
    """一轮 LLM 调用（可能带工具）的结果。"""

    text: str
    model: str
    usage: dict[str, int] | None
    tool_calls: list[ToolCallRequest]
    assistant_message: AIMessage


def build_initial_messages(node: dict[str, Any], pool: dict[str, Any]) -> list[BaseMessage]:
    """构造 `llm` 节点的初始消息：`system`（非空时）+ 渲染后的 `prompt`。

    启用工具的节点只在第一轮用它，后续轮次沿用节点自己的消息数组。
    """
    data: dict[str, Any] = node["data"]
    messages: list[BaseMessage] = []
    if isinstance(data.get("system"), str) and data["system"]:
        messages.append(SystemMessage(content=data["system"]))
    messages.append(HumanMessage(content=render_template(str(data["prompt"]), pool)))
    return messages


async def run_llm_step(
    data: dict[str, Any],
    messages: Sequence[BaseMessage],
    emit: EmitToken,
) -> LlmStepResult:
    """执行一轮 LLM 调用（阶段 6：可选绑定工具）。

    同时累积全文与 `tool_calls`（流式分片按 `index` 聚合，参数解析延迟到工具执行时）。
    """
    api_key = settings.llm_api_key
    if not api_key:
        raise RunError("llm provider not configured: LLM_API_KEY")

    model = data.get("model") or settings.llm_model
    extra: dict[str, Any] = {}
    if isinstance(data.get("temperature"), (int, float)):
        extra["temperature"] = data["temperature"]
    if isinstance(data.get("maxTokens"), int):
        extra["max_tokens"] = data["maxTokens"]

    client = ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=settings.llm_base_url,
        timeout=settings.llm_timeout_ms / 1000,
        # 不重试（与 api-ts 的 maxRetries: 0 对齐，保证错误快速、归一）
        max_retries=0,
        **extra,
    )
    tool_defs = _resolve_tool_defs(data.get("tools"))
    runnable = client.bind_tools(tool_defs) if tool_defs else client

    text = ""
    usage: dict[str, int] | None = None
    # 流式工具调用分片：按 `index` 聚合 id / name / 参数文本
    partial: dict[int, dict[str, str]] = {}
    try:
        async for chunk in runnable.astream(list(messages)):
            piece = _stringify_content(chunk.content)
            if piece:
                text += piece
                await emit(piece)
            for tool_call_chunk in getattr(chunk, "tool_call_chunks", None) or []:
                index = tool_call_chunk.get("index")
                if not isinstance(index, int):
                    index = 0
                current = partial.setdefault(index, {"id": "", "name": "", "args_text": ""})
                call_id = tool_call_chunk.get("id")
                if isinstance(call_id, str) and call_id != "":
                    current["id"] = call_id
                call_name = tool_call_chunk.get("name")
                if isinstance(call_name, str) and call_name != "":
                    current["name"] += call_name
                call_args = tool_call_chunk.get("args")
                if isinstance(call_args, str):
                    current["args_text"] += call_args
                partial[index] = current
            meta = getattr(chunk, "usage_metadata", None)
            if isinstance(meta, dict) and isinstance(meta.get("input_tokens"), int):
                usage = {
                    "promptTokens": meta["input_tokens"],
                    "completionTokens": meta.get("output_tokens"),
                    "totalTokens": meta.get("total_tokens"),
                }
    except Exception as error:
        raise RunError(map_llm_error(error)) from error

    tool_calls: list[ToolCallRequest] = []
    for position, index in enumerate(sorted(partial)):
        value = partial[index]
        tool_calls.append(
            ToolCallRequest(
                id=value["id"] if value["id"] != "" else f"call_{index}_{position}",
                name=value["name"],
                args_text=value["args_text"],
            )
        )

    # 回填 assistant 消息（含 tool_calls），保证下一轮对话历史完整
    assistant_message = AIMessage(
        content=text,
        tool_calls=[
            {
                "id": call.id,
                "name": call.name,
                "args": _parse_args_leniently(call.args_text),
                "type": "tool_call",
            }
            for call in tool_calls
        ],
    )

    return LlmStepResult(
        text=text,
        model=model,
        usage=usage,
        tool_calls=tool_calls,
        assistant_message=assistant_message,
    )


async def run_llm_node(
    node: dict[str, Any], pool: dict[str, Any], emit: EmitToken
) -> dict[str, Any]:
    """`llm` 节点（阶段 5 的向后兼容路径）：未启用工具的节点只调用一次。"""
    data: dict[str, Any] = node["data"]
    step = await run_llm_step(data, build_initial_messages(node, pool), emit)
    output: dict[str, Any] = {"text": step.text, "model": step.model}
    if step.usage is not None:
        output["usage"] = step.usage
    return output


def _resolve_tool_defs(names: Any) -> list[dict[str, Any]]:
    """把契约里的工具名列表解析为 OpenAI function 定义（只取已注册的名字，预检已拦截未知名字）。"""
    if not isinstance(names, list) or not names:
        return []
    definitions: list[dict[str, Any]] = []
    for name in names:
        if not isinstance(name, str):
            continue
        definition = get_tool_definition(name)
        if definition is not None:
            definitions.append(definition)
    return definitions


def _parse_args_leniently(args_text: str) -> dict[str, Any]:
    """宽松解析工具参数：非法 JSON 或非对象时返回 `{}`。

    真正的报错在执行工具时，保证事件顺序仍是 `tool_call` → `run_failed`。
    """
    trimmed = args_text.strip()
    if trimmed == "":
        return {}
    try:
        parsed = json.loads(trimmed)
        if isinstance(parsed, dict):
            return parsed
    except ValueError:
        pass
    return {}


def _stringify_content(content: Any) -> str:
    """chunk.content 字符串化：字符串原样；列表拼各 text 部分；其余紧凑 JSON（与 api-ts 对齐）。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False, separators=(",", ":"))


def map_llm_error(error: Exception) -> str:
    """把 LangChain / 底层异常映射为规范文案（规则与 api-ts 的 `mapLlmError` 一致）。"""
    status = _status_code(error)
    if status is not None:
        if status in (401, 403):
            return "llm request unauthorized"
        if status == 429:
            return "llm rate limited"
        return f"llm request failed: {status}"
    if _is_timeout(error):
        return "llm request timed out"
    return "llm request failed: unknown"


def _status_code(error: Exception) -> int | None:
    """取异常的 HTTP 状态码（Python openai SDK 的 APIStatusError 带 `status_code`）。"""
    for attr in ("status_code", "status"):
        value = getattr(error, attr, None)
        if isinstance(value, int):
            return value
    return None


def _is_timeout(error: Exception) -> bool:
    """判定是否为超时（`APITimeoutError` / `TimeoutError`，或消息含 timeout）。"""
    if type(error).__name__ in ("APITimeoutError", "TimeoutError", "APIConnectionTimeoutError"):
        return True
    message = str(error).lower()
    return "timed out" in message or "timeout" in message
```

### 10.10 `apps/api-py/app/engine/events.py`

**完整文件路径：`apps/api-py/app/engine/events.py`**

```python
"""SSE 事件（唯一真源：`packages/contract/sse-events.md`）。

两套后端（api-ts / api-py）必须产出**逐字节相同**的帧格式与**完全一致**的事件序列。
本模块负责：构造各事件的逻辑表示、序列化帧。
"""

import json
from typing import Any


class RunError(Exception):
    """运行期错误：其 message 经 run_failed 事件传出（见 error-messages.md §4.2）。"""


def format_sse_frame(event: dict[str, Any]) -> str:
    """帧格式（固定）：`event: <name>\\n` + `data: <单行 JSON>\\n\\n`。

    用紧凑分隔符 + `ensure_ascii=False`，与 JS `JSON.stringify` 的紧凑单行输出对齐。
    """
    payload = json.dumps(event["data"], ensure_ascii=False, separators=(",", ":"))
    return f"event: {event['event']}\ndata: {payload}\n\n"


def run_started(run_id: str, app_id: str) -> dict[str, Any]:
    return {"event": "run_started", "data": {"runId": run_id, "appId": app_id}}


def node_started(node_id: str, node_type: str) -> dict[str, Any]:
    return {"event": "node_started", "data": {"nodeId": node_id, "nodeType": node_type}}


def token(node_id: str, text: str) -> dict[str, Any]:
    return {"event": "token", "data": {"nodeId": node_id, "text": text}}


def tool_call(
    node_id: str, tool_name: str, args: dict[str, Any], round_no: int
) -> dict[str, Any]:
    """`tool_call`（`round` 从 1 开始）。"""
    return {
        "event": "tool_call",
        "data": {"nodeId": node_id, "toolName": tool_name, "args": args, "round": round_no},
    }


def tool_result(
    node_id: str, tool_name: str, result: str, elapsed_ms: int, round_no: int
) -> dict[str, Any]:
    """`tool_result`（`result` 一律为字符串）。"""
    return {
        "event": "tool_result",
        "data": {
            "nodeId": node_id,
            "toolName": tool_name,
            "result": result,
            "elapsedMs": elapsed_ms,
            "round": round_no,
        },
    }


def node_finished(node_id: str, node_type: str, output: dict[str, Any]) -> dict[str, Any]:
    return {
        "event": "node_finished",
        "data": {"nodeId": node_id, "nodeType": node_type, "output": output},
    }


def run_finished(run_id: str, outputs: dict[str, Any], elapsed_ms: int) -> dict[str, Any]:
    return {
        "event": "run_finished",
        "data": {"runId": run_id, "outputs": outputs, "elapsedMs": elapsed_ms},
    }


def run_failed(run_id: str, node_id: str | None, message: str) -> dict[str, Any]:
    return {"event": "run_failed", "data": {"runId": run_id, "nodeId": node_id, "message": message}}
```

### 10.11 `apps/api-py/pyproject.toml`

**完整文件路径：`apps/api-py/pyproject.toml`**

```toml
[project]
name = "mini-dify-api-py"
version = "0.1.0"
description = "mini-dify Python 后端（FastAPI + SQLAlchemy 2.0），与 api-ts 实现同一份契约。"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.5.0",
    "email-validator>=2.2.0",
    "sqlalchemy>=2.0.30",
    "psycopg[binary]>=3.2.0",
    "pyjwt>=2.9.0",
    "bcrypt>=4.2.0",
    "langgraph>=1.2.16",
    "langchain-openai>=1.0.0",
    "httpx>=0.28.1",
]

[dependency-groups]
dev = [
    "pytest>=8.3.0",
    "ruff>=0.6.0",
]
```

---

## 11. 实测结果（照实记录）

> 测试条件：`tools/mock-llm/server.mjs`（阶段 6 版，支持 `[[call:...]]` / `[[next]]`），两端同一张图、同一 prompt。所有「一致」均为**规范化后**（`runId` / `appId` / `elapsedMs` 抹成占位符）比对。

### 11.1 编译后图内省

```text
source='llm1'          target='end'           conditional=True
source='llm1'          target='llm1__tools'   conditional=True
source='llm1__tools'   target='llm1'          conditional=False
```

**解读**：`llm1` 的两条出边都由条件边产生（`conditional=True`）；回边是普通边（`conditional=False`）。没有重复的普通 `llm1 → end`。

### 11.2 单工具运行（12 帧）

事件序列：

```text
run_started
node_started(start)
node_finished(start)
node_started(llm1)
tool_call
tool_result
token
token
node_finished(llm1)
node_started(end)
node_finished(end)
run_finished
```

关键值：

| 字段 | 实测值 |
| --- | --- |
| `tool_result.result` | `"14"` |
| `node_finished(llm1).output.text` | `"answer: 14"` |
| `node_finished(llm1).output.usage` | `{"promptTokens":60,"completionTokens":10,"totalTokens":70}` |
| `run_finished.outputs` | `{"result":"answer: 14"}` |

### 11.3 两端对比

| 对比项 | 结果 |
| --- | --- |
| 帧数 | 均为 **12** |
| 事件名序列 | **完全一致** |
| payload 键集合 | **完全一致**（`tool_call`：`nodeId` / `toolName` / `args` / `round`；`tool_result`：再加 `result` / `elapsedMs`） |
| `tool_call.args` | **完全一致** |
| `tool_result.result` | **完全一致** |
| `node_finished.output.text` | **完全一致** |
| `usage` | **完全一致** |
| 差异项 | 仅 `runId` / `appId` / `elapsedMs` |

> `appId` 不同是**预期**：两端各自数据库里有各自的 `apps` 行，同一个逻辑应用不是同一个 UUID。`elapsedMs` 是执行耗时，天然不同。`runId` 每次随机。

### 11.4 多轮与并行

| 场景 | 实测 |
| --- | --- |
| 多轮（两批 `[[call:...]]`，用 `[[next]]` 分隔） | `round` 依次为 **1**、**2**；最终文本取最后一轮 |
| 并行（同一批两个标记） | 同一 `round` 内两个工具：`calculator` `6*7` → **`42`**；`get_current_time` → **`2026-10-20T16:15:57.595Z`** |

### 11.5 错误

| 场景 | 通道 | `message` |
| --- | --- | --- |
| `tools: ["xxx"]`（未注册） | HTTP **400**（普通 JSON，未开流） | `llm node llm1 references unknown tool: xxx` |
| `calculator` 参数缺失（如只给 `{"expr":"6*7"}`） | 流内 `run_failed` | `tool calculator failed: invalid arguments` |
| `MAX_TOOL_ROUNDS=1` 且需要第二轮工具 | 流内 `run_failed` | `tool call rounds exceeded: 1` |
| `http_get` 传 `file:///...` | 流内 `run_failed` | `tool http_get failed: not allowed` |

### 11.6 回归（未启用工具）

| 项 | 实测 |
| --- | --- |
| token 序列 | `["echo:"," Hell","o min","i-dif","y"]` |
| usage | `15/21/36` |
| `node_finished.output` | 与阶段 5 完全一致（无工具字段、无额外事件） |

### 11.7 `GET /tools`

两端 JSON **逐字段相等**：`items` 长度 3；每条 `name` / `description` / `parameters`（含 `type` / `properties` / `required` / `additionalProperties`）全部相同。区别只在 HTTP 框架自行产生的响应头，不在 JSON body。

---

## 12. 验收自测（可直接复制）

### 12.1 准备

```powershell
# 仓库根
uv sync --project apps/api-py

# 终端 A：mock provider
node tools/mock-llm/server.mjs
# 预期：mock-llm listening on http://127.0.0.1:11435/v1/chat/completions
```

编辑 `apps/api-py/.env`：

```dotenv
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=test
LLM_MODEL=mock-model
LLM_TIMEOUT_MS=3000
```

> `MAX_TOOL_ROUNDS` **可以写进 `.env`**：`Settings.max_tool_rounds` 由 pydantic-settings 读取，`engine._max_tool_rounds()` 再取它，因此 `.env` 里的值会生效。**改完 `.env` 仍需重启后端**。顺带记住通用坑：**pydantic-settings 只把 `.env` 读进 `Settings` 对象、不会写回 `os.environ`**，所以读配置一律走 `Settings`，不要直接读 `os.environ`。

```powershell
# 终端 B：Python 后端
$env:MAX_TOOL_ROUNDS = "5"   # 可选（进程环境优先级高于 .env）；也可直接改 apps/api-py/.env 后重启；要测超限就改成 "1"
pnpm dev:api-py
# 预期：Uvicorn running on http://127.0.0.1:8000
```

登录拿 token（示例；邮箱/密码换成你自己的）：

```powershell
$TOKEN = (curl.exe -s -X POST http://localhost:8000/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"demo@example.com","password":"password123"}' | ConvertFrom-Json).accessToken
```

### 12.2 `GET /tools`

```powershell
curl.exe -s http://localhost:8000/tools -H "Authorization: Bearer $TOKEN"
```

**预期**：`{"items":[{"name":"calculator",...},{"name":"get_current_time",...},{"name":"http_get",...}]}`，与 TS 端 `http://localhost:3001/tools` 的 body 逐字段相等。

### 12.3 单工具图

先准备一张图（`start → llm1 → end`，`llm1` 启用 `calculator`）：

```powershell
$graph = @'
{
  "version": "1",
  "nodes": [
    { "id": "start", "type": "start", "position": { "x": 0, "y": 0 }, "data": { "inputs": [] } },
    { "id": "llm1", "type": "llm", "position": { "x": 200, "y": 0 },
      "data": {
        "title": "calc",
        "model": "mock-model",
        "prompt": "请计算 [[call:calculator:{\"expression\":\"6+8\"}]]",
        "tools": ["calculator"]
      } },
    { "id": "end", "type": "end", "position": { "x": 400, "y": 0 },
      "data": { "outputs": [ { "name": "result", "value": "{{ llm1.text }}" } ] } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "llm1" },
    { "id": "e2", "source": "llm1", "target": "end" }
  ]
}
'@

curl.exe -s -X PUT "http://localhost:8000/apps/$APP_ID/graph" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d $graph
```

> `$APP_ID` 换成你账号下某个应用 id（可先 `GET /apps`）。`position` 是画布坐标，随便给合法值即可。

运行：

```powershell
curl.exe -N -s -X POST "http://localhost:8000/apps/$APP_ID/run" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d '{"inputs":{}}'
```

**预期**：12 帧，顺序见 §11.2；`tool_result.result="14"`、`text="answer: 14"`。`usage` 随 prompt 长度变化（本文实测样例为 `60/10/70`）。

### 12.4 多轮 / 并行

- 多轮：把 prompt 改成两批，用 `[[next]]` 分隔：

```text
[[call:calculator:{"expression":"6*7"}]] [[next]] [[call:get_current_time:{}]]
```

预期：`round` = 1、2；最终文本取第二轮工具结果。

- 并行：同一批写两个标记：

```text
[[call:calculator:{"expression":"6*7"}]] [[call:get_current_time:{}]]
```

预期：同一 `round` 两条 `tool_call` + 两条 `tool_result`；`calculator` 结果 `"42"`。

### 12.5 错误用例

```powershell
# 1) 未知工具：预检 400（普通 JSON，不是流）
#    把 data.tools 改成 ["xxx"] 后 PUT 草稿，再 run
#    预期：HTTP 400，message = llm node llm1 references unknown tool: xxx

# 2) 工具参数非法（缺 expression）
#    prompt 改为：[[call:calculator:{"expr":"6*7"}]]
#    预期：流内 run_failed，message = tool calculator failed: invalid arguments

# 3) 轮次超限：把 apps/api-py/.env 的 MAX_TOOL_ROUNDS 改成 1 并重启后端
#    （Py 侧经 Settings.max_tool_rounds 读 .env；也可用 $env:MAX_TOOL_ROUNDS="1" 起进程）
#    prompt 用两批 [[next]]
#    预期：流内 run_failed，message = tool call rounds exceeded: 1

# 4) http_get 协议不允许
#    prompt 改为：[[call:http_get:{"url":"file:///etc/passwd"}]]
#    预期：流内 run_failed，message = tool http_get failed: not allowed
```

> `MAX_TOOL_ROUNDS` 在**每次运行**时经 `settings.max_tool_rounds` 读取（来自 `.env` 或进程环境）；改 `.env` 后必须**重启后端**才生效。

### 12.6 回归：不启用工具

把 `llm1.data.tools` 删掉（或设为 `[]`），prompt 改成 `Hello mini-dify`：

**预期**：token 序列 `["echo:"," Hell","o min","i-dif","y"]`，usage `15/21/36`，无 `tool_call` / `tool_result`。

---

## 13. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 只加了条件边，忘了跳过普通出边 | `end` 与工具分支同时跑 / 死循环 | 必须 `if edge["source"] in tool_node_ids: continue`（§9.1） |
| `messages` 用单一列表 | 多个 llm 节点串话、tool id 对不上 | 用 `dict[nodeId, list]` + 合并 reducer（§9.2） |
| 忘了追加 `ToolMessage` | 模型反复要同一个工具，最后轮次超限 | 追加 `ToolMessage(content, tool_call_id, name)`（§9.3） |
| 忘了清空 `tool_calls` | 工具执行完仍回到工具节点，重复执行 | 返回 `{node_id: []}`（§9.3） |
| 忘了轮次上限 | 环无限转，最后报框架的 `GraphRecursionError` | `rounds` + `MAX_TOOL_ROUNDS` + 放宽 `recursion_limit`（§9.4） |
| 初始状态漏键 | `KeyError` | `ainvoke` 显式给 `pool` / `messages` / `rounds` / `tool_calls`（§6.1） |
| 工具名未注册 | 预检 400 `references unknown tool` | 只能写 `GET /tools` 里有的名字 |
| `tools: []` 或 `tools` 未设置 | 不进入 ReAct，行为同阶段 5 | 这是**特性**，不是 bug |
| mock 里没写 `[[call:...]]` | 模型只回显 `echo: ...`，不调工具 | mock 的工具分支要求 prompt 里有标记（§12.3） |
| `LLM_BASE_URL` 少了 `/v1` | 404 / 连接错误，映射成 `llm request failed: 404` | OpenAI 兼容地址通常以 `/v1` 结尾 |
| `MAX_TOOL_ROUNDS` 写进 `apps/api-py/.env` **曾经**不生效 | 曾是「仍是 5」 | **现已修复**：`_max_tool_rounds()` 改读 `Settings.max_tool_rounds`，`.env` 会生效；改完**重启后端**即可。**通用坑（仍成立）**：pydantic-settings 只把 `.env` 读进 `Settings` 对象、**不回写进程环境**，直接读 `os.environ` 会让 `.env` 静默失效——读配置要走 `Settings` |
| `MAX_TOOL_ROUNDS` 改了没重启 | 仍是旧值 | 环境变量在进程启动时读取；重启后端 |
| PowerShell 里用 `curl` | 报参数错误 / 没有 `-N` 效果 | 用 `curl.exe`；`-N` 关闭缓冲 |
| 忘了 `uv sync` | `ModuleNotFoundError: httpx` | `httpx` 是运行期依赖，必须安装（§4） |
| `http_get` 遇到 301 结果为空 | 与 TS 不一致 | `httpx` 默认不跟随重定向；必须 `follow_redirects=True`（§5.5） |
| 在 `run_llm_step` 里严格解析参数 | 缺 `tool_call` 帧，事件顺序错 | 宽松解析给 `AIMessage`，严格解析放执行前（§6.6） |
| 工具返回非字符串 | `tool_result.result` 两端类型不一致 | 契约要求一律字符串；`execute_tool` 的返回注解就是 `str`（§5.6） |

---

## 14. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **工具定义 = OpenAI function calling 的 JSON Schema** | `name` / `description` / `parameters`；同一份数据服务 `GET /tools` 与 `bind_tools`；`additionalProperties:false`（§5.1） | **首次教学于本篇** |
| **`ToolError` 与五个固定 `reason`** | `class ToolError(Exception)`、`super().__init__(reason)`、`self.reason`；`except` 顺序与 `raise ... from`（§5.2、§8.2） | **首次教学于本篇** |
| **`calculator` 安全递归下降** | 不用 `eval`；`+ - * /`、括号、小数、一元符号；除零 / 语法错 → `invalid arguments`；`_format_number` 对齐 JS `String(number)`（§5.3） | **首次教学于本篇** |
| **`httpx.AsyncClient` 流式 GET** | `async with` 双上下文、`client.stream` + `aiter_bytes`、`timeout`（秒）、`follow_redirects`、64KB 中止；对照 `fetch` + `AbortController`（§5.5、§8.3） | **首次教学于本篇** |
| **Python 侧 ReAct：条件边 + 环** | `add_conditional_edges(node_id, router, {"tools": ..., "continue": downstream})` + `add_edge("__tools", node_id)`；跳过普通出边（§3.2、§6.2） | **首次教学于本篇** |
| **按节点 id 隔离的状态** | `messages` / `rounds` / `tool_calls` 都是 `dict[nodeId, ...]` + 合并 reducer；环里共享历史、节点间互不干扰（§6.1、§8.4） | **首次教学于本篇** |
| **`bind_tools` 与流式 `tool_call_chunks` 聚合** | 按 `index` 聚合 `id` / `name` / `args_text`；`AIMessage.tool_calls` 回填；宽松 / 严格两次参数解析（§6.6、§8.6） | **首次教学于本篇** |
| **`ToolMessage` 回填与轮次控制** | `content` / `tool_call_id` / `name` 三件套；`rounds` + `MAX_TOOL_ROUNDS` + `recursion_limit` 双保险（§6.5、§9.3、§9.4） | **首次教学于本篇** |
| **工具事件协议** | `tool_call`（`nodeId` / `toolName` / `args` / `round`）、`tool_result`（再加 `result` / `elapsedMs`）；`node_started` / `node_finished` 只发一次（§6.7、§3.3） | **首次教学于本篇** |
| **`@tool` vs 数据注册表** | `@tool` 自动从签名/docstring 推断 Schema；本项目为逐字段可控与两端同构，选择 `TOOL_DEFINITIONS` 字典列表 + 显式分派（§8.1） | **首次教学于本篇** |
| **lambda 默认参数捕获 / `next(..., 默认值)` / `.12g` 格式** | 闭包晚绑定规避；生成器取默认；数值字符串化对齐 JS（§8.7） | **首次教学于本篇** |
| **两端逐字节对齐（工具场景）** | 12 帧、事件序列、payload 键集合、`args` / `result` / `text` / usage 全同；仅 `runId` / `appId` / `elapsedMs` 不同（§11） | **首次教学于本篇** |
| **「写错会怎样」四类结构性错误** | 普通边与条件边并存、`messages` 不隔离、`ToolMessage` 不回填、无轮次上限（§9） | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：`StateGraph` / `TypedDict` + `Annotated` reducer / `ainvoke` / `asyncio.Queue`（`04-执行引擎/04-LangGraph与引擎-Python.md`）；`ChatOpenAI` / `.astream` / `maxRetries=0`（`05-LLM节点/02-真实模型调用与流式.md`）；LLM 错误映射（`05-LLM节点/03-LLM错误映射.md`）；mock provider 与 `[[mock-status:...]]`（`05-LLM节点/04-mock-LLM与无密钥自测.md`）；SSE 帧格式与六种基础事件（`04-执行引擎/01-运行契约与SSE事件协议.md`）；`iso_z` 时间序列化（`02-应用管理/07-验收.md`）；`Depends` / `APIRouter`（`00-项目初始化/06-FastAPI起步.md`、`01-账号与认证/05-FastAPI认证.md`）。
