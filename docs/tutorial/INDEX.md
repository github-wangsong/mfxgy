# 教程笔记 · 索引与写作规范

> 本文件是所有教程笔记的**总规则**与**技术点索引**。文件本身**不带编号**。

---

## 一、目录与命名约定（唯一标准）

### 1.1 目录树

```
docs/tutorial/
├── INDEX.md                 ← 本文件（唯一不带编号的文件）
├── 00-项目初始化/            ← 阶段目录：目录号 = 总纲的阶段号
│   ├── 01-环境准备.md
│   ├── 02-本地中间件Docker.md
│   ├── 03-monorepo与pnpm-workspace.md
│   ├── 04-契约包与TypeScript类型.md
│   ├── 05-NestJS起步.md
│   ├── 06-FastAPI起步.md
│   ├── 07-NextJS起步.md
│   └── 08-验收.md
├── 01-账号与认证/            ← 下一个阶段（待写）
├── lang-diff/               ← 语言差异：每阶段一篇
│   ├── 00-项目初始化.md
│   └── 01-账号与认证.md
└── _legacy/                 ← 旧「概要式」笔记归档，不参与编号
```

### 1.2 编号规则（三条，务必遵守）

| 规则 | 说明 |
| --- | --- |
| **① 目录号 = 总纲的阶段号** | `00-项目初始化`（阶段 0）、`01-账号与认证`（阶段 1）、…、`12-打磨`（阶段 12）。**不要**再出现「阶段 0 却编号 01」这种错位 |
| **② 篇内编号 = 该阶段内的步骤序号** | 从 `01` 起递增 |
| **③ 唯一无编号文件是 `INDEX.md`** | 索引、规范、技术点登记都放这里 |

`lang-diff/` 下的文件名固定为 `NN-阶段名.md`（NN 与阶段目录同号），每阶段**一篇**。

### 1.3 一句话记忆

> **外面看阶段号，里面看步骤号，跨语言看 `lang-diff`，过期的进 `_legacy`。**

---

## 二、写作规范（强制）

### 2.1 定位

笔记**不是总结概括**，而是**完整教学**：没接触过该技术的人，照着能从头做出来并理解为什么。

### 2.2 每篇必须包含

| 组成 | 要求 |
| --- | --- |
| **本篇目标** | 做完能干什么、验收标准 |
| **前置条件** | 依赖哪些已完成步骤 |
| **命令逐条** | 执行了什么、**在哪执行**、**目的是什么**、预期输出 |
| **完整代码** | 每个文件用代码块给出**完整内容**；代码块**上方**标注**完整文件路径** |
| **技术教学** | 代码触及的每项技术，**首次出现时**讲透：是什么 → 基本语法 → 本例中为什么这么用 |
| **验收自测** | 可直接复制的命令 + 预期结果 |
| **常见坑** | 现象 + 原因 + 解决 |

### 2.3 去重规则（关键）

- 技术点**首次出现** → 完整教学，并登记到第三节索引。
- **再次出现** → 一句「见 `XX-阶段/YY-篇.md`」+ 直接使用，**不重讲**。

### 2.4 语言通用模式

TS / React / Next / Nest / Python / LangChain / LangGraph **一律同一模式**：
**先讲基本语法 → 再结合本项目实例 → 登记索引**。

---

## 三、技术点索引（首次教学登记表）

