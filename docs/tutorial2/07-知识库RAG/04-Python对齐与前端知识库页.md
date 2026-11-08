# 04 · Python 对齐与前端知识库页（知识库 RAG）

> 阶段 7 · 第 4 步
>
> 做完：FastAPI 提供同一套知识库接口（同一份表、同一套切分、同一套检索 SQL）；前端 `/knowledge` 页能建库、看文档、上传、删除、检索并展开命中；两套后端切同一个知识库时行为一致。
>
> **本篇面试考点**：SQLAlchemy 如何映射 `vector(1536)` · `passive_deletes=True` 不设会 500 的真实原因 · `CAST(:embedding AS vector)` vs `::vector` · `errors="replace"` 与 Node `toString('utf8')` 的对齐 · 为什么 Python 侧用 `flush` 而不是 `commit` · `UploadFile.read()` 是否阻塞事件循环 · 前端 `FormData` 为什么不能手写 `Content-Type` · 上传后为什么要同时刷文档列表与知识库列表 · `Set` 状态更新的不可变写法 · `score` 展示精度。

---

## 1. 对齐清单

| 层 | TS | Python | 必须一致的部分 |
| --- | --- | --- | --- |
| 表 | Prisma schema | SQLAlchemy 模型 | 表名、列名、类型、外键、级联 |
| 切分 | `splitter.ts` | `splitter.py` | 四个参数逐项相同 |
| 嵌入 | `embedding.service.ts` | `embedding.py` | 模型名、维度、错误文案 |
| 检索 | `searchChunks` | `search_chunks` | SQL 形状、`1 - distance`、排序、`LIMIT` |
| 接口 | `KbController` | `api/kb.py` | 路径、状态码、字段名、错误文案 |
| 节点 | `knowledge.node.ts` | `nodes/knowledge.py` | 事件顺序、`context` 拼接 |

> **面试考点 · 为什么 Python 侧要“复刻”而不是“共享代码”？**
> 两端语言不同，物理上无法共享实现。可选方案：
>
> 1. **复刻 + 契约测试**（本项目）：各自实现，用同一份契约与对比脚本保证一致；
> 2. 把检索/切分抽成独立服务，两端都调 HTTP：一致性好，但多一个部署单元与网络跳数；
> 3. 只保留一套后端：最简单，但项目目标就是“双后端对照学习”。
>
> 复刻的关键不是“写得像”，而是**有可执行的对比**。没有对比的复刻，三个月后必然分叉。

---

## 2. 依赖

**完整文件路径：`apps/api-py/pyproject.toml`**（阶段 7 增量）

```toml
dependencies = [
    # ...
    "sqlalchemy>=2.0.30",
    "psycopg[binary]>=3.2.0",
    "pgvector>=0.5.1",
    "langchain-openai>=1.0.0",
    "langchain-text-splitters>=1.1.3",
]
```

```powershell
# cwd = apps/api-py
uv sync
```

`pgvector` 这个包提供两样东西：

1. `pgvector.sqlalchemy.Vector(N)`：SQLAlchemy 列类型；
2. `pgvector` 的 SQL 函数支持（`cosine_distance` 等，本项目直接用原生 SQL，未使用 ORM 函数）。

---

## 3. 表映射

**完整文件路径：`apps/api-py/app/models/knowledge.py`**

```python
"""`knowledge_bases` / `documents` / `chunks` 表模型（阶段 7）。

重要：这三张表的 DDL 由 TS 侧 Prisma 迁移拥有
（`apps/api-ts/prisma/migrations/20261021113234_add_knowledge_base`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。

`chunks.embedding` 为 pgvector 的 `vector(1536)`，用 `pgvector.sqlalchemy.Vector(1536)` 映射；
维度固定 1536，必须与迁移及 HNSW 索引一致。
"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # 物理列为 timestamp(3)；updated_at 在 Prisma 侧由 @updatedAt 维护，
    # 这里保留应用层 default/onupdate 作为兜底，与 `App` 的写法一致。
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship("User", back_populates="knowledge_bases")
    # `passive_deletes=True`：删除知识库时**交给数据库的 ON DELETE CASCADE** 级联删除文档，
    # 而不是让 SQLAlchemy 先把子行的外键置为 NULL。
    # 若不设，删「含文档的知识库」会先把 documents.knowledge_base_id 置 NULL，
    # 触发该列的 NOT NULL 约束 → NotNullViolation（500）。
    documents: Mapped[list["Document"]] = relationship(
        "Document", back_populates="knowledge_base", passive_deletes=True
    )


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    knowledge_base_id: Mapped[str] = mapped_column(
        String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="ready")
    error_message: Mapped[str | None] = mapped_column(String, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    knowledge_base: Mapped["KnowledgeBase"] = relationship(
        "KnowledgeBase", back_populates="documents"
    )
    # 同上：删文档时由数据库 ON DELETE CASCADE 删 chunks，避免外键被置 NULL
    chunks: Mapped[list["Chunk"]] = relationship(
        "Chunk", back_populates="document", passive_deletes=True
    )


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    knowledge_base_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # pgvector 的 vector(1536)：维度不可变（与迁移、HNSW 索引一致）
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    document: Mapped["Document"] = relationship("Document", back_populates="chunks")
```

