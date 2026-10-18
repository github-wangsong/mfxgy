# 03 · NestJS 认证

> 所属：阶段 1 · 账号与认证
> 本篇覆盖：`apps/api-ts` 的 `/auth/*` —— **注册 / 登录 / 当前用户** 三个接口，以及支撑它们的 DTO 校验、全局 `ValidationPipe`、Guard、自定义参数装饰器、全局异常过滤器、服务层编排
> **本篇首次教学**：DTO 与 `class-validator`、`ValidationPipe`（`whitelist` / `forbidNonWhitelisted` / `transform`）、Guard（`CanActivate` / `@UseGuards`）、自定义参数装饰器（`createParamDecorator` / `ExecutionContext`）、异常过滤器（`@Catch` / `ExceptionFilter` / `ArgumentsHost`）、服务层认证编排
> **不再重讲**（只引用）：
> - TypeScript 装饰器 / 依赖注入 / NestJS 模块系统 / `NestFactory` 启动 / CORS → `00-项目初始化/05-NestJS起步.md`
> - 契约类型与「TS 类型运行期被擦除」→ `00-项目初始化/04-契约包与TypeScript类型.md`
> - 契约扩展（`RegisterRequest` / `LoginRequest` / `UserResponse` / `TokenResponse` / `ErrorResponse`）→ `01-账号与认证/01-契约扩展.md`
> - Prisma（`PrismaService` / `User` 模型 / `migrate`）→ `01-账号与认证/02-Prisma.md`
> - JWT 令牌格式、HS256、bcrypt 成本因子等**算法细节** → `01-账号与认证/06-JWT与密码哈希.md`

---

## 1. 本篇目标

做完本篇，`apps/api-ts` 应能对外提供契约 `openapi.yaml` 定义的三个认证接口，且行为与契约、与 FastAPI 侧**逐项一致**。

**验收标准（均为本地实测结果）**

| 场景 | 请求 | 状态码 | 响应体要点 |
| --- | --- | --- | --- |
| 注册成功 | `POST /auth/register` `{email, password}` | **201** | `UserResponse`（`id` / `email` / `role` / `createdAt`，**不含密码哈希**） |
| 邮箱重复 | 同邮箱再注册 | **409** | `{statusCode:409, message:"Email already registered", error:"Conflict"}` |
| 登录成功 | `POST /auth/login` 正确凭证 | **200** | `TokenResponse`（`accessToken` / `tokenType:"Bearer"` / `expiresIn:3600` / `user`） |
| 密码错误 | `POST /auth/login` 错误密码 | **401** | `{statusCode:401, message:"Invalid email or password", error:"Unauthorized"}` |
| 当前用户 | `GET /auth/me` 带 `Authorization: Bearer <token>` | **200** | `UserResponse` |
| 缺失 token | `GET /auth/me` 无 Authorization 头 | **401** | `{statusCode:401, message:"Missing bearer token", error:"Unauthorized"}` |
| 无效 token | `GET /auth/me` 带非法 token | **401** | `{statusCode:401, message:"Invalid or expired token", error:"Unauthorized"}` |
| 参数校验失败 | 非法 email 或密码过短 | **400** | `message` 为**字符串**（`class-validator` 的多条错误被 `join` 成一个字符串） |
| 多余字段 | 请求体带未声明的字段 | **400** | `{..., message:"property role should not exist", ...}` |

关键点：**错误体统一为契约的 `{statusCode, message, error}`，且 `message` 永远是字符串**——这与 FastAPI 侧 `app/errors.py` 产出的形状一一对应（见 `01-账号与认证/05-FastAPI认证.md`）。

## 2. 前置条件

- 阶段 0 的 **Step 05（NestJS 起步）** 已完成：会写 `@Module` / `@Controller` / `@Injectable`，懂构造函数注入与 `NestFactory` 启动。
- 阶段 0 的 **Step 04（契约包）** 已完成：`@mini-dify/contract` 能编译出 `dist`。
- 阶段 1 的 **01（契约扩展）** 已完成：契约里已有 `RegisterRequest` / `LoginRequest` / `UserResponse` / `TokenResponse` / `ErrorResponse`。
- 阶段 1 的 **02（Prisma）** 已完成：`PrismaService` 可用，`User` 模型已 `migrate` 到 PostgreSQL（`users` 表存在），`apps/api-ts/.env` 的 `DATABASE_URL` 指向本地库。
- 本地 PostgreSQL 容器已启动（`docker compose up -d`）。

> 若 `users` 表不存在，注册会报 500（见 §13 常见坑）。

---

## 3. 先看清要做什么

本阶段在阶段 0「`/health` 最小链路」之上，加入一条**带校验、带鉴权、带统一错误**的认证链路。

```
                     请求进入 Nest 应用
                             │
      ┌──────────────────────┼───────────────────────────────┐
      │ 1) Guard（只有 /auth/me）                              │
      │    JwtAuthGuard.canActivate()                         │
      │    读 Authorization: Bearer <jwt> → 验签 → 写入 request.user │
      ├───────────────────────────────────────────────────────┤
      │ 2) Pipe（有 @Body 的接口）                             │
      │    ValidationPipe → 按 DTO 的 class-validator 装饰器校验  │
      │    非法 → 抛 BadRequestException(400)                  │
      ├───────────────────────────────────────────────────────┤
      │ 3) Controller  AuthController                         │
      │    @Body() dto / @CurrentUser() payload               │
      ├───────────────────────────────────────────────────────┤
      │ 4) Service  AuthService                               │
      │    register: 查重 → bcrypt 哈希 → 入库                  │
      │    login:    查用户 → 比对哈希 → 签发 JWT               │
      │    findById: 按 id 取用户                              │
      └───────────────────────────────────────────────────────┘
                             │
              ┌──────────────┴───────────────┐
              │ 成功：返回契约结构 JSON          │
              │ 失败：抛 HttpException          │
              │   → 全局 HttpErrorFilter 归一化  │
              │     → {statusCode, message, error}│
              └──────────────────────────────┘
```

