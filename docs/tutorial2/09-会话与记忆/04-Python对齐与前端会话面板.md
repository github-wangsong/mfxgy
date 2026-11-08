# 04 · Python 对齐与前端会话面板（会话与记忆）

> 阶段 9 · 第 4 步
>
> 做完：`api-py` 用 SQLAlchemy 映射同一张 `conversations` / `messages` 表，5 个接口与 TS 逐字节一致；`POST /apps/{id}/run` 的会话顺序、错误文案与 TS 完全对齐；前端在「调试运行」面板里长出会话选择、新建 / 删除、历史气泡与流式发送。
>
> **本篇面试考点**：为什么 Python 只映射、不建表 · `id` 为什么必须在应用侧生成 · `messageCount` 用相关标量子查询而不是 N+1 · SQLAlchemy 的 `IntegrityError` 为什么必须 `rollback` · `passive_deletes=True` 解决什么 · `len()` 与 JS 码点计数为什么能对上 · Pydantic 里「注解 `str` + 默认 `None`」是什么写法 · 乐观 UI 与「以服务端为准」如何收敛 · 为什么运行结束后要同时重拉消息与会话列表。

---

## 1. 本篇在整条链路里的位置

```text
                    ┌─────────────── api-ts（已完成）───────────────┐
契约 + Prisma 迁移 ─┤ conversations 模块 · run() 会话顺序 · useHistory  │
                    └──────────────────────────────────────────────┘
                                    │ 同一张表
                    ┌─────────────── api-py（本篇前半）─────────────┐
                    │ SQLAlchemy 映射 · 5 个接口 · run_stream 回写   │
                    └──────────────────────────────────────────────┘
                                    │ 同一套 JSON
                    ┌─────────────── web（本篇后半）────────────────┐
                    │ Zod 校验 · 会话面板 · 乐观气泡 · 流式发送     │
                    └──────────────────────────────────────────────┘
```

前三篇解决的是「表怎么建、NestJS 怎么写、为什么不用 checkpointer」；本篇解决「同一份数据在 Python 与浏览器里怎么表现一致」。

---

## 2. 决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 表的 DDL 归谁 | TS 侧 Prisma 迁移 | 只允许一个迁移系统；Python 只 `mapped_column` 映射 |
| 主键生成 | 应用侧 `uuid4()` / `randomUUID()` | 数据库列没有 `DEFAULT`，两边都靠应用填 |
| `messageCount` | 相关标量子查询 | 一条 SQL 出结果，避免「查会话 + 逐个查消息数」 |
| `updated_at` | `default/onupdate=func.now()` + 追加消息时显式 `update` | `onupdate` 只在 ORM 更新该行时触发；追加消息不碰会话行，必须显式刷新 |
| 删会话 | `passive_deletes=True` | 交给数据库 `ON DELETE CASCADE`，避免 SQLAlchemy 把 `NOT NULL` 外键置 NULL |
| `seq` 冲突 | `IntegrityError` → `rollback()` → 重试 3 次 | 事务已中止，不 rollback 后续语句全部失败 |
| 标题长度 | `len(title) > 120` | Python `len` 数的是码点，与 TS 的 `[...title].length` 同口径 |
| `conversationId` 的 `null` | `str = Field(default=None)` | 缺省放行、显式 `null` 报错，与 TS 的 `@ValidateIf` 对齐 |
| 前端未选会话 | 请求体**不带** `conversationId` 键 | 无状态路径完全不受影响 |
| 前端发送 | 乐观 user 气泡 + 流式 assistant 气泡 | 立即有反馈；结束后用服务端数据整体替换 |
| 运行结束 | 同时重拉消息与会话列表 | 消息要纠正乐观气泡；列表要按新的 `updatedAt` 重排 |
| 消息排序 | 前端仍按 `seq` 再排一次 | 后端已升序，前端兜底防乱序 |

---

## 3. SQLAlchemy 映射

**完整文件路径：`apps/api-py/app/models/conversation.py`**（新文件，完整）

```python
"""`conversations` / `messages` 表模型（阶段 9）。

重要：这两张表的 DDL 由 TS 侧 Prisma 迁移拥有
（`apps/api-ts/prisma/migrations/20261022140744_add_conversations`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。

`messages` 的 `(conversation_id, seq)` 有唯一约束；`seq` 在会话内从 1 递增。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Conversation(Base):
    __tablename__ = "conversations"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    app_id: Mapped[str] = mapped_column(
        String, ForeignKey("apps.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # Prisma 侧 `@updatedAt` 由客户端维护；这里保留应用层 default/onupdate 作为兜底，
    # 追加消息时服务层会显式刷新该列（与 TS 的 `conversation.update({updatedAt})` 对齐）。
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


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    conversation: Mapped["Conversation"] = relationship(
        "Conversation", back_populates="messages"
    )
```

三个必须知道的映射细节：

1. **`id` 没有 `server_default`**。Prisma 的 `@default(uuid())` 是**客户端**生成（Prisma Client 在 Node 进程里算 uuid），数据库列的 DDL 里没有 `DEFAULT gen_random_uuid()`。所以 Python 侧必须自己 `str(uuid.uuid4())`，否则插入会因主键为 `NULL` 失败。
2. **`DateTime` 是不带时区的 `timestamp(3)`**。Prisma 的 `DateTime` 默认映射 `timestamp(3)`；两端都按「UTC 的裸时间」写入，再由序列化层补 `Z`（Python 走 `iso_z`，TS 走 `toISOString()`）。
3. **`server_default=func.now()` 只在数据库侧生效**。ORM 插入后如果不 `refresh`，`created_at` 可能是 `None`；所以 `create_conversation` 里 `commit` 之后紧接着 `refresh`。

