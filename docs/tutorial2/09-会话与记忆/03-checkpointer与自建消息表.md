# 03 · checkpointer 与自建消息表（会话与记忆）

> 阶段 9 · 第 3 步
>
> **本篇不新增任何业务代码。** 它回答一个在架构评审上一定会被问到的问题：LangGraph 自带 checkpointer（`MemorySaver` / `PostgresSaver`），能按 `thread_id` 保存图状态，为什么我们还要自己建 `conversations` / `messages` 两张表？
>
> 文里出现的 `PostgresSaver` 代码块都标注了「示意图（非本项目文件）」，只用于讲清它的用法；本项目实际运行的是 `apps/api-ts/src/engine/engine.service.ts` 与 `apps/api-py/app/engine/engine.py`，两者的 `compile()` 都**不传** checkpointer。
>
> **本篇面试考点**：checkpointer 存的是什么 · `thread_id` / `checkpoint_id` / `checkpoint_ns` 各管什么 · 为什么「一轮对话 ≠ 一个 checkpoint」 · checkpointer 的三项能力与前提 · 图状态里的 `messages` 与业务表 `messages` 为什么同名不同义 · 双语言共用 PG 时 checkpointer 会坏在哪一步 · `setup()` 的运行期 DDL 为什么破坏迁移所有权 · 「从图内部继续跑」为什么是唯一的选型标准。

---

## 1. 先给结论

```text
checkpointer  解决「让图从某个点继续跑」      → 面向机器：可恢复、可回放
消息表        解决「让人看到、管理聊天记录」  → 面向人：可列表、可查询、可删除
```

两者不是替代关系，是**不同维度**：

- 用 checkpointer 做多轮聊天，你最终还是要建业务表来放 `title`、归属、`seq`、`messageCount`——它只是让你**多背一套库的表和一套序列化**；
- 用消息表做断点恢复，存下来的只有「谁说了什么」，没有「图跑到哪一步、`toolCalls` 是什么」——恢复不了。

阶段 9 的需求全部落在第一列之外的后半段（多轮上下文、界面历史、跨端一致），所以选消息表；同时**明确记账**：我们因此没有中断恢复、时间旅行与 HITL，这些属于阶段 11。

> 这句话值得背下来：**不要把「运行时快照」当成「产品里的对话记录」。** 前者的消费者是执行器，后者的消费者是人和业务查询。

---

## 2. 先把 checkpointer 讲清楚

### 2.1 一句话与三个标识

> **checkpointer 是 LangGraph 的状态持久化机制：它按 `thread_id` 把「每一步的图状态」写成一条可回溯的检查点链，使一张图可以在中途停下、之后从某一帧继续。**

| 标识 | 属于谁 | 一句话解释 | 本项目有对应物吗 |
| --- | --- | --- | --- |
| `thread_id` | checkpointer 的线程 | 一条可续跑的对话线程；同一 `thread_id` 的多次 `invoke` 共享一条 checkpoint 链 | 语义上最接近 `conversationId`，但不是同一个东西 |
| `checkpoint_id` | 链上某一帧 | 某一时刻状态的唯一编号；指定它可以从那一帧继续（并产生分叉） | 没有。我们只有 `runId`（一次运行），不是状态帧 |
| `checkpoint_ns` | 命名空间 | 隔离子图 / 嵌套图的检查点，普通单图是空串 | 没有（本项目没有子图） |

这三个标识已经说明了它的设计意图：**面向「机器继续执行」，不面向「人查看记录」**。后面所有论证都从这句话长出来。

### 2.2 它在一轮运行里做了什么

LangGraph 的执行模型是 **superstep**：每个 superstep 里，入边条件已满足的节点执行，返回的 `Partial<State>` 经 reducer 合并进各个 **channel**，形成下一版状态。

checkpointer 挂在 superstep 的**边界**上：每跨一步，就把「当前所有 channel 的值 + 元数据」落盘一次。

```text
输入 ──► 初始帧 ──► superstep 1 ──► superstep 2 ──► superstep 3
        (写入输入)     (start)          (llm)           (end)
            │             │                │               │
       checkpoint(0)  checkpoint(1)   checkpoint(2)   checkpoint(3)
```

一张 3 节点的线性图会产生**约 4 个 checkpoint**（入口一帧 + 每个 superstep 一帧），每帧还附若干条 `writes`（记录本步每个 task 写了哪个 channel）。

这解释了两个常见误解：

1. **一轮对话 ≠ 一个 checkpoint**。一轮对话是一次 `invoke`，而一次 `invoke` 会推进多个 superstep；如果图里有 ReAct 环（阶段 6），工具轮次还会继续增加步数。
2. **checkpoint 是状态快照，不是消息日志**。它记的是「此刻整张图的所有 channel 是什么」，不是「用户第 3 句说了什么」。

### 2.3 三项招牌能力

