# 03 · NestJS 注册登录（账号与认证）

> 阶段 1 · 第 3 步
>
> 做完：`POST /auth/register`（201）、`POST /auth/login`（200）、`GET /auth/me`（Bearer）三个接口可用；密码只存 bcrypt 哈希；错误体与契约 `ErrorResponse` 一致；`JWT_SECRET` / `JWT_EXPIRES_IN` 从环境变量读。
>
> **本篇面试考点**：DTO + `ValidationPipe`（`whitelist` / `forbidNonWhitelisted`）· bcrypt 为什么故意慢 · 登录失败为什么统一 401 · JWT 的结构与签名 · Guard vs Middleware · `@HttpCode` 与 201/200 · `createParamDecorator`。

> 上接：`02-Prisma用户表.md` 已经建好 `users` 表和 `PrismaService`。本篇所有代码都在 `apps/api-ts` 里。

---

## 1. 这一篇要写哪些文件

| 文件 | 作用 |
| --- | --- |
| `src/common/is-email.decorator.ts` | 与 Python `EmailStr` 对齐的邮箱校验 |
| `src/common/validation-exception-factory.ts` | 把 class-validator 的错误转成契约的单一字符串 |
| `src/common/http-error.filter.ts` | 把任何 `HttpException` 包成 `{ statusCode, message, error }` |
| `src/auth/dto/register.dto.ts` | 注册请求模型 |
| `src/auth/dto/login.dto.ts` | 登录请求模型 |
| `src/auth/auth.service.ts` | 查重、哈希、比对、签发 JWT |
| `src/auth/jwt-auth.guard.ts` | 解析并校验 `Authorization: Bearer` |
| `src/auth/current-user.decorator.ts` | 从 `request.user` 取 payload |
| `src/auth/auth.controller.ts` | 三个路由 |
| `src/auth/auth.module.ts` | 注册 `JwtModule` 与 provider |
| `src/main.ts` | 挂上全局 `ValidationPipe` 与异常过滤器 |
| `src/app.module.ts` | 引入 `AuthModule` |

顺序就是真实开发顺序：**先让错误体统一 → 再写请求模型 → 再写业务 → 再挂路由 → 最后接模块。**

---

## 2. 先把“校验”和“错误体”这两条地基铺好

NestJS 默认的校验错误长这样：

```json
{
  "statusCode": 400,
  "message": ["email must be an email", "password must be longer than or equal to 8 characters"],
  "error": "Bad Request"
}
```

而契约要求 `message` 是**一个字符串**，且文案要能和 FastAPI 侧逐字节对齐。所以需要两层定制：

- `exceptionFactory`：决定 class-validator 的错误怎么拼成一句话；
- `HttpErrorFilter`：决定最终 JSON 的形状（`statusCode` / `message` / `error`）。

### 2.1 邮箱校验：与 Pydantic 对齐

**完整文件路径：`apps/api-ts/src/common/is-email.decorator.ts`**

```ts
import { buildMessage, isEmail, ValidateBy, type ValidationOptions } from 'class-validator'

/**
 * 邮箱校验：与 Python 侧 Pydantic `EmailStr`（email-validator）对齐。
 *
 * `validator.js` 默认 `require_tld: true` 要求 TLD 至少 2 个字符，会拒绝 `a@b.c`；
 * 而 email-validator 接受单字符 TLD，但要求域名至少含一个点（拒绝 `a@b`）。
 * 这里用 `require_tld: false` + 域名必须含点来对齐两者。
 *
 * 约束名沿用 `isEmail`，故文案与错误映射（error-messages.md）无需调整。
 */
function isEmailAligned(value: unknown): boolean {
  // 非字符串直接判失败：Pydantic 收到数字也会报类型错
  if (typeof value !== 'string') {
    return false
  }
  // 最后一个 @ 之后是域名；邮箱本地部分允许含 @（虽然实际很少见）
  const at = value.lastIndexOf('@')
  if (at < 0) {
    return false
  }
  // 域名必须含点：拒绝 `a@b`，但允许 `a@b.c`
  if (!value.slice(at + 1).includes('.')) {
    return false
  }
  // 关掉 TLD 长度要求，其余规则交给 validator.js
  return isEmail(value, { require_tld: false })
}

/** 对外暴露的装饰器：用法与 class-validator 的 @IsEmail() 相同。 */
export function IsEmailFormat(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      // 名字必须叫 isEmail：validationExceptionFactory 按这个 key 出文案
      name: 'isEmail',
      validator: {
        validate: (value) => isEmailAligned(value),
        // $property 会被 class-validator 替换成字段名
        defaultMessage: buildMessage((eachPrefix) => eachPrefix + '$property must be an email', validationOptions),
      },
    },
    validationOptions,
  )
}
```