> **面试考点 · 为什么 Python 侧不能自己建这两张表？**
> 一个数据库只能有一个「DDL 所有者」。若 Prisma 迁移与 SQLAlchemy 的 `Base.metadata.create_all()` 都能建表：
> - 两边对列类型、默认值、索引名的理解稍有差异，就会出现「谁先跑谁定义」；
> - `alembic` 与 Prisma 两套版本表互不知情，回滚时无法判断真实状态；
> - CI 里任何一个先执行，另一个就会看到「表已存在」而跳过——问题被静默掩盖。
>
> 本项目约定：**Prisma 迁移是唯一真源，SQLAlchemy 只做映射**。这也解释了为什么 `models/conversation.py` 的注释第一段就在强调这件事。

---

## 4. 服务层

**完整文件路径：`apps/api-py/app/conversations/service.py`**（新文件，完整）

```python
"""会话服务（阶段 9）：会话 CRUD + 消息追加 + 历史读取。

与 api-ts 的 `apps/api-ts/src/conversations/conversations.service.ts` 对齐：
归属校验查不到、不属于当前用户、或不属于路径中的应用，一律 404
`Conversation not found`（不泄露存在性，见 error-messages.md §9）。
"""

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.engine.template import js_json_dumps
from app.models.app import App
from app.models.conversation import Conversation, Message

# 会话标题长度上限（字符数）
MAX_TITLE_LENGTH = 120
# 历史消息默认条数（可由 `MAX_HISTORY_MESSAGES` 覆盖）
DEFAULT_MAX_HISTORY_MESSAGES = 20
# 追加消息遇到唯一约束冲突时的重试次数（并发写同一会话时的兜底）
APPEND_MESSAGE_RETRIES = 3


def max_history_messages() -> int:
    """历史消息条数上限（经 `Settings` 读 `MAX_HISTORY_MESSAGES`，默认 20）。

    与 TS 的 `maxHistoryMessages()` 一致：非正整数回退到默认值。
    """
    value = settings.max_history_messages
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else (
        DEFAULT_MAX_HISTORY_MESSAGES
    )


def _message_count_column():
    """会话的消息数标量子查询（对应 Prisma 的 `_count.messages`）。"""
    return (
        select(func.count(Message.id))
        .where(Message.conversation_id == Conversation.id)
        .correlate(Conversation)
        .scalar_subquery()
    )


def assert_app_owned(db: Session, owner_id: str, app_id: str) -> None:
    """应用归属校验：查不到或非本人一律 404 `App not found`（与 `/apps` 一致）。"""
    app = db.get(App, app_id)
    if app is None or app.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")


def assert_owned_by_app(db: Session, owner_id: str, app_id: str, conversation_id: str) -> None:
    """引擎侧：按 `ownerId` + `appId` 校验会话归属（不符即 404 `Conversation not found`）。"""
    conversation = db.get(Conversation, conversation_id)
    if (
        conversation is None
        or conversation.owner_id != owner_id
        or conversation.app_id != app_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )


def list_conversations(
    db: Session, owner_id: str, app_id: str
) -> list[tuple[Conversation, int]]:
    """按 `updatedAt` 倒序返回当前用户在某应用下的会话（含消息数）。"""
    assert_app_owned(db, owner_id, app_id)
    rows = db.execute(
        select(Conversation, _message_count_column())
        .where(Conversation.owner_id == owner_id, Conversation.app_id == app_id)
        .order_by(Conversation.updated_at.desc())
    ).all()
    return [(row[0], row[1]) for row in rows]


def create_conversation(
    db: Session, owner_id: str, app_id: str, title: str | None
) -> Conversation:
    """创建会话；标题超长即 400 `Conversation title is too long`（§9）。"""
    assert_app_owned(db, owner_id, app_id)
    if title is not None and len(title) > MAX_TITLE_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Conversation title is too long",
        )
    conversation = Conversation(
        id=str(uuid.uuid4()), owner_id=owner_id, app_id=app_id, title=title
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def _find_owned(db: Session, owner_id: str, conversation_id: str) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.owner_id != owner_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    return conversation


def get_conversation(db: Session, owner_id: str, conversation_id: str) -> tuple[Conversation, int]:
    conversation = _find_owned(db, owner_id, conversation_id)
    count = db.execute(
        select(func.count(Message.id)).where(Message.conversation_id == conversation_id)
    ).scalar_one()
    return conversation, count


def remove_conversation(db: Session, owner_id: str, conversation_id: str) -> None:
    conversation = _find_owned(db, owner_id, conversation_id)
    db.delete(conversation)
    db.commit()


def list_messages(db: Session, owner_id: str, conversation_id: str) -> list[Message]:
    """按 `seq` 升序返回会话的全部消息。"""
    _find_owned(db, owner_id, conversation_id)
    return list(
        db.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.seq.asc())
        ).all()
    )


def append_message(
    db: Session,
    conversation_id: str,
    role: str,
    content: str,
    run_id: str | None = None,
) -> None:
    """追加一条消息：`seq = max(seq) + 1`（唯一约束兜底并发冲突，冲突时重试）。

    同时刷新会话 `updatedAt`（与 TS 的 `conversation.update` 对齐）。
    """
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


def load_history(
    db: Session, conversation_id: str, limit: int | None = None
) -> list[dict[str, str]]:
    """读取最近 `limit` 条消息（按 `seq` 升序返回，供 `pool.conversation` 使用）。"""
    rows = db.execute(
        select(Message.role, Message.content)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.seq.desc())
        .limit(max_history_messages() if limit is None else limit)
    ).all()
    return [{"role": row.role, "content": row.content} for row in reversed(rows)]


def build_conversation_context(
    conversation_id: str, messages: list[dict[str, str]]
) -> dict[str, Any]:
    """把消息列表构造为 `pool.conversation`（见 sse-events.md §4.2）。"""
    return {
        "id": conversation_id,
        "history": "\n".join(f"{message['role']}: {message['content']}" for message in messages),
        "messages": [
            {"role": message["role"], "content": message["content"]} for message in messages
        ],
    }


def assistant_content(outputs: dict[str, Any]) -> str:
    """助手消息内容（sse-events.md §4.2）：`outputs` 只有 1 个键时取其字符串值
    （非字符串按紧凑 JSON 序列化），否则取紧凑 JSON。
    """
    keys = list(outputs.keys())
    if len(keys) == 1:
        value = outputs[keys[0]]
        return value if isinstance(value, str) else js_json_dumps(value)
    return js_json_dumps(outputs)
```

