# 03 · NestJS：检索与检索节点

> 所属：阶段 7 · 知识库 RAG
> 本篇覆盖：`POST /knowledge-bases/{id}/search` 的整条检索链路（嵌入 → 原生 SQL 余弦检索 → `{query, topK, hits}`）；向量**写入**的 SQL 路径（`$executeRaw` + `'[...]'::vector`）；`searchChunks` 如何被 HTTP 接口与 `knowledge` 节点**共用**；`knowledge` 节点在 LangGraph 里的位置与事件；`retrieval` 事件的动机；节点输出 `{chunks, context}`；运行前预检（缺失 / 未知 / 越界 / 归属）。
> **本篇首次教学（本阶段的学习核心）：① Prisma 的 `Unsupported("vector(1536)")` 为什么迫使向量读写走原生 SQL；② `$executeRaw` / `$queryRaw` 的标签模板与 `$n::vector` 强转；③ 向量为什么以字符串 `'[0.1,0.2,...]'` 传入（直接传 JS 数组会在 `<=>` 处报 `operator does not exist: vector <=> numeric[]`）；④ 余弦距离 `<=>`：`distance = 1 - cosine_similarity` ⇒ `score = 1 - distance`；⑤ `ORDER BY embedding <=> $n` 是「距离升序 = 最相似在前」（方向极易写反）；⑥ `EXPLAIN` 视角：HNSW 近似最近邻，小数据量下 PG 仍可能走顺序扫描 / 排序（这是正常的）；⑦ 检索 SQL 的 `chunks JOIN documents` 与「归属过滤必须在 SQL 里」；⑧ `knowledge` 是**普通节点**（无环），事件顺序 `node_started → retrieval → node_finished`；⑨ `retrieval` 事件的设计动机；⑩ 输出 `{chunks, context}` 与 `"\n\n"` 连接（两端必须一致）；⑪ 预检把四类错误挡在**开流之前**；⑫ `ownerId` 必须一路传进预检。**
> **不重讲**：SSE 帧格式与「先校验、后开流」见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；模板解析与变量池见 `04-执行引擎/03-节点运行时与变量池.md`；`Annotation` / 动态建图 / 条件边见 `04-执行引擎/02-LangGraph编译图-TS.md`、`06-工具调用/02-NestJS-ReAct循环与条件边.md`；Prisma schema / 迁移三件套见 `01-账号与认证/02-Prisma.md`；归属 404 惯例见 `02-应用管理/03-NestJS应用模块.md`；外部依赖错误的规范化映射模式见 `05-LLM节点/03-LLM错误映射.md`。本阶段第 `01` 篇（契约扩展）与第 `02` 篇（Prisma/pgvector 建模）负责表结构、索引与 embedding 服务本身，本篇只引用不重讲。

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 本篇在阶段 7 的位置

阶段 7 之前，图里的节点只有 `start` / `llm` / `end` 三种。阶段 7 新增第四种节点 `knowledge`，让工作流能「先去知识库里查资料，再让模型基于资料回答」：

```
START → start_1 → kb1(knowledge) → llm1（prompt 里用 {{ kb1.context }}） → end_1 → END
```

RAG（Retrieval-Augmented Generation）的「R」就发生在 `kb1` 里：**把用户问题变成向量，去向量库里找最相近的文本块，再把文本块塞进 prompt**。本篇只讲 TS/NestJS 端的**检索**与**检索节点**；知识库 CRUD、文档上传、切分、embedding 服务与前端页面分别由本阶段其他篇目负责。

阶段 7 有**两个入口**会走到同一段检索 SQL：

| 入口 | 调用链 | 失败通道 | 返回形状 |
| --- | --- | --- | --- |
| `POST /knowledge-bases/{id}/search` | `KbService.search` → `embedOrBadRequest` → `searchChunks` | 普通 JSON `400` | `{ query, topK, hits }` |
| `POST /apps/{id}/run` 且图里有 `knowledge` 节点 | `runKnowledgeNode` → `embedTexts` → `searchChunks` | SSE 流内 `run_failed` | 节点输出 `{ chunks, context }` + 一次 `retrieval` 事件 |

**同一段 SQL，两种错误通道**——这是理解本篇的关键分界：HTTP 接口是「一次资源访问」，错误用状态码表达；图运行已经开了（或即将开）SSE 流，运行期错误只能用 `run_failed` 表达。

---

## 1. 本篇目标

- 能说清向量**写入**为什么必须走 `$executeRaw`，以及 `'[...]'::vector` 每个字符的作用。
- 能独立写出「按余弦相似度取 topK」的 SQL，并保证**方向正确**（最相似在前）。
- 能用 `EXPLAIN` 判断「到底走没走 HNSW」，并解释小数据量下没走是正常的。
- 能说清检索 SQL 里 `JOIN documents` 与 `WHERE knowledge_base_id` 各自解决什么问题。
- 能说清 `knowledge` 节点为什么是普通节点、事件为什么是 `node_started → retrieval → node_finished`。
- 能说清 `retrieval` 事件与 `node_finished.output` 的分工，以及 `context` 为什么额外存在。
- 能列出 `knowledge` 节点的全部预检错误，并解释归属校验为什么必须带 `ownerId`。

**验收标准**

1. `pnpm --filter @mini-dify/api-ts build` 通过。
2. `POST /knowledge-bases/{id}/search {"query":"退款怎么申请","topK":3}` 返回 3 条命中，`score` **降序**，top1/top2 都来自 `refund.txt`，第 3 条是无关的 `invoice.txt` 且分数明显更低（§19.1）。
3. 图运行 SSE 中，`kb1` 节点的事件顺序为 `node_started` → `retrieval` → `node_finished`，且 `retrieval.hits` 与 `node_finished.output.chunks` 相同（§19.2）。
4. `node_finished.output.context` 等于各 chunk 的 `content` 用 `"\n\n"` 连接（§19.2）。
5. 三类预检错误在**开流前**返回 400，文案逐字正确（§19.3）。
6. B 用户访问 A 的知识库 → `404 Knowledge base not found`（§19.4）。
7. 上传超过 1MB → `400 Document too large`（§19.5）。
8. 用 `EXPLAIN` 能看到「小数据量→排序 / 顺序扫描」与「强制关掉排序→HNSW」两种计划（§19.6）。

---

## 2. 前置条件

- 阶段 3 已完成：`Graph` 的 JSON 模型、草稿存取、`validateGraph`。
- 阶段 4 已完成：`engine.service.ts` 能把图编译成 LangGraph 并输出 SSE 事件。
- 阶段 5/6 已完成：`llm` 节点、`.env` 里的 provider 配置（`LLM_API_KEY` / `LLM_BASE_URL`）。
- 本阶段第 `01` 篇已完成：契约里有 `knowledge` 节点类型、`RetrievalHit`、`retrieval` 事件。
- 本阶段第 `02` 篇已完成：数据库里有 `knowledge_bases` / `documents` / `chunks` 三张表、`vector(1536)` 列与 HNSW 索引；本地已执行迁移（`docker ps` 能看到 `mini-dify-db`，`\d chunks` 能看到 `chunks_embedding_hnsw`）。
- `apps/api-ts/.env` 里 `LLM_API_KEY` 非空（嵌入复用同一个 key）；否则 HTTP 检索会 400、节点运行会 `run_failed`。

---

## 3. 命令清单

> 除特别注明外，命令均在仓库根 `d:\user\my_project\github\mini-dify` 执行。Windows PowerShell 的续行符是反引号 `` ` ``。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 编译契约（`KnowledgeNodeData` / `RetrievalHit` / `retrieval`） | 无报错 |
| `pnpm --filter @mini-dify/api-ts db:migrate` | 仓库根 | 应用本阶段迁移（含 `CREATE EXTENSION vector` 与 HNSW 索引） | `Already in sync` 或迁移成功 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 编译 NestJS，验证原生 SQL 与节点类型 | 无报错 |
| `pnpm --filter @mini-dify/api-ts start:dev` | 仓库根 | 启动 api-ts（读 `apps/api-ts/.env`） | 监听 `http://localhost:3001` |
| `curl.exe -X POST .../knowledge-bases/{id}/search` | 任一端 | 直接验证检索接口 | JSON，`hits` 按 `score` 降序 |
| `curl.exe -N -X POST .../apps/{id}/run` | 任一端 | 逐帧看 `knowledge` 节点事件 | `node_started` → `retrieval` → `node_finished` |
| `docker exec ... psql ... "EXPLAIN ..."` | 仓库根 | 看检索 SQL 的执行计划 | 小数据量下多为 Sort / Seq Scan |
| `docker exec ... psql ... "\d chunks"` | 仓库根 | 确认 HNSW 索引存在 | `chunks_embedding_hnsw hnsw (embedding vector_cosine_ops)` |

`apps/api-ts/.env` 里与检索相关的三项：

```dotenv
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
```

---

## 4. 先看清：两条路径共用一个检索函数

```
HTTP：  POST /knowledge-bases/:id/search
          → KbController.search（JwtAuthGuard + SearchKnowledgeBaseDto 校验）
          → KbService.search
              → findOwned(ownerId, id)            ← 归属不符 404
              → embedOrBadRequest([query])        ← 嵌入失败转 400
              → searchChunks(prisma, kbId, vec, limit)
          ← { query, topK, hits }

图运行：POST /apps/:id/run
          → EngineService.run（预检：含 validateKnowledgeNodes）
          → execute() 开流
          → makeNodeAction(kb1)
              → node_started(kb1, "knowledge")
              → executeNode → runKnowledgeNode
                  → renderTemplate(data.query, pool)
                  → embedTexts([query])           ← 失败抛 RunError → run_failed
                  → searchChunks(prisma, kbId, vec, topK)
                  → emitRetrieval(hits, topK)     ← retrieval 事件
                  → { chunks, context }
              → node_finished(kb1, "knowledge", output)
          ← SSE
```