> 为什么要自己写：`class-validator` 自带的 `@IsEmail()` 和 Python `EmailStr` 的接受集合不完全一样。契约测试会同时打两套后端，只要有一个边界值判定不同（比如 `a@b.c`）就会红。**跨语言项目里，“两个库默认行为一致”是错觉。**

### 2.2 校验错误 → 单一字符串

**完整文件路径：`apps/api-ts/src/common/validation-exception-factory.ts`**

```ts
import { BadRequestException } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

/**
 * `ValidationPipe.exceptionFactory`：把 class-validator 的 `ValidationError[]`
 * 映射成契约规定的**单一 message 字符串**（见 packages/contract/error-messages.md）。
 *
 * 契约要点：多个错误按字段声明顺序排列、同一字段内按规则顺序排列，用 `"; "` 连接；
 * `statusCode` 仍为 400、`error` 仍为 `Bad Request`（由 HttpErrorFilter 统一包装）。
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  return new BadRequestException(collectMessages(errors).join('; '))
}

/**
 * 递归收集错误文案。
 *
 * 平铺 DTO（如 `/auth`、`/apps` 的请求体）没有子错误，就是逐个 `toMessage`；
 * 嵌套 DTO（如阶段 3 的画布 `Graph`）的父级 `ValidationError` 只带 `children`、
 * 自身无 `constraints`，此时只下钻到叶子，使文案落到具体字段。
 */
function collectMessages(errors: ValidationError[]): string[] {
  const messages: string[] = []
  for (const error of errors) {
    const constraints = error.constraints ?? {}
    // 自身有约束才产出一条文案（父级容器节点会跳过）
    if ('whitelistValidation' in constraints || Object.keys(constraints).length > 0) {
      messages.push(toMessage(error))
    }
    // 有子错误则继续下钻
    if (error.children !== undefined && error.children.length > 0) {
      messages.push(...collectMessages(error.children))
    }
  }
  return messages
}

function toMessage(error: ValidationError): string {
  const field = error.property
  const constraints = error.constraints ?? {}
  const value: unknown = error.value

  // 额外字段（whitelist + forbidNonWhitelisted）
  if ('whitelistValidation' in constraints) {
    return `${field} should not exist`
  }
  // 必填字段缺失：值为 undefined 时，不管哪个规则失败，统一报 required
  if (value === undefined || 'isDefined' in constraints) {
    return `${field} is required`
  }
  // 类型不是字符串（class-validator 的 isString 只在非字符串时失败）
  if ('isString' in constraints) {
    return `${field} must be a string`
  }
  if ('isEmail' in constraints) {
    // email 字段没有 isString 装饰器，非字符串会落到这里
    return typeof value === 'string' ? `${field} must be a valid email` : `${field} must be a string`
  }
  if ('minLength' in constraints) {
    return `${field} must be at least ${firstNumber(constraints.minLength)} characters`
  }
  if ('isLength' in constraints) {
    // @Length(min, max) 的默认文案会按实际越界方向给出「longer」或「shorter」
    const message = constraints.isLength
    if (message.includes('shorter than or equal to')) {
      return `${field} must be at most ${firstNumber(message)} characters`
    }
    return `${field} must be at least ${firstNumber(message)} characters`
  }
  if ('maxLength' in constraints) {
    return `${field} must be at most ${firstNumber(constraints.maxLength)} characters`
  }
  if ('isIn' in constraints) {
    return `${field} must be one of: ${enumValues(constraints.isIn)}`
  }
  // 兜底：契约已覆盖全部规则，正常不应到达
  return `${field} is invalid`
}

/** 取文案中的第一个整数（长度类默认文案里含声明的 N）。 */
function firstNumber(message: string): number {
  const matched = message.match(/\d+/)
  return matched === null ? 0 : Number(matched[0])
}

/** 从 isIn 默认文案里取出枚举值列表，如 "... following values: chatflow, workflow"。 */
function enumValues(message: string): string {
  const marker = 'following values:'
  const index = message.indexOf(marker)
  return index >= 0 ? message.slice(index + marker.length).trim() : message
}
```

