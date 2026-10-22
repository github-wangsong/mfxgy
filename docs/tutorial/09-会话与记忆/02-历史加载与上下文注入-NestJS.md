# 02 · NestJS：历史加载与上下文注入

> 所属：阶段 9 · 会话与记忆
> 本篇覆盖：`EngineService.run()` 的会话分支（**先读历史、再写本轮 user**）、`pool.conversation` 的构造、`run_started` 的可选 `conversationId`、`run_finished` **之前**写 assistant 消息（终态事件唯一）、`llm.useHistory` 的历史前置与 `tool` 角色跳过、`MAX_HISTORY_MESSAGES` 窗口裁剪。
> **本篇首次教学（本阶段的学习核心）：① ⭐「读与写的顺序决定语义」——最初「先写 user → 再读历史」把本轮用户话混进了历史，模型收到两条一模一样的用户消息；这类 bug 不报错、不崩溃，只是模型看到的内容不对；② `pool.conversation` 的 `{id, history, messages}` 形状，以及为什么同时提供「字符串版」与「结构化版」；③ `history` 的逐字节生成规则（`seq` 升序 / `"{role}: {content}"` / `\n` 连接 / 无尾随换行 / 空时 `""`）为什么是契约而不是实现细节；④ `useHistory` 为什么是 LLM 节点的开关，而不是全局行为；⑤ `useHistory` 的注入顺序（历史前置 → 本轮 system → 本轮 user）与 `tool` 角色跳过；⑥ 窗口裁剪 `MAX_HISTORY_MESSAGES` 为什么取「最近 N 条」、为什么用「条数」而不是 token；⑦ assistant 消息的内容规则（单键取字符串 / 多键紧凑 JSON）；⑧ `run_failed` 时不写 assistant；⑨ `useHistory` 缺会话时预检前置 400；⑩ ⭐ **终态事件必须唯一**——副作用（写 assistant）先做完，再发 `run_finished`；写入失败由统一 `catch` 发出**唯一一帧** `run_failed`，绝不能先发成功再追加失败。**
> **不重讲**：变量池与模板解析见 `04-执行引擎/03-节点运行时与变量池.md`；SSE 帧格式与「请求级 400 vs 流内 `run_failed` 的双通道错误」见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；`ChatOpenAI` 与真流式见 `05-LLM节点/02-真实模型调用与流式.md`；ReAct 里「首轮用 `buildInitialMessages`、后续轮沿用节点自己的消息数组」见 `06-工具调用/02-NestJS-ReAct循环与条件边.md`；检索节点的「预检前置」见 `07-知识库RAG/03-NestJS检索与检索节点.md`；模板**拒绝数组下钻**见 `08-分支与循环/02-NestJS条件边与变量聚合.md`；Prisma 的关系建模与迁移见 `01-账号与认证/02-Prisma.md`；会话 CRUD 与 `conversations` / `messages` 两张表的建模见本阶段第 `01` 篇。

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 本篇在阶段 9 的位置

阶段 8 之前，`POST /apps/{id}/run` 是**无状态**的：同一张图、同一组 `inputs`，跑一百次得到一百次相同的结果。模型没有「上一轮」的概念——它的输入只有**本次**渲染出来的 `prompt`。

阶段 9 只加了两样东西，却改变了这个性质：

| 加的东西 | 位置 | 作用 |
| --- | --- | --- |
| 会话与消息两张表 + CRUD | 本阶段第 `01` 篇 | 「对话」这个容器，以及按 `seq` 排好序的消息行 |
| **运行时的上下文注入** | 本篇 | 让一次运行能读到「之前发生过什么」，并把「这一轮说了什么」写回去 |

第二个才是真正的难点：它不是 CRUD，而是**语义**。同一个「读历史 + 写消息」的动作，只因为顺序不同，模型看到的内容就完全不同——而且**不会有任何报错**。

阶段 9 在引擎里只占四处增量，全部集中在 `engine.service.ts` 与 `llm.node.ts`：

| 引擎增量 | 位置 | 本篇小节 |
| --- | --- | --- |
| `run()` 的会话分支（读历史 → 写 user → 构造 `pool.conversation`） | `engine.service.ts` | §5.1、§9 |
| `run_started` 的可选 `conversationId` | `events.ts` | §7 |
| `run_finished` **之前**写 assistant（终态只出现一次） | `engine.service.ts` | §5.3、§15、§16 |
| `llm` 节点的 `useHistory` | `llm.node.ts` | §6、§13、§14 |

**图的形状一点没变**：不新增节点类型、不新增事件（`run_started` 只是多一个可选键）。所有变化都发生在「开口之前」和「收口之时」。

### 0.1 一次运行的完整时序

```
POST /apps/{id}/run   { inputs, conversationId?, userMessage? }
  │
  ├─ ① 应用归属校验 ............................. 404 App not found
  ├─ ② 会话归属校验（ownerId + appId） ........... 404 Conversation not found
  ├─ ③ 图预检（validateGraph + validateNodeData + knowledge）
  │       └─ useHistory 但没带 conversationId ... 400（此时还没有任何副作用）
  ├─ ④ 读历史（不含本轮） ...................... ← 快照点
  ├─ ⑤ 写本轮 user（开流之前） .................. 失败 → 400
  ├─ ⑥ 构造 pool.conversation = { id, history, messages }
  │
  ├─ ⑦ run_started（带 conversationId）→ 执行图 → 各节点事件帧
  ├─ ⑧ 写 assistant（带 runId） ................. 失败 → 抛错，由统一 catch 发唯一一帧 run_failed
  └─ ⑨ run_finished（此时 assistant 已落库）
```

三个位置必须记住：

1. **④ 在 ⑤ 之前**——这是本篇的主线（§9）。
2. **③ 在 ④⑤ 之前**——预检失败时库里一条消息都不该多出来。
3. **⑧ 在 ⑨ 之前**——assistant 的内容来自「已经跑完的结果」，但**写入必须先于终态帧**：先做完副作用，再宣布成功（§16.4）。

---

## 1. 本篇目标

- 能说清「先写 user 再读历史」会让模型收到什么，以及为什么它**不报错**。
- 能画出一条消息从「请求体里的 `userMessage`」到「下一轮模型输入」的完整路径。
- 能解释 `pool.conversation` 为什么同时给 `history`（字符串）和 `messages`（结构化）。
- 能逐条复述 `history` 的生成规则，并说明每一条为什么写进契约。
- 能解释 `MAX_HISTORY_MESSAGES` 为什么必须有、为什么取最近 N 条、为什么按条数裁剪。
- 能说清 `useHistory` 的开关语义、注入顺序，以及 `tool` 角色为什么必须跳过。
- 能说清 assistant 消息的内容规则，以及 `run_failed` 为什么不写。

**验收标准**

1. `pnpm run build:contract` 与 `pnpm --filter @mini-dify/api-ts build` 均通过。
2. 第一轮 `userMessage="hello"`、第二轮 `userMessage="again"` 跑完后，`GET /conversations/{id}/messages` 恰好 **4 条**，`seq` 为 `1..4`（§18.2）。
3. 第二轮 mock provider 实收的 `messages` 恰好 **3 条**，并且 `user` 内容为 `["hello", "Q: again"]`——**本轮不重复**（§18.3）。
4. 用 `{{ conversation.history }}` 做 prompt 时，第二轮拼接出的历史**不含本轮** `again`（§18.4）。
5. 不带会话运行时，`run_started` 的键集合为 `["runId","appId"]`（§18.5）。
6. `useHistory: true` 但请求不带 `conversationId` → 开流前 400 `llm node llm1 useHistory requires a conversation`（§18.6）。
7. 同一张图、同一组输入与同一会话序列，两套后端逐帧一致（§18.7）。

---

## 2. 前置条件

- 阶段 4~8 已完成：`engine.service.ts` 能把图编译成 LangGraph 并按事件队列输出 SSE；`llm` 节点支持工具与 ReAct；`condition` / `aggregator` / `iteration` 已就绪。
- 本阶段第 `01` 篇已完成：`openapi.yaml` 里有 `Conversation` / `Message` 模型与 CRUD，`conversations` / `messages` 两张表已迁移（`apps/api-ts/prisma/migrations/20261022140744_add_conversations`）。
- `apps/api-ts/.env` 已能指向 mock LLM（无真实密钥也能跑）：

```dotenv
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=test
LLM_MODEL=mock-model
LLM_TIMEOUT_MS=3000
```

- 可选：`MAX_HISTORY_MESSAGES=20`（不写就是默认 20）。

---

## 3. 命令清单

> 除特别注明外，命令均在仓库根 `d:\user\my_project\github\mini-dify` 执行。Windows PowerShell 的续行符是反引号 `` ` ``。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 编译契约（`Conversation` / `Message` / `RunRequest` / `useHistory`） | 无报错 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 编译 NestJS（会话服务、引擎增量） | 无报错 |
| `node tools/mock-llm/server.mjs` | 仓库根（**另开终端**） | 起 mock provider，并**打印实收 messages**（自测用，见 §18.3） | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| `pnpm --filter @mini-dify/api-ts start:dev` | 仓库根 | 启动 api-ts | 监听 `http://localhost:3001` |
| `curl.exe -N -X POST .../apps/{id}/run` | 任一端 | 逐帧看带会话的运行 | `run_started` 带 `conversationId` |
| `curl.exe .../conversations/{id}/messages` | 任一端 | 核对落库的 4 条消息与 `seq` | `items` 长度 4，`seq` 1..4 |

---

## 4. 完整代码：`conversations.service.ts`

会话 CRUD（`list` / `create` / `get` / `remove` / `listMessages`）属于第 `01` 篇的范围。本篇只关心这个文件里**给引擎用**的四块：`assertOwnedByApp`、`appendMessage`、`loadHistory`、`buildConversationContext`（以及 `maxHistoryMessages`）。为了完整性，仍给出整个文件。

