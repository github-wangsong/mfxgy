# 02 · Prisma JSONB 与「两态」

> 所属：阶段 3 · 画布
> 本篇覆盖：给 `App` 模型加三列——`graphJson Json?`（草稿）、`publishedGraphJson Json?`（发布快照）、`publishedAt DateTime?`（发布时间）→ 用 Prisma Migrate 生成并应用迁移 **`add_app_graph`** → 数据库侧自证「`Json` 真的落成了 `jsonb`」
> **本篇首次教学：① Prisma 的 `Json` 类型在 Postgres 落成 `jsonb`（实测确认），以及为什么用 `jsonb` 而不是 `text` / `json`；②「两态」的数据建模——草稿 vs 发布快照，为什么发布要**拷贝一份**而不是加状态位；③可空 JSON 列与「空图」的应用层语义（`null` ≠ `{}`）**
> （ORM / schema-first / Prisma 三件套 / 迁移（DDL 版本化）/ Prisma DSL（`model` / `@map` / `@default`）/ `DATABASE_URL` 写法 / `db:migrate` 脚本见 `01-账号与认证/02-Prisma.md`；关系建模 / `@relation` / `onDelete: Cascade` / `@@index` / `@@map` 见 `02-应用管理/02-Prisma关系建模.md`；图的结构、接口、校验规则见 `03-画布/01-图JSON契约与校验.md`，本篇只引用不重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 承接：立论与分工

阶段 3 的立论是 **「图 = 数据」**，且分**两态**（详见 `03-画布/01-图JSON契约与校验.md` §0）：

```
   草稿态 graphJson           ── 可反复编辑（PUT 覆盖）
   发布态 publishedGraphJson ── 发布时拷贝一份冻结（线上跑的版本）
```

- `01-图JSON契约与校验.md` 定义了**「图长什么样、接口是什么、怎么校验」**（契约侧）。
- **本篇**负责**「这两态怎么落到数据库」**（存储侧）：在 `apps` 表上加三列存它们。

一句话衔接：**契约规定了「要存两份图」，本篇把这两份图变成真实的数据库列。**

---

## 1. 本篇目标

- 给 `apps` 表加**三列**：草稿图 `graph_json`、发布快照 `published_graph_json`、发布时间 `published_at`。
- 走一遍 Prisma 标准流程：**改 schema → 迁移建列 → 生成 Client**。
- 理解 Prisma 的 `Json` 类型如何映射到 PostgreSQL 的 `jsonb`，以及为什么选 `jsonb`。
- 理解「**两态**」为什么用「**两份列**」而不是「一份列 + 状态位」。
- 理解可空的 JSON 列在**应用层**的语义（`null` 表示「尚未编辑 / 从未发布」）。

**验收标准**

1. `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_app_graph` 成功，生成 `20261018124928_add_app_graph/migration.sql` 并应用到数据库。
2. `\d apps` 显示新增三列：`graph_json jsonb`、`published_at timestamp(3)`、`published_graph_json jsonb`，且**三列都可空**。
3. `psql` 查 `jsonb_typeof(graph_json)` 与 `jsonb_typeof(published_graph_json)`，对已保存 / 已发布的应用返回 `object`（证明落库就是 JSONB，且写进去的是 JSON 对象）。
4. Prisma Client 里 `App` 类型带上这三个字段，`apps/api-ts` 编译通过。

**迁移所有权约定（沿用阶段 1、2）**

| 表 | DDL 所有权 | 说明 |
| --- | --- | --- |
| 平台主表（`users`、`apps`） | **TS 侧 Prisma**（`apps/api-ts/prisma/migrations`） | Python 侧只用 SQLAlchemy **映射**同一张表，**不产生 DDL** |
| Python 专属表 | **Python 侧 Alembic** | 真有归属 Python 的表时再引入 |

`apps` 表的建表 / 加列权归 **Prisma**；Python 侧只读写、不建列（机制见 `01-账号与认证/02-Prisma.md` 的「迁移所有权」）。

---

## 2. 前置条件

- 阶段 3 · 01（契约扩展）已完成：契约里已有 `Graph` / `GraphNode` / `GraphEdge` / `NodePosition` / `PublishGraphResponse` 与四个图接口（见 `03-画布/01-图JSON契约与校验.md`）。
- 阶段 2 · 02：`apps` 表已由 Prisma 建好（迁移 `add_apps` 已应用），`App` 模型与 `User` 的一对多关系已在。
- 阶段 0 · 02：**PostgreSQL 容器已 `(healthy)`**，端口 `5432` 已映射，库 `minidify` 已建。
- `apps/api-ts` 已装依赖（`@prisma/client`、`prisma`）。
- `pnpm install` 已执行过。

