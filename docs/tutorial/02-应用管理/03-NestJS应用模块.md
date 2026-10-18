# 03 · NestJS 应用模块

> 所属：阶段 2 · 应用管理
> 本篇覆盖：`apps/api-ts` 的 `/apps` 与 `/apps/{id}` —— 应用的**列表 / 创建 / 详情 / 更新 / 删除**（CRUD），以及支撑它们的控制器、服务、DTO 与模块装配；并讲清本项目**刚完成的一次真实重构**（JWT 模块复用与依赖注入边界）
> **本篇首次教学**：
> - **资源归属（ownership）与「404 而非 403」的安全惯例**
> - **NestJS 模块复用与依赖注入边界**（`JwtModule.register({ global: true })` / `exports` / `imports`；为什么不能让每个业务模块各自 `register` 一份 JWT 配置 —— 配置漂移）
> - **实体出参映射（视图映射）**：只把契约字段透出去、`description` 空值统一为 `null`
>
> **不再重讲**（只引用）：
> - TypeScript 装饰器 / 依赖注入 / NestJS 模块系统 / `NestFactory` 启动 / CORS → `00-项目初始化/05-NestJS起步.md`
> - 契约类型与「TS 类型运行期被擦除」→ `00-项目初始化/04-契约包与TypeScript类型.md`
> - DTO 与 `class-validator`、`ValidationPipe`（`whitelist` / `forbidNonWhitelisted` / `transform`）→ `01-账号与认证/03-NestJS认证.md`
> - Guard / `CanActivate` / `@UseGuards`、自定义参数装饰器 `@CurrentUser`、异常过滤器（`@Catch` / `ExceptionFilter` / `ArgumentsHost`）→ `01-账号与认证/03-NestJS认证.md`
> - Prisma（`PrismaService` / `User` 模型 / `migrate`）、`NotFoundException` → `01-账号与认证/02-Prisma.md` 与 `01-账号与认证/03-NestJS认证.md`
>
> **本篇未使用的技术**：源码里**没有**用 `@nestjs/common` 的 `ParseUUIDPipe`（路径参数 `id` 直接以 `@Param('id') id: string` 原样接收，合法性交给「查不到就 404」兜底）。本篇因此**不讲解 `ParseUUIDPipe`**；如后续想加，属新增改动，不在本篇范围。

---

## 1. 本篇目标

做完本篇，`apps/api-ts` 应能对外提供契约 `openapi.yaml` 定义的 `/apps` 与 `/apps/{id}` 两组接口，行为与契约、与 FastAPI 侧**逐项一致**。

**验收标准（均为本地实测结果）**

| 场景 | 请求 | 状态码 | 响应体要点 |
| --- | --- | --- | --- |
| 创建应用 | `POST /apps`（带 token）`{name}` | **201** | `AppResponse`：`{id, name, mode, ownerId, createdAt, updatedAt, description:null}`；`mode` 缺省为 `chatflow` |
| 应用列表 | `GET /apps`（带 token） | **200** | `{items: AppResponse[]}`，只含**当前用户**的应用，按 `createdAt` 倒序 |
| 应用详情 | `GET /apps/{id}`（带 token，本人） | **200** | `AppResponse` |
| 更新应用 | `PATCH /apps/{id}`（带 token，本人） | **200** | `AppResponse`（仅更新传入字段） |
| 删除应用 | `DELETE /apps/{id}`（带 token，本人） | **204** | 空响应体 |
| 缺 token | 任一 `/apps*` 无 Authorization 头 | **401** | `{statusCode:401, message:"Missing bearer token", error:"Unauthorized"}` |
| **归属验证** | 用户 B 访问用户 A 的应用 | **404** | `{"statusCode":404,"message":"App not found","error":"Not Found"}` |
| 校验：空名 | `POST /apps` `{name:""}` | **400** | 契约形状错误体，`message` 为**字符串** |
| 校验：名过长 | `name` 65 字符 | **400** | 同上 |
| 校验：非法 mode | `mode:"bogus"` | **400** | 同上 |

关键点两条：

1. **`/apps*` 全部受 `JwtAuthGuard` 保护**（本篇把它贴在控制器类上，见 §6），无 token 一律 401。
2. **归属不属于自己 = 404，不是 403**（见 §7）——这是安全惯例，不是笔误。

## 2. 前置条件

- 阶段 0 的 **Step 05（NestJS 起步）** 已完成：会写 `@Module` / `@Controller` / `@Injectable`，懂构造函数注入。
- 阶段 1 的 **03（NestJS 认证）** 已完成：`JwtAuthGuard` / `@CurrentUser` / 全局 `ValidationPipe` / 全局 `HttpErrorFilter` 均已就位。
- 阶段 1 的 **02（Prisma）** 已完成：`PrismaService` 可用，且 `apps` 表的迁移已落地（`App` 模型已在 `schema.prisma` 中）。
- 阶段 2 的 **01（契约扩展）** 已完成：契约里有 `AppResponse` / `CreateAppRequest` / `UpdateAppRequest` / `AppListResponse`。
- 本地 PostgreSQL 容器已启动（`docker compose up -d`）；`apps/api-ts/.env` 的 `DATABASE_URL` 指向本地库。

