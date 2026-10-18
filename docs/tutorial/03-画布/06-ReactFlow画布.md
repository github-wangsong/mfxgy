# 06 · ReactFlow 画布

> 所属：阶段 3 · 画布
> 本篇覆盖：在 `apps/web` 新增**画布编辑页** `/apps/[id]`——用 `@xyflow/react` 做可视化编排：左侧**节点面板**、中间**画布**、右侧**节点检查器**、顶部**「保存草稿 / 发布」**；并在应用列表页加一个「打开画布」入口。本篇只讲**前端**；`/apps/{id}/graph*` 接口与图校验的实现见本阶段前几篇（`01-图JSON契约与校验.md` / `02-Prisma-JSONB与两态.md` / `03-NestJS图模块.md` / `04-SQLAlchemy-JSONB映射.md` / `05-FastAPI图模块.md`）。
> **本篇首次教学：ReactFlow 核心模型（`nodes`/`edges` 即普通数组状态，画布只是它们的可视化）· `useNodesState`/`useEdgesState` 与 `onNodesChange`/`onEdgesChange`/`onConnect` + `addEdge` · 自定义节点类型 `nodeTypes` 注册与节点组件内用 `Handle` 声明连接点（`type="source"/"target"`、`Position`）· `ReactFlowProvider` 的作用与 `useReactFlow`（`screenToFlowPosition`）· 受控 vs 非受控（状态提升到 React state）· `crypto.randomUUID()` 生成唯一 id · 把节点 `data` 当作可编辑配置（检查器 → `setNodes` 局部更新）· App Router 动态路由 `[id]` + `useParams`**
> （React 组件 / JSX · `'use client'` · `useState` / `useEffect` · App Router 的 `layout.tsx` / `page.tsx` · `NEXT_PUBLIC_*` 见阶段 0 · 07 / 08；受控表单 / 带鉴权 `fetch` / 三态 / `useRouter` / `useCallback` 见阶段 2 · 06——本篇**只引用、不重讲**）

---

## 1. 本篇目标

做完这一篇，你能：

- 从应用列表页点「打开画布」进入 `/apps/{id}`，看到一块可拖拽、可连线的**画布**。
- 用**左侧节点面板**往画布上加三种节点：`开始` / `LLM` / `结束`。
- 用鼠标从节点的连接点**拖出连线**，画布上出现边。
- 点选一个节点，在**右侧检查器**改它的标题；LLM 节点还能改 `model` 与 `prompt`。
- 点顶部**「保存草稿」**把整张图 `PUT` 到后端；刷新页面后**图原样回来**（证明落库）。
- 点顶部**「发布」**，把当前草稿快照为已发布图，并看到 `publishedAt`。
- 讲清楚：`nodes` / `edges` 为什么就是普通数组状态、`onConnect` 为什么要自己 `addEdge`、`Handle` 怎么决定连线方向、为什么需要 `ReactFlowProvider`、为什么要把画布状态**提升**到 React state。

**验收标准（对齐总纲 §6 阶段 3）**

> 拖节点连线并保存 / 重载。

具体化到可执行层面：

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 从 `http://localhost:3000/apps` 点某项的「打开画布」 | 进入 `http://localhost:3000/apps/{id}`，显示「画布编辑」标题与三个按钮 |
| 2 | 画布初始（草稿为空） | 画布无节点；检查器显示「未选中节点。」 |
| 3 | 点左侧「开始 / LLM / 结束」各一次 | 画布出现 **3 个节点** |
| 4 | 从「开始」底部的连接点拖到「LLM」顶部的连接点，再从「LLM」拖到「结束」 | 画布出现 **2 条连线** |
| 5 | 点选 LLM 节点 | 检查器出现「标题 / 模型 / 提示词」三个字段；改「提示词」内容 |
| 6 | 点「保存草稿」 | 顶部显示绿色「草稿已保存」 |
| 7 | 刷新页面 | **3 节点 2 边仍在，且 LLM 的 prompt 内容未丢**（证明已落库） |
| 8 | 点「发布」 | 顶部显示绿色 `已发布 · <publishedAt>`（形如 `2026-10-18T...Z`） |
| 9 | 删掉「结束」节点后再点「保存草稿」 | 显示后端 **400 原文**：`graph must contain at least one end node` |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| Node / pnpm、`pnpm install` 已执行 | 阶段 0 · 01 / 03 |
| 契约包 `@mini-dify/contract` 已构建（含 `Graph` / `GraphNode` / `GraphEdge` 类型） | 阶段 0 · 04；阶段 3 · `01-图JSON契约与校验.md` |
| **`/apps/{id}/graph*` 接口已实现**（`GET`/`PUT`/`POST publish`/`GET published`，均需 Bearer JWT） | 阶段 3 · `03-NestJS图模块.md` / `05-FastAPI图模块.md` |
| `apps` 表已加 **JSONB 列** `graph_json` / `published_graph_json` / `published_at` | 阶段 3 · `02-Prisma-JSONB与两态.md`（迁移 `add_app_graph`） |
| `/login`、`/apps` 两页已就绪（登录拿 token、列出应用） | 阶段 2 · 06 |
| **至少一套后端在跑**（本篇用 `api-ts` 在 3001） | 阶段 0 · 05 |
| 已注册并登录过一个用户（如 `alice@example.com`），且**至少有一个应用** | 阶段 1 · 07；阶段 2 · 06 |