一句话概括四件事：

1. **DTO + ValidationPipe** 负责「进来的数据对不对」。
2. **Guard** 负责「你是谁 / 有没有令牌」。
3. **自定义参数装饰器** 负责「把 Guard 查出来的用户交给控制器」。
4. **异常过滤器** 负责「出错时回给前端什么形状」。

> 这四件事的**执行顺序**是 NestJS 固定的：请求依次经过 **Middleware → Guard → Interceptor → Pipe → Controller → Service**，而**异常过滤器**是兜底：任何环节抛出的 `HttpException` 最终都由它来写响应。

---

## 4. 命令清单（逐条说明）

> 除「实测接口」外，其余命令均在**仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm dev:api-ts` | 仓库根 | 先编译契约，再以 watch 模式启动 NestJS（`:3001`） | 末尾打印 `api-ts listening on http://localhost:3001` |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 用 `nest build` 编译到 `dist` | 产出 `apps/api-ts/dist/main.js` 等 |
| `pnpm --filter @mini-dify/api-ts start` | 仓库根 | 直接运行**编译产物**（等价于在 `apps/api-ts` 目录执行 `node dist/main.js`） | 同上；**cwd 是 `apps/api-ts`，会读到 `apps/api-ts/.env`** |
| 注册 / 登录 / `/me` 请求 | 任意目录 | 验证三个接口与错误 | 见 §12 |

> **为什么强调「在哪执行」**：`main.ts` 第一行是 `import 'dotenv/config'`，`dotenv` 从**进程当前工作目录**读取 `.env`。
> - `pnpm --filter @mini-dify/api-ts start` 会把工作目录切到 `apps/api-ts`，因此读到 `apps/api-ts/.env`。
> - **老坑已消除**：本项目已把配置拆成「每个 app 自包含」——`apps/api-ts/.env` 与 `apps/api-py/.env` 各存各的；仓库根 `.env` **只留 `POSTGRES_*`** 基础设施变量，不再含任何 `DATABASE_URL`。所以从别的目录启动也不会再读到另一种语言的连接串（原「根 `.env` 的 `DATABASE_URL` 是 `postgresql+psycopg://...`、Prisma 不认」的问题不复存在）。

---

## 5. 完整代码

> 以下文件均为 `apps/api-ts` 侧当前**完整内容**（逐字照抄）。

### 5.1 认证模块（auth.module.ts）

**完整文件路径：`apps/api-ts/src/auth/auth.module.ts`**

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

**说明**

- `@Module` / `imports` / `controllers` / `providers` 的机制见 `00-项目初始化/05-NestJS起步.md`，此处只补两点新东西：
  - `JwtModule.register({...})`：注册一个**带配置的 JWT 模块**，它 `exports` 出 `JwtService`，供本模块的 `AuthService` / `JwtAuthGuard` 注入。`secret` 即签名密钥；`signOptions.expiresIn` 从 `JWT_EXPIRES_IN`（**秒**）读取，默认 `3600`，让签发的令牌按该时长过期。
  - `providers: [JwtAuthGuard]`：Guard 也可以是 Provider，这样它才能**在构造函数里注入** `JwtService`（见 §8）。
- `PrismaService` 来自**全局模块** `PrismaModule`（见 `01-账号与认证/02-Prisma.md`），所以这里不写 import 也能注入。

### 5.2 注册 DTO（dto/register.dto.ts）

**完整文件路径：`apps/api-ts/src/auth/dto/register.dto.ts`**

```ts
import { IsEmail, IsString, MinLength } from 'class-validator'

/** POST /auth/register 请求体 —— 对应契约 `RegisterRequest`。 */
export class RegisterDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  password!: string
}
```

### 5.3 登录 DTO（dto/login.dto.ts）

**完整文件路径：`apps/api-ts/src/auth/dto/login.dto.ts`**

```ts
import { IsEmail, IsString } from 'class-validator'

/** POST /auth/login 请求体 —— 对应契约 `LoginRequest`。 */
export class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  password!: string
}
```

> 注意两处细节：
> - `password!: string` 末尾的 `!` 是 TS 的**非空断言**：告诉编译器「这个字段运行时一定会被赋值」。DTO 的字段由 `ValidationPipe` 在运行期填充，源码里没有构造函数赋值，不加 `!` 会因 `strict` 报错。
> - **为什么需要 DTO**：契约里的 `RegisterRequest` 只是 TS `interface`（编译期擦除，见 `00-项目初始化/04-...`），**不能**在运行期校验请求体。DTO 是**类**（运行期真实存在），配合装饰器才能校验。这正是本篇 §6 要讲的核心。

### 5.4 自定义参数装饰器（current-user.decorator.ts）

**完整文件路径：`apps/api-ts/src/auth/current-user.decorator.ts`**

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { JwtPayload } from './jwt-auth.guard'

/** 取出 `JwtAuthGuard` 写入 `request.user` 的 payload。 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>()
  return request.user
})
```

### 5.5 JWT 守卫（jwt-auth.guard.ts）

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

### 5.6 全局异常过滤器（common/http-error.filter.ts）

**完整文件路径：`apps/api-ts/src/common/http-error.filter.ts`**

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common'
import type { Response } from 'express'

const REASON_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
}

/**
 * 把 NestJS 默认错误体归一化成契约要求的 `ErrorResponse`。
 *
 * 关键点：ValidationPipe 产出的 `message` 是**字符串数组**，而契约要求是**字符串**；
 * 这里统一 join 成字符串，保证与 FastAPI 侧（`app/errors.py`）产出的形状一致。
 */
