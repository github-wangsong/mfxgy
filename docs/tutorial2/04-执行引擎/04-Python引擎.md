# 04 · Python 引擎（执行引擎 MVP）

> 阶段 4 · 第 4 步
>
> 做完：`apps/api-py` 用 FastAPI + LangGraph 跑同一份图，产出与 NestJS **逐字节相同**的 SSE 帧；预检失败仍是普通 JSON 400/404；`asyncio.Queue` 承担事件通道。
>
> 与 02/03 篇是**同一套语义的另一种语言实现**，重点看「哪里必须刻意对齐」。
>
> **本篇面试考点**：`asyncio.Queue` + 哨兵 vs Node 的等待唤醒 · `create_task` 的异常去哪了 · `StreamingResponse` 的同步/异步生成器与线程池 · `ensure_ascii=False` 与紧凑分隔符 · Python `1.0` vs JS `1` · `TypedDict` + `Annotated` reducer · `Content-Type` 的 `charset` 差异 · 请求级 `Session` 与流式响应的生命周期。

---

## 1. 依赖

**完整文件路径：`apps/api-py/pyproject.toml`**（阶段 4 的增量）

```toml
[project]
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.32.0",
  "pydantic>=2.9.0",
  "pydantic-settings>=2.6.0",
  "sqlalchemy>=2.0.30",
  "psycopg[binary]>=3.2.0",
  "python-jose[cryptography]>=3.3.0",
  "bcrypt>=4.0.0",
  "langgraph>=0.2.0",
  "langchain-core>=0.3.0",
  "httpx>=0.27.0",
]
```

```powershell
uv sync
```

> `langchain-core` 是 LangGraph 的依赖，但我们会直接 `from langchain_core.messages import ...`（阶段 6 的工具消息），所以显式声明，不靠传递依赖。

---

## 2. 事件构造与帧序列化

**完整文件路径：`apps/api-py/app/engine/events.py`**（阶段 4 版本）

```python
"""SSE 事件（唯一真源：`packages/contract/sse-events.md`）。

两套后端（api-ts / api-py）必须产出**逐字节相同**的帧格式与**完全一致**的事件序列。
本模块负责：构造各事件的逻辑表示、序列化帧。
"""

import json
from typing import Any


class RunError(Exception):
    """运行期错误：其 message 经 `run_failed` 事件传出。"""


def format_sse_frame(event: dict[str, Any]) -> str:
    """帧格式（固定）：`event: <name>\\n` + `data: <单行 JSON>\\n\\n`。

    两个参数必须写死：
    - `ensure_ascii=False`：中文原样输出，否则会变成 `\\u4f60`，与 JS 不一致；
    - `separators=(",", ":")`：紧凑输出，否则默认 `", "` / `": "` 会多出空格。
    """
    payload = json.dumps(event["data"], ensure_ascii=False, separators=(",", ":"))
    return f"event: {event['event']}\ndata: {payload}\n\n"


def run_started(run_id: str, app_id: str) -> dict[str, Any]:
    """`run_started`（阶段 4 无会话字段；阶段 9 追加 `conversationId`）。"""
    return {"event": "run_started", "data": {"runId": run_id, "appId": app_id}}


def node_started(node_id: str, node_type: str) -> dict[str, Any]:
    """`node_started`。"""
    return {"event": "node_started", "data": {"nodeId": node_id, "nodeType": node_type}}


def token(node_id: str, text: str) -> dict[str, Any]:
    """`token`：LLM 节点的增量文本。"""
    return {"event": "token", "data": {"nodeId": node_id, "text": text}}


def node_finished(node_id: str, node_type: str, output: dict[str, Any]) -> dict[str, Any]:
    """`node_finished`。"""
    return {
        "event": "node_finished",
        "data": {"nodeId": node_id, "nodeType": node_type, "output": output},
    }


def run_finished(run_id: str, outputs: dict[str, Any], elapsed_ms: int) -> dict[str, Any]:
    """`run_finished`：成功终态。"""
    return {
        "event": "run_finished",
        "data": {"runId": run_id, "outputs": outputs, "elapsedMs": elapsed_ms},
    }


def run_failed(run_id: str, node_id: str | None, message: str) -> dict[str, Any]:
    """`run_failed`：失败终态。`nodeId` 为 None 时序列化为 `null`。"""
    return {
        "event": "run_failed",
        "data": {"runId": run_id, "nodeId": node_id, "message": message},
    }
```

