# 01 · JOIN 全家桶与子查询（进阶）

> 所属：阶段 4 · 查询进阶
> 本篇覆盖：`USING` / `NATURAL JOIN` 简写、**自连接（self join，含自引用外键）**、`LEFT JOIN` 条件放 `ON` 还是 `WHERE` 的陷阱、`NOT IN` vs `NOT EXISTS`（NULL 陷阱）、`FULL JOIN` 对账进阶、**`LATERAL` 横向连接**
> **本篇首次教学：自连接与自引用外键、`USING`/`NATURAL` 简写、`NOT IN` 的 NULL 陷阱（改 `NOT EXISTS`）、`FULL JOIN` 找两边差异、`LATERAL` 横向连接（子查询引用同 FROM 左侧行，如“每人最新一单”）**（基础 JOIN 与子查询见阶段 0 · 06，本篇只引用不重讲）
> 预告：窗口函数、CTE、递归 CTE、`DISTINCT ON` 在阶段 4 · 02；JOIN 性能与索引在阶段 6。

> 本篇沿用阶段 0 · 06 的 `users` / `orders` 数据（alice=1、bob=2、carol=3，carol 无订单），并新增一张自引用的 `employees` 表演示自连接。练习在 `pg_tutorial` 库。

---

## 1. 本篇目标

- 把 06 篇教过的「四类 JOIN + 三类子查询」往上走一层，补齐几个**进阶但高频**的用法。
- 会用 `USING` 简写、会写**自连接**、会避开 `NOT IN` 与 `LEFT JOIN` 条件位置的两个经典坑。
- 掌握 PG 特色 **`LATERAL`**：让子查询引用同一 `FROM` 里左侧的行，解决「每人取最新 N 条」这类问题。

**验收标准**：

1. 用自连接查出「每个员工 + 其经理」。
2. 用 `LATERAL` 查出「每个用户的最新一单金额」。
3. 写一条 `NOT IN` 且子查询含 `NULL` 的查询，观察到结果为空，再改成 `NOT EXISTS` 恢复正确。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成阶段 0 · 06（会 `INNER/LEFT/RIGHT/FULL JOIN`、外键、标量/`IN`/`EXISTS` 子查询） |
| 环境 | 已连上 `pg_tutorial` |
| 数据 | 已有 `users`、`orders` 表；本篇会再建 `employees` |

---

## 3. 本篇不重讲什么

阶段 0 · 06 已经完整教过、本篇直接引用的：

- `INNER` / `LEFT` / `RIGHT` / `FULL JOIN` 的四类语义
- `FOREIGN KEY ... REFERENCES` 与 `ON DELETE` 行为
- 三类子查询（标量 / `IN` / `EXISTS`）与 `EXISTS` vs `IN` 的基本取舍
- `COALESCE` 空值兜底

本篇只讲**它们之上的进阶点**，遇到基础语法不再展开。

---

## 4. 简写：`USING` 与 `NATURAL JOIN`

### 4.1 `USING`：连接列同名时的更短写法

两表连接列**同名**（这里是 `users.id` 与 `orders.user_id` 不同名，不适用；用一个同名例子）：

```sql
-- 假设两表都叫 user_id，可用 USING 替代 ON
SELECT username, amount
FROM users
JOIN orders USING (user_id);   -- 等价于 ON orders.user_id = users.id
```

好处：`USING` 会**自动合并**这两列为一列（`SELECT *` 时同名列只出现一次），连 `ON a.x = b.x` 的重复列都省了。

### 4.2 `NATURAL JOIN`：连列名都省（不推荐）

```sql
SELECT * FROM a NATURAL JOIN b;
```

`NATURAL JOIN` 按**所有同名列**自动连接——**太隐式，容易连接到你没想到的列上**，生产代码基本不用。**能用 `ON` 就用 `ON`，最多用 `USING` 简写，别碰 `NATURAL`。**

---

## 5. 自连接 SELF JOIN（首次教学）

### 5.1 什么是自连接

自连接就是**一张表和它自己 JOIN**。靠**别名**把同一张表拆成「两份视角」。

