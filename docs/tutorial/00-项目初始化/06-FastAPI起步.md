# 06 · FastAPI 起步

> 所属：阶段 0 · 项目初始化
> 本篇覆盖：`apps/api-py` 从零跑通 `GET /health` —— `pyproject.toml` / `config.py` / `db.py` / `api/health.py` / `main.py`
> **本篇首次教学：Python 类型注解 · Pydantic v2 · pydantic-settings · APIRouter · uvicorn · CORSMiddleware · uv 项目化管理**
> （后续笔记遇到这些技术只引用，不再重讲）

---

## 1. 本篇目标

- 让 Python 后端 `apps/api-py` 能被启动、能对外提供服务。
- 实现契约中的第一个接口 **`GET /health`**，返回体与 `packages/contract/openapi.yaml` 的 `HealthResponse` **逐字段一致**。
- **理解 FastAPI 这套技术各自在干什么**：它和 NestJS 是「同一件事的两种语言实现」。

**验收标准**：在 `apps/api-py` 目录执行启动命令后，访问 `http://localhost:8000/health` 得到：

```json
{"status":"ok","service":"api-py","version":"0.1.0","time":"2026-10-18T02:22:24.920Z"}
```

- `status` 固定 `"ok"`；
- `service` 为 `"api-py"`（对照 api-ts 会是 `"api-ts"`）；
- `version` 为 `"0.1.0"`；
- `time` 是 ISO-8601 UTC 时间戳（毫秒精度、以 `Z` 结尾）。现已统一为 UTC 毫秒 `Z`（阶段 2 收口）。

字段名、数量、取值都必须和契约一致（契约见 `00-项目初始化/04-契约包与TypeScript类型.md`）。

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| `uv` 与 Python 3.12 | 阶段 0 · 01（环境准备） |
| 仓库根工作区 / `pnpm-workspace.yaml` | 阶段 0 · 03（monorepo 与 pnpm workspace） |
| 契约真源 `packages/contract/openapi.yaml` | 阶段 0 · 04（契约包与 TypeScript 类型） |

> 阶段 0 · 02（本地中间件 PostgreSQL）**不是本步必需**。`/health` 不读写数据库；`db.py` 里的 `create_engine(...)` 只是**创建引擎对象，不会立即建立连接**，所以数据库没起也能跑通健康检查。

---

## 3. 先看清要做什么

目标目录（只列与本篇相关的文件；`.venv/` 由 uv 生成，不入库）：

```
apps/api-py/
├── pyproject.toml          # 项目 + 依赖声明（Python 的「package.json」）
├── uv.lock                 # 锁定整棵依赖树（Python 的「pnpm-lock.yaml」）
├── .venv/                  # uv 创建并维护的虚拟环境（不提交）
└── app/                    # 我们的应用包
    ├── __init__.py         # 让 app/ 成为一个 Python 包
    ├── config.py           # 配置：从环境变量 / .env 读取
    ├── db.py               # 数据库接入（本步只创建引擎，不连接）
    ├── main.py             # 入口：创建 FastAPI 应用、挂中间件、挂路由
    └── api/                # 路由层（≈ NestJS 的 Controller）
        ├── __init__.py
        └── health.py       # GET /health
```

**为什么要这么分**：契约（04 篇）规定两套后端行为一致，所以 Python 侧也按「配置 / 接入 / 入口 / 路由」分层——和 NestJS 侧的 Config/Module/Controller 结构一一对应，方便对照阅读。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | **仓库根** | 让 uv 按 `pyproject.toml` 创建 `apps/api-py/.venv` 并装齐依赖（含 dev 组） | 首次安装 **34 个包** |
| `uv run uvicorn app.main:app --reload --port 8000` | **`apps/api-py` 目录** | 启动开发服务器，监听 **8000** | 打印 `Uvicorn running on http://127.0.0.1:8000` |
| `curl http://127.0.0.1:8000/health`（或浏览器打开） | 任意 | 验证接口 | 返回上面那段 JSON |

