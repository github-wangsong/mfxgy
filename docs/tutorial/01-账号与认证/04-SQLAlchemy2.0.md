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
"""SQLAlchemy 2.0 声明式基类。"""          # 模块 docstring（三引号字符串紧贴文件开头＝整个文件的说明）

from sqlalchemy.orm import DeclarativeBase  # 从 SQLAlchemy 的 ORM 子包导入「声明式基类」（映射入口）


class Base(DeclarativeBase):               # 定义 Base：继承 DeclarativeBase，等于「进入声明式映射体系」
    """所有模型的基类。                      # ↓ 类 docstring：说明这个类本身不映射任何表

    注意：本项目的表结构（DDL）由 TS 侧 Prisma 迁移拥有；Python 侧只做映射。
    """
```

**这段在干什么**（按执行顺序）：

1. 文件被导入时，先执行 `from sqlalchemy.orm import DeclarativeBase`——把 `DeclarativeBase` 这个名字绑定到 SQLAlchemy 提供的类上。
2. 接着执行 `class Base(DeclarativeBase):`——定义 `Base` 类。`DeclarativeBase` 是 SQLAlchemy 给的「基类」，**继承它的类会自动获得一套「声明式映射」能力**（详见 §6.2 与 §6.7）。
3. 类体里只有一个 docstring，**没有任何字段**——所以 `Base` 自己**不映射任何表**，它只是「所有模型类的共同父类」。
4. 这个文件是**纯定义**：导入它**不会连数据库、不会建表**。真正连库发生在你去执行 SQL 的时候（§6.4）。

> 对照 TS：这就好比你先写一个空基类 `class BaseEntity {}`，让 `User`、`App` 都去继承它；但在 Python + SQLAlchemy 里，继承这个基类**不只是代码复用**，而是「把子类登记进一张表的映射体系」——机制见 §6.7。

### 5.2 `apps/api-py/app/models/user.py`

**完整文件路径：`apps/api-py/app/models/user.py`**

```python
"""`users` 表模型。

重要：该表的 DDL 由 TS 侧 Prisma 迁移拥有（`apps/api-ts/prisma/migrations`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。
"""

from datetime import datetime                    # 标准库：日期时间类型（给 created_at 注解用）

from sqlalchemy import DateTime, String, func    # SQLAlchemy 顶层：列类型 DateTime / String + SQL 函数工厂 func
from sqlalchemy.orm import Mapped, mapped_column # ORM：Mapped 注解包装 + mapped_column 列声明

from app.models.base import Base                 # 项目包：导入共同的声明式基类 Base


class User(Base):                                # 继承 Base → 这个类被登记为「一张表」的映射
    __tablename__ = "users"                      # 绑定真实表名 users（Prisma 的 @@map("users") 建的表）

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)                # 主键；Python 侧类型 str
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)  # 唯一 + 非空
    password_hash: Mapped[str] = mapped_column(String, nullable=False)       # 列名＝属性名，蛇形 password_hash
    role: Mapped[str] = mapped_column(String, nullable=False, server_default="member")  # 数据库端默认 'member'
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())  # 数据库端默认 now()
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

**这段在干什么**（按执行顺序）：

1. 模块被导入时，先执行四条 `import`：拿到 `datetime`（标准库）、`DateTime`/`String`/`func`（SQLAlchemy 顶层）、`Mapped`/`mapped_column`（ORM 层）、`Base`（本项目基类）。
2. 执行 `class User(Base):`——`User` 继承 `Base`，于是**在类定义完成的那一刻**，SQLAlchemy 的元类会去读这个类体，把 `__tablename__` 与所有 `Mapped[...] = mapped_column(...)` 属性**收集成一张 `Table` 元数据**（`User.__table__`）。这一步是「类 → 表映射」真正发生的地方（§6.7 会把这个过程讲透）。
3. 五条列声明被逐个登记：`id`（主键）、`email`（唯一非空）、`password_hash`（非空）、`role`（非空 + DB 默认 `'member'`）、`created_at`（非空 + DB 默认 `now()`）。**注意每列的属性名就是它的列名**——`password_hash` 而非 `passwordHash`。
4. 到此为止**只建了「元数据」**，没有任何 SQL 被发送；真正读写数据要等某个 `Session` 用它去查（§5.4、§6.4）。

