# 02 · Prisma 关系建模（App ↔ User 一对多）

> 所属：阶段 2 · 应用管理
> 本篇覆盖：在 `schema.prisma` 里新增 `App` 模型、与 `User` 建立**一对多关系** → 用 Prisma Migrate 生成并应用迁移 `add_apps`（建表 + 索引 + 外键）→ 数据库侧自证
> **本篇首次教学：关系建模（1:N / 外键 / 反向关系）、`@relation(fields, references)`、`onDelete: Cascade` 的语义与风险、`@@index([ownerId])`（外键为什么必须加索引）、`@default("chatflow")`、`@@map("apps")` 表名映射**
> （ORM 概念、schema-first、Prisma 三件套、迁移的意义、Prisma DSL 基础 `model`/`@id`/`@default`/`@map`/`@@map`、`DATABASE_URL` 的 Prisma 写法，均见 `01-账号与认证/02-Prisma.md`，本篇只引用不重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 1. 本篇目标

- 用 **Prisma** 在本机 PostgreSQL（容器里）建出 **`apps`** 表，并使它**归属于某个用户**。
- 建立 `User` 与 `App` 的**一对多关系**（一个用户拥有多个应用；一个应用只属于一个用户）。
- 走一遍 Prisma 标准流程：**改 schema → 迁移建表 → 生成 Client**。
- 理解**关系建模**、**外键**、`onDelete: Cascade` 的语义与风险、**外键索引**的作用。

**验收标准**

1. `pnpm --filter @mini-dify/api-ts db:migrate` 执行成功，生成 `20261018082435_add_apps/migration.sql` 并应用到数据库。
2. `\d apps` 显示列 `id / owner_id / name / description / mode(默认 'chatflow') / created_at / updated_at`、主键 `apps_pkey`、索引 `apps_owner_id_idx`、外键 `apps_owner_id_fkey → users(id) ON DELETE CASCADE`。
3. Prisma Client 里生成了 `App` 相关类型，`apps/api-ts` 编译通过。

**迁移所有权约定（沿用阶段 1，务必记住）**

| 表 | DDL 所有权 | 说明 |
| --- | --- | --- |
| 平台主表（`users`、**`apps`** 等） | **TS 侧 Prisma**（`apps/api-ts/prisma/migrations`） | Python 侧只用 SQLAlchemy **映射**同一张表，**不产生 DDL** |
| Python 专属表（如阶段 11 的 Agent Run 存储） | **Python 侧 Alembic** | 等真有归属 Python 的表时再引入 Alembic |

`apps` 表的建表权归 **Prisma**（见 `01-账号与认证/02-Prisma.md` 的「迁移所有权」）；Python 侧只读写、不建表。

---

## 2. 前置条件

- 阶段 2 · 01（契约扩展）已完成：契约里有 `/apps`、`/apps/{id}` 与 `AppResponse`（见 `02-应用管理/01-契约扩展.md`）。
- 阶段 1 · 02：`users` 表已由 Prisma 建好（迁移 `init_users` 已应用）。
- 阶段 0 · 02：**PostgreSQL 容器已 `(healthy)`**，端口 `5432` 已映射，库 `minidify` 已建。
- `apps/api-ts` 已装依赖（`@prisma/client`、`prisma`）。
- `pnpm install` 已执行过。

> 若容器没起：`docker compose up -d db`，等 `docker compose ps` 显示 `(healthy)` 再继续。

---

## 3. 先看清要做什么

阶段 1 只有 `User` 一张表。阶段 2 要引入 `App`，并把它**挂到用户身上**。Prisma 的做法是在 `schema.prisma` 里：**改 schema → 迁移建表 → 生成 Client**：

```
① 改 schema.prisma              → ② prisma migrate dev          → ③ prisma generate
   新增 model App                   （生成 SQL 并建表）               （生成类型安全的 Client）
   + 在 User 上加反向关系 App[]         │                                  │
        │                          migrations/…_add_apps/         node_modules/.prisma/client
   apps/api-ts/prisma/            migration.sql
   schema.prisma                  （CREATE TABLE apps + INDEX + FK）
```

本次迁移的产物是一份 SQL，里面包含三件事：

```sql
CREATE TABLE "apps" ( ... );                                          -- 建表
CREATE INDEX "apps_owner_id_idx" ON "apps"("owner_id");               -- 外键索引
ALTER TABLE "apps" ADD CONSTRAINT "apps_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE; -- 外键约束
```

