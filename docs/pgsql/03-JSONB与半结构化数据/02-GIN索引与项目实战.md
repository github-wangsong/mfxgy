# 02 · GIN 索引与项目实战

> 所属：阶段 3 · JSONB 与半结构化数据
> 本篇覆盖：GIN 索引原理（倒排索引，为什么适合 `@>`/`?`）、建 GIN 索引的语法与操作符类（`jsonb_ops` vs `jsonb_path_ops`）、对项目画布 `apps.graph_json` / `apps.published_graph_json` 做节点查询、用 `EXPLAIN` 证明命中索引
> **本篇首次教学：GIN（Generalized Inverted Index）索引原理、`USING GIN` 建索引语法、`jsonb` 的两种 GIN 操作符类（默认 `jsonb_ops` 与 `jsonb_path_ops`）、`EXPLAIN (ANALYZE, BUFFERS)` 判「Seq Scan vs Bitmap Index Scan」**（`EXPLAIN` 精读的系统展开在阶段 6，本篇只教「如何证明走没走索引」）
> 预告：阶段 6 会系统讲执行计划与查询优化，`EXPLAIN` 的每一行都要逐字解读；本篇先把「用索引」这件事跑通。

> 本篇**实战部分**连的是真实项目库 `minidify`（容器 `mini-dify-db`、用户 `postgres`），列名 `graph_json` / `published_graph_json` 来自 mini-dify 阶段 3 建库（见 `docs/tutorial/03-画布/02-Prisma-JSONB与两态.md`）。前 5 节的原理演示也可在自建的 `pg_tutorial` 里用 `users.profile` 复现。

---

## 1. 本篇目标

- 知道**为什么** `WHERE jsonb @> ...` 这种查询，数据一大就需要索引（否则全表扫描）。
- 理解 GIN 的**倒排索引**原理，以及为什么它天然适合 `@>` / `?` 这类「包含 / 存在」判断。
- 会写 `CREATE INDEX ... USING GIN (col)`，并分清 `jsonb_ops` 与 `jsonb_path_ops` 的差别与选型。
- 对项目 `apps` 表的 `graph_json` 做「找含某节点类型的应用」查询，并用 `EXPLAIN` 证明命中索引。

**验收标准**：对画布 `graph_json` 执行一条 `@>` 节点查询，`EXPLAIN (ANALYZE, BUFFERS)` 里出现 **`Bitmap Index Scan`（而非 `Seq Scan`）**，并复述「为什么 GIN 能加速这类查询」。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成阶段 3 · 01（会用 `->` / `->>` / `@>` / `?` 等操作符） |
| 环境 | 能连上项目库：`docker exec mini-dify-db psql -U postgres -d minidify` |
| 数据 | `apps` 表里至少有一条带 `graph_json`（草稿）或 `published_graph_json` 的行（没有就按 §6 造一条） |
| 知识 | 图的 JSON 结构（`version` / `nodes[]` / `edges[]`，节点含 `id`/`type`/`position`/`data`）见 `docs/tutorial/03-画布/01-图JSON契约与校验.md` |

---

## 3. 问题：为什么 `@>` 查询需要索引

看这条查询——「找出所有画布里用过 `llm` 节点的应用」：

```sql
SELECT id, name
FROM apps
WHERE graph_json @> '{"nodes": [{"type": "llm"}]}';
```

> `@>` 是「左包含右」：`apps.graph_json` 里的 `nodes` 数组里，只要有一个节点的 `type` 是 `llm`，这行就命中（操作符语义见阶段 3 · 01 第 7 节）。

这条查询的问题在于：`@>` 是一个**函数式/结构式**比较，DB **不能**像对 `id = '...'` 那样直接跳到某行。**没有索引时，DB 只能一行一行地读整列 jsonb、逐个算 `@>`**——这叫**顺序扫描 `Seq Scan`**。数据几千行还好，几十万、几百万行时，每次查询都全表扫一遍，代价不可接受。

**解决办法**：给这一列建 **GIN 索引**，让「哪些行包含 `{"type":"llm"}`」这件事被预先**倒排**好，查询时直接查索引、再回表取那几行。

---

## 4. GIN 原理（首次教学：倒排索引）

### 4.1 GIN 是什么

GIN = **Generalized Inverted Index（通用倒排索引）**。它和「按值有序的 B-tree」不同，核心思想是**倒排**：

| 思路 | 说明 | 类比 |
| --- | --- | --- |
| B-tree 正排 | 每行一个键，键有序 → 适合 `=`、范围 `>` `<` | 字典：按名字查释义 |
| GIN 倒排 | 每个「可检索的项」→ 一串「含它的行号」 | 书末索引：按关键词查页码 |