**为什么把 SQL 抽成自由函数 `searchChunks`**：它有两个调用方，且都不应该拥有「检索 SQL」的副本。SQL 只有一个真源，方向写反、漏掉 `WHERE` 之类的问题只需要修一处；Python 侧也按同一函数边界组织（`apps/api-py/app/rag/service.py` 的 `search_chunks`），方便逐行对照。

---

## 5. 完整代码：知识库服务（kb.service.ts）

这个文件包含 CRUD、上传、删除、检索。本篇重点看三处：`upload` 里的向量写入、`searchChunks`、`toVectorLiteral`。

**完整文件路径：`apps/api-ts/src/rag/kb.service.ts`**

```ts
import { randomUUID } from 'node:crypto'

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  DocumentListResponse,
  DocumentResponse,
  KnowledgeBaseListResponse,
  KnowledgeBaseResponse,
  RetrievalHit,
  SearchKnowledgeBaseResponse,
} from '@mini-dify/contract'

import { PrismaService } from '../prisma/prisma.service'
import { embedTexts } from './embedding.service'
import { splitText } from './splitter'

/** 单文档大小上限：1MB（FileInterceptor 与本服务各兜一层）。 */
export const MAX_DOCUMENT_BYTES = 1024 * 1024

/** 知识库名字长度上限（字符数）。 */
const MAX_KNOWLEDGE_BASE_NAME_LENGTH = 80

/** 检索默认 topK（契约 `default: 4`）。 */
const DEFAULT_TOP_K = 4

/** 允许的扩展名（大小写不敏感）。 */
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.markdown']

/** 上传文件的基本形状（`@types/multer` 的 `Express.Multer.File`）。 */
type UploadedDocument = Pick<Express.Multer.File, 'originalname' | 'mimetype' | 'size' | 'buffer'>

/**
 * 知识库（阶段 7）读写：CRUD + 文档上传/删除 + 向量检索。
 *
 * 归属校验与 `/apps` 一致：查不到、或不属于当前用户，一律 404（不泄露存在性）。
 * 向量读写**只用原生 SQL**：Prisma 不支持 pgvector 类型（`Chunk.embedding` 为 `Unsupported`）。
 */
@Injectable()
export class KbService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<KnowledgeBaseListResponse> {
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { documents: true } } },
    })
    return { items: knowledgeBases.map((kb) => toKnowledgeBaseResponse(kb)) }
  }

  async create(ownerId: string, name: string | undefined, description?: string): Promise<KnowledgeBaseResponse> {
    const trimmed = (name ?? '').trim()
    if (trimmed === '') {
      throw new BadRequestException('Knowledge base name is required')
    }
    if ([...trimmed].length > MAX_KNOWLEDGE_BASE_NAME_LENGTH) {
      throw new BadRequestException('Knowledge base name is too long')
    }
    const kb = await this.prisma.knowledgeBase.create({
      data: { ownerId, name: trimmed, description },
      include: { _count: { select: { documents: true } } },
    })
    return toKnowledgeBaseResponse(kb)
  }

  async get(ownerId: string, id: string): Promise<KnowledgeBaseResponse> {
    return toKnowledgeBaseResponse(await this.findOwned(ownerId, id))
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwned(ownerId, id)
    await this.prisma.knowledgeBase.delete({ where: { id } })
  }

  async listDocuments(ownerId: string, knowledgeBaseId: string): Promise<DocumentListResponse> {
    await this.findOwned(ownerId, knowledgeBaseId)
    const documents = await this.prisma.document.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: 'asc' },
    })
    return { items: documents.map((document) => toDocumentResponse(document)) }
  }

  async deleteDocument(ownerId: string, knowledgeBaseId: string, documentId: string): Promise<void> {
    await this.findOwned(ownerId, knowledgeBaseId)
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, knowledgeBaseId },
    })
    if (document === null) {
      throw new NotFoundException('Document not found')
    }
    await this.prisma.document.delete({ where: { id: documentId } })
  }

  /**
   * 上传并处理：校验类型/大小/空 → 切分 → 批量嵌入 → 事务写 `documents` + `chunks` → 更新 `chunkCount`。
   *
   * 嵌入失败（含未配置密钥）映射为 400 规范文案（见 error-messages.md §7）。
   */
  async upload(
    ownerId: string,
    knowledgeBaseId: string,
    file: UploadedDocument | undefined,
  ): Promise<DocumentResponse> {
    await this.findOwned(ownerId, knowledgeBaseId)
    if (file === undefined) {
      throw new BadRequestException('Document is empty')
    }
    const mimeType = file.mimetype && file.mimetype !== '' ? file.mimetype : 'application/octet-stream'
    if (!isSupportedDocument(file.originalname, mimeType)) {
      throw new BadRequestException(`Unsupported document type: ${mimeType}`)
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException('Document too large')
    }
    const content = file.buffer.toString('utf8')
    if (content.trim() === '') {
      throw new BadRequestException('Document is empty')
    }

    const chunks = (await splitText(content)).filter((chunk) => chunk.trim() !== '')
    if (chunks.length === 0) {
      throw new BadRequestException('Document is empty')
    }
    const vectors = await embedOrBadRequest(chunks)

    const documentId = randomUUID()
    await this.prisma.$transaction(async (tx) => {
      await tx.document.create({
        data: {
          id: documentId,
          knowledgeBaseId,
          name: file.originalname,
          mimeType,
          sizeBytes: file.size,
          status: 'ready',
        },
      })
      for (let index = 0; index < chunks.length; index += 1) {
        // 向量写入只能走原生 SQL（Prisma 不支持 vector 类型）；字符串字面量再 ::vector。
        await tx.$executeRaw`
          INSERT INTO chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, created_at)
          VALUES (${randomUUID()}, ${documentId}, ${knowledgeBaseId}, ${index}, ${chunks[index]}, ${toVectorLiteral(vectors[index])}::vector, now())
        `
      }
      await tx.document.update({ where: { id: documentId }, data: { chunkCount: chunks.length } })
    })

    const document = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } })
    return toDocumentResponse(document)
  }

  /** 检索：先嵌入 query，再按余弦相似度取 topK。知识库归属不符时 404。 */
  async search(
    ownerId: string,
    knowledgeBaseId: string,
    query: string,
    topK: number | undefined,
  ): Promise<SearchKnowledgeBaseResponse> {
    await this.findOwned(ownerId, knowledgeBaseId)
    const limit = topK ?? DEFAULT_TOP_K
    const [vector] = await embedOrBadRequest([query])
    const hits = await searchChunks(this.prisma, knowledgeBaseId, vector, limit)
    return { query, topK: limit, hits }
  }

  private async findOwned(ownerId: string, id: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: { _count: { select: { documents: true } } },
    })
    if (kb === null || kb.ownerId !== ownerId) {
      throw new NotFoundException('Knowledge base not found')
    }
    return kb
  }
}

/**
 * 按余弦相似度检索分块（原生 SQL；供 KB 检索接口与 `knowledge` 节点共用）。
 *
 * `score = 1 - cosine_distance`，越大越相关；按距离升序（即分数降序）取 `topK`。
 */
export async function searchChunks(
  prisma: PrismaService,
  knowledgeBaseId: string,
  vector: number[],
  topK: number,
): Promise<RetrievalHit[]> {
  const literal = toVectorLiteral(vector)
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
  return rows.map((row) => ({
    documentId: row.document_id,
    documentName: row.document_name,
    chunkIndex: row.chunk_index,
    content: row.content,
    score: Number(row.score),
  }))
}

/** 向量转 pgvector 文本字面量 `[0.1,0.2,...]`（再用 `::vector` 转成向量列）。 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/** 允许的类型：扩展名 `.txt` / `.md` / `.markdown`，或 `content-type` 以 `text/` 开头。 */
function isSupportedDocument(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase()
  if (ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return true
  }
  return mimeType.startsWith('text/')
}

/** 嵌入失败：`RunError` 在对外的普通 JSON 接口里映射为 400 规范文案。 */
async function embedOrBadRequest(texts: string[]): Promise<number[][]> {
  try {
    return await embedTexts(texts)
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : 'embedding request failed: unknown')
  }
}

function toKnowledgeBaseResponse(kb: {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
  _count: { documents: number }
}): KnowledgeBaseResponse {
  return {
    id: kb.id,
    name: kb.name,
    description: kb.description ?? null,
    documentCount: kb._count.documents,
    createdAt: kb.createdAt.toISOString(),
    updatedAt: kb.updatedAt.toISOString(),
  }
}

function toDocumentResponse(document: {
  id: string
  knowledgeBaseId: string
  name: string
  mimeType: string
  sizeBytes: number
  status: string
  errorMessage: string | null
  chunkCount: number
  createdAt: Date
}): DocumentResponse {
  return {
    id: document.id,
    knowledgeBaseId: document.knowledgeBaseId,
    name: document.name,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status as DocumentResponse['status'],
    errorMessage: document.errorMessage ?? null,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt.toISOString(),
  }
}
```

**读这份代码时先抓住 6 件事**：

| 位置 | 做了什么 | 为什么 |
| --- | --- | --- |
| `upload` 的 `$transaction` | 文档、分块、`chunkCount` 三件事一起提交 | 任一向量写入失败 → 整篇回滚，不留下「有文档没有块」的半成品 |
| `upload` 的 `tx.$executeRaw` | 原生 INSERT，向量以字符串 + `::vector` 写入 | Prisma Client 无法读写 `Unsupported` 的 `embedding` 列 |
| `searchChunks` | `$queryRaw` 原生 SELECT，`1 - (embedding <=> $n)` | 同样的原因；且只有原生 SQL 才能用 pgvector 的距离算子 |
| `searchChunks` 的 `JOIN` | `chunks c JOIN documents d` | 命中要带 `documentName` 给前端展示引用 |
| `searchChunks` 的 `WHERE` | `c.knowledge_base_id = $n` | 限定只在本知识库内取 topK；同时是**归属隔离的最后一层** |
| `embedOrBadRequest` | 把 `RunError` 包成 `BadRequestException` | HTTP 接口的错误通道是 400 JSON（节点不这么做，见 §15.3） |

---

## 6. 完整代码：知识库控制器（kb.controller.ts）