**完整文件路径：`apps/api-ts/src/conversations/conversations.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  ConversationListResponse,
  ConversationResponse,
  MessageListResponse,
  MessageResponse,
} from '@mini-dify/contract'

import { PrismaService } from '../prisma/prisma.service'

/** 会话标题长度上限（字符数）。 */
const MAX_TITLE_LENGTH = 120

/** 历史消息默认条数（可由环境变量 `MAX_HISTORY_MESSAGES` 覆盖）。 */
const DEFAULT_MAX_HISTORY_MESSAGES = 20

/** `appendMessage` 遇到唯一约束冲突时的重试次数（并发写同一会话时的兜底）。 */
const APPEND_MESSAGE_RETRIES = 3

/** `pool.conversation` 的形状（见 sse-events.md §4.2）。 */
export interface ConversationContext {
  id: string
  history: string
  messages: Array<{ role: string; content: string }>
}

/**
 * 会话（阶段 9）读写：会话 CRUD + 消息追加 + 历史读取。
 *
 * 归属校验与 `/apps` 一致：查不到、不属于当前用户、或不属于路径中的应用，
 * 一律 404 `Conversation not found`（不泄露存在性）。
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string, appId: string): Promise<ConversationListResponse> {
    await this.assertAppOwned(ownerId, appId)
    const conversations = await this.prisma.conversation.findMany({
      where: { ownerId, appId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    })
    return { items: conversations.map((conversation) => toConversationResponse(conversation)) }
  }

  async create(ownerId: string, appId: string, title?: string): Promise<ConversationResponse> {
    await this.assertAppOwned(ownerId, appId)
    if (title !== undefined && [...title].length > MAX_TITLE_LENGTH) {
      throw new BadRequestException('Conversation title is too long')
    }
    const conversation = await this.prisma.conversation.create({
      data: { ownerId, appId, title },
      include: { _count: { select: { messages: true } } },
    })
    return toConversationResponse(conversation)
  }

  async get(ownerId: string, id: string): Promise<ConversationResponse> {
    return toConversationResponse(await this.findOwned(ownerId, id))
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwned(ownerId, id)
    await this.prisma.conversation.delete({ where: { id } })
  }

  async listMessages(ownerId: string, id: string): Promise<MessageListResponse> {
    await this.findOwned(ownerId, id)
    const messages = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { seq: 'asc' },
    })
    return { items: messages.map((message) => toMessageResponse(message)) }
  }

  /**
   * 引擎侧：按 `ownerId` + `appId` 校验会话归属。
   * 不符时 404 `Conversation not found`（error-messages.md §9）。
   */
  async assertOwnedByApp(ownerId: string, appId: string, id: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id } })
    if (conversation === null || conversation.ownerId !== ownerId || conversation.appId !== appId) {
      throw new NotFoundException('Conversation not found')
    }
  }

  /**
   * 追加一条消息：`seq = max(seq) + 1`（事务内读取；唯一约束 `(conversation_id, seq)`
   * 兜底并发冲突，冲突时重试）。同时刷新会话 `updatedAt`。
   */
  async appendMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    runId?: string,
  ): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const last = await tx.message.findFirst({
            where: { conversationId },
            orderBy: { seq: 'desc' },
            select: { seq: true },
          })
          await tx.message.create({
            data: {
              conversationId,
              role,
              content,
              seq: (last?.seq ?? 0) + 1,
              runId: runId ?? null,
            },
          })
          await tx.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          })
        })
        return
      } catch (error) {
        if (attempt >= APPEND_MESSAGE_RETRIES || !isUniqueViolation(error)) {
          throw error
        }
      }
    }
  }

  /** 读取最近 `limit` 条消息（按 `seq` 升序返回，供 `pool.conversation` 使用）。 */
  async loadHistory(
    conversationId: string,
    limit = maxHistoryMessages(),
  ): Promise<Array<{ role: string; content: string }>> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { seq: 'desc' },
      take: limit,
      select: { role: true, content: true },
    })
    return messages.reverse()
  }

  private async assertAppOwned(ownerId: string, appId: string): Promise<void> {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { ownerId: true },
    })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
  }

  private async findOwned(ownerId: string, id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { _count: { select: { messages: true } } },
    })
    if (conversation === null || conversation.ownerId !== ownerId) {
      throw new NotFoundException('Conversation not found')
    }
    return conversation
  }
}

/** 历史消息条数上限（`MAX_HISTORY_MESSAGES`，默认 20）。 */
export function maxHistoryMessages(): number {
  const raw = Number(process.env.MAX_HISTORY_MESSAGES ?? DEFAULT_MAX_HISTORY_MESSAGES)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_HISTORY_MESSAGES
}

/** 把消息列表构造为 `pool.conversation`（见 sse-events.md §4.2）。 */
export function buildConversationContext(
  id: string,
  messages: Array<{ role: string; content: string }>,
): ConversationContext {
  return {
    id,
    history: messages.map((message) => `${message.role}: ${message.content}`).join('\n'),
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
  }
}

/** Prisma 唯一约束冲突（`P2002`），用于并发追加消息时重试。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

function toConversationResponse(conversation: {
  id: string
  appId: string
  title: string | null
  createdAt: Date
  updatedAt: Date
  _count: { messages: number }
}): ConversationResponse {
  return {
    id: conversation.id,
    appId: conversation.appId,
    title: conversation.title ?? null,
    messageCount: conversation._count.messages,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }
}

function toMessageResponse(message: {
  id: string
  conversationId: string
  role: string
  content: string
  seq: number
  runId: string | null
  createdAt: Date
}): MessageResponse {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role as MessageResponse['role'],
    content: message.content,
    seq: message.seq,
    runId: message.runId ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}
```

### 4.1 `loadHistory`：一次查询要先倒着取、再翻回来

```ts
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { seq: 'desc' },
      take: limit,
      select: { role: true, content: true },
    })
    return messages.reverse()
```

为什么不能写成 `orderBy: { seq: 'asc' }, take: limit`？

- **`asc + take` 取的是最早的 N 条**。SQL 的 `LIMIT` 作用在排序结果的前 N 行；升序的前 N 行就是开头。
- 想要「最近 N 条」，唯一的通用写法是**先按 `desc` 取前 N 行，再在内存里翻回升序**。

两条 `orderBy` 各有各的用途，不要试图用一次排序同时满足：

| 需求 | 排序方向 | 谁需要 |
| --- | --- | --- |
| 决定「取哪 N 条」 | `seq DESC` | `take: limit` |
| 决定「消息在 prompt 里的先后」 | `seq ASC` | `history` / `messages` |

`select` 只取 `role` 与 `content`，是为了让返回值的形状**天生**只有两个键：`seq` / `id` / `runId` / `createdAt` 不会顺手漏进 `pool.conversation.messages`（§10）。

### 4.2 `appendMessage`：`seq` 的并发正确性靠唯一约束，不靠 `SELECT`

```ts
seq: (last?.seq ?? 0) + 1
```

`(conversation_id, seq)` 在 `schema.prisma` 里有 `@@unique`。两个并发请求可能同时读到相同的 `max(seq)`、算出相同的下一个 `seq`；此时**数据库的唯一约束是唯一的仲裁者**：一个成功，另一个抛 `P2002`，`catch` 里重试（最多 3 次）后重新读 `max(seq)`。

这是「读—算—写」的经典竞态，正确做法不是加锁，而是**让写入自身带约束 + 失败重试**。注意它保护的是「`seq` 不重复」，**不是**「对话语义顺序」——两个并发 run 谁先落库谁先占号（§9.6、§20）。

同时它还会刷新会话的 `updatedAt`（`conversation.update`），这样会话列表能按「最近活跃」排序。

### 4.3 `buildConversationContext`：两份表示，一次构造

```ts
  return {
    id,
    history: messages.map((message) => `${message.role}: ${message.content}`).join('\n'),
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
  }
```

两个关键细节：

- `messages` 是**重新构造**的对象（只挑 `role` / `content`），不是把数据库行原样展开；
- `history` 与 `messages` **由同一个数组派生**，所以不可能出现「字符串版和结构化版条数不一致」。

为什么必须同时提供，见 §10；为什么每个字符都要写进契约，见 §11。

### 4.4 `maxHistoryMessages`：读环境变量时的三个坑

```ts
  const raw = Number(process.env.MAX_HISTORY_MESSAGES ?? DEFAULT_MAX_HISTORY_MESSAGES)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_HISTORY_MESSAGES
```

| 情况 | `Number(...)` | 结果 | 说明 |
| --- | --- | --- | --- |
| 未设置 | `20` | `20` | `??` 兜默认值 |
| `"40"` | `40` | `40` | 环境变量永远是字符串 |
| `"abc"` | `NaN` | `20` | `Number.isInteger(NaN) === false` |
| `"0"` / `"-5"` | `0` / `-5` | `20` | 非正数无意义，回退 |
| `"1.5"` | `1.5` | `20` | 不是整数，回退 |

**注意它不是 `parseInt`**：`parseInt("20abc")` 会得到 `20`（静默截断），而 `Number("20abc")` 是 `NaN` → 回退默认值。对于「配置错了就当作没配」的策略，后者更诚实。

---

## 5. 完整代码：`engine.service.ts` 的会话分支

`engine.service.ts` 在阶段 6/8 已完整给出过（见 `06-工具调用/02-NestJS-ReAct循环与条件边.md` §8、`08-分支与循环/02-NestJS条件边与变量聚合.md` §8），这里只列阶段 9 的增量，其余不变。

### 5.1 `run()`：预检 → 读历史 → 写 user → 构造上下文

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`（节选：`run` 方法）**

```ts
  /**
   * 预检并返回 SSE 事件流。
   *
   * 预检失败（草稿为空 / 图不合法 / 节点数据形状非法 / 未知工具 / `useHistory`
   * 缺会话）抛 `BadRequestException`（普通 JSON 400）；归属不符抛 `NotFoundException`
   * （404）。这些都发生在**打开流之前**，故不会污染 SSE 帧。
   *
   * 阶段 9：带 `conversationId` 时先校验归属，再**读取历史（不含本轮）**，
   * 然后写入本轮用户消息，构造 `pool.conversation`。
   * 用户消息写入失败即 400 `failed to persist conversation message`。
   */
  async run(
    ownerId: string,
    appId: string,
    inputs: Record<string, unknown>,
    conversationId?: string,
    userMessage?: string,
  ): Promise<AsyncGenerator<RunEvent>> {
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
    if (conversationId !== undefined) {
      await this.conversations.assertOwnedByApp(ownerId, appId, conversationId)
    }
    if (app.graphJson === null) {
      throw new BadRequestException('Graph is empty')
    }
    const graph = app.graphJson as unknown as Graph
    const errors = [
      ...validateGraph(graph),
      ...validateNodeData(graph, conversationId !== undefined),
      // 预检需要知道 ownerId：其他用户的知识库一律视为不存在（见 error-messages.md §7.2）
      ...(await validateKnowledgeNodes(this.prisma, ownerId, graph)),
    ]
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '))
    }

    let conversation: ConversationContext | undefined
    if (conversationId !== undefined) {
      // 顺序很重要：**先读历史、再写本轮用户消息**。
      // 反过来的话，本轮 user 消息会混进历史，模型会看到「两条相同的用户话」。
      const history = await this.conversations.loadHistory(
        conversationId,
        maxHistoryMessages(),
      )
      if (userMessage !== undefined && userMessage !== '') {
        try {
          await this.conversations.appendMessage(conversationId, 'user', userMessage)
        } catch {
          throw new BadRequestException('failed to persist conversation message')
        }
      }
      conversation = buildConversationContext(conversationId, history)
    }
    return this.execute(appId, graph, inputs, conversation)
  }
