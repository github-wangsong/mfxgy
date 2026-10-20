# 05 · FastAPI 应用模块：Pydantic 响应模型 / None 序列化 / 404 归属校验

> 所属：阶段 2 · 应用管理
> 本篇覆盖：`apps/api-py/app/api/apps.py`、`apps/api-py/app/api/deps.py`（未改动）、`apps/api-py/app/main.py`
> **本篇首次教学：Pydantic 响应模型与 `from_attributes`（ORM 对象 → API 响应）· `None` 的序列化（`str | None` → JSON `null`）· 404 归属校验（`HTTPException(404)`，不用 403）· `model_dump(exclude_unset=True)`（PATCH「只更新传入字段」）**
> （Pydantic `BaseModel` / `response_model` / `ConfigDict(extra="forbid")` / `Literal` 已在 `00-项目初始化/06-FastAPI起步.md` 教过；`Depends` / `get_db` / `HTTPBearer` / `get_current_user` / 异常处理器 `{statusCode,message,error}` 已在 `01-账号与认证/05-FastAPI认证.md` 教过；SQLAlchemy 映射与 `relationship` 已在本阶段 · 04 教过；`apps` 表 DDL 归 Prisma（见 `02-应用管理/02-Prisma关系建模.md` 与 `01-账号与认证/04-SQLAlchemy2.0.md` 的「迁移所有权」）——以上**只引用、不重讲**）

---

## 1. 本篇目标

- 在 Python 后端实现契约里的五个接口，行为与 NestJS 侧**逐字段一致**：
  - `GET /apps`（列出当前用户的应用）
  - `POST /apps`（创建应用）
  - `GET /apps/{id}`（应用详情，仅限本人）
  - `PATCH /apps/{id}`（更新应用，仅限本人）
  - `DELETE /apps/{id}`（删除应用，仅限本人）
- 讲清**归属校验为什么用 404 而不是 403**，以及 Python 侧如何把 ORM 对象转成契约要求的响应体。
- 讲清 `description` 可空字段在响应里如何变成 JSON `null`。

**验收标准（状态码 + 响应体要点）**：

| 场景 | 状态码 | 响应体要点 |
| --- | --- | --- |
| 带 token `POST /apps` | **201** | `AppResponse`（含 `id/name/description/mode/ownerId/createdAt/updatedAt`） |
| 带 token `GET /apps` | 200 | `{items:[…]}`，只含本人应用 |
| 带 token `GET /apps/{id}` | 200 | `AppResponse` |
| 带 token `PATCH /apps/{id}` | 200 | 更新后的 `AppResponse`（`updatedAt` 变化） |
| 带 token `DELETE /apps/{id}` | **204** | **空体** |
| **不带 token** 任一 `/apps` | **401** | `{"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}` |
| 访问**别人的**应用（GET/PATCH/DELETE） | **404** | `{"statusCode":404,"message":"App not found","error":"Not Found"}` |
| 校验失败（`name` 空/超长、`mode` 非法、多余字段） | **400** | `{"statusCode":400,"message":"<字符串>","error":"Bad Request"}` |
| 跨后端 | — | api-py 建的应用，api-ts 用**同一个 token** 也能查到 |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| FastAPI 骨架、`config.py`、`main.py`、`APIRouter`/`include_router` | 阶段 0 · 06 |
| `packages/contract/openapi.yaml` 的 `/apps`、`/apps/{id}`、`AppResponse` 等 | `02-应用管理/01-契约扩展.md` |
| `apps` 表（Prisma 迁移） | `02-应用管理/02-Prisma关系建模.md` |
| `App` / `User` 映射与 `relationship` | **本阶段 · 04** |
| `deps.py`（`get_db` / `get_current_user`）、`errors.py`（错误体归一化）、`security.py` | `01-账号与认证/05-FastAPI认证.md`、`06-JWT与密码哈希.md` |

> **本篇为什么能直接 `import` `deps.py`**：`get_db` / `get_current_user` 的首次教学在 `01-账号与认证/05-FastAPI认证.md`，本篇把它当「已就绪的认证依赖」直接用，只引用不展开。
>
> **数据库必须在线**：五个接口都要读写 `apps` 表。

---

## 3. 先看清要做什么

本篇把「应用管理」的五个接口，按 TS 侧 `AppsController` / `AppsService` 的**同一套行为**在 FastAPI 里实现：

```
apps/api-py/app/
├── api/
│   ├── apps.py        # /apps 与 /apps/{id} 五个接口（≈ NestJS AppsController + AppsService）
│   └── deps.py        # get_db / get_current_user —— 未改动（见 01-账号与认证/05）
├── main.py            # 挂载：include_router(apps_router)（新增一行）
└── errors.py          # 异常处理器 —— 未改动（见 01-账号与认证/05）

TS 侧对照
├── apps.controller.ts + apps.service.ts  ↔  api/apps.py
└── dto/create-app.dto.ts / update-app.dto.ts ↔ apps.py 里的 CreateAppRequest / UpdateAppRequest
```

**行为对齐点（与 `apps.service.ts` 一一对应）**：

- 列表按 `created_at` **倒序**（`orderBy: { createdAt: 'desc' }` ↔ `order_by(App.created_at.desc())`）。
- 创建时 `mode` 缺省填 `"chatflow"`（`dto.mode ?? 'chatflow'` ↔ `body.mode or "chatflow"`）。
- 更新时**只改请求里显式传入的字段**（Prisma 忽略 `undefined` ↔ `model_dump(exclude_unset=True)`）。
- 归属校验：**查不到、或不属于当前用户，一律 404**（`NotFoundException('App not found')` ↔ `HTTPException(404, "App not found")`）。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | **仓库根** | 确认依赖齐备（本篇无新增依赖） | 无报错 |
| `uv run uvicorn app.main:app --reload --port 8000` | **`apps/api-py` 目录** | 启动服务，监听 **8000**，提供 `/apps/*` | `Uvicorn running on http://127.0.0.1:8000` |
| `pnpm dev:api-py` | **仓库根** | 等价启动方式（内部 `uv run --directory apps/api-py …`，见阶段 0 · 06 §9） | 同上 |
| `curl … /auth/login` 拿 token → `curl … /apps` | 任意（服务在线） | 逐条验收五个接口 + 错误分支（见 §7） | 状态码见 §1 |

> **不在 `apps/api-py` 目录**时会 `ModuleNotFoundError: No module named 'app'`——`uvicorn app.main:app` 按当前工作目录解析 `app` 包。用根脚本 `pnpm dev:api-py` 时 `--directory` 已帮你切好。

