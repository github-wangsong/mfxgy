# 02 · MVCC、锁与 VACUUM

> 所属：阶段 5 · 事务、MVCC 与并发
> 本篇覆盖：MVCC 原理（为什么读不阻塞写）、隔离级别与异常现象（脏读/不可重复读/幻读，实测复现）、行锁（`FOR UPDATE`/`FOR SHARE`）与表锁、咨询锁（advisory lock）、死锁复现与日志解读、`idle in transaction` 危害、VACUUM/autovacuum 原理
> **本篇首次教学：MVCC（多版本并发控制，对照 MySQL undo log）、PG 四个隔离级别与异常现象、`SELECT ... FOR UPDATE/FOR SHARE` 行锁、`LOCK TABLE`、咨询锁 `pg_advisory_lock`、死锁复现与日志解读、`pg_stat_activity` 查 `idle in transaction`、VACUUM/autovacuum 与死元组回收**（事务基础 `BEGIN/COMMIT/ROLLBACK`、事务性 DDL 已在阶段 0 · 07 教，本篇只引用）
> 预告：执行计划与索引在阶段 6；监控与参数调优在阶段 10。

> 练习在 `pg_tutorial` 库，用 `orders` 表复现并发现象。死锁/隔离级别需**开两个 psql 会话**（分别记为 会话A / 会话B）。

---

## 1. 本篇目标

- 理解 PG 的 **MVCC**：为什么「读」几乎不阻塞「写」、不依赖重量级锁。
- 分清四个隔离级别与三种异常现象，并能**在两个会话里实测复现**「不可重复读」。
- 会用行锁（`FOR UPDATE`）做「先读后改」的并发安全；知道咨询锁与表锁是干什么的。
- 能**复现一次死锁**、看 PG 日志里的 `deadlock detected` 并读得懂。
- 知道 `idle in transaction` 的危害、VACUUM 是干嘛的、为什么 `updated_at` 触发器是安全的。

**验收标准**：复现一次死锁并完整解读 PG 日志；解释项目 `apps` 表的 `updated_at` 触发器为何安全。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成阶段 0 · 07（事务 ACID、`BEGIN/COMMIT/ROLLBACK`、autocommit、事务性 DDL） |
| 环境 | 能同时开**两个** psql 会话连上 `pg_tutorial` |
| 数据 | 已有 `orders` 表（阶段 0 · 06 建） |

---

## 3. MVCC：为什么读不阻塞写（首次教学）

### 3.1 问题：MySQL 与 PG 的并发策略不同

并发下，「读」和「写」会不会互相阻塞，取决于**旧版本放在哪**：

| 维度 | MySQL（InnoDB） | PostgreSQL |
| --- | --- | --- |
| 旧版本放哪 | **undo log**（回滚段，独立存储） | **多版本元组**（旧行留在表堆里，标记为「死元组」） |
| 读旧版本 | 从 undo log 回放 | 直接读表里的旧版本行 |
| 需要回收 | 不清除，undo 用于回滚/MVCC | **VACUUM 回收死元组**（§9） |

### 3.2 MVCC 的核心好处

**MVCC = Multi-Version Concurrency Control（多版本并发控制）**：每次 `UPDATE`/`DELETE` 不是「原地改」，而是**写一个新版本**，旧版本留着给「还在读它的其他事务」看。

于是：

- **读不阻塞写、写不阻塞读**：一个事务在改 `orders`，另一个事务仍能读到「改动前」的旧版本（不等待）。这是 PG 高并发读写的根基。
- 代价：旧版本会**堆积**，得不到回收就「表膨胀」→ 靠 **VACUUM** 回收（§9）——这正是 PG 相对 MySQL 运维上最需要留意的点。

---

## 4. 隔离级别与异常现象（实测复现）

### 4.1 三种异常现象

| 异常 | 含义 | 谁允许它 |
| --- | --- | --- |
| **脏读**（dirty read） | 读到别的事务**尚未提交**的改动 | PG **永远不允许**（MVCC 保证） |
| **不可重复读**（non-repeatable read） | 同一事务内两次读同一行，**结果变了**（别的事务已提交） | `Read Committed` 允许 |
| **幻读**（phantom read） | 同一事务内两次**范围**查询，结果集的行数变了 | `Read Committed` 允许 |

### 4.2 PG 的隔离级别（注意与 MySQL 的差异）

| 级别 |PG 名称 | 防什么 | 备注 |
| --- | --- | --- | --- |
| 读未提交 | —— | —— | **PG 没有 `Read Uncommitted`**（`SET ... READ UNCOMMITTED` 会按 `Read Committed` 处理） |
| **读已提交** | `READ COMMITTED`（**默认**） | 防脏读 | 允许不可重复读/幻读 |
| **可重复读** | `REPEATABLE READ` | 防脏读 + 不可重复读 | PG 里它实现为**快照隔离**，**连幻读也防**（这点比许多库强） |
| **可串行化** | `SERIALIZABLE` | 全部 + 串行化异常 | 用 SSI 检测「写偏斜」等 |

