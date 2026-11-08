# 03 · NestJS 应用模块（应用管理）

> 阶段 2 · 第 3 步
>
> 做完：`GET /apps`、`POST /apps`、`GET /apps/{id}`、`PATCH /apps/{id}`、`DELETE /apps/{id}` 全部可用；所有接口都要求 Bearer；不属于自己的应用统一 404。
>
> **本篇面试考点**：归属校验为什么放 Service · 先查后改的 TOCTOU 问题 · `@IsOptional()` 连 `null` 一起放过 · `@HttpCode(204)` · DTO 的 `!` 确定赋值 · 数据库 `string` 与契约枚举的收窄位置。

---

## 1. 文件清单

```text
apps/api-ts/src/apps/
├── dto/
│   ├── create-app.dto.ts   ← CreateAppRequest
│   └── update-app.dto.ts   ← UpdateAppRequest（全可选）
├── apps.service.ts         ← 业务 + 归属校验 + 出口收窄
├── apps.controller.ts      ← 路由 + Guard + 取当前用户
└── apps.module.ts          ← 挂载

apps/api-ts/src/app.module.ts ← imports 里加 AppsModule
```

顺序：**DTO → Service → Controller → Module → 根模块。**

---

## 2. DTO

**完整文件路径：`apps/api-ts/src/apps/dto/create-app.dto.ts`**

```ts
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

// `as const` 让 TS 推出字面量联合类型，同时给 @IsIn 当运行时白名单用
const APP_MODES = ['chatflow', 'workflow'] as const

/** POST /apps 请求体 —— 对应契约 `CreateAppRequest`。 */
export class CreateAppDto {
  // `!` 确定赋值断言：这些字段由 ValidationPipe 在运行期填，构造时并不存在
  @IsString()
  @Length(1, 64)
  name!: string

  // @IsOptional()：undefined 时跳过后面所有校验（契约里 description 非必填）
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string

  @IsOptional()
  @IsIn(APP_MODES)
  // 类型与运行时白名单来自同一个数组，改一处两边同时变
  mode?: (typeof APP_MODES)[number]
}
```

**完整文件路径：`apps/api-ts/src/apps/dto/update-app.dto.ts`**

