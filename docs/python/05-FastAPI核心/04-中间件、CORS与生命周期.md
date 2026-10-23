# 04 · 中间件、CORS 与生命周期

> 所属：阶段 5 · FastAPI 核心
> 本篇覆盖：中间件的 ASGI 洋葱模型、`@app.middleware("http")` 与 `BaseHTTPMiddleware`、纯 ASGI 中间件、`add_middleware` 的**注册顺序与执行顺序相反**、中间件的能力边界（拿不到路由/依赖、不能改已发送的响应）、请求耗时与 `request_id` 中间件、CORS 的同源策略与预检请求、`CORSMiddleware` 六个参数、`allow_origins=["*"]` 与 `allow_credentials` 的冲突、`lifespan`（`@asynccontextmanager`）替代 `@app.on_event`、在 lifespan 里管理连接池/HTTP 客户端/模型加载
> **本篇首次教学：中间件的洋葱模型与「请求正序、响应逆序」、`add_middleware` 后注册的在外层、`@app.middleware("http")` 与 `BaseHTTPMiddleware` 的对应关系、纯 ASGI 中间件的 `app(scope, receive, send)` 包装写法、中间件为什么不能使用 `Depends`、CORS 的简单请求与预检请求、`CORSMiddleware` 的 `allow_origins`/`allow_credentials`/`expose_headers`/`max_age`、`allow_origins=["*"]` 加凭据的浏览器限制、`lifespan` 的 `yield` 前后语义、`@app.on_event` 为何被弃用、在 lifespan 里关闭 `httpx.AsyncClient` 与释放引擎**
> 预告：下一篇讲 APIRouter 分层与项目结构——把「一个业务域」的 router / service / schema 拆开。

> 项目锚点：`apps/api-py/app/main.py`（真实文件：`app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])`，目前**没有** lifespan——本篇会给出加 lifespan 的具体改法）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 画出中间件的洋葱模型，并说出多个中间件的执行顺序。
2. 写一个记录耗时与 `request_id` 的中间件。
3. 解释浏览器为什么会先发一个 `OPTIONS` 请求，以及怎么让它通过。
4. 说清 `allow_origins=["*"]` 在什么情况下会失效。
5. 用 `lifespan` 管理连接池与 HTTP 客户端，并说出它与 `on_event` 的差异。
6. 读懂项目的 CORS 配置，并判断哪些是「开发期可接受、生产要改」的。

**验收标准**

- 能解释「先 `add_middleware(A)` 再 `add_middleware(B)`，谁先执行」。
- 能说出中间件里为什么拿不到 `request.path_params`。
- 能写出 `lifespan` 的完整骨架并正确 `yield`。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [04-Web基础/01 HTTP 与 ASGI/WSGI](../04-Web基础与FastAPI起步/01-HTTP与ASGI-WSGI.md)（ASGI 三元组）、[05-FastAPI核心/03 异常处理](./03-异常处理与错误契约.md)（错误信封） |
| 已掌握 | 上下文管理器、`@asynccontextmanager`（[01-Python进阶/04](../01-Python进阶/04-上下文管理器与dataclass.md) §4） |

---

## 3. 中间件是什么

### 3.1 洋葱模型

```
请求 →
  ┌─────────────────────────┐
  │ 中间件 A（最外层）        │
  │  ┌───────────────────┐  │
  │  │ 中间件 B           │  │
  │  │  ┌─────────────┐  │  │
  │  │  │  路由 + 视图  │  │  │
  │  │  └─────────────┘  │  │
  │  └───────────────────┘  │
  └─────────────────────────┘
← 响应
```

| 阶段 | 顺序 |
| --- | --- |
| 请求进入 | A → B → 视图 |
| 响应返回 | 视图 → B → A |

**一句话**：请求正序、响应逆序。所以「记录耗时」必须把计时起点放在进入时、终点放在响应后——只有包住 `call_next` 才能做到。

### 3.2 它和依赖的区别