本篇关心两个路由：`POST /:id/search`（检索）与 `POST /:id/documents`（上传，顺带解释 1MB 上限的错误归一）。

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

**要点**：

- `@Post(':id/search')` 必须显式 `@HttpCode(200)`：NestJS 的 `POST` 默认返回 **201**，而契约写的是 200。
- `payload.sub` 是 JWT 的 `sub`（用户 id）——**每一次**服务调用都带着它，归属校验才有依据。
- `@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))` 是第一层 1MB 限制；超限时 Multer 抛 `PayloadTooLargeException`（413），`@UseFilters(UploadTooLargeFilter)` 把它归一成契约要求的 `400 Document too large`。业务层 `upload()` 里还有第二层 `file.size > MAX_DOCUMENT_BYTES` 检查，兜住「绕过拦截器」的情况。
- 检索请求体由全局 `ValidationPipe` 校验（`query` 1..2000、`topK` 1..20，见 `SearchKnowledgeBaseDto`），错误文案走 `packages/contract/error-messages.md` §1 的统一规则。

---

## 7. 完整代码：`knowledge` 节点（knowledge.node.ts）

这个文件只有 30 多行，但它是「检索」进入执行引擎的全部胶水。

**完整文件路径：`apps/api-ts/src/engine/nodes/knowledge.node.ts`**

```ts
import type { GraphNode, KnowledgeNodeData, RetrievalHit } from '@mini-dify/contract'

import { PrismaService } from '../../prisma/prisma.service'
import { embedTexts } from '../../rag/embedding.service'
import { searchChunks } from '../../rag/kb.service'
import { renderTemplate, type Pool } from '../template'

/** `knowledge.data.topK` 的默认值（与契约 `default: 4` 一致）。 */
export const DEFAULT_KNOWLEDGE_TOP_K = 4

/**
 * `knowledge` 节点（阶段 7）：渲染 `data.query` → 嵌入 → 按余弦相似度检索 → 发一次 `retrieval`。
 *
 * 输出 `{ chunks: RetrievalHit[], context: string }`，`context` 为各 chunk 的 `content`
 * 以 `"\n\n"` 连接（两端逐字节一致）。预检已在 `EngineService.run` 验证归属与 `topK`。
 * 嵌入失败抛 `RunError`（规范文案见 error-messages.md §7.3），由引擎转成 `run_failed`。
 */
export async function runKnowledgeNode(
  node: GraphNode,
  pool: Pool,
  prisma: PrismaService,
  emitRetrieval: (hits: RetrievalHit[], topK: number) => void,
): Promise<Record<string, unknown>> {
  const data = node.data as unknown as KnowledgeNodeData
  const query = renderTemplate(data.query, pool)
  const topK = typeof data.topK === 'number' ? data.topK : DEFAULT_KNOWLEDGE_TOP_K

  const [vector] = await embedTexts([query])
  const hits = await searchChunks(prisma, data.knowledgeBaseId, vector, topK)
  emitRetrieval(hits, topK)

  return {
    chunks: hits,
    context: hits.map((hit) => hit.content).join('\n\n'),
  }
}
```

**逐行读法**：

| 行 | 作用 | 注意 |
| --- | --- | --- |
| `renderTemplate(data.query, pool)` | 把 `{{ start_1.question }}` 换成真实问题 | 变量池与模板语义见 `04-执行引擎/03-节点运行时与变量池.md`；路径不存在会抛 `template variable not found: {path}` |
| `typeof data.topK === 'number' ? ... : 4` | 缺省值 4 | 预检已保证「传了就是 1..20 的整数」 |
| `embedTexts([query])` | 调 embedding provider | **直接用** `embedTexts`，不是 `embedOrBadRequest`——这里要的是 `RunError`，由引擎转成流内 `run_failed` |
| `searchChunks(prisma, data.knowledgeBaseId, vector, topK)` | 与 HTTP 接口完全相同的 SQL | `knowledgeBaseId` 的归属已在预检确认 |
| `emitRetrieval(hits, topK)` | 发一次 `retrieval` 事件 | 必须在返回输出**之前**发，事件顺序才是 `retrieval → node_finished` |
| `context: ...join('\n\n')` | 给下游 prompt 用的纯文本 | 分隔符与 Python 侧**逐字节一致**，不能改成 `\n` 或 `\n\n\n` |

---

## 8. 引擎增量：`knowledge` 如何接进图（engine.service.ts）

`engine.service.ts` 在阶段 6 已经完整讲过（见 `06-工具调用/02-NestJS-ReAct循环与条件边.md` §8）。阶段 7 只加了**五处**，其余不变。

### 8.1 imports

```ts
import {
  formatSseFrame,
  nodeFinished,
  nodeStarted,
  retrieval,          // ← 新增
  RunError,
  RunEventQueue,
  runFailed,
  runFinished,
  runStarted,
  token,
  toolCall,
  toolResult,
  type RunEvent,
} from './events'
import { runEndNode } from './nodes/end.node'
import { runKnowledgeNode } from './nodes/knowledge.node'   // ← 新增
```

### 8.2 `run()`：把「知识库预检」并入同一条错误列表

```ts
const graph = app.graphJson as unknown as Graph
const errors = [
  ...validateGraph(graph),
  ...validateNodeData(graph),
  // 预检需要知道 ownerId：其他用户的知识库一律视为不存在（见 error-messages.md §7.2）
  ...(await validateKnowledgeNodes(this.prisma, ownerId, graph)),
]
if (errors.length > 0) {
  throw new BadRequestException(errors.join('; '))
}
return this.execute(appId, graph, inputs)
```

### 8.3 `executeNode()`：新增 `knowledge` 分支

```ts
private async executeNode(
  node: GraphNode,
  pool: Pool,
  queue: RunEventQueue,
): Promise<Record<string, unknown>> {
  switch (node.type) {
    case 'start':
      return runStartNode(node, pool)
    case 'llm':
      return runLlmNode(node, pool, (text) => queue.emit(token(node.id, text)))
    case 'knowledge': {
      const knowledgeBaseId = String((node.data as { knowledgeBaseId?: unknown }).knowledgeBaseId ?? '')
      return runKnowledgeNode(node, pool, this.prisma, (hits, topK) =>
        queue.emit(retrieval(node.id, knowledgeBaseId, topK, hits)),
      )
    }
    case 'end':
      return runEndNode(node, pool)
  }
}
```

`knowledgeBaseId` 只是用来**填事件字段**；检索本身用的是 `data.knowledgeBaseId`（同一个值）。预检已保证它非空。

### 8.4 `validateNodeData()`：新增 `knowledge` 的形状校验

```ts
} else if (node.type === 'knowledge') {
  if (typeof data.query !== 'string') {
    errors.push(`knowledge node ${node.id} query must be a string`)
  }
}
```

### 8.5 `validateKnowledgeNodes()`：需要 DB 与 `ownerId` 的预检

```ts
/**
 * `knowledge` 节点的运行前预检（需要 DB，故异步且拿到 `ownerId`）：
 * 缺 `knowledgeBaseId` → 未知/不属于当前用户 → `topK` 越界；同一节点内按此次序。
 * 文案见 error-messages.md §7.2。
 */
async function validateKnowledgeNodes(
  prisma: PrismaService,
  ownerId: string,
  graph: Graph,
): Promise<string[]> {
  const knowledgeNodes = graph.nodes.filter((node) => node.type === 'knowledge')
  if (knowledgeNodes.length === 0) {
    return []
  }

  const requestedIds = new Set<string>()
  for (const node of knowledgeNodes) {
    const id = (node.data as Record<string, unknown>).knowledgeBaseId
    if (typeof id === 'string' && id.trim() !== '') {
      requestedIds.add(id)
    }
  }
  const owned = new Set<string>()
  if (requestedIds.size > 0) {
    const found = await prisma.knowledgeBase.findMany({
      where: { id: { in: [...requestedIds] } },
      select: { id: true, ownerId: true },
    })
    for (const kb of found) {
      if (kb.ownerId === ownerId) {
        owned.add(kb.id)
      }
    }
  }

  const errors: string[] = []
  for (const node of knowledgeNodes) {
    const data = node.data as Record<string, unknown>
    const knowledgeBaseId = data.knowledgeBaseId
    if (typeof knowledgeBaseId !== 'string' || knowledgeBaseId.trim() === '') {
      errors.push(`knowledge node ${node.id} knowledgeBaseId is required`)
    } else if (!owned.has(knowledgeBaseId)) {
      errors.push(`knowledge node ${node.id} references unknown knowledge base: ${knowledgeBaseId}`)
    }
    const topK = data.topK
    if (
      topK !== undefined &&
      !(typeof topK === 'number' && Number.isInteger(topK) && topK >= 1 && topK <= 20)
    ) {
      errors.push(`knowledge node ${node.id} topK must be between 1 and 20`)
    }
  }
  return errors
}
```

**为什么先批量查、再逐节点报错**：

- 一张图可能有多个 `knowledge` 节点，逐个 `findUnique` 是 N+1；
- 先 `findMany({ where: { id: { in: [...] } } })` 一次取回，再在内存里按 `ownerId` 过滤；
- 「不存在」与「不属于当前用户」**用同一条文案**，不泄露「这个 id 存在但不是你的」。

### 8.6 没有改的部分（很重要）

`knowledge` 节点**没有**内部节点、**没有**条件边、**没有**环。它走的是 `makeNodeAction` 的通用分支：

```ts
return async (state: RunStateValue): Promise<Partial<RunStateValue>> => {
  context.queue.emit(nodeStarted(node.id, node.type))
  try {
    const output = await this.executeNode(node, state.pool, context.queue)
    context.queue.emit(nodeFinished(node.id, node.type, output))
    ...
    return { pool: { [node.id]: output } }
  } catch (error) {
    context.failedNodeId = node.id
    throw error
  }
}
```

所以它天然是「一次执行、一次开始、一次结束」。

---

## 9. 事件增量：`retrieval` 构造器（events.ts）

