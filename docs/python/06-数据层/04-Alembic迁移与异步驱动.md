# 04 · Alembic 迁移与异步驱动

> 所属：阶段 6 · 数据层（最后一篇）
> 本篇覆盖：迁移要解决的三个问题、`alembic init` 与目录结构、`alembic.ini` 关键项、`env.py` 的同步/异步两套写法、`target_metadata` 与 `naming_convention`、`revision --autogenerate` 的完整产物逐行解读、`autogenerate` 的能力边界、手写迁移的 `op` 速查、数据迁移、PostgreSQL 上的安全 DDL（`CREATE INDEX CONCURRENTLY`、`expand/contract`、`lock_timeout`）、**接管已有库的基线**（`baseline` + `stamp` + `include_object`）、异步驱动选型（`asyncpg` vs `psycopg`）、`create_async_engine` / `async_sessionmaker` / `AsyncSession`、Alembic 官方异步模板、启动与 CI 里的迁移执行、并发迁移的锁
> **本篇首次教学：迁移版本链与 `alembic_version`、`revision` 文件的 `upgrade`/`downgrade` 契约、「模型是期望态、迁移是变更史」的双轨心智、`autogenerate` 只是**生成草稿**不是权威、`naming_convention` 为什么必须在建表前定义、`autocommit_block()` 执行非事务 DDL、`stamp` 与 `upgrade` 的区别、`include_object` 做「表级 DDL 归属」、`async_engine_from_config` + `connection.run_sync()` 的桥接原理、`AsyncSession` 下 `add` 不 await 而 `flush`/`execute`/`commit` 要 await、PgBouncer 下必须关预备语句缓存**
> 上一篇：[03 关系、级联与查询](./03-关系、级联与查询.md)
> 项目锚点：`apps/api-py/alembic.ini`、`apps/api-py/alembic/env.py`、`apps/api-py/alembic/versions/`、`apps/api-py/app/models/base.py`（`MetaData` + 命名约定）、`apps/api-py/app/db.py`（同步引擎）与 `app/db_async.py`（异步引擎）、`apps/api-ts/prisma/schema.prisma`（TS 侧的 DDL 归属方）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 说清「模型」「迁移」「数据库」三者的关系，以及为什么不能靠 `Base.metadata.create_all()` 上线。
2. 从零初始化 Alembic，并解释 `alembic.ini` 与 `env.py` 各自负责什么。
3. 让 `--autogenerate` 生成**可审阅**的迁移，而不是一份看不懂的草稿。
4. 说出 `autogenerate` 检测不到哪些变更，并手写对应迁移。
5. 在双栈共表的项目里，用 `stamp` + `include_object` 做到**表级 DDL 归属**，不让两个工具互删表。
6. 用 `asyncpg` 起异步引擎，写出正确的 `AsyncSession` 增删改查。
7. 把 Alembic 切到异步模板，并解释 `run_sync()` 为什么必须存在。
8. 在 PG 上安全地做大表变更（不锁死线上）。

**验收标准（对齐 INDEX 阶段 6 的验收）**

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 初始化 | `alembic init alembic` 生成 `alembic.ini` + `alembic/` 目录 |
| 2 | 空库升级 | `alembic upgrade head` 后 `alembic_version` 只有一行 |
| 3 | 自动生成 | `alembic revision --autogenerate -m "baseline"` 生成的草稿包含 5 张表与外键 |
| 4 | 可回滚 | `alembic downgrade base` 后表全部消失，再 `upgrade head` 能重建 |
| 5 | 漂移检测 | 手动改库后 `alembic check` 报出差异 |
| 6 | 基线 | 已有 Prisma 库上 `alembic stamp head`，不重复建表 |
| 7 | 异步读写 | `scripts/async_lab.py` 用 `AsyncSession` 完成增、查、删 |
| 8 | 无隐式 IO | 异步查询不写 `selectinload` 时不触发 `MissingGreenlet`（因为按主键取或已预加载） |

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [01 SQLAlchemy 2.0 核心](./01-SQLAlchemy2.0核心.md)（`Base`/`Mapped`/`Engine`）、[02 Session 生命周期与依赖](./02-Session生命周期与依赖.md)（`SessionLocal`、`get_db`）、[03 关系、级联与查询](./03-关系、级联与查询.md)（`relationship`、`selectinload`） |
| 已掌握 | SQL 的 `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX`；PG 能连上并建库 |
| 环境 | `apps/api-py/.env` 里有 `DATABASE_URL=postgresql+psycopg://...` |

安装依赖（在 `apps/api-py`）：

```bash
uv add sqlalchemy "psycopg[binary]"
uv add --dev alembic
# 异步驱动（本篇后半段）
uv add asyncpg
```

> 版本要求：SQLAlchemy 2.0+、Alembic 1.13+（`compare_type` 从 1.12 起默认开启，`alembic check` 从 1.9 起可用）。

---

## 3. 迁移到底在解决什么

### 3.1 三个世界

```
模型（Python 类）       ←→  期望态：我想要什么样的表
迁移（versions/*.py）   ←→  变更史：从 A 到 B 要做哪些 DDL
数据库（PG 里的表）     ←→  现实态：此刻真实存在的表
```

| 做法 | 问题 |
| --- | --- |
| `Base.metadata.create_all(engine)` | 只建**不存在的**表；改字段、加索引、删列一律不管；无版本记录 |
| 手写 SQL 发给 DBA | 无法保证每个环境一致；忘记执行没人知道 |
| Alembic | 每次变更都有版本号、可回滚、可审阅、可重复执行 |

> 一句话：**`create_all` 适合「本地临时造一个库」，不适合「让所有环境长得一样」**。

### 3.2 `alembic_version` 是什么

Alembic 在数据库里建一张只有一列的表：

```sql
CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);
```

| 事实 | 说明 |
| --- | --- |
| 只有一行 | 记录「这个库当前停在哪个 revision」 |
| 由 Alembic 维护 | 不要手动改（除非 `stamp`） |
| 无行 = 空库 | 首次 `upgrade` 会插入 |
| 与 `_prisma_migrations` 并存 | 两套工具各有自己的版本表，互不干扰 |

### 3.3 版本链

```
base（空库）
  └─ 1a2b（baseline）
       └─ 3c4d（add tag）
            └─ 5e6f（add index concurrently）
                 └─ head（当前最新）
```

