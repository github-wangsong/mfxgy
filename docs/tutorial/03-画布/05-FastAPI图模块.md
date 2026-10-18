# 05 · FastAPI 图模块：纯函数校验 / 文案逐字节对齐 / 存储与展示时区分离

> 所属：阶段 3 · 画布
> 本篇覆盖：`apps/api-py/app/graph/__init__.py`、`apps/api-py/app/graph/validator.py`、`apps/api-py/app/api/graph.py`、`apps/api-py/app/main.py`、`apps/api-py/app/errors.py`
> **本篇首次教学：「业务规则用纯函数」在 Python 侧的实现（`validate_graph(graph) -> list[str]`，与 TS 的 `validateGraph` 逐条对齐）· 两端校验文案必须逐字节相同的意义与方法（对照 `packages/contract/error-messages.md` §3）· `published_at` 以 naive-UTC 写入、出参再用 `iso_z()` 归一为 `...Z`（「存储时区」与「展示时区」分离）· 一个真实的 bug 修复：`_enum_values` 从「按 `" or "` 切分」改为「用引号正则抽取」（`Literal` 有 3 个及以上取值时原实现会切错）**
> （`APIRouter`/`include_router`/`response_model`/`ConfigDict(extra="forbid")`/`Literal` 见阶段 0 · 06；`Depends`/`get_db`/`get_current_user`/异常处理器 `{statusCode,message,error}` 见 `01-账号与认证/05-FastAPI认证.md`；`iso_z()` 见 `02-应用管理/07-验收.md`；`_find_owned`/404 归属校验见 `02-应用管理/05-FastAPI应用模块.md`；`JSONB` 映射见本阶段 · 04；图契约与 TS 侧 Prisma 见本阶段 · 01、02——以上**只引用、不重讲**）

---

## 1. 本篇目标

- 在 Python 后端实现契约里的四个图接口，行为与 NestJS 侧 `GraphController` / `GraphService` **逐字段、逐字节一致**：
  - `GET /apps/{id}/graph`（读取草稿；从未编辑时返回合法空图）
  - `PUT /apps/{id}/graph`（保存草稿；先语义校验，不通过 400）
  - `POST /apps/{id}/graph/publish`（把当前草稿快照为已发布图；校验草稿）
  - `GET /apps/{id}/graph/published`（读取已发布图；从未发布时 404）
- 讲清**「图 = 数据」**：后端只负责**存取 + 校验**，把这段 JSON 原样落库；把它编译成可执行图是阶段 4 的事。
- 讲清 Python 侧如何用**纯函数**表达业务规则，从而与 TS 的纯函数**逐条对齐**；以及**校验文案逐字节相同**为什么重要、怎么做。
- 复现并修复一个**真实的 bug**：`app/errors.py` 的 `_enum_values` 在 `Literal` 有 3+ 取值时会把枚举值切错，导致与 api-ts 的 `message` **不再逐字节相同**。

**验收标准（状态码 + 响应体要点，均与 api-ts 完全一致）**：

| 场景 | 状态码 | 响应体要点 |
| --- | --- | --- |
| 未编辑时 `GET .../graph` | 200 | `{"version":"1","nodes":[],"edges":[]}` |
| `PUT .../graph`（合法图） | 200 | 返回保存后的草稿，**与请求体逐字段一致** |
| `PUT .../graph`（图不合法） | **400** | `{"statusCode":400,"message":"<校验文案>","error":"Bad Request"}` |
| `POST .../graph/publish`（草稿合法） | 200 | `{"publishedAt":"…Z","graph":{…}}`（`publishedAt` 为**毫秒 + `Z`**） |
| `POST .../graph/publish`（草稿不合法） | **400** | 同图校验文案 |
| `GET .../graph/published`（已发布） | 200 | 已发布图 |
| `GET .../graph/published`（从未发布） | **404** | `{"statusCode":404,"message":"Graph not published","error":"Not Found"}` |
| 不带 token 任一接口 | **401** | `{"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}` |
| 访问**别人的**应用 | **404** | `{"statusCode":404,"message":"App not found","error":"Not Found"}` |
| 跨后端 | — | api-py `PUT` 保存的图，api-ts `GET` 读到且一致 |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| FastAPI 骨架、`config.py`、`main.py`、`APIRouter`/`include_router` | 阶段 0 · 06 |
| `packages/contract/openapi.yaml` 的 `/apps/{id}/graph*` 与 `Graph`/`GraphNode`/`GraphEdge`/`PublishGraphResponse` | `03-画布/01-图JSON契约与校验.md` |
| `apps` 表新增三列（Prisma 迁移 `20261018124928_add_app_graph`） | `03-画布/02-Prisma-JSONB与两态.md` |
| `App` 模型映射了三列（`JSONB` / `published_at`） | **本阶段 · 04** |
| `deps.py`（`get_db` / `get_current_user`）、`errors.py`（错误体归一化） | `01-账号与认证/05-FastAPI认证.md` |
| `apps.py` 的 `_find_owned`（404 归属校验） | `02-应用管理/05-FastAPI应用模块.md` |
| `errors.py` 的 `_enum_values` 修正 | **本篇 §6.4** |

> **本篇为什么能直接 `import` `_find_owned`**：归属校验的首次教学在 `02-应用管理/05-FastAPI应用模块.md` §5.1；本篇把它当「已就绪的公共前置」直接复用，只引用不展开。
>
> **数据库必须在线**：四个接口都要读写 `apps` 表（`graph_json` / `published_graph_json` / `published_at`）。

---

## 3. 先看清要做什么

「画布」在后端就是**一段 JSON 的存取**：草稿（`graph_json`）与发布快照（`published_graph_json` + `published_at`）两态。后端**不做任何图执行**——那是阶段 4 执行引擎的职责。