### 2.3 最终错误体

**完整文件路径：`apps/api-ts/src/common/http-error.filter.ts`**

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common'
import type { Response } from 'express'

/** 状态码 → 标准短语；契约的 `error` 字段就是它。 */
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
 * 这里再兜一层，保证与 FastAPI 侧（`app/errors.py`）产出的形状一致。
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
    // 直接 `throw new BadRequestException('xxx')` 时 body 是字符串
    if (typeof body === 'string') {
      return body
    }
    if (typeof body === 'object' && body !== null) {
      const message: unknown = (body as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
      // 数组 → 用 "; " 连接（理论上 exceptionFactory 已经拼好了，这里是兜底）
      if (Array.isArray(message)) {
        return message.map(String).join('; ')
      }
    }
    return exception.message
  }
}
```

### 2.4 在入口挂上这两样东西

**完整文件路径：`apps/api-ts/src/main.ts`**

```ts
// 必须放在所有 import 之前：先把 apps/api-ts/.env 注入 process.env
import 'dotenv/config'

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { HttpErrorFilter } from './common/http-error.filter'
import { validationExceptionFactory } from './common/validation-exception-factory'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)

  // 前端 :3000 调后端 :3001，浏览器会做跨域检查；开发阶段直接允许所有来源
  app.enableCors({ origin: true })

  // 全局校验管道：让 DTO 上的 class-validator 装饰器生效
  app.useGlobalPipes(
    new ValidationPipe({
      // 剥掉 DTO 未声明的字段
      whitelist: true,
      // 出现未声明字段时直接 400（而不是静默剥掉）
      forbidNonWhitelisted: true,
      // 把 JSON 里的普通对象转换成 DTO 实例（@Type 等才会生效）
      transform: true,
      // 用自定义工厂替换默认的 message 数组
      exceptionFactory: validationExceptionFactory,
    }),
  )

  // 把错误体归一化成契约的 { statusCode, message, error }
  app.useGlobalFilters(new HttpErrorFilter())

  // 端口优先读环境变量；Number() 把字符串转成数字，默认 3001
  const port = Number(process.env.PORT ?? 3001)
  await app.listen(port)

  console.log(`api-ts listening on http://localhost:${port}`)
}

void bootstrap()
```

> **面试考点 · `ValidationPipe` 的三个开关分别干什么？**
>
> - `whitelist: true`：只保留 DTO 上声明过的字段，其余全部剥掉。
> - `forbidNonWhitelisted: true`：不是剥掉，而是**发现多余字段就报 400**。它对应契约的 `additionalProperties: false`。只开 `whitelist` 会让攻击者多传的 `role: "admin"` 被静默忽略，虽然安全但接口行为不透明；两个一起开，客户端能立刻知道自己传错了。
> - `transform: true`：把 `{"email": "..."}` 这样的普通对象转成 `RegisterDto` 实例，并执行 `@Type(() => Number)` 之类的转换。没有它，方法参数里拿到的是 plain object，`instanceof` 判断会失败。
>
> **追问：class-validator 和前端 Zod、Python Pydantic 有什么区别？**
> 三者都是运行期校验，区别在元数据来源：class-validator 靠**装饰器元数据**（需要 `experimentalDecorators` 与 `emitDecoratorMetadata`），Zod 靠**链式 schema 对象**，Pydantic 靠**类型注解 + 自己的元类**。语义上必须对齐（同样的字段、同样的规则、同样的文案），否则契约测试过不了。

> **面试考点 · 为什么错误体要在 `ExceptionFilter` 里统一，而不是每个 controller 自己 try/catch？**
>
> - 错误体是**契约的一部分**，必须全局一致；散落在 handler 里迟早漏一个。
> - Nest 的内置异常（`NotFoundException`、`UnauthorizedException`…）已经有状态码语义，Filter 只负责“翻译成契约形状”，不重复业务判断。
> - Filter 是请求生命周期的最后一环，能兜住 Guard、Pipe、Handler 抛出的所有 `HttpException`。
>
> **追问：非 `HttpException` 的异常怎么办？**
> 本项目的 `@Catch(HttpException)` 只管业务异常；未捕获的 `Error` 由 Nest 默认处理器变成 500。生产环境应该再注册一个 `@Catch()` 的通配 Filter 记日志并返回脱敏的 500，避免把堆栈泄露给客户端。

---

## 3. 请求模型（DTO）

**完整文件路径：`apps/api-ts/src/auth/dto/register.dto.ts`**

```ts
import { IsString, MinLength } from 'class-validator'

