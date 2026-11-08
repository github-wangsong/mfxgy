# 01 · 知识库契约与 pgvector 建模（知识库 RAG）

> 阶段 7 · 第 1 步
>
> 做完：契约新增 7 个知识库接口与 `knowledge` 节点数据；Prisma 新增 `KnowledgeBase` / `Document` / `Chunk` 三张表；PostgreSQL 装上 `vector` 扩展、`chunks.embedding` 为 `vector(1536)`、建好 HNSW 余弦索引。本阶段**只建模，不写切分与检索**。
>
> **本篇面试考点**：RAG 的三段式 · 为什么向量维度必须写死 · HNSW vs IVFFlat · `vector_cosine_ops` 与 `<=>` · 为什么 `chunks` 要冗余 `knowledge_base_id` · Prisma 的 `Unsupported` 类型 · 为什么 HNSW 索引要单独用脚本维护 · `status: ready | failed` 的两态设计 · `documentCount` 是聚合还是冗余 · 为什么先定契约再写实现。

---

## 1. RAG 全景与本阶段边界

```text
写入（阶段 7 后半）            读取（阶段 7 后半）              使用（阶段 7 后半）
上传文档                       用户提问 / 节点 query            检索结果 → LLM 上下文
  → 解析文本                     → 向量化 query                   → context 拼进 prompt
  → 切分成 chunk                 → pgvector 余弦检索 top-k
  → 批量 embedding               → 返回 RetrievalHit[]
  → 写入 chunks
```

本篇（`01`）只做**数据与接口的形状**：

| 本篇做 | 后续篇做 |
| --- | --- |
| 7 个 HTTP 接口的契约 | 上传解析、切分、embedding（`02`） |
| `knowledge_bases` / `documents` / `chunks` 表 | 余弦检索 SQL、`knowledge` 节点（`03`） |
| `vector(1536)` 与 HNSW 索引 | Python 对齐、前端知识库页（`04`） |
| `knowledge` 节点的 `data` 契约 | 验收（`05`） |

> **面试考点 · 为什么先定契约，而不是先写“能跑的上传”？**
> 因为 RAG 的返回结构决定了实现方式：
>
> - 如果契约返回 `hits[]`（含 `documentName` / `chunkIndex` / `score`），检索 SQL 就必须 join `documents`；
> - 如果契约只返回 `context: string`，实现可以省掉 join，但前端无法做“命中来源”展示；
> - `topK` 的默认值与上限会直接影响 SQL 的 `LIMIT` 与索引选择。
>
> 先定形状，能避免“实现完再改接口”导致的返工。**契约不是文档，是并行开发的接口。**

---

## 2. 决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 表数量 | 3 张（库 / 文档 / 分块） | 库管归属、文档管文件、chunk 管检索粒度 |
| 向量列 | `chunks.embedding vector(1536)` | pgvector 的 `vector(N)` 维度不可变；1536 是 `text-embedding-3-small` 的默认维度 |
| 索引 | HNSW + `vector_cosine_ops` | 近似最近邻；余弦距离与“语义相似度”直觉一致 |
| 冗余字段 | `chunks.knowledge_base_id` | 检索直接按库过滤，避免 join `documents` |
| 文档状态 | `status: ready \| failed` | 同步处理成功即 `ready`；失败留痕（`error_message`） |
| 上传限制 | `.txt/.md/.markdown` 或 `text/*`，≤1MB | 只支持纯文本，避免解析二进制 |
| 检索参数 | `topK` 默认 4、范围 1~20 | 小到能塞进 prompt，大到仍有选择空间 |
| 列表排序 | `updatedAt` 倒序 | 最近编辑的库在最前 |
| 归属校验 | 一律 `ownerId = currentUser` | 越权统一 404（不泄露存在性） |

> **面试考点 · 为什么 `chunks` 要冗余 `knowledge_base_id`？**
> 检索 SQL 是：
>
> ```sql
> SELECT ... FROM chunks
> WHERE knowledge_base_id = $1
> ORDER BY embedding <=> $2
> LIMIT $3;
> ```
>
> 如果不冗余，就得：
>
> ```sql
> FROM chunks c JOIN documents d ON d.id = c.document_id
> WHERE d.knowledge_base_id = $1
> ```
>
> 冗余的收益：
>
> - 少一次 join，索引能直接建在 `(knowledge_base_id)` 上；
> - HNSW 检索时过滤条件更简单（PG 可以先按普通索引缩小范围）。
>
> 冗余的代价：**一致性风险**——`chunk.knowledge_base_id` 必须永远等于其文档的 `knowledge_base_id`。
> 本项目通过“写入时从文档复制”保证，且不提供“移动文档到另一个库”的功能。**冗余字段必须有明确的写入约束，否则迟早不一致。**