> **面试考点 · 为什么 `ensure_ascii=False` 是硬要求？**
> `json.dumps` 默认 `ensure_ascii=True`，中文会输出 `\u4f60\u597d`。JS 的 `JSON.stringify('你好')` 输出 `"你好"`。
> 两套后端的事件 payload 只要有一个中文字段，字节就不再相同，契约测试直接失败。
> **跨语言序列化，先对齐“编码/转义/分隔符”这三个细节，再谈业务。**

> **面试考点 · `separators=(",", ":")` 少了会怎样？**
> 默认分隔符是 `', '` 和 `': '`，`{"a": 1, "b": 2}` 中间多两个空格。curl 看着“差不多”，diff 出来每行都不同。
> 契约里的“逐字节一致”不是口号，它就是这些参数值。

---

## 3. 模板解析

**完整文件路径：`apps/api-py/app/engine/template.py`**（阶段 4 版本）

```python
"""模板解析（引擎语义，两端必须一致，见 sse-events.md §4）。

变量池 `pool` 初始为 `{"inputs": <RunRequest.inputs>}`，每个节点执行完把自身输出
写入 `pool[<nodeId>]`。字符串里的 `{{ a.b }}`（花括号内允许空格）按点路径取值并替换。
"""

import json
import re
from typing import Any

from app.engine.events import RunError

# 匹配 {{ path }}：花括号内不含花括号，允许首尾空格
_TEMPLATE_PATTERN = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


def render_template(text: str, pool: dict[str, Any]) -> str:
    """把 `text` 中的模板片段按 `pool` 渲染（模板外文本原样保留）。"""
    return _TEMPLATE_PATTERN.sub(
        lambda match: _stringify(resolve_path(match.group(1).strip(), pool)), text
    )


def resolve_path(path: str, pool: dict[str, Any]) -> Any:
    """按点路径从 `pool` 取值；任一段不存在即抛 `RunError`。"""
    current: Any = pool
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            raise RunError(f"template variable not found: {path}")
        current = current[segment]
    return current


def _stringify(value: Any) -> str:
    """渲染值转字符串：字符串原样，其余按紧凑 JSON 序列化（与 api-ts 对齐）。"""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
```

TS 与 Python 的对应关系：

| 语义 | TS | Python |
| --- | --- | --- |
| 匹配 | `/\{\{\s*([^{}]+?)\s*\}\}/g` | `r"\{\{\s*([^{}]+?)\s*\}\}"` |
| 取值 | `path.split('.')` 逐段 | `path.split(".")` 逐段 |
| 缺失 | `throw new RunError(...)` | `raise RunError(...)` |
| 字符串 | 原样 | 原样 |
| 其他 | `JSON.stringify` | `json.dumps(..., ensure_ascii=False, separators=(",", ":"))` |

> **面试考点 · 为什么 Python 的 `resolve_path` 要判断“是不是 dict”？**
> JS 里 `typeof current === 'object' && !Array.isArray(current)` 排除了数组；Python 里 `isinstance(current, dict)` 只接受字典。
> 如果只写 `segment in current`，对**数组**会变成“下标是否存在”，`{{ inputs.tags.0 }}` 在 Python 能用、在 JS 不能用——两端行为分叉。
> 语法简单不代表实现简单，**每个边界条件都要在两端各写一遍并比对**。

> **阶段 8 预告 · 浮点序列化的坑**
> 阶段 4 的 `json.dumps` 有一个两端不一致的例子：`json.dumps(1.0)` 得到 `"1.0"`，而 `JSON.stringify(1.0)` 得到 `"1"`。
> 阶段 8 的迭代节点会逐个渲染数字数组，这个差异会直接暴露，届时会加 `js_json_dumps`：把整数值的 float 归一成 int、`NaN`/`Infinity` 归一成 `null`。
> **跨语言“能跑”与“逐字节一致”之间，差的就是这类细节。**

---

## 4. 节点运行时

**完整文件路径：`apps/api-py/app/engine/nodes/start.py`**

```python
"""`start` 节点：按 `data.inputs` 声明校验运行输入，输出 `{"inputs": <运行输入>}`。"""

from typing import Any

from app.engine.events import RunError


def run_start_node(node: dict[str, Any], pool: dict[str, Any]) -> dict[str, Any]:
    # data.inputs: [{"name": "topic", "type": "string", "required": true}]
    declared: list[dict[str, Any]] = node["data"]["inputs"]
    # 运行输入在 pool["inputs"]（由 run_stream 初始化）
    provided: dict[str, Any] = pool.get("inputs") or {}
    for item in declared:
        # 只校验 required；未声明的键允许缺失
        if item.get("required") is True and item["name"] not in provided:
            raise RunError(f"missing required input: {item['name']}")
    return {"inputs": provided}
```