import { IsEmailFormat } from '../../common/is-email.decorator'

/** POST /auth/register 请求体 —— 对应契约 `RegisterRequest`。 */
export class RegisterDto {
  // 邮箱格式与 Python EmailStr 对齐；不写 @IsString，文案由工厂按 isEmail 分支给
  @IsEmailFormat()
  email!: string

  // 类型必须是字符串
  @IsString()
  // 至少 8 位（只有注册校验长度，登录不校验）
  @MinLength(8)
  password!: string
}
```

**完整文件路径：`apps/api-ts/src/auth/dto/login.dto.ts`**

```ts
import { IsString } from 'class-validator'

import { IsEmailFormat } from '../../common/is-email.decorator'

/** POST /auth/login 请求体 —— 对应契约 `LoginRequest`。 */
export class LoginDto {
  // 登录也校验邮箱格式：明显的非法输入没必要进到数据库查询
  @IsEmailFormat()
  email!: string

  // 只校验类型，不校验长度：避免以后改注册规则导致老用户登不进来
  @IsString()
  password!: string
}
```

> `password!: string` 里的 `!` 是**确定赋值断言**：告诉 TypeScript“这个字段运行期一定会被赋值”，因为赋值是 `ValidationPipe` 通过反射 new 实例后做的，编译器看不见。没有 `!` 或初始值，`strictPropertyInitialization` 会报错。
>
> **不要**给 DTO 字段写 `?`：`email?: string` 会让 class-validator 把缺失当成合法，契约里的 `required` 就失效了。

> **面试考点 · DTO 为什么不直接用 `User` 实体 / 契约 interface？**
>
> - 契约 `interface` 在编译后**被擦除**，装饰器无处可挂，运行期一点校验都没有。
> - Prisma 的 `User` 是数据库实体，包含 `passwordHash`；拿它当请求体会带来 mass assignment 风险（客户端多传 `role` 就可能写库）。
> - DTO 是**边界模型**：只声明这个接口允许接收的字段。三种模型（DB 实体 / 契约类型 / DTO）职责不同，不要合并。

---

## 4. 业务层

**完整文件路径：`apps/api-ts/src/auth/auth.service.ts`**

```ts
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { TokenResponse, UserResponse } from '@mini-dify/contract'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'

import { PrismaService } from '../prisma/prisma.service'

// bcrypt 代价因子：2^10 轮。越大越慢越安全，10 是常见的开发/生产折中值
const BCRYPT_ROUNDS = 10
// 与 JwtModule 的 signOptions 读同一个键，保证签发与返回值一致
const ACCESS_TOKEN_EXPIRES_IN = Number(process.env.JWT_EXPIRES_IN ?? 3600) // 秒

@Injectable()
export class AuthService {
  // 构造函数注入：PrismaService 来自全局模块，JwtService 来自 AuthModule 里的 JwtModule
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /** 注册：查重 → 哈希 → 入库 → 转成对外视图。 */
  async register(email: string, password: string): Promise<UserResponse> {
    // 先查一次：给出友好的 409 文案（数据库唯一索引仍然兜底并发）
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing !== null) {
      throw new ConflictException('Email already registered')
    }

    // bcrypt.hash 内部生成随机盐，并把盐一起存进结果字符串
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const user = await this.prisma.user.create({
      // role 显式写 member：不依赖数据库默认值，业务意图更清楚
      data: { email, passwordHash, role: 'member' },
    })