@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const statusCode = exception.getStatus()
    response.status(statusCode).json({
      statusCode,
      message: this.extractMessage(exception),
      error: REASON_PHRASES[statusCode] ?? 'Error',
    })
  }

  private extractMessage(exception: HttpException): string {
    const body: unknown = exception.getResponse()
    if (typeof body === 'string') {
      return body
    }
    if (typeof body === 'object' && body !== null) {
      const message: unknown = (body as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
      if (Array.isArray(message)) {
        return message.map(String).join('; ')
      }
    }
    return exception.message
  }
}
```

### 5.7 认证服务（auth.service.ts）

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

### 5.8 认证控制器（auth.controller.ts）

**完整文件路径：`apps/api-ts/src/auth/auth.controller.ts`**

```ts
import { Body, Controller, Get, HttpCode, Post, UnauthorizedException, UseGuards } from '@nestjs/common'
import type { TokenResponse, UserResponse } from '@mini-dify/contract'

import { AuthService } from './auth.service'
import { CurrentUser } from './current-user.decorator'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { JwtAuthGuard, type JwtPayload } from './jwt-auth.guard'

/** 契约见 packages/contract/openapi.yaml 的 `/auth/*`。 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<UserResponse> {
    return this.authService.register(dto.email, dto.password)
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<TokenResponse> {
    return this.authService.login(dto.email, dto.password)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() payload: JwtPayload): Promise<UserResponse> {
    const user = await this.authService.findById(payload.sub)
    // 用户已被删除等情况，视为未认证
    if (user === null) {
      throw new UnauthorizedException('User no longer exists')
    }
    return user
  }
}
```

**为什么有 `@HttpCode(200)`**：NestJS 里 `@Post` 默认返回 **201 Created**；但契约要求 `POST /auth/login` 返回 **200**（登录不创建资源）。`@HttpCode(200)` 就是显式覆盖这个默认值的装饰器。`register` 保持默认的 201，与契约一致。

### 5.9 启动入口（main.ts）

**完整文件路径：`apps/api-ts/src/main.ts`**

```ts
// 必须最先执行：Prisma 在运行期需要 process.env.DATABASE_URL
import 'dotenv/config'

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { HttpErrorFilter } from './common/http-error.filter'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  // 前端（localhost:3000）与后端（localhost:3001）跨域，阶段 0 直接放开。
  app.enableCors({ origin: true })
  // 全局校验管道：让 class-validator 装饰器生效，并把校验错误统一成 400。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  // 把错误体归一化成契约的 { statusCode, message, error }（message 统一为字符串）。
  app.useGlobalFilters(new HttpErrorFilter())
  await app.listen(3001)
  // eslint-disable-next-line no-console
  console.log('api-ts listening on http://localhost:3001')
}

void bootstrap()
```

> 与阶段 0 的 `main.ts` 相比，新增两行：`app.useGlobalPipes(new ValidationPipe({...}))` 与 `app.useGlobalFilters(new HttpErrorFilter())`——它们正是本篇 §7 / §10 的主角。`enableCors` / `listen(3001)` 见 `00-项目初始化/05-NestJS起步.md`。

### 5.10 根模块（app.module.ts）

**完整文件路径：`apps/api-ts/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from './auth/auth.module'
import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
import { PrismaModule } from './prisma/prisma.module'

/**
 * 根模块。阶段 1 加入：
 * - `PrismaModule`（全局数据库访问）
 * - `AuthModule`（注册 / 登录 / 当前用户）
 * 后续阶段会按总纲 §3.2 依次加入 Apps / Workflow / Agent 等模块。
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

### 5.11 本地环境变量（apps/api-ts/.env）

**完整文件路径：`apps/api-ts/.env`**

```dotenv
# api-ts 本地环境（Prisma CLI 与运行时都会读取本目录的 .env）
# 注意：Prisma 使用 postgresql:// 方案，不带 SQLAlchemy 的 +driver 后缀
DATABASE_URL="postgresql://postgres:difyai123456@localhost:5432/minidify"
# 与 apps/api-py/.env 同值：双方签发的 JWT 才能互认
JWT_SECRET="dev-jwt-secret-change-me-please"
# 令牌有效期（秒）；两端读同一个键
JWT_EXPIRES_IN=3600
PORT=3001
```

> `JWT_SECRET` 必须与 `apps/api-py/.env` 侧**同值**（那里也读同一个键 `JWT_SECRET`），否则两套后端签发的令牌**无法互相验证**（见 `01-账号与认证/06-JWT与密码哈希.md` 与 07 验收）。
> `JWT_EXPIRES_IN` 是**两端共用的有效期键（秒）**：TS 侧 `auth.module.ts` 的 `signOptions` 与 `AuthService` 的 `ACCESS_TOKEN_EXPIRES_IN`、Python 侧 `config.py` 的 `access_token_expires_in` 都读它。
> `DATABASE_URL` 分两种写法：**Prisma 用 `postgresql://`**（无 `+driver`）；**SQLAlchemy 用 `postgresql+psycopg://`**。这正是 TS 侧、Py 侧**各自自包含一份 `.env`** 的原因（仓库根 `.env` 只留 `POSTGRES_*`）。

### 5.12 依赖变化（package.json）

**完整文件路径：`apps/api-ts/package.json`**

阶段 1 在本篇用到的、阶段 0 没有的依赖有（`dependencies` 中）：

```json
"@nestjs/jwt": "^11.0.0",
"bcryptjs": "^2.4.3",
"class-transformer": "^0.5.1",
"class-validator": "^0.14.1"
```

- `class-validator` / `class-transformer`：DTO 校验与对象转换（本篇 §6 / §7）。
- `@nestjs/jwt`：签发 / 校验 JWT（算法细节见 `01-账号与认证/06-...`）。
- `bcryptjs`：密码哈希（同上）。
- 完整 `package.json`（含 `@prisma/client` / `prisma` 等）见 `00-项目初始化/05-NestJS起步.md` §5.1，此处不重抄。

---

## 6. 【技术教学 · 首次】DTO 与 `class-validator`

### 6.1 是什么

**DTO（Data Transfer Object，数据传输对象）**：一个**专门用来描述「某接口请求体 / 响应体形状」的类**。

在 NestJS 惯例里，它是一张「**请求数据的收货单**」：类里的每个字段就是允许出现的字段，字段上的装饰器就是「该字段必须满足什么规则」。

**`class-validator`** 是一个**基于装饰器**的运行期校验库：你在字段上贴 `@IsEmail()`、`@MinLength(8)`，它就能在运行期检查传入对象是否满足。

### 6.2 为什么需要它（呼应阶段 0 的悬念）

回顾 `00-项目初始化/04-契约包与TypeScript类型.md` 的核心结论：

> TS 的 `interface` / `type` **编译后被完全擦除**，运行期不存在；因此**不能用它来校验外部传入的数据**（如 HTTP 请求体）。

也就是说，契约里的 `RegisterRequest` 只是**编译期约束**，运行时**帮不上忙**——有人 `POST` 一个 `{ email: 123, password: "" }`，TS 一个字都不会拦。

`class-validator` 正是来补这个缺口的：**把契约类型改写成「类 + 装饰器」**，就得到了一个运行期真实存在、可被程序读取规则的对象。

```
契约（编译期）            运行期校验（class-validator）
RegisterRequest    ─▶    class RegisterDto { @IsEmail() email; @MinLength(8) password }
（擦除，管不了运行时）        （真实存在，能拒绝脏数据）
```

> 对照 Python：Pydantic 的 `BaseModel` **既是类型也是运行期校验器**。TS 侧类型与校验器是**两样东西**，要靠 `class-validator` 显式补上——这是两种语言在本项目里最本质的差异之一（详见 `lang-diff/01-账号与认证.md`）。

### 6.3 基本语法

```ts
import { IsEmail, IsString, MinLength } from 'class-validator'

class RegisterDto {
  @IsEmail()          // 装饰器：该字段必须是合法邮箱
  email!: string

  @IsString()         // 必须是字符串
  @MinLength(8)       // 且长度 ≥ 8
  password!: string
}
```

- 每个装饰器都是一条**校验规则**；字段可以贴多条，**全部通过**才算合法。
- 校验由 `ValidationPipe` 在**请求到达控制器之前**执行（§7）。

### 6.4 本项目的 DTO 与契约的对应

| 本项目 | 契约（`openapi.yaml`） | 规则来源 |
| --- | --- | --- |
| `RegisterDto.email` `@IsEmail()` | `RegisterRequest.email` `format: email` | 一一对应 |
| `RegisterDto.password` `@MinLength(8)` | `RegisterRequest.password` `minLength: 8` | 一一对应 |
| `LoginDto.email` `@IsEmail()` | `LoginRequest.email` `format: email` | 一一对应 |
| `LoginDto.password` `@IsString()` | `LoginRequest.password`（无长度限制） | 登录只要求非空字符串 |

> **契约与校验规则必须一致**：改了 `openapi.yaml` 的 `minLength`，就要同步改 `@MinLength`（以及 FastAPI 侧的 `Field(min_length=8)`），否则两套后端行为会漂移。

### 6.5 常用装饰器速查

| 装饰器 | 含义 |
| --- | --- |
| `@IsString()` | 必须是字符串 |
| `@IsEmail()` | 必须是合法邮箱格式 |
| `@MinLength(n)` / `@MaxLength(n)` | 长度 ≥ n / ≤ n |
| `@IsInt()` / `@IsBoolean()` | 整数 / 布尔 |
| `@IsOptional()` | 允许缺失（否则缺失即报错） |
| `@IsIn(['admin','member'])` | 取值必须在给定集合内 |

> 本项目 DTO 只用到 `@IsEmail` / `@IsString` / `@MinLength`，够用即可；更多规则按需要查文档加。

---

## 7. 【技术教学 · 首次】`ValidationPipe`

### 7.1 是什么

**Pipe（管道）** 是 NestJS 的「**数据加工 / 校验**」环节：请求参数在**交给控制器方法之前**，先流经 Pipe。

`ValidationPipe` 是 Nest 内置的一个 Pipe，作用有二：

1. 按参数的类型（这里是 DTO 类）读取其 `class-validator` 装饰器，**校验**并**转换**数据。
2. 校验失败时，**抛 `BadRequestException`（400）**。

### 7.2 基本用法：全局启用

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
```

`useGlobalPipes` 把 Pipe **注册到整个应用**，于是**每个**带 `@Body()` / `@Query()` / `@Param()` 的接口都自动受校验保护，不用逐个接口写。

### 7.3 三个选项的含义（含实测效果）

| 选项 | 含义 | 本项目的实测表现 |
| --- | --- | --- |
| `whitelist: true` | **白名单**：请求体里**未在 DTO 中声明**的字段会被**剥掉** | 安全：多余字段不会进入业务代码 |
| `forbidNonWhitelisted: true` | 与 `whitelist` 搭配：多余字段**不再静默剥掉，而是直接报 400** | 实测 `{"message":"property role should not exist"}` |
| `transform: true` | 把请求体**转换成 DTO 类的实例**（并做类型转换，如字符串 → 数字） | 让我们能在管道内拿到真正的 `RegisterDto` 实例 |

> `whitelist` 与 `forbidNonWhitelisted` 的差别：只开 `whitelist` 是「**悄悄丢掉**多余字段」；两者都开才是「**多余字段直接报错**」。本项目契约里 `additionalProperties: false`（见 `01-账号与认证/01-...`），所以选择**报错**，与契约语义一致。

### 7.4 Pipe 怎么知道用哪个 DTO 校验？

靠**参数的类型元数据**：

```ts
register(@Body() dto: RegisterDto): Promise<UserResponse> { ... }
```

`tsconfig` 的 `emitDecoratorMetadata: true`（见 `00-项目初始化/05-NestJS起步.md`）让编译期把「`dto` 的类型是 `RegisterDto`」写进元数据；`ValidationPipe` 在运行期读到它，就按 `RegisterDto` 的装饰器去校验。

### 7.5 校验失败为什么是 400，且 `message` 是数组？

`ValidationPipe` 把**所有**不通过的规则收集成**字符串数组**，塞进 `BadRequestException` 的响应体。默认形状是：

```json
{
  "statusCode": 400,
  "message": ["email must be an email", "password must be longer than or equal to 8 characters"],
  "error": "Bad Request"
}
```

注意 **`message` 是数组**——而契约要求它是**字符串**。这正是 §10 的异常过滤器存在的理由：它把数组 `join('; ')` 成一个字符串。实测归一化后：

```json
{"statusCode":400,"message":"email must be an email; password must be longer than or equal to 8 characters","error":"Bad Request"}
```

---

## 8. 【技术教学 · 首次】Guard（守卫）与 `CanActivate`

### 8.1 是什么

**Guard（守卫）** 是 NestJS 的「**准入检查**」环节：请求在抵达 Pipe / Controller **之前**，先由 Guard 决定**放不放行**。

典型用途就是**鉴权**：「有没有带有效令牌？没有就挡在门外。」

### 8.2 基本语法：`CanActivate` 接口

一个 Guard 就是一个实现了 `CanActivate` 接口的类，核心方法是 `canActivate`：

```ts
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'

@Injectable()
export class MyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // 返回 true  → 放行
    // 返回 false → 抛 403 Forbidden
    // 直接 throw HttpException → 用你抛的状态码
    return true
  }
}
```

结果有三种：

| 返回 / 行为 | 效果 |
| --- | --- |
| `true` | 放行，请求继续往下走 |
| `false` | 自动抛 `ForbiddenException`（**403**） |
| `throw new UnauthorizedException(...)` | 抛你指定的异常（本项目用这个，返回 **401**） |

### 8.3 本项目：`JwtAuthGuard`

```ts
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

逐步拆解：

1. `context.switchToHttp().getRequest()`：从执行上下文里**取出 HTTP 请求对象**（`express` 的 `Request`）。
2. `header.slice(7)`：`'Bearer '` 正好 7 个字符，切掉前缀拿到裸 token。没用 `Bearer ` 前缀就视为「缺失」。
3. 缺失 → `throw UnauthorizedException('Missing bearer token')` → 401。
4. `jwtService.verify<JwtPayload>(token)`：**验签 + 检查过期**；成功返回载荷。
5. 把载荷**挂到 `request.user`**——这是给 §9 的 `@CurrentUser()` 取用的「交接点」。
6. 验签抛错（签名不对 / 过期 / 格式非法）→ `throw UnauthorizedException('Invalid or expired token')` → 401。

> **为什么 Guard 要贴 `@Injectable()` 并且登记进 `providers`**：它要在构造函数里注入 `JwtService`，所以必须由 IoC 容器创建（`00-项目初始化/05-NestJS起步.md` §7）。`auth.module.ts` 的 `providers: [AuthService, JwtAuthGuard]` 就是为此。

### 8.4 怎么挂到路由上：`@UseGuards`

```ts
@Get('me')
@UseGuards(JwtAuthGuard)
async me(@CurrentUser() payload: JwtPayload): Promise<UserResponse> { ... }
```

`@UseGuards(JwtAuthGuard)` 把守卫挂在**这一个**路由上：请求必须先过 `JwtAuthGuard`，才轮到 `me()`。

- 它也可以贴在**控制器类**上（对该控制器所有路由生效），或通过 `app.useGlobalGuards(...)` 全局生效。
- 本项目只有 `/auth/me` 需要鉴权，所以精确地贴在单个方法上。

### 8.5 执行顺序

NestJS 请求生命周期是固定的：

```
中间件 Middleware → 守卫 Guard → 拦截器 Interceptor → 管道 Pipe → 控制器 Controller → 服务 Service →（响应）
                                        异常过滤器 ExceptionFilter：全程兜底
```

所以对 `/auth/me`：**先 Guard（验令牌），再进控制器**。若令牌无效，请求**根本到不了** `me()`。

---

## 9. 【技术教学 · 首次】自定义参数装饰器 `@CurrentUser`

### 9.1 是什么

NestJS 提供了一批**内置参数装饰器**，用来从请求里「取东西」：

| 内置装饰器 | 取什么 |
| --- | --- |
| `@Body()` | 请求体 |
| `@Query()` | 查询串 |
| `@Param()` | 路径参数 |
| `@Headers()` | 请求头 |
| `@Req()` / `@Res()` | 原生请求 / 响应对象 |

**自定义参数装饰器**则是你自己造一个「取件方式」。本项目要「取当前登录用户」，于是造了 `@CurrentUser()`。

### 9.2 基本语法：`createParamDecorator`

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>()
    return request.user
  },
)
```

- `createParamDecorator(factory)`：传入一个**工厂函数**，返回一个装饰器。
- 工厂函数两个参数：
  - `data`：装饰器**被使用时传的参数**（如 `@CurrentUser('sub')` 里的 `'sub'`）。本项目不用（写作 `_data`），直接返回整个 payload。
  - `ctx`：`ExecutionContext`，与 Guard 里那个**是同一个类型**。
- 返回值即**注入给方法参数的值**。

### 9.3 本项目用法

```ts
async me(@CurrentUser() payload: JwtPayload): Promise<UserResponse> {
  const user = await this.authService.findById(payload.sub)
  ...
}
```

`payload` 就是 Guard 写入 `request.user` 的那份 JWT 载荷（`{ sub, role }`），所以能直接 `payload.sub` 拿用户 id。

### 9.4 `ExecutionContext` 是什么

**`ExecutionContext`（执行上下文）** 是 NestJS 对「**本次请求发生在什么环境里**」的统一抽象——HTTP、RPC、WebSocket 都可能。`ctx.switchToHttp()` 切到 HTTP 视角，`.getRequest()` 拿到原生请求。

> 因为 Guard、拦截器、过滤器、参数装饰器都拿 `ExecutionContext`，所以它们能**通用**：同一份 `JwtPayload` 类型、同一个 `request.user` 交接点，在守卫里写、在装饰器里读。

### 9.5 为什么用装饰器而不是直接在控制器里拿 `req`

```ts
// ❌ 控制器直接依赖 express 请求对象，耦合、难测试
me(@Req() req: Request) { const payload = req.user; ... }

// ✅ 用一个语义化装饰器，控制器只关心「我要当前用户」
me(@CurrentUser() payload: JwtPayload) { ... }
```

好处：控制器**不依赖 express 细节**，语义清晰；「用户怎么来的」这件事被封装在 `@CurrentUser()` 里。

---

## 10. 【技术教学 · 首次】异常过滤器（`@Catch` / `ExceptionFilter`）

### 10.1 是什么

**异常过滤器（Exception Filter）** 是 NestJS 的「**兜底错误处理**」环节：**任何**环节（Guard / Pipe / Controller / Service）抛出的异常，最终都会被过滤器接管，由它决定**写回什么样的响应体**。

Nest 有**默认**过滤器，但它产出的 `message` 可能是**数组**（§7.5）；本项目需要把它**归一化成契约的字符串形状**，于是自定义了一个。

### 10.2 基本语法

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common'

@Catch(HttpException)                 // 只捕获 HttpException（及其子类）
export class MyFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse()
    res.status(exception.getStatus()).json({ ... })
  }
}
```

- `@Catch(类型)`：声明「本过滤器只管哪一类异常」。`@Catch(HttpException)` 覆盖 `BadRequestException` / `UnauthorizedException` / `ConflictException` 等**全部** Nest 内置 HTTP 异常（它们都继承自 `HttpException`）。
- `ArgumentsHost`：与 `ExecutionContext` 类似的「环境抽象」，`.switchToHttp().getResponse()` 拿到响应对象。
- `exception.getStatus()`：取状态码；`exception.getResponse()`：取异常携带的响应体。

### 10.3 本项目：`HttpErrorFilter`

```ts
@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const statusCode = exception.getStatus()
    response.status(statusCode).json({
      statusCode,
      message: this.extractMessage(exception),
      error: REASON_PHRASES[statusCode] ?? 'Error',
    })
  }

  private extractMessage(exception: HttpException): string { /* 见 §5.6：把 message 收敛成字符串 */ }
}
```

**核心工作**：把各种来源的 `message` **统一收敛为字符串**。

`extractMessage` 的分支：

| `exception.getResponse()` 的形状 | 处理 | 场景 |
| --- | --- | --- |
| `string` | 直接返回 | 最简形式 |
| `{ message: string }` | 返回该字符串 | `new ConflictException('Email already registered')` |
| `{ message: string[] }` | `join('; ')` 成字符串 | **`ValidationPipe` 的多条校验错误** |
| 其它 | 回退到 `exception.message` | 兜底 |

> 实测印证：`new ConflictException('Email already registered')` 本已是 `message` 字符串，而 `ValidationPipe` 的 `message` 是数组——过滤器把后者 `join` 成 `"email must be an email; password must be longer than or equal to 8 characters"`。

### 10.4 与 FastAPI 侧的对应

契约 `ErrorResponse` 只认 `{statusCode, message, error}` 一种形状。两套后端都要**归一化**：

- **NestJS**：默认形状已接近契约，只差把 `message` 从数组收敛为字符串 → 用本过滤器。
- **FastAPI**：默认是 `{detail: ...}`，与契约完全不同 → 需要 `app/errors.py` 显式改写成同一形状（见 `01-账号与认证/05-FastAPI认证.md`）。

这正是「**契约一致」的第二层（值规范一致）**——不仅字段名要对，`message` 的类型也要对（`00-项目初始化/08-验收.md`）。

### 10.5 怎么启用

```ts
app.useGlobalFilters(new HttpErrorFilter())
```

`useGlobalFilters` 把过滤器注册到**整个应用**。这里直接 `new` 一个实例传入——本过滤器不依赖任何 Provider，**无需**走依赖注入。

---

## 11. 【技术教学 · 首次】服务层认证编排

> 这里讲的是「**流程怎么串**」。bcrypt 怎么算、JWT 怎么签的**算法细节**放到 `01-账号与认证/06-JWT与密码哈希.md`（那是 JWT/bcrypt 的首次教学篇）。

### 11.1 注册：查重 → 哈希 → 入库

```ts
async register(email: string, password: string): Promise<UserResponse> {
  const existing = await this.prisma.user.findUnique({ where: { email } })
  if (existing !== null) {
    throw new ConflictException('Email already registered')   // → 409
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)   // 成本因子 10
  const user = await this.prisma.user.create({
    data: { email, passwordHash, role: 'member' },
  })
  return this.toUserResponse(user)
}
```

三步：

1. **查重**：`findUnique({ where: { email } })`；已有 → 抛 `ConflictException`（**409**，与契约一致）。
2. **哈希**：`bcrypt.hash(password, 10)`——**绝不明文存密码**。成本因子 `10` 与 Python 侧一致，故两库哈希可互相校验。
3. **入库**：`create`，`role` 固定 `'member'`（契约 `UserResponse.role ∈ {admin, member}`）。

### 11.2 登录：比对哈希 → 签发 JWT

```ts
async login(email: string, password: string): Promise<TokenResponse> {
  const user = await this.prisma.user.findUnique({ where: { email } })
  // 统一报同一个错误，避免泄露「邮箱是否存在」
  if (user === null || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new UnauthorizedException('Invalid email or password')   // → 401
  }
  const accessToken = await this.jwtService.signAsync({ sub: user.id, role: user.role })
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    user: this.toUserResponse(user),
  }
}
```

- **合并判断**：`user === null || 密码不匹配` → 都用**同一个** `401` 和**同一句**提示。这是**安全实践**：若「邮箱不存在」与「密码错误」返回不同结果，攻击者就能**枚举**出哪些邮箱已注册。
- **签发**：`signAsync({ sub: user.id, role: user.role })`——载荷里 `sub` 是用户 id、`role` 是角色（两套后端约定一致，见 `jwt-auth.guard.ts` 的 `JwtPayload`）。`JwtModule.register` 的 `secret` / `expiresIn` 自动生效。
- **返回**：`TokenResponse` 的 `expiresIn` 是**秒**（`3600`），取自与 `JwtModule` 同一个 `JWT_EXPIRES_IN`，故与签发时用的有效期恒等。

### 11.3 `/me`：从令牌取用户

```ts
@Get('me')
@UseGuards(JwtAuthGuard)
async me(@CurrentUser() payload: JwtPayload): Promise<UserResponse> {
  const user = await this.authService.findById(payload.sub)
  if (user === null) {
    throw new UnauthorizedException('User no longer exists')
  }
  return user
}
```

- Guard 先验令牌（§8），`@CurrentUser()` 取出载荷（§9），用 `payload.sub` 查库。
- **即便令牌有效，用户也可能已被删除**——所以再查一次库；查不到视为未认证（401）。

### 11.4 视图映射：`toUserResponse`

```ts
private toUserResponse(user: { id: string; email: string; role: string; createdAt: Date }): UserResponse {
  return {
    id: user.id,
    email: user.email,
    role: user.role as UserResponse['role'],
    createdAt: user.createdAt.toISOString(),
  }
}
```

- **只挑契约要的字段**——尤其**绝不返回 `passwordHash`**，这是硬性安全要求。
- `createdAt` 是 `Date`，用 `toISOString()` 转成契约要求的 ISO-8601 字符串（`00-项目初始化/08-验收.md` 的 UTC 归一化）。
- `role` 从库里是 `string`，**断言**为契约的字面量联合 `UserResponse['role']`（`'admin' | 'member'`）。

---

## 12. 验收自测

前提：`pnpm dev:api-ts` 已启动（打印 `api-ts listening on http://localhost:3001`）。

