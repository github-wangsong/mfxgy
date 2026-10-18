# 04 · SQLAlchemy JSONB 映射：postgresql JSONB / dict 往返 / 可空 JSON 列

> 所属：阶段 3 · 画布
> 本篇覆盖：`apps/api-py/app/models/app.py`
> **本篇首次教学：`sqlalchemy.dialects.postgresql.JSONB` 的用法与「为什么必须从 `postgresql` 方言显式导入」（通用 `JSON` vs `JSONB` 的差别）· JSONB 往返的 `dict`（Python）↔ object（TS）与 key 命名必须一致（camelCase）的实际约束 · 可空 JSON 列与 `None`（Python `None` ↔ 读出的 `None` ↔ 契约里的「空图」语义；SQL `NULL` vs JSON `null` 小坑）· 同一列在 Prisma（`Json?`）与 SQLAlchemy（`JSONB`）的声明对照**
> （`DeclarativeBase` / `Mapped` / `mapped_column` / `String` / `DateTime` / `ForeignKey` / `relationship` / `server_default` / **迁移所有权** 已在 `01-账号与认证/04-SQLAlchemy2.0.md`、`02-应用管理/04-SQLAlchemy关系建模.md` 教过；Prisma 的 `Json?` 与建列迁移 `20261018124928_add_app_graph` 见本阶段 · 02；本篇只引用、不重讲）

---

## 1. 本篇目标

- 把 Prisma 迁移新建的三列（`graph_json` / `published_graph_json` / `published_at`）**映射**到 Python 侧的 `App` 类。
- 全程**不产生任何 DDL**——建表/改表仍由 Prisma 独占（「迁移所有权」，见 `01-账号与认证/04-SQLAlchemy2.0.md`）。本篇只做「读得回、写得出」。
- 讲清本项目**最特殊的一列**：`jsonb`。它不是标量（不像 `String`/`DateTime` 那样一对一），而是**把一段结构化 JSON 原样存进数据库**——这正是「两套后端共享同一列、图必须等价」的关键。

**验收标准**：

1. `psql` 里这三列的物理类型正确：`graph_json` / `published_graph_json` 为 `jsonb`，`published_at` 为 `timestamp(3) without time zone`。
2. 已保存过草稿的行，`jsonb_typeof(graph_json) = 'object'`。
3. Python 侧 `select(App)` 读出的 `app.graph_json` 类型是 `dict`，其形状（键名与嵌套结构）与 TS 侧 Prisma 读出的 object **一致**。

> ⚠️ 本篇**不新增依赖、不改 `pyproject.toml`**。Prisma 已装好 `sqlalchemy` 与 `psycopg[binary]`（阶段 0 · 06 声明）。

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| `uv` 与 Python 3.12、`pyproject.toml` / `.venv` | 阶段 0 · 01、06 |
| PostgreSQL 已启动（Docker `mini-dify-db`） | 阶段 0 · 02 |
| **`apps` 表已由 Prisma 迁移创建**（含 `graph_json` / `published_graph_json` / `published_at`） | `03-画布/02-Prisma-JSONB与两态.md`（迁移 `20261018124928_add_app_graph`） |
| `App` 模型与 `SessionLocal`（阶段 2 已建 `apps` 映射与关系） | `02-应用管理/04-SQLAlchemy关系建模.md` |
| 契约里的 `Graph` schema（`version` / `nodes` / `edges`） | `03-画布/01-图JSON契约与校验.md` |

> 与阶段 1 · 04、阶段 2 · 04 一样，**本篇必须数据库在线**——因为要真正读这张表。

---

## 3. 先看清要做什么

阶段 2 的 `App` 只映射了 7 个标量列。本篇**只新增三列**（不改任何既有列、不加关系）：

```
apps/api-py/app/models/
├── app.py       # apps 表 → App；本篇新增 3 个画布列
└── user.py      # 未改动（见阶段 2 · 04）
```

Prisma 侧迁移（本阶段 · 02）新建的三列：

```sql
ALTER TABLE "apps" ADD COLUMN     "graph_json" JSONB,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_graph_json" JSONB;
```