```
apps/api-py/app/
├── graph/
│   ├── __init__.py    # 包声明（本篇新增）
│   └── validator.py   # validate_graph —— 纯函数，与 TS validateGraph 逐条对齐（本篇新增）
├── api/
│   └── graph.py       # /apps/{id}/graph* 四个接口（≈ NestJS GraphController + GraphService）（本篇新增）
├── main.py            # 挂载：include_router(graph_router)（新增两行）
└── errors.py          # 异常处理器 —— 修改 _enum_values（修 bug，见 §6.4）

TS 侧对照
├── graph.controller.ts + graph.service.ts  ↔  api/graph.py
├── graph.validator.ts                        ↔  graph/validator.py
└── dto/graph.dto.ts                          ↔  graph.py 里的 Graph / GraphNode / GraphEdge
```

**行为对齐点（与 `graph.service.ts` 一一对应）**：

- 「草稿为 `null`（从未编辑）→ 返回合法空图」：`draftOf` ↔ `_draft_of`（`graph_json is None → _EMPTY_GRAPH`）。
- 只有 `PUT` / `Publish` 才走**语义校验**；`GET` 读取**不校验**（空图会因规则 3/4 不通过，但读取正常返回）。
- 「图 = 数据」：存进去什么形状，读出来就是什么形状（`toPlainGraph` 原样 ↔ `model_dump` 原样，键名均为 camelCase）。
- 归属校验复用 `/apps` 的同一套：**查不到 / 非本人一律 404 `App not found`**。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | **仓库根** | 确认依赖齐备（本篇无新增依赖） | 无报错 |
| `uv run uvicorn app.main:app --reload --port 8000` | **`apps/api-py` 目录** | 启动服务，监听 **8000**，提供 `/apps/{id}/graph*` | `Uvicorn running on http://127.0.0.1:8000` |
| `pnpm dev:api-py` | **仓库根** | 等价启动方式（内部 `uv run --directory apps/api-py …`，见阶段 0 · 06 §9） | 同上 |
| 一串 `curl … /apps/{id}/graph…` | 任意（服务在线） | 逐条验收四个接口 + 错误分支（见 §7） | 状态码见 §1 |

> **不在 `apps/api-py` 目录**时会 `ModuleNotFoundError: No module named 'app'`——`uvicorn app.main:app` 按当前工作目录解析 `app` 包。用根脚本 `pnpm dev:api-py` 时 `--directory` 已帮你切好。

---

## 5. 完整代码

### 5.1 `apps/api-py/app/graph/__init__.py`（本篇新增）

**完整文件路径：`apps/api-py/app/graph/__init__.py`**

```python
"""画布（Graph）领域的纯函数：语义校验。

只做校验、不碰 I/O；与 api-ts 的 `graph.validator.ts::validateGraph` 逐条对齐。
"""
```

> 这个包**只放纯函数**（目前就是 `validator.py` 里的 `validate_graph`），不放路由、不放数据库访问——领域规则与「框架/IO」解耦是本篇的贯穿主题（见 §6.1）。

### 5.2 `apps/api-py/app/graph/validator.py`（本篇新增）

**完整文件路径：`apps/api-py/app/graph/validator.py`**

```python
"""图**语义**校验（纯函数）。

与 api-ts 的 `apps/api-ts/src/graph/graph.validator.ts::validateGraph` 逐条对齐：
规则顺序、同规则内的遍历顺序、文案模板完全一致，见
`packages/contract/error-messages.md` §3。

入参是普通 dict（来自请求体 `model_dump()` 或数据库 JSONB 读出的草稿），
返回错误文案列表（可能为空）；调用方用 `"; "` 连接成一个 `message`。
注意：本函数**不含**「读取草稿」时的豁免 —— 草稿为 NULL 时读取返回合法空图，
不走本校验；只有 `PUT` / `publish` 才调用本函数（空图会因规则 3/4 不通过）。
"""

from typing import Any


def validate_graph(graph: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    nodes: list[dict[str, Any]] = graph.get("nodes") or []
    edges: list[dict[str, Any]] = graph.get("edges") or []

    # 规则 1：version 必须为 "1"
    if graph.get("version") != "1":
        errors.append("graph version must be 1")

    # 规则 2：节点 id 必须唯一（按数组顺序，每个重复 id 只报一次）
    seen_node_ids: set[str] = set()
    reported_node_ids: set[str] = set()
    for node in nodes:
        node_id = node.get("id")
        if node_id in seen_node_ids and node_id not in reported_node_ids:
            errors.append(f"node id must be unique: {node_id}")
            reported_node_ids.add(node_id)
        seen_node_ids.add(node_id)

    # 规则 3：恰好一个 start 节点（0 个或 ≥2 个都报此条）
    if sum(1 for node in nodes if node.get("type") == "start") != 1:
        errors.append("graph must contain exactly one start node")

    # 规则 4：至少一个 end 节点
    if sum(1 for node in nodes if node.get("type") == "end") == 0:
        errors.append("graph must contain at least one end node")

    # 规则 5：边 id 必须唯一（按数组顺序，每个重复 id 只报一次）
    seen_edge_ids: set[str] = set()
    reported_edge_ids: set[str] = set()
    for edge in edges:
        edge_id = edge.get("id")
        if edge_id in seen_edge_ids and edge_id not in reported_edge_ids:
            errors.append(f"edge id must be unique: {edge_id}")
            reported_edge_ids.add(edge_id)
        seen_edge_ids.add(edge_id)

    # 规则 6：边的 source/target 必须指向存在的节点（先 source 后 target）
    node_ids = {node.get("id") for node in nodes}
    for edge in edges:
        if edge.get("source") not in node_ids:
            errors.append(f"edge {edge.get('id')} references unknown node: {edge.get('source')}")
        if edge.get("target") not in node_ids:
            errors.append(f"edge {edge.get('id')} references unknown node: {edge.get('target')}")

    # 规则 7：不允许自环（source == target）
    for edge in edges:
        if edge.get("source") == edge.get("target"):
            errors.append(f"edge {edge.get('id')} must not connect a node to itself")

    return errors
```

**逐块解释**