**关系一句话说清**：一个 `User` 有多个 `App`（`User.apps` 是数组），一个 `App` 属于一个 `User`（`App.owner` 是单个）。这是**一对多（1:N）**：这是本项目第一次出现**表间关系**，也是本篇的核心。

---

## 4. 命令清单（逐条说明）

> Prisma CLI 需要在**有 `prisma/schema.prisma` 与 `.env` 的目录**执行（Prisma 读当前目录的 `.env`）。本项目的模型与环境文件都在 `apps/api-ts/` 下，所以用 `pnpm --filter @mini-dify/api-ts` 把命令**切到该包目录**执行（`pnpm --filter` 机制见 `00-项目初始化/03-monorepo与pnpm-workspace.md`）。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm --filter @mini-dify/api-ts db:migrate` | 仓库根 | 等价于 `prisma migrate dev`：比对 schema 与库现状，生成并**应用**迁移 `add_apps`，顺带 `generate` | 交互式询问迁移名（填 `add_apps`）；打印 `Applying migration '20261018082435_add_apps'`、`Your database is now in sync with your schema.` |
| `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_apps` | 仓库根 | 同上，**直接**指定迁移名（推荐，免交互） | 同上 |
| `pnpm --filter @mini-dify/api-ts db:generate` | 仓库根 | 单独重新生成 Prisma Client（改了 schema 但不想动库时用） | 打印 `Generated Prisma Client` |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"` | 任意目录 | 数据库侧自证「表真的建了、索引与外键都在」 | 打印 `apps` 表结构（列 + 索引 + 外键约束） |

> 说明：`db:migrate` 是 `apps/api-ts/package.json` 里的便捷脚本，就是 `prisma migrate dev`（见 `01-账号与认证/02-Prisma.md` §5.7）。若想直接指定迁移名、避免交互输入，用第 2 条的 `-name add_apps` 写法。本项目实测生成的迁移目录为 **`20261018082435_add_apps`**（迁移名 `add_apps`）。

---

## 5. 完整代码

### 5.1 Prisma schema（新增 App 模型 + 关系）

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**

```prisma
// mini-dify（TS 侧）数据模型
// 契约：packages/contract/openapi.yaml（UserResponse 的字段与 role 取值）

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         String   @default("member")
  createdAt    DateTime @default(now()) @map("created_at")

  apps App[]

  @@map("users")
}

model App {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  description String?
  mode        String   @default("chatflow")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId])
  @@map("apps")
}
```

**`model App` 逐字段解释**

| 片段 | 作用 |
| --- | --- |
| `id String @id @default(uuid())` | 主键，默认值由**客户端**生成 UUID（库里**没有** DB 默认值，同 `User.id`） |
| `ownerId String @map("owner_id")` | **外键字段**：存归属用户的 id；`@map` 把驼峰落成蛇形列 `owner_id` |
| `name String` | 应用名（对应契约 `CreateAppRequest.name`，必填、无 DB 默认） |
| `description String?` | 可选描述。`String?` 的 `?` 表示**可空** → 落成 `TEXT NULL`；对应对外视图里的 `description: string \| null`（见 §10） |
| `mode String @default("chatflow")` | 模式，默认 `chatflow`；与契约 `enum: [chatflow, workflow]` 呼应（见 §10.1） |
| `createdAt DateTime @default(now()) @map("created_at")` | 创建时间，库里有 `DEFAULT CURRENT_TIMESTAMP`（同 `User`） |
| `updatedAt DateTime @default(now()) @updatedAt @map("updated_at")` | 更新时间。**`@updatedAt` 是「客户端行为」**；**现已通过迁移补齐 DB 默认值**：新增迁移给该列 `SET DEFAULT now()` 并建 `BEFORE UPDATE` 触发器（见 §11 坑） |
| `owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)` | **关系字段**：声明 `App` 属于一个 `User`，外键是 `ownerId`、指向 `User.id`（见 §6 / §7 / §8） |
| `@@index([ownerId])` | 给外键列**加索引**（见 §9） |
| `@@map("apps")` | 表名映射为小写复数 `apps`（见 §10.2） |

**`model User` 的变化（对比阶段 1）**：只多了一行 `apps App[]`——这是**反向关系**字段（见 §6.3），表示「一个用户拥有多个应用」。它**不产生数据库列**，只是 Prisma 层面的双向导航。

