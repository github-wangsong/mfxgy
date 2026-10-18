# 04 · 契约包与 TypeScript 类型

> 所属：阶段 0 · 项目初始化
> 本篇覆盖：新建 `packages/contract` 契约包 → 写 OpenAPI 规范 → 写 TypeScript 类型 → 编译供后端消费
> **本篇首次教学：TypeScript 类型系统**（后续笔记只引用，不再重讲）

---

## 1. 本篇目标

- 建立全项目**唯一契约**的物理位置：`packages/contract`。
- 会写 OpenAPI 规范、会写与之对应的 TypeScript 类型。
- 把契约编译成可被 NestJS 消费的产物（`dist`）。
- **理解 TypeScript 类型是什么、为什么需要、以及它在运行期的真相。**

**验收标准**：`pnpm run build:contract` 成功，产出 `packages/contract/dist/index.js` 与 `index.d.ts`。

## 2. 前置条件

- 阶段 0 的 Step 1（根工作区 / `pnpm-workspace.yaml`）已完成。
- `pnpm install` 已执行过。

---

## 3. 先看清要做什么（为什么需要契约包）

两套后端（NestJS / FastAPI）要「行为一致」。如果接口定义散落在两边，必然分叉。所以：

```
packages/contract/   ← 唯一真源（谁都不许自己发明接口）
   ├── openapi.yaml     人类/工具可读的规范
   └── src/index.ts     给 TypeScript 侧用的类型
        ↓ 编译
      dist/index.js + index.d.ts   ← NestJS 直接消费
```

**关键决定（见总纲 §5.5）**：先落契约，再写实现。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 |
| --- | --- | --- |
| `pnpm install` | 仓库根 | 装依赖；让 workspace 把 `@mini-dify/contract` 链接给其他包 |
| `pnpm run build:contract` | 仓库根 | 编译契约包 → 产出 `dist` |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 编译 NestJS，验证它确实能读到契约类型 |

> 注意：`package.json` 里 `dev:api-ts` 与 `build:api-ts` 都**先**跑 `build:contract`，保证契约总是最新的。

---

## 5. 第一步：契约包的 package.json

**完整文件路径：`packages/contract/package.json`**

```json
{
  "name": "@mini-dify/contract",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "openapi.yaml"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

**逐项解释**

- `"name": "@mini-dify/contract"`：包名带 scope（`@组织名/包名`）。其他包用 `"@mini-dify/contract": "workspace:*"` 引用它。
- `"main"` / `"types"`：告诉 Node 和 TypeScript「运行时代码」和「类型声明」各自在哪。
- `"build": "tsc -p tsconfig.json"`：用 TypeScript 编译器编译。

---

## 6. 第二步：契约包的 tsconfig.json

**完整文件路径：`packages/contract/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

**逐项解释（这些字段后面每个 TS 包都会遇到）**

| 字段 | 作用 |
| --- | --- |
| `target` | 编译到哪个 JS 版本 |
| `module: "CommonJS"` | 输出 CJS 模块。**为什么**：NestJS 默认也是 CJS，能直接 `require` 我们的产物 |
| `moduleResolution: "Node"` | 按 Node 规则解析模块 |
| `declaration: true` | **额外产出 `.d.ts` 类型声明**——没有它，别的包拿不到类型 |
| `outDir` / `rootDir` | 产物目录 / 源码根目录 |
| `strict: true` | 开启全部严格检查（推荐永远打开） |

---

## 7. 第三步：OpenAPI 规范（唯一真源）

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: mini-dify API
  version: 0.1.0
  description: >-
    唯一契约（单真源）。NestJS（api-ts）与 FastAPI（api-py）都必须实现本规范，
    并由同一套契约测试校验两者的响应结构、状态码与错误响应体一致。
servers:
  - url: http://localhost:3001
    description: api-ts (NestJS)
  - url: http://localhost:8000
    description: api-py (FastAPI)
