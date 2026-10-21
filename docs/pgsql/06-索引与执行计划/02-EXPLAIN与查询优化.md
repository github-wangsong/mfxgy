# 02 · EXPLAIN 与查询优化

> 所属：阶段 6 · 索引与执行计划
> 本篇覆盖：`EXPLAIN` 三种形态、执行计划逐行解读（`cost`/`rows`/`width`/`actual time`/`loops`）、`BUFFERS` 与回表代价、常见节点类型（Seq Scan / Index Scan / Index Only Scan / Bitmap Index+Heap Scan）、统计信息 `pg_stats` 与 `ANALYZE`、四类慢查询模式与改写
> **本篇首次教学：`EXPLAIN` vs `EXPLAIN ANALYZE` vs `EXPLAIN (ANALYZE, BUFFERS)` 的取舍、执行计划节点的缩进=执行顺序、`cost`（startup..total）与 `rows`/`width` 字段含义、`actual time`/`loops`、`Buffers shared hit/read`（回表代价物理账）、`Filter` vs `Index Cond` 区别、节点类型（Seq Scan/Index Scan/Index Only Scan/Bitmap Index+Heap Scan/Sort/Nested Loop/Hash Join/Limit）、`pg_stats`（`n_distinct`/`most_common_vals`/`histogram_bounds`）与 `ANALYZE`、深分页 `OFFSET` 改 keyset 分页**（后续篇只引用，不再重讲）
> 预告：GIN 场景的 `EXPLAIN (ANALYZE, BUFFERS)` 已在 `03-JSONB与半结构化数据/02-GIN索引与项目实战.md` 出现，本篇只补「逐行读计划」的通用框架；索引类型选择见 `06-01`，全文检索见阶段 9。

> 下文所有「完整文件路径」均**相对仓库根**（本系列位于 `docs/pgsql/` 下）。
> `users` / `orders` 表结构见 `00-06`；`CREATE INDEX` 各类语法见 `06-01`。

---

## 1. 本篇目标

- 掌握 `EXPLAIN` 的三种用法，知道「什么时候必须 `ANALYZE`、什么时候要加 `BUFFERS`」。
- 能**逐行读**一张执行计划：每个节点的成本、行数、时间、缓冲分别代表什么，缩进怎么表达执行顺序。
- 识别「索引没命中」的信号（`Seq Scan`、`Filter`、`Rows Removed by Filter`），并据此定位慢查询。
- 会用 `ANALYZE` 修正过时的统计信息，会改写四类典型慢查询（函数包裹、前导通配、跨列 `OR`、深分页）。

**验收标准**

1. 对同一条查询，用 `EXPLAIN SELECT ...` 看到走 `Seq Scan`，建索引后变成 `Index Scan`，前后对比证明优化生效。
2. 能从计划里读出：成本估算、实际行数、缓冲命中 vs 磁盘读、以及是否发生了回表。
3. 用 `pg_stats` 查到某列的统计信息，说出 `n_distinct` 与 `histogram_bounds` 的含义。
4. 把一条 `OFFSET 大数` 的深分页查询改写成 keyset 分页。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成 `06-01`（会建索引）；`EXPLAIN` 已在 `03-02` 见过一次 |
| 环境 | 已连上 `pg_tutorial` 库，`users` / `orders` 两张表存在 |
| 知识 | `CREATE INDEX`、`WHERE`/`JOIN`/聚合（`00` 各篇） |

---

## 3. EXPLAIN 的三种形态（首次教学）

`EXPLAIN` 是 PG 给你看「数据库打算怎么执行这条查询」的窗口。三种写法差别在「**要不要真跑**」和「**跑的时候记不记缓冲**」：

| 写法 | 是否真实执行 | 输出里有没有 | 何时用 |
| --- | --- | --- | --- |
| `EXPLAIN SELECT ...` | ❌ 只估算 | `cost` / `rows` / `width`（估算） | 快速看「走没走索引」，不改变数据 |
| `EXPLAIN ANALYZE SELECT ...` | ✅ 真执行 | 上述 + `actual time` / `actual rows` / `loops` | 看**真实**耗时与行数，验证估算准不准 |
| `EXPLAIN (ANALYZE, BUFFERS) SELECT ...` | ✅ 真执行 | 上述 + `Buffers`（每节点读了多少页） | 诊断**回表 / 缓存**，最常用 |

