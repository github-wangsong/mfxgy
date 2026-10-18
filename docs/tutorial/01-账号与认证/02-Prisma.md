# 02 · Prisma：schema → migrate → Client

> 所属：阶段 1 · 账号与认证
> 本篇覆盖：写 `schema.prisma` 定义 `User` 模型 → 用 Prisma Migrate 建出 `users` 表（含 SQL 迁移文件）→ 生成 Prisma Client → 包成 NestJS 的 `PrismaService` / `PrismaModule`
> **本篇首次教学：ORM（对象关系映射）是什么、schema-first 与 code-first 的区别、Prisma 三件套（schema / migrate / client）、数据库迁移（DDL 版本化）的意义、`DATABASE_URL` 的 Prisma 写法、NestJS 生命周期钩子（`OnModuleInit` / `OnModuleDestroy`）与 `@Global()` 模块**
> （`@Injectable` / `@Module` / 依赖注入等装饰器基础见 `00-项目初始化/05-NestJS起步.md`，本篇只引用不重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 1. 本篇目标

- 用 **Prisma** 在本机 PostgreSQL（容器里）建出 **`users`** 表。
- 走一遍 Prisma 的标准流程：**写 schema → 迁移建表 → 生成 Client → 用 Client 读写**。
- 理解 **ORM**、**schema-first vs code-first**、**迁移（migration）的意义**。
- 把 Prisma Client 包成 NestJS 的 `PrismaService`（随应用生命周期连 / 断）并做成全局模块。

**验收标准**

1. `prisma migrate dev --name init_users` 执行成功，生成 `20261018013644_init_users/migration.sql` 并应用到数据库。
2. 用 `psql` 能查到 `users` 表，字段为 `id / email / password_hash / role / created_at`，`email` 有唯一索引。
3. `@prisma/client` 里生成了 `PrismaClient`，`apps/api-ts` 编译通过。

**迁移所有权约定（项目规则，务必记住）**

| 表 | DDL 所有权 | 说明 |
| --- | --- | --- |
| 平台主表（`users`、后续 `apps` 等） | **TS 侧 Prisma**（`apps/api-ts/prisma/migrations`） | Python 侧只用 SQLAlchemy **映射**同一张表，**不产生 DDL** |
| Python 专属表（如阶段 11 的 Agent Run 存储） | **Python 侧 Alembic** | 等真有归属 Python 的表时再引入 Alembic |

两套后端**共用一个 PostgreSQL**。若一个表的 DDL 由两套迁移系统同时管理，必然互相踩脚。所以本阶段就定下：**`users` 表的建表权归 Prisma，Python 只读写不建表**（Python 侧模型见 `apps/api-py/app/models/user.py` 与其注释）。

---

## 2. 前置条件

- 阶段 1 · 01（契约扩展）已完成。
- 阶段 0 · 02：**PostgreSQL 容器已 `(healthy)`**，端口 `5432` 已映射，库 `minidify` 已建（`docker-compose.yml`）。
- `apps/api-ts` 已装依赖（`@prisma/client`、`prisma` 在 `package.json` 里）。
- `pnpm install` 已执行过。

> 若容器没起：`docker compose up -d db`，等 `docker compose ps` 显示 `(healthy)` 再继续。

---

## 3. 先看清要做什么

Prisma 是「**schema 驱动**」的工具链，三个阶段一条线：

```
① 写 schema.prisma         → ② prisma migrate dev     → ③ prisma generate
   （声明 User 模型）           （生成 SQL 并建表）            （生成类型安全的 Client）
        │                          │                              │
   apps/api-ts/prisma/        migrations/…init_users/       node_modules/.prisma/client
   schema.prisma              migration.sql                 （可 import { PrismaClient }）
```

建表这一步的产物，就是一份**可入库、可回放**的 SQL 文件（`migration.sql`）：