| 维度 | 中间件 | 依赖 `Depends` |
| --- | --- | --- |
| 作用范围 | 所有请求（或按路径前缀） | 被引用的路由 |
| 能否拿到路由参数 | ❌ 只能拿原始 `scope` | ✅ 已解析 |
| 能否使用 `Depends` | ❌ | ✅ |
| 能否改响应 | 有限（可改头/状态码，不能改已发送的 body） | 视图里直接控制 |
| 适合 | 日志、`request_id`、CORS、压缩、限流 | 鉴权、DB 会话、业务校验 |

> 判断口诀：**「每个请求都要做的事」放中间件；「某些接口需要的东西」放依赖。**

---

## 4. 写一个中间件

### 4.1 `@app.middleware("http")`（最常用）

```python
import time
import uuid

from fastapi import FastAPI, Request

app = FastAPI()


@app.middleware("http")
async def timing_and_request_id(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    started = time.perf_counter()

    response = await call_next(request)          # ← 交给内层（下一个中间件或路由）

    cost_ms = (time.perf_counter() - started) * 1000
    response.headers["x-request-id"] = request_id
    response.headers["x-response-time-ms"] = f"{cost_ms:.1f}"
    print(f"{request.method} {request.url.path} {response.status_code} {cost_ms:.1f}ms")
    return response
```

| 关键点 | 说明 |
| --- | --- |
| `call_next` 只能调用一次 | 调用即「进入内层」 |
| 响应还没发送 | 所以能改 `response.headers` |
| 不能改 body | body 已在流中 |
| 必须 `return response` | 否则客户端收不到响应 |
| 异常 | `call_next` 抛出的异常会在这里冒泡，需自己 `try/except` 才能兜住 |

### 4.2 注册顺序 = 执行顺序的**倒序**

```python
app.add_middleware(A)
app.add_middleware(B)
app.add_middleware(C)
```

执行（请求方向）：**C → B → A → 路由**。

原因：每次 `add_middleware` 都把新中间件**包在现有最外层**。

| 想要的效果 | 写法 |
| --- | --- |
| CORS 最先处理（含预检） | CORS 最后注册（或直接在最早的位置 `add_middleware`，Starlette 会插到最外层之一） |
| 日志包住所有（含 CORS 的 400） | 日志中间件最后注册 |

> 实践建议：**先想清楚「谁要看到最原始的请求/最终的响应」，再决定注册顺序**。CORS 与日志的先后是常见争议点。

### 4.3 `BaseHTTPMiddleware` 类写法

```python
from starlette.middleware.base import BaseHTTPMiddleware


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["x-time-ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
        return response


app.add_middleware(TimingMiddleware)
```

`@app.middleware("http")` 内部就是 `BaseHTTPMiddleware`。

| 已知限制 | 说明 |
| --- | --- |
| 流式响应可能被缓冲 | 大文件/SSE 场景要注意 |
| 拿不到路由 | 只能看到原始 `scope` |
| `BackgroundTasks` 时序 | 与纯 ASGI 中间件略有差异 |
| 性能开销 | 每请求包一层任务组 |

> 需要极致性能或操作 SSE 流时，用**纯 ASGI 中间件**。

### 4.4 纯 ASGI 中间件

```python
class RawTimingMiddleware:
    def __init__(self, app):
        self.app = app                     # 下一层（ASGI 应用）

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-time-ms", f"{(time.perf_counter() - started) * 1000:.1f}".encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_wrapper)


app.add_middleware(RawTimingMiddleware)
```

| 对比 | `BaseHTTPMiddleware` | 纯 ASGI |
| --- | --- | --- |
| 写法 | `dispatch` + `Request` | `__call__(scope, receive, send)` |
| 访问请求体 | `await request.body()`（可能已消费） | 包装 `receive` |
| 流式 | 可能缓冲 | 完全透传 |
| 推荐场景 | 常规日志/头处理 | SSE、大文件、代理 |

