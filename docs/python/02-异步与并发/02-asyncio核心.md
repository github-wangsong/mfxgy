# 02 · asyncio 核心

> 所属：阶段 2 · 异步与并发
> 本篇覆盖：`async def` 协程函数与协程对象、`await` 的语义、事件循环（`asyncio.run`）与就绪队列、协程 = 可暂停函数的心智模型、`await` 串行 vs `create_task`/`gather` 并发、`as_completed`、`TaskGroup` 与 `ExceptionGroup`、超时（`wait_for`/`asyncio.timeout`）、取消（`CancelledError`/`shield`）、`sleep(0)` 让出、常见反模式
> **本篇首次教学：协程函数与协程对象的区别（调用不执行）、`await` 只能在 `async def` 内、事件循环调度模型与「让出点」、`create_task` 与 `await` 的并发差异、`asyncio.gather`（含 `return_exceptions=True`）、`asyncio.as_completed`、`TaskGroup` 结构化并发与 `ExceptionGroup`、`wait_for`/`asyncio.timeout` 超时、取消语义与 `shield`、`await asyncio.sleep(0)` 主动让出、未加 `await` 的 `RuntimeWarning`**（异步生成器与 SSE 见 `08-流式与外部调用/01`；异步上下文管理器见 `01-Python进阶/04` §7）
> 预告：下一篇讲异步实战模式（并发限流、重试、超时组合、异步缓存、连接池）。

> 项目锚点：`apps/api-py/app/errors.py`（`async def` 异常处理器——由事件循环直接 `await` 调用）、`apps/api-py/app/api/*.py`（全部 `async def` 路由）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 说清「调用协程函数」与「执行协程」的区别。
2. 解释 `await` 到底做了什么（让出控制权给事件循环）。
3. 用 `gather`/`TaskGroup` 把串行改成真正并发，并正确处理异常与超时。
4. 用 `CancelledError` 与 `shield` 写出可取消、可清理的任务。
5. 识别「假并发」代码并改对。

**验收标准**

- 能预测「3 个 `asyncio.sleep(1)`」在串行与 `gather` 下的总耗时。
- 能写出「并发 10 个请求，任意一个失败不影响其他，最后统一汇总」的代码。
- 能解释 `wait_for` 超时后底层任务是否被取消。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [01 GIL 与并发模型选择](./01-GIL与并发模型选择.md)、[01-Python进阶/02 迭代器与生成器](../01-Python进阶/02-迭代器与生成器.md)（`yield` 暂停模型） |
| 已掌握 | 生成器、`try/except/finally`、装饰器 |

---

## 3. 协程函数与协程对象

### 3.1 第一个异步函数

```python
import asyncio


async def fetch(name: str) -> str:
    print(f"{name} 开始")
    await asyncio.sleep(1)          # 模拟 IO 等待
    print(f"{name} 结束")
    return f"{name} 的结果"


coro = fetch("A")                       # ① 调用不执行！只创建协程对象
print(type(coro))                       # <class 'coroutine'>

asyncio.run(coro)                       # ② 交给事件循环执行
```

输出：

```
A 开始
（1 秒后）
A 结束
```

| 事实 | 说明 |
| --- | --- |
| `async def` 定义的是**协程函数** | 调用它返回**协程对象**，函数体不执行 |
| 协程对象必须被驱动 | 用 `await`、`asyncio.run`、`create_task` 之一 |
| 未被驱动的协程会告警 | `RuntimeWarning: coroutine 'fetch' was never awaited` |

这与 [01-Python进阶/02](../01-Python进阶/02-迭代器与生成器.md) 的生成器完全同构：

```python
def gen():      yield 1          # 调用不执行，需 next() 驱动
async def coro(): ...            # 调用不执行，需 await 驱动
```

> **协程本质上是「支持 `await` 的生成器」**。框架自动驱动它，所以业务代码里你看到的就是普通函数调用。

### 3.2 `await` 的两条规则

```python
async def outer():
    result = await fetch("A")        # ✅ await 只能在 async def 里
    return result


def sync_fn():
    await fetch("A")                 # ❌ SyntaxError: 'await' outside async function
```

