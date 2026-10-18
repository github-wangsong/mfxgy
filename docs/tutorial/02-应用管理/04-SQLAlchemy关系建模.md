# 04 · SQLAlchemy 关系建模：relationship / ForeignKey / cascade

> 所属：阶段 2 · 应用管理
> 本篇覆盖：`apps/api-py/app/models/app.py`、`apps/api-py/app/models/user.py`、`apps/api-py/app/models/__init__.py`
> **本篇首次教学：`relationship()` 与 `back_populates` 的双向对称 · `ForeignKey`（列级外键）· 外键属性名与数据库列名的对应（`owner_id`）· cascade 的两层含义（数据库层 `ON DELETE CASCADE` vs ORM 层 `cascade`）· 写入默认值的所有权边界（`default` / `onupdate`；DB 触发器为权威、ORM 为兜底）· 同一张表在 Prisma（schema-first）与 SQLAlchemy（code-first）中的两种声明对照**
> （`DeclarativeBase` / `Mapped` / `mapped_column` / `__tablename__` / Engine-Session 生命周期 / `create_engine` / `SessionLocal` / `postgresql+psycopg://` / **迁移所有权** 已在 `01-账号与认证/04-SQLAlchemy2.0.md` 教过；Prisma 的 `App` 模型与 `apps` 表迁移见 `02-应用管理/02-Prisma关系建模.md`；本篇只引用、不重讲）

---

## 1. 本篇目标

- 用 SQLAlchemy 把 TS 侧 Prisma 迁移已经建好的 **`apps` 表**映射成 Python 侧的 `App` 类。
- 在 `User` 与 `App` 之间建立**双向关系**：一个用户有多个应用，一个应用归属一个用户。
- 全程**不产生任何 DDL**——本项目的建表/改表仍由 Prisma 独占（见 `01-账号与认证/04-SQLAlchemy2.0.md` 的「迁移所有权」）。
- 讲清一条**真实的所有权边界**：DDL 归 Prisma；`updated_at` 的默认值现由 **DB 层（`DEFAULT now()` + 触发器）**保证，ORM 侧的 `default`/`onupdate` 只作**兜底**（双保险）。

**验收标准**：在 `apps/api-py` 目录执行一段查询脚本后，能打印出 `apps` 表的行、并顺着关系取到「该应用的属主邮箱」，例如：

```
apps: 1
a5340be5-0f19-4dcf-9002-43de66188139 cross-app-141250 chatflow 1ac83dba-8442-4da8-8912-7f733574899e x-141250@example.com 2026-10-18 08:38:09.896000
```

即：**Prisma 建的表 + SQLAlchemy 关系映射**，两者对接成功且 `app.owner` 能取到 `User`。

> ⚠️ 本篇**不新增依赖、不改 `pyproject.toml`**。`sqlalchemy` 与 `psycopg[binary]` 已在阶段 0 · 06 声明并装好。

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| `uv` 与 Python 3.12、`pyproject.toml` / `.venv` | 阶段 0 · 01、06 |
| PostgreSQL 已启动（Docker `mini-dify-db`） | 阶段 0 · 02 |
| **`apps` 表已由 Prisma 迁移创建**（`apps_owner_id_fkey` 外键、`apps_owner_id_idx` 索引） | `02-应用管理/02-Prisma关系建模.md` |
| `User` 模型与 `SessionLocal`（阶段 1 已建 `users` 映射） | `01-账号与认证/04-SQLAlchemy2.0.md` |
| `db.py`（`engine` / `SessionLocal`） | 阶段 0 · 06、阶段 1 · 04 |

> 与 `01-账号与认证/04-SQLAlchemy2.0.md` 一样，**本篇必须数据库在线**——因为要真正执行 SQL。

---

## 3. 先看清要做什么

阶段 1 只映射了 `users` 一张表。本篇新增 `apps` 表映射，并让两张表「连起来」：

```
apps/api-py/app/models/
├── base.py            # 声明式基类 Base（阶段 1 已建，本篇不变）
├── user.py            # users 表 → User；新增一行 `apps` 关系属性
├── app.py             # apps 表 → App（本篇新增）
└── __init__.py        # 包导出；新增导出 App
```

**心法一句话**：

> `ForeignKey` 描述**表与表在数据库里的连接列**；`relationship` 描述**两个映射类在 Python 对象里的连接**。两者要成对出现、互相指认。

