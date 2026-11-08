# 05 · Next.js 前端与阶段验收

> 阶段 0 · 第 5 步
>
> 做完：前端 `:3000` 能请求任意一套后端的 `/health`；改一个环境变量即可切换后端，页面代码不动。
>
> **本篇面试考点**：RSC 与 Client Component · `useEffect` 清理与竞态 · `NEXT_PUBLIC_*` 构建期内联 · 同源策略与 CORS · TS 类型擦除与 Zod 运行期校验。

---

## 1. 前端配置

**完整文件路径：`apps/web/package.json`**

```jsonc
{
  // 包名：pnpm --filter 用它定位
  "name": "@mini-dify/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    // 开发服务器：固定 3000，避免和 api-ts 的 3001 冲突
    "dev": "next dev -p 3000",
    // 生产构建
    "build": "next build",
    // 跑构建产物
    "start": "next start -p 3000"
  },
  "dependencies": {
    // Next 15（App Router）
    "next": "^15.1.0",
    // React 19
    "react": "^19.0.0",
    // React 的 DOM 渲染器
    "react-dom": "^19.0.0",
    // 运行期结构校验：把后端 JSON 当 unknown 校验成契约类型
    "zod": "^4.6.7"
  },
  "devDependencies": {
    // Node 类型
    "@types/node": "^22.0.0",
    // React 类型
    "@types/react": "^19.0.0",
    // ReactDOM 类型
    "@types/react-dom": "^19.0.0",
    // TS 编译器
    "typescript": "^5.6.0"
  }
}
```

**完整文件路径：`apps/web/tsconfig.json`**

```jsonc
{
  "compilerOptions": {
    // 输出目标语法
    "target": "ES2022",
    // 可用类型库：DOM + 可迭代对象 + 最新 ES
    "lib": ["dom", "dom.iterable", "esnext"],
    // 允许 .js 文件参与编译（Next 生成文件需要）
    "allowJs": true,
    // 跳过第三方类型检查
    "skipLibCheck": true,
    // 严格模式
    "strict": true,
    // Next 自己负责编译产物，tsc 只做类型检查
    "noEmit": true,
    // CommonJS/ESM 互操作
    "esModuleInterop": true,
    // 交给打包器处理模块
    "module": "esnext",
    "moduleResolution": "bundler",
    // 允许 import JSON
    "resolveJsonModule": true,
    // 每个文件单独转译（Next 要求）
    "isolatedModules": true,
    // JSX 交给 Next 处理
    "jsx": "preserve",
    // 增量类型检查
    "incremental": true,
    // 启用 Next 的 TS 插件
    "plugins": [{ "name": "next" }],
    // 路径别名：@/ 指向 apps/web 根目录
    "paths": {
      "@/*": ["./*"]
    }
  },
  // 参与类型检查的文件
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**完整文件路径：`apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // 开发模式下用 StrictMode：提前暴露副作用清理问题
  reactStrictMode: true,
}

// ESM 默认导出
export default nextConfig
```

**完整文件路径：`apps/web/.env.example`**

```bash
# 前端请求的后端地址；改这一行即可切换后端
NEXT_PUBLIC_API_BASE=http://localhost:3001
# 切到 Python 后端：
# NEXT_PUBLIC_API_BASE=http://localhost:8000
```

```powershell
# 生成本地环境变量文件（Next 会自动读取）
Copy-Item apps/web/.env.example apps/web/.env.local
```

> **面试考点 · `NEXT_PUBLIC_*` 为什么改了必须重启？**
>
> - **构建期内联**：Next 在编译时把 `process.env.NEXT_PUBLIC_API_BASE` 替换成字符串字面量，产物里没有运行期读取；改环境变量不会生效。
> - **为什么要有 `NEXT_PUBLIC_` 前缀**：只有这个前缀的变量会被打进浏览器 bundle；不带前缀的变量只在服务端可见，客户端读到 `undefined`。
> - **安全边界**：`NEXT_PUBLIC_*` 等于公开常量，不能放密钥；密钥只能放服务端（Route Handler / Server Component）。
> - **切换后端的正确姿势**：改 `.env.local` → 重启 dev server（或重新 build）；只刷新页面不够。
>
> **追问：服务端渲染时读的是同一个变量吗？**
> Server Component / Route Handler 里读 `process.env.X` 是运行期读取；`NEXT_PUBLIC_*` 在客户端 bundle 里是构建期内联。同一变量在两端语义不同，这是 Next 环境变量的高频坑。

---

## 2. 根布局

**完整文件路径：`apps/web/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react'