> 为什么 `id` 没有 `server_default`？因为 Prisma 的 `uuid()` 是**客户端**默认值，数据库这一列**没有 `DEFAULT`**（见 `01-账号与认证/02-Prisma.md` §5.2 与 §8 坑）。所以 Python 侧写入时必须**自己生成一个 id**（下一篇 `create_user` 用 `uuid4()`），否则会撞 `NOT NULL` 违例（见 §8）。

### 5.3 `apps/api-py/app/models/__init__.py`

**完整文件路径：`apps/api-py/app/models/__init__.py`**

```python
"""数据模型包。"""                        # 包 docstring（`__init__.py` 里写的说明） 

from app.models.base import Base          # 从子模块 base 重导出 Base
from app.models.user import User          # 从子模块 user 重导出 User

__all__ = ["Base", "User"]                # 声明 `from app.models import *` 时导出哪些名字
```

**解释**：把常用名字在包级重导出，别的模块可以 `from app.models import User`。`__all__` 声明「`from app.models import *` 时导出哪些名字」。（Python 包与 `__init__.py` 的机制见阶段 0 · 06。）

**这段在干什么**（按执行顺序）：

1. 有人第一次 `import app.models` 时，Python 先执行本文件：两条 `from ... import ...` **顺带把 `base`、`user` 两个子模块也导入**（导入子模块会执行它们，进而把 `Base`、`User` 登记进映射体系）。
2. `__all__` 只是一个**名字清单**，不执行任何逻辑；它告诉 `from app.models import *` 该带出哪些名字。**注意**：即便不写 `__all__`，`from app.models import User` 也能用——它只是控制「星号导入」的范围。
3. 这就是「barrel 文件」在 Python 里的形态：≈ TS 里 `index.ts` 里写 `export { User } from './user'`。

### 5.4 `apps/api-py/app/db.py`

**完整文件路径：`apps/api-py/app/db.py`**

```python
"""数据库接入（SQLAlchemy 2.0）。

`users` 表的 DDL 由 TS 侧 Prisma 迁移拥有（见笔记「迁移所有权」）；
Python 侧只做映射与读写，不产生 DDL。
"""

from sqlalchemy import create_engine          # 建「引擎」的工厂函数
from sqlalchemy.orm import sessionmaker       # 建「会话工厂」的工厂函数

from app.config import settings               # 项目配置（从 .env 读到 database_url）

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)  # 进程级引擎：惰性，构造时不连库

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)  # 会话工厂：调用它才产出 Session
```

**这段在干什么**（按执行顺序）：

1. 两条 `import` 拿到 `create_engine`（制造引擎）与 `sessionmaker`（制造「会话工厂」）；`settings` 提供连接串。
2. 执行 `engine = create_engine(...)`——**在模块被导入时**（即进程启动、第一次用到 `app.db` 时）建出引擎。注意：**这一步不连数据库**——它只是准备好「方言 + 驱动 + 连接池配置」。（这正是阶段 0 · 06 的 `/health` 在数据库没起时也能跑通的原因，见 §6.4。）
3. 执行 `SessionLocal = sessionmaker(...)`——注意 `sessionmaker(...)` 返回的是一个**「工厂对象」（可被调用的对象）**，而不是一个 Session。真正要用数据库时，你写 `SessionLocal()` 才会**新建**一个 `Session`。这和 TS 里 `const makeSession = () => new Session()` 的 `makeSession` 是一回事。
4. 因为这两行在**模块顶层**、而模块只会被导入一次，所以 `engine` 与 `SessionLocal` 天然是「**进程级单例**」——全应用共享同一个引擎。

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

### 6.7 【运行期机制】`Mapped[...]` / `mapped_column()` 在运行期到底怎么变成列

这是**读者最卡**的地方：`id: Mapped[str] = mapped_column(...)` 这一行，Python 在运行期究竟做了什么？

**先破除一个误解**：这一行**不是**「给变量赋值」，也**不是** TS 那种「声明一个字段」。它是在**定义类的时候**，被 SQLAlchemy 的**元类（metaclass）**捕获，转成一个「列描述对象」挂到类上。

**分三步看运行期发生了什么**：