```

**九个可读点**：

| 位置 | 做了什么 | 为什么 |
| --- | --- | --- |
| `app === null \|\| app.ownerId !== ownerId` | 应用归属 | 非本人一律 404，不泄露存在性（阶段 2 惯例） |
| `assertOwnedByApp(...)` | 会话归属 | 会话必须**既属于本人、又属于路径里的应用**，否则换一个 `appId` 就能读到别人的会话 |
| `validateNodeData(graph, conversationId !== undefined)` | 把「有没有会话」传给预检 | `useHistory` 是**图**的属性，必须结合**请求**判断（§17） |
| `errors.length > 0` → 400 | 预检前置 | 此时**还没读历史、也没写消息**，失败无副作用 |
| `loadHistory(...)` | 读历史 | ④ 在 ⑤ 之前（§9） |
| `userMessage !== undefined && userMessage !== ''` | 写 user 的门槛 | 空串/缺省不写；「只跑图、不留言」是合法用法 |
| `catch { throw BadRequestException }` | 写失败 → 400 | 开流前的失败必须是普通 JSON，不能是 SSE（双通道错误） |
| `buildConversationContext(conversationId, history)` | 用**历史**（不是 history+本轮）构造 | 本轮 user 由 llm 节点从 `prompt` 里自己渲染，§10 |
| `return this.execute(...)` | 开流 | 直到这一刻才可能产生 `run_started` |

> **`conversationId` 与 `userMessage` 是解耦的两个可选参数**：只给 `conversationId` 不给 `userMessage` 也能运行（历史照读、assistant 照写）；反过来只给 `userMessage` 则完全没用——它只在有会话时被写入。

### 5.2 `execute()`：`run_started` 带上会话 id

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`（节选：`execute` 方法）**

```ts
  /** 写一帧 `run_started`，后台执行图，并把队列里的事件转成异步生成器。 */
  private async *execute(
    appId: string,
    graph: Graph,
    inputs: Record<string, unknown>,
    conversation?: ConversationContext,
  ): AsyncGenerator<RunEvent> {
    const queue = new RunEventQueue()
    const runId = randomUUID()
    queue.emit(runStarted(runId, appId, conversation?.id))
    void this.runGraph(graph, inputs, queue, runId, conversation)
    yield* queue.drain()
  }
```

- `conversation?.id`：有会话传 id，无会话传 `undefined`；由 `runStarted` 决定**要不要这个键**（§7）。
- `void this.runGraph(...)`：后台跑图，`yield* queue.drain()` 负责把队列转成 SSE。这是阶段 4 就定下的「事件队列解耦」结构，阶段 9 没改。

### 5.3 `runGraph()`：注入 `pool.conversation`，并在 `run_finished` 之前写 assistant

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`（节选：`runGraph` 方法）**

```ts
  /** 编译并执行整张图，把过程事件写入队列；结束（成功/失败）后关闭队列。 */
  private async runGraph(
    graph: Graph,
    inputs: Record<string, unknown>,
    queue: RunEventQueue,
    runId: string,
    conversation?: ConversationContext,
  ): Promise<void> {
    const startedAt = Date.now()
    const context: RunContext = { queue, failedNodeId: null, lastOutputs: {} }
    const maxRounds = maxToolRounds()
    // 启用了工具的 llm 节点：别的照旧，这些节点改成「条件边 + 环」
    const toolNodes = graph.nodes.filter((node) => node.type === 'llm' && toolNamesOf(node).length > 0)
    // condition 节点：普通出边改为「按 sourceHandle 分派」的条件边
    const conditionNodes = graph.nodes.filter((node) => node.type === 'condition')
    try {
      const builder = new StateGraph(RunState) as unknown as DynamicStateGraph
      for (const node of graph.nodes) {
        builder.addNode(node.id, this.makeNodeAction(node, context, toolNodes))
      }
      for (const node of toolNodes) {
        builder.addNode(`${node.id}__tools`, this.makeToolsAction(node, context, maxRounds))
      }
      for (const edge of graph.edges) {
        // 启用了工具的 llm 节点改由条件边分派，跳过其普通出边（否则两者冲突）
        if (toolNodes.some((node) => node.id === edge.source)) {
          continue
        }
        // condition 节点的出边按 sourceHandle 分派，同样跳过普通边
        if (conditionNodes.some((node) => node.id === edge.source)) {
          continue
        }
        builder.addEdge(edge.source, edge.target)
      }
      for (const node of toolNodes) {
        // 条件边 + 环：有 tool_calls 走内部工具节点，否则走原图下游（多条下游时取第一条）
        const downstream = firstDownstream(graph, node)
        builder.addConditionalEdges(
          node.id,
          (state: RunStateValue) => ((state.toolCalls[node.id] ?? []).length > 0 ? 'tools' : 'continue'),
          { tools: `${node.id}__tools`, continue: downstream },
        )
        builder.addEdge(`${node.id}__tools`, node.id)
      }
      for (const node of conditionNodes) {
        // 路由读节点写回的 `branches[nodeId]`，mapping 由 precheck 保证每个分支都有目标
        builder.addConditionalEdges(
          node.id,
          (state: RunStateValue) => state.branches[node.id] ?? 'else',
          branchTargets(graph, node),
        )
      }
      const startNode = graph.nodes.find((node) => node.type === 'start') as GraphNode
      builder.addEdge(START, startNode.id)
      for (const node of graph.nodes) {
        if (node.type === 'end') {
          builder.addEdge(node.id, END)
        }
      }
      await builder.compile().invoke(
        {
          pool: conversation === undefined ? { inputs } : { inputs, conversation },
          messages: {},
          rounds: {},
          toolCalls: {},
          branches: {},
        },
        // 每轮工具调用占 2 个 superstep，留足余量避免 LangGraph 的默认 25 步上限先触发；
        // 迭代节点只在节点内部循环（不产生图循环），但仍为节点数留出余量
        { recursionLimit: Math.max(25, maxRounds * 2 + graph.nodes.length * 3 + 20) },
      )
      // 阶段 9：助手消息**必须在 `run_finished` 之前写入**。
      // 若放在终态帧之后，一旦写入失败就会追加一帧 `run_failed` ——
      // 一次运行出现两个终态事件，违反「终态只出现一次」的协议。
      // 放在之前：写入失败直接抛错，由 catch 统一发唯一一帧 `run_failed`。
      if (conversation !== undefined) {
        try {
          await this.conversations.appendMessage(
            conversation.id,
            'assistant',
            assistantContent(context.lastOutputs),
            runId,
          )
        } catch {
          throw new RunError('failed to persist conversation message')
        }
      }
      queue.emit(runFinished(runId, context.lastOutputs, Date.now() - startedAt))
    } catch (error) {
      // `run_failed` 时**不**写助手消息
      queue.emit(runFailed(runId, context.failedNodeId, messageOf(error)))
    } finally {
      queue.close()
    }
  }
```

逐点读：

| 行 | 含义 |
| --- | --- |
| `pool: conversation === undefined ? { inputs } : { inputs, conversation }` | 会话**不是** LangGraph 的 state 通道，只是变量池里的一个键。没有会话时池里**根本没有** `conversation` 这个键（不是 `undefined`、不是 `null`） |
| `appendMessage(..., assistantContent(context.lastOutputs), runId)` 在 `runFinished` 之前 | assistant 的内容来自 `end` 节点写下的 `lastOutputs`，并记录 `runId` 以便追溯；**先落库，再宣布成功** |
| `catch` 里 `throw new RunError(...)` | 写入失败不自己发帧，抛给外层 `catch`；外层只发**一帧** `run_failed`（`nodeId` 为 `null`，因为不归属任何节点）。一次运行只有**一个**终态事件 |
| `queue.emit(runFinished(...))` 在写入之后 | 客户端收到 `run_finished` 时，assistant 消息**已经落库**——此时立刻拉 `messages` 就能看到完整历史 |
| 外层 `catch` 不写 assistant | 图失败时**一条 assistant 都不写**（§16） |
| `finally { queue.close() }` | 无论成败都收束流 |

### 5.4 `validateNodeData` 的 `llm` 分支：`useHistory` 的预检

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`（节选：`validateNodeData` 的 `llm` 分支）**

```ts
    } else if (node.type === 'llm') {
      if (typeof data.prompt !== 'string') {
        errors.push(`llm node ${node.id} prompt must be a string`)
      }
      // §6.1：tools 里每个名字都必须已注册（预检即 400，不等运行时）
      if (Array.isArray(data.tools)) {
        for (const name of data.tools) {
          if (typeof name !== 'string' || !hasTool(name)) {
            errors.push(`llm node ${node.id} references unknown tool: ${String(name)}`)
          }
        }
      }
      // §9：useHistory 需要会话上下文（请求必须带 conversationId）
      if (data.useHistory === true && !hasConversation) {
        errors.push(`llm node ${node.id} useHistory requires a conversation`)
      }
    }
```

`hasConversation` 就是 `conversationId !== undefined`。**只认 `=== true`**：`"true"`、`1`、`"yes"` 都不算启用（§13）。

### 5.5 `assistantContent`：单键取字符串，否则紧凑 JSON

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`（节选：文件末尾的 `assistantContent`）**

```ts
/**
 * 助手消息内容（sse-events.md §4.2）：`outputs` 只有 1 个键时取其字符串值
 * （非字符串按紧凑 JSON 序列化），否则取 `JSON.stringify(outputs)`。
 */