> 根目录脚本 `pnpm dev:api-py` 已修正为 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`。它**用 `--directory` 把工作目录切到 `apps/api-py`**，因此从仓库根执行也能找到 `app` 包、正常启动。这与手动 `cd apps/api-py` 后再跑 uvicorn 等价。详见第 9 节的坑表。

---

## 5. 完整代码

### 5.1 `apps/api-py/pyproject.toml`

**完整文件路径：`apps/api-py/pyproject.toml`**

```toml
[project]
name = "mini-dify-api-py"
version = "0.1.0"
description = "mini-dify Python 后端（FastAPI + SQLAlchemy 2.0），与 api-ts 实现同一份契约。"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.5.0",
    "email-validator>=2.2.0",
    "sqlalchemy>=2.0.30",
    "psycopg[binary]>=3.2.0",
    "pyjwt>=2.9.0",
    "bcrypt>=4.2.0",
]

[dependency-groups]
dev = [
    "httpx>=0.27.0",
    "pytest>=8.3.0",
    "ruff>=0.6.0",
]
```

**逐项解释**

- `[project]`：PEP 621 定义的标准项目元数据区，相当于 `package.json` 的 `name`/`version`/`dependencies`。
- `name = "mini-dify-api-py"`：本项目**不是**要发布的库，只是应用；名字带 `-api-py` 与 TS 侧区分。
- `version = "0.1.0"`：与契约 `info.version` 对齐（本项目版本口径统一为 `0.1.0`）。
- `requires-python = ">=3.12"`：约束解释器版本；实测环境为 **CPython 3.12.15**。
- `dependencies = [...]`：运行期依赖。写法 `包名>=最小版本`（PEP 508）。
  - `fastapi`：Web 框架本体；
  - `uvicorn[standard]`：ASGI 服务器，`[standard]` 是**可选依赖组**，会额外带上 `httptools`、`watchfiles`、`websockets` 等高性能组件（其中 `watchfiles` 支撑 `--reload` 热重载）；
  - `pydantic` / `pydantic-settings`：数据校验与配置读取（本篇首次教学）；
  - `email-validator`：给 Pydantic 的 `EmailStr` 用（阶段 1 注册接口会用到，此处先声明）；
  - `sqlalchemy` + `psycopg[binary]`：ORM 与 PostgreSQL 驱动（`db.py` 用到，本步不连接）；
  - `pyjwt` / `bcrypt`：JWT 与密码哈希（阶段 1）。
- `[dependency-groups] dev = [...]`：**PEP 735 依赖组**，只在开发环境需要。`uv sync` 默认会把 `dev` 组一起装上。

> **为什么用 uv 而不是 `pip install`**：见第 10.7 节。

### 5.2 `apps/api-py/app/__init__.py`

**完整文件路径：`apps/api-py/app/__init__.py`**

```python
"""mini-dify Python 后端（api-py）。

契约唯一真源：仓库根目录 `packages/contract/openapi.yaml`。
"""
```

**解释**：这个文件本身不写逻辑，它的存在使 `app/` 成为一个 **Python 包**（package）——这样 `app.config`、`app.api.health` 这类点号导入才成立。`"""..."""` 是 **模块文档字符串**（docstring），是 Python 惯用的模块说明位置。

### 5.3 `apps/api-py/app/config.py`

**完整文件路径：`apps/api-py/app/config.py`**

```python
"""应用配置（pydantic-settings）。

环境变量名大小写不敏感：`database_url` 对应 `DATABASE_URL`。
`access_token_expires_in` 由 `JWT_EXPIRES_IN`（秒）读取，默认 3600。
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# 本项目目录（apps/api-py）：无论从哪个 cwd 启动，都读这一份 .env
_PROJECT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")

    service_name: str = "api-py"
    version: str = "0.1.0"
    database_url: str = "postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify"
    # 与 TS 侧保持同一密钥，双方签发的 JWT 才能互认（见总纲 §5.6）
    jwt_secret: str = "dev-jwt-secret-change-me-please"
    # 令牌有效期（秒）：读同一个 JWT_EXPIRES_IN，默认 3600
    access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")


settings = Settings()
```

**逐项解释**

| 项 | 作用 |
| --- | --- |
| `class Settings(BaseSettings)` | 继承 `pydantic-settings` 的基类，字段会自动从「环境变量 + `.env`」取值 |
| `_PROJECT_DIR = Path(__file__).resolve().parent.parent` | 从模块文件位置推导出项目目录 `apps/api-py`，供下面的 `env_file` 使用 |
| `model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")` | `env_file` 用**按 `__file__` 推导的绝对路径**指向 `apps/api-py/.env`（与启动时的 cwd 无关）；`extra="ignore"` 表示环境里多出来的变量不报错 |
| `service_name: str = "api-py"` | 有默认值 → 环境里没配就用它；`/health` 的 `service` 字段直接来自这里 |
| `version: str = "0.1.0"` | 同一个版本口径，`/health` 的 `version` 来自这里 |
| `access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")` | 字段名不再是环境变量名——用 `validation_alias` 显式绑定到 `JWT_EXPIRES_IN`（秒），默认 3600 |
| `settings = Settings()` | **模块级单例**：任何 `from app.config import settings` 拿到的都是同一个实例 |

> ⚠️ `env_file` 现是**按 `__file__` 推导的项目目录绝对路径**（`apps/api-py/.env`），所以**与启动时的 cwd 无关**——在仓库根用 `uv run --directory apps/api-py ...` 启动，读到的仍是 `apps/api-py/.env`，不会再受「在哪执行」影响。仓库根那个 `.env` 现在只放基础设施变量（`POSTGRES_*`，给 docker-compose 做变量替换），这份代码读不读它都无所谓。

### 5.4 `apps/api-py/app/db.py`

**完整文件路径：`apps/api-py/app/db.py`**

```python
"""数据库接入（SQLAlchemy 2.0）。