> 若容器没起：`docker compose up -d db`，等 `docker compose ps` 显示 `(healthy)` 再继续。

---

## 3. 先看清要做什么

阶段 2 的 `apps` 表存的是**标量列**（`name` / `description` / `mode`…）。阶段 3 要存的是**一段 JSON**——「图」。做法与阶段 1、2 一模一样，只是这次用的是 Prisma 的 **`Json`** 类型：

```
① 改 schema.prisma              → ② prisma migrate dev          → ③ prisma generate
   给 App 加三列                     （生成 ALTER TABLE + 加列）        （生成类型安全的 Client）
   graphJson          Json?             │                                  │
   publishedGraphJson Json?        migrations/…_add_app_graph/     node_modules/.prisma/client
   publishedAt        DateTime?    migration.sql
   apps/api-ts/prisma/             （ALTER TABLE "apps" ADD COLUMN … JSONB …）
   schema.prisma
```

本次迁移的产物是一份 SQL，只做一件事——给 `apps` 加三列：

```sql
ALTER TABLE "apps" ADD COLUMN     "graph_json" JSONB,            -- 草稿图
ADD COLUMN     "published_at" TIMESTAMP(3),                      -- 发布时间
ADD COLUMN     "published_graph_json" JSONB;                     -- 发布快照
```

**三列的语义**（与契约 / 应用层规则呼应）：

| 列 | 类型 | 语义 | `NULL` 意味着 |
| --- | --- | --- | --- |
| `graph_json` | `JSONB NULL` | 草稿图 | **从未编辑过** → `GET .../graph` 返回空图（见 §9） |
| `published_graph_json` | `JSONB NULL` | 发布快照 | **从未发布过** → `GET .../graph/published` 返回 404（见 §9） |
| `published_at` | `TIMESTAMP(3) NULL` | 发布时间 | 同上（与发布快照同生共死） |

**「两态」一句话说清**：草稿是「你正在画的那张」，发布快照是「线上正在跑的那张」；发布 = **把草稿复制进发布快照**。两张图各自存一列，因此编辑草稿**不会影响**已发布的那份（见 §8）。

---

## 4. 命令清单（逐条说明）

> Prisma CLI 需要在**有 `prisma/schema.prisma` 与 `.env` 的目录**执行。本项目的模型与环境文件都在 `apps/api-ts/` 下，所以用 `pnpm --filter @mini-dify/api-ts` 把命令**切到该包目录**执行（`pnpm --filter` 机制见 `00-项目初始化/03-monorepo与pnpm-workspace.md`）。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_app_graph` | 仓库根 | 比对 schema 与库现状，生成并**应用**迁移 `add_app_graph`（给 `apps` 加三列），顺带 `generate` | 打印 `Applying migration '20261018124928_add_app_graph'`、`Your database is now in sync with your schema.` |
| `pnpm --filter @mini-dify/api-ts db:migrate` | 仓库根 | 等价于 `prisma migrate dev`（不带名称，会**交互式询问**迁移名，届时填 `add_app_graph`） | 同上 |
| `pnpm --filter @mini-dify/api-ts db:generate` | 仓库根 | 单独重新生成 Prisma Client（改了 schema 但不想动库时用） | 打印 `Generated Prisma Client` |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"` | 任意目录 | 数据库侧自证「三列真的加了、且类型是 jsonb」 | 打印 `apps` 表结构（含三列新增） |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "SELECT jsonb_typeof(graph_json), jsonb_typeof(published_graph_json) FROM apps LIMIT 1;"` | 任意目录 | 自证「写进去的确实是 JSON 对象」 | 对已保存 / 已发布的行返回 `object \| object` |

> `db:migrate` 是 `apps/api-ts/package.json` 里的便捷脚本，就是 `prisma migrate dev`（见 `01-账号与认证/02-Prisma.md`）。想免交互、直接指定迁移名，用第 1 条的 `--name add_app_graph` 写法。本项目实测生成的迁移目录为 **`20261018124928_add_app_graph`**（迁移名 `add_app_graph`）。

---

## 5. 完整代码：Prisma schema

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
  // @default(now()) 与迁移 add_updated_at_default_and_trigger 的 DB 默认值保持一致
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")
  // 画布（阶段 3）：草稿图与已发布快照。
  // graphJson 为 null 表示「尚未编辑」；读取时返回合法空图 {"version":"1","nodes":[],"edges":[]}。
  // publishedAt 为 null 表示「从未发布过」（此时 GET .../graph/published 返回 404）。
  graphJson          Json?     @map("graph_json")
  publishedGraphJson Json?     @map("published_graph_json")
  publishedAt        DateTime? @map("published_at")

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId])
  @@map("apps")
}
```