---

## 5. 完整代码

### 5.1 `apps/api-py/app/api/apps.py`（本篇新增）

**完整文件路径：`apps/api-py/app/api/apps.py`**

```python
"""`/apps` 与 `/apps/{id}` 路由 —— 契约见 packages/contract/openapi.yaml。

行为与 api-ts 的 `AppsController` / `AppsService` 保持一致：
- 归属校验：查不到、或不属于当前用户，一律 404（不用 403，避免泄露资源是否存在）。
"""

import uuid                                        # 生成 id
from datetime import datetime                      # 时间字段类型
from typing import Literal                         # 字面量类型（枚举）

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy import select                      # 构造查询
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db  # 认证依赖 + 会话依赖（见 01-账号与认证/05）
from app.models.app import App                     # apps 表的 ORM 模型
from app.models.user import User                   # users 表的 ORM 模型
from app.timefmt import iso_z                      # datetime → "…Z"

router = APIRouter(prefix="/apps", tags=["apps"])  # 路由组，公共前缀 /apps

AppMode = Literal["chatflow", "workflow"]          # 可复用的枚举类型别名（≈ 契约 enum）


class AppResponse(BaseModel):
    """对应契约 `AppResponse`（只暴露契约字段）。"""

    model_config = ConfigDict(extra="forbid")     # 锁死字段集合

    id: str
    name: str
    description: str | None                        # 必填字段，值可为 str 或 None（→ JSON 字符串或 null）
    mode: str
    ownerId: str                                   # 契约名（camelCase）；ORM 里叫 owner_id
    createdAt: datetime
    updatedAt: datetime

    @field_serializer("createdAt", "updatedAt")    # 两个时间字段共用同一个序列化器
    def _serialize_timestamps(self, value: datetime) -> str:
        return iso_z(value)                        # UTC 毫秒 + "Z"


class CreateAppRequest(BaseModel):
    """对应契约 `CreateAppRequest`。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)             # 必填，长度 1..64
    description: str | None = Field(default=None, max_length=256)  # 可选（写了 default=None）
    mode: AppMode | None = None                                # 可选；缺省由服务层补 "chatflow"


class UpdateAppRequest(BaseModel):
    """对应契约 `UpdateAppRequest`（字段均可选）。"""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=64)   # 全部「可选 + 可为 None」
    description: str | None = Field(default=None, max_length=256)
    mode: AppMode | None = None


class AppListResponse(BaseModel):
    """对应契约 `AppListResponse`。"""

    model_config = ConfigDict(extra="forbid")

    items: list[AppResponse]                       # 数组元素是 AppResponse（嵌套模型）


def _to_app_response(app: App) -> AppResponse:
    # ORM 对象 → 契约响应：改名（ownerId←owner_id）+ 时间戳交给 field_serializer 归一
    # 库里是 naive timestamp；iso_z 会按 UTC 解释并输出毫秒 + Z 形式
    return AppResponse(
        id=app.id,
        name=app.name,
        description=app.description,               # DB 里为 NULL 时即 Python None
        mode=app.mode,
        ownerId=app.owner_id,                      # ← 改名
        createdAt=app.created_at,
        updatedAt=app.updated_at,
    )


def _find_owned(db: Session, owner_id: str, app_id: str) -> App:
    # 归属校验公共前置：查不到 或 不属于当前用户，一律 404（两种结果不可区分）
    app = db.get(App, app_id)
    if app is None or app.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")
    return app


@router.get("", response_model=AppListResponse, operation_id="listApps")
def list_apps(
    current_user: User = Depends(get_current_user),   # 注入当前用户（先解析依赖链）
    db: Session = Depends(get_db),                    # 注入会话（同请求内与上面的依赖缓存共用）
) -> AppListResponse:
    apps = db.scalars(
        select(App).where(App.owner_id == current_user.id).order_by(App.created_at.desc())
    ).all()                                           # 只查本人 + 按 created_at 倒序
    return AppListResponse(items=[_to_app_response(app) for app in apps])   # 列表推导式逐个映射


@router.post(
    "",
    response_model=AppResponse,
    status_code=status.HTTP_201_CREATED,              # 创建 → 201
    operation_id="createApp",
)
def create_app(
    body: CreateAppRequest,                           # 请求体（Pydantic 校验）
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AppResponse:
    app = App(                                        # 组装 ORM 对象
        id=str(uuid.uuid4()),
        owner_id=current_user.id,                     # ← 归属来自令牌，不来自请求体
        name=body.name,
        description=body.description,
        mode=body.mode or "chatflow",                 # 缺省补 "chatflow"（对齐 TS 的 dto.mode ?? 'chatflow'）
    )
    db.add(app)
    db.commit()
    db.refresh(app)                                   # 回读以获得数据库生成的 updated_at 等
    return _to_app_response(app)


@router.get("/{id}", response_model=AppResponse, operation_id="getApp")
def get_app(
    id: str,                                          # 路径参数 {id} → 函数参数（无 Depends）
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AppResponse:
    return _to_app_response(_find_owned(db, current_user.id, id))


@router.patch("/{id}", response_model=AppResponse, operation_id="updateApp")
def update_app(
    id: str,
    body: UpdateAppRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AppResponse:
    app = _find_owned(db, current_user.id, id)
    # 只更新请求中显式传入的字段
    for field, value in body.model_dump(exclude_unset=True).items():   # 未传的字段不在字典里
        setattr(app, field, value)                    # 把「传进来的字段」写回 ORM 对象
    db.commit()                                       # 触发 UPDATE；onupdate 自动刷新 updated_at
    db.refresh(app)
    return _to_app_response(app)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteApp")
def delete_app(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:                                             # 返回 None → 空体（204）
    app = _find_owned(db, current_user.id, id)
    db.delete(app)
    db.commit()
```

**这段在干什么（按执行顺序）**：

1. 模块导入时：`AppMode` 别名、四个模型、`router` 被定义——**不触发校验**。
2. 请求命中某条路由：FastAPI **按签名解析参数**——`id`（路径）、`body`（请求体，触发 Pydantic 校验）、`current_user` 与 `db`（依赖，现解析；因**依赖缓存**，同请求内 `get_db` 只开一个会话）。全部就绪后才调用函数体。
3. 函数体：`list_apps` 只查本人 + 倒序；`create_app` 组装→`commit`→`refresh`；`get_app`/`update_app`/`delete_app` 都先 `_find_owned` 做 404 归属校验，再动资源。
4. `return` 时：若是 `AppResponse`/`AppListResponse` 实例，则由 `response_model` 校验并序列化，`field_serializer` 把时间戳转成 `"…Z"`；`delete_app` 返回 `None`，配合 `status_code=204` 输出空体。