/** 全站元数据：Next 会把它渲染成 <head> 里的 title / description。 */
export const metadata = {
  // 浏览器标签页标题
  title: 'mini-dify',
  // 页面描述
  description: '类 Dify 应用开发平台（教学版）',
}

/**
 * 根布局：每个页面都会被包在这里。
 * @param children 当前路由对应的页面组件
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // lang 声明中文，影响浏览器翻译与无障碍
    <html lang="zh-CN">
      <body
        style={{
          // 去掉浏览器默认外边距
          margin: 0,
          // 用系统字体，避免阶段 0 引入字体资源
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          // 页面背景
          background: '#f6f7f9',
          // 文字颜色
          color: '#1f2937',
        }}
      >
        {children}
      </body>
    </html>
  )
}
```

> **面试考点 · Server Component 和 Client Component 怎么分？**
>
> - **默认是 Server Component**：`app/layout.tsx`、`app/page.tsx` 不写 `'use client'` 时在服务端渲染，不能使用 `useState`、`useEffect`、事件处理。
> - **`'use client'` 是边界**：写在文件第一行，标记「这个模块及其子组件进入客户端 bundle」；`page.tsx` 要请求数据并维护三态，所以必须是 Client Component。
> - **RSC 的收益**：服务端组件不把组件代码发给浏览器，能直接读数据库/密钥；客户端组件只负责交互。
> - **不要滥用 `'use client'`**：边界越靠下越好；把交互抽成小客户端组件，页面其余部分保持服务端渲染。
>
> **追问：Client Component 能在服务端预渲染吗？**
> 能。Next 会先在服务端渲染它的初始 HTML（SSR），再由浏览器 hydration 接管交互；所以 `useEffect` 里的请求不会在服务端执行。

---

## 3. 首页：请求 /health

前端拿到的 JSON 是**不可信输入**。`as HealthResponse` 只是编译期断言，编译后会被完全擦除，运行期什么都不会检查。所以在写请求代码之前，先把「运行期契约」落成 Zod schema。

### 3.1 契约的 Zod 镜像

**完整文件路径：`apps/web/lib/schemas.ts`**

```ts
import { z } from 'zod'

/**
 * 契约里的统一时间戳：UTC、ISO-8601、毫秒精度、以 Z 结尾。
 * 对应 openapi.yaml 里所有 format: date-time 字段。
 */
const utcTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    '必须是 UTC + 毫秒 + Z 的 ISO-8601 时间',
  )

/**
 * GET /health 的响应体。
 * - strictObject：拒绝额外字段（对应契约 additionalProperties: false）
 * - literal('ok')：status 只允许这一个值（对应 enum: [ok]）
 */
export const healthResponseSchema = z.strictObject({
  /** 固定为 'ok' */
  status: z.literal('ok'),
  /** 服务标识：api-ts | api-py */
  service: z.string().min(1),
  /** 服务版本 */
  version: z.string().min(1),
  /** UTC 时间戳 */
  time: utcTimestampSchema,
})

/** 从 schema 推导类型：校验规则与 TS 类型只维护一份。 */
export type HealthResponse = z.infer<typeof healthResponseSchema>
```

> 后续每加一个接口，就在这个文件里追加对应的 `xxxResponseSchema`，再用 `z.infer` 导出类型。**不要再手写一份 interface**，否则 schema 和类型迟早会漂移。

### 3.2 读取响应的统一入口

**完整文件路径：`apps/web/lib/api.ts`**

```ts
import type { ZodError, ZodType } from 'zod'