> 关键记忆点：**PG 的 `REPEATABLE READ` 已经能防幻读**（因为它给整个事务一个**快照**，不是行级锁），这是它与 MySQL 常见认知的差异。

### 4.3 实测：复现「不可重复读」（读已提交）

先在 `orders` 里保证有一行 `id=1`，然后：

```
会话A：
BEGIN;                                     -- 打开事务，用默认 READ COMMITTED
SELECT amount FROM orders WHERE id = 1;    -- 读到 100.00
-- （先别 COMMIT，切到会话B）

会话B：
UPDATE orders SET amount = 999 WHERE id = 1;
COMMIT;                                    -- B 提交了改动

会话A（继续）：
SELECT amount FROM orders WHERE id = 1;    -- 读到 999.00（变了！）
COMMIT;
```

**结论**：会话A 两次读到不同值 → 这就是「**不可重复读**」，是 `READ COMMITTED` 允许的行为。

### 4.4 改 `REPEATABLE READ`：快照稳定

```
会话A：
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT amount FROM orders WHERE id = 1;    -- 读到 999.00（当前值）

会话B：
UPDATE orders SET amount = 555 WHERE id = 1;
COMMIT;

会话A（继续）：
SELECT amount FROM orders WHERE id = 1;    -- 仍读到 999.00（快照没变）
COMMIT;
```

**结论**：`REPEATABLE READ` 下，事务**全程固定在一个快照上**，后提交的改动对它不可见 → 不可重复读被防住。

---

## 5. 行锁：`FOR UPDATE` / `FOR SHARE`

MVCC 让「读」不加重锁，但**「先读一行、再改它」**这种操作需要**显式锁住这一行**，防止别人在你读和改之间也改了它：

```sql
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;   -- 锁住这一行
-- ... 依据读到的值做一些判断 ...
UPDATE orders SET amount = amount + 10 WHERE id = 1;
COMMIT;                                          -- 提交后释放锁
```

- `FOR UPDATE`：**排他行锁**（别人不能同时 `FOR UPDATE` 或修改这行，但普通读不受影响）。
- `FOR SHARE`：**共享行锁**（允许别人也 `FOR SHARE`，但阻止别人 `FOR UPDATE`/修改）。

> 用途：经典「**读-改**」竞态（如余额扣减），先 `FOR UPDATE` 锁住再改，避免「两个事务读到同一个余额、各扣一次」。
> 注意：MVCC 下**普通 `SELECT` 永远不加锁、随便读**；只有 `FOR UPDATE`/`FOR SHARE` 才加行锁。

### 5.1 表级锁（知道即可）

`LOCK TABLE` 可显式锁整表：

```sql
BEGIN;
LOCK TABLE orders IN SHARE MODE;    -- 整表共享锁
-- ...
COMMIT;
```

日常很少显式用；DDL（`ALTER`/`CREATE INDEX`）会**隐式**加更重的表锁（`ACCESS EXCLUSIVE` 等）。重点是理解「锁有行级与表级之分」，行锁并发度远高于表锁。

---

## 6. 咨询锁：advisory lock（PG 特色）

咨询锁是「**锁一个任意数字/字符串**」的锁，与具体行/表无关——用于**应用层自己协调**（如「同一时刻只让一个 worker 做某件事」）：

```sql
-- 会话A：拿到编号 42 的锁
SELECT pg_advisory_lock(42);          -- 阻塞直到拿到
-- ... 临界区 ...
SELECT pg_advisory_unlock(42);        -- 释放

-- 会话B：拿同一把锁会阻塞，直到 A 释放
SELECT pg_advisory_lock(42);
```

- `pg_advisory_lock(key)`：**会话级**（在连接里一直持到 unlock 或断连）。
- `pg_advisory_xact_lock(key)`：**事务级**（`COMMIT`/`ROLLBACK` 自动释放，推荐用它避免忘解锁）。
- 它是**应用约定**，数据库不强制——两段代码说好用同一把锁，就能互斥。

---

## 7. 死锁复现与日志解读

### 7.1 复现：两个事务互相等待

保险起见先准备两行（`id=1`、`id=2` 都存在于 `orders`）。**严格按下面顺序、在两个会话里交替执行**：

```
会话A：BEGIN; UPDATE orders SET amount=1 WHERE id=1;    -- A 锁住行 1
会话B：BEGIN; UPDATE orders SET amount=2 WHERE id=2;    -- B 锁住行 2
会话A：         UPDATE orders SET amount=3 WHERE id=2;  -- A 等 B 松行 2（阻塞）
会话B：         UPDATE orders SET amount=4 WHERE id=1;  -- B 等 A 松行 1 → 死锁！
```

