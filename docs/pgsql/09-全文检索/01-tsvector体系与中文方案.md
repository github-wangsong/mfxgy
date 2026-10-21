# 01 · tsvector 体系与中文方案

> 所属：阶段 9 · 全文检索（选修）
> 本篇覆盖：`tsvector` 类型与 `to_tsvector` 分词、四类 `to_tsquery` 构造、`@@` 匹配与 `ts_rank` 排名、GIN 加速、中文分词方案（`zhparser`/`pg_jieba`），与 MySQL FULLTEXT/ngram 对照
> **本篇首次教学：`tsvector` 类型（带位置的词条列表）；`to_tsvector(regconfig, text)` 分词与停用词/词干还原；`to_tsquery`（需 `&`/`|`/`!`/`<->` 运算符）、`plainto_tsquery`（自动 `&`）、`phraseto_tsquery`（短语相邻）、`websearch_to_tsquery`（Google 风格）四种查询构造；`@@` 匹配操作符；`ts_rank`/`ts_rank_cd` 排名；GIN 索引（`to_tsvector` 表达式索引或生成列）；中文分词扩展 `zhparser`/`pg_jieba`（默认配置不切中文）**（`CREATE EXTENSION` 见 `08-01`；GIN 原理见 `03-02`；后续篇只引用，不再重讲）
> 预告：备份恢复见阶段 10；项目 mini-dify 用 **pgvector 向量检索**（阶段 8）而非全文检索，本篇为选修补齐 PG 搜索能力。

> 下文所有「完整文件路径」均**相对仓库根**（本系列位于 `docs/pgsql/` 下）。

---

## 1. 本篇目标

- 理解 PG 全文检索的两大数据：**`tsvector`（文档分词结果）** 与 **`tsquery`（查询）**，以及 `@@` 把它们连起来。
- 会用 `to_tsvector`、四类 `to_tsquery` 构造查询，并用 `ts_rank` 给结果按相关性排序。
- 知道「**默认 `to_tsvector` 不切中文**」的坑，以及 `zhparser`/`pg_jieba` 等方案的取舍。
- 能对照 MySQL `FULLTEXT` + `ngram`，说出 PG 全文检索的优势。

**验收标准**

1. 建表 + `to_tsvector` 生成 tsvector 列，用 `@@` 做匹配查询。
2. 用 `websearch_to_tsquery` 支持「引号短语 + OR」语法。
3. 用 `ts_rank` 给匹配结果排序，说明排名高低的依据。
4. 说清中文分词为何需要扩展，以及可选方案。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成 `03-02`（GIN）与 `08-01`（扩展机制） |
| 环境 | 用 `postgres` 超管连 `pg_tutorial`；中文分词需自行编译 `pg_jieba`/`zhparser`（演示可用 `simple` 配置说明问题） |
| 知识 | 生成列（`GENERATED ALWAYS AS ... STORED`，`00-03`） |

---

## 3. 全文检索的两大数据：tsvector 与 tsquery（首次教学）

PG 把全文检索拆成两个专用类型：

| 类型 | 角色 | 由谁产生 |
| --- | --- | --- |
| `tsvector` | 文档的分词结果（一组带位置的词条） | `to_tsvector()` |
| `tsquery` | 查询条件（词 + 布尔/短语运算） | `to_tsquery()` 等四个函数 |

两者用 **`@@`** 连接：`tsvector @@ tsquery` 返回是否匹配。

### 3.1 to_tsvector：把文本变成词条列表

```sql
-- 英文分词：去停用词(a/on)、词干还原(sat 不变、cats→cat)、记录位置
SELECT to_tsvector('english', 'a fat cat sat on a mat and a rat');
-- 结果：'and':7 'cat':3 'fat':2 'mat':6 'rat':9 'sat':4
```

> 输出里每个 `'词':位置`，多个位置用逗号。停用词（如 `a`、`on`、`the`）被丢弃，因为它们对检索无意义。
> 第一个参数 `regconfig` 是**文本检索配置**，决定分词规则、停用词表、词干还原词典。常用：`english`（英文）、`simple`（只按空格切、不还原、不去停用词）。

### 3.2 @@ 与 to_tsquery：查询匹配

```sql
-- 匹配：文档包含 fat 且 cat
SELECT to_tsvector('english', 'a fat cat sat') @@ to_tsquery('english', 'fat & cat');
-- 结果：true
```

`to_tsquery` 的查询语法支持运算符：

| 运算符 | 含义 |
| --- | --- |
| `&` | 与（同时出现） |
| `\|` | 或 |
| `!` | 非 |
| `<->` | 相邻（`A <-> B` 表示 B 紧跟 A），`<2>` 表示隔 2 个位置 |

---

## 4. 四类构造 tsquery 的函数（首次教学）

直接写 `to_tsquery` 要手动加 `&`/`|`，容易写错。PG 提供四个友好函数：