> 若 `apps` 表不存在，创建应用会报 500（见 §11 常见坑）。

---

## 3. 先看清要做什么

在阶段 1「认证链路」之上，阶段 2 加一条 **带归属约束的资源 CRUD 链路**：

```
                 请求进入 Nest 应用
                         │
      ┌──────────────────┼───────────────────────────────┐
      │ 1) Guard  JwtAuthGuard（贴在控制器类上，全控制器生效）  │
      │    验 Authorization: Bearer <jwt> → 写 request.user   │
      ├──────────────────────────────────────────────────────┤
      │ 2) Pipe   ValidationPipe（有 @Body 的接口）           │
      │    按 DTO 的 class-validator 装饰器校验 → 非法抛 400   │
      ├──────────────────────────────────────────────────────┤
      │ 3) Controller  AppsController                        │
      │    @CurrentUser() 取 ownerId；@Param('id') 取资源 id   │
      ├──────────────────────────────────────────────────────┤
      │ 4) Service  AppsService                              │
      │    findOwned(ownerId, id)：查不到 OR 不属于本人 → 404    │
      │    list/create/get/update/remove  → Prisma CRUD        │
      │    所有出参经 toAppResponse() 映射成契约形状             │
      └──────────────────────────────────────────────────────┘
                         │
              ┌──────────┴───────────┐
              │ 成功：契约结构 JSON     │
              │ 失败：HttpException    │
              │  → HttpErrorFilter 归一 │
              └──────────────────────┘
```

一句话概括三件事：

1. **入参**：`@CurrentUser()` 拿「我是谁」，`@Param('id')` 拿「要操作哪个资源」，`@Body()` + DTO 保证「数据合规」。
2. **归属**：所有按 id 的操作都必须先过 `findOwned`，不满足即 404。
3. **出参**：数据库实体 → 契约 `AppResponse`，只暴露契约字段。

---

## 4. 命令清单（逐条说明）

> 除「实测接口」外，其余命令均在**仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm dev:api-ts` | 仓库根 | 先编译契约，再以 watch 模式启动 NestJS（`:3001`） | 末尾打印 `api-ts listening on http://localhost:3001` |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 用 `nest build` 编译到 `dist` | 产出 `apps/api-ts/dist/main.js` 等 |
| `pnpm --filter @mini-dify/api-ts db:migrate` | 仓库根 | 应用 Prisma 迁移（新增 `apps` 表时） | 若已是最新会提示 `Already in sync` |
| 应用 CRUD 请求 | 任意目录 | 验证五组 `/apps*` 接口与错误 | 见 §10 |

> 「在哪执行」的缘由（`dotenv` 从当前工作目录读 `.env`、`apps/api-ts/.env` 自包含连接串）见 `01-账号与认证/03-NestJS认证.md` §4，此处不重讲。

---

## 5. 完整代码

> 以下文件均为 `apps/api-ts` 侧当前**完整内容**（逐字照抄）。

### 5.1 应用模块（apps.module.ts）

**完整文件路径：`apps/api-ts/src/apps/apps.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AppsController } from './apps.controller'
import { AppsService } from './apps.service'

/**
 * 应用模块。`PrismaService` 来自全局的 `PrismaModule`，`JwtService` 来自全局的 `JwtModule`
 * （在 `AuthModule` 中注册），均无需在此声明。`JwtAuthGuard` 由 `AuthModule` 提供并导出。
 */
@Module({
  imports: [AuthModule],
  controllers: [AppsController],
  providers: [AppsService],
})
export class AppsModule {}
```

**说明**：`Providers` 只有 `AppsService`——因为 `PrismaService` 走全局 `PrismaModule`、`JwtService` 走全局 `JwtModule`，本模块**不重复声明**。`imports: [AuthModule]` 是为了拿到 `AuthModule` **导出**的 `JwtAuthGuard`（见 §8）。`@Module` 机制见 `00-项目初始化/05-NestJS起步.md`。

### 5.2 应用控制器（apps.controller.ts）

**完整文件路径：`apps/api-ts/src/apps/apps.controller.ts`**

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common'
import type { AppListResponse, AppResponse } from '@mini-dify/contract'

import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard'
import { AppsService } from './apps.service'
import { CreateAppDto } from './dto/create-app.dto'
import { UpdateAppDto } from './dto/update-app.dto'

/** 契约见 packages/contract/openapi.yaml 的 `/apps` 与 `/apps/{id}`。 */
@Controller('apps')
@UseGuards(JwtAuthGuard)
export class AppsController {
  constructor(private readonly appsService: AppsService) {}