**逐块解释**

| 代码 | 作用 |
| --- | --- |
| `AppMode = Literal["chatflow", "workflow"]` | 契约 `enum: [chatflow, workflow]`；`Literal` 在运行期就能挡住别的取值（`Literal` 首次教学见阶段 0 · 06） |
| `class AppResponse(BaseModel)` + `model_config = ConfigDict(extra="forbid")` | 响应模型，锁死字段集合（`extra="forbid"` 首次教学见阶段 0 · 06 §10.3） |
| `response_model=AppResponse` / `AppListResponse` | FastAPI 用该模型**校验并序列化**返回值（`response_model` 见阶段 0 · 06 §10.2） |
| `status_code=status.HTTP_201_CREATED` / `HTTP_204_NO_CONTENT` | 契约要求创建 **201**、删除 **204**（删除 204 会返回空体） |
| `Depends(get_current_user)` / `Depends(get_db)` | 认证与数据库会话依赖（**首次教学见 `01-账号与认证/05-FastAPI认证.md`**，本篇只引用） |
| `_find_owned(db, owner_id, app_id)` | 归属校验小助手：查不到或非本人 → **404**（见 §6.3） |
| `_to_app_response(app)` | ORM 对象 → 契约响应（见 §6.1、§6.2） |
| `body.model_dump(exclude_unset=True)` | 只取**请求里显式传入**的字段（见 §6.4） |

> `db.scalars(select(...)).all()` / `db.get()` / `db.add` / `db.commit` / `db.refresh` / `db.delete` 都是 SQLAlchemy Session 的标准用法（**首次教学见 `01-账号与认证/04-SQLAlchemy2.0.md`**、`db.get` 见 `01-账号与认证/05-FastAPI认证.md`）。

### 5.2 `apps/api-py/app/api/deps.py`（未改动）

**完整文件路径：`apps/api-py/app/api/deps.py`**

本篇**不改** `deps.py`——`get_db` / `_unauthorized` / `get_current_user` 的完整代码与首次教学见 `01-账号与认证/05-FastAPI认证.md` §5.1。`apps.py` 直接复用其中两个依赖：

| 依赖 | 本篇用途 |
| --- | --- |
| `get_db()` | 提供一次请求一个的 SQLAlchemy 会话 |
| `get_current_user()` | 解析 `Authorization: Bearer`、验签、查出当前 `User`；无 token/坏 token/用户不存在 → 401 |

### 5.3 `apps/api-py/app/main.py`（新增一行挂载）

**完整文件路径：`apps/api-py/app/main.py`**

```python
"""FastAPI 入口（api-py）。

契约来源：packages/contract/openapi.yaml
本服务的所有接口都必须与该契约一致，并通过契约测试与 api-ts 对齐。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.apps import router as apps_router      # 应用路由（本篇新增）
from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.config import settings
from app.errors import register_error_handlers

app = FastAPI(title="mini-dify api-py", version=settings.version)   # 创建应用对象

# 前端（localhost:3000）与后端（localhost:8000）跨域，阶段 0 直接放开。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 把 FastAPI 默认的 {detail} 归一化成契约要求的 {statusCode, message, error}
register_error_handlers(app)                        # 登记异常处理器（须在 app 之后）

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(apps_router)                     # 挂载应用路由（新增这一行）
```

**这段在干什么（按执行顺序）**：导入 → 创建 `app` → 加 CORS → 登记异常处理器 → 逐个 `include_router`。新增的只有「导入 `apps_router`」与「挂载 `apps_router`」两处；`register_error_handlers(app)` 依旧在 `app` 之后调用（否则错误体退回 `{detail}`）。

**与阶段 1 · 05 的差异**只有两处：

1. `from app.api.apps import router as apps_router`（新增导入）。
2. 末尾 `app.include_router(apps_router)`（新增挂载）。

`register_error_handlers(app)` 与 `include_router` 的位置不变：**异常处理器必须在 `app = FastAPI(...)` 之后**注册（机制见 `01-账号与认证/05-FastAPI认证.md` §6.5）。`errors.py` 的 400/401/404/409 归一化把本篇的所有错误分支都变成了契约形状 `{statusCode,message,error}`——**本篇不重复实现，只复用**。

---

## 6. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 2 · 05」并直接使用。

### 6.0 本篇首次出现的 Python / FastAPI 机制（是什么 → NestJS 里对应什么 → 这里为什么这么写）

| # | 机制（本节） | 是什么（一句话） | NestJS 里对应什么 | 这里为什么这么写 |
| --- | --- | --- | --- | --- |
| 6.1 | **响应模型 + 显式映射**（ORM → 契约 JSON） | 用 Pydantic 模型声明出参形状，必要时手写映射函数 | `toAppResponse()` 手写视图映射 | 契约字段要**改名**、时间戳要**归一**，`from_attributes` 不够用 |
| 6.2 | **`None` 的序列化** | `str \| None` 的值可为字符串或 `None`（→ JSON `null`） | `description ?? null` | 契约要「字段总在、值可为 null」 |
| 6.3 | **404 归属校验** | 「不存在」与「非本人」合并成同一个 404 | `findOwned()` 抛 `NotFoundException` | 不泄露资源是否存在 |
| 6.4 | **`model_dump(exclude_unset=True)`** | 只导出「构造时显式传入过」的字段 | Prisma 忽略 `undefined` 字段 | 复刻 PATCH「只改传入字段」语义 |
| 6.5 | **`response_model` vs 显式映射的取舍** | 自动校验/序列化 vs 手写映射函数 | `toAppResponse()` | 见 6.1、6.5 |

