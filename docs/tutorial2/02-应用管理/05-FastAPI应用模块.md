# 05 · FastAPI 应用模块（应用管理）

> 阶段 2 · 第 5 步
>
> 做完：`api-py` 的 `/apps` 五个接口全部可用；归属校验 404、`201/200/204`、错误文案与 NestJS 逐字节一致；同一个应用可以通过两套后端交替读写。
>
> **本篇面试考点**：`model_dump(exclude_unset=True)` 为什么是 PATCH 的关键 · `Literal` 与 `str` 的边界 · `db.get` 与 `select` 的取舍 · `commit` 后为什么必须 `refresh` · 空 PATCH `{}` 的契约缺口 · ORM 删除与数据库级联。

---

## 1. 文件清单

```text
apps/api-py/app/
├── models/
│   ├── app.py          ← 阶段 2 已映射（04 篇）
│   └── user.py         ← 已加 apps 关系
├── api/
│   └── apps.py         ← 本篇：DTO + 五个路由
└── main.py             ← 挂载 apps_router
```

Python 侧没有 Service 层：路由函数就是“薄 Service”。这是 FastAPI 项目的常见写法——依赖注入（`Depends`）承担了 NestJS 里 provider 装配的职责，业务不复杂时再拆一层反而增加跳转成本。

---

## 2. 路由文件

**完整文件路径：`apps/api-py/app/api/apps.py`**

```python
"""`/apps` 与 `/apps/{id}` 路由 —— 契约见 packages/contract/openapi.yaml。

行为与 api-ts 的 `AppsController` / `AppsService` 保持一致：
- 归属校验：查不到、或不属于当前用户，一律 404（不用 403，避免泄露资源是否存在）。
"""

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.app import App
from app.models.user import User
from app.timefmt import iso_z

router = APIRouter(prefix="/apps", tags=["apps"])

# Literal 既是类型也是运行期枚举：Pydantic 会拒绝其它值
AppMode = Literal["chatflow", "workflow"]


class AppResponse(BaseModel):
    """对应契约 `AppResponse`（只暴露契约字段）。"""

    # 多传字段直接报错，等价于契约的 additionalProperties: false
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    # 契约里可为 null；这里不设默认值，构造时必须显式传
    description: str | None
    mode: str
    ownerId: str
    createdAt: datetime
    updatedAt: datetime

    @field_serializer("createdAt", "updatedAt")
    def _serialize_timestamps(self, value: datetime) -> str:
        # 与 TS 的 Date.toISOString() 逐字节一致（UTC + 毫秒 + Z）
        return iso_z(value)


class CreateAppRequest(BaseModel):
    """对应契约 `CreateAppRequest`。"""

    model_config = ConfigDict(extra="forbid")

    # 必填：没有默认值
    name: str = Field(min_length=1, max_length=64)
    # 可选：不传就是 None（入库为 NULL）
    description: str | None = Field(default=None, max_length=256)
    # 可选：不传由服务端默认 chatflow
    mode: AppMode | None = None


class UpdateAppRequest(BaseModel):
    """对应契约 `UpdateAppRequest`（字段均可选）。"""

    model_config = ConfigDict(extra="forbid")

    # 注意：默认值都是 None，配合 exclude_unset 才能区分“没传”和“显式传 null”
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=256)
    mode: AppMode | None = None


class AppListResponse(BaseModel):
    """对应契约 `AppListResponse`。"""

    model_config = ConfigDict(extra="forbid")

    items: list[AppResponse]


def _to_app_response(app: App) -> AppResponse:
    """ORM 实体 → 契约视图；只在这里做 snake_case → camelCase 的转换。"""
    return AppResponse(
        id=app.id,
        name=app.name,
        description=app.description,
        # 数据库是 String，契约是枚举；写入时 DTO 已保证取值，出口处直接透传
        mode=app.mode,
        ownerId=app.owner_id,
        createdAt=app.created_at,
        updatedAt=app.updated_at,
    )


def _find_owned(db: Session, owner_id: str, app_id: str) -> App:
    """按主键取应用；不存在或不属于当前用户都抛 404。"""
    # db.get 走主键，比 select + where 少写一行，且会命中 identity map
    app = db.get(App, app_id)
    if app is None or app.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")
    return app


@router.get("", response_model=AppListResponse, operation_id="listApps")
def list_apps(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AppListResponse:
    # 只查自己的；排序与 api-ts 一致（created_at 倒序）
    apps = db.scalars(
        select(App).where(App.owner_id == current_user.id).order_by(App.created_at.desc())
    ).all()
    return AppListResponse(items=[_to_app_response(app) for app in apps])


@router.post(
    "",
    response_model=AppResponse,
    # 创建资源 → 201；FastAPI 默认 200，必须显式写
    status_code=status.HTTP_201_CREATED,
    operation_id="createApp",
)
def create_app(
    body: CreateAppRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AppResponse:
    app = App(
        # uuid 由应用侧生成：数据库 id 列没有 DEFAULT（Prisma 的 uuid() 是客户端默认值）
        id=str(uuid.uuid4()),
        # owner_id 来自 token，绝不来自请求体
        owner_id=current_user.id,
        name=body.name,
        description=body.description,
        # 默认值放服务端；`or` 对空串也会回退，但 Literal 已排除空串
        mode=body.mode or "chatflow",
    )
    db.add(app)
    db.commit()
    # 刷新拿到数据库生成的 created_at、触发器维护的 updated_at
    db.refresh(app)
    return _to_app_response(app)


@router.get("/{id}", response_model=AppResponse, operation_id="getApp")
def get_app(
    id: str,
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
    # exclude_unset=True：只包含请求体里**显式出现**的字段。
    # 不传 name → name 不在字典里；显式传 null → 字典里是 {'description': None}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(app, field, value)
    db.commit()
    db.refresh(app)
    return _to_app_response(app)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteApp")
def delete_app(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    app = _find_owned(db, current_user.id, id)
    db.delete(app)
    db.commit()
    # 返回 None，配合 204 → 无响应体
```