```ts
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

const APP_MODES = ['chatflow', 'workflow'] as const

/** PATCH /apps/{id} 请求体 —— 对应契约 `UpdateAppRequest`（字段均可选）。 */
export class UpdateAppDto {
  // 每个字段都 @IsOptional()：PATCH 的语义是“传什么改什么”
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

> **面试考点 · `@IsOptional()` 到底跳过了什么？**
> 它在值为 `undefined` **或 `null`** 时跳过该字段的**所有**校验器。所以要小心：`{"name": null}` 能通过 `@Length(1, 64)`，一路传到 Prisma，而 `apps.name` 是 `NOT NULL`，最终抛 Prisma 错误变成 500。
>
> 这一阶段没处理这个边界，因为前端不会发 `null`；生产里若要堵住：
>
> ```ts
> // 只有 undefined 才跳过校验；null 会继续走 @IsString 被拒
> @ValidateIf((_obj, value) => value !== undefined)
> ```
>
> **记住：`@IsOptional()` ≠ “可选且非空”，它只是“缺失就放过”。**

> **面试考点 · 为什么 DTO 用 `!` 而不是 `?`？**
> `name!: string` 表示“我保证运行期会有值”，让 `service` 里 `dto.name` 的类型是 `string` 而不是 `string | undefined`。`CreateAppDto` 的 `name` 在契约里是必填，ValidationPipe 会保证它存在，所以断言是成立的。
> 反过来，`UpdateAppDto.name?: string` 必须用 `?`——PATCH 允许不传，Service 也必须处理 `undefined`。**必填用 `!`，可选用 `?`，别为了省事全写 `?`。**

---

## 3. Service

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
  // PrismaService 由全局 PrismaModule 提供，无需在 AppsModule 里再 import
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<AppListResponse> {
    const apps = await this.prisma.app.findMany({
      // 只查自己的；ownerId 由 Controller 从 token 取出后传进来
      where: { ownerId },
      // 新建的排前面；契约不约束顺序，但两套后端必须一致
      orderBy: { createdAt: 'desc' },
    })
    return { items: apps.map((app) => this.toAppResponse(app)) }
  }

  async create(ownerId: string, dto: CreateAppDto): Promise<AppResponse> {
    const app = await this.prisma.app.create({
      data: {
        // ownerId 来自 token，绝不来自请求体
        ownerId,
        name: dto.name,
        // undefined 会写入 NULL（列可空），符合契约的 string | null
        description: dto.description,
        // 默认值放在服务端：客户端不传也有确定行为
        mode: dto.mode ?? 'chatflow',
      },
    })
    return this.toAppResponse(app)
  }

  async get(ownerId: string, id: string): Promise<AppResponse> {
    return this.toAppResponse(await this.findOwned(ownerId, id))
  }

  async update(ownerId: string, id: string, dto: UpdateAppDto): Promise<AppResponse> {
    // 先确认归属，再更新；否则任何人都能改别人的应用
    await this.findOwned(ownerId, id)
    // Prisma 会忽略值为 undefined 的字段，等价于「只更新传入的字段」
    const app = await this.prisma.app.update({
      where: { id },
      data: { name: dto.name, description: dto.description, mode: dto.mode },
    })
    return this.toAppResponse(app)
  }

  async remove(ownerId: string, id: string): Promise<void> {
    // 不先校验归属直接 delete，会变成“知道 id 就能删”
    await this.findOwned(ownerId, id)
    await this.prisma.app.delete({ where: { id } })
  }

  /**
   * 按 (id, ownerId) 取应用；不存在或不属于当前用户都抛 404。
   * 返回 Prisma 实体，供 update/delete 复用。
   */
  private async findOwned(ownerId: string, id: string) {
    const app = await this.prisma.app.findUnique({ where: { id } })
    if (app === null || app.ownerId !== ownerId) {
      // 文案与两套后端约定一致
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
      // 数据库里可能是 null，这里再兜一层，保证契约字段恒定存在
      description: app.description ?? null,
      // 数据库列是 String，契约是枚举；在出口处收窄，别把 string 泄漏给前端
      mode: app.mode as AppResponse['mode'],
      ownerId: app.ownerId,
      // Date → ISO 字符串（UTC + 毫秒 + Z），与 Python 的 iso_z 逐字节一致
      createdAt: app.createdAt.toISOString(),
      updatedAt: app.updatedAt.toISOString(),
    }
  }
}
```

> **面试考点 · 归属校验为什么在 Service，而不是 Controller 或 Guard？**
>
> - Controller 只做“HTTP → 参数”的翻译，不该知道“应用属于谁”这种业务规则。
> - Guard 适合做“能不能进这个接口”（认证、角色），不适合做“这条数据是不是你的”——Guard 拿不到 `id` 对应的数据库行（拿到也意味着每个路由都要写一遍查询）。
> - 同一段归属逻辑被 `get` / `update` / `remove` 三处复用，放 Service 私有方法里只写一次。
>
> **一句话：Guard 管“进门”，Service 管“这间房是不是你的”。**

> **面试考点 · 先 `findOwned` 再 `update`，有什么问题？**
>
> 这是典型的 **TOCTOU**（Time-of-check to time-of-use）：查询和更新是两条 SQL，中间这一小段时间里数据可能被删除或转移归属。单用户场景几乎不会遇到，但正确写法是把归属条件塞进写操作本身：
>
> ```ts
> // 一次 SQL 完成“只更新自己的”，count === 0 说明不存在或不是你的
> const result = await this.prisma.app.updateMany({
>   where: { id, ownerId },
>   data: { name: dto.name, description: dto.description, mode: dto.mode },
> })
> if (result.count === 0) throw new NotFoundException('App not found')
> ```
>
> 本项目选了“先查后改”，因为它能复用 `findOwned` 并返回完整实体，读起来更直白；代价就是上面这个时间窗。**知道权衡在哪，比背一种写法更重要。**
>
> **追问：`updateMany` 能返回更新后的行吗？**
> 不能，它只返回 `{ count }`。所以要么再查一次（又多一次往返），要么接受“更新接口返回旧值”的风险。Prisma 的 `update` 支持 `where: { id, ownerId }` 吗？——`update` 的 `where` 必须是唯一键，复合条件只能用于 `updateMany`。这就是这里的真实取舍。