| 函数 | 行为 | 适合 |
| --- | --- | --- |
| `to_tsquery(cfg, 'fat & rat')` | 直接解析运算符，语法错会报错 | 程序拼好的精确查询 |
| `plainto_tsquery(cfg, 'fat rat')` | 词之间自动加 `&` | 普通关键词搜索（空格=AND） |
| `phraseto_tsquery(cfg, 'fat rat')` | 词之间用 `<->`，要求**相邻** | 精确短语匹配 |
| `websearch_to_tsquery(cfg, '"fat rat" or cat')` | **Google 风格**：`"` 短语、`or`、`-`排除 | 给用户的搜索框 |

```sql
-- Google 风格："fat rat" 短语 OR cat，排除 mouse
SELECT websearch_to_tsquery('english', '"fat rat" or cat -mouse');
-- 结果：'fat' <-> 'rat' | 'cat' & !'mouse'
```

> 经验：**面向用户的搜索框一律用 `websearch_to_tsquery`**，它容错、符合直觉；`to_tsquery` 只在你要精确控制运算符时用。

---

## 5. 排名：ts_rank / ts_rank_cd（首次教学）

匹配了还要**按相关性排序**，用 `ts_rank`：

```sql
SELECT
    content,
    ts_rank(to_tsvector('english', content), websearch_to_tsquery('english', 'cat')) AS rank
FROM docs
WHERE to_tsvector('english', content) @@ websearch_to_tsquery('english', 'cat')
ORDER BY rank DESC;
```

| 函数 | 排名依据 |
| --- | --- |
| `ts_rank` | 词频 + 词在文档中的位置权重（标题/正文权重不同） |
| `ts_rank_cd` | **覆盖密度**（词在文档中越密集、越集中，分越高） |

> 排名是**浮点数**，无绝对意义，只用于**同查询内排序**。调权重用 `setweight(tsvector, 'A'|'B'|'C'|'D', ...)` 给不同字段标权重（标题给 A 最高、正文给 D）。

---

## 6. GIN 索引加速（首次教学）

每次查询都现算 `to_tsvector` 太慢，用**表达式索引**或**生成列 + GIN**：

### 6.1 表达式索引（最快上手）

```sql
CREATE INDEX docs_fts ON docs
    USING gin (to_tsvector('english', content));
```

> 注意：查询里的 `to_tsvector('english', content)` 必须与索引表达式**逐字一致**（同配置、同函数），优化器才会用索引（与 `06-01` 表达式索引同理）。

### 6.2 生成列 + GIN（推荐用于大表）

```sql
ALTER TABLE docs
    ADD COLUMN fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX docs_fts_idx ON docs USING gin (fts);

-- 查询直接用生成列
SELECT content, ts_rank(fts, q) AS rank
FROM docs, websearch_to_tsquery('english', 'cat') AS q
WHERE fts @@ q
ORDER BY rank DESC;
```

> 生成列在写入时算好 `tsvector`，查询直接读，比每次现算更快。`00-03` 讲过生成列，这里复用。

---

## 7. 中文：默认不切，需要扩展（首次教学）

中文没空格，`to_tsvector` 默认（包括 `english` 和 `simple`）会把整段中文当作**一个词**或者**逐字**，无法正常检索：

```sql
SELECT to_tsvector('simple', ' PostgreSQL 全文检索很好用 ');
-- 结果类似：'postgresql':1 '全文检索很好用':2  ← 中文整段一个词，搜不到
```

### 7.1 解决方案

| 方案 | 说明 |
| --- | --- |
| **`pg_jieba`**（推荐） | 用结巴分词的 PG 扩展，`to_tsvector('jiebacfg', '...')` 即可切中文 |
| **`zhparser`** | 老牌中文分词扩展，需编译，配置稍复杂 |
| **应用层分词 + `simple`** | 应用先把中文切成空格分隔的词，PG 用 `simple` 配置存储 |
| **直接用 pgvector 语义检索** | 不做关键词全文，用 embedding（阶段 8）；项目选了这条路 |

> 镜像里通常**不带** `pg_jieba`/`zhparser`，需自行编译安装。若不便，中文搜索可考虑「应用层分词 + simple」或干脆上 pgvector。

### 7.2 切分后效果（示意，需 pg_jieba）

```sql
-- 假设已装 pg_jieba 并创建 jiebacfg 配置
SELECT to_tsvector('jiebacfg', 'PostgreSQL 全文检索很好用');
-- 期望：'postgresql':1 '全文':2 '检索':3 '很好用':4
```

---

## 8. 完整示例：英文文档的搜索与排名

```sql
CREATE TABLE docs (
    id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content text NOT NULL,
    fts     tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX docs_fts_idx ON docs USING gin (fts);

INSERT INTO docs (content) VALUES
    ('PostgreSQL supports full text search with tsvector and tsquery.'),
    ('MySQL has FULLTEXT indexes with ngram parser for Chinese.'),
    ('PostgreSQL full text search uses GIN indexes for speed.');

-- 搜 "full text"，按排名降序
SELECT id, content, ts_rank(fts, q) AS rank
FROM docs, websearch_to_tsquery('english', '"full text"') AS q
WHERE fts @@ q
ORDER BY rank DESC;
```

