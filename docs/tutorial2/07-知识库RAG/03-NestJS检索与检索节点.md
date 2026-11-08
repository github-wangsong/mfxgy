# 03 · NestJS 检索与检索节点（知识库 RAG）

> 阶段 7 · 第 3 步
>
> 做完：`POST /knowledge-bases/{id}/search` 返回按相似度降序的 `hits`；画布上的 `knowledge` 节点能渲染 query 模板、嵌入、检索、发一次 `retrieval` 事件、输出 `{ chunks, context }`；预检保证只能检索自己的知识库。
>
> **本篇面试考点**：`<=>` 与 `1 - distance` · 为什么 `ORDER BY` 必须用距离表达式而不是别名 `score` · HNSW 与过滤条件的配合 · `topK` 的默认值与上限 · 为什么空结果也要发 `retrieval` · `context` 为什么用 `\n\n` 拼接 · 预检为什么用一次 `findMany` 批量查归属 · 嵌入失败在 HTTP 与节点里的两种表现 · 每次检索都要重新嵌入 query 的成本。

---

## 1. 两条使用路径，一份检索逻辑

```text
路径 A：检索调试（前端知识库页）
POST /knowledge-bases/:id/search
  → search() → embedTexts([query]) → searchChunks() → SearchKnowledgeBaseResponse

路径 B：画布运行
knowledge 节点 → runKnowledgeNode()
  → renderTemplate(data.query) → embedTexts([query]) → searchChunks()
  → emitRetrieval() → { chunks, context }
```

两条路径的**唯一检索实现**是 `searchChunks()`。这样：

- SQL 只有一份，改索引/改分数公式不会漏；
- 两端（TS/Python）对比时，比对的是同一段逻辑；
- 调试接口验证过的行为，画布运行时必然一致。

> **面试考点 · 为什么不让节点直接调 HTTP 接口？**
> 理论上可以（节点 → `POST /search`），但会有：
>
> - 多一次进程内 HTTP 往返（自己调自己）；
> - 鉴权要透传 token，节点只有 `ownerId`；
> - 超时/错误语义要重新定义（HTTP 400 vs `run_failed`）。
>
> 进程内直接调用函数，是**同一服务内复用**的正确方式。**HTTP 是跨进程边界，不是函数调用语法。**

---

## 2. 检索 SQL

**完整文件路径：`apps/api-ts/src/rag/kb.service.ts`**（检索部分）

```ts
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
```

### 2.1 `<=>` 是什么

pgvector 提供三个距离运算符：

| 运算符 | 距离 | 索引 opclass |
| --- | --- | --- |
| `<->` | 欧氏距离（L2） | `vector_l2_ops` |
| `<#>` | 负内积 | `vector_ip_ops` |
| `<=>` | 余弦距离（`1 - cosine_similarity`） | `vector_cosine_ops` |

```text
cosine_distance = 1 - (a·b) / (|a|·|b|)
cosine_similarity = 1 - cosine_distance
```

- 距离范围 `[0, 2]`，0 = 方向完全相同；
- 相似度范围 `[-1, 1]`，1 = 完全相同。

SQL 里 `ORDER BY c.embedding <=> ${literal}::vector` 是**距离升序** = 相似度降序。

> **面试考点 · 为什么 `ORDER BY` 不写 `score DESC`？**
> 因为 `score` 是 `SELECT` 里的别名，而且它是“距离的变换”。
>
> 1. **语义上**：`ORDER BY score DESC` 与 `ORDER BY distance ASC` 等价，但多一层心智转换；
> 2. **性能上**（关键）：HNSW 索引的排序键是 `embedding <=> $1`。写成别名时，部分 PG 版本仍能优化，但写成 `1 - (...)` 会**让优化器无法直接匹配索引顺序**，退化为全表扫描 + 排序。
>
> 规则：**`ORDER BY` 里用与索引定义完全一致的表达式**，别名只用于展示。
> 验证方式：`EXPLAIN` 看是否出现 `Index Scan using chunks_embedding_hnsw`。

### 2.2 索引与过滤条件

```sql
WHERE c.knowledge_base_id = $2
ORDER BY c.embedding <=> $1
LIMIT $3
```

- `knowledge_base_id` 上有普通 B-tree 索引（`chunks_knowledge_base_id_idx`）；
- `embedding` 上有 HNSW 索引；
- PG 只能选一个索引做主要访问路径：通常走 HNSW 拿近邻，再用 `knowledge_base_id` 过滤（过滤在索引扫描之后）。

后果：

- 如果库很小、过滤性很强，可能走 B-tree + 排序，也很快；
- 如果库里数据多但目标库只占很小一部分，**HNSW 会取回很多近邻再丢弃**，实际召回可能不足 `topK`。