> 项目里 SSE（阶段 8）走 `StreamingResponse`，若中间件必须处理流，就要考虑纯 ASGI 写法。

---

## 5. 中间件里能做与不能做

| 能做 | 说明 |
| --- | --- |
| 读写请求头 | `request.headers` |
| 读 Cookie | `request.cookies` |
| 读原始 body | `await request.body()`，**但会消费流**，之后视图可能读不到 |
| 改响应头/状态码 | `response.headers[...]` |
| 短路返回 | 不调 `call_next`，直接 `return JSONResponse(...)`（限流、维护模式） |
| 记日志/埋点 | 最主流用途 |

| 不能做 | 原因 |
| --- | --- |
| 用 `Depends` | 中间件在依赖解析之前运行 |
| 拿 `request.path_params` | 路由还没匹配 |
| 改已发送的 body | 响应流已开始 |
| 依赖视图的返回值 | 只能看到 `Response` 对象 |
| 做重 CPU 计算 | 阻塞所有请求 |

### 5.1 短路示例（限流/维护模式）

```python
@app.middleware("http")
async def maintenance(request: Request, call_next):
    if request.headers.get("x-maintenance") == "1":
        return JSONResponse({"statusCode": 503, "message": "维护中", "error": "Service Unavailable"}, status_code=503)
    return await call_next(request)
```

> 注意：**短路返回不会经过异常处理器**（没抛异常），所以错误体要自己拼成契约形状。

---

## 6. CORS：跨域到底在拦什么

### 6.1 同源策略

| 同源判定 | 协议 + 域名 + 端口 三者全同 |
| --- | --- |
| `http://localhost:3000` → `http://localhost:8000` | ❌ 端口不同 = 跨域 |
| `https://a.com` → `https://a.com/api` | ✅ 同源 |

> 浏览器**限制的是读取响应**，不是「请求发不出去」。这就是为什么「后端日志里有请求，前端却报 CORS 错」。

### 6.2 简单请求 vs 预检请求

| 类型 | 条件 | 浏览器行为 |
| --- | --- | --- |
| **简单请求** | `GET`/`HEAD`/`POST` + 仅安全头 + `Content-Type` 限于三类 | 直接发，检查响应头 |
| **预检请求** | 其余（自定义头、`PUT`/`DELETE`、`application/json`） | 先发 `OPTIONS`，通过后才发真请求 |

预检往返：

```
OPTIONS /api/apps
Origin: http://localhost:3000
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, authorization

← 200 OK
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Max-Age: 600
```

> `application/json` 的 POST 在多数浏览器里会触发预检——这是「前端一发 JSON 就 CORS 报错」的常见原因。

### 6.3 四个关键响应头

| 响应头 | 作用 |
| --- | --- |
| `Access-Control-Allow-Origin` | 允许的来源（不能是 `*` 且带凭据） |
| `Access-Control-Allow-Methods` | 允许的方法 |
| `Access-Control-Allow-Headers` | 允许的请求头 |
| `Access-Control-Expose-Headers` | 允许前端**读取**的自定义响应头 |
| `Access-Control-Allow-Credentials` | 允许携带 Cookie |

> 容易漏的是 **`expose_headers`**：后端加了 `x-total-count`，前端却读不到——因为默认只暴露简单响应头。

---