每个 revision 文件用 `down_revision` 指向上一个，形成**单向链表**。`upgrade head` 就是「从当前节点一路走到 head」，`downgrade -1` 是「往回走一步」。

> `head` 是可变指针（永远指最新），`revision id` 是固定值。**提交代码时迁移文件必须一起提交**，否则别人拉代码后 `head` 对不上。

---

## 4. 初始化

### 4.1 命令

```bash
cd apps/api-py
alembic init alembic
```

```
apps/api-py/
├── alembic.ini                  # 配置（路径、日志、URL 占位）
├── alembic/
│   ├── env.py                   # 运行时：怎么连库、metadata 从哪来
│   ├── script.py.mako           # 新迁移文件的模板
│   ├── README
│   └── versions/                # 迁移文件都放这里
│       └── （空）
└── app/
    ├── config.py
    ├── db.py
    └── models/
        ├── __init__.py
        ├── base.py
        ├── app.py
        └── conversation.py
```

### 4.2 `alembic.ini` 关键项

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
version_path_separator = os
file_template = %%(year)d%%(month).2d%%(day).2d_%%(hour).2d%%(minute).2d-%%(rev)s_%%(slug)s
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic
```

| 项 | 作用 | 项目取值与理由 |
| --- | --- | --- |
| `script_location` | 迁移脚本目录 | `alembic` |
| `prepend_sys_path` | 把项目根加进 `sys.path` | `.`，这样 `env.py` 能 `import app` |
| `version_path_separator` | 多版本目录的分隔符 | `os`（跨平台） |
| `file_template` | 迁移文件名格式 | 日期 + revision + slug，按时间排序一目了然 |
| `sqlalchemy.url` | 连接串 | **留空**，由 `env.py` 从 `settings` 注入（避免把密码提交进仓库） |

> `file_template` 里为什么是 `%%`？`alembic.ini` 用 `configparser` 解析，`%` 是插值符号，必须转义成 `%%`。同理，URL 里如果有 `%`（密码里常见），注入时要 `.replace("%", "%%")`。

### 4.3 `alembic.ini` 里的 URL 为什么留空

```ini
# ❌ 提交进 Git：密码泄露 + 各环境不一致
sqlalchemy.url = postgresql+psycopg://postgres:123456@localhost:5432/minidify

# ✅ 留空，在 env.py 里读环境变量
sqlalchemy.url =
```

三条环境（本地 / CI / 预发）用同一个 `env.py`，各自读各自的 `.env`——这是「配置与代码分离」在迁移上的体现。

---

## 5. `base.py`：命名约定必须最先定义

### 5.1 完整文件

**完整文件路径：`apps/api-py/app/models/base.py`**

```python
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# 约束命名约定：影响 DDL 里约束/索引的名字，也影响 Alembic 能不能「按名字删除」
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
```

### 5.2 为什么不是「可选优化」

| 不设约定 | 设了约定 |
| --- | --- |
| PG 给约束自动起名 `apps_owner_id_fkey` | 统一叫 `fk_apps_owner_id_users` |
| 以后想删约束：`op.drop_constraint(名字)` **不知道名字** | 名字可预测，迁移可写 |
| 两台机器生成的迁移名不同 → 版本漂移 | 名字稳定，diff 干净 |
| `alembic check` 老报「约束名不同」 | 不再误报 |

> 关键：`MetaData(naming_convention=...)` 必须在**任何 `Table` 被创建之前**传入，所以它写在 `Base` 定义处，而不是事后补。已有表再改约定，只会影响新建对象。

### 5.3 让模型都注册进 metadata

**完整文件路径：`apps/api-py/app/models/__init__.py`**

```python
from app.models.base import Base
from app.models.app import App, Tag, app_tags
from app.models.conversation import Conversation, Message
from app.models.user import User

