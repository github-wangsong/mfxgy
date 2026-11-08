# mini-dify 全栈开发实录（doc2）

> 第二套教程：**按真实开发顺序**，从一个空目录写到可发布、可运行 Agent 的完整项目。
>
> 与 `docs/tutorial/` 的区别：旧版按「知识点」组织；doc2 按「一个全栈工程师实际敲代码的时间线」组织。
>
> 写作原则：**少讲文档，多贴代码；每个文件给完整路径与完整内容；每个变量、方法、字段都写注释。**

---

## 一、这套教程怎么读

1. 每一篇 = 开发中的一个动作（建仓库、写契约、起后端、起前端、加认证……），不是一篇知识总结。
2. 代码块上方永远标注**完整文件路径**（相对仓库根）。
3. 代码里的注释解释「这一行为什么存在」；变量、函数、类型字段、配置项都有注释。
4. 每篇结尾只有一小节「验证」：几条能直接复制的命令 + 预期结果。
5. 顺序固定：**契约 → 后端 TS → 后端 Python → 前端 → 联合验收**。这正是一个人写双后端项目的真实节奏。
6. 前端所有响应都是不可信输入：必须经过 `apps/web/lib/schemas.ts` 的 Zod schema 校验，禁止 `as XxxResponse` 断言。

### 阶段 0 面试考点地图

每篇的「面试考点」块都放在对应代码下面，看完代码就能顺着追问。

| 文档 | 面试考点 |
| --- | --- |
| 01 环境与仓库骨架 | uv 为什么能替代 pip/venv/pyenv；pnpm store/硬链接/幽灵依赖/workspace；Docker 镜像 vs 容器、命名卷、healthcheck；12-Factor 配置与连接串 |
| 02 契约包 | Contract-First 与契约测试；OpenAPI 的 required/additionalProperties/$ref；TS 类型擦除与运行期校验 |
| 03 NestJS 后端 | 装饰器与 `emitDecoratorMetadata`；DI/IoC/Token/单例；请求生命周期；CORS；liveness vs readiness |
| 04 FastAPI 后端 | ASGI/WSGI/uvicorn；pydantic-settings；Pydantic 运行期校验/`response_model`；naive vs aware datetime；`Depends` |
| 05 Next.js 前端 | RSC vs Client Component；`useEffect` 清理/竞态/StrictMode；`NEXT_PUBLIC_*` 构建期内联；同源策略与 CORS；TS 类型擦除与 Zod 运行期校验（`safeParse`/`z.infer`/`strictObject`） |

---

## 二、阶段路线（与 `docs/00-开发总纲.md` 对齐）

| 阶段 | 功能模块 | 后端 TS（NestJS） | 后端 Python（FastAPI） | 前端（Next.js） | 状态 |
| --- | --- | --- | --- | --- | --- |
| 0 | 项目初始化 | 仓库骨架、契约包、`/health` | 同一契约的 `/health` | 首页连通两套后端 | ✅ 本次产出 |
| 1 | 账号与认证 | Prisma 用户表、注册/登录、JWT Guard | SQLAlchemy 用户表、注册/登录、Depends 鉴权 | 登录/注册页、token 存储 | ✅ 阶段完成 |
| 2 | 应用管理 | Apps CRUD（归属校验） | 同一 CRUD | 应用列表页 | ✅ 阶段完成 |
| 3 | 画布 | 图 JSON 存取与校验 | JSONB 映射与同一接口 | ReactFlow 画布 | ✅ 阶段完成 |
| 4 | 执行引擎 MVP | JSON → LangGraph → SSE | LangGraph(Python) → SSE | SSE 客户端 + 运行面板 | ✅ 阶段完成 |
| 5 | LLM 节点 | ChatOpenAI、流式、错误映射 | 同一行为 | 节点参数面板 | ✅ 阶段完成 |
| 6 | 工具调用 | Tool 注册表、ReAct 循环 | 工具注册表、同一循环 | 工具选择面板 | ✅ 阶段完成 |
| 7 | 知识库 RAG | 上传、切分、pgvector 检索 | 同一行为 | 知识库页、检索调试 | ✅ 阶段完成 |
| 8 | 分支与循环 | Condition / Aggregator / Iteration | 同一行为与数值序列化 | 多出口 Handle、分支面板 | ✅ 阶段完成 |
| 9 | 会话与记忆 | conversations / messages、历史注入 | 同一行为 | 会话面板 | ✅ 阶段完成 |
| 10 | 发布与 API | 发布快照、API Key、对外 SSE | 同一行为 | 发布面板、调用示例 | ✅ 阶段完成 |
| 11 | 自主 Agent 运行时 | Run / Composition / ReAct / 压缩 | 同一契约的 Python 实现 | Agent 控制台 | ⬜ |

