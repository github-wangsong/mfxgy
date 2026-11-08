# 04 · SQLAlchemy 关系（应用管理）

> 阶段 2 · 第 4 步
>
> 做完：Python 侧映射 `apps` 表，`User.apps` / `App.owner` 双向关系可用；`ForeignKey(..., ondelete="CASCADE")` 与数据库一致；**不建表、不改 DDL**。
>
> **本篇面试考点**：`relationship` 不是数据库关系 · `back_populates` vs `backref` · 字符串类名与 mapper 注册顺序 · `passive_deletes=True` 为什么必须加 · `index=True` 在“不建表”模式下意味着什么 · `default` / `onupdate` / `server_default` 三者的区别。

---

## 1. 决策表

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| DDL 归属 | Prisma 迁移 | 两套迁移系统同时建表必然冲突 |
| 外键声明 | `ForeignKey("users.id", ondelete="CASCADE")` | 与迁移里的 `ON DELETE CASCADE` 对齐；ORM 不能“重新定义”它，只用于关系解析 |
| 索引 | `owner_id` 上 `index=True` | 仅作元数据标注，不会产生 DDL；提醒读者库里有索引 |
| 关系方向 | `User.apps` ↔ `App.owner`，`back_populates` | 双向显式声明，读代码能立刻找到另一侧 |
| 删除子记录 | 交给数据库 `ON DELETE CASCADE` | 两套后端共享同一张表，数据库是唯一权威 |
| `updated_at` | `default=func.now()` + `onupdate=func.now()` | 应用层兜底；权威仍是数据库触发器 |
| 画布字段 | 阶段 3 再加 | 现在映射会得到永远为 `NULL` 的列 |

---

## 2. 两边的关系声明

**完整文件路径：`apps/api-py/app/models/user.py`**（阶段 2 的快照）

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

    # 反向关系：不产生列，只提供 user.apps 这个访问入口。
    # 字符串 "App" 表示延迟到 mapper 配置时再解析类对象（避免循环导入）。
    apps: Mapped[list["App"]] = relationship("App", back_populates="owner")
```

**完整文件路径：`apps/api-py/app/models/app.py`**（阶段 2 的快照）

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

    # 主键值由应用侧生成（uuid4），数据库列没有 DEFAULT
    id: Mapped[str] = mapped_column(String, primary_key=True)
    # 外键：ondelete 必须与迁移里的 ON DELETE CASCADE 一致。
    # index=True 只是元数据声明（不执行 create_all 时不会建索引），
    # 真正的索引来自 Prisma 迁移里的 apps_owner_id_idx。
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # 可为空：没填描述时是 NULL（不是空字符串）
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    # 与列默认值 'chatflow' 对齐（server_default 只在生成 DDL 时生效）
    mode: Mapped[str] = mapped_column(String, nullable=False, server_default="chatflow")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # 应用层兜底：INSERT 用 now()，UPDATE 时 onupdate 刷新。
    # 权威仍是数据库触发器 apps_set_updated_at（手工 SQL 也会被刷新）。
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=func.now(), onupdate=func.now()
    )

    # 正向关系：app.owner 直接拿到 User 对象
    owner: Mapped["User"] = relationship("User", back_populates="apps")
```

> 阶段 3 会在这里追加 `graph_json` / `published_graph_json` / `published_at`，阶段 9/10 再追加子关系。本篇保持最小可用。

**完整文件路径：`apps/api-py/app/models/__init__.py`**（阶段 2 的快照）

```python
"""数据模型包。

集中导入所有模型：只要有任何一处 `from app.models import ...`，
包初始化就会把所有模型注册进 SQLAlchemy 的 mapper registry，
字符串形式的关系（"App" / "User"）才能被解析。
"""

from app.models.app import App
from app.models.base import Base
from app.models.user import User

__all__ = [
    "App",
    "Base",
    "User",
]
```

> **面试考点 · `relationship` 是数据库关系吗？**
> 不是。数据库里只有 `apps.owner_id` 这一列和一条外键约束。`relationship()` 是 **ORM 层的导航属性**：
>
> - 不产生任何列、索引或约束；
> - 只在 Python 对象上提供 `user.apps` / `app.owner`；
> - 访问 `user.apps` 时，SQLAlchemy 会**额外发一条 SELECT**（懒加载）。
>
> 所以“关系”有两层：数据库层（外键，保证完整性）和 ORM 层（导航，方便写代码）。**审计表结构只看迁移，不看模型类。**

> **面试考点 · `back_populates` 和 `backref` 有什么区别？**
>
> - `back_populates`：两侧都显式声明，各自写出对方的属性名。多写一行，但关系一眼可见，IDE 能补全，修改时不会漏。
> - `backref`：只在一侧声明，另一侧自动生成。少写代码，但“这个属性从哪来的”在代码里搜不到。
>
> 本项目用 `back_populates`。**隐式生成的属性是排查问题的成本，不是省下来的时间。**

> **面试考点 · 为什么用字符串 `"App"` 而不是直接写类名？**
> `user.py` 与 `app.py` 互相 import 会形成循环导入。写字符串后，SQLAlchemy 在 **mapper 配置阶段**（第一次使用 ORM 时）才去 registry 里按名字找类。
> 前提是：**所有模型必须在那之前被导入过**。`app/models/__init__.py` 集中导入就是干这个的——任何 `from app.models.xxx import Xxx` 都会先执行包的 `__init__`，从而把所有模型注册上。
> 如果漏了导入，运行时会报 `InvalidRequestError: expression 'App' failed to locate a name`。

---

## 3. 删除策略：为什么必须 `passive_deletes=True`