| 代码 | 作用 |
| --- | --- |
| `def validate_graph(graph: dict[str, Any]) -> list[str]` | 纯函数签名：**一个普通 `dict` 进、一个 `list[str]` 出**。无 `Session`、无 `Request`、无框架类型——所以能被任何调用方（路由、测试脚本、未来引擎）复用 |
| `nodes: ... = graph.get("nodes") or []` | 用 `.get(..., default)` + `or []` 兜底：即使传入的 dict 缺 `nodes` / `edges`（或为 `None`），也当成空数组，**不抛异常**（校验函数自己不该崩） |
| 规则 1 | `version != "1"` → 一条错误。注意契约 `version` 是**字符串** `"1"`，不是数字 |
| 规则 2 / 5 | 「重复 id 只报一次」用 `seen` + `reported` 两个 `set` 实现——与 TS 的 `Set` 写法**一模一样**（见 §6.1） |
| 规则 3 / 4 | 用 `sum(1 for node ...)`（生成器表达式）统计 start/end 个数，等价 TS 的 `.filter(...).length` |
| 规则 6 | 先建 `node_ids` 集合，再对每条边**先查 `source` 再查 `target`**；某端不存在各报一条 |
| 规则 7 | `source == target` 报自环 |
| 返回 | 错误**列表**（可能为空）。**不用** `raise`——因为它是纯函数，把「判定」与「如何呈现（400）」分开（见 §6.2） |

### 5.3 `apps/api-py/app/api/graph.py`（本篇新增）

**完整文件路径：`apps/api-py/app/api/graph.py`**

```python
"""`/apps/{id}/graph*` 路由 —— 契约见 packages/contract/openapi.yaml。

行为与 api-ts 的 `GraphController` / `GraphService` 保持一致：
- 归属校验复用 `app.api.apps._find_owned`（查不到 / 非本人一律 404 `App not found`）；
- 语义校验用纯函数 `app.graph.validator.validate_graph`，文案与 api-ts 逐条对齐；
- 草稿为 NULL（从未编辑）时，GET 返回合法空图（读取不校验，只有 PUT / publish 校验）。
"""

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.apps import _find_owned
from app.api.deps import get_current_user, get_db
from app.graph.validator import validate_graph
from app.models.app import App
from app.models.user import User
from app.timefmt import iso_z

router = APIRouter(prefix="/apps", tags=["apps"])

# 草稿为 NULL（从未编辑）时对外返回的合法空图
_EMPTY_GRAPH: dict[str, Any] = {"version": "1", "nodes": [], "edges": []}


class NodePosition(BaseModel):
    """对应契约 `NodePosition`。"""

    model_config = ConfigDict(extra="forbid")

    # JSON number：int 与 float 都接受，且保持原样（避免 1 → 1.0 的漂移）
    x: int | float
    y: int | float


class GraphNode(BaseModel):
    """对应契约 `GraphNode`。`data` 为节点各自的配置（自由结构）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["start", "end", "llm"]
    position: NodePosition
    data: dict[str, Any]


class GraphEdge(BaseModel):
    """对应契约 `GraphEdge`（句柄字段可选，可为 null）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    source: str
    target: str
    sourceHandle: str | None = None
    targetHandle: str | None = None


class Graph(BaseModel):
    """对应契约 `Graph`（PUT 请求体）。"""

    model_config = ConfigDict(extra="forbid")

    version: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]


def _draft_of(app: App) -> dict[str, Any]:
    # 草稿为 NULL 表示尚未编辑：返回合法空图（注意它不通过校验规则 3/4，但读取正常返回）
    return _EMPTY_GRAPH if app.graph_json is None else app.graph_json


def _assert_valid(graph: dict[str, Any]) -> None:
    errors = validate_graph(graph)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors)
        )


@router.get("/{id}/graph", operation_id="getGraph")
def get_graph(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _draft_of(_find_owned(db, current_user.id, id))


@router.put("/{id}/graph", operation_id="saveGraph")
def save_graph(
    id: str,
    body: Graph,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    app = _find_owned(db, current_user.id, id)
    # 先落成普通 dict（camelCase 键名原样保留），再校验、再落库
    graph = body.model_dump(exclude_unset=True)
    _assert_valid(graph)
    app.graph_json = graph
    db.commit()
    db.refresh(app)
    return _draft_of(app)


@router.post("/{id}/graph/publish", operation_id="publishGraph")
def publish_graph(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    app = _find_owned(db, current_user.id, id)
    draft = _draft_of(app)
    _assert_valid(draft)
    app.published_graph_json = draft
    # 列在 PG 上为 timestamp（无时区）；写 naive-UTC，读取时 iso_z 按 UTC 解释
    app.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(app)
    return {"publishedAt": iso_z(app.published_at), "graph": app.published_graph_json}


@router.get("/{id}/graph/published", operation_id="getPublishedGraph")
def get_published_graph(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    app = _find_owned(db, current_user.id, id)
    if app.published_graph_json is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph not published")
    return app.published_graph_json
```

**逐块解释**