function assistantContent(outputs: Record<string, unknown>): string {
  const keys = Object.keys(outputs)
  if (keys.length === 1) {
    const value = outputs[keys[0]]
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  return JSON.stringify(outputs)
}
```

`JSON.stringify` 默认就是**紧凑**的（没有空格）；Python 侧对应 `js_json_dumps`，两端必须产出同一种分隔符（§15）。

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`（节选：阶段 9 新增的 import）**

```ts
import {
  buildConversationContext,
  ConversationsService,
  maxHistoryMessages,
  type ConversationContext,
} from '../conversations/conversations.service'
```

---

## 6. 完整代码：`llm.node.ts` 的 `useHistory`

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`（节选：`buildInitialMessages` 与 `historyMessages`）**

```ts
/**
 * 构造 `llm` 节点的初始消息。
 *
 * 阶段 9：`data.useHistory === true` 且 `pool.conversation` 存在时，先把会话历史
 * **前置**为真实消息对象（`user`→Human、`assistant`→AI、`system`→System，
 * `tool` 角色跳过），再接本轮的 system（非空时）与渲染后的 `prompt`。
 * 启用工具的节点只在第一轮用它，后续轮次沿用节点自己的消息数组。
 */
export function buildInitialMessages(node: GraphNode, pool: Pool): BaseMessage[] {
  const data = node.data as unknown as LlmNodeData
  const messages: BaseMessage[] = []
  if (data.useHistory === true) {
    messages.push(...historyMessages(pool))
  }
  if (typeof data.system === 'string' && data.system !== '') {
    messages.push(new SystemMessage(data.system))
  }
  messages.push(new HumanMessage(renderTemplate(String(data.prompt), pool)))
  return messages
}

/** 把 `pool.conversation.messages` 转换为 LangChain 消息（`tool` 角色跳过）。 */
function historyMessages(pool: Pool): BaseMessage[] {
  const conversation = pool.conversation
  if (!isPlainObject(conversation) || !Array.isArray(conversation.messages)) {
    return []
  }
  const messages: BaseMessage[] = []
  for (const item of conversation.messages) {
    if (!isPlainObject(item)) {
      continue
    }
    const content = typeof item.content === 'string' ? item.content : String(item.content ?? '')
    if (item.role === 'user') {
      messages.push(new HumanMessage(content))
    } else if (item.role === 'assistant') {
      messages.push(new AIMessage(content))
    } else if (item.role === 'system') {
      messages.push(new SystemMessage(content))
    }
    // `tool` 角色跳过
  }
  return messages
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

文件其余部分（`runLlmStep` / `runLlmNode` / 工具与错误映射）与阶段 5/6 完全一致，本篇不再重复。

**注意 `buildInitialMessages` 的调用点**：未启用工具的 `llm` 节点在 `runLlmNode` 里直接调用它；启用工具的节点在 `makeLlmWithToolsAction` 里**只在首轮**调用（`state.messages[nodeId] === undefined` 时），后续轮次沿用节点自己的消息数组——该数组的首部就是这份带历史的消息（见 `06-工具调用/02-NestJS-ReAct循环与条件边.md` §9）。

---

## 7. 完整代码：`events.ts` 的 `runStarted`

**完整文件路径：`apps/api-ts/src/engine/events.ts`（节选：`runStarted`）**

```ts
/** 构造 `run_started` 事件（无会话时不带 `conversationId` 键）。 */
export function runStarted(runId: string, appId: string, conversationId?: string): RunEvent {
  return conversationId === undefined
    ? { event: 'run_started', data: { runId, appId } }
    : { event: 'run_started', data: { runId, appId, conversationId } }
}
```

**为什么要写成三元表达式，而不是直接 `{ runId, appId, conversationId }`？**

序列化成 JSON 时，`JSON.stringify` 确实会丢掉值为 `undefined` 的键，两种写法产出的帧一样。但**事件的逻辑对象**不一样：

| 写法 | 逻辑对象的键集合 | 单元测试 / 两端比对时 |
| --- | --- | --- |
| 三元（本项目） | 明确二选一 | `Object.keys(data)` 天然是契约规定的集合 |
| 直接带 `undefined` | TS 类型上是三键，运行时是两键 | 依赖「先序列化再比较」，容易在「比较 payload 键集合」这类断言上出现假差异 |

阶段 4 定下的验收方法里就有一项是「**每条事件的 payload 键集合一致**」——那不是比较字符串帧，而是比较事件对象。三元写法让「无会话 → 两键」成为**代码事实**，而不是「JSON 的副作用」。

实测（§18.5）：无会话时 `has conversationId = False`，键集合 `["runId","appId"]`。

Python 侧同理：先建两键字典，有会话才 `data["conversationId"] = ...`。

---

## 8. 完整代码：请求入口（`run.dto.ts`）

**完整文件路径：`apps/api-ts/src/engine/dto/run.dto.ts`**

```ts
import { IsObject, IsString, MaxLength, ValidateIf } from 'class-validator'

/** POST /apps/{id}/run 请求体 —— 对应契约 `RunRequest`。 */
export class RunRequestDto {
  /** 运行输入，键为输入变量名（内部键不校验，原样透传给引擎）。 */
  @IsObject()
  inputs!: Record<string, unknown>

  /**
   * 可选。会话 id；提供时引擎写入用户消息并构造 `pool.conversation`。
   * 用 `ValidateIf` 而非 `IsOptional`：显式传 `null` 视为类型错误（与 FastAPI 一致）。
   */
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  conversationId?: string

  /** 可选。本轮原始用户消息（写入会话时使用），最多 4000 字符。 */
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  userMessage?: string
}
```

`@ValidateIf` 与 `@IsOptional` 的差别值得记住：

- `@IsOptional()` 会把 `null` 也当成「没传」，直接跳过校验；
- 本项目的契约是「键可以省略，但**显式给值就必须是 string**」，所以用 `ValidateIf(value !== undefined)`——`null` 会继续走 `@IsString()` 并失败。这与 FastAPI 侧「注解 `str`、默认 `None`」的效果一致。

`userMessage` 的 4000 字符上限是**单条消息**的上限，与历史窗口（条数）是两回事（§12）。

---

## 9. 【技术教学 · 首次】⭐ 读与写的顺序决定语义

这是本篇唯一一个「写错了也能跑、跑出来的东西还是错的」的地方，也是整个阶段 9 最值得反复讲的一节。

### 9.1 最初的实现：先写 user，再读历史

代码长这样（**错误写法，本项目已修正**）：

```ts
// ❌ 曾经的顺序：先把本轮用户消息落库，再读「历史」
await this.conversations.appendMessage(conversationId, 'user', userMessage) // ① 先写
const history = await this.conversations.loadHistory(conversationId)         // ② 再读
```

看起来非常自然：「先记录用户说了什么，再准备上下文」。但 `loadHistory` 的定义是「**该会话当前已有的消息**」——它不知道「哪一条是本轮刚写的」。于是第 ② 步读回来的列表**必然包含 ①**。

### 9.2 模型实际收到了什么

设第一轮用户问「第一问」、模型答「第一答」；第二轮用户问「第二问」。

**错误顺序**下，第二轮的历史是：

```
[user: 第一问, assistant: 第一答, user: 第二问]
                                        ↑ 本轮 user 混进历史
```

紧接着 `buildInitialMessages` 又把本轮的 `prompt`（渲染后是 `Q: 第二问`）追加为最后一条 user 消息：

```
[user: 第一问, assistant: 第一答, user: 第二问, user: Q: 第二问]
                                                └──────────────┘
                                                本轮用户话出现了两次
```

模型看到的是**连续两条用户发言**：一条是原始问题、一条是带模板前缀的问题。它不会报错，只会「顺着聊」——常见表现是：

- 把问题当成「用户又补充了一遍」，回答里出现复述、道歉、「正如您刚才提到的」；
- 或者干脆只回答后一条，让前一条成为悬空的重复；
- 每次多消耗一整条用户消息的 token，轮数越多越贵。

而且**第一轮就已经错了**：新会话里先把「第一问」写进去，再读历史 → 历史里就有「用户：第一问」，加上本轮 prompt → 模型第一次调用就收到两条用户消息（一条「第一问」、一条「Q: 第一问」），只是没有 assistant 消息时不容易看出来。

### 9.3 正确顺序：先读快照，再写本轮

```ts
// ✅ 本项目：先读历史（此时库里还没有本轮）
const history = await this.conversations.loadHistory(conversationId, maxHistoryMessages())
// 再写本轮用户消息
if (userMessage !== undefined && userMessage !== '') {
  await this.conversations.appendMessage(conversationId, 'user', userMessage)
}
// 用「读到的快照」构造上下文（不是重新查一次）
conversation = buildConversationContext(conversationId, history)
```

第二轮的历史变成：

```
[user: 第一问, assistant: 第一答]
```

加上本轮 prompt：

```
[user: 第一问, assistant: 第一答, user: Q: 第二问]
```

**本轮的 user 恰好一条。** 这就是实测里 `user` 内容为 `["hello","Q: again"]`、没有重复的原因（§18.3）。

### 9.4 这类 bug 的特征：不报错、不崩溃，只是「内容不对」

| 维度 | 表现 |
| --- | --- |
| 异常 | **没有**。两次 DB 操作都成功，LLM 调用也成功 |
| HTTP 状态 | 200，SSE 正常，`run_finished` 正常 |
| 事件序列 | 完全正常，和正确实现**一模一样** |
| 帧格式 | 完全正常 |
| token 流 | 正常，只是内容可能不一样（真模型）／**看起来完全正常**（mock 因为只回显最后一条 user，甚至察觉不到） |
| 唯一能发现的地方 | **模型收到的 `messages` 数组本身** |

所以：

- 按「状态码 / 事件名 / 帧格式」写的测试**全部通过**；
- 用 mock LLM（只回显最后一条 user）时，**输出甚至一模一样**——因为重复的那条在倒数第二位，回显取的是最后一条；
- 一旦换成真模型，行为开始漂移，而这种漂移很难归因（用户会以为「模型今天不太稳定」）。

**结论**：这类 bug 的验收必须**断言模型侧输入**，而不是断言输出。做法见 §9.5。

### 9.5 怎么把它测出来

在 mock provider 里临时打印 `payload.messages` 的 `role` / `content`（只用于自测，不要把日志提交进仓库），然后跑两轮：

```
第 1 轮 userMessage = "hello"（prompt 模板 `Q: {{ inputs.question }}`）
第 2 轮 userMessage = "again"
```

正确实现的第二轮应当**恰好 3 条**：

| # | role | content | 来源 |
| --- | --- | --- | --- |
| 1 | `user` | `hello` | 历史（第一轮落库的**原始** userMessage） |
| 2 | `assistant` | `echo: Q: hello` | 历史（第一轮落库的 assistant） |
| 3 | `user` | `Q: again` | 本轮 `prompt` 渲染结果 |

三条可执行的断言：

1. `messages.length === 3`；
2. `messages.filter(m => m.role === 'user').map(m => m.content)` 深度等于 `["hello","Q: again"]`；
3. 上面这个数组**没有重复元素**（`new Set(...).size === list.length`）。

错误实现会得到 4 条，且第 3、4 条都是 user（`again` 与 `Q: again`）。

> 为什么断言「条数」还不够：如果模板恰好和原始消息一样（`prompt: "{{ inputs.question }}"`），重复的两条 content 会**完全相同**，只数 `user` 的个数仍然能发现（2 个），但如果只比较「最后一条 content」就发现不了。最稳的断言是「**模型侧收到的 user 内容列表**」整体相等。

### 9.6 如果业务上必须「先写」（替代方案与代价）

「先写 user 再执行」有一个正当理由：**用户的话不能丢**。如果进程在执行中途崩了，先落库至少保住了用户输入。如果确实需要这个性质，正确做法不是「写完再读」，而是给历史加一个**上限快照**：

```ts
// 先记下当前最大 seq，写入后再按 seq <= 快照 读取
const cutoff = await maxSeq(conversationId)
await appendMessage(conversationId, 'user', userMessage)
const history = await loadHistoryWhereSeqAtMost(conversationId, cutoff)
```

（`maxSeq` / `loadHistoryWhereSeqAtMost` 是示意名，本项目**没有**实现这条路径。）

代价：

- 多一次查询（拿 `cutoff`）；
- 「历史」的边界从一个**时间点**（读的那一刻）变成一个**数值**（seq），任何绕过该快照的写入路径都会破坏语义；
- 两套后端都要实现同一套 `cutoff` 逻辑，才能保证一致。

本项目选了更简单的「读—写」：历史天然就是「写入前的快照」，不需要额外的过滤条件，也不会出现 off-by-one。

### 9.7 并发下它仍然只是「快照」

正确顺序保证的是「**本轮不混进历史**」，**不保证**「并发运行的另一次也不混进来」：

```
run A: 读历史（空）→ 写 user A → 执行
run B: 读历史（空）→ 写 user B → 执行   ← B 读的时候，A 的 user 已落库但 B 没看到
```

两个 run 各自看到的是「自己读的那一刻」的库。本项目**不做会话级锁**——这是有意的简化：聊天场景下同一会话并发运行本来就不是正常用法；`seq` 的唯一约束只保证编号不冲突，不保证语义顺序。

---

## 10. 【技术教学 · 首次】`pool.conversation` 的形状：两份表示，一个真源

### 10.1 形状

```json
{
  "id": "<conversationId>",
  "history": "user: hello\nassistant: echo: Q: hello",
  "messages": [
    { "role": "user", "content": "hello" },
    { "role": "assistant", "content": "echo: Q: hello" }
  ]
}
```

三个键、三种用途：

| 键 | 谁用 | 怎么用 |
| --- | --- | --- |
| `id` | 模板 / 日志 | `{{ conversation.id }}` |
| `history` | **模板** | `{{ conversation.history }}` 整段塞进 prompt |
| `messages` | **`useHistory`** | 转成 `HumanMessage` / `AIMessage` / `SystemMessage` |

### 10.2 为什么不能只给 `messages`

模板引擎只能做「字符串替换」，而且**明确拒绝数组下钻**（见 `08-分支与循环/02-NestJS条件边与变量聚合.md` §17：`resolvePath` 遇到数组直接判定不可下钻）。所以：

| 写法 | 结果 |
| --- | --- |
| `{{ conversation.messages }}` | 能取到，但会被**紧凑 JSON 序列化**成一整坨 `[{"role":"user",...}]` |
| `{{ conversation.messages.0.content }}` | ❌ 数组段被拒绝 → 路径缺失 → 严格解析 `run_failed` |
| `{{ conversation.history }}` | ✅ 一段人类可读的对话记录 |

也就是说：**只要用户想在 prompt 里使用历史（而不是让 `useHistory` 去拼消息数组），就必须有一份预先摊平的字符串**。

### 10.3 为什么不能只给 `history`

反过来，`history` 是给「人」和「模板」看的，不是给 provider 看的：

- 它的格式是 `role: content`，**不是**任何模型协议；
- 真正的聊天协议需要 `role` 字段、需要 provider 自己的 chat template / 特殊 token；
- 把 `history` 直接当 prompt 丢给模型，等于让它读一份「聊天记录文本」，效果与「真正的多轮消息」并不等价（尤其是 system 位置、assistant 轮次边界）。

所以 `useHistory` 必须用**结构化**的 `messages`，让 LangChain 去负责消息对象的构造与序列化。

### 10.4 为什么放在同一个对象里

1. **同一个真源**：两者在 `buildConversationContext` 里由**同一个数组**派生，条数、顺序、内容不会漂移。如果分成两个接口（一个返回字符串、一个返回数组），就可能出现「历史 20 条、消息 19 条」。
2. **同一个窗口**：`MAX_HISTORY_MESSAGES` 只裁剪一次，两种表示自动一致。
3. **同一个变量池**：`pool.conversation` 是普通数据，模板与节点都能拿到；不需要为它们分别注入。

### 10.5 边界：它**不含本轮**

`conversation` 是用 `history`（写入前的快照）构造的，所以 `messages` 里**没有本轮的 user 消息**。本轮的 user 是由 `llm` 节点从 `prompt` 渲染出来的（§14）。

推论：如果 prompt 只写 `{{ conversation.history }}`、不写 `{{ inputs.question }}`，模型**看不到本轮问题**。实测（§18.4）用的模板是 `H: {{ conversation.history }}`，第二轮模型收到的 user 内容是：

```
H: user: hello
assistant: echo: H: 
```

注意末尾的 `echo: H: ` 是第一轮 assistant 的内容（第一轮 prompt 是 `H: `，mock 加了 `echo: ` 前缀）——历史**只到上一轮为止**，`again` 不在里面。

---

## 11. 【技术教学 · 首次】`history` 的生成规则为什么是契约

### 11.1 一条公式

```
history = messages
  .sort(seq ASC)                              // 时间顺序
  .map(m => `${m.role}: ${m.content}`)        // 角色 + 冒号 + 空格 + 内容
  .join('\n')                                 // 单个换行，无尾随
```

无消息时 `history === ""`。

### 11.2 每一条规则，都对应一个「两端会分叉」的坑

`history` 最终会进入 **prompt 字符串**，而 prompt 会进入 **LLM 请求体**。两套后端只要有一个字符不同，模型收到的输入就不同，token 流就不同，阶段 4 定下的「逐帧一致」验收直接挂掉。所以这些细节不是「代码风格」，而是**契约**：

| 规则 | 如果写错 | 后果 |
| --- | --- | --- |
| **按 `seq` 升序** | 用 `createdAt`、或不排序 | 时间戳可能同毫秒（两轮几乎同时落库）、uuid 是随机的；顺序不稳定 → 对话倒放或随机 |
| **`"{role}: {content}"`（冒号后**一个**空格）** | `role=content` / `[role] content` | 两端 prompt 不同 |
| **分隔符是 `\n`** | Windows 习惯写 `\r\n` | 每条多一个 `\r`，token 不同、字节不同；这是最容易「在 Windows 上开发、在 Linux CI 上挂」的坑 |
| **`join` 不追加尾随换行** | `+ '\n'` 或 `join('\n') + '\n'` | 末尾多一个不可见字符，`{{ conversation.history }}` 后接的内容会多一行 |
| **空时是 `""`** | `null` / `undefined` | 模板会把它渲染成 `"null"`（`stringifyValue` 对 `null` 就是 `"null"`，见阶段 8 §15.4），或路径缺失直接报错 |
| **每项只有 `role` / `content`** | 把数据库行 `...message` 展开 | `seq` / `id` / `runId` 漏进池子，`{{ conversation.messages }}` 的 JSON 会多出键，两端形状不同 |

### 11.3 为什么用 `seq` 而不是 `id` / `createdAt`

- `id` 是 `uuid()`，**字典序与时间无关**；
- `createdAt` 精度是毫秒，同一毫秒内写入两条完全可能（尤其 assistant 与下一轮 user 之间）；
- `seq` 在会话内**唯一且单调**（`@@unique([conversationId, seq])`），是唯一一个「业务上就代表顺序」的列。

### 11.4 边界：`history` 不是可反解析的格式

`content` 本身可以包含换行。如果某条消息的内容是多行文本，`history` 里就会出现：

```
user: 第一行
第二行
assistant: ...
```

这段字符串**无法**可靠地反解回「一条 user 消息」。这正是它只能用于「拼进 prompt」、不能用于「还原消息」的原因——需要结构化时请用 `messages`。

> 一句话：**`history` 是展示用的近似，`messages` 是执行用的真值。**

---

## 12. 【技术教学 · 首次】窗口裁剪：`MAX_HISTORY_MESSAGES`（默认 20）

### 12.1 为什么必须有上限

| 成本 | 不裁剪会发生什么 |
| --- | --- |
| token 成本 | 每轮都要把全部历史塞进请求，第 N 轮的 prompt token ≈ N × 单轮长度，费用与延迟线性上涨 |
| 上下文窗口 | 超过模型上限时，provider 直接报错（映射后是 `llm request failed: 400`），对话越久越容易撞墙 |
| DB / 网络 | 一次 `findMany` 把整个会话读出来，长会话变成大对象来回搬运 |
| 可解释性 | 越久远的内容越可能干扰当前回答 |

### 12.2 为什么取「最近 N 条」而不是「最早 N 条」

聊天的语义是**近因**：最近几轮才决定「现在在聊什么」。最早的寒暄既占 token 又没什么用。

实现上必须「先 `desc` 取 N，再 `reverse()`」（§4.1）。如果写成 `asc + take`，取到的是**最早**的 N 条——一个看起来「按时间排序」但实际取错窗口的经典错误。

### 12.3 为什么按「条数」而不是「token 数」

这是本项目的**有意简化**：

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 按条数（本项目） | 确定、简单、**两端无需 tokenizer** | 一条超长消息就能吃掉整个窗口 |
| 按 token 数 | 精确控制成本 | 需要模型的 tokenizer；TS 与 Python 的库/版本不同，**切出来的边界可能不同** → 两端 prompt 不一致 |

在「双栈同契约、逐帧一致」的目标下，token 级裁剪是**不利于一致性**的：同一段中文，JS 侧与 Python 侧的 token 计数不一定相同，窗口切点就会不同。按条数是两端**必然一致**的裁剪方式。

代价与缓解：

- `userMessage` 单条上限 4000 字符（`run.dto.ts`）；若 20 条全是 4000 字符的 user 消息，就是约 8 万字符的 prompt——对大多数模型仍然偏大。生产环境应调小 `MAX_HISTORY_MESSAGES`，或在 provider 侧再设上限；
- assistant 消息**没有字符上限**（模型输出），所以真实上界取决于模型，比上面的估算更不可控。

### 12.4 一个容易忽略的边界：窗口可能切断「一问一答」

窗口是**按条数**从尾部切的，不保证成对：

- 默认 20 是偶数，恰好能对齐若干对 user/assistant；
- 若把 `MAX_HISTORY_MESSAGES` 设成奇数（比如 5），窗口的第一条可能是 **assistant**，对话从「模型的一句话」开始。

这不会报错，模型也能处理，但语义上有点怪。**要么用偶数，要么在读取后丢掉开头的 assistant 消息**（本项目没做，属于配置自觉）。

### 12.5 读取时机

`maxHistoryMessages()` 在**每次 `run()` 时**被调用（不是模块加载时求值），但 `process.env` 本身是进程启动时确定的。所以改了 `.env` 仍然要**重启服务**才生效。

---

## 13. 【技术教学 · 首次】`useHistory` 为什么是 LLM 节点的开关

### 13.1 开关在哪、默认是什么

```ts
if (data.useHistory === true) {
  messages.push(...historyMessages(pool))
}
```

- 位置：`llm` 节点的 `data` 上（`LlmNodeData.useHistory?: boolean`）；
- 默认：**不启用**（`undefined` 视为 `false`）；
- 判定：**严格等于 `true`**。`"true"`（字符串）、`1`、`"yes"` 一律不启用。

### 13.2 为什么是「节点级」而不是「全局」

同一张图里可能有多个 `llm` 节点，职责完全不同：

| 节点 | 该不该看历史 | 原因 |
| --- | --- | --- |
| 「问题改写」节点 | ❌ 不该 | 它需要把**当前这句**改写成检索查询；塞进历史会让它把上一轮的问题也改写进去 |
| 「最终回答」节点 | ✅ 该 | 它需要延续对话 |
| 「摘要」节点 | 视配置 | 可能只需要当前输入 |

如果引擎**自动**给所有 llm 节点注入历史，第一种节点就被污染了，而且用户无法关掉。节点级开关把选择权交给图作者，与阶段 6「按节点开启工具」、阶段 8「按节点选择安全解析」是同一种设计语言：**能力按节点开启，默认关闭**。

### 13.3 为什么它**不是**「访问控制」

`pool.conversation` 在**任何**带 `conversationId` 的运行里都存在，不管有没有 `useHistory` 节点。也就是说：

- 一个 `knowledge` 节点完全可以在 `query` 里写 `{{ conversation.history }}`，把历史拼进检索语句；
- 一个 `condition` 节点也可以用 `{{ conversation.messages }}`（虽然会被 JSON 序列化）；
- `useHistory` 只决定「**llm 节点要不要把历史当作真正的消息数组**」。

换句话说，它是**协议适配器开关**，不是权限开关。

### 13.4 为什么默认关闭是必须的（向后兼容）

阶段 5~8 的所有验收都是「同一张图、同一组输入 → 同一串 token」。如果阶段 9 一上线就默认注入历史，那么**任何**带 `conversationId` 的请求都会让旧图的行为改变，历史越跑越长，旧验收全部失效。

默认关闭 = 旧图在阶段 9 之后**一字不变**。这也是所有「新增能力」的默认姿势：**新行为必须显式开启**。

### 13.5 无会话时为什么直接 400，而不是「没有历史就当空」

因为「说好要用历史、却没有会话」是**配置/调用错误**，不是运行时状态（§17）。如果降级成空数组，用户会得到一个「看起来正常、但永远没有记忆」的 bot，且没有任何提示——比 400 难查得多。

---

## 14. 【技术教学 · 首次】`useHistory` 的注入顺序与 `tool` 跳过

### 14.1 三段式

```
[ ...历史消息 ]  →  [ 本轮 system（非空时） ]  →  [ 本轮 user（渲染后的 prompt） ]
```

代码（§6）：

```ts
  if (data.useHistory === true) {
    messages.push(...historyMessages(pool))
  }
  if (typeof data.system === 'string' && data.system !== '') {
    messages.push(new SystemMessage(data.system))
  }
  messages.push(new HumanMessage(renderTemplate(String(data.prompt), pool)))
```

### 14.2 为什么历史在最前

- 时间顺序：历史是「已经发生的事」，本轮是「正在发生的事」；消息数组就是时间轴。
- 语义：历史里的 assistant 轮次是在**当时的** system/prompt 下产生的；把它们整体放在前面，模型才能正确理解「这些是过去的对话」。
- 如果把本轮的 system 放在最前、历史放在后面，模型会倾向于用**本轮的指令**去重新解释过去的每一轮，等于篡改了历史。

### 14.3 为什么本轮 system 放在历史**之后**

`data.system` 描述的是「**这个节点这一轮**要做什么」。它只应该约束本轮的输出，而不是给历史里的旧轮次补一条迟到的指令。

所以顺序是「过去 → 本轮指令 → 本轮输入」。这也是「system 可以出现在非首位」的用法；OpenAI 兼容接口接受这种位置，但请注意：**部分 provider / 本地模型对 system 的位置更敏感**，如果换模型后行为漂移，这是第一个要检查的地方。本项目以「语义正确」优先，并把顺序写进契约。

### 14.4 为什么 `system === ''` 不注入

```ts
if (typeof data.system === 'string' && data.system !== '') {
```

空字符串也会生成一条 `SystemMessage("")`——它在请求体里是一个**真实的空 system 消息**，会改变 token 数、也可能改变模型行为（有的模型会因此认为「系统指令为空」）。「没写」和「写了空串」应当等价，所以这里显式跳过。

### 14.5 为什么 `tool` 角色必须跳过

这是本节最硬的技术点。

**OpenAI 协议对 `tool` 消息有结构要求**：一条 `role: "tool"` 的消息必须通过 `tool_call_id` 指向**前面某条 assistant 消息里的 `tool_calls[].id`**；assistant 与 tool 必须成对出现且相邻。缺了配对，请求会被 provider 拒绝（典型错误：`messages with role 'tool' must be a response to a preceding message with 'tool_calls'`）。

而本项目的 `messages` 表只存了：

| 列 | 有吗 |
| --- | --- |
| `role` / `content` / `seq` | ✅ |
| `tool_call_id` | ❌ |
| assistant 的 `tool_calls` 结构 | ❌ |

也就是说：**历史里的工具轨迹是被有损保存的**——只剩「工具返回了什么文本」，丢了「它对应哪次调用」。如果硬把它还原成 `ToolMessage`，要么缺 `tool_call_id`（构造不出来），要么编一个 id（provider 找不到配对的 assistant `tool_calls`）——两者都会让请求失败。

因此唯一正确的做法是**跳过**：历史只保留 user / assistant 的**自然语言**轨迹。工具调用过程本身仍然完整地存在于本次运行的 SSE 事件里（`tool_call` / `tool_result`），只是不进入跨轮记忆。

### 14.6 `role` 的其余取值

```ts
if (item.role === 'user') ...
else if (item.role === 'assistant') ...
else if (item.role === 'system') ...
// `tool` 角色跳过
```

- 未知 role **静默丢弃**（不报错）。这与「历史是外部数据、宁可少一条也不要整轮崩」的取舍一致；
- 契约里 `MessageResponse.role` 的枚举其实只有 `user` / `assistant` / `system`（`openapi.yaml`），**没有** `tool`。但数据库列是自由字符串（Prisma 的 `String`、SQLAlchemy 的 `String`），所以 `tool` 行仍然可能出现（手工写入、未来扩展）。跳过逻辑是**防御性**的，不是当前 API 能产生的数据。
- `content` 非字符串时用 `String(item.content ?? '')` 兜底：字符串原样，其余转字符串。正常路径永远是字符串。

### 14.7 启用工具的 llm 节点：历史只进第一轮

`makeLlmWithToolsAction` 里：

```ts
        const history = firstRound
          ? buildInitialMessages(node, state.pool)
          : (state.messages[nodeId] as BaseMessage[])
```

首轮用「历史 + system + prompt」构造；后续轮次沿用这个数组（再追加 assistant / tool 消息）。所以**历史不会被重复注入**——这正是阶段 6 设计 `messages[nodeId]` 这个状态通道的原因。

---

## 15. 【技术教学 · 首次】assistant 消息的内容规则

### 15.1 规则

```ts
  const keys = Object.keys(outputs)
  if (keys.length === 1) {
    const value = outputs[keys[0]]
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  return JSON.stringify(outputs)
```

| `end` 的 `outputs` | 写入会话的 assistant `content` |
| --- | --- |
| `{ answer: "echo: Q: hello" }` | `echo: Q: hello`（**纯文本**） |
| `{ answer: 42 }` | `42`（单键、非字符串 → `JSON.stringify(42)`） |
| `{ answer: { text: "hi" } }` | `{"text":"hi"}`（紧凑 JSON） |
| `{ answer: "...", source: "kb1" }` | `{"answer":"...","source":"kb1"}`（多键 → 整体紧凑 JSON） |
| `{}`（没有 end / end 无输出） | `{}` |

### 15.2 为什么不能无脑 `JSON.stringify(outputs)`

聊天场景里，`end` 绝大多数是**单个输出**：

```json
{ "outputs": [{ "name": "answer", "value": "{{ llm1.text }}" }] }
```

如果无脑序列化，会话记录会变成：

```
user: 你好
assistant: {"answer":"你好！有什么可以帮你的？"}
user: 帮我写个标题
```

后果是三个层面的：

1. **展示难看**：前端聊天记录里每条 assistant 消息都裹着一层 JSON；
2. **下一轮污染**：这条 JSON 会被 `useHistory` 原样作为 `AIMessage` 喂回去，模型会认为「我上一轮说的是一个 JSON 对象」，于是开始模仿输出 JSON——一种**自我强化的格式漂移**；
3. **多语言/转义**：`\n`、引号都会被转义，模型看到的是转义后的文本。

所以「单键 → 取字符串」是为了让**会话记录像人话**。

### 15.3 为什么单键且值是对象时仍要 JSON

因为「单键」不等于「值是文本」。`{ answer: { text: "hi" } }` 没有别的办法表示，`JSON.stringify` 至少是**无损**的。规则可以概括为：

> **能还原成人话就还原（单键 + 字符串）；否则保持结构化（紧凑 JSON）。**

### 15.4 为什么多键不「挑一个」

多键时没有**唯一的**主答案：`{ answer, source }` 里 `source` 是引用、`answer` 是正文，但引擎无法知道哪个是正文。随便挑会丢信息；全部拼接又需要分隔符（又是跨语言一致性问题）。紧凑 JSON 是最保守、最可逆的选择——需要展示时前端可以自己解析。

### 15.5 为什么必须是「紧凑」JSON

`JSON.stringify` 默认不加空格；Python 侧必须用 `js_json_dumps`（`separators=(",", ":")`）才能产出同样的字符串。如果 Python 用了默认的 `json.dumps`（`{"answer": "..."}` 带空格），同一张图在两端的会话记录就会**逐字节不同**，下一轮 prompt 也不同。

### 15.6 `runId` 记录在行上，内容不在行里

assistant 行会写 `runId`（`appendMessage(..., 'assistant', ..., runId)`），user 行不写（`null`）。这意味着：

- 任何一条 assistant 消息都能追溯到那次运行；
- 但完整输出（含 `usage`、多字段）**只存在**于那次运行的 `node_finished` / `run_finished` 事件里，会话表只留一个「摘要」。

---

## 16. 【技术教学 · 首次】`run_failed` 时不写 assistant

### 16.1 代码

```ts
    } catch (error) {
      // `run_failed` 时**不**写助手消息
      queue.emit(runFailed(runId, context.failedNodeId, messageOf(error)))
    } finally {
      queue.close()
    }
```

成功路径的 `appendMessage(..., 'assistant', ...)` 在 `try` 里、`run_finished` **之前**；一旦图执行抛错，直接跳到 `catch`，那行 assistant 写入**根本不会执行**。

### 16.2 为什么

| 理由 | 说明 |
| --- | --- |
| 没有「答案」可写 | 失败发生在某个节点，`context.lastOutputs` 可能是 `{}`（还没走到 `end`），写进去就是一条 `"{}"` 的假回答 |
| 会伪造历史 | 下一轮模型会看到「自己上一轮说了 `{}`」，比没有记忆更糟 |
| 「问而未答」是真实状态 | 会话里留一条 user、没有 assistant，如实反映「用户问了，但这轮没答上」——UI 可以显示一个失败标记并允许重试 |
| 错误不是对话内容 | 失败原因属于**传输层**（`run_failed.message`），不属于「模型说的话」。把它写成 assistant 会污染语义 |
| 两端一致 | Python 侧同样只在成功路径写 assistant |

### 16.3 副作用：悬空的 user 会留在历史里

第二轮（重试）读历史时，会读到那条「问了但没答」的 user 消息。这其实**是好事**：

```
history = [user: 第一问, assistant: 第一答, user: 第二问]   ← 第二问失败，没有 assistant
```

模型会看到「用户问了一句，但对话没有推进」，重试时更可能正面回答，而不是假装已经答过。

### 16.4 另一种失败：assistant 写入失败（已修复：终态只出现一次）

**曾经的实现（错误）**：assistant 写入放在 `run_finished` 帧**发出之后**，写入失败时再追加一帧 `run_failed`。结果一次运行出现**两个终态事件**：

```
event: run_finished
data: {"runId":"...","outputs":{...},"elapsedMs":...}

event: run_failed
data: {"runId":"...","nodeId":null,"message":"failed to persist conversation message"}
```

这违反 SSE 协议约束「**终态事件必须唯一**」：客户端无法判断这轮到底成功还是失败——先收到成功、随后又收到失败；以第一个终态为准会漏掉持久化失败，以最后一个为准又会把已经展示的回答判为失败。

**现在的实现（正确）**：assistant 写入移到 `run_finished` **之前**，失败直接 `throw new RunError('failed to persist conversation message')`，由外层 `catch` 统一发**唯一一帧** `run_failed`：

```
event: run_failed
data: {"runId":"...","nodeId":null,"message":"failed to persist conversation message"}
```

此时流里**没有** `run_finished`，终态恰好一个。`nodeId` 仍是 `null`——失败不属于任何节点，属于「收口阶段」。

这条修复的教学价值在于一条通用规则：**副作用先做完，再宣布成功**。把「写库」放在「成功帧」之后，等于让成功与失败同时出现；放在之前，失败就自然归入唯一的失败终态。附带的语义变化是：**`run_finished` 到达时 assistant 消息已经落库**，客户端此刻立刻拉 `messages` 就能看到完整历史，不必再等。

---

## 17. 【技术教学 · 首次】预检前置：`useHistory` 无会话 → 400

### 17.1 代码位置

- 引擎侧：`validateNodeData(graph, conversationId !== undefined)`（§5.1）；
- 文案：`llm node {nodeId} useHistory requires a conversation`（`error-messages.md` §9）。

### 17.2 为什么不能等运行到那个节点

| 问题 | 如果运行到一半才失败 |
| --- | --- |
| 响应形态 | 已经 `flushHeaders()`，只能发 `run_failed`（200 + SSE），客户端要用两套错误处理 |
| 副作用 | 此时**本轮 user 消息已经写进库**（§5.1 的 ⑤ 在 ⑦ 之前）→ 会话里多出一条永远不会有回答的用户消息 |
| 定位成本 | 用户看到的是一条流内的模糊错误，而不是「你的请求少了参数」 |

预检在 ③，写入在 ⑤，**③ 失败时 ④⑤ 都不会发生**——这是「预检前置」的真正价值：**失败不产生副作用**。

### 17.3 预检是「看图」，不是「看这次走哪条路」

`validateNodeData` 遍历**整张图**的所有节点。所以：

```
condition c1 ──good──→ llm1(useHistory:true) → ...
             └─else──→ llm2                 → ...
```

即使这次运行走的是 `else` 分支、`llm1` 根本不会执行，只要 `useHistory` 还在图上，**没有会话就 400**。

这是刻意的：预检的语义是「这张图能不能在给定请求下安全运行」，而不是「本次执行路径上会不会用到」。如果做成「走到才检查」，同一张图的行为就会随输入变化——更难解释、更难测试。

与阶段 7「检索节点预检前置」、阶段 8「分支边预检前置」完全同构。

### 17.4 顺序上的细节：会话 404 先于图 400

`run()` 的校验顺序是：应用归属 → **会话归属** → 图是否为空 → 图预检。所以：

- 传了一个别人的 / 不存在的 / 属于别的应用的 `conversationId` → 先 **404** `Conversation not found`，即使图本身也有问题；
- 会话通过归属校验之后，`conversationId !== undefined` 就成立了，「缺会话」这条预检**不可能**再被触发——它只拦「图要求历史、而请求压根没给会话」的情况。

这也解释了为什么错误文案里写的是 `requires a conversation`，而不是 `conversation not found`：两者是**不同层**的错误（缺参数 vs 资源不存在）。

---

## 18. 实测

以下结果在 Windows + `apps/api-ts` + `tools/mock-llm`（`LLM_BASE_URL=http://127.0.0.1:11435/v1`）上实跑得到。

### 18.1 测试图

```jsonc
{
  "version": "1",
  "nodes": [
    { "id": "start_1", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "inputs": [{ "name": "question", "required": true }] } },

    { "id": "llm1", "type": "llm", "position": { "x": 160, "y": 0 },
      "data": { "title": "聊天", "prompt": "Q: {{ inputs.question }}", "useHistory": true } },

    { "id": "end_1", "type": "end", "position": { "x": 320, "y": 0 },
      "data": { "outputs": [{ "name": "answer", "value": "{{ llm1.text }}" }] } }
  ],
  "edges": [
    { "id": "e1", "source": "start_1", "target": "llm1" },
    { "id": "e2", "source": "llm1", "target": "end_1" }
  ]
}
```

注意 `prompt` 里**显式**写了 `Q: {{ inputs.question }}`——本轮问题由模板负责，`conversation` 只提供过去（§10.5）。

### 18.2 两轮之后：4 条消息，`seq` 1..4

```
第 1 轮：conversationId=<CONV>, userMessage="hello",  inputs.question="hello"
第 2 轮：conversationId=<CONV>, userMessage="again",  inputs.question="again"
```

`GET /apps/{APP_ID}/conversations` 的 `messageCount` 为 4；`GET /conversations/{CONV}/messages`：

```json
{
  "items": [
    { "seq": 1, "role": "user",      "content": "hello",           "runId": null },
    { "seq": 2, "role": "assistant", "content": "echo: Q: hello",  "runId": "<run1>" },
    { "seq": 3, "role": "user",      "content": "again",           "runId": null },
    { "seq": 4, "role": "assistant", "content": "echo: Q: again",  "runId": "<run2>" }
  ]
}
```

（这里省略了 `id` / `conversationId` / `createdAt`；`seq` 与内容为实测。）

**值得注意的两点**：

1. **user 行存的是原始 `userMessage`**（`hello` / `again`），不是渲染后的 `Q: hello`。会话记录记「用户说的话」，不记「模板包了一层之后的样子」。
2. assistant 行存的是**纯文本**（单键 `answer`），不是 `{"answer":"..."}`（§15）。

### 18.3 第二轮 mock 实收 `messages` = 3 条

在 mock 端临时打印请求体的 `messages`（仅自测，不提交）：

```text
[
  { role: "user",      content: "hello" },
  { role: "assistant", content: "echo: Q: hello" },
  { role: "user",      content: "Q: again" }
]
```

- **恰好 3 条**；
- user 内容为 `["hello", "Q: again"]`，**无重复**；
- 第 1 条没有 `Q: ` 前缀（历史里的原始输入），第 3 条有（本轮的模板渲染）——这个「不对称」正是第 1 点的直接结果，是设计取舍，不是 bug。

**反证（错误顺序）**：如果把 `run()` 里的 ④⑤ 对调，第二条 user 消息会变成两条：

```
[user: hello, assistant: echo: Q: hello, user: again, user: Q: again]
```

第一轮也一样会出现两条 user（`hello` 与 `Q: hello`）。

### 18.4 `{{ conversation.history }}` 第二轮拼接结果

换一张 prompt 为 `H: {{ conversation.history }}` 的图（`useHistory` 开不开都不影响本项：mock 只回显**最后一条** user，而历史消息是前置的），第二轮 token 帧拼接后：

```text
echo: H: user: hello
assistant: echo: H: 
```

也就是字符串：

```text
"echo: H: user: hello\nassistant: echo: H: "
```

拆开看：

| 片段 | 来源 |
| --- | --- |
| 开头的 `echo: ` | mock provider 的固定前缀（它回显收到的最后一条 user 内容） |
| `H: ` | 本轮的 `prompt` 模板前缀 |
| `user: hello\nassistant: echo: H: ` | `{{ conversation.history }}` 的渲染结果（第一轮的 user + assistant） |

其中历史里的 `assistant: echo: H: ` 又是「第一轮 prompt = `H: ` + 空历史」被 mock 回显成 `echo: H: ` 后落库的内容。

- 历史里**只有**第一轮的 `user: hello` 与 `assistant: echo: H: `；
- **不含本轮**的 `again`（§10.5）；
- `\n` 是单个换行，无尾随换行（`assistant: echo: H: ` 后面直接就是流结束）。

### 18.5 无会话时 `run_started` 的键集合

```text
event: run_started
data: {"runId":"...","appId":"..."}
```

断言结果：键集合 `["runId","appId"]`，`has conversationId = False`。带会话时同理多一个键：

```text
data: {"runId":"...","appId":"...","conversationId":"..."}
```

### 18.6 `useHistory` 但没带会话 → 400

```
POST /apps/<APP_ID>/run
{"inputs":{"question":"hello"}}
```

（图里 `llm1.useHistory === true`，但请求没有 `conversationId`）

响应是**普通 JSON**（不是 SSE），状态 400：

```json
{
  "statusCode": 400,
  "message": "llm node llm1 useHistory requires a conversation",
  "error": "Bad Request"
}
```

并且这次请求**没有写任何消息行**（预检在读写之前，§17.2）。

### 18.7 两端逐帧一致

同一张图、同一组输入、同一会话序列（第一轮 `hello` → 第二轮 `again`），在 `api-ts` 与 `api-py` 上各跑一次，逐项比较：

| 断言 | 实测 |
| --- | --- |
| `event sequence equal` | `True` |
| `per-frame key sets equal` | `True`（含 `run_started` 的 `conversationId` 出现/省略位置） |
| `frames equal after normalize` | `True`（归一化 `runId` / `appId` / `elapsedMs` / `usage` 后逐字节） |

这说明：**顺序、历史裁剪、`history` 拼接、assistant 内容规则**在两端完全一致——只要有任何一处（比如 `\r\n`、或者「先写后读」）不同，这三项里至少有一项会变 `False`。

### 18.8 终态唯一：两端各 2 轮，`run_finished=2`、`run_failed=0`

修复后在同一会话各跑 2 轮（TS / Python 各一遍），按事件名计数：

| 断言 | 实测 |
| --- | --- |
| `run_finished` 帧数 | **2**（每轮恰好 1 个） |
| `run_failed` 帧数 | **0** |
| `messages` 条数 | **4** |
| `roles`（按 `seq`） | `1:user 2:assistant 3:user 4:assistant` |

两轮各自只有**一个**终态；不存在「先 `run_finished`、后又 `run_failed`」的序列。又因为 assistant 写入已前移到终态帧之前，**`run_finished` 到达后立刻查 `messages`，4 条已全部在库**——不再需要等流结束或轮询。

---

## 19. 验收自测

| 检查项 | 做法 | 预期 |
| --- | --- | --- |
| 契约编译 | `pnpm run build:contract` | 无报错 |
| 引擎编译 | `pnpm --filter @mini-dify/api-ts build` | 无报错 |
| 两轮落库 | §18.2 的两次运行 | `messages` 恰好 4 条，`seq` 1..4 |
| 历史不含本轮 | 在 mock 端打印 `payload.messages` | 第二轮 3 条，user 内容 `["hello","Q: again"]` |
| 无重复 | 同上，断言 user content 无重复 | `Set(userContents).size === userContents.length` |
| `history` 形状 | 用 `H: {{ conversation.history }}` 作 prompt | `"echo: H: user: hello\nassistant: echo: H: "`（`echo: ` 来自 mock 前缀） |
| 无会话 `run_started` | 不带 `conversationId` 跑 | `data` 键集合 `["runId","appId"]` |
| 带会话 `run_started` | 带 `conversationId` 跑 | 多一个 `conversationId` |
| `useHistory` 预检 | 图里有 `useHistory:true`，请求不带会话 | 400 `llm node llm1 useHistory requires a conversation`（普通 JSON） |
| 预检无副作用 | 上述 400 后查消息 | 消息条数不变 |
| 失败不写 assistant | 让 llm 返回 500（`[[mock-status:500]]`） | 会话只多一条 user，没有 assistant |
| 终态唯一 | 两轮各数事件名 | 每轮 `run_finished` 恰好 1 个、`run_failed` 0 个；`run_finished` 到达后立刻查 `messages` 已含本轮 assistant |
| 窗口 | `MAX_HISTORY_MESSAGES=2` 跑三轮 | 第三轮历史只有最近 2 条 |
| 单键内容 | `end` 只有一个输出 | assistant `content` 是纯文本，不是 JSON |
| 多键内容 | `end` 有两个输出 | assistant `content` 是紧凑 JSON（无空格） |
| 两端一致 | §18.7 的对比脚本 | 三项断言全 `True` |

**可复现的最小命令序列**（PowerShell）：

```powershell
# 0) 另开一个终端常驻 mock provider
node tools/mock-llm/server.mjs

# 1) 启动 api-ts
pnpm --filter @mini-dify/api-ts start:dev

# 2) 登录拿 token（沿用阶段 1 的账号）
$LOGIN = curl.exe -s -X POST "http://localhost:3001/auth/login" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"demo@example.com\",\"password\":\"password123\"}"
$TOKEN = ($LOGIN | ConvertFrom-Json).accessToken

# 3) 取一个已有应用（或先 POST /apps 建一个）
$APP_ID = "<APP_ID>"

# 4) 写入 §18.1 的图（草稿）
curl.exe -s -X PUT "http://localhost:3001/apps/$APP_ID/graph" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d "@graph.json"

# 5) 建会话
$CONV = (curl.exe -s -X POST "http://localhost:3001/apps/$APP_ID/conversations" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d "{\"title\":\"阶段9自测\"}" | ConvertFrom-Json).id

# 6) 第一轮
curl.exe -N -X POST "http://localhost:3001/apps/$APP_ID/run" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"question\":\"hello\"},\"conversationId\":\"$CONV\",\"userMessage\":\"hello\"}"

# 7) 第二轮
curl.exe -N -X POST "http://localhost:3001/apps/$APP_ID/run" `
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"question\":\"again\"},\"conversationId\":\"$CONV\",\"userMessage\":\"again\"}"

# 8) 核对落库
curl.exe -s "http://localhost:3001/conversations/$CONV/messages" `
  -H "Authorization: Bearer $TOKEN"
```

---

## 20. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **⭐ 先写 user 再读历史** | 无报错；模型收到两条本轮 user；真模型开始复述/答非所问 | 历史是「写入前的快照」，必须先读后写（§9） |
| **窗口写成 `asc + take`** | 历史只包含最早的 N 条，最近的对话丢失 | `LIMIT` 作用在排序结果前 N 行，必须 `desc + take` 再 `reverse()`（§4.1、§12.2） |
| **`history` 用 `\r\n` 或加尾随换行** | 两端帧不一致；prompt 多不可见字符 | 契约要求 `\n` + `join`，无尾随（§11） |
| **把 `history` 转成 `null`** | 模板渲染出 `"null"` | 空时必须是 `""`（§11） |
| **以为 `conversation.messages` 含本轮** | prompt 里没有当前问题 | `conversation` 由历史快照构造，本轮问题要自己写 `{{ inputs.xxx }}`（§10.5） |
| **以为会话里的 user 是渲染后的 prompt** | 历史里没有模板前缀 | 存的是原始 `userMessage`（§18.2） |
| **只传 `conversationId` 不传 `userMessage`** | 会话只有 assistant，没有 user | 空/缺省不写 user；「答而无问」是允许但不是常规用法（§5.1） |
| **无会话时在 prompt 里写 `{{ conversation.history }}`** | `run_failed: template variable not found: conversation.history` | 无会话时池里**没有**这个键（§5.3） |
| **`useHistory` 但没带会话** | 开流前 400 | 预检按「图」检查，不按执行路径（§17） |
| **`useHistory` 节点在未执行分支里也触发 400** | 明明这次不走那条分支 | 同上，这是预检的刻意语义（§17.3） |
| **`useHistory: "true"`** | 历史没注入，也不报错 | 只认 `=== true`（§13.1） |
| **以为 `run_failed` 会写一条错误 assistant** | 会话里只有 user | 失败不写 assistant，下轮会看到「问了没答」（§16） |
| **以 `run_finished` 帧为「回合结束」立刻发下一轮** | 现在**不会**漏掉 assistant | assistant 在 `run_finished` **之前**已落库；收到终态帧后立刻拉 `messages` 即含完整历史（§5.3、§18.8） |
| **单输出时期望 assistant 是 JSON** | 会话来的是纯文本 | 单键取字符串是有意为之（§15.2） |
| **多输出时期望被拆开** | 一整条紧凑 JSON | 多键无法判断主字段，整体 JSON 是最保守的做法（§15.4） |
| **`MAX_HISTORY_MESSAGES=5`（奇数）** | 历史从 assistant 开始 | 条数裁剪不保证成对，建议用偶数（§12.4） |
| **改了 `.env` 不重启** | 窗口没变化 | `process.env` 在启动时确定（§12.5） |
| **同一会话并发两个 run** | 两边历史互相看不到，`seq` 仍连续 | 无会话级锁，是已知简化（§9.7） |
| **写 `{{ conversation.messages.0.content }}`** | 路径缺失 / `run_failed` | 模板拒绝数组下钻，用 `history`（§10.2） |

---

## 21. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **⭐ 读与写的顺序决定语义** | 「先写本轮 user → 再读历史」会让本轮混进历史，模型收到两条用户消息；正确顺序是「先读快照 → 再写 user → 再执行」。不报错、不崩溃，只能通过断言模型侧 `messages` 发现 | **首次教学于本篇** |
| **`pool.conversation` 的双表示** | `{id, history, messages}`；`history` 供模板（模板拒绝数组下钻，必须预先摊平），`messages` 供 `useHistory` 拼真实消息数组；两者由同一数组派生 | **首次教学于本篇** |
| **`history` 的逐字节规则** | `seq` 升序、`"{role}: {content}"`、`\n` 连接、无尾随换行、空时 `""`；每一条都是为两端 prompt 逐字节一致服务 | **首次教学于本篇** |
| **`useHistory` 作为节点级开关** | 默认 `false`、严格 `=== true`；只有「当聊天用」的 llm 节点需要历史；默认关闭保证阶段 5~8 的图行为不变 | **首次教学于本篇** |
| **`useHistory` 注入顺序与 `tool` 跳过** | 历史前置 → 本轮 system（非空）→ 本轮 user（prompt）；`tool` 角色必须跳过（缺 `tool_call_id` 与配对的 assistant `tool_calls`，provider 会拒绝）；未知 role 静默丢弃 | **首次教学于本篇** |
| **历史窗口 `MAX_HISTORY_MESSAGES`** | 默认 20、非正整数回退默认；取「最近 N 条」（`desc + take` 再 `reverse`）；按条数而非 token 是「两端可一致」的简化 | **首次教学于本篇** |
| **assistant 消息内容规则** | `outputs` 单键 → 取字符串值（非字符串紧凑 JSON）；多键 → 整体紧凑 JSON；避免聊天记录/下一轮 prompt 被 JSON 包裹 | **首次教学于本篇** |
| **`run_failed` 不写 assistant** | 「问而未答」是真实状态；失败属于传输层，不伪造模型发言；assistant 写入已前移到 `run_finished` **之前**，写入失败只发**唯一一帧** `run_failed(nodeId=null)`（终态唯一） | **首次教学于本篇** |
| **`useHistory` 缺会话 → 预检 400** | `llm node {id} useHistory requires a conversation`；预检在读写之前 ⇒ 失败无副作用；预检按「整张图」而非执行路径 | **首次教学于本篇** |
| **`run_started` 的可选 `conversationId`** | 无会话时**省略键**（不是 `null`），让「payload 键集合」成为代码事实 | **首次教学于本篇** |
| **消息 `seq` 的并发正确性** | `seq = max+1`，正确性由 `(conversation_id, seq)` 唯一约束 + `P2002` 重试保证，而非 `SELECT` 加锁 | 本篇（支撑说明，表结构见本阶段第 `01` 篇） |

> 已在前序篇教学、本篇仅引用不重讲的：变量池与模板解析见 `04-执行引擎/03-节点运行时与变量池.md`；SSE 帧格式与双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；`ChatOpenAI` / 真流式见 `05-LLM节点/02-真实模型调用与流式.md`；ReAct 的首轮消息数组见 `06-工具调用/02-NestJS-ReAct循环与条件边.md`；预检前置见 `07-知识库RAG/03-NestJS检索与检索节点.md`；模板拒绝数组下钻见 `08-分支与循环/02-NestJS条件边与变量聚合.md`。