> **面试考点 · 为什么响应里的 `mode` 要 `as AppResponse['mode']`？**
> 数据库列是 `String`（Prisma 的 `String` 不是枚举），TS 推出来是 `string`；契约要求 `'chatflow' | 'workflow'`。写入时 DTO 的 `@IsIn` 已经保证只有两个值，所以出口处的断言是安全的。
> 注意这是**唯一允许出现 `as` 的位置**：数据库 → 契约的边界。前端消费响应时不用 `as`，而是 Zod 校验（见阶段 1 的 `06-前端登录页.md`）。

---

## 4. Controller

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
// 类级别 Guard：这个控制器下所有路由都要求登录，不用每个方法写一遍
@UseGuards(JwtAuthGuard)
export class AppsController {
  constructor(private readonly appsService: AppsService) {}

  @Get()
  list(@CurrentUser() payload: JwtPayload): Promise<AppListResponse> {
    // payload.sub 就是用户 id；Controller 不碰数据库
    return this.appsService.list(payload.sub)
  }

  @Post()
  // Nest 的 POST 默认返回 201，与契约一致，无需额外装饰器
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
  // DELETE 成功默认回 200；契约要求 204 无响应体，必须显式声明
  @HttpCode(204)
  async remove(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.appsService.remove(payload.sub, id)
  }
}
```

> **面试考点 · 为什么 Controller 里看不到 `try/catch` 和状态码拼装？**
> `NotFoundException` 抛出去后，由 Nest 内置的异常层转成 `{statusCode, message, error}`，再经过阶段 1 注册的 `HttpErrorFilter` 保证形状一致。Controller 只表达“做什么”，不负责“怎么变成 HTTP”。**这就是分层：路由层不写协议细节。**
>
> **追问：`@HttpCode(204)` 不写会怎样？**
> 默认返回 `200`，且 Nest 会尝试序列化返回值。`remove` 返回 `void`，客户端会收到 `200` + 空 body；契约写的是 `204 No Content`，契约测试立刻红。**框架默认值不是契约，差一个状态码就是破坏性差异。**

> **面试考点 · `@UseGuards` 放在类上还是方法上？**
> 类上 = 整个控制器都生效，适合“这个资源全部需要登录”。方法上 = 精确控制，适合同一个控制器里混有公开接口（比如阶段 10 的 `/public/apps/{id}/run`）。
> 顺序上 Guard 在 Pipe 之前执行：**没登录的请求连 DTO 校验都不会做**，直接 401。这既是性能考虑，也避免把校验细节暴露给未认证的调用方。

---

## 5. 模块挂载

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
  // 用到了 AuthModule 导出的 JwtAuthGuard，所以要 import
  imports: [AuthModule],
  controllers: [AppsController],
  providers: [AppsService],
})
export class AppsModule {}
```

**完整文件路径：`apps/api-ts/src/app.module.ts`**（阶段 2 的快照）

```ts
import { Module } from '@nestjs/common'

import { AppsModule } from './apps/apps.module'
import { AuthModule } from './auth/auth.module'
import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
import { PrismaModule } from './prisma/prisma.module'

/**
 * 根模块。阶段 1 加入 PrismaModule（全局数据库）与 AuthModule（认证）。
 * 阶段 2 加入 AppsModule（应用管理）。
 */
@Module({
  imports: [PrismaModule, AuthModule, AppsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

> **面试考点 · 为什么 `AppsModule` 不需要 imports `PrismaModule`？**
> `PrismaModule` 标了 `@Global()`，全局模块的导出对所有模块可见，只需要在根模块 import 一次。**全局模块省样板代码，但也让依赖关系变得隐式**——看 `AppsModule` 的 imports 你不知道它用了 Prisma。团队项目里要克制使用 `@Global()`。
>
> `JwtAuthGuard` 不一样：它由 `AuthModule` 提供并 `exports`，所以必须显式 `imports: [AuthModule]`。**显式依赖比隐式全局更容易排查。**

---

## 6. 验证

先登录拿 token：

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'alice@example.com'; password = 'password123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.accessToken)" }
```