`users` 表的 DDL 由 TS 侧 Prisma 迁移拥有（见笔记「迁移所有权」）；
Python 侧只做映射与读写，不产生 DDL。
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
```

**解释**

- 本步**只是把「数据库接入」的位置先摆好**，实现留到阶段 1 · 04（会讲 SQLAlchemy 模型映射）。
- `create_engine(...)` **惰性**：构造对象时不会连接数据库，第一次真正执行 SQL 才连。所以 `/health` 不需要数据库在线。
- 连接串来自 `settings.database_url`（即 `apps/api-py/.env` 里的 `DATABASE_URL`），与 TS 侧各自的 `.env` 以及 compose 用的 `POSTGRES_*` 保持同一组用户/密码/库名。
- 「DDL 由 TS 侧 Prisma 迁移拥有」是项目约定：**迁移只能有一处**，Python 侧不建表，避免两边各建一套。

### 5.5 `apps/api-py/app/api/__init__.py`

**完整文件路径：`apps/api-py/app/api/__init__.py`**

```python
"""API 路由层（FastAPI 的「控制器」）。"""
```

**解释**：同 5.2，让 `app/api/` 成为子包，`app.api.health` 才能被导入。

### 5.6 `apps/api-py/app/api/health.py`

**完整文件路径：`apps/api-py/app/api/health.py`**

```python
"""GET /health —— 契约见 packages/contract/openapi.yaml。"""

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

**逐行解释**

- `from typing import Literal`：`Literal["ok"]` 表示「取值只能是字符串 `"ok"`」，等价于契约里的 `enum: [ok]`。
- `router = APIRouter(tags=["health"])`：建一组路由，`tags` 只影响自动生成的 OpenAPI 文档分组。
- `class HealthResponse(BaseModel)`：**Pydantic 模型**，负责校验 + 序列化（见第 10.2 节）。
- `model_config = ConfigDict(extra="forbid")`：**禁止额外字段**，等价契约里的 `additionalProperties: false`（见第 10.3 节）。
- `service: str`（不是 `Literal[...]`）：契约里 `service` 是 `string` 加 `examples`，取值可为 `api-ts` 或 `api-py`，所以用宽类型 `str`。
- `@router.get("/health", response_model=HealthResponse, operation_id="getHealth")`：
  - 装饰器注册 **GET** 方法、路径 `/health`；
  - `response_model` 让 FastAPI 用该模型**校验并序列化**返回值，同时喂给 OpenAPI；
  - `operation_id="getHealth"` 对应契约里的 `operationId`（契约测试要靠它定位接口）。