| 技术点 | 首次教学位置 |
| --- | --- |
| Python 语言最小集与 FastAPI 心智模型（缩进/类型注解/async/装饰器/生成器/with/包导入；APIRouter/Depends/Pydantic/异常处理器 —— 全程与 TS·NestJS 对照） | `00-项目初始化/00-Python与FastAPI基础.md` |
| 包管理器：npm vs pnpm（store / 硬链接） | `00-项目初始化/01-环境准备.md` |
| uv（Python 包管理 + 版本管理，替代 pip/venv/pyenv） | `00-项目初始化/01-环境准备.md` |
| Node 与 Python 的版本管理思路差异 | `00-项目初始化/01-环境准备.md` |
| `packageManager` 字段 / Corepack 钉版本 | `00-项目初始化/01-环境准备.md` |
| `pyproject.toml`（requires-python / dependencies / dependency-groups） | `00-项目初始化/01-环境准备.md` |
| Docker 基础（镜像 / 容器 / 命名卷 / 端口映射 / healthcheck） | `00-项目初始化/02-本地中间件Docker.md` |
| Docker Compose（services / volumes / `up -d` / `ps` / `down`） | `00-项目初始化/02-本地中间件Docker.md` |
| `docker exec` + 容器内 `psql` 自检 | `00-项目初始化/02-本地中间件Docker.md` |
| PostgreSQL 扩展机制（`create extension` / `pg_extension`） | `00-项目初始化/02-本地中间件Docker.md` |
| `.env` / `.env.example` 分工；连接串 `dialect+driver://user:pass@host:port/db` | `00-项目初始化/02-本地中间件Docker.md` |
| monorepo（概念与取舍） | `00-项目初始化/03-monorepo与pnpm-workspace.md` |
| pnpm workspace（`packages` / `workspace:*` / `--filter` / `allowBuilds`） | `00-项目初始化/03-monorepo与pnpm-workspace.md` |
| npm scripts（命令别名与 `&&` 编排） | `00-项目初始化/03-monorepo与pnpm-workspace.md` |
| TypeScript 类型系统（interface / 联合 / 字面量 / **类型擦除**） | `00-项目初始化/04-契约包与TypeScript类型.md` |
| OpenAPI 规范（paths / components / `$ref` / `additionalProperties`） | `00-项目初始化/04-契约包与TypeScript类型.md` |
| `tsconfig` 关键字段（declaration / outDir / module） | `00-项目初始化/04-契约包与TypeScript类型.md` |
| **TypeScript 装饰器**（`@Module` / `@Controller` / `@Get` / `@Injectable`） | `00-项目初始化/05-NestJS起步.md` |
| 依赖注入（构造函数注入 / Provider / IoC 容器） | `00-项目初始化/05-NestJS起步.md` |
| NestJS 模块系统（imports / controllers / providers） | `00-项目初始化/05-NestJS起步.md` |
| `NestFactory` 启动 + CORS + 端口 | `00-项目初始化/05-NestJS起步.md` |
| Python 类型注解 / `Literal` | `00-项目初始化/06-FastAPI起步.md` |
| Pydantic v2 `BaseModel`（运行期校验 + 序列化） | `00-项目初始化/06-FastAPI起步.md` |
| `ConfigDict(extra="forbid")` | `00-项目初始化/06-FastAPI起步.md` |
| pydantic-settings（环境变量 → 带类型配置） | `00-项目初始化/06-FastAPI起步.md` |
| FastAPI `APIRouter` + `include_router` | `00-项目初始化/06-FastAPI起步.md` |
| uvicorn（ASGI 服务器） | `00-项目初始化/06-FastAPI起步.md` |
| `CORSMiddleware` / 跨域 | `00-项目初始化/06-FastAPI起步.md` |
| React 组件与 JSX | `00-项目初始化/07-NextJS起步.md` |
| Server / Client Component 与 `'use client'` | `00-项目初始化/07-NextJS起步.md` |
| `useState` / `useEffect`（依赖数组 / 清理函数） | `00-项目初始化/07-NextJS起步.md` |
| Next.js App Router（`layout.tsx` / `page.tsx` / Metadata） | `00-项目初始化/07-NextJS起步.md` |
| `NEXT_PUBLIC_*` 环境变量与构建期内联 | `00-项目初始化/07-NextJS起步.md` |
| 端到端分层验收方法论（容器 → 后端 → 前端） | `00-项目初始化/08-验收.md` |
| 两类「健康」语义（HTTP 200 vs 容器 `healthy`） | `00-项目初始化/08-验收.md` |
| **契约一致的两层**（结构一致 vs 值规范一致） | `00-项目初始化/08-验收.md` |
| ISO-8601 / RFC 3339 两种合法变体与 UTC 归一化 | `00-项目初始化/08-验收.md` |
| 「错误信封」设计与 `securityScheme`（HTTP Bearer JWT） | `01-账号与认证/01-契约扩展.md` |
| ORM 概念；schema-first vs code-first；Prisma 三件套；数据库迁移（DDL 版本化）；Prisma DSL | `01-账号与认证/02-Prisma.md` |
| NestJS 生命周期钩子（`OnModuleInit` / `OnModuleDestroy`）；`@Global()` 全局模块 | `01-账号与认证/02-Prisma.md` |
| DTO 与 `class-validator`（运行期校验，补齐「类型被擦除」缺口） | `01-账号与认证/03-NestJS认证.md` |
| `ValidationPipe`（whitelist / forbidNonWhitelisted / transform） | `01-账号与认证/03-NestJS认证.md` |
| Guard / `CanActivate` / `@UseGuards`；自定义参数装饰器 `createParamDecorator` | `01-账号与认证/03-NestJS认证.md` |
| 异常过滤器 `@Catch` / `ExceptionFilter` / `ArgumentsHost`；NestJS 请求生命周期顺序 | `01-账号与认证/03-NestJS认证.md` |
| code-first ORM（对照 Prisma）；`DeclarativeBase` / `Mapped` / `mapped_column` | `01-账号与认证/04-SQLAlchemy2.0.md` |
| Engine / Session 生命周期；`create_engine` / `SessionLocal`；`postgresql+psycopg://` 的 driver 显式化 | `01-账号与认证/04-SQLAlchemy2.0.md` |
| **迁移所有权**（Prisma 拥有 DDL，SQLAlchemy 只映射） | `01-账号与认证/04-SQLAlchemy2.0.md` |
| `Depends` 依赖注入（对照 NestJS 构造注入）；`get_db` 会话依赖；依赖的依赖 | `01-账号与认证/05-FastAPI认证.md` |
| `HTTPBearer`；`@app.exception_handler`；`RequestValidationError` → 400 | `01-账号与认证/05-FastAPI认证.md` |
| 密码存储（哈希 vs 加密）；bcrypt 盐与成本因子 | `01-账号与认证/06-JWT与密码哈希.md` |
| JWT 三段结构；HS256 对称签名；claims（`sub`/`role`/`iat`/`exp`）；无状态认证 | `01-账号与认证/06-JWT与密码哈希.md` |
| **同一认证域**（跨后端令牌互认） | `01-账号与认证/06-JWT与密码哈希.md` |
| REST 资源化设计（列表 `{items}` 包装 / `DELETE` 204 / `PATCH` vs `PUT`） | `02-应用管理/01-契约扩展.md` |
| 路径参数 `{id}` 的 OpenAPI 声明；**404 而非 403**（不泄露资源存在性） | `02-应用管理/01-契约扩展.md` |
| 关系建模（1:N、外键、反向关系）；`@relation`；`onDelete: Cascade`；`@@index`（外键需索引）；`@default`；`@@map` | `02-应用管理/02-Prisma关系建模.md` |
| **资源归属（ownership）与 404 惯例** | `02-应用管理/03-NestJS应用模块.md` |
| NestJS 模块复用与 DI 边界（`JwtModule.register({global:true})`、`exports`）与「配置漂移」 | `02-应用管理/03-NestJS应用模块.md` |
| 实体出参映射（只暴露契约字段、空值 → `null`） | `02-应用管理/03-NestJS应用模块.md` |
| `relationship()` 与 `back_populates` 双向对称；字符串目标延迟解析（循环导入）；惰性加载 / `joinedload` | `02-应用管理/04-SQLAlchemy关系建模.md` |
| `ForeignKey`；cascade 的两层（DB `ON DELETE CASCADE` vs ORM `cascade`、`passive_deletes`） | `02-应用管理/04-SQLAlchemy关系建模.md` |
| **写入默认值的所有权边界**（`default` / `onupdate` vs `server_default`） | `02-应用管理/04-SQLAlchemy关系建模.md` |
| Pydantic `from_attributes`；`None` 序列化；`model_dump(exclude_unset=True)` 的 PATCH 语义 | `02-应用管理/05-FastAPI应用模块.md` |
| 受控表单（`value`+`onChange`、`onSubmit`/`preventDefault`）；列表渲染 `map`+`key`；三态（loading/error/empty） | `02-应用管理/06-前端应用列表页.md` |
| `localStorage` 存 token 的取舍与风险（XSS）；带鉴权 `fetch`（Bearer / 非 2xx / 204） | `02-应用管理/06-前端应用列表页.md` |
| 归属隔离端到端验收；「契约一致」在阶段 2 的运行期收敛与值规范收口 | `02-应用管理/07-验收.md` |
| 错误文案目录：用契约把两套框架的校验方言归一（`packages/contract/error-messages.md`） | `02-应用管理/07-验收.md` |
| 校验方言的真实分歧（`require_tld`：validator.js vs Pydantic `EmailStr`） | `02-应用管理/07-验收.md` |
| 数据库触发器保证 `updated_at`（`DEFAULT now()` + `BEFORE UPDATE` 触发器） | `02-应用管理/02-Prisma关系建模.md` |
| `iso_z` 时间序列化（UTC + 毫秒 + `Z`） | `02-应用管理/07-验收.md` |
| 数据模型作为契约一等公民；`data` 为唯一 `additionalProperties: true` 的取舍 | `03-画布/01-图JSON契约与校验.md` |
| 业务规则属契约外、用**纯函数**两端各实现（**首次教学**） | `03-画布/01-图JSON契约与校验.md` |
| `null` 语义与「空图」（读不校验、写才校验） | `03-画布/01-图JSON契约与校验.md` |
| Prisma `Json` → Postgres `jsonb`；「两态」建模（草稿 vs 发布快照拷贝） | `03-画布/02-Prisma-JSONB与两态.md` |
| 嵌套路由 / 按资源拆模块；嵌套 DTO + `@ValidateNested({each:true})` + `@Type`；`ValidationError.children` 递归收集 | `03-画布/03-NestJS图模块.md` |
| `postgresql.JSONB` 与通用 `JSON` 的区别；JSONB 往返 key 命名一致性 | `03-画布/04-SQLAlchemy-JSONB映射.md` |
| `published_at` naive-UTC 写入 + 出参归一（存储/展示时区分离）；`_enum_values` 的 `" or "` 切分 bug 修复 | `03-画布/05-FastAPI图模块.md` |
| ReactFlow 核心模型（nodes/edges 即数组状态）；`useNodesState`/`onConnect`+`addEdge`；自定义节点与 `Handle`；`ReactFlowProvider`；受控/状态提升；`crypto.randomUUID()` | `03-画布/06-ReactFlow画布.md` |
| 阶段 3 验收新增的「契约一致」层次（业务校验文案逐字节一致 + JSONB 往返形状一致） | `03-画布/07-验收.md` |
| SSE 协议与帧格式（`event: <name>\n` + `data: <单行 JSON>\n\n`）；「请求级 400 vs 流内 `run_failed`」的**双通道错误设计**；事件协议作为唯一真源 | `04-执行引擎/01-运行契约与SSE事件协议.md` |
| LangGraph 心智模型（`StateGraph` / `Annotation` / reducer / `START`-`END` / `compile`-`invoke`） | `04-执行引擎/02-LangGraph编译图-TS.md` |
| 变量池与模板解析（点路径 `{{ a.b }}`）；「**节点 = 纯函数**」；桩节点的分片流式；非字符串模板值的紧凑序列化 | `04-执行引擎/03-节点运行时与变量池.md` |
| Python 版 LangGraph（`TypedDict` + `Annotated` reducer）；`asyncio.Queue` ↔ 异步生成器 | `04-执行引擎/04-LangGraph与引擎-Python.md` |
| 手写 SSE 帧（底层 `Response` / `StreamingResponse`）；`content-type` 对齐；「**先校验、后开流**」 | `04-执行引擎/05-SSE流式响应实现.md` |
| `EventSource` **无法带 `Authorization`** → `fetch` + `getReader`；`TextDecoder({stream:true})`；手动 SSE 分帧算法；React **批处理**导致 token 不逐段显示 | `04-执行引擎/06-前端SSE客户端与运行面板.md` |
| **阶段 4 是项目的质变点**（从「存取与校验」进入「**执行**」；`图 = 数据` → 「**数据 → 可执行程序**」的编译思维） | `04-执行引擎/07-验收.md` |
| SSE 流式协议的**分层验收**（事件序列 / payload 键集合 / 帧格式：除 `runId`/`elapsedMs` 外逐字节相同）；token 分片逐字节一致 | `04-执行引擎/07-验收.md` |
| 「契约一致」在阶段 4 新增的层次：从「响应体形状」扩展到「**过程的形状**」（事件序列与帧格式一致） | `04-执行引擎/07-验收.md` |
| LangGraph 的能力边界（本阶段线性拓扑；条件边 / 循环 / checkpoint / HITL 为 8/9/11 扩展点）与「节点 = 纯函数 + 自建事件队列」取舍 | `04-执行引擎/07-验收.md` |
| `LlmNodeData` 形状与「节点级覆盖全局默认」的优先级；`usage` 为什么可选；OpenAI 兼容协议与 `base_url`；密钥走环境变量不进仓库 | `05-LLM节点/01-LLM节点契约与模型配置.md` |
| `ChatOpenAI`（LangChain 封装）用法；`.stream()` 真流式（边收边发）；**`maxRetries=0` 的对齐取舍** | `05-LLM节点/02-真实模型调用与流式.md` |
| **外部依赖错误的规范化映射**（为什么必须映射、6 条规范文案、出错走 `run_failed` 且不发 `node_finished`） | `05-LLM节点/03-LLM错误映射.md` |
| **mock 外部依赖做无密钥确定性自测**；OpenAI 分片协议 vs 本项目 `/run` 事件协议；错误注入的绕法（LangChain 不允许自定义头） | `05-LLM节点/04-mock-LLM与无密钥自测.md` |
| 阶段 5 验收新增的一致层次（真流式 token 序列 + 错误文案） | `05-LLM节点/05-验收.md` |
| Function Calling 的分工（模型只出意图、程序负责执行）；`ToolDefinition` 三要素；JSON Schema 作为「给模型看的签名」；`GET /tools` 能力目录 | `06-工具调用/01-工具契约与内置工具.md` |
| 工具安全：禁 `eval` + 手写解析器、SSRF 防护、超时 / 体积上限；工具错误固定分类 | `06-工具调用/01-工具契约与内置工具.md` |
| ReAct 循环；LangGraph `addConditionalEdges` 与**环**；「跳过原普通边」的陷阱；按节点隔离状态（`messages` / `rounds` / `toolCalls`）；`ToolMessage`；`MAX_TOOL_ROUNDS`；`bindTools` | `06-工具调用/02-NestJS-ReAct循环与条件边.md` |
| Python 侧工具注册表 / `ToolError` / `httpx` 异步客户端 / `add_conditional_edges` / `bind_tools` | `06-工具调用/03-Python工具与ReAct对齐.md` |
| 「能力目录驱动 UI」；多选状态与「不存在的键 = 未启用」；工具事件在运行面板的展示 | `06-工具调用/04-前端工具选择面板.md` |
| 阶段 6 新增的一致层次（工具事件序列 + 工具错误分类） | `06-工具调用/05-验收.md` |

