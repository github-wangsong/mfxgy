# 05 · FastAPI 认证：Depends / HTTPBearer / 异常处理器

> 所属：阶段 1 · 账号与认证
> 本篇覆盖：`apps/api-py/app/api/deps.py`、`apps/api-py/app/api/auth.py`、`apps/api-py/app/errors.py`、`apps/api-py/app/main.py`
> **本篇首次教学：`Depends` 依赖注入 · `get_db` 会话依赖（`yield`）· `HTTPBearer` 安全依赖 · 依赖的依赖（`get_current_user`）· `@app.exception_handler` 异常处理器 · 把默认 `{detail}` 归一化为 `{statusCode,message,error}`**
> （Pydantic / `APIRouter` / uvicorn / `CORSMiddleware` / pydantic-settings 已在 `00-项目初始化/06-FastAPI起步.md` 教过；SQLAlchemy 模型与 Session 已在 `01-账号与认证/04-SQLAlchemy2.0.md` 教过；**JWT 与密码哈希**的首次教学见 `01-账号与认证/06-JWT与密码哈希.md`——本篇只引用 `app/security.py`，不重讲）

---

## 1. 本篇目标

- 在 Python 后端实现契约里的三个接口：**`POST /auth/register`**（注册）、**`POST /auth/login`**（登录）、**`GET /auth/me`**（当前用户）。
- 让**错误响应体**与 NestJS 侧**逐字段一致**：`{ "statusCode": …, "message": "…", "error": "…" }`（`message` 必须是**字符串**）。
- **理解 FastAPI 的依赖注入**：它和 NestJS 的构造函数注入是「同一件事的两种表达」，以及如何用一个「异常处理器」把框架默认错误体改造成契约要求的样子。

**验收标准**（状态码 + 错误体形状）：

| 场景 | 状态码 | 响应体要点 |
| --- | --- | --- |
| 注册新用户 | **201** | `{id, email, role, createdAt}`（**绝不含密码哈希**） |
| 用已注册邮箱再注册 | **409** | `{"statusCode":409,"message":"Email already registered","error":"Conflict"}` |
| 登录成功 | **200** | `{accessToken, tokenType:"Bearer", expiresIn, user}` |
| 登录密码错误 | **401** | `{"statusCode":401,"message":"Invalid email or password","error":"Unauthorized"}` |
| 带 token 取当前用户 | **200** | `{id, email, role, createdAt}` |
| 不带 token | **401** | `{"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}` |
| 参数校验失败（邮箱格式/密码长度/多字段） | **400** | `{"statusCode":400,"message":"<字符串>","error":"Bad Request"}` |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| `uv` / Python 3.12 / `.venv`；`config.py`；`db.py`；`main.py` 骨架 | 阶段 0 · 06 |
| `packages/contract/openapi.yaml` 中的 `/auth/*`、`ErrorResponse` | 阶段 1 · 01（契约扩展） |
| `users` 表（Prisma 迁移） | 阶段 1 · 02（`01-账号与认证/02-Prisma.md`） |
| SQLAlchemy 映射与 `SessionLocal` | 阶段 1 · **04** |
| `app/security.py`（`hash_password` / `verify_password` / `create_access_token` / `decode_access_token`） | 阶段 1 · **06**（JWT 与密码哈希） |

> **本篇为什么能直接 import `security.py`**：`security.py` 的 BCrypt / HS256 / JWT 细节属于 `01-账号与认证/06-JWT与密码哈希.md` 的首次教学范围，本篇把它当成「已就绪的密码/令牌工具」直接使用，只引用不展开。
>
> **数据库必须在线**：register/login/me 都要读写 `users` 表，与阶段 1 · 04 一样。

---

## 3. 先看清要做什么

阶段 0 · 06 里 `main.py` 已经预留了两行（当时注释说"属于阶段 1"，见该篇 §5.7）：

```python
from app.api.auth import router as auth_router
from app.errors import register_error_handlers
...
register_error_handlers(app)
app.include_router(auth_router)
```

本篇就是把这两处**真正实现**：

```
apps/api-py/app/
├── api/
│   ├── auth.py        # /auth/register · /auth/login · /auth/me（≈ NestJS AuthController）
│   └── deps.py        # 依赖：get_db（会话）· get_current_user（当前用户）≈ JwtAuthGuard + @CurrentUser
├── errors.py          # 异常处理器：归一化错误体（≈ NestJS HttpErrorFilter）
├── security.py        # 密码哈希 / JWT（见阶段 1 · 06，本篇只调用）
└── main.py            # 挂载：register_error_handlers(app) + include_router(auth_router)

TS 侧对照
├── auth.controller.ts      ↔  api/auth.py
├── jwt-auth.guard.ts + current-user.decorator.ts  ↔  api/deps.py
└── common/http-error.filter.ts                    ↔  errors.py
```

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `uv sync --project apps/api-py` | **仓库根** | 确认依赖齐备（`pyjwt` / `bcrypt` / `email-validator` 等已在 `pyproject.toml`） | 无报错 |
| `uv run uvicorn app.main:app --reload --port 8000` | **`apps/api-py` 目录** | 启动带认证的服务，监听 **8000** | `Uvicorn running on http://127.0.0.1:8000` |
| `pnpm dev:api-py` | **仓库根** | 等价启动方式（根脚本为 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`，**已实测可用**，见阶段 0 · 06 §9） | 同上 |
| `curl … /auth/register` | 任意（服务在线） | 注册 | `201` + 用户 JSON |
| `curl … /auth/login` | 任意 | 登录拿 token | `200` + `accessToken` |
| `curl … /auth/me`（带 `Authorization: Bearer`） | 任意 | 取当前用户 | `200` + 用户 JSON |

> **不在 `apps/api-py` 目录**时会 `ModuleNotFoundError: No module named 'app'`——原因与解法见阶段 0 · 06 §9（`uvicorn app.main:app` 按当前工作目录解析 `app` 包）。用根脚本 `pnpm dev:api-py` 时，`--directory` 已帮你切好。

---

## 5. 完整代码

### 5.1 `apps/api-py/app/api/deps.py`

**完整文件路径：`apps/api-py/app/api/deps.py`**

```python
"""FastAPI 依赖：数据库会话与当前用户。

对应 NestJS 的 `JwtAuthGuard` + `@CurrentUser()`，但表达方式是「函数依赖 + Depends」。
"""

from collections.abc import Iterator                         # Iterator[T]：一个「可逐个产出 T 的生成器」的类型
from typing import NoReturn                                 # NoReturn：标注「此函数永不正常返回（总是抛异常）」

from fastapi import Depends, HTTPException, status          # Depends=依赖声明；HTTPException=可被框架接住的 HTTP 错误
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session                          # Session=数据库会话（阶段 1·04）

from app.db import SessionLocal                             # 会话工厂（阶段 1·04）
from app.models.user import User                            # users 表的 ORM 模型
from app.security import decode_access_token                # 验签并解码 JWT（阶段 1·06，本篇只调用）

# 预置的「安全依赖」对象：负责解析请求头 `Authorization: Bearer <token>`。
# auto_error=False 的含义：请求头缺失/格式不对时「返回 None」，而不是直接抛 403（本项目要自定义 401 文案）。
bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Iterator[Session]:
    # 生成器依赖：with 进入时新建会话 → yield 把会话交给路由 → 路由返回后回到这里 → with 退出即自动 close
    with SessionLocal() as session:
        yield session


def _unauthorized(message: str) -> NoReturn:
    # 统一构造 401，并带上 `WWW-Authenticate: Bearer` 头（HTTP 规范建议 401 响应携带）
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,            # 401 Unauthorized
        detail=message,                                      # 文案；会被 errors.py 的处理器取作 message
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    # 参数 1：解析请求头得到的「凭证对象」（没带 Bearer 头时是 None）——它本身也是一个依赖
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    # 参数 2：数据库会话——由另一个依赖 get_db 提供
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:                                  # 压根没带 `Authorization: Bearer …`
        _unauthorized("Missing bearer token")
    try:
        payload = decode_access_token(credentials.credentials)  # credentials.credentials=去掉 "Bearer " 前缀后的裸令牌
    except Exception:                                        # 签名不对 / 已过期 / 格式非法——一律
        _unauthorized("Invalid or expired token")
    user = db.get(User, payload.get("sub"))                  # 用令牌负载里的 sub（用户 id）查库
    if user is None:                                         # 令牌有效，但该用户已被删除
        _unauthorized("User no longer exists")
    return user                                              # 返回值会作为路由参数 current_user 注入
