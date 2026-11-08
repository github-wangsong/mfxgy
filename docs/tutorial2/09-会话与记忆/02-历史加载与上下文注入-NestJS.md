# 02 · 历史加载与上下文注入（NestJS）

> 阶段 9 · 第 2 步
>
> 做完：`ConversationsModule` 落地（5 个接口）；`POST /apps/{id}/run` 接受 `conversationId` / `userMessage`；开流前完成「归属校验 → 读历史 → 写 user 消息 → 构造 `pool.conversation`」；`llm.useHistory` 把历史前置成真实消息；助手消息在 `run_finished` 之前落库，失败走唯一一帧 `run_failed`。
>
> **本篇面试考点**：为什么必须「先读历史、再写本轮 user 消息」 · 为什么无会话时 `pool` 里不能放一个空的 `conversation` · `seq = max + 1` 为什么必须配唯一约束和重试 · Prisma 交互式事务的隔离级别与幻读 · 为什么助手消息要写在 `run_finished` 之前 · 为什么历史查询用 `desc + take + reverse` · 归属不符为什么返回 404 而不是 403 · `@ValidateIf` 与 `@IsOptional` 的区别。

---

## 1. 这条链路的全貌

阶段 8 为止，一次运行是「无状态」的：同样的 `inputs` 永远得到同样的结果。阶段 9 给它加一条**有状态**的支路：

```text
POST /apps/{id}/run
  { inputs, conversationId?, userMessage? }
        │
        ├─ 1. App 归属校验            404 App not found
        ├─ 2. Conversation 归属校验   404 Conversation not found   ← 同时比 ownerId 与 appId
        ├─ 3. 草稿非空                400 Graph is empty
        ├─ 4. 图 / 节点数据预检        400（多条用 "; " 连接）
        │      └─ useHistory 为 true 却没有 conversationId → 400
        │
        ├─ 5. loadHistory(最近 N 条)      ← 只读，不含本轮
        ├─ 6. appendMessage(role=user)    ← 写本轮，失败即 400（开流之前，普通 JSON）
        ├─ 7. buildConversationContext → pool.conversation
        │
        └─ 8. execute()  ──> run_started（带 conversationId）
                  │
                  ├─ llm 节点：useHistory 时把历史前置为 Human/AI/System 消息
                  ├─ …… 图执行 ……
                  ├─ appendMessage(role=assistant, runId)   ← 必须在 run_finished 之前
                  └─ run_finished
```

第 5 步与第 6 步的**先后顺序不可交换**，这是本篇最重要的一条约束，下面会单独展开。

---

## 2. 决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 会话归属校验时机 | 开流之前 | 失败要回普通 JSON 404，不能污染 SSE 帧 |
| 历史读取与 user 消息写入 | **先读后写** | 反过来的话，本轮 user 会混进历史，模型看到两条相同的用户话 |
| 历史条数 | 最近 `MAX_HISTORY_MESSAGES` 条（默认 20） | 控制 token 成本；长会话不能无限增长 |
| 历史查询方式 | `orderBy seq desc` + `take N` + `reverse()` | 取「最近 N 条」而不是「前 N 条」 |
| 无会话时的 `pool` | **没有** `conversation` 键 | 模板 `{{ conversation.history }}` 才会按契约报 `template variable not found` |
| `seq` 生成 | 事务内 `max(seq) + 1` | 不依赖全局自增，会话内从 1 开始连续 |
| `seq` 并发兜底 | 唯一约束 `(conversation_id, seq)` + 失败重试 3 次 | 读-写之间没有锁，唯一索引才是真正的裁判 |
| 用户消息写入失败 | 开流前抛 400（普通 JSON） | 还没开始执行，没有必要开流 |
| 助手消息写入时机 | `run_finished` **之前** | 副作用先做完再宣布成功；否则会补出第二个终态事件 |
| `run_failed` 时的助手消息 | **不写** | 失败运行没有「回答」可存 |
| 会话 CRUD 归属 | 三种校验函数分开 | 路径是 `/apps/{id}` 还是 `/conversations/{id}`，比对的维度不同 |
| 模块导出 | `ConversationsModule` 导出 `ConversationsService` | `EngineModule` 要复用，而不是再造一份 |

---

## 3. 新建会话模块

### 3.1 模块

**完整文件路径：`apps/api-ts/src/conversations/conversations.module.ts`**（新文件）

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ConversationsController } from './conversations.controller'
import { ConversationsService } from './conversations.service'

/**
 * 会话与记忆模块（阶段 9）。`PrismaService` 来自全局 `PrismaModule`，
 * `JwtAuthGuard` 由 `AuthModule` 提供并导出。
 * `ConversationsService` 同时被 `EngineModule` 复用（会话归属、消息读写）。
 */
@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  // 必须导出：EngineModule 注入的是同一个实例（单例），不是复制一份
  exports: [ConversationsService],
})
export class ConversationsModule {}
```

> **面试考点 · 为什么 `exports` 是必需的？**
> Nest 的 provider 默认是**模块内私有**的。`EngineModule` 的 `imports` 里写了 `ConversationsModule`，只能拿到它 `exports` 出来的 provider。不写 `exports` 时启动会直接报：
>
> ```text
> Nest can't resolve dependencies of the EngineService (PrismaService, ?).
> Please make sure that the argument ConversationsService at index [1] is available in the EngineModule context.
> ```
>
> 另外，Nest 的 provider 默认是**单例**（scope 为 `DEFAULT`），所以两个模块拿到的是同一个 `ConversationsService` 实例，不存在「两份缓存」的问题。

### 3.2 注册到根模块

**完整文件路径：`apps/api-ts/src/app.module.ts`**（节选，阶段 9 增量）

```ts
import { ConversationsModule } from './conversations/conversations.module'

