# 01 · 知识库契约与 pgvector 建模

> 所属：阶段 7 · 知识库 RAG / 向量检索
> 本篇覆盖：在唯一真源 `packages/contract/openapi.yaml` 里新增 **8 个 `/knowledge-bases*` 接口**、`KnowledgeBaseResponse` / `DocumentResponse` / `RetrievalHit` 等 **9 组 schema**，`GraphNode.type` 增加 `knowledge`，`RunEvent.event` 增加 `retrieval`；同步 `packages/contract/src/index.ts` 的类型与 `CONTRACT_VERSION = 0.7.0`；在 `sse-events.md` 补 `retrieval` 事件与 `knowledge` 节点语义；在 `error-messages.md` 补 **§7 知识库 / 检索错误**；给出 Prisma 的 `KnowledgeBase` / `Document` / `Chunk` 三模型；给出迁移 `20261021113234_add_knowledge_base`（`CREATE EXTENSION vector` + `vector(1536)` + **HNSW 索引**）；给出 SQLAlchemy 的 `app/models/knowledge.py`；以及两端知识库控制器的**接口签名**。
> **本篇首次教学**：① RAG 是什么、为什么需要它（检索 + 增强 + 生成，「先查资料再回答」）；② 向量（Embedding）是什么、为什么用**余弦相似度**；③ pgvector 是什么（`vector(n)` 类型与 `<=>` / `<->` / `<#>` 三个距离运算符）；④ **为什么向量维度必须固定**（换模型 / 换维度必须写迁移）；⑤ **Prisma 不原生支持 `vector`** → `Unsupported("vector(1536)")` 的「ORM 逃生舱」模式（Prisma 建表、读写走原生 SQL）；⑥ SQLAlchemy 的 `pgvector.sqlalchemy.Vector(1536)` 与**两端差异**；⑦ **HNSW 索引**（暴力扫描 O(n) → 近似最近邻 ANN、`vector_cosine_ops`、`CREATE INDEX ... USING hnsw`）；⑧ **Prisma `migrate dev` 会生成 `DROP INDEX "chunks_embedding_hnsw"` 的运维坑**（本仓库真实发生过）；⑨ **三表关系与三级 `ON DELETE CASCADE`**（`knowledge_bases` → `documents` → `chunks`；SQLAlchemy 侧还需 `passive_deletes=True` 才会把删除真正交给数据库）；⑩ **8 个接口的契约设计**：为什么上传用 `multipart/form-data`、为什么列表返回 `documentCount` 而不是嵌套文档数组
> （OpenAPI 规范 / `$ref` / `additionalProperties` / `enum` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；Prisma 三件套、迁移与 schema-first 见 `01-账号与认证/02-Prisma.md`；关系建模、`@relation`、`onDelete: Cascade`、外键索引见 `02-应用管理/02-Prisma关系建模.md`；SQLAlchemy 2.0 的 `DeclarativeBase` / `Mapped` / `mapped_column` 见 `01-账号与认证/04-SQLAlchemy2.0.md`；`relationship` / `back_populates` / cascade 两层见 `02-应用管理/04-SQLAlchemy关系建模.md`；**迁移所有权**（Prisma 拥有 DDL、SQLAlchemy 只映射）见 `01-账号与认证/04-SQLAlchemy2.0.md`；错误信封与「错误文案唯一真源」见 `01-账号与认证/01-契约扩展.md`、`02-应用管理/07-验收.md`；SSE 帧格式、双通道错误、`node_started` / `node_finished` 顺序见 `04-执行引擎/01-运行契约与SSE事件协议.md`；「先校验、后开流」见 `04-执行引擎/05-SSE流式响应实现.md`。**文档切分、批量嵌入、检索 SQL、`knowledge` 节点的执行实现**属于本阶段后续篇目，本篇只讲**契约与数据建模**。）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 7 的立论：模型不知道你的文档

前六个阶段，应用已经能「画图 → 执行 → 调模型 → 调工具」。但它仍然有一个根本局限：

> **LLM 只知道训练数据里的东西。**

这带来三个具体问题：

| 问题 | 表现 |
| --- | --- |
| **知识有截止时间** | 模型不知道上周发布的内部制度、昨天的订单状态 |
| **不知道私有文档** | 你的产品手册、客服话术、合同模板，模型从没见过 |
| **不能把整个语料塞进 prompt** | 一份 200 页的手册远超上下文窗口；就算塞得下，成本和延迟也不可接受 |

阶段 7 的答案是 **RAG（Retrieval-Augmented Generation，检索增强生成）**。它的朴素思想只有一句话：

> **先查资料，再回答。**

就像开卷考试：模型不再「凭记忆答」，而是先拿到与问题最相关的几段资料（**检索**），把这些资料放进 prompt（**增强**），再让模型基于资料作答（**生成**）。

RAG 在工程上分成两条流程：

```
离线（ingest，写入一次）：
  文档文件 ──▶ 切分 chunk ──▶ 每块嵌入成向量 ──▶ 存入 PostgreSQL（pgvector）

在线（query，每次提问）：
  用户问题 ──▶ 嵌入成向量 ──▶ 按相似度取 topK 个 chunk ──▶ 拼进 prompt ──▶ LLM 生成
```

**本阶段的项目落点**是三张表、8 个接口和一个新节点类型：

```
knowledge_bases（知识库）
   └─ 1:N ─▶ documents（文档）
                └─ 1:N ─▶ chunks（分块，含 vector(1536)）
```

以及图里的 `knowledge` 节点：它以 `knowledgeBaseId` + `query` 为配置，运行时检索出 `chunks` 与拼好的 `context`，供下游 `llm` 节点使用（节点执行细节见后续篇，本篇只把**契约**定下来）。

---

## 1. 本篇目标

做完这一篇，你能：

- 在契约里把「**知识库/文档/检索**」正式化：8 个接口、6 组 schema、`RetrievalHit` 的分数语义。
- 在契约里把「**知识库节点**」正式化：`GraphNode.type` 增加 `knowledge`、`KnowledgeNodeData`、`KnowledgeNodeOutput`。
- 在事件协议里正式化 `retrieval` 事件及其固定位置。
- 在错误目录里正式化知识库 / 文档 / 嵌入错误的**逐字节文案**。
- 用 Prisma 建出三张表，并理解 `Unsupported("vector(1536)")` 到底意味着什么。
- 写出一条**手工增强**的迁移：`CREATE EXTENSION vector` + `vector(1536)` 列 + **HNSW 索引**。
- 用 SQLAlchemy 把同一批表映射到 Python，并说清两端处理 `vector` 的差异。
- 知道**为什么维度不能随便改**，以及**为什么下次 `prisma migrate dev` 可能删掉你的 HNSW 索引**。

**验收标准**

1. `pnpm run build:contract` 成功；`CONTRACT_VERSION` 与 `openapi.yaml#/info/version` 均为 **`0.7.0`**。
2. `openapi.yaml` 有 8 个 `/knowledge-bases*` 接口、`KnowledgeBaseResponse` / `DocumentResponse` / `RetrievalHit` / `SearchKnowledgeBaseRequest` / `SearchKnowledgeBaseResponse` / `KnowledgeNodeData`；`GraphNode.type` 含 `knowledge`；`RunEvent.event` 含 `retrieval`。
3. `src/index.ts` 同步上述类型；`CONTRACT_VERSION === '0.7.0'`。
4. `sse-events.md` 有 `retrieval` 事件、固定顺序 `node_started(knowledge) → retrieval → node_finished(knowledge)`、`context` 以 `"\n\n"` 连接。
5. `error-messages.md` §7 有 7 条知识库/文档文案、3 条 `knowledge` 节点预检文案、6 条嵌入文案。
6. 迁移应用后 `\d chunks` 显示 **`embedding | vector(1536)`**。
7. `\di chunks_embedding_hnsw` 显示 **`hnsw (embedding vector_cosine_ops)`**。
8. `POST /knowledge-bases` → **201**；`GET /knowledge-bases` → **200**；`DELETE /knowledge-bases/{id}`（空库）→ **204**。
9. 上传 3 篇约 2KB 的文档 → 每篇 `chunkCount = 2`。
10. 错误文案逐字命中 §7（如 `Knowledge base name is required`、`Unsupported document type: application/octet-stream`、`Document too large`、`Knowledge base not found`）。

---

## 2. 前置条件

| 前置 | 状态要求 | 出处 |
| --- | --- | --- |
| 本地中间件 | `docker compose ps` 里 `mini-dify-db` 为 `healthy`；镜像是 `pgvector/pgvector:pg16` | `00-项目初始化/02-本地中间件Docker.md` |
| 契约可编译 | `pnpm run build:contract` 可用；阶段 6 时是 `0.6.0` | `00-项目初始化/04`、`06-工具调用/01` |
| Prisma 迁移可跑 | `apps/api-ts/.env` 的 `DATABASE_URL` 为 **Prisma 格式**（无 `+psycopg`） | `01-账号与认证/02` |
| 认证就位 | 已能注册/登录，`Bearer` 令牌跨端互认 | `01-账号与认证/06`、`07` |
| Python 依赖可装 | `uv sync --project apps/api-py` 可用；`pyproject.toml` 已含 `pgvector>=0.5.1` | `00-项目初始化/01` |
| LLM 配置存在 | 上传/检索要调嵌入接口；无真实密钥时可指向 `tools/mock-llm`（需 mock 支持 embeddings） | `05-LLM节点/04` |

本篇**只新增**知识库相关的契约、三张表与一组 SQLAlchemy 模型映射，**不改**认证、画布、执行引擎的既有逻辑。文档切分、嵌入调用、检索 SQL、`knowledge` 节点执行属于后续篇。

---

## 3. 先看清要做什么

### 3.1 文件地图

```
packages/contract/
   ├── openapi.yaml     ← 8 个 /knowledge-bases* 接口；9 组 schema；
   │                       GraphNode.type 加 knowledge；RunEvent 加 retrieval   （本篇 §5）
   ├── src/index.ts     ← 同步类型 + KnowledgeNodeData / KnowledgeNodeOutput    （本篇 §6）
   ├── sse-events.md    ← retrieval 事件、顺序、knowledge 节点语义              （本篇 §7）
   └── error-messages.md← §7 知识库 / 检索错误                                   （本篇 §8）
        ↓ pnpm run build:contract
      dist/index.js + dist/index.d.ts

apps/api-ts/prisma/
   ├── schema.prisma                          ← KnowledgeBase / Document / Chunk （本篇 §9）
   └── migrations/20261021113234_add_knowledge_base/migration.sql
                                              ← 扩展 + 三表 + HNSW（手工增强）   （本篇 §10）

apps/api-py/app/models/
   └── knowledge.py                           ← SQLAlchemy 映射（无 DDL）         （本篇 §11）

apps/api-ts/src/rag/kb.controller.ts         ← 8 个路由的 TS 签名               （本篇 §12）
apps/api-py/app/api/kb.py                    ← 8 个路由的 Python 签名           （本篇 §12）
```

### 3.2 三张表与关系

```
users
  │ 1:N（owner_id，ON DELETE CASCADE）
  ▼
knowledge_bases
  │ 1:N（knowledge_base_id，ON DELETE CASCADE）
  ▼
documents
  │ 1:N（document_id，ON DELETE CASCADE）
  ▼
chunks
  ├─ chunk_index     分块在文档内的序号（0 起）
  ├─ content         分块正文
  ├─ embedding       vector(1536)（可空：写入瞬间才填）
  └─ knowledge_base_id  冗余列（只为检索过滤，无外键）
```

### 3.3 8 个接口

| # | 方法与路径 | 成功码 | 作用 |
| --- | --- | --- | --- |
| 1 | `GET /knowledge-bases` | 200 | 列出当前用户的知识库（含 `documentCount`） |
| 2 | `POST /knowledge-bases` | 201 | 创建知识库 |
| 3 | `GET /knowledge-bases/{id}` | 200 | 详情（仅限本人） |
| 4 | `DELETE /knowledge-bases/{id}` | 204 | 删除（级联文档与分块） |
| 5 | `GET /knowledge-bases/{id}/documents` | 200 | 文档列表 |
| 6 | `POST /knowledge-bases/{id}/documents` | 201 | **上传**文档（切分 + 向量化） |
| 7 | `DELETE /knowledge-bases/{id}/documents/{documentId}` | 204 | 删除文档（级联分块） |
| 8 | `POST /knowledge-bases/{id}/search` | 200 | 向量检索（余弦相似度） |

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行。Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请写 **`curl.exe`**。

| # | 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- | --- |
| 1 | `docker compose up -d db` | 仓库根 | 起带 pgvector 的 PostgreSQL | `docker compose ps` 显示 `mini-dify-db` 为 `healthy` |
| 2 | `docker exec mini-dify-db psql -U postgres -d minidify -c "select extversion from pg_extension where extname='vector';"` | 仓库根 | 确认扩展已装（迁移前可能为空） | 迁移后返回一行，实测 `0.8.7` |
| 3 | `pnpm run build:contract` | 仓库根 | 把 `0.7.0` 契约编译进 `dist`，供两端与前端消费 | 无报错；`packages/contract/dist/index.js`、`index.d.ts` 更新 |
| 4 | `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_knowledge_base --create-only` | 仓库根 | **只生成**迁移 SQL，不执行，留给手工加扩展与 HNSW | `prisma/migrations/<时间戳>_add_knowledge_base/migration.sql` |
| 5 | 手工编辑上一步的 `migration.sql` | 编辑器 | 在文件**最前面**加 `CREATE EXTENSION IF NOT EXISTS vector;`，在**最后**加 HNSW 索引 | 内容与 §10 一致 |
| 6 | `pnpm --filter @mini-dify/api-ts exec prisma migrate dev` | 仓库根 | 应用迁移，并自动 `prisma generate` | `Your database is now in sync with your schema.` |
| 7 | `uv sync --project apps/api-py` | 仓库根 | 安装 Python 依赖（含 `pgvector>=0.5.1`） | 无报错 |
| 8 | `docker exec mini-dify-db psql -U postgres -d minidify -c "\d chunks"` | 仓库根 | 验证列类型 | `embedding \| vector(1536)` |
| 9 | `docker exec mini-dify-db psql -U postgres -d minidify -c "\di chunks_embedding_hnsw"` | 仓库根 | 验证索引存在 | `chunks_embedding_hnsw \| index \| postgres \| chunks` |
| 10 | `pnpm dev:api-ts` / `pnpm dev:api-py` | 仓库根（各自单独终端） | 启动两套后端 | 监听 `:3001` / `:8000` |
| 11 | §23 的 create / get / delete 三条 `curl.exe` | 仓库根 | 冒烟验证 CRUD | 201 / 200 / 204 |