> **面试考点 · 过滤 + 向量检索为什么会“召回不足”？**
> HNSW 的搜索过程是“在图上走 `ef_search` 个候选”。如果先按图取 40 个最近邻，其中只有 3 个属于当前库，`LIMIT 4` 就只能返回 3 条——即使库里还有更相关的块。
>
> 解决方向：
>
> 1. 每个知识库**独立分区/独立索引**（物理隔离，最彻底）；
> 2. 调大 `hnsw.ef_search`（提高召回，代价是延迟）；
> 3. 使用 pgvector 0.8+ 的**部分索引**（`WHERE knowledge_base_id = '...'`）——但每个库一个索引，不适合动态创建库。
>
> 本项目规模小（单库 ≤ 1MB 文本），不做额外处理，但**要知道这是近似检索的固有取舍**。
> **“向量检索是近似的”这句话，在带过滤条件时尤其成立。**

### 2.3 参数名与 SQL 注入

```ts
`... WHERE c.knowledge_base_id = ${knowledgeBaseId} ... LIMIT ${topK}`
```

`$queryRaw` 的模板字符串里，`${}` 会变成**绑定参数**（`$1/$2/...`），不是字符串拼接：

- `knowledgeBaseId` 即使包含 `' OR 1=1 --` 也只是普通字符串；
- `topK` 是数字，绑定后 `LIMIT $3` 合法。

**唯一不能用参数化的地方是 `::vector` 的类型转换**，所以只能把向量转成文本字面量再 `::vector`（见 `02` 篇）。这也是本项目唯一“看起来像拼接”的地方——但字面量内容只由 `Number` 组成，不来自用户自由文本。

---

## 3. 检索接口

**完整文件路径：`apps/api-ts/src/rag/kb.controller.ts`**（检索节选）

```ts
  @Post(':id/search')
  @HttpCode(200)
  search(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SearchKnowledgeBaseDto,
  ): Promise<SearchKnowledgeBaseResponse> {
    return this.kbService.search(payload.sub, id, dto.query, dto.topK)
  }
```

**完整文件路径：`apps/api-ts/src/rag/kb.service.ts`**（`search` 方法）

```ts
  /**
   * 检索知识库：校验归属 → 嵌入 query → 余弦检索 → 组装响应。
   *
   * `topK` 缺省 4（契约默认）；越界由 DTO 的 `@Min/@Max` 拦在 400。
   */
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
```

`DEFAULT_TOP_K = 4` 与契约 `default: 4` 一致。

> **面试考点 · 为什么响应里要回显 `query` 与 `topK`？**
> 请求里有默认值（`topK` 可省略），响应回显能让调用方**确认实际用了什么**：
>
> - 前端不用在本地再算一遍默认值；
> - 日志/对比时，响应自身是完整的（不需要回看请求体）；
> - 契约测试可以直接比对。
>
> 这是“**响应自带上下文**”的设计：凡是服务端补全的默认值，都在响应里返回。

---

## 4. `knowledge` 节点

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

要点：

1. **`renderTemplate` 在嵌入之前**：`query` 里可以有 `{{ inputs.question }}`，必须先渲染成自然语言再嵌入；
2. **只嵌入一次**：`embedTexts([query])` 取第一个结果，不要循环调用；
3. **`retrieval` 无条件发**：即使 `hits` 为空也发——前端需要知道“查过、但没命中”；
4. **`context` 由 hits 派生**：不要在 SQL 里 `string_agg`，因为 connector 必须与契约一致且两端容易实现。

### 4.1 引擎挂载

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`executeNode` 节选）

```ts
      case 'knowledge': {
        const knowledgeBaseId = String((node.data as { knowledgeBaseId?: unknown }).knowledgeBaseId ?? '')
        return runKnowledgeNode(node, pool, this.prisma, (hits, topK) =>
          queue.emit(retrieval(node.id, knowledgeBaseId, topK, hits)),
        )
      }
```

事件构造函数（阶段 4 已定义）：

```ts
/** `retrieval`：知识库检索结果（`knowledge` 节点发出）。 */
retrieval(nodeId, knowledgeBaseId, topK, hits) => ({
  event: 'retrieval',
  data: { nodeId, knowledgeBaseId, topK, hits },
})
```

顺序：`node_started(knowledge)` → `retrieval` → `node_finished(knowledge)`。

