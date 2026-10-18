# 04 · LangGraph 与引擎（Python）

> 所属：阶段 4 · 执行引擎
> 本篇覆盖：Python 侧**执行器**——用 **LangGraph** 把契约里的 `Graph`（一份 JSON）编译成 `StateGraph` 并执行，事件经 `asyncio.Queue` **异步外发**，由 FastAPI 的 `StreamingResponse` 消费成 SSE。涉及 `apps/api-py/app/engine/engine.py`、`events.py`、`nodes/__init__.py`；依赖 `langgraph==1.2.16`（附 `langchain-core==1.6.12`）。
> **本篇首次教学：① Python 版 LangGraph 的写法（`StateGraph` + `TypedDict` 定义状态 + `Annotated` 合并 reducer + `START`/`END` + `add_node`/`add_edge`/`compile()`/`ainvoke()`）；② 与 TS 版 LangGraph 的 API 逐条对照（`Annotation` vs `TypedDict`+`Annotated`）；③ 事件如何异步外发（`asyncio.Queue` ↔ 异步生成器 ↔ `StreamingResponse`）；④ 为什么不用 LangGraph 的 custom stream（自建队列，两端事件可控可比）。**
> （技术点引用：变量池 / 模板解析 / 节点运行时见 `04-执行引擎/03-节点运行时与变量池.md`；SSE 帧格式与事件协议的**唯一真源**是 `packages/contract/sse-events.md`；引擎文案唯一真源是 `packages/contract/error-messages.md` §4；`Graph` 结构与图校验见 `03-画布/01-图JSON契约与校验.md`；`uv` / `pyproject.toml` 见 `00-项目初始化/01-环境准备.md`；Python 类型注解见 `00-项目初始化/06-FastAPI起步.md`；`StreamingResponse` / FastAPI 路由见 `00-项目初始化/06-FastAPI起步.md`。）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 定位：TS 引擎先行，Python 逐条对齐

阶段 4 的先落方是 **TS 侧**（NestJS 的 `EngineService`，见 TS 引擎篇）。Python 侧的目标不是「另写一套」，而是**用 Python 复刻同一套语义**，使得同一张图在两端跑出**逐字节相同**的事件序列。

```
同一份 Graph（JSON）
   ├── TS  : apps/api-ts/src/engine/engine.service.ts  ← 用 @langchain/langgraph
   └── Py  : apps/api-py/app/engine/engine.py          ← 用 langgraph
                     │
                     ▼ 两者都：LangGraph 编译执行 + 自建事件队列 + 手写 SSE 帧
              事件序列（除 runId / elapsedMs 外逐字节相同）
```

对齐的**真源**是两份契约文档：`packages/contract/sse-events.md`（帧格式、事件种类、顺序、引擎语义）与 `packages/contract/error-messages.md` §4（预检与执行期文案）。两端都照它实现，才有「可逐字节比对」的底气。

---

## 1. 本篇目标

- 讲透 **Python 版 LangGraph 的基本写法**：怎么定义「状态（State）」、怎么用 **合并 reducer** 让节点输出逐步累积、怎么把节点与边接起来、怎么 `compile()` 并 `ainvoke()`。
- 讲透**与 TS 版 LangGraph 的 API 一一对应**：`Annotation` ↔ `TypedDict`+`Annotated`；`addNode`↔`add_node`；`invoke`↔`ainvoke`……
- 讲透**事件如何异步外发**：`asyncio.Queue` 收集、`asyncio.create_task` 后台执行、**异步生成器**逐帧产出、`StreamingResponse` 消费。
- 讲透**为什么不用 LangGraph 的 custom stream**：为了两端事件**可控、可比、与执行器解耦**。

**验收标准**

1. `uv sync --project apps/api-py` 成功；`langgraph` 版本为 **`1.2.16`**、`langchain-core` 为 **`1.6.12`**。
2. 同一张图（`start → llm → end`）在 Python 端跑出**与 TS 端相同的事件序列**（除 `runId` / `elapsedMs` 外逐字节相同）。
3. `token` 分片一致：`"Hello mi"` + `"ni-dify"`（每 8 个码点）。
4. `run_finished.outputs` 为 `{"result":"Hello mini-dify"}`。
5. 模板取不到 / 缺必填输入时，流内 `run_failed` 的 `message` 分别为 `template variable not found: inputs.nope`、`missing required input: topic`。

---

