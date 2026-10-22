# 04 · Python 对齐与前端会话面板

> 所属：阶段 9 · 会话与记忆
> 本篇覆盖两件事：**A. Python 侧把会话与记忆对齐到 TS**（`passive_deletes=True`、`UNIQUE(conversation_id, seq)` 与 `seq = max + 1`、Pydantic 可选字段的 `null` 语义、`settings.max_history_messages`、async 引擎里的同步 `Session` 边界、两端一致性实测）；**B. 前端会话调试面板**（会话选择器 + 历史气泡 + 流式追加、发送时 body 三件套、以服务端为准、未选会话时省略 `conversationId`、刷新后历史仍在）。
> **本篇首次教学**：`IntegrityError` + 重试的**并发兜底**写法（唯一约束是最后防线，不是可选项） · Pydantic「**缺省不校验、显式 `null` 却报类型错**」的可选字段写法（`str = Field(default=None)`）及其与 TS `ValidateIf` 的对照 · **async 引擎里使用同步 `Session` 的边界**（读写都在开流前/终态帧之前，不在流中间开长事务） · 前端「**`inputs` 给人跑图、`userMessage` 给人看**」的双轨语义 · 前端「**以服务端为准**」的收尾刷新（乐观气泡只用于观感）。
> `relationship()` / `back_populates` / cascade 两层（DB `ON DELETE CASCADE` vs ORM `cascade`、`passive_deletes`）的**首次教学**见 `02-应用管理/04-SQLAlchemy关系建模.md`；`ForeignKey` / `index=True` 见同篇；pydantic-settings 的**首次教学**见 `00-项目初始化/06-FastAPI起步.md`；`Session` / `SessionLocal` 生命周期见 `01-账号与认证/04-SQLAlchemy2.0.md`——以上**直接使用、不重讲**。
> 会话契约与两张表的建模见本阶段 `01-会话契约与数据建模.md`；「先读历史再写 user」的顺序语义、`pool.conversation`、`useHistory` 注入见 `02-历史加载与上下文注入-NestJS.md`；为什么不用 checkpointer 见 `03-checkpointer与自建消息表.md`；分层验收见 `05-验收.md`。
> 前端 SSE 解析 `parseSseStream`、`fetch` + `getReader`、`yieldToPaint` 见 `04-执行引擎/06-前端SSE客户端与运行面板.md`；受控输入与列表渲染见 `02-应用管理/06-前端应用列表页.md`——**本篇不再写第二套解析器，也不再重讲受控组件**。

---

## 1. 本篇目标

做完这一篇，你能：

- 说清 **为什么 `Conversation.messages` 要加 `passive_deletes=True`**：不加的话，SQLAlchemy 在 `db.delete(conversation)` 时会先把子行的 `conversation_id` 置 `NULL`，而该列是 `NOT NULL` → `NotNullViolation` → 500；加了之后删除交给数据库的 `ON DELETE CASCADE`。
- 说清 **`seq` 的并发安全从哪里来**：`seq = max(seq) + 1` 本身是「先读后写」，两个人同时发消息必然读到同一个 `max`；真正兜底的是 `UNIQUE(conversation_id, seq)`——其中一个事务失败，捕获 `IntegrityError` 后回滚重试。
- 说清 **Pydantic 可选字段的两种写法差别**：`conversation_id: str | None = None` 会**接受**显式 `null`；`conversation_id: str = Field(default=None)` 只在**缺省**时跳过校验，显式 `null` 仍按 `str` 校验并失败。后者才是契约要的语义（对齐 TS 的 `ValidateIf`）。
- 说清 **`MAX_HISTORY_MESSAGES` 必须经 `Settings` 读**：pydantic-settings 只把 `.env` 读进配置对象，**不回写进程环境**；直接 `os.environ` 会让 `.env` 里的值静默失效。
- 说清 **async 引擎里的同步 `Session` 为什么没问题**：会话读写发生在「开流前（读历史 + 写 user）」与「终态帧之前（写 assistant）」两段短事务里，中间流式执行期间不开长事务、不共享 `Session` 给别的任务。
- 在前端看懂 **会话选择器 + 历史气泡 + 流式追加**：复用 `sse.ts` 的 `parseSseStream`，只把 `token` 追加到临时助手气泡。
- 说清 **发送 body 为什么是三件套**：`inputs` 给引擎跑图，`userMessage` 给会话存档，`conversationId` 决定这次运行属于哪段记忆。
- 说清 **「以服务端为准」**：运行结束后重新 `GET /conversations/{id}/messages`，而不是把本地拼出来的历史当作真相；预检 400（本轮 user 没落库）也能靠这次刷新把乐观气泡纠正回来。
- 说清 **未选会话时为什么是「省略键」而不是传 `""`**：`JSON.stringify` 会直接丢掉 `undefined` 字段；传空串则会变成一个合法的 `string` 去查会话 → 404。
- 独立完成一次实测：新建会话 → 两轮流式 → 历史 4 条（`seq` 1~4）→ 刷新后仍在 → 删除后列表少一项；`useHistory` 保存后 `GET /apps/{id}/graph` 能读到 `true`；`tsc --noEmit` 通过。

**验收标准（对齐总纲 §6 阶段 9）**

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 删含消息的会话 | `204`；随后 `messages` 计数为 `0`（DB 级联生效） |
| 2 | 并发/顺序 | `messages` 的 `seq` 连续、唯一；唯一索引存在 |
| 3 | 显式 `null` | `conversationId: null` → `400 conversationId must be a string`；**不传**则正常无会话运行 |
| 4 | 配置 | `MAX_HISTORY_MESSAGES` 改值后生效（不是永远 20） |
| 5 | 两端一致 | 事件序列一致、每帧键集合一致、归一后帧一致、消息 `role/content/seq` 一致 |
| 6 | 前端 | 两轮后气泡 4 条；刷新后仍在；未选会话发送成功且不写库 |
| 7 | 类型检查 | `npx tsc --noEmit` 通过（在 `apps/web`） |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| 契约 `0.9.0`：`RunRequest.conversationId?` / `userMessage?`、`ConversationResponse`、`MessageResponse`、`run_started.conversationId?` | 本阶段 `01` |
| Prisma 迁移 `20261022140744_add_conversations`（两张表 + 唯一索引 + 三个外键） | 本阶段 `01` |
| TS 侧：`ConversationsService`、`EngineService.run()` 的读取顺序、`buildInitialMessages` 的 `useHistory` | 本阶段 `02` |
| Python 侧：`Conversation` / `Message` 模型、`conversations/service.py`、`api/conversations.py`、`api/run.py` | 本篇 A |
| 三端 + mock 已启动 | `05-验收.md` §2 |
| 前端画布 / 运行面板已能跑 SSE | 阶段 4 · `06` |

> **迁移所有权不变**：`conversations` / `messages` 的 DDL 由 Prisma 迁移拥有，Python 只做映射与读写（见 `01-账号与认证/04-SQLAlchemy2.0.md`）。本篇不改任何迁移。

---

## 3. 命令逐条

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `pnpm --filter @mini-dify/api-ts db:migrate` | 仓库根 | 确认 `add_conversations` 迁移已应用 | `Already in sync` / 无新迁移 |
| `docker exec -i mini-dify-db psql -U postgres -d minidify -c "\d messages"` | 仓库根 | 看唯一索引是否在 | 出现 `messages_conversation_id_seq_key` |
| `pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000） | `Uvicorn running on http://127.0.0.1:8000` |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001） | `api-ts listening on http://localhost:3001` |
| `pnpm dev:web` | 仓库根 | 起 Next.js（3000） | `Ready in ...` |
| `node tools/mock-llm/server.mjs` | 仓库根 | 起 mock provider（11435） | `mock-llm listening on http://127.0.0.1:11435` |
| `npx tsc --noEmit` | `apps/web` | 前端类型检查 | 无输出、退出码 0 |