1. **`Mapped[str]` 只是「一句声明」**。`Mapped` 是住在 `sqlalchemy.orm` 里的一个泛型包装类型。`Mapped[str]` 的唯一作用是告诉声明式框架：「**这个类属性要映射成一列，Python 侧值是 `str`**」。它**本身不是列**、运行期不产生任何东西——它只是**写在注解里的一句声明**。（靠的正是阶段 0 · 00 §4.3 讲的那条：Python 注解**保留到运行期**，SQLAlchemy 才能读到它。）
2. **`mapped_column(...)` 返回一个列定义对象**。`mapped_column(String, primary_key=True, ...)` 返回一个 `MappedColumn` 对象，里面记着列类型（`String`）与 `primary_key`/`nullable`/`server_default` 等参数。此刻它**还不是数据库里的列**，只是一份**描述**。
3. **元类在「类定义完成」那一刻统一收集**。执行 `class User(Base): ...` 时，`DeclarativeBase` 携带的**元类**会扫描这个类体：把 `__tablename__`、以及所有「带 `Mapped[...]` 注解 + 赋值为 `mapped_column(...)`」的属性收集起来，转成真正的 `Column` 对象，放进 `User.__table__`（一张 `Table` 元数据对象）。**到这一步，「类」才真正变成「一张表的映射」。**

**描述符（descriptor）——为什么 `user.id` 能读值、`User.id` 能当查询条件**：

类定义完成后，类属性 `User.id` 不再是普通值，而是一个 **`InstrumentedAttribute`**（SQLAlchemy「插桩」后的属性描述符）。它让两种访问各走各的路：

- **实例级**（`user.id`）：取这一列**在当前对象上的值**。
- **类级**（`User.id`）：返回**代表这一列的 SQL 表达式**——所以 `select(User).where(User.email == "x")` 能拼出 SQL 条件。

这正是「`User.id` 既能读值、又能当查询条件」的底层机制，也是 TS 里**没有直接对应物**的地方。

**TS 里对应什么**：TS 里 `interface User { id: string }` 只是**编译期类型**，运行期被**擦除、什么都不剩**；而这里，注解在运行期**被读到**，配合元类**真的生成了一个「列对象」**。所以 `Mapped[]`/`mapped_column` = 「**声明式元数据 + 元类处理**」，不是普通赋值。

**这里为什么这么写**：SQLAlchemy 2.0 要求「带注解的 `mapped_column`」而不是 1.x 的裸 `Column(...)`，就是让**类型检查器（mypy/pyright）也能读到** `user.id: str`，IDE 补全更准；同时元类用同一份信息建映射（§6.3）。

> **必须记住的结论**：**列名默认取属性名**（`password_hash` 属性 → `password_hash` 列）。所以属性名若写成驼峰（如 `ownerId`）就会与数据库列名对不上，运行时报 `column ... does not exist`（详见阶段 2 · 04 §6.3）。

### 6.8 【运行期机制】`engine` / `SessionLocal` / `Session` 的生命周期

**三个东西的角色**（一次说清）：

- **`engine`（引擎）**：**进程级、唯一**，管「方言 + 驱动 + 连接池」。`create_engine(...)` 构造时是**惰性的**——**不连库**；第一次要执行 SQL 时才真正从池里建连接。
- **`SessionLocal`（会话工厂）**：`sessionmaker(...)` 的返回值，是一个**可调用对象**。每次 `SessionLocal()` 产出一个**新的 `Session`**。
- **`Session`（会话）**：一次「工作单元」。它带**身份映射**（identity map：同一个 Session 里，同一条记录只会有一个对象实例）与**变更跟踪**（改了对象属性，`flush`/`commit` 时自动生成 `UPDATE`）。

**生命周期（图）**：

```
engine = create_engine(url)          ← 进程级，建一次，全应用共享，管连接池
        │
        ├── SessionLocal() → Session A   ← 请求级，每次操作新建，用完 close
        ├── SessionLocal() → Session B
        └── ...
```

在 FastAPI 里由依赖 `get_db()` 把「打开 → 用 → 自动关闭」包成一个 `yield` 生成器：

```python
def get_db() -> Iterator[Session]:
    with SessionLocal() as session:   # 开一个新 Session
        yield session                 # 交给处理函数使用；函数暂停在这里
    # 处理完毕，回到这里 → 离开 with 块 → 自动 close
```

（`with` 上下文管理器与 `yield` 生成器的机制见阶段 0 · 00 §4.13，那里已当场解释过：`with ... as x:` 会在**离开缩进块时（含异常路径）自动释放资源**；`yield` 让函数能「暂停/恢复」。这里就是二者的组合。）

**`expire_on_commit` 是什么（本项目设成 `False`）**：默认值是 `True`，含义是——**`commit()` 之后，当前 Session 里所有对象的**所有属性会被标记为「过期（expired）」。之后你**再读** `user.email`，SQLAlchemy 会**悄悄补发一条 `SELECT`** 去数据库刷新它。于是常出现两个困惑：