> **面试考点 · `passive_deletes=True` 到底解决什么问题？**
> 场景：删除一个**已有文档**的知识库。
>
> SQLAlchemy 的默认行为（`passive_deletes=False`）：
>
> ```text
> 1. SELECT documents WHERE knowledge_base_id = $1
> 2. UPDATE documents SET knowledge_base_id = NULL WHERE id = ...
> 3. DELETE FROM knowledge_bases WHERE id = $1
> ```
>
> 第 2 步会失败，因为 `documents.knowledge_base_id` 是 `NOT NULL`：
>
> ```text
> psycopg.errors.NotNullViolation: null value in column "knowledge_base_id"
> ```
>
> 结果：**删除含文档的知识库 → 500**。
>
> 加 `passive_deletes=True` 后：
>
> ```text
> 1. DELETE FROM knowledge_bases WHERE id = $1
> 2. （数据库）ON DELETE CASCADE 删 documents、再级联删 chunks
> ```
>
> 这和第 2 阶段讲的 `App` 关系是同一个坑，只是当时没有子记录可删，问题没暴露。
> **“外键有 CASCADE”不等于“ORM 会用 CASCADE”——ORM 可能抢在数据库前面把外键置空。**

> **面试考点 · `Vector(1536)` 是怎么读写的？**
> `pgvector.sqlalchemy.Vector` 负责两件事：
>
> - **列类型**：生成 `vector(1536)`（本项目 DDL 不由它生成，但类型要匹配）；
> - **值转换**：Python `list[float]` ↔ PG 的 `vector` 文本格式 `"[0.1,0.2,...]"`。
>
> 所以 ORM 路径下可以直接：
>
> ```python
> chunk.embedding = [0.1] * 1536
> ```
>
> 但本项目写 chunk 用的是**原生 SQL**（与 TS 对齐、且要显式控制列清单），所以还是要自己转字面量。ORM 的转换只在读取时用到。

---

## 4. 切分

**完整文件路径：`apps/api-py/app/rag/splitter.py`**

```python
"""文档切分（阶段 7）。

**参数必须与 api-ts 的 `apps/api-ts/src/rag/splitter.ts` 完全一致**：
`chunk_size=500`、`chunk_overlap=80`、
`separators=["\\n\\n", "\\n", "。", "！", "？", ". ", " ", ""]`、`keep_separator=True`。
修改这里必须同步 TS 侧，否则两端 chunk 无法逐字节一致。
"""

from langchain_text_splitters import RecursiveCharacterTextSplitter

SPLITTER_CONFIG = {
    "chunk_size": 500,
    "chunk_overlap": 80,
    "separators": ["\n\n", "\n", "。", "！", "？", ". ", " ", ""],
    "keep_separator": True,
}


def split_text(text: str) -> list[str]:
    """按 `SPLITTER_CONFIG` 把文本切成若干块（保持原顺序）。"""
    splitter = RecursiveCharacterTextSplitter(**SPLITTER_CONFIG)
    return splitter.split_text(text)
```

关键字参数名与 TS 不同（`chunk_size` vs `chunkSize`），但**含义完全对应**：

| TS | Python | 值 |
| --- | --- | --- |
| `chunkSize` | `chunk_size` | 500 |
| `chunkOverlap` | `chunk_overlap` | 80 |
| `separators` | `separators` | 同一数组 |
| `keepSeparator` | `keep_separator` | `true` |