__all__ = [
    "Base",
    "App",
    "Tag",
    "app_tags",
    "Conversation",
    "Message",
    "User",
]
```

| 为什么 | 说明 |
| --- | --- |
| `autogenerate` 只认 `Base.metadata` | 没有被 import 的模型类，表就不会出现在 metadata 里 |
| 一个模块收口 | `env.py` 只需 `from app.models import Base`，不会漏 |
| 避免循环导入 | 模型之间的互相引用用 `TYPE_CHECKING` + 字符串（见 03 篇） |

**经典事故**：新写了 `Tag` 模型，但 `models/__init__.py` 没导出、`env.py` 也没 import → `--autogenerate` 生成空迁移 → 上线后 `tags` 表不存在。

---

## 6. `env.py`：同步版

**完整文件路径：`apps/api-py/alembic/env.py`**

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.models import Base  # 必须导入：把全部模型注册进 metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# configparser 会把 % 当插值符号，密码里带 % 时要转义
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL，不连库（`alembic upgrade head --sql`）。"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：连库执行。"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,   # 迁移是一次性任务，不需要连接池
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

### 6.1 逐项说明

| 代码 | 作用 | 不写会怎样 |
| --- | --- | --- |
| `fileConfig(...)` | 读 `alembic.ini` 的日志配置 | 迁移过程无日志，排查困难 |
| `set_main_option("sqlalchemy.url", ...)` | 注入真实连接串 | 连不上库 / 明文密码入库 |
| `target_metadata = Base.metadata` | 告诉 Alembic「期望态是什么」 | `--autogenerate` 生成空文件 |
| `poolclass=pool.NullPool` | 不复用连接 | 进程退出前连接不释放（小概率卡住） |
| `compare_type=True` | 检测列类型变化 | 从 `String(32)` 改到 `String(64)` 检测不到 |
| `compare_server_default=True` | 检测默认值变化 | `server_default` 改动漏检 |
| `literal_binds=True` | 离线模式把参数直接写进 SQL | 生成带占位符的 SQL，DBA 无法直接执行 |

> `compare_server_default` 在 PG 上会有「等价但字面不同」的误报（如 `now()` 与 `CURRENT_TIMESTAMP`）。项目里若误报太多，可以关掉它，改为在 code review 时人工比对默认值。

### 6.2 离线模式有什么用

```bash
alembic upgrade head --sql > migrate.sql
```

| 场景 | 用途 |
| --- | --- |
| DBA 审核 | 生产变更走工单，先把 SQL 给人看 |
| 无网络环境 | 生成 SQL 拷到跳板机执行 |
| 事故复盘 | 看清这次升级到底发了哪些 DDL |

> 离线模式**不会**更新 `alembic_version`。真正执行后要手动 `alembic stamp head`，否则下次会重复执行。

---

## 7. 生成第一个迁移

### 7.1 命令

```bash
alembic revision --autogenerate -m "baseline: apps / conversations / messages / tags"
```

输出大致：

```
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.autogenerate.compare] Detected added table 'apps'
INFO  [alembic.autogenerate.compare] Detected added table 'conversations'
INFO  [alembic.autogenerate.compare] Detected added table 'messages'
INFO  [alembic.autogenerate.compare] Detected added table 'tags'
INFO  [alembic.autogenerate.compare] Detected added table 'app_tags'
Generating apps/api-py/alembic/versions/20261025_0900-1a2b3c4d5e6f_baseline_apps_conversations_messages_tags.py ... done
```

> `--autogenerate` 需要**连得上库**，因为它要读现实态与 metadata 做差集。空库也能跑（现实态为空）。

### 7.2 生成的文件

**完整文件路径：`apps/api-py/alembic/versions/20261025_0900-1a2b3c4d5e6f_baseline.py`**

```python
"""baseline: apps / conversations / messages / tags / app_tags

Revision ID: 1a2b3c4d5e6f
Revises:
Create Date: 2026-10-25 09:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "1a2b3c4d5e6f"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "apps",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("mode", sa.String(), server_default="chatflow", nullable=False),
        sa.Column(
            "graph_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_apps_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_apps")),
    )
    op.create_index(op.f("ix_apps_owner_id"), "apps", ["owner_id"], unique=False)

    op.create_table(
        "conversations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("app_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["app_id"],
            ["apps.id"],
            name=op.f("fk_conversations_app_id_apps"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_conversations_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversations")),
    )
    op.create_index(op.f("ix_conversations_app_id"), "conversations", ["app_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("conversation_id", sa.String(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_messages_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
        sa.UniqueConstraint(
            "conversation_id", "seq", name=op.f("uq_messages_conversation_seq")
        ),
    )
    op.create_index(
        op.f("ix_messages_conversation_id"), "messages", ["conversation_id"], unique=False
    )

    op.create_table(
        "tags",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_tags_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tags")),
        sa.UniqueConstraint("owner_id", "name", name=op.f("uq_tags_owner_id_name")),
    )

    op.create_table(
        "app_tags",
        sa.Column("app_id", sa.String(), nullable=False),
        sa.Column("tag_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["app_id"],
            ["apps.id"],
            name=op.f("fk_app_tags_app_id_apps"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tag_id"],
            ["tags.id"],
            name=op.f("fk_app_tags_tag_id_tags"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("app_id", "tag_id", name=op.f("pk_app_tags")),
    )


def downgrade() -> None:
    op.drop_table("app_tags")
    op.drop_table("tags")
    op.drop_index(op.f("ix_messages_conversation_id"), table_name="messages")
    op.drop_table("messages")
    op.drop_index(op.f("ix_conversations_app_id"), table_name="conversations")
    op.drop_table("conversations")
    op.drop_index(op.f("ix_apps_owner_id"), table_name="apps")
    op.drop_table("apps")
```

### 7.3 逐段解读

| 片段 | 含义 | 教学点 |
| --- | --- | --- |
| `revision` / `down_revision` | 本节点 id / 父节点 id | 首条迁移 `down_revision = None`，即 `base` |
| `op.create_table(...)` | 生成 `CREATE TABLE` | 列、约束、默认值都在一个调用里 |
| `sa.Column("mode", ... server_default="chatflow")` | DDL 默认值 | 用字符串表示 SQL 字面量；表达式要用 `sa.text()` |
| `server_default=sa.text("'{}'::jsonb")` | JSONB 默认空对象 | `'{}'` 加 `::jsonb`，否则 PG 会当字符串 |
| `postgresql.JSONB(...)` | 方言类型 | 通用 `sa.JSON` 会变成 `json`，用不了 `@>` |
| `sa.ForeignKeyConstraint(..., ondelete="CASCADE")` | 外键与级联 | 必须显式写，Prisma 那边也要对应 |
| `op.f("pk_apps")` | 「名字已定，别再套命名约定」 | 避免二次套用变成 `pk_apps_...` |
| `op.create_index(...)` | 单独建索引 | PG 不会为 FK 自动建索引 |
| `op.drop_table(...)` 逆序 | 先删子表再删父表 | 否则 FK 冲突 |

> **`downgrade` 必须能跑通**。写迁移的最低标准：`upgrade` → `downgrade` → `upgrade` 三连不报错。CI 里应把这条链路跑一遍（见 §15）。

### 7.4 执行与查看

```bash
alembic upgrade head        # 建表 + 写 alembic_version
alembic current             # 1a2b3c4d5e6f (head)
alembic history             # 版本链
psql "$DATABASE_URL" -c "\dt"       # 看到 5 张表 + alembic_version
psql "$DATABASE_URL" -c "select * from alembic_version"
```

---

## 8. `autogenerate` 的能力边界

### 8.1 会检测

| 变更 | 检测 |
| --- | --- |
| 新增 / 删除表 | ✅ |
| 新增 / 删除列 | ✅ |
| 列是否可空 | ✅ |
| 索引、唯一约束 | ✅（大部分） |
| 外键 | ✅ |
| 列类型变化 | ✅（`compare_type=True` 时） |
| 默认值变化 | ✅（`compare_server_default=True` 时，可能有误报） |

### 8.2 不会检测（必须手写）

| 变更 | 原因 | 手写方式 |
| --- | --- | --- |
| 表重命名 | 看起来是「删旧表 + 建新表」 | `op.rename_table("old", "new")` |
| 列重命名 | 看起来是「删列 + 加列」 | `op.alter_column(..., new_column_name="...")` |
| 枚举值增删 | PG enum 在类型层，Alembic 只看到类型名相同 | `op.execute("ALTER TYPE ... ADD VALUE ...")` |
| `CHECK` 约束 | 依赖反射，默认不比较 | `op.create_check_constraint(...)` |
| 表达式索引 / 部分索引 | 反射拿不到完整表达式 | `op.create_index(..., postgresql_where=sa.text(...))` |
| 触发器 / 函数 / 视图 | 不属于 metadata | `op.execute(...)` |
| 数据回填 | 不是 schema 变更 | `op.get_bind().execute(...)` |
| 排序规则、表空间、并发建索引 | DDL 选项不在 metadata | `op.execute(...)` + `autocommit_block()` |

> 口诀：**「结构差异 autogenerate 帮你找，语义差异你自己写」**。

### 8.3 审阅生成的迁移（清单）

拿到 autogenerate 的产物，逐条确认：

1. 有没有 `drop_table` / `drop_column`？——是你要的吗？误删往往是模型没 import。
2. 有没有「先 drop 再 add」同名列？——那是重命名，改手写 `alter_column`。
3. `nullable=False` 的新列有没有 `server_default`？——大表上会直接失败。
4. 索引是不是在同一个事务里建？——大表要 `CONCURRENTLY`。
5. `downgrade` 是否完整、顺序是否逆序？
6. `server_default` 的写法是不是 SQL 字面量？

---

## 9. 手写迁移：`op` 速查

### 9.1 常用操作

```python
# 表
op.create_table("tags", ...)
op.rename_table("old_name", "new_name")
op.drop_table("tags")

# 列
op.add_column("apps", sa.Column("description", sa.Text(), nullable=True))
op.alter_column("apps", "name", existing_type=sa.String(), type_=sa.String(128))
op.alter_column("apps", "title", new_column_name="name", existing_type=sa.String())
op.alter_column("apps", "mode", existing_type=sa.String(), nullable=False)
op.drop_column("apps", "description")

# 索引
op.create_index("ix_apps_created_at", "apps", ["created_at"])
op.create_index(
    "ix_apps_published",
    "apps",
    ["published_at"],
    postgresql_where=sa.text("published_at is not null"),
)
op.drop_index("ix_apps_created_at", table_name="apps")

# 约束（名字来自命名约定，不用猜）
op.create_unique_constraint("uq_tags_owner_id_name", "tags", ["owner_id", "name"])
op.drop_constraint("fk_apps_owner_id_users", "apps", type_="foreignkey")
op.create_check_constraint("ck_apps_mode", "apps", "mode in ('chatflow','agent')")
```

### 9.2 数据迁移

**场景**：新增 `slug` 列，要把已有行的 `name` 转成 slug。

```python
import sqlalchemy as sa
from alembic import op


def upgrade() -> None:
    op.add_column("apps", sa.Column("slug", sa.String(), nullable=True))
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            update apps
               set slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
             where slug is null
            """
        )
    )
    op.alter_column("apps", "slug", existing_type=sa.String(), nullable=False)
    op.create_unique_constraint("uq_apps_owner_id_slug", "apps", ["owner_id", "slug"])