```

**这段在干什么（按执行顺序）**：

1. 模块被导入时就在**模块顶层**创建了 `bearer_scheme`（一个 `HTTPBearer` 对象）——它只是「一个能解析请求头的可调用对象」，此刻**还没被调用**。
2. 请求到来、路由声明了 `Depends(get_current_user)` 时，FastAPI 才去**执行 `get_current_user`**。
3. 执行 `get_current_user` **前**，FastAPI 先按它的**函数签名**解析它自己的两个依赖：先跑 `bearer_scheme` 拿到 `credentials`，再跑 `get_db` 拿到 `db`（这层「依赖的依赖」见 §6.4）。
4. 进入函数体，按「没带令牌 → 验签失败 → 用户不存在」的顺序做三层校验，任一不过就 `_unauthorized(...)` 抛 401。
5. 全部通过则 `return user`；FastAPI 把这个返回值作为路由函数的 `current_user` 实参传进去。

> 注意：`get_db` 自己也是个依赖，但它**不在** `get_current_user` 里被「手工调用」——是 FastAPI 读签名发现的。这就是 `Depends` 的核心（§6.1、§6.4）。

### 5.2 `apps/api-py/app/api/auth.py`

**完整文件路径：`apps/api-py/app/api/auth.py`**

```python
"""`/auth/*` 路由 —— 契约见 packages/contract/openapi.yaml。"""

import uuid                                       # 生成 id（uuid4）
from datetime import datetime                     # createdAt 字段的类型

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer
from sqlalchemy import select                     # 构造查询（≈ Prisma 的查询对象）
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db  # 认证依赖 + 会话依赖（§5.1）
from app.models.user import User                   # users 表的 ORM 模型
from app.security import create_access_token, hash_password, verify_password  # 密码/令牌工具（阶段 1·06）
from app.timefmt import iso_z                      # datetime → "…Z" 字符串

router = APIRouter(prefix="/auth", tags=["auth"])  # 路由分组，公共前缀 /auth


# ── 请求体模型 ────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")      # 禁止契约未声明的多余字段（→ 400）

    email: EmailStr                                # 必须是合法邮箱（格式化校验，运行期真跑）
    password: str = Field(min_length=8)            # 字符串且长度 ≥ 8


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str                                   # 登录只要求非空字符串


class UserResponse(BaseModel):
    """对应契约 `UserResponse`（绝不包含密码哈希）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    email: str
    role: str
    createdAt: datetime                            # 存的是 datetime，序列化时才变成字符串

    @field_serializer("createdAt")                 # ← 自定义「该字段如何转成 JSON」
    def _serialize_created_at(self, value: datetime) -> str:
        return iso_z(value)                        # UTC 毫秒 + "Z"，与 TS 的 toISOString() 一致


class TokenResponse(BaseModel):
    """对应契约 `TokenResponse`。"""

    model_config = ConfigDict(extra="forbid")

    accessToken: str
    tokenType: str
    expiresIn: int
    user: UserResponse                             # 嵌套了一个 UserResponse 模型


def _to_user_response(user: User) -> UserResponse:
    # 库里是 naive timestamp；iso_z 会按 UTC 解释并输出毫秒 + Z 形式
    return UserResponse(id=user.id, email=user.email, role=user.role, createdAt=user.created_at)


# ── 路由 ──────────────────────────────────────────────────────────────────
@router.post(
    "/register",
    response_model=UserResponse,                   # 出参形状（也用于文档/校验）
    status_code=status.HTTP_201_CREATED,           # 契约要求创建成功返回 201（而非默认 200）
    operation_id="register",                       # 对齐契约的 operationId
)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> UserResponse:
    if db.scalar(select(User).where(User.email == body.email)) is not None:  # 查重
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(                                   # 组装 ORM 对象（注意：存的是密码哈希，不是明文）
        id=str(uuid.uuid4()),
        email=body.email,
        password_hash=hash_password(body.password),
        role="member",
    )
    db.add(user)                                   # 加入会话（待提交）
    db.commit()                                    # 提交（真正 INSERT）
    db.refresh(user)                               # 从库回读，拿到数据库默认值（updated_at 等）
    return _to_user_response(user)                 # 只暴露契约字段


@router.post("/login", response_model=TokenResponse, operation_id="login")
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == body.email))   # 按邮箱取用户
    # 统一报同一个错误，避免泄露「邮箱是否存在」
    if user is None or not verify_password(body.password, user.password_hash):  # 不存在 或 密码错
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token, expires_in = create_access_token(user_id=user.id, role=user.role)   # 返回 (令牌, 秒)
    return TokenResponse(
        accessToken=token,
        tokenType="Bearer",
        expiresIn=expires_in,
        user=_to_user_response(user),
    )


@router.get("/me", response_model=UserResponse, operation_id="getCurrentUser")
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    # 参数 current_user 由依赖 get_current_user 注入（它会先校验令牌、再查库）
    return _to_user_response(current_user)
```

**这段在干什么（按执行顺序）**：

1. 模块导入时：定义 4 个 Pydantic 模型（`RegisterRequest` / `LoginRequest` / `UserResponse` / `TokenResponse`），并创建 `router`。**此时没有真的校验**——Pydantic 只是「把注解编译成校验器」，等有人构造实例时才跑。
2. 请求 `POST /auth/register` 进来：FastAPI **先按签名解析参数**——`body: RegisterRequest` 是「请求体」，于是把 JSON 解析成 `RegisterRequest` 实例（这一步触发 Pydantic 校验：邮箱格式、密码长度、多余字段）。`db: Session = Depends(get_db)` 是依赖，于是执行 `get_db`。
3. 进入 `register` 函数体：查重 → 组装 `User`（哈希密码）→ `add/commit/refresh`。
4. `return _to_user_response(user)`：先手工把 ORM 对象映射成 `UserResponse`（见 §6.7 的取舍），再由 `response_model=UserResponse` 校验并序列化；序列化时 `@field_serializer` 被调用，`createdAt` 变成 `"…Z"` 字符串。
5. `POST /auth/login`：同样先解析 `body` + `db`；查库 → 比对哈希 → 签发 JWT → 组装 `TokenResponse` 返回。
6. `GET /auth/me`：只有 `current_user` 一个依赖参数。FastAPI 先执行 `get_current_user`（内部又先执行 `bearer_scheme` 与 `get_db`），成功才进函数体，直接返回当前用户。

> `status_code=status.HTTP_201_CREATED` 覆盖了 FastAPI 的默认 200；`response_model=` 做「出参校验 + 序列化 + 文档」——这两点分别在 §6.5、§6.7 展开。

### 5.3 `apps/api-py/app/errors.py`

**完整文件路径：`apps/api-py/app/errors.py`**

```python
"""把 FastAPI 默认的错误体归一化成契约要求的 `ErrorResponse`。

NestJS 默认返回 `{statusCode, message, error}`；FastAPI 默认返回 `{detail}`。
契约要求两套后端产出**同一形状**的错误体，所以这里做归一化。
"""

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError           # Pydantic 校验失败时抛的异常类型
from fastapi.responses import JSONResponse                      # 处理器要返回的响应对象
from starlette.exceptions import HTTPException as StarletteHTTPException  # 「HTTP 异常」的基类

_REASON_PHRASES: dict[int, str] = {                             # 状态码 → 原因短语
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    500: "Internal Server Error",
}


def _envelope(status_code: int, message: str) -> JSONResponse:
    # 把「状态码 + 文案」包成契约三段式 {statusCode, message, error}
    return JSONResponse(
        status_code=status_code,
        content={
            "statusCode": status_code,
            "message": message,                                 # 永远是字符串
            "error": _REASON_PHRASES.get(status_code, "Error"), # 查表；查不到给 "Error"
        },
    )


def register_error_handlers(app: FastAPI) -> None:
    """注册异常处理器（须在创建 app 之后、提供服务之前调用）。"""

    @app.exception_handler(StarletteHTTPException)              # 注册「遇到 HTTP 异常时」的处理函数
    async def _http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)  # detail 保证是 str
        return _envelope(exc.status_code, message)              # 用异常自带的状态码

    @app.exception_handler(RequestValidationError)              # 注册「Pydantic 校验失败时」的处理函数
    async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()                                   # 每条错误一个 dict 的「数组」
        first = errors[0] if errors else {"msg": "Validation error"}
        return _envelope(status.HTTP_400_BAD_REQUEST, str(first.get("msg", "Validation error")))
        # ↑ 关键：把默认的 422 改成 400，并只取「第一条」错误的 msg 拼成字符串
```

**这段在干什么（按执行顺序）**：

1. 模块导入时就建好 `_REASON_PHRASES` 这张「状态码 → 原因短语」的表。
2. 在 `main.py` 调用 `register_error_handlers(app)` 时，两个 `@app.exception_handler(...)` 装饰器**执行**，把下面两个函数**登记到 `app` 上**（登记动作发生在启动期，不是请求期）。
3. 某个请求触发了异常：FastAPI 在建响应**之前**拦截它，找到**类型匹配**的处理器并调用（见 §6.5 的触发时机）。
4. `_envelope(...)` 把结果包成 `{statusCode, message, error}` 并用 `JSONResponse` 返回——于是前端拿到契约形状。

> **两条不同路径**：路由里 `raise HTTPException(...)`（如 409/401）走第一个处理器；Pydantic 在解析请求体时抛出的 `RequestValidationError`（校验失败）走第二个处理器——它们是**两个独立注册的处理函数**，互不覆盖（详见 §6.5）。
>
> 注：本篇（阶段 1）此处的 `_validation_exception_handler` 只取**第一条**错误的 `msg`；到阶段 3 图模块时它会升级为 `_build_message(exc.errors())`（按字段顺序 + 规则顺序拼多条），详见 `03-画布/05-FastAPI图模块.md` §5.5。

### 5.4 `apps/api-py/app/main.py`

**完整文件路径：`apps/api-py/app/main.py`**

```python
"""FastAPI 入口（api-py）。