### 4.1 `messageCount`：相关标量子查询

```python
select(func.count(Message.id))
.where(Message.conversation_id == Conversation.id)   # 关联到外层会话行
.correlate(Conversation)                             # 声明「外层引用」
.scalar_subquery()                                   # 作为一列返回
```

最终 SQL 形如：

```sql
SELECT conversations.*,
       (SELECT count(messages.id) FROM messages
        WHERE messages.conversation_id = conversations.id) AS anon_1
FROM conversations
WHERE conversations.owner_id = $1 AND conversations.app_id = $2
ORDER BY conversations.updated_at DESC;
```

**不要写成**「先查会话列表，再循环查每条消息数」：

```python
# 反例：N+1
conversations = db.scalars(select(Conversation)...).all()
counts = [db.scalar(select(func.count()).where(Message.conversation_id == c.id)) for c in conversations]
```

一个 50 条会话的列表页会打 51 次数据库。相关子查询只打 1 次，且与 Prisma 的 `include: { _count: ... }` 语义一致。

### 4.2 `len(title)` 与 `[...title].length` 为什么能对上

| 语言 | 写法 | 数的是什么 |
| --- | --- | --- |
| Python | `len(title)` | **Unicode 码点**（Python 3 的 `str` 是码点序列） |
| TypeScript | `[...title].length` | **Unicode 码点**（展开运算符按码点迭代） |
| TypeScript（错误写法） | `title.length` | UTF-16 **码元**（emoji 算 2） |

三者的差别只在最后一行。所以「121 个 `a`」和「121 个 emoji」在两端都返回 400，而不会出现「TS 拒绝、Python 放行」。

### 4.3 `append_message` 的重试为什么必须 `rollback`

这是 Python 侧与 TS 侧**最不一样**的一处：

```python
except IntegrityError:
    db.rollback()          # ← 必须
    if attempt >= APPEND_MESSAGE_RETRIES:
        raise
```

原因：SQLAlchemy 的 `Session` 在第一次执行语句时**隐式开启事务**。PostgreSQL 一旦遇到唯一约束冲突，会把当前事务标记为 **aborted**——后续任何语句（包括下一次 `SELECT max(seq)`）都会报：

```text
current transaction is aborted, commands ignored until end of transaction block
```

所以不 `rollback` 就重试，第二轮必然失败，而且错误信息完全掩盖了真实原因（唯一约束冲突）。

TS 侧不需要显式 rollback，是因为 Prisma 的交互式事务在回调抛错时会**自动回滚**并释放连接。

> **面试考点 · 为什么两边都是「读 max + 写 + 唯一约束」，实现却不同？**
> 因为事务的**生命周期所有者**不同：
> - Prisma：`$transaction(async (tx) => { ... })` 显式圈定范围，异常自动回滚；
> - SQLAlchemy：`Session` 自动开启事务，需要你显式 `commit()` / `rollback()` 来闭合。
>
> 对齐的是**语义**（成功则写入，冲突则重试），不是代码形状。写跨语言实现时，先对齐行为，再各自用惯用法实现。

### 4.4 `assistant_content` 为什么用 `js_json_dumps`

```python
return value if isinstance(value, str) else js_json_dumps(value)
```

`js_json_dumps` 是阶段 8 为「跨语言数值对齐」写的序列化函数（`1.0`、`NaN`、键序都按 JS 的 `JSON.stringify` 行为）。助手消息会作为历史文本被下一轮读出来，两端必须逐字节一致，所以这里不能直接用 `json.dumps`。

---

## 5. 路由

**完整文件路径：`apps/api-py/app/api/conversations.py`**（新文件，完整）

