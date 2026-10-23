# 01 · HTTP 与 ASGI/WSGI

> 所属：阶段 4 · Web 基础与 FastAPI 起步
> 本篇覆盖：HTTP 请求/响应模型（方法、状态码、头、体）、幂等与安全语义、REST 资源命名、从 TCP 到框架的分层、WSGI 协议（`app(environ, start_response)`）、WSGI 的同步瓶颈、ASGI 协议（`scope`/`receive`/`send` 三元组）、`http`/`websocket`/`lifespan` 三种 scope、WSGI 与 ASGI 对照、手写一个最小 ASGI 应用、uvicorn 的职责与进程模型、`--reload`/`--workers` 的区别
> **本篇首次教学：HTTP 方法与幂等/安全语义、状态码五组分类与选码规则、REST 资源命名约定、WSGI 调用协议与「一请求一线程」的并发模型、ASGI 三元组协议（`scope`/`receive`/`send`）、`http`/`websocket`/`lifespan` 三类 scope、ASGI 中间件的洋葱结构（预告阶段 5/04）、手写 ASGI 应用并用 uvicorn 运行、uvicorn 是「ASGI 服务器」而非框架、`--reload`（开发）与 `--workers`（多进程）不可混用的原因**
> 预告：下一篇讲 FastAPI 第一个应用——`FastAPI()`、自动文档、最小可运行服务与启动链路。

> 项目锚点：`apps/api-py/app/main.py`（真实文件：`FastAPI()` 实例、CORS、错误处理器、8 个 router 挂载、`__main__` 里 `uvicorn.run`）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 说清一次 HTTP 请求从 TCP 字节流到「框架里的一个函数调用」经历了什么。
2. 正确选择状态码（201 / 204 / 400 / 401 / 403 / 404 / 409 / 422 / 500）。
3. 解释 WSGI 为什么撑不住大量长连接，而 ASGI 可以。
4. 手写一个 20 行的 ASGI 应用，并用 uvicorn 跑起来。
5. 说清 uvicorn 与 FastAPI 的分工（服务器 vs 框架）。
6. 解释 `--reload` 与 `--workers` 为什么不能同时用。

**验收标准**

- 能用 `curl` 打出 4 种方法并解释响应状态码含义。
- 能画出 ASGI 的 `scope/receive/send` 调用关系。
- 能说出「FastAPI 本身不会监听端口」这句话为什么是对的。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [02-异步与并发/02 asyncio 核心](../02-异步与并发/02-asyncio核心.md)（事件循环、协程）、[03-工程化/01 pyproject](../03-工程化/01-pyproject与依赖管理.md)（`uv run`） |
| 已掌握 | 函数、类、`async def`、异常 |

---

## 3. HTTP 速览

### 3.1 一次请求长什么样

```http
POST /api/apps HTTP/1.1
Host: localhost:8000
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{"name": "我的应用", "description": ""}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{"id": "a1", "name": "我的应用"}
```

| 组成 | 请求 | 响应 |
| --- | --- | --- |
| 起始行 | 方法 + 路径 + 版本 | 版本 + 状态码 + 原因短语 |
| 头 | `Host`/`Authorization`/`Content-Type` | `Content-Type`/`Content-Length`/`Set-Cookie` |
| 体 | JSON / 表单 / 文件 | JSON / HTML / 二进制 |

> **无状态**：HTTP 本身不记得上一个请求。所谓「登录状态」靠 Cookie / Token 在每次请求里重传——这是理解鉴权的起点（阶段 7）。

### 3.2 方法与语义

| 方法 | 用途 | 安全（不改数据） | 幂等（重复调用结果相同） |
| --- | --- | --- | --- |
| `GET` | 读取资源 | ✅ | ✅ |
| `HEAD` | 只要响应头 | ✅ | ✅ |
| `POST` | 创建 / 触发动作 | ❌ | ❌（重复提交会创建多条） |
| `PUT` | 全量替换 | ❌ | ✅ |
| `PATCH` | 局部更新 | ❌ | ⚠️ 取决于实现 |
| `DELETE` | 删除 | ❌ | ✅（第二次删已不存在的，仍应 404/204） |

两个词必须分清：

| 概念 | 含义 | 为什么要管 |
| --- | --- | --- |
| **安全** | 不改服务端状态 | 允许浏览器/爬虫预取 |
| **幂等** | 调用 1 次与 N 次效果相同 | **决定能否安全重试**（见 [02-异步/03 §4.4](../02-异步与并发/03-异步实战模式.md)） |