| 能力 | 怎么用 | 典型场景 | 前提 |
| --- | --- | --- | --- |
| 中断恢复 | 再调一次且不提供新输入（Python `invoke(None, config)`），从最新 checkpoint 继续 | 进程重启、连接断开、调度器抢占后续跑 | 状态必须可序列化 |
| 时间旅行 | `get_state_history` / `getStateHistory` 列出链，指定 `checkpoint_id` 再 `invoke` | 第 3 步输出不理想，回到第 3 步改参数重跑后面 | 同上 |
| HITL（人工介入） | 节点内 `interrupt()` 暂停，人工回答后用 `Command(resume=...)` 继续 | 删除数据库这类危险工具执行前等审批 | **必须有 checkpointer**：暂停意味着进程退出，栈帧存不下来 |

注意「时间旅行 ≠ 重放事件流」：它回放的是**状态**，不是**过程**。要看每个 token、每次工具调用，仍然需要事件日志。

### 2.4 两端怎么接（示意图，非本项目文件）

TS 侧：

```ts
// 示意图（非本项目文件）：TS 侧接入 Postgres checkpointer 的最小骨架
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

// 连接串来自环境变量；Saver 自己建表、自己读写
const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!)
await checkpointer.setup() // 建表（幂等）—— 注意：这是「运行期 DDL」

const graph = builder.compile({ checkpointer })
await graph.invoke(input, { configurable: { thread_id: 'conv_123' } })
```

Python 侧：

```python
# 示意图（非本项目文件）：Python 侧接入 Postgres checkpointer 的最小骨架
from langgraph.checkpoint.postgres import PostgresSaver

with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
    checkpointer.setup()  # 建表（幂等）
    graph = builder.compile(checkpointer=checkpointer)
    graph.invoke(state, {"configurable": {"thread_id": "conv_123"}})
```

它会创建一套自己的表（以 `langgraph-checkpoint-postgres` 1.x 为例，表集合与列类型随版本变化）：

```sql
checkpoints             -- 一帧一行：thread_id / checkpoint_ns / checkpoint_id / parent / type / metadata
checkpoint_blobs        -- 按 channel 存序列化后的值（较新版本才有）
checkpoint_writes       -- 本 superstep 中每个 task 对每个 channel 的写入
checkpoint_migrations   -- 库自己的 schema 版本号
```

这两点必须记住，它们是后面论证的基石：

1. **表结构属于库的实现细节**。早期版本只有 `checkpoints` + `checkpoint_writes` 且值用 JSONB，后来拆出 `checkpoint_blobs` 改用二进制。`checkpoint_migrations` 的存在，本身就是「库承认自己会改表」的自白。
2. **两端是两套独立实现**。包名不同、代码库不同、序列化不同（Python 侧 `JsonPlusSerializer` 底层是 msgpack + 类型标签，JS 侧有自己的实现），schema 版本也各自推进。**官方没有把「跨语言互读同一份 checkpoint」列为支持场景。**

### 2.5 它的边界：不负责业务语义

| 业务需要的东西 | checkpointer 有吗 | 说明 |
| --- | --- | --- |
| 会话属于哪个用户 / 哪个应用 | 没有 | 它只有 `thread_id`，归属是你自己的概念 |
| 会话标题 | 没有 | 纯业务字段 |
| 消息条数（列表页要显示） | 没有 | 只能在运行时聚合，且「消息」得先解码才知道 |
| 会话内连续、从 1 递增的 `seq` | 没有 | checkpoint 编号是 superstep 步号，每个 run 重新计 |
| 用户可见的「谁说了什么」 | 勉强 | 要挑对 checkpoint、解 blobs、从 channel 里挑字段，还得过滤 `ToolMessage` |
| 历史窗口裁剪 | 没有 | 它保存**全量** channel 值，不替你按条数 / token 裁剪 |
| 删除会话时级联清理 | 没有 | 要按 `thread_id` 删三张表，且没有你定义的 `ON DELETE CASCADE` |

一句话：**checkpointer 记录「图此刻是什么样」，业务表记录「用户看到过什么」。前者是过程，后者是事实。**

---

## 3. 我们实际存了什么

### 3.1 图状态：`RunState` 的五个 channel

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（节选，阶段 8 结束时的形状）

```ts
/**
 * 变量池状态注解：`pool` 用「合并」reducer，节点返回 `{ pool: { <nodeId>: <output> } }`
 * 逐步累积；初始输入 `{ pool: { inputs } }` 先与默认空对象合并。
 *
 * 阶段 6：`messages` / `rounds` / `toolCalls` 按节点 id 隔离。
 * 阶段 8：`branches` 记录 `condition` 节点选中的分支。
 */
const RunState = Annotation.Root({
  // 变量池：{ inputs, conversation?, <nodeId>: <该节点输出> }
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  // 每个启用工具的 llm 节点自己的消息数组（多轮共享）
  messages: Annotation<Record<string, BaseMessage[]>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  // 每个 llm 节点已执行的工具轮次数
  rounds: Annotation<Record<string, number>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  // 每个 llm 节点上一轮待执行的工具调用（条件边路由依据）
  toolCalls: Annotation<Record<string, ToolCallRequest[]>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  // 每个 condition 节点选中的 caseId 或 "else"
  branches: Annotation<Record<string, string>>({
    reducer: (previous, update) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
})
```