> **面试考点 · 为什么 `retrieval` 是独立事件，而不是塞进 `node_finished.output`？**
> `node_finished.output` 里其实已经有 `chunks`（与 `retrieval` 重复）。独立事件的价值：
>
> - **实时性**：前端在检索完成的瞬间就能展示“命中了哪几段”，不必等节点结束（虽然当前两者几乎同时）；
> - **语义清晰**：`retrieval` 是“检索这个动作的结果”，`node_finished` 是“节点完成”；
> - **将来可扩展**：如果节点内做多次检索（多库合并），可以有多个 `retrieval`。
>
> 代价是数据重复（同一个 `hits` 出现两次）。**事件流是给 UI 消费的，不是数据库范式；适度冗余换取前端简单，是合理的。**

### 4.2 预检

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（预检节选）

```ts
/**
 * `knowledge` 节点的运行前预检（需要 DB，故异步且拿到 `ownerId`）：
 * 缺 `knowledgeBaseId` → 未知/不属于当前用户 → `topK` 越界；同一节点内按此次序。
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

  // 先把所有出现的 id 收集起来，一次查完（避免 N 个节点查 N 次）
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

三个设计点：

1. **批量查归属**：10 个 `knowledge` 节点引用同一批库，只查一次；
2. **“不存在”与“不属于你”同一文案**：都报 `references unknown knowledge base`，不泄露他人库的存在性；
3. **`topK` 只校验整数范围**：浮点、字符串、0 都拒绝。

> **面试考点 · 为什么预检要查库，而不是运行时再查？**
> - **失败要发生在写 SSE 头之前**：预检失败返回普通 JSON 400；进入流之后再失败只能 `run_failed`，前端处理方式不同；
> - **用户能立刻看到配置错误**，而不是等运行到那个节点；
> - **避免执行一半才失败**（前面节点可能已经调用了付费 LLM）。
>
> 代价是预检多一次 DB 查询——相对于一次嵌入调用，可以忽略。

> **面试考点 · `data.knowledgeBaseId` 为什么还要 `typeof === 'string'`？**
> `node.data` 是 `Record<string, unknown>`（图来自数据库的 JSONB，**不可信**）：
>
> - 可能是数字（前端 bug / 手工改库）；
> - 可能是 `null`；
> - 可能缺失。
>
> 预检是**信任边界**：过了预检，`runKnowledgeNode` 里的 `as unknown as KnowledgeNodeData` 才是安全的。
> **每个 `as` 前面都应该有一次真实校验**，否则就是自欺欺人。

### 4.3 如何在 LLM 节点里用检索结果

`knowledge` 节点的输出进入变量池，键是节点 id：

```text
pool["knowledge1"] = { chunks: RetrievalHit[], context: string }
```

所以 `llm` 节点的 prompt 可以写：

```text
请根据以下资料回答问题。资料中没有的，不要编造。

资料：
{{ knowledge1.context }}