> **复用的公共机制（首次教学在 `01-账号与认证/05-FastAPI认证.md`，这里先各用一句话说清，再指路）**：
> - **`Depends`**：写在处理函数**参数**上的依赖声明。FastAPI **处理每个请求时**读函数签名来解析依赖树（对照 NestJS 在**容器启动时**按类构造参数建图）——本篇每个路由的 `current_user`/`db` 都这样注入（详见 01-05 §6.1）。
> - **`get_db` 的 `yield` 依赖**：`yield` 之前「请求开始开会话」、之后「请求结束关会话」。`with` 负责在退出时 `close()`；两者叠加保证请求级会话、不泄漏（详见 01-05 §6.2）。
> - **依赖的依赖 + 依赖缓存**：`get_current_user` 自己又依赖 `bearer_scheme` 与 `get_db`；同请求内同一依赖**默认只算一次**（详见 01-05 §6.4）。
> - **`HTTPBearer` 安全依赖**：解析 `Authorization: Bearer`；本项目 `auto_error=False`，把缺 token 统一成 **401**（详见 01-05 §6.3）。
> - **`@app.exception_handler`**：在**响应生成之前**拦截异常、改写响应，把默认 `{detail}` 归一成 `{statusCode,message,error}`（详见 01-05 §6.5）。
> - **Pydantic v2 运行期校验**：`model_config`/`Field`/`field_serializer` 的触发时机，以及与 class-validator 文案的归一（详见 01-05 §6.6）。

### 6.1 Pydantic 响应模型与 `from_attributes` —— ORM 对象 → API 响应

**是什么**：API 对外返回的是**契约定义的 JSON**，而数据库层给你的是 **ORM 对象**（`App`）。中间必须有一次「**对象 → 响应模型**」的转换。Pydantic v2 提供两种做法：

| 做法 | 写法 | 特点 |
| --- | --- | --- |
| **A. `from_attributes`**：直接把 ORM 对象喂给模型 | `model_config = ConfigDict(from_attributes=True)`，然后 `AppResponse.model_validate(app)` | 省去手写赋值；**按字段名**从对象属性取值（`id ← app.id`） |
| **B. 显式转换函数**（本项目采用） | 手写 `_to_app_response(app)`，逐个字段赋给 `AppResponse(...)` | 可做**改名**与**规范化**（`ownerId=app.owner_id`、时间戳经 `iso_z` 归一） |

**`from_attributes` 的基本语法**（做法 A）

```python
from pydantic import BaseModel, ConfigDict

class AppResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)   # 允许"从对象属性"构造

    id: str
    name: str

# 传入一个「有 .id / .name 属性」的对象（ORM 实例、dataclass、SimpleNamespace 都行）
resp = AppResponse.model_validate(app)     # 等价于 AppResponse(id=app.id, name=app.name)
```

- **`from_attributes=True`** 打开「属性读取」通道：Pydantic 默认只认 dict/JSON，开启后才会去**读对象的属性**（而不是 `obj["id"]`）。
- 对应的是 Pydantic v1 的 `orm_mode = True`；v2 改成了统一的 `ConfigDict(from_attributes=...)`。
- 字段名要**与对象属性名一致**才会自动取到；不一致就得写**别名**（`Field(alias=...)` / `validation_alias`）或改用做法 B。

**本项目为什么用做法 B（显式 `_to_app_response`）**：因为契约字段名与 ORM 属性名**并不一致**，且时间戳需要额外加工：

| 契约字段 | ORM 属性 | 差异 |
| --- | --- | --- |
| `ownerId` | `owner_id` | **改名**（camelCase ↔ snake_case） |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | 改名 **+ 归一化**（naive → 经 `iso_z` 输出 UTC 毫秒 `Z`，与 TS `toISOString()` 逐字节一致） |
| `description` | `description` | 名字一致（可空，见 §6.2） |

若硬要用 `from_attributes`，就得为每个字段配别名并加序列化器，反而更绕。所以本项目选**显式转换**：一个函数把「改名 + 时间戳处理」都做掉，一眼可读。

**响应模型的两条纪律**（本项目沿用阶段 0 · 06 的既有约定）：

1. 每个响应模型都带 `ConfigDict(extra="forbid")` → 与契约 `additionalProperties: false` 对齐，**字段多一个都过不了**。
2. 对外**永远返回响应模型**（`AppResponse` / `AppListResponse`），**绝不**直接把 `App` ORM 对象当返回值——否则可能把不该暴露的列（如未来新增的内部字段）漏出去。

> 一句话：**`from_attributes` 是"字段名一一对应时"的省事法；字段名不一致或需要加工时，写个显式转换函数更清楚。** 本项目属于后者。

**NestJS 里对应什么**：NestJS 侧同样是**手写视图映射**——`apps.service.ts` 的私有方法 `toAppResponse(app)`，把 Prisma 实体逐字段映射成契约 `AppResponse`（`description ?? null`、`Date → toISOString()`）。两端的**目标完全一致**：在 service 边界上「白名单式」地只暴露契约字段。区别只是「机制」：Nest 里映射函数与 DTO 类型是**两样东西**（`toAppResponse` 返回一个 TS 对象），而 FastAPI 里映射函数返回的是**一个会自我校验的 Pydantic 实例**（`AppResponse`），再由 `response_model` 做二次把关。

**这里为什么这么写**：三件事逼着我们必须手写映射，而不是 `return app`：

1. **改名**：`ownerId`（契约）↔ `owner_id`（ORM）、`createdAt` ↔ `created_at`。
2. **值归一**：时间戳要经 `iso_z()` 变成 UTC 毫秒 `Z`（与 TS `toISOString()` 逐字节一致）。
3. **安全**：绝不把 ORM 对象直接当响应——将来 `App` 多出内部字段（如草稿图/密钥）也不会漏出去；`extra="forbid"` 又让「多给字段」直接报错。

> **`response_model` 在这里的作用**：路由上的 `response_model=AppResponse` 会对「映射出来的实例」再做**出参校验 + 序列化 + 生成文档**——它和显式映射是**叠加**关系，不是二选一（详见 §6.5）。

### 6.2 `None` 的序列化 —— `str | None` 怎么变成 JSON `null`

**问题**：契约里 `description` 的类型是 `type: ["string", "null"]`，即「**字段必须出现，但值可以是字符串或 `null`**」。这在 Python / Pydantic 里怎么表达？

**基本语法**

```python
from pydantic import BaseModel

class AppResponse(BaseModel):
    description: str | None      # 必填字段，值可为 str 或 None → JSON 输出 "..." 或 null
```

- `str | None`（等价 `Optional[str]`）表示「**值是字符串或 `None`**」。
- 注意**没有写 `= None`**：因此它是一个**必填**字段——构造时**必须显式给出** `description=`（给 `None` 也行），只是**允许**该值本身是 `None`。这样对齐契约：`description` 在 `required` 里没有（`AppResponse` 的 `required` 是 `[id, name, mode, ownerId, createdAt, updatedAt]`）——但响应里**总会出现**该字段，值可能为 `null`。
- 序列化时：`None` → JSON **`null`**；字符串 → JSON **`"..."`**。