/**
 * 把 ZodError 压成一行 `字段路径: 错误信息; …`。
 * 直接把 ZodError 塞进页面会是一大段 JSON，用户看不懂。
 */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.') || '(root)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

/**
 * 读取响应 JSON 并按 schema 校验。
 * 不符合契约时抛错（包含出错字段路径），由调用方的 catch 统一展示。
 */
export async function parseResponse<T>(
  res: Response,
  schema: ZodType<T>,
  label: string,
): Promise<T> {
  // 先收窄成 unknown：在通过 schema 校验之前，不信任任何字段
  const json: unknown = await res.json()
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`${label} 响应不符合契约：${formatZodError(parsed.error)}`)
  }
  return parsed.data
}

/**
 * 宽容版：任何失败（非法 JSON、结构不符）都返回 null。
 * 用于「拿不到就静默降级」的辅助数据，不阻塞主流程。
 */
export async function parseResponseOrNull<T>(
  res: Response,
  schema: ZodType<T>,
): Promise<T | null> {
  try {
    const json: unknown = await res.json()
    const parsed = schema.safeParse(json)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
```

> 文件里还会继续追加 `readApiErrorMessage`（统一解析错误体）、`parseEventData`（SSE 帧校验）、`parseArrayOrEmpty`（画布节点数组校验），分别在认证、执行引擎、画布阶段展开。

### 3.3 首页组件

**完整文件路径：`apps/web/app/page.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

import { formatZodError } from '@/lib/api'
import { healthResponseSchema, type HealthResponse } from '@/lib/schemas'

/**
 * 后端基地址。
 * NEXT_PUBLIC_* 在构建时被替换成字面量；没配时默认指向 NestJS。
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'

/** 页面样式：阶段 0 不引入 CSS 框架，全部内联。 */
const styles = {
  /** 页面容器 */
  main: {
    maxWidth: 880,
    margin: '0 auto',
    padding: '48px 20px',
  },
  /** 标题 */
  title: {
    margin: '0 0 8px',
    fontSize: 28,
  },
  /** 副标题 */
  subtitle: {
    margin: '0 0 24px',
    color: '#6b7280',
    fontSize: 14,
  },
  /** 卡片 */
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 20,
  },
  /** 状态行 */
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  /** 绿色状态点 */
  dotOk: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#10b981',
  },
  /** 红色状态点 */
  dotError: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#ef4444',
  },
  /** JSON 展示区 */
  pre: {
    margin: 0,
    padding: 16,
    borderRadius: 8,
    background: '#0f172a',
    color: '#e2e8f0',
    fontSize: 13,
    overflowX: 'auto',
  },
} as const