---

## 四、笔记清单与状态

> 状态：⬜ 待写 · 🟡 重写中 · ✅ 完成（新格式）

### `00-项目初始化/`（阶段 0）

| 篇 | 主题 | 状态 |
| --- | --- | --- |
| `00` | **Python 与 FastAPI 基础（零基础导学 · 与 TS/NestJS 全程对照）** | ✅ |
| `01` | 环境准备：Node / pnpm / uv / Python | ✅ |
| `02` | 本地中间件：Docker 只跑 PostgreSQL+pgvector | ✅ |
| `03` | monorepo 与 pnpm workspace | ✅ |
| `04` | 契约包与 TypeScript 类型 | ✅ |
| `05` | NestJS 起步（首次教学装饰器 / DI） | ✅ |
| `06` | FastAPI 起步（首次教学 Pydantic） | ✅ |
| `07` | Next.js 起步（首次教学 React 组件） | ✅ |
| `08` | 验收：两套后端 `/health` + 前端切换 | ✅ |

> 本阶段为 Python 侧增设了导学篇 `00`（覆盖 Python 语法最小集，是后续**所有 Python 篇目的前置**）：**建议先读 `00`，再读 `01`**。

**阶段 0 笔记已全部完成（9/9）。**

### `01-账号与认证/`（阶段 1）

