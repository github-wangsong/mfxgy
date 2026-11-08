# 02 · Prisma 用户表（账号与认证）

> 阶段 1 · 第 2 步
>
> 做完：`apps/api-ts/prisma/schema.prisma` 有 `User` 模型，跑出一条 `init_users` 迁移，数据库里出现 `users` 表；`PrismaService` / `PrismaModule` 接进 NestJS，后续 `AuthService` 可以直接注入 `prisma.user.create(...)`。
>
> **本篇面试考点**：`prisma migrate dev` vs `db push` vs `deploy` · 迁移文件为什么要提交 · `@map` / `@@map` 命名策略 · `uuid()` 到底在哪一侧生成 · `@unique` 与 409 · `@Global` 模块与连接池。

> 说明：仓库最终的 `schema.prisma` 里还有 App / KnowledgeBase / Conversation 等模型。本篇按阶段回放，只保留阶段 1 需要的 `User`，后续每加一个模块就往下追加一个 model。

---

## 1. 先定三件事

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| id 用什么 | `String` + `uuid()` | 不可枚举、分布式安全；比自增 int 更适合对外暴露 |
| 表名/列名 | 数据库 snake_case，TS 侧 camelCase | PG 惯例是 snake_case；TS 里 `user.passwordHash` 更好写 |
| 密码怎么存 | 只存 bcrypt 哈希，字段名 `password_hash` | 明文密码一旦进库就是事故；字段名直白提醒后来者 |
| role 用什么类型 | `String` + `@default("member")` | 不用 Prisma enum，避免 PG 多一个 enum 类型，Python 侧映射更省事 |
| 要不要 `updated_at` | 不要 | 用户表阶段 1 没有更新场景；真需要时再加迁移（YAGNI） |

---

## 2. 装依赖、加脚本

**完整文件路径：`apps/api-ts/package.json`**

阶段 1 只列相关部分（其余依赖阶段 0 已有）：

```jsonc
{
  "name": "@mini-dify/api-ts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    // 开发期迁移：对比 schema 与数据库 → 生成迁移 SQL → 执行 → 自动 prisma generate
    "db:migrate": "prisma migrate dev",
    // 只根据 schema 重新生成 @prisma/client 的类型与查询代码（不碰数据库）
    "db:generate": "prisma generate",
    // 图形化看表数据，排查问题时比 psql 快
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    // 密码哈希：纯 JS 实现，不需要本地编译 node-gyp
    "bcryptjs": "^2.4.3",
    // PrismaClient 运行期要读 process.env.DATABASE_URL，main.ts 第一行加载它
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    // Prisma CLI：migrate / generate / studio 都在这里
    "prisma": "^6.0.0",
    "@types/bcryptjs": "^2.4.6"
  }
}
```

```powershell
# 在仓库根执行；pnpm --filter 只装这一个包
pnpm --filter @mini-dify/api-ts add @prisma/client bcryptjs dotenv
pnpm --filter @mini-dify/api-ts add -D prisma @types/bcryptjs
```

> `@prisma/client` 是运行期依赖（生产也要装），`prisma` 是 CLI（只在开发/构建期用），所以一个在 `dependencies`、一个在 `devDependencies`。

---

## 3. 配 `DATABASE_URL`

**完整文件路径：`apps/api-ts/.env.example`**

```bash
# api-ts 环境变量样例（复制为 .env 后使用）
# 注意：Prisma 使用 postgresql:// 方案，不带 SQLAlchemy 的 +driver 后缀
# 结构：postgresql://<用户>:<密码>@<主机>:<端口>/<库名>
DATABASE_URL="postgresql://postgres:difyai123456@localhost:5432/minidify"
```

```powershell
# 复制样例；.env 不进 git（.gitignore 已忽略）
Copy-Item apps/api-ts/.env.example apps/api-ts/.env
```

两个易错点：