```sql
-- 只看计划，不执行（最安全、最常用）
EXPLAIN SELECT * FROM orders WHERE user_id = 1;

-- 真执行 + 缓冲信息，用于剖析慢查询
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 1;
```

> 关键记忆：**`ANALYZE` 是「真跑」，会实际执行你的 `INSERT`/`UPDATE`/`DELETE`**——所以只读查询随便 `ANALYZE`，但**别对写操作随意 `EXPLAIN ANALYZE`**，它会真的改数据（除非包在事务里回滚，见 §3.1）。
> 与 MySQL 对照：两库都有 `EXPLAIN`，但格式天差地别——MySQL 输出一行行 `id/type/key/rows/Extra`，PG 输出**一棵缩进的节点树**；MySQL 用 `SHOW PROFILE` 看耗时分布，PG 直接 `ANALYZE` 看 `actual time`。

### 3.1 安全地 EXPLAIN ANALYZE 写操作

```sql
BEGIN;                                            -- 开事务
EXPLAIN (ANALYZE, BUFFERS) UPDATE orders SET amount = amount WHERE user_id = 1;
ROLLBACK;                                         -- 立即回滚，不真正落库
```

> 用「事务包住 + `ROLLBACK`」既能拿到真实的 `actual time`，又不改变数据（事务回滚在 `00-07` 教过）。

---

## 4. 执行计划逐行解读（首次教学）

### 4.1 一张计划的样子与缩进 = 执行顺序

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT u.username, o.amount
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.id = 1;
```

示意输出（多层节点）：

```
 Nested Loop  (cost=0.29..16.75 rows=2 width=40) (actual time=0.012..0.020 rows=2 loops=1)
   ->  Index Scan using users_pkey on users u  (cost=0.29..8.30 rows=1 width=14) (actual time=0.006..0.007 rows=1 loops=1)
         Index Cond: (id = 1)
   ->  Index Scan using idx_orders_user on orders o  (cost=0.29..8.44 rows=2 width=30) (actual time=0.004..0.006 rows=2 loops=1)
         Index Cond: (user_id = u.id)
 Buffers: shared hit=12
 Planning Time: 0.150 ms
 Execution Time: 0.040 ms
```

**解读的关键：缩进表达「谁套着谁」，越往右执行得越靠内层**。上面这棵树的执行顺序是：

```
Nested Loop（外层，逐行取 users 的每一行）
  → 对每个 u.id，用内层 Index Scan 在 orders 上按 user_id 找匹配行
```

> 记忆技巧：**最内层（缩进最深）的节点先执行，把结果交给外一层**。上面两个 `Index Scan` 是 Nested Loop 的内层，被循环调用多次（`loops=1`/`loops=2` 揭示了调用次数）。

### 4.2 每个字段的含义

| 字段 | 估算版（EXPLAIN） | 实际版（ANALYZE） |
| --- | --- | --- |
| `cost=startup..total` | 启动成本（返回第一行前）.. 总成本，**相对单位**（越大越贵，非秒） | 同，仍是估算 |
| `rows` | **估算**返回行数 | —（改由 `actual rows` 给真实值） |
| `width` | 估算单行字节数 | — |
| `actual time=.. ..` | — | 该节点实际启动..完成耗时（毫秒） |
| `actual rows` | — | 该节点实际返回行数 |
| `loops` | — | 该节点被执行了多少次 |

> **判断「统计准不准」的核心对照：`rows`（估算）vs `actual rows`（实际）。** 若两者差几个数量级，说明统计信息过时 → 该 `ANALYZE`（§7）。`actual time × loops` 越大的节点，就是越该优化的热点。

### 4.3 `Filter` vs `Index Cond`（首次教学）

计划里会出现两种条件注解，含义截然不同：

| 注解 | 含义 | 是否走了索引 |
| --- | --- | --- |
| `Index Cond:` | 该条件**作为索引键**参与查找 | ✅ 走索引 |
| `Filter:` | 行**取回后**再按该条件过滤 | ❌ 未用索引（或不满足索引条件） |

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 1 AND amount > 10;
```