| 篇 | 主题 | 状态 |
| --- | --- | --- |
| `01` | 契约扩展：注册/登录/当前用户 + 错误信封 | ✅ |
| `02` | Prisma：schema / migrate / Client（首次教学 ORM、schema-first） | ✅ |
| `03` | NestJS 认证：Guard / 装饰器 / ValidationPipe / 异常过滤器 | ✅ |
| `04` | SQLAlchemy 2.0：模型映射 / Session（首次教学 code-first ORM） | ✅ |
| `05` | FastAPI 认证：Depends / HTTPBearer / 异常处理器 | ✅ |
| `06` | JWT 与密码哈希（首次教学） | ✅ |
| `07` | 验收：跨后端令牌互认 + 错误信封一致 | ✅ |

**阶段 1 笔记已全部完成（7/7）。**

### `02-应用管理/`（阶段 2）

| 篇 | 主题 | 状态 |
| --- | --- | --- |
| `01` | 契约扩展：应用 CRUD（`{items}` 包装 / 204 / 404 惯例） | ✅ |
| `02` | Prisma 关系建模（1:N / 外键索引 / Cascade 风险） | ✅ |
| `03` | NestJS 应用模块（资源归属 / DI 边界 / 出参映射） | ✅ |
| `04` | SQLAlchemy 关系建模（`back_populates` / cascade 两层 / 默认值边界） | ✅ |
| `05` | FastAPI 应用模块（`from_attributes` / PATCH 语义） | ✅ |
| `06` | 前端应用列表页（受控表单 / token 存储 / 三态） | ✅ |
| `07` | 验收（归属隔离 / 跨后端同表一致性） | ✅ |