```sql
CREATE TABLE "users" ( ... );
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

随后 NestJS 侧不再直接 `new PrismaClient()`，而是包一层 `PrismaService`（继承 `PrismaClient`，随应用启停连接 / 断开），并用 `@Global()` 的 `PrismaModule` 提供给全应用注入（`PrismaService` 是 `AuthService` 之后的依赖）。

---

## 4. 命令清单（逐条说明）

> Prisma CLI 需要在**有 `prisma/schema.prisma` 与 `.env` 的目录**执行。本项目的模型与环境文件都在 `apps/api-ts/` 下，所以用 `pnpm --filter @mini-dify/api-ts` 把命令**切到该包目录**执行（`pnpm --filter` 的机制见 `00-项目初始化/03-monorepo与pnpm-workspace.md`）。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name init_users` | 仓库根 | 读 `prisma/schema.prisma`，生成迁移 SQL 并**应用到数据库**；顺带自动 `generate` | 打印 `Applying migration '20261018013644_init_users'`、`Your database is now in sync with your schema.` |
| `pnpm --filter @mini-dify/api-ts exec prisma generate` | 仓库根 | 单独重新生成 Prisma Client（改了 schema 但不想建表时用） | 打印 `Generated Prisma Client` |
| `pnpm --filter @mini-dify/api-ts exec prisma migrate status` | 仓库根 | 查看迁移是否与数据库同步（排障用） | 打印已应用 / 待应用迁移列表 |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "\d users"` | 任意目录 | 数据库侧自证「表真的建了、字段对」 | 打印 `users` 表结构（列 + 索引 + 约束） |

> 第 1 条中的 `--name init_users` 会**固定迁移目录名的一部分**，最终目录是 `<时间戳>_init_users`（本项目实测为 `20261018013644_init_users`）。时间戳由 Prisma 生成，用于排序，**同一台机器上不同次迁移不会重名**。

---

## 5. 完整代码

### 5.1 Prisma schema（数据模型）

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

  @@map("users")
}
```

**逐段解释**

| 片段 | 作用 |
| --- | --- |
| `generator client { provider = "prisma-client-js" }` | 声明要生成 **JS/TS 版** Prisma Client（产物可被 NestJS `import`） |
| `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` | 声明数据源是 PostgreSQL，连接串从**环境变量** `DATABASE_URL` 读（§7.4） |
| `model User { ... }` | 一个**模型**（= 一张表）。类名 `User` 会自动映射成表名，但这里用 `@@map("users")` 显式指定为**小写复数** `users` |
| `@id @default(uuid())` | `id` 是主键，默认值由**客户端**生成 UUID（注意：数据库里**没有**默认值，见 §10 坑） |
| `@unique` | `email` 加唯一约束 → 数据库层禁止重复邮箱（对应 409 冲突） |
| `@map("password_hash")` | TS 字段名 `passwordHash`（驼峰）↔ 数据库列名 `password_hash`（蛇形） |
| `@default("member")` | `role` 默认 `member`，与契约 `enum: [admin, member]` 呼应 |
| `DateTime @default(now()) @map("created_at")` | `createdAt` 默认当前时间；列名映射为 `created_at` |

> **命名映射是重点**：Prisma schema 用**驼峰**（贴合 TS），数据库用**蛇形**（贴合 PostgreSQL 惯例）。`@map` / `@@map` 就是这两套命名之间的桥。契约 `UserResponse` 对外输出的是**驼峰** `createdAt`，所以在 Service 层要把数据库值映射回契约形状。

### 5.2 迁移 SQL（Prisma 生成，勿手改）

**完整文件路径：`apps/api-ts/prisma/migrations/20261018013644_init_users/migration.sql`**

```sql
-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

**逐句解释**

- 这是 Prisma 从 `schema.prisma` **自动生成**的 SQL（**不要手改**，改了下次迁移会对不上）。
- `TEXT` 类型：Prisma 的 `String` 在 PostgreSQL 上默认落成 `TEXT`（而非 `varchar(n)`）。
- `password_hash` / `created_at` / `users` 这几个名字，就是 §5.1 里 `@map` / `@@map` 的结果。
- `TIMESTAMP(3)`：不带时区的 `timestamp`，精度到毫秒（`DateTime` 在本项目的落库形态）。
- `DEFAULT CURRENT_TIMESTAMP`：对应 `@default(now())`。
- `CREATE UNIQUE INDEX "users_email_key"`：对应 `@unique`。

### 5.3 迁移锁文件（migration_lock.toml）

**完整文件路径：`apps/api-ts/prisma/migrations/migration_lock.toml`**

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

**说明**：Prisma Migrate 用它**锁定数据源 provider**。若误切到别的数据库（如 MySQL），Prisma 会报错要求重新确认。它**应当提交到 Git**（连同 `migrations/` 一起，这是迁移可回放的前提）。

### 5.4 NestJS 包装：PrismaService

**完整文件路径：`apps/api-ts/src/prisma/prisma.service.ts`**

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/** Prisma 客户端的 NestJS 包装：随应用生命周期连接 / 断开。 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
```

