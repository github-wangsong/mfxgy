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
[project]                                              # ≈ package.json 的顶层：项目元数据区（PEP 621）
name = "mini-dify-api-py"                              # 项目名（本项目是「应用」，不发布；带 -api-py 与 TS 侧区分）
version = "0.1.0"                                      # 项目版本，与契约 info.version 对齐（全项目统一 0.1.0）
description = "mini-dify Python 后端（FastAPI + SQLAlchemy 2.0），与 api-ts 实现同一份契约。"
requires-python = ">=3.12"                             # ≈ engines.node：解释器最低版本，低于它直接拒绝安装
dependencies = [                                       # 运行期依赖（≈ package.json 的 dependencies）
    "fastapi>=0.115.0",                                # Web 框架本体
    "uvicorn[standard]>=0.30.0",                       # ASGI 服务器；[standard] 是可选依赖组，额外带 watchfiles 以支撑 --reload
    "pydantic>=2.9.0",                                 # 运行期校验 + 序列化
    "pydantic-settings>=2.5.0",                        # 从环境变量 / .env 读配置
    "email-validator>=2.2.0",                          # 给 Pydantic 的 EmailStr 用（阶段 1 注册接口）
    "sqlalchemy>=2.0.30",                              # ORM（db.py 用到，本步不连接）
    "psycopg[binary]>=3.2.0",                          # PostgreSQL 驱动
    "pyjwt>=2.9.0",                                    # JWT（阶段 1）
    "bcrypt>=4.2.0",                                   # 密码哈希（阶段 1）
]

[dependency-groups]                                    # ≈ devDependencies 所在的容器（PEP 735）
dev = [                                                # 只在开发时需要；uv sync 默认一并装上
    "httpx>=0.27.0",                                   # 测试用 HTTP 客户端
    "pytest>=8.3.0",                                   # 测试框架
    "ruff>=0.6.0",                                     # Linter / formatter
]
```

**这段在干什么**（uv 读取这份文件的顺序）：

1. uv 先读 `[project]`：拿到项目名、版本，并检查 `requires-python`——本机解释器低于 3.12 就**直接拒绝，不往下走**。
2. 再读 `dependencies`，得到「运行期要装哪些包、各自的最低版本」这份清单。
3. 再读 `[dependency-groups] dev`，把开发期依赖也并入清单。
4. 然后结合 `uv.lock`（记录整棵依赖树的**精确**版本）算出「实际要装的版本」，由 `uv sync` 装进 `.venv`。

一句话：**这份文件不是给 Python 运行时读的，是给 uv（包管理器）读的**——它就是 Python 世界的 `package.json`。注意 `>=` 只是「下限」，真正锁死版本靠的是 `uv.lock`（见 §10.7）。

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
# 注意：这个文件里「一行可执行代码都没有」——它的存在本身就是作用
"""mini-dify Python 后端（api-py）。

契约唯一真源：仓库根目录 `packages/contract/openapi.yaml`。
"""
```

**这段在干什么**（Python 导入 `app` 包时）：解释器会先执行这个文件，但它**只有一条字符串表达式**（docstring），不定义函数、不跑逻辑。它真正的「执行效果」是让解释器认定「`app/` 是一个**包**」——只有这样，`app.config`、`app.api.health` 这类**点号导入**才成立（点号导入见 §14.8）。

**解释**：这个文件本身不写逻辑，它的存在使 `app/` 成为一个 **Python 包**（package）——这样 `app.config`、`app.api.health` 这类点号导入才成立。`"""..."""` 是 **模块文档字符串**（docstring），是 Python 惯用的模块说明位置。

### 5.3 `apps/api-py/app/config.py`

**完整文件路径：`apps/api-py/app/config.py`**

```python
"""应用配置（pydantic-settings）。

环境变量名大小写不敏感：`database_url` 对应 `DATABASE_URL`。
`access_token_expires_in` 由 `JWT_EXPIRES_IN`（秒）读取，默认 3600。
"""                                                     # ← 三引号包住的「模块文档字符串（docstring）」：本文件说明

from pathlib import Path                                # 标准库：跨平台路径操作（≈ Node 的 path 模块）

from pydantic import Field                              # 第三方：给字段加「默认值 / 别名」等元信息
from pydantic_settings import BaseSettings, SettingsConfigDict   # 第三方：Settings 基类 + 模型配置入口

# 本项目目录（apps/api-py）：无论从哪个 cwd 启动，都读这一份 .env
_PROJECT_DIR = Path(__file__).resolve().parent.parent   # __file__=本文件路径 → parent=app/ → 再 parent=apps/api-py
                                                        # 单前导下划线 `_` 是「本模块内部用、外部别碰」的约定


class Settings(BaseSettings):                           # 继承基类：字段会自动从「环境变量 + .env」取值
    model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")
                                                        # env_file 是绝对路径 → 与启动时 cwd 无关；
                                                        # extra="ignore"：环境里多出来的变量不报错

    service_name: str = "api-py"                        # 有默认值 → 环境里没配就用它；/health 的 service 来自这里
    version: str = "0.1.0"                              # 同一个版本口径；/health 的 version 来自这里
    database_url: str = "postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify"
                                                        # 数据库连接串（db.py 用它建引擎）
    # 与 TS 侧保持同一密钥，双方签发的 JWT 才能互认（见总纲 §5.6）
    jwt_secret: str = "dev-jwt-secret-change-me-please" # JWT 签名密钥（阶段 1 用）
    # 令牌有效期（秒）：读同一个 JWT_EXPIRES_IN，默认 3600
    access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")
                                                        # 字段名 ≠ 环境变量名：用 validation_alias 绑定到 JWT_EXPIRES_IN


settings = Settings()                                   # 模块级单例：任何 `from app.config import settings` 都是同一个实例
```

**这段在干什么**（按「导入这个模块」时的执行顺序）：

