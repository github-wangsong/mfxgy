# 02 · Session 生命周期与依赖

> 所属：阶段 6 · 数据层
> 本篇覆盖：`Session` 的四个身份（工作单元 / 身份映射 / 一级缓存 / 事务边界）、四种生命周期选择（全局 / 函数级 / 请求级 / 嵌套）、一次请求里 Session 的完整时序、**事务边界的三种放法**（视图内 `commit` / 依赖内 `commit` / 服务层 `commit`）与选型、`flush` / `commit` / `refresh` / `rollback` / `close` 五方法与状态机、并发写冲突的捕获与重试（`IntegrityError` + `rollback` + 重试）、`begin_nested()` 的 SAVEPOINT、长事务的三重危害、`DetachedInstanceError` 与延迟加载、测试里替换 Session 与事务回滚夹具
> **本篇首次教学：`Session` 是「工作单元」而非「连接」、请求级 Session 的生命周期与依赖缓存的关系、三种事务边界模式与「依赖管事务 / 视图管事务」的取舍、`flush()`（发 SQL 不提交）与 `commit()`（提交并释放连接）的区别、`rollback()` 之后 Session 仍可复用（新事务 + 对象过期）、`IntegrityError` 重试的正确写法（每次重试都要重新读状态）、`begin_nested()` 生成 SAVEPOINT、长事务为何会阻塞 VACUUM 与锁、`expire_on_commit=False` 与 `DetachedInstanceError` 的关系、`dependency_overrides` 换 Session 与「外层事务回滚」测试夹具**
> 预告：下一篇讲关系、级联与查询——`relationship`、`selectinload`/`joinedload` 解决 N+1、聚合与分页。

> 项目锚点：`apps/api-py/app/api/deps.py` 的 `get_db`（生成器依赖）、`apps/api-py/app/api/apps.py` 的「视图内 `commit` + `refresh`」、`apps/api-py/app/conversations/service.py` 的 `append_message`（**真实的重试代码**：`for attempt in range(1, 3+1)` + `IntegrityError` → `rollback` → 重试）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 说清 `Session` 与「数据库连接」的关系（不是一回事）。
2. 画出一次请求中 Session 的创建、使用、提交、关闭时序。
3. 在三种事务边界模式中做出选择并说明理由。
4. 解释 `flush()` 与 `commit()` 的差别，以及什么时候必须 `refresh()`。
5. 正确写「唯一约束冲突 → 回滚 → 重试」的代码。
6. 说出长事务会带来哪三类问题。
7. 在测试里用外层事务回滚来隔离数据。

**验收标准**

- 能解释「同一个请求里 `get_db` 只执行一次」对事务意味着什么。
- 能说出 `rollback()` 后原 Session 还能不能继续用。
- 能判断一段代码是否会造成长事务。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [06-数据层/01 SQLAlchemy 2.0 核心](./01-SQLAlchemy2.0核心.md)（Engine/Session、`SessionLocal`、2.0 查询）、[05-FastAPI核心/02 Depends](../05-FastAPI核心/02-Depends依赖注入.md)（生成器依赖、同请求缓存） |
| 已掌握 | 事务基础（`BEGIN`/`COMMIT`/`ROLLBACK`）、PG 的 MVCC 概念（可只记住「长事务阻碍清理」） |

---

## 3. `Session` 是什么

### 3.1 它不是连接

| 误解 | 事实 |
| --- | --- |
| 「Session 就是一条数据库连接」 | Session 是**工作单元**，按需从连接池**借**连接，事务结束就还回去 |
| 「创建一个 Session 就占一条连接」 | 创建时不占；首次执行 SQL 才借 |
| 「Session 可以全局复用」 | 不能（状态会串、并发不安全） |

```
Session
├── 身份映射（identity map）：id → 对象，同一行只映射成一个对象
├── 一级缓存：已加载对象不重复查询
├── 待写队列：pending / dirty / deleted
└── 事务：flush 时借连接，commit/rollback 时归还
```

### 3.2 身份映射的实际影响

```python
a = db.get(App, "a1")
b = db.get(App, "a1")
assert a is b          # ✅ 同一个 Python 对象
```

