# 04 · Python 对齐与前端知识库页

> 所属：阶段 7 · 知识库 RAG
> 本篇覆盖两块：**A. Python 侧对齐**——三张表的 ORM 映射（`pgvector` 向量列）、文档切分、嵌入调用、上传/检索服务（原生 SQL）、`/knowledge-bases*` 路由与 `knowledge` 节点；**B. 前端**——`/knowledge` 知识库页（新建 / 列表 / 删除 / 上传 / 文档表 / 检索调试），以及画布里的 `knowledge` 节点检查器与运行面板的 `retrieval` 引用展示。
> **本篇首次教学（Python / 前端落地视角；契约与切分视角分别见 `01` / `02`）**：`pgvector.sqlalchemy.Vector(1536)` 与 Prisma `Unsupported("vector(1536)")` 的差异 · `UploadFile` + `python-multipart`（对照 multer `FileInterceptor`） · SQLAlchemy `text()` 的参数绑定与 `::vector` 坑 · `check_embedding_ctx_length=False` · **读配置必须走 `settings`**（pydantic-settings 不回写 `os.environ`） · `async def` 路由里用同步 SQLAlchemy `Session` 的注意点 · **能力目录驱动 UI**（KB 下拉来自 `GET /knowledge-bases`） · **`FormData` 不手写 `Content-Type`** · **检索调试面板**（RAG 调优先看召回） · **`retrieval` 事件驱动引用展示** · **分数固定 3 位小数**。
> RAG 概念 / pgvector 建模 / HNSW 索引见本阶段 `01-知识库契约与pgvector建模.md`；切分参数与向量化见 `02-文档切分与向量化.md`；NestJS 检索、`score = 1 - distance`、`retrieval` 事件见 `03-NestJS检索与检索节点.md`；端到端验收见 `05-验收.md`。SQLAlchemy `Mapped` / `mapped_column` 见 `01-账号与认证/04-SQLAlchemy2.0.md`；`relationship` / `ForeignKey` / cascade 见 `02-应用管理/04-SQLAlchemy关系建模.md`；Python 语法最小集（`async def` / `with` / 推导式 / 异常）见 `00-项目初始化/00-Python与FastAPI基础.md`；`Depends` 与 `get_db` 见 `01-账号与认证/05-FastAPI认证.md`；SSE 客户端 `parseSseStream` 见 `04-执行引擎/06-前端SSE客户端与运行面板.md`；「能力目录驱动 UI」的首次教学见 `06-工具调用/04-前端工具选择面板.md`——本篇**直接使用、不重讲**。

---

## 1. 本篇目标

做完这一篇，你能：

- 说清 **同一张 `chunks` 表**在两套后端里的两种映射方式：
  - Python：`Mapped[list[float] | None] = mapped_column(Vector(1536))`——**有原生类型**；
  - TS：`embedding Unsupported("vector(1536)")?`——Prisma **不认识向量**，只能走原生 SQL「逃生舱」。
- 说清一次上传从 `multipart/form-data` 到「documents + chunks 落库」的完整链路，以及 **`UploadFile` 与 multer 在「大小上限」上的机制差异**。
- 说清 `text()` 里 `:embedding` 的参数绑定、`CAST(:embedding AS vector)` 为什么必须这么写，以及 `:emb::vector` 为什么会踩坑。
- 说清 `check_embedding_ctx_length=False` 解决的是什么真实报错。
- 说清「`.env` 读不到」这类问题的根因：**pydantic-settings 只把 `.env` 读进 `Settings`，不回写 `os.environ`**。
- 在浏览器里独立完成：新建知识库 → 上传 `refund-sample.txt` → 看到 `277 B / 1 chunk / ready` → 检索「退款」→ 看到 `命中 1 条`、`refund-sample.txt · 分块 0 · 分数 0.520` → 删除文档后表格清空。
- 在画布里：加 `knowledge` 节点 → 检查器下拉选中知识库 → 保存 → `GET /apps/{id}/graph` 含 `knowledgeBaseId` 与 `topK: 4` → 运行后在面板看到「命中 1 条 · topK 4」与引用详情。

**验收标准（对齐总纲 §6 阶段 7）**

> 能上传文档、切分并向量化；`knowledge` 节点能检索并在运行面板看到引用。

具体化为可执行层面：

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | Python 模型映射 | `chunks.embedding` 映射为 `Vector(1536)`；`\d chunks` 显示 `vector(1536)` |
| 2 | 上传接口 | `POST /knowledge-bases/{id}/documents`（multipart，字段名 `file`）返回 201 与 `chunkCount` |
| 3 | 上传校验 | `.exe` / 空文件 / >1MB 分别返回契约文案（见 `05-验收.md` L7） |
| 4 | 检索接口 | `POST /knowledge-bases/{id}/search` 返回 `{query, topK, hits}`，`score` 为余弦相似度 |
| 5 | 知识库页 | 新建 / 列表 / 删除 / 上传 / 文档表 / 检索调试**全部可用** |
| 6 | 画布节点 | 检查器出现「知识库」下拉（来自 `GET /knowledge-bases`）、`query`、`topK` |
| 7 | 图落库 | 保存后 `GET /apps/{id}/graph` 的 knowledge 节点含 `knowledgeBaseId` 与 `topK` |
| 8 | 运行展示 | 运行面板显示「命中 N 条 · topK K」+ 每条引用的文档名 / 分块 / 分数 / 内容 |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| 契约 `0.7.0`（`/knowledge-bases*`、`KnowledgeNodeData`、`RetrievalHit`、`retrieval` 事件） | 本阶段 `01` |
| Prisma 迁移 `20261021113234_add_knowledge_base`（含 `vector(1536)` 与 HNSW 索引） | 本阶段 `01` / `02` |
| TS 侧 `rag/` 与 `knowledge` 节点、`retrieval` 事件已实现 | 本阶段 `03` |
| Python 新依赖：`pgvector` / `python-multipart` / `langchain-text-splitters` | `apps/api-py/pyproject.toml` 已列出 |
| mock-LLM 支持 `POST /v1/embeddings`（确定性哈希向量器，维度 1536） | 阶段 5 · `04-mock-LLM与无密钥自测.md`；本阶段 `05-验收.md` |
| DB 容器 `mini-dify-db` 为 `healthy` | 阶段 0 · `02-本地中间件Docker.md` |

**环境变量（两端读同一组键）**

```bash
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=test
LLM_MODEL=mock-model
LLM_TIMEOUT_MS=3000
EMBEDDING_MODEL=mock-embedding
```

> `EMBEDDING_MODEL` 是阶段 7 新增的键：缺省 `text-embedding-3-small`。走 mock 时必须显式设为 `mock-embedding`——**不要**让代码去「猜」provider 返回的维度，维度由契约固定为 1536（`01` 已讲）。

---

## 3. 命令逐条

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | 仓库根 | 安装阶段 7 新增的 Python 依赖 | 退出码 0；`pgvector` / `python-multipart` / `langchain-text-splitters` 出现在 `uv.lock` |
| `node tools/mock-llm/server.mjs` | 仓库根 | 起 mock provider（chat + embeddings） | `mock-llm listening on http://127.0.0.1:11435` |
| `pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000） | `Uvicorn running on http://127.0.0.1:8000` |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001），用于交叉验证 | `api-ts listening on http://localhost:3001` |
| `pnpm dev:web` | 仓库根 | 起 Next.js（3000） | `Ready in ...` + `Local: http://localhost:3000` |
| 浏览器打开 `http://localhost:3000/knowledge` | —— | 验证知识库页 | 见第 8 节实测 |

**准备一个用户与 token**（沿用前几阶段验收篇）：

```bash
curl -s -o /dev/null -X POST http://127.0.0.1:3001/auth/register \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com","password":"secret123"}'

TS_TOKEN=$(curl -s -X POST http://127.0.0.1:3001/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com","password":"secret123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
```

**这段命令在干什么**：注册 / 登录拿 Bearer 令牌，后续 `/knowledge-bases*` 与 `/apps/{id}/run` 都靠它鉴权；令牌只放环境变量，不写进代码或仓库。

> 前端**不感知**具体后端：`NEXT_PUBLIC_API_BASE` 指向 `api-ts` 或 `api-py` 都行。两端 `GET /knowledge-bases` / `POST /search` 的响应体逐字段相同，所以同一份前端对两端都成立。

---

## 4. Python 侧完整代码

本步涉及的文件：

```
apps/api-py/app/
├── models/knowledge.py      # 三张表的 ORM 映射（含 Vector(1536)）
├── rag/
│   ├── splitter.py          # 递归切分（参数与 TS 逐项一致）
│   ├── embedding.py         # 批量嵌入 + 错误归一 + 维度校验
│   └── service.py           # CRUD + 上传/切分/写向量 + 检索（原生 SQL）
├── api/kb.py                # /knowledge-bases* 路由（UploadFile）
└── engine/nodes/knowledge.py# knowledge 节点：检索一次 + 发一次 retrieval
```

### 4.1 `apps/api-py/app/models/knowledge.py`

**完整文件路径：`apps/api-py/app/models/knowledge.py`**

```python
"""`knowledge_bases` / `documents` / `chunks` 表模型（阶段 7）。"""

from datetime import datetime

from pgvector.sqlalchemy import Vector                      # ← 关键：pgvector 的 SQLAlchemy 原生类型
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"                        # ← 表名与 Prisma 的 @@map 一致

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )                                                         # ← 归属外键；index=True 只是元数据，DDL 仍归 Prisma
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # 物理列为 timestamp(3)；updated_at 在 Prisma 侧由 @updatedAt 维护，
    # 这里保留应用层 default/onupdate 作为兜底，与 `App` 的写法一致。
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship("User", back_populates="knowledge_bases")
    # passive_deletes=True：删除知识库时交给数据库 ON DELETE CASCADE，
    # 而不是让 SQLAlchemy 先把 documents.knowledge_base_id 置 NULL（那会触发 NOT NULL → 500）
    documents: Mapped[list["Document"]] = relationship(
        "Document", back_populates="knowledge_base", passive_deletes=True
    )                                                         # ← 1:N；字符串目标延迟解析，避免循环导入


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    knowledge_base_id: Mapped[str] = mapped_column(
        String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True
    )                                                         # ← ON DELETE CASCADE：删库即删文档
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
    chunks: Mapped[list["Chunk"]] = relationship(
        "Chunk", back_populates="document", passive_deletes=True
    )                                                         # ← 删文档时由数据库级联删 chunks，避免外键被置 NULL


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    knowledge_base_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)   # ← TEXT：分块可能很长
    # pgvector 的 vector(1536)：维度不可变（与迁移、HNSW 索引一致）
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    document: Mapped["Document"] = relationship("Document", back_populates="chunks")
```

**这段在干什么**：

- 三张表与 Prisma schema **一一对应**：`knowledge_bases`（属于用户）、`documents`（属于知识库）、`chunks`（属于文档，同时冗余 `knowledge_base_id` 供检索过滤）。
- `owner_id` / `knowledge_base_id` / `document_id` 都是 `ForeignKey(..., ondelete="CASCADE")`——**删父删子**由数据库完成（与 Prisma 的 `onDelete: Cascade` 同义）。
- `documents` / `chunks` 关系上的 `passive_deletes=True`：删除父行时**不要**让 ORM 逐行把子行外键置 NULL，而是交给数据库的 `ON DELETE CASCADE`。漏掉它，删「含文档的知识库」会触发 `NotNullViolation` → 500（见 4.1「写错会怎样」）。
- `created_at` 用 `server_default=func.now()`（数据库默认值）；`updated_at` 额外用 `default/onupdate` 做应用层兜底（DB 触发器仍是权威，见 `02-应用管理/04`）。
- `chunk_count` / `status` 用 `server_default`，与迁移里的 `DEFAULT 0` / `DEFAULT 'ready'` 对齐。
- **最重要的一行**是 `Vector(1536)`：它让 SQLAlchemy 认识 `pgvector` 的向量类型；但**表的 DDL 仍由 Prisma 迁移拥有**，Python 侧**绝不** `create_all()`。

**与 TS / Prisma 对照**

| 关注点 | Prisma（`apps/api-ts/prisma/schema.prisma`） | SQLAlchemy（本文件） | 机制差异 |
| --- | --- | --- | --- |
| 向量列 | `embedding Unsupported("vector(1536)")?` | `mapped_column(Vector(1536))` | Prisma **不认识**该类型，生成的 Client **不含** `embedding` 字段；SQLAlchemy **认识**，可读写 |
| 是否能用 ORM 查询该列 | ❌（`Unsupported` 字段被排除） | ✅（但本项目仍用原生 SQL 对齐 TS） | 一个有「逃生舱」，一个没有 |
| 列精度 | 迁移里 `vector(1536)` | `Vector(1536)` | 维度必须一致，否则插入报类型错误 |
| id 生成 | `@default(uuid())`（**客户端**默认值） | 应用侧 `str(uuid.uuid4())` | 数据库没有 `DEFAULT uuid()`，两端都必须显式给 |
| 索引 | `@@index([knowledgeBaseId])` + 手写 HNSW | `index=True`（仅元数据） | DDL 所有权在 Prisma（`01-账号与认证/04`） |
| 删除父行 | `prisma.knowledgeBase.delete()` 只发一条 `DELETE`，数据库级联 | 关系必须声明 `passive_deletes=True` | Prisma 不需要该开关；SQLAlchemy 不设会先置 NULL → `NotNullViolation` |
| 级联删除 | `onDelete: Cascade` | `ForeignKey(..., ondelete="CASCADE")` + `passive_deletes=True` | 前者由数据库执行；后者还要 ORM「让路」 |

