# 06 · JWT 与密码哈希（跨语言对照）

> 所属：阶段 1 · 账号与认证
> 本篇覆盖：把「注册 / 登录 / 认证」背后的两件底层技术一次讲透——**密码怎么存**（bcrypt）与**凭证怎么签**（JWT）；并**实测**为什么两套后端能互相认可对方签发的令牌。
> **本篇首次教学：密码存储与哈希 · 加密 vs 哈希 · bcrypt 盐与成本因子 · JWT 三段结构 · HS256 对称签名 · JWT claims（`sub`/`role`/`iat`/`exp`）· 无状态认证 ·「同一认证域」（共享密钥 + 算法 ⇒ 令牌互认）**

---

## 1. 本篇目标

做完这一篇，你能：

- 讲清楚**为什么密码绝不能明文入库**，以及「哈希」与「加密」的本质区别。
- 说明 **bcrypt 的盐（salt）与成本因子（cost）**分别解决什么问题，并看懂得出的哈希串 `$2a$10$...` / `$2b$10$...` 每一段的含义。
- 拆开一个 JWT，说清 **三段结构**、**HS256 对称签名**、**claims**、**`exp` 过期**与**无状态认证**。
- 用一条命令**实测**「api-py 签发的 token 在 api-ts 上可用，反之亦然」，并解释这背后的**「同一认证域」**以及它的**风险**。

**验收标准（对齐总纲 §5.6「认证约定」与阶段 1 交付）**：

| # | 检查 | 预期 |
| --- | --- | --- |
| C1 | 数据库里的密码列 | `password_hash` 是 bcrypt 哈希（**不是明文**），成本因子 **10** |
| C2 | 登录返回的 `accessToken` | 三段式 JWT，header 解出 `{"alg":"HS256","typ":"JWT"}`，payload 含 `sub/role/iat/exp` |
| C3 | 跨后端互认 | api-ts 的 token 打 api-py `/auth/me` → **200**；api-py 的 token 打 api-ts `/auth/me` → **200** |

---

## 2. 前置条件

| 前置 | 状态要求 | 出处 |
| --- | --- | --- |
| 两套后端在跑 | `dev:api-ts`(:3001) / `dev:api-py`(:8000) | `01-账号与认证/03`、`05` |
| `users` 表已建 | Prisma 迁移 `init_users` 已应用 | `01-账号与认证/02`、`04` |
| 注册/登录/me 已实现 | 两端 `/auth/*` 均可用 | `01-账号与认证/03`、`05` |
| DB 容器 | `mini-dify-db` 为 `healthy` | `00-项目初始化/02-本地中间件Docker.md` |

启动两套后端（**各占一个终端**）：

```bash
pnpm dev:api-ts     # NestJS  -> http://localhost:3001
pnpm dev:api-py     # FastAPI -> http://localhost:8000
```

> 契约编译、Prisma 迁移、`/auth/*` 的实现细节分别见 `01/03`、`01/05`；本篇只聚焦「密码」与「令牌」这两块底层。

---

## 3. 命令逐条

> 统一用 `127.0.0.1`（显式 IPv4），原因见 `00-项目初始化/08-验收.md` 第 7 节第 5 条。
> 后文出现的 `demo@example.com` / `secret123` 是可替换的示例账号。

### 3.1 注册一个账号（看 201）

**在哪执行**：任意目录
**目的**：写一条用户记录，后续用它观察「库里存的是什么」。

```bash
curl -i -X POST http://127.0.0.1:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}'
```

**预期输出（实测·示例值）**

```
HTTP/1.1 201 Created
{"id":"<uuid>","email":"demo@example.com","role":"member","createdAt":"2026-10-18T..."}
```

### 3.2 看库里的密码列（关键：不是明文）

**在哪执行**：仓库根（`docker-compose.yml` 所在目录）
**目的**：证明落库的是 **bcrypt 哈希**，而非明文。

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "select email, password_hash from users"
```

**预期输出（示例）**

```
       email       |                        password_hash
