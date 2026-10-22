# 04 · 前端多出口 Handle 与分支面板

> 所属：阶段 8 · 条件 / 变量 / 迭代
> 本篇覆盖：画布页 `apps/web/app/apps/[id]/page.tsx` 的阶段 8 增量——`ConditionNode` 的**多个 source Handle**、condition / aggregator / iteration 三个检查器、删分支时同步删边、「缺出边」预检前置，以及运行面板对 `branch_taken` / `iteration_item` / `retrieval` 三类过程事件的展示。
> **本篇首次教学（前端落地视角）**：ReactFlow 一个节点可以有**多个 `source` Handle**，每个 Handle 有唯一 `id`；连线时 ReactFlow 把 `connection.sourceHandle` 写进边——这就是「多出口分支」在前端的落地方式 · 按 `conditions` **动态渲染** Handle（每个 case 一个 + `else`）与行内 `position:relative` 的垂直布局 · **Handle 的 id 必须与后端语义一致**（`caseId` / `else`），即「前端 Handle id 就是后端的 `edge.sourceHandle`」这条**契约接缝** · 删除分支要同步删边 · 改 label 不改 id · 预检前置到 UI · 运行面板区分 `branch_taken` / `iteration_item` / `retrieval` 三类过程事件。
> ReactFlow 核心模型（nodes/edges 即数组状态、`useNodesState`、`onConnect` + `addEdge`、自定义节点与单个 `Handle`、`ReactFlowProvider`）见 `03-画布/06-ReactFlow画布.md`；SSE 客户端 `parseSseStream`、`fetch` + `getReader`、逐事件 `yieldToPaint` 见 `04-执行引擎/06-前端SSE客户端与运行面板.md`；`retrieval` 引用展示见 `07-知识库RAG/04-Python对齐与前端知识库页.md`——以上**直接使用、不重讲**。
> 条件 / 聚合 / 迭代的契约与图校验见本阶段 `01-分支节点的契约与图校验.md`；条件边与变量聚合的引擎实现见 `02-NestJS条件边与变量聚合.md`；迭代节点与跨语言数值对齐见 `03-迭代节点与跨语言数值对齐.md`；端到端验收见 `05-验收.md`。

---

## 1. 本篇目标

做完这一篇，你能：

- 说清 **一个节点为什么能有多个出口**：ReactFlow 用「Handle 的 `id` + 边的 `sourceHandle`」表达「这条线从哪个出口拉出来的」；没有 `id` 的普通边 `sourceHandle` 为 `null`。
- 在自定义节点里**按数据动态渲染 Handle**：`conditions` 每一项一个 `id={caseId}` 的 Handle，末尾固定追加 `id="else"`；新增/删除分支时 Handle 自动增减。
- 说清 **前后端契约的接缝**：前端 Handle 的 `id` → 边的 `sourceHandle` → 后端 `condition` 节点据此分派下游 → `branch_taken.caseId`。四处必须同值。
- 说清**为什么删分支必须同时删边**：残留边的 `sourceHandle` 指向不存在的 case，保存/运行会被后端预检拒绝（`edge {edgeId} ... has invalid sourceHandle`）。
- 说清**为什么 label 可改、id 不可改**：label 只用于展示，id 是连线标识；改 id 等于「把边的源头抽走」，旧边立刻失效。
- 在检查器里用红色预警看到「缺少出边」的分支，并在**保存之前**补齐。
- 在运行面板里区分三类过程事件：`branch_taken`（走了哪条路）、`iteration_item`（迭代进度）、`retrieval`（引用），并理解它们都**不进入** `run_finished.outputs`。
- 独立完成一次浏览器实测：条件图保存后两条出边 `sourceHandle` 分别是 `case1` / `else`；`topic=服务很好` 时面板显示「分支：分支 1（case1）」，事件日志里只有 `llm1`；新增分支后出现 `case2` 与新 Handle，节点卡片显示「2 个分支」。

**验收标准（对齐总纲 §6 阶段 8 的前端部分）**

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 节点面板 | 出现「条件分支 / 变量聚合 / 迭代」三个按钮 |
| 2 | 多出口渲染 | condition 节点右侧每个 case 一个 Handle，末尾一个 `else` Handle |
| 3 | 连线落库 | 保存后 `GET /apps/{id}/graph` 的分支边带 `sourceHandle: "case1"` / `"else"`；普通边为 `null` |
| 4 | 新增分支 | 自动生成 `case2`（不覆盖已有 id），画布立即多一个 Handle，卡片显示「2 个分支」 |
| 5 | 删除分支 | 该分支的出边一并消失；不会留下非法边 |
| 6 | 检查器 | 12 个 operator 中文标签齐全；`is_empty` / `is_not_empty` 隐藏「比较值」；切回 `equals` 恢复 |
| 7 | 预检前置 | 有分支（含「否则」）没连线时，检查器红字列出缺失分支 |
| 8 | 运行面板 | `branch_taken` 显示「分支：`<label>`（`<caseId>`）」；`iteration_item` 显示「迭代 i/N」；`retrieval` 仍正常 |
| 9 | 类型检查 | `npx tsc --noEmit` 通过（在 `apps/web`） |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| 契约 `0.8.0`：`ConditionNodeData` / `AggregatorNodeData` / `IterationNodeData` / `BranchTakenData` / `IterationItemData`，`GraphNode.type` 扩到 7 种 | 本阶段 `01` |
| SSE 事件协议：`branch_taken` / `iteration_item` 的 payload 与顺序 | `packages/contract/sse-events.md` §2 / §3 |
| 后端图校验规则 8.1.1~8.1.12 与运行期 §8.2 | `packages/contract/error-messages.md` §8 |
| 画布已能读图 / 保存 / 发布 / SSE 运行 | 阶段 3~7（`03-画布/06`、`04-执行引擎/06`、`07-知识库RAG/04`） |
| 三端与 mock 已启动 | `05-验收.md` §2 |

> 本篇**只改前端**。后端若不支持 `condition` / `aggregator` / `iteration`，画布仍能编辑与保存（图是数据），但运行会在预检阶段返回 400——这正好可以用来验证第 7 项「预检前置」是否把错误提前暴露了。

---

## 3. 命令逐条

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `pnpm install` | 仓库根 | 确保 `@xyflow/react` 等依赖就位（阶段 3 已装） | 退出码 0 |
| `pnpm dev:web` | 仓库根 | 起 Next.js（3000） | `Ready in ...` + `Local: http://localhost:3000` |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001），供画布读写图 / 运行 | `api-ts listening on http://localhost:3001` |
| `pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000），用于交叉验证（可选） | `Uvicorn running on http://127.0.0.1:8000` |
| `node tools/mock-llm/server.mjs` | 仓库根 | 起 mock provider（11435） | `mock-llm listening on http://127.0.0.1:11435` |
| `npx tsc --noEmit` | `apps/web` | 前端类型检查 | 无输出、退出码 0 |
| 浏览器打开 `http://localhost:3000/apps/{id}` | —— | 编辑条件图并运行 | 见第 7 节实测 |

**准备一个带 `start` 输入的应用**：`start.data.inputs` 声明 `topic`（string、required），运行面板会自动生成输入框——阶段 4 已讲，不重复。

---

## 4. 前端完整代码（阶段 8 增量）