/** 首页：挂载时请求一次 /health，并展示成功 / 失败 / 检测中三态。 */
export default function Page() {
  /** 成功后的健康数据；null 表示还没有结果。 */
  const [health, setHealth] = useState<HealthResponse | null>(null)
  /** 失败信息；null 表示没有失败。 */
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    /** 组件卸载后置为 true，防止异步回调继续 setState。 */
    let cancelled = false

    /** 请求健康检查并更新状态。 */
    async function load(): Promise<void> {
      try {
        // 发起请求；浏览器会按后端地址做跨域预检
        const res = await fetch(`${API_BASE}/health`)

        // 非 2xx 一律当失败处理
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }

        // 第二层：JSON 解析。此刻数据仍不可信，所以断言为 unknown
        const json: unknown = await res.json()

        // 第三层：运行期结构校验；safeParse 不抛异常，失败时给出 issues 列表
        const parsed = healthResponseSchema.safeParse(json)
        if (!parsed.success) {
          // 拼出 `字段路径: 错误信息`，定位到底是哪个字段不符合契约
          throw new Error(`/health 响应不符合契约：${formatZodError(parsed.error)}`)
        }

        // 通过校验后 parsed.data 才是 HealthResponse
        if (!cancelled) {
          setHealth(parsed.data)
          setError(null)
        }
      } catch (err: unknown) {
        // unknown：必须先收窄类型才能读 message
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    // 调用异步函数；void 表示不等待
    void load()

    // 清理函数：组件卸载或依赖变化时执行
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>mini-dify</h1>
      <p style={styles.subtitle}>
        阶段 0 · 当前后端：<code>{API_BASE}</code>
      </p>

      <section style={styles.card}>
        <div style={styles.statusRow}>
          <span
            style={
              health !== null
                ? styles.dotOk
                : error !== null
                  ? styles.dotError
                  : { ...styles.dotOk, background: '#f59e0b' }
            }
          />
          <strong>
            {health !== null ? '服务正常' : error !== null ? '连接失败' : '检测中'}
          </strong>
        </div>

        {error !== null && <p style={{ color: '#b91c1c', margin: 0 }}>连接失败：{error}</p>}

        {health !== null && <pre style={styles.pre}>{JSON.stringify(health, null, 2)}</pre>}

        {health === null && error === null && (
          <p style={{ color: '#6b7280', margin: 0 }}>正在请求 {API_BASE}/health …</p>
        )}
      </section>
    </main>
  )
}
```

> 仓库当前首页已经扩展出「应用 / 知识库 / Agent」入口卡片并使用全局样式；本篇保留阶段 0 的最小实现，**请求与校验逻辑与仓库一致**。

> **面试考点 · 为什么后端返回的数据必须做运行期校验？**
>
> - **类型擦除**：`interface`、`type`、泛型、`as` 在编译后全部消失；`(await res.json()) as HealthResponse` 生成的 JS 就是 `await res.json()`，运行期没有任何检查。
> - **边界不可信**：后端版本不一致、网关返回错误页、代理注入 HTML、字段改名或变成 `null`，都会让前端在某个 `.map` 或 `undefined.xxx` 上崩掉，而且错误现场离根因很远。
> - **Zod 的做法**：schema 是运行期对象，`safeParse` 返回 `{ success, data }` 或 `{ success, error }`；`z.infer` 从 schema 反推 TS 类型，规则与类型只维护一份。
> - **`strictObject` vs `object`**：前者拒绝额外字段（对应契约 `additionalProperties: false`）；后者会静默剥离未知字段，适合「只关心部分字段」的响应。
> - **错误可读性**：`error.issues` 里有 `path` 与 `message`，拼成一行就能直接展示；`parse` 失败会抛异常，`safeParse` 适合自己控制错误展示的场景。
> - **只在校验边界做**：网络响应、SSE 帧、`localStorage`、用户输入的 JSON。schema 定义在模块顶层，不要在组件函数里每次 render 重新构造。
>
> **追问：Zod 和 Pydantic / class-validator 有什么区别？**
> 三者都是运行期校验，只是位置不同：Pydantic 在 FastAPI 的入参/出参，class-validator 在 NestJS 的 DTO，Zod 在浏览器这一侧。「后端已经校验过」不代表「到达浏览器的数据一定符合契约」——版本、代理、缓存、错误页都可能改变响应。
>
> **追问：Zod 会不会拖慢页面？**
> 单次响应的对象遍历成本很小；真正要注意的是别在 render 里创建 schema，以及避免对大数组做昂贵的 `transform`。本项目把 schema 放在模块顶层，天然只构造一次。

> **面试考点 · `useEffect` 里的请求为什么要 `cancelled` 标志？**
>
> - **竞态**：快速切换页面/重复挂载时，先发的请求可能后返回，把新状态覆盖成旧数据；`cancelled` 让过期请求的结果被丢弃。
> - **卸载后 setState**：组件已卸载还调 `setState`，React 18 不再警告，但仍是无效工作；清理函数把 `cancelled` 置 true，提前 return。
> - **依赖数组**：`[]` 表示只在挂载时执行一次；漏依赖会读到旧闭包值（stale closure），多依赖会重复请求，按 ESLint `exhaustive-deps` 提示补。
> - **StrictMode 双执行**：开发模式下 React 会刻意挂载→卸载→再挂载，`useEffect` 跑两次，用来暴露「没清理干净」的副作用；生产不会。
> - **`unknown` 收窄**：`catch (err: unknown)` 强制先判断 `instanceof Error`，不能直接读 `err.message`。
>
> **追问：为什么不在组件顶层直接 `await fetch`？**
> Client Component 的渲染函数必须同步返回 JSX；异步请求放在 `useEffect` 或事件回调里。
>
> **追问：`styles` 为什么写 `as const`？**
> 不加时对象属性会被推断成 `string`，`borderRadius: '50%'` 这类值失去字面量信息；`as const` 让整个对象只读并保留字面量类型，传给 `style` 时类型更精确。

---

## 4. 启动三端

三个终端，全部在仓库根执行：

```powershell
# 终端 1：NestJS
pnpm dev:api-ts