这五份状态有一个共同特征：**它们都以「节点 id」为键，服务于「下一跳怎么走」**。

最容易被误解的是 `messages`：

| 名字 | 类型 | 装什么 | 给谁看 |
| --- | --- | --- | --- |
| 图状态 `messages` | `Record<nodeId, BaseMessage[]>` | 某个 `llm` 节点在 ReAct 多轮里累积的 `SystemMessage` / `HumanMessage` / `AIMessage` / `ToolMessage`，含 `tool_calls` | **模型**（下一轮继续推理） |
| 业务表 `messages` | 一行一条 | `role` + `content` + `seq`，角色只有 `user` / `assistant` / `system` | **人**（历史列表、会话详情） |

**同名，但一个是「给模型的上下文」，一个是「给人的发言记录」。** 名字撞车不代表可以互换——这是本阶段最容易犯的概念错误。

### 3.2 我们的 `compile()` 根本不传 checkpointer

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（节选）

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
        { recursionLimit: Math.max(25, maxToolRounds() * 2 + graph.nodes.length * 3 + 20) },
      )
```

**完整文件路径：`apps/api-py/app/engine/engine.py`**（节选）

```python
        # 不传 checkpointer：状态只在一次 ainvoke 的生命周期内存在
        compiled = builder.compile()
        ...
        await compiled.ainvoke(
            {
                "pool": initial_pool,
                "messages": {},
                "rounds": {},
                "tool_calls": {},
                "branches": {},
            },
            config={"recursion_limit": max(25, max_rounds * 2 + len(graph["nodes"]) * 3 + 20)},
        )