本步涉及的位置（都在同一个文件里）：

```
apps/web/app/apps/[id]/page.tsx
├── 类型：NodeType / ConditionOperator / ConditionCase / AggregatorOutput
├── OPERATOR_OPTIONS / UNARY_OPERATORS / nextCaseId
├── ConditionNode（多 source Handle）
├── AggregatorNode / IterationNode
├── nodeTypes / initialData
├── summarizeFrame（事件日志的人话摘要）
├── missingBranches（预检前置）
├── addCondition / removeCondition
├── condition / aggregator / iteration 检查器
└── 运行面板：branchEvents / iterationEvents / retrievals
```

### 4.1 类型、运算符表与分支 id 生成

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
type NodeType = 'start' | 'end' | 'llm' | 'knowledge' | 'condition' | 'aggregator' | 'iteration'

/** condition 支持的条件运算符（12 个，两端一致）。 */
type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

/** condition 的一个分支；`id` 同时作为出边 `sourceHandle`。 */
type ConditionCase = {
  id: string
  label: string
  variable: string
  operator: ConditionOperator
  value?: string
}

/** aggregator 的一个输出：按 `values` 顺序取第一个非空值。 */
type AggregatorOutput = { name: string; values: string[] }

/** 运算符下拉的中文标签（顺序与契约枚举一致）。 */
const OPERATOR_OPTIONS: Array<{ value: ConditionOperator; label: string }> = [
  { value: 'equals', label: '等于 (equals)' },
  { value: 'not_equals', label: '不等于 (not_equals)' },
  { value: 'contains', label: '包含 (contains)' },
  { value: 'not_contains', label: '不包含 (not_contains)' },
  { value: 'starts_with', label: '以…开头 (starts_with)' },
  { value: 'ends_with', label: '以…结尾 (ends_with)' },
  { value: 'is_empty', label: '为空 (is_empty)' },
  { value: 'is_not_empty', label: '非空 (is_not_empty)' },
  { value: 'gt', label: '大于 (gt)' },
  { value: 'gte', label: '大于等于 (gte)' },
  { value: 'lt', label: '小于 (lt)' },
  { value: 'lte', label: '小于等于 (lte)' },
]

/** 这两类运算符不使用比较值（检查器隐藏 value 输入）。 */
const UNARY_OPERATORS: ConditionOperator[] = ['is_empty', 'is_not_empty']

/** 生成节点内不重复的分支 id：`case1`、`case2`…（编辑 label 不改 id，避免断边）。 */
function nextCaseId(conditions: ConditionCase[]): string {
  const used = new Set(conditions.map((item) => item.id))
  let n = 1
  while (used.has(`case${n}`)) n += 1
  return `case${n}`
}
```

**这段在干什么**：

- `ConditionCase` 的五个字段与契约 `ConditionCase` **一一对应**：`id` / `label` / `variable` / `operator` / `value?`。`id` 的注释直接点明它「同时作为出边 `sourceHandle`」——这是整篇的主线。
- `OPERATOR_OPTIONS` 的**顺序与契约枚举一致**，12 项一个不少；中文标签只是 `label`，`value` 永远是英文枚举名（保存进图的是 `value`）。
- `UNARY_OPERATORS` 是「一元运算符」白名单：`is_empty` / `is_not_empty` 不需要比较值，检查器据此隐藏 `value` 输入。
- `nextCaseId` 从 `case1` 开始找第一个没被占用的编号：已有 `case1`、`case3` 时，下一个是 `case2`。这样新增分支**不会覆盖**已有 id，也不会与「删除后重加」产生冲突。

### 4.2 `ConditionNode`：一个节点、多个 source Handle

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
/**
 * condition 节点：右侧**每个分支一个 source Handle**，`id` 即该分支的 `caseId`，
 * 末尾固定追加一个 `id="else"` 的 Handle。连线时 React Flow 会把被拖出的 handle id
 * 写入 `connection.sourceHandle`，保存时随 `edges[].sourceHandle` 落到后端。
 */
function ConditionNode({ data }: NodeProps) {
  const conditions = Array.isArray(data.conditions) ? (data.conditions as ConditionCase[]) : []
  const rows = [
    ...conditions.map((item) => ({ id: item.id, label: item.label === '' ? item.id : item.label })),
    { id: 'else', label: '否则' },
  ]
  return (
    <div
      style={{
        ...boxStyle,
        border: '1px solid #e11d48',
        background: '#fff5f7',
        boxShadow: 'inset 3px 0 0 #e11d48',
        textAlign: 'left',
        minWidth: 180,
        padding: '8px 10px 8px 14px',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600 }}>{String(data.title ?? '条件分支')}</div>
      <div style={{ fontSize: 12, color: '#888' }}>
        condition · {conditions.length} 个分支
      </div>
      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
        {rows.map((row) => (
          <div
            key={row.id}
            style={{ position: 'relative', fontSize: 12, minHeight: 18, paddingRight: 16, lineHeight: '18px' }}
          >
            <span>{row.label}</span>
            <Handle
              type="source"
              id={row.id}
              position={Position.Right}
              style={{ right: 0, top: '50%' }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
```

**这段在干什么**：

- `rows` = 「每个 case 一行」+「固定一行 `else`」。每行同时决定**文字**与**Handle 的 id**，两者同源，不可能对不上。
- `label === ''` 时回退显示 `id`：label 是纯展示字段，允许空串（契约要求这个键存在，但不禁止空值）；空 label 也要能看懂是哪条分支。
- **一个 `type="target"` Handle**（顶部，无 `id`）：所有入边都进这里，`targetHandle` 落库为 `null`。
- **N+1 个 `type="source"` Handle**（右侧，每个都有唯一 `id`）：这是节点「多出口」的全部实现。
- `condition · {conditions.length} 个分支` 只数 `conditions`，**不含 else**：初始 1 个条件显示「1 个分支」，新增后显示「2 个分支」。
- `else` 行的文字是中文「否则」，但它的 **Handle id 是 `"else"`**（英文）——因为 id 要进后端分派逻辑，必须与契约一致。

### 4.3 节点注册与初始 data

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
function AggregatorNode({ data }: NodeProps) {
  return (
    <NodeShell
      title={String(data.title ?? '变量聚合')}
      type="aggregator · 聚合"
      hasTarget
      hasSource
      accent="#0ea5e9"
    />
  )
}

function IterationNode({ data }: NodeProps) {
  return (
    <NodeShell
      title={String(data.title ?? '迭代')}
      type="iteration · 迭代"
      hasTarget
      hasSource
      accent="#f59e0b"
    />
  )
}

const nodeTypes = {
  start: StartNode,
  end: EndNode,
  llm: LlmNode,
  knowledge: KnowledgeNode,
  condition: ConditionNode,
  aggregator: AggregatorNode,
  iteration: IterationNode,
}