/**
 * 根模块。阶段 1 加入：
 * - `PrismaModule`（全局数据库访问）
 * - `AuthModule`（注册 / 登录 / 当前用户）
 * 阶段 2 加入 `AppsModule`（应用管理）。
 * 阶段 3 加入 `GraphModule`（画布存取与校验）。
 * 阶段 4 加入 `EngineModule`（执行引擎，`POST /apps/{id}/run`）。
 * 阶段 6 加入 `ToolsModule`（内置工具列表，`GET /tools`）。
 * 阶段 7 加入 `KbModule`（知识库、文档上传与检索）。
 * 阶段 9 加入 `ConversationsModule`（会话与记忆）。
 * 阶段 10 加入 `ApiKeysModule`（API Key 管理）与 `PublicModule`（对外运行）。
 * 阶段 11 加入 `AgentModule`（自主 Agent 运行时）。
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AppsModule,
    GraphModule,
    EngineModule,
    ToolsModule,
    KbModule,
    ConversationsModule,
    ApiKeysModule,
    PublicModule,
    AgentModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

### 3.3 引擎模块引入

**完整文件路径：`apps/api-ts/src/engine/engine.module.ts`**（阶段 9 增量）

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ConversationsModule } from '../conversations/conversations.module'
import { EngineService } from './engine.service'
import { RunController } from './run.controller'

/**
 * 执行引擎模块（阶段 4）。`PrismaService` 来自全局 `PrismaModule`，
 * `JwtAuthGuard` 由 `AuthModule` 提供并导出，均无需在此声明。
 * 阶段 9 起复用 `ConversationsService`（会话归属校验、消息读写与历史加载）。
 */
@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [RunController],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
```

---

## 4. Controller 与 DTO

### 4.1 请求体 DTO

**完整文件路径：`apps/api-ts/src/conversations/dto/create-conversation.dto.ts`**（新文件）

```ts
import { IsOptional, IsString } from 'class-validator'

/**
 * POST /apps/{id}/conversations 请求体 —— 对应契约 `CreateConversationRequest`。
 *
 * 长度上限（120）由 `ConversationsService` 检查，以便产出契约规定的固定文案
 * `Conversation title is too long`（见 error-messages.md §9）。
 */
export class CreateConversationDto {
  /** 可选标题；不传则由数据库存 null，前端展示为「未命名」 */
  @IsOptional()
  @IsString()
  title?: string
}
```

为什么长度校验不写成 `@MaxLength(120)`？

- `class-validator` 的 `@MaxLength` 按 **UTF-16 码元**计数，而 Service 里用的是 `[...title].length`（**码点**计数）；
- 一个 emoji（如 `😀`）在 UTF-16 下占 2 个码元、1 个码点；
- 如果两边都用，会出现「DTO 先拦住、但契约说 120 字符」的口径不一致。

所以：**DTO 只做类型检查，长度统一在 Service 按码点判断**，错误文案也只有一处产出。

### 4.2 控制器

**完整文件路径：`apps/api-ts/src/conversations/conversations.controller.ts`**（新文件）

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import type {
  ConversationListResponse,
  ConversationResponse,
  MessageListResponse,
} from '@mini-dify/contract'

import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard'
import { ConversationsService } from './conversations.service'
import { CreateConversationDto } from './dto/create-conversation.dto'

/** 契约见 packages/contract/openapi.yaml 的 `/apps/{id}/conversations*` 与 `/conversations*`。 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  /** GET /apps/{id}/conversations —— 按 updatedAt 倒序 */
  @Get('apps/:id/conversations')
  list(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<ConversationListResponse> {
    // payload.sub 是 JWT 里的用户 id，绝不从 body/query 取 ownerId
    return this.conversationsService.list(payload.sub, id)
  }

  /** POST /apps/{id}/conversations —— 创建会话（标题可选） */
  @Post('apps/:id/conversations')
  create(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationResponse> {
    return this.conversationsService.create(payload.sub, id, dto.title)
  }

  /** GET /conversations/{id} —— 会话详情（含 messageCount） */
  @Get('conversations/:id')
  get(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<ConversationResponse> {
    return this.conversationsService.get(payload.sub, id)
  }

  /** DELETE /conversations/{id} —— 204 无响应体（消息由外键级联删除） */
  @Delete('conversations/:id')
  @HttpCode(204)
  async remove(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.conversationsService.remove(payload.sub, id)
  }

  /** GET /conversations/{id}/messages —— 按 seq 升序返回全量消息 */
  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
  ): Promise<MessageListResponse> {
    return this.conversationsService.listMessages(payload.sub, id)
  }
}
```

三个细节：

1. **`@Controller()` 不写前缀**。这五个接口有两个不同的前缀（`apps/:id/conversations` 与 `conversations/:id`），写在类上就只能覆盖一半，索性全部写全在方法上。
2. **`@HttpCode(204)`**。Nest 的 `DELETE` 默认返回 `200`，契约要求 `204`，必须显式声明；`204` 不允许有响应体，所以方法返回 `void`。
3. **`@CurrentUser()` 返回的是 JWT payload**，`sub` 才是用户 id。`ownerId` 永远来自 token，不来自请求体——这是阶段 2 定下的规矩，会话沿用。