1. 先执行开头几条 `from ... import ...`：把 `Path`、`Field`、`BaseSettings` 等名字引进当前模块（纯导入，没副作用）。
2. 执行 `_PROJECT_DIR = Path(__file__).resolve().parent.parent`：`__file__` 是「当前这个 `.py` 文件的路径」，`resolve()` 取绝对路径，两次 `parent` 上跳两级 = `apps/api-py`。这一步**在导入时就算好了一个绝对目录**。
3. 执行 `class Settings(BaseSettings):`：只是**定义类**（还没造实例）。那行 `SettingsConfigDict(...)` 是**类的属性**，负责告诉 pydantic-settings「去哪个 `.env` 文件找配置」。
4. 执行最后一行 `settings = Settings()`：**此刻才真正实例化**。pydantic-settings 会：先取各字段的默认值 → 再读 `.env` 文件 → 再读真实环境变量（越靠后优先级越高）→ 校验类型 → 得到 `settings`。
5. 因为它在**模块顶层**，所以**每次 `import app.config` 都会执行一次**；之后任何地方 `from app.config import settings` 拿到的都是这**同一个对象**。

→ 这正好解释一个坑：**改了 `.env` 不重启进程就不生效**（`Settings()` 只构造一次，第 9 节坑表）。

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
"""                                                     # ← 模块 docstring

from sqlalchemy import create_engine                    # 第三方：造「引擎」（连接池管理对象）
from sqlalchemy.orm import sessionmaker                 # 第三方：造「会话工厂」（按需产出 DB 会话）

from app.config import settings                         # 本项目：点号导入，取配置单例

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
                                                        # 惰性：这行只「构造对象」，不连接数据库；
                                                        # pool_pre_ping=取连接前先探活；future=True=用 2.0 风格 API

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
                                                        # 会话工厂：调用 SessionLocal() 才产出一个会话；
                                                        # autoflush=False / expire_on_commit=False 是本项目约定
```

**这段在干什么**（导入时的执行顺序）：

1. `from sqlalchemy import create_engine` / `sessionmaker`：先把两个工厂函数引进来。
2. `from app.config import settings`：触发导入 `app.config`——也就是**上一节那个模块会被执行一次**，拿到 `settings` 单例。正因为这里 import 了 config，`db.py` 才既用得上配置、又不会重复造配置。
3. `engine = create_engine(...)`：用连接串**构造引擎对象**。**关键**：这行**不连数据库**——SQLAlchemy 引擎是「惰性」的，真正第一次执行 SQL 时才建立连接。所以**没起 Postgres/Docker 也能启动服务、跑通 `/health`**。
4. `SessionLocal = sessionmaker(...)`：造一个**会话工厂**。此刻也**只是造了个工厂**，还没造会话；将来调用 `SessionLocal()` 才产出一个数据库会话（阶段 1 的 `get_db` 依赖会这么做）。

一句话：**这个模块只「摆好接线」，并不真正碰数据库**——所以它对 `/health` 是无副作用的。

**解释**

- 本步**只是把「数据库接入」的位置先摆好**，实现留到阶段 1 · 04（会讲 SQLAlchemy 模型映射）。
- `create_engine(...)` **惰性**：构造对象时不会连接数据库，第一次真正执行 SQL 才连。所以 `/health` 不需要数据库在线。
- 连接串来自 `settings.database_url`（即 `apps/api-py/.env` 里的 `DATABASE_URL`），与 TS 侧各自的 `.env` 以及 compose 用的 `POSTGRES_*` 保持同一组用户/密码/库名。
- 「DDL 由 TS 侧 Prisma 迁移拥有」是项目约定：**迁移只能有一处**，Python 侧不建表，避免两边各建一套。

### 5.5 `apps/api-py/app/api/__init__.py`

**完整文件路径：`apps/api-py/app/api/__init__.py`**

```python
# 同 app/__init__.py：内容只是说明 + 「让 app/api 成为子包」这一作用
"""API 路由层（FastAPI 的「控制器」）。"""
```

**这段在干什么**：与 `app/__init__.py` 同理——它让 `app/api/` 成为一个**子包**，`app.api.health` 才是一个能被导入的模块名（所以 `main.py` 才能写 `from app.api.health import router`）。

**解释**：同 5.2，让 `app/api/` 成为子包，`app.api.health` 才能被导入。

### 5.6 `apps/api-py/app/api/health.py`

**完整文件路径：`apps/api-py/app/api/health.py`**

```python
"""GET /health —— 契约见 packages/contract/openapi.yaml。"""   # ← 模块 docstring

from datetime import datetime, timezone                  # 标准库：datetime 类型 + timezone.utc（拿 UTC 时区）
from typing import Literal                               # 标准库：字面量类型标注用

from fastapi import APIRouter                            # 第三方：路由分组
from pydantic import BaseModel, ConfigDict, field_serializer   # 第三方：模型基类 / 模型配置 / 字段序列化钩子

from app.config import settings                          # 本项目：配置单例（service / version 来自这里）
from app.timefmt import iso_z                            # 本项目：时间格式化工具（把 datetime 输出成 ...Z）

router = APIRouter(tags=["health"])                      # 建一组路由；tags 只影响 /docs 分组，无 prefix → 路径就是 /health


class HealthResponse(BaseModel):                         # 响应模型：Pydantic 会按下面注解「运行期校验 + 序列化」
    """对应契约 openapi.yaml#/components/schemas/HealthResponse。"""

    model_config = ConfigDict(extra="forbid")            # 禁止多余字段（≈ 契约 additionalProperties:false）

    status: Literal["ok"]                                # 只能是字符串 "ok"（≈ enum: [ok]）
    service: str                                         # 普通字符串（契约允许 api-ts / api-py，故不用 Literal）
    version: str
    time: datetime                                       # 内部存 datetime 对象，到序列化时才变字符串

    @field_serializer("time")                            # 装饰器：注册「time 字段的序列化器」（装饰器=普通函数，见 §14.6）
    def _serialize_time(self, value: datetime) -> str:   # self=本模型实例；value=该字段的值；-> str 声明返回字符串
        return iso_z(value)                              # 交给 timefmt：UTC + 毫秒 + Z 结尾