---

## 3. 契约 `0.7.0 → 0.8.0`

### 3.1 七个接口

| 方法 | 路径 | 成功 | 说明 |
| --- | --- | --- | --- |
| GET | `/knowledge-bases` | 200 | 列表（含 `documentCount`） |
| POST | `/knowledge-bases` | 201 | 创建 |
| GET | `/knowledge-bases/{id}` | 200 | 详情（仅本人） |
| DELETE | `/knowledge-bases/{id}` | 204 | 级联删文档与分块 |
| GET | `/knowledge-bases/{id}/documents` | 200 | 文档列表 |
| POST | `/knowledge-bases/{id}/documents` | 201 | 上传（multipart，字段名 `file`） |
| DELETE | `/knowledge-bases/{id}/documents/{documentId}` | 204 | 级联删分块 |
| POST | `/knowledge-bases/{id}/search` | 200 | 向量检索 |

**完整文件路径：`packages/contract/openapi.yaml`**（节选，全部 `security: bearerAuth`）

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

### 3.2 七个 schema

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
        updatedAt:
          type: string
          format: date-time

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

### 3.3 `knowledge` 节点

同一张图里，`knowledge` 节点负责“检索并把结果拼成上下文”：

```yaml
    KnowledgeNodeData:
      type: object
      additionalProperties: false
      required: [title, knowledgeBaseId, query]
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

输出（`node_finished.output`）：

```yaml
    KnowledgeNodeOutput:
      type: object
      additionalProperties: false
      required: [chunks, context]
      properties:
        chunks:
          type: array
          items:
            $ref: "#/components/schemas/RetrievalHit"
        context:
          type: string
          description: 各 chunk 的 `content` 以 "\n\n" 连接（两端一致）