```

这不是「漏了」，而是**默认用法**。`compile()` 不传 checkpointer 完全合法，阶段 4~8 全程如此。

> **面试考点 · 为什么这会成为一个考点？**
> 很多人学完 LangGraph 的教程后会形成一种错觉：「生产环境必须接 checkpointer」。实际上 checkpointer 是**按需开启**的能力，它的存在与否只取决于一个需求：**要不要从图内部的某一步继续**。
> 本项目的一次运行是一条 HTTP 请求撑着的同步流，连接断了就结束，本来就没有「稍后继续」的语义，接 checkpointer 只会白增写放大。

---

## 4. 为什么没选它

三条理由，**不是并列的优缺点，而是三层不同性质的否决**：第一条是产品层不匹配，第二条是项目最高约定违规，第三条是长期成本。

### 4.1 理由一：职责不同（产品层）

阶段 9 的五个接口，每一个都要求 checkpointer 给不了的语义：

| 接口 | 需要的查询 | 业务表 | checkpointer |
| --- | --- | --- | --- |
| `GET /apps/{id}/conversations` | 按 `ownerId + appId` 过滤、`updatedAt` 倒序、带 `messageCount` | 一条索引查询 + `_count` | 要 `DISTINCT thread_id`、自己算最后活动时间、再解码数消息 |
| `POST /apps/{id}/conversations` | 插入一行，带 `title` | 一条 insert | **没有 title 这个概念**，得另建表 |
| `GET /conversations/{id}/messages` | 按 `seq` 升序取全部 | `ORDER BY seq`，语义确定 | 选「哪个 checkpoint 才是这轮结束」→ 解 blobs → 抽 channel → 过滤工具消息 |
| `DELETE /conversations/{id}` | 删一行，消息级联 | 一条 delete | 按 `thread_id` 删三张表，删不干净会污染后续线程 |

关键不是「麻烦」，而是**语义缺失**：

- `seq` 要求「会话内从 1 连续递增」。checkpoint 的步号是「本次 run 的 superstep 计数」，**每个 run 重新开始**，一轮对话里还会出现多个步号。拿它当消息序号，必然重复与空洞。
- `updatedAt` 的业务定义是「最后一条消息的时间」。checkpoint 的时间是「最后一次状态写入的时间」，「读状态 / 续跑」都会让它与业务定义分叉。
- 归属（`ownerId`、`appId`）是业务概念，checkpointer 完全不感知。你仍然得建 `conversations` 表来放归属——**那它就已经不是替代方案了，而是「多一套表」**。

所以第一条结论是：**在「只是多轮聊天上下文」这个需求下，checkpointer 增加的全是成本。**

### 4.2 理由二：跨语言一致（项目层，一票否决）

这是本项目的最高约定：**同一契约、双语言实现、共用同一个 PostgreSQL，验收时逐字节比对**。

「两端各接各的 checkpointer」只有两种做法，**两种都坏**：

| 做法 | 会发生什么 |
| --- | --- |
| 两端都往 `public` 写同名表 | `checkpoints` / `checkpoint_writes` 同名但序列化不同；`checkpoint_migrations` 被一端升到新版本，另一端可能不认识；同一 `thread_id` 的链被两种格式混写 → **续跑时读到对方写的帧，直接失败** |
| 两端各用一个 schema 隔离 | 隔离是隔离了，但「同一会话在 api-ts 聊两句、切到 api-py 再聊两句」就**读不到对方的历史**。前端切换后端只需要改 `NEXT_PUBLIC_API_BASE`，用户视角就是「历史突然没了」 |

更根本的是序列化不互通，而且**这不是 bug**：库把「序列化后的字节」当作内部格式，没有任何兼容承诺。哪怕表结构完全一样，payload 也是对方看不懂的。

于是契约测试在存储层失去抓手：checkpointer 的中间状态不属于契约，也无法写成契约（它是库的实现细节）。阶段 4~8 的验收方法是「同一输入打两端，事件名序列 / payload 键集合逐字节比对」；到了存储层，你只能退而求其次测「恢复后行为等价」——成本高、场景多，还证明不了「存储一致」。

而自建表让**存储层也成为可比对的对象**：同一张表、同一份 Prisma DDL、同一套字段语义、两端读到逐字节相同的 JSON。

### 4.3 理由三：可迁移（长期成本）

四个具体理由：

1. **迁移所有权被破坏**。本项目约定：**Prisma 拥有 DDL，SQLAlchemy 只做映射**。checkpointer 的 `setup()` 会在**运行期**执行 `CREATE TABLE`，等于出现第三个 DDL 所有者，且不受迁移流程管控：
   - 迁移是「构建期、可 review、可回滚」；`setup()` 是「启动期、隐式、随库版本变」；
   - 生产上常见「应用账号无 DDL 权限」，`setup()` 会直接失败；
   - 多副本同时启动时，并发建表 / 版本写入需要额外互斥。
2. **表结构会随库版本变**（有实证：JSONB → blob、新增 `checkpoint_blobs`）。升级一次 `langgraph`，可能要迁移一批你不理解的表。
3. **两端版本独立演进**。项目的依赖范围是各自钉的：

   ```text
   apps/api-ts/package.json    "@langchain/langgraph": "^1.5.1"
   apps/api-py/pyproject.toml  "langgraph>=1.2.16"
   ```

   当 TS 侧把 schema 推到新版本、Python 侧还停在旧版本时，同一个数据库被两种期望对待。业务表不会发生这种事，因为 DDL 只有一份。
4. **换引擎 / 换框架时被绑架**。业务表是普通数据，可以导出、迁移、重建；checkpointer 的表离开 LangGraph 就没有意义，payload 也解不出来。

### 4.4 三条理由的优先级

| 层级 | 理由 | 性质 | 只看这一条还会选业务表吗 |
| --- | --- | --- | --- |
| 产品层 | 职责不同 | 需求根本不匹配 | 会——它连「列会话、看历史」都做不到 |
| 项目层 | 跨语言一致 | 违反最高约定 | 会——双实现项目不能接受「换后端就丢历史」 |
| 长期层 | 可迁移 | 成本与风险 | 可以权衡（只做单语言原型时，接它反而更快） |

所以真正的结论不是「checkpointer 不好」，而是：**它的适用面比想象中窄**。它其实是「执行可恢复性」的工具，不是「会话持久化」的候选。

---

## 5. 代价：诚实记账

### 5.1 我们失去了什么

| 失去的能力 | 具体表现 | 后果 |
| --- | --- | --- |
| 中断恢复 | 连接断开、进程重启，这一轮就结束 | 长任务无法可靠完成，只能重发 |
| 时间旅行 / superstep 回放 | 不能「回到第 3 步改参数重跑后面」 | 调试与调参只能整轮重来 |
| HITL | 图无法在中间暂停等人工审批 | 危险操作只能靠「不给这个工具」规避 |
| 细粒度执行审计 | 没有每步的状态快照，只有 SSE 事件流 | 事后复盘只能看事件，看不到「当时的状态」 |
| 精确的失败点恢复 | `run_failed` 后执行现场不保留 | 修好参数也只能从头跑 |

### 5.2 我们自己实现了什么

| 自己实现的部分 | 位置 | 关键设计 |
| --- | --- | --- |
| 历史加载 | `loadHistory`（TS）/ `load_history`（Py） | `orderBy seq desc` + `take` + `reverse()` |
| 窗口裁剪 | `MAX_HISTORY_MESSAGES`（默认 20） | 「最近 N 条」，两端同默认值 |
| 上下文注入 | `buildConversationContext` → `pool.conversation` | 形状固定 `{ id, history, messages }` |
| 用户消息回写 | `run()`（TS）/ `run.py`（Py） | **先读历史、再写用户消息** |
| 助手消息回写 | `run_finished` **之前** | 单输出取纯文本，多输出紧凑 JSON；写失败由统一 catch 发唯一一帧 `run_failed` |
| 并发安全 | `appendMessage` | 事务内 `max + 1` + 唯一约束 `(conversation_id, seq)` + 冲突重试 3 次（TS `P2002` / Py `IntegrityError`） |
| 归属与级联 | `assertOwnedByApp` | 不符一律 404 `Conversation not found`；删除走 `ON DELETE CASCADE` |

### 5.3 额外付出的代价（不粉饰）

1. **会出现「半截记录」**。用户消息在开流前写，助手消息在 `run_finished` 前写，`run_failed` **不写**助手消息。于是一次失败的运行会在库里留下「用户说了话，但没有任何回答」。这是刻意的取舍：**宁可记录真实发生过的事，也不写一条假回复**。
2. **窗口按「条数」而不是「token 预算」**。20 条长消息可能远超上下文窗口；真正的按 token 压缩留到阶段 11。checkpointer 也不解决这个问题——它存全量，裁剪仍要自己做。
3. **没有「运行中」状态**。`POST /run` 仍是一个 HTTP 连接撑着整轮执行；连接一断，前端就丢了后续事件。
4. **将来若接入 checkpointer，删除会话要删两处**。业务表删了，checkpoint 链还在——需要额外的一致性处理。这是「两套存储」的固有成本。

---

## 6. 对照表

| 维度 | LangGraph checkpointer | 自建 `conversations` / `messages` |
| --- | --- | --- |
| **存什么** | 图状态 channel 的逐 superstep 快照（`pool` / `messages` / `rounds` / `toolCalls` / `branches`）+ 元数据；面向「机器继续跑」 | 用户可见的对话事实：归属、标题、`seq`、`role`、`content`；面向「人看 + 业务查询」 |
| **查询友好度** | 差。列会话要 `DISTINCT thread_id` + 聚合；看历史要选 checkpoint、解 blobs、挑 channel、过滤工具消息；没有 title / messageCount / seq | 好。列表是一条索引查询 + `_count`；历史是 `ORDER BY seq`；字段与接口一一对应 |
| **跨语言一致** | 两套库、两套表、两套序列化、两套 schema 版本；共用同一 PG 时要么冲突、要么切换后端丢历史；存储层无法纳入契约测试 | 同一张表、同一份 Prisma DDL、同一套字段语义；两端读写逐字节可比 |
| **中断恢复** | 原生。`invoke(None, config)` 从最新 checkpoint 续跑 | 不支持。一次 `POST /run` 就是一条完整请求 |
| **时间旅行** | 原生。`get_state_history` + `checkpoint_id` 重放 / 分叉 | 不支持。只有消息文本，没有「当时的状态」 |
| **迁移风险** | 高。表结构属于库实现细节；`setup()` 是运行期 DDL，破坏「Prisma 拥有 DDL」；两端版本独立演进会在共用库里打架 | 低。普通业务表，DDL 由自己的迁移拥有；换引擎 / 换框架不受影响 |
| **实现成本** | 接上很快（两行配置 + `setup()`），但**用好**很贵：线程生命周期、序列化、双端对齐、写放大、删除一致性 | 起步要自己写：建表、归属校验、`seq` 并发、窗口裁剪、回写时机——**这些正是阶段 9 的教学内容** |

**一句话读表**：checkpointer 在「恢复 / 回放」两格全胜，其余五格全输或明显吃亏；而阶段 9 的需求恰好只落在后五格。

---

## 7. 什么时候应该反过来选它

判断标准只有一条，其余都是推论：

> **是否需要「从图内部的某一步继续」？**
>
> - 是 → 必须用 checkpointer（或等价的状态快照机制）；
> - 否 → 自建消息表更简单、更可控。

展开成需求信号：

| 需求信号 | 选什么 | 为什么 |
| --- | --- | --- |
| 长任务（分钟~小时级），不能靠一个 HTTP 连接撑着 | checkpointer + 异步 run | 进程随时可能没，只有状态落盘才能续跑 |
| 图中间要停下等人工审批 / 补充信息 | checkpointer + `interrupt` | 暂停意味着进程退出，栈帧存不下来 |
| 要「回到第 3 步、改参数、重跑后面」 | checkpointer（时间旅行） | 需要历史状态帧，消息文本给不了 |
| 每一步都要能精确重放做审计 | checkpointer（状态）+ 事件日志（过程） | 一个存「是什么」，一个存「怎么变的」 |
| 多轮聊天、看历史、删会话、统计条数 | 自建消息表 | 全是业务查询，checkpointer 连字段都没有 |
| 只是「把上下文喂给模型」 | 自建消息表 + 窗口裁剪 | 你要的是「最近 N 条消息」，不是「状态快照」 |

再补一条反向判断，避免过度设计：

> **不要因为「用了 LangGraph」就接 checkpointer。** 不传 checkpointer 的 `compile()` 是完全合法的默认用法。

---

## 8. 两者可以共存时的分层

不是二选一，而是三层。成熟系统通常三层都有：

```text
一次请求
   │
   ▼