## 7. `CORSMiddleware` 参数

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["x-request-id", "x-total-count"],
    max_age=600,
)
```

| 参数 | 说明 | 注意 |
| --- | --- | --- |
| `allow_origins` | 白名单 | 生产**禁止** `["*"]`（若带凭据） |
| `allow_origin_regex` | 正则匹配（如预览环境） | 谨慎，别写太宽 |
| `allow_credentials` | 允许 Cookie/Authorization | 与 `*` 冲突 |
| `allow_methods` | 允许方法 | `["*"]` 会放开全部 |
| `allow_headers` | 允许请求头 | `["*"]` |
| `expose_headers` | 前端可读的自定义响应头 | 常漏 |
| `max_age` | 预检缓存秒数 | 大一点减少 OPTIONS |

### 7.1 `*` 与 `allow_credentials` 的冲突（高频坑）

CORS 规范：**`Access-Control-Allow-Origin: *` 不允许与凭据同时使用**。

| 配置 | 浏览器行为 |
| --- | --- |
| `allow_origins=["*"]` + `allow_credentials=False` | ✅ 可用（但不能带 Cookie） |
| `allow_origins=["*"]` + `allow_credentials=True` | ❌ 被拒（规范禁止） |
| `allow_origins=["http://localhost:3000"]` + `allow_credentials=True` | ✅ 正确做法 |

> 需要带 Cookie/凭据时，必须**列具体来源**（或用 `allow_origin_regex`）。这是「本地好好的，一上线就 CORS 失败」的经典原因。

### 7.2 项目现状解读

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

| 观察 | 评价 |
| --- | --- |
| `allow_origins=["*"]` | 本地前后端分端口（3000/8000）联调最省事 |
| 未设 `allow_credentials` | 默认 `False`，所以 `*` 合法 |
| 未设 `expose_headers` | 若前端要读自定义头，会读不到 |
| 注释写「阶段 0 直接放开」 | 明确是**开发期策略** |

生产建议：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,          # ["https://app.example.com"]
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["authorization", "content-type", "x-request-id"],
    expose_headers=["x-request-id"],
    max_age=600,
)
```

> 鉴权用 `Authorization: Bearer`（不是 Cookie）时，`allow_credentials` 其实可以不开——**凭据指 Cookie/TLS 客户端证书**，Bearer 头只要在 `allow_headers` 里放行即可。

---

## 8. `lifespan`：应用的生命周期

### 8.1 为什么需要

| 资源 | 创建时机 | 释放时机 |
| --- | --- | --- |
| 数据库引擎/连接池 | 启动一次 | 关闭时 dispose |
| `httpx.AsyncClient` | 启动一次 | 关闭时 `aclose()` |
| Redis 连接 | 启动一次 | 关闭时断开 |
| 加载模型/词表 | 启动一次 | 无需释放 |

放在模块级 import 里创建有两个问题：**无法优雅关闭**、**测试时难以替换**。

### 8.2 写法

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # ---- startup ----
    print("启动：建连接池 / 加载模型")
    app.state.started_at = time.time()

    yield                                    # ← 服务运行期间

    # ---- shutdown ----
    print("关闭：释放资源")
    await close_http_client()


app = FastAPI(lifespan=lifespan)
```

| 位置 | 时机 | 能做什么 |
| --- | --- | --- |
| `yield` 之前 | 服务器开始接收请求**之前** | 建池、预热、加载 |
| `yield` 之后 | 收到关闭信号、处理完在途请求**之后** | 关闭连接、flush 日志 |

> 重要：`yield` 之后的代码**在正常关闭时执行**；进程被 `kill -9` 时不会执行——所以关键数据仍要及时落盘。

### 8.3 `app.state` 存共享对象

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=30)
    yield
    await app.state.http.aclose()


@app.get("/proxy")
async def proxy(request: Request):
    client: httpx.AsyncClient = request.app.state.http
    return (await client.get("https://example.com")).json()
```

| 方式 | 评价 |
| --- | --- |
| `app.state.xxx` | ✅ 推荐，随 app 走，测试可替换 |
| 模块级全局变量 | ⚠️ 可用，但测试隔离差 |
| 每次请求新建 | ❌ 连接不复用（[02-异步/03](../02-异步与并发/03-异步实战模式.md) §6） |

### 8.4 与 `@app.on_event` 的差异

```python
@app.on_event("startup")        # ⚠️ 已弃用
async def startup(): ...

@app.on_event("shutdown")       # ⚠️ 已弃用
async def shutdown(): ...
```

