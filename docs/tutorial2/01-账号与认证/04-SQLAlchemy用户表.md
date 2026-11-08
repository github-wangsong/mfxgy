# 04 · SQLAlchemy 用户表（账号与认证）

> 阶段 1 · 第 4 步
>
> 做完：Python 侧能读写**同一张** `users` 表（表结构仍由 Prisma 迁移拥有），`Base` / `User` / `engine` / `SessionLocal` 就位，用一条 `select` 能读到 NestJS 刚注册的用户。
>
> **本篇面试考点**：一个库两套 ORM 的迁移所有权 · SQLAlchemy 2.0 的 `Mapped` / `mapped_column` · `server_default` vs `default` · 为什么不能调 `create_all()` · `DateTime` 的时区陷阱 · `expire_on_commit` / `pool_pre_ping` · 同步驱动在 FastAPI 里怎么跑。

> 上接：`02-Prisma用户表.md` 已经用 Prisma 建好了 `users` 表。本篇**不产生任何 DDL**，只做映射。

---

## 1. 先定一条铁律：DDL 只有一个主人

| 事项 | 结论 | 原因 |
| --- | --- | --- |
| 谁建表 / 改表 | 只有 Prisma 迁移 | 两个迁移系统同时跑，必然互相覆盖 |
| Python 侧做什么 | 声明模型、读写数据 | 表已存在，SQLAlchemy 只需要知道列名和类型 |
| 能不能 `create_all()` | **绝对不能** | 它会按 Python 模型重新建表，和 Prisma 的迁移历史打架 |
| 列名用什么 | 照抄数据库的 snake_case | Python 属性名与列名一一对应，不需要 `@map` 那种翻译 |
| id 默认值 | Python 侧不设 | UUID 由 Prisma Client 在应用侧生成，数据库列没有 DEFAULT |

一句话：**Prisma 是 DDL 的唯一真源，SQLAlchemy 只是这张表的“远程客户端”。**

> **面试考点 · 两套后端共用一个库，迁移权应该给谁？**
>
> - 如果两边都建表：Prisma 迁移建 `users`，SQLAlchemy 的 `create_all()` 看到表已存在会跳过；但一旦某边加了一列，另一边的模型就与库不一致，且没人知道该以谁为准。
> - 如果各建各的表：数据无法共享，登录状态、用户归属全断。
> - 本项目的做法是**单向所有权**：Prisma 写 DDL，Python 只读这份结构。评测标准很清晰——`prisma migrate deploy` 跑完，Python 立刻就能用。
> - 代价：加字段必须走 TS 侧的迁移，Python 模型跟着改。这是有意的约束，不是缺陷。
>
> **追问：那 Python 侧怎么保证模型没写错？**
> 靠验证步骤里的 `inspect(engine).get_columns('users')` 做结构对照，以及后续的集成测试（注册 → 登录 → `/auth/me` 跨端跑通）。DDL 不归你管，但**映射是否对齐**必须自己验证。

---

## 2. 装依赖

**完整文件路径：`apps/api-py/pyproject.toml`**

阶段 1 相关部分（其余依赖阶段 0 已有）：

```toml
[project]
name = "mini-dify-api-py"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.9.0",
    # 从 .env 读配置
    "pydantic-settings>=2.5.0",
    # 邮箱校验：Pydantic 的 EmailStr 依赖它
    "email-validator>=2.2.0",
    # ORM：2.0 风格（Mapped / mapped_column）
    "sqlalchemy>=2.0.30",
    # PostgreSQL 驱动（psycopg 3）；[binary] 自带预编译二进制，不用本地装 libpq
    "psycopg[binary]>=3.2.0",
    # 下一篇签发 / 校验 JWT 用
    "pyjwt>=2.9.0",
    # 下一篇哈希密码用（Python 侧用官方 bcrypt，不是 bcryptjs）
    "bcrypt>=4.2.0",
]
```

```powershell
# 在 apps/api-py 目录下同步依赖（uv 会按 pyproject.toml 建/更新 .venv）
uv sync
```

> `psycopg[binary]` 里的 `binary` 是关键：它带预编译的 C 扩展，不需要机器上装 `pg_config` / `libpq-dev`。Windows 上尤其省事。

---

## 3. 连接串：多一个驱动后缀

**完整文件路径：`apps/api-py/.env.example`**