```python
"""会话与记忆路由（阶段 9）—— 契约见 packages/contract/openapi.yaml。

5 个接口：
- `GET|POST /apps/{id}/conversations`
- `GET|DELETE /conversations/{id}`
- `GET /conversations/{id}/messages`

错误文案见 error-messages.md §9。归属校验复用 `get_current_user`。
"""

from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, field_serializer
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.conversations import service
from app.models.conversation import Conversation, Message
from app.models.user import User
from app.timefmt import iso_z

router = APIRouter(tags=["conversations"])


class ConversationResponse(BaseModel):
    """对应契约 `ConversationResponse`。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    appId: str
    title: str | None
    messageCount: int
    createdAt: datetime
    updatedAt: datetime

    @field_serializer("createdAt", "updatedAt")
    def _serialize_timestamps(self, value: datetime) -> str:
        return iso_z(value)


class ConversationListResponse(BaseModel):
    """对应契约 `ConversationListResponse`。"""

    model_config = ConfigDict(extra="forbid")

    items: list[ConversationResponse]


class CreateConversationRequest(BaseModel):
    """对应契约 `CreateConversationRequest`。

    长度上限（120）由服务层检查，以便产出契约规定的固定文案
    `Conversation title is too long`（见 error-messages.md §9）。
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None


class MessageResponse(BaseModel):
    """对应契约 `MessageResponse`。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    conversationId: str
    role: str
    content: str
    seq: int
    runId: str | None
    createdAt: datetime

    @field_serializer("createdAt")
    def _serialize_timestamps(self, value: datetime) -> str:
        return iso_z(value)


class MessageListResponse(BaseModel):
    """对应契约 `MessageListResponse`。"""

    model_config = ConfigDict(extra="forbid")

    items: list[MessageResponse]


def _to_conversation_response(conversation: Conversation, message_count: int) -> ConversationResponse:
    return ConversationResponse(
        id=conversation.id,
        appId=conversation.app_id,
        title=conversation.title,
        messageCount=message_count,
        createdAt=conversation.created_at,
        updatedAt=conversation.updated_at,
    )


def _to_message_response(message: Message) -> MessageResponse:
    return MessageResponse(
        id=message.id,
        conversationId=message.conversation_id,
        role=message.role,
        content=message.content,
        seq=message.seq,
        runId=message.run_id,
        createdAt=message.created_at,
    )


@router.get(
    "/apps/{id}/conversations",
    response_model=ConversationListResponse,
    operation_id="listConversations",
)
def list_conversations(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationListResponse:
    rows = service.list_conversations(db, current_user.id, id)
    return ConversationListResponse(
        items=[_to_conversation_response(conversation, count) for conversation, count in rows]
    )


@router.post(
    "/apps/{id}/conversations",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="createConversation",
)
def create_conversation(
    id: str,
    body: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationResponse:
    conversation = service.create_conversation(db, current_user.id, id, body.title)
    return _to_conversation_response(conversation, 0)


@router.get("/conversations/{id}", response_model=ConversationResponse, operation_id="getConversation")
def get_conversation(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationResponse:
    conversation, count = service.get_conversation(db, current_user.id, id)
    return _to_conversation_response(conversation, count)


@router.delete(
    "/conversations/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteConversation",
)
def delete_conversation(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    service.remove_conversation(db, current_user.id, id)


@router.get(
    "/conversations/{id}/messages",
    response_model=MessageListResponse,
    operation_id="listConversationMessages",
)
def list_conversation_messages(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageListResponse:
    messages = service.list_messages(db, current_user.id, id)
    return MessageListResponse(items=[_to_message_response(message) for message in messages])
```

要点：

1. **`apiKey` 风格的 camelCase 与 Python 的 snake_case 全靠手写映射**。`ConversationResponse(appId=conversation.app_id, ...)` 没有用 alias 生成器，因为字段少、显式更好读。
2. **`@field_serializer` 把时间统一成 `iso_z`**。返回值注释写的是 `str`，但字段声明仍是 `datetime`——序列化器负责最终形状，Pydantic 的 `response_model` 校验也认可这个输出。
3. **`CreateConversationRequest.title` 是 `str | None = None`**，显式 `null` 合法（存 null）；这与 `RunRequest.conversationId` 的「显式 null 报错」是两套语义，别混淆。
4. **`operation_id` 与契约一致**。FastAPI 会据此生成 OpenAPI；阶段 0 定的命名规范在这里继续沿用。

注册路由只需要在 `apps/api-py/app/main.py` 加两行：

```python
from app.api.conversations import router as conversations_router

app.include_router(conversations_router)
```

---

## 6. `run.py`：会话接线

**完整文件路径：`apps/api-py/app/api/run.py`**（阶段 9 增量，完整文件）

```python
"""`POST /apps/{id}/run` 路由 —— 契约见 packages/contract/openapi.yaml，
事件协议见 packages/contract/sse-events.md。

行为与 api-ts 的 `RunController` / `EngineService` 保持一致：
- 运行当前**草稿**图；草稿为 NULL 即 400 `Graph is empty`；
- 运行前预检（`validate_graph` + 节点数据形状），不通过即 400（**普通 JSON**，不是流）；
- 归属校验复用 `app.api.apps._find_owned`（查不到 / 非本人一律 404）；
- 预检全部通过后才用 `StreamingResponse(media_type="text/event-stream")` 手写 SSE 帧。
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.apps import _find_owned
from app.api.deps import get_current_user, get_db
from app.conversations.service import (
    append_message,
    assert_owned_by_app,
    build_conversation_context,
    load_history,
)
from app.engine.engine import precheck, run_stream
from app.models.user import User

router = APIRouter(prefix="/apps", tags=["apps"])


class RunRequest(BaseModel):
    """对应契约 `RunRequest`。

    `conversationId` / `userMessage` 用「注解为 str、默认 None」的写法：缺省时不校验，
    但**显式传 null 视为类型错误**（与 api-ts 的 `ValidateIf` 行为一致）。
    """

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any]
    conversationId: str = Field(default=None)  # type: ignore[assignment]
    userMessage: str = Field(default=None, max_length=4000)  # type: ignore[assignment]


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
    # 预检需要知道 ownerId：其他用户的知识库一律视为不存在（见 error-messages.md §7.2）
    errors = await precheck(db, current_user.id, graph, body.conversationId is not None)
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
        # 显式给出 content-type，避免 Starlette 追加 `; charset=utf-8`，与 api-ts 的响应头对齐
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
    )
```

### 6.1 `str = Field(default=None)` 是什么写法

这是 Pydantic v2 里表达「**缺省可以，显式 null 不行**」的惯用技巧：

```python
conversationId: str = Field(default=None)   # 注解是 str（非 Optional），默认值是 None
```

- 请求 JSON **不含** `conversationId` → 走默认值 `None`，不校验；
- 请求 JSON 含 `"conversationId": null` → 按 `str` 校验，`None` 不是字符串 → 422/400；
- `# type: ignore[assignment]` 只是让 mypy 闭嘴（注解与默认值类型不一致）。

与之对照的两种常见写法都会破坏对齐：

| 写法 | 缺省 | 显式 null | 与 TS 一致吗 |
| --- | --- | --- | --- |
| `conversationId: str = Field(default=None)` | 放行 | **报错** | 一致（TS 用 `@ValidateIf`） |
| `conversationId: str \| None = None` | 放行 | 放行 | 不一致（TS 会 400） |
| `conversationId: str = Field(...)` | **必填报错** | 报错 | 不一致（TS 可选） |