| 代码 | 作用 |
| --- | --- |
| `_EMPTY_GRAPH` | 模块级常量：草稿为 `NULL` 时对外返回的合法空图（`{"version":"1","nodes":[],"edges":[]}`）。**注意它不通过校验规则 3/4**，但「读取」不校验 |
| `NodePosition.x: int \| float` | 契约 `NodePosition` 的 `x`/`y` 是 JSON number。**`int \| float` 而非 `float`**：Pydantic 会把 `1` 强转成 `1.0`（JSON 里就是 `1.0`），与 TS 原样保留的 `1` 不一致——用联合类型 + 默认宽松校验避免这种漂移 |
| `GraphNode.type: Literal["start", "end", "llm"]` | 契约 `enum: [start, end, llm]`；`Literal` 在**运行期**挡住别的取值。**这是 3 个取值**——正是 §6.4 那个 bug 的触发点 |
| `GraphNode.data: dict[str, Any]` | 节点的自由配置；契约里 `data` 是 `additionalProperties: true`，不约束内部结构 |
| `GraphEdge.sourceHandle/targetHandle: str \| None = None` | 可选句柄，可为 `null`；写了 `= None` → **可选**（不传即缺省） |
| `Graph.model_config = ConfigDict(extra="forbid")` | 锁死字段集合（对齐契约 `additionalProperties: false`）；`Literal`/`extra="forbid"` 首次教学见阶段 0 · 06 |
| `_draft_of(app)` | ORM 对象 → 对外草稿：`graph_json is None` → 空图；否则原样 dict（语义见本阶段 · 04 §6.3） |
| `_assert_valid(graph)` | 调纯函数校验；有错误则 `raise HTTPException(400, "; ".join(errors))`——**入参是 dict**，因为已经把 Pydantic 模型 dump 成 dict 了 |
| `body.model_dump(exclude_unset=True)` | 把请求体落成**普通 dict**。`exclude_unset` 会丢弃「未传入」的可选句柄字段 → **存下的形状 = 请求体的形状**（与 TS 的 `toPlainGraph` 等价） |
| `app.graph_json = graph` + `commit` + `refresh` | 直接把 dict 赋给 `JSONB` 列（psycopg 自动序列化）；`refresh` 让返回值反映库里的最新值 |
| `datetime.now(timezone.utc).replace(tzinfo=None)` | **naive-UTC** 写入（见 §6.3） |
| `{"publishedAt": iso_z(app.published_at), "graph": app.published_graph_json}` | 发布响应：`publishedAt` 经 `iso_z` 归一为毫秒 `Z`；`graph` 即刚快照的图 |
| `get_published_graph` 的 404 | 从未发布（`published_graph_json is None`）→ `Graph not published` |

> `Depends(get_current_user)` / `Depends(get_db)`：认证与数据库会话依赖（**首次教学见 `01-账号与认证/05-FastAPI认证.md`**，本篇只引用）。
> 路由都用同一个 `prefix="/apps"`（与 `apps.py` 的 `router` 相同）——FastAPI 允许**多个 `APIRouter` 共享前缀**，最终由 `main.py` 各自 `include_router`，路径不会冲突（`/{id}/graph` 与 `/{id}` 是两个不同的完整路径）。

### 5.4 `apps/api-py/app/main.py`（新增两行）

**完整文件路径：`apps/api-py/app/main.py`**

```python
"""FastAPI 入口（api-py）。

契约来源：packages/contract/openapi.yaml
本服务的所有接口都必须与该契约一致，并通过契约测试与 api-ts 对齐。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.apps import router as apps_router
from app.api.auth import router as auth_router
from app.api.graph import router as graph_router
from app.api.health import router as health_router
from app.config import settings
from app.errors import register_error_handlers

app = FastAPI(title="mini-dify api-py", version=settings.version)

# 前端（localhost:3000）与后端（localhost:8000）跨域，阶段 0 直接放开。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 把 FastAPI 默认的 {detail} 归一化成契约要求的 {statusCode, message, error}
register_error_handlers(app)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(apps_router)
app.include_router(graph_router)
```

**与阶段 2 · 05 的差异**只有两处：

1. `from app.api.graph import router as graph_router`（新增导入）。
2. 末尾 `app.include_router(graph_router)`（新增挂载）。

### 5.5 `apps/api-py/app/errors.py`（本篇修改 `_enum_values`）

**完整文件路径：`apps/api-py/app/errors.py`**

```python
"""把 FastAPI 默认的错误体归一化成契约要求的 `ErrorResponse`。

NestJS 默认返回 `{statusCode, message, error}`；FastAPI 默认返回 `{detail}`。
契约要求两套后端产出**同一形状且逐字节相同**的错误体，所以这里做归一化。
`message` 的文案规则见唯一真源 `packages/contract/error-messages.md`。
"""

from typing import Any

import re

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_REASON_PHRASES: dict[int, str] = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    500: "Internal Server Error",
}

# 同一字段内多错误时的规则排序（见 error-messages.md 的规则顺序）
_RULE_ORDER: list[str] = ["required", "email", "minLength", "maxLength", "enum", "unknown", "string"]


def _envelope(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "statusCode": status_code,
            "message": message,
            "error": _REASON_PHRASES.get(status_code, "Error"),
        },
    )


def _enum_values(expected: str) -> str:
    """把 Pydantic 的枚举 `expected` 还原成 `"a, b, c"`。

    Pydantic 的格式随取值个数变化：2 个为 `"'chatflow' or 'workflow'"`，
    ≥3 个为 `"'start', 'end' or 'llm'"`。这里统一按引号抽取各枚举值，
    避免按 `" or "` 切分在 3 个以上取值时把中间项切错。
    """
    values = re.findall(r"'([^']*)'", expected)
    return ", ".join(values) if values else expected


def _describe(err: dict[str, Any]) -> tuple[str, str]:
    """把单条 Pydantic 校验错误映射成 (规则名, 文案)。"""
    loc = err.get("loc", ())
    field = str(loc[-1]) if loc else ""
    err_type = err.get("type", "")
    ctx: dict[str, Any] = err.get("ctx") or {}

    if err_type == "missing":
        return "required", f"{field} is required"
    if err_type == "value_error":  # EmailStr 校验失败
        return "email", f"{field} must be a valid email"
    if err_type in ("string_too_short", "too_short"):
        return "minLength", f"{field} must be at least {ctx.get('min_length')} characters"
    if err_type in ("string_too_long", "too_long"):
        return "maxLength", f"{field} must be at most {ctx.get('max_length')} characters"
    if err_type in ("literal_error", "enum"):
        return "enum", f"{field} must be one of: {_enum_values(str(ctx.get('expected', '')))}"
    if err_type == "extra_forbidden":
        return "unknown", f"{field} should not exist"
    if err_type == "string_type":
        return "string", f"{field} must be a string"
    return "unknown", f"{field} is invalid"


def _build_message(errors: list[dict[str, Any]]) -> str:
    """按「字段声明顺序 + 规则顺序」组装单一 message 字符串。

    Pydantic 的 `errors()` 已按字段定义顺序产出，这里保留该顺序，
    仅对同一字段内的多条错误按规则顺序稳定排序，最后用 "; " 连接。
    """
    field_order: dict[str, int] = {}
    items: list[tuple[int, int, str]] = []
    for err in errors:
        loc = err.get("loc", ())
        field = str(loc[-1]) if loc else ""
        field_order.setdefault(field, len(field_order))
        rule, message = _describe(err)
        rule_rank = _RULE_ORDER.index(rule) if rule in _RULE_ORDER else len(_RULE_ORDER)
        items.append((field_order[field], rule_rank, message))
    items.sort(key=lambda item: (item[0], item[1]))
    return "; ".join(item[2] for item in items)


def register_error_handlers(app: FastAPI) -> None:
    """注册异常处理器（须在创建 app 之后、提供服务之前调用）。"""

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return _envelope(exc.status_code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _envelope(status.HTTP_400_BAD_REQUEST, _build_message(exc.errors()))
```

