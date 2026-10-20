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
from typing import Annotated, Any, TypedDict          # Annotated：给「类型」挂一段附加元数据；TypedDict：给 dict 标注「有哪些键、值什么类型」


def _merge_pool(previous: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """变量池合并 reducer：节点返回 `{"pool": {<nodeId>: <output>}}` 逐步累积。"""
    return {**previous, **update}                      # 字典解包合并：update 的同名键覆盖 previous（≈ TS 的 { ...previous, ...update }）


class RunState(TypedDict):                              # 用「类」的写法声明一个「状态字典」的形状
    pool: Annotated[dict[str, Any], _merge_pool]       # pool 的值是 dict；并把 _merge_pool 作为「合并规则」挂上去
```

**这段在干什么（按执行顺序）**：

1. `from typing import Annotated, Any, TypedDict`：导入三个**类型工具**（注意：它们只在「写代码时」有意义，不影响运行期）。
2. `def _merge_pool(previous, update) -> dict`：**定义**一个普通函数，两个参数都是字典。它此刻**只被定义、不会执行**；函数体 `return {**previous, **update}` 是把 `update` 并入 `previous`（同名键以后者为准）。**读法**：`**` 是「字典解包」，等价 TS 的 `{ ...previous, ...update }`。
3. `class RunState(TypedDict):`：声明「状态长什么样」——**运行期它就是个普通 `dict`**，不会创建任何对象、也不校验。
4. `pool: Annotated[dict[str, Any], _merge_pool]`：给 `pool` 这个键标注「值是 `dict[str, Any]`」，**并附加** `_merge_pool` 这段元数据。LangGraph 在**编译图**时读到这行，才知道「多个节点都更新 `pool` 时，用 `_merge_pool` 把它们并起来」。

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
from langgraph.graph import END, START, StateGraph     # END / START 是「虚拟出口 / 入口」两个常量；StateGraph 是状态图类

builder = StateGraph(RunState)                         # 建一张状态图，状态形状由 RunState 描述（这里还没加任何节点）
for node in graph["nodes"]:                            # 遍历契约 JSON 里的每个节点
    builder.add_node(node["id"], _make_node_action(node, queue, context))   # 节点 id 作 key，动作函数作 value
for edge in graph["edges"]:                            # 遍历契约 JSON 里的每条边
    builder.add_edge(edge["source"], edge["target"])   # 静态边：跑到 source 后接 target
start_node = next(node for node in graph["nodes"] if node["type"] == "start")   # 找到唯一的 start 节点
builder.add_edge(START, start_node["id"])              # 入口：START（虚拟）→ start 节点
for node in graph["nodes"]:
    if node["type"] == "end":
        builder.add_edge(node["id"], END)              # 出口：end 节点 → END（虚拟）
compiled = builder.compile()                           # 把「声明好的图」编译成可运行的图对象
```

**这段在干什么（按执行顺序）**：

1. `from langgraph.graph import END, START, StateGraph`：从 `langgraph` 导入三样东西——`StateGraph`（状态图类）、`START`/`END`（两个**特殊常量**，代表图的「虚拟入口/出口」）。
2. `StateGraph(RunState)`：创建一张空图，并告诉它「本图的状态形状按 `RunState` 来」（此时 `RunState` 里那句 `Annotated[..., _merge_pool]` 才会被读到）。
3. 第一个 `for node in graph["nodes"]`：把契约里的**每个**节点，用 `add_node(id, action)` 注册进图——`id` 是节点 id，`action` 是「该节点被跑到时要执行的异步函数」（由 `_make_node_action` 造出，见 §5.2 末）。
4. `for edge in graph["edges"]`：把契约里**每条**边用 `add_edge(source, target)` 接起来。
5. `next(node for node in graph["nodes"] if node["type"] == "start")`：**生成器表达式**，从所有节点里挑出第一个 `type == "start"` 的（`next(...)` 取它）。它**假定恰有一个 start**——这由图校验保证。
6. `add_edge(START, start_node["id"])`：把虚拟入口接到 start 节点，表示「第一步跑 start」。
7. 第三个 `for`：给**每个** end 节点接一条 `→ END` 的边，表示「跑到它就结束」。
8. `builder.compile()`：把上述声明**编译**成可执行图。编译就是「校验图结构 + 把 reducer、节点、边固化下来」的过程。

> 注意顺序：**先 `add_node` 才能 `add_edge`**（边两端必须是已存在的节点 key），所以「节点循环」必须写在「边循环」之前——这也是下面「写错会怎样」里会讲的一个坑。

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
await compiled.ainvoke({"pool": {"inputs": inputs}})   # a=async 版本；await 等整图跑完；入参是「初始状态」
```

**这段在干什么（按执行顺序）**：

1. `{"pool": {"inputs": inputs}}`：**初始状态**——一个 `dict`，`pool` 键下先放进「本次运行输入」。这正是 `RunState` 声明的形状，也对应 03 篇 §5「变量池初值 = `{"inputs": <运行输入>}`」。
2. `compiled.ainvoke(initial_state)`：**异步**执行整图。LangGraph 会按拓扑序把每个节点 action `await` 一遍；每个 action 返回的**增量**（如 `{"pool": {"n-llm": {...}}}`）会被 `_merge_pool` **合并**进当前状态。
3. `await`：**在这里挂起**，直到整图执行完才返回。它是 `async def` 函数里才允许出现的写法——这就是为什么 `_run_graph` 必须写成 `async def`。

> `ainvoke` 的 `a` 前缀 = async。TS 侧对应的是同步的 `compiled.invoke(...)`；Python 侧因为要 `await`（还要 `await queue.put`）必须用 `ainvoke`。

| API | 作用 |
| --- | --- |
| `compiled.ainvoke(initial_state)` | **异步**执行整图，入参是**初始状态**。这里初始池就是 `{"inputs": <运行输入>}`（见 03 篇 §5） |
| （同步版 `compiled.invoke(...)`） | TS 侧用的是同步 `invoke`；Python 侧因为要 `await` 队列，用**异步** `ainvoke` |

执行时，LangGraph 按拓扑序把节点 action 逐个 `await`（每个节点**执行一次**、仅可达节点），每一步把 action 返回的增量用 **reducer 合并**进状态。

### 5.4 【加厚 · 正面讲透】事件循环 / 协程 / `async def` vs `def`

> 本节写给「只写过 TS/NestJS」的你。**读不懂这一节，后面的 `asyncio.Queue`、`StreamingResponse`、生成器全都看不懂。** 所以这一节**不指路、只讲透**。

**术语先立住**（首次出现，一句话解释，后面反复用）：

| 术语 | 一句话解释 |
| --- | --- |
| **事件循环（event loop）** | 一个**单线程**的调度器：它维护一张「待办协程表」，谁准备好就切去跑谁。Node 里你早就用它，只是从没直接写过它。 |
| **协程（coroutine）** | 一个**可以被暂停、之后再恢复**的函数。Python 用 `async def` 定义、用 `await` 在里面「让出」控制权。它 ≈ TS 的「async 函数返回的 Promise 的执行体」。 |
| **`await`** | 「把控制权交回事件循环，等这件事好了再回来」。**不是「阻塞」**——等的时候事件循环能去跑别的协程。 |
| **阻塞调用** | 一段「霸占线程、期间事件循环什么都做不了」的同步代码（如 `time.sleep()`、同步数据库查询）。 |

**关键差别一句话**：`await asyncio.sleep()` 是「**让出**控制权等」，`time.sleep()` 是「**霸占**整个线程等」。在**同一个事件循环**里，前者不卡别人，后者把**所有人**都卡住。

**可运行最小示例 · 非项目文件**（存成 `demo.py`，在任意目录 `python demo.py` 运行）：

```python
# 最小示例 · 非项目文件：同一个事件循环里，一个协程「阻塞」会拖住另一个协程
import asyncio
import time

async def blocker():
    print("blocker 开始")
    time.sleep(2)              # ❌ 同步阻塞：这 2 秒里整个事件循环被霸占，别人一步都跑不了
    print("blocker 结束")

async def waiter():
    print("waiter 开始")
    await asyncio.sleep(2)     # ✅ 异步等待：这 2 秒里「让出」控制权，事件循环可去跑别的协程
    print("waiter 结束")

async def main():
    await asyncio.gather(blocker(), waiter())   # 同时启动两个协程（≈ TS 的 Promise.all）

asyncio.run(main())            # 启动事件循环，把 main() 跑起来
```

**实际输出（照实）**——注意 `waiter 开始` 迟迟不出现，被 `blocker` 卡住了：

```
blocker 开始
（这里整整卡住 2 秒，什么都打不出来）
blocker 结束
waiter 开始
（再等 2 秒）
waiter 结束
```

**把 `blocker` 里的 `time.sleep(2)` 改成 `await asyncio.sleep(2)` 后**，两个协程会**交错**跑，总耗时从约 4 秒降到约 2 秒：

```
blocker 开始
waiter 开始
（2 秒后）
blocker 结束
waiter 结束
```

**这段在干什么（按执行顺序）**：

1. `asyncio.gather(blocker(), waiter())`：把两个协程**同时**排进事件循环（不按顺序等，先都「启动」）。
2. `blocker` 先跑：打印 `blocker 开始`，然后 `time.sleep(2)` —— **这是普通同步函数**，事件循环在这一刻**无法切换**，只能干等 2 秒。
3. 2 秒后 `blocker 结束`；事件循环这才切去跑 `waiter`（因为 `blocker` 一直没让出机会）。
4. `waiter` 跑：打印 `waiter 开始`，`await asyncio.sleep(2)` —— 这里**让出**控制权，但此时已无别的待办，于是原地等 2 秒，再打印 `waiter 结束`。

**TS 里对应什么**：完全同构。TS 也是**单线程事件循环**；`await somePromise` 让出控制权，而 `while(true){}` 或同步的 `JSON.parse` 大对象会把事件循环卡死。差别只是 **Python 把「同步函数」和「异步函数」分成两种明确类型**（`def` vs `async def`），而 JS 里你可以在任意函数里写 `await`（只要包裹函数是 `async`）——见 §6.3。

**这条差异在本篇的后果**：`_run_graph`、`run_stream`、`_make_node_action` 里的 `action` **全都是 `async def`**——因为它们的身体里要 `await queue.put(...)` / `await queue.get()`。一旦把其中某个写成普通 `def`，里面就**不能再写 `await`**（语法错误，见 §7.6）。

#### 5.4.1 FastAPI 的两条执行路径：`async def` 路由 vs `def` 路由

这是本项目的**真实决策**，也是理解 `run.py` 为什么用 `async def` 的关键。FastAPI（底层 Starlette/anyio）对两种路由**分两路处理**：

| 路由写法 | FastAPI 怎么跑它 | 身体里**应该**写什么 | 身体里**不该**写什么 |
| --- | --- | --- | --- |
| `async def` 路由 | **直接在事件循环上**当协程调用 | 异步 I/O：`await queue.get()` / `await client.astream()` | **同步阻塞**：`time.sleep()`、同步 DB 调用（会卡死整个服务） |
| `def`（同步）路由 | **丢进线程池**（threadpool）里跑 | 同步阻塞调用：本项目同步的 SQLAlchemy `db.commit()` | 需要 `await` 的异步调用（同步函数压根不能 `await`） |

**为什么线程池能「救」同步路由**：同步阻塞代码会霸占**它所在的那个线程**；若它跑在**事件循环线程**上就卡死全服务，但 FastAPI 把它丢进**别的线程**跑，事件循环线程就空着继续服务其他请求。这就是 §5.4 那个 `time.sleep` 例子的「生产级解药」。

**本项目的实际选择**（与 `00-项目初始化/00-Python与FastAPI基础.md` §6.7 一致，此处结合引擎再点一遍）：

- `apps.py` 的 `list_apps`/`create_app` 等用**普通 `def`**：身体是同步 SQLAlchemy（`db.get`/`db.commit`），交给线程池最稳。
- `health.py` 用 `async def`：身体里没有 I/O，两种都行。
- `run.py` 的 `run_app` 用 **`async def`**：它要返回 `StreamingResponse(run_stream(...))`，而 `run_stream` 是异步生成器——这条链路全程在事件循环上以协程方式跑。

**一句话记住**：`await` 只能写在 `async def` 里；`def` 里的同步阻塞由 FastAPI 用线程池兜住；而**在 `async def` 里写同步阻塞，就是把全服务（含正流式输出的 SSE）一起卡住**（§7.6 给出具体症状）。

### 5.5 【加厚 · 正面讲透】生成器的暂停 / 恢复（`yield`）

**这是「流式」的语言底座**，也是 TS 学习者最陌生的一点。它和 `async` 是**两个独立**机制：`yield` 管「产出多个值」，`async` 管「等待」。

**是什么**：一个函数里只要出现 `yield`，它就不再是普通函数，而是一个**生成器函数（generator function）**——调用它**不会执行函数体**，而是返回一个**生成器对象**；每次迭代（`next()` / `for`）才**从上一次的 `yield` 处继续**往下跑。

**TS 里对应什么**：`function*` 生成器，以及 `for (const x of gen())` 的 `IterableIterator`。语义**一模一样**：`yield` 把值交出去、并把函数**暂停**在原地，下次迭代再**从暂停处恢复**。区别是 Python 里它极其常用（本项目四处都是 `yield`）。

**可运行最小示例 · 非项目文件**（`python demo_gen.py`）：

```python
# 最小示例 · 非项目文件：yield 的「暂停 / 恢复」——注意打印顺序
def counter(n):
    print("  进入 counter，准备开始")
    for i in range(n):
        print(f"  即将 yield {i}")
        yield i                        # ← 暂停点：把 i 交给调用方，函数停这里
        print(f"  从 yield {i} 处恢复")   # ← 下次迭代时，从上一行 yield 之后继续
    print("  counter 结束")

print("① 调用 counter(2)——注意：函数体【没有】执行")
g = counter(2)                         # 只创建生成器对象；一条 print 都还没打

print("② next(g) 第一次——进入函数，跑到第一个 yield 停下")
print("   收到：", next(g))            # 打印「进入…」「即将 yield 0」，然后停在 yield 0

print("③ next(g) 第二次——从上次 yield 之后恢复，跑到第二个 yield 停下")
print("   收到：", next(g))            # 打印「从 yield 0 处恢复」「即将 yield 1」，停在 yield 1

print("④ next(g) 第三次——恢复后 for 结束，函数正常收尾")
try:
    next(g)                            # 打印「从 yield 1 处恢复」「counter 结束」，然后抛 StopIteration
except StopIteration:
    print("   生成器耗尽（StopIteration）")
```

**实际输出（照实）**：

```
① 调用 counter(2)——注意：函数体【没有】执行
② next(g) 第一次——进入函数，跑到第一个 yield 停下
  进入 counter，准备开始
  即将 yield 0
   收到： 0
③ next(g) 第二次——从上次 yield 之后恢复，跑到第二个 yield 停下
  从 yield 0 处恢复
  即将 yield 1
   收到： 1
④ next(g) 第三次——恢复后 for 结束，函数正常收尾
  从 yield 1 处恢复
  counter 结束
   生成器耗尽（StopIteration）
```

**这段在干什么（按执行顺序）**：

1. `g = counter(2)`：**只创建对象，不执行函数体**（看输出——① 之后没打印任何 `counter` 内部的东西）。这一点是理解流式的关键：**「调用生成器函数」≠「开始干活」**。
2. 第一次 `next(g)`：事件循环/迭代器驱动函数**从开头**跑，一直到 `yield 0` 交出值并**暂停**。
3. 第二次 `next(g)`：函数**从 `yield 0` 的下一行恢复**（打印「从 yield 0 处恢复」），继续跑到 `yield 1` 暂停。
4. 第三次 `next(g)`：恢复后 `for` 循环已结束，函数跑到末尾，抛 **`StopIteration`** 表示「没有更多值了」。
5. `for` 循环会自动帮我们做「反复 `next`，遇到 `StopIteration` 就停」——所以你平时写 `for x in gen:` 看不到这些细节。

> **「暂停 / 恢复」的意义**：函数可以「跑一半、交出去、**以后接着跑**」，而且**局部变量（如 `i`）被冻结保留**。这正是「逐帧产出 SSE」的语言能力：`run_stream` 每 `yield` 一帧就停住，`StreamingResponse` 下一轮迭代再让它恢复、产出下一帧（§7.4）。

**异步生成器（`async def` + `yield`）**：本项目 `run_stream` 是**异步生成器**——它既有 `yield`（产出多帧）又有 `await`（等队列）。消费它要用 `async for`（或 `StreamingResponse`），不能只用普通 `for`。`AsyncGenerator[str, None]` 这个注解的意思就是「异步生成器，产出 `str`，不接收值」。

**生成器函数的「提前返回」**：普通 `return`（或函数体跑完）会让生成器**耗尽**、抛 `StopIteration`，`for` / `async for` 就此结束。本项目就是靠「队列取到哨兵 `None` → `break` → 生成器函数体跑完」来结束流（§7.4）。**若忘了让它结束**，`StreamingResponse` 会一直挂着等下一帧——见 §7.6。

### 5.6 【加厚 · 正面讲透】`Annotated` / `TypedDict` / reducer 与 TS `Annotation` 逐一对照

§6 给了 API 对照表，这里只把**机制差异**讲透：**同一件事（给状态某个键挂 reducer），TS 把它做成「运行期对象」，Python 把它做成「类型注解上的元数据」。**

| 关注点 | TS：`Annotation.Root({...})` | Python：`TypedDict` + `Annotated[...]` |
| --- | --- | --- |
| 状态定义载体 | 一个**运行期真实对象**（`Annotation.Root(...)` 返回对象） | 一个**类型声明**（`class RunState(TypedDict)`），运行期只是 `dict` |
| reducer 挂在哪 | 挂在 `Annotation({ reducer })` 的**配置项**里 | 挂在 `Annotated[T, reducer]` 的**第二个参数**里（类型元数据） |
| 初始值 default | 注解里带 `default: () => ({})` | **不带** default，改在 `ainvoke({ ... })` 传初始状态 |
| LangGraph 何时读它 | 建图/运行时读这个对象 | **编译图时**读类型注解里的 `Annotated` 元数据 |
| TS 侧写法 | `Annotation<Pool>({ reducer: mergePool, default: () => ({}) })` | — |
| Python 侧写法 | — | `pool: Annotated[dict[str, Any], _merge_pool]` |

**为什么会有这种差异（讲透）**：

- JS **没有类型系统**（TS 的类型编译后被擦除），所以想「描述状态 + 附 reducer」只能造一个**运行期对象** `Annotation` 来承载。
- Python **有 `typing`、且注解运行期保留**（见 `00-项目初始化/00-Python与FastAPI基础.md` §4.3），于是可以直接把 reducer **当成「挂在类型上的元数据」**——`Annotated[dict, _merge_pool]` 读起来就像「一个带合并规则的 dict 类型」。
- **default 的位置也跟着变**：TS 把默认值塞进 `Annotation` 配置；Python 没有「注解里塞值」的天然位，就干脆在 `ainvoke` 时**显式给定初始状态**——这也更直白。

> **一句话**：LangGraph 的抽象（State / Node / Edge / START / END / compile / invoke）**两端完全一致**；差异只在「**用什么载体把 reducer 挂上去**」——TS 用运行期对象、Python 用类型注解元数据。理解了这个，读 TS 引擎和读 Python 引擎就是**同一张图**。

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

### 6.1 【加厚】语言机制对照：Python 协程 / 生成器 vs TS Promise / async iterator

上一张表是**框架 API** 的对照；这一张是**语言机制**的对照——它才是「TS 学习者看 Python 引擎卡住」的真正原因。

| 语言机制 | TypeScript | Python（本项目） | 关键差异 |
| --- | --- | --- | --- |
| 声明异步函数 | `async function f()` | `async def f():` | **同样是「一种函数种类」**，但 Python 里 `def` 与 `async def` 的界线更硬：`await` 只能出现在 `async def` 里 |
| 等待一个异步结果 | `await promise` | `await coro` | 语义同：都「让出控制权、等结果」。Python 等的是**协程对象**，TS 等的是 **Promise** |
| 异步对象何时开始执行 | **Promise 是急切的（eager）**：一创建就已在跑 | **协程是懒惰的（lazy）**：`async def` 只是「造出一个协程对象」，**不 `await`/不调度就永不执行** | ⭐ 这条最容易踩：Python 里漏写 `await`，你拿到的是一个**没跑过的协程对象**，而不是「一个正在跑的 Promise」 |
| 漏写 await 的后果 | 得到一个 Promise（可能 UnhandledPromiseRejection 警告） | 得到一个 **coroutine 对象**，函数体从未执行；解释器警告 `RuntimeWarning: coroutine '…' was never awaited` | 见 §7.6 |
| 产出多个值（流） | `function*`（同步生成器） | `def f(): yield …`（生成器） | 语义同：`yield` 暂停、下次迭代恢复（见 §5.5） |
| 异步产出多个值 | `AsyncGenerator`（`async function*`） | `async def f(): ... yield ...`（**异步生成器**） | 语义同；本项目 `run_stream` 就是它 |
| 消费异步流 | `for await (const x of it)` | `async for x in it:` | ⭐ 写法差一截：Python 是 `async for`，不是 `for` |
| 等待「多个并发」 | `await Promise.all([...])` | `await asyncio.gather(...)` | 语义同 |

**为什么「急切 vs 懒惰」这条最要命**：TS 的 `fetch(url)` 一调用**就把请求发出去了**，即使你忘了 `await`，副作用也发生了（只是拿不到结果）。而 Python 的 `coro = do_io()` 若忘了 `await`，**请求根本没发**——你只是造了个「待执行的协程」放在那儿。本项目里 `await queue.put(...)` 若漏写 `await`，**事件根本不会入队**，流会卡住（§7.6 给了症状）。

> 顺带记住：`asyncio.create_task(coro)` 的作用就是「把协程排进事件循环、让它**开始**跑」（≈ TS 里「不 `await`、但也不丢弃，而是后台跑」）。这就是 §7.2 里让 `_run_graph` 后台执行的关键。

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

**这段在干什么（按执行顺序）**：

1. `queue = asyncio.Queue()`：建一个**协程安全**的空队列（`asyncio.Queue` 是异步版的「生产者-消费者」队列，见 §7.4）。
2. `run_id = str(uuid.uuid4())`：生成本次运行的唯一 id（会放进 `run_started` / `run_finished` / `run_failed`）。
3. `await queue.put(run_started(run_id, app_id))`：**先把第一帧塞进队列**，保证「流一开始就有一帧」，且顺序固定。
4. `task = asyncio.create_task(_run_graph(...))`：把「执行整图」这个协程**排进事件循环后台跑**（拿到一个 `Task` 句柄）。**不 `await` 它**——否则就退化成「跑完整图才产出」的非流式。
5. `while True:` 循环里 `event = await queue.get()`：从队列取事件。**队列空时 `get()` 会「挂起等待」，把控制权让给事件循环**（此时后台 `_run_graph` 得以继续往队列 `put`）。
6. `if event is None: break`：取到**哨兵 `None`** 就跳出循环（哨兵含义见 §7.4）。
7. `yield format_sse_frame(event)`：把事件序列化成 SSE 帧字符串并**产出**——生成器在此**暂停**，等被再次迭代时恢复。
8. `await task`：循环结束后，等后台任务真正结束（确保异常已在 `_run_graph` 内部归一，不留「游离任务」）。
9. 生成器函数体跑完 → 抛 `StopIteration` → 消费方（`StreamingResponse`）判定「流结束」。**整个过程就是 §5.5 讲的「暂停/恢复」在异步场景下的样子。**

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

### 7.4 【加厚 · 正面讲透】`asyncio.Queue` + 异步生成器 + `None` 哨兵

**术语先立住**：

| 术语 | 一句话解释 |
| --- | --- |
| `asyncio.Queue` | 异步版的「先进先出队列」。生产者 `await put(x)` 入队，消费者 `await get()` 出队；**队列为空时 `get()` 会挂起等待，而不是报错或忙等**。 |
| **生产者 / 消费者** | 两个协程：一个往队列**放**数据，一个从队列**取**数据。它俩通过队列「解耦」——各跑各的、互不阻塞。 |
| **哨兵（sentinel）** | 一个**约定值**，用来表示「没有更多数据了、可以收工」。这里约定为 `None`。 |

**为什么需要队列**：执行图（生产事件）与往 HTTP 写字节（消费事件）是**两件可以同时发生的事**。若让路由「`await` 执行器跑完再发」，就**没有流式**（前端卡一下、再一次性全出来）。队列让「产」与「发」**并行**：后台跑一步产一帧，前台立刻取走发一帧。

**为什么用 `None` 当哨兵（讲透）**：`asyncio.Queue` **没有**「关闭」概念——`await get()` 在队列空时只会**无限等下去**，不会「因为没数据就返回」。所以「结束」这件事**必须由生产者显式告知**：生产者放完最后一条，再 `put(None)`；消费者一见 `None` 就 `break`。选 `None` 是因为**本项目的事件永远是 `dict`**（绝不可能是 `None`），所以拿它当「终止标记」不会与真实数据冲突。

**可运行最小示例 · 非项目文件**（`python demo_queue.py`，这就是本项目事件桥接的缩影）：

```python
# 最小示例 · 非项目文件：生产者 → 队列 → 消费者；用 None 当「结束哨兵」
import asyncio

async def producer(q):
    for i in range(3):
        await asyncio.sleep(0.1)          # 模拟「跑一步、花点时间」（异步等待，让消费者能插进来）
        await q.put(f"事件{i}")           # 生产：入队（此处若漏写 await 就永不入队，见 §7.6）
    await q.put(None)                     # 结束：投一个哨兵 None

async def consumer(q):
    while True:
        item = await q.get()              # 消费：出队（队列空则挂起等待生产者）
        if item is None:                  # 收到哨兵 → 结束循环
            break
        print("收到：", item)

async def main():
    q = asyncio.Queue()                   # 建队列
    await asyncio.gather(producer(q), consumer(q))   # 两个协程同时跑

asyncio.run(main())
```

**实际输出（照实）**：

```
收到： 事件0
收到： 事件1
收到： 事件2
```

**这段在干什么（按执行顺序——务必看清「谁在什么时候让出」）**：

1. `asyncio.gather(producer(q), consumer(q))`：把两个协程**同时**排进事件循环。
2. `consumer` 先跑：`await q.get()` 时队列为空 → **挂起等待**（把控制权让出）。
3. 事件循环切到 `producer`：`await asyncio.sleep(0.1)`（让出）→ 醒来后 `await q.put("事件0")`（入队）→ `put` 会**唤醒**正等着的 `consumer`。
4. `consumer` 恢复：拿到 `"事件0"`，打印；再 `await q.get()`（又空 → 又挂起）。
5. 如此往复 3 次。
6. `producer` 放完 3 条后 `await q.put(None)`；`consumer` 下次 `get()` 拿到 `None` → `break` → `consumer` 函数体结束。
7. 两个协程都结束，`main` 返回。

**TS 里对应什么**：

| 环节 | TS（`RunEventQueue` / `ReadableStream` / async iterator） | Python（`asyncio.Queue`） |
| --- | --- | --- |
| 入队 | `queue.emit(event)`（同步，单线程事件循环下入队即完成） | `await queue.put(event)`（异步） |
| 出队 | `queue.drain()` 异步生成器，逐条 `yield` | `while True: await queue.get()` |
| **结束信号** | `queue.close()` —— 之后 `drain()` 循环**自然结束** | 队列**没有 close**，靠 `put(None)` **哨兵**，消费者 `break` |
| 消费 | `for await (const e of events)` | `async for`（或在 `while True` 里 `get`） |
| 底层抽象 | `ReadableStream` 的 `controller.enqueue(x)` / `controller.close()`，`reader.read()` 返回 `{value, done}` | 队列 + 哨兵；「done」由哨兵表达 |

> **为什么 TS 用 `close()`、Python 用哨兵**：`ReadableStream` 自带「关闭」状态，`reader.read()` 会返回 `{done:true}`；`asyncio.Queue` 没有这套，所以用**哨兵值**表达「流结束」——这是 Python 异步里最常见、也最容易两端对齐的收束写法。

### 7.5 【加厚 · 正面讲透】`StreamingResponse` 消费异步生成器的**分步过程**

「`StreamingResponse(run_stream(...))` 到底对生成器做了什么？」——**分步**看（对照 TS 侧手写的 `res.write`）：

| 步 | Python（Starlette `StreamingResponse`） | TS（`RunController` 手写） |
| --- | --- | --- |
| ① 建响应对象 | `return StreamingResponse(run_stream(...), media_type=..., headers=...)`。**此刻生成器对象刚被创建，函数体尚未执行**（§5.5：生成器是懒惰的） | `const events = await engineService.run(...)` 拿到异步生成器；此时同理未开始产 |
| ② 发响应头 | Starlette 在**开始发 body 之前** 通过 ASGI `http.response.start` 送出状态行 + 头（200 + `text/event-stream` + `cache-control`）。**状态码只此一次** | `setHeader(...)` × 3 然后 **`flushHeaders()`** |
| ③ 迭代生成器 | Starlette 对 body 做**异步迭代**（`async for`）：每轮驱动生成器**从上次暂停处恢复** | `for await (const event of events)` |
| ④ 生成器产出 | 生成器恢复后 `await queue.get()` 取事件 → `yield format_sse_frame(event)` 交出一帧**字符串**并再次暂停 | 循环体里 `formatSseFrame(event)` |
| ⑤ 写 chunk | Starlette 把这帧字符串通过 ASGI `http.response.body` **作为一块 chunk 写出去** | `response.write(formatSseFrame(event))` |
| ⑥ 循环 | 重复 ③~⑤，**边产边写**——这就是「流式」 | 同 |
| ⑦ 收尾 | 生成器耗尽（抛 `StopAsyncIteration`）→ Starlette 发**最后一块空 body** → 响应结束 | `response.end()` |

**关键理解**：

- **`StreamingResponse` 是「通用适配器」**：你把**任何**（异步）可迭代对象交给它，它负责「迭代 → 逐块写 → 结束」这套样板。**你不必自己碰 ASGI 的 `send`**——这就是「Py 侧不用手写 `write`」的原因。
- **「迭代生成器」与「暂停/恢复」的对应**：§5.5 里 `next(g)` 让函数从 `yield` 处恢复；这里 `async for` 做的就是同一件事，只不过生成器里还夹着 `await queue.get()`（等生产者）。
- **响应头先于 body**：② 先发头，③ 才迭代 body。所以「预检失败要 400 JSON」必须发生在**返回 `StreamingResponse` 之前**（此时还没发任何头）——见文件 `05-SSE流式响应实现.md` §5.6。
- **TS 侧为什么能（也必须）手写 `write`**：NestJS 把裸 `Response` 交给你，没有「自动迭代」的适配器，所以得自己 `for await + write`；而 FastAPI 用 `StreamingResponse` 把这一步内化了。**两者本质一样：一次响应、多次写、最后结束**。

> 注意 `return StreamingResponse(...)` 这个 `return` 是 `async def run_app(...)` 的**同步返回**（构造响应对象不耗时）；真正「开始迭代生成器、往外写」发生在**框架把响应发出去的时候**，不在 `run_app` 体内。

### 7.6 【加厚】写错会怎样（本篇机制相关的 5 个典型错误）

| 错误 | 症状 | 原因 / 正解 |
| --- | --- | --- |
| **在同步函数里 `await`** | 程序**根本起不来**，`SyntaxError: 'await' outside async function` | `await` 只能出现在 `async def` 里；要 `await` 就得把 `def` 改成 `async def`。**这是语法错误，不是运行时错误**，IDE/解释器在编译阶段就报。 |
| **忘记 `await`** | 流**卡住不吐字**（或函数像没执行）；日志里 `RuntimeWarning: coroutine '…' was never awaited` | Python 的协程是**懒惰**的（§6.1）：`queue.put(x)` 只造了个协程对象、**没入队**。必须 `await queue.put(x)`。TS 里漏 `await` 至少请求已发出，Python 里**什么都没发生**。 |
| **在事件循环里写同步阻塞** | **整条 SSE 长时间不吐字**，期间**所有**请求一起卡（不是只有你这一条） | 在 `async def` 路由（或 `async def` 的 `action`）里调用了 `time.sleep()` / 同步 DB 等**阻塞**代码。改用 `async def` + `asyncio.sleep()` / 异步库，或把阻塞逻辑挪进**同步 `def`** 路由（FastAPI 丢线程池，§5.4.1）。 |
| **生成器提前 `return` / 忘了发哨兵** | 客户端**一直挂起**、流**永不结束**（`curl` 不返回；前端等不到收束） | 消费方 `await queue.get()` 永远在等。收束必须是「生产者 `finally: await queue.put(None)` → 消费方见 `None` 就 `break` → 生成器跑完」。**`put(None)` 一定要放在 `finally`**，保证成功/失败都发。 |
| **队列未关就异常退出** | 任务泄漏 / 客户端挂起 | 把 `await queue.put(None)` 放进 `finally`；`except` 里先把错误归一成 `run_failed` 事件再退出（见 §9 的 `_run_graph`）。 |

> 「`except` 顺序写反」（`except Exception` 写在前面会把后面更具体的 `except` 全挡掉）属于异常机制，**讲透见 `05-LLM节点/03-LLM错误映射.md`**。

**把常见错误写成对照（TS 习惯 → Python 后果）**：

```python
async def bad_missing_await(q):
    q.put("x")            # ❌ 漏了 await：只造了个协程对象，根本没入队（RuntimeWarning）
    await q.put("x")      # ✅

def bad_await_in_sync():  # ❌ 语法错误：普通 def 里不能 await
    await something()
async def good():
    await something()     # ✅

async def bad_blocking():
    time.sleep(1)         # ❌ 阻塞事件循环：这 1 秒全服务卡住
async def good_waiting():
    await asyncio.sleep(1)  # ✅ 让出控制权
```

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

### 9.1 【加厚】逐段精读：`_run_graph` / `action` / `_execute_node`（带行内注释）

上面是**整文件**；这三个函数是引擎的「心脏」。下面把它们的**关键行**逐行注释，并按执行顺序讲。

**`_run_graph`：后台执行整图、把结果/错误变成事件**（`# ←` 为讲解注释，代码与源码逐字一致）：

```python
async def _run_graph(graph, inputs, queue, run_id) -> None:
    started_at = time.time()                        # ← 记开始时间，用于 run_finished 的 elapsedMs
    context: dict[str, Any] = {"failed_node_id": None, "last_outputs": {}}
    # ↑ 本次运行的「共享回写区」：失败节点 id、最后 end 节点的 outputs，都写在这里
    try:
        builder = StateGraph(RunState)              # ← ① 建图
        for node in graph["nodes"]:                 # ← 每个契约节点 → 一个图节点
            builder.add_node(node["id"], _make_node_action(node, queue, context))
        for edge in graph["edges"]:                 # ← 每条契约边 → 一条图边
            builder.add_edge(edge["source"], edge["target"])
        start_node = next(node for node in graph["nodes"] if node["type"] == "start")
        builder.add_edge(START, start_node["id"])   # ← 虚拟入口 → start 节点
        for node in graph["nodes"]:
            if node["type"] == "end":
                builder.add_edge(node["id"], END)   # ← 每个 end 节点 → 虚拟出口
        compiled = builder.compile()                # ← ② 编译成可执行图
        await compiled.ainvoke({"pool": {"inputs": inputs}})   # ← ③ 执行整图（await 在此挂起等它跑完）
        elapsed_ms = int((time.time() - started_at) * 1000)
        await queue.put(run_finished(run_id, context["last_outputs"], elapsed_ms))  # ← ④ 成功：发 run_finished
    except Exception as error:                      # ← ⑤ 任何执行期错误都到这里（含节点里抛出的 RunError）
        await queue.put(run_failed(run_id, context["failed_node_id"], str(error)))  # ← 归一为 run_failed
    finally:
        await queue.put(None)                       # ← ⑥ 无论成功失败，都发哨兵 None 收束流
```

**这段在干什么（按执行顺序）**：

1. 记 `started_at`、初始化 `context`（一个普通 `dict`，作为「共享回写区」——`action` 与顶层都能读写它）。
2. `try` 块里：建图（`StateGraph` + `add_node` + `add_edge` + 入口/出口）→ `compile()` → `await ainvoke(...)` 执行整图。
3. **成功**：算出 `elapsed_ms`，`await queue.put(run_finished(...))`，`outputs` 取 `context["last_outputs"]`（由 end 节点在 `action` 里写入）。
4. **失败**：`except Exception as error` 捕获，`await queue.put(run_failed(run_id, context["failed_node_id"], str(error)))`——`str(error)` 对 `RunError` 就是它的 message，于是得到契约要求的文案。
5. **无论成败**：`finally` 里 `await queue.put(None)` 发哨兵，让消费者 `break`、流结束（§7.4）。

> `except Exception` 里**不 `raise`**：因为错误已经「转成事件」交给消费者了，后台协程不该再抛（否则 `await task` 会炸）。这正是「错误走事件、不走异常」的落地。

**`_make_node_action`：把「一个节点」包成一个能发事件的 `async` 动作**：

```python
def _make_node_action(node, queue, context):
    """生成某节点的执行动作（LangGraph node）：发开始/结束事件，失败时记录出错节点。"""
    async def action(state: RunState) -> dict[str, Any]:      # ← 内层闭包：真正被 LangGraph 调用的函数
        await queue.put(node_started(node["id"], node["type"]))   # ← 先发「节点开始」
        try:
            output = await _execute_node(node, state["pool"], queue)  # ← 真干活：读池、算输出
            await queue.put(node_finished(node["id"], node["type"], output))  # ← 成功才发「节点结束」
            if node["type"] == "end":
                context["last_outputs"] = output["outputs"]       # ← end 的输出回写，供 run_finished 用
            return {"pool": {node["id"]: output}}                 # ← 只返回【增量】，合并交给 _merge_pool
        except Exception:
            context["failed_node_id"] = node["id"]                # ← 记下出错节点，run_failed.nodeId 要用
            raise                                                 # ← 继续上抛，由 _run_graph 顶层捕获
    return action
```

**这段在干什么（按执行顺序）**：

1. `def _make_node_action(...)` 是**普通函数**，它**返回**一个内层 `async def action`。这种「返回函数的函数」叫**闭包（closure）**——`action` 记住了外面的 `node` / `queue` / `context`，所以 LangGraph 只需调 `action(state)`，事件就会自动进对的那个队列。
2. LangGraph 跑到该节点时调 `action(state)`：先 `await queue.put(node_started(...))`。
3. `await _execute_node(...)`：**真干活**，返回该节点输出（如 `{"text": ...}`）。它内部若出错会**抛异常**。
4. 成功：`await queue.put(node_finished(...))`（**只有成功才发**，见错误篇），end 节点再回写 `last_outputs`。
5. `return {"pool": {node["id"]: output}}`：只返回**自己这一个键的增量**，由 `_merge_pool` 并进整池（§5.1、§6 的坑表）。
6. 失败：`context["failed_node_id"] = node["id"]` 后 **`raise`** 把异常继续往上抛——顶层 `_run_graph` 的 `except` 接住并转成 `run_failed`。

**`_execute_node`：按节点类型分派（含 llm 的 `emit` 闭包）**：

```python
async def _execute_node(node, pool, queue):
    """按节点类型分派执行（`llm` 节点在执行中穿插 `token` 事件）。"""
    if node["type"] == "start":
        return run_start_node(node, pool)                  # ← start：同步纯函数，直接调用（无需 await）
    if node["type"] == "llm":
        async def emit(text):                              # ← 异步闭包：把一片 token 塞进队列
            await queue.put(token(node["id"], text))
        return await run_llm_node(node, pool, emit)        # ← llm：执行中会多次 await emit(...)（真流式）
    return run_end_node(node, pool)                        # ← end：同步纯函数，直接调用
```

**这段在干什么（按执行顺序）**：

1. `start` 与 `end` 节点是**同步纯函数**（`run_start_node` / `run_end_node`）——它们不联网、不 `await`，所以在 `async def _execute_node` 里**直接 `return run_xxx_node(...)`**（注意**没有** `await`，因为返回的不是协程）。
2. `llm` 节点不同：它要真流式，于是先造一个 `emit` **异步闭包**（往队列发 `token`），再 `await run_llm_node(node, pool, emit)`。
3. `run_llm_node` 内部每收到一个 chunk 就 `await emit(piece)` → 事件进队列 → 消费者立刻发一帧（见 `05-LLM节点/02-真实模型调用与流式.md`）。

> **易错点**：`return run_start_node(...)` **不能写成 `await run_start_node(...)`**——它不是协程，`await` 一个非协程会报 `TypeError`。而 `run_llm_node(...)` **必须** `await`（它是 `async def`）。「哪个要 `await`」取决于**被调函数是不是 `async def`**。

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

### 10.1 【加厚】逐段精读：`format_sse_frame` 与 `RunError`

**`format_sse_frame`：把「事件对象」变成「一帧 SSE 文本」**：

```python
def format_sse_frame(event: dict[str, Any]) -> str:
    """帧格式（固定）：`event: <name>\\n` + `data: <单行 JSON>\\n\\n`。"""
    payload = json.dumps(event["data"], ensure_ascii=False, separators=(",", ":"))
    # ↑ 把 data 序列化成【紧凑、单行、不转义非 ASCII】的 JSON
    return f"event: {event['event']}\ndata: {payload}\n\n"
    # ↑ f-string 拼帧：`event: 名字` + 换行 + `data: JSON` + 两个换行（空行结尾）
```

**这段在干什么（按执行顺序）**：

1. `json.dumps(event["data"], ensure_ascii=False, separators=(",", ":"))`：把 `data` 这个 `dict` 转成 JSON **字符串**。
   - `ensure_ascii=False`：中文**不**被转义成 `\uXXXX`（否则与 TS 的 `JSON.stringify` 字节不同）。
   - `separators=(",", ":")`：去掉默认的 `, ` / `: ` 空格，得到**紧凑单行**（对齐 JS 的紧凑输出）。
2. `f"event: {event['event']}\ndata: {payload}\n\n"`：用 **f-string** 拼出固定帧格式——`event:` 行、`data:` 行，**以空行（`\n\n`）结束**。`\n` 是换行符（与 TS 一样）。注意 f-string 内部用单引号 `event['event']`（外层双引号，避免冲突）。

> `json.dumps` 会把字符串里的换行**转义**成 `\n`，所以 `data:` **永远是一行**——这是「帧不被截断」的保证。TS 的 `JSON.stringify` 同样不含裸换行。

**`RunError`：整条链路的「错误载体」**：

```python
class RunError(Exception):
    """运行期错误：其 message 经 run_failed 事件传出（见 error-messages.md §4.2）。"""
```

**这段在干什么**：

1. `class RunError(Exception)`：定义一个**自定义异常类**，继承自内置的 `Exception`（≈ TS 的 `class RunError extends Error`）。
2. 它**没有重写任何方法**——所以 `str(err)` 得到的就是构造时传的那个字符串（`RunError("missing required input: topic")` → `"missing required input: topic"`）。
3. 于是「节点抛 `RunError(msg)` → `_run_graph` 的 `except` 里 `str(error)` → `run_failed.message`」这条链路**全程文案不变**。这就是为什么 `run_failed.message` 能逐字节可控。异常体系的完整讲法（继承、捕获顺序）见 `05-LLM节点/03-LLM错误映射.md`。

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
| **事件循环 / 协程 / `async def` vs `def`** | 「`time.sleep()` 阻塞整个事件循环、`await asyncio.sleep()` 不会」；FastAPI 把同步 `def` 路由丢线程池、`async def` 路由跑在事件循环上两条路径的差别（§5.4） | **首次教学于本篇（加厚）** |
| **生成器的暂停 / 恢复（`yield`）** | 调用生成器函数不执行、`next()` 才从 `yield` 处恢复；配最小可运行示例（§5.5） | **首次教学于本篇（加厚）** |
| **`asyncio.Queue` + 异步生成器 + `None` 哨兵** | 生产者/消费者协作、空队列 `get` 挂起、为何用 `None` 收束；对照 TS `ReadableStream`/async iterator 的 `close()`（§7.4） | **首次教学于本篇（加厚）** |
| **`StreamingResponse` 消费异步生成器的分步过程** | 生成器产出 → Starlette 迭代 → ASGI `http.response.body` 写 chunk → `StopAsyncIteration` 收尾；对照 TS 手写 `res.write`（§7.5） | **首次教学于本篇（加厚）** |
| **`Annotated` / `TypedDict` / reducer 与 TS `Annotation` 的机制对照** | TS 用运行期对象挂 reducer、Python 用类型注解元数据挂 reducer（§5.6） | **首次教学于本篇（加厚）** |
| **「写错会怎样」：同步里 `await` / 忘 `await` / 阻塞事件循环 / 生成器不结束** | 五种典型误写的症状与正解（§7.6） | **首次教学于本篇（加厚）** |

> 已在前序篇教学、本篇仅引用不重讲的：变量池 / 模板解析 / 节点运行时（含 `llm` 桩分片、非字符串值渲染口径）见 `04-执行引擎/03-节点运行时与变量池.md`；SSE 帧格式与事件协议（含 6 种事件与固定顺序）见 `04-执行引擎/01-运行契约与SSE事件协议.md`（唯一真源为 `packages/contract/sse-events.md`）；服务端「不结束响应地持续写」见 `04-执行引擎/05-SSE流式响应实现.md`；引擎文案唯一真源为 `packages/contract/error-messages.md` §4；`uv` / `pyproject.toml` / `uv.lock` 见 `00-项目初始化/01-环境准备.md`；Python 类型注解 / Pydantic 见 `00-项目初始化/06-FastAPI起步.md`；`StreamingResponse` / FastAPI 路由见 `00-项目初始化/06-FastAPI起步.md`。
