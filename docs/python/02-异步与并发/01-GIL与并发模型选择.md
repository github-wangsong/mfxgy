# 01 · GIL 与并发模型选择

> 所属：阶段 2 · 异步与并发
> 本篇覆盖：并发 vs 并行的区别、GIL 是什么与为何存在、GIL 对 CPU 密集/IO 密集的不同影响、实测三种模型（串行/多线程/多进程）、三种并发模型对照与选型决策树、线程/进程/协程的成本、FastAPI 的三层并发结构、阻塞调用对事件循环的伤害与 `run_in_threadpool`
> **本篇首次教学：并发与并行的语义区别、GIL 的成因与释放时机（IO 等待时释放，字节码执行时互斥）、CPU 密集用多进程 / IO 密集用线程或协程的判据、`concurrent.futures` 的 `ThreadPoolExecutor`/`ProcessPoolExecutor`/`ProcessPoolExecutor(max_workers)` 用法、进程/线程/协程的启动与内存成本对比、uvicorn 多 worker 与事件循环的分层、`run_in_threadpool` 把阻塞调用移出事件循环**（`asyncio` 语法细节见下一篇 02；线程锁与队列见 04；GIL 在 3.13+ free-threading 的变化作为 §4.4 说明）
> 预告：下一篇讲 asyncio 核心（`async`/`await`、事件循环、`Task`/`gather`、超时与取消）。

> 项目锚点：`apps/api-py/app/main.py`（`uvicorn.run(..., reload=True)`，生产用多 worker）、`apps/api-py/app/api/*.py`（全部 `async def` 路由）、`apps/api-py/app/security.py`（bcrypt 是**同步阻塞**调用，是「阻塞事件循环」的典型教材）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 用一句话说清「并发」与「并行」的区别。
2. 解释 GIL 为什么让多线程无法加速 CPU 密集任务，却不妨碍 IO 密集任务。
3. 面对一个需求（爬虫 / 图片压缩 / API 聚合 / 批量入库），能直接给出并发模型选择。
4. 说清 FastAPI 的三层并发：进程、事件循环、线程池分别负责什么。
5. 判断一段代码会不会阻塞事件循环，并知道怎么救。

**验收标准**

- 能写出线程池/进程池的最小示例并解释 `max_workers` 的影响。
- 能解释「8 核机器上跑 8 个 uvicorn worker」与「8 核跑 8 个线程做 CPU 计算」的差别。
- 能指出同步 `bcrypt` 放在 `async def` 路由里的风险及两种解法。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [01-Python进阶/02 迭代器与生成器](../01-Python进阶/02-迭代器与生成器.md)、[01-Python进阶/04 上下文管理器](../01-Python进阶/04-上下文管理器与dataclass.md) |
| 已掌握 | 函数、装饰器、上下文管理器、异常 |

---

## 3. 并发 ≠ 并行

| 概念 | 定义 | 类比 |
| --- | --- | --- |
| **并发**（Concurrency） | 多个任务**交替推进**（同一时刻可能只有一个在跑） | 一个厨师同时看 3 口锅 |
| **并行**（Parallelism） | 多个任务**真正同时**执行（需要多核） | 3 个厨师各看一口锅 |

```
并发：A ──┐   ┌──┐   ┌──
          └───┘  └───┘        （一个执行者来回切换）
并行：A ──────────────
      B ──────────────         （多个执行者同时跑）
      C ──────────────
```

结论：**并发是「结构」，并行是「执行方式」**。异步编程解决的是并发（IO 等待期间切换），多进程解决的是并行（真多核）。

---

## 4. GIL：全局解释器锁

### 4.1 是什么

> **GIL（Global Interpreter Lock）**：CPython 解释器里的一把全局互斥锁。任一时刻，**只有一个线程**能执行 Python 字节码。

影响：

| 任务类型 | 多线程效果 | 原因 |
| --- | --- | --- |
| **CPU 密集**（计算、压缩、加密、图像处理） | ❌ 几乎无加速，甚至更慢 | 线程互相抢 GIL，还要付切换开销 |
| **IO 密集**（网络、磁盘、数据库） | ✅ 明显加速 | 等待 IO 时线程**主动释放 GIL** |
| 混合 | 视占比而定 | — |

