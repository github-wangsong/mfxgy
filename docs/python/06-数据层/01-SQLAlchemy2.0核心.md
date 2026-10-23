# 01 · SQLAlchemy 2.0 核心

> 所属：阶段 6 · 数据层
> 本篇覆盖：SQLAlchemy 的四层组成（Core / ORM / Engine / Dialect）、`create_engine` 与连接池参数（`pool_pre_ping`/`pool_size`/`max_overflow`/`pool_recycle`/`echo`）、数据库 URL 的驱动段、`DeclarativeBase` + `Mapped` + `mapped_column` 的 2.0 风格（对比 1.x 的 `Column`）、类型映射（`String`/`Text`/`DateTime`/`JSONB`/`ForeignKey`）、**三种默认值来源**（`server_default` / `default` / `onupdate`）与「DB 权威 + ORM 兜底」双保险、主键与应用侧 UUID、`select()` 2.0 查询 API、`Session` 的 CRUD（`add`/`commit`/`refresh`/`get`/`delete`）、`scalars()` 与 `execute()` 的区别
> **本篇首次教学：SQLAlchemy 的 Engine/Dialect/ORM 分层、`create_engine` 连接池五参数与 `pool_pre_ping`、URL 的 `+driver` 段（`postgresql+psycopg`）、`DeclarativeBase` 与 `Mapped[T]` / `mapped_column()` 的 2.0 声明式风格、`server_default` vs `default` vs `onupdate` 的三种语义、应用侧生成 UUID 与 DB 默认值的区别、`select(Model).where(...)` 与 `session.scalars()`、`scalar_one_or_none()` / `session.get()` 的选型、`SessionLocal(autoflush=False, expire_on_commit=False)` 两个参数的作用**
> 预告：下一篇讲 Session 生命周期与依赖——`get_db` 生成器、事务边界、`commit`/`rollback` 放哪、连接池打满怎么排查。

> 项目锚点：`apps/api-py/app/db.py`（`create_engine(..., pool_pre_ping=True)`、`SessionLocal(autoflush=False, expire_on_commit=False)`）、`app/models/base.py`（`DeclarativeBase`）、`app/models/app.py`、`app/models/user.py`（真实模型：`Mapped[...]`、`JSONB`、`server_default`、`onupdate`、`passive_deletes=True`）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 说清 Engine 与 Session 的区别，以及各自的生命周期。
2. 用 2.0 风格写一个带类型注解的 ORM 模型（含 FK 与 JSONB）。
3. 正确选择 `server_default` / `default` / `onupdate`，并解释为什么要「双保险」。
4. 用 `select()` 写查询而不是裸 SQL / `session.query()`。
5. 解释 `scalars()` 与 `execute()` 返回值的差异。
6. 说出 `autoflush=False` 与 `expire_on_commit=False` 各自解决什么问题。

**验收标准**

- 能解释 `postgresql+psycopg://` 里 `psycopg` 是什么。
- 能说出「Prisma 的 `@default(uuid())` 在数据库里到底有没有默认值」。
- 能看到一个 1.x 风格模型并改成 2.0 风格。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [01-Python进阶/01 类型注解](../01-Python进阶/01-类型注解与typing.md)（`Mapped[T]` 是泛型）、[01-Python进阶/04 上下文管理器](../01-Python进阶/04-上下文管理器与dataclass.md)（`with SessionLocal()`）、[05-FastAPI核心/02 Depends](../05-FastAPI核心/02-Depends依赖注入.md)（`get_db`） |
| 已掌握 | 模块与包、装饰器；SQL 基础（`SELECT`/`WHERE`/`JOIN`） |

---

## 3. SQLAlchemy 的四层

```
你的代码
  ↓
ORM（Mapped / Session / select）        ← 对象视角
  ↓
Core（Table / Column / SQL 表达式）      ← SQL 构造器
  ↓
Engine + Dialect（连接池 / PG 方言）      ← 连接与协议
  ↓
psycopg（DBAPI 驱动）
  ↓
PostgreSQL
```