/** 每种节点的初始 data（与引擎解释的形状对齐）。 */
function initialData(type: NodeType): Record<string, unknown> {
  if (type === 'llm') return { title: 'LLM', model: 'gpt-4o', prompt: '', system: '' }
  if (type === 'knowledge') return { title: '知识检索', knowledgeBaseId: '', query: '{{ inputs.topic }}', topK: 4 }
  if (type === 'start') return { title: '开始', inputs: [] }
  if (type === 'condition') {
    return {
      title: '条件分支',
      conditions: [{ id: 'case1', label: '分支 1', variable: '{{ inputs.topic }}', operator: 'contains', value: '' }],
    }
  }
  if (type === 'aggregator') return { title: '变量聚合', outputs: [{ name: 'answer', values: [''] }] }
  if (type === 'iteration') {
    return {
      title: '迭代',
      inputArray: '{{ inputs.items }}',
      itemName: 'item',
      maxIterations: 20,
      outputTemplate: '{{ item }}',
    }
  }
  return { title: '结束', outputs: [] }
}
```

**这段在干什么**：

- `nodeTypes` 从 4 种扩到 **7 种**，与契约 `GraphNode.type` 的 7 值枚举对齐；少注册一种，画布遇到该类型就会回落成默认节点（看不到 Handle）。
- `initialData('condition')` 直接给出**一条可用的默认分支**：`case1` / `contains` / `{{ inputs.topic }}`。用户添加节点后只需补 `value` 与连线，不用从空数组开始。
- `initialData('aggregator')` 给一个 `answer` 输出与一个空取值；`initialData('iteration')` 给 `{{ inputs.items }}`、`itemName: "item"`、`maxIterations: 20`、`outputTemplate: "{{ item }}"`——四个字段与契约 `IterationNodeData` 对齐，`maxIterations` 的默认 20 也与后端一致。

### 4.4 分支增删与「缺出边」预检

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
/** condition 节点的分支列表（`data.conditions` 非数组时视为空）。 */
const selectedConditions = useMemo<ConditionCase[]>(() => {
  const raw = selectedNode?.data.conditions
  return Array.isArray(raw) ? (raw as ConditionCase[]) : []
}, [selectedNode])

/** condition 节点里「还没有出边」的分支（含 else），用于提前暴露保存会失败的原因。 */
const missingBranches = useMemo<Array<{ id: string; label: string }>>(() => {
  if (selectedNode === null || selectedNode.type !== 'condition') return []
  const branches = [
    ...selectedConditions.map((item) => ({ id: item.id, label: item.label === '' ? item.id : item.label })),
    { id: 'else', label: '否则' },
  ]
  return branches.filter(
    (branch) => !edges.some((edge) => edge.source === selectedNode.id && edge.sourceHandle === branch.id),
  )
}, [selectedNode, selectedConditions, edges])

/** 新增 condition 分支：自动生成节点内唯一的 `case{N}`（不覆盖已有 id）。 */
function addCondition(id: string): void {
  setNodes((nds) =>
    nds.map((node) => {
      if (node.id !== id) return node
      const conditions = Array.isArray(node.data.conditions) ? (node.data.conditions as ConditionCase[]) : []
      const caseId = nextCaseId(conditions)
      const next: ConditionCase = {
        id: caseId,
        label: `分支 ${caseId.replace(/^case/, '')}`,
        variable: '{{ inputs.topic }}',
        operator: 'contains',
        value: '',
      }
      return { ...node, data: { ...node.data, conditions: [...conditions, next] } }
    }),
  )
}

/** 删除 condition 分支：同时移除 `sourceHandle === caseId` 的出边，避免留下非法边。 */
function removeCondition(id: string, caseId: string): void {
  setNodes((nds) =>
    nds.map((node) => {
      if (node.id !== id) return node
      const conditions = Array.isArray(node.data.conditions) ? (node.data.conditions as ConditionCase[]) : []
      return { ...node, data: { ...node.data, conditions: conditions.filter((item) => item.id !== caseId) } }
    }),
  )
  setEdges((eds) => eds.filter((edge) => !(edge.source === id && edge.sourceHandle === caseId)))
}
```

**这段在干什么**：

- `missingBranches` 用**当前 `edges` 状态**反查：对每个分支 id（含 `else`），看有没有 `source === 当前节点 && sourceHandle === 该 id` 的边。没有就进缺失列表。
- 它**只在选中 condition 节点时计算**，且依赖 `edges`——连上一条线，红字立刻少一条；删掉一条线，立刻多一条。这是纯派生态，不存额外状态。
- `addCondition` 只改 `data.conditions`；画布上的 Handle 由 `ConditionNode` **从同一份 data 重新渲染**，所以「新增一行文字 + 新增一个 Handle」是同时发生的，不需要手动操作 DOM。
- `removeCondition` 做**两件事**：从 `conditions` 删掉该项；从 `edges` 删掉 `sourceHandle === caseId` 的边。第二件事不能省（见 §5.4）。