**完整文件路径：`apps/api-py/app/engine/nodes/llm.py`**（阶段 4 占位实现）

```python
"""`llm` 节点（阶段 4 占位）：渲染 prompt 后原样回显，并发出一次 `token`。

阶段 5 会替换成真实模型调用（LangChain ChatOpenAI + 流式），
输出形状保持 `{"text", "model"}` 不变，因此引擎与前端无需改动。
"""

from typing import Any, Awaitable, Callable

from app.engine.template import render_template


async def run_llm_node(
    node: dict[str, Any],
    pool: dict[str, Any],
    emit_token: Callable[[str], Awaitable[None]],
) -> dict[str, Any]:
    data: dict[str, Any] = node.get("data") or {}
    prompt = render_template(str(data.get("prompt") or ""), pool)
    text = f"Echo: {prompt}"
    # 占位实现也发 token：让前端流式渲染链路在阶段 4 就能端到端验证
    await emit_token(text)
    return {"text": text, "model": "stub"}
```

**完整文件路径：`apps/api-py/app/engine/nodes/end.py`**

```python
"""`end` 节点：渲染 `data.outputs[].value`，输出 `{"outputs": {name: 渲染值}}`。

该对象即 `run_finished` 的 `outputs`（多 `end` 时取拓扑序最后一个）。
"""

from typing import Any

from app.engine.template import render_template


def run_end_node(node: dict[str, Any], pool: dict[str, Any]) -> dict[str, Any]:
    # data.outputs: [{"name": "result", "value": "{{ llm1.text }}"}]
    declared: list[dict[str, Any]] = node["data"]["outputs"]
    outputs: dict[str, Any] = {}
    for item in declared:
        outputs[item["name"]] = render_template(item["value"], pool)
    return {"outputs": outputs}
```

---

## 5. 引擎：`asyncio.Queue` + LangGraph

**完整文件路径：`apps/api-py/app/engine/engine.py`**（阶段 4 版本）