最典型场景是**树状/层级关系**：员工有自己的经理，经理也是员工；分类有自己的父分类，父分类也是分类。

### 5.2 建一张自引用的 employees 表

```sql
CREATE TABLE employees (
    id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text    NOT NULL,
    manager_id  integer REFERENCES employees(id)   -- 自引用外键：指向同一张表的 id
);

INSERT INTO employees (name, manager_id) VALUES
    ('boss',   NULL),     -- 顶层，没有经理
    ('alice',  1),        -- alice 的经理是 id=1（boss）
    ('bob',    1),
    ('carol',  2);        -- carol 的经理是 alice（id=2）
```

- `manager_id REFERENCES employees(id)` 是**自引用外键**：外键指向自己所在表，表达「经理也是一名员工」。
- `boss` 的 `manager_id` 为 `NULL`，表示顶级、没有经理（这是层级结构里「树根」的惯用表示）。

### 5.3 自连接查「员工 + 经理」

```sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id
ORDER BY e.id;
```

**预期输出**：

```
 employee | manager
----------+---------
 boss     |         ← boss 无经理，LEFT JOIN 补 NULL
 alice    | boss
 bob      | boss
 carol    | alice
```

> 关键：**同一张 `employees` 出现了两次，靠别名 `e`（员工视角）和 `m`（经理视角）区分**。`ON e.manager_id = m.id` 把「员工的经理」连到「经理那一行」。用 `LEFT JOIN` 而非 `INNER JOIN`，是为了让 `boss` 这样没有经理的顶层员工也出现。

---

## 6. `LEFT JOIN` 的条件放 `ON` 还是 `WHERE`（陷阱）

同样是「带上条件」，放对位置很重要。对比：

```sql
-- 写法 A：条件放 ON —— 先按条件连接，再保左表全行
SELECT u.username, o.amount
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.amount > 50;

-- 写法 B：条件放 WHERE —— 先 LEFT JOIN，再用 WHERE 兜一刀
SELECT u.username, o.amount
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.amount > 50;
```

**关键区别**：

| 写法 | 结果 | 原因 |
| --- | --- | --- |
| A（`ON` 里加条件） | **保留全部用户**；没满足 `>50` 订单的用户，`amount` 显示 NULL | `LEFT JOIN` 保左表，条件只影响「右表能不能匹配上」 |
| B（`WHERE` 里加条件） | **只剩有 `>50` 订单的用户**；carol、以及只下过 50 元单的人消失 | `WHERE` 在连接**之后**又过滤一遍，把「右表为 NULL」的行也砍掉了 |

> 口诀：**想把左表行全保留，过滤右表的条件就放 `ON` 里；想对连接结果整体过滤，才放 `WHERE`。** 这是 `LEFT JOIN` 最常踩的坑（06 篇坑表里点到过，这里给出正反对比）。

---

## 7. `NOT IN` vs `NOT EXISTS`：NULL 陷阱（首次教学）

「找出没下过单的用户」，有 `NOT IN` 和 `NOT EXISTS` 两种写法，**结果可能不一样**。

### 7.1 反例：`NOT IN` 遇到 NULL 会"全军覆没"

```sql
-- 若 orders.user_id 里出现了 NULL，这条会返回空！
SELECT username
FROM users
WHERE id NOT IN (SELECT user_id FROM orders);
```

原因：`NOT IN` 实际上是 `x <> v1 AND x <> v2 AND ...`；只要子查询结果里**有一个 `NULL`**，`x <> NULL` 的求值结果是 **`NULL`（未知）**而非「真」，整串 `AND` 被拉成「未知/假」→ **一条都匹配不上，返回空集**。

### 7.2 正解：`NOT EXISTS` 天然安全

```sql
SELECT username
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id
);
```

`NOT EXISTS` 判断的是「**到底有没有这行**」，不逐值比较，所以**对 NULL 免疫**。

### 7.3 小结对照

| 查询意图 | 推荐写法 | 原因 |
| --- | --- | --- |
| 「在某集合里」 | `IN`（子查询无 NULL）或 `EXISTS` | 都行 |
| 「**不在**某集合里」 | **`NOT EXISTS`**（或 `NOT IN` 但必须确认子查询非空无 NULL） | `NOT IN` 遇 NULL 结果错误 |