  @Get()
  list(@CurrentUser() payload: JwtPayload): Promise<AppListResponse> {
    return this.appsService.list(payload.sub)
  }

  @Post()
  create(@CurrentUser() payload: JwtPayload, @Body() dto: CreateAppDto): Promise<AppResponse> {
    return this.appsService.create(payload.sub, dto)
  }

  @Get(':id')
  get(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<AppResponse> {
    return this.appsService.get(payload.sub, id)
  }

  @Patch(':id')
  update(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAppDto,
  ): Promise<AppResponse> {
    return this.appsService.update(payload.sub, id, dto)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.appsService.remove(payload.sub, id)
  }
}
```

**几处对照契约的细节**：

- `@Controller('apps')`：所有路由前缀 `/apps`。
- `@UseGuards(JwtAuthGuard)` **贴在类上**：对**整个控制器的所有路由**生效（对照阶段 1 的 `/auth/me` 是贴在**单个方法**上）。这样 5 个接口无需逐一重复。
- `@Post()` 默认返回 **201**，与契约 `createApp` 一致 → 不写 `@HttpCode`。`@Delete` 契约要求 **204**，所以 `@HttpCode(204)` 覆盖默认的 201（对照 `01-账号与认证/03-NestJS认证.md` 里登录用 `@HttpCode(200)`）。
- 每个方法都把 `@CurrentUser()` 拿到的 `payload.sub` 当作 `ownerId` 往 service 传——**归属由令牌决定，而不是由请求体决定**（见 §7）。
- `@Param('id')` 直接按 `string` 接收，没套 `ParseUUIDPipe`（见篇首说明）。

### 5.3 应用服务（apps.service.ts）

**完整文件路径：`apps/api-ts/src/apps/apps.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import type { AppListResponse, AppResponse } from '@mini-dify/contract'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateAppDto } from './dto/create-app.dto'
import type { UpdateAppDto } from './dto/update-app.dto'

/**
 * 应用（App）读写。
 *
 * 归属校验：查不到、或不属于当前用户，一律抛 `NotFoundException`（404），
 * 不使用 403 —— 避免泄露「该资源是否存在」。
 */
@Injectable()
export class AppsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<AppListResponse> {
    const apps = await this.prisma.app.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    })
    return { items: apps.map((app) => this.toAppResponse(app)) }
  }

  async create(ownerId: string, dto: CreateAppDto): Promise<AppResponse> {
    const app = await this.prisma.app.create({
      data: {
        ownerId,
        name: dto.name,
        description: dto.description,
        mode: dto.mode ?? 'chatflow',
      },
    })
    return this.toAppResponse(app)
  }

  async get(ownerId: string, id: string): Promise<AppResponse> {
    return this.toAppResponse(await this.findOwned(ownerId, id))
  }

  async update(ownerId: string, id: string, dto: UpdateAppDto): Promise<AppResponse> {
    await this.findOwned(ownerId, id)
    // Prisma 会忽略值为 undefined 的字段，等价于「只更新传入的字段」
    const app = await this.prisma.app.update({
      where: { id },
      data: { name: dto.name, description: dto.description, mode: dto.mode },
    })
    return this.toAppResponse(app)
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwned(ownerId, id)
    await this.prisma.app.delete({ where: { id } })
  }

  private async findOwned(ownerId: string, id: string) {
    const app = await this.prisma.app.findUnique({ where: { id } })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
    return app
  }

  /** 只暴露契约字段；`description` 为空时统一为 `null`。 */
  private toAppResponse(app: {
    id: string
    name: string
    description: string | null
    mode: string
    ownerId: string
    createdAt: Date
    updatedAt: Date
  }): AppResponse {
    return {
      id: app.id,
      name: app.name,
      description: app.description ?? null,
      mode: app.mode as AppResponse['mode'],
      ownerId: app.ownerId,
      createdAt: app.createdAt.toISOString(),
      updatedAt: app.updatedAt.toISOString(),
    }
  }
}
```

### 5.4 创建 DTO（dto/create-app.dto.ts）

**完整文件路径：`apps/api-ts/src/apps/dto/create-app.dto.ts`**

```ts
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

const APP_MODES = ['chatflow', 'workflow'] as const

/** POST /apps 请求体 —— 对应契约 `CreateAppRequest`。 */
export class CreateAppDto {
  @IsString()
  @Length(1, 64)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string

  @IsOptional()
  @IsIn(APP_MODES)
  mode?: (typeof APP_MODES)[number]
}
```

### 5.5 更新 DTO（dto/update-app.dto.ts）

**完整文件路径：`apps/api-ts/src/apps/dto/update-app.dto.ts`**

```ts
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

const APP_MODES = ['chatflow', 'workflow'] as const

