# 03 · checkpointer 与自建消息表：我们为什么没选 LangGraph 的持久化

> 所属：阶段 9 · 会话与记忆
> 本篇覆盖：**LangGraph checkpointer 是什么、能做什么、两端怎么接**；本项目**为什么最终没选它**（三条理由逐条论证）；选了自建表**付出了什么代价**；**什么情况下应该反过来选 checkpointer**；两者**如何共存**；以及「如果真要接入，需要改哪些点」的清单。
> **本篇首次教学**：LangGraph checkpointer（`thread_id` / superstep 快照 / 中断恢复 / 时间旅行 / HITL / Postgres 表结构）；「**执行状态** vs **业务记录**」的职责边界；**存储层选型的判断标准**；「库的内部结构不能当契约」这条工程原则。
> **不重讲**：`StateGraph` / `Annotation` / reducer / `compile-invoke` 见 `04-执行引擎/02-LangGraph编译图-TS.md`、`04-执行引擎/04-LangGraph与引擎-Python.md`；条件边与环、`recursionLimit`、superstep 执行模型见 `06-工具调用/02-NestJS-ReAct循环与条件边.md`；阶段 4 已登记的「checkpoint 是后续扩展点」这一能力边界见 `04-执行引擎/07-验收.md` §5；Prisma 与 SQLAlchemy 的**迁移所有权**见 `01-账号与认证/04-SQLAlchemy2.0.md`。
> **本篇不新增任何代码**。文中的示例代码是**示意代码**（标注为「非本项目文件」），用于讲清 checkpointer 的用法；本项目实际使用的是 `conversations` / `messages` 两张业务表。

> 下文所有「文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 先给结论

总纲 §6 把「LangGraph checkpointer」写进了阶段 9 的「本条深学的基础技术」，§3.3 还点明了具体包名 `@langchain/langgraph-checkpoint-postgres`。但项目**最终没有接它**，而是自建了 `conversations` / `messages` 两张普通业务表。

这不是「不会用所以不用」，也不是「checkpointer 不好」。真实的结论是：

> **checkpointer 解决的是「让图从某个点继续跑」，而阶段 9 的产品需求是「让人能看到、能管理聊天记录」。两者解决的不是同一个问题。**
>
> 在一个「同一契约、双语言实现、共用同一个数据库」的项目里，把**库的内部状态表**当业务存储，会在职责、跨语言一致、可迁移三处同时踩坑——所以我们选择业务表；同时**明确记账**：我们因此失去了中断恢复、时间旅行与 HITL，这些留给阶段 11。

下面按「先讲清楚它 → 再讲为什么没选 → 再讲代价 → 再讲什么时候该选它」的顺序展开。**先理解它，再拒绝它**，这个顺序很重要：不懂就拒绝，是偏见；懂了以后因为需求不匹配而拒绝，是设计。

---

## 1. 本篇目标

读完本篇，你应该能：

1. 用一句话说清 checkpointer 是什么，并解释 `thread_id`、`checkpoint_id`、`checkpoint_ns` 三个标识各自的职责。
2. 说清「一个 checkpoint 落在 superstep 边界上」意味着什么，以及为什么**一轮对话 ≠ 一个 checkpoint**。
3. 独立说出 checkpointer 的三项招牌能力：**中断恢复、时间旅行、HITL**，并各举一个必须用它的场景。
4. 说出 TS 与 Python 两侧的依赖包名、各自会创建哪些表，以及「**两端是两套库、两套序列化、两套 schema 版本**」这一事实。
5. 逐条论证本项目不选它的三条理由，并说清三条理由的**优先级**（哪条是一票否决）。
6. 诚实说明我们**失去了什么**、**自己实现了什么**、**额外付出了什么**。
7. 用判断标准回答：「我这个需求该用 checkpointer 还是消息表？」
8. 说清两者**共存**时的分层，以及为什么阶段 11 的自主 Agent 运行时是 checkpointer 的正当场景。
9. 列出「在本项目接入 checkpointer」的具体改动点，并说清最大的对齐难点在哪。

**验收标准**

1. 不看笔记，能画出「一次 3 节点线性运行」产生几个 checkpoint，并解释为什么是 4 个而不是 1 个。
2. 能解释 `pool` / `messages` / `branches` 这些 **channel** 为什么不是「聊天记录」——尤其是图里的 `messages` 与业务表 `messages` **同名但语义完全不同**。
3. 能说出「共用同一个数据库 + 两端各自 checkpointer」会具体坏在哪一步（不是泛泛的「不兼容」）。
4. 能对着 §6 的对照表，为一个新需求（例如「客服机器人要支持人工转接」）做出选型判断，并给出理由。

---

## 2. 前置条件

- 阶段 4~8 已完成：你知道 LangGraph 把 `Graph`(JSON) 编译成 `StateGraph`，用 `invoke()` 跑完，事件通过自建队列转成 SSE。
- 读过 `06-工具调用/02-NestJS-ReAct循环与条件边.md`：知道**环**、**superstep**、`recursionLimit` 是什么（本篇只借用这些概念，不重讲）。
- 本阶段第 `01`、`02` 篇已完成：知道 `conversations` / `messages` 的字段、`seq` 的语义、`pool.conversation` 的形状，以及「先读历史、再写用户消息」的顺序。
- 数据库可连（`docker compose up -d db`），`mini-dify-db` 容器健康。

---

## 3. 先把 checkpointer 讲清楚

### 3.1 一句话与三个标识

> **checkpointer（检查点保存器）是 LangGraph 的状态持久化机制：它按 `thread_id` 把「每一步的图状态」写成一条可回溯的检查点链，使一张图可以在中途停下、之后从某一帧继续。**

三个标识，各管一件事：

| 标识 | 属于谁 | 一句话解释 | 在本项目里对应什么 |
| --- | --- | --- | --- |
| `thread_id` | checkpointer 的**线程**概念 | 一条「可续跑的对话线程」；同一 `thread_id` 的多次 `invoke` 共享同一条 checkpoint 链 | 语义上**最接近** `conversationId`，但不是同一个东西（§9.2） |
| `checkpoint_id` | 链上**某一帧** | 某一时刻状态的唯一编号；指定它可以从那一帧继续（并产生分叉） | **没有对应物**——本项目只有 `runId`（一次运行），不是状态帧 |
| `checkpoint_ns` | **命名空间** | 用来隔离子图/嵌套图的检查点，普通单图场景是空串 | 无（本项目没有子图） |

这三个标识一起说明了 checkpointer 的设计意图：**它面向「机器继续执行」，不面向「人查看记录」**。记住这句话，第 4 节的全部论证都从这里长出来。

### 3.2 它到底在一轮运行里做了什么

