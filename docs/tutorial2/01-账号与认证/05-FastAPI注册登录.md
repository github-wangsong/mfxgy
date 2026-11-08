# 05 · FastAPI 注册登录（账号与认证）

> 阶段 1 · 第 5 步
>
> 做完：`api-py` 的 `POST /auth/register`（201）、`POST /auth/login`（200）、`GET /auth/me`（Bearer）与 NestJS 行为逐字节一致；bcrypt 哈希可互认、JWT 可互相验证。
>
> **本篇面试考点**：FastAPI 默认 `{detail}` 怎么归一化 · Pydantic v2 `extra="forbid"` / `EmailStr` / `field_serializer` · `Depends` 与生成器依赖 · `HTTPBearer(auto_error=False)` · PyJWT 的 `algorithms` 白名单 · 跨语言 bcrypt 与 JWT 互认。

> 上接：`04-SQLAlchemy用户表.md` 已完成 `users` 表映射。本篇只写 Python 侧的业务与路由，**不碰 DDL**。

---

## 1. 文件清单与依赖关系

```text
app/
├── timefmt.py          ← 时间戳统一成 ...Z（先写，出参都用它）
├── json_response.py    ← 响应头带 charset=utf-8
├── errors.py           ← {detail} → {statusCode, message, error}
├── security.py         ← bcrypt + PyJWT
├── api/
│   ├── deps.py         ← get_db / get_current_user
│   └── auth.py         ← 三个路由 + Pydantic 模型
└── main.py             ← 注册异常处理器、挂载 router
```

顺序：**格式化工具 → 错误体 → 安全函数 → 依赖 → 路由 → 入口。**

---

## 2. 时间戳：与 `toISOString()` 逐字节一致

**完整文件路径：`apps/api-py/app/timefmt.py`**

```python
"""时间戳格式化工具：全站出参统一为 UTC + 毫秒 + `Z`。

契约要求所有出参时间字段形如 `2026-10-18T02:36:24.278Z`
（UTC、ISO-8601、毫秒精度、以 `Z` 结尾，固定 24 字符），
与 TS 侧 `Date.prototype.toISOString()` 逐字节一致。
"""

from datetime import datetime, timezone


def iso_z(dt: datetime) -> str:
    """把 datetime 规范成 `YYYY-MM-DDTHH:MM:SS.mmmZ`。

    - 无时区信息（数据库中多为 naive）按 UTC 解释；
    - 统一转成 UTC；
    - 微秒截断到毫秒（向下取整）；
    - 以 `Z` 结尾，而非 Python 默认的 `+00:00`。
    """
    # 数据库列是 timestamp without time zone，读出来 tzinfo 为 None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    # 统一到 UTC，并把微秒截到毫秒（PG 列本身是 timestamp(3)，这里是防御性处理）
    dt = dt.astimezone(timezone.utc).replace(microsecond=(dt.microsecond // 1000) * 1000)
    # isoformat 输出 `...+00:00`，契约要求 `Z`
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
```

> 为什么不用 `dt.isoformat()`：Python 默认输出 `2026-10-18T02:36:24.278000+00:00`——微秒 6 位、偏移量写 `+00:00`。而 JS 的 `toISOString()` 是 3 位毫秒 + `Z`。**契约测试是逐字节比较字符串的**，差一个字符就红。

> **面试考点 · 为什么时间字段不直接返回 `datetime` 让 FastAPI 自己序列化？**
> FastAPI/Pydantic 默认输出仍可能是 `+00:00` 或省略毫秒，且 naive datetime 的行为依赖 Pydantic 版本。显式 `field_serializer` 把“格式”这件事收到一个函数里，两端才有可比性。**格式不是细节，是契约。**

---

## 3. 统一错误体

### 3.1 响应头带 charset

**完整文件路径：`apps/api-py/app/json_response.py`**