**阶段 2 笔记已全部完成（7/7）。**

**本阶段「值规范一致」层已全部收口（✅，均已实测）**：

| 项 | 改了什么 | 实测结果 |
| --- | --- | --- |
| 错误 `message` 的**文本**不同 | 新建唯一真源 `packages/contract/error-messages.md` 规定文案规则（`required`/`email`/`minLength`/`maxLength`/`enum`/`unknown`）。TS 侧新增 `apps/api-ts/src/common/validation-exception-factory.ts` 并在 `main.ts` 注入 `exceptionFactory`；Py 侧在 `app/errors.py` 的 `RequestValidationError` 处理器做同一映射。另新增 `@IsEmailFormat()` 装饰器（`require_tld: false`）对齐两端「邮箱接受集合」 | 12/12 组用例两端响应体**逐字节完全一致**，如 `{"statusCode":400,"message":"email is required; password is required","error":"Bad Request"}`、`{"statusCode":400,"message":"mode must be one of: chatflow, workflow","error":"Bad Request"}` |
| 时间戳精度不同 | 契约 4 个时间字段的 `description` 明确「UTC、ISO-8601、毫秒精度、以 `Z` 结尾」；Python 新增 `app/timefmt.py` 的 `iso_z()` 并用 `field_serializer` 应用；TS 侧本就全走 `toISOString()` | 两端均为 24 字符、形如 `2026-10-18T12:10:18.900Z`（此前 Python 为 `...+00:00` 带微秒） |
| `updated_at` 无数据库默认值 | 新迁移 `20261018120000_add_updated_at_default_and_trigger`：给 `apps.updated_at` 加 `SET DEFAULT now()` 并建 Postgres **触发器**在 UPDATE 前刷新；`schema.prisma` 的 `updatedAt` 加 `@default(now())`；Python 侧保留 `onupdate` 作为兜底（**DB 触发器为权威 + ORM 兜底的双保险**） | 手工 `INSERT`（不写 `updated_at`）成功且非空；手工 `UPDATE` 后自动变化；`PATCH /apps/{id}` 两端 `updatedAt` 都变大 |

