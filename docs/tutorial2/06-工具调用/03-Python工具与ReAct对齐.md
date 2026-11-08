# 03 · Python 工具与 ReAct 对齐（工具调用）

> 阶段 6 · 第 3 步
>
> 做完：Python 侧拥有与 TS 逐字段一致的工具注册表、同一套 `ToolError` reason、同一套 ReAct 图结构（条件边 + 环）、同一套事件与文案；用 mock 跑同一张图，两端的事件序列与文本输出一致。
>
> **本篇面试考点**：跨语言数值格式化（`0.1+0.2` / `1e-7` / 整数）· `Literal` vs 联合类型 · `dataclass` vs `interface` · `assistant_message.tool_calls` 里的 `type` 字段 · `ToolMessage` 的 `name` · `asyncio.Queue.put` 的背压 · `httpx.stream` 与超限中止 · `perf_counter` vs `Date.now` · `settings` 为什么不等于 `os.environ` · 为什么事件里不要比 `elapsedMs`。

---

## 1. 文件对照

| 职责 | TS（api-ts） | Python（api-py） |
| --- | --- | --- |
| 错误类型 | `tools/tool-error.ts` | `tools/tool_error.py` |
| 计算器 | `tools/calculator.tool.ts` | `tools/calculator.py` |
| 当前时间 | `tools/current-time.tool.ts` | `tools/current_time.py` |
| HTTP GET | `tools/http-get.tool.ts` | `tools/http_get.py` |
| 注册表 | `tools/registry.ts` | `tools/registry.py` |
| 路由 | `tools/tools.controller.ts` | `api/tools.py` |
| 一轮 LLM | `engine/nodes/llm.node.ts` | `engine/nodes/llm.py` |
| 图与循环 | `engine/engine.service.ts` | `engine/engine.py` |

命名约定：TS 用 camelCase 文件/函数，Python 用 snake_case；**契约字段名一律 camelCase**（`toolName`、`elapsedMs`、`promptTokens`），Python 内部用 snake_case，发送前映射。

---

## 2. `tool_error.py`

**完整文件路径：`apps/api-py/app/tools/tool_error.py`**

```python
"""工具执行失败（见 error-messages.md §6.2）。

`reason` 只能取契约规定的固定值；引擎据此拼出
`tool {name} failed: {reason}`，两端逐字节一致。
"""

from typing import Literal

# 五个固定取值；与 api-ts 的 `ToolFailureReason` 联合类型逐项一致
ToolFailureReason = Literal["invalid arguments", "timeout", "not allowed", "too large", "error"]


class ToolError(Exception):
    """工具内部失败：`reason` 为契约固定的五个取值之一。"""

    def __init__(self, reason: ToolFailureReason) -> None:
        super().__init__(reason)
        self.reason = reason
```

> **面试考点 · `Literal` 在运行期会校验吗？**
> 不会。`Literal` 是**静态类型标注**，Python 运行期不检查 `ToolError("boom")`。
> 要运行期兜底，需要 `assert reason in (...)` 或 `pydantic` 的类型校验。
> 这里选择“编译期（mypy/pyright）+ 代码评审”而不是运行期断言：非法值会在类型检查里暴露，运行期多一次检查收益不大。
> **别把类型标注当运行期校验**——这和 TS 的类型擦除是同一个道理。

---