---

## 4. A · Python 对齐

### 4.0 这一节改的是哪几个文件

```
apps/api-py/app/
├── models/conversation.py        ← 两张表的映射（passive_deletes）
├── conversations/service.py      ← CRUD / seq 追加 / 历史读取 / assistant 内容规则
├── api/conversations.py          ← 5 个会话接口（出参与时间格式）
├── api/run.py                    ← 请求体可选字段 + 读历史/写 user 的顺序
├── engine/engine.py              ← run_started.conversationId、run_finished 前写 assistant
└── config.py                     ← max_history_messages
```

### 4.1 模型：`passive_deletes=True` 让 DB 级联真的生效（复用）

**完整文件路径：`apps/api-py/app/models/conversation.py`（节选）**

```python
class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    app_id: Mapped[str] = mapped_column(
        String, ForeignKey("apps.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=func.now(), onupdate=func.now()
    )

    app: Mapped["App"] = relationship("App", back_populates="conversations")
    owner: Mapped["User"] = relationship("User", back_populates="conversations")
    # `passive_deletes=True`：删除会话时交给数据库的 ON DELETE CASCADE 删消息，
    # 避免 SQLAlchemy 先把 messages.conversation_id 置 NULL（该列 NOT NULL）。
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="conversation", passive_deletes=True
    )
```

**这段在干什么**：

- `ForeignKey("apps.id", ondelete="CASCADE")` 是**数据库层**的规则：删 `apps` 行时，Postgres 自己删掉关联的 `conversations`。
- `messages` 的外键同理：`ForeignKey("conversations.id", ondelete="CASCADE")`，删会话时 DB 会删消息。
- `passive_deletes=True` 是**ORM 层**的开关：告诉 SQLAlchemy「删除父行时**不要**主动处理子集合，数据库会管」。
- `Mapped[list["Message"]]` 用字符串做前向引用，避免 `Message` 定义在 `Conversation` 之后导致循环导入（`02-应用管理/04` 已讲）。

**与 TS 对照**

|  | TS / Prisma | Python / SQLAlchemy |
| --- | --- | --- |
| 级联来源 | `schema.prisma` 的 `onDelete: Cascade` → 迁移生成 `ON DELETE CASCADE` | 同一份迁移（DDL 归 Prisma 所有），Python 的 `ForeignKey(ondelete="CASCADE")` 只是**读出**这个事实 |
| 删父行时 ORM 行为 | Prisma 把删除交给 DB（不预加载子集合） | 默认**会**先 `SELECT` 子行并把外键置 `NULL`；`passive_deletes=True` 才改成「不碰」 |
| 结果 | `DELETE /conversations/{id}` → `204` | 不加 `passive_deletes` → `NotNullViolation` → `500` |

**写错会怎样（阶段 7 已经踩过一次）**

不加 `passive_deletes=True` 时，`db.delete(conversation)` 会在 flush 阶段发出：

```sql
UPDATE messages SET conversation_id = NULL WHERE conversation_id = '...';
```

`messages.conversation_id` 是 `NOT NULL` → Postgres 抛 `NotNullViolation` → FastAPI 未捕获 → 500。现象是「**TS 删得掉、Python 删不掉**」，与阶段 7 的「删除含文档的知识库返回 500」完全同源（见 `INDEX.md` 第五节的遗留记录）。当时的修法就是给三处关系补 `passive_deletes=True`，本篇是同一模式在 `conversations` 上的复用。

> 注意：`passive_deletes=True` **不会**替你建外键。它只是「不插手」；真正删子行的是迁移里那条 `ON DELETE CASCADE`。两者缺一不可——少了 DB 级联，父行删了子行会变成孤儿；少了 `passive_deletes`，ORM 先报 NOT NULL。

**实测**：删除一个含 4 条消息的会话 → `204`，随后 `SELECT count(*) FROM messages WHERE conversation_id = ...` 为 `0`。

### 4.2 `UNIQUE(conversation_id, seq)` 与 `seq = max + 1`：并发靠唯一约束兜底（首次）

**先看数据库事实（迁移生成的 DDL）**

```sql
CREATE UNIQUE INDEX "messages_conversation_id_seq_key" ON "messages"("conversation_id", "seq");
```

**完整文件路径：`apps/api-py/app/conversations/service.py`（节选）**

```python
APPEND_MESSAGE_RETRIES = 3


def append_message(
    db: Session,
    conversation_id: str,
    role: str,
    content: str,
    run_id: str | None = None,
) -> None:
    """追加一条消息：`seq = max(seq) + 1`（唯一约束兜底并发冲突，冲突时重试）。"""
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

**这段在干什么**：

- `select(func.max(Message.seq))` 取当前会话的最大序号；没有消息时是 `NULL`，`(last_seq or 0) + 1` 得到 `1`。
- `db.add` 只是把 `Message` 放进 Session 的待写集合；**真正的 `INSERT` 在 `db.commit()`**。
- 同一次事务里顺手 `UPDATE conversations SET updated_at = now()`：会话列表按 `updated_at` 倒序，追加消息后会话要「浮到最前」。
- `except IntegrityError` 捕获的是**唯一索引冲突**（Postgres `23505`）；`db.rollback()` 丢弃本次失败的事务，循环重读 `max(seq)` 再试。
- 重试 3 次是「几乎不可能连续撞 3 次」的经验值，不是正确性来源——正确性来自**唯一约束本身**。

**为什么必须这样写**（并发时序）

```
时间   请求 A                         请求 B
────────────────────────────────────────────────────────────
t1     SELECT max(seq) → 0
t2                                    SELECT max(seq) → 0
t3     INSERT seq=1（未提交）
t4                                    INSERT seq=1（未提交）
t5     COMMIT ✅
t6                                    COMMIT ❌ 唯一冲突（23505）
t7                                    ROLLBACK → 重新读 max → 1 → INSERT seq=2 ✅
```

- 两条请求在 `t1/t2` 读到同一个 `max`，**各自算出的 `seq` 必然相同**；这不是「偶发 bug」，而是「先读后写」的必然结果。
- 唯一索引把「第二个写入」变成一次**可检测的失败**，而不是两条 `seq=1` 的脏数据。
- 没有唯一索引时，两条消息都能提交；之后按 `seq` 排序会得到不确定的顺序（数据库对相同排序键没有稳定顺序保证）——历史从此错乱，而且**不报错**。

**与 TS 对照**

|  | TS / Prisma | Python / SQLAlchemy |
| --- | --- | --- |
| 写法 | `$transaction` 内 `findFirst(orderBy seq desc)` + `create` | `select(max)` + `add` + `commit` |
| 冲突检测 | `catch` 里判断 `error.code === 'P2002'` | `except IntegrityError` |
| 重试次数 | `APPEND_MESSAGE_RETRIES = 3` | 同名常量、同值 3 |
| 为什么 `$transaction` 不够 | 默认隔离级别是 Read Committed，两个事务仍能读到同一个 `max` | 同理，普通 `SELECT` 不加锁 |

> **不要**把「重试」当成主要手段。真正的正确性来自 `UNIQUE(conversation_id, seq)`：它保证「同一个会话里不可能有两条相同序号的已提交消息」。重试只是把这次冲突**消化掉**，让用户无感。

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 没有唯一约束 | 并发时出现重复 `seq`；历史顺序随机；**没有任何错误** |
| 捕获了 `IntegrityError` 但不 `rollback()` | Session 进入「失败事务」状态，下一次查询报 `PendingRollbackError` |
| 重试时不重新读 `max` | 用旧值再插一次，必定再次冲突 |
| 把 `updatedAt` 的 `UPDATE` 放在 `commit` 之后单独提交 | 消息写入成功但会话列表排序不刷新（两次提交还可能部分成功） |

### 4.3 Pydantic 的可选字段：缺省 ≠ 显式 `null`（首次）

**完整文件路径：`apps/api-py/app/api/run.py`（节选）**

```python
class RunRequest(BaseModel):
    """对应契约 `RunRequest`。

    `conversationId` / `userMessage` 用「注解为 str、默认 None」的写法：缺省时不校验，
    但**显式传 null 视为类型错误**（与 api-ts 的 `ValidateIf` 行为一致）。
    """

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any]
    conversationId: str = Field(default=None)  # type: ignore[assignment]
    userMessage: str = Field(default=None, max_length=4000)  # type: ignore[assignment]