```
users 表                      apps 表
────────────                 ────────────────────────
 id (PK)  ◄──── ForeignKey ── owner_id  (NOT NULL, ON DELETE CASCADE)
   ▲                              ▲
   │ relationship(back_populates) │
 User.apps  ───────────────►  App.owner
```

- **数据库层**：`apps.owner_id` 是一列外键，指向 `users.id`，删用户会级联删应用（`ON DELETE CASCADE`）。
- **对象层**：`User.apps`（列表）与 `App.owner`（单个）互为反向，靠 `back_populates` 双向绑定。

> 这里和阶段 1 · 04 的差别只有「多了一句关系声明、多了一张表的映射」，**范式、Engine/Session、迁移所有权全部照旧**。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | **仓库根** | 确认依赖齐备（本篇无新增依赖，通常显示 `Audited N packages`） | 无报错 |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"` | 任意（需 Docker 在线） | **看一眼 Prisma 建的 `apps` 表结构**，与模型逐字段对照 | 打印 7 列 + 主键/索引/外键 |
| `uv run python -c "…关系查询脚本…"` | **`apps/api-py` 目录** | 用映射读 `apps`，并验证 `app.owner` 可用 | 打印 `apps: N` 与若干行（含属主邮箱） |
| `uv run uvicorn app.main:app --reload --port 8000` | **`apps/api-py` 目录** | 启动服务（下一阶段 / 下一篇要用到） | `Uvicorn running on http://127.0.0.1:8000` |

> 从仓库根也可用 `pnpm dev:api-py`（根脚本为 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`，见阶段 0 · 06 §9）。本篇的查询脚本因为要 `import app`，**必须在 `apps/api-py` 目录内执行**（或同样用 `--directory` 切过去）。

---

## 5. 完整代码

### 5.1 `apps/api-py/app/models/base.py`（未改动，见阶段 1 · 04）

**完整文件路径：`apps/api-py/app/models/base.py`**

本篇**不改** `base.py`——它已经在 `01-账号与认证/04-SQLAlchemy2.0.md` §5.1 完整给出（`class Base(DeclarativeBase)`）。`App` 与 `User` 都继承同一个 `Base`，这是「同一张表只有一个映射类、多个模型共享一个 Session」的前提。

### 5.2 `apps/api-py/app/models/app.py`（本篇新增）

**完整文件路径：`apps/api-py/app/models/app.py`**

```python
"""`apps` 表模型。

重要：该表的 DDL 由 TS 侧 Prisma 迁移拥有（`apps/api-ts/prisma/migrations`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class App(Base):
    __tablename__ = "apps"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    mode: Mapped[str] = mapped_column(String, nullable=False, server_default="chatflow")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # updated_at 现已由数据库层保证：迁移 `add_updated_at_default_and_trigger`
    # 加了 DEFAULT now() 与 BEFORE UPDATE 触发器（手工 SQL 也会刷新）。
    # 这里保留 SQLAlchemy 的 default/onupdate 作为应用层「双保险」：
    # 二者都取 now()，DB 触发器为权威、ORM 值作为兜底，不会冲突。
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship("User", back_populates="apps")
```

**逐行解释**

| 代码 | 作用 |
| --- | --- |
| `__tablename__ = "apps"` | 绑定 Prisma 生成的同名表 `apps`（见 `02-应用管理/02-Prisma关系建模.md` 的 `@@map("apps")`） |
| `id: Mapped[str] = mapped_column(String, primary_key=True)` | 主键，表里是 `text`；值由应用侧 `uuid4()` 生成（DB 无默认） |
| `owner_id: ... ForeignKey("users.id", ondelete="CASCADE")` | **列级外键**：这一列指向 `users.id`；`ondelete="CASCADE"` 让 DDL 的 `ON DELETE CASCADE` 与 ORM 的认知一致（见 §6.2、§6.4） |
| `nullable=False` | 表里 `owner_id` 是 `NOT NULL`（见 Prisma 的 `ownerId String` 非可选） |
| `index=True` | 描述「此列有索引」（表里确有 `apps_owner_id_idx`）；只描述、不建索引 |
| `description: Mapped[str \| None]` | 可空列：表里 `description` 是 `TEXT` 且 Nullable → Python 侧用 `str \| None` 表示「可能为 None」（见下一篇 §6.2） |
| `mode: ... server_default="chatflow"` | 表里确有 `DEFAULT 'chatflow'`，是**数据库端**默认值，写入时可省略 |
| `created_at: ... server_default=func.now()` | 表里 `DEFAULT CURRENT_TIMESTAMP`；`func.now()` 翻译成 SQL `now()` |
| `updated_at: ... default=func.now(), onupdate=func.now()` | **没有 `server_default`**：表里该列现由 DB 层保证（`DEFAULT now()` + `BEFORE UPDATE` 触发器），这里用**ORM 端** `default`/`onupdate` 作为**兜底**（双保险，见 §6.6） |
| `owner: Mapped["User"] = relationship("User", back_populates="apps")` | **关系属性**：通过对象访问 `app.owner` 拿到 `User`；与 `User.apps` 反向绑定（见 §6.1） |

> ⚠️ 注意 `updated_at` 用的是 `default=` / `onupdate=`，而 `created_at` 用的是 `server_default=`。前者是**ORM 端**默认值（Python 发 SQL 时由 ORM 填），后者是**数据库端**默认值（由 DB 填）。`updated_at` 在 DB 层已有 `DEFAULT now()` + 触发器，ORM 侧保留 `default`/`onupdate` 只是**兜底**；两者取同一 `now()`，不会冲突（§6.6）。

### 5.3 `apps/api-py/app/models/user.py`（新增一行关系属性）

**完整文件路径：`apps/api-py/app/models/user.py`**

```python
"""`users` 表模型。