> `POST` 不幂等，所以「网络超时后自动重试下单」必须依赖幂等键，而不是盲目重试。

### 3.3 状态码五组

| 组 | 含义 | 常用码 |
| --- | --- | --- |
| `1xx` | 信息 | `100 Continue`、`101 Switching Protocols`（WebSocket 升级） |
| `2xx` | 成功 | `200` `201` `204` |
| `3xx` | 重定向 | `301` `302` `304` `307` |
| `4xx` | **客户端**错误 | `400` `401` `403` `404` `405` `409` `422` `429` |
| `5xx` | **服务端**错误 | `500` `502` `503` `504` |

选码速查：

| 场景 | 码 | 说明 |
| --- | --- | --- |
| 查询成功 | `200` | 有响应体 |
| 创建成功 | `201` | 一般带 `Location` 头 |
| 删除成功且无内容 | `204` | **不能有响应体** |
| 参数格式错（JSON 解析失败） | `400` | 请求本身坏了 |
| 字段校验失败 | `422` | FastAPI/Pydantic 默认（语义化「能解析但不合法」） |
| 未登录 / Token 无效 | `401` | 附 `WWW-Authenticate` |
| 已登录但无权限 | `403` | 与 401 严格区分 |
| 资源不存在 | `404` | 也可能是「无权查看」的伪装 |
| 方法不支持 | `405` | 附 `Allow` 头 |
| 冲突（重名/并发改） | `409` | 唯一约束冲突常用 |
| 限流 | `429` | 附 `Retry-After` |
| 未预期异常 | `500` | **不要**把堆栈返回给客户端 |
| 上游超时 | `504` | 网关视角 |

> 项目实践：mini-dify 的错误信封统一为 `{statusCode, message, error}`，由 `app/errors.py` 把 FastAPI 默认的 `{detail}` 归一化——这正是「状态码语义 + 统一响应体」的组合。

### 3.4 REST 资源命名

| 做法 | 例子 | 评价 |
| --- | --- | --- |
| 名词复数 | `GET /api/apps` | ✅ |
| 资源嵌套 | `GET /api/apps/{id}/graph` | ✅ 从属关系 |
| 动词化路径 | `POST /api/createApp` | ❌ 用方法表达动作 |
| 动词化但确实非 CRUD | `POST /api/runs/{id}/cancel` | ✅ 动作型端点可接受 |
| 深层嵌套超两层 | `/a/{a}/b/{b}/c/{c}/d` | ⚠️ 考虑扁平化 + 查询参数 |

> 判断标准：**路径描述「资源」，方法描述「动作」**；实在不是 CRUD（如「运行」「取消」），用子资源 + `POST` 表达。

---

## 4. 从 TCP 到框架

### 4.1 分层

```
TCP 字节流
   ↓  服务器解析：请求行 / 头 / 体（HTTP 协议）
Python 字典/对象（method, path, headers, body）
   ↓  框架：路由匹配 → 调用视图函数
你的 async def 函数
   ↓  返回
状态码 + 头 + 体
   ↓  服务器序列化
TCP 字节流
```

关键结论：

| 角色 | 负责 |
| --- | --- |
| **服务器**（uvicorn / gunicorn / nginx） | 监听端口、解析 HTTP、管理连接与进程 |
| **协议层**（WSGI / ASGI） | 定义「服务器怎么调用应用」的标准接口 |
| **框架**（FastAPI / Django / Flask） | 路由、参数解析、校验、序列化、文档 |

> 所以「FastAPI 不会监听端口」是对的：`app` 只是一个可调用对象，**必须由服务器来调用它**。

---

## 5. WSGI：同步时代的接口

### 5.1 协议长什么样

```python
def app(environ, start_response):
    start_response("200 OK", [("Content-Type", "text/plain; charset=utf-8")])
    return [b"hello"]           # 返回「字节串的可迭代对象」
```

| 参数/返回 | 含义 |
| --- | --- |
| `environ` | 一个大字典：`REQUEST_METHOD`、`PATH_INFO`、`wsgi.input`、`HTTP_*` 头… |
| `start_response(status, headers)` | 由**应用**回调，告诉服务器「状态码与头定了」 |
| 返回值 | 可迭代的 `bytes`（可流式产出） |

Django、Flask 都跑在 WSGI 上。

