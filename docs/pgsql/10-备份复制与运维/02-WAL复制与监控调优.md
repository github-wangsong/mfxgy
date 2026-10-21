# 02 · WAL、复制与监控调优

> 所属：阶段 10 · 备份、复制与运维（选修）
> 本篇覆盖：WAL 原理与崩溃恢复、checkpoint、WAL 归档与 PITR、物理流复制（主从）、逻辑复制（发布/订阅）、关键内存参数调优（`shared_buffers`/`work_mem`/`effective_cache_size` 等）、复制与 checkpoint 监控视图
> **本篇首次教学：WAL（Write-Ahead Logging）原理（先写日志再写数据文件，崩溃恢复靠 WAL 重放）；checkpoint（把脏页刷盘 + WAL 截断）；`wal_level`（minimal/replica/logical）；WAL 归档（`archive_mode`/`archive_command`）与 PITR 时间点恢复；物理流复制（主库 `wal_level=replica` + `max_wal_senders`，从库 `pg_basebackup` + `recovery.signal` 热备只读、`primary_conninfo`）；同步/异步复制与复制槽（`CREATE_REPLICATION_SLOT`）；逻辑复制 `CREATE PUBLICATION`/`CREATE SUBSCRIPTION`（表级、跨大版本）；关键参数（`shared_buffers` 25%内存、`work_mem` 每操作排序哈希、`maintenance_work_mem`、`effective_cache_size` 50-75%内存、`max_wal_size`/`checkpoint_timeout`）；监控视图 `pg_stat_replication`/`pg_stat_bgwriter`/`pg_stat_database`**（`pg_stat_statements` 已在 `08-01` 教过；后续篇只引用，不再重讲）
> 预告：阶段 11 综合实战将把 PG 能力（JSONB + pgvector + 索引）与 Prisma/SQLAlchemy 串成完整数据层。

> 下文所有「完整文件路径」均**相对仓库根**（本系列位于 `docs/pgsql/` 下）。

---

## 1. 本篇目标

- 理解 WAL 是什么、为什么崩溃后 PG 能靠它恢复，以及 checkpoint 的作用。
- 分清两种复制：**物理流复制**（整库字节级，做主从/高可用）与**逻辑复制**（表级 SQL 级，做同步/迁移）。
- 掌握 PG 最该调的几个内存参数，知道它们各管什么、经验值多少。
- 会用 `pg_stat_replication` 等视图看复制是否健康。

**验收标准**

1. 说出 WAL 与 checkpoint 各自的作用，以及崩溃恢复的过程。
2. 说出物理复制与逻辑复制的区别及各自适用场景。
3. 说出 `shared_buffers`、`work_mem`、`effective_cache_size` 三个参数的经验值与作用。
4. 用 `pg_stat_replication` 查看复制状态（若有从库）。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成 `10-01`（逻辑备份）；事务/MVCC/VACUUM 见 `05-02` |
| 环境 | 理解 PG 进程模型（`00-01`）；项目为 Docker 单节点，复制部分以原理为主 |
| 知识 | `pg_settings` 与 `ALTER SYSTEM`（`07-02`） |

---

## 3. WAL：PG 的「预写日志」（首次教学）

### 3.1 核心思想

WAL（Write-Ahead Logging）= **「先写日志，再写数据」**。任何对数据页的修改，PG 先把「改了什么」记到 WAL 文件，再异步把数据页刷到磁盘。

这样设计的好处：**崩溃时数据页可能没刷盘，但 WAL 一定已落盘**，重启时重放 WAL 就能把未刷盘的修改补回来，保证不丢已提交事务。

> 一句话：WAL 是 PG 的「保险日志」，崩溃恢复 = 重放 WAL。

### 3.2 checkpoint：把脏页刷盘

数据页被修改后先放内存（`shared_buffers`），由 **checkpoint** 进程定期把「脏页」批量刷到数据文件，并在 WAL 里记一个 checkpoint 点。

| 作用 | 说明 |
| --- | --- |
| 减少崩溃恢复时间 | checkpoint 之后只需重放 checkpoint 到崩溃点的 WAL |
| 截断旧 WAL | checkpoint 前的 WAL 可归档/删除 |
| 影响写入性能 | checkpoint 刷盘是 I/O 密集，太频繁会抖 |