> **注意**：两个语言包的实现并非逐行一致，边界情况（超长片段、分隔符保留位置）可能有细微差别。
> 所以 `05` 篇会用**同一个文件**分别上传，比对 `chunk_count` 与每块 `content`。**参数相同是必要条件，不是充分条件。**

---

## 5. 服务层

**完整文件路径：`apps/api-py/app/rag/service.py`**（核心节选）

```python
MAX_DOCUMENT_BYTES = 1024 * 1024
ALLOWED_EXTENSIONS = (".txt", ".md", ".markdown")
DEFAULT_TOP_K = 4


async def upload_document(
    db: Session, owner_id: str, kb_id: str, file: UploadFile | None
) -> dict[str, Any]:
    """上传并处理：校验类型/大小/空 → 切分 → 批量嵌入 → 写 documents + chunks → 更新 chunkCount。"""
    _find_owned(db, owner_id, kb_id)
    if file is None:
        raise _bad_request("Document is empty")

    filename = file.filename or ""
    mime_type = file.content_type or ""
    if mime_type == "":
        mime_type = "application/octet-stream"
    if not _is_supported_document(filename, mime_type):
        raise _bad_request(f"Unsupported document type: {mime_type}")

    raw = await file.read()
    size_bytes = len(raw)
    if size_bytes > MAX_DOCUMENT_BYTES:
        raise _bad_request("Document too large")

    # Node 的 buffer.toString('utf8') 对非法字节用 U+FFFD 替换；Python 用 errors="replace" 对齐
    content = raw.decode("utf-8", errors="replace")
    if content.strip() == "":
        raise _bad_request("Document is empty")

    chunks = [chunk for chunk in split_text(content) if chunk.strip() != ""]
    if not chunks:
        raise _bad_request("Document is empty")
    vectors = await _embed_or_bad_request(chunks)

    document_id = str(uuid.uuid4())
    document = Document(
        id=document_id,
        knowledge_base_id=kb_id,
        name=filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        status="ready",
        chunk_count=0,
    )
    db.add(document)
    db.flush()

    insert_sql = text(
        """
        INSERT INTO chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, created_at)
        VALUES (:id, :document_id, :knowledge_base_id, :chunk_index, :content,
                CAST(:embedding AS vector), now())
        """
    )
    for index, chunk in enumerate(chunks):
        db.execute(
            insert_sql,
            {
                "id": str(uuid.uuid4()),
                "document_id": document_id,
                "knowledge_base_id": kb_id,
                "chunk_index": index,
                "content": chunk,
                "embedding": to_vector_literal(vectors[index]),
            },
        )
    document.chunk_count = len(chunks)
    db.commit()
    db.refresh(document)
    return _to_document_response(document)
```

### 5.1 `errors="replace"` 为什么必须写

Node：

```ts
const content = file.buffer.toString('utf8')
```

`Buffer.toString('utf8')` 遇到非法字节序列时**不会抛错**，而是替换成 `U+FFFD`（`�`）。

Python 默认：

```python
raw.decode("utf-8")        # 抛 UnicodeDecodeError → 500
```

显式 `errors="replace"` 后行为才一致：

```python
raw.decode("utf-8", errors="replace")
```

> **面试考点 · 为什么不直接拒绝非法 UTF-8？**
> 可以，而且更“正确”。但两端必须**同样拒绝、同样文案**。
> 当前选择“替换”是因为：
>
> - Node 侧默认行为就是替换，改成拒绝要多写一次校验；
> - 纯文本文件混入少量非 UTF-8 字节（如 GBK 片段）时，替换后仍可检索剩余内容；
> - 契约里没有“编码错误”这个错误码。
>
> 关键不是选哪种，而是**两端选同一种**。如果 Python 抛错、Node 替换，同一个文件会有两种结果。

### 5.2 `flush` vs `commit`

```python
db.add(document)
db.flush()          # 发出 INSERT，拿到 document 行，但事务未提交
...
db.commit()         # 提交整个事务
```

`flush` 的作用：

- 让 `documents` 行先落库，后续 `chunks` 的外键引用才有意义；
- 但**不提交**，如果后面插 chunk 失败，`commit` 不会执行，整个事务回滚，不会留下“有文档没 chunk”的脏数据。

与 TS 的 `$transaction` 对应：

```text
Prisma:  $transaction(async tx => { create document; insert chunks; update count })
Python:  db.add + flush; execute chunks; update count; commit()
```