**要点**

- `extends PrismaClient`：**继承**生成的 Client，于是 `this.user.findMany(...)` 等全部可用。
- `@Injectable()`：让它能被 Nest 依赖注入（装饰器见 `00-项目初始化/05-NestJS起步.md`）。
- `implements OnModuleInit / OnModuleDestroy`：实现 NestJS 的**生命周期钩子接口**（§8）。
- `$connect()` / `$disconnect()`：Prisma 提供的连接管理方法，前缀 `$` 表示「客户端级操作」。

### 5.5 NestJS 包装：PrismaModule（全局模块）

**完整文件路径：`apps/api-ts/src/prisma/prisma.module.ts`**

```ts
import { Global, Module } from '@nestjs/common'

import { PrismaService } from './prisma.service'

/** 全局 Prisma 模块：其他模块无需重复 import 即可注入 `PrismaService`。 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**要点**

- `providers: [PrismaService]`：登记为可注入的 Provider。
- `exports: [PrismaService]`：**对外暴露**，别的模块才能注入到它。
- `@Global()`：把该模块标为**全局模块**——其它模块不需要在自己的 `imports` 里写 `PrismaModule` 就能注入 `PrismaService`（§8.3）。
- 它已登记在根模块 `AppModule.imports` 里（见 `00-项目初始化/05-NestJS起步.md` §5.6）。

### 5.6 环境文件（apps/api-ts/.env）

**完整文件路径：`apps/api-ts/.env`**

```bash
# api-ts 本地环境（Prisma CLI 与运行时都会读取本目录的 .env）
# 注意：Prisma 使用 postgresql:// 方案，不带 SQLAlchemy 的 +driver 后缀
DATABASE_URL="postgresql://postgres:difyai123456@localhost:5432/minidify"
# 与 apps/api-py/.env 同值：双方签发的 JWT 才能互认
JWT_SECRET="dev-jwt-secret-change-me-please"
# 令牌有效期（秒）；两端读同一个键
JWT_EXPIRES_IN=3600
PORT=3001
```

**要点**

- Prisma CLI **读取当前目录的 `.env`**（无第三方 dotenv 也自带），运行时由 `main.ts` 的 `import 'dotenv/config'` 兜底（见 `00-项目初始化/05-NestJS起步.md` §5.5）。
- `DATABASE_URL` 用的 `postgresql://` 是 **Prisma 的方案写法**；注意与本文其它文件里 SQLAlchemy 的 `postgresql+psycopg://` 写法**不同**（§7.4 / §10 坑）。
- **每个 app 自包含自己的 `.env`**：TS 侧 `apps/api-ts/.env`、Python 侧 `apps/api-py/.env`；仓库根 `.env` **只留基础设施变量**（`POSTGRES_*`，供 `docker-compose.yml` 变量替换）。于是从哪个目录启动都各读各的那份，不会读到另一种语言的连接串——原「根 `.env` 的 `DATABASE_URL` 是 Python 格式、Prisma 不认」的坑就此消除。
- `JWT_SECRET` / `JWT_EXPIRES_IN` / `PORT` 是阶段 1 · 03 / 06 用的，此处一并声明；本阶段的 Prisma 迁移只需 `DATABASE_URL`。

### 5.7 依赖与脚本（api-ts package.json）

**完整文件路径：`apps/api-ts/package.json`**

```json
{
  "name": "@mini-dify/api-ts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@mini-dify/contract": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@prisma/client": "^6.0.0",
    "bcryptjs": "^2.4.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "dotenv": "^16.4.5",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "prisma": "^6.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.0"
  }
}
```

**与 Prisma 相关的两个依赖**

- `@prisma/client`（运行时）：**生成后的 Client 真正依赖它**——`prisma generate` 把代码写进它的目录，应用中 `import { PrismaClient } from '@prisma/client'`。
- `prisma`（开发时）：CLI 本体（`migrate` / `generate` / `studio` 等命令），放 `devDependencies` 即可。