| 好处 | 说明 |
| --- | --- |
| 一致性 | 同一请求内看到同一份数据，不会「两次查询两个值」 |
| 少查询 | 第二次 `get` 不发 SQL |
| 可追踪修改 | 改属性即进入 `dirty`，`flush` 时生成 `UPDATE` |

> 这也是「一个请求一个 Session」的理由：**请求内的一致视图**。

---

## 4. 生命周期怎么选

| 方案 | 写法 | 评价 |
| --- | --- | --- |
| **全局单例** | `session = SessionLocal()` 放模块级 | ❌ 灾难：状态串、并发不安全、事务永不结束 |
| **函数级** | 每个函数内部 `with SessionLocal() as s:` | ✅ 适合脚本、后台任务 |
| **请求级** | `Depends(get_db)` | ✅ **Web 应用标准做法** |
| **嵌套/独立** | 函数内部再开一个 Session | ⚠️ 仅在需要独立事务时（如审计日志） |

### 4.1 为什么全局 Session 是灾难

| 问题 | 后果 |
| --- | --- |
| 非线程安全 | 多线程共享 → 状态错乱、随机报错 |
| 一级缓存不刷新 | 永远读到旧对象 |
| 事务永不提交/回滚 | 连接被长期占用 |
| 对象累积 | 内存持续增长（identity map 持有引用） |
| 错误互相污染 | 一个请求的失败影响其他请求 |

> 判断口诀：**Session 的生命周期应该「不短于一次业务操作，不长于一个请求」**。

### 4.2 请求级：完整时序

```python
def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
```

```
请求到达
  ↓  FastAPI 解析依赖 → 调用 get_db()
  ↓  SessionLocal() 创建 Session（还没借连接）
  ↓  yield session → 注入视图
  ↓  视图执行：db.get(...) / db.add(...) / db.commit()
  ↓  视图返回
  ↓  请求结束 → FastAPI 恢复生成器 → 执行 with 退出 → session.close()
  ↓  连接归还池
```

| 关键点 | 说明 |
| --- | --- |
| 依赖缓存 | 同一请求内 `get_db` **只执行一次**（[05/02 §5.2](../05-FastAPI核心/02-Depends依赖注入.md)） |
| 视图与依赖共享 | 视图的 `db` 与 `get_current_user` 内部的 `db` 是同一个 Session |
| 关闭即释放 | `close()` 归还连接（未提交的事务会被回滚） |
| 异常也会关闭 | 生成器依赖的 teardown 在异常路径同样执行 |

> 易忽略：**忘记 `commit` 时数据不会丢在「内存」里——它会被回滚**。`close()` 等价于「回滚未提交事务」。

---

## 5. 事务边界放哪

### 5.1 三种模式

**A. 视图内 `commit`（项目现状）**

```python
@router.post("")
def create_app(body: CreateAppRequest, db: Session = Depends(get_db)):
    app = App(...)
    db.add(app)
    db.commit()
    db.refresh(app)
    return _to_app_response(app)
```

| 优点 | 缺点 |
| --- | --- |
| 直观，一个接口一个事务 | commit 散落各处，容易漏 |
| 适合简单 CRUD | 一个请求内多段写入时难以组合 |

**B. 依赖内 `commit`（统一事务）**

```python
def get_tx(db: Session = Depends(get_db)):
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
```

| 优点 | 缺点 |
| --- | --- |
| 视图不写 commit，不会漏 | 所有写入被塞进一个事务（长事务风险） |
| 异常自动回滚 | 「先写日志再失败」这类需求不好做 |

**C. 服务层 `commit`（领域事务）**

```python
def create_conversation(db, owner_id, app_id) -> Conversation:
    conversation = Conversation(...)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation
```

| 优点 | 缺点 |
| --- | --- |
| 事务贴近业务规则 | 服务层耦合事务控制 |
| 接口层可以组合多个服务 | 跨服务组合时需要「不提交」的变体 |

### 5.2 项目为什么选 A