若只有 `idx_orders_user`（单列 user_id），输出会是：

```
 Index Scan using idx_orders_user on orders  (cost=... rows=2 ...)
   Index Cond: (user_id = 1)          ← 只用 user_id 定位
   Filter: (amount > 10)              ← 取回后再过滤 amount
   Rows Removed by Filter: 1          ← 说明 user_id=1 有 2 行，其中 1 行被 amount 过滤掉
```

> `Filter` 出现在 `Index Scan` 里意味着「**索引帮你定位了，但还有一部分行要捞回来再筛**」，若 `Rows Removed by Filter` 很大，说明索引选择性不足，该建复合索引 `(user_id, amount)`。

---

## 5. 常见节点类型速查（首次教学）

| 节点 | 含义 | 何时出现 |
| --- | --- | --- |
| `Seq Scan` | 全表顺序扫描（逐页读整表） | 无可用索引 / 小表 / 预估要读大部分行 |
| `Index Scan` | 走索引定位 + **回表**取行 | 有索引且选择性好，但要的列不在索引里 |
| `Index Only Scan` | 只读索引，**不回表**（覆盖索引） | 查询列全在索引内（`06-01` 的 `INCLUDE`），且表页真空可见 |
| `Bitmap Index Scan` → `Bitmap Heap Scan` | 先位图合并索引命中位，再按物理顺序回表 | 命中行较多但又不至于全表时，比 Index Scan 少随机读 |
| `Sort` | 排序（内存/磁盘） | `ORDER BY` / `GROUP BY` / `DISTINCT` 无顺序可利用 |
| `Nested Loop` | 嵌套循环 join | 外表小、内表有索引时最省 |
| `Hash Join` | 哈希 join | 两张表都大、等值连接时 |
| `Limit` | 提前停止，只取前 N 行 | `LIMIT`，可大幅减少上层成本 |

> `Seq Scan` 不一定是坏事：**小表全扫比走索引还快**（索引还要回表）。判断标准是看 `cost` 谁小，而不是见 `Seq Scan` 就紧张（`03-02` 里用 `enable_seqscan=off` 只是为演示强制走索引）。

---

## 6. BUFFERS 与回表代价（首次教学）

`EXPLAIN (ANALYZE, BUFFERS)` 多出 `Buffers:` 行，让你看到每个节点**实际读了几个内存页**：

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 1;
```

可能出现：

```
 Index Scan using idx_orders_user on orders  (cost=... rows=2 ...)
   Index Cond: (user_id = 1)
   Buffers: shared hit=8          ← 读了 8 页（索引页 + 回表的堆页）
