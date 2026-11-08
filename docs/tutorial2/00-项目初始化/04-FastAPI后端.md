# 04 · FastAPI 后端

> 阶段 0 · 第 4 步
>
> 做完：`apps/api-py` 启动在 `:8000`，`GET /health` 与 NestJS 返回同一形状。
>
> **本篇面试考点**：ASGI 与 uvicorn · pydantic-settings · Pydantic 运行期校验 · 时区与序列化 · `Depends`。

---

## 1. Python 项目配置

**完整文件路径：`apps/api-py/pyproject.toml`**

```toml
[project]
# 包名：uv 用它标识这个项目
name = "mini-dify-api-py"
# 应用版本：与契约、api-ts 对齐
version = "0.1.0"
description = "mini-dify Python 后端（FastAPI），与 api-ts 实现同一份契约。"
# Python 版本下限：低于 3.12 时 uv 直接拒绝
requires-python = ">=3.12"
dependencies = [
    # Web 框架：路由、依赖注入、请求校验
    "fastapi>=0.115.0",
    # ASGI 服务器：真正跑 FastAPI 的进程
    "uvicorn[standard]>=0.30.0",
    # 数据校验与序列化：对应 TS 侧的 interface + class-validator
    "pydantic>=2.9.0",
    # 把环境变量读成带类型的配置对象
    "pydantic-settings>=2.5.0",
]

[dependency-groups]
# 开发依赖：只在本地/CI 用，不进入生产安装
dev = [
    # 代码检查与格式化
    "ruff>=0.6.0",
]
```

> `uv sync` 会生成 `uv.lock`（锁文件）与 `.venv/`（虚拟环境）；这两个都不手写。
> 阶段 0 还没有数据库，所以 SQLAlchemy / psycopg 先不装，阶段 1 再接。

> **面试考点 · ASGI 和 WSGI 有什么区别？uvicorn 在链路里干什么？**
>
> - **WSGI**：同步接口，`app(environ, start_response)`，一个请求占一个线程/进程；Flask/Django 传统部署常见。
> - **ASGI**：异步接口，`async def app(scope, receive, send)`，支持 WebSocket、SSE、长连接；FastAPI 是 ASGI 框架。
> - **uvicorn**：ASGI 服务器，负责监听端口、解析 HTTP、把请求交给 FastAPI；`--reload` 是开发期文件监听，生产不用。
> - **并发模型**：`async def` 路由在事件循环里跑，适合 IO 等待；同步阻塞代码（如 `requests`、`time.sleep`）会堵住事件循环，要么改异步客户端，要么用 `def` 让 FastAPI 丢进线程池。
>
> **追问：生产为什么常用 `uvicorn --workers N` 或 gunicorn + uvicorn worker？**
> 单进程只用一个 CPU 核；多 worker 才能吃满多核。但内存里的状态（本地缓存、内存会话）不会在 worker 间共享，要放 Redis/DB。

---

## 2. 配置

**完整文件路径：`apps/api-py/app/__init__.py`**

```python
"""api-py 的 Python 包根；有这个文件，`app.xxx` 才能被 import。"""
```

**完整文件路径：`apps/api-py/app/config.py`**

```python
"""应用配置（pydantic-settings）。

环境变量名大小写不敏感：`service_name` 对应 `SERVICE_NAME`。
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 当前文件是 apps/api-py/app/config.py：
# parent = app/，parent.parent = apps/api-py/，也就是项目目录
_PROJECT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """全部配置项集中在这里，类型与默认值就是「文档」。"""

    model_config = SettingsConfigDict(
        # 固定从 apps/api-py/.env 读；与启动时的工作目录无关
        env_file=_PROJECT_DIR / ".env",
        # .env 里出现本类没声明的键时忽略，不报错
        extra="ignore",
    )

    # 服务标识：/health 返回给调用方，用来区分两套后端
    service_name: str = "api-py"
    # 服务版本：与 pyproject.toml、契约保持一致
    version: str = "0.1.0"
    # 监听端口：读 PORT，未配置时 8000
    port: int = 8000


# 模块级单例：全项目 import 这一个对象即可
settings = Settings()
```

> **面试考点 · `pydantic-settings` 和 `os.getenv` 差在哪？**
>
> - **类型转换**：`port: int` 会把字符串 `"8000"` 转成整数；`os.getenv` 永远返回 `str | None`，类型错误留到运行期才炸。
> - **集中声明**：配置项、默认值、类型都在 `Settings` 一处；`os.getenv` 散落各处，改一个变量要全局搜。
> - **`.env` 加载**：`env_file` 指定文件，路径用 `Path(__file__)` 算绝对路径，避免「从哪个目录启动就读哪个 .env」的坑。
> - **大小写不敏感**：`service_name` 默认读 `SERVICE_NAME`；`extra="ignore"` 让 `.env` 里多余的键不报错。
> - **不写回 `os.environ`**：`Settings` 只负责读取；后续代码必须用 `settings.xxx`，不能再 `os.getenv("PORT")`。
>
> **追问：配置校验失败什么时候发生？**
> `settings = Settings()` 在 import 时执行，所以缺必填项/类型错会在**进程启动阶段**直接抛错，属于「快速失败」，比请求进来才 500 好。

