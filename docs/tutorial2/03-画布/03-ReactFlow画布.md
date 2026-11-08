# 03 · ReactFlow 画布（画布）

> 阶段 3 · 第 3 步
>
> 做完：`/apps/{id}` 打开画布；左侧画布可拖拽/连线，右侧面板添加节点；「保存草稿」调 `PUT .../graph`，「发布」先保存再 `POST .../graph/publish`；刷新后节点位置与连线完整恢复。
>
> **本篇面试考点**：受控 vs 非受控画布 · `nodeTypes` 为什么不能写在组件里 · `screenToFlowPosition` 与缩放平移 · React Flow 的 `Node` 类型 vs 契约的 `GraphNode` · 前端生成 `id` 与 `crypto.randomUUID` · 发布为什么是“先存后发” · `fitView` 为什么要延迟 · 把 React 状态序列化成契约 JSON 的边界。

---

## 1. 依赖

**完整文件路径：`apps/web/package.json`**（节选）

```json
{
  "dependencies": {
    "@xyflow/react": "^12.12.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.6.7"
  }
}
```

```powershell
pnpm install
```

样式是**必须**引的，否则节点与连线不可见：

```tsx
import '@xyflow/react/dist/style.css'
```

---

## 2. 前端 schema

**完整文件路径：`apps/web/lib/schemas.ts`**（画布节选）

```ts
/** 画布节点类型。 */
export const graphNodeTypeSchema = z.enum([
  'start',
  'end',
  'llm',
  'knowledge',
  'condition',
  'aggregator',
  'iteration',
])

/** 画布节点：`data` 为各节点自由结构的配置。 */
export const graphNodeSchema = z.strictObject({
  id: z.string(),
  type: graphNodeTypeSchema,
  position: z.strictObject({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()),
})

/** 画布连线。 */
export const graphEdgeSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
})

/** 画布图（草稿与已发布共用）。 */
export const graphSchema = z.strictObject({
  version: z.string(),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
})

/** POST /apps/{id}/graph/publish 的响应体。 */
export const publishGraphResponseSchema = z.strictObject({
  publishedAt: utcTimestampSchema,
  graph: graphSchema,
})

export type Graph = z.infer<typeof graphSchema>
export type GraphNodeType = z.infer<typeof graphNodeTypeSchema>
```

> `graphNodeTypeSchema.parse(node.type)` 在保存时使用：React Flow 的 `Node.type` 是 `string | undefined`，直接断言成枚举是编译期撒谎。**入口（网络）和出口（发请求）都要过 Zod。**

---

## 3. 页面结构