LangGraph 的执行模型是 **superstep（超步）**：每个 superstep 里，所有「入边条件已满足」的节点并行执行，它们返回的 `Partial<State>` 经 reducer 合并进各个 **channel**（状态通道），形成下一版状态，然后进入下一个 superstep。

checkpointer 就挂在 superstep 的**边界**上：每跨过一步，就把「当前所有 channel 的值 + 元数据」落盘一次。以本项目阶段 4 那张最小图为例：

```
输入 ──► 初始帧 ──► superstep 1 ──► superstep 2 ──► superstep 3
        (写入输入)     (start)          (llm)           (end)
            │             │                │               │
       checkpoint(0)  checkpoint(1)   checkpoint(2)   checkpoint(3)
```

**一张 3 节点的线性图，会产生约 4 个 checkpoint**（入口一帧 + 每个 superstep 一帧）。每个 checkpoint 还会附若干条 `writes`（记录本步每个 task 对每个 channel 写了什么，用于精确恢复）。

这解释了两件常被误解的事：

1. **一轮对话 ≠ 一个 checkpoint**。一轮对话是一个 `invoke`，而一个 `invoke` 会推进很多个 superstep；如果图里有 ReAct 环（阶段 6），工具轮次会让步数继续增加。
2. **checkpoint 是「状态快照」，不是「消息日志」**。它记的是「此刻整张图的所有 channel 是什么」，而不是「用户第 3 句说了什么」。

### 3.3 三项招牌能力

#### 能力一：中断恢复（resume）

checkpointer 存在时，图跑完一次后状态仍在。再调一次、且**不提供新输入**（Python: `invoke(None, config)`），就会从该线程最新的 checkpoint 继续。这就是「断点续跑」。

- 典型场景：进程重启、连接断开、任务被调度器抢占后重新拉起，**从上次停下的地方继续**，而不是从头再来。
- 关键前提：状态必须**可序列化**。这正是 LangGraph 坚持「状态放在 channel 里、节点是纯函数」的原因——栈帧没法存，channel 可以。

#### 能力二：时间旅行（time travel / replay）

`get_state_history(config)`（TS: `getStateHistory`）可以列出整条 checkpoint 链；指定某个 `checkpoint_id` 再 `invoke`，就能**从历史某一帧继续**，并产生一条新分支。

- 典型场景：第 3 步的输出不理想，回到第 3 步、改一个参数、重跑后面几步——不重跑前面已经花过钱的部分。
- 注意：这不是「重放事件流」。时间旅行回放的是**状态**，不是**过程**；要看过程（每个 token、每次工具调用），还是得靠事件日志。

#### 能力三：HITL（human-in-the-loop，人工介入）

节点内调用 `interrupt()` 可以让图**停在半路**，把问题抛给人类；人工回答后，用 `Command(resume=<值>)` 把答案送回那个节点，继续执行。

- 典型场景：Agent 要执行「删除数据库」这类危险工具前，先暂停等审批；审批通过再继续。
- 这一项**没有 checkpointer 就做不了**：因为暂停意味着进程要退出，状态必须落到外部存储里。

### 3.4 两端怎么接（依赖、表、代码骨架）

#### TS 侧

| 项 | 内容 |
| --- | --- |
| 依赖 | `@langchain/langgraph-checkpoint-postgres`（外加它的 peer 依赖 `pg`） |
| 主要导出 | `PostgresSaver` |
| 接法 | `builder.compile({ checkpointer })`；调用时在 `configurable.thread_id` 里给线程 id |
| 辅助 | 还有 `MemorySaver`（进程内存储，重启即失，**只能用于测试**） |

```ts
// 示意代码（非本项目文件）：TS 侧接入 Postgres checkpointer 的最小骨架
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!)
await checkpointer.setup() // 建表（幂等）；注意：这是「运行期 DDL」

const graph = builder.compile({ checkpointer })
await graph.invoke(input, { configurable: { thread_id: 'conv_123' } })
```

#### Python 侧

| 项 | 内容 |
| --- | --- |
| 依赖 | `langgraph-checkpoint-postgres`（同步 `PostgresSaver` / 异步 `AsyncPostgresSaver`） |
| 导入 | `from langgraph.checkpoint.postgres import PostgresSaver`；异步在 `.aio` 子模块 |
| 接法 | `builder.compile(checkpointer=checkpointer)`；调用时 `config={"configurable": {"thread_id": ...}}` |
| 辅助 | `MemorySaver`（`langgraph.checkpoint.memory`），同样只适合测试 |

```python
# 示意代码（非本项目文件）：Python 侧接入 Postgres checkpointer 的最小骨架
from langgraph.checkpoint.postgres import PostgresSaver

with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
    checkpointer.setup()  # 建表（幂等）
    graph = builder.compile(checkpointer=checkpointer)
    graph.invoke(state, {"configurable": {"thread_id": "conv_123"}})
```

#### 它会创建哪些表

checkpointer 不是「往你的表里加一列」，而是**自己建一套表**。以当前版本的 Postgres saver 为例：

```sql
-- 以 langgraph-checkpoint-postgres 1.x 为例；表集合与列类型随版本变化
checkpoints             -- 一帧一行：thread_id / checkpoint_ns / checkpoint_id / parent / type / metadata
checkpoint_blobs        -- 按 channel 存序列化后的值（blob 即二进制数据块；较新版本才有）
checkpoint_writes       -- 本 superstep 中每个 task 对每个 channel 的写入
checkpoint_migrations   -- 库自己的 schema 版本号（证明「这套表会随库升级而变」）
```

**这两点必须记住，它们是第 4 节论证的基石：**

1. **表结构属于库的实现细节**。早期版本只有 `checkpoints` + `checkpoint_writes`，且值以 JSONB 存；新版本拆出了 `checkpoint_blobs`，改用二进制。`checkpoint_migrations` 的存在本身就是「库承认自己会改表」的自白。
2. **两端是两套独立实现**。包名不同、代码库不同、序列化实现不同（Python 侧是 `JsonPlusSerializer`，底层用 **msgpack**——一种紧凑的二进制序列化格式——再加类型标签；JS 侧有自己的序列化层）、`checkpoint_migrations` 的版本推进也各自独立。**官方没有把「跨语言互读同一份 checkpoint」列为支持场景**。

### 3.5 它的边界：checkpointer 不负责业务语义

这一点最容易被忽略，但对本项目是决定性的。checkpointer 的表里**没有**这些东西：

