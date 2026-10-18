# 04 · SQLAlchemy 2.0：模型映射与 Session

> 所属：阶段 1 · 账号与认证
> 本篇覆盖：`apps/api-py/app/models/`（`base.py` / `user.py` / `__init__.py`）+ `apps/api-py/app/db.py`
> **本篇首次教学：code-first ORM（与 Prisma 的 schema-first 对照）· `DeclarativeBase` · `Mapped[...]` / `mapped_column` · `__tablename__` · Engine / Session 生命周期 · `create_engine` · `SessionLocal`（`sessionmaker`）· 连接串 `postgresql+psycopg://` 的 driver 显式化 · 迁移所有权（migration ownership）**
> （Python 类型注解 / Pydantic / `APIRouter` / uvicorn / pydantic-settings / uv 项目化等已在 `00-项目初始化/06-FastAPI起步.md` 教过，本篇只引用、不重讲）

---

## 1. 本篇目标

- 用 **SQLAlchemy 2.0 声明式（declarative）风格**，把 TS 侧 Prisma 已经建好的 `users` 表**映射**成 Python 侧的 `User` 类。
- 让 Python 后端**能读写**这张表（`SELECT` / `INSERT` / `UPDATE`），但**不产生任何 DDL**（不建表、不改表）。
- **理解「迁移所有权」**：为什么在同一个数据库上让两套后端各自建表是灾难，以及本项目如何分工。

**验收标准**：在 `apps/api-py` 目录执行一段查询脚本后，能打印出 Prisma 迁移创建的那张 `users` 表里的行，例如：

```
rows: 6
bf522de0-8c2c-4926-b054-98594be7295c alice980365546@example.com member 2026-10-18 01:42:04.683000
```

即：**Prisma 建的表 + SQLAlchemy 读的数据**，两者对接成功。

> ⚠️ 本篇**不新增依赖、不改 `pyproject.toml`**。`sqlalchemy` 与 `psycopg[binary]` 已在阶段 0 · 06 声明并装好。

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| `uv` 与 Python 3.12、`pyproject.toml` / `.venv` | 阶段 0 · 01、06 |
| PostgreSQL 已启动（Docker `mini-dify-db`） | 阶段 0 · 02 |
| **`users` 表已由 Prisma 迁移创建** | 阶段 1 · 02（`01-账号与认证/02-Prisma.md`） |
| `config.py` 的 `database_url`（`DATABASE_URL`） | 阶段 0 · 06 |

> 与阶段 0 · 06 的 `/health` 不同，**本篇必须数据库在线**——因为要真正执行 SQL 了。`create_engine` 本身仍是惰性的（见 §6.4），但一旦跑查询就会连库。
>
> 表的存在性由 Prisma 负责：如果 `users` 表还不存在，请先完成阶段 1 · 02 的迁移（`prisma migrate`），本篇不做建表。

---

## 3. 先看清要做什么

本项目的 Python 数据库层只有两个位置，分工明确：

```
apps/api-py/app/
├── db.py                      # 「怎么连库」：engine + Session 工厂
└── models/                    # 「库里的表长什么样」：ORM 映射
    ├── __init__.py            # 包导出（Base / User）
    ├── base.py                # 声明式基类 Base
    └── user.py                # users 表 → User 类
```

**心法一句话**：

> `db.py` 管**连接**，`models/` 管**表结构**；两者都不负责**建表**——建表是 Prisma 的事。

```
TS 侧（api-ts）                      Python 侧（api-py）
prisma/schema.prisma                 app/models/user.py
   │  prisma migrate dev                │  class User(Base)
   ▼                                    ▼
【拥有 DDL：真正 CREATE TABLE】      【只做映射：读写已有表】
        └──────────── 同一张 users 表 ────────────┘
```

这也是为什么 Python 侧**没有** Alembic（另一个 Python 的迁移工具）——见 §6.6。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | **仓库根** | 确认 `sqlalchemy` / `psycopg` 已装（本篇无新增依赖，通常显示 `Audited N packages`） | 无报错 |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "\d users"` | 任意（需 Docker 在线） | **看一眼 Prisma 建的表结构**，与模型逐字段对照 | 打印 5 列 + 主键/唯一索引 |
| `uv run python -c "…查询脚本…"` | **`apps/api-py` 目录** | 用映射读 `users` 表，验证对接成功 | 打印 `rows: N` 与若干行 |
| `uv run uvicorn app.main:app --reload --port 8000` | **`apps/api-py` 目录** | 启动服务，端到端验证（阶段 1 · 05 会用到） | `Uvicorn running on http://127.0.0.1:8000` |