---

## 9. 与 MySQL 全文检索对照速查

| 维度 | PostgreSQL | MySQL |
| --- | --- | --- |
| 文档分词类型 | `tsvector` | FULLTEXT 索引（隐式） |
| 查询 | `to_tsquery` 等四函数 + `@@` | `MATCH(col) AGAINST('query')` |
| 排名 | `ts_rank`/`ts_rank_cd` | `AGAINST` 自带相关性分数 |
| 索引 | GIN / GiST | FULLTEXT（B-tree 变种） |
| 英文 | 内置 `english` 配置，去停用词 + 词干还原 | 内置英文分词 + 停用词 |
| 中文 | 需 `pg_jieba`/`zhparser` 扩展 | `WITH PARSER ngram`（内置，按 n-gram 切） |
| 查询语法 | `&`/`\|`/`!`/`<->`、`websearch_to_tsquery` | `AGAINST('+word -other' IN BOOLEAN MODE)` |
| 短语 | `phraseto_tsquery` / `"..."` | `AGAINST('"phrase"' IN BOOLEAN MODE)` |

> PG 的优势：**配置灵活**（可换词典、停用词、排名算法）、`websearch_to_tsquery` 对用户友好、与 GIN/生成列无缝结合；MySQL 的优势：**中文 ngram 开箱即用**（PG 需编译扩展）。

---

## 10. 项目关联：为什么 mini-dify 没用全文检索

项目知识库检索走的是 **pgvector 向量检索**（阶段 8），不是 `tsvector`。原因：

- RAG 场景需要**语义相似**（「退款」能搜到「退货」），关键词全文做不到；
- 项目用 `text-embedding-3-small` 把文本向量化后存 `chunks.embedding`，直接余弦距离检索；
- 若将来要「关键词精确召回」（如搜 SKU、订单号），可在 `chunks.content` 上补一个 `tsvector` + GIN，**与向量检索并存**（先向量召回，再全文重排）。

---

## 11. 验收自测

### 11.1 tsvector + @@ 匹配

```sql
SELECT to_tsvector('english', 'a fat cat sat') @@ plainto_tsquery('english', 'fat cat');
-- 预期 true
```

### 11.2 websearch_to_tsquery 语法

```sql
SELECT websearch_to_tsquery('english', '"fat cat" or dog -mouse');
-- 解读结果：'fat' <-> 'cat' | 'dog' & !'mouse'
```

### 11.3 生成列 + GIN + 排名

跑 §8 完整示例，确认搜 `"full text"` 返回两条文档且按 `ts_rank` 排序。

### 11.4 中文坑验证

```sql
SELECT to_tsvector('simple', '中文全文检索');
-- 观察中文是否被正确切分（默认不切，需扩展）
```

---

## 12. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 中文搜不到 | 默认配置不切中文 | 装 `pg_jieba`/`zhparser`，或应用层分词 + `simple` |
| 建了 GIN 索引还全表扫 | 查询里 `to_tsvector(config, col)` 与索引表达式配置不一致 | 两处配置逐字一致 |
| `to_tsquery` 报语法错 | 含空格或未加运算符 | 改用 `plainto_tsquery`/`websearch_to_tsquery` |
| 排名全是 0 或一样 | 文档太短或词频差异小 | 用 `ts_rank_cd`、或 `setweight` 加权标题列 |
| 索引体积过大 | GIN 存了所有词条位置 | 大数据量考虑 `jsonb_path_ops` 式精简；或只索引必要字段 |
| 停用词导致搜不到 | `english` 配置丢了 `a`/`the` 等 | 用 `simple` 配置（不去停用词），或自定义配置 |

---

## 13. 本篇小结

- 全文检索两大数据：`tsvector`（文档分词结果）+ `tsquery`（查询），用 `@@` 匹配。
- `to_tsvector` 分词去停用词 + 词干还原；四个 `to_tsquery` 变体里，面向用户用 `websearch_to_tsquery`。
- `ts_rank`/`ts_rank_cd` 按相关性排序；生成列 `GENERATED ALWAYS AS (to_tsvector(...)) STORED` + GIN 是大表推荐做法。
- 中文默认不切，需 `pg_jieba`/`zhparser` 扩展或应用层分词；项目用 pgvector 语义检索绕过了这个问题。
- 对照 MySQL：PG 更灵活（配置/排名/GIN），MySQL 的 ngram 中文开箱即用。

阶段 9 收官（选修）。下一站 **阶段 10 · 备份、复制与运维（选修）**：`10-01-逻辑备份与恢复.md`（`pg_dump`/`pg_restore`/`pg_dumpall`、自定义格式与并行恢复、恢复演练）。回复「继续」即开写。