### 4.2 为什么会有 GIL（不是设计失误）

历史与工程原因：

| 原因 | 说明 |
| --- | --- |
| 引用计数线程安全 | CPython 用引用计数管理内存；不加锁的话，两个线程同时改计数会崩 |
| 单锁比细粒度锁简单 | 大量 C 扩展（numpy 之前）依赖 GIL 保证安全 |
| 单线程性能更好 | 无锁开销，缓存友好 |

> 官方正在推进 **PEP 703（free-threaded CPython，3.13 起实验性 `--disable-gil` 构建）**。但目前生产主流仍是带 GIL 的解释器，选型逻辑不变。

### 4.3 GIL 的释放时机（关键）

```
线程 A 执行字节码 ──每 5ms 或遇到阻塞 IO──→ 释放 GIL
                                            ↓
                              线程 B 获得 GIL 继续跑
```

- **纯计算循环**：每 ~5ms 强制切换一次（`sys.getswitchinterval()`），所以多线程是「轮流跑」，总时间不降。
- **`time.sleep` / socket 读写 / 文件 IO**：**在等待期间释放 GIL**，其他线程可真正并行推进。

这就是「IO 密集多线程有效」的机制根源。

### 4.4 一个常被误解的点：numpy 会释放 GIL

```python
import numpy as np

# numpy 的大量运算在 C 层执行并主动释放 GIL
a = np.random.rand(2000, 2000)
b = a @ a          # 多线程里能真并行
```

结论：**「CPU 密集」要看是否纯 Python 字节码**。C 扩展（numpy、hashlib、zlib、部分加密库）内部会释放 GIL。

---

## 5. 实测：三种模型跑同一批任务

### 5.1 CPU 密集

```python
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor


def cpu_work(n: int) -> int:
    total = 0
    for i in range(n):
        total += i * i
    return total


N, TIMES = 3_000_000, 4

def run_serial():
    return [cpu_work(N) for _ in range(TIMES)]

def run_threads():
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(cpu_work, [N] * TIMES))

def run_processes():
    with ProcessPoolExecutor(max_workers=4) as pool:
        return list(pool.map(cpu_work, [N] * TIMES))


for name, fn in [("串行", run_serial), ("线程", run_threads), ("进程", run_processes)]:
    t0 = time.perf_counter()
    fn()
    print(f"{name}: {time.perf_counter() - t0:.2f}s")
```

典型结果（4 核）：

| 模型 | 耗时 | 说明 |
| --- | --- | --- |
| 串行 | ~4.0s | 基准 |
| 4 线程 | ~4.1s | **几乎没变快**（GIL） |
| 4 进程 | ~1.2s | 接近线性加速（4 核） |

### 5.2 IO 密集

```python
import time
from concurrent.futures import ThreadPoolExecutor


def io_work(_):
    time.sleep(0.5)          # 模拟一次网络请求
    return "ok"


def run_serial():
    [io_work(i) for i in range(8)]

def run_threads():
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(io_work, range(8)))
```

| 模型 | 耗时 |
| --- | --- |
| 串行 | ~4.0s |
| 8 线程 | ~0.5s |

> **判据一句话**：等的时间 > 算的时间 → 线程/协程；算的时间 > 等的时间 → 多进程。

### 5.3 `PoolExecutor` 最小用法

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

with ThreadPoolExecutor(max_workers=4) as pool:
    futures = [pool.submit(io_work, i) for i in range(8)]
    for fut in as_completed(futures):
        print(fut.result())          # 谁先完成先拿结果