### 4.5 condition 检查器

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
{selectedNode.type === 'condition' && (
  <div style={{ display: 'grid', gap: 6 }}>
    <div style={{ fontWeight: 600 }}>条件分支（按顺序取第一个匹配）</div>
    {selectedConditions.map((item, index) => (
      <div
        key={item.id}
        style={{ border: '1px solid #eee', borderRadius: 4, padding: 6, display: 'grid', gap: 4 }}
      >
        <div style={{ fontSize: 11, color: '#888' }}>
          分支 id：<code>{item.id}</code>（出边 sourceHandle）
        </div>
        <label style={{ fontSize: 12 }}>
          分支名（label）
          <input
            value={item.label}
            onChange={(e) =>
              updateNodeData(selectedNode.id, {
                conditions: selectedConditions.map((cur, i) =>
                  i === index ? { ...cur, label: e.target.value } : cur,
                ),
              })
            }
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          变量（模板）
          <input
            value={item.variable}
            placeholder="{{ inputs.topic }}"
            onChange={(e) =>
              updateNodeData(selectedNode.id, {
                conditions: selectedConditions.map((cur, i) =>
                  i === index ? { ...cur, variable: e.target.value } : cur,
                ),
              })
            }
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          运算符
          <select
            value={item.operator}
            onChange={(e) =>
              updateNodeData(selectedNode.id, {
                conditions: selectedConditions.map((cur, i) =>
                  i === index ? { ...cur, operator: e.target.value as ConditionOperator } : cur,
                ),
              })
            }
            style={{ display: 'block', width: '100%' }}
          >
            {OPERATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {!UNARY_OPERATORS.includes(item.operator) && (
          <label style={{ fontSize: 12 }}>
            比较值（字面量或模板）
            <input
              value={item.value ?? ''}
              onChange={(e) =>
                updateNodeData(selectedNode.id, {
                  conditions: selectedConditions.map((cur, i) =>
                    i === index ? { ...cur, value: e.target.value } : cur,
                  ),
                })
              }
              style={{ display: 'block', width: '100%' }}
            />
          </label>
        )}
        <button onClick={() => removeCondition(selectedNode.id, item.id)}>删除分支</button>
      </div>
    ))}
    <button onClick={() => addCondition(selectedNode.id)}>新增分支</button>
    <p style={{ fontSize: 11, color: '#b26a00', margin: 0 }}>
      每个分支（含「否则」）都需要连线，否则保存会失败。
    </p>
    {missingBranches.length > 0 && (
      <p style={{ fontSize: 11, color: 'crimson', margin: 0 }}>
        缺少出边：{missingBranches.map((branch) => branch.label).join('、')}
      </p>
    )}
  </div>
)}
```

**这段在干什么**：

- 每条分支一张卡片，**id 只读展示、label 可编辑**——UI 层面从根上避免「改 id 断边」。
- 「变量 / 运算符 / 比较值」三件套与契约一致；运算符下拉的 12 个选项全部来自 `OPERATOR_OPTIONS`，`value` 是英文枚举名。
- `{!UNARY_OPERATORS.includes(item.operator) && ...}`：选中 `is_empty` / `is_not_empty` 时**整块 `value` 输入消失**（不是禁用）；切回 `equals` 时同一份 `item.value` 仍在（React 只是不渲染），输入框恢复原来的值。
- 底部两条提示：一条是**常量提醒**（每个分支都要连线），一条是**动态红字**（当前具体缺哪几条）。红字只在 `missingBranches.length > 0` 时出现。

> 注意：`else` 不在 `conditions` 里，所以它没有「编辑卡片」，但 `missingBranches` **包含** `else`——「否则」没连线同样会被列出来。

### 4.6 aggregator / iteration 检查器

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
{selectedNode.type === 'aggregator' && (
  <div style={{ display: 'grid', gap: 6 }}>
    <div style={{ fontWeight: 600 }}>输出聚合</div>
    <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
      每个输出按 values 顺序取第一个非空值（解析失败的模板视为空串）。
    </p>
    {selectedAggregatorOutputs.map((item, index) => (
      <div
        key={index}
        style={{ border: '1px solid #eee', borderRadius: 4, padding: 6, display: 'grid', gap: 4 }}
      >
        <input
          placeholder="输出名，如 answer"
          value={item.name}
          onChange={(e) =>
            updateNodeData(selectedNode.id, {
              outputs: selectedAggregatorOutputs.map((cur, i) =>
                i === index ? { ...cur, name: e.target.value } : cur,
              ),
            })
          }
          style={{ width: '100%' }}
        />
        {item.values.map((value, valueIndex) => (
          <div key={valueIndex} style={{ display: 'flex', gap: 4 }}>
            <input
              placeholder="值，如 {{ llm1.text }}"
              value={value}
              onChange={(e) =>
                updateNodeData(selectedNode.id, {
                  outputs: selectedAggregatorOutputs.map((cur, i) =>
                    i === index
                      ? { ...cur, values: cur.values.map((v, vi) => (vi === valueIndex ? e.target.value : v)) }
                      : cur,
                  ),
                })
              }
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              disabled={item.values.length <= 1}
              onClick={() =>
                updateNodeData(selectedNode.id, {
                  outputs: selectedAggregatorOutputs.map((cur, i) =>
                    i === index ? { ...cur, values: cur.values.filter((_v, vi) => vi !== valueIndex) } : cur,
                  ),
                })
              }
            >
              删除值
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            updateNodeData(selectedNode.id, {
              outputs: selectedAggregatorOutputs.map((cur, i) =>
                i === index ? { ...cur, values: [...cur.values, ''] } : cur,
              ),
            })
          }
        >
          新增取值
        </button>
        <button
          onClick={() =>
            updateNodeData(selectedNode.id, {
              outputs: selectedAggregatorOutputs.filter((_cur, i) => i !== index),
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
          outputs: [...selectedAggregatorOutputs, { name: '', values: [''] }],
        })
      }
    >
      新增输出
    </button>
  </div>
)}

{selectedNode.type === 'iteration' && (
  <div style={{ display: 'grid', gap: 8 }}>
    <label>
      输入数组（inputArray，模板）
      <input
        value={String(selectedNode.data.inputArray ?? '')}
        placeholder="{{ inputs.items }}"
        onChange={(e) => updateNodeData(selectedNode.id, { inputArray: e.target.value })}
        style={{ display: 'block', width: '100%' }}
      />
    </label>
    <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
      模板解析结果必须是 JSON 数组，如 [&quot;A&quot;,&quot;B&quot;]。
    </p>
    <label>
      当前项变量名（itemName）
      <input
        value={String(selectedNode.data.itemName ?? 'item')}
        onChange={(e) => updateNodeData(selectedNode.id, { itemName: e.target.value })}
        style={{ display: 'block', width: '100%' }}
      />
    </label>
    <label>
      最大迭代次数（1-100）
      <input
        type="number"
        min="1"
        max="100"
        value={maxIterationsText}
        onChange={(e) => changeMaxIterations(selectedNode.id, e.target.value)}
        onBlur={() => commitMaxIterations(selectedNode.id)}
        style={{ display: 'block', width: 100 }}
      />
    </label>
    <label>
      输出模板（outputTemplate，每项渲染一次）
      <textarea
        value={String(selectedNode.data.outputTemplate ?? '')}
        placeholder="第{{ itemIndex }}/{{ itemCount }}项: {{ item }}"
        onChange={(e) => updateNodeData(selectedNode.id, { outputTemplate: e.target.value })}
        rows={4}
        style={{ display: 'block', width: '100%' }}
      />
    </label>
    <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
      可用 {'{{ item }}'}、{'{{ itemIndex }}'}、{'{{ itemCount }}'}。
    </p>
  </div>
)}
```

**这段在干什么**：

- aggregator 是「输出名 + 一组候选值」的二维结构：外层增删输出，内层增删取值。**至少一个取值**的约束由 `disabled={item.values.length <= 1}` 在 UI 上兜住（后端还有 8.1.10 兜底）。
- 提示文案「解析失败的模板视为空串」把**分支安全解析**的行为提前告诉用户：未执行分支的 `{{ llm2.text }}` 不会报错，只贡献一个空串。
- iteration 的四个字段与契约一一对应；`maxIterations` 与 `topK` 一样用「编辑期文本 + 合法即写回 + 失焦钳制」的模式（见 `07-知识库RAG/04` §6.2.3），范围 1–100。
- 输出模板提示了三个可用变量：`item`（当前项）、`itemIndex`（1 起）、`itemCount`（总数）——与 `sse-events.md` §4 的注入规则一致。

### 4.7 运行面板：三类过程事件

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`（节选）**

```tsx
// 本次运行收到的 retrieval 事件（可能来自多个 knowledge 节点）。
const [retrievals, setRetrievals] = useState<RetrievalInfo[]>([])

// 本次运行收到的 branch_taken / iteration_item 事件（阶段 8）。
const [branchEvents, setBranchEvents] = useState<Array<{ nodeId: string; caseId: string; label: string }>>([])
const [iterationEvents, setIterationEvents] = useState<Array<{ nodeId: string; index: number; total: number }>>([])

// —— SSE 消费循环（节选） ——
} else if (frame.event === 'retrieval') {
  const parsed = JSON.parse(frame.data) as Partial<RetrievalInfo>
  setRetrievals((prev) => [
    ...prev,
    {
      nodeId: parsed.nodeId ?? '',
      knowledgeBaseId: parsed.knowledgeBaseId ?? '',
      topK: typeof parsed.topK === 'number' ? parsed.topK : 0,
      hits: Array.isArray(parsed.hits) ? parsed.hits : [],
    },
  ])
} else if (frame.event === 'branch_taken') {
  const parsed = JSON.parse(frame.data) as { nodeId?: string; caseId?: string; label?: string }
  setBranchEvents((prev) => [
    ...prev,
    { nodeId: parsed.nodeId ?? '', caseId: parsed.caseId ?? '', label: parsed.label ?? '' },
  ])
} else if (frame.event === 'iteration_item') {
  const parsed = JSON.parse(frame.data) as { nodeId?: string; index?: number; total?: number }
  setIterationEvents((prev) => [
    ...prev,
    {
      nodeId: parsed.nodeId ?? '',
      index: typeof parsed.index === 'number' ? parsed.index : 0,
      total: typeof parsed.total === 'number' ? parsed.total : 0,
    },
  ])
} else if (frame.event === 'run_failed') {
  const parsed = JSON.parse(frame.data) as { message?: string }
  setRunError(parsed.message ?? 'run failed')
}
// 逐事件让出一次，保证 token 能一段段渲染出来。
await yieldToPaint()
```

**渲染部分（节选）**

```tsx
{branchEvents.length > 0 && (
  <div>
    <div style={{ fontWeight: 600 }}>分支选择（branch_taken）</div>
    {branchEvents.map((item, index) => (
      <div
        key={`${item.nodeId}-${index}`}
        style={{ fontSize: 13, background: '#fff4e5', padding: 6, borderRadius: 4, marginTop: 6 }}
      >
        分支：{item.label}（{item.caseId}）
        {item.nodeId !== '' && <span style={{ color: '#888' }}> （节点 {item.nodeId}）</span>}
      </div>
    ))}
  </div>
)}