```bash
# api-py 环境变量样例（复制为 .env 后使用）
# 注意：SQLAlchemy 连接串带 +psycopg 驱动后缀
DATABASE_URL=postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify
# 与 apps/api-ts/.env 同值：双方签发的 JWT 才能互认
JWT_SECRET=dev-jwt-secret-change-me-please
# 令牌有效期（秒）；两端读同一个键
JWT_EXPIRES_IN=3600
PORT=8000
```

```powershell
Copy-Item apps/api-py/.env.example apps/api-py/.env
```

对比一下两边的连接串：

```text
api-ts（Prisma）  postgresql://postgres:...@localhost:5432/minidify
api-py（SQLAlchemy）postgresql+psycopg://postgres:...@localhost:5432/minidify
```

多出来的 `+psycopg` 是 SQLAlchemy 的**方言 + 驱动**语法：`dialect+driver`。不加的话 SQLAlchemy 会去找默认驱动（psycopg2），而项目里装的是 psycopg 3。

> **面试考点 · psycopg2 和 psycopg（3）有什么区别？**
> psycopg2 是老的 C 扩展，生态最广；psycopg 3 是重写版，支持原生 `async`、更好的类型适配、`[binary]` 安装更省心。SQLAlchemy 2.0 的方言名分别是 `postgresql+psycopg2` 与 `postgresql+psycopg`，**写错会直接 `ModuleNotFoundError`**。

---

## 4. 配置与引擎

**完整文件路径：`apps/api-py/app/config.py`**

阶段 1 的完整内容（后续阶段继续追加字段）：

```python
"""应用配置（pydantic-settings）。

环境变量名大小写不敏感：`database_url` 对应 `DATABASE_URL`。
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# 本项目目录（apps/api-py）：无论从哪个 cwd 启动，都读这一份 .env
_PROJECT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # env_file 指到绝对路径；extra="ignore" 允许 .env 里有本类没声明的键
    model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")

    # 服务标识，参与 /health 响应
    service_name: str = "api-py"
    version: str = "0.1.0"
    # 默认值只为开发方便；真实值从 .env 覆盖
    database_url: str = "postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify"
    # 与 TS 侧保持同一密钥，双方签发的 JWT 才能互认
    jwt_secret: str = "dev-jwt-secret-change-me-please"
    # 有效期（秒）：字段名不同，用 validation_alias 绑定到 JWT_EXPIRES_IN
    access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")
    # uvicorn 监听端口（main.py 的 __main__ 入口使用）
    port: int = 8000


# 模块级单例：import 一次，全应用共用
settings = Settings()
```

**完整文件路径：`apps/api-py/app/db.py`**

```python
"""数据库接入（SQLAlchemy 2.0）。

`users` 表的 DDL 由 TS 侧 Prisma 迁移拥有（见「迁移所有权」）；
Python 侧只做映射与读写，不产生 DDL。
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

# engine = 连接池 + 方言实现，进程内只建一次
# pool_pre_ping：每次从池里取连接先 ping 一下，数据库重启后自动换掉失效连接
# future=True：显式声明使用 2.0 风格 API（2.0 里已是默认，写上更明确）
engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)

# sessionmaker = session 工厂；每个请求创建一个 session
# autoflush=False：查询前不自动 flush，避免半成品 SQL 提前发出去
# expire_on_commit=False：commit 后对象不过期，仍可读属性（返回 JSON 时要用）
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
```

> **面试考点 · `autoflush=False` 和 `expire_on_commit=False` 各自解决什么？**
>
> - **autoflush**：默认 `True`，每次 `session.execute(select(...))` 前会把待写入的对象先 flush 成 INSERT/UPDATE。好处是查询能看到未提交的改动；坏处是**时序不可控**——你以为还没写库，SQL 已经发出去了，脏数据或死锁都可能提前发生。项目里关掉，写入改成显式 `session.flush()` / `commit()`。
> - **expire_on_commit**：默认 `True`，commit 后所有对象的属性被标记过期，再访问 `user.email` 会触发一次 SELECT 刷新。FastAPI 里常见“commit 之后序列化响应”的流程，开着会多一次查询；如果 session 已关闭，还会直接抛 `DetachedInstanceError`。关掉它，对象在 commit 后仍可安全读取。
>
> **追问：`pool_pre_ping` 是干什么的？**
> 数据库重启、网络闪断、云厂商回收空闲连接后，池里的连接看起来还在、实际已死。`pool_pre_ping` 在借出连接时先执行一个轻量探测，失败就丢弃重建。代价是每次取连接多一次往返，通常几十微秒，值得。