```

| 方法 | 作用 |
| --- | --- |
| `submit(fn, *args)` | 提交单个任务，返回 `Future` |
| `map(fn, iterable)` | 批量提交，按**原顺序**返回结果 |
| `as_completed(fs)` | 按**完成顺序**迭代 `Future` |
| `future.result()` | 取结果（会抛任务内异常） |
| `future.exception()` | 取异常 |
| `pool.shutdown(wait=True)` | 等全部结束（`with` 自动调用） |

> `ThreadPoolExecutor` 与 `ProcessPoolExecutor` API 一致，**换类即可换模型**——但被提交的函数必须可 pickle（进程池）。

---

## 6. 三种模型对照

| 维度 | 多线程（`threading`/`ThreadPoolExecutor`） | 多进程（`multiprocessing`/`ProcessPoolExecutor`） | 协程（`asyncio`） |
| --- | --- | --- | --- |
| 并发单位 | 线程（OS 调度） | 进程（独立解释器） | 协程（事件循环调度，用户态） |
| 受 GIL 限制 | ✅ 受限 | ❌ 不受限 | ✅ 受限（单线程内） |
| CPU 密集加速 | ❌ | ✅ | ❌ |
| IO 密集加速 | ✅ | ✅（开销大） | ✅✅ 最省 |
| 启动成本 | 中（~KB 栈） | 高（~MB 内存 + fork/spawn） | 极低（~KB 对象） |
| 内存隔离 | ❌ 共享内存（需锁） | ✅ 独立 | ❌ 共享 |
| 通信方式 | 共享变量 + `Lock`/`Queue` | pickle 序列化 / `Queue` / 共享内存 | `await` 直接传 |
| 适合任务数 | 几十~几百 | 与核数同量级 | 几千~几万 |
| 调试难度 | 中（竞态难复现） | 高（跨进程栈） | 中（栈不直观） |
| 典型场景 | 阻塞 IO、同步库 | 图像/视频处理、批量计算 | Web 服务、高并发 IO |

### 6.1 成本直觉

```
1 个进程        约 10~30 MB 常驻内存 + 独立解释器
1 个线程        约 8 MB 虚拟栈（实际用多少算多少）
1 个协程对象    约几百字节
```

所以：

- 1 万并发连接 → **协程**（进程/线程都撑不住）；
- 4 个压缩任务 → **4 个进程**（CPU 密集）；
- 50 个同步 SDK 调用 → **线程池**（无异步版 SDK）。

### 6.2 选型决策树

```
任务在等吗？
├── 主要是等（网络/磁盘/DB）
│   ├── 有异步库（httpx/asyncpg/aiofiles） → 协程（asyncio）
│   └── 只有同步库（requests/bcrypt/某些 SDK） → 线程池
└── 主要是在算（纯 Python CPU）
    ├── 能用 C 扩展/numpy 向量化 → 先优化算法，避免并行
    └── 不能 → 多进程（ProcessPoolExecutor）
```

> 第一步永远是「**能不能不并发**」：算法优化、批量接口、缓存，往往比换模型收益更大。

---

## 7. FastAPI 的三层并发

### 7.1 分层图

```
┌──────────────────────────────────────────────┐
│  uvicorn 主进程（manager）                     │
│   ├── worker 进程 1  ← 每进程一个事件循环      │
│   ├── worker 进程 2                            │  ← 第 1 层：多进程（真并行）
│   └── worker 进程 N                            │
└──────────────────────────────────────────────┘
          │ 每个 worker 内
          ▼
┌──────────────────────────────────────────────┐
│  事件循环（单线程，跑所有 async def 路由）      │  ← 第 2 层：协程并发
│   └── 同步 def 路由 → 丢进线程池（默认 40 线程） │  ← 第 3 层：线程池兜底
└──────────────────────────────────────────────┘
```

### 7.2 三层各管什么

| 层 | 负责 | 配置方式 |
| --- | --- | --- |
| 进程（worker） | CPU 并行、故障隔离 | `uvicorn app.main:app --workers 4`（≈ 核数） |
| 协程（事件循环） | 高并发 IO（几千连接） | 把路由写成 `async def` + `await` 异步库 |
| 线程池 | 兜底同步阻塞代码 | Starlette 自动把 `def` 路由放进线程池（`anyio` 默认 40 个） |

### 7.3 `def` 与 `async def` 的真实差别

```python
# ① async def + 异步库 → 最优，等待时让出事件循环
@router.get("/proxy")
async def proxy():
    async with httpx.AsyncClient() as client:
        r = await client.get("https://example.com")
    return r.json()