> 经验：**凡是「否定存在」的判断，统一用 `NOT EXISTS`**，最省心、最不容易翻车。（`IN` 的用法 06 篇已教，此处聚焦它的 NULL 边界。）

---

## 8. `FULL JOIN` 进阶：对账、找两边差异

`FULL JOIN`（PG 独有，MySQL 无）在「**核对两边的异同**」场景特别好用——不只是「保双全」，而是「看出谁只在一侧」。

```sql
-- 例：某次活动的报名表 registered 与打卡表 checked_in，找出「报了没来」和「来了没报」的
-- （示意，需先有这两张表；下面用通用结构说明写法）
SELECT r.user_id AS reg_user, c.user_id AS checkin_user
FROM registered r
FULL JOIN checked_in c ON c.user_id = r.user_id
WHERE r.user_id IS NULL OR c.user_id IS NULL;
```

读法：`FULL JOIN` 后，`WHERE r.user_id IS NULL`（只出现在右表 = 来了没报）、`c.user_id IS NULL`（只出现在左表 = 报了没来）——**用「哪边是 NULL」反推「只存在于哪边」**，这就是找差异的核心。

> 配套的「查差集」写法：`EXCEPT` 也能找两边差异（阶段 4 · 02 会与 CTE 一起讲），`FULL JOIN + IS NULL` 是更直观的一种。

---

## 9. `LATERAL` 横向连接（首次教学，PG 特色）

### 9.1 它解决什么问题

「**给主表的每一行，各取一个/一组相关的行**」这类需求，普通 `LEFT JOIN` 办不到，例如：

> 每个用户，取他的**最新一单**的金额与时间。

普通 `LEFT JOIN` 会把一个用户的所有订单都连出来（一对多），没法「每用户只留一条、且是按时间最新的一条」。

### 9.2 `LATERAL`：让子查询引用"左侧"的表

```sql
SELECT u.username, latest.amount, latest.created_at
FROM users u
LEFT JOIN LATERAL (
    SELECT amount, created_at
    FROM orders o
    WHERE o.user_id = u.id          -- ★ 关键：子查询里引用了左侧的 u.id
    ORDER BY created_at DESC
    LIMIT 1                          -- 每用户只取最新一条
) latest ON true
ORDER BY u.username;
```

**预期输出**（carol 无订单，行仍在、值为 NULL）：

```
 username | amount | created_at
----------+--------+-------------------------
 alice    |  100.00| ...（最新时间）
 bob      |  200.00| ...
 carol    |        |
```

**拆解**：

- `LATERAL` 允许右侧子查询引用**同一个 `FROM` 里、位于它左侧**的表（这里是 `u`）。普通子查询（非 LATERAL）不能引用兄弟表。
- 对 `users` 的**每一行**，右侧子查询都会以该行的 `u.id` 为条件跑一次、取最新一条——所以叫「**横向**」：左边推进一行，右边跟着算一行。
- `ON true` 是因为条件已经写进子查询里了，连接本身不需要条件。
- `LEFT JOIN` 让没有订单的 `carol` 也保留（右侧无行 → 填 NULL）。

### 9.3 `LATERAL` 什么时候用

| 需求 | 写法 |
| --- | --- |
| 每人最新一条 / 最新 N 条 | `LEFT JOIN LATERAL (... ORDER BY ... LIMIT n)` |
| 每人关联一批行（动态 top-N） | 同上，`LIMIT` 可换成任意条件 |
| 用前一行的结果算下一行（复杂场景） | 高级用法，此处不展开 |

> 注意：`LIMIT` 子查询里也常用 `LEFT JOIN LATERAL`；若只想「每条最新一条」，窗口函数 `ROW_NUMBER()`（阶段 4 · 02）也能做，但 `LATERAL` 在「取 Top-N 且要保留主表全行」时更直白。

---

## 10. 与 MySQL 对照