**写错会怎样**：

1. **把 `Vector(1536)` 写成 `Vector(1024)`**：ORM 认为列是 1024 维，但数据库列是 1536 维；插入时 PostgreSQL 报 `expected 1536 dimensions, not 1024`，或者读取时静默错位（取决于驱动）。**维度以迁移为准**。
2. **给 `Chunk` 加 `create_all()`**：会尝试在 Python 侧建表 / 建索引，和 Prisma 迁移冲突，甚至生成重复索引。本项目**从不**在 `db.py` 里 `create_all()`。
3. **漏掉 `knowledge_base_id` 冗余列**：检索只能 JOIN `documents` 再过滤，SQL 变复杂且更慢；本项目在 `chunks` 上直接存 `knowledge_base_id` 并在 SQL 里 `WHERE c.knowledge_base_id = :kb_id`。
4. **漏掉 `passive_deletes=True`**：删「含文档的知识库」时，SQLAlchemy 会先把 `documents.knowledge_base_id` UPDATE 成 NULL，撞上 `NOT NULL` → `NotNullViolation`，接口 500。加上后由数据库 `ON DELETE CASCADE` 级联；实测 204 且 `documents` / `chunks` 计数归零（`01` §21.4）。

### 4.2 `apps/api-py/app/rag/splitter.py`

**完整文件路径：`apps/api-py/app/rag/splitter.py`**

```python
"""文档切分（阶段 7）。

**参数必须与 api-ts 的 `apps/api-ts/src/rag/splitter.ts` 完全一致**：
`chunk_size=500`、`chunk_overlap=80`、
`separators=["\\n\\n", "\\n", "。", "！", "？", ". ", " ", ""]`、`keep_separator=True`。
修改这里必须同步 TS 侧，否则两端 chunk 无法逐字节一致。
"""

from langchain_text_splitters import RecursiveCharacterTextSplitter   # ← 递归切分器

SPLITTER_CONFIG = {                         # ← 这就是「参数即契约」：四个值都必须两端一致
    "chunk_size": 500,                      #   每块目标长度（字符数，不是 token 数）
    "chunk_overlap": 80,                    #   相邻块的重叠长度（避免句子被切断后丢上下文）
    "separators": ["\n\n", "\n", "。", "！", "？", ". ", " ", ""],
    "keep_separator": True,                 #   分隔符保留在块里，保证拼接后仍是原文
}


def split_text(text: str) -> list[str]:
    """按 `SPLITTER_CONFIG` 把文本切成若干块（保持原顺序）。"""
    splitter = RecursiveCharacterTextSplitter(**SPLITTER_CONFIG)   # ← ** 把字典展开成关键字参数
    return splitter.split_text(text)                                # ← 同步方法（TS 侧是 async）
```

**这段在干什么**：

- `SPLITTER_CONFIG` 是一组**常量**，用 `**` 展开传给构造函数——`**SPLITTER_CONFIG` ≈ TS 的 `{ ...SPLITTER_CONFIG }` 但语义是「按关键字展开」。
- `split_text` 每次调用**新建**一个拆分器。拆分器本身无状态（配置固定），新建开销可忽略，也避免跨请求共享可变状态。
- 分隔符顺序是**从粗到细**：先按空行（段落），再按换行，再按中文句号 / 叹号 / 问号，再按英文句号+空格，再按空格，最后按字符兜底。
- `keep_separator=True` 让「句号 / 换行」留在块内，**两端的输出才能逐字节相同**；关闭它，标点归属会变，chunk 长度与哈希全变。

**与 TS 对照**

| 参数 | TS `splitter.ts` | Python `splitter.py` | 备注 |
| --- | --- | --- | --- |
| 每块长度 | `chunkSize: 500` | `chunk_size=500` | 驼峰 ↔ 下划线，值必须相同 |
| 重叠 | `chunkOverlap: 80` | `chunk_overlap=80` | 同上 |
| 分隔符 | `['\n\n','\n','。','！','？','. ',' ','']` | 同左 | **顺序**也属于契约 |
| 保留分隔符 | `keepSeparator: true` | `keep_separator=True` | 关闭后两端必然分叉 |
| 调用 | `await splitter.splitText(text)` | `splitter.split_text(text)` | TS 封装是异步的，Py 是同步的 |

**写错会怎样**：任意一个参数不同，同一篇文档的 `chunkCount`、每块长度、每块内容都会变——后续 `sha256`、`score`、`context` 全部无法逐字节一致（`05-验收.md` L5 就是拿 6 行 `len + sha256` 抓这种分叉）。

### 4.3 `apps/api-py/app/rag/embedding.py`

**完整文件路径：`apps/api-py/app/rag/embedding.py`**

```python
"""文本向量化（阶段 7）。

与 api-ts 的 `apps/api-ts/src/rag/embedding.service.ts` 对齐。
"""

from langchain_openai import OpenAIEmbeddings                 # ← LangChain 的 OpenAI 兼容封装

from app.config import settings                               # ← 配置一律从这里读
from app.engine.events import RunError

# 向量维度**固定 1536**：必须与 `chunks.embedding vector(1536)` 及 HNSW 索引一致
EMBEDDING_DIMENSIONS = 1536

# 默认嵌入模型（可用环境变量 `EMBEDDING_MODEL` 覆盖）
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量文本向量化；失败抛 `RunError`（规范文案见 error-messages.md §7.3）。"""
    if not texts:                                             # ← 空列表直接返回，避免无意义请求
        return []
    api_key = settings.llm_api_key                            # ← 必须走 Settings，不能读 os.environ
    if not api_key:
        raise RunError("embedding provider not configured: LLM_API_KEY")

    client = OpenAIEmbeddings(
        api_key=api_key,
        model=settings.embedding_model or DEFAULT_EMBEDDING_MODEL,
        base_url=settings.llm_base_url,                       # ← 复用 LLM 的 provider 地址
        timeout=settings.llm_timeout_ms / 1000,               # ← 毫秒 → 秒（openai SDK 用秒）
        # 不重试（与 api-ts 的 maxRetries: 0 对齐）
        max_retries=0,
        # 关键：不做 tiktoken 本地分词（非 OpenAI 官方模型会因此报错）
        check_embedding_ctx_length=False,
    )

    try:
        vectors = await client.aembed_documents(texts)        # ← a 前缀 = async；批量一次调用
    except Exception as error:                                # noqa: BLE001 - 任何嵌入错误都归一为规范文案
        raise RunError(map_embedding_error(error)) from error # ← from：保留原始异常链

    for vector in vectors:
        if not isinstance(vector, list) or len(vector) != EMBEDDING_DIMENSIONS:
            # 维度不符时按 unknown 处理（与 api-ts 一致）
            raise RunError("embedding request failed: unknown")
    return vectors


def map_embedding_error(error: Exception) -> str:
    """把嵌入调用异常映射为规范文案（规则与 `map_llm_error` 一致，前缀改为 `embedding`）。"""
    status = _status_code(error)
    if status is not None:
        if status in (401, 403):
            return "embedding request unauthorized"
        if status == 429:
            return "embedding rate limited"
        return f"embedding request failed: {status}"          # ← f-string 插值状态码
    if _is_timeout(error):
        return "embedding request timed out"
    return "embedding request failed: unknown"


def _status_code(error: Exception) -> int | None:
    """取异常的 HTTP 状态码（Python openai SDK 的 APIStatusError 带 `status_code`）。"""
    for attr in ("status_code", "status"):
        value = getattr(error, attr, None)                    # ← 动态取属性，两种 SDK 字段名都兼容
        if isinstance(value, int):                            # ← 注意 bool 是 int 子类，这里不会被误判（状态码不会是 True）
            return value
    return None


def _is_timeout(error: Exception) -> bool:
    """判定是否为超时（`APITimeoutError` / `TimeoutError`，或消息含 timeout）。"""
    if type(error).__name__ in ("APITimeoutError", "TimeoutError", "APIConnectionTimeoutError"):
        return True
    message = str(error).lower()
    return "timed out" in message or "timeout" in message
```

**这段在干什么**：

- **配置全部从 `settings` 读**：`settings.llm_api_key` / `settings.embedding_model` / `settings.llm_base_url` / `settings.llm_timeout_ms`。这四者在 `config.py` 里都有默认值，且 `env_file` 指向 `apps/api-py/.env`（绝对路径）。
- `OpenAIEmbeddings` 的 `base_url` 指向 mock 或真实 provider；`max_retries=0` 与阶段 5 的 LLM 调用一致（失败立刻映射，不挂起）。
- **`check_embedding_ctx_length=False`** 关掉「本地 tiktoken 预分词」——否则自定义模型名（如 `mock-embedding`）会因 `tiktoken.encoding_for_model` 找不到编码而报错。
- `await client.aembed_documents(texts)` 一次批量嵌入；返回 `list[list[float]]`。
- **维度校验**：任何一个向量不是 `list` 或长度不是 1536，统一按 `unknown` 处理——绝不把「维度不对」的向量写进 `vector(1536)` 列。
- 所有异常经 `map_embedding_error` 归一为**固定文案**（`error-messages.md` §7.3），不透出 SDK 原始 message。

**与 TS 对照**

| 关注点 | TS `embedding.service.ts` | Python `embedding.py` | 机制差异 |
| --- | --- | --- | --- |
| 配置来源 | `process.env.*`（`dotenv/config` 已载入 `.env`） | `settings.*`（pydantic-settings） | **Py 侧不能直接读 `os.environ`**，见 5.5 |
| 批量调用 | `client.embedDocuments(texts)` | `await client.aembed_documents(texts)` | `a` 前缀 = async |
| 超时单位 | `timeout: Number(LLM_TIMEOUT_MS)`（**毫秒**） | `timeout=llm_timeout_ms / 1000`（**秒**） | 同一个环境变量，两个 SDK 单位不同——**最容易写错的一处** |
| 重试 | `maxRetries: 0` | `max_retries=0` | 语义相同 |
| 本地分词预检 | 未显式关闭 | `check_embedding_ctx_length=False` | 见 5.4 |
| 状态码 | 读 `error.status` | 读 `error.status_code` 或 `error.status` | Py 侧两种字段都兼容 |
| 超时判定 | `error.name` + message 正则 | `type(error).__name__` + message | 同一套思路 |

**写错会怎样**：

- 把 `timeout` 写成 `settings.llm_timeout_ms`（不除以 1000）：openai SDK 以**秒**为单位，60000 秒的超时等于「永不超时」，验收里的 `embedding request timed out` 永远等不到。
- 删掉维度校验：维度不符时 PostgreSQL 直接报 `expected 1536 dimensions`，错误未经归一，两端文案不一致。
- 把 `check_embedding_ctx_length` 留默认 `True`：mock 模型名会触发 tiktoken 报错，上传接口返回 400 的文案变成库的原始 message（不是契约文案）。

### 4.4 `apps/api-py/app/rag/service.py`

**完整文件路径：`apps/api-py/app/rag/service.py`**

