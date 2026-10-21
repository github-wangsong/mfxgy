# 01 · ORM 的 PG 特性实战

> 所属：阶段 11 · 综合实战：mini-dify 数据层
> 本篇覆盖：把前面各阶段的 PG 特性（`jsonb`、触发器、`vector`、外键级联、`timestamp`）在 Prisma 与 SQLAlchemy 两套 ORM 里的**映射方式**收束；双栈迁移分工原则（Prisma 拥有 DDL、SQLAlchemy 只映射）
> **本篇首次教学：Prisma 的 `Json`→PG `jsonb`、`DateTime`→`timestamp(3)`、`@default(uuid())` 应用层生成、`@updatedAt` 与 DB 触发器双保险、`Unsupported("...")` 处理 Prisma 不支持的类型（如 `vector`）并走原生 SQL、迁移里内嵌原生 SQL（`CREATE EXTENSION`/HNSW 索引/触发器函数）；SQLAlchemy 的 `sqlalchemy.dialects.postgresql.JSONB`、`pgvector.sqlalchemy.Vector(1536)`、`server_default`（DB 层）vs `default`/`onupdate`（应用层）、`passive_deletes=True` 配合 `ON DELETE CASCADE`；双栈「Prisma 拥有 DDL、SQLAlchemy 只映射不建表」的分工原则**（jsonb 操作符见 `03-01`、GIN 索引见 `03-02`、触发器见 `05-02`、vector 见 `08-02`，本篇只讲 ORM 映射不再重讲）
> 预告：`11-02-事件表+向量检索闭环.md` 设计 `runs`/`events` SSE 事件表（JSONB + 时间分区思路）与 pgvector 知识库端到端。

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。
> Prisma 三件套与迁移已在 `docs/tutorial/01-账号与认证/02-Prisma.md` 教过；SQLAlchemy 模型/Session 在 `04-SQLAlchemy2.0.md`。

---

## 1. 本篇目标

- 把前面散落在各阶段的 PG 特性，在 **Prisma**（TS）与 **SQLAlchemy**（Python）两个 ORM 里找到对应映射。
- 理解项目「**Prisma 拥有 DDL，SQLAlchemy 只映射**」的双栈分工原则及其理由。
- 掌握 ORM 无法直接表达时的兜底手段：Prisma 的 `Unsupported` + 原生 SQL、SQLAlchemy 的方言类型。
- 能对照 MySQL 说出同一套 ORM 在两库上的映射差异。

**验收标准**

1. 说出 Prisma `Json` / `DateTime` / `Unsupported` 在 PG 上的物理列类型。
2. 说出 SQLAlchemy `JSONB` 与 `Vector(1536)` 的 import 路径。
3. 解释 `server_default` 与 `default` 的区别，以及 `@updatedAt` + DB 触发器为何要双保险。
4. 解释 `passive_deletes=True` 解决了什么问题。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成阶段 3（jsonb）、5（触发器）、8（pgvector）、tutorial 阶段 1 的 Prisma/SQLAlchemy |
| 代码 | 已读 `apps/api-ts/prisma/schema.prisma`、`apps/api-py/app/models/*.py` |
| 知识 | PG 的 jsonb/触发器/vector/外键级联语义 |

---

## 3. 双栈分工原则：为什么 Prisma 拥有 DDL（首次教学）

项目同时用 Prisma（NestJS 侧）和 SQLAlchemy（FastAPI 侧）操作**同一个 PG 库**。关键约定：

> **DDL（建表/改表）只由 Prisma 迁移产生；SQLAlchemy 只做 ORM 映射与读写，不产生任何 DDL。**

理由：

| 问题 | 若两套都建表 | 项目做法 |
| --- | --- | --- |
| 迁移冲突 | Prisma 与 Alembic 各产生一份迁移，互相覆盖 | **只让 Prisma 出迁移** |
| 类型对齐 | 两边各自建表，列类型/约束易不一致 | **以 Prisma 的迁移为准**，SQLAlchemy 按结果映射 |
| 触发器/原生 SQL | Prisma 迁移可内嵌原生 SQL，集中管理 | **所有原生 SQL（扩展、索引、触发器）写在 Prisma 迁移里** |