最终仓库里 [page.tsx](file:///d:/user/my_project/github/mini-dify/apps/web/app/apps/[id]/page.tsx) 有 2200 多行——因为它同时承载了阶段 4 的调试运行面板、阶段 5 的 LLM 参数、阶段 8 的分支面板、阶段 9 的会话、阶段 10 的发布面板。

本篇只讲**阶段 3 的核心**：节点渲染、添加、连线、保存、发布。下面每一段都是仓库中的真实代码（后续阶段在同一个文件里追加）。

### 3.1 自定义节点

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（节选）

```tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
```

```tsx
/** 每种节点的强调色（只用于 `.node-dot` 的圆点颜色）。 */
const NODE_ACCENT: Record<NodeType, string> = {
  start: '#059669',
  end: '#6b7280',
  llm: '#4f46e5',
  knowledge: '#7c5cff',
  condition: '#e11d48',
  aggregator: '#0ea5e9',
  iteration: '#f59e0b',
}

/** 节点外壳：统一卡片样式 + 上/下两个连接点。 */
function NodeShell({
  title,
  type,
  accent,
  selected,
  hasTarget,
  hasSource,
}: {
  title: string
  type: string
  accent: string
  selected: boolean
  hasTarget: boolean
  hasSource: boolean
}) {
  return (
    <div className={`node-card${selected ? ' is-selected' : ''}`}>
      {/* target Handle 在顶部：连线进入 */}
      {hasTarget && <Handle type="target" position={Position.Top} />}
      <div className="node-card-head">
        <span className="node-dot" style={{ background: accent }} />
        <span className="truncate">{title}</span>
      </div>
      <div className="node-meta">{type}</div>
      {/* source Handle 在底部：连线拖出 */}
      {hasSource && <Handle type="source" position={Position.Bottom} />}
    </div>
  )
}

function StartNode({ data, selected }: NodeProps) {
  return (
    <NodeShell
      title={String(data.title ?? '开始')}
      type="start"
      accent={NODE_ACCENT.start}
      selected={selected}
      hasTarget={false}   // 起点没有入边
      hasSource
    />
  )
}

function EndNode({ data, selected }: NodeProps) {
  return (
    <NodeShell
      title={String(data.title ?? '结束')}
      type="end"
      accent={NODE_ACCENT.end}
      selected={selected}
      hasTarget
      hasSource={false}   // 终点没有出边
    />
  )
}

function LlmNode({ data, selected }: NodeProps) {
  return (
    <NodeShell
      title={String(data.title ?? 'LLM')}
      type="llm"
      accent={NODE_ACCENT.llm}
      selected={selected}
      hasTarget
      hasSource
    />
  )
}

function KnowledgeNode({ data, selected }: NodeProps) {
  return (
    <NodeShell
      title={String(data.title ?? '知识检索')}
      type="knowledge · 检索"
      accent={NODE_ACCENT.knowledge}
      selected={selected}
      hasTarget
      hasSource
    />
  )
}
```

`condition` / `aggregator` / `iteration` 三个节点在阶段 8 才加（`condition` 的每个分支需要一个独立 `source` Handle，和这里的单出口结构不同）。

```tsx
/** 节点类型 → 组件。必须是稳定引用（见下方面试考点）。 */
const nodeTypes = {
  start: StartNode,
  end: EndNode,
  llm: LlmNode,
  knowledge: KnowledgeNode,
  condition: ConditionNode,
  aggregator: AggregatorNode,
  iteration: IterationNode,
}

/** 每种节点的初始 data（与引擎解释的形状对齐）。阶段 3 只实现前四种。 */
function initialData(type: NodeType): Record<string, unknown> {
  if (type === 'start') return { title: '开始', inputs: [] }
  if (type === 'llm') return { title: 'LLM', prompt: '' }
  if (type === 'knowledge') {
    return { title: '知识检索', knowledgeBaseId: '', query: '{{ inputs.topic }}', topK: 4 }
  }
  return { title: '结束', outputs: [] }
}
```

> **面试考点 · `nodeTypes` 为什么必须定义在组件外（或 `useMemo`）？**
> React Flow 内部用 `nodeTypes[type]` 查组件。如果每次渲染新建一个对象，引用就变了，React Flow 会认为“节点类型定义变了”，从而**卸载并重新挂载所有节点**：输入框失焦、动画重放、性能骤降。
> 把 `nodeTypes` 放在模块顶层（如上面），引用永远不变。需要动态生成时用 `useMemo(() => ({...}), [deps])`。
> **这是 React Flow 最常见的性能 bug，也是最容易忽略的“对象字面量每次都是新的”问题。**

### 3.2 加载草稿

```tsx
function Canvas() {
  const router = useRouter()
  // 动态路由参数：/apps/{id}
  const appId = useParams<{ id: string }>().id
  // screenToFlowPosition：屏幕坐标 → 画布坐标（已考虑缩放和平移）
  const { screenToFlowPosition, fitView } = useReactFlow()

  // React Flow 的受控状态：nodes / edges 及它们的变更处理器
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [appName, setAppName] = useState<string | null>(null)
  const [appMode, setAppMode] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

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
        // 草稿是外部输入：200 也过 Zod
        return parseResponse(res, graphSchema, 'GET /apps/{id}/graph')
      })
      .then((graph) => {
        if (cancelled || graph === null) return
        // 契约结构 → React Flow 结构。字段几乎同名，但有两处必须转换：
        // 1. React Flow 的 Node.type 允许 undefined，这里一定有值；
        // 2. sourceHandle 的 null 要转成 undefined（React Flow 用 undefined 表示“默认句柄”）。
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

  // 首帧画布容器高度可能还没生效，fitView 会按错误尺寸计算（节点挤在底边）。
  // 延迟 180ms 再 fit 一次，保证节点落在可视区中央。
  useEffect(() => {
    const timer = setTimeout(() => {
      void fitView({ padding: 0.2 })
    }, 180)
    return () => clearTimeout(timer)
  }, [fitView])
```

> **面试考点 · React Flow 是受控组件还是非受控组件？**
> 它把状态交给你：`nodes` / `edges` 是**你**的状态，拖拽、选中、删除都通过 `onNodesChange` / `onEdgesChange` 回调告诉你“想怎么改”，你应用到自己的状态后重新渲染。
> `useNodesState` / `useEdgesState` 就是 `useState` + 默认的变更处理器，省掉手写 applyChanges。
>
> **为什么不用非受控？** 因为画布要和“保存/校验/发布”深度联动：保存时要读取当前完整图，校验要知道哪些分支没连线。**状态必须在 React 手里。**

> **面试考点 · `screenToFlowPosition` 不能用鼠标坐标代替吗？**
> 不能。用户可能已经缩放（`zoom ≠ 1`）或平移（`transform ≠ [0,0]`），屏幕坐标 `(clientX, clientY)` 与画布坐标不是同一个坐标系。
> `screenToFlowPosition({ x, y })` 按当前 viewport 做逆变换，得到“落在画布哪个位置”。直接用手写偏移量，缩放后新节点就会跑偏。
>
> **注意它必须在 `ReactFlowProvider` 内部使用**——`useReactFlow()` 从 context 取实例。所以文件底部是：
>
> ```tsx
> export default function AppGraphPage() {
>   return (
>     <ReactFlowProvider>
>       <Canvas />
>     </ReactFlowProvider>
>   )
> }
> ```

### 3.3 添加节点与连线

```tsx
  /** 连线：React Flow 给出 { source, target, sourceHandle, targetHandle }。 */
  const onConnect = useCallback(
    (connection: Connection) => {
      // 前端生成边 id：后端不负责生成（PUT 是整图覆盖，没有“创建边”的接口）
      setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds))
    },
    [setEdges],
  )

  function addNode(type: NodeType): void {
    // 以画布可视区中心为基准，把屏幕坐标换算成画布坐标
    const rect = canvasRef.current?.getBoundingClientRect()
    const screenX = rect === undefined ? window.innerWidth / 2 : rect.left + rect.width / 2
    const screenY = rect === undefined ? window.innerHeight / 2 : rect.top + rect.height / 2
    const base = screenToFlowPosition({ x: screenX, y: screenY })
    // 按 3 列网格依次错开，避免新节点完全重叠导致“看不见、连不上”
    const index = nodes.length
    const col = index % 3
    const row = Math.floor(index / 3)
    const position = { x: base.x + col * 260 - 260, y: base.y + row * 160 - 60 }
    setNodes((nds) => [
      ...nds,
      { id: crypto.randomUUID(), type, position, data: initialData(type) },
    ])
  }

  /** 删除节点：同时删掉与它相连的所有边，避免留下“悬空边”。 */
  function deleteNode(id: string): void {
    setNodes((nds) => nds.filter((node) => node.id !== id))
    setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id))
    setSelectedNodeId((cur) => (cur === id ? null : cur))
  }
```

> **面试考点 · 为什么 `id` 由前端生成？**
> 因为保存接口是 `PUT`（整图覆盖），没有“POST 一条边”这种让服务端分配 id 的机会。前端生成 `crypto.randomUUID()`：
>
> - 浏览器原生、无需依赖；
> - 碰撞概率可忽略；
> - 离线编辑也能立刻得到稳定 id。
>
> **注意：不要用 `Date.now()` 或自增下标。** 快速连续操作可能同毫秒；下标在删除后会复用，导致“删掉的节点 id 被新节点继承”，历史数据/日志会串。

> **面试考点 · 删除节点为什么必须同时删边？**
> 后端规则 6 会检查“边的 source/target 必须存在”。只删节点不删边，保存时直接 400。
> 前端主动清理，是为了让用户在画布上永远看不到“指向空气的线”；后端校验是最后一道防线——**前端清理不是替代后端校验，而是减少无效请求。**

### 3.4 保存与发布

```tsx
  /** React Flow 状态 → 契约 `Graph`。这是前端最重要的一条边界。 */
  const buildGraph = useCallback(
    (): Graph => ({
      version: '1',
      nodes: nodes.map((node) => ({
        id: node.id,
        // React Flow 的 type 是 string | undefined；这里必须确认是合法枚举
        type: graphNodeTypeSchema.parse(node.type),
        // 只保留坐标：React Flow 节点上可能还有 selected / dragging 等 UI 字段，不能带给后端
        position: { x: node.position.x, y: node.position.y },
        data: node.data,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // 统一成 null：同一份图保存多次，JSON 形状保持一致
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })),
    }),
    [nodes, edges],
  )

  /** PUT 草稿；成功返回 null，失败返回要展示的文案（401 直接跳登录）。 */
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
      return readApiErrorMessage(res)
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
      // 先把当前画布存成草稿，再发布——否则发布的是“上一次保存的旧图”
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
        setError(await readApiErrorMessage(res))
        return
      }
      const data = await parseResponse(res, publishGraphResponseSchema, 'POST /graph/publish')
      setMessage(`已发布 · ${data.publishedAt}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
```

> **面试考点 · `buildGraph` 为什么要重建对象，不能直接 `JSON.stringify(nodes)`？**
> React Flow 的节点对象上挂着大量**UI 状态**：`selected`、`dragging`、`width`、`height`、`positionAbsolute`、`measured`……
> 直接序列化会把它们全部发给后端，存进 JSONB。后果：
>
> - 契约 `additionalProperties: false` 直接 400；
> - 即使放过，UI 状态也会变成脏数据，下次读出来又是另一套值；
> - 两套后端/两个版本的画布数据无法比对。
>
> **内存里的对象 ≠ 要持久化的对象。** 出口必须显式挑字段，这就是 DTO 在前端的对应物。

> **面试考点 · 发布为什么是“两次请求”，不是后端一次完成？**
> 前端在发布前先 `PUT`，是为了确保“用户看到的图 = 库里的草稿”。如果只调 publish，用户刚才的改动没保存，发布出去的是旧图，而页面显示的是新图——这是最典型的“所见非所发”bug。
>
> 两个请求不是原子的：`PUT` 成功、`POST publish` 失败时，草稿已更新但线上没变。界面上会显示错误，用户可重试。要原子化就得新增“发布并携带图”的接口，或让 publish 接受可选 body——**当前设计选择了“草稿是唯一真源”，接受这个中间态。**

> **面试考点 · `edge.sourceHandle ?? null` 与后端的 `undefined` 处理会不会打架？**
> 不会：
> - 前端显式发 `null` → 后端 `GraphDto` 的 `sourceHandle?: string | null` 接受 → 存进 JSONB 是 `"sourceHandle": null`；
> - 用 cURL 省略该键 → TS 的 `JSON.parse(JSON.stringify())` / Python 的 `exclude_unset=True` 都**不写入这个键**。
>
> 两种形状都合法。但前端始终发 `null`，保证“从画布保存的图”形状稳定——**同一条代码路径只产出一种形状**，比对和排查都简单。

### 3.5 画布与面板 JSX

```tsx
  return (
    <main className="app-main--wide">
      <div className="page-head">
        <div>
          <h1 className="page-title">{appName ?? '画布编辑'}</h1>
          <div className="page-sub">
            {appMode !== null && <span className="badge badge-brand">{appMode}</span>}{' '}
            <span className="mono">{appId}</span> · 拖拽连线编辑工作流，保存草稿后发布
          </div>
          {error !== null && <div className="alert alert-error">操作失败：{error}</div>}
          {message !== null && <div className="alert alert-success">{message}</div>}
          {loading && <div className="faint">加载中…</div>}
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => void handleSave()} disabled={busy}>
            保存草稿
          </button>
          <button className="btn" onClick={() => void handlePublish()} disabled={busy}>
            {busy ? '发布中…' : '发布'}
          </button>
          <a className="btn btn-ghost" href="/apps">
            返回列表
          </a>
        </div>
      </div>

      <div className="workbench">
        <div ref={canvasRef} className="canvas-pane">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            // 选中变化时记录单个节点 id（多选只取第一个）
            onSelectionChange={(params) => setSelectedNodeId(params.nodes[0]?.id ?? null)}
            // 键盘删除节点/边
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <aside className="side-pane">
          <div className="panel">
            <div className="panel-head">添加节点</div>
            <div className="panel-body">
              <div className="palette">
                <button className="palette-btn" onClick={() => addNode('start')}>
                  开始
                </button>
                <button className="palette-btn" onClick={() => addNode('llm')}>
                  LLM
                </button>
                <button className="palette-btn" onClick={() => addNode('knowledge')}>
                  知识检索
                </button>
                <button className="palette-btn" onClick={() => addNode('condition')}>
                  条件分支
                </button>
                <button className="palette-btn" onClick={() => addNode('aggregator')}>
                  变量聚合
                </button>
                <button className="palette-btn" onClick={() => addNode('iteration')}>
                  迭代
                </button>
                <button className="palette-btn" onClick={() => addNode('end')}>
                  结束
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default function AppGraphPage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
```

阶段 3 的检查器只展示选中节点的 `id` / `type`；阶段 5 起才按节点类型渲染参数表单（`prompt`、`model`、`topK` 等）。

> **面试考点 · 节点标题是用户输入，直接渲染安全吗？**
> 安全。`{title}` 作为 React 文本节点插入，React 会转义 `<`、`&` 等字符，等价于 `textContent`。
> 只有 `dangerouslySetInnerHTML` 才会引入 XSS。**本项目全程不使用它**；如果后端返回的 `title` 里含 `<script>`，页面上只会显示这段字面文本。

---

## 4. 验证

```powershell
pnpm --filter @mini-dify/web dev
```

```text
1. 登录 → /apps → 打开一个应用的「打开画布」
2. 右侧点「开始」→ 画布中心出现 start 节点
3. 再点「结束」→ 出现 end 节点（位置错开，不重叠）
4. 从 start 底部 Handle 拖到 end 顶部 Handle → 出现一条边
5. 点「保存草稿」→ 顶部出现「草稿已保存」
   - Network：PUT /apps/{id}/graph → 200，响应体是完整 Graph
6. 刷新页面 → 节点位置、连线、标题原样恢复
7. 点「发布」→ 提示「已发布 · 2026-...Z」
   - Network：先 PUT（200），再 POST /graph/publish（200）
8. 再拖一个 LLM 节点，保存 → 刷新仍在
9. 选中节点按 Delete → 节点和相连的边一起消失 → 保存成功
10. 只留一个 start、不留 end → 保存 → 400：
    graph must contain at least one end node
11. 把浏览器切到 8000 后端（.env.local 改 NEXT_PUBLIC_API_BASE），刷新画布
    → 同一份图仍在（数据在 PostgreSQL，不在某个后端进程里）
```

### 4.1 检查 JSONB 里的坐标

```powershell
docker exec -it mini-dify-db psql -U postgres -d minidify -c "SELECT graph_json -> 'nodes' -> 0 -> 'position' FROM apps WHERE name = 'canvas-test';"
```

预期形如 `{"x": 0, "y": 0}`。如果这里出现了 `selected`、`dragging`、`measured`，说明 `buildGraph` 挑字段没挑干净。

---

## 5. 画布阶段验收清单

| 检查项 | 期望 |
| --- | --- |
| 打开画布 | 草稿为空时显示空画布，不报错 |
| 添加节点 | 7 种类型都能添加、位置错开 |
| 连线 | 拖 Handle 生成边；start 无入边、end 无出边 |
| 保存 | PUT 200；刷新后完整恢复 |
| 删除节点 | 相连边一并消失；保存不报悬空边 |
| 发布 | 先 PUT 再 publish；返回 `publishedAt` |
| 非法图 | 400，`message` 是 `"; "` 拼接的多条规则 |
| 跨后端 | 切换 `NEXT_PUBLIC_API_BASE` 后同一份图可继续编辑 |
| 构建 | `pnpm --filter @mini-dify/web build` 通过 |

---

## 6. 下一步

阶段 4「执行引擎 MVP」：

- `01-SSE事件协议.md`：`node_started` / `token` / `node_finished` / `run_finished` / `run_failed` 的帧格式与顺序；
- `02-LangGraph编译图.md`：把 `Graph` 编译成 LangGraph（TS），节点工厂、变量池、模板解析；
- `03-Python引擎.md`：同一协议的 Python 实现与跨语言数值对齐；
- `04-前端流式面板.md`：`parseSseStream`、逐段渲染、终态处理。