**三列各自的语义**（与 `schema.prisma` 的注释一致）：

| 列 | 类型 | 含义 |
| --- | --- | --- |
| `graph_json` | `jsonb`（可空） | **草稿图**：随时可改；为 `NULL` 表示「尚未编辑」 |
| `published_graph_json` | `jsonb`（可空） | **发布快照**：只读；为 `NULL` 表示「从未发布过」 |
| `published_at` | `timestamp(3)`（可空） | 发布时刻；为 `NULL` 表示「从未发布过」 |

**心法一句话**：

> 前面所有列都是「**一个 Python 值 ↔ 一个数据库标量**」（`str`↔`text`、`datetime`↔`timestamp`）；`jsonb` 则是「**一个 Python 结构（`dict`）↔ 一段数据库 JSON**」——列里存的是**整张图**，键名与嵌套结构都是数据本身。

这与阶段 2 · 04 的差别只有「多了三列、其中两列是 JSON 类型」，**范式、Engine/Session、迁移所有权全部照旧**。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | **仓库根** | 确认依赖齐备（本篇无新增依赖） | `Audited N packages`，无报错 |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"` | 任意（需 Docker 在线） | **看三列的物理类型**，与模型逐字段对照 | `graph_json`/`published_graph_json` 为 `jsonb`；`published_at` 为 `timestamp(3)` |
| `uv run python -c "…JSONB 读取脚本…"` | **`apps/api-py` 目录** | 用映射读出一行，确认 `graph_json` 是 `dict` | 打印 `dict {...}` 或 `None` |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "select jsonb_typeof(graph_json) …"` | 任意 | 确认已保存的行确是 JSON **对象** | `object` |
| `uv run uvicorn app.main:app --reload --port 8000` | **`apps/api-py` 目录** | 启动服务（下一篇要用到） | `Uvicorn running on http://127.0.0.1:8000` |