paths:
  /health:
    get:
      operationId: getHealth
      summary: 健康检查
      responses:
        "200":
          description: 服务健康
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthResponse"

  /auth/register:
    post:
      operationId: register
      summary: 注册
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/RegisterRequest"
      responses:
        "201":
          description: 注册成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "409":
          $ref: "#/components/responses/Conflict"

  /auth/login:
    post:
      operationId: login
      summary: 登录
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/LoginRequest"
      responses:
        "200":
          description: 登录成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/TokenResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /auth/me:
    get:
      operationId: getCurrentUser
      summary: 当前登录用户
      security:
        - bearerAuth: []
      responses:
        "200":
          description: 当前用户
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  responses:
    BadRequest:
      description: 参数校验失败
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    Unauthorized:
      description: 未认证或凭证无效
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    Conflict:
      description: 资源冲突（如邮箱已存在）
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"

  schemas:
    HealthResponse:
      type: object
      additionalProperties: false
      required: [status, service, version, time]
      properties:
        status:
          type: string
          enum: [ok]
        service:
          type: string
          description: 服务标识，取值 api-ts 或 api-py
          examples: [api-ts]
        version:
          type: string
          examples: ["0.1.0"]
        time:
          type: string
          format: date-time
          description: ISO-8601 时间戳

    RegisterRequest:
      type: object
      additionalProperties: false
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          minLength: 8

    LoginRequest:
      type: object
      additionalProperties: false
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string

    UserResponse:
      type: object
      additionalProperties: false
      required: [id, email, role, createdAt]
      properties:
        id:
          type: string
        email:
          type: string
        role:
          type: string
          enum: [admin, member]
        createdAt:
          type: string
          format: date-time

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

    ErrorResponse:
      type: object
      additionalProperties: false
      required: [statusCode, message, error]
      properties:
        statusCode:
          type: integer
          examples: [401]
        message:
          type: string
          examples: [Invalid email or password]
        error:
          type: string
          examples: [Unauthorized]
```

**读法要点**

- `paths` 是接口清单；`components/schemas` 是可复用的数据结构。
- `$ref: "#/components/schemas/Xxx"`：**引用**定义，避免重复。
- `additionalProperties: false`：**禁止额外字段**——契约严格，多一个字段也算违约。
- `required`：必填字段清单。
- `enum`：取值只能是列出的这些（如 `role` 只能是 `admin` 或 `member`）。
- `format: date-time`：约定是 ISO-8601 字符串。
- `operationId`：给每个操作一个唯一名字，方便生成客户端 / 契约测试。

> 说明：`/auth/*` 三组接口是**阶段 1** 追加的；这里一并展示，因为它们与阶段 0 的 `/health` 同在唯一真源里。

---

## 8. 第四步：TS 类型（`src/index.ts`）

**完整文件路径：`packages/contract/src/index.ts`**

```ts
/**
 * 契约 TS 类型（由 openapi.yaml 派生）。
 *
 * 唯一真源是同仓库根目录下的 `packages/contract/openapi.yaml`；此文件保持与其逐字段一致。
 * 两套后端（NestJS / FastAPI）都必须返回符合本结构的数据。
 */

/** 契约版本；修改契约时递增，并与 openapi.yaml 的 info.version 保持同步。 */
export const CONTRACT_VERSION = '0.1.0'

/** GET /health 的响应体。 */
export interface HealthResponse {
  /** 固定为 'ok' */
  status: 'ok'
  /** 服务标识：api-ts | api-py */
  service: string
  /** 服务版本 */
  version: string
  /** ISO-8601 时间戳 */
  time: string
}

/** POST /auth/register 请求体。 */
export interface RegisterRequest {
  email: string
  /** 至少 8 位 */
  password: string
}

/** POST /auth/login 请求体。 */
export interface LoginRequest {
  email: string
  password: string
}

/** 用户对外视图（**绝不包含密码哈希**）。 */
export interface UserResponse {
  id: string
  email: string
  role: 'admin' | 'member'
  /** ISO-8601 时间戳 */
  createdAt: string
}

/** POST /auth/login 的响应体。 */
export interface TokenResponse {
  accessToken: string
  tokenType: 'Bearer'
  /** 有效期（秒） */
  expiresIn: number
  user: UserResponse
}

/**
 * 统一错误响应体。
 *
 * 两套后端必须产出**同一形状**的错误体：NestJS 默认就是该形状，
 * FastAPI 需要自定义异常处理器把默认的 `{detail}` 归一化过来。
 */