## 2. 前置条件

- `03-节点运行时与变量池.md` 已完成（`template.py`、`nodes/start.py`、`nodes/llm.py`、`nodes/end.py` 就位）。
- `POST /apps/{id}/run` 路由已就位（`apps/api-py/app/api/run.py`）：预检 + `StreamingResponse(run_stream(...))`。
- 契约已升到 `0.4.0`（`packages/contract/openapi.yaml` 含 `/apps/{id}/run`、`RunRequest`；`sse-events.md`、`error-messages.md` §4 已就位）。
- 两端后端能起：`pnpm dev:api-py`（Python）、`pnpm dev:api-ts`（TS，用于对比）。

---

## 3. 先看清要做什么

`engine.py` 一次运行的完整数据流：

```
run_stream(app_id, graph, inputs)                     ← 对外入口（异步生成器）
   │ 建 asyncio.Queue；run_id = uuid4()
   │ await queue.put(run_started(...))                ← ① 先发 run_started
   │ task = asyncio.create_task(_run_graph(...))       ← ② 后台跑图
   │ while True: event = await queue.get()             ← ③ 循环取事件
   │     if event is None: break                        （哨兵：队列关闭）
   │     yield format_sse_frame(event)                  ← ④ 逐帧产出 SSE 字符串
   │ await task
   ▼
_run_graph(graph, inputs, queue, run_id)               ← 后台协程（真正的执行）
   │ 建 StateGraph(RunState)
   │ for node in graph["nodes"]: add_node(id, action)   ← 每个节点一个动作
   │ for edge in graph["edges"]: add_edge(src, tgt)
   │ add_edge(START, start_node_id)                     ← 起点
   │ for end 节点: add_edge(end_id, END)                ← 终点
   │ await compiled.ainvoke({"pool": {"inputs": inputs}}) ← 执行（初始池）
   │ await queue.put(run_finished(run_id, last_outputs, elapsed_ms))
   │ （出错）await queue.put(run_failed(run_id, failed_node_id, str(error)))
   │ finally: await queue.put(None)                     ← 关闭队列
   ▼
每个节点 action(state)：
   │ await queue.put(node_started(...))
   │ output = await _execute_node(node, state["pool"], queue)   ← 纯逻辑（见 03 篇）
   │   └ llm 节点执行中穿插：await queue.put(token(...))         ← 分片外发
   │ await queue.put(node_finished(node_id, node_type, output))
   │ if end: context["last_outputs"] = output["outputs"]
   └ return {"pool": {node_id: output}}                 ← 增量；由 reducer 合并
```

三件事分别由三处负责：

| 职责 | 文件 | 本篇章节 |
| --- | --- | --- |
| LangGraph 编译 / 执行 / 事件编排 | `apps/api-py/app/engine/engine.py` | §5、§7、§9 |
| 事件构造 + 帧序列化 | `apps/api-py/app/engine/events.py` | §7、§10 |
| 节点纯逻辑（不在此文件，见 03 篇） | `apps/api-py/app/engine/nodes/*.py` | 03 篇 |

---

## 4. 命令清单（逐条说明）

> 全部在仓库根目录 `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | 仓库根 | 按 `uv.lock` 拉齐依赖（含 `langgraph`） | 依赖装好，无报错 |
| `uv run --directory apps/api-py python -c "from importlib.metadata import version; print(version('langgraph'), version('langchain-core'))"` | 仓库根 | 核对版本 | `1.2.16 1.6.12` |
| `pnpm dev:api-py` | 仓库根 | 起 FastAPI（含执行引擎），端口 `8000` | `Uvicorn running on http://127.0.0.1:8000` |

**依赖声明（`apps/api-py/pyproject.toml` 相关行）**：

```toml
dependencies = [
    # …（fastapi / uvicorn / pydantic / sqlalchemy / …）
    "langgraph>=1.2.16",
]
```

- `pyproject.toml` 声明的是**下界** `>=1.2.16`；`uv.lock` 把它**锁定**为 **`langgraph==1.2.16`**，并锁定其传递依赖 **`langchain-core==1.6.12`**。
- `langgraph` 是**执行图**的库（`StateGraph` / 编译 / 运行），`langchain-core` 是它的底座（被 `langgraph` 依赖，不需要你直接声明）。
- （`pyproject.toml` / `uv` 的机制见 `00-项目初始化/01-环境准备.md`，此处只引用。）

---