| 业务需要的东西 | checkpointer 有吗 | 说明 |
| --- | --- | --- |
| 这条会话属于哪个用户 / 哪个应用 | ❌ | 它只有 `thread_id`，归属是你自己的业务概念 |
| 会话标题 | ❌ | 纯业务字段 |
| 消息条数（列表页要显示） | ❌ | 只能在运行时聚合，且「消息」得先解码才知道 |
| 会话内连续、从 1 递增的 `seq` | ❌ | checkpoint 的编号是 superstep 步号，每个 run 重新计，**不是消息序号** |
| 用户可见的「谁说了什么」 | ⚠️ | 要挑对 checkpoint、解 blobs、再从某个 channel 里挑字段，且图内 `messages` 还混着 `ToolMessage` |
| 历史窗口裁剪 | ❌ | 它保存**全量** channel 值，不替你按条数/ token 预算裁剪 |
| 删除会话时级联清理 | ❌ | 要自己按 `thread_id` 删三张表，且没有你定义的 `ON DELETE CASCADE` |

一句话：**checkpointer 记录「图此刻是什么样」，业务表记录「用户看到过什么」。前者是过程，后者是事实。**

---

## 4. 为什么本项目没选它

三条理由。**请按顺序读**，因为它们不是并列的「优缺点」，而是三层不同性质的否决：第一条是**产品层面的不匹配**，第二条是**项目最高约定层面的违规**，第三条是**长期成本**。

### 4.1 理由一：职责不同——它存的是「图内部状态」，我们要的是「用户可见记录」

这是最根本的一条，也是唯一一条**即使只做单语言、只用一个数据库、永远不升级库**也依然成立的理由。

#### 先看 checkpointer 实际存了什么

回到本项目的 `RunState`（`apps/api-ts/src/engine/engine.service.ts` 第 66~99 行）：

```ts
const RunState = Annotation.Root({
  pool: ...,      // { inputs, conversation?, <nodeId>: <该节点输出> }
  messages: ...,  // { <llmNodeId>: BaseMessage[] }  ← 注意：按节点分桶
  rounds: ...,    // { <llmNodeId>: 工具轮次 }
  toolCalls: ..., // { <llmNodeId>: 上一轮待执行的工具调用 }
  branches: ...,  // { <conditionNodeId>: 选中分支 }
})
```

这五份状态有一个共同特征：**它们都以「节点 id」为键，服务于「下一跳怎么走」**。其中最容易误导人的是 `messages`：

| 名字 | 类型 | 里面装什么 | 给谁看 |
| --- | --- | --- | --- |
| 图状态 `messages` | `Record<nodeId, BaseMessage[]>` | 某个 `llm` 节点在 ReAct 多轮里累积的 `SystemMessage` / `HumanMessage` / `AIMessage` / `ToolMessage`，含 `tool_calls` | **模型**（下一轮继续推理用） |
| 业务表 `messages` | 一行一条 | `role` + `content` + `seq`，角色只有 `user` / `assistant` / `system` | **人**（历史列表、会话详情） |

**同名，但一个是「给模型的上下文」，一个是「给人的发言记录」，语义完全不同。** 这是本项目最值得记住的一个教训：名字撞车不代表可以互换。

#### 再看产品实际需要什么查询

阶段 9 的会话接口（`apps/api-ts/src/conversations/conversations.controller.ts`）只有四件事：

| 接口 | 需要的查询 | 用业务表的代价 | 用 checkpointer 的代价 |
| --- | --- | --- | --- |
| `GET /apps/{id}/conversations` | 按 `ownerId + appId` 过滤、按 `updatedAt` 倒序、附带 `messageCount` | 一条带索引的查询 + `_count` | 要 `DISTINCT thread_id`、自己算「最后活动时间」、再解码数消息 |
| `POST /apps/{id}/conversations` | 插入一行，带 `title` | 一条 insert | **没有 title 这个概念**，得自己另建表 |
| `GET /conversations/{id}/messages` | 按 `seq` 升序取全部消息 | `ORDER BY seq`，语义确定 | 要选「哪个 checkpoint 才是这一轮结束」→ 解 blobs → 从 channel 里抽消息 → 过滤掉工具消息 |
| `DELETE /conversations/{id}` | 删一行，消息由 `ON DELETE CASCADE` 清理 | 一条 delete | 按 `thread_id` 删三张表，且删不干净会污染后续线程 |

这里的关键不是「麻烦」，而是**语义缺失**：

- `seq` 要求「会话内从 1 连续递增」。checkpoint 的步号是「本次 run 的 superstep 计数」，**每个 run 重新开始**，一轮对话里还会出现多个步号。拿它当消息序号，会出现重复与空洞。
- `updatedAt` 的业务定义是「最后一条消息的时间」。checkpoint 的时间是「最后一次状态写入的时间」，在「读状态 / 续跑」等场景下会与你想要的定义分叉。
- 归属校验（`ownerId`、`appId`）是**业务概念**，checkpointer 完全不感知。你仍然得建 `conversations` 表来放归属，那它就已经不是「替代方案」了，而是「多一套表」。

**结论一**：checkpointer 不是业务表的上位替代，它是另一个维度的东西。**选了它，你还是得建业务表**——只是多背一套库的表和一套序列化。**在「只是多轮聊天上下文」这个需求下，它增加的全是成本。**

#### 反面确认：本项目实际用业务表做到了什么

三条实测事实（§10 可复现）：

1. 两端同一会话的 `messages`（`role` / `content` / `seq`）**完全一致**；
2. `GET /conversations/{id}/messages` 返回 **4 条，`seq` 为 1..4**，连续无空洞；
3. 会话相关接口都是**普通业务查询**，不 import 任何图/执行相关符号（TS 侧只依赖 Prisma；Python 侧只借用 `app.engine.template.js_json_dumps` 这个纯序列化函数）。

这三条恰好就是「职责不同」的正面证据：业务表能给出 checkpointer 给不了的三样东西——**连续序号、稳定排序、与执行引擎解耦**。

### 4.2 理由二：跨语言一致——TS 与 Python 是两套库、两套表、两套序列化

这一条是**项目级的否决**。总纲把「契约优先 · 双实现」列为最高优先级约定（§5.5、§8），验收方式一直是「同一输入打两套后端，逐字节比对」。而 checkpointer 在这条线上是**结构性**不兼容的，不是「多写点代码就能对齐」的那种不兼容。

论证分三步：

#### 第一步：两套后端共用同一个数据库

总纲 §1.3 明确：PostgreSQL 由两套后端共用。`docker-compose.yml` 里只有一个 `db` 服务。

于是「两端各接各的 checkpointer」会出现两种选择，**两种都坏**：

| 做法 | 会发生什么 |
| --- | --- |
| 两端都往 `public` 写同名表 | `checkpoints` / `checkpoint_writes` 同名但序列化格式不同；`checkpoint_migrations` 被一端升到新版本，另一端可能不认识；同一个 `thread_id` 的链被两种格式混写 → **续跑时读到对方写的帧，直接失败** |
| 两端各用一个 schema / 各加前缀隔离 | 隔离是隔离了，但「同一个会话在 api-ts 聊两句、切到 api-py 再聊两句」就**读不到对方的历史**——而前端切换后端只需要改 `NEXT_PUBLIC_API_BASE`，用户视角就是「历史突然没了」 |