**本阶段新增的三行（`model App`）**

| 片段 | 作用 |
| --- | --- |
| `graphJson Json? @map("graph_json")` | **草稿图**。`Json` 是 Prisma 的 JSON 标量类型（见 §7）；`?` 表示**可空** → 落成 `JSONB NULL`；`@map` 把驼峰落成蛇形列 `graph_json`（`@map` 机制见 `01-账号与认证/02-Prisma.md`） |
| `publishedGraphJson Json? @map("published_graph_json")` | **发布快照**。同样 `Json?` → `JSONB NULL` |
| `publishedAt DateTime? @map("published_at")` | **发布时间**。可空的 `DateTime?` → `TIMESTAMP(3) NULL`；`null` 表示从未发布 |

**注意点**：

- 三列**全部可空**（都带 `?`）。**为什么可空**见 §9——「空」是一种有意义的状态（尚未编辑 / 从未发布）。
- 三列**都没有 `@default(...)`**。**为什么**见 §12 的坑——Prisma 的 `Json` 类型**不支持普通字面量默认值**，所以这里用「**可空列 + 应用层默认**」规避。
- `graphJson` / `publishedGraphJson` 用 `Json` 而非 `String`（`text`）。**为什么**见 §7。

---

## 6. 完整代码：迁移 SQL（Prisma 生成，勿手改）

**完整文件路径：`apps/api-ts/prisma/migrations/20261018124928_add_app_graph/migration.sql`**

```sql
-- AlterTable
ALTER TABLE "apps" ADD COLUMN     "graph_json" JSONB,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_graph_json" JSONB;
```

**逐句解释**

- 这是 Prisma 从 `schema.prisma` **自动生成**的 SQL（**不要手改**，改了下次迁移会与 schema 对不上）。
- `"graph_json" JSONB`：对应 `graphJson Json?`。**注意类型是 `JSONB`（不是 `JSON`、更不是 `TEXT`）**——Prisma 的 `Json` 在 PostgreSQL 上映射为 `jsonb`（见 §7）。
- `"published_graph_json" JSONB`：对应 `publishedGraphJson Json?`。
- `"published_at" TIMESTAMP(3)`：对应 `publishedAt DateTime?`（Prisma 的 `DateTime` → `TIMESTAMP(3)`，与 `created_at` / `updated_at` 同款）。
- **三列都没有 `NOT NULL`、也没有 `DEFAULT`**：`?` 让它们可空（无 `NOT NULL`）；`Json` 加不了字面量默认值，所以无 `DEFAULT`（见 §12）。

> 小观察：迁移里 `published_at` 出现在 `published_graph_json` **之前**——这是 Prisma 生成 ALTER TABLE 子句时的顺序。列在表里的**物理顺序**就按 `ADD COLUMN` 的先后排列（这也是下一节 `\d apps` 里三列的排列顺序）。

---

## 7. 【技术教学 · 首次】Prisma 的 `Json` 类型 → PostgreSQL 的 `jsonb`

### 7.1 是什么：Prisma 的 `Json` 标量

`Json` 是 Prisma 的一个**标量类型**（和 `String` / `Int` / `DateTime` 并列），用来存「一段 JSON 数据」。在 schema 里写 `graphJson Json?`，Prisma 就知道这一列要存 JSON。

**它落到 PostgreSQL 上会变成什么类型？** —— 实测（见 §10）确认：**Prisma 的 `Json` 落成 `jsonb`**，迁移 SQL 里直接写的就是 `JSONB`，`\d apps` 显示 `graph_json jsonb`。**Prisma 生成即为 JSONB，无需手改**。

### 7.2 为什么是 `jsonb`，而不是 `text` / `json`

PostgreSQL 里存 JSON，有三个候选：