**便捷脚本**：`db:migrate` / `db:generate` / `db:studio` 是 `prisma` CLI 的薄封装。在仓库根执行 `pnpm --filter @mini-dify/api-ts db:migrate` 即可（`pnpm --filter` 会把工作目录切到该包，`prisma` 于是在正确目录读到 `schema.prisma` 与 `.env`）；根 `package.json` 也放了同名代理脚本（如 `pnpm db:migrate`），二者等价。

### 5.8 pnpm workspace 的构建放行（pnpm-workspace.yaml）

**完整文件路径：`pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*

# pnpm 12 默认拦截依赖的构建脚本；Prisma 需要允许（用于生成引擎与 Client）。
allowBuilds:
  '@prisma/client': true
  '@prisma/engines': true
  prisma: true
```

**说明**：pnpm 12 出于安全默认**拦截依赖的 postinstall 构建脚本**。Prisma 的安装过程需要跑构建脚本（下载 / 生成查询引擎），不放行就会在 `pnpm install` 时报 `ERR_PNPM_IGNORED_BUILDS`（详见 §10）。`allowBuilds` 里列出的三个包就是来放行 Prisma 的。

---

## 6. 【技术教学 · 首次】ORM：是什么、schema-first vs code-first

### 6.1 是什么

**ORM（Object-Relational Mapping，对象关系映射）** 是一层「翻译」：让你用**编程语言里的对象/类**来操作**关系型数据库里的表和行**，而不用手写 SQL。

```ts
// 直接写 SQL（不用 ORM）
const rows = await db.query('SELECT * FROM users WHERE email = $1', [email])

// 用 ORM（Prisma）
const user = await prisma.user.findUnique({ where: { email } })
```

两者等价，但 ORM 换来的是：**类型安全**（背后是 TS 类型，编译期就知道 `user.email` 是什么）、**可组合**（查询是对象，能拼装）、**跨库可迁移**（SQL 由 ORM 生成）。

### 6.2 两派做法：code-first vs schema-first

「模型/表怎么定义」是 ORM 的核心分歧：

| 流派 | 定义哪边是**真源** | 典型工具 | 本项目 |
| --- | --- | --- | --- |
| **code-first** | 先写**代码里的类**，再由它推导 / 生成表 | SQLAlchemy、TypeORM、Django ORM | **Python 侧**用 SQLAlchemy（但只映射、不建表） |
| **schema-first** | 先写**独立的 schema 文件**，再由它生成代码与 SQL | **Prisma** | **TS 侧**用 Prisma |

**Prisma 就是 schema-first**：你先在 `schema.prisma` 里描述模型，Prisma 再据此生成（①）数据库迁移 SQL 与（②）类型安全的 Client 代码。

> 这也是本项目「同一张表、两种语言」能并存的原因：TS 侧 schema-first 拥有 DDL，Python 侧 code-first **仅映射**（`__tablename__ = "users"`）——两边看的是同一张表。

### 6.3 本例为什么这么用

`schema.prisma` 一份文件同时承担两件事：**数据模型的真源** + **迁移与 Client 的输入**。于是「表结构」只存在一份，不会出现「代码里一个样、数据库里另一个样」。

---

## 7. 【技术教学 · 首次】Prisma 三件套 + 迁移 + DATABASE_URL

### 7.1 Prisma 三件套

| 组件 | 是什么 | 本项目对应物 |
| --- | --- | --- |
| **Prisma Schema** | 用 DSL 描述的数据模型与数据源配置 | `apps/api-ts/prisma/schema.prisma` |
| **Prisma Migrate** | 迁移工具：从 schema 生成 SQL、并把 SQL 应用到数据库 | `pnpm ... exec prisma migrate dev` |
| **Prisma Client** | 生成的**类型安全查询客户端**（`new PrismaClient()` 后用） | `@prisma/client`（由 `prisma generate` 写入） |

流程记住这条链：**改 schema → `migrate`（建表）→ `generate`（出 Client）→ 应用里 `new PrismaClient()` 查询**。

> `prisma migrate dev` 会在末尾**自动跑 `generate`**，所以平时只需一条命令；只有「改了 schema 但不想动数据库」时才单独 `prisma generate`（本项目 `migrate dev` 已顺带生成）。

### 7.2 迁移（migration）的意义：把 DDL 版本化

