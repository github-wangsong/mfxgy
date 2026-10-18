# 07 · Next.js 起步

> 所属：阶段 0 · 项目初始化
> 本篇覆盖：`apps/web` 用 Next.js App Router 起一个页面，**调用后端 `/health` 并渲染结果**，且能通过环境变量切换后端
> **本篇首次教学：React 组件与 JSX · `'use client'`（Server / Client Component）· `useState` / `useEffect` · Next.js App Router · `NEXT_PUBLIC_*` 环境变量**
> （后续笔记遇到这些技术只引用，不再重讲）

---

## 1. 本篇目标

- 让前端 `apps/web` 能在 <http://localhost:3000> 跑起来。
- 页面能**请求后端 `/health`** 并把返回的 JSON 显示出来。
- **不改代码**，仅用环境变量 `NEXT_PUBLIC_API_BASE` 就能在 `api-ts(:3001)` 与 `api-py(:8000)` 之间切换。
- 理解 React 与 Next.js App Router 的基本工作方式。

**验收标准**

1. 浏览器打开 <http://localhost:3000>，页面显示：
   - 一级标题：`mini-dify · 阶段 0 · 项目初始化`
   - 一行：`当前后端：http://localhost:3001`
   - 灰色块里渲染出后端返回的 JSON：`{"status": "ok", "service": "api-ts", ...}`
   - **没有**红色的「连接失败」提示；
2. 把 `NEXT_PUBLIC_API_BASE` 改成 `http://localhost:8000` 并**重启** dev server 后，页面变为显示 `api-py` 的信息。

> 后端地址栏里的「当前后端」直接来自环境变量，所以它同时是**后端切换是否生效**的可视化证据。

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| Node / pnpm、`pnpm install` 已执行 | 阶段 0 · 01 / 03 |
| 契约包 `@mini-dify/contract` 已构建 | 阶段 0 · 04（契约包与 TypeScript 类型） |
| **至少一套后端在跑**：`api-ts` 在 **3001**（阶段 0 · 05）或 `api-py` 在 **8000**（阶段 0 · 06） | 05 / 06 |

> 前端本身不依赖具体哪套后端——契约一致（见 04 篇），所以切后端只改一个环境变量。

---

## 3. 先看清要做什么

`apps/web` 的关键文件（**文件名即路由**，这是 App Router 的核心约定）：

```
apps/web/
├── package.json          # 依赖与脚本（dev = next dev -p 3000）
├── tsconfig.json         # TS 配置（Next 推荐值）
├── next.config.mjs       # Next 配置
├── next-env.d.ts         # Next 自动生成，勿手改
├── .env.example          # 环境变量模板（NEXT_PUBLIC_API_BASE）
└── app/                  # App Router 的根目录
    ├── layout.tsx        # 根布局：包裹所有页面的外壳，必须存在
    └── page.tsx          # 路由 "/" 的页面
```

**本步要实现的链路**：

```
浏览器(3000) → page.tsx 的 useEffect 里 fetch(API_BASE + '/health') → 后端(3001/8000)
                                            ↑ 地址来自 NEXT_PUBLIC_API_BASE
```

即前端是**纯客户端**行为：页面加载后由浏览器去请求后端（所以会受跨域规则约束，见第 9 节）。

---

## 4. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `pnpm install` | **仓库根** | 装 web 的依赖（Next / React / TS） | 已完成过即可跳过 |
| `pnpm dev:web` | **仓库根** | 启动 Next 开发服务器，监听 **3000** | 打印 `Ready in ...` 与 `Local: http://localhost:3000` |
| 浏览器打开 <http://localhost:3000> | —— | 验收页面 | 见第 6 节实测结果 |

> `pnpm dev:web` 是根脚本，内容为 `pnpm --filter @mini-dify/web dev`，最终执行 `apps/web/package.json` 里的 `next dev -p 3000`。它与 api-ts 的 `dev:api-ts` 一样，**由 pnpm 通过 `--filter` 在子包目录内执行**，所以没有 06 篇那种「工作目录不对」的问题。

---

## 5. 完整代码

### 5.1 `apps/web/package.json`

**完整文件路径：`apps/web/package.json`**