重要：该表的 DDL 由 TS 侧 Prisma 迁移拥有（`apps/api-ts/prisma/migrations`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, server_default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    apps: Mapped[list["App"]] = relationship("App", back_populates="owner")
```

**与阶段 1 · 04 的差异**只有两处：

1. `from sqlalchemy.orm import ... relationship`（新增导入）。
2. 末尾新增 `apps: Mapped[list["App"]] = relationship("App", back_populates="owner")`。

`User` 的列定义**一字未改**——这正体现了「关系建模」只加**对象层的连接**，不碰**表结构**。

### 5.4 `apps/api-py/app/models/__init__.py`（新增导出 `App`）

**完整文件路径：`apps/api-py/app/models/__init__.py`**

```python
"""数据模型包。"""

from app.models.app import App
from app.models.base import Base
from app.models.user import User

__all__ = ["App", "Base", "User"]
```

**解释**：把 `App` 加进包级导出，别的模块可 `from app.models import App`（或如 `apps.py` 那样 `from app.models.app import App`）。导入顺序上 `app.py` 里用到了字符串形式的 `"User"`（前向引用），所以此处「先导入 `App`、再导入 `User`」不会造成循环导入问题——`relationship` 的字符串目标是在**映射配置（mapper configure）时**才解析的。

> **为什么写字符串 `"App"` / `"User"` 而不是直接写类？** 因为 `User` 与 `App` **互相引用**：`App.owner` 要引用 `User`，`User.apps` 要引用 `App`。若直接写类名会形成循环导入。SQLAlchemy 允许用**字符串**延迟解析——等所有类都定义完，再统一把字符串换成真实类。这是处理双向关系的标准写法。

---

## 6. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 2 · 04」并直接使用。

### 6.1 `relationship()` 与 `back_populates` —— 双向对称

**是什么**：`relationship()` 在**映射类上**声明一个「关系属性」。它不是数据库里的列，而是**两个类之间的对象导航**——让你能 `app.owner` 拿到用户、`user.apps` 拿到列表，SQLAlchemy 需要时自动帮你查询。

**基本语法**

```python
from sqlalchemy.orm import Mapped, relationship

class User(Base):
    apps: Mapped[list["App"]] = relationship("App", back_populates="owner")

class App(Base):
    owner: Mapped["User"] = relationship("User", back_populates="apps")