```python
"""知识库读写服务（阶段 7）：CRUD + 文档上传/删除 + 向量检索。"""

import uuid                                       # ← 生成 UUID（≈ TS 的 crypto.randomUUID()）
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.engine.events import RunError
from app.models.knowledge import Document, KnowledgeBase
from app.rag.embedding import embed_texts
from app.rag.splitter import split_text
from app.timefmt import iso_z                     # ← 时间序列化统一 UTC + 毫秒 + Z

# 单文档大小上限：1MB
MAX_DOCUMENT_BYTES = 1024 * 1024

# 知识库名字长度上限（字符数，与 api-ts 的 [...trimmed].length 一致）
MAX_KNOWLEDGE_BASE_NAME_LENGTH = 80

# 检索默认 topK（契约 `default: 4`）
DEFAULT_TOP_K = 4

# 允许的扩展名（大小写不敏感）
ALLOWED_EXTENSIONS = (".txt", ".md", ".markdown")


def list_knowledge_bases(db: Session, owner_id: str) -> list[dict[str, Any]]:
    """列出当前用户的知识库（按 createdAt 降序），并带文档数。"""
    rows = db.execute(
        select(KnowledgeBase, func.count(Document.id))               # ← 查 KB + 聚合计数
        .outerjoin(Document, Document.knowledge_base_id == KnowledgeBase.id)   # ← LEFT JOIN：没有文档也要出现
        .where(KnowledgeBase.owner_id == owner_id)                   # ← 归属过滤
        .group_by(KnowledgeBase.id)
        .order_by(KnowledgeBase.created_at.desc())
    ).all()
    return [_to_knowledge_base_response(kb, count) for kb, count in rows]   # ← 列表推导式 ≈ map


def create_knowledge_base(
    db: Session, owner_id: str, name: str | None, description: str | None
) -> dict[str, Any]:
    trimmed = (name or "").strip()                     # ← None 也当空串处理
    if trimmed == "":
        raise _bad_request("Knowledge base name is required")
    if len(trimmed) > MAX_KNOWLEDGE_BASE_NAME_LENGTH:  # ← 按「字符数」算（Python len 是码点，与 TS 的 [...s].length 对齐）
        raise _bad_request("Knowledge base name is too long")

    kb = KnowledgeBase(
        id=str(uuid.uuid4()),                          # ← id 由应用生成（数据库无默认）
        owner_id=owner_id,
        name=trimmed,
        description=description,
    )
    db.add(kb)
    db.commit()                                        # ← 提交事务
    db.refresh(kb)                                     # ← 重新读回数据库生成的 created_at / updated_at
    return _to_knowledge_base_response(kb, 0)


def get_knowledge_base(db: Session, owner_id: str, kb_id: str) -> dict[str, Any]:
    kb, count = _find_owned(db, owner_id, kb_id)       # ← 查不到 / 不属于自己 → 404
    return _to_knowledge_base_response(kb, count)


def remove_knowledge_base(db: Session, owner_id: str, kb_id: str) -> None:
    kb, _ = _find_owned(db, owner_id, kb_id)
    db.delete(kb)                                      # ← ORM 删除；passive_deletes=True 让数据库 CASCADE 带走 documents / chunks
    db.commit()


def list_documents(db: Session, owner_id: str, kb_id: str) -> list[dict[str, Any]]:
    _find_owned(db, owner_id, kb_id)                   # ← 先验归属，再列文档
    documents = db.scalars(
        select(Document)
        .where(Document.knowledge_base_id == kb_id)
        .order_by(Document.created_at.asc())           # ← 早上传的排前面（与 TS 的 asc 一致）
    ).all()
    return [_to_document_response(document) for document in documents]


def delete_document(db: Session, owner_id: str, kb_id: str, document_id: str) -> None:
    _find_owned(db, owner_id, kb_id)
    document = db.scalar(
        select(Document).where(Document.id == document_id, Document.knowledge_base_id == kb_id)
    )                                                  # ← 同时限定文档与知识库，防止跨库删
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    db.delete(document)
    db.commit()


async def upload_document(
    db: Session, owner_id: str, kb_id: str, file: UploadFile | None
) -> dict[str, Any]:
    """上传并处理：校验类型/大小/空 → 切分 → 批量嵌入 → 写 documents + chunks → 更新 chunkCount。"""
    _find_owned(db, owner_id, kb_id)                   # ← 归属校验放在最前
    if file is None:
        raise _bad_request("Document is empty")

    filename = file.filename or ""                     # ← 浏览器给的文件名（可能是 ""）
    mime_type = file.content_type or ""                # ← multipart 的 Content-Type
    if mime_type == "":
        mime_type = "application/octet-stream"
    if not _is_supported_document(filename, mime_type):
        raise _bad_request(f"Unsupported document type: {mime_type}")

    raw = await file.read()                            # ← UploadFile.read() 是【异步】的
    size_bytes = len(raw)                              # ← 字节数（不是字符数）
    if size_bytes > MAX_DOCUMENT_BYTES:
        raise _bad_request("Document too large")

    # Node 的 buffer.toString('utf8') 对非法字节用 U+FFFD 替换；Python 用 errors="replace" 对齐
    content = raw.decode("utf-8", errors="replace")
    if content.strip() == "":                          # ← 全是空白也算空文档
        raise _bad_request("Document is empty")

    chunks = [chunk for chunk in split_text(content) if chunk.strip() != ""]   # ← 过滤空白块
    if not chunks:
        raise _bad_request("Document is empty")
    vectors = await _embed_or_bad_request(chunks)      # ← 批量嵌入；失败 → 400 规范文案

    document_id = str(uuid.uuid4())
    document = Document(
        id=document_id,
        knowledge_base_id=kb_id,
        name=filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        status="ready",
        chunk_count=0,                                 # ← 先写 0，最后再更新
    )
    db.add(document)
    db.flush()                                         # ← 只发 INSERT、不提交：让 document 在事务内可见

    insert_sql = text(
        """
        INSERT INTO chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, created_at)
        VALUES (:id, :document_id, :knowledge_base_id, :chunk_index, :content,
                CAST(:embedding AS vector), now())
        """
    )                                                  # ← 原生 SQL；:name 是【绑定参数】，不是字符串拼接
    for index, chunk in enumerate(chunks):             # ← enumerate 同时拿下标与内容
        db.execute(
            insert_sql,
            {
                "id": str(uuid.uuid4()),
                "document_id": document_id,
                "knowledge_base_id": kb_id,
                "chunk_index": index,
                "content": chunk,
                "embedding": to_vector_literal(vectors[index]),   # ← 字符串 "[0.1,0.2,...]"
            },
        )
    document.chunk_count = len(chunks)
    db.commit()                                        # ← 一个事务里写完 documents + chunks + chunkCount
    db.refresh(document)
    return _to_document_response(document)


async def search(
    db: Session, owner_id: str, kb_id: str, query: str, top_k: int | None
) -> dict[str, Any]:
    """检索：先嵌入 query，再按余弦相似度取 topK。知识库归属不符时 404。"""
    _find_owned(db, owner_id, kb_id)
    limit = DEFAULT_TOP_K if top_k is None else top_k
    vector = (await _embed_or_bad_request([query]))[0] # ← 单条查询也走批量接口，取第 0 个
    hits = search_chunks(db, kb_id, vector, limit)
    return {"query": query, "topK": limit, "hits": hits}


def search_chunks(
    db: Session, kb_id: str, vector: list[float], top_k: int
) -> list[dict[str, Any]]:
    """按余弦相似度检索分块（原生 SQL；供 KB 检索接口与 `knowledge` 节点共用）。"""
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
        {"embedding": literal, "kb_id": kb_id, "top_k": top_k},   # ← 绑定参数字典
    ).all()
    return [
        {
            "documentId": row.document_id,
            "documentName": row.document_name,
            "chunkIndex": row.chunk_index,
            "content": row.content,
            "score": float(row.score),                 # ← 统一成 float（可能是 Decimal / float）
        }
        for row in rows
    ]


def to_vector_literal(vector: list[float]) -> str:
    """向量转 pgvector 文本字面量 `[0.1,0.2,...]`（再用 CAST(... AS vector) 转成向量列）。"""
    return "[" + ",".join(str(value) for value in vector) + "]"


def _find_owned(db: Session, owner_id: str, kb_id: str) -> tuple[KnowledgeBase, int]:
    row = db.execute(
        select(KnowledgeBase, func.count(Document.id))
        .outerjoin(Document, Document.knowledge_base_id == KnowledgeBase.id)
        .where(KnowledgeBase.id == kb_id)
        .group_by(KnowledgeBase.id)
    ).first()
    if row is None or row[0].owner_id != owner_id:
        # 查不到 / 不属于当前用户，一律 404（不泄露存在性，与 /apps 一致）
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found")
    return row[0], row[1]


def _is_supported_document(file_name: str, mime_type: str) -> bool:
    """允许的类型：扩展名 `.txt` / `.md` / `.markdown`，或 `content-type` 以 `text/` 开头。"""
    lower = file_name.lower()
    if any(lower.endswith(extension) for extension in ALLOWED_EXTENSIONS):
        return True
    return mime_type.startswith("text/")


async def _embed_or_bad_request(texts: list[str]) -> list[list[float]]:
    """嵌入失败：`RunError` 在对外的普通 JSON 接口里映射为 400 规范文案。"""
    try:
        return await embed_texts(texts)
    except RunError as error:
        raise _bad_request(str(error)) from error
    except Exception as error:  # noqa: BLE001 - 与 api-ts 的兜底一致
        raise _bad_request("embedding request failed: unknown") from error


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _to_knowledge_base_response(kb: KnowledgeBase, document_count: int) -> dict[str, Any]:
    return {
        "id": kb.id,
        "name": kb.name,
        "description": kb.description,                 # ← 可能为 None → JSON null
        "documentCount": int(document_count),
        "createdAt": iso_z(kb.created_at),
        "updatedAt": iso_z(kb.updated_at),
    }


def _to_document_response(document: Document) -> dict[str, Any]:
    return {
        "id": document.id,
        "knowledgeBaseId": document.knowledge_base_id,
        "name": document.name,
        "mimeType": document.mime_type,
        "sizeBytes": document.size_bytes,
        "status": document.status,
        "errorMessage": document.error_message,        # ← 可能为 None → JSON null
        "chunkCount": document.chunk_count,
        "createdAt": iso_z(document.created_at),
    }
```

**这段在干什么**（按调用链拆开看）：

1. **归属校验统一走 `_find_owned`**：先按 id 查，再比对 `owner_id`；查不到与不属于自己**都返回 404 `Knowledge base not found`**（不泄露「这个 id 是否存在」）。删文档时还额外限定 `document.knowledge_base_id == kb_id`，防止「用 A 库的 id 删 B 库的文档」。
2. **列表用 `outerjoin + func.count`**：没有文档的知识库也要出现在列表里（`documentCount: 0`），所以必须是 LEFT JOIN，不能是 INNER JOIN。
3. **上传是「先校验、再嵌入、最后一次性写库」**：类型 → 大小 → 解码 → 空内容 → 切分 → 嵌入 → 插入 documents + chunks → 更新 `chunk_count` → `commit`。任何一步抛错，事务都不会提交。
4. **`db.flush()` 不是 `commit()`**：它把 document 的 INSERT 发给数据库（拿到同一事务内的可见性），但事务仍然开放；随后 chunks 的 INSERT 与 `chunk_count` 的 UPDATE 都在**同一个事务**里，最后一起提交。
5. **向量写入用原生 SQL**：`INSERT ... CAST(:embedding AS vector)`，向量先序列化成 `[0.1,0.2,...]` 文本再强转。这样和 TS 的 `::vector` 写法在语义上完全同构。
6. **检索 SQL 与 TS 逐项同构**：`1 - (c.embedding <=> CAST(:embedding AS vector)) AS score`；`ORDER BY` 用**距离升序**（= 分数降序）；`WHERE` 先按 `knowledge_base_id` 过滤，再排序取 `topK`。
7. **出参映射**：时间走 `iso_z`（UTC + 毫秒 + `Z`），空值原样输出 `null`，字段名用契约的 camelCase。

**与 TS 对照**

| 关注点 | TS `kb.service.ts` | Python `service.py` | 机制差异 |
| --- | --- | --- | --- |
| 事务 | `prisma.$transaction(async (tx) => {...})` | `db.flush()` + 最后 `db.commit()` | Prisma 显式事务回调；SQLAlchemy 用 Session 的隐式事务 |
| 批量插入 | 循环 `tx.$executeRaw` | 循环 `db.execute(text(...))` | 都是「一条 chunk 一条 INSERT」 |
| 向量写入 | `${literal}::vector` | `CAST(:embedding AS vector)` | `::` 在 Prisma 模板里安全，在 SQLAlchemy `text()` 里是坑（5.3） |
| 检索 | `$queryRaw` 模板字符串 | `text()` + 绑定参数字典 | 都**不拼接用户输入** |
| 计数 | Prisma `_count` | `func.count` + `outerjoin` / `group_by` | ORM 抽象层级不同 |
| 空文档判断 | `content.trim() === ''` | `content.strip() == ""` | 语义相同 |
| 解码 | `file.buffer.toString('utf8')` | `raw.decode("utf-8", errors="replace")` | 都用 U+FFFD 替换非法字节 |
| 错误 | `throw new BadRequestException(...)` | `raise HTTPException(400, detail=...)` | 统一由异常处理器转错误信封 |

**写错会怎样**：

- **`ORDER BY` 写成 `DESC`**：会取到「最不相关」的 topK。`score` 是 `1 - 距离`，距离越小越相关，所以必须按距离**升序**。
- **忘记 `WHERE c.knowledge_base_id = :kb_id`**：会跨知识库检索，把别人的文档召回来——这是**越权**，不只是排序问题。
- **在 Python 侧拼接 SQL 字符串**（`f"... {literal} ..."`）：向量字面量虽由数字组成，但一旦有人把 `content` 或 `query` 拼进去就是注入；本项目所有可变值都走绑定参数。
- **`db.commit()` 放到 `db.flush()` 的位置**：document 先提交，后续 chunks 插入失败会留下「有文档、无分块」的脏数据。

### 4.5 `apps/api-py/app/api/kb.py`（上传与检索路由）

**完整文件路径：`apps/api-py/app/api/kb.py`（节选：与文件上传 / 检索直接相关的部分）**

```python
"""`/knowledge-bases*` 路由 —— 契约见 packages/contract/openapi.yaml（阶段 7）。"""

from datetime import datetime

from fastapi import APIRouter, Depends, File, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.rag import service
from app.timefmt import iso_z

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])


class RetrievalHit(BaseModel):
    """对应契约 `RetrievalHit`（余弦相似度，越大越相关）。"""

    model_config = ConfigDict(extra="forbid")          # ← 禁止多余字段（≈ additionalProperties: false）

    documentId: str
    documentName: str
    chunkIndex: int
    content: str
    score: float


class SearchKnowledgeBaseRequest(BaseModel):
    """对应契约 `SearchKnowledgeBaseRequest`。"""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=2000)  # ← 长度约束（越界 → 400 契约文案）
    topK: int | None = Field(default=None, ge=1, le=20) # ← 可缺省；缺省时服务层用 4


@router.post(
    "/{id}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="uploadDocument",
)
async def upload_document(
    id: str,
    file: UploadFile | None = File(default=None),      # ← 字段名必须叫 file（与前端 form.append('file', ...) 对齐）
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

**这段在干什么**：

- `router = APIRouter(prefix="/knowledge-bases", ...)`：与其它资源一样按前缀分组，`main.py` 里 `app.include_router(kb_router)` 挂载。
- `file: UploadFile | None = File(default=None)`：FastAPI 从 **`multipart/form-data`** 里按字段名 `file` 取文件。**字段名就是契约的一部分**——前端写 `form.append('file', file)`，两端都认这一个名字。
- 路由声明为 `async def`：因为 `UploadFile.read()` 是**协程**（见 5.2），且嵌入调用需要 `await`。
- `SearchKnowledgeBaseRequest` 的 `topK` 是 `int | None`，`Field(ge=1, le=20)` 做边界校验；缺省时服务层回落到 4。
- 其余 CRUD 路由（`GET /knowledge-bases`、`POST /knowledge-bases`、`DELETE /{id}`、`GET /{id}/documents`、`DELETE /{id}/documents/{documentId}`）与阶段 2 / 5 的写法同构，全部 `Depends(get_current_user)` + `Depends(get_db)`，此处不重复贴。

### 4.6 `apps/api-py/app/engine/nodes/knowledge.py`

**完整文件路径：`apps/api-py/app/engine/nodes/knowledge.py`**

```python
"""`knowledge` 节点（阶段 7）。

与 api-ts 的 `apps/api-ts/src/engine/nodes/knowledge.node.ts` 对齐：
渲染 `data.query` → 嵌入 → 按余弦相似度检索 → 发一次 `retrieval`。
"""

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.orm import Session