> **面试考点 · 为什么要在意「显式 null」？**
> 契约测试会对同一份请求打两端，断言「状态码 + 响应体」逐字节相同。如果 Nest 对 `null` 报 400、FastAPI 当成没传，两边就分叉了。
> 真实的坑在于：前端 `JSON.stringify({ conversationId: undefined })` 会**丢掉**这个键，但 `JSON.stringify({ conversationId: null })` 会保留 `null`。手写脚本、第三方 SDK、Java 客户端都更习惯发 `null`——所以这不是理论问题。

### 6.2 `precheck` 多了一个参数

**完整文件路径：`apps/api-py/app/engine/engine.py`**（节选）

```python
def validate_node_data(graph: dict[str, Any], has_conversation: bool = False) -> list[str]:
    """节点数据形状校验（引擎侧，见 error-messages.md §4.1、§6.1 与 §9）。"""
    errors: list[str] = []
    for node in graph.get("nodes") or []:
        data: dict[str, Any] = node.get("data") or {}
        node_id = node.get("id")
        node_type = node.get("type")
        # …… 其余节点类型省略 ……
        elif node_type == "llm":
            if not isinstance(data.get("prompt"), str):
                errors.append(f"llm node {node_id} prompt must be a string")
            # §6.1：tools 里每个名字都必须已注册（预检即 400，不等运行时）
            tools = data.get("tools")
            if isinstance(tools, list):
                for name in tools:
                    if not isinstance(name, str) or not has_tool(name):
                        errors.append(
                            f"llm node {node_id} references unknown tool: {_js_string(name)}"
                        )
            # §9：useHistory 需要会话上下文（请求必须带 conversationId）
            if data.get("useHistory") is True and not has_conversation:
                errors.append(f"llm node {node_id} useHistory requires a conversation")
    return errors
```

`precheck(db, owner_id, graph, has_conversation=False)` 把 `has_conversation` 透传给 `validate_node_data`；对外运行（阶段 10）始终传 `False`，与 TS 的 `runPublished` 一致。

---

## 7. `engine.py`：会话帧与助手消息

**完整文件路径：`apps/api-py/app/engine/engine.py`**（节选）

```python
async def run_stream(
    app_id: str,
    graph: dict[str, Any],
    inputs: dict[str, Any],
    db: Session,
    conversation: dict[str, Any] | None = None,
) -> AsyncGenerator[str, None]:
    """产出 SSE 帧的异步生成器：先 `run_started`，后台执行图，逐帧产出直至队列关闭。"""
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    run_id = str(uuid.uuid4())
    await queue.put(
        # 无会话时第三个参数为 None，events.run_started 会省略 conversationId 键
        run_started(run_id, app_id, conversation["id"] if conversation is not None else None)
    )
    task = asyncio.create_task(_run_graph(graph, inputs, queue, run_id, db, conversation))
    while True:
        event = await queue.get()
        if event is None:
            break
        yield format_sse_frame(event)
    await task
```

收尾顺序与 TS 完全一致：

```python
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

一个容易被忽略的点：`run_stream` 的 `db` 是**请求作用域**的 `Session`，被 `create_task` 的后台任务复用。它能在整个流期间存活，是因为 FastAPI 的依赖清理发生在响应结束后——但这也意味着**流期间这条连接不会归还连接池**。生产上要把「长流」与「短查询」的 Session 分开，避免连接池耗尽。

---

## 8. `llm.py`：`use_history`

**完整文件路径：`apps/api-py/app/engine/nodes/llm.py`**（节选）

```python
def build_initial_messages(node: dict[str, Any], pool: dict[str, Any]) -> list[BaseMessage]:
    """构造 `llm` 节点的初始消息：`system`（非空时）+ 渲染后的 `prompt`。

    阶段 9：`data.useHistory === true` 且 `pool.conversation` 存在时，先把会话历史
    **前置**为真实消息对象（`user`→Human、`assistant`→AI、`system`→System，
    `tool` 角色跳过），再接本轮的 system（非空时）与渲染后的 `prompt`。
    启用工具的节点只在第一轮用它，后续轮次沿用节点自己的消息数组。
    """
    data: dict[str, Any] = node["data"]
    messages: list[BaseMessage] = []
    if data.get("useHistory") is True:
        messages.extend(_history_messages(pool))
    if isinstance(data.get("system"), str) and data["system"]:
        messages.append(SystemMessage(content=data["system"]))
    messages.append(HumanMessage(content=render_template(str(data["prompt"]), pool)))
    return messages


def _history_messages(pool: dict[str, Any]) -> list[BaseMessage]:
    """把 `pool.conversation.messages` 转换为 LangChain 消息（`tool` 角色跳过）。"""
    conversation = pool.get("conversation")
    if not isinstance(conversation, dict):
        return []
    items = conversation.get("messages")
    if not isinstance(items, list):
        return []
    messages: list[BaseMessage] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        content = _content_string(item.get("content"))
        role = item.get("role")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
        elif role == "system":
            messages.append(SystemMessage(content=content))
        # `tool` 角色跳过
    return messages


def _content_string(value: Any) -> str:
    """历史内容字符串化：字符串原样，其余对齐 JS `String(value ?? '')` 的标量表现。"""
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)
```

`_content_string` 是为「跨语言一致」专门写的：TS 侧是 `typeof item.content === 'string' ? item.content : String(item.content ?? '')`，Python 的 `str(True)` 会得到 `"True"`（大写），必须手动对齐成 `"true"`。这类小分叉不会报错，但会让两端喂给模型的历史文本不同。

---

## 9. 前端：Zod schema

**完整文件路径：`apps/web/lib/schemas.ts`**（阶段 9 增量）

```ts
// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