/** PATCH /apps/{id} 请求体 —— 对应契约 `UpdateAppRequest`（字段均可选）。 */
export class UpdateAppDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string

  @IsOptional()
  @IsIn(APP_MODES)
  mode?: (typeof APP_MODES)[number]
}
```

> DTO 与 `class-validator` 的原理见 `01-账号与认证/03-NestJS认证.md` §6。这里只补**本项目特有**的三点：
> - `@Length(1, 64)` 一次性表达契约的 `minLength:1 + maxLength:64`（`name=""` → 400；65 字符 → 400，均已实测）。
> - `@IsIn(APP_MODES)` 让 `mode` 只能是 `'chatflow' | 'workflow'`，`mode="bogus"` → 400（已实测）。`APP_MODES` 用 `as const` 得到**字面量元组**，于是 `(typeof APP_MODES)[number]` 就是联合类型 `'chatflow' | 'workflow'` —— 与契约 `enum` 一一对应。
> - `UpdateAppDto` **每个字段都是 `@IsOptional()`**：PATCH 语义是「只改传入的字段」，所以允许全部缺省。缺省的字段是 `undefined`，交给 Prisma 时会被忽略（见 §6.3）。

### 5.6 认证模块（auth.module.ts）—— 本轮**重构后**的样子

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
 * JWT 配置在此注册为 `global: true`，其它模块可直接注入 `JwtService`，无需重复注册。
 */
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600) },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
```

> 与阶段 1 的版本（见 `01-账号与认证/03-NestJS认证.md` §5.1）相比，本轮**重构**加了两样东西：`global: true` 与 `exports: [JwtAuthGuard]`。§8 专门讲这次重构。

### 5.7 根模块（app.module.ts）

**完整文件路径：`apps/api-ts/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AppsModule } from './apps/apps.module'
import { AuthModule } from './auth/auth.module'
import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
import { PrismaModule } from './prisma/prisma.module'

/**
 * 根模块。阶段 1 加入：
 * - `PrismaModule`（全局数据库访问）
 * - `AuthModule`（注册 / 登录 / 当前用户）
 * 阶段 2 加入 `AppsModule`（应用管理）。
 */
@Module({
  imports: [PrismaModule, AuthModule, AppsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

### 5.8 数据模型（prisma/schema.prisma）—— `App` 模型

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**

```prisma
// mini-dify（TS 侧）数据模型
// 契约：packages/contract/openapi.yaml（UserResponse 的字段与 role 取值）

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         String   @default("member")
  createdAt    DateTime @default(now()) @map("created_at")

  apps App[]

  @@map("users")
}