- 「我明明刚 `commit` 了，为什么再读一个属性又发了一条查询？」
- 「为什么读一下 `user.created_at` 又多一次数据库往返？」

本项目在 `db.py` 里写了 `SessionLocal = sessionmaker(..., expire_on_commit=False)`：**commit 后属性不失效**，可以直接继续读 `user.created_at` 等，省掉这次额外刷新，也更符合「拿到就是拿到」的直觉（见 §5.4）。

**为什么「一个 engine + 每请求一个 Session」**：Engine 全局唯一省得反复建连接池；Session 是「一次工作单元」，用完就关——这是 SQLAlchemy 的标准范式。

**TS 里对应什么**：Prisma 的 `PrismaClient` 是全应用单例（`PrismaService extends PrismaClient`，连接由客户端内部管）；查询**直接返回结果**，没有「commit 后属性过期」这套概念。所以 SQLAlchemy 的「engine/Session 两分 + 工作单元」在 Prisma 里**没有一一对应**——**Prisma 更像「一个全局引擎」，SQLAlchemy 把它拆成「一个引擎 + 若干会话」**。

### 6.9 【运行期机制】`func.now()` / `onupdate` / `server_default`：应用层 vs 数据库层默认值

**两类默认值的「位置」完全不同**：

| 写法 | 谁填值 | 什么时候填 | 落到哪里 |
| --- | --- | --- | --- |
| `server_default=func.now()` | **数据库** | INSERT 且没给该列 | 建表 DDL 的 `DEFAULT now()`（本项目由 Prisma 建好，这里只是**描述**） |
| `default=func.now()` | **SQLAlchemy（应用端）** | INSERT 且没给该列 | SQLAlchemy 在发出的 `INSERT` 语句里填 `now()` |
| `onupdate=func.now()` | **SQLAlchemy（应用端）** | UPDATE 该行时 | SQLAlchemy 把该列改成 `now()` |

**`func.now()` 是什么**：`func` 是 SQLAlchemy 的「**SQL 函数工厂**」——`func.now()` 生成的是一个 **SQL 表达式对象**（对应 SQL 的 `now()`），**不是** Python 的 `datetime.now()`。写作 `server_default=func.now()` 时落到 DDL 就是 `DEFAULT now()`；写作 `default=func.now()` 时落到 INSERT 就是 `now()`。**关键：用它才能让「时间由数据库算」**，而不是把 Python 进程的当前时间硬塞进去。

**本篇 `created_at` 为什么用 `server_default`**：因为 Prisma 迁移已经给这一列 `DEFAULT CURRENT_TIMESTAMP`（`01-账号与认证/02-Prisma.md` §5.2），Python 侧写 `server_default` 只是**把这份事实描述出来**，两者**指向同一个 DB 默认值**，行为一致。

**TS 里对应什么**：Prisma 的 `@default(now())` 落成 DDL 的 `DEFAULT CURRENT_TIMESTAMP`（**数据库端**默认，对应这里的 `server_default`）；而 **`@updatedAt` 是客户端行为**（Prisma Client 写库时在 SQL 里带上，对应这里的 `default`/`onupdate` 那一层）。所以：**Prisma 用 `@default(now())` 与 `@updatedAt` 分别表达「DB 端默认」和「客户端默认」；SQLAlchemy 则用 `server_default` 与 `default`/`onupdate` 分别表达**——这正是阶段 2 · 04 §6.6「所有权边界」的语言基础。

> 记忆：**`server_default` = 数据库端默认；`default`/`onupdate` = 应用（ORM）端默认。** 两者可以同时存在，取同一个 `now()` 时就是「双保险」（见阶段 2 · 04）。

### 6.10 本篇首次出现的 Python 语法 / 机制（是什么 → TS 里对应什么 → 这里为什么这么写）

> 这是给「只会 TS」的你补的语言映射。前几节讲「运行期机制」，这里讲**语言构造本身怎么读**。