    // 注意：返回的是对外视图，不含 passwordHash
    return this.toUserResponse(user)
  }

  /** 登录：查用户 → 比对密码 → 签发 JWT。 */
  async login(email: string, password: string): Promise<TokenResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } })

    // 统一报同一个错误，避免泄露「邮箱是否存在」
    if (user === null || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password')
    }

    // sub = subject，JWT 标准字段，放用户 id；role 放进来供后续鉴权用
    const accessToken = await this.jwtService.signAsync({ sub: user.id, role: user.role })

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      user: this.toUserResponse(user),
    }
  }

  /** 按 id 查用户；查不到返回 null，由 controller 决定语义（401）。 */
  async findById(id: string): Promise<UserResponse | null> {
    const user = await this.prisma.user.findUnique({ where: { id } })
    return user === null ? null : this.toUserResponse(user)
  }

  /**
   * 数据库实体 → 契约 `UserResponse`。
   *
   * 这是**唯一**允许出现 passwordHash 的地方；出了这个方法就只剩公开字段。
   */
  private toUserResponse(user: {
    id: string
    email: string
    role: string
    createdAt: Date
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      // 数据库存的是 string（见 schema 的取舍），契约收窄成 'admin' | 'member'。
      // 越界值理论上只可能来自手工 SQL，这里用断言把边界收在“出口”一个点上。
      role: user.role as UserResponse['role'],
      // Date → UTC ISO-8601 毫秒字符串（24 字符，以 Z 结尾），与契约要求一致
      createdAt: user.createdAt.toISOString(),
    }
  }
}
```

> **面试考点 · 密码为什么不能用 MD5/SHA-256？bcrypt 到底慢在哪？**
>
> - MD5/SHA 是**通用哈希**，设计目标是快。现代 GPU 每秒能算几十亿次，拿常见密码字典暴力破解成本极低。
> - bcrypt 是**口令哈希**，内部是可调轮数的 Blowfish：`cost=10` 意味着约 `2^10` 轮迭代，单次耗时几十毫秒。攻击者每次尝试都要付这个成本，批量破解直接被拖垮。
> - **盐**由 `bcrypt.hash` 自动生成并存进结果字符串（`$2a$10$<salt><hash>`），所以相同密码每次哈希结果不同，彩虹表失效。
> - `bcrypt.compare(明文, 哈希)` 会从哈希里取出盐和 cost 重新计算再比对，**不需要你手动存盐**。
> - 代价因子不是越大越好：`cost=12` 单次可能上百毫秒，登录 QPS 高时会成为瓶颈。登录量大的系统通常配合“按用户维度限流”。
>
> **追问：bcryptjs 和 bcrypt 有什么区别？**
> `bcrypt` 是 C++ 原生扩展，快但安装要编译（Windows 上经常卡 node-gyp）；`bcryptjs` 是纯 JS 实现，慢一些但零编译依赖。教学项目选 `bcryptjs`，省掉环境问题。生产环境如果性能敏感可以换 `bcrypt` 或 `argon2`。

> **面试考点 · 登录失败为什么必须返回同一句话？**
>
> - 如果邮箱不存在返回 `404 User not found`、密码错返回 `401 Invalid password`，攻击者就能用脚本批量试探哪些邮箱注册过——这叫**账号枚举**。
> - 统一成 `401 Invalid email or password`，调用方无法区分两种情况。
> - 还有更细的**时序侧信道**：用户不存在时根本不执行 `bcrypt.compare`，响应会明显更快。严格的做法是用户不存在时也拿一个固定的 dummy hash 比对一次，把两条路径的耗时拉平。本项目没做到这一步，但面试时要能说出来。
>
> **追问：为什么 `register` 里先查一次再插入，不是直接插入靠唯一索引报错？**
> 直接插的话，Prisma 抛的是 `P2002` 唯一约束错误，需要捕获并翻译成 409，代码更绕；先查能给出干净的 `ConflictException`。但**并发下两个请求可能同时通过检查**，所以数据库的 `@unique` 才是最终防线。生产代码应该两个都做：先查给友好文案，同时捕获 `P2002` 兜底。

> **面试考点 · JWT 里到底放了什么？**
>
> JWT 是三段 `base64url` 用 `.` 连接：`header.payload.signature`。
>
> - `header`：算法与类型，如 `{"alg":"HS256","typ":"JWT"}`。
> - `payload`：本项目的 `{ sub: user.id, role: user.role, iat, exp }`。`iat`/`exp` 由 `signAsync` 自动加。
> - `signature`：用 `JWT_SECRET` 对前两段做 HMAC-SHA256。
> - **payload 只是 base64url 编码，不是加密**：任何人拿到 token 都能解出 `sub` 和 `role`。所以绝不能在 JWT 里放密码、手机号等敏感信息。
> - **签名保证的是“没被篡改”**，不是“看不见”。
>
> **追问：两套后端为什么必须共用 `JWT_SECRET`？**
> api-ts 签发的 token，api-py 也要能验。HS256 是对称算法，密钥不同验签必失败。所以 `.env.example` 里两个后端写的是同一个值。如果要让第三方验签而不给它签发能力，就换成 RS256/ES256（私钥签名、公钥验签）。
>
> **追问：用户改了角色，旧 token 里的 `role` 会变吗？**
> 不会。JWT 是无状态快照，签发那一刻的 `role` 会一直用到过期。所以**权限判断不能只信 token**，关键操作要回库查当前角色，或者引入 token 版本号/黑名单。

> **面试考点 · `const ACCESS_TOKEN_EXPIRES_IN = Number(process.env.JWT_EXPIRES_IN ?? 3600)` 写在模块顶层有什么坑？**
> 模块被 `import` 时就执行，**早于** Nest 启动，也早于任何配置模块初始化。本项目的 `main.ts` 第一行是 `import 'dotenv/config'`，所以能读到；如果哪天有人把 `dotenv` 挪到别处，这里会静默变成默认值 3600。更稳的写法是 `ConfigService` 或 `JwtModule.registerAsync`，在 DI 阶段读取。这里保留顶层常量是为了让文件短、易读——但要清楚它的前提。

---

## 5. 鉴权：Guard + 参数装饰器

**完整文件路径：`apps/api-ts/src/auth/jwt-auth.guard.ts`**

```ts
import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