@router.get("/health", response_model=HealthResponse, operation_id="getHealth")
                                                        # 装饰器：注册 GET /health；
                                                        # response_model → 用该模型校验并序列化返回值；
                                                        # operation_id → 对应契约里的 operationId（契约测试据此定位接口）
async def get_health() -> HealthResponse:                # async def：协程函数（见 §14.1）；-> HealthResponse：返回类型标注
    return HealthResponse(                               # 构造响应模型实例（此刻字段会被校验）
        status="ok",                                     # 固定 "ok"
        service=settings.service_name,                   # 来自配置（"api-py"），不硬编码
        version=settings.version,                        # 来自配置（"0.1.0"）
        time=datetime.now(timezone.utc),                 # 当前 UTC 时间（带时区信息）
    )
```

**这段在干什么**（分两个阶段）：

**阶段一 · 模块被导入时**（只执行一次）：
1. 跑完上面几条 `from ... import ...`，把 `APIRouter`、`BaseModel`、`iso_z` 等名字引进来。
2. `router = APIRouter(tags=["health"])`：**新建一个路由组对象**（还没挂到应用上）。
3. `class HealthResponse(BaseModel):`：**定义** Pydantic 模型——注意此时只是「定义类」，`status`/`service`/`version`/`time` 是**类属性上的注解**，Pydantic 读它们来建校验器。
4. `@field_serializer("time")` 把 `_serialize_time` **登记为 time 字段的序列化钩子**；`@router.get(...)` 把 `get_health` **登记为 `GET /health` 的处理函数**——这两步都只是「注册」，没人被真正调用。

**阶段二 · 收到一次 `GET /health` 请求时**：
5. FastAPI 找到已注册的 `get_health`；因为它标着 `async def`，就在**事件循环里以协程方式**调用它（见 §14.1~14.2）。
6. 函数体执行 `HealthResponse(...)`：Pydantic **当场校验**四个字段（`status` 必须为 `"ok"`、`time` 是 `datetime`…）并构造出对象。
7. `return` 该对象 → FastAPI 按 `response_model=HealthResponse` **序列化**它；序列化到 `time` 时，自动调起步骤 4 注册的 `_serialize_time` → `iso_z()` 输出 `2026-10-18T02:22:24.920Z`。
8. 最终写出 JSON，字段**恰好四个**，与契约一致。

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
"""                                                          # ← 模块 docstring

from fastapi import FastAPI                                 # 第三方：应用对象类
from fastapi.middleware.cors import CORSMiddleware          # 第三方：跨域中间件

from app.api.auth import router as auth_router              # 本项目：导入 auth 路由组，并就地改名为 auth_router
from app.api.health import router as health_router          # 同上：health 路由组（`as` 就是 TS 的 `as`）
from app.config import settings                             # 本项目：配置单例
from app.errors import register_error_handlers              # 本项目：异常处理器注册函数

app = FastAPI(title="mini-dify api-py", version=settings.version)
                                                            # 创建 ASGI 应用对象；title/version 只是文档元信息；
                                                            # 注意：此刻它「不监听任何端口」

# 前端（localhost:3000）与后端（localhost:8000）跨域，阶段 0 直接放开。
app.add_middleware(                                         # 给应用挂中间件（≈ Nest 里 app.use(...) 的位置）
    CORSMiddleware,                                         # 中间件类
    allow_origins=["*"],                                    # 允许所有来源（阶段 0 图省事；生产要收窄成白名单）
    allow_methods=["*"],
    allow_headers=["*"],
)

# 把 FastAPI 默认的 {detail} 归一化成契约要求的 {statusCode, message, error}
register_error_handlers(app)                                # 调一个普通函数来注册异常处理器（阶段 1，此处一并出现）

app.include_router(health_router)                           # 把路由组挂到应用上——不 include 就不生效（见 §10.4）
app.include_router(auth_router)                             # 阶段 1 的认证路由
```

**这段在干什么**（本模块被导入时，自上而下执行）：

1. 一组 `from ... import ...`：把 `FastAPI`、`CORSMiddleware`、各路由组、`settings`、`register_error_handlers` 引进当前模块。注意中间两行 `router as auth_router`——**导入时改名**，避免和别的 `router` 撞名。
2. `app = FastAPI(...)`：创建**应用对象**。这步**不监听端口**——它只定义「收到请求怎么处理」。监听端口是稍后 **uvicorn 的活儿**。
3. `app.add_middleware(CORSMiddleware, ...)`：给应用**挂一个跨域中间件对象**——从此每个请求进出都会经过它，给响应补上跨域头。
4. `register_error_handlers(app)`：**调用函数**把两张「异常 → 响应」的映射登记进应用（阶段 1 内容）。
5. 两条 `app.include_router(...)`：把 health、auth 两个**路由组**登记进应用——**没有这两行，前面定义的路由全都不会被匹配到**。

> **对照 uvicorn 启动**：`uvicorn app.main:app` 会「**导入** `app.main` 这个模块（于是上面 1~5 步全部执行一遍）、再取出其中的 `app` 对象」交给 uvicorn 去监听端口。所以**端口监听发生在 uvicorn 层，不在这个文件里**。

**逐行解释**

- `app = FastAPI(title=..., version=...)`：创建应用对象。`title`/`version` 只是文档元信息，`version` 取 `settings.version`。
- `app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)`：**跨域中间件**（见第 10.5 节），前端 `:3000` 才能调后端 `:8000`。
- `register_error_handlers(app)` + `auth_router`：这两项属于**阶段 1**（错误信封归一化、认证），此处一并出现，与 04 篇里 `openapi.yaml` 已经包含 `/auth/*` 的情况一致。本步只关心 `health_router`。
- `app.include_router(router)`：把 `APIRouter` 挂到应用上，路由才生效（见第 10.4 节）。