一个 jsonb 文档会被**拆解**成很多「可检索项」（键、值、数组元素），GIN 建成「项 → 出现位置」的映射。于是 `@> '{"nodes":[{"type":"llm"}]}'` 就变成：找到「`llm` 这个值」对应的行集合，再验证一下。

### 4.2 为什么 GIN 特别配 jsonb

jsonb 的查询几乎都是「**这个文档里有没有某个键/某个值/某个子结构**」——正是「倒排查找」。所以：

| jsonb 操作符 | 是否被 GIN 加速 | 原因 |
| --- | --- | --- |
| `@>`（包含） | ✅ | 拆出右值的键与值，倒排定位候选行 |
| `?` / `?|` / `?&`（键存在） | ✅（仅默认操作符类） | 键被建成索引项 |
| `->` / `->>`（取值） | ❌ | 取值不是「查找」，无法用索引；常用于 WHERE 里则应改写为 `@>` 或表达式索引 |

> 一句话：**`@>` 和 `?` 能走 GIN，`->`/`->>` 不走 GIN**。所以「按内部内容过滤」的查询要尽量写成 `@>` 形式。

---

## 5. 建 GIN 索引：语法与两种操作符类

### 5.1 建索引语法

```sql
CREATE INDEX 索引名 ON 表名 USING GIN (列名);
```

例（对草稿图建）：

```sql
CREATE INDEX apps_graph_json_gin ON apps USING GIN (graph_json);
```

- 与 B-tree 的区别只在 `USING GIN`（默认 `USING btree`）。
- 一个列可建多个不同操作符类的 GIN；也可对 `published_graph_json` 再建一个。

### 5.2 两种操作符类：`jsonb_ops` 与 `jsonb_path_ops`

`USING GIN (graph_json)` 里，`graph_json` 后可以指定**操作符类**（决定索引「拆哪些项、支持哪些操作符」）：

| 操作符类 | 写法 | 支持的操作符 | 索引大小 / 建索引速度 | 选型建议 |
| --- | --- | --- | --- | --- |
| 默认 `jsonb_ops` | `USING GIN (graph_json)` | `@>`、`?`、`?\|`、`?&`（最全） | 较大 / 较慢 | 需要 `?` 键存在查询时用 |
| `jsonb_path_ops` | `USING GIN (graph_json jsonb_path_ops)` | **仅 `@>`**（及较新的 jsonpath `@?`/`@@`） | **更小 / 更快** | 只需要 `@>` 包含查询时用（推荐） |

```sql
-- 推荐：只做包含查询时，用更小更快的 jsonb_path_ops
CREATE INDEX apps_graph_json_gin_path ON apps USING GIN (graph_json jsonb_path_ops);
```

**本项目画布的节点查询全部是 `@>`（找含某节点类型的图），用不到 `?`** → 选 `jsonb_path_ops`。

> 通俗结论：**默认类「功能全、体量大」，`jsonb_path_ops`「只留 `@>`、更省更快」。** 用不到 `?` 就选 `jsonb_path_ops`。

### 5.3 两种操作符类的源码依据（为什么 `@>` 必须有）

`@>` 的特性让 Postgres 特意给 jsonb 做了两个操作符类：

- `jsonb_ops`：把 jsonb 的**每个键、每个值、每个数组元素**都建成索引项——索引大，但 `?`（键存在）、`?|`、`?&` 也被支持。
- `jsonb_path_ops`：只把「**到叶子值为止的路径 + 值**」建成索引项，不索引中间键——所以**更小**，但**只能回答 `@>`**。
- 两者都要求 `@>` 才能利用（本教程画布查询正是 `@>`，所以选 `jsonb_path_ops`）。

### 5.4 实测：两种索引的大小对比（可选）

```sql
-- 先建两个索引，再比大小
CREATE INDEX apps_graph_json_gin      ON apps USING GIN (graph_json);
CREATE INDEX apps_graph_json_gin_path ON apps USING GIN (graph_json jsonb_path_ops);

SELECT
  pg_size_pretty(pg_relation_size('apps_graph_json_gin'))      AS jsonb_ops_size,
  pg_size_pretty(pg_relation_size('apps_graph_json_gin_path')) AS jsonb_path_ops_size;
```

**预期**：`jsonb_path_ops` 的索引通常**更小**（数据越多差距越明显）。

---

## 6. 项目实战准备：看清 `apps.graph_json` 的图结构