本项目「契约一致」的验收，恰恰依赖**切换后端后行为不变**。checkpointer 让这个承诺在存储层就破产。

#### 第二步：序列化格式不互通，且这不是 bug

Python 侧用 `JsonPlusSerializer`（msgpack + 类型标签），JS 侧有它自己的实现。**库把「序列化后的字节」当作内部格式**，没有任何兼容承诺。哪怕表结构完全一样，payload 也是对方看不懂的。

这意味着：**一条在 api-ts 上开始的线程，无法被 api-py 续跑。** 而「续跑」正是 checkpointer 唯一的卖点——卖点在双语言项目里直接失效。

#### 第三步：契约测试失去抓手

阶段 4~8 的验收方法是：同一输入打两端，**事件名序列 / payload 键集合 / 帧格式逐字节比对**（见 `04-执行引擎/07-验收.md`）。这套方法之所以可行，是因为两端的「可观测输出」由同一份契约规定。

而 checkpointer 的中间状态**不属于契约**，也无法写成契约（它是库的实现细节）。你只能退而求其次，测「恢复后的最终行为是否等价」——这需要构造「运行到一半 → 停 → 换端恢复」的测试，成本高、场景多、仍然只能证明「行为像」，证明不了「存储一致」。

**结论二**：自建表让「存储层」也成为可比对的对象（同一张表、同一份 Prisma DDL、同一套字段语义），这是本项目一致性的**加分项**；checkpointer 则把存储层变成不可比的**黑盒**。在「双实现」是最高约定的项目里，这一条足以一票否决。

### 4.3 理由三：可迁移——业务数据是你的，checkpointer 的表是库的

这一条不是「现在会出问题」，而是「将来会被绑住」。四个具体理由：

#### 1）迁移所有权被破坏

本项目有一条明确约定：**Prisma 拥有 DDL，SQLAlchemy 只做映射**（`01-账号与认证/04-SQLAlchemy2.0.md`；`apps/api-py/app/models/conversation.py` 的文件头也再次强调「Python 只做映射与读写、不产生 DDL」）。

checkpointer 的 `setup()` 会在**运行期**执行 `CREATE TABLE`。这意味着出现**第三个 DDL 所有者**，而且它不受你的迁移流程管控：

- 迁移是「构建期、可 review、可回滚」的动作；`setup()` 是「启动期、隐式、随库版本变」的动作；
- 生产环境常见「应用账号无 DDL 权限」的配置，`setup()` 会直接失败；
- 多副本同时启动时，`setup()` 的并发建表/版本写入需要额外的互斥处理。

#### 2）表结构会随库版本变（有实证）

`checkpoint_migrations` 这张表的存在，就是库在告诉你「我的 schema 有版本」。而版本确实推进过：早期是 `checkpoints` + `checkpoint_writes` 且值用 JSONB，后来拆出 `checkpoint_blobs`、改用二进制。**你升级一次 `langgraph`，就可能要跟着迁移一批你不理解的表。**

#### 3）两端版本独立演进，共用库会「版本打架」

本项目的依赖范围是各自钉的：

```text
apps/api-ts/package.json   "@langchain/langgraph": "^1.5.1"
apps/api-py/pyproject.toml "langgraph>=1.2.16"
```

两个生态的发版节奏不同。当 TS 侧的 checkpointer 把 schema 推到 v3、Python 侧还停在 v2 时，同一个数据库就同时被两种期望对待。**这在业务表上不会发生**，因为业务表的 DDL 只有一份（Prisma 迁移），两端只是映射。

#### 4）换引擎/换框架时被绑架

业务表是**普通数据**：换个执行引擎、把 LangGraph 换成别的东西、甚至换个数据库，都能导出、能迁移、能重建。

checkpointer 的表是**库的内部结构**：它离开 LangGraph 就没有意义，payload 也解不出来。一旦将来阶段 11 的 Python 侧改用 Pydantic AI（总纲 §3.10 已确定），Python 侧根本没有 LangGraph checkpointer——**这套数据在那一侧直接变成死数据**。

**结论三**：自建表把「存储」变成项目的资产；checkpointer 把「存储」变成库的附庸。前者可演进，后者只能跟随。

### 4.4 三条理由不是并列的

| 层级 | 理由 | 性质 | 如果只有这一条，还会不会选业务表 |
| --- | --- | --- | --- |
| 产品层 | 职责不同 | **需求根本不匹配** | 会——因为 checkpointer 连「列会话、看历史」都做不到 |
| 项目层 | 跨语言一致 | **违反最高约定** | 会——双实现项目无法接受「换后端就丢历史」 |
| 长期层 | 可迁移 | 成本与风险 | 单看这条可以权衡（比如只做单语言原型时，接 checkpointer 反而更快） |

所以本篇的真正结论不是「checkpointer 不好」，而是：**它的适用面比总纲当初设想得窄**。总纲把它列进阶段 9，是把它当成「会话持久化」的候选；读完这一节你应该能判断，它其实是「执行可恢复性」的工具。

---

## 5. 代价：诚实记账

选了业务表，就必须承认失去了什么、多做了什么。这一节是本篇的「另一半」，不写清楚就是耍流氓。

### 5.1 我们失去了什么

| 失去的能力 | 具体表现 | 后果 |
| --- | --- | --- |
| **中断恢复** | 连接断开、进程重启，这一轮就结束了；没有「从上次停下的地方继续」 | 长任务（分钟级以上）无法可靠完成；只能让用户重发 |
| **时间旅行 / superstep 回放** | 不能「回到第 3 步、改参数、重跑后面」；只能整轮重跑 | 调试与调参成本高 |
| **HITL** | 图无法在中间暂停等人工审批 | 危险操作只能靠「事先不给这个工具」来规避 |
| **细粒度执行审计** | 没有每步的状态快照，只有 SSE 事件流 | 事后复盘只能看事件，不能看「当时的状态」 |
| **精确的失败点恢复** | `run_failed` 之后，这一轮的执行现场不保留 | 无法「修好参数再从中断点续跑」 |

### 5.2 我们自己实现了什么

这部分正好是阶段 9 的学习内容（细节在本阶段第 `01`、`02` 两篇）：