```

**四个要点**

| 要点 | 说明 |
| --- | --- |
| **一侧是"多个"、一侧是"一个"** | `User.apps` 是 `Mapped[list["App"]]`（一对多里的"多"端）；`App.owner` 是 `Mapped["User"]`（"一"端）。SQLAlchemy 从类型注解推断这是「一对多」 |
| **`back_populates` 必须两边都写、且互相指认** | `User.apps` 写 `back_populates="owner"`（→ 指向 `App` 上的 `owner`）；`App.owner` 写 `back_populates="apps"`（→ 指向 `User` 上的 `apps`）。**这两句是对称的一对**，缺一不可、写反即报错 |
| **为什么不用 `backref`** | 老写法 `relationship("App", backref="apps")` 只在一侧声明、另一侧自动生成。`back_populates` 是 2.0 推荐的**显式双向**写法：两侧都写出来，IDE 与类型检查器能同时看到，更清晰、也更利于理解 |
| **对象层 ≠ 表结构** | `relationship` **不会**产生任何列或 DDL；表里的外键列是由 `mapped_column(..., ForeignKey(...))` 描述的（见 §6.2） |

**本例为什么这么用**：契约不允许应用暴露属主以外的用户信息，也不要求接口返回 `owner` 对象，但**关系让 Python 代码能自然地表达归属**（例如查询脚本里 `a.owner.email`）。它与 `ForeignKey` 是「同一根连接的两端」：数据库里靠 `owner_id` 连，对象里靠 `owner`/`apps` 连。

> **常见误解**：以为写了 `relationship` 就会自动 JOIN。其实默认是**惰性加载（lazy）**——访问 `a.owner` 时才发出第二条 `SELECT`。这在本项目完全够用（单次操作范围小）；若将来列表页要一次带出属主，可显式 `joinedload()` 优化。

### 6.2 `ForeignKey` —— 列级外键

**是什么**：`ForeignKey("users.id")` 声明「**这一列**引用**另一张表的某一列**」。它是写在 `mapped_column` 里的**列级**参数，描述的是**数据库层的连接**。

**基本语法**

```python
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

class App(Base):
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
```

| 参数 | 含义 |
| --- | --- |
| `"users.id"` | 目标表.目标列；用**字符串**写（允许延迟解析，避免循环导入） |
| `ondelete="CASCADE"` | 告诉 SQLAlchemy「这张表的外键在数据库里的删除行为是 CASCADE」。它**只是描述**，不建约束（DDL 归 Prisma）——但写清楚后，ORM 对「删父行会连删子行」有正确预期（配合 §6.4 理解） |
| `nullable=False` | 与表里 `NOT NULL` 对齐 |
| `index=True` | 描述「此列有索引」，对应表里的 `apps_owner_id_idx` |

**和 `relationship` 的分工**

- `ForeignKey(...)`：**列级**、描述**数据库**里的外键 → 决定 `SELECT ... JOIN` 的可用性。
- `relationship(...)`：**类级**、描述**对象**间的导航 → 决定 `app.owner` 能不能用。

两者通常**同时出现**：外键给出「连什么」，关系给出「怎么用」。

### 6.3 为什么外键属性名要与数据库列名对应（`owner_id`）

**问题**：Python 侧为什么把属性叫 `owner_id`，而不是 `ownerId` 或 `owner`？

**答案**：因为本项目的映射策略是「**Python 属性名 == 数据库列名**」。这不是随便定的，有实打实的后果：

1. **默认列名推导**：`mapped_column(String, ForeignKey(...))` 若不显式给列名，SQLAlchemy 默认用**属性名**当列名。表里列就叫 `owner_id`，所以属性也必须叫 `owner_id`——否则 ORM 发 SQL 时会去找一个不存在的列，报 `column apps.ownerId does not exist`。
2. **契约字段名是另一回事**：契约里对外字段叫 **`ownerId`（camelCase）**，那是**API 响应**的命名；而 ORM 层的 `owner_id`（snake_case）对齐的是**数据库列名**。两者的转换由下一篇的 `_to_app_response` 显式完成（`ownerId=app.owner_id`）。
3. **Prisma 侧同理**：Prisma 里也是 `ownerId String @map("owner_id")`——**字段 `ownerId`、列 `owner_id`**，用 `@map` 把两者分开。SQLAlchemy 没有 `@map` 这一层，所以直接把属性钉成列名 `owner_id`。

**对照表（同一个"归属用户"的三种命名）**

| 层 | 名字 | 由谁负责 |
| --- | --- | --- |
| 数据库列 | `owner_id` | Prisma 迁移（DDL） |
| ORM 属性 | `owner_id` | SQLAlchemy 映射（Python 属性名 = 列名） |
| API 字段 | `ownerId` | 契约 + 响应模型（下一篇转换） |

**记忆**：**越靠近数据库，越是 snake_case 的列名；越靠近 API，越可能是 camelCase 的契约名；中间由 ORM 与响应模型各转一道。**

### 6.4 cascade 的两层含义 —— 数据库层 `ON DELETE CASCADE` vs ORM 层 `cascade`

「级联删除」在本项目里有**两个完全不同的层**，混起来会踩坑：

| 层 | 写法 | 谁执行 | 触发时机 | 本项目状态 |
| --- | --- | --- | --- | --- |
| **数据库层** | Prisma 迁移里的 `ON DELETE CASCADE`；SQLAlchemy 侧用 `ForeignKey(..., ondelete="CASCADE")` **描述**它 | **PostgreSQL** | 任一直执行 `DELETE FROM users WHERE id=?` 时，DB 自动删掉该用户的 apps | ✅ 表里确有（`apps_owner_id_fkey`） |
| **ORM 层** | `relationship(..., cascade="all, delete-orphan")` | **SQLAlchemy** | 你在 Session 里 `session.delete(user)` 时，ORM 把子对象一并标记删除 | ❌ 本项目**没写** `cascade` |

**关键区别**

- **数据库层**是「**谁真删父行，DB 就顺手删子行**」——包括你用 `psql` 手写 SQL、或 Prisma Client 删用户，DB 都会级联。
- **ORM 层**是「**ORM 帮你在对象图里传播删除**」——只有走 `session.delete(...)` 这条路才生效，且需要显式 `cascade` 配置。

**本项目的关系属性为什么没写 `cascade`**：因为本阶段**没有"删除用户"接口**，Python 侧根本不删 `User`。`ondelete="CASCADE"` 已经让 ORM **知道** DB 会级联，够了。

**一个真实的坑（务必记住）**：如果你未来真的在 Python 里 `session.delete(user)`，而关系上**没写** `cascade="all, delete-orphan"`、也**没写** `passive_deletes=True`，SQLAlchemy 的默认行为是去**把子行的外键置为 `NULL`**（"nullify"）——而 `apps.owner_id` 是 `NOT NULL`，于是直接报错。正确做法二选一：

```python
# 方案 A：依赖数据库级联，告诉 ORM「别管子表」
owner: Mapped["User"] = relationship("User", back_populates="apps", passive_deletes=True)