```

**这段在干什么**：

- 字段**注解**是 `str`，决定「有值时按字符串校验」。
- **默认值**是 `None`，决定「键缺失时直接用 `None`，不跑校验」。
- 这两件事在 Pydantic v2 里是**分开的**：缺省值不参与校验，显式传入的值一定参与校验。
- 所以：**不传** `conversationId` → `None`（无会话运行）；**传 `null`** → 按 `str` 校验 → 失败 → 400。
- `# type: ignore[assignment]` 是给静态类型检查器看的：注解 `str` 却赋 `None`，mypy/pyright 会告警；这是**故意的**运行期语义，用注释说明。

**三种写法对比（关键表）**

| 写法 | 不传 | 传 `null` | 传 `"abc"` | 是否符合契约 |
| --- | --- | --- | --- | --- |
| `conversationId: str \| None = None` | `None` | `None` ✅ 通过 | `"abc"` | ❌ 显式 `null` 被当成「没有会话」 |
| `conversationId: str = Field(default=None)` | `None` | **400 类型错误** | `"abc"` | ✅ 本篇采用 |
| `conversationId: str = "abc"` | 默认 `"abc"` | 400 | `"abc"` | ❌ 缺省被强塞一个值 |
| `conversationId: str \| None = Field(default=None)` | `None` | `None` 通过 | `"abc"` | ❌ 同第一行 |

**为什么「显式 `null` 要报错」**

契约里这两个字段是**可选**（optional），不是**可空**（nullable）。两者在 JSON 里长得像，语义完全不同：

- **可选**：这个键**可以不存在**——不存在 = 本次请求「没有这个意图」。
- **可空**：这个键**存在，但值是 `null`**——它表达的是「我知道有这个字段，我给它一个空值」。

对 `conversationId` 来说，「给一个空值」是没有意义的：会话要么有 id，要么这次就不属于任何会话。把它静默当成「没有会话」会让调用方**以为自己在写历史，实际没写**——这种错误比 400 更难查。

**与 TS 对照**

```ts
// apps/api-ts/src/engine/dto/run.dto.ts（节选）
@ValidateIf((_dto, value) => value !== undefined)
@IsString()
conversationId?: string

@ValidateIf((_dto, value) => value !== undefined)
@IsString()
@MaxLength(4000)
userMessage?: string
```

- `ValidateIf((_, value) => value !== undefined)`：只有**键存在且不是 `undefined`** 才执行后续校验。
- `null !== undefined` 为真 → `@IsString()` 对 `null` 失败 → 400。
- Python 的 `str = Field(default=None)` 与它是**同一语义的两种写法**：`str` 注解 = `@IsString()`，`default=None` = 「缺失时跳过校验」。

**实测（两端逐字节相同）**

```bash
curl -s -X POST http://127.0.0.1:8000/apps/$APP_ID/run \
  -H "Authorization: Bearer $TS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"inputs":{},"conversationId":null}'
```

```json
{"statusCode":400,"message":"conversationId must be a string","error":"Bad Request"}
```

把端口换成 `3001`，响应体完全相同。

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 用 `str \| None = None` | 显式 `null` 被当成无会话：**200 正常跑完，但一条消息都没写** |
| 用 `Field(...)`（必填） | 无会话运行直接 422/400，阶段 4~8 的所有 `POST /run` 调用全部失效 |
| 只写 `str = None`（没 `Field`） | Pydantic 会把 `None` 当默认值但类型注解仍是 `str`；行为与 `Field(default=None)` 接近，但 `max_length` 等约束需要 `Field` 才能声明 |
| 忘了 `# type: ignore` | `mypy` / IDE 报警；运行期行为不变 |

> `userMessage` 另有一层 `max_length=4000`：**缺省时不校验长度**（默认 `None`），**传了字符串就校验**。这与 TS 的 `@MaxLength(4000)` 在同一位置生效，超长文案由 `error-messages.md` 的通用校验映射产出。

### 4.4 `settings.max_history_messages`：读配置要走 `Settings`（复用）

**完整文件路径：`apps/api-py/app/config.py`（节选）**

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")

    # 历史消息条数上限（阶段 9）：读同一个 MAX_HISTORY_MESSAGES，默认 20
    max_history_messages: int = 20
```

**完整文件路径：`apps/api-py/app/conversations/service.py`（节选）**

```python
DEFAULT_MAX_HISTORY_MESSAGES = 20


def max_history_messages() -> int:
    """历史消息条数上限（经 `Settings` 读 `MAX_HISTORY_MESSAGES`，默认 20）。

    与 TS 的 `maxHistoryMessages()` 一致：非正整数回退到默认值。
    """
    value = settings.max_history_messages
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else (
        DEFAULT_MAX_HISTORY_MESSAGES
    )
