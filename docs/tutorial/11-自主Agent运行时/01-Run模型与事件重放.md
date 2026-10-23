# 01 · Run 模型与事件重放

> 所属：阶段 11 · 自主 Agent 运行时
>
> 本篇覆盖：把 `packages/contract/openapi.yaml` 升到 **`0.11.0`**，新增 **5 个 `/agent/runs` 接口**（`POST|GET /agent/runs`、`GET /agent/runs/{id}`、`POST /agent/runs/{id}/cancel`、`GET /agent/runs/{id}/events`，共 4 个路径）与 **7 组 schema**（`CompositionLayer` / `Composition` / `CreateAgentRunRequest` / `AgentRunResponse` / `AgentRunListResponse` / `CreateAgentRunResponse` / `CancelAgentRunResponse`）；新建事件协议唯一真源 **`packages/contract/agent-events.md`**；在 `src/index.ts` 同步类型；在 `error-messages.md` 新增 **§11 Agent 运行时**（16 条 4xx + 1 条流内文案）；用 Prisma 建 `agent_runs` / `agent_run_events` 两张表并生成迁移 `20261023151132_add_agent_runs`；Python 侧只做 SQLAlchemy 映射；最后给出两端的**受理器 + 后台执行器 + 事件写入器 + 进程内订阅表 + SSE 重放接口**。
>
> **本篇首次教学**：① **为什么 Agent 运行时必须「异步受理」**——一次 ReAct 可能跑多轮工具、耗时远超一个 HTTP 请求的合理寿命，`202 + runId` 表达的是「**已受理，结果另行获取**」；② **Run 的状态机**——`queued → running → succeeded | failed | cancelled`，**没有回退边**，全项目只有三处写状态；③ **`run_queued` 为什么必须落库**——客户端拿到 `202` 后可能**立刻**订阅，此时 `run_started` 还没产生，必须先有一条「已受理」事件可重放；④ **事件持久化 + 实时推送的双通道**——每次发事件**先写 `agent_run_events`（seq 自增）→ 再推订阅者**，顺序反了就会「收到过的事件重连后消失」；⑤ **`seq` 单次运行内单调 + `UNIQUE(run_id, seq)`**——与阶段 9 的 message `seq` 同理，但这里是**事件流**的序号；⑥ **`Last-Event-ID` 重放**——SSE 帧带 `id:` 行、服务端只推 `seq > N`、非法值在**开流前** 400；⑦ **「重放 + 实时」的衔接窗口**——先订阅、再重放、二次补重放、按 `seq` 排序去重；为什么不能简单地「先重放、后订阅」；⑧ **协作式取消**——`cancelRequestedAt` 标记 + 在**层边界（每层开始前）与工具轮边界**检查，不强杀线程；检查到后只发 `run_cancelled`。**取消成功 ≠ 必现 `run_cancelled`**（若已进入最后一层/即将完成，可能仍以 `run_finished` 结束），客户端以 **SSE 终态**为准；⑨ **终态唯一**——`run_finished` / `run_failed` / `run_cancelled` 三选一，终态事件与状态更新在**同一个事务**里提交；⑩ **同步回调如何写出有序的异步事件**——TS 用串行 Promise 链给 token 这类同步回调「先占号、后写库」，Python 直接内联 `await`；⑪ **进程内执行与进程内订阅的边界**——进程重启**不会自动续跑**，多副本下「A 执行、B 订阅」也拿不到实时事件（本阶段明确不做）。
>
> （已在前序篇教学、本篇只引用不重讲：OpenAPI 的 `paths` / `$ref` / `enum` / `additionalProperties` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；SSE 帧格式、「先校验、后开流」与双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；`fetch + getReader` 分帧与 `EventSource` 无法带 `Authorization` 见 `04-执行引擎/06-前端SSE客户端与运行面板.md`；LangGraph `StateGraph` / 条件边 / 环见 `04-执行引擎/02-LangGraph编译图-TS.md`、`06-工具调用/02-NestJS-ReAct循环与条件边.md`；`Contract` 的 `seq` 与 `UNIQUE(conversation_id, seq)` 见 `09-会话与记忆/01-会话契约与数据建模.md`；「副作用先做完再宣布成功」见 `09-会话与记忆/02-历史加载与上下文注入-NestJS.md`；Prisma 迁移与 `@@unique` / `@@index` / `@map` 见 `01-账号与认证/02-Prisma.md`、`02-应用管理/02-Prisma关系建模.md`；SQLAlchemy 映射与「Prisma 拥有 DDL」见 `01-账号与认证/04-SQLAlchemy2.0.md`；`JwtAuthGuard` / `@CurrentUser` 见 `01-账号与认证/03-NestJS认证.md`；Pydantic v2 / `ConfigDict(extra="forbid")` / `iso_z` 见 `00-项目初始化/06-FastAPI起步.md`、`02-应用管理/07-验收.md`；`asyncio.Queue` ↔ 异步生成器见 `04-执行引擎/04-LangGraph与引擎-Python.md`。）
>
> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 11 的立论：从「一次请求一次运行」到「受理、执行、读取三件事分开」

前面十个阶段，运行只有一种形态：

```
POST /apps/{id}/run  { inputs }        ← 请求本身就是一个 SSE 长响应
  └─ 边执行边往这个响应里写帧；流结束 = 运行结束
```

工作流的运行是**有界**的：图是线性的（阶段 8 的循环有 `maxIterations`），一眼能看到尽头，几秒内必然结束。于是「**HTTP 请求 = 运行**」这个等式成立。

自主 Agent 打破了这个等式。一次 ReAct 循环是：

```
LLM 调用 → 决定调工具 → 执行工具 → 把工具结果塞回上下文 → 再调 LLM → …（可到 maxRounds 轮）
```

单次 LLM 调用就可能十几秒，多轮叠加后**分钟级**是常态。这时把运行继续挂在原来的 HTTP 请求上，会遇到三个硬问题：

| 问题 | 后果 |
| --- | --- |
| 代理 / 网关的空闲超时（常见 60s） | 请求被中间层掐断，客户端看到「连接被重置」，但服务端还在跑 |
| 移动网络切换 / 浏览器刷新 | 连接断了就**没有任何办法**在同一个请求上「接着看」 |
| 取消 | 没有独立的「取消」入口，只能靠断开连接暗示，服务端还不一定知道 |

于是阶段 11 把一件运行拆成**三件独立的事**，每件都有自己的接口：

| 事 | 接口 | 语义 |
| --- | --- | --- |
| **受理** | `POST /agent/runs` → **202** `{id, status:"queued"}` | 我收下了，**结果另行获取** |
| **执行** | （后台任务，不占请求） | 写事件、写状态 |
| **读取** | `GET /agent/runs/{id}/events`（SSE） | 可**随时加入**、可**断线重连**、可**从头重放** |
| （补充）查询 | `GET /agent/runs/{id}` | 拿最终结果（`output` / `error` / 状态） |
| （补充）取消 | `POST /agent/runs/{id}/cancel` → 202 | 请求停止，异步生效 |

### 0.1 一句话记住这个阶段

> **`202` 是收据，不是结果；结果要么看事件流（过程），要么看 `GET /runs/{id}`（终值）。**

### 0.2 四条边界（本阶段刻意不做的事）

| 不做 | 原因 |
| --- | --- |
| **进程重启后续跑** | 执行器是进程内任务，没有队列 / 租约 / checkpoint；续跑需要一整套恢复机制（见 §12.10） |
| **跨进程实时推送** | 订阅表在内存里；执行与订阅必须在**同一个进程**。水平扩展需要外部 broker |
| **强杀执行** | 不做线程/任务 kill；取消是「标记 + 边界检查」的协作式取消（见 §12.8） |
| **取消宽限期** | `cancelRequestedAt` 一旦被检查到就立刻收尾，没有「再跑 5 秒」的缓冲 |

---

## 1. 本篇目标

做完这一篇，你能：

- 在契约里新增 5 个接口（4 个路径）与 7 组 schema，并把 `CONTRACT_VERSION` 升到 **`0.11.0`**。
- 说清「异步受理」到底解决了什么，以及 `202` 与 `200` / `201` 的语义差别。
- 说清 Run 的五个状态、**谁能写它们**、为什么不存在回退边。
- 说清 `run_queued` 为什么必须**在返回 202 之前**落库（而不是执行时才发）。
- 说清事件「**先写库、再推送**」的顺序为什么不能反，并能在断线场景下推出后果。
- 说清 `seq` 的起点、为什么是**单次运行内**的计数器、`UNIQUE(run_id, seq)` 保证了什么。
- 说清 `Last-Event-ID` 的帧格式、请求头优先于查询参数、非法值为什么必须 400。
- 说清「先重放、后订阅」为什么会丢事件，以及本项目为什么用「**先订阅 → 重放 → 二次补重放 → 按 seq 去重排序**」把窗口补上（契约 §4 已按此改写）。
- 说清取消为什么是协作式的、检查点在哪、取消后为什么**只发 `run_cancelled`**。
- 说清「终态唯一」与「终态事件和状态更新同事务」的关系。
- 亲手跑通：202 → 事件流 `id 1..16` → 重放 → 取消 → 错误文案，并确认两端逐字节一致。

**验收标准**

1. `pnpm run build:contract` 成功；`openapi.yaml#/info/version` 与 `CONTRACT_VERSION` 均为 **`0.11.0`**。
2. `openapi.yaml` 含 5 个新操作：`createAgentRun` / `listAgentRuns` / `getAgentRun` / `cancelAgentRun` / `streamAgentRunEvents`。
3. `POST /agent/runs` 成功码为 **202**，响应体恰为 `{id, status}` 且 `status` 只能是 `"queued"`；`POST /agent/runs/{id}/cancel` 也是 **202**，`status` 只能是 `queued` / `running`。
4. `AgentRunResponse.status` 的 `enum` 恰为 `queued / running / succeeded / failed / cancelled`。
5. `agent_runs` 与 `agent_run_events` 两张表存在；`agent_run_events` 有 **`UNIQUE (run_id, seq)`**；两条外键都是 `ON DELETE CASCADE`。
6. 迁移目录名为 `20261023151132_add_agent_runs`，且阶段 7 的 `chunks_embedding_hnsw` 索引**仍然存在**。
7. 一次 5 层运行（history / prompt / tools / llm / output）的事件流：`id` 从 **1 到 16 连续**，事件序列为 `run_queued > run_started > layer_started/layer_finished ×3 > layer_started(llm) > token×3 > layer_finished > layer_started(output) > layer_finished > run_finished`。
8. 两端（api-ts / api-py）用同一份 composition 跑出的 **`ids=1..16` 与事件序列完全相同**。
9. 重放：`Last-Event-ID: 5` → 首帧 `id: 6`；`?lastEventId=13` → 首帧 `id: 14`。
10. 取消：事件流中出现 `run_cancelled` 且**没有** `run_finished`；`GET /agent/runs/{id}` 的 `status = cancelled`、`output = null`；再次取消返回 400 `Run is not cancellable`。
11. 错误：不存在的运行 → 404 `Run not found`；`Last-Event-ID: abc` → 400 `invalid Last-Event-ID`（两者都是**普通 JSON**，不是 SSE）。
12. 每条事件在库里都能查到（`select seq, event from agent_run_events ... order by seq`），且 `seq` 与帧里的 `id:` 一一对应。

---

## 2. 前置条件

| 前置 | 状态要求 | 出处 |
| --- | --- | --- |
| 本地中间件 | `docker compose ps` 里 `mini-dify-db` 为 `healthy` | `00-项目初始化/02-本地中间件Docker.md` |
| 契约可编译 | `pnpm run build:contract` 可用；阶段 10 时是 `0.10.0` | `00-项目初始化/04`、`10-发布与API/01` |
| 认证就位 | 已能注册 / 登录；`Bearer` 令牌跨端互认 | `01-账号与认证/06`、`07` |
| 工具注册表 | `GET /tools` 可用，含 `calculator` / `get_current_time` / `http_get` | `06-工具调用/01` |
| LLM 可调用 | `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 已配置；**离线自测请指向 mock LLM** | `05-LLM节点/02`、`05-LLM节点/04` |
| 两套后端 | api-ts 监听 `:3001`、api-py 监听 `:8000` | `00-项目初始化/08` |
| Prisma 可用 | 能执行 `pnpm --filter @mini-dify/api-ts db:migrate` | `01-账号与认证/02` |

> **本篇的验收不需要真实 LLM 密钥**：把两端 `.env` 的 `LLM_BASE_URL` 指向仓库自带的 mock（`node tools/mock-llm/server.mjs`，监听 `11435`），并设 `LLM_MODEL=mock-model`（做法见 `05-LLM节点/04-mock-LLM与无密钥自测.md`，本篇只引用）。
>
> **迁移所有权**仍是阶段 1 定下的规矩：**Prisma 拥有 DDL，SQLAlchemy 只映射**。`apps/api-py` 没有 alembic，启动时只是把 `AgentRun` / `AgentRunEvent` 映射到已经存在的表。

---

## 3. 先看清要做什么

### 3.1 文件地图

```
packages/contract/
   ├── agent-events.md        ← **新建**：事件协议 + 层语义唯一真源                 （本篇 §5）
   ├── openapi.yaml           ← 5 个接口（4 个路径）+ 7 组 schema；info.version = 0.11.0   （本篇 §6）
   ├── src/index.ts           ← 同步类型；CONTRACT_VERSION = 0.11.0                  （本篇 §7）
   └── error-messages.md      ← §11 Agent 运行时（16 条 4xx + 1 条流内 + 校验顺序）  （本篇 §8）
        ↓ pnpm run build:contract
      dist/index.js + dist/index.d.ts

apps/api-ts/
   ├── prisma/schema.prisma   ← AgentRun + AgentRunEvent + User 反向关系            （本篇 §9.1）
   ├── prisma/migrations/20261023151132_add_agent_runs/migration.sql                （本篇 §9.2）
   └── src/agent/
        ├── agent-events.ts          ← 事件名 / payload / 帧序列化 / 取消信号       （本篇 §10.1）
        ├── agent-events.emitter.ts  ← 进程内订阅表 + 单请求流（排序去重）          （本篇 §10.2）
        ├── agent-runner.service.ts  ← accept / 执行器 / 重放 / 取消                （本篇 §10.3）
        ├── agent.controller.ts      ← 5 个接口（含 SSE 手写帧）                    （本篇 §10.4）
        └── agent.module.ts                                                         （本篇 §10.5）

apps/api-py/app/
   ├── models/agent_run.py    ← 只映射，不产生 DDL                                  （本篇 §11.3）
   ├── agent/events.py        ← 事件名 / 帧序列化 / 取消信号                        （本篇 §11.1）
   ├── agent/emitter.py       ← 进程内订阅表（dict[run_id, set[Queue]]）            （本篇 §11.2）
   ├── agent/runner.py        ← accept / 执行器 / 重放 / 取消                       （本篇 §11.4）
   └── api/agent.py           ← 5 个接口（含 StreamingResponse）                    （本篇 §11.5）
```

### 3.2 5 个 HTTP 接口

| # | 方法与路径 | 鉴权 | 请求体 | 成功响应 | 关键点 |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /agent/runs` | JWT | `{input, composition}` | **202** `{id, status:"queued"}` | 校验失败 400，**不创建运行** |
| 2 | `GET /agent/runs` | JWT | — | `200 {items:[]}` | `createdAt` 倒序、只含本人 |
| 3 | `GET /agent/runs/{id}` | JWT | — | `200 AgentRunResponse` | 终值：`status` / `output` / `error` |
| 4 | `POST /agent/runs/{id}/cancel` | JWT | — | **202** `{id, status}` | 只置 `cancelRequestedAt`；终态再取消 → 400 |
| 5 | `GET /agent/runs/{id}/events` | JWT | — | `200` SSE | 帧带 `id:`；支持 `Last-Event-ID` / `lastEventId` |

> 5 个接口都在 **JWT 域**（不是阶段 10 的 API Key 域）：自主 Agent 是「登录用户自己的工作台」，暂不对外发布。

### 3.3 一次运行的时间线（从上到下是时间）

```
客户端                                   api（同一进程）                          DB
  │                                          │                                   │
  ├─ POST /agent/runs ───────────────────────▶│ ① validateComposition             │
  │                                          ├─ INSERT agent_runs(status=queued) ─▶│
  │                                          ├─ INSERT event seq=1 run_queued ────▶│
  │                                          ├─ void execute(runId) / create_task │
  │◀──────────── 202 {id, status:"queued"} ──┤                                   │
  │                                          │ ② UPDATE status=running ─────────▶│
  │                                          ├─ emit run_started (seq=2) ────────▶│
  ├─ GET .../events ─────────────────────────▶│ ③ subscribe（内存）               │
  │                                          ├─ replay seq > 0（读 DB）──────────▶│
  │◀──── id:1 run_queued（重放）─────────────┤                                   │
  │◀──── id:2 run_started（重放）────────────┤                                   │
  │                                          ├─ 每层：layer_started / … / layer_finished
  │◀──── id:3… live ─────────────────────────┤   先写库，再 publish              │
  │                                          │                                   │
  │                          （可选）POST .../cancel → UPDATE cancel_requested_at │
  │                                          │ 在层边界/工具轮边界检查 → 抛取消   │
  │                                          ├─ 事务：event run_cancelled + 终态 ─▶│
  │◀──── id:N run_cancelled ─────────────────┤                                   │
```

### 3.4 数据库里长什么样

`agent_runs` 一行：

| 列 | 示例 | 说明 |
| --- | --- | --- |
| `id` | `3f2c…`（uuid） | 应用侧生成 |
| `owner_id` | `user_…` | 外键，级联删除 |
| `status` | `succeeded` | `queued / running / succeeded / failed / cancelled`（普通 `TEXT`，**不是** DB enum） |
| `composition` | `{"version":"1","layers":[…]}` | `JSONB`，受理时冻结的整份组合 |
| `input` | `Hello` | 模板变量（1..4000 字符） |
| `output` | `echo: …` | 成功时的最终输出；否则 `null` |
| `error` | `null` | 失败时的 `run_failed.message`；否则 `null` |
| `created_at` | `2026-10-23T15:11:32.000` | 受理时间（毫秒精度） |
| `started_at` | `…` | 执行器开始时间；仍在 `queued` 时 `null` |
| `finished_at` | `…` | 进入终态的时间 |
| `cancel_requested_at` | `null` | 取消**请求**时间（不是状态！） |

`agent_run_events` 每行一个事件：

| 列 | 示例 | 说明 |
| --- | --- | --- |
| `id` | uuid | 行主键（与 `seq` 无关） |
| `run_id` | run 的 id | 外键，级联删除 |
| `seq` | `7` | **单次运行内**从 1 递增；即 SSE 帧的 `id:` |
| `event` | `layer_started` | 事件名（10 种之一） |
| `data` | `{"layer":"tools","index":3}` | `JSONB`，payload |
| `created_at` | `…` | 写入时间 |

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行；两个 dev server 与 mock LLM 各自单开终端。
> Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请写 **`curl.exe`**。

| # | 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- | --- |
| 1 | `pnpm run build:contract` | 仓库根 | 把 `0.11.0` 契约编译进 `dist` | 无报错；`dist/index.js`、`index.d.ts` 更新 |
| 2 | `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_agent_runs` | 仓库根 | 由 schema 生成并应用迁移，建两张表 | 生成/应用 `20261023151132_add_agent_runs` |
| 3 | `pnpm --filter @mini-dify/api-ts db:generate` | 仓库根 | 重新生成 Prisma Client（`agentRun` / `agentRunEvent` 可用） | `Generated Prisma Client` |
| 4 | `docker exec -i mini-dify-db psql -U postgres -d minidify -c "\d agent_run_events"` | 仓库根 | 验证列、唯一约束、外键 | 见 §9.3 |
| 5 | `docker exec -i mini-dify-db psql -U postgres -d minidify -c "\di chunks_embedding_hnsw"` | 仓库根 | 确认阶段 7 的 HNSW 索引没被 Prisma 顺手删掉 | 索引存在 |
| 6 | `node tools/mock-llm/server.mjs` | 仓库根（终端 A） | 起无密钥、确定性 mock LLM（`11435`） | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| 7 | `pnpm dev:api-ts` | 仓库根（终端 B） | 启动 NestJS | `Nest application successfully started`，监听 `:3001` |
| 8 | `pnpm dev:api-py` | 仓库根（终端 C） | 启动 FastAPI（Python 侧**没有**迁移，只映射同一张表） | `Uvicorn running on http://127.0.0.1:8000` |

**关于第 2 步的两点说明**

1. 仓库现状里迁移目录已经存在（`20261023151132_add_agent_runs`），所以这一步通常只做「应用」而不是「新建」，输出可能是 `Already in sync`。从更早阶段跟做时，Prisma 会生成新的时间戳前缀，**内容与 §9.2 相同**即可。
2. **Prisma 可能顺手 DROP 掉阶段 7 的 HNSW 索引**。本阶段的迁移文件第一条注释就是为此留的（见 §9.2）。每次 `migrate dev` 后都要检查生成的 SQL，再跑 `pnpm --filter @mini-dify/api-ts db:index`，并用第 5 条命令确认索引仍在。

**为什么 Python 侧没有第 2 步**

阶段 1 定下的规矩：**Prisma 拥有 DDL，SQLAlchemy 只映射**。`apps/api-py` 启动时只是把两个模型类映射到已经存在的表。新增字段的正确流程永远是：

```
改 schema.prisma → prisma migrate dev → Python 模型跟着加 mapped_column → 两端重启
```

---

## 5. 完整代码：`packages/contract/agent-events.md`（事件协议唯一真源）

> 这是本阶段**最重要的一份文档**：它同时规定「帧怎么排」「事件有哪些」「层怎么执行」「重放与取消的语义」。两端的实现都必须以它为准；改协议必须同时改它和两端。

````markdown
# Agent 事件协议（唯一真源）

自主 Agent 运行时（阶段 11）由三组接口组成：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/agent/runs` | 校验 `composition` 后**立即**返回 `202`（`status: "queued"`），后台异步执行 |
| `GET` | `/agent/runs/{id}/events` | 以 `text/event-stream` 返回运行事件，支持 `Last-Event-ID` 重放 |
| `POST` | `/agent/runs/{id}/cancel` | 异步取消（置 `cancelRequestedAt`，由执行器收尾） |

两套后端（`apps/api-ts` 与 `apps/api-py`）必须产出**逐字节相同**的帧格式、
**完全一致**的事件序列，以及**逐字节一致**的层语义（模板渲染、历史压缩、ReAct 循环）。
本文档是事件与层语义的唯一真源：修改时必须同步更新本文件与两端实现。
错误文案见 `error-messages.md` §11。

## 1. 帧格式（固定）

每个事件一个帧，格式**逐字节固定**为：

```
id: <seq>\n
event: <name>\n
data: <单行 JSON>\n\n
```

- `id:` 行为该事件的 `seq`（单次运行内从 **1** 开始、全局单调递增），供客户端断线重连时
  作为 `Last-Event-ID` 回传；同一运行的 `seq` 不跳号、不重复。
- `event:` 行是事件名（见 §2），`data:` 行是 payload 的**单行** JSON（不含换行）。
- 三行之间各以单个 `\n` 分隔，帧以空行结束（`data` 行后的 `\n\n`）。
- 键的顺序为实现细节，不要求两端一致；两端以「**解析后的 JSON 相等**」为准比对。

> 与工作流 SSE（`sse-events.md`）唯一的帧格式差异就是这里**必须有 `id:` 行**：
> Agent 事件会持久化到 `agent_run_events`，靠 `seq` 支持重放。

## 2. 事件类型与 payload

| 事件 | 触发时机 | payload |
| --- | --- | --- |
| `run_queued` | 接受运行、写入 DB 后（**总是 seq 1**） | `{"runId": string, "status": "queued"}` |
| `run_started` | 执行器开始执行（状态置 `running`） | `{"runId": string}` |
| `layer_started` | 某层开始执行 | `{"layer": string, "index": number}`（`index` 从 **1** 开始） |
| `token` | `llm` 层流式产出一片文本 | `{"text": string}` |
| `tool_call` | `llm` 层决定调用工具 | `{"toolName": string, "args": object, "round": number}`（`round` 从 **1** 开始） |
| `tool_result` | 该工具执行完成 | `{"toolName": string, "result": string, "elapsedMs": number, "round": number}` |
| `layer_finished` | 某层执行结束 | `{"layer": string, "index": number}` |
| `run_finished` | 整次运行成功结束 | `{"output": string, "elapsedMs": number}` |
| `run_failed` | 执行中途出错并终止 | `{"message": string}` |
| `run_cancelled` | 取消生效并结束 | `{"runId": string}` |

### 2.1 事件顺序（固定）

```
run_queued                              ← seq 1
run_started
  （对 layers 数组里的每一层，按顺序：）
    layer_started(layer, index)
      （仅 llm 层：若干 token / tool_call / tool_result）
    layer_finished(layer, index)