问题：{{ inputs.question }}
```

`end` 节点可以直接输出 `{{ knowledge1.context }}` 或 `{{ llm1.text }}`。

> **面试考点 · `context` 里要不要加分隔标记（如 `[1] ... [2] ...`）？**
> 当前实现只做 `\n\n` 连接，**不带编号**。取舍：
>
> - 带编号（`[1] 内容`）有利于模型引用来源，也便于前端做“点引用跳转”；
> - 不带编号更“纯”，模型不会强行编造 `[1]` 这样的引用。
>
> 本项目选择不带编号，因为 `chunks` 已单独返回，需要引用时前端可以自己按 `chunkIndex` 展示。
> **上下文格式是一种 prompt 设计决策，要写进契约或文档，不能靠“实现时随手定”。**

---

## 5. 验证

### 5.1 检索接口

先按 `02` 篇上传一份包含“退款”内容的文档，然后：

```powershell
$token = (curl.exe -s -X POST http://localhost:3001/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"alice@example.com","password":"password123"}' | ConvertFrom-Json).accessToken

curl.exe -s -X POST "http://localhost:3001/knowledge-bases/<KB_ID>/search" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d '{"query":"退款要多久","topK":4}' | ConvertFrom-Json | ConvertTo-Json -Depth 6
```

预期：

```json
{
  "query": "退款要多久",
  "topK": 4,
  "hits": [
    {
      "documentId": "…",
      "documentName": "refund.md",
      "chunkIndex": 0,
      "content": "退款政策……",
      "score": 0.82
    }
  ]
}
```

检查点：

- `hits` 按 `score` **降序**；
- `score ∈ [-1, 1]`（余弦相似度）；
- `topK` 省略时响应里是 `4`。

### 5.2 嵌入调用次数

检索一次 = **一次 embedding 调用**（query 单条）。可以在 mock provider 日志里确认只有一条 `/embeddings` 请求。

> 如果你发现每次检索都调用两次，通常是“先嵌入一次做长度检查、又嵌入一次做检索”——这种重复在成本上是真实的浪费。

### 5.3 空库

新建一个空知识库，检索：

```powershell
curl.exe -s -X POST "http://localhost:3001/knowledge-bases/<EMPTY_ID>/search" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d '{"query":"任意"}'
```

预期：

```json
{"query":"任意","topK":4,"hits":[]}
```

`200`，不是 `404`。**“库存在但没有内容”不是错误。**

### 5.4 越权与参数

```powershell
# bob 的 token 检索 alice 的库 → 404 Knowledge base not found
# topK: 0 / 21 / "abc" → 400
# query: "" → 400
```

### 5.5 画布运行

图：

```text
start → knowledge1 → llm1 → end1
```

配置：

```json
{
  "knowledge1": {
    "title": "资料检索",
    "knowledgeBaseId": "<KB_ID>",
    "query": "{{ inputs.question }}",
    "topK": 4
  },
  "llm1": {
    "title": "回答",
    "model": "mock-model",
    "prompt": "资料：{{ knowledge1.context }}\n\n问题：{{ inputs.question }}"
  }
}
```

运行：

```powershell
curl.exe -s -N -X POST http://localhost:3001/apps/<APP_ID>/run `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d '{"inputs":{"question":"退款要多久"}}'
```

预期事件序：

```text
event: run_started
event: node_started    knowledge1
event: retrieval       {"nodeId":"knowledge1","knowledgeBaseId":"…","topK":4,"hits":[…]}
event: node_finished   knowledge1  {"chunks":[…],"context":"…"}
event: node_started    llm1
event: token           llm1  "echo: 资料：…"
event: node_finished   llm1
event: node_started    end1
event: node_finished   end1
event: run_finished
```

`llm1` 的 token 文本里应能看到检索到的原文（因为 mock 会把 prompt 回显）。

### 5.6 预检错误

```text
1. knowledgeBaseId 置空                     → 400 knowledge node knowledge1 knowledgeBaseId is required
2. knowledgeBaseId 改成别人的 / 不存在的     → 400 ... references unknown knowledge base: xxx
3. topK: 0                                   → 400 ... topK must be between 1 and 20
4. 无 LLM_API_KEY                            → 预检通过，运行时 run_failed: embedding provider not configured: LLM_API_KEY
```

### 5.7 索引生效

```powershell
docker compose exec postgres psql -U minidify -d minidify -c `
  "EXPLAIN ANALYZE SELECT c.id FROM chunks c
   WHERE c.knowledge_base_id = '<KB_ID>'
   ORDER BY c.embedding <=> (SELECT embedding FROM chunks LIMIT 1)
   LIMIT 4;"
```

数据量小时，优化器可能选 B-tree + Sort（这很正常）。**数据量大时要能看到 `chunks_embedding_hnsw`**；如果始终没有，检查：

- 索引是否被 `migrate dev` 删了（见 `01` 篇）；
- `ORDER BY` 是否被改写成了 `1 - (...)`。

---

## 6. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 为什么复用 `searchChunks` | SQL 单一实现，调试接口与节点行为必然一致 |
| `<=>` | 余弦距离；索引需 `vector_cosine_ops` |
| `1 - distance` | 对外用相似度，符合直觉；转换只在一处 |
| `ORDER BY` 用距离表达式 | 否则无法匹配 HNSW 索引顺序 |
| HNSW + 过滤 | 近似检索可能召回不足；`ef_search` / 分区 / 部分索引 |
| 参数化 | `$queryRaw` 的 `${}` 是绑定参数，防注入 |
| 响应回显 `topK` | 服务端默认值要在响应中可见 |
| `retrieval` 无条件发 | 空命中也要让前端知道“查过了” |
| `context` 用 `\n\n` | 两端逐字节一致；编号是 prompt 设计决策 |
| 预检查库 | 失败要在 SSE 头之前；避免执行一半才报错 |
| 批量查归属 | 避免 N 个节点 N 次查询 |
| 不存在 vs 无权 | 同一文案，不泄露存在性 |
| `as` 前必须有校验 | `node.data` 来自 JSONB，不可信 |
| 嵌入失败两态 | HTTP 400 / 节点 `run_failed` |
| 每次检索都嵌入 | query 是动态的，无法缓存；可考虑按 query 哈希缓存 |

---

## 7. 下一步

- `04-Python对齐与前端知识库页.md`：SQLAlchemy `Vector` 映射、`cosine_distance`、同一检索接口、上传/列表/检索调试页。
- `05-验收.md`：同一文件两端切分对比、检索命中对比、跨后端读同一知识库、无密钥降级、阶段回归。