| 自己实现的部分 | 在哪 | 关键设计 |
| --- | --- | --- |
| **历史加载** | `loadHistory`（TS）/ `load_history`（Py） | 按 `seq` 倒序 `take(limit)` 再 `reverse()`，返回升序 |
| **窗口裁剪** | `MAX_HISTORY_MESSAGES`（默认 20） | 「最近 N 条」，两端同一实现、同一默认值 |
| **会话上下文注入** | `buildConversationContext` → `pool.conversation` | 形状固定 `{id, history, messages}`，两端逐字节一致 |
| **用户消息回写** | `engine.service.ts` 的 `run()` / `run.py` | **先读历史、再写用户消息**（顺序颠倒会让模型看到两条相同的用户话） |
| **助手消息回写** | `run_finished` **之前**写 | 内容规则：`outputs` 单键取字符串值，否则紧凑 JSON；写失败由统一 `catch` 发唯一一帧 `run_failed`；`run_failed` **不写** |
| **并发安全** | `seq = max(seq) + 1` | 事务内读取 + 唯一约束 `(conversation_id, seq)` 兜底 + 冲突时重试（最多尝试 3 次；TS `P2002` / Py `IntegrityError`） |
| **归属与级联** | `ownerId` + `appId` 校验 | 不符一律 404 `Conversation not found`；删除走数据库 `ON DELETE CASCADE` |

### 5.3 额外付出的代价（不粉饰）

1. **会出现「半截记录」**。用户消息在开流前就写入了，助手消息在 `run_finished` 前才写；`run_failed` 时**不写助手消息**。于是一次失败的运行会在库里留下「用户说了话，但没有任何回答」。这是刻意的取舍（宁可留下真实发生过的事，也不写一条假回复），但产品上要接受它。
2. **窗口是「条数」而不是「token 预算」**。20 条长消息可能远超上下文窗口；真正的「按 token 压缩」要留到阶段 11 的上下文压缩（compaction）。checkpointer 同样不解决这个问题——它存全量，裁剪仍然要你自己做。
3. **没有「运行中」状态**。`POST /run` 仍是一个 HTTP 连接撑着整轮执行；连接一断，前端就丢了后续事件。总纲风险表里「同步执行阻塞请求」说的就是这件事。
4. **将来若接入 checkpointer，删除会话要删两处**。业务表删了，checkpoint 链还在——需要额外的一致性处理。这是「两套存储」的固有成本。

---

## 6. 对照表

> 这张表是**结论的浓缩**，理由在上面各节；不要只看表不看论证。

| 维度 | LangGraph checkpointer | 自建 `conversations` / `messages` |
| --- | --- | --- |
| **存什么** | 图状态 channel 的**逐 superstep 快照**（`pool` / `messages` / `rounds` / `toolCalls` / `branches`）+ 元数据；面向「机器继续跑」 | 用户可见的**对话事实**：归属、标题、`seq`、`role`、`content`；面向「人看 + 业务查询」 |
| **查询友好度** | 差。列会话要 `DISTINCT thread_id` + 聚合；看历史要选 checkpoint、解 blobs、挑 channel、过滤工具消息；没有 title / messageCount / seq | 好。列表是一条索引查询 + `_count`；历史是 `ORDER BY seq`；字段语义与接口一一对应 |
| **跨语言一致** | 两套库、两套表、两套序列化、两套 schema 版本；共用同一 PG 时要么冲突、要么切换后端丢历史；存储层无法纳入契约测试 | 同一张表、同一份 Prisma DDL、同一套字段语义；两端读写**逐字节可比**（实测 `role`/`content`/`seq` 完全一致） |
| **中断恢复** | 原生。`invoke(None, config)` 从最新 checkpoint 续跑 | 不支持。一次 `POST /run` 就是一条完整请求，断开即结束 |
| **时间旅行** | 原生。`get_state_history` + 指定 `checkpoint_id` 重放/分叉 | 不支持。只有消息文本，没有「当时的状态」 |
| **迁移风险** | 高。表结构属于库实现细节（JSONB → blob、新增 `checkpoint_blobs`）；`setup()` 是运行期 DDL，破坏「Prisma 拥有 DDL」；两端版本独立演进会在共用库里打架 | 低。普通业务表，DDL 由自己的迁移拥有；换引擎/换框架不受影响；数据可导出、可重建 |
| **实现成本** | 接上很快（两行配置 + `setup()`），但**用好**很贵：线程生命周期、序列化、双端对齐、写放大（每 superstep 一帧 + 每条 write）、删除一致性 | 起步要自己写：建表、归属校验、`seq` 并发、窗口裁剪、回写时机——**这些正是阶段 9 的教学内容，不是额外负担** |

**一句话读表**：checkpointer 在「恢复/回放」两格全胜，在其余五格全输或明显吃亏；而阶段 9 的需求恰好只落在后五格。

---

## 7. 什么时候应该反过来选 checkpointer

判断标准只有一条，其余都是它的推论：

> **是否需要「从图内部的某一步继续」？**
>
> - **是** → 必须用 checkpointer（或等价的状态快照机制）。
> - **否** → 自建消息表更简单、更可控。

按这条标准展开：

| 需求信号 | 选什么 | 为什么 |
| --- | --- | --- |
| 长任务（分钟~小时级），不能靠一个 HTTP 连接撑着 | **checkpointer + 异步 run** | 进程随时可能没；只有状态落盘才能续跑 |
| 图中间要停下等**人工审批 / 补充信息** | **checkpointer + `interrupt`** | 暂停意味着进程退出，栈帧存不下来，只有 channel 能存 |
| 要「回到第 3 步、改参数、重跑后面」 | **checkpointer**（时间旅行） | 需要历史状态帧，消息文本给不了 |
| 每一步都要能**精确重放**做对账/审计 | **checkpointer**（状态）+ **事件日志**（过程） | 两者互补：一个存「是什么」，一个存「怎么变的」 |
| 多轮聊天、看历史、删会话、统计条数 | **自建消息表** | 全是业务查询；checkpointer 连字段都没有 |
| 只是「把上下文喂给模型」 | **自建消息表 + 窗口裁剪** | 你要的是「最近 N 条消息」，不是「状态快照」 |
| 想「顺便」要个审计视图 | **事件表**（不一定是 checkpointer） | 审计要的是过程事实，不是状态快照 |

再补一条**反向**判断，避免过度设计：

> **不要因为「用了 LangGraph」就接 checkpointer。** 不传 checkpointer 的 `compile()` 是完全合法的默认用法——本项目阶段 4~8 全程如此。checkpointer 是**按需开启**的能力，不是框架的前置条件。

---

## 8. 两者可以共存（进阶）

### 8.1 分层：执行状态 / 业务记录 / 过程事实

这两者不是二选一，而是三层。成熟系统通常三层都有：