run_finished | run_failed | run_cancelled   ← 恰好一个终态事件
```

- `layer_started` / `layer_finished` 的 `index` 对应 `composition.layers` 的下标 + 1，
  与层名一起出现；**每一层各发一对**（包括 `output` 层）。
- `llm` 层内部的事件顺序与工作流 ReAct 一致（`sse-events.md` §3.1）：
  ```
  token*                 ← 本轮模型流式文本
  tool_call(round 1)     ← 同一轮的多个调用可连续出现
  tool_result(round 1)   ← 与 tool_call 按调用顺序一一对应
  token*
  tool_call(round 2)
  …
  token*                 ← 最后一轮（无 tool_calls）的文本
  ```
- **终态唯一**：`run_finished` / `run_failed` / `run_cancelled` 三者**恰有其一**；
  终态事件之后不再有任何事件，SSE 流随即关闭。
- `seq` 在**单次运行内**从 1 全局单调递增（每次运行独立编号），所有事件共用同一个计数器。

## 3. 组合与层语义

```jsonc
{
  "version": "1",
  "layers": [
    { "name": "history", "config": {} },
    { "name": "prompt",  "config": { "system": "...", "template": "Q: {{ input }}" } },
    { "name": "tools",   "config": { "names": ["calculator"] } },
    { "name": "llm",     "config": { "model": "mock-model", "maxRounds": 5 } },
    { "name": "output",  "config": {} }
  ]
}
```

- `layers` **按数组顺序**执行，层间共享同一份消息数组与工具声明。
- `llm` 层**必须恰好一个**（0 个或多个均 400）；每个层名在数组里**最多出现一次**；
  层名只能是 `history` / `prompt` / `tools` / `llm` / `output`（否则 400，见 §6）。
- 层与层之间不做隐式重排：例如 `prompt` 写在 `history` 之前，则历史消息会排在
  prompt 的 system/user 消息**之后**（由客户端自行决定顺序）。
- 请求体的 `input`（1..4000 字符）是本次运行唯一的模板变量来源。

### 3.1 `history` 层

`config`：

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `messages` | `Array<{role, content}>` | `[]` | 历史消息，`role` 取 `user` / `assistant` / `system` |
| `maxMessages` | integer `1..100` | `20` | 压缩后保留的**最后 N 条** |
| `compactionThreshold` | integer `1..100` | `12` | 超过该条数才触发压缩 |
| `keepRecent` | integer `1..50` | `6` | 压缩时原样保留的**最后 N 条** |

**历史压缩（确定性，两端一致）**，严格按以下两步：

1. 若 `len(messages) > compactionThreshold`：把**前 `len - keepRecent` 条**替换成
   **一条** `{"role": "system", "content": "[compacted] {n} earlier messages omitted"}`，
   其中 `n = len - keepRecent`（被替换的条数），后 `keepRecent` 条原样保留。
2. 再按 `maxMessages` **保留最后 N 条**（不足 N 条时全部保留）。

例：20 条消息、`compactionThreshold = 12`、`keepRecent = 6` →
先变成 `1 + 6 = 7` 条（首条为 `[compacted] 14 earlier messages omitted`），
`maxMessages = 20` 不再截断，最终 7 条。

> 这是「**确定性截断**」而非 LLM 摘要：真实系统通常会调用模型对历史做摘要压缩，
> 但那样无法保证两端逐字节一致、也无法复现。本项目为可复现性选择确定性方案。

压缩后的消息按 `user` / `assistant` / `system` 角色原样进入消息数组（`history` 层自身
不发 `token`；它只影响后续 `llm` 层看到的上下文）。

### 3.2 `prompt` 层

`config`：

| 键 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `system` | string | 否 | system 消息；空字符串或缺失则该层不追加 system 消息 |
| `template` | string | **是** | user 消息模板（缺失或非字符串 → 400） |

- 渲染作用域**只有 `{ "input": <请求里的 input> }`**：`{{ input }}` 被替换为输入文本。
- 复用工作流的**安全模板语义**（`tryRenderTemplate`）：路径不存在时替换为**空串**，
  不抛错；模板其余文本原样保留。
- 渲染后追加 `system`（非空时）与 `user` 消息到共享消息数组。

### 3.3 `tools` 层

`config`：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `names` | `string[]` | 本轮可用工具名，必须都在注册表（`GET /tools`）中 |

未知工具名在**接受运行前**即 400（`tools layer references unknown tool: {name}`），
不会等到执行期。`names` 缺失或空数组表示不使用工具。

### 3.4 `llm` 层

`config`：

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 环境变量 `LLM_MODEL` | 为空时回退 |
| `maxRounds` | integer `1..20` | `5`（可由 `AGENT_MAX_ROUNDS` 覆盖默认值） | ReAct 工具轮上限 |
| `temperature` | number | — | 透传给 provider |

ReAct 循环用 **LangGraph `StateGraph` + 条件边 + 环**实现（节点 `llm` 与 `tools`），
工作流引擎阶段 6 同技术：

- `llm` 节点：逐 chunk 发 `token`；有 `tool_calls` → 条件边转到 `tools`，否则结束循环。
- `tools` 节点：发 `tool_call` → 执行（复用工具注册表）→ 发 `tool_result` →
  追加 `ToolMessage` → 回到 `llm`。
- `round` 从 1 开始；超过 `maxRounds` → `run_failed`，`message` 为
  `agent rounds exceeded: {max}`。
- provider 错误复用工作流的映射规则（`mapLlmError`，见 `error-messages.md` §5）；
  工具失败为 `tool {name} failed: {reason}`（reason 取值见 `error-messages.md` §6.2）。

### 3.5 `output` 层

`config`：`{}`（无字段）。取消息数组中**最后一条 assistant 消息**的文本作为最终输出，
写入 `run_finished.output` 与 `AgentRun.output`。没有 assistant 消息时输出为空串。

## 4. 重放（`Last-Event-ID`）

- 客户端可带请求头 `Last-Event-ID`（**优先**）或查询参数 `lastEventId`，值为「已收到的
  最大事件 seq」。两者都没有时按 `0` 处理（即从头重放）。
- 服务端行为：**先订阅实时事件、再重放** DB 中 `seq > lastEventId` 的事件（升序），
  随后按 `seq` 排序、去重后统一推送；收到终态事件后再做一次**补重放**，覆盖
  「订阅建立前已写入、首次重放快照读不到」的窗口。
- 先订阅后重放的原因：反过来（先重放、再订阅）会在两步之间留下**丢事件窗口**——
  重放的快照已经读完、订阅尚未建立时写入的事件既不在快照里、也不会被推送。
  先订阅相当于先把「水位」接上，再用重放补齐历史；两者按 `seq` 去重，既不重复也不丢失。
- 收到终态事件后关闭流；若 `lastEventId` 已覆盖终态事件（运行已结束且客户端已收全），
  直接关闭流（不再发送任何帧）。
- `Last-Event-ID` 必须是**非负十进制整数**，否则返回普通 JSON 400
  `invalid Last-Event-ID`（不打开流）。
- 事件持久化的顺序是「**先写 DB、再推给订阅者**」，因此「订阅 + 重放」既不重复也不丢失。

## 5. 取消

- `POST /agent/runs/{id}/cancel` 只置 `cancelRequestedAt` 并返回 `202`
  （`{ "id": ..., "status": "queued" | "running" }`，取消是**异步**的）。
- 执行器在**层边界**（**每层开始前**）与**工具轮边界**（每轮 LLM 调用前后、每个工具执行前）
  检查该标记；一旦发现，立即发出唯一一帧 `run_cancelled` 并把状态改为 `cancelled`。
- **取消是协作式的**：若取消请求到达时运行已进入最后一层 / 即将完成，执行器可能来不及
  再次检查，仍会以 `run_finished` 结束。**取消成功 ≠ 一定出现 `run_cancelled`**——
  客户端应以 SSE 的**终态事件**（`run_finished` / `run_failed` / `run_cancelled`）为准，
  而不是以 `202` 响应或 `GET /agent/runs/{id}` 的中间状态为准。
- 一旦发出 `run_cancelled`，不会再出现 `run_finished` / `run_failed`。
- 已处于终态的运行再次取消 → 400 `Run is not cancellable`。

## 6. 错误文案（摘要）

完整表格见 `error-messages.md` §11。

| 场景 | HTTP | message |
| --- | --- | --- |
| 运行不存在 / 不属于自己 | 404 | `Run not found` |
| `composition.version` 不是字符串 `"1"` | 400 | `composition version must be 1` |
| 某层不是对象 / 缺非空字符串 `name` | 400 | `layer {index} name is required` |
| `llm` 层缺失或数量 ≠ 1 | 400 | `composition must contain exactly one llm layer` |
| 未知层名 | 400 | `unknown layer: {name}` |
| 同层重复 | 400 | `layer {name} appears more than once` |
| `prompt` 缺 `template` | 400 | `prompt layer template is required` |
| `tools` 引用未知工具 | 400 | `tools layer references unknown tool: {name}` |
| `history.maxMessages` 越界 | 400 | `history layer maxMessages must be between 1 and 100` |
| `history.compactionThreshold` 越界 | 400 | `history layer compactionThreshold must be between 1 and 100` |
| `history.keepRecent` 越界 | 400 | `history layer keepRecent must be between 1 and 50` |
| `llm.maxRounds` 越界 | 400 | `llm layer maxRounds must be between 1 and 20` |
| 取消已终态的 run | 400 | `Run is not cancellable` |
| `Last-Event-ID` 非数字 | 400 | `invalid Last-Event-ID` |
| 运行中轮次超限（流内） | 200(SSE) | `agent rounds exceeded: {max}` |
| 工具执行失败（流内） | 200(SSE) | `tool {name} failed: {reason}` |

实现位置：

- api-ts：`apps/api-ts/src/agent/`（`agent-runner.service.ts`、`agent.controller.ts`、
  `composition.validator.ts`、`layers/`）。
````

**这段在干什么**

1. **§1 把帧格式钉死**：与工作流 SSE 只差一行 `id:`。这一行就是重放的全部基础——没有它，客户端无法告诉服务端「我收到哪了」。
2. **§2 把事件集合收敛到 10 种**，并规定 `run_queued` **永远是 seq 1**。这不是「约定」，而是后面重放与 `id 1..N 连续` 的硬前提。
3. **§3 把「层」做成可组合的数组**：层是**纯函数 + 共享状态**，顺序由客户端给。`history` 的压缩是**确定性截断**（不是 LLM 摘要），因为要两端逐字节一致。
4. **§4 是重放语义的合同**：`Last-Event-ID` 优先、非法值 400、收到终态即关流、已覆盖终态则零帧关闭。
5. **§5 把取消定义成「标记 + 边界检查」**：这是协作式取消的语言中立法。
6. 最后一句「事件持久化先写 DB、再推订阅者」是**双通道不丢事件**的唯一理由（§12.4）。

---

## 6. 完整代码：契约 `openapi.yaml`（新增段落）

> `openapi.yaml` 是**累积文件**。本篇只贴**新增的完整段落**；未变部分与阶段 10 完全一致。

### 6.1 版本号

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
info:
  title: mini-dify API
  version: 0.11.0
  description: >-
    唯一契约（单真源）。NestJS（api-ts）与 FastAPI（api-py）都必须实现本规范，
    并由同一套契约测试校验两者的响应结构、状态码与错误响应体一致。
```

**这段在干什么**

`version` 是**契约版本**，必须与 `src/index.ts` 的 `CONTRACT_VERSION` 同步。本篇新增 4 个路径（5 个操作）、7 组 schema 与 16 条 4xx + 1 条流内错误文案，属于契约级变更，所以从 `0.10.0` 升到 `0.11.0`。

### 6.2 四个 `/agent/runs` 路径（列表 + 创建）

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
  /agent/runs:
    post:
      operationId: createAgentRun
      summary: 提交自主 Agent 运行（异步，202）
      description: >-
        校验 `composition` 后**立即**返回 `202`（`status` 为 `queued`），运行在后台
        异步执行。过程事件通过 `GET /agent/runs/{id}/events` 以 SSE 获取；事件协议
        与层的执行语义见唯一真源 `packages/contract/agent-events.md`。
        校验失败返回**普通 JSON** 400（文案见 `error-messages.md` §11），不创建运行。
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateAgentRunRequest"
      responses:
        "202":
          description: 已接受（排队中）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateAgentRunResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
    get:
      operationId: listAgentRuns
      summary: 列出当前用户的 Agent 运行（createdAt 倒序）
      security:
        - bearerAuth: []
      responses:
        "200":
          description: 运行列表
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AgentRunListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
```

**这段在干什么**

1. **`POST` 的成功码是 202 而不是 200/201**：201 表示「资源已创建并可立即读取完整表示」，而这里「创建」只是受理，真正的结果要等后台执行。202 的语义恰好是「已接受处理，但不保证完成」——**运行也可能以 `failed` 收场**。
2. **`GET /agent/runs` 与 `POST` 共用路径**：列表只返回本人（`ownerId`），排序在实现里固定为 `createdAt desc`。
3. **`400` 是普通 JSON**：校验失败**不创建运行**，所以不存在「先建 run 再在流里报错」这种半成品。
4. **`security: bearerAuth`**：与阶段 10 的 `apiKeyAuth` 是两个域，这里只属于登录用户。

### 6.3 详情、取消、事件流三个路径

```yaml
  /agent/runs/{id}:
    get:
      operationId: getAgentRun
      summary: 查询某次 Agent 运行
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: 运行详情
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AgentRunResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /agent/runs/{id}/cancel:
    post:
      operationId: cancelAgentRun
      summary: 请求取消一次 Agent 运行（异步，202）
      description: >-
        只置 `cancelRequestedAt` 并立即返回 `202`。执行器在**层边界**与**工具轮边界**
        检查该标记，发出 `run_cancelled` 并把状态改为 `cancelled`。
        已处于终态（`succeeded` / `failed` / `cancelled`）的运行返回 400
        `Run is not cancellable`。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "202":
          description: 已接受取消请求
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CancelAgentRunResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /agent/runs/{id}/events:
    get:
      operationId: streamAgentRunEvents
      summary: Agent 运行事件流（SSE，支持 Last-Event-ID 重放）
      description: >-
        以 `text/event-stream` 返回事件。每帧固定为
        `id: <seq>\nevent: <name>\ndata: <单行 JSON>\n\n`（`seq` 在单次运行内从 1 递增）。
        客户端可用请求头 `Last-Event-ID`（优先）或查询参数 `lastEventId` 指定「已收到
        的最大 seq」：服务端先**重放** DB 中 `seq > lastEventId` 的事件，再订阅实时事件；
        收到终态事件（`run_finished` / `run_failed` / `run_cancelled`）后关闭流。
        事件种类与 payload 见 `packages/contract/agent-events.md`。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: Last-Event-ID
          in: header
          required: false
          schema:
            type: integer
            minimum: 0
          description: 已收到的最大事件 seq（优先于查询参数 `lastEventId`）
        - name: lastEventId
          in: query
          required: false
          schema:
            type: integer
            minimum: 0
          description: 已收到的最大事件 seq（`Last-Event-ID` 头不存在时使用）
      responses:
        "200":
          description: SSE 事件流（text/event-stream）
          content:
            text/event-stream:
              schema:
                type: string
                description: >-
                  逐帧遵循 `id: <seq>\n` + `event: <name>\n` + `data: <单行 JSON>\n\n`。
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

**这段在干什么**

1. **取消的 202 而不是 200**：取消请求本身只是「登记」，真正生效要等执行器跑到下一个检查点。返回体里的 `status` 仍是请求**当时**的状态（可能还是 `running`），不代表取消已完成。
2. **取消的 400 只对应一种情况**：运行已在终态。`Run is not cancellable` 是契约文案（§11），两端逐字一致。
3. **事件流把两个入参都写进契约**：`Last-Event-ID` 是 SSE 标准的请求头；`lastEventId` 是给「不方便设请求头的工具」用的查询参数。**优先关系写进 `description`**，因为 OpenAPI 无法表达「二选一且头优先」。
4. **`400` 也挂在事件流上**：非法 `Last-Event-ID` 必须在**打开流之前**报 400。一旦写了 `200 + text/event-stream`，状态码就改不了了（阶段 4 的「先校验、后开流」）。

### 6.4 六组 schema

```yaml
    CompositionLayer:
      type: object
      additionalProperties: false
      required: [name, config]
      description: 自主 Agent 的一层；各层 `config` 形状与语义见 packages/contract/agent-events.md §3。
      properties:
        name:
          type: string
          enum: [history, prompt, tools, llm, output]
        config:
          type: object
          additionalProperties: true
          description: 该层的配置（自由结构，按 `name` 解释）

    Composition:
      type: object
      additionalProperties: false
      required: [version, layers]
      description: >-
        Agent 运行组合。`layers` **按数组顺序**执行；其中 `llm` 层**必须恰好一个**。
      properties:
        version:
          type: string
          description: 组合结构版本，当前固定为 `"1"`
        layers:
          type: array
          items:
            $ref: "#/components/schemas/CompositionLayer"

    CreateAgentRunRequest:
      type: object
      additionalProperties: false
      required: [input, composition]
      properties:
        input:
          type: string
          minLength: 1
          maxLength: 4000
        composition:
          $ref: "#/components/schemas/Composition"

    AgentRunResponse:
      type: object
      additionalProperties: false
      required: [id, status, input, output, error, createdAt, startedAt, finishedAt]
      properties:
        id:
          type: string
        status:
          type: string
          enum: [queued, running, succeeded, failed, cancelled]
        input:
          type: string
        output:
          type: ["string", "null"]
          description: 成功时的最终输出（`output` 层取最后一条 assistant 消息）；否则为 `null`
        error:
          type: ["string", "null"]
          description: 失败时的 `run_failed.message`；否则为 `null`
        createdAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。
        startedAt:
          type: ["string", "null"]
          format: date-time
          description: 开始执行的时间；仍在 `queued` 时为 `null`
        finishedAt:
          type: ["string", "null"]
          format: date-time
          description: 进入终态的时间；未结束时为 `null`

    AgentRunListResponse:
      type: object
      additionalProperties: false
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/AgentRunResponse"

    CreateAgentRunResponse:
      type: object
      additionalProperties: false
      required: [id, status]
      properties:
        id:
          type: string
        status:
          type: string
          enum: [queued]

    CancelAgentRunResponse:
      type: object
      additionalProperties: false
      required: [id, status]
      properties:
        id:
          type: string
        status:
          type: string
          enum: [queued, running]
```

**这段在干什么**

1. **`CompositionLayer.config` 是 `additionalProperties: true`**，而外层是 `false`：层的**结构**（`name` + `config`）是固定的，`config` 内部按层名自由解释。这与阶段 3「`data` 是唯一自由区」是同一种取舍。
2. **`Composition.version` 是字符串 `"1"`**（不是数字）：结构版本用字符串便于将来出现 `"2a"` 之类；运行期由两端各自的 `validateComposition` / `validate_composition` 校验，不等于 `"1"` 即 400 `composition version must be 1`。
3. **`CreateAgentRunResponse.status` 的 `enum` 只有一个值 `queued`**：受理接口**不可能**返回 `running`/`succeeded`——那会破坏「202 = 已受理」的语义。
4. **`CancelAgentRunResponse.status` 只有 `queued` / `running`**：取消接口不返回终态，因为取消是异步的。
5. **`AgentRunResponse` 的 `output` / `error` 是「键必在、值可空」**：不是可选字段。客户端可以无条件读 `run.output`。
6. **`status` 用 `enum` 而不是自由字符串**：状态机是契约的一部分，两端的写入点都必须落在五个值里。

---

## 7. 完整代码：`packages/contract/src/index.ts`（新增段落）

### 7.1 版本号

**完整文件路径：`packages/contract/src/index.ts`**

```ts
/** 契约版本；修改契约时递增，并与 openapi.yaml 的 info.version 保持同步。 */
export const CONTRACT_VERSION = '0.11.0'
```

**这段在干什么**

与 `openapi.yaml#/info/version` 字面相同，供两端与前端做兼容性自检。

### 7.2 Agent 运行类型

```ts
/**
 * 自主 Agent 运行时（阶段 11）。事件协议唯一真源：
 * `packages/contract/agent-events.md`；错误文案见 `error-messages.md` §11。
 */

/** 组合里允许的层名（按数组顺序执行）。 */
export type AgentLayerName = 'history' | 'prompt' | 'tools' | 'llm' | 'output'

/** 组合的一层；`config` 为自由结构，按 `name` 解释（见 agent-events.md §3）。 */
export interface CompositionLayer {
  name: AgentLayerName
  config: Record<string, unknown>
}

/** 组合：`layers` 按数组顺序执行，`llm` 层必须恰好一个。 */
export interface Composition {
  /** 结构版本，当前固定为 `"1"` */
  version: string
  layers: CompositionLayer[]
}

/** POST /agent/runs 请求体。 */
export interface CreateAgentRunRequest {
  /** 1-4000 位 */
  input: string
  composition: Composition
}

/** 运行状态。 */
export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Agent 运行对外视图。 */
export interface AgentRunResponse {
  id: string
  status: AgentRunStatus
  input: string
  /** 成功时的最终输出；否则为 `null` */
  output: string | null
  /** 失败时的 `run_failed.message`；否则为 `null` */
  error: string | null
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  createdAt: string
  /** 开始执行的时间；仍在 `queued` 时为 `null` */
  startedAt: string | null
  /** 进入终态的时间；未结束时为 `null` */
  finishedAt: string | null
}

/** GET /agent/runs 的响应体（`createdAt` 倒序）。 */
export interface AgentRunListResponse {
  items: AgentRunResponse[]
}

/** POST /agent/runs 的响应体（异步接受，固定 `queued`）。 */
export interface CreateAgentRunResponse {
  id: string
  status: 'queued'
}

/** POST /agent/runs/{id}/cancel 的响应体（当前状态；取消是异步的）。 */
export interface CancelAgentRunResponse {
  id: string
  status: 'queued' | 'running'
}
```

**这段在干什么**

1. **`AgentRunStatus` 是联合类型、`CreateAgentRunResponse.status` 是字面量 `'queued'`**：用类型把「受理只能返回 queued」钉死；TS 侧如果有人想返回 `'running'`，编译就过不去。
2. **`AgentLayerName` 是闭集**：层名是契约的一部分（`unknown layer: {name}` 是 400），不是自由字符串。
3. **`config: Record<string, unknown>`**：与 OpenAPI 的 `additionalProperties: true` 对应——结构强类型、内容弱类型。
4. 注释把「事件协议唯一真源」写在类型文件里，提醒实现者「不要在这里发明第二套语义」。

---

## 8. 完整代码：`packages/contract/error-messages.md`（§11）

**完整文件路径：`packages/contract/error-messages.md`**

````markdown
## 11. Agent 运行时

阶段 11 起，自主 Agent（`POST /agent/runs` 等）涉及下列错误。**两端必须逐字节一致**。
事件协议与层语义见 `agent-events.md`。