## 5. 【技术教学 · 首次】Python 版 LangGraph 的写法

LangGraph 的核心抽象是 **「状态图（StateGraph）」**：一个**状态**在若干**节点**间流动，节点读状态、返回**对状态的更新**，边决定「下一个跑谁」。与阶段 3 的 `Graph` 结构（`nodes` + `edges`）天然同构——所以我们能把契约里的 `Graph`「编译」成一张 `StateGraph`。

### 5.1 第一步：定义「状态」——`TypedDict` + `Annotated` reducer

本引擎的状态只有一个键：`pool`（变量池，见 `03-节点运行时与变量池.md`）。

```python
from typing import Annotated, Any, TypedDict


def _merge_pool(previous: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """变量池合并 reducer：节点返回 `{"pool": {<nodeId>: <output>}}` 逐步累积。"""
    return {**previous, **update}


class RunState(TypedDict):
    pool: Annotated[dict[str, Any], _merge_pool]
```

**逐项讲透**：

| 语法 | 是什么 | 本例中为什么这么用 |
| --- | --- | --- |
| `TypedDict` | 用「类」的写法给一个 **dict** 标注「有哪些键、值什么类型」。运行期它就是普通 `dict`，不产生对象 | 把「状态长什么样」声明清楚：状态是 `{"pool": {...}}` |
| `Annotated[T, x]` | 给类型 `T` **附加一段元数据** `x`（这里 `x` 是个函数）。运行期仅作标注 | LangGraph 读到元数据后，知道 `pool` 这个键被多次更新时**如何合并** |
| `_merge_pool(previous, update)` | **reducer**：两个同名字典合并成一个（浅合并，后者覆盖前者同名键） | 节点只返回自己那一个键 `{ "<nodeId>": output }`，reducer 把它并进**已经累积的池子** |

**为什么需要 reducer**：一张图里**多个节点**都会更新 `pool`（每个节点加一个自己的键）。如果没有 reducer，LangGraph 遇到「同键多次更新」要么冲突要么整体覆盖；有了 `_merge_pool`，每次更新都是「**并进去**」——这正是 §5（03 篇）里「节点跑完写回 `pool[nodeId]`」的实现。

> `Annotated` 附加的 reducer **不是** Python 的运行期行为，而是 **LangGraph 在编译图时读注解**认出来的约定。

### 5.2 第二步：建图——`StateGraph` / `START` / `END` / `add_node` / `add_edge`

```python
from langgraph.graph import END, START, StateGraph

builder = StateGraph(RunState)                         # 用 RunState 作状态定义
for node in graph["nodes"]:                            # 每个契约节点 → 一个图节点
    builder.add_node(node["id"], _make_node_action(node, queue, context))
for edge in graph["edges"]:                            # 每条契约边 → 一条图边
    builder.add_edge(edge["source"], edge["target"])
start_node = next(node for node in graph["nodes"] if node["type"] == "start")
builder.add_edge(START, start_node["id"])              # 入口：START → start 节点
for node in graph["nodes"]:
    if node["type"] == "end":
        builder.add_edge(node["id"], END)              # 出口：end 节点 → END
compiled = builder.compile()                           # 编译成可执行图
```

| API | 作用 |
| --- | --- |
| `StateGraph(RunState)` | 建一个状态图，状态形状由 `RunState` 描述 |
| `builder.add_node(key, action)` | 加一个节点：`key` 是节点 id，`action` 是 `async def action(state) -> dict` |
| `builder.add_edge(from, to)` | 加一条**静态边**：跑到 `from` 后接着跑 `to` |
| `START` / `END` | 两个**特殊常量**：图的「虚拟入口 / 出口」。`add_edge(START, x)` 表示「第一步跑 `x`」；`add_edge(x, END)` 表示「跑到 `x` 就结束」 |
| `builder.compile()` | 把声明好的图**编译**成可运行的 `CompiledStateGraph` |

**关键点**：节点 id 与边都是**动态**来的（来自契约 `Graph` 的 `nodes` / `edges`）。我们不是手写死图，而是**遍历 JSON 建图**——这就是「把一份 JSON 编译成可执行的图」。由此也引出一个约束：`graph["nodes"]` 里**恰有一个 `start`**（`next(...)` 假定如此），这由阶段 3 的图校验 `validate_graph` 与运行前预检共同保证。