**为什么第 4 步必须 `--create-only`**

Prisma 只会根据 `schema.prisma` 生成它「看得懂」的 DDL。它**看不懂**两样东西：

- `CREATE EXTENSION vector`（扩展不在 datamodel 里）；
- `CREATE INDEX ... USING hnsw (...)`（索引方法无法在 `schema.prisma` 中声明）。

如果直接 `migrate dev`，生成的 SQL 只有三张表，`chunks.embedding` 会引用一个还不存在的 `vector` 类型，迁移**直接失败**。所以必须先「生成草案 → 手工补两句 → 再执行」。

**为什么第 2 步迁移前可能是空**

`pgvector/pgvector:pg16` **镜像里带了扩展文件**，但扩展是**按数据库安装**的：新建的 `minidify` 库不会自动 `CREATE EXTENSION`。扩展的安装动作由迁移里的第一句负责——这也是它必须排在 `CREATE TABLE chunks` 之前的原因。

---

## 5. 完整代码：契约（openapi.yaml 的本篇段落）

> `openapi.yaml` 是**累积文件**（阶段 0 起一路加到现在）。本篇只贴**新增/修改的完整段落**；未变部分与阶段 6 完全一致。改完把 `info.version` 升到 **`0.7.0`**。

**完整文件路径：`packages/contract/openapi.yaml`**

### 5.1 版本号

```yaml
info:
  title: mini-dify API
  version: 0.7.0
  description: >-
    唯一契约（单真源）。NestJS（api-ts）与 FastAPI（api-py）都必须实现本规范，
    并由同一套契约测试校验两者的响应结构、状态码与错误响应体一致。
```

**这段在干什么**

1. `version` 是**契约版本**，与 `src/index.ts` 的 `CONTRACT_VERSION` 必须同步。阶段 6 是 `0.6.0`，本篇新增知识库，升到 `0.7.0`。
2. 它是「契约演进」的可见信号：版本没变却改了 schema，说明有人漏了同步。

### 5.2 8 个接口（`paths` 的本篇段落）

```yaml
  /knowledge-bases:
    get:
      operationId: listKnowledgeBases
      summary: 列出当前用户的知识库
      security:
        - bearerAuth: []
      responses:
        "200":
          description: 知识库列表
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/KnowledgeBaseListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
    post:
      operationId: createKnowledgeBase
      summary: 创建知识库
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateKnowledgeBaseRequest"
      responses:
        "201":
          description: 创建成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/KnowledgeBaseResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /knowledge-bases/{id}:
    get:
      operationId: getKnowledgeBase
      summary: 获取知识库详情（仅限本人）
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: 知识库详情
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/KnowledgeBaseResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
    delete:
      operationId: deleteKnowledgeBase
      summary: 删除知识库（仅限本人，级联删除文档与分块）
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "204":
          description: 删除成功
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /knowledge-bases/{id}/documents:
    get:
      operationId: listDocuments
      summary: 列出知识库的文档
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: 文档列表
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DocumentListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
    post:
      operationId: uploadDocument
      summary: 上传文档（切分并向量化）
      description: >-
        `multipart/form-data`，字段名固定为 `file`。仅接受扩展名 `.txt` / `.md` / `.markdown`
        或 `content-type` 以 `text/` 开头的文件；大小上限 1MB。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              additionalProperties: false
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
      responses:
        "201":
          description: 上传并处理成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DocumentResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /knowledge-bases/{id}/documents/{documentId}:
    delete:
      operationId: deleteDocument
      summary: 删除文档（级联删除分块）
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: documentId
          in: path
          required: true
          schema:
            type: string
      responses:
        "204":
          description: 删除成功
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /knowledge-bases/{id}/search:
    post:
      operationId: searchKnowledgeBase
      summary: 检索知识库（向量余弦相似度）
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SearchKnowledgeBaseRequest"
      responses:
        "200":
          description: 检索结果（按分数降序）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SearchKnowledgeBaseResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

**这段在干什么（按阅读顺序）**

1. **REST 资源化**：知识库是集合 `/knowledge-bases`，文档是它的子集合 `/knowledge-bases/{id}/documents`。这是阶段 2 已确立的资源嵌套方式（见 `02-应用管理/01-契约扩展.md`）。
2. **每个接口都声明 `security: - bearerAuth: []`**：知识库是用户私有数据，必须登录。
3. **每个带 `{id}` 的接口都声明 `404`**：查不到**或不属于当前用户**一律 404，不泄露「这个 id 是否存在」（阶段 2 的 404 惯例）。
4. **删除统一用 `204`（无响应体）**：与 `DELETE /apps/{id}` 一致。
5. **只有 `POST /knowledge-bases` 和 `POST .../documents` 是 201**：两者都**创建了新资源**。`POST /search` 是查询语义，所以用 200。
6. **上传的 `requestBody` 是 `multipart/form-data`**：`file` 声明为 `type: string` + `format: binary`。OpenAPI 里 `format: binary` 就是「这是一段二进制流」的标准写法（设计理由见 §22.2）。
7. **`additionalProperties: false` + `required: [file]`**：只接受一个名为 `file` 的字段；前端若写成 `document` / `upload` 会直接被判非法。字段名在两端实现里也被写死。
8. **`description` 把三条业务约束前置写清**：字段名 `file`、允许的扩展名 / MIME、1MB 上限。契约不只是「形状」，也承载「规则」。

### 5.3 `GraphNode.type` 增加 `knowledge`

```yaml
    GraphNode:
      type: object
      additionalProperties: false
      required: [id, type, position, data]
      properties:
        id:
          type: string
        type:
          type: string
          enum: [start, end, llm, knowledge]
        position:
          $ref: "#/components/schemas/NodePosition"
        data:
          type: object
          description: >-
            节点各自的配置（自由结构，由各节点类型自行约定）。
            执行引擎按下列形状解释（见 error-messages.md §4）：
            start → `{ "inputs": [{ "name": string, "type": "string", "required": boolean }] }`；
            llm → `LlmNodeData`（见同文件 components.schemas.LlmNodeData，`model` 为空时回退环境变量 `LLM_MODEL`）；
            knowledge → `KnowledgeNodeData`（见同文件 components.schemas.KnowledgeNodeData）；
            end → `{ "outputs": [{ "name": string, "value": string }] }`（`value` 支持模板）。
          additionalProperties: true
```

**这段在干什么**

1. 节点类型从 **3 种变 4 种**：`start` / `end` / `llm` / `knowledge`。
2. `data` 仍是**自由结构**（`additionalProperties: true`），但 `description` 明确列出每种节点的形状——**类型靠 `description` 约定，形状靠各节点的 schema 约定**。这是阶段 4 定下的「`data` 是唯一放开字段」的延续（见 `04-执行引擎/01`）。
3. 加一个节点类型是**契约级变更**：两端校验器、执行引擎、前端画布都要同步认识 `knowledge`，所以必须升版本号。

### 5.4 知识库 / 文档 / 检索 schema

```yaml
    KnowledgeBaseResponse:
      type: object
      additionalProperties: false
      required: [id, name, description, documentCount, createdAt, updatedAt]
      properties:
        id:
          type: string
        name:
          type: string
        description:
          type: ["string", "null"]
        documentCount:
          type: integer
          description: 该知识库下的文档数
        createdAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。
        updatedAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。

    KnowledgeBaseListResponse:
      type: object
      additionalProperties: false
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/KnowledgeBaseResponse"

    CreateKnowledgeBaseRequest:
      type: object
      additionalProperties: false
      required: [name]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 80
        description:
          type: string
          maxLength: 500

    DocumentResponse:
      type: object
      additionalProperties: false
      required:
        [id, knowledgeBaseId, name, mimeType, sizeBytes, status, errorMessage, chunkCount, createdAt]
      properties:
        id:
          type: string
        knowledgeBaseId:
          type: string
        name:
          type: string
        mimeType:
          type: string
        sizeBytes:
          type: integer
        status:
          type: string
          enum: [ready, failed]
        errorMessage:
          type: ["string", "null"]
        chunkCount:
          type: integer
        createdAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。

    DocumentListResponse:
      type: object
      additionalProperties: false
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/DocumentResponse"

    RetrievalHit:
      type: object
      additionalProperties: false
      required: [documentId, documentName, chunkIndex, content, score]
      properties:
        documentId:
          type: string
        documentName:
          type: string
        chunkIndex:
          type: integer
        content:
          type: string
        score:
          type: number
          description: 余弦相似度（`1 - cosine_distance`），越大越相关

    SearchKnowledgeBaseRequest:
      type: object
      additionalProperties: false
      required: [query]
      properties:
        query:
          type: string
          minLength: 1
          maxLength: 2000
        topK:
          type: integer
          minimum: 1
          maximum: 20
          default: 4

    SearchKnowledgeBaseResponse:
      type: object
      additionalProperties: false
      required: [query, topK, hits]
      properties:
        query:
          type: string
        topK:
          type: integer
        hits:
          type: array
          items:
            $ref: "#/components/schemas/RetrievalHit"
```

**这段在干什么（按响应字段）**

1. `KnowledgeBaseResponse` **含 `documentCount`，不含文档数组**：列表页只需要「这个库有多大」，不需要嵌套全部文档（设计理由见 §22.3）。
2. `description` 用 `type: ["string", "null"]`：空描述统一序列化为 `null`，与 `AppResponse.description` 完全一致（阶段 2 的约定）。
3. `CreateKnowledgeBaseRequest.name` 声明 `minLength: 1` / `maxLength: 80`，但**业务文案由服务层给出**（先 `trim`，再判空/超长）。原因：`"   "` 在 schema 层面长度是 3，合法；但业务上应报 `Knowledge base name is required`。所以两端都把「长度检查」放在服务层，契约只负责声明边界。
4. `DocumentResponse.status` 是 `ready | failed` 的闭集，`errorMessage` 可空：为**将来异步处理**（上传后排队解析）预留了位置；当前实现同步处理成功，恒为 `ready`。
5. `chunkCount` 是**冗余存储**（`documents.chunk_count`），不必每次检索时 `COUNT(chunks)`；上传完成后一次性写入。
6. `RetrievalHit` 带 `documentName` 与 `chunkIndex`：前端可直接展示「来自哪篇文档的第几段」，不用再发一次请求；`score` 明确写成 **`1 - cosine_distance`，越大越相关**——这是**符号约定**，两端必须一致。
7. `SearchKnowledgeBaseRequest.topK` 默认 4、范围 1..20：限制单次检索返回量，避免把整个库塞进 prompt。
8. `SearchKnowledgeBaseResponse` 回显 `query` 与 `topK`（**实际生效值**，不是请求里的 `null`）：客户端不用自己补默认值。

### 5.5 `KnowledgeNodeData` 与事件枚举

```yaml
    KnowledgeNodeData:
      type: object
      additionalProperties: true
      required: [title, knowledgeBaseId, query]
      description: >-
        `knowledge` 节点的 `data` 形状（引擎按此解释，见 sse-events.md §4）。
        节点输出 `{ "chunks": RetrievalHit[], "context": string }`，
        `context` 为各 chunk 的 `content` 以 `"\n\n"` 连接。
      properties:
        title:
          type: string
        knowledgeBaseId:
          type: string
        query:
          type: string
          description: 支持 `{{ path }}` 模板
        topK:
          type: integer
          minimum: 1
          maximum: 20
```

**这段在干什么**

`KnowledgeNodeData` 把 `knowledge` 节点的「最小可用配置」定死为 `title` / `knowledgeBaseId` / `query` 三个必填字段，`topK` 可选并限制在 1..20；节点输出 `{ chunks, context }` 的形状与 `context` 的拼接规则写在 `description` 里，供两端引擎共同遵守。

```yaml
    RunEvent:
      type: object
      # 仅用于**文档**：SSE 流不是 JSON 响应体，每个事件的真实帧格式见
      # packages/contract/sse-events.md。此处描述事件的种类与 payload 形状。
      additionalProperties: false
      required: [event, data]
      properties:
        event:
          type: string
          enum:
            [run_started, node_started, token, tool_call, tool_result, retrieval, node_finished, run_finished, run_failed]
          description: 事件名
        data:
          type: object
          additionalProperties: true
          description: 事件 payload（键集合见 packages/contract/sse-events.md）
```

**这段在干什么**

1. `RunEvent.event` 的枚举从 8 种变 **9 种**，在 `tool_result` 之后插入 `retrieval`。位置有意义：它发生在 `knowledge` 节点内部、`node_finished` 之前。
2. 枚举只是**文档约束**；真实帧格式仍以 `sse-events.md` 为唯一真源（阶段 4 的约定）。
3. `data` 保持 `additionalProperties: true`：不同事件的 payload 键不同，不能穷举。

---

## 6. 完整代码：TS 类型（src/index.ts 的本篇段落）

> 只贴**新增/修改的完整段落**；其余与阶段 6 一致。`CONTRACT_VERSION` 改为 **`0.7.0`**。

**完整文件路径：`packages/contract/src/index.ts`**

### 6.1 版本号

```ts
/** 契约版本；修改契约时递增，并与 openapi.yaml 的 info.version 保持同步。 */
export const CONTRACT_VERSION = '0.7.0'
```

**这段在干什么**

`CONTRACT_VERSION` 是给代码读的契约版本；`openapi.yaml` 的 `info.version` 是给文档/工具读的。两者必须相同。

### 6.2 知识库与文档类型

```ts
/** 知识库对外视图（`GET /knowledge-bases` 等）。 */
export interface KnowledgeBaseResponse {
  id: string
  name: string
  /** 空描述统一序列化为 `null` */
  description: string | null
  /** 该知识库下的文档数 */
  documentCount: number
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  createdAt: string
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  updatedAt: string
}