关键参数：

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| `checkpoint_timeout` | 5min | 最多多久做一次 checkpoint |
| `max_wal_size` | 1GB | WAL 涨到多大触发 checkpoint |
| `checkpoint_completion_target` | 0.9 | 把刷盘摊在多少时间内完成（越高越平滑） |

> 对照 MySQL：InnoDB 也有 redo log（同样先写日志）+ binlog（逻辑复制用）+ undo log（MVCC）。PG **只有一套 WAL**，同时承担「崩溃恢复 + 复制 + 归档」三重角色，比 MySQL 的多套日志统一。

### 3.3 WAL 级别 `wal_level`

`wal_level` 决定 WAL 记录多少信息：

| 级别 | 信息量 | 用途 |
| --- | --- | --- |
| `minimal` | 最少（只崩溃恢复） | 无复制 |
| `replica` | 足够物理复制 + 归档 | **默认**，主流场景 |
| `logical` | 再加逻辑解码信息 | 逻辑复制（发布/订阅） |

> 要用物理复制至少 `replica`，用逻辑复制必须 `logical`。改 `wal_level` 需重启。

---

## 4. WAL 归档与 PITR（首次教学）

逻辑备份只能恢复到「备份时刻」；要恢复到**任意时间点**（PITR，Point-In-Time Recovery），靠 **WAL 归档**。

### 4.1 开启归档

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /archive/wal/%f'    # %p=WAL源路径，%f=WAL文件名
```

> `archive_command` 由 PG 在 WAL 段写满时调用，把 WAL 复制到安全位置（异地存储/对象存储）。生产通常用 `pgBackRest` 等工具，不直接 `cp`。

### 4.2 PITR 恢复步骤

1. 用 `pg_basebackup`（物理基础备份）恢复数据目录到某时刻；
2. 配置 `recovery.signal` + `restore_command`（从归档读 WAL）；
3. 设 `recovery_target_time` 为要恢复到的时间点；
4. 启动 PG，重放 WAL 到目标时间点后停止。

> 这是 PG 灾难恢复的「黄金组合」：**物理基础备份 + WAL 归档 = 可恢复到任意秒级**。逻辑备份（`10-01`）做日常、物理+WAL 做灾难。

---

## 5. 物理流复制：主从高可用（首次教学）

物理复制 = **从库逐字节重放主库的 WAL**，从库数据与主库**完全一致**（除只读）。

### 5.1 主库配置

```ini
# postgresql.conf（主库）
wal_level = replica
max_wal_senders = 10          # 允许的复制连接数
wal_keep_size = 1GB           # 主库保留多少 WAL 给从库（防止从库落后丢失）
```

```sql
-- 建复制专用角色
CREATE ROLE replicator LOGIN REPLICATION PASSWORD '...';
```

```conf
# pg_hba.conf：允许从库连接
host replication replicator <从库IP>/32 md5
```

### 5.2 从库搭建

```bash
# 从主库拉一份基础备份到从库数据目录
pg_basebackup -h <主库IP> -U replicator -D /var/lib/postgresql/data -P -R
```

> `-R` 会自动写入 `standby.signal` 和 `primary_conninfo`，从库启动后自动连接主库追 WAL，进入**热备只读**状态（可跑 `SELECT`，不能写）。

### 5.3 同步 vs 异步

| 模式 | 主库提交行为 | 一致性 | 性能 |
| --- | --- | --- | --- |
| 异步（默认） | 不等从库确认 | 主从可能短暂不一致 | 高 |
| 同步 | 等至少一个从库确认收到 WAL | 强一致 | 主库提交变慢 |

```ini
# 主库开启同步复制
synchronous_standby_names = 'standby1'   # 从库 application_name
```

### 5.4 复制槽：防止 WAL 被删

从库落后时主库可能已把它需要的 WAL 删了 → 从库追不上。**复制槽**让主库「从库没消费的 WAL 绝不删」：

```sql
-- 主库建物理复制槽
SELECT pg_create_physical_replication_slot('standby1_slot');
```

> 复制槽的代价：从库长期不消费会导致主库 WAL 无限增长撑爆磁盘（呼应 `05-02` 的磁盘风险）。要监控 `pg_replication_slots` 的滞后。

---

## 6. 逻辑复制：发布/订阅（首次教学）

逻辑复制 = **把表的变更以 SQL 行级别发布**，订阅方应用这些变更。与物理复制比：

| 维度 | 物理复制 | 逻辑复制 |
| --- | --- | --- |
| 粒度 | 整库字节级 | **表级** |
| 跨大版本 | 不行 | **可以** |
| 跨平台 | 不行 | 可以 |
| 从库可写 | 否（只读） | **可写**（还能双向） |
| 用途 | 高可用/读扩展 | 数据同步/迁移/升级 |

### 6.1 发布端（主）

```sql
-- wal_level 必须是 logical
-- 建发布：发布某几张表的所有变更
CREATE PUBLICATION pub_orders FOR TABLE orders, users;
```

### 6.2 订阅端（从）

```sql
-- 先建好同名表结构（逻辑复制不复制结构，只复制数据）
CREATE TABLE orders (...);
CREATE TABLE users (...);