---

## 3. 时间格式

**完整文件路径：`apps/api-py/app/timefmt.py`**

```python
"""时间序列化：把 datetime 归一成契约要求的 UTC + 毫秒 + Z。"""

from datetime import datetime, timezone


def iso_z(value: datetime) -> str:
    """返回形如 2026-11-08T12:34:56.789Z 的字符串。

    - value 不带时区时，按 UTC 解释（naive datetime 不猜测本地时区）
    - 统一转成 UTC，避免 +08:00 与 Z 两种写法导致契约测试失败
    - timespec="milliseconds"：固定三位毫秒，正好 24 个字符
    """
    # 没有时区信息：直接贴上 UTC，避免 astimezone 按系统本地时区换算
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)

    # 先转 UTC，再输出毫秒精度；最后把 +00:00 换成 Z
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
```

> **面试考点 · naive datetime 和 aware datetime 有什么区别？**
>
> - **naive**：`datetime.now()` 不带 `tzinfo`，表示「某个时区的时间」但不知道是哪个；跨时区/跨机器一定出问题。
> - **aware**：`datetime.now(timezone.utc)` 带 `tzinfo`，能正确换算；契约要求统一 UTC，序列化时才能稳定输出 `Z`。
> - **`isoformat()` 的坑**：UTC aware 时间默认输出 `+00:00` 而不是 `Z`；契约要求 24 字符，所以用 `timespec="milliseconds"` + 替换后缀。
> - **数据库存储**：PostgreSQL 用 `timestamptz` 存 aware 时间；ORM 读出来若是 naive，要在边界统一按 UTC 处理。
>
> **追问：为什么不用本地时间？**
> 服务器可能部署在不同时区，用户也分布在不同时区；内部统一 UTC，展示层再按用户时区格式化，是唯一不会漂移的做法。

---

## 4. 健康检查路由

**完整文件路径：`apps/api-py/app/api/__init__.py`**

```python
"""API 路由层（FastAPI 的「控制器」）。"""
```

**完整文件路径：`apps/api-py/app/api/health.py`**

```python
"""GET /health —— 契约见 packages/contract/openapi.yaml。"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, field_serializer

from app.config import settings
from app.timefmt import iso_z

# 路由分组：本文件只放健康检查；tags 会显示在 /docs 里
router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """对应契约 components.schemas.HealthResponse。"""

    model_config = ConfigDict(
        # 多传字段直接报错：与 openapi 的 additionalProperties=false 对齐
        extra="forbid",
    )

    # 固定为 ok：Literal 在运行期校验，不只是类型提示
    status: Literal["ok"]
    # 服务标识：api-ts 或 api-py
    service: str
    # 服务版本
    version: str
    # 内部用 datetime 表示，输出时由下面的序列化器转成契约字符串
    time: datetime

    @field_serializer("time")
    def _serialize_time(self, value: datetime) -> str:
        """把 datetime 字段序列化成 UTC + 毫秒 + Z。"""
        return iso_z(value)


@router.get(
    "/health",
    # 声明响应模型：FastAPI 会按它校验返回值并生成 /docs
    response_model=HealthResponse,
    # operationId 与 openapi.yaml、NestJS 保持一致
    operation_id="getHealth",
)
async def get_health() -> HealthResponse:
    """返回服务健康状态。"""
    return HealthResponse(
        # 能执行到这里就说明进程活着
        status="ok",
        # 读配置而不是硬编码，部署时可通过 .env 改
        service=settings.service_name,
        # 同上
        version=settings.version,
        # 带时区的当前 UTC 时间
        time=datetime.now(timezone.utc),
    )
```

> **面试考点 · 同样是「类型」，Pydantic 和 TypeScript interface 差在哪？**
>
> - **TS interface 编译后消失**，只能约束写代码的人；Pydantic 模型在运行期真实存在，构造/解析时会逐字段校验。
> - **`Literal["ok"]`**：运行期只允许 `"ok"`，传 `"error"` 直接 `ValidationError`；对应 TS 的字面量类型，但 TS 只在编译期生效。
> - **`extra="forbid"`**：多传字段直接报错，和 OpenAPI 的 `additionalProperties: false` 对齐；默认是 `ignore`，会悄悄丢掉多余字段。
> - **`response_model`**：FastAPI 按模型过滤输出字段、做序列化、生成 `/docs`；返回模型外的字段会被裁掉（或按配置报错）。
> - **`field_serializer`**：把内部 `datetime` 转成契约要求的字符串；模型内部保留类型，出口统一格式。
>
> **追问：Pydantic v2 为什么快？**
> 核心校验用 Rust 实现（pydantic-core），模型构建时生成校验器；比 v1 的纯 Python 校验快数倍。代价是部分 v1 写法（`Config` 类、`validator`）要迁移到 `model_config`、`field_validator`。
>
> **追问：`response_model` 和直接返回 dict 的区别？**
> dict 不校验、不过滤，字段多了少了都没人管；`response_model` 在出口做一次校验与序列化，保证响应永远符合契约。