契约来源：packages/contract/openapi.yaml
本服务的所有接口都必须与该契约一致，并通过契约测试与 api-ts 对齐。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router        # 认证路由（本篇新增）
from app.api.health import router as health_router
from app.config import settings
from app.errors import register_error_handlers

app = FastAPI(title="mini-dify api-py", version=settings.version)   # 创建 ASGI 应用对象（自身不监听端口）

# 前端（localhost:3000）与后端（localhost:8000）跨域，阶段 0 直接放开。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 把 FastAPI 默认的 {detail} 归一化成契约要求的 {statusCode, message, error}
register_error_handlers(app)                          # ← 必须在 app 创建之后调用（把处理器登记到 app）

app.include_router(health_router)                     # 挂载健康检查路由
app.include_router(auth_router)                       # 挂载认证路由（不 include 就不生效）
```

**三处关键行**

- `from app.api.auth import router as auth_router`：把认证路由引入（`as` 给模块级的 `router` 起个别名，避免与其它 router 重名）。
- `register_error_handlers(app)`：**必须在 `app = FastAPI(...)` 之后**调用——异常处理器要挂到已存在的 app 上（若漏掉或写在此前，错误体仍是 `{"detail": …}`，见 §8）。
- `app.include_router(auth_router)`：把 `APIRouter` 挂进应用（`APIRouter`/`include_router` 机制见阶段 0 · 06 §10.4）。

**这段在干什么（按执行顺序）**：模块被导入 → `app = FastAPI(...)` 创建应用 → 加 CORS 中间件 → `register_error_handlers(app)` **登记**两个异常处理器 → `include_router` 把 health/auth 两组路由**登记**进应用。以上都发生在**启动期**；端口由 uvicorn 启动命令决定（`app` 对象自己不监听）。

### 5.5 `apps/api-py/app/security.py`（见阶段 1 · 06）

**完整文件路径：`apps/api-py/app/security.py`** —— 密码哈希（BCrypt，成本因子 10）与 JWT（HS256，共享 `JWT_SECRET`）的完整代码与首次教学见 `01-账号与认证/06-JWT与密码哈希.md`。本篇只调用其中四个函数：

| 函数 | 签名 | 本篇用途 |
| --- | --- | --- |
| `hash_password(password)` | `(str) -> str` | 注册时把明文密码变成哈希存库 |
| `verify_password(password, password_hash)` | `(str, str) -> bool` | 登录时校验密码 |
| `create_access_token(*, user_id, role)` | `-> (str, int)` | 登录成功签发 JWT 并返回有效期（秒） |
| `decode_access_token(token)` | `(str) -> dict` | `get_current_user` 里解析并验签 |

---

## 6. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 1 · 05」并直接使用。

### 6.0 本篇首次出现的 Python / FastAPI 机制（是什么 → NestJS 里对应什么 → 这里为什么这么写）

下表把本篇第一次出现的机制一次列全，并给一句话的「三问」；随后 6.1~6.7 逐个**正面讲透**。**不要跳读 6.1、6.2**——它们是读者最容易卡住的两处。

| # | 机制（本节） | 是什么（一句话） | NestJS 里对应什么 | 这里为什么这么写 |
| --- | --- | --- | --- | --- |
| 6.1 | `Depends` 的**注入过程** | 处理**每个请求时**，FastAPI 读你的**函数签名**（参数名/类型注解/默认值）来解析依赖树 | 容器在**启动时**按类的构造参数构建**静态依赖图** | FastAPI 无「启动期容器装配」，一切按请求现解析——更灵活但每请求都有解析成本 |
| 6.2 | `get_db` 的 **`yield` 生成器依赖**（与 `with` 叠加） | 有 `yield` 的依赖 = 「请求开始执行到 `yield`、请求结束回到 `yield` 之后」 | NestJS 无此概念；相近的是 Provider 的 `onModuleDestroy` 生命周期钩子 | 用它把「开/关会话」交给框架，避免忘记 close |
| 6.3 | `HTTPBearer` 安全依赖 | 预置依赖：解析 `Authorization: Bearer <token>` | `JwtAuthGuard` 里手写 `header.slice(7)` | 少写解析代码；`auto_error=False` 以便自定义 401 文案 |
| 6.4 | **依赖的依赖** 与**依赖缓存** | `get_current_user` 自己也有 `Depends` 参数；同一请求内同一依赖**默认只算一次** | Guard 注入 `JwtService`（构造期） | 认证拆成可复用的一块；缓存让 `get_db` 在同请求里被多处引用也只开一个会话 |
| 6.5 | `@app.exception_handler` | 在**生成响应之前**拦截异常、改写响应 | `@Catch` + `ExceptionFilter` 全局过滤器 | 把默认 `{detail}` 归一成契约的 `{statusCode,message,error}` |
| 6.6 | **Pydantic v2 运行期校验** | 模型**构造时**真正校验；`model_config`/`Field`/`field_serializer` 各管一段 | DTO + `class-validator` + `ValidationPipe` | 补上「TS 类型被擦除」的缺口；错误文案需归一才能与 class-validator 对齐 |
| 6.7 | `response_model` vs **显式映射** | 出参既可用 `response_model` 自动校验/序列化，也可手写映射函数 | `toAppResponse()` 手写视图映射 | 字段改名 + 时间戳归一 → 手写映射比 `from_attributes` 更清楚 |

> 读法：**先看 6.1（注入过程）与 6.2（yield 依赖）**，理解「每个请求现解析」这条主线；其余机制都是它的延伸。

### 6.1 `Depends` —— 依赖注入（Dependency Injection）

**是什么**：FastAPI 的核心机制之一。你在处理函数的参数上写 `x: T = Depends(f)`，FastAPI 就会在**调用处理函数之前**先调用 `f`，把返回值作为 `x` 传进去。你**不用自己 new 对象**，框架按声明自动组装。

**基本语法**

```python
from fastapi import Depends

def get_config() -> dict:
    return {"level": "debug"}

@app.get("/x")
def handler(cfg: dict = Depends(get_config)):   # cfg 由 get_config() 的返回值提供
    return cfg
```

- `Depends(f)` 里的 `f` 是**可调用对象**（函数、类，甚至另一个依赖）。
- 处理函数里凡是**没有**被路径/查询/请求体占用的参数，FastAPI 都会尝试把它当依赖解析——所以依赖参数要用 `= Depends(...)` 显式声明。
- 依赖可以**嵌套**：`f` 自己也可以有 `Depends` 参数（见 §6.4）。

**在本例中的角色**

```python
def register(body: RegisterRequest, db: Session = Depends(get_db)): ...
def login(body: LoginRequest, db: Session = Depends(get_db)): ...
def me(current_user: User = Depends(get_current_user)): ...
```

- `db` 由 `get_db()` 提供（一个数据库会话）；
- `current_user` 由 `get_current_user()` 提供（已认证的用户对象）。

#### ⭐ 注入过程详解：**每次请求都解析** vs NestJS 的**启动期建图**

这是理解 FastAPI 依赖注入最关键的一步，请逐句读。

**FastAPI 的方式：处理每个请求时，读函数签名来解析**

FastAPI **不预先构建依赖图**（它没有一个「启动时把所有 Provider 实例化好」的容器）。它做的是：

1. 你写出 `def me(current_user: User = Depends(get_current_user))`——这个**函数签名本身就是一份说明书**：参数名 `current_user`、类型注解 `User`、默认值 `Depends(get_current_user)`。
2. FastAPI 在**注册路由时**就扫描一次签名，把「这个参数是一个依赖，提供者是 `get_current_user`」记进路由表。
3. **每次请求命中这条路由时**，它再**逐参数判断**：
   - 这个参数是**路径参数**（如 `{id}`）？→ 从 URL 取；
   - 是**查询参数**？→ 从 query string 取；
   - 是**请求体**？→ 解析 JSON 并按 Pydantic 校验；
   - 是 `Depends(...)`？→ **现在**执行那个依赖函数，拿到返回值当实参；这个依赖自己若有 `Depends` 参数，就**递归**先解析它们（深度优先）。
4. 全部参数都解析完，才调用处理函数本身。

于是「`depends` 的求值」是一个**每次请求都发生**的过程（附带的**依赖缓存**让同请求内重复依赖不重复求值，见 §6.4）。

```text
请求进入
  └─ 命中路由 GET /auth/me
       └─ 解析参数 current_user  ← 读签名得知是 Depends(get_current_user)
            └─ 执行 get_current_user：
                 ├─ 先解析它的参数 credentials ← Depends(bearer_scheme) → 执行 HTTPBearer 解析请求头
                 ├─ 再解析它的参数 db         ← Depends(get_db) → 打开会话（执行到 yield 暂停）
                 └─ 进入函数体：校验令牌、查库、返回 user
       └─ 把 user 作为实参传给 me()