**本项目怎么保证它是 `None` 而不是缺省**：

```python
return AppResponse(
    ...
    description=app.description,   # ORM 里是 Mapped[str | None]，DB 里可空；为 NULL 时就是 None
    ...
)
```

`_to_app_response` **总是**把这个字段传进去（`app.description` 若是数据库 NULL，就是 Python `None`），所以输出里 `description` **要么是字符串、要么是 `null`，绝不会"字段缺失"**。这正是契约想要的形状。

**请求侧的对照**（`CreateAppRequest` / `UpdateAppRequest`）：

```python
description: str | None = Field(default=None, max_length=256)   # 可选字段：不传就用默认 None
```

这里**写了 `= None`**，所以它是**可选**的——请求不传 `description` 也合法（缺省为 `None`）。「必填与否」和「值可否为 None」是**两个正交的维度**，别混：

| 写法 | 字段必填？ | 值可为 None？ |
| --- | --- | --- |
| `description: str \| None`（响应模型） | **必填**（构造时必须给） | 是 |
| `description: str \| None = None`（请求模型） | 可选（不传则取默认） | 是 |
| `name: str` | 必填 | 否 |

> 这也是为什么删掉「字段缺失」与「值为 null」要分开想：**PATCH 里"没传某字段"与"传了 `null`"是不同语义**——见 §6.4。

**NestJS 里对应什么**：TS 侧的 `description: string | null` 在**类型层**就能表达「字符串或 null」，映射时写 `app.description ?? null` 保证空值归 `null`（`toAppResponse`）。区别在于：TS 的联合类型**编译期擦除**、出参形状靠手写映射保证；Python 的 `str | None` 是 Pydantic 的**运行期**依据——它会**校验**「这个字段确实存在、且值要么是字符串要么是 `None`」。

**这里为什么这么写**：契约里 `description` 写的是 `type: ["string","null"]` 且**不在 `required` 里**——意思是「**字段总会出现，值可能是字符串或 `null`**」。所以：

- 响应模型写 `description: str | None`（**不带默认值**）→ 它是**必填**（映射时必须显式传），但**值可以是 `None`**；序列化时 `None` → JSON `null`。
- 请求模型写 `description: str | None = Field(default=None, …)`（**带默认值**）→ 它是**可选**（不传就用默认 `None`）。
- 两个维度**正交**：`| None` 管「值可否为 null」，`= None` 管「字段可否缺失」——别混。

### 6.3 404 归属校验 —— 为什么不用 403

**是什么**：`_find_owned` 是所有「单条资源」接口的公共前置：

```python
def _find_owned(db: Session, owner_id: str, app_id: str) -> App:
    app = db.get(App, app_id)
    if app is None or app.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")
    return app
```

**核心决策：查不到（不存在）与不属于我（无权限），**合并成同一个 404**。

| 做法 | 行为 | 泄露信息？ |
| --- | --- | --- |
| 不存在 → 404，别人的 → **403** | 两种结果可区分 | ❌ 攻击者能靠状态码**探测**「某个 appId 是否存在」——403 说明"存在但不是你的" |
| **不存在 or 别人的 → 都是 404**（本项目） | 两种结果**不可区分** | ✅ 不泄露资源是否存在 |

NestJS 侧同样是 `NotFoundException('App not found')`（`apps.service.ts` 的 `findOwned`）——**两端必须选同一种**，否则行为不一致、契约测试也过不去。

**`HTTPException` 的机制**：`raise HTTPException(status_code=404, detail="App not found")` 会被 `errors.py` 注册的异常处理器接住，归一化成契约形状：

```json
{"statusCode":404,"message":"App not found","error":"Not Found"}
```

（`HTTPException` 与异常处理器的首次教学见 `01-账号与认证/05-FastAPI认证.md` §6.5——本篇只**选用** 404 这个状态码，不重讲机制。）

**注意 `detail` 是字符串**：契约要求 `message` 为字符串，所以这里 `detail="App not found"` 直接给字符串即可。

**NestJS 里对应什么**：TS 侧的 `findOwned(ownerId, id)` 逻辑**逐字相同**——`app === null || app.ownerId !== ownerId` 就 `throw new NotFoundException('App not found')`。两端的「归属来源」也一致：`ownerId` 来自**令牌**（`payload.sub` / `current_user.id`），**不是**请求体字段——所以无法伪造归属。

**这里为什么这么写**：

- **为什么 404 不 403**：把「不存在」与「不属于你」压成同一种结果，攻击者**无法靠状态码探测**某个 id 是否存在（403 会泄露「存在但不是你的」）。这与阶段 1「登录：邮箱不存在 / 密码错误都回同一个 401」是**同一类安全思路**。
- **为什么抽成 `_find_owned`**：`get/update/delete` 三条路径都要同一套归属校验，抽成一个公共前置函数，改一处即全改；而 `list` 不走它（它 `where(owner_id == current_user.id)` 天然只查本人）。
- **`raise HTTPException(404, …)` 之后**：由 `errors.py` 的异常处理器归一成 `{"statusCode":404,"message":"App not found","error":"Not Found"}`（机制见 01-05 §6.5，此处只选用状态码）。

### 6.4 `model_dump(exclude_unset=True)` —— PATCH「只更新传入字段」

**问题**：PATCH 的语义是「**只改请求里出现过的字段**」。`UpdateAppRequest` 里三个字段都是可选的（`name: str | None = None`、`description: str | None = None`、`mode: AppMode | None = None`）。若直接遍历所有字段更新，那么「没传的字段」也会被当成 `None` 写进去——`name` 会变 `None`（违反非空）、`mode` 会变 `None`，全错。

**`model_dump` 是什么**：Pydantic 的 `BaseModel` 方法，把模型**导回成字典**。它有几个关键开关：

```python
body.model_dump()                        # 所有字段
body.model_dump(exclude_unset=True)      # 只保留"构造时显式传入过"的字段
body.model_dump(exclude_none=True)       # 去掉值为 None 的字段（≠ exclude_unset！）
```

| 开关 | 含义 |
| --- | --- |
| `exclude_unset=True` | 只导出**在构造时被显式设置过**的字段（"**set 过**"，即"传进来了"） |
| `exclude_none=True` | 导出**所有**字段但**去掉值为 `None`** 的（区分不了"没传" vs "传了 null"） |
| `exclude_defaults=True` | 去掉等于默认值的字段 |