> SQLAlchemy 模型文件顶部注释明确写了「**该表的 DDL 由 TS 侧 Prisma 迁移拥有，Python 只做映射与读写、不产生 DDL**」（见 `apps/api-py/app/models/app.py` 第 1-4 行）。

---

## 4. Prisma 侧的 PG 特性映射（首次教学）

### 4.1 `Json` → `jsonb`

```prisma
model App {
  graphJson          Json?     @map("graph_json")
  publishedGraphJson Json?     @map("published_graph_json")
}
```

> Prisma 的 `Json` 类型在 PG 上**默认映射为 `jsonb`**（不是 `json`）。所以项目画布两态（草稿/发布快照）天然享受到 jsonb 的 GIN 索引与操作符能力（`03-01`/`03-02`）。
> 对照 MySQL：Prisma `Json` 在 MySQL 上映射为 `JSON`（8.0+），两者语义不同（jsonb 可索引，MySQL JSON 也支持函数索引但较弱）。

### 4.2 `DateTime` → `timestamp(3)`

```prisma
model App {
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")
  publishedAt DateTime? @map("published_at")
}
```

> Prisma 的 `DateTime` 在 PG 上映射为 **`timestamp(3)`（无时区，毫秒精度）**。项目特意用**无时区** `timestamp`，由应用层统一 UTC 写入（见 `apps/api-py/app/timefmt.py` 的 `iso_z()`），避免时区歧义（`00-03` 讲过 `timestamptz` vs `timestamp` 选型）。

### 4.3 `@default(uuid())`：应用层生成

```prisma
model App {
  id String @id @default(uuid())
}
```

> Prisma 的 `@default(uuid())` 是**应用层**默认值：由 Prisma Client 在 INSERT 时生成 UUID 传入，**数据库列没有 DEFAULT**。所以 SQLAlchemy 侧不能依赖 `server_default`，必须在应用层生成 id（Python 侧 `randomUUID()`）。

### 4.4 `@updatedAt` + DB 触发器：双保险

```prisma
model App {
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")
}
```

Prisma 的 `@updatedAt` 会在应用层 UPDATE 时刷新 `updated_at`。但项目又在 Prisma 迁移里加了 **DB 层触发器**（见 `add_updated_at_default_and_trigger/migration.sql`）：

```sql
CREATE OR REPLACE FUNCTION apps_set_updated_at() RETURNS trigger AS $$
BEGIN NEW."updated_at" = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "apps_set_updated_at"
BEFORE UPDATE ON "apps" FOR EACH ROW
EXECUTE FUNCTION apps_set_updated_at();
```

> **双保险**：ORM 更新时应用层设值（`@updatedAt`），DB 触发器兜底（覆盖绕过 ORM 的手工 SQL）。两者都取 `now()`，不会冲突。这是「让 `updated_at` 永远正确」的稳健做法（`05-02` 解释过触发器为何安全）。

### 4.5 `Unsupported`：处理 Prisma 不认识的类型

```prisma
model Chunk {
  embedding Unsupported("vector(1536)")?
}
```

> Prisma 不支持 pgvector 的 `vector` 类型，用 **`Unsupported("...")`** 把 PG 列类型原样写进迁移。但 Prisma Client **无法读写**该列，项目用 `$queryRaw`/`$executeRaw` 原生 SQL 操作向量（见 `kb.service.ts` 的 `toVectorLiteral()` + `::vector`，`08-02`）。
> 这是 ORM 与「数据库原生能力」共存的标准模式：ORM 管不了的，降级到原生 SQL。

### 4.6 迁移里内嵌原生 SQL

Prisma 迁移是 `.sql` 文件，可直接写原生 SQL。项目用了三处：

| 迁移 | 原生 SQL 内容 |
| --- | --- |
| `add_updated_at_default_and_trigger` | `ALTER COLUMN ... SET DEFAULT now()` + 触发器函数 + 触发器 |
| `add_knowledge_base` | `CREATE EXTENSION IF NOT EXISTS vector` |
| `prisma/sql/hnsw.sql` | `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` |