### 12.1 PowerShell（推荐，避免引号问题）

> Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的**别名**；且 PS 5 把 JSON 传给 `curl.exe` 时会**吞掉内部双引号**，所以推荐用 `Invoke-RestMethod`。

```powershell
$base = 'http://localhost:3001'
$email = "demo$(Get-Random)@example.com"      # 每次换新邮箱，避免撞 409

# 1) 注册 → 201
$reg = Invoke-RestMethod -Method Post -Uri "$base/auth/register" `
  -ContentType 'application/json' `
  -Body (@{ email = $email; password = 'secret123' } | ConvertTo-Json)
$reg            # 期望：id / email / role=member / createdAt（无 passwordHash）

# 2) 登录 → 200
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email = $email; password = 'secret123' } | ConvertTo-Json)
$login.accessToken; $login.expiresIn   # 期望：JWT 字符串；3600

# 3) 当前用户 → 200
Invoke-RestMethod -Uri "$base/auth/me" -Headers @{ Authorization = "Bearer $($login.accessToken)" }
```

**查看错误体（PS 5 用 `$_.ErrorDetails.Message`）**：

```powershell
function Show-Err($method, $path, $body) {
  try {
    Invoke-RestMethod -Method $method -Uri "http://localhost:3001$path" -ContentType 'application/json' -Body $body
  } catch {
    Write-Output ("HTTP " + [int]$_.Exception.Response.StatusCode + " " + $_.ErrorDetails.Message)
  }
}
Show-Err Post '/auth/register' (@{ email = 'bad'; password = '123' } | ConvertTo-Json)   # 400 + message 字符串
Show-Err Post '/auth/login' (@{ email = 'nobody@example.com'; password = 'whatever1' } | ConvertTo-Json) # 401
```