-------------------+--------------------------------------------------------------
 demo@example.com  | $2a$10$HeZa2r3vLin4CoZnKMWrtOG5MgW0QbZrdsvY2eCqHvTwwpf2pazOG
(1 row)
```

**结果解读**：这一串 `$2a$10$...` 里的 `$2a` 是 **bcrypt 版本**、`10` 是**成本因子**，后面依次是**盐 + 摘要**。落库的**没有** `secret123` 明文。

> **两端各写各的、但可互验**：api-ts 用 `bcryptjs` 生成，前缀是 `$2a$`；api-py 用 Python `bcrypt` 生成，前缀是 `$2b$`。两者都是 **bcrypt-2 变体**、成本因子都是 **10**，且**两个库都接受对方的变体**——本地实测：用 `bcryptjs` 生成的 `$2a$10$...` 能被 Python `bcrypt.checkpw` 校验通过，反之亦然（见第 7.3 节的实测命令）。

### 3.3 登录拿 token（看 200）

```bash
curl -i -X POST http://127.0.0.1:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}'
```

**预期输出（实测·示例值）**

```
HTTP/1.1 200 OK
{"accessToken":"<JWT>","tokenType":"Bearer","expiresIn":3600,
 "user":{"id":"<uuid>","email":"demo@example.com","role":"member","createdAt":"..."}}