> **面试考点 · 为什么用同步 `create_engine`，不用 `create_async_engine`？**
> FastAPI 的 `def` 路由会跑在线程池里，同步 ORM 完全没问题；`async def` 路由跑在事件循环里，同步驱动会阻塞整个循环。本项目的 DB 调用都写成 `def` 依赖 + `def` 路由（下一篇会看到），所以同步引擎是正确选择。
>
> 如果非要在 `async def` 里用数据库，就必须换 `asyncpg` / `psycopg` 异步模式 + `AsyncSession`。**“用 FastAPI 就必须全异步”是误解**；同步 + 线程池对中小流量更简单，也更容易排查问题。

---

## 5. 声明式基类与 `User` 模型

**完整文件路径：`apps/api-py/app/models/base.py`**

```python
"""SQLAlchemy 2.0 声明式基类。"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有模型的基类。

    注意：本项目的表结构（DDL）由 TS 侧 Prisma 迁移拥有；Python 侧只做映射。
    """
```

**完整文件路径：`apps/api-py/app/models/user.py`**

阶段 1 的完整内容（关系字段随阶段 2/7/9/10/11 逐步追加）：

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
    # 必须与 Prisma 的 @@map("users") 完全一致
    __tablename__ = "users"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    # 所以这里不写 default，也不写 server_default
    id: Mapped[str] = mapped_column(String, primary_key=True)

    # 列名与数据库一致；unique=True 只是元数据，真正生效的是 Prisma 建的唯一索引
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    # 直接映射 password_hash 列；Python 属性名也保持 snake_case
    password_hash: Mapped[str] = mapped_column(String, nullable=False)

    # server_default="member" 描述的是「数据库有默认值」（Prisma 迁移里写了 DEFAULT 'member'）
    role: Mapped[str] = mapped_column(String, nullable=False, server_default="member")

    # created_at 在数据库里是 TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
    # DateTime（不带 timezone）对应 timestamp without time zone，与 Prisma 一致
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
```

**完整文件路径：`apps/api-py/app/models/__init__.py`**

```python
"""数据模型包。"""

from app.models.base import Base
from app.models.user import User