### 5.8 把上面的代码串起来：一次 `GET /health` 请求的完整链路

把 §5.1~5.7 的代码块连起来读，从「敲下启动命令」到「拿到 JSON」，顺序是这样的：

1. **`uv sync`**（§6）：uv 读 `pyproject.toml` + `uv.lock`，把依赖装进 `.venv`。
2. **敲下 `uvicorn app.main:app`**（§7）：uvicorn 用这份 `.venv` 启动，**导入模块 `app.main`**——于是 `main.py` 自上而下执行：`app = FastAPI(...)` → `add_middleware(...)` → `include_router(health_router)`。
3. **`include_router(health_router)` 会触发导入 `app.api.health`**（§5.6）：于是 `health.py` 也被执行——建好 `router`、定义 `HealthResponse`、把 `get_health` 注册为 `GET /health`。这条导入链还会顺带触发 `app.config`（§5.3，构造出 `settings` 单例）与 `app.timefmt`（§5.6 用到 `iso_z`）。
4. **uvicorn 开始监听 8000**：服务就绪。
5. **浏览器 / curl 发来 `GET /health`**：uvicorn 把请求交给 `app` → FastAPI 匹配到处理函数 `get_health`。
6. **调用 `get_health`**：它标了 `async def`，就在事件循环里跑；函数体执行 `HealthResponse(...)`，由 Pydantic 校验并构造对象；`service` / `version` 取自步骤 3 建好的 `settings`。
7. **按 `response_model=HealthResponse` 序列化**：`time` 字段交给 `_serialize_time` → `iso_z()`（§5.6）→ 输出 `...Z` 结尾的字符串。
8. **响应经过 `CORSMiddleware`**（§5.7 挂的）补上跨域头，写回 JSON。

一句话：**入口 `main.py` 负责「组装」，各 `app/api/*.py` 负责「一组路由」，`config.py` / `db.py` 负责「外部资源接线」**——这三层和 NestJS 的 Module / Controller / Config 一一对应（§13）。

---

## 6. 第一步：同步依赖（`uv sync`）

**命令（在仓库根执行）**

```bash
uv sync --project apps/api-py   # 按 apps/api-py 的 pyproject.toml + uv.lock，建 .venv 并装齐依赖（≈ pnpm install）
```

**这段在干什么**：uv 读取 `apps/api-py/pyproject.toml` 与 `uv.lock`，在 `apps/api-py/.venv/` 里**创建虚拟环境并装齐**运行依赖 + `dev` 依赖。它**不会**启动服务、也**不碰数据库**——只是把「工具和库」准备好。

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
cd apps/api-py                                        # 先切进项目目录（关键：Python 按「启动目录」解析 app 包，见 §15.1）
uv run uvicorn app.main:app --reload --port 8000      # 用项目 .venv 里的 uvicorn，导入 app.main 模块、取出其中的 app 对象
```

**这段在干什么**：`cd` 先把**工作目录**切到 `apps/api-py`；`uv run` 保证是用这份 `.venv` 在跑；`uvicorn` **导入 `app.main` 模块**（即执行 `main.py`、组装好 `app`）、取出其中的 `app` 对象，然后开始监听 8000。`--reload` 让它在文件变化时自动重启**整个进程**——仅开发用。

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
curl http://127.0.0.1:8000/health   # 向本机 8000 发一个 GET /health，并把响应体打印出来
```

**这段在干什么**：`curl` 发一个 HTTP `GET` 请求到 `/health`，打印服务器返回的 JSON。注意：**用 curl 不会触发 CORS 检查**（跨域是浏览器行为），所以这里能看到响应，并不代表前端页面不会有跨域问题。

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
age: int = 30                        # 变量 age 标注为 int（≈ TS: let age: number = 30）
name: str = "mini-dify"              # 标注为 str
enabled: bool = True                 # 标注为 bool（注意布尔字面量是 True，首字母大写）

def add(a: int, b: int) -> int:      # 参数标 : int；返回类型用 -> int（≈ TS: (a: number, b: number): number）
    return a + b

def get_health() -> HealthResponse:   # 返回值类型
    ...                               # `...` 是占位符，表示「函数体此处省略」
```

**这段在干什么**：这些都是「**给人和工具看的标注**」。Python 执行时**不会**因为你写了 `age: int` 就把值变成整数，**也不会**拦住你赋个字符串——它只是把「`int`」这条信息记进该对象/函数的 `__annotations__` 里。**只有当注解落到 Pydantic 或 `response_model` 手里**，它才被「当真」、才变成运行期校验（见 §10.2）。

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
from pydantic import BaseModel, ConfigDict       # 导入模型基类（类里声明的注解会被 Pydantic 「当真」）

class User(BaseModel):                            # 继承 BaseModel：从此这个类会「运行期校验」
    id: int                                       # 字段声明 = 校验规则
    name: str

u = User(id=1, name="bob")      # 校验通过，得到模型实例
User(id="abc", name="bob")      # ❌ 抛 ValidationError（"abc" 不是 int）
```

**这段在干什么**：
1. `class User(BaseModel)` 声明字段 `id`/`name` 的类型——Pydantic 在**定义类时**就按注解编译出一个校验器。
2. `User(id=1, name="bob")`：**构造实例时**跑校验器，逐个字段查类型/必填，通过就返回对象。
3. `User(id="abc", ...)`：`"abc"` 无法当作 `int`，校验器抛 `ValidationError`——**在运行期被拦下**，这正是 TS `interface` 做不到的（TS 类型编译期就被擦除了）。