model App {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  description String?
  mode        String   @default("chatflow")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId])
  @@map("apps")
}
```

> Prisma / 迁移机制见 `01-账号与认证/02-Prisma.md`。这里只点两处与本篇相关的：`description String?` 是**可空**字段（对应契约 `type: ["string","null"]`）；`@@index([ownerId])` 给「按归属查列表」加索引，配合 §6.2 的 `findMany({ where: { ownerId } })`。

### 5.9 数据库服务（prisma/prisma.service.ts）—— 仅引用，不重讲

**完整文件路径：`apps/api-ts/src/prisma/prisma.service.ts`**

```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/** Prisma 客户端的 NestJS 包装：随应用生命周期连接 / 断开。 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
```

> 生命周期钩子 / 全局模块见 `01-账号与认证/02-Prisma.md`，此处不重讲。

---

## 6. 【技术教学 · 首次】实体出参映射（视图映射）

### 6.1 是什么

**出参映射**：把从数据库取出的**实体对象**，转换成**契约 `AppResponse` 形状**再返回给前端。本项目把它收在一个私有方法 `toAppResponse()` 里，所有返回路径都经它处理。

```ts
async get(ownerId: string, id: string): Promise<AppResponse> {
  return this.toAppResponse(await this.findOwned(ownerId, id))   // 实体 → 契约
}
```

### 6.2 为什么必须映射，不能直接返回实体

**① 不把内部字段透出去（安全）**
数据库实体常带内部/敏感字段（本项目 `User.passwordHash` 就是活例子）。将来 `App` 若加上 `apiKey` / 草稿图 / 发布图等内部字段（见总纲 §3.1），直接 `return app` 会**无意中泄露**。通过在 service 边界**显式列字段**，契约之外的东西**天然出不去**——这是一种「白名单式」出参，与请求侧的 `whitelist` 对应。

**② 值规范要对齐（契约一致的第二层）**
契约不只是字段名，还有**值的类型/格式**：

| 数据库实体 | 契约 `AppResponse` | 映射动作 |
| --- | --- | --- |
| `description: string \| null` | `description: string \| null`（`required` 未含） | 空值统一为 `null`：`app.description ?? null` |
| `mode: string` | `mode: 'chatflow' \| 'workflow'` | 断言为字面量联合 |
| `createdAt: Date` | `createdAt: string`（ISO-8601） | `.toISOString()` |
| `updatedAt: Date` | `updatedAt: string`（ISO-8601） | `.toISOString()` |

> `description` 之所以要写 `?? null`：Prisma 读出的是 `string | null` 两种可能，而契约要求**要么字符串、要么 `null`**（不接受「字段缺失」或空字符串）。实测创建响应里 `description` 就是 `null`。ISO-8601 / UTC 归一化见 `00-项目初始化/08-验收.md`。

**③ 解耦**
控制器/契约说「我要 `AppResponse`」，service 说「我返回 `AppResponse`」——中间任何底层结构变化（换 ORM、加列）只需改映射函数，接口形状不变。

### 6.3 顺手点一下「部分更新」的机制

```ts
await this.prisma.app.update({
  where: { id },
  data: { name: dto.name, description: dto.description, mode: dto.mode },  // 未传的字段是 undefined
})
```

`UpdateAppDto` 未传的字段 = `undefined`；**Prisma 会忽略值为 `undefined` 的字段**，于是等价于「只更新传入的字段」。这正是 PATCH 语义（对应契约 `UpdateAppRequest` 的「字段均可选」）。

---

## 7. 【技术教学 · 首次】资源归属（ownership）与「404 而非 403」

### 7.1 是什么

**资源归属**：每条资源都记录「它属于谁」。本项目 `App.ownerId` 指向 `User.id`。任何**按 id 操作**资源的接口，都必须先确认「这条资源属于当前登录用户」，否则拒绝。

**「404 而非 403」**是拒绝时的**状态码选择**惯例：对其他人的资源，返回 **404 Not Found**（装作「不存在」），而不是 **403 Forbidden**（「存在，但不给你看」）。

### 7.2 本项目怎么做

```ts
private async findOwned(ownerId: string, id: string) {
  const app = await this.prisma.app.findUnique({ where: { id } })
  if (app === null || app.ownerId !== ownerId) {   // 查不到 或 不属于本人 —— 两种情况合并
    throw new NotFoundException('App not found')    // 一律 404
  }
  return app
}
```

`get` / `update` / `remove` **每一条**都先 `await this.findOwned(...)`，通过后才动资源。`list` 不走它——因为 `list` 直接用 `where: { ownerId }` **只查自己的**，天然不涉及别人。

`ownerId` 从哪来？**从令牌**——控制器里 `@CurrentUser() payload` 的 `payload.sub`，**不是**请求体里的字段。即无法伪造归属。

> **实测**（用户 B 拿自己的 token 访问用户 A 的应用）：
> ```json
> {"statusCode":404,"message":"App not found","error":"Not Found"}
> ```
> 注意：**B 明明带着有效 token（不是未登录）**，却仍是 404——因为这是「资源对你的可见性」问题，与「你有没有令牌」是两码事。

### 7.3 为什么不返回 403（关键安全理由）

考虑若改成 403，攻击者能拿到的信息：

| 请求的资源 | 返回 403 的含义（泄露版） | 返回 404 的含义（安全版） |
| --- | --- | --- |
| 存在于别人名下 | 「**该 id 真的存在**，只是不属于你」 | 「该 id 不存在」（真假不分） |
| 根本不存在 | 「该 id **不存在**」（与上一行不同，可区分） | 同上（无法区分） |

一旦 403 与 404 能区分，攻击者就能**枚举**资源 id、**探测**系统中哪些 id 真实存在（信息泄露），甚至据此推断业务规模、命名规律。把两种结果**压成同一种「404」**，攻击者得不到任何额外信息——这就是「**用 404 掩盖存在性**」。

> 这与阶段 1 登录接口「邮箱不存在 / 密码错误」都回同一个 401 是**同一类安全思路**（见 `01-账号与认证/03-NestJS认证.md` §11.2）：**不留可用于区分的旁路信息**。

### 7.4 何时才用 403

403 并非永远不用：当**「谁能看到某资源」本身不是秘密**时，用 403 反而更清晰。例如「管理员才能删帖」「订阅级别不足」——这类**基于角色的准入失败**，语义就是「你无权」，用 403 合理。判定标准：

> **资源「是否存在」是否属于敏感信息？** 是 → 用 404 掩盖；否（或失败原因本就是权限不足）→ 用 403。

本项目「应用是否属于某用户」属于前者，故选 404。

---

## 8. 【技术教学 · 首次】模块复用与依赖注入边界（含本轮真实重构）

> 这是本篇的**重头**。阶段 1 的 `AuthModule` 是个「自给自足」的模块；阶段 2 起**出现了第二个用到令牌能力的业务模块** `AppsModule`，于是「怎么把能力共享出去」这个问题第一次真正浮现——本项目为此做了一次重构。

### 8.1 问题：`AppsModule` 需要什么？

`AppsController` 上贴了 `@UseGuards(JwtAuthGuard)`。要让这行生效，两件事必须成立：

1. `JwtAuthGuard` **这个类**得能被 `AppsModule` 拿到并实例化；
2. `JwtAuthGuard` 内部 `constructor(private readonly jwtService: JwtService)` 注入的 `JwtService` 得能被解析到。

而 `JwtAuthGuard` 定义在 `auth/` 目录、由 `AuthModule` 注册；JWT 的 `secret` / `expiresIn` 也只在 `AuthModule` 里配置。**能力在 A 模块，需求在 B 模块**——这就是模块复用要解决的边界问题。

### 8.2 重构前（反例）：每个业务模块各自 register 一份 JWT 配置

若不做重构，最「顺手」的写法是让 `AppsModule` **自己**把缺的东西补齐：

```ts
// 反例（重构前的做法）——请不要这样写
@Module({
  imports: [
    JwtModule.register({                              // ← 每个用到令牌的模块都抄一份
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600) },
    }),
  ],
  controllers: [AppsController],
  providers: [AppsService, JwtAuthGuard],             // ← Guard 也得在这里再注册一次
})
export class AppsModule {}
```

它能跑通，但埋了两颗雷：

- **配置漂移（config drift）**：`secret` / `expiresIn` 的**同一份事实**被复制到 N 个模块。哪天改了密钥读取方式、改了默认值，要**每一处都改**；漏掉一处，就会出现「A 模块签发的令牌 B 模块验不过」这类**只在特定路径才复现**的诡异 bug。
- **安全面扩大**：签名密钥的读取逻辑散落各处，审计「密钥被谁读、在哪用」变得困难。

> 一句话：**「谁能签发/验证令牌」这件事，全项目应当只有一个权威来源。**

### 8.3 重构后（现状）：一处注册 + 全局复用 + 显式导出

重构把能力**集中到 `AuthModule` 一处**，并给下游两条「拿」的通道：

**(1) `JwtModule.register({ global: true })` —— 让 `JwtService` 全局可注入**

```ts
JwtModule.register({
  global: true,   // ← 关键
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600) },
})
```

`@nestjs/jwt` 的 `register` 支持 `global: true`（与 `@Global()` 模块同效）：被标记后，`JwtService` 变成**全局 Provider**，**任何模块**都能直接 `constructor(private jwtService: JwtService)` 注入它，**无需**在自己的 `imports` 里再 `JwtModule.register`。于是：

- `AuthModule` 的 `AuthService` / `JwtAuthGuard` 用它——本来就在本模块。
- `AppsModule` 的 `JwtAuthGuard`（复用同一个类）需要它——**不用再注册**，全局拿得到。

**(2) `exports: [JwtAuthGuard]` + `AppsModule` 的 `imports: [AuthModule]` —— 让 Guard 类可复用**

```ts
// AuthModule
@Module({ ..., providers: [AuthService, JwtAuthGuard], exports: [JwtAuthGuard] })
export class AuthModule {}
```

```ts
// AppsModule
@Module({ imports: [AuthModule], controllers: [AppsController], providers: [AppsService] })
export class AppsModule {}
```

NestJS 规则：**一个 Provider 默认是「模块私有」的**——`AuthModule` 里的 `JwtAuthGuard` 若不 `exports`，别的模块根本看不见它。`exports: [JwtAuthGuard]` 把它「公开」；`AppsModule` 再 `imports: [AuthModule]` 把它「引进来」，于是 `@UseGuards(JwtAuthGuard)` 里引用的就是**同一个类**（同一个 Provider 实例由容器统一管理），而**不是**第二份。

> 注意：`AppsModule` 的 `providers` **没有** `JwtAuthGuard`。因为它是从 `AuthModule` **借用**（通过 `imports`）的，不是自己生产的——这个区分正是 DI 边界的要点。

### 8.4 重构前 vs 重构后 对照表

| 维度 | 重构前（每个模块各自 register） | 重构后（一处注册 + 导出复用） |
| --- | --- | --- |
| JWT 配置（`secret` / `expiresIn`） | 在 N 个模块重复 | **只在 `AuthModule` 一处** |
| `JwtService` 获取方式 | 每个模块自己 `JwtModule.register` | `global: true`，任意模块直接注入 |
| `JwtAuthGuard` 获取方式 | 每个模块自己 `providers` 再注册一份 | `AuthModule` `exports` + 下游 `imports` |
| 改密钥/改名时的改动面 | N 处，易漏 → **配置漂移** | **1 处**，改完全站一致 |
| 令牌签发/验证的「权威来源」 | 分散、多份 | **单一**（`AuthModule`） |

### 8.5 为什么「不能让每个业务模块各自 register 一份」

三条理由，从直接到根本：

1. **正确性**：签名密钥/有效期一旦不一致，跨模块签发的令牌就会验不过——而且**只在跨模块路径上复现**，本地单测常常测不到。配置漂移是这类「幽灵 bug」的温床。
2. **安全**：JWT 签名密钥是**安全敏感**配置。它被复制的每一处，都是一个新的泄露/误改面。收敛到一处便于审计。
3. **可维护**：将来支持「密钥轮换」「从密钥文件读取」等，只需改一处；分散后每加一个业务模块都要记得同步——**必然有一天会漏**。

> 这其实就是**依赖注入容器**存在的意义之一：让「共享的资源/服务」只有一个实例与一处配置，需要它的地方**声明依赖**而不是**复制实现**。参见 `00-项目初始化/05-NestJS起步.md` 的 DI 与模块系统。

> **对照 Python 侧**：FastAPI 的依赖注入（`Depends`）是「函数级、每次请求现取」，天然不存在「模块间 register 一份配置」的问题（见 `01-账号与认证/05-FastAPI认证.md`）。TS 侧 NestJS 因为**模块必须显式 import/export** 才能共享 Provider，才会出现这次重构要解决的边界问题——这是两套 DI 模型的一个真实差异点。

---

## 9. 控制器挂 Guard 的两种粒度（回顾）

已在阶段 1 讲过 Guard 与 `@UseGuards`（见 `01-账号与认证/03-NestJS认证.md` §8），这里只补两种粒度的对照，因为本篇第一次用到「类级」：

```ts
// 方法级：只有这一个路由需要鉴权（阶段 1 的 /auth/me）
@Get('me')
@UseGuards(JwtAuthGuard)
async me(...) { ... }

// 类级：整个控制器的所有路由都需要鉴权（本篇的 /apps*）
@Controller('apps')
@UseGuards(JwtAuthGuard)
export class AppsController { ... }
```

`/apps*` 5 个接口**全部**要求登录，逐个贴会重复 5 次，所以贴在类上，一处生效。

---

## 10. 验收自测

前提：`pnpm dev:api-ts` 已启动（打印 `api-ts listening on http://localhost:3001`）。

### 10.1 PowerShell（推荐，避免引号问题）

> 完整序列：**注册 → 登录拿 token → 建应用 → 列表 → 改名 → 删除**。

```powershell
$base  = 'http://localhost:3001'
$email = "demo$(Get-Random)@example.com"       # 每次换新邮箱，避免撞 409

# 1) 注册（先拿到用户）
Invoke-RestMethod -Method Post -Uri "$base/auth/register" `
  -ContentType 'application/json' `
  -Body (@{ email = $email; password = 'secret123' } | ConvertTo-Json) | Out-Null

# 2) 登录 → 拿 token
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email = $email; password = 'secret123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.accessToken)" }

# 3) 创建应用 → 201；期望含 id/name/mode="chatflow"/ownerId/createdAt/updatedAt/description=null
$app = Invoke-RestMethod -Method Post -Uri "$base/apps" -Headers $h `
  -ContentType 'application/json' `
  -Body (@{ name = '我的助手' } | ConvertTo-Json)
$app
$id = $app.id

# 4) 列表 → 200；{items:[...]}，只含当前用户的应用
(Invoke-RestMethod -Uri "$base/apps" -Headers $h).items.Count

# 5) 改名 → 200
Invoke-RestMethod -Method Patch -Uri "$base/apps/$id" -Headers $h `
  -ContentType 'application/json' `
  -Body (@{ name = '改名后的助手' } | ConvertTo-Json)

# 6) 删除 → 204（无响应体）
Invoke-RestMethod -Method Delete -Uri "$base/apps/$id" -Headers $h
```

**看错误体（PS 5 用 `$_.ErrorDetails.Message`）**

```powershell
function Show-Err($method, $path, $headers) {
  try { Invoke-RestMethod -Method $method -Uri "http://localhost:3001$path" @headers }
  catch { Write-Output ("HTTP " + [int]$_.Exception.Response.StatusCode + " " + $_.ErrorDetails.Message) }
}
Show-Err Get  '/apps' @{}                                      # 无 token → 401
Show-Err Post '/apps' @{ Headers = $h; ContentType = 'application/json'; Body = (@{ name = '' } | ConvertTo-Json) }      # 400
Show-Err Post '/apps' @{ Headers = $h; ContentType = 'application/json'; Body = (@{ mode = 'bogus' } | ConvertTo-Json) } # 400
```

### 10.2 curl（cmd / Git Bash 可用；PowerShell 请用 `curl.exe`）

```bash
# 创建应用 → 201
curl -i -X POST http://localhost:3001/apps \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"name":"我的助手"}'

# 列表 → 200
curl -i http://localhost:3001/apps -H "Authorization: Bearer <TOKEN>"

# 改名 → 200
curl -i -X PATCH http://localhost:3001/apps/<ID> \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"name":"改名后的助手"}'

# 删除 → 204
curl -i -X DELETE http://localhost:3001/apps/<ID> -H "Authorization: Bearer <TOKEN>"

# 无 token → 401
curl -i http://localhost:3001/apps

# 空名 → 400
curl -i -X POST http://localhost:3001/apps \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"name":""}'

# 非法 mode → 400
curl -i -X POST http://localhost:3001/apps \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"name":"x","mode":"bogus"}'
```

### 10.3 逐项核对表

| 检查项 | 命令 / 操作 | 预期 |
| --- | --- | --- |
| 创建成功 | `POST /apps` `{name}` | **201**，`AppResponse`，`mode="chatflow"`、`description=null` |
| 指定 mode | `POST /apps` `{name, mode:"workflow"}` | **201**，`mode="workflow"` |
| 列表 | `GET /apps` | **200**，`{items:[...]}`，仅本人、按 `createdAt` 倒序 |
| 改名 | `PATCH /apps/{id}` `{name}` | **200**，`name` 已更新，其它字段不变 |
| 删除 | `DELETE /apps/{id}` | **204**，无响应体 |
| 缺 token | 任一 `/apps*` 无头 | **401**，`message:"Missing bearer token"` |
| **归属验证** | 用户 B 访问用户 A 的 app | **404**，`{"statusCode":404,"message":"App not found","error":"Not Found"}` |
| 空名 | `POST /apps` `{name:""}` | **400**，`message` 为**字符串** |
| 名过长 | `name` = 65 字符 | **400** |
| 非法 mode | `mode:"bogus"` | **400** |
| **跨后端一致性** | api-py 创建的应用，用 api-ts `GET /apps` | **能查到**（两后端读写**同一张 `apps` 表**） |

> 跨后端那条是本阶段的重要验收点：TS 与 Py 两套后端共用同一 PostgreSQL 库、同一 `apps` 表，所以一端建、另一端能列出来。**前提**是双方的 `JWT_SECRET` 同值（同一认证域）——详见 `01-账号与认证/06-JWT与密码哈希.md` 与 `02-应用管理` 的验收篇。

---

## 11. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **`JwtAuthGuard` 注入失败 / `Nest can't resolve dependencies`** | 启动或首个请求报错 | `AppsModule` 少了 `imports: [AuthModule]`，或 `AuthModule` 少了 `exports: [JwtAuthGuard]`；两者是**配对**的（§8.3） |
| **`JwtService` 无法解析** | 报 `Nest can't resolve dependencies of JwtAuthGuard (?)` | JWT 未做成全局：`JwtModule.register` 缺 `global: true`；或某个模块又自己 register 了一份**不同配置**（漂移） |
| **两后端令牌验不过** | 在 A 端登录、B 端接口 401 | `JWT_SECRET` 两处不同值；TS 在 `apps/api-ts/.env`、Py 在 `apps/api-py/.env`，必须同值（§8.5） |
| **`apps` 表不存在** | 创建应用报 **500** | 没跑迁移（`apps/api-ts` 目录或 `pnpm --filter @mini-dify/api-ts db:migrate`），见 §11 前提 |
| **`DELETE` 期望 204 却得 201** | 状态码不符 | `@Delete` 默认 201；需 `@HttpCode(204)`（与契约一致）。对照登录用 `@HttpCode(200)` |
| **`PATCH` 把未传字段清空** | 只想改名，结果 `description` 变 `null` | 若手写成 `data: { description: null }` 会真清空；本项目传的是 `dto.description`（未传 = `undefined`），Prisma **忽略** `undefined`，才等价「只改传入字段」（§6.3） |
| **`mode` 绕过校验** | 传 `mode:"bogus"` 竟成功 | DTO 漏了 `@IsIn`，或被别的 `ValidationPipe` 选项影响；本项目 `@IsIn(APP_MODES)` 已覆盖 |
| **列表返回了别人的应用** | `GET /apps` 出现非本人数据 | `findMany` 漏了 `where: { ownerId }`；归属过滤必须在查询层做（§7.2） |
| **403 与 404 混用** | 归属失败返回 403 | 违反「404 掩盖存在性」惯例（§7.3）；本项目 `findOwned` 统一抛 `NotFoundException` |
| **`description` 返回空字符串而非 `null`** | 前端按契约判 `null` 失败 | 映射未写 `app.description ?? null`（§6.2） |
| **在仓库根直接 `node apps/api-ts/dist/main.js`** | Prisma 读不到正确 `DATABASE_URL` | 老坑已消除（配置自包含）；仍推荐在 `apps/api-ts` 目录运行或用 `pnpm --filter @mini-dify/api-ts start` |

---

## 12. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **资源归属（ownership）与「404 而非 403」的安全惯例** | **首次教学于本篇**（用 404 掩盖资源存在性，不留可枚举的旁路信息） |
| **NestJS 模块复用与依赖注入边界**：`JwtModule.register({ global: true })` / `exports` / `imports` | **首次教学于本篇**；含本项目「JWT 配置集中一处」的真实重构（配置漂移） |
| **实体出参映射（视图映射）** | **首次教学于本篇**（只暴露契约字段、`description` 空值 → `null`、`Date` → ISO-8601） |
| 类级 `@UseGuards`（整个控制器鉴权） | 首次用于本篇；Guard 原理见 `01-账号与认证/03-NestJS认证.md` |
| `ParseUUIDPipe` | **本篇未使用**，故未讲解（源码路径参数 `id` 直接按 `string` 接收） |