{iterationEvents.length > 0 && (
  <div>
    <div style={{ fontWeight: 600 }}>迭代进度（iteration_item）</div>
    {iterationEvents.map((item, index) => (
      <div
        key={`${item.nodeId}-${index}`}
        style={{ fontSize: 13, background: '#fff8e6', padding: 4, borderRadius: 4, marginTop: 4 }}
      >
        迭代 {item.index}/{item.total}
        {item.nodeId !== '' && <span style={{ color: '#888' }}> （节点 {item.nodeId}）</span>}
      </div>
    ))}
  </div>
)}
```

**事件日志的人话摘要**

```tsx
} else if (name === 'branch_taken') {
  try {
    const parsed = JSON.parse(data) as { caseId?: string; label?: string }
    return `分支：${parsed.label ?? ''}（${parsed.caseId ?? ''}）`
  } catch {
    return data
  }
} else if (name === 'iteration_item') {
  try {
    const parsed = JSON.parse(data) as { index?: number; total?: number }
    return `迭代 ${parsed.index ?? '?'}/${parsed.total ?? '?'}`
  } catch {
    return data
  }
}
```

**这段在干什么**：

- 三个数组 `retrievals` / `branchEvents` / `iterationEvents` 分别承载三类过程事件；每次事件**追加**一条，不在 `run_finished` 时清空（面板在本次运行内累积）。
- 每类都做了**归一化**：缺字段给默认值（`?? ''` / `?? 0`）、`hits` 非数组给 `[]`——与阶段 5/7 的容错风格一致。
- `branch_taken` 卡片文案固定为 `分支：{label}（{caseId}）`；`iteration_item` 固定为 `迭代 {index}/{total}`。
- `yieldToPaint()` 在每个事件后让出一次宏任务：`branch_taken` 与 `iteration_item` 也能**逐条**出现，而不是在一次 React 批处理里「刷」地全出来。

---

## 5. 【技术教学 A · 首次】ReactFlow 多出口 Handle 与契约接缝

### 5.1 `Handle`、`source` 与 `sourceHandle`

**先讲基本概念**（ReactFlow 的 `Handle` 是「连线的锚点」）：

```tsx
import { Handle, Position } from '@xyflow/react'

<Handle type="target" position={Position.Top} />                 {/* 入边锚点 */}
<Handle type="source" position={Position.Bottom} />              {/* 出边锚点（无 id） */}
<Handle type="source" position={Position.Right} id="case1" />    {/* 出边锚点（有 id） */}
```

| 属性 | 含义 |
| --- | --- |
| `type` | `"source"` 表示「从这里拖出去」；`"target"` 表示「拖进来」 |
| `position` | 视觉方位（`Top` / `Right` / `Bottom` / `Left`），只决定默认摆放 |
| `id` | 该 Handle 在**本节点内**的唯一标识；省略时 ReactFlow 视为「默认 Handle」 |
| `style` | 覆盖默认定位（本例用它做行内垂直对齐） |

**一个节点只有一个 `source` Handle 时**（阶段 3~7 的所有节点）：连线产生的边 `sourceHandle` 是 `null`（或 `undefined`）。后端看到 `null` 就知道「这个节点只有一个出口」，不需要分派。

**一个节点有多个 `source` Handle 时**（本阶段的 `condition`）：**每个 Handle 必须有唯一 `id`**，否则 ReactFlow 无法区分「这条线是从哪个出口拉出来的」。连线时：

```
拖拽 source Handle(case1) → connection.sourceHandle === "case1"
拖拽 source Handle(else)  → connection.sourceHandle === "else"
```

`onConnect` 把整个 `connection` 展开进边：

```tsx
const onConnect = useCallback(
  (connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds))
  },
  [setEdges],
)
```

**这段在干什么**：`connection` 是 `{ source, target, sourceHandle, targetHandle }`；`addEdge({ ...connection, id })` 把这四个字段原样存进 `edges` 数组。于是**边自己记住了「从哪个 Handle 出来」**——不需要额外的映射表。

**保存时**：

```tsx
edges: edges.map((edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  sourceHandle: edge.sourceHandle ?? null,
  targetHandle: edge.targetHandle ?? null,
})),
```

**这段在干什么**：把 ReactFlow 的 `undefined` 统一成 `null` 再发给后端。**普通边 `sourceHandle: null`、分支边 `sourceHandle: "case1"`**——这就是实测里 `GET /apps/{id}/graph` 看到两种值的原因。

> 如果分支边丢了 `sourceHandle`（比如手工构造图时忘了写），后端会把 condition 的这条边当成「没有指定分支」：轻则某分支被判「缺出边」（8.1.5 / 8.1.6），重则 `sourceHandle` 非法（8.1.7）。**多出口节点的边不允许 `null`。**

### 5.2 动态渲染与行内垂直布局

`ConditionNode` 没有把 Handle 写死，而是**从 `data.conditions` 推导**：

```tsx
const rows = [
  ...conditions.map((item) => ({ id: item.id, label: item.label === '' ? item.id : item.label })),
  { id: 'else', label: '否则' },
]
```

**这段在干什么**：

- `conditions` 变化（新增 / 删除 / 加载图）→ `rows` 变化 → Handle 数量变化。React 通过 `key={row.id}` 复用/重建行，Handle 自动跟着增删。
- `else` 永远在最后，且**不依赖任何用户数据**：即使 `conditions` 为空，画布上仍有一个 `else` Handle（但此时后端会先报 8.1.1「至少一个条件」）。
- 注意顺序：Handle 的**视觉顺序**与 `conditions` 的**求值顺序**一致（引擎按数组顺序取第一个匹配）。用户从上到下读节点，就等于读优先级。

**为什么每行要 `position: 'relative'`**

`Handle` 的默认 CSS 是 `position: absolute`，会相对于**最近的已定位祖先**摆放。ReactFlow 的节点容器（`.react-flow__node`）本身就是定位元素，所以只写一个 Handle 时它天然贴在节点边缘。

但多 Handle 场景下，如果 Handle 直接挂在节点容器上，**所有右侧 Handle 会重叠在同一个垂直位置**（节点中线），用户根本分不清拖的是哪条。解决办法是给每一行套一个定位容器：

```tsx
<div
  key={row.id}
  style={{ position: 'relative', fontSize: 12, minHeight: 18, paddingRight: 16, lineHeight: '18px' }}