**实测输出（错误体形状）**

```
HTTP 401 {"statusCode":401,"message":"Invalid email or password","error":"Unauthorized"}
HTTP 400 {"statusCode":400,"message":"email must be an email; password must be longer than or equal to 8 characters","error":"Bad Request"}
```

### 12.2 curl（cmd / Git Bash 可用；PowerShell 请用 `curl.exe` 并给 JSON 加转义）

```bash
# 注册 → 201
curl -i -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo1@example.com","password":"secret123"}'

# 重复注册 → 409
curl -i -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo1@example.com","password":"secret123"}'

# 登录 → 200（拿到 accessToken）
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo1@example.com","password":"secret123"}'

# 当前用户 → 200
curl -i http://localhost:3001/auth/me -H "Authorization: Bearer <粘贴上一步的 accessToken>"

# 无令牌 → 401
curl -i http://localhost:3001/auth/me

# 参数校验失败 → 400（message 是字符串）
curl -i -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" -d '{"email":"bad","password":"123"}'
```

### 12.3 逐项核对表

| 检查项 | 命令 / 操作 | 预期 |
| --- | --- | --- |
| 注册成功 | `POST /auth/register` 新邮箱 | **201**，`UserResponse`，**无密码哈希** |
| 邮箱重复 | 同邮箱再注册 | **409**，`message:"Email already registered"` |
| 登录成功 | `POST /auth/login` 正确密码 | **200**，`tokenType:"Bearer"`、`expiresIn:3600`、含 `user` |
| 密码错误 | 错误密码 | **401**，`message:"Invalid email or password"` |
| 多余字段 | 注册带 `role` | **400**，`message:"property role should not exist"` |
| 校验失败 | 非法邮箱 / 短密码 | **400**，`message` 为**字符串**（多条以 `; ` 连接） |
| 带令牌取用户 | `GET /auth/me` + `Bearer <token>` | **200**，`UserResponse` |
| 无令牌 | `GET /auth/me` 不带头发 | **401**，`message:"Missing bearer token"` |
| 无效令牌 | `GET /auth/me` + 假 token | **401**，`message:"Invalid or expired token"` |
| 错误体形状 | 任一错误响应 | `{statusCode, message(string), error}` 三字段齐全 |