> 契约一致（阶段 0 · 08）⇒ 前端不感知具体后端，只依赖 `NEXT_PUBLIC_API_BASE` 指向哪套。把 `api-ts` 换成 `api-py`，本文的画布页代码**零改动**。

---

## 3. 命令清单（逐条说明）

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `pnpm --filter @mini-dify/web add @xyflow/react` | **仓库根** | 给前端加画布依赖 | 打印 `+ @xyflow/react 12.12.0`，`apps/web/package.json` 的 `dependencies` 出现 `"@xyflow/react": "^12.12.0"`，`pnpm-lock.yaml` 更新 |
| `pnpm dev:web` | **仓库根** | 启动 Next 开发服务器，监听 **3000** | 打印 `Ready in ...` 与 `Local: http://localhost:3000` |
| 浏览器打开 `http://localhost:3000/apps` → 点「打开画布」 | —— | 进入画布页 | 见第 6 节实测 |

> `pnpm dev:web` 是根脚本（`pnpm --filter @mini-dify/web dev`），与阶段 0 · 07 一致，**只引用不重讲**。
>
> 顺带确认后端在跑：另一个终端 `pnpm dev:api-ts`（→ 3001）。

---

## 4. 完整代码

本步要**新增一个页面**、**改两处**（列表页入口、`package.json` 依赖）。

`apps/web/app/` 目录结构（**动态段 `[id]` 即路由参数**，见第 5.8 节）：

```
apps/web/app/
├── layout.tsx            # 根布局（阶段 0 已有，未改）
├── page.tsx              # "/"             —— 未改
├── login/
│   └── page.tsx          # "/login"        —— 阶段 2 已有，未改
└── apps/
    ├── page.tsx          # "/apps"         —— 加一行「打开画布」入口
    └── [id]/
        └── page.tsx      # "/apps/:id"     —— 新增（画布编辑页）
```

### 4.1 `apps/web/app/apps/[id]/page.tsx`（新增）

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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

