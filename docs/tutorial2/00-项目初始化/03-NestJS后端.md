# 03 · NestJS 后端

> 阶段 0 · 第 3 步
>
> 做完：`apps/api-ts` 启动在 `:3001`，`GET /health` 返回契约里的四个字段。
>
> **本篇面试考点**：装饰器与元数据 · DI/IoC · 请求生命周期 · CORS · 健康检查语义。

---

## 1. 应用配置

**完整文件路径：`apps/api-ts/package.json`**

```jsonc
{
  // 包名：pnpm --filter 用它定位
  "name": "@mini-dify/api-ts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    // 开发模式：nest 编译 + --watch 热重载
    "start:dev": "nest start --watch",
    // 生产编译：输出到 dist
    "build": "nest build",
    // 直接跑编译产物
    "start": "node dist/main.js"
  },
  "dependencies": {
    // 本地契约包：workspace:* 表示用仓库里的源码包，不是 npm 上的版本
    "@mini-dify/contract": "workspace:*",
    // Nest 核心装饰器、异常、管道等
    "@nestjs/common": "^11.0.0",
    // Nest 应用工厂与 DI 容器
    "@nestjs/core": "^11.0.0",
    // HTTP 适配器（底层是 Express）
    "@nestjs/platform-express": "^11.0.0",
    // 让 TypeScript 装饰器元数据可反射（Nest DI 依赖它）
    "reflect-metadata": "^0.2.2",
    // Nest 内部大量使用 RxJS
    "rxjs": "^7.8.1",
    // 读取 apps/api-ts/.env
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    // Nest CLI：nest start / nest build
    "@nestjs/cli": "^11.0.0",
    // 代码生成模板（CLI 依赖）
    "@nestjs/schematics": "^11.0.0",
    // Express 的类型；@nestjs/platform-express 的类型补齐
    "@types/express": "^5.0.0",
    // Node 类型（process、Buffer 等）
    "@types/node": "^22.0.0",
    // Nest CLI 的运行期依赖之一
    "ts-node": "^10.9.2",
    // TS 编译器
    "typescript": "^5.6.0"
  }
}
```

**完整文件路径：`apps/api-ts/tsconfig.json`**

```jsonc
{
  "compilerOptions": {
    // Nest 以 CommonJS 运行
    "module": "commonjs",
    // 不生成 .d.ts（应用不需要被别的包引用）
    "declaration": false,
    // 编译时去掉注释，减小产物
    "removeComments": true,
    // 生成装饰器元数据：Nest 靠它做依赖注入
    "emitDecoratorMetadata": true,
    // 开启装饰器语法
    "experimentalDecorators": true,
    // 允许 `import express from 'express'` 这类默认导入
    "allowSyntheticDefaultImports": true,
    // 输出 ES2022
    "target": "ES2022",
    // 生成 source map，便于断点调试
    "sourceMap": true,
    // 编译产物目录
    "outDir": "./dist",
    // 模块解析基准目录
    "baseUrl": "./",
    // 增量编译：只重编改动过的文件
    "incremental": true,
    // 跳过第三方 .d.ts 检查
    "skipLibCheck": true,
    // 严格类型检查
    "strict": true,
    // 兼容 CJS/ESM 互操作
    "esModuleInterop": true,
    // 文件名大小写必须一致（Windows 开发、Linux 部署时避免踩坑）
    "forceConsistentCasingInFileNames": true
  },
  // 只编译 src
  "include": ["src/**/*.ts"]
}
```

**完整文件路径：`apps/api-ts/nest-cli.json`**

```jsonc
{
  // Nest CLI 的配置 schema
  "$schema": "https://json.schemastore.org/nest-cli",
  // 使用官方脚手架集合
  "collection": "@nestjs/schematics",
  // 源码根目录
  "sourceRoot": "src",
  "compilerOptions": {
    // 每次 build 先删 dist，避免旧文件残留
    "deleteOutDir": true
  }
}
```

> **面试考点 · 装饰器到底做了什么？`emitDecoratorMetadata` 为什么必须开？**
>
> - **装饰器本质**：`@Controller('health')` / `@Get()` 只是函数调用，把元数据写到类或方法上；Nest 启动时扫描这些元数据，建立「路由 → 方法」的映射。
> - **两个编译选项**：`experimentalDecorators` 打开装饰器语法；`emitDecoratorMetadata` 让 TS 在 `design:paramtypes` 里写入构造函数参数的类型。
> - **`reflect-metadata`**：提供 `Reflect.getMetadata`，让 Nest 在运行期读到这些类型；没有它，DI 拿不到构造函数参数类型。
> - **参数类型 ≠ 接口**：`emitDecoratorMetadata` 只能记录类、构造函数这类运行时存在的值；`interface` 会被擦除，所以 `constructor(private svc: IHealthService)` 拿不到 token，必须用 `@Inject('TOKEN')` 或抽象类。
>
> **追问：为什么 Nest 大量依赖装饰器？**
> 它用装饰器把「路由、参数、权限、校验」声明在类上，框架在启动期统一注册；业务代码只写方法体，横切逻辑交给 Guard / Pipe / Interceptor。