> **面试考点 · 为什么归属不符返回 404 而不是 403？**
> 403 的语义是「身份已认证，但无权访问这个**已知存在**的资源」，它等于确认了「这个 id 是存在的」。攻击者可以拿随机 uuid 去试探：403 说明存在、404 说明不存在，这就成了**资源枚举**通道。
> 把「不存在」和「不属于你」合并成同一个 404 `Conversation not found`，两种情况在响应上完全不可区分，信息量为零。
> 如果业务上确实需要「你知道有这个资源但没权限」，才用 403；本项目统一用 404。

---

## 5. Service：归属校验与 CRUD

**完整文件路径：`apps/api-ts/src/conversations/conversations.service.ts`**（新文件，完整）

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
  /** 会话 id，同时写进 `run_started.conversationId` */
  id: string
  /** 历史拼成的纯文本：`"user: ...\nassistant: ..."`；无消息时为 `""` */
  history: string
  /** 结构化的历史，供 `useHistory` 转成 LangChain 消息 */
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

  /** 列出某应用下当前用户的会话（最近更新的在前）。 */
  async list(ownerId: string, appId: string): Promise<ConversationListResponse> {
    await this.assertAppOwned(ownerId, appId)
    const conversations = await this.prisma.conversation.findMany({
      // ownerId + appId 双条件：即使 app 归属已校验，也再收窄一次
      where: { ownerId, appId },
      orderBy: { updatedAt: 'desc' },
      // 只要数量，不把 messages 全捞出来
      include: { _count: { select: { messages: true } } },
    })
    return { items: conversations.map((conversation) => toConversationResponse(conversation)) }
  }

  /** 创建会话。`title` 为 undefined 时存 null。 */
  async create(ownerId: string, appId: string, title?: string): Promise<ConversationResponse> {
    await this.assertAppOwned(ownerId, appId)
    // 按码点数（[...str] 把字符串拆成码点），而不是 UTF-16 码元
    if (title !== undefined && [...title].length > MAX_TITLE_LENGTH) {
      throw new BadRequestException('Conversation title is too long')
    }
    const conversation = await this.prisma.conversation.create({
      data: { ownerId, appId, title },
      // 新建会话一定是 0 条消息，但仍带上 _count，让返回形状与 list 一致
      include: { _count: { select: { messages: true } } },
    })
    return toConversationResponse(conversation)
  }

  /** 会话详情。 */
  async get(ownerId: string, id: string): Promise<ConversationResponse> {
    return toConversationResponse(await this.findOwned(ownerId, id))
  }

  /** 删除会话（`messages` 由数据库外键 `ON DELETE CASCADE` 级联删除）。 */
  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwned(ownerId, id)
    await this.prisma.conversation.delete({ where: { id } })
  }

  /** 会话内的全部消息，按 `seq` 升序（界面历史面板用，不分页）。 */
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
    // 三个条件合并成一个 404：不存在 / 不是你的 / 不是这个应用的
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
    // 无上限 for：退出条件全在 catch 里（成功 return / 不可重试 throw）
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // 读当前最大 seq（同一事务内）
          const last = await tx.message.findFirst({
            where: { conversationId },
            orderBy: { seq: 'desc' },
            select: { seq: true },
          })
          // 写 seq + 1；并发时冲突由唯一索引拦下（P2002）
          await tx.message.create({
            data: {
              conversationId,
              role,
              content,
              seq: (last?.seq ?? 0) + 1,
              runId: runId ?? null,
            },
          })
          // 手动刷新 updatedAt：会话列表按它倒序，新消息要能冒到最前
          await tx.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          })
        })
        return
      } catch (error) {
        // 已达到重试上限，或不是唯一约束冲突（如外键不存在）→ 原样抛出
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
      // 先倒序取「最近 N 条」……
      orderBy: { seq: 'desc' },
      take: limit,
      // 只取构造上下文需要的两列
      select: { role: true, content: true },
    })
    // ……再翻回正序，交给模型时才是时间顺序
    return messages.reverse()
  }

  /** 校验应用归属（`/apps/{id}/conversations` 两个接口用）。 */
  private async assertAppOwned(ownerId: string, appId: string): Promise<void> {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { ownerId: true },
    })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
  }

  /** 校验会话归属（`/conversations/{id}` 三个接口用）。 */
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
  // 非正整数（NaN、0、-1、1.5）一律回退默认值，避免 take: NaN 这种运行时错误
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_HISTORY_MESSAGES
}

/** 把消息列表构造为 `pool.conversation`（见 sse-events.md §4.2）。 */
export function buildConversationContext(
  id: string,
  messages: Array<{ role: string; content: string }>,
): ConversationContext {
  return {
    id,
    // 纯文本形态：给 `{{ conversation.history }}` 直接拼进 prompt
    history: messages.map((message) => `${message.role}: ${message.content}`).join('\n'),
    // 结构化形态：给 `useHistory` 转成 LangChain 消息对象
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
  }
}

/** Prisma 唯一约束冲突（`P2002`），用于并发追加消息时重试。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    // Prisma 的已知错误都带 code 字段，P2002 = Unique constraint failed
    (error as { code?: unknown }).code === 'P2002'
  )
}

/** Prisma 行 → 契约 `ConversationResponse`。 */
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
    // 统一 UTC 毫秒 + Z，两端逐字节可比
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }
}

/** Prisma 行 → 契约 `MessageResponse`。 */
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
    // 数据库里 role 是 string，契约是枚举；这里收窄一次
    role: message.role as MessageResponse['role'],
    content: message.content,
    seq: message.seq,
    runId: message.runId ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}