```powershell
# 1. 创建 → 201（AppResponse）
$app = Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ name = 'support-bot' } | ConvertTo-Json)
$app | Format-List
```

预期：`mode = chatflow`（没传也有默认值）、`description = null`、`ownerId` 是 alice 的 id、`createdAt` 形如 `2026-10-18T03:20:11.482Z`。

```powershell
# 2. 列表 → 200（AppListResponse），新建的排在最前
Invoke-RestMethod -Uri http://localhost:3001/apps -Headers $h | ConvertTo-Json -Depth 5

# 3. 详情
Invoke-RestMethod -Uri "http://localhost:3001/apps/$($app.id)" -Headers $h

# 4. PATCH 只改名字，description 保持原样
Invoke-RestMethod -Method Patch -Uri "http://localhost:3001/apps/$($app.id)" `
  -Headers $h -ContentType 'application/json' `
  -Body (@{ name = 'support-bot-v2' } | ConvertTo-Json) | Format-List
```

```powershell
# 5. 越权：用 bob 的 token 访问 alice 的应用 → 404（不是 403）
$bob = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType 'application/json' `
  -Body (@{ email = 'bob@example.com'; password = 'password123' } | ConvertTo-Json)
try {
  Invoke-RestMethod -Uri "http://localhost:3001/apps/$($app.id)" `
    -Headers @{ Authorization = "Bearer $($bob.accessToken)" }
} catch { $_.ErrorDetails.Message }
```

预期：

```json
{"statusCode":404,"message":"App not found","error":"Not Found"}
```

```powershell
# 6. 无 token → 401
try { Invoke-RestMethod -Uri http://localhost:3001/apps } catch { $_.ErrorDetails.Message }
```

```powershell
# 7. 删除 → 204 且无 body（用 curl.exe 看状态行）
curl.exe -i -X DELETE "http://localhost:3001/apps/$($app.id)" -H "Authorization: Bearer $($login.accessToken)"
```

预期：

```text
HTTP/1.1 204 No Content
```

```powershell
# 8. 再查详情 → 404
try { Invoke-RestMethod -Uri "http://localhost:3001/apps/$($app.id)" -Headers $h } catch { $_.ErrorDetails.Message }
```

```powershell
# 9. 校验错误：name 为空 / mode 不在枚举 / 多传 ownerId
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps -Headers $h `
    -ContentType 'application/json' -Body (@{ name = '' } | ConvertTo-Json)
} catch { $_.ErrorDetails.Message }

try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps -Headers $h `
    -ContentType 'application/json' -Body (@{ name = 'x'; mode = 'chat' } | ConvertTo-Json)
} catch { $_.ErrorDetails.Message }

try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps -Headers $h `
    -ContentType 'application/json' -Body (@{ name = 'x'; ownerId = 'someone-else' } | ConvertTo-Json)
} catch { $_.ErrorDetails.Message }
```

预期（第三条证明 `ownerId` 被 `forbidNonWhitelisted` 拒掉，伪造归属无效）：

```json
{"statusCode":400,"message":"name must be longer than or equal to 1 characters","error":"Bad Request"}
{"statusCode":400,"message":"mode must be one of the following values: chatflow, workflow","error":"Bad Request"}
{"statusCode":400,"message":"property ownerId should not exist","error":"Bad Request"}
```

---

## 7. 下一步

- `04-SQLAlchemy关系.md`：Python 侧映射 `apps` 表，`relationship` 正反向，**不建表、不写 trigger**。
- `05-FastAPI应用模块.md`：同一套归属校验与 404 语义，验证两套后端的 `apps` 行为逐字节一致。
