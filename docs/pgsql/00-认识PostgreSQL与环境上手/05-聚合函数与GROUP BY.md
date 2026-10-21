# 05 · 聚合函数与 GROUP BY

> 所属：阶段 0 · 认识 PostgreSQL 与环境上手
> 本篇覆盖：聚合函数（`COUNT`/`SUM`/`AVG`/`MIN`/`MAX`）、`GROUP BY` 分组、`HAVING` 分组后过滤、`DISTINCT` 去重，以及**PG 与 MySQL 在 `GROUP BY` 严格性上的关键差异**
> **本篇首次教学：五个聚合函数、`GROUP BY`（含执行顺序与「SELECT 非聚合列必须出现在 GROUP BY」的严格规则）、`HAVING`（对照 `WHERE`）、`DISTINCT`**（后续篇只引用，不再重讲）
> 预告：`JOIN` 多表连接在阶段 4；PG 独有的 `DISTINCT ON` 也放在阶段 4（本篇只讲普通 `DISTINCT`）；窗口函数 `OVER` 在阶段 4 的下一篇。

> 下文所有「完整文件路径」均**相对仓库根**（本系列位于 `docs/pgsql/` 下）。
> psql / `users` 表结构 / CRUD 见 `02`–`04` 篇；本篇全部 SQL 都在 `pg_tutorial` 库对 `users` 表操作。

---

## 1. 本篇目标

- 会用 `COUNT`/`SUM`/`AVG`/`MIN`/`MAX` 对数据做统计。
- 理解 `GROUP BY` 的「先分组、再聚合」，以及**执行顺序**里它和 `WHERE`/`HAVING` 的位置。
- 分清 `WHERE`（过滤行）与 `HAVING`（过滤分组）——这是新手最容易混的一对。
- 牢记 PG 的 `GROUP BY` 是**严格模式**，与 MySQL 的宽松行为不同。

**验收标准**：

1. 能统计出 users 的总行数、平均年龄、最大/最小余额。
2. 能按 `status` 分组统计每个状态的人数，并用 `HAVING` 过滤出「人数 ≥ 2」的分组。
3. 能解释为什么 MySQL 里「SELECT 没分组的列」能跑、PG 里会报错。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成 `04-增删改查.md`，掌握 SELECT/WHERE/ORDER BY |
| 环境 | 已连上 `pg_tutorial` 库（`\c pg_tutorial`） |
| 知识 | `users` 表结构（`03` 篇） |

---

## 3. 先准备一份「可统计」的数据

聚合函数需要**多行**才有意义，且要有数值列可平均、有状态列可分组。先清空重灌一批：

```sql
TRUNCATE users RESTART IDENTITY;

INSERT INTO users (username, email, age, balance, status) VALUES
    ('alice', 'alice@example.com', 28, 100.00, 'active'),
    ('bob',   'bob@example.com',   35, 250.50, 'active'),
    ('carol', 'carol@example.com', 22,  50.00, 'active'),
    ('dave',  'dave@example.com',  40, 999.00, 'disabled'),
    ('eve',   'eve@example.com',   NULL, 0.00,  'deleted');
```

> 注意 `eve` 的 `age` 是 `NULL`（故意留空），用来演示聚合函数**对 NULL 的处理**，见第 4 节。
> `balance` 列是 `numeric`，`age` 是 `integer` 可为空。

---

## 4. 五个聚合函数（首次教学）

聚合函数把**多行压缩成一行**（一个汇总值）。

| 函数 | 作用 | returns |
| --- | --- | --- |
| `COUNT(*)` | 数**行数**（含 NULL 行） | `bigint` |
| `COUNT(列)` | 数某列**非 NULL** 值的个数 | `bigint` |
| `SUM(列)` | 求和（忽略 NULL） | 与列类型同 |
| `AVG(列)` | 求平均（忽略 NULL） | `numeric` |
| `MIN(列)` / `MAX(列)` | 最小 / 最大（忽略 NULL） | 与列类型同 |

### 4.1 基础示例

```sql
SELECT COUNT(*) FROM users;              -- 5（总行数）
SELECT COUNT(age) FROM users;            -- 4（eve 的 age 是 NULL，不计）
SELECT SUM(balance) FROM users;          -- 1399.50
SELECT AVG(age) FROM users;              -- 平均只算 4 个非空 age
SELECT MIN(balance), MAX(balance) FROM users;  -- 0.00 和 999.00
```

### 4.2 关键差异：`COUNT(*)` vs `COUNT(列)`

