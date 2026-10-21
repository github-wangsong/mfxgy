# 02 · 窗口函数、CTE 与 PG 特色

> 所属：阶段 4 · 查询进阶
> 本篇覆盖：窗口函数 `OVER()` / `PARTITION BY` / `ORDER BY`、排名函数 `ROW_NUMBER()`/`RANK()`/`DENSE_RANK()`、聚合窗口（移动聚合 `SUM(...) OVER`）、`LAG`/`LEAD`、CTE（`WITH ... AS`）、递归 CTE（`WITH RECURSIVE`）、`DISTINCT ON`（PG 独有）、物化 CTE（`MATERIALIZED`/`NOT MATERIALIZED`）
> **本篇首次教学：窗口函数（`OVER` + `PARTITION BY` + 窗口内 `ORDER BY`，与 `GROUP BY` 的本质区别）、三类排名函数、聚合窗口/移动聚合、`LAG`/`LEAD`、CTE 与递归 CTE、`DISTINCT ON`、物化 CTE 提示**（后续篇只引用，不再重讲）
> 预告：查询性能与执行计划在阶段 6；递归 CTE 的进阶（图遍历）到阶段 4 之后的实战会再碰到。

> 练习在 `pg_tutorial` 库；沿用 `users` / `orders` 数据，递归部分用 04 篇 01 建的 `employees` 表。

---

## 1. 本篇目标

- 知道**窗口函数**是什么、和 `GROUP BY` 的区别：聚合是「压成一行」，窗口是「**每行都保留，并带上一个按窗口算出的值**」。
- 会用 `ROW_NUMBER` / `RANK` / `DENSE_RANK` 做「组内排名」。
- 会写普通 CTE 和递归 CTE，用 CTE 把复杂查询拆成「一步步可读的小查询」。
- 会用 PG 独有的 `DISTINCT ON` 简洁地取「每组一条」。

**验收标准**：用**窗口函数 + CTE** 写一个「按用户消费总额排名 + 组内 Top-1 订单」的报表查询，且能说清 `ROW_NUMBER` 与 `RANK` 的并列差异。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成阶段 0（聚合 `GROUP BY`、`JOIN`）与阶段 4 · 01 |
| 环境 | 已连上 `pg_tutorial` |
| 数据 | 已有 `users`、`orders`；递归部分用 `employees`（04 篇 01 建） |

---

## 3. 窗口函数是什么（首次教学 `OVER`）

先看一个朴素需求：**「每个用户，各自按订单金额从高到低排个名」**。用 `GROUP BY` 会「压缩行」，得不到「每行一个名次」；窗口函数则**不压缩行**，给每一行都附加一个「相对它所在分组」的值。

### 3.1 语法骨架

```sql
函数(...) OVER (
    PARTITION BY 分组列      -- 按谁分组（可选）
    ORDER BY 排序列           -- 组内按什么排序（可选）
)
```

- `PARTITION BY`：把行分成若干「窗口/组」（**不合并行**，只是划界）。
- `ORDER BY`：窗口**内部**的排序，决定排名/累计的顺序（和查询最外层 `ORDER BY` 是两回事）。
- 省略 `PARTITION BY` = 整个结果集当一个大窗口。

### 3.2 与 GROUP BY 的本质区别

| | `GROUP BY`（聚合） | 窗口函数（`OVER`） |
| --- | --- | --- |
| 输出行数 | 每组**一行**（行被合并） | **每行都在**（不合并） |
| 能否同时带原始列 | 否（非聚合列需进 GROUP BY） | 是（原始列原样保留） |
| 用途 | 汇总（总数/均值…） | 排名、累计、前后对比等「逐行」计算 |

> 一句话：**聚合是「把多行压成一行」，窗口是「每行都留、旁边多算一列」。**

---

## 4. 排名函数：`ROW_NUMBER` / `RANK` / `DENSE_RANK`

用一个自包含的小数据看三者的并列差异（alice 有两个并列的 100）：

```sql
WITH t(name, amount) AS (
    VALUES ('alice', 100), ('alice', 100), ('alice', 50), ('bob', 200), ('carol', 300)
)
SELECT name, amount,
       ROW_NUMBER() OVER (PARTITION BY name ORDER BY amount DESC) AS rn,
       RANK()       OVER (PARTITION BY name ORDER BY amount DESC) AS rnk,
       DENSE_RANK() OVER (PARTITION BY name ORDER BY amount DESC) AS drnk
FROM t
ORDER BY name, amount DESC;
```