-- 建订阅：连到发布端，拉取变更
CREATE SUBSCRIPTION sub_orders
    CONNECTION 'host=主库IP dbname=pg_tutorial user=replicator password=...'
    PUBLICATION pub_orders;
```

> 典型用途：**大版本升级**（老库 `logical` 发布 → 新大版本库订阅，迁移不停机）、**跨库数据同步**、**拆分表**。

---

## 7. 关键内存参数调优（首次教学）

PG 默认参数偏保守，生产需按机器内存调。最关键的几个：

| 参数 | 默认 | 经验值 | 作用 |
| --- | --- | --- | --- |
| `shared_buffers` | 128MB | **物理内存的 25%** | 共享缓冲池，缓存热数据页 |
| `work_mem` | 4MB | 16MB~64MB（按并发调整） | **每个排序/哈希操作**的内存；复杂查询并发多时要算总内存 = `work_mem × 并发数` |
| `maintenance_work_mem` | 64MB | 256MB~1GB | VACUUM/建索引等**维护操作**的内存 |
| `effective_cache_size` | 4GB | **物理内存的 50%~75%** | 告诉优化器「OS + PG 大约有多少缓存可用」，影响计划选择（不实际分配内存） |
| `max_wal_size` | 1GB | 4GB~16GB | 触发 checkpoint 的 WAL 大小阈值 |
| `checkpoint_timeout` | 5min | 10~30min | checkpoint 间隔 |

### 7.1 调参示例（16GB 内存机器）

```sql
ALTER SYSTEM SET shared_buffers = '4GB';          -- 25%
ALTER SYSTEM SET work_mem = '32MB';               -- 中等并发
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET effective_cache_size = '12GB';    -- 75%
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET checkpoint_timeout = '15min';
SELECT pg_reload_conf();   -- work_mem/effective_cache_size 等 sighup 级立即生效
                           -- shared_buffers/max_wal_size 需重启
```

> 原则：**`shared_buffers` 别超过 25%**（OS page cache 也要占内存，PG 依赖它做二次缓存）；**`work_mem` 乘以最大并发别撑爆内存**。调完用 `pg_stat_statements`（`08-01`）看 Top-N SQL 是否变快。

---

## 8. 监控复制与 checkpoint（首次教学）

### 8.1 复制状态

```sql
-- 主库看从库连接状态与延迟
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_delay_bytes
FROM pg_stat_replication;
```

| 字段 | 含义 |
| --- | --- |
| `state` | `streaming`=正常同步中 |
| `sent_lsn` | 主库已发送到哪 |
| `replay_lsn` | 从库已重放到哪 |
| `replay_delay_bytes` | 落后字节数（大=延迟高） |

### 8.2 checkpoint 与后台写

```sql
SELECT checkpoints_timed, checkpoints_req,
       buffers_checkpoint, buffers_backend,
       checkpoint_write_time, checkpoint_sync_time