### 5.2 迁移 SQL（Prisma 生成，勿手改）

**完整文件路径：`apps/api-ts/prisma/migrations/20261018082435_add_apps/migration.sql`**

```sql
-- CreateTable
CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'chatflow',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apps_owner_id_idx" ON "apps"("owner_id");

-- AddForeignKey
ALTER TABLE "apps" ADD CONSTRAINT "apps_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**逐句解释**

- 这是 Prisma 从 `schema.prisma` **自动生成**的 SQL（**不要手改**，改了下次迁移会与 schema 对不上）。
- `"owner_id" TEXT NOT NULL`：外键列，`String` → `TEXT`，非空（`ownerId` 未标 `?`，所以必填）。
- `"description" TEXT`：注意**没有 `NOT NULL`**——因为 schema 里写的是 `String?`（可空）。
- `"mode" TEXT NOT NULL DEFAULT 'chatflow'`：对应 `@default("chatflow")`，数据库层**有**默认值。
- `"updated_at" TIMESTAMP(3) NOT NULL`：**注意它没有 `DEFAULT`**——这与 `created_at`（有 `DEFAULT CURRENT_TIMESTAMP`）形成对比。**现已补齐**：后续迁移 (`20261018120000_add_updated_at_default_and_trigger`) 给该列加了 `DEFAULT now()` 与 `BEFORE UPDATE` 触发器（原因见 §11 坑）。
- `CREATE INDEX "apps_owner_id_idx" ON "apps"("owner_id")`：对应 `@@index([ownerId])`（见 §9）。
- `ADD CONSTRAINT ... FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`：对应 `@relation(..., onDelete: Cascade)`。`ON DELETE CASCADE` 是关系删除规则（见 §8）；`ON UPDATE CASCADE` 是 Prisma 对可更新主键默认附带的规则。

---

## 6. 【技术教学 · 首次】关系建模：1:N / 外键 / 反向关系

### 6.1 什么是关系（relationship）

到阶段 1 为止，`users` 是**孤立的**一张表。真实业务里表之间几乎总有联系——「这个应用属于谁」就需要把 `apps` 和 `users` 关联起来。

**关系建模**就是在 schema 里**声明两张表如何关联**。最基本的一种是**一对多（1:N）**：

```
一个 User  ──拥有──▶  多个 App           （1 : N）
一个 App   ──属于──▶  一个 User           （N : 1）

    User(id=u1)
      ├── App(id=a1, owner_id=u1)
      ├── App(id=a2, owner_id=u1)
      └── App(id=a3, owner_id=u1)