**节点动作的形状**（`_make_node_action` 用闭包把「节点 + 队列 + 上下文」绑进一个 `async` 函数）：

```python
async def action(state: RunState) -> dict[str, Any]:
    # 读 state["pool"]，返回 {"pool": {自己id: 输出}}；顺带发事件
    ...
```

LangGraph 约定：节点函数**接收当前状态、返回状态的「更新部分」**——这就是 `03-节点运行时与变量池.md` §7 讲的「节点 = 纯函数」在 LangGraph 里的形态（`(state) → Partial<State>`）。

### 5.3 第三步：执行——`ainvoke`

```python
await compiled.ainvoke({"pool": {"inputs": inputs}})
```

| API | 作用 |
| --- | --- |
| `compiled.ainvoke(initial_state)` | **异步**执行整图，入参是**初始状态**。这里初始池就是 `{"inputs": <运行输入>}`（见 03 篇 §5） |
| （同步版 `compiled.invoke(...)`） | TS 侧用的是同步 `invoke`；Python 侧因为要 `await` 队列，用**异步** `ainvoke` |

执行时，LangGraph 按拓扑序把节点 action 逐个 `await`（每个节点**执行一次**、仅可达节点），每一步把 action 返回的增量用 **reducer 合并**进状态。

---

## 6. 【技术教学 · 首次】与 TS 版 LangGraph 的 API 对照

同一件事，`@langchain/langgraph`（TS）与 `langgraph`（Python）的 API **概念一一对应**，只是语法不同：

| 概念 | TS（`@langchain/langgraph`，`engine.service.ts`） | Python（`langgraph`，`engine.py`） |
| --- | --- | --- |
| 定义状态 | `const RunState = Annotation.Root({ pool: Annotation<Pool>({ reducer, default }) })` | `class RunState(TypedDict): pool: Annotated[dict, _merge_pool]` |
| 附加合并 reducer 的写法 | `Annotation<T>({ reducer })` —— reducer 作为**配置项** | `Annotated[T, reducer]` —— reducer 作为**类型元数据** |
| 初始值 | 注解里给 `default: () => ({})` | 不给 default，在 `ainvoke({...})` 传初始状态 |
| 建图 | `new StateGraph(RunState)` | `StateGraph(RunState)` |
| 加节点 | `builder.addNode(id, action)` | `builder.add_node(id, action)` |
| 加边 | `builder.addEdge(from, to)` | `builder.add_edge(from, to)` |
| 特殊入口 / 出口 | `import { START, END }` | `from langgraph.graph import START, END` |
| 编译 | `builder.compile()` | `builder.compile()` |
| 执行 | `compiled.invoke({ pool: { inputs } })`（**同步**） | `await compiled.ainvoke({"pool": {"inputs": inputs}})`（**异步**） |
| 事件外发 | 自建 `RunEventQueue`（`emit` / `drain`） | 自建 `asyncio.Queue`（`put` / `get`） |

**为什么会有这些写法差异**：

- **TS 用 `Annotation`（运行期对象）**：JS 没有「类型注解」，`Annotation` 是一个**真实的运行期对象**，用来描述「状态有哪些键、每个键怎么合并」，并内建 `default`。
- **Python 用 `TypedDict` + `Annotated`（类型层）**：Python 有 `typing`，可以直接在**类型注解**上挂 reducer（`Annotated[dict, _merge_pool]`），更贴近「状态就是一个有 reducer 的 dict」。
- **`invoke` vs `ainvoke`**：TS 侧队列是自定义的同步对象（单线程事件循环），用同步 `invoke` 即可；Python 侧要 `await asyncio.Queue.get()`，必须用异步 `ainvoke`。两者是**同一语义在两种异步模型下的自然形态**。

> 一句话：**LangGraph 的抽象（State / Node / Edge / START / END / compile / invoke）两端完全一致**；差异只在「怎么把 reducer 和类型挂上去」「同步还是异步」。理解了这个对照，读 TS 引擎与读 Python 引擎就是同一张图。

---

## 7. 【技术教学 · 首次】事件如何异步外发（`asyncio.Queue` ↔ 异步生成器 ↔ `StreamingResponse`）

### 7.1 背景：图在「后台」跑，事件要「边跑边发」

执行整图会持续一段时间（阶段 5 接真模型后更久）。我们要把执行过程中产生的事件（`node_started` / `token` / …）**实时**送给 HTTP 响应流，而不是「跑完再一次性返回」。做法：**生产者（图执行）与消费者（HTTP 流）通过一个 `asyncio.Queue` 解耦**。

