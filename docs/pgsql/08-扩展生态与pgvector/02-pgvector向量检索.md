# 02 · pgvector 向量检索

> 所属：阶段 8 · 扩展生态与 pgvector
> 本篇覆盖：`vector` 类型与固定维度、三种距离算子（`<->` L2 / `<=>` 余弦 / `<#>` 负内积）、HNSW vs IVFFlat 两种近似近邻索引与调参、Top-K 检索查询写法、与项目 `chunks.embedding vector(1536)` 实战结合
> **本篇首次教学：`vector(n)` 类型（维度必须在表、索引、插入三处一致）、向量字面量 `'[...]'::vector`、距离算子 `<->`/`<=>`/`<#>`（返回**距离**，`ORDER BY ... ASC LIMIT k` 取最近）、`score = 1 - 余弦距离` 的转换、操作符类 `vector_l2_ops`/`vector_cosine_ops`/`vector_ip_ops`、HNSW 索引（`m`/`ef_construction` 建表参数、`hnsw.ef_search` 查询参数）、IVFFlat 索引（`lists` 聚类数、`ivfflat.probes` 查询探测数）、HNSW vs IVFFlat 召回/速度/内存取舍**（`CREATE EXTENSION` 见 `08-01`；后续篇只引用，不再重讲）
> 预告：全文检索与中文分词见阶段 9；pgvector 调优（`ef_search`/`probes`、索引重建）进阶见阶段 10。

> 下文所有「完整文件路径」均**相对仓库根**（本系列位于 `docs/pgsql/` 下）。
> 项目实战代码见 `d:\user\my_project\github\mini-dify\apps\api-ts\src\rag\`（`embedding.service.ts` / `kb.service.ts`）。

---

## 1. 本篇目标

- 理解「向量化检索」是什么：把文本变成固定维度的向量，用**距离**衡量相似度。
- 掌握 `vector(n)` 类型、三种距离算子，能写出一条 Top-K 近邻查询。
- 会在 HNSW 与 IVFFlat 两种近似近邻索引之间做选择，并知道各自的调参旋钮。
- 能对照项目 `chunks.embedding vector(1536)` 说出整套检索链路。

**验收标准**

1. 装 `vector` 扩展，建一张含 `vector(3)` 列的表，插入 3 维向量。
2. 用 `<=>` 余弦距离写出 Top-2 近邻查询，解释 `ORDER BY ... ASC` 的含义。
3. 建一个 HNSW 索引，用 `EXPLAIN` 证明检索走了索引。
4. 对照项目说出：为什么维度固定 1536、为什么用 `vector_cosine_ops`、为什么 Prisma 要走原生 SQL。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成 `08-01`（会装扩展）；索引与 `EXPLAIN` 见阶段 6 |
| 环境 | PG 镜像含 `pgvector`（mini-dify 用官方 pgvector 镜像，`CREATE EXTENSION vector` 即可） |
| 知识 | 余弦相似度的直观含义（夹角越小越相似） |

---

## 3. 先理解：什么是向量检索

文本/图片等「非结构化数据」没法直接 `WHERE content = ...` 精确匹配。解法是**用 embedding 模型把文本变成一串数字（向量）**，然后：

- 两条文本 → 两个向量；
- 向量之间的**距离**（夹角、欧氏距离、内积）≈ 文本的语义相似度。

检索时把查询也向量化，在库里找**距离最近的 K 个向量**对应的文本。这就是 RAG（检索增强生成）里的「检索」环节。

> 为什么要用专门的数据库列和索引？因为向量维度动辄 768/1536/3072，逐行算距离的全表扫描在百万级数据下不可接受，需要**近似最近邻（ANN）索引**加速。pgvector 就是干这个的。

---

## 4. vector 类型：维度必须固定且一致（首次教学）

### 4.1 建列

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE items (
    id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content   text NOT NULL,
    embedding vector(3) NOT NULL      -- 3 维向量，仅演示；真实场景 768/1536
);
```

> 关键规则：**维度必须在三处完全一致**——表定义 `vector(n)`、索引操作符类、插入的向量字面量。换 embedding 模型会改变维度，必须同步改表结构与索引（项目里固定 1536 维，见 §8）。