```
一次请求
   │
   ▼
执行引擎（LangGraph）
   ├── 状态 channel ──► checkpointer              ← 机器用：可恢复、可回放
   ├── 消息回写 ──────► conversations / messages   ← 人用：可查询、可管理
   ├── 事件流（SSE）──► 前端                      ← 过程展示
   └── 事件（可选）───► 事件日志                   ← 审计用：可重放过程
```

三层的分工：

| 层 | 回答的问题 | 生命周期 | 谁拥有 |
| --- | --- | --- | --- |
| checkpointer（执行状态） | 「这轮跑到哪了？能不能接着跑？」 | 一次 run / 一个 thread | **库** |
| 业务表（用户记录） | 「这个用户跟我说过什么？」 | 永久（业务数据） | **项目** |
| 事件日志（过程事实） | 「当时每一步发生了什么？」 | 可长可短（按留存策略） | **项目** |

**关键点**：checkpointer **不会**取代业务表（§4.1 已论证），业务表也**不会**取代 checkpointer（它没有状态）。两者共存时，唯一需要额外设计的是「**它们之间怎么对应**」——见 §9.4。

### 8.2 呼应阶段 11：自主 Agent 运行时正是 checkpointer 的场景

总纲 §3.10 的自主 Agent 运行时明确要求：

- `POST /agent/runs` 异步受理 → 轮询 + SSE，支持 `Last-Event-ID` **断点重放**；
- 保留 **HITL**（人类介入）与**上下文压缩**；
- TS 侧用 LangGraph（ReAct），**Python 侧用 Pydantic AI**。

这三点恰好说明了两件事：

1. **阶段 11 确实需要「状态可恢复」**——但不是「会话记录」，而是「一次 run 的执行现场」。所以 checkpointer（或等价机制）在阶段 11 是正当且必要的。
2. **checkpointer 不能成为跨语言的契约机制**。因为 Python 侧换成了 Pydantic AI，根本没有 LangGraph checkpointer。契约只能规定「**按 run id 可恢复、可重放**」这种**行为**，把「用什么存」留给各自实现。

这反过来印证了本篇的核心判断：**checkpointer 是实现细节，不是契约对象。** 阶段 9 把它当存储契约，方向就错了；阶段 11 把它当 TS 侧的实现手段，方向就对了。

另外要区分两个容易混淆的「重放」：

| 重放 | 重放的是什么 | 谁提供 |
| --- | --- | --- |
| `Last-Event-ID` 续传 | **事件流**（过程） | 事件日志 / 事件缓冲 |
| checkpointer 时间旅行 | **状态**（现场） | 库 |

两者互补，不能互相替代：有事件日志但没状态，你只能「看回放」；有状态但没事件日志，你只能「跳回去重跑」，看不到中间过程。

---

## 9. 如果我要在本项目接入 checkpointer，需要改什么

> **这是选做方向**，以下只列**改动点与坑**，不写完整实现。
> 建议的最小可行范围见 §9.8：**先在 TS 单端做一个 PoC，不动契约、不动 Python**——用它验证「恢复」到底值不值这个复杂度。

### 9.1 依赖与生命周期

| 端 | 要加的东西 | 位置 |
| --- | --- | --- |
| TS | `@langchain/langgraph-checkpoint-postgres`（+ `pg`） | `apps/api-ts/package.json` |
| Python | `langgraph-checkpoint-postgres` | `apps/api-py/pyproject.toml` |

生命周期不能「每次请求 new 一个」——连接池要复用：

- TS：放进一个 NestJS provider（`OnModuleInit` 里 `setup()`，`OnModuleDestroy` 里关闭）；`OnModuleInit` 的用法见 `01-账号与认证/02-Prisma.md`。
- Python：放进 FastAPI 的 **lifespan**（应用的启动/关闭生命周期钩子，`app.main`），用 `AsyncPostgresSaver` 或同步 saver + 线程池。
- **坑**：`setup()` 是运行期 DDL。要么给应用账号 DDL 权限（不推荐），要么**只让一个进程执行一次**（迁移脚本 / 部署钩子），其余进程只连不建。

### 9.2 `thread_id` 从哪来

现有请求里唯一**天然唯一、且已做归属校验**的标识是 `conversationId`（`RunRequest.conversationId`，`apps/api-ts/src/engine/engine.service.ts` 的 `run()` 已用 `assertOwnedByApp` 校验）。所以最自然的映射是：

```text
thread_id := conversationId
```

但必须想清楚三件事：

| 问题 | 说明 |
| --- | --- |
| **一个 thread 装什么** | 建议「一个会话 = 一个 thread」：这样续跑/时间旅行的粒度与用户心智一致。若改成「一个 run = 一个 thread」，时间旅行只覆盖单轮，跨轮历史又得回到业务表 |
| **`runId` 不能当 `thread_id`** | `runId` 是在 `execute()` 里才 `randomUUID()` 生成的（**晚于**用户消息写入）。拿它当 thread 会让「同一会话的多次运行」彼此孤立 |
| **`checkpoint_id` 要不要落库** | 如果只想「继续跑」，不用存；如果要「精确回到某次运行的某一帧」，就必须把该帧的 `checkpoint_id` 记下来（见 §9.4） |

### 9.3 表与 schema：不要放进 `public`

这是最容易踩的坑。建议：

1. **给 checkpointer 一个独立 schema**（例如 `langgraph`），通过连接串参数（`options=-c search_path=...`）或单独的连接指向它。理由：避免与业务表混在一起，也避免 Prisma 的迁移视图被污染（项目已经吃过「Prisma 会 DROP 手工索引」的亏，见 INDEX「已知遗留」）。
2. **不让两端都跑 `setup()`**。共用同一个库时，`checkpoint_migrations` 的版本推进必须只有一个主人。建议：**TS 侧负责 `setup()`（或写进一个一次性脚本），Python 侧只连接、只读写**。
3. **接受「库拥有这套表的 DDL」**，并在文档里把它记成**例外**（与「Prisma 拥有 DDL」并列，注明 `langgraph` schema 归库管）。不要试图把它的建表语句抄进 Prisma 迁移——库一升级你就要手工跟。

### 9.4 与现有 `messages` 表的关系

**结论：不替换，只叠加。** 需要新增的是一条「映射」，而不是改消息表语义。两种做法：

| 做法 | 怎么改 | 代价 |
| --- | --- | --- |
| **A. 新增一列**（推荐） | `messages.checkpoint_id`（nullable）——助手消息写回时把当轮结束帧的 id 一起写 | 要加迁移（Prisma），Python 侧加映射；契约是否暴露该字段需讨论（建议**不暴露**，纯内部） |
| **B. 借用元数据反查** | 把 `runId` 放进 LangGraph 的 `config.metadata`，恢复时按 metadata 查 checkpoints | 不改表，但依赖库的 metadata 语义，查询也更绕 |

还要明确两个「不变量」：