from app.engine.template import render_template          # ← 复用阶段 4 的模板解析
from app.rag.embedding import embed_texts
from app.rag.service import search_chunks

# `knowledge.data.topK` 的默认值（与契约 `default: 4` 一致）
DEFAULT_KNOWLEDGE_TOP_K = 4

EmitRetrieval = Callable[[list[dict[str, Any]], int], Awaitable[None]]   # ← 异步回调的类型别名


async def run_knowledge_node(
    node: dict[str, Any],
    pool: dict[str, Any],
    db: Session,
    emit_retrieval: EmitRetrieval,
) -> dict[str, Any]:
    """执行 `knowledge` 节点：检索一次并发出一次 `retrieval` 事件。"""
    data: dict[str, Any] = node["data"]
    query = render_template(data["query"], pool)          # ← 例如 "{{ inputs.topic }}" → 用户输入
    top_k = _top_k_of(data)

    [vector] = await embed_texts([query])                 # ← 单条也走批量接口；解包取第 0 个
    hits = search_chunks(db, data["knowledgeBaseId"], vector, top_k)
    await emit_retrieval(hits, top_k)                      # ← 每次节点执行只发一次

    return {
        "chunks": hits,
        "context": "\n\n".join(hit["content"] for hit in hits),   # ← 两端逐字节一致的拼接
    }


def _top_k_of(data: dict[str, Any]) -> int:
    """`topK` 缺省为 4（与 api-ts 的 `typeof data.topK === 'number'` 对齐）。"""
    value = data.get("topK")
    if isinstance(value, int) and not isinstance(value, bool):   # ← bool 是 int 子类，必须排除
        return value
    return DEFAULT_KNOWLEDGE_TOP_K
```

**这段在干什么**：

- `render_template` 把 `data.query` 里的 `{{ inputs.topic }}` 等占位符替换成变量池里的值（阶段 4 · 03 已讲）。
- `[vector] = await embed_texts([query])`：嵌入接口是批量的，这里只传一条；用**列表解包**直接拿唯一的元素。若写成 `vector = await embed_texts([query])`，后面 `search_chunks` 会收到一个「列表的列表」，PostgreSQL 会报维度错误。
- `search_chunks` 是 4.4 里那个函数：`WHERE knowledge_base_id = :kb_id` + 余弦距离排序 + `LIMIT`。
- `await emit_retrieval(hits, top_k)` 把检索结果交给引擎，由引擎组装 `retrieval` 事件（payload 含 `nodeId` / `knowledgeBaseId` / `topK` / `hits`）。
- 返回 `{chunks, context}`：`chunks` 与 `retrieval.hits` 相同；`context` 是各块 `content` 用 `"\n\n"` 连接——下游 `llm` 节点用 `{{ knowledge_1.context }}` 把它拼进提示词。

**写错会怎样**：

- **先发 `retrieval` 再检索**：事件里的 `hits` 会是空的；契约要求「检索完成后发一次」。
- **`context` 用别的分隔符**（如 `"\n"`）：两端 `context` 长度、内容全变，`05-验收.md` L7 的 `len=1211` 对不上。
- **`topK` 直接 `int(data.get("topK"))`**：`None` 会抛 `TypeError`，字符串 `"4"` 会被转成 4（与「只接受整数」的预检语义不一致）。

---

## 5. 【技术教学 A · 首次】Python 侧对齐

### 5.1 `pgvector.sqlalchemy.Vector(1536)` 与 Prisma `Unsupported("vector(1536)")`

**先讲 pgvector 是什么**：PostgreSQL 本身不认识「向量」，是 `pgvector` 扩展给它加了一个类型 `vector(n)`（n 维浮点数组）和几个运算符：

| 运算符 | 含义 |
| --- | --- |
| `<=>` | 余弦距离（`1 - cosineSimilarity`），范围 `[0, 2]` |
| `<->` | L2 距离 |
| `<#>` | 负内积 |

本项目的 `score = 1 - (embedding <=> query)`，所以 `<=>` 越小、`score` 越大。**HNSW 索引用 `vector_cosine_ops`**，与 `<=>` 匹配。

**两种 ORM 的映射方式**

```python
# Python：有原生类型
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import Mapped, mapped_column

embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
```

```prisma
// Prisma：没有原生类型，只能声明为 Unsupported
embedding Unsupported("vector(1536)")?
```

**这段在干什么**：

- `Vector(1536)` 是 `pgvector` 提供的 SQLAlchemy 自定义类型：它知道「这个列是 1536 维向量」，能绑定 `list[float]`、能读出 `list[float]`，也能配合 `.cosine_distance()` 之类的比较器（本项目没用，见下）。
- `Unsupported(...)` 是 Prisma 的「**逃生舱**」：它让 `schema.prisma` 能描述一个 Prisma 不认识的列（否则 `prisma migrate` 会想删掉它），但**生成的 Prisma Client 不会包含这个字段**——你无法 `prisma.chunk.findMany({ select: { embedding: true } })`，也无法用它做 `where` / `orderBy`。

| 维度 | Prisma | SQLAlchemy | 后果 |
| --- | --- | --- | --- |
| 类型认知 | ❌ `Unsupported` | ✅ `Vector(1536)` | TS 侧读写向量**必须** `$executeRaw` / `$queryRaw` |
| Client 是否含该字段 | ❌ 被排除 | ✅ 属性存在 | TS 拿不到强类型，只能自己声明 `unknown[]` |
| 能否用 ORM `orderBy` 距离 | ❌ | ✅（可用 `cosine_distance`） | 两端都选了**原生 SQL**，保证 SQL 逐项同构 |
| 维度校验 | 数据库层（插入时） | 类型层 + 数据库层 | Python 还能在建模型时看出 1536 |
| 迁移 | Prisma 迁移（手写 `vector(1536)` + HNSW） | 不产生 DDL | 迁移所有权仍在 Prisma |

**为什么 Python 有原生类型，本项目却还用原生 SQL？**

1. **与 TS 保持同一份 SQL 形状**：检索的 `1 - (embedding <=> :emb) AS score` 用 ORM 表达会变成另一套写法，两端就不容易逐项对照。
2. **插入要 `CAST(... AS vector)`**：Prisma 侧必须 `::vector`，Python 侧用 `CAST` 对齐；如果一边用 ORM 的 `Vector` 绑定、一边用字符串强转，参数序列化方式不同，容易在浮点格式上产生差异。
3. **`Vector` 映射仍然是必要的**：它让「表结构」在 Python 侧可读、可类型检查；也防止有人误把它当 `String` 处理。

> **一句话**：**Python 有「原生类型」，TS 只有「逃生舱」；但本项目为了两端 SQL 同构，读写都走原生 SQL——`Vector(1536)` 负责「认识列」，`text()` 负责「对齐行为」。**

### 5.2 `UploadFile` + `python-multipart`（对照 NestJS `FileInterceptor` / multer）

**multipart/form-data 是什么**：浏览器上传文件时，会把请求体切成若干「part」，每个 part 有自己的头（`Content-Disposition: form-data; name="file"; filename="..."`）和内容。普通 `application/json` 只有一个 JSON 体，**不能**承载文件。

**FastAPI 侧**：

```python
from fastapi import File, UploadFile

@router.post("/{id}/documents")
async def upload_document(
    id: str,
    file: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ...
```

**这段在干什么**：

- `UploadFile` 是 FastAPI 对「上传文件」的抽象：带 `filename` / `content_type` / `file`（底层 `SpooledTemporaryFile`），并提供 **`await file.read()`**（异步读全部字节）。
- `File(default=None)` 表示「这个字段可缺省」；缺省时 `file is None`，路由返回 `Document is empty`。若写成 `file: UploadFile`（无默认值），缺字段会先被 Pydantic 拦成 400 校验错误，文案就不是契约里的那条。
- **必须安装 `python-multipart`**：FastAPI 解析 multipart 依赖它；没装时启动/调用会报 `Form data requires "python-multipart" to be installed`。本项目已把它写进 `pyproject.toml`。
- **路由必须是 `async def`**：`UploadFile.read()` 是协程；在普通 `def` 里 `await` 会直接语法错误（`00-项目初始化/00` §4.12）。若坚持同步，只能读 `file.file.read()`（底层同步文件对象），但那样会绕开 FastAPI 的异步封装。

**与 NestJS / multer 对照**

```ts
// NestJS：FileInterceptor 在进入 handler 之前就把文件读进内存
@Post(':id/documents')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
@UseFilters(UploadTooLargeFilter)
upload(@UploadedFile() file: Express.Multer.File | undefined) {
  // file.buffer 已经是完整字节
}
```

| 关注点 | NestJS + multer | FastAPI + `UploadFile` | 机制差异（重点） |
| --- | --- | --- | --- |
| 解析器 | `FileInterceptor('file')` | `File(default=None)` | 字段名都必须与前端 `form.append` 一致 |
| 大小上限 | `limits.fileSize` **在解析时**拦截 | **无内置上限**；`await file.read()` 后自己 `len(raw)` 判断 | FastAPI 会先把整个文件读进来，**超限也读**；生产需在反向代理 / 中间件层限制 body 大小 |
| 超限错误 | multer 抛 `LIMIT_FILE_SIZE`，由 `UploadTooLargeFilter` 归一 | 服务层 `raise _bad_request("Document too large")` | 最终文案一致，拦截时机不同 |
| 文件内容 | `file.buffer`（内存） | `await file.read()`（可能落盘，`SpooledTemporaryFile`） | 大文件在 Py 侧可能先落临时文件 |
| 文件名 | `file.originalname` | `file.filename` | 命名不同 |
| MIME | `file.mimetype` | `file.content_type` | 命名不同 |
| 空文件 | `file === undefined` 或 `size === 0` | `file is None` 或 `len(raw) === 0` | 语义相同 |

**写错会怎样**：

- **没装 `python-multipart`**：应用启动或首次上传就报错，所有上传 500。
- **路由写成 `def`（同步）**：`await file.read()` 语法错误；改成 `file.file.read()` 虽然能跑，但会阻塞事件循环（见 5.6）。
- **只看 `file is None`、不看 `content.strip()`**：空文件 / 全空白文件会进入切分，得到 0 个 chunk，最后仍要报 `Document is empty`；本项目在切分前后各兜一次。
- **把大小检查放在 `await file.read()` 之前**：`UploadFile` 虽有 `size` 实例属性，但它可能为 `None`（multipart 解析器没拿到长度时），且 FastAPI **不会**据此拦截；权威大小必须用读完后的 `len(raw)`。multer 则是解析阶段就按 `limits.fileSize` 拒绝——这是两套框架的真实差异。

### 5.3 `text()` 原生 SQL：参数绑定与 `::vector` 的坑

**要写什么 SQL**：

```sql
INSERT INTO chunks (..., embedding, ...)
VALUES (..., CAST(:embedding AS vector), ...);

SELECT ..., 1 - (c.embedding <=> CAST(:embedding AS vector)) AS score
FROM chunks c ...
WHERE c.knowledge_base_id = :kb_id
ORDER BY c.embedding <=> CAST(:embedding AS vector)
LIMIT :top_k;
```

**这段在干什么**：

- `:embedding` / `:kb_id` / `:top_k` 是 SQLAlchemy 的**绑定参数**占位符；`db.execute(text(sql), {...})` 的第二个参数是「名字 → 值」的字典。
- 绑定参数由驱动做类型安全的转义，**不是字符串拼接**——即使 `query` 里带引号、分号，也不会改变 SQL 结构。
- `CAST(:embedding AS vector)` 把「文本字面量 `[0.1,0.2,...]`」转成 `vector(1536)`；`to_vector_literal` 负责生成这个文本。
- `ORDER BY` 与 `SELECT` 里各写一次 `<=>`，两次都用同一个绑定值；PostgreSQL 不会因为写了两次就多算一遍（优化器会处理）。

**为什么不用 `:emb::vector`**

很多人第一反应是写 PostgreSQL 的原生强制转换：

```sql
-- ❌ 在 SQLAlchemy text() 里是坑
... 1 - (c.embedding <=> :emb::vector) AS score ...
```

**原因**：SQLAlchemy 的 `text()` 用「冒号 + 名字」识别绑定参数，但它的规则是「冒号后面**不能**紧跟另一个冒号」；`::` 被视为「转义的字面冒号」。于是 `:emb::vector` 里的 `:emb` **不会**被识别成绑定参数，SQL 会原样带着 `:emb::vector` 发给 PostgreSQL，PostgreSQL 不认识 `:emb`，报 `syntax error at or near ":"`。（可以自测：`text("... <=> :emb::vector")` 的 `_bindparams` 是空的。）