**本篇唯一改动**：`_enum_values` 函数体（其余一行未动）。修改前后见 §6.4——**这是一个真实修复，不是重构**。

---

## 6. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 3 · 05」并直接使用。

### 6.1 「业务规则用纯函数」在 Python 侧的实现 —— 与 TS 的 `validateGraph` 逐条对齐

**是什么**：「纯函数（pure function）」指**没有副作用、只依赖入参、只产出返回值**的函数——不读数据库、不写日志、不用框架类型、不看全局状态。`validate_graph(graph) -> list[str]` 就是纯函数：**给它一张图（`dict`），它还你一串错误文案（`list[str]`，可能为空）**。

**为什么把「图的语义规则」做成纯函数**？因为它**唯一同时满足三个目标**：

1. **可测试**：给 dict、断言 list——没有 DB、没有 HTTP，测试极简单。
2. **可复用**：路由能用，将来执行引擎（阶段 4）在「编译前」也能用它做同一套安全检查。
3. **可对齐**：这是「两套后端行为一致」的**唯一可行路径**。框架相关的部分（NestJS 的 DTO/class-validator ↔ FastAPI 的 Pydantic）两边**必然不同**；但**语义规则**只要写成两边的纯函数，就能做到**逐条、逐字节相同**。

**TS 与 Python 的逐句对照**（这是本篇最值得记住的一张表）

| 规则 | TS `validateGraph` | Python `validate_graph` |
| --- | --- | --- |
| 入参 / 出参 | `graph: Graph` → `string[]` | `graph: dict[str, Any]` → `list[str]` |
| 空数组兜底 | `graph.nodes`（类型已保证） | `graph.get("nodes") or []`（dict 可能缺键） |
| 规则 2/5 去重 | `new Set<string>()` + `reportedNodeIds` | `set[str]()` + `reported_node_ids` |
| 规则 3/4 计数 | `graph.nodes.filter(n => n.type === 'start').length` | `sum(1 for n in nodes if n.get("type") == "start")` |
| 文案模板 | `` `node id must be unique: ${node.id}` `` | `f"node id must be unique: {node_id}"` |
| 返回 | `return errors`（数组） | `return errors`（列表） |

**关键**：两边的**规则顺序**、**同规则内的遍历顺序**、**文案模板**三件事完全一致——这不是巧合，是**刻意的纪律**（见 §6.2）。TS 侧代码见 `03-画布/03-NestJS图模块.md`，与本篇 §5.2 **一一对应**。

> **一句话**：**框架可以不同，规则必须相同。** 把规则收进纯函数，是把「行为一致」从口号变成可验证事实的手段。

### 6.2 两端校验文案必须逐字节相同 —— 意义与方法

**意义**：契约测试会用**同一份非法请求**分别打两套后端，逐字节比对响应体。若文案差一个字（这里是最典型的：枚举值列表切错），测试即失败，「两套后端效果一致（§5.5 契约优先）」就名存实亡。所以**文案不是「随便写写」的字符串，而是契约的一部分**。

**唯一真源**：`packages/contract/error-messages.md`。图校验的文案在它的 **§3**：

| 序 | 规则 | 文案模板 |
| --- | --- | --- |
| 1 | version | `graph version must be 1` |
| 2 | 节点 id 唯一 | `node id must be unique: {id}` |
| 3 | 恰好一个 start | `graph must contain exactly one start node` |
| 4 | 至少一个 end | `graph must contain at least one end node` |
| 5 | 边 id 唯一 | `edge id must be unique: {id}` |
| 6 | 边端点存在 | `edge {edgeId} references unknown node: {nodeId}` |
| 7 | 禁止自环 | `edge {edgeId} must not connect a node to itself` |

**三条「必须一致」的组装纪律**（`error-messages.md` §3 明确）：

1. **规则按顺序逐条执行**：先扫完规则 1，再扫规则 2……同一条规则内按**数组顺序**。
2. **规则 2/5 每个重复 id 只报一次**（首次检测到重复时报告）——所以两端都用「`seen` 集 + `reported` 集」两个集合。
3. **多条错误用 `"; "`（分号 + 空格）连接成一个 `message`**：Python 侧由 `_assert_valid` 的 `"; ".join(errors)` 完成，TS 侧由 `errors.join('; ')` 完成。

**方法**：改规则时，**同时**改三处——契约文档 `error-messages.md`、TS 的 `validateGraph`、Python 的 `validate_graph`；然后跑「7 组非法请求」逐一比对（见 §7.3）。本篇 §6.4 的 bug 正是「以为文案已经对齐、其实没有」的真实教训。

### 6.3 `published_at`：naive-UTC 写入 + `iso_z()` 出参归一（存储时区 vs 展示时区分离）

**是什么**：发布时刻要**写进**（存储）一个时间戳、并**读出去**（展示）一个字符串。这两件事的时区处理是**分开的**——这就是「存储时区」与「展示时区」分离。

**存储侧**：

```python
app.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
```