>
  <span>{row.label}</span>
  <Handle
    type="source"
    id={row.id}
    position={Position.Right}
    style={{ right: 0, top: '50%' }}
  />
</div>
```

**这段在干什么**：

- `position: 'relative'` 让这一行成为 Handle 的定位参照——Handle 的 `top: 50%` 是**相对这一行**居中，而不是相对整个节点。
- `right: 0` 把 Handle 贴到行的右边缘；`paddingRight: 16` 给 Handle 留出不被文字覆盖的空间。
- `minHeight: 18` + `lineHeight: '18px'` 保证空 label 时行高稳定，Handle 不会跳。
- `Position.Right` 仍要写：它提供 ReactFlow 的方向类名（影响连线路径的出入方向），`style` 只覆盖具体坐标。

| 写法 | 结果 |
| --- | --- |
| 多 Handle 直接放节点容器、都用 `Position.Right` | ❌ 全部重叠在节点中线 |
| 每行 `position: relative` + Handle `right: 0; top: 50%` | ✅ 与文字逐行对齐 |
| 用 `Position.Top` / `Bottom` 硬挤 | ⚠️ 能分开，但连线方向与「右侧出口」的语义不符 |

### 5.3 契约接缝：Handle id = `edge.sourceHandle` = `caseId`

这是本篇最重要的一条链路：

```
画布                             图 JSON                        后端
─────────────────────────────────────────────────────────────────────────
<Handle id="case1">   ──连线──>  edge.sourceHandle = "case1"  ──>  condition 分派
<Handle id="else">    ──连线──>  edge.sourceHandle = "else"   ──>  兜底分支

condition.data.conditions[].id = "case1"
        │
        └──> branch_taken.caseId = "case1"（选中时）
```

把它写成「同值约束」：

| 概念 | 出现位置 | 值 |
| --- | --- | --- |
| 分支标识 | `condition.data.conditions[].id` | `"case1"` |
| Handle 标识 | `<Handle type="source" id={...}>` | `"case1"` |
| 边标识 | `edge.sourceHandle` | `"case1"` |
| 事件标识 | `branch_taken.caseId` | `"case1"` |
| 兜底分支 | 上述四处的 `else` | `"else"` |

**为什么必须同值**：

1. **后端不认识 Handle**，它只读图 JSON。`condition` 节点的分派逻辑是「按 `data.conditions` 顺序求值，选中 id 后找 `sourceHandle === 该 id` 的出边，沿它执行」。
2. **前端不认识求值逻辑**，它只负责把 Handle id 写进边。如果 Handle id 与 `conditions[].id` 不同，连出来的边在后端看来就是「指向一个不存在的 case」。
3. **事件里的 `caseId` 来自后端选中的条件 id**，不是从边反推的。前端展示「分支：label（caseId）」时，`caseId` 必须能和画布上的 Handle 对上，用户才能把事件与图对应起来。

**`else` 的特殊性**：

- 画布上的行文字是中文「否则」，**Handle id 是英文 `"else"`**。
- 后端的 `branch_taken` 在兜底时 `caseId = "else"`、`label = "else"`（不是「否则」）。
- 所以运行面板可能显示「分支：else（else）」，而画布上写的是「否则」——**这是预期行为**：label 是展示，契约值是 `else`。

> **一句话**：**Handle id 不是装饰，它是图 JSON 里 `sourceHandle` 的唯一来源；前端把 id 写对，后端才能路由对。**

### 5.4 删除分支必须同步删边

**错误做法（只删条件）**：

```tsx
// ❌ 只从 conditions 里删掉，边还留着
setNodes((nds) => nds.map((node) =>
  node.id === id
    ? { ...node, data: { ...node.data, conditions: conditions.filter((c) => c.id !== caseId) } }
    : node,
))
```

**会发生什么**：

- 画布上该分支的行与 Handle 消失，但边还在。ReactFlow 对「`sourceHandle` 指向不存在 Handle」的边通常**不再渲染**，用户以为边已经没了。
- 保存时 `buildGraph()` 仍把这条边写进 JSON。
- 后端预检 8.1.7：`edge {edgeId} from condition node {nodeId} has invalid sourceHandle: {handle}` → **400**。
- 更隐蔽的情况：删掉 `case1` 但边还在，同时 `case1` 的边被后端视为「非法」；如果用户又新增了一个 `case1`（不会，`nextCaseId` 会跳过），旧边还会「复活」连到新分支上。

**正确做法（本项目）**：

```tsx
function removeCondition(id: string, caseId: string): void {
  setNodes((nds) => /* 删 condition */)
  setEdges((eds) => eds.filter((edge) => !(edge.source === id && edge.sourceHandle === caseId)))
}
```

**这段在干什么**：只删「源头是这个节点、且 Handle 正好是被删 caseId」的边。**其他分支的边、以及以该节点为 target 的入边都不受影响**。

> 如果被删分支的下游节点因此变成「不可达」，图仍然合法——本项目只要求 `start` 可达性与分支出边完整性，不要求所有节点都被连上。用户可以把下游节点重新连到别的分支，或删掉它。

### 5.5 改 label 不改 id

检查器里 **id 是只读的 `<code>`，label 才是 `<input>`**：

```tsx
<div style={{ fontSize: 11, color: '#888' }}>
  分支 id：<code>{item.id}</code>（出边 sourceHandle）
</div>
<label style={{ fontSize: 12 }}>
  分支名（label）
  <input value={item.label} onChange={...} />
