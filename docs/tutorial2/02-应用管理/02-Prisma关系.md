# 02 · Prisma 关系（应用管理）

> 阶段 2 · 第 2 步
>
> 做完：`App` 模型进 `schema.prisma`，`User.apps` 反向关系就位；跑出 `add_apps` 与 `add_updated_at_default_and_trigger` 两条迁移；`apps` 表有外键、归属索引、`updated_at` 默认值与触发器。
>
> **本篇面试考点**：一对多外键放哪一侧 · `onDelete: Cascade` 的业务含义 · PostgreSQL 为什么不会自动为外键建索引 · `@updatedAt` 与数据库触发器谁兜底 · 给已有数据的表加 `NOT NULL` 列该怎么做。

---

## 1. 先定关系

| 决策 | 结论 | 原因 |
| --- | --- | --- |
| 关系 | `User 1 — N App` | 一个用户多个应用，一个应用只属于一个用户 |
| 外键位置 | `apps.owner_id` | 一对多时，外键放在“多”的一方 |
| 删除策略 | `onDelete: Cascade` | 用户注销，其应用及子资源一起消失，不留孤儿数据 |
| 外键索引 | 手动 `@@index([ownerId])` | PostgreSQL **不会**自动给外键建索引 |
| `description` | `String?` | 可选；空串在业务层归一化成 `null` |
| `mode` | `String @default("chatflow")` | 与契约枚举对齐，默认值落库 |
| `updatedAt` | `@default(now()) @updatedAt` | 应用层维护 + 数据库默认值兜底 |
| 画布字段 | 阶段 3 再加 | 现在加会得到一张永远为空的列，没有收益 |

---

## 2. `schema.prisma`

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**

阶段 2 的完整内容（阶段 1 的 `User` 只多了一行 `apps`）：

```prisma
// mini-dify（TS 侧）数据模型
// 契约：packages/contract/openapi.yaml（UserResponse / AppResponse 的字段与取值）

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

  // 反向关系：一个用户拥有多个应用。
  // Prisma 里反向关系不产生列，只影响类型（user.apps 可直接查询）
  apps App[]

  @@map("users")
}

/// 应用（阶段 2）。画布字段（graph_json / published_*）在阶段 3 追加。
model App {
  id          String   @id @default(uuid())
  // 外键列：数据库里叫 owner_id
  ownerId     String   @map("owner_id")
  name        String
  // 可选描述；null 表示“没填”，与契约的 `string | null` 对应
  description String?
  // 应用形态：chatflow（对话流） | workflow（工作流）
  mode        String   @default("chatflow")
  createdAt   DateTime @default(now()) @map("created_at")
  // @updatedAt：Prisma 在每次 update 时自动写入；
  // @default(now())：INSERT 时也保证有值（否则 NOT NULL 列没有默认值会插入失败）
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")

  // 归属关系；onDelete: Cascade → 删除 user 时级联删除其 apps
  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  // PostgreSQL 不会自动为外键建索引；列表查询按 owner_id 过滤，必须手动加
  @@index([ownerId])
  @@map("apps")
}
```

> **面试考点 · 一对多的外键为什么放在“多”的一侧？**
> 如果放在 `users` 里存 `appIds String[]`：查“我的应用”要解析数组、无法建外键、删除应用要改用户行、并发更新会互相覆盖。放在 `apps.owner_id` 则是标准的关系模型：一列一个值、可建外键、可建索引、可级联。**数组字段是反模式，除非数据库是文档型。**
>
> **追问：Prisma 的 `App[]` 会生成数据库列吗？**
> 不会。`apps App[]` 只是关系在 ORM 层的反向入口，让 `user.apps` 可用于 `include` / 嵌套查询。真实结构只有 `apps.owner_id` 这一列。

> **面试考点 · `onDelete: Cascade` 该不该用？**
>
> - `Cascade`：父没了，子跟着没。适合“子资源没有独立生命周期”的场景——应用属于用户，用户注销后应用没有意义。
> - `Restrict`：有子记录就禁止删父。适合“订单不能被随手删掉”的强一致场景。
> - `SetNull`：父没了，子的外键置空。适合“可选的弱引用”。
> - 危险点：级联是**数据库层**的行为，一次 `DELETE users` 可能悄无声息地删掉大量数据。生产环境删用户通常是软删除（`deleted_at`），级联删除只在“用户主动注销且确认”时使用。
>
> **追问：连锁级联会不会删太多？**
> 会。`apps` 下面还有 `conversations`、`api_keys`（阶段 9/10），它们也对 `apps` 建了 `onDelete: Cascade`。删一个用户 → 删应用 → 删会话和 key，是一条链。设计时要顺着链走一遍，确认每一层都该被删。

---

## 3. 第一条迁移：建表

```powershell
pnpm --filter @mini-dify/api-ts db:migrate --name add_apps
```

**完整文件路径：`apps/api-ts/prisma/migrations/20261018082435_add_apps/migration.sql`**

