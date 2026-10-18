# 06 · 前端 SSE 客户端与运行面板

> 所属：阶段 4 · 执行引擎
> 本篇覆盖：在**画布页** `/apps/[id]` 上新增「**调试运行**」面板——把 `POST /apps/{id}/run` 的 SSE 流**自己解析**并渲染：自动生成输入表单、事件日志、`token` 累加的打字机效果、`run_finished` 输出、`run_failed` / 400 错误展示。SSE 分帧解析抽成独立模块 `apps/web/app/apps/[id]/sse.ts`。**服务端**怎么发流见上一篇 `05-SSE流式响应实现.md`；引擎主体与节点运行时见本阶段 `01`~`04` 篇（`01-运行契约与SSE事件协议.md` / `02-LangGraph编译图-TS.md` / `03-节点运行时与变量池.md` / `04-LangGraph与引擎-Python.md`），端到端验收见 `07-验收.md`。
> **本篇首次教学（重点）**：**`EventSource` 的致命限制**——它**无法携带 `Authorization` 头**，故本项目的鉴权 SSE **必须用 `fetch`** + `res.body.getReader()` · **`ReadableStream` + `TextDecoder`** 的 `{ stream: true }` **增量解码**（避免多字节 UTF-8 被 chunk 边界截断）· **手动 SSE 分帧算法**（按行切分（`\n`，兼容 `\r`）→ **空行收帧** → `event:` 行给事件名、`data:` 行**可多行需拼接** → 忽略注释行（以 `:` 开头）→ **残余行留在缓冲区跨 chunk 拼接**）· **把解析抽成独立模块 `sse.ts`**（`parseSseStream` 返回 `AsyncGenerator`）的理由：**可单测、可复用** · **运行面板**：由 `start.data.inputs` **自动生成输入表单**；事件日志；**`token` 事件累加渲染**（流式效果）；`run_finished` 展示 `outputs`；`run_failed` / 400 展示后端原文 · **React 批处理（batching）导致的坑（真实踩到）**：同一 chunk 内的多个 `token` 会被 React **批量渲染**、看不到「逐段冒出」→ 需**逐事件让出宏任务**（`await new Promise((r) => setTimeout(r, 0))`）才可见
> （React 组件 / JSX · `'use client'` · `useState`/`useEffect`/`useRef`/`useMemo`/`useCallback` 见阶段 0 · 07 与阶段 2 · 06；带鉴权 `fetch` / `localStorage` token / 三态 / `useRouter` 见阶段 2 · 06；ReactFlow 画布与节点检查器见阶段 3 · 06——本篇在既有画布页上**增量改造**，这些**只引用、不重讲**）

---

## 1. 本篇目标

做完这一篇，你能：

- 在画布页右侧切到「**调试运行**」标签，看到**由 start 节点的输入变量自动生成**的运行输入表单。
- 填好输入、点「运行」，看到：
  - **流式输出**区里 `token` **一段段冒出来**（打字机效果），而不是一次性出现；
  - **事件日志**区滚动列出每个 SSE 事件（`run_started` / `node_started` / `token` / `node_finished` / `run_finished`…）；
  - **运行输出**区显示 `run_finished.outputs`；
  - 失败时显示 `run_failed` 的 `message` 或后端 **400** 的原文。
- 讲清楚：为什么**不能用 `EventSource`**、为什么必须**自己分帧**、`TextDecoder({ stream: true })` 解决什么问题、Frames 的缓冲区拼接为何必需、以及**为什么 `token` 会「一起冒出」而不是逐段——怎么修**。

**验收标准（对齐总纲 §6 阶段 4）**

> 调试页能逐字输出。

具体化到可执行层面：

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 画布页右侧出现「节点检查器 / 调试运行」两个标签 | 点「调试运行」切到运行面板 |
| 2 | start 节点声明了输入变量 `topic` | 运行面板自动出现 `topic` 输入框（必填打 `*`） |
| 3 | 点「运行」 | 「流式输出」里文字**逐段出现**（如先 `Hello mi`、再补齐 `Hello mini-dify`） |
| 4 | 事件日志 | 逐条列出 `run_started` → `node_started` → `token` × N → `node_finished` → `run_finished` |
| 5 | 运行输出 | 显示 `run_finished.outputs`（如 `{"result":"Hello mini-dify"}`） |
| 6 | 图非法（如无 end / 空草稿）时运行 | 面板显示 `运行失败：<后端原文>`（如 `Graph is empty` / `graph must contain at least one end node`） |
| 7 | 模板取值失败 | 面板显示 `运行失败：template variable not found: inputs.nope` |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| Node / pnpm、`pnpm install` 已执行 | 阶段 0 · 01 / 03 |
| `/apps` 列表页、`/apps/[id]` 画布页已就绪 | 阶段 2 · 06；阶段 3 · 06 |
| **`POST /apps/{id}/run` 已实现**（返回 `text/event-stream`） | 本阶段 `05-SSE流式响应实现.md` |
| 事件协议 `packages/contract/sse-events.md` 已冻结（事件名与 payload 键） | 本阶段 `01-运行契约与SSE事件协议.md` |
| 节点 `data` 形状：`start.data.inputs`、`end.data.outputs`（用于生成表单 / 输出） | 本阶段 `03-节点运行时与变量池.md` |
| 至少一套后端在跑（本篇用 `api-ts` 3001） | 阶段 0 · 05 |
| 已登录、有一个应用与**合法草稿图**（`start → llm → end`） | 阶段 1 · 07；阶段 2 · 06；阶段 3 · 06 |

> 前端**不感知**具体后端：`NEXT_PUBLIC_API_BASE` 指向哪套都行，SSE 帧逐字节一致（阶段 0 · 08）。把 `api-ts` 换成 `api-py`，本篇代码**零改动**。

---

## 3. 命令清单（逐条说明）

本篇不新增依赖（`fetch` / `ReadableStream` / `TextDecoder` 都是浏览器内置；面板样式沿用**内联 `style`**，项目**未配置 Tailwind**）。

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `pnpm dev:api-ts` | 仓库根 | 起后端（3001），提供 `/run` SSE | `api-ts listening on http://localhost:3001` |
| `pnpm dev:web` | 仓库根 | 起 Next（3000） | `Ready in ...` + `Local: http://localhost:3000` |
| 浏览器打开 `http://localhost:3000/apps` → 「打开画布」→ 右侧「调试运行」 | —— | 真实浏览器验证 | 见第 6 节实测 |

> `pnpm dev:web` / `pnpm dev:api-ts` 是根脚本（阶段 0 · 05/07），**只引用不重讲**。

**分帧解析的单元校验（照实说明）**：`sse.ts` 是纯函数式的异步生成器，很适合**单测**。本轮用一次性脚本对 `parseSseStream` 跑了 **7 项用例，全部 PASS**：