项目画布的 `graph_json` 存的就是一份 `Graph`（结构见 tutorial 03-画布），长这样：

```json
{
  "version": "1",
  "nodes": [
    {"id": "n_start", "type": "start", "position": {"x": 0, "y": 0},   "data": {}},
    {"id": "n_llm",   "type": "llm",   "position": {"x": 200, "y": 0}, "data": {"model": "gpt-4", "prompt": "hi"}},
    {"id": "n_end",   "type": "end",   "position": {"x": 400, "y": 0}, "data": {}}
  ],
  "edges": [
    {"id": "e1", "source": "n_start", "target": "n_llm"},
    {"id": "e2", "source": "n_llm",   "target": "n_end"}
  ]
}
```

**关键点**：我们要按 `nodes` 里某个节点的 `type`（或 `id`）过滤应用——这正是 `@>` 的拿手场景。

### 6.1 先看现有数据

```sql
SELECT id, name,
       jsonb_array_length(graph_json -> 'nodes')            AS draft_nodes,
       jsonb_array_length(published_graph_json -> 'nodes')  AS pub_nodes
FROM apps
WHERE graph_json IS NOT NULL OR published_graph_json IS NOT NULL;
```

- `jsonb_array_length(x)` 返回 jsonb 数组 x 的元素个数（对 `graph_json -> 'nodes'` 取到的 `nodes` 数组计数）。

### 6.2 没有数据？造一条演示图

若 `apps` 里还没有带图的行，先取一个已存在的应用 id（或用户 id）再灌一份：

```sql
-- 先找一个可用的应用（没有就跳过，去用项目 API 存一张画布）
SELECT id, name FROM apps LIMIT 5;

-- 把一份含 start / llm / end 的示例图塞进某个应用的草稿（把 '<APP_ID>' 换成上面查到的 id）
UPDATE apps
SET graph_json = jsonb_build_object(
    'version', '1',
    'nodes', jsonb_build_array(
        jsonb_build_object('id', 'n_start', 'type', 'start',
                           'position', jsonb_build_object('x', 0, 'y', 0),
                           'data', jsonb_build_object()),
        jsonb_build_object('id', 'n_llm', 'type', 'llm',
                           'position', jsonb_build_object('x', 200, 'y', 0),
                           'data', jsonb_build_object('model', 'gpt-4', 'prompt', 'hi')),
        jsonb_build_object('id', 'n_end', 'type', 'end',
                           'position', jsonb_build_object('x', 400, 'y', 0),
                           'data', jsonb_build_object())
    ),
    'edges', jsonb_build_array(
        jsonb_build_object('id', 'e1', 'source', 'n_start', 'target', 'n_llm'),
        jsonb_build_object('id', 'e2', 'source', 'n_llm',   'target', 'n_end')
    )
)
WHERE id = '<APP_ID>';
```

> `jsonb_build_object` / `jsonb_build_array` 在阶段 3 · 01 第 9 节教过，此处用它拼出和图契约一致的 JSON。

---

## 7. 节点查询（`@>` 实战）

### 7.1 找「含 `llm` 节点」的应用

```sql
SELECT id, name
FROM apps
WHERE graph_json @> '{"nodes": [{"type": "llm"}]}';
```

怎么读这条：右边 `{"nodes":[{"type":"llm"}]}` 是一个「查询探针」——只要 `graph_json` 的 `nodes` 数组里**有某个节点的 `type` 是 `llm`**，就命中（`@>` 的对象 + 数组包含语义见 01 第 7 节）。

### 7.2 找「含某个具体节点 id」的应用

```sql
SELECT id, name
FROM apps
WHERE graph_json @> '{"nodes": [{"id": "n_llm"}]}';
```

### 7.3 对「已发布快照」做同样的查询

```sql
SELECT id, name
FROM apps
WHERE published_graph_json @> '{"nodes": [{"type": "llm"}]}';
```

> 三条都是 `@>`，**SQL 结构完全一致**，只换「打哪个列」。这正说明「两态共用一套查询模型」——草稿与快照只是两张列，查询写法一样。

### 7.4 需要「键存在」判断时的写法（回到 `?`）

若想「找出草稿非空的应用」（草稿对象里有 `nodes` 这个键就说明存过图）：

```sql
SELECT id, name
FROM apps
WHERE graph_json ? 'nodes';   -- 注意：? 只有默认 jsonb_ops 的 GIN 才加速
```