/** GET /knowledge-bases 的响应体。 */
export interface KnowledgeBaseListResponse {
  items: KnowledgeBaseResponse[]
}

/** POST /knowledge-bases 请求体。 */
export interface CreateKnowledgeBaseRequest {
  /** 1-80 位 */
  name: string
  /** 最多 500 位 */
  description?: string
}

/** 文档对外视图（`GET /knowledge-bases/{id}/documents` 等）。 */
export interface DocumentResponse {
  id: string
  knowledgeBaseId: string
  name: string
  mimeType: string
  sizeBytes: number
  status: 'ready' | 'failed'
  errorMessage: string | null
  chunkCount: number
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  createdAt: string
}

/** GET /knowledge-bases/{id}/documents 的响应体。 */
export interface DocumentListResponse {
  items: DocumentResponse[]
}

/** 一条检索命中（向量余弦相似度）。 */
export interface RetrievalHit {
  documentId: string
  documentName: string
  chunkIndex: number
  content: string
  /** 余弦相似度（`1 - cosine_distance`），越大越相关 */
  score: number
}

/** POST /knowledge-bases/{id}/search 请求体。 */
export interface SearchKnowledgeBaseRequest {
  /** 1-2000 位 */
  query: string
  /** 1-20，默认 4 */
  topK?: number
}

/** POST /knowledge-bases/{id}/search 的响应体。 */
export interface SearchKnowledgeBaseResponse {
  query: string
  topK: number
  hits: RetrievalHit[]
}
```

**这段在干什么**

1. `description: string | null` 对应 OpenAPI 的 `type: ["string", "null"]`。
2. `status: 'ready' | 'failed'`：TS 的**字面量联合**把枚举变成编译期约束，写错字符串编译不过。
3. `topK?: number` 可选，但响应里的 `topK` 是**必填**——请求可以不传，响应一定回显实际生效值。
4. `RetrievalHit.score` 的注释与契约逐字一致，提醒读者「大 = 相关」，不要和 pgvector 的「小 = 近」混淆。

### 6.3 `GraphNode` 与知识库节点类型

```ts
/** 画布节点。`data` 为节点各自的配置（自由结构）。 */
export interface GraphNode {
  id: string
  type: 'start' | 'end' | 'llm' | 'knowledge'
  position: NodePosition
  data: Record<string, unknown>
}

/** `knowledge` 节点的 `data` 形状（见 openapi.yaml `KnowledgeNodeData`）。 */
export interface KnowledgeNodeData {
  title: string
  knowledgeBaseId: string
  /** 支持 `{{ path }}` 模板 */
  query: string
  /** 1-20 */
  topK?: number
}

/**
 * `knowledge` 节点输出形状（`node_finished.output`）：
 * `context` 为各 chunk 的 `content` 以 `"\n\n"` 连接（两端一致）。
 */
export interface KnowledgeNodeOutput {
  chunks: RetrievalHit[]
  context: string
}
```

**这段在干什么**

1. `GraphNode.type` 加 `'knowledge'`：TS 侧一旦漏改，所有按类型 `switch` 的地方都会编译报错——这正是我们想要的「编译期提醒」。
2. `KnowledgeNodeData` 与契约逐字段一致；`topK` 可选（服务端默认 4）。
3. `KnowledgeNodeOutput` 是**节点输出**的 TS 形状，供引擎与前端引用；`context` 的拼接顺序与分隔符都由契约固定。

### 6.4 事件类型

```ts
export type RunEventName =
  | 'run_started'
  | 'node_started'
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'retrieval'
  | 'node_finished'
  | 'run_finished'
  | 'run_failed'
```

**这段在干什么**

`RunEventName` 加 `'retrieval'`，位置与 OpenAPI 枚举一致（`tool_result` 之后、`node_finished` 之前）。它是「事件名」的编译期白名单，写错字符串直接编译失败。

```ts
/** `retrieval`：`knowledge` 节点检索完成（每节点只发一次）。 */
export interface RetrievalData {
  nodeId: string
  knowledgeBaseId: string
  topK: number
  hits: RetrievalHit[]
}

/** 单个 SSE 事件的逻辑表示（`event` + `data`），帧序列化由两端分别完成。 */
export interface RunEvent {
  event: RunEventName
  data:
    | RunStartedData
    | NodeStartedData
    | TokenData
    | ToolCallData
    | ToolResultData
    | RetrievalData
    | NodeFinishedData
    | RunFinishedData
    | RunFailedData
}
```

**这段在干什么**

1. `RetrievalData.hits` 直接复用 `RetrievalHit[]`：检索接口与事件用**同一个形状**，前端只需要一套渲染逻辑。
2. `RunEvent` 联合类型加 `RetrievalData` 一支，前端 `switch (event)` 时能拿到精确 payload。
3. **加事件不改帧格式**：仍是 `event: <name>\n` + `data: <单行 JSON>\n\n`（阶段 4），已有解析器不用改。

---

## 7. 完整代码：SSE 事件协议（sse-events.md 的本篇段落）

**完整文件路径：`packages/contract/sse-events.md`**

### 7.1 §2 事件表新增一行

````markdown
| `retrieval` | `knowledge` 节点检索完成（**每节点只发一次**） | `nodeId`(string)、`knowledgeBaseId`(string)、`topK`(number)、`hits`(RetrievalHit[]) |
````

**这段在干什么**

1. 明确「**每节点只发一次**」：一个 `knowledge` 节点执行一次检索，就只产生一个 `retrieval` 事件（不像 `token` 那样多个）。
2. payload 带 `knowledgeBaseId` 与 `topK`：前端可以显示「查的是哪个库、取了几条」。
3. `hits` 是数组，形状与 `/search` 响应的 `hits` 完全相同。

### 7.2 §3 事件顺序补充

````markdown
run_started
  （对每个按拓扑序执行的节点，依次：）
    node_started
    （仅 llm 节点：若干 token）
    （仅启用了工具的 llm 节点：可多轮 tool_call / tool_result）
    （仅 knowledge 节点：一次 retrieval）
    node_finished
run_finished
````

**这段在干什么**

在既有顺序里**插入**一行：`retrieval` 发生在 `node_started` 与 `node_finished` **之间**，不重复发节点开始/结束事件。也就是说，一次检索对图执行器而言只是**一个节点**的一步。

### 7.3 §4「引擎语义」新增 `knowledge` 段

````markdown
- **`knowledge`**（阶段 7）：把 `data.query` 用池渲染后作为检索词 → 嵌入 → 按余弦相似度
  检索 `data.knowledgeBaseId` 对应的知识库（`topK` 缺省为 4）。
  - 检索完成后发出**一次** `retrieval` 事件：`{ nodeId, knowledgeBaseId, topK, hits }`，
    顺序固定为 `node_started(knowledge)` → `retrieval` → `node_finished(knowledge)`。
  - **节点输出** `node_finished.output` 为 `{ "chunks": RetrievalHit[], "context": string }`：
    `chunks` 与 `retrieval.hits` 相同；`context` 为各 chunk 的 `content` 以 `"\n\n"` 连接
    （顺序与 `chunks` 一致，两端逐字节一致）。
  - **错误**：任何嵌入调用错误都映射为规范文案后走 `run_failed`（见 `error-messages.md` §7），
    **不**发该节点的 `retrieval` / `node_finished`。
````

**这段在干什么**

1. **检索词是渲染后的 `query`**：与 `llm` 节点的 `prompt` 一样支持 `{{ }}` 模板，可以引用上游节点输出。
2. **顺序固定**：`node_started(knowledge)` → `retrieval` → `node_finished(knowledge)`。这个顺序就是「先校验、后开流」的节点级版本——检索成功才发 `retrieval`。
3. **`chunks` 与 `hits` 相同**：`retrieval` 事件与服务端输出是同一份结果，前端不需要合并两处数据。
4. **`context` 的拼接规则写进契约**：`"\n\n"` 连接、顺序与 `chunks` 一致。这样下游 `llm` 的 prompt 在两台后端上**逐字节相同**。
5. **失败时不发 `retrieval` 与 `node_finished`**：与阶段 5 的 LLM 错误、阶段 6 的工具错误同一条规矩——出错的节点没有「完成」。

---

## 8. 完整代码：错误文案（error-messages.md §7）

**完整文件路径：`packages/contract/error-messages.md`**

````markdown
## 7. 知识库 / 检索错误

阶段 7 起，知识库 CRUD、文档上传、检索与 `knowledge` 节点涉及下列错误。

### 7.1 知识库与文档（HTTP 4xx，普通 JSON）

`error` 由状态码决定（400 → `Bad Request`，404 → `Not Found`）。

| 场景 | HTTP | message |
| --- | --- | --- |
| 名字为空 | 400 | `Knowledge base name is required` |
| 名字过长 | 400 | `Knowledge base name is too long` |
| 知识库不存在 / 不属于该用户 | 404 | `Knowledge base not found` |
| 文档不存在 | 404 | `Document not found` |
| 不支持的类型 | 400 | `Unsupported document type: {mime}` |
| 空文档 | 400 | `Document is empty` |
| 文档过大（>1MB） | 400 | `Document too large` |

- `{mime}` 取上传文件的 `content-type`；缺省时用 `application/octet-stream`。
- 允许的类型：扩展名 `.txt` / `.md` / `.markdown`，或 `content-type` 以 `text/` 开头。

### 7.2 `knowledge` 节点预检（HTTP 400，普通 JSON）

与 §4.1 的节点数据校验**合并**为同一条 `message`（按 `nodes` 数组顺序）：

| 场景 | HTTP | message |
| --- | --- | --- |
| 缺 `knowledgeBaseId` | 400 | `knowledge node {nodeId} knowledgeBaseId is required` |
| 知识库不存在 / 不属于该用户 | 400 | `knowledge node {nodeId} references unknown knowledge base: {id}` |
| `topK` 越界（不在 1..20） | 400 | `knowledge node {nodeId} topK must be between 1 and 20` |

预检必须知道当前用户（`ownerId`）：其他用户的知识库一律视为不存在。

### 7.3 嵌入错误（SSE 流内的 `run_failed`）

HTTP 状态码不变（仍是 `200` 的 SSE 流），`message` 为下列规范文案：

| 场景 | message |
| --- | --- |
| 未配置密钥 | `embedding provider not configured: LLM_API_KEY` |
| 未授权（401 / 403） | `embedding request unauthorized` |
| 限流（429） | `embedding rate limited` |
| 超时 | `embedding request timed out` |
| 其它 HTTP 错误 | `embedding request failed: {statusCode}` |
| 无法归类 / 维度不是 1536 | `embedding request failed: unknown` |

嵌入复用 `LLM_API_KEY` / `LLM_BASE_URL`，模型由 `EMBEDDING_MODEL` 指定
（默认 `text-embedding-3-small`）。

实现位置：

- api-ts：`apps/api-ts/src/rag/`（`embedding.service.ts`、`kb.service.ts`）
  与 `apps/api-ts/src/engine/nodes/knowledge.node.ts`。
- api-py：阶段 7 的 `apps/api-py/app/rag/` 与 `app/engine/nodes/knowledge.py`（与 TS 侧逐字节一致）。
````

**这段在干什么（按分类）**

1. **§7.1 是「普通 JSON 接口」的错误**：CRUD / 上传 / 检索，HTTP 状态码就是错误语义（400/404）。
2. **§7.2 是「运行前预检」的错误**：知识库节点配置错，应在**开流之前** 400，不能等执行到该节点才报（阶段 4 的「先校验、后开流」）。
3. **§7.3 是「执行中」的错误**：检索嵌入失败只能走流内 `run_failed`，HTTP 仍是 200。
4. **同一个嵌入错误文本，在不同通道出现**：
   - `/knowledge-bases/{id}/documents` 上传、`/search` 检索 → 服务层把它转成 **400 普通 JSON**；
   - `knowledge` 节点执行 → 同样文本走 **`run_failed`**。
   这是**双通道错误**在阶段 7 的复用：错误本身相同，通道由「在哪发现」决定。
5. **`{mime}` 的缺省值是 `application/octet-stream`**：这是 HTTP 客户端的默认类型，不是「允许的类型」。所以上传一个没有扩展名、也没有 `text/*` MIME 的文件，会得到 `Unsupported document type: application/octet-stream`。

---

## 9. 完整代码：Prisma schema（三模型）

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**

### 9.1 `User` 增加反向关系

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         String   @default("member")
  createdAt    DateTime @default(now()) @map("created_at")

  apps App[]
  knowledgeBases KnowledgeBase[]

  @@map("users")
}
```

**这段在干什么**

1. `knowledgeBases KnowledgeBase[]` 是**反向关系**（一用户多知识库），Prisma 要求关系两端都声明。
2. 它**不产生列**，只影响 Prisma Client 的 `include` / `select` 能力。

### 9.2 三个新模型

```prisma
/// 知识库（阶段 7）。DDL 仍由 Prisma 迁移拥有，Python 侧只做映射。
model KnowledgeBase {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  description String?
  createdAt   DateTime @default(now()) @map("created_at")
  // @default(now()) 与迁移里的 DB 默认值保持一致（updated_at 由 Prisma @updatedAt 维护）
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")

  owner     User       @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  documents Document[]

  @@index([ownerId])
  @@map("knowledge_bases")
}

/// 文档（阶段 7）：上传后切分并向量化，`status` 取 `ready` | `failed`。
model Document {
  id              String   @id @default(uuid())
  knowledgeBaseId String   @map("knowledge_base_id")
  name            String
  mimeType        String   @map("mime_type")
  sizeBytes       Int      @map("size_bytes")
  status          String   @default("ready")
  errorMessage    String?  @map("error_message")
  chunkCount      Int      @default(0) @map("chunk_count")
  createdAt       DateTime @default(now()) @map("created_at")

  knowledgeBase KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  chunks        Chunk[]

  @@index([knowledgeBaseId])
  @@map("documents")
}

/// 文档分块（阶段 7）。
model Chunk {
  id              String   @id @default(uuid())
  documentId      String   @map("document_id")
  knowledgeBaseId String   @map("knowledge_base_id")
  chunkIndex      Int      @map("chunk_index")
  content         String
  // 向量维度**固定 1536**：pgvector 的 vector(N) 列维度不可变。
  // 换维度（如 3072 / 1024）必须新写迁移（ALTER COLUMN ... TYPE vector(N) + 重建向量 + 重建 HNSW 索引），
  // 不能只改代码里的模型名；HNSW 索引见迁移 add_knowledge_base。
  // 注意：Prisma 无法在 schema 里声明 HNSW 索引，后续 `prisma migrate dev` 可能自动生成
  // `DROP INDEX "chunks_embedding_hnsw"`；遇到时应删掉该自动迁移并手工重建索引。
  embedding       Unsupported("vector(1536)")?
  createdAt       DateTime @default(now()) @map("created_at")

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([knowledgeBaseId])
  @@map("chunks")
}
```

**这段在干什么（按字段）**

1. **`@map` / `@@map`**：Prisma 用 camelCase 写模型，数据库用 snake_case；`@map` 是列映射，`@@map` 是表映射。这样 TS 代码里是 `knowledgeBaseId`，SQL 里是 `knowledge_base_id`。
2. **`@id @default(uuid())`**：uuid 由 **Prisma Client 在应用侧生成**，数据库列**没有默认值**。这条事实很关键——Python 侧 `mapped_column(String, primary_key=True)` 也必须在应用侧生成 uuid（见 §11）。
3. **`ownerId` + `@relation(... onDelete: Cascade)`**：`knowledge_bases.owner_id` 外键指向 `users.id`，删用户时级联删知识库。
4. **`@@index([ownerId])`**：PostgreSQL **不会**给外键自动建索引；所有「按 owner 过滤」的查询都靠它。
5. **`Document.chunkCount @default(0)`**：上传完成后由服务层写实际值；默认 0 保证「刚插入、还没算」时也合法。
6. **`Chunk.knowledgeBaseId` 没有 `@relation`**：它只是一列 + 一个索引，**没有外键**。这是有意为之——检索时按 `knowledge_base_id` 过滤，不必 `JOIN documents`；完整性由 `document_id` 的外键与级联保证（见 §21.3）。
7. **`embedding Unsupported("vector(1536)")?`**：
   - `Unsupported(...)` 告诉 Prisma「这一列的类型你别管，建表时照抄这个类型字符串」；
   - 它**不会**出现在 Prisma Client 的模型字段里，所以任何读写都得走原生 SQL（见 §17）；
   - `?` 表示**可空**：Prisma 要求 `Unsupported` 字段必须可空或带默认值（因为它无法在写入时验证该类型）。
8. **注释就是运维手册**：维度不可变、换维度要写迁移、`migrate dev` 可能 `DROP INDEX`——三件事都写在源码里，避免下一个人踩坑（见 §16、§20）。

---

## 10. 完整代码：迁移 SQL（含两处手工增强）

> 这条迁移是 `--create-only` 生成后**手工增强**过的：Prisma 生成的三表 DDL + 我们补的 `CREATE EXTENSION` 与 HNSW 索引。

**完整文件路径：`apps/api-ts/prisma/migrations/20261021113234_add_knowledge_base/migration.sql`**

```sql
-- 阶段 7：pgvector 扩展（chunks.embedding 用到 vector(1536)）。
-- 已安装时为空操作；Prisma 不会自动生成这一句。
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "knowledge_base_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error_message" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "knowledge_base_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_bases_owner_id_idx" ON "knowledge_bases"("owner_id");

-- CreateIndex
CREATE INDEX "documents_knowledge_base_id_idx" ON "documents"("knowledge_base_id");

-- CreateIndex
CREATE INDEX "chunks_knowledge_base_id_idx" ON "chunks"("knowledge_base_id");

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 阶段 7：向量检索索引（HNSW + 余弦距离）。
-- 必须放在 `chunks.embedding` 列创建之后；维度固定 1536，与 Schema 的 Unsupported("vector(1536)") 一致。
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
```

**这段在干什么（按执行顺序）**

1. **`CREATE EXTENSION IF NOT EXISTS vector`**：必须是第一步。没有它，`vector(1536)` 这个类型不存在，后面的 `CREATE TABLE chunks` 直接报 `type "vector" does not exist`。
2. **建三张表**：注意顺序 `knowledge_bases` → `documents` → `chunks`，与外键依赖一致。
3. **`embedding vector(1536)` 可空**：建列时还没有数据；写入时由服务层填。
4. **三个普通 B-tree 索引**：对应 schema 里的 `@@index`。PostgreSQL 不会自动为外键建索引，这是显式补上的。
5. **三个外键，全部 `ON DELETE CASCADE`**：删知识库 → 文档 → 分块，三级一起走（见 §21）。
6. **最后一句 HNSW 索引**：
   - `USING hnsw`：索引方法是 HNSW；
   - `(embedding vector_cosine_ops)`：算子类是**余弦**，与查询里的 `<=>` 配套；
   - `IF NOT EXISTS`：让这条迁移**可重复执行**（手工补索引时也安全）；
   - 必须在列创建之后——索引不能建在不存在的列上。

> **Prisma 为什么不生成后两句**：`CREATE EXTENSION` 属于「数据库级安装」，HNSW 索引属于「Prisma 无法表达的索引方法」。这两样只能手写，并且要接受「下次 diff 可能想删掉它们」（见 §20）。

---

## 11. 完整代码：SQLAlchemy 映射（knowledge.py）

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

**这段在干什么（按类/字段）**

1. **没有 `Base.metadata.create_all()`**：Python 侧**不拥有 DDL**。这些类只是「表长什么样」的映射，建表动作发生在 Prisma 迁移里（迁移所有权见 `01-账号与认证/04-SQLAlchemy2.0.md`）。
2. **`id: Mapped[str] = mapped_column(String, primary_key=True)` 没有默认值**：与 Prisma 的 `@default(uuid())` 对应——uuid 由**应用代码**生成（Python 用 `uuid.uuid4()`），数据库列没有默认值。
3. **`ForeignKey(..., ondelete="CASCADE")`**：这一句只影响 SQLAlchemy 生成的 DDL；因为 Python 不建表，它的真实作用是**让模型元数据与数据库一致**。真正的级联由数据库外键执行；但 ORM 是否愿意「把删除交给数据库」，还取决于关系上的 `passive_deletes`（见第 9 条）。
4. **`index=True`**：同上，元数据层面的索引声明；真实索引来自迁移。
5. **`server_default` vs `default` 的边界**（阶段 2 已讲，见 `02-应用管理/04`）：
   - `created_at` 用 `server_default=func.now()`：**数据库**负责默认值；
   - `updated_at` 用 `default=func.now()` + `onupdate=func.now()`：**应用层兜底**，因为该列由 Prisma 的 `@updatedAt` 维护。
6. **`Vector(1536)`**：`pgvector.sqlalchemy` 提供的原生类型，映射到 PostgreSQL 的 `vector(1536)`；Python 侧 `embedding` 的值就是 `list[float]`。
7. **`relationship(..., back_populates=...)`**：三张表两两成对，`User.knowledge_bases` ↔ `KnowledgeBase.owner`（见 `apps/api-py/app/models/user.py`）。
8. **`Chunk.knowledge_base_id` 没有 `ForeignKey`**：与 Prisma 侧一致——它是**冗余过滤列**，不建外键。
9. **`passive_deletes=True`**：三个「父 → 子」关系（`KnowledgeBase.documents` / `Document.chunks`；`User.knowledge_bases` 见 `apps/api-py/app/models/user.py`）都显式声明了它。没有它，SQLAlchemy 在 `db.delete(parent)` 时会**逐行把子表外键 UPDATE 成 NULL**；`documents.knowledge_base_id` 是 `NOT NULL`，于是 `NotNullViolation` → 500。加上它，ORM 不再发那条 UPDATE，删除交给数据库的 `ON DELETE CASCADE`（真实踩坑与实测见 §21.4）。

---

## 12. 完整代码：两端控制器签名

> 本篇只关心**接口形状**；业务实现（切分、嵌入、检索 SQL）属于后续篇。

### 12.1 NestJS

**完整文件路径：`apps/api-ts/src/rag/kb.controller.ts`**

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type {
  DocumentListResponse,
  DocumentResponse,
  KnowledgeBaseListResponse,
  KnowledgeBaseResponse,
  SearchKnowledgeBaseResponse,
} from '@mini-dify/contract'

import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard'
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto'
import { SearchKnowledgeBaseDto } from './dto/search-knowledge-base.dto'
import { KbService, MAX_DOCUMENT_BYTES } from './kb.service'
import { UploadTooLargeFilter } from './upload-too-large.filter'

/** 契约见 packages/contract/openapi.yaml 的 `/knowledge-bases*`。 */
@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard)
export class KbController {
  constructor(private readonly kbService: KbService) {}