**死锁原因**：A 持行1、等行2；B 持行2、等行1 → **循环等待**，无人能让步。PG 会在极短时间内检测到，并**让其中一个事务回滚**（通常报错的会话B 会收到错误，会话A 成功）：

```
ERROR:  deadlock detected
DETAIL:  Process 123 waited for ShareLock on transaction 456; blocked by process 789.
HINT:  See server log for query details.
```

### 7.2 日志解读

死锁详情会进 PG 服务器日志（关键行）：

```
deadlock detected
DETAIL:  Process 123 waits for ShareLock on transaction 456; blocked by process 789.
         Process 789 waits for ShareLock on transaction 123; blocked by process 123.
```

读法：

| 关键词 | 含义 |
| --- | --- |
| `Process` | 后端进程 PID（对应 `pg_stat_activity` 的 `pid`） |
| `waits for ShareLock on transaction` | 它在等另一个事务上的锁 |
| `blocked by process` | 被哪个进程挡住 |

> 死锁不是 PG 的 bug，是**并发程序常见的逻辑错误**。排查思路：**让所有事务按「一致的顺序」访问资源**（本例若 A、B 都先锁行1、再锁行2，就不会死锁）。

---

## 8. `idle in transaction`：隐形的坑

「**idle in transaction**」= 事务**开着但什么都没干**（没执行任何语句）。它很危险，因为它：

1. **长期持有锁**：事务里取过的行锁/快照都不释放 → 阻塞别人。
2. **阻碍 VACUUM**：它持着一个旧版本“读数”，VACUUM 不能回收到它可能还在看的死元组 → 表膨胀。

**排查**：

```sql
SELECT pid, usename, state, query_start, query
FROM pg_stat_activity
WHERE state = 'idle in transaction';
```

**预防**：应用层不要让「打开事务 → 干别的（网络等待/人肉思考）→ 再提交」；拿到结果尽早 `COMMIT`/`ROLLBACK`。

---

## 9. VACUUM / autovacuum：为什么 PG 要「回收」

### 9.1 死元组从哪来

MVCC 里，`UPDATE`/`DELETE` 是**写新版本、留旧版本**。这些旧版本（**死元组**）对现行事务已不可见，但还占着表空间——这就是「**表膨胀**」的来源。

### 9.2 VACUUM 干什么

| 命令 | 作用 | 代价 |
| --- | --- | --- |
| `VACUUM` | 标记死元组空间为**可复用**，并更新可见性位图（供 index-only scan） | 轻，可与业务并发跑 |
| `VACUUM FULL` | **物理重写整表**、彻底收紧空间 | 重，会加 `ACCESS EXCLUSIVE` 锁（阻塞读写），少用 |

```sql
VACUUM (ANALYZE) orders;   -- 回收死元组 + 更新统计信息
```

### 9.3 autovacuum：自动回收

PG 有后台进程 **autovacuum**，会在「死元组比例达到阈值」时**自动跑 VACUUM**，无需手动。日常基本不用手动 `VACUUM`，但要知道「表膨胀 → autovacuum 在做事」这个关系。

> 关键心法：**PG 用「空间回收」换取「读不阻塞写的 MVCC」**；代价是必须靠 VACUUM 定期回收。这是理解 PG 运维的一条主线。

---

## 10. 项目 `updated_at` 触发器为何安全（实战）

mini-dify 里有一条 `apps_set_updated_at` 触发器（`apps/api-ts/prisma/migrations/20261018120000_...`）：

```sql
CREATE OR REPLACE FUNCTION apps_set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW."updated_at" = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "apps_set_updated_at"
BEFORE UPDATE ON "apps" FOR EACH ROW
EXECUTE FUNCTION apps_set_updated_at();
```

它「为什么安全」——从 MVCC 与锁的角度解释：

| 特性 | 为什么安全 |
| --- | --- |
| 只改**当前这一行**的 `NEW.updated_at` | 锁范围最小化：只涉及正在更新的那一行，不碰别的行/表 |
| **不查任何其他表**、不发外部请求 | 不会引入「锁顺序反转」，不会形成循环等待 → impossible 死锁 |
| 用 `now()` 写一个值 | 纯本地计算，微秒级完成，行锁持有时长极短 |
| `BEFORE ... FOR EACH ROW` | 逐行、更新前执行，逻辑确定，无长事务/等待点 |

> 一句话：**因为它只做「给当前行盖个时间戳」这一件无外部依赖的轻量事**，不跨行、不等锁、不查表——所以它不可能成为死锁的参与者，也不会阻塞别的并发事务。这就是「安全的触发器」该有的样子。

---

## 11. 与 MySQL 对照