---

## 三、当前目录

```
docs/doc2/
├── INDEX.md                        ← 本文件（路线 + 写作约定 + 进度）
├── 00-项目初始化/
│   ├── 01-环境与仓库骨架.md          ← Node/pnpm/uv、workspace、Docker、env
│   ├── 02-契约包.md                 ← packages/contract：OpenAPI + TS 类型
│   ├── 03-NestJS后端.md             ← api-ts：/health
│   ├── 04-FastAPI后端.md            ← api-py：同一契约的 /health
│   └── 05-NextJS前端与验收.md        ← web：页面 + Zod 运行期校验 + 双后端切换 + 阶段验收
├── 01-账号与认证/
│   ├── 01-契约扩展.md               ← /auth/register、/auth/login、/auth/me + Bearer 方案
│   ├── 02-Prisma用户表.md            ← User 模型、init_users 迁移、PrismaService/Module
│   ├── 03-NestJS注册登录.md          ← DTO、bcrypt、JWT 签发、JwtAuthGuard、统一错误体
│   ├── 04-SQLAlchemy用户表.md        ← 映射同一张 users 表、engine/SessionLocal、server_default
│   ├── 05-FastAPI注册登录.md         ← Pydantic 模型、bcrypt/PyJWT、Depends、错误体归一化
│   └── 06-前端登录页.md              ← 登录表单、token 存储、401 回跳、双后端切换
├── 02-应用管理/
│   ├── 01-契约扩展.md               ← /apps CRUD、ownerId 只从 token 取、PATCH/204 语义
│   ├── 02-Prisma关系.md             ← App 模型、外键/级联/索引、updated_at 默认值与触发器
│   ├── 03-NestJS应用模块.md         ← DTO、归属校验 404、@HttpCode(204)、出口收窄
│   ├── 04-SQLAlchemy关系.md         ← App 映射、back_populates、passive_deletes、default/onupdate
│   ├── 05-FastAPI应用模块.md        ← exclude_unset、Literal、db.get、refresh、跨端同表验证
│   └── 06-前端应用列表.md           ← 列表/新建/删除、useCallback依赖、204不解析、水合与时间
├── 03-画布/
│   ├── 01-图契约与校验.md           ← Graph 三件套、四个接口、规则 1~7、错误顺序与去重
│   ├── 02-JSONB存取.md              ← 三列迁移、GraphService、JSONB映射、两端JSON形状对齐
│   └── 03-ReactFlow画布.md          ← 受控画布、nodeTypes、screenToFlowPosition、buildGraph边界
├── 04-执行引擎/
│   ├── 01-SSE事件协议.md            ← 帧格式、六事件、时序与终态唯一、RunEventQueue、手写SSE
│   ├── 02-LangGraph编译图.md        ← Annotation/pool、模板解析、三节点运行时、编译执行
│   ├── 03-NestJS引擎.md             ← 模块接线、预检顺序、事件启动时机、失败路径逐个走
│   ├── 04-Python引擎.md             ← asyncio.Queue+哨兵、StreamingResponse、序列化逐字节对齐
│   └── 05-前端流式面板.md           ← 自写分帧、TextDecoder增量、逐事件让出渲染、终态处理
├── 05-LLM节点/
│   ├── 01-LLM节点契约与模型配置.md   ← LlmNodeData、输出形状、四环境变量、预检边界
│   ├── 02-真实模型调用与流式.md       ← ChatOpenAI/astream、content三形态、usage、重试与超时对齐
│   ├── 03-LLM错误映射.md              ← 六条规范文案、状态码优先、SDK字段差异、mock逐条触发
│   ├── 04-节点参数面板.md             ← 文本态数字输入、删键语义、浅合并、编辑与保存分离
│   └── 05-mock-LLM与验收.md           ← OpenAI兼容mock、固定码点分片、错误/延迟注入、阶段验收
├── 06-工具调用/
│   ├── 01-工具契约与内置工具.md        ← /tools、ToolDefinition、calculator解析器、http_get防SSRF
│   ├── 02-NestJS-ReAct循环与条件边.md  ← tool_call/tool_result、tool_call_chunks聚合、条件边回环、轮次上限
│   ├── 03-Python工具与ReAct对齐.md     ← Literal、跨语言数值格式化、LangChain tool_calls type、闭包绑定
│   ├── 04-前端工具选择面板.md          ← /tools拉取与降级、全不选删键、受控复选框、隐式启用
│   └── 05-验收.md                      ← 12用例矩阵、对比脚本、跨端回归、阶段清单
├── 07-知识库RAG/
│   ├── 01-知识库契约与pgvector建模.md  ← 7个接口、三张表、vector(1536)、HNSW索引漂移
│   ├── 02-文档切分与向量化.md          ← Multer内存、1MB三重校验、切分参数、批量embed、原生SQL写向量
│   ├── 03-NestJS检索与检索节点.md      ← <=>与相似度、ORDER BY索引匹配、retrieval事件、节点预检
│   ├── 04-Python对齐与前端知识库页.md  ← Vector映射、passive_deletes、切分对齐、FormData、检索页
│   └── 05-验收.md                      ← 同文件md5对比、检索顺序、失败不落库、17项清单
├── 08-分支与循环/
│   ├── 01-分支节点的契约与图校验.md    ← 三种节点data、规则8/9/10、sourceHandle与else保留字
│   ├── 02-NestJS条件边与变量聚合.md    ← branches状态、两段式路由、运算符语义、聚合扁平输出
│   ├── 03-迭代节点与跨语言数值对齐.md  ← 节点内循环、iteration_item、js_json_dumps、1.0与NaN对齐
│   ├── 04-前端多出口Handle与分支面板.md ← 多出口Handle、分支增删级联删边、聚合/迭代面板
│   └── 05-验收.md                      ← 分支/聚合/迭代用例矩阵、事件级diff、回归ReAct
├── 09-会话与记忆/
│   ├── 01-会话契约与数据建模.md        ← 5个接口、conversations/messages、seq唯一约束、useHistory
│   ├── 02-历史加载与上下文注入-NestJS.md ← 先读后写、pool.conversation、useHistory、助手消息落库时机
│   ├── 03-checkpointer与自建消息表.md   ← 执行状态 vs 业务记录、三条否决理由、共存分层、接入清单
│   ├── 04-Python对齐与前端会话面板.md   ← SQLAlchemy映射、IntegrityError重试、5接口、会话面板与乐观气泡
│   └── 05-验收.md                      ← 注入token差值、截断最近N条、失败留痕、跨端diff、回归清单
└── 10-发布与API/
    ├── 01-发布语义与API-Key契约.md      ← 4个接口、apiKeyAuth、ApiKey四元组、api_keys迁移
    ├── 02-API-Key安全设计.md            ← randomBytes(16)、SHA-256、prefix、重名规则、软删除、lastUsedAt写放大
    ├── 03-对外SSE接口与双后端对齐.md    ← PublicController五步校验、runPublished、Python public、事件diff
    ├── 04-前端发布面板与调用示例.md      ← 发布前putDraft、一次性明文、撤销重拉、curl示例、Zod校验
    └── 05-验收.md                        ← 快照隔离、key生命周期、4xx与流内失败、跨端diff、回归清单
```