- 物理列是 **`timestamp(3)` 无时区**（Prisma 的 `DateTime?`；见本阶段 · 04 §5.1）。
- `.replace(tzinfo=None)` **故意剥掉 tzinfo**，写入一个 **naive-UTC**（UTC 的「墙钟时间」，但 DB 不知它是 UTC）。
- **为什么必须写 naive？** 若写一个 aware datetime 进**无时区**列，PostgreSQL 会**按会话时区**把它转成本地墙钟再存——结果**依赖数据库的 `TimeZone` 设置**，同一份代码在不同环境存的值就不一样了。写 naive-UTC 则**与环境无关**：无论会话时区为何，存进去的永远是 UTC 的墙钟。
- TS 侧对应 `publishedAt: new Date()`（Prisma）——`Date` 是「绝对时刻」，PG 存进 `timestamp(3)` 也是同一墙钟约定（Prisma 写入时按 UTC 归一）。

**展示侧**：

```python
return {"publishedAt": iso_z(app.published_at), "graph": app.published_graph_json}
```

- 读出来的 `app.published_at` 是 **naive** datetime，`iso_z()` 把它**按 UTC 解释**、转成 UTC、截到毫秒、`+00:00` 换成 `Z`（机制见 `02-应用管理/07-验收.md`）。
- 结果形如 `2026-10-18T12:34:56.789Z`（固定 24 字符），与 TS 的 `toISOString()` **逐字节相同**。

**两句话总结**

> **存储时区（DB 里）**：列无时区 → 只存「UTC 墙钟」，靠**写入约定**保证它是 UTC。
> **展示时区（API 里）**：出参一律归一成 `…Z`，靠 **`iso_z()`（或 TS `toISOString`）** 保证格式统一。

| 层 | 值 | 谁负责 |
| --- | --- | --- |
| 数据库列 | `timestamp(3)`，内容为 UTC 墙钟 | 写 naive-UTC（本代码）；Prisma 的 `@map("published_at")` |
| ORM 属性 | naive `datetime` | `Mapped[datetime \| None]`（本阶段 · 04 声明 `DateTime(timezone=True)`，但物理列无时区，读取仍是 naive） |
| API 出参 | `"…Z"` 字符串（毫秒） | `iso_z()`（Python）/ `toISOString()`（TS） |

> **注意**：本阶段 · 04 的模型把 `published_at` 声明为 `DateTime(timezone=True)`，而实际物理列是**无时区**的 `timestamp(3)`——两者不一致。**这不影响本项目**：`timezone=True` 只在「SQLAlchemy 生成 DDL」时才有意义（本项目不生成 DDL），读取无时区列时 psycopg 仍返回 naive datetime，`iso_z()` 照常按 UTC 处理。之所以要**写 naive**，正是为了绕开「aware 值 + 无时区列」会触发的会话时区转换（见上）。

### 6.4 【真实 bug 修复】`_enum_values`：按 `" or "` 切分 → 用引号正则抽取

这是一次**真实的、由本阶段引入的问题**——触发它的是 `GraphNode.type: Literal["start", "end", "llm"]` 这个**有 3 个取值**的枚举。

**问题：Pydantic 的枚举 `expected` 文本格式随取值个数变化**

`Literal` 校验失败时，Pydantic 把「期望取值集合」放在错误的 `ctx["expected"]` 里。它的**格式不固定**：

| 取值个数 | `ctx["expected"]` 原文 |
| --- | --- |
| **2 个**（如阶段 2 的 `mode`） | `"'chatflow' or 'workflow'"` |
| **3 个及以上**（如本阶段的 `type`） | `"'start', 'end' or 'llm'"` |

注意：**从第 2 项起用 `', '` 分隔，只有**最后**一项前面是 `' or '`。**

**原实现（有 bug）**

```python
# 旧实现：按 " or " 切分，再去引号
return ", ".join(v.strip("'") for v in expected.split(" or "))
```

- 2 个取值时：`"'chatflow' or 'workflow'".split(" or ")` → `["'chatflow'", "'workflow'"]`，去引号 → `chatflow, workflow` ✅ **恰好对**。
- 3 个取值时：`"'start', 'end' or 'llm'".split(" or ")` → `["'start', 'end'", "'llm'"]`，去引号后第一段变成 `start', 'end` → 拼出 **`start', 'end, llm`** ❌ **切错了**（中间项的值被切碎、还残留引号）。
- 后果：api-py 的 `message` 变成 `type must be one of: start', 'end, llm`，而 api-ts（class-validator 归一后）是 `type must be one of: start, end, llm` → **不再逐字节相同**，契约测试失败。

**为什么阶段 2 没暴露**：阶段 2 唯一的枚举是 `mode = Literal["chatflow", "workflow"]`（**2 个取值**），旧写法恰好正确。**bug 一直潜伏**，直到本阶段出现 3 取值的 `type` 才发作——这是「看似能用的代码其实脆弱」的典型样本。

**修正后的做法：用引号正则抽取**

```python
values = re.findall(r"'([^']*)'", expected)   # 把文本里所有被单引号包住的值抽出来
return ", ".join(values) if values else expected
```

- 正则 `'([^']*)'` 匹配「一个单引号 + 任意非引号字符 + 一个单引号」，捕获组就是**引号内的原始值**——不管分隔符是 `', '` 还是 `' or '`、不管有几个取值，都只取**值本身**。
- 2 个取值 → `['chatflow', 'workflow']` → `chatflow, workflow` ✅
- 3 个取值 → `['start', 'end', 'llm']` → `start, end, llm` ✅
- `if values else expected`：万一格式完全变了（一个引号都没有），兜底返回原文，不至于抛异常。

**验证**（本地一行即可）：

```bash
uv run python -c "from app.errors import _enum_values; print(_enum_values(\"'chatflow' or 'workflow'\")); print(_enum_values(\"'start', 'end' or 'llm'\"))"
```

**预期**：

```
chatflow, workflow
start, end, llm
```

**一句话教训**：**不要依赖「框架错误的展示文本」的格式**——它可能随版本、随取值个数变化。要对它做**结构化抽取（正则/解析）**，而不是**字符串切分**。

---

## 7. 验收自测

