# 01 · Database / Schema / Role 三层

> 所属：阶段 7 · 体系结构、Schema 与权限
> 本篇覆盖：PG 的「实例 → 数据库 → Schema → 对象」四层结构与 MySQL 两层对照、Schema 作为命名空间与 `public`、`search_path` 名字解析、Role（登录角色 / 群组角色）、`GRANT`/`REVOKE` 权限模型、`ALTER DEFAULT PRIVILEGES` 默认权限
> **本篇首次教学：PG 四层结构（cluster/实例 → database → schema → 表，对照 MySQL「实例 → 库=命名空间 → 表」）、`CREATE SCHEMA` 与 `\dn`、`public` 默认 schema 与 PG15 的权限收紧、`search_path`（默认 `"$user", public`）与 `SET search_path`、`CREATE ROLE`/`CREATE USER` 的 `LOGIN`/`PASSWORD`/`NOLOGIN`、群组角色「角色授权给角色」、`GRANT`/`REVOKE`（表级 `SELECT/INSERT/UPDATE/DELETE`、schema 级 `USAGE`、库级 `CONNECT`）、`\du`/`\dp` 查看角色与权限、`SET ROLE` 切换、`ALTER DEFAULT PRIVILEGES` 默认权限**（后续篇只引用，不再重讲）
> 预告：系统目录 `pg_catalog`/`information_schema`、`pg_stat_activity`/`pg_locks` 等监控视图放下一篇 `07-02-系统目录与监控.md`；备份与复制见阶段 10。

> 下文所有「完整文件路径」均**相对仓库根**（本系列位于 `docs/pgsql/` 下）。
> `\dn`/`\du` 元命令在 `00-02` 已顺带列出，本篇完整教其含义；建库 `CREATE DATABASE` 见 `00-02`。

---

## 1. 本篇目标

- 吃透「实例 → 数据库 → Schema → 对象」这四层，特别是 **schema = 命名空间**这一 PG 特有概念，与 MySQL「库就是命名空间」对照。
- 理解 `search_path` 如何决定「你没写 schema 前缀的 `SELECT * FROM orders` 到底查了哪张表」。
- 掌握 Role 的两类用法（能登录的「用户」 vs 不能登录的「权限组」），以及「把角色授给角色」的继承机制。
- 会用 `GRANT`/`REVOKE` 与 `ALTER DEFAULT PRIVILEGES` **造出一个只读/只写指定 schema 的业务角色**，并验证越权被拒。

**验收标准**

1. 建一个 `reporting` schema，能说出它和表的关系及 `\dn` 看到什么。
2. 解释 `search_path` 默认值 `"$user", public` 的含义，并演示 `SET search_path`。
3. 建一个**登录角色** `app_reader` + 一个**群组角色** `app_role`，把前者授给后者。
4. 让 `app_reader` 只能 `SELECT` 某 schema 的表，验证它 `INSERT`/`DROP`/查别的库都**被拒绝**。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成阶段 0 各篇（会建库/建表/CRUD）；会 `\l`/`\c`/`\dt` |
| 环境 | 用 `postgres` 超级用户连库（只有超管能建角色、授权） |
| 知识 | `CREATE TABLE`、`CREATE DATABASE`（`00-02`） |

---

## 3. 四层结构：先立住「PG 比 MySQL 多一层」（首次教学）

这是两库在**体系结构**上最容易让 MySQL 老手困惑的差异：

| 层 | PostgreSQL | MySQL |
| --- | --- | --- |
| 实例（cluster） | 一个 PG 服务进程群，管理多个数据库 | 一个 mysqld 进程，管理多个 database |
| 数据库（database） | `CREATE DATABASE`；**一个连接同一时刻只能连一个库**，跨库要 dblink/外部表 | `CREATE DATABASE`（与 schema 同义） |
| **Schema（命名空间）** | **存在这一层**，库内再分命名空间 | **没有这一层**，`DATABASE` 就是命名空间 |
| 对象 | 表/视图/序列/函数… 挂在某个 schema 下 | 表挂在 database 下 |