**语义相同，机制不同**：Prisma 是显式事务回调，SQLAlchemy 是“会话即事务”。

> **坑**：SQLAlchemy 的 Session 在 `db.execute` 时就会自动 flush。如果你在 `flush` 之后做了一次**会失败的查询**，事务可能已经处于失败状态（`InFailedSqlTransaction`），后续所有操作都报错，必须 `rollback()`。
> 本项目 chunk 插入在 flush 之后、无中间查询，所以安全。

### 5.3 检索

```python
def search_chunks(
    db: Session, kb_id: str, vector: list[float], top_k: int
) -> list[dict[str, Any]]:
    """按余弦相似度检索分块（原生 SQL；供 KB 检索接口与 `knowledge` 节点共用）。

    `score = 1 - cosine_distance`，越大越相关；按距离升序（即分数降序）取 `topK`。
    """
    literal = to_vector_literal(vector)
    rows = db.execute(
        text(
            """
            SELECT c.document_id, d.name AS document_name, c.chunk_index, c.content,
                   1 - (c.embedding <=> CAST(:embedding AS vector)) AS score
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE c.knowledge_base_id = :kb_id
            ORDER BY c.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
            """
        ),
        {"embedding": literal, "kb_id": kb_id, "top_k": top_k},
    ).all()
    return [
        {
            "documentId": row.document_id,
            "documentName": row.document_name,
            "chunkIndex": row.chunk_index,
            "content": row.content,
            "score": float(row.score),
        }
        for row in rows
    ]


def to_vector_literal(vector: list[float]) -> str:
    """转成 pgvector 字面量 `"[0.1,0.2,...]"`（与 TS 的 `toVectorLiteral` 同形）。"""
    return "[" + ",".join(repr(float(value)) for value in vector) + "]"
```

### 5.4 `CAST(:embedding AS vector)` vs `::vector`

TS：

```sql
${literal}::vector
```

Python：

```sql
CAST(:embedding AS vector)
```

两者等价。Python 用 `CAST(...)` 是因为 `:embedding::vector` 会被 SQLAlchemy 的参数解析器误认（`::` 与命名参数冲突），也可以写成 `:embedding\\:\\:vector` 转义，但可读性差。

> **面试考点 · 为什么参数不能直接绑定成 `vector` 类型？**
> 因为驱动（psycopg）不认识 `vector` 类型，只能把它当 `text` 传。
> PG 不会自动把 `text` 转成 `vector`（没有隐式转换），所以必须显式 `CAST`。
> 这也解释了为什么 TS 侧同样要 `::vector`——**不是语法糖，是类型系统的要求**。

### 5.5 `documentCount` 的查询

```python
def _find_owned(db: Session, owner_id: str, kb_id: str) -> tuple[KnowledgeBase, int]:
    """查知识库并校验归属；同时返回文档数（一次查询完成）。"""
    row = db.execute(
        select(KnowledgeBase, func.count(Document.id))
        .outerjoin(Document, Document.knowledge_base_id == KnowledgeBase.id)
        .where(KnowledgeBase.id == kb_id)
        .group_by(KnowledgeBase.id)
    ).first()
    if row is None or row[0].owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found")
    return row[0], row[1]
```

`outerjoin` + `count` 一次拿到「库 + 文档数」：

- **`outerjoin` 不是 `join`**：没有文档的库也要返回（`count = 0`）；
- `group_by(KnowledgeBase.id)`：按库聚合；
- **归属在 Python 里判断**，不是 SQL 条件——这样“库不存在”和“库不属于你”走同一分支，都返回 404，不会因为 `WHERE owner_id = ...` 而把“存在但无权”变成空结果（虽然结果一样，但显式判断更清楚）。

---

## 6. 路由

**完整文件路径：`apps/api-py/app/api/kb.py`**（响应模型与路由，节选）

```python
class KnowledgeBaseResponse(BaseModel):
    """对应契约 `KnowledgeBaseResponse`。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str | None
    documentCount: int
    createdAt: datetime
    updatedAt: datetime

    @field_serializer("createdAt", "updatedAt")
    def _serialize_timestamps(self, value: datetime) -> str:
        return iso_z(value)


class SearchKnowledgeBaseRequest(BaseModel):
    """对应契约 `SearchKnowledgeBaseRequest`。"""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=2000)
    topK: int | None = Field(default=None, ge=1, le=20)


@router.post(
    "/{id}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="uploadDocument",
)
async def upload_document(
    id: str,
    file: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentResponse:
    return DocumentResponse(
        **await service.upload_document(db, current_user.id, id, file)
    )


@router.post(
    "/{id}/search",
    response_model=SearchKnowledgeBaseResponse,
    operation_id="searchKnowledgeBase",
)
async def search_knowledge_base(
    id: str,
    body: SearchKnowledgeBaseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchKnowledgeBaseResponse:
    return SearchKnowledgeBaseResponse(
        **await service.search(db, current_user.id, id, body.query, body.topK)
    )
```