```python
"""执行引擎（阶段 4）：用 LangGraph 把契约里的 `Graph` 编译成 StateGraph 并执行。

与 api-ts 的 `engine.service.ts` 对齐：
动态 `add_node(node_id, fn)`、按 edges 连边、START → start、end → END。
预检不通过即 400（普通 JSON）；执行期错误一律转成一帧 `run_failed`。

事件通过自建 `asyncio.Queue` 传出，而不是用 LangGraph 的 custom stream：
这样事件顺序与 payload 完全可控，两套后端才可能逐字节一致。
"""

import asyncio
import time
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.engine.events import (
    RunError,
    format_sse_frame,
    node_finished,
    node_started,
    run_failed,
    run_finished,
    run_started,
    token,
)
from app.engine.nodes.end import run_end_node
from app.engine.nodes.llm import run_llm_node
from app.engine.nodes.start import run_start_node
from app.graph.validator import validate_graph

# 队列里放 None 作为「流结束」的哨兵
_STREAM_END = None


def _merge_dict(previous: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """合并 reducer：节点返回 `{<nodeId>: output}`，逐步累积而不是覆盖。"""
    return {**previous, **update}


class RunState(TypedDict):
    """运行状态：`pool` 键为 `inputs` 或节点 id。"""

    pool: Annotated[dict[str, Any], _merge_dict]


def validate_node_data(graph: dict[str, Any]) -> list[str]:
    """节点 data 形状校验（阶段 4：start / llm / end）。"""
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


def precheck(graph: dict[str, Any]) -> list[str]:
    """图语义 + 节点 data；返回错误列表（由路由 `"; ".join` 后转 400）。"""
    return [*validate_graph(graph), *validate_node_data(graph)]


async def run_stream(
    app_id: str,
    graph: dict[str, Any],
    inputs: dict[str, Any],
) -> AsyncGenerator[str, None]:
    """产出 SSE 帧：先 `run_started`，后台执行图，逐帧产出直到收到哨兵。"""
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    run_id = str(uuid.uuid4())

    # 先入队 run_started：FIFO 保证它是第一帧
    await queue.put(run_started(run_id, app_id))

    # create_task：后台执行；任务内部自己兜住所有异常，不会产生未取回的异常
    task = asyncio.create_task(_run_graph(graph, inputs, queue, run_id))

    while True:
        event = await queue.get()
        if event is _STREAM_END:
            break
        # 每取一帧就 yield 一帧：消费者（StreamingResponse）写网络
        yield format_sse_frame(event)

    # 等后台任务收尾（正常路径下它已经结束；必要时把异常抛给调用方日志）
    await task


async def _run_graph(
    graph: dict[str, Any],
    inputs: dict[str, Any],
    queue: asyncio.Queue[dict[str, Any] | None],
    run_id: str,
) -> None:
    started_at = time.time()
    # 共享上下文：失败节点 id 与最后一个 end 的输出
    context: dict[str, Any] = {"failed_node_id": None, "last_outputs": {}}
    try:
        builder = StateGraph(RunState)
        for node in graph["nodes"]:
            builder.add_node(node["id"], _make_node_action(node, queue, context))
        for edge in graph["edges"]:
            builder.add_edge(edge["source"], edge["target"])

        start_node = next(node for node in graph["nodes"] if node["type"] == "start")
        builder.add_edge(START, start_node["id"])
        for node in graph["nodes"]:
            if node["type"] == "end":
                builder.add_edge(node["id"], END)

        await builder.compile().ainvoke(
            {"pool": {"inputs": inputs}},
            # 与 TS 侧同样的余量算法
            config={"recursion_limit": max(25, len(graph["nodes"]) * 3 + 20)},
        )

        elapsed_ms = int((time.time() - started_at) * 1000)
        await queue.put(run_finished(run_id, context["last_outputs"], elapsed_ms))
    except Exception as error:  # noqa: BLE001 - 执行期错误统一归一为 run_failed
        await queue.put(run_failed(run_id, context["failed_node_id"], str(error)))
    finally:
        # 哨兵：唤醒等待中的消费者并结束 for 循环
        await queue.put(_STREAM_END)


def _make_node_action(
    node: dict[str, Any],
    queue: asyncio.Queue[Any],
    context: dict[str, Any],
):
    """把图节点包装成 LangGraph 动作：成对发事件，只回写自己那一片 pool。"""

    async def action(state: RunState) -> dict[str, Any]:
        await queue.put(node_started(node["id"], node["type"]))
        try:
            output = await _execute_node(node, state["pool"], queue)
            await queue.put(node_finished(node["id"], node["type"], output))
            if node["type"] == "end":
                context["last_outputs"] = output["outputs"]
            return {"pool": {node["id"]: output}}
        except Exception:
            # 记录失败节点，供 run_failed.nodeId 使用
            context["failed_node_id"] = node["id"]
            raise

    return action


async def _execute_node(
    node: dict[str, Any],
    pool: dict[str, Any],
    queue: asyncio.Queue[Any],
) -> dict[str, Any]:
    """按节点类型分派；阶段 4 只实现三种。"""
    if node["type"] == "start":
        return run_start_node(node, pool)
    if node["type"] == "llm":

        async def emit(text: str) -> None:
            # llm 节点在执行中穿插 token 事件
            await queue.put(token(node["id"], text))

        return await run_llm_node(node, pool, emit)
    if node["type"] == "end":
        return run_end_node(node, pool)
    # 其余类型（knowledge / condition / aggregator / iteration）在后续阶段实现
    raise RunError(f"node type not supported yet: {node['type']}")
```

> **面试考点 · 为什么要放一个 `None` 哨兵？**
> 消费者 `await queue.get()` 在队列空时会永久阻塞。执行器结束后必须有办法说“不会再有事件了”。
> 三种常见做法：
>
> 1. **哨兵值**（本项目）：`queue.put(None)`，消费者见到就 `break`；
> 2. `task.done()` + 超时轮询：多一次超时判断，且可能在“任务结束但队列还有事件”时提前退出；
> 3. `queue.join()` + `task_done()`：适合“生产完等消费完”，但和流式逐条产出结合时更绕。
>
> 哨兵最简单，也最容易保证**剩余事件先被消费完**（FIFO 里 None 一定排在最后）。

> **面试考点 · `create_task` 里的异常去哪了？**
> 如果任务抛异常且没人 `await`，asyncio 会在任务被垃圾回收时打日志 `Task exception was never retrieved`，但**不会**让进程退出（和 Node 的 `unhandledRejection` 不同）。
> 本项目在 `_run_graph` 内部 `try/except/finally` 全包住，任务正常结束；`run_stream` 最后 `await task` 只是兜底与保证顺序。
> 对比 Node：`void promise` 的 rejection 默认会让进程退出（Node 15+），所以 TS 侧更强调“必须自己 catch”。