```

| 要点 | 说明 |
| --- | --- |
| 先加可空列 → 回填 → 再加非空 | 一步 `nullable=False` 在已有数据上必然失败 |
| `op.get_bind()` 拿当前连接 | 与迁移处于**同一事务**（PG 支持事务性 DDL） |
| 分批回填 | 百万行别一条 `UPDATE`，用 `WHERE id > ... LIMIT` 循环 |
| 大表加约束用 `NOT VALID` | 见 §10.3 |

### 9.3 从另一张表搬数据

```python
def upgrade() -> None:
    op.create_table("app_stats", sa.Column("app_id", sa.String(), primary_key=True), sa.Column("runs", sa.Integer(), nullable=False, server_default="0"))
    op.execute(
        sa.text(
            """
            insert into app_stats (app_id, runs)
            select a.id, count(r.id)
              from apps a
              left join runs r on r.app_id = a.id
             group by a.id
            """
        )
    )
```

> 数据迁移**不放 `downgrade` 的反向逻辑**（数据回滚通常是丢数据），只写「删表/删列」并注释说明不可逆。迁移文件顶部写明「数据不可回滚」是负责任的做法。

---

## 10. PostgreSQL 上的安全 DDL

### 10.1 PG 的事务性 DDL

```python
def upgrade() -> None:
    op.create_table(...)
    op.create_index(...)
    # 任何一步失败 → 整个迁移回滚，不会留下半成品
```

| 数据库 | 事务性 DDL |
| --- | --- |
| PostgreSQL | ✅ 支持（Alembic 默认把迁移包在事务里） |
| MySQL | ❌ 不支持（DDL 隐式提交） |
| SQLite | 部分支持（`render_as_batch=True`） |

> 但**不是所有 DDL 都能进事务**，典型例外是 `CREATE INDEX CONCURRENTLY`。

### 10.2 并发建索引

```python
def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_messages_created_at",
            "messages",
            ["created_at"],
            postgresql_concurrently=True,
        )
```

| 为什么 | 说明 |
| --- | --- |
| `CONCURRENTLY` 不能在事务块里 | 它要等所有并发事务结束，必须在 autocommit 下运行 |
| `autocommit_block()` | Alembic 提供的「临时离开事务」上下文 |
| 失败会留 `invalid` 索引 | 需要 `DROP INDEX CONCURRENTLY` 再重试 |

```sql
-- 检查有没有坏索引
select indexrelid::regclass, indisvalid
  from pg_index
 where not indisvalid;
```

### 10.3 大表加非空列：expand / contract

线上大表（千万行）不能一条 `ALTER TABLE ... ADD COLUMN ... NOT NULL` 完事。标准四步：

| 阶段 | 动作 | 迁移 |
| --- | --- | --- |
| 1 expand | 加**可空**列 | `op.add_column(..., nullable=True)` |
| 2 backfill | 分批回填 | 脚本 / 迁移里 `LIMIT` 循环 |
| 3 收紧 | 加 `NOT NULL` | `op.alter_column(..., nullable=False)`，先 `SET lock_timeout` |
| 4 contract | 删除旧列 / 旧代码 | 下个版本发布后再删 |

```python
def upgrade() -> None:
    # 避免等锁把线上请求排队
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '30s'")

    op.add_column("apps", sa.Column("description", sa.Text(), nullable=True))

    # 大表校验 NOT NULL 会全表扫描：先加 CHECK ... NOT VALID，再 VALIDATE
    op.execute(
        "ALTER TABLE apps ADD CONSTRAINT ck_apps_description_not_null "
        "CHECK (description IS NOT NULL) NOT VALID"
    )
    op.execute("ALTER TABLE apps VALIDATE CONSTRAINT ck_apps_description_not_null")