| 规则 | 说明 |
| --- | --- |
| `await` 只能在 `async def` 内 | 语法层面限制 |
| `await` 右侧必须是**可等待对象** | 协程、`Task`、`Future` |

### 3.3 `await` 到底做了什么

```
当前协程执行到 await x
  → 检查 x 是否已完成（未完成则登记回调）
  → 把控制权交还给事件循环
  → 事件循环去跑其他就绪的协程
  → x 完成后，事件循环恢复当前协程，把结果交回
```

**关键**：`await` 是**让出点**（yield point）。没有 `await` 的 `async def` 函数是「假异步」——它从头到尾占着事件循环，与同步函数没区别。

---

## 4. 事件循环

### 4.1 什么是事件循环

> 一个**单线程**的调度器：维护就绪队列，反复取出协程跑到下一个 `await`，再取出下一个。

```python
asyncio.run(main())
```

做四件事：

```
① 创建新的事件循环
② 运行 main() 直到完成
③ 取消所有剩余任务
④ 关闭循环、关闭异步生成器、释放线程池
```

> **一个线程只能有一个运行中的事件循环**。`asyncio.run` 不能在已运行循环内调用（Jupyter/FastAPI 内部就是运行中的循环，所以会报 `RuntimeError: asyncio.run() cannot be called from a running event loop`）。

### 4.2 没有 `await` 就没有并发

```python
import time


async def busy():
    time.sleep(1)          # ❌ 阻塞：事件循环被占住，其他协程全停


async def worker(name):
    for _ in range(3):
        print(name, "工作中")
        await busy()
```

三个 `worker` 并发跑，总耗时仍是 9 秒（因为 `time.sleep` 不让出）。改成 `await asyncio.sleep(1)` 后，总耗时 3 秒。

> 这条规则是 [01 篇](./01-GIL与并发模型选择.md) §7.3 的延续：**只有 `await` 才会让出**。

### 4.3 `await asyncio.sleep(0)` 主动让出

```python
async def long_loop():
    for i in range(10_000_000):
        if i % 10_000 == 0:
            await asyncio.sleep(0)      # 让其他任务有机会跑
```

用途：长时间纯计算但又不想饿死其他协程时，周期性让出。**这不是并行**，只是避免独占——真正的 CPU 密集仍然要用多进程。

---

## 5. 串行 vs 并发（本篇核心）

### 5.1 反模式：`await` 一个接一个

```python
async def serial():
    a = await fetch("A")      # 1s
    b = await fetch("B")      # 再 1s
    c = await fetch("C")      # 再 1s
    return [a, b, c]          # 总耗时 ~3s
```

**这是最常见的「假并发」**：代码写成 `async`，实际完全串行。

### 5.2 `asyncio.gather`：同时启动

```python
async def concurrent():
    results = await asyncio.gather(
        fetch("A"),
        fetch("B"),
        fetch("C"),
    )
    return results              # 总耗时 ~1s，结果按传入顺序排列
```

| 特性 | 说明 |
| --- | --- |
| 启动时机 | 调用 `gather` 时**立即**把三个协程包装成 Task 并调度 |
| 返回顺序 | **与传入顺序一致**（不是完成顺序） |
| 异常 | 默认**第一个异常向上抛**，其余任务继续跑完（结果丢弃） |
| 汇总异常 | `return_exceptions=True` → 异常作为结果项返回 |

```python
results = await asyncio.gather(
    fetch("A"), fetch("B"), fetch("C"),
    return_exceptions=True,
)
for r in results:
    if isinstance(r, Exception):
        print("失败:", r)
    else:
        print("成功:", r)
```

### 5.3 `create_task`：手动管理

```python
async def manual():
    t1 = asyncio.create_task(fetch("A"))     # 立即开始调度
    t2 = asyncio.create_task(fetch("B"))

    # 两个任务已经在跑，此处可插入其他工作
    print("做点别的事")

    a = await t1          # 等 A（若已结束立即返回）
    b = await t2          # 等 B
    return a, b
```