`retrieval` 是阶段 7 唯一新增的事件。其余构造器（`run_started` / `node_started` / `token` / `tool_call` / `tool_result` / `node_finished` / `run_finished` / `run_failed`）与 `RunEventQueue` 均不变，见 `04-执行引擎/02-LangGraph编译图-TS.md` 与 `06-工具调用/02-NestJS-ReAct循环与条件边.md` §7。

**完整文件路径：`apps/api-ts/src/engine/events.ts`（节选，其余不变）**

```ts
import type { GraphNodeType, RetrievalHit, RunEvent } from '@mini-dify/contract'

// ...

/** 构造 `retrieval` 事件（`knowledge` 节点每次执行只发一次）。 */
export function retrieval(
  nodeId: string,
  knowledgeBaseId: string,
  topK: number,
  hits: RetrievalHit[],
): RunEvent {
  return { event: 'retrieval', data: { nodeId, knowledgeBaseId, topK, hits } }
}
```

事件协议（唯一真源 `packages/contract/sse-events.md` §2）：

| 事件 | payload |
| --- | --- |
| `retrieval` | `nodeId`(string)、`knowledgeBaseId`(string)、`topK`(number)、`hits`(RetrievalHit[]) |

`RetrievalHit` 的字段与 `node_finished.output.chunks[]` **完全相同**：

```ts
{ documentId: string, documentName: string, chunkIndex: number, content: string, score: number }
```

---

## 10. 【技术教学 · 首次】Prisma 与 `vector` 的边界：为什么必须走原生 SQL

### 10.1 `Unsupported` 是什么意思

`apps/api-ts/prisma/schema.prisma` 里：

```prisma
model Chunk {
  ...
  // 向量维度**固定 1536**：pgvector 的 vector(N) 列维度不可变。
  embedding       Unsupported("vector(1536)")?
}
```

`Unsupported(...)` 是 Prisma 的「**我知道这列存在，但我不支持它**」声明：

- **迁移**：Prisma 会把它写进 DDL（`embedding vector(1536)`），所以表结构仍由 Prisma 迁移拥有；
- **Prisma Client**：该字段**不可读写**。`prisma.chunk.findMany()` 不会返回 `embedding`，`prisma.chunk.create({ data: { embedding } })` 也无法通过类型检查；
- 因此任何「真的要把向量存进去 / 取出来算距离」的操作，都必须走原生 SQL。

这就是注释里那句「向量读写**只用原生 SQL**」的全部原因。

### 10.2 为什么不用「把向量存成 text / json」绕开

可以，但会失去这次阶段的核心能力：

| 方案 | 存 | 查 | 结果 |
| --- | --- | --- | --- |
| `text` / `jsonb` | Prisma 原生支持 | 只能把全部行拉到应用层算余弦 | O(N) 网络传输 + O(N) 计算，索引完全用不上 |
| `vector(1536)` + 原生 SQL | 一次 `$executeRaw` | `ORDER BY embedding <=> $1 LIMIT k` | 可建 HNSW，数据量大时是 ANN 检索 |

所以「原生 SQL」不是偷懒，而是**为了用上数据库的向量能力**。总纲里的选型也是一句话：「pgvector 走原生 SQL」。

### 10.3 HNSW 索引也不在 schema 里

Prisma schema 无法声明 HNSW 索引，它是在迁移里手写的：

**文件：`apps/api-ts/prisma/migrations/20261021113234_add_knowledge_base/migration.sql`（节选）**

```sql
-- 阶段 7：pgvector 扩展（chunks.embedding 用到 vector(1536)）。
-- 已安装时为空操作；Prisma 不会自动生成这一句。
CREATE EXTENSION IF NOT EXISTS vector;
...
"embedding" vector(1536),
...
-- 阶段 7：向量检索索引（HNSW + 余弦距离）。
-- 必须放在 `chunks.embedding` 列创建之后；维度固定 1536，与 Schema 的 Unsupported("vector(1536)") 一致。
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
```

schema 里也留了警告：

> Prisma 无法在 schema 里声明 HNSW 索引，后续 `prisma migrate dev` 可能自动生成 `DROP INDEX "chunks_embedding_hnsw"`；遇到时应删掉该自动迁移并手工重建索引。

**这是真实会踩的坑**：Prisma 看不到这个索引，就以为它是「多余对象」。每次 `migrate dev` 后如果发现迁移文件里有 `DROP INDEX`，删掉那行、保留索引。

---

## 11. 【技术教学 · 首次】向量写入：`$executeRaw`、`$n::vector` 与字符串字面量

### 11.1 `$executeRaw` 的标签模板

```ts
await tx.$executeRaw`
  INSERT INTO chunks (id, document_id, knowledge_base_id, chunk_index, content, embedding, created_at)
  VALUES (${randomUUID()}, ${documentId}, ${knowledgeBaseId}, ${index}, ${chunks[index]}, ${toVectorLiteral(vectors[index])}::vector, now())
`
```

`$executeRaw` 是 Prisma 的「**执行写 SQL**」逃生舱，返回受影响行数。它使用**标签模板**（tagged template）：

- 模板里每个 `${...}` 都会变成**一个绑定参数**（`$1`、`$2`……），由驱动负责转义与传输；
- 表名、列名**不能**用 `${}` 绑定（SQL 只允许值参数化），只能写死在 SQL 文本里；
- **永远不要**用 `$executeRawUnsafe` + 字符串拼接把用户输入拼进去——那是 SQL 注入。

本项目的写法是安全的：所有值（id、文档 id、知识库 id、序号、正文、向量）都是绑定参数。

### 11.2 为什么向量要转成字符串

`toVectorLiteral`：

```ts
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}
```

它产出的是 pgvector 的**文本输入格式**：

```
[0.015839132,0,0.047517393, ... ]   ← 1536 个数字
```

然后把这段文本交给 Postgres，并显式 `::vector`：

```sql
... VALUES (..., $6::vector, now())
```

### 11.3 直接传 JS 数组会怎样（实测）

如果把 `${toVectorLiteral(...)}` 换成 `${vectors[index]}`，看起来更自然，但在**距离算子**那里会直接失败。本仓库实测（Prisma + pgvector 0.8.7）：

```
ERROR: operator does not exist: vector <=> numeric[]
HINT: No operator matches the given name and argument types. You might need to add explicit type casts.
```

原因：

1. Prisma 把 JS `number[]` 绑定为 Postgres 的 **`numeric[]`**（数组），不是 `vector`；
2. `<=>` 是 pgvector 定义在 `vector` 上的算子，Postgres **不会**为了算子匹配去做「数组 → 向量」的隐式转换；
3. 所以 `embedding <=> $1` 的类型解析直接失败。

> **补充实测（避免学成教条）**：在**当前**这套 Prisma + pgvector 0.8.7 上，写成 `${array}::vector` 是能成功的（显式 cast 之后类型就是 `vector`）；甚至 `INSERT ... VALUES (${array})` 靠赋值转换也能写进去。项目仍然固定走字符串，理由有三条：
> ① **跨语言一致**：Python/psycopg 侧只能传文本（`CAST(:embedding AS vector)`），TS 侧保持同一形状，SQL 可以逐行对照；
> ② **不依赖隐式转换**：字符串 + 显式 `::vector` 在任何位置都确定，不随 Prisma 对数组类型的推断变化；
> ③ **错误信息更直白**：维度不对时 pgvector 会直接说「expected 1536 dimensions」，而不是先扯数组类型。
>
> 结论：**把「传字符串 + `::vector`」当作本项目的硬约定**；不要写「裸数组」去赌隐式 cast。

### 11.4 占位符编号：同一个字面量出现两次就是两个参数

`searchChunks` 的模板里 `${literal}` 出现了两次（`SELECT` 里算 `score`、`ORDER BY` 里排序）。Prisma 不会去重，实测日志：

```
SELECT c.document_id, d.name AS document_name, c.chunk_index, c.content,
       1 - (c.embedding <=> $1::vector) AS score
FROM chunks c
JOIN documents d ON d.id = c.document_id
WHERE c.knowledge_base_id = $2
ORDER BY c.embedding <=> $3::vector
LIMIT $4
PARAMS: ["[0.1,0.2,0.3]","kb-x","[0.1,0.2,0.3]",3]
```

所以「`$1::vector`」这个说法要理解为「**第 n 个向量参数**」：`SELECT` 里是 `$1`，`ORDER BY` 里是 `$3`，但两者值相同、都必须带 `::vector`。

### 11.5 写入的事务边界

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.document.create({ ... })
  for (...) {
    await tx.$executeRaw`INSERT INTO chunks ...`
  }
  await tx.document.update({ ..., data: { chunkCount: chunks.length } })
})
```

- 交互式事务里，`tx` 上的所有语句共享同一连接与事务；
- 如果第 7 个 chunk 写入失败，前面 6 个 chunk 与文档记录一起回滚；
- 反过来：先建文档再写块（而不是先算完所有 id 再一次性 insert），是因为文档 id 要作为 chunk 的外键；`chunkCount` 事后更新，是因为只有全部写完才知道成功了多少。

> 这里没有用 `createMany`：`chunks.embedding` 是 Prisma 不支持的类型，`createMany` 无法写它；只能用 `$executeRaw` 逐条插入。

---

## 12. 【技术教学 · 首次】余弦距离 `<=>`：`score = 1 - distance`

### 12.1 pgvector 的距离算子

| 算子 | 含义 | 返回 |
| --- | --- | --- |
| `<->` | 欧氏距离（L2） | 0 → ∞，越小越近 |
| `<#>` | 负内积（negative inner product） | 越小越相似（因为取了负号） |
| `<=>` | **余弦距离** | 0..2，越小越相似 |
| `<+>` | 曼哈顿距离（L1，较新版本） | 越小越近 |

余弦距离的定义是：

```
cosine_similarity(a, b) = (a · b) / (|a| * |b|)      ∈ [-1, 1]
cosine_distance(a, b)   = 1 - cosine_similarity(a, b) ∈ [0, 2]
```

pgvector 的 `<=>` 返回的是 **cosine_distance**，所以：

```
score = 1 - (embedding <=> query)   ← 与 cosine_similarity 完全相等，越大越相关
```