**在本项目中的角色**（它到底替我们干了什么）：

- `HealthResponse` 模型 = 契约 `HealthResponse` 的 Python 版**可执行**表达；
- 路由上写 `response_model=HealthResponse` 后，FastAPI 会拿返回值**按模型校验并序列化**，再输出 JSON——字段多一个、少一个、类型不对都会暴露出来；
- 它还会根据模型自动生成 `/docs` 里的 OpenAPI schema，让文档与实现不会脱节。

> 对照：TS 侧的 `interface HealthResponse`（04 篇 §9.3）**只在编译期存在、不能校验**，所以在 NestJS 里要额外装 `class-validator`/`ValidationPipe` 才能做运行期校验；Pydantic 把「类型」和「校验器」合成了一个东西。

### 10.3 `ConfigDict(extra="forbid")` —— 锁死字段集合

```python
class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")   # 模型级配置：extra="forbid" → 只准出现声明过的字段，多一个就报错
    ...                                          # `...` 代表其余字段声明（此处省略）
```

**这段在干什么**：`model_config` 是**写在类顶层的配置**（不是某个字段），它统一规定这个模型「**允不允许出现没声明的字段**」。`extra="forbid"` 意味着：构造/校验时只要多出一个未声明字段，就**直接报错**——把「响应多出字段」这类契约违约在运行期当场抓住。

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
from fastapi import APIRouter                        # 导入「路由分组」类

router = APIRouter(prefix="/auth", tags=["auth"])    # 建一个路由组：公共前缀 /auth，文档分组 auth