```

**NestJS 的方式：启动时按类的构造参数构建依赖图**

- Nest 在**应用启动**阶段读取每个 `@Injectable()` 类的构造参数类型元数据（`emitDecoratorMetadata` 写进去的），据此构建一张**静态依赖图**，并**实例化**好 Provider（多数是**单例**）。
- 之后每个请求到达时，容器已经**准备好了实例**，只是把已有实例按图**注入**给控制器，**不重新解析签名**。
- 换句话说：**Nest 的成本付在启动期一次；FastAPI 的解析付在每个请求上。**

| 维度 | NestJS | FastAPI |
| --- | --- | --- |
| 依赖图何时建立 | **启动期**，一次性、静态 | **不预建**；每请求按签名**现解析** |
| 靠什么读依赖 | 类构造参数的**类型元数据** | 函数签名的**参数名 + 类型注解 + 默认值** |
| 实例化时机 | 容器启动时（多为单例） | 依赖被求值时（可「每请求」作用域） |
| 单例程度 | 默认**单例** Provider | 默认**每次请求**重新求值（同请求内有缓存） |
| 类比 | 「类的构造参数」是接线图 | 「函数参数」是即插即用的前置步骤 |

> **根本差异一句话**：NestJS 是「**启动时把依赖算好、放进容器、请求时取用**」；FastAPI 是「**请求到了才按签名现算依赖**」。所以 FastAPI 里你不必为「注册 Provider」操心——你在参数上声明即可；代价是每次请求都要走一遍解析（缓存把重复的那部分省掉）。

> NestJS 的 DI 首次教学见 `00-项目初始化/05-NestJS起步.md`。

> **写错会怎样（1）**：处理函数里想注入 `db` 却写成了 `db: Session`（**没写 `= Depends(get_db)`**）。因为「没被路径/查询/请求体占用的普通参数」会被当成**请求参数**解析，FastAPI 会去 query/body 里找名为 `db` 的字段，找不到就报 **422/400 缺少字段**。解法：必须写 `db: Session = Depends(get_db)`。

#### ⭐ 依赖的依赖 与 依赖缓存

- **依赖的依赖（嵌套依赖）**：`get_current_user` 自己有两个 `Depends` 参数（`bearer_scheme`、`get_db`），`me` 又 `Depends(get_current_user)`。FastAPI 会**深度优先地递归解析**：先解析叶子依赖，再逐层向上，最后把结果喂给上一层。这就是「组合式」的精髓——认证被拆成可复用的一块，需要它的路由写一个 `Depends` 即可。
- **依赖缓存（同一请求内）**：**默认**情况下，同一个依赖函数在**同一次请求**里只会被**求值一次**，结果被缓存复用（除非该依赖显式声明为每次都要新算）。例如 `list_apps` 同时声明了 `Depends(get_current_user)` 与 `Depends(get_db)`，而 `get_current_user` 内部**也**依赖 `get_db`——由于缓存，这两个地方用的是**同一个 `db` 会话**，不是两个。这既省开销，也保证「同一请求同一会话」的一致视图。

| 概念 | 行为 | 与 NestJS 对照 |
| --- | --- | --- |
| 嵌套依赖 | 依赖的依赖被**递归**解析（深度优先） | Guard 在构造期注入 `JwtService`（静态） |
| 依赖缓存 | 同请求内同一依赖**默认只算一次** | 单例 Provider 天然全局共用一份 |

> 缓存是「**请求作用域内**」的：跨请求并不共享（下一个请求会重新求值）。所以 `get_db` 每个请求都会开一个新会话——正是我们想要的「一请求一会话」。

### 6.2 `get_db` —— 会话依赖（`yield`）与 SQLAlchemy Session 生命周期

**是什么**：把「打开一个数据库会话、用完关闭」封装成 FastAPI 依赖。因为 FastAPI 支持**生成器依赖**：函数里有 `yield`，`yield` 之前的代码在**请求开始**执行、`yield` 之后的代码在**请求结束**执行（清理）。

```python
def get_db() -> Iterator[Session]:
    with SessionLocal() as session:   # 请求开始：造会话
        yield session                 # 交给处理函数使用
                                      # 请求结束：with 退出 → 自动 session.close()
```

**要点**

- `SessionLocal` 是阶段 1 · 04 讲的**会话工厂**；`SessionLocal()` 产出一个新会话。
- `with SessionLocal() as session:` 保证**退出时一定 close**，即使处理函数抛异常也会释放连接回池。
- **每个请求一个 Session**，请求结束即销毁——这正是 04 篇说的「Session 是请求级、用完就关」的落地方式。

**为什么不让处理函数自己 `SessionLocal()`**：那样容易忘记关闭、或用错作用域。做成依赖后，**开关会话交给框架**，处理函数只管用。

#### ⭐ 分步讲：`yield` + `with` 叠加后，一个请求里到底发生了什么

这是全篇**最绕**的一处，请按编号一步步走。关键前提：**`get_db` 不是普通函数，而是一个「生成器（generator）」**——调用它**不会**立刻把整个函数执行完，而是返回一个「可以暂停/恢复的执行体」；`yield` 就是「暂停点」。FastAPI 知道怎么驱动它。

先在脑子里把 `get_db` 想成**两个半场**：

```text
def get_db():
    ┌─ 上半场（yield 之前）───────────────┐
    │ with SessionLocal() as session:   │  ← 进入 with：造会话
    │     yield session                 │  ← 「暂停」，把 session 交出去
    ├─ 下半场（yield 之后）───────────────┤
    │ (with 块结束)                      │  ← 离开 with：自动 session.close()
    └──────────────────────────────────┘
```

**请求 A 的完整时序**（对应 `GET /auth/me` 这种依赖了 `get_db` 的路由）：

| 步 | 谁在做 | 发生了什么 |
| --- | --- | --- |
| ① | FastAPI | 请求进来，开始解析 `current_user` 依赖 → 递归解析到 `get_db` |
| ② | FastAPI | **启动** `get_db` 生成器，执行**上半场**：`with SessionLocal() as session` 进入 → 造出一个会话 |
| ③ | `get_db` | 执行到 `yield session` → **暂停**，把 `session` 作为依赖值**交回** FastAPI（此时代码停在 `yield` 这一行，下半场还没跑） |
| ④ | FastAPI | 拿到 `session`，继续解析 `get_current_user` 的其余部分 → 用它查库 → 得到 `user` |
| ⑤ | 路由函数 | `me()` 被调用，全程用**同一个** `session`（依赖缓存保证） |
| ⑥ | 路由函数 | 正常 `return`（或**抛异常**，两条路都一样）——返回响应给客户端 |
| ⑦ | FastAPI | 响应已生成。FastAPI 回头**恢复** `get_db` 生成器，执行**下半场** |
| ⑧ | `with` | `yield` 之后的代码让控制流到达「`with` 块尾部」→ 触发 `__exit__` → **自动 `session.close()`**（连接归还连接池） |

**图示（一个请求的生命线）**：

```text
请求开始 ──► [造 session] ──yield──► [查库/处理] ──► [响应生成] ──► [close session] ──► 请求结束
             ↑ 上半场                    ↑ 路由在跑                    ↑ 下半场
```

**为什么 `yield` 必须配 `with`**：`yield` 只负责「暂停/交卷」，**不负责关闭**；真正让会话被关闭的是它外面的 `with`：

- `with X as y` 的语法是「进入时拿到 `y`，**离开这个缩进块时**（无论正常返回还是抛异常）调用 `X` 的退出方法」。
- 在 `get_db` 里，控制流「离开 with 块」的时机**恰好就是 `yield` 之后**——也就是**请求结束**时。所以把 `yield` 放进 `with` 里，就得到了「请求开始造会话、请求结束必定关闭」的效果。
- **即使路由里抛了异常**（例如 `_unauthorized` 抛 401），生成器的下半场**照样会跑**、`with` 照样 `close`——这就是「不会泄漏连接」的保障。

**与 `with` 单独用（不用 `yield`）的对照**：如果你在处理函数里直接写 `with SessionLocal() as session:`，那是「函数内自管」；而 `get_db` 是把 `with` 的**生命周期拉长到整个请求**——`with` 的进出被切成了「yield 前 / yield 后」两半，由 FastAPI 跨「路由执行」把两半接起来。

**写错会怎样（2）**：

- **`get_db` 里忘了 `with`**（只 `session = SessionLocal(); yield session`）：请求结束时**没有**任何东西关闭会话 → 连接**泄漏**（连接池被慢慢耗光），表现为并发压测时请求开始卡住/超时。
- **`get_db` 里忘了 `yield`**（写成了普通函数 `return SessionLocal()`）：FastAPI 拿到会话后**再也不会**执行清理 → 同样泄漏；且它不再是「生成器依赖」，框架的「后半场恢复」根本不会发生。
- **在 `def` 依赖里写了 `await`**（把异步 I/O 写进同步依赖）：**语法错误**。Python 的异步是**全链路的**——要 `await` 就必须 `async def`。反过来，`get_current_user` 是**同步 `def`**，因为 `decode_access_token` 与 `db.get` 都是同步调用，FastAPI 会把同步依赖放到**线程池**里跑，不阻塞事件循环。
- **把 `get_db` 声明成 `async def`**：没必要——它里面没有 `await`；普通 `def` 交给线程池即可（FastAPI 的 `def`/`async def` 选择见阶段 0 · 06 §6.7）。

### 6.3 `HTTPBearer` —— 安全依赖（解析 `Authorization` 头）

**是什么**：`fastapi.security.HTTPBearer` 是一个**预置依赖**，专门解析请求头里的 `Authorization: Bearer <token>`。

```python
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer_scheme = HTTPBearer(auto_error=False)