```

**结果解读**：`expiresIn:3600` = token 有效期 3600 秒；`tokenType:"Bearer"` 告诉前端怎么放进请求头。

### 3.4 把 token 拆成三段

**在哪执行**：任意目录（仓库根即可，只用 Node 内置模块）
**目的**：肉眼确认 `header.payload.signature` 三段结构，以及 header 里的算法。

```bash
# 先把上一步返回里的 accessToken 存进变量（此处用 python 从 JSON 里取）
TS_TOKEN=$(curl -s -X POST http://127.0.0.1:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

node -e "const t=process.argv[1].split('.');console.log('HEADER =',Buffer.from(t[0],'base64url').toString());console.log('PAYLOAD=',Buffer.from(t[1],'base64url').toString())" "$TS_TOKEN"
```

**预期输出（示例）**

```
HEADER = {"alg":"HS256","typ":"JWT"}
PAYLOAD= {"sub":"<uuid>","role":"member","iat":1792296000,"exp":1792299600}
```

**结果解读**：`alg` 是 `HS256`（对称签名）；`payload` 里的 `sub`（用户 id）、`role`、`iat`（签发时刻）、`exp`（过期时刻）就是**claims**。注意：payload 只是 base64，**任何人都能读**，所以绝不能往里塞敏感信息。

### 3.5 跨后端互认（本篇的核心实测）

**在哪执行**：任意目录

```bash
# ① api-ts 登录拿到 TS_TOKEN（见 3.4）
#    用「api-ts 签发的 token」去访问「api-py 的 /auth/me」
curl -i http://127.0.0.1:8000/auth/me -H "Authorization: Bearer $TS_TOKEN"

# ② api-py 登录拿到 PY_TOKEN
PY_TOKEN=$(curl -s -X POST http://127.0.0.1:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

#    用「api-py 签发的 token」去访问「api-ts 的 /auth/me」
curl -i http://127.0.0.1:3001/auth/me -H "Authorization: Bearer $PY_TOKEN"
```

**预期输出（实测）**：两次都是 **200**，且返回同一条用户信息

```
HTTP/1.1 200 OK
{"id":"<uuid>","email":"demo@example.com","role":"member","createdAt":"..."}
```

**结果解读**：**token 跨后端有效**——这正是「同一认证域」的直接证据，原理见第 7 节。

### 3.6 本地零依赖互验（不启动服务也能验证）

**在哪执行**：分别用两端的运行时（Node / Python）
**目的**：把「同一算法 + 同一密钥 ⇒ 互认」这件事，从「应用层」下沉到「库层」各验一次。

```bash
# ① bcrypt：Python 校验 bcryptjs 生成的哈希
#    （JS_HASH 取自 3.2 的库查询结果）
node -e "const b=require('bcryptjs');process.stdout.write(b.hashSync('secret123',10))"   # 在 apps/api-ts 目录执行
#   → JS_HASH=$2a$10$...
python -c "import bcrypt,sys;print(bcrypt.checkpw(b'secret123', sys.argv[1].encode()))" "$JS_HASH"   # 用 api-py 的 venv
#   → True

# ② JWT：api-py(PyJWT) 签发 → api-ts(JwtService) 校验
#    TS 侧：node -e "const {JwtService}=require('@nestjs/jwt');..."（见下「实测结果」）
```

**本地实测结果（本机跑出的真实值）**

```
JS_HASH         = $2a$10$DCGn3cPOXEjGpWWTVmIlK.FWCZf0H4bAoXx.YFTHg/RpHttoPIM1m
PY_HASH         = $2b$10$TEJkbxLzwQOxyyseZEf5cu/ntikDtgPo7x.IMeUFCeB90zNOlKTHK
PY_VERIFIES_JS  = True     # Python bcrypt 认得 bcryptjs 的 $2a$ 哈希
JS_VERIFIES_PY  = true     # bcryptjs 认得 Python bcrypt 的 $2b$ 哈希

# JWT 双向
JS_VERIFIES_PY_TOKEN = {"sub":"user-py-1","role":"member"}                       # 两边都解出了 payload
PY_VERIFIES_JS_TOKEN = {'sub': 'user-ts-1', 'role': 'member', 'iat': ..., 'exp': ...}
# 两端 header 前缀一致：eyJhbGciOiJIUzI1NiIs...  →  {"alg":"HS256","typ":"JWT"}
```

**结果解读**：互认不是「碰巧」，而是**算法 + 参数 + 密钥三者对齐**的必然结果。

---

## 4. 完整代码

### 4.1 TS 侧：签发 / 校验密码与令牌

**完整文件路径：`apps/api-ts/src/auth/auth.service.ts`**

```ts
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { TokenResponse, UserResponse } from '@mini-dify/contract'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'

import { PrismaService } from '../prisma/prisma.service'

const BCRYPT_ROUNDS = 10
// 与 JwtModule 的 signOptions 读同一个键，保证签发与返回值一致
const ACCESS_TOKEN_EXPIRES_IN = Number(process.env.JWT_EXPIRES_IN ?? 3600) // 秒

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(email: string, password: string): Promise<UserResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing !== null) {
      throw new ConflictException('Email already registered')
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const user = await this.prisma.user.create({
      data: { email, passwordHash, role: 'member' },
    })
    return this.toUserResponse(user)
  }

  async login(email: string, password: string): Promise<TokenResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } })
    // 统一报同一个错误，避免泄露「邮箱是否存在」
    if (user === null || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password')
    }
    const accessToken = await this.jwtService.signAsync({ sub: user.id, role: user.role })
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      user: this.toUserResponse(user),
    }
  }

  async findById(id: string): Promise<UserResponse | null> {
    const user = await this.prisma.user.findUnique({ where: { id } })
    return user === null ? null : this.toUserResponse(user)
  }

  private toUserResponse(user: {
    id: string
    email: string
    role: string
    createdAt: Date
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      role: user.role as UserResponse['role'],
      createdAt: user.createdAt.toISOString(),
    }
  }
}
```

**完整文件路径：`apps/api-ts/src/auth/jwt-auth.guard.ts`**

```ts
import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

/** JWT 载荷，两套后端必须一致（见总纲 §5.6）。 */
export interface JwtPayload {
  /** 用户 id */
  sub: string
  role: string
}