# 方案 B：让 ORM 显式连带删除子对象
apps: Mapped[list["App"]] = relationship("App", back_populates="owner", cascade="all, delete-orphan")
```

> 一句话：**数据库层保"任何删除路径都级联"，ORM 层管"我这条删除路径怎么办"。** 本项目只靠前者的 `ondelete="CASCADE"`，不写 ORM `cascade`。

### 6.5 重点对照：同一条 `apps` 表，Prisma vs SQLAlchemy 的两种声明

同一张表，在 TS 侧（schema-first）与 Python 侧（code-first）各写一次。把它们并排看，能一次看清两套 ORM 的取舍：

| 方面 | Prisma（api-ts · schema-first） | SQLAlchemy（api-py · code-first） |
| --- | --- | --- |
| 定义文件 | `apps/api-ts/prisma/schema.prisma` | `apps/api-py/app/models/app.py` |
| 表名 | `@@map("apps")` | `__tablename__ = "apps"` |
| 主键 | `id String @id @default(uuid())` | `id: Mapped[str] = mapped_column(String, primary_key=True)` |
| **id 默认值归属** | `@default(uuid())` 是**客户端**默认：Prisma 生成 UUID 再写入（DDL 里 `id` 无默认） | 同样**无 DB 默认**：Python 用 `uuid.uuid4()` 生成（见下一篇的 `create_app`） |
| 外键列 | `ownerId String @map("owner_id")` + `owner User @relation(fields:[ownerId], references:[id], onDelete: Cascade)` | `owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"))` |
| 外键命名 | 字段 `ownerId` 与列 `owner_id` **用 `@map` 分开** | 属性==列名，直接叫 `owner_id`；契约的 `ownerId` 在响应模型里转换 |
| 关系 | `owner User @relation(...)`（一的一方写 `apps App[]`） | `owner` + `User.apps`，用 `back_populates` 显式双向 |
| 可空列 | `description String?` | `description: Mapped[str \| None]` + `nullable=True` |
| 列默认值 | `mode String @default("chatflow")` → DDL `DEFAULT 'chatflow'` | `server_default="chatflow"`（描述同一个 DB 默认） |
| 时间列 | `createdAt DateTime @default(now()) @map("created_at")`；`updatedAt DateTime @updatedAt @map("updated_at")` | `created_at` 用 `server_default=func.now()`；`updated_at` 用 **ORM 端** `default=/onupdate=`（见 §6.6） |
| 索引 | `@@index([ownerId])` | `index=True` |
| 谁建表 | **Prisma 迁移**（DDL 拥有者） | **不建表**，只映射 |
| 客户端/对象 | `prisma.app`（生成的类型安全客户端） | `App` 类 + `Session` |