```

### 5.1 三种归属校验各管什么

| 函数 | 调用方 | 比对维度 | 失败文案 |
| --- | --- | --- | --- |
| `assertAppOwned` | `list` / `create` | `app.ownerId === 当前用户` | `App not found` |
| `findOwned` | `get` / `remove` / `listMessages` | `conversation.ownerId === 当前用户` | `Conversation not found` |
| `assertOwnedByApp` | `EngineService.run` | `ownerId` **且** `appId` | `Conversation not found` |

`assertOwnedByApp` 比另外两个多比一个 `appId`，因为它的入参同时有 `appId`（路径）和 `conversationId`（body）。如果不比 `appId`，用户就能把 A 应用的会话挂到 B 应用的运行里，历史会串。

### 5.2 并行查询 `list`

`findMany` + `include._count` 在 Prisma 里会被编译成一次 `LEFT JOIN` + `GROUP BY`（或等价子查询），**不是** N+1。若改成 `include: { messages: true }` 再在内存里 `.length`，一条 200 条消息的会话就会把 200 行全文拉回来——列表页只需要一个数字。

> **面试考点 · 为什么 `seq` 用 `max + 1`，而不给 `messages` 建全局自增主键？**
> 全局自增（`SERIAL`）能保证唯一，但 `seq` 的业务语义是「**会话内**从 1 开始的连续序号」：
> - 前端按 `seq` 渲染「第几条」，不能有洞；
> - 历史截断（取最近 20 条）按 `seq` 排序才稳定；
> - 跨会话的全局 id 顺序与「对话轮次」无关。
>
> 代价是并发写同一会话时可能算出同一个 `seq`。所以必须配两层保护：**唯一索引**（真正的裁判）+ **失败重试**（恢复手段）。只有事务没有唯一索引是不够的——PostgreSQL 默认 `READ COMMITTED` 隔离级别下，两个事务都能读到相同的 `max(seq)`，然后都插入成功。

> **面试考点 · Prisma 的 `$transaction(async (tx) => ...)` 是什么？**
> 这是**交互式事务**（interactive transaction）：整个回调在同一个连接、同一个事务里执行，回调里每次 `tx.xxx` 都复用这个事务。与之相对的是 `$transaction([...])`（批量事务），只能一次提交一组互不依赖的语句。
> 本项目需要「先读 max，再写新行」，读的结果决定写的内容，只能用交互式事务。
> 注意：交互式事务有默认超时（5s）与最大等待（2s），回调里不要做网络调用（比如调 LLM），否则会超时回滚。

---

## 6. 引擎接线：`run()`

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`run` 方法，阶段 9 改造）

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
    // 1. 应用归属：不是本人应用一律 404（不泄露存在性）
    const app = await this.prisma.app.findUnique({ where: { id: appId } })
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
    // 2. 会话归属：同时比 ownerId 与 appId；查不到/不符都是同一个 404
    if (conversationId !== undefined) {
      await this.conversations.assertOwnedByApp(ownerId, appId, conversationId)
    }
    // 3. 草稿必须存在
    if (app.graphJson === null) {
      throw new BadRequestException('Graph is empty')
    }
    const graph = app.graphJson as unknown as Graph
    // 4. 预检：hasConversation 决定 useHistory 是否放行
    await this.precheck(ownerId, graph, conversationId !== undefined)

    let conversation: ConversationContext | undefined
    if (conversationId !== undefined) {
      // 5. 顺序很重要：**先读历史、再写本轮用户消息**。
      // 反过来的话，本轮 user 消息会混进历史，模型会看到「两条相同的用户话」。
      const history = await this.conversations.loadHistory(
        conversationId,
        maxHistoryMessages(),
      )
      // 6. 写本轮用户消息（空串视为「没有新消息」，不写一行空记录）
      if (userMessage !== undefined && userMessage !== '') {
        try {
          await this.conversations.appendMessage(conversationId, 'user', userMessage)
        } catch {
          // 开流之前失败 → 普通 JSON 400，而不是 SSE 里的 run_failed
          throw new BadRequestException('failed to persist conversation message')
        }
      }
      // 7. 构造 pool.conversation（history 里**不含**本轮 user）
      conversation = buildConversationContext(conversationId, history)
    }
    // 8. 开流执行
    return this.execute(appId, graph, inputs, conversation)
  }
```

构造函数同步改为注入两个依赖：

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（构造函数）

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
  ) {}
```

### 6.1 为什么第 5 步必须在第 6 步之前

假设顺序反过来：

```text
写 user("今天天气怎么样")  →  读历史（最近 20 条）
                           ↑ 这条刚写的会被读到