> 从仓库根也可用 `pnpm dev:api-py`（根脚本为 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`，见 `00-项目初始化/06-FastAPI起步.md` §10.7）。本篇的查询脚本因为要导入 `app` 包，**必须在 `apps/api-py` 目录内执行**（或同样用 `--directory` 切过去）。

---

## 5. 完整代码

### 5.1 `apps/api-py/app/models/base.py`

**完整文件路径：`apps/api-py/app/models/base.py`**

```python
"""SQLAlchemy 2.0 声明式基类。"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有模型的基类。

    注意：本项目的表结构（DDL）由 TS 侧 Prisma 迁移拥有；Python 侧只做映射。
    """
```

### 5.2 `apps/api-py/app/models/user.py`

**完整文件路径：`apps/api-py/app/models/user.py`**

```python
"""`users` 表模型。

重要：该表的 DDL 由 TS 侧 Prisma 迁移拥有（`apps/api-ts/prisma/migrations`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, server_default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
```

**逐行解释**

| 代码 | 作用 |
| --- | --- |
| `class User(Base)` | 继承声明式基类 `Base`，**类即一张表** |
| `__tablename__ = "users"` | 显式绑定真实表名 `users`（Prisma 侧 `@@map("users")` 生成的同名表） |
| `id: Mapped[str] = mapped_column(String, primary_key=True)` | 主键，字符串类型（表里是 `text`） |
| `email: Mapped[str] = mapped_column(String, unique=True, nullable=False)` | 唯一且非空（对应表里的 `users_email_key` 唯一索引） |
| `password_hash` | **注意下划线**：Python 属性名 `password_hash` 对应列 `password_hash`（Prisma 的 `passwordHash` 用 `@map("password_hash")` 映射到同名列） |
| `role: ... server_default="member"` | `server_default` 表示**数据库端**的默认值；表中确有 `DEFAULT 'member'` |
| `created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())` | `func.now()` 会被翻译成 SQL 函数 `now()`，对应表里的 `DEFAULT CURRENT_TIMESTAMP` |
| `created_at: Mapped[datetime]` | 类型注解告诉 ORM 取回来时转成 Python 的 `datetime` |

**关键点**：`primary_key` / `unique` / `nullable` / `server_default` 这些参数只用于**描述**列的特征；因为不生成 DDL，它们**不会**去修改数据库。它们的作用是让 ORM 知道「这一列怎么用」，并在真正发出 SQL 时保持一致。

### 5.3 `apps/api-py/app/models/__init__.py`

**完整文件路径：`apps/api-py/app/models/__init__.py`**

```python
"""数据模型包。"""

from app.models.base import Base
from app.models.user import User

__all__ = ["Base", "User"]
```

**解释**：把常用名字在包级重导出，别的模块可以 `from app.models import User`。`__all__` 声明「`from app.models import *` 时导出哪些名字」。（Python 包与 `__init__.py` 的机制见阶段 0 · 06。）

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

**逐项解释**

| 项 | 作用 |
| --- | --- |
| `create_engine(settings.database_url, ...)` | **惰性**创建数据库引擎（连接池 + 方言），构造时**不连库** |
| `pool_pre_ping=True` | 从池里取连接前先 ping 一下，避免拿到已被数据库断开的「死连接」 |
| `future=True` | 使用 SQLAlchemy 2.0 风格 API（2.0 已是默认，写出来显式声明） |
| `SessionLocal = sessionmaker(bind=engine, ...)` | 造一个**会话工厂**：调用它才得到一次数据库会话 |
| `autoflush=False` | 不自动把待提交的对象提前 flush，行为更可预测 |
| `expire_on_commit=False` | `commit()` 后对象属性不失效，提交后仍能直接读 `user.created_at` 等，避免额外的刷新查询 |

> 这两个文件在阶段 0 · 06 就已经「摆好位置」了（当时只为 `/health` 占位，不连库）。本篇把它们**真正启用**：`models/` 接上 `db.py`，从此 Python 侧能读写 `users`。

---

## 6. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 1 · 04」并直接使用。

### 6.1 code-first ORM vs schema-first —— 两套 ORM 的根本差别

**是什么**

| 范式 | 谁先谁后 | 真源（source of truth） | 本项目代表 |
| --- | --- | --- | --- |
| **schema-first** | 先写 schema → 由它**生成**代码/客户端并**建表** | 独立于语言的 schema 文件 | Prisma（`schema.prisma`） |
| **code-first** | 先写**代码里的类** → 由类**描述**表 | 语言里的类型/类 | SQLAlchemy（`class User(Base)`） |

**用一句话对照**：

- Prisma：写 `model User { ... }` → 运行 `prisma migrate` → **它替你 CREATE TABLE**，并生成类型安全的 `prisma.user` 客户端。
- SQLAlchemy：写 `class User(Base): ...` → **它不建表**，只是「学会认识」这张表的列与类型，让你能用对象方式读写。表**另有其人创建**。

**在本项目里的取舍**

- **DDL（建表/改表）由 Prisma 独占**（阶段 1 · 02）——它是**唯一**能改数据库结构的入口。
- **SQLAlchemy 只做映射**——「这张表已经存在，请帮我把行映射成对象」。
- 这样 `schema.prisma` 与 `models/user.py` 是「**同一张表的两种视角**」：前者拥有结构，后者拥有访问能力。

> 为什么不让两边各建一套？因为两套迁移系统各自记账，很容易互相覆盖、顺序错乱。**结构只能有一个主人**（见 §6.6）。

### 6.2 `DeclarativeBase` —— 声明式映射的基类

**是什么**：SQLAlchemy 2.0 提供的基类。让子类用「**普通类 + 类型注解**」的方式声明映射，而不是老式那种 `Column(...)` 蓝图式写法。

**基本语法**

```python
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):          # 继承 Base 就是「注册」进映射体系
    __tablename__ = "users"
    ...
```

- 每个继承 `Base` 的类都会被 SQLAlchemy 登记为一张表。
- 2.0 之前是 `declarative_base()` 函数返回一个基类；2.0 起推荐 `class Base(DeclarativeBase)` 这种**子类化**写法（更利于类型检查与自定义）。
- 全部模型继承**同一个** `Base`，ORM 才能把来自不同表的对象放在同一个 Session 里管理。

**本例为什么这么用**：`base.py` 只做一件事——定义 `Base`；`user.py` 的 `User(Base)` 由此登记。将来加 `Conversation`、`Message` 等模型，只需再继承这个 `Base`。

### 6.3 `Mapped[...]` / `mapped_column` / `__tablename__` —— 2.0 的声明语法

**是什么**：SQLAlchemy 2.0 用**类型注解 + `mapped_column`** 来声明列。

**基本语法**

```python
from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

class User(Base):
    __tablename__ = "users"                     # ① 真实表名
    id:   Mapped[str]      = mapped_column(String, primary_key=True)   # ② 列定义
    name: Mapped[str]      = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

| 语法 | 含义 |
| --- | --- |
| `__tablename__` | 这个类映射到数据库里的哪张表 |
| `Mapped[T]` | 「这是**映射到列的属性**，Python 侧类型是 `T`」——`T` 决定取回来时转成什么 Python 类型 |
| `mapped_column(...)` | 列的具体参数：SQL 类型（`String`/`DateTime`）、`primary_key`、`unique`、`nullable`、`server_default` 等 |

**关键区别（2.0 vs 旧式）**：旧写法是 `id = Column(String, primary_key=True)`（光秃秃的赋值）；**2.0 要求带注解** `id: Mapped[str] = mapped_column(...)`，好处是类型检查器（mypy/pyright）能据此推断出 `user.id` 是 `str`，IDE 更聪明。

**`Mapped[T]` 的 `T` 怎么选**：与列的实际类型对齐——`text`→`str`、`timestamp`→`datetime`、`integer`→`int`、`boolean`→`bool`。

**本例为什么这么用**

| 列 | 注解 | 说明 |
| --- | --- | --- |
| `id` | `Mapped[str]` | 表里是 `text`，且是主键 |
| `email` | `Mapped[str]` | 唯一、非空 |
| `password_hash` | `Mapped[str]` | 非空 |
| `role` | `Mapped[str]` + `server_default="member"` | 数据库默认 `'member'` |
| `created_at` | `Mapped[datetime]` + `server_default=func.now()` | 数据库默认 `now()`，读回是 `datetime` |

> ⚠️ `nullable=False` 与「Python 侧 `None` 与否」是两件事：Python 类型保持非 Optional（`Mapped[str]` 而非 `Mapped[str | None]`），表示我们约定这一列永远有值。

### 6.4 Engine / Session 的生命周期

**Engine（引擎）**

- **是什么**：对「数据库 + 驱动 + 连接池 + 方言」的**全局**封装。全应用**一个**就够了（模块级 `engine = create_engine(...)`）。
- **生命周期**：`create_engine(...)` **构造时是惰性的**——它不会立刻连库（这正是阶段 0 · 06 `/health` 在数据库没起时也能跑通的原因）。**第一次执行 SQL 时**才真正从池里建连接。
- **连接池**：Engine 内部维护一个连接池，复用 TCP 连接，省去每次重建的开销；`pool_pre_ping=True` 让取连接前先探测存活。
- **不要频繁造 Engine**：一个进程一个即可；频繁 `create_engine` 会不断新建连接池。

**Session（会话）**

- **是什么**：一次「工作单元」——你通过它查询、修改、提交对象；它有**身份映射（identity map）**与**变更跟踪**：同一个 Session 里，同一条记录只会有一个对象实例；改了对象的属性，`flush`/`commit` 时自动生成 `UPDATE`。
- **生命周期**：**一次请求 / 一段操作一个 Session**，用完就关。典型是「打开 → 增删改查 → commit → close」。
- **本项目的写法**：`SessionLocal()` 造会话；在 FastAPI 里用依赖 `get_db()` 把「打开/关闭」包成一个 `yield`（见 `01-账号与认证/05-FastAPI认证.md`）。`sessionmaker` 就是「会话工厂」——每次调用 `SessionLocal()` 产出一个新 Session。

**两者的关系（图示）**

```
engine = create_engine(url)      ← 进程级，唯一，管连接池
        │
        ├── SessionLocal() → Session A    ← 请求级，用完 close
        ├── SessionLocal() → Session B
        └── ...
```

**基本语法**

```python
from sqlalchemy import select

with SessionLocal() as session:        # 打开会话
    user = session.scalars(select(User).where(User.email == "a@b.com")).first()
    session.commit()                   # 提交（此处省略的 add/delete 才会生效）
# with 退出即关闭会话
```

**本例为什么这么用**：`db.py` 把 `engine` 与 `SessionLocal` 做成模块级单例——全应用共享一个 Engine，而每个请求按需造 Session。这是 SQLAlchemy 的**标准范式**。

### 6.5 连接串 `postgresql+psycopg://` —— driver 显式化

**是什么**：SQLAlchemy 的连接串格式是：

```
dialect+driver://user:password@host:port/database
```

- `dialect`：数据库方言，如 `postgresql`、`mysql`、`sqlite`。
- `+driver`：**使用哪个 DBAPI 驱动**，如 `psycopg`（psycopg3）、`psycopg2`、`asyncpg`。
- 省略 `+driver` 时，SQLAlchemy 会按方言挑一个「**默认驱动**」。

**与 Prisma 的不同（重点）**

| 侧 | 值 | 说明 |
| --- | --- | --- |
| api-ts（Prisma） | `postgresql://postgres:...@localhost:5432/minidify` | **不带** driver 后缀（Prisma 用自己的 Rust 引擎连库） |
| api-py（SQLAlchemy） | `postgresql+psycopg://postgres:...@localhost:5432/minidify` | **带** `+psycopg`，显式指定用 psycopg3 驱动 |

两边指向**同一个数据库、同一个库名 `minidify`**，只是写法不同——这正是为什么本项目**每个后端各有各的 `.env`**（`apps/api-ts/.env` 是 Prisma 风格 `postgresql://`，`apps/api-py/.env` 是 Python 侧 `postgresql+psycopg://`；仓库根 `.env` 只留 `POSTGRES_*` 基础设施变量）。

**为什么要把 driver 显式写出来**

1. **一个方言可能有多个驱动**（postgresql 可配 `psycopg` / `psycopg2` / `asyncpg` …）。不写，就靠「默认」，默认是谁随版本变化；写了就**钉死**。
2. **同步 vs 异步**：`psycopg`（psycopg3）默认同步；`psycopg_async` / `asyncpg` 才是异步。显式写出来，意图清楚。
3. **装错包的报错更清楚**：不写 `+psycopg` 而环境里只装了 psycopg3，SQLAlchemy 可能去找 psycopg2 然后报「driver 未安装」；写出来就能直接对上 `pyproject.toml` 里的 `psycopg[binary]`。

**在本项目**：`pyproject.toml` 依赖里写的是 `psycopg[binary]>=3.2.0`（psycopg3），所以连接串必须写 `postgresql+psycopg://`，二者**一一对应**。

### 6.6 迁移所有权（migration ownership）—— 本篇最重要的一条约定

**问题**：当两套后端共用**同一个数据库**，如果各自都能建表/改表，会发生什么？

- 两边各记一套迁移历史，谁先谁后无法协调；
- 一边改了列，另一边不知道 → 运行时字段错乱；
- 一次部署里两边都跑迁移 → 冲突、甚至数据损坏。

**本项目的裁决**：

| 侧 | 角色 | 能做什么 | 不能做什么 |
| --- | --- | --- | --- |
| api-ts（Prisma） | **DDL 拥有者** | 定义 schema、`prisma migrate` 建表/改表 | —— |
| api-py（SQLAlchemy） | **只读方（映射方）** | 映射表、读写数据 | **不建表、不改表**（本篇模型里的参数只用于描述，不生成 DDL） |

**为什么不给 Python 侧上 Alembic**：Alembic 是 Python 生态的迁移工具，功能上完全可以替代 Prisma 迁移，但**迁移只能有一个主人**。当前阶段 `users` 表由 Prisma 服务 TS 侧，Python 只是「蹭」这张表读写——此时引入 Alembic 就成了**第二个主人**，必然冲突。

**什么时候才用 Alembic**：当 Python 侧要拥有**专属表**（这些表 Prisma 的 schema 里没有、只有 Python 用）时，才可以考虑让 Alembic 接管**这批专属表**的迁移。到那时的原则仍是「**一张表只有一个迁移主人**」，而不是「谁都能改任何表」。

> 一句话：**结构归 Prisma，读写归 SQLAlchemy；Alembic 先不请。**

---

## 7. 验收自测

### 方式 A：先看表结构（确认 Prisma 建了表）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d users"
```

**预期输出（节选）**

```
    Column     |              Type              | Nullable |      Default
---------------+--------------------------------+----------+-------------------
 id            | text                           | not null |
 email         | text                           | not null |
 password_hash | text                           | not null |
 role          | text                           | not null | 'member'::text
 created_at    | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "users_email_key" UNIQUE, btree (email)
```

把它和 `models/user.py` 的五个字段逐行对照：**列名、类型、可空性、默认值全部对得上**。

### 方式 B：用映射读表（本篇核心验收）

**命令（在 `apps/api-py` 目录执行）**

```bash
uv run python -c "from app.db import SessionLocal; from app.models.user import User; from sqlalchemy import select; s = SessionLocal(); rows = s.scalars(select(User)).all(); print('rows:', len(rows)); [print(r.id, r.email, r.role, r.created_at) for r in rows[:3]]; s.close()"
```

**预期输出**（行数与数据依你库里实际内容而定）

```
rows: 6
bf522de0-8c2c-4926-b054-98594be7295c alice980365546@example.com member 2026-10-18 01:42:04.683000
e41987ae-aef5-43a9-b242-52b02f8b4273 bob1587661467@example.com member 2026-10-18 01:49:25.623000
```

能打印出行，说明：**连接串正确 → Engine 连上库 → `User` 映射对上了 Prisma 建的 `users` 表**。

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 依赖就位 | `uv sync --project apps/api-py` | 无报错 |
| 表已由 Prisma 建好 | `docker exec mini-dify-db psql -U postgres -d minidify -c "\d users"` | 打印 5 列与索引 |
| 模型映射成立 | 方式 B 的查询脚本 | 打印 `rows: N` + 若干行 |
| **未产生 DDL** | 观察库中表数量 / 迁移记录 | Python 侧不新增任何表 |

> 「未产生 DDL」怎么确认？在本篇全程中，Python 侧只执行 `SELECT`（以及阶段 1 · 05 的 `INSERT`），从不执行 `CREATE`/`ALTER`；你也可用 `psql` 的 `\dt` 看表清单，与只跑过 Prisma 迁移时一致。

---

## 8. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 连接串漏了 `+psycopg` | `ModuleNotFoundError: No module named 'psycopg2'` 或「找不到驱动」 | 直接写了 `postgresql://`，SQLAlchemy 去挑**默认驱动**（可能是 psycopg2），而项目装的是 psycopg3。**必须写 `postgresql+psycopg://`**（见 §6.5） |
| 在仓库根跑查询脚本 | `ModuleNotFoundError: No module named 'app'` | `app` 包按**当前工作目录**解析。要么 `cd apps/api-py`，要么用 `uv run --directory apps/api-py …`（见阶段 0 · 06 §9） |
| 以为要跑迁移 / 建表 | 纠结「SQLAlchemy 要不要 `create_all`」 | 本项目 **DDL 归 Prisma**，Python 侧**不建表**。`users` 表若不存在，请先完成阶段 1 · 02 的 Prisma 迁移，**不要**用 `Base.metadata.create_all()`（那会变成第二个迁移主人） |
| 表名 / 列名对不上 | `relation "user" does not exist` 或 `column ... does not exist` | 类名 `User` 默认会找表 `user`（小写单数）；项目用 `__tablename__ = "users"` 显式绑定。列名同理，属性名必须与列名一致（`password_hash` 而非 `passwordHash`） |
| 时区疑问 | 读出的 `created_at` 是「裸」的 `datetime` | 表列是 `timestamp without time zone`。Python 侧取回的是 naive `datetime`；对外输出时由 `app/api/auth.py` 补上 UTC 时区（见阶段 1 · 05） |
| `uv` 命令不被识别 | `The term 'uv' is not recognized` | `uv` 本已在**用户 PATH** 中（安装器写入，见阶段 0 · 01）；只有**安装前就已打开**的 shell 因继承**旧 PATH** 才会报此错。重启终端 / IDE 即可，**无需改动系统环境变量**；兜底用绝对路径 `C:\Users\27382\.local\bin\uv.exe` |
| 改了模型不生效 | 访问报 `AttributeError` / 列不存在 | 模型是代码，**改完要重启进程**；且参数只是描述，若真要改表结构，那属于 Prisma 的事 |

---

## 9. 与 api-ts 的对照

| 概念 | Prisma（api-ts） | SQLAlchemy（api-py） |
| --- | --- | --- |
| 范式 | schema-first（`schema.prisma`） | code-first（`class User(Base)`） |
| 定义位置 | `prisma/schema.prisma` | `app/models/user.py` |
| 谁建表 | **Prisma 迁移**（DDL 拥有者） | **不建表**，仅映射 |
| 客户端/对象 | 生成的 `prisma.user` | 映射类 `User` + `Session` |
| 查询写法 | `prisma.user.findUnique({ where: { email } })` | `session.scalars(select(User).where(User.email == email))` |
| 连接串 | `postgresql://…` | `postgresql+psycopg://…`（driver 显式） |
| 时间字段 | `DateTime`，`toISOString()` | `DateTime` → naive `datetime` |
| 迁移工具 | `prisma migrate` | **无**（Alembic 留待 Python 有专属表时再考虑） |

两套实现操作的是**同一张 `users` 表**，响应结构由契约（阶段 1 · 01）统一。

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| code-first ORM（对比 Prisma schema-first） | **首次教学于本篇** |
| `DeclarativeBase`（声明式基类） | **首次教学于本篇** |
| `Mapped[...]` / `mapped_column` / `__tablename__` | **首次教学于本篇** |
| Engine / Session 生命周期（连接池 / 一次请求一 Session） | **首次教学于本篇** |
| `create_engine`（惰性建引擎） | **首次教学于本篇** |
| `SessionLocal`（`sessionmaker` 会话工厂） | **首次教学于本篇** |
| 连接串 `postgresql+psycopg://` 的 driver 显式化（对比 Prisma 的 `postgresql://`） | **首次教学于本篇** |
| **迁移所有权**（DDL 归 Prisma，Python 只映射；Alembic 留待专属表） | **首次教学于本篇** |