### `03-画布/`（阶段 3）

| 篇 | 主题 | 状态 |
| --- | --- | --- |
| `01` | 图 JSON 契约与校验（首次教学：数据模型即契约、纯函数业务规则、`null` 空图语义） | ✅ |
| `02` | Prisma JSONB 与两态（`Json` → `jsonb` / 草稿 vs 发布快照拷贝） | ✅ |
| `03` | NestJS 图模块（嵌套路由 / 嵌套 DTO / `ValidationError.children` 递归收集） | ✅ |
| `04` | SQLAlchemy JSONB 映射（`JSONB` vs 通用 `JSON` / 往返 key 命名一致） | ✅ |
| `05` | FastAPI 图模块（`published_at` naive-UTC / `_enum_values` 切分 bug 修复） | ✅ |
| `06` | ReactFlow 画布（首次教学 ReactFlow 核心模型） | ✅ |
| `07` | 验收（跨后端「契约一致」：业务校验文案 + JSONB 往返形状） | ✅ |

**阶段 3 笔记已全部完成（7/7）。**

### `04-执行引擎/`（阶段 4）

| 篇 | 主题 | 状态 |
| --- | --- | --- |
| `01` | 运行契约与 SSE 事件协议（首次教学：SSE 帧格式、双通道错误、事件协议即唯一真源） | ✅ |
| `02` | LangGraph 编译图（TS）（首次教学：`StateGraph` / `Annotation` / reducer / `START`-`END`） | ✅ |
| `03` | 节点运行时与变量池（首次教学：变量池、模板解析、「节点 = 纯函数」、分片流式） | ✅ |
| `04` | LangGraph 与引擎（Python）（首次教学：`TypedDict` + `Annotated` reducer、`asyncio.Queue` ↔ 异步生成器） | ✅ |
| `05` | SSE 流式响应实现（首次教学：手写帧、底层 `Response` / `StreamingResponse`、「先校验、后开流」） | ✅ |
| `06` | 前端 SSE 客户端与运行面板（首次教学：`EventSource` 限制、`fetch` + `getReader`、手动分帧、React 批处理） | ✅ |
| `07` | 验收（跨后端事件序列 / 帧格式 / token 分片一致；质变点与能力边界） | ✅ |

**阶段 4 笔记已全部完成（7/7）。**

### `05-LLM节点/`（阶段 5）

| 篇 | 主题 | 状态 |
| --- | --- | --- |
| `01` | LLM 节点契约与模型配置（首次教学：`LlmNodeData` 形状 / 节点级覆盖全局默认 / `usage` 可选 / OpenAI 兼容协议与 `base_url` / 密钥走 env） | ✅ |
| `02` | 真实模型调用与流式（首次教学：`ChatOpenAI` 用法 / `.stream()` 真流式边收边发 / `maxRetries=0` 对齐取舍） | ✅ |
| `03` | LLM 错误映射（首次教学：外部依赖错误的规范化映射 / 6 条规范文案 / 出错走 `run_failed` 不发 `node_finished`） | ✅ |
| `04` | mock-LLM 与无密钥自测（首次教学：mock 外部依赖做确定性自测 / OpenAI 分片协议 vs `/run` 事件协议 / 错误注入绕法） | ✅ |
| `05` | 验收（真流式 token 序列 + 错误文案的一致层次；LlmNodeData/依赖/mock/运行/错误/回归 分层） | ✅ |

**阶段 5 笔记已全部完成（5/5）。**

### `06-工具调用/`（阶段 6）

| 篇 | 主题 | 状态 |
| --- | --- | --- |
| `01` | 工具契约与内置工具（首次教学：Function Calling 分工 / `ToolDefinition` 三要素 / JSON Schema 签名 / `GET /tools` 能力目录 / 工具安全与错误分类） | ✅ |
| `02` | NestJS ReAct 循环与条件边（首次教学：ReAct / `addConditionalEdges` 与环 / 跳过原普通边 / 按节点隔离状态 / `ToolMessage` / `MAX_TOOL_ROUNDS` / `bindTools`） | ✅ |
| `03` | Python 工具与 ReAct 对齐（首次教学：Python 工具注册表 / `ToolError` / `httpx` 异步客户端 / `add_conditional_edges` / `bind_tools`） | ✅ |
| `04` | 前端工具选择面板（首次教学：能力目录驱动 UI / 多选与「不存在的键 = 未启用」/ 静默降级 / 工具事件展示） | ✅ |
| `05` | 验收（工具事件序列 + 工具错误分类的一致层次；Agent 雏形 / 不加 Agent 节点 / 条件边与环 / 工具安全） | ✅ |