这正是 SQL 里那行：

```sql
1 - (c.embedding <=> ${literal}::vector) AS score
```

### 12.2 方向：`ORDER BY distance` 是升序，正好是「最相似在前」

```sql
ORDER BY c.embedding <=> ${literal}::vector
```

- 没有写 `ASC`，默认就是**升序**；
- 距离越小 = 越相似，所以**升序排列 = 最相似在前**；
- 与 `score` 的关系：`score` 越大越相关，所以「距离升序」等价于「分数降序」。

**这里是最容易写反的地方**，把四种写法摆在一起看：

| SQL | 谁在前 | 对不对 |
| --- | --- | --- |
| `ORDER BY embedding <=> q`（默认 ASC） | 距离最小 = 最相似 | ✅ |
| `ORDER BY embedding <=> q DESC` | 距离最大 = 最不相似 | ❌ |
| `score = 1 - (embedding <=> q)` | 越大越相关 | ✅ |
| `score = embedding <=> q` | 越大越**不**相关 | ❌ |

一个可验证的自检：如果 top1 的 `content` 含「退款」、`score` 是 0.588，而最后一条是无关文档、`score` 是 0.133，说明方向和公式都对了（§19.1）。

### 12.3 为什么 SQL 里「按距离排序」，而不是「按 score 排序」

`ORDER BY score DESC` 与 `ORDER BY distance ASC` 在**数学上等价**，但：

- HNSW 索引只能加速 `ORDER BY <向量列> <=> <常量>` 这种形式；
- 写成 `ORDER BY 1 - (embedding <=> $1) DESC`，优化器就认不出「这是按向量距离排序」，索引**用不上**；
- 所以 SQL 里**排序用原始距离算子**，`score` 只作为输出列计算一次。

这也是一个通用原则：**让「可索引的表达式」保持原样，把业务换算放到 SELECT 列表里。**

### 12.4 `score` 可能是负数

余弦相似度范围是 `[-1, 1]`，所以 `score` 也可能是负数（方向相反）。这不是 bug，也不代表「坏了」——它只说明这条文本与查询**语义相反**。阈值过滤（例如 `score > 0.5`）属于业务策略，本项目不做。

---

## 13. 【技术教学 · 首次】检索 SQL 的 JOIN 与「归属过滤必须在 SQL 里」

```sql
SELECT c.document_id, d.name AS document_name, c.chunk_index, c.content,
       1 - (c.embedding <=> $1::vector) AS score
FROM chunks c
JOIN documents d ON d.id = c.document_id
WHERE c.knowledge_base_id = $2
ORDER BY c.embedding <=> $3::vector
LIMIT $4
```

### 13.1 为什么要 `JOIN documents`

`chunks` 表里只有 `document_id`，没有文档名。但契约要求每条命中带 `documentName`：

```
{ documentId, documentName, chunkIndex, content, score }
```

`documentName` 用来做**引用展示**（「这段来自 refund.txt 第 0 块」）。两条路：

| 做法 | 代价 |
| --- | --- |
| 先查 chunks，再按 `documentId` 逐个查 documents | N+1 次查询 |
| 一次 `JOIN documents` | 一次查询，数据库内部做 hash join |

所以用 `JOIN`。因为 `chunks.document_id` 有外键约束，`JOIN` 不会丢行（用 `INNER JOIN` 是安全的）；`ON DELETE CASCADE` 保证文档删除后不会留下孤儿 chunk。

### 13.2 `WHERE knowledge_base_id` 是「正确性」而不只是「性能」

`chunks` 表**冗余存了** `knowledge_base_id`（本可以只通过 `documents` 关联得到）。冗余的收益：

- 过滤条件直接落在 `chunks` 上，`chunks_knowledge_base_id_idx` 能加速；
- 不必为了「限定某个知识库」而先 JOIN 再过滤。

但更重要的是**不写它的后果**：

- `ORDER BY ... LIMIT k` 会从**全表**（所有用户、所有知识库）里取最相似的 k 条；
- 结果是 B 用户检索时可能拿到 A 用户的文档内容——**跨租户数据泄漏**；
- 就算没有多用户，topK 的语义也错了（「本库最相似的 3 条」变成「全库最相似的 3 条，碰巧属于本库的算数」）。

**为什么不能在应用层过滤**：

1. 应用层过滤之前，SQL 已经 `LIMIT k` 了；被过滤掉的条目不会补回来，结果可能少于 k；
2. 要补回来就得先取全表（或取很大的 k），传输量与延迟都不可接受；
3. 归属判断在应用层只证明「调用者拥有这个知识库」，但如果 SQL 不限定库，检索范围仍然可能越界。

所以规则是：**SQL 内做归属/范围过滤，应用层做「你有没有资格发起这次检索」的鉴权。两道都要有。**

### 13.3 `searchChunks` 本身不接收 `ownerId`

这是一个**有意的分工**：

- `searchChunks(prisma, knowledgeBaseId, vector, topK)` 只负责「在这个库里找最近的 k 条」；
- 「这个库是不是你的」由**调用方**保证：
  - HTTP 接口：`KbService.search` 先 `findOwned(ownerId, knowledgeBaseId)`；
  - 图运行：`EngineService.run` 的 `validateKnowledgeNodes(prisma, ownerId, graph)`。

**这也意味着：任何复用 `runKnowledgeNode` / `searchChunks` 的新入口，都必须自己先做归属校验。** 少这一步就是越权读取（见 §21 常见坑）。

---

## 14. 【技术教学 · 首次】`EXPLAIN` 视角：HNSW、近似最近邻与小数据量的「顺序扫描」

### 14.1 `EXPLAIN` 在看什么

```sql
EXPLAIN SELECT ...;
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

- `EXPLAIN`：只**估算**计划，不执行；
- `EXPLAIN ANALYZE`：**真的执行**，返回实际耗时 / 实际行数（有副作用时要小心，SELECT 无所谓）；
- `BUFFERS`：显示读了多少共享缓存页（`shared hit` = 命中缓存）；
- `cost=24.25..24.25`：`启动成本..总成本`，单位是抽象的「页读取」估算，不是毫秒；
- `rows=2` 是**估算**行数，`actual ... rows=8` 是实际行数。两者差很多说明统计信息过期（可 `ANALYZE`）。

### 14.2 本仓库的真实计划（小数据量）

环境：PostgreSQL 16.15 + pgvector 0.8.7，`chunks` 共 25 行，本次检索的知识库只有 8 个 chunk。对 `searchChunks` 同形 SQL 执行 `EXPLAIN (ANALYZE, BUFFERS)`（为可读性省略了 1536 维向量字面量与真实 id）：

```
Limit  (cost=24.25..24.25 rows=2 width=116) (actual time=0.164..0.166 rows=3 loops=1)
  Buffers: shared hit=68
  ->  Sort  (cost=24.25..24.25 rows=2 width=116) (actual time=0.163..0.165 rows=3 loops=1)
        Sort Key: ((c.embedding <=> '<1536 维查询向量>'::vector))
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=68
        ->  Hash Join  (cost=9.53..24.24 rows=2 width=116) (actual time=0.093..0.137 rows=8 loops=1)
              Hash Cond: (d.id = c.document_id)
              ->  Seq Scan on documents d  (cost=0.00..13.40 rows=340 width=64) (actual time=0.005..0.006 rows=14 loops=1)
              ->  Hash  (cost=9.50..9.50 rows=2 width=100) (actual time=0.036..0.036 rows=8 loops=1)
                    ->  Bitmap Heap Scan on chunks c  (cost=4.16..9.50 rows=2 width=100) (actual time=0.020..0.027 rows=8 loops=1)
                          Recheck Cond: (knowledge_base_id = '...'::text)
                          Heap Blocks: exact=3
                          ->  Bitmap Index Scan on chunks_knowledge_base_id_idx  (cost=0.00..4.16 rows=2 width=0) (actual time=0.013..0.013 rows=8 loops=1)
                                Index Cond: (knowledge_base_id = '...'::text)
Planning Time: 0.370 ms
Execution Time: 0.210 ms
```

**读法**：

1. 先按 `knowledge_base_id` 走 **btree** 索引，拿到本库的 8 行；
2. `JOIN documents`（hash join）补文档名；
3. 对这 8 行做 **top-N heapsort**（`LIMIT 3` 只需要维护 3 个候选）；
4. **完全没有用到 `chunks_embedding_hnsw`**。

### 14.3 「没走 HNSW」是正常的，不是 bug

优化器是**成本驱动**的：

- 本库只有 8 行，全部读进内存 + 排序的成本约 **24**；
- HNSW 索引扫描要先走图、再回表，估算成本约 **106**（见下）；
- 8 行 vs 106，当然选排序。

把排序强制关掉（`SET enable_sort = off; SET enable_seqscan = off; SET enable_bitmapscan = off;`），HNSW 才会现身：

```
Limit  (cost=106.19..180.39 rows=2 width=116)
  ->  Index Scan using chunks_embedding_hnsw on chunks c  (cost=106.04..164.00 rows=2 width=100)
  ->  Index Scan using documents_pkey on documents d  (cost=0.15..8.17 rows=1 width=64)
```

这说明**索引存在、且可用**，只是当前数据量下不划算。随行数增长，顺序扫描的 O(N) 成本会超过 HNSW 的固定开销，优化器会自己切换——**不需要在代码里加 `FORCE INDEX` 之类的东西**（Postgres 也没有这个语法）。

### 14.4 HNSW 是什么（一句话 + 三个参数）

**HNSW = Hierarchical Navigable Small World**：把向量建成一个**多层近邻图**；查询时从上层稀疏图往下跳，快速收敛到最近的邻居。

- 它是 **ANN（近似最近邻）**，不是精确检索：为了速度牺牲一点召回率（recall）；
- 建索引参数：`m`（每层邻居数）、`ef_construction`（建图时的候选宽度）——本项目用默认值；
- 查询参数：`hnsw.ef_search`（默认 40）——越大越准越慢，可在会话里 `SET hnsw.ef_search = 100`；
- 索引的 **ops class 必须与算子匹配**：

| 索引 | 对应算子 |
| --- | --- |
| `vector_cosine_ops` | `<=>` |
| `vector_l2_ops` | `<->` |
| `vector_ip_ops` | `<#>` |