> 从仓库根也可用 `pnpm dev:api-py`（根脚本为 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`，见阶段 0 · 06 §9）。读取脚本因为要 `import app`，**必须在 `apps/api-py` 目录内执行**（或用 `--directory` 切过去）。

---

## 5. 完整代码

### 5.1 `apps/api-py/app/models/app.py`（本篇新增 3 列）

**完整文件路径：`apps/api-py/app/models/app.py`**

```python
"""`apps` 表模型。

重要：该表的 DDL 由 TS 侧 Prisma 迁移拥有（`apps/api-ts/prisma/migrations`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class App(Base):
    __tablename__ = "apps"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    mode: Mapped[str] = mapped_column(String, nullable=False, server_default="chatflow")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # updated_at 现已由数据库层保证：迁移 `add_updated_at_default_and_trigger`
    # 加了 DEFAULT now() 与 BEFORE UPDATE 触发器（手工 SQL 也会刷新）。
    # 这里保留 SQLAlchemy 的 default/onupdate 作为应用层「双保险」：
    # 二者都取 now()，DB 触发器为权威、ORM 值作为兜底，不会冲突。
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=func.now(), onupdate=func.now()
    )
    # 画布（阶段 3）。DDL 由 TS 侧 Prisma 拥有（迁移 add_app_graph），此处只映射。
    # 列在 PG 上为 jsonb；graph_json 为 NULL 表示「尚未编辑」，读取时返回合法空图。
    graph_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    published_graph_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped["User"] = relationship("User", back_populates="apps")
```

**与前两阶段的差异**：只多了一段 import 与三行列声明（`graph_json` / `published_graph_json` / `published_at`）。其余列**一字未改**——这正体现「映射 Prisma 的新列」不碰已有列。

**新增行的逐行解释**

| 代码 | 作用 |
| --- | --- |
| `from typing import Any` | `dict[str, Any]` 里的 `Any`——图的内容是自由结构，元素类型不做约束 |
| `from sqlalchemy.dialects.postgresql import JSONB` | **从 PostgreSQL 方言**导入 JSONB 列类型（见 §6.1） |
| `graph_json: Mapped[dict[str, Any] \| None] = mapped_column(JSONB, nullable=True)` | 草稿图：列可空（`nullable=True`），Python 侧用 `dict[str, Any] \| None` 表示「可能是 dict、也可能是 `None`」 |
| `published_graph_json: ... JSONB, nullable=True` | 发布快照：同为可空 jsonb（见 §6.3 的「从未发布 = NULL」） |
| `published_at: ... DateTime(timezone=True), nullable=True` | 发布时刻：可空时间列。**注意**实际物理列是 `timestamp(3)` **无时区**（Prisma 的 `DateTime?`）；`timezone=True` 只是映射侧的声明，本篇不产生 DDL，写入策略见下一篇 §6.3 |

> ⚠️ **`nullable=True` 是可空列的写法**（对照 `nullable=False` 的非空列）。`Mapped[... | None]` 是类型层面的「可为 None」，`nullable=True` 是**列层面**的「可为 NULL」——两者要一起写，缺一易踩坑（见 §6.3、§8）。

## 6. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 3 · 04」并直接使用。

### 6.1 `sqlalchemy.dialects.postgresql.JSONB` —— 为什么必须从 `postgresql` 方言显式导入

**是什么**：`JSONB` 是 **PostgreSQL 特有的**列类型，住在 `sqlalchemy.dialects.postgresql` 这个「方言（dialect）子包」里。SQLAlchemy 的列类型分两层：

| 层 | 位置 | 例子 |
| --- | --- | --- |
| **通用类型**（跨库、与具体数据库无关） | `sqlalchemy` 顶层 | `String` / `DateTime` / `Integer` / `JSON` |
| **方言类型**（某数据库专有） | `sqlalchemy.dialects.<方言>` | `postgresql.JSONB` / `postgresql.UUID` / `postgresql.ARRAY` |

**基本语法**

```python
from sqlalchemy import JSON                     # 通用 JSON
from sqlalchemy.dialects.postgresql import JSONB  # PostgreSQL 专有：二进制 JSON
```

**通用 `JSON` vs `JSONB` 的差别**（这是本节的核心）

`JSON` 和 `JSONB` 是 **PostgreSQL 里两个不同的列类型**（不是 SQLAlchemy 的两种写法），它们在存储与能力上根本不同：

| 维度 | `json`（文本 JSON） | `jsonb`（二进制 JSON） |
| --- | --- | --- |
| 存储形式 | 原样存**文本**（保留空白、键顺序、重复键） | 存**解析后的二进制结构**（去空白、去重复键、键排序） |
| 写入 | 快（几乎不处理） | 稍慢（要解析 + 重建） |
| 读取/查询 | 每次要**重新解析** | 直接可用，**快** |
| 索引 | **不能建索引** | 支持 **GIN 索引** |
| 操作符 | 少 | 丰富（`@>` 包含、`->`/`->>` 取值、`?` 键存在…） |
| `jsonb_typeof()` | 可用（先解析） | 可用（直接判断结构类型） |

**SQLAlchemy 的 `JSON`（通用类型）在 PG 上落到哪个？** 落到 **`json`**（文本 JSON）——而不是 `jsonb`。因此：**要用 `JSONB` 精确对齐 Prisma 建的 `jsonb` 列，就必须从 `postgresql` 方言显式导入 `JSONB`，不能图省事用通用 `JSON`。**

**本例为什么这么用**：

1. **Prisma 的 `Json?` 在 PostgreSQL 上默认就是 `jsonb`**——迁移原文 `ADD COLUMN "graph_json" JSONB` 已明确是 `jsonb`。Python 端必须映射成同一个类型，两端才是「同一列」。
2. **显式从方言导入是「意图声明」**：一眼可见「这一列是 PostgreSQL 特有的 jsonb」，提醒读者本项目依赖 PG，而不是可移植的通用 JSON。
3. 虽然 psycopg 通常能在 `json` / `jsonb` 之间自动转换、读起来「都能出 dict」，但**列类型不匹配会带来微妙差异**（索引能力、`jsonb_typeof` 语义、写入行为），不值得为省一行 import 冒风险。

> **记忆**：`sqlalchemy.JSON` = 通用「JSON 字符串」；`postgresql.JSONB` = PG 的「二进制 JSON」。**对齐 Prisma 的 `Json?` 用后者。**

### 6.2 JSONB 往返：Python 读出的 `dict` ↔ TS 读出的 object，以及 key 命名约束

**是什么**：JSONB 列在「数据库 ↔ Python ↔ TS」之间往返时，数值会被自动转成各语言的原生结构：

```
PostgreSQL  jsonb  ──psycopg 适配器──►  Python dict / list / str / int / bool / None
           │
           └──────Prisma Client──────►  JS object / Array / string / number / boolean / null
```

- **Python 读到的是 `dict`**（顶层若是对象）或 `list`（顶层若是数组）——不需要 `json.loads()`，SQLAlchemy + psycopg 已经帮你解析好了。写回时给一个 `dict`，它也会自动序列化成 jsonb。
- **TS 读到的是 object**（Prisma 的 `Prisma.JsonValue`）。
- 两边都不丢结构：嵌套的 `nodes[]` / `edges[]` / `position{x,y}` 都原样保留。

**本例为什么引出「key 命名必须一致」这个约束**：关系列（如 `owner_id`）的取值由 DDL/外键约束，两端**不可能写歪**；但 **JSONB 里的键名是数据本身**，数据库**不做任何校验**——Python 写入什么键，TS 就读到什么键。于是「两端图等价」的实际前提是：**两端用同一套键名（camelCase）**。

对照契约（`packages/contract/openapi.yaml` 的 `Graph` / `GraphNode` / `GraphEdge`）与两端实现：

| 层 | 键名样例 | 由谁决定 |
| --- | --- | --- |
| 契约字段 | `version` / `nodes` / `edges` / `sourceHandle` / `targetHandle`（**camelCase**） | 契约唯一真源 |
| api-py 写入 | Pydantic 模型字段名**直接就是 camelCase**（`GraphEdge.sourceHandle`、`GraphEdge.targetHandle`），`model_dump()` 原样产出 camelCase 键 | `app/api/graph.py` |
| api-ts 写入 | DTO 经 `JSON.parse(JSON.stringify(body))` **原样**落库（也保留 camelCase） | `graph.controller.ts` 的 `toPlainGraph` |

**关键做法：Python 侧不要对图的键名做 snake_case 转换（不要用会改名的 Pydantic 别名）。** 例如若把模型写成 `source_handle: str` 再 `alias="sourceHandle"`，虽然进出 API 仍是 camelCase，但**落库那一刻**若 dump 出的是 snake_case，数据库里的 JSON 就会和 TS 侧写的不一样了——同一列里混进两种键名，图就**不再等价**。

> **一句话**：**JSONB 没有 DDL 帮你兜底，键名就是「数据契约」**。两端都按契约的 camelCase 原样存，`dict ↔ object` 才能逐键对应。

### 6.3 可空 JSON 列与 `None` —— Python `None` ↔ 读出的 `None` ↔ 契约里的「空图」语义

**是什么**：`graph_json` 是**可空**的。`NULL` 在这里承载一个**业务语义**：「这个应用**尚未编辑过**画布」（草稿不存在）。同理 `published_graph_json` / `published_at` 为 `NULL` 表示「从未发布过」。

**三层的对应关系**

| 层 | 值 | 含义 |
| --- | --- | --- |
| 数据库 | `NULL` | 从未写入过该列（新建应用时不写这三个字段） |
| Python（ORM 读出） | `None` | `Mapped[dict[str, Any] \| None]` 的「`None` 分支」 |
| 契约/API | **不返回 `null`**，而返回**合法空图** `{"version":"1","nodes":[],"edges":[]}` | `Graph` 是必填结构，不能是 `null`；「尚未编辑」用空图对外表达 |

**Python 侧如何把 `None` 变成空图**（机制在下一篇 `03-画布/05-FastAPI图模块.md` §5 的 `_draft_of`）：

```python
# 草稿为 NULL 表示尚未编辑：返回合法空图
def _draft_of(app: App) -> dict[str, Any]:
    return _EMPTY_GRAPH if app.graph_json is None else app.graph_json
```

也就是：**ORM 层保留 `None` 的真相，转换在 API 层做**——不把「没编辑」和「存了一张空图」混为一谈（后者存的是 JSON 对象，前者是 `NULL`）。

**两个必须一起写、别混的维度**

```python
graph_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
#            └── 类型：可为 None ──┘              └─ 列：可为 NULL ─┘
```

- `Mapped[dict[str, Any] | None]`：**Python 类型**层面的可空（给 IDE / 类型检查器看）。
- `nullable=True`：**数据库列**层面的可空（决定 DDL 是否 `NOT NULL`；本项目 DDL 已是 Nullable，这里只是描述）。
- 只写一个都可能出问题：类型写了 `| None` 但 `nullable=False` → 真写 `None` 时 DB 报非空违例；`nullable=True` 但不写 `| None` → 类型检查器不认 `None` 分支。

**⚠️ 一个真实的小坑：SQL `NULL` vs JSON `null`**（SQLAlchemy 的 `none_as_null`）

`jsonb` 列里，「**没有值**」有两层可能的表达：**SQL `NULL`**（列本来就没写）与 **JSON `null`**（列里确实存了一个 JSON `null` 值 `'null'::jsonb`）。SQLAlchemy 的 `JSON`/`JSONB` 类型默认 **`none_as_null=False`**，含义是：**你把 Python `None` 显式赋给该列并 flush 时，它存的是 JSON 的 `null` 值，而不是 SQL `NULL`**（官方文档原文：`none_as_null=False` results in the Python constant `None` evaluating to the value of JSON `"null"`）。

- **本项目不受影响**：创建应用时这三个字段**根本没被赋值**，SQLAlchemy 在 `INSERT` 里省略这些列 → PostgreSQL 填入 **SQL `NULL`**。读取时 SQL `NULL` 与 JSON `null` 都会被 psycopg 转成 Python `None`，`_draft_of` 判断 `is None` 两种情形都成立。
- 若将来**真想存 SQL `NULL`**，可用 `none_as_null=True`，或显式传 `sqlalchemy.null()`；若想**强制存 JSON `null`**，可传 `sqlalchemy.JSON.NULL`。

> **一句话**：可空 JSON 列的「没值」在读取侧统一是 `None`；只是「写入侧」要意识到 `None` 与 `null()` 落入的是两种不同的空。

### 6.4 重点对照：同一列，Prisma（`Json?`）vs SQLAlchemy（`JSONB`）的声明

同一张 `apps` 表的三列，在 TS 侧（schema-first）与 Python 侧（code-first）各写一次：

| 方面 | Prisma（api-ts · schema-first） | SQLAlchemy（api-py · code-first） |
| --- | --- | --- |
| 定义文件 | `apps/api-ts/prisma/schema.prisma` 的 `model App` | `apps/api-py/app/models/app.py` 的 `class App` |
| 草稿列声明 | `graphJson Json? @map("graph_json")` | `graph_json: Mapped[dict[str, Any] \| None] = mapped_column(JSONB, nullable=True)` |
| 发布图列声明 | `publishedGraphJson Json? @map("published_graph_json")` | `published_graph_json: Mapped[dict[str, Any] \| None] = mapped_column(JSONB, nullable=True)` |
| 发布时刻列声明 | `publishedAt DateTime? @map("published_at")` | `published_at: Mapped[datetime \| None] = mapped_column(DateTime(timezone=True), nullable=True)` |
| PG 物理类型 | `Json` → **`jsonb`**；`DateTime?` → `timestamp(3)` | `JSONB` → **`jsonb`**（描述同一列）；`DateTime` → `timestamp` |
| 可空表达 | 字段后加 `?`（`Json?`） | `Mapped[... \| None]` + `nullable=True` |
| Python/TS 运行时类型 | `Prisma.JsonValue \| null`（object/array/原始值/`null`） | `dict[str, Any] \| None`（本项目图顶层恒为对象） |
| 谁建列 | **Prisma 迁移** `20261018124928_add_app_graph`（DDL 拥有者） | **不建列**，只映射 |

**一句话总结两者差异**：

- **Prisma 的 `Json`** 是一种「TypeScript 视角的 JSON」——用 `?` 表达可空、用 `@map` 桥接列名，TypeScript 里它就是 `Prisma.JsonValue`。
- **SQLAlchemy 的 `JSONB`** 是「PostgreSQL 视角的二进制 JSON」——需要从方言导入、用 `nullable=True` 表达可空、用 `Mapped[dict \| None]` 表达 Python 类型。
- 两者**指向同一个物理列** `jsonb`，也因此必须共享同一套**键名约定**（§6.2）。

---

## 7. 验收自测

### 7.1 看列类型（确认 Prisma 建了 jsonb）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d apps"
```

**实测输出**（节选三列）

```
   Column             |              Type              | Nullable | Default
----------------------+--------------------------------+----------+-------------------
 ...
 graph_json           | jsonb                          |          |
 published_graph_json | jsonb                          |          |
 published_at         | timestamp(3) without time zone |          |
```

与 `app.py` 对照：`graph_json` / `published_graph_json` 是 `jsonb`（对应 `JSONB`），`published_at` 是 `timestamp(3)`（对应 `DateTime`）——**类型对得上**。

### 7.2 查 `jsonb_typeof`（确认已保存的图是 JSON 对象）

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "select id, jsonb_typeof(graph_json) from apps;"
```

**预期**：已通过 `PUT /apps/{id}/graph` 保存过草稿的行，`jsonb_typeof` 为 **`object`**；从未编辑过的行为 **`NULL`**（列本身是 SQL NULL）。这也顺带验证了：草稿顶层确实是一个 JSON **对象**（`{"version":"1","nodes":[...],"edges":[...]}`），而不是数组或标量。

### 7.3 用映射读出 `dict`（本篇核心验收）

**命令（在 `apps/api-py` 目录执行）**

```bash
uv run python -c "from app.db import SessionLocal; from app.models.app import App; from sqlalchemy import select; s=SessionLocal(); rows=s.scalars(select(App)).all(); print('apps:', len(rows)); [print(type(a.graph_json).__name__, a.graph_json) for a in rows[:1]]; s.close()"
```

**实测输出**

```
apps: N
dict {'version': '1', 'nodes': [...], 'edges': [...]}
```

- `type(a.graph_json).__name__` 打印 **`dict`**，说明 JSONB 已由 psycopg 自动解析为 Python 字典，**无需手工 `json.loads`**。
- 打印出的键名是 **camelCase**（如 `sourceHandle`）——与契约、与 TS 侧一致。
- 若该行从未编辑，则打印 `NoneType None`。

### 7.4 跨后端形状一致（与 TS 对照）

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| Python 读到 `dict` | §7.3 脚本 | `dict {...}`（键名为 camelCase） |
| TS 读到 object | api-ts `GET /apps/{id}/graph`（或 Prisma 查询） | 同形状 object（键名逐字相同） |
| 物理类型对齐 | §7.1 `\d apps` | `jsonb` / `jsonb` / `timestamp(3)` |
| 已存的图是对象 | §7.2 `jsonb_typeof` | `object` |
| **未产生 DDL** | 观察库里表数量 / 迁移记录 | Python 侧不新增、不修改任何表 |

> 「未产生 DDL」怎么确认？本篇 Python 侧只执行 `SELECT` 与后续的 `UPDATE`（下一篇才有写接口），从不执行 `CREATE`/`ALTER`；`psql` 的 `\dt` 看到的表清单与只跑过 Prisma 迁移时一致。

---

## 8. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 用通用 `from sqlalchemy import JSON` 映射 `jsonb` 列 | 列类型「看起来能用」，但与 Prisma 建的 `jsonb` 不是同一类型，索引/`jsonb_typeof` 语义会有出入 | Prisma 的 `Json?` 在 PG 上是 **`jsonb`**；必须 `from sqlalchemy.dialects.postgresql import JSONB`（见 §6.1） |
| 以为 JSONB 读出来是字符串 | 直接 `json.loads(app.graph_json)` 报 `TypeError` | psycopg 已把它解析成 `dict`；直接当字典用即可（见 §6.2） |
| Python 侧给图的键名做了 snake_case 转换 | 两端 GET 的图「不等价」 | JSONB 的键名就是数据契约；两端都必须按契约的 **camelCase** 原样存，别用会改名的别名（见 §6.2） |
| 类型写了 `\| None` 却没写 `nullable=True` | 写 `None` 时 DB 报非空违例 | 两个维度要一起写：`Mapped[... \| None]`（类型可空）+ `nullable=True`（列可空）（见 §6.3） |
| 把 Python `None` 显式写进 jsonb，以为会得到 SQL `NULL` | 该列里存的是 JSON `null` 值而非 SQL NULL | SQLAlchemy 默认 `none_as_null=False`：`None` → JSON `"null"`。本项目**从不显式赋 None**（新建时省略该列 → SQL NULL），不受影响；要强制 SQL NULL 用 `none_as_null=True` 或 `null()`（见 §6.3） |
| 以为 `NULL` 与「存了一张空图」是一回事 | 语义混淆 | `NULL` = **从未编辑**；空图 = **确实存了一个对象** `{"version":"1","nodes":[],"edges":[]}`。`_draft_of` 把二者在 API 层区分（见 §6.3） |
| 改列类型想「让 SQLAlchemy 帮你迁移」 | 两套迁移系统打架 | **DDL 归 Prisma**（迁移所有权）；Python 只映射，绝不 `ALTER TABLE`（见 `01-账号与认证/04-SQLAlchemy2.0.md`） |
| 在仓库根跑读取脚本 | `ModuleNotFoundError: No module named 'app'` | 进 `apps/api-py`，或用 `uv run --directory apps/api-py …`（见阶段 0 · 06 §9） |
| `uv` 不被识别 | `The term 'uv' is not recognized` | `uv` 已在用户 PATH；只有安装前已打开的 shell 继承旧 PATH，重启终端 / IDE 即可（见阶段 0 · 01） |

---

## 9. 与 api-ts 的对照

| 概念 | Prisma（api-ts） | SQLAlchemy（api-py） |
| --- | --- | --- |
| JSON 列类型来源 | schema DSL 的 `Json`（PG 上默认 `jsonb`） | 方言子包的 `postgresql.JSONB` |
| 声明写法 | `graphJson Json? @map("graph_json")` | `graph_json: Mapped[dict[str, Any] \| None] = mapped_column(JSONB, nullable=True)` |
| 可空表达 | 字段后缀 `?` | `Mapped[... \| None]` + `nullable=True` |
| 运行时类型 | `Prisma.JsonValue \| null`（JS object） | `dict[str, Any] \| None`（Python dict） |
| 读写方式 | 直接赋 object、读回 object（Prisma 处理序列化） | 直接赋 dict、读回 dict（psycopg 处理序列化） |
| 键名约定 | 落库前 `JSON.parse(JSON.stringify(body))` 原样保留 camelCase | `model_dump()` 原样产出 camelCase（字段名即 camelCase） |
| 空值语义 | `null` = 尚未编辑 / 从未发布 | `None` = 尚未编辑 / 从未发布；API 层转空图 |
| 谁建列 | **Prisma 迁移** `add_app_graph`（DDL 拥有者） | **不建列**，仅映射 |

两套实现操作的是**同一张 `apps` 表的同三列**，也因此必须共享**同一套键名与空值语义**，图才等价。

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| `sqlalchemy.dialects.postgresql.JSONB` 的用法与「必须从方言显式导入」 | **首次教学于本篇** |
| 通用 `JSON` vs `JSONB` 的差别（文本 JSON vs 二进制 JSON；索引/操作符/存储） | **首次教学于本篇** |
| JSONB 往返的 `dict`（Python）↔ object（TS）；key 命名必须一致（camelCase） | **首次教学于本篇** |
| 可空 JSON 列与 `None`；SQL `NULL` vs JSON `null`（`none_as_null`） | **首次教学于本篇** |
| 同一列在 Prisma（`Json?`）与 SQLAlchemy（`JSONB`）的声明并列对照 | **首次教学于本篇** |
