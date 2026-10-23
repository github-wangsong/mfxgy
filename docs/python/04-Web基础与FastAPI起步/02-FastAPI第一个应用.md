# 02 · FastAPI 第一个应用

> 所属：阶段 4 · Web 基础与 FastAPI 起步
> 本篇覆盖：FastAPI 的三块组成（Starlette + Pydantic + ASGI 服务器）、最小可运行应用、三种启动方式、`/docs` `/redoc` `/openapi.json` 的生成链路、路径操作装饰器、返回值的序列化、`response_model` 的过滤与文档双重作用、`operation_id` 与契约对齐、自动校验与 422、`APIRouter` 拆分、`FastAPI()` 常用参数
> **本篇首次教学：`FastAPI()` 实例的组成与职责、`@app.get/post` 路径操作装饰器、把函数**返回值**自动序列化成 JSON、`response_model` 的白名单过滤与 OpenAPI 生成、`operation_id` 对应契约 `operationId`、`/docs`（Swagger UI）/`/redoc`/`/openapi.json` 的关系与自动生成原理、`APIRouter` 前缀/标签/依赖聚合、`FastAPI(title, version, default_response_class, docs_url)` 参数、`422 Unprocessable Entity` 的默认校验响应**
> 预告：下一篇讲路由、参数与响应——`Path`/`Query`/`Body`/`Header`、状态码、`response_model` 进阶。

> 项目锚点：`apps/api-py/app/api/health.py`（真实文件：`APIRouter(tags=["health"])`、`HealthResponse` 模型、`@router.get(..., response_model=..., operation_id="getHealth")`）与 `apps/api-py/app/main.py`（装配 8 个 router）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 用 6 行代码跑起一个 FastAPI 服务，并打开 `/docs` 调接口。
2. 说清 `/docs` 里的内容是从哪来的（不是手写的）。
3. 用 `response_model` 控制响应字段与文档。
4. 解释为什么传错参数会自动返回 `422` 而不是 500。
5. 用 `APIRouter` 把接口拆到不同文件。
6. 读懂项目里 `health.py` 的每一行。

**验收标准**

- 能在不写任何文档的情况下，让 `/docs` 显示正确的请求体示例。
- 能说出 `operation_id` 的作用，以及它和契约里哪个字段对应。
- 能解释「函数返回 `dict`」与「返回 Pydantic 模型」的区别。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [01 HTTP 与 ASGI/WSGI](./01-HTTP与ASGI-WSGI.md)（ASGI 三元组、uvicorn 定位） |
| 依赖 | `fastapi`、`uvicorn[standard]`、`pydantic`（已在 `apps/api-py/pyproject.toml`） |
| 已掌握 | 装饰器、类型注解、Pydantic 基础用法（能写 `class X(BaseModel)` 即可） |

---

## 3. FastAPI 是什么

### 3.1 三块拼图

```
FastAPI
├── Starlette        ← Web 部分：路由、中间件、请求/响应、WebSocket
├── Pydantic         ← 数据部分：模型、校验、序列化
└── （外部）ASGI 服务器 ← uvicorn：监听端口、驱动事件循环
```

| 层 | 提供什么 | 不提供什么 |
| --- | --- | --- |
| FastAPI | 把 Starlette + Pydantic 粘起来，用**类型注解**自动生成校验与文档 | 不监听端口、不做进程管理 |
| Starlette | ASGI 工具箱 | 不做数据校验 |
| Pydantic | 校验 + 序列化 | 不知道 HTTP |
| uvicorn | HTTP 协议 + 事件循环 | 不知道你的业务 |

> 「**FastAPI 只是一个 ASGI 应用**」这句话，是本篇所有行为的解释基础。

### 3.2 它相对 Flask/Django 的核心差异

| 维度 | Flask / Django | FastAPI |
| --- | --- | --- |
| 参数校验 | 手写 / 表单类 | 类型注解 + Pydantic |
| 文档 | 手写或插件 | **自动生成 OpenAPI** |
| 并发模型 | WSGI（同步） | ASGI（协程） |
| 类型提示 | 可选 | **一等公民** |
| 异步支持 | 有限 / 后期加入 | 原生 |

---

## 4. 最小可运行应用

### 4.1 六行代码

```python
# main.py
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
async def read_root():
    return {"message": "hello"}
```

运行：

```powershell
uv run uvicorn main:app --reload
```

打开：

| 地址 | 内容 |
| --- | --- |
| `http://127.0.0.1:8000/` | `{"message":"hello"}` |
| `http://127.0.0.1:8000/docs` | Swagger UI（可直接点「Try it out」） |
| `http://127.0.0.1:8000/redoc` | ReDoc（更适合阅读） |
| `http://127.0.0.1:8000/openapi.json` | 机器可读的 OpenAPI 文档 |