> 先启动服务：在 `apps/api-py` 目录 `uv run uvicorn app.main:app --reload --port 8000`（或仓库根 `pnpm dev:api-py`）。
> 准备一个 token（`POST /auth/register` → `POST /auth/login` 拿 `accessToken`，见 `01-账号与认证/05`、`06`）；用 `$TOKEN`、`$APPID` 代指。
> 先建一个应用：`POST /apps`（见 `02-应用管理/05-FastAPI应用模块.md`）。

### 7.1 主流程（实测）

| 请求 | 命令 | 实测结果 |
| --- | --- | --- |
| 读取未编辑草稿 | `curl -s http://127.0.0.1:8000/apps/$APPID/graph -H "Authorization: Bearer $TOKEN"` | **200** `{"version":"1","nodes":[],"edges":[]}` |
| 保存草稿（合法图） | `curl -s -X PUT .../graph -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @graph.json` | **200**，返回体与请求体**逐字段一致**（比对结果 `True`） |
| 再读草稿 | 同第一行 | **200**，与 `PUT` 的请求体**逐字段一致**（`True`） |
| 发布 | `curl -s -X POST .../graph/publish -H "Authorization: Bearer $TOKEN"` | **200** `{"publishedAt":"2026-10-18T…Z","graph":{…}}`（`publishedAt` 为**毫秒 + `Z`**） |
| 读已发布 | `curl -s .../graph/published -H "Authorization: Bearer $TOKEN"` | **200**，与草稿一致 |

**「PUT 往返一致」的含义**：`PUT` 存进去的 `graph` 与随后 `GET` 读出来的 `graph`，**每个字段、每个键、每个嵌套值都相同**（实测比较返回 `True`）——说明 JSONB 往返（本阶段 · 04 §6.2）与 `model_dump` 的形状保留都正确。

### 7.2 错误分支（实测）

| 场景 | 实测响应体 | 状态码 |
| --- | --- | --- |
| 不带 token 任一接口 | `{"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}` | **401** |
| B 读 A 的图（归属） | `{"statusCode":404,"message":"App not found","error":"Not Found"}` | **404** |
| 从未发布 → 读已发布 | `{"statusCode":404,"message":"Graph not published","error":"Not Found"}` | **404** |
| 语义校验不通过（7 组） | `{"statusCode":400,"message":"…","error":"Bad Request"}` | **400** |

### 7.3 校验 7 组 → 400，且与 api-ts **逐字节完全一致**

构造 7 组触犯规则 1~7（每组的 `message` 即 §6.2 表里的模板，多条用 `"; "` 连接）：

| 组 | 触犯规则 | `message`（示例；`{id}` 依载荷而定） |
| --- | --- | --- |
| 1 | version | `graph version must be 1` |
| 2 | 节点 id 唯一 | `node id must be unique: {id}` |
| 3 | 恰好一个 start | `graph must contain exactly one start node` |
| 4 | 至少一个 end | `graph must contain at least one end node` |
| 5 | 边 id 唯一 | `edge id must be unique: {id}` |
| 6 | 边端点存在 | `edge {edgeId} references unknown node: {nodeId}` |
| 7 | 禁止自环 | `edge {edgeId} must not connect a node to itself` |

**实测结论**：7 组全部 **400**，且 api-py 与 api-ts 的**响应体逐字节完全一致**。其中一组恰是**结构校验**（而非语义校验）失败——非法 `type`（如 `"nope"`）触发 `Literal`，其 `message` 为 `type must be one of: start, end, llm`，正是 §6.4 修复后才对齐的。

> 对照真实样例（`version` 为 `"2"` 且无 `start`）：`{"statusCode":400,"message":"graph version must be 1; graph must contain exactly one start node","error":"Bad Request"}`。

### 7.4 跨后端（实测）

| 步骤 | 命令 | 实测结果 |
| --- | --- | --- |
| api-py 保存草稿 | `PUT http://127.0.0.1:8000/apps/$APPID/graph` | 200 |
| api-ts 读同一草稿 | `GET http://127.0.0.1:3001/apps/$APPID/graph` -H "Authorization: Bearer $TOKEN" | 200，**与 api-py 保存的图一致** |
| 两端 GET 互比 | api-py `GET` vs api-ts `GET`（同一应用） | **一致** |

**结论**：两端共用同一个 `apps` 表、同一套认证域，**api-py 写、api-ts 读，图逐字段一致**——「同一列里同一套键名」（本阶段 · 04 §6.2）的约束在运行期得到验证。

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 服务启动 | `uv run uvicorn app.main:app --reload --port 8000` | `Uvicorn running on http://127.0.0.1:8000` |
| 四个接口 | §7.1 | 200（含未编辑返回空图） |
| PUT 往返 | §7.1 第 2、3 行 | 与请求体逐字段一致（`True`） |
| 未发布 → 404 | §7.2 第 3 行 | `Graph not published` |
| 归属 → 404 | §7.2 第 2 行 | `App not found` |
| 校验 7 组 | §7.3 | 400，两端逐字节一致 |
| 跨后端 | §7.4 | api-ts 读到 api-py 保存的图 |
| 文档 | 打开 <http://localhost:8000/docs> | 可见 `/apps/{id}/graph` 的 4 个方法 |

---