三个关键点：

1. **`file: UploadFile | None = File(default=None)`**：字段缺失时 `file` 是 `None`，由 Service 抛 `Document is empty`（400），而不是让 FastAPI 抛 422；
2. **上传路由必须是 `async def`**：`await file.read()` 需要异步；`get_db` 是同步 Session，FastAPI 会把同步依赖放到线程池执行；
3. **`status_code=201` 显式声明**：FastAPI 默认 POST 是 200，与契约不符。

**完整文件路径：`apps/api-py/app/main.py`**（挂载）

```python
from app.api import kb

app.include_router(kb.router)
```

> **面试考点 · `UploadFile.read()` 会把事件循环卡住吗？**
> `UploadFile` 内部是 `SpooledTemporaryFile`（超过阈值落磁盘），`await file.read()` 走线程池执行**同步文件 I/O**，不会阻塞事件循环。
> 但**后续的 `embed_texts` 是真正的网络调用**，必须是 `async`（`langchain-openai` 的 `aembed_documents`）。
> 如果这里写成 `def upload_document(...)`（同步路由），FastAPI 会把整个函数丢线程池，`await` 就不可用了——所以必须 `async def` + 异步嵌入。

> **面试考点 · 为什么上传大小检查在 `read()` 之后？**
> 因为 FastAPI/Starlette 默认**不限制请求体大小**，`file.size` 只有在读取后才可靠（与 Multer 的 `limits` 不同）。
> 当前实现是“先读进内存、再检查 1MB”，对 1MB 上限可接受；要防“上传 10GB 打爆内存”，必须：
>
> - 反向代理层限制（Nginx `client_max_body_size`）；
> - 或流式读取并在超过阈值时中止。
>
> **这是 TS 与 Python 的一个真实差异**：NestJS 侧有 Multer 的硬限制，FastAPI 侧没有。两端最终状态码与文案一致，但**资源保护强度不同**——工程上要知道这个差异，生产环境用网关补齐。

---

## 7. `knowledge` 节点

**完整文件路径：`apps/api-py/app/engine/nodes/knowledge.py`**

```python
"""`knowledge` 节点（阶段 7）。

与 api-ts 的 `apps/api-ts/src/engine/nodes/knowledge.node.ts` 对齐：
渲染 `data.query` → 嵌入 → 按余弦相似度检索 → 发一次 `retrieval`。

输出 `{"chunks": RetrievalHit[], "context": string}`，`context` 为各 chunk 的 `content`
以 `"\\n\\n"` 连接（两端逐字节一致）。预检已在运行前验证归属与 `topK`。
嵌入失败抛 `RunError`（规范文案见 error-messages.md §7.3），由引擎转成 `run_failed`。
"""

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.orm import Session

from app.engine.template import render_template
from app.rag.embedding import embed_texts
from app.rag.service import search_chunks

# `knowledge.data.topK` 的默认值（与契约 `default: 4` 一致）
DEFAULT_KNOWLEDGE_TOP_K = 4

EmitRetrieval = Callable[[list[dict[str, Any]], int], Awaitable[None]]


async def run_knowledge_node(
    node: dict[str, Any],
    pool: dict[str, Any],
    db: Session,
    emit_retrieval: EmitRetrieval,
) -> dict[str, Any]:
    """执行 `knowledge` 节点：检索一次并发出一次 `retrieval` 事件。"""
    data: dict[str, Any] = node["data"]
    query = render_template(data["query"], pool)
    top_k = _top_k_of(data)

    [vector] = await embed_texts([query])
    hits = search_chunks(db, data["knowledgeBaseId"], vector, top_k)
    await emit_retrieval(hits, top_k)

    return {
        "chunks": hits,
        "context": "\n\n".join(hit["content"] for hit in hits),
    }


def _top_k_of(data: dict[str, Any]) -> int:
    """`topK` 缺省为 4（与 api-ts 的 `typeof data.topK === 'number'` 对齐）。"""
    value = data.get("topK")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return DEFAULT_KNOWLEDGE_TOP_K
```