| 类型 | 存的是什么 | 能按内部键查询/索引吗 | 本项目评价 |
| --- | --- | --- | --- |
| `text` | 纯字符串 | **不能**——数据库不知道它是 JSON，无法 `->` / `->>` 取值，不能建 JSON 索引 | ✗ 等于把结构化数据降级成一坨字符 |
| `json` | **原始文本**（保留空白、键顺序、重复键） | 能查询，但**每次访问都要重新解析**文本，且**不能建 GIN 索引**（没有解析后的结构） | 只适合「原样存档、几乎不查」的场景 |
| `jsonb` | **解析后的二进制**（键去重、规范化、可索引） | **能**——可用 `->` / `->>` / `@>` / jsonpath 查询，可建 **GIN 索引** | ✓ 写入稍慢、查询与索引更快 |

**本项目选 `jsonb`**：

- 我们**要按图的内容查询**（至少：读取某应用的那张图；将来可能要「找出所有用了某类节点的应用」）。`jsonb` 的 `->` / `->>` / `@>` 与 GIN 索引正好服务这类需求。
- `text` 直接出局：它连「这是 JSON」都表达不了。
- `json` vs `jsonb`：`json` 每次访问都重解析、且不能建 GIN；`jsonb` 一次解析、可索引。**教学项目数据量小，写入开销可忽略，查询与索引的好处更实在** → `jsonb`。

> 一句话：**`text` 看不见结构，`json` 看得见但要反复重解析，`jsonb` 解析好且索引友好** → 用 `jsonb`。

### 7.3 Prisma 侧不用你操心类型映射

你只需在 schema 写 `Json`，**Prisma 自动选 `jsonb`**。但知道「它落成 `jsonb`」很重要，因为：

- 你会用 `psql` 直接查这些列（`jsonb_typeof`、`->`、`->>` 都是 JSONB 的函数 / 运算符）。
- 你能在数据库侧建 GIN 索引（若将来需要）——这是 `text` 做不到的。

---

## 8. 【技术教学 · 首次】「两态」的数据建模：草稿 vs 发布快照

### 8.1 两种实现「发布」的思路

「发布」这个动作有两种建模方式：

**思路 A：一份图 + 一个状态位**

```
App ─ has ─ graphJson     （唯一一份图）
              published: boolean / publishedAt: DateTime?   ← 只记「发布没发布」
```

**思路 B（本项目）：两份图 + 发布时间**

```
App ─ has ─ graphJson            （草稿）
          ─ publishedGraphJson   （发布快照）
          ─ publishedAt          （发布时间）
```

### 8.2 为什么思路 A 会出问题

思路 A 里，**只有一份图**。你发布之后再改草稿——**改的就是那一份图本身**，于是：

- 线上（已发布）看到的内容，会**跟着你的后续编辑一起变**。你只是想改草稿，结果线上**被动改了**。
- 要避免这一点，又得在发布时「冻结 / 打 tag / 记版本」，最终还是绕回「多存一份」。

> 思路 A 想用「一个标志位」表达「两个内容版本」，这是**用一个标量去编码一份快照**——信息量不够，必然出问题。

### 8.3 思路 B（本项目）为什么对

**发布 = 把当前的草稿 `graphJson` 复制进 `publishedGraphJson`，并盖上 `publishedAt`。**

于是**编辑与线上从物理上解耦**：

| 动作 | 写入哪一列 | 对线上的影响 |
| --- | --- | --- |
| 编辑草稿（`PUT .../graph`） | 只写 `graphJson` | **无**（`publishedGraphJson` 不动） |
| 发布（`POST .../publish`） | 把 `graphJson` 拷进 `publishedGraphJson`，写 `publishedAt` | 覆盖线上为**这一刻的草稿** |
| 读已发布（`GET .../published`） | 只读 `publishedGraphJson` | 读到的是**冻结的快照** |

好处：

- **发布后继续改草稿，不影响线上**——因为线上读的是另一列。
- **回滚简单**：`publishedGraphJson` 就是「上一版线上」，想回滚把旧快照发布回去即可；思路 A 没有历史快照可回。
- **职责清晰**：`GET .../graph` 读草稿、`GET .../graph/published` 读快照，两个接口各读各的列，语义不混淆。

> 类比 Git：**草稿 = 工作区（working tree），发布快照 = 一次提交（commit）**。工作区随便改，已提交的快照不动；要上线就「提交一次」。两份数据物理分离，才谈得上「编辑不打扰线上」。

### 8.4 契约已预留呼应

