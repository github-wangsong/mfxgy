# 05 · NestJS 起步

> 所属：阶段 0 · 项目初始化
> 本篇覆盖：搭好 `apps/api-ts` → 写 `main.ts` 启动入口 → 用 Module / Controller / Service 实现 `GET /health` → 编译并实测
> **本篇首次教学：TypeScript 装饰器（`@Module` / `@Controller` / `@Get` / `@Injectable`）、依赖注入（构造函数注入）、NestJS 模块系统、`NestFactory` 启动、CORS、端口监听**

---

## 1. 本篇目标

- 让 `apps/api-ts`（NestJS）**跑起来**，对外提供 `GET /health`。
- 理解 NestJS 的组织方式：**模块（Module）→ 控制器（Controller）→ 服务（Service）**。
- 理解 **装饰器**是什么、怎么写、NestJS 为什么靠它。
- 理解 **依赖注入**是什么、NestJS 怎么用构造函数注入。
- 会读 `main.ts` 里 `NestFactory` 启动、`enableCors`、`listen` 三段。
- 让接口返回**符合契约**的结构（`HealthResponse`）。

**验收标准**：`GET http://localhost:3001/health` 返回

```json
{"status":"ok","service":"api-ts","version":"0.1.0","time":"2026-10-18T00:30:52.879Z"}
```

（`time` 是当次请求的 ISO-8601 时间戳，会变；其余字段固定。）

## 2. 前置条件

- 阶段 0 的 Step 03（`pnpm-workspace.yaml` + 根 `package.json`）已完成，且 `pnpm install` 成功。
- 阶段 0 的 Step 04（`packages/contract` 契约包）已完成：`@mini-dify/contract` 已能编译出 `dist`（**否则本篇编译会失败，见 §10**）。

---

## 3. 先看清要做什么

本阶段我们要的是一条最短的「可运行链路」：

```
浏览器 / curl
     │  GET /health
     ▼
HealthController   ← 接请求（@Controller('health') + @Get()）
     │  调用
     ▼
HealthService      ← 干活（返回 {status, service, version, time}）
     │
     ▼
    返回符合契约 HealthResponse 的 JSON
```

`AppModule` 是「总装配图」，把 Controller 和 Service 登记进去；`main.ts` 负责**启动**整个应用。

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 先把契约包编译出 `dist`（NestJS 需要它的类型声明） | 产出 `packages/contract/dist/index.js` 与 `index.d.ts` |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 用 `nest build` 编译 NestJS | 成功，产出 `apps/api-ts/dist/main.js` 等 |
| `pnpm dev:api-ts` | 仓库根 | 先编译契约，再以 watch 模式启动 NestJS | 打印 `api-ts listening on http://localhost:3001` |
| `curl http://localhost:3001/health` | 任意目录 | 验证接口 | 返回 `HealthResponse` JSON |

> 说明：`dev:api-ts` 脚本定义是 `pnpm run build:contract && pnpm --filter @mini-dify/api-ts start:dev`，所以它已自动包含「先编译契约」。

---

## 5. 完整代码

### 5.1 api-ts 的 package.json

**完整文件路径：`apps/api-ts/package.json`**

```json
{
  "name": "@mini-dify/api-ts",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@mini-dify/contract": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@prisma/client": "^6.0.0",
    "bcryptjs": "^2.4.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "dotenv": "^16.4.5",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "prisma": "^6.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.0"
  }
}
```

**重点字段**

- `"@mini-dify/contract": "workspace:*"`：用本地契约包（机制见 `00-项目初始化/03-monorepo与pnpm-workspace.md`）。
- `"@nestjs/platform-express"`：NestJS 默认的 HTTP 适配器（底层用 Express）。
- `"reflect-metadata"`：**装饰器运行时元数据**的依赖——NestJS 靠它读取装饰器信息做依赖注入，**必不可少**。
- `"start:dev": "nest start --watch"`：用 Nest CLI 启动并监听源码变化自动重启。

### 5.2 api-ts 的 tsconfig.json