> 核心结论：**MySQL 的「库」对应 PG 的「schema」**。PG 额外多出的「database」层，让一个 PG 实例里可以有多个**彼此完全隔离**的库；而每个库内部，又可以用 schema 再做**逻辑分组**（多租户、多模块命名空间）。
> 一句话记忆：`PG: 实例 → 库 → schema → 表`，`MySQL: 实例 → 库(=schema) → 表`。

### 3.1 schema 是命名空间

```sql
-- schema 是「表/视图/序列…的一层逻辑分组」
CREATE SCHEMA reporting;
CREATE SCHEMA staging;

-- 在不同 schema 下可以建同名表，互不干扰
CREATE TABLE reporting.orders  (id integer PRIMARY KEY);
CREATE TABLE staging.orders    (id integer PRIMARY KEY);

-- 列库内所有 schema
\dn
```

> `\dn`（dn = database namespace）列出当前库的所有 schema。每个新建库默认**已经有一个 `public` schema**，不写 `schema.` 前缀时就用它。

### 3.2 public 与 PG15 的权限变化

`public` 是默认 schema，所有对象默认挂这里。它有两个「历史遗留」的宽松点：

- 旧版本（< 15）：**任何角色都能在 `public` 里建对象**（`PUBLIC` 默认有 `CREATE`）。
- **PG 15 起收紧**：只有库的 owner 才能在 `public` 建对象，其他角色需显式授权。

```sql
-- 查看 public 上的权限（PG15 后默认只有 owner 有 C）
\dp public
```

> 这点对生产安全重要：老库里 `public` 的 `CREATE` 权限要记得回收（§7.4 会演示）。本项目 mini-dify 用 Prisma，默认就在 `public` 下建表，暂不涉及多 schema。

---

## 4. search_path：不写前缀时查哪（首次教学）

你写 `SELECT * FROM orders` 时，PG 到底去哪个 schema 找 `orders`？答案由 **`search_path`** 决定。

```sql
-- 看当前 search_path
SHOW search_path;
-- 默认输出： "$user", public
```

`"$user", public` 的解析顺序：

1. 先找**与当前登录用户名同名的 schema**（`$user`，这里假设叫 `app_reader`，就是 `app_reader` schema）。
2. 找不到，再去 `public`。

```sql
-- 显式指定某条查询用哪个 schema 的前缀（最稳妥）
SELECT * FROM reporting.orders;

-- 或用 SET 临时改当前会话的 search_path
SET search_path TO reporting, public;
SELECT * FROM orders;   -- 现在优先在 reporting 里找
```

> 关键：**不带前缀的表名解析完全取决于 `search_path`**。团队协作 / 多租户里，要么始终写 `schema.表名`，要么用 `ALTER ROLE ... SET search_path` 为某角色固定默认路径，避免「查错表」这类隐性事故。

| 元命令 | 作用 |
| --- | --- |
| `\dn` | 列 schema |
| `\dn+` | schema 及其描述/owner |

---

## 5. Role：登录角色 vs 群组角色（首次教学）

PG 里**「用户」和「组」是同一个东西：`ROLE`**，差别只在有没有 `LOGIN` 权限。（`00-02` 的 `\du` 就是列角色。）

### 5.1 登录角色 = 能连库的用户

```sql
-- CREATE ROLE ... LOGIN PASSWORD 就是一个「用户」
CREATE ROLE app_reader LOGIN PASSWORD 'secret';

-- CREATE USER 是 CREATE ROLE ... LOGIN 的简写
CREATE USER app_writer PASSWORD 'secret2';
```

### 5.2 群组角色 = 不能登录、只做「权限容器」

```sql
-- 不写 LOGIN，就是不可登录的组角色，只管聚拢权限
CREATE ROLE app_role;

-- 把「用户」授给「组」，用户就继承组的所有权限（成员关系）
GRANT app_role TO app_reader;

-- \du 能看到角色及其成员关系
\du
```

| 写法 | 能否登录 | 用途 |
| --- | --- | --- |
| `CREATE ROLE x LOGIN` / `CREATE USER x` | ✅ | 从应用连库的账号 |
| `CREATE ROLE x`（无 LOGIN） | ❌ | 权限组，供别的角色继承 |