```python
"""带 `charset=utf-8` 的 JSON 响应（与 api-ts 的响应头保持一致）。

背景（真实踩过的坑）：Starlette 的 `JSONResponse` 默认 `content-type` 是
`application/json`，**不带 charset**。响应体本身是 UTF-8 字节，但缺失 charset 声明时，
部分非浏览器客户端（PowerShell 5.1、一些 HTTP 库）会按 ISO-8859-1 解码，
含中文的响应就会变成乱码（如 `安全` → `å®å¨`）。

NestJS 侧返回的是 `application/json; charset=utf-8`，为实现「两端契约一致」，
Python 侧统一使用本类作为默认响应类。
"""

from fastapi.responses import JSONResponse


class UTF8JSONResponse(JSONResponse):
    """在 `Content-Type` 里显式声明 `charset=utf-8`。"""

    media_type = "application/json; charset=utf-8"
```

### 3.2 把 `{detail}` 归一化成契约形状

**完整文件路径：`apps/api-py/app/errors.py`**

```python
"""把 FastAPI 默认的错误体归一化成契约要求的 `ErrorResponse`。

NestJS 默认返回 `{statusCode, message, error}`；FastAPI 默认返回 `{detail}`。
契约要求两套后端产出**同一形状且逐字节相同**的错误体，所以这里做归一化。
"""

from typing import Any

import re

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.json_response import UTF8JSONResponse

# 状态码 → 标准短语，与 api-ts 的 HttpErrorFilter 完全一致
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
    """组装契约规定的三字段错误体。"""
    return UTF8JSONResponse(
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
    ≥3 个为 `"'start', 'end' or 'llm'"`。统一按引号抽取各枚举值。
    """
    values = re.findall(r"'([^']*)'", expected)
    return ", ".join(values) if values else expected


def _describe(err: dict[str, Any]) -> tuple[str, str]:
    """把单条 Pydantic 校验错误映射成 (规则名, 文案)。"""
    loc = err.get("loc", ())
    # 只取最后一段：`("body", "email")` → `email`
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
    # 先按字段出现顺序，再按规则顺序
    items.sort(key=lambda item: (item[0], item[1]))
    return "; ".join(item[2] for item in items)


def register_error_handlers(app: FastAPI) -> None:
    """注册异常处理器（须在创建 app 之后、提供服务之前调用）。"""

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # 业务里 raise HTTPException(detail="...") 的字符串直接作为 message
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return _envelope(exc.status_code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic 的错误数组 → 契约的单一字符串
        return _envelope(status.HTTP_400_BAD_REQUEST, _build_message(exc.errors()))
```

> **面试考点 · 为什么不能直接用 FastAPI 默认的错误格式？**
> 默认是 `{"detail": [{"loc": ["body","email"], "msg": "...", "type": "..."}]}`。前端要写两套解析逻辑，契约测试也无法逐字节比较。**错误体是 API 的一部分**：客户端靠它做提示、网关靠它做告警，形状必须稳定。
>
> **追问：为什么 `loc[-1]` 只取最后一段？**
> Pydantic 的 `loc` 是路径：`("body", "email")` 表示请求体里的 `email`。契约文案只要字段名，所以取最后一段；嵌套 DTO 时它会自然落到叶子字段（如 `("body", "nodes", 0, "type")` → `type`），与 NestJS 侧递归下钻的结果对齐。

> 两个 handler 必须都注册：`StarletteHTTPException` 管手动抛的业务错误（401/409），`RequestValidationError` 管 Pydantic 自动抛的 400。少一个，错误形状就会露馅。

---

## 4. 安全函数：bcrypt + PyJWT

**完整文件路径：`apps/api-py/app/security.py`**

```python
"""密码哈希与 JWT。

两套后端必须使用**同一算法 + 同一密钥**：
- bcrypt（成本因子 10，与 TS 侧 bcryptjs 一致）→ 哈希可互相校验；
- HS256 + 同一 `JWT_SECRET` → 双方签发的令牌可互相认证。
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.config import settings

# 与 api-ts 的 BCRYPT_ROUNDS = 10 保持一致
BCRYPT_ROUNDS = 10
# 对称签名；两端必须同算法、同密钥
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    # bcrypt 只接受 bytes；gensalt 生成随机盐并编码进结果字符串
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        # checkpw 从哈希里取出盐与 cost 重新计算
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # 哈希格式非法（比如手工写入的脏数据）时按“密码错误”处理，不要 500
        return False


def create_access_token(*, user_id: str, role: str) -> tuple[str, int]:
    """返回 (token, expires_in 秒)。载荷：sub / role / iat / exp。"""
    expires_in = settings.access_token_expires_in
    now = datetime.now(timezone.utc)
    payload = {
        # sub 是 JWT 标准字段，放用户 id
        "sub": user_id,
        "role": role,
        # iat / exp 用 Unix 秒；PyJWT 会自动校验 exp
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    # 返回值直接给前端；expires_in 同时用于响应体，避免两边各算一次
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM), expires_in


def decode_access_token(token: str) -> dict[str, Any]:
    # algorithms 必须显式传白名单：不传会让 `alg: none` 之类的伪造 token 有可乘之机
    return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
```