@router.get("/me")          # 装饰器：注册 GET 方法；最终路径 = prefix + "/me" = "/auth/me"
async def me(): ...         # `...` 省略函数体；async def 表示处理函数是「协程」
```

**这段在干什么**：`APIRouter(...)` 先造一个**分组对象**；`@router.get("/me")` 是**带参数的装饰器**——它「先把 `get` 方法当函数调用、拿到一个装饰器，再把它贴到 `me` 上」，于是 `me` 被登记为「`GET /auth/me` 的处理函数」。**之后再 `include_router` 才能生效**（见 §10.4 正文与 §14.6）。

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

**这段在干什么**：`app.add_middleware(CORSMiddleware, **kwargs)` = 「**把一个已配置好的中间件对象登记进应用**」。登记之后，每个请求进入应用、每个响应发出应用，都会先经过这个中间件；`allow_origins=["*"]` 等参数就是它的配置。这一步只是「登记」，真正的跨域判断发生在**每一次请求**进出时。

**本例为什么这么用**：阶段 0 前端要直连两套后端，图省事全放开（`"*"`）。**生产必须收窄**成白名单。更重要的：**跨域是浏览器行为，用 curl 测不会触发**——所以 07 篇前端页面能拿到数据，前提就是这里放开了 CORS。

### 10.6 uvicorn —— ASGI 服务器

**是什么**：FastAPI 本身只定义「如何处理请求」（一个 ASGI 应用对象），**不负责监听 TCP 端口**。真正对外服务的是 ASGI 服务器，本例用 **uvicorn**。

**基本语法**

```bash
uvicorn <模块:对象> [--host H] [--port P] [--reload]
```

**这段在干什么**：执行这条命令时，uvicorn 先按 `<模块:对象>`（如 `app.main:app`）**导入模块 `app.main`**（于是 `main.py` 会被完整执行一遍：建好 `app`、挂中间件、include 路由），再取出里面名为 `app` 的对象；然后 uvicorn **监听 `--host`/`--port` 指定的端口**，把收到的 HTTP 请求按 ASGI 协议转交给这个对象。`--reload` 让它在文件变化时**重启整个进程**。

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

**这段在干什么**：
- `uv sync --project apps/api-py`：uv 读 `pyproject.toml`+`uv.lock`，在 `apps/api-py/.venv` 里**装齐**依赖（相当于 `pnpm install`）。
- `uv run --directory apps/api-py <命令>`：**先在 `apps/api-py` 这份 `.venv` 激活环境、并把工作目录切过去**，再执行命令——所以从仓库根也能正确导入 `app` 包。
- `uv add --project apps/api-py <包>`：给项目**加依赖**，会自动写进 `pyproject.toml` 并更新 `uv.lock`。

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

---

## 13. 与 NestJS 的对照（关键差异，逐条讲清）

> 第 11 节只给了「名字对应」；这一节把**关键差异**讲清——因为「同一件事在两边为什么做法不同」，正是最容易看不懂的地方。

| 关注点 | NestJS（api-ts） | FastAPI（api-py） | 关键差异（务必看） |
| --- | --- | --- | --- |
| 应用对象 vs 服务器 | `NestFactory.create(AppModule)` 得到应用，`app.listen(3001)` | `app = FastAPI()` 只是 ASGI 应用对象；监听端口交给 uvicorn | **Nest 里「框架」和「服务器」合二为一**（同一个进程既处理请求又监听端口）；FastAPI 把两者拆开——同一个 `app` 能被 uvicorn / hypercorn 等任意 ASGI 服务器承载 |
| 路由分组 | `@Controller('health')` 贴在**类**上，类再由 Module 登记 | `router = APIRouter(...)` 一个**对象**，再 `app.include_router(router)` | Nest 靠「装饰器 + 模块装配」；FastAPI 靠「普通对象 + 显式 include」。**FastAPI 不会自动发现路由，不 include 就不生效** |
| 单条路由 | `@Get('health')` 贴在**方法**上 | `@router.get("/health")` 贴在**普通函数**上 | FastAPI 的路由处理器是**自由函数**：不依附类、不参与构造注入 |
| 处理函数形态 | 方法几乎总是同步签名 | 可 `async def`，也可普通 `def` | **Python 区分「同步函数 / 异步函数」两种函数种类**：`async def` 在事件循环跑，`def` 被丢线程池。Node 里没有这种区分 |
| 运行期校验 | 装 `class-validator` + 挂 `ValidationPipe` | Pydantic `BaseModel`：**注解即校验规则** | TS 类型编译期被擦除，校验得另装一套；Python 注解运行期保留，Pydantic 直接拿它建校验器。另外 FastAPI 默认返回 422，本项目改成 400 对齐 |
| 依赖注入 | **构造函数**注入：`constructor(private svc: Svc)` | **函数参数**注入：`def f(x = Depends(get_x))` | Nest 按「类」注入、由容器管生命周期；FastAPI 按「函数参数」注入，粒度到函数级，`Depends` 天生就是「可组合的前置步骤」 |
| 配置 | `@nestjs/config`，`ConfigService` 注入进类 | pydantic-settings：`settings = Settings()` 模块级单例，**import 即用** | Nest 靠 DI 拿到配置；FastAPI 靠「导入模块级单例」。且它在**导入时**只构建一次，改 `.env` 要**重启**（§5.3） |
| 响应序列化 | `return` 对象 → 框架自动 JSON 化 | 路由上声明 `response_model=Model`，按模型校验并序列化 | FastAPI 把「返回值形状」写进装饰器；模型即契约的运行期表达，字段多一个/少一个/类型不对都会暴露 |
| 异常处理 | `@Catch(X)` 实现 `ExceptionFilter`，再全局注册 | `@app.exception_handler(X)` 登记一个**处理函数** | Nest 是「类实现接口」；FastAPI 是「函数 + 装饰器登记」。都能把错误归一成契约信封 |
| 中间件 / CORS | `app.enableCors()` / `app.use(...)` | `app.add_middleware(CORSMiddleware, ...)` | FastAPI 用「**类 + 关键字参数**」注册中间件；CORS 直接用现成的 `CORSMiddleware`（§10.5） |
| 程序入口 | `main.ts` 里 `bootstrap()` 调 `app.listen()` | 外部命令 `uvicorn app.main:app`；或代码末尾 `if __name__ == "__main__":` 里 `uvicorn.run(...)` | Nest 在**代码里**监听端口；FastAPI 通常由**外部命令**导入应用并监听，框架代码里不监听（§14.7） |
| 依赖管理 | pnpm + `package.json` + `node_modules` | uv + `pyproject.toml` + `.venv` | 结构上互相对应（§10.7）；但两者**导入解析规则不同**，见下一行 |
| 模块 / 导入 | `import './config'`（**按文件相对路径**） | `from app.config import settings`（**点号包路径**），且受 `sys.path`（启动目录）影响 | Node 的 import 相对**文件自身位置**解析，跟你在哪敲命令无关；Python 的 import **取决于你在哪个目录启动**（§15.1 讲透） |

**一句话总结**：Nest 是「**一个自带服务器、靠 DI 容器装配一切**的框架」；FastAPI 是「**一个只管处理请求的应用对象 + 由外部服务器托管 + 用函数参数和装饰器显式接线**的框架」。第 11 节给的是「名字对照」，这张表给的是「**为什么做法不同**」。

---

## 14. 本篇首次出现的 Python 语法

> 下列写法都是你在本项目 Python 代码里**第一次见到**的。每一条按「**是什么 → 在 TS 里对应什么 → 这里为什么这么写**」讲。
> 更完整的 Python 语言最小集（缩进、变量与 `None`、容器、推导式、函数、类、异常、上下文管理器等）见前置导学篇 `00-Python与FastAPI基础.md`；这里只讲**本阶段代码里实际出现的**。

### 14.1 `async def` / `await`

- **是什么**：`async def` 声明一个**协程函数**（协程：一种「可暂停、可恢复」的函数，是异步的基本单位）；调用它不立刻跑函数体，而是返回一个「协程对象」，要靠 `await` 或交给事件循环才被推进。`await` 表示「在这里等另一个协程完成，等待期间把控制权让出去」。
- **在 TS 里对应什么**：`async function f() { const x = await g() }`——写法一模一样，只是把 `function` 换成 `def`。
- **这里为什么这么写**：路由函数 `async def get_health()` 被 FastAPI 当作**协程**直接在事件循环里调度（`health.py`）。规则也继承 TS：**`await` 只能写在 `async def` 里**。

### 14.2 事件循环 vs 线程池（同步 `def` 路由会被丢到线程池）

- **是什么**：Python 的异步基于**事件循环（event loop）**——一个**单线程的调度器**，循环检查有没有可推进的协程，有就推进一段；凡是 `async def`、内部用 `await` 做 I/O 的函数，都排在它上面。**线程池（thread pool）**则是**一组后台工作线程**，用来跑那些「没有 `await` 的同步阻塞函数」，免得它们卡住事件循环。
- **在 TS 里对应什么**：Node 也是单事件循环，但**没有「线程池兜底同步函数」这一层**——Node 里写同步阻塞代码会直接卡住整个循环。Python/FastAPI 多了一层：**路由写成普通 `def` 时，FastAPI 自动把它丢进线程池执行**。
- **这里为什么这么写**：`health.py` 用 `async def`（几乎无 I/O）；而阶段 1 的 `apps.py` 用**普通 `def`**——因为内部是同步的 SQLAlchemy 调用（`db.get` / `db.commit`），FastAPI 会把它们放线程池跑，**既不阻塞事件循环，也不用你手写线程**。一句话：**函数体里真在 `await` 异步 I/O → 用 `async def`；否则 → 用 `def` 让 FastAPI 兜底**。（若在 `async def` 里塞同步阻塞调用，会卡住事件循环，见 §15.3。）

### 14.3 类型注解 `dict[str, Any]`

- **是什么**：`dict[str, Any]` 读作「**键为 `str`、值为任意类型 `Any` 的字典**」——PEP 585 的内置泛型写法（老写法是 `Dict[str, Any]`）。
- **在 TS 里对应什么**：`Record<string, any>`。
- **这里为什么这么写**：`app/models/app.py` 里存图数据的字段就是 `dict[str, Any]`——图的 JSON 结构在 Python 侧不深究（最终以契约为准），所以值统一用 `Any`（`Any` 需 `from typing import Any` 导入）。

### 14.4 `str | None`

- **是什么**：`str | None` 读作「**字符串 或 `None`**」，即「可空的字符串」。
- **在 TS 里对应什么**：`string | null`（注意 TS 还有 `undefined`，Python 只有 `None` 一种「没有值」）。
- **这里为什么这么写**：Pydantic 字段常用它表达「可选」——`description: str | None = Field(default=None, ...)` 表示「这个字段可以是字符串，也可以缺省为 `None`」。`|` 联合类型写法需 Python 3.10+（本项目 3.12）。

### 14.5 f-string

- **是什么**：字符串前加 `f`，字符串里的 `{表达式}` 会被**求值后替换**——即「带插值的字符串」。
- **在 TS 里对应什么**：模板字符串 `` `你好，${name}` ``。
- **这里为什么这么写**：拼通知文案、拼 SSE 数据帧时用它（如 `app/engine/events.py` 的 `f"event: {event['event']}\ndata: {payload}\n\n"`）——比用 `+` 拼接更清楚、更少括号。

### 14.6 `@router.get(...)` 装饰器（**两段式：装饰器就是普通函数**）

- **是什么**：`@` 开头的这一行叫**装饰器**。它**本质是普通函数**：`@d` 贴在 `def f` 上，完全等价于 `f = d(f)`——把函数当参数传进去、拿一个（通常被包装过的）新函数、再把名字重新指过去（更完整的解释见导学篇 §4.14）。
- **在 TS 里对应什么**：TS/Nest 的 `@Get('health')` 看着一样，但要开 `experimentalDecorators`、且是「语言 + 编译器特性」。Python 的装饰器**什么都不用开**，就是普通函数在起作用。
- **这里为什么这么写**：`@router.get("/health", response_model=..., operation_id=...)` 是**带参数的装饰器**——它是**两段式**的：先**调用** `router.get("/health", ...)` 拿到一个「真正的装饰器」，再由它去装饰下面的函数，把 `get_health` 登记为「`GET /health` 的处理器」。理解了「装饰器 = 函数」，你就能明白：这行只做「**注册**」，此刻并没人被调用。

### 14.7 `if __name__ == "__main__":`

- **是什么**：同一个 `.py` 文件**既能被别人 `import`、也能被直接运行**。每个模块都有内置变量 `__name__`：**被导入**时它等于模块名（如 `"app.main"`）；**被直接运行**时它等于字符串 `"__main__"`。所以这个判断的含义是「**如果本文件是被直接运行的，就执行下面这段**」。
- **在 TS 里对应什么**：TS 没有直接对应——一个 `.ts` 文件要么是入口、要么被 import，不会自己区分。
- **这里为什么这么写**：本项目 `apps/api-py/app/main.py` **末尾**有这么一段：

**完整文件路径：`apps/api-py/app/main.py`（末段）**

```python
if __name__ == "__main__":                                      # 只有「直接运行本文件」时才进入；被 uvicorn 导入时不进入
    import uvicorn                                              # 延迟导入：只有走到这里才需要 uvicorn
    # 端口从配置读取（PORT，默认 8000），与 api-ts 的 process.env.PORT 同规则。
    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.port, reload=True)
                                                                # 效果等价于在命令行执行 uvicorn app.main:app