1. **不要写 `postgresql+asyncpg://`**。那是 SQLAlchemy 的 driver 语法，Prisma 只认 `postgresql://`。两套后端读的是同一个库，但连接串格式不同。
2. **Prisma CLI 只会自动读 `apps/api-ts/.env`**（它按 `schema.prisma` 所在包找 `.env`）。在仓库根放 `.env` 是给 `docker compose` 用的，两回事。

> **面试考点 · 为什么数据库连接串一定要走环境变量？**
>
> - 12-Factor 的第 3 条：配置放环境。连接串里通常带密码，绝不能写进代码提交到 git。
> - 同一份镜像要能跑 dev / staging / prod，只能靠环境变量区分。
> - `.env.example` 提交到仓库、`.env` 忽略——这是团队约定：新人 `Copy-Item` 一下就能跑，也不会把真实密码带进版本库。
>
> **追问：容器里的 `localhost` 和宿主机的 `localhost` 是同一个吗？**
> 不是。应用跑在宿主机上时 `localhost:5432` 通；应用如果也进了 compose 网络，就要写服务名 `db:5432`。本项目三个应用都在宿主机跑，只有数据库在容器里，所以用 `localhost` + 端口映射。

---

## 4. 写 `schema.prisma`

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**

阶段 1 的完整内容：

```prisma
// mini-dify（TS 侧）数据模型
// 契约：packages/contract/openapi.yaml（UserResponse 的字段与 role 取值）

// 生成器：产出 @prisma/client 的类型与查询构造器
generator client {
  provider = "prisma-client-js"
}

// 数据源：PostgreSQL（本地用 pgvector/pgvector:pg16 镜像，阶段 7 会用到向量扩展）
datasource db {
  provider = "postgresql"
  // 运行期与 CLI 都从环境变量读，代码里不出现密码
  url      = env("DATABASE_URL")
}

// 用户表
model User {
  // uuid 主键：不可枚举，适合直接暴露在 URL / token 里
  id           String   @id @default(uuid())
  // 登录名；@unique 会在数据库建唯一索引，并发下也不会重复
  email        String   @unique
  // bcrypt 哈希（60 字符）；数据库列名映射为 password_hash
  // 绝不返回给前端：对外视图是契约里的 UserResponse
  passwordHash String   @map("password_hash")
  // 角色：阶段 1 注册一律 member；admin 预留给后续管理功能
  // 故意用 String 而不是 Prisma enum，避免 PG 多一个自定义类型
  role         String   @default("member")
  // 创建时间：由数据库 CURRENT_TIMESTAMP 填，应用不传
  createdAt    DateTime @default(now()) @map("created_at")

  // 表名映射：TS 侧 model User，数据库里是 users
  @@map("users")
}
```

命名映射规则一句话：**`@map` 管列名，`@@map` 管表名；TS 侧保持 camelCase，数据库侧保持 snake_case。**

> **面试考点 · Prisma 的 `@map` / `@@map` 是干什么的？**
>
> - Prisma Client 生成的类型用 `model` / 字段名（`user.passwordHash`），而数据库列是 `password_hash`。`@map` 就是两者之间的翻译层，**不改数据库结构**，只改 Prisma 的读写映射。
> - 好处一：TS 代码符合前端习惯（camelCase），数据库符合 SQL 惯例（snake_case），两边都不用将就。
> - 好处二：接手一个已有 snake_case 的库时，不用写一整套手写 SQL，`@map` 一标就能用 Prisma。
> - 注意：`prisma migrate diff` 也会认这个映射。如果你把 `@map` 删掉，Prisma 会认为“列改名了”，生成一条 `RENAME COLUMN` 迁移——所以 `@map` 不是注释，是结构定义。
>
> **追问：既然 Prisma 能映射，为什么不干脆全用 camelCase 建表？**
> PostgreSQL 对未加引号的标识符会折叠成小写，`"passwordHash"` 这种带引号的列名在 psql、BI 工具、手写 SQL 里都要一直加双引号，非常反直觉。表结构是长期资产，跟随数据库生态的惯例更划算。