**为什么 PATCH 要用 `exclude_unset` 而不是 `exclude_none`**：因为要区分两种请求：

- **没传** `mode` → `exclude_unset` 会把它**排除**，于是不更新 `mode`。✅ 正是 PATCH 想要的。
- **传了** `mode: null` → `exclude_unset` **保留**它（因为 set 过了），于是把 `mode` 更新成 `None`——语义是"显式清空/置空"。（当然 `mode` 在 ORM 里是非空，实际会被 DB/校验挡下；这里只讲区分能力。）而 `exclude_none` 会把这种"显式 null"也一并去掉，**失去区分能力**。

**本项目用法**：

```python
for field, value in body.model_dump(exclude_unset=True).items():
    setattr(app, field, value)     # 只把"传进来的字段"写回 ORM 对象
db.commit()
db.refresh(app)
```

`setattr` 把字典里的键（`name`/`description`/`mode`）设到 ORM 对象上；没传的字段根本不在这个字典里，所以**原值不动**。随后 `db.commit()` 触发 SQLAlchemy 的变更跟踪发出 `UPDATE`，`onupdate=func.now()` 自动刷新 `updated_at`（见本阶段 · 04 §6.6）。

> **与 NestJS 对照**：Prisma 的 `update` 天然忽略 `undefined` 字段（`data: { name: dto.name, description: dto.description, mode: dto.mode }` 里未传的为 `undefined`，就不更新）。FastAPI 侧没有这种"undefined"，于是用 `exclude_unset` **手工复刻**同一个语义。**两端行为一致：都只改传进来的字段。**

**这里为什么这么写**：

- **为什么不用 `exclude_none`**：`exclude_none` 会把「**显式传了 `null`**」也一并去掉，于是**区分不了**「没传」和「传了 null」——而 PATCH 恰恰需要区分（没传=不改，传 null=置空）。
- **为什么用 `exclude_unset`**：它只保留「**构造时显式传入过**」的字段（即"请求里真的出现过"），于是「没传的字段」根本不进循环、原值不动——正是 PATCH 想要的「部分更新」。
- **与 `response_model` 无关**：这里用的是**请求**模型（`UpdateAppRequest`）的 `model_dump`，是「入参 → dict」；`response_model` 管的是「出参 → JSON」。两个方向别混（见 §6.5）。

### 6.5 `response_model` 与显式映射函数的取舍

**是什么**：

- `response_model=AppResponse`（写在**路由装饰器**上）：告诉 FastAPI「这条路由的返回值必须符合该模型」，它会**按模型校验 + 序列化**返回值，并据此生成 OpenAPI 文档。若返回值字段缺失/类型不符，会在**响应阶段**抛错（典型 **500**）。
- **显式映射函数**（`_to_app_response`）：把 ORM 对象 `App` 逐字段转成 `AppResponse` 实例再返回。

两者**叠加使用**，各自职责不重叠：映射函数负责「**改名 + 值归一 + 白名单**」，`response_model` 负责「**出参校验 + 序列化 + 文档**」。为什么不用 `from_attributes` 省掉映射函数——因为本项目字段要改名、时间戳要归一（见 §6.1）。

**NestJS 里对应什么**：TS 侧没有等价的「出参校验模型」这一层——它靠**手写 `toAppResponse`** 直接把字段拼成契约形状（类型只在编译期约束、**运行期不校验**）。FastAPI 多了一层 `response_model` 做**运行期**把关：既校验又序列化，还能自动喂给 `/docs`。取舍：

| 维度 | NestJS | FastAPI（本项目） |
| --- | --- | --- |
| 出参形状由谁保证 | 手写映射（编译期类型，运行期不校验） | 手写映射 + `response_model`（**运行期**再校验一次） |
| 类型与校验 | 两样东西 | 一个模型同时是类型与校验器 |
| 好处 | 灵活、无额外开销 | 违约在运行期立即暴露，文档不脱节 |
| 代价 | 运行期漏字段无从发现 | 出参多一层校验；失败时表现为 500 |

**这里为什么这么写**：既保留**显式映射**（改名/归一/白名单清清楚楚），又用 `response_model` 做**运行期兜底**与文档——两全其美；代价是映射漏字段时会以 500 暴露（见 §8）。


---

## 7. 验收自测

> 先启动服务：在 `apps/api-py` 目录 `uv run uvicorn app.main:app --reload --port 8000`（或仓库根 `pnpm dev:api-py`）。
> 准备一个 token：先 `POST /auth/register` 注册，再 `POST /auth/login` 拿 `accessToken`（机制见 `01-账号与认证/05`、`06`）。下面用 `$TOKEN` 代指它。

### 7.1 五项主流程（实测状态码）

| 请求 | 命令 | 实测状态码 | 响应要点 |
| --- | --- | --- | --- |
| 创建 | `curl -s -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:8000/apps -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"My First App","description":"hello"}'` | **201** | `{"id":"d770c4e5-…","name":"My First App","description":"hello","mode":"chatflow","ownerId":"…","createdAt":"2026-10-18T09:12:33.648Z","updatedAt":"2026-10-18T09:12:33.648Z"}` |
| 列表 | `curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:8000/apps -H "Authorization: Bearer $TOKEN"` | 200 | `{"items":[{…同上…}]}` |
| 详情 | `curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:8000/apps/<id> -H "Authorization: Bearer $TOKEN"` | 200 | 单个 `AppResponse` |
| 更新 | `curl -s -w "\nHTTP %{http_code}\n" -X PATCH http://127.0.0.1:8000/apps/<id> -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Renamed","mode":"workflow"}'` | 200 | `name`/`mode` 变、`updatedAt` **变化**（`.648Z` → `.671Z`），`description` 因**未传**而**不变** |
| 删除 | `curl -s -w "\nHTTP %{http_code}\n" -X DELETE http://127.0.0.1:8000/apps/<id> -H "Authorization: Bearer $TOKEN"` | **204** | **空体** |

### 7.2 错误分支（实测）