## 3. `calculator.py`：跨语言数值对齐

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
```

解析器部分与 TS 一一对应（`_parse_expression` / `_parse_term` / `_parse_unary` / `_parse_primary` / `_parse_number`），不再重复贴。两个跨语言细节需要单独说明。

### 3.1 `str(float)` ≠ `String(number)`

```python
str(1.0)        # '1.0'
repr(1.0)       # '1.0'
```

```js
String(1.0)     // '1'
```

Python 的浮点字符串化**永远带 `.0`**，JS 不带。所以必须先判断 `is_integer()` 再 `int(...)`。

再看指数：

```python
repr(1e-7)      # '1e-07'   ← 指数补零到两位
repr(1e21)      # '1e+21'
```

```js
String(1e-7)    // '1e-7'    ← 不补零
String(1e21)    // '1e+21'
```

Python 补零，JS 不补——于是有了那行 `re.sub(r"e([+-])0+(\d+)", r"e\1\2", ...)`。

> **面试考点 · 为什么不直接 `str(value)` 了事？**
> 因为这个值要进 `tool_result.result`，参与**两端逐字节比对**。
> `1.0` vs `1`、`1e-07` vs `1e-7` 都是“内容一样但字节不同”，会让契约对比失败。
> 跨语言对齐的难点往往不在算法，而在**格式化**：
>
> - 整数/浮点显示；
> - 指数补零；
> - `-0`；
> - `NaN` / `Infinity` 的拼写；
> - 千分位、科学计数法阈值（JS 在 `1e21` 处切科学计数法）。
>
> **算法对齐靠读代码，格式化对齐靠对比输出。**

### 3.2 `:12g` 与 `toPrecision(12)`

```js
(0.1 + 0.2).toPrecision(12)     // '0.300000000000'
Number('0.300000000000')        // 0.3
```

```python
f"{0.1 + 0.2:.12g}"             # '0.3'
```

`toPrecision(12)` 输出**12 位有效数字**，`format(..., '.12g')` 也是 12 位有效数字，且都会去掉尾随零。两者在这个场景下等价。

但要注意差异：

- `toPrecision` 在必要时使用指数形式（`1e-7.toPrecision(12)` → `'1.00000000000e-7'`），`g` 格式也会；
- 极端值（`1e21`）两边的切换阈值可能不一致。

本项目只需要处理“常见算术结果”，所以够用；**真要逐字节对齐所有浮点，应该约定一个统一的十进制库（如 `decimal.js` + `Decimal`）。**

> **面试考点 · Python `float` 和 JS `number` 是同一个东西吗？**
> 底层都是 IEEE 754 双精度（64 位），所以在**同一个运算顺序**下，结果位模式相同。
> 但有三点差异：
>
> 1. **整数精度**：JS 的 `number` 只有 53 位尾数，`2**53 + 1` 会丢精度；Python 的 `int` 是任意精度。我们的解析器把数字都转成 `float`，所以行为一致——但这也意味着大整数会丢精度。
> 2. **字符串化**：如上，`1.0` vs `1`、指数补零。
> 3. **除法**：`1/0` 在 Python 抛 `ZeroDivisionError`，JS 返回 `Infinity`。所以两边都要**先判断除数是否为 0**（TS 里是 `divisor === 0`，Python 里是 `divisor == 0`）。
>
> **“同一套浮点标准”不等于“同一套语言行为”。**

---

## 4. `registry.py`

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

> **面试考点 · `execute_tool` 是 `async`，但只有 `http_get` 需要 `await`，合理吗？**
> 合理，且必要：
>
> - 注册表对外只暴露**一个**入口，调用方不需要知道哪个工具是异步的；
> - `calculator` / `get_current_time` 是纯 CPU、微秒级，包在 `async` 函数里开销可忽略；
> - 统一 `async` 让引擎的 `await _execute_tool_or_fail(...)` 对所有工具都成立。
>
> 反例：如果 `execute_tool` 是同步的，`http_get` 就得用 `asyncio.to_thread` 或同步 `httpx`——后者会**阻塞事件循环**，把整个服务的并发拖死。
> **一个异步阻塞点，足以毁掉整个异步服务。**

---

## 5. `http_get.py`：流式读取与超限

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
        # `file:` 等协议 → not allowed；无协议（如 "foo"）→ invalid arguments
        raise ToolError("not allowed" if target.scheme else "invalid arguments")
    if not target.netloc:
        # 如 "http://"（缺主机名）→ invalid arguments
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

> **面试考点 · `except ToolError: raise` 为什么必须放在最前面？**
> 因为 `ToolError` 也继承自 `Exception`，会被最后的 `except Exception` 捕获并改写成 `error`。
> 顺序错了会导致 `too large` 变成 `error`——**用户看到“未知错误”，而不是“内容太大”**。
> 这是异常映射的通用陷阱：**具体的异常类型必须排在宽泛类型之前**（与 Java 的 `catch` 顺序同理）。

> **面试考点 · `urlsplit` 和 JS 的 `new URL` 行为一样吗？**
> 不一样，必须按 case 对齐：
>
> | 输入 | `new URL`（JS） | `urlsplit`（Python） |
> | --- | --- | --- |
> | `"foo"` | 抛错 | 成功，`scheme=''` |
> | `"file:///etc/passwd"` | 成功，`protocol='file:'` | 成功，`scheme='file'` |
> | `"http://"` | 抛错 | 成功，`netloc=''` |
>
> 所以代码里有两处补偿：
>
> - `scheme == ""` → `invalid arguments`（对应 JS 抛错）；
> - `netloc == ""` → `invalid arguments`（对应 JS 抛错）。
>
> **跨语言移植解析逻辑时，必须逐 case 对比两边的“异常 vs 接受”。**

---

## 6. `GET /tools` 路由

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

`main.py` 挂载：

```python
from app.api import tools as tools_api