/** JWT 载荷，两套后端必须一致（见总纲 §5.6）。 */
export interface JwtPayload {
  /** 用户 id */
  sub: string
  /** 角色，签发时的快照 */
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
    // switchToHttp() 拿到当前 HTTP 请求对象；RPC/WS 场景有各自的切换方法
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>()

    const header = request.headers.authorization
    // 必须是 "Bearer " 前缀（注意后面有一个空格），否则视为没带 token
    const token = header?.startsWith('Bearer ') === true ? header.slice(7) : undefined
    if (token === undefined) {
      throw new UnauthorizedException('Missing bearer token')
    }

    try {
      // verify 会校验签名与 exp；失败抛错
      request.user = this.jwtService.verify<JwtPayload>(token)
      return true
    } catch {
      // 不区分「签名错」和「过期」，统一文案
      throw new UnauthorizedException('Invalid or expired token')
    }
  }
}
```

**完整文件路径：`apps/api-ts/src/auth/current-user.decorator.ts`**

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { JwtPayload } from './jwt-auth.guard'

/** 取出 `JwtAuthGuard` 写入 `request.user` 的 payload。 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>()
  // Guard 已经保证这里一定存在；没有 Guard 的路由不要用这个装饰器
  return request.user
})
```

> **面试考点 · 鉴权为什么放在 Guard，而不是 Middleware？**
>
> - **Middleware** 跑在路由匹配之前，拿不到“即将执行哪个 handler / 哪些装饰器”，只能在字符串路径上做判断。
> - **Guard** 在路由匹配之后、Pipe 之前执行，能拿到 `ExecutionContext`（handler 类、方法、元数据），所以能做基于 `@Roles()` 这类自定义装饰器的细粒度授权。
> - Guard 支持依赖注入（本项目的 `JwtService` 就是构造注入的），Middleware 在 Nest 里虽然也支持 DI，但作用域更窄。
> - 一句话记：**Middleware 改请求，Guard 决定是否放行，Pipe 校验入参，Interceptor 包前后，Filter 兜异常。**
>
> **追问：Guard 里抛 401 和返回 `false` 有什么区别？**
> 返回 `false` 时 Nest 会自动抛 `ForbiddenException`（403）。本项目要的是 401（身份未通过），所以必须显式抛 `UnauthorizedException`，并给出契约规定的文案。