**阶段 6 笔记已全部完成（5/5）。**

### `lang-diff/`

| 篇 | 状态 |
| --- | --- |
| `00-项目初始化.md` | ⬜ |
| `01-账号与认证.md` | ⬜ |

### `_legacy/`（不再维护）

| 文件 | 说明 |
| --- | --- |
| `01-项目初始化.md` | 旧「概要式」笔记（阶段 0） |
| `02-账号与认证.md` | 旧「概要式」笔记（阶段 1） |
| `lang-diff/01-项目初始化.md` | 旧语言差异笔记 |
| `lang-diff/02-账号与认证.md` | 旧语言差异笔记 |

---

## 五、已知遗留

| 项 | 说明 | 状态 / 处理 |
| --- | --- | --- |
| 根 `package.json` 的 `dev:api-py` 脚本失效（已修复） | `uv run --project apps/api-py uvicorn app.main:app` 在仓库根执行会 `ModuleNotFoundError: No module named 'app'`（uv 不切换工作目录） | ✅ 已修复：改为 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`（`--directory` 会把工作目录切到 `apps/api-py`）。实测：仓库根执行 `pnpm dev:api-py` 可正常启动 |
| `api-ts` 版本号口径为 `0.0.0`（已修复） | `/health` 返回值与 `package.json` 的 `version` 都曾落后于 `0.1.0` | ✅ 已修复：`apps/api-ts/src/health/health.service.ts` 的 `version: '0.0.0'` 改为 `'0.1.0'`；本轮又把 `apps/api-ts/package.json` 的 `version` 由 `0.0.0` 改为 `0.1.0`。实测：两端 `/health` 版本号均为 `0.1.0` |
| `apps/api-ts` 无 Prisma 便捷脚本 | 迁移只能用 `pnpm --filter @mini-dify/api-ts exec prisma migrate dev ...` | ✅ 已修复：`apps/api-ts/package.json` 加 `db:migrate` / `db:generate` / `db:studio`（= `prisma migrate dev` / `generate` / `studio`），根 `package.json` 也加了同名代理脚本。实测：`pnpm --filter @mini-dify/api-ts db:*` 等价可用 |
| 根 `.env` 的 `DATABASE_URL` 是 Python 格式 `postgresql+psycopg://` | **Prisma 不认**该 driver 写法；从仓库根跑 api-ts 会读到它而连不上库 | ✅ 已修复：配置拆成「每个 app 自包含」——根 `.env` 只留 `POSTGRES_*`（供 docker-compose 变量替换），删除根里的 `DATABASE_URL` / `JWT_SECRET` 等应用变量；`apps/api-ts/.env` 用 Prisma 格式（无 `+psycopg`）。实测：在 `apps/api-ts` 目录 `node dist/main.js` 正常连库并监听 3001 |
| `apps/api-py` 无独立 `.env` | 目前用 `app/config.py` 默认值 + 仓库根 `.env` | ✅ 已修复：新建 `apps/api-py/.env`（SQLAlchemy 格式连接串 + `JWT_SECRET` / `JWT_EXPIRES_IN` / `PORT`）；`config.py` 的 `env_file` 改为按 `__file__` 推导的**项目目录绝对路径**（`apps/api-py/.env`），与启动 cwd 无关。实测：从仓库根（cwd≠apps/api-py）也能读到该 `.env` |
| **JWT 有效期被硬编码在两处** | TS 侧 `auth.module.ts` 的 `signOptions.expiresIn: '1h'`；Python 侧 `config.py` 的 `access_token_expires_in = 3600` | ✅ 已修复：两端都读 `JWT_EXPIRES_IN`（**秒**）——TS `signOptions: { expiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600) }` 且返回 `TokenResponse.expiresIn` 同用 `ACCESS_TOKEN_EXPIRES_IN`；Python `access_token_expires_in: int = Field(3600, validation_alias="JWT_EXPIRES_IN")`。实测：两端登录响应 `expiresIn` 均为 `3600` |
| bcrypt 前缀不同 | TS 的 `bcryptjs` 产出 `$2a$10$`，Python 的 `bcrypt` 产出 `$2b$10$` | ℹ️ 成本因子同为 10 且**双向可互验**，无需处理，仅记录 |
| 某些 shell 中 `uv` 不在 PATH（已澄清） | 真实原因：这些 shell 在 uv 安装**之前**就已启动，继承的是安装前的**旧 PATH**——`C:\Users\27382\.local\bin` 本就已写入**用户 PATH** 且为第一项，任何新开的终端 / IDE 都能直接用 `uv` | ✅ 已澄清：重启 shell / IDE 即可；**无需改动系统环境变量**。兜底仍可用绝对路径 `C:\Users\27382\.local\bin\uv.exe` |
| **`apps/api-py/.env` 里的 `MAX_TOOL_ROUNDS` 不生效** | 阶段 6 的 `_max_tool_rounds()` 原本直接读 `os.environ`，而 **pydantic-settings 只把 `.env` 读进 `Settings` 对象、不回写进程环境** ⇒ `.env` 里的值被静默忽略 | ✅ 已修复：`config.py` 新增 `max_tool_rounds: int = 5`，`_max_tool_rounds()` 改读 `settings.max_tool_rounds`；两端 `.env` / `.env.example` 均补 `MAX_TOOL_ROUNDS=5`。实测：`settings.max_tool_rounds = 5`、`_max_tool_rounds() = 5`。**通用知识**：读配置要走 `Settings`，别直接读 `os.environ` |
| **api-py 的 JSON 响应缺 `charset=utf-8`** | Starlette `JSONResponse` 默认 `content-type: application/json`（无 charset）；响应体虽是 UTF-8 字节，但**未声明编码**，导致非浏览器客户端（PowerShell 5.1 等）按 ISO-8859-1 解码 ⇒ 含中文的响应变乱码（`安全` → `å®å¨`）。浏览器 `res.json()` 按规范强制 UTF-8，故前端看不出来 | ✅ 已修复：新建 `apps/api-py/app/json_response.py` 的 `UTF8JSONResponse`（`media_type = "application/json; charset=utf-8"`），作为 `FastAPI(default_response_class=...)` 的默认响应类，并用于 `errors.py` 的错误信封。实测：两端 `Content-Type` 均为 `application/json; charset=utf-8`，`GET /tools` 原始 JSON **逐字节相等** |
| 端口 `3000`/`3001` 偶尔无法绑定 | Docker Desktop 启动后，Windows WinNAT 会**动态保留**一段端口（实测曾占 `2957–3056`，正好覆盖 3000/3001）；`netsh int ipv4 show excludedportrange protocol=tcp` 可查，绑定时报 `access permissions` | ℹ️ 环境问题（非代码）。**管理员** PowerShell 执行 `net stop winnat` + `net start winnat` 即释放；或重启机器。实测：释放后 3000/3001/8000 均可正常绑定并启动三端 |