pool.conversation.messages = [..., user("今天天气怎么样")]
```

然后 `llm` 节点渲染后的本轮 prompt 又是「今天天气怎么样」，`messages` 里就出现**两条一模一样的用户消息**。模型会以为用户重复问了一遍，回答质量明显下降（尤其是要求「不要重复上一轮」的 prompt）。

先读后写的正确结果：

```text
历史 = [user("第一条"), assistant("第一条回答")]      ← 只有过去
本轮 = user("今天天气怎么样")                          ← 只在 prompt 里，不进历史
```

### 6.2 为什么用户消息要在开流前写

`appendMessage` 失败的原因通常是数据库问题（连接断开、外键不存在）。这时：

- **已经开了 SSE 流**：HTTP 状态码已经被 `flushHeaders()` 固定为 200，只能在流里补一帧 `run_failed`，前端要额外处理「流刚开始就失败」；
- **没开流**：直接 400 普通 JSON，前端走统一的错误提示，和「图不合法」完全同一条路径。

所以顺序被定为：**所有可能失败的写操作，全部放在 `flushHeaders()` 之前**。

### 6.3 为什么 `pool` 里不放一个空的 `conversation`

假设无会话时也放 `{ id: "", history: "", messages: [] }`，那么模板 `{{ conversation.history }}` 会静默渲染成空串，图能跑完但结果是错的——用户以为「接了历史」，其实什么都没接。

契约选择**省略整个键**：

```text
pool = { inputs: {...} }
```

此时 `renderTemplate` 解析 `{{ conversation.history }}` 会在第一段 `conversation` 就找不到，抛：

```text
template variable not found: conversation.history
```

直接 `run_failed`，问题立刻暴露。**宁可报错，也不要静默降级。**

---

## 7. `run_started` 带上 `conversationId`

**完整文件路径：`apps/api-ts/src/engine/events.ts`**（阶段 9 增量）

```ts
/** 构造 `run_started` 事件（无会话时不带 `conversationId` 键）。 */
export function runStarted(runId: string, appId: string, conversationId?: string): RunEvent {
  return conversationId === undefined
    ? { event: 'run_started', data: { runId, appId } }
    : { event: 'run_started', data: { runId, appId, conversationId } }
}
```

不能用 `{ conversationId: undefined }` 再交给 `JSON.stringify` —— 那样序列化时确实会**丢掉**这个键，但事件对象在内存里仍然带着 `conversationId: undefined`，一旦某处做了 `'conversationId' in data` 或 `Object.keys(data)` 的判断就会出错。这里直接分成两支，键集合在构造时就确定。

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`execute` 方法）

```ts
  /** 写一帧 `run_started`，后台执行图，并把队列里的事件转成异步生成器。 */
  private async *execute(
    appId: string,
    graph: Graph,
    inputs: Record<string, unknown>,
    conversation?: ConversationContext,
  ): AsyncGenerator<RunEvent> {
    // 事件队列：节点执行过程中往里 emit，这里按顺序 drain 出来
    const queue = new RunEventQueue()
    // 每次运行一个新 runId，助手消息的 run_id 就是它
    const runId = randomUUID()
    // 有会话才带 conversationId（undefined 时 runStarted 会省略该键）
    queue.emit(runStarted(runId, appId, conversation?.id))
    // 不 await：图在后台跑，事件边产生边被消费
    void this.runGraph(graph, inputs, queue, runId, conversation)
    yield* queue.drain()
  }