### 4.2 三种启动方式

| 方式 | 命令 | 适用 |
| --- | --- | --- |
| uvicorn 命令行 | `uv run uvicorn main:app --reload` | **开发首选** |
| 字符串模块 | `uv run python -m uvicorn main:app --port 8001` | 想换端口/参数 |
| 代码内 | `python main.py`（`__main__` 里 `uvicorn.run`） | 单文件脚本、项目用例 |

```python
# 代码内启动（项目 main.py 的做法）
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
```

> **`main:app` 的冒号含义**：`main` 是模块，`app` 是模块里的变量。uvicorn 会 `import main`，再取 `app` 属性（[00-Python基础/04](../00-Python基础/04-模块、包与导入.md) §7 讲过为什么 `--reload` 必须用字符串）。

---

## 5. `/docs` 从哪来

### 5.1 生成链路

```
你的类型注解 + 装饰器 + Pydantic 模型
        ↓  FastAPI 在启动时扫描路由
OpenAPI 3.1 schema（JSON）
        ↓  内置两个前端
/docs（Swagger UI，可交互）    /redoc（只读排版）
```

| 事实 | 说明 |
| --- | --- |
| 文档**不是**手写的 | 完全由代码推导 |
| 文档在启动时生成 | 改代码需重启（`--reload` 自动） |
| `/openapi.json` 可下载 | 可喂给代码生成器（生成前端 SDK、契约测试） |
| 生产可关闭 | `FastAPI(docs_url=None, redoc_url=None)` |

### 5.2 让文档变「有用」的两件事

```python
from fastapi import FastAPI

app = FastAPI(
    title="mini-dify api-py",
    version="0.1.0",
    description="与 api-ts 实现同一份契约",
)
```

| 参数 | 出现在 |
| --- | --- |
| `title` | `/docs` 顶部标题、`info.title` |
| `version` | `info.version` |
| `description` | `/docs` 顶部说明（支持 Markdown） |

> 再加 `response_model` 与 docstring，文档就完整了——**代码即文档**在 FastAPI 里不是口号。

---

## 6. 路径操作装饰器与返回值

### 6.1 方法对应装饰器

| HTTP 方法 | 装饰器 |
| --- | --- |
| `GET` | `@app.get("/path")` |
| `POST` | `@app.post("/path")` |
| `PUT` | `@app.put("/path")` |
| `PATCH` | `@app.patch("/path")` |
| `DELETE` | `@app.delete("/path")` |
| 全都要 | `@app.api_route("/path", methods=["GET", "POST"])` |

### 6.2 返回值怎么变成 JSON

```python
@app.get("/plain")
async def plain():
    return {"a": 1}                        # dict → JSON

@app.get("/list")
async def lst():
    return [1, 2, 3]                       # list → JSON 数组

@app.get("/none")
async def none():
    return None                            # → JSON null
```

FastAPI 用 `jsonable_encoder` 把返回值转成可序列化结构：

| 返回值 | 处理 |
| --- | --- |
| `dict` / `list` | 直接 JSON |
| Pydantic 模型 | `model_dump()` 后 JSON |
| `datetime` | ISO 8601 字符串 |
| `Enum` | 其值 |
| `None` | `null` |

> 关键：**返回类型注解不会自动校验**（`-> dict` 只是标注）。要约束响应，用 `response_model`。

---

## 7. `response_model`：白名单 + 文档

### 7.1 为什么需要它

```python
class UserOut(BaseModel):
    id: str
    name: str
    password_hash: str          # 内部字段

@app.get("/users/{uid}", response_model=UserOut)
async def get_user(uid: str):
    return {"id": uid, "name": "张三", "password_hash": "$2b$..."}
```

若返回原始对象而不设 `response_model`，**`password_hash` 会被泄露**。设了 `response_model` 后：

| 行为 | 说明 |
| --- | --- |
| **过滤** | 只输出模型声明的字段（其余丢弃） |
| **校验** | 返回值必须符合模型（不符合 → 500） |
| **文档** | `/docs` 的响应示例来自模型 |

> 项目里 `health.py` 正是这么做的：`response_model=HealthResponse`，且模型 `extra="forbid"`。

### 7.2 `response_model` vs 返回类型注解