```

### 6.2 外键（foreign key）：关系的物理载体

「关系」在关系型数据库里的**物理实现**就是**外键**：`apps` 表里放一列 `owner_id`，它的值必须是 `users` 表里某个已存在的 `id`。

- `apps.owner_id` 是**外键列**（foreign key column）。
- 数据库用**外键约束**保证它只能指向真实存在的用户——插一个不存在的 `owner_id` 会被拒。

于是「多」的那张表（`apps`）拿一列存「它属于谁」，就把 1:N 关系落到了实处。**注意方向**：外键永远在「**多**」的一侧（`apps`），不在「一」的一侧（`users` 里不加 `app_id`）——因为一个用户有多个应用，一列装不下。

### 6.3 反向关系：`User.apps App[]`

Prisma（以及多数 ORM）要求关系**在两侧都声明**：

```prisma
model User {
  apps App[]     // ← 反向关系：一个用户「有」多个 app
}
model App {
  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)  // ← 正向：一个 app「属于」一个 user
}
```

| 字段 | 叫法 | 类型 | 有没有数据库列 |
| --- | --- | --- | --- |
| `App.owner` | **正向关系**（带外键） | `User`（单个） | **有**（由 `ownerId` 承载） |
| `User.apps` | **反向关系** | `App[]`（数组） | **无**（纯 Prisma 概念） |

- `User.apps` 不是列，是**查询时的导航入口**：`prisma.user.findUnique({ where:{id}, include:{ apps: true } })` 能一次把该用户的应用全带出来。
- **反向关系必须与正向配对**：一个 `App.owner` 关系，对应一个 `User.apps` 数组。Prisma 依靠两侧的名字配对来生成查询（若缺一侧，Prisma 会报「关系字段不完整」）。

> 口诀：**外键在「多」侧（有列），反向关系在「一」侧（无列，只用于导航）**。两侧都要写，关系才完整。

---

## 7. 【技术教学 · 首次】`@relation(fields, references)`

### 7.1 语法拆解

`App` 里那行长这样：

```prisma
owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
```

| 部分 | 含义 |
| --- | --- |
| `owner` | **关系字段名**（Prisma 层面的名字，用来 `include` / 导航；不落成列） |
| `User` | 关系**另一端的模型**（这里指向 `User`） |
| `fields: [ownerId]` | **本模型（App）这一侧**用哪个字段做外键 → 即 `App.ownerId` |
| `references: [id]` | **对方模型（User）这一侧**被指向的字段 → 即 `User.id` |
| `onDelete: Cascade` | 删除规则（见 §8） |

一句话：**`fields` 是本表的列，`references` 是对表的列**，两者建立「外键列 → 被引用列」的映射。

### 7.2 为什么要同时写 `fields` 和 `references`

- `fields` 回答「**外键列存在我这边哪一列**」（`App.ownerId`）。
- `references` 回答「**那一列的值指向对方的哪一列**」（`User.id`，通常是主键）。

只写 `fields` 不写 `references`，Prisma 不知道你指的是对方的哪一列（默认是主键 `id`，但显式写出更清楚、也支持指向唯一键）。它们是一对「**从哪来 → 到哪去**」。

### 7.3 和普通字段的关系

- `ownerId String @map("owner_id")` 是**普通标量字段**——它是**真实存在的数据库列** `owner_id`。
- `owner User @relation(...)` 是**关系字段**——它**不落成列**，只是一个「能顺着 `ownerId` 找到对应 `User` 对象」的 Prisma 导航。
- `fields: [ownerId]` 就是在告诉 Prisma：**这个关系字段要靠上面那个标量字段 `ownerId` 来落地**。

> 因此，`ownerId`（列）与 `owner`（关系）是**同一件事的两种视图**：一个是在数据库里存的 id，一个是查出来后能导航到的用户对象。

---

## 8. 【技术教学 · 首次】`onDelete: Cascade` 的语义与风险

### 8.1 是什么

**参照动作（referential action）** 规定：**被引用的那行被删除 / 更新时，引用它的行该怎么办**。`onDelete` 就是「删父行时」的规则。

常见取值：

| 取值 | 删除父行（User）时，子行（App） |
| --- | --- |
| `Cascade` | **跟着一起删**（本项目采用） |
| `Restrict`（默认之一） | **禁止删除父行**（若还有子行引用），报错 |
| `SetNull` | 把子行的外键列**置为 NULL**（要求该列可空） |
| `NoAction` | 默认不做事（交给数据库/约束） |
| `SetDefault` | 置为默认值 |

本项目在 `@relation` 上写 `onDelete: Cascade`：

```prisma
owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
```

生成的 SQL 是：

```sql
... FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ...
```

**语义**：**删掉一个用户，他名下的所有应用会被数据库自动、级联地删掉。**

### 8.2 为什么本项目这么用

- 应用**必然属于**某个用户（`owner_id` 非空），不存在「无主应用」。
- 若用户注销时保留其应用，就会产生**悬挂数据**（外键指向一个已不存在的用户），查询时 `include owner` 得到 null、语义也说不通。
- 教学项目里，级联删除让「用户 → 他的应用」在数据层面保持**始终自洽**，不用额外手写「先删 app 再删 user」的清理逻辑。

### 8.3 风险：它是一把「无提示的连锁删除」

Cascade 的代价是——**删除父行时，子行在你没显式写一句删除代码的情况下就没了**：

| 风险 | 说明 |
| --- | --- |
| **静默的批量删除** | 一条 `DELETE FROM users WHERE id = …` 会连带删光该用户的**所有**应用；业务代码里若只想删用户、误以为应用还在，就会踩坑 |
| **不可逆** | 没有二次确认，数据库层直接执行 |
| **可能跨多层** | 若将来 `App` 又级联到别的表（如阶段后续的会话/消息），删 `User` 会**连锁**删除多层数据 |

> 实践建议：生产环境里对「删用户」这类高危操作，**要么换成软删除（标记 `deleted_at` 而不是真删）**，**要么在业务层加确认 / 审计**。Cascade 本身没问题，问题是它**发生在数据库层、绕过了应用逻辑**——使用前要清楚「删这一行会连带删掉什么」。

一句话：**Cascade 让删除「自动保持一致」，但也让删除「影响面超出你的这行代码」**——用它是用「省事」换「可预测性下降」。

---

## 9. 【技术教学 · 首次】`@@index([ownerId])`：外键为什么必须加索引

### 9.1 是什么

`@@index([ownerId])` 给 `owner_id` 列建一个**普通索引**（B-tree）。生成的 SQL：

```sql
CREATE INDEX "apps_owner_id_idx" ON "apps"("owner_id");
```

### 9.2 为什么外键列要索引：外键约束本身**不会**自动建索引

这是最容易被忽略的一点——**在 PostgreSQL 里，声明外键约束并不会自动在被引用侧 / 引用侧建索引**（不像主键、唯一约束那样自带索引）。于是外键列默认是**无索引**的。

没有索引会导致两类高频查询变慢：

**① 「查某用户的所有应用」（列表接口的最常见查询）**

```sql
SELECT * FROM apps WHERE owner_id = 'u1';
```

- 无索引 → 全表扫描（`Seq Scan`），逐行比对 `owner_id`。应用越多越慢。
- 有索引 → `Index Scan`，直接定位到 `owner_id = 'u1'` 的行，数据量增大时几乎是常数级。

**② 删除用户时的级联检查（对应 §8 的 Cascade）**

当你删一个 `users` 行时，数据库要**反查 `apps` 里有没有引用它的行**，以便执行 `ON DELETE CASCADE`：

```sql
-- 删 user 时，数据库内部大致需要
SELECT ... FROM apps WHERE owner_id = 'u1';   -- 找出要级联删除的子行
```

- 无索引 → 每次删用户都要**全表扫 `apps`** 来找引用行。
- 有索引 → 走索引快速定位。

所以：**凡是做外键的列，几乎都该建索引**——既服务「按外键过滤」的读，也服务「级联删除 / 完整性检查」的写。

### 9.3 为什么不用 `@unique` 而用 `@@index`

- `ownerId` **不能**加唯一约束——一个用户可以有**多个**应用，`owner_id` 是**故意重复**的（这正是 1:N 的表现）。
- 所以只能加**普通（非唯一）索引**，Prisma 里就是 `@@index([ownerId])`（`@@` 修饰模型、`[]` 里列列名）。

> 口诀：**外键列 = 高频过滤列 + 级联检查列 → 建普通索引**（`@@index`），而不是唯一索引。

---

## 10. 【技术教学 · 首次】`@default("chatflow")` 与 `@@map("apps")`

### 10.1 `@default("chatflow")`：字段默认值

```prisma
mode String @default("chatflow")
```

- 含义：新建 `App` 时若**没给 `mode`**，默认取 `"chatflow"`。
- 落库形态（见 §5.2）：数据库列带上 `DEFAULT 'chatflow'`——**这是数据库层的默认值**（与 `@updatedAt` 不同，见 §11）。

**为什么是数据库默认而不是仅应用默认**：它保证**任何写入路径**（Prisma、Python 侧 SQLAlchemy、手工 SQL）都不给 `mode` 时，库里都会落到 `chatflow`，行为一致。这也与契约呼应——`CreateAppRequest.mode` 是**可选**的（`mode?: 'chatflow' | 'workflow'`，见 `02-应用管理/01-契约扩展.md`），不传时后端要能给出一个合理默认。

> 对比 `String?` 的 `description`（可空、无默认）：它允许表达「**没有描述**」这件事（落库为 `NULL`，对外序列化为 `null`）；而 `mode` 必须始终有一个值，所以给默认而非允许空。

### 10.2 `@@map("apps")`：表名映射

```prisma
model App {
  ...
  @@map("apps")
}
```

- **模型名 `App`（PascalCase）↔ 表名 `apps`（小写复数蛇形）**。
- 若**不写** `@@map`，Prisma 会用模型名 `App` 当表名（大小写敏感，在 PostgreSQL 里会被双引号成 `"App"`）——这通常不符合「小写复数」的数据库惯例。
- 同理 `@map("owner_id")` / `@map("created_at")` / `@map("updated_at")` 是**列名**级映射：**TS 字段驼峰 ↔ DB 列蛇形**（机制见 `01-账号与认证/02-Prisma.md` §5.1）。

> 口诀：**`@map` 管列名、`@@map` 管表名**；Prisma 用**驼峰**（贴 TS），数据库用**小写复数 / 蛇形**（贴 PostgreSQL），`@map` / `@@map` 是两者之间的桥。

---

## 11. 建表并验证

### 11.1 应用迁移（建表）

**命令（在仓库根执行）**

```bash
pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_apps
```

> 也可用便捷脚本 `pnpm --filter @mini-dify/api-ts db:migrate`（不带名称，会**交互式询问**迁移名，届时输入 `add_apps`）。

**目的**：从 `schema.prisma` 生成 `20261018082435_add_apps/migration.sql` 并应用到 `minidify` 库，然后自动 `generate`。

**预期输出（关键行）**

```
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "minidify", schema "public" at "localhost:5432"
Applying migration `20261018082435_add_apps`
The following migration(s) have been created and applied from new schema changes:
migrations/
  └─ 20261018082435_add_apps/
    └─ migration.sql