# 用法：credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)
```

- 解析成功时，返回一个 `HTTPAuthorizationCredentials` 对象，两个属性：
  - `.scheme`：方案名，`"Bearer"`；
  - `.credentials`：**令牌本体**（去掉 `Bearer ` 前缀之后的字符串）。
- **`auto_error=False` 是关键**：默认（`True`）时，若请求头缺失/格式不对，FastAPI 会**直接抛出 403**（`Not authenticated`）。我们要的是**我们自己的 401 与自定义文案**，所以设为 `False`——此时它返回 `None`，由 `get_current_user` 自行判断并报错。
- 除了自动解析，`HTTPBearer` 还让 `/docs` 的「Authorize」按钮知道这是个 Bearer 认证方案（对应契约 `securitySchemes.bearerAuth`）。

**它到底怎么读 `Authorization` 头**：把 `Authorization: Bearer eyJ…` 按「方案 scheme + 空格 + 凭证 credentials」切开——`scheme` 是 `"Bearer"`、`credentials` 是那串 JWT。格式不合法（没有 `Bearer ` 前缀、或只有方案没凭证）即视为「没解析到凭证」。

**失败时为什么是 403/401，以及本项目如何统一成 401**：

| `auto_error` | 请求头缺失/格式不对时 | 本项目期望 |
| --- | --- | --- |
| `True`（默认） | `HTTPBearer` **直接抛 403 `Not authenticated`**，文案不可控 | ❌ 契约要求 **401** + 自定义文案 |
| `False`（本项目） | 返回 **`None`**，交给我们自行判断 | ✅ 我们 `_unauthorized("Missing bearer token")` 抛 401 |

- HTTP 语义上，**401** = 「你没证明身份（缺/坏凭证）」；**403** = 「身份已知但无权访问」。缺 token 属于前者，应为 **401**——`HTTPBearer` 默认的 403 其实是「未认证」场景里偏保守的选择。
- 本项目要**逐字节对齐契约**（`Missing bearer token` 等文案），所以关掉 `auto_error`，由 `get_current_user` 统一抛 **401**（经 `errors.py` 归一）。这就是「**如何统一成 401**」的做法。

> 与 NestJS 对照：`JwtAuthGuard` 是**手动**从头里抠 `Authorization`（`header.slice(7)`）再验签；FastAPI 这一步由 `HTTPBearer` **代劳解析**，我们只接令牌。Nest 里 `JwtAuthGuard` 抛的就是 `UnauthorizedException`（401），与这里的处理一致——差别只在「默认值」：`HTTPBearer` 默认 403、`JwtAuthGuard` 手写时你直接用 401。
>
> **写错会怎样（3）**：用了默认的 `HTTPBearer()`（即 `auto_error=True`）——没带 token 的请求会**直接返回 403 `{"detail":"Not authenticated"}`**，与契约的 401 不符、文案也不对，契约测试失败。

### 6.4 `get_current_user` —— 依赖的依赖（组合式认证）

`get_current_user` 本身**也是一个依赖**，它自己又有两个依赖参数：

```python
def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),  # 解析头
    db: Session = Depends(get_db),                                               # 数据库会话
) -> User:
    if credentials is None:
        _unauthorized("Missing bearer token")          # 没带头 → 401
    try:
        payload = decode_access_token(credentials.credentials)   # 验签 + 解码（见阶段 1 · 06）
    except Exception:
        _unauthorized("Invalid or expired token")      # 令牌坏/过期 → 401
    user = db.get(User, payload.get("sub"))            # 按 sub（用户 id）查库
    if user is None:
        _unauthorized("User no longer exists")         # 令牌有效但用户已没了 → 401
    return user
```

**三层校验**，对应契约的三个 401 场景：

| 情形 | 报错 message |
| --- | --- |
| 没带 `Authorization: Bearer …` | `Missing bearer token` |
| 令牌签名不对 / 已过期 | `Invalid or expired token` |
| 令牌合法但 `sub` 对应用户已被删 | `User no longer exists` |

**设计要点**

- `_unauthorized(...)` 是个小助手：统一构造 401 并带上 `WWW-Authenticate: Bearer` 头（HTTP 规范建议 401 响应带此头）。返回类型标注 `NoReturn`（总是抛异常、永不正常返回），让类型检查器知道其后代码不可达。
- **依赖可嵌套**：`me` 依赖 `get_current_user`，而 `get_current_user` 又依赖 `bearer_scheme` 与 `get_db`；FastAPI 会**递归求值**整条链——这就是「依赖注入」最实用的地方：把认证拆成可复用的一块。

> 与 NestJS 对照：`JwtAuthGuard`（Guard）+ `@CurrentUser()`（参数装饰器）两步，在 FastAPI 里合成**一个依赖函数** `get_current_user`，直接在参数上 `Depends`。

**依赖缓存在这里的体现（重点）**：像 `list_apps(current_user=Depends(get_current_user), db=Depends(get_db))` 这样**同时**声明了两个依赖。表面看 `get_current_user` 内部也依赖 `get_db`，似乎会开两个会话；但因为**依赖缓存**，`get_db` 在这**同一次请求**里只被求值一次，`list_apps` 的 `db` 与 `get_current_user` 内部的 `db` 是**同一个对象**。

```text
list_apps 请求
  ├─ 解析 current_user → 执行 get_current_user
  │     ├─ 解析 db → 执行 get_db  ← 第一次求值（开会话，缓存起来）
  │     └─ 返回 user
  └─ 解析 db → 命中缓存（不再求值）← 复用上面那个会话
```

- 若**没有**缓存：同一请求会开两个会话、各自持有连接 → 浪费连接、且两处看到的数据可能不一致。
- 缓存的作用域是**单次请求**：下一个请求会重新求值（于是每个请求各自拥有一个新会话）。

| 维度 | NestJS | FastAPI |
| --- | --- | --- |
| 重复依赖 | 单例 Provider 天然一份，无需「缓存」概念 | 依赖**默认按请求缓存**，同请求内不重复求值 |
| 生命周期 | 单例全局共享 | **请求级**（缓存不跨请求） |

> 一句话：FastAPI 的依赖**既「每次请求现算」、又「同请求内只算一次」**——前者保证每请求独立（如新会话），后者避免同请求内重复开销。

> **写错会怎样（4）**：把「当前用户」写成在多个路由里各自**重新手写一遍**从请求头解析 + 查库的逻辑（而不是复用 `Depends(get_current_user)`）——一是重复代码、二是容易在某一处漏掉「用户已删除」这层校验，导致 401 语义不一致。正确做法：**只写一个 `get_current_user` 依赖，各处 `Depends` 它**。

### 6.5 `@app.exception_handler` —— 异常处理器（归一化错误体）

**问题**：两套框架的**默认错误体形状不同**：

| 框架 | 默认错误体 |
| --- | --- |
| NestJS | `{ "statusCode": 401, "message": "...", "error": "Unauthorized" }` |
| FastAPI | `{ "detail": "..." }` |

契约（`ErrorResponse`）要求**两者一致**，形状为 `{statusCode, message, error}`。所以 FastAPI 侧要用**异常处理器**把 `{detail}` 改写成契约形状——这相当于 NestJS 侧的 `HttpErrorFilter`。

**基本语法**

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

@app.exception_handler(SomeExceptionType)
async def handler(request: Request, exc: SomeExceptionType) -> JSONResponse:
    return JSONResponse(status_code=..., content={...})
```

- `@app.exception_handler(T)` 注册「当抛出类型为 `T` 的异常时，用这个函数生成响应」。
- 处理器签名固定为 `(request, exc)`，返回值必须是 `Response`（这里用 `JSONResponse`）。
- **须在 app 创建之后注册**，所以封装成 `register_error_handlers(app)`，在 `main.py` 里调用。

**本例注册了两个**