```

**这段在干什么**：

- `SettingsConfigDict(env_file=...)` 在**模块导入时**把 `apps/api-py/.env` 读进 `settings` 对象；字段名大小写不敏感，`max_history_messages` ↔ `MAX_HISTORY_MESSAGES`。
- `max_history_messages()` 是**运行期读取**（函数调用时才看 `settings`），不是常量；改 `.env` 重启后立即生效。
- `isinstance(value, int) and not isinstance(value, bool)`：Python 里 `True` 是 `int` 的子类，必须排除；`value > 0` 挡住 `0` 与负数。
- `0` / 负数一律回退 `20`，与 TS 的 `Number.isInteger(raw) && raw > 0` 对齐；若 `.env` 写的是非数字，pydantic-settings 会在**启动期**直接抛校验错误（这一点比 TS 更严格，属预期）。

**与 TS 对照**

```ts
// apps/api-ts/src/conversations/conversations.service.ts
export function maxHistoryMessages(): number {
  const raw = Number(process.env.MAX_HISTORY_MESSAGES ?? DEFAULT_MAX_HISTORY_MESSAGES)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_HISTORY_MESSAGES
}
```

|  | TS | Python |
| --- | --- | --- |
| 读取来源 | `process.env`（`dotenv/config` 把 `.env` **写进** `process.env`） | `settings`（pydantic-settings **不写** `os.environ`） |
| 非法值 | 非整数或 `<= 0` → 20 | 同 |
| 生效时机 | 进程启动 | 进程启动 |

**为什么绝不能写 `os.environ["MAX_HISTORY_MESSAGES"]`**

这是阶段 6 `MAX_TOOL_ROUNDS` 的同一个坑（见 `INDEX.md` 第五节）：**pydantic-settings 只把 `.env` 的值读进 `Settings`，不会回写到进程环境**。所以 `.env` 里写了 `MAX_HISTORY_MESSAGES=8`，`os.environ` 里仍然是空的——代码会静默地用默认 20。

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| `os.environ.get("MAX_HISTORY_MESSAGES", "20")` | `.env` 的值**永远读不到**；两端裁剪窗口不同 → 同一会话两端的 `pool.conversation.messages` 不同 → 帧分叉 |
| 用模块级常量 `MAX = 20` | 配置项形同虚设 |
| 不校验 `> 0` | `MAX_HISTORY_MESSAGES=0` 时历史恒为空（`LIMIT 0`），模型「失忆」但不报错 |
| Python 用 `int(os.environ[...])` | `.env` 值读不到；若系统环境设了非数字还会在导入期崩溃 |

> **验证方式**：把 `apps/api-py/.env` 改成 `MAX_HISTORY_MESSAGES=2`，重启后 `python -c "from app.conversations.service import max_history_messages; print(max_history_messages())"`（在 `apps/api-py` 下）输出 `2`；改回 `20` 后再看输出 `20`。

### 4.5 async 引擎里的同步 `Session`：边界在哪（首次）

**完整文件路径：`apps/api-py/app/api/run.py`（节选）**

```python
@router.post("/{id}/run", operation_id="runApp")
async def run_app(
    id: str,
    body: RunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    app = _find_owned(db, current_user.id, id)
    # 阶段 9 顺序：应用归属 → 会话归属 → 图预检 → 读历史 → 写本轮用户消息 → 执行。
    if body.conversationId is not None:
        assert_owned_by_app(db, current_user.id, app.id, body.conversationId)
    if app.graph_json is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Graph is empty")
    graph = app.graph_json
    errors = [
        *validate_graph(graph),
        *validate_node_data(graph, body.conversationId is not None),
        *await validate_knowledge_nodes(db, current_user.id, graph),
    ]
    if errors:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors))

    conversation: dict[str, Any] | None = None
    if body.conversationId is not None:
        # 顺序很重要：**先读历史、再写本轮用户消息**。
        # 反过来的话，本轮 user 消息会混进历史，模型会看到「两条相同的用户话」。
        history = load_history(db, body.conversationId)
        if body.userMessage is not None and body.userMessage != "":
            try:
                append_message(db, body.conversationId, "user", body.userMessage)
            except Exception:  # noqa: BLE001 - 写入失败归一为契约文案（§9）
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="failed to persist conversation message",
                ) from None
        conversation = build_conversation_context(body.conversationId, history)
    return StreamingResponse(
        run_stream(app.id, graph, body.inputs, db, conversation),
        media_type="text/event-stream",
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
    )
```

**这段在干什么（边界视角）**：

1. **开流前**（`return StreamingResponse` 之前）做完全部同步 DB 工作：应用归属 → 会话归属 → 图预检 → 读历史 → 写 user。此时还没有任何 SSE 帧发出，所以任何一步失败都能返回**普通 JSON**（400/404），不会污染流。
2. `run_stream(...)` 只是把异步生成器交给 Starlette；`db` 作为参数传下去，给「`run_finished` **之前**写 assistant」用。
3. 流式执行期间（`_run_graph` 的 `await compiled.ainvoke(...)`）**不碰** `db`；只有执行结束后、终态帧之前 `append_message(...)` 一次短写。
4. 因此同一个 `Session` 的生命周期是「请求作用域」，但**真正占用连接的时间只有两小段**；中间的长耗时是 LLM/工具/检索的 I/O，不持有事务。

**完整文件路径：`apps/api-py/app/engine/engine.py`（节选）**

```python
async def _run_graph(...):
    ...
    try:
        ...
        await compiled.ainvoke(...)
        elapsed_ms = int((time.time() - started_at) * 1000)
        # 阶段 9：助手消息**必须在 `run_finished` 之前写入**。
        # 若放在终态帧之后，一旦写入失败就会追加一帧 `run_failed` ——
        # 一次运行出现两个终态事件，违反「终态只出现一次」的协议。
        # 放在之前：写入失败直接抛错，由外层 except 统一发唯一一帧 `run_failed`。
        if conversation is not None:
            try:
                append_message(
                    db,
                    conversation["id"],
                    "assistant",
                    assistant_content(context["last_outputs"]),
                    run_id,
                )
            except Exception as error:  # noqa: BLE001 - 写入失败归一为契约文案
                raise RunError("failed to persist conversation message") from error
        await queue.put(run_finished(run_id, context["last_outputs"], elapsed_ms))
    except Exception as error:  # noqa: BLE001 - 任何执行期错误都归一为 run_failed
        # `run_failed` 时**不**写助手消息
        await queue.put(run_failed(run_id, context["failed_node_id"], str(error)))
    finally:
        await queue.put(None)