```

`conversation?.id` 的类型是 `string | undefined`，正好对上 `runStarted` 的可选参数。

---

## 8. 初始状态：把 `conversation` 放进 `pool`

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`runGraph` 的 `invoke` 入参）

```ts
      await builder.compile().invoke(
        {
          // 有会话：pool 里多一个 conversation 键；无会话：只有 inputs
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
```

`pool` 的 reducer 是浅合并 `{ ...previous, ...update }`，所以 `conversation` 会一直留在池子里，不会被后续节点的输出覆盖掉（除非某个节点的 id 恰好叫 `conversation`——图校验里节点 id 的规则保证了这一点不会发生）。

`pool.conversation` 的最终形状：

```json
{
  "id": "0b6a...",
  "history": "user: 第一条\nassistant: 第一条回答",
  "messages": [
    { "role": "user", "content": "第一条" },
    { "role": "assistant", "content": "第一条回答" }
  ]
}
```

两个字段是**同一份数据的两种形态**：

- `history` 给不想用 `useHistory` 的人直接拼进 prompt：`"以下是历史：\n{{ conversation.history }}"`；
- `messages` 给 `useHistory` 用，因为只有结构化的 role 才能转成 `HumanMessage` / `AIMessage`。

---

## 9. `useHistory`：历史注入到消息数组

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`**（阶段 9 增量）

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
  // 只有显式开启才注入：默认 false，避免老图突然多出历史、token 暴涨
  if (data.useHistory === true) {
    messages.push(...historyMessages(pool))
  }
  // system 放在历史之后：历史是「对话记录」，system 是「本轮角色约束」
  if (typeof data.system === 'string' && data.system !== '') {
    messages.push(new SystemMessage(data.system))
  }
  // 本轮用户输入永远最后
  messages.push(new HumanMessage(renderTemplate(String(data.prompt), pool)))
  return messages
}

/** 把 `pool.conversation.messages` 转换为 LangChain 消息（`tool` 角色跳过）。 */
function historyMessages(pool: Pool): BaseMessage[] {
  // 无会话时 pool 里没有 conversation 键 → 返回空数组，不报错
  // （useHistory 缺会话的情况已在预检阶段 400 拦下）
  const conversation = pool.conversation
  if (!isPlainObject(conversation) || !Array.isArray(conversation.messages)) {
    return []
  }
  const messages: BaseMessage[] = []
  for (const item of conversation.messages) {
    if (!isPlainObject(item)) {
      continue
    }
    // content 非字符串时字符串化（与契约一致：存进去的一定是字符串）
    const content = typeof item.content === 'string' ? item.content : String(item.content ?? '')
    if (item.role === 'user') {
      messages.push(new HumanMessage(content))
    } else if (item.role === 'assistant') {
      messages.push(new AIMessage(content))
    } else if (item.role === 'system') {
      messages.push(new SystemMessage(content))
    }
    // `tool` 角色跳过：工具结果没有对应的 tool_call_id，直接塞给模型会 400
  }
  return messages
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

最终发给模型的消息顺序：

```text
[Human("第一条"), AI("第一条回答"), …, System(本轮 system), Human(渲染后的 prompt)]
 ↑ 最近 N 条历史，按 seq 升序                    ↑ 本轮
```

三个知识点：

1. **历史在前，本轮在后**。这是 chat 协议的天然顺序，模型靠位置区分「说过」和「正在说」。
2. **`tool` 角色必须跳过**。OpenAI 协议要求 `tool` 消息必须紧跟在一个带 `tool_calls` 的 `assistant` 消息之后，并且 `tool_call_id` 要对得上。我们从数据库里只存了 role + content，没有存 `tool_call_id`，硬塞进去会被 provider 直接拒绝。工具调用的中间过程本来也属于「同一次运行内部」，不需要跨轮记忆。
3. **`useHistory` 只影响第一轮**。启用工具的节点走 `makeLlmWithToolsAction`，第一轮用 `buildInitialMessages`，之后每轮沿用该节点自己的 `state.messages[nodeId]`——否则历史会被重复注入 N 次。

> **面试考点 · 历史注入对 token 成本的影响**
> 每轮都把最近 20 条历史重新发给模型，token 消耗是 **O(轮次 × 历史长度)** 的。两条常见优化：
> - **按 token 截断**而不是按条数（本项目用条数，简单可预测；生产中可用 tiktoken 估算）；
> - **摘要压缩**（把早期对话总结成一段 system 消息），阶段 11 的 Agent 运行时就是这么做的。
> 另外，历史越长首字延迟越高——prompt tokens 是要真实计费和等待的。

---

## 10. 助手消息的落库时机

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`runGraph` 收尾）

```ts
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
          // 统一文案：不把 Prisma 的原始错误透给前端
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
```

`assistantContent` 决定「助手消息存什么」：

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**

```ts
/**
 * 助手消息内容（sse-events.md §4.2）：`outputs` 只有 1 个键时取其字符串值
 * （非字符串按紧凑 JSON 序列化），否则取 `JSON.stringify(outputs)`。
 */
function assistantContent(outputs: Record<string, unknown>): string {
  const keys = Object.keys(outputs)
  if (keys.length === 1) {
    const value = outputs[keys[0]]
    // 常见的单输出（answer）直接存纯文本，历史里读起来干净
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  // 多输出只能整体序列化，否则 role=assistant 的一行存不下结构
  return JSON.stringify(outputs)
}
```

为什么规则是「单键取纯文本」？

- 大多数图的 `end` 只有一个输出（如 `answer`），存 `"这是回答"` 比存 `{"answer":"这是回答"}` 更像人话，下一轮拼进 `history` 时也更自然；
- 多输出时无法拆成一行，只能整体 JSON 化。

### 10.1 「终态唯一」为什么是硬约束

SSE 协议里，前端靠终态事件结束 loading 状态：

```ts
if (event === 'run_finished' || event === 'run_failed') {
  setRunning(false)
}
```

如果一次运行发出了两帧终态（先 `run_finished` 再 `run_failed`），前端会：

1. 收到 `run_finished` → 停止 loading、渲染结果；
2. 又收到 `run_failed` → 再渲染一次错误。

用户看到的是「成功的结果 + 一条红色报错」，无法判断这次运行到底算不算成功。

所以顺序只有一种正确写法：

```text
副作用（写库）  →  终态事件
```

而不是：

```text
终态事件  →  副作用（写库）  →  失败了再补一帧终态
```

### 10.2 `run_failed` 为什么不写助手消息

失败时 `context.lastOutputs` 可能：

- 是 `{}`（`end` 节点根本没执行到）；
- 是上一个成功节点的残留值（不是本次运行的最终输出）。

写进去会污染历史：下一轮模型会看到一条「从未真实产生过」的助手回答。

---

## 11. 预检：`useHistory` 必须有会话

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`validateNodeData` 的 `llm` 分支）

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

`hasConversation` 由 `run()` 传入：

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**

```ts
  private async precheck(ownerId: string, graph: Graph, hasConversation: boolean): Promise<void> {
    const errors = [
      ...validateGraph(graph),
      ...validateNodeData(graph, hasConversation),
      // 预检需要知道 ownerId：其他用户的知识库一律视为不存在（见 error-messages.md §7.2）
      ...(await validateKnowledgeNodes(this.prisma, ownerId, graph)),
    ]
    if (errors.length > 0) {
      // 多条错误用 "; " 连接，顺序固定（两端一致）
      throw new BadRequestException(errors.join('; '))
    }
  }
```

为什么不在运行时（`historyMessages` 里）报错？因为那时流已经开了，只能发 `run_failed`。而「配置错了」属于**用户输入问题**，应该在开流前用 400 明确拒绝——和「图不合法」同级。

注意 `runPublished` 传的是 `false`：

```ts
    // 对外运行不支持会话：`hasConversation = false`（`useHistory` 节点会预检失败）
    await this.precheck(app.ownerId, graph, false)
```

对外 API 是无状态调用（阶段 10），没有会话概念，所以带 `useHistory` 的图发布后走公开接口会直接 400。

---

## 12. `RunRequest` 的 DTO

**完整文件路径：`apps/api-ts/src/engine/dto/run.dto.ts`**（阶段 9 增量）

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

> **面试考点 · `@ValidateIf` 与 `@IsOptional` 有什么区别？**
> - `@IsOptional()`：值为 `undefined` **或 `null`** 时跳过所有校验；
> - `@ValidateIf((_dto, value) => value !== undefined)`：只有 `undefined` 跳过，`null` 会继续走 `@IsString()` 然后失败。
>
> 为什么要这么较真？因为 FastAPI 那边 `conversation_id: str | None = None` 收到 `null` 是合法的（等于没传）。为了两端**对同一请求给出同一状态码**，这里必须拒绝 `null`——否则 Nest 接受、FastAPI 拒绝，契约测试就挂了。
>
> 如果希望 `null` 等价于「未传」，那就两端都写成可空，而不是只在 Nest 用 `IsOptional`。

---

## 13. 验证

以下命令在仓库根目录的 PowerShell 里执行。前置：PostgreSQL 已启动、`api-ts` 已 `pnpm --filter api-ts start:dev`、mock-LLM 已启动（`node tools/mock-llm/server.mjs`）。

```powershell
# 0) 公共变量 + 无 BOM 写文件的小工具
$base = "http://localhost:3001"
$ts = Get-Date -Format "HHmmss"

# PowerShell 5 的 `Set-Content -Encoding utf8` 会带 BOM，服务端 JSON 解析可能直接失败；
# 这里统一用 .NET 的 UTF8Encoding($false) 写「无 BOM 的 UTF-8」
function Write-Json($path, $text) {
  [System.IO.File]::WriteAllText((Join-Path $PWD $path), $text,
    (New-Object System.Text.UTF8Encoding($false)))
}

# 1) 注册 + 登录，拿 token
Invoke-RestMethod -Method Post "$base/auth/register" -ContentType "application/json" `
  -Body (@{ email = "conv$ts@example.com"; password = "password123" } | ConvertTo-Json) | Out-Null
$login = Invoke-RestMethod -Method Post "$base/auth/login" -ContentType "application/json" `
  -Body (@{ email = "conv$ts@example.com"; password = "password123" } | ConvertTo-Json)
$token = $login.accessToken
$headers = @{ Authorization = "Bearer $token" }

# 2) 建应用
$app = Invoke-RestMethod -Method Post "$base/apps" -Headers $headers -ContentType "application/json" `
  -Body (@{ name = "conv-app"; description = "会话验证" } | ConvertTo-Json)
$appId = $app.id

# 3) 存一张 start -> llm(useHistory) -> end 的图
$graph = @'
{
  "version": "1",
  "nodes": [
    { "id": "s1", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "inputs": [ { "name": "topic", "required": true } ] } },
    { "id": "l1", "type": "llm", "position": { "x": 240, "y": 0 },
      "data": { "title": "回答", "prompt": "{{ inputs.topic }}", "useHistory": true } },
    { "id": "e1", "type": "end", "position": { "x": 480, "y": 0 },
      "data": { "outputs": [ { "name": "answer", "value": "{{ l1.text }}" } ] } }
  ],
  "edges": [
    { "id": "e1", "source": "s1", "target": "l1" },
    { "id": "e2", "source": "l1", "target": "e1" }
  ]
}
'@
Write-Json "_g.json" $graph
Invoke-RestMethod -Method Put "$base/apps/$appId/graph" -Headers $headers `
  -ContentType "application/json" -InFile _g.json | Out-Null

# 4) 建会话（预期 messageCount = 0）
$conv = Invoke-RestMethod -Method Post "$base/apps/$appId/conversations" -Headers $headers `
  -ContentType "application/json" -Body (@{ title = "第一轮验证" } | ConvertTo-Json)
$convId = $conv.id
$conv | Select-Object id, appId, title, messageCount
```

预期：

```text
id                                   appId  title        messageCount
--                                   -----  -----        ------------
<uuid>                               <appId> 第一轮验证   0
```

```powershell
# 5) 第一轮：带 conversationId + userMessage（SSE）
$body = @{
  inputs         = @{ topic = "你好，记住我叫小林" }
  conversationId = $convId
  userMessage    = "你好，记住我叫小林"
} | ConvertTo-Json -Depth 5
Write-Json "_run.json" $body
curl.exe -sS -N -X POST "$base/apps/$appId/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@_run.json"
```

预期（`run_started` 的 payload 里**有** `conversationId`）：

```text
event: run_started
data: {"runId":"...","appId":"...","conversationId":"..."}

event: node_started
data: {"nodeId":"s1","nodeType":"start"}
...
event: run_finished
data: {"runId":"...","outputs":{"answer":"..."},"elapsedMs":...}
```

```powershell
# 6) 查消息：预期 seq 1=user、2=assistant，且只有 assistant 带 runId
(Invoke-RestMethod -Method Get "$base/conversations/$convId/messages" -Headers $headers).items |
  Select-Object seq, role, content, runId | Format-Table -AutoSize

# 7) 会话详情：messageCount 应为 2
Invoke-RestMethod -Method Get "$base/conversations/$convId" -Headers $headers |
  Select-Object id, messageCount, updatedAt
```

预期：

```text
seq role      content                runId
--- ----      -------                -----
  1 user      你好，记住我叫小林
  2 assistant <mock 回答>            <本次 runId>
```

```powershell
# 8) 第二轮：同一个会话，历史应被注入（含上一轮的 user/assistant）
$body2 = @{
  inputs         = @{ topic = "我叫什么？" }
  conversationId = $convId
  userMessage    = "我叫什么？"
} | ConvertTo-Json -Depth 5
Write-Json "_run2.json" $body2
curl.exe -sS -N -X POST "$base/apps/$appId/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@_run2.json"

# 9) 再查消息：seq 应连续到 4（1 user / 2 assistant / 3 user / 4 assistant）
(Invoke-RestMethod -Method Get "$base/conversations/$convId/messages" -Headers $headers).items |
  Select-Object seq, role
```

预期 `seq` 依次为 `1, 2, 3, 4`，无空洞。

```powershell
# 10) 无会话运行：run_started 不应出现 conversationId 键
$body3 = @{ inputs = @{ topic = "无会话" } } | ConvertTo-Json -Depth 5
Write-Json "_run3.json" $body3
curl.exe -sS -N -X POST "$base/apps/$appId/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@_run3.json"
```

预期第一帧：

```text
event: run_started
data: {"runId":"...","appId":"..."}
```

（**没有** `conversationId` 字段。）

```powershell
# 11) 错误路径 A：useHistory 但没有 conversationId → 400
#     注意 _run3.json 里的图仍带 useHistory: true
curl.exe -sS -o _err1.txt -w "%{http_code}`n" -X POST "$base/apps/$appId/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@_run3.json"
Get-Content _err1.txt
```

预期：

```text
400
{"statusCode":400,"message":"llm node l1 useHistory requires a conversation","error":"Bad Request"}
```

```powershell
# 12) 错误路径 B：别人的会话 → 404
Invoke-RestMethod -Method Post "$base/auth/register" -ContentType "application/json" `
  -Body (@{ email = "other$ts@example.com"; password = "password123" } | ConvertTo-Json) | Out-Null
$otherToken = (Invoke-RestMethod -Method Post "$base/auth/login" -ContentType "application/json" `
  -Body (@{ email = "other$ts@example.com"; password = "password123" } | ConvertTo-Json)).accessToken