本项目建的是 `USING hnsw (embedding vector_cosine_ops)`，SQL 用的也是 `<=>`，**一致**。如果 SQL 改用 `<->` 而索引是 cosine ops，优化器不会用这个索引——它会退化成顺序扫描，**不会报错**，很容易误以为「索引没用」。

### 14.5 大数据量下的真实注意点：先过滤还是先 ANN

HNSW 索引是**全表一个索引**（不按 `knowledge_base_id` 分区）。当 SQL 同时有 `WHERE knowledge_base_id = ...` 与 `ORDER BY embedding <=> ...` 时，有两种执行策略：

| 策略 | 过程 | 风险 |
| --- | --- | --- |
| 先 ANN 取 k 条，再按库过滤 | 从全库邻居里取 topK，再筛掉不属于本库的 | 过滤掉的可能太多 → 返回不足 k 条 |
| 先按库过滤，再精确排序 | 本库全量排序 | 库很大时慢，但结果准确 |

pgvector 0.8+ 提供了 **iterative scan**（`SET hnsw.iterative_scan = relaxed_order`）来缓解「过滤后不足 k 条」的问题；本项目数据量小，没有启用。知道有这个开关即可，真正上量时再打开。

### 14.6 怎么自己看

```powershell
# 取一个真实向量字面量（1536 维），再把它拼进 EXPLAIN
docker exec -e PGPASSWORD=difyai123456 mini-dify-db psql -U postgres -d minidify `
  -At -c "SELECT embedding::text FROM chunks LIMIT 1" | Out-File -Encoding ascii "$env:TEMP\emb.txt"
```

然后把 SQL 写进文件用 `psql -f` 执行（1536 维字面量太长，不适合直接塞进命令行）。也可以直接用 `EXPLAIN ANALYZE` 观察你自己的查询。关键只看两处：

- 有没有 `Index Scan using chunks_embedding_hnsw`；
- 有没有 `Sort` + `Seq Scan` / `Bitmap Heap Scan`。

---

## 15. 【技术教学 · 首次】`knowledge` 节点在引擎中的位置：普通节点，无环

### 15.1 它和 `llm` 节点的结构差异

| | `llm`（启用工具） | `knowledge` |
| --- | --- | --- |
| 图上的节点 | `llm1` + 内部 `llm1__tools` | 只有 `kb1` |
| 出边 | 条件边（`tools` / `continue`）+ 回边 | **普通边** |
| 执行次数 | 可能多轮（环） | **恰好一次** |
| `node_started` / `node_finished` | 首轮 / 末轮各一次 | 各一次 |
| 专属事件 | `token` / `tool_call` / `tool_result` | `retrieval` |

`knowledge` 不需要循环，因为「检索」本身是一个**确定的单步操作**：渲染查询 → 调一次 embedding → 查一次库 → 返回。它不需要模型参与，也不需要「根据结果决定下一步」。

### 15.2 执行顺序与事件

```
event: node_started
data: {"nodeId":"kb1","nodeType":"knowledge"}

event: retrieval
data: {"nodeId":"kb1","knowledgeBaseId":"...","topK":3,"hits":[ ...3 条... ]}

event: node_finished
data: {"nodeId":"kb1","nodeType":"knowledge","output":{"chunks":[...],"context":"...\n\n...\n\n..."}}
```

对应代码里的三步：

```ts
context.queue.emit(nodeStarted(node.id, node.type))         // ① makeNodeAction
const output = await this.executeNode(node, state.pool, queue)  // ② 内部 emit retrieval
context.queue.emit(nodeFinished(node.id, node.type, output))    // ③ makeNodeAction
```

**注意两点**：

1. `node_started` 在 `executeNode` **之前**发出。也就是说，前端会先看到「知识检索开始了」，然后等待 embedding + SQL（可能几十到几百毫秒），再看到 `retrieval`。这是正确的 UX——开始就应该有反馈。
2. `retrieval` 在 node 内部、`node_finished` 之前发出。顺序不能反：`node_finished` 是「这个节点结束了」，它必须最后。

### 15.3 失败时的事件

| 失败点 | 已发出 | 随后 | 不会发出 |
| --- | --- | --- | --- |
| 渲染 `query` 时变量不存在 | `node_started` | `run_failed`（`template variable not found: {path}`） | `retrieval` / `node_finished` |
| embedding 调用失败 | `node_started` | `run_failed`（§7.3 文案，如 `embedding request unauthorized`） | `retrieval` / `node_finished` |
| SQL/DB 失败 | `node_started` | `run_failed` | `retrieval` / `node_finished` |

`makeNodeAction` 的 `catch` 会设置 `context.failedNodeId = node.id`，所以 `run_failed` 的 `nodeId` 是 `kb1`，前端能定位到具体节点。

> 与 `llm` 节点一致：**出错不发 `node_finished`**。这是阶段 5 定下的规则，`knowledge` 沿用。

### 15.4 输出写入变量池

```ts
return { pool: { [node.id]: output } }
```

所以下游可以写：

```json
{ "value": "根据资料回答：\n{{ kb1.context }}\n\n问题：{{ start_1.question }}" }
```

模板按点路径取值，见 `04-执行引擎/03-节点运行时与变量池.md`。`context` 是字符串，替换后就是纯文本；`chunks` 是数组，如果直接 `{{ kb1.chunks }}`，会被「非字符串按紧凑 JSON 序列化」成一大串 JSON（能用，但浪费 token，通常不这么写）。

---

## 16. 【技术教学 · 首次】`retrieval` 事件的设计动机

### 16.1 它解决三个问题

**① 前端要展示引用来源（RAG 的可解释性）**

RAG 的价值一半在「答得准」，另一半在「知道答案来自哪」。`retrieval.hits` 里每条都带 `documentName` / `chunkIndex` / `content` / `score`，前端可以在回答下方列出：

```
引用：
  refund.txt #0  相关度 0.588
  refund.txt #1  相关度 0.497
  invoice.txt #0 相关度 0.133
```

用户点开就能看到原文。没有这个事件，前端只能等 `node_finished` 再解析 `output.chunks`——也能做，但事件语义就不清晰了。

**② 验收要能直接断言「检索到了什么」**

`node_finished.output` 是一个通用的 `Record<string, unknown>`，形状会随节点类型变化。而 `retrieval` 是**领域事件**，schema 固定：

```
{ nodeId, knowledgeBaseId, topK, hits }
```

验收脚本不需要知道 `knowledge` 节点的输出约定，直接断言 `retrieval.hits[0].documentName === 'refund.txt'` 即可。

**③ 把「配置」也带出来**

`knowledgeBaseId` 与 `topK` 不是从 hits 里能推出来的（hits 只有文档与分数）。前端要显示「检索自 XXX 知识库，topK=3」，就必须有这两个字段。`node_finished` 里没有它们，所以事件必须自带。

### 16.2 为什么「只发一次」

`knowledge` 节点只执行一次，所以每次执行恰好一次 `retrieval`。这与 `token` 不同（`token` 是流式片段，一条 llm 节点可能几十上百条）。协议里写明「每节点只发一次」，前端可以按 `nodeId` 直接覆盖渲染，不需要做增量合并。

### 16.3 与 `node_finished.output.chunks` 的重复是有意的

两者内容相同（都来自同一个 `hits` 数组），但不矛盾：

| | `retrieval` | `node_finished.output.chunks` |
| --- | --- | --- |
| 面向 | **观察者**（前端 / 验收 / 日志） | **数据流**（变量池 → 下游节点） |
| 是否进入 pool | 否 | 是 |
| 生命周期 | 事件流中的一帧 | 本次运行的节点输出 |

「事件用于观察，输出用于流转」是本项目从阶段 4 就定下的分工。事件可以比输出更丰富（带 `knowledgeBaseId`、`topK`），输出则可以更精简（只给下游真正要用的东西）。

---

## 17. 【技术教学 · 首次】节点输出 `{chunks, context}`：为什么多给一个字符串

### 17.1 两个字段，两种消费者

```ts
return {
  chunks: hits,                                      // 结构化：给程序 / 引用展示 / 验收
  context: hits.map((hit) => hit.content).join('\n\n'), // 纯文本：给 prompt / 给模型
}
```

| 字段 | 消费者 | 用途 |
| --- | --- | --- |
| `chunks` | 前端、验收脚本、后续需要结构化引用的节点 | 文档名、块号、分数、原文 |
| `context` | `llm` 节点的 prompt 模板 | 直接拼进提示词，模型只读文本 |

### 17.2 如果只有 `chunks`，下游会很别扭

`llm.prompt` 是**字符串模板**。写 `{{ kb1.chunks }}` 会被序列化成：

```json
[{"documentId":"...","documentName":"refund.txt","chunkIndex":0,"content":"...","score":0.588}, ...]
```

问题：

- 模型看到的是 JSON 结构，不是「资料段落」；
- `documentId`、`score` 这些元数据会占用 token；
- 每次都要在 prompt 里写「请忽略 JSON 字段，只看 content」，很脆。

`context` 把这些事情一次做完：**只保留正文、按块分隔、顺序与 chunks 一致**。下游直接：

```
根据以下资料回答问题：
{{ kb1.context }}