```

| 技巧 | 收益 |
| --- | --- |
| `lock_timeout` | 拿不到锁就失败重试，而不是把整站请求堵住 |
| `NOT VALID` + `VALIDATE` | 校验阶段只拿 `SHARE UPDATE EXCLUSIVE`，不阻塞读写 |
| PG 11+ 带常量默认值的 `ADD COLUMN` | 只改元数据，不重写表（volatile 默认值仍会重写） |

> 迁移不是「一条 SQL 快」，而是「**任何时刻都不让线上停摆**」。评审迁移时先问：这条 DDL 会拿什么锁、锁多久。

---

## 11. 接管已有库：基线与 DDL 归属

### 11.1 为什么需要

项目是**双后端共库**：TS 侧 Prisma 先建了表，Python 侧后接入。如果直接在 Python 跑 `--autogenerate`：

```
现实态：users / apps / conversations / ...（Prisma 建的）
期望态：Python metadata 里的表
```

Alembic 会认为「库里的表都是多余的」，生成一堆 `drop_table` —— 灾难。

### 11.2 铁律：一张表只能有一个 DDL 主人

| 表 | DDL 主人 | Python 侧怎么用 |
| --- | --- | --- |
| `users` / `apps` / `conversations` / `messages` / `tags` / `app_tags` / `runs` | **Prisma**（TS） | 只映射、只读写数据；`include_object` 排除 |
| 仅 Python 使用的表（如实验表 `lab_notes`） | **Alembic**（Python） | 正常 autogenerate |

> 双写 DDL 的后果：Prisma 加索引、Alembic 又删掉；两边 `migrate` 互相打架；线上出现「代码以为有列、库里没有」。

### 11.3 基线三件套

**第一步：建一个空基线迁移**

```bash
alembic revision -m "baseline: adopt existing prisma schema"
```

```python
"""baseline: adopt existing prisma schema

Revision ID: 7f8e9d0c1b2a
Revises:
Create Date: 2026-10-25 09:30:00.000000
"""

revision = "7f8e9d0c1b2a"
down_revision = None

def upgrade() -> None:
    # 表已由 Prisma 建好，这里什么都不做
    pass

def downgrade() -> None:
    pass
```

**第二步：只登记，不执行**

```bash
alembic stamp head
alembic current        # 7f8e9d0c1b2a (head)
```

| 命令 | 做什么 | 会不会跑 DDL |
| --- | --- | --- |
| `alembic upgrade head` | 执行迁移 + 写版本 | ✅ |
| `alembic stamp head` | **只写** `alembic_version` | ❌ |

> 这正是「库已经是对的，只差一张登记表」的场景。顺序不能反：先 `stamp` 再 `upgrade` 会跳过基线，导致后续迁移的父节点缺失。

**第三步：排除别人家的表**

```python
# env.py

PRISMA_OWNED = {
    "users",
    "apps",
    "conversations",
    "messages",
    "tags",
    "app_tags",
    "runs",
    "run_events",
    "_prisma_migrations",
}


def include_object(object, name, type_, reflected, compare_to):
    """返回 False 表示「这个对象不归 Alembic 管」。"""
    if type_ == "table" and name in PRISMA_OWNED:
        return False
    return True
```

在 `context.configure(...)` 里加上：

```python
context.configure(
    connection=connection,
    target_metadata=target_metadata,
    compare_type=True,
    compare_server_default=True,
    include_object=include_object,
)
```

### 11.4 三种接入场景对照

| 场景 | 做法 | 后续 |
| --- | --- | --- |
| 全新空库，Python 拥有全部表 | `autogenerate` 生成基线 | 正常升级 |
| 已有库，表全归 Prisma | 空基线 + `stamp head` + `include_object` 排除 | 只对自有表生成迁移 |
| 已有库，部分表归 Python | 空基线 + `stamp` + 只 `include_object` 排除非自有表 | 首次对自有表 autogenerate 会生成 `create_table`，需人工改成「差异」或先确认表已存在 |

> 第三种最容易出错：如果自有表**已经在库里**，autogenerate 仍会生成 `create_table`。正确做法是把这条迁移手改成「只加缺失的索引/列」，或者对这几张表先 `stamp` 到一个手工基线。

### 11.5 验证没有漂移

```bash
alembic check
```

```
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.autogenerate.compare] Detected added table 'lab_notes'
FAILED: New upgrade operations detected: ...
```

| 退出码 | 含义 |
| --- | --- |
| 0 | metadata 与库一致 |
| 非 0 | 有未落地的变更（或有人手改了库） |

> 把 `alembic check` 放进 CI：**代码改了模型但忘了提交迁移**，会在这里被拦住。

---

## 12. 异步驱动：从 `psycopg` 到 `asyncpg`

### 12.1 驱动矩阵

| 驱动 | 同步/异步 | URL | 适用 |
| --- | --- | --- | --- |
| `psycopg2` | 同步 | `postgresql+psycopg2://` | 老项目 |
| `psycopg`（3.x） | **同步 + 异步** | `postgresql+psycopg://` | 项目当前用它（同步） |
| `asyncpg` | 异步 | `postgresql+asyncpg://` | 高并发 FastAPI |

> **URL 的 `+driver` 段决定用哪个驱动**。装了 `asyncpg` 但 URL 写 `postgresql+psycopg://`，`create_async_engine` 会直接报「该驱动不支持异步」。

### 12.2 为什么 FastAPI 要用异步驱动

| 同步驱动 + 同步路由 | 异步驱动 + 异步路由 |
| --- | --- |
| 每个请求占一个线程（默认线程池约 40 个） | 等待 DB 时释放事件循环，可承载更多并发 |
| 40 个慢查询就能把线程池打满 | 连接池才是瓶颈（可精确配置） |
| LLM 长耗时场景下线程更容易耗尽 | 与 SSE 流式输出天然合拍 |

> 但异步不是免费的：**任何隐式懒加载都会变成 `MissingGreenlet`**（见 03 篇 §12）。异步要求你「显式预加载」。

### 12.3 异步引擎与 Session

**完整文件路径：`apps/api-py/app/db_async.py`**

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

async_engine = create_async_engine(
    settings.async_database_url,      # postgresql+asyncpg://...
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True,
    echo=False,
    connect_args={
        "timeout": 10,                # 建连超时（秒）
        "command_timeout": 30,        # 单条语句超时（秒）
        "server_settings": {"application_name": "api-py"},
    },
)

AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    autoflush=False,
    expire_on_commit=False,
)
```

配置里派生异步 URL：

**完整文件路径：`apps/api-py/app/config.py`（节选）**

```python
from functools import cached_property
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str            # postgresql+psycopg://...

    @cached_property
    def async_database_url(self) -> str:
        # 只换驱动段，主机/库名/参数不动
        return self.database_url.replace(
            "postgresql+psycopg://", "postgresql+asyncpg://"
        ).replace("postgresql://", "postgresql+asyncpg://")
```

> 只改协议前缀，**不要**重新拼 host/port——拼错密码或丢了 `sslmode` 参数，是异步迁移最常见的「本地能跑、线上连不上」。

### 12.4 异步依赖

**完整文件路径：`apps/api-py/app/api/deps.py`（节选）**

```python
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.db_async import AsyncSessionLocal


async def get_async_db() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session
```

路由必须写成 `async def`：

```python
@router.get("/apps")
async def list_apps(
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(get_current_user_async),
):
    result = await db.execute(
        select(App)
        .where(App.owner_id == user.id)
        .options(selectinload(App.tags))
        .order_by(App.created_at.desc())
        .limit(50)
    )
    return [to_app_dto(item) for item in result.scalars().all()]
```

| 规则 | 说明 |
| --- | --- |
| `async def` + `AsyncSession` | 必须在事件循环里 `await` |
| `def` + `AsyncSession` | ❌ 同步路由跑在线程池里，无法 `await` |
| `session.add(obj)` | **不要 await**（纯内存操作） |
| `await session.flush()` | 发 SQL 但不提交 |
| `await session.commit()` | 提交 |
| `await session.refresh(obj)` | 从库里重新读 |
| `await session.delete(obj)` | 标记删除（SQL 在 flush 时发） |

### 12.5 异步 CRUD 完整示例

**完整文件路径：`apps/api-py/scripts/async_lab.py`**

```python
import asyncio

from sqlalchemy import func, select

from app.db_async import AsyncSessionLocal
from app.models import App, User


async def main() -> None:
    async with AsyncSessionLocal() as db:
        user = User(id="lab-user", email="lab@example.com", name="Lab", password_hash="x")
        db.add(user)
        await db.flush()          # 先让 users 行存在，满足外键

        app = App(
            id="lab-app",
            owner_id=user.id,
            name="异步实验",
            mode="chatflow",
            graph_json={"nodes": [], "edges": []},
        )
        db.add(app)
        await db.commit()

        got = await db.get(App, "lab-app")
        print("get:", got.id, got.name)

        rows = (
            await db.execute(select(App).where(App.owner_id == user.id))
        ).scalars().all()
        print("list:", [row.id for row in rows])

        total = await db.scalar(select(func.count()).select_from(App))
        print("count:", total)

        await db.delete(got)
        await db.delete(user)
        await db.commit()


if __name__ == "__main__":
    asyncio.run(main())
```

运行：

```bash
cd apps/api-py
uv run python scripts/async_lab.py
```

预期输出：

```
get: lab-app 异步实验
list: ['lab-app']
count: 1
```

### 12.6 两种引擎共存怎么管

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| A · 应用异步、迁移同步 | Alembic 用 `app.db`（psycopg），FastAPI 用 `app.db_async` | ✅ **推荐**：迁移是一次性任务，没必要异步化 |
| B · 全异步 | Alembic 用异步模板（§13） | ✅ 也可，但多一层 `run_sync` 桥接 |
| C · 两把引擎同时跑在业务里 | 同一个请求既用同步也用异步 | ❌ 连接池翻倍、事务难统一 |

> 选 A 时注意连接池预算要**两套一起算**：`(同步池 + 异步池) × worker` 不能超过 PG 的 `max_connections`（01 篇 §4.4）。

### 12.7 `asyncpg` 的三个坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| PgBouncer 下报 `prepared statement ... does not exist` | 事务级池化会换后端连接，预备语句失效 | URL 加 `?prepared_statement_cache_size=0`，或 `connect_args={"statement_cache_size": 0}` |
| `invalid dsn: invalid connection option "sslmode"` | `asyncpg` 不认 libpq 的 `sslmode` | 用 `connect_args={"ssl": "require"}`，URL 里别带 `sslmode` |
| 迁移报 `MissingGreenlet` | 在异步上下文里触发了同步懒加载 | 预加载（`selectinload`）或 `await refresh`（03 篇 §12） |

> `prepared_statement_cache_size` 是 SQLAlchemy 方言参数，`statement_cache_size` 是 `asyncpg` 原生参数。用 PgBouncer 时两个都设 0 最稳。

---

## 13. Alembic 异步模板

### 13.1 初始化

```bash
alembic init -t async alembic
```

生成的 `env.py` 与同步版的差别只在「怎么拿连接」：

**完整文件路径：`apps/api-py/alembic/env.py`（异步版）**

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import settings
from app.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option(
    "sqlalchemy.url", settings.async_database_url.replace("%", "%%")
)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

### 13.2 `run_sync()` 为什么必须存在

| 事实 | 说明 |
| --- | --- |
| Alembic 的迁移函数是**同步**的（`def upgrade()`） | 它内部用 `op.create_table` 等同步 API |
| 异步连接不能直接执行同步调用 | 会触发 `MissingGreenlet` |
| `connection.run_sync(fn)` | 把同步函数「放进」异步连接的事件循环里执行，内部桥接为 async |

```
asyncio.run(run_async_migrations())
  └─ async with async_engine.connect()
       └─ await connection.run_sync(do_run_migrations)
            └─ context.run_migrations()
                 └─ upgrade()  ← 同步 Python 代码，但底层 SQL 走异步驱动
```

> 所以**迁移脚本本身永远是同步的**，异步只体现在 `env.py` 的连接层。别试图把 `upgrade()` 写成 `async def`——Alembic 不会 await 它。

### 13.3 离线 SQL 与异步无关

```bash
alembic upgrade head --sql
```

离线模式不连库，异步模板照样可用（走 `run_migrations_offline()`）。生成的 SQL 与同步版一致。

---

## 14. 项目实战：从零到可用的迁移链路

### 14.1 目录结构

```
apps/api-py/
├── alembic.ini
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       ├── 20261025_0900-1a2b3c4d5e6f_baseline.py
│       └── 20261027_1030-3c4d5e6f7a8b_add_lab_notes.py
├── app/
│   ├── config.py
│   ├── db.py
│   ├── db_async.py
│   └── models/
└── scripts/
    └── async_lab.py