| 写法 | 数的是什么 | 上例结果 |
| --- | --- | --- |
| `COUNT(*)` | 所有行，**不管有没有 NULL** | 5 |
| `COUNT(age)` | `age` **非 NULL** 的行 | 4 |

> 记忆：`COUNT(*)` 是「数行」，`COUNT(列)` 是「数非空值」。同理 `SUM`/`AVG`/`MIN`/`MAX` 都会**跳过 NULL**。

### 4.3 COUNT(DISTINCT 列)：数「去重后的」非空值

```sql
SELECT COUNT(DISTINCT status) FROM users;   -- 3（active/disabled/deleted 三种）
```

> `COUNT(DISTINCT status)` = 先对 `status` 去重、再数。与第 7 节的 `DISTINCT` 去重是同一套「去重」概念。

---

## 5. GROUP BY：分组聚合（首次教学）

### 5.1 为什么要分组

上面第 4 节是「**全表**汇总成一行」。但往往我们想知道「**每个状态各有多少人**」——这时就要「先按某列分组、再对每组聚合」。

```sql
SELECT status, COUNT(*)
FROM users
GROUP BY status;
```

**预期输出**：

```
  status  | count
----------+-------
 active   |     3
 disabled |     1
 deleted  |     1
```

### 5.2 执行顺序（关键心智模型）

`SELECT ... FROM ... WHERE ... GROUP BY ... HAVING ... ORDER BY ... LIMIT` 的逻辑执行顺序是：

```
FROM  →  WHERE  →  GROUP BY  →  HAVING  →  SELECT  →  ORDER BY  →  LIMIT
找表 →  过滤行  →   分组     →  过滤分组 →   挑列    →   排序    →   截取
```

> 记住三个位置关系：
> - `WHERE` 在**分组前**（过滤掉不参与统计的行）
> - `HAVING` 在**分组后**（过滤掉不想要的分组）
> - `ORDER BY` 在最后的**结果**上排序

### 5.3 PG 的「严格 GROUP BY」规则（与 MySQL 的核心差异）

PG 有一条硬规则：

> **`SELECT` 里出现的非聚合列，必须出现在 `GROUP BY` 里。**

```sql
-- ❌ PG 会报错：username 既没聚合、又不在 GROUP BY
SELECT username, status, COUNT(*)
FROM users
GROUP BY status;

-- ✅ 正确：username 加进 GROUP BY（或去掉它）
SELECT status, COUNT(*)
FROM users
GROUP BY status;
```

**报错信息**（PG，这是「严格模式」的典型签名）：

```
ERROR:  column "users.username" must appear in the GROUP BY clause or be used in an aggregate function
```

#### 与 MySQL 对照

| 行为 | PostgreSQL | MySQL |
| --- | --- | --- |
| SELECT 里「没分组又没聚合」的列 | **直接报错** | 默认（`ONLY_FULL_GROUP_BY` 关闭时）**允许**，返回组内「任意一行」的值 |
| 结果确定性 | 严格、可预测 | 关闭严格模式时**不确定**（可能这次取 A 行、下次取 B 行） |

> 一句话：**MySQL 的「宽松 GROUP BY」历史上是很多隐藏 bug 的来源**（SQL 标准其实要求严格行为）；PG 从一开始就严格，更符合标准、更安全。MySQL 8.0 也默认开启了 `ONLY_FULL_GROUP_BY`，只是老库常关着，所以老 MySQL 用户会「习惯宽松」。
> 这也是 INDEX 第三节速查表「GROUP BY 严格性」那一条的展开。

### 5.4 多列分组

```sql
SELECT status, is_active, COUNT(*)
FROM users
GROUP BY status, is_active
ORDER BY status;
```

> 按「state + is_active」两个维度分组，每个唯一组合一行。

---

## 6. HAVING：分组后的过滤（首次教学）

### 6.1 为什么不能用 WHERE 筛聚合结果

想筛选「人数 ≥ 2 的状态」，`WHERE COUNT(*) >= 2` 是**错的**——因为 `WHERE` 在分组**之前**执行，那时还没有 `COUNT(*)`。

```sql
-- ❌ 报错：aggregate functions are not allowed in WHERE
-- SELECT status, COUNT(*) FROM users WHERE COUNT(*) >= 2 GROUP BY status;
```

正确做法是用 `HAVING`：

```sql
SELECT status, COUNT(*)
FROM users
GROUP BY status
HAVING COUNT(*) >= 2;
```

**预期输出**：

```
 status | count
--------+-------
 active |     3
```

### 6.2 WHERE vs HAVING 对照

