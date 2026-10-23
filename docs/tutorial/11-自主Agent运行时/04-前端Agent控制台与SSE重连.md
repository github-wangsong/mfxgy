# 04 · 前端 Agent 控制台与 SSE 重连

> 所属：阶段 11 · 自主 Agent 运行时
> 本篇覆盖：新增页面 `/agent`（`apps/web/app/agent/page.tsx`）——**三栏工作台**（配置 / 事件流 / 运行历史）、**Composition 用 JSON 文本框**并在本地预校验、**`id:` 行作为重连游标**、「从上次 id 重连」、**token 合并渲染**、`layer_started` / `layer_finished` 与工具事件的展示，以及 `sse.ts` 从 `app/apps/[id]/sse.ts` **迁到 `lib/sse.ts`** 的原因。
> **本篇首次教学**：**三栏工作台**（为什么 Agent 调试必须同时看到「我提交了什么」和「它做了什么」） · **声明式配置用 JSON 文本框而非表单**（层级深、组合多 → 表单爆炸；但必须**本地 `JSON.parse` 预校验**） · **`id:` 行 = 重连游标**（`SseEvent.id` 是阶段 4 解析器**没有**的字段） · **`Last-Event-ID` 重连**（**补发已落库事件，不是重跑**） · **连续 `token` 合并渲染**（一个「输出」区 + 一行 `token ×N`） · **`layer_started` / `layer_finished` 让「装配过程」可见** · **共享 SSE 解析器放 `lib/`**。
> 202 异步受理、Run 状态机、`run_queued` 为何落库、「先写库再推送」、重放衔接窗口与取消检查点见本阶段 `01-Run模型与事件重放.md`；Composition 与层语义见 `02-Composition声明式装配与层设计.md`；ReAct 与压缩见 `03-ReAct循环与上下文压缩.md`；端到端验收见 `05-验收.md`。
> `EventSource` 无法带 `Authorization`、`fetch` + `getReader`、`TextDecoder({stream:true})`、手动分帧算法与 **React 批处理**见 `04-执行引擎/06-前端SSE客户端与运行面板.md`；受控输入 / 列表 `map`+`key` / 三态见 `02-应用管理/06-前端应用列表页.md`；`apiErrorMessage`（字符串或数组）与 `API_BASE` 从 `NEXT_PUBLIC_API_BASE` 推导见 `10-发布与API/04-前端发布面板与调用示例.md`；`formatMessageTime` 见 `09-会话与记忆/04-Python对齐与前端会话面板.md`——以上**直接使用、不重讲**。

---

## 1. 本篇目标

做完这一篇，你能：

- 说清 **为什么 Agent 调试需要三栏**：左栏是「**我提交了什么**」（input + composition），中栏是「**它做了什么**」（事件流 + 累积输出），右栏是「**以前它做过什么**」（运行历史）。三者同屏，才能把「输入 / 过程 / 结果」对上号。
- 说清 **为什么 Composition 用 JSON 文本框而不是表单**：层的种类多、`config` 每层不同、还允许同一层换顺序、未来加字段——做成表单会**指数级膨胀**；JSON 文本框让「配置」和「契约文档里的示例」长得一模一样，还能整段复制给别人。代价是**必须本地预校验格式**。
- 说清 **本地 `JSON.parse` 预校验与后端语义校验的分工**：前端只判「**是不是合法 JSON**」；层名、`llm` 层数量、`maxRounds` 越界等**语义**仍由后端 `validateComposition` 判定（两端同一套文案，见 `error-messages.md` §11）。前端**不重写**语义校验，否则会出现「第三套方言」。
- 说清 **`id:` 行是什么**：它是事件的 `seq`（单次运行内从 1 递增），也是**重连游标**。SSE 规范里 `id:` 会被浏览器记住并在重连时作为 `Last-Event-ID` 发回；本页用 `fetch` 手写，所以**自己保存、自己回传**。
- 说清 **阶段 4 的解析器缺了什么**：`SseEvent` 原来只有 `event` / `data`，Agent 帧多了 `id:` 行；解析器必须**保留**它（`id: string | null`），否则重连时不知道「已收到哪一条」。工作流帧没有 `id:` → `null`，**向后兼容**。
- 说清 **「从上次 id 重连」不是重跑**：`GET /agent/runs/{id}/events` 带 `Last-Event-ID: <最后 id>` 时，服务端先订阅实时事件、再重放 DB 里 `seq > lastEventId` 的事件（按 `seq` 排序去重）——**它不会重新执行 Agent**。所以终态之后点它，只会得到一句「已连接，但没有新事件」。
- 说清 **token 为什么要合并**：一个真实模型一次回答可能有几百上千片 token；**每片一行**会让事件列表变成瀑布、并触发大量重渲染。本页把连续 `token` 合并成一行 `token ×N`，真正的文本**累积在上方「输出（token 累积）」区**。
- 说清 **`layer_started` / `layer_finished` 的价值**：Composition 的执行是「按顺序装配」；把每一层的 `started/finished` 展示出来，用户能看见 `history → prompt → tools → llm → output` 逐层生效——这正是 Composition **相比黑盒 Agent 的优势**：过程可解释。
- 说清 **`sse.ts` 为什么迁到 `lib/`**：画布页（工作流运行）与 Agent 页（Agent 运行）都要解析 SSE；放在路由目录里会被误当成路由文件、跨页面导入也违反 Next.js 的路由边界。`lib/` 是共享非路由代码的约定位置，**一份解析器、两处使用**，`id` 支持也不会两边分叉。
- 独立完成一次前端实测：输入 `hello` → 16 条事件（`#1 run_queued` … `#16 run_finished`）、3 片 token 累积成 `echo: Q: hello`；工具运行出现 `tool_call`（args 展开）与 `tool_result`（14），输出 `answer: 14`；点历史项 → 首行即 `#1 run_queued`（完整 16 条重现）；终态后点「从上次 id 重连」→ 「已连接，但没有新事件」；`[[mock-delay:2200]]` 慢运行取消 → 只有 `run_cancelled`、无 `run_finished`；非法 JSON → 本地报错且不发请求；`npx tsc --noEmit` 通过。