```

> **面试考点 · `score` 为什么是“余弦相似度”而不是“距离”？**
> pgvector 的 `<=>` 返回**余弦距离**（0 最相似，2 最不相似）。契约里展示的是相似度 `1 - distance`（1 最相似，-1 最不相似），更符合直觉。
> 关键：**索引与 SQL 用距离，接口用相似度**，转换只在一处发生（`03` 篇）。
> 如果混用，会出现“分数越大越不相关”的反直觉结果，前端排序一改就错。

### 3.4 TS 类型

**完整文件路径：`packages/contract/src/index.ts`**（阶段 7 新增，节选）

```ts
/** 知识库对外视图（`GET /knowledge-bases` 等）。 */
export interface KnowledgeBaseResponse {
  id: string
  name: string
  /** 空描述统一序列化为 `null` */
  description: string | null
  /** 该知识库下的文档数 */
  documentCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeBaseListResponse {
  items: KnowledgeBaseResponse[]
}

/** 1-80 位名称，描述最多 500 位 */
export interface CreateKnowledgeBaseRequest {
  name: string
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
  createdAt: string
}

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

export interface SearchKnowledgeBaseRequest {
  /** 1-2000 位 */
  query: string
  /** 1-20，默认 4 */
  topK?: number
}

export interface SearchKnowledgeBaseResponse {
  query: string
  topK: number
  hits: RetrievalHit[]
}

/** `knowledge` 节点的 `data` 形状。 */
export interface KnowledgeNodeData {
  title: string
  knowledgeBaseId: string
  /** 支持 `{{ path }}` 模板 */
  query: string
  /** 1-20 */
  topK?: number
}

/** `knowledge` 节点输出：`context` 为各 chunk 的 `content` 以 "\n\n" 连接。 */
export interface KnowledgeNodeOutput {
  chunks: RetrievalHit[]
  context: string
}
```

```ts
export const CONTRACT_VERSION = '0.8.0'
```

---

## 4. Prisma 建模

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**（阶段 7 增量）

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
  embedding       Unsupported("vector(1536)")?
  createdAt       DateTime @default(now()) @map("created_at")

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([knowledgeBaseId])
  @@map("chunks")
}
```

`User` 增加反向关系：

```prisma
model User {
  // ...
  apps           App[]
  knowledgeBases KnowledgeBase[]
}
```

### 4.1 迁移 SQL

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
CREATE INDEX "documents_knowledge_base_id_idx" ON "documents"("knowledge_base_id");
CREATE INDEX "chunks_knowledge_base_id_idx" ON "chunks"("knowledge_base_id");

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledge_base_id_fkey"
  FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 阶段 7：向量检索索引（HNSW + 余弦距离）。
-- 必须放在 `chunks.embedding` 列创建之后；维度固定 1536，与 Schema 的 Unsupported("vector(1536)") 一致。
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
```

三处需要单独说明：

1. **`CREATE EXTENSION IF NOT EXISTS vector`**：Prisma 不会生成，必须手写。没有它，`vector(1536)` 直接报 `type "vector" does not exist`。
2. **`embedding` 可空**：写入流程是“先插 chunk 文本、再批量写向量”（`02` 篇），中间态必须允许 `NULL`。
3. **HNSW 索引写在迁移里**：新环境一次 `migrate deploy` 就能得到可用索引。

### 4.2 为什么还有 `prisma/sql/hnsw.sql`

**完整文件路径：`apps/api-ts/prisma/sql/hnsw.sql`**

```sql
-- 手工维护的 pgvector 索引（**不要**让 Prisma 管理它）
--
-- 为什么单独放一个文件：
--   Prisma 的 `migrate dev` 不认识手工用 CREATE INDEX 建的 HNSW 索引。
--   下次跑 `prisma migrate dev` 时会检测到「数据库里多了一个 schema 里没有的对象」，
--   并自动生成一条 `DROP INDEX "chunks_embedding_hnsw"` 的迁移 —— 删掉检索性能就没了。
--
-- 处理流程（每次跑完 migrate 后）：
--   1. 检查是否生成了 DROP INDEX 的迁移，有则**删除该迁移目录**；
--   2. 执行 `pnpm --filter @mini-dify/api-ts db:index` 重建索引（幂等，可重复执行）；
--   3. `\di` 确认 `chunks_embedding_hnsw` 仍在。

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks
  USING hnsw (embedding vector_cosine_ops);
```

脚本：

```json
"db:index": "prisma db execute --file prisma/sql/hnsw.sql --schema prisma/schema.prisma"
```

> **面试考点 · 为什么 Prisma 会想删掉这个索引？**
> Prisma 的迁移模型是“schema.prisma 是唯一真源”：它会对比“数据库里有什么”和“schema 里声明了什么”，多出来的对象会被视为漂移。
> 但 Prisma **无法在 schema 里声明 HNSW 索引**（它只支持 B-tree / GIN 等标准索引），所以这个索引在 Prisma 眼里“不该存在”。
> 处理方式有三种：
>
> 1. 每次 `migrate dev` 后删掉自动生成的 `DROP INDEX` 迁移（本项目）；
> 2. 用 `prisma migrate diff` + 手工校验，禁止自动生成；
> 3. 不用 `migrate dev` 开发，改用 `db push` + 独立 SQL 脚本（放弃迁移历史）。
>
> 本项目选 1，因为**迁移历史可读**比“全自动”更重要；代价是要记住这个坑。

> **面试考点 · 维度为什么必须写死？**
> `vector(N)` 的 N 是**列类型的一部分**，不是数据校验：
>
> - 插入 1024 维向量 → `ERROR: expected 1536 dimensions, not 1024`；
> - 想换模型（如 3072 维）必须 `ALTER TABLE ... TYPE vector(3072)`，且**已有向量全部要重算**、索引要重建。
>
> 所以选模型时就要确定维度，并把它写进迁移。代码里的 `EMBEDDING_DIMENSIONS = 1536` 只是**运行期护栏**（发现维度不符就报错），不是“可以随便改的配置”。

### 4.3 嵌入配置

**完整文件路径：`apps/api-ts/src/rag/embedding.service.ts`**（阶段 7 新增，节选）

```ts
/** 向量维度**固定 1536**：必须与 `chunks.embedding vector(1536)` 及 HNSW 索引一致。 */
export const EMBEDDING_DIMENSIONS = 1536

/** 默认嵌入模型（可用环境变量 `EMBEDDING_MODEL` 覆盖）。 */
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * 批量文本向量化（阶段 7）。
 *
 * 复用 LLM 的 provider 配置：`LLM_API_KEY` / `LLM_BASE_URL`；
 * 模型取 `EMBEDDING_MODEL`，缺省 `text-embedding-3-small`。
 * `maxRetries: 0` 与阶段 5 的 LLM 调用对齐（避免 5xx / 超时长时间挂起）。
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }
  const apiKey = process.env.LLM_API_KEY ?? ''
  if (apiKey === '') {
    throw new RunError('embedding provider not configured: LLM_API_KEY')
  }

  const client = new OpenAIEmbeddings({
    apiKey,
    model: process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    configuration: {
      baseURL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      maxRetries: 0,
    },
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  })

  let vectors: number[][]
  try {
    vectors = await client.embedDocuments(texts)
  } catch (error) {
    throw new RunError(mapEmbeddingError(error))
  }

  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      // eslint-disable-next-line no-console
      console.error(
        `embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${Array.isArray(vector) ? vector.length : 'non-array'}; ` +
          `check EMBEDDING_MODEL / provider output (vector(1536) is fixed in migrations)`,
      )
      throw new RunError('embedding request failed: unknown')
    }
  }
  return vectors
}
```

`.env.example` 增加一行：

```dotenv
# 嵌入模型（阶段 7）：复用 LLM_API_KEY / LLM_BASE_URL；向量维度固定 1536
EMBEDDING_MODEL=text-embedding-3-small
```

> **面试考点 · 为什么 embedding 复用 `LLM_API_KEY`，而不是单独一组密钥？**
> - 本项目默认两类模型来自**同一个 provider**（OpenAI 兼容），一次配置更简单；
> - 单独拆开会让“只想试 RAG 的人”多配一次；
> - 真要分开时，再引入 `EMBEDDING_API_KEY` 即可（向后兼容：缺省回退到 `LLM_API_KEY`）。
>
> **配置项的数量要跟“真实差异”匹配，而不是跟“理论上的独立性”匹配。**

---

## 5. 迁移与验证

### 5.1 建表

```powershell
# 1. 数据库在跑
docker compose ps