```

**这段在干什么**：若你直接 `python app/main.py`（或 `uv run python app/main.py`），`__name__ == "__main__"` 成立 → 这里**主动启动 uvicorn**；若你用的是 `uvicorn app.main:app`，那是「**导入** `app.main` 模块」，`__name__` 等于 `"app.main"` ≠ `"__main__"` → 这段**被跳过**（详细对照见导学篇 §4.15）。两种启动**殊途同归**：都把 `app` 这个 ASGI 应用跑起来。

### 14.8 模块与点号导入

- **是什么**：一个 `.py` 文件 = 一个**模块**；一个含 `__init__.py` 的目录 = 一个**包**。导入用的是**点号路径**（`包.模块.成员`），不是文件路径。
- **在 TS 里对应什么**：`import { settings } from './config'`（文件相对路径）↔ `from app.config import settings`（包路径）；`index.ts`（barrel 文件）↔ `__init__.py`。
- **这里为什么这么写**：`health.py` 写 `from app.config import settings`——`app.config` 对应文件 `app/config.py`，但**要写点号、且从能解析到 `app` 包的位置开始**。这个「从哪开始解析」就是下一节 `sys.path` 的关键，也是本项目真实踩过的坑（§15.1）。

### 14.9 `pyproject.toml` / `.venv` / uv

- **是什么**：`pyproject.toml` 声明项目与依赖（≈ `package.json`）；`.venv/` 是项目**私有的隔离 Python 环境**（≈ `node_modules/`）；uv 是「下载解释器 + 建 `.venv` + 装依赖 + 跑命令」一体化的工具。
- **在 TS 里对应什么**：`package.json` + `node_modules` + pnpm。
- **这里为什么这么写**：所有 Python 命令都应走 `uv run`（保证用的是这份 `.venv`）。**关键差异**：uv 的 `--project` 只选「用哪个 `.venv`/依赖」，**不切工作目录**；而 Python 的导入又依赖工作目录——所以从仓库根启动必须用 `--directory`（见 §15.1）。框架细节见 §10.7 与 `01-环境准备.md`。

---

## 15. 写错会怎样（本阶段最容易踩的三处）

### 15.1 从错误的目录启动 → `ModuleNotFoundError: No module named 'app'`（讲透 `sys.path`）

**现象**：在**仓库根**执行 `uv run --project apps/api-py uvicorn app.main:app --reload --port 8000`，启动时直接报：

```
ModuleNotFoundError: No module named 'app'
```

**为什么**：Python 导入一个模块时，会在一个叫 **`sys.path`** 的**目录列表**里逐个查找。`sys.path` 的**第一项就是「你启动 Python 时所在的工作目录（cwd）」**。而 `uvicorn app.main:app` 里的 `app.main` 是**相对这个 cwd** 去解析的包路径：

- 你**在 `apps/api-py` 目录**里启动 → cwd 里就有 `app/` → 能解析到 `app` 包 → **成功**。
- 你在**仓库根**启动 → cwd 里没有 `app/`（它在 `apps/api-py/app`）→ 解析不到 → 报 `No module named 'app'`。

**这与 Node 心智正好相反**：Node/TS 的 `import './config'` 是**按「文件自身所在位置」相对解析**的，**跟你在哪个目录敲命令无关**；Python 的 `import` 却**取决于你在哪个目录启动**。而 `--project apps/api-py` 只解决「用哪个 `.venv`/依赖」，**不切换工作目录**，所以救不了这个错。

**怎么修**（三选一，等价）：

```bash
# ① 先切到项目目录再启动（最直观）
cd apps/api-py
uv run uvicorn app.main:app --reload --port 8000