### 4.2 插入向量字面量

```sql
-- 向量字面量格式：'[x, y, z]'::vector
INSERT INTO items (content, embedding) VALUES
    ('apple',  '[1, 0, 0]'::vector),
    ('banana', '[0, 1, 0]'::vector),
    ('cherry', '[1, 1, 0]'::vector);
```

> 项目里把 JS 数组拼成 `[0.1,0.2,...]` 字符串再 `::vector`，见 `kb.service.ts` 的 `toVectorLiteral()`。

---

## 5. 距离算子：返回距离，越小越近（首次教学）

pgvector 提供三种距离算子，**返回的都是「距离」**（越小越相似）：

| 算子 | 距离类型 | 对应操作符类 |
| --- | --- | --- |
| `<->` | L2 欧氏距离 | `vector_l2_ops` |
| `<=>` | 余弦距离（`1 - cosine_similarity`） | `vector_cosine_ops` |
| `<#>` | **负内积**（`-dot(a, b)`） | `vector_ip_ops` |

### 5.1 Top-K 查询模板

```sql
-- 找与查询向量最相似的 2 条
SELECT id, content,
       embedding <=> '[1, 1, 0]'::vector AS distance
FROM items
ORDER BY embedding <=> '[1, 1, 0]'::vector   -- 距离升序 = 相似度降序
LIMIT 2;
```

> 心智模型：**`ORDER BY 距离算子 ASC LIMIT k`** 就是「取最近的 k 个」。别被 `<=>` 看着像「等于」迷惑，它是余弦距离运算符。

### 5.2 余弦相似度分数的换算

余弦**距离**范围 `[0, 2]`（距离 0 = 完全同向 = 最相似）。通常展示给用户的是「分数」（越大越相关），换算：

```sql
SELECT content, 1 - (embedding <=> '[1, 1, 0]'::vector) AS score
FROM items
ORDER BY embedding <=> '[1, 1, 0]'::vector
LIMIT 2;
```

> 项目 `searchChunks()` 正是这么做的：`score = 1 - (c.embedding <=> query::vector)`，见 `kb.service.ts` 第 201 行。

### 5.3 三种距离怎么选

| 场景 | 选 | 说明 |
| --- | --- | --- |
| 文本语义相似度（embedding 模型输出） | **余弦距离 `<=>`** | 与向量模长无关，只看方向；绝大多数 RAG 用这个 |
| 坐标/几何（位置接近度） | L2 欧氏 `<->` | 距离就是空间距离 |
| 已归一化的向量、追求最大点积 | 内积 `<#>`（注意取负） | 要求向量**已归一化**才有「余弦相似度」语义 |

> 项目统一用 `vector_cosine_ops` + `<=>`（见 §8 migration）。

---

## 6. 近似近邻索引：HNSW vs IVFFlat（首次教学）

没有索引时，Top-K 查询是**全表扫描 + 逐行算距离**。pgvector 提供两种 ANN（近似最近邻）索引，用「近似」换「速度」。

### 6.1 HNSW：图索引（推荐默认）

```sql
CREATE INDEX items_embedding_hnsw
    ON items USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

| 参数 | 作用 | 默认 | 调大 |
| --- | --- | --- | --- |
| `m` | 每个节点的最大连接数（图的度数） | 16 | 召回↑，内存/构建时间↑ |
| `ef_construction` | 构建时探索宽度 | 64 | 召回↑，构建更慢 |

查询时还要设 `ef_search`（探索宽度，**运行时参数**）：

```sql
SET hnsw.ef_search = 100;   -- 越大召回越高、查询越慢；默认 40
```

### 6.2 IVFFlat：倒排聚类索引

```sql
CREATE INDEX items_embedding_ivf
    ON items USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

| 参数 | 作用 | 经验值 |
| --- | --- | --- |
| `lists` | 聚类中心数（把数据分成 N 个桶） | 数据量的平方根，或 100~1000 |
| `ivfflat.probes` | 查询时探测几个桶（**运行时参数**） | 1 = 最快最不准；↑ = 更准更慢 |

```sql
SET ivfflat.probes = 10;   -- 从 100 个桶里查 10 个
```