> **`isinstance(value, bool)` 为什么必须排除？**
> Python 里 `bool` 是 `int` 的子类：
>
> ```python
> isinstance(True, int)   # True
> ```
>
> 如果 `data.topK` 是 `true`（JSON 里合法），不排除就会变成 `topK=1`。
> TS 侧 `typeof true === 'boolean'`，所以 `typeof data.topK === 'number'` 自然排除。
> **跨语言移植时，类型系统的“陷阱”往往藏在这种边界里。**

引擎挂载（预检 + 分派）：

```python
async def validate_knowledge_nodes(
    db: Session, owner_id: str, graph: dict[str, Any]
) -> list[str]:
    """`knowledge` 节点的运行前预检（需要 DB 与 `owner_id`）。

    同一节点内按「缺 `knowledgeBaseId` → 未知/不属于当前用户 → `topK` 越界」顺序，
    与 api-ts 的 `validateKnowledgeNodes` 一致。
    """
    # ...（一次查询批量拿归属）
```

```python
    if node["type"] == "knowledge":
        raw_kb_id = (node.get("data") or {}).get("knowledgeBaseId")
        knowledge_base_id = "" if raw_kb_id is None else _js_string(raw_kb_id)

        async def emit_retrieval(hits: list[dict[str, Any]], top_k: int) -> None:
            await queue.put(retrieval(node["id"], knowledge_base_id, top_k, hits))

        return await run_knowledge_node(node, pool, db, emit_retrieval)
```

`_js_string` 与 TS 的 `String(...)` 对齐（阶段 4 的序列化规则），保证事件里的 `knowledgeBaseId` 在异常输入下也一致。

---

## 8. 前端知识库页

### 8.1 schema

**完整文件路径：`apps/web/lib/schemas.ts`**（知识库节选）

```ts
/** 知识库对外视图。 */
export const knowledgeBaseResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  documentCount: z.number(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
})

/** GET /knowledge-bases 的响应体。 */
export const knowledgeBaseListResponseSchema = z.strictObject({
  items: z.array(knowledgeBaseResponseSchema),
})

/** 文档对外视图。 */
export const documentResponseSchema = z.strictObject({
  id: z.string(),
  knowledgeBaseId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(['ready', 'failed']),
  errorMessage: z.string().nullable(),
  chunkCount: z.number(),
  createdAt: utcTimestampSchema,
})

export const documentListResponseSchema = z.strictObject({
  items: z.array(documentResponseSchema),
})

/** 一条检索命中（向量余弦相似度）。 */
export const retrievalHitSchema = z.strictObject({
  documentId: z.string(),
  documentName: z.string(),
  chunkIndex: z.number(),
  content: z.string(),
  /** `1 - cosine_distance`，越大越相关 */
  score: z.number(),
})

/** POST /knowledge-bases/{id}/search 的响应体。 */
export const searchKnowledgeBaseResponseSchema = z.strictObject({
  query: z.string(),
  topK: z.number(),
  hits: z.array(retrievalHitSchema),
})
```

`status` 用 `z.enum(['ready', 'failed'])` 而不是 `z.string()`：**数据库里的枚举值也是契约**，不在契约里的值应该在前端就暴露出来（Zod 报错），而不是悄悄渲染。

### 8.2 页面状态

**完整文件路径：`apps/web/app/knowledge/page.tsx`**（状态节选）

```tsx
export default function KnowledgePage() {
  // 知识库列表
  const [kbs, setKbs] = useState<KnowledgeBaseResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 当前选中的知识库与其文档
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentResponse[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  // 文档列表的“重新拉取”信号：上传/删除后 +1
  const [docsTick, setDocsTick] = useState(0)

  // 新建表单
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // 上传
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 检索
  const [query, setQuery] = useState('')
  const [topKText, setTopKText] = useState('4')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<SearchKnowledgeBaseResponse | null>(null)

  // 展开的命中（key = `${documentId}:${chunkIndex}`）
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // ...
}
```

`topKText` 是**字符串**，不是数字：

- 用户输入 `"1."` 时 `Number()` 会得到 `1`，光标行为会跳；
- 清空输入框时 `Number('') === 0`，会静默变成非法值。