- `async def get_health() -> HealthResponse`：处理函数是**协程**（ASGI 异步），避免 I/O 阻塞事件循环；`-> HealthResponse` 是返回值类型注解（教学见第 10.1 节）。
- `time: datetime` + `@field_serializer("time")`：字段本身仍是 `datetime`，但序列化时交给 `app/timefmt.py` 的 `iso_z()`——输出 UTC、毫秒精度、以 `Z` 结尾（如 `2026-10-18T02:22:24.920Z`），正好满足契约的 `format: date-time`。现已统一为 UTC 毫秒 `Z`（阶段 2 收口）。
- 注意返回值来自 `settings`：**`service`/`version` 不在路由里硬编码**，而是走配置，便于两套后端对齐。

### 5.7 `apps/api-py/app/main.py`

**完整文件路径：`apps/api-py/app/main.py`**

```python
"""FastAPI 入口（api-py）。

契约来源：packages/contract/openapi.yaml
本服务的所有接口都必须与该契约一致，并通过契约测试与 api-ts 对齐。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.config import settings
from app.errors import register_error_handlers

app = FastAPI(title="mini-dify api-py", version=settings.version)

# 前端（localhost:3000）与后端（localhost:8000）跨域，阶段 0 直接放开。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 把 FastAPI 默认的 {detail} 归一化成契约要求的 {statusCode, message, error}
register_error_handlers(app)

app.include_router(health_router)
app.include_router(auth_router)
```

**逐行解释**

- `app = FastAPI(title=..., version=...)`：创建应用对象。`title`/`version` 只是文档元信息，`version` 取 `settings.version`。
- `app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)`：**跨域中间件**（见第 10.5 节），前端 `:3000` 才能调后端 `:8000`。
- `register_error_handlers(app)` + `auth_router`：这两项属于**阶段 1**（错误信封归一化、认证），此处一并出现，与 04 篇里 `openapi.yaml` 已经包含 `/auth/*` 的情况一致。本步只关心 `health_router`。
- `app.include_router(router)`：把 `APIRouter` 挂到应用上，路由才生效（见第 10.4 节）。

---

## 6. 第一步：同步依赖（`uv sync`）

**命令（在仓库根执行）**

```bash
uv sync --project apps/api-py
```

**目的**：让 uv 按 `apps/api-py/pyproject.toml` 创建 `apps/api-py/.venv`，并把运行依赖 + `dev` 组一并装好。

**预期输出（首次，节选）**

```
$ uv sync --project apps/api-py
Using CPython 3.12.15
Creating virtual environment at: apps/api-py/.venv
Resolved 34 packages
Installed 34 packages
 + fastapi==0.143.3
 + pydantic==2.14.1
 + sqlalchemy==2.1.5
 + psycopg==3.3.6
 ...
```

**要点**

- 首次**共装 34 个包**；之后依赖没变再执行会显示 `Audited N packages`（什么都没做）。
- 实际解析到的版本（`fastapi 0.143.3`、`sqlalchemy 2.1.5`、`pydantic 2.14.1`、`psycopg 3.3.6`）都**高于** `pyproject.toml` 里的最小版本要求——这是正常的：最小版本只是下限，真实版本由 `uv.lock` 锁定。
- `uv.lock` 会自动生成/更新，**要提交进仓库**，保证所有人装到同一批版本。

---

## 7. 第二步：启动服务

**命令（必须先进 `apps/api-py` 目录）**

```bash
cd apps/api-py
uv run uvicorn app.main:app --reload --port 8000
```

**目的**：用项目环境里的 uvicorn 启动 FastAPI 应用，监听 **8000**，`--reload` 让改代码后自动重启。

**预期输出**

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [...] using WatchFiles
INFO:     Started server process [...]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

命令里 `app.main:app` 的读法：`app.main` 是**模块路径**（`app/` 包下的 `main.py`），冒号后的 `app` 是**该模块里的变量名**（`main.py` 里 `app = FastAPI(...)`）。三者同名纯属巧合，别混淆。

---

## 8. 验收自测

**方式 A：浏览器**

打开 <http://localhost:8000/health>

**方式 B：命令行**

```bash
curl http://127.0.0.1:8000/health
```

**预期结果**

```json
{"status":"ok","service":"api-py","version":"0.1.0","time":"2026-10-18T02:22:24.920Z"}
```