**一句话总结两者差异**：

- **Prisma 的 schema 是"唯一真源"**：它既生成类型安全的客户端，又负责建表迁移；映射信息（字段↔列、关系、默认值）全写在这一份 DSL 里。
- **SQLAlchemy 的类只是"一张表的视角"**：它不建表，只让 Python 能用对象方式读写这张**别人（Prisma）建好的表**；列/关系/默认值信息散落在类定义里。

### 6.6 【重点坑】`updated_at` 曾没有数据库默认值 → 已由 DB 默认值 + 触发器收口

这是理解「所有权边界」的最佳样本。

**旧现象**：`apps` 表的 `updated_at` 列在旧迁移的 DDL 里是 `NOT NULL`，但**没有任何默认值**。若 Python 侧插入时不给这一列赋值，数据库会以 `null` 违反非空约束：

```
psycopg.errors.NotNullViolation: null value in column "updated_at" of relation "apps" violates not-null constraint
```

**旧 DDL 长这样**（Prisma 迁移原文）：

```sql
CREATE TABLE "apps" (
    ...
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,          -- ← 注意：NOT NULL 且没有 DEFAULT
    ...
);
```

**为什么 Prisma 迁移会这样**：Prisma 的 `@updatedAt` 是**客户端行为**——由 Prisma Client 在每次写库时**在 SQL 里带上** `updated_at`，而不是让数据库用触发器/默认值维护。所以旧 DDL 里 `updated_at` 就只有 `NOT NULL`、没有 `DEFAULT`。一旦**绕过 Prisma Client**（比如用 SQLAlchemy 直接写库、手工 SQL），这个"客户端默认值"就没人提供了。

**现已收口（DB 触发器为权威 + ORM 兜底的双保险）**：

1. **DB 层（权威）**：新增迁移 `20261018120000_add_updated_at_default_and_trigger` 给该列加 `SET DEFAULT now()`，并建 `BEFORE UPDATE` 触发器刷新（手工 SQL 也会触发）；`schema.prisma` 的 `updatedAt` 也补了 `@default(now())`。
2. **ORM 层（兜底）**：SQLAlchemy 侧保留 `default`/`onupdate`：

```python
updated_at: Mapped[datetime] = mapped_column(
    DateTime, nullable=False, default=func.now(), onupdate=func.now()
)
```

| 参数 | 作用 |
| --- | --- |
| `default=func.now()` | **INSERT 时**：ORM 在 `INSERT` 语句里填 `now()`（与 DB 默认取同一值） |
| `onupdate=func.now()` | **UPDATE 时**：ORM 把 `updated_at` 更新为 `now()`（与 DB 触发器取同一值） |

**这仍是「所有权边界」的体现**：

| 事项 | 归属 | 说明 |
| --- | --- | --- |
| **表结构 / 列是否存在 / DB 默认值与触发器** | **Prisma** | DDL 唯一真源；Python 不能也不该去 `ALTER TABLE` |
| **写入时的列值（ORM 兜底）** | **ORM（SQLAlchemy）** | 与 Prisma Client 一样是"客户端侧"的填值责任，在 DB 机制之外再兜一层 |

> 一句话：**DDL 归 Prisma**；`updated_at` 的默认值现由 DB（`DEFAULT now()` + `BEFORE UPDATE` 触发器）保证，SQLAlchemy 的 `default`/`onupdate` 保留为**双保险**（两者取同一 `now()`，不会冲突）。实测：手工 `INSERT`/`UPDATE` 与两端 `PATCH /apps/{id}` 均正常刷新 `updated_at`。

---

## 7. 验收自测

### 方式 A：先看表结构（确认 Prisma 建了 `apps`）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"
```

**实测输出**

```
                                   Table "public.apps"
   Column    |              Type              | Collation | Nullable |      Default