---

## 13. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **在仓库根直接 `node apps/api-ts/dist/main.js`** | 曾报 Prisma 无法解析 `DATABASE_URL`（形如 `postgresql+psycopg://...`） | 老坑，**已消除**：配置拆成「每个 app 自包含」——仓库根 `.env` 只留 `POSTGRES_*`、不再有 `DATABASE_URL`，连接串只在 `apps/api-ts/.env`。仍推荐在 `apps/api-ts` 目录运行或用 `pnpm --filter @mini-dify/api-ts start`（cwd 会设为 `apps/api-ts`，读到正确的 `.env`） |
| **`JWT_SECRET` 未加载 / 两后端不一致** | 令牌验不过，或 TS 与 Py 互相不认 | `main.ts` 里 `import 'dotenv/config'` **必须排在所有 import 最前**（`auth.module.ts` 在模块加载时就读 `process.env.JWT_SECRET`）。且 `apps/api-ts/.env` 与 `apps/api-py/.env` 的 `JWT_SECRET` 必须同值 |
| **`users` 表不存在** | 注册报 **500** | 没执行 Prisma `migrate`（见 `01-账号与认证/02-Prisma.md`）。先在 `apps/api-ts` 目录跑迁移 |
| **忘了 `useGlobalPipes`** | 脏数据没被拦，甚至进 service 后报 500 | `main.ts` 少了 `app.useGlobalPipes(new ValidationPipe(...))` |
| **`message` 是数组** | 前端按契约取 `message` 当字符串时出错 | 未启用 `HttpErrorFilter`；或该异常不是 `HttpException`（过滤器只 `@Catch(HttpException)`） |
| **`/auth/me` 拿到 `undefined`** | `payload.sub` 报错 / 500 | 方法上漏了 `@UseGuards(JwtAuthGuard)` → Guard 没跑 → `request.user` 未写入 |
| **Guard 注入失败** | 报 `Nest can't resolve dependencies of JwtAuthGuard` | 忘了 `@Injectable()`，或没把 `JwtAuthGuard` 登记进 `auth.module.ts` 的 `providers` |
| **注册期望 200 却得 201** | 状态码不符 | Nest 的 `@Post` 默认 **201**；登录用 `@HttpCode(200)` 覆盖，注册保持 201（与契约一致） |
| **PS 里 `curl` 传 JSON 失败** | 返回 400「Expected property name...」 | PowerShell 把 JSON 内层引号处理坏了。用 `Invoke-RestMethod`（或用 body 文件 `curl.exe -d "@file"`），别用裸引号 |
| **`password!: string` 编译报错** | `Property 'password' has no initializer` | DTO 字段运行期才赋值，需加非空断言 `!`（或 `strictPropertyInitialization: false`） |

---

## 14. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **DTO 与 `class-validator`（运行期校验）** | **首次教学于本篇**（补上阶段 0「TS 类型运行期擦除」的缺口） |
| **`ValidationPipe`（`whitelist` / `forbidNonWhitelisted` / `transform`）** | **首次教学于本篇** |
| **Guard 与 `CanActivate` / `@UseGuards`** | **首次教学于本篇** |
| **自定义参数装饰器 `@CurrentUser`（`createParamDecorator` / `ExecutionContext`）** | **首次教学于本篇** |
| **异常过滤器 `@Catch` / `ExceptionFilter` / `ArgumentsHost`（错误信封归一化）** | **首次教学于本篇** |
| **服务层认证编排（查重→哈希→入库 / 比对→签发 / 从载荷取用户）** | **首次教学于本篇**；bcrypt/JWT 算法细节见 `01-账号与认证/06-JWT与密码哈希.md` |
| NestJS 请求生命周期顺序（Guard → Pipe → Controller） | 首次教学于本篇 |