（`time` 每次请求都会变，格式恒为 UTC 毫秒 `Z`，例如 `2026-10-18T02:22:24.920Z`。）

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 依赖就位 | `uv sync --project apps/api-py` | 首次装 34 包，无报错 |
| 服务启动 | 在 `apps/api-py` 下 `uv run uvicorn app.main:app --port 8000` | 打印 `Uvicorn running on http://127.0.0.1:8000` |
| 健康检查 | `curl http://127.0.0.1:8000/health` | 返回上文 JSON |
| 字段与契约一致 | 人工比对 `openapi.yaml#/components/schemas/HealthResponse` | `status/service/version/time` 四字段一一对应 |
| 文档可访问 | 打开 <http://localhost:8000/docs> | FastAPI 自动生成的 Swagger UI |

---

## 9. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **不在 `apps/api-py` 目录启动**（最重要） | 启动即报 `ModuleNotFoundError: No module named 'app'` | `uvicorn app.main:app` 里的 `app` 是**相对当前工作目录**解析的包。在仓库根执行时，`sys.path` 里没有 `apps/api-py`，自然找不到 `app`。**解决：先 `cd apps/api-py`**（或用 `--app-dir apps/api-py` 显式指定） |
| 根脚本 `dev:api-py` 曾经直接失败（已修正） | 早期在仓库根跑 `pnpm dev:api-py` 会 `No module named 'app'` | 旧脚本是 `uv run --project apps/api-py uvicorn app.main:app ...`。`--project` 只解决「用哪个 `.venv`/依赖」，**不会切换工作目录**，于是 `app` 包不在 `sys.path` 中。**已修正为 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`**：`--directory` 会把工作目录切到 `apps/api-py`，`app` 包自然可被导入。等价做法仍是进 `apps/api-py` 手动启动 |
| 端口被占 | `[Errno 10048] error while attempting to bind on address ... 8000` | 8000 已被占用（上次没退干净）。查占用进程并结束，或换端口 `--port 8001` |
| 以为要起数据库 | 担心没跑 Docker 就起不来 | `/health` 不访问数据库；`create_engine` 是惰性的。数据库留到阶段 1 |
| 改了 `.env` 不生效 | 配置还是默认值 | `env_file` 现是按 `__file__` 推导的**绝对路径**，始终读 `apps/api-py/.env`，与启动时 cwd 无关；但 `Settings()` 在模块导入时构造一次，改完要重启进程。（根 `.env` 现在只放基础设施变量，读不读都无所谓） |
| 额外字段混进响应 | 契约测试报「多字段」 | 模型默认允许额外字段。本项目的响应模型统一加 `ConfigDict(extra="forbid")` |

---

## 10. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 0 · 06」并直接使用。

### 10.1 Python 类型注解（type annotation）

**是什么**：Python 是动态类型语言（变量不绑定类型），但它提供了**可选的类型标注**语法，写在冒号后面：

```python
age: int = 30
name: str = "mini-dify"
enabled: bool = True

def add(a: int, b: int) -> int:
    return a + b

def get_health() -> HealthResponse:   # 返回值类型
    ...
```

**和 TS 的关键区别**（对照 04 篇 §9.5）：

| | TypeScript | Python |
| --- | --- | --- |
| 注解在运行期 | **被擦除**，拿不到 | **保留**：可在运行期读取（`__annotations__`、`typing.get_type_hints`） |
| 能否校验外部数据 | ❌ 不能 | ✅ 能（Pydantic 正是靠这个读注解来自建校验器） |

这就是为什么**同一份契约**在 TS 侧只能手写 `interface`（仅编译期），而在 Python 侧可以直接写成**会真正校验**的 Pydantic 模型。

**基本语法**

| 写法 | 含义 |
| --- | --- |
| `str` / `int` / `bool` | 基本类型 |
| `list[str]` / `dict[str, int]` | 泛型容器（PEP 585 内置写法） |
| `str \| None` | 联合类型（等价 `Optional[str]`） |
| `Literal["ok"]` | **字面量类型**：只能是 `"ok"` |
| `-> T` | 函数返回类型 |

**本例为什么这么用**

- `status: Literal["ok"]`：契约要求 `enum: [ok]`，用 `Literal` 在运行期就能挡住别的取值。
- `service: str`：契约允许 `api-ts` 或 `api-py`（是 examples 而非 enum），所以用宽类型 `str`。
- `async def ... -> HealthResponse`：既声明是协程，又标注返回类型（对 FastAPI 的文档与静态检查都有用）。

### 10.2 Pydantic v2 `BaseModel`（运行期校验 + 序列化）

**是什么**：Pydantic 用「继承 `BaseModel` 的类 + 类型注解」定义一个**数据模型**，它同时是：
1. **运行期校验器**——构造对象时检查字段是否存在、类型是否对、有无多余字段；
2. **序列化器**——`.model_dump()` / `.model_dump_json()` 把对象转成 dict / JSON。

**基本语法**

```python
from pydantic import BaseModel, ConfigDict