/** 会话对外视图。 */
export const conversationResponseSchema = z.strictObject({
  id: z.string(),
  appId: z.string(),
  title: z.string().nullable(),
  messageCount: z.number(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
})

/** GET /apps/{id}/conversations 的响应体。 */
export const conversationListResponseSchema = z.strictObject({
  items: z.array(conversationResponseSchema),
})

/** 会话消息对外视图。 */
export const messageResponseSchema = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  seq: z.number(),
  runId: z.string().nullable(),
  createdAt: utcTimestampSchema,
})

/** GET /conversations/{id}/messages 的响应体。 */
export const messageListResponseSchema = z.strictObject({
  items: z.array(messageResponseSchema),
})

export type ConversationResponse = z.infer<typeof conversationResponseSchema>
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>
export type MessageResponse = z.infer<typeof messageResponseSchema>
export type MessageListResponse = z.infer<typeof messageListResponseSchema>
```

两个刻意的选择：

1. **`title` 用 `.nullable()` 而不是 `.optional()`**。后端保证这个键一定存在（值可能为 `null`），`strictObject` 也会拒绝多余键；如果用 `.optional()`，等于允许后端「漏掉这个字段」，而契约里它是 `required`。
2. **`role` 用 `z.enum`**。后端可能存进 `tool` 历史（未来），但**对外契约**只有三种角色；一旦出现第四种，Zod 会立刻报错，而不是悄悄渲染出一个未知标签。

---

## 10. 前端：状态与数据流

### 10.1 状态

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（节选）

```tsx
  // 会话列表（按 updatedAt 倒序，由后端保证）
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  // 当前选中的会话；空串表示「未选会话 · 不保存历史」
  const [selectedConversationId, setSelectedConversationId] = useState('')
  // 当前会话的历史消息（按 seq 升序）
  const [messages, setMessages] = useState<ConversationMessage[]>([])
```

外加三个与本篇直接相关的状态（它们在前面的阶段已存在，这里只说明用途）：

| 状态 | 作用 |
| --- | --- |
| `pendingAssistant` | 正在流式接收的 assistant 文本；`null` 表示没有进行中的气泡 |
| `messagesLoading` | 历史加载中，避免把「空列表」误显示成「暂无消息」 |
| `running` | 运行中；会话选择、新建、删除、发送全部据此禁用 |

### 10.2 拉取：列表与消息

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
      const body = await parseResponseOrNull(res, conversationListResponseSchema)
      if (body !== null) setConversations(body.items)
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
      const body = await parseResponseOrNull(res, messageListResponseSchema)
      if (body === null) return
      setMessages([...body.items].sort((a, b) => a.seq - b.seq))
    } catch {
      // 静默降级：拉取失败时保留已有消息，下一次运行结束会再拉。
    } finally {
      setMessagesLoading(false)
    }
  }, [router])
```

三个设计点：

1. **`parseResponseOrNull` 而不是 `res.json()`**。所有响应都是不可信输入，必须过 Zod；`strictObject` 会把「后端多返回了一个字段」也当成错误。
2. **404 时清空选择**。典型场景是另一个标签页删了这个会话；继续停留在「已选中的不存在的会话」会让后续每次发送都 404。
3. **前端再排一次序**。后端已经 `ORDER BY seq`，这里排序是防御：即使未来接入分页 / 合并本地乐观消息，也不会因为拼装顺序出错。

### 10.3 两个 effect

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

为什么「失败静默降级」是合理的：阶段 9 的会话是**增强能力**，无会话运行是基线。会话接口挂了不应该让整个调试面板不可用。

### 10.4 `executeRun`：带会话字段 + 结束后重拉

```tsx
  async function executeRun(
    token: string,
    inputs: Record<string, unknown>,
    options: { conversationId?: string; userMessage?: string },
    appendBubble: boolean,
  ): Promise<void> {
    // …… 重置运行态 …
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
      // …… 401 / content-type / 逐帧解析（与阶段 4~8 相同）……
      for await (const frame of parseSseStream(res.body)) {
        // ……
        if (frame.event === 'token') {
          const parsed = parseEventData(frame.data, tokenEventSchema)
          if (parsed !== null && typeof parsed.text === 'string') {
            setLiveText((prev) => prev + parsed.text)
            // 只有「会话发送」才往 assistant 气泡里追加；调试运行只更新 liveText
            if (appendBubble) setPendingAssistant((prev) => (prev ?? '') + parsed.text)
          }
        }
        // ……
      }
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err))
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
  }
```

两个关键行为：

1. **未选会话时，请求体里连 `conversationId` 键都没有**。这保证无状态路径与阶段 8 完全一致（`appendBubble = false` 的「调试运行」也因此不会产生会话副作用）。
2. **`finally` 里重拉，而不是相信本地状态**。四种情况都会被纠正：
   - 运行成功：服务端已写入 `user` + `assistant`，本地乐观气泡被真实数据（带 `id` / `seq` / `runId`）替换；
   - 预检失败（400 普通 JSON）：用户消息**没有**落库，重拉会把乐观气泡删掉；
   - 运行中 `run_failed`：只落了 user，重拉后只显示 user；
   - 会话被别处删除：重拉消息返回 404，自动回到「未选会话」。

### 10.5 新建 / 删除 / 发送

```tsx
  /** 新建会话：成功后选中它并清空消息列表。 */
  async function handleCreateConversation(): Promise<void> {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/apps/${appId}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      if (res.status === 401) {
        router.replace('/login')
        return
      }
      if (!res.ok) {
        setError(await readApiErrorMessage(res))
        return
      }
      const created = await parseResponse(res, conversationResponseSchema, 'POST /conversations')
      setConversations((prev) => [created, ...prev])
      setMessages([])
      setPendingAssistant(null)
      setSelectedConversationId(created.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 删除当前会话：成功后回到「未选会话」并刷新列表。 */
  async function handleDeleteConversation(): Promise<void> {
    if (selectedConversationId === '') return
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/conversations/${selectedConversationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        router.replace('/login')
        return
      }
      if (!res.ok) {
        setError(await readApiErrorMessage(res))
        return
      }
      setSelectedConversationId('')
      setMessages([])
      setPendingAssistant(null)
      await loadConversations(token)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
```