| 写法 | 是否过滤 | 是否校验 | 是否进文档 |
| --- | --- | --- | --- |
| `async def f() -> dict` | ❌ | ❌ | 弱（`dict`） |
| `async def f() -> UserOut` | ⚠️（新版 FastAPI 会按注解生成 response_model） | ⚠️ | ✅ |
| `@app.get(..., response_model=UserOut)` | ✅ | ✅ | ✅ |

> 推荐显式写 `response_model`——**不依赖版本行为**，意图更清楚。

### 7.3 `response_model_exclude_unset` 等开关

```python
@app.get("/u", response_model=UserOut, response_model_exclude_none=True)
```

| 参数 | 效果 |
| --- | --- |
| `exclude_unset=True` | 只输出调用方显式设置的字段（PATCH 场景有用） |
| `exclude_none=True` | 去掉值为 `None` 的字段 |
| `exclude_defaults=True` | 去掉等于默认值的字段 |

---

## 8. `operation_id`：与契约对齐的关键

```python
@router.get("/health", response_model=HealthResponse, operation_id="getHealth")
```

| 概念 | 在哪出现 |
| --- | --- |
| `operation_id="getHealth"` | `openapi.json` 里的 `operationId` |
| 契约文件 `packages/contract/openapi.yaml` | 手写维护的 `operationId: getHealth` |
| 前端 SDK 生成器 | 用 `operationId` 生成方法名（`getHealth()`） |

为什么项目要显式指定：

| 原因 | 说明 |
| --- | --- |
| 默认 id 由「函数名+路径」拼出，**改函数名就变** | 契约会漂移 |
| 双栈（TS/Python）必须生成**同一个** operationId | 否则契约测试失败 |
| 生成 SDK 时方法名稳定 | 前端不用跟着重命名 |

> 「契约优先」项目的核心动作：**代码里的 `operation_id` 必须等于 `openapi.yaml` 里的 `operationId`**，不一致就是契约漂移。

---

## 9. 自动校验与 422

### 9.1 不用写一行校验代码

```python
from pydantic import BaseModel

class CreateApp(BaseModel):
    name: str
    description: str = ""

@app.post("/api/apps", status_code=201)
async def create_app(payload: CreateApp):
    return {"id": "a1", **payload.model_dump()}
```

请求：

```powershell
curl.exe -X POST http://127.0.0.1:8000/api/apps -H "Content-Type: application/json" -d '{\"desc\":1}'
```

响应：

```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "name"],
      "msg": "Field required",
      "input": {"desc": 1}
    }
  ]
}
```

状态码 **`422 Unprocessable Entity`**。

### 9.2 校验发生的位置

```
请求体字节 → JSON 解析 → Pydantic 模型校验 → 你的函数
                                ↑
                        失败就 422（函数不会执行）
```

| 失败类型 | 状态码 |
| --- | --- |
| JSON 语法错误 | `422`（FastAPI 默认；也有项目改 400） |
| 缺必填字段 | `422` |
| 类型不符（`"abc"` 给 `int`） | `422` |
| 自定义校验失败（`field_validator`） | `422` |
| 业务规则失败（重名） | 自己抛 `409` |

> 这正是「类型注解被真正消费」的地方——阶段 1 说过注解默认只是元数据，**FastAPI/Pydantic 是那个消费方**。

---

## 10. `APIRouter`：按业务域拆分

### 10.1 单文件写 100 个接口的后果

| 问题 | 说明 |
| --- | --- |
| 文件巨大 | 合并冲突频繁、难以定位 |
| 无法分组 | `/docs` 里所有接口挤在一堆 |
| 无法统一前缀 | 每个路径手写 `/api/...` |
| 无法统一依赖 | 每个接口重复写鉴权 |

### 10.2 拆分写法

```python
# app/api/health.py
from fastapi import APIRouter

router = APIRouter(tags=["health"])

@router.get("/health")
async def get_health():
    return {"status": "ok"}
```

```python
# app/main.py
from app.api.health import router as health_router

app = FastAPI()
app.include_router(health_router)
```

带前缀与依赖：

```python
# app/api/apps.py
router = APIRouter(
    prefix="/api/apps",
    tags=["apps"],
    dependencies=[Depends(require_user)],      # 整组都要登录
)

@router.get("")             # → GET /api/apps
async def list_apps(): ...

@router.get("/{app_id}")    # → GET /api/apps/{app_id}
async def get_app(app_id: str): ...
```

| 参数 | 作用 |
| --- | --- |
| `prefix` | 统一路径前缀（**不要**以 `/` 结尾） |
| `tags` | `/docs` 分组 |
| `dependencies` | 整组共享依赖（鉴权、限流） |
| `responses` | 整组共享响应文档（错误码说明） |