### 6.3 HNSW vs IVFFlat 怎么选

| 维度 | HNSW | IVFFlat |
| --- | --- | --- |
| 召回率 | **更高**（图遍历更准） | 较低（聚类近似） |
| 查询速度 | 快 | 快（小 `probes` 时更快） |
| 构建速度 | 慢 | 快 |
| 内存 | **大**（图的边） | 小（聚类中心） |
| 索引体积 | 大 | 小 |
| 适用 | 数据量中等、追求召回 | **海量数据、内存敏感**，可用 `probes` 调召回 |

> 项目 `chunks` 用 **HNSW**：知识库规模不会到百万级，召回比内存更重要（见 §8 migration）。

### 6.4 索引真的命中了吗？用 EXPLAIN 验

```sql
EXPLAIN SELECT content
FROM items
ORDER BY embedding <=> '[1,1,0]'::vector
LIMIT 2;
```

命中时会看到 `Index Scan using items_embedding_hnsw` 之类节点；没命中是 `Seq Scan`。小表可能优化器仍选 `Seq Scan`，与 `03-02` 的 GIN 同理。

---

## 7. 完整示例：从建表到 Top-K 检索

```sql
CREATE EXTENSION IF NOT EXISTS vector;
DROP TABLE IF EXISTS items;
CREATE TABLE items (
    id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content   text NOT NULL,
    embedding vector(3) NOT NULL
);
CREATE INDEX items_embedding_hnsw ON items USING hnsw (embedding vector_cosine_ops);

INSERT INTO items (content, embedding) VALUES
    ('apple',  '[1, 0, 0]'::vector),
    ('banana', '[0, 1, 0]'::vector),
    ('cherry', '[1, 1, 0]'::vector),
    ('date',   '[0, 0, 1]'::vector);

-- 找与 [1,1,0] 最相似的 2 个
SELECT id, content,
       1 - (embedding <=> '[1, 1, 0]'::vector) AS score
FROM items
ORDER BY embedding <=> '[1, 1, 0]'::vector
LIMIT 2;
-- 预期：cherry(1.0) 第一，apple/banana 并列(0.707) 第二
```

---

## 8. 项目实战：mini-dify 的 pgvector 链路

项目知识库（`apps/api-ts/src/rag/`）的 pgvector 用法与本篇概念完全对应，逐条对照：

### 8.1 表与维度（migration.sql）

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
    id          TEXT NOT NULL,
    document_id TEXT NOT NULL,
    content     TEXT NOT NULL,
    embedding   vector(1536),        -- 固定 1536 维
    ...
);

CREATE INDEX chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops);
```

> 维度 1536 来自 `text-embedding-3-small` 的输出（`embedding.service.ts` 的 `EMBEDDING_DIMENSIONS = 1536`）。**维度必须与表、索引、插入三处一致**——若换模型改了维度，得 `ALTER TABLE ... ALTER COLUMN embedding TYPE vector(N)` 并重建索引。

### 8.2 写入（原生 SQL，Prisma 不支持 vector）

```ts
// kb.service.ts 第 141-144 行
await tx.$executeRaw`
  INSERT INTO chunks (..., embedding, ...)
  VALUES (..., ${toVectorLiteral(vectors[index])}::vector, ...)
`
```

> `toVectorLiteral()` 把 `number[]` 拼成 `[0.1,0.2,...]`，再 `::vector`。Prisma 对 `vector` 类型用 `Unsupported`，**所有向量读写都走原生 SQL**（这是 ORM + pgvector 的典型配合方式）。

### 8.3 检索（Top-K 余弦相似度）

```ts
// kb.service.ts searchChunks() 第 200-207 行
SELECT c.document_id, d.name, c.chunk_index, c.content,
       1 - (c.embedding <=> ${literal}::vector) AS score