| Python 写法 | 是什么 | TS 里对应什么 | 这里为什么这么写 |
| --- | --- | --- | --- |
| `class User(Base):` | 定义类并**继承** `Base`；在 SQLAlchemy 里「继承声明式基类」= **登记为一张表的映射** | `class User extends BaseEntity {}`（但 TS 的继承只是代码复用，无「登记成表」语义） | 让元类在类定义时收集列（§6.7） |
| `__tablename__ = "users"` | **dunder 属性**（前后双下划线是 Python 的「特殊用途」命名约定）；这里指定「映射到哪张表」 | TS 里没有等价物（Prisma 用 `@@map("users")`） | 显式绑定真实表名，避免默认用类名推断 |
| `Mapped[str]` | 泛型注解（`Mapped` 是泛型类，`[str]` 是类型参数） | `Map<string>` / `Record` 之类泛型写法相似，但意义不同 | 声明「这是映射到列的属性，值是 str」（§6.7） |
| `mapped_column(String, primary_key=True)` | **关键字参数**（`名字=值`）的函数调用；`primary_key`/`nullable`/`server_default` 都是关键字参数 | `mappedColumn(String, { primaryKey: true })` 的对象参数 | 关键字参数可读性更好、顺序无所谓（阶段 0 · 00 §4.8） |
| `engine = create_engine(...)`（模块顶层） | 模块顶层语句「**导入时执行一次**」→ 天然单例 | NestJS 里靠 `@Injectable()` + IoC 容器管单例 | 全局一个引擎，不必上容器（§6.8） |
| `SessionLocal = sessionmaker(...)` | `sessionmaker(...)` 返回一个**可调用对象（工厂）**；`SessionLocal()` 才造 Session | ≈ `const SessionLocal = () => new Session()` 的闭包/工厂 | 「工厂」把「造 Session」这件事延迟到用时（§6.8） |
| `func.now()` | 返回一个**惰性 SQL 表达式对象**（不是立即算时间） | 无直接对应（Prisma 用 `@default(now())` DSL） | 让「时间由数据库算」（§6.9） |
| `from sqlalchemy.orm import Mapped, mapped_column` | **点号包路径导入**（`包.子模块.名字`），不是文件相对路径 | `import { Mapped } from 'sqlalchemy/orm'`（但 Python 用点号、且从可解析的位置开始） | 机制见阶段 0 · 00 §5.1~5.3——**当场提醒**：Python 靠 `sys.path` 找包，**从哪个目录启动会影响能否 `import app`**（见 §8 坑） |
| `with SessionLocal() as session:` | **上下文管理器**：进入时拿到 `session`，离开缩进块时自动关闭 | ≈ `try { } finally { session.close() }` | 保证会话一定被关闭（阶段 0 · 00 §4.13 已当场讲过；这里首次用于数据库会话） |
| `__all__ = [...]` | 一个**名字清单**，控制 `from x import *` 导出哪些 | ≈ 手写「对外导出的公开清单」（TS 无 `*` 导入，无直接对应） | 包级重导出更清晰（§5.3） |

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
| 在仓库根跑查询脚本 | `ModuleNotFoundError: No module named 'app'` | （**写错会怎样**之一）Python 在**启动时的当前工作目录**里找包——`app` 包在 `apps/api-py/app/` 下，所以你必须**在 `apps/api-py` 目录里**启动，`sys.path` 才会包含它。要么 `cd apps/api-py`，要么用 `uv run --directory apps/api-py …`（**当场解释**：`--directory` 换的是**工作目录**，`--project` 只换 `.venv`/依赖、**不换工作目录**，所以 `--project` 解决不了这个问题）。详见阶段 0 · 00 §5.3、阶段 0 · 06 §9 |
| **忘记 `session.commit()`** | 代码跑完没报错，但**数据没落库**、重查为空 | （**写错会怎样**之二）ORM 的增删改只发生在 **Session 内存**里：`session.add(obj)` 只是把对象放进会话，`flush` 只是发 SQL 但**事务未提交**。**必须 `session.commit()`** 才真正落库；忘了就会「查询查不到、重启后又没了」。用 `with SessionLocal() as session:` 时，`commit` 之后离开缩进块会 `close`，但**不会替你自动 commit** |
| 插入时没给 `id` 赋值 | `psycopg.errors.NotNullViolation: null value in column "id" of relation "users" violates not-null constraint` | （**写错会怎样**之三）`id` 是 `NOT NULL` 且**数据库没有默认值**（Prisma 的 `uuid()` 是客户端默认，见 `01-账号与认证/02-Prisma.md` §8 坑）。Python 侧必须**自己生成 id**（如 `str(uuid4())`）再插入，否则数据库拒收 |
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

### 9.1 与 Prisma 的对照（差异与取舍）

上面的表只列了「名字级」对应；这里讲**为什么这么设计、各自牺牲了什么**：