> 最佳实践：**权限授给「群组角色」，用户加入群组**，而不是逐用户撒权限。这样新人入职只需 `GRANT app_role TO 新人`，收权限也统一。
> 与 MySQL 对照：MySQL 里「用户」和「角色」（8.0+）是**两套概念**（用户有 host、角色要 `SET ROLE` 激活）；PG 统一成 `ROLE`，更简洁。

---

## 6. GRANT / REVOKE：权限模型（首次教学）

PG 权限分**三层**授予，缺一层都进不去：

| 层 | 权限 | 说明 |
| --- | --- | --- |
| 库级 | `CONNECT` | 能否连这个库 |
| schema 级 | `USAGE` | 能否「看到/进入」这个 schema 的对象（前提门槛） |
| 对象级 | `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES` | 对表的具体操作 |

### 6.1 三步授权：让 app_reader 只读 reporting

```sql
-- ① 连库权限（通常 CREATE DATABASE 完成，或显式授）
GRANT CONNECT ON DATABASE pg_tutorial TO app_reader;

-- ② 进入 schema 的权限（没有 USAGE 连表都看不到）
GRANT USAGE ON SCHEMA reporting TO app_reader;

-- ③ 对 schema 内「已有表」的读权限
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO app_reader;
```

### 6.2 看权限

```sql
\dp reporting.orders     -- 表级权限（= 谁的什么权限）
-- 或查信息：\z reporting.orders
```

### 6.3 回收权限

```sql
REVOKE SELECT ON ALL TABLES IN SCHEMA reporting FROM app_reader;
REVOKE USAGE ON SCHEMA reporting FROM app_reader;
```

### 6.4 用 SET ROLE 模拟该角色验证（首次教学）

```sql
-- 以超级用户身份「切换成」app_reader 的视角，验证权限边界
SET ROLE app_reader;

SELECT * FROM reporting.orders;   -- 应成功
INSERT INTO reporting.orders (id) VALUES (1);  -- 应报错：permission denied
DROP TABLE reporting.orders;      -- 应报错：permission denied

RESET ROLE;                       -- 切回超级用户
```

> `SET ROLE`（含 `RESET ROLE`）能让你临时「变成」别的角色测试权限，不用真的二次登录。这是权限调试的利器。

---

## 7. 默认权限：让「未来的表」也自动授权（首次教学）

第 6.1 步里 `GRANT ... ON ALL TABLES` 只作用于**当时已存在的表**；之后新建的表不会自动授权。要覆盖「将来的对象」，用 **`ALTER DEFAULT PRIVILEGES`**：

```sql
-- 让 app_reader 之后在 reporting 里新建的表也自动有 SELECT
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO app_reader;
```

> 语法记住「**IN SCHEMA x**」限定：这段默认权限只对 **x** schema 里未来由你创建的对象生效。
> 与 MySQL 对照：MySQL 没有 `ALTER DEFAULT PRIVILEGES`，新库新表要逐库/逐表 `GRANT`（或靠用户通配 `*.*`）；PG 的默认权限更精细可控。

### 7.1 开发期常见的全放行（谨慎）

```sql
GRANT USAGE ON SCHEMA reporting TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT ALL ON TABLES TO app_role;
```

> 全放行只适合内部开发 schema；生产要按 §11 收口到最小权限。

---

## 8. 项目实战：给 mini-dify 造一个受限业务角色

项目当前用 Prisma，所有表默认在 `public`、由应用账号直连。给它设计一个「只读报表」角色，演示真实的权限收口：

```sql
-- ① 组角色（无登录）承载只读权限
CREATE ROLE reporting_ro;

-- ② 授权：只读 public 里 app 相关表的 SELECT
GRANT USAGE ON SCHEMA public TO reporting_ro;
GRANT SELECT ON apps TO reporting_ro;

-- ③ 建一个登录用户，加入该组
CREATE USER report_reader LOGIN PASSWORD 'only-read';
GRANT reporting_ro TO report_reader;

-- ④ 以 report_reader 视角验证：能读、不能写、不能删
SET ROLE report_reader;
SELECT count(*) FROM apps;          -- ✅ 成功
UPDATE apps SET name = 'x' WHERE id = '1';  -- ❌ permission denied
DELETE FROM apps;                   -- ❌ permission denied
RESET ROLE;
```