> **面试考点 · PATCH 为什么必须 `exclude_unset=True`？**
> 因为 Pydantic 的模型**无法区分“没传”和“传了默认值”**：`UpdateAppRequest().description` 是 `None`，`{"description": null}` 解析出来也是 `None`。如果直接 `model_dump()`，每个字段都会出现在字典里，PATCH 就退化成“把没传的字段全部清空”。
>
> `exclude_unset=True` 依据 `model_fields_set`（解析时实际出现过的键）过滤，语义正好是“传什么改什么”。对应地，NestJS + Prisma 那边靠的是“值为 `undefined` 的字段被忽略”。
>
> **追问：`exclude_none=True` 行不行？**
> 不行。它会把**显式传 `null`** 的字段也丢掉，于是 `{"description": null}` 无法清空描述。`exclude_unset` 才是正确的语义。
>
> **追问：那 `name: null` 呢？**
> `name` 的类型是 `str | None`，`null` 能通过校验，然后 `setattr(app, 'name', None)`，提交时数据库 `NOT NULL` 报错 → 500。这是与 NestJS 侧 `@IsOptional()` 同样的边界问题。要堵住就用 `@field_validator` 或把类型改成 `str` 并用 `model_fields_set` 判断；这一阶段先不处理。

> **面试考点 · `db.get(App, id)` 和 `select(App).where(App.id == id)` 选哪个？**
> - `db.get` 是**主键查询**专用：写法短、会先查 identity map（同一 session 里已加载的对象直接返回，不发 SQL）。
> - `select(...)` 更通用：能加任意条件、`join`、`options`，也是 `db.scalars()` 的标准入口。
> - 这里已经知道是主键，用 `get` 最直接。**归属校验不能塞进 `get`**（主键只有一个），所以取出来后再比 `owner_id`。
>
> 与 NestJS 侧一样，这是“先查后改”的写法，存在 TOCTOU 时间窗。要原子化可以：
>
> ```python
> result = db.execute(
>     update(App)
>     .where(App.id == id, App.owner_id == current_user.id)
>     .values(**body.model_dump(exclude_unset=True))
> )
> if result.rowcount == 0:
>     raise HTTPException(404, "App not found")
> ```
>
> 但这样拿不到更新后的实体，还要再查一次。**取舍与 `03-NestJS应用模块.md` 里 `updateMany` 的讨论完全对应。**