| 场景 | HTTP | message |
| --- | --- | --- |
| 运行不存在 / 不属于自己 | 404 | `Run not found` |
| `composition.version` 不是字符串 `"1"` | 400 | `composition version must be 1` |
| 某层不是对象 / 缺非空字符串 `name` | 400 | `layer {index} name is required` |
| composition 缺 `llm` 层或数量 ≠ 1 | 400 | `composition must contain exactly one llm layer` |
| 未知层名 | 400 | `unknown layer: {name}` |
| 同层重复 | 400 | `layer {name} appears more than once` |
| `prompt` 缺 template | 400 | `prompt layer template is required` |
| `tools` 引用未知工具 | 400 | `tools layer references unknown tool: {name}` |
| `history.maxMessages` 越界 | 400 | `history layer maxMessages must be between 1 and 100` |
| `history.compactionThreshold` 越界 | 400 | `history layer compactionThreshold must be between 1 and 100` |
| `history.keepRecent` 越界 | 400 | `history layer keepRecent must be between 1 and 50` |
| `llm.maxRounds` 越界 | 400 | `llm layer maxRounds must be between 1 and 20` |
| 取消已终态的 run | 400 | `Run is not cancellable` |
| `Last-Event-ID` 非数字 | 400 | `invalid Last-Event-ID` |
| 运行中轮次超限（流内） | 200(SSE) | `agent rounds exceeded: {max}` |
| 工具执行失败（流内） | 200(SSE) | `tool {name} failed: {reason}` |

说明：

- §11 的 4xx 都是**普通 JSON**（`ErrorResponse`），发生在创建运行或打开事件流之前；
  进入执行后的错误走 `run_failed` 事件（HTTP 仍是 `200` 的 SSE 流）。
- composition 校验按下列**固定顺序**产出错误，多条用 `"; "` 连接：
  1. `composition.version`（必须为字符串 `"1"`）；2. 层 `name` 必填（按 `layers` 数组顺序，
     `{index}` 从 **1** 开始；层不是对象 / `name` 不是字符串 / `name === ''` 时报告，
     并**跳过该层的后续检查**，不再报「未知层」）；3. `llm` 层数量；4. 未知层名
     （按 `layers` 数组顺序）；5. 同层重复（按数组顺序）；6. `prompt.template`；
     7. `tools.names`；8. `history.maxMessages`；9. `history.compactionThreshold`；
     10. `history.keepRecent`；11. `llm.maxRounds`。
- `{index}` 为层在 `layers` 数组中的**下标 + 1**（从 1 开始）。
- `{name}` 为未知层名 / 重复层名 / 未知工具名（工具名按 `names` 数组顺序各报一条）。
- 越界包含「不是整数」与「超出闭区间」；字段**缺省**时取默认值，不算越界。
- 终态唯一：`run_finished` / `run_failed` / `run_cancelled` 三者恰有其一。

实现位置：

- api-ts：`apps/api-ts/src/agent/`（`agent-runner.service.ts`、`agent.controller.ts`、
  `composition.validator.ts`、`layers/`）。
````

**这段在干什么**

1. **16 条 4xx + 1 条流内文案 + 11 步校验顺序**是本阶段的唯一真源。顺序本身是契约：两条错误同时存在时，两端必须报**同一个**。
2. **明确划出「4xx 普通 JSON」与「流内 `run_failed`」的边界**：能开流之前发现的，一律 4xx；开流之后的执行期错误（轮次超限、工具失败）只能是 `run_failed`。
3. **`{name}` 占位符**：错误文案里带变量，容易被两端写成不同拼法，所以这里把「取哪个名字」也写清了。

---

## 9. 完整代码：Prisma schema 与迁移

### 9.1 `apps/api-ts/prisma/schema.prisma`

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**（新增两个模型 + `User` 的反向关系）

```prisma
model AgentRun {
  id                String    @id @default(uuid())
  ownerId           String    @map("owner_id")
  status            String
  composition       Json
  input             String
  output            String?
  error             String?
  createdAt         DateTime  @default(now()) @map("created_at")
  startedAt         DateTime? @map("started_at")
  finishedAt        DateTime? @map("finished_at")
  cancelRequestedAt DateTime? @map("cancel_requested_at")

  owner  User           @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  events AgentRunEvent[]

  @@index([ownerId])
  @@map("agent_runs")
}

/// Agent 运行事件（阶段 11）：`seq` 在**单次运行内**从 1 全局单调递增，
/// 与 SSE 帧的 `id:` 行一致，用于 `Last-Event-ID` 重放。
model AgentRunEvent {
  id        String   @id @default(uuid())
  runId     String   @map("run_id")
  seq       Int
  event     String
  data      Json
  createdAt DateTime @default(now()) @map("created_at")

  run AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, seq])
  @@index([runId])
  @@map("agent_run_events")
}
```

同时，`User` 加一条反向关系（Prisma 的关系必须双方声明）：

```prisma
model User {
  // …
  agentRuns AgentRun[]
}
```

**这段在干什么（逐个字段）**

1. **`status` 是普通 `String` 而不是 DB enum**：契约里的 `enum` 是**对外**的闭集；DB 用文本，改状态集合时不必写迁移。代价是「写错状态」只能靠代码与测试兜住（见 §12.2）。
2. **`composition` 是 `Json`（→ `jsonb`）**：受理时把整份组合**冻结**到 run 行里。执行器只读这一份，**不再回头读客户端**；这也意味着「客户端提交后再改 composition 不会影响已受理的运行」。
3. **`cancelRequestedAt` 是「时间戳」而不是布尔**：既表达「是否请求取消」，又表达「什么时候请求的」，便于排障与审计。
4. **`output` / `error` 可空且互斥**：成功写 `output`、失败写 `error`、取消两者都空。`startedAt` / `finishedAt` 可空对应「还没开始 / 还没结束」。
5. **`@relation(onDelete: Cascade)`**：删用户会带走他的 run；删 run 会带走它的事件。
6. **`AgentRunEvent` 的 `@@unique([runId, seq])`**：这是本阶段最关键的一条约束——**一次运行内 seq 不可能重复**。它把「重复写同一个事件」变成数据库级失败，而不是静默重复（§12.5）。
7. **`@@index([runId])`** 服务重放查询 `where run_id = ? and seq > ? order by seq asc`；`@@unique` 已经建了 `(run_id, seq)` 复合索引，这条单列索引是 Prisma 按外键惯例生成的（有轻微冗余，但保证「按 run 列出全部事件」也走索引）。

### 9.2 `apps/api-ts/prisma/migrations/20261023151132_add_agent_runs/migration.sql`

**完整文件路径：`apps/api-ts/prisma/migrations/20261023151132_add_agent_runs/migration.sql`**

```sql
-- 注意：Prisma 自动生成的 `DROP INDEX "chunks_embedding_hnsw"` 已手工移除。
-- 该 HNSW 索引由 migration `add_knowledge_base` 创建、由 `prisma/sql/hnsw.sql` 维护，
-- 不属于 Prisma 的 schema，不能让 `migrate dev` 顺手删掉。

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "composition" JSONB NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "cancel_requested_at" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_owner_id_idx" ON "agent_runs"("owner_id");

-- CreateIndex
CREATE INDEX "agent_run_events_run_id_idx" ON "agent_run_events"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_events_run_id_seq_key" ON "agent_run_events"("run_id", "seq");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**这段在干什么（按行）**

1. **第一段注释是「已知坑」的教科书式处理**：Prisma 不认识手工建的 HNSW 索引，会生成 `DROP INDEX`；这里删掉并写明原因，避免下次「重新生成」又加回去。
2. **`composition JSONB NOT NULL`**：组合是受理的必要条件，不允许为空。
3. **`seq INTEGER NOT NULL`**：事件流序号是整数；`TEXT` 的话排序会变成字典序（`10` < `2`），重放顺序就错了。
4. **`UNIQUE INDEX ... ("run_id", "seq")`**：唯一性按「运行」划分，不同运行各自从 1 开始。这与阶段 9 的 `UNIQUE(conversation_id, seq)` 是同一个模式，只是这里的序号属于**事件流**。
5. **两条 `ON DELETE CASCADE`**：删用户 → 他的 run 全删；删 run → 它的事件全删，不留孤儿事件。
6. **`TIMESTAMP(3)`**：毫秒精度，与契约的 24 字符 `...Z` 序列化配套；`cancel_requested_at` 同样可空。

### 9.3 数据库自检（预期输出）

**命令**

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "\d agent_run_events"
docker exec -i mini-dify-db psql -U postgres -d minidify -c "\di chunks_embedding_hnsw"
```

**预期（关键行）**

```text
 Column     |            Type             | Nullable |
------------+-----------------------------+----------+
 id         | text                        | not null |
 run_id     | text                        | not null |
 seq        | integer                     | not null |
 event      | text                        | not null |
 data       | jsonb                       | not null |
 created_at | timestamp(3)                | not null |
Indexes:
    "agent_run_events_pkey" PRIMARY KEY, btree (id)
    "agent_run_events_run_id_idx" btree (run_id)
    "agent_run_events_run_id_seq_key" UNIQUE, btree (run_id, seq)
Foreign-key constraints:
    "agent_run_events_run_id_fkey" FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE ON UPDATE CASCADE

                 List of relations
 Schema |         Name          | Type  | Owner
--------+-----------------------+-------+-------
 public | chunks_embedding_hnsw | index | postgres
```

**这段在干什么**

1. 第一条确认**唯一约束是 `UNIQUE (run_id, seq)`**，不是 `UNIQUE (seq)`；后者会让两次运行互相冲突。
2. 第二条确认阶段 7 的 HNSW 索引**没有被这次迁移删掉**——这是项目里每次迁移后都必须做的检查。

---

## 10. 完整代码：NestJS 侧

### 10.1 `apps/api-ts/src/agent/agent-events.ts`

**完整文件路径：`apps/api-ts/src/agent/agent-events.ts`**

```ts
import type { AgentLayerName } from '@mini-dify/contract'

/**
 * Agent 事件（唯一真源：`packages/contract/agent-events.md`）。
 *
 * 与工作流 SSE 的区别：帧里**必须带 `id:` 行**（值即 `seq`），用于 `Last-Event-ID` 重放。
 * 本文件只负责事件名 / payload 的形状、帧序列化与「取消」信号，持久化由
 * `agent-runner.service.ts` 负责（先写 DB 再推订阅者）。
 */

/** Agent 事件名（顺序与触发时机见 agent-events.md §2）。 */
export type AgentEventName =
  | 'run_queued'
  | 'run_started'
  | 'layer_started'
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'layer_finished'
  | 'run_finished'
  | 'run_failed'
  | 'run_cancelled'

/** 已持久化的一个事件（`seq` 即 SSE 帧的 `id:` 行）。 */
export interface AgentEventRecord {
  seq: number
  event: AgentEventName
  data: Record<string, unknown>
}

/** 层内发事件用的同步回调：只入队，真正的 DB 写入由执行器串行化。 */
export type AgentEmit = (event: AgentEventName, data: Record<string, unknown>) => void

/** 终态事件（三者恰有其一，见 agent-events.md §2.1）。 */
const TERMINAL_EVENTS: ReadonlySet<string> = new Set([
  'run_finished',
  'run_failed',
  'run_cancelled',
])

/** 是否为终态事件。 */
export function isTerminalAgentEvent(event: string): boolean {
  return TERMINAL_EVENTS.has(event)
}

/** 帧格式（固定）：`id: <seq>\n` + `event: <name>\n` + `data: <单行 JSON>\n\n`。 */
export function formatAgentSseFrame(record: AgentEventRecord): string {
  return `id: ${record.seq}\nevent: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`
}

/** 层事件（`index` 从 1 开始）。 */
export interface LayerEventData {
  layer: AgentLayerName
  index: number
}

/** 已请求取消：由 `checkCancelled` 抛出，执行器据此发唯一一帧 `run_cancelled`。 */
export class AgentRunCancelled extends Error {
  constructor() {
    super('agent run cancelled')
  }
}
```

**这段在干什么**

1. **`AgentEventRecord` 是「一条已落库的事件」**：`seq` 与 `data` 一起构成重放的最小单元；帧序列化只依赖这三个字段。
2. **`AgentEmit` 是同步的**（返回 `void`）：因为 `token` 回调是 `(text) => emit('token', {text})`，LangChain 的流式回调**不能 await**。同步回调如何保证写库有序，是 §12.4 的核心。
3. **`TERMINAL_EVENTS` 是集合 + 判定函数**：执行器、控制器、流缓冲都共用同一个定义，避免三处各写一遍导致终态判断漂移。
4. **`formatAgentSseFrame` 只有一行拼接**：`id:` 在最前、`data:` 后空行。与工作流的 `formatSseFrame`（阶段 4）**故意不复用**，因为多了一行 `id:`。
5. **`AgentRunCancelled` 是一个专用的 Error 子类**：执行器用 `instanceof` 把它和「真正的失败」分开（见 §12.8）。

### 10.2 `apps/api-ts/src/agent/agent-events.emitter.ts`

**完整文件路径：`apps/api-ts/src/agent/agent-events.emitter.ts`**

```ts
import { Injectable } from '@nestjs/common'

import type { AgentEventRecord } from './agent-events'

/**
 * 进程内的按 runId 订阅表。
 *
 * 执行器每写成功一个事件就 `publish`；SSE 控制器先 `subscribe` 再重放，
 * 因此「重放 + 实时」的重叠部分由 `AgentEventStream` 按 `seq` 去重。
 */
@Injectable()
export class AgentEventEmitter {
  private readonly subscribers = new Map<string, Set<(record: AgentEventRecord) => void>>()

  /** 订阅某次运行的实时事件；返回取消订阅函数。 */
  subscribe(runId: string, listener: (record: AgentEventRecord) => void): () => void {
    const listeners = this.subscribers.get(runId) ?? new Set<(record: AgentEventRecord) => void>()
    listeners.add(listener)
    this.subscribers.set(runId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.subscribers.delete(runId)
      }
    }
  }

  /** 把一个已持久化的事件推给当前订阅者（没有订阅者时什么也不做）。 */
  publish(runId: string, record: AgentEventRecord): void {
    const listeners = this.subscribers.get(runId)
    if (listeners === undefined) {
      return
    }
    for (const listener of [...listeners]) {
      listener(record)
    }
  }
}

/**
 * 单个 SSE 请求的事件流：按 `seq` **顺序**吐出，并按 `seq` 去重。
 *
 * 为什么需要排序缓冲：控制器「先订阅、再重放」时，实时事件可能先于更早的
 * 重放事件到达；若直接按到达顺序写出，客户端的 `id:` 就会乱序。这里只在
 * `nextSeq` 连续时才产出，收到终态后把剩余事件兜底吐出并结束。
 */
export class AgentEventStream {
  private readonly pending = new Map<number, AgentEventRecord>()
  private nextSeq: number
  private waiter: (() => void) | null = null
  private closed = false

  constructor(startSeq: number) {
    this.nextSeq = startSeq
  }

  /** 入队一个事件；`seq` 小于期望值或重复的丢弃。 */
  push(record: AgentEventRecord): void {
    if (record.seq < this.nextSeq || this.pending.has(record.seq)) {
      return
    }
    this.pending.set(record.seq, record)
    this.wake()
  }

  /** 终态后关闭流：消费方取完剩余事件即结束。 */
  close(): void {
    this.closed = true
    this.wake()
  }

  /** 逐条产出事件，直到 `close()` 且缓冲耗尽。 */
  async *drain(): AsyncGenerator<AgentEventRecord> {
    for (;;) {
      while (this.pending.has(this.nextSeq)) {
        yield this.take(this.nextSeq)
        this.nextSeq += 1
      }
      if (this.closed) {
        // 正常路径不会留下空洞；异常兜底：终态后把剩余事件按 seq 升序吐出，避免挂起。
        for (const seq of [...this.pending.keys()].sort((left, right) => left - right)) {
          yield this.pending.get(seq) as AgentEventRecord
        }
        this.pending.clear()
        return
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }

  private take(seq: number): AgentEventRecord {
    const record = this.pending.get(seq) as AgentEventRecord
    this.pending.delete(seq)
    return record
  }

  private wake(): void {
    const waiter = this.waiter
    this.waiter = null
    waiter?.()
  }
}
```

**这段在干什么（分两块）**

**`AgentEventEmitter`（双通道的「实时通道」）**

1. **数据结构是 `Map<runId, Set<listener>>`**：一次运行可以有多个 SSE 订阅者（多个标签页 / 断线重连的旧连接还没断）。
2. **`subscribe` 返回退订函数**：SSE 请求结束时必须退订，否则永远泄漏监听器（并在之后的 `publish` 里做无用功）。`Set` 空了就删掉整个 key，避免 `Map` 无限增长。
3. **`publish` 遍历副本 `[...listeners]`**：监听器在回调里可能退订（例如收到终态就 `unsubscribe()`），直接遍历原 `Set` 会在迭代中修改集合。
4. **没有订阅者时 `publish` 是空操作**：这正是 `run_queued` 不需要 publish 的原因（受理时还没人订阅）；**也是「DB 才是真源」的体现**——推送只是加速，丢了也能靠重放补。

**`AgentEventStream`（单个 SSE 请求的排序 + 去重缓冲）**

5. **`nextSeq` 是「客户端下一条应该收到的 seq」**：由 `Last-Event-ID + 1` 初始化。
6. **`push` 丢弃 `seq < nextSeq`（已发过 / 重放已覆盖）与重复 seq**：这就是「按 seq 去重」。
7. **`push` 只往 `pending` 里放，不直接产出**：因为实时事件可能**先于**更早的重放事件到达（订阅先于重放），直接写出会让 `id:` 乱序。`drain` 只在 `pending.has(nextSeq)` 时才吐，保证**连续升序**。
8. **`drain` 的 `close` 兜底**：正常情况下不会出现空洞；但若某条写库永久失败留下空洞，`close` 后会把剩余事件按 seq 升序吐出，**避免客户端永远挂起**。
9. **等待机制只有一个 `waiter`**：`push` / `close` 都会 `wake()`；同一时刻只有一个消费者（该 SSE 请求），所以单槽位足够。

### 10.3 `apps/api-ts/src/agent/agent-runner.service.ts`