```

**这段在干什么**：

- `append_message` 是**同步**函数，在 `async def` 里直接调用会短暂阻塞事件循环。这是**有意的取舍**：一次 `INSERT` + 一次 `UPDATE` 是毫秒级，而流已接近结束，没有别的并发事务需要这一小段 CPU。
- 写入放在 `run_finished` **之前**：先把消息落库，再宣布运行成功。若落库失败，直接 `raise RunError(...)`，由外层 `except` 发出**唯一一帧** `run_failed`——不会出现「先成功、后失败」两个终态。
- `except` 分支在**执行失败时完全不写 assistant**：失败的回答不该污染下一轮历史（否则模型会把「报错文本」当成自己说过的话）。

**边界表（必须知道）**

| 阶段 | 是否持有 DB 事务 | 典型耗时 | 失败通道 |
| --- | --- | --- | --- |
| 归属 / 预检 / 读历史 / 写 user | 是（短事务） | 毫秒 | 普通 JSON 400 / 404 |
| 图执行（LLM / 工具 / 检索） | **否** | 秒~分钟 | 流内 `run_failed` |
| 写 assistant | 是（短事务） | 毫秒 | 流内唯一一帧 `run_failed`（`run_finished` 尚未发出） |

**为什么不用 async SQLAlchemy**

- 需要换 `create_async_engine` / `AsyncSession`，并把整条依赖链（`get_db`、服务层、引擎）都改成 `await`；这是一个横跨全项目的重构，收益仅是「短事务不阻塞」。
- 当前写法与阶段 1~8 的同步 Session 完全一致，**迁移面为零**；真正需要避免的是「在流中间每个 token 查一次库」，而本设计根本没有这样的调用。

**与 TS 对照**

|  | TS / NestJS | Python / FastAPI |
| --- | --- | --- |
| DB 客户端 | Prisma Client（全异步，`await`） | SQLAlchemy `Session`（全同步） |
| 开流前的读写 | `await this.conversations.loadHistory(...)` / `await appendMessage(...)` | `load_history(db, ...)` / `append_message(db, ...)` |
| 是否阻塞事件循环 | 不阻塞（I/O 交给驱动/线程池） | **短暂阻塞**（毫秒级短事务） |
| 流中间是否碰库 | 不碰 | 不碰 |
| 终态帧前写 assistant | `await appendMessage(..., 'assistant', ...)` | 同步 `append_message(...)` |
| 失败通道 | 写 user 失败 → 400；写 assistant 失败 → 流内**唯一一帧** `run_failed` | 同 |

> 两条线**语义完全一致**，只是「等待」的写法不同：TS 显式 `await`，Python 靠同步调用自然等待。**顺序**（读历史 → 写 user → 执行 → 写 assistant → `run_finished`）才是契约，与是否 async 无关；其中「写 assistant 先于终态帧」是**终态唯一**的直接保证。

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 在 `run_stream` 里边流边 `append_message`（每帧写一次） | 事务长时间打开、连接被占；并发几路就耗尽连接池 |
| 把 `db` 传给 `asyncio.create_task` 并在另一个任务里用 | Session 非线程安全、也不支持并发使用；报 `This session is provisioning a new connection` 或数据错乱 |
| 在 `yield` 之后才做归属校验 | 已经发出 `200 text/event-stream`，错误只能变成流内 `run_failed`，契约要求的是 404 |
| 写 assistant 放在 `run_finished` 之后 | 落库失败时只能追加第二帧 `run_failed`：一次运行出现两个终态，违反「终态只出现一次」 |

### 4.6 两端一致性：会话记忆也会影响帧

阶段 4~8 的一致性只比较「同一张图 + 同一组 `inputs`」；阶段 9 多了一个**隐式输入**：`pool.conversation`。两端只要历史读取的**条数、顺序、角色、内容**有一处不同，`useHistory` 的 `llm` 节点就会发出不同的 prompt，token 与 `usage` 随即分叉。

**实测（本篇负责的部分）**

```
frames equal after normalize = True
messages role/content/seq equal = True
```

- `frames equal after normalize`：把 `runId` / `elapsedMs` / `conversationId` / 时间戳抹掉后，两端的 SSE 帧逐字节相同。
- `messages role/content/seq equal`：两端各自跑完两轮后，`GET /conversations/{id}/messages` 的 `role` / `content` / `seq` 三元组完全相同（`id` 与 `createdAt` 天然不同，不参与比较）。

**让它们相等的四个前提**（对应本篇 A 的四节）：

1. 历史条数上限一致（`MAX_HISTORY_MESSAGES`，§4.4）。
2. 顺序一致（`ORDER BY seq`，§4.2 的 `seq` 连续唯一）。
3. `pool.conversation` 形状一致（`messages` 只有 `role` / `content`，`history` 用 `\n` 连接）。
4. assistant 内容规则一致（单键取字符串值，否则紧凑 JSON）。

> 只要有一处不同，**不会报错**，只会让 `echo:` 的输入或 `usage.promptTokens` 变掉——这正是「记忆让一致性问题变隐蔽」的原因。验收见 `05-验收.md` L6。

---

## 5. B · 前端会话面板

### 5.1 数据形状与两个加载函数

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
/** `GET /apps/{id}/conversations` 的列表项（按 `updatedAt` 倒序）。 */
type ConversationSummary = {
  id: string
  appId: string
  title: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

/** 会话消息（按 `seq` 升序）。 */
type ConversationMessage = {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  seq: number
  runId: string | null
  createdAt: string
}
```

```tsx
/** 拉取当前应用的会话列表（按 updatedAt 倒序，由后端保证）。 */
const loadConversations = useCallback(
  async (token: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/apps/${appId}/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (!res.ok) return
    const body = (await res.json()) as { items?: ConversationSummary[] }
    setConversations(Array.isArray(body.items) ? body.items : [])
  },
  [appId, router],
)

/** 拉取某会话的历史消息（按 seq 升序，渲染前再排一次序兜底）。 */
const loadMessages = useCallback(async (token: string, conversationId: string): Promise<void> => {
  setMessagesLoading(true)
  try {
    const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (res.status === 404) {
      // 会话已被删除：清空当前选择，回到「未选会话」状态。
      setMessages([])
      setSelectedConversationId('')
      return
    }
    if (!res.ok) return
    const body = (await res.json()) as { items?: ConversationMessage[] }
    const items = Array.isArray(body.items) ? body.items : []
    setMessages([...items].sort((a, b) => a.seq - b.seq))
  } catch {
    // 静默降级：拉取失败时保留已有消息，下一次运行结束会再拉。
  } finally {
    setMessagesLoading(false)
  }
}, [router])
```

**这段在干什么**：

- 两个函数都带 `Authorization`（与阶段 2 起的 `fetch` 一致），401 统一回登录页。
- `Array.isArray(body.items) ? body.items : []`：服务端形状不可信时退化为空列表，面板不崩。
- `loadMessages` 的 **404 分支**很关键：会话可能被另一个标签页删掉；此时清空选择、回到「未选会话」，而不是停在一条不存在的会话上反复 404。
- `[...items].sort((a, b) => a.seq - b.seq)`：后端已经按 `seq` 升序返回，前端**再排一次**只是兜底。`sort` 不保证稳定，但 `seq` 唯一（§4.2），不存在并列。
- 两个 `useEffect` 分别负责「进页面拉列表」与「切换会话拉消息」：

```tsx
// 进入页面时拉取会话列表（需 Bearer）；失败静默降级。
useEffect(() => {
  const token = localStorage.getItem('accessToken')
  if (token === null) return
  void loadConversations(token).catch(() => {
    // 静默降级：会话接口不可用时仍可使用「无会话运行」。
  })
}, [loadConversations])

// 切换会话时拉取该会话的消息。
useEffect(() => {
  const token = localStorage.getItem('accessToken')
  if (token === null || selectedConversationId === '') return
  void loadMessages(token, selectedConversationId)
}, [selectedConversationId, loadMessages])
```

**为什么用 `selectedConversationId === ''` 表示「未选」**

- 受控 `<select>` 的 `value` 必须是字符串；`''` 是唯一的「空选项」值。
- 但发请求时**不能**把 `''` 当成会话 id：它的语义是「这次不选会话」，对应 body 里的**省略键**（§5.4）。
- 于是「UI 状态用 `''`」与「协议用 `undefined`」之间需要一个显式转换，这个转换放在 `handleSend` 里。

### 5.2 会话选择器与历史气泡

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
<div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, display: 'grid', gap: 8 }}>
  <div style={{ fontWeight: 600 }}>会话调试（多轮）</div>
  <select
    value={selectedConversationId}
    onChange={(e) => {
      setSelectedConversationId(e.target.value)
      setMessages([])
      setPendingAssistant(null)
    }}
    disabled={running}
    style={{ width: '100%' }}
  >
    <option value="">（未选会话 · 不保存历史）</option>
    {conversations.map((conversation) => (
      <option key={conversation.id} value={conversation.id}>
        {(conversation.title === null || conversation.title === ''
          ? `会话 ${conversation.id.slice(0, 8)}`
          : conversation.title) + `（${conversation.messageCount} 条）`}
      </option>
    ))}
  </select>
  ...
  {selectedConversationId === '' && (
    <p style={{ fontSize: 12, color: '#b26a00', margin: 0 }}>
      未选会话：本次运行不会保存历史
    </p>
  )}