Your database is now in sync with your schema.
Generated Prisma Client ...
```

> 前置：`docker compose ps` 显示 `mini-dify-db` 为 `(healthy)`。数据库没起会报连接失败。

### 11.2 数据库侧自证（psql）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"
```

**预期输出（实测）**

```
                                   Table "public.apps"
   Column    |              Type              | Collation | Nullable |      Default
-------------+--------------------------------+-----------+----------+-------------------
 id          | text                           |           | not null |
 owner_id    | text                           |           | not null |
 name        | text                           |           | not null |
 description | text                           |           |          |
 mode        | text                           |           | not null | 'chatflow'::text
 created_at  | timestamp(3) without time zone |           | not null | CURRENT_TIMESTAMP
 updated_at  | timestamp(3) without time zone |           | not null |
Indexes:
    "apps_pkey" PRIMARY KEY, btree (id)
    "apps_owner_id_idx" btree (owner_id)
Foreign-key constraints:
    "apps_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
```

**看四样**：

1. **列名是蛇形**（`owner_id` / `created_at` / `updated_at`）——`@map` 的结果。
2. **`description` 可空**（Nullable 列为空）、**`mode` 有默认 `'chatflow'`**。
3. **索引有两条**：`apps_pkey`（主键）+ `apps_owner_id_idx`（`@@index([ownerId])`）。
4. **外键**：`apps_owner_id_fkey → users(id) ON UPDATE CASCADE ON DELETE CASCADE`——即 §8 的 `onDelete: Cascade`。