| 理由 | 说明 |
| --- | --- |
| 接口粒度简单 | 应用 CRUD 一次写入 |
| 需要多段提交 | 阶段 4/9 的 run/event 需要「先建 run 再追加事件」 |
| 与 TS 侧对齐 | Prisma 的 `await prisma.app.create()` 自带事务 |

> 选型不是「谁更高级」，而是**事务边界应当与业务原子性一致**。需要「全成或全败」时用 B；需要「多段独立提交」时用 A/C。

### 5.3 一个请求里开两个 Session（独立事务）

```python
def write_audit(owner_id: str, action: str) -> None:
    with SessionLocal() as audit_db:      # 独立 Session
        audit_db.add(AuditLog(...))
        audit_db.commit()
```

| 场景 | 说明 |
| --- | --- |
| 审计日志必须落库 | 即使主事务回滚也要留下记录 |
| 后台任务 | 与请求事务无关 |

> 代价：多占一条连接；要评估池容量（[06/01 §4.4](./01-SQLAlchemy2.0核心.md)）。

---

## 6. 五个方法与状态机

### 6.1 方法表

| 方法 | 做什么 | 是否发 SQL | 事务 |
| --- | --- | --- | --- |
| `add(obj)` | 加入会话（`pending`） | ❌ | — |
| `flush()` | 把待写队列写入 DB | ✅ INSERT/UPDATE/DELETE | 事务仍开着 |
| `commit()` | `flush` + `COMMIT` | ✅ | 结束，连接归还 |
| `rollback()` | 丢弃事务内所有改动 | ❌（可能发 ROLLBACK） | 结束 |
| `refresh(obj)` | 重新 `SELECT` 覆盖属性 | ✅ | 新事务 |
| `close()` | 释放连接、清空会话 | ❌ | 未提交则回滚 |

### 6.2 对象状态

```
transient（未加入会话）
   ↓ add()
pending（待 INSERT）
   ↓ flush()
persistent（有 id，与会话关联）
   ↓ commit（expire_on_commit=True）
expired（下次访问重新查库）
   ↓ close()
detached（脱离会话，属性已加载则可读）
```

### 6.3 `flush()` 什么时候必须用

```python
db.add(app)
db.flush()          # 拿到 DB 生成的默认值 / 自增 id
print(app.created_at)
```

| 场景 | 为什么 |
| --- | --- |
| 需要 DB 默认值马上可用 | `server_default` 只有 INSERT 后才知道 |
| 需要拿到自增 id | 同主键生成策略有关 |
| 后续查询依赖这次写入 | `autoflush=False` 时不会自动 flush |

> `commit()` 内部会先 `flush()`，所以「只是要落库」不必手动 flush。

### 6.4 `refresh()` 为什么常见

```python
db.add(app)
db.commit()
db.refresh(app)          # 重新读回，拿到 created_at / updated_at / 触发器写入的值
```

| 不 refresh 的风险 | 说明 |
| --- | --- |
| `created_at` 是 `None` | `server_default` 的值 ORM 不知道 |
| `updated_at` 是旧值 | DB 触发器刷新了，但对象里还是旧值 |
| 序列化报错 | 输出模型要求非空时间 |

> 项目 `apps.py`/`conversations/service.py` 都是「`commit()` → `refresh()`」的固定搭配——**因为时间列由 DB/触发器负责**。

---

## 7. 并发写冲突与重试（真实代码）

### 7.1 场景

`Message` 表用 `(conversation_id, seq)` 唯一约束，`seq` 由「`max(seq) + 1`」计算。两个并发请求可能算出同一个 `seq` → 唯一冲突。

### 7.2 项目实现（`conversations/service.py` 节选）

```python
APPEND_MESSAGE_RETRIES = 3

for attempt in range(1, APPEND_MESSAGE_RETRIES + 1):
    try:
        last_seq = db.execute(
            select(func.max(Message.seq)).where(Message.conversation_id == conversation_id)
        ).scalar_one_or_none()
        db.add(
            Message(
                id=str(uuid.uuid4()),
                conversation_id=conversation_id,
                role=role,
                content=content,
                seq=(last_seq or 0) + 1,
                run_id=run_id,
            )
        )
        db.execute(
            update(Conversation)
            .where(Conversation.id == conversation_id)
            .values(updated_at=func.now())
        )
        db.commit()
        return
    except IntegrityError:
        db.rollback()
        if attempt >= APPEND_MESSAGE_RETRIES:
            raise
```