-------------+--------------------------------+-----------+----------+-------------------
 id          | text                           |           | not null |
 owner_id    | text                           |           | not null |
 name        | text                           |           | not null |
 description | text                           |           |          |
 mode        | text                           |           | not null | 'chatflow'::text
 created_at  | timestamp(3) without time zone |           | not null | CURRENT_TIMESTAMP
 updated_at  | timestamp(3) without time zone |           | not null | now()
Indexes:
    "apps_pkey" PRIMARY KEY, btree (id)
    "apps_owner_id_idx" btree (owner_id)
Foreign-key constraints:
    "apps_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
Triggers:
    apps_set_updated_at BEFORE UPDATE ON apps FOR EACH ROW EXECUTE FUNCTION apps_set_updated_at()
```

把它与 `app.py` 逐字段对照：**列名、类型、可空性、默认值、索引、外键全部对得上**。特别注意 `updated_at` 那行——`Default = now()` 与 `Triggers` 里的 `apps_set_updated_at`，正是 §6.6 讲的收口（DB 层保证 + ORM 兜底）。

### 方式 B：用关系映射读表（本篇核心验收）

**命令（在 `apps/api-py` 目录执行）**

```bash
uv run python -c "from app.db import SessionLocal; from app.models.app import App; from app.models.user import User; from sqlalchemy import select; s=SessionLocal(); rows=s.scalars(select(App)).all(); print('apps:', len(rows)); [print(a.id, a.name, a.mode, a.owner_id, a.owner.email, a.updated_at) for a in rows[:3]]; u=s.scalars(select(User)).first(); print('user.apps:', len(u.apps) if u else None); s.close()"
```

**实测输出**（行数与数据依你库里实际内容而定）

```
apps: 1
a5340be5-0f19-4dcf-9002-43de66188139 cross-app-141250 chatflow 1ac83dba-8442-4da8-8912-7f733574899e x-141250@example.com 2026-10-18 08:38:09.896000
user.apps: 0
```

能打印出 `a.owner.email`，说明 **`App.owner` 关系与 `User` 映射对接成功**；`user.apps` 能取到列表（此处第一个 `User` 恰好不是该 app 的属主，故为 0），说明**反向关系 `User.apps` 也成立**。

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 依赖就位 | `uv sync --project apps/api-py` | 无报错 |
| 表已由 Prisma 建好 | `docker exec … psql … -c "\d apps"` | 打印 7 列 + 索引 + 外键（方式 A） |
| 关系映射成立 | 方式 B 的查询脚本 | 打印 `apps: N`（含属主邮箱）与 `user.apps` |
| **未产生 DDL** | 观察库中表数量 / 迁移记录 | Python 侧不新增、不修改任何表 |

> 「未产生 DDL」怎么确认？本篇 Python 侧只执行 `SELECT`（下一篇才有 `INSERT`/`UPDATE`/`DELETE`），从不执行 `CREATE`/`ALTER`；也可用 `psql` 的 `\dt` 看表清单，与只跑过 Prisma 迁移时一致。

---

## 8. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **`updated_at` 插入报非空违例**（已收口） | 旧版 `NotNullViolation: null value in column "updated_at" … violates not-null constraint` | 旧表里 `updated_at` **NOT NULL 且无 DEFAULT**（Prisma 的 `@updatedAt` 是客户端行为）。**已收口**：迁移 `20261018120000_…` 给该列加 `SET DEFAULT now()` + `BEFORE UPDATE` 触发器（DB 触发器为权威），ORM 侧保留 `default=func.now(), onupdate=func.now()` 作为**兜底**（见 §6.6） |
| `back_populates` 只写了一侧 / 写错名字 | 映射配置报错：`relationship 'App.owner' … back_populates 'X' does not reference a relationship` | `back_populates` 必须**两侧都写、名字互为对方属性名**。`User.apps` → `"owner"`，`App.owner` → `"apps"`（见 §6.1） |
| 外键属性名写成 `ownerId` | 运行期 `column apps.ownerId does not exist` | ORM 属性名默认当列名用；DB 列是 `owner_id`，属性就必须叫 `owner_id`（见 §6.3） |
| `ForeignKey` 目标写错 | 映射配置报错：`Could not determine join condition` / `no such table` | 目标要写成 `"users.id"`（表名.列名），与 Prisma 的 `references: [id]` 一致 |
| 混淆两层 cascade | 想删用户却报「无法把 `owner_id` 置空」 | 数据库层 `ondelete="CASCADE"` 与 ORM 层 `cascade` 是两回事；本项目只靠前者。若要在 ORM 里 `session.delete(user)`，需加 `passive_deletes=True` 或 `cascade="all, delete-orphan"`（见 §6.4） |
| 以为写了 `relationship` 就会 JOIN | 列表查询仍发多条 `SELECT` | 关系默认**惰性加载**，访问时才查；需要一次带出属主用 `joinedload()` |
| 循环导入 | `ImportError: cannot import name 'App' …` | 两模型互相引用，`relationship`/`ForeignKey` 用**字符串**延迟解析；`__init__.py` 先导入 `App` 再导入 `User`（见 §5.4） |
| 改了模型不生效 | 访问报 `AttributeError` / 列不存在 | 模型是代码，**改完要重启进程**；真要改表结构，那属于 Prisma 的事 |
| 在仓库根跑查询脚本 | `ModuleNotFoundError: No module named 'app'` | 要进 `apps/api-py`，或用 `uv run --directory apps/api-py …`（见阶段 0 · 06 §9） |
| `uv` 命令不被识别 | `The term 'uv' is not recognized` | `uv` 已在**用户 PATH** 中，只是**安装前就已打开**的 shell 继承了**旧 PATH**；重启终端 / IDE 即可（见阶段 0 · 01） |

---

## 9. 与 api-ts 的对照

| 概念 | Prisma（api-ts） | SQLAlchemy（api-py） |
| --- | --- | --- |
| 范式 | schema-first（`schema.prisma`） | code-first（`class App(Base)`） |
| 定义位置 | `prisma/schema.prisma` 的 `model App` | `app/models/app.py` 的 `class App` |
| 谁建表 | **Prisma 迁移**（DDL 拥有者） | **不建表**，仅映射 |
| 字段↔列 | 字段 `ownerId`，列 `owner_id`，用 `@map` 桥接 | 属性名 == 列名 `owner_id`；契约名 `ownerId` 在响应层转 |
| 关系 | `owner User @relation(fields:[ownerId], references:[id], onDelete: Cascade)` | `ForeignKey("users.id", ondelete="CASCADE")` + `relationship(back_populates=…)` |
| 双向 | 一端写 `User.apps App[]`，另一端 `App.owner User` | `User.apps` 与 `App.owner` 都写、且 `back_populates` 互指 |
| 级联删除 | 迁移里 `ON DELETE CASCADE` | `ondelete="CASCADE"`（描述 DB 行为）；**数据库层**执行 |
| 时间列默认 | `@default(now())` / `@updatedAt` 由**客户端**赋值（并已由迁移在 DB 层补 `DEFAULT now()` + 触发器） | `created_at` 用 `server_default`；`updated_at` 用 `default`/`onupdate` 作为兜底 |
| 查询写法 | `prisma.app.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } })` | `session.scalars(select(App).where(App.owner_id == owner_id).order_by(App.created_at.desc()))` |
| 迁移工具 | `prisma migrate` | **无**（Alembic 留待 Python 有专属表时再考虑） |

两套实现操作的是**同一张 `apps` 表**，对外结构由契约（`02-应用管理/01-契约扩展.md`）统一。

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| `relationship()` 与 `back_populates` 的双向对称 | **首次教学于本篇** |
| 关系用字符串目标延迟解析（避免循环导入） | **首次教学于本篇** |
| 关系的惰性加载（lazy）与 `joinedload` 的取舍 | **首次教学于本篇** |
| `ForeignKey`（列级外键，`ForeignKey("users.id")`） | **首次教学于本篇** |
| 外键属性名与数据库列名对应（`owner_id` vs 契约 `ownerId` vs Prisma `@map`） | **首次教学于本篇** |
| cascade 的两层含义（数据库层 `ON DELETE CASCADE` vs ORM 层 `cascade`；`passive_deletes=True`） | **首次教学于本篇** |
| 写入默认值的所有权边界（`default` / `onupdate` vs `server_default`；`updated_at` 由 DB 默认值 + 触发器保证、ORM 兜底） | **首次教学于本篇** |
| 同一张表的 Prisma（schema-first）与 SQLAlchemy（code-first）声明并列对照 | **首次教学于本篇** |