| 场景 | 实测响应体 | 状态码 |
| --- | --- | --- |
| 不带 token 创建 | `{"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}` | **401** |
| B 访问 A 的应用（GET/PATCH/DELETE） | `{"statusCode":404,"message":"App not found","error":"Not Found"}` | **404** |
| 删除后再查 | `{"statusCode":404,"message":"App not found","error":"Not Found"}` | **404** |
| `name` 为空串 | `{"statusCode":400,"message":"name must be at least 1 characters","error":"Bad Request"}` | **400** |
| `name` 超 64 字符 | `{"statusCode":400,"message":"name must be at most 64 characters","error":"Bad Request"}` | **400** |
| `mode` 非法（`"nope"`） | `{"statusCode":400,"message":"mode must be one of: chatflow, workflow","error":"Bad Request"}` | **400** |
| 多余字段（`"foo":1`） | `{"statusCode":400,"message":"foo should not exist","error":"Bad Request"}` | **400** |

> 所有错误体的 `message` 都是**字符串**、都带 `error` 原因短语，且文案由 `packages/contract/error-messages.md` 统一规定——两端逐字节相同（机制见 `01-账号与认证/05`，收口见 `02-应用管理/07-验收.md` §4.2）。

### 7.3 跨后端（实测）

用**同一个 token**，在 api-py 建应用、在 api-ts 查它：

| 步骤 | 命令 | 实测结果 |
| --- | --- | --- |
| api-py 建 | `POST http://127.0.0.1:8000/apps`（`{"name":"CrossBackend","description":"py made"}`） | 201，`id = 323647af-494b-4e0c-a8ae-7b51bafd0b69` |
| api-ts 查列表 | `GET http://127.0.0.1:3001/apps` -H "Authorization: Bearer $TOKEN" | 200，`items` 里**含**上面的 `323647af-…` |
| api-ts 查详情 | `GET http://127.0.0.1:3001/apps/323647af-…` | 200，同一条记录 |

**结论**：两端共用同一个数据库、同一套认证域，**api-py 写、api-ts 读，数据一致**。

### 7.4 值规范收口（原「已知差异」已消除）

早先两端**状态码与响应体形状完全一致**，但有两处**值的表现形式**不同——属「契约一致的两层」（结构一致 vs 值规范一致，见 `00-项目初始化/08-验收.md`）里第二层尚未收敛的部分。**本阶段已把这两处一并收口，实测逐字节一致**（详见 `02-应用管理/07-验收.md` §4.2）：

| 项 | 收口前 | 收口后（实测，两端相同） |
| --- | --- | --- |
| 校验失败 `message` **文本** | api-py 为 Pydantic 默认文案（如 `String should have at least 1 character`），api-ts 为 class-validator 文案，措辞不同 | 由 `packages/contract/error-messages.md` 统一规定：`name must be at least 1 characters`、`name must be at most 64 characters`、`mode must be one of: chatflow, workflow`、`foo should not exist`… |
| 时间戳格式 | api-py 微秒 + 偏移（`…878000+00:00`），api-ts 毫秒 + `Z`（`…878Z`） | 统一为 UTC **毫秒 `Z`**（如 `2026-10-18T09:18:08.878Z`，固定 24 字符）：Python 侧 `iso_z()` + `field_serializer` |

> 收口过程还暴露出邮箱「接受集合」的真实分歧（`require_tld`：validator.js 默认拒绝单字符 TLD，Pydantic `EmailStr` 接受），已用自定义装饰器 `@IsEmailFormat()` 对齐——细节见 `02-应用管理/07-验收.md` §4.2。这两类差异的收敛不影响状态码、字段集合与类型（仍满足契约的 `ErrorResponse` 与 `date-time`）。

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 服务启动 | `uv run uvicorn app.main:app --reload --port 8000` | `Uvicorn running on http://127.0.0.1:8000` |
| 五个接口 | §7.1 | 201 / 200 / 200 / 200 / 204 |
| 无 token | §7.2 第 1 行 | 401 契约信封 |
| 越权/不存在 | §7.2 第 2、3 行 | 404 `App not found` |
| 校验失败 | §7.2 第 4–7 行 | 400 契约信封（`message` 为字符串） |
| 跨后端 | §7.3 | api-ts 能查到 api-py 建的应用 |
| 文档 | 打开 <http://localhost:8000/docs> | 可见 `/apps`、`/apps/{id}` 的 5 个方法 + Authorize 按钮 |

---

## 8. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 用 403 表示"别人的应用" | 与 api-ts 行为不一致、契约测试失败 | 归属校验用 **404**（`_find_owned` 把"不存在"与"非本人"合并为 404，避免探测资源是否存在；见 §6.3） |
| PATCH 把所有字段都写了一遍 | `name`/`mode` 被写成 `None`（或报非空违例） | 用 `body.model_dump(exclude_unset=True)`，只更新**传入**的字段（见 §6.4） |
| 用了 `exclude_none` 而非 `exclude_unset` | 无法区分"没传"与"传了 null" | PATCH 要的是「没传就不改」，必须 `exclude_unset`（见 §6.4） |
| 直接返回 ORM 对象 | 响应字段可能超出契约 / 序列化失败 | 一律经 `AppResponse` / `_to_app_response` 输出；响应模型 `extra="forbid"` 挡住多余字段（见 §6.1） |
| `description` 字段缺失 | 契约测试报"少字段" | `description: str \| None` **无默认值**，构造时必须显式传入（值为 `None` 也要传）；`_to_app_response` 总是传（见 §6.2） |
| `createdAt` 时区/格式不对 | 与契约比对失败 | 库里是 naive `timestamp`；`_to_app_response` 交给 `iso_z()`（`field_serializer`）按 UTC 输出**毫秒 + `Z`** 的 24 字符串（机制见 `01-账号与认证/05`；收口见 `02-应用管理/07-验收.md` §4.2） |
| 响应模型少了 `ConfigDict(extra="forbid")` | 契约测试报"多字段" | 与契约 `additionalProperties: false` 对齐；本项目响应模型统一带上（见 §6.1） |
| `mode` 缺省没补 | 创建出的 `mode` 为 null/空 | `CreateAppRequest` 的 `mode` 可选，服务里用 `body.mode or "chatflow"` 补默认（对齐 TS 的 `dto.mode ?? 'chatflow'`） |
| 列表顺序不对 | 与 TS 侧不一致 | 列表按 `created_at` **倒序**：`order_by(App.created_at.desc())`（对齐 `orderBy: { createdAt: 'desc' }`） |
| 参数少了 `= Depends(...)` | 明明想注入 `db` 却报 422/400 缺字段 | FastAPI 把未被占用的普通参数当请求参数解析；必须写 `db: Session = Depends(get_db)`（见 `01-账号与认证/05` §6.1、§8） |
| **映射漏传 `response_model` 的字段** | 出参校验失败 → **500** | `_to_app_response` 必须把 `AppResponse` 声明的每个字段都显式传上（如漏 `updatedAt`）。出参违约在**响应阶段**抛错，表现为 500（服务端 bug，不是客户端输入错）；见 §6.5 |
| **`get_db` 忘了 `with`/`yield`** | 连接**泄漏**（连接池耗尽、并发卡/超时） | `yield` 只负责交卷、`close` 靠外层 `with`；必须 `with SessionLocal() as session: yield session`（机制见 `01-账号与认证/05` §6.2） |
| **在 `def` 依赖/路由里写 `await`** | `SyntaxError` | Python 异步是全链路的：要 `await` 必须 `async def`。`apps.py` 的路由都是 `def`（内部是同步 SQLAlchemy 调用，由线程池兜住）——别乱加 `async`（机制见 `01-账号与认证/05` §6.2、阶段 0 · 06 §6.7） |
| **异常处理器未注册/注册时机错** | 错误体退回 `{"detail": …}`、校验失败退回 422 | `register_error_handlers(app)` 必须在 `app = FastAPI(...)` 之后、对外服务之前调用，且注册到**同一个** `app`（机制见 `01-账号与认证/05` §6.5） |
| 在仓库根启动失败 | `ModuleNotFoundError: No module named 'app'` | 进 `apps/api-py`，或 `uv run --directory apps/api-py …`（见阶段 0 · 06 §9） |
| `uv` 不被识别 | `The term 'uv' is not recognized` | `uv` 已在用户 PATH；只有安装前已打开的 shell 继承旧 PATH，重启终端 / IDE 即可（见阶段 0 · 01） |