**完整文件路径：`apps/api-ts/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

**与「04 契约包 tsconfig」不同的关键字段**（`declaration` / `outDir` / `module` / `strict` 见 `00-项目初始化/04-契约包与TypeScript类型.md`）：

| 字段 | 作用 |
| --- | --- |
| `experimentalDecorators: true` | **开启装饰器语法**。不打开，`@Controller()` 直接编译报错 |
| `emitDecoratorMetadata: true` | 让编译器**额外产出**装饰器所需的类型元数据（NestJS 依赖注入靠它推断参数类型） |
| `esModuleInterop` / `allowSyntheticDefaultImports` | 兼容 CommonJS 与 ES 模块的 `import` 写法 |

> 一句话：**NestJS 项目的 tsconfig，`experimentalDecorators` 与 `emitDecoratorMetadata` 必须为 `true`**，否则框架直接瘫掉。

### 5.3 构建用 tsconfig（tsconfig.build.json）

**完整文件路径：`apps/api-ts/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

**说明**：它 `extends` 上面的 `tsconfig.json`，只额外**排除**测试文件。`nest build` 默认用它，保证**测试代码不进入产物**。

### 5.4 Nest CLI 配置（nest-cli.json）

**完整文件路径：`apps/api-ts/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

**说明**

- `sourceRoot: "src"`：源码根目录。
- `deleteOutDir: true`：每次构建**先清空** `dist`，避免旧产物残留导致「改了没生效」的假象。

### 5.5 启动入口（main.ts）

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

> 说明：`ValidationPipe`、`HttpErrorFilter` 是**阶段 1**（账号与认证）追加的校验/错误处理设施；此处一并展示，因为它们就在当前 `main.ts` 里。`enableCors` + `listen(3001)` 是阶段 0 的核心。

### 5.6 根模块（app.module.ts）

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

> 说明：阶段 0 时它只登记 `HealthController` / `HealthService`；`PrismaModule` / `AuthModule` 是阶段 1 加入的（见 `01-账号与认证/`）。这里给出**当前完整内容**。

### 5.7 健康检查控制器（health.controller.ts）

**完整文件路径：`apps/api-ts/src/health/health.controller.ts`**

```ts
import { Controller, Get } from '@nestjs/common'
import type { HealthResponse } from '@mini-dify/contract'

import { HealthService } from './health.service'

