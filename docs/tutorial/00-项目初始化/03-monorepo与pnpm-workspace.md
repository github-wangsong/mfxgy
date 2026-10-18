# 03 · monorepo 与 pnpm workspace

> 所属：阶段 0 · 项目初始化
> 本篇覆盖：把仓库变身为 **monorepo** → 用 `pnpm-workspace.yaml` 声明工作区 → 配好根 `package.json` 脚本与 `packageManager` → 执行首次 `pnpm install`
> **本篇首次教学：monorepo 概念与取舍、pnpm workspace（`packages` / `workspace:*` / `--filter`）、npm scripts、`packageManager` 字段**

---

## 1. 本篇目标

- 建立项目**物理骨架**：一个仓库里放多个包（apps 与 packages）。
- 理解 **monorepo** 是什么、为什么 mini-dify 选它、代价是什么。
- 学会 **pnpm workspace** 的三件套：`packages` 列表、`workspace:*` 协议、`--filter` 过滤执行。
- 学会用 **npm scripts** 把多包命令编排成「一键脚本」。
- 把根 `package.json` 的 `packageManager` 字段钉死 pnpm 版本。
- **理解 mini-dify 为什么要独立于 dify 官方仓库**。

**验收标准**：在仓库根执行 `pnpm install`，输出中能看到 `Scope: all 4 workspace projects`，且安装成功（本项目实测 `Packages: +340`，`Done in 33.1s using pnpm v12.10.1`）。

## 2. 前置条件

- 阶段 0 的 Step 01（环境准备：Node.js 22+ 与 pnpm 已装好）已完成。
- 已能在一个**空目录**里运行 `pnpm -v` 并看到版本号（本项目为 `12.10.1`）。

---

## 3. 先看清要做什么（为什么是 monorepo）

mini-dify 有 **两套后端 + 一个前端 + 一个契约包**：

```
mini-dify/
├── apps/web/         # Next.js 前端
├── apps/api-ts/      # NestJS 后端
├── apps/api-py/      # FastAPI 后端
├── packages/contract/ # 唯一契约（OpenAPI + TS 类型）
└── packages/shared/   # TS 侧共享类型与工具
```

这些包**互相引用**（前端 import 契约、NestJS import 契约），而且**必须一起改动、一起发布**（改了契约，两个后端都要跟）。如果拆成 5 个独立仓库，「改一个接口要发 5 个 PR、跨仓库对齐版本」会非常痛苦。

所以 mini-dify 用 **monorepo**：**一个 Git 仓库，多个包**。

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 |
| --- | --- | --- |
| `pnpm install` | 仓库根 | 读取 `pnpm-workspace.yaml`，为**所有** workspace 包安装依赖，并建立包之间的软链接 |

> 说明：其余命令（`build:contract`、`dev:api-ts` 等）由根脚本转发，后文与「04 / 05」篇会逐条讲。

---

## 5. 完整代码

### 5.1 工作区声明

**完整文件路径：`pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*

# pnpm 12 默认拦截依赖的构建脚本；Prisma 需要允许（用于生成引擎与 Client）。
allowBuilds:
  '@prisma/client': true
  '@prisma/engines': true
  prisma: true
```

### 5.2 根 package.json

**完整文件路径：`package.json`**

```json
{
  "name": "mini-dify",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@12.10.1",
  "scripts": {
    "build:contract": "pnpm --filter @mini-dify/contract build",
    "dev:web": "pnpm --filter @mini-dify/web dev",
    "dev:api-ts": "pnpm run build:contract && pnpm --filter @mini-dify/api-ts start:dev",
    "dev:api-py": "uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000",
    "build:api-ts": "pnpm run build:contract && pnpm --filter @mini-dify/api-ts build",
    "build:web": "pnpm --filter @mini-dify/web build"
  }
}
```

### 5.3 .gitignore

**完整文件路径：`.gitignore`**