/** 每种节点的初始 data（保持最小：title，llm 另加 model / prompt）。 */
function initialData(type: NodeType): Record<string, unknown> {
  if (type === 'llm') return { title: 'LLM', model: 'gpt-4o', prompt: '' }
  return { title: type === 'start' ? '开始' : '结束' }
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

  const canvasRef = useRef<HTMLDivElement>(null)

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

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

      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 280px', gap: 12, height: '72vh' }}>
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
          <div style={{ fontWeight: 600, marginBottom: 8 }}>节点检查器</div>
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
              {selectedNode.type === 'llm' && (
                <>
                  <label>
                    模型
                    <input
                      value={String(selectedNode.data.model ?? '')}
                      onChange={(e) => updateNodeData(selectedNode.id, { model: e.target.value })}
                      style={{ display: 'block', width: '100%' }}
                    />
                  </label>
                  <label>
                    提示词
                    <textarea
                      value={String(selectedNode.data.prompt ?? '')}
                      onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                      rows={6}
                      style={{ display: 'block', width: '100%' }}
                    />
                  </label>
                </>
              )}
              <button onClick={() => deleteNode(selectedNode.id)}>删除节点</button>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

/** 应用画布页：读取草稿 → 编辑 → 保存 / 发布；未登录引导去 /login。 */
export default function AppGraphPage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
```

**逐项解释**

- `'use client'` + Hook：本页用了 `useState` / `useEffect` / `useParams` / `useRouter` / `useReactFlow` 等，必须是客户端组件（见阶段 0 · 07）。
- 顶部 `import ... from '@xyflow/react'`：画布库的全部导出——组件（`ReactFlow` / `ReactFlowProvider` / `Handle` / `Background` / `Controls`）、Hooks（`useNodesState` / `useEdgesState` / `useReactFlow`）、工具函数（`addEdge`）、常量（`Position`），以及**类型**（`type Connection` / `type Edge` / `type Node` / `type NodeProps`）。见第 5.1–5.7 节。
- `import '@xyflow/react/dist/style.css'`：画布库自带样式（连接点、连线、控制条的定位都靠它）。**本项目未配置 Tailwind**，画布页与既有页面一样**只用内联 `style`**，唯独这条第三方 CSS 必须显式引入（见第 7 节坑 6）。
- 本地类型 `GraphNode` / `GraphEdge` / `Graph`：与契约（`packages/contract/openapi.yaml` 的 `GraphNode` / `GraphEdge` / `Graph`，TS 版在 `packages/contract/src/index.ts`）**逐字段一致**。契约包其实也导出了这三个类型，本页为「前端自包含、一眼看清形状」而在文件内重写了一份。
- `NodeShell`：三种节点共用的「外壳」——一个带标题与类型字样的小方块，按需渲染 `Handle`。`StartNode` / `EndNode` / `LlmNode` 只是传不同的 `hasTarget` / `hasSource`（见第 5.3 节）。
- `nodeTypes`：把节点 `type` 字符串映射到组件（见第 5.3 节）。
- `Canvas` 拿到三样「环境信息」：`useRouter()`（跳转）、`useParams<{ id: string }>().id`（URL 里的应用 id）、`useReactFlow()` 的 `screenToFlowPosition`（屏幕坐标 → 画布坐标）。见第 5.4 / 5.8 节。
- `useNodesState<Node>([])` / `useEdgesState<Edge>([])`：**画布状态**（见第 5.2 节）。
- `selectedNode` 用 `useMemo` 从 `nodes` 里找当前选中项，供检查器渲染（见第 5.8 节）。
- `useEffect`：进页面先取 token（无则跳 `/login`）→ `GET /apps/${appId}/graph` → 把返回的 `graph.nodes` / `graph.edges` 灌进 `setNodes` / `setEdges` 作为**初始图**（见第 5.1 节）。
- `onConnect`：用户拖出一条连线时触发；**必须自己**把 `connection` 变成 edge 再 `setEdges`（见第 5.2 节）。
- `addNode`：新节点放在画布視口中心，按 3 列网格错开（`col * 260`），id 用 `crypto.randomUUID()`（见第 5.6 节）。
- `updateNodeData` / `deleteNode`：检查器改配置与删节点，都是对 `nodes` / `edges` 数组做**不可变更新**（见第 5.7 节）。
- `buildGraph`：把 React state 里的 `nodes` / `edges` 序列化成契约 `Graph`——`version` 固定 `'1'`，句柄缺省补 `null`（见第 5.5 节）。
- `putDraft` / `handleSave` / `handlePublish`：带鉴权 `fetch`（阶段 2 · 06 已讲）。「发布」是**先存草稿、再发布**（后端只对**当前草稿**做校验，见本阶段验收篇）。
- `AppGraphPage`（默认导出）：用 `<ReactFlowProvider>` 包住 `<Canvas>`（见第 5.4 节）。

### 4.2 `apps/web/app/apps/page.tsx`（改：加「打开画布」入口）

**完整文件路径：`apps/web/app/apps/page.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'

type AppMode = 'chatflow' | 'workflow'

type AppResponse = {
  id: string
  name: string
  description: string | null
  mode: AppMode
  ownerId: string
  createdAt: string
  updatedAt: string
}

type AppListResponse = { items: AppResponse[] }

/** 应用列表页：读 token → GET /apps；支持新建与删除；未登录引导去 /login。 */
export default function AppsPage() {
  const router = useRouter()
  const [apps, setApps] = useState<AppResponse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<AppMode>('chatflow')

  const loadApps = useCallback(async (): Promise<void> => {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    const res = await fetch(`${API_BASE}/apps`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) {
      router.replace('/login')
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as AppListResponse
    setApps(data.items)
  }, [router])

  useEffect(() => {
    let cancelled = false
    loadApps()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadApps])

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setError(null)
    const res = await fetch(`${API_BASE}/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description: description === '' ? undefined : description, mode }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      setError(body?.message ?? `HTTP ${res.status}`)
      return
    }
    setName('')
    setDescription('')
    setMode('chatflow')
    await loadApps().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  async function handleDelete(id: string): Promise<void> {
    const token = localStorage.getItem('accessToken')
    if (token === null) {
      router.replace('/login')
      return
    }
    setError(null)
    const res = await fetch(`${API_BASE}/apps/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      setError(body?.message ?? `HTTP ${res.status}`)
      return
    }
    await loadApps().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <main>
      <h1>应用列表</h1>
      <p>
        后端：<code>{API_BASE}</code>
      </p>
      <form onSubmit={handleCreate} style={{ display: 'grid', gap: 8, maxWidth: 320, marginBottom: 24 }}>
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={64}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          描述（可选）
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={256}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          模式
          <select value={mode} onChange={(e) => setMode(e.target.value as AppMode)} style={{ display: 'block' }}>
            <option value="chatflow">chatflow</option>
            <option value="workflow">workflow</option>
          </select>
        </label>
        <button type="submit">新建应用</button>
      </form>

      {error !== null && <p style={{ color: 'crimson' }}>操作失败：{error}</p>}
      {loading && <p>加载中…</p>}
      {!loading && apps.length === 0 && <p>暂无应用。</p>}
      <ul>
        {apps.map((app) => (
          <li key={app.id} style={{ marginBottom: 8 }}>
            <strong>{app.name}</strong> <code>{app.mode}</code>
            {app.description !== null && <span> — {app.description}</span>}{' '}
            <a href={`/apps/${app.id}`}>打开画布</a>{' '}
            <button onClick={() => void handleDelete(app.id)}>删除</button>
          </li>
        ))}
      </ul>
      <p>
        <a href="/">返回首页</a>
      </p>
    </main>
  )
}
```

**唯一改动**：列表每一项里，在「删除」按钮前加了一个通往画布页的链接：

```tsx
<a href={`/apps/${app.id}`}>打开画布</a>{' '}
```

其余部分与阶段 2 · 06 完全一致（受控表单 / 带鉴权 `fetch` / 三态 / `map` + `key` **见阶段 2 · 06，不重讲**）。这就是从 `/apps` 进入 `/apps/{id}` 画布页的入口。

### 4.3 `apps/web/package.json`（改：加依赖）

**完整文件路径：`apps/web/package.json`**

```json
{
  "name": "@mini-dify/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "@xyflow/react": "^12.12.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

**唯一改动**：`dependencies` 多了 `"@xyflow/react": "^12.12.0"`（由第 3 节那条 `pnpm add` 写入）。画布库 `@xyflow/react` 即 **ReactFlow v12**，已支持 React 19（总纲 §10 风险表已注明优先选它）。

---

## 5. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 3 · 06」并直接使用。

### 5.1 ReactFlow 的核心模型：`nodes` / `edges` 就是普通数组状态

**是什么**：ReactFlow（`@xyflow/react`）是一个**把两个数组画成可交互画布**的库。它的核心输入就两个 prop：

```tsx
<ReactFlow nodes={nodes} edges={edges} ... />
```

- `nodes: Node[]`——节点数组。每个节点形如：

  ```ts
  { id: 'n1', type: 'llm', position: { x: 120, y: 80 }, data: { title: 'LLM', ... } }
  ```

- `edges: Edge[]`——连线数组。每条边形如：

  ```ts
  { id: 'e1', source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null }
  ```

**它就是「图 = 数据」**：ReactFlow 自己**不持有**图，它只是把你给的这两个数组**画出来**，并把用户的鼠标操作（拖动、框选、连线）**翻译成对这两个数组的修改意图**回传给你。**图 = 数据** 正是阶段 3 的立论——**画布只是 `nodes` / `edges` 这两个普通数组状态的可视化**。

**和契约 `Graph` 的关系**：把两个数组包一层 `version` 就是后端契约 `Graph`：

```ts
type Graph = { version: string; nodes: GraphNode[]; edges: GraphEdge[] }
```

前端能编辑的、后端要存的、以后执行引擎要编译的，**是同一份数据**。所以「保存草稿」= 把当前 `nodes` / `edges` 序列化成 `Graph` 发给后端；「读取草稿」= 把后端返回的 `Graph` 灌回 `setNodes` / `setEdges`。本页 `useEffect` 里就是这么做的：

```tsx
setNodes(graph.nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node.data })))
setEdges(graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target,
  sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined })))
```

> 注意这里把契约的 `sourceHandle: null` **转成 `undefined`**：ReactFlow 内部用 `undefined` 表示「没有句柄」，`null` 会当作「有一个为 null 的句柄」处理，容易触发警告——所以读入时做一次归一化。

### 5.2 `useNodesState` / `useEdgesState` 与 `onNodesChange` / `onEdgesChange` / `onConnect` + `addEdge`

**是什么**：ReactFlow 是**受控组件**——它**不会**自己改你的数组。用户拖动一个节点时，它只发一个**变更事件**（`NodeChange[]`），你要**自己**把变更应用到数组上。`useNodesState` / `useEdgesState` 是官方给的**便捷 Hook**，一次性给你「状态 + 变更处理器」三件套：

```tsx
const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
```

| 返回值 | 作用 |
| --- | --- |
| `nodes` / `edges` | 当前数组（真值来源） |
| `setNodes` / `setEdges` | 局部更新（增删改都用它） |
| `onNodesChange` / `onEdgesChange` | **把 ReactFlow 发出的变更事件应用到数组**的处理器，直接挂到 `<ReactFlow>` 上 |

**三个回传 prop 的分工**

| prop | 何时触发 | 你该做什么 |
| --- | --- | --- |
| `onNodesChange` | 拖动 / 框选 / 键盘删除节点等 | 用 `useNodesState` 给的处理器**直接透传**即可（拖拽位置、选中态就靠它更新） |
| `onEdgesChange` | 选中 / 删除边等 | 同上 |
| `onConnect` | 用户**从 source 连接点拖到 target 连接点**、松手成功时 | 拿到一条 `Connection`（`source`/`target`/两个 handle），**自己**把它变成 `Edge` 并 `setEdges` |

**为什么 `onConnect` 要自己动手**：ReactFlow 只负责「告诉你有条连线被拖出来了」，**不替你把它加进数组**。本页：

```tsx
const onConnect = useCallback(
  (connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds))
  },
  [setEdges],
)
```

- `addEdge(params, edges)`：工具函数，把新边**追加**到 `edges` 末尾返回**新数组**（不改原数组）。若不给 `id`，它内部会生成一个；本页显式传 `id: crypto.randomUUID()`，与「节点/边 id 必须唯一」的契约校验（本阶段验收篇）保持一致。
- `connection` 里的字段名与 `Edge` 对得上（`source` / `target` / `sourceHandle` / `targetHandle`），所以 `{ ...connection, id }` 展开即得一条完整边。
- 用 `useCallback` 包裹：稳定身份，避免每次渲染都给 `<ReactFlow>` 换个新函数（本质同阶段 2 · 06 的 `useCallback`，只引用）。

### 5.3 自定义节点类型：`nodeTypes` 注册 + 节点组件内用 `Handle` 声明连接点

**是什么**：节点长什么样，由你写的**自定义节点组件**决定。把「节点 `type` 字符串 → 组件」的映射交给 `nodeTypes`：

```tsx
const nodeTypes = { start: StartNode, end: EndNode, llm: LlmNode }
// ...
<ReactFlow nodeTypes={nodeTypes} ... />
```

于是 `type: 'llm'` 的节点就用 `LlmNode` 渲染。**注意 `nodeTypes` 必须定义在模块作用域（稳定引用）**，否则每次渲染都是新对象，ReactFlow 会警告 `It looks like you've created a new nodeTypes...` 并可能丢失节点内部状态。

**节点组件收到什么**：`NodeProps`。本页只用其中的 `data`：

```tsx
function LlmNode({ data }: NodeProps) {
  return <NodeShell title={String(data.title ?? 'LLM')} type="llm" hasTarget hasSource />
}
```

`data` 就是该节点的 `data` 字段（节点的**配置**）。这里把 `title` 显示出来；`String(... ?? 'LLM')` 是兜底，防止 `data.title` 缺失时把 `undefined` 渲染出来。

**`Handle`：连接点**。一个节点能不能被连、从哪连，全部写在 `Handle` 上：

```tsx
{hasTarget && <Handle type="target" position={Position.Top} />}
{hasSource && <Handle type="source" position={Position.Bottom} />}
```

| 写法 | 含义 |
| --- | --- |
| `type="target"` | **入边**的连接点（别人的线连到我） |
| `type="source"` | **出边**的连接点（我的线连到别人） |
| `position={Position.Top / Bottom / Left / Right}` | 连接点贴在节点的哪一边（`Position` 是库导出的枚举常量） |

```tsx
function StartNode({ data }: NodeProps) {
  return <NodeShell title={String(data.title ?? '开始')} type="start" hasTarget={false} hasSource />
}
function EndNode({ data }: NodeProps) {
  return <NodeShell title={String(data.title ?? '结束')} type="end" hasTarget hasSource={false} />
}
```

- **开始节点**：只有 `source`（流程从这里流出，不需要入口）。
- **结束节点**：只有 `target`（流程汇到这里终止）。
- **LLM 节点**：`target` + `source` 都有（既接收上游、又输出到下游）。

**连接规则**：ReactFlow 只允许**从 `source` 拖到 `target`**。所以 `开始 → LLM → 结束` 恰好顺着「下 → 上」接起来；如果目标节点没有 `target` 连接点（比如从 LLM 拖向「开始」的顶部），松手不会生成边——这是**方向约束**在起作用，不是 bug。

### 5.4 `ReactFlowProvider` 的作用与 `useReactFlow`

**是什么**：`useReactFlow()`（及其`screenToFlowPosition` / `fitView` 等）不是从 props 拿数据，而是从 **React Context** 里读「画布实例」。要能读到，调用它的组件**必须位于 `<ReactFlowProvider>` 之内**：

```tsx
export default function AppGraphPage() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
```

**为什么本页必须包它**：`Canvas` 在 `addNode` 里用了 `screenToFlowPosition` 把「屏幕像素坐标」换算成「画布逻辑坐标」：

```tsx
const { screenToFlowPosition } = useReactFlow()
// ...
const base = screenToFlowPosition({ x: screenX, y: screenY })
```

节点 `position` 存的是**画布坐标系**里的值，而鼠标点击是**屏幕坐标系**里的值；两者因缩放/平移而不同。不换算直接把屏幕坐标写进 `position`，新节点就会「偏到画布外面」。

**为什么不放在 `<ReactFlow>` 内部**：`Canvas` **渲染** `<ReactFlow>`，也就是说 `Canvas` 在 `<ReactFlow>` 的**外部**；它调用 `useReactFlow()` 时读不到「还没渲染出来的画布」的 context。于是需要一个**更外层的** `<ReactFlowProvider>` 来提供实例，`Canvas` 及其子树才都能读到。漏了它，控制台会报 `useReactFlow must be used within a ReactFlowProvider`。

> 顺带：`<Background />` 画网格背景、`<Controls />` 是左下角的缩放/适应按钮，都是 ReactFlow 提供的内置子组件，直接放进 `<ReactFlow>` 里即可。

### 5.5 受控 vs 非受控：把画布状态提升到 React state

**两种用法**

| 用法 | 写法 | 特点 |
| --- | --- | --- |
| **非受控** | `defaultNodes={...}`（只给初值） | 写起来短，但 React 拿不到**当前**图，想在别处读整张图很别扭 |
| **受控**（本页） | `nodes={nodes}` + `onNodesChange={onNodesChange}` | 图**真值在 React state** 里，任何时刻都能读到、也能从外部改 |

**本页为什么必须受控**：「保存草稿」时要把**整张图**序列化发出去：

```tsx
const buildGraph = useCallback(
  (): Graph => ({
    version: '1',
    nodes: nodes.map((node) => ({ id: node.id, type: node.type as NodeType,
      position: { x: node.position.x, y: node.position.y }, data: node.data })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null })),
  }),
  [nodes, edges],
)
```

`buildGraph` 直接读 state 里的 `nodes` / `edges`——**只有把画布状态提升为 React state，`handleSave` / `handlePublish` 才能拿到整张图**。同理，右侧检查器的 `updateNodeData` 改的也是这份 state，改完画布立刻重渲染。

**「保存」`buildGraph` 与「读入」的对称性**：读入时把契约 `null` → `undefined`（第 5.1 节），保存时再 `undefined` → `null`（`?? null`）。这样**存进去的形状 = 后端读出来的形状**，JSONB 往返不漂移（本阶段验收篇会验证这一点）。`version: '1'` 也必须写死——它是业务校验规则 1 的要求。

### 5.6 `id` 生成用 `crypto.randomUUID()`

**是什么**：`crypto.randomUUID()` 是浏览器内置的随机 UUID 生成器（Node 18+ 也有）。本页加节点、连线都这样生成 id：

```tsx
{ id: crypto.randomUUID(), type, position, data: initialData(type) }
// addEdge 里： { ...connection, id: crypto.randomUUID() }
```

**为什么必须唯一**：契约与后端校验都要求「节点 id 唯一、边 id 唯一」（本阶段验收篇的规则 2 / 5）。同一张图里两个节点 id 撞车，保存会 400。

**为什么不用数组下标 / 递增计数**：下标会随增删重排而变，计数一旦读入**已有图**就可能与既有 id 撞车。UUID 天然唯一、与既有数据无关，**增删改都不会重复**。element 的 `key` 同理需要稳定唯一标识（阶段 2 · 06）。

### 5.7 把节点 `data` 当作可编辑配置（检查器 → `setNodes` 局部更新）

**是什么**：契约里 `GraphNode.data` 是**自由结构**（`additionalProperties: true`）——存什么由各节点类型自己约定。本页：`start` / `end` 只存 `{ title }`，`llm` 存 `{ title, model, prompt }`（见 `initialData`）。

`data` 就是节点的**可配置项**。右侧「节点检查器」把选中节点的 `data` 渲染成表单，改动时**局部更新**对应节点：

```tsx
function updateNodeData(id: string, patch: Record<string, unknown>): void {
  setNodes((nds) => nds.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)))
}
```

**关键：不可变更新（immutability）**。要**新建节点对象**、并**新建 data 对象**（两处 `...` 展开）：

- `{ ...node, data: { ...node.data, ...patch } }`：节点对象是新的，`data` 也是新的，其它字段（`position` 等）原样保留。
- 若图省事直接 `node.data.title = value`（改原对象），ReactFlow 会因为**节点对象引用没变**而认为「图没变」，画布上标题**不会刷新**，保存时还可能错过这次更改。React 的「状态要换新引用」在本库同样成立。
- `patch` 只带被改的字段，其余字段靠 `{ ...node.data }` 保留——所以改「提示词」不会把「标题 / 模型」抹掉。

**选中态从哪来**：`<ReactFlow>` 的 `onSelectionChange` 回传当前选中的节点，本页取第一个的 id 存进 `selectedNodeId`；检查器再用 `useMemo` 从 `nodes` 里查出完整节点来渲染（见第 5.8 节）：

```tsx
<ReactFlow ... onSelectionChange={(params) => setSelectedNodeId(params.nodes[0]?.id ?? null)} />
```

**删除节点**还要**连带删掉与它相连的边**（否则会留下「指向不存在节点」的悬空边，违反校验规则 6）：

```tsx
setNodes((nds) => nds.filter((node) => node.id !== id))
setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id))
```

### 5.8 若干配套首次点（简讲）

- **App Router 动态路由 `[id]` 与 `useParams`**：目录名 `[id]` 表示**动态段**——`app/apps/[id]/page.tsx` 会同时匹配 `/apps/abc`、`/apps/def`……段的值即是 `id`。在客户端组件里用 **`useParams`** 取出：`const appId = useParams<{ id: string }>().id`。泛型参数写清「这个 id 是字符串」（阶段 0 · 04 的泛型；路由机制见阶段 0 · 07）。本页拿它去拼 `GET /apps/${appId}/graph`。
- **`useRef` 拿真实 DOM**：`const canvasRef = useRef<HTMLDivElement>(null)`，再挂到 `<div ref={canvasRef}>` 上。用途是从**屏幕坐标**算节点落点（`canvasRef.current?.getBoundingClientRect()` → 画布容器在屏幕上的位置与大小）。
- **`useMemo` 缓存派生值**：`selectedNode` 由 `nodes` + `selectedNodeId` 算出。`useMemo(fn, deps)` 在 `deps` 不变时**返回上一次的结果**，避免每次渲染都重算/新建（本质同阶段 2 · 06 的 `useCallback`，一个是缓存值、一个是缓存函数）。
- **`CSSProperties` 类型**：把内联样式对象抽成常量时，用 `import type { CSSProperties } from 'react'` 标注，风格更明确（类型只在编译期存在，阶段 0 · 04）。
- **引入第三方 CSS**：`import '@xyflow/react/dist/style.css'`——Next 支持在组件文件里 `import` CSS。

> **项目现状（照实说明）**：本项目**未配置 Tailwind**（没有 `tailwind.config.*` / `postcss.config.*`，`apps/web` 下也没有 `globals.css`）。**既有页面与本画布页一律使用内联 `style`**；画布页唯二引入的样式是 `@xyflow/react/dist/style.css`（第三方库自带）与本文件里的内联对象 `boxStyle` 等。总纲 §1.3 把 Tailwind 列为目标栈，但截至阶段 3 **尚未接入**——本文如实记录这一现状。

---

## 6. 验收自测

先确保 `pnpm dev:web`（3000）与 `pnpm dev:api-ts`（3001）都在跑，且已登录 `alice@example.com`、`/apps` 至少有一个应用。

| 检查项 | 操作 | 预期（**实测**） |
| --- | --- | --- |
| 入口 | `/apps` 每项右侧有「打开画布」链接；点击 | 进入 `http://localhost:3000/apps/{id}` |
| 空画布 | 首次进入（草稿为空） | 画布无节点；左侧「节点面板」三个按钮；右侧「未选中节点。点击画布中的节点进行编辑。」 |
| 加载态 | 刚进页面 | 先显示 `加载中…`，随后消失 |
| 加节点 | 依次点「开始」「LLM」「结束」 | 画布出现 3 个节点（各自带标题与类型字样） |
| 连线 | 从「开始」底部连接点拖到「LLM」顶部连接点；再从「LLM」到「结束」 | 生成 2 条连线 |
| 编辑配置 | 点选 LLM 节点 → 改「提示词」 | 检查器出现「标题 / 模型 / 提示词」；输入生效 |
| 保存 | 点「保存草稿」 | 绿色 `草稿已保存` |
| **刷新持久化** | F5 刷新 | **3 节点 2 边仍在，且 prompt 内容未丢** |
| 发布 | 点「发布」 | 绿色 `已发布 · 2026-10-18T...Z` |
| 业务校验 | 选中「结束」→「删除节点」→「保存草稿」 | 红色 `操作失败：graph must contain at least one end node` |

**实测回放（照实记录）**

```
/apps 点「打开画布」 → http://localhost:3000/apps/{id}
  页面加载：GET /apps/{id}/graph 作为初始 nodes/edges（空草稿返回 {"version":"1","nodes":[],"edges":[]}）
  加 3 节点（开始 / LLM / 结束） → 连 2 条边 → 选中 LLM 改 prompt
  点「保存草稿」 → 绿色「草稿已保存」
  F5 刷新 → 3 节点 2 边与 prompt 内容仍在（证明已落库）
  点「发布」 → 绿色「已发布 · 2026-10-18T...Z」
  删掉「结束」节点 → 点「保存草稿」 → 红色「操作失败：graph must contain at least one end node」（后端 400 原文）
```

---

## 7. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **`onConnect` 里忘了 `addEdge`** | 从连接点拖出线、松手后**什么都没出现** | ReactFlow 只回传 `Connection`，**不替你加边**。必须在 `onConnect` 里 `setEdges((eds) => addEdge(connection, eds))`（第 5.2 节） |
| 2 | **节点间距取 200px 网格，连线拖拽落空** | 节点实际约 **215px 宽**，按 200px 列距摆放会**互相压住**、且靠边的节点被视口裁掉；从「开始」往「LLM」拖第二条线时**落空**（找不到目标连接点） | 两个原因叠加：① 节点真实宽度 > 间距 → 目标节点的连接点被遮挡；② 视口未自适应 → 目标节点在可视区外。**解决**：列距改 **260px**（见 `addNode` 的 `col * 260`），并给 `<ReactFlow>` 加 **`fitView`** 让整张图先进入视口，再连线即恢复正常。实测如此 |
| 3 | **`nodeTypes` 写成了内联对象** | 控制台告警 `It looks like you've created a new nodeTypes...`，甚至节点内部状态丢失 | `nodeTypes` 每次渲染都是新对象 → ReactFlow 认为节点类型变了。把它**提到模块作用域**（第 5.3 节） |
| 4 | **改 `data` 时改原对象** | 检查器里输入了，画布上标题**不刷新** | 必须**不可变更新**：新建节点对象 + 新建 `data` 对象（第 5.7 节） |
| 5 | **漏了 `ReactFlowProvider`** | 控制台报 `useReactFlow must be used within a ReactFlowProvider` | `Canvas` 在 `<ReactFlow>` **外层**，`useReactFlow()` 读不到实例。用 `<ReactFlowProvider>` 从更外层包裹（第 5.4 节） |
| 6 | **没 import 画布样式** | 节点/连线/连接点错位、看不出来 | 必须 `import '@xyflow/react/dist/style.css'`（库自带；本项目无 Tailwind，见第 5.8 节末尾） |
| 7 | **读入时没把 `null` 转 `undefined`** | 控制台出现句柄相关告警 | ReactFlow 用 `undefined` 表示「无句柄」；读入时 `sourceHandle: edge.sourceHandle ?? undefined`（第 5.1 节） |
| 8 | **同一图里 id 撞车** | 保存报 `node id must be unique: ...` / `edge id must be unique: ...` | 新节点/新边一律 `crypto.randomUUID()`（第 5.6 节） |
| 9 | **删节点没删边** | 保存报 `edge ... references unknown node: ...` | `deleteNode` 里同时过滤掉 `source`/`target` 指向它的边（第 5.7 节） |
| 10 | **未登录直接进画布页** | 显示「操作失败：HTTP 401」而不是去登录 | 进页面先查 `localStorage.getItem('accessToken')`，为 `null` 或 `401` 就 `router.replace('/login')`（阶段 2 · 06） |
| 11 | **发布提示 400** | 「操作失败：…」 | 后端**只校验当前草稿**；先把合法草稿存好再发布（本页「发布」会**先 `putDraft` 再 publish**），见本阶段验收篇 |

---

## 8. 本篇复盘与知识点

**一句话总结本篇**：前端用 `@xyflow/react` 把「**图 = 数据**」落地——`nodes` / `edges` 就是两个普通 React state 数组，画布是它们的可视化；用户操作被翻译成对数组的增删改，`保存草稿` 就是把数组序列化成契约 `Graph` 发给后端，刷新后再读回来。全程只新增一个依赖。

**本篇学到的工程要点**

1. **ReactFlow 的核心模型**：`nodes` / `edges` 是普通数组状态；画布只是它们的可视化（呼应阶段 3 的「图 = 数据」）。
2. **受控**：`useNodesState` / `useEdgesState` 给「状态 + 变更处理器」三件套；拖动/选中交给 `onNodesChange` / `onEdgesChange`，**连线必须自己在 `onConnect` 里 `addEdge`**。
3. **自定义节点**：`nodeTypes` 注册（放模块作用域）+ 节点组件用 `Handle` 声明连接点；`type="source"/"target"` + `Position` 决定连线方向。
4. **`ReactFlowProvider`** 提供画布实例给 `useReactFlow()`；`screenToFlowPosition` 把屏幕坐标换算成画布坐标。
5. **状态提升**：把画布状态放进 React state，「保存」时才能拿到整张图。
6. **id 用 `crypto.randomUUID()`**；**`data` 是不可变更新的可编辑配置**（`setNodes` 局部改、连带删边）。

**遗留/后续**

- 撤销/重做（总纲 §1.3 的 Zustand + zundo）、节点自动布局、连线合法性（如禁止多入边）留待后续。
- 执行/调试（把这张图跑起来）是**阶段 4** 的事——本阶段后端只**存取 + 校验**。

---

## 9. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| ReactFlow 核心模型（`nodes` / `edges` 即普通数组状态；「图 = 数据」的可视化） | **首次教学于本篇** |
| `useNodesState` / `useEdgesState` 与 `onNodesChange` / `onEdgesChange` / `onConnect` + `addEdge` | **首次教学于本篇** |
| 自定义节点类型 `nodeTypes` 注册 + 节点组件内 `Handle`（`type="source"/"target"`、`Position`） | **首次教学于本篇** |
| `ReactFlowProvider` 的作用与 `useReactFlow`（`screenToFlowPosition`） | **首次教学于本篇** |
| 受控 vs 非受控画布（画布状态提升到 React state） | **首次教学于本篇** |
| `crypto.randomUUID()` 生成唯一 id（节点/边） | **首次教学于本篇** |
| 把节点 `data` 当可编辑配置（检查器 → `setNodes` 不可变局部更新 + 连带删边） | **首次教学于本篇** |
| App Router 动态路由 `[id]` + `useParams`；`useRef` 取 DOM 尺寸；`useMemo` 缓存派生值；第三方 CSS 引入 | **首次教学于本篇** |