  @Get()
  list(@CurrentUser() payload: JwtPayload): Promise<KnowledgeBaseListResponse> {
    return this.kbService.list(payload.sub)
  }

  @Post()
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseResponse> {
    return this.kbService.create(payload.sub, dto.name, dto.description)
  }

  @Get(':id')
  get(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<KnowledgeBaseResponse> {
    return this.kbService.get(payload.sub, id)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.kbService.remove(payload.sub, id)
  }

  @Get(':id/documents')
  listDocuments(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<DocumentListResponse> {
    return this.kbService.listDocuments(payload.sub, id)
  }

  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      // 1MB 上限；超限由 UploadTooLargeFilter 归一为 400 `Document too large`
      limits: { fileSize: MAX_DOCUMENT_BYTES },
    }),
  )
  @UseFilters(UploadTooLargeFilter)
  upload(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<DocumentResponse> {
    return this.kbService.upload(payload.sub, id, file)
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  async deleteDocument(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    await this.kbService.deleteDocument(payload.sub, id, documentId)
  }

  @Post(':id/search')
  @HttpCode(200)
  search(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SearchKnowledgeBaseDto,
  ): Promise<SearchKnowledgeBaseResponse> {
    return this.kbService.search(payload.sub, id, dto.query, dto.topK)
  }
}
```

**这段在干什么（按装饰器）**

1. **`@Controller('knowledge-bases')` + 类级 `@UseGuards(JwtAuthGuard)`**：这个控制器下的**所有**路由都要求令牌。`@CurrentUser()` 取出 JWT payload，`payload.sub` 是用户 id。
2. **`@Get()` / `@Post()`**：分别映射 `GET /knowledge-bases` 与 `POST /knowledge-bases`。
3. **`@Delete(':id') @HttpCode(204)`**：NestJS 的 `DELETE` 默认返回 200，必须显式改成 204 才与契约一致。
4. **`@Post(':id/search') @HttpCode(200)`**：`POST` 默认是 201，这里是**查询语义**，显式改回 200（与契约「检索是 200」一致）。
5. **`@UseInterceptors(FileInterceptor('file', { limits }))`**：告诉 NestJS「这是 multipart，字段名是 `file`，单文件，上限 1MB」。`limits` 触发的是 Multer 的 413，所以还要配 `@UseFilters(UploadTooLargeFilter)` 把它归一成契约要求的 **400 `Document too large`**。
6. **`@UploadedFile() file: ... | undefined`**：没有文件时是 `undefined`，由服务层报 `Document is empty`——**不把「缺文件」和「文件为空」分成两种文案**。
7. **每个方法都返回契约包里的 `Promise<XxxResponse>`**：类型与 `openapi.yaml` 对齐，改了契约而没改控制器会编译报错。

### 12.2 FastAPI

**完整文件路径：`apps/api-py/app/api/kb.py`**（路由签名部分；上方是 Pydantic 响应模型，均带 `ConfigDict(extra="forbid")`）

```python
@router.get("", response_model=KnowledgeBaseListResponse, operation_id="listKnowledgeBases")
def list_knowledge_bases(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> KnowledgeBaseListResponse:
    return KnowledgeBaseListResponse(items=service.list_knowledge_bases(db, current_user.id))


@router.post(
    "",
    response_model=KnowledgeBaseResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="createKnowledgeBase",
)
def create_knowledge_base(
    body: CreateKnowledgeBaseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> KnowledgeBaseResponse:
    return KnowledgeBaseResponse(
        **service.create_knowledge_base(db, current_user.id, body.name, body.description)
    )


@router.get(
    "/{id}", response_model=KnowledgeBaseResponse, operation_id="getKnowledgeBase"
)
def get_knowledge_base(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> KnowledgeBaseResponse:
    return KnowledgeBaseResponse(**service.get_knowledge_base(db, current_user.id, id))


@router.delete(
    "/{id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteKnowledgeBase"
)
def delete_knowledge_base(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    service.remove_knowledge_base(db, current_user.id, id)


@router.get(
    "/{id}/documents",
    response_model=DocumentListResponse,
    operation_id="listDocuments",
)
def list_documents(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentListResponse:
    return DocumentListResponse(items=service.list_documents(db, current_user.id, id))


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


@router.delete(
    "/{id}/documents/{documentId}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteDocument",
)
def delete_document(
    id: str,
    documentId: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    service.delete_document(db, current_user.id, id, documentId)


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

**这段在干什么（与 NestJS 对照）**

1. **`APIRouter(prefix="/knowledge-bases")`**（文件顶部定义）等价于 `@Controller('knowledge-bases')`；每个 `@router.xxx` 等价于 `@Get` / `@Post` / `@Delete`。
2. **`Depends(get_current_user)`** 等价于 `@UseGuards(JwtAuthGuard)` + `@CurrentUser()`；它同时完成鉴权与取用户。
3. **`status_code=status.HTTP_204_NO_CONTENT`** 显式对齐契约的 204；`POST /search` 不写 `status_code`，FastAPI 默认 200。
4. **`file: UploadFile | None = File(default=None)`** 是 FastAPI 的 multipart 写法；字段名来自参数名 `file`——**必须叫 `file`**，与契约一致。
5. **`operation_id="..."`** 与 OpenAPI 的 `operationId` 对齐，方便生成客户端/文档。
6. **`response_model=...`** 是运行期序列化与校验：返回体多一个字段、少一个字段都会被拦下；对应 NestJS 的返回类型约束（编译期）。
7. **同步函数 vs `async def`**：上传与检索要 `await` 嵌入调用，所以是 `async`；纯 CRUD 保持同步（FastAPI 会在线程池里跑）。

---

## 13. 【技术教学 · 首次】RAG 是什么、为什么要它

### 13.1 问题的本质

LLM 的参数里压缩了训练语料，但压缩带来三个硬限制：

| 限制 | 后果 |
| --- | --- |
| **有时间截止** | 模型不知道截止日期之后发生的事 |
| **没有你的私有数据** | 内部手册、客户合同、产品文档，从未进入训练集 |
| **上下文窗口有限且昂贵** | 不能每次把整个知识库塞进 prompt |

微调（fine-tuning）能改变模型行为，但不适合「装知识」：成本高、更新慢、无法引用来源、也做不到按用户权限隔离数据。**知识应该留在数据库里，而不是烧进权重里。**

### 13.2 一句话定义

> **RAG = 检索（Retrieval）+ 增强（Augmented）+ 生成（Generation）**：
> 先按问题从外部知识库**查出相关片段**，把这些片段**附加**到 prompt 里，再让模型**基于片段生成**答案。

用开卷考试类比：

| 闭卷（纯 LLM） | 开卷（RAG） |
| --- | --- |
| 凭记忆答题 | 先翻书，再答题 |
| 记错就编（幻觉） | 有原文可对照，能给出处 |
| 知识固化在脑子里 | 换一本书就换一套知识 |

### 13.3 两条流程

**离线（ingest）**：

```
文档文件
  │ ① 校验类型 / 大小 / 非空
  ▼
纯文本
  │ ② 切分（chunkSize=500、overlap=80，见 apps/api-ts/src/rag/splitter.ts）
  ▼
chunks（每块几百字符）
  │ ③ 批量嵌入（text-embedding-3-small）
  ▼
vector(1536)（每块一个）
  │ ④ 写入 chunks 表
  ▼
PostgreSQL + pgvector
```

**在线（query）**：

```
用户问题
  │ ① 用同一个嵌入模型编码
  ▼
query 向量
  │ ② 在 chunks 里按余弦相似度取 topK（默认 4）
  ▼
若干 chunk 正文
  │ ③ 拼成 context（"\n\n" 连接）
  ▼
prompt = "请根据以下资料回答：...\n\n问题：..."
  │ ④ LLM 生成
  ▼
答案（可附带来源）
```

### 13.4 为什么「先查再答」比「一次性塞全部」好

| 维度 | 全量塞入 | RAG |
| --- | --- | --- |
| 上下文长度 | 受窗口硬限制 | 只放 topK 片段 |
| 成本 | 每次都为全部资料付费 | 只为少量片段付费 |
| 相关性 | 噪声多，模型容易跑偏 | 只给最相关的几段 |
| 可更新 | 改文档就要改 prompt | 改文档只改数据库 |
| 可引用 | 无出处 | 每个片段有 `documentId` / `chunkIndex` |

> **RAG 不是万能的**：它只能回答「资料里写过的东西」。检索没召回的片段，模型也看不到——所以「切分策略、嵌入模型、topK」直接决定答案质量。这些属于后续篇。

---

## 14. 【技术教学 · 首次】Embedding：把文本变成向量

### 14.1 它是什么

**Embedding（嵌入）** 是一个函数：

```
embed(text: string) -> number[1536]
```

它把任意长度的文本映射成一个**定长浮点数组**。这个数组叫**向量**。关键性质是：

> **语义相近的文本，向量在空间里也相近。**

例如（示意，非真实数值）：

```
"如何申请退款"   → [ 0.12, -0.03,  0.88, ... ]   ┐
"退款流程是什么" → [ 0.11, -0.02,  0.86, ... ]   ├─ 距离很近
"今天天气不错"   → [-0.71,  0.55, -0.20, ... ]   ┘ 距离很远
```

模型并没有「理解」中文；它是在海量文本上训练出的一个编码器，把「经常出现在相似上下文里的文本」压到相近的位置。**语义相似 → 几何相近**，这就是向量检索能工作的全部前提。

### 14.2 为什么是定长

一个知识库里的文档长短不一，但向量必须是**同一维度**，否则无法比较、无法存进同一列。`text-embedding-3-small` 固定输出 1536 维；本项目把 `1536` 写死进 `vector(1536)`（见 §16）。

一个 1536 维 `float4` 向量约占：

```
1536 × 4 字节 = 6144 字节 ≈ 6 KB（不含 pgvector 头部开销）
```

10 万个分块 ≈ 600 MB 纯向量数据——这就是为什么需要索引（§19），也是为什么维度不能随便翻倍。

### 14.3 为什么用「余弦相似度」

两个向量之间可以定义很多「距离」。本项目用**余弦相似度**：

```
cos(a, b) = (a · b) / (‖a‖ · ‖b‖)
```

它衡量的是**两个向量的夹角**，而不是长度：

| 值 | 含义 |
| --- | --- |
| `1` | 方向完全相同（最相似） |
| `0` | 正交（无关） |
| `-1` | 方向完全相反 |

**为什么不用欧氏距离（L2）**：

- 文本嵌入的**长度**往往与文本长度、词频相关，而「语义」更多体现在**方向**上；
- 余弦对向量长度不敏感：一篇长文档和一句短问题，只要主题相同，方向就接近；
- 余弦天然落在 `[-1, 1]`（文本嵌入通常落在 `[0, 1]`），容易转成「分数」给用户看。

### 14.4 pgvector 里「距离」与「分数」是反的

pgvector 的 `<=>` 返回的是**余弦距离**：

```
cosine_distance = 1 - cosine_similarity
```

- 距离 **越小** 越相似；
- 相似度 **越大** 越相关。

所以本项目在 SQL 里写：

```sql
1 - (c.embedding <=> query_vector) AS score
ORDER BY c.embedding <=> query_vector   -- 距离升序 = 分数降序
```

契约里 `RetrievalHit.score` 的注释就把这件事写死：**`1 - cosine_distance`，越大越相关**。两台后端必须用同一个符号约定，否则前端排序会反。

> ⚠️ **同一个知识库必须用同一个嵌入模型**。不同模型产出的向量属于**不同的坐标空间**，混在一起算余弦没有任何意义。换模型 = 重建全部向量（§16）。

---

## 15. 【技术教学 · 首次】pgvector：PostgreSQL 的向量扩展

### 15.1 它是什么

**pgvector 是 PostgreSQL 的一个扩展（extension）**。装上之后，数据库多出：

1. 一个新类型 **`vector(n)`**：定长 `n` 维的 `float4` 数组；
2. 一组**距离运算符**；
3. 两种**向量索引**（IVFFlat / HNSW）。

本项目的镜像 `pgvector/pgvector:pg16` 已经带了这个扩展；实测扩展版本为 **`0.8.7`**。

### 15.2 安装：按数据库装，不是按镜像装

镜像里有扩展**文件**，但每个数据库仍要执行一次：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

这就是迁移 SQL 的第一句（§10）。如果漏了它，建表时会得到：

```
ERROR:  type "vector" does not exist
```

### 15.3 三个距离运算符

| 运算符 | 含义 | 与相似度的关系 |
| --- | --- | --- |
| `<=>` | **余弦距离** | `1 - cosine_similarity` |
| `<->` | 欧氏距离（L2） | 越小越近 |
| `<#>` | **负内积** | 取负号是为了让「升序」=「最相似」 |

本项目用 `<=>`，因为它与「语义方向」最契合（§14.3）。

### 15.4 向量字面量

PostgreSQL 不认识裸的 `[0.1,0.2]` 字符串，需要显式转换：

```sql
-- 写法 A：文本字面量 + 类型转换
'[0.1,0.2,0.3]'::vector
CAST('[0.1,0.2,0.3]' AS vector)

-- 写法 B：参数化后转换（本项目用的方式）
$1::vector
CAST(:embedding AS vector)
```

所以两端服务层都先拼一个 `"[v1,v2,...]"` 字符串，再 `::vector` / `CAST(... AS vector)`（见 §17.3、§18.3）。

### 15.5 为什么把向量放进 PostgreSQL，而不是专门的向量库

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 专用向量库（如 Milvus / Qdrant） | 向量规模极大时性能好 | 多一套系统、多一份运维、元数据与业务数据要双写 |
| **pgvector（本项目）** | **与业务表同库同事务**；`chunks` 与 `documents` 直接 `JOIN`；备份/权限/迁移沿用 PostgreSQL | 千万级以上向量不如专用库 |

教学项目选 pgvector 的核心理由是**事务与一致性**：上传时「写文档 + 写分块 + 写向量 + 更新 `chunkCount`」在**同一个事务**里完成（TS 用 `$transaction`），失败就整体回滚，不会出现「文档存在但没有向量」的中间态。

---

## 16. 【技术教学 · 首次】为什么维度必须固定

### 16.1 维度是**列类型**的一部分

```sql
embedding vector(1536)
```

这里的 `1536` 不是注释，是 PostgreSQL 的 **typmod**（类型修饰符）。它意味着：

- 这一列的每个值**必须正好 1536 维**；
- 插入 3072 维会直接报错：
  ```
  ERROR: expected 1536 dimensions, not 3072
  ```
- 建索引时，索引也绑定这个维度。

### 16.2 为什么不能「随便改」

假设你把 `EMBEDDING_MODEL` 从 `text-embedding-3-small`（1536 维）改成 `text-embedding-3-large`（3072 维）：

| 只改环境变量 | 实际会发生什么 |
| --- | --- |
| 新文档写入 | 插入 3072 维 → **数据库报错** |
| 旧文档向量 | 仍是 1536 维，但与新模型**不在同一空间**，余弦值无意义 |
| 查询向量 | 3072 维，无法与 1536 维列比较 |

**换维度是一次数据迁移，不是一次配置变更。** 正确步骤：

```sql
-- 1) 停写（或进入维护窗口）
-- 2) 删掉旧索引
DROP INDEX IF EXISTS chunks_embedding_hnsw;

-- 3) 改列类型（旧值在这里已经没有意义）
ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(3072);

-- 4) 用新模型重新嵌入**所有** chunks，逐行 UPDATE
-- 5) 重建 HNSW 索引
CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
```

注意第 4 步：**旧向量不能复用**。换模型等于换了坐标系，旧值即使维度相同也必须重算。这也是为什么 `chunks` 表要保存 `content` 原文——重嵌入时才有输入。

### 16.3 本项目的三重防线

| 位置 | 防线 |
| --- | --- |
| 迁移 / 列定义 | `vector(1536)`，数据库强制 |
| TS 嵌入服务 | `EMBEDDING_DIMENSIONS = 1536`，逐条检查长度，不符则 `embedding request failed: unknown` |
| Prisma schema 注释 | 写明「换维度必须新写迁移 + 重建向量 + 重建索引」 |

**同一维度也必须同一模型**：`text-embedding-3-small` 可以输出 1536，`text-embedding-3-large` 也可以被要求输出 1536（`dimensions` 参数截断），但两者仍是**不同的空间**，不能混用。

---

## 17. 【技术教学 · 首次】Prisma 与 pgvector：`Unsupported` 逃生舱

### 17.1 Prisma 不支持 `vector`

Prisma 的 datamodel 只认识它内置的类型（`String` / `Int` / `DateTime` / `Json` …）。pgvector 的 `vector(1536)` 不在其中，所以不能写：

```prisma
embedding Float[]   // ❌ 会被映射成 Postgres 的 float8[]，不是 vector
```

Prisma 提供了一个「逃生舱」：`Unsupported("...")`。

```prisma
embedding Unsupported("vector(1536)")?
```

它的语义非常精确：

| 它做了什么 | 它没做什么 |
| --- | --- |
| 建表时，把 `vector(1536)` **原样**写进 DDL | 不提供该字段的读写 API |
| 让 Prisma 知道「这一列存在」 | 不参与 `create` / `update` / `select` 的参数校验 |
| 允许迁移工具生成正确的列类型 | **不能**在 schema 里声明 HNSW 索引或扩展 |

### 17.2 「Prisma 建表，读写走原生 SQL」

这就是本项目的模式：

```
Prisma（DDL + 普通列）
  ├─ knowledge_bases / documents / chunks 的表结构
  ├─ id / name / status / chunk_count 等普通字段的 CRUD
  └─ 关系、级联、索引
          │
          ▼
原生 SQL（只有向量）
  ├─ INSERT ... VALUES (..., $n::vector, ...)
  └─ SELECT ..., 1 - (embedding <=> $n::vector) AS score
```

Prisma Client **不会**在模型上暴露 `embedding` 字段。你写 `prisma.chunk.create({ data: { embedding: [...] } })` 会直接**编译失败**——这不是运行时错误，而是类型层面就没有这个字段。

### 17.3 本项目真实的读写方式

**完整文件路径：`apps/api-ts/src/rag/kb.service.ts`**（节选：向量写入）

```ts
      for (let index = 0; index < chunks.length; index += 1) {
        // 向量写入只能走原生 SQL（Prisma 不支持 vector 类型）；字符串字面量再 ::vector。
        await tx.$executeRaw`
          INSERT INTO chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, created_at)
          VALUES (${randomUUID()}, ${documentId}, ${knowledgeBaseId}, ${index}, ${chunks[index]}, ${toVectorLiteral(vectors[index])}::vector, now())
        `
      }
```

**这段在干什么**

1. **`$executeRaw`**：Prisma 的「原生 SQL 执行」入口，返回受影响行数。
2. **模板字符串里的 `${...}` 是参数占位**（Prisma 会转成 `$1`、`$2`…），**不是字符串拼接**——所以没有 SQL 注入风险。
3. **`${literal}::vector`**：把 `"[0.1,0.2]"` 这样的字符串显式转成向量类型。
4. **放在 `tx` 事务里**：与 `document.create`、`document.update(chunkCount)` 同进同退。

**完整文件路径：`apps/api-ts/src/rag/kb.service.ts`**（节选：向量检索）

```ts
  const rows = await prisma.$queryRaw<
    Array<{
      document_id: string
      document_name: string
      chunk_index: number
      content: string
      score: number
    }>
  >`
    SELECT c.document_id, d.name AS document_name, c.chunk_index, c.content,
           1 - (c.embedding <=> ${literal}::vector) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.knowledge_base_id = ${knowledgeBaseId}
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${topK}
  `
```

**这段在干什么**

1. **`$queryRaw<T>`**：原生查询，返回类型由泛型 `T` 指定（这里用数据库的 snake_case 列名）。
2. **`<=>` 计算余弦距离，`1 - ...` 转成相似度**，别名为 `score`。
3. **`ORDER BY` 再算一次距离**：`SELECT` 里的表达式不能直接用于排序别名（PostgreSQL 允许 `ORDER BY score`，但这里重复写更明确，也确保用上索引）。
4. **`JOIN documents` 取 `document_name`**：命中结果要给用户看「来自哪篇文档」。
5. **`WHERE c.knowledge_base_id = ...`**：只查这个库的分块；这里有 B-tree 索引。
6. **`LIMIT ${topK}`**：参数化，不能拼字符串。
7. **`Number(row.score)`**：`pg` 驱动可能把数值以字符串/大数形式返回，统一转成 JS number 才能进 JSON。

### 17.4 逃生舱的代价

| 代价 | 说明 |
| --- | --- |
| 类型安全变弱 | 原生 SQL 的列名、类型全靠手写泛型，写错只能靠测试发现 |
| 迁移工具「看不懂」 | `Unsupported` 能建列，但不能表达 HNSW 索引 / 扩展（§20） |
| 不能 `include` | 查询 `documents` 时无法 `include: { chunks: true }` 拿到向量；要向量就必须自己写 SQL |

**什么时候值得用逃生舱**：只有少数列需要数据库的特殊类型，而其余 95% 的 CRUD 仍能享受 ORM 的便利。本项目正是这种比例——三张表里只有 `chunks.embedding` 一列需要原生 SQL。

---

## 18. 【技术教学 · 首次】SQLAlchemy 与 pgvector：两端差异

### 18.1 Python 有原生类型支持

SQLAlchemy 生态里有 `pgvector` 包，提供：

```python
from pgvector.sqlalchemy import Vector

embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
```

与 Prisma 的 `Unsupported` 相比，这是**一等公民**：

| 能力 | Prisma `Unsupported` | SQLAlchemy `Vector(1536)` |
| --- | --- | --- |
| 建列（DDL） | ✅（原样照抄类型字符串） | ✅（`create_all` 时生成 `vector(1536)`） |
| ORM 读 | ❌ 字段不在 Client 上 | ✅ 读出来就是 `list[float]` |
| ORM 写 | ❌ 必须原生 SQL | ✅ 可直接 `Chunk(embedding=[...])` |
| 类型校验 | 无 | Python 侧有类型注解 + 驱动转换 |
| 索引声明 | ❌ | ⚠️ 需 `Index(..., postgresql_using="hnsw")`，本项目仍手写在迁移里 |

### 18.2 但本项目 Python 侧**仍然不建表**

这是「迁移所有权」的约束（阶段 1 已确立，见 `01-账号与认证/04-SQLAlchemy2.0.md`）：

> **Prisma 拥有 DDL，SQLAlchemy 只做映射。**

所以 `Vector(1536)` 在 `app/models/knowledge.py` 里的作用不是「创建 vector 列」，而是：

1. **让 ORM 知道列类型**，读取时把数据库值转成 `list[float]`；
2. **让模型元数据与真实表一致**，避免两端对同一张表有两种理解；
3. **作为文档**：`Vector(1536)` 这个数字直接告诉读者维度是 1536。

如果哪天有人误跑了 `Base.metadata.create_all()`，它会尝试建三张表——这是**禁止操作**，会与 Prisma 的迁移历史冲突。

### 18.3 Python 侧为什么也用原生 SQL 读向量

`app/rag/service.py` 的注释写得很清楚：**插入与检索 SQL 与 TS 同构**。

**完整文件路径：`apps/api-py/app/rag/service.py`**（节选：向量插入）

```python
    insert_sql = text(
        """
        INSERT INTO chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, created_at)
        VALUES (:id, :document_id, :knowledge_base_id, :chunk_index, :content,
                CAST(:embedding AS vector), now())
        """
    )
```

**这段在干什么**

1. **`text(...)`**：SQLAlchemy 的原生 SQL 包装；`:name` 是**绑定参数**，不是字符串拼接。
2. **`CAST(:embedding AS vector)`**：与 TS 的 `::vector` 等价，只是 PostgreSQL 的两种写法。
3. **`to_vector_literal()`** 生成 `"[0.1,0.2,...]"`：与 TS 的 `toVectorLiteral` **逐字符同构**，保证两端写入的向量文本一致。

**完整文件路径：`apps/api-py/app/rag/service.py`**（节选：向量检索）

```python
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
```

**这段在干什么**

1. **与 TS 的 SQL 逐行同构**：同样的 `1 - (...)`、同样的 `JOIN`、同样的 `ORDER BY`、同样的 `LIMIT`。
2. **`CAST(:embedding AS vector)`**：同一语义的另一种写法。
3. **`float(row.score)`**（在后续 return 里）：把 `Decimal` / `float8` 统一成 Python `float`，再进 JSON。

### 18.4 两端差异一句话总结

| | TS / Prisma | Python / SQLAlchemy |
| --- | --- | --- |
| `vector` 类型支持 | ❌ 只能 `Unsupported(...)` | ✅ 原生 `Vector(1536)` |
| 向量读写 | 必须 `$queryRaw` / `$executeRaw` | ORM 可以，但**本项目选择原生 SQL 以对齐 TS** |
| DDL 所有权 | ✅ 拥有 | ❌ 只映射 |
| 维度写在哪 | `Unsupported("vector(1536)")` | `Vector(1536)` |
| 索引 | 手写进迁移 | 手写进迁移（同一份） |

> **一句话**：TS 侧是被迫走逃生舱，Python 侧是主动选择走同一条路——**为了两端 SQL 与向量文本完全一致**。

---

## 19. 【技术教学 · 首次】HNSW 索引：从暴力扫描到近似最近邻

### 19.1 没有索引时会发生什么

检索 SQL 的核心是：

```sql
WHERE c.knowledge_base_id = ?
ORDER BY c.embedding <=> query_vector
LIMIT 4
```

如果没有向量索引，PostgreSQL 只能**逐行计算距离**：

```
对每个 chunk：计算 1536 次乘加 → 排序 → 取前 4
```

这就是**精确最近邻（exact NN）**，复杂度 `O(N × d)`：

| 分块数 | 1536 维距离计算次数 |
| --- | --- |
| 1 千 | 约 154 万 |
| 10 万 | 约 1.5 亿 |
| 100 万 | 约 15 亿 |

小库还能忍，大库直接不可用。

### 19.2 ANN 与 HNSW

**ANN（Approximate Nearest Neighbor，近似最近邻）** 的思路是：**放弃「一定正确」，换取「几乎总是正确 + 快几个数量级」**。

**HNSW（Hierarchical Navigable Small World，分层可导航小世界）** 是目前最常用的 ANN 索引之一：

```
第 2 层（最稀疏）：  A ──────── D
                     │          │
第 1 层：            A ── B ── D ── F
                     │    │    │
第 0 层（全部点）：  A─B─C─D─E─F─G─H ...
```

- **建索引**：把所有向量组织成多层邻近图，上层稀疏（用于快速跳远），下层稠密（用于精细定位）。
- **查询**：从最上层的一个入口点出发，贪心地向「距离更近的邻居」跳；到下层继续跳，直到找不到更近的点。
- **复杂度**：接近 `O(log N)`，代价是**可能错过真正的最近邻**（召回率 < 100%）。

### 19.3 建索引的语法

```sql
CREATE INDEX chunks_embedding_hnsw
ON chunks
USING hnsw (embedding vector_cosine_ops);
```

逐段解释：

| 片段 | 含义 |
| --- | --- |
| `USING hnsw` | 索引方法是 HNSW（另一种是 `ivfflat`） |
| `(embedding ...)` | 对 `embedding` 列建索引 |
| `vector_cosine_ops` | **算子类 = 余弦**，对应查询里的 `<=>` |

**算子类必须与查询运算符匹配**：

| 查询用 | 索引必须用 |
| --- | --- |
| `<=>` 余弦 | `vector_cosine_ops` |
| `<->` L2 | `vector_l2_ops` |
| `<#>` 内积 | `vector_ip_ops` |

如果索引是 `vector_cosine_ops`，查询却写 `<->`，**索引不会被使用**——规划器只能退回顺序扫描。这类错误很隐蔽：SQL 语法完全正确，只是慢。

### 19.4 常用参数与取舍

| 参数 | 默认 | 作用 | 调大的后果 |
| --- | --- | --- | --- |
| `m` | 16 | 每层每个点的最大连接数 | 召回↑、内存↑、建索引慢 |
| `ef_construction` | 64 | 建索引时的候选集大小 | 索引质量↑、建索引慢 |
| `hnsw.ef_search` | 40 | **查询时**的候选集大小 | 召回↑、查询慢 |

可以按会话调查询参数：

```sql
SET hnsw.ef_search = 100;
```

### 19.5 小数据量时索引可能「没用上」

本项目实测只有几十个分块时，规划器很可能选择**顺序扫描**——因为表太小，走索引反而更慢。验证方式：

```sql
EXPLAIN ANALYZE
SELECT ... ORDER BY embedding <=> '[...]'::vector LIMIT 4;
```

看到 `Index Scan using chunks_embedding_hnsw` 才说明用上了索引；看到 `Seq Scan` 不代表索引坏了，只是数据量还没到「值得走索引」的程度。索引是为**数据长大后**准备的。

### 19.6 为什么选 HNSW 而不是 IVFFlat

| | HNSW | IVFFlat |
| --- | --- | --- |
| 建索引 | 直接构建多层图 | 先聚类（需要数据），再建倒排 |
| 召回 / 速度 | 通常更好 | 依赖 `lists` 与数据分布 |
| 内存 | 较高（图结构） | 较低 |
| 增量写入 | 友好 | 需要重新训练聚类 |

教学项目选 HNSW：**不需要训练、增量写入友好、召回稳定**。

---

## 20. ⚠️ 运维坑：`prisma migrate dev` 会删掉你的 HNSW 索引

> 这一节记录的是本仓库**真实发生过**的问题，也是本篇最容易被忽视的坑。

### 20.1 现象

第一次迁移（§10）跑完后，`\d chunks` 显示索引正常。过几天，你给 `Document` 加了一个字段，再跑：

```bash
pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_document_field
```

Prisma 生成了一个新的迁移文件，里面除了你想要的 `ALTER TABLE`，还多了一句：

```sql
DROP INDEX "chunks_embedding_hnsw";
```

如果你直接应用，索引就没了。检索仍能返回正确结果（顺序扫描），但**性能在大数据量下断崖式下跌**，而且很难联想到是几天前的一次迁移干的。

### 20.2 原因：影子数据库里有索引，datamodel 里没有

`prisma migrate dev` 生成迁移的机制是：

```
① 用「已有迁移」在一个影子数据库里重放 → 得到「当前应有状态」
② 把「当前应有状态」与「schema.prisma 的目标状态」做 diff
③ 差异写成新的 migration.sql
```

问题出在第 ① 步：影子数据库重放了 §10 的迁移，所以它**有** HNSW 索引。但第 ② 步的目标状态来自 `schema.prisma`，而 Prisma **没有任何语法能声明 HNSW 索引**。于是 diff 认为：

> 「目标 schema 里没有这个索引，说明它应该被删掉。」

→ 生成 `DROP INDEX`。

`CREATE EXTENSION vector` 同理：Prisma 也不会在 datamodel 里声明扩展（虽然它有 `postgresqlExtensions` 预览特性可以声明扩展，但**仍无法表达 HNSW 索引**），所以扩展也需要靠迁移文件手工保留。

### 20.3 正确处理

**情况 A：迁移还没应用（生成后发现）**

1. 打开新生成的 `migration.sql`；
2. **删掉** `DROP INDEX "chunks_embedding_hnsw";` 这一行；
3. 再执行 `prisma migrate dev` 应用。

**情况 B：已经应用了（索引已经丢了）**

手动重建：

```sql
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
ON chunks USING hnsw (embedding vector_cosine_ops);
```

重建前先确认列类型正确：

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d chunks"
```

**情况 C：从零重建数据库**

因为 `migration.sql` 里已经写了 `IF NOT EXISTS`，重放迁移会自动带上索引，无需额外操作。

### 20.4 一条可以长期执行的习惯

> **每次 `prisma migrate dev` 生成新迁移后，先打开 `migration.sql` 看一眼有没有 `DROP INDEX "chunks_embedding_hnsw"`。**

再加一条自动校验（验收时跑）：

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\di chunks_embedding_hnsw"
```

只要这条命令还能返回索引行，说明索引还在。把这条检查写进阶段 7 的验收清单（§23.6）。

### 20.5 为什么不用 Prisma 的扩展声明

| 方案 | 能解决扩展 | 能解决 HNSW 索引 | 本项目取舍 |
| --- | --- | --- | --- |
| `postgresqlExtensions` 预览特性 | ✅ | ❌ | 未启用 |
| 手工迁移 + 手工检查 | ✅ | ✅ | **采用** |

手工的代价是「每次迁移都要看一眼」；收益是**索引策略完全可控**，也便于将来调 `m` / `ef_construction`。教学项目选择把不确定性显式暴露出来。

---

## 21. 【技术教学 · 首次】三表关系与三级级联

### 21.1 关系图与归属

```
users ──1:N──▶ knowledge_bases ──1:N──▶ documents ──1:N──▶ chunks
         owner_id              knowledge_base_id      document_id
         （CASCADE）            （CASCADE）             （CASCADE）
```

- **`knowledge_bases.owner_id` 是归属隔离的唯一依据**：所有查询都先 `WHERE owner_id = 当前用户`，再按 id 查；查不到或不属于自己，一律 404。
- 为什么是 404 而不是 403：403 会泄露「这个 id 确实存在，只是不是你的」。阶段 2 已定（见 `02-应用管理/01-契约扩展.md`）。

### 21.2 为什么 `chunks` 还有 `knowledge_base_id`

`chunks` 已经能通过 `document_id → documents.knowledge_base_id` 找到所属知识库，为什么还要**冗余一列**？

| 原因 | 说明 |
| --- | --- |
| **检索过滤** | 检索 SQL 每次都要 `WHERE c.knowledge_base_id = ?`；有这一列就能直接走索引，不必 `JOIN documents` 再过滤 |
| **索引效率** | `chunks_knowledge_base_id_idx` 让「先缩小到某个库」变得极快 |
| **写入简单** | 上传时已经知道 `knowledgeBaseId`，顺手写入，成本为零 |

**代价与约束**：

- 它**没有外键**（迁移里只有 `chunks_document_id_fkey`，没有 `chunks_knowledge_base_id_fkey`）；
- 数据一致性靠「写入时永远从同一个来源取 `knowledgeBaseId`」保证；
- 如果哪天更新了 `documents.knowledge_base_id`（本项目不支持「移动文档」），必须同步更新 `chunks`，否则会串库。

> 这是典型的**读多写少的反范式**：用一列冗余换掉每次检索的一次 `JOIN`。

### 21.3 三级 `ON DELETE CASCADE`

数据库外键全部声明了 `ON DELETE CASCADE`：

```sql
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledge_base_id_fkey"
  FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;
```

删除一个知识库时，PostgreSQL 会：

```
DELETE knowledge_bases WHERE id = ?
  └─▶ 自动 DELETE documents WHERE knowledge_base_id = ?
        └─▶ 自动 DELETE chunks WHERE document_id = ?
```

**为什么要把级联放在数据库而不是应用层**：

| 放在应用层 | 放在数据库 |
| --- | --- |
| 要自己按顺序删三张表，漏一张就留孤儿 | 一条 `DELETE`，原子完成 |
| 并发写入时可能插进新的子行 | 外键锁保证一致性 |
| Python / TS 要各写一遍 | 两端共享同一份规则 |

### 21.4 ⚠️ Python ORM 删除的坑：`passive_deletes=True`（已修复·实测）

TS 侧 `prisma.knowledgeBase.delete()` 只发一条 `DELETE`，由数据库级联，**非空知识库也能删**。

Python 侧曾经在这里踩坑：`db.delete(kb)` 时，SQLAlchemy 的关系若没有配置 `cascade` / `passive_deletes`，它会**先把子行的外键置 NULL**：

```sql
UPDATE documents SET knowledge_base_id = NULL WHERE documents.id = ...
```

而 `documents.knowledge_base_id` 是 `NOT NULL`，于是：

```
psycopg.errors.NotNullViolation:
null value in column "knowledge_base_id" of relation "documents" violates not-null constraint
```

→ `DELETE /knowledge-bases/{id}` 在知识库**含文档**时返回 **500**（TS 侧正常 204），两端行为不一致。

**修复**：给关系加 `passive_deletes=True`，让 SQLAlchemy 不要发 `UPDATE ... SET ... = NULL`，把删除交给数据库的 `ON DELETE CASCADE`。`apps/api-py/app/models/knowledge.py` 当前三处关系为：

```python
class KnowledgeBase(Base):
    documents: Mapped[list["Document"]] = relationship(
        "Document", back_populates="knowledge_base", passive_deletes=True
    )


class Document(Base):
    chunks: Mapped[list["Chunk"]] = relationship(
        "Chunk", back_populates="document", passive_deletes=True
    )
```

外加 `apps/api-py/app/models/user.py` 的 `User.knowledge_bases` 同样 `passive_deletes=True`（删用户时由数据库级联删知识库）。

**实测（修复后）**：先上传 1 篇 **2918 字节**的文档（`chunkCount=2`），再删除该知识库 → **HTTP 204**；随后 `documents` / `chunks` 计数均为 **0**，级联生效。空库删除同样是 204。

> **教学点**：**「数据库有 CASCADE」不等于「ORM 会用它」**。`passive_deletes=True` 就是让 ORM「让路」的开关；不设它，ORM 会自作聪明地先把子行外键置 NULL。这是 **Python / SQLAlchemy 侧独有的坑**——Prisma 只发一条 `DELETE`，不需要也无法声明 `passive_deletes`（阶段 2 讲过的 cascade 两层问题，见 `02-应用管理/04-SQLAlchemy关系建模.md`）。

---

## 22. 【技术教学 · 首次】8 个接口的契约设计

### 22.1 为什么这 8 个、这样分组

```
/knowledge-bases                     ← 知识库集合
/knowledge-bases/{id}                ← 单个知识库
/knowledge-bases/{id}/documents      ← 知识库的子资源：文档
/knowledge-bases/{id}/documents/{documentId}
/knowledge-bases/{id}/search         ← 对知识库的「动作」
```

- 前四个是**知识库 CRUD**；中间两个是**文档 CRUD**；最后一个不是资源，是**检索动作**，所以用 `POST`（有请求体、有副作用式的计算）而不是 `GET`（query 可能很长，且不适合放在 URL 里）。
- **没有 `/documents/{id}` 的全局路由**：文档必须通过知识库定位，这样 URL 本身就能表达归属关系，权限检查也更自然。

### 22.2 为什么上传用 `multipart/form-data`

这是本篇最容易被问「为什么不直接用 JSON」的地方。

| | JSON + Base64 | **multipart/form-data** |
| --- | --- | --- |
| 传输体积 | 膨胀约 **33%**（Base64 编码） | 原始字节，无膨胀 |
| 内存 | 要先把整个文件读进字符串，再编码 | 可以**流式**读，边传边写 |
| 文件名 / MIME | 要自己塞进 JSON 字段 | 协议自带 `filename`、`Content-Type` |
| 大文件 | 容易打爆内存 | 有成熟的流式/限额机制 |
| 浏览器支持 | 要手写 `FileReader` | `<input type="file">` + `FormData` 原生支持 |

**关键点：文件是二进制流，不是 JSON 值。** 用一个为结构化数据设计的格式去装二进制，是「削足适履」。OpenAPI 用 `format: binary` 明确表达这件事：

```yaml
content:
  multipart/form-data:
    schema:
      type: object
      required: [file]
      properties:
        file:
          type: string
          format: binary
```

两端实现也据此：

- NestJS：`FileInterceptor('file', { limits })`；
- FastAPI：`file: UploadFile | None = File(default=None)`。

**字段名固定 `file`**：契约里写死，前端不能叫 `document` 或 `upload`。这样两端的解析代码、错误文案、文档都能保持一致。

**大小上限 1MB 放在契约里**：既约束客户端，也约束实现（NestJS 拦截器 + 服务层二次检查；FastAPI 读完 `len(raw)` 再判）。超限返回 **400 `Document too large`**，而不是 413——因为 413 不在契约的错误信封里，前端只认三种 `statusCode`。

### 22.3 为什么列表返回 `documentCount` 而不是嵌套文档数组

`GET /knowledge-bases` 有两种设计：

```jsonc
// 方案 A：嵌套（不采用）
{ "items": [ { "id": "...", "name": "...", "documents": [ {...}, {...} ] } ] }

// 方案 B：计数（本项目）
{ "items": [ { "id": "...", "name": "...", "documentCount": 3 } ] }
```

| 维度 | 嵌套数组 | `documentCount` |
| --- | --- | --- |
| 响应体积 | 随文档数**线性膨胀**（一个库 500 篇文档 = 巨型响应） | 恒定（一个整数） |
| 查询成本 | 每个库一次子查询 / 一次 `JOIN`，容易 N+1 | 一条 `LEFT JOIN + COUNT` / Prisma `_count` |
| 分页 | 文档列表本身要分页，嵌在列表里很难分 | 列表只分知识库，文档另有接口 |
| 关注点分离 | 列表页被迫加载详情 | 列表是摘要，详情走 `GET /{id}` |

**实现上**：TS 用 Prisma 的 `_count`：

```ts
const knowledgeBases = await this.prisma.knowledgeBase.findMany({
  where: { ownerId },
  orderBy: { createdAt: 'desc' },
  include: { _count: { select: { documents: true } } },
})
```

Python 用 `outerjoin + group_by + count`：

```python
select(KnowledgeBase, func.count(Document.id))
.outerjoin(Document, Document.knowledge_base_id == KnowledgeBase.id)
.where(KnowledgeBase.owner_id == owner_id)
.group_by(KnowledgeBase.id)
```

两者语义相同：**一次查询拿到「库 + 文档数」**，不产生 N+1。

> `documentCount` 是**派生值**，不是存储列。它每次现算，因此不会出现「计数过期」的问题；代价是一次聚合，规模在知识库数量级完全可接受。

### 22.4 其他几个契约决定

| 决定 | 理由 |
| --- | --- |
| **检索响应回显 `query` 与 `topK`** | 客户端不传 `topK` 时，响应告诉它实际用了多少；`query` 回显便于日志与前端状态管理 |
| **`RetrievalHit` 带 `documentName`** | 前端展示「来自哪篇文档」不需要再查一次文档接口 |
| **`score` 是 `1 - distance`** | pgvector 的距离「越小越近」，对外改用人类直觉的「越大越相关」；符号约定写进契约，两端一致 |
| **`status: ready \| failed`** | 为异步处理预留：将来上传可以立刻返回 `ready`/`failed`，解析失败时写 `errorMessage`；当前实现恒为 `ready` |
| **创建返回 201** | 新建了资源；与 `POST /apps` 一致 |
| **删除返回 204** | 无响应体；与 `DELETE /apps/{id}` 一致 |
| **归属不符返回 404** | 不泄露资源存在性；与阶段 2 一致 |
| **`topK` 上限 20** | 防止把整个库塞进 prompt，控制成本与延迟 |
| **上传限制 1MB** | 教学项目的嵌入式同步处理，过大文件会长时间占住请求；真实系统应改为异步任务 |

---

## 23. 验收自测

> 前提：`mini-dify-db` 为 `healthy`；迁移已应用；两套后端已启动；已注册/登录拿到 token。
> PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请写 **`curl.exe`**。

### 23.1 准备 token

```bash
# 仓库根。若已注册过，409 可忽略
curl.exe -s -o /dev/null -X POST http://127.0.0.1:3001/auth/register \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com","password":"secret123"}'

TOKEN=$(curl.exe -s -X POST http://127.0.0.1:3001/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com","password":"secret123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
```

**预期**：`$TOKEN` 非空。

### 23.2 数据库结构（最关键的两条）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d chunks"
docker exec mini-dify-db psql -U postgres -d minidify -c "\di chunks_embedding_hnsw"
docker exec mini-dify-db psql -U postgres -d minidify -c "select extname, extversion from pg_extension where extname='vector';"
```

**预期（实测）**：

```
                                     Table "public.chunks"
      Column       |              Type              | Collation | Nullable |      Default
-------------------+--------------------------------+-----------+----------+-------------------
 id                | text                           |           | not null |
 document_id       | text                           |           | not null |
 knowledge_base_id | text                           |           | not null |
 chunk_index       | integer                        |           | not null |
 content           | text                           |           | not null |
 embedding         | vector(1536)                   |           |          |
 created_at        | timestamp(3) without time zone |           | not null | CURRENT_TIMESTAMP
Indexes:
    "chunks_pkey" PRIMARY KEY, btree (id)
    "chunks_embedding_hnsw" hnsw (embedding vector_cosine_ops)
    "chunks_knowledge_base_id_idx" btree (knowledge_base_id)
Foreign-key constraints:
    "chunks_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documents(id) ON UPDATE CASCADE ON DELETE CASCADE
```

```
                     List of relations
 Schema |         Name          | Type  |  Owner   | Table
--------+-----------------------+-------+----------+--------
 public | chunks_embedding_hnsw | index | postgres | chunks
(1 row)
```

```
 extname | extversion
---------+------------
 vector  | 0.8.7
(1 row)
```

### 23.3 知识库 CRUD

```bash
# 创建 → 201（响应体写文件，避免与状态码混在一起）
curl.exe -s -o kb.json -w '%{http_code}\n' -X POST http://127.0.0.1:3001/knowledge-bases \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"退款政策","description":"客服知识库"}'
cat kb.json
KB_ID=$(python -c "import json;print(json.load(open('kb.json'))['id'])")

# 列表 → 200
curl.exe -s http://127.0.0.1:3001/knowledge-bases -H "Authorization: Bearer $TOKEN"

# 详情 → 200
curl.exe -s http://127.0.0.1:3001/knowledge-bases/$KB_ID -H "Authorization: Bearer $TOKEN"

# 删除空库 → 204（含文档的库同样 204，见 §21.4）
curl.exe -s -o /dev/null -w '%{http_code}\n' -X DELETE http://127.0.0.1:3001/knowledge-bases/$KB_ID \
  -H "Authorization: Bearer $TOKEN"
```

**预期（实测）**：

- `POST`：HTTP **201**，响应含 `"documentCount":0`；
- `GET`：HTTP **200**，`items` 数组；
- `DELETE`：HTTP **204**，无响应体。

### 23.4 上传 3 篇文档

准备三个 `.txt`（每篇约 2KB 的中文/英文混合文本），然后：

```bash
for f in doc1.txt doc2.txt doc3.txt; do
  curl.exe -s -X POST http://127.0.0.1:3001/knowledge-bases/$KB_ID/documents \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$f;type=text/plain"
  echo
done

curl.exe -s http://127.0.0.1:3001/knowledge-bases/$KB_ID/documents \
  -H "Authorization: Bearer $TOKEN"
```

**预期（实测）**：每篇上传返回 201，且 `chunkCount` 均为 **2**；文档列表 `items` 长度 3。

> 为什么是 2：切分配置 `chunkSize=500`、`chunkOverlap=80`（`apps/api-ts/src/rag/splitter.ts`），约 2KB 的中文文本正好切成两块。两端切分参数必须一致（后续篇）。

### 23.5 检索

```bash
curl.exe -s -X POST http://127.0.0.1:3001/knowledge-bases/$KB_ID/search \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"怎么退款","topK":3}'
```

**预期**：HTTP 200，`hits` 最多 3 条，每条含 `documentId` / `documentName` / `chunkIndex` / `content` / `score`；`score` 应在 `[0, 1]` 附近（文本嵌入的余弦相似度通常非负），并按降序排列。

### 23.6 错误文案（逐字）

```bash
# 名字为空 → 400
curl.exe -s -X POST http://127.0.0.1:3001/knowledge-bases \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"   "}'

# 不支持的类型 → 400（用二进制扩展名 + octet-stream）
curl.exe -s -X POST http://127.0.0.1:3001/knowledge-bases/$KB_ID/documents \
  -H "Authorization: Bearer $TOKEN" -F "file=@package.bin;type=application/octet-stream"

# 空文档 → 400
curl.exe -s -X POST http://127.0.0.1:3001/knowledge-bases/$KB_ID/documents \
  -H "Authorization: Bearer $TOKEN" -F "file=@empty.txt;type=text/plain"

# 知识库不存在 → 404
curl.exe -s http://127.0.0.1:3001/knowledge-bases/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN"
```

**预期（实测）**：

```json
{"statusCode":400,"message":"Knowledge base name is required","error":"Bad Request"}
{"statusCode":400,"message":"Unsupported document type: application/octet-stream","error":"Bad Request"}
{"statusCode":400,"message":"Document is empty","error":"Bad Request"}
{"statusCode":404,"message":"Knowledge base not found","error":"Not Found"}
```

超过 1MB 的文件：

```json
{"statusCode":400,"message":"Document too large","error":"Bad Request"}
```

> FastAPI 侧同样逐字节一致（文案唯一真源是 `error-messages.md` §7）。

### 23.7 两端一致（逐字段）

```bash
curl.exe -s http://127.0.0.1:3001/knowledge-bases -H "Authorization: Bearer $TOKEN" > ts-kb.json
curl.exe -s http://127.0.0.1:8000/knowledge-bases -H "Authorization: Bearer $TOKEN" > py-kb.json
python -c "import json; a=json.load(open('ts-kb.json')); b=json.load(open('py-kb.json')); print(a==b)"
```

**预期**：同一用户、同一批数据时输出 `True`。

### 23.8 验收清单

| # | 检查项 | 命令 / 做法 | 预期 |
| --- | --- | --- | --- |
| 1 | 契约编译 | `pnpm run build:contract` | 无报错 |
| 2 | 版本一致 | `openapi.yaml#/info/version` 与 `CONTRACT_VERSION` | 均为 `0.7.0` |
| 3 | 接口齐全 | 看 `openapi.yaml` | 8 个 `/knowledge-bases*` 接口 |
| 4 | schema 齐全 | 看 `openapi.yaml` | `KnowledgeBaseResponse` / `DocumentResponse` / `RetrievalHit` / `SearchKnowledgeBaseRequest` / `SearchKnowledgeBaseResponse` / `KnowledgeNodeData` |
| 5 | 节点类型 | 看 `GraphNode.type` | 含 `knowledge` |
| 6 | 事件协议 | 看 `sse-events.md` | 有 `retrieval` + 固定顺序 + `context` 规则 |
| 7 | 错误目录 | 看 `error-messages.md` §7 | 7 + 3 + 6 条文案 |
| 8 | 列类型 | §23.2 `\d chunks` | `embedding \| vector(1536)` |
| 9 | HNSW 索引 | §23.2 `\di` | `hnsw (embedding vector_cosine_ops)` |
| 10 | CRUD | §23.3 | 201 / 200 / 204 |
| 11 | 上传 | §23.4 | 每篇 `chunkCount=2` |
| 12 | 检索 | §23.5 | 200 + `hits` 降序 |
| 13 | 错误文案 | §23.6 | 四条逐字命中 |
| 14 | 两端一致 | §23.7 | `True` |

---

## 24. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| PowerShell 里 `curl` 不是 curl | 输出一大段 `StatusCode` / `RawContent`，`-H` 报错 | PowerShell 5 的 `curl` 是 `Invoke-WebRequest` 别名。写 **`curl.exe`** |
| **PowerShell 5.1 的 `Invoke-RestMethod` 不支持 `-Form`** | 上传文档时无法构造 multipart，报「找不到 `-Form` 参数」 | PS 5.1 没有 `-Form`（PS 7+ 才有）。上传用 **`curl.exe -F "file=@路径;type=text/plain"`** |
| 迁移报 `type "vector" does not exist` | 建表失败 | 迁移里漏了 `CREATE EXTENSION IF NOT EXISTS vector;`，或它没放在建表之前。见 §10 |
| 新库没有扩展 | 上面那条错误的常见来源 | 扩展是**按数据库**安装的；镜像带了文件不等于库装好了 |
| 插入向量报 `expected 1536 dimensions, not 3072` | 上传/检索 500 或 `embedding request failed: unknown` | `EMBEDDING_MODEL` 换了但列仍是 `vector(1536)`。换维度必须写迁移 + 重嵌入 + 重建索引（§16） |
| 换了嵌入模型但没重嵌入 | 检索结果「完全不相关」，分数很低 | 旧向量与新 query 不在同一空间。换模型 = 全量重算（§14.4） |
| **下次 `migrate dev` 生成 `DROP INDEX "chunks_embedding_hnsw"`** | 索引悄悄消失，检索变慢 | Prisma 无法在 schema 里声明 HNSW。生成迁移后**先检查并删掉这一行**，已删则手工重建（§20） |
| HNSW 索引建了但没被用 | `EXPLAIN` 显示 `Seq Scan` | 可能是数据太少（正常），或查询用了 `<->` 而索引是 `vector_cosine_ops`（算子类不匹配）。见 §19.3 |
| Prisma 里 `data: { embedding: [...] }` 编译报错 | TS 报「对象字面量只能指定已知属性」 | `Unsupported` 字段不在 Client 上，必须用 `$executeRaw`（§17） |
| 用 `Float[]` 存向量 | 列类型变成 `float8[]`，`<=>` 不可用 | Prisma 的 `Float[]` 映射到 Postgres 数组，不是 `vector`。必须 `Unsupported("vector(1536)")` |
| 上传字段名写成 `document` | 400 / 服务层报 `Document is empty` | 契约写死字段名 `file`。前端 `FormData.append('file', ...)` |
| 上传 `.bin` 且 MIME 缺省 | `Unsupported document type: application/octet-stream` | 只接受 `.txt` / `.md` / `.markdown` 或 `text/*`。`octet-stream` 是「未知类型」的默认值，不是允许值 |
| 文件只有空白字符 | `Document is empty` | 服务层用 `trim()` 判空，`"   \n"` 也算空 |
| 上传超 1MB 收到 413 | 前端解析不了错误体 | NestJS 用 `UploadTooLargeFilter` 把 413 归一成 400 `Document too large`（§12.1） |
| **删除含文档的知识库在 Python 侧曾 500（已修复）** | `NotNullViolation: null value in column "knowledge_base_id"` | SQLAlchemy 删父对象时先把子外键置 NULL。已在三个关系上加 `passive_deletes=True`，删除交给数据库 `ON DELETE CASCADE`。实测：上传 2918 字节文档（`chunkCount=2`）后删除 → 204，`documents` / `chunks` 计数 0/0（§21.4） |
| 以为 `chunks.knowledge_base_id` 有外键 | 手工插入脏数据不报错 | 它只是冗余列 + 索引，没有外键；完整性靠 `document_id`（§21.2） |
| `documentCount` 与文档列表对不上 | 计数比列表多/少 | `documentCount` 是实时聚合，列表是分页/过滤后的结果；两者不是同一口径 |
| 检索 `score` 为负 | 以为算错了 | 余弦相似度理论上可到 `-1`；文本嵌入通常非负，但负值不是 bug。契约只承诺「越大越相关」 |
| `GET /knowledge-bases` 没带 token | 401 | 与 `/apps` 同级，所有知识库接口都要 `Bearer` |
| 访问别人的知识库 | 404（不是 403） | 故意不泄露存在性（§21.1） |
| `POST /search` 返回 201 | 前端按 200 判断失败 | NestJS 控制器必须 `@HttpCode(200)`（§12.1） |
| 上传后立刻检索不到 | 检索结果为空 | 确认嵌入成功（`chunkCount > 0`）、嵌入模型一致、`knowledge_base_id` 写对；向量为空的行不参与相似度 |
| 忘记 `pnpm run build:contract` | NestJS 编译找不到 `KnowledgeBaseResponse` 等类型 | 类型来自 `@mini-dify/contract` 的 `dist`，必须先编译（§4 第 3 步） |
| 两个后端 `/search` 分数不同 | 同一 query 结果不一致 | 检查是否用了同一嵌入模型、同一 `EMBEDDING_MODEL`、同一维度；向量文本格式（`[a,b]`）也必须一致 |

---

## 25. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 | 登记 |
| --- | --- | --- |
| **RAG（检索增强生成）** | 模型知识有截止时间、不知道私有文档、上下文窗口有限；RAG = 检索 + 增强 + 生成，核心是「先查资料再回答」；离线 ingest（切分→嵌入→入库）与在线 query（嵌入→topK→拼 prompt→生成）两条流程；与微调、全量塞入的取舍 | **首次教学于本篇** |
| **Embedding（向量）与余弦相似度** | 文本 → 定长浮点数组；语义相近 → 几何相近；余弦衡量夹角、忽略向量长度，适合文本；`cos = a·b/(‖a‖‖b‖)`；pgvector 返回的是距离，`score = 1 - cosine_distance`；同一库必须同一模型 | **首次教学于本篇** |
| **pgvector** | PostgreSQL 扩展，提供 `vector(n)` 类型与 `<=>`（余弦距离）/ `<->`（L2）/ `<#>`（负内积）；按数据库安装（`CREATE EXTENSION`）；向量字面量 `'[...]'::vector` / `CAST(... AS vector)`；与专用向量库的取舍（同库同事务） | **首次教学于本篇** |
| **向量维度必须固定** | `vector(1536)` 的维度是列类型的一部分，数据库强制；换模型/换维度 = 数据迁移（改列类型 + 全量重嵌入 + 重建索引），不是改环境变量；本项目在三处设防（迁移 / `EMBEDDING_DIMENSIONS` / 注释） | **首次教学于本篇** |
| **Prisma `Unsupported` 逃生舱** | Prisma 不原生支持 `vector`；`Unsupported("vector(1536)")?` 让它「能建列、不能读写」；本质是「Prisma 建表，向量走 `$queryRaw` / `$executeRaw`」；字段不出现在 Client 上，误用是编译错误；参数化模板 `${}` 不是字符串拼接 | **首次教学于本篇** |
| **SQLAlchemy `pgvector.sqlalchemy.Vector(1536)` 与两端差异** | Python 有原生类型（可 ORM 读写 `list[float]`），Prisma 没有；但迁移所有权在 Prisma，Python 的 `Vector(1536)` 只做映射、不建表；本项目 Python 侧仍用原生 SQL 以与 TS 的 SQL / 向量文本逐字节同构 | **首次教学于本篇** |
| **HNSW 索引（ANN）** | 精确最近邻 `O(N×d)` 不可扩展；HNSW = 分层可导航小世界，查询近似 `O(log N)`，牺牲少量召回；`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`；算子类必须匹配运算符（`<=>` ↔ `vector_cosine_ops`）；`m` / `ef_construction` / `hnsw.ef_search` 的取舍；小数据量可能仍走 Seq Scan | **首次教学于本篇** |
| **`prisma migrate dev` 会 `DROP INDEX "chunks_embedding_hnsw"`** | 影子数据库重放迁移后含手工索引，而 `schema.prisma` 无法声明 HNSW，diff 生成 `DROP INDEX`；处理：生成后检查迁移并删掉该行；已应用则手工 `CREATE INDEX IF NOT EXISTS`；长期习惯是每次迁移后看 `\di` | **首次教学于本篇** |
| **三表关系与三级级联** | `users → knowledge_bases → documents → chunks`（1:N:N:N）；`owner_id` 归属隔离 + 404；`chunks.knowledge_base_id` 为检索用冗余列（有索引、无外键）；三级 `ON DELETE CASCADE` 由数据库执行；ORM 级联与 DB 级联是两层（Python `db.delete` 需 `passive_deletes`） | **首次教学于本篇** |
| **8 个接口的契约设计** | 资源化分组（知识库 / 文档 / 检索动作）；上传用 `multipart/form-data` + `format: binary` + 字段名 `file`（文件是二进制流，Base64 膨胀 33%、不便流式）；列表返回 `documentCount` 而非嵌套文档（体积恒定、避免 N+1、分页清晰）；`score = 1 - distance`；`topK` 上限 20；超限 400 而非 413 | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲：OpenAPI / `$ref` / `additionalProperties` / `enum` 见 `00-项目初始化/04`；Prisma 三件套、`migrate dev`、schema-first 见 `01-账号与认证/02`；`@relation` / `onDelete: Cascade` / `@@index` 见 `02-应用管理/02`；`DeclarativeBase` / `Mapped` / `mapped_column` / Engine-Session 见 `01-账号与认证/04`；`relationship` / `back_populates` / cascade 两层 / `server_default` vs `default` 见 `02-应用管理/04`；错误信封与 404 惯例见 `01-账号与认证/01`、`02-应用管理/01`；错误文案唯一真源的做法见 `02-应用管理/07`；SSE 帧格式 / 双通道错误 / 「先校验、后开流」见 `04-执行引擎/01`、`05`；`iso_z` 时间规范见 `02-应用管理/07`；Guard / `@CurrentUser` / `FileInterceptor` 的装饰器机制见 `00-项目初始化/05`、`01-账号与认证/03`；`Depends` / `APIRouter` / Pydantic 见 `00-项目初始化/06`、`01-账号与认证/05`。