```gitignore
# deps
node_modules/

# builds
dist/
.next/
out/
build/

# python
__pycache__/
*.py[cod]
.venv/
*.egg-info/

# env
.env
.env.local
.env.*.local

# editor / os
.DS_Store
Thumbs.db
.idea/
*.log

# history (Trae editor snapshots)
.history/
```

### 5.4 README.md

**完整文件路径：`README.md`**

```markdown
# mini-dify

一个以「学习 Agent 开发」为目标的类 Dify 应用开发平台（阉割版）。

## 三主线目标

- **A · Agent 开发能力**：工作流编排引擎、Agent 循环（tool calling / ReAct）、RAG、自主 Agent 运行时。
- **B · TS 全栈**：TypeScript / LangChain.js / LangGraph.js / React / Next.js / NestJS。
- **C · Python 后端与语言对比**：FastAPI / SQLAlchemy 2.0 / Pydantic AI / LangGraph(Python)。

## 后端策略：契约优先 · 双实现

同一份契约（`packages/contract`），NestJS 与 FastAPI **各实现一遍**，行为由同一套契约测试保证一致。
前端通过环境变量切换后端（`NEXT_PUBLIC_API_BASE`），代码零改动。

## 目录结构

```
mini-dify/
├── apps/
│   ├── web/         # Next.js 前端
│   ├── api-ts/      # NestJS 后端
│   └── api-py/      # FastAPI 后端
├── packages/
│   ├── contract/    # 唯一契约：OpenAPI 规范 + SSE 事件协议 + 画布 JSON Schema
│   └── shared/      # TS 侧共享类型与工具（由 contract 派生）
└── docs/
    ├── 00-开发总纲.md
    └── tutorial/    # 功能笔记 / 技术精讲 / 语言对比
```

## 环境要求

- Node.js 22+ 与 pnpm
- uv 与 Python 3.12

## 快速开始

```bash
pnpm install          # 安装 TS 侧依赖
uv sync --project apps/api-py   # 安装 Python 侧依赖

pnpm dev:api-ts       # NestJS  -> http://localhost:3001/health
pnpm dev:api-py       # FastAPI  -> http://localhost:8000/health
pnpm dev:web          # Next.js  -> http://localhost:3000
```

## 进度

- [ ] 阶段 0 · 项目初始化（进行中）
- [ ] 阶段 1 · 账号与认证
- [ ] 阶段 2 · 应用管理
- [ ] 阶段 3 · 画布编辑器
- [ ] 阶段 4 · 执行引擎 MVP
- [ ] 阶段 5 · LLM 节点
- [ ] 阶段 6 · 工具调用 / Agent
- [ ] 阶段 7 · 知识库 RAG
- [ ] 阶段 8 · 分支与循环
- [ ] 阶段 9 · 会话与记忆
- [ ] 阶段 10 · 发布
- [ ] 阶段 11 · 自主 Agent 运行时
- [ ] 阶段 12 · 打磨

完整路线见 [`docs/00-开发总纲.md`](docs/00-开发总纲.md)。
```

> 注：`README.md` 中的 `docs/00-开发总纲.md` 路径（相对根）与原文件一致。

---

## 6. 【技术教学 · 首次】monorepo

### 6.1 是什么

**monorepo（单仓库多包）** 是相对于 **multi-repo（多仓库）** 的一种代码组织方式：把多个**可以独立发布/独立的包**放进**同一个 Git 仓库**。

两种组织方式对比：

| | multi-repo | monorepo |
| --- | --- | --- |
| 仓库数量 | 每个包一个仓库 | 全部包一个仓库 |
| 跨包改动 | 要发多个 PR、跨仓库对齐版本 | 一个 PR 覆盖所有受影响包 |
| 共享代码 | 要发包到 npm / 私有 registry 再引用 | 直接 `workspace:*` 引用源码 |
| 依赖安装 | 每仓库各装一次 | 一次安装，公共依赖可提升复用 |
| 缺点 | 无 | 仓库变大、CI 需要「只跑受影响包」 |

### 6.2 本项目的取舍：为什么选 monorepo