### 7.3 五个必须做对的点

| 点 | 为什么 |
| --- | --- |
| `try` 包住「读 max → 插入 → 提交」 | 冲突可能发生在 commit |
| 捕获 **`IntegrityError`** | 唯一约束冲突在 SQLAlchemy 里是这个异常 |
| **必须先 `rollback()`** | 事务已失败，不回滚无法开始下一次 |
| **重试时重新读 `max(seq)`** | 上次的 `last_seq` 已过期 |
| **最后一次不再重试，直接 `raise`** | 否则异常被吞，接口假装成功 |

### 7.4 `rollback()` 之后 Session 还能用吗

**能**。`rollback()` 结束当前事务，Session 自动开启新事务；已加载对象被标记过期（下次访问重新查库）。

| 操作 | 结果 |
| --- | --- |
| `db.rollback()` 后继续 `db.execute(...)` | ✅ 正常（新事务） |
| 继续用 `db.add` 的旧对象 | ⚠️ 可能已 `expired`/`detached`，需重新查询 |
| 不 rollback 就重试 | ❌ `PendingRollbackError` |

> 报错长这样（记一下）：

```
PendingRollbackError: This Session's transaction has been rolled back due to a previous
exception during flush. To begin a new transaction with this Session, first issue Session.rollback().
```

### 7.5 为什么不用乐观锁版本号

| 方案 | 适用 |
| --- | --- |
| 唯一约束 + 重试（项目） | 冲突概率低、代价小 |
| 版本号 `version` 字段 | 冲突需要提示用户（409） |
| `SELECT ... FOR UPDATE` | 强一致、冲突频繁 |
| 分布式锁 | 跨服务 |

> 「唯一约束兜底 + 有限重试」是最省基础设施的做法，代价是冲突多时延迟上升。

---

## 8. SAVEPOINT：嵌套事务

```python
with db.begin_nested():          # SAVEPOINT
    db.add(Order(...))
    # 这里出错只回滚到 SAVEPOINT，外层事务可继续
```

| 场景 | 说明 |
| --- | --- |
| 批量导入「允许部分失败」 | 每条一个 SAVEPOINT，坏数据跳过 |
| 可选步骤 | 失败不影响主流程 |

```python
for row in rows:
    try:
        with db.begin_nested():
            db.add(Item(**row))
    except IntegrityError:
        failed.append(row)
db.commit()
```

> 注意：PG 里 SAVEPOINT 也有代价（每次 `RELEASE`/`ROLLBACK TO`），**批量大时不如分批提交**。

---

## 9. 长事务的三重危害

```python
@app.post("/import")
def import_data(db=Depends(get_db)):
    for i in range(100_000):
        db.add(Row(...))          # ❌ 一直不 commit
    db.commit()                   # 事务开了几分钟
```

| 危害 | 机制 |
| --- | --- |
| **锁持有时间长** | 行锁/表锁不释放，其他写入排队 |
| **阻塞 VACUUM** | 旧快照未结束，死元组无法回收 → 表膨胀 |
| **连接被占** | 一个长事务占一条连接，池容易被吃满 |
| **回滚代价大** | 失败要撤销全部 |
| **复制延迟** | 大事务在备库应用慢 |

正确做法：

```python
for i, row in enumerate(rows):
    db.add(row)
    if i % 500 == 0:
        db.commit()               # 分批提交
db.commit()
```

> 与 PG 教程阶段 5 的 MVCC 一致：**事务越短越好**。Web 请求里的事务应控制在毫秒级。

---

## 10. `DetachedInstanceError` 与延迟加载

### 10.1 复现

```python
def get_app(db: Session, app_id: str) -> App:
    return db.get(App, app_id)

app = get_app(...)          # Session 已关闭
print(app.owner.email)      # ❌ DetachedInstanceError（触发延迟加载）
```

原因：`relationship` 默认**懒加载**——访问 `app.owner` 时才发 SQL，但 Session 已关闭。