/** GET /health —— 契约见 packages/contract/openapi.yaml。 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth()
  }
}
```

> `import type { HealthResponse }` 的**类型只用于编译期**（见 `00-项目初始化/04-契约包与TypeScript类型.md`），运行期会擦除。

### 5.8 健康检查服务（health.service.ts）

**完整文件路径：`apps/api-ts/src/health/health.service.ts`**

```ts
import { Injectable } from '@nestjs/common'
import type { HealthResponse } from '@mini-dify/contract'

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'api-ts',
      version: '0.1.0',
      time: new Date().toISOString(),
    }
  }
}
```

---

## 6. 【技术教学 · 首次】TypeScript 装饰器

### 6.1 是什么

**装饰器（decorator）** 是 TypeScript/JavaScript 的一种**语法糖**，写法是 `@名字(...)`，贴在**类、方法、属性或参数**前面，用来自动给它们「附加元数据或改变行为」。

你可以把它理解成：**不修改类本身，而是在类上面贴一张「标签」，框架读标签后做相应的事。**

### 6.2 基本语法

```ts
function Log(target: any) {
  console.log('被装饰的是：', target.name)
}

@Log
class MyService {}
```

- `@Log` 贴在类上，`Log` 是一个函数，运行时会被调用，收到被装饰的目标。
- 需要在 `tsconfig` 里打开 `experimentalDecorators: true`（本项目已开）。

装饰器也可以带参数（**装饰器工厂**：一个返回装饰器的函数）：

```ts
@Controller('health')   // 'health' 是传给 @Controller 的参数
```

### 6.3 本项目的四个装饰器

| 装饰器 | 贴在哪 | 作用 |
| --- | --- | --- |
| `@Module({...})` | 类 | 声明这是一个 **NestJS 模块**，`{...}` 里登记 imports / controllers / providers |
| `@Controller('health')` | 类 | 声明这是一个**控制器**，并指定**路由前缀** `/health` |
| `@Get()` | 方法 | 声明该方法处理 **GET 请求**（无参 = 挂在控制器前缀上，即 `GET /health`） |
| `@Injectable()` | 类 | 声明该类**可以被依赖注入系统创建和管理**（Service 必须贴） |

**为什么 NestJS 全靠它**：NestJS 的核心就是「**读装饰器 → 自动装配**」。你贴 `@Controller('health')`，Nest 就把这个类注册成路由处理器；贴 `@Get()`，Nest 就知道用 GET 方法把请求路由过来。**如果没有装饰器，这些关系都要你自己手写注册代码。**

### 6.4 装饰器 + 元数据的一个前提

`emitDecoratorMetadata` 让编译器把「方法的参数类型」也写成元数据，Nest 才能**知道** `HealthController` 构造函数里那个参数是 `HealthService`（见下节）。

---

## 7. 【技术教学 · 首次】依赖注入（DI）

### 7.1 是什么

**依赖注入（Dependency Injection, DI）**：不要自己 `new` 依赖对象，而是**声明你需要什么，由框架创建并「注入」给你**。

### 7.2 对比：手写 new vs 注入

```ts
// ❌ 传统写法：控制器自己创建 service
class HealthController {
  private healthService = new HealthService()
}
```

```ts
// ✅ 注入写法：声明需要，框架负责给
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}
}
```

### 7.3 NestJS 的构造函数注入

看这一行：

```ts
constructor(private readonly healthService: HealthService) {}
```

它等价于「声明一个私有只读字段 `healthService`，并通过构造函数参数把它赋进来」。**Nest 在创建 `HealthController` 时会自动 `new HealthService()` 并传入。**

**为什么能自动**：靠 §6 里提到的装饰器元数据——Nest 从 `@Injectable()` + `emitDecoratorMetadata` 得知「这个构造参数的类型是 `HealthService`」，于是去容器里找/建一个 `HealthService` 给它。

### 7.4 三个角色：Provider / 容器 / 消费者

- **Provider（提供者）**：`HealthService` 贴 `@Injectable()`，登记进模块的 `providers`。
- **容器（IoC Container）**：Nest 的内部登记处，负责创建与缓存实例。
- **消费者**：`HealthController` 在构造函数里「要」一个 `HealthService`。

**收益**：类之间解耦——控制器不知道 service 怎么造、依赖什么；测试时可替换成假实现。

> 记住公式：**`@Injectable()` 的类 + 登记到 `providers` + 构造函数里作为参数声明 = 被注入。**

---

## 8. 【技术教学 · 首次】NestJS 模块系统

### 8.1 是什么

**Module** 是 NestJS 的**组织单元**：一个应用由若干模块拼成，每个模块把相关的 Controller（接请求）和 Service（干活）打包在一起。

### 8.2 `@Module` 的三个字段

```ts
@Module({
  imports: [PrismaModule, AuthModule],  // 依赖的其它模块
  controllers: [HealthController],      // 本模块的控制器
  providers: [HealthService],           // 本模块的服务（可被注入）
})
export class AppModule {}
```

| 字段 | 含义 |
| --- | --- |
| `imports` | 引入其它模块，从而能用它们 `exports` 出来的 Provider |
| `controllers` | 登记路由处理器 |
| `providers` | 登记可被注入的服务/实例 |

### 8.3 根模块

`AppModule` 是**根模块**，应用从这个模块开始装配。本项目阶段 0 只有健康检查，所以根模块只登记了 `HealthController` / `HealthService`；后续按总纲 §3.2 依次加 `Apps` / `Workflow` / `Agent` 等模块（现在已加 `PrismaModule` / `AuthModule`）。

**模块化收益**：功能内聚、边界清晰——「健康检查」的所有代码都在 `health/` 目录里，看目录就知道功能。

---

## 9. 【技术教学 · 首次】`NestFactory` 启动 / CORS / 端口监听

### 9.1 `NestFactory.create(AppModule)`

```ts
const app = await NestFactory.create(AppModule)
```

`NestFactory` 是 NestJS 的**启动工厂**。它根据根模块 `AppModule` 把所有 Controller / Provider 装配起来，返回一个「应用实例」。它是 `main.ts` 里**第一件要做的事**。

### 9.2 CORS（跨域）

```ts
app.enableCors({ origin: true })
```

**CORS（跨域资源共享）** 是浏览器的安全机制：默认禁止「`http://localhost:3000` 的页面」去请求「`http://localhost:3001` 的接口」（端口不同即跨域）。后端必须显式**允许**，浏览器才放行。

- `{ origin: true }`：回显请求来源、放行。阶段 0 学习场景直接放开；生产环境应收紧为白名单。

### 9.3 端口监听

```ts
await app.listen(3001)
```

让应用**监听 3001 端口**。这与契约 `openapi.yaml` 里 `servers` 的 `http://localhost:3001` 对应。前端通过 `NEXT_PUBLIC_API_BASE` 指向它。

### 9.4 `async / await` 与 `void bootstrap()`

`bootstrap` 是 `async` 函数（启动是异步的，需 `await`）。末尾 `void bootstrap()` 表示「调用它，但故意不处理返回的 Promise」。

> 顺带认识两行**阶段 1 的**全局设施：
> - `app.useGlobalPipes(new ValidationPipe({...}))`：开启**全局参数校验**，让 `class-validator` 生效，非法请求统一返回 400（原理详见 `01-账号与认证/`）。
> - `app.useGlobalFilters(new HttpErrorFilter())`：**全局异常过滤器**，把错误体归一成契约的 `{ statusCode, message, error }`。

---

## 10. 编译并实测

### 10.1 先编译契约（关键前置）

```bash
pnpm run build:contract
```

**预期**：产出 `packages/contract/dist/index.js` 与 `packages/contract/dist/index.d.ts`。

### 10.2 编译 NestJS

```bash
pnpm --filter @mini-dify/api-ts build
```

**目的**：执行 `nest build`，把 TS 编译成 `dist`。

**预期**：无报错，产出 `apps/api-ts/dist/main.js` 等文件。

### 10.3 启动开发服务器

```bash
pnpm dev:api-ts
```

**目的**：先编译契约，再以 watch 模式启动 NestJS。

**预期输出**（关键一行）：

```
api-ts listening on http://localhost:3001
```

### 10.4 实测接口

```bash
curl http://localhost:3001/health
```

**预期返回**（实测，`time` 随请求变化）：

```json
{"status":"ok","service":"api-ts","version":"0.1.0","time":"2026-10-18T00:30:52.879Z"}
```

---

## 11. 验收自测

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 契约已编译 | `pnpm run build:contract` | 产出 `dist/index.js` + `index.d.ts` |
| 编译通过 | `pnpm --filter @mini-dify/api-ts build` | 产出 `apps/api-ts/dist/main.js` |
| 服务启动 | `pnpm dev:api-ts` | 打印 `api-ts listening on http://localhost:3001` |
| 接口正确 | `curl http://localhost:3001/health` | `{"status":"ok","service":"api-ts","version":"0.1.0","time":"...Z"}` |
| 契约一致 | 比对返回体与 `openapi.yaml#/components/schemas/HealthResponse` | 字段与取值一一对应 |

---

## 12. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **没先编译契约** | NestJS 编译报「找不到类型声明 `@mini-dify/contract`」 | `apps/api-ts` 依赖契约的 `dist`。先 `pnpm run build:contract`（`pnpm dev:api-ts` 已含此步） |
| **装饰器报错** | `@Controller` 处编译错误 | `tsconfig.json` 少了 `experimentalDecorators: true` |
| **注入失败** | 运行时报 `Nest can't resolve dependencies of HealthController` | 忘了 `@Injectable()`，或没把 `HealthService` 登记进 `providers` |
| **浏览器请求被拦** | 前端报 CORS 错误 | 没 `app.enableCors(...)`；或 `origin` 配错 |
| **端口被占用** | 启动报 `EADDRINUSE` | 3001 已被占用：关闭占用进程，或改 `listen` 端口（同时要改契约 `servers`） |
| **改了代码没生效** | 接口行为还是旧的 | watch 掉线，或 `dist` 有旧产物；重启 `pnpm dev:api-ts`（`deleteOutDir: true` 会在构建时清理） |

---

## 13. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| TypeScript 装饰器（`@Module` / `@Controller` / `@Get` / `@Injectable`） | **首次教学于本篇** |
| 依赖注入（构造函数注入 / Provider / IoC 容器） | **首次教学于本篇** |
| NestJS 模块系统（`imports` / `controllers` / `providers` / 根模块） | **首次教学于本篇** |
| `NestFactory` 启动（`create` / `enableCors` / `listen`） | **首次教学于本篇** |
| CORS 与端口监听 | 首次教学于本篇 |