app.include_router(tools_api.router)
```

> 这里的 `current_user` 参数没有在函数体里使用，只用于**触发鉴权依赖**。
> 可以写成 `_current_user` 或 `_: User = Depends(...)`，但保留名字更可读——**未使用不代表无意义，它声明了“这个路由需要登录”。**

---

## 7. 一轮带工具的 LLM 调用

**完整文件路径：`apps/api-py/app/engine/nodes/llm.py`**（阶段 6 节选）

```python
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
```

```python
async def run_llm_step(
    data: dict[str, Any],
    messages: Sequence[BaseMessage],
    emit: EmitToken,
) -> LlmStepResult:
    """执行一轮 LLM 调用（阶段 6：可选绑定工具）。"""
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
        timeout=settings.llm_timeout_ms / 1000,   # 毫秒 → 秒
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

    assistant_message = AIMessage(
        content=text,
        tool_calls=[
            {
                "id": call.id,
                "name": call.name,
                "args": _parse_args_leniently(call.args_text),
                "type": "tool_call",       # ← LangChain 要求该字段
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
```

### 7.1 `type: "tool_call"` 不能省

TS 侧用 `AIMessage` 的构造函数传 `tool_calls`，LangChain JS 会自动补 `type: 'tool_call'`。Python 侧**直接传入原始 dict**，必须自己写这个字段。

缺了会怎样：

```text
pydantic ValidationError: tool_calls.0.type Field required
```

这是**跨语言移植最容易踩的坑之一**：JS 的 SDK 做了容错，Python 的 dataclass 校验严格。**不要假设“同样的字段两边都能省”。**

> **面试考点 · 流式聚合为什么用 `dict[int, dict[str,str]]` 而不是 dataclass？**
> 因为聚合过程是“逐片增量修改”：`current["args_text"] += ...`。
> 用 dict 可以 `setdefault` 一步拿到可写对象；用 `dataclass` 也可以，但要额外处理“索引不存在时新建”，代码更长。
> 最终产物仍然转成 `ToolCallRequest` dataclass——**内部用松散结构，边界用强类型**。

---

## 8. 图与循环

**完整文件路径：`apps/api-py/app/engine/engine.py`**（节选）

```python
class RunState(TypedDict):
    """变量池 + **按节点 id 隔离**的状态（键为节点 id）。"""

    pool: Annotated[dict[str, Any], _merge_dict]
    # 启用了工具的 llm 节点自己的消息数组（多轮共享同一份）
    messages: Annotated[dict[str, list[BaseMessage]], _merge_dict]
    # 该节点已执行的工具轮次数（从 1 开始计）
    rounds: Annotated[dict[str, int], _merge_dict]
    # 上一轮 LLM 产出的、尚未执行的工具调用（条件边的路由依据）
    tool_calls: Annotated[dict[str, list[ToolCallRequest]], _merge_dict]
    # `condition` 节点选中的 `caseId` 或 `"else"`（条件边的路由依据）
    branches: Annotated[dict[str, str], _merge_dict]
```

```python
    # 带工具的 llm 节点：加内部工具节点 + 条件边 + 环
    for node in tool_nodes:
        builder.add_node(
            f"{node['id']}__tools", _make_tools_action(node, queue, context, max_rounds)
        )

    for edge in graph["edges"]:
        # 带工具的 llm 节点由条件边分派；condition 节点由分支条件边分派
        if any(node["id"] == edge["source"] for node in tool_nodes):
            continue
        if any(node["id"] == edge["source"] for node in condition_nodes):
            continue
        builder.add_edge(edge["source"], edge["target"])

    for node in tool_nodes:
        node_id = node["id"]
        downstream = _first_downstream(graph, node)
        builder.add_conditional_edges(
            node_id,
            lambda state, nid=node_id: "tools" if (state["tool_calls"].get(nid) or []) else "continue",
            {"tools": f"{node_id}__tools", "continue": downstream},
        )
        builder.add_edge(f"{node_id}__tools", node_id)   # ← 环
```

```python
await compiled.ainvoke(
    {"pool": {"inputs": inputs}, "messages": {}, "rounds": {}, "tool_calls": {}, "branches": {}},
    {"recursion_limit": max(25, max_rounds * 2 + len(graph["nodes"]) * 3 + 20)},
)
```

> **面试考点 · `lambda state, nid=node_id: ...` 为什么要用默认参数绑定 `node_id`？**
> 这是 Python 的**闭包延迟绑定**陷阱：循环里的 lambda 捕获的是变量名，不是当时的值。不绑定的话，所有 lambda 在调用时看到的都是**最后一个** `node_id`。
>
> ```python
> # 错误写法
> for node in tool_nodes:
>     node_id = node["id"]
>     builder.add_conditional_edges(node_id, lambda state: ... node_id ...)  # 全是最后一个
> ```
>
> 用 `nid=node_id` 在定义时把当前值绑定为默认参数，是最常用的修法。
> **JS 的 `for...of` + `const` 没有这个问题**（每次迭代新建绑定），所以从 TS 移植到 Python 时很容易漏掉。

### 8.1 LLM 动作

```python
def _make_llm_with_tools_action(node, queue, context):
    """启用了工具的 `llm` 节点（ReAct 的「LLM + 条件判断」部分）。"""

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
```

### 8.2 工具动作

```python
def _make_tools_action(node, queue, context, max_rounds):
    """内部工具节点 `<llmId>__tools`（ReAct 的「Act」部分）。"""

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
                await queue.put(tool_result(node_id, call.name, result, elapsed_ms, round_no))
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
```

```python
def _parse_args_or_fail(call: ToolCallRequest) -> dict[str, Any]:
    """严格解析工具参数：非 JSON、非对象一律 `invalid arguments`。"""
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
```

### 8.3 `perf_counter` vs `Date.now`

```python
started_at = time.perf_counter()
elapsed_ms = int((time.perf_counter() - started_at) * 1000)
```

- `time.time()` 是**墙钟**，会被 NTP 校时跳变影响，算差值可能为负；
- `time.perf_counter()` 是**单调时钟**，专用于测量耗时；
- `Date.now()` 也是墙钟，但 TS 侧用它是因为没有更好的同步原语（`performance.now()` 也行，但精度更高、类型是 `number`，用 `Date.now()` 足够）。

> **面试考点 · `elapsedMs` 要不要参与两端对比？**
> **不要。** 它是真实耗时，天然不同（甚至同一进程两次运行都不同）。
> 事件对比时只比 `nodeId` / `toolName` / `args` / `result` / `round`，忽略 `elapsedMs`。
> 这也是为什么契约里 `elapsedMs` 被明确标注为“观测值”——**协议一致性 ≠ 所有字段相等**。

### 8.4 轮次上限读配置

```python
def _max_tool_rounds() -> int:
    """工具轮次上限（经 `Settings` 读 `MAX_TOOL_ROUNDS`，默认 5）。

    注意：必须走 `settings` 而不是 `os.environ` —— pydantic-settings 只把 `.env`
    读进配置对象、**不回写进程环境**，直接读 `os.environ` 会让 `.env` 里的值失效。
    """
    value = settings.max_tool_rounds
    return value if value > 0 else DEFAULT_MAX_TOOL_ROUNDS
```

> **面试考点 · `pydantic-settings` 真的不回写 `os.environ` 吗？**
> 对。`SettingsConfigDict(env_file=".env")` 的行为是：读取 `.env` → 解析成 `Settings` 对象；**不会**把值写进 `os.environ`。
> 所以：
>
> - `settings.max_tool_rounds` ✅ 能拿到 `.env` 的值；
> - `os.environ.get("MAX_TOOL_ROUNDS")` ❌ 只有当它真的在进程环境里（比如 `$env:MAX_TOOL_ROUNDS=3`）时才有值。
>
> 这类 bug 的表现是“改了 `.env` 不生效，但用命令行设环境变量就生效”——非常难查。
> **配置要么统一走 `settings`，要么统一走 `os.environ`，不要混。**

---

## 9. 验证

### 9.1 `/tools` 与 TS 逐字节一致

```powershell
$tsToken = (curl.exe -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" -d '{"email":"alice@example.com","password":"password123"}' | ConvertFrom-Json).accessToken
$pyToken = (curl.exe -s -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" -d '{"email":"alice@example.com","password":"password123"}' | ConvertFrom-Json).accessToken

curl.exe -s http://localhost:3001/tools -H "Authorization: Bearer $tsToken" > tools-ts.json
curl.exe -s http://localhost:8000/tools -H "Authorization: Bearer $pyToken" > tools-py.json

# 顺序与内容都应完全一致
Compare-Object (Get-Content tools-ts.json) (Get-Content tools-py.json)
```

预期无输出。若 JSON 被压成一行，先格式化再比：

```powershell
(Get-Content tools-ts.json -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 10) > ts.pretty.json
(Get-Content tools-py.json -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 10) > py.pretty.json
Compare-Object (Get-Content ts.pretty.json) (Get-Content py.pretty.json)
```

### 9.2 直接跑工具

```powershell
uv run python -c "
import asyncio
from app.tools.registry import execute_tool
from app.tools.tool_error import ToolError
async def main():
    print(await execute_tool('calculator', {'expression': '2+3*4'}))
    print(await execute_tool('calculator', {'expression': '(1+2)*3/2'}))
    print(await execute_tool('calculator', {'expression': '0.1+0.2'}))
    for expr in ['1/0', '2+']:
        try:
            await execute_tool('calculator', {'expression': expr})
        except ToolError as e:
            print('err:', e.reason)
asyncio.run(main())
"
```

预期：

```text
14
4.5
0.3
err: invalid arguments
err: invalid arguments
```

与 TS 的 9.3 节输出**逐行一致**。

### 9.3 ReAct：与 TS 对比事件

用同一张图（`llm` 节点 `tools: ["calculator"]`），`prompt`：

```text
请计算 {{ inputs.expr }}，标记：[[call:calculator:{"expression":"2+3*4"}]]
```

```powershell
$body = '{"inputs":{"expr":"2+3*4"}}'
curl.exe -s -N -X POST "http://localhost:8000/apps/<APP_ID>/run" -H "Authorization: Bearer $pyToken" -H "Content-Type: application/json" -d $body > py-react.txt
curl.exe -s -N -X POST "http://localhost:3001/apps/<APP_ID>/run" -H "Authorization: Bearer $tsToken" -H "Content-Type: application/json" -d $body > ts-react.txt
```

逐事件比对（忽略 `runId` / `elapsedMs`）：

```powershell
Select-String -Path py-react.txt -Pattern 'event:|"toolName"|"round"|"result"|"text"' | ForEach-Object { $_.Line }
```

预期两边都出现：

```text
event: node_started
event: tool_call
event: tool_result
event: token          (text: "answer: 14")
event: node_finished
```

### 9.4 失败路径

```powershell
# 未知工具（预检 400，普通 JSON）
# 把节点 tools 改成 ["nope"] 后运行 → 400，message: "llm node llm1 references unknown tool: nope"

# 参数非法
# [[call:calculator:{"foo":1}]] → tool_call(args={}) → run_failed(tool calculator failed: invalid arguments)

# 工具内部失败
# [[call:calculator:{"expression":"1/0"}]] → run_failed(tool calculator failed: invalid arguments)

# 轮次超限（MAX_TOOL_ROUNDS=1 + [[next]] 两批）
# run_failed(tool call rounds exceeded: 1)
```

### 9.5 数值格式对齐

```python
# Python
await execute_tool('calculator', {'expression': '1/3'})            # '0.333333333333'
await execute_tool('calculator', {'expression': '1/100000000'})    # '1e-8'
await execute_tool('calculator', {'expression': '1000000*1000000*1000'})  # '1000000000000000'
```

```ts
// TS
await executeTool('calculator', { expression: '1/3' })
await executeTool('calculator', { expression: '1/100000000' })
await executeTool('calculator', { expression: '1000000*1000000*1000' })
```

两边必须返回同一个字符串：

```text
0.333333333333
1e-8                ← JS 不补零；Python 的 repr 是 1e-08，靠正则修正
1000000000000000    ← 1e15 在 JS 里仍用定点表示（< 1e21）
```

若不是，就是 `_format_number` 的某个分支没对齐（整数、指数补零、大数切换阈值）。

---

## 10. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| `Literal` 运行期校验 | 不校验；仅静态类型；别当成运行期保证 |
| `str(1.0)` vs `String(1.0)` | `'1.0'` vs `'1'`；先 `is_integer()` 再转 int |
| Python 指数 | `1e-07` 补零，JS `1e-7`；用正则去零 |
| `:12g` vs `toPrecision` | 12 位有效数字；常规结果等价，极端阈值可能不同 |
| 浮点一致性 | 同为 IEEE 754，但字符串化、整数精度、除零行为不同 |
| `execute_tool` 全异步 | 避免 `http_get` 阻塞事件循环 |
| `except ToolError` 顺序 | 具体异常必须在 `Exception` 之前 |
| `urlsplit` vs `new URL` | 空 scheme / 空 netloc 需补偿成 `invalid arguments` |
| `type: "tool_call"` | Python 原始 dict 必须显式给；LangChain JS 自动补 |
| `lambda` 闭包 | 循环里用默认参数绑定当前值 |
| `perf_counter` | 单调时钟测耗时；`time.time()` 会被校时影响 |
| `elapsedMs` 对比 | 不参与对比，观测值 |
| `settings` vs `os.environ` | pydantic-settings 不回写环境；统一走 settings |
| `ToolMessage.name` | 与 `tool_call_id` 一起构成完整配对信息 |

---

## 11. 下一步

- `04-前端工具选择面板.md`：`GET /tools`、多选写入 `data.tools`、未选择时清空键。
- `05-验收.md`：单工具/并行/多轮/上限/未知工具/参数非法/两后端逐项对比、阶段 6 完整清单。