提交时再转：

```tsx
const parsedTopK = Number(topKText)
if (!Number.isInteger(parsedTopK) || parsedTopK < 1 || parsedTopK > 20) {
  setSearchError('topK 需为 1-20 的整数')
  return
}
```

### 8.3 上传

```tsx
async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault()
  if (selectedId === null) return
  if (file === null) {
    setUploadError('请选择文件')
    return
  }
  const token = localStorage.getItem('accessToken')
  if (token === null) {
    router.replace('/login')
    return
  }
  setUploadError(null)
  setUploading(true)
  try {
    const form = new FormData()
    form.append('file', file)
    // 不要手写 Content-Type：交给浏览器带上 multipart boundary。
    const res = await fetch(`${API_BASE}/knowledge-bases/${selectedId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (!res.ok) {
      setUploadError(await readApiErrorMessage(res))
      return
    }
    setFile(null)
    if (fileInputRef.current !== null) fileInputRef.current.value = ''
    setDocsTick((tick) => tick + 1)
    await loadKbs().catch(() => undefined)
  } catch (err: unknown) {
    setUploadError(err instanceof Error ? err.message : String(err))
  } finally {
    setUploading(false)
  }
}
```

### 8.4 检索

```tsx
async function handleSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault()
  if (selectedId === null) return
  const token = localStorage.getItem('accessToken')
  if (token === null) {
    router.replace('/login')
    return
  }
  const parsedTopK = Number(topKText)
  if (!Number.isInteger(parsedTopK) || parsedTopK < 1 || parsedTopK > 20) {
    setSearchError('topK 需为 1-20 的整数')
    return
  }
  setSearchError(null)
  setSearchResult(null)
  setSearching(true)
  try {
    const res = await fetch(`${API_BASE}/knowledge-bases/${selectedId}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, topK: parsedTopK }),
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (!res.ok) {
      setSearchError(await readApiErrorMessage(res))
      return
    }
    setSearchResult(
      await parseResponse(res, searchKnowledgeBaseResponseSchema, 'POST /search'),
    )
  } catch (err: unknown) {
    setSearchError(err instanceof Error ? err.message : String(err))
  } finally {
    setSearching(false)
  }
}
```

展示时 `score` 固定两位小数：

```tsx
<span>{hit.score.toFixed(2)}</span>
```

> **面试考点 · 为什么上传后要同时 `setDocsTick` 和 `loadKbs()`？**
> 两个列表都会变：
>
> - 文档列表多了新文档 → `docsTick + 1` 触发重新拉取；
> - 知识库列表的 `documentCount` 变了 → `loadKbs()` 重新拉取。
>
> 如果只刷文档列表，页面上“文档数：3”会停在旧值，直到手动刷新。
> **接口返回的聚合字段（`documentCount`）在子资源变化后必须重新拉取——这是“冗余字段”的读取端代价。**

> **面试考点 · 为什么 `expanded` 用 `Set` 还要“复制再改”？**
> React 的状态比较是 `Object.is`：
>
> ```tsx
> expanded.add(key)
> setExpanded(expanded)      // 同一个引用 → 不触发重渲染
> ```
>
> 必须：
>
> ```tsx
> setExpanded((prev) => {
>   const next = new Set(prev)
>   next.has(key) ? next.delete(key) : next.add(key)
>   return next
> })
> ```
>
> `useState` 的更新函数拿到的 `prev` 保证是最新值（避免闭包过期）。**不可变更新的意义是“引用变了”，不是“内容变了”。**

---

## 9. 验证

### 9.1 同一文件，两端上传

```powershell
# 用 api-ts 上传
curl.exe -s -X POST "http://localhost:3001/knowledge-bases/$tsKbId/documents" `
  -H "Authorization: Bearer $tsToken" -F "file=@refund.md" | ConvertFrom-Json
# 用 api-py 上传到另一个库
curl.exe -s -X POST "http://localhost:8000/knowledge-bases/$pyKbId/documents" `
  -H "Authorization: Bearer $pyToken" -F "file=@refund.md" | ConvertFrom-Json
```

比对：

```powershell
docker compose exec postgres psql -U minidify -d minidify -c `
  "select d.id, d.chunk_count, d.size_bytes, d.name
   from documents d order by d.created_at desc limit 2;"
```

期望：**`chunk_count` 相同、`size_bytes` 相同**。

```powershell
docker compose exec postgres psql -U minidify -d minidify -c `
  "select chunk_index, md5(content) from chunks
   where document_id = '<TS_DOC_ID>' order by chunk_index;"
```

对 `py` 的文档做同样查询，逐行 `md5` 应相同。**不同则说明切分实现有差异**（这是最值得记录的一类“同一契约、不同实现”问题）。

### 9.2 跨后端检索同一个库

```powershell
# api-py 检索 api-ts 建的库
curl.exe -s -X POST "http://localhost:8000/knowledge-bases/$tsKbId/search" `
  -H "Authorization: Bearer $pyToken" -H "Content-Type: application/json" `
  -d '{"query":"退款要多久","topK":4}'
```

期望：200，`hits` 与 api-ts 的结果**内容相同、顺序相同**（`score` 可能有浮点末位差异，见下）。

> **为什么 `score` 可能有差异？**
> 两端向量来自**同一次 provider 调用吗**？不是——query 分别嵌入了一次。
> 如果 provider 是确定性的（mock），向量相同；真实模型在温度/版本不变时通常也确定，但**不保证逐位相同**。
> 对比时用 `round(score, 6)`，或只比 `documentId/chunkIndex` 顺序。

### 9.3 前端

```text
1. 打开 /knowledge → 建库「退款政策」→ 列表出现，文档数 0
2. 选中 → 上传 refund.md → 文档出现，chunk 数正确，文档数变 1
3. 检索「退款要多久」→ 命中卡片按分数降序
4. 点卡片 → 展开全文；再点 → 收起
5. 删除文档 → 文档消失，文档数回 0
6. 删除知识库 → 列表移除
7. 把 NEXT_PUBLIC_API_BASE 切到 8000 重启 → 同一批数据仍可见（同一个数据库）
8. 在 api-py 上传一个文件 → 切回 3001 → 也能看到（读写同一张表）
```

### 9.4 无密钥降级

把 `.env` 的 `LLM_API_KEY` 置空，重启 api-py，然后检索：

```powershell
# 400 {"statusCode":400,"message":"embedding provider not configured: LLM_API_KEY","error":"Bad Request"}
```

上传同样返回 400（同一条文案），且**数据库里没有新文档**（失败发生在写库前）。

### 9.5 删除含文档的库（`passive_deletes` 验证）

```powershell
curl.exe -s -X DELETE "http://localhost:8000/knowledge-bases/$pyKbId" `
  -H "Authorization: Bearer $pyToken" -w "%{http_code}"
```

期望 `204`，且：

```powershell
docker compose exec postgres psql -U minidify -d minidify -c `
  "select count(*) from documents where knowledge_base_id = '$pyKbId';"
```

为 `0`。

> 如果这里 500 且日志里是 `NotNullViolation`，就是 `passive_deletes=True` 漏了。

---

## 10. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| `Vector(1536)` | SQLAlchemy 列类型；读写转换 `list[float]` ↔ vector 文本 |
| `passive_deletes` | 否则 ORM 先置子表外键 NULL → NOT NULL 违反 500 |
| `CAST` vs `::` | 等价；`:x::vector` 会与命名参数冲突 |
| 参数绑定 vector | 驱动当 text 传，必须显式 CAST |
| `errors="replace"` | 与 Node `toString('utf8')` 的 U+FFFD 行为对齐 |
| `flush` vs `commit` | flush 发 SQL 不提交；commit 结束事务 |
| Session 自动 flush | 失败后事务进入 aborted，需 `rollback` |
| `UploadFile.read()` | 线程池执行，不阻塞事件循环 |
| FastAPI 无大小限制 | 与 Multer 的真实差异；生产用网关补 |
| `outerjoin` + `count` | 无文档的库也要返回 0 |
| `isinstance(x, bool)` | `bool` 是 `int` 子类，必须显式排除 |
| `FormData` 不手写 Content-Type | 浏览器要自动加 boundary |
| 上传后双刷 | 文档列表 + `documentCount` |
| `Set` 更新 | 复制再改，引用必须变 |
| `score` 对比 | 浮点末位可能不同，按精度或按顺序比 |

---

## 11. 下一步

`05-验收.md`：

- 同文件两端切分逐块比对；
- 检索命中与顺序对比；
- 跨后端上传/检索；
- 无密钥降级与失败不落库；
- 越权 404、`topK` 400；
- 阶段 1~6 回归。