> Prisma schema 里没法声明「建扩展」「建 HNSW 索引」「建触发器」，就用**迁移文件里的原生 SQL 补齐**。这是 Prisma 用 PG 高级特性的标准姿势。

---

## 5. SQLAlchemy 侧的 PG 方言映射（首次教学）

### 5.1 `JSONB` 类型

```python
from sqlalchemy.dialects.postgresql import JSONB

class App(Base):
    graph_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    published_graph_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

> `sqlalchemy.dialects.postgresql.JSONB` 是 PG 专用方言类型，映射到 `jsonb`。SQLAlchemy 会自动把 Python `dict` ↔ PG `jsonb` 序列化。
> 对照：SQLAlchemy 通用 `JSON` 类型在 PG 上映射为 `json`（文本），要 `jsonb` 必须用方言版 `JSONB`。

### 5.2 `Vector(1536)`：pgvector 的 SQLAlchemy 支持

```python
from pgvector.sqlalchemy import Vector

class Chunk(Base):
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
```

> `pgvector` 官方提供了 SQLAlchemy 集成，`Vector(1536)` 直接映射 `vector(1536)`，Python `list[float]` ↔ PG `vector`。这比 Prisma 的 `Unsupported` + 原生 SQL 方便得多。

### 5.3 `server_default` vs `default`/`onupdate`

```python
created_at = mapped_column(DateTime, nullable=False, server_default=func.now())
updated_at = mapped_column(DateTime, nullable=False, default=func.now(), onupdate=func.now())
```

| 写法 | 生效层 | 说明 |
| --- | --- | --- |
| `server_default=func.now()` | **DB 层** | 生成 `DEFAULT now()` 到 DDL（但本项目 DDL 由 Prisma 出，这里不生效，仅映射） |
| `default=func.now()` | **应用层** | SQLAlchemy INSERT 时填充 |
| `onupdate=func.now()` | **应用层** | SQLAlchemy UPDATE 时刷新（对应 Prisma 的 `@updatedAt`） |

> 本项目 `created_at` 用 `server_default`（因为 Prisma 迁移确实建了 `DEFAULT now()`），`updated_at` 用 `default`+`onupdate` 作为应用层兜底，权威值由 DB 触发器保证（§4.4）。

### 5.4 `passive_deletes=True`：把级联交给 DB

```python
class KnowledgeBase(Base):
    documents: Mapped[list["Document"]] = relationship(
        "Document", back_populates="knowledge_base", passive_deletes=True
    )