> 用默认操作符类的 GIN 才能加速 `?`；`jsonb_path_ops` 不支持 `?`（见 §5.2）。项目画布只用 `@>`，所以选 `jsonb_path_ops` 即可。

---

## 8. 建索引并 EXPLAIN 证明命中

### 8.1 先看「没索引」时的执行计划

建索引前，`EXPLAIN` 看这条 `@>` 查询的走向：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name
FROM apps
WHERE graph_json @> '{"nodes": [{"type": "llm"}]}';
```

**预期（没索引，走全表扫描）**：

```
Seq Scan on apps  (cost=0.00..1.12 rows=1 width=40) (actual time=0.012..0.014 rows=1 loops=1)
  Filter: (graph_json @> '{"nodes": [{"type": "llm"}]}'::jsonb)
  Rows Removed by Filter: 11
Planning Time: 0.070 ms
Execution Time: 0.055 ms
```

看几个关键词：`Seq Scan`（顺序扫描，逐行算 `@>`）、`Filter`（把 `@>` 当过滤器逐行算）、`Rows Removed by Filter`（被过滤掉的行）。

### 8.2 建索引

```sql
CREATE INDEX apps_graph_json_gin_path ON apps USING GIN (graph_json jsonb_path_ops);
```

### 8.3 再看执行计划（走起来了）

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name
FROM apps
WHERE graph_json @> '{"nodes": [{"type": "llm"}]}';
```

**预期（走了 GIN 索引）**：

```
Bitmap Heap Scan on apps  (cost=8.27..10.28 rows=1 width=40) (actual time=0.015..0.017 rows=1 loops=1)
  Recheck Cond: (graph_json @> '{"nodes": [{"type": "llm"}]}'::jsonb)
  Heap Blocks: exact=1
  ->  Bitmap Index Scan on apps_graph_json_gin_path  (cost=0.00..8.27 rows=1 width=0) (actual time=0.010..0.010 rows=1 loops=1)
        Index Cond: (graph_json @> '{"nodes": [{"type": "llm"}]}'::jsonb)
```

**对比结论**：内层出现了 **`Bitmap Index Scan on apps_graph_json_gin_path`**（而不是 `Seq Scan`），`Index Cond` 用的就是那条 `@>` 条件——证明**查询命中 GIN 索引**。

> GIN 索引走的是「**Bitmap**」方式：先从索引拿到**一堆候选行号**（`Bitmap Index Scan`），再**批量回表取整数行**（`Bitmap Heap Scan`），中间还可能 `Recheck Cond`（GIN 允许假阳性，回表后重新验一遍条件）。这是 GIN 的典型形态，阶段 6 会详解每个节点。

### 8.4 小表上的坑：为什么建了索引还走 Seq Scan？（重要）

**数据很少时**，即使建了索引，`EXPLAIN` 可能仍是 `Seq Scan`：因为查询规划器估算「全表扫一遍更便宜」（表只有几行，扫全表比查索引+回表更快）。

这是**正常的、正确的**行为，不是索引没建对。**教学演示**要强制看索引路径，可临时关掉顺序扫描（**别在真实环境这么干**）：

```sql
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name
FROM apps
WHERE graph_json @> '{"nodes": [{"type": "llm"}]}';
ROLLBACK;
```

`SET LOCAL` 只在当前事务内生效，`ROLLBACK` 后自动恢复；`enable_seqscan = off` 只是「让规划器禁用全表扫描」以示教，**生产环境不要全局关，否则简单查询也会被迫走索引、反而变慢**。

> 判断索引是否真的可用，看**内层有没有 `Bitmap Index Scan on <你的索引名>`**，而不是「有没有写 Seq Scan」。

---

## 9. 两种操作符类的取舍（小结回顾）

| 需求 | 用哪个操作符类 | 关键操作符 |
| --- | --- | --- |
| 只做包含查询（画布节点查询） | `jsonb_path_ops`（更小更快，推荐） | `@>` |
| 还要做「键存在」查询 | 默认 `jsonb_ops`（功能全） | `@>` + `?`/`?\|`/`?&` |
| 只要取值（不按内容过滤） | 不需要 GIN；必要时用表达式索引（阶段 6） | `->`/`->>` |

---

## 10. 与 MySQL 对照