**预期输出**：

```
 name  | amount | rn | rnk | drnk
-------+--------+----+-----+------
 alice |    100 |  1 |   1 |    1   ← 并列第一（ROW_NUMBER 硬性 1、2；RANK 1、1；DENSE_RANK 1、1）
 alice |    100 |  2 |   1 |    1
 alice |     50 |  3 |   3 |    2   ← RANK 跳号到 3；DENSE_RANK 不跳号到 2
 bob   |    200 |  1 |   1 |    1
 carol |    300 |  1 |   1 |    1
```

三者差别（针对**并列值**）：

| 函数 | 并列时 | 是否跳号 | 用在哪 |
| --- | --- | --- | --- |
| `ROW_NUMBER()` | 强行给唯一序号 1,2,3… | 不涉及并列问题 | 「每组取恰好 Top-N 条」——并列也硬切 |
| `RANK()` | 相同值同号 | **跳号**（1,1,3） | 竞赛名次（并列后下一个名次留空） |
| `DENSE_RANK()` | 相同值同号 | **不跳号**（1,1,2） | 分级（并列不占后续位次） |

> 口诀：`ROW_NUMBER` 唯一编号、`RANK` 并列跳号、`DENSE_RANK` 并列不跳号。

---

## 5. 聚合窗口：移动聚合（`SUM(...) OVER`）

聚合函数也能放进 `OVER`，得到「**截至当前行的累计**」而非单行汇总：

```sql
SELECT user_id, amount, created_at,
       SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at) AS running_total
FROM orders
ORDER BY user_id, created_at;
```

**预期**：每个用户，`running_total` 随时间**逐行累加**，等于「到这条订单为止该用户的累计消费」。

> 这是「**移动聚合**」：`PARTITION BY user_id` 按用户划窗口，`ORDER BY created_at` 让窗口内按时间排序，`SUM` 于是从组内第一行一路累加到当前行。
> 同类还有 `COUNT(...) OVER`、`AVG(...) OVER` 等——**聚合函数 + `OVER` = 窗口化聚合**。

---

## 6. `LAG` / `LEAD`：取前一行 / 后一行

```sql
SELECT user_id, amount,
       LAG(amount)  OVER (PARTITION BY user_id ORDER BY created_at) AS prev_amount,
       LEAD(amount) OVER (PARTITION BY user_id ORDER BY created_at) AS next_amount
FROM orders
ORDER BY user_id, created_at;
```

- `LAG(列)`：当前行的**上一行**的值（组内第一条是 `NULL`）。
- `LEAD(列)`：当前行的**下一行**的值。
- 常用在「环比」「相邻行对比」。

---

## 7. CTE：`WITH ... AS`

CTE（Common Table Expression，公用表表达式）把一个子查询**取名字**，让复杂查询能**从上往下、分步阅读**。

```sql
WITH big_orders AS (
    SELECT user_id, amount FROM orders WHERE amount > 100
)
SELECT u.username, b.amount
FROM users u
JOIN big_orders b ON b.user_id = u.id;
```

- `WITH 名字 AS (子查询)` 定义临时结果集，作用域是**紧跟其后的一条语句**。
- 好处：**可读性**（先起名、再引用）、**可复用**（同一 CTE 可被多次引用）、可链式（一个 CTE 引用前一个）。
- CTE 只是「语法糖」，多数等价于内联子查询，但它把「先算什么、再算什么」写清楚了。

---

## 8. 递归 CTE：`WITH RECURSIVE`

普通 CTE 只能一次性展开一层；**递归 CTE** 能自己调用自己，直到不再产生新行——最典型的场景是**树/层级遍历**（组织架构、分类树、图路径）。

### 8.1 最简：生成数字序列

```sql
WITH RECURSIVE nums(n) AS (
    SELECT 1                                   -- ① 起点（anchor）
    UNION ALL
    SELECT n + 1 FROM nums WHERE n < 5         -- ② 递归步：引用 nums 自己
)
SELECT n FROM nums;
```

**预期输出**：`1 2 3 4 5`。