---

## 2. 入口

**完整文件路径：`apps/api-ts/src/main.ts`**

```ts
// 必须放在所有 import 之前：先把 apps/api-ts/.env 注入 process.env，
// 后面的 process.env.PORT 才能读到文件里的值
import 'dotenv/config'

import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'

/**
 * 启动函数：创建 Nest 应用 → 放开跨域 → 监听端口。
 * 返回 Promise，因为创建与监听都是异步的。
 */
async function bootstrap(): Promise<void> {
  // 用根模块创建应用；Nest 会实例化模块里声明的 controller / provider
  const app = await NestFactory.create(AppModule)

  // 前端 :3000 调后端 :3001，浏览器会做跨域检查；开发阶段直接允许所有来源
  app.enableCors({ origin: true })

  // 端口优先读环境变量；Number() 把字符串转成数字，默认 3001
  const port = Number(process.env.PORT ?? 3001)

  // 开始监听；端口被占用会在这里抛错
  await app.listen(port)

  // 启动成功后打印，方便确认连的是哪一个后端
  console.log(`api-ts listening on http://localhost:${port}`)
}

// 调用启动函数；void 表示「不等待返回值」，避免 TS 的浮空 Promise 警告
void bootstrap()
```

> **面试考点 · CORS 到底是谁在拦？**
>
> - **同源策略是浏览器行为**：`http://localhost:3000` 调 `http://localhost:3001` 属于跨源（端口不同），浏览器会拦截响应；服务端其实收到了请求，只是响应被浏览器藏起来。
> - **简单请求 vs 预检**：GET + 简单头直接发；带 `Authorization`、`Content-Type: application/json` 的请求会先发 `OPTIONS` 预检，服务端必须正确响应 `Access-Control-Allow-*`。
> - **`origin: true`**：Nest 会把请求的 `Origin` 反射回 `Access-Control-Allow-Origin`，等价于「允许任意来源」；只适合开发，生产要白名单。
> - **`credentials: true`**：带 Cookie 时浏览器不允许 `Allow-Origin: *`，必须回显具体 Origin，并配 `Access-Control-Allow-Credentials: true`。
>
> **追问：Postman / curl 为什么不受 CORS 影响？**
> CORS 是浏览器实施的安全策略；命令行工具没有同源概念，所以能直接拿到响应。线上「接口 200 但前端报 CORS」通常就是服务端没回允许头。

---

## 3. 根模块

**完整文件路径：`apps/api-ts/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'

/**
 * 根模块：应用的装配清单。
 * - controllers：对外暴露 HTTP 路由的类
 * - providers：可被注入的服务实例
 */
@Module({
  // 阶段 0 只有健康检查
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

> **面试考点 · Nest 的依赖注入是怎么工作的？**
>
> - **IoC 容器**：`providers: [HealthService]` 把类注册进容器；Nest 负责实例化、缓存、按需注入，业务代码不 `new`。
> - **Token**：默认 token 是类本身；`constructor(private readonly healthService: HealthService)` 让容器按类型查表。`@Injectable()` 表示「这个类可以被容器管理」。
> - **单例**：默认 scope 是 `DEFAULT`（单例），整个应用共享一个 `HealthService` 实例；所以 service 里不要放「每请求独立」的可变状态。
> - **分层**：Controller 只做 HTTP 适配（取参、返回），Service 放业务；这样 Service 可以脱离 HTTP 被单测，Controller 可以只测路由。
>
> **追问：如果两个实现都实现同一个接口，怎么注入？**
> TypeScript 的接口在运行期不存在，不能当 token。要用 `@Inject('HEALTH_SERVICE')` + `providers: [{ provide: 'HEALTH_SERVICE', useClass: ... }]`，或用抽象类当 token。
>
> **追问：循环依赖怎么办？**
> 先拆分层/抽公共模块；实在拆不开再用 `forwardRef()`。`forwardRef` 是止血，不是设计目标。

---

## 4. 健康检查

**完整文件路径：`apps/api-ts/src/health/health.controller.ts`**

```ts
import { Controller, Get } from '@nestjs/common'
import type { HealthResponse } from '@mini-dify/contract'

import { HealthService } from './health.service'

/**
 * GET /health。
 * @Controller('health') 把路由前缀设为 /health；@Get() 表示匹配 GET。
 */