阶段 2 的 `App` 还没有子表，但阶段 9/10 会给它加 `conversations`、`api_keys`。一旦有了子关系，删除行为就有一个经典坑：

**完整文件路径：`apps/api-py/app/models/app.py`**（阶段 9/10 追加后的样子，先看结论）

```python
    # 删应用时由数据库 ON DELETE CASCADE 删会话，避免 ORM 把外键置 NULL
    conversations: Mapped[list["Conversation"]] = relationship(
        "Conversation", back_populates="app", passive_deletes=True
    )
    # 删应用时由数据库 ON DELETE CASCADE 删 API Key
    api_keys: Mapped[list["ApiKey"]] = relationship(
        "ApiKey", back_populates="app", passive_deletes=True
    )
```

> **面试考点 · 不加 `passive_deletes=True` 会怎样？**
> 执行 `session.delete(app)` 时，SQLAlchemy 默认会：
>
> 1. 先 `SELECT` 出所有子记录；
> 2. 把它们的 `app_id` 逐个 `UPDATE` 成 `NULL`；
> 3. 再删父记录。
>
> 但这些子表的 `app_id` 是 `NOT NULL`——于是抛约束错误。更糟的是，明明数据库已经配了 `ON DELETE CASCADE`，ORM 却抢在数据库前面做了一遍错误的“清理”。
>
> `passive_deletes=True` 告诉 ORM：**别管子记录，交给数据库。** 这才是“级联删除由数据库拥有”的正确写法。
>
> **追问：那 `cascade="all, delete-orphan"` 呢？**
> 那是让 ORM 自己删子对象，适合“子对象的生命周期完全由父对象管理”的单体应用。本项目两套后端共享一张表，删除语义必须只有一份，所以选数据库级联 + `passive_deletes`。

---

## 4. `default` / `onupdate` / `server_default` 三者的区别

`updated_at` 一行里同时出现了三种时间机制，很容易混：

| 机制 | 在哪生效 | 本项目用途 |
| --- | --- | --- |
| `default=func.now()` | SQLAlchemy 生成 INSERT 语句时 | INSERT 兜底，保证 ORM 写入有值 |
| `onupdate=func.now()` | SQLAlchemy 生成 UPDATE 语句时 | UPDATE 兜底，ORM 路径刷新时间 |
| `server_default=func.now()` | **只在 `create_all` 生成 DDL 时** | 本项目中无实际作用（表不是它建的），仅作文档标注 |
| 数据库触发器 | 所有 UPDATE（含手工 SQL） | **权威**，最终以它为准 |

> **面试考点 · 为什么 `index=True` 和 `server_default` 在“不建表”模式下是“假的”？**
> 因为这两者都只在**生成 DDL** 时被使用。本项目从不调用 `Base.metadata.create_all()`（DDL 归 Prisma），所以：
>
> - `index=True` 不会真的 `CREATE INDEX`；
> - `server_default` 不会真的 `ALTER TABLE ... SET DEFAULT`；
> - 它们仍然有价值：**声明意图**，让读模型的人知道库里有索引、有默认值。
>
> 真正的结构以 `prisma/migrations/*.sql` 为准。**模型是对表的“描述”，不是表的“定义”。**

---

## 5. 验证

```powershell
cd apps/api-py
```

```powershell
# 1. 列名与 Prisma 建的列一致（不多不少）
uv run python -c "from app.models import App; print(sorted(App.__table__.columns.keys()))"
```

预期：

```text
['created_at', 'description', 'id', 'mode', 'name', 'owner_id', 'updated_at']
```

```powershell
# 2. 关系注册成功；外键的 ondelete 与迁移一致
uv run python -c "from sqlalchemy import inspect; from app.models import App, User; print([r.key for r in inspect(User).relationships()]); print([fk.ondelete for fk in App.__table__.foreign_keys])"
```

预期：

```text
['apps']
['CASCADE']
```

```powershell
# 3. 读 Prisma 写入的数据：alice 的应用
uv run python -c "from sqlalchemy import select; from app.db import SessionLocal; from app.models import User; s = SessionLocal(); u = s.scalar(select(User).where(User.email == 'alice@example.com')); print(u.email, [(a.name, a.mode, a.owner_id == u.id) for a in u.apps]); s.close()"
```

预期（列表内容取决于当前库里的数据）：

```text
alice@example.com [('support-bot', 'chatflow', True)]
```

```powershell
# 4. 确认 Python 侧没有任何建表代码
Select-String -Path app -Pattern "create_all" -Recurse
```

预期：无输出。**Python 不产生 DDL。**

```powershell
# 5. 反向关系也能用：app.owner
uv run python -c "from sqlalchemy import select; from app.db import SessionLocal; from app.models import App; s = SessionLocal(); a = s.scalar(select(App).limit(1)); print(a.name, a.owner.email if a else None); s.close()"
```

> **面试考点 · 验证 3 的 `u.apps` 发了什么 SQL？**
> 一条 `SELECT users ...` + 一条 `SELECT apps WHERE owner_id = ?`。这就是**懒加载**：访问关系属性时才查。
> 如果先查 100 个用户、再逐个访问 `user.apps`，就是 101 条 SQL——**N+1 问题**。正确做法是直接查 `apps`（本项目列表接口就是这么做的），或者用 `selectinload(User.apps)` 一次性预加载。
> **N+1 不是 ORM 的 bug，是“在循环里访问懒加载关系”的写法问题。**

---

## 6. 下一步

- `05-FastAPI应用模块.md`：`GET/POST/GET{id}/PATCH/DELETE /apps`，归属校验统一 404，与 NestJS 行为逐字节对齐。