> 这正是「按角色聚拢权限 + 最小授权」在生产里的落地形态：**权限在 `reporting_ro` 组上，人员变动只动成员关系**。

---

## 9. 与 MySQL 权限对照速查

| 能力 | MySQL | PostgreSQL |
| --- | --- | --- |
| 用户标识 | `user@host`（用户名 + 来源主机） | `role + LOGIN`（默认走 `pg_hba.conf` 管来源） |
| 用户 vs 组 | 用户、角色（8.0+）两套，`SET ROLE` 激活 | 统一 `ROLE`，`LOGIN` 与否区分 |
| 命名空间 | `DATABASE` | `schema` + `search_path` |
| 授权粒度 | 库/表/列 + `*.*` 通配 | 库 `CONNECT` / schema `USAGE` / 表对象 / 列 |
| 给未来对象授权 | 无（逐库逐表或通配） | `ALTER DEFAULT PRIVILEGES` |
| 跨库 | 可跨库查询（`db.table`） | **一个连接只连一个库**，跨库需 dblink/FDW |

---

## 10. 验收自测

### 10.1 建 schema 并查看

```sql
CREATE SCHEMA reporting;
\dn
-- 预期看到 public 与 reporting
```

### 10.2 解释 search_path

```sql
SHOW search_path;
-- 说出 "$user", public 的解析顺序；再：
SET search_path TO reporting, public;
```

### 10.3 造「组角色 + 登录用户」

```sql
CREATE ROLE app_role;
CREATE ROLE app_reader LOGIN PASSWORD 'secret';
GRANT app_role TO app_reader;
\du
```

### 10.4 授权并验证越权被拒

```sql
CREATE TABLE reporting.orders (id integer PRIMARY KEY);

GRANT CONNECT ON DATABASE pg_tutorial TO app_reader;
GRANT USAGE ON SCHEMA reporting TO app_reader;
GRANT SELECT ON reporting.orders TO app_reader;

SET ROLE app_reader;
SELECT * FROM reporting.orders;                -- ✅
INSERT INTO reporting.orders VALUES (1);        -- ❌ permission denied for table orders
RESET ROLE;
```

---

## 11. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 授了 `SELECT` 仍报「permission denied for schema」 | 缺 schema 级 `USAGE` | 先 `GRANT USAGE ON SCHEMA` |
| 新表不会自动继承旧表的授权 | 用 `GRANT ... ON ALL TABLES` 只覆盖现有表 | 配一份 `ALTER DEFAULT PRIVILEGES`（§7） |
| 不写前缀的表「突然」查到别的 schema 的表 | `search_path` 变了 | 固定 `ALTER ROLE SET search_path` 或始终写 `schema.表名` |
| 老库里 `public` 谁都能建表 | PG15 前 `PUBLIC` 有 `CREATE` | `REVOKE CREATE ON SCHEMA public FROM PUBLIC` |
| `CREATE ROLE` 的角色连不上库 | 没加 `LOGIN`（成了组角色） | 用 `CREATE USER` 或 `LOGIN` 属性 |
| 测权限时切不回 | `SET ROLE` 后忘记 `RESET ROLE` | 加 `RESET ROLE` |

---

## 12. 本篇小结

- PG 比 MySQL 多一层：`实例 → 库 → schema → 表`；**MySQL 的「库」对应 PG 的「schema」**，PG 的「库」是更重的隔离层。
- `schema` 是命名空间（默认 `public`）；`search_path`（默认 `"$user", public`）决定不写前缀的表从哪解析。
- `ROLE` 统一「用户」与「组」：`LOGIN` 与否区分能否登录；`GRANT 组 TO 用户` 实现成员继承。
- 权限授三层：库 `CONNECT` + schema `USAGE` + 表对象 `SELECT/INSERT/...`；`SET ROLE` 模拟角色验边界。
- `ALTER DEFAULT PRIVILEGES` 让未来的表自动继承授权；收口原则＝权限放在组角色上、人员只动成员关系。

下一篇 `07-02-系统目录与监控.md`：`pg_catalog`/`information_schema`、`pg_stat_activity`/`pg_locks`/`pg_settings` 等系统目录与监控视图。