**完整文件路径：`apps/api-ts/src/agent/agent-runner.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  AgentRunListResponse,
  AgentRunResponse,
  AgentRunStatus,
  CancelAgentRunResponse,
  Composition,
  CompositionLayer,
  CreateAgentRunResponse,
} from '@mini-dify/contract'

import { PrismaService } from '../prisma/prisma.service'
import {
  AgentRunCancelled,
  isTerminalAgentEvent,
  type AgentEmit,
  type AgentEventName,
  type AgentEventRecord,
} from './agent-events'
import { AgentEventEmitter, AgentEventStream } from './agent-events.emitter'
import type { AgentRunState } from './agent-state'
import { validateComposition } from './composition.validator'
import { runHistoryLayer } from './layers/history.layer'
import { runLlmLayer } from './layers/llm.layer'
import { runOutputLayer } from './layers/output.layer'
import { runPromptLayer } from './layers/prompt.layer'
import { runToolsLayer } from './layers/tools.layer'

/** 终态状态集合（取消已终态的 run → 400 `Run is not cancellable`）。 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled'])

/**
 * 自主 Agent 运行时（阶段 11）。
 *
 * 核心不变量（见 `packages/contract/agent-events.md`）：
 * - **异步接受**：`accept` 校验后建 run（`queued`）、持久化 `run_queued`（seq 1），
 *   再 `void execute(runId)` 后台执行，立即返回 `{ id, status: 'queued' }`。
 * - **事件先写 DB 再推订阅者**：每个事件都由一条串行化的 Promise 链写库，
 *   成功后 `publish` 给内存订阅者；token 这类高频事件因此不会乱序。
 * - **seq 单次运行内从 1 递增**：起点取自 DB 现有最大 seq（`run_queued` 为 1）。
 * - **终态唯一**：`run_finished` / `run_failed` / `run_cancelled` 恰有其一；
 *   终态事件与状态更新在**同一个事务**里提交，重放与实时不会出现「状态已终态、
 *   事件还没写」的空窗。
 * - **取消是异步的**：`cancel` 只置 `cancelRequestedAt`，执行器在层边界 / 工具轮边界
 *   检查后发 `run_cancelled`。
 */
@Injectable()
export class AgentRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: AgentEventEmitter,
  ) {}

  /** 校验 composition → 建 run（`queued`）→ 持久化 `run_queued` → 异步启动执行。 */
  async accept(
    ownerId: string,
    input: string,
    composition: unknown,
  ): Promise<CreateAgentRunResponse> {
    const errors = validateComposition(composition)
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }
    const run = await this.prisma.agentRun.create({
      data: {
        ownerId,
        status: 'queued',
        composition: composition as Prisma.InputJsonValue,
        input,
      },
    })
    // seq 1：接受即排队。此时还没有订阅者，不需要 publish（重放会读到它）。
    await this.prisma.agentRunEvent.create({
      data: {
        runId: run.id,
        seq: 1,
        event: 'run_queued',
        data: { runId: run.id, status: 'queued' },
      },
    })
    void this.execute(run.id)
    return { id: run.id, status: 'queued' }
  }

  async list(ownerId: string): Promise<AgentRunListResponse> {
    const runs = await this.prisma.agentRun.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    })
    return { items: runs.map((run) => toAgentRunResponse(run)) }
  }

  async get(ownerId: string, id: string): Promise<AgentRunResponse> {
    return toAgentRunResponse(await this.findOwned(ownerId, id))
  }

  /** 异步取消：只置 `cancelRequestedAt`，返回当前状态（仍在 `queued` / `running`）。 */
  async cancel(ownerId: string, id: string): Promise<CancelAgentRunResponse> {
    const run = await this.findOwned(ownerId, id)
    if (TERMINAL_STATUSES.has(run.status)) {
      throw new BadRequestException('Run is not cancellable')
    }
    if (run.cancelRequestedAt === null) {
      await this.prisma.agentRun.update({
        where: { id },
        data: { cancelRequestedAt: new Date() },
      })
    }
    return { id: run.id, status: run.status as CancelAgentRunResponse['status'] }
  }

  /**
   * 打开某次运行的事件流：**先订阅、再重放**，按 `seq` 去重排序；
   * 收到终态事件后关闭。`lastEventId` 之前的帧不会重复发送。
   */
  async stream(
    ownerId: string,
    id: string,
    lastEventId: number,
  ): Promise<AsyncGenerator<AgentEventRecord>> {
    await this.findOwned(ownerId, id)

    const stream = new AgentEventStream(lastEventId + 1)
    let closedByListener = false
    const unsubscribe = this.emitter.subscribe(id, (record) => {
      stream.push(record)
      if (isTerminalAgentEvent(record.event)) {
        closedByListener = true
        stream.close()
      }
    })

    let terminal = await this.replay(id, lastEventId, stream)
    if (!terminal && !closedByListener) {
      const latest = await this.prisma.agentRun.findUnique({
        where: { id },
        select: { status: true },
      })
      if (latest !== null && TERMINAL_STATUSES.has(latest.status)) {
        // 补一次重放：覆盖「订阅前写完、首次重放快照之后才提交」的极小窗口
        terminal = await this.replay(id, lastEventId, stream)
        unsubscribe()
        stream.close()
        return stream.drain()
      }
    }
    if (terminal || closedByListener) {
      unsubscribe()
      stream.close()
    }
    return stream.drain()
  }

  /** 后台执行入口：吞掉所有异常，避免 `void` 调用产生 unhandled rejection。 */
  private async execute(runId: string): Promise<void> {
    try {
      await this.executeRun(runId)
    } catch {
      // DB 彻底不可用时无法记录任何事件；不向外抛（运行保持原状态，可重查）。
    }
  }

  private async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({ where: { id: runId } })
    if (run === null) {
      return
    }
    const startedAt = new Date()
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { status: 'running', startedAt },
    })

    const composition = run.composition as unknown as Composition
    const layers: CompositionLayer[] = Array.isArray(composition?.layers) ? composition.layers : []

    const previous = await this.prisma.agentRunEvent.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    let lastSeq = previous?.seq ?? 0

    const writer: { chain: Promise<void>; failure: unknown } = {
      chain: Promise.resolve(),
      failure: null,
    }
    const enqueue = (task: () => Promise<void>): void => {
      writer.chain = writer.chain.then(task).catch((error: unknown) => {
        if (writer.failure === null) {
          writer.failure = error
        }
      })
    }

    /** 同步入队（token 回调不能 await），真正的写库与推送在串行链里按序完成。 */
    const emit: AgentEmit = (event, data) => {
      lastSeq += 1
      const seq = lastSeq
      enqueue(async () => {
        await this.prisma.agentRunEvent.create({
          data: { runId, seq, event, data: data as Prisma.InputJsonValue },
        })
        this.emitter.publish(runId, { seq, event, data })
      })
    }

    /** 终态事件：事件写入与状态更新在同一个事务里提交，然后推送。 */
    const finish = async (
      event: AgentEventName,
      data: Record<string, unknown>,
      update: Prisma.AgentRunUpdateInput,
    ): Promise<void> => {
      lastSeq += 1
      const seq = lastSeq
      enqueue(async () => {
        await this.prisma.$transaction([
          this.prisma.agentRunEvent.create({
            data: { runId, seq, event, data: data as Prisma.InputJsonValue },
          }),
          this.prisma.agentRun.update({ where: { id: runId }, data: update }),
        ])
        this.emitter.publish(runId, { seq, event, data })
      })
      await writer.chain
      if (writer.failure !== null) {
        throw writer.failure
      }
    }

    const state: AgentRunState = {
      input: run.input,
      messages: [],
      toolNames: [],
      llm: { maxRounds: 5 },
      output: '',
      checkCancelled: () => this.assertNotCancelled(runId),
    }
    const startedMs = startedAt.getTime()

    emit('run_started', { runId })
    try {
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]
        // 层边界：开始前检查取消
        await state.checkCancelled()
        emit('layer_started', { layer: layer.name, index: index + 1 })
        await this.runLayer(layer, state, emit)
        emit('layer_finished', { layer: layer.name, index: index + 1 })
      }
      await finish(
        'run_finished',
        { output: state.output, elapsedMs: Date.now() - startedMs },
        { status: 'succeeded', output: state.output, error: null, finishedAt: new Date() },
      )
    } catch (error) {
      if (error instanceof AgentRunCancelled) {
        await finish('run_cancelled', { runId }, { status: 'cancelled', finishedAt: new Date() })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      await finish(
        'run_failed',
        { message },
        { status: 'failed', error: message, finishedAt: new Date() },
      )
    }
  }

  /** 按层名分派（顺序完全由 `composition.layers` 决定）。 */
  private async runLayer(
    layer: CompositionLayer,
    state: AgentRunState,
    emit: AgentEmit,
  ): Promise<void> {
    const config = isPlainObject(layer.config) ? layer.config : {}
    switch (layer.name) {
      case 'history':
        runHistoryLayer(state, config, emit)
        return
      case 'prompt':
        runPromptLayer(state, config, emit)
        return
      case 'tools':
        runToolsLayer(state, config, emit)
        return
      case 'llm':
        await runLlmLayer(state, config, emit)
        return
      case 'output':
        runOutputLayer(state, config, emit)
        return
      default:
        // composition 校验已拦截未知层名，这里只是类型收敛
        return
    }
  }

  /** 层边界 / 工具轮边界：`cancelRequestedAt` 非空即抛 `AgentRunCancelled`。 */
  private async assertNotCancelled(runId: string): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { cancelRequestedAt: true },
    })
    if (run !== null && run.cancelRequestedAt !== null) {
      throw new AgentRunCancelled()
    }
  }

  /** 重放 `seq > lastEventId` 的事件；返回其中是否含终态事件。 */
  private async replay(
    runId: string,
    lastEventId: number,
    stream: AgentEventStream,
  ): Promise<boolean> {
    const rows = await this.prisma.agentRunEvent.findMany({
      where: { runId, seq: { gt: lastEventId } },
      orderBy: { seq: 'asc' },
    })
    let terminal = false
    for (const row of rows) {
      const event = row.event as AgentEventName
      stream.push({
        seq: row.seq,
        event,
        data: row.data as unknown as Record<string, unknown>,
      })
      if (isTerminalAgentEvent(event)) {
        terminal = true
      }
    }
    return terminal
  }

  private async findOwned(ownerId: string, id: string) {
    const run = await this.prisma.agentRun.findUnique({ where: { id } })
    if (run === null || run.ownerId !== ownerId) {
      throw new NotFoundException('Run not found')
    }
    return run
  }
}

function toAgentRunResponse(run: {
  id: string
  status: string
  input: string
  output: string | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}): AgentRunResponse {
  return {
    id: run.id,
    status: run.status as AgentRunStatus,
    input: run.input,
    output: run.output ?? null,
    error: run.error ?? null,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt === null ? null : run.startedAt.toISOString(),
    finishedAt: run.finishedAt === null ? null : run.finishedAt.toISOString(),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

**这段在干什么（按方法）**

1. **`accept` 的顺序是「校验 → 建 run → 写 seq1 → 点火 → 返回」**：`validateComposition` 失败时**什么都不建**（400 是普通 JSON）；`run_queued` 是 `await` 的，**返回 202 之前一定已落库**（§12.3）。
2. **`void this.execute(run.id)`**：不 `await`，请求立即返回；`execute` 内部 `try/catch` 吞掉所有异常，避免 `void` 产生 unhandled rejection。代价是**执行失败不再有调用方**——失败只能通过 `run_failed` 事件与 `AgentRun.error` 观察。
3. **`executeRun` 第一件事是把状态置 `running` + 写 `startedAt`**，然后才发 `run_started`。所以「`GET` 看到 `running`」与「事件流看到 `run_started`」几乎同时，但**状态先写**。
4. **`lastSeq` 的起点是 DB 现有最大 seq**，而不是硬编码 1：`run_queued` 已经占了 1，所以执行器从 2 开始；若库里还有更多行（重试 / 手工数据），也不会撞号。
5. **`writer.chain` 是串行化队列**：`emit` 同步 `lastSeq += 1` **先占号**，再 `enqueue` 一个「写库 → publish」任务。因为只有一个链，任务严格按入队顺序执行，**seq 的提交顺序 = 事件产生顺序**（§12.4）。`catch` 只记录第一个 failure 并**继续链**，避免一次写失败卡死所有后续事件。
6. **`finish` 也走同一条链**（保证终态排在所有事件之后），但会 `await writer.chain` 并检查 `writer.failure`：终态写不进去必须让调用方知道（否则会悄悄丢掉终态）。
7. **`finish` 的事务里同时写事件与状态**：`$transaction([create, update])`。这是「终态唯一」与「状态/事件一致」的实现（§12.9）。
8. **`runLayer` 只做分派**：执行顺序完全由 `composition.layers` 决定；`history` / `prompt` / `tools` / `output` 是同步的，只有 `llm` 是异步的（要调模型、要等多轮工具）。
9. **取消检查点**：循环里**每层开始前** `await state.checkCancelled()`；`llm` 层内部在每轮 LLM 调用前后、每个工具执行前再检查（见 §10.3 引用的 `llm.layer.ts`）。
10. **`catch` 分两支**：`AgentRunCancelled` → `run_cancelled` 并 `return`（**绝不**再发 `run_finished`）；其他错误 → `run_failed`，`message` 原样写进事件与 `AgentRun.error`。
11. **`stream` 的顺序是「先 `subscribe` → `replay` → 判终态 → 二次补重放 → `drain`」**：这是「重放 + 实时」不丢不重的主体（§12.7）。
12. **`replay` 只读 `seq > lastEventId` 并按升序**：与 `AgentEventStream` 的 `nextSeq` 配合，重放的事件会先连续吐出。
13. **`findOwned` 把「不存在」与「不是本人」合并成 404**：与阶段 2 的归属惯例一致，不泄露资源存在性。

**关于 `stream` 里「二次补重放」的条件**

只有 `!terminal && !closedByListener` 且**当前状态已是终态**时才补。理由：如果状态已终态，但第一次重放没读到终态事件，说明终态事务**在「读事件」与「读状态」之间提交**；此时再读一次 `seq > lastEventId` 必然能读到它。若状态还没终态，实时订阅会负责把后续事件送达，不需要补。

### 10.4 `apps/api-ts/src/agent/agent.controller.ts`

**完整文件路径：`apps/api-ts/src/agent/agent.controller.ts`**

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import type {
  AgentRunListResponse,
  AgentRunResponse,
  CancelAgentRunResponse,
  CreateAgentRunResponse,
} from '@mini-dify/contract'

import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard'
import { formatAgentSseFrame } from './agent-events'
import { AgentRunnerService } from './agent-runner.service'
import { CreateAgentRunDto } from './dto/create-agent-run.dto'

/**
 * 自主 Agent 运行时接口（阶段 11，JWT 鉴权）。
 *
 * - `POST /agent/runs` → **202**（异步，`{ id, status: "queued" }`）
 * - `GET /agent/runs` → 200（`createdAt` 倒序）
 * - `GET /agent/runs/{id}` → 200
 * - `POST /agent/runs/{id}/cancel` → **202**
 * - `GET /agent/runs/{id}/events` → 200 SSE（帧带 `id:` 行，支持 `Last-Event-ID` 重放）
 *
 * SSE 帧格式要求完全可控（含 `id:` 行），故与工作流运行一样**不使用** `@Sse()`，
 * 直接手写底层 `Response`。所有 4xx 都发生在写响应头之前，由全局过滤器归一为普通 JSON。
 */
@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(private readonly runner: AgentRunnerService) {}

  @Post('runs')
  @HttpCode(202)
  create(
    @CurrentUser() payload: JwtPayload,
    @Body() dto: CreateAgentRunDto,
  ): Promise<CreateAgentRunResponse> {
    return this.runner.accept(payload.sub, dto.input, dto.composition)
  }

  @Get('runs')
  list(@CurrentUser() payload: JwtPayload): Promise<AgentRunListResponse> {
    return this.runner.list(payload.sub)
  }

  @Get('runs/:id')
  get(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<AgentRunResponse> {
    return this.runner.get(payload.sub, id)
  }

  @Post('runs/:id/cancel')
  @HttpCode(202)
  cancel(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<CancelAgentRunResponse> {
    return this.runner.cancel(payload.sub, id)
  }

  @Get('runs/:id/events')
  async events(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Headers('last-event-id') lastEventIdHeader: string | undefined,
    @Query('lastEventId') lastEventIdQuery: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const lastEventId = parseLastEventId(lastEventIdHeader, lastEventIdQuery)
    const events = await this.runner.stream(payload.sub, id, lastEventId)

    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
    for await (const record of events) {
      response.write(formatAgentSseFrame(record))
    }
    response.end()
  }
}

/**
 * 解析「已收到的最大 seq」：**请求头 `Last-Event-ID` 优先**，其次查询参数 `lastEventId`；
 * 都没有时为 0（从头重放）。非负十进制整数之外的值 → 400 `invalid Last-Event-ID`。
 */
function parseLastEventId(header: string | undefined, query: string | undefined): number {
  const trimmedHeader = header?.trim()
  const trimmedQuery = query?.trim()
  const raw = trimmedHeader !== undefined && trimmedHeader !== '' ? trimmedHeader : trimmedQuery
  if (raw === undefined || raw === '') {
    return 0
  }
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException('invalid Last-Event-ID')
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException('invalid Last-Event-ID')
  }
  return value
}
```

**这段在干什么（按装饰器 / 段落）**

1. **`@HttpCode(202)` 写在 `POST` 上**：NestJS 对 POST 默认 201，必须显式改成 202（受理语义）。
2. **`GET runs/:id/events` 用 `@Res()` 手写响应**：不用 `@Sse()`，因为要精确控制 `id:` 行与关流时机。`flushHeaders()` 之后进入 SSE；**之前**的任何异常（404 / 400）都由全局过滤器变成普通 JSON。
3. **`parseLastEventId` 在 `stream()` 之前调用**：非法值 400 必须发生在写响应头之前。
4. **优先级**：`Last-Event-ID` 头 trim 后非空则用之，否则用 `lastEventId` 查询参数；两者都空 → `0`（从头重放）。
5. **`/^\d+$/` + `Number.isSafeInteger`**：先挡掉 `-1` / `abc` / `1.5` / 空白，再挡掉超过 `2^53-1` 的巨大数字。Python 侧刻意用同一个上界（§11.5），保证两端对同一个值给出同一个结果。
6. **`@UseGuards(JwtAuthGuard)` 在类上**：5 个接口全部要求登录；`payload.sub` 即 `ownerId`。

### 10.5 `apps/api-ts/src/agent/agent.module.ts`

**完整文件路径：`apps/api-ts/src/agent/agent.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AgentController } from './agent.controller'
import { AgentEventEmitter } from './agent-events.emitter'
import { AgentRunnerService } from './agent-runner.service'

/**
 * 自主 Agent 运行时模块（阶段 11）。
 * `PrismaService` 来自全局 `PrismaModule`，`JwtAuthGuard` 由 `AuthModule` 导出。
 */
@Module({
  imports: [AuthModule],
  controllers: [AgentController],
  providers: [AgentRunnerService, AgentEventEmitter],
})
export class AgentModule {}
```

**这段在干什么**

`AgentEventEmitter` 注册为**单例 provider**：执行器与控制器注入的是**同一个实例**，所以「执行器 publish 的事件」能到达「控制器订阅的监听器」。如果把 provider 做成 request-scoped 或每次 `new`，双通道立刻断掉——这是本阶段最容易犯的 DI 错误之一。

---

## 11. 完整代码：FastAPI 侧

### 11.1 `apps/api-py/app/agent/events.py`

**完整文件路径：`apps/api-py/app/agent/events.py`**

```python
"""Agent 事件协议（唯一真源：`packages/contract/agent-events.md`）。

与工作流 SSE 的区别：帧里**必须带 `id:` 行**（值即 `seq`），用于 `Last-Event-ID` 重放。
本模块只负责事件名 / payload 的形状、帧序列化与「取消」信号；持久化与订阅
由 `app/agent/runner.py` / `app/agent/emitter.py` 负责（先写 DB 再推订阅者）。
"""

import json
from collections.abc import Awaitable, Callable
from typing import Any

# Agent 事件名（顺序与触发时机见 agent-events.md §2）
AgentEventName = str

# 终态事件（三者恰有其一，见 agent-events.md §2.1）
TERMINAL_EVENTS: frozenset[str] = frozenset(
    {"run_finished", "run_failed", "run_cancelled"}
)

# 层内发事件用的回调：由运行器实现（写 DB → 推订阅者）
AgentEmit = Callable[[AgentEventName, dict[str, Any]], Awaitable[None]]


def is_terminal_agent_event(event: str) -> bool:
    """是否为终态事件。"""
    return event in TERMINAL_EVENTS


def format_agent_sse_frame(record: dict[str, Any]) -> str:
    """帧格式（固定）：`id: <seq>\\n` + `event: <name>\\n` + `data: <单行 JSON>\\n\\n`。

    注意：**不要**复用工作流的 `app.engine.events.format_sse_frame` —— 那个没有 `id:` 行，
    而 Agent 事件靠 `seq` 支持 `Last-Event-ID` 重放（见 agent-events.md §1）。
    """
    payload = json.dumps(record["data"], ensure_ascii=False, separators=(",", ":"))
    return f"id: {record['seq']}\nevent: {record['event']}\ndata: {payload}\n\n"


def run_queued(run_id: str) -> dict[str, Any]:
    """`run_queued`（**总是 seq 1**）。"""
    return {"event": "run_queued", "data": {"runId": run_id, "status": "queued"}}


def run_started(run_id: str) -> dict[str, Any]:
    return {"event": "run_started", "data": {"runId": run_id}}


def layer_started(layer: str, index: int) -> dict[str, Any]:
    """层开始（`index` 从 1 开始，等于 `composition.layers` 下标 + 1）。"""
    return {"event": "layer_started", "data": {"layer": layer, "index": index}}


def layer_finished(layer: str, index: int) -> dict[str, Any]:
    return {"event": "layer_finished", "data": {"layer": layer, "index": index}}


def token(text: str) -> dict[str, Any]:
    return {"event": "token", "data": {"text": text}}


def tool_call(tool_name: str, args: dict[str, Any], round_no: int) -> dict[str, Any]:
    """`tool_call`（`round` 从 1 开始）。"""
    return {
        "event": "tool_call",
        "data": {"toolName": tool_name, "args": args, "round": round_no},
    }


def tool_result(
    tool_name: str, result: str, elapsed_ms: int, round_no: int
) -> dict[str, Any]:
    """`tool_result`（`result` 一律为字符串）。"""
    return {
        "event": "tool_result",
        "data": {
            "toolName": tool_name,
            "result": result,
            "elapsedMs": elapsed_ms,
            "round": round_no,
        },
    }


def run_finished(output: str, elapsed_ms: int) -> dict[str, Any]:
    return {"event": "run_finished", "data": {"output": output, "elapsedMs": elapsed_ms}}


def run_failed(message: str) -> dict[str, Any]:
    return {"event": "run_failed", "data": {"message": message}}


def run_cancelled(run_id: str) -> dict[str, Any]:
    return {"event": "run_cancelled", "data": {"runId": run_id}}


class AgentRunCancelled(Exception):
    """已请求取消：由 `check_cancelled` 抛出，运行器据此发唯一一帧 `run_cancelled`。"""

    def __init__(self) -> None:
        super().__init__("agent run cancelled")
```

**这段在干什么**

1. **`format_agent_sse_frame` 与 TS 的 `formatAgentSseFrame` 逐字符对应**：`id:` / `event:` / `data:` + 空行。`json.dumps(..., ensure_ascii=False, separators=(",", ":"))` 保证中文不转义、无多余空格，两端的 `data` 行**解析后相等**。
2. **docstring 里明确「不要复用工作流的帧函数」**：这是本阶段唯一的帧格式差异，复用会静默丢掉 `id:`，重放直接失效。
3. **`TERMINAL_EVENTS` 用 `frozenset`**：不可变、可做成员判断；与 TS 的 `ReadonlySet` 同义。
4. **`AgentEmit` 是 `Callable[..., Awaitable[None]]`**：Python 侧允许 `await emit(...)`，所以执行器内部不需要 Promise 链（§12.4 的两端对照）。
5. **每个事件一个构造函数**：payload 的键集合被写死在函数里，避免调用点各写一份、两端键名漂移。

### 11.2 `apps/api-py/app/agent/emitter.py`

**完整文件路径：`apps/api-py/app/agent/emitter.py`**

```python
"""进程内的按 runId 订阅表（对应 api-ts 的 `agent-events.emitter.ts`）。

运行器每写成功一个事件就 `publish`；SSE 路由先 `subscribe` 再重放，
因此「重放 + 实时」的重叠部分由 SSE 端按 `seq` 去重。
"""

import asyncio
from collections.abc import Callable
from typing import Any


class AgentEventEmitter:
    """`dict[run_id, set[asyncio.Queue]]`：一个事件推给该运行的所有订阅者。"""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}

    def subscribe(self, run_id: str) -> tuple[asyncio.Queue[dict[str, Any]], Callable[[], None]]:
        """订阅某次运行的实时事件；返回 `(queue, unsubscribe)`。"""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.setdefault(run_id, set()).add(queue)

        def unsubscribe() -> None:
            listeners = self._subscribers.get(run_id)
            if listeners is None:
                return
            listeners.discard(queue)
            if not listeners:
                self._subscribers.pop(run_id, None)

        return queue, unsubscribe

    def publish(self, run_id: str, record: dict[str, Any]) -> None:
        """把一个已持久化的事件推给当前订阅者（没有订阅者时什么也不做）。"""
        for queue in list(self._subscribers.get(run_id, ())):
            queue.put_nowait(record)


# 进程级单例：执行器与 SSE 路由共用同一张订阅表
agent_event_emitter = AgentEventEmitter()
```

**这段在干什么**

1. **每个订阅者一个 `asyncio.Queue`**：Python 侧不用回调，而是「推入队列、由 SSE 生成器 `await queue.get()`」。这样天然把「推送」与「写出」解耦，且不需要锁。
2. **`put_nowait` + 无界队列**：`publish` 是同步函数，不能 `await`；无界队列保证不会因为慢客户端而阻塞执行器（代价是慢客户端会积压内存，本阶段可以接受）。
3. **单例 `agent_event_emitter`**：执行器与路由共用同一张表——这就是 Python 侧的「DI 单例」，对应 TS 的 `@Injectable()` provider。
4. **退订时清空 key**：与 TS 一致，避免 `dict` 无限增长。

### 11.3 `apps/api-py/app/models/agent_run.py`

**完整文件路径：`apps/api-py/app/models/agent_run.py`**

```python
"""`agent_runs` / `agent_run_events` 表模型（阶段 11）。

重要：这两张表的 DDL 由 TS 侧 Prisma 迁移拥有
（`apps/api-ts/prisma/migrations/20261023151132_add_agent_runs`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。

`agent_run_events` 的 `(run_id, seq)` 有唯一约束；`seq` 在单次运行内从 1 递增，
与 SSE 帧的 `id:` 行一致（见 `packages/contract/agent-events.md`）。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AgentRun(Base):
    __tablename__ = "agent_runs"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # queued | running | succeeded | failed | cancelled
    status: Mapped[str] = mapped_column(String, nullable=False)
    composition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    input: Mapped[str] = mapped_column(String, nullable=False)
    output: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    owner: Mapped["User"] = relationship("User", back_populates="agent_runs")
    # 删除运行时交给数据库的 ON DELETE CASCADE 删事件，避免 ORM 把 run_id 置 NULL
    events: Mapped[list["AgentRunEvent"]] = relationship(
        "AgentRunEvent", back_populates="run", passive_deletes=True
    )


class AgentRunEvent(Base):
    __tablename__ = "agent_run_events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    event: Mapped[str] = mapped_column(String, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    run: Mapped["AgentRun"] = relationship("AgentRun", back_populates="events")
```

**这段在干什么**

1. **只映射、不建表**：模块 docstring 写死迁移所有权，防止有人给 Python 再加 alembic。
2. **`seq` 用 `Integer`**（不是 `String`）：与 Prisma 的 `Int` → `INTEGER` 对齐；排序必须走数值序。
3. **`composition` / `data` 用 `JSONB`**：与 Prisma 的 `Json` 默认映射到 `jsonb` 对齐（阶段 3 已讲 `JSONB` vs 通用 `JSON`）。
4. **`events` 关系加 `passive_deletes=True`**：删 run 时交给数据库 `ON DELETE CASCADE`，避免 ORM 先把 `run_id` 置 `NULL` 触发 `NotNullViolation`（阶段 7 的教训）。
5. **`created_at` 用 `server_default=func.now()`**：写入默认值归数据库所有；`started_at` / `finished_at` / `cancel_requested_at` 由应用显式写 naive-UTC（与 Prisma 的 `timestamp(3)` 对齐）。

### 11.4 `apps/api-py/app/agent/runner.py`

**完整文件路径：`apps/api-py/app/agent/runner.py`**