@Controller('health')
export class HealthController {
  /**
   * 构造函数注入：Nest 的 DI 容器会自动把 HealthService 实例传进来。
   * private readonly：只在类内部使用，且不允许重新赋值。
   */
  constructor(private readonly healthService: HealthService) {}

  /**
   * 处理 GET /health。
   * 返回类型显式写成契约类型，保证字段与 openapi.yaml 一致。
   */
  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth()
  }
}
```

> **面试考点 · 一个请求进 Nest 后依次经过什么？**
>
> 顺序（高频八股）：
> `中间件 Middleware` → `守卫 Guard` → `拦截器 Interceptor（前）` → `管道 Pipe` → `Controller` → `Service` → `拦截器 Interceptor（后）` → `异常过滤器 ExceptionFilter`。
>
> - **Middleware**：最外层，能改 `req/res`，拿不到「即将执行哪个 handler」。
> - **Guard**：决定「能不能进」，返回 boolean/Promise；登录鉴权放这里（阶段 1 的 `JwtAuthGuard`）。
> - **Pipe**：转换与校验入参（`ValidationPipe` + DTO），失败抛 400。
> - **Interceptor**：在方法前后加逻辑（日志、耗时、统一响应包装），基于 RxJS。
> - **ExceptionFilter**：兜底所有异常，统一错误体（阶段 1 的 `HttpErrorFilter`）。
>
> **追问：Guard 和 Middleware 都能拦请求，区别？**
> Middleware 只能按路径粗粒度处理；Guard 能拿到 `ExecutionContext`（handler、class、metadata），可以做基于 `@Roles()` 的细粒度鉴权。
>
> **追问：`@Get()` 的方法体是同步的，为什么 Nest 还能做异步？**
> 方法可以返回 Promise/Observable，Nest 会 await/订阅后再写响应；`async getHealth()` 与同步返回在调用方看来一致。

**完整文件路径：`apps/api-ts/src/health/health.service.ts`**

```ts
import { Injectable } from '@nestjs/common'
import type { HealthResponse } from '@mini-dify/contract'

/**
 * 健康检查服务。
 * @Injectable() 让这个类进入 DI 容器，可被别的类通过构造函数注入。
 */
@Injectable()
export class HealthService {
  /**
   * 组装健康检查响应。
   * 字段必须与 packages/contract/openapi.yaml 的 HealthResponse 完全一致。
   */
  getHealth(): HealthResponse {
    return {
      // 固定值：能走到这里就说明服务活着
      status: 'ok',
      // 服务标识：用来区分当前连的是 TS 还是 Python 后端
      service: 'api-ts',
      // 与 package.json 的 version 保持一致
      version: '0.1.0',
      // toISOString() 天然满足「UTC + 毫秒 + Z 结尾」的契约要求
      time: new Date().toISOString(),
    }
  }
}
```

> **面试考点 · `/health` 应该检查数据库吗？**
>
> - **Liveness（存活）**：只回答「进程还在吗」。当前实现就是 liveness：不查 DB，避免数据库抖动导致容器被误杀。
> - **Readiness（就绪）**：回答「能不能接流量」，通常要检查 DB/Redis/下游依赖；部署时用它决定是否把实例加进负载均衡。
> - **本项目的取舍**：阶段 0 只做 liveness，保证两套后端的最小契约；阶段 1 接数据库后可加 `/health/ready`，或在 `/health` 里返回 `checks`。
>
> **追问：健康检查返回 200 就一定健康吗？**
> 不一定。若只检查进程，依赖全挂也会 200；所以生产通常拆两个端点，并给 readiness 设置超时与失败阈值。

---

## 5. 启动与验证

```powershell
# 在仓库根执行：先编译契约，再启动 Nest（--watch）
pnpm dev:api-ts
```

预期终端输出：

```
api-ts listening on http://localhost:3001
```

另开一个终端：

```powershell
# 请求健康检查
Invoke-RestMethod http://localhost:3001/health | ConvertTo-Json
```

预期：

```json
{
  "status": "ok",
  "service": "api-ts",
  "version": "0.1.0",
  "time": "2026-11-08T12:34:56.789Z"
}
```

| 检查项 | 预期 |
| --- | --- |
| `pnpm dev:api-ts` | 打印 `api-ts listening on http://localhost:3001` |
| `GET /health` | 200，四个字段齐全 |
| `service` | `api-ts` |
| `time` | 24 个字符，以 `Z` 结尾 |
| 改 `health.service.ts` 保存 | `--watch` 自动重启，无需手动重跑 |

下一步：用 FastAPI 实现同一份契约 → [04-FastAPI后端.md](./04-FastAPI后端.md)