契约里 `PublishGraphResponse` 就是 `{ publishedAt, graph }`（见 `03-画布/01-图JSON契约与校验.md`）——**发布时间 + 那份快照**，正是本节这两列的组合。存储与契约在此对上。

---

## 9. 【技术教学 · 首次】可空 JSON 列与「空图」的应用层语义（`null` ≠ `{}`）

### 9.1 三个容易混淆的「空」

JSON 列（可空）里，至少有三个「看起来都像空」的东西：

```sql
NULL                    -- SQL 空：这一格没有值
'{}'::jsonb             -- 空对象：一个有值的、合法的 JSON
'null'::jsonb           -- JSON null：一个有值的 JSON 标量
```

它们**完全不同**：

| 值 | `jsonb_typeof(...)` 的结果 | 含义 |
| --- | --- | --- |
| `NULL`（SQL 空） | `NULL`（SQL 空，**不是** `'object'` / `'null'`） | 「没有这一格」 |
| `'{}'::jsonb` | `'object'` | 一个（空的）JSON 对象 |
| `'null'::jsonb` | `'null'` | 一个 JSON null 标量 |

> 关键点：**`jsonb_typeof(NULL)` 求值为 SQL `NULL`**，而 `jsonb_typeof('{}')` 是 `'object'`、`jsonb_typeof('null')` 是 `'null'`。所以「可空列」用 `IS NULL` 判、不要用 `= 'null'` 去比。

### 9.2 本项目选 `NULL`（可空列）表示「从未编辑 / 从未发布」

我们**故意**让 `graph_json` / `published_graph_json` 可空，并用 **`NULL`** 表示「没有」：

- 若用 `'{}'` 表示「没有草稿」，它会与「**编辑过、但内容正好是空对象**」混淆——`{}` 也是「有值」。
- `NULL` 表达「**从来没有过**」这件事最干净：数据库只记「有没有」，不掺业务含义。
- 「对外该显示成什么」由**应用层**决定（见 9.3），数据库不越俎代庖。

### 9.3 应用层规则：把「存储层的 null」翻译成「接口层的语义」

数据库里的 `NULL` 不直接暴露给客户端。应用层按**接口语义**翻译：

```
                     存储层                      应用层（接口表现）
  ┌─────────────────────────────────┐   ______________________________
  │ graph_json IS NULL               │  │ GET .../graph → 空图 {"version":"1","nodes":[],"edges":[]}
  └─────────────────────────────────┘  │   （读取不校验，永远放行）
  ┌─────────────────────────────────┐   ______________________________
  │ published_graph_json IS NULL     │  │ GET .../graph/published → 404 (Graph not published)
  └─────────────────────────────────┘  │   （发布态「没有」就是资源不存在）
```

- **草稿为 `NULL`** → `GET .../graph` 返回**合法空图**（不是 404、不是 `null`）：因为「读取草稿」对「存在且属于你的应用」应永远成功，前端需要一个能立刻渲染的初始图（详见 `03-画布/01-图JSON契约与校验.md` §12）。
- **发布快照为 `NULL`** → `GET .../graph/published` 返回 **404**：发布态没有「空图」这个概念，没发布就是「没有资源」。

> 所以 `null ≠ {}` 这件事，**在存储层**是「SQL NULL vs JSON 空对象」，**在接口层**是「空图 vs 404」的两套规则——**存储只记「有没有」，语义由应用层定**。

### 9.4 实测：写进去就是 `object`

对已保存 / 已发布的应用执行（见 §10.4）：

```sql
SELECT jsonb_typeof(graph_json), jsonb_typeof(published_graph_json) FROM apps LIMIT 1;
```

返回 `object | object`——因为草稿与快照里存的都是 `{"version":"1","nodes":[...],"edges":[...]}` 这样的 **JSON 对象**。这也顺带验证了「`Json` 列落成 JSONB 且能跑 JSONB 函数」。

---

## 10. 建表并验证

### 10.1 应用迁移（加列）

**命令（在仓库根执行）**

```bash
pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_app_graph
```

> 也可用便捷脚本 `pnpm --filter @mini-dify/api-ts db:migrate`（不带名称，会**交互式询问**迁移名，届时输入 `add_app_graph`）。

**目的**：从 `schema.prisma` 生成 `20261018124928_add_app_graph/migration.sql` 并应用到 `minidify` 库（给 `apps` 加三列），然后自动 `generate`。

**预期输出（关键行）**