数据库的「表结构」叫 **DDL**（Data Definition Language，如 `CREATE TABLE` / `CREATE INDEX`）。问题是：**DDL 的状态会随时间变化**，若只靠「手工在数据库里敲一遍」，就没人说得清「线上这份库到底是哪一版」。

**迁移（migration）** 就是给 DDL 建一套**版本化、可回放的清单**：

```
migrations/
├── migration_lock.toml                       # provider 锁
├── 20261018013644_init_users/                # 第 1 次迁移（时间戳 + 名字）
│   └── migration.sql                         #   这次要执行的 DDL
└── 20260901......_add_app_table/             # 第 2 次迁移（将来）
    └── migration.sql
```

好处：

1. **可追溯**：每次表结构变更都对应一个目录 + 一份 SQL，进 Git，能 diff。
2. **可回放**：换一台机器 / 新环境，按顺序应用迁移即可得到**同样的表结构**（Prisma 记录已应用到哪个迁移）。
3. **多人协作不打架**：谁改了 schema，谁就带一份新迁移进来。

**`migrate dev` 做了什么**：比对 `schema.prisma` 与数据库现状 → 若 schema 有变化，生成一份新的 `migration.sql`、**立即对本地库执行**、并把该迁移标记为已应用。`--name init_users` 只是给这次迁移起个可读名字。

> 与「手工建表」的区别：手工建表**只改了数据库**，schema 文件没变，两边失同步；迁移则保证「schema 文件 ↔ 数据库」始终对得上。

### 7.3 Prisma 的 DSL 语法（对照 §5.1）

```prisma
model User {                        # model = 表；块内每行 = 列
  id    String @id @default(uuid()) # 类型 String；@id 主键；@default 默认值
  email String @unique              # @unique 唯一约束
  role  String @default("member")   # 默认值写字符串字面量
  createdAt DateTime @map("created_at")  # @map：TS 名 → DB 列名
  @@map("users")                    # @@map：模型名 → 表名
}
```

- 字段语法：`名字 类型 @属性 @属性 ...`。
- `@` 修饰**列**（`@id` / `@unique` / `@default` / `@map`），`@@` 修饰**整个模型**（`@@map`）。
- 类型：`String` / `Int` / `Boolean` / `DateTime` 等，Prisma 会翻译成对应数据库类型。

### 7.4 `DATABASE_URL`：Prisma 的 `postgresql://` 写法

Prisma 的连接串是**标准 URL，不带「驱动后缀」**：

```
postgresql://postgres:difyai123456@localhost:5432/minidify
└────┬───┘   └──┬──┘ └────┬────┘ └──┬──┘ └┬┘ └──┬───┘
  scheme      用户名      密码      主机   端口   库名
```

对比 SQLAlchemy（Python 侧，见 `00-项目初始化/02-本地中间件Docker.md`）：

| 侧 | 写法 | 差异 |
| --- | --- | --- |
| **Prisma（TS）** | `postgresql://postgres:...@localhost:5432/minidify` | 无 `+driver` 后缀 |
| SQLAlchemy（Python） | `postgresql+psycopg://postgres:...@localhost:5432/minidify` | 带 `+psycopg` 指定驱动 |

**为什么不同**：Prisma 自带查询引擎与数据库驱动，不需要你指定；SQLAlchemy 需要你显式选驱动（这里是 psycopg v3）。所以两套后端**各用各的 `.env`**：TS 侧 `apps/api-ts/.env`，Python 侧 `apps/api-py/.env`（每个 app 自包含，与启动 cwd 无关；根 `.env` 只留 `POSTGRES_*` 基础设施变量）。

> 注意 Prisma URL 里的 `postgresql://` 在语法上是**不含密码特殊字符的明文**；学习场景直接写即可。`env("DATABASE_URL")` 表示该值来自环境（Prisma 会读 `apps/api-ts/.env`）。

---

## 8. 【技术教学 · 首次】NestJS 生命周期钩子 与 `@Global()`

### 8.1 生命周期钩子（`OnModuleInit` / `OnModuleDestroy`）

NestJS 在应用启动 / 关闭时会**按顺序调用**一组约定方法，这就是**生命周期钩子**。要使用它们，类 **implements 对应的接口**（接口名让 TS 编译期提示你要实现的方法名）。

本项目用到两个：