> **面试考点 · `commit()` 之后为什么必须 `refresh()`？**
> - `created_at` 是**数据库默认值**，SQLAlchemy 在 INSERT 后不一定知道数据库填了什么；
> - `updated_at` 被**触发器**改写，ORM 更不可能预知。
>
> `db.refresh(app)` 重新 `SELECT` 一次，把数据库里的真实值拉回对象。少了它，响应里的 `createdAt` / `updatedAt` 可能是 `None` 或旧值，`iso_z()` 直接崩。
> 代价是每次写多一次查询。生产里可以用 `RETURNING`（PostgreSQL 支持）省掉这一趟，但代码复杂度上升。

> **面试考点 · 响应模型里 `mode: str`，为什么不写 `AppMode`？**
> 写 `AppMode` 更严格：数据库里如果有脏数据（比如手工 SQL 插了 `'chat'`），序列化会直接报错，问题暴露在出口。写 `str` 则允许脏数据流到前端，再由前端 Zod 拦住。
> 本项目选 `str`，是假设“写入路径只有 DTO 这一条、`Literal` 已保证取值”。**如果你更希望数据库脏数据立刻炸在服务端，就写 `AppMode`——两种都是合理取舍，关键是知道自己在信什么。**

---

## 3. 挂载路由

**完整文件路径：`apps/api-py/app/main.py`**（阶段 2 的完整内容）

```python
"""FastAPI 入口（api-py）。

契约来源：packages/contract/openapi.yaml
本服务的所有接口都必须与该契约一致，并通过契约测试与 api-ts 对齐。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.apps import router as apps_router
from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.config import settings
from app.errors import register_error_handlers
from app.json_response import UTF8JSONResponse

app = FastAPI(
    title="mini-dify api-py",
    version=settings.version,
    # 与 api-ts 一致：JSON 响应声明 charset=utf-8
    default_response_class=UTF8JSONResponse,
)

# 前端 :3000 调后端 :8000，跨域放开
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 统一错误体：{statusCode, message, error}
register_error_handlers(app)

app.include_router(health_router)
app.include_router(auth_router)
# 阶段 2：应用管理
app.include_router(apps_router)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.port, reload=True)
```

> **面试考点 · 路由顺序会影响匹配吗？**
> 会。FastAPI/Starlette 按注册顺序匹配，`/apps/{id}` 这类路径参数会吃掉 `/apps/anything`。如果以后要加 `/apps/export` 这种**静态路径**，必须注册在 `/apps/{id}` **之前**，否则 `export` 会被当成 id。
> 本项目阶段 2 没有静态子路径，暂时不用管；但这是加接口时最容易踩的顺序坑。

---

## 4. 验证

```powershell
cd apps/api-py
uv run uvicorn app.main:app --reload --port 8000
```

```powershell
# 用 bob 登录（api-py 注册的用户）
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'bob@example.com'; password = 'password123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.accessToken)" }
```

```powershell
# 1. 创建 → 201
$app = Invoke-RestMethod -Method Post -Uri http://localhost:8000/apps `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ name = 'faq-bot'; description = 'FAQ assistant' } | ConvertTo-Json)
$app | Format-List
```

预期：`mode = chatflow`、`ownerId` 是 bob 的 id、时间戳形如 `2026-10-18T03:41:07.512Z`。

```powershell
# 2. 列表 → 200
Invoke-RestMethod -Uri http://localhost:8000/apps -Headers $h | ConvertTo-Json -Depth 5

# 3. PATCH 只改 name，description 必须保持不变
Invoke-RestMethod -Method Patch -Uri "http://localhost:8000/apps/$($app.id)" `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ name = 'faq-bot-v2' } | ConvertTo-Json) | Format-List
```

重点看 `description` 仍然是 `FAQ assistant`——如果被清空，说明 `exclude_unset` 写错了。