**验收标准（对齐总纲 §6 阶段 11 的前端部分）**

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 三栏布局 | 左「本次运行配置」/ 中「事件流」/ 右「运行历史」同屏可见 |
| 2 | 默认 Composition | 文本框内是 5 层 JSON（`history` / `prompt` / `tools` / `llm` / `output`），可直接编辑 |
| 3 | 非法 JSON | 点「运行」即报「Composition JSON 解析失败」，**网络面板无 `POST /agent/runs`** |
| 4 | 事件序号 | 每条事件前有 `#<seq>`，`hello` 运行从 `#1` 到 `#16` 连续 |
| 5 | token 合并 | 事件列表只显示一行 `token ×3`；上方输出区累积为 `echo: Q: hello` |
| 6 | 层可见 | 5 对 `layer_started` / `layer_finished`，`index` 为 1..5 |
| 7 | 工具事件 | `tool_call` 展开 `args`；`tool_result` 显示 `14`；最终输出 `answer: 14` |
| 8 | 历史重放 | 点历史项后事件列表清空重来，首条 `#1 run_queued`，共 16 条 |
| 9 | 重连 | 终态后点「从上次 id 重连」→ 提示「已连接，但没有新事件」 |
| 10 | 取消 | 慢运行取消后终态为 `cancelled`，事件里**没有** `run_finished` |
| 11 | 类型检查 | `apps/web` 内 `npx tsc --noEmit` 无输出、退出码 0 |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| 契约 `0.11.0`：`Composition` / `CompositionLayer` / `AgentRunResponse` / `CreateAgentRunResponse` / `CancelAgentRunResponse` | 本阶段 `01` / `02` |
| 五个接口：`POST /agent/runs`（202）、`GET /agent/runs`、`GET /agent/runs/{id}`、`POST /agent/runs/{id}/cancel`（202）、`GET /agent/runs/{id}/events`（SSE） | 本阶段 `01` |
| 事件协议：帧含 `id:` 行；`run_queued` 为 seq 1；终态唯一 | `packages/contract/agent-events.md` |
| `POST /agent/runs` 的异步受理与「先写库再推送」 | 本阶段 `01` |
| 前端已登录（`localStorage.accessToken`） | 阶段 1 · `03` |
| 三端 + mock 已启动 | 本阶段 `05` §2 |

> 本篇**只改前端的一个页面 + 一个共享模块**：新增 `apps/web/app/agent/page.tsx`；把 `apps/web/app/apps/[id]/sse.ts` **移动**为 `apps/web/lib/sse.ts` 并新增 `id` 字段。**没有新增后端接口、没有改契约**。入口在应用列表页：`<a href="/agent">Agent</a>`。

---

## 3. 命令逐条

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001） | `api-ts listening on http://localhost:3001` |
| `pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000） | `Uvicorn running on http://127.0.0.1:8000` |
| `pnpm dev:web` | 仓库根 | 起 Next.js（3000） | `Ready in ...` |
| `node tools/mock-llm/server.mjs` | 仓库根 | mock provider（11435） | `mock-llm listening on http://127.0.0.1:11435` |
| `npx tsc --noEmit` | `apps/web` | 前端类型检查 | 无输出、退出码 0 |

> 打开 `http://localhost:3000/agent`。页面调的地址是 `NEXT_PUBLIC_API_BASE`（默认 `http://localhost:3001`）；切到 Python 后端只需改 `apps/web/.env` 并重启 web（构建期内联，见 `00-项目初始化/07-NextJS起步.md`）。

---

## 4. 三栏工作台：同时看到「我提交了什么」和「它做了什么」

### 4.1 布局

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
<div
  style={{
    display: 'grid',
    gridTemplateColumns: '340px minmax(0, 1fr) 300px',
    gap: 12,
    alignItems: 'start',
  }}
>
  {/* 左栏：本次运行配置 */}
  <aside style={columnStyle}>…</aside>
  {/* 中栏：事件流 */}
  <section style={columnStyle}>…</section>
  {/* 右栏：运行历史 */}
  <aside style={columnStyle}>…</aside>
</div>
```

**这段在干什么**：

- 三栏宽度 `340px / 1fr / 300px`：左栏要放 `input` 与 18 行的 JSON，固定宽；中栏是内容主体，用 `minmax(0, 1fr)` 防止长 JSON / 长 token 把网格撑破（`0` 是最小宽度，允许子元素收缩）；右栏列表固定 300px。
- `alignItems: 'start'`：三栏各自按内容高度排布，短栏不会被拉成等高，视觉上更像「工作台」而不是表格。
- 三栏**各自独立滚动**：事件日志 `height: 360; overflow: auto`，历史列表在右栏内滚动，左栏随页面滚动。

### 4.2 为什么是「三栏」而不是「一个按钮 + 一个结果框」

| 只看结果 | 三栏工作台 |
| --- | --- |
| 只能知道「输出是什么」 | 知道「**输入了什么**、**经过哪些层**、**哪一层产出了什么**」 |
| 失败时无从下手 | 能定位是 `tools` 层没生效、`llm` 轮次超限，还是 `run_failed` 的报错 |
| 无法复盘 | 右栏历史可点开任意一次运行，**从 seq 1 完整重放** |
| 无法验证「配置改了会怎样」 | 左栏整段 JSON 就在眼前，改一层、跑一次、对比事件 |

> **一句话**：工作流调试看「图」，Agent 调试看「**配置 + 过程**」。Agent 没有画布可看，所以必须把「配置」和「过程」同时摆出来，否则它就退化成一个大号聊天框。

---

## 5. Composition：JSON 文本框 + 本地预校验

### 5.1 默认配置就是一段可编辑的 JSON

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
/** 默认 5 层组合（history → prompt → tools → llm → output），可直接在文本框里改。 */
const DEFAULT_COMPOSITION = JSON.stringify(
  {
    version: '1',
    layers: [
      {
        name: 'history',
        config: { messages: [], maxMessages: 20, compactionThreshold: 12, keepRecent: 6 },
      },
      { name: 'prompt', config: { system: 'You are terse.', template: 'Q: {{ input }}' } },
      { name: 'tools', config: { names: [] } },
      { name: 'llm', config: { maxRounds: 5 } },
      { name: 'output', config: {} },
    ],
  },
  null,
  2,
)
```