> **面试考点 · 跨语言的 bcrypt 真的能互认吗？**
>
> 能，因为 bcrypt 的哈希字符串是自描述的：`$2a$10$<22 字符盐><31 字符哈希>`。前缀里已经写明版本、cost、盐，任何实现都能拿它重新计算。
>
> - NestJS 用 `bcryptjs` 生成的是 `$2a$10$...`；
> - Python 用 `bcrypt` 生成的是 `$2b$10$...`；
> - **两者都能校验对方的哈希**（`$2a$` / `$2b$` 的计算方式一致，只是历史版本标记不同）。
> - 前提是 **cost 与算法相同**。如果一边改成 argon2，另一边就验不了——这就是 `.env` 之外还要对齐“算法”的原因。
>
> **追问：PyJWT 的 `algorithms` 为什么必须显式写？**
> 历史上有过 `alg: none` 伪造漏洞：攻击者把 header 改成 `{"alg":"none"}`、去掉签名，早期库会“验证通过”。显式传 `algorithms=["HS256"]` 是强制白名单——token 头里写别的算法直接拒绝。

---

## 5. 依赖：数据库会话与当前用户

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

# auto_error=False：缺少 Authorization 头时返回 None，由我们自己抛契约规定的 401。
# 默认 True 会抛 403 "Not authenticated"，形状和文案都对不上契约。
bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Iterator[Session]:
    # 生成器依赖：请求开始时创建 session，请求结束（含异常）时 with 自动关闭
    with SessionLocal() as session:
        yield session