| 维度 | Prisma（schema-first） | SQLAlchemy（code-first） | 取舍 |
| --- | --- | --- | --- |
| **真源** | 独立的 `schema.prisma`（语言中立） | Python 类本身 | Prisma 的真源不绑定语言、能**生成**客户端与 SQL；SQLAlchemy 的真源就是类，**没有代码生成**，但类可直接当 Python 代码读、IDE 友好 |
| **谁建表** | 迁移拥有 DDL | 只映射、不建表 | **单一主人**避免两套迁移打架；代价是 Python 侧**不能自己演进表结构**，改列必须走 Prisma |
| **查询风格** | `prisma.user.findUnique({ where: ... })`（生成的链式客户端） | `select(User).where(User.email == ...)`（面向**类属性**拼 SQL 表达式） | Prisma 查询短、类型安全开箱即得；SQLAlchemy 查询更啰嗦，但**可组合、透明**——你几乎是在「拼积木式地写 SQL」，能读到实际生成什么 |
| **类型来源** | 代码生成 → `user.email` 编译期就是 `string` | `Mapped[str]` 注解 → 类型检查器可推断 | 两者都能给 IDE 类型；Prisma 是**生成**的、更强；SQLAlchemy 依赖你**正确写注解** |
| **关系/默认值的表达位置** | 全写在 schema DSL（`@relation` / `@default`） | 散落在类定义里（`relationship` / `server_default`） | Prisma 一份文件看全貌；SQLAlchemy 信息分散，但更贴近代码、便于局部修改 |
| **运行期心智** | 一个 `PrismaClient` 包办（连接、查询、序列化） | engine + Session 两层，要理解工作单元 / commit / expire | Prisma 上手快、心智轻；SQLAlchemy 概念多，但掌控力强 |

> **一句话取舍**：本项目让两种范式**共存**——**Prisma 拥有结构与客户端生成，SQLAlchemy 只负责映射与读写**。同一张 `users` 表因此有了「两个视角」：TS 侧看到的是「schema + 生成客户端」，Python 侧看到的是「一个映射类 + 一个 Session」。这也是「迁移所有权」（§6.6）在语言层面的由来。

### 9.2 与 NestJS/TS 的对照（与 Python 语言相关的部分）

只挑**和 Python 语言机制挂钩**的点对照：

| 维度 | NestJS / TS | api-py / Python | 为什么 |
| --- | --- | --- | --- |
| **单例怎么来** | `@Injectable()` + IoC 容器托管单例（`PrismaService`） | **模块顶层** `engine = create_engine(...)`——模块只导入一次即天然单例 | Python 这里**不用容器**；「模块级单例」是它的惯用法（§6.8） |
| **映射靠什么** | TypeORM 一类靠**装饰器** `@Entity()` + `reflect-metadata`（需 `experimentalDecorators`） | SQLAlchemy 靠**类型注解 + 元类**（`Mapped`/`mapped_column`），装饰器是语言内置的 | TS 装饰器是「编译期特性 + 配置开关」；Python 装饰器是**普通函数**（阶段 0 · 00 §4.14），元类更是语言原生机制 |
| **类型是否运行期可见** | TS 类型**被擦除**，ORM 要靠装饰器元数据补 | Python 注解**保留到运行期**，SQLAlchemy 直接读它 | 这是「同一份类声明既是类型、又是映射」的根本原因（§6.7） |
| **列值会被类型校验吗** | 编译期类型不拦运行期值 | 注解也**不校验值**；列值约束来自**数据库**（`NOT NULL`/`UNIQUE` 等）而不是 Python 类型 | 别指望 `Mapped[str]` 能拦住写错的值——见阶段 2 · 04 §6.2 的 `ForeignKey` 同理 |
| **实例属性怎么存** | `this.name` 直接挂在对象上 | 类属性被换成 `InstrumentedAttribute` 描述符，实例访问再走「取列值」 | 所以 `User.id`（类级）能当查询条件，TS 的类属性不能（§6.7） |
| **导入/启动** | 按**文件相对路径**解析模块 | 按**包路径**（`sys.path`），**启动目录**影响能否 import | TS 从项目任意处都能按相对路径找；Python 看你**从哪个目录启动**（阶段 0 · 00 §5.3、§8 坑） |

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
| `Mapped`/`mapped_column` 的**运行期机制**（注解只是声明 → 元类收集 → `InstrumentedAttribute` 描述符） | **首次教学于本篇（§6.7）** |
| `expire_on_commit` 与「commit 后属性过期」的困惑 | **首次教学于本篇（§6.8）** |
| `server_default`（数据库端默认）vs `default`/`onupdate`（应用端默认）；`func.now()` | **首次教学于本篇（§6.9）** |