1. **用户消息的 `runId` 目前是 `null`**（先写用户消息、后生成 runId）。如果要做「按 run 恢复」，要么把 runId 提前生成，要么接受「用户消息只能靠 `seq` 定位」。
2. **`run_failed` 不写助手消息**这条规则不要改——checkpointer 的存在不改变「用户可见记录只记真实发生的事」这个原则。

### 9.5 编译与调用点改动

只有两处，但都在这条主链上：

| 文件 | 改动 |
| --- | --- |
| `apps/api-ts/src/engine/engine.service.ts` | `builder.compile()` → `builder.compile({ checkpointer })`；`invoke(input, { recursionLimit })` → 追加 `configurable: { thread_id: conversationId }` |
| `apps/api-py/app/engine/engine.py` | `builder.compile()` → `builder.compile(checkpointer=...)`；`config={"recursion_limit": ...}` → 合并 `{"configurable": {"thread_id": conversation_id}}` |

**注意**：没有 `conversationId` 的运行（纯调试、无会话）不能传 `thread_id`。要么走不带宽度的 `compile()`（即准备两个编译入口），要么生成一个临时 thread。前者的代价是「两条编译路径」；后者会在库里留下大量一次性线程。**两种都要显式设计，别让它变成隐式分支。**

### 9.6 两端对齐的难点（真正的成本在这里）

| 难点 | 具体表现 | 为什么难 |
| --- | --- | --- |
| **状态键命名** | TS `toolCalls` / Python `tool_calls`；TS `RunState` 用 `Annotation`、Python 用 `TypedDict + Annotated` | 快照内容天然不同名，跨端比对必须做归一 |
| **消息序列化** | `AIMessage` / `ToolMessage` 两端的字段与编码不同 | 库内部格式，无法写进契约 |
| **写放大与行数** | 每个 superstep 一帧 + 每帧多条 writes；一轮对话可能几十行 | 业务表一轮只有 2 行；存储与清理策略都要重估 |
| **并发与顺序** | 同一 `thread_id` 并发两次 `invoke` 的语义由库决定 | 业务表的 `seq` 冲突是**显式**的（唯一约束 + 重试），checkpointer 的冲突是**隐式**的 |
| **测试口径** | 只能测「恢复后行为等价」，不能测「存储字节一致」 | 与项目现有的「逐字节比对」验收范式不匹配 |

**一句话**：接上是一小时的事，让两端「行为一致且可测」是以周计的事。这就是为什么它适合做**选做 PoC**，不适合塞进阶段 9 的主线。

### 9.7 契约层要不要动

- **只为「持久化」接入：不需要动契约。** `messages` / `conversations` 接口不变，`run_started` 也不变。
- **一旦要暴露「恢复」能力，就必须动契约**：需要「发起恢复」的接口（例如 `POST /apps/{id}/runs/{runId}/resume`）、需要新的流内事件（例如 `run_interrupted`）、需要 `runId` 从「只在事件里出现」变成「可查询的资源」（那就要建 `runs` 表）。

**判断**：这些都属于阶段 11（HITL / 事件流与重放）的契约面。**阶段 9 引入它们＝范围蔓延**，与总纲 §1.2「严守非目标」相悖。所以：阶段 9 若要接，只接「不暴露给契约」的内部持久化。

### 9.8 建议的最小可行范围（PoC）

> **PoC** = proof of concept，概念验证：用最小代价证明「这条路走得通」，不追求完整。

如果真要动手，按这个顺序，每步都可独立回滚：

1. 只改 TS 端；独立 `langgraph` schema；只在一个固定的 `conversationId` 上验证。
2. 只验证一件事：**跑到 `interrupt()` 停下 → 重启进程 → `Command(resume=...)` 继续**，事件流能接上。
3. 验证「同一次运行重跑会新增一条分支」（时间旅行）是否符合预期。
4. **先不碰 `messages` 表、不碰契约、不碰 Python**。等阶段 11 的 Run 模型落地时，再决定要不要正式化。

---

## 10. 验收自测：证明「业务表已经够用」

> 本节不验证 checkpointer（本项目没接），而是验证**现状**：业务表能提供 checkpointer 给不了的查询语义，且两端一致。

### 10.1 库里只有业务表，没有 checkpoint 表

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'checkpoint%';"
```

**预期**：`(0 rows)`。这证明阶段 9 的持久化**完全由业务表承担**。

### 10.2 `seq` 是连续的消息序号（不是 superstep 步号）

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "select conversation_id, seq, role, left(content, 24) as content from messages order by conversation_id, seq;"
```

**预期**：实测会话为 **4 行，`seq` 依次 `1,2,3,4`**，`role` 交替为 `user` / `assistant`。连续、无空洞——这正是 `seq` 作为业务序号的意义，也是 checkpointer 的步号给不了的。

### 10.3 两端读同一会话，返回逐字节相同

先登录拿 token（两端令牌互认，见 `01-账号与认证/07-验收.md`），再执行：

```powershell
$TOKEN = "<登录响应里的 accessToken>"
$CONV  = "<会话 id>"

$a = curl.exe -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3001/conversations/$CONV/messages"
$b = curl.exe -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8000/conversations/$CONV/messages"

Compare-Object $a $b
```

**预期**：**无输出**（两份响应完全一致）。原因很直接：两端读的是**同一张表、同一批行**，且时间字段都按 `iso_z` 归一（`02-应用管理/07-验收.md`），所以连 `id`、`createdAt` 都逐字节相同。

> 小心假阳性：如果 token 失效，两条都会返回同一个 401，`Compare-Object` 同样「无输出」。先确认 `$a` 不是 401：

```powershell
$a   # 应是一行以 {"items":[ 开头的 JSON
```

再看结构：

```powershell
($a | ConvertFrom-Json).items | Format-Table seq, role, content
```

**预期**：`seq` 1~4，`role`/`content` 与库中一致，`items.Count = 4`。

### 10.4 会话模块与执行引擎解耦

```powershell
Select-String -Path apps\api-ts\src\conversations\*.ts -Pattern "langgraph" -CaseSensitive:$false
Select-String -Path apps\api-py\app\conversations\service.py -Pattern "langgraph" -CaseSensitive:$false
```

**预期**：两条命令都**无输出**。也就是说，会话的列表/详情/删除/消息查询**完全不依赖执行引擎**——引擎可以换、可以不跑，会话接口照常工作。

> 说明：Python 的 `service.py` 确实 import 了 `app.engine.template.js_json_dumps`，但那是一个**纯序列化函数**（保证两端 JSON 字节一致），不是图/执行相关的符号。用 `langgraph` 作为搜索词可以排除这个干扰。

### 10.5 （可选）观察「半截记录」

