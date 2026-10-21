# 07 · 事务与事务性 DDL

> 所属：阶段 0 · 认识 PostgreSQL 与环境上手
> 本篇覆盖：事务（ACID）、`BEGIN`/`COMMIT`/`ROLLBACK`、`SAVEPOINT`、自提交（autocommit）、以及 PG 的招牌能力**事务性 DDL**
> **本篇首次教学：事务与 ACID、`BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`、autocommit、事务性 DDL（`CREATE`/`DROP`/`ALTER` 可回滚，对照 MySQL 的隐式提交）**（后续篇只引用，不再重讲）
> 预告：隔离级别、MVCC、锁与 VACUUM 是更深的主题，放在阶段 5；本篇只建立「事务能干什么、为什么 DDL 可回滚」的基础心智。

> 下文所有「完整文件路径」均**相对仓库根**（本系列位于 `docs/pgsql/` 下）。
> psql / `users` 表 / CRUD 见 `02`–`06` 篇；本篇全部 SQL 都在 `pg_tutorial` 库操作。

---

## 1. 本篇目标

- 理解「事务」是什么、ACID 四个字母的含义。
- 会用 `BEGIN` / `COMMIT` / `ROLLBACK`，知道「显式事务」和「自动提交」的区别。
- 会 `SAVEPOINT` 回滚到事务中间点。
- 掌握 PG 的**事务性 DDL**：建表、删表、改表都能随事务回滚，并理解这与 MySQL「DDL 隐式提交」的本质差异。

**验收标准**：

1. 在事务里 `INSERT` 一条数据，`ROLLBACK` 后它不存在。
2. 在事务里 `CREATE TABLE`，`ROLLBACK` 后表不存在（证明 DDL 可回滚）。
3. 能口头说出「为什么 MySQL 里 `ROLLBACK` 救不回来一条已执行的 `CREATE TABLE`，PG 却可以」。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成 `04-增删改查.md`（至少懂 INSERT/SELECT） |
| 环境 | 已连上 `pg_tutorial` 库（`\c pg_tutorial`） |
| 知识 | 无额外要求；本篇从零讲事务 |

---

## 3. 什么是事务（首次教学）

### 3.1 一句话

**事务 = 一组「要么全部成功、要么全部撤销」的 SQL 操作。** 它保证数据库不会停留在「做了一半」的中间状态。

### 3.2 ACID 四属性

| 字母 | 含义 | 通俗解释 |
| --- | --- | --- |
| **A**tomicity | 原子性 | 一组操作要么全成、要么全不成（本篇重点演示） |
| **C**onsistency | 一致性 | 事务前后，数据都满足约束（外键/CHECK 等） |
| **I**solation | 隔离性 | 并发事务互不干扰（阶段 5 展开） |
| **D**urability | 持久性 | 提交后数据不会丢，崩溃也能恢复 |

> 本篇聚焦 **原子性**（回滚），其余三个尤其是「隔离性」是阶段 5 的完整主题。

---

## 4. BEGIN / COMMIT / ROLLBACK（首次教学）

### 4.1 三个命令

| 命令 | 作用 |
| --- | --- |
| `BEGIN;`（或 `START TRANSACTION;`） | 开启一个**显式事务** |
| `COMMIT;` | 提交：事务内所有操作**生效并持久化** |
| `ROLLBACK;` | 回滚：撤销事务内所有操作，**回到事务开始前的状态** |

### 4.2 实操：回滚一条 INSERT

```sql
BEGIN;
INSERT INTO users (username, email) VALUES ('tmp', 'tmp@example.com');
SELECT COUNT(*) FROM users;   -- 此处能看到 tmp 这一行（但还没提交）
ROLLBACK;
SELECT COUNT(*) FROM users;   -- 回到行数不变，tmp 已消失
```

**预期输出**：`BEGIN` 后 `SELECT COUNT(*)` 多 1 行；`ROLLBACK` 后再查，`tmp` 不在了。

> 关键直觉：**在 `COMMIT` 之前，一切都可以反悔**；一旦 `COMMIT`，就落盘生效了；`ROLLBACK` 则把「这条连接里自 `BEGIN` 以来」的改动全部撤销。

### 4.3 提交一次成功的修改

```sql
BEGIN;
UPDATE users SET age = 31 WHERE username = 'alice';
COMMIT;                         -- 提交，改动持久化
SELECT username, age FROM users WHERE username = 'alice';  -- age 已是 31
```

---

## 5. SAVEPOINT：回滚到事务的「中间检查点」（首次教学）

事务很长时，不想「要么全成、要么全撤」，可以中途打**检查点**。

```sql
BEGIN;
INSERT INTO users (username, email) VALUES ('s1', 's1@example.com');
SAVEPOINT p1;                              -- 打一个检查点
INSERT INTO users (username, email) VALUES ('s2', 's2@example.com');
ROLLBACK TO p1;                            -- 只撤回 p1 之后的 s2
COMMIT;                                    -- 提交，保留 s1
```

**预期结果**：`s1` 保留、`s2` 被回滚。

| 命令 | 作用 |
| --- | --- |
| `SAVEPOINT 名字;` | 记录当前位置 |
| `ROLLBACK TO 名字;` | 回滚到该检查点（检查点之后的改动撤销） |
| `RELEASE 名字;` | 删除检查点 |

> 记忆：`SAVEPOINT` 是事务里的「存档点」，`ROLLBACK TO` 是「读档回到存档点」。

---

## 6. 自动提交（autocommit）与显式事务

PG 默认开启 **autocommit**：每一条 SQL 都是一个「单语句事务」，执行完立刻自动提交。