**正确写法**：用标准 SQL 的 `CAST(... AS ...)`，把「冒号只出现在绑定参数上」这条规则守住。

| 写法 | 谁认 | 结果 |
| --- | --- | --- |
| `${literal}::vector` | Prisma `$executeRaw` 模板 | ✅ TS 侧可用（模板里 `::` 不冲突） |
| `:emb::vector` | SQLAlchemy `text()` | ❌ `::` 被当转义，绑定失败 |
| `CAST(:emb AS vector)` | SQLAlchemy `text()` | ✅ 本项目写法 |

**绑定向量为什么要先转字符串**：`pgvector` 的 Python 驱动可以绑定 `list[float]`，但本项目为了让两端「发出去的 SQL 形状」一致，统一用文本字面量 `[0.1,0.2,...]` 再 `CAST`。`to_vector_literal` 用的是 `str(value)`——Python 的浮点 `str()` 与 JS 的 `String()` 在大多数值上一致，这是 `05-验收.md` L6「score 全精度相同」的前提之一。

**写错会怎样**：

- **`LIMIT :top_k` 写成 f-string**：`topK` 虽来自校验过的整数，但一旦有人把 `query` 或 `kb_id` 也拼进去，就是注入入口；本项目**所有**可变值都绑定。
- **把 `LIMIT` 写成 `LIMIT 4` 常量**：`topK` 参数失效，`knowledge` 节点的 `topK` 永远是 4。
- **`ORDER BY ... DESC`**：取到最不相关的块（见 4.4）。
- **`WHERE` 忘了 `knowledge_base_id`**：跨库检索，越权。

### 5.4 `check_embedding_ctx_length=False`

> 「为什么需要这个开关」在 `02-文档切分与向量化.md` 已从切分 / 嵌入视角讲过；本节只补 **Python `langchain-openai` 的实现细节**，不重复登记。

**问题**：`OpenAIEmbeddings` 默认会在**本地**用 `tiktoken` 把文本分词，先算 token 数、检查是否超过模型上下文，再发请求。它需要知道「模型名 → 编码表」的映射。

**真实报错**：当 `EMBEDDING_MODEL=mock-embedding`（或任何非 OpenAI 官方模型名）时，`tiktoken.encoding_for_model("mock-embedding")` 找不到对应编码，抛 `KeyError` / `ValueError`，上传接口直接 400，文案却不是契约里的任何一条。

```python
client = OpenAIEmbeddings(
    ...,
    check_embedding_ctx_length=False,   # ← 关掉本地预分词
)
```

**这段在干什么**：`False` 表示「**不做本地 token 预检**」，把原文直接发给 provider，由 provider 自己决定怎么分词、是否超限。

| 取值 | 行为 | 适用 |
| --- | --- | --- |
| `True`（默认） | 本地 tiktoken 分词 + 上下文检查 | 只用 OpenAI 官方模型名 |
| `False` | 直接发请求 | 自定义 / 兼容 provider（mock、通义、本地部署等） |

**代价**：放弃了客户端「提前发现超长」的能力。本项目每块最多 500 字符，远小于任何嵌入模型的上下文，所以这个代价可以接受；真正需要长文本时，应该在切分阶段控制，而不是依赖客户端预检。

> 注意：这是 **Python `langchain-openai`** 的参数名（snake_case）；TS 侧对应概念叫 `checkEmbeddingContextLength`，本项目 TS 侧未显式设置。两端最终都只关心「请求体里的 `input` 是原文」，所以**不要**在 Python 侧把文本预先截断——那会让两端向量不同。

### 5.5 读配置必须走 `settings`：pydantic-settings 不回写 `os.environ`

**先看 `config.py`**：

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")

    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_timeout_ms: int = 60000
    embedding_model: str = "text-embedding-3-small"

settings = Settings()          # ← 模块导入时读一次 .env
```

**这段在干什么**：

- `Settings()` 在**导入时**读 `apps/api-py/.env`，把值填进 `settings` 对象。
- `env_file` 用 `Path(__file__).resolve().parent.parent` 推导出的**绝对路径**，所以从仓库根启动也能读到（阶段 0 的坑，已修）。
- `extra="ignore"` 让 `.env` 里多出来的键（如 `POSTGRES_*`）不报错。

**关键事实（项目真实踩过）**：

> **pydantic-settings 只把 `.env` 读进 `Settings` 对象，不会写回 `os.environ`。**

所以：

```python
# ❌ 错误：读不到 .env 里的值（除非启动进程时真的 export 过）
import os
api_key = os.environ.get("LLM_API_KEY", "")

# ✅ 正确：从 Settings 读
from app.config import settings
api_key = settings.llm_api_key
```

阶段 6 就因为这个坑，`.env` 里的 `MAX_TOOL_ROUNDS` 被静默忽略（`INDEX.md` 已知遗留有记录）。阶段 7 的 `embedding.py` 从一开始就只读 `settings.*`，不再重蹈覆辙。

| 读取方式 | 能看到 `.env` | 能看到 shell 环境变量 | 类型转换 |
| --- | --- | --- | --- |
| `settings.llm_api_key` | ✅ | ✅（环境变量优先） | ✅（按注解转 int / str） |
| `os.environ["LLM_API_KEY"]` | ❌ | ✅ | ❌（永远是字符串） |
| `os.getenv(..., default)` | ❌ | ✅ | ❌ |

**写错会怎样**：

- 用 `os.environ` 读嵌入模型：`.env` 里写了 `EMBEDDING_MODEL=mock-embedding`，代码却回落到 `text-embedding-3-small`，请求打到真实 OpenAI（或 mock 返回的模型名对不上），维度可能仍对，但**两端用的模型不一致**，分数自然不同。
- 在 `Settings` 里加字段却忘了给默认值：`.env` 缺这个键时启动直接报 `ValidationError`，整条 Python 线起不来。
- 改了 `.env` 不重启：`Settings()` 只在导入时读一次；uvicorn `--reload` 会重启进程，但如果你手动起进程，必须重启才生效。

### 5.6 `async def` 路由里用同步 SQLAlchemy `Session`

**现状**：`kb.py` 的上传 / 检索路由是 `async def`，但 `service.py` 内的 `db.execute` / `db.commit` 是**同步**的 SQLAlchemy 调用。

**这为什么能跑**：SQLAlchemy 的 `Session` 是同步对象；它在**当前线程**里执行数据库 I/O（底层 psycopg 同步驱动）。FastAPI 对 `async def` 路由直接在事件循环里调用，所以这些同步 I/O 会**短暂阻塞事件循环**。

**必须记住的三条**：

1. **`Session` 不是线程安全的，也不是「可并发」的**：同一个 `Session` 不能被两个协程同时使用。本项目的 `db` 由 `Depends(get_db)` 为**每个请求**创建，生命周期与请求一致，不存在跨请求共享。
2. **`await` 期间不要再用同一个 `Session`**：`await file.read()` / `await embed_texts(...)` 会让出事件循环，但**不会**有别的协程拿到这个 `Session`（它只属于当前请求）；只要不在 `await` 前后开新任务共用它，就是安全的。
3. **长事务 / 大查询会卡住整个进程**：上传要跑「嵌入 + N 条 INSERT」，如果 provider 很慢，`await` 阶段还好（让出循环）；但 `db.execute` 的同步 I/O 会阻塞。当前每篇文档最多几十条 chunk，影响可接受；要彻底解决，可把同步 DB 操作放进线程池：

```python
# 最小示例 · 非项目文件：把同步 DB 调用丢进线程池（FastAPI 自带）
from starlette.concurrency import run_in_threadpool

rows = await run_in_threadpool(db.execute, stmt)
```

**本项目为什么保持现状**：

- 与阶段 1~6 的写法一致（`apps.py` 等同步路由用 `def`，FastAPI 自动放线程池；只有需要 `await` 的路由才 `async def`）。
- 上传必须 `async`（`UploadFile.read()` 与嵌入都是异步），而 DB 操作只占很小一段时间；为了教学简洁，不在这一阶段引入线程池封装。
- `get_db` 的 `Session` 在请求结束时由 `with` 自动关闭（`00-项目初始化/00` §4.13）。

| 写法 | 是否阻塞事件循环 | 适用 |
| --- | --- | --- |
| `def` 路由 + 同步 Session | ❌（FastAPI 丢线程池） | 纯 CRUD（阶段 2 / 5） |
| `async def` 路由 + 同步 Session | ⚠️ 短暂阻塞 | 需要 `await` 文件 / 网络，DB 操作很短（本篇） |
| `async def` 路由 + `run_in_threadpool` | ❌ | 同步 DB 操作较重 |
| `async def` 路由 + `AsyncSession` | ❌ | 全异步栈（本项目未引入） |

**写错会怎样**：

- **把 `db` 传给 `asyncio.create_task` 里的另一个协程**：两个协程并发用同一个 `Session`，轻则状态错乱，重则 `This session is provisioning a new connection; concurrent operations are not permitted`。
- **在 `await` 前 `db.flush()`、`await` 后忘记提交**：请求结束 `get_db` 关闭 Session，未提交事务回滚，上传「成功返回」但库里没有数据。
- **把上传路由改成 `def`**：`await file.read()` 直接语法错误；如果改用 `file.file.read()`，同步读文件会阻塞事件循环。

### 5.7 本篇首次出现的 Python 机制（速查）

| 机制 | 写法 | 对应 TS | 一句话解释 |
| --- | --- | --- | --- |
| pgvector 原生类型 | `mapped_column(Vector(1536))` | `Unsupported("vector(1536)")` | Python 认识向量列，Prisma 只声明「存在」 |
| 文件上传参数 | `UploadFile` + `File(default=None)` | `@UploadedFile() file` | 从 multipart 的 `file` 字段取文件，字段可缺省 |
| 异步读文件 | `raw = await file.read()` | `file.buffer` | `UploadFile.read()` 是协程，路由必须 `async def` |
| 原生 SQL 绑定 | `db.execute(text(sql), {"embedding": literal, ...})` | `$queryRaw` 模板 / `$executeRaw` | `:name` 是绑定参数，不是字符串拼接 |
| 标准类型转换 | `CAST(:embedding AS vector)` | `::vector` | 避开 SQLAlchemy `text()` 对 `::` 的转义规则 |
| 事务内可见 | `db.flush()` | `tx.document.create()` | 发 INSERT 但不提交，后续同一事务可见 |
| 数据库级联删除 | `relationship(..., passive_deletes=True)` | Prisma 无需声明 | 让 ORM 不发 `UPDATE 子表 SET 外键 = NULL`，把删除交给数据库 `ON DELETE CASCADE` |
| 聚合计数 | `select(KB, func.count(Document.id)).outerjoin(...).group_by(KB.id)` | `include: { _count: { select: { documents: true } } }` | LEFT JOIN + COUNT，没有文档也要出现 |
| 批量嵌入 | `await client.aembed_documents(texts)` | `client.embedDocuments(texts)` | `a` 前缀 = async |
| 维度守卫 | `if not isinstance(v, list) or len(v) != 1536` | `vector.length !== 1536` | 运行期兜底，不能让错维向量进 `vector(1536)` |
| `bool` 是 `int` 子类 | `isinstance(x, int) and not isinstance(x, bool)` | `typeof x === 'number' && Number.isInteger(x)` | 校验 `topK` 时必须排除 `True/False` |
| 异步回调类型 | `Callable[[list[dict], int], Awaitable[None]]` | `(hits, topK) => Promise<void>` | 给 `emit_retrieval` 标注形状 |
| 字节解码替换 | `raw.decode("utf-8", errors="replace")` | `buffer.toString('utf8')` | 非法字节统一变 U+FFFD |
| 列表解包 | `[vector] = await embed_texts([query])` | `const [vector] = await embedTexts([query])` | 批量接口只传一条时直接取唯一元素 |
| 字符串后缀 | `name.removesuffix('.txt')` | `name.replace(/\.txt$/, '')` | 验收脚本拼 `文件名#分块号` 用 |

---

## 6. 前端完整代码

### 6.1 `apps/web/app/knowledge/page.tsx`（知识库页）