```
生产者（后台协程 _run_graph）             消费者（异步生成器 run_stream → StreamingResponse）
        await queue.put(event)  ───────▶  event = await queue.get()
        await queue.put(None)   ───────▶  取到 None 即停（哨兵）
```

### 7.2 三个 asyncio 原语

| 原语 | 是什么 | 本例用途 |
| --- | --- | --- |
| `asyncio.Queue()` | 一个**协程安全**的 FIFO 队列。`await put(x)` 入队、`await get()` 出队（空队列时 `get` 会**让出控制权等待**，不阻塞线程） | 事件从执行协程流到生成器 |
| `asyncio.create_task(coro)` | 把一个协程**排进事件循环后台执行**，立即返回 `Task`（不阻塞当前协程） | 让 `_run_graph` 在后台跑，主协程继续从队列取事件 |
| **异步生成器**（`async def` 里带 `yield`） | 一个可被 `async for` / `anext` 逐项消费的「异步流」 | `run_stream` 逐帧产出 SSE 字符串 |

```python
async def run_stream(app_id, graph, inputs) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    run_id = str(uuid.uuid4())
    await queue.put(run_started(run_id, app_id))           # ① 先发 run_started
    task = asyncio.create_task(_run_graph(graph, inputs, queue, run_id))  # ② 后台跑图
    while True:
        event = await queue.get()                          # ③ 逐条取（空则挂起等待）
        if event is None:                                  #    哨兵：队列被关闭
            break
        yield format_sse_frame(event)                      # ④ 产出 SSE 字符串
    await task                                              # ⑤ 收尾（等后台任务结束）
```

**「异步生成器 ↔ 队列」的配合方式**：

1. **先发 `run_started`、再启动图**：保证「流一开始就有一帧」，且顺序固定（见 `sse-events.md` §3）。
2. **`create_task` 而非 `await _run_graph(...)`**：若直接 `await`，会「跑完整图才开始产出事件」，退化成「非流式」。`create_task` 让它后台跑。
3. **`while True: await queue.get()`**：消费方**边取边 yield**；队列空时 `get` 会让出控制权，等生产者 `put` 再唤醒——事件自然**按产生顺序**流出。
4. **哨兵 `None` 收束流**：`_run_graph` 无论成功失败，`finally` 里都 `await queue.put(None)`；消费方一见 `None` 就 `break`，生成器结束，HTTP 流关闭。**用一个 `None` 当「流结束」信号**，比在队列上额外维护状态更简单。
5. **`await task`**：循环结束后等后台任务真正结束，确保异常被 `_run_graph` 内部捕获（归一为 `run_failed`）后不留下「游离任务」。

### 7.3 谁来消费这个异步生成器？——`StreamingResponse`

`apps/api-py/app/api/run.py`：

```python
return StreamingResponse(
    run_stream(app.id, graph, body.inputs),
    media_type="text/event-stream",
    headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
)
```

`StreamingResponse` 接受一个（异步）迭代器，边拿到 chunk 边写响应。这里传入的正是 `run_stream(...)` 这个**异步生成器**——每个 `yield` 出来的字符串就是一帧 SSE 文本，`StreamingResponse` 直接把它写出去。

> **帧序列化**：`yield` 的是 `format_sse_frame(event)` 的**结果字符串**（`event: <name>\n` + `data: <单行 JSON>\n\n`）。**为什么不把「帧格式」交给框架**：见 §8——帧要**逐字节可控**，所以两端都**手写**帧，而不是依赖框架的序列化（帧格式本身的首次教学见本阶段 `01-运行契约与SSE事件协议.md`）。TS 侧对应的是 `RunController` 里手写 `response.write(...)`（服务端「不结束响应地持续写」见 `05-SSE流式响应实现.md`）。

> **为什么显式给 `headers`**：Starlette 会往 `media_type` 后面追加 `; charset=utf-8`，与 TS 端响应头不一致。显式写 `Content-Type: text/event-stream` 覆盖掉，保证两端响应头也对齐（细节见 `run.py` 注释）。

---

## 8. 【技术教学 · 首次】为什么不用 LangGraph 的 custom stream