| 解法 | 说明 |
| --- | --- |
| 提前 `selectinload(App.owner)` | 一次查出来（推荐，下一篇讲） |
| 在 Session 存活期内转成 DTO | 项目做法（`_to_app_response`） |
| `expire_on_commit=False` | 只解决「commit 后过期」，不解决懒加载 |
| `lazy="raise"` | 强制显式预加载，防患于未然 |

> 项目之所以没踩这个坑，是因为 **`_to_app_response()` 在视图内（Session 还活着）就把 ORM 对象转成了 Pydantic 模型**。这是「视图返回 DTO 而非 ORM 对象」的现实收益。

### 10.2 为什么 `expire_on_commit=False` 不是万能药

| 它解决的 | 它不解决的 |
| --- | --- |
| commit 后属性被标记过期 → 访问触发 SELECT | 关系属性的首次懒加载 |
| 序列化时 `DetachedInstanceError` | Session 关闭后访问未加载的关系 |

---

## 11. 测试里的 Session

### 11.1 替换依赖

```python
from app.main import app
from app.api.deps import get_db


def override_db():
    with SessionLocal() as s:
        yield s


app.dependency_overrides[get_db] = override_db
```

> key 必须是**同一个函数对象**（[05/02 §10](../05-FastAPI核心/02-Depends依赖注入.md)）。

### 11.2 外层事务回滚夹具（推荐）

思路：测试开始开一个事务，测试里所有写入都在这层事务里，结束直接 `rollback()` —— **数据库保持干净，且不用重建 schema**。

```python
import pytest
from sqlalchemy.orm import Session


@pytest.fixture
def db_session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
```

| 要点 | 说明 |
| --- | --- |
| `join_transaction_mode="create_savepoint"` | 让业务代码里的 `commit()` 变成 SAVEPOINT 释放，不真正提交外层事务 |
| 最后 `transaction.rollback()` | 一次性抹掉所有测试数据 |
| 每测试一个连接 | 互不干扰 |

> 相比「每个测试 truncate 所有表」，外层事务回滚**快得多**，是 SQLAlchemy 测试的常用套路。

---

## 12. 与 Prisma 对照

| SQLAlchemy | Prisma | 说明 |
| --- | --- | --- |
| `Session` | `PrismaClient` + 隐式事务 | Prisma 每次操作自成一个事务 |
| `db.commit()` | 单条 `create()` 自动提交 | 显式 vs 隐式 |
| `db.begin_nested()` | `$transaction([...])` 批量 / 交互式事务 | SAVEPOINT vs 事务数组 |
| 请求级 Session | 全局 `PrismaClient`（连接池内） | **生命周期模型不同** |
| `get_db` 依赖 | 全局 provider 注入 | Prisma 无「请求级事务」概念 |
| `IntegrityError` | `PrismaClientKnownRequestError`（`P2002`） | 唯一冲突码 |
| `rollback()` | 事务回调抛错自动回滚 | 一致 |

> 关键差异：**Prisma 的 `PrismaClient` 类似 Engine（全局复用），SQLAlchemy 的 `Session` 是请求级工作单元**。双栈共表时，Python 侧的事务粒度更细，要注意「TS 一次 `$transaction` 里做的事，Python 可能对应多次 `commit`」。

---

## 13. 验收自测

### 13.1 判断

1. 创建 `Session` 就会占用一条数据库连接。
2. `db.commit()` 之后不 `refresh`，`server_default` 生成的值也能读到。
3. `rollback()` 后这个 Session 就废了，必须重建。
4. `expire_on_commit=False` 能避免所有 `DetachedInstanceError`。

<details>
<summary>答案</summary>

1. ❌ 首次执行 SQL 才借连接。
2. ❌ 需要 `refresh`（或 `flush` 后读）才能拿到 DB 默认值。
3. ❌ 可以继续用，会自动开新事务；只是对象会过期。
4. ❌ 只解决 commit 过期，不解决关系懒加载。

</details>

### 13.2 找错

```python
try:
    db.add(Message(...))
    db.commit()
except IntegrityError:
    pass          # 忽略冲突
```