# 2. 生成并应用迁移
pnpm --filter @mini-dify/api-ts db:migrate

# 3. 重新生成 Prisma Client（schema 变了）
pnpm --filter @mini-dify/api-ts db:generate
```

`db:migrate` 会提示输入迁移名，填 `add_knowledge_base`。

### 5.2 结构检查

```powershell
docker compose exec postgres psql -U minidify -d minidify -c "\d chunks"
```

预期关键行：

```text
 embedding      | vector(1536)  |           |          |
```

```powershell
docker compose exec postgres psql -U minidify -d minidify -c "\dx vector"
```

预期 `vector` 扩展存在。

```powershell
docker compose exec postgres psql -U minidify -d minidify -c "\di chunks_embedding_hnsw"
```

预期索引存在，类型为 `hnsw`：

```text
 chunks_embedding_hnsw | ... | hnsw (embedding vector_cosine_ops)
```

### 5.3 维度护栏

```powershell
docker compose exec postgres psql -U minidify -d minidify -c `
  "select array_fill(0.1, ARRAY[1024])::vector(1536);"
```

预期报错：

```text
ERROR:  expected 1536 dimensions, not 1024
```

> 这行测试证明**维度是数据库强制的**，不是应用层约定。即使有人绕过代码直接写库，也写不进错误维度。

### 5.4 HNSW 索引漂移演练

```powershell
# 随便改一行注释触发 Prisma 对比（或直接改 schema 再加回）
pnpm --filter @mini-dify/api-ts db:migrate
```

如果 Prisma 生成了 `DROP INDEX "chunks_embedding_hnsw"` 的迁移：

```text
1. 删除那个迁移目录（不要 apply）
2. pnpm --filter @mini-dify/api-ts db:index
3. \di 确认索引还在
```

> 这一步不是“可选学习”，而是**每个开发者都会遇到**的坑。不知道它，某天索引就没了，检索从 10ms 变成 800ms，还找不到原因。

### 5.5 契约构建

```powershell
pnpm --filter @mini-dify/contract build
pnpm --filter @mini-dify/api-ts exec tsc --noEmit
Select-String -Path packages/contract/openapi.yaml -Pattern 'version: 0.8.0'
```

---

## 6. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| RAG 三段式 | 写入（切分+向量）、检索（top-k）、生成（上下文） |
| 为什么先契约 | 返回结构决定 join、LIMIT、前端展示 |
| 维度写死 | `vector(N)` 是列类型；换维度要迁移+重算+重建索引 |
| HNSW vs IVFFlat | HNSW 查询快、构建慢、内存高；IVFFlat 需训练、参数敏感 |
| `vector_cosine_ops` | 服务余弦距离 `<=>`，与检索 SQL 一致 |
| 冗余 `knowledge_base_id` | 少 join、索引直接生效；需写入约束 |
| Prisma `Unsupported` | 只声明列，不管理索引；HNSW 靠 SQL 脚本 |
| 索引漂移 | Prisma 会生成 `DROP INDEX`，要删迁移并重建 |
| `embedding` 可空 | 支持“先写文本、后写向量”的两步流程 |
| `status` 两态 | 同步上传成功即 ready；失败留 `error_message` |
| `documentCount` | 聚合计数（`_count`），不冗余存储 |
| 密钥复用 | 同一 provider 复用 `LLM_API_KEY`，缺省可回退 |

---

## 7. 下一步

- `02-文档切分与向量化.md`：上传校验、文本解码、切分参数、批量 embedding、事务写入、`status/chunkCount`。
- `03-NestJS检索与检索节点.md`：`<=>` 检索 SQL、`1 - distance`、`knowledge` 节点与 `retrieval` 事件。
- `04-Python对齐与前端知识库页.md`：SQLAlchemy `Vector` 映射、同一检索、上传/列表/检索调试页。
- `05-验收.md`：上传、命中、跨后端一致、无密钥降级。