```python
"""自主 Agent 运行时（阶段 11，对应 api-ts 的 `agent-runner.service.ts`）。

核心不变量（见 `packages/contract/agent-events.md`）：
- **异步接受**：`accept` 校验后建 run（`queued`）、持久化 `run_queued`（seq 1），
  再后台执行，立即返回 `{"id": ..., "status": "queued"}`。
- **事件先写 DB 再推订阅者**：每个事件写入 `agent_run_events` 后才 `publish`。
- **seq 单次运行内从 1 递增**：起点取自 DB 现有最大 seq（`run_queued` 为 1）。
- **终态唯一**：`run_finished` / `run_failed` / `run_cancelled` 恰有其一；
  终态事件与状态更新在**同一个事务**里提交。
- **取消是异步的**：`cancel` 只置 `cancelRequestedAt`，执行器在层边界 / 工具轮边界
  检查后发 `run_cancelled`。
"""

import asyncio
import time
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select

from app.agent.emitter import AgentEventEmitter, agent_event_emitter
from app.agent.events import (
    AgentEmit,
    AgentRunCancelled,
    format_agent_sse_frame,
    is_terminal_agent_event,
    run_queued,
)
from app.agent.layers.history import run_history_layer
from app.agent.layers.llm import run_llm_layer
from app.agent.layers.output import run_output_layer
from app.agent.layers.prompt import run_prompt_layer
from app.agent.layers.tools import run_tools_layer
from app.agent.state import AgentRunState
from app.agent.validator import validate_composition
from app.db import SessionLocal
from app.models.agent_run import AgentRun, AgentRunEvent
from app.timefmt import iso_z

# 终态状态集合（取消已终态的 run → 400 `Run is not cancellable`）
TERMINAL_STATUSES: frozenset[str] = frozenset({"succeeded", "failed", "cancelled"})

# 后台执行任务引用（避免 create_task 返回的 Task 被 GC 回收）
_BACKGROUND_TASKS: set[asyncio.Task[None]] = set()


class AgentRunner:
    def __init__(self, emitter: AgentEventEmitter | None = None) -> None:
        self.emitter = emitter if emitter is not None else agent_event_emitter

    # —— 对外接口 ——

    async def accept(self, owner_id: str, input_text: str, composition: Any) -> dict[str, Any]:
        """校验 composition → 建 run（`queued`）→ 持久化 `run_queued` → 异步启动执行。"""
        errors = validate_composition(composition)
        if errors:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors)
            )
        run_id = str(uuid.uuid4())
        with SessionLocal() as session, session.begin():
            session.add(
                AgentRun(
                    id=run_id,
                    owner_id=owner_id,
                    status="queued",
                    composition=composition,
                    input=input_text,
                )
            )
            # seq 1：接受即排队。此时还没有订阅者，不需要 publish（重放会读到它）。
            session.add(
                AgentRunEvent(
                    id=str(uuid.uuid4()),
                    run_id=run_id,
                    seq=1,
                    event="run_queued",
                    data=run_queued(run_id)["data"],
                )
            )
        task = asyncio.create_task(self._execute_safely(run_id))
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_TASKS.discard)
        return {"id": run_id, "status": "queued"}

    async def list(self, owner_id: str) -> dict[str, Any]:
        with SessionLocal() as session:
            runs = session.scalars(
                select(AgentRun)
                .where(AgentRun.owner_id == owner_id)
                .order_by(AgentRun.created_at.desc())
            ).all()
            return {"items": [_to_agent_run_response(run) for run in runs]}

    async def get(self, owner_id: str, run_id: str) -> dict[str, Any]:
        with SessionLocal() as session:
            return _to_agent_run_response(_find_owned(session, owner_id, run_id))

    async def cancel(self, owner_id: str, run_id: str) -> dict[str, Any]:
        """异步取消：只置 `cancelRequestedAt`，返回当前状态（仍在 `queued` / `running`）。"""
        with SessionLocal() as session:
            run = _find_owned(session, owner_id, run_id)
            if run.status in TERMINAL_STATUSES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Run is not cancellable"
                )
            if run.cancel_requested_at is None:
                run.cancel_requested_at = _now()
                session.commit()
            return {"id": run.id, "status": run.status}

    async def ensure_owned(self, owner_id: str, run_id: str) -> None:
        """校验归属（404 必须发生在写 SSE 响应头之前）。"""
        with SessionLocal() as session:
            _find_owned(session, owner_id, run_id)

    async def stream(
        self, owner_id: str, run_id: str, last_event_id: int
    ) -> AsyncGenerator[str, None]:
        """打开事件流：先订阅，再重放 `seq > lastEventId`，然后推送实时事件。

        按 `seq` 去重排序；收到终态事件（或在重放里遇到）后关闭。
        """
        queue, unsubscribe = self.emitter.subscribe(run_id)
        try:
            last_seq = last_event_id
            rows, terminal = _read_events(run_id, last_seq)
            for row in rows:
                last_seq = max(last_seq, row["seq"])
                yield format_agent_sse_frame(row)
            if terminal:
                return
            if _status_of(run_id) in TERMINAL_STATUSES:
                # 补一次重放：覆盖「订阅前写完、首次重放快照之后才提交」的极小窗口
                rows, terminal = _read_events(run_id, last_seq)
                for row in rows:
                    yield format_agent_sse_frame(row)
                return
            while True:
                record = await queue.get()
                if record["seq"] <= last_seq:
                    continue
                last_seq = record["seq"]
                yield format_agent_sse_frame(record)
                if is_terminal_agent_event(record["event"]):
                    return
        finally:
            unsubscribe()

    # —— 执行器 ——

    async def _execute_safely(self, run_id: str) -> None:
        """后台执行入口：吞掉所有异常，避免产生 unhandled 异常。"""
        try:
            await self._execute_run(run_id)
        except Exception:  # noqa: BLE001, S110 - DB 彻底不可用时无法记录任何事件
            pass

    async def _execute_run(self, run_id: str) -> None:
        with SessionLocal() as session:
            run = session.get(AgentRun, run_id)
            if run is None:
                return
            started_at = _now()
            run.status = "running"
            run.started_at = started_at
            session.commit()
            input_text = run.input
            composition = run.composition

        layers = (
            composition.get("layers")
            if isinstance(composition, dict) and isinstance(composition.get("layers"), list)
            else []
        )
        started_ms = time.time()
        last_seq = _max_seq(run_id)

        async def emit(event: str, data: dict[str, Any]) -> None:
            nonlocal last_seq
            last_seq += 1
            seq = last_seq
            _write_event(run_id, seq, event, data)
            self.emitter.publish(run_id, {"seq": seq, "event": event, "data": data})

        async def finish(
            event: str,
            data: dict[str, Any],
            status_value: str,
            output: str | None = None,
            error: str | None = None,
        ) -> None:
            nonlocal last_seq
            last_seq += 1
            seq = last_seq
            _write_terminal(run_id, seq, event, data, status_value, output, error)
            self.emitter.publish(run_id, {"seq": seq, "event": event, "data": data})

        state = AgentRunState(
            input=input_text,
            check_cancelled=lambda: self._assert_not_cancelled(run_id),
        )

        await emit("run_started", {"runId": run_id})
        try:
            for index, layer in enumerate(layers):
                # 层边界：开始前检查取消
                await self._assert_not_cancelled(run_id)
                name = layer.get("name") if isinstance(layer, dict) else None
                await emit("layer_started", {"layer": name, "index": index + 1})
                config = (
                    layer.get("config")
                    if isinstance(layer, dict) and isinstance(layer.get("config"), dict)
                    else {}
                )
                await self._run_layer(name, config, state, emit)
                await emit("layer_finished", {"layer": name, "index": index + 1})
            elapsed_ms = int((time.time() - started_ms) * 1000)
            await finish(
                "run_finished",
                {"output": state.output, "elapsedMs": elapsed_ms},
                "succeeded",
                output=state.output,
            )
        except AgentRunCancelled:
            await finish("run_cancelled", {"runId": run_id}, "cancelled")
        except Exception as error:  # noqa: BLE001 - 执行期错误统一归一为 run_failed
            message = str(error)
            await finish("run_failed", {"message": message}, "failed", error=message)

    async def _run_layer(
        self,
        name: Any,
        config: dict[str, Any],
        state: AgentRunState,
        emit: AgentEmit,
    ) -> None:
        """按层名分派（顺序完全由 `composition.layers` 决定）。"""
        if name == "history":
            run_history_layer(state, config)
        elif name == "prompt":
            run_prompt_layer(state, config)
        elif name == "tools":
            run_tools_layer(state, config)
        elif name == "llm":
            await run_llm_layer(state, config, emit)
        elif name == "output":
            run_output_layer(state, config)
        # composition 校验已拦截未知层名，其余情况什么也不做

    async def _assert_not_cancelled(self, run_id: str) -> None:
        """层边界 / 工具轮边界：`cancelRequestedAt` 非空即抛 `AgentRunCancelled`。"""
        with SessionLocal() as session:
            requested = session.scalar(
                select(AgentRun.cancel_requested_at).where(AgentRun.id == run_id)
            )
        if requested is not None:
            raise AgentRunCancelled()


def _now() -> datetime:
    """当前 UTC 时间（naive，与 Prisma `DateTime` 生成的 `timestamp(3)` 列对齐）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _find_owned(session: Any, owner_id: str, run_id: str) -> AgentRun:
    run = session.get(AgentRun, run_id)
    if run is None or run.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run


def _max_seq(run_id: str) -> int:
    with SessionLocal() as session:
        value = session.scalar(
            select(func.max(AgentRunEvent.seq)).where(AgentRunEvent.run_id == run_id)
        )
    return int(value) if value is not None else 0


def _read_events(run_id: str, last_event_id: int) -> tuple[list[dict[str, Any]], bool]:
    """读 `seq > last_event_id` 的事件（升序）；返回其中是否含终态事件。"""
    with SessionLocal() as session:
        rows = session.scalars(
            select(AgentRunEvent)
            .where(AgentRunEvent.run_id == run_id, AgentRunEvent.seq > last_event_id)
            .order_by(AgentRunEvent.seq.asc())
        ).all()
        events = [{"seq": row.seq, "event": row.event, "data": row.data} for row in rows]
    return events, any(is_terminal_agent_event(event["event"]) for event in events)


def _status_of(run_id: str) -> str | None:
    with SessionLocal() as session:
        return session.scalar(select(AgentRun.status).where(AgentRun.id == run_id))


def _write_event(run_id: str, seq: int, event: str, data: dict[str, Any]) -> None:
    with SessionLocal() as session, session.begin():
        session.add(
            AgentRunEvent(
                id=str(uuid.uuid4()), run_id=run_id, seq=seq, event=event, data=data
            )
        )


def _write_terminal(
    run_id: str,
    seq: int,
    event: str,
    data: dict[str, Any],
    status_value: str,
    output: str | None = None,
    error: str | None = None,
) -> None:
    """终态事件：事件写入与状态更新在同一个事务里提交。"""
    with SessionLocal() as session, session.begin():
        session.add(
            AgentRunEvent(
                id=str(uuid.uuid4()), run_id=run_id, seq=seq, event=event, data=data
            )
        )
        run = session.get(AgentRun, run_id)
        if run is not None:
            run.status = status_value
            run.finished_at = _now()
            if output is not None:
                run.output = output
            if error is not None:
                run.error = error


def _to_agent_run_response(run: AgentRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "status": run.status,
        "input": run.input,
        "output": run.output,
        "error": run.error,
        "createdAt": iso_z(run.created_at),
        "startedAt": None if run.started_at is None else iso_z(run.started_at),
        "finishedAt": None if run.finished_at is None else iso_z(run.finished_at),
    }
```

**这段在干什么（按区块）**

1. **`accept` 把「建 run」与「写 seq1」放进同一个事务**（`with SessionLocal() as session, session.begin():`）：要么两条都成功，要么都不成功。TS 侧同样是事务（交互式 `$transaction`），见 §12.3。
2. **`asyncio.create_task` + `_BACKGROUND_TASKS`**：`create_task` 的返回值若没人引用，可能被 GC 回收导致任务被取消；用模块级 `set` 持有引用、`add_done_callback` 移除，是 asyncio 的标准写法。
3. **`emit` 是 `async`、内部 `await` 顺序执行**：`_write_event` 是同步 DB 调用（在事件循环里阻塞一小段，教学项目可接受），返回后再 `publish`。因此 Python 侧不需要串行的 Promise 链——**协程本身就是串行的**（§12.4）。
4. **`last_seq = _max_seq(run_id)`**：从 DB 现有最大值继续，保证与 `run_queued` 的 seq 1 衔接。
5. **`finish` 调 `_write_terminal`**：一个 `session.begin()` 里同时 `add` 事件与更新 run 状态（含 `finished_at` / `output` / `error`），提交后 `publish`。
6. **取消检查点**：每层开始前 `await self._assert_not_cancelled(run_id)`；`run_llm_layer` 内部在 LLM 调用前后、每个工具执行前也会调 `state.check_cancelled`。
7. **`except AgentRunCancelled` 在前、`except Exception` 在后**：顺序决定「取消」不会被误判成失败；取消分支结束即返回，不会继续发 `run_finished`。
8. **`stream` 与 TS 同构但更简单**：先 `subscribe` → 重放 → 若重放里遇到终态直接 `return` → 若状态已终态则**二次重放** → 否则循环 `await queue.get()`，跳过 `seq <= last_seq`。`try/finally` 保证退订。
9. **`ensure_owned` 单独暴露给路由**：404 必须在 `StreamingResponse` 创建之前抛出（`app/api/agent.py` 里先调用它）。
10. **`_to_agent_run_response` 用 `iso_z`**：时间戳统一成 24 字符 `...Z`，与 TS 的 `toISOString()` 对齐。

### 11.5 `apps/api-py/app/api/agent.py`

**完整文件路径：`apps/api-py/app/api/agent.py`**

```python
"""自主 Agent 运行时接口（阶段 11，JWT 鉴权）。

契约见 `packages/contract/openapi.yaml`，事件协议见
`packages/contract/agent-events.md`，错误文案见 `error-messages.md` §11。

- `POST /agent/runs` → **202**（异步，`{"id": ..., "status": "queued"}`）
- `GET /agent/runs` → 200（`createdAt` 倒序）
- `GET /agent/runs/{id}` → 200
- `POST /agent/runs/{id}/cancel` → **202**
- `GET /agent/runs/{id}/events` → 200 SSE（帧带 `id:` 行，支持 `Last-Event-ID` 重放）

所有 4xx 都发生在写响应头之前，由全局错误处理器归一为普通 JSON。
"""

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.agent.runner import AgentRunner
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/agent", tags=["agent"])

agent_runner = AgentRunner()


class CreateAgentRunRequest(BaseModel):
    """对应契约 `CreateAgentRunRequest`。

    `composition` 只做「必须是对象」的校验；层名 / 层配置的语义校验由
    `validate_composition` 统一产出契约文案（§11）。
    """

    model_config = ConfigDict(extra="forbid")

    input: str = Field(min_length=1, max_length=4000)
    composition: dict[str, Any]


class AgentRunResponse(BaseModel):
    """对应契约 `AgentRunResponse`（时间戳已是 `...Z` 字符串）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    status: str
    input: str
    output: str | None
    error: str | None
    createdAt: str
    startedAt: str | None
    finishedAt: str | None


class AgentRunListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AgentRunResponse]


class CreateAgentRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    status: Literal["queued"]


class CancelAgentRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    status: Literal["queued", "running"]


@router.post(
    "/runs",
    response_model=CreateAgentRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="createAgentRun",
)
async def create_agent_run(
    body: CreateAgentRunRequest,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await agent_runner.accept(current_user.id, body.input, body.composition)


@router.get("/runs", response_model=AgentRunListResponse, operation_id="listAgentRuns")
async def list_agent_runs(
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await agent_runner.list(current_user.id)


@router.get("/runs/{id}", response_model=AgentRunResponse, operation_id="getAgentRun")
async def get_agent_run(
    id: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await agent_runner.get(current_user.id, id)


@router.post(
    "/runs/{id}/cancel",
    response_model=CancelAgentRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="cancelAgentRun",
)
async def cancel_agent_run(
    id: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await agent_runner.cancel(current_user.id, id)


@router.get("/runs/{id}/events", operation_id="streamAgentRunEvents")
async def stream_agent_run_events(
    id: str,
    last_event_id_header: str | None = Header(default=None, alias="Last-Event-ID"),
    last_event_id_query: str | None = Query(default=None, alias="lastEventId"),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    # 与 api-ts 一致：先解析 Last-Event-ID（非法值 400），再校验归属（404）
    last_event_id = _parse_last_event_id(last_event_id_header, last_event_id_query)
    await agent_runner.ensure_owned(current_user.id, id)
    return StreamingResponse(
        agent_runner.stream(current_user.id, id, last_event_id),
        media_type="text/event-stream",
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
    )


_LAST_EVENT_ID_PATTERN = re.compile(r"^\d+$")
# JS `Number.isSafeInteger` 的上界
_MAX_SAFE_INTEGER = 2**53 - 1


def _parse_last_event_id(header: str | None, query: str | None) -> int:
    """解析「已收到的最大 seq」：请求头 `Last-Event-ID` 优先，其次查询参数 `lastEventId`。

    都没有时为 0（从头重放）。非负十进制整数之外的值 → 400 `invalid Last-Event-ID`。
    """
    trimmed_header = header.strip() if header is not None else None
    trimmed_query = query.strip() if query is not None else None
    raw = trimmed_header if trimmed_header is not None and trimmed_header != "" else trimmed_query
    if raw is None or raw == "":
        return 0
    if _LAST_EVENT_ID_PATTERN.match(raw) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid Last-Event-ID"
        )
    value = int(raw)
    if value > _MAX_SAFE_INTEGER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid Last-Event-ID"
        )
    return value
```

**这段在干什么（按区块）**

1. **`status_code=status.HTTP_202_ACCEPTED`** 显式声明 202（FastAPI 默认 200）；`CancelAgentRunResponse.status` 用 `Literal["queued","running"]` 把「取消接口不会返回终态」写进类型。
2. **`CreateAgentRunRequest.composition: dict[str, Any]`**：这里只校验「是对象」；层名 / 层配置的语义交给 `validate_composition`，才能产出 §11 的专用文案（而不是 Pydantic 的通用文案）。
3. **`Header(alias="Last-Event-ID")`**：FastAPI 默认把参数名转成小写连字符形式；显式 `alias` 保证读到的确实是 `Last-Event-ID`。
4. **「先解析、再校验归属」**：与 TS 一致。非法 `Last-Event-ID` 优先于 404——因为它是**请求格式错误**，不需要先知道运行是否存在。
5. **`ensure_owned` 在 `StreamingResponse` 之前 `await`**：404 必须发生在写响应头之前。
6. **显式给 `Content-Type` 头**：Starlette 的 `media_type="text/event-stream"` 会追加 `; charset=utf-8`，与 api-ts 的响应头不一致；用 `headers` 覆盖（阶段 0 的 `charset` 经验在这里复用）。
7. **`_MAX_SAFE_INTEGER = 2**53 - 1`**：刻意与 JS 的 `Number.isSafeInteger` 上界对齐。否则同样一个超大值，TS 报 400、Python 接受，就违反「两端一致」。

### 11.6 路由注册（两端各一行）

**完整文件路径：`apps/api-py/app/main.py`**（摘录）

```python
from app.api.agent import router as agent_router
# …
app.include_router(agent_router)
```

**完整文件路径：`apps/api-ts/src/app.module.ts`**（摘录）

```ts
import { AgentModule } from './agent/agent.module'
// …
@Module({
  imports: [
    // …
    AgentModule,
  ],
})
export class AppModule {}
```

**这段在干什么**

两端都只是把新模块挂进总入口；`/agent` 前缀由 `@Controller('agent')` / `APIRouter(prefix="/agent")` 提供，**不要**在总入口再拼一次，否则路径会变成 `/agent/agent/runs`。

---

## 12. 首次技术教学

### 12.1 为什么 Agent 运行时需要「异步受理」

**先看一个数字**：一次 `maxRounds = 5` 的 ReAct，最多是「5 轮工具调用 + 每轮一次 LLM 调用 + 最后一轮收尾的 LLM 调用」。单次 LLM 十几秒、工具几秒，整次运行**分钟级**很常见。

**把运行挂在 HTTP 请求上，会坏在三层**

| 层 | 默认行为 | 后果 |
| --- | --- | --- |
| 浏览器 / 客户端 | 等待响应；刷新即断开 | 刷新页面 = 丢了整次运行（服务端不知道客户端走了） |
| 反向代理 / 网关 | 空闲超时（常见 60s）后切断连接 | 客户端看到「连接重置」，服务端还在写一个没人读的响应 |
| 移动网络 | IP 变化 / 切网会断 TCP | 没有任何「续看」机制 |

所以「一个请求跑到底」只适合**有界且短**的工作流运行。Agent 需要把「受理」与「读取」拆开。

**`202 Accepted` 到底承诺了什么**

| 状态码 | 语义 | 是否保证最终成功 |
| --- | --- | --- |
| `200 OK` | 请求已处理完，响应体就是结果 | 是（结果已在响应里） |
| `201 Created` | 资源已创建，响应体是资源的完整表示 | 是（资源现在就存在且可读） |
| **`202 Accepted`** | **请求已被接受处理，但处理尚未完成** | **否**——可能成功，也可能在后台失败 |

这正是我们要的：

- 受理时只承诺「我记下了这次运行」（`queued` + `run_queued` 事件）；
- 结果可能以 `run_finished` 成功，也可能以 `run_failed` 失败，甚至被 `run_cancelled`；
- 客户端拿 `id` 去**另开一条**事件流，或直接查 `GET /runs/{id}`。

**实测（POST 的真实响应；`body.json` 的构造见 §13.2）**

```powershell
curl.exe -s -o run.json -w '%{http_code}\n' -X POST http://127.0.0.1:3001/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  --data-binary '@body.json'
Get-Content run.json -Encoding UTF8
```

```text
202
{"id":"a0f4c0e2-...","status":"queued"}
```

**这段在干什么**

`202` 说明「已受理」；响应体只有 `id` 与 `status`，**没有** `output`。`status` 恒为 `queued`——注意它可能在你读到这一行时早已变成 `running`，响应体表达的是**受理那一刻**的状态。

**为什么不是「用 SSE 一直挂着」**

有人会问：既然结果也是流，为什么不 `POST /agent/runs` 直接返回 SSE，边执行边写？

| 方案 | 问题 |
| --- | --- |
| `POST` 长连接 SSE | 代理超时会切断；断线后**无法**用同一个请求续看；取消没有独立入口；`POST` 不可重放（重发一次会创建**第二个**运行） |
| 202 + 独立 `GET events` | 受理是幂等点（一次 POST 一次运行）；订阅可随时加入 / 重连 / 重放；取消有独立接口 |

关键区别是**可重放性**：`GET` 是幂等的，可以带 `Last-Event-ID` 重放；`POST` 不是，重发就多跑一次。把「读」放在 `GET` 上，重连才成立。

**为什么响应体里要带 `runId`**

它是后续所有操作的**关联键**：

```
POST /agent/runs          → id
GET  /agent/runs/{id}/events   ← 看过程
GET  /agent/runs/{id}          ← 看终值
POST /agent/runs/{id}/cancel   ← 请求停止
```

没有它，客户端只能靠轮询列表猜「哪一条是刚才的」，既慢又不可靠（同一用户可能并发多次运行）。

**「点火」的两端写法**

```ts
// api-ts
void this.execute(run.id)
return { id: run.id, status: 'queued' }
```

**这段在干什么**

`void` 表示**故意不 await**：请求立即返回，后台任务继续跑。`execute` 内部包了 `try/catch`，所以不会产生 unhandled rejection。

```python
# api-py
task = asyncio.create_task(self._execute_safely(run_id))
_BACKGROUND_TASKS.add(task)
task.add_done_callback(_BACKGROUND_TASKS.discard)
return {"id": run_id, "status": "queued"}
```

**这段在干什么**

`create_task` 把协程排进事件循环；但**必须**用模块级 `set` 持有 Task 引用——asyncio 只保留弱引用，任务可能在完成前被 GC 回收（表现为「运行莫名其妙消失」）。`add_done_callback` 在完成时移除，避免集合无限增长。

**顺带一个必然结果**

因为执行是「fire-and-forget」，**执行期的失败没有调用方可以抛给**。所以失败只能通过两条路观察：`run_failed` 事件（过程）与 `AgentRun.error`（终值）。这也是为什么后面「终态唯一」如此重要（§12.9）。