- **契约必须同步**：`packages/contract` 是唯一真源，两个后端 + 前端都从它取类型。放一个仓库里，改契约能**原子地**让所有消费方一起改。
- **学习项目**：一次 clone 就能拿到完整可跑系统，无需理解「先装哪个仓库、先后顺序」。
- **依赖提升**：`node_modules` 只需在根装一次，`typescript`、`prettier` 等公共工具共享。

### 6.3 代价（知道就好，本阶段不处理）

- 仓库体积随包增多而变大（尤其带前端产物）。
- CI 若不加过滤会「跑全部包」，浪费时间——所以需要 `--filter` 只跑改动包（见 6.6）。

---

## 7. 【技术教学 · 首次】pnpm workspace

### 7.1 是什么

**pnpm** 是一个 Node 包管理器，比 npm/yarn 更省磁盘、安装更快。**workspace（工作区）** 是它的 monorepo 能力：**用一个配置文件声明「哪些目录是包」**，然后统一管理。

### 7.2 `packages` 列表：告诉 pnpm 哪些目录是包

```yaml
packages:
  - apps/*
  - packages/*
```

- `apps/*` 匹配 `apps/web`、`apps/api-ts`、`apps/api-py`。
- `packages/*` 匹配 `packages/contract`、`packages/shared`。
- 只要某个目录下有 `package.json`，它就会被识别为一个 workspace 包。

**本例为什么这么用**：它是**通配**写法，新增一个 app 或 package 时**不用改这个文件**——这是 monorepo 扩展性好的关键。

### 7.3 `workspace:*` 协议：包之间怎么互相引用

在包 A 里要引用同仓库的包 B，**不要**写版本号，而写：

```json
{ "@mini-dify/contract": "workspace:*" }
```

pnpm 会把它替换成「指向本地 `packages/contract` 的软链接」，而不是去 npm 下载。

- `workspace:*`：任意版本，直接用本地包。（本项目 api-ts 就是这么引契约的。）
- 对比写死 `"^0.1.0"`：那会去 registry 找，本地改动**不会**自动生效。

### 7.4 `--filter`：只对某个包执行命令

```bash
pnpm --filter @mini-dify/api-ts build
```

含义：**只**对名为 `@mini-dify/api-ts` 的包运行 `build` 脚本（在它自己的目录里跑）。

- 不加 `--filter`，`pnpm build` 会在所有包上跑。
- `--filter` 是 monorepo 里「精准执行」的核心手段，后面每个包都会用到。

### 7.5 npm scripts：包内部命令的编排

每个 `package.json` 的 `"scripts"` 是**命令别名表**，用 `pnpm run <名字>`（或直接 `pnpm <名字>`）触发：

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

**本例为什么这么用**：根脚本把「多步操作」串成一条（用 `&&` 顺序执行）：

```json
"dev:api-ts": "pnpm run build:contract && pnpm --filter @mini-dify/api-ts start:dev"
```

这行的意思是：**先**编译契约，**再**启动 NestJS 开发服务器。这样保证 NestJS 永远读到最新契约（05 篇会展开）。脚本编排是「一条命令替代一串手工操作」的基础。

### 7.6 `packageManager` 字段：钉死包管理器版本

```json
"packageManager": "pnpm@12.10.1"
```

这是 **Corepack 约定**：声明「本仓库必须用 pnpm 12.10.1」。

**本例为什么这么用**：团队成员/CI 用不同 pnpm 版本时，行为差异（尤其 lockfile 格式）会带来诡异问题；钉死版本让所有人一致。

### 7.7 `allowBuilds`：允许依赖执行构建脚本

```yaml
allowBuilds:
  '@prisma/client': true
  '@prisma/engines': true
  prisma: true
```

pnpm 12 出于**安全**，默认**拦截**依赖包的 `postinstall` 等构建脚本（防供应链攻击）。Prisma 需要执行构建来「生成引擎与 Client」，所以这里显式放行这三个包。**不配它的后果见 §10 常见坑。**

---

## 8. 【技术教学 · 首次】为什么独立于 dify 官方仓库

