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

from collections.abc import Iterator
from typing import NoReturn

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.user import User
from app.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def _unauthorized(message: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        _unauthorized("Missing bearer token")
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception:
        _unauthorized("Invalid or expired token")
    user = db.get(User, payload.get("sub"))
    if user is None:
        _unauthorized("User no longer exists")
    return user
```

### 5.2 `apps/api-py/app/api/auth.py`

**完整文件路径：`apps/api-py/app/api/auth.py`**

```python
"""`/auth/*` 路由 —— 契约见 packages/contract/openapi.yaml。"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.security import create_access_token, hash_password, verify_password
from app.timefmt import iso_z

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str


class UserResponse(BaseModel):
    """对应契约 `UserResponse`（绝不包含密码哈希）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    email: str
    role: str
    createdAt: datetime

    @field_serializer("createdAt")
    def _serialize_created_at(self, value: datetime) -> str:
        return iso_z(value)


class TokenResponse(BaseModel):
    """对应契约 `TokenResponse`。"""

    model_config = ConfigDict(extra="forbid")

    accessToken: str
    tokenType: str
    expiresIn: int
    user: UserResponse


def _to_user_response(user: User) -> UserResponse:
    # 库里是 naive timestamp；iso_z 会按 UTC 解释并输出毫秒 + Z 形式
    return UserResponse(id=user.id, email=user.email, role=user.role, createdAt=user.created_at)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="register",
)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> UserResponse:
    if db.scalar(select(User).where(User.email == body.email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(
        id=str(uuid.uuid4()),
        email=body.email,
        password_hash=hash_password(body.password),
        role="member",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_user_response(user)


@router.post("/login", response_model=TokenResponse, operation_id="login")
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == body.email))
    # 统一报同一个错误，避免泄露「邮箱是否存在」
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token, expires_in = create_access_token(user_id=user.id, role=user.role)
    return TokenResponse(
        accessToken=token,
        tokenType="Bearer",
        expiresIn=expires_in,
        user=_to_user_response(user),
    )


@router.get("/me", response_model=UserResponse, operation_id="getCurrentUser")
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return _to_user_response(current_user)
```

### 5.3 `apps/api-py/app/errors.py`

**完整文件路径：`apps/api-py/app/errors.py`**

```python
"""把 FastAPI 默认的错误体归一化成契约要求的 `ErrorResponse`。

NestJS 默认返回 `{statusCode, message, error}`；FastAPI 默认返回 `{detail}`。
契约要求两套后端产出**同一形状**的错误体，所以这里做归一化。
"""

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


def _envelope(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "statusCode": status_code,
            "message": message,
            "error": _REASON_PHRASES.get(status_code, "Error"),
        },
    )


def register_error_handlers(app: FastAPI) -> None:
    """注册异常处理器（须在创建 app 之后、提供服务之前调用）。"""

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return _envelope(exc.status_code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        first = errors[0] if errors else {"msg": "Validation error"}
        return _envelope(status.HTTP_400_BAD_REQUEST, str(first.get("msg", "Validation error")))
```

### 5.4 `apps/api-py/app/main.py`

**完整文件路径：`apps/api-py/app/main.py`**

```python
"""FastAPI 入口（api-py）。

契约来源：packages/contract/openapi.yaml
本服务的所有接口都必须与该契约一致，并通过契约测试与 api-ts 对齐。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
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
```

**三处关键行**

- `from app.api.auth import router as auth_router`：把认证路由引入。
- `register_error_handlers(app)`：**必须在 `app = FastAPI(...)` 之后**调用——异常处理器要挂到已存在的 app 上。
- `app.include_router(auth_router)`：把 `APIRouter` 挂进应用（`APIRouter`/`include_router` 机制见阶段 0 · 06 §10.4）。

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

**与 NestJS 对照**：NestJS 是**构造函数注入**——`constructor(private readonly authService: AuthService) {}`，由 IoC 容器在**实例化类**时把 `AuthService` 注入；FastAPI 是**函数参数注入**——在每个**请求**的处理函数参数上按需声明。两者都是「谁需要什么就声明什么」，但粒度不同：

| | NestJS | FastAPI |
| --- | --- | --- |
| 注入点 | 类的构造函数 | 处理函数的参数 |
| 声明 | 参数类型（靠 metadata 注册表解析） | `= Depends(可调用对象)`（显式给出提供者） |
| 生命周期 | 多为单例 Provider | 依赖每次请求按需求值（可做「每请求」作用域） |

> NestJS 的 DI 首次教学见 `00-项目初始化/05-NestJS起步.md`。

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

> 与 NestJS 对照：`JwtAuthGuard` 是**手动**从头里抠 `Authorization`（`header.slice(7)`）再验签；FastAPI 这一步由 `HTTPBearer` **代劳解析**，我们只接令牌。

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