```
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "minidify", schema "public" at "localhost:5432"
Applying migration `20261018124928_add_app_graph`
The following migration(s) have been created and applied from new schema changes:
migrations/
  └─ 20261018124928_add_app_graph/
    └─ migration.sql
Your database is now in sync with your schema.
Generated Prisma Client ...
```

> 前置：`docker compose ps` 显示 `mini-dify-db` 为 `(healthy)`。数据库没起会报连接失败。

### 10.2 数据库侧自证（`\d apps`）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"
```

**预期输出（实测，节选——三列为本次新增）**

```
                                        Table "public.apps"
        Column        |              Type              | Collation | Nullable |      Default
----------------------+--------------------------------+-----------+----------+-------------------
 id                   | text                           |           | not null |
 owner_id             | text                           |           | not null |
 name                 | text                           |           | not null |
 description          | text                           |           |          |
 mode                 | text                           |           | not null | 'chatflow'::text
 created_at           | timestamp(3) without time zone |           | not null | CURRENT_TIMESTAMP
 updated_at           | timestamp(3) without time zone |           | not null | now()
 graph_json           | jsonb                          |           |          |
 published_at         | timestamp(3) without time zone |           |          |
 published_graph_json | jsonb                          |           |          |
Indexes:
    "apps_pkey" PRIMARY KEY, btree (id)
    "apps_owner_id_idx" btree (owner_id)
Foreign-key constraints:
    "apps_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
```

**看四样**：

1. **三列已加**：`graph_json` / `published_at` / `published_graph_json`。
2. **类型正确**：两个 JSON 列显示为 **`jsonb`**（不是 `json`、不是 `text`）；`published_at` 为 `timestamp(3)`（与 `created_at` / `updated_at` 同款）。
3. **三列都可空**：`Nullable` 列均为**空**（没有 `not null`），Default 列也为空（可空列 + 无默认，见 §12）。
4. 原有的主键 / 索引 / 外键不变。

> 「Prisma 的 `Json` 落成 `jsonb`」这件事，**在 `\d` 输出里可以直接看到**——`graph_json | jsonb`——无需手改任何类型。

### 10.3 生成 Client 并确认可用

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

### 10.4 JSON 语义自证（`jsonb_typeof`）

先确保有一个**已保存过草稿（最好也发布过）**的应用（用后面 NestJS / FastAPI 图模块的 `PUT` / `publish` 接口，或直接手工 `UPDATE` 写入一份 JSON）：

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "SELECT jsonb_typeof(graph_json), jsonb_typeof(published_graph_json) FROM apps LIMIT 1;"
```

**预期输出（实测）**

```
 jsonb_typeof | jsonb_typeof
--------------+--------------
 object       | object
```

`object` 证明：列是 **JSONB**（能跑 `jsonb_typeof`）、且写进去的是一份 **JSON 对象**。若某应用从未保存 / 从未发布，对应值为 **空**（SQL `NULL`）。

---

## 11. 验收自测

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 迁移已生成并应用 | `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_app_graph` | `Your database is now in sync with your schema.` |
| 迁移与库同步 | `pnpm --filter @mini-dify/api-ts exec prisma migrate status` | 显示所有迁移已应用、无待应用项 |
| 三列已加且类型正确 | `docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"` | `graph_json jsonb` / `published_at timestamp(3)` / `published_graph_json jsonb`，三列均可空、均无默认 |
| JSON 落成 JSONB | 同上 `\d apps` 输出 | 两列为 `jsonb`（非 `json` / `text`） |
| 写入的是 JSON 对象 | `… "SELECT jsonb_typeof(graph_json), jsonb_typeof(published_graph_json) FROM apps LIMIT 1;"` | 已保存 / 已发布行返回 `object \| object`；未编辑 / 未发布为 SQL 空 |
| schema 里三列可空 | 阅读 `schema.prisma` | `graphJson Json?` / `publishedGraphJson Json?` / `publishedAt DateTime?`（均带 `?`、均无 `@default`） |
| Client 已生成 | `pnpm --filter @mini-dify/api-ts db:generate` | `Generated Prisma Client` |
| 应用可编译 | `pnpm --filter @mini-dify/api-ts build` | 通过（`App` 类型含新字段） |
| 迁移文件入库 | `git status apps/api-ts/prisma/migrations` | `20261018124928_add_app_graph/` 应被提交 |