| 维度 | WHERE | HAVING |
| --- | --- | --- |
| 作用对象 | **行** | **分组**（GROUP BY 之后） |
| 能否用聚合函数 | ❌ 不能 | ✅ 能（`COUNT(*)` 等） |
| 执行时机 | 分组前 | 分组后 |
| 可否单独使用 | 可（不带 GROUP BY） | 一般配合 GROUP BY |

> 记忆：**行过滤用 WHERE，分组过滤用 HAVING**。两者可同时出现：`WHERE` 先筛掉不要的行，`HAVING` 再筛掉不要的组。

---

## 7. DISTINCT：去重（首次教学）

`DISTINCT` 放在 `SELECT` 后，对「选出的一整行」去重。

```sql
SELECT DISTINCT status FROM users;   -- active / disabled / deleted（3 行，去掉重复的 active）
```

> 注意区分：
> - `SELECT DISTINCT 列` → 去重后返回**该列**的唯一值。
> - `COUNT(DISTINCT 列)` → 数**唯一值个数**（第 4.3 节）。
> - `DISTINCT ON (...)` → PG 独有的「每组保留第一条」，**更强大也更绕**，阶段 4 再教，本篇不用。

---

## 8. 与 MySQL 对照速查

| 能力 | MySQL | PostgreSQL | 差异 |
| --- | --- | --- | --- |
| 五个聚合函数 | `COUNT/SUM/AVG/MIN/MAX` | 同名 | 语法一致 |
| `GROUP BY` 严格性 | 默认（老库）宽松，8.0 起默认严格 | **严格** | 核心差异，见 5.3 |
| `HAVING` | 支持 | 支持 | 一致 |
| `DISTINCT` | 支持 | 支持 | 一致 |
| `DISTINCT ON` | ❌ 无 | ✅ 独有 | 阶段 4 展开 |
| 分组后排序 | `GROUP BY ... ORDER BY` | 同 | 一致 |

---

## 9. 验收自测

### 9.1 基本统计

```sql
SELECT COUNT(*), COUNT(age), AVG(age), MIN(balance), MAX(balance) FROM users;
-- 预期：5 | 4 | (28+35+22+40)/4 | 0.00 | 999.00
```

### 9.2 分组 + HAVING

```sql
SELECT status, COUNT(*) AS cnt
FROM users
GROUP BY status
HAVING COUNT(*) >= 2
ORDER BY cnt DESC;
-- 预期：active | 3
```

### 9.3 验证「严格 GROUP BY」会报错

```sql
SELECT username, status, COUNT(*)
FROM users
GROUP BY status;
-- 预期：报错 column "users.username" must appear in the GROUP BY clause ...
```

> 能看懂这条报错、并知道「加进 GROUP BY 或去掉 username」两种改法，即通过。

---

## 10. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `WHERE COUNT(*) >= 2` 报错 | 聚合函数不能出现在 `WHERE`（那时还没分组） | 改用 `HAVING` |
| `SELECT username, STATUS, COUNT(*) ... GROUP BY status` 报错 | PG 严格：非聚合列必须进 GROUP BY | 去掉 `username` 或加进 `GROUP BY` |
| `COUNT(age)` 比 `COUNT(*)` 小 | `age` 有 NULL，`COUNT(列)` 跳过 NULL | 用 `COUNT(*)` 数行、`COUNT(列)` 数非空，按需选 |
| `AVG(age)` 结果「偏小」 | NULL 被自动忽略，分母是「非空行数」不是总行数 | 明确语义后接受，或先 `COALESCE`（后续篇） |
| 分组的 `count` 列名叫 `count` 看着别扭 | 未起别名时列名是函数名 `count` | 用 `AS cnt` 起别名（本篇 9.2 已示范） |

---

## 11. 本篇小结

- 五个聚合函数：`COUNT`/`SUM`/`AVG`/`MIN`/`MAX`；除 `COUNT(*)` 外都跳过 NULL。
- 执行顺序：`FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT`。
- `WHERE` 过滤**行**、`HAVING` 过滤**分组**（`HAVING` 才能用聚合函数）。
- PG 的 `GROUP BY` 是**严格模式**：SELECT 非聚合列必须进 GROUP BY；与 MySQL 宽松行为形成关键差异。
- `DISTINCT` 去重；`DISTINCT ON` 是 PG 独有、阶段 4 再教。

下一篇进入**多表连接**：`INNER JOIN` / `LEFT JOIN` / `FULL JOIN` 及子查询，开始把单表技能扩展成关系建模。