## 8. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **3+ 取值的 `Literal` 校验文案切错**（真实 bug，已修） | `type must be one of: start', 'end, llm`，与 api-ts 不一致 | 旧 `_enum_values` 按 `" or "` 切分 Pydantic 的 `expected`，≥3 个取值时切碎中间项；改为**引号正则抽取**（见 §6.4） |
| 「读取草稿」走了语义校验 | 未编辑的 `GET` 返回 400 | 读取**不校验**；`graph_json is None` → 返回空图。空图会因规则 3/4 不通过，但那是 **PUT/publish** 才校验（见 §5.3 的 `_draft_of`/`_assert_valid`） |
| 把 `NULL` 与「空图」混为一谈 | 语义歧义 | `NULL` = 从未编辑；空图 = 确实存了一个对象。二者在 API 层区分（本阶段 · 04 §6.3） |
| 用 `float` 定义 `NodePosition.x/y` | Pydantic 把 `1` 变 `1.0`，与 TS 不一致 | 用 `int \| float`（联合、宽松），保留原样（见 §5.3） |
| `PUT` 存下的形状与请求体不同 | `sourceHandle` 等可选字段被迫落成 `null`（或丢失语义） | 用 `body.model_dump(exclude_unset=True)`，让「未传的字段」不出现；与 TS 的 `toPlainGraph` 等价（见 §5.3） |
| 把 `aware` datetime 写进 `published_at` | 存下的时刻随数据库会话时区而变 | 列无时区；写 **naive-UTC**（`datetime.now(timezone.utc).replace(tzinfo=None)`），展示端再 `iso_z()` 归一（见 §6.3） |
| 发布响应手拼时间字符串 | 与 TS 的 `toISOString()` 不逐字节 | 用 `iso_z(app.published_at)`（毫秒 + `Z`），不要自己 `strftime`（见 §6.3） |
| 语义校验里 `raise` 而非返回列表 | 纯函数不再纯粹、无法被复用/测试 | `validate_graph` 只**返回** `list[str]`；在 `_assert_valid` 里统一转成 `HTTPException(400)`（见 §6.1） |
| 规则顺序 / 去重方式与 TS 不同 | 多条错误的 `message` 顺序不同 → 逐字节不一致 | 逐条对照 `packages/contract/error-messages.md` §3：规则顺序、数组遍历顺序、`"; "` 连接、重复 id 只报一次（见 §6.2） |
| 两个 `APIRouter` 共用 `prefix="/apps"` 以为会冲突 | 担心路径重复 | 不同完整路径（`/{id}` vs `/{id}/graph`）不冲突；各自 `include_router` 即可（见 §5.3） |
| 越权用 403 | 与 api-ts 不一致 | 归属校验复用 `_find_owned` 的 **404**（本阶段 · 04 / `02-应用管理/05`） |
| 在仓库根启动失败 | `ModuleNotFoundError: No module named 'app'` | 进 `apps/api-py`，或 `uv run --directory apps/api-py …`（见阶段 0 · 06 §9） |
| `uv` 不被识别 | `The term 'uv' is not recognized` | `uv` 已在用户 PATH；只有安装前已打开的 shell 继承旧 PATH，重启终端 / IDE 即可（见阶段 0 · 01） |

---

## 9. 与 api-ts 的对照

| 概念 | NestJS（api-ts） | FastAPI（api-py） |
| --- | --- | --- |
| 路由 | `@Controller('apps')` + `@Get(':id/graph')` / `@Put(':id/graph')` / `@Post(':id/graph/publish')` / `@Get(':id/graph/published')` | `APIRouter(prefix="/apps")` + `@router.get("/{id}/graph")…` |
| 认证 | `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` | 每个处理函数 `current_user: User = Depends(get_current_user)` |
| 请求体结构校验 | `GraphDto`（class-validator：`@IsString`/`@IsIn(NODE_TYPES)`/`@ValidateNested`/`@IsObject`） | Pydantic `Graph`/`GraphNode`/`GraphEdge`（`str`/`Literal[...]`/嵌套模型/`dict`） |
| 额外字段 | `ValidationPipe({ forbidNonWhitelisted: true })` | `ConfigDict(extra="forbid")` |
| **语义校验** | `validateGraph(graph)`（纯函数，`graph.validator.ts`） | `validate_graph(graph)`（纯函数，`graph/validator.py`）——**逐条对齐** |
| 校验失败 | `throw new BadRequestException(errors.join('; '))` | `raise HTTPException(400, "; ".join(errors))` |
| 空草稿 → 空图 | `draftOf`：`graphJson === null ? EMPTY_GRAPH : …` | `_draft_of`：`graph_json is None ? _EMPTY_GRAPH : …` |
| 保存形状 = 请求形状 | `toPlainGraph(JSON.parse(JSON.stringify(body)))` | `body.model_dump(exclude_unset=True)` |
| 发布时刻写入 | `publishedAt: new Date()`（Prisma） | `datetime.now(timezone.utc).replace(tzinfo=None)`（naive-UTC） |
| 发布时刻出参 | `updated.publishedAt.toISOString()` | `iso_z(app.published_at)` |
| 未发布 | `NotFoundException('Graph not published')` | `HTTPException(404, "Graph not published")` |
| 归属校验 | `findOwned()` → `NotFoundException('App not found')` | 复用 `_find_owned()` → `HTTPException(404, "App not found")` |
| ORM | Prisma Client（`prisma.app.update`） | SQLAlchemy `Session`（赋 dict 给 `JSONB` 列） |
| 错误体归一化 | `HttpErrorFilter` | `errors.py` 的 `@app.exception_handler` |

两套实现同一份契约（`03-画布/01-图JSON契约与校验.md`），**状态码、响应体形状与值规范（校验文案、时间戳格式）均逐字节一致**——校验 7 组与发布/归属分支均已实测。

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| 「业务规则用纯函数」在 Python 侧的实现（`validate_graph(graph) -> list[str]`，与 TS `validateGraph` 逐条对齐） | **首次教学于本篇** |
| 两端校验文案必须逐字节相同的意义与组装方法（规则顺序 / 遍历顺序 / `"; "` 连接 / 重复只报一次；唯一真源 `packages/contract/error-messages.md` §3） | **首次教学于本篇** |
| `published_at` 以 naive-UTC 写入、出参 `iso_z()` 归一为 `...Z`（存储时区 vs 展示时区分离；为何不能写 aware） | **首次教学于本篇** |
| 依赖「框架错误文本」的风险：`_enum_values` 由「按 `" or "` 切分」改为「引号正则抽取」（`Literal` ≥3 取值时原实现会切错） | **首次教学于本篇** |
| 图模块与 NestJS `GraphController`/`GraphService` 的行为对齐（空图豁免 / PUT 原样存取 / 发布快照 / 未发布 404） | **首次教学于本篇** |