FROM pg_stat_bgwriter;
```

> `checkpoints_req`（因 WAL 满被迫做的 checkpoint）远高于 `checkpoints_timed`（按时间做的）→ `max_wal_size` 太小，调大。

### 8.3 数据库级统计

```sql
SELECT datname, xact_commit, xact_rollback, deadlocks, blk_read_time, blk_write_time
FROM pg_stat_database WHERE datname = 'pg_tutorial';
```

> `deadlocks` 非零需排查（`05-02` 死锁）；`blk_read_time` 高 → 磁盘读多 → 加内存/索引。

---

## 9. 与 MySQL 对照速查

| 维度 | PostgreSQL | MySQL |
| --- | --- | --- |
| 崩溃恢复日志 | **WAL**（一套，兼顾恢复/复制/归档） | redo log（恢复）+ binlog（复制）+ undo log（MVCC） |
| 复制 | 物理流复制（WAL）+ 逻辑复制（发布/订阅） | binlog 复制（statement/row/mixed） |
| 同步复制 | `synchronous_standby_names` | 半同步复制插件 |
| 逻辑复制 | `PUBLICATION`/`SUBSCRIPTION`（10+） | binlog row 格式 + 下游解析 |
| PITR | WAL 归档 + `recovery_target_time` | binlog + `mysqlbinlog --start-datetime` |
| 缓冲池 | `shared_buffers` + OS page cache | `innodb_buffer_pool_size` |

---

## 10. 项目关联

mini-dify 当前是 Docker 单节点 PG，生产化建议（按优先级）：

1. **调内存参数**：给容器分够内存后设 `shared_buffers`/`work_mem`/`effective_cache_size`（§7）；
2. **WAL 归档**：开 `archive_mode` 把 WAL 存到对象存储，配合 `pg_basebackup` 做 PITR（§4）；
3. **物理从库**：至少一个异步热备从库，做读扩展与故障切换（§5）；
4. **逻辑复制**（可选）：将来大版本升级时用发布/订阅做不停机迁移（§6）。

> 阶段 7 的 `pg_stat_statements` 与本篇的 `pg_stat_*` 视图构成 PG 的**日常监控面板**。

---

## 11. 验收自测

### 11.1 原理问答

- WAL 的作用是什么？checkpoint 做什么？
- 物理复制 vs 逻辑复制的三个核心差异？
- `shared_buffers`/`work_mem`/`effective_cache_size` 经验值各是多少？

### 11.2 查 WAL 级别

```sql
SHOW wal_level;
-- 说出当前级别能否支持物理复制/逻辑复制
```

### 11.3 调参（本地演练，重启生效）

```sql
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET effective_cache_size = '4GB';
SELECT pg_reload_conf();
SHOW work_mem;
```

### 11.4 查数据库死锁与事务

```sql
SELECT datname, deadlocks, xact_commit, xact_rollback
FROM pg_stat_database WHERE datname = current_database();
```

---

## 12. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 从库追不上主库、报错「WAL 已被删除」 | 主库 `wal_keep_size` 太小或没复制槽 | 加大 `wal_keep_size` / 用复制槽 |
| 复制槽导致主库磁盘满 | 从库长期断连，WAL 累积不删 | 监控 `pg_replication_slots`，必要时 `pg_drop_replication_slot` |
| `work_mem` 设太大导致 OOM | 忘记 × 并发数 | `work_mem × 同时排序操作数 < 剩余内存` |
| `shared_buffers` 设到 80% 内存反而变慢 | OS page cache 被挤，二次缓存失效 | 别超 25%，留内存给 OS |
| checkpoint 期间写入抖动 | `max_wal_size` 太小、`checkpoint_completion_target` 太低 | 调大 `max_wal_size`、`checkpoint_completion_target=0.9` |
| 逻辑复制订阅端数据不一致 | 订阅端表结构与发布端不同，或提前写了数据 | 先 `TRUNCATE` 再建订阅，确保结构一致 |

---

## 13. 本篇小结

- WAL = 预写日志，PG 崩溃恢复的根基；checkpoint 把脏页刷盘 + 截断 WAL；`wal_level` 决定能否复制。
- 物理复制 = WAL 字节级重放（高可用/读扩展）；逻辑复制 = 表级 SQL 变更（迁移/升级/跨版本）。
- 复制槽防 WAL 丢失，但要防磁盘撑爆。
- 关键参数：`shared_buffers`≈25%、`work_mem` 按并发、`effective_cache_size`≈50-75%、`maintenance_work_mem` 给维护操作。
- 监控：`pg_stat_replication`（延迟）、`pg_stat_bgwriter`（checkpoint）、`pg_stat_database`（死锁/事务）。

至此阶段 10 收官（选修）。下一站 **阶段 11 · 综合实战：mini-dify 数据层**：`11-01-ORM的PG特性实战.md`（Prisma `Json`→`jsonb`、枚举、迁移与触发器；SQLAlchemy `JSONB`/`ARRAY`/方言）。回复「继续」即开写。