> **面试考点 · `@default(uuid())` 的 UUID 是在哪里生成的？**
>
> 看第 5 节的迁移 SQL 就明白了：`"id" TEXT NOT NULL` **没有 DEFAULT**。说明这个 UUID 是 **Prisma Client 在应用侧生成**后作为参数插进去的。
>
> - 应用侧生成（本项目）：不依赖数据库扩展，SQLite/MySQL 也能用；缺点是完全绕过 Prisma 的手工 INSERT 必须自己给 id。
> - 数据库侧生成：写 `@default(dbgenerated("gen_random_uuid()"))`，迁移里会出现 `DEFAULT gen_random_uuid()`。好处是任何写入路径都有兜底；需要 PG 13+（`pgcrypto` 或内置函数）。
> - 同一个模型里 `createdAt` 相反——`DEFAULT CURRENT_TIMESTAMP` 是数据库侧默认值。**谁生成、在哪生成，一定要看迁移 SQL 确认，不要靠猜。**

> **面试考点 · 为什么 `role` 用 `String` 而不是 Prisma `enum`？**
>
> - Prisma `enum` 会在 PostgreSQL 里创建真正的 enum 类型（`CREATE TYPE "Role" AS ENUM (...)`）。加一个角色要写迁移，且 SQLAlchemy 侧要额外声明同一个类型，双后端对齐成本高。
> - 用 `String` + 应用层校验（`class-validator` 的 `@IsIn(['admin','member'])`），加角色只改代码；代价是数据库层不阻止脏值。
> - 契约里 `role` 仍然是 `enum: [admin, member]`，**校验放在边界（DTO）而不是数据库**。这是“宽存储、严入口”的常见取舍。
>
> **追问：那密码为什么不用数据库函数哈希？**
> 密码哈希算法（bcrypt 的 cost）属于应用策略，换算法不该动数据库结构；而且 bcrypt 需要盐，放在服务层更可控。数据库只负责存结果。

---

## 5. 生成并执行第一次迁移

```powershell
# 1. 先确认数据库在跑（阶段 0 的 docker-compose）
docker compose up -d

# 2. 生成迁移并执行；--name 决定迁移目录名，不传会交互式提问
pnpm --filter @mini-dify/api-ts db:migrate --name init_users

# 3. migrate dev 成功后会自动 generate；这里再显式跑一次，确认客户端类型可用
pnpm --filter @mini-dify/api-ts db:generate
```

`db:migrate` 做了四件事：

1. 连上 `DATABASE_URL`，读现有 `_prisma_migrations` 表，判断哪些迁移已应用；
2. 对比 `schema.prisma` 与数据库实际结构，生成差异 SQL；
3. 把 SQL 写进 `prisma/migrations/<时间戳>_init_users/migration.sql`；
4. 在**影子库**（shadow database）里预演一遍，确认无误后应用到开发库，最后执行 `prisma generate`。

**完整文件路径：`apps/api-ts/prisma/migrations/20261018013644_init_users/migration.sql`**

```sql
-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    -- 默认值落在数据库层：任何绕过应用的 INSERT 也是 member
    "role" TEXT NOT NULL DEFAULT 'member',
    -- timestamp(3) = 毫秒精度，与契约的 ISO-8601 毫秒时间戳对齐
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- @unique 的真实产物：唯一索引，而不只是应用层查重
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
```

> **面试考点 · `prisma migrate dev` / `prisma db push` / `prisma migrate deploy` 有什么区别？**
>
> | 命令 | 用途 | 会不会生成迁移文件 | 能不能用于生产 |
> | --- | --- | --- | --- |
> | `migrate dev` | 本地开发 | 会 | 不能（可能重置数据库） |
> | `db push` | 快速原型、临时库 | 不会 | 不建议（无版本记录） |
> | `migrate deploy` | 生产/CI | 不会，只应用已有迁移 | 就是给它用的 |
> | `migrate reset` | 本地推倒重来 | 会清空数据重放迁移 | 绝不 |
>
> - `db push` 适合“schema 还在剧烈变动、数据可以随便丢”的阶段；一旦有真数据，就必须走迁移文件。
> - `migrate deploy` 是幂等的：按时间戳顺序执行尚未应用的迁移，已应用的跳过。所以生产发布脚本里写它，重复执行也安全。
>
> **追问：迁移总是“应用启动时自动跑”可以吗？**
> 多实例部署时很危险：两个容器同时启动，可能并发执行同一条 DDL。正确做法是部署流水线里单独一步执行 `migrate deploy`，应用只负责启动。