### 8.2 实战：从 boss 往下展开整棵组织树

`employees(id, name, manager_id)`（04 篇 01 建）是自引用层级，用它遍历：

```sql
WITH RECURSIVE org AS (
    -- ① 起点：树根（没有经理的人）
    SELECT id, name, manager_id, 1 AS level
    FROM employees
    WHERE manager_id IS NULL
    UNION ALL
    -- ② 递归步：把「已找到的人」的子节点接进来
    SELECT e.id, e.name, e.manager_id, org.level + 1
    FROM employees e
    JOIN org ON e.manager_id = org.id
)
SELECT id, name, level FROM org
ORDER BY level, id;
```

**预期输出**：boss(level 1) → alice/bob(level 2) → carol(level 3)。

**递归 CTE 的固定结构**：

| 部分 | 作用 |
| --- | --- |
| `① SELECT ...（起点）` | **anchor**：先跑出第一组行 |
| `UNION ALL` | 把起点和后续结果**纵向拼接**（递归必须 `UNION ALL`，不能用去重的 `UNION`） |
| `② SELECT ... FROM 自身 JOIN ...` | **递归步**：引用 CTE 自己，产出下一批行 |

递归直到某次递归步**不再产生新行**自动停止。

---

## 9. `DISTINCT ON`：每组取一条（PG 独有）

需求「**每个用户取最新一条订单**」，PG 有专属简洁写法 `DISTINCT ON`：

```sql
SELECT DISTINCT ON (user_id) user_id, amount, created_at
FROM orders
ORDER BY user_id, created_at DESC;
```

**预期**：每个 `user_id` 只出一行，且是该用户 `created_at` 最新的一条。

**规则（必须记住）**：

1. `ORDER BY` 的**最左几列必须以 `DISTINCT ON (...)` 里的列为开头**。
2. 每个「`DISTINCT ON` 分组」内，取按 `ORDER BY` 排序后的**第一行**。

> 对比：`DISTINCT ON` 和阶段 4 · 01 的 `LATERAL`（每人最新一单）**结果一样**，但 `DISTINCT ON` 更短、更直白——它是 PG 的语法糖，MySQL **没有**。

---

## 10. 物化 CTE：`MATERIALIZED` / `NOT MATERIALIZED`

PG 12+ 对 CTE 的「执行成一张临时表（物化）」或「内联展开」可以**手动提示**：

```sql
WITH c AS MATERIALIZED (      -- 强制把 CTE 结果物化成临时表
    SELECT user_id, SUM(amount) AS total FROM orders GROUP BY user_id
)
SELECT * FROM c WHERE total > 150;
```

- `MATERIALIZED`：先把 CTE 结果**落成临时表**再查（适合 CTE 被多次引用、或结果小但计算贵）。
- `NOT MATERIALIZED`：**内联展开**进主查询（让优化器整体重排，有时更快）。
- 默认（不写）由优化器**自动决定**。

> 这是**性能提示**，不是「必须会」的日常语法。知道「有这个开关、默认自动」即可，调优实战在阶段 6。

---

## 11. 与 MySQL 对照

| 能力 | PostgreSQL | MySQL | 说明 |
| --- | --- | --- | --- |
| 窗口函数 `OVER` / `ROW_NUMBER` / `RANK` / `DENSE_RANK` | ✅ 长期支持 | 8.0+ 支持 | 语法基本一致 |
| 聚合窗口 / `LAG` / `LEAD` | ✅ | 8.0+ | 一致 |
| CTE（`WITH ... AS`） | ✅ | 8.0+ | 一致 |
| 递归 CTE（`WITH RECURSIVE`） | ✅ 稳定 | 8.0+ 支持（深度/能力有限制） | PG 生态更成熟 |
| `DISTINCT ON` | ✅ **PG 独有** | ❌ 无 | 需用 `ROW_NUMBER()` 窗口函数模拟 |
| 物化 CTE 提示 `MATERIALIZED` | ✅ PG 12+ | ❌ 无此开关 | MySQL 用别的优化策略 |

> 阶段 4 · 02 相对 MySQL 的**真正差异点**：`DISTINCT ON`（PG 独有）和物化 CTE 提示（PG 独有）。窗口函数与 CTE 本身，MySQL 8.0+ 已补齐，语法高度一致。