def _unauthorized(message: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        # RFC 7235：401 应带 WWW-Authenticate，告诉客户端该用哪种认证方案
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    # 1) 没带 token
    if credentials is None:
        _unauthorized("Missing bearer token")
    # 2) 签名错 / 过期 / 格式错
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception:
        _unauthorized("Invalid or expired token")
    # 3) token 有效但用户已被删
    user = db.get(User, payload.get("sub"))
    if user is None:
        _unauthorized("User no longer exists")
    # 返回 ORM 实体；路由层拿到的就是当前用户
    return user
```

> **面试考点 · FastAPI 的 `Depends` 和 NestJS 的 DI 是什么关系？**
>
> - NestJS 是**容器式 DI**：provider 在模块里注册，构造参数按类型注入，生命周期由容器管。
> - FastAPI 是**函数式依赖**：`Depends(fn)` 声明“这个参数由 `fn` 提供”，框架按调用图递归解析，同一请求内默认缓存同一次依赖结果。
> - 相同点：都能自动注入、都能替换（测试里 `app.dependency_overrides[get_db] = ...` 就是 mock）。
> - 区别：FastAPI 的依赖是显式写在签名里的，读代码时“这个值从哪来”一目了然；Nest 依赖类型元数据，隐式但需要装饰器支撑。
>
> **追问：`yield` 依赖的清理时机？**
> `yield` 之后的代码在**响应发送完成后**执行（FastAPI 0.106+ 语义）。所以 `with SessionLocal()` 能保证每个请求都关 session，哪怕路由里抛了异常。不要在 `yield` 之前 return，否则清理逻辑不会注册。

> **面试考点 · 为什么 `HTTPBearer(auto_error=False)`？**
> 默认 `auto_error=True` 时，缺 `Authorization` 头会抛 `HTTPException(403, "Not authenticated")`。而契约要求 `401 Missing bearer token`。关掉自动错误，让 `credentials` 可能为 `None`，我们就能自己控制状态码和文案——**契约优先于框架默认值。**

---

## 6. 路由与 Pydantic 模型

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

# prefix 统一加 /auth，tags 只影响 OpenAPI 文档分组
router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    # extra="forbid" == 契约的 additionalProperties: false（多传字段直接 400）
    model_config = ConfigDict(extra="forbid")

    # EmailStr 由 email-validator 提供，校验规则与 api-ts 的 IsEmailFormat 对齐
    email: EmailStr
    # 只有注册校验长度；登录不校验
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    # 登录只校验类型；Pydantic 里 str 声明本身就保证是字符串
    password: str


class UserResponse(BaseModel):
    """对应契约 `UserResponse`（绝不包含密码哈希）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    email: str
    # 契约里是枚举；这里用 str 接收数据库值，边界由 TS 侧写入保证
    role: str
    # 内部保持 datetime，序列化时再统一格式
    createdAt: datetime

    @field_serializer("createdAt")
    def _serialize_created_at(self, value: datetime) -> str:
        # 字段名必须叫 createdAt（契约是 camelCase），值走 iso_z
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
    # 创建了资源 → 201（FastAPI 默认是 200，必须显式写）
    status_code=status.HTTP_201_CREATED,
    # operation_id 与契约的 operationId 一致，生成客户端时名字才不会漂
    operation_id="register",
)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> UserResponse:
    # 先查重，给友好的 409；并发下仍由数据库唯一索引兜底
    if db.scalar(select(User).where(User.email == body.email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        # 必须自己生成 uuid：Prisma 的 uuid() 是客户端默认值，数据库列没有 DEFAULT
        id=str(uuid.uuid4()),
        email=body.email,
        password_hash=hash_password(body.password),
        role="member",
    )
    db.add(user)
    db.commit()
    # commit 后刷新，拿到数据库生成的 created_at 默认值
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
    # get_current_user 已经完成 401 判断，这里只做序列化
    return _to_user_response(current_user)
```

> **面试考点 · Pydantic 模型里为什么字段名是 `createdAt` 而不是 `created_at`？**
> 因为**响应模型直接对应契约**，契约字段就是 camelCase。数据库列是 `password_hash`，ORM 实体是 `password_hash`，但对外视图必须叫 `createdAt`。三套命名各司其职：数据库 snake_case、Python 内部 snake_case、HTTP JSON camelCase，转换只发生在 `_to_user_response` 这一个函数里。
>
> **追问：`extra="forbid"` 对响应模型有什么用？**
> 请求模型的 `extra="forbid"` 负责拒绝多传字段；响应模型的它更像一道自检：手工构造 `UserResponse(...)` 时如果多传了（比如 `password_hash`），Pydantic 直接报错，而不是悄悄序列化出去。**用同一套严格配置同时守住入口和出口。**

> **面试考点 · `db.refresh(user)` 为什么必须有？**
> `created_at` 是**数据库默认值**，`db.add()` + `commit()` 之后 SQLAlchemy 并不知道数据库填了什么（除非用 `RETURNING`，且配置允许）。`refresh()` 会重新 SELECT 一次，把 `created_at` 等数据库生成的值拉回对象。少了它，`user.created_at` 可能是 `None`，`iso_z` 直接崩。
>
> **追问：为什么 `id` 要自己生成，不能交给数据库？**
> 因为迁移 SQL 里 `id` 列**没有 DEFAULT**（Prisma 的 `uuid()` 是客户端生成的，见 `02-Prisma用户表.md`）。如果 Python 不生成，INSERT 会因 `NOT NULL` 失败。这也是“迁移所有权”带来的直接后果：**表结构由谁建，写入约定就得跟谁一致。**

---

## 7. 入口：注册异常处理器并挂路由

**完整文件路径：`apps/api-py/app/main.py`**

阶段 1 的完整内容（后续阶段继续追加 router）：

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

# 必须在 include_router 之前注册：它只影响之后产生的异常吗？不是——
# 异常处理器是全局的，但放在提供请求之前注册语义更清晰。
register_error_handlers(app)

app.include_router(health_router)
app.include_router(auth_router)

if __name__ == "__main__":
    import uvicorn

    # 端口从配置读取（PORT，默认 8000），与 api-ts 的 process.env.PORT 同规则
    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.port, reload=True)