```powershell
# 4. 显式传 null 才能清空 description
Invoke-RestMethod -Method Patch -Uri "http://localhost:8000/apps/$($app.id)" `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ description = $null } | ConvertTo-Json) | Format-List
```

预期 `description` 变为空（`Format-List` 里显示为空行）。

```powershell
# 5. 越权 → 404（用 alice 的 token 访问 bob 的应用）
$alice = Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json)
try {
  Invoke-RestMethod -Uri "http://localhost:8000/apps/$($app.id)" `
    -Headers @{ Authorization = "Bearer $($alice.accessToken)" }
} catch { $_.ErrorDetails.Message }
```

```powershell
# 6. 校验错误：name 太短 / mode 非法 / 多传 ownerId
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:8000/apps -Headers $h `
    -ContentType 'application/json' -Body (@{ name = '' } | ConvertTo-Json)
} catch { $_.ErrorDetails.Message }

try {
  Invoke-RestMethod -Method Post -Uri http://localhost:8000/apps -Headers $h `
    -ContentType 'application/json' -Body (@{ name = 'x'; mode = 'chat' } | ConvertTo-Json)
} catch { $_.ErrorDetails.Message }

try {
  Invoke-RestMethod -Method Post -Uri http://localhost:8000/apps -Headers $h `
    -ContentType 'application/json' -Body (@{ name = 'x'; ownerId = 'someone-else' } | ConvertTo-Json)
} catch { $_.ErrorDetails.Message }
```

预期（与 api-ts 逐字节一致）：

```json
{"statusCode":404,"message":"App not found","error":"Not Found"}
{"statusCode":400,"message":"name must be at least 1 characters","error":"Bad Request"}
{"statusCode":400,"message":"mode must be one of: chatflow, workflow","error":"Bad Request"}
{"statusCode":400,"message":"ownerId should not exist","error":"Bad Request"}
```

> **注意**：Pydantic 的 `min_length` 文案是 `at least`，class-validator 的是 `longer than or equal to`。如果契约测试要求逐字节一致，`errors.py` 里的 `_describe` 需要把两种措辞对齐成同一个。阶段 2 的验收以**状态码 + 结构**为准；文案统一留到契约测试阶段收口。

### 4.1 跨后端读写同一个应用

```powershell
# 7. api-py 创建的应用，用 api-ts 读（同一个用户、同一张表）
Invoke-RestMethod -Uri "http://localhost:3001/apps/$($app.id)" `
  -Headers @{ Authorization = "Bearer $($login.accessToken)" }

# 8. 用 api-ts 改名，再用 api-py 读回来
Invoke-RestMethod -Method Patch -Uri "http://localhost:3001/apps/$($app.id)" `
  -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -ContentType 'application/json' `
  -Body (@{ name = 'faq-bot-cross' } | ConvertTo-Json) | Out-Null

Invoke-RestMethod -Uri "http://localhost:8000/apps/$($app.id)" -Headers $h
```

两步都成功，说明：

1. 两套后端连的是同一个数据库、同一张 `apps` 表；
2. `id` 都是应用侧生成的 uuid，没有“各自一套 id 空间”；
3. 时间字段两种语言序列化后都是 24 字符的 `...Z`；
4. 归属校验读的是同一个 `owner_id`。

```powershell
# 9. 删除 → 204
curl.exe -i -X DELETE "http://localhost:8000/apps/$($app.id)" -H "Authorization: Bearer $($login.accessToken)"

# 10. 再查 → 404
try { Invoke-RestMethod -Uri "http://localhost:8000/apps/$($app.id)" -Headers $h } catch { $_.ErrorDetails.Message }
```

> **面试考点 · 空 PATCH `{}` 是一个契约缺口吗？**
> 是。契约里 `UpdateAppRequest` 没有必填字段，所以 `{}` 合法，但两端行为可能不同：
>
> - Python：`exclude_unset=True` 得到空字典 → 没有属性被标记为脏 → `commit` 不发 UPDATE → `updated_at` 不变；
> - NestJS + Prisma：`update` 调用会带上 `@updatedAt`，可能只刷新 `updated_at`。
>
> 结果就是同一个请求，两端返回的 `updatedAt` 可能不同。生产里应在契约层收口：要么加 `minProperties: 1` 禁止空更新（400），要么明确“空更新也要刷新时间”。**契约不写清楚的地方，两套实现一定会分叉。**

---

## 5. 下一步

- `06-前端应用列表.md`：列表渲染、新建、删除、401 回跳，用 Zod 校验 `appListResponseSchema`。