三个问题：

1. 不 `rollback()` → 后续任何操作报 `PendingRollbackError`；
2. 静默 `pass` → 调用方以为成功；
3. 没有重试或明确失败策略。

### 13.3 动手题

写一个「批量插入 1 万条，允许部分失败」的函数，要求：每 500 条提交一次，单条冲突跳过并计数。

<details>
<summary>参考</summary>

```python
def bulk_insert(db: Session, rows: list[dict]) -> tuple[int, int]:
    ok = failed = 0
    for i, row in enumerate(rows, 1):
        try:
            with db.begin_nested():        # 单条 SAVEPOINT
                db.add(Item(**row))
            ok += 1
        except IntegrityError:
            failed += 1
        if i % 500 == 0:
            db.commit()                    # 分批提交，缩短事务
    db.commit()
    return ok, failed
```

要点：SAVEPOINT 让单条失败不影响整批；分批 `commit` 控制事务长度。

</details>

---

## 14. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 数据没写进去 | 忘了 `commit`，`close()` 时回滚 | 显式提交或改依赖管事务 |
| `PendingRollbackError` | 异常后没 `rollback` 就继续用 | 先 `rollback()` |
| `DetachedInstanceError` | Session 关闭后懒加载关系 | `selectinload` 或提前转 DTO |
| 时间字段是 `None` | 没 `refresh` | `commit()` 后 `refresh()` |
| 并发时报唯一冲突 | 竞态 | 捕获 `IntegrityError` + 回滚 + 重试 |
| 重试三次仍失败 | 冲突持续 | 抛错返回 409 |
| 连接池被打满 | 请求内又开 Session / 长事务 | 复用依赖 Session，缩短事务 |
| 表膨胀、查询变慢 | 长事务阻碍 VACUUM | 分批提交 |
| 一个请求里读到旧数据 | 一级缓存 | `expire`/`refresh`/新 Session |
| 全局 Session 偶发报错 | 非线程安全 + 状态串 | 改请求级 |
| `commit` 在循环里 | 性能差但事务短 | 权衡：分批而非逐条 |
| 事务里做 HTTP 调用 | 事务被网络拖长 | 先查后调，或拆成两段 |
| 测试数据互相污染 | 没隔离 | 事务回滚夹具 |
| `dependency_overrides` 失效 | key 不是同一函数对象 | 用同一导入路径 |
| 多 worker 下连接数翻倍 | 每进程独立池 | 按进程数核算 |

---

## 15. 本篇小结

- **Session 是工作单元**：身份映射 + 一级缓存 + 待写队列 + 事务；不是「一条连接」。
- **请求级是标准答案**：全局 Session 会串状态、占连接、永不结束事务。
- **`close()` 会回滚未提交事务**——忘记 `commit` 不是「暂存」，而是「丢弃」。
- **事务边界要与业务原子性一致**：简单 CRUD 视图内提交；需要全成或全败用依赖管事务；多段独立提交用服务层。
- **`flush` vs `commit`**：前者发 SQL 不提交，后者提交并归还连接。
- **`commit` 后 `refresh`** 是拿到 DB 默认值/触发器结果的固定搭配。
- **并发冲突**：捕获 `IntegrityError` → **先 `rollback`** → 重试（**重新读状态**）→ 上限后抛出。
- **`rollback` 后 Session 可复用**，只是对象过期。
- **`begin_nested()` = SAVEPOINT**，适合「允许部分失败」的批量。
- **长事务三重危害**：锁、VACUUM、连接占用；Web 请求里应毫秒级。
- **`expire_on_commit=False` 不是万能药**，关系懒加载仍会 `DetachedInstanceError`；返回 DTO 才是根治。
- **测试用外层事务回滚**，比 truncate 快得多。
- **与 Prisma 的模型差异**：`PrismaClient` ≈ Engine，Python 的 `Session` 是请求级；双栈事务粒度要对齐。
- **项目范式**：`get_db` 生成器 + 视图内 `commit/refresh`；`append_message` 的冲突重试是并发写的最佳样例。
- **下一步**：关系、级联与查询——`relationship`、N+1 与预加载、聚合与分页。