```sql
-- CreateTable
CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- 可空：没填描述就是 NULL，不是空字符串
    "description" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'chatflow',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 注意：这里没有 DEFAULT，NOT NULL 由 Prisma 的 @updatedAt 在 INSERT 时填值
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 归属查询的核心索引：WHERE owner_id = ?
CREATE INDEX "apps_owner_id_idx" ON "apps"("owner_id");

-- AddForeignKey
ALTER TABLE "apps" ADD CONSTRAINT "apps_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
```

> **面试考点 · PostgreSQL 为什么不自动为外键建索引？**
>
> - 外键约束只保证“引用完整性”，**不承诺查询性能**。PG 不会因为你写了 `REFERENCES` 就建索引。
> - 没有索引时，删除一个 user 需要全表扫描 `apps` 找子记录（级联删除也很慢），列表查询 `WHERE owner_id = ?` 同样全表扫。
> - MySQL/InnoDB 会自动为外键建索引，PG 不会——这是跨数据库迁移时最常见的“怎么突然变慢了”的原因。
> - 本项目手动 `@@index([ownerId])`，迁移里就是那行 `CREATE INDEX`。**凡是会被 `WHERE` / `JOIN` 用到的外键列，都该自己确认索引。**

> **面试考点 · `updated_at NOT NULL` 却没有 `DEFAULT`，为什么没报错？**
> 因为建表时表是空的，没有历史行需要填值；之后的 INSERT 都由 Prisma 的 `@updatedAt` 在应用侧补上时间。**如果是给一张已有数据的表加 `NOT NULL` 列，这条迁移会直接失败**——已有行没有值可填。
>
> 给已有数据的表加非空列的标准三步（expand-contract）：
>
> 1. 先加**可空**列（或带 `DEFAULT`），让存量行有值；
> 2. 回填数据（`UPDATE ... SET new_col = ...`）；
> 3. 再改成 `NOT NULL`，最后按需去掉 `DEFAULT`。
>
> 一条 `ALTER TABLE` 想同时做完，在数据量大时还会长时间锁表。**迁移要能安全地跑在线上，而不是只在你本机空库上跑通。**

---

## 4. 第二条迁移：`updated_at` 的数据库兜底

第一条迁移留下了隐患：`updated_at` 只靠 Prisma 的 `@updatedAt` 维护。任何绕过 Prisma 的写入（手工 SQL、数据修复脚本、另一套后端的裸 SQL）都不会更新它。

更麻烦的是 Python 侧：SQLAlchemy 的 `onupdate` 也需要开发者显式声明，漏一处就静默不更新。

所以补一条迁移，把兜底放到数据库层：

**完整文件路径：`apps/api-ts/prisma/migrations/20261018120000_add_updated_at_default_and_trigger/migration.sql`**

```sql
-- 收口项 3：apps.updated_at 的数据库层默认值 + 触发器
-- 背景：原先 `updated_at` 在迁移里没有 DEFAULT，靠 Prisma `@updatedAt` 与
-- SQLAlchemy `onupdate` 在应用层补；任何绕过 ORM 的手工 SQL 都会漏更。
-- 做法：补 INSERT 默认值 + 建 BEFORE UPDATE 触发器，改由数据库层兜底。
-- 说明：本库 session timezone 为 Etc/UTC，`now()` 写入 timestamp(3) 即为 UTC。

-- 1) INSERT 默认值：绕过 ORM 的 INSERT 也能拿到时间
ALTER TABLE "apps" ALTER COLUMN "updated_at" SET DEFAULT now();

-- 2) UPDATE 前自动刷新 updated_at（在数据库层保证，覆盖手工 SQL）
CREATE OR REPLACE FUNCTION apps_set_updated_at() RETURNS trigger AS $$
BEGIN
    -- NEW 是即将写入的新行；在 BEFORE UPDATE 里改它，最终落库的就是改后的值
    NEW."updated_at" = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "apps_set_updated_at"
BEFORE UPDATE ON "apps"
FOR EACH ROW
EXECUTE FUNCTION apps_set_updated_at();
```

这条迁移是**手写 SQL**：Prisma 不会生成触发器，但 `prisma migrate dev --create-only` 可以生成空迁移文件，你再把 SQL 填进去。

```powershell
# 手写迁移的标准流程
pnpm --filter @mini-dify/api-ts exec prisma migrate dev --create-only --name add_updated_at_default_and_trigger
# （编辑生成的 migration.sql）
pnpm --filter @mini-dify/api-ts exec prisma migrate dev
```