### 12.2 Run 的状态机

**五个状态**

```
                 ┌──────────────┐
   accept 写入   │    queued    │
                 └──────┬───────┘
                        │ executeRun 一开头 UPDATE
                        ▼
                 ┌──────────────┐
                 │   running    │
                 └──┬────┬───┬──┘
        run_finished│    │   │run_cancelled
                    ▼    │   ▼
            ┌──────────┐ │ ┌───────────┐
            │succeeded │ │ │ cancelled │
            └──────────┘ │ └───────────┘
                 run_failed
                        ▼
                  ┌──────────┐
                  │  failed  │
                  └──────────┘
```

**全项目只有三处写状态**

| 写入点 | 代码 | 写什么 |
| --- | --- | --- |
| 1 | `accept` 的 INSERT | `status = 'queued'` |
| 2 | `executeRun` 开头 | `status = 'running'` + `startedAt` |
| 3 | `finish` 的事务 | `succeeded` / `failed` / `cancelled` + `finishedAt`（+ `output` / `error`） |

`cancel` **不写状态**，只写 `cancelRequestedAt`。这一点非常关键：**取消请求不是状态**，状态只由执行器在收尾时写。

**为什么不存在回退边**

- 没有任何代码把终态写回 `queued` / `running`：`finish` 每次运行只会被调用一次（成功分支一次、两个 catch 分支各自一次且 `return`）。
- 没有 `queued → succeeded` 的直达边：执行器**必定**先把状态置 `running`，再跑层。
- 「在 `queued` 阶段取消」也不是从 `queued` 直接跳到 `cancelled`：`cancelRequestedAt` 只是个标记；执行器接手后仍会先置 `running`，在**第一个层边界**发现标记，再以 `running → cancelled` 收尾。

**这条性质由代码结构保证，不由数据库保证**

`status` 是普通 `TEXT` 列，没有 `CHECK` 约束、没有状态机触发器。好处是改状态集合不需要迁移；代价是「写错状态」只能靠代码与测试兜住。如果你给这张表加了别的写入口（脚本、后台任务），状态机就可能被破坏——**这是刻意的取舍，不是遗漏**。

**状态机的可观察含义**

| 状态 | `startedAt` | `finishedAt` | `output` | `error` | 事件流 |
| --- | --- | --- | --- | --- | --- |
| `queued` | `null` | `null` | `null` | `null` | 只有 `run_queued` |
| `running` | 非空 | `null` | `null` | `null` | 已开始，可能还在涨 |
| `succeeded` | 非空 | 非空 | 字符串（可为空串） | `null` | 以 `run_finished` 结束 |
| `failed` | 非空 | 非空 | `null` | 错误消息 | 以 `run_failed` 结束 |
| `cancelled` | 非空 | 非空 | `null` | `null` | 以 `run_cancelled` 结束 |

**这段在干什么**

这张表是「如何从 `GET /runs/{id}` 判断发生了什么」的唯一依据。特别注意 **`cancelled` 的 `output` 是 `null`**（实测）：取消发生在 `output` 层之前时，`state.output` 从未被写回 run 行；只有 `succeeded` 分支会写 `output`。

### 12.3 `run_queued` 为什么要落库

**场景：客户端拿到 202 后立刻订阅**

```
t0  POST /agent/runs  ────────────────▶ 建 run、写 seq1、点火、返回 202
t1  GET  /agent/runs/{id}/events ─────▶ 订阅 + 重放
t2  执行器刚开始跑，写 seq2 run_started
```

`t1` 和 `t2` 谁先发生**完全不确定**：

- 如果执行器先跑，客户端会先收到 `run_started`（seq 2），**永远看不到 seq 1**；
- 如果客户端先订阅，重放时库里必须**已经有**一条事件，否则第一帧要等到 `t2`。

`run_queued` 解决了这两个问题：

1. **它是一条可重放的「收据」**：`t1` 时无论执行器有没有动，库里至少有 seq 1。
2. **它保证 `id` 从 1 开始连续**：如果没有它，执行器的第一个事件就是 seq 1（`run_started`），客户端会看到 `id: 1` 但语义是「开始」；更糟的是重放时无法区分「我拿到的是最早的事件」还是「我漏了前面的事件」。

**因此它必须「在返回 202 之前」落库**

代码里的顺序是硬性的：

```ts
// ① + ② 在同一个事务里：run 与 run_queued（seq 1）要么都成功、要么都失败。
const run = await this.prisma.$transaction(async (tx) => {
  const created = await tx.agentRun.create({ … })
  // seq 1：接受即排队。此时还没有订阅者，不需要 publish（重放会读到它）。
  await tx.agentRunEvent.create({
    data: {
      runId: created.id,
      seq: 1,
      event: 'run_queued',
      data: { runId: created.id, status: 'queued' },
    },
  })
  return created
})
void this.execute(run.id)                                 // ③ 点火（不 await）
return { id: run.id, status: 'queued' }                   // ④ 返回 202
```

**这段在干什么**

①② 都是 `await` 且**同事务**：**只有当「运行存在」与「seq 1 存在」都提交后，才点火并返回**。③ 故意不 await，所以返回 202 时执行器可能还没跑、也可能已经跑到 seq 3——但客户端无论何时订阅，都能从 seq 1 开始重放。

**为什么 `run_queued` 不需要 `publish`**

它写入时**还没有任何订阅者**（客户端连 `id` 都还没拿到）。所以 `accept` 里只写库、不 `publish`。它只会通过**重放**被读到：

```ts
// accept：只持久化，不 publish
await tx.agentRunEvent.create({ … })
```

**这段在干什么**

这不是省事，而是双通道的正确用法：**推送只服务于「已经在看的人」；历史服务于「刚来 / 重连的人」**。`run_queued` 天生只属于后者。

**两端同事务（已对齐）**

| 端 | `accept` 的两条 INSERT | 后果 |
| --- | --- | --- |
| api-py | **同一个事务**（`with SessionLocal() as session, session.begin():`） | run 与 seq1 要么都在、要么都不在 |
| api-ts | **同一个事务**（交互式 `$transaction(async (tx) => …)`） | 同上；事件要引用 run 的 `id`，所以用交互式事务而非数组式 |

两侧的写法不同（Prisma 交互式事务 / SQLAlchemy `session.begin()`），但保证的不变量一致：**不会出现「run 存在但缺 seq 1」**。

### 12.4 事件持久化 + 实时推送的双通道

**系统里同时有两条「事件通道」**

| 通道 | 载体 | 特点 | 谁用 |
| --- | --- | --- | --- |
| **持久化通道** | `agent_run_events` 表 | 有序、可查询、可重放、**跨进程/跨重启** | 重放、`Last-Event-ID`、审计 |
| **实时通道** | 进程内 `Map/Set`（TS）/ `dict+Queue`（Py） | 低延迟、只覆盖「当前在线订阅者」、**进程内** | 正在看的人 |

**顺序：先写库，再推送**

```
emit(event, data)
  ├─ seq += 1
  ├─ ① INSERT agent_run_events(run_id, seq, event, data)   ← await 提交
  └─ ② publish(run_id, {seq, event, data})                  ← 推给订阅者
```

**为什么不能反过来**

假设先推后写：

```
① publish(seq=7)  →  客户端收到 id: 7
② （还没写库）    →  网络断了 / 进程崩了 / 写库失败
③ 客户端重连，带 Last-Event-ID: 7
④ 服务端重放 seq > 7  →  从 8 开始（7 永远找不回来）
```

**客户端已经「看见过」seq 7，但持久层没有它**，重连后这条事件永久丢失。反过来（先写后推）则有一个弱保证：

> **凡是客户端收到过的 seq，都已经在库里**（至少在同进程内、写库成功之后）。

于是重连时「从 N+1 重放」一定能接上。

**还有一个更隐蔽的坏处**

如果先推后写，`seq` 在库里的**提交顺序**可能与客户端的**接收顺序**不同。`UNIQUE(run_id, seq)` 只防重复，**不防乱序**。乱序会让 `Last-Event-ID` 的语义（「我已收到连续到 N」）失效：客户端可能收到 8 再收到 7，此时它该报哪个？

**TS：同步回调 + 串行 Promise 链**

`token` 的回调是 LangChain 的同步回调：

```ts
const step = await runLlmStep(…, (text) => emit('token', { text }))
```

**这段在干什么**

`(text) => emit(...)` 的返回值是 `void`，LangChain **不会 await 它**。所以 `emit` 必须同步完成「占号」，真正的异步写库只能排队。

```ts
const writer: { chain: Promise<void>; failure: unknown } = {
  chain: Promise.resolve(),
  failure: null,
}
const enqueue = (task: () => Promise<void>): void => {
  writer.chain = writer.chain.then(task).catch((error: unknown) => {
    if (writer.failure === null) {
      writer.failure = error
    }
  })
}

const emit: AgentEmit = (event, data) => {
  lastSeq += 1
  const seq = lastSeq
  enqueue(async () => {
    await this.prisma.agentRunEvent.create({ data: { runId, seq, event, data } })
    this.emitter.publish(runId, { seq, event, data })
  })
}
```

**这段在干什么**

1. **`lastSeq += 1` 是同步的**：事件产生时立刻「占号」，因此**号序 = 产生顺序**。
2. **`enqueue` 把「写库 + publish」挂到链尾**：链是 `Promise` 串联，前一个任务完成才跑下一个，因此**写库顺序 = 占号顺序**。
3. **`publish` 在 `create` 之后**：这就是「先写后推」。
4. **`catch` 记录 `failure` 但返回 resolved**：一次写失败不会让整条链变成 rejected（否则后续事件全部挂掉）。`failure` 留给 `finish` 检查。

**Python：内联 `await` 就够了**

```python
async def emit(event: str, data: dict[str, Any]) -> None:
    nonlocal last_seq
    last_seq += 1
    seq = last_seq
    _write_event(run_id, seq, event, data)          # 同步 DB 写（事务提交后返回）
    self.emitter.publish(run_id, {"seq": seq, "event": event, "data": data})
```

**这段在干什么**

Python 的层内回调是 `await emit(...)`，调用方**会等**，所以不需要链：`last_seq += 1` 之后立刻写库、立刻推送，协程的串行性天然保证了顺序。两端的行为一致，**实现手段不同**——这是「同一契约、两套语言」的典型对照。

**代价**

| 代价 | 说明 |
| --- | --- |
| 每个事件一次 `INSERT` | token 高频时写放大明显（本阶段可接受；生产可批量 / 异步队列） |
| 写库失败会留下空洞 | TS 的链继续跑，`AgentEventStream.drain` 在 `close` 后按 seq 升序兜底吐出，避免客户端挂起 |
| 实时通道只在进程内 | 见 §12.10 的部署边界 |

### 12.5 `seq`：单次运行内的单调序号 + `UNIQUE(run_id, seq)`

**三个事实**

1. **作用域是「一次运行」**：每次运行都从 1 开始。不同 run 可以有同样的 seq（这正是唯一约束要带 `run_id` 的原因）。
2. **单调递增、不跳号、不重复**（正常路径）：由「单写者 + 串行写入」保证。
3. **它同时是 SSE 帧的 `id:`**：客户端只需要记住「最大的 seq」，就能精确表达「我收到哪了」。

**起点怎么来**

| 事件 | seq | 谁写 |
| --- | --- | --- |
| `run_queued` | **1（硬编码）** | `accept` |
| `run_started` 及之后 | `lastSeq + 1` | 执行器，`lastSeq` 初始化为**库里现有最大 seq** |

```ts
const previous = await this.prisma.agentRunEvent.findFirst({
  where: { runId },
  orderBy: { seq: 'desc' },
  select: { seq: true },
})
let lastSeq = previous?.seq ?? 0
```

**这段在干什么**

执行器不假设「库里只有 seq 1」，而是**从真实最大值续号**。正常情况下最大值就是 1（`run_queued`），于是 `run_started` 得到 2。这个写法让执行器对「重复执行 / 手工补数据」也安全——不会撞上唯一约束。

**为什么不用数据库自增 / 全局序列**

| 方案 | 问题 |
| --- | --- |
| `BIGSERIAL` 全局自增 | 不同 run 的 seq 会**交错**（run A: 1,3,5；run B: 2,4,6），客户端无法用「最大 seq」表达「我这条流收到哪」 |
| `count(*) + 1` | 每写一条都要计数（O(n)），并发下会重复 |
| **单写者内存计数器**（本项目） | 一次运行只有一个执行器写事件，内存计数器天然安全；起点从 DB 最大值续上 |

**`UNIQUE(run_id, seq)` 保证了什么**

1. **不重复**：即使代码有 bug（重试、并发写），数据库也会拒绝第二条同 seq 的事件，而不是静默插入。
2. **重放查询有索引**：`where run_id = ? and seq > ? order by seq asc` 走 `(run_id, seq)` 复合索引，是**前缀匹配**，不需要额外索引。
3. **它不保证连续**：唯一约束允许 1,2,4。连续性靠「单写者串行 + 写失败时有兜底」保证，不是数据库保证。这一点要说清，否则会误以为「有唯一约束就不会跳号」。

**与阶段 9 的对照**

| | 阶段 9 `messages.seq` | 阶段 11 `agent_run_events.seq` |
| --- | --- | --- |
| 作用域 | 一次会话 | 一次运行 |
| 唯一约束 | `UNIQUE(conversation_id, seq)` | `UNIQUE(run_id, seq)` |
| 用途 | 消息顺序 / 增量拉取 | **事件顺序 + `Last-Event-ID` 重放** |
| 谁分配 | 写消息时计算 | 受理时 1、执行时内存计数器 |

### 12.6 `Last-Event-ID` 重放

**SSE 标准里的 `id:` 与 `Last-Event-ID`**

SSE 协议规定：服务端可以在帧里写 `id: <字符串>`；浏览器把这值记成「last event ID」。**当连接断开并自动重连时**，浏览器会在新请求里带上：

```
Last-Event-ID: <上次收到的最后一个 id>
```

**但有两个前提，必须说清**

1. **只有原生 `EventSource` 会自动重连并自动带这个头**。本项目前端用的是 `fetch + getReader`（因为 `EventSource` 无法带 `Authorization`，阶段 4 已讲），所以**必须自己保存 `id:` 并手动回传**（`apps/web/app/agent/page.tsx` 的 `lastEventIdRef`）。
2. **原生 `EventSource` 在服务端「正常关闭」时也会重连**。本项目收到终态事件就关流；如果客户端用 `EventSource`，必须在收到终态后主动 `close()`，否则会「重连 → 服务端已终态、零帧关闭 → 再重连」死循环。

**帧形状（Agent 独有的一行）**

```text
id: 7
event: token
data: {"text":" Hel"}

```

**这段在干什么**

与工作流的帧相比只多了第一行。`id` 的值就是 `seq`；客户端收到后要把它记成「最大值」——注意 SSE 允许多个事件复用 id，但我们的 seq 严格递增，所以「最后一个 id」就是「最大 seq」。

**服务端只推 `seq > N`**

```ts
const rows = await this.prisma.agentRunEvent.findMany({
  where: { runId, seq: { gt: lastEventId } },
  orderBy: { seq: 'asc' },
})
```

**这段在干什么**

严格大于：客户端说「我收到 5」，服务端就从 6 开始，**不重发 5**。升序：保证客户端看到的 `id` 连续递增。

**解析规则（两端逐字对齐）**

| 输入 | 结果 |
| --- | --- |
| 头 `Last-Event-ID: 5` + 查询 `?lastEventId=9` | **用 5**（头优先） |
| 头缺失/空 + 查询 `?lastEventId=9` | 用 9 |
| 都没有 | `0`（从头重放） |
| `abc` / `-1` / `1.5` / `  ` | **400 `invalid Last-Event-ID`**，不打开流 |
| 超过 `2^53-1` | 400（两端同一个上界） |

**为什么非法值必须 400 而不是「当成 0」**

「当成 0」看起来更宽容，但它会让**客户端 bug**变成**静默重复**：客户端把 id 拼错成 `1x`，服务端默默从头重放，客户端会收到一大堆重复事件，却不知道为什么。400 把 bug 立刻暴露。

**为什么必须在开流前 400**

一旦写了 `200 + text/event-stream`，HTTP 状态码就固定了，只能在流内发 `run_failed`——但那会让「请求格式错误」看起来像「运行执行失败」，语义完全错。这就是阶段 4 的「先校验、后开流」。

**「已覆盖终态」时零帧关闭**

如果客户端带的 `lastEventId` 已经 >= 终态事件的 seq，服务端重放没有任何行、状态是终态，于是**直接关闭流，不发任何帧**。这是契约明确写的（§4）：客户端已经收全了，没有新东西可给。

### 12.7 「重放 + 实时」的衔接窗口

这是本阶段**最容易写错**的地方。先把两种朴素写法各自坏在哪讲清。

**写法 A：先重放，后订阅**

```
① 读 DB：拿到 seq 1..5
② （执行器写 6、7 并 publish —— 此时还没有订阅者，publish 无人接收）
③ 订阅实时事件
④ 执行器写 8 → 客户端收到 8
```

客户端手里是 `1..5, 8`：**6、7 永久丢失**。因为它们在「重放快照之后、订阅之前」被写成了——重放没读到，推送也没人听。

**写法 B：先订阅，后重放（但不做排序去重）**

```
① 订阅
② 执行器写 6 → publish → 监听器立刻收到 6
③ 读 DB：拿到 1..7（包含 6、7）
④ 直接按到达顺序写出：6, 1, 2, 3, 4, 5, 7, …
```

现在**不丢**了，但 `id:` 乱序，而且**重复**（6、7 出现两次）。`Last-Event-ID` 的语义是「连续到 N」，乱序会让客户端不知道该报哪个。

**本项目的写法：订阅 → 重放 → 二次补重放 → 排序去重**

```
① subscribe(runId, listener)              ← 先订阅，堵住「之后」的窗口
② replay(seq > lastEventId)               ← 补「之前」的历史，push 进同一缓冲区
③ 若重放里遇到终态 → 关闭
④ 若状态已终态（但重放没遇到终态）→ 再 replay 一次 → 关闭
⑤ 否则 drain：按 nextSeq 连续产出，实时事件继续 push
```

**TS 的缓冲区怎么工作**

```ts
const stream = new AgentEventStream(lastEventId + 1)
let closedByListener = false
const unsubscribe = this.emitter.subscribe(id, (record) => {
  stream.push(record)
  if (isTerminalAgentEvent(record.event)) {
    closedByListener = true
    stream.close()
  }
})

let terminal = await this.replay(id, lastEventId, stream)
```

**这段在干什么**

1. **先订阅**：从这一刻起，所有新事件都会进 `stream.pending`（可能乱序，也可能与重放重复）。
2. **`AgentEventStream(lastEventId + 1)`**：期望的第一条是 `N+1`。
3. **重放也 `push` 进同一个缓冲**：所以重放与实时**汇流**，由 `seq` 统一裁决。
4. **监听器收到终态就 `close()`**：终态之后不再有新事件，可以收尾。
5. **`replay` 返回「历史里是否已有终态」**：决定是否还需要等实时。

**缓冲区为什么能同时解决「乱序」和「重复」**

```ts
push(record: AgentEventRecord): void {
  if (record.seq < this.nextSeq || this.pending.has(record.seq)) {
    return                              // 已发过 / 重复 → 丢弃
  }
  this.pending.set(record.seq, record)  // 先存起来（可能比 nextSeq 大）
  this.wake()
}

async *drain(): AsyncGenerator<AgentEventRecord> {
  for (;;) {
    while (this.pending.has(this.nextSeq)) {   // 只吐「连续」的
      yield this.take(this.nextSeq)
      this.nextSeq += 1
    }
    if (this.closed) {
      // 正常路径不会留下空洞；异常兜底：终态后把剩余事件按 seq 升序吐出，避免挂起。
      for (const seq of [...this.pending.keys()].sort((left, right) => left - right)) {
        yield this.pending.get(seq) as AgentEventRecord
      }
      this.pending.clear()
      return
    }
    await new Promise<void>((resolve) => { this.waiter = resolve })
  }
}
```

**这段在干什么**

1. `push` 丢弃 `seq < nextSeq`（已经发过）和重复 seq → **去重**。
2. `push` 对「未来的 seq」先缓存 → 即使 8 先于 6 到达，也不会被提前写出。
3. `drain` 只吐 `nextSeq` → **严格连续升序**；8 要等 6、7 到齐后才吐。
4. `close` 后仍有空洞（写库失败）→ 按 seq 升序兜底吐出，**避免客户端永远等一个不会来的 seq**。

**「二次补重放」补的是什么窗口**

时序（极窄，但真实）：

```
执行器：BEGIN 事务（写 seq 16 run_finished + 更新状态）
服务端 stream：replay 读事件（此时事务还没提交 → 读不到 16）
执行器：COMMIT
服务端 stream：查状态 → 已是 succeeded（终态），但重放里没看到 16
```

如果不补重放，客户端会看到「重放完 1..15，状态已终态，但没收到终态事件」→ 流关闭 → 客户端以为「流断了」，而不是「运行成功结束」。

代码正是为此：

```ts
let terminal = await this.replay(id, lastEventId, stream)
if (!terminal && !closedByListener) {
  const latest = await this.prisma.agentRun.findUnique({ where: { id }, select: { status: true } })
  if (latest !== null && TERMINAL_STATUSES.has(latest.status)) {
    // 补一次重放：覆盖「订阅前写完、首次重放快照之后才提交」的极小窗口
    terminal = await this.replay(id, lastEventId, stream)
    unsubscribe()
    stream.close()
    return stream.drain()
  }
}
```

**这段在干什么**

1. **只在「第一次重放没有终态」且「监听器没关流」时才检查状态**：省掉不必要的一次查询。
2. **只有状态已终态才补重放**：因为终态事务是「事件 + 状态」同事务（§12.9），「状态终态但事件读不到」只能是提交时序造成的；再读一次必然能读到。
3. **补完立刻退订 + 关闭**：状态已终态，不会再有新事件。
4. **若状态还没终态**：什么也不做，实时订阅会送达后续事件——这时绝不该提前关流。

**Python 为什么不需要排序缓冲**

```python
if _status_of(run_id) in TERMINAL_STATUSES:
    # 补一次重放：覆盖「订阅前写完、首次重放快照之后才提交」的极小窗口
    rows, terminal = _read_events(run_id, last_seq)
    for row in rows:
        yield format_agent_sse_frame(row)
    return
while True:
    record = await queue.get()
    if record["seq"] <= last_seq:
        continue
    last_seq = record["seq"]
    yield format_agent_sse_frame(record)
    if is_terminal_agent_event(record["event"]):
        return
```

**这段在干什么**

1. **重放在 `queue.get()` 循环之前完整跑完**：队列里的实时事件不会「插队」到重放中间，所以到达顺序天然是「历史升序 → 实时升序」。
2. **`seq <= last_seq` 直接跳过**：与重复的实时事件去重（重放已经发过）。
3. **`publish` 本身有序**（单写者，`_write_event` 完成才 `publish`）→ 队列里的 seq 也是升序。
4. 所以 Python 只需要「跳过重复」，不需要「缓存未来的 seq」。

> **契约已与实现一致**：`agent-events.md` §4 现在写的就是「**先订阅实时事件、再重放**」，并写明理由——反过来（先重放、再订阅）会在两步之间留下**丢事件窗口**：重放快照读完、订阅尚未建立时写入的事件既不在快照里、也不会被推送。先订阅相当于先把「水位」接上，再用重放补齐历史；两者按 `seq` 排序去重，既不重复也不丢失。客户端看到的仍是「先历史、后实时」，但那是**输出顺序**，不是**执行顺序**。

### 12.8 取消：标记 + 边界检查

**为什么不能「强杀」**