---

## 四、阶段 0 完成后的仓库形态

```
mini-dify/
├── apps/
│   ├── api-ts/          # NestJS，:3001
│   ├── api-py/          # FastAPI，:8000
│   └── web/             # Next.js，:3000（app/ 页面 + lib/ Zod 校验层）
├── packages/
│   └── contract/        # 唯一契约：openapi.yaml + TS 类型
├── docker-compose.yml   # 只跑 PostgreSQL + pgvector
├── package.json         # 根脚本：一条命令启动任一端
├── pnpm-workspace.yaml
└── .env.example         # 中间件变量（数据库账号/库名/端口）
```

**验收一句话**：浏览器打开 `http://localhost:3000`，页面显示 `api-ts` 的 health JSON；把 `apps/web/.env.local` 切成 `8000` 并重启，页面显示 `api-py` 的 health JSON，前端代码一行不改。

---

## 五、后续篇目（按开发顺序追加）

| 阶段 | 计划篇目 |
| --- | --- |
| 1 账号与认证 | `01-契约扩展.md` ✅、`02-Prisma用户表.md` ✅、`03-NestJS注册登录.md` ✅、`04-SQLAlchemy用户表.md` ✅、`05-FastAPI注册登录.md` ✅、`06-前端登录页.md` ✅ |
| 2 应用管理 | `01-契约扩展.md` ✅、`02-Prisma关系.md` ✅、`03-NestJS应用模块.md` ✅、`04-SQLAlchemy关系.md` ✅、`05-FastAPI应用模块.md` ✅、`06-前端应用列表.md` ✅ |
| 3 画布 | `01-图契约与校验.md` ✅、`02-JSONB存取.md` ✅、`03-ReactFlow画布.md` ✅ |
| 4 执行引擎 | `01-SSE事件协议.md` ✅、`02-LangGraph编译图.md` ✅、`03-NestJS引擎.md` ✅、`04-Python引擎.md` ✅、`05-前端流式面板.md` ✅ |
| 5 LLM 节点 | `01-LLM节点契约与模型配置.md` ✅、`02-真实模型调用与流式.md` ✅、`03-LLM错误映射.md` ✅、`04-节点参数面板.md` ✅、`05-mock-LLM与验收.md` ✅ |
| 6 工具调用 | `01-工具契约与内置工具.md` ✅、`02-NestJS-ReAct循环与条件边.md` ✅、`03-Python工具与ReAct对齐.md` ✅、`04-前端工具选择面板.md` ✅、`05-验收.md` ✅ |
| 7~11 | 同上表模块，逐阶段追加 |