```

**这段在干什么**：

- `<select value={...} onChange={...}>` 是**受控组件**：显示什么完全由 `selectedConversationId` 决定（首次教学见 `02-应用管理/06-前端应用列表页.md`）。
- 切换会话时**立刻清空** `messages` 与 `pendingAssistant`：否则旧会话的气泡会短暂显示在新会话下面，看起来像「串台」。
- `disabled={running}`：运行中不允许切换，避免「请求发到 A 会话、界面已切到 B」。
- 标题为空时回退成 `会话 <id 前 8 位>`：`title` 可空，但下拉项必须有可读文字。
- `（N 条）` 来自 `messageCount`，是后端 `_count.messages`；它让用户不点开就知道哪段会话有内容。
- 未选会话时有一条**常驻提示**，把「不保存」这件事写在界面上，避免用户以为发出去的消息丢了。

**历史气泡与流式助手气泡**

```tsx
{messages.map((message) => {
  const isUser = message.role === 'user'
  return (
    <div
      key={message.id}
      style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 6 }}
    >
      <div style={{ maxWidth: '85%', /* 蓝底=user，灰底=assistant */ }}>
        <div>{message.content}</div>
        <div style={{ fontSize: 10, color: '#888' }}>
          {message.role} · {formatMessageTime(message.createdAt)}
        </div>
      </div>
    </div>
  )
})}

{pendingAssistant !== null && (
  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 6 }}>
    <div style={{ /* 虚线边框：表示「尚未落库」 */ }}>
      <div>{pendingAssistant === '' ? '…' : pendingAssistant}</div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>
        assistant · 流式{selectedConversationId === '' ? '（未保存）' : ''}
      </div>
    </div>
  </div>
)}
```

**这段在干什么**：

- `messages` 是**服务端事实**：只由 `loadMessages` 写入（外加发送时的一条乐观 user 气泡）。
- `pendingAssistant` 是**本次运行的临时文本**：`token` 到达时不断追加，运行结束后被置 `null`，再由重新拉取的 `messages` 取代。
- 两者视觉上区分：历史气泡是实线、临时气泡是**虚线**；未选会话时还会标「（未保存）」。
- `key={message.id}`：服务端消息用数据库 id；乐观气泡用 `local-${Date.now()}`，不会与真实 id 冲突。

**流式增量只写一处**

```tsx
if (frame.event === 'token') {
  const parsed = JSON.parse(frame.data) as { text?: string }
  if (typeof parsed.text === 'string') {
    setLiveText((prev) => prev + parsed.text)
    if (appendBubble) setPendingAssistant((prev) => (prev ?? '') + parsed.text)
  }
}
```

**这段在干什么**：

- `liveText` 是「调试运行」区域的统一流式文本（阶段 4 起就有）。
- `pendingAssistant` 是**会话面板专属**的气泡文本；`appendBubble` 为 `true` 时两者同时追加。
- `parseSseStream` 来自 `sse.ts`（阶段 4 · `06` 已实现）：**本篇没有第二套 SSE 解析**，只多消费了一个 `conversationId` 相关的收尾逻辑。

> **不要**为了「会话面板」再写一个 `getReader` + `TextDecoder` 的循环。两套解析会在分帧边界（尤其是跨 chunk 的 `\r\n\r\n`）产生不同结果，表现为「调试区正常、会话区少一段」。

### 5.3 发送时的 body 三件套：`conversationId` / `userMessage` / `inputs`（首次）

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
async function executeRun(
  token: string,
  inputs: Record<string, unknown>,
  options: { conversationId?: string; userMessage?: string },
  appendBubble: boolean,
): Promise<void> {
  ...
  try {
    const body: Record<string, unknown> = { inputs }
    if (options.conversationId !== undefined) {
      body.conversationId = options.conversationId
      if (options.userMessage !== undefined) body.userMessage = options.userMessage
    }
    const res = await fetch(`${API_BASE}/apps/${appId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
```

```tsx
async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault()
  const text = chatInput.trim()
  if (text === '' || running) return
  const token = localStorage.getItem('accessToken')
  if (token === null) {
    router.replace('/login')
    return
  }
  const inputs = collectRunInputs()
  if (startInputs.length === 1) {
    inputs[startInputs[0].name] = text
  }
  const conversationId = selectedConversationId === '' ? undefined : selectedConversationId
  ...
  await executeRun(
    token,
    inputs,
    { conversationId, userMessage: conversationId === undefined ? undefined : text },
    true,
  )
}
```

**这三个字段各自回答什么**

| 字段 | 回答的问题 | 谁消费 | 缺失时 |
| --- | --- | --- | --- |
| `inputs` | **图怎么跑**：`start` 声明的变量取值 | 引擎的 `pool.inputs` | 必填（缺了 `start` 变量会按空串/默认处理，见阶段 4） |
| `userMessage` | **这段对话该记成什么**：用户说了什么 | 会话表 `messages.role='user'` | 可选：不传就只跑图、不记 user 消息 |
| `conversationId` | **这段记忆属于哪条会话** | 归属校验 + 历史读取 + 保存 | 可选：不传 = 无状态运行，不读也不写历史 |

**为什么 `inputs` 与 `userMessage` 要分开**

假设图只有一个输入 `topic`，两者看起来可以合并；但只要出现下面任一情况，合并就会出错：

1. **多输入图**：`start` 声明了 `topic` 与 `style` 两个变量，聊天框里用户只打了「用更正式的语气」。这时 `userMessage` 是「用更正式的语气」，而 `inputs.topic` 必须仍是表单里填的主题。合并会覆盖 `topic`。
2. **输入是结构化值**：`inputs.items = ["A","B"]`，聊天框里的文字只是给人看的说明。`inputs` 要保留数组，`userMessage` 要保留原始文本。
3. **历史要保真**：下一轮模型读到的 user 消息应该是**用户真正说的话**，而不是「模板渲染后的 prompt」或「JSON 序列化后的输入」。如果存成 `topic=…&style=…`，模型会学到一个奇怪的对话格式。

所以本项目约定：**`inputs` 负责引擎，`userMessage` 负责记忆**。两者可以相同（单输入时 `handleSend` 会把 text 写进唯一输入），也可以不同（多输入时 `userMessage` 只取聊天框文本）。

**单输入时的特殊处理**

```tsx
const inputs = collectRunInputs()
if (startInputs.length === 1) {
  inputs[startInputs[0].name] = text
}
```

**这段在干什么**：

- `collectRunInputs()` 先取「运行输入」表单里已填的值。
- 如果 `start` **只有一个**输入变量，就把聊天框文本写进它——这样用户不用在上方表单里再填一遍，直接在聊天框说话就能跑。
- **多个**输入变量时**不覆盖**：聊天文本只作为 `userMessage` 存档，`inputs` 保持表单里的值。这是「不猜用户意图」的保守选择。

> 注意这里和「调试运行」按钮的区别：`handleRun` 用 `executeRun(token, collectRunInputs(), {}, false)`——**完全不传** `conversationId`，所以即使下拉框选着某个会话，「运行」按钮也不会写历史。只有「发送」按钮属于会话。

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 用 `userMessage` 覆盖 `inputs` | 多输入图里第二个变量被聊天文本冲掉，运行结果不对 |
| 把渲染后的 `llm.prompt` 存成 user 消息 | 历史里出现 `Q: hello` 这种模板，而不是用户原话；下一轮模型把模板当用户输入 |
| 只传 `conversationId` 不传 `userMessage` | 历史里只有 assistant、没有问题；第二轮模型看到「自己连续说了两遍」 |
| 多输入时也强行 `inputs[first] = text` | 用户填的主题被聊天文本覆盖，且没有任何提示 |

### 5.4 「以服务端为准」：运行结束后重新拉消息（首次）

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
} finally {
  if (options.conversationId !== undefined) {
    // 以服务端为准：预检失败（本轮用户消息未落库）也会在这里把乐观气泡纠正回来。
    await Promise.all([
      loadMessages(token, options.conversationId),
      loadConversations(token).catch(() => {
        // 列表刷新失败不影响当前会话内容。
      }),
    ])
  }
  if (appendBubble) setPendingAssistant(null)
  setRunning(false)
}
```