# ② def + 同步库 → 自动在线程池跑，不会阻塞事件循环
@router.get("/legacy")
def legacy():
    return requests.get("https://example.com").json()


# ③ async def + 同步阻塞库 → ❌ 最糟：阻塞整个事件循环
@router.get("/bad")
async def bad():
    return requests.get("https://example.com").json()
```

**关键结论**：`async def` 里**绝不能**出现同步阻塞调用（`requests`、`time.sleep`、同步 DB 驱动、`bcrypt`、大文件读写）。

### 7.4 救 ③ 的两种方式

```python
from starlette.concurrency import run_in_threadpool


@router.get("/ok")
async def ok():
    result = await run_in_threadpool(requests.get, "https://example.com")
    return result.json()
```

或者直接把路由改回 `def`（让框架自动丢线程池）。

> 判断标准：**函数里有没有 `await`？没有就把路由写成 `def`**。这是 FastAPI 最容易踩的坑之一。

---

## 8. 项目实战：bcrypt 与异步路由

完整文件路径：`apps/api-py/app/security.py`（节选）

```python
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            password_hash.encode("utf-8"),
        )
    except ValueError:
        return False
```

关键事实：

| 事实 | 影响 |
| --- | --- |
| `bcrypt` 是**同步、CPU 密集**的（故意设计得慢，防爆破） | 一次校验约 50~300 ms |
| 它**不释放 GIL**？ | bcrypt 的 C 实现内部通常释放 GIL，但调用本身是阻塞的——在事件循环里会**卡住整个 worker** |
| 如果所在路由是 `async def` | 该 worker 在 50~300ms 内**无法处理任何其他请求** |

### 8.1 两种处理策略

```python
# 策略 A：路由写成 def，让 Starlette 丢线程池
@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    ...
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(...)


# 策略 B：保持 async，用 run_in_threadpool 只包住阻塞段
@router.post("/login")
async def login(body: LoginRequest, db: Session = Depends(get_db)):
    ok = await run_in_threadpool(verify_password, body.password, user.password_hash)
```

> 注意：`Depends(get_db)` 返回的 `Session` 是**同步** SQLAlchemy 会话。在 `async def` 路由里执行 `db.get(...)` 同样是阻塞调用——所以本项目大量路由选择 `def` 或依赖同步会话，是一致的设计取舍（阶段 6/03 讨论「同步 vs 异步驱动」时会再碰到这个权衡）。

### 8.2 容量测算（为什么这很重要）

```
1 个 worker，bcrypt 阻塞 200ms
→ 理论上限 5 QPS（单 worker 串行）

4 个 worker
→ 理论上限 20 QPS

若改成 run_in_threadpool(40 线程)
→ 理论上限 200 QPS（受 CPU 与 GIL 实际约束）
```

**这就是「一个阻塞调用把 500 QPS 的服务打成 5 QPS」的经典事故。**

---

## 9. 与 Node / TS 对照

| Python | Node/TS | 说明 |
| --- | --- | --- |
| GIL | 单线程事件循环（天然单线程） | 原因不同，效果类似：CPU 密集都难加速 |
| `threading` | `worker_threads` | Node 线程是真正的并行（无 GIL），但有消息开销 |
| `multiprocessing` | `cluster` / `child_process` | 都是多进程 |
| `asyncio` | Promise + 事件循环 | 语义接近 |
| `async def` | `async function` | 一致 |
| `await` | `await` | 一致 |
| `run_in_threadpool` | `worker_threads` 或 `setImmediate` 拆分 | Node 无「线程池兜底」 |
| 同步阻塞打死事件循环 | 同步阻塞打死事件循环 | **完全相同的坑** |

> 心智迁移：Node 开发者对「不要阻塞事件循环」很熟；Python 多了 GIL 这层，但**结论一致**——异步路由里别放阻塞调用。差别是 Python 还有「多进程」这个 Node 里较重的选项可用。

---

## 10. 验收自测

### 10.1 判断正误

1. 8 核机器上开 8 个线程做纯 Python 计算，能加速到 1/8 时间 → **错**（GIL）。
2. 8 核机器上开 8 个 uvicorn worker，能显著提升吞吐 → **对**（每个 worker 独立进程 + 事件循环）。
3. `time.sleep(1)` 期间会释放 GIL，其他线程可以跑 → **对**。
4. `async def` 路由里调用 `requests.get` 不会影响其他请求 → **错**，会阻塞整个事件循环。

### 10.2 选型题

| 场景 | 选择 | 理由 |
| --- | --- | --- |
| 抓 500 个网页 | 协程（`httpx.AsyncClient` + `gather`） | 纯 IO 等待，协程成本最低 |
| 批量压缩 20 个视频 | 多进程（`ProcessPoolExecutor`） | CPU 密集，且 ffmpeg 是外部进程 |
| 调用只有同步版的公司 SDK | 线程池 / `run_in_threadpool` | 无异步版，只能丢线程 |
| 计算 100 万条日志的统计 | 单进程 + 优化算法（或 numpy） | 先优化，再考虑多进程 |
| 1 万并发 SSE 连接 | 协程 | 线程/进程都撑不住 |

### 10.3 动手题

写 `fetch_all(urls)`：用 `httpx` 异步并发抓取，返回 `{url: status_code}`，单请求超时 5 秒。

参考实现（下一篇会讲 `gather` 细节）：

```python
import asyncio
import httpx