发送：

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
    // 表单只有一个输入变量时，把聊天框内容写进它，省去再填一次「运行输入」
    if (startInputs.length === 1) {
      inputs[startInputs[0].name] = text
    }
    const conversationId = selectedConversationId === '' ? undefined : selectedConversationId
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
    setChatInput('')
    setPendingAssistant('')
    await executeRun(
      token,
      inputs,
      { conversationId, userMessage: conversationId === undefined ? undefined : text },
      true,
    )
  }
```

乐观气泡的 `id` 用 `local-${Date.now()}`，只作为 React 的 `key`；`seq` 用 `max + 1` 让它在本地排到最后。这两个值都**不会被提交**——它们只是「在服务端返回之前先让人看到」。

### 10.6 界面

```tsx
                {/* 阶段 9：会话调试（会话选择 + 历史气泡 + 流式发送）。 */}
                <div className="panel">
                  <div className="panel-head">会话调试（多轮）</div>
                  <div className="panel-body stack stack--sm">
                    <div className="field">
                      <label className="label">会话</label>
                      <select
                        className="select"
                        value={selectedConversationId}
                        onChange={(e) => {
                          setSelectedConversationId(e.target.value)
                          setMessages([])
                          setPendingAssistant(null)
                        }}
                        disabled={running}
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
                    </div>
                    {/* …… 新建 / 删除按钮 …… */}
                    <div ref={messagesRef} className="event-list">
                      {messages.map((message) => {
                        const isUser = message.role === 'user'
                        return (
                          <div key={message.id} className={`event-row${isUser ? ' is-token' : ''}`}>
                            <span className="event-name">{message.role}</span>
                            <span className="event-body">{message.content}</span>
                            <span className="faint">{formatMessageTime(message.createdAt)}</span>
                          </div>
                        )
                      })}
                      {pendingAssistant !== null && (
                        <div className="event-row is-token">
                          <span className="event-name">assistant</span>
                          <span className="event-body">{pendingAssistant === '' ? '…' : pendingAssistant}</span>
                          <span className="faint">
                            流式{selectedConversationId === '' ? '（未保存）' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    <form onSubmit={handleSend} className="row">
                      <input
                        className="input grow"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="输入消息，回车发送"
                        disabled={running}
                      />
                      <button className="btn btn-primary btn-sm" type="submit" disabled={running || chatInput.trim() === ''}>
                        {running ? '运行中…' : '发送'}
                      </button>
                    </form>
                  </div>
                </div>
```

四个细节：

1. **切换会话时先清空**。`setMessages([])` + `setPendingAssistant(null)` 避免「上一个会话的气泡在新会话里闪一下」。
2. **`running` 期间全部禁用**。会话是串行的：并发发送会让 `seq` 竞争，也会让「结束后重拉」互相覆盖。
3. **`pendingAssistant === ''` 显示 `…`**。首个 token 到达前，气泡也要可见，否则用户会以为没发出去。
4. **`formatMessageTime(message.createdAt)`**。`createdAt` 已被 Zod 的 `utcTimestampSchema` 校验为 UTC 字符串，展示层再转本地时间；不要直接把原始字符串渲染给用户。

---

## 11. 验证

前置：数据库已迁移、`api-ts`（:3001）与 `api-py`（:8000）都已启动。会话数据是共用的，所以**同一份 token 打两端**即可。

```powershell
# 0) 登录拿 token（沿用阶段 1 的账号；没有就先注册）
$ts = Get-Date -Format "HHmmss"
Invoke-RestMethod -Method Post "http://localhost:3001/auth/register" -ContentType "application/json" `
  -Body (@{ email = "conv04_$ts@example.com"; password = "password123" } | ConvertTo-Json) | Out-Null
$token = (Invoke-RestMethod -Method Post "http://localhost:3001/auth/login" -ContentType "application/json" `
  -Body (@{ email = "conv04_$ts@example.com"; password = "password123" } | ConvertTo-Json)).accessToken
$H = @{ Authorization = "Bearer $token" }
```

### 11.1 五个接口在两端形状一致

```powershell
# 用 TS 建应用 + 建会话
$app = Invoke-RestMethod -Method Post "http://localhost:3001/apps" -Headers $H -ContentType "application/json" `
  -Body (@{ name = "conv04-app" } | ConvertTo-Json)
$conv = Invoke-RestMethod -Method Post "http://localhost:3001/apps/$($app.id)/conversations" -Headers $H `
  -ContentType "application/json" -Body (@{ title = "两端对比" } | ConvertTo-Json)
$convId = $conv.id

# 分别打两端，比较原始文本
$a = (curl.exe -s -H "Authorization: Bearer $token" "http://127.0.0.1:3001/conversations/$convId") | Out-String
$b = (curl.exe -s -H "Authorization: Bearer $token" "http://127.0.0.1:8000/conversations/$convId") | Out-String
Compare-Object $a $b
```

预期：`Compare-Object` **无输出**（`id` / `appId` / `title` / `messageCount` / 两个时间戳全部逐字节相同）。

```powershell
# 列表接口同样对比
$a = (curl.exe -s -H "Authorization: Bearer $token" "http://127.0.0.1:3001/apps/$($app.id)/conversations") | Out-String
$b = (curl.exe -s -H "Authorization: Bearer $token" "http://127.0.0.1:8000/apps/$($app.id)/conversations") | Out-String
Compare-Object $a $b
```

预期：无输出。

### 11.2 标题长度：121 个码点两端都 400

```powershell
$long = "a" * 121
foreach ($port in 3001, 8000) {
  $code = curl.exe -s -o _t.txt -w "%{http_code}" -X POST "http://127.0.0.1:$port/apps/$($app.id)/conversations" `
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
    --data-binary (@{ title = $long } | ConvertTo-Json -Compress)
  "$port => $code $(Get-Content _t.txt)"
}
Remove-Item _t.txt
```

预期：

```text
3001 => 400 {"statusCode":400,"message":"Conversation title is too long","error":"Bad Request"}
8000 => 400 {"detail":"Conversation title is too long"}
```

> 状态码与 `message` / `detail` 文案一致；外层包裹形状由阶段 1 的错误归一化决定，两边本来就不一样（这是既有约定）。

### 11.3 `seq` 连续、两端读到的消息一致

```powershell
# 用 Python 端跑两轮（图与阶段 9 第 2 篇相同：start -> llm(useHistory) -> end）
# 这里只验证消息序：直接往库里写两轮也可以，但推荐走 /run 以覆盖完整链路
$a = (curl.exe -s -H "Authorization: Bearer $token" "http://127.0.0.1:3001/conversations/$convId/messages") | Out-String
$b = (curl.exe -s -H "Authorization: Bearer $token" "http://127.0.0.1:8000/conversations/$convId/messages") | Out-String
Compare-Object $a $b

# 看 seq 序列
(Invoke-RestMethod -Method Get "http://localhost:8000/conversations/$convId/messages" -Headers $H).items |
  Select-Object seq, role | Format-Table -AutoSize
```

预期：`Compare-Object` 无输出；`seq` 从 1 开始连续递增，`role` 交替。

### 11.4 删除会话：204 + 级联删除

```powershell
$code = curl.exe -s -o NUL -w "%{http_code}" -X DELETE "http://127.0.0.1:8000/conversations/$convId" `
  -H "Authorization: Bearer $token"
$code

# 会话已不存在
curl.exe -s -o _d.txt -w "%{http_code}`n" "http://127.0.0.1:3001/conversations/$convId" -H "Authorization: Bearer $token"
Get-Content _d.txt

# 消息也被级联删掉（应为 0）
docker exec -i mini-dify-db psql -U postgres -d minidify -t -c "select count(*) from messages where conversation_id = '$convId';"
Remove-Item _d.txt
```

预期：

```text
204
404
{"statusCode":404,"message":"Conversation not found","error":"Not Found"}
0
```

### 11.5 前端手工路径

1. 打开 `http://localhost:3000/apps/{appId}` → 右侧「调试运行」；
2. 「会话调试（多轮）」里点「新建会话」→ 下拉框出现 `会话 xxxxxxxx（0 条）`；
3. 输入「你好」并回车 → 立刻出现 user 气泡与 `…` 的 assistant 气泡，随后逐字增长；
4. 运行结束后气泡被服务端数据替换（时间显示为本地时间，条数变为 2）；
5. 再发一条 → `seq` 继续，条数变为 4；
6. 选「（未选会话 · 不保存历史）」再发送 → 不产生新气泡记录，提示「未选会话：本次运行不会保存历史」；
7. 点「删除当前会话」→ 回到未选状态，下拉框里该会话消失；
8. 把 `apps/web/.env.local` 的 `NEXT_PUBLIC_API_BASE` 从 3001 改成 8000 并重启前端 → 刷新页面，同一会话的历史、条数、时间显示完全一致。

第 8 步是阶段 9 的最终验收动作：**换后端，前端零改动，会话不断档。**

---

## 12. 面试考点汇总

| 问题 | 一句话答案 |
| --- | --- |
| 为什么 Python 只映射不建表？ | 一个库只能有一个 DDL 所有者；Prisma 迁移是唯一真源 |
| `id` 为什么在应用侧生成？ | Prisma 的 `@default(uuid())` 是客户端默认值，数据库列没有 `DEFAULT` |
| `messageCount` 为什么不循环查？ | 相关标量子查询一条 SQL 出结果，与 Prisma `_count` 对齐 |
| `onupdate` 为什么不够？ | 追加消息不更新会话行，必须显式 `UPDATE conversations SET updated_at` |
| `passive_deletes` 解决什么？ | 避免 SQLAlchemy 把 `NOT NULL` 外键置 NULL，交给数据库级联 |
| `IntegrityError` 为什么必须 `rollback`？ | PostgreSQL 冲突后事务进入 aborted，不 rollback 后续语句全失败 |
| `len()` 与 JS 怎么对齐？ | Python `len` 与 `[...str].length` 都是码点；JS `.length` 是码元 |
| `str = Field(default=None)` 是什么？ | 缺省放行、显式 `null` 报错，对齐 TS 的 `@ValidateIf` |
| 为什么结束后要重拉消息？ | 乐观气泡需要被真实 `id` / `seq` / `runId` 替换；预检失败还要删掉乐观气泡 |
| 为什么结束后要重拉列表？ | `updatedAt` 变了，会话要按新顺序冒到最前，条数也要更新 |
| 为什么 404 时要清空选择？ | 会话可能已被别处删除，继续停留会让后续每次发送都 404 |
| 为什么 `running` 时禁用全部会话操作？ | 会话是串行的，并发发送会让 `seq` 竞争、重拉互相覆盖 |

---

## 13. 下一步

两端与前端都已打通，剩下的只有验收：`05-验收.md` 会把阶段 9 的全部用例整理成一张矩阵——

- 多轮上下文是否真的进了模型（`useHistory` 开 / 关对照）；
- `MAX_HISTORY_MESSAGES` 截断是否按「最近 N 条」；
- 四条错误路径的状态码与文案；
- 失败运行是否只留 user 消息；
- 两端事件流与消息表是否逐字节一致；
- 以及阶段回归：会话加入后，阶段 4~8 的无会话运行是否完全未受影响。