执行引擎（LangGraph）
   ├── 状态 channel ──► checkpointer              ← 机器用：可恢复、可回放
   ├── 消息回写 ──────► conversations / messages   ← 人用：可查询、可管理
   ├── 事件流（SSE）──► 前端                      ← 过程展示
   └── 事件（可选）───► 事件日志                   ← 审计用：可重放过程
```

| 层 | 回答的问题 | 生命周期 | 谁拥有 |
| --- | --- | --- | --- |
| checkpointer（执行状态） | 「这轮跑到哪了？能不能接着跑？」 | 一次 run / 一个 thread | **库** |
| 业务表（用户记录） | 「这个用户跟我说过什么？」 | 永久（业务数据） | **项目** |
| 事件日志（过程事实） | 「当时每一步发生了什么？」 | 按留存策略 | **项目** |

**关键点**：checkpointer 不会取代业务表，业务表也不会取代 checkpointer。共存时唯一需要额外设计的是「它们之间怎么对应」。

阶段 11 的自主 Agent 运行时正好是 checkpointer 的正当场景：

- `POST /agent/runs` 异步受理 → 轮询 + SSE，支持 `Last-Event-ID` 断点重放；
- 保留 HITL 与上下文压缩；
- TS 侧用 LangGraph，**Python 侧用 Pydantic AI**。

最后一条说明：checkpointer 只能是 **TS 侧的实现手段**，不能成为跨语言契约——因为 Python 侧根本没有 LangGraph checkpointer。契约只能规定「按 run id 可恢复、可重放」这种**行为**，把「用什么存」留给各自实现。

顺便区分两个容易混淆的「重放」：

| 重放 | 重放的是什么 | 谁提供 |
| --- | --- | --- |
| `Last-Event-ID` 续传 | **事件流**（过程） | 事件日志 / 事件缓冲 |
| checkpointer 时间旅行 | **状态**（现场） | 库 |

两者互补：有事件日志没状态，只能「看回放」；有状态没事件日志，只能「跳回去重跑」，看不到中间过程。

---

## 9. 如果真要在本项目接入，需要改什么

> 这是选做方向，只列改动点与坑，不写完整实现。

### 9.1 依赖与生命周期

| 端 | 要加的东西 | 位置 |
| --- | --- | --- |
| TS | `@langchain/langgraph-checkpoint-postgres`（+ `pg`） | `apps/api-ts/package.json` |
| Python | `langgraph-checkpoint-postgres` | `apps/api-py/pyproject.toml` |

生命周期不能每次请求 new 一个：

- TS：放进一个 NestJS provider，`OnModuleInit` 里 `setup()`，`OnModuleDestroy` 里关闭；
- Python：放进 FastAPI 的 lifespan（启动 / 关闭钩子），用 `AsyncPostgresSaver` 或同步 saver + 线程池。

**坑**：`setup()` 是运行期 DDL。要么给应用账号 DDL 权限（不推荐），要么只让一个进程执行一次（迁移脚本 / 部署钩子），其余进程只连不建。

### 9.2 `thread_id` 从哪来

现有请求里唯一天然唯一、且已做归属校验的标识是 `conversationId`：

```text
thread_id := conversationId
```

三个必须想清楚的问题：

| 问题 | 说明 |
| --- | --- |
| 一个 thread 装什么 | 建议「一个会话 = 一个 thread」；若改成「一个 run = 一个 thread」，时间旅行只覆盖单轮，跨轮历史又得回业务表 |
| `runId` 能不能当 thread | 不能。`runId` 在 `execute()` 里才 `randomUUID()` 生成，**晚于**用户消息写入，且同一会话的多次运行会彼此孤立 |
| `checkpoint_id` 要不要落库 | 只想「继续跑」不用存；要「精确回到某次运行的某一帧」就必须记下来 |

### 9.3 表与 schema：不要放进 `public`

1. **给 checkpointer 一个独立 schema**（例如 `langgraph`），通过连接串参数或单独连接指向它。理由：避免与业务表混在一起，也避免 Prisma 的迁移视图被污染。
2. **不让两端都跑 `setup()`**。共用同一个库时，`checkpoint_migrations` 只能有一个主人：建议 TS 侧负责 `setup()`（或写进一次性脚本），Python 侧只连接、只读写。
3. **接受「库拥有这套表的 DDL」**，并在文档里记成例外（与「Prisma 拥有 DDL」并列）。不要试图把它的建表语句抄进 Prisma 迁移——库一升级你就要手工跟。

### 9.4 与现有 `messages` 表的关系：叠加，不替换

| 做法 | 怎么改 | 代价 |
| --- | --- | --- |
| A. 新增一列（推荐） | `messages.checkpoint_id`（nullable），助手消息写回时把当轮结束帧的 id 一起写 | 要加迁移，Python 侧加映射；契约**不暴露**该字段 |
| B. 借用元数据反查 | 把 `runId` 放进 `config.metadata`，恢复时按 metadata 查 checkpoints | 不改表，但依赖库的 metadata 语义，查询更绕 |

还要守住两个不变量：

1. **用户消息的 `runId` 目前是 `null`**（先写用户消息、后生成 runId）。要做「按 run 恢复」，要么把 runId 提前生成，要么接受「用户消息只能靠 `seq` 定位」。
2. **`run_failed` 不写助手消息**这条规则不要改——checkpointer 的存在不改变「用户可见记录只记真实发生的事」。

### 9.5 编译与调用点：只有两处

| 文件 | 改动 |
| --- | --- |
| `apps/api-ts/src/engine/engine.service.ts` | `builder.compile()` → `builder.compile({ checkpointer })`；`invoke(input, { recursionLimit })` → 追加 `configurable: { thread_id: conversationId }` |
| `apps/api-py/app/engine/engine.py` | `builder.compile()` → `builder.compile(checkpointer=...)`；`config` 里合并 `{"configurable": {"thread_id": conversation_id}}` |

**注意**：没有 `conversationId` 的运行（纯调试、无会话）不能传 `thread_id`。要么准备两个编译入口，要么生成临时 thread。前者的代价是「两条编译路径」，后者会在库里留下大量一次性线程。**两种都要显式设计，别让它变成隐式分支。**

### 9.6 两端对齐的难点（真正的成本）

| 难点 | 具体表现 | 为什么难 |
| --- | --- | --- |
| 状态键命名 | TS `toolCalls` / Python `tool_calls`；TS 用 `Annotation`、Python 用 `TypedDict + Annotated` | 快照内容天然不同名，跨端比对必须归一 |
| 消息序列化 | `AIMessage` / `ToolMessage` 两端字段与编码不同 | 库内部格式，无法写进契约 |
| 写放大与行数 | 每个 superstep 一帧 + 每帧多条 writes，一轮对话可能几十行 | 业务表一轮只有 2 行 |
| 并发与顺序 | 同一 `thread_id` 并发 `invoke` 的语义由库决定 | 业务表的 `seq` 冲突是**显式**的（唯一约束 + 重试），checkpointer 的冲突是**隐式**的 |
| 测试口径 | 只能测「恢复后行为等价」 | 与项目现有的「逐字节比对」验收范式不匹配 |

一句话：**接上是一小时的事，让两端「行为一致且可测」是以周计的事。**

### 9.7 契约层要不要动

- **只为「持久化」接入：不需要动契约。** 会话接口与 `run_started` 都不变。
- **一旦要暴露「恢复」能力，就必须动契约**：需要「发起恢复」的接口（如 `POST /apps/{id}/runs/{runId}/resume`）、新的流内事件（如 `run_interrupted`）、`runId` 从「只在事件里出现」变成「可查询的资源」（那就要建 `runs` 表）。

这些属于阶段 11 的契约面。阶段 9 引入它们就是范围蔓延。所以：**阶段 9 若要接，只接「不暴露给契约」的内部持久化。**

### 9.8 建议的最小可行范围（PoC）

**PoC** = proof of concept，概念验证：用最小代价证明「这条路走得通」，不追求完整。

1. 只改 TS 端；独立 `langgraph` schema；只在一个固定的 `conversationId` 上验证。
2. 只验证一件事：**跑到 `interrupt()` 停下 → 重启进程 → `Command(resume=...)` 继续**，事件流能接上。
3. 验证「同一次运行重跑会新增一条分支」（时间旅行）是否符合预期。
4. **先不碰 `messages` 表、不碰契约、不碰 Python**。等阶段 11 的 Run 模型落地时，再决定要不要正式化。

---

## 10. 验证：证明业务表已经够用

> 本节不验证 checkpointer（本项目没接），而是验证现状：业务表能提供 checkpointer 给不了的查询语义，且两端一致。

### 10.1 库里没有 checkpoint 表

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'checkpoint%';"
```