```

| 字段 | 含义 |
| --- | --- |
| `shared hit` | 从**共享缓冲区（内存缓存）**命中读取的页数，快 |
| `shared read` | 从**磁盘**读取的页数，慢（冷数据首次读） |

> **用 Buffers 算「回表有多贵」**：`Index Scan` 查到 1 行索引约读 1 个索引页，但**每回表一行再读 1 个堆页**。若 `rows` 很多、`shared read` 又大，就是「索引定位快、回表动了很多随机 I/O」——此时换成覆盖索引（`INCLUDE` 要查询的列）走 `Index Only Scan`，`Buffers` 会显著下降。

> 对照 MySQL：MySQL 用 `EXPLAIN` 的 `Extra: Using index`（覆盖索引）与 `Using where` 表达类似意思；PG 直接看 `Index Only Scan` vs `Index Scan` + `Filter`。

---

## 7. 统计信息与 ANALYZE（首次教学）

PG 靠**统计信息**估算 `rows`（进而决定选哪个计划）。统计信息存在系统目录 `pg_stats` 里。

### 7.1 看某列的统计信息

```sql
SELECT attname, n_distinct, most_common_vals, histogram_bounds
FROM pg_stats
WHERE tablename = 'orders' AND attname = 'amount';
```

| 字段 | 含义 |
| --- | --- |
| `n_distinct` | 该列**不同值的个数**；负数表示「占行数的比例」（如 -0.5 = 一半行取值不同） |
| `most_common_vals` | 出现**最频繁**的那些值（MV，最常见值列表） |
| `histogram_bounds` | **直方图边界**（把值域分成若干桶的边界数组），用于范围估算 |

> 优化器就是靠 `n_distinct` 猜「`=` 命中几行」、靠 `histogram_bounds` 猜「`>` 命中几行」。猜得准 → 计划选得好。

### 7.2 用 ANALYZE 手动刷新统计

```sql
ANALYZE orders;              -- 只刷新这一张表
-- ANALYZE;                  -- 刷新全库（一般不用手动，autovacuum 会自动做）
```

> 何时手动 `ANALYZE`？**表刚大量 `INSERT`/`DELETE` 或重建索引后**，统计可能滞后，导致 `rows` 估算严重失真、选错计划。跑一次 `ANALYZE` 即可纠正。`autovacuum` 平时会自动更新统计（`05-02` 讲过），手动 `ANALYZE` 是「立刻纠正」的手段。
> 对照 MySQL：MySQL 有 `innodb_stats_*` 参数与 `ANALYZE TABLE`；概念一致（都是统计信息驱动计划），只是 PG 把统计信息**摊开成 `pg_stats` 可直接查**，更透明。

---

## 8. 四类典型慢查询与改写（首次教学）

### 8.1 函数包裹列 → 表达式索引

```sql
-- 慢：对索引列 lower() 后，等于绕过了索引
SELECT * FROM users WHERE lower(email) = 'alice@example.com';
-- 计划会出现 Seq Scan + Filter: (lower(email) = ...)
```

> 解法：建表达式索引（`06-01` §9.1）：`CREATE INDEX idx_users_email_lower ON users (lower(email));` 后走 `Index Scan`。

### 8.2 前导通配 LIKE → trigram / 全文

```sql
-- 慢：中缀/前缀模糊无法用 B-tree 定位
SELECT * FROM users WHERE email LIKE '%alice%';
```

> B-tree 只能加速 `LIKE 'abc%'`（左前缀）。`%abc%` 无起止点，回退全表。解法：`pg_trgm` 三元组 GIN 索引（`CREATE EXTENSION pg_trgm` + `USING gin(email gin_trgm_ops)`），或阶段 9 全文检索。这里先记住「**中缀模糊是 B-tree 的死穴**」。

### 8.3 跨列 OR → UNION ALL

```sql
-- 慢：WHERE a=1 OR b=2 两个独立列，各自有索引，但 OR 让优化器难以一次用两个索引
SELECT * FROM orders WHERE user_id = 1 OR amount > 500;
```

```sql
-- 改写：拆成两个各走各索引的查询再合并
SELECT * FROM orders WHERE user_id = 1
UNION ALL
SELECT * FROM orders WHERE amount > 500;
```

> 两条子查询各走自己的索引，`UNION ALL` 合并，常比单个 `OR` 快。若担心重复，用 `UNION`（去重，代价更高），多数场景数据本不重叠用 `UNION ALL`。

### 8.4 深分页 OFFSET → keyset 分页

```sql
-- 慢：OFFSET 越大，越往后仍要数过前面所有行再丢弃
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 100000;
```

```sql
-- 改写：记住上一页最后一条 id，从它之后继续（keyset / 游标分页）
SELECT * FROM orders WHERE id > :last_id ORDER BY id LIMIT 20;
```

> `OFFSET` 的代价随页码线性增长（数过前 N 行再丢）。keyset 用「上一页最后的主键」做锚点，无论翻到哪一页都只扫 `LIMIT` 行，**恒定代价**。前提是分页列有索引且可比较（`id` 天然满足）。

### 8.5 隐式类型转换（JOIN 两侧类型不一致）

```sql
-- 危险：a.id 是 integer，b.id 是 bigint，等值连接会插入隐式 Cast，可能使索引失效
SELECT * FROM t_int a JOIN t_big b ON a.id = b.id;
```

> 计划里出现对索引列的 `(id)::double precision` 或 Cast 节点，会导致索引失效。**防治：建表时就统一关联列的类型**（都 `integer` 或都 `bigint`），不靠运行期转换。

---

## 9. 项目实战：apps 表的 ownerId 查询

项目 `apps` 表有 `@@index([ownerId])`（见 `06-01` §12）。查某用户的应用时，走索引：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, updated_at FROM apps WHERE owner_id = '某用户uuid';
```