> 注意 `updated_at` 一列**原先没有 Default**（对比 `created_at` 有 `CURRENT_TIMESTAMP`）——**现已由迁移补齐 `DEFAULT now()` + `BEFORE UPDATE` 触发器**，见下方「常见坑」。

### 11.3 生成 Client 并确认可用

单独生成（可选，`migrate dev` 已顺带做过）：

```bash
pnpm --filter @mini-dify/api-ts db:generate
```

**预期输出**：`Generated Prisma Client (v6.x.x) to ...\node_modules\.prisma\client`

**验证 NestJS 能编译**：

```bash
pnpm --filter @mini-dify/api-ts build
```

**预期**：编译通过，产出 `apps/api-ts/dist/`。

---

## 12. 验收自测

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 迁移已生成并应用 | `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_apps` | `Your database is now in sync with your schema.` |
| 迁移与库同步 | `pnpm --filter @mini-dify/api-ts exec prisma migrate status` | 显示所有迁移已应用、无待应用项 |
| 表结构正确 | `docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"` | 7 列 + `apps_pkey` + `apps_owner_id_idx` + `apps_owner_id_fkey`(ON DELETE CASCADE) + `updated_at` 默认 `now()` + 触发器 `apps_set_updated_at` |
| 关系在 schema 里成对 | 阅读 `schema.prisma` | `User.apps App[]` 与 `App.owner User @relation(...)` 两侧齐全 |
| Client 已生成 | `pnpm --filter @mini-dify/api-ts db:generate` | `Generated Prisma Client` |
| 应用可编译 | `pnpm --filter @mini-dify/api-ts build` | 通过（新增 `App` 类型解析成功） |
| 迁移文件入库 | `git status apps/api-ts/prisma/migrations` | `20261018082435_add_apps/` 应被提交 |

> 「能建表」只是第一步；真正的读写（`prisma.app.findMany({ where:{ ownerId } })` / `create` / `update` / `delete`）在后续的 NestJS / FastAPI 应用 CRUD 篇里使用。

---