| 写法 | 何时用 |
| --- | --- |
| `await coro()` | 只有一个任务，或必须串行（后一步依赖前一步结果） |
| `await gather(...)` | 一批任务一起等，顺序不重要或需按序取结果 |
| `create_task` | 需要「先启动，稍后再等」，或要在中间插入逻辑 |

> **必须保存 `create_task` 的返回值并 `await`**。否则任务可能在函数返回时被取消，异常也会静默丢失（`Task exception was never retrieved`）。

### 5.4 `as_completed`：谁先完成先处理

```python
async def first_done():
    tasks = [asyncio.create_task(fetch(n)) for n in ("A", "B", "C")]
    for fut in asyncio.as_completed(tasks):
        result = await fut
        print("完成:", result)
```

适用：抓取一批 URL、只关心「最快的前 N 个」、边完成边处理结果。

### 5.5 `TaskGroup`：结构化并发（3.11+，推荐）

```python
async def structured():
    async with asyncio.TaskGroup() as tg:
        t1 = tg.create_task(fetch("A"))
        t2 = tg.create_task(fetch("B"))
    # 退出 async with 时，所有任务保证已结束
    return t1.result(), t2.result()
```

| 特性 | `gather` | `TaskGroup` |
| --- | --- | --- |
| 退出保证 | 手动 `await` | `async with` 退出即全部结束 |
| 异常语义 | 第一个异常抛出，其他继续 | **一个失败 → 取消其余**，抛 `ExceptionGroup` |
| 异常类型 | 原异常 | `ExceptionGroup`（需 `except*` 处理） |
| 适用 | 简单并发、要 `return_exceptions` | 新代码首选（结构化、无泄漏） |

```python
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(fetch("A"))
        tg.create_task(may_fail())
except* ValueError as eg:
    for e in eg.exceptions:
        print("ValueError:", e)
except* ConnectionError as eg:
    print("连接失败:", eg.exceptions)
```

> `except*` 是 PEP 654 的语法，专门处理 `ExceptionGroup`。**一个任务失败会取消同组其他任务**——这正是「结构化并发」的价值：不留孤儿任务。

---

## 6. 超时与取消

### 6.1 超时

```python
# 方式 1：wait_for（旧但常用）
try:
    result = await asyncio.wait_for(fetch("A"), timeout=0.5)
except asyncio.TimeoutError:
    print("超时")


# 方式 2：asyncio.timeout（3.11+，推荐，可包多行）
try:
    async with asyncio.timeout(0.5):
        result = await fetch("A")
        processed = await process(result)
except TimeoutError:
    print("超时")
```

**重要**：`wait_for`/`timeout` 超时后会**取消**内部任务（抛 `CancelledError` 到任务内部），不是「放弃等待让它继续跑」。

### 6.2 取消

```python
async def long_task():
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        print("被取消，做清理")
        raise                     # ❗️必须重抛，别吞
    finally:
        print("清理资源")


task = asyncio.create_task(long_task())
await asyncio.sleep(0.1)
task.cancel()
try:
    await task
except asyncio.CancelledError:
    print("已确认取消")
```

| 要点 | 说明 |
| --- | --- |
| `CancelledError` 继承 `BaseException` | 不会被 `except Exception` 捕获（防止误吞） |
| 捕获后必须重抛 | 吞掉取消会让 `task.cancel()` 失效 |
| `finally` 仍会执行 | 清理逻辑放这里 |
| `cancel()` 是「请求」 | 真正生效要等任务下次执行到 `await` |

### 6.3 `shield`：保护关键段不被取消

```python
result = await asyncio.shield(save_to_db())
```

用途：外层超时/取消时，**内部的写库操作要跑完**，否则数据半截。但 `shield` 只是保护内层任务不被取消，外层仍是「不再等待」——需自行处理一致性。

---

## 7. 常见反模式速查