- 你平时直接敲 `INSERT ...;`，不用写 `BEGIN`，就是因为它**自动提交**了。
- 显式写 `BEGIN;` 就是**关闭自动提交**，把多条 SQL 绑成一个事务，直到 `COMMIT`/`ROLLBACK`。

> 这也是「为什么无意中误删数据就救不回来」的原因：`DELETE` 那条（在没有显式 `BEGIN` 的情况下）**已经自动提交**了。想「先试再定」，记得先 `BEGIN`。

---

## 7. 事务性 DDL：PG 的招牌能力（首次教学，本篇核心）

### 7.1 现象：建表也能回滚

在 PG 里，`CREATE TABLE` / `DROP TABLE` / `ALTER TABLE` 这些**结构变更（DDL）也属于事务的一部分**，可以回滚：

```sql
BEGIN;
CREATE TABLE test_ddl (id integer);
\dt                        -- 能看到 test_ddl（注意 psql 里此时它已在当前事务内可见）
ROLLBACK;
\dt                        -- test_ddl 消失，回滚成功
```

**预期结果**：`ROLLBACK` 后 `\dt` 里**没有** `test_ddl`。

### 7.2 与 MySQL 的本质差异

| 行为 | PostgreSQL | MySQL |
| --- | --- | --- |
| DDL 能否回滚 | ✅ **可以**（事务性 DDL） | ❌ DDL 会**隐式提交**，`ROLLBACK` 救不回来 |
| 典型场景 | 迁移脚本中途失败，整体回滚不留半成品 | `CREATE TABLE` 一旦执行就永久留下 |

> 关键点：**MySQL 执行 DDL 时会先自动提交当前事务**（隐式提交），所以 `BEGIN; CREATE TABLE ...; ROLLBACK;` 在 MySQL 里表**依然存在**；而 PG 里表会被回滚撤销。
> **这个差异是 PG「正确性口碑」的重要来源**：做大型 schema 迁移时，PG 可以把「建 N 张表 + 改 M 张表」包成一个事务，任何一步失败都能整体回滚，不会留下「建了一半」的残局。

### 7.3 项目里的实际意义（呼应 mini-dify）

> mini-dify 的 Prisma / SQLAlchemy 迁移本质上就是一系列 DDL。PG 的事务性 DDL 意味着：迁移失败时，数据库不会处于「表建了、索引没建」的脏状态。这条在阶段 11「综合实战」会再回来看。

---

## 8. 与 MySQL 对照速查

| 能力 | MySQL | PostgreSQL | 差异 |
| --- | --- | --- | --- |
| `BEGIN/COMMIT/ROLLBACK` | ✅ | ✅ | 语法一致 |
| `SAVEPOINT` / `ROLLBACK TO` | ✅ | ✅ | 语法一致 |
| autocommit | 默认开（可关） | 默认开（可关） | 概念一致 |
| **DDL 是否事务化** | ❌ 隐式提交 | ✅ **事务性** | **核心差异** |

---

## 9. 验收自测

### 9.1 回滚一条 DML

```sql
BEGIN;
INSERT INTO users (username, email) VALUES ('rollme', 'rollme@example.com');
ROLLBACK;
SELECT COUNT(*) FROM users WHERE username = 'rollme';   -- 预期 0
```

### 9.2 证明 DDL 可回滚

```sql
BEGIN;
CREATE TABLE should_not_exist (id integer);
ROLLBACK;
\d should_not_exist   -- 预期：报错 relation "should_not_exist" does not exist
```

### 9.3 验证 COMMIT 真正生效

```sql
BEGIN;
UPDATE users SET age = 99 WHERE username = 'alice';
COMMIT;
SELECT age FROM users WHERE username = 'alice';   -- 预期 99，且断开重连后仍在
```

> 三条都通过即完成本篇。

---

## 10. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 「我明明 ROLLBACK 了，表怎么还在」 | 你写的是 MySQL（DDL 隐式提交） | PG 里 DDL 可回滚，两库行为不同 |
| 事务一直开着忘了 COMMIT/ROLLBACK | 连接处于「事务中」未收尾 | 及时 `COMMIT` 或 `ROLLBACK`；`\x` 看状态前可用 `SELECT txid_current_if_assigned()`（进阶，阶段 5） |
| 在 psql 里敲 `BEGIN` 后一直没反应要输下一条 | 事务内多行输入是正常的，SQL 以 `;` 结尾 | 每条以 `;` 结束；最后 `COMMIT;` 或 `ROLLBACK;` |
| 认为「单条 UPDATE 没提交就能反悔」 | autocommit 默认开，单条已自动提交 | 想反悔先 `BEGIN` 再操作 |
| 迁移脚本中途报错留下一堆半成品表 | 用了 MySQL 的历史惯性担心 | PG 里把迁移包进一个事务，失败整体回滚 |

---

## 11. 本篇小结

- 事务 = 一组「全成或全撤」的 SQL；ACID 四个属性（本篇聚焦原子性）。
- `BEGIN` → 操作 → `COMMIT`（生效）/ `ROLLBACK`（撤销）；`SAVEPOINT` 打中间检查点。
- autocommit 默认开，每句自动提交；想「先试再定」先 `BEGIN`。
- **PG 的事务性 DDL**：`CREATE`/`DROP`/`ALTER` 都能回滚；MySQL 的 DDL 隐式提交、不可回滚。这是两库在「正确性」上的重要分野，也是大型 schema 迁移安全性的关键。

阶段 0 至此已覆盖：认知 → 环境 → 类型建表 → CRUD → 聚合 → 多表连接 → 事务。下一篇可选方向：`与 MySQL 差异专题`（标识符引号大小写 + 高频语法差异）或直接进入 `JSONB`。