**这段在干什么**：

- 运行结束后（**无论成功、失败、异常**，因为放在 `finally`），只要这次带会话，就重新拉：
  - 该会话的全部消息（`loadMessages`）；
  - 会话列表（`loadConversations`，为了刷新 `messageCount` 与 `updatedAt` 排序）。
- `Promise.all`：两个请求并行，不增加用户等待。
- `loadMessages` **不**加 `.catch()`：它在内部已经 `try/catch` 并静默降级，失败时保留已有消息。
- `loadConversations` 加 `.catch()`：列表刷新失败不影响当前会话内容。
- `setPendingAssistant(null)` 放在 `loadMessages` 之后：先让真实消息替换进 `messages`，再移除临时气泡，避免出现「两份 assistant」同时消失/闪现的中间态。

**为什么不能「本地拼」**

运行前 `handleSend` 已经乐观追加了一条 user 气泡：

```tsx
if (conversationId !== undefined) {
  // 乐观追加本轮 user 气泡；运行结束后会用服务端消息整体替换。
  const maxSeq = messages.reduce((max, message) => Math.max(max, message.seq), 0)
  setMessages((prev) => [
    ...prev,
    {
      id: `local-${Date.now()}`,
      conversationId,
      role: 'user',
      content: text,
      seq: maxSeq + 1,
      runId: null,
      createdAt: new Date().toISOString(),
    },
  ])
}
```

**这段在干什么**：让用户点「发送」的瞬间就看到自己的消息，不用等网络往返。但它是**预测**，不是事实：

- 预检失败（图非法 / `useHistory` 缺会话 / 会话归属不符）时，后端在**写 user 之前**就返回 400/404 → 这条消息**根本没进库**。本地拼的 `messages` 会留下一条「幽灵消息」。
- 并发（另一个标签页也在这条会话里发消息）时，服务端的 `seq` 与本地算出的 `maxSeq + 1` 可能不同。
- 后端可能因为写入失败返回 `failed to persist conversation message`，user 消息没落库。

**「以服务端为准」的结果**

```
运行前（乐观）：messages = [真实的 1..2, 本地 3(user)]
运行后（事实）：messages = [真实的 1..2]                 ← 预检失败：幽灵被清掉
              或 messages = [真实的 1..2, 3(user), 4(assistant)]  ← 成功
```

> 这就是「乐观 UI + 服务端回填」的标准写法：**乐观只负责第一帧的观感，真相永远来自下一次 GET**。如果不刷新，用户在预检失败后看到一条「自己发过的消息」，再刷新页面又消失——体验与数据都错。

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 运行结束后只 `setMessages([...messages, 新assistant])` | `id` / `seq` / `createdAt` 全是本地编的；刷新后与服务端不一致；并发下 `seq` 冲突 |
| 把刷新放在 `try` 末尾 | 运行抛异常或 `run_failed` 时不刷新，乐观气泡永远留在界面上 |
| 先 `setPendingAssistant(null)` 再 `loadMessages` | 真实消息到达前有短暂空白；用户以为回答丢了 |
| 刷新时不重新拉列表 | `（N 条）` 与排序停在旧值，切走再回来才更新 |

### 5.5 未选会话：省略 `conversationId`，不是传空串（首次）

```tsx
const conversationId = selectedConversationId === '' ? undefined : selectedConversationId
```

**这段在干什么**：

- `selectedConversationId` 为 `''`（下拉选的是「未选会话」）时，把值转成 `undefined`。
- `executeRun` 里的 `if (options.conversationId !== undefined)` 因而整块跳过：body 里**连这个键都不出现**。
- `JSON.stringify({ inputs, conversationId: undefined })` 的输出是 `{"inputs":...}`——`undefined` 的键会被**丢弃**。

**两种「没有会话」的写法对比**

| 写法 | 实际发出的 JSON | 后端行为 |
| --- | --- | --- |
| `conversationId: undefined`（本篇） | `{"inputs":{...}}` | 跳过会话分支：不校验、不读历史、不写消息，`run_started` 只有 `runId`/`appId` |
| `conversationId: ''` | `{"inputs":{...},"conversationId":""}` | 空串是合法 `string` → 去查 `id=''` → 404 `Conversation not found` |
| `conversationId: null` | `{"inputs":{...},"conversationId":null}` | 400 `conversationId must be a string`（§4.3） |

**为什么「可选字段的语义」值得单列一节**

- **可选** = 这个键可以不存在，代表「本次没有这个意图」。
- 把「没有意图」编码成空串或 `null`，等于把一个**无效值**塞进一个**有效类型**里，让后端不得不去区分「空 id」与「无会话」。这会把语义判断推到每个消费者手里，迟早有人漏判。
- 契约已经把 `conversationId` 声明为可选（`conversationId?: string`），前端最忠实的做法就是**不传**。
- 附带的好处：`run_started` 的键集合在无会话时恰好是 `["runId","appId"]`（契约规定「无会话省略该键」），两端逐字节一致；传空串则会多一个 `conversationId` 键，帧就不一样了。

**实测**：下拉选「（未选会话）」→ 发送 → 运行成功；随后 `GET /apps/{id}/conversations` 的 `items` 数量**保持 0**（没有悄悄建会话）。

### 5.6 刷新后历史仍在：证明真的落库

前端的 `messages` 状态是**内存**；刷新页面会清空。如果刷新后还能看到同样的 4 条气泡，唯一解释是它们来自 `GET /conversations/{id}/messages`。

**实测回放（真实 headless Chrome）**

```
新建会话           → 下拉出现「会话 xxxxxxxx（0 条）」，选中
第一问「hello」    → 发送 → 临时助手气泡逐段出现 → 收尾后 2 条（user 1 / assistant 2）
第二问「again」    → 发送 → 运行前历史含第一轮 → 收尾后 4 条
刷新页面           → 重新选中该会话 → 4 条气泡仍在，顺序 1~4
删除当前会话       → 下拉只剩「（未选会话）」→ options = 1
未选会话发送       → 运行成功，会话数仍为 0
```

接口侧的消息序列：

```
1:user:第一问 | 2:assistant:echo: 第一问 | 3:user:第二问 | 4:assistant:echo: 第二问
```

**这段说明了什么**：

- 刷新是**内存状态的破坏性测试**：任何只存在 React state 里的东西都会消失；能留下的只能来自数据库。
- 第二轮的历史里有第一轮（`1`、`2`），说明 `load_history` 在写本轮 user **之前**读到了它们（顺序语义见 `02`）。
- 删除后 `options=1`（只有「未选会话」这一项），说明删除不只是清了前端列表，服务端也确实删了。
- 未选会话发送后会话数仍为 0，说明「省略 `conversationId`」这条路径真的没走写库分支。

---

## 6. 实测回放（汇总）

**环境**：headless Chrome + `api-ts`（3001）+ `api-py`（8000）+ Next.js（3000）+ mock-llm（11435）。

| 步骤 | 实测结果 |
| --- | --- |
| 新建会话 → 第一问流式 | 临时气泡逐段增长；结束后 `GET messages` 2 条 |
| 第二问时历史含第一轮 | 第 2 轮 `llm` 收到 3 条消息（历史 2 + 本轮 1） |
| 完整消息序列 | `1:user:第一问 / 2:assistant:echo: 第一问 / 3:user:第二问 / 4:assistant:echo: 第二问` |
| 刷新后重新选中会话 | 4 条历史仍在（来自服务端） |
| 删除当前会话 | 下拉 `options = 1`（只剩「未选会话」） |
| 未选会话发送 | 运行成功；会话数保持 0 |
| `useHistory` 保存 | `GET /apps/{id}/graph` 的 `llm.data.useHistory === true` |
| 两端一致性 | `frames equal after normalize = True`；`messages role/content/seq equal = True` |
| 类型检查 | `apps/web> npx tsc --noEmit` 无输出、退出码 0 |