| 维度 | MySQL（InnoDB） | PostgreSQL |
| --- | --- | --- |
| MVCC 实现 | undo log（旧版本在回滚段） | 多版本元组（死元组留表内，靠 VACUUM 回收） |
| 默认隔离级别 | `REPEATABLE READ` | `READ COMMITTED` |
| `REPEATABLE READ` 防幻读 | 是（**下一键锁** granch） | 是（**快照隔离**，非锁） |
| 行锁写法 | `SELECT ... FOR UPDATE` | 同（`FOR UPDATE` / `FOR SHARE`） |
| 咨询锁 | `GET_LOCK()` 函数 | `pg_advisory_lock()`（会话级/事务级） |
| 死锁排查 | `SHOW ENGINE INNODB STATUS` | `pg_stat_activity` + 日志 `deadlock detected` 详情 |
| 空间回收 | 删除即复用页空间（少膨胀困扰） | 依赖 autovacuum；大表膨胀需 `VACUUM` |
| `idle in transaction` 危害 | 相对不敏感 | **阻碍 VACUUM**，需监控 |

> 主线差异：**PG 的 REPEATABLE READ 用「快照」实现（非锁），默认隔离级别更「松」（RC）**；**空间回收机制（VACUUM）是 PG 独有且必须懂的运维点**。

---

## 12. 验收自测

### 12.1 复现不可重复读（RC）

按 §4.3 两会话交替执行：会话A 在 `READ COMMITTED` 下两次读同一行，中间会话B 提交更新 → 会话A 第二次读到新值。

### 12.2 复现死锁并读日志

1. 按 §7.1 顺序在两个会话交替执行，会话B 应报 `ERROR: deadlock detected`。
2. 到 PG 日志（或 `\di` 前看控制台）找到 `deadlock detected` 块，能用「Process / waits for / blocked by」解释谁等谁。

### 12.3 用 `pg_stat_activity` 看会话状态

```sql
SELECT pid, usename, state, query
FROM pg_stat_activity
WHERE datname = 'pg_tutorial';
-- 预期：能看到自己的 psql 连接，state 为 active / idle
```

### 12.4 解释触发器安全

口头说清 §10 的四个特性（只改当前行 / 不查表 / 微秒完成 / FOR EACH ROW），说明它为何不可能死锁、不阻塞他人。

---

## 13. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 两个事务互相卡住、一个报错 | 死锁（锁顺序反转） | 事务按**一致顺序**访问资源（§7） |
| 明明 `REPEATABLE READ` 还「读到别的事务提交」 | 隔离级别没设对 / 是 RC | 用 `BEGIN ISOLATION LEVEL REPEATABLE READ` 开启（§4.4） |
| 想「先读后改」却读到旧值再改错 | 没加行锁，读-改之间有竞态 | `SELECT ... FOR UPDATE` 锁行再改（§5） |
| 表越来越大、查询变慢 | 死元组堆积（MVCC 旧版本未回收） | 确认 autovacuum 工作；大表膨胀可 `VACUUM`（§9） |
| `pg_stat_activity` 里一堆 `idle in transaction` | 应用开了事务却忘了 commit/rollback | 尽早提交，排查长事务（§8） |
| 咨询锁忘了释放 | 用了会话级 `pg_advisory_lock` 没 unlock | 用事务级 `pg_advisory_xact_lock`（自动释放） |
| 在 `READ UNCOMMITTED` 下以为能读脏数据 | PG 无此级别 | `READ UNCOMMITTED` 会当 `READ COMMITTED` 处理（§4.2） |
| `VACUUM FULL` 期间写不进去 | `VACUUM FULL` 加 `ACCESS EXCLUSIVE` 全表锁 | 少用 `VACUUM FULL`，日常交给 `VACUUM`/autovacuum（§9） |

---

## 14. 小结

- **MVCC**：读不阻塞写的根基（多版本元组）；代价是旧版本要靠 **VACUUM** 回收。
- **隔离级别**：PG 默认 `READ COMMITTED`；`REPEATABLE READ` 用**快照**已能防幻读；无 `READ UNCOMMITTED`。
- **锁**：行锁 `FOR UPDATE`/`FOR SHARE`（读-改安全）、表锁、咨询锁 `pg_advisory_lock`。
- **死锁**：锁顺序反转→循环等待；PG 秒级检测并回滚一方，日志 `deadlock detected` 可读。
- **idle in transaction**：持锁 + 阻碍 VACUUM，要监控。
- **触发器安全**：`updated_at` 触发器只因「只改当前行、无外部依赖、微秒完成」而不可能死锁。

至此，**阶段 5（事务、MVCC 与并发）收尾**。下一站 **阶段 6 · 索引与执行计划**（`06-索引与执行计划/01-索引类型与设计`），或你指定下一章。