| # | 用例 | 目的 |
| --- | --- | --- |
| 1 | 单个大 chunk 一把喂入 | 基本路径 |
| 2 | **逐字符**喂入 | 极端碎片化下缓冲区拼接 |
| 3 | **每 7 字节**切一刀喂入 | 制造**多字节 UTF-8 被切断**（`Hello mini-dify` 全 ASCII 尚可，含中文/emoji 时更关键） |
| 4 | CRLF（`\r\n`）分帧 | 兼容 `\r` 剥离 |
| 5 | **末帧无空行**结束 | 流末尾的收尾处理 |
| 6 | **多行 `data:`** | 按 `\n` 拼接 |
| 7 | **注释行**（以 `:` 开头） | 心跳行忽略 |

> 仓库**未配置测试框架**（`apps/web/package.json` 无 `vitest`/`jest`），以上属**临时脚本校验**，未入库。`sse.ts` 之所以能被这样单独测，正是因为它被**抽成了独立模块**（见 5.4）。

---

## 4. 完整代码

本步要**新增一个模块** `sse.ts`、**改造画布页** `page.tsx`：

```
apps/web/app/apps/[id]/
├── sse.ts     # ← 新增：SSE 分帧解析（parseSseStream）
└── page.tsx   # ← 改造：在既有画布上新增「调试运行」面板与 handleRun
```

### 4.1 `apps/web/app/apps/[id]/sse.ts`（新增）

**完整文件路径：`apps/web/app/apps/[id]/sse.ts`**

```ts
/**
 * SSE 分帧解析（教学重点）。
 *
 * 为什么不用 `EventSource`？—— 浏览器的 `EventSource` **不能携带 `Authorization` 头**，
 * 而 `POST /apps/{id}/run` 需要 `Bearer token` 且是 `POST`。因此改用
 * `fetch` + `response.body.getReader()`，自己按帧解析。
 *
 * 服务端帧格式（见 packages/contract/sse-events.md）：
 *   `event: <name>\n` + `data: <单行 JSON>\n\n`
 * 即「一行 event、若干行 data，以空行结束一个事件」。
 *
 * 解析要点：
 * - 以**空行**分隔事件（`\n\n`；若为 CRLF 则是 `\r\n\r\n`，逐行处理时需剥掉行尾 `\r`）。
 * - 同一事件的多个 `data:` 行按 `\n` 拼接（本协议每条只有一行，但通用实现要支持）。
 * - 网络分块会**在任意字节处切断**：一个帧、甚至一行可能跨两个 chunk，必须用缓冲区拼接后再切行。
 * - 名称后的冒号可跟一个可选空格，需要剥掉该空格。
 */

/** 解析后的单个 SSE 事件：`event` 为事件名，`data` 为拼接后的原始 payload 文本。 */
export interface SseEvent {
  event: string
  data: string
}

/**
 * 把一个 `ReadableStream<Uint8Array>`（`Response.body`）逐帧解析成 {@link SseEvent}。
 *
 * 用 `TextDecoder`（`{ stream: true }`）增量解码，避免多字节 UTF-8 字符被 chunk 切断后乱码。
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  // 缓冲区：存放「尚未成完整行的」残余文本（跨 chunk 拼接的关键）。
  let buffer = ''
  // 当前事件累积的字段状态。
  let eventName = ''
  const dataLines: string[] = []
  let hasField = false

  /** 遇到空行：若已有字段则产出一个事件，并重置状态。 */
  const flushFrame = (): SseEvent | null => {
    if (!hasField) return null
    const frame: SseEvent = {
      event: eventName === '' ? 'message' : eventName,
      data: dataLines.join('\n'),
    }
    eventName = ''
    dataLines.length = 0
    hasField = false
    return frame
  }

  /** 处理一整行（不含行尾换行符）：解析 `event:` / `data:` 字段。 */
  const handleLine = (rawLine: string): SseEvent | null => {
    // 兼容 CRLF：剥掉行尾 `\r`。
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') return flushFrame() // 空行 → 帧结束
    if (line.startsWith(':')) return null // 注释行（如心跳）忽略

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const rawValue = colon === -1 ? '' : line.slice(colon + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

    if (field === 'event') {
      eventName = value
      hasField = true
    } else if (field === 'data') {
      dataLines.push(value)
      hasField = true
    }
    return null
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      // stream: true 让解码器保留可能被切断的多字节字符残片。
      buffer += decoder.decode(value, { stream: true })

      // 每次只截取「一个完整行」（到最近的 \n），残余留在 buffer 里等下一 chunk。
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        const frame = handleLine(line)
        if (frame !== null) yield frame
      }
    }

    // 流结束：冲掉解码器内部残片，并处理最后一行（可能没有换行结尾）。
    buffer += decoder.decode()
    if (buffer !== '') {
      const frame = handleLine(buffer)
      if (frame !== null) yield frame
      buffer = ''
    }
    // 末尾没有空行收尾时，把已累积的字段作为最后一个事件产出。
    const tail = flushFrame()
    if (tail !== null) yield tail
  } finally {
    reader.releaseLock()
  }
}
```

**逐项解释**

- `parseSseStream` 是 **`async function*`（异步生成器）**：用 `yield` 逐个吐出事件，消费方用 `for await (const frame of parseSseStream(res.body))` 拿（异步生成器见 5.3 / 5.4；Python 侧的异步生成器已在阶段 0 · 06 讲过概念，此处是 JS 版本首次细讲）。
- `SseEvent`：只保留 `{ event, data }` —— 正是契约里「事件名 + 单行 JSON 文本」两要素。
- 缓冲 `buffer`：**跨 chunk 拼接的关键**（见 5.1 / 5.3）。
- `decoder`：`TextDecoder`，`{ stream: true }` 增量解码（见 5.2）。
- `flushFrame` / `handleLine`：分帧状态机（见 5.3）。
- `try / finally` + `reader.releaseLock()`：用完释放读取锁（见 5.7）。

### 4.2 `apps/web/app/apps/[id]/page.tsx`（改造：新增运行面板）

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**