---

## 5. 入口

**完整文件路径：`apps/api-py/app/main.py`**

```python
"""FastAPI 入口（api-py）。

契约来源：packages/contract/openapi.yaml
本服务所有接口都必须与 api-ts 行为一致。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.config import settings

# 创建应用；title/version 会显示在自动生成的 /docs 页面
app = FastAPI(title="mini-dify api-py", version=settings.version)

# 跨域：前端 :3000 调 :8000，开发阶段允许所有来源
app.add_middleware(
    CORSMiddleware,
    # 允许的来源；* 表示任意
    allow_origins=["*"],
    # 允许的方法；* 表示 GET/POST/PATCH/DELETE 全放开
    allow_methods=["*"],
    # 允许的请求头；* 表示 Authorization / Content-Type 等全放开
    allow_headers=["*"],
)

# 注册路由：把 /health 挂到应用上
app.include_router(health_router)

# 直接 `python -m app.main` 时启动 uvicorn（pnpm dev:api-py 走的就是这里）
if __name__ == "__main__":
    import uvicorn

    # reload=True：改代码自动重启，开发期使用
    # 端口从 settings 读（PORT，默认 8000）
    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.port, reload=True)
```

> **面试考点 · FastAPI 的依赖注入（`Depends`）是什么？**
>
> - **声明式依赖**：`def endpoint(db: Session = Depends(get_db))`，FastAPI 在调用前执行 `get_db`，把返回值注入参数；请求结束自动执行 `yield` 之后的清理（关连接）。
> - **可复用**：鉴权 `get_current_user`、分页参数、数据库会话都写成依赖；路由只声明「我需要什么」，不关心怎么构造。
> - **缓存**：同一请求内同一个依赖默认只执行一次（`use_cache=True`），多个参数复用同一份结果。
> - **APIRouter**：按模块拆路由，`include_router` 汇总；`prefix` / `tags` 在挂载时统一，避免所有路径写在一个文件里。
> - **阶段 0 还没用到**：现在只有 `/health`，不依赖数据库；阶段 1 的 `get_db`、`get_current_user` 就是典型依赖。
>
> **追问：`async def` 和 `def` 路由怎么选？**
> 内部全是异步 IO（asyncpg、httpx）用 `async def`；内部是同步阻塞库（requests、同步 ORM）用 `def`，FastAPI 会把它放进线程池，避免堵事件循环。混用阻塞调用 + `async def` 是最常见的性能事故。

---

## 6. 安装依赖并启动

```powershell
# 在仓库根执行：按 pyproject.toml 建 .venv 并安装依赖（首次会生成 uv.lock）
uv sync --directory apps/api-py

# 启动 FastAPI（根 package.json 里的脚本）
pnpm dev:api-py
```

预期终端输出：

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Application startup complete.
```

另开终端：

```powershell
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json
```

预期：

```json
{
  "status": "ok",
  "service": "api-py",
  "version": "0.1.0",
  "time": "2026-11-08T12:34:56.789Z"
}
```

---

## 7. 与 NestJS 对比

```powershell
# 两套后端同时开着时，对比字段名集合
$a = Invoke-RestMethod http://localhost:3001/health
$b = Invoke-RestMethod http://localhost:8000/health
Compare-Object ($a.PSObject.Properties.Name | Sort-Object) ($b.PSObject.Properties.Name | Sort-Object)

# 对比时间戳长度：都应为 24
$a.time.Length
$b.time.Length
```

`Compare-Object` 无输出 = 字段名完全一致。

| 检查项 | 预期 |
| --- | --- |
| `uv sync --directory apps/api-py` | 生成 `.venv/` 与 `uv.lock`，无报错 |
| `pnpm dev:api-py` | `Uvicorn running on http://127.0.0.1:8000` |
| `GET /health` | 200，四个字段齐全 |
| `service` | `api-py` |
| `time` | 24 个字符，以 `Z` 结尾 |
| 与 NestJS 的字段名对比 | 无差异 |

下一步：前端页面 + 双后端切换 → [05-NextJS前端与验收.md](./05-NextJS前端与验收.md)