> **面试考点 · `createParamDecorator` 解决了什么问题？**
> 没有它，每个受保护接口都要写 `@Req() req` 然后 `req.user.sub`，类型不安全、重复且丑。`@CurrentUser()` 把“从请求里取什么”封装成一个可复用的参数级装饰器，handler 签名只剩业务参数。
>
> **追问：`ExecutionContext` 是什么？**
> Nest 对“当前调用上下文”的抽象：HTTP 有 `getRequest/getResponse`，WebSocket 有 `switchToWs`，微服务有 `switchToRpc`。Guard、Interceptor、Filter 都靠它拿到当前请求，所以同一套代码能适配三种传输层。

---

## 6. 路由

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

  // POST 默认返回 201，正好对应契约的「注册成功 201」，不用额外写 @HttpCode
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<UserResponse> {
    // controller 只做协议转换：DTO → 业务参数，业务结果 → 响应体
    return this.authService.register(dto.email, dto.password)
  }

  // POST 默认 201，但契约要求登录是 200，必须显式覆盖
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<TokenResponse> {
    return this.authService.login(dto.email, dto.password)
  }

  // 守卫只挂在需要的路由上；Guard 通过后会写 request.user
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() payload: JwtPayload): Promise<UserResponse> {
    const user = await this.authService.findById(payload.sub)
    // 用户已被删除等情况，视为未认证（token 本身有效，但主体不存在了）
    if (user === null) {
      throw new UnauthorizedException('User no longer exists')
    }
    return user
  }
}
```

> **面试考点 · 为什么登录必须写 `@HttpCode(200)`？**
> NestJS 对 `POST` 的默认成功状态码是 **201**。注册创建了资源，201 正确；登录只是换取 token，没有创建资源，契约规定 200。不写 `@HttpCode(200)`，浏览器里看起来“能用”，但契约测试会失败——**状态码是契约的一部分，不是框架默认值说了算。**

> **面试考点 · 为什么 `findById` 返回 `null` 而不是直接抛 401？**
> 服务层不该知道 HTTP 语义。`findById` 的职责是“查用户”，查不到就是 `null`；由 controller 决定这对当前接口意味着 401。这样同一个方法以后被别的场景复用（比如内部任务）时，不会被硬编码的 HTTP 异常绑死。

---

## 7. 模块装配

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
 * `JwtModule` 注册为 `global: true`，其它模块可直接注入 `JwtService`，无需重复注册。
 */
@Module({
  imports: [
    JwtModule.register({
      // 全局可见：阶段 2 之后的模块也可能要验 token / 签发 token
      global: true,
      // 两套后端必须同值；本地默认值仅用于开发，生产必须配环境变量
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      // 过期时间（秒）；直接数字，Nest 会转成 JWT 的 exp
      signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600) },
    }),
  ],
  controllers: [AuthController],
  // JwtAuthGuard 需要 DI（构造注入 JwtService），所以要注册成 provider
  providers: [AuthService, JwtAuthGuard],
  // 导出给其他模块使用：本模块内 @UseGuards 不需要导出，跨模块才需要
  exports: [JwtAuthGuard],
})
export class AuthModule {}
```

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
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

> **面试考点 · 模块之间怎么共享 `PrismaService` / `JwtService`？**
> Nest 的 provider 默认是**模块作用域**：在 `AuthModule` 里能注入，出了这个模块就看不到。两种共享方式：
>
> - `@Global()`：`PrismaModule` 用的方式。注册一次，全应用可见，适合基础设施。
> - `exports: [...]` + 目标模块 `imports: [...]`：显式声明依赖关系，`AuthModule` 导出 `JwtAuthGuard` 给其他模块用就是这种。
>
> `JwtModule.register({ global: true })` 是 Nest 官方模块自带的全局开关，等价于“帮你在内部加了 `@Global()`”。