# ② 从仓库根执行，用 --directory 把工作目录切过去（仓库根 dev:api-py 脚本就是这么写的）
uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000

# ③ 用 uvicorn 的 --app-dir 显式指定包所在目录
uv run --project apps/api-py uvicorn app.main:app --app-dir apps/api-py --reload --port 8000
```

> **`sys.path`（模块搜索路径）**：Python 启动时用来搜索「要导入的模块」的目录列表，**工作目录会被自动放进去**。所以「从哪个目录启动」直接影响能不能 import 到本地包——这是与 Node「按文件路径解析」完全不同的另一套心智（导学篇 §5.3 也讲过）。

### 15.2 端口被占用

**现象**：

```
ERROR:    [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8000): ...
```

**为什么**：8000 端口已被别的进程占用（最常见是「上一次的服务没退干净」）。

**怎么修**：结束占用 8000 的进程，或换个端口：

```bash
uv run uvicorn app.main:app --reload --port 8001
```

（Windows 下可用 `netstat -ano | findstr :8000` 找到占用进程的 PID，再结束它。）

### 15.3 同步阻塞调用（在 `async def` 里做同步阻塞 I/O）

**现象**：服务能启动，但**一个请求卡住时，其它请求全都被拖慢甚至超时**——像「整个服务被冻住」。

**为什么**：如果路由是 `async def`，FastAPI 就把它**放在事件循环（单线程）里执行**。此时函数体里若出现**同步阻塞调用**（比如同步的 `db.commit()`、`requests.get(...)`、`time.sleep(...)`），它会**卡住整个事件循环**——其它协程、其它请求都排不上队。

**怎么修**（二选一）：

- **让 FastAPI 用线程池兜底**：把路由改成**普通 `def`**——FastAPI 会把它丢进线程池执行，同步阻塞就不阻塞事件循环了（本项目 `apps.py` 的增删改查路由正是普通 `def`）。
- **改用真正的异步**：把同步阻塞换成异步版本（如 `await` 异步 DB / HTTP 客户端），路由保持 `async def`。

一句话：**`async def` 里不能有同步阻塞；要么改 `def` 让线程池兜底，要么把阻塞换成异步**（见 §14.2）。

---

## 16. 自测题（7 道，含答案）

> 先自己答，再展开对照。

**Q1.** `app/main.py` 里的 `app` 是什么？它自己监听端口吗？

**Q2.** `uvicorn app.main:app` 里，冒号**前**和冒号**后**各是什么？

**Q3.** 为什么 `/health` 不用起数据库就能跑通？

**Q4.** `HealthResponse` 里的 `status: Literal["ok"]` 起什么作用？

**Q5.** `register_error_handlers(app)` 与 `app.include_router(health_router)` 都属于「什么性质」的操作？

**Q6.** 在仓库根跑 `uv run --project apps/api-py uvicorn app.main:app` 报 `No module named 'app'`，为什么？怎么修？

**Q7.** 为什么本项目 `apps.py` 的增删改查路由用普通 `def` 而不用 `async def`？

<details>
<summary>展开答案</summary>

**A1.** 它是 **ASGI 应用对象**（`FastAPI(...)` 的实例），定义「收到请求后怎么处理」；**它自己不监听任何端口**——监听端口是 uvicorn 的活儿。

**A2.** 冒号前 `app.main` 是**模块路径**（`app/` 包下的 `main.py`），冒号后 `app` 是**该模块里名为 `app` 的变量**。三者同名纯属巧合。

**A3.** 该路由不访问数据库；且 `db.py` 的 `create_engine(...)` 是**惰性**的——构造引擎对象时**不建立连接**，第一次真正执行 SQL 才连。

**A4.** 限定 `status` 只能是字符串 `"ok"`（等价契约的 `enum: [ok]`）。Pydantic 在**运行期**校验，传别的值会直接报错。

**A5.** 都是**「注册」**：前者把「异常类型 → 处理函数」的映射登记进应用，后者把一组路由登记进应用。都只是登记，**不会**立刻触发任何处理。

**A6.** 因为 Python 按**启动目录**解析包——`sys.path` 的第一项就是「你启动时的 cwd」，仓库根的 cwd 里没有 `app/`；而 `--project` **不切换工作目录**。修法：`cd apps/api-py` 后再启动，或改用 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`（见 §15.1）。

**A7.** 因为内部是**同步**的 SQLAlchemy 调用；写成普通 `def`，FastAPI 会把它**丢进线程池**执行——既不阻塞事件循环，也不用你手写线程（见 §14.2、§15.3）。

</details>