1. **`StarletteHTTPException`** —— 覆盖一切「HTTP 异常」。注意 `fastapi.HTTPException` 是 `starlette.exceptions.HTTPException` 的**子类**，所以注册在 Starlette 类型上，**同时**能接住我们自己 `raise` 的 `HTTPException`（如 409/401）。处理逻辑：取 `exc.detail`（字符串）当 message。
2. **`RequestValidationError`** —— 覆盖「请求体/参数校验失败」（Pydantic 校验不通过）。FastAPI 默认把它变成 422；契约要求 **400**，所以这里统一改成 400。

```python
@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(_request, exc):
    message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return _envelope(exc.status_code, message)

@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(_request, exc):
    errors = exc.errors()
    first = errors[0] if errors else {"msg": "Validation error"}
    return _envelope(status.HTTP_400_BAD_REQUEST, str(first.get("msg", "Validation error")))
```

**`_envelope` 干什么**：把状态码映射成三段式：

```python
REASON_PHRASES = {400: "Bad Request", 401: "Unauthorized", ..., 409: "Conflict", ...}

_envelope(status_code, message) →
{
  "statusCode": status_code,
  "message": message,                                   # 永远是字符串
  "error": REASON_PHRASES.get(status_code, "Error"),    # 状态码对应的「原因短语」
}
```

**为什么 `message` 必须是字符串**

- 契约 `ErrorResponse.message` 类型是 `string`。
- FastAPI 的校验错误 `exc.errors()` 返回的是**数组**（每条错误一个对象）；NestJS 的 `ValidationPipe` 产出的 `message` 也是**数组**。
- 所以两边都要**归一成字符串**：FastAPI 取**第一条**错误的 `msg`；NestJS 侧 `HttpErrorFilter` 用 `join('; ')`。形状对齐后，契约测试才能通过。
- 本项目**不拼接多条**，只取第一条：既满足「是字符串」，又保持错误信息简洁可读。

> **关于「自定义异常类」**：链路里还有一类做法是**自定义异常类**（`class MyError(Exception): ...`）+ `@app.exception_handler(MyError)`。本项目**没有**自定义异常类——直接复用框架内置的 `HTTPException` 与 `RequestValidationError` 就够了（它们已经覆盖 401/409/400 等场景）。若将来要表达「业务错误」并携带额外字段，再按同一机制注册一个自定义类型即可。

> 与 NestJS 对照：`HttpErrorFilter` 是 `@Catch(HttpException)` 的全局过滤器；FastAPI 这边是「给 `app` 注册若干 `exception_handler`」。二者都是**在异常冒泡到最外层之前把它改写成契约形状**。

#### ⭐ 触发时机：**在响应生成之前**拦截异常

分清两个时刻，就不会搞混「处理器什么时候被调用」：

1. **注册**发生在**启动期**：`register_error_handlers(app)` 在 `main.py` 里执行，把处理器登记到 `app` 上。此时**没有任何请求**。
2. **触发**发生在**请求期的末尾、响应生成之前**：路由（或依赖、或 Pydantic 解析）抛出异常后，FastAPI **不会**直接把它变成响应，而是先**沿异常类型找到匹配的处理器**，用处理器的返回值**当作**这次请求的响应。

```text
请求 → 解析参数/执行依赖 → 路由函数
                                 │
                    ┌────────────┴────────────┐
                    │ 一切正常                │ 抛出异常
                    ▼                         ▼
            正常生成响应            ┌─ 在「生成响应之前」拦截 ─┐
                                    │ 找类型匹配的 exception_handler
                                    │ 用它的返回值当响应
                                    └──────────────────────┘
```

- 关键字「**在异常冒泡到最外层之前**」：处理器是「未处理异常的兜底改写器」，不是「事后日志」。它决定了最终写给客户端的那份 JSON。
- 因此 `register_error_handlers(app)` **必须**在 `app` 创建之后、对外服务之前调用；且**注册顺序不影响**——因为它是**按异常类型精确匹配**（见下），不是「先注册的优先」。

#### ⭐ 为什么默认错误体是 `{"detail": …}`，而我们必须改造它

FastAPI 基于 Starlette，其内置的 `HTTPException` 默认把错误体渲染成：

```json
{ "detail": "…" }
```

（FastAPI 自动生成的校验失败还会是 `{"detail": [ … ]}` + 状态码 **422**。）

而**契约**（`ErrorResponse`）要求的是三段式 `{statusCode, message, error}`、`message` 为**字符串**、校验失败用 **400**。裸用 FastAPI 默认形状：

- 字段名对不上（`detail` vs `statusCode/message/error`）；
- `detail` 可能是**数组**，不是字符串；
- 校验失败默认 **422**，而契约要 **400**。

这三处不一致会让**契约测试**（拿同一份非法请求打两端、逐字节比对）直接失败。所以我们必须用异常处理器把默认 `{detail}` **改写成契约形状**——这正是 `errors.py` 存在的唯一理由，也是它与 NestJS `HttpErrorFilter` 的对应关系。

#### ⭐ `RequestValidationError` 与 `HTTPException` 是**两条不同的处理路径**

很多人以为「注册一个处理器就万事大吉」，其实这里有**两个来源、两个类型、两个处理器**：

| | 路径 A：`HTTPException` | 路径 B：`RequestValidationError` |
| --- | --- | --- |
| 谁抛出 | **你自己**在路由/依赖里 `raise HTTPException(...)`（如 409/401/404） | **框架**在解析请求体/参数、Pydantic 校验失败时抛出 |
| 异常类型 | `starlette.exceptions.HTTPException`（`fastapi.HTTPException` 是它的**子类**） | `fastapi.exceptions.RequestValidationError` |
| 本项目处理器 | `_http_exception_handler` | `_validation_exception_handler` |
| 默认状态码 | 你在 `HTTPException` 里显式给的（如 409） | FastAPI 默认 **422**（本项目改成 **400**） |
| `message` 来源 | `exc.detail`（字符串） | `exc.errors()`（**数组**）→ 取出拼成字符串 |

- **注意类型继承**：`fastapi.HTTPException` 继承自 `starlette.exceptions.HTTPException`。我们把处理器注册在 **Starlette 类型**上，于是**同时**能接住「我们自己 `raise` 的 `fastapi.HTTPException`」——不用注册两遍。
- **两条路径互不覆盖**：路由里 `raise` 走 A；Pydantic 解析失败走 B。**A 不会**接住 B 的异常，反之亦然。若你**只**注册了 A，那么校验失败会**退回** FastAPI 默认的 422 `{"detail":[…]}`；若**只**注册了 B，则自己 `raise` 的 409/401 会退回 `{"detail": …}`。

> **写错会怎样（5）**：
> - **`register_error_handlers(app)` 漏调用、或写在 `app = FastAPI(...)` 之前**：处理器没登记成功 → 错误体仍是默认的 `{"detail": …}`（且校验失败是 422），与 NestJS 不一致、契约测试失败。
> - **少注册 `RequestValidationError` 那条**：校验失败不会被改成 400，而是 422 + 数组——同样契约测试失败。
> - **在错误的 `app` 上注册**（比如在别的模块里 `new` 了一个临时 FastAPI 对象去注册）：真正对外服务的那个 `app` 上并没有处理器。处理器必须注册到**同一个、最终被 uvicorn 承载的 `app`** 上。

### 6.6 Pydantic v2 运行期校验 —— `model_config` / `Field` / `field_serializer` 何时被调用

**是什么**：Pydantic v2 的 `BaseModel` **既是类型、也是运行期校验器**（阶段 0 · 06 §10.2 首次教学）。本篇的四个模型（`RegisterRequest` 等）都是它。它把「字段的类型注解」在**运行期**编译成校验逻辑——这正好补上 TS「类型被擦除」的缺口。

**NestJS 里对应什么**：

| 维度 | NestJS | FastAPI |
| --- | --- | --- |
| 类型与校验 | `interface`（编译期，被擦除）+ 另一套 `class-validator` 装饰器补运行期校验 | **一个 `BaseModel` 同时是类型和校验器** |
| 校验触发 | `ValidationPipe` 在参数进入控制器前跑 | Pydantic 在**构造模型实例时**跑 |
| 多余字段 | `ValidationPipe({ forbidNonWhitelisted: true })` | `model_config = ConfigDict(extra="forbid")` |
| 长度/格式约束 | `@MinLength(8)` / `@IsEmail()` | `Field(min_length=8)` / `EmailStr` |
| 出参格式 | 手写 `toUserResponse()`（`Date.toISOString()`） | `@field_serializer`（`iso_z()`） |

**Pydantic 三个配置部件分别在何时起作用**（这是读者最容易混的一处）：

| 部件 | 作用 | **何时被调用** |
| --- | --- | --- |
| `model_config = ConfigDict(extra="forbid")` | 声明「模型级行为」：多余字段直接报错 | 模型**类定义时**读取；在**构造实例时**生效（多余字段触发报错） |
| `Field(min_length=8)` | 给**某个字段**加约束/默认值 | 模型**类定义时**绑定到字段；**构造实例时**执行校验（不满足 → 抛 `ValidationError`） |
| `@field_serializer("createdAt")` | 自定义**某字段如何被序列化** | 只在**把一个模型转成 dict/JSON**（出参）时调用；**构造/校验时不动它** |