class User(BaseModel):
    id: int
    name: str

u = User(id=1, name="bob")      # 校验通过
User(id="abc", name="bob")      # ❌ 抛 ValidationError（"abc" 不是 int）
```

**在本项目中的角色**（它到底替我们干了什么）：

- `HealthResponse` 模型 = 契约 `HealthResponse` 的 Python 版**可执行**表达；
- 路由上写 `response_model=HealthResponse` 后，FastAPI 会拿返回值**按模型校验并序列化**，再输出 JSON——字段多一个、少一个、类型不对都会暴露出来；
- 它还会根据模型自动生成 `/docs` 里的 OpenAPI schema，让文档与实现不会脱节。

> 对照：TS 侧的 `interface HealthResponse`（04 篇 §9.3）**只在编译期存在、不能校验**，所以在 NestJS 里要额外装 `class-validator`/`ValidationPipe` 才能做运行期校验；Pydantic 把「类型」和「校验器」合成了一个东西。

### 10.3 `ConfigDict(extra="forbid")` —— 锁死字段集合

```python
class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ...
```

- `model_config` 是 Pydantic v2 的**模型级配置入口**（v1 的 `class Config` 已废弃）。
- `extra` 控制「模型里没声明的字段」怎么处理：

| 取值 | 行为 |
| --- | --- |
| `'ignore'`（默认） | 多余字段**静默丢弃** |
| `'allow'` | 多余字段**保留**并一起序列化 |
| `'forbid'` | 多余字段**直接报错** |

**为什么用 `'forbid'`**：契约里每个 schema 都写了 `additionalProperties: false`（见 04 篇 §7）。响应多出字段 = 契约违约，所以这里必须 `forbid`，让违约在运行期立刻被抓住。

### 10.4 `APIRouter` —— 路由分组（≈ NestJS Controller）

**是什么**：把同一类接口的路由收拢到一个 `APIRouter`，再统一挂到 `FastAPI` 应用上，避免所有路由都堆在入口文件里。

**基本语法**

```python
from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["auth"])

@router.get("/me")          # 最终路径 = prefix + "/me" = "/auth/me"
async def me(): ...
```

**本例为什么这么用**

- `health.py` 里 `router = APIRouter(tags=["health"])`（无 `prefix`，所以路径就是 `/health`）；
- 装饰器 `@router.get(...)` 注册方法与路径；
- `main.py` 里 `app.include_router(health_router)` 把它接入应用——**不 include 就不会生效**。
- `operation_id="getHealth"` 直通契约的 `operationId`，契约测试据此定位。

**与 NestJS 对照**：`APIRouter` ≈ `@Controller`，`@router.get` ≈ `@Get`，`include_router` ≈ 在 Module 里注册 Controller。

### 10.5 `CORSMiddleware` —— 跨域

**是什么**：浏览器有**同源策略**——`http://localhost:3000` 的页面默认不许读取 `http://localhost:8000` 的响应（端口不同即不同源）。CORS（跨源资源共享）是服务端「**显式允许**某些来源访问」的机制。