---

## 六、阅读顺序建议

本项目是**双栈同契约**：同一套契约（`packages/contract/`）由 **TS/NestJS** 与 **Python/FastAPI** 两套后端各实现一遍。两条线可**各读一条、交叉对照**，也可两条并行。下表只列「**各阶段的实现篇**」（每阶段的两侧篇号成对）。

### 6.1 TS / NestJS 线

| 阶段 | 篇 |
| --- | --- |
| 0 · 项目初始化 | `05-NestJS起步.md` |
| 1 · 账号与认证 | `03-NestJS认证.md` |
| 2 · 应用管理 | `03-NestJS应用模块.md` |
| 3 · 画布 | `03-NestJS图模块.md` |
| 4 · 执行引擎 | `02-LangGraph编译图-TS.md`、`03-节点运行时与变量池.md` |
| 5 · LLM 节点 | `02-真实模型调用与流式.md`、`03-LLM错误映射.md` |

### 6.2 Python / FastAPI 线

| 阶段 | 篇 |
| --- | --- |
| **前置（必读）** | `00-项目初始化/00-Python与FastAPI基础.md` |
| 0 · 项目初始化 | `06-FastAPI起步.md` |
| 1 · 账号与认证 | `04-SQLAlchemy2.0.md`、`05-FastAPI认证.md` |
| 2 · 应用管理 | `04-SQLAlchemy关系建模.md`、`05-FastAPI应用模块.md` |
| 3 · 画布 | `04-SQLAlchemy-JSONB映射.md`、`05-FastAPI图模块.md` |
| 4 · 执行引擎 | `04-LangGraph与引擎-Python.md`、`05-SSE流式响应实现.md` |
| 5 · LLM 节点 | `02-真实模型调用与流式.md`、`03-LLM错误映射.md` |

> **一句话**：两条线是**同一契约的两套实现**（同一份 `openapi.yaml`、同一张数据库表），因此**可以交叉对照读**——读 TS 篇时对照 Python 篇的「与 NestJS/Prisma 的对照」小节，反之亦然，效果最好。
> 走 Python 线时，请**先读 `00-项目初始化/00-Python与FastAPI基础.md`**（Python 语法最小集与 FastAPI 心智模型），它是后续**所有 Python 篇目的前置**。