__all__ = ["Base", "User"]
```

> **面试考点 · `server_default` 和 `default` 的区别？**
>
> | 写法 | 生效位置 | 本项目该用哪个 |
> | --- | --- | --- |
> | `default="member"` | Python 侧，ORM INSERT 时补值 | 只在“Python 一定负责插入”时用 |
> | `server_default="member"` | 数据库 DDL 的 `DEFAULT` | 描述已存在的数据库默认值 |
> | `func.now()` | 生成 `now()` / `CURRENT_TIMESTAMP` | 与 `DEFAULT CURRENT_TIMESTAMP` 对齐 |
>
> 关键点：本项目**不执行 DDL**，所以这些 `server_default` 不会真的去改表，它们的作用是**让模型与数据库结构保持一致**，并且在 SQLAlchemy 生成 INSERT 时知道“这列可以不传”。如果误写成 `default=`，Python 会在应用侧塞值，绕过数据库默认值——行为和 NestJS 写入的数据就不一致了。
>
> **追问：为什么 `id` 不设 `server_default`？**
> 因为 Prisma 的 `@default(uuid())` 是**客户端默认值**，迁移 SQL 里 `id` 列没有 DEFAULT。如果 Python 侧写了 `server_default=func.gen_random_uuid()`，模型描述的结构就和真实表不符，将来有人照着模型排查会得出错误结论。**`server_default` 是事实描述，不是愿望。**

> **面试考点 · 为什么 `DateTime` 不能写成 `DateTime(timezone=True)`？**
> Prisma 的 `DateTime` 在 PostgreSQL 上映射为 `timestamp(3)`（**without** time zone），迁移 SQL 已确认。SQLAlchemy 的 `DateTime` 默认就是 `TIMESTAMP WITHOUT TIME ZONE`；加上 `timezone=True` 会声明成 `timestamptz`，与真实列类型不一致。虽然 PG 会隐式转换，读出来却是 aware datetime，`toISOString()` 之类的序列化行为会和 TS 侧产生差异。
>
> **追问：那时间怎么保证是 UTC？**
> 靠数据库会话时区（本项目容器默认 `Etc/UTC`）+ 写入时用 `CURRENT_TIMESTAMP`。应用侧读出来是 naive datetime，序列化时按 UTC 处理即可（下一篇的响应模型会统一转成 `...Z`）。**naive + 约定 UTC** 比“有的 aware 有的 naive”更容易保持一致。

> **面试考点 · `String` 不写长度，会不会变成 `VARCHAR(255)`？**
> SQLAlchemy 的 `String` 不带长度时，DDL 里是 `VARCHAR`（PG 里等价于不限长度），不是 255。但反正本项目不执行 DDL，这一点只影响“模型类型是否与 `TEXT` 兼容”。PG 中 `VARCHAR` 与 `TEXT` 在性能和存储上没有区别，映射是安全的。
>
> **追问：`unique=True` 在 Python 侧有什么用？**
> 只写进 `Table` 的元数据，用于 `create_all()` 或 Alembic 自动生成迁移。本项目不跑这两者，所以它**不会**在数据库里建索引——唯一约束真正来自 Prisma 的 `users_email_key`。保留 `unique=True` 是为了模型自描述，也防止哪天有人误跑 `create_all()` 建出一张缺索引的表。

> **面试考点 · 为什么这里看不到 `apps` / `conversations` 这些 relationship？**
> 阶段 1 还没有那些表。真实开发里模型是**随功能追加**的：阶段 2 加 `apps`，阶段 7 加 `knowledge_bases`，阶段 9 加 `conversations`。提前写一堆关系只会让你在表还不存在时面对 `NoReferencedTableError`。仓库最终版里那些 `relationship(..., passive_deletes=True)` 是后续阶段补的，本篇不提前展开。

---

## 6. 验证

```powershell
# 0. 数据库与 NestJS 后端在跑，且上一篇已经注册过 alice@example.com
docker compose up -d

# 1. 安装依赖（在 apps/api-py 下）
uv sync
```

```powershell
# 2. 模型能导入，列名与顺序符合预期
uv run python -c "from app.models import User; print(User.__tablename__); print([c.name for c in User.__table__.columns])"
```

预期：

```text
users
['id', 'email', 'password_hash', 'role', 'created_at']
```

```powershell
# 3. 用 SQLAlchemy 反射真实表结构，和模型对照
uv run python -c "from sqlalchemy import inspect; from app.db import engine; print([(c['name'], str(c['type'])) for c in inspect(engine).get_columns('users')])"
```

预期（类型名可能因驱动版本略有差异，关键是 `TIMESTAMP` 不带 timezone）：

```text
[('id', 'TEXT'), ('email', 'TEXT'), ('password_hash', 'TEXT'), ('role', 'TEXT'), ('created_at', 'TIMESTAMP(3)')]
```

```powershell
# 4. 跨语言读数据：Python 读 NestJS 写入的用户
uv run python -c "from sqlalchemy import select; from app.db import SessionLocal; from app.models import User; s = SessionLocal(); print([(u.email, u.role, u.password_hash[:7]) for u in s.scalars(select(User)).all()]); s.close()"
```

预期：

```text
[('alice@example.com', 'member', '$2a$10$')]
```

> 这一行输出就是阶段 1 前半段的核心成果：**NestJS 写入的哈希，FastAPI 能原样读出来。** 两套 ORM 映射的是同一张表、同一套列名、同一个时间语义。
>
> 如果这里报 `relation "users" does not exist`，说明还没跑 Prisma 迁移（`02-Prisma用户表.md`），不是 Python 侧的问题。

```powershell
# 5. 确认代码里没有“自己建表”的调用（应为空输出）
Select-String -Path apps/api-py/app -Pattern 'create_all|drop_all'
```

---

## 7. 下一步

- `05-FastAPI注册登录.md`：Pydantic 请求/响应模型、bcrypt 哈希、PyJWT 签发、`Depends` 解析 Bearer。
- Python 侧不碰 DDL、不碰用户表结构，只实现与 NestJS **逐字节一致**的接口行为（状态码、错误文案、时间格式）。