LangGraph 自带「把中间过程当流吐出来」的能力（`stream_mode="custom"`：节点里用 `get_stream_writer()` 往框架的流写自定义数据，外层用 `astream(..., stream_mode="custom")` 消费）。**本项目没有用它**，而是**自建队列**（Python 的 `asyncio.Queue`、TS 的 `RunEventQueue`）。原因：

| 用 custom stream | 自建队列（本项目做法） |
| --- | --- |
| 事件的**包装方式由 LangGraph 决定**：它会把自己的流协议细节套在自定义数据外（如 `{"type": ..., "data": ...}` 的包裹、分块口径、可能的元数据） | 事件的**形状完全由我们定义**（`{ event, data }`），帧格式手写 |
| 两端用的是**不同语言的两套 LangGraph 实现**，流的包裹细节**很难保证逐字节一致** | 两端都按 `sse-events.md` 手写，**除 `runId` / `elapsedMs` 外逐字节相同**，可机器比对 |
| 事件与「执行器」**耦合**：换框架 / 升版本可能改变流的行为 | 事件与执行器**解耦**：图只负责 `queue.put(...)`，流由生成器/控制器消费，换执行方式不影响协议 |
| 版本行为随 LangGraph 演进而变 | 协议稳定，**归我们自己掌控** |

引擎源码的注释把这层取舍写得很直白：

```python
# 说明（自行做主的设计决定）：事件通过自建 `asyncio.Queue` 传出，而非 LangGraph 的 custom
# stream —— 这样两端事件顺序与 payload 完全可控、可比，且与执行器解耦。
```

> TS 侧的 `EngineService` 注释写的是**同一句话**（`RunEventQueue` 而非 custom stream）。**两端做同一个取舍**，是本项目「契约先行、逐字节对齐」的一贯思路：**凡是要比对的东西，都要握在自己手里。**

---

## 9. 完整代码：`engine.py`

**完整文件路径：`apps/api-py/app/engine/engine.py`**