| 反模式 | 症状 | 正确做法 |
| --- | --- | --- |
| `await` 一串 | 总耗时 = 各任务之和 | `gather` 或 `TaskGroup` |
| `async def` 里 `time.sleep`/`requests` | 并发退化为串行 | `await asyncio.sleep` / `httpx` |
| 忘了 `await` | `RuntimeWarning`，逻辑没执行 | 检查每个协程调用 |
| `create_task` 不保存引用 | 任务被 GC 收到一半 | 存到变量/集合，或 `gather` |
| `async def` 里做重 CPU 计算 | 事件循环卡死 | 丢 `run_in_threadpool`/进程池 |
| 用 `except Exception` 包住 `await` | 吞掉 `CancelledError`（其实不会，因为它是 `BaseException`）→ 但会吞业务异常 | 精确捕获 |
| 嵌套 `asyncio.run` | `RuntimeError: cannot be called from a running event loop` | 用 `await` 或 `create_task` |
| 在同步代码里调用协程 | 得到协程对象，没执行 | `asyncio.run` 或改成异步 |

---

## 8. 项目实战：FastAPI 里谁在驱动你的协程

### 8.1 路由函数就是协程

完整文件路径：`apps/api-py/app/api/*.py`（结构）

```python
@router.get("/health")
async def health() -> dict:
    return {"ok": True}
```

FastAPI/Starlette 的处理方式：

```
收到请求 → 调用 health() 得到协程对象 → await 它（在事件循环里）
```

所以你写的每个 `async def` 路由，都是被 uvicorn 的事件循环 `await` 的。这也解释了：

| 现象 | 解释 |
| --- | --- |
| 路由里 `await` 慢查询，其他请求仍能处理 | 事件循环切走了 |
| 路由里 `time.sleep(1)`，其他请求全卡 | 没有让出点 |
| 路由里 `await db.execute(...)` 是同步 SQLAlchemy | **实际没让出**（同步驱动阻塞线程） |

### 8.2 异常处理器也是协程

完整文件路径：`apps/api-py/app/errors.py`（节选）

```python
@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    ...

@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    ...
```

Starlette 在捕获异常后 **`await` 这些处理器**。写成 `async def` 的意义：

| 好处 | 说明 |
| --- | --- |
| 可以做异步 IO | 比如异步写审计日志、异步上报 |
| 与框架统一 | 框架一律 `await`，无需区分同步/异步 |
| 无额外线程开销 | 纯计算型处理器不切线程 |

> 反过来，如果你把处理器写成普通 `def`，Starlette 会自动丢线程池——**功能一样，只是多一次线程切换**。

### 8.3 一个真实的「假并发」场景

假设要做「一次请求里聚合三个数据源」：

```python
# ❌ 串行：3 次 IO 相加
@router.get("/dashboard")
async def dashboard():
    apps = await fetch_apps()
    runs = await fetch_runs()
    stats = await fetch_stats()
    return {"apps": apps, "runs": runs, "stats": stats}


# ✅ 并发：总耗时 ≈ 最慢的那一个
@router.get("/dashboard")
async def dashboard():
    apps, runs, stats = await asyncio.gather(
        fetch_apps(), fetch_runs(), fetch_stats(),
    )
    return {"apps": apps, "runs": runs, "stats": stats}
```

前提：`fetch_*` 必须是**真异步**（内部用 `await` 的异步客户端）。如果它们内部是同步 `requests`，`gather` 也无法并发。

---

## 9. 与 TypeScript / Node 对照

| Python | TypeScript/Node | 说明 |
| --- | --- | --- |
| `async def f()` | `async function f()` | 一致 |
| `await x` | `await x` | 一致 |
| 协程对象 | `Promise` | 都是「未执行的异步结果」 |
| `asyncio.run(main())` | 直接调用 `main()`（自动驱动） | Node 有隐式循环 |
| `asyncio.gather(a, b)` | `Promise.all([a, b])` | 一致（Python 结果按序） |
| `return_exceptions=True` | `Promise.allSettled` | 语义对应 |
| `as_completed` | `Promise.race` / 事件回调 | Python 能逐个拿 |
| `TaskGroup` | `Promise.all` + `AbortController` | 结构化 + 取消 |
| `task.cancel()` | `AbortController.abort()` | 都是协作式取消 |
| `asyncio.timeout` | `AbortSignal.timeout()` | 一致 |
| 事件循环 | libuv 事件循环 | 都是单线程调度 |