| 做法 | 问题 |
| --- | --- |
| 杀线程 / 杀协程任务 | 语言各异（Node 没有线程可杀）；中途打断可能留下半个事务、半条工具调用；**无法保证**终态事件写进库 |
| 断开 SSE 连接当作取消 | 「读取者走了」不等于「要停」；可能还有别的订阅者；也不能区分「网络断」与「用户取消」 |
| **标记 + 边界检查**（本项目） | 行为确定、可跨语言一致、能在安全点收尾并写终态 |

**机制**

1. `POST /cancel` 只做一件事：把 `cancelRequestedAt` 置为当前时间（如果还是 `null`）。
2. 返回 202 + **当前**状态（可能仍是 `running`）。
3. 执行器在检查点读这一列，非空就抛 `AgentRunCancelled`。
4. 执行器捕获后**只**发一帧 `run_cancelled`，并把状态写 `cancelled`。

```ts
async cancel(ownerId: string, id: string): Promise<CancelAgentRunResponse> {
  const run = await this.findOwned(ownerId, id)
  if (TERMINAL_STATUSES.has(run.status)) {
    throw new BadRequestException('Run is not cancellable')
  }
  if (run.cancelRequestedAt === null) {
    await this.prisma.agentRun.update({ where: { id }, data: { cancelRequestedAt: new Date() } })
  }
  return { id: run.id, status: run.status as CancelAgentRunResponse['status'] }
}
```

**这段在干什么**

1. **先查归属**：不是本人的运行一律 404 `Run not found`（不泄露存在性）。
2. **终态直接 400**：已结束的运行没有「取消」可言；文案固定为 `Run is not cancellable`。
3. **只在 `null` 时写**：重复取消不会刷新时间戳；但因为它仍返回 202（只要没到终态），客户端重试是安全的。
4. **返回 `run.status`（取消前的快照）**：不假装「已取消」，因为取消是异步的。

**检查点在哪**

```ts
for (let index = 0; index < layers.length; index += 1) {
  const layer = layers[index]
  await state.checkCancelled()            // 层边界：开始前
  emit('layer_started', { layer: layer.name, index: index + 1 })
  await this.runLayer(layer, state, emit)
  emit('layer_finished', { layer: layer.name, index: index + 1 })
}
```

**这段在干什么**

每层**开始前**检查一次。层与层之间是天然的「安全点」：`prompt` / `history` / `tools` / `output` 都是纯计算，毫秒级，检查粒度足够。

```ts
const llmAction = async (loop) => {
  await state.checkCancelled()                                  // 调模型前
  const step = await runLlmStep(…)
  await state.checkCancelled()                                  // 模型返回后、使用结果前
  return { … }
}

const toolsAction = async (loop) => {
  await state.checkCancelled()                                  // 这一轮工具开始前
  for (const call of loop.toolCalls) {
    await state.checkCancelled()                                // 每个工具执行前
    …
  }
}
```

**这段在干什么**

1. **LLM 调用前后各一次**：模型调用可能十几秒；取消请求在这期间到达，只能在**调用返回后**生效（不能中途打断 HTTP 流）。
2. **工具轮开始前 + 每个工具前**：一轮可能有多个工具调用，逐个检查，避免「一次取消后还跑完 3 个工具」。
3. **检查点密度是刻意的取舍**：太密 → 每步一次 DB 查询；太疏 → 取消延迟大。本阶段选「层 + 工具轮」，取消延迟上界是「一次 LLM 调用或一次工具执行」。

**取消后只发 `run_cancelled`**

```ts
} catch (error) {
  if (error instanceof AgentRunCancelled) {
    await finish('run_cancelled', { runId }, { status: 'cancelled', finishedAt: new Date() })
    return                                   // ← 关键：直接返回
  }
  const message = error instanceof Error ? error.message : String(error)
  await finish('run_failed', { message }, { status: 'failed', error: message, finishedAt: new Date() })
}
```

**这段在干什么**

1. **`AgentRunCancelled` 分支在前**：否则它会被当成「普通异常」发 `run_failed`，客户端会看到「失败」而不是「已取消」。
2. **`return`**：不再往下走成功分支，因此**不可能**再发 `run_finished`——终态唯一。
3. **`finish('run_cancelled', …)`**：事件与状态在同一个事务里，`finishedAt` 有值，`output` / `error` 都保持 `null`（实测：`output: null`）。

**实测**

```text
SSE 事件里有 run_cancelled，没有 run_finished
GET /agent/runs/{id} → status = cancelled, output = null
再次 POST /cancel    → 400 {"statusCode":400,"message":"Run is not cancellable","error":"Bad Request"}
```

**这段在干什么**

三件事一起证明：取消**替换**了成功终态（不是追加）、状态与事件一致、终态不可再取消。

**取消是协作式的（契约正式语义）**

检查点只在「**每层开始前**」与「**工具轮边界**」（每轮 LLM 调用前后、每个工具执行前）。因此：

- 取消请求**落在最后一层（`output`）之内 / 运行即将完成**：后面没有下一个层边界可检查，执行器会直接走 `run_finished`。**取消成功 ≠ 必现 `run_cancelled`**。
- 取消请求落在某层执行中间：会在**下一层开始前**被发现（`output` 层除外）。
- 取消请求落在 LLM 调用中间：只能在**调用返回后**被发现。

这是协作式取消的固有代价，不是 bug：要彻底消除竞态，只能在每个 `emit` 前后都查一次 DB（写放大），或者改成可中断的流式调用（跨语言语义难统一）。验收时请用「慢调用 + 立刻取消」把窗口拉大（§13.6）。

> **以 SSE 终态为准**：`agent-events.md` §5 已明文写入上面的语义——**客户端应以 SSE 的终态事件（`run_finished` / `run_failed` / `run_cancelled`）判断运行如何结束**，而不是以 `202` 响应或 `GET /agent/runs/{id}` 的中间状态为准。只要最终发出的是 `run_cancelled`，就不会再有 `run_finished` / `run_failed`（终态唯一不变）。

### 12.9 终态唯一：三选一 + 同事务

**三个终态事件**

`run_finished` / `run_failed` / `run_cancelled`，**恰好一个**。这不是「风格」，而是客户端状态机的输入：

- 收到 `run_finished` → 展示结果，停止；
- 收到 `run_failed` → 展示错误，停止；
- 收到 `run_cancelled` → 展示「已取消」，停止；
- **没收到终态就断流** → 无法判断是「网络问题」还是「服务端崩了」。

**怎么保证唯一**

1. **执行路径上只有一个终态出口**：`try` 的成功分支发 `run_finished`；`catch` 的取消分支发 `run_cancelled` 并 `return`；`catch` 的其他分支发 `run_failed`。
2. **`finish` 只被调用一次**（每个分支一次，且取消分支立即 `return`）。
3. **终态之后 `stream` 关闭**：监听器收到终态就 `close()`，`drain` 吐完剩余即结束。
4. **状态与事件同事务**：避免「状态已终态、终态事件没有」。

**为什么必须同事务**

```ts
await this.prisma.$transaction([
  this.prisma.agentRunEvent.create({ data: { runId, seq, event, data } }),
  this.prisma.agentRun.update({ where: { id: runId }, data: update }),
])
```

**这段在干什么**

两条写操作要么都提交、要么都不提交。它消除两个空窗：

| 错误顺序 | 客户端会看到 |
| --- | --- |
| 先更新状态、后写事件（两个事务） | `GET` 已 `succeeded`，但事件流没有 `run_finished` → 客户端以为流断了 |
| 先写事件、后更新状态（两个事务） | 客户端收到 `run_finished`，立刻 `GET` 却还是 `running` / `output: null` → 结果「还没准备好」 |

这与阶段 9 的「**副作用先做完再发 `run_finished`**」是同一条原则：**终态事件是一个承诺——看到它时，库里的终值已经就位**。

**终态事件之后不再有事件**

`run_queued` 到终态之间是完整的层序列；终态之后监听器 `close()`、执行器也退出，不会再 `emit`。如果有人手滑在 `finish` 之后又 `emit`，`seq` 会继续涨，但 `AgentEventStream` 已经 `closed`，客户端只会看到「终态后多出事件」——这是必须靠代码审阅避免的，数据库不管。

### 12.10 已知边界：进程重启不续跑；跨进程不推送

**边界一：进程重启不会自动续跑**

执行器是**进程内后台任务**：

```ts
void this.execute(run.id)               // api-ts：Node 事件循环里的 Promise
```
```python
asyncio.create_task(self._execute_safely(run_id))   # api-py：asyncio 任务
```

**这段在干什么**

两端都只把执行「挂在当前进程的事件循环上」：没有外部队列、没有租约、没有 worker 身份。所以进程一死，任务就没了——**不存在任何别的进程知道这次运行还没跑完**。

进程退出（崩溃、`Ctrl+C`、`--watch` / `--reload` 重启、部署滚动）时：

| 事实 | 结果 |
| --- | --- |
| 任务随进程消失 | 状态可能永远停在 `queued` / `running` |
| 已写入的事件仍在库里 | 可以重放**重启之前**的过程 |
| 没有续跑机制 | 不会有人接着写 seq N+1；也不会补发终态 |

于是「重启后打开事件流」会看到：重放完库里所有事件 → 状态不是终态 → **一直等**（SSE 连接挂着，不会有新事件）。这不是 bug，是本阶段明确不做的事。

**为什么不做**

| 需要的机制 | 复杂度 |
| --- | --- |
| 外部队列 / 任务租约（worker 心跳、超时接管） | 引入新基础设施（Redis / MQ） |
| 幂等执行 | 工具可能有副作用（`http_get` 还好，真实系统可能是下单） |
| 断点续跑 | 需要 checkpoint（消息数组、轮次、层下标） |
| 两端一致 | TS 与 Python 各实现一套，契约要扩 | 

教学的优先级是「**先把 Run 模型与事件重放做对**」；恢复是另一个功能。

**边界二：订阅表在内存里 → 执行与订阅必须同进程**

`AgentEventEmitter.subscribers` 是进程内 `Map`，Python 是进程级单例 `dict`。这意味着：

```
负载均衡后面有两个实例：
  POST /agent/runs        → 落到实例 A（A 里开始执行）
  GET  /agent/runs/{id}/events → 落到实例 B
  B：重放库里已有事件（可能只有 seq 1..3），然后 await queue.get() —— **永远等不到** A 的 publish
```

客户端看到「流走到一半停住」。**本阶段按单进程部署使用**；要做水平扩展，必须把实时通道换成外部 broker（Redis pub/sub、NATS 等），或退化成「轮询 DB」。这一点也是「双通道」设计的固有代价：**持久化通道跨进程，实时通道不跨进程**。

**边界三：执行期失败没有调用方**

`execute` 吞掉所有异常（`catch {}` / `except Exception: pass`）。如果 **DB 本身彻底不可用**，连 `run_failed` 都写不进去，运行会停在 `running`。代码注释已明说：「DB 彻底不可用时无法记录任何事件；不向外抛（运行保持原状态，可重查）」。这是最后的兜底，不是正常路径。

### 12.11 两端对照

| 事实 | api-ts（NestJS + Prisma） | api-py（FastAPI + SQLAlchemy） |
| --- | --- | --- |
| 受理的原子性 | 交互式 `$transaction`（**同事务**） | 一个 `session.begin()` 事务 |
| 后台执行 | `void this.execute(id)`（Promise） | `asyncio.create_task` + 全局 `set` 防 GC |
| 事件回调形态 | `emit` **同步**（token 回调不能 await） | `emit` **async**，调用方 await |
| 写库顺序 | 串行 `writer.chain`（Promise 链） | 协程内联顺序执行 |
| 写失败记录 | `writer.failure`，`finish` 时抛出 | 异常直接冒泡到 `_execute_run` 的 `catch` |
| 订阅表 | `Map<runId, Set<listener>>` | `dict[run_id, set[Queue]]` |
| 单请求流 | `AgentEventStream`（排序 + 去重缓冲） | 生成器 + `last_seq`（跳过重复即可） |
| 重放查询 | `findMany({ seq: { gt } }, orderBy asc)` | `select(...).where(seq > x).order_by(seq.asc())` |
| 二次补重放 | 有（状态终态时再读一次） | 有（同条件） |
| 终态同事务 | `$transaction([create, update])` | `_write_terminal` 的单个 `session.begin()` |
| 取消检查 | `assertNotCancelled`（每层前 / LLM 前后 / 每工具前） | `_assert_not_cancelled`（同位置） |
| `Last-Event-ID` 上界 | `Number.isSafeInteger`（`2^53-1`） | 显式 `_MAX_SAFE_INTEGER = 2**53 - 1` |
| 时间输出 | `Date.toISOString()` | `iso_z()`（阶段 2 已收口） |
| 级联删除 | `onDelete: Cascade` | `passive_deletes=True`，交给数据库 |

> **两端同事务**：TS 用交互式 `$transaction(async (tx) => …)`（因为事件要引用刚建出的 run 的 `id`），Python 用 `session.begin()`。写法不同、不变量相同（§12.3）。

---

## 13. 验收自测

> 前提：`mini-dify-db` 为 `healthy`；两端已启动；`pnpm run build:contract` 已成功；mock LLM 已启动且两端 `.env` 指向它；已注册 / 登录。
> PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请写 **`curl.exe`**。
> 所有 JSON 请求体必须是 **UTF-8 无 BOM**。

### 13.1 准备账号与「写 UTF-8 无 BOM 文件」的函数

```powershell
# 仓库根
curl.exe -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3001/auth/register `
  -H 'Content-Type: application/json' -d '{"email":"agent@example.com","password":"secret123"}'