```json
{
  "name": "@mini-dify/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

**逐项解释**

- `"name": "@mini-dify/web"`：带 scope 的包名，根脚本用 `--filter @mini-dify/web` 定位它。
- `"dev": "next dev -p 3000"`：开发模式，固定端口 3000（`-p` = `--port`）。
- `"build"` / `"start"`：生产构建与启动（`start` 也固定在 3000）。
- 依赖里 **`next` + `react` + `react-dom` 三件套**：Next.js 是 React 的框架，React 提供组件能力。
- `devDependencies`：`typescript` 和 **`@types/*` 类型声明包**——`@types/react` 等让编辑器知道 React 的 API 类型（TS 类型系统见 04 篇 §9）。

### 5.2 `apps/web/tsconfig.json`

**完整文件路径：`apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**与契约包 tsconfig 不同的关键字段**（`target`/`strict` 等已在 04 篇 §6 讲过，此处只讲差异）

| 字段 | 作用 |
| --- | --- |
| `"jsx": "preserve"` | **保留 JSX**，交给 Next 的编译器处理（TS 自己不改写 JSX） |
| `"noEmit": true` | **不产出文件**：Next 用自己的构建管线，`tsc` 只做类型检查 |
| `"moduleResolution": "bundler"` | 按打包器规则解析模块，适配 Next |
| `"lib": [... "dom" ...]` | 声明浏览器全局对象可用（`fetch`、`window` 等） |
| `"paths": { "@/*": ["./*"] }` | 路径别名：`@/xxx` → 项目根下的 `xxx`（04 篇的 `#/*` 未用到此别名） |
| `"plugins": [{ "name": "next" }]` | 编辑器插件，增强 Next 相关提示 |

### 5.3 `apps/web/next.config.mjs`

**完整文件路径：`apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

export default nextConfig
```

**解释**

- `.mjs` 后缀 = **ESM 模块**的 JS（用 `import` / `export`，而非 `require`）。
- 默认导出 `nextConfig` 对象：Next 启动时读取它。
- `reactStrictMode: true`：React 严格模式，**开发环境**下会刻意把副作用执行两次（目的是暴露不纯的副作用）。这会导致 `useEffect` 在开发模式下跑两遍——不是 bug，是特性。

### 5.4 `apps/web/app/layout.tsx`

**完整文件路径：`apps/web/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react'

export const metadata = {
  title: 'mini-dify',
  description: '类 Dify 应用开发平台（阉割版）—— 阶段 0 骨架',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 24 }}>{children}</body>
    </html>
  )
}
```

**逐项解释**

- 这是 **App Router 的根布局**，`app/` 下**必须**有它；它会包裹所有页面（即 `children`）。
- `export const metadata = { title, description }`：Next 的 **Metadata API**，用来设置页面标题等 `<head>` 内容。
- `export default function RootLayout({ children }: { children: ReactNode })`：
  - 组件是函数，返回 JSX；
  - `children` 是**注入进来的页面内容**（本步即 `page.tsx`）；
  - `: { children: ReactNode }` 是 TS 的类型标注（ReactNode 表示「任何可渲染内容」）。
- JSX 里直接写 `<html>` / `<body>`：App Router 要求根布局包含这两个标签。
- `style={{ fontFamily: ..., margin: 24 }}`：JSX 的内联样式是**对象**（而非 CSS 字符串），外面一层 `{}` 是「插入表达式」，里面一层 `{}` 是对象字面量。

### 5.5 `apps/web/app/page.tsx`

**完整文件路径：`apps/web/app/page.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

type HealthResponse = {
  status: 'ok'
  service: string
  version: string
  time: string
}

// 通过环境变量切换后端：api-ts(:3001) 或 api-py(:8000)，前端代码零改动。
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'

export default function Page() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<HealthResponse>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <h1>mini-dify · 阶段 0 · 项目初始化</h1>
      <p>
        当前后端：<code>{API_BASE}</code>
      </p>
      <p>
        切换后端：改 <code>NEXT_PUBLIC_API_BASE</code>（<code>http://localhost:3001</code> = api-ts，
        <code>http://localhost:8000</code> = api-py）后重启 web。
      </p>
      {error !== null && <p style={{ color: 'crimson' }}>连接失败：{error}</p>}
      {data !== null && (
        <pre style={{ background: '#f5f5f5', padding: 12 }}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </main>
  )
}
```

**逐行解释**

- `'use client'`：**文件第一行**的指令，把它标记为**客户端组件**（见第 10.2 节）。没有它，`useState`/`useEffect` 会报错。
- `type HealthResponse = {...}`：契约 `HealthResponse` 的 TS 版（04 篇讲过 TS 类型，此处直接用）。注意 `status: 'ok'` 是**字面量类型**。
- `process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'`：
  - `process.env.X` 读环境变量；
  - `??` 是**空值合并运算符**：左边是 `undefined`/`null` 才取右边。所以**没配 env 时默认打 3001**——这正是首次实测页面显示 `http://localhost:3001` 的原因（当时并没有 `.env` 文件）。
- `const [data, setData] = useState<HealthResponse | null>(null)`：**状态钩子**（见第 10.3 节），`data` 初值为 `null`。
- `useEffect(() => {...}, [])`：**副作用钩子**（见第 10.4 节），`[]` 表示只在挂载时执行一次，里面发起 `fetch`。
- `let cancelled = false` + `return () => { cancelled = true }`：**清理函数**。组件卸载（或热重载）后把标志置真，避免异步回来时对已卸载组件 `setState`。
- `if (!res.ok) throw new Error(...)`：HTTP 状态码非 2xx 视作失败，抛出后进入 `.catch`。
- `res.json() as Promise<HealthResponse>`：`as` 是**类型断言**（告诉编译器「这个 Promise 解析出的就是该类型」）。
- `err instanceof Error ? err.message : String(err)`：`unknown` 类型的错误要**先收窄再使用**（TS `strict` 要求）。
- 渲染部分：
  - `<h1>` / `<p>` / `<code>` / `<pre>` 都是 JSX 标签；
  - `{API_BASE}`：把变量插入页面；
  - `{error !== null && <p ...>}`：**短路与**——条件为真才渲染该 `<p>`；「连接失败」提示就是这么出现的（正常时不存在）；
  - `{data !== null && (<pre ...>{JSON.stringify(data, null, 2)}</pre>)}`：拿到数据后用等宽字体美化输出 JSON。

### 5.6 `apps/web/.env.example`

**完整文件路径：`apps/web/.env.example`**

```ini
# 前端指向的后端地址（契约一致，切换后端无需改代码）
# api-ts (NestJS)
NEXT_PUBLIC_API_BASE=http://localhost:3001
# api-py (FastAPI) —— 取消注释即可切换
# NEXT_PUBLIC_API_BASE=http://localhost:8000
```

**解释**

- `.env.example` 是**模板**，Next **不会**读它；要用就复制成 `.env` 或 `.env.local`（见第 8 节）。
- 变量名必须带 **`NEXT_PUBLIC_` 前缀**才会暴露给浏览器（见第 10.5 节）。

---

## 6. 启动并验证

**命令（在仓库根执行）**

```bash
pnpm dev:web
```

**预期输出（节选）**

```
> @mini-dify/web@0.0.0 dev
> next dev -p 3000

   ▲ Next.js 15.1.x
   - Local:        http://localhost:3000
   - Network:      http://192.168.x.x:3000

 ✓ Starting...
 ✓ Ready in 1.x s
```

**浏览器实测结果（<http://localhost:3000>）**

- 页面一级标题：`mini-dify · 阶段 0 · 项目初始化`
- 第二行：`当前后端：http://localhost:3001`
- 灰色等宽块中渲染成功：

```json
{
  "status": "ok",
  "service": "api-ts",
  "version": "0.1.0",
  "time": "..."
}
```

- **没有**红色「连接失败」提示 → 说明浏览器成功跨域请求到了 `api-ts`（3001）。

> 注意：本次之所以显示 3001，是因为当时**没有 `.env`**，代码回退到默认值（`?? 'http://localhost:3001'`）。要让配置显式生效，见下一节。

---

## 7. 切换后端（不改代码）

1. 在 `apps/web` 下把模板复制为 `.env`（或 `.env.local`）：

   ```bash
   cd apps/web
   copy .env.example .env
   ```

2. 编辑 `apps/web/.env`，把生效那行改为 api-py：

   ```ini
   NEXT_PUBLIC_API_BASE=http://localhost:8000
   ```

3. **重启** dev server（在跑 `pnpm dev:web` 的终端按 `Ctrl+C`，再重新 `pnpm dev:web`），刷新页面。

   预期：`当前后端：http://localhost:8000`，渲染出 `{"status": "ok", "service": "api-py", ...}`。

> 前提是 api-py 已在 8000 运行（见 06 篇）。

---

## 8. 验收自测

| 检查项 | 操作 | 预期 |
| --- | --- | --- |
| 页面可访问 | 打开 <http://localhost:3000> | 显示标题与「当前后端」 |
| 能取到后端数据 | 观察灰色块 | 渲染 `{"status":"ok","service":"api-ts",...}` |
| 无跨域失败 | 观察是否有红色提示 | 无「连接失败」 |
| 切换后端生效 | 改 `NEXT_PUBLIC_API_BASE=http://localhost:8000` → 重启 → 刷新 | 显示 `api-py` |
| 关闭后端的表现 | 停掉后端再刷新页面 | 出现红色「连接失败：...」（用于确认提示逻辑正常） |

---

## 9. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **跨域被拦** | 页面显示「连接失败：Failed to fetch」，但用 curl 打后端正常 | 浏览器同源策略：3000 页面读 8000 响应须由**后端**允许。api-py 已加 `CORSMiddleware`（06 篇 §10.5）；api-ts 亦需开启 CORS。curl 不执行同源策略，所以「curl 通、浏览器不通」是典型跨域症状 |
| **改了 `NEXT_PUBLIC_*` 不生效** | 改了 `.env` 刷新页面却还是旧地址 | 这类变量在**构建/启动时被内联**进产物，**必须重启** dev server；仅刷新浏览器无效（热重载也不一定覆盖，稳妥做法是 `Ctrl+C` 重启） |
| `.env.example` 不生效 | 改了它但什么都没变 | Next **不加载** `.env.example`，它只是模板；要复制成 `.env` / `.env.local` |
| 忘记 `'use client'` | 终端/浏览器报错：`useState` / `useEffect` 只能在 Client Component 里用 | 用到了 Hook 的文件第一行必须写 `'use client'`（见第 10.2 节） |
| `localhost` 偶发连不上 | 服务已起，但请求偶发失败/超时 | 已知 `localhost` 解析竞态（IPv6 `::1` 与 IPv4 混用）。**改用 `127.0.0.1` 更稳**，例如 `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000` |
| `useEffect` 开发模式跑两遍 | 看到 `/health` 被请求两次 | `reactStrictMode: true` 的刻意行为，生产构建不会；代码本身无需改 |
| 端口 3000 被占 | `Port 3000 is in use` / 自动改用 3001 | 上次 dev server 没退干净。结束占用进程，或 `next dev -p 其他端口`（改了端口也要同步注意与后端的跨域白名单） |

---

## 10. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 0 · 07」并直接使用。

### 10.1 React 组件与 JSX

**是什么**：React 把界面拆成**组件**——一个「输入 props、返回要渲染的 UI 描述」的函数。组件返回值用 **JSX** 写：一种「长得像 HTML、实际是 JavaScript 表达式」的语法。

**基本语法**

```tsx
function Hello({ name }: { name: string }) {
  return <h1>Hello, {name}!</h1>
}
```

要点：

| 规则 | 说明 |
| --- | --- |
| 组件名**首字母大写** | `Page`、`RootLayout`；小写会被当成 HTML 标签 |
| 返回值只能有**一个根元素** | 本例分别返回 `<main>` / `<html>` |
| 用 `{}` 插值 | `{name}`、`{API_BASE}` 把表达式渲染进页面 |
| 属性用驼峰 | `className`（不是 `class`）、`fontFamily`（不是 `font-family`） |
| 内联样式是对象 | `style={{ color: 'crimson' }}` |
| 条件渲染用 `&&` / 三元 | `{error !== null && <p>...}` |
| 列表渲染用 `map` + `key` | 本篇暂未用到 |

**本例为什么这么用**：`app/page.tsx` 的 `Page` 就是一个组件，它把「标题 + 后端地址 + 数据/错误」拼成一张页面。

### 10.2 Server Component 与 Client Component（`'use client'`）

**是什么**：App Router 里组件分两类：

| | Server Component（默认） | Client Component（`'use client'`） |
| --- | --- | --- |
| 在哪执行 | 只在**服务器**渲染，产物是 HTML | 服务器**先**渲染成 HTML → 再在**浏览器**「激活」（hydration） |
| 能用 Hook（`useState`/`useEffect`） | ❌ 不能 | ✅ 能 |
| 能用浏览器 API（`window`、`fetch` 到任意地址） | ❌ 不能 | ✅ 能 |
| 体积 | 不进浏览器 JS 包 | 进浏览器 JS 包 |

**基本语法**：在文件**第一行**（必须是最顶部）写指令：

```tsx
'use client'
```

**本例为什么这么用**：

- `app/layout.tsx` **没有** `'use client'` → 是 Server Component，只做静态外壳，最省 JS；
- `app/page.tsx` 有 `'use client'` → 因为要用 `useState`/`useEffect`，并且要**在浏览器里** `fetch` 后端（`localhost:3001` 是用户机器上的地址，服务器渲染时无从得知）。
- 一句话判据：**用 Hook 或要跑在浏览器里的，就加 `'use client'`**。

### 10.3 `useState` —— 组件状态

**是什么**：让组件「记住」一个值；值变化会触发**重新渲染**。

**基本语法**

```tsx
const [value, setValue] = useState(initialValue)
```

- 返回一个二元组：当前值 + 更新函数；
- `useState<HealthResponse | null>(null)` 里的 `<...>` 是**泛型**，指定状态类型；初值 `null` 表示「还没拿到数据」。

**本例为什么这么用**：需要两个状态——`data`（后端返回）与 `error`（失败信息）。**二选一**：成功时有 `data`、失败时有 `error`，页面据此渲染不同内容。

> 为什么不用普通变量：普通变量在函数每次执行时都被重置，且改写它**不会**让 React 重渲染。状态由 React 托管，改了才刷新界面。

### 10.4 `useEffect` —— 副作用

**是什么**：渲染之外的「副作用」（请求数据、订阅、定时器）写在这里。

**基本语法**

```tsx
useEffect(() => {
  // 要做的事
  return () => { /* 清理（可选） */ }
}, [依赖数组])
```

| 依赖数组 | 执行时机 |
| --- | --- |
| `[]` | 只在**挂载**时执行一次 |
| `[a, b]` | 挂载时 + `a` 或 `b` 变化时 |
| 省略 | 每次渲染后都执行（常是 bug 来源） |

**本例为什么这么用**：

- `[]`：页面一出现就请求一次 `/health`，不需要重复；
- `return () => { cancelled = true }`：**清理函数**。请求是异步的，若组件在响应回来前被卸载（或开发模式下重挂载），回调里再 `setData` 会作用到「已经不在的组件」上；用 `cancelled` 标志位挡住即可。
- `.then/.catch` 链：成功写 `data`，失败写 `error`（`error !== null` 才渲染红色提示）。

### 10.5 Next.js App Router（文件即路由）

**是什么**：Next.js 的 App Router 用**目录结构定义路由**，约定文件名有固定含义：

| 文件 | 含义 |
| --- | --- |
| `app/layout.tsx` | 布局。包住同级及下级所有页面；根布局**必须**导出默认组件并渲染 `{children}` |
| `app/page.tsx` | 页面。对应路由 **`/`** |
| `app/about/page.tsx` | 对应路由 `/about`（本项目后续会用类似方式加页面） |

**要点**

- 没有 `app/layout.tsx` 就无法启动；`children` 就是「被套进来的页面」。
- `export const metadata = {...}` 是 Next 的 Metadata API，最后体现为浏览器标签页标题。
- 打包与开发服务器由 Next 提供：`next dev` 起服务、`next build` 出产物——这也是 `tsconfig` 里 `noEmit: true`（TS 只做检查、不负责产出）的原因。

**本例为什么这么用**：只要在 `app/` 下放一个 `page.tsx`，访问 `/` 就能看到它，无需手写路由表。

### 10.6 `NEXT_PUBLIC_*` 环境变量

**是什么**：Next 区分两类环境变量：

| 前缀 | 可见范围 | 用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_` | **浏览器也能读**（会被内联进前端产物） | 公开配置：API 地址、公共 Key 等 |
| 无前缀（如 `DATABASE_URL`） | **仅服务端** | 密钥、连接串等**绝不能**进前端的东西 |