curl.exe -sS -o _err2.txt -w "%{http_code}`n" -X POST "$base/apps/$appId/run" `
  -H "Authorization: Bearer $otherToken" -H "Content-Type: application/json" --data-binary "@_run.json"
Get-Content _err2.txt
```

预期（先命中 App 归属，所以是 `App not found`）：

```text
404
{"statusCode":404,"message":"App not found","error":"Not Found"}
```

```powershell
# 13) 错误路径 C：会话不属于这个应用 → 404 Conversation not found
$app2 = Invoke-RestMethod -Method Post "$base/apps" -Headers $headers -ContentType "application/json" `
  -Body (@{ name = "conv-app-2" } | ConvertTo-Json)
# 把同一张图存进 app2，再用 app1 的会话去跑 app2
Invoke-RestMethod -Method Put "$base/apps/$($app2.id)/graph" -Headers $headers `
  -ContentType "application/json" -InFile _g.json | Out-Null
curl.exe -sS -o _err3.txt -w "%{http_code}`n" -X POST "$base/apps/$($app2.id)/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@_run.json"
Get-Content _err3.txt
```

预期：

```text
404
{"statusCode":404,"message":"Conversation not found","error":"Not Found"}
```

```powershell
# 14) 错误路径 D：标题超过 120 字符 → 400
$longTitle = "a" * 121
curl.exe -sS -o _err4.txt -w "%{http_code}`n" -X POST "$base/apps/$appId/conversations" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d (@{ title = $longTitle } | ConvertTo-Json -Compress)
Get-Content _err4.txt