也就是说：**校验（构造时）** 与 **序列化（输出时）** 是两个不同阶段，`field_serializer` 属于后者——所以你别指望它在「入参校验」时跑。

```text
入参阶段：JSON → (Pydantic 构造实例) → 校验过多/少/类型/约束 → 交给路由
出参阶段：路由 return 模型/ORM → (response_model 校验) → 序列化 → 走 field_serializer → JSON
```

**为什么它和 `class-validator` 报错文案不同、本项目怎么归一**：

- 两者是**两个不同库**，失败时给的**错误对象结构**不同：
  - Pydantic 抛 `ValidationError`，`exc.errors()` 是**数组**，每条含 `type`（如 `string_too_short`）、`loc`（字段路径）、`ctx`（上下文，如 `min_length`）、`msg`（**默认英文文案**，如 `String should have at least 8 characters`）。
  - class-validator 抛 `ValidationError[]`，每条含 `constraints`（**默认英文文案**，如 `password must be longer than or equal to 8 characters`）。
- **默认文案天然不一致**（措辞、语序都不同），直接用会导致两套后端返回**不同字符串** → 契约测试失败。
- **本项目的归一方式**：不让「默认文案」直接出境，而是**按契约的文案模板重新拼**。
  - Python 侧：`errors.py` 按 `err["type"]` 映射成契约文案（如 `string_too_short` → `{field} must be at least {N} characters`），并用 `_build_message` 按字段顺序 + 规则顺序拼成单一字符串。
  - TS 侧：`validation-exception-factory.ts` 用 `exceptionFactory` 做同样的事。
  - 唯一真源是 `packages/contract/error-messages.md` §1。
- 换句话说：**校验机制两端必然不同（Pydantic vs class-validator），但「错在哪、给谁看什么文案」由契约统一规定、两端各自翻译**。

> 一句话：Pydantic 负责「拦不拦得住」，契约负责「拦住之后说什么话」。

> **写错会怎样（6）**：
> - **忘了 `extra="forbid"`**：契约里写了 `additionalProperties: false` 的请求体，多余字段会被**静默忽略**而不是报 400 → 契约测试失败（`{field} should not exist` 这条永远不出现）。
> - **直接透出 Pydantic 默认 `msg`**（而不是按契约重拼）：两端文案不可控、随库版本漂移。
> - **把 `@field_serializer` 指望在入参校验上**：它只在出参序列化时跑，入参校验不受它影响。

### 6.7 `response_model` 与显式映射函数的取舍

**是什么**：

- `response_model=UserResponse`：写在**路由装饰器**上，告诉 FastAPI「这条路由的返回值必须符合这个模型」——FastAPI 会**按模型校验并序列化**返回值，错误/多余字段会被暴露；同时用它生成 OpenAPI 文档。
- **显式映射函数**：本项目额外写了个 `_to_user_response(user)`，把 ORM 对象 `User` **逐个字段**转成 `UserResponse`，`return` 的是**模型实例**。

两者**并不冲突、是叠加的**：先用 `_to_user_response` 把 ORM 映射成契约模型，`response_model=UserResponse` 再做一次出参校验/序列化。问题是：**既然有 `response_model`，为什么还要手写映射？**

| 做法 | 写法 | 适合场景 |
| --- | --- | --- |
| 纯 `response_model`（直接 `return user`） | 依赖 Pydantic 的 `from_attributes=True` 从对象属性取值 | 字段名**一一对应**、无需加工 |
| **本项目：显式映射 + `response_model`** | 手写 `_to_user_response`，字段可改名、可加工 | 需要**改名**（`ownerId` ← `owner_id`）或**值归一**（时间戳 → `"…Z"`） |

**本项目为什么在某些地方手写映射、不用 `from_attributes`**：

- `from_attributes`（`model_config = ConfigDict(from_attributes=True)`）是「**字段名相同**时的省事法」：你 `return user`，Pydantic 直接去读 `user.id` / `user.email`。
- 但本项目的**契约字段名与 ORM 属性名不一致**：
  - `createdAt`（契约）↔ `created_at`（ORM）——**改名**；
  - `ownerId`（契约，见阶段 2）↔ `owner_id`（ORM）——**改名**。
- 且时间戳需要**加工**：库里存的是 naive `timestamp`，出参要经 `iso_z()` 变成 UTC 毫秒 `Z`（与 TS `toISOString()` 逐字节一致）——这是**值规范化**，`from_attributes` 不管。
- 所以本项目选**显式映射**：一个函数把「改名 + 时间戳归一」一次做掉，**一眼可读**；若硬用 `from_attributes`，反倒要为每个不一致字段配别名 + 序列化器，更绕。

**两条出参纪律**（本项目沿用阶段 0 · 06 的约定）：

1. 响应模型一律带 `ConfigDict(extra="forbid")` → 对齐契约 `additionalProperties: false`，**字段多一个都过不了**。
2. 对外**永远返回响应模型**（如 `UserResponse`），**绝不**直接把 `User` ORM 对象当返回值——否则可能把不该暴露的列（如 `password_hash`！）漏出去。

> **写错会怎样（7）**：`response_model` 声明的字段在「映射出来的模型实例里」缺失 / 类型不符（比如 `_to_user_response` 漏了 `createdAt`）——出参校验会失败，FastAPI 在**响应阶段**抛错 → 典型的 **500**（而不是 400：这是服务端自己的 bug，不是客户端输入问题）。这正是 §8 里那条「500」的成因。

---

## 7. 验收自测

> 以下命令在服务已启动（`uv run uvicorn app.main:app --reload --port 8000`）后执行。`-w "\nHTTP %{http_code}\n"` 会额外打印状态码。

### 7.1 注册（201）

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"supersecret"}'
```

**实测输出**

```json
{"id":"3e79fe04-7701-45d6-8883-00e9bfdf2724","email":"demo@example.com","role":"member","createdAt":"2026-10-18T04:14:02.238Z"}
HTTP 201
```

### 7.2 重复邮箱注册（409）

同一邮箱再注册一次：

```json
{"statusCode":409,"message":"Email already registered","error":"Conflict"}
HTTP 409
```

### 7.3 登录（200）

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://127.0.0.1:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"supersecret"}'
```

**实测输出**

```json
{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","tokenType":"Bearer","expiresIn":3600,"user":{"id":"...","email":"demo@example.com","role":"member","createdAt":"2026-10-18T04:14:02.238Z"}}
HTTP 200
```

把 `accessToken` 里的字符串记下来，下一步要用。

### 7.4 取当前用户（200）

```bash
curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:8000/auth/me \
  -H "Authorization: Bearer <上一步的 accessToken>"
```

**实测输出**

```json
{"id":"3e79fe04-7701-45d6-8883-00e9bfdf2724","email":"demo@example.com","role":"member","createdAt":"2026-10-18T04:14:02.238Z"}
HTTP 200
```

### 7.5 错误分支（实测）

| 命令 | 实测输出 |
| --- | --- |
| 登录密码错误 | `HTTP 401` · `{"statusCode":401,"message":"Invalid email or password","error":"Unauthorized"}` |
| `me` 不带 token | `HTTP 401` · `{"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}` |
| `me` 带坏 token | `HTTP 401` · `{"statusCode":401,"message":"Invalid or expired token","error":"Unauthorized"}` |
| 注册密码过短（`"short"`） | `HTTP 400` · `{"statusCode":400,"message":"String should have at least 8 characters","error":"Bad Request"}` |
| 注册邮箱格式错（`"not-an-email"`） | `HTTP 400` · `{"statusCode":400,"message":"value is not a valid email address: An email address must have an @-sign.","error":"Bad Request"}` |
| 提交多余字段 `"foo":1` | `HTTP 400` · `{"statusCode":400,"message":"Extra inputs are not permitted","error":"Bad Request"}` |

> 注意：**所有**错误体的 `message` 都是**字符串**，且都带 `error` 原因短语——这正是异常处理器的功劳，也是与 NestJS 侧对齐的关键。

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 服务启动 | `uv run uvicorn app.main:app --reload --port 8000` | 打印 `Uvicorn running on http://127.0.0.1:8000` |
| 注册 | §7.1 | `201` + 用户 JSON |
| 重复注册 | §7.2 | `409` + Conflict 信封 |
| 登录 | §7.3 | `200` + `accessToken` |
| 当前用户 | §7.4 | `200` + 用户 JSON |
| 错误分支 | §7.5 | 见上表，`message` 均为字符串 |
| 文档 | 打开 <http://localhost:8000/docs> | 可见 `/auth/register`、`/auth/login`、`/auth/me`，并出现 Authorize 按钮 |

---