本项目叫 mini-dify，是「学习版」，**刻意不 fork、不重命名、不放在 dify 官方仓库里跑**，原因有三：

1. **避免与 dify 自己的 workspace/catalog 冲突**：dify 仓库有自己的 monorepo 布局与依赖目录（catalog）。若在里面再塞一套 `pnpm-workspace.yaml` 与同名包，配置会互相干扰。
2. **避免污染上游 git 历史**：学习代码与上游提交混在一起，既难 rebase 上游更新，也难提交干净的历史。
3. **保持「独立可跑」**：mini-dify 有自己固定的 Node/pnpm/Python 版本要求与依赖，独立仓库保证 `pnpm install` 的结果可预期、可复现。

> 一句话：**学习项目独立成库，参照 dify 的设计，但不寄生在 dify 仓库里。**

---

## 9. 执行首次安装

**命令（在仓库根执行）**

```bash
pnpm install
```

**目的**：读取 `pnpm-workspace.yaml`，为 4 个 workspace 包安装依赖，建立包之间的软链接。

**预期输出（关键几行）**

```
Scope: all 4 workspace projects
...
Packages: +340
Done in 33.1s using pnpm v12.10.1
```

- `Scope: all 4 workspace projects`：pnpm 认出了**4 个**包（web / api-ts / api-py / contract；api-py 是 Python 包但其 `package.json` 若无则不计——本项目实测量为 4 个 TS 侧 workspace 项目）。
- `Packages: +340`：本次从 registry 下载并安装了 340 个依赖包。
- `Done in 33.1s using pnpm v12.10.1`：使用 pnpm **12.10.1** 完成，耗时 33.1 秒。

> 首次安装较慢属正常；之后有 lockfile + 本地缓存会快很多。

---

## 10. 验收自测

| 检查项 | 命令 | 预期 |
| --- | --- | --- |
| 工作区被识别 | `pnpm install`（仓库根） | 输出含 `Scope: all 4 workspace projects` |
| 安装成功 | 同上 | 输出含 `Done in ... using pnpm v12.10.1` |
| 包链接建立 | `pnpm ls -r --depth -1` | 列出 4 个 workspace 项目（web / api-ts / api-py / contract） |
| 版本锁定生效 | `pnpm -v` | 与 `packageManager` 声明一致（`12.10.1`） |

---

## 11. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **lockfile 过期** | 报 `ERR_PNPM_OUTDATED_LOCKFILE`，安装中止 | `package.json` 与 `pnpm-lock.yaml` 不一致（如手工加了依赖）。用 `pnpm install --no-frozen-lockfile` 让 pnpm 更新 lockfile |
| **构建脚本被拦截** | 报 `ERR_PNPM_IGNORED_BUILDS`（提示 Prisma 等被忽略） | pnpm 12 默认拦截依赖构建脚本。在 `pnpm-workspace.yaml` 的 `allowBuilds` 里把对应包置 `true`（本项目已列 `@prisma/client`、`@prisma/engines`、`prisma`） |
| **只装了一个包** | 只看到 `node_modules` 里几个目录 | 没写 `pnpm-workspace.yaml`，或 `packages` 通配没匹配到子目录 |
| **`--filter` 名字写错** | 报「No projects matched」 | `--filter` 用的是 **package.json 的 `name`**（如 `@mini-dify/api-ts`），不是目录名 |
| **误在子包目录装依赖** | 依赖装错位置 | 依赖统一在**仓库根** `pnpm install`；根 `node_modules` 通过 hoisting 供各包使用 |

---

## 12. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| monorepo（概念与取舍） | **首次教学于本篇** |
| pnpm workspace（`packages` / `workspace:*` / `--filter` / `allowBuilds`） | **首次教学于本篇** |
| npm scripts（命令别名与 `&&` 编排） | **首次教学于本篇** |
| `packageManager` 字段（Corepack 版本锁定） | **首次教学于本篇** |
| 为何独立于 dify 仓库 | 首次教学于本篇 |