**基本语法**

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # 允许的来源
    allow_methods=["*"],       # 允许的方法
    allow_headers=["*"],       # 允许的请求头
)
```

**本例为什么这么用**：阶段 0 前端要直连两套后端，图省事全放开（`"*"`）。**生产必须收窄**成白名单。更重要的：**跨域是浏览器行为，用 curl 测不会触发**——所以 07 篇前端页面能拿到数据，前提就是这里放开了 CORS。

### 10.6 uvicorn —— ASGI 服务器

**是什么**：FastAPI 本身只定义「如何处理请求」（一个 ASGI 应用对象），**不负责监听 TCP 端口**。真正对外服务的是 ASGI 服务器，本例用 **uvicorn**。

**基本语法**

```bash
uvicorn <模块:对象> [--host H] [--port P] [--reload]
```

- `<模块:对象>`：`app.main:app` 表示「导入 `app.main` 模块，取其中名为 `app` 的属性」。
- `--reload`：监听文件变化自动重启，**仅开发用**。
- `--host`（默认 `127.0.0.1`）、`--port`（默认 `8000`）。

**为什么分成两层**：这样应用可被不同服务器承载（uvicorn / hypercorn 等），也便于测试（用 ASGI 测试客户端直接打应用，不起服务器）。启动日志里的 `Started server process` / `Waiting for application startup` 就是 uvicorn 的。

### 10.7 uv 项目化管理（`pyproject.toml` + `uv.lock` + `.venv`）

**是什么**：uv 是 Rust 写的一体化 Python 工具（下载解释器、建虚拟环境、装依赖、跑命令）。它用**项目**为单位管理依赖：

| 文件 / 目录 | 类比 TS 侧 | 作用 |
| --- | --- | --- |
| `pyproject.toml` | `package.json` | 声明项目与依赖（含下限） |
| `uv.lock` | `pnpm-lock.yaml` | 锁定整棵依赖树的精确版本 |
| `.venv/` | `node_modules/` | 项目私有的隔离环境 |

**常用命令**

```bash
uv sync --project apps/api-py              # 按 pyproject/lock 建 .venv 并装齐
uv run --directory apps/api-py <命令>       # 切到项目目录后执行命令（如启动 uvicorn）
uv add --project apps/api-py <包>          # 加依赖
```

> `--project` 指定「用哪个项目」，`--directory` 则连**工作目录**一起切过去——所以从仓库根执行 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000` 才能正确导入 `app` 包。

**为什么用它**（而不是 `pip install` + 手建 venv）：

- **快**：解析/安装比 pip 快得多；
- **可复现**：`uv.lock` 保证所有人、所有机器装到同一批版本；
- **一体**：解释器版本（`requires-python`）+ 虚拟环境 + 依赖 + 执行命令，一条命令搞定，不污染全局 Python。

**本例的用法**：`uv sync --project apps/api-py` 在仓库根执行一次即可（`--project` 指向 Python 项目）；之后所有 Python 命令都应通过 `uv run` 执行——要么进**项目目录内**执行，要么用 `uv run --directory apps/api-py` 从仓库根执行（根的 `dev:api-py` 脚本即采用后者），这样才会用上这份 `.venv`。

---

## 11. 与 api-ts 的对照（读代码时对照着看）

| 概念 | NestJS（api-ts） | FastAPI（api-py） |
| --- | --- | --- |
| 入口 | `main.ts` bootstrap | `app/main.py` 的 `app` 对象 |
| 路由分组 | `@Controller` + Module | `APIRouter` + `include_router` |
| 单条路由 | `@Get('health')` | `@router.get('/health')` |
| 运行期校验 | `class-validator` + `ValidationPipe` | Pydantic `BaseModel` |
| 配置 | `@nestjs/config` | `pydantic-settings` |
| 依赖管理 | pnpm + `package.json` | uv + `pyproject.toml` |
| 服务器 | Node（`@nestjs/platform-express`） | uvicorn |

两套实现同一份契约（见 04 篇），**响应结构必须逐字段一致**。

---

## 12. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| Python 类型注解 / `Literal` | **首次教学于本篇** |
| Pydantic v2 `BaseModel`（运行期校验 + 序列化） | **首次教学于本篇** |
| `ConfigDict(extra="forbid")` 与 `additionalProperties: false` 的对应 | **首次教学于本篇** |
| pydantic-settings（`BaseSettings` / `SettingsConfigDict`） | **首次教学于本篇** |
| `APIRouter` 与 `include_router` | **首次教学于本篇** |
| uvicorn（ASGI 服务器 / `模块:对象` / `--reload`） | **首次教学于本篇** |
| `CORSMiddleware` 与跨域 | **首次教学于本篇** |
| uv 项目化管理（`pyproject.toml` + `uv.lock` + `.venv`） | **首次教学于本篇** |
| Python 包与 `__init__.py` | **首次教学于本篇** |