问题：{{ start_1.question }}
```

### 17.3 为什么分隔符必须是 `"\n\n"`，且两端必须一致

- `"\n\n"`（一个空行）在视觉上把块分开，模型容易识别「这是一段独立资料」；
- 两套后端（TS / Python）必须产出**逐字节相同**的 `context`，否则「契约一致」验收会失败；
- Python 侧写的是 `"\n\n".join(...)`（`apps/api-py/app/engine/nodes/knowledge.py`），TS 侧写的是 `.join('\n\n')`；**改一处必须改另一处**；
- 顺序也必须一致：都按 `hits` 的顺序（也就是 SQL 的分数降序），不能重新排序。

### 17.4 空命中的边界

如果知识库是空的，或者 `topK` 太小、SQL 返回 0 行：

- `hits = []`；
- `context = ''`（空字符串，不是 `null`）；
- `retrieval` 仍会发一次（`hits: []`），`node_finished` 也会发（`{ chunks: [], context: '' }`）。

下游 prompt 会变成「资料为空」，模型可能凭自身知识回答。这是产品策略问题（是否在空检索时短路），本项目不做特殊处理，但验收时应知道这个边界。

---

## 18. 【技术教学 · 首次】预检的力量：把四类错误挡在开流之前

### 18.1 四类错误（逐字）

| 场景 | HTTP | `message` |
| --- | --- | --- |
| `knowledgeBaseId` 缺失/空串 | 400 | `knowledge node {id} knowledgeBaseId is required` |
| 知识库不存在或不属于当前用户 | 400 | `knowledge node {id} references unknown knowledge base: {id}` |
| `topK` 不是 1..20 的整数 | 400 | `knowledge node {id} topK must be between 1 and 20` |
| `query` 不是字符串 | 400 | `knowledge node {id} query must be a string` |

前三条由 `validateKnowledgeNodes` 产生，第四条由 `validateNodeData` 产生。它们与图校验、其他节点数据校验**合并成一条 `message`**，用 `"; "` 连接（见 `error-messages.md` §4.1 / §7.2）。组装顺序与 `run()` 里的数组一致：`validateGraph` → `validateNodeData`（含 `query` 形状）→ `validateKnowledgeNodes`（缺 id / 未知 / `topK`）。

### 18.2 为什么必须「开流前」失败

`RunController` 的顺序是：

```ts
const events = await this.engineService.run(payload.sub, id, body.inputs)  // ← 预检在这里
response.setHeader('Content-Type', 'text/event-stream')
response.flushHeaders()
for await (const event of events) { response.write(...) }
```

`run()` 抛 `BadRequestException` 时，**还没有写任何响应头**，全局 `HttpErrorFilter` 就能正常返回普通 JSON 400。

反过来，如果预检放到节点执行时：

- 响应头已经写成 `text/event-stream`，HTTP 状态码已经定死为 200；
- 客户端收到的是「200 的流 + 一条 `run_failed`」；
- 但这类错误其实是**图配置错了**，不是运行期偶发故障，用 400 更准确，也更容易被调用方处理。

这就是阶段 4 定下的「**先校验、后开流**」原则（见 `04-执行引擎/05-SSE流式响应实现.md`），`knowledge` 节点是它最重要的应用场景之一。

### 18.3 为什么预检必须拿到 `ownerId`

```ts
...(await validateKnowledgeNodes(this.prisma, ownerId, graph)),
```

如果不传 `ownerId`，只检查「这个 id 在 `knowledge_bases` 表里存在」，那么：

```
B 用户把 A 的知识库 id 填进自己的图 → 预检通过 → 运行时检索 A 的文档 → 数据泄漏
```

`validateKnowledgeNodes` 的做法是：

1. 收集图里所有 `knowledgeBaseId`；
2. 一次 `findMany({ where: { id: { in: [...] } } })` 取回 `{id, ownerId}`；
3. 只把 `ownerId === 当前用户` 的 id 放进 `owned`；
4. 不在 `owned` 里的一律报 `references unknown knowledge base`。

「不存在」与「不是你的」用**同一条文案**，避免通过错误信息探测别人的知识库 id 是否存在。

### 18.4 与 HTTP 接口的 404 不矛盾

同样的越权，为什么 HTTP 接口是 404、图运行是 400？

| 入口 | 语义 | 状态码 |
| --- | --- | --- |
| `GET/DELETE /knowledge-bases/{id}` | 你在**访问一个资源**；资源不可见 → 当作不存在 | 404 `Knowledge base not found` |
| `POST /apps/{id}/run` | 你在**提交一份图配置**；配置引用了不可用的资源 → 配置错误 | 400 `knowledge node ... references unknown knowledge base: ...` |

两者都遵循「不泄露存在性」，只是错误类别不同。

### 18.5 `topK` 的两套校验，不要混

| 位置 | 输入来源 | 规则 | 是否做类型转换 |
| --- | --- | --- | --- |
| `SearchKnowledgeBaseDto` | HTTP JSON body | `@IsInt() @Min(1) @Max(20)` | `@Type(() => Number)` 会把 `"3"` 转成 `3`（`transform: true`） |
| `validateKnowledgeNodes` | 图 JSON（`data.topK`） | `typeof === 'number' && Number.isInteger && 1..20` | **不转换**；`"3"` 直接 400 |

图 JSON 是「数据」，不做隐式转换；HTTP body 是「用户输入」，允许常见的字符串数字。这是两端契约里已经定好的差异。

### 18.6 预检不检查「渲染后的 query 是否为空」

`data.query` 只校验是字符串。如果它是 `""` 或渲染后为空，预检不会拦，embedding 仍会被调用（provider 可能报错，也可能返回一个「空语义」向量）。这是当前实现的边界，不是 bug；如果要防，应该在节点里加一条业务规则（本项目没加）。

---

## 19. 实测

以下结果在 Windows + `mini-dify-db`（PostgreSQL 16.15 / pgvector 0.8.7）+ `apps/api-ts` 上实跑得到。

### 19.1 直接检索接口

请求：

```
POST /knowledge-bases/{id}/search
{"query":"退款怎么申请","topK":3}
```

响应（`documentId` / `content` 省略，`score` 逐字保留）：

```json
{"query":"退款怎么申请","topK":3,"hits":[
  {"documentId":"...","documentName":"refund.txt","chunkIndex":0,"content":"...","score":0.5884331464767456},
  {"documentId":"...","documentName":"refund.txt","chunkIndex":1,"content":"...","score":0.4971181748579854},
  {"documentId":"...","documentName":"invoice.txt","chunkIndex":0,"content":"...","score":0.13314714930687654}]}
```

读法：

- `score` **降序**（0.588 > 0.497 > 0.133）——说明 `ORDER BY distance ASC` 方向正确；
- top1 / top2 都来自含「退款」的 `refund.txt`；
- 第 3 条是无关的 `invoice.txt`，分数明显低（0.133），但仍被 `topK=3` 带出来——**topK 是「取前 k 条」，不是「相关度阈值」**。

### 19.2 图运行 SSE（`knowledge` 节点片段）

```text
event: node_started
data: {"nodeId":"kb1","nodeType":"knowledge"}

event: retrieval
data: {"nodeId":"kb1","knowledgeBaseId":"...","topK":3,"hits":[ ...3 条... ]}

event: node_finished
data: {"nodeId":"kb1","nodeType":"knowledge","output":{"chunks":[...],"context":"...\n\n...\n\n..."}}
```

要点：

- 顺序是 `node_started → retrieval → node_finished`；
- `retrieval.hits` 与 `node_finished.output.chunks` 内容相同；
- `context` 里能看到两个 `\n\n` 分隔三块（JSON 里显示为 `\n\n` 转义）。

### 19.3 预检错误（均为 400，逐字）

```
knowledge node kb1 knowledgeBaseId is required
knowledge node kb1 references unknown knowledge base: xxx
knowledge node kb1 topK must be between 1 and 20
```

补充实测：

- `topK: 0` / `topK: 21` / `topK: 1.5` / `topK: "3"` → `topK must be between 1 and 20`；
- `query: 123` → `knowledge node kb1 query must be a string`；
- 同一节点同时缺 `knowledgeBaseId` 和 `topK` 越界 → 两条错误用 `"; "` 连接。

### 19.4 归属

- B 用户直接访问 A 的知识库：`GET /knowledge-bases/{A_ID}` → `404 {"statusCode":404,"message":"Knowledge base not found","error":"Not Found"}`；
- B 用户的图里引用 A 的 `knowledgeBaseId` 并运行 → 400 `knowledge node kb1 references unknown knowledge base: {A_ID}`（**不会**返回 404，因为这是图配置错误）。

### 19.5 上传大小

- 上传 > 1MB 的文件 → `400 {"statusCode":400,"message":"Document too large","error":"Bad Request"}`；
- 触发点在 Multer 的 `limits.fileSize`（413）被 `UploadTooLargeFilter` 归一；服务层的 `file.size` 检查是第二道。

### 19.6 `EXPLAIN`（见 §14.2 / §14.3）

- 默认参数：`Sort` + `Bitmap Heap Scan on chunks` + `Seq Scan on documents`，**没有 HNSW**；
- `SET enable_sort = off` 等强制后：`Index Scan using chunks_embedding_hnsw`，成本约 106；
- 结论：索引存在且可用，小数据量下排序更便宜。

---

## 20. 验收自测

| 检查项 | 做法 | 预期 |
| --- | --- | --- |
| 契约编译 | `pnpm run build:contract` | 无报错 |
| 引擎编译 | `pnpm --filter @mini-dify/api-ts build` | 无报错 |
| HNSW 索引存在 | `docker exec ... psql ... "\d chunks"` | 看到 `chunks_embedding_hnsw hnsw (embedding vector_cosine_ops)` |
| 检索接口 | §19.1 的请求 | 3 条命中，`score` 降序，top1/top2 来自 `refund.txt` |
| 排序方向 | 看 `score` 与 `content` | 分数最高的是最相关的块 |
| `retrieval` 事件 | 运行 §19.2 的图，`curl.exe -N` | `node_started → retrieval → node_finished` |
| `chunks` 一致 | 对比 `retrieval.hits` 与 `node_finished.output.chunks` | 逐条相同 |
| `context` 分隔符 | 把 `context` 按 `\n\n` split | 得到 3 段，顺序与 chunks 一致 |
| 缺 `knowledgeBaseId` | 图里去掉该字段并运行 | 开流前 400，`... is required` |
| 未知知识库 | 填一个随机 uuid | 开流前 400，`references unknown knowledge base: ...` |
| `topK` 越界 | `topK: 21` | 开流前 400，`topK must be between 1 and 20` |
| 归属（HTTP） | 用 B 的 token 访问 A 的库 | 404 `Knowledge base not found` |
| 归属（图运行） | B 的图引用 A 的库并运行 | 400 `references unknown knowledge base: ...` |
| 上传超限 | 上传 1.1MB 文件 | 400 `Document too large` |
| 嵌入失败 | 清空 `LLM_API_KEY` 后运行 | 流内 `run_failed: embedding provider not configured: LLM_API_KEY`，无 `retrieval` / `node_finished` |
| EXPLAIN | §14.6 | 小数据量看到 Sort；强制关排序后看到 HNSW |

**可复现的最小命令序列**：

```powershell
# 1) 确认数据库与索引
docker exec -e PGPASSWORD=difyai123456 mini-dify-db psql -U postgres -d minidify -c "\d chunks"