```

> 外键在迁移里是 `ON DELETE CASCADE`（Prisma 出的 DDL）。若不加 `passive_deletes=True`，SQLAlchemy 删除 `KnowledgeBase` 时会**先把 `documents.knowledge_base_id` 置 NULL**，再删——但该列是 `NOT NULL`，触发 `NotNullViolation`。
> 加 `passive_deletes=True` 后，SQLAlchemy **不碰子行**，直接由 DB 的 `ON DELETE CASCADE` 级联删除。这是「让 ORM 不要多管闲事、信任 DB 约束」的典型用法。

---

## 6. 双栈映射对照表

| PG 特性 | Prisma | SQLAlchemy |
| --- | --- | --- |
| `jsonb` | `Json`（默认 jsonb） | `from sqlalchemy.dialects.postgresql import JSONB` |
| `vector(1536)` | `Unsupported("vector(1536)")` + 原生 SQL | `from pgvector.sqlalchemy import Vector` |
| `timestamp(3)` | `DateTime` | `DateTime`（naive，与无时区对齐） |
| 应用层 UUID | `@default(uuid())` | Python `randomUUID()` |
| `updated_at` | `@updatedAt` | `onupdate=func.now()` |
| DB 触发器 | 迁移里内嵌 `CREATE TRIGGER` | SQLAlchemy 不感知，由 DB 兜底 |
| `ON DELETE CASCADE` | `onDelete: Cascade` | `passive_deletes=True` 交给 DB |

---

## 7. 与 MySQL ORM 对照速查

| PG 能力 | Prisma(PG) | Prisma(MySQL) | SQLAlchemy(PG) | SQLAlchemy(MySQL) |
| --- | --- | --- | --- | --- |
| 半结构化 | `Json`→`jsonb` | `Json`→`JSON` | `JSONB` | `JSON` |
| 向量 | `Unsupported`+原生SQL | 无原生 | `Vector(1536)` | 无原生 |
| 数组 | 无（用 jsonb 存） | 无 | `ARRAY(Integer)` 等 | 无 |
| 枚举 | `enum`→PG `ENUM` | `enum`→`ENUM` | `sqlalchemy.Enum` | `sqlalchemy.Enum` |
| 触发器 | 迁移原生 SQL | 迁移原生 SQL | 不感知 | 不感知 |

> 项目当前没用 PG 的原生数组和枚举类型（用 `jsonb` 和 `String` 代替），这是**跨 ORM 易对齐**的取舍——Prisma 对 PG 数组/枚举的支持虽有，但与 SQLAlchemy 映射时要额外对齐，项目选择用更通用的类型降低双栈复杂度。

---

## 8. 验收自测

### 8.1 Prisma 映射识别

```prisma
model Foo {
  id      String   @id @default(uuid())
  data    Json?
  vec     Unsupported("vector(768)")?
  updated DateTime @updatedAt
}
```

说出四列在 PG 上的物理类型，以及哪些列 Prisma Client 不能直接读写（`vec`）。

### 8.2 SQLAlchemy import 路径

写出 `JSONB` 和 `Vector(1536)` 的 import 语句。

### 8.3 解释双保险

为什么 `updated_at` 同时有 Prisma `@updatedAt` 和 DB 触发器？谁是权威？

### 8.4 解释 `passive_deletes`

不加会导致什么错误？加了之后级联删除由谁负责？

---

## 9. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| Prisma 查询 vector 列报类型错误 | Prisma 不支持 `Unsupported` 列的 Client 读写 | 用 `$queryRaw` / `$executeRaw` 原生 SQL |
| SQLAlchemy 删除父记录报 `NotNullViolation` | `relationship` 没加 `passive_deletes=True`，SQLAlchemy 先把子行外键置 NULL | 加 `passive_deletes=True`，让 DB `ON DELETE CASCADE` 处理 |
| `updated_at` 手工 SQL 更新后没变 | 只有应用层 `@updatedAt`，没 DB 触发器 | 加 `BEFORE UPDATE` 触发器兜底 |
| 两套迁移系统冲突 | SQLAlchemy 也跑了 `create_all` / Alembic | DDL 只由 Prisma 出，SQLAlchemy 只映射 |
| `DateTime` 时区错乱 | Prisma `DateTime` 是 `timestamp` 无时区，应用层没统一 UTC | 应用层统一 UTC 写入（项目 `timefmt.iso_z()`） |

---

## 10. 本篇小结

- **Prisma**：`Json`→`jsonb`、`DateTime`→`timestamp(3)`、`@default(uuid())` 应用层、`@updatedAt`+触发器双保险、`Unsupported` 兜底 Prisma 不支持的类型、迁移内嵌原生 SQL（扩展/索引/触发器）。
- **SQLAlchemy**：`dialects.postgresql.JSONB`、`pgvector.sqlalchemy.Vector`、`server_default`(DB) vs `default`/`onupdate`(应用)、`passive_deletes=True` 信任 DB 级联。
- **双栈分工**：Prisma 拥有全部 DDL，SQLAlchemy 只映射不建表，避免迁移冲突。
- 项目用通用类型（`jsonb` 代替数组/枚举）降低双栈对齐成本，ORM 管不了的（vector）降级原生 SQL。

下一篇 `11-02-事件表+向量检索闭环.md`：设计 `runs`/`events` 表存 SSE 事件（JSONB + 时间分区思路），并串起 pgvector 知识库的「写入→查询→检索」端到端闭环。