export interface ErrorResponse {
  statusCode: number
  message: string
  error: string
}
```

---

## 9. 【技术教学 · 首次】TypeScript 类型系统

> 规则：本节是 TS 类型的**首次教学**，后续笔记遇到类型只写「见阶段 0·04」并直接使用。

### 9.1 类型是什么、为什么需要

JavaScript 本身**没有类型约束**：

```js
function addUser(user) {
  return user.email.toUpperCase()   // user 是什么？不知道
}
```

TypeScript 给你的代码**加上类型标注**，让编译器在**编译期**就把这类错误指出来：

```ts
function addUser(user: { email: string }) {
  return user.email.toUpperCase()
}
```

**核心收益**：错误从「运行时崩溃」提前到「编辑器里就报红」。

### 9.2 基本语法：类型标注

```ts
let age: number = 30
let name: string = 'mini-dify'
let enabled: boolean = true
```

冒号后面的就是类型。多数情况下可以省略（编译器能推断）。

### 9.3 接口（`interface`）——给对象「定形状」

```ts
interface UserResponse {
  id: string
  email: string
  role: 'admin' | 'member'
  createdAt: string
}
```

- 它描述「一个对象应该长什么样」。
- 在本项目里，`UserResponse` 就是契约里用户对象的样子。

### 9.4 联合类型与字面量类型（本项目的关键用法）

```ts
role: 'admin' | 'member'   // 只能是这两个字符串之一
status: 'ok'               // 只能是 'ok'
tokenType: 'Bearer'
```

这叫「**字面量类型**」+「**联合类型**」。效果：你写 `role: 'boss'` 编译器立刻报错。
→ 这正是契约里 `enum: [admin, member]` 在 TS 侧的等价表达。

对比：`role: string` 就太宽了，任何字符串都放行，失去约束力。

```ts
// ❌ 会被编译器拒绝
const u: UserResponse = { id: '1', email: 'a@b.c', role: 'boss', createdAt: '...' }
```

### 9.5 类型 vs 值：两个不同的世界

```ts
export const CONTRACT_VERSION = '0.1.0'   // 值：运行期真实存在
export interface HealthResponse { ... }   // 类型：只在编译期存在
```

**这是最关键的一点**：

> TypeScript 的类型**在编译后会被完全擦除**（type erasure）。编译产物 `dist/index.js` 里**没有** `HealthResponse`；只有 `dist/index.d.ts` 里留下它的声明。

所以：

| | 运行期是否存在 | 能否用来校验用户请求 |
| --- | --- | --- |
| `interface` | ❌ 不存在 | ❌ 不能 |
| `const/函数` | ✅ 存在 | ✅ 能 |

这就引出一个重要后果：**TS 的类型不能用来校验「外部传入的数据」**（比如 HTTP 请求体）。要校验运行期数据，必须用别的工具（本项目用 `class-validator` / 前端用 `zod`）——这也是后面 NestJS 侧要装 `ValidationPipe` 的根本原因。

> 对照：Python 的 Pydantic 模型**既是类型也是运行期校验器**（阶段 1 会讲）。这是两种语言在本项目里最本质的差异之一。

### 9.6 注释即文档

`/** ... */` 是 **JSDoc 注释**。写在成员上方，编辑器悬停时会显示——相当于「类型的文档」。

### 9.7 小结（记住这几条就够用）

1. 类型让错误提前到编译期。
2. `interface` 描述对象形状；`A | B` 表示「只能是其中之一」。
3. 字面量类型（`'ok'`）是最强的约束。
4. **类型在运行期被擦除**——不能用于校验外部数据。
5. `export const` 是值，`export interface` 是类型，两者可以同名不同物。

---

## 10. 第五步：编译并验证

**命令（在仓库根执行）**

```bash
pnpm run build:contract
```

**目的**：把 `src/index.ts` 编译成 `dist/index.js`（运行时代码）+ `dist/index.d.ts`（类型声明）。

**预期输出**

```
$ pnpm --filter @mini-dify/contract build
$ tsc -p tsconfig.json
```

**验证产物是否存在**

```bash
ls packages/contract/dist
# index.d.ts  index.js
```

**验证 NestJS 能消费**

```bash
pnpm --filter @mini-dify/api-ts build
```

如果 `apps/api-ts` 里能 `import type { HealthResponse } from '@mini-dify/contract'` 且编译通过，就说明契约包被正确链接与解析。

---

## 11. 验收自测

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 编译成功 | `pnpm run build:contract` | 无报错，`dist/` 出现两个文件 |
| 类型可被消费 | `pnpm --filter @mini-dify/api-ts build` | 编译通过 |
| 契约与类型一致 | 人工比对 `openapi.yaml` 与 `src/index.ts` | 字段一一对应 |

---

## 12. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 没产出 `.d.ts` | 别的包 import 报「找不到类型声明」 | `tsconfig` 少了 `"declaration": true` |
| 模块格式不匹配 | NestJS 里 `require` 失败 | `module` 必须与消费方一致（此处用 `CommonJS`） |
| 误以为类型能校验请求 | 接口收到非法数据却没被挡住 | 类型运行期被擦除；要用 `class-validator`/`zod`/Pydantic |
| 契约与类型不同步 | 改了 `openapi.yaml` 忘了改 `src/index.ts` | 二者是**手工同步**关系；后续可考虑自动生成 |

---

## 13. 本阶段技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| TypeScript 类型系统（interface / 联合 / 字面量 / 类型擦除） | **首次教学于本篇** |
| OpenAPI 规范（paths / components / `$ref` / `additionalProperties`） | 首次教学于本篇 |
| `tsconfig` 关键字段（declaration / outDir / module） | 首次教学于本篇 |