| 层 | 职责 | 常见误解 |
| --- | --- | --- |
| ORM | 对象 ↔ 行映射、会话、身份映射 | 「ORM 就是 SQLAlchemy 全部」 |
| Core | 构造 SQL 表达式（也能单独用） | — |
| Engine | 连接池 + 方言选择 | 「Engine 是一条连接」 |
| Dialect | 生成 PG 专用 SQL（`JSONB`/`RETURNING`） | — |

### 3.1 Engine vs Session

| 对象 | 生命周期 | 线程/协程安全 |
| --- | --- | --- |
| `Engine` | 进程级单例 | ✅ 线程安全（内部池） |
| `Session` | 请求级（或更短） | ❌ 不能跨线程共享 |
| `SessionLocal` | 工厂（`sessionmaker`） | — |

> 一句话：**Engine 是「连接池管理器」，Session 是「一次工作单元」**。

---

## 4. `create_engine`

### 4.1 项目真实代码

`apps/api-py/app/db.py`：

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
```

### 4.2 URL 结构

```
postgresql+psycopg://postgres:password@localhost:5432/minidify
└────┬───┘ └──┬───┘   └──┬───┘ └──┬───┘ └─┬──┘ └──┬───┘
  方言      驱动        用户     密码   端口    库名
```

| 驱动写法 | 说明 |
| --- | --- |
| `postgresql://` | 默认用 `psycopg2`（需要已安装） |
| `postgresql+psycopg://` | psycopg 3（项目用这个） |
| `postgresql+psycopg2://` | 显式 psycopg2 |
| `postgresql+asyncpg://` | 异步驱动（阶段 6/04） |

> 项目 `pyproject.toml` 装的是 `psycopg[binary]`，所以 URL 必须写 `+psycopg`——**驱动装了但 URL 没写，会报 `ModuleNotFoundError: psycopg2`**。

### 4.3 连接池参数

```python
engine = create_engine(
    url,
    pool_size=5,             # 常驻连接数
    max_overflow=10,         # 峰值额外连接（总上限 = pool_size + max_overflow）
    pool_timeout=30,         # 从池里取连接的最长等待（秒）
    pool_recycle=1800,       # 连接最大存活秒数（防中间层断连）
    pool_pre_ping=True,      # 取连接前 ping 一次，自动剔除死连接
    echo=False,              # True 打印所有 SQL（调试用，别在生产开）
)
```

| 参数 | 默认 | 何时调 |
| --- | --- | --- |
| `pool_size` | 5 | 并发高时调大，但 **× worker 数 ≤ PG 的 `max_connections`** |
| `max_overflow` | 10 | 允许峰值溢出 |
| `pool_timeout` | 30 | 想快速失败就调小（配 503） |
| `pool_recycle` | -1 | 云数据库/NAT 超时通常设 1800 |
| `pool_pre_ping` | False | **生产建议开**（代价是一次轻量往返） |
| `echo` | False | 只用于开发 |

### 4.4 容量测算（真实事故模型）

```
4 个 uvicorn worker × (pool_size 5 + max_overflow 10) = 60 条连接
PG 默认 max_connections = 100
```

若同时还有 TS 后端（Prisma 默认池）+ 运维工具，**很容易打满**：

| 现象 | 原因 |
| --- | --- |
| `FATAL: sorry, too many clients already` | 连接总数超 `max_connections` |
| 请求排队超时 | `pool_timeout` 到点 |
| 内存上涨 | 每条 PG 连接约占几 MB |

> 生产计算：`worker 数 × (pool_size + max_overflow) + 其他客户端 < max_connections × 0.8`。

### 4.5 `pool_pre_ping` 解决什么

| 场景 | 不开 | 开了 |
| --- | --- | --- |
| 数据库重启 / 网络闪断 | 池里保留死连接 → 第一个请求报错 | 取连接时探测，坏连接被丢弃重建 |
| 云 PG 空闲超时断开 | 同上 | 同上 |