> **追问：`JwtAuthGuard` 为什么要在 `AuthModule` 里 provide？**
> 它被 `@UseGuards(JwtAuthGuard)` 以**类**的形式引用，Nest 需要在当前模块（或导入的模块）的容器里找到它的实例才能注入 `JwtService`。只写 `@UseGuards(JwtAuthGuard)` 而不注册 provider，会报 `Nest can't resolve dependencies of the JwtAuthGuard`。

---

## 8. 验证

```powershell
# 0. 起数据库与后端（两个终端）
docker compose up -d
pnpm --filter @mini-dify/api-ts start:dev
```

```powershell
# 1. 注册 → 201 + UserResponse（不含 passwordHash）
$body = @{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/register `
  -ContentType 'application/json' -Body $body
```

预期：

```text
id    : 3f0a1c9e-...
email : alice@example.com
role  : member
createdAt : 2026-10-18T02:36:24.278Z
```

```powershell
# 2. 重复注册 → 409 {"statusCode":409,"message":"Email already registered","error":"Conflict"}
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/register `
    -ContentType 'application/json' -Body $body
} catch {
  $_.ErrorDetails.Message
}
```

```powershell
# 3. 登录 → 200 + TokenResponse
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType 'application/json' -Body $body
$token = $login.accessToken
$login.user.role      # member
$login.expiresIn      # 3600
```

```powershell
# 4. 带 token 取当前用户 → 200
Invoke-RestMethod -Uri http://localhost:3001/auth/me `
  -Headers @{ Authorization = "Bearer $token" }
```

```powershell
# 5. 不带 token → 401 {"statusCode":401,"message":"Missing bearer token","error":"Unauthorized"}
try {
  Invoke-RestMethod -Uri http://localhost:3001/auth/me
} catch {
  $_.ErrorDetails.Message
}

# 6. token 改一个字符 → 401 Invalid or expired token
try {
  Invoke-RestMethod -Uri http://localhost:3001/auth/me `
    -Headers @{ Authorization = "Bearer $($token)x" }
} catch {
  $_.ErrorDetails.Message
}
```

```powershell
# 7. 校验错误：邮件格式 + 密码太短，两条用 "; " 连接
$bad = @{ email = 'not-an-email'; password = 'short' } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/register `
    -ContentType 'application/json' -Body $bad
} catch {
  $_.ErrorDetails.Message
}
```

预期：

```json
{"statusCode":400,"message":"email must be a valid email; password must be at least 8 characters","error":"Bad Request"}
```

```powershell
# 8. 多传字段 → 400 额外字段
$extra = @{ email = 'bob@example.com'; password = 'password123'; role = 'admin' } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/register `
    -ContentType 'application/json' -Body $extra
} catch {
  $_.ErrorDetails.Message
}
```

预期：

```json
{"statusCode":400,"message":"role should not exist","error":"Bad Request"}
```

```powershell
# 9. 数据库里确认存的是哈希，不是明文（应看到 $2a$10$ 前缀）
docker exec -it mini-dify-db psql -U postgres -d minidify `
  -c "SELECT email, role, left(password_hash, 7) AS hash_prefix, created_at FROM users;"
```

```text
     email          | role   | hash_prefix |         created_at
--------------------+--------+-------------+----------------------------
 alice@example.com  | member | $2a$10$     | 2026-10-18 02:36:24.278
```

> **面试考点 · 为什么错误响应里没有 `timestamp` / `path` / `traceId`？**
> 因为契约只声明了三个字段，多一个 `additionalProperties: false` 就过不了。错误体越简单，两套后端越容易做到逐字节一致；需要排查时靠服务端日志里的 traceId，而不是把内部信息返回给客户端。

---

## 9. 下一步

- `04-SQLAlchemy用户表.md`：Python 侧映射**同一张** `users` 表，不新建表、不写自己的迁移。
- 然后是 `05-FastAPI注册登录.md`：同一个契约、同一套文案，用 `Depends` 实现鉴权。
- 最后 `06-前端登录页.md`：`lib/schemas.ts` 校验 `TokenResponse`，登录后带 Bearer 调 `/auth/me`。