```tsx
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { parseSseStream } from './sse'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'

type NodeType = 'start' | 'end' | 'llm'

type GraphNode = {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: Record<string, unknown>
}

type GraphEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

type Graph = { version: string; nodes: GraphNode[]; edges: GraphEdge[] }

type PublishResponse = { publishedAt: string; graph: Graph }

// start / end 节点声明的变量形状（与契约一致，见 packages/contract/src/index.ts）。
type InputDecl = { name: string; type: 'string'; required: boolean }
type OutputDecl = { name: string; value: string }

/** 调试运行面板里的一条事件日志。 */
type LogEntry = { seq: number; name: string; detail: string }

// ---------------------------------------------------------------------------
// 自定义节点：三种类型各一个简单组件，显示标题与类型。
// ---------------------------------------------------------------------------

const boxStyle: CSSProperties = {
  border: '1px solid #888',
  borderRadius: 6,
  background: '#fff',
  padding: '8px 14px',
  minWidth: 120,
  textAlign: 'center',
}

function NodeShell({
  title,
  type,
  hasTarget,
  hasSource,
}: {
  title: string
  type: string
  hasTarget: boolean
  hasSource: boolean
}) {
  return (
    <div style={boxStyle}>
      {hasTarget && <Handle type="target" position={Position.Top} />}
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#888' }}>{type}</div>
      {hasSource && <Handle type="source" position={Position.Bottom} />}
    </div>
  )
}

function StartNode({ data }: NodeProps) {
  return <NodeShell title={String(data.title ?? '开始')} type="start" hasTarget={false} hasSource />
}

function EndNode({ data }: NodeProps) {
  return <NodeShell title={String(data.title ?? '结束')} type="end" hasTarget hasSource={false} />
}

function LlmNode({ data }: NodeProps) {
  return <NodeShell title={String(data.title ?? 'LLM')} type="llm" hasTarget hasSource />
}

const nodeTypes = { start: StartNode, end: EndNode, llm: LlmNode }

/** 每种节点的初始 data（与引擎解释的形状对齐：start.inputs / llm.prompt / end.outputs）。 */
function initialData(type: NodeType): Record<string, unknown> {
  if (type === 'llm') return { title: 'LLM', model: 'gpt-4o', prompt: '' }
  if (type === 'start') return { title: '开始', inputs: [] }
  return { title: '结束', outputs: [] }
}

/** token 事件的 payload 摘要（`节点id · "文本"`），其余事件直接用原始 data 文本。 */
function summarizeFrame(name: string, data: string): string {
  if (name === 'token') {
    try {
      const parsed = JSON.parse(data) as { nodeId?: string; text?: string }
      return `${parsed.nodeId ?? ''} · ${JSON.stringify(parsed.text ?? '')}`
    } catch {
      return data
    }
  }
  return data.length > 300 ? `${data.slice(0, 300)}…` : data
}

/** 让出一次宏任务，确保 React 能在每个事件之间提交更新（token 才能逐段显示）。 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

// ---------------------------------------------------------------------------
// 画布主体。
// ---------------------------------------------------------------------------

function Canvas() {
  const router = useRouter()
  const appId = useParams<{ id: string }>().id
  const { screenToFlowPosition } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 右侧面板：检查器 / 调试运行。
  const [panel, setPanel] = useState<'inspector' | 'run'>('inspector')

  // 调试运行面板状态。
  const [runInputs, setRunInputs] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [liveText, setLiveText] = useState('')
  const [runOutputs, setRunOutputs] = useState<Record<string, unknown> | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const selectedInputs = useMemo<InputDecl[]>(() => {
    const raw = selectedNode?.data.inputs
    return Array.isArray(raw) ? (raw as InputDecl[]) : []
  }, [selectedNode])

  const selectedOutputs = useMemo<OutputDecl[]>(() => {
    const raw = selectedNode?.data.outputs
    return Array.isArray(raw) ? (raw as OutputDecl[]) : []
  }, [selectedNode])

  /** start 节点声明的输入，用于自动生成运行表单。 */
  const startInputs = useMemo<InputDecl[]>(() => {
    const start = nodes.find((node) => node.type === 'start')
    const raw = start?.data.inputs
    return Array.isArray(raw) ? (raw as InputDecl[]) : []
  }, [nodes])

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/apps/${appId}/graph`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) {
          router.replace('/login')
          return null
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Graph>
      })
      .then((graph) => {
        if (cancelled || graph === null) return
        setNodes(
          graph.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            position: node.position,
            data: node.data,
          })),
        )
        setEdges(
          graph.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle ?? undefined,
            targetHandle: edge.targetHandle ?? undefined,
          })),
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [appId, router, setNodes, setEdges])

  // 事件日志自动滚到底部。
  useEffect(() => {
    const el = logRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [log])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds))
    },
    [setEdges],
  )

  function addNode(type: NodeType): void {
    const rect = canvasRef.current?.getBoundingClientRect()
    const screenX = rect === undefined ? window.innerWidth / 2 : rect.left + rect.width / 2
    const screenY = rect === undefined ? window.innerHeight / 2 : rect.top + rect.height / 2
    const base = screenToFlowPosition({ x: screenX, y: screenY })
    // 按 3 列网格依次错开摆放，避免新节点完全重叠导致难以连线。
    const index = nodes.length
    const col = index % 3
    const row = Math.floor(index / 3)
    const position = { x: base.x + col * 260 - 260, y: base.y + row * 160 - 60 }
    setNodes((nds) => [
      ...nds,
      { id: crypto.randomUUID(), type, position, data: initialData(type) },
    ])
  }

  function updateNodeData(id: string, patch: Record<string, unknown>): void {
    setNodes((nds) => nds.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)))
  }

  function deleteNode(id: string): void {
    setNodes((nds) => nds.filter((node) => node.id !== id))
    setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id))
    setSelectedNodeId((cur) => (cur === id ? null : cur))
  }

  const buildGraph = useCallback(
    (): Graph => ({
      version: '1',
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type as NodeType,
        position: { x: node.position.x, y: node.position.y },
        data: node.data,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })),
    }),
    [nodes, edges],
  )

  /** PUT 草稿；成功返回 null，失败返回需展示的文案（401 直接跳登录）。 */
  const putDraft = useCallback(
    async (token: string): Promise<string | null> => {
      const res = await fetch(`${API_BASE}/apps/${appId}/graph`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildGraph()),
      })
      if (res.ok) return null
      if (res.status === 401) {
        router.replace('/login')
        return '未登录'
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      return body?.message ?? `HTTP ${res.status}`
    },
    [appId, buildGraph, router],
  )

  async function handleSave(): Promise<void> {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const err = await putDraft(token)
      if (err !== null) {
        setError(err)
        return
      }
      setMessage('草稿已保存')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePublish(): Promise<void> {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const err = await putDraft(token)
      if (err !== null) {
        setError(err)
        return
      }
      const res = await fetch(`${API_BASE}/apps/${appId}/graph/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        if (res.status === 401) {
          router.replace('/login')
          return
        }
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        setError(body?.message ?? `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as PublishResponse
      setMessage(`已发布 · ${data.publishedAt}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 调试运行：`POST /apps/{id}/run`。
   *
   * 不能用 `EventSource`（无法带 Authorization 头），改用 fetch + `parseSseStream`。
   * 预检失败（图非法 / 草稿为空）时后端返回的是**普通 JSON 400**（不是流），
   * 因此这里先判断 `content-type`：非 `text/event-stream` 就按 JSON 读 `message`。
   */
  async function handleRun(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    const inputs: Record<string, unknown> = {}
    for (const decl of startInputs) {
      inputs[decl.name] = runInputs[decl.name] ?? ''
    }

    setRunning(true)
    setLog([])
    setLiveText('')
    setRunOutputs(null)
    setRunError(null)
    try {
      const res = await fetch(`${API_BASE}/apps/${appId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ inputs }),
      })
      if (res.status === 401) {
        router.replace('/login')
        return
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !contentType.includes('text/event-stream') || res.body === null) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        setRunError(body?.message ?? `HTTP ${res.status}`)
        return
      }

      for await (const frame of parseSseStream(res.body)) {
        setLog((prev) => [...prev, { seq: seqRef.current++, name: frame.event, detail: summarizeFrame(frame.event, frame.data) }])
        if (frame.event === 'token') {
          const parsed = JSON.parse(frame.data) as { text?: string }
          if (typeof parsed.text === 'string') setLiveText((prev) => prev + parsed.text)
        } else if (frame.event === 'run_finished') {
          const parsed = JSON.parse(frame.data) as { outputs?: Record<string, unknown> }
          setRunOutputs(parsed.outputs ?? {})
        } else if (frame.event === 'run_failed') {
          const parsed = JSON.parse(frame.data) as { message?: string }
          setRunError(parsed.message ?? 'run failed')
        }
        // 逐事件让出一次，保证 token 能一段段渲染出来。
        await yieldToPaint()
      }
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '4px 10px',
    border: '1px solid #999',
    borderRadius: 4,
    background: active ? '#333' : '#fff',
    color: active ? '#fff' : '#333',
    cursor: 'pointer',
  })

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>画布编辑</h1>
        <button onClick={() => void handleSave()} disabled={busy}>
          保存草稿
        </button>
        <button onClick={() => void handlePublish()} disabled={busy}>
          发布
        </button>
        <a href="/apps">返回列表</a>
      </div>

      {error !== null && <p style={{ color: 'crimson' }}>操作失败：{error}</p>}
      {message !== null && <p style={{ color: 'seagreen' }}>{message}</p>}
      {loading && <p>加载中…</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 340px', gap: 12, height: '72vh' }}>
        <aside style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>节点面板</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button onClick={() => addNode('start')}>开始</button>
            <button onClick={() => addNode('llm')}>LLM</button>
            <button onClick={() => addNode('end')}>结束</button>
          </div>
        </aside>

        <div ref={canvasRef} style={{ border: '1px solid #ddd', borderRadius: 6 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={(params) => setSelectedNodeId(params.nodes[0]?.id ?? null)}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <aside style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button style={tabStyle(panel === 'inspector')} onClick={() => setPanel('inspector')}>
              节点检查器
            </button>
            <button style={tabStyle(panel === 'run')} onClick={() => setPanel('run')}>
              调试运行
            </button>
          </div>

          {panel === 'inspector' && (
            <>
              {selectedNode === null && <p style={{ color: '#888' }}>未选中节点。点击画布中的节点进行编辑。</p>}
              {selectedNode !== null && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    类型：<code>{selectedNode.type}</code>
                  </div>
                  <label>
                    标题
                    <input
                      value={String(selectedNode.data.title ?? '')}
                      onChange={(e) => updateNodeData(selectedNode.id, { title: e.target.value })}
                      style={{ display: 'block', width: '100%' }}
                    />
                  </label>

                  {selectedNode.type === 'start' && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontWeight: 600 }}>输入变量</div>
                      {selectedInputs.map((item, index) => (
                        <div
                          key={index}
                          style={{ border: '1px solid #eee', borderRadius: 4, padding: 6, display: 'grid', gap: 4 }}
                        >
                          <input
                            placeholder="变量名，如 topic"
                            value={item.name}
                            onChange={(e) =>
                              updateNodeData(selectedNode.id, {
                                inputs: selectedInputs.map((cur, i) =>
                                  i === index ? { ...cur, name: e.target.value } : cur,
                                ),
                              })
                            }
                            style={{ width: '100%' }}
                          />
                          <label style={{ fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={item.required === true}
                              onChange={(e) =>
                                updateNodeData(selectedNode.id, {
                                  inputs: selectedInputs.map((cur, i) =>
                                    i === index ? { ...cur, required: e.target.checked } : cur,
                                  ),
                                })
                              }
                            />{' '}
                            必填
                          </label>
                          <button
                            onClick={() =>
                              updateNodeData(selectedNode.id, {
                                inputs: selectedInputs.filter((_cur, i) => i !== index),
                              })
                            }
                          >
                            删除变量
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateNodeData(selectedNode.id, {
                            inputs: [...selectedInputs, { name: '', type: 'string', required: false }],
                          })
                        }
                      >
                        新增输入
                      </button>
                    </div>
                  )}

                  {selectedNode.type === 'llm' && (
                    <>
                      <label>
                        模型（阶段 5 才生效）
                        <input
                          value={String(selectedNode.data.model ?? '')}
                          onChange={(e) => updateNodeData(selectedNode.id, { model: e.target.value })}
                          style={{ display: 'block', width: '100%' }}
                        />
                      </label>
                      <label>
                        提示词（Prompt）
                        <textarea
                          placeholder="支持 {{ inputs.xxx }} / {{ 节点id.字段 }} 模板"
                          value={String(selectedNode.data.prompt ?? '')}
                          onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                          rows={6}
                          style={{ display: 'block', width: '100%' }}
                        />
                      </label>
                    </>
                  )}

                  {selectedNode.type === 'end' && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontWeight: 600 }}>输出变量</div>
                      {selectedOutputs.map((item, index) => (
                        <div
                          key={index}
                          style={{ border: '1px solid #eee', borderRadius: 4, padding: 6, display: 'grid', gap: 4 }}
                        >
                          <input
                            placeholder="输出名，如 result"
                            value={item.name}
                            onChange={(e) =>
                              updateNodeData(selectedNode.id, {
                                outputs: selectedOutputs.map((cur, i) =>
                                  i === index ? { ...cur, name: e.target.value } : cur,
                                ),
                              })
                            }
                            style={{ width: '100%' }}
                          />
                          <input
                            placeholder="值，可写 {{ 节点id.text }}"
                            value={item.value}
                            onChange={(e) =>
                              updateNodeData(selectedNode.id, {
                                outputs: selectedOutputs.map((cur, i) =>
                                  i === index ? { ...cur, value: e.target.value } : cur,
                                ),
                              })
                            }
                            style={{ width: '100%' }}
                          />
                          <div style={{ fontSize: 11, color: '#888' }}>提示：`value` 支持 {'{{ 节点id.text }}'} 模板</div>
                          <button
                            onClick={() =>
                              updateNodeData(selectedNode.id, {
                                outputs: selectedOutputs.filter((_cur, i) => i !== index),
                              })
                            }
                          >
                            删除输出
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateNodeData(selectedNode.id, {
                            outputs: [...selectedOutputs, { name: '', value: '' }],
                          })
                        }
                      >
                        新增输出
                      </button>
                    </div>
                  )}

                  <button onClick={() => deleteNode(selectedNode.id)}>删除节点</button>
                </div>
              )}
            </>
          )}

          {panel === 'run' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontWeight: 600 }}>运行输入</div>
              <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
                由 start 节点的输入变量自动生成；带 <span style={{ color: 'crimson' }}>*</span> 为必填。
              </p>
              {startInputs.length === 0 && <p style={{ color: '#888' }}>start 节点未声明输入变量。</p>}
              <form onSubmit={handleRun} style={{ display: 'grid', gap: 8 }}>
                {startInputs.map((item, index) => (
                  <label key={index}>
                    {item.name}
                    {item.required === true && <span style={{ color: 'crimson' }}> *</span>}
                    <input
                      value={runInputs[item.name] ?? ''}
                      onChange={(e) => setRunInputs((prev) => ({ ...prev, [item.name]: e.target.value }))}
                      required={item.required === true}
                      style={{ display: 'block', width: '100%' }}
                    />
                  </label>
                ))}
                <button type="submit" disabled={running}>
                  {running ? '运行中…' : '运行'}
                </button>
              </form>

              {runError !== null && <p style={{ color: 'crimson' }}>运行失败：{runError}</p>}

              <div>
                <div style={{ fontWeight: 600 }}>流式输出（token 累加）</div>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: '#f7f7f7',
                    padding: 6,
                    margin: 0,
                    minHeight: 40,
                    fontSize: 13,
                  }}
                >
                  {liveText}
                </pre>
              </div>

              {runOutputs !== null && (
                <div>
                  <div style={{ fontWeight: 600 }}>运行输出（run_finished.outputs）</div>
                  <pre style={{ whiteSpace: 'pre-wrap', background: '#eef7ee', padding: 6, margin: 0, fontSize: 13 }}>
                    {JSON.stringify(runOutputs, null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <div style={{ fontWeight: 600 }}>事件日志</div>
                <div
                  ref={logRef}
                  style={{
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    padding: 6,
                    height: 200,
                    overflow: 'auto',
                    fontFamily: 'monospace',
                    fontSize: 12,
                  }}
                >
                  {log.length === 0 && <span style={{ color: '#888' }}>（暂无事件）</span>}
                  {log.map((entry) => (
                    <div key={entry.seq}>
                      <strong>{entry.name}</strong> {entry.detail}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

/** 应用画布页：读取草稿 → 编辑 → 保存 / 发布 / 调试运行；未登录引导去 /login。 */
export default function AppGraphPage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
```

**相比阶段 3 · 06 的改动**（画布、检查器、保存/发布均**未变**，这里只列**新增**）：

- **新增 `import { parseSseStream } from './sse'`**（4.1 的模块）。
- **新增面板切换**：`panel: 'inspector' | 'run'`，右侧 aside 顶部加两个标签按钮，按 `panel` 渲染「节点检查器」或「调试运行」。
- **新增运行状态**：`runInputs` / `running` / `log` / `liveText` / `runOutputs` / `runError`；两个 ref：`logRef`（日志滚动容器）、`seqRef`（日志自增序号）。
- **新增 `startInputs`（`useMemo`）**：从 `nodes` 里找 `type === 'start'` 的节点、取其 `data.inputs`（数组），用于**自动生成表单**（见 5.5）。
- **`initialData` 调整**：`start` 初始 `{ title, inputs: [] }`、`end` 初始 `{ title, outputs: [] }`，与引擎解释的形状对齐（本阶段 03）。
- **检查器扩展**：start 节点可**增删输入变量**（name + required），end 节点可**增删输出变量**（name + value）。
- **新增 `handleRun`**：`fetch` POST `/run` → 判 `content-type` → `parseSseStream` 逐帧消费 + 逐事件让出（见 5.5 / 5.6）。
- **新增 `summarizeFrame` / `yieldToPaint`**（见 5.5 / 5.6）。
- **新增日志自动滚动 `useEffect`**（见 5.7）。

---

## 5. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 4 · 06」并直接使用。

### 5.1 为什么不能用 `EventSource`：它无法携带 `Authorization` 头

**`EventSource` 是什么**：浏览器内置的 SSE 客户端。用法极其简单：

```js
const es = new EventSource('http://localhost:3001/apps/abc/run')   // 本项目**没有**这么写
es.addEventListener('token', (e) => console.log(e.data))
```

它替你做了「**自动重连、自动按 SSE 分帧、按 `event:` 名分发**」。听起来完美——但有两个致命限制，让它在本项目**不可用**：

| 限制 | 说明 | 对本项目的后果 |
| --- | --- | --- |
| **① 只能 `GET`** | `EventSource` 构造函数只有 URL，不支持指定 HTTP 方法 | 契约是 `POST /apps/{id}/run`（要带请求体 `inputs`），`GET` 对不上 |
| **② 无法自定义请求头** | **不能加 `Authorization`** | 本项目 `/run` 走 **Bearer JWT**（阶段 1 · 03），`EventSource` 根本发不出令牌 → 必然 401 |

**因此本项目必须自己来**：用 **`fetch`**（能带任意头、能用 `POST`、能带 body）发请求，然后**手动**读取响应体这个**流**并**手动**分帧——这正是 `sse.ts` 干的事，也是本篇的教学重心。

```ts
const res = await fetch(`${API_BASE}/apps/${appId}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },  // ← EventSource 做不到
  body: JSON.stringify({ inputs }),
})
for await (const frame of parseSseStream(res.body!)) { /* 手动分帧 */ }
```

> **代价**：自动重连、`Last-Event-ID` 续传这些 `EventSource` 的福利都得自己实现——对本项目的**调试运行**（一次性短流）而言代价可忽略。

### 5.2 `ReadableStream` + `TextDecoder`：`{ stream: true }` 增量解码

**`res.body` 是什么**：`fetch` 成功且响应是流式时，`res.body` 是一个 **`ReadableStream<Uint8Array>`**——「一块一块给你**字节**」的异步流。它**不认识文本**，只认字节（`Uint8Array`）。要把字节变回字符串，需要 **`TextDecoder`**：

```ts
const reader = res.body.getReader()          // 拿一个读取器
const decoder = new TextDecoder()            // UTF-8 解码器
const { value, done } = await reader.read()  // 每次读一块 Uint8Array（或 done=true 表示流结束）
const text = decoder.decode(value)           // 把这块字节解码成字符串
```

**核心坑：chunk 会在任意字节处切断。** 网络分块**不保证**在「字符边界」上切。若一个汉字（UTF-8 占 3 字节）被切成 `<前 2 字节>` + `<后 1 字节>`两块，**任何一块单独解码都会变成乱码**（U+FFFD 替换符）。

**解法：`decoder.decode(value, { stream: true })`** —— `{ stream: true }` 告诉解码器「这不是最后一块，请**把可能被切断的多字节残片先存着**，等下一块来了再拼」。等流结束时，再调一次不带参数的 `decoder.decode()` **冲出残片**：

```ts
buffer += decoder.decode(value, { stream: true })   // 循环里：增量解码，保留残片
// …
buffer += decoder.decode()                          // 流结束：冲出解码器内部残余
```

> 这也解释了第 3 节里那条「**每 7 字节**喂入」的用例：它专门制造「多字节字符被 chunk 边界截断」的极端情况，验证 `{ stream: true }` 的拼接是否奏效。

### 5.3 手动 SSE 分帧算法

SSE 的流是**纯文本**，规则（`sse-events.md` §1）：

- 一个事件 = 若干**字段行** + **一个空行**收尾；
- 字段行形如 `<field>: <value>`（冒号后可有一个**可选空格**）；
- 本项目只用到 `event:`（事件名）与 `data:`（payload 文本）。

**最朴素的想法**：把整块字节 `decode` 成一个大字符串，再 `split('\n\n')` 切事件。**这是错的**，因为：

1. **块边界可能把一行、甚至一个帧切成两半**——直接切会把帧切错；
2. **多字节 UTF-8 会被切**（上面 5.2 的问题）。

**正确做法：每次只切「完整行」，残余留缓冲。** `parseSseStream` 的三层结构：

**① 缓冲区 + 逐行切分（跨 chunk 拼接）**

```ts
buffer += decoder.decode(value, { stream: true })
let newlineIndex: number
while ((newlineIndex = buffer.indexOf('\n')) !== -1) {   // 只取「到最近的 \n」的一整行
  const line = buffer.slice(0, newlineIndex)
  buffer = buffer.slice(newlineIndex + 1)                // 剩下的（可能是半行）留到下一 chunk
  const frame = handleLine(line)
  if (frame !== null) yield frame
}
```

关键：**绝不假设「一块 chunk 里一定是整数个行/帧」**。半行永远留在 `buffer` 里，与下一块拼起来再切。

**② `handleLine`：逐行解析字段（含 CRLF 兼容与注释忽略）**

```ts
const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine   // CRLF → 剥掉 \r
if (line === '') return flushFrame()                                    // 空行 → 帧结束
if (line.startsWith(':')) return null                                   // 注释行（如心跳 `: ping`）忽略

const colon = line.indexOf(':')
const field = colon === -1 ? line : line.slice(0, colon)
const rawValue = colon === -1 ? '' : line.slice(colon + 1)
const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue    // 剥「冒号后可选空格」
```

- **CRLF 兼容**：若服务端用 `\r\n` 结尾，按 `\n` 切出的行尾会带一个 `\r`，必须剥掉，否则 `event:` 的值会变成 `"name\r"`。
- **注释行**：SSE 用「以 `:` 开头」的行做注释（常见于心跳 `: keep-alive`），必须**忽略**，不能当成字段。
- **冒号后空格**：`data: {"a":1}` 与 `data:{"a":1}` 都合法，规范规定剥掉一个可选空格。

**③ `flushFrame`：空行收帧 + 多行 `data` 拼接**

```ts
if (field === 'event') { eventName = value; hasField = true }
else if (field === 'data') { dataLines.push(value); hasField = true }   // 可多行，先攒起来
// …
const frame = { event: eventName === '' ? 'message' : eventName, data: dataLines.join('\n') }
```

- **多行 `data:`**：规范里同一事件的多个 `data:` 行要按 `\n` **拼接**（本项目每帧只有一行 `data`，但通用实现必须支持——这也是第 3 节用例 6）。
- **事件名缺省**：只写 `data:` 不写 `event:` 时，事件名默认为 `"message"`。
- **`hasField` 哨兵**：避免「连续空行」时产出空事件；只有真攒了字段才 `flushFrame`。

**④ 流末尾收尾**：可能最后一行**没有换行结尾**（第 3 节用例 5），所以循环结束后要补处理一次：

```ts
buffer += decoder.decode()               // 冲出解码器残片
if (buffer !== '') { handleLine(buffer) } // 处理最后一行
const tail = flushFrame()                 // 末尾没空行收尾时，把已攒字段作为最后一个事件
```

> **一句话记忆分帧算法**：**「按 `\n` 切行 → 空行收帧 → `event:` 给名、`data:` 可多行拼接 → 注释行忽略 → 残余留缓冲跨 chunk 拼」**。

### 5.4 把解析抽成独立模块 `sse.ts` 的理由

`parseSseStream` 本可以内联写在 `page.tsx` 里，但本项目**特意抽成独立文件**，理由有三，都是工程实践：

1. **可单测**：它是**纯逻辑**（输入字节流 → 输出事件），不依赖 React、不依赖 DOM、不依赖网络。抽出后可以用一次性脚本喂各种「刁钻的字节切分」（单 chunk / 逐字符 / 每 7 字节 / CRLF / 多行 data / 注释行 / 末帧无空行）来验证——第 3 节那 7 项用例正是这么跑的。若内联在组件里，就没法脱离 React 环境测。
2. **可复用**：阶段 10 的「已发布应用」对外 SSE 接口、甚至未来的其它流式接口，都能直接 `import { parseSseStream }`，不必重写。
3. **职责单一**：`page.tsx` 负责「UI 与状态」，「字节 → 事件」的脏活交给 `sse.ts`。组件里只剩 `for await` 一段，可读性高。

**为什么用 `AsyncGenerator`（`async function*`）而不是回调或返回数组**：

- **数组**：要等**整个流结束**才返回 —— **没有流式**（又把 `token` 攒一起了）。
- **回调**（`parse(body, onEvent)`）：能流式，但把「控制流」交给别人，调用方难 `break`、难 `return`、难 `await` 后续处理。
- **异步生成器**：**边产边给**，调用方用 `for await … of` 一点点消费，还能在循环体里做「异步动作」（比如本项目每帧 `await yieldToPaint()`，见 5.6）。异步生成器是「**拉取型**流式消费」最自然的 JS 表达。

```ts
for await (const frame of parseSseStream(res.body)) {   // 每来一帧，循环体跑一次
  // …消费 frame
}
```

### 5.5 运行面板：自动表单 / 事件日志 / token 累加 / 输出 / 错误

面板要呈现四件事，逐块讲：

**(a) 由 `start.data.inputs` 自动生成输入表单**

契约里 `start` 节点用 `data.inputs` **声明**它要哪些输入（`{ name, type: 'string', required }`）。面板据此**动态生成表单**——不需要硬编码字段名：

```tsx
const startInputs = useMemo<InputDecl[]>(() => {
  const start = nodes.find((node) => node.type === 'start')
  const raw = start?.data.inputs
  return Array.isArray(raw) ? (raw as InputDecl[]) : []
}, [nodes])
// …
{startInputs.map((item, index) => (
  <label key={index}>
    {item.name}{item.required === true && <span style={{ color: 'crimson' }}> *</span>}
    <input value={runInputs[item.name] ?? ''} required={item.required === true}
      onChange={(e) => setRunInputs((prev) => ({ ...prev, [item.name]: e.target.value }))} />
  </label>
))}
```

- 用 `useMemo<InputDecl[]>` 缓存（`nodes` 变才重算）——本质同阶段 2 · 06 的 `useMemo`，只引用。
- 提交时把表单值收成 `inputs` 对象发给后端（只发 start 声明的变量）：

```ts
const inputs: Record<string, unknown> = {}
for (const decl of startInputs) inputs[decl.name] = runInputs[decl.name] ?? ''
```

**(b) 事件日志**：每收到一帧，追加一条 `{ seq, name, detail }`。序号用 `seqRef.current++`（`useRef` 保存跨渲染的计数器，天然稳定，可作 React `key`）。`detail` 用 `summarizeFrame`：`token` 事件摘要成「节点id · "文本"」，其余事件直接放（超 300 字截断）。

**(c) `token` 事件累加渲染（流式效果）**：把每个 `token` 的 `text` **追加**到 `liveText`：

```ts
if (frame.event === 'token') {
  const parsed = JSON.parse(frame.data) as { text?: string }
  if (typeof parsed.text === 'string') setLiveText((prev) => prev + parsed.text)   // 累加
}
```

`setLiveText((prev) => prev + text)` 用**函数式更新**累加——这样即使多个 `setState` 排队，也基于「最新值」而非「闭包里的旧值」（阶段 2 · 06 已讲函数式更新，这里只引用）。

**(d) 结果与错误分流**：

```ts
if (frame.event === 'run_finished') { setRunOutputs(parsed.outputs ?? {}) }
else if (frame.event === 'run_failed') { setRunError(parsed.message ?? 'run failed') }
```

- `run_finished` → 展示 `outputs`；
- `run_failed` → 展示 `message`（契约规定运行期错误走这条帧，HTTP 仍是 200——见阶段 4 · 05 的 5.6）。
- **400（请求级错误）**：**不是流**，要先判 `content-type`：

```ts
const contentType = res.headers.get('content-type') ?? ''
if (!res.ok || !contentType.includes('text/event-stream') || res.body === null) {
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  setRunError(body?.message ?? `HTTP ${res.status}`)   // 展示后端 400 原文
  return
}
```

这就是「**错误分流**」在前端的对应处理：**流**走 `parseSseStream`；**非流**（400/其它）按 JSON 读 `message`。前端因此能区分「图非法 / 草稿为空」和「运行中途失败」。

### 5.6 React 批处理导致的坑（真实踩到）：`token` 不逐段显示

**现象**：后端明明**分多次**发 `token` 帧，但前端「流式输出」区**要么一次性全出来，要么根本看不出逐段**——看不到打字机效果。

**根因：React 的自动批处理（automatic batching）。** `setState` 不是立刻渲染，而是**排队**；React 会把**同一个事件/同一个 tick 内的多次 `setState` 合并成一次渲染**。而我们的消费循环 `for await (const frame of parseSseStream(...))` 是**一个连续的异步循环**——如果某个网络 chunk 里一次带了好几帧（甚至整条流一次到达），循环体会**连续**执行多次 `setLiveText(...)`，React 把它们**批量**成一次渲染 → 界面上 `token` **一起出现**，而不是一段段。

**解法：每处理完一帧，主动「让出一次宏任务」**，给浏览器 / React 一个「提交更新并重绘」的机会：

```ts
/** 让出一次宏任务，确保 React 能在每个事件之间提交更新（token 才能逐段显示）。 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })   // 排到宏任务队列末尾
}
// 循环末尾：
await yieldToPaint()
```

- `setTimeout(resolve, 0)` 把「继续循环」这件事**推迟到当前宏任务结束之后**，其间浏览器得以处理「渲染提交 + 重绘」；
- **为什么不是微任务**（`await Promise.resolve()`）：微任务仍在**同一个宏任务**内清空，React 的批处理边界不会被打破，因此看不见效果；必须是**宏任务**级让出。

**实测（真实 Chrome，CDP 驱动真实 DOM，用 `MutationObserver` 记录「流式输出」区文本的变化）**：

```
["", "Hello mi", "Hello mini-dify"]
```

—— 文本经历了 `"" → "Hello mi" → "Hello mini-dify"` **两次变化**，说明两片 `token` **分段渲染**了（**没有**被批处理成一次）。这正证明 `yieldToPaint()` 生效。

> 若删掉 `await yieldToPaint()`，同一 chunk 内的多片 `token` 会被 React 批量，观察到的变化序列往往只剩 `["", "Hello mini-dify"]`（一次到位），看不到中间态。

### 5.7 若干配套首次点（简讲）

- **`'use client'`**：本页有 Hook / 浏览器 API（`fetch` / `ReadableStream` / `TextDecoder` / `localStorage`），必须是客户端组件（阶段 0 · 07）。
- **带鉴权的 `fetch` + 401 处理**：`Authorization: Bearer <token>`，`res.status === 401` 就 `router.replace('/login')`（阶段 2 · 06，只引用）。SSE 请求同样适用。
- **`res.headers.get('content-type')`**：用 `Headers.get` 读响应头，做「是否流」的判断（5.5(d)）。
- **`JSON.parse(frame.data)`**：`data` 是服务端序列化好的**单行 JSON 文本**，前端再 `JSON.parse` 回对象取字段（`token.text` / `run_finished.outputs` / `run_failed.message`）。
- **`reader.releaseLock()`**：`sse.ts` 在 `finally` 中释放读取锁，避免流被一直占用（配合生成器被提前 `break` 也安全）。
- **日志自动滚动**：`logRef` 挂到日志容器；`useEffect(..., [log])` 在每次日志变化后 `el.scrollTop = el.scrollHeight`（滚到底，回顾 5.5）。
- **`useRef` 做计数器**：`seqRef.current++` 给日志行稳定序号当 `key`（`useRef` 跨渲染保持，不像 state 每次改变触发渲染）。`useRef` 见阶段 3 · 06，只引用。
- **`type FormEvent<HTMLFormElement>`**：表单 `onSubmit` 事件类型；`event.preventDefault()` 阻止整页提交（受控表单，阶段 2 · 06，只引用）。
- **内联 `style`（照实说明）**：本项目**未配置 Tailwind**（无 `tailwind.config.*` / `postcss.config.*`），运行面板与画布、检查器一样**只用内联 `style`**（`tabStyle` 是本节新增的内联样式函数）。
- **`pre` + `whiteSpace: 'pre-wrap'`**：流式文本要**保留换行与空格**，才能正确显示多行 LLM 输出，故用 `<pre style={{ whiteSpace: 'pre-wrap' }}>`。

---

## 6. 验收自测

> 本篇验收聚焦**浏览器端**（真实 Chrome）。更完整的**跨后端端到端**验收（两端事件序列逐项一致、token 分片逐字节一致、反向用例）见本阶段 `07-验收.md`。

先确保 `pnpm dev:web`（3000）与 `pnpm dev:api-ts`（3001）都在跑，已登录 `alice@example.com`，且有一个应用与合法草稿图（`start` 声明输入 `topic`、`llm` 的 prompt 形如 `Hello mini-dify`（或引用 `{{ inputs.topic }}`）、`end` 输出 `result = {{ <llmId>.text }}`）。

| 检查项 | 操作 | 预期（**实测**） |
| --- | --- | --- |
| 面板切换 | 画布页右侧点「调试运行」 | 出现「运行输入」「流式输出」「事件日志」区块 |
| 自动表单 | 看「运行输入」 | 由 `start.data.inputs` 生成；必填项带红色 `*` |
| 流式（逐段） | 点「运行」 | 「流式输出」文字**逐段冒出**：先 `Hello mi`、再补齐 `Hello mini-dify` |
| 事件日志 | 看日志区 | 逐条：`run_started` → `node_started`(start) → `node_finished`(start) → `node_started`(llm) → `token` × N → `node_finished`(llm) → `node_started`(end) → `node_finished`(end) → `run_finished` |
| 运行输出 | 看「运行输出」 | `{"result":"Hello mini-dify"}` |
| 运行期失败 | `llm` 的 prompt 写 `{{ inputs.nope }}` 再运行 | 「运行失败：**template variable not found: inputs.nope**」 |
| 请求级失败（空草稿） | 对一个空草稿应用直接运行 | 「运行失败：**Graph is empty**」（后端 400 原文） |
| 请求级失败（图非法） | 删掉 end 节点、**保存**（报 `操作失败：graph must contain at least one end node`），再运行 | 「运行失败：**graph must contain at least one end node**」 |

**实测回放（照实记录）**

```
真实 Chrome（CDP 驱动真实 DOM）打开画布页 → 右侧「调试运行」
MutationObserver 记录「流式输出」区文本变化： ["", "Hello mi", "Hello mini-dify"]  ← token 逐段出现
事件日志逐条滚动（run_started / node_started / token / node_finished / run_finished）
「运行输出」显示：{"result":"Hello mini-dify"}
把 llm 的 prompt 改成 {{ inputs.nope }} → 运行 → 「运行失败：template variable not found: inputs.nope」
把一个空草稿应用直接运行 → 「运行失败：Graph is empty」（后端 400 原文，非流）
删掉 end 节点后保存 → 「操作失败：graph must contain at least one end node」
```

---

## 7. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **用了 `EventSource`** | 请求 401 / 方法不对 | `EventSource` **不能带 `Authorization` 头、只能 `GET`**。改用 `fetch` + `parseSseStream`（第 5.1 节） |
| 2 | **`TextDecoder` 不加 `{ stream: true }`** | 含中文/emoji 的输出偶发乱码（`�`） | chunk 在多字节 UTF-8 中间切断，必须增量解码、末尾再 `decoder.decode()` 冲残片（第 5.2 节） |
| 3 | **分帧不保留残余、直接 `split('\n\n')`** | 帧被截断、丢事件 | 块边界会把帧切两半。必须**按行切 + 残余留 buffer** 跨 chunk 拼接（第 5.3 节） |
| 4 | **没剥行尾 `\r`** | 事件名带了 `\r`，`switch` 对不上 | CRLF 服务器：剥掉行尾 `\r`（第 5.3 节） |
| 5 | **多行 `data:` 没拼接** | payload 少半截 | 多个 `data:` 行要按 `\n` 拼接后再 `JSON.parse`（第 5.3 节） |
| 6 | **把注释行当字段** | 心跳行污染事件 | 以 `:` 开头的行是注释，忽略（第 5.3 节） |
| 7 | **`token` 一次性全出来（无打字机效果）** | 看不到流式 | React **批处理**了连续多次 `setState`。每帧后 `await yieldToPaint()`（宏任务让出）（第 5.6 节） |
| 8 | **用微任务让出**（`await Promise.resolve()`） | 仍然不逐段 | 微任务在同一宏任务内清空、批处理边界不变。必须 `setTimeout(resolve, 0)`（第 5.6 节） |
| 9 | **不判 `content-type` 直接当流解析** | 图非法时前端「卡住」或报错不清 | 400 是**普通 JSON 非流**。先判 `content-type.includes('text/event-stream')`，否则按 JSON 读 `message`（第 5.5 节） |
| 10 | **忘了 401 处理** | 令牌过期时流式请求静默失败 | `res.status === 401` → `router.replace('/login')`（阶段 2 · 06） |
| 11 | **`key` 用数组下标** | 日志增删时渲染错乱 | 日志行用稳定自增序号 `seqRef.current++` 当 `key`（第 5.5 节） |
| 12 | **流式文本用普通 `div`** | 多行/空格被折叠、显示不对 | 用 `<pre style={{ whiteSpace: 'pre-wrap' }}>`（第 5.7 节） |

---

## 8. 本篇复盘与知识点

**一句话总结本篇**：SSE 前端**不能用 `EventSource`**（带不了 `Authorization`、只能 `GET`），必须 `fetch` + `ReadableStream.getReader()` **自己读字节**；字节用 `TextDecoder({ stream: true })` **增量解码**（防多字节截断）；文本用「**按行切 → 空行收帧 → 残余留缓冲跨 chunk 拼**」的算法**手动分帧**——这套逻辑抽成可单测的 `sse.ts`（`AsyncGenerator`）；面板据事件累加渲染 `token`，并用**宏任务让出**绕开 React 批处理，才看得到打字机效果。

**本篇学到的工程要点**

1. **`EventSource` 的两条死路**：不能带自定义头（`Authorization`）、只能 `GET` → 鉴权 SSE 必须走 `fetch`。
2. **增量解码**：`TextDecoder({ stream: true })` 保留被 chunk 切断的多字节残片，流末尾再冲一次。
3. **手动分帧**：按行切 + 空行收帧 + `event`/`data` 解析 + 多行 data 拼接 + 注释行忽略 + 残余跨 chunk 拼接。
4. **抽成独立模块**：纯逻辑 → 可单测（7 项用例 PASS）、可复用、组件更干净；用 `AsyncGenerator` 实现「拉取型流式」。
5. **错误分流**：流走 `parseSseStream`；非流（400）先判 `content-type` 再按 JSON 读 `message`。
6. **React 批处理的坑**：连续 `setState` 会被批量 → `token` 不逐段；用 `await setTimeout(0)` 逐事件让出宏任务才能修复（Chrome 实测 `["","Hello mi","Hello mini-dify"]`）。

**遗留 / 后续**

- `EventSource` 的「自动重连 + `Last-Event-ID` 续传」本项目未实现（调试运行是一次性短流）——对外发布接口（阶段 10）再考虑。
- `llm` 节点是**桩**（无真实模型），真实 token 流与模型切换见阶段 5。
- 中断运行（客户端 `AbortController` / 服务端停止）暂未处理。

---

## 9. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| `EventSource` 的限制（无法带 `Authorization` 头、只能 `GET`）→ 鉴权 SSE 必须用 `fetch` + `res.body.getReader()` | **首次教学于本篇** |
| `ReadableStream` + `TextDecoder` 的 `{ stream: true }` 增量解码（防多字节 UTF-8 被 chunk 切断） | **首次教学于本篇** |
| 手动 SSE 分帧算法（按行切 / 空行收帧 / `event`+多行 `data` 解析 / 注释行忽略 / 残余缓冲跨 chunk 拼接） | **首次教学于本篇** |
| 把 SSE 解析抽成独立模块 `sse.ts`（`parseSseStream` 返回 `AsyncGenerator`）的理由：可单测、可复用 | **首次教学于本篇** |
| 运行面板：由 `start.data.inputs` 自动生成表单；事件日志；`token` 累加渲染；`run_finished.outputs` / `run_failed` / 400 分流展示 | **首次教学于本篇** |
| React 批处理导致 `token` 不逐段 → 逐事件让出宏任务（`await new Promise((r) => setTimeout(r, 0))`） | **首次教学于本篇** |