### 5.2 它的并发模型与瓶颈

```
一个请求 → 占用一个线程/进程 → 处理完才释放
```

| 后果 | 说明 |
| --- | --- |
| 同步阻塞 | 视图里 `requests.get()` 会占住线程 |
| 连接不能复用给别的请求 | 一个连接 = 一个工作单元 |
| 长连接代价高 | SSE / WebSocket 会**长期占住线程** |
| 撑不住 C10K | 1 万并发连接 ≈ 1 万线程（栈内存 + 上下文切换爆炸） |

> WSGI 不是「错」，它适合「短请求 + 多进程横向扩」；但**不适合长连接与高并发 IO**。

### 5.3 一个 WSGI 应用

```python
# wsgi_app.py
def app(environ, start_response):
    path = environ["PATH_INFO"]
    if path == "/health":
        start_response("200 OK", [("Content-Type", "application/json")])
        return [b'{"status":"ok"}']
    start_response("404 Not Found", [("Content-Type", "text/plain")])
    return [b"not found"]
```

```powershell
uv add gunicorn        # Linux/macOS；Windows 用 waitress
uv run gunicorn wsgi_app:app
```

---

## 6. ASGI：协程时代的接口

### 6.1 协议长什么样

ASGI 应用是一个**异步可调用对象**，接收三个参数：

```python
async def app(scope, receive, send):
    ...
```

| 参数 | 是什么 | 谁提供 |
| --- | --- | --- |
| `scope` | 连接上下文字典（类型、路径、头、query…） | 服务器 |
| `receive` | `async def receive() -> dict`，读取事件（请求体分片、断开…） | 服务器 |
| `send` | `async def send(message: dict) -> None`，发送事件（响应开始、响应体分片） | 服务器 |

### 6.2 三种 `scope["type"]`

| 类型 | 用途 | 触发 |
| --- | --- | --- |
| `"http"` | 普通请求/响应 | 每个 HTTP 请求一次 |
| `"websocket"` | 双向长连接 | 升级请求 |
| `"lifespan"` | 应用启动/关闭 | 服务器启动、优雅退出 |

`lifespan` 的存在很关键：**它让应用能在事件循环里做「启动时建连接池 / 关闭时释放」**（阶段 5/04 展开）。

### 6.3 事件流（`http` 类型）

```
服务器 → app:   {"type": "http.request", "body": b'{"name":"x"}', "more_body": False}
app → 服务器:   {"type": "http.response.start", "status": 201, "headers": [...]}
app → 服务器:   {"type": "http.response.body", "body": b'{"id":"a1"}', "more_body": False}
```

要点：

| 要点 | 说明 |
| --- | --- |
| 请求体是**分片**的 | `more_body=True` 表示还有，需循环 `receive()` |
| 响应也是**分片**的 | 一次 `send` 一个 chunk → **SSE / 流式输出的基础** |
| 无 `Content-Length` 时可分片发送 | 触发 chunked 编码 |
| 顺序固定 | 先 `response.start`，再若干 `response.body` |

> 记住这条：**ASGI 天生支持「边算边发」**。阶段 8 的 SSE 就是把多个 `http.response.body` 陆续发出去。

### 6.4 协程带来的变化

| 维度 | WSGI | ASGI |
| --- | --- | --- |
| 调用方式 | 同步函数 | `async def` |
| 并发单元 | 线程/进程 | 协程（单线程内挂起） |
| 等待 IO 时 | 线程被占住 | 协程让出，事件循环处理别的连接 |
| 长连接 | 占线程，成本高 | 低成本挂起 |
| 流式响应 | 靠返回可迭代对象（受限） | 原生分片 `send` |
| WebSocket | 不支持（需额外扩展） | `scope["type"] == "websocket"` |
| 生态 | Flask/Django | FastAPI/Starlette/Django ASGI |

---

## 7. 手写一个最小 ASGI 应用

这一步很重要：**不借助 FastAPI**，亲手感受协议。