| 能力 | PostgreSQL | MySQL | 说明 |
| --- | --- | --- | --- |
| 自连接 / 自引用外键 | ✅ | ✅（InnoDB 外键） | 语法一致 |
| `USING` 简写 | ✅ | ✅ | 一致 |
| `NATURAL JOIN` | ✅ | ✅ | 一致但都不推荐 |
| `FULL JOIN` | ✅ **原生** | ❌ | 需 `LEFT JOIN UNION RIGHT JOIN` 模拟（06 已提） |
| `LATERAL` | ✅ **长期支持** | 8.0.14+ 才支持（derived table） | PG 更早、生态更成熟 |
| `NOT EXISTS` 安全写法 | ✅ | ✅ | 一致 |
| `NOT IN` + NULL 陷阱 | ✅ 会翻车 | ✅ 同样翻车 | 两库行为一致，都该用 `NOT EXISTS` |

> 阶段 4 相对 MySQL 的**真正差异点**集中在两处：`FULL JOIN`（PG 独有）与 `LATERAL`（PG 更早更稳）。其余自连接、`NOT EXISTS` 等两库一致。

---

## 11. 验收自测

### 11.1 自连接：员工 + 经理

```sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id
ORDER BY e.id;
-- 预期：boss 的 manager 为空；alice/bob 的经理是 boss；carol 的经理是 alice
```

### 11.2 LATERAL：每人最新一单

```sql
SELECT u.username, latest.amount
FROM users u
LEFT JOIN LATERAL (
    SELECT amount FROM orders o
    WHERE o.user_id = u.id
    ORDER BY created_at DESC
    LIMIT 1
) latest ON true
ORDER BY u.username;
-- 预期：alice、bob 各有最新一单；carol 的 amount 为 NULL
```

### 11.3 `NOT IN` 陷阱复现 → 改 `NOT EXISTS`

```sql
-- 先给 orders 塞一行 user_id 为 NULL 的脏数据（仅演示，验完即删）
INSERT INTO orders (user_id, amount) VALUES (NULL, 0.00);

SELECT username FROM users WHERE id NOT IN (SELECT user_id FROM orders);
-- 预期：返回 0 行（NOT IN 遇 NULL 翻车）

SELECT username FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
-- 预期：正常返回 carol（没下过单的人）

DELETE FROM orders WHERE user_id IS NULL;   -- 清理演示数据
```

---

## 12. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `LEFT JOIN` 后「应保留的行」消失 | 过滤右表的条件写进了 `WHERE`，把 NULL 行也砍了 | 把「保左表」的右表过滤条件放 `ON` 里（§6） |
| `NOT IN` 返回空集 | 子查询结果含 `NULL`，`x <> NULL` 拉成「未知」 | 用 `NOT EXISTS`（§7） |
| 自连接忘了别名 | `FROM employees JOIN employees` 报「同名不明确」 | 必须给两份各起别名 `e` / `m`（§5） |
| `LATERAL` 子查询里引不到左侧列 | 忘了写 `LATERAL` 关键字 | 普通子查询不能引用兄弟表，加 `LATERAL`（§9） |
| `NATURAL JOIN` 连出意外结果 | 按所有同名列隐式连接 | 别用 `NATURAL`，用 `ON`/`USING` 显式指定（§4） |
| 连接列不同名却用 `USING` | 列名对不上报错 | `USING` 只适用同名列；不同名用 `ON`（§4.1） |

---

## 13. 小结

- 基础连接与子查询在阶段 0 · 06；本篇补**进阶**：简写、自连接、两个经典坑、`LATERAL`。
- **自连接**：一张表用别名连自己（配自引用外键），解决层级关系。
- **两个陷阱**：① `LEFT JOIN` 的右表过滤条件放 `ON` 不放 `WHERE`；② 否定判断用 `NOT EXISTS` 而非 `NOT IN`。
- **`LATERAL`**：让子查询引用同 `FROM` 左侧的行，专治「每人取最新/前 N 条」。
- **与 MySQL**：`FULL JOIN`（PG 独有）与 `LATERAL`（PG 更成熟）是进阶层的差异点，其余两者一致。

下一篇 `02` 进入**窗口函数、CTE 与递归 CTE、`DISTINCT ON`**——查询进阶的另一半。