</label>
```

**为什么这样设计**：

- `label` 只出现在两个地方：画布行文字、`branch_taken.label`。它**不参与路由**，改了不影响任何边。
- `id` 出现在边与事件里。改 id 等于「把旧边的源头抽走」：
  - 旧边变成非法 `sourceHandle`（8.1.7）；
  - 新 id 没有出边（8.1.5）；
  - 用户会同时看到两条错误，却不知道是自己改了个名字导致的。
- 因此 UI **不提供改 id 的入口**。`nextCaseId` 也保证新增分支不会复用/覆盖已有 id。

**如果确实需要「重命名 id」**（例如从外部导入的图），正确顺序是：**先改 `conditions[].id`，同时把所有 `sourceHandle === 旧 id` 的边改成新 id**。只改一边必然断边。

| 操作 | 允许 | 影响 |
| --- | --- | --- |
| 改 label | ✅ | 只变展示文字与 `branch_taken.label` |
| 改 operator / variable / value | ✅ | 只变求值条件，不影响路由 |
| 改 id（UI 不提供） | ❌ | 旧边非法 + 新分支缺边 |
| 删除分支 | ✅（连同删边） | 该分支不再存在 |

### 5.6 预检前置到 UI

**后端**在保存 / 运行前会做图校验（`error-messages.md` §8.1），其中包括：

- 8.1.5 每个条件都要有出边；
- 8.1.6 `else` 要有出边；
- 8.1.7 `sourceHandle` 必须合法；
- 8.1.8 同一分支不能有多条边。

**前端**能提前发现的是其中**最容易犯、也最容易当场修**的一类：**缺出边**。

```tsx
const missingBranches = useMemo(() => {
  if (selectedNode === null || selectedNode.type !== 'condition') return []
  const branches = [
    ...selectedConditions.map((item) => ({ id: item.id, label: item.label === '' ? item.id : item.label })),
    { id: 'else', label: '否则' },
  ]
  return branches.filter(
    (branch) => !edges.some((edge) => edge.source === selectedNode.id && edge.sourceHandle === branch.id),
  )
}, [selectedNode, selectedConditions, edges])
```

**这段在干什么**：

- 遍历「应有分支」集合，对每条分支检查「是否存在对应出边」；缺失的收集起来。
- 依赖 `edges`：连线/删边后立即重算，红字实时增减。
- 只做**提示**，不阻止保存——用户可能想先保存半成品。真正的强制在后端。

**为什么预检要前置**

- 后端的 400 文案是给开发者看的（带 nodeId / caseId / edgeId），普通用户看到一个英文 400 往往不知道「哪里没连」。
- 画布上的红字直接说「缺少出边：分支 2、否则」，用户抬头就能在节点上找到对应行。
- 把「保存后才发现」变成「连线时就发现」，减少一次失败的保存/运行往返。

**前端预检的边界（必须知道）**

| 规则 | 前端是否提示 |
| --- | --- |
| 8.1.5 / 8.1.6 缺出边 | ✅ `missingBranches` |
| 8.1.7 sourceHandle 非法 | ❌（正常操作不会产生；手工改图才会） |
| 8.1.8 同一分支多条边 | ❌（多拖一条线不会自动覆盖，后端兜底） |
| 8.1.1 conditions 为空 | ❌（UI 没有「删到 0 个条件」的按钮路径；删光后只剩 else） |
| 8.1.9~8.1.12 aggregator / iteration 数据规则 | ❌（后端兜底） |

> **一句话**：**前端预检负责「用户最常犯、最好当场修」的错；后端校验负责「所有可能的错」。两层不是替代关系，而是「早提示 + 最终裁决」。**

---

## 6. 【技术教学 B · 首次】12 个运算符与三类过程事件

### 6.1 12 个 operator 与「一元运算符隐藏 value」

`OPERATOR_OPTIONS` 的顺序与契约 `ConditionOperator` 完全一致，分四组理解：

| 组 | 运算符 | 语义（两端一致） | 需要 value |
| --- | --- | --- | --- |
| 全等 / 不等 | `equals` / `not_equals` | 字符串全等 / 不全等 | ✅ |
| 包含 / 前后缀 | `contains` / `not_contains`、`starts_with` / `ends_with` | 字符串包含 / 前缀 / 后缀 | ✅ |
| 空值 | `is_empty` / `is_not_empty` | 字符串是否为 `""` | ❌ |
| 数值 | `gt` / `gte` / `lt` / `lte` | 先转数字再比较；任一侧不是有限数字 → `false` | ✅ |

**为什么一元运算符要隐藏而不是禁用**

- 禁用会留下一个「灰掉的输入框 + 里面还残留旧值」的视觉噪音，用户容易以为它仍参与比较。
- 隐藏后语义清晰：`is_empty` 就是「只看变量本身」。
- `item.value` **不删除**：切回 `equals` 时原值恢复，用户不会丢输入。

**一个容易忽略的行为**：`is_empty` 只认**字符串为空**。变量解析结果是 `"0"` / `"false"` / 含空格的 `" "` 都不算空——这与后端实现一致（`sse-events.md` §4）。

### 6.2 三类过程事件的分工

阶段 8 的运行面板同时展示三种「过程事件」，它们都不是最终结果：

| 事件 | 来源节点 | 回答的问题 | 展示形态 |
| --- | --- | --- | --- |
| `branch_taken` | `condition` | **走了哪条路？** | 「分支：`<label>`（`<caseId>`）」 |
| `iteration_item` | `iteration` | **循环到第几项了？** | 「迭代 i/N」 |
| `retrieval` | `knowledge` | **答案引用了哪些原文？** | 「命中 N 条 · topK K」+ 每条引用 |

**共同点**：

- 都是**节点执行过程中**发出，顺序插在 `node_started` 与 `node_finished` 之间。
- 都**不进入** `run_finished.outputs`；最终结果只看 `outputs`。
- 都能在一个节点内**多次出现**？——`iteration_item` 是每项一次；`branch_taken` / `retrieval` 是**每节点一次**（协议固定）。
- 前端都用数组**追加**，并用 `nodeId` 区分「来自哪个节点」。

**不同点（决定展示方式）**：

- `branch_taken` 是**路由事实**，一次运行里每个 condition 节点只出现一条；它解释「为什么另一条分支的节点完全没出现」。
- `iteration_item` 是**进度**，条数等于数组长度；它让长循环「看得见」。
- `retrieval` 是**引用**，带结构化 `hits`；它是可解释性信息，不影响执行路径。

> 这正是「**节点算结果、条件边只路由**」在 UI 上的体现：`branch_taken` 只说明走了哪条边，不携带任何业务数据；真正的结果仍由各节点的 `node_finished.output` 与最终的 `run_finished.outputs` 给出。

### 6.3 事件日志为什么还要 `summarizeFrame`

面板上方有「卡片区」（结构化展示），下方有「事件日志」（原始顺序）。日志里的 `data` 是一行 JSON，直接看很难读，所以 `summarizeFrame` 把高频事件翻译成人话：

| 事件 | 摘要 |
| --- | --- |
| `token` | `节点id · "文本"` |
| `tool_call` | `第 N 轮 · 调用 <toolName> · {args}` |
| `tool_result` | `第 N 轮 · <toolName> 返回 <result> · 耗时 X ms` |
| `branch_taken` | `分支：<label>（<caseId>）` |
| `iteration_item` | `迭代 i/N` |
| 其余 | 原样（超 300 字符截断） |

**这段在干什么**：`try/catch` 包住 `JSON.parse`——任何帧解析失败都回退成原始文本，绝不会因为一条坏帧让整个面板崩掉。

---

## 7. 实测回放（真实 headless Chrome + 真实后端）

**环境**：headless Chrome 真实 UI；`api-ts`（3001）+ `api-py`（8000）+ Next.js（3000）+ mock-llm（11435）。

**条件图：保存与落库**

```
节点面板点「条件分支」→ 画布出现 condition 节点（红色，卡片显示「condition · 1 个分支」）
右侧可见两个 source Handle：case1、else
连好 case1 → llm1、else → llm2、llm1/llm2 → 聚合、聚合 → end
保存草稿 → GET /apps/{id}/graph 的 edges：
  { "source": "<cond>", "target": "<llm1>", "sourceHandle": "case1" }
  { "source": "<cond>", "target": "<llm2>", "sourceHandle": "else"  }
  其余普通边（start→condition、llm→aggregator、aggregator→end）的 sourceHandle 均为 null
```

**运行（`topic = 服务很好`）**

```
运行面板卡片：
  分支：分支 1（case1）

事件日志：只有 llm1 的 node_started / token / node_finished；
          llm2 的 nodeId 完全未出现

运行输出：{"result":"echo: 分支一"}
```

> 未走的分支**整段不执行**：不是「执行了但结果为空」，而是连 `node_started` 都没有。这正是 `branch_taken` 想告诉用户的事。

**迭代（`items = ["A","B","C"]`）**

```
运行面板「迭代进度（iteration_item）」：
  迭代 1/3
  迭代 2/3
  迭代 3/3