| 维度 | MySQL | PostgreSQL |
| --- | --- | --- |
| 存 JSON 类型 | `JSON`（无二进制可索引版本） | `jsonb`（二进制、可 GIN 索引） |
| 按内部键/值过滤 | `JSON_EXTRACT` / `JSON_CONTAINS`（**函数**，通常**不走索引**） | `@>`/`?`（**操作符**，可被 GIN 索引加速） |
| 加速 JSON 查询 | 用**生成列（generated column）**把要过滤的键抽成普通列，再给生成列建普通索引（间接） | **原生 GIN 索引**直接加速 `@>`/`?` |
| 索引类型 | B-tree（生成列上） | GIN（倒排，专为多值/包含设计） |
| 查询成本 | 每加一种过滤维度要加一列 + 索引 | 一个 GIN 索引覆盖 `@>` 的多种子结构查询 |

> 一句话：PG 用 **`jsonb` + GIN** 让半结构化数据的「包含查询」走真正的索引；MySQL 得靠**生成列间接做**，且每换一个过滤维度都要多建列。这也是项目选 PG 存画布 `jsonb` 的原因之一。

---

## 11. 验收自测

> 都过了才算完成本篇。

### 11.1 能说出为什么需要索引

口头说清：`@>` 查询为什么数据一大就必须有索引（`Seq Scan` 逐行算 vs `GIN` 倒排定位）。

### 11.2 会建两种操作符类

```sql
CREATE INDEX IF NOT EXISTS apps_graph_json_gin_path ON apps USING GIN (graph_json jsonb_path_ops);
```

### 11.3 能写出节点查询

```sql
-- 找含 llm 节点的应用（两条都该命中带 llm 的图）
SELECT id, name FROM apps WHERE graph_json @> '{"nodes": [{"type": "llm"}]}';
SELECT id, name FROM apps WHERE published_graph_json @> '{"nodes": [{"type": "llm"}]}';
```

### 11.4 能证明命中索引

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name FROM apps WHERE graph_json @> '{"nodes": [{"type": "llm"}]}';
-- 预期内层出现 Bitmap Index Scan on apps_graph_json_gin_path（若小表仍是 Seq Scan，用 §8.4 的 SET LOCAL enable_seqscan=off 复现后 ROLLBACK）
```

---

## 12. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 建了 GIN 还是 `Seq Scan` | 数据太少，规划器认为全表扫更便宜 | 正常；教学用 `SET LOCAL enable_seqscan = off` 看索引路径，生产别全局关（§8.4） |
| `?` 查询在 `jsonb_path_ops` 下不走索引 | `jsonb_path_ops` **不支持 `?`** | 需要 `?` 就用默认 `jsonb_ops`，或把查询改写为 `@>`（§5.2） |
| 用 `->`/`->>` 当过滤条件却期望走索引 | 取值操作符**不走 GIN** | 改写成 `@>`；或建表达式索引（阶段 6） |
| `@>` 右边没加 `::jsonb` | 语义歧义 / 类型不符 | 写成 `'{"nodes":[{"type":"llm"}]}'::jsonb`（01 篇已提醒） |
| 以为 GIN 能加速**所有** jsonb 查询 | GIN 只加速 `@>` 与 `?` 系列 | 选择正确的操作符类与查询写法（§4.2） |
| 只有一个 GIN 却想同时覆盖草稿和快照 | 一个索引只对应**一列** | 对 `graph_json` 和 `published_graph_json` 各自建索引 |
| 忽略 `Recheck Cond` | 以为 GIN 结果 100% 精确 | GIN 有**假阳性**，回表后会用 `Recheck Cond` 再验一遍，正常（§8.3） |
| 忘了 `jsonb_path_ops` 写的位置 | 字段后直接写操作符类 | 语法是 `USING GIN (列名 jsonb_path_ops)`（§5.1） |

---

## 13. 小结

- **为什么**：`@>`/`?` 是「结构式查找」，无索引只能 `Seq Scan` 逐行算。
- **GIN**：倒排索引，把 jsonb 拆成「可检索项 → 行号」映射，专克「包含/存在」查询。
- **建法**：`CREATE INDEX ... USING GIN (col [操作符类])`。
- **选类**：只做 `@>` → `jsonb_path_ops`（更小更快）；要 `?` → 默认 `jsonb_ops`。
- **实战**：对 `apps.graph_json`（/`published_graph_json`）用 `@>` 找「含某节点类型」的应用。
- **证明**：`EXPLAIN (ANALYZE, BUFFERS)` 内层出现 `Bitmap Index Scan on <索引名>` 即命中；小表走 `Seq Scan` 是正常的，别慌。

阶段 3 收尾到此——`jsonb` 的**读写**（01）与**索引**（02）已齐。下一站顺理成章是**阶段 4 · 查询进阶**（JOIN 全家桶 / 窗口函数 / CTE），或你指定的下一章。