/**
 * 校验 `Authorization: Bearer <jwt>`。
 * 通过后把 payload 挂到 `request.user`，供 `@CurrentUser()` 取用。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>()
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') === true ? header.slice(7) : undefined
    if (token === undefined) {
      throw new UnauthorizedException('Missing bearer token')
    }
    try {
      request.user = this.jwtService.verify<JwtPayload>(token)
      return true
    } catch {
      throw new UnauthorizedException('Invalid or expired token')
    }
  }
}
```

**完整文件路径：`apps/api-ts/src/auth/auth.module.ts`**（密钥 / 算法 / 过期时间在此配置）

```ts
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'

/**
 * 认证模块。`PrismaService` 来自全局的 `PrismaModule`，无需在此声明。
 * JWT 密钥从 `JWT_SECRET` 读取，有效期从 `JWT_EXPIRES_IN`（秒）读取（本地默认值仅用于开发）。
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600) },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
```

**完整文件路径：`apps/api-ts/.env`**

```bash
# api-ts 本地环境（Prisma CLI 与运行时都会读取本目录的 .env）
# 注意：Prisma 使用 postgresql:// 方案，不带 SQLAlchemy 的 +driver 后缀
DATABASE_URL="postgresql://postgres:difyai123456@localhost:5432/minidify"
# 与 apps/api-py/.env 同值：双方签发的 JWT 才能互认
JWT_SECRET="dev-jwt-secret-change-me-please"
# 令牌有效期（秒）；两端读同一个键
JWT_EXPIRES_IN=3600
PORT=3001
```

### 4.2 Python 侧：签发 / 校验密码与令牌

**完整文件路径：`apps/api-py/app/security.py`**

```python
"""密码哈希与 JWT。

两套后端必须使用**同一算法 + 同一密钥**：
- bcrypt（成本因子 10，与 TS 侧 bcryptjs 一致）→ 哈希可互相校验；
- HS256 + 同一 `JWT_SECRET` → 双方签发的令牌可互相认证（总纲 §5.6）。
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.config import settings

BCRYPT_ROUNDS = 10
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(*, user_id: str, role: str) -> tuple[str, int]:
    """返回 (token, expires_in 秒)。载荷：sub / role / iat / exp。"""
    expires_in = settings.access_token_expires_in
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM), expires_in


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
```

**完整文件路径：`apps/api-py/app/api/deps.py`**（校验入口：读取 `Authorization` 头 → 解 token）

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

**完整文件路径：`apps/api-py/app/config.py`**（密钥 / 有效期的来源）

```python
"""应用配置（pydantic-settings）。

环境变量名大小写不敏感：`database_url` 对应 `DATABASE_URL`。
`access_token_expires_in` 由 `JWT_EXPIRES_IN`（秒）读取，默认 3600。
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# 本项目目录（apps/api-py）：无论从哪个 cwd 启动，都读这一份 .env
_PROJECT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")

    service_name: str = "api-py"
    version: str = "0.1.0"
    database_url: str = "postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify"
    # 与 TS 侧保持同一密钥，双方签发的 JWT 才能互认（见总纲 §5.6）
    jwt_secret: str = "dev-jwt-secret-change-me-please"
    # 令牌有效期（秒）：读同一个 JWT_EXPIRES_IN，默认 3600
    access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")


settings = Settings()
```

### 4.3 契约里与令牌 / 错误体相关的片段

**完整文件路径：`packages/contract/openapi.yaml`**（节选，完整内容见 01/01）

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    TokenResponse:
      type: object
      additionalProperties: false
      required: [accessToken, tokenType, expiresIn, user]
      properties:
        accessToken:
          type: string
        tokenType:
          type: string
          enum: [Bearer]
        expiresIn:
          type: integer
          description: 有效期（秒）
        user:
          $ref: "#/components/schemas/UserResponse"
```

---

## 5. 【技术教学 · 首次】密码存储：为什么不能明文

> 规则：本节是「密码存储 / 哈希 / bcrypt」的**首次教学**，后续篇目只引用不重讲。

### 5.1 明文存密码为什么是灾难

数据库一旦泄露（拖库 / 备份外泄 / 内部越权），明文密码会被**直接读取**。更糟的是**撞库**：用户常在多个站点用同一密码，一个站泄露会连锁攻破其在别处的账号。

所以密码入库前必须经过**单向变换**，使得：

> 即使拿到了库里的值，也**无法还原**出原始密码；但**能验证**用户输入的密码是否正确。

### 5.2 哈希 vs 加密：一字之差，方向相反

| | 加密（encryption） | 哈希（hashing） |
| --- | --- | --- |
| 是否可逆 | **可逆**：有密钥就能解密回明文 | **不可逆**：无法从摘要还原明文 |
| 有无密钥 | 需要密钥 | 不需要（bcrypt 的盐不是解密密钥） |
| 用途 | 保密传输 / 存储敏感数据（要能读回） | **密码校验**、完整性校验 |
| 本项目 | 未使用 | **密码用 bcrypt 哈希**（`hash_password` / `bcrypt.hash`） |

**结论**：密码要的是「能验证、不能还原」，所以必须用**哈希**，且要用**专门为密码设计的慢哈希**（bcrypt / argon2 / scrypt）——**绝不能**用 MD5 / SHA-1 / SHA-256 这类「快哈希」（算得太快，离线爆破成本极低）。

### 5.3 bcrypt 的「盐」与「成本因子」

**盐（salt）**：每次哈希时生成的一段**随机数据**，与密码一起参与运算，并**存进哈希串里**。

- 作用：同样密码 `secret123`，**不同用户得到不同的哈希** → 攻击者无法预先算好一张「密码 → 哈希」表（彩虹表）批量比对。
- bcrypt 的盐是 **22 个 base64 字符（128 bit）**，由 `gensalt` / `genSalt` 自动生成。

**成本因子（cost / rounds）**：迭代次数的**指数**——成本因子 `N` 表示 `2^N` 轮运算。

- 本项目两端都取 **`BCRYPT_ROUNDS = 10`**（TS `auth.service.ts`、Py `security.py`），即约 `1024` 轮。
- 越大越慢、越抗爆破；太小则离线爆破变快。`10` 是常见开发默认值。

**哈希串的每一段**（以 `$2a$10$HeZa2r3vLin4CoZnKMWrtOG5MgW0QbZrdsvY2eCqHvTwwpf2pazOG` 为例）：

```
$2a$ 10$ HeZa2r3vLin4CoZnKMWrtO G5MgW0QbZrdsvY2eCqHvTwwpf2pazOG
 │    │   └────── 盐（22 字符） ┘ └──────── 摘要（31 字符） ───────┘
 │    └── 成本因子 10
 └── bcrypt 版本标识：$2a / $2b / $2y
```

**关键性质**：参数（版本 + 成本 + 盐）**都写在哈希串里**，校验时从串里读回来重算比对——所以**不需要单独建一列存盐**。

### 5.4 为什么两端前缀不同（`$2a` vs `$2b`）却仍能互验

- api-ts 的 `bcryptjs` 生成 `$2a$10$...`；api-py 的 Python `bcrypt` 生成 `$2b$10$...`。
- `$2a / $2b / $2y` 都是 **bcrypt-2 家族的变体**，算法一致、成本因子一致（都 10）。
- **两个库都接受对方的变体**：Python `bcrypt.checkpw` 能校验 `$2a$`，`bcryptjs.compare` 也能校验 `$2b$`。本地实测两侧互验均为 `True`（见第 3.6 节）。

> 这体现了一条重要的对照结论：**跨语言互通靠的是「算法 + 参数约定」，不是「同一个库」。** 契约只约束「用 bcrypt、成本 10」，具体实现库可以各选各的。

### 5.5 本例中它落在哪

- TS：`bcrypt.hash(password, BCRYPT_ROUNDS)` 写库、`bcrypt.compare(...)` 校验（`auth.service.ts`）。
- Py：`hash_password` / `verify_password` 封装 `bcrypt.hashpw` / `checkpw`（`security.py`）。
- 对外**永远只返回 `UserResponse`**（`id/email/role/createdAt`），**绝不包含 `passwordHash`**——`toUserResponse` / `UserResponse` 两处都显式排除了它。

---

## 6. 【技术教学 · 首次】JWT：三段结构、对称签名与无状态

> 规则：本节是「JWT」的**首次教学**。

### 6.1 JWT 长什么样

JWT（JSON Web Token）是一个字符串，由**两个点**分成**三段**：

```
header . payload . signature
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJzdWIiOiIuLi4ifQ . <HMAC 结果>
```

| 段 | 内容 | 本例实测 |
| --- | --- | --- |
| **header** | 描述算法与类型，base64url 编码 | `{"alg":"HS256","typ":"JWT"}` |
| **payload** | **claims**（载荷），base64url 编码 | `{"sub":"<uuid>","role":"member","iat":...,"exp":...}` |
| **signature** | 对前两段的**签名** | `HMAC-SHA256(base64url(header)+"."+base64url(payload), secret)` |

**务必记住**：header 与 payload **只是 base64url 编码，不是加密**——任何人都能解开看。安全的**只有**「payload 不能被篡改」（签名保证）。所以 payload 里**不放敏感数据**。

### 6.2 HS256：对称签名

`HS256 = HMAC-SHA256`，是**对称**签名的代表：**签发与校验用同一把密钥**。

- 签发：`HMAC-SHA256(header.payload, secret)` → 附在第三段。
- 校验：用**同一把密钥**对收到的 `header.payload` 重算，比对签名。密钥不对 → 校验失败。

对照：`RS256` 是**非对称**（私钥签、公钥验）。受训方实现里没有 PKI 需求，用 HS256 更简单——但代价是**所有验证方都必须持有密钥**（见第 7 节的风险）。

**本例**：TS `@nestjs/jwt` 默认 `HS256`；Py `jwt.encode(..., algorithm="HS256")`。两端算法一致。

### 6.3 claims：`sub` / `role` / `iat` / `exp`

**claims** 就是 payload 里的键值对，分两类：

| claim | 类型 | 含义 | 本例 |
| --- | --- | --- | --- |
| `sub` | 自定义（注册含义：subject） | **用户 id** | `user.id` |
| `role` | 自定义 | 角色（RBAC 预留） | `member` |
| `iat` | 注册（registered） | **签发时刻**（秒级 Unix 时间戳） | 库自动填 |
| `exp` | 注册 | **过期时刻** | 库自动填 |

**两端一致性**（总纲 §5.6 要求载荷结构一致）：`sub`、`role`、`exp`、`iat` 两端都有。

- TS：`jwtService.signAsync({ sub, role })`，`iat`/`exp` 由 `signOptions` 自动补。
- Py：`create_access_token` 显式写入 `sub/role/iat/exp`。

**解码时自动校验**：校验方解 token 时会**自动**检查 `exp`；过期即失败（本项目映射为 **401**「Invalid or expired token」）。

### 6.4 过期时间（`exp` / `expiresIn`）

- **`expiresIn`** = 有效期长度；签发时算出 `exp = now + expiresIn`。
- 两端的**当前实现**都从环境变量 `JWT_EXPIRES_IN`（**秒**）读取：TS 用 `signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600) }`（`auth.module.ts`），并把**同一个值**放进响应的 `expiresIn`（`auth.service.ts` 的 `ACCESS_TOKEN_EXPIRES_IN`）；Py 用 `settings.access_token_expires_in`（`app/config.py` 由 `JWT_EXPIRES_IN` 覆盖、默认 `3600`），同样把它放进响应的 `expiresIn`。
- 两端读**同一个键 `JWT_EXPIRES_IN`**、默认值相同（`3600`），因此不会再漂移。

### 6.5 无状态认证：为什么服务端不存 session 也能认证

传统 session 认证：登录成功后服务端**存一条 session**（内存 / Redis），客户端只拿一个 `sessionId` cookie。缺点是服务端要有状态、要共享存储。

**JWT 的无状态**：

```
   登录 → 服务端签一个自带身份的 token 交给客户端
   之后每次请求 → 客户端带 `Authorization: Bearer <token>`
              → 服务端【只验签名 + 查 exp】就知道「你是谁」，无需查 session 表
```

**为什么能成立**：因为「你是谁」这个信息已经**被签名封装在 token 里**，篡改即签名失效。所以服务端**不需要保存任何会话状态**——这正是它能水平扩展、无粘性负载均衡的原因。

**代价（要记住的短处）**：

- **主动吊销难**：签发后到期前**无法轻易作废**（除非维护黑名单，或改用极短有效期 + refresh token）。
- 因此本项目在 `me` 里仍**回查一次数据库**（`findById` / `db.get(User, sub)`）：token 有效但用户已被删除时按 401 处理（`"User no longer exists"`）——这是「无状态 + 最小一致性检查」的折中。

---

## 7. 【技术教学 · 首次】「同一认证域」：两端共享密钥 ⇒ 令牌互认

> 规则：本节是「同一认证域 / 令牌互认」的**首次教学**。

### 7.1 互认的三个必要条件

api-py 签发的 token 能被 api-ts 接受，必须同时满足：

1. **同一算法**：都 `HS256`；
2. **同一密钥**：`JWT_SECRET` 两端相等（`apps/api-ts/.env` 与 `apps/api-py/.env` 里都是 `dev-jwt-secret-change-me-please`）；
3. **同一 claims 结构**：都含 `sub/role`，校验方按 `sub` 取用户。

三者对齐 ⇒ 一端的 token 在另一端**签名校验通过**，且按同一 `sub` 找到同一用户。

### 7.2 本地实测（不看服务，只看库）

```
JS_VERIFIES_PY_TOKEN = {"sub":"user-py-1","role":"member"}     # PyJWT 签发 → JwtService 验过
PY_VERIFIES_JS_TOKEN = {'sub':'user-ts-1','role':'member','iat':...,'exp':...}  # 反向亦然
两端 header 前缀相同：eyJhbGciOiJIUzI1NiIs...  → {"alg":"HS256","typ":"JWT"}
```

应用层证据见第 3.5 节（两次 `curl` 均 200）。

### 7.3 这个「同一认证域」意味着什么

- 对**用户**：多语言实现在他们眼里是**一个产品**——在 A 端登录取到的凭证，在 B 端照样能用，切换/灰度/迁移无感。
- 对**工程**：这正是本项目的核心命题「**唯一契约、两套实现、行为一致**」在**认证维度**上的落地——不仅响应体一致，**凭证也可互换**。

### 7.4 也是最大的风险点：密钥泄露 = 全线失效

- HS256 是**对称**的：**验证方手里就有签发密钥**。因此只要有一端泄漏 `JWT_SECRET`，攻击者就能**伪造任意用户、任意角色**的 token，且**两端通吃**。
- 生产环境要求：
  - 密钥用**足够熵**的随机值（**≥ 32 字节**），**绝不用**仓库里的 `dev-*-change-me` 默认值；
  - 通过**环境变量 / 密钥管理**注入，不进代码、不进 git；
  - 支持**轮换**（改密钥会让所有存量 token 立即失效——这本身也是一种「吊销」手段）。

> 顺带一个真实观察：本机用 PyJWT 跑 `create_access_token` 时，会打印
> `InsecureKeyLengthWarning: The HMAC key is 31 bytes long, which is below the minimum recommended length of 32 bytes`。
> 这正说明开发默认密钥（31 字节）**长度不足**——仅可用于演示，生产必须换。

---

## 8. 验收自测

按顺序复制执行，全部命中即通过：

```bash
# A. 注册（201）
curl -i -X POST http://127.0.0.1:3001/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}'          # 期望 201

# B. 库里是 bcrypt 哈希、不是明文（期望 $2a$10$... / $2b$10$...）
docker exec mini-dify-db psql -U postgres -d minidify -c "select email, password_hash from users"

# C. 登录（200），拿 TS_TOKEN
TS_TOKEN=$(curl -s -X POST http://127.0.0.1:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# D. 拆段：期望 HEADER={"alg":"HS256","typ":"JWT"}
node -e "const t=process.argv[1].split('.');console.log('HEADER =',Buffer.from(t[0],'base64url').toString());console.log('PAYLOAD=',Buffer.from(t[1],'base64url').toString())" "$TS_TOKEN"

# E. 跨端互认①：TS 的 token 打 PY 的 /auth/me（期望 200）
curl -i http://127.0.0.1:8000/auth/me -H "Authorization: Bearer $TS_TOKEN"

# F. 跨端互认②：PY 的 token 打 TS 的 /auth/me（期望 200）
PY_TOKEN=$(curl -s -X POST http://127.0.0.1:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
curl -i http://127.0.0.1:3001/auth/me -H "Authorization: Bearer $PY_TOKEN"
```

| 检查 | 预期 | 实况 |
| --- | --- | --- |
| A 注册 | 201 | ✅ |
| B 库中密码 | bcrypt 哈希（成本 10），无明文 | ✅ |
| C 登录 | 200 + `accessToken` | ✅ |
| D 拆段 | `{"alg":"HS256","typ":"JWT"}` | ✅ |
| E / F 跨端互认 | 两次均 200 | ✅ |

---

## 9. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **`JWT_SECRET` 两端不一致** | api-py 的 token 打 api-ts 报 401 | 密钥必须逐字节相同：核对 `apps/api-ts/.env` 与 `apps/api-py/.env` 的 `JWT_SECRET`（当前两者都是 `dev-jwt-secret-change-me-please`） |
| 2 | **token 过期** | 一段时间后请求突然 401 | `exp` 到期；重新登录。有效期见 §6.4（当前 3600 秒） |
| 3 | **算法不匹配** | 校验报 `invalid algorithm` / 签名失败 | 一端 `HS256`、另一端配了非对称算法（如 `RS256`）时，密钥体系不同；两端必须同一 `alg` |
| 4 | **误以为 `$2a` 与 `$2b` 不兼容** | 想把两端换成「同一个库」 | 二者同属 bcrypt-2、成本一致即可互验；**无需**统一库（见 §5.4） |
| 5 | **把敏感信息塞进 payload** | —— | payload 仅 base64，**可被任何人读取**；只放 `sub/role` 这类非敏感声明 |
| 6 | **生产沿用开发密钥 / 密钥过短** | PyJWT 打 `InsecureKeyLengthWarning` | 换 ≥32 字节随机密钥、经环境变量注入，并考虑轮换（见 §7.4） |
| 7 | **`Authorization` 头格式错** | 401 `Missing bearer token` | 必须是 `Authorization: Bearer <token>`（`Bearer` 后有空格；Py 用 `HTTPBearer`、TS 用 `startsWith('Bearer ')`） |
| 8 | **明文 / 快哈希存密码** | 库中出现可读密码或 `md5(...)` | 必须用 bcrypt（成本 10）等慢哈希；本项目两端已统一 |

---

## 10. 本篇复盘与知识点

**一句话总结**：认证 = **密码用 bcrypt 慢哈希存**（可验不可还原）+ **身份用 HS256 JWT 签**（自带 `sub/role/exp`、服务端不存 session）；两端**共享算法与密钥**，因此**令牌可互换**——这就是「同一认证域」。

**遗留 / 后续**

- `JWT_EXPIRES_IN` 已抽成独立环境变量（**秒**），两端都读它：TS 侧 `auth.module.ts` 的 `signOptions` 与 `auth.service.ts` 的 `ACCESS_TOKEN_EXPIRES_IN`、Python 侧 `config.py` 的 `access_token_expires_in`，默认 `3600`；实测两端同为 `3600`。
- 生产密钥强度与轮换策略（见 §7.4）属于部署阶段课题。

**基础技术要点**：哈希 vs 加密 · bcrypt 盐与成本因子 · JWT 三段结构 · HS256 对称签名 · JWT claims 与过期 · 无状态认证的取舍。

---

## 11. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| 密码存储：为什么不能明文（哈希 vs 加密、慢哈希） | **首次教学于本篇** |
| bcrypt：盐（salt）与成本因子（cost，本例 10） | **首次教学于本篇** |
| JWT 三段结构（header.payload.signature）与 base64url | **首次教学于本篇** |
| HS256 对称签名（HMAC-SHA256） | **首次教学于本篇** |
| JWT claims（`sub`/`role`/`iat`/`exp`）与 `exp` 过期校验 | **首次教学于本篇** |
| 无状态认证（服务端不存 session）及其「吊销难」的取舍 | **首次教学于本篇** |
| 「同一认证域」：共享算法 + 密钥 ⇒ 跨后端令牌互认 | **首次教学于本篇** |