## 13. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **`updatedAt` 在库里没有默认值**（已收口） | 旧版 `\d apps` 里 `updated_at` 一列**无 Default**；直接用 SQL `INSERT` 不写它就会违反非空约束 | `@updatedAt` 是 **Prisma Client 的客户端行为**（Prisma 写库时自己填时间），它**不会**在数据库列上生成 `DEFAULT`。**已收口**：新增迁移 `20261018120000_add_updated_at_default_and_trigger` 给该列加 `SET DEFAULT now()` 并建 `BEFORE UPDATE` 触发器（覆盖手工 SQL）；`schema.prisma` 的 `updatedAt` 也补了 `@default(now())`；SQLAlchemy 侧保留 `onupdate` 作为**兜底**（DB 触发器为权威）。实测：手工 `INSERT`/`UPDATE` 均正常刷新 |
| 反向关系只写一侧 | Prisma 校验报「关系字段不完整 / missing opposite relation field」 | 关系**两侧都要声明**：`App.owner`（正向，带外键）+ `User.apps`（反向，数组），缺一不可 |
| `@relation` 少写 `fields` / `references` | `validate` 报错或建出错误的外键 | 正向关系字段必须给 `fields: [本表外键列]` 与 `references: [对方被引用列]` |
| 外键列漏了索引 | 按 `owner_id` 查询 / 删除用户级联时全表扫描、变慢 | 外键约束**不自动建索引**，需 `@@index([ownerId])`（Postgres 系统目录自查：`\di` 看不到 `apps_owner_id_idx` 就是漏了） |
| 给 `ownerId` 加 `@unique` | 一个用户只能建一个应用，违背 1:N | `ownerId` 是 **1:N 的「多」侧**，必须可重复；用 `@@index`（普通索引）而非 `@unique` |
| 误删用户导致应用被连带删除 | 只想删 `users` 一行，结果 `apps` 里该用户的所有行也没了 | 这是 `onDelete: Cascade` 的**预期语义**（§8）。若不符合预期，应改 `Restrict` / `SetNull`（需先把 `ownerId` 改为可空）或改软删除 |
| 用了 `@@map` 与否看不懂列名 | 库里表名叫 `App` 而非 `apps`、列名是驼峰 | Prisma 默认用模型/字段名当表/列名；要小写复数蛇形必须显式写 `@@map("apps")` / `@map("owner_id")` |
| 手改 `migration.sql` | 之后迁移与 schema 对不上 / 报 drift | 迁移文件是 Prisma 生成的，**不要手改**；要改结构就改 `schema.prisma` 再生成新迁移 |
| 改了 schema 却没 `generate` | `prisma.app.xxx` 的类型对不上 | 新模型要先 `migrate dev`（自动 generate）或单独 `db:generate`，再让编辑器重新加载 |

---

## 14. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| 关系建模（一对多 / 1:N）：外键在「多」侧、反向关系在「一」侧、两侧必须成对声明 | **首次教学于本篇** |
| `@relation(fields, references)`：`fields` = 本表外键列、`references` = 对方被引用列 | **首次教学于本篇** |
| `onDelete: Cascade` 的语义（删父连带删子）与风险（数据库层静默连锁删除、影响面超出应用代码） | **首次教学于本篇** |
| `@@index([ownerId])`：外键约束不自动建索引 → 外键列要建普通索引（服务按外键过滤 + 级联检查） | **首次教学于本篇** |
| `@default("chatflow")`：字段默认值（落成数据库 `DEFAULT`），与可空字段 `String?` 的取舍 | **首次教学于本篇** |
| 数据库触发器保证 `updated_at`（`SET DEFAULT now()` + `BEFORE UPDATE` 触发器，替代纯客户端 `@updatedAt` 赋值） | **首次教学于本篇** |
| `@@map("apps")`：表名映射（模型名 `App` ↔ 表名 `apps`） | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：ORM / schema-first / Prisma 三件套 / 迁移（DDL 版本化）/ Prisma DSL 基础（`model` / `@id` / `@default` / `@map` / `@@map`）/ `DATABASE_URL` 的 Prisma 写法 / 迁移所有权，见 `01-账号与认证/02-Prisma.md`；`pnpm --filter` / `allowBuilds` 见 `00-项目初始化/03-monorepo与pnpm-workspace.md`；`.env` 与连接串见 `00-项目初始化/02-本地中间件Docker.md`。