| 接口 | 方法 | 触发时机 | 本项目做什么 |
| --- | --- | --- | --- |
| `OnModuleInit` | `onModuleInit()` | 模块**初始化**时（应用启动） | `await this.$connect()` 连接数据库 |
| `OnModuleDestroy` | `onModuleDestroy()` | 模块**销毁**时（应用关闭） | `await this.$disconnect()` 断开连接 |

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect() }
  async onModuleDestroy() { await this.$disconnect() }
}
```

**为什么这么做**：Prisma Client 的连接是**惰性**的（第一次查询才连）。显式在启动时 `$connect()` 有两个好处：①早暴露连接错误（启动即报，而不是首个请求时才炸）；②优雅关闭时 `$disconnect()` 释放连接，避免连接泄漏。

> Nest 生命周期钩子有很多（还有 `onApplicationBootstrap` / `beforeApplicationShutdown` 等）；本项目按需只用这两个。

### 8.2 `@Global()`：全局模块

普通模块要「能用」，别的模块必须在自己的 `imports` 里显式引入它。`@Global()` 打破这条规则：

```ts
@Global()                     // 标为全局模块
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

标为全局后，**任何模块**都可以直接注入 `PrismaService`，不必逐个 `imports`。**为什么用它**：数据库访问是**横切关注点**——`AuthService`、之后各业务 Service 都要用，逐个 import 会很啰嗦。这样全应用**只连一个数据库连接池**。

> 注意：`@Global()` 只让「**Provider 可被注入**」，不等于「**模块被自动加载**」。`PrismaModule` 仍需登记在根模块 `AppModule.imports` 里（见 `00-项目初始化/05-NestJS起步.md` §5.6）。

---

## 9. 建表并验证

### 9.1 应用迁移（建表）

**命令（在仓库根执行）**

```bash
pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name init_users
```

**目的**：从 `schema.prisma` 生成 `20261018013644_init_users/migration.sql` 并应用到 `minidify` 库，然后自动 `generate`。

**预期输出（关键行）**

```
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "minidify", schema "public" at "localhost:5432"
Applying migration `20261018013644_init_users`
The following migration(s) have been created and applied from new schema changes:
migrations/
  └─ 20261018013644_init_users/
    └─ migration.sql
Your database is now in sync with your schema.
Generated Prisma Client ...
```

> 前置：`docker compose ps` 显示 `mini-dify-db` 为 `(healthy)`。数据库没起会报连接失败。

### 9.2 数据库侧自证（psql）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d users"
```

**预期输出（结构摘要）**

```
                Table "public.users"
    Column     |            Type             | Nullable | Default
---------------+-----------------------------+----------+---------
 id            | text                        | not null |
 email         | text                        | not null |
 password_hash | text                        | not null |
 role          | text                        | not null | 'member'::text
 created_at    | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "users_email_key" UNIQUE CONSTRAINT, btree (email)