**基本语法**

```tsx
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'
```

**为什么这么设计**：浏览器代码对用户完全可见，所以用前缀来**强制显式声明「这个变量可以公开」**，防止误把密钥暴露到前端。

**关键注意**：`NEXT_PUBLIC_*` 的值在**构建/启动时被写入产物**，运行时改环境不会生效——**必须重启 dev server**（第 9 节首坑）。

**本例为什么这么用**：把「打哪套后端」变成纯配置项。因为契约一致（04 篇），换后端只换地址、**代码零改动**——这也是全项目「两套后端行为一致」在 UI 上的直接体现。

---

## 11. 与 api-py / api-ts 的关系（一句话回顾）

```
契约（04 篇）── 前端按契约类型渲染 ──┐
        ├── api-ts（05 篇，:3001）──┤
        └── api-py（06 篇，:8000）──┘  ← NEXT_PUBLIC_API_BASE 决定打哪套
```

前端不感知具体实现，只依赖契约；后端切换靠环境变量。至此**阶段 0 的三条链路（契约 / 两套后端 / 前端）全部连通**，可以进入 08 篇做整体验收。

---

## 12. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| React 组件与 JSX | **首次教学于本篇** |
| Server Component / Client Component 与 `'use client'` | **首次教学于本篇** |
| `useState` | **首次教学于本篇** |
| `useEffect`（依赖数组 / 清理函数） | **首次教学于本篇** |
| Next.js App Router（`app/layout.tsx` / `app/page.tsx`、Metadata API） | **首次教学于本篇** |
| `NEXT_PUBLIC_*` 环境变量（前缀可见性 / 需重启） | **首次教学于本篇** |