| 对比 | `on_event` | `lifespan` |
| --- | --- | --- |
| 状态 | 弃用（DeprecationWarning） | ✅ 官方推荐 |
| 资源作用域 | 两个独立函数，靠全局变量传递 | 同一个上下文，变量天然共享 |
| 异常处理 | startup 失败行为不明确 | 单点可控 |
| 测试 | 难替换 | 可传入不同 lifespan |

> 看到 `on_event` 就应改写成 `lifespan`——尤其是有多个资源需要按顺序初始化时。

### 8.5 给项目加 lifespan（具体改法）

```python
# app/main.py
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import httpx
from fastapi import FastAPI

from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.http = httpx.AsyncClient(
        base_url=settings.llm_base_url,
        timeout=settings.llm_timeout_ms / 1000,
    )
    try:
        yield
    finally:
        await app.state.http.aclose()


app = FastAPI(
    title="mini-dify api-py",
    version=settings.version,
    default_response_class=UTF8JSONResponse,
    lifespan=lifespan,
)
```

| 收益 | 说明 |
| --- | --- |
| LLM/嵌入调用复用连接池 | 少一次 TLS 握手 |
| 关闭时释放 | 不留半开连接 |
| 测试可替换 | 可注入 mock client |

> 注意 `try/finally` 包住 `yield`：即使 `yield` 期间有异常，也能保证 `aclose()` 执行。

---

## 9. 常见中间件组合与顺序

```python
app.add_middleware(CORSMiddleware, ...)          # ① 最先注册 → 最内层？
```

等等——顺序容易记反，直接给结论表：

| 注册顺序 | 实际执行（请求方向） |
| --- | --- |
| 先 CORS，后 Timing | Timing → CORS → 路由 |
| 先 Timing，后 CORS | CORS → Timing → 路由 |

推荐组合（**希望 CORS 处理最早、日志能看到一切**）：

```python
app.add_middleware(TimingMiddleware)       # 后注册 → 最外层，记录最全
app.add_middleware(CORSMiddleware, ...)    # 先注册 → 内层，尽早处理预检
```

| 中间件 | 建议位置 |
| --- | --- |
| CORS | 靠近外层（预检不进入业务） |
| 日志/耗时 | 最外层（覆盖全部耗时） |
| `request_id` | 最外层（后续所有日志都能拿到） |
| 压缩 | 内层（只压业务响应） |
| 限流 | 外层（尽早拒绝） |

---

## 10. 与 NestJS 对照

| FastAPI | NestJS | 说明 |
| --- | --- | --- |
| `@app.middleware("http")` | `implements NestMiddleware` + `configure()` | 函数式 vs 类式 |
| `add_middleware` | `consumer.apply(Mw).forRoutes('*')` | 注册与作用范围 |
| 注册顺序倒序 | 按 `apply` 顺序执行 | ⚠️ **顺序语义相反** |
| 纯 ASGI 中间件 | 原生 `(req, res, next)` | 更底层 |
| `CORSMiddleware` | `app.enableCors({...})` | 一致 |
| `allow_credentials` | `credentials: true` | 一致 |
| `lifespan` | `OnModuleInit` / `OnApplicationShutdown` | 生命周期 |
| `app.state` | DI 容器中的 provider | 共享对象 |
| `@app.on_event` | `OnApplicationBootstrap` | 已弃用 vs 现行 |

> 最容易踩的差异：**NestJS 中间件按 `configure()` 里的顺序执行，FastAPI 按注册的倒序执行**。迁移时很容易把日志放到最内层。

---

## 11. 验收自测

### 11.1 判断执行顺序

```python
app.add_middleware(A)
app.add_middleware(B)
app.add_middleware(C)
```

请求先经过谁？

<details>
<summary>答案</summary>

**C**（最后注册的在最外层），然后 B、A，最后路由。响应顺序相反：A → B → C。

</details>

### 11.2 找错

```python
@app.middleware("http")
async def auth(request: Request, call_next):
    user = get_current_user(request)      # 直接调用依赖函数
    if user is None:
        return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)
```

三个问题：