> 代价：每次取连接多一次往返（约 0.1~1ms）。**值得**。

---

## 5. 2.0 声明式模型

### 5.1 基类

`apps/api-py/app/models/base.py`：

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有模型的基类。"""
```

| 1.x 写法 | 2.0 写法 |
| --- | --- |
| `declarative_base()` | `class Base(DeclarativeBase)` |
| `Column(String)` | `mapped_column(String)` |
| 无类型注解 | `Mapped[str]` |

> `DeclarativeBase` 的好处：支持类型检查器（`Mapped[T]` 让 mypy 知道 `user.id` 是 `str` 而不是 `Any`）。

### 5.2 一个真实模型

`apps/api-py/app/models/app.py`（节选）：

```python
class App(Base):
    __tablename__ = "apps"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    mode: Mapped[str] = mapped_column(String, nullable=False, server_default="chatflow")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=func.now(), onupdate=func.now()
    )
    graph_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    published_graph_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    owner: Mapped["User"] = relationship("User", back_populates="apps")
    conversations: Mapped[list["Conversation"]] = relationship(
        "Conversation", back_populates="app", passive_deletes=True
    )
```

### 5.3 `Mapped[T]` 与 `nullable` 的对应

| 注解 | `nullable` | 含义 |
| --- | --- | --- |
| `Mapped[str]` | `False` | 必填 |
| `Mapped[str \| None]` | `True` | 可空 |
| `Mapped[list[X]]` | — | 关系集合 |
| `Mapped["User"]` | `False`（关系） | 多对一 |

> 2.0 会从 `Mapped[T]` **推导 `nullable`**，所以显式写 `nullable=True/False` 有时是冗余的——但项目仍显式写，**为了与 DDL 对照时一眼可见**。

### 5.4 类型映射表

| Python 注解 | SQLAlchemy 类型 | PG 实际类型 |
| --- | --- | --- |
| `str` + `String` | `VARCHAR` | `character varying`（无长度限制） |
| `str` + `Text` | `TEXT` | `text` |
| `int` + `Integer` | `INTEGER` | `integer` |
| `bool` + `Boolean` | `BOOLEAN` | `boolean` |
| `datetime` + `DateTime()` | `TIMESTAMP` | `timestamp without time zone` |
| `datetime` + `DateTime(timezone=True)` | `TIMESTAMPTZ` | `timestamp with time zone` |
| `dict` + `JSONB`（PG 方言） | `JSONB` | `jsonb` |
| `UUID` + `UUID` | `UUID` | `uuid` |
| `Decimal` + `Numeric(10, 2)` | `NUMERIC` | `numeric(10,2)` |

> 项目里 `String` 不写长度：PG 的 `varchar` 允许省略长度，Prisma 的 `String` 也映射到无长度 `text/varchar` 语义。**长度校验放在 Pydantic 层**（`Field(max_length=64)`），表结构不加约束。

### 5.5 `JSONB` 要用方言类型

```python
from sqlalchemy.dialects.postgresql import JSONB      # ✅ PG 专用（支持索引/运算符）
from sqlalchemy import JSON                            # 通用（映射到 JSONB 但不支持 PG 特性）
```

| 类型 | 索引 | `@>` 查询 |
| --- | --- | --- |
| `JSONB` | ✅ GIN | ✅ |
| `JSON` | ⚠️ | ⚠️（需 cast） |

> 与 PG 教程阶段 3 一致：**要 GIN 索引与 `@>` 操作符，就用 `JSONB`**。

---

## 6. 三种「默认值」

### 6.1 三者的语义

```python
mode: Mapped[str] = mapped_column(String, server_default="chatflow")
created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())
```

| 参数 | 生效位置 | 触发时机 | 谁执行 |
| --- | --- | --- | --- |
| `server_default` | **DDL**（列默认值） | 任何 `INSERT` 未给该列 | PostgreSQL |
| `default` | ORM | ORM `INSERT` 未给该列 | SQLAlchemy（客户端） |
| `onupdate` | ORM | ORM `UPDATE` 时自动带上 | SQLAlchemy（客户端） |

> 关键区别：**`server_default` 写进建表语句，裸 SQL 插入也生效；`default`/`onupdate` 只在走 ORM 时生效。**

### 6.2 为什么项目用「双保险」

```python
updated_at: Mapped[datetime] = mapped_column(
    DateTime, nullable=False, default=func.now(), onupdate=func.now()
)
```

| 层 | 机制 |
| --- | --- |
| DB | 迁移加了 `DEFAULT now()` + `BEFORE UPDATE` 触发器 |
| ORM | `default=func.now()` + `onupdate=func.now()` |

| 场景 | 谁负责刷新 |
| --- | --- |
| ORM 更新 | 两者都会（值相同，`now()`） |
| 手工 SQL 更新 | **只有触发器** |
| 其他服务（TS 侧 Prisma）更新 | 只有触发器 |

> 注释里写明「DB 触发器为权威、ORM 值作为兜底」——这是**跨栈共享表**时的标准做法：不能假设所有写入都经过 Python。

### 6.3 `func.now()` vs `datetime.now()`

| 写法 | 时区 | 时钟来源 |
| --- | --- | --- |
| `func.now()` | 由 PG 的 `now()` 决定（`timestamptz`） | **数据库** |
| `datetime.now()` | 本地时区（naive） | 应用服务器 |
| `datetime.now(timezone.utc)` | UTC aware | 应用服务器 |

> 项目列是 `timestamp(3)` **无时区**，所以必须约定「写入的一律是 UTC」。多台应用服务器时钟不一致时，用 `func.now()`（DB 时钟）更稳。

### 6.4 应用侧主键

```python
id: Mapped[str] = mapped_column(String, primary_key=True)
```

注释写明：**Prisma 的 `uuid()` 是客户端默认值，数据库没有 DEFAULT**。

| 方案 | 谁生成 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 应用侧 UUID | Python/TS 客户端 | 不依赖 DB、可提前知道 id | 需自己保证唯一 |
| DB 侧 `gen_random_uuid()` | PG | 天然唯一 | 插入后才拿到 id |

> 项目选应用侧（`str(uuid.uuid4())`，见 `apps.py`），因为 **两套后端要写入同一张表**，必须用同一套生成规则。

### 6.5 外键与级联

```python
owner_id: Mapped[str] = mapped_column(
    String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
)
```

| 部分 | 作用 |
| --- | --- |
| `ForeignKey("users.id")` | 建 FK 约束 |
| `ondelete="CASCADE"` | **DB 层**级联删除 |
| `index=True` | FK 列建索引（PG **不会**自动为 FK 建索引） |

> 配合 `relationship(..., passive_deletes=True)`：ORM 不逐条 `UPDATE ... SET app_id = NULL`，交给 DB 级联（PG 教程 11/01 讲过）。

---

## 7. `select()` 查询（2.0 API）

### 7.1 基本形状

```python
from sqlalchemy import select

stmt = select(App).where(App.owner_id == user.id).order_by(App.created_at.desc())
apps = db.scalars(stmt).all()
```

| 1.x | 2.0 |
| --- | --- |
| `db.query(App).filter_by(owner_id=...)` | `db.scalars(select(App).where(...))` |
| `.all()` 直接可用 | 要经过 `scalars()` |

> 2.0 仍然保留了 `Session.query()`（legacy），但**新代码一律用 `select()`**。

### 7.2 `scalars()` vs `execute()`

```python
result = db.execute(select(App.id, App.name))
rows = result.all()                 # [(id, name), ...]

result = db.execute(select(App))
models = result.scalars().all()     # [App, App, ...]
```

| 方法 | 返回 |
| --- | --- |
| `execute(select(App))` | `Result`，每行是**单元素 Row** |
| `execute(...).scalars()` | `ScalarResult`，直接是模型对象 |
| `scalars(stmt)` | `Session.scalars()` 的简写 |

> 只查部分列（`select(App.id, App.name)`）时用 `execute()`；查整个实体时用 `scalars()`。

### 7.3 常用取数方法

```python
db.scalars(stmt).all()              # 列表
db.scalars(stmt).first()            # 第一条或 None
db.scalars(stmt).one()              # 恰好一条，否则抛异常
db.scalars(stmt).one_or_none()      # 0 或 1 条，多了抛异常
db.scalar(select(func.count()).select_from(App))   # 标量
```

| 方法 | 0 条 | 1 条 | 多条 |
| --- | --- | --- | --- |
| `first()` | `None` | 值 | 第一条 |
| `one()` | ❌ 抛 | ✅ | ❌ 抛 |
| `one_or_none()` | `None` | ✅ | ❌ 抛 |
| `scalar()` | `None` | 标量 | 第一行第一列 |

> 用 `one_or_none()` 能把「数据异常（重复）」暴露成错误，而不是悄悄取第一条。

### 7.4 `session.get()`：按主键取

```python
app = db.get(App, app_id)          # 先查身份映射，再查库
```

| 优点 | 说明 |
| --- | --- |
| 走身份映射 | 同会话内已加载则不发 SQL |
| 语法短 | `<Model>, pk` |
| 不支持条件 | 只能按主键 |

> 项目 `_find_owned()` 用 `db.get(App, app_id)` 再判 `owner_id`——**先按主键取，再做归属校验**，比 `where(id=?, owner_id=?)` 更能区分「不存在」与「无权」（虽然两者都回 404）。

---

## 8. 会话 CRUD

```python
# 增
app = App(id=str(uuid.uuid4()), owner_id=user.id, name="x")
db.add(app)
db.commit()
db.refresh(app)              # 从库读回 DB 生成的默认值（如 created_at）

# 改
app.name = "新名字"
db.commit()                  # onupdate 使 updated_at 自动刷新

# 删
db.delete(app)
db.commit()
```

| 方法 | 作用 |
| --- | --- |
| `add(obj)` | 加入会话（`pending`） |
| `add_all([...])` | 批量 |
| `flush()` | 发 SQL 但不提交（拿到自增 id/默认值） |
| `commit()` | 提交事务 |
| `refresh(obj)` | 重新 SELECT 覆盖对象属性 |
| `delete(obj)` | 标记删除 |
| `expire_all()` | 让所有对象下次访问重新查库 |

> `refresh` 的必要性：`server_default` 生成的值（如 `created_at`）在 `commit` 前 ORM 不知道；`expire_on_commit=False` 又不会自动过期，所以显式 `refresh` 最稳。

### 8.1 `autoflush=False`

| 值 | 行为 |
| --- | --- |
| `True`（默认） | 每次查询前自动 `flush` 待写入对象（可能触发**意外的 INSERT/UPDATE**） |
| `False`（项目） | 查询前不自动 flush，写入时机完全由你控制 |

```python
db.add(App(...))
apps = db.scalars(select(App)).all()     # autoflush=True 时：先 INSERT 再 SELECT
```

> `autoflush=False` 让「查询」与「写入」解耦，避免半成品对象被意外落库。代价是要记得在查询前手动 `flush()`（如果查询依赖未提交的写入）。

### 8.2 `expire_on_commit=False`

| 值 | commit 后访问属性 |
| --- | --- |
| `True`（默认） | 对象过期 → 下次访问**触发 SELECT**（会话已关闭则报 `DetachedInstanceError`） |
| `False`（项目） | 属性保留，不触发查询 |

> 这对 FastAPI 很关键：视图里 `commit()` 后要把对象转成 `AppResponse`——若 `expire_on_commit=True` 且会话已关闭，就会在序列化时炸。

---

## 9. 项目实战：`db.py` 与两个模型

### 9.1 `db.py` 的两行

| 代码 | 决策 | 理由 |
| --- | --- | --- |
| `create_engine(..., pool_pre_ping=True, future=True)` | 开预探测 | 云 PG 会断空闲连接 |
| `sessionmaker(..., autoflush=False, expire_on_commit=False)` | 关自动 flush、关提交过期 | 写入时机可控、commit 后仍能读属性 |

> 文件顶部注释还声明了**迁移所有权**：「DDL 由 TS 侧 Prisma 拥有，Python 只做映射」——这是双栈共表的铁律。

### 9.2 `models/app.py` 的映射要点

| 列 | 映射 | 注意 |
| --- | --- | --- |
| `id` | `String` 主键 | 应用侧 UUID，DB 无默认 |
| `owner_id` | `String` + FK + `index=True` | PG 不为 FK 自动建索引 |
| `mode` | `server_default="chatflow"` | DDL 默认，裸 SQL 也生效 |
| `created_at` | `server_default=func.now()` | 由 DB 生成 |
| `updated_at` | `default` + `onupdate` | ORM 兜底，DB 触发器权威 |
| `graph_json` | `JSONB` | 需 PG 方言类型 |
| `published_at` | `DateTime()` naive | 对齐 Prisma 的 `timestamp(3)` |

### 9.3 一个「看起来能跑但会炸」的例子

```python
class App(Base):
    __tablename__ = "apps"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)  # ❌ 弃用
```

| 问题 | 说明 |
| --- | --- |
| `datetime.utcnow()` 已弃用（3.12+ 警告） | 用 `datetime.now(timezone.utc)` 或 `func.now()` |
| 客户端时钟 | 多机不一致 |
| naive vs aware | 与列类型不匹配时区语义 |

> SQLAlchemy 的 `default=` 可以是 Python 可调用对象，但要小心**在 import 时求值**（写成 `default=datetime.now()` 就变成固定值，是经典 bug）。

---

## 10. 与 Prisma 对照

| SQLAlchemy 2.0 | Prisma | 说明 |
| --- | --- | --- |
| `DeclarativeBase` 子类 | `model X { }` | 声明模型 |
| `Mapped[str]` + `mapped_column` | `String` | 字段类型 |
| `ForeignKey("users.id", ondelete="CASCADE")` | `@relation(onDelete: Cascade)` | 外键 |
| `server_default` | `@default(...)` | DDL 默认值 |
| `default` / `onupdate` | `@updatedAt` | ORM 层行为 |
| `JSONB`（方言） | `Json` → `jsonb` | 类型映射 |
| `index=True` | `@@index([...])` | 索引 |
| `select(App).where(...)` | `prisma.app.findMany({ where })` | 查询 |
| `db.get(App, id)` | `findUnique({ where: { id } })` | 主键查询 |
| `Session` | `PrismaClient` | 工作单元 vs 客户端 |
| `passive_deletes=True` | 由 DB 级联 | 信任 DB |

> 关键差异：**Prisma 的 `@default(uuid())` 在 DB 层没有 DEFAULT**（客户端生成），而 SQLAlchemy 里 `server_default` 才是真·数据库默认。理解这点，双栈共表才不会出现「一边插入成功、一边报 not null」。

---

## 11. 验收自测

### 11.1 判断

1. `Engine` 是线程安全的吗？
2. `server_default` 只在 ORM 插入时生效吗？
3. `db.execute(select(App)).all()` 返回的是 `App` 对象列表吗？
4. `expire_on_commit=True` 时，commit 后访问属性会怎样？

<details>
<summary>答案</summary>

1. ✅ 线程安全（内部连接池）；`Session` 不安全。
2. ❌ 写进 DDL，**任何**插入都生效。
3. ❌ 返回 `Row` 列表；要 `scalars()` 才是模型对象。
4. 对象被标记过期，下次访问属性会**重新查库**（会话关闭则 `DetachedInstanceError`）。

</details>

### 11.2 找错

```python
updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now(), onupdate=datetime.now())
```

两个问题：

1. `datetime.now()` **在 import 时求值**，所有行拿到同一个固定时间 → 应传可调用对象 `datetime.now` 或 `func.now()`；
2. `datetime.now()` 是本地时区 naive，多机不一致 → 用 `func.now()` 或 `datetime.now(timezone.utc)`。

### 11.3 动手题

写一个 `Tag` 模型：`id`（str 主键）、`name`（唯一、非空、≤32 由应用层保证）、`created_at`（DB 默认）、`owner_id`（FK→users.id，级联删除，带索引）。

<details>
<summary>参考</summary>

```python
class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
```

注意：由于 DDL 由 Prisma 拥有，这个模型必须在 Prisma schema 里先建表，Python 侧才能映射。

</details>

---

## 12. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `ModuleNotFoundError: psycopg2` | URL 没写 `+psycopg` | 改 `postgresql+psycopg://` |
| 偶尔 `server closed the connection` | 池里有死连接 | `pool_pre_ping=True` + `pool_recycle` |
| `too many clients already` | 连接数超 `max_connections` | 按 `workers × (pool+overflow)` 核算 |
| 请求卡在取连接 | `pool_timeout` | 调池大小或加超时降级 |
| `DetachedInstanceError` | commit 后会话关闭且 `expire_on_commit=True` | 设 `expire_on_commit=False` 或提前转 DTO |
| 查询前意外写入 | `autoflush=True` | 设 `autoflush=False`，显式 `flush` |
| `datetime.now()` 写成 `default=datetime.now()` | 导入时求值 | 传函数对象或 `func.now()` |
| `updated_at` 不刷新 | 只有 `default` 没 `onupdate` | 加 `onupdate=func.now()` |
| 手工 SQL 改数据后 `updated_at` 没变 | 只有 ORM 层逻辑 | DB 触发器（项目已加） |
| 删父级报 FK 冲突 | ORM 试图 `SET NULL` | `ondelete="CASCADE"` + `passive_deletes=True` |
| FK 查询慢 | 没建索引 | `index=True`（PG 不自动建） |
| `JSON` 用不了 `@>` | 用了通用 `JSON` | 换 `postgresql.JSONB` |
| 时间差 8 小时 | naive 列 + 本地时区写入 | 统一 UTC 写入 + `iso_z` 输出 |
| `select` 结果不是模型 | 用了 `execute` 未 `scalars` | `scalars()` |
| `first()` 掩盖了数据重复 | 用错取数方法 | 用 `one_or_none()` 暴露问题 |
| 生产开了 `echo=True` | 复制了调试配置 | 关掉（日志量巨大） |

---

## 13. 本篇小结

- **四层职责**：ORM（对象）/ Core（SQL）/ Engine（池）/ Dialect（方言）。
- **Engine 进程级单例、Session 请求级**；Session 不能跨线程。
- **URL 必须带驱动段**：装的是 `psycopg` 就写 `postgresql+psycopg://`。
- **连接池容量要算总账**：`workers × (pool_size + max_overflow) < max_connections`。
- **`pool_pre_ping=True` 生产必开**，`echo` 只在开发开。
- **2.0 风格**：`DeclarativeBase` + `Mapped[T]` + `mapped_column()`，`nullable` 可从注解推导。
- **`JSONB` 用 PG 方言类型**，否则 GIN 索引与 `@>` 都用不了。
- **三种默认值**：`server_default`（DDL，谁都生效）/ `default`（ORM insert）/ `onupdate`（ORM update）。
- **双栈共表要「DB 权威 + ORM 兜底」**：不能假设所有写入都经过 Python。
- **主键用应用侧 UUID**：Prisma 的 `uuid()` 在 DB 无默认，两边必须同一规则。
- **`select()` 是 2.0 查询入口**；`execute` 拿 Row，`scalars` 拿模型。
- **`one_or_none()` 优于 `first()`**：前者能暴露数据异常。
- **`autoflush=False` 让读写解耦**，`expire_on_commit=False` 让 commit 后仍可读属性。
- **项目范式**：`db.py` 两行配置 + 模型顶部声明「DDL 归 Prisma」，是双栈共表的样板。
- **下一步**：Session 生命周期与依赖——`get_db`、事务边界、`commit`/`rollback` 放哪。