> 项目 `main.py` 就挂了 8 个 router：health / auth / apps / graph / run / tools / kb / conversations——**一个业务域一个文件**。

---

## 11. 项目实战：`health.py` 逐行

### 11.1 真实文件（节选）

`apps/api-py/app/api/health.py`：

```python
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, field_serializer

from app.config import settings
from app.timefmt import iso_z

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """对应契约 openapi.yaml#/components/schemas/HealthResponse。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    service: str
    version: str
    time: datetime

    @field_serializer("time")
    def _serialize_time(self, value: datetime) -> str:
        return iso_z(value)


@router.get("/health", response_model=HealthResponse, operation_id="getHealth")
async def get_health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.service_name,
        version=settings.version,
        time=datetime.now(timezone.utc),
    )
```

### 11.2 每一行的用意

| 代码 | 作用 |
| --- | --- |
| `APIRouter(tags=["health"])` | `/docs` 里归到 `health` 分组 |
| `extra="forbid"` | 多传字段直接校验失败（契约严格） |
| `status: Literal["ok"]` | 文档里体现枚举只有 `"ok"` |
| `time: datetime` + `field_serializer` | 内部用 `datetime`，输出统一 `iso_z` 格式 |
| `iso_z(...)` | 与 api-ts 的 `toISOString()` 对齐（末尾 `Z`） |
| `response_model=HealthResponse` | 响应白名单 + 文档 schema |
| `operation_id="getHealth"` | 与 `openapi.yaml` 的 `operationId` 对齐 |
| `async def` | 纯内存计算，用协程无阻塞 |

### 11.3 `main.py` 的装配链路

```python
app = FastAPI(title="mini-dify api-py", version=settings.version,
              default_response_class=UTF8JSONResponse)
app.add_middleware(CORSMiddleware, ...)
register_error_handlers(app)
app.include_router(health_router)
# ... 另外 7 个
```

| 顺序 | 说明 |
| --- | --- |
| 先建 `app` | 所有 router 都挂到它上面 |
| 中间件 | 决定跨域等横切行为 |
| 错误处理器 | 统一错误信封（否则 `/health` 的 404 会是 `{detail}`） |
| 挂 router | 只做装配，不含业务 |

> **`main.py` 应该只有「装配」，没有「业务」**——这是可维护性的分水岭。

### 11.4 验证一遍文档

```powershell
curl.exe -s http://127.0.0.1:8000/health
curl.exe -s http://127.0.0.1:8000/openapi.json | Select-String "getHealth"
```

预期：

```json
{"status":"ok","service":"api-py","version":"0.1.0","time":"2026-10-23T02:11:07.123Z"}
```

`openapi.json` 里能搜到 `"operationId": "getHealth"`。

---

## 12. 与 NestJS 对照

| FastAPI | NestJS | 说明 |
| --- | --- | --- |
| `FastAPI()` | `@Module` 装配的 `NestFactory.create()` | 都生成一个应用实例 |
| `@app.get("/x")` | `@Get('x')` | 路径操作装饰器 |
| `@router.get(...)` + `include_router` | `@Controller('apps')` + `controllers: [...]` | 按域拆分 |
| `APIRouter(prefix=...)` | `@Controller('api/apps')` | 统一前缀 |
| `tags=["apps"]` | `@ApiTags('apps')` | 文档分组 |
| `response_model` | `@ApiOkResponse({ type: Dto })` + `class-transformer` | Python 端自动过滤 |
| Pydantic 校验 | `ValidationPipe` + `class-validator` | 都返回 422（Nest 默认 400） |
| `/docs`（Swagger UI） | `@nestjs/swagger` 生成的 `/api` | 都是自动文档 |
| `operation_id` | `@ApiOperation({ operationId })` | 契约对齐 |
| `Depends` | 构造函数注入 | 阶段 5/02 展开 |

> 注意差异：**NestJS 的校验默认返回 `400`，FastAPI 返回 `422`**。双栈项目必须显式约定，否则前端错误处理会不一致（mini-dify 通过 `errors.py` 统一成同一信封）。

---

## 13. 验收自测

### 13.1 找错

```python
@app.get("/users/{uid}", response_model=UserOut)
async def get_user(uid: str):
    return {"id": uid, "name": "张三", "password_hash": "..."}
```

返回结果里会不会出现 `password_hash`？

<details>
<summary>答案</summary>

不会。`response_model=UserOut` 会按模型字段**过滤**，未声明的字段被丢弃。这正是它防泄露的价值。

</details>

### 13.2 判断正误