预期关键行：

```
 Index Scan using apps_owner_id_idx on apps  (cost=... rows=... width=...)
   Index Cond: (owner_id = '某用户uuid')
   Buffers: shared hit=4
```

> 解读：`Index Cond` 出现 → 外键索引 `apps_owner_id_idx` 命中；`Buffers: shared hit` 说明数据已在缓存。若这里变成 `Seq Scan` + `Filter`，就是索引缺失或统计失真的信号，按本篇排查。这就是**用 EXPLAIN 验证「索引确实被用上」**的日常动作。

---

## 10. 验收自测

### 10.1 复现「Seq Scan → Index Scan」的优化闭环

```sql
-- ① 先确认没索引时全表扫
EXPLAIN SELECT * FROM orders WHERE user_id = 1;
-- 预期：Seq Scan on orders + Filter: (user_id = 1)

-- ② 建索引
CREATE INDEX idx_orders_user ON orders (user_id);

-- ③ 再看计划，应变成 Index Scan
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 1;
-- 预期：Index Scan using idx_orders_user + Index Cond: (user_id = 1)
```

### 10.2 读出一张计划的五个关键信息

对上面第 ③ 步输出，指出：成本是 `cost=...`、估算行 `rows`、实际行 `actual rows`、缓冲 `Buffers shared hit/read`、以及是否回表（`Index Scan` 会回表）。

### 10.3 查统计信息并解释字段

```sql
SELECT attname, n_distinct, most_common_vals, histogram_bounds
FROM pg_stats WHERE tablename = 'orders' AND attname = 'amount';
```

### 10.4 改写深分页

把 `SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 100000;` 改写为 keyset 分页，并说明其代价为何恒定。

---

## 11. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 建了索引仍 `Seq Scan` | 小表全扫更省 / 统计过时 / 条件做了函数 | 看 `cost` 是否真慢；`ANALYZE`；函数用表达式索引 |
| 对写操作 `EXPLAIN ANALYZE` 结果真的改了数据 | `ANALYZE` 真执行 | 包事务 + `ROLLBACK`（§3.1） |
| `rows` 估算与实际差几十倍 | 统计信息过时 | 手动 `ANALYZE` |
| `Index Scan` 里 `Filter` 行数巨大 | 索引选择性不足，命中后大量回表再筛 | 建复合索引 / 覆盖索引（`06-01`） |
| `OFFSET` 大页码越来越慢 | OFFSET 需数过前面所有行 | keyset 分页（§8.4） |
| `OR` 连接的跨列条件不走索引 | 单条 `OR` 难用两个独立索引 | 拆 `UNION ALL`（§8.3） |

---

## 12. 本篇小结

- `EXPLAIN` 三种形态：**纯看计划**（不执行）/ **`ANALYZE` 真执行**（看实际耗时行数）/ **`+BUFFERS` 看内存与磁盘读**；写操作要发包事务 + `ROLLBACK`。
- 计划是**缩进树**：内层先行；`cost` 是相对成本，`rows` 是估算、`actual rows` 是真实；两者差大＝统计失真。
- `Index Cond`＝走索引，`Filter`＝取回后再筛；`Rows Removed by Filter` 大＝索引选择性不足。
- 关键节点：`Seq Scan`（全表）/ `Index Scan`（回表）/ `Index Only Scan`（覆盖不回表）/ `Bitmap`（中等命中） / `Nested Loop` / `Hash Join`。
- `pg_stats` 看统计（`n_distinct`/直方图），`ANALYZE` 手动纠正。
- 四类慢查询：函数包裹→表达式索引、`%x%`→trigram/全文、跨列 `OR`→`UNION ALL`、深分页 `OFFSET`→keyset。

至此阶段 6 收官：**会选索引（`06-01`）+ 会用 EXPLAIN 证明优化（`06-02`）**。下一站 **阶段 7 · 体系结构、Schema 与权限**：`07-01 Database/Schema/Role 三层.md`（与 MySQL「库=命名空间」的差异、`search_path`、GRANT/REVOKE、默认权限）。