---

## 7. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | 关系没加 `passive_deletes=True` | 删含消息的会话 500 `NotNullViolation` | ORM 先把 `conversation_id` 置 NULL；加 `passive_deletes=True` 交给 DB 级联（§4.1） |
| 2 | 只加了 `passive_deletes`、迁移里没 `ON DELETE CASCADE` | 删会话后消息成孤儿 | 级联在 DDL 里；Python 只映射（`01`） |
| 3 | 唯一索引被漏建 | 并发时重复 `seq`，历史顺序随机，**不报错** | 确认 `messages_conversation_id_seq_key` 存在（`05` L2） |
| 4 | 捕获 `IntegrityError` 后不 `rollback` | `PendingRollbackError` | 先 `db.rollback()` 再重试（§4.2） |
| 5 | 重试时不重读 `max(seq)` | 反复冲突直到耗尽 3 次 | 每次循环都重新 `SELECT max` |
| 6 | `conversationId: str \| None = None` | 显式 `null` 被静默当作无会话 | 用 `str = Field(default=None)`（§4.3） |
| 7 | 直接读 `os.environ["MAX_HISTORY_MESSAGES"]` | `.env` 不生效，永远 20 | 走 `settings.max_history_messages`（§4.4） |
| 8 | 在流中间查库/写库 | 连接长时间占用、并发即耗尽 | 读写只在开流前/终态帧前（§4.5） |
| 9 | `userMessage` 与 `inputs` 合并 | 多输入图变量被覆盖 / 历史存成模板 | 分开传（§5.3） |
| 10 | 运行后本地拼 assistant | 刷新后消息对不上；并发 `seq` 冲突 | `finally` 里重新 `loadMessages`（§5.4） |
| 11 | 刷新只放在成功分支 | 失败后幽灵 user 气泡常驻 | 放在 `finally` |
| 12 | 未选会话传 `conversationId: ''` | 404 `Conversation not found` | 转成 `undefined` 省略键（§5.5） |
| 13 | 未选会话传 `null` | 400 `conversationId must be a string` | 同上 |
| 14 | 切换会话不清空 `messages` | 旧气泡串到新会话 | `onChange` 里清空 `messages` / `pendingAssistant`（§5.2） |
| 15 | 为会话面板再写一套 SSE 解析 | 两处显示不一致 | 复用 `sse.ts` 的 `parseSseStream` |
| 16 | 改 `useHistory` 后没重新保存图 | 运行时仍是旧图 | 勾选后要点「保存」；`GET graph` 确认 `true` |
| 17 | 把 `run_failed` 当成「消息没写」 | 其实 user 已落库，assistant 没写 | `run_failed` 只在失败时跳过 assistant；user 在开流前已写（`02`） |
| 18 | `title` 传 121 个字符 | 400 `Conversation title is too long` | 上限 120（按字符数，非字节） |

---

## 8. 本篇复盘与知识点

**一句话总结 A**：Python 侧的对齐没有发明新机制，而是把「已学过的 SQLAlchemy 关系」与「pydantic-settings」用到会话上——`passive_deletes=True` 把删除交给 DB 级联，`UNIQUE(conversation_id, seq)` + `IntegrityError` 重试把并发写变成可检测、可恢复的失败，`str = Field(default=None)` 把「缺省」与「显式 `null`」区分开，`settings.max_history_messages` 让裁剪窗口成为配置而不是硬编码；同步 `Session` 之所以能用，是因为会话读写只发生在开流前与终态帧之前的两段短事务里。

**一句话总结 B**：前端会话面板只做三件事——**选会话、显示历史、把流式 token 追加到临时气泡**；发送时把「跑图的输入」与「存档的用户话」分成 `inputs` / `userMessage` 两条轨道；运行结束后用一次服务端重拉覆盖所有本地推测（乐观气泡只是第一帧的观感），未选会话时用「省略键」而不是空串表达「没有这个意图」。

**本篇学到的工程要点**

1. **`passive_deletes=True` 与外键 `ON DELETE CASCADE` 是一对**：前者让 ORM 不插手，后者让 DB 真的删。
2. **`seq` 的唯一约束是并发正确性的来源**：`max + 1` 必然撞车，唯一索引把撞车变成 `IntegrityError`，重试把它消化掉。
3. **可选 ≠ 可空**：`str | None` 接受 `null`，`str = Field(default=None)` 只在缺省时跳过校验；契约要的是后者。
4. **配置读 `Settings`，不读 `os.environ`**：pydantic-settings 不回写进程环境。
5. **同步 `Session` 在 async 引擎里的边界**：短事务放流外，流中间不碰库。
6. **`inputs` 与 `userMessage` 分离**：一个给引擎，一个给记忆；单输入时才可以合并。
7. **以服务端为准**：乐观 UI + `finally` 重拉，是「本地状态不与 DB 分叉」的最省心写法。
8. **省略键是语义**：`undefined` 让 `JSON.stringify` 丢键，`''` / `null` 都会变成后端要额外处理的值。

**遗留 / 后续**

- 前端乐观 user 气泡的 `seq` 是本地算的，刷新前可能与服务端短暂不一致（刷新即纠正）。
- `MAX_HISTORY_MESSAGES` 是「条数」裁剪，不按 token 数；超长消息仍可能撑爆上下文（见 `02` 的窗口讨论）。
- 会话标题目前只能手填或为空，没有「取首条消息自动命名」。
- 没有「重新生成 / 编辑消息」等会话级操作，`seq` 一旦写入不可重排。

---

## 9. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **`passive_deletes=True` 在会话删除上的复用** | 本篇为**应用**；首次教学见 `02-应用管理/04-SQLAlchemy关系建模.md`，阶段 7 的 500 事故见 `INDEX.md` 第五节 |
| **`UNIQUE(conversation_id, seq)` + `seq = max + 1` + `IntegrityError` 重试** | **首次教学于本篇**：先读后写必然撞车；唯一约束兜底、`rollback` 后重读重试；TS 侧对应 `P2002` |
| **Pydantic 可选字段的「缺省 vs 显式 `null`」**（`str = Field(default=None)`） | **首次教学于本篇**：缺省不校验、显式 `null` 报类型错；对照 TS `ValidateIf` |
| **`settings.max_history_messages`（读 `MAX_HISTORY_MESSAGES`）** | 本篇为**应用**；pydantic-settings 首次教学见 `00-项目初始化/06`，`os.environ` 不回写的坑见 `INDEX.md` 第五节 |
| **async 引擎里的同步 `Session` 边界** | **首次教学于本篇**：开流前/终态帧前的短事务；流中间不持有事务、不跨任务共享 Session |
| **前端 `inputs` / `userMessage` 双轨语义** | **首次教学于本篇**：一个给引擎跑图，一个给会话存档；单输入时才可合并 |
| **前端「以服务端为准」的收尾刷新** | **首次教学于本篇**：乐观气泡 + `finally` 重拉，预检失败也能纠正幽灵消息 |
| **未选会话时省略 `conversationId`** | **首次教学于本篇**：`undefined` 让键消失；`''` / `null` 都会改变后端语义与 `run_started` 键集合 |