> **面试考点 · 为什么 `run_stream` 要在最后 `await task`？**
> 哨兵只能保证“执行器发出了结束信号”，不能保证“执行器的 `finally` 之后没有别的代码”。
> `await task` 做两件事：
>
> 1. 若任务因未预期异常失败，把异常暴露在当前任务里（而不是变成“未取回异常”日志）；
> 2. 保证生成器返回前，后台任务已经完全结束——请求级资源（如 DB Session）可以安全释放。
>
> **流结束 ≠ 生产者结束。** 两个都要等。

---

## 6. 路由

**完整文件路径：`apps/api-py/app/api/run.py`**（阶段 4 版本）

```python
"""`POST /apps/{id}/run` 路由 —— 契约见 packages/contract/openapi.yaml。

顺序与 api-ts 一致：
1. 归属校验（404）；
2. 草稿非空（400 `Graph is empty`）；
3. 图预检（400，多条 `"; "` 拼接）。
以上全部通过后才返回 StreamingResponse（SSE）。
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.apps import _find_owned
from app.api.deps import get_current_user, get_db
from app.engine.engine import precheck, run_stream
from app.models.user import User

router = APIRouter(prefix="/apps", tags=["apps"])


class RunRequest(BaseModel):
    """对应契约 `RunRequest`。`extra="forbid"`：伪造字段直接 400。"""

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any]


@router.post("/{id}/run", operation_id="runApp")
async def run_app(
    id: str,
    body: RunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # 1. 归属：查不到 / 非本人 → 404
    app = _find_owned(db, current_user.id, id)
    # 2. 从未保存草稿 → 400
    if app.graph_json is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Graph is empty"
        )
    graph = app.graph_json
    # 3. 预检：图语义 + 节点 data；失败仍返回普通 JSON
    errors = precheck(graph)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors)
        )
    # 4. 预检通过后才创建流
    return StreamingResponse(
        run_stream(app.id, graph, body.inputs),
        media_type="text/event-stream",
        # 显式给 Content-Type：避免 Starlette 追加 `; charset=utf-8`，
        # 与 api-ts 的响应头保持逐字节一致
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
    )
```

`main.py` 追加：

```python
from app.api.run import router as run_router

# ...

app.include_router(run_router)
```

> **面试考点 · `StreamingResponse` 里传异步生成器和同步生成器有什么区别？**
> - **异步生成器**（本项目）：Starlette 直接 `async for` 迭代，运行在事件循环上。里面的 `await queue.get()` 不会阻塞其他请求。
> - **同步生成器**：Starlette 会把它丢到线程池里迭代（`iterate_in_threadpool`），每次 `next()` 都是一次线程切换。如果你在里面用同步 DB，这是“能跑”的方案，但并发一高就吃线程池。
>
> 我们选了 `asyncio.Queue` + 异步生成器，前提是执行器是 `async` 的（LangGraph `ainvoke`）。
> **如果执行器是同步的（比如纯 CPU 计算），不要假装 async —— 用 `run_in_executor` 或直接同步生成器。**

> **面试考点 · `Depends(get_db)` 的 Session 在流式响应期间还活着吗？**
> FastAPI 的 `yield` 依赖在**响应完成后**才执行清理代码。对 `StreamingResponse`，清理发生在流结束之后，所以生成器里可以继续用 `db`。
> 但这带来两个隐患：
>
> 1. 流越长，一个连接被占用越久（连接池压力）；
> 2. 生成器里抛异常时，清理仍会执行，但响应已经发了一半，客户端只能看到断流。
>
> 本项目的做法：**预检阶段的 DB 读取全部在返回 `StreamingResponse` 之前完成**；流内尽量不再查库（阶段 7 的 knowledge 节点是例外，会用到 `db`）。阶段 7 会讨论“流内 DB 访问”的取舍。

> **面试考点 · 为什么显式设置 `Content-Type`？**
> `StreamingResponse(media_type="text/event-stream")` 会让 Starlette 生成 `text/event-stream; charset=utf-8`，而 NestJS 侧我们写的是 `text/event-stream; charset=utf-8`（01 篇）——这里为了对比更直观，**两端都显式设置同一个值**。
> 注意：SSE 的 `charset` 参数在规范里没有特殊含义（SSE 永远是 UTF-8），但**响应头也是契约的一部分**，要么两边都带，要么两边都不带。
> 本仓库最终选择**不带 charset**（见 `run.py` 的 `headers`），因为它更接近 `text/event-stream` 的常见形态；01 篇的 TS 代码带 charset，是阶段 4 的写法，阶段 10 对外 SSE 时统一收口。
>
> **这一条不是“随便”，而是提醒：改响应头会影响契约测试。**