1. `/docs` 是 FastAPI 附带的静态 HTML 文件。
2. 不写 `response_model` 也能在文档里看到响应 schema。
3. `@app.get` 装饰器的函数名会影响 `operationId`。
4. `APIRouter(prefix="/api")` 里的路径要以 `/` 开头。

<details>
<summary>答案</summary>

1. ❌ —— 页面是内置的，内容由 `/openapi.json` 动态生成。
2. ⚠️ 部分可以（若写了返回类型注解），但 `dict` 只能得到空 schema。
3. ✅ —— 默认 operationId 由函数名 + 路径拼成，所以项目显式指定 `operation_id`。
4. ❌ —— 前缀不能以 `/` 结尾，子路径写 `"/{id}"` 或以 `""` 表示前缀本身。

</details>

### 13.3 动手题

写一个 `POST /api/echo`：接收 `{"text": str, "times": int (1~5)}`，返回重复 `times` 次的文本；要求 `/docs` 里能看到请求示例、响应模型与 `422` 说明。

<details>
<summary>参考</summary>

```python
from pydantic import BaseModel, Field

class EchoIn(BaseModel):
    text: str = Field(min_length=1, description="要重复的文本")
    times: int = Field(default=1, ge=1, le=5)

class EchoOut(BaseModel):
    result: str

@app.post("/api/echo", response_model=EchoOut, status_code=200)
async def echo(payload: EchoIn) -> EchoOut:
    """把文本重复 times 次。"""
    return EchoOut(result=payload.text * payload.times)
```

`Field(ge=1, le=5)` 会同时进校验与文档（`minimum`/`maximum`）。

</details>

---

## 14. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `uvicorn main:app` 报找不到 `app` | 变量名不是 `app` | 改成 `app` 或显式 `uvicorn main:my_app` |
| 改了代码 `/docs` 不更新 | 没开 `--reload` | 开发加 `--reload` |
| `/docs` 打不开（白屏） | `docs_url` 被设为 `None`，或反向代理路径问题 | 检查配置与 `root_path` |
| 响应字段比预期多 | 没设 `response_model` | 显式设置 |
| 响应字段被意外过滤 | `response_model` 少了字段 | 补模型字段 |
| 校验失败却是 500 | 在函数内部手动解析了 body | 让 FastAPI 通过参数注入接收 |
| 传参总是 422 | 请求头缺 `Content-Type: application/json` | 补头 |
| 中文返回乱码 | 响应头无 `charset=utf-8` | 自定义 `default_response_class`（项目已做） |
| `operation_id` 重复 | 两个接口撞名 | 全局唯一，与契约一致 |
| `prefix` 结尾带 `/` | 拼出 `//` | 前缀不以 `/` 结尾 |
| 改函数名后前端 SDK 报错 | 默认 operationId 变了 | 显式指定 `operation_id` |
| 生产暴露 `/docs` | 安全考虑 | `docs_url=None, redoc_url=None` |
| 同步阻塞函数拖慢全站 | 在 `async def` 里做阻塞 IO | 改普通 `def`（FastAPI 会丢线程池）或 `to_thread`（[02-异步/01](../02-异步与并发/01-GIL与并发模型选择.md)） |
| 模型字段顺序乱 | Pydantic 保留声明顺序 | 无关紧要，前端不要依赖顺序 |

---

## 15. 本篇小结

- **FastAPI = Starlette（Web）+ Pydantic（数据）+ uvicorn（服务器）**，它自己只是 ASGI 应用。
- **六行代码就能跑**：`app = FastAPI()` + `@app.get(...)`。
- **`/docs` 不是手写的**：由类型注解与模型在启动时生成 `openapi.json`，再由内置 UI 渲染。
- **`response_model` 三件事**：过滤字段（防泄露）、校验输出、生成文档。
- **返回类型注解 ≠ 响应校验**，显式写 `response_model` 更可靠。
- **`operation_id`** 是契约对齐的锚点，必须与 `openapi.yaml` 的 `operationId` 一致。
- **校验失败返回 422**，且函数体不会执行；JSON 语法错误也归到 422（可按需改 400）。
- **`APIRouter`** 负责拆分：`prefix` / `tags` / `dependencies` / `responses`。
- **`main.py` 只做装配**：建 app、加中间件、注册错误处理器、挂 router。
- **项目范式**：`health.py` 把「契约模型 + 序列化格式 + operationId」三件事写在一个文件里，是接口文件的最小样板。
- **双栈提醒**：NestJS 默认 400、FastAPI 默认 422，必须用统一错误信封抹平。
- **下一步**：路由、参数与响应——`Path`/`Query`/`Body`/`Header`、状态码与响应进阶。