**这段在干什么**：

- `JSON.stringify(obj, null, 2)`：**用 2 空格缩进生成文本**，让文本框里的内容可直接阅读、可整段复制到契约文档的示例里。
- 默认顺序 `history → prompt → tools → llm → output`：先历史、再本轮提示、再声明工具、再跑模型、最后取输出。**层顺序就是语义**（`02` 会讲），所以默认值本身就是一段「教学配置」。
- `tools.names: []`：默认不用工具；把 `["calculator"]` 填进去，再在 prompt 里写 `[[call:...]]` 就能看到工具事件（§9.2）。

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
const [compositionText, setCompositionText] = useState(DEFAULT_COMPOSITION)
```

```tsx
<label style={{ display: 'block', fontSize: 12, color: '#555', marginTop: 10 }}>
  Composition（JSON，可直接编辑）
  <textarea
    data-testid="agent-composition"
    value={compositionText}
    onChange={(e) => setCompositionText(e.target.value)}
    rows={18}
    spellCheck={false}
    style={{ display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}
  />
</label>
```

- **受控 `textarea`**（`value` + `onChange`）复用阶段 2 的受控输入模式；`monospace` + `spellCheck={false}` 让 JSON 不被拼写检查画红波浪线。
- 文本框存的是**原始字符串**（`string`），不是解析后的对象：用户在编辑中途可能写出「非法 JSON」，这时**不能让 React 报错**，只有点「运行」才校验。

### 5.2 为什么不用表单：层级深、组合多

| 表单 | JSON 文本框（本项目） |
| --- | --- |
| 每个层一个区块、每个 `config` 一个字段 → 5 层 × 若干字段 = **一屏放不下** | 一段文本，18 行装下完整配置 |
| 加新层 / 新字段 → 改组件、改布局、改校验提示 | 加字段 → 只需后端校验与文档更新，前端**零改动** |
| 顺序调整要拖拽或上下移按钮 | 直接改数组顺序（**顺序即语义**） |
| 无法表达「未来才有的字段」 | JSON 天然可扩展（多传字段由契约/校验决定） |
| 对初学者「友好」 | 与 `agent-events.md` 的示例**长得一模一样**，可对照学习 |
| 复制给别人要一格格填 | 整段复制 / 粘贴 |

> 表单适合**字段少、结构扁平、组合固定**的配置（如应用的 `name` / `mode`）；Composition 是**多层、每层不同 `config`、顺序有语义**的声明式配置，表单会指数级膨胀。**选文本框不是偷懒，而是承认「配置的形状本身是数据」。**

### 5.3 本地只校验「格式」：`JSON.parse` + 提前返回

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
/** 运行：本地 `JSON.parse` 校验 → POST /agent/runs → 立即打开事件流。 */
async function handleRun(): Promise<void> {
  setFormError(null)
  setStreamNotice(null)
  setStreamError(null)
  if (input.trim() === '') {
    setFormError('请先填写 input（必填）')
    return
  }
  let composition: unknown
  try {
    composition = JSON.parse(compositionText) as unknown
  } catch (err: unknown) {
    // 本地校验失败：不发请求。
    setFormError(
      `Composition JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  const token = localStorage.getItem('accessToken')
  if (token === null) {
    router.replace('/login')
    return
  }
  setCreating(true)
  try {
    const res = await fetch(`${API_BASE}/agent/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input, composition }),
    })
    …
  }
}
```

**这段在干什么**：

- **先本地校验、再发请求**：`JSON.parse` 失败时 `setFormError(...)` 后**直接 `return`**，网络面板里**不会出现** `POST /agent/runs`。
- 失败文案带上 `JSON.parse` 的原始错误（如 `Unexpected token } in JSON at position 42`）：比服务端「body 不是合法 JSON」的泛化报错更能定位到**第几个字符**。
- **拆成两次 `JSON.parse` 是故意的**：第一次只为「能不能解析」，解析结果 `composition` 原样再 `JSON.stringify` 发给后端——**前端不理解层的语义，也不改写配置**。
- `input.trim() === ''` 在解析之前拦截：空输入是**必填校验**（契约 `input` 1..4000），本地拦一次能立即给提示；长度上限仍交给后端。
- 语义校验（层名、`llm` 层数量、`maxRounds` 越界…）**一律不在前端做**：后端 `validateComposition` 会按固定顺序产出 `error-messages.md` §11 的文案，两端逐字节一致；前端再写一套，必然出现第三种说法。

**实测（非法 JSON）**：

```
点击「运行」→ 左栏红字：操作失败：Composition JSON 解析失败：Unexpected token …
Network 面板：无 POST /agent/runs 请求
```

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 不本地校验，直接 `JSON.stringify(compositionText)` 发出去 | 后端收到一个 JSON 字符串而不是对象 → 400，文案与用户输入无关 |
| 解析失败后仍继续发请求 | 多余的 400；用户以为「后端挂了」 |
| 前端重写一遍层校验 | 两端 + 前端三套文案；改契约时漏改前端 |
| 直接把文本框当对象 `value` 存 | 编辑中途非法 JSON 时组件崩溃 |

---

## 6. `id:` 行 = 重连游标：解析器必须保留它

### 6.1 帧格式的差异

Agent 帧（`agent-events.md` §1）：

```
id: 1
event: run_queued
data: {"runId":"…","status":"queued"}

id: 2
event: run_started
data: {"runId":"…"}
```

工作流帧（`sse-events.md`）只有 `event:` + `data:`，**没有 `id:`**。

### 6.2 `SseEvent` 多了一个字段

**完整文件路径：`apps/web/lib/sse.ts`（节选）**

```ts
/** 解析后的单个 SSE 事件：`event` 为事件名，`data` 为拼接后的原始 payload 文本。 */
export interface SseEvent {
  event: string
  data: string
  /** 帧的 `id:` 值（Agent 运行的事件 `seq`）；工作流帧没有该行，为 `null`。 */
  id: string | null
}
```

**这段在干什么**：

- `id` 用 `string | null`：SSE 的 `id:` 是**文本字段**（规范没有规定类型）；工作流帧没有该行 → `null`。
- **为什么保留成字符串而不是 `number`**：解析器只负责「分帧」，不该假定 id 一定是数字。Agent 的 `seq` 是数字，由**使用方**（页面）转成 `number`；若有别的协议用字符串 id，解析器仍通用。
- 这是阶段 4 解析器的**唯一语义扩展**：`event` / `data` 的解析逻辑一字未改。

### 6.3 解析 `id:` 行

**完整文件路径：`apps/web/lib/sse.ts`（节选）**

```ts
let eventId: string | null = null

/** 遇到空行：若已有字段则产出一个事件，并重置状态。 */
const flushFrame = (): SseEvent | null => {
  if (!hasField) return null
  const frame: SseEvent = {
    event: eventName === '' ? 'message' : eventName,
    data: dataLines.join('\n'),
    id: eventId,
  }
  eventName = ''
  eventId = null
  dataLines.length = 0
  hasField = false
  return frame
}

/** 处理一整行（不含行尾换行符）：解析 `id:` / `event:` / `data:` 字段。 */
const handleLine = (rawLine: string): SseEvent | null => {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
  if (line === '') return flushFrame()
  if (line.startsWith(':')) return null

  const colon = line.indexOf(':')
  const field = colon === -1 ? line : line.slice(0, colon)
  const rawValue = colon === -1 ? '' : line.slice(colon + 1)
  const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

  if (field === 'id') {
    // Agent 事件的 seq：保留下来供 `Last-Event-ID` 重连使用。
    eventId = value
    hasField = true
  } else if (field === 'event') {
    eventName = value
    hasField = true
  } else if (field === 'data') {
    dataLines.push(value)
    hasField = true
  }
  return null
}
```

**这段在干什么**：

- `id:` 与 `event:` / `data:` 走**同一套「`field: value` 切分 + 剥一个空格」**逻辑，只多一个 `else if` 分支。
- `eventId` 在 `flushFrame` 后重置为 `null`：**id 不会跨帧泄漏**——某一帧没有 `id:` 时不会沿用上一帧的 id（否则重连游标会错）。
- `hasField = true`：只有 `id:` 行、没有 `event/data` 的帧也会被当成「有字段」，按 `event: 'message'` 产出；这是通用 SSE 语义，不影响 Agent 帧（每帧三者都有）。

### 6.4 页面把 `id` 转成 `number` 并维护「最后 id」

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
const [lastEventId, setLastEventId] = useState(0)
const lastEventIdRef = useRef(0)
```

```tsx
// 先取出本条事件的 seq 再入队：state updater 可能晚于后续帧执行，
// 若在 updater 里读 ref 会把 id 显示成「后来的」seq。
const seq =
  frame.id !== null && Number.isFinite(Number(frame.id))
    ? Number(frame.id)
    : lastEventIdRef.current
if (frame.id !== null && Number.isFinite(Number(frame.id))) {
  lastEventIdRef.current = seq
  setLastEventId(seq)
}

setEvents((prev) => [...prev, { id: seq, event: frame.event, data }])
```

**这段在干什么**：

- **`ref` 与 `state` 各存一份**：`state` 驱动界面（「最后事件 id：16」），`ref` 给回调用（`handleReconnect` 需要**同步读到最新值**；`state` 在闭包里可能还是旧值）。
- **先算 `seq` 再 `setEvents`**：`setEvents` 的回调可能被 React 延后执行；如果在回调里读 `lastEventIdRef.current`，那时它可能已经被**后续帧**更新了，行首的 `#` 就会显示错误的序号。代码注释写的就是这个坑。
- `Number.isFinite(Number(frame.id))`：`id` 不是数字时回退到「当前最后 id」，不抛错（防御非 Agent 帧）。
- `id` 落进 `EventEntry.id`，最终渲染成行首的 `#16`——**界面上看到的序号，就是重连游标的值**，用户不需要另找。

---

## 7. 「从上次 id 重连」：补发，不是重跑

### 7.1 打开事件流

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
/**
 * 打开事件流：`GET /agent/runs/{id}/events`。
 *
 * `from` 即 `Last-Event-ID`（0 表示从头重放；服务端「先订阅、再重放」并按 `seq` 排序去重，输出顺序仍是先历史后实时）。
 * `resetLocal` 为 true 时清空本地事件与累积文本（新运行 / 从头重放）。
 */
async function openStream(
  token: string,
  id: string,
  from: number,
  resetLocal: boolean,
): Promise<void> {
  abortRef.current?.abort()
  const controller = new AbortController()
  abortRef.current = controller

  if (resetLocal) {
    setEvents([])
    setStreamText('')
    setLastEventId(from)
    lastEventIdRef.current = from
  }
  setStreaming(true)
  setStreamNotice(null)
  setStreamError(null)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'text/event-stream',
  }
  // `EventSource` 带不了这个头，而 `fetch` 可以：把「已收到的最大 seq」告诉服务端。
  if (from > 0) headers['Last-Event-ID'] = String(from)

  let received = 0
  try {
    const res = await fetch(`${API_BASE}/agent/runs/${id}/events`, {
      headers,
      signal: controller.signal,
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('text/event-stream') || res.body === null) {
      const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      setStreamError(apiErrorMessage(body?.message) ?? `HTTP ${res.status}`)
      return
    }

    for await (const frame of parseSseStream(res.body)) {
      if (controller.signal.aborted) break
      received += 1
      applyFrame(frame)
      // 逐事件让出一次，保证 token 能一段段渲染出来。
      await yieldToPaint()
    }
    if (received === 0 && !controller.signal.aborted) {
      setStreamNotice('已连接，但没有新事件（Last-Event-ID 已覆盖全部事件）')
    }
  } catch (err: unknown) {
    if (!controller.signal.aborted) {
      setStreamError(err instanceof Error ? err.message : String(err))
    }
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null
      setStreaming(false)
      // 运行状态可能刚变成终态，刷新一次历史列表。
      void loadRuns(token).catch(() => {
        // 静默降级：列表刷新失败不影响事件流展示。
      })
    }
  }
}
```

**这段在干什么**：

- **先 `abort` 上一条流**：重连 / 换运行时不能留下两条并行流（会重复 `applyFrame`、事件列表出现重影）。
- **`from > 0` 才发 `Last-Event-ID`**：`0` 表示从头重放，**不发头**（服务端把缺失当 0）；这样「新运行」和「从头看历史」走同一条代码路径，不需要特判。
- **`resetLocal` 的两种语义**：
  - `true`：新运行 / 点历史项 → **清空**本地事件与累积文本、把游标归零；
  - `false`：重连 → **保留**已看到的事件，只追加新事件（否则重连会把用户刚看的记录洗掉）。
- **校验 `content-type`**：不是 `text/event-stream` 时走错误分支（`400 invalid Last-Event-ID` / `404 Run not found` 都是**普通 JSON**，发生在开流之前）；盲目当流解析会把 JSON 错误体解析成「0 个事件」。
- **`received === 0` 的提示**：服务端已经完全重放过（没有 `seq > lastEventId` 的事件）时会直接关流；前端收到 0 帧，就给一句「已连接，但没有新事件」——这正是**终态后重连**的正常结果。
- **`finally` 刷新历史**：终态事件很可能刚把 `status` 从 `running` 改成 `succeeded`/`cancelled`，右栏需要同步；刷新失败**静默降级**，不影响已展示的事件流。

### 7.2 「从上次 id 重连」按钮

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
/** 「从上次 id 重连」：用已收到的最大 seq 作为 `Last-Event-ID` 重新请求。 */
function handleReconnect(): void {
  if (runId === null) return
  const token = localStorage.getItem('accessToken')
  if (token === null) {
    router.replace('/login')
    return
  }
  void openStream(token, runId, lastEventIdRef.current, false)
}
```

```tsx
<button
  type="button"
  data-testid="agent-reconnect"
  onClick={handleReconnect}
  disabled={runId === null || lastEventId === 0 || streaming}
>
  从上次 id 重连
</button>
```

- `lastEventIdRef.current`：**同步**的最新游标（§6.4 解释了为什么不用 state）。
- `resetLocal = false`：重连是**续看**，不是重看。
- 按钮在「没有 run / 还没收到任何事件 / 正在接收」时禁用：`0` 时重连等于从头重放，没有意义；接收中重连会打断正常流。

### 7.3 为什么这不是「重跑」

| 操作 | 服务端行为 | 会不会重新执行 Agent |
| --- | --- | --- |
| `POST /agent/runs` | 建 run → 写 `run_queued` → 后台执行 | **会**（新建一次运行） |
| `GET …/events`（无 `Last-Event-ID`） | 从 DB 重放全部事件，再订阅实时 | **不会**（只读事件） |
| `GET …/events` + `Last-Event-ID: 16` | 重放 `seq > 16` → 通常没有 → 关流 | **不会** |

> **一句话**：事件是**已经发生的事实**，流只是「读事实的接口」。重连是「换个位置继续读」，重跑是「再发生一次」。两者混在一起，用户就无法相信「历史」。

**实测（终态后重连）**：

```
最后事件 id：16
点「从上次 id 重连」→ 提示：已连接，但没有新事件（Last-Event-ID 已覆盖全部事件）
事件列表：仍是原来的 16 条（没有被清空、也没有新增）
```

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 重连时 `resetLocal = true` | 已看到的事件被清空；用户以为「重跑了」 |
| 不带 `Last-Event-ID` | 每次都从头重放，事件列表不断重复 |
| 用 state 而不是 ref 取游标 | 连点两次，第二次用的是旧 id → 重复收到已看过的帧 |
| 把 `Last-Event-ID` 当 URL 参数但后端只读头 | 重放位置不生效（契约是头优先、查询参数次之，见 `agent-events.md` §4） |
| 不校验 `content-type` | 400/404 的 JSON 被当 SSE 解析，界面显示「没有事件」而不是错误 |

---

## 8. token 合并渲染

### 8.1 累积文本单独放一个区域

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
} else if (frame.event === 'token') {
  const text = typeof data.text === 'string' ? data.text : ''
  setStreamText((prev) => prev + text)
}
```

```tsx
<div style={{ fontWeight: 600 }}>输出（token 累积）</div>
<pre
  data-testid="stream-output"
  style={{
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: '#f7f7f7',
    padding: 8,
    margin: '4px 0 0',
    minHeight: 48,
    fontSize: 13,
  }}
>
  {streamText}
</pre>
```

- `setStreamText((prev) => prev + text)`：函数式更新，多个 token 事件在同一个批次里也不会互相覆盖。
- `whiteSpace: 'pre-wrap'`：保留换行、自动折行；模型输出里的换行能正确显示。
- `minHeight: 48`：还没有 token 时也有一个可见的「空输出区」，避免布局跳动。

### 8.2 事件列表里合并连续 token

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
{events.map((entry, index) => {
  // 连续 token 不逐条刷屏：只在第一处渲染一行汇总，文本在上方「输出」里累积。
  if (entry.event === 'token') {
    const previous = events[index - 1]
    if (previous !== undefined && previous.event === 'token') return null
    let count = 0
    for (let i = index; i < events.length && events[i].event === 'token'; i += 1) {
      count += 1
    }
    return (
      <div key={`${entry.id}-${index}`} style={{ marginBottom: 4 }}>
        <span style={idChipStyle}>#{entry.id}</span>
        <strong>token</strong> ×{count} → 见上方「输出（token 累积）」
      </div>
    )
  }
  return (
    <div key={`${entry.id}-${index}`} style={{ marginBottom: 6 }}>
      <div>
        <span style={idChipStyle}>#{entry.id}</span>
        <strong>{entry.event}</strong>
      </div>
      <div style={{ marginLeft: 34 }}>
        <EventPayload entry={entry} />
      </div>
    </div>
  )
})}
```

**这段在干什么**：

- **只在一段连续 token 的第一条渲染**（`previous.event === 'token'` → `return null`），并**向后数**同段长度，显示 `token ×3`。
- 行首 `#{entry.id}` 是**这一段的起始 seq**（如 `#10`），后两条 `#11`、`#12` 不单独占行；用户仍能从「最后事件 id」看到 12。
- `→ 见上方「输出（token 累积）」`：明确告诉用户**文本去哪了**，避免「token 内容怎么不见了」的困惑。
- `key={`${entry.id}-${index}`}`：`id` 理论上唯一，但重放/重连可能重复渲染同一 seq（不同时刻的列表），加上 `index` 保证 React key 唯一。

### 8.3 为什么要合并：体验 + 性能

| 不合并 | 合并 |
| --- | --- |
| 一次真实回答 = 数百上千行 `token`，事件列表变成瀑布 | 只占 1 行 |
| 每片 token 触发一次列表重排 / 滚动计算 | 一次渲染 |
| `scrollHeight` 每帧变化，自动滚动抖动 | 滚动稳定 |
| 用户想找 `tool_call` 要翻很久 | 关键事件（层 / 工具 / 终态）一屏可见 |

> 本项目的 mock 每 5 个码点一片，`echo: Q: hello` 只有 **3 片**；真实模型 200 字的回答可能 200+ 片。合并逻辑在 mock 下看不出差别，在真模型下是「能用 / 不能用」的差别。

### 8.4 为什么每帧要 `await yieldToPaint()`

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
/** 让出一次宏任务，确保 React 能在每个事件之间提交更新（token 才能逐段显示）。 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
```

```tsx
for await (const frame of parseSseStream(res.body)) {
  if (controller.signal.aborted) break
  received += 1
  applyFrame(frame)
  await yieldToPaint()
}
```

- 阶段 4 已讲过根因：**React 18 会把同一批事件里的多次 `setState` 合并渲染**；而 `for await` 在一个微任务链里连续消费帧，浏览器可能一帧都不画。
- `setTimeout(0)` 是**宏任务**：让出一次事件循环，浏览器有机会提交上一次更新，token 才会一段段出现。
- 这只是**渲染节奏**的修正，不改变事件顺序与最终文本；与服务端「边产生边发」是两件不同的事（后者由 SSE 保证，前者由消费方保证）。

---

## 9. `layer_*` 与工具事件：让「装配过程」可见

### 9.1 层事件

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
if (entry.event === 'layer_started' || entry.event === 'layer_finished') {
  return (
    <span>
      层 <code>{String(data.layer ?? '')}</code> · 序号 {String(data.index ?? '')}
    </span>
  )
}
```

- `layer` + `index` 直接来自 payload（`agent-events.md` §2），**`index` 从 1 开始**，对应 `composition.layers` 的下标 + 1。
- 每一层各发**一对** `layer_started` / `layer_finished`，包括不产生任何输出的 `history` / `tools` / `output`。
- 用户看到的顺序就是**配置里的层顺序**：改了 JSON 里的数组顺序，事件顺序立刻跟着变——这是 Composition「顺序即语义」的最直观证据（`02`）。

**实测（默认 5 层）**：

```
#3 layer_started  层 history · 序号 1
#4 layer_finished 层 history · 序号 1
#5 layer_started  层 prompt  · 序号 2
#6 layer_finished 层 prompt  · 序号 2
#7 layer_started  层 tools   · 序号 3
#8 layer_finished 层 tools   · 序号 3
#9 layer_started  层 llm     · 序号 4
#10 token ×3      （起点 #10）
#13 layer_finished 层 llm    · 序号 4
#14 layer_started  层 output · 序号 5
#15 layer_finished 层 output · 序号 5
```

> **对比黑盒 Agent**：黑盒只会告诉你「最终回答是什么」；这里能看见 `history` 先跑、`prompt` 后跑、`llm` 产出了 token、`output` 把最后一条 assistant 消息当结果。**过程可见 = 可调试**。

### 9.2 工具事件：`args` 展开、结果单独一块

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
if (entry.event === 'tool_call') {
  return (
    <div>
      <span>
        第 {String(data.round ?? '')} 轮 · 调用 <code>{String(data.toolName ?? '')}</code>
      </span>
      <pre style={payloadPreStyle}>{JSON.stringify(data.args ?? {}, null, 2)}</pre>
    </div>
  )
}
if (entry.event === 'tool_result') {
  const result = data.result
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '', null, 2)
  return (
    <div>
      <span>
        第 {String(data.round ?? '')} 轮 · <code>{String(data.toolName ?? '')}</code> 返回 ·{' '}
        {String(data.elapsedMs ?? 0)} ms
      </span>
      <pre style={payloadPreStyle}>{text}</pre>
    </div>
  )
}
```

- `tool_call` **展开 `args`**（`JSON.stringify(..., null, 2)`）：Agent 调试最常问的问题就是「它到底用什么参数调的」；折叠成一行会看不到嵌套结构。
- `tool_result` 支持 `string` 与对象两种形状：契约里 `result` 是字符串，但防御性地兼容对象，避免 `JSON.stringify` 在字符串上再包一层引号。
- `round` 从 1 开始（`agent-events.md` §2）：多轮 ReAct 时能看出「第 1 轮调了工具、第 2 轮给了最终答案」（`03`）。
- `elapsedMs` 是**该次工具执行**的耗时，与 `run_finished.elapsedMs`（整次运行）不同，别混用。

**实测（工具运行）**：

```
#10 tool_call    第 1 轮 · 调用 calculator
                 { "expression": "2+3*4" }
#11 tool_result  第 1 轮 · calculator 返回 · 0 ms
                 14
#12 token ×2     （answer: 14，共 2 片）
…
#17 run_finished output="answer: 14"
```

### 9.3 终态展示

**完整文件路径：`apps/web/app/agent/page.tsx`（节选）**

```tsx
if (frame.event === 'run_finished') {
  setStatus('succeeded')
  setOutput(typeof data.output === 'string' ? data.output : '')
} else if (frame.event === 'run_failed') {
  setStatus('failed')
  setRunError(typeof data.message === 'string' ? data.message : 'run failed')
} else if (frame.event === 'run_cancelled') {
  setStatus('cancelled')
}
```

- 终态**三分支**对应契约的三个终态事件，**终态唯一**（`agent-events.md` §2.1）：事件流里只会出现其中一个。
- `output` 只在 `run_finished` 时设置；`failed` / `cancelled` 时保持 `null`——**不伪造输出**（阶段 10 §6.3 的同一原则）。
- 左栏状态区同时显示 `status + 中文标签`（`queued 排队中` / `running 运行中` / `succeeded 成功` / `failed 失败` / `cancelled 已取消`），颜色由 `statusColor` 决定；取消按钮只在 `queued` / `running` 时可点（`cancellable = status === 'queued' || status === 'running'`）。

---

## 10. `sse.ts` 从路由目录迁到 `lib/`

### 10.1 迁移的内容

| 之前 | 现在 |
| --- | --- |
| `apps/web/app/apps/[id]/sse.ts` | `apps/web/lib/sse.ts` |
| 画布页 `import { parseSseStream } from './sse'` | 画布页 `import { parseSseStream } from '@/lib/sse'` |
| `SseEvent = { event, data }` | `SseEvent = { event, data, id }` |

```tsx
// apps/web/app/apps/[id]/page.tsx
import { parseSseStream } from '@/lib/sse'
```

```tsx
// apps/web/app/agent/page.tsx
import { parseSseStream, type SseEvent } from '@/lib/sse'
```

### 10.2 为什么共享模块要放公共目录

| 放在 `app/apps/[id]/sse.ts` | 放在 `lib/sse.ts` |
| --- | --- |
| 紧挨着「第一个用它的页面」，**看起来**方便 | 明确表达「这是**跨页面**的共享能力」 |
| 第二个页面要用 → `../../apps/[id]/sse` 这种跨路由相对路径 | `@/lib/sse`，短且稳定 |
| Next.js App Router 里，`app/` 下的**每个文件都可能被当成路由约定文件**；`.ts` 虽然不会被当成路由，但目录语义已经错了 | `lib/` 是 Next.js 官方约定的「非路由共享代码」位置 |
| 两份复制 → `id` 支持只加在一份上，另一个页面解析出的 id 永远是 `null` | 一份实现，两个页面**同时**获得 `id` 支持 |
| 改分帧算法要改两处、测两遍 | 改一处、测一处 |

> **一句话**：**被两个路由使用的代码，不该住在其中一个路由里。** 本阶段加 `id` 字段时，如果解析器还放在画布页目录下，Agent 页面要么复制一份、要么跨目录导入——两条路都会让「同一份 SSE 协议」出现两个实现，而阶段 11 的验收恰恰要求两端、两页对同一帧解析一致（`05` L5）。

**写错会怎样**

| 错误写法 | 现象 |
| --- | --- |
| 复制一份 `sse.ts` 给 Agent 页 | 两份分帧逻辑；以后修 CRLF / 多字节切断只修一处 |
| 跨路由 `import '../../apps/[id]/sse'` | 能跑但语义混乱；重构路由即断 |
| 把 `lib/sse.ts` 放进 `app/lib/` | 会被当成路由段（`/lib`），虽然未必报错，但语义错误 |
| 迁移后忘了改画布页 import | 构建失败 / 运行时找不到模块 |

---

## 11. 实测回放（汇总）

**环境**：headless Chrome + `api-ts`（3001）+ Next.js（3000）+ mock-llm（11435）。

| 步骤 | 实测结果 |
| --- | --- |
| 默认 Composition + `input=hello` → 运行 | **16 条事件**：`#1 run_queued` … 5 对 `layer_*` … `#16 run_finished` |
| token 展示 | 连续 3 片合并为 `token ×3`；输出区累积 **`echo: Q: hello`** |
| 运行历史 | 右栏出现本次运行；`status` 从 `queued`/`running` 变 `succeeded` |
| 点历史项 | 事件列表清空重放，首行 **`#1 run_queued`**，共 **16 条**（完整重现） |
| 终态后点「从上次 id 重连」 | 提示 **「已连接，但没有新事件（Last-Event-ID 已覆盖全部事件）」** |
| 工具运行（tools=`["calculator"]`，prompt 带 `[[call:calculator:{"expression":"2+3*4"}]]`） | 出现 `tool_call`（args 展开）与 `tool_result`（**14**）；输出 **`answer: 14`** |
| 慢运行（prompt 含 `[[mock-delay:2200]]`）+ 取消 | 终态只有 **`run_cancelled`**，**没有 `run_finished`** |
| 非法 JSON（少一个 `}`） | 本地报 **`Composition JSON 解析失败：…`**；Network 面板**无** `POST /agent/runs` |
| 类型检查 | `apps/web> npx tsc --noEmit` 无输出、退出码 0 |

**16 条事件的完整序列（`hello`）**

```
#1  run_queued        runId=… · status=queued
#2  run_started       runId=…
#3  layer_started     history · 1
#4  layer_finished    history · 1
#5  layer_started     prompt · 2
#6  layer_finished    prompt · 2
#7  layer_started     tools · 3
#8  layer_finished    tools · 3
#9  layer_started     llm · 4
#10 token ×3          → 输出区：echo: Q: hello
#13 layer_finished    llm · 4
#14 layer_started     output · 5
#15 layer_finished    output · 5
#16 run_finished      output="echo: Q: hello"
```

> `token` 段的**起始** seq 是 10，占了 10/11/12 三个 seq；列表只渲染一行，但「最后事件 id」会显示 12、终态是 16。**合并只是展示，不是丢事件**。

---

## 12. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | 用 `EventSource` | 401；重连无法控制头 | `EventSource` 不能带 `Authorization`，也不能自定义 `Last-Event-ID`；用 `fetch` + `getReader`（阶段 4） |
| 2 | 解析器丢掉 `id:` 行 | 重连时不知道从哪继续 | `SseEvent.id` 必须保留（§6） |
| 3 | 把重连当重跑 | 以为点了会重新执行 Agent | 事件流只读 DB + 实时订阅，**不执行**（§7.3） |
| 4 | 重连 `resetLocal=true` | 已看事件被清空 | 重连必须 `false`（§7.1） |
| 5 | 用 state 取游标 | 连点重连收到重复帧 | 用 `lastEventIdRef`（§6.4） |
| 6 | 不校验 `content-type` | 400/404 被当流解析，显示「没有事件」 | 先判 `text/event-stream`（§7.1） |
| 7 | Composition 做成表单 | 字段爆炸、加字段要改组件 | JSON 文本框（§5.2） |
| 8 | 不本地校验 JSON | 多余请求；报错不指向字符位置 | `JSON.parse` + 提前 return（§5.3） |
| 9 | 前端重写层语义校验 | 出现第三套文案 | 语义交给后端 `validateComposition`（§5.3） |
| 10 | token 每片一行 | 列表瀑布、滚动抖动 | 连续 token 合并（§8.2） |
| 11 | token 文本也塞进事件行 | 内容重复、列表巨型 | 文本只进「输出」区（§8.1） |
| 12 | 不 `yieldToPaint` | token 一次性出现，看似非流式 | 每帧让出宏任务（§8.4） |
| 13 | 终态后输出仍显示旧值 | 取消/失败却显示上一次答案 | `handleRun` 先清 `output` / `runError`（§9.3） |
| 14 | 取消按钮常开 | 已终态点击报 400 | 只在 `queued`/`running` 可点（§9.3） |
| 15 | 页面卸载不 abort | 流悬挂、控制台报错 | `useEffect` 清理里 `abortRef.current?.abort()` |
| 16 | 历史项不重放事件 | 只看到 `run.output`，看不到过程 | 点击即以 `Last-Event-ID: 0` 打开流（§7.1） |
| 17 | 事件列表用数组下标当 key | 重放后行错位 | `key={`${id}-${index}`}`（§8.2） |

---

## 13. 本篇复盘

**一句话总结**：「Agent 控制台 = 配置 + 过程 + 历史」的三栏工作台。配置用**整段 JSON**表达（声明式配置层级深、组合多，表单会爆炸），但**本地先 `JSON.parse`**、语义交给后端；事件流的 `id:` 行是**重连游标**，解析器必须保留（阶段 4 缺这个字段），「从上次 id 重连」用 `Last-Event-ID` **补发已落库的事件而不是重跑**；连续 token 合并成一行、文本累积在独立输出区；`layer_started/finished` 让 Composition 的**装配过程可见**；`sse.ts` 迁到 `lib/`，让画布页与 Agent 页**共用一份解析器**。

**本篇学到的工程要点**

1. **调试界面要能回答三个问题**：我提交了什么、它做了什么、它以前做过什么。
2. **声明式配置用文本、不用表单**：当「配置的形状本身是数据」时，JSON 比控件更诚实。
3. **前端只预校验格式**：格式错不发请求；语义错由唯一真源（后端 + 契约）判定。
4. **`id:` 是协议的一部分**：SSE 的断线续传靠它，解析器丢掉它等于丢掉重连能力。
5. **重连 = 读历史**：事件一旦落库就是事实，流只是读事实的接口。
6. **高频事件要聚合展示**：合并渲染是性能优化，也是可读性优化。
7. **过程事件是 Composition 的核心卖点**：层可见，配置才可解释。
8. **共享代码放公共目录**：`lib/` 不是审美问题，是防止协议分叉的工程约束。

**遗留 / 后续**

- `input` 与 `composition` 不持久化草稿，刷新即回到默认值。
- 没有「保存常用 Composition / 命名预设」。
- 事件列表没有按**层过滤**、没有折叠，长运行（几百条）仍需滚动。
- 重连是**手动按钮**，没有指数退避的自动重连。
- 取消按钮没有二次确认（取消本身可重跑，属可接受取舍）。
- 历史列表无分页、无删除；`GET /agent/runs` 只有 `items`。
- 没有把 `Last-Event-ID` 显示为可复制文本（只有数字）。

---

## 14. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **三栏工作台（配置 / 事件流 / 运行历史）** | **首次教学于本篇**：为什么 Agent 调试必须同时看到「我提交了什么」和「它做了什么」；`340px / 1fr / 300px` 与 `minmax(0, 1fr)` |
| **Composition 用 JSON 文本框而非表单** | **首次教学于本篇**：层级深、组合多 → 表单爆炸；文本与契约示例同形、可整段复制 |
| **Composition 的本地 `JSON.parse` 预校验** | **首次教学于本篇**：只判格式、失败即不发请求；语义校验仍归后端（避免第三套方言） |
| **`id:` 行 = 重连游标（`SseEvent.id`）** | **首次教学于本篇**：阶段 4 解析器没有的字段；`string \| null`、`flushFrame` 重置、页面转 `number` |
| **`Last-Event-ID` 重连（补发 ≠ 重跑）** | **首次教学于本篇**：`from > 0` 才发头、`resetLocal=false`、`received===0` 的「没有新事件」提示 |
| **连续 `token` 合并渲染** | **首次教学于本篇**：一段只渲染一行 `token ×N`；文本累积在独立输出区（体验 + 性能） |
| **`layer_started` / `layer_finished` 让装配过程可见** | **首次教学于本篇**：每层一对、`index` 从 1 起；过程可解释是 Composition 的优势 |
| **共享 SSE 解析器迁到 `lib/`** | **首次教学于本篇**：画布页与 Agent 页共用；`@/lib/sse`；一份实现避免协议分叉 |
| `EventSource` 限制 / `fetch` + `getReader` / 手动分帧 / React 批处理 | 本篇为**复用**；首次教学见 `04-执行引擎/06-前端SSE客户端与运行面板.md` |
| 受控输入 / 列表 `map`+`key` / 三态 | 本篇为**复用**；首次教学见 `02-应用管理/06-前端应用列表页.md` |
| `apiErrorMessage` / `API_BASE` 推导 | 本篇为**复用**；见 `10-发布与API/04-前端发布面板与调用示例.md` |
| 202 受理、事件「先写库再推送」、重放衔接窗口 | 本篇为**应用**；首次教学见本阶段 `01-Run模型与事件重放.md` |