> 心智迁移几乎零成本：**`await` 就是 `await`**。差异在错误处理（`ExceptionGroup`/`except*`）与取消（`CancelledError` vs `AbortError`）。

---

## 10. 验收自测

### 10.1 预测耗时

```python
async def main():
    await asyncio.gather(
        asyncio.sleep(1),
        asyncio.sleep(2),
        asyncio.sleep(3),
    )

asyncio.run(main())
```

<details>
<summary>答案</summary>

约 **3 秒**（并发执行，总耗时 = 最慢的那个）。

</details>

### 10.2 找错

```python
async def main():
    a = await asyncio.sleep(1)     # 期望 1 秒
    b = await asyncio.sleep(1)     # 期望再 1 秒
    print(a, b)
```

问题：这不是错误，但若两个任务互不依赖，**总耗时 2 秒是浪费**，应改 `gather` 变 1 秒。

### 10.3 动手题

写 `fetch_all(urls, timeout=5)`：

- 并发抓取，任意一个失败不影响其他；
- 每个请求单独 5 秒超时；
- 返回 `dict[url, str | Exception]`。

参考实现：

```python
import asyncio
import httpx


async def fetch_all(urls: list[str], timeout: float = 5.0) -> dict[str, str | Exception]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        async def one(url: str) -> str:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.text

        results = await asyncio.gather(
            *(one(u) for u in urls),
            return_exceptions=True,
        )
    return dict(zip(urls, results))
```

> 注意 `*(...)` 展开生成器：`gather` 接收的是**位置参数**，不是列表。

---

## 11. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `RuntimeWarning: coroutine was never awaited` | 忘了 `await` | 补 `await` 或 `create_task` |
| 并发代码耗时没变 | `await` 串行 / 内部是同步库 | `gather` + 真异步客户端 |
| `asyncio.run() cannot be called from a running event loop` | 在已有循环里再 `run` | 用 `await` / `create_task` |
| `Task exception was never retrieved` | `create_task` 未 `await`，异常丢失 | 保存引用并 `await`，或 `gather` |
| `gather` 一个失败，其他结果全丢 | 默认第一个异常上抛 | `return_exceptions=True` |
| `TaskGroup` 报 `ExceptionGroup` 不知道怎么接 | 新异常类型 | 用 `except*` 拆包 |
| `CancelledError` 被吞掉 | 在 `except` 里没重抛 | 捕获后 `raise` |
| 超时后任务还在跑 | 以为 `wait_for` 只是「不等了」 | 它**会取消**任务，需在任务内处理清理 |
| `asyncio.sleep` 写成 `time.sleep` | 阻塞事件循环 | 换异步版 |
| 事件循环里跑 `bcrypt`/同步 DB | 阻塞 | `run_in_threadpool`（[01 篇](./01-GIL与并发模型选择.md)） |

---

## 12. 本篇小结

- **协程函数调用不执行**，返回协程对象；必须被 `await`/`create_task`/`asyncio.run` 驱动。
- **`await` 是让出点**：把控制权交给事件循环，去跑别的就绪协程；没有 `await` 就没有并发。
- **事件循环是单线程调度器**；`asyncio.run` 建循环、跑主协程、清理残余、关循环。
- **`await a; await b` 是串行**；`gather`/`TaskGroup` 才是并发。这是最高频的错误。
- **`gather`** 结果按传入顺序、默认抛第一个异常、`return_exceptions=True` 可全收集。
- **`TaskGroup`** 是 3.11+ 的结构化并发：退出即全部结束，一个失败取消其余，异常走 `ExceptionGroup`/`except*`。
- **超时会取消任务**（不是「只是不等」）；**取消是协作式的**，任务需处理 `CancelledError` 并重抛。
- **`CancelledError` 继承 `BaseException`**，不会被 `except Exception` 误吞。
- **`create_task` 必须保存引用**，否则任务可能被 GC、异常丢失。
- **项目范式**：FastAPI 的路由与异常处理器都是被事件循环 `await` 的协程；写成 `async def` 后**内部必须真异步**，否则仍是阻塞。
- **下一步**：异步实战模式——限流、重试、超时组合、异步缓存、连接池。