```python
# asgi_app.py
import json


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                print("启动：可以在这里建连接池")
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                print("关闭：释放资源")
                await send({"type": "lifespan.shutdown.complete"})
                return

    if scope["type"] != "http":
        return

    path = scope["path"]
    method = scope["method"]

    # 读取请求体（可能分片）
    body = b""
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        body += message.get("body", b"")
        if not message.get("more_body", False):
            break

    if path == "/health" and method == "GET":
        payload = {"status": "ok", "uptime": "raw-asgi"}
        status = 200
    elif path == "/echo" and method == "POST":
        payload = {"received": body.decode("utf-8", errors="replace")}
        status = 200
    else:
        payload = {"message": "not found"}
        status = 404

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json; charset=utf-8"),
            (b"content-length", str(len(data)).encode()),
        ],
    })
    await send({"type": "http.response.body", "body": data})
```

运行：

```powershell
uv run uvicorn asgi_app:app --reload --port 8000
```

验证：

```powershell
curl.exe -s http://127.0.0.1:8000/health
curl.exe -s -X POST http://127.0.0.1:8000/echo -H "Content-Type: application/json" -d '{\"a\":1}'
```

预期输出：

```
{"status":"ok","uptime":"raw-asgi"}
{"received":"{\"a\":1}"}
```

### 7.1 这个 30 行代码教了什么

| 观察 | 结论 |
| --- | --- |
| `scope` 里有 `type`/`path`/`method` | 路由需要的信息全在 `scope` |
| `await receive()` 可能多次 | 请求体是流式的 |
| 先 `start` 再 `body` | 响应是两段式 |
| `headers` 是**字节串元组列表** | ASGI 层不假设编码 |
| `lifespan` 要单独处理 | 否则服务器启动会卡住 |

> 看完这段，再看 FastAPI 就不会「玄学」了：**FastAPI 就是在 `app(scope, receive, send)` 外面套了路由、校验、序列化与文档**。

---

## 8. uvicorn 的定位

### 8.1 它是服务器

| 职责 | 说明 |
| --- | --- |
| 监听 TCP 端口 | `--host` / `--port` |
| 解析 HTTP | 请求行、头、chunked 体 |
| 驱动事件循环 | 每个进程一个 `asyncio` 循环 |
| 调用 ASGI 应用 | `await app(scope, receive, send)` |
| 处理连接生命周期 | keep-alive、超时、优雅关闭 |
| 协议升级 | WebSocket、HTTP/1.1 pipelining |

> 它**不**做：路由、参数校验、序列化、文档。这些是 FastAPI 的活。

### 8.2 `--reload` 与 `--workers`

```powershell
# 开发：文件变化自动重启（基于 watchfiles 监视文件）
uv run uvicorn app.main:app --reload

# 生产：多进程（每个进程独立事件循环，绑同一端口由内核分发）
uv run uvicorn app.main:app --workers 4
```

| 参数 | 作用 | 不能混用的原因 |
| --- | --- | --- |
| `--reload` | 监视文件、改了就重启 | 需要单进程 + 文件监视 |
| `--workers` | fork 多个 worker 进程 | 与 reload 的热重载模型冲突 |

uvicorn 会直接报错：

```
--reload and --workers are mutually exclusive
```

**进程数怎么定**：`workers ≈ CPU 核数`（IO 密集可略多，但别指望像 WSGI 那样靠进程数堆并发——ASGI 的单进程已经能扛大量并发连接）。

### 8.3 生产拓扑

```
浏览器 → nginx（TLS / 静态 / 限流）
        → uvicorn --workers N（应用）
        → PostgreSQL / Redis / LLM API
```

| 层 | 为什么需要 |
| --- | --- |
| nginx | TLS 终止、gzip、静态资源、限流、慢连接缓冲 |
| uvicorn | ASGI 应用服务器 |
| 框架 | 业务逻辑 |

> 小项目可以省掉 nginx；但只要涉及 HTTPS、上传大文件、限流，nginx 仍是最省心的方案（阶段 10 展开）。

---

## 9. 项目实战：`main.py` 的启动链路

### 9.1 真实文件（节选）

`apps/api-py/app/main.py`：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.apps import router as apps_router
from app.api.auth import router as auth_router
# ... 其余 router
from app.config import settings
from app.errors import register_error_handlers
from app.json_response import UTF8JSONResponse