$TOKEN = (curl.exe -s -X POST http://127.0.0.1:3001/auth/login `
  -H 'Content-Type: application/json' -d '{"email":"agent@example.com","password":"secret123"}' `
  | ConvertFrom-Json).accessToken

function Write-Utf8([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

"token length = $($TOKEN.Length)"
```

**预期**：`token length` > 100。

**这段在干什么**

用一条注册命令（已注册时返回 409，可忽略）+ 登录拿 JWT；`Write-Utf8` 是阶段 10 留下的老办法，避免 PowerShell 写出的 JSON 带 BOM 导致后端 400。

### 13.2 写一份 5 层 composition，并包成请求体

```powershell
Write-Utf8 "$PWD\composition.json" '{"version":"1","layers":[{"name":"history","config":{}},{"name":"prompt","config":{"system":"You are a test agent.","template":"Answer this: {{ input }}"}},{"name":"tools","config":{"names":["calculator"]}},{"name":"llm","config":{"model":"mock-model","maxRounds":5}},{"name":"output","config":{}}]}'
Get-Content composition.json -Encoding UTF8 -Raw | ConvertFrom-Json | Select-Object -ExpandProperty layers | Select-Object name

# 请求体是 {input, composition}：把 composition 原样嵌进去
$COMP = Get-Content composition.json -Encoding UTF8 -Raw
$BODY = '{"input":"Hello mini-dify","composition":' + $COMP + '}'
Write-Utf8 "$PWD\body.json" $BODY
```

**预期**

```text
history
prompt
tools
llm
output
```

**这段在干什么**

构造最小但完整的 5 层组合：`history`（不压缩）→ `prompt`（带 system + 模板）→ `tools`（声明可用工具）→ `llm`（ReAct）→ `output`（取最后一条 assistant）。层名顺序会在事件流里原样体现为 `index 1..5`。`composition.json` 单独存一份便于复用；真正的请求体是 `body.json`——**`POST /agent/runs` 要的是 `{input, composition}`**，直接把 composition 发过去会 400（缺 `input`）。

### 13.3 受理：202 + 立刻订阅

```powershell
$RESP_CODE = curl.exe -s -D headers.txt -o run.json -w '%{http_code}' -X POST http://127.0.0.1:3001/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  --data-binary '@body.json'
$RUN_ID = (Get-Content run.json -Encoding UTF8 | ConvertFrom-Json).id
Select-String headers.txt -Pattern '^HTTP/' | ForEach-Object { $_.Line }
"http_code = $RESP_CODE"
Get-Content run.json -Encoding UTF8
$RUN_ID
```

**预期**

```text
HTTP/1.1 202 Accepted
{"id":"...","status":"queued"}
```

**这段在干什么**

一次请求同时验证「状态码是 202」与「响应体只有 `id` / `status` 且 `status` 恒为 `queued`」。`$RUN_ID` 是后续所有步骤的键。

**立刻订阅（在同一个脚本里接着跑）**

```powershell
curl.exe -sN "http://127.0.0.1:3001/agent/runs/$RUN_ID/events" `
  -H "Authorization: Bearer $TOKEN" -o events.txt

# 取出所有 id
$IDS = Select-String -Path events.txt -Pattern '^id: ' | ForEach-Object { $_.Line.Substring(4) }
"ids = $($IDS -join ',')"

# 取出事件名序列
$EVENTS = Select-String -Path events.txt -Pattern '^event: ' | ForEach-Object { $_.Line.Substring(7) }
"events = $($EVENTS -join ' > ')"
```

**预期（实测）**

```text
ids = 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16
events = run_queued > run_started > layer_started > layer_finished > layer_started > layer_finished > layer_started > layer_finished > layer_started > token > token > token > layer_finished > layer_started > layer_finished > run_finished
```

逐层展开是：

```text
id 1   run_queued
id 2   run_started
id 3   layer_started   history  index 1
id 4   layer_finished  history  index 1
id 5   layer_started   prompt   index 2
id 6   layer_finished  prompt   index 2
id 7   layer_started   tools    index 3
id 8   layer_finished  tools    index 3
id 9   layer_started   llm      index 4
id 10  token
id 11  token
id 12  token
id 13  layer_finished  llm      index 4
id 14  layer_started   output   index 5
id 15  layer_finished  output   index 5
id 16  run_finished
```

**这段在干什么**

这是本阶段最重要的一次观测：

1. **首帧是 `run_queued`（id 1）而不是 `run_started`**——证明 202 之后立刻订阅也能从「收据」开始重放（§12.3）。
2. **id 连续 1..16，无跳号无重复**——证明 seq 分配与写库顺序正确（§12.5）。
3. **每层一对 `layer_started` / `layer_finished`**，`output` 层也有——层语义按 `composition.layers` 原样执行。
4. **`token×3`** 是 mock 的分片（每 5 字符一片）决定的；真实模型的片数会不同，但**位置**（`llm` 层内部）固定。

> mock 返回 `token` 的数量取决于 mock 的固定分片与 prompt 长度，不必强求恰好 3 片；**位置与相对顺序**才是验收点。

### 13.4 重放：请求头与查询参数

```powershell
# (a) Last-Event-ID: 5 → 首帧应是 id: 6
curl.exe -sN "http://127.0.0.1:3001/agent/runs/$RUN_ID/events" `
  -H "Authorization: Bearer $TOKEN" -H 'Last-Event-ID: 5' -o replay5.txt
Get-Content replay5.txt -TotalCount 3

# (b) ?lastEventId=13 → 首帧应是 id: 14
curl.exe -sN "http://127.0.0.1:3001/agent/runs/$RUN_ID/events?lastEventId=13" `
  -H "Authorization: Bearer $TOKEN" -o replay13.txt
Get-Content replay13.txt -TotalCount 3
```

**预期（实测）**

```text
# (a)
id: 6
event: layer_finished
data: {"layer":"prompt","index":2}

# (b)
id: 14
event: layer_started
data: {"layer":"output","index":5}
```

> 在另一次**带工具**的运行里实测：`Last-Event-ID: 5` → 首帧 `id: 6`、末帧 `id: 15`（该运行事件总数不同，末帧就是它当时库里的最大 seq）。

**这段在干什么**

一次验证四件事：严格 `>`（不是 `>=`）；升序；请求头优先于查询参数；**重放不重新执行**（id 与事件都来自库，运行早已结束，没有新的 `token`）。

**再验证「头优先」**

```powershell
curl.exe -sN "http://127.0.0.1:3001/agent/runs/$RUN_ID/events?lastEventId=13" `
  -H "Authorization: Bearer $TOKEN" -H 'Last-Event-ID: 5' -o both.txt
Get-Content both.txt -TotalCount 2
```

**预期**：首帧 `id: 6`（头赢）。

**这段在干什么**

同一个请求同时带「头 = 5」和「查询 = 13」：若实现是「查询优先」，首帧会是 14；实测 6，证明**头优先**。这也是浏览器原生重连（只发头）与手工调试（常用查询）能共存的前提。

**「已覆盖终态」→ 零帧**

```powershell
curl.exe -sN "http://127.0.0.1:3001/agent/runs/$RUN_ID/events" `
  -H "Authorization: Bearer $TOKEN" -H 'Last-Event-ID: 16' -o tail.txt
"tail bytes = $((Get-Item tail.txt).Length)"
```

**预期**：`tail bytes = 0`（运行已结束且客户端已收全，服务端直接关流）。

**这段在干什么**

验证协议 §4 的最后一条：`lastEventId` 覆盖终态时**不发任何帧**。客户端应当把「空流正常结束」理解为「我没有漏任何东西」。

### 13.5 工具运行：`tool_call` / `tool_result`

mock LLM 支持在 user 消息里写 `[[call:<tool>:<jsonArgs>]]` 触发工具调用（阶段 5/6 的 mock 约定，本篇只引用）。把 input 写成带标记的文本：

```powershell
Write-Utf8 "$PWD\composition-tool.json" '{"version":"1","layers":[{"name":"prompt","config":{"template":"{{ input }}"}},{"name":"tools","config":{"names":["calculator"]}},{"name":"llm","config":{"model":"mock-model","maxRounds":5}},{"name":"output","config":{}}]}'

$COMP = Get-Content composition-tool.json -Encoding UTF8 -Raw
$BODY = '{"input":"[[call:calculator:{\"expression\":\"2+2\"}]] calculate","composition":' + $COMP + '}'
Write-Utf8 "$PWD\body-tool.json" $BODY
```

**这段在干什么**

`POST /agent/runs` 的请求体是 `{input, composition}` 两个字段，所以不能像 §13.2 那样只发一份 composition 文件；这里把它拼进 `body-tool.json`。`[[call:...]]` 是 mock 的「让模型决定调工具」标记（做法见阶段 5/6 的 mock 篇，本篇只引用）。这份组合比 §13.2 少了 `history` 层，只保留 `prompt / tools / llm / output` 四层，便于把注意力放在工具事件上。

```powershell
$TOOL_RUN = (curl.exe -s -X POST http://127.0.0.1:3001/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  --data-binary '@body-tool.json' | ConvertFrom-Json).id

curl.exe -sN "http://127.0.0.1:3001/agent/runs/$TOOL_RUN/events" `
  -H "Authorization: Bearer $TOKEN" -o tool-events.txt

Select-String -Path tool-events.txt -Pattern '^event: (tool_call|tool_result)$' -Context 0,1
```

**预期（关键行）**

```text
event: tool_call
data: {"toolName":"calculator","args":{"expression":"2+2"},"round":1}
event: tool_result
data: {"toolName":"calculator","result":"4","elapsedMs":0,"round":1}
```

**这段在干什么**

验证 `llm` 层内部的 ReAct 事件：`tool_call` 在工具执行前发、`tool_result` 在执行后发，两者 `round` 相同且从 1 开始；`result` 是**字符串**（契约要求），不是数字。`tool_result` 之后回到 `llm` 再产 token，最后 `run_finished`。

### 13.6 取消：只有 `run_cancelled`，没有 `run_finished`

为了让取消一定来得及，用 mock 的延迟标记让 LLM 调用慢下来：

```powershell
$COMP = Get-Content composition-tool.json -Encoding UTF8 -Raw   # §13.5 生成的四层组合
$BODY = '{"input":"[[mock-delay:3000]] slow","composition":' + $COMP + '}'
# `[[mock-delay:3000]]` 让 mock 的这次响应延迟 3 秒，给取消留出时间窗口
Write-Utf8 "$PWD\body-slow.json" $BODY

$SLOW_RUN = (curl.exe -s -X POST http://127.0.0.1:3001/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  --data-binary '@body-slow.json' | ConvertFrom-Json).id

# 立刻请求取消
curl.exe -s -w '\n%{http_code}\n' -X POST "http://127.0.0.1:3001/agent/runs/$SLOW_RUN/cancel" `
  -H "Authorization: Bearer $TOKEN"

# 收流（从头重放，确保看到全部）
curl.exe -sN "http://127.0.0.1:3001/agent/runs/$SLOW_RUN/events" `
  -H "Authorization: Bearer $TOKEN" -H 'Last-Event-ID: 0' -o cancel-events.txt

Select-String -Path cancel-events.txt -Pattern '^event: ' | ForEach-Object { $_.Line }
"has run_finished = $([bool](Select-String -Path cancel-events.txt -Pattern '^event: run_finished$'))"

# 终值
curl.exe -s "http://127.0.0.1:3001/agent/runs/$SLOW_RUN" `
  -H "Authorization: Bearer $TOKEN" | ConvertFrom-Json | Select-Object status, output, finishedAt

# 再取消 → 400
curl.exe -s -w '\n%{http_code}\n' -X POST "http://127.0.0.1:3001/agent/runs/$SLOW_RUN/cancel" `
  -H "Authorization: Bearer $TOKEN"
```

**预期（实测）**

```text
{"id":"...","status":"running"}

202

event: run_queued
event: run_started
event: layer_started
…
event: run_cancelled

has run_finished = False

status    output finishedAt
cancelled       2026-10-24T...Z

400
{"statusCode":400,"message":"Run is not cancellable","error":"Bad Request"}
```

**这段在干什么**

1. **取消返回 202 + `running`**：证明「取消只是登记」，不是「已取消」。
2. **事件流里有 `run_cancelled`、没有 `run_finished`**：终态唯一，取消**替换**成功终态。
3. **`output` 是 `null`**、`finishedAt` 非空：状态机与终值一致（§12.2 的表）。
4. **再取消 400**：终态不可取消。

> 如果运行在取消到达前就跑完了，第一步会返回 400 `Run is not cancellable`。把 `[[mock-delay:3000]]` 调大（如 `10000`）或减少层数可以让时序更稳定。
>
> 本节之所以能稳定看到 `run_cancelled`，是因为**刻意制造了一个慢调用窗口**。反过来，若取消到达时运行已进入最后一层 / 即将完成，仍可能以 `run_finished` 结束——这是契约写明的协作式语义（§12.8）：**取消成功 ≠ 必现 `run_cancelled`，一律以 SSE 终态事件为准**。

### 13.7 错误：404 与 400（都是普通 JSON）

```powershell
# (a) 不存在的运行 → 404 Run not found
curl.exe -s -o err.json -w '%{http_code}\n' "http://127.0.0.1:3001/agent/runs/00000000-0000-0000-0000-000000000000/events" `
  -H "Authorization: Bearer $TOKEN"
Get-Content err.json -Encoding UTF8

# (b) 非法 Last-Event-ID → 400 invalid Last-Event-ID
curl.exe -s -o err.json -w '%{http_code}\n' "http://127.0.0.1:3001/agent/runs/$RUN_ID/events" `
  -H "Authorization: Bearer $TOKEN" -H 'Last-Event-ID: abc'
Get-Content err.json -Encoding UTF8

# (c) composition 缺 llm 层 → 400（不创建运行）
Write-Utf8 "$PWD\body-bad.json" '{"input":"hi","composition":{"version":"1","layers":[{"name":"output","config":{}}]}}'
curl.exe -s -o err.json -w '%{http_code}\n' -X POST http://127.0.0.1:3001/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary '@body-bad.json'
Get-Content err.json -Encoding UTF8
```

**预期（实测）**

```text
404
{"statusCode":404,"message":"Run not found","error":"Not Found"}

400
{"statusCode":400,"message":"invalid Last-Event-ID","error":"Bad Request"}

400
{"statusCode":400,"message":"composition must contain exactly one llm layer","error":"Bad Request"}
```

**这段在干什么**

三条覆盖「资源不存在 / 请求格式非法 / 业务校验失败」，并确认它们都是 `ErrorResponse` 形状的**普通 JSON**——**不是** SSE 流。注意 `curl` 没有拿到 `text/event-stream`，说明错误发生在写响应头之前。

### 13.8 数据库自检

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "select run_id, seq, event from agent_run_events where run_id = '$RUN_ID' order by seq;"

docker exec -i mini-dify-db psql -U postgres -d minidify -c "select count(*) as events, min(seq) as min_seq, max(seq) as max_seq from agent_run_events where run_id = '$RUN_ID';"

docker exec -i mini-dify-db psql -U postgres -d minidify -c "\di chunks_embedding_hnsw"
```

**预期**

```text
                 run_id                 | seq |     event
----------------------------------------+-----+----------------
 a0f4c0e2-...                           |   1 | run_queued
 a0f4c0e2-...                           |   2 | run_started
 a0f4c0e2-...                           |   3 | layer_started
 …
 a0f4c0e2-...                           |  16 | run_finished

 events | min_seq | max_seq
--------+---------+---------
     16 |       1 |      16

 public | chunks_embedding_hnsw | index | postgres
```

**这段在干什么**

1. 事件的 `seq` 与 SSE 帧的 `id:` **一一对应**（同一条流，两种载体）。
2. `count = max_seq`、`min_seq = 1`：**没有跳号**。若 `count != max_seq`，说明中间丢了一条（写库失败留下的空洞）。
3. HNSW 索引仍在：迁移没有误删阶段 7 的资产。

### 13.9 两端一致：同一份 composition 在 8000 上再跑一次

```powershell
$PY_RUN = (curl.exe -s -X POST http://127.0.0.1:8000/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  --data-binary '@body.json' | ConvertFrom-Json).id

curl.exe -sN "http://127.0.0.1:8000/agent/runs/$PY_RUN/events" `
  -H "Authorization: Bearer $TOKEN" -o events-py.txt

$IDS_TS = (Select-String -Path events.txt -Pattern '^id: ' | ForEach-Object { $_.Line }) -join "`n"
$IDS_PY = (Select-String -Path events-py.txt -Pattern '^id: ' | ForEach-Object { $_.Line }) -join "`n"
"ids identical = $($IDS_TS -eq $IDS_PY)"

$EV_TS = (Select-String -Path events.txt -Pattern '^event: ' | ForEach-Object { $_.Line }) -join "`n"
$EV_PY = (Select-String -Path events-py.txt -Pattern '^event: ' | ForEach-Object { $_.Line }) -join "`n"
"events identical = $($EV_TS -eq $EV_PY)"
```

**预期（实测）**

```text
ids identical = True
events identical = True
```

**这段在干什么**

`id` 与事件名序列**逐行**比较。实测两端都是 `ids=1..16` 且事件序列同一串；`data` 里的键顺序允许不同（契约只要求解析后 JSON 相等），所以这里先比 `id` 与 `event` 这两条最严格的结构线。

### 13.10 验收清单

| # | 检查项 | 做法 | 预期 |
| --- | --- | --- | --- |
| 1 | 契约编译 | `pnpm run build:contract` | 无报错 |
| 2 | 版本一致 | `openapi.yaml` / `CONTRACT_VERSION` | 均 `0.11.0` |
| 3 | 5 个操作 | `openapi.yaml` | `create/list/get/cancel/stream` 各一 |
| 4 | 受理 | §13.3 | `202` + `{id,status:"queued"}` |
| 5 | 事件流 | §13.3 | `ids 1..16`、序列固定 |
| 6 | 重放（头） | §13.4 | 首帧 `id: 6` |
| 7 | 重放（查询） | §13.4 | 首帧 `id: 14` |
| 8 | 头优先 | §13.4 | 首帧 `id: 6` |
| 9 | 已覆盖终态 | §13.4 | 0 字节 |
| 10 | 工具事件 | §13.5 | `tool_call` / `tool_result`、`round:1` |
| 11 | 取消 | §13.6 | 有 `run_cancelled`、无 `run_finished` |
| 12 | 取消终值 | §13.6 | `status=cancelled`、`output=null` |
| 13 | 重复取消 | §13.6 | 400 `Run is not cancellable` |
| 14 | 404 | §13.7(a) | `Run not found` |
| 15 | 400 | §13.7(b)(c) | `invalid Last-Event-ID` / `composition must contain exactly one llm layer` |
| 16 | 唯一约束 | §9.3 / §13.8 | `UNIQUE (run_id, seq)` |
| 17 | seq 连续 | §13.8 | `count == max_seq`、`min_seq = 1` |
| 18 | HNSW 索引 | §13.8 | 索引仍在 |
| 19 | 两端一致 | §13.9 | `ids identical = True`、`events identical = True` |

---

## 14. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 用「一个 SSE 长请求跑到底」做 Agent | 60s 左右连接被代理切断；刷新页面运行丢失 | Agent 必须「202 受理 + 独立 GET 订阅」（§12.1） |
| 把 202 当成「运行已完成」 | 客户端直接读响应体里的 `output`，拿到 `undefined` | 202 只表示「已受理」，结果在事件流或 `GET /runs/{id}` |
| `POST /agent/runs` 重试 | 一次请求变成两次运行 | `POST` 不是幂等；重试前先查列表 / 用客户端生成的幂等键（本阶段未做） |
| `run_queued` 不落库 | 202 后立刻订阅，首帧是 `run_started`（id 2），客户端以为丢了一条 | 必须在返回 202 **之前** `await` 写入 seq 1（§12.3） |
| `run_queued` 靠 `publish` 下发 | 首帧偶发缺失 | 受理时没有订阅者；它只应通过**重放**被读到（§12.3） |
| `accept` 两条 INSERT 拆成两个事务 | 极端情况下 run 存在但缺 seq 1，重放从 2 开始 | 两端都已包进事务：TS 交互式 `$transaction`、Py `session.begin()`（§12.3、§12.11） |
| 先推送、后写库 | 断线重连后「收到过的事件消失」；seq 提交乱序 | 必须**先写 `agent_run_events`，再 `publish`**（§12.4） |
| 事件不落库，只推内存 | 运行结束后无法重放；前端刷新就空白 | 持久化通道才是真源；推送只是加速（§12.4） |
| TS 用并行 `INSERT` 写事件 | `seq` 提交顺序与产生顺序不一致，`id:` 乱序 | 单条 `writer.chain` 串行写；先同步占号（§12.4） |
| `seq` 用全局自增 / 时间戳 | 一次运行内不连续，`Last-Event-ID` 没法表达「收到哪」 | 单次运行内从 1 递增，`run_queued` 固定 1（§12.5） |
| `UNIQUE(seq)` 而不是 `UNIQUE(run_id, seq)` | 第二次运行从 1 开始就冲突 | 唯一性必须带 `run_id`（§9、§12.5） |
| 以为有唯一约束就不会跳号 | `count != max_seq` | 唯一只防重复，不保证连续；连续靠单写者 + 兜底（§12.5） |
| `seq` 列用 `TEXT` | `10` 排在 `2` 前面，重放顺序错 | 用 `INTEGER`（§9.2） |
| 先重放、后订阅 | 中间窗口写入的事件**永久丢失** | 必须**先订阅、再重放**（§12.7） |
| 先订阅、后重放但不排序去重 | 重复事件 + `id:` 乱序 | 用 `seq` 缓冲：只吐连续、丢弃重复（§12.7） |
| 不看状态就关流 | 重放到一半没终态也关了，客户端以为「成功结束」 | 只在「重放含终态」或「状态终态 + 二次重放」时关（§12.7） |
| 二次补重放无条件执行 | 每次连接多一次查询；或提前关流 | 只在「第一次重放无终态」且「状态终态」时补（§12.7） |
| 非法 `Last-Event-ID` 当成 0 | 客户端拼错 id 被静默从头重放，重复一大堆 | 400 `invalid Last-Event-ID`，开流前拒绝（§12.6） |
| 先开流再校验 `lastEventId` | 状态码已 200，只能流内报错，语义错 | 先解析、后开流（§12.6、§12.11 的顺序） |
| 用 `>=` 重放 | 客户端重复收到「已经确认收到」的那条 | 严格 `seq > lastEventId`（§12.6） |
| 两端 `Last-Event-ID` 上界不同 | 超大数字 TS 400、Py 接受 | 显式 `2^53-1` 对齐（§11.5） |
| 取消用「杀线程 / 强断连接」 | 状态不确定、终态事件可能没写；Node 没有线程可杀 | 协作式取消：标记 + 边界检查（§12.8） |
| 取消后仍发 `run_finished` | 一次运行两个终态事件，客户端状态错乱 | 取消分支 `finish('run_cancelled')` 后**立即 `return`**（§12.8、§12.9） |
| 把 `cancelRequestedAt` 当成状态 | `GET` 看到 `cancel_requested_at` 非空但 `status` 还是 `running`，以为 bug | 它是**请求标记**；状态只由执行器在收尾时写（§12.2） |
| 取消后立刻 `GET` 期望 `cancelled` | 还显示 `running` | 取消是异步的；等事件流出现 `run_cancelled`（§12.8） |
| 取消已结束的运行 | 期望 202，实际 400 `Run is not cancellable` | 终态不可取消（§12.8） |
| 取消落在最后一层之后 | 明明请求了取消，却收到 `run_finished` | 检查点只在层开始前；最后一层结束后没有下一个边界。用慢调用提前取消（§12.8 的竞态、§13.6） |
| 终态事件与状态更新分两个事务 | 出现「状态已终态、事件没有」或「事件有、状态还是 running」 | 用 `$transaction` / 单个 `session.begin()` 一起提交（§12.9） |
| `run_failed` 时忘了写 `error` | `GET` 的 `error` 为 `null`，排障没线索 | 失败分支把 `run_failed.message` 同时写进 `AgentRun.error`（§12.9） |
| Python 后台任务不持有引用 | 运行「莫名其妙消失」，事件停在半路 | `asyncio.create_task` 的返回值必须放进全局 `set`（§12.1） |
| `execute` 向外抛异常 | 进程里出现 unhandled rejection / 未捕获异常日志 | `execute` / `_execute_safely` 吞掉所有异常（§12.10） |
| 进程重启后期望续跑 | 运行永远停在 `running`，事件流一直等 | 本阶段**不续跑**（§12.10） |
| 用 `--watch` / `--reload` 跑验收 | 改一行代码所有运行中断 | 验收期间关掉热重载，或用不带 reload 的启动方式（§12.10） |
| 多副本部署 | 「A 执行、B 订阅」时流走到一半停住 | 订阅表在内存；本阶段单进程，扩展需外部 broker（§12.10） |
| `AgentEventEmitter` 不是单例 | 执行器 publish 永远没人收 | 两端都必须是进程级单例（Nest provider / Python 模块单例）（§10.5、§11.2） |
| 订阅后忘记退订 | 内存泄漏；终态后继续被 publish | `stream` 的 `finally` / 各分支都 `unsubscribe()`（§10.2、§11.4） |
| 慢客户端 + 无界队列（Py） | 内存涨 | 本阶段可接受；生产要限长 / 丢弃策略（§11.2） |
| 用 `EventSource` 并自动重连 | 收到终态后无限「重连 → 空流 → 再重连」 | 客户端收到终态主动 `close()`；本项目用 `fetch` 手动管理（§12.6） |
| 以为 `EventSource` 会自动带 `Last-Event-ID` | 本项目用 `fetch`，重连后从 0 重放，重复一大堆 | 前端必须自己保存 `id:` 并手动回传（§12.6） |
| `id:` 行丢了（复用了工作流帧函数） | 重放完全失效（客户端没有 id 可回传） | Agent 必须用自己的 `formatAgentSseFrame` / `format_agent_sse_frame`（§10.1、§11.1） |
| 把 202 的 `status` 写成 `running` | 契约 `enum` 只有一个值；客户端逻辑错 | 受理只返回 `queued`（§6.4） |
| Python 侧自建 `agent_runs` 表 | 两套 DDL 冲突 / 列漂移 | Prisma 拥有 DDL，SQLAlchemy 只映射（§9、§11.3） |
| Prisma 迁移顺手删了 HNSW 索引 | 向量检索变慢 / 报错 | 迁移里手工删 `DROP INDEX`；每次 `migrate dev` 后检查（§9.2） |

---

## 15. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 | 登记 |
| --- | --- | --- |
| **Agent 运行的异步受理** | Agent 一次 ReAct 可能分钟级，不能占一个 HTTP 请求（代理超时、刷新即断、无取消入口）。拆成「受理 `POST 202` → 后台执行 → `GET events` 读取」三件事；`202 Accepted` 表达「已接受处理、不保证完成」（对比 200 结果已在、201 资源已可读）；响应体 `{id, status:"queued"}`，`id` 是后续订阅/查询/取消的关联键；读放 `GET` 才能带 `Last-Event-ID` 重放（`POST` 重发会多跑一次） | **首次教学于本篇** |
| **Run 状态机** | `queued → running → succeeded｜failed｜cancelled`；全项目只有三处写状态（accept 的 INSERT、executeRun 开头、finish 的事务），**没有回退边**、没有 `queued → 终态` 直达；`cancelRequestedAt` 是请求标记而非状态；`status` 是普通 TEXT，状态机由代码结构而非 DB 约束保证；各状态的 `startedAt/finishedAt/output/error` 取值是一张可观察的表 | **首次教学于本篇** |
| **`run_queued` 必须落库（且固定 seq 1）** | 202 之后客户端可能**立刻**订阅，而 `run_started` 还没产生；必须先有一条「已受理」事件可重放。写入必须 `await` 在返回 202 之前；它**不 publish**（此时无订阅者），只走重放。它保证 `id` 从 1 连续，使「最大 seq」能表达「收到哪」 | **首次教学于本篇** |
| **双通道：先写 `agent_run_events` 再推订阅者** | 持久化通道（表：有序、可重放、跨进程/重启）与实时通道（进程内 Map/Set 或 Queue：低延迟、只覆盖在线订阅者）。顺序反了 ⇒ 客户端收到过的事件在库里不存在，重连 `seq > N` 永久跳过它；且提交顺序可能与接收顺序不一致（`UNIQUE` 只防重复不防乱序）。TS 因 token 回调不能 await，用**同步占号 + 串行 Promise 链**；Python 用**内联 await**，协程天然串行 | **首次教学于本篇** |
| **`seq`：单次运行内单调 + `UNIQUE(run_id, seq)`** | `run_queued` 固定 1，执行器从 DB 现有最大 seq 续号；单写者 + 串行写入保证号序=产生序=提交序。唯一约束带 `run_id`（不同运行各自从 1 开始），同时是重放查询 `(run_id, seq)` 的索引；它**只保证不重复、不保证连续**。与阶段 9 的 `messages.seq` 同模式，但服务于事件流 | **首次教学于本篇** |
| **`Last-Event-ID` 重放** | 帧固定 `id: <seq>\nevent: <name>\ndata: <单行 JSON>\n\n`；`id` 即 seq。请求头 `Last-Event-ID` **优先**于查询参数 `lastEventId`；都没有按 0（从头）；只推 `seq > N`（严格大于、升序）；已覆盖终态则**零帧关闭**。非负十进制整数之外（含超 `2^53-1`）→ **开流前** 400 `invalid Last-Event-ID`（一旦 200+SSE 就无法改状态码）。原生 `EventSource` 自动带 `Last-Event-ID` 且正常关闭也会重连（终态后需主动 `close()`）；本项目用 `fetch` 故须手动保存/回传 | **首次教学于本篇** |
| **「重放 + 实时」的衔接窗口** | 「先重放后订阅」会在中间窗口永久丢事件；「先订阅后重放」不丢但会重复 + 乱序。本项目：**先订阅 → 重放 → 二次补重放 → 按 seq 缓冲排序去重**。TS `AgentEventStream(nextSeq)` 丢弃 `seq < nextSeq` 与重复、缓存未来 seq、只吐连续；Python 因重放在队列循环前跑完且 publish 有序，只需 `seq <= last_seq` 跳过。二次补重放的条件是「第一次重放无终态且状态已终态」，覆盖「终态事务在两次读之间提交」的窄窗口；`close` 后兜底按 seq 升序吐剩余，避免空洞导致挂起 | **首次教学于本篇** |
| **协作式取消** | `cancelRequestedAt` 标记（时间戳，非布尔/非状态）+ 在**层边界（每层开始前）**与**工具轮边界（LLM 调用前后、每工具前）**检查；检查到即抛专用 `AgentRunCancelled`，执行器只发一帧 `run_cancelled` 并 `return`（**绝不**再发 `run_finished`）；状态写 `cancelled`、`output` 保持 `null`、`finishedAt` 有值。取消是异步的（202 + 当前状态），终态再取消 400 `Run is not cancellable`。**取消成功 ≠ 必现 `run_cancelled`**：取消落在最后一层 / 即将完成时可能仍以 `run_finished` 结束，客户端应以 **SSE 终态事件**为准。不强杀的原因：无法保证终态落库、语言能力不一、可能留下半个事务 | **首次教学于本篇** |
| **终态唯一 + 终态同事务** | `run_finished` / `run_failed` / `run_cancelled` 恰有其一；三条执行路径各一个出口、`finish` 只调一次、取消分支立即 `return`、流收到终态即关。终态事件与状态更新必须**同一事务**（`$transaction` / 单个 `session.begin()`），否则出现「状态终态但事件没写」（流看似断掉）或「事件有但状态/输出还没就位」。与阶段 9「副作用先做完再宣布成功」同一原则：**看到终态事件时终值已就位** | **首次教学于本篇** |
| **进程内执行 / 订阅的边界** | 执行器是 `void execute()` / `asyncio.create_task` 的进程内任务：进程重启后**不会续跑**，状态可能停在 `queued`/`running`；已写事件仍可重放，但流会一直等。无队列/租约/checkpoint/幂等（本阶段明确不做）。订阅表在内存 ⇒ 执行与订阅必须**同进程**；多副本下「A 执行、B 订阅」只能重放历史、拿不到实时。执行期异常被 `catch` 吞掉，DB 彻底不可用时会停在 `running`（注释已声明） | **首次教学于本篇** |
| **事件协议作为唯一真源（Agent 版）** | `packages/contract/agent-events.md` 同时规定帧格式（含 `id:`）、10 种事件与 payload、层语义（history 确定性压缩 / prompt 安全模板 / tools 预校验 / llm ReAct / output 取最后 assistant）、重放与取消；错误文案在 `error-messages.md` §11（16 条 4xx + 1 条流内 + 11 步校验顺序）；4xx 一律普通 JSON（开流前），执行期错误走 `run_failed`（HTTP 200 的流） | **首次教学于本篇** |

> 本阶段后续篇目首次教学、本篇仅引用：各层实现细节（history 压缩、prompt 渲染、tools 注册表复用、llm ReAct、output 规则）、composition 校验器的逐条实现、前端 Agent 控制台与 `id:` 的展示/重连。
>
> 已在前序篇教学、本篇仅引用不重讲：OpenAPI `paths` / `$ref` / `enum` / `additionalProperties` 见 `00-项目初始化/04`；SSE 帧格式、「先校验、后开流」与双通道错误见 `04-执行引擎/01`、`04-执行引擎/05`；`fetch + getReader` 与 `EventSource` 限制见 `04-执行引擎/06`；LangGraph `StateGraph` / 条件边 / 环见 `04-执行引擎/02`、`06-工具调用/02`；工具注册表与错误分类见 `06-工具调用/01`；`seq` 与唯一约束见 `09-会话与记忆/01`；「副作用先做完再宣布成功」见 `09-会话与记忆/02`；Prisma 迁移 / `@@unique` / `@@index` 见 `01-账号与认证/02`、`02-应用管理/02`；SQLAlchemy 映射与迁移所有权见 `01-账号与认证/04`；`JwtAuthGuard` / `@CurrentUser` 见 `01-账号与认证/03`；Pydantic v2 / `ConfigDict` / `iso_z` 见 `00-项目初始化/06`、`02-应用管理/07`；`asyncio.Queue` ↔ 异步生成器见 `04-执行引擎/04`。