### 阶段 7 计划篇目

| 篇目 | 内容 |
| --- | --- |
| `01-知识库契约与pgvector建模.md` ✅ | 7 个接口、三张表、`vector(1536)`、HNSW |
| `02-文档切分与向量化.md` ✅ | 上传校验、切分、批量 embedding、事务 |
| `03-NestJS检索与检索节点.md` ✅ | `<=>` 检索、`knowledge` 节点、`retrieval` 事件 |
| `04-Python对齐与前端知识库页.md` ✅ | Vector 映射、同一检索、上传/检索页 |
| `05-验收.md` ✅ | 上传、命中、跨端一致、无密钥降级 |

### 阶段 8 计划篇目

| 篇目 | 内容 |
| --- | --- |
| `01-分支节点的契约与图校验.md` ✅ | 三种节点 data、规则 8/9/10、`sourceHandle` |
| `02-NestJS条件边与变量聚合.md` ✅ | 条件边分派、`matched`、aggregator 取值 |
| `03-迭代节点与跨语言数值对齐.md` ✅ | 迭代 state、`itemIndex/itemCount`、数值序列化 |
| `04-前端多出口Handle与分支面板.md` ✅ | 多 handle、分支编辑、连线校验 |
| `05-验收.md` ✅ | 分支/聚合/迭代用例矩阵 |

### 阶段 9 计划篇目

| 篇目 | 内容 |
| --- | --- |
| `01-会话契约与数据建模.md` ✅ | 5 个会话接口、`conversations`/`messages`、`seq` 唯一约束、`useHistory` |
| `02-历史加载与上下文注入-NestJS.md` ✅ | `pool.conversation`、先读后写、`run_finished` 前落助手消息 |
| `03-checkpointer与自建消息表.md` ✅ | 为什么不用 LangGraph checkpointer、消息表的读写边界 |
| `04-Python对齐与前端会话面板.md` ✅ | 同一 `seq` 语义、会话列表/消息流、SSE 复用 |
| `05-验收.md` ✅ | 多轮上下文、跨端会话一致、失败不落库 |

### 阶段 10 计划篇目

| 篇目 | 内容 |
| --- | --- |
| `01-发布语义与API-Key契约.md` ✅ | 4 个接口、`apiKeyAuth`、`ApiKey` 四元组、`api_keys` 迁移 |
| `02-API-Key安全设计.md` ✅ | 生成/哈希/校验、重名规则、撤销、`lastUsedAt`、时序比较 |
| `03-对外SSE接口与双后端对齐.md` ✅ | `runPublished`、对外 SSE、Python 对齐、校验顺序 |
| `04-前端发布面板与调用示例.md` ✅ | 发布按钮、key 列表、一次性明文提示、调用示例 |
| `05-验收.md` ✅ | 快照隔离、key 生命周期、跨端一致、回归清单 |

> 每完成一个阶段，就把该阶段的「命令 + 完整代码 + 验证」写进对应目录；旧阶段不回头改，除非契约变更。