运行输出：
  第1/3项: A
  第2/3项: B
  第3/3项: C
```

**检查器交互**

```
运算符下拉：12 项中文标签齐全（等于 / 不等于 / 包含 / 不包含 / 以…开头 / 以…结尾 /
            为空 / 非空 / 大于 / 大于等于 / 小于 / 小于等于）
选中 is_empty → 「比较值」输入框消失
切回 equals   → 「比较值」输入框恢复，且原值仍在
新增分支      → 自动生成 case2，画布立即多一个 case2 Handle，
                节点卡片变为「condition · 2 个分支」
删除分支      → 该分支的行、Handle 与出边同时消失
```

**类型检查**

```
apps/web> npx tsc --noEmit
（无输出，退出码 0）
```

---

## 8. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **多个 source Handle 都没写 `id`** | 连线后边的 `sourceHandle` 全是 `null`，后端报缺出边 / 非法 handle | 多出口节点每个 Handle 必须有唯一 `id`（§5.1） |
| 2 | **Handle 直接挂在节点容器上** | 所有右侧 Handle 重叠在节点中线，拖不准 | 每行套 `position: 'relative'`，Handle 用 `right: 0; top: '50%'`（§5.2） |
| 3 | **Handle id 与 `conditions[].id` 用了两套值** | 画布能连，保存后后端 400 | 两者必须同源：`id={item.id}`，不要另起一套编号（§5.3） |
| 4 | **删分支只删条件、不删边** | 保存 400 `... has invalid sourceHandle: caseX` | `removeCondition` 同时 filter `sourceHandle === caseId` 的边（§5.4） |
| 5 | **为了「重命名」直接改 id** | 旧边非法 + 新分支缺边，两条错误同时出现 | label 可改、id 不可改；真改 id 要同步改所有 `sourceHandle`（§5.5） |
| 6 | **`else` 当普通 case 存进 `conditions`** | 出现重复的 `else` 分支 / 预检报重复 | `else` 只存在于渲染行与边里，**不进** `conditions` 数组 |
| 7 | **普通边的 `sourceHandle` 写成 `""`** | 后端可能当非法值 | 统一用 `edge.sourceHandle ?? null` 落库（§5.1） |
| 8 | **`is_empty` 时仍显示 value 输入** | 用户填了值却不起作用 | `UNARY_OPERATORS` 白名单控制渲染（§6.1） |
| 9 | **新增分支复用已删的 id** | 旧边「复活」连到新分支 | `nextCaseId` 只保证不与**现存** id 冲突；若手工导入图，需自己清理旧边 |
| 10 | **把 `branch_taken` 当最终结果** | `outputs` 里找不到分支信息 | 过程事件是旁路，最终结果只看 `run_finished.outputs`（§6.2） |
| 11 | **`iteration_item` 只显示最后一条** | 以为循环只跑了一次 | 必须用数组**追加**，且每个事件后 `yieldToPaint()`（§4.7） |
| 12 | **面板不区分三类事件，混在一起** | 引用、进度、分支全塞进同一个列表，读不懂 | 三个独立数组 + 三块卡片（§4.7 / §6.2） |
| 13 | **`else` 的 label 显示成「否则」就以为事件也是「否则」** | 面板显示「分支：else（else）」 | 契约规定兜底时 `label = "else"`；画布「否则」只是 UI 文案（§5.3） |
| 14 | **删光所有条件** | 只剩 else，后端 8.1.1 `must have at least one condition` | UI 不阻止删光；保存前检查是否至少保留一个条件 |

---

## 9. 本篇复盘与知识点

**一句话总结本篇**：多出口分支在前端的全部实现，就是「**一个节点多个带 id 的 source Handle + 边上的 `sourceHandle`**」；`ConditionNode` 从 `conditions` 动态生成 Handle，`else` 固定追加，连线时 ReactFlow 自动把 Handle id 写进边，保存时原样落库。这条 id 链路必须与后端的 `caseId` / `else` 完全同值——它就是前后端契约的接缝。围绕这条接缝，前端还要做三件「保护性」的事：删分支同步删边、改 label 不改 id、把「缺出边」预检提前到画布红字。运行面板则把三类过程事件分开：`branch_taken` 说走了哪条路，`iteration_item` 说循环到第几项，`retrieval` 说引用了什么。

**本篇学到的工程要点**

1. **多出口 = 多 Handle + `sourceHandle`**：Handle id 是本节点内的唯一标识，边靠它记住「从哪个出口出来」。
2. **动态 Handle**：Handle 从数据派生，新增/删除分支时自动增删，不需要操作 DOM。
3. **布局**：多 Handle 必须放在各自的行容器里（`position: relative`），否则会重叠在同一位置。
4. **契约接缝**：`conditions[].id` = Handle id = `edge.sourceHandle` = `branch_taken.caseId`；`else` 是固定值。
5. **删分支要删边**：否则残留边的 `sourceHandle` 指向不存在的 case，后端 400。
6. **label 与 id 分离**：label 是展示，id 是路由；UI 只让改 label。
7. **预检前置**：`missingBranches` 把「保存才发现」变成「连线就发现」；但后端校验仍是最终裁决。
8. **三类过程事件**：`branch_taken` / `iteration_item` / `retrieval` 都是旁路信息，不进 `outputs`；分开存储、分开展示。

**遗留 / 后续**

- 前端预检只覆盖「缺出边」；非法 `sourceHandle`、重复边、aggregator / iteration 的数据规则仍由后端兜底，错误文案直接显示在顶部，未定位到具体节点。
- 分支 id 不能在 UI 里重命名；导入外部图时若 id 不规范，只能手改 JSON。
- 画布没有「不可达节点」提示：删分支后下游节点可能变成孤岛，但仍能保存。
- 过程事件只在本次运行内累积，没有「按节点折叠 / 清空单类事件」的交互。

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **ReactFlow 多 `source` Handle 与 `sourceHandle` 契约接缝** | **首次教学于本篇**：一个节点多个出口 = 多个带 id 的 Handle；连线把 id 写进 `edge.sourceHandle`；Handle id 必须等于后端 `caseId` / `else` |
| **按数据动态渲染 Handle 与行内垂直布局** | **首次教学于本篇**：`conditions` 每项一个 Handle + 固定 `else`；每行 `position: relative` 让 Handle 逐行对齐 |
| **删除分支要同步删边** | **首次教学于本篇**：只删条件会留下 `sourceHandle` 指向不存在 case 的边 → 后端 400 |
| **改 label 不改 id** | **首次教学于本篇**：label 只做展示，id 是连线标识；UI 不提供改 id 入口 |
| **预检前置到 UI** | **首次教学于本篇**：`missingBranches` 红字列出缺出边分支，保存前就能修；后端校验仍为最终裁决 |
| **运行面板区分三类过程事件** | **首次教学于本篇**：`branch_taken`（路由）/ `iteration_item`（进度）/ `retrieval`（引用），均为旁路信息、不进 `outputs` |
| **12 个运算符的中文标签与一元运算符隐藏 value** | **首次教学于本篇（前端视角）**：标签顺序与契约枚举一致；`is_empty` / `is_not_empty` 不显示比较值 |