---

## 9. 与 api-ts 的对照

| 概念 | NestJS（api-ts） | FastAPI（api-py） |
| --- | --- | --- |
| 路由 | `@Controller('apps')` + `@Get()/@Post()/@Get(':id')/@Patch(':id')/@Delete(':id')` | `APIRouter(prefix="/apps")` + `@router.get("")...` |
| 认证 | `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` | 每个处理函数 `current_user: User = Depends(get_current_user)` |
| 请求体校验 | `class-validator` DTO（`@Length(1,64)` / `@IsIn(APP_MODES)` / `@MaxLength(256)`） | Pydantic `Field(min_length=1, max_length=64)` / `Literal["chatflow","workflow"]` |
| 额外字段 | `ValidationPipe({ forbidNonWhitelisted: true })` | `ConfigDict(extra="forbid")` |
| 归属校验 | `findOwned()` 抛 `NotFoundException('App not found')` | `_find_owned()` 抛 `HTTPException(404, "App not found")` |
| 越权码 | 404（不用 403） | 404（不用 403） |
| 创建默认值 | `dto.mode ?? 'chatflow'` | `body.mode or "chatflow"` |
| 更新语义 | Prisma 忽略 `undefined` 字段 | `model_dump(exclude_unset=True)` 只改传入字段 |
| 列表排序 | `orderBy: { createdAt: 'desc' }` | `order_by(App.created_at.desc())` |
| 响应转换 | `toAppResponse(app)` 手写映射 | `_to_app_response(app)` 手写映射（`from_attributes` 因改名/时区不用） |
| 删除响应 | `@HttpCode(204)` 空体 | `status_code=204` 返回 `None`（空体） |
| ORM | Prisma Client（`prisma.app.*`） | SQLAlchemy `Session` + `select()` |
| 错误体归一化 | `HttpErrorFilter` | `errors.py` 的 `@app.exception_handler`（见 `01-账号与认证/05`） |

两套实现同一份契约（`02-应用管理/01-契约扩展.md`），**状态码、响应体形状与值规范（`message` 文本、时间戳格式）均已逐字节一致**（收口见 §7.4）。

### 9.1 逐条讲差异与取舍

对照表给「什么对什么」，这里补「**为什么不同、各自取舍**」——读 TS 侧 `03-NestJS应用模块.md` 时对着看：

| 主题 | NestJS 怎么做 | FastAPI 怎么做 | 差异的根源 / 取舍 |
| --- | --- | --- | --- |
| **鉴权粒度** | 类级 `@UseGuards(JwtAuthGuard)`，整个控制器一次生效 | **每个函数**各自写 `current_user: User = Depends(get_current_user)` | Nest 是「声明式、贴在类上」；FastAPI 是「函数级、逐个显式」。FastAPI 更细粒度（同一控制器里某条路由可以不带鉴权），代价是重复写（详见 01-05 §6.1） |
| **归属来源** | `@CurrentUser() payload.sub` | `current_user.id` | 两端都把归属绑定到**令牌**而非请求体——同一个安全原则（§6.3） |
| **部分更新** | Prisma 忽略 `undefined` | `model_dump(exclude_unset=True)` 手工复刻 | 「未传=不改」的语义两端一致，实现机制不同（§6.4） |
| **出参映射** | 手写 `toAppResponse`（运行期不校验） | 手写 `_to_app_response` + `response_model`（运行期再校验） | FastAPI 多一层出参把关，违约早暴露（§6.1、§6.5） |
| **删除空体** | `@HttpCode(204)` | `status_code=204` + 返回 `None` | 契约要 204 空体；两端都要**显式覆盖默认值**（Nest `@Post/@Delete` 默认 201；FastAPI 默认 200） |
| **错误体归一** | `HttpErrorFilter` 全局过滤器 | `@app.exception_handler`（`errors.py`） | 表达机制不同、目标相同（见 01-05 §6.5） |

> **共通点**：两端都遵循「**归属由令牌决定、越权一律 404、出参只暴露契约字段、PATCH 只改传入字段**」——差异在表达机制，不在行为。

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| Pydantic 响应模型与 `from_attributes`（ORM 对象 → API 响应；本项目用显式转换函数） | **首次教学于本篇** |
| `None` 的序列化（`str \| None` → JSON `null`；"必填"与"值可为 None"正交） | **首次教学于本篇** |
| 404 归属校验（"不存在"与"非本人"合并为 404，不用 403，避免泄露资源存在性） | **首次教学于本篇** |
| `model_dump(exclude_unset=True)`（PATCH「只更新传入字段」；对比 `exclude_none`） | **首次教学于本篇** |
| 应用模块与 NestJS `AppsController`/`AppsService` 的行为对齐（排序/默认值/PATCH 语义） | **首次教学于本篇** |