app = FastAPI(
    title="mini-dify api-py",
    version=settings.version,
    default_response_class=UTF8JSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(health_router)
app.include_router(auth_router)
# ... 其余 6 个 router

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.port, reload=True)
```

### 9.2 逐段解读

| 代码 | 背后的机制 |
| --- | --- |
| `app = FastAPI(...)` | 得到一个 **ASGI 可调用对象**（Starlette 实例），同时收集路由与 OpenAPI |
| `default_response_class=UTF8JSONResponse` | 替换默认响应类，保证 `charset=utf-8` 与 api-ts 一致 |
| `add_middleware(CORSMiddleware, ...)` | 包裹 ASGI 应用（洋葱模型），处理预检 `OPTIONS` |
| `register_error_handlers(app)` | 把 `HTTPException`/`ValidationError` 映射成统一错误信封 |
| `include_router(...)` × 8 | 按业务域拆文件，`main.py` 只做「装配」 |
| `uvicorn.run("app.main:app", ...)` | **字符串导入路径**而非对象：reload 需要重新导入模块（[00-Python基础/04](../00-Python基础/04-模块、包与导入.md) §7） |

### 9.3 启动链路

```
uv run uvicorn app.main:app --port 8000
   ↓  import app.main（模块级代码执行一次 → app 单例创建）
   ↓  uvicorn 拿到 app 对象
   ↓  lifespan.startup（FastAPI 内部）
   ↓  监听 127.0.0.1:8000
   ↓  每个请求：scope/receive/send → 路由 → 依赖 → 视图 → 响应
```

关键点：

| 观察 | 含义 |
| --- | --- |
| 模块**导入时**就创建 `app` | 所以 `app = FastAPI()` 是模块级单例 |
| 导入时还会导入 8 个 router | 任何一个 router 的导入错误都会让**整个服务起不来** |
| `settings` 也在导入时读取 `.env` | 配置错误在启动阶段就暴露（[03-工程化/02](../03-工程化/02-配置与日志.md) §4） |
| `host="127.0.0.1"` | 只监听本机；容器/局域网访问需 `0.0.0.0` |

### 9.4 用 curl 验证协议层

```powershell
# 健康检查
curl.exe -i http://127.0.0.1:8000/health

# 看响应头里的 charset 与 CORS
curl.exe -i -H "Origin: http://localhost:3000" http://127.0.0.1:8000/health

# 触发 404，看错误信封
curl.exe -i http://127.0.0.1:8000/api/not-exist
```

预期看到：

| 请求 | 关键响应 |
| --- | --- |
| `/health` | `200` + `application/json; charset=utf-8` |
| 带 `Origin` | 出现 `access-control-allow-origin: *` |
| `/api/not-exist` | `404` + `{"statusCode":404,"message":...}`（而非 `{"detail":"Not Found"}`） |

> 这一步是在**协议层**验证：状态码、头、体三件套是否按契约返回。写业务之前先确认这三件事，能省掉一半联调时间。

---

## 10. 与 NestJS / Express 对照

| Python | Node/NestJS | 说明 |
| --- | --- | --- |
| ASGI | Node 的 `http.Server` 回调 | 都是「服务器调用你的函数」 |
| `scope/method` | `req.method` | 一致 |
| `receive()` 读体 | `req.on('data')` 流 | ASGI 用事件字典，Node 用流 |
| `send(response.start)` | `res.writeHead()` | 状态码 + 头 |
| `send(response.body)` | `res.write()` / `res.end()` | 分片发送 |
| uvicorn | `node server.js` / `@nestjs/platform-express` | 服务器 |
| FastAPI | NestJS `@Controller` | 框架 |
| WSGI | Express（同步回调风格） | 概念近似（都是「一个请求占一个执行单元」） |
| `--workers` | `cluster` / PM2 `instances` | 多进程 |
| `--reload` | `ts-node-dev` / `nest start --watch` | 热重载 |
| `lifespan` | `OnModuleInit` / `OnApplicationShutdown` | 生命周期钩子 |

> 心智迁移：**NestJS 的 `req`/`res` 就是 ASGI 的 `scope`/`send`**，只是 Node 把它包装成了流对象；FastAPI 的 `include_router` 就像 NestJS 的 `@Module({ controllers: [...] })` 装配。

---

## 11. 验收自测

### 11.1 选码题

| 场景 | 你选哪个码 |
| --- | --- |
| 创建应用成功 | ? |
| 删除后不想返回内容 | ? |
| Token 过期 | ? |
| 已登录但不是应用所有者 | ? |
| JSON 少了必填字段 | ? |
| 应用名重复（唯一约束） | ? |

<details>
<summary>答案</summary>

`201` / `204` / `401` / `403` / `422` / `409`

</details>

### 11.2 判断正误

1. FastAPI 启动时会自己监听端口。
2. `GET` 是安全的，也是幂等的。
3. WSGI 应用可以直接 `async def`。
4. ASGI 的响应体必须一次发完。
5. `--reload` 与 `--workers 4` 可以一起用。

<details>
<summary>答案</summary>

1. ❌ —— 监听端口的是 uvicorn/gunicorn，FastAPI 只是 ASGI 应用。
2. ✅
3. ❌ —— WSGI 是同步协议，`async def` 无法直接使用。
4. ❌ —— 可分片多次 `send`，这正是流式/SSE 的基础。
5. ❌ —— 互斥。

</details>

### 11.3 动手题

把上面手写的 `asgi_app.py` 加一个 `GET /slow`：先 `send` 响应头与第一段 `"a"`，`await asyncio.sleep(1)`，再发第二段 `"b"`，观察浏览器是「一次性」还是「分两次」收到。

<details>
<summary>参考要点</summary>

```python
await send({"type": "http.response.start", "status": 200,
            "headers": [(b"content-type", b"text/plain; charset=utf-8")]})