预期：

```text
 table_name
------------
(0 rows)
```

这证明阶段 9 的持久化**完全由业务表承担**。

### 10.2 `seq` 是消息序号，不是 superstep 步号

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "select conversation_id, seq, role, left(content, 24) as content from messages order by conversation_id, seq;"
```

预期：某个跑了 2 轮的会话有 **4 行，`seq` 依次 `1,2,3,4`**，`role` 交替为 `user` / `assistant`，**连续无空洞**。

这正是 `seq` 作为业务序号的意义，也是 checkpointer 的步号给不了的：步号每个 run 从 0 重新计，一轮对话里还会出现多个。

### 10.3 两端读同一会话，逐字节相同

```powershell
$TOKEN = "<登录响应里的 accessToken>"
$CONV  = "<会话 id>"

# 注意：curl.exe 输出的多行字符串在 PowerShell 里会被当成数组，用 Out-String 合并
$a = (curl.exe -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3001/conversations/$CONV/messages") | Out-String
$b = (curl.exe -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8000/conversations/$CONV/messages") | Out-String

# 先确认不是 401（否则「无差异」是假阳性）
$a.Substring(0, 20)

Compare-Object $a $b
```

预期：

```text
{"items":[
```

`Compare-Object` **无输出**。两端读的是同一张表、同一批行，时间字段都按 UTC 毫秒 `Z` 归一，所以连 `id`、`createdAt` 都逐字节相同。

### 10.4 会话模块与执行引擎解耦

```powershell
Select-String -Path apps\api-ts\src\conversations\*.ts -Pattern "langgraph" -CaseSensitive:$false
Select-String -Path apps\api-py\app\conversations\*.py -Pattern "langgraph" -CaseSensitive:$false
```

预期：两条命令都**无输出**。也就是说，会话的列表 / 详情 / 删除 / 消息查询**完全不依赖执行引擎**——引擎可以换、可以不跑，会话接口照常工作。

> Python 的 `service.py` 确实 import 了 `app.engine.template.js_json_dumps`，但那是一个**纯序列化函数**（保证两端 JSON 字节一致），不是图 / 执行相关符号。用 `langgraph` 作为搜索词可以排除这个干扰。

### 10.5 观察「半截记录」

把 `apps/api-ts/.env` 的 `LLM_BASE_URL` 改成一个不可达的地址，跑一次带 `conversationId` 的运行。

预期：SSE 里出现 `run_failed`（**没有** `node_finished`），随后 `GET /conversations/{id}/messages` 只多了一条 `user` 消息，**没有对应的 assistant**。

这是 5.3 第一条的实证：我们接受「真实发生过的事」，不补写假回复。checkpointer 在同样的失败场景下能保留执行现场，但同样不会让这条半截记录消失——它不写业务表。

---

## 11. 常见误解

| 误解 | 现象 | 真相 |
| --- | --- | --- |
| 「用了 LangGraph 就必须接 checkpointer」 | 以为不接跑不起来 | 不接是默认用法，`compile()` 不传完全正常 |
| 「checkpointer 可以当聊天记录表」 | 接了以后列表页做不出来 | 它没有 title / 归属 / `messageCount` / `seq`，还要解 blobs |
| 「图里的 `messages` 就是聊天记录」 | 直接把 `state.messages` 返回给前端 | 它是 `Record<nodeId, BaseMessage[]>`，含 `ToolMessage` 与 `tool_calls`，是给模型的上下文 |
| 「`thread_id` 就是会话 id」 | 以为可以互换 | 语义可映射，但一个属于库、一个属于业务；一个 thread 可含多次 run |
| 「一轮对话 = 一个 checkpoint」 | 按 checkpoint 数统计轮次 | 一轮对话有多个 superstep，也就有多个 checkpoint |
| 「checkpointer 会自动裁剪历史」 | 以为接了就不用管长度 | 它保存全量 channel 值，裁剪仍要自己做 |
| 「两端表名一样就能互读」 | 以为共用 PG 就天然一致 | 序列化器与 schema 版本都不同，payload 不互通 |
| 「`setup()` 幂等，随便调」 | 每个进程启动都调 | 幂等 ≠ 无并发问题；它是运行期 DDL，多副本会竞争 |
| 「接上 checkpointer 就自动有 HITL」 | 以为 `compile({checkpointer})` 就支持暂停 | 还要节点里的 `interrupt()`、恢复入口、中断事件与恢复接口 |
| 「`MemorySaver` 也能当持久化」 | 开发一切正常，重启全丢 | 进程内存储，多副本不共享，只能测试 |

---

## 12. 面试考点汇总

| 问题 | 一句话答案 |
| --- | --- |
| checkpointer 存的是什么？ | 图状态 channel 的逐 superstep 快照，面向「机器继续跑」，不面向「人看记录」 |
| `thread_id` / `checkpoint_id` / `checkpoint_ns` 各管什么？ | 线程 / 链上某一帧 / 子图命名空间 |
| 为什么一轮对话 ≠ 一个 checkpoint？ | 一次 `invoke` 推进多个 superstep，每个边界落一帧；ReAct 环还会更多 |
| 三项招牌能力与前提？ | 中断恢复、时间旅行、HITL；前提是状态可序列化 |
| 为什么不用它做会话存储？ | 缺归属 / 标题 / `seq` / `messageCount`；选了它仍然要建业务表 |
| 双语言共用 PG 会坏在哪？ | 两套序列化与 schema 版本，混写会让续跑失败；隔离 schema 则切换后端丢历史 |
| `setup()` 为什么是问题？ | 运行期隐式 DDL，破坏「Prisma 拥有 DDL」，多副本竞争、无权限账号直接失败 |
| 选型的唯一标准？ | 是否需要「从图内部某一步继续」 |
| 两者如何共存？ | checkpointer 管执行现场，业务表管用户记录，事件日志管过程事实 |
| 「时间旅行」与「事件重放」的区别？ | 前者回放状态，后者回放过程，互补不可替代 |

---

## 13. 下一步

架构问题到此闭环：**执行状态归引擎，对话事实归业务表**。

下一篇 `04-Python对齐与前端会话面板.md` 把这条链路补齐最后两段：

1. `apps/api-py` 用 SQLAlchemy 映射同一张 `conversations` / `messages` 表，`load_history` / `append_message` 与 TS 逐字节对齐（包括 `seq` 冲突的 `IntegrityError` 重试）；
2. `apps/web` 的会话面板：列表、新建、消息流、与 `run` 的 `conversationId` 联动，所有响应仍走 `lib/schemas.ts` 的 Zod 校验。