> **面试考点 · 迁移文件为什么必须提交到 git？**
>
> - 迁移文件是**数据库结构的版本历史**。只提交 `schema.prisma` 的话，别人拉到代码只能看到“最终态”，不知道中间怎么变过来的，也无法在已有数据的库上安全升级。
> - 别人 clone 后执行一次 `migrate deploy`，就能得到和你一模一样的表结构——这是团队协作和 CI 的基础。
> - 迁移文件生成后就当**只读**：已上线的迁移不要改，要改就新加一条。改了会让已应用的库和记录对不上，Prisma 会报 drift。
>
> **追问：`_prisma_migrations` 表是干什么的？**
> Prisma 自己维护的元数据表，记录每条迁移的 `checksum`、开始/完成时间。它靠 checksum 发现“迁移文件被改过”，靠完成时间判断是否应用成功。所以不要手工动它。

> **追问：报 `P3014` / 提示无法创建 shadow database 怎么办？**
> `migrate dev` 需要一个临时影子库来预演迁移，要求当前数据库用户有 `CREATEDB` 权限。本地 compose 里的 `postgres` 是超级用户，默认没问题；用云数据库时要单独授权，或者显式配 `shadowDatabaseUrl`。

---

## 6. 把 Prisma 接进 NestJS

Prisma 不是 NestJS 原生模块，需要包一层 `Injectable`。

**完整文件路径：`apps/api-ts/src/prisma/prisma.service.ts`**

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/** Prisma 客户端的 NestJS 包装：随应用生命周期连接 / 断开。 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // 模块初始化完成后建立连接池（而不是在构造函数里，避免 DI 阶段就阻塞）
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  // 应用关闭（Ctrl+C / SIGTERM）时优雅断开，释放连接，避免数据库端累积 idle 连接
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
```

**完整文件路径：`apps/api-ts/src/prisma/prisma.module.ts`**

```ts
import { Global, Module } from '@nestjs/common'

import { PrismaService } from './prisma.service'

/** 全局 Prisma 模块：其他模块无需重复 import 即可注入 `PrismaService`。 */
@Global()
@Module({
  // provider：由 Nest 的 IoC 容器实例化（单例）
  providers: [PrismaService],
  // export：让 @Global 的可见性真正生效，其他模块才能注入
  exports: [PrismaService],
})
export class PrismaModule {}
```

**完整文件路径：`apps/api-ts/src/app.module.ts`**

阶段 1 的完整内容（后续阶段继续追加模块）：

```ts
import { Module } from '@nestjs/common'

import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
import { PrismaModule } from './prisma/prisma.module'

/**
 * 根模块。阶段 1 加入 `PrismaModule`（全局数据库访问）；
 * 紧随其后的 `AuthModule`（注册 / 登录 / 当前用户）在下一篇加进来。
 */
@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

**完整文件路径：`apps/api-ts/src/main.ts`**

只改第一行（阶段 0 的其余内容不动）：

```ts
// 必须最先执行：Prisma 在运行期需要 process.env.DATABASE_URL
// 如果放到 import AppModule 之后，PrismaClient 可能已经读完环境变量，拿到 undefined
import 'dotenv/config'

// ……阶段 0 的 bootstrap 不变
```