> **面试考点 · `@updatedAt` 和数据库触发器，到底该用哪个？**
>
> | | Prisma `@updatedAt` | DB `BEFORE UPDATE` 触发器 |
> | --- | --- | --- |
> | 生效范围 | 只走 Prisma 的写入 | 所有 UPDATE（含手工 SQL、另一套后端） |
> | 可移植性 | 换数据库也生效 | 需要为每种数据库重写 |
> | 可预测性 | 代码里看得到 | 隐藏在数据库里，容易忘 |
> | 性能 | 无额外开销 | 每行更新多一次函数调用 |
>
> 本项目的选择是**两层都做**：`@updatedAt` 让 Prisma 路径明确，触发器兜住所有旁路。这不是重复，而是“能预期的路径用应用层，不可预期的路径用数据库层”。
>
> **追问：触发器会不会和 Prisma 打架？**
> 不会。Prisma 在 UPDATE 时会带一个 `updatedAt` 值，触发器随后用 `now()` 覆盖成数据库时间。最终以数据库时间为准，反而消除了“应用服务器时钟不准”的问题。
>
> **追问：为什么不用 `DEFAULT CURRENT_TIMESTAMP` 而用 `now()`？**
> 在 PostgreSQL 里两者等价（`CURRENT_TIMESTAMP` 就是 `now()` 的 SQL 标准写法）。用 `now()` 只是与迁移里的风格统一；注意 `now()` 返回的是**事务开始时间**，同一事务内多次调用值相同，这正是我们想要的。

---

## 5. 验证

```powershell
# 1. schema 语法与关系是否合法
pnpm --filter @mini-dify/api-ts exec prisma validate

# 2. 迁移是否全部应用（应显示 up to date）
pnpm --filter @mini-dify/api-ts exec prisma migrate status

# 3. 表结构
docker exec -it mini-dify-db psql -U postgres -d minidify -c "\d apps"
```

预期关键部分：

```text
 Column     |              Type              | Nullable |      Default
------------+--------------------------------+----------+-------------------
 id         | text                           | not null |
 owner_id   | text                           | not null |
 name       | text                           | not null |
 description| text                           |          |
 mode       | text                           | not null | 'chatflow'::text
 created_at | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
 updated_at | timestamp(3) without time zone | not null | now()
Indexes:
    "apps_pkey" PRIMARY KEY, btree (id)
    "apps_owner_id_idx" btree (owner_id)
Foreign-key constraints:
    "apps_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
Triggers:
    apps_set_updated_at BEFORE UPDATE ON apps FOR EACH ROW
```

### 5.1 验证触发器真的在工作

```powershell
# 插入一条 updated_at 是“一天前”的应用
docker exec -it mini-dify-db psql -U postgres -d minidify -c "INSERT INTO apps (id, owner_id, name, updated_at) VALUES ('trigger-test', (SELECT id FROM users LIMIT 1), 'trigger-test', now() - interval '1 day');"

# 改个名字，观察 updated_at 被触发器刷新
docker exec -it mini-dify-db psql -U postgres -d minidify -c "UPDATE apps SET name = 'trigger-test-2' WHERE id = 'trigger-test';"
docker exec -it mini-dify-db psql -U postgres -d minidify -c "SELECT name, updated_at > created_at AS refreshed FROM apps WHERE id = 'trigger-test';"

# 清理
docker exec -it mini-dify-db psql -U postgres -d minidify -c "DELETE FROM apps WHERE id = 'trigger-test';"
```

预期 `refreshed` 为 `t`（true）。

### 5.2 验证级联删除

```powershell
# 建一个临时用户和应用
docker exec -it mini-dify-db psql -U postgres -d minidify -c "INSERT INTO users (id, email, password_hash) VALUES ('tmp-user', 'tmp@example.com', 'x');"
docker exec -it mini-dify-db psql -U postgres -d minidify -c "INSERT INTO apps (id, owner_id, name) VALUES ('tmp-app', 'tmp-user', 'tmp');"

# 删用户，应用应一起消失
docker exec -it mini-dify-db psql -U postgres -d minidify -c "DELETE FROM users WHERE id = 'tmp-user';"
docker exec -it mini-dify-db psql -U postgres -d minidify -c "SELECT count(*) AS remaining FROM apps WHERE id = 'tmp-app';"
```

预期 `remaining = 0`。注意第二条 INSERT 没传 `updated_at`——它能成功，正是因为第四条迁移补了 `DEFAULT now()`。

> **面试考点 · 怎么验证“迁移能跑在线上”而不只是本地？**
>
> - 在**有数据的库**上跑，而不是空库；本地可以先用脚本灌几万行再执行迁移。
> - 检查是否锁表：PG 的 `ALTER TABLE ... SET DEFAULT` 在 11+ 是元数据操作，很快；但加 `NOT NULL` 列会重写表。
> - 迁移要可重复部署：`migrate deploy` 是幂等的，但**手写 SQL 要自己保证幂等**（本项目的 `CREATE OR REPLACE FUNCTION` 幂等，`CREATE TRIGGER` 不幂等——重复执行会报已存在；靠 Prisma 的迁移记录保证只跑一次）。
> - 生产前在 staging 的**数据副本**上演练一遍，别拿线上当第一次。

---

## 6. 下一步

- `03-NestJS应用模块.md`：`AppsModule` / `AppsService` / `AppsController`，全部接口挂 `JwtAuthGuard`，查询条件带 `ownerId`，越权统一 404。