把 LLM 指向一个不可达的地址（改 `apps/api-ts/.env` 的 `LLM_BASE_URL`），跑一次带 `conversationId` 的运行：

**预期**：SSE 里出现 `run_failed`（**没有** `node_finished`），随后 `GET /conversations/{id}/messages` 只多了一条 `user` 消息，**没有对应 assistant**。

这是 §5.3 第一条的实证：我们接受「真实发生过的事」，不补写假回复。checkpointer 在同样的失败场景下能保留执行现场，但同样不会让这条「半截记录」消失（它不写业务表）。

---

## 11. 常见误解与坑

这些坑大多出现在「刚学完 checkpointer、跃跃欲试」的时候。

| 误解 / 坑 | 现象 | 真相 |
| --- | --- | --- |
| **「用了 LangGraph 就必须接 checkpointer」** | 以为不接就跑不起来 | 不接是默认用法；`compile()` 不传 checkpointer 完全正常（阶段 4~8 就是） |
| **「checkpointer 可以当聊天记录表」** | 接了以后发现列表页做不出来 | 它没有 title / 归属 / `messageCount` / `seq`；要解 blobs 才能看到内容 |
| **「图里的 `messages` 就是聊天记录」** | 直接把 `state.messages` 当历史返回给前端 | 它是 `Record<nodeId, BaseMessage[]>`，含 `ToolMessage`、`tool_calls`，是给模型的上下文 |
| **「`thread_id` 就是会话 id」** | 以为可以直接互换 | 语义可以映射，但 `thread_id` 属于库、`conversationId` 属于业务；且一个 thread 可含多次 run |
| **「一轮对话 = 一个 checkpoint」** | 按 checkpoint 数统计对话轮次 | 一轮对话有多个 superstep，也就有多个 checkpoint；一轮可能产生十几帧 |
| **「checkpointer 会自动裁剪历史」** | 以为接了就不用管上下文长度 | 它保存**全量** channel 值；窗口裁剪仍要自己做（本项目是 `MAX_HISTORY_MESSAGES`） |
| **「两端表名一样就能互读」** | 以为共用 PG 就天然一致 | 序列化器与 schema 版本都不同，payload 不互通；混合写入会让续跑直接失败 |
| **「`setup()` 幂等，随便调」** | 每个进程启动都调 | 幂等 ≠ 无并发问题；它是运行期 DDL，多副本会竞争，无 DDL 权限的账号会失败 |
| **「接上 checkpointer 就自动有 HITL」** | 以为 `compile({checkpointer})` 就支持暂停 | 还需要节点里的 `interrupt()`、恢复入口、契约上的中断事件与恢复接口——属于阶段 11 |
| **「不传 `thread_id` 也能跑」** | 编译时传了 checkpointer，调用时忘了 config | 运行期会报错，提示需要 `thread_id` 这类 configurable 键 |
| **「`MemorySaver` 也能当持久化」** | 开发时一切正常，重启后全丢 | 进程内存储；重启即失、多副本不共享，只能用于测试 |
| **「时间旅行 = 重放事件」** | 想用它看每个 token | 时间旅行回放的是**状态**，不是**过程**；看过程要事件日志 |

---

## 12. 复盘与技术点登记

### 12.1 五条结论

1. **checkpointer 是「执行状态」的持久化，不是「用户记录」的存储**。它的价值在「从某一步继续」，不在「让人查历史」。判断选型的唯一标准：**要不要从图内部继续跑**。
2. **同名不等于同义**。图状态里的 `messages` 是「给模型的上下文（按节点分桶、含工具消息）」，业务表 `messages` 是「给人的发言记录（`role`/`content`/`seq`）」。混淆这两者，是本阶段最容易犯的概念错误。
3. **双语言 + 共用数据库，会把 checkpointer 的「实现细节」属性放大成事故**：两套库、两套表、两套序列化、两套 schema 版本。契约测试在存储层失去抓手，切换后端会丢历史。
4. **选业务表不是免费的**：我们失去了中断恢复、时间旅行、superstep 回放、HITL；换来的是查询友好、跨语言可逐字节比对、可迁移。代价要**明说**（包括「半截记录」这种不那么好看的部分）。
5. **两者最终会共存，但分层必须清楚**：checkpointer 管**执行现场**，业务表管**用户可见记录**，事件日志管**过程事实**。阶段 11 的自主 Agent 运行时正是需要第一层的场景——而在那里，checkpointer 也只能是**TS 侧的实现手段**，不能是跨语言契约（Python 侧换成了 Pydantic AI）。

### 12.2 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 | 备注 |
| --- | --- | --- |
| **LangGraph checkpointer** | `thread_id` / `checkpoint_id` / `checkpoint_ns`；按 superstep 落盘状态快照；`compile({checkpointer})` + `configurable.thread_id` | **首次教学于本篇** |
| **checkpointer 的两端实现与表** | TS `@langchain/langgraph-checkpoint-postgres`（`PostgresSaver`）/ Python `langgraph-checkpoint-postgres`；建 `checkpoints` / `checkpoint_blobs` / `checkpoint_writes` / `checkpoint_migrations`；表随版本变 | **首次教学于本篇** |
| **checkpointer 的三项能力与前提** | 中断恢复（`invoke(None, config)`）、时间旅行（`get_state_history` + `checkpoint_id`）、HITL（`interrupt` + `Command(resume=...)`）；前提是状态可序列化 | **首次教学于本篇** |
| **「执行状态 vs 业务记录」的职责边界** | 图状态 channel（按节点分桶、给模型）≠ 业务 `messages` 表（按 `seq`、给人）；checkpointer 不能替代业务表 | **首次教学于本篇** |
| **存储层选型的判断标准** | 「是否需要从图内部某一步继续」；长任务 / 人工审批 / 改参重跑 → checkpointer；多轮上下文 → 消息表 | **首次教学于本篇** |
| **「库的内部结构不能当契约」** | checkpointer 的表属于实现细节（`checkpoint_migrations` 即证据）；双语言共用库时不可互读、不可纳入契约测试 | **首次教学于本篇** |
| **checkpointer 与业务表共存的三层分工** | 执行状态（库）/ 用户记录（项目）/ 过程事实（事件日志）；区分「状态重放」与「事件重放（`Last-Event-ID`）」 | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：`StateGraph` / `Annotation` / reducer / compile-invoke（`04-执行引擎/02`、`04-执行引擎/04`）；superstep、环与 `recursionLimit`（`06-工具调用/02`）；「checkpoint 是后续阶段的扩展点」这一能力边界（`04-执行引擎/07` §5）；Prisma 拥有 DDL、SQLAlchemy 只映射（`01-账号与认证/04`）；`iso_z` 时间归一与「契约一致」的分层（`02-应用管理/07`、`03-画布/07`）。