```

看三样：列名是**蛇形**（`password_hash` / `created_at`）、`email` 有 **UNIQUE**、`id` 无数据库默认（由客户端生成）。

### 9.3 生成 Client 并确认可用

单独生成（可选，`migrate dev` 已顺带做过）：

```bash
pnpm --filter @mini-dify/api-ts exec prisma generate
```

**预期输出**：`Generated Prisma Client (v6.x.x) to ...\node_modules\.prisma\client`

**验证 NestJS 能编译**（`PrismaService` 能 `extends PrismaClient`）：

```bash
pnpm --filter @mini-dify/api-ts build
```

**预期**：编译通过，产出 `apps/api-ts/dist/`。

---

## 10. 验收自测

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 迁移已生成并应用 | `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name init_users` | `Your database is now in sync with your schema.` |
| 迁移与库同步 | `pnpm --filter @mini-dify/api-ts exec prisma migrate status` | 显示所有迁移已应用、无待应用项 |
| 表结构正确 | `docker exec mini-dify-db psql -U postgres -d minidify -c "\d users"` | 5 列 + `users_pkey` + `users_email_key`(UNIQUE) |
| Client 已生成 | `pnpm --filter @mini-dify/api-ts exec prisma generate` | `Generated Prisma Client` |
| 应用可编译 | `pnpm --filter @mini-dify/api-ts build` | 通过（`extends PrismaClient` 解析成功） |
| 迁移文件入库 | `git status apps/api-ts/prisma/migrations` | `migrations/` 与 `migration_lock.toml` 应被提交 |

> 「能建表」只是第一步；真正的读写（`prisma.user.findUnique` / `create`）在 `03-NestJS 认证` 里由 `AuthService` 使用。

---

## 11. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **pnpm 12 拦截 Prisma 构建脚本** | `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS`，Prisma 引擎 / Client 未生成，`migrate` 报「引擎缺失」 | pnpm 12 默认拦截依赖的 postinstall 脚本。在 `pnpm-workspace.yaml` 的 `allowBuilds` 放行 `@prisma/client` / `@prisma/engines` / `prisma`（本项目已配，见 §5.8），然后重跑 `pnpm install` |
| Prisma 读不到 `DATABASE_URL` | 报 `Environment variable not found: DATABASE_URL` | Prisma CLI 读**当前目录的 `.env`**。用 `pnpm --filter @mini-dify/api-ts exec prisma ...` 保证在 `apps/api-ts` 下执行；运行期则靠 `main.ts` 的 `import 'dotenv/config'` |
| 连接串写了 `+psycopg` | `migrate` 报无法解析连接串 / 未知方案 | Prisma 只认 `postgresql://`，**不带驱动后缀**；`postgresql+psycopg://` 是 SQLAlchemy 的写法（Python 侧用） |
| 数据库没起就迁移 | `Can't reach database server at localhost:5432` | 容器未就绪：`docker compose up -d db`，等 `(healthy)` 再执行 |
| 脚本里没配 `prisma` 命令 | 曾报 `pnpm run db:migrate` `Missing script` | 现已在本项目 `apps/api-ts/package.json` 配了 `db:migrate` / `db:generate` / `db:studio`（§5.7）；用 `pnpm --filter @mini-dify/api-ts db:migrate` 或根 `pnpm db:migrate`，也可继续用 `pnpm --filter @mini-dify/api-ts exec prisma ...` |
| 手改 `migration.sql` | 之后迁移与 schema 对不上 / 报 drift | 迁移文件是 Prisma 生成的，**不要手改**；要改结构就改 `schema.prisma` 再生成新迁移 |
| `id` 在库里没有默认值 | 直接 `INSERT` 不写 `id` 会违反非空约束 | Prisma 的 `uuid()` 是**客户端默认**（TS 侧生成），数据库列没有 `DEFAULT`；走 Python 侧写入时需应用层生成 id（见 `apps/api-py/app/models/user.py` 注释） |
| 忘了提交 `migrations/` | 新环境无法复现表结构 | `migrations/` 与 `migration_lock.toml` **必须进 Git**（迁移可回放的前提） |
| 改了 schema 却没 `generate` | `prisma.user.xxx` 的类型对不上 | 新字段要先 `migrate dev`（自动 generate）或单独 `prisma generate`，再让编辑器重新加载 |

---

## 12. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| ORM（对象关系映射）概念：用对象操作表行，替代手写 SQL | **首次教学于本篇** |
| schema-first vs code-first（Prisma 属前者；SQLAlchemy 属后者） | **首次教学于本篇** |
| Prisma 三件套（Schema / Migrate / Client）与流程 `schema → migrate → generate → 查询` | **首次教学于本篇** |
| 数据库迁移（migration）：DDL 版本化、可回放、多人协作；`migrations/` + `migration_lock.toml` | **首次教学于本篇** |
| Prisma DSL（`model` / `@id` / `@unique` / `@default` / `@map` / `@@map`） | **首次教学于本篇** |
| `DATABASE_URL` 的 Prisma 写法（`postgresql://`，与 SQLAlchemy 的 `postgresql+psycopg://` 对比） | **首次教学于本篇** |
| NestJS 生命周期钩子（`OnModuleInit` / `OnModuleDestroy`） | **首次教学于本篇** |
| `@Global()` 全局模块 | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：`@Injectable` / `@Module` / 依赖注入（`00-项目初始化/05-NestJS起步.md`）；`pnpm workspace` / `--filter` / `allowBuilds`（`00-项目初始化/03-monorepo与pnpm-workspace.md`）；`.env` 与连接串逐段拆解（`00-项目初始化/02-本地中间件Docker.md`，但 Prisma 的 `postgresql://` 变体属本篇新内容）。