# 15) 清理临时文件
Remove-Item _g.json, _run.json, _run2.json, _run3.json, _err1.txt, _err2.txt, _err3.txt, _err4.txt -ErrorAction SilentlyContinue
```

预期：

```text
400
{"statusCode":400,"message":"Conversation title is too long","error":"Bad Request"}
```

---

## 14. 面试考点汇总

| 问题 | 一句话答案 |
| --- | --- |
| 为什么先读历史再写 user？ | 否则本轮 user 会混入历史，模型看到两条相同的用户话 |
| 为什么 `pool` 不放假 `conversation`？ | 空对象会让模板静默渲染空串，问题被隐藏；缺键才会按契约报错 |
| `seq = max + 1` 为什么还要唯一索引？ | `READ COMMITTED` 下两个事务能读到同一个 max，唯一索引才是真正的互斥点 |
| 为什么用交互式事务？ | 「读的结果决定写的内容」，批量事务无法表达这种依赖 |
| 助手消息为什么写在 `run_finished` 前？ | 副作用先做完再宣布成功，保证一次运行只有一个终态事件 |
| 为什么 `run_failed` 不写助手消息？ | 失败时 `outputs` 可能是空或残留值，写进去会污染历史 |
| 历史为什么用 `desc + take + reverse`？ | 要的是「最近 N 条」；直接 `asc + take` 拿到的是最早的 N 条 |
| 为什么归属不符返回 404？ | 403 会暴露资源存在性，形成枚举通道 |
| `@Controller()` 为什么不写前缀？ | 五个接口分属两种前缀，写类上只能覆盖一半 |
| `@ValidateIf` 和 `@IsOptional` 差别？ | 后者放行 `null`，前者只放行 `undefined`；决定两端对 `null` 的判定是否一致 |
| 为什么 `ConversationsModule` 要 `exports`？ | Nest 的 provider 模块内私有，不导出 `EngineModule` 注入不到 |
| 历史注入的成本？ | token 随「轮次 × 历史长度」增长，生产上要按 token 截断或做摘要压缩 |

---

## 15. 下一步

`apps/api-ts` 侧的会话链路已经完整：CRUD、归属、历史读取、上下文注入、助手消息落库全部打通。

下一篇 `03-checkpointer与自建消息表.md` 回答一个架构问题：**LangGraph 自带 checkpointer（`MemorySaver` / `PostgresSaver`），为什么我们还要自己建 `messages` 表？**

会对比三条路线：

```text
A. 完全用 checkpointer            → 界面读不到、跨语言格式不一致、脱离图无法查询
B. 完全自建 messages 表            → 本项目选择（阶段 9 已实现）
C. 两者并用                        → 双写一致性问题，收益不抵成本
```