# 2) 启动 api-ts
pnpm --filter @mini-dify/api-ts start:dev

# 3) 直接检索（先按阶段 1/2 的方式拿到 token 与知识库 id）
curl.exe -X POST "http://localhost:3001/knowledge-bases/<KB_ID>/search" `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"退款怎么申请\",\"topK\":3}"

# 4) 图运行（先 PUT 草稿）
curl.exe -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"question\":\"退款怎么申请\"}}"
```

图 JSON 示例（`knowledge → llm → end`）：

```jsonc
{
  "version": "1",
  "nodes": [
    { "id": "start_1", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "inputs": [{ "name": "question", "required": true }] } },
    { "id": "kb1", "type": "knowledge", "position": { "x": 120, "y": 0 },
      "data": {
        "title": "知识检索",
        "knowledgeBaseId": "<KB_ID>",
        "query": "{{ start_1.question }}",
        "topK": 3
      } },
    { "id": "llm1", "type": "llm", "position": { "x": 240, "y": 0 },
      "data": {
        "title": "LLM",
        "prompt": "根据以下资料回答问题：\n{{ kb1.context }}\n\n问题：{{ start_1.question }}"
      } },
    { "id": "end_1", "type": "end", "position": { "x": 360, "y": 0 },
      "data": { "outputs": [{ "name": "answer", "value": "{{ llm1.text }}" }] } }
  ],
  "edges": [
    { "id": "e1", "source": "start_1", "target": "kb1" },
    { "id": "e2", "source": "kb1", "target": "llm1" },
    { "id": "e3", "source": "llm1", "target": "end_1" }
  ]
}
```

---

## 21. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **把 JS 数组直接丢给 `<=>`** | `42883 operator does not exist: vector <=> numeric[]` | Prisma 把 `number[]` 绑成 `numeric[]`；用 `toVectorLiteral` 得到字符串，再 `::vector`（§11.3） |
| **字符串参数忘了 `::vector`** | `column "embedding" is of type vector but expression is of type text` | 文本不会隐式转 vector；`$n::vector` 不能省（§11.2） |
| **`ORDER BY ... DESC`** | top1 是最不相关的块，分数最低 | 距离升序才是最相似在前；删掉 `DESC`（§12.2） |
| **`score = distance`** | 相关度越高的分数越小 | `score = 1 - distance`（§12.1） |
| **`ORDER BY 1 - (embedding <=> $1) DESC`** | 结果正确，但 HNSW 用不上 | 排序必须保持原始距离表达式；score 只放 SELECT（§12.3） |
| **`WHERE knowledge_base_id` 漏写** | topK 跨库、跨用户；可能泄露别人的文档 | 范围过滤必须在 SQL 里（§13.2） |
| **只靠应用层查归属** | 复用一个新入口时越权读取 | `searchChunks` 不接收 `ownerId`；每个入口都要先 `findOwned` / `validateKnowledgeNodes`（§13.3） |
| **`prisma migrate dev` 生成 `DROP INDEX chunks_embedding_hnsw`** | 索引消失，大数据量下检索变慢 | Prisma 不认识 schema 外的 HNSW 索引；删掉自动迁移里的 DROP，手工保留索引（§10.3） |
| **用 `prisma.chunk.findMany()` 读 `embedding`** | 该字段根本不返回 / 类型报错 | `Unsupported` 的字段 Prisma Client 不可读写；需要时 `$queryRaw` 里 `embedding::text`（§10.1） |
| **小数据量 `EXPLAIN` 没看到 HNSW，以为索引坏了** | 计划是 Sort / Seq Scan | 成本驱动，8 行排序比 ANN 便宜；强制关排序即可验证索引可用（§14.3） |
| **索引 ops class 与算子不匹配** | 不报错，但索引永远不被使用 | `vector_cosine_ops` 只能配 `<=>`；用 `<->` 要 `vector_l2_ops`（§14.4） |
| **`context` 用 `"\n"` 或 `"\n\n\n"`** | 跨后端「契约一致」验收失败 | 两端必须同一个 `"\n\n"`，且顺序与 chunks 一致（§17.3） |
| **把 `retrieval` 放在 `node_finished` 之后** | 事件顺序违反协议 | `emitRetrieval` 必须在 `runKnowledgeNode` 返回前调用（§15.2） |
| **嵌入失败不进 400 而进流** | HTTP 接口返回 200 SSE | `KbService.search` 用 `embedOrBadRequest` 包成 400；节点才用 `embedTexts` → `run_failed`（§0） |
| **`topK` 传字符串 `"3"` 进图** | 预检 400 | 图 JSON 不做类型转换；HTTP DTO 才用 `@Type`（§18.5） |
| **上传 1MB 只靠业务层检查** | 大文件在 Multer 层就 413，形状不是契约 | 保留 `UploadTooLargeFilter` 把 413 归一为 400（§6） |
| **`EMBEDDING_MODEL` 换维度** | `embedding request failed: unknown`（维度不是 1536） | `vector(1536)` 维度不可变；换维度必须新迁移重建列与索引 |
| **空检索结果** | `context = ""`，模型可能胡编 | 这是当前实现的边界；需要时在业务层加「空召回」策略（§17.4） |

---

## 22. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **Prisma `Unsupported("vector(1536)")` 的边界**：迁移可建列、Client 不可读写；向量读写只能用原生 SQL | **首次教学于本篇** |
| **`$executeRaw` / `$queryRaw` 标签模板**：每个 `${}` = 一个绑定参数（`$1`、`$2`…）；表名/列名不能参数化；禁用 `Unsafe` 拼接 | **首次教学于本篇** |
| **向量参数必须传 `'[0.1,0.2,...]'` 字符串 + `$n::vector`**：JS 数组会被绑成 `numeric[]`，在 `<=>` 处报 `operator does not exist: vector <=> numeric[]`；字符串 + 显式 cast 跨语言一致、可移植 | **首次教学于本篇** |
| **余弦距离 `<=>`**：`distance = 1 - cosine_similarity` ⇒ `score = 1 - distance`；范围 0..2，score 可为负 | **首次教学于本篇** |
| **`ORDER BY embedding <=> $n` 的方向**：默认升序 = 距离最小 = 最相似在前；`DESC` 会反；按 score 排序会让 HNSW 失效 | **首次教学于本篇** |
| **`EXPLAIN` / `EXPLAIN ANALYZE` 视角**：cost/rows/actual、Sort、Bitmap Heap Scan、top-N heapsort；小数据量不走 HNSW 是成本驱动而非 bug | **首次教学于本篇** |
| **HNSW（Hierarchical Navigable Small World）**：多层近邻图、ANN（近似）、`m` / `ef_construction` / `hnsw.ef_search`、ops class 必须与算子匹配、过滤与 ANN 的顺序问题（iterative scan） | **首次教学于本篇** |
| **检索 SQL 的 `JOIN documents`**：为 `documentName`；`chunks.knowledge_base_id` 冗余 + btree 索引；归属过滤必须在 SQL 内，应用层只负责鉴权 | **首次教学于本篇** |
| **`knowledge` 是普通节点**：无内部节点/条件边/环，执行恰好一次；事件 `node_started → retrieval → node_finished`；失败不发 `node_finished` | **首次教学于本篇** |
| **`retrieval` 事件的设计动机**：引用展示（可解释性）、验收可断言、携带 `knowledgeBaseId`/`topK` 配置；每节点只发一次；与 `node_finished.output.chunks` 的分工 | **首次教学于本篇** |
| **节点输出 `{chunks, context}`**：结构化 + 纯文本两种消费者；`context` 用 `"\n\n"` 连接且顺序与 chunks 一致（两端逐字节一致）；空命中 `""` | **首次教学于本篇** |
| **预检（`validateKnowledgeNodes`）**：缺失 / 未知或他人 / `topK` 越界 / `query` 非字符串，全部在开流前 400；批量 `findMany` + 内存过滤避免 N+1；「不存在」与「不是你的」同文案 | **首次教学于本篇** |
| **`ownerId` 必须进预检**：否则 B 用户可在图里引用 A 的知识库；`searchChunks` 本身不做归属校验，复用入口必须自己补 | **首次教学于本篇** |
| **HTTP 400 与流内 `run_failed` 的双通道**（检索场景的落地）：`embedOrBadRequest` vs `embedTexts`；同一段 SQL 两种错误出口 | 本篇（双通道概念见 `04-执行引擎/01-运行契约与SSE事件协议.md`） |

> 已在前序篇教学、本篇仅引用不重讲的：SSE 帧格式与事件协议见 `04-执行引擎/01-运行契约与SSE事件协议.md`；「先校验、后开流」见 `04-执行引擎/05-SSE流式响应实现.md`；模板解析与变量池见 `04-执行引擎/03-节点运行时与变量池.md`；`Annotation` / 动态建图 / 条件边见 `04-执行引擎/02-LangGraph编译图-TS.md` 与 `06-工具调用/02-NestJS-ReAct循环与条件边.md`；Prisma schema / 迁移见 `01-账号与认证/02-Prisma.md`；归属 404 惯例见 `02-应用管理/03-NestJS应用模块.md`；外部依赖错误映射模式见 `05-LLM节点/03-LLM错误映射.md`；知识库契约、pgvector 建模与 embedding 服务见本阶段第 `01` / `02` 篇；前端知识库页面与引用展示见本阶段前端篇。