```python
"""执行引擎（阶段 4）核心：用 **LangGraph** 把契约里的 `Graph` 编译成 `StateGraph` 并执行。

与 api-ts 的 `apps/api-ts/src/engine/engine.service.ts` 对齐（见 sse-events.md §4）：
动态 `add_node(node_id, fn)`、按 `edges` 连边、`START → start`、`end → END`。
运行前先做预检（草稿非空、`validate_graph`、节点数据形状），不通过即 400（普通 JSON）。

说明（自行做主的设计决定）：事件通过自建 `asyncio.Queue` 传出，而非 LangGraph 的 custom
stream —— 这样两端事件顺序与 payload 完全可控、可比，且与执行器解耦。
"""

import asyncio
import time
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.engine.events import (
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


def _merge_pool(previous: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """变量池合并 reducer：节点返回 `{"pool": {<nodeId>: <output>}}` 逐步累积。"""
    return {**previous, **update}


class RunState(TypedDict):
    pool: Annotated[dict[str, Any], _merge_pool]


def validate_node_data(graph: dict[str, Any]) -> list[str]:
    """节点数据形状校验（引擎侧，见 error-messages.md §4.1）。"""
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
        compiled = builder.compile()
        await compiled.ainvoke({"pool": {"inputs": inputs}})
        elapsed_ms = int((time.time() - started_at) * 1000)
        await queue.put(run_finished(run_id, context["last_outputs"], elapsed_ms))
    except Exception as error:  # noqa: BLE001 - 任何执行期错误都归一为 run_failed
        await queue.put(run_failed(run_id, context["failed_node_id"], str(error)))
    finally:
        await queue.put(None)


def _make_node_action(node: dict[str, Any], queue: asyncio.Queue[Any], context: dict[str, Any]):
    """生成某节点的执行动作（LangGraph node）：发开始/结束事件，失败时记录出错节点。"""

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

**读法要点**：
- `validate_node_data` 的 `str(error)`（在 `except` 里）：`RunError` 继承 `Exception`，`str(error)` 就是它的 `message`——所以流内 `run_failed` 的 `message` 与 03 篇两处抛出的文案**逐字一致**。
- `context` 是「一次运行的共享回写区」：`failed_node_id` 记录是哪个节点出错（`run_failed.nodeId` 要用），`last_outputs` 记录最后执行的 `end` 节点输出（`run_finished.outputs` 要用）。
- `_execute_node` 里 `llm` 的 `emit` 是**异步闭包**：`await queue.put(token(...))` 把分片事件塞进队列（分片逻辑在 `nodes/llm.py`，见 03 篇 §8）。
- `return {"pool": {node["id"]: output}}`：只返回**增量**，累积交给 `_merge_pool`（§5.1）。
- 多个 `end` 节点时，`context["last_outputs"]` 会被**拓扑序最后一个** `end` 覆盖——与 `sse-events.md` §4 的约定一致。

---

## 10. 完整代码：`events.py`

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

**读法要点**：
- `format_sse_frame` 的 `f"event: {event['event']}\ndata: {payload}\n\n"`：**两行 + 一个空行**，`event:` 在前、`data:` 在后，帧以 `\n\n` 结束——逐字节钉死 `sse-events.md` §1。
- `json.dumps(..., ensure_ascii=False, separators=(",", ":"))`：与 03 篇 §9 的「非字符串值渲染」**同一口径**——**紧凑 + 不转义非 ASCII**，对齐 JS 的 `JSON.stringify`。不写这两个参数就会与 TS 端字节不一致。
- `RunError(Exception)`：**执行期错误**的统一类型，`str(err)` 即交给 `run_failed` 的 `message`。它被 `template.py` 与 `nodes/*` 抛出（见 03 篇）。

---

## 11. 完整代码：`nodes/__init__.py`

**完整文件路径：`apps/api-py/app/engine/nodes/__init__.py`**

```python
"""节点执行（start / llm / end），与 api-ts 的 `engine/nodes/*` 对齐。

只做纯逻辑（入参为节点 dict 与变量池），事件由上层 engine 通过回调/队列发出。
"""
```

> 这是一个「**包说明**」文件：`nodes/` 目录下三个节点模块（`start.py` / `llm.py` / `end.py`）的**纯逻辑**见 `03-节点运行时与变量池.md`；这里的 docstring 点明关键分工——**节点只做纯逻辑，事件由上层 engine 发**。

---

## 12. 验收自测

### 12.1 依赖与版本

```bash
uv sync --project apps/api-py
uv run --directory apps/api-py python -c "from importlib.metadata import version; print(version('langgraph'), version('langchain-core'))"
# 预期：1.2.16 1.6.12
```

### 12.2 同一张图，两端跑出同一事件序列

1. 起两端：`pnpm dev:api-ts`（`3001`）、`pnpm dev:api-py`（`8000`）。
2. 用**同一张图**（见 `03-节点运行时与变量池.md` §13.2 的 `start → llm → end` 样例）分别在两端 `PUT` 草稿。
3. 两端各跑一次并把流存文件：

```bash
curl -N -s -X POST "http://localhost:3001/apps/${APP_ID}/run" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"inputs":{"topic":"mini-dify"}}' > ts.txt

curl -N -s -X POST "http://localhost:8000/apps/${APP_ID}/run" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"inputs":{"topic":"mini-dify"}}' > py.txt
```

4. **归一化**掉两端必然不同的两处（`runId` 与 `elapsedMs`）后比对：

```bash
# 把 runId / elapsedMs 的值抹成占位符，再 diff
sed -E 's/"runId":"[^"]*"/"runId":"?"/g; s/"elapsedMs":[0-9]+/"elapsedMs":?/g' ts.txt > ts.norm
sed -E 's/"runId":"[^"]*"/"runId":"?"/g; s/"elapsedMs":[0-9]+/"elapsedMs":?/g' py.txt > py.norm
diff ts.norm py.norm && echo "两端逐字节一致"
```

**预期**：`diff` **无输出**（除占位化字段外逐字节相同），打印 `两端逐字节一致`。

**逐帧验收点**：

| 检查项 | 预期 |
| --- | --- |
| `token` 分片 | 恰好两片：**`"Hello mi"`** + **`"ni-dify"`** |
| `run_finished.outputs` | **`{"result":"Hello mini-dify"}`** |
| 帧格式 | 每帧 `event: <name>\n data: <单行 JSON>\n\n`，与 TS 端一致 |
| 两端差异 | **只有** `runId` 与 `elapsedMs` |
| 模板取不到 | 图里把 `end` 的 `value` 改成 `{{ inputs.nope }}` → 流内 `run_failed`，`message` = `template variable not found: inputs.nope` |
| 缺必填输入 | `-d '{"inputs":{}}'` → 流内 `run_failed`，`message` = `missing required input: topic` |

> 注：**预检失败**（草稿为空 / 图不合法 / 节点数据形状非法）返回的是**普通 JSON 400**（`error-messages.md` §4.1），**不开 SSE 流**；只有进入执行后才可能出现流内的 `run_failed`（`error-messages.md` §4.2）。

---

## 13. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 忘了用合并 reducer | 节点输出互相覆盖，池里只剩最后一个节点的键 | 状态必须写 `Annotated[dict, _merge_pool]`（Python）/ `Annotation({ reducer })`（TS）（§5.1、§6） |
| 节点返回**整份池**而非增量 | 多节点下互相覆盖、行为不确定 | 节点动作只返回 `{"pool": {自己id: 输出}}`，累积交给 reducer（§5.1、§9） |
| 用 `await _run_graph(...)` 直接跑 | 「跑完整图才一次性返回」，退化成非流式 | 必须 `asyncio.create_task(...)` **后台**跑，主协程 `await queue.get()` 边取边发（§7.2） |
| 忘了发哨兵 `None` | 消费方 `await queue.get()` 永远等下去，HTTP 流不结束 | `_run_graph` 的 `finally` 里 `await queue.put(None)`；消费方见 `None` 即 `break`（§7.2、§9） |
| 队列未关就抛出异常 | 客户端挂起 / 任务泄漏 | 把 `put(None)` 放进 `finally`；`except` 里先归一成 `run_failed`（§9） |
| 用 LangGraph 的 custom stream | 事件形状随框架变化，两端难逐字节对齐 | 自建 `asyncio.Queue`/`RunEventQueue`，帧手写（§8） |
| Python 用默认 `json.dumps` 序列化帧 | data 行带空格 / 中文被转义，与 TS 不一致 | `ensure_ascii=False, separators=(",", ":")`（§10，同 03 篇 §9） |
| 让 Starlette 自动补 `; charset=utf-8` | 两端响应头不同 | `StreamingResponse` 显式给 `Content-Type: text/event-stream` 覆盖（§7.3） |
| 忘了 `pnpm dev:api-py` 用 `--directory` | `ModuleNotFoundError: No module named 'app'` | 根脚本已是 `uv run --directory apps/api-py uvicorn ...`（见 `00-项目初始化/01-环境准备.md`） |
| `langgraph` 版本任意浮动 | 流行为可能随版本变化 | `uv.lock` 钉死 `1.2.16`（其底座 `langchain-core` `1.6.12`）；用 `uv sync` 保持一致（§4） |

---

## 14. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **Python 版 LangGraph 写法** | `StateGraph` + `TypedDict` 定义状态 + `Annotated[T, reducer]` 合并 reducer + `START`/`END` + `add_node`/`add_edge`/`compile()`/`ainvoke()`；把契约 JSON **动态编译**成可执行图 | **首次教学于本篇** |
| **与 TS 版 LangGraph 的 API 对照** | TS `Annotation.Root` / `Annotation({reducer, default})` ↔ Python `TypedDict` + `Annotated`；`addNode/addEdge/invoke` ↔ `add_node/add_edge/ainvoke`——概念一一对应 | **首次教学于本篇** |
| **事件异步外发机制** | `asyncio.Queue`（生产者 `put` / 消费者 `get`）+ `asyncio.create_task` 后台执行 + **异步生成器**逐帧 `yield` + `StreamingResponse` 消费；`None` 作哨兵收束流 | **首次教学于本篇** |
| **为什么不用 LangGraph 的 custom stream** | 自建队列让两端事件**形状可控、逐字节可比、与执行器解耦**；与 TS 侧同一取舍（`RunEventQueue`） | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：变量池 / 模板解析 / 节点运行时（含 `llm` 桩分片、非字符串值渲染口径）见 `04-执行引擎/03-节点运行时与变量池.md`；SSE 帧格式与事件协议（含 6 种事件与固定顺序）见 `04-执行引擎/01-运行契约与SSE事件协议.md`（唯一真源为 `packages/contract/sse-events.md`）；服务端「不结束响应地持续写」见 `04-执行引擎/05-SSE流式响应实现.md`；引擎文案唯一真源为 `packages/contract/error-messages.md` §4；`uv` / `pyproject.toml` / `uv.lock` 见 `00-项目初始化/01-环境准备.md`；Python 类型注解 / Pydantic 见 `00-项目初始化/06-FastAPI起步.md`；`StreamingResponse` / FastAPI 路由见 `00-项目初始化/06-FastAPI起步.md`。