1. 中间件里**不能用 `Depends`**，直接调依赖函数会缺参数（`get_current_user` 需要 `db`）；
2. 错误体不是契约信封；
3. 鉴权逻辑做在中间件里，无法按路由放行（公开接口也被拦）。

正确做法：用 `Depends(get_current_user)` 放在路由或 router 级。

### 11.3 动手题

写一个 `lifespan`：启动时创建 `httpx.AsyncClient` 存到 `app.state.http`，关闭时 `aclose()`；并加一个 `/ping` 接口用它请求 `https://example.com`（只读状态码）。

<details>
<summary>参考</summary>

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.http = httpx.AsyncClient(timeout=10)
    try:
        yield
    finally:
        await app.state.http.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/ping")
async def ping(request: Request):
    client: httpx.AsyncClient = request.app.state.http
    resp = await client.get("https://example.com")
    return {"status": resp.status_code}
```

</details>

---

## 12. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 中间件顺序和预期相反 | 注册倒序 | 记住「后注册在外层」 |
| 前端报 CORS，后端日志有请求 | 缺响应头 / 预检未通过 | 检查 `allow_origins` 与 `OPTIONS` |
| 带 Cookie 时 CORS 失败 | `*` + `allow_credentials` | 列具体来源 |
| 前端读不到 `x-total-count` | 未设 `expose_headers` | 加暴露头 |
| 预检每次都发 | `max_age` 为 0 | 设 `max_age=600` |
| 视图读不到 body | 中间件里 `await request.body()` 消费了流 | 用纯 ASGI 包装 `receive`，或不在中间件读体 |
| 中间件里 `Depends` 报错 | 依赖解析发生在之后 | 改路由/依赖实现 |
| 中间件改不了响应体 | body 已发送 | 只改头/状态码 |
| 短路响应的错误形状不对 | 未走异常处理器 | 手动拼契约信封 |
| 流式响应被缓冲 | `BaseHTTPMiddleware` | 纯 ASGI 中间件 |
| `lifespan` 不执行 | 用了 `app = FastAPI()` 但没传 `lifespan=` | 传参或在装饰器里注册 |
| 关闭时资源没释放 | 只写了 `yield` 后代码但异常路径跳出 | `try/finally` 包住 `yield` |
| `on_event` 报弃用警告 | 旧 API | 改 `lifespan` |
| 多 worker 下 lifespan 执行多次 | 每个进程各自启动 | 预期行为，资源要按进程算 |
| 生产 `allow_origins=["*"]` | 复制了开发配置 | 改白名单 |

---

## 13. 本篇小结

- **洋葱模型**：请求正序、响应逆序；只有包住 `call_next` 才能同时看到两端。
- **`add_middleware` 后注册的在最外层**（与 NestJS 相反，迁移必踩）。
- **`@app.middleware("http")` = `BaseHTTPMiddleware`**：方便但有流式/性能限制，SSE 场景用纯 ASGI。
- **中间件不能 `Depends`、拿不到路由参数**；它适合横切关注点（日志、`request_id`、CORS、限流）。
- **CORS 拦的是「读取响应」**；`application/json` 的 POST 通常触发预检。
- **`allow_origins=["*"]` 不能与 `allow_credentials` 同用**；要带 Cookie 必须列具体来源。
- **`expose_headers` 常被漏**：自定义响应头默认前端读不到。
- **`lifespan` 取代 `on_event`**：`yield` 前建资源、后释放，用 `try/finally` 保证清理。
- **共享对象放 `app.state`**，别用模块级全局（测试隔离差）。
- **多 worker 下 lifespan 每进程各执行一次**，连接池上限要按进程数换算。
- **项目现状**：CORS 全开是开发期策略（未开 `allow_credentials`，所以合法）；缺 lifespan，建议按 §8.5 加上 `httpx.AsyncClient` 的创建与关闭。
- **下一步**：APIRouter 分层与项目结构——router / service / schema 怎么拆。