---

## 12. 验收自测

### 12.1 能解释窗口函数与 GROUP BY 的区别

口头说清：`GROUP BY` 每组合并成一行；`OVER` 每行都保留、附带一个按窗口算的值。

### 12.2 按用户消费总额排名

```sql
SELECT u.username,
       SUM(o.amount) AS total,
       RANK() OVER (ORDER BY SUM(o.amount) DESC) AS rnk
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.username
ORDER BY total DESC;
-- 预期：消费最高的 rnk=1，依次递减
```

### 12.3 报告查询：CTE + 窗口函数「按用户排名 + 组内 Top-1」

```sql
WITH user_total AS (
    SELECT user_id, SUM(amount) AS total
    FROM orders
    GROUP BY user_id
),
ranked AS (
    SELECT user_id, total,
           RANK() OVER (ORDER BY total DESC) AS rnk
    FROM user_total
),
top_order AS (
    SELECT user_id, amount,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC) AS rn
    FROM orders
)
SELECT r.user_id, r.total, r.rnk, t.amount AS top_amount
FROM ranked r
JOIN top_order t ON t.user_id = r.user_id AND t.rn = 1
ORDER BY r.rnk;
-- 预期：每个用户一行，带总消费、名次、其最大一单金额
```

### 12.4 `DISTINCT ON` 每组一条

```sql
SELECT DISTINCT ON (user_id) user_id, amount, created_at
FROM orders
ORDER BY user_id, created_at DESC;
-- 预期：每 user_id 一行，取最新一条
```

---

## 13. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 窗口函数里 `ORDER BY` 和查询最外层 `ORDER BY` 混为一谈 | 两处排序作用不同 | 窗口内 `ORDER BY` 只决定排名/累计顺序；最终展示顺序由最外层 `ORDER BY` 定 |
| `RANK` 与 `DENSE_RANK` 结果搞混 | 并列时跳号与否 | 并列要「空缺名次」用 `RANK`；要「连续名次」用 `DENSE_RANK`（§4） |
| 递归 CTE 用了 `UNION`（去重） | 递归 CTE 语法要求 `UNION ALL` | 递归步用 `UNION ALL`（§8） |
| 递归 CTE 无限循环 | 没有停止条件 / 环 | 递归步必须有 `WHERE` 条件或 JOIN 收口；图出现环需额外去重 |
| `DISTINCT ON` 报错或结果不对 | `ORDER BY` 最左列没以 `DISTINCT ON` 的列为开头 | 让 `ORDER BY` 以 `DISTINCT ON` 列开头（§9） |
| 想「每组 Top-N」却用 `GROUP BY` | 聚合把行压没了，取不到组内明细 | 用 `ROW_NUMBER()` 窗口 + `WHERE rn <= N`（§12.3） |
| 窗口函数和聚合同一条 SQL 里顺序搞错 | 窗口函数在 `GROUP BY` 之后求值 | 先 `GROUP BY` 出分组结果，再对结果套 `OVER`（§12.2） |
| 物化 CTE 提示滥用 | 以为 `MATERIALIZED` 一定更快 | 默认让优化器自动决定即可（§10） |

---

## 14. 小结

- **窗口函数**（`OVER`）：不合并行，给每行附加「按窗口算的值」；与合并行的 `GROUP BY` 相对。
- **排名**：`ROW_NUMBER`（唯一编号）/ `RANK`（并列跳号）/ `DENSE_RANK`（并列不跳号）。
- **聚合窗口**：`SUM/COUNT/AVG(...) OVER` 做移动聚合；`LAG`/`LEAD` 取前后行。
- **CTE**（`WITH ... AS`）：把复杂查询拆成可读的步骤。
- **递归 CTE**（`WITH RECURSIVE`）：anchor + `UNION ALL` + 递归步，遍历树/层级。
- **PG 特色**：`DISTINCT ON`（每组取一条，MySQL 无）、物化 CTE 提示 `MATERIALIZED`（MySQL 无）。

到此，**阶段 4（查询进阶）两篇收尾**。下一站是**阶段 5 · 事务、MVCC 与并发**（事务性 DDL 已在阶段 0 · 07 教过，故本篇只写「MVCC、锁与 VACUUM」一篇），或你指定下一章。