await send({"type": "http.response.body", "body": b"a", "more_body": True})
await asyncio.sleep(1)
await send({"type": "http.response.body", "body": b"b", "more_body": False})
```

用 `curl.exe -N http://127.0.0.1:8000/slow` 能明显看到两段间隔 1 秒到达——**这就是 SSE 的底层**。

</details>

---

## 12. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 服务起不来但没明显报错 | 导入某个 router 时异常 | 直接 `uv run python -c "import app.main"` 看堆栈 |
| 容器外访问不到 | `host="127.0.0.1"` | 容器/局域网用 `0.0.0.0` |
| 改了代码不生效 | 没开 `--reload`；或改的是未被监视的目录 | 开发加 `--reload` |
| `--reload` 下端口占用 | 上一次进程没退干净 | 杀进程 / 换端口 |
| 生产用 `--reload` | 复制了开发命令 | 生产用 `--workers` |
| `--reload` + `--workers` 报错 | 互斥 | 二选一 |
| 响应中文乱码 | 响应头没带 `charset=utf-8` | 统一响应类（项目已用 `UTF8JSONResponse`） |
| 204 却返回了 body | 协议不允许 | 204 必须空体 |
| 401 与 403 混用 | 语义不清 | 未认证 401、无权限 403 |
| CORS 预检失败 | 未允许 `OPTIONS` 或头 | 配 `CORSMiddleware` |
| 大文件上传内存暴涨 | 一次性读完 `receive` | 流式写入临时文件 |
| 长请求占用连接 | 同步阻塞在协程里 | 用 `to_thread` 或异步客户端（[02-异步/01](../02-异步与并发/01-GIL与并发模型选择.md)） |
| WebSocket 连不上 | 中间层不支持升级 | 检查 nginx `Upgrade` 头 |
| `uvicorn` 命令找不到 | 没用 `uv run` | `uv run uvicorn ...` |

---

## 13. 本篇小结

- **HTTP 三件套**：状态码、头、体；每次请求都要正确设置。
- **方法与语义**：`GET/PUT/DELETE` 幂等，`POST` 不幂等 → 决定能否重试。
- **状态码分组**：4xx 是客户端的问题，5xx 是服务端的问题；`401` vs `403`、`400` vs `422` 要分清。
- **REST 命名**：路径写资源（复数名词），动作交给方法；非 CRUD 用子资源 + `POST`。
- **分层**：服务器（uvicorn）→ 协议（ASGI）→ 框架（FastAPI）。FastAPI 不监听端口。
- **WSGI**：`app(environ, start_response)`，同步、占线程，长连接成本高。
- **ASGI**：`app(scope, receive, send)`，协程、事件字典、原生分片 → 支撑 SSE/WebSocket。
- **三种 scope**：`http` / `websocket` / `lifespan`；`lifespan` 是资源管理的入口。
- **手写 ASGI 的价值**：看清「路由、校验、序列化」都是框架加的，不是协议本身。
- **uvicorn**：ASGI 服务器；`--reload`（开发）与 `--workers`（生产）互斥。
- **项目链路**：`app.main` 在**导入时**创建单例 `app`、读取配置、装配 8 个 router——任何导入错误都会让服务起不来。
- **验证顺序**：先 `curl` 验状态码/头/体，再写业务。
- **下一步**：FastAPI 第一个应用——`FastAPI()`、`/docs`、最小可运行服务。