```

### 14.2 命令逐条

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `alembic init alembic` | `apps/api-py` | 初始化 | 生成 `alembic.ini` + `alembic/` |
| `alembic revision --autogenerate -m "baseline"` | `apps/api-py` | 生成基线草稿 | `versions/` 多一个文件 |
| `alembic upgrade head` | `apps/api-py` | 建表 | `INFO Running upgrade -> 1a2b...` |
| `alembic current` | `apps/api-py` | 看当前版本 | `1a2b... (head)` |
| `alembic downgrade -1` | `apps/api-py` | 回退一步 | `INFO Running downgrade` |
| `alembic upgrade head` | `apps/api-py` | 再前进 | 幂等（版本表记住进度） |
| `alembic history` | `apps/api-py` | 看链 | 从新到旧 |
| `alembic check` | `apps/api-py` | 漂移检测 | 退出码 0 |
| `alembic upgrade head --sql` | `apps/api-py` | 导出 SQL | 打印 DDL |
| `alembic stamp head` | `apps/api-py` | 只登记不执行 | `alembic_version` 更新 |

### 14.3 加一张 Python 自有表

```bash
alembic revision --autogenerate -m "add lab notes"
```

```python
"""add lab notes

Revision ID: 3c4d5e6f7a8b
Revises: 1a2b3c4d5e6f
Create Date: 2026-10-27 10:30:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "3c4d5e6f7a8b"
down_revision = "1a2b3c4d5e6f"


def upgrade() -> None:
    op.create_table(
        "lab_notes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("app_id", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["app_id"], ["apps.id"], name=op.f("fk_lab_notes_app_id_apps"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lab_notes")),
    )
    op.create_index(op.f("ix_lab_notes_app_id"), "lab_notes", ["app_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_lab_notes_app_id"), table_name="lab_notes")
    op.drop_table("lab_notes")
```

> 注意：`lab_notes` 的外键指向 `apps`（Prisma 拥有）。**跨归属方加外键**是可以的（依赖对方的表结构），但要在评论里写明「依赖 Prisma 的 `apps.id`」，对方改表时才能被 grep 到。

### 14.4 启动时迁移 vs 独立迁移任务

| 做法 | 适用 | 风险 |
| --- | --- | --- |
| 每个实例启动时 `alembic upgrade head` | 单实例、本地开发、小项目 | 多副本并发执行 → 争抢/重复执行 |
| 部署流水线里单独一步迁移 | ✅ **生产推荐** | 需要流程编排 |
| 手工执行 | 传统运维 | 容易忘 |

多副本并发执行时，用 PG 的 advisory lock 串行化：

```python
# 迁移入口脚本里
from sqlalchemy import text

with engine.connect() as conn:
    conn.execute(text("select pg_advisory_lock(731245)"))
    try:
        command.upgrade(alembic_cfg, "head")
    finally:
        conn.execute(text("select pg_advisory_unlock(731245)"))
```

> lock 号换成项目固定值即可。**不要**用 `pg_try_advisory_lock` 后直接跳过——没抢到锁的实例会带着旧 schema 启动。

### 14.5 CI 里怎么验

```bash
# 1. 起一个空库（compose / service container）
# 2. 全量升级
alembic upgrade head
# 3. 检查没有遗漏的模型变更
alembic check
# 4. 回滚到底再升一遍（验证 downgrade）
alembic downgrade base
alembic upgrade head
```

第 4 步能发现「`downgrade` 写漏了」「删表顺序错」这类只在回滚时才炸的问题。

---

## 15. 与 Prisma / NestJS 对照

| 目的 | Alembic（Python） | Prisma（TS） |
| --- | --- | --- |
| 生成迁移 | `alembic revision --autogenerate -m "x"` | `prisma migrate dev --name x` |
| 应用迁移 | `alembic upgrade head` | `prisma migrate deploy` |
| 回滚 | `alembic downgrade -1` / `base` | 无内置回滚（需手写 SQL / `migrate diff`） |
| 版本表 | `alembic_version` | `_prisma_migrations` |
| 期望态来源 | `Base.metadata`（代码） | `schema.prisma`（DSL） |
| 漂移检测 | `alembic check` | `prisma migrate diff --exit-code` |
| 接管已有库 | 空基线 + `stamp head` | `prisma db pull` + `migrate resolve --applied` |
| 只生成 SQL | `upgrade head --sql` | `prisma migrate diff --script` |
| 迁移中跑数据 | `op.get_bind().execute(...)` | `prisma migrate` 的 SQL 文件里手写 |
| 并发建索引 | `autocommit_block()` + `CONCURRENTLY` | 手写 SQL 文件 |

> 心智差异：**Alembic 的期望态是「Python 代码」**，改模型才能改迁移；**Prisma 的期望态是「schema 文件」**，改 schema 才能改迁移。双栈共库时，谁拥有表，就以谁的期望态为准。

---

## 16. 验收自测

### 16.1 判断

1. `Base.metadata.create_all()` 能替代迁移吗？
2. `alembic stamp head` 会执行 DDL 吗？
3. `--autogenerate` 能检测到「把 `name` 列改名为 `title`」吗？
4. `CREATE INDEX CONCURRENTLY` 能直接写在 `upgrade()` 里吗？
5. 异步路由里 `db.add(obj)` 需要 `await` 吗？
6. PgBouncer 事务池下，`asyncpg` 需要关掉什么？

<details>
<summary>答案</summary>

1. ❌ 只建缺失的表，不处理改列/索引/删列，也没有版本记录。
2. ❌ 只写 `alembic_version`，不执行迁移函数。
3. ❌ 会生成 `drop_column` + `add_column`，必须手写 `alter_column(new_column_name=...)`。
4. ❌ 它不能在事务块里跑，要包在 `with op.get_context().autocommit_block():` 里。
5. ❌ `add` 是纯内存操作；`flush` / `execute` / `commit` / `refresh` / `delete` 才需要 `await`。
6. ✅ 预备语句缓存（`prepared_statement_cache_size=0` / `statement_cache_size=0`），否则会报 `prepared statement does not exist`。

</details>

### 16.2 找错

```python
def upgrade() -> None:
    op.add_column("apps", sa.Column("slug", sa.String(), nullable=False))
    op.create_unique_constraint("uq_apps_slug", "apps", ["slug"])
```

**问题 1**：已有数据的表直接加 `nullable=False` 且没有默认值 → `column "slug" contains null values`。

**问题 2**：假设库里已有重复值，唯一约束也会失败。

正确写法：

```python
def upgrade() -> None:
    op.add_column("apps", sa.Column("slug", sa.String(), nullable=True))
    op.execute("update apps set slug = id where slug is null")
    op.alter_column("apps", "slug", existing_type=sa.String(), nullable=False)
    op.create_unique_constraint("uq_apps_slug", "apps", ["slug"])
```

### 16.3 动手题

1. 写一条迁移：给 `apps` 加 `description TEXT`（可空），并建一个只针对未删除行的部分索引。
2. 写一条数据迁移：把所有 `conversations.title IS NULL` 的行改成 `'未命名会话'`。
3. 用 `include_object` 写一个只要「表名不在白名单」就排除的实现。

<details>
<summary>参考</summary>

```python
# 1
def upgrade() -> None:
    op.add_column("apps", sa.Column("description", sa.Text(), nullable=True))
    op.create_index(
        "ix_apps_description_present",
        "apps",
        ["id"],
        postgresql_where=sa.text("description is not null"),
    )

def downgrade() -> None:
    op.drop_index("ix_apps_description_present", table_name="apps")
    op.drop_column("apps", "description")


# 2
def upgrade() -> None:
    op.execute("update conversations set title = '未命名会话' where title is null")

def downgrade() -> None:
    # 数据不可逆：不写反向逻辑，保留注释
    pass


# 3
PYTHON_OWNED = {"lab_notes", "lab_experiments"}

def include_object(object, name, type_, reflected, compare_to):
    if type_ == "table":
        return name in PYTHON_OWNED
    return True
```

</details>

### 16.4 运行实验

```bash
cd apps/api-py

# 1. 全量升级
alembic upgrade head

# 2. 看当前位置与历史
alembic current
alembic history

# 3. 验证幂等（再跑一次应无操作）
alembic upgrade head

# 4. 验证回滚（注意：会删表，只在本地库做）
alembic downgrade base
alembic upgrade head

# 5. 漂移检测
alembic check

# 6. 异步读写
uv run python scripts/async_lab.py
```

| 步骤 | 通过标准 |
| --- | --- |
| 1 | 无异常，`alembic_version` 有且只有一行 |
| 3 | 输出里没有 `Running upgrade`（已是 head） |
| 4 | 回滚后 `\dt` 无业务表，再升级后恢复 |
| 5 | 退出码 0（排除 Prisma 表后） |
| 6 | 打印 `get` / `list` / `count` 三行，库中无残留 |

---

## 17. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `Target database is not up to date` | 生成本地迁移前没先 `upgrade` | 先 `alembic upgrade head` 再 `revision --autogenerate` |
| 生成的迁移是空的 | `env.py` 没 import 模型 / `models/__init__.py` 没导出 | 确认 `Base.metadata.tables` 包含目标表 |
| `Can't locate revision identified by 'xxxx'` | 库里的版本号在代码里不存在（换分支/库串了） | 确认库与分支匹配；必要时 `stamp` 到正确版本 |
| `Multiple head revisions are present` | 两条分支各自加了迁移 | `alembic merge -m "merge" head1 head2` |
| `--autogenerate` 想删一堆 Prisma 表 | 没做 DDL 归属 | 空基线 + `stamp` + `include_object` |
| 迁移里 `drop_constraint` 不知道名字 | 没设 `naming_convention` | 在 `Base` 的 `MetaData` 上设约定 |
| `CREATE INDEX CONCURRENTLY` 报「不能在事务中运行」 | 缺少 `autocommit_block()` | 包一层 `with op.get_context().autocommit_block():` |
| 大表加列把请求堵死 | DDL 等锁 | `SET lock_timeout='3s'` + `expand/contract` |
| `column contains null values` | 直接加 `nullable=False` | 先加可空列 → 回填 → 再收紧 |
| `server_default` 不生效 | 写成了 Python 字符串而非 SQL 字面量 | 用 `sa.text("'{}'::jsonb")` / `sa.text("now()")` |
| 离线 SQL 里带 `%(...)s` | 没开 `literal_binds` | `literal_binds=True` |
| `ModuleNotFoundError: app` | `prepend_sys_path` 不是 `.`，或没在 `apps/api-py` 下执行 | 在项目目录执行，检查 `alembic.ini` |
| 密码含 `%` 导致配置解析错 | `configparser` 插值 | `settings.database_url.replace("%", "%%")` |
| `asyncpg` 报 `invalid connection option "sslmode"` | libpq 参数不被 asyncpg 支持 | 用 `connect_args={"ssl": "require"}` |
| PgBouncer 下 `prepared statement does not exist` | 预备语句缓存跨连接失效 | 关缓存（两个参数都设 0） |
| 异步路由报 `MissingGreenlet` | 隐式懒加载 | 预加载 `selectinload` 或 `await refresh` |
| 多副本同时启动迁移互相踩 | 没有串行化 | advisory lock 或独立迁移任务 |
| `downgrade` 报 FK 冲突 | 先删父表 | 逆序删表（先子后父） |
| 迁移执行了但版本没变 | 用了 `--sql` 离线执行 | 执行后 `alembic stamp head` |

---

## 18. 本篇小结

- **双轨心智**：模型是**期望态**，迁移是**变更史**，`alembic_version` 是**当前位置**。三者缺一不可。
- **autogenerate 只是草稿**：重命名、CHECK、表达式索引、数据回填、并发 DDL 都要手写并审阅。
- **命名约定先于建表**：没有 `naming_convention`，以后删约束连名字都写不出来。
- **双栈共库的铁律**：一张表只能有一个 DDL 主人；Python 侧用「空基线 + `stamp` + `include_object`」接管。
- **PG 安全 DDL**：`lock_timeout` 必备；大表走 `expand/contract`；`CONCURRENTLY` 配 `autocommit_block()`。
- **异步驱动**：URL 的 `+asyncpg` 决定驱动；`AsyncSession` 里 `add` 不 await、`flush`/`execute`/`commit` 要 await；隐式懒加载必然 `MissingGreenlet`。
- **异步迁移**：迁移脚本永远同步，异步只在 `env.py` 的连接层，靠 `connection.run_sync()` 桥接。
- **生产执行**：迁移作为独立部署步骤，多副本用 advisory lock；CI 跑 `upgrade → check → downgrade → upgrade`。

> 阶段 6 到此结束。下一篇进入阶段 7 · 认证与安全，从「密码哈希」开始——那里会用到本篇的迁移能力给 `users` 表加字段。