```

> **面试考点 · FastAPI 的异常处理器和 NestJS 的 ExceptionFilter 有什么区别？**
> 两者都是“兜底所有异常、统一输出”的位置。区别在注册方式：Nest 是 `app.useGlobalFilters(new X())`，一个类处理所有 `HttpException`；FastAPI 是 `@app.exception_handler(异常类型)`，**按类型分别注册**，所以本项目注册了两个——一个管业务 `HTTPException`，一个管校验 `RequestValidationError`。

---

## 8. 验证

```powershell
# 0. api-ts 保持运行（:3001），另开一个终端起 api-py（:8000）
cd apps/api-py
uv run uvicorn app.main:app --reload --port 8000
```

```powershell
# 1. 用 api-py 注册一个新用户 → 201
$body = @{ email = 'bob@example.com'; password = 'password123' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/register `
  -ContentType 'application/json' -Body $body
```

预期：

```text
id    : 8c1d2e3f-...
email : bob@example.com
role  : member
createdAt : 2026-10-18T03:12:45.612Z
```

```powershell
# 2. 重复注册 → 409
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/register `
    -ContentType 'application/json' -Body $body
} catch {
  $_.ErrorDetails.Message
}
```

预期：

```json
{"statusCode":409,"message":"Email already registered","error":"Conflict"}
```

```powershell
# 3. 校验错误 → 400，文案与 api-ts 完全一致
$bad = @{ email = 'not-an-email'; password = 'short' } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/register `
    -ContentType 'application/json' -Body $bad
} catch {
  $_.ErrorDetails.Message
}
```

预期（注意两条错误的顺序与分隔符）：

```json
{"statusCode":400,"message":"email must be a valid email; password must be at least 8 characters","error":"Bad Request"}
```

```powershell
# 4. 登录 → 200 + TokenResponse
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8000/auth/login `
  -ContentType 'application/json' -Body $body
$token = $login.accessToken
$login.expiresIn   # 3600
```

```powershell
# 5. 带 token 取当前用户
Invoke-RestMethod -Uri http://localhost:8000/auth/me `
  -Headers @{ Authorization = "Bearer $token" }
```

```powershell
# 6. 缺 token / 伪造 token → 401（文案与 api-ts 一致）
try { Invoke-RestMethod -Uri http://localhost:8000/auth/me } catch { $_.ErrorDetails.Message }
try {
  Invoke-RestMethod -Uri http://localhost:8000/auth/me `
    -Headers @{ Authorization = "Bearer $($token)x" }
} catch { $_.ErrorDetails.Message }
```

预期：

```json
{"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}
{"statusCode":401,"message":"Invalid or expired token","error":"Unauthorized"}
```

### 8.1 跨后端互认（阶段 1 最关键的一条验收）

```powershell
# 7. api-py 签发的 token，拿去调 api-ts 的 /auth/me
Invoke-RestMethod -Uri http://localhost:3001/auth/me `
  -Headers @{ Authorization = "Bearer $token" }

# 8. 反过来：api-ts 签发的 token，调 api-py 的 /auth/me
$tsToken = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType 'application/json' -Body (@{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json)).accessToken
Invoke-RestMethod -Uri http://localhost:8000/auth/me `
  -Headers @{ Authorization = "Bearer $tsToken" }
```

两条都能返回用户信息，说明：

1. 两边 `JWT_SECRET` 相同、算法都是 HS256、payload 都用 `sub`；
2. `exp` / `iat` 语义一致；
3. 两边读的是同一张 `users` 表。

```powershell
# 9. 密码哈希互认：api-py 用 bcrypt 校验 api-ts 写入的 $2a$ 哈希（登录就是证明）
#    如果第 8 步用 alice（api-ts 注册）能登录成功，说明已经验证过了。
```

> **面试考点 · 这一步为什么比“接口能返回 200”更重要？**
> 单端自测只能证明“自己和自己一致”。跨端互认才证明**契约真的被两份独立实现遵守**：同一个 secret、同一个算法、同一个 payload 字段、同一张表、同一种时间格式。这也是双后端项目最容易翻车的地方——两边都“能跑”，但 token 互不认、错误文案差一个字、时间差 3 位微秒。

---

## 9. 下一步

- `06-前端登录页.md`：登录/注册表单、`tokenResponseSchema` 校验、token 存储、登录后带 Bearer 调 `/auth/me`、切换 `NEXT_PUBLIC_API_BASE_URL` 验证两套后端。