**完整文件路径：`apps/web/app/knowledge/page.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'

type KnowledgeBase = {
  id: string
  name: string
  description: string | null
  documentCount: number
  createdAt: string
  updatedAt: string
}

type DocumentItem = {
  id: string
  knowledgeBaseId: string
  name: string
  mimeType: string
  sizeBytes: number
  status: 'ready' | 'failed'
  errorMessage: string | null
  chunkCount: number
  createdAt: string
}

type RetrievalHit = {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  score: number
}

type SearchResponse = {
  query: string
  topK: number
  hits: RetrievalHit[]
}

/** 读取后端错误体里的 `message`（可能为字符串数组，如 DTO 校验失败）。 */
async function readErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null
  if (body?.message === undefined) return `HTTP ${res.status}`
  return Array.isArray(body.message) ? body.message.join('; ') : body.message
}

/** 字节数转友好单位：B / KB / MB。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN')
}

/** 知识库页：KB 列表 / 新建 / 删除；详情内上传、删除文档与检索调试。 */
export default function KnowledgePage() {
  const router = useRouter()

  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 选中某个知识库后进入详情视图；null 表示列表视图。
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  // 上传/删除后自增，触发文档列表重新拉取。
  const [docsTick, setDocsTick] = useState(0)

  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [topKText, setTopKText] = useState('4')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null)
  // 命中内容的展开状态，key 为 `${documentId}:${chunkIndex}`。
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadKbs = useCallback(async (): Promise<void> => {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    const res = await fetch(`${API_BASE}/knowledge-bases`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (!res.ok) throw new Error(await readErrorMessage(res))
    const data = (await res.json()) as { items: KnowledgeBase[] }
    setKbs(data.items)
  }, [router])

  useEffect(() => {
    let cancelled = false
    loadKbs()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadKbs])

  // 选中知识库后加载文档列表；docsTick 变化时重新拉取。
  useEffect(() => {
    if (selectedId === null) {
      setDocuments([])
      setDocsLoading(false)
      setDocsError(null)
      return
    }
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    let cancelled = false
    setDocsLoading(true)
    setDocsError(null)
    fetch(`${API_BASE}/knowledge-bases/${selectedId}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/login')
          return null
        }
        if (!res.ok) throw new Error(await readErrorMessage(res))
        return (await res.json()) as { items: DocumentItem[] }
      })
      .then((data) => {
        if (!cancelled && data !== null) setDocuments(data.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setDocsError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setDocsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, docsTick, router])

  function openKb(id: string): void {
    setSelectedId(id)
    setDocsTick(0)
    setFile(null)
    setUploadError(null)
    setQuery('')
    setTopKText('4')
    setSearchResult(null)
    setSearchError(null)
    setExpanded(new Set())
    if (fileInputRef.current !== null) fileInputRef.current.value = ''
  }

  function backToList(): void {
    setSelectedId(null)
    setSearchResult(null)
    setSearchError(null)
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setCreateError(null)
    setCreating(true)
    try {
      const res = await fetch(`${API_BASE}/knowledge-bases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: createName,
          description: createDescription === '' ? undefined : createDescription,
        }),
      })
      if (res.status === 401) {
        router.replace('/login')
        return
      }
      if (!res.ok) {
        setCreateError(await readErrorMessage(res))
        return
      }
      setCreateName('')
      setCreateDescription('')
      await loadKbs()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteKb(id: string): Promise<void> {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setError(null)
    const res = await fetch(`${API_BASE}/knowledge-bases/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (!res.ok) {
      setError(await readErrorMessage(res))
      return
    }
    if (selectedId === id) backToList()
    await loadKbs().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

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
        setUploadError(await readErrorMessage(res))
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

  async function handleDeleteDocument(documentId: string): Promise<void> {
    if (selectedId === null) return
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setDocsError(null)
    const res = await fetch(`${API_BASE}/knowledge-bases/${selectedId}/documents/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (!res.ok) {
      setDocsError(await readErrorMessage(res))
      return
    }
    setDocsTick((tick) => tick + 1)
    await loadKbs().catch(() => undefined)
  }

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
        setSearchError(await readErrorMessage(res))
        return
      }
      setSearchResult((await res.json()) as SearchResponse)
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  function toggleExpanded(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const selectedKb = kbs.find((kb) => kb.id === selectedId) ?? null

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>知识库</h1>
        <a href="/apps">返回「应用」</a>
      </div>
      <p>
        后端：<code>{API_BASE}</code>
      </p>

      {error !== null && <p style={{ color: 'crimson' }}>操作失败：{error}</p>}
      {loading && <p>加载中…</p>}

      {selectedId === null && (
        <>
          <h2>新建知识库</h2>
          <form onSubmit={handleCreate} style={{ display: 'grid', gap: 8, maxWidth: 360, marginBottom: 24 }}>
            <label>
              名称
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                required
                maxLength={80}
                style={{ display: 'block', width: '100%' }}
              />
            </label>
            <label>
              描述（可选）
              <input
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                maxLength={500}
                style={{ display: 'block', width: '100%' }}
              />
            </label>
            <button type="submit" disabled={creating}>
              {creating ? '创建中…' : '新建知识库'}
            </button>
          </form>
          {createError !== null && <p style={{ color: 'crimson' }}>创建失败：{createError}</p>}

          <h2>知识库列表</h2>
          {!loading && kbs.length === 0 && <p>暂无知识库。</p>}
          {kbs.length > 0 && (
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 900 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={cellStyle}>名称</th>
                  <th style={cellStyle}>描述</th>
                  <th style={cellStyle}>文档数</th>
                  <th style={cellStyle}>创建时间</th>
                  <th style={cellStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {kbs.map((kb) => (
                  <tr key={kb.id}>
                    <td style={cellStyle}>
                      <strong>{kb.name}</strong>
                    </td>
                    <td style={cellStyle}>{kb.description ?? '—'}</td>
                    <td style={cellStyle}>{kb.documentCount}</td>
                    <td style={cellStyle}>{formatTime(kb.createdAt)}</td>
                    <td style={cellStyle}>
                      <button onClick={() => openKb(kb.id)}>打开</button>{' '}
                      <button onClick={() => void handleDeleteKb(kb.id)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {selectedId !== null && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <button onClick={backToList}>返回列表</button>
            <h2 style={{ margin: 0 }}>{selectedKb?.name ?? '知识库详情'}</h2>
            <button onClick={() => void handleDeleteKb(selectedId)}>删除知识库</button>
          </div>
          {selectedKb?.description !== null && selectedKb?.description !== undefined && (
            <p style={{ color: '#555' }}>{selectedKb.description}</p>
          )}
          <p style={{ color: '#888', fontSize: 13 }}>
            文档数：{selectedKb?.documentCount ?? documents.length} · 创建于{' '}
            {selectedKb === null ? '—' : formatTime(selectedKb.createdAt)}
          </p>

          <h3>文档</h3>
          <form
            onSubmit={handleUpload}
            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,text/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
            <button type="submit" disabled={uploading || file === null}>
              {uploading ? '上传中…' : '上传文档'}
            </button>
            <span style={{ fontSize: 12, color: '#888' }}>支持 .txt / .md / .markdown，≤ 1MB</span>
          </form>
          {uploadError !== null && <p style={{ color: 'crimson' }}>上传失败：{uploadError}</p>}
          {docsError !== null && <p style={{ color: 'crimson' }}>文档操作失败：{docsError}</p>}
          {docsLoading && <p>文档加载中…</p>}
          {!docsLoading && documents.length === 0 && <p>暂无文档。</p>}
          {documents.length > 0 && (
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 900, marginBottom: 24 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={cellStyle}>名称</th>
                  <th style={cellStyle}>大小</th>
                  <th style={cellStyle}>分块数</th>
                  <th style={cellStyle}>状态</th>
                  <th style={cellStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td style={cellStyle}>{doc.name}</td>
                    <td style={cellStyle}>{formatSize(doc.sizeBytes)}</td>
                    <td style={cellStyle}>{doc.chunkCount}</td>
                    <td style={{ ...cellStyle, color: doc.status === 'ready' ? 'seagreen' : 'crimson' }}>
                      {doc.status}
                      {doc.errorMessage !== null && <span style={{ color: 'crimson' }}> · {doc.errorMessage}</span>}
                    </td>
                    <td style={cellStyle}>
                      <button onClick={() => void handleDeleteDocument(doc.id)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>检索调试</h3>
          <form onSubmit={handleSearch} style={{ display: 'grid', gap: 8, maxWidth: 520, marginBottom: 8 }}>
            <label>
              检索词
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
                maxLength={2000}
                style={{ display: 'block', width: '100%' }}
              />
            </label>
            <label>
              topK（1-20）
              <input
                type="number"
                min="1"
                max="20"
                value={topKText}
                onChange={(e) => setTopKText(e.target.value)}
                style={{ display: 'block', width: 100 }}
              />
            </label>
            <button type="submit" disabled={searching}>
              {searching ? '检索中…' : '检索'}
            </button>
          </form>
          {searchError !== null && <p style={{ color: 'crimson' }}>检索失败：{searchError}</p>}

          {searchResult !== null && (
            <div>
              <p style={{ fontSize: 13, color: '#555' }}>
                「{searchResult.query}」· topK {searchResult.topK} · 命中 {searchResult.hits.length} 条
              </p>
              {searchResult.hits.length === 0 && <p>没有命中。</p>}
              <ul style={{ paddingLeft: 18 }}>
                {searchResult.hits.map((hit) => {
                  const key = `${hit.documentId}:${hit.chunkIndex}`
                  const isOpen = expanded.has(key)
                  const truncated = hit.content.length > 200 ? `${hit.content.slice(0, 200)}…` : hit.content
                  return (
                    <li key={key} style={{ marginBottom: 10 }}>
                      <div>
                        <strong>{hit.documentName}</strong> · 分块 {hit.chunkIndex} · 分数{' '}
                        <code>{hit.score.toFixed(3)}</code>
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: '#444' }}>
                        {isOpen ? hit.content : truncated}
                      </div>
                      {hit.content.length > 200 && (
                        <button onClick={() => toggleExpanded(key)}>{isOpen ? '收起' : '展开'}</button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </main>
  )
}

const cellStyle: CSSProperties = {
  borderBottom: '1px solid #ddd',
  padding: '6px 8px',
  verticalAlign: 'top',
}
```

**这段在干什么**：

- 页面只有两个视图，用 `selectedId === null` 切换：**列表视图**（新建 + 列表）与**详情视图**（文档 + 检索调试）。没有引入路由，切换是纯状态。
- `loadKbs()` 拉 `GET /knowledge-bases`，把 `items` 存进 `kbs`；新建 / 删除 / 上传后都重新拉一次，保证 `documentCount` 与表格同步。
- 文档列表用 `useEffect([selectedId, docsTick, router])`：**`docsTick` 自增**就是「重新拉取」的信号。上传 / 删除后 `setDocsTick(t => t + 1)`，不需要手动拼新数组。
- `handleUpload`：`new FormData()` → `form.append('file', file)` → `body: form`，**headers 里只有 `Authorization`**。这是本篇最容易写错的一行（见 7.2）。
- `handleSearch`：前端先校验 `topK` 是 1–20 整数（不合法只提示、不发请求），再 POST `{query, topK}`；结果整体替换 `searchResult`。
- `expanded` 是 `Set<string>`，key 用 `${documentId}:${chunkIndex}`——文档内分块唯一；展开/收起只影响展示，不改原始 `content`。
- 错误统一走 `readErrorMessage`：后端 `message` 可能是字符串或字符串数组（DTO 校验失败），数组用 `'; '` 连接——与阶段 2 / 6 的写法一致。

### 6.2 `apps/web/app/apps/[id]/page.tsx`（画布的阶段 7 增量）

画布页在阶段 3~6 已多次出现（`03-画布/06`、`04-执行引擎/06`、`06-工具调用/04`），**完整文件见路径**；这里只列阶段 7 新增 / 修改的部分，其余（画布、保存 / 发布、SSE 消费、token 与 usage 展示）未变。

#### 6.2.1 类型与节点组件

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
type NodeType = 'start' | 'end' | 'llm' | 'knowledge'

/** GET /knowledge-bases 的列表项（画布只用到下拉所需的字段）。 */
type KnowledgeBaseSummary = { id: string; name: string; description: string | null; documentCount: number }

/** `retrieval` 事件里的单条命中。 */
type RetrievalHit = {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  score: number
}

/** `retrieval` 事件的 payload。 */
type RetrievalInfo = {
  nodeId: string
  knowledgeBaseId: string
  topK: number
  hits: RetrievalHit[]
}

function KnowledgeNode({ data }: NodeProps) {
  return (
    <NodeShell
      title={String(data.title ?? '知识检索')}
      type="knowledge · 检索"
      hasTarget
      hasSource
      accent="#7c5cff"
    />
  )
}

const nodeTypes = { start: StartNode, end: EndNode, llm: LlmNode, knowledge: KnowledgeNode }

function initialData(type: NodeType): Record<string, unknown> {
  if (type === 'llm') return { title: 'LLM', model: 'gpt-4o', prompt: '', system: '' }
  if (type === 'knowledge') return { title: '知识检索', knowledgeBaseId: '', query: '{{ inputs.topic }}', topK: 4 }
  if (type === 'start') return { title: '开始', inputs: [] }
  return { title: '结束', outputs: [] }
}
```

**这段在干什么**：

- `NodeType` 增加 `'knowledge'`，ReactFlow 的 `nodeTypes` 增加 `KnowledgeNode`——画布上出现一个新节点类型。
- `initialData('knowledge')` 给出**可直接编辑的默认 data**：`knowledgeBaseId` 为空（逼用户选库）、`query` 默认 `{{ inputs.topic }}`（模板，阶段 4 已讲）、`topK: 4`（契约默认值）。
- `KnowledgeNode` 用 `accent="#7c5cff"` 给节点一个紫色强调，纯视觉区分，不影响数据。

#### 6.2.2 状态与「知识库目录」拉取

```tsx
// 知识库清单（GET /knowledge-bases），供 knowledge 节点下拉；失败静默降级。
const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([])
// knowledge 节点的 topK 编辑文本（切换选中节点时同步）。
const [topKText, setTopKText] = useState('4')

// 本次运行收到的 retrieval 事件（可能来自多个 knowledge 节点）。
const [retrievals, setRetrievals] = useState<RetrievalInfo[]>([])

// 切换选中节点时，把数字字段的编辑文本同步为该节点当前值（空则留空）。
useEffect(() => {
  const t = selectedNode?.data.temperature
  setTemperatureText(typeof t === 'number' ? String(t) : '')
  const m = selectedNode?.data.maxTokens
  setMaxTokensText(typeof m === 'number' ? String(m) : '')
  const k = selectedNode?.data.topK
  setTopKText(typeof k === 'number' ? String(k) : '4')
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedNodeId])

// 进入画布时拉取知识库清单（需 Bearer）；失败静默降级为空列表。
useEffect(() => {
  const token = localStorage.getItem('accessToken')
  if (token === null) return
  let cancelled = false
  fetch(`${API_BASE}/knowledge-bases`, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => {
      if (!res.ok) return null
      return res.json() as Promise<{ items?: KnowledgeBaseSummary[] }>
    })
    .then((body) => {
      if (cancelled || body === null) return
      setKnowledgeBases(Array.isArray(body.items) ? body.items : [])
    })
    .catch(() => {
      // 静默降级：清单不可用时检查器提示去知识库页面创建。
    })
  return () => {
    cancelled = true
  }
}, [])
```

**这段在干什么**：

- `knowledgeBases` 是「**能力目录**」在 KB 场景的翻版：页面挂载时拉一次 `GET /knowledge-bases`，检查器用它渲染下拉。
- 拉取失败**静默降级**为 `[]`；检查器此时显示「请先去知识库页面创建：前往知识库」，**不阻塞画布编辑 / 保存**（与阶段 6 的 `/tools` 同策略）。
- `topKText` 是「编辑期文本」，与 `data.topK`（数字）分离：输入 `""` 或 `"abc"` 时先不写回，失焦再钳制（见 6.2.3）。
- `retrievals` 是数组，因为一张图可能有**多个** `knowledge` 节点，每次 `retrieval` 事件都追加一条。

#### 6.2.3 检查器里的 knowledge 编辑块

```tsx
/** knowledge 节点 topK：输入合法（1-20 整数）时写回；失焦时钳制并回填。 */
function changeTopK(id: string, raw: string): void {
  setTopKText(raw)
  const parsed = Number(raw)
  if (raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 20) {
    updateNodeData(id, { topK: parsed })
  }
}

function commitTopK(id: string): void {
  const parsed = Number(topKText)
  const clamped = Number.isFinite(parsed) ? Math.min(20, Math.max(1, Math.trunc(parsed))) : 4
  setTopKText(String(clamped))
  updateNodeData(id, { topK: clamped })
}

// —— 渲染部分（检查器） ——
{selectedNode.type === 'knowledge' && (
  <div style={{ display: 'grid', gap: 8 }}>
    {knowledgeBases.length === 0 && (
      <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
        请先去知识库页面创建：<a href="/knowledge">前往知识库</a>
      </p>
    )}
    <label>
      知识库
      <select
        value={String(selectedNode.data.knowledgeBaseId ?? '')}
        onChange={(e) => updateNodeData(selectedNode.id, { knowledgeBaseId: e.target.value })}
        disabled={knowledgeBases.length === 0}
        style={{ display: 'block', width: '100%' }}
      >
        <option value="">{knowledgeBases.length === 0 ? '暂无知识库' : '请选择知识库'}</option>
        {knowledgeBases.map((kb) => (
          <option key={kb.id} value={kb.id}>
            {kb.name}（{kb.documentCount} 篇文档）
          </option>
        ))}
      </select>
    </label>
    <label>
      检索词（query）
      <textarea
        value={String(selectedNode.data.query ?? '')}
        onChange={(e) => updateNodeData(selectedNode.id, { query: e.target.value })}
        rows={4}
        placeholder="支持 {{ inputs.topic }} / {{ 节点id.字段 }} 模板"
        style={{ display: 'block', width: '100%' }}
      />
    </label>
    <label>
      topK（1-20）
      <input
        type="number"
        min="1"
        max="20"
        value={topKText}
        onChange={(e) => changeTopK(selectedNode.id, e.target.value)}
        onBlur={() => commitTopK(selectedNode.id)}
        style={{ display: 'block', width: 100 }}
      />
    </label>
  </div>
)}
```

**这段在干什么**：

- **下拉的 `value` 存的是 `kb.id`，不是名字**：改名不会让已保存的图失效；名字只用于 `<option>` 的展示。
- `knowledgeBases.length === 0` 时 `select` 被 `disabled`，但**已有 `knowledgeBaseId` 的旧节点仍然保留该值**（`value` 仍能显示为空选项，保存时原值不动）——这是「增强接口失败不破坏数据」的体现。
- `changeTopK`：只在「空串以外的整数且 1–20」时写回；用户输入 `"9"` 会先看到 `9`，但 `data.topK` 立即变 9。
- `commitTopK`：失焦时把非法值钳制到 1–20（`Math.trunc` 去掉小数），空 / 非数字回落 4，并把文本回填成最终值——保证 UI 与 `data` 一致。

#### 6.2.4 运行面板解析 `retrieval`

```tsx
} else if (frame.event === 'retrieval') {
  const parsed = JSON.parse(frame.data) as Partial<RetrievalInfo>
  setRetrievals((prev) => [
    ...prev,
    {
      nodeId: parsed.nodeId ?? '',
      knowledgeBaseId: parsed.knowledgeBaseId ?? '',
      topK: typeof parsed.topK === 'number' ? parsed.topK : 0,
      hits: Array.isArray(parsed.hits) ? parsed.hits : [],
    },
  ])
} else if (frame.event === 'run_failed') {
  const parsed = JSON.parse(frame.data) as { message?: string }
  setRunError(parsed.message ?? 'run failed')
}
```

**这段在干什么**：SSE 循环里多一个 `retrieval` 分支——把 payload **归一**成 `RetrievalInfo`（缺字段给默认值、`hits` 非数组给 `[]`），**追加**到 `retrievals`。它不参与 token 累加，也不影响 `run_finished` 的 `outputs`——引用展示是**旁路信息**。

#### 6.2.5 引用展示

```tsx
{retrievals.length > 0 && (
  <div>
    <div style={{ fontWeight: 600 }}>知识检索（retrieval）</div>
    {retrievals.map((item, index) => (
      <div
        key={`${item.nodeId}-${index}`}
        style={{
          border: '1px solid #e3d9ff',
          background: '#f7f3ff',
          borderRadius: 4,
          padding: 6,
          marginTop: 6,
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600 }}>
          命中 {item.hits.length} 条 · topK {item.topK}
          {item.nodeId !== '' && (
            <span style={{ color: '#888', fontWeight: 400 }}> （节点 {item.nodeId}）</span>
          )}
        </div>
        {item.hits.length === 0 && <div style={{ color: '#888' }}>（无命中）</div>}
        {item.hits.map((hit, hitIndex) => {
          const content = hit.content.length > 200 ? `${hit.content.slice(0, 200)}…` : hit.content
          return (
            <div
              key={hitIndex}
              style={{ borderTop: '1px solid #e8e0ff', paddingTop: 6, marginTop: 6 }}
            >
              <div>
                <strong>{hit.documentName}</strong> · 分块 {hit.chunkIndex} · 分数{' '}
                <code>{hit.score.toFixed(3)}</code>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#444' }}>
                {content}
              </div>
            </div>
          )
        })}
      </div>
    ))}
  </div>
)}
```

**这段在干什么**：

- 每次 `retrieval` 一张卡片：标题行「命中 N 条 · topK K（节点 id）」，下面逐条引用。
- 每条引用展示 **`documentName` / `chunkIndex` / `score` / `content`**——这四样就是「**可解释性**」的最小集合：哪篇文档、第几块、多相关、内容是什么。
- `content` 超过 200 字符截断（同阶段 6 的 `tool_result`），只影响展示，不改原始值。
- `key={hitIndex}` 只在单次检索内部使用（同一次事件内分块顺序稳定）；外层用 `nodeId + index` 区分多个节点 / 多次运行。

---

## 7. 【技术教学 B · 首次】前端知识库页

### 7.1 能力目录驱动 UI（KB 版）

**问题**：画布的 `knowledge` 节点怎么知道「有哪些知识库可选」？

**答案**：不在前端写死，**从 `GET /knowledge-bases` 拉当前用户的知识库**，用返回的 `items` 渲染 `<option>`。这与阶段 6 的 `GET /tools` 是同一思路，但有两处新东西：

| 维度 | `GET /tools`（阶段 6） | `GET /knowledge-bases`（阶段 7） |
| --- | --- | --- |
| 数据性质 | 进程级**静态注册表** | 用户级**动态资源** |
| 是否随用户变化 | 不变 | **每个用户不同**（归属隔离） |
| 拉取时机 | 页面挂载一次 | 页面挂载一次（新建后刷新页面即可） |
| 失败降级 | 显示「工具清单不可用」 | 显示「请先去知识库页面创建」+ 链接 |
| 选项值 | `tool.name` | `kb.id`（**不是**名字） |

**为什么选项值必须是 id 而不是名字**

- 名字可以重复、可以改；`knowledgeBaseId` 是外键，**改名不会让图失效**。
- 预检与检索都按 id 查：`WHERE c.knowledge_base_id = :kb_id`。用名字就得每次 JOIN / 反查，且同名时歧义。
- 下拉里的「名字（N 篇文档）」只是**展示文本**，`value` 永远是 id。

**为什么失败要静默**

- 画布的关键路径是「读图 → 编辑 → 保存 → 运行」；KB 目录只是给 `knowledge` 节点**加一个下拉**。
- 目录拉取失败时，**已有节点的 `knowledgeBaseId` 仍在 `data` 里**（`selectedNode.data.knowledgeBaseId` 不受影响），保存照旧；只是本次无法改选。
- 因此 `.catch(() => {})` 吞掉错误，UI 只提示去创建——与阶段 6 §5.3 完全同策略。

**空状态的引导**

```tsx
{knowledgeBases.length === 0 && (
  <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
    请先去知识库页面创建：<a href="/knowledge">前往知识库</a>
  </p>
)}
```

**这段在干什么**：把「没有可选知识库」翻译成**可行动的下一步**（去 `/knowledge` 建一个），而不是一句冷冰冰的「暂无数据」。这是空状态设计的最小实践。

> **一句话**：**能力目录把「有哪些 KB」从画布里抽出来；前端只负责把目录投影成下拉，值用稳定 id、展示用可变名字。**

### 7.2 `FormData` 上传：**不要手写 `Content-Type`**

**这是本篇最经典的坑，没有之一。**

**正确写法**：

```tsx
const form = new FormData()
form.append('file', file)
const res = await fetch(`${API_BASE}/knowledge-bases/${selectedId}/documents`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
```

**错误写法（两种都常见）**：

```tsx
// ❌ 错误 1：手写 Content-Type，丢掉了 boundary
headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` }

// ❌ 错误 2：把 FormData 当 JSON 序列化
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
body: JSON.stringify({ file })
```

**为什么会错**：

`multipart/form-data` 的请求体长这样：

```
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="file"; filename="refund-sample.txt"
Content-Type: text/plain

...文件内容...
------WebKitFormBoundary7MA4YWxkTrZu0gW--
```

**`boundary` 是随机生成的分隔字符串**，浏览器在真正发送时才知道它。如果你手写 `Content-Type: multipart/form-data`（不带 `boundary=...`），服务端就不知道「哪里是一段的结束」——multer / `python-multipart` 解析失败，通常表现为：

- NestJS：`file === undefined` → 400 `Document is empty`；
- FastAPI：`file is None` → 400 `Document is empty`；
- 有时直接 400 校验错误（`Expected UploadFile, received: <class 'str'>`）。

**正确做法的原理**：**不要设置 `Content-Type`**，让 `fetch` 看到 `body` 是 `FormData` 时**自动**：

1. 生成随机 `boundary`；
2. 把每个字段编码成 part；
3. 设置 `Content-Type: multipart/form-data; boundary=...`。

你只需要手动加 `Authorization`（它不是浏览器自动生成的）。

| 写法 | Content-Type | 结果 |
| --- | --- | --- |
| `body: form`，headers 只带 Authorization | 浏览器自动 `multipart/form-data; boundary=...` | ✅ |
| 手写 `'Content-Type': 'multipart/form-data'` | 无 boundary | ❌ 服务端解析不出文件 |
| `body: JSON.stringify({file})` | `application/json` | ❌ 字段根本不是文件 |
| `form.append('upload', file)` | 字段名 `upload` | ❌ 后端只认 `file` |

**字段名也是契约**：前端 `form.append('file', file)`、NestJS `FileInterceptor('file')`、FastAPI `File(default=None)` 的参数名 `file`——三处必须一致。改成 `upload`，两端都会收到 `file === undefined`，返回 `Document is empty`。

### 7.3 检索调试面板：RAG 调优的第一步是「看召回」

**问题**：既然 `knowledge` 节点运行时也会展示引用，为什么还要在知识库页单独做一个「检索调试」？

**答案**：因为**调 RAG 的顺序是「先召回、后生成」**。

```
文档质量 → 切分 → 嵌入 → 召回 topK → 拼 context → 模型生成 → 答案
                ↑
        绝大多数问题出在这里
```

如果一上来就调提示词、换模型，你无法判断「答得不好」是因为：

- 文档里根本没有这条信息；
- 有，但**没被召回**（切分太碎 / 嵌入不好 / topK 太小）；
- 召回了，但**排序不对**（最相关的块没进 topK）；
- 都对了，是**模型没用好 context**。

**检索调试面板把「召回」单独暴露出来**：输入 `query` + `topK`，直接看 `hits`。它不经过 LLM、不拼提示词、不受模型影响——是**纯检索质量**的观测窗口。

**面板给出的四列信息，各回答一个问题**：

| 展示 | 回答的问题 |
| --- | --- |
| `documentName` | 召回的文档**对不对**？（是不是我预期的那篇） |
| `chunkIndex` | 召回的是这篇的**哪一块**？（定位切分问题） |
| `score` | 有多相关？（和上下名次比较，看区分度） |
| `content` | 这块内容**真的能回答问题**吗？ |

**典型用法**：

1. 上传文档后先搜一个**你确定文档里有答案**的问题（如「退款怎么申请」）。
2. `命中 1 条` + `score 0.520` + 内容正确 → 召回链路通了。
3. 若 `命中 0 条`：检查文档是否上传成功（`chunkCount`）、`query` 是否用词差异太大、`topK` 是否太小。
4. 若命中了但内容不对：看 `chunkIndex`，可能是切分把答案切断了（调 `chunk_size` / `overlap`，但记住**两端必须同步**）。
5. 召回满意后，再去画布里调 `query` 模板与 `llm` 提示词。

> **一句话**：**先证明「该找到的能找到」，再谈「答得好不好」。** 检索调试面板就是这条链路的断点。

### 7.4 `retrieval` 事件驱动引用展示

**为什么不让前端自己再查一次？**

- 前端再调 `POST /search` 会**重复嵌入 + 重复检索**，浪费一次调用，还可能因为文档在运行后被删而结果不一致。
- 引用必须与**这次运行实际用的 context 完全一致**，否则展示的是「另一条时间线」。

**事件 payload（`sse-events.md` §2）**：

```json
{
  "nodeId": "kb_1",
  "knowledgeBaseId": "0f0c...",
  "topK": 4,
  "hits": [
    { "documentId": "...", "documentName": "refund-sample.txt", "chunkIndex": 0, "content": "……", "score": 0.5201 }
  ]
}
```

**前端怎么处理**：

- `retrieval` **每个 knowledge 节点每次执行只发一次**（不是每个 chunk 一条）；事件顺序固定为 `node_started(knowledge)` → `retrieval` → `node_finished(knowledge)`。
- 用数组 `retrievals` 追加，是因为图里可能有多个 knowledge 节点，或用 `topK` 不同跑多次；每条都带 `nodeId` 以便归属。
- 展示的是 `hits` 的**副本**，不修改 `run_finished.outputs`；引用是「旁路信息」，不是运行结果的一部分。
- `content` 截断 200 字符，是为了不撑爆 340px 宽的面板；后端 `context` 仍用完整内容。

**可解释性**：用户看到「答案来自 `refund-sample.txt` 的分块 0，分数 0.520」——这就是 RAG 的**引用（citation）**。没有它，模型回答就像「凭空说的」；有了它，用户可以判断「该不该信」。

**与 `context` 的关系**：`knowledge` 节点输出 `context = hits.map(h => h.content).join("\n\n")`；下游 `llm` 的提示词里通常写 `{{ kb_1.context }}`。**面板展示的 `hits` 就是 `context` 的来源**——看到哪几条，模型就看到了哪几条。

### 7.5 分数为什么固定 3 位小数

**后端返回的是全精度浮点**，例如 `0.5201234567890123`。前端 `toFixed(3)` → `0.520`。

**理由**：

- **全精度对用户无意义**：`0.5201234567` 与 `0.520` 在「相关 / 不相关」的判断上没有区别；多出来的位数只是噪声。
- **3 位足够区分名次**：同一 query 的 topK 分数通常在小数点后 2~3 位就拉开差距（如 `0.588 / 0.497 / 0.133`）；3 位能看出「第一比第二高多少」。
- **展示与判定分离**：前端只负责**展示**；后端与验收脚本用的是**全精度**（`05-验收.md` L6 比较到 `0.5884331464767456`）。绝不能用 3 位小数做排序或断言。
- **稳定性**：`toFixed(3)` 在不同浏览器实现一致（四舍五入到 3 位），不会因为浮点尾数抖动而变来变去。

| 场景 | 用什么精度 |
| --- | --- |
| 页面展示（知识库页 / 运行面板） | `toFixed(3)` |
| 前端排序 | **不要排序**（后端已按距离排好） |
| 验收比较 | 全精度（`json.load` 后的 `float` 直接相等） |
| 日志 / 调试 | 可打全精度 |

> **一句话**：**3 位小数是「给人看的」，全精度是「给机器比的」——两者不要混用。**

---

## 8. 实测回放（真实浏览器 + 真实后端）

**环境**：headless Chrome 真实 UI；`api-ts`（3001）+ `api-py`（8000）+ Next.js（3000）+ mock-llm（11435）；`EMBEDDING_MODEL=mock-embedding`。

**知识库页（`/knowledge`）**

```
新建知识库「退款政策」→ 列表出现该库（文档数 0）
打开 → 上传 refund-sample.txt（277 B）
文档表：refund-sample.txt | 277 B | 1 | ready
检索调试：检索词「退款」→ topK 4
结果：「退款」· topK 4 · 命中 1 条
      refund-sample.txt · 分块 0 · 分数 0.520
删除文档 → 文档表清空（「暂无文档。」）
```

**画布（`/apps/{id}`）**

```
节点面板点「知识检索」→ 画布出现 knowledge 节点
选中 → 检查器出现「知识库」下拉（列出「退款政策（1 篇文档）」）
       → 选中该库；query 保持 {{ inputs.topic }}；topK 显示 4
保存草稿 → GET /apps/{id}/graph：
  {"id":"...","type":"knowledge","data":{
     "title":"知识检索","knowledgeBaseId":"<uuid>","query":"{{ inputs.topic }}","topK":4}}
运行（inputs.topic = 退款）→ 面板：
  知识检索（retrieval）· 命中 1 条 · topK 4
  refund-sample.txt · 分块 0 · 分数 0.520
  （内容截断展示）
```

> 分数 `0.520` 是 mock 哈希向量器对「退款」与该块的真实余弦相似度；换成真实嵌入模型，数值会变，但**两端仍然相同**（`05-验收.md` L6）。

---

## 9. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **上传时手写 `Content-Type: multipart/form-data`** | 后端收到 `file === undefined`，400 `Document is empty` | 丢了 boundary；**不要设置 Content-Type**，让浏览器生成（7.2） |
| 2 | **`form.append` 的字段名不是 `file`** | 同上 | 前端 `file`、NestJS `FileInterceptor('file')`、FastAPI `File()` 参数名三处必须一致 |
| 3 | **`UploadFile.read()` 放在 `def` 路由里** | 语法错误 / 阻塞事件循环 | 上传路由必须是 `async def`（5.2 / 5.6） |
| 4 | **没装 `python-multipart`** | `Form data requires "python-multipart" to be installed` | `uv sync --project apps/api-py`；依赖已在 `pyproject.toml` |
| 5 | **`Vector(1536)` 维度与迁移不一致** | `expected 1536 dimensions` | 维度以迁移 / HNSW 索引为准，代码不得擅自改（4.1） |
| 6 | **`text()` 里写 `:emb::vector`** | `syntax error at or near ":"` / 绑定参数未替换 | `::` 是 SQLAlchemy 的转义；改用 `CAST(:emb AS vector)`（5.3） |
| 7 | **`ORDER BY <=>` 写成 `DESC`** | 取到最不相关的块 | `score = 1 - 距离`，必须按距离**升序**（4.4） |
| 8 | **检索 SQL 忘了 `WHERE knowledge_base_id`** | 跨库召回，越权 | 归属过滤必须在 SQL 里（4.4 / 5.3） |
| 9 | **用 `os.environ` 读 `.env`** | 配了 `EMBEDDING_MODEL` 却回落到默认模型 | pydantic-settings 不回写进程环境；一律读 `settings.*`（5.5） |
| 10 | **`check_embedding_ctx_length` 留默认** | mock / 自定义模型名报 tiktoken 错 | 显式设 `False`（5.4） |
| 11 | **超时单位写成毫秒** | 永不超时 / 超时文案测不出来 | openai Python SDK 用**秒**，`llm_timeout_ms / 1000`（4.3） |
| 12 | **下拉把知识库名字当 `value`** | 改名后旧图失效 / 同名歧义 | `value` 用 `kb.id`，名字只做展示（7.1） |
| 13 | **检索调试点成「先调提示词」** | 改了模型仍答不对 | 先看召回：命中数 / 名次 / 内容（7.3） |
| 14 | **分数用 `toFixed(3)` 做断言** | 与后端全精度对不上 | 展示 3 位，验收用全精度（7.5） |
| 15 | **`retrieval.hits` 当对象渲染** | `[object Object]` | `hits` 是数组，逐条渲染；`content` 是字符串（7.4） |
| 16 | **忘了 `docsTick` 自增** | 上传成功但表格还是旧的 | 上传 / 删除后 `setDocsTick(t => t + 1)` 触发重新拉取（6.1） |
| 17 | **删含文档的知识库在 Python 侧曾 500（已修复）** | `NotNullViolation: null value in column "knowledge_base_id"` | 关系缺 `passive_deletes=True`，ORM 先把子外键置 NULL。已修复：三个关系都加该开关，删除交给数据库级联；实测 2918 字节文档（`chunkCount=2`）删除 → 204、计数 0/0（`01` §21.4） |
| 18 | **用 PowerShell 5.1 的 `Invoke-RestMethod` 上传 multipart** | 报「找不到 `-Form` 参数」/ 无法构造文件字段 | PS 5.1 不支持 `-Form`（PS 7+ 才有）。改用 **`curl.exe -F "file=@路径;type=text/plain"`**；注意 `curl` 是 `Invoke-WebRequest` 别名，必须写 `curl.exe` |

---

## 10. 本篇复盘与知识点

**一句话总结本篇**：Python 侧用 `Vector(1536)` **认识**向量列，用原生 `text()` + `CAST(:emb AS vector)` **对齐** TS 的读写行为；配置一律走 `settings`，嵌入显式关闭本地 tiktoken 预分词，上传走 `UploadFile`（异步读、自己判大小）。前端知识库页把「新建 → 上传 → 文档表 → 检索调试」做成一条闭环；画布的 `knowledge` 节点用 `GET /knowledge-bases` 的能力目录渲染下拉（值用 id），运行面板把 `retrieval` 事件的 `documentName / chunkIndex / score / content` 展示成引用，分数固定 3 位小数——而上传那条 `FormData` **绝不能手写 `Content-Type`**。

**本篇学到的工程要点**

1. **两种 ORM 的 pgvector 支持不同**：Prisma 只有 `Unsupported` 逃生舱（Client 不含该字段），SQLAlchemy 有原生 `Vector(n)`；本项目仍用原生 SQL 保证两端同构。
2. **`UploadFile` vs multer**：字段名 `file`；`UploadFile.read()` 是异步，路由必须 `async def`；FastAPI **没有内置大小上限**，必须读完再判。
3. **`text()` 的绑定参数**：`CAST(:emb AS vector)` 是正确写法；`:emb::vector` 会被 `::` 转义规则破坏。
4. **配置只走 `settings`**：pydantic-settings 不回写 `os.environ`，直接读环境变量会让 `.env` 静默失效。
5. **`async` 路由 + 同步 Session**：Session 不并发共享，短 DB 操作可接受；重操作放线程池。
6. **能力目录驱动 UI**：KB 下拉来自后端，`value` 用稳定 id；目录失败静默降级。
7. **`FormData` 上传**：不手写 `Content-Type`（boundary 由浏览器生成），字段名与后端一致。
8. **检索调试是 RAG 调优第一步**：先证明召回，再谈生成。
9. **引用展示来自 `retrieval` 事件**：旁路信息、可解释性、与 `context` 同源。
10. **分数展示与断言分离**：3 位给人看，全精度给机器比。

**遗留 / 后续**

- FastAPI 侧**没有请求体大小上限**（只在上传服务里判 1MB），生产需在反向代理 / ASGI 中间件层限制。
- `async def` 路由里的同步 DB 调用仍是「短暂阻塞」，后续可统一 `run_in_threadpool` 或引入 `AsyncSession`。
- 知识库页没有分页 / 搜索 / 重命名；文档表没有「重新处理」按钮。
- 引用只展示在运行面板，没有写进 `run_finished.outputs`，也没有「点击引用跳转原文」。
- 尚未支持 PDF / DOCX 等二进制文档（当前只接受文本类）。

---

## 11. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **`pgvector.sqlalchemy.Vector(1536)` 与 Prisma `Unsupported("vector(1536)")` 的差异** | **首次教学于本篇（Python 落地视角）**：契约视角见 `01`；本篇讲 SQLAlchemy 映射与「为什么还用原生 SQL」 |
| **`text()` 参数绑定与 `::vector` 坑** | **首次教学于本篇**：`CAST(:emb AS vector)` 正确；`:emb::vector` 被 `::` 转义破坏 |
| **`check_embedding_ctx_length=False`** | 概念见 `02-文档切分与向量化.md`；本篇只补 Python 侧对齐细节（tiktoken / 自定义模型名） |
| **`UploadFile` + `python-multipart`（对照 multer `FileInterceptor`）** | **首次教学于本篇**：字段名 `file`、异步 `read()`、无内置大小上限 |
| **`FormData` 上传不手写 `Content-Type`** | **首次教学于本篇**：boundary 由浏览器生成 |
| **能力目录驱动 UI（KB 下拉）** | **首次教学于本篇**：`value` 用 id、展示用名字、失败静默降级 |
| **检索调试面板** | **首次教学于本篇**：RAG 调优先看召回 |
| **`retrieval` 事件驱动引用展示** | **首次教学于本篇**：旁路信息、可解释性、与 `context` 同源 |
| **分数固定 3 位小数** | **首次教学于本篇**：展示 3 位、验收全精度 |