# 终端 2：FastAPI
pnpm dev:api-py

# 终端 3：Next.js
pnpm dev:web
```

打开浏览器：

```
http://localhost:3000
```

页面显示：

```json
{
  "status": "ok",
  "service": "api-ts",
  "version": "0.1.0",
  "time": "2026-11-08T12:34:56.789Z"
}
```

> **面试考点 · 前端明明能打开后端地址，页面里 fetch 却报 CORS？**
>
> - **浏览器同源策略**：`:3000` → `:3001` 端口不同即跨源；地址栏直接打开是导航请求，不受 CORS 限制，`fetch` 受限制。
> - **预检**：带自定义头/JSON body 时浏览器先发 `OPTIONS`；后端没返回 `Access-Control-Allow-Origin`、`Allow-Methods`、`Allow-Headers`，预检失败，真正的请求不会发出。
> - **凭证**：带 Cookie 时 `Allow-Origin` 不能是 `*`，要回显具体 Origin 并允许 credentials；本项目阶段 0 用 Bearer token，暂不涉及。
> - **代理方案**：生产常用同源反向代理（Nginx）把 `/api` 转发到后端，浏览器看不到跨源；开发期也可用 Next rewrites 代理。
>
> **追问：CORS 能防住服务端请求吗？**
> 不能。CORS 只约束浏览器；攻击者用 curl/服务端直接请求不受限制。真正的访问控制靠鉴权（JWT/API Key）与后端校验。

---

## 5. 切换后端

1. 打开 `apps/web/.env.local`；
2. 改成：

```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

3. 重启前端（`Ctrl+C` 后重新 `pnpm dev:web`；`NEXT_PUBLIC_*` 是构建期内联，热重载不一定生效）；
4. 刷新页面，`service` 变成 `api-py`。

**前端代码一行没改。**

---

## 6. 阶段 0 验收清单

```powershell
# 1) 两套后端都能返回契约结构
Invoke-RestMethod http://localhost:3001/health | ConvertTo-Json
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json

# 2) 字段名集合一致（无输出 = 一致）
$a = Invoke-RestMethod http://localhost:3001/health
$b = Invoke-RestMethod http://localhost:8000/health
Compare-Object ($a.PSObject.Properties.Name | Sort-Object) ($b.PSObject.Properties.Name | Sort-Object)

# 3) 时间戳都是 24 字符且以 Z 结尾
$a.time.Length   # 24
$b.time.Length   # 24
$a.time.EndsWith('Z')   # True
$b.time.EndsWith('Z')   # True

# 4) 前端可访问
Invoke-WebRequest http://localhost:3000 -UseBasicParsing | Select-Object StatusCode
```

| 检查项 | 通过标准 |
| --- | --- |
| 数据库容器 | `docker compose ps` 显示 `healthy` |
| NestJS | `:3001/health` 返回 `service: api-ts` |
| FastAPI | `:8000/health` 返回 `service: api-py` |
| 契约结构 | 两端字段名完全一致，时间都是 24 字符 `Z` |
| 前端 | `:3000` 页面显示 health JSON |
| 后端切换 | 改 `.env.local` 后页面 `service` 跟着变 |

**阶段 0 完成。** 下一阶段从账号与认证开始：契约加接口 → Prisma 建用户表 → NestJS 注册登录 → SQLAlchemy 对齐 → FastAPI 注册登录 → 前端登录页。