---

## 7. 验证

```powershell
# 启动 Python 后端
uv run uvicorn app.main:app --reload --port 8000
```

```powershell
$token = (Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email='alice@example.com'; password='password123' } | ConvertTo-Json)).accessToken
```

```powershell
# 1. 正常运行（与 api-ts 同一张图、同一份输入）
curl.exe -N -X POST "http://localhost:8000/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"LangGraph\"}}"
```

预期事件与 02 篇完全一致（`runId` / `elapsedMs` 除外）：

```text
run_started
node_started(start) → node_finished(start)
node_started(llm) → token → node_finished(llm)
node_started(end) → node_finished(end)
run_finished
```

```powershell
# 2. 逐字节比对两套后端（去掉随机字段后 diff）
curl.exe -s -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"LangGraph\"}}" > ts.txt

curl.exe -s -N -X POST "http://localhost:8000/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"LangGraph\"}}" > py.txt

# 去掉 runId 与 elapsedMs（它们是运行相关的随机/时间值）
(Get-Content ts.txt) -replace '"runId":"[^"]*"','"runId":"X"' -replace '"elapsedMs":\d+','"elapsedMs":0' |
  Set-Content ts.norm.txt
(Get-Content py.txt) -replace '"runId":"[^"]*"','"runId":"X"' -replace '"elapsedMs":\d+','"elapsedMs":0' |
  Set-Content py.norm.txt

Compare-Object (Get-Content ts.norm.txt) (Get-Content py.norm.txt)
```

`Compare-Object` 无输出 = 逐行一致。

```powershell
# 3. 预检失败仍是 JSON（不是流）
curl.exe -i -X POST "http://localhost:8000/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d "{\"inputs\":{}}"
```

预期的错误体与 TS 一致：

```json
{"statusCode":400,"message":"missing required input: topic","error":"Bad Request"}
```

> 注意：Python 侧的 `message` 由 `run_failed` 事件承载（`start` 节点是执行期失败）；预检失败的例子要换成“无 end 的图”：

```json
{"statusCode":400,"message":"graph must contain at least one end node","error":"Bad Request"}
```

```powershell
# 4. 中文与浮点：验证序列化对齐
```

把 `end.data.outputs` 改为：

```text
[{ "name": "msg", "value": "你好，{{ inputs.topic }}" },
 { "name": "num", "value": "{{ inputs.score }}" }]
```

输入 `{"topic":"世界","score":1.0}`，两端输出都应是：

```json
{"msg":"你好，世界","num":"1"}
```

如果 Python 输出 `"1.0"`，说明 `_stringify` 还没对齐 JS 的浮点规则（阶段 8 的 `js_json_dumps` 会修）。

---

## 8. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 为什么用 `asyncio.Queue` | 解耦生产者与消费者；`await get()` 不阻塞事件循环 |
| 哨兵 `None` 的作用 | 队列空时消费者会永久阻塞；哨兵是“不会再有事件”的唯一信号 |
| `create_task` 异常 | 未取回只打日志，不退出进程；仍应在任务内部 try/except 全包 |
| 为什么最后 `await task` | 流结束不等于生产者结束；同时暴露未预期异常 |
| 异步 vs 同步生成器 | 异步在事件循环；同步被丢进线程池，每次 `next()` 一次线程切换 |
| `Depends(get_db)` 生命周期 | 响应完成后才清理；流越长连接占用越久，流内尽量不查库 |
| `ensure_ascii=False` | 否则中文变 `\uXXXX`，与 `JSON.stringify` 不一致 |
| `separators` | 默认带空格；必须紧凑才能逐字节一致 |
| `1.0` vs `1` | Python `json.dumps` 输出 `1.0`，JS 输出 `1`；要显式归一 |
| 错误分层 | 预检 = HTTP 400；执行期 = `run_failed`；两套后端顺序必须一致 |
| `Content-Type` 的 charset | 也是契约的一部分，两端必须一致 |

---

## 9. 下一步

- `05-前端流式面板.md`：`fetch` + `ReadableStream` 切帧、Zod 校验每个 `data`、token 增量渲染、终态与错误展示。
- 阶段 5 起：`llm` 节点从回显占位换成真实模型（流式、错误映射、mock-LLM 无密钥自测）。