FROM chunks c
JOIN documents d ON d.id = c.document_id
WHERE c.knowledge_base_id = ${knowledgeBaseId}
ORDER BY c.embedding <=> ${literal}::vector
LIMIT ${topK}
```

> 与 §5.2 完全一致：`score = 1 - 余弦距离`，`ORDER BY 距离 ASC LIMIT topK`。注意 `WHERE knowledge_base_id = ...` 是**先按知识库过滤再做向量近邻**，避免跨库检索。

---

## 9. 与 MySQL 对照

| 能力 | PostgreSQL + pgvector | MySQL |
| --- | --- | --- |
| 向量类型 | `vector(n)` 原生类型（扩展） | 8.4 之前无原生；8.4 起实验性 `VECTOR`（仍弱） |
| 距离算子 | `<->`/`<=>`/`<#>` 原生 | 需手写函数或 UDF |
| ANN 索引 | HNSW / IVFFlat 内建 | 无内建 ANN 索引 |
| 生态 | pgvector（成熟、活跃） | 通常外挂 Elasticsearch / Milvus / Qdrant |

> 这是 PG 相对 MySQL 的**杀手锏级差异**：PG 靠扩展就能在库里做向量检索，省去一套外部向量数据库。

---

## 10. 验收自测

### 10.1 建表 + 插入 + Top-K

跑 §7 完整示例，确认 `cherry` 排第一（余弦相似度 1.0）。

### 10.2 验证索引命中

```sql
EXPLAIN SELECT content FROM items
ORDER BY embedding <=> '[1,1,0]'::vector LIMIT 2;
-- 预期含 Index Scan using items_embedding_hnsw
```

### 10.3 切换距离算子与操作符类

```sql
-- 用 L2 距离（需重建索引为 vector_l2_ops）
CREATE INDEX items_embedding_hnsw_l2 ON items USING hnsw (embedding vector_l2_ops);
SELECT content FROM items ORDER BY embedding <-> '[1,1,0]'::vector LIMIT 2;
```

### 10.4 项目链路口述

说出：维度为何是 1536、为何用 `vector_cosine_ops`、为何 Prisma 走 `$executeRaw`。

---

## 11. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 插入报错「wrong number of dimensions」 | 字面量维度与列 `vector(n)` 不一致 | 对齐 embedding 模型输出维度与列定义 |
| 建索引报错「operator does not exist」 | 算子与操作符类不匹配 | `<=>` 配 `vector_cosine_ops`、`<->` 配 `vector_l2_ops` |
| `ORDER BY embedding <=> ...` 走了全表扫 | 没建索引 / 小表优化器选 Seq Scan | 建对应操作符类索引；小表可不管 |
| 召回率低、结果不准 | `ef_search`（HNSW）或 `probes`（IVFFlat）太小 | 调大运行时参数，牺牲速度换召回 |
| 换了 embedding 模型后查询全错 | 维度变了，表/索引还是旧维度 | `ALTER COLUMN ... TYPE vector(N)` + 重建索引 + 重新嵌入所有数据 |
| 用 `<#>` 内积但向量未归一化 | 内积受模长影响，不纯粹代表相似度 | 余弦用 `<=>`；若用内积先对向量归一化 |

---

## 12. 本篇小结

- `vector(n)` 类型，维度在表/索引/插入三处必须一致；字面量 `'[...]'::vector`。
- 三种距离算子都返回**距离**：`<->` L2、`<=>` 余弦、`<#>` 负内积；`ORDER BY 距离 ASC LIMIT k` 取最近。
- 两种 ANN 索引：**HNSW**（图，召回高、内存大，默认推荐）vs **IVFFlat**（聚类，体积小、海量场景）；分别用 `hnsw.ef_search` / `ivfflat.probes` 调召回。
- 项目链路：`text-embedding-3-small` → 1536 维 → `chunks.embedding vector(1536)` → HNSW `vector_cosine_ops` → `1 - (embedding <=> query)` Top-K。
- 相对 MySQL：PG + pgvector 把向量检索内置在库里，是 RAG 场景的杀手级组合。

至此阶段 8 收官：**扩展机制（8/01）+ pgvector（8/02）**。下一站 **阶段 9 · 全文检索（选修）**：`09-01-tsvector体系与中文方案.md`（`to_tsvector`/`to_tsquery`/`websearch_to_tsquery`、排名 `ts_rank`、GIN、中文分词 `zhparser`/`pg_jieba`，对照 MySQL FULLTEXT/ngram）。回复「继续」即开写。