## 8. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 参数少了 `= Depends(...)` | 明明想注入 `db`，却报 422/400 说缺少字段 | FastAPI 会把**没被路径/查询/请求体占用**的普通参数当**请求参数**解析。必须写 `db: Session = Depends(get_db)`，否则它去找 query/body |
| `HTTPBearer` 用了默认 `auto_error=True` | 没带 token 时直接返回 **403**（`Not authenticated`），且文案不受控 | `HTTPBearer()` 默认缺头就抛 403。本项目要**自定义 401 文案**，所以用 `HTTPBearer(auto_error=False)` 拿到 `None` 再自行判断 |
| 校验错误返回 422 而非 400 | 契约测试失败 | FastAPI 默认把 `RequestValidationError` 变 422。本项目已在 `errors.py` 注册处理器**统一改为 400**；若删掉该处理器就会退回 422 |
| 错误体仍是 `{"detail": …}` | 与 NestJS 不一致 | `register_error_handlers(app)` **没被调用**，或调用时机晚于应用启动。它必须在 `app = FastAPI(...)` 之后、对外服务之前执行 |
| `message` 是数组 | 契约测试报类型不符 | 契约要求 `message` 为字符串。FastAPI 校验错误的 `errors()` 是数组，必须取第一条并 `str(...)`（见 §6.5） |
| 返回体多出字段 | 契约测试报「多字段」 | 响应模型都带 `ConfigDict(extra="forbid")`（见阶段 0 · 06 §10.3）。改响应结构时别随手加字段 |
| `createdAt` 时区不对 | 前端/契约比对失败 | 库里是 `timestamp without time zone`（naive）。`_to_user_response` 交给 `app/timefmt.py` 的 `iso_z()`，按 UTC 解释并输出毫秒 + `Z`——现已统一为 UTC 毫秒 `Z`（阶段 2 收口） |
| 泄露密码哈希 | 契约测试/安全审查报错 | 对外一律用 `UserResponse`（只有 `id/email/role/createdAt`），**绝不**把 `User` 直接当响应模型 |
| 在仓库根启动失败 | `No module named 'app'` | 见阶段 0 · 06 §9：要么进 `apps/api-py`，要么用 `pnpm dev:api-py`（内部 `--directory` 已切目录） |
| `uv` 不被识别 | `The term 'uv' is not recognized` | `uv` 已在**用户 PATH** 中，只是**安装前就已打开**的 shell 继承了**旧 PATH**；重启终端 / IDE 即可（见阶段 0 · 01） |
| **`get_db` 忘了 `with` 或忘了 `yield`** | 连接**泄漏**（连接池耗尽、并发请求卡住/超时） | `yield` 只负责「暂停/交卷」，**关闭**靠外层 `with`。必须写成 `with SessionLocal() as session: yield session`（见 §6.2） |
| **`Depends` 依赖写成同步却写了 `await`** | `SyntaxError`；或运行时行为异常 | Python 异步是**全链路**的：要 `await` 必须 `async def`。`get_current_user` 里全是同步调用，所以用 `def`（由线程池兜住）——别为「看起来更 async」就改成 `async def`（见 §6.2） |
| **`response_model` 字段缺失/类型不符** | **500**（响应阶段抛错） | 映射函数（如 `_to_user_response`）漏传了 `response_model` 声明的字段。补齐映射；出参校验失败会以 500 暴露「服务端 bug」（见 §6.7） |
| **异常处理器注册顺序/时机错、或未注册** | 错误体仍是 `{"detail": …}`，校验失败仍是 422 | 处理器按**异常类型精确匹配**、与顺序无关；但**必须注册到最终那个 `app`**、且在 `app = FastAPI(...)` 之后、对外服务之前。漏注册 `RequestValidationError` 那条 → 校验失败退回 422（见 §6.5） |
| **只在参数上写 `current_user: User`（漏 `Depends`）** | 报 422/400「缺少字段」 | 普通参数会被当请求参数解析；鉴权依赖必须显式 `= Depends(get_current_user)`（见 §6.1） |

---

## 9. 与 api-ts 的对照

| 概念 | NestJS（api-ts） | FastAPI（api-py） |
| --- | --- | --- |
| 路由 | `@Controller('auth')` + `@Post('register')` | `APIRouter(prefix="/auth")` + `@router.post("/register")` |
| 依赖注入 | `constructor(private authService: AuthService)` | 处理函数参数 `x = Depends(provider)` |
| 请求体校验 | `class-validator` DTO + `ValidationPipe` | Pydantic `BaseModel` + `Field(min_length=8)` |
| 请求体额外字段 | `ValidationPipe({ forbidNonWhitelisted: true })` 之类 | `ConfigDict(extra="forbid")` |
| 认证 | `JwtAuthGuard`（Guard）+ `@CurrentUser()` | `Depends(get_current_user)` |
| 取 `Authorization` | 手动 `header.slice(7)` | `HTTPBearer` 自动解析 → `.credentials` |
| 当前用户来源 | `request.user`（Guard 写入） | `get_current_user()` 查库返回 `User` |
| 错误归一化 | `HttpErrorFilter`（`@Catch(HttpException)`） | `@app.exception_handler(...)`（`errors.py`） |
| 校验错误码 | `ValidationPipe` → 400 + 数组 message | `RequestValidationError` → **400** + 取首条 message |
| 密码哈希 | `bcryptjs`（成本因子 10） | `bcrypt`（成本因子 10）——见阶段 1 · 06 |
| JWT | `JwtService`（HS256 + 同一 `JWT_SECRET`） | `pyjwt`（HS256 + 同一 `JWT_SECRET`）——见阶段 1 · 06 |
| 令牌互认 | 双方共享密钥，故 **api-ts 签发的令牌 api-py 也认**，反之亦然 | 同左（跨后端验收见阶段 1 · 07） |

两套实现同一份契约（阶段 1 · 01），**状态码与错误体形状必须逐字段一致**。

### 9.1 逐条讲差异与取舍

对照表给「是什么对什么」，这里补「**为什么不同、各自取舍**」——读 TS 侧 `03-NestJS认证.md` 时对着看：

| 主题 | NestJS 怎么做 | FastAPI 怎么做 | 差异的根源 / 取舍 |
| --- | --- | --- | --- |
| **依赖注入** | 构造函数注入；容器**启动时**建图、多为单例 | 函数参数 `Depends`；**每请求**按签名现解析 | Nest 靠模块/容器装配，静态、可复用单例；FastAPI 无容器，按声明即插即用，天然「请求级」作用域（详见 §6.1） |
| **会话/资源生命周期** | 无「生成器依赖」概念；Provider 用生命周期钩子 | `yield` 生成器依赖：请求内持有、请求结束清理 | `get_db` 把「开关会话」外包给框架，避免泄漏（详见 §6.2） |
| **鉴权** | `JwtAuthGuard`（Guard）+ `@CurrentUser()` 两步 | 合成**一个** `get_current_user` 依赖，直接 `Depends` | Guard 是「生命周期阶段」，参数装饰器是「取值」；FastAPI 把两步揉成一个可组合依赖（详见 §6.4） |
| **取请求头令牌** | 手写 `header.slice(7)` | `HTTPBearer` 自动解析 → `.credentials` | 少写解析代码；但 `HTTPBearer` 默认缺头抛 **403**，本项目关掉 `auto_error` 统一成 **401**（详见 §6.3） |
| **请求体校验** | `interface`（擦除）+ `class-validator` + `ValidationPipe` | 一个 Pydantic `BaseModel` 既是类型又是校验器 | 「类型」与「校验器」在 TS 是两样东西、在 Python 是一样（详见 §6.6） |
| **校验错误文案** | class-validator 默认文案 → `exceptionFactory` 重拼 | Pydantic 默认 `msg` → `errors.py` 重拼 | 两库默认文案天然不同；**契约规定文案、两端各自翻译**（详见 §6.6） |
| **错误体归一** | `HttpErrorFilter`（`@Catch(HttpException)`，全局过滤器） | 给 `app` 注册若干 `@app.exception_handler` | 一个类实现接口 vs 一组函数按类型登记；都在「异常冒泡到最外层前」改写（详见 §6.5） |
| **校验失败状态码** | `ValidationPipe` 默认 400 | FastAPI 默认 **422**，本项目改成 **400** | 默认值不同，靠异常处理器收口（详见 §6.5） |

> **共通点**：两端都在追求「**同一份契约、同一套行为**」——差异主要在**表达机制**（构造 vs 参数、类 vs 函数、容器 vs 签名扫描），而非**目标**。

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| `Depends` 依赖注入（对比 NestJS 构造函数注入） | **首次教学于本篇** |
| `get_db` 会话依赖（`yield` / 每请求一 Session） | **首次教学于本篇** |
| `HTTPBearer` 安全依赖（`auto_error` / `.credentials`） | **首次教学于本篇** |
| 依赖的依赖（`get_current_user` 组合式认证） | **首次教学于本篇** |
| `@app.exception_handler` 异常处理器（归一化错误体） | **首次教学于本篇** |
| `fastapi.HTTPException` 与 `starlette.exceptions.HTTPException` 的继承关系 | **首次教学于本篇** |
| `RequestValidationError` → 400 的归一化；`message` 必须为字符串 | **首次教学于本篇** |
| 自定义异常类的扩展机制（本项目未使用，仅说明） | **首次教学于本篇** |