> **面试考点 · 为什么要有 `PrismaService`，直接 `new PrismaClient()` 不行吗？**
>
> - **连接数**：`new PrismaClient()` 每调一次就建一个连接池。散落在各个 service 里 new，连接数会随调用路径膨胀，很快打满 PG 的 `max_connections`。
> - **生命周期**：Nest 的 IoC 默认单例，`PrismaService` 全应用只实例化一次；`onModuleDestroy` 还能保证进程退出时优雅断开。
> - **可测试性**：测试里用 `overrideProvider(PrismaService)` 就能替换成 mock，不用真连数据库。
> - **统一入口**：以后要加慢查询日志、软删除中间件、审计扩展，只改 `PrismaService` 一处。
>
> **追问：`@Global()` 会不会造成命名污染？**
> 会有一点：全局模块的 provider 对所有模块可见，谁都能注入 `PrismaService`。所以全局模块要克制——只放真正跨模块的基础设施（数据库、配置、日志）。业务服务不要加 `@Global()`。
>
> **追问：Prisma 的连接池怎么配？**
> 连接池参数在连接串里：`?connection_limit=10&pool_timeout=20`。默认 `connection_limit` 是 `物理核数 * 2 + 1`。多实例部署时要用 `(PG max_connections - 预留) / 实例数` 反推，否则实例一扩就爆。

---

## 7. 验证

```powershell
# 1. 数据库容器在跑
docker compose ps

# 2. 迁移历史里有 init_users，且已应用
docker exec -it mini-dify-db psql -U postgres -d minidify -c "SELECT migration_name, finished_at FROM _prisma_migrations;"

# 3. 表结构符合预期（列名是 snake_case）
docker exec -it mini-dify-db psql -U postgres -d minidify -c "\d users"

# 4. 生成出来的客户端类型可用（0 错误即通过）
pnpm --filter @mini-dify/api-ts exec tsc --noEmit -p tsconfig.json
```

预期（第 3 条的关键部分）：

```text
 Column        |              Type              | Nullable |      Default
---------------+--------------------------------+----------+-------------------
 id            | text                           | not null |
 email         | text                           | not null |
 password_hash | text                           | not null |
 role          | text                           | not null | 'member'::text
 created_at    | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "users_email_key" UNIQUE CONSTRAINT, btree (email)
```

最直观的确认方式：

```powershell
pnpm --filter @mini-dify/api-ts db:studio
```

浏览器打开 Prisma Studio，左侧出现 `User`，点进去能看到空表——表建好了，下一篇往里写数据。

> 此时数据库里还没有任何用户；`AuthService` 写完后，注册接口会执行 `prisma.user.create({ data: { email, passwordHash } })`，`id` 由 Prisma 生成、`created_at` 由数据库生成。

---

## 8. 一个后面会踩的坑（预告）

阶段 2 给 `apps` 表加 `updated_at` 时，会遇到一个取舍：**更新时间到底由谁维护？**

- Prisma 的 `@updatedAt` 由客户端在 `UPDATE` 时自动填——绕过 Prisma 的手工 SQL 就不生效；
- 数据库 `BEFORE UPDATE` 触发器任何写入路径都生效，但结构更“重”。

仓库最终的选择是“两边都做”：schema 里写 `@default(now()) @updatedAt`，再加一条迁移补 `DEFAULT now()` 和触发器兜底（`prisma/migrations/20261018120000_add_updated_at_default_and_trigger/`）。阶段 2 展开讲，这里只需要记住结论：**时间戳这类字段，先想清楚“谁可能写这张表”，再决定兜底放在哪一层。**

`User` 表阶段 1 没有 `updated_at`，所以本篇不涉及；等真的有“改用户资料”的需求，再加迁移也不迟。

---

## 9. 下一步

- `03-NestJS注册登录.md`：`AuthModule` / `AuthService` / `AuthController`，bcrypt 哈希、JWT 签发、`JwtAuthGuard` 保护 `/auth/me`。
- 之后是 SQLAlchemy 用户表（Python 侧映射同一张 `users` 表）、FastAPI 注册登录、前端登录页。