> 「能加列」只是第一步；真正的读写（`prisma.app.update({ data: { graphJson } })` 等）在后续的 NestJS / FastAPI 图模块篇里使用。

---

## 12. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 想给 `Json` 列写默认值 `@default("{}")` / `@default({...})` | `prisma validate` / `migrate` 报错，或默认值不生效 | **Prisma 的 `Json` 不支持普通字面量默认值**。规避：**用可空列（`Json?`）+ 应用层默认**——「默认空图」由应用层在 `GET .../graph` 时构造，不落库（§9） |
| 用 `text` 存 JSON | 无法按内部键查询、不能建 GIN、`jsonb_typeof` 报「函数不存在」 | 用 Prisma 的 `Json`（自动落成 `jsonb`）。`text` 看不见结构（§7.2） |
| 手改 `migration.sql` 把 `JSONB` 改成 `jsonb` 等 | 之后迁移与 schema 对不上 / 报 drift | 迁移由 Prisma 生成，**不要手改**；它本来就产出 `JSONB`（大写），无需手动指定类型 |
| 在库上写默认值 `DEFAULT '{}'::jsonb` | 与「应用层默认」两套语义打架；`{}` 与「编辑过但为空」混淆 | 「空」用 **`NULL`** 表示（可空列），空图在应用层临时构造；不要让 DB 默认值承担业务语义（§9） |
| 用 `= 'null'` 判空 JSON | 永远判不出「没值」 | 可空列用 **`IS NULL`** 判；`jsonb_typeof(NULL)` 返回 SQL `NULL`，而 `jsonb_typeof('null')` 是 `'null'`（§9.1） |
| 只写一份图 + `published` 状态位 | 「发布后再改草稿」会**误改线上** | 发布必须**拷贝一份快照**（`publishedGraphJson`），让编辑与线上物理分离（§8） |
| 忘了给发布态盖时间戳 | 前端拿不到「何时发布」 | 发布时同一事务里写 `publishedAt`（对应契约 `PublishGraphResponse.publishedAt`） |
| 直接手工 `UPDATE` 写入非法 JSON / 非对象 | `jsonb_typeof` 不是 `object`（可能是 `null` 标量 / 数组），应用层解析异常 | 写入前过校验（契约 + 应用层纯函数 `validateGraph`，见 `03-画布/01-图JSON契约与校验.md`）；手工调试时也写合法对象 |
| 改了 schema 却没 `generate` | `prisma.app.update({ data: { graphJson } })` 类型对不上 | 新字段要先 `migrate dev`（自动 generate）或单独 `db:generate`，再让编辑器重新加载 |
| 反向关系 / 其他列被「顺手」改了 | 迁移里出现计划外的 DDL | 本次只加三列；改 schema 后**先看 Prisma 生成的 SQL 是否只含预期变更**再应用 |

---

## 13. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| Prisma 的 `Json` 类型 → PostgreSQL 的 `jsonb`（Prisma 生成即为 `JSONB`，无需手改）；为什么用 `jsonb` 而非 `text` / `json`（可索引、可查询、二进制存储） | **首次教学于本篇** |
| 「两态」的数据建模：草稿（`graphJson`）vs 发布快照（`publishedGraphJson`）——发布**拷贝一份快照**而非加状态位（编辑不打扰线上、回滚简单） | **首次教学于本篇** |
| 可空 JSON 列与「空图」的应用层语义：`null` ≠ `{}`（`jsonb_typeof(NULL)` 为 SQL 空）；存储层只记「有没有」、接口语义由应用层翻译成空图 / 404 | **首次教学于本篇** |
| Prisma `Json` 不支持普通字面量默认值 → 用「可空列 + 应用层默认」规避 | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：ORM / schema-first / Prisma 三件套 / 迁移（DDL 版本化）/ Prisma DSL（`model` / `@id` / `@map` / `@default` / `@@map`）/ `DATABASE_URL` 写法 / 迁移所有权 / `db:migrate` 脚本，见 `01-账号与认证/02-Prisma.md`；关系建模 / `@relation` / `onDelete: Cascade` / `@@index([ownerId])` 见 `02-应用管理/02-Prisma关系建模.md`；`pnpm --filter` 见 `00-项目初始化/03-monorepo与pnpm-workspace.md`；`docker exec psql` 自检见 `00-项目初始化/02-本地中间件Docker.md`；图的结构 / 接口 / 校验见 `03-画布/01-图JSON契约与校验.md`。