async def fetch_all(urls: list[str]) -> dict[str, int]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        async def one(url: str) -> tuple[str, int]:
            try:
                r = await client.get(url)
                return url, r.status_code
            except httpx.HTTPError:
                return url, 0

        results = await asyncio.gather(*(one(u) for u in urls))
    return dict(results)
```

---

## 11. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 多线程跑 CPU 任务没变快 | GIL | 用多进程，或先优化算法 |
| 服务偶发「整体卡住 1 秒」 | 某个 `async` 路由里有同步阻塞调用 | 改 `def`，或 `run_in_threadpool` |
| `ProcessPoolExecutor` 报 `pickle` 错误 | 提交的是 lambda/闭包/不可序列化对象 | 用模块级函数 |
| Windows 上多进程报 `RuntimeError` | `spawn` 模式要求入口在 `if __name__ == "__main__"` | 加保护（[00-Python基础/04](../00-Python基础/04-模块、包与导入.md)） |
| 线程数开太多反而更慢 | 上下文切换 + GIL 争抢 | 线程数 ≈ 2~4 × 核数（IO 密集） |
| 进程池里改了全局变量，主进程看不到 | 进程内存隔离 | 用返回值/`Queue` 通信 |
| 多线程共享计数丢数据 | 无锁竞态 | `Lock`（下一篇/04 详解） |
| uvicorn `--workers N` 但只有 1 个进程在跑 | Windows 下 reload/workers 兼容性问题 | 生产用 Linux/WSL，或改用 gunicorn |
| 异步里用 `time.sleep` | 阻塞事件循环 | `await asyncio.sleep()` |

---

## 12. 本篇小结

- **并发 ≠ 并行**：并发是交替推进，并行是真同时执行。
- **GIL 让 CPython 同一时刻只有一个线程执行字节码**：CPU 密集多线程无效，IO 密集有效（等待时释放 GIL）。
- **C 扩展会释放 GIL**（numpy/加密库），所以「CPU 密集」要看是否纯 Python 字节码。
- **三模型选型**：IO 等待 → 协程（有异步库）或线程池（只有同步库）；CPU 计算 → 多进程；先优化算法再谈并行。
- **成本量级**：进程 MB 级、线程 MB 级栈、协程百字节——万级并发只能靠协程。
- **FastAPI 三层并发**：worker 进程（CPU 并行）→ 事件循环（协程 IO）→ 线程池（同步兜底）。
- **`async def` 里禁止同步阻塞调用**；有阻塞就改 `def` 或用 `run_in_threadpool`。
- **`def` 路由由框架自动丢线程池**，不是「同步就慢」——慢的是「同步还硬写 `async`」。
- **项目范式**：`security.py` 的 bcrypt 是天然阻塞点，路由层必须用 `def` 或线程池承接。
- **下一步**：asyncio 核心——`async`/`await`、事件循环、`Task`/`gather`、超时与取消。
