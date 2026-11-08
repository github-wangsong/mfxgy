# 02 · NestJS 条件边与变量聚合（分支与循环）

> 阶段 8 · 第 2 步
>
> 做完：`condition` 节点按数组顺序匹配第一个分支，发一次 `branch_taken`，条件边路由到对应 `sourceHandle` 的下游；`aggregator` 在多条分支汇合后按顺序取第一个非空值。
>
> **本篇面试考点**：LangGraph 节点为什么不能“自己决定下一跳” · 节点写状态 + 条件边读状态的两段式路由 · `tryRenderTemplate` 为什么只给分支用 · `Number('')` 在比较里的陷阱 · `is_empty` 不 trim 的取舍 · 聚合为什么输出扁平对象 · 多分支汇合（fan-in）的执行语义 · `branch_taken` 为什么每节点只发一次。

---

## 1. 静态图上的动态分支

LangGraph 的边有两类：

```text
addEdge(a, b)                          固定边：a 执行完必到 b
addConditionalEdges(a, router, mapping) 条件边：a 执行完后调用 router(state)，按返回值查 mapping
```

关键限制：**节点函数不能“返回下一跳”**。节点只能返回状态更新，路由由 `router(state)` 决定。

所以 `condition` 的实现被拆成两段：

```text
第 1 段：runConditionNode 计算匹配结果，写回 branches[nodeId] = caseId
第 2 段：router(state) 读 branches[nodeId]，mapping 查表得到 target
```

```text
        runConditionNode                    router
        ┌──────────────────┐        ┌────────────────────────┐
state → │ 第一个匹配 → "vip"│ → state → │ state.branches["c1"]   │ → mapping["vip"] → 下游
        └──────────────────┘        └────────────────────────┘
```

> **面试考点 · 为什么不让节点直接返回 target？**
> 因为 LangGraph 的执行模型是“**节点只改状态，拓扑决定流向**”：
>
> - 如果节点能任意跳转，图就不再是可静态分析的 DAG/环，无法做编译期检查、无法画出确定的图；
> - 状态更新是**可合并**的（reducer），路由是**确定函数**，两者分离才能保证同状态必然同路径。
>
> 这也是工作流引擎（Temporal、Airflow）的通用模式：**业务逻辑产出“决策数据”，调度器根据“决策数据”选边。**

---

## 2. 状态：`branches`

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（注解定义）

```ts
/**
 * 变量池状态注解：`pool` 用「合并」reducer，节点返回 `{ pool: { <nodeId>: <output> } }`
 * 逐步累积；初始输入 `{ pool: { inputs } }` 先与默认空对象合并。
 *
 * 阶段 6 另加三份**按节点 id 隔离**的状态（同样用「合并」reducer，键为节点 id）：
 * - `messages`：启用了工具的 `llm` 节点自己的消息数组（多轮共享同一份）；
 * - `rounds`：该节点已执行的工具轮次数（从 1 开始计）；
 * - `toolCalls`：上一轮 LLM 产出的、尚未执行的工具调用（条件边的路由依据）。
 *
 * 阶段 8 另加 `branches`（键为 `condition` 节点 id，值为选中的 `caseId` 或 `"else"`），
 * 作为 `condition` 节点条件边的路由依据。
 */
const RunState = Annotation.Root({
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  // ...
  branches: Annotation<Record<string, string>>({
    reducer: (previous: Record<string, string>, update: Record<string, string>) => ({
      ...previous,
      ...update,
    }),
    default: () => ({}),
  }),
})
```

为什么 `branches` 也要按节点 id 隔离：

- 一张图可以有多个 `condition` 节点；
- 如果只有一个全局 `matched`，后执行的会覆盖先执行的；
- 用 `Record<nodeId, caseId>` 后，各节点的决策互不干扰。

> **面试考点 · 为什么不用节点输出（`pool[nodeId].matched`）当路由依据？**
> 技术上可以：`router` 也能读 `state.pool[nodeId].matched`。
> 单独放 `branches` 的理由：
>
> - `pool` 是**暴露给模板的变量池**（用户可以在 prompt 里写 `{{ c1.matched }}`），而路由是**引擎内部状态**；
> - 内部状态不该污染用户可见的变量空间；
> - 将来改路由实现（比如多分支并行）不影响 `pool` 的形状。
>
> **内部状态与用户可见输出要分开存放**，这是引擎设计的基本卫生。

---

## 3. `condition` 节点

**完整文件路径：`apps/api-ts/src/engine/nodes/condition.node.ts`**

```ts
import type { ConditionCase, ConditionNodeData, ConditionOperator, GraphNode } from '@mini-dify/contract'

import { tryRenderTemplate, type Pool } from '../template'

/**
 * `condition` 节点（阶段 8）：按 `data.conditions` **数组顺序**取第一个匹配的分支，
 * 全部不匹配走 `else`；返回 `{ matched }` 并回调发一次 `branch_taken`。
 *
 * `variable` / `value` 都用**分支安全**解析（`tryRenderTemplate`）：路径缺失视为空串，
 * 因为分支未执行时对端变量本就不存在（见 sse-events.md §4.1）。
 */
export function runConditionNode(
  node: GraphNode,
  pool: Pool,
  emitBranchTaken: (caseId: string, label: string) => void,
): Record<string, unknown> {
  const data = node.data as unknown as ConditionNodeData
  for (const condition of data.conditions) {
    if (matches(condition, pool)) {
      // `label` 在契约里是必填，但缺省时统一降级为空串（两端一致，避免 TS 省略键 / Python KeyError 分叉）
      emitBranchTaken(condition.id, condition.label ?? '')
      return { matched: condition.id }
    }
  }
  emitBranchTaken('else', 'else')
  return { matched: 'else' }
}

/** 单条条件是否成立；`value` 缺省时按空串参与比较。 */
function matches(condition: ConditionCase, pool: Pool): boolean {
  const left = tryRenderTemplate(condition.variable, pool)
  const right = condition.value === undefined ? '' : tryRenderTemplate(condition.value, pool)
  return applyOperator(condition.operator, left, right)
}

/** 运算符语义（两端一致，见 sse-events.md §4）。 */
function applyOperator(operator: ConditionOperator, left: string, right: string): boolean {
  switch (operator) {
    case 'equals':
      return left === right
    case 'not_equals':
      return left !== right
    case 'contains':
      return left.includes(right)
    case 'not_contains':
      return !left.includes(right)
    case 'starts_with':
      return left.startsWith(right)
    case 'ends_with':
      return left.endsWith(right)
    case 'is_empty':
      return left === ''
    case 'is_not_empty':
      return left !== ''
    case 'gt':
      return compareNumbers(left, right, (a, b) => a > b)
    case 'gte':
      return compareNumbers(left, right, (a, b) => a >= b)
    case 'lt':
      return compareNumbers(left, right, (a, b) => a < b)
    case 'lte':
      return compareNumbers(left, right, (a, b) => a <= b)
  }
}

/** 数字比较：任一侧不是有限数字时为 `false`。 */
function compareNumbers(
  left: string,
  right: string,
  predicate: (a: number, b: number) => boolean,
): boolean {
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false
  }
  return predicate(a, b)
}
```

### 3.1 运算符语义

| 运算符 | 语义 | 例（left / right → 结果） |
| --- | --- | --- |
| `equals` | 字符串完全相等 | `"vip" / "vip"` → true |
| `not_equals` | 不等 | `"vip" / "svip"` → true |
| `contains` | 子串包含 | `"hello world" / "world"` → true |
| `not_contains` | 不包含 | `"abc" / "z"` → true |
| `starts_with` | 前缀 | `"refund" / "ref"` → true |
| `ends_with` | 后缀 | `"refund" / "und"` → true |
| `is_empty` | 等于空串 | `"" / *` → true |
| `is_not_empty` | 非空串 | `"x" / *` → true |
| `gt/gte/lt/lte` | 数值比较 | `"10" / "9"` → `gt` true |

**所有比较都是字符串层面的**（除了数值比较）。所以：

```text
"10" > "9"      → 字符串比较为 false（'1' < '9'）
Number("10") > Number("9") → true
```

`gt/gte/lt/lte` 必须先转数字。

### 3.2 数字比较的边界

```ts
const a = Number(left)
const b = Number(right)
if (!Number.isFinite(a) || !Number.isFinite(b)) return false
```

`Number()` 的行为（与 Python 需逐项对齐）：

| 输入 | `Number(x)` | `Number.isFinite` |
| --- | --- | --- |
| `"10"` | 10 | true |
| `" 10 "` | 10 | true（自动去空白） |
| `""` | **0** | true ⚠️ |
| `"abc"` | `NaN` | false |
| `"1e3"` | 1000 | true |
| `"0x10"` | 16 | true |
| `"Infinity"` | Infinity | false |

**`Number("") === 0` 是最大的坑**：

```text
{ operator: "lt", variable: "{{ inputs.missing }}", value: "0" }
```

- `inputs.missing` 不存在 → `left = ""`；
- `Number("") = 0`，`Number("0") = 0`；
- `0 < 0` → false（这次“恰好”安全）。

但换成 `lte`：

```text
0 <= 0 → true
```

**“变量缺失”被当成了“值为 0”**，分支会走错。

> **面试考点 · 这算 bug 吗？**
> 算“已知边界”，而且是**契约层面的决策**：
>
> - 选 A：空串在数值比较中视为 `NaN` → 一律 false（更安全）；
> - 选 B：按 `Number('')` 的 JS 语义 → 0（跨语言难对齐，Python `int('')` 直接抛错）。
>
> 当前实现是 B（直接复用 `Number`），因为要同时照顾两端与“用户可能真的想比较 0”。
> 正确做法是文档化 + 前端引导（数值比较时给 `value` 预填 `0`，避免用户留空）。
> **面试时要能说出这个坑，而不是说“我的实现没 bug”。**

### 3.3 `is_empty` 不 trim

```ts
case 'is_empty':
  return left === ''
```

`"   "`（三个空格）**不算空**。

取舍：

- `trim()` 后判断更符合“用户直觉”；
- 但模板渲染后的空格可能是有意义的（比如 `value: " "` 的比较）；
- Python 侧 `str.strip()` 与 JS `trim()` 的空白集合不完全相同（`\u00A0` 等）。

当前选择“严格空串”，两端都只判 `=== ''` / `== ""`，**行为可预测**。
前端可以在保存时提示“是否想用 is_empty？注意空白字符不算空”。

### 3.4 分支安全模板

**完整文件路径：`apps/api-ts/src/engine/template.ts`**（`tryRenderTemplate`）

```ts
/**
 * 安全解析（分支安全，见 sse-events.md §4.1）：路径不存在或类型不符时返回 `fallback`
 * （默认空串），**不抛错**。
 *
 * 与 `renderTemplate` 的区别只有「缺失时的行为」：模板内的路径缺失**只替换为空串**，
 * 模板其余文本原样保留；字符串化规则与 `renderTemplate` 完全一致。
 * 仅用于 `condition` / `aggregator`（以及 `iteration.inputArray`）——
 * 分支未执行时对端变量本就不存在，其余节点仍走 `renderTemplate`（缺失即 `RunError`）。
 */
export function tryRenderTemplate(text: string, pool: Pool, fallback = ''): string {
  return text.replace(TEMPLATE_PATTERN, (_match: string, rawPath: string) => {
    const resolved = tryResolvePath(rawPath.trim(), pool)
    return resolved.found ? stringifyValue(resolved.value) : fallback
  })
}
```

为什么分支必须“安全”：

```text
condition c1 的分支 vip  → llm_vip  → pool["llm_vip"].text
                        分支 else → llm_normal → pool["llm_normal"].text
aggregator 汇合：values: ["{{ llm_vip.text }}", "{{ llm_normal.text }}"]
```

运行时只有一个分支执行，**另一个变量永远不存在**。

- 用 `renderTemplate`：缺失即抛 `RunError` → 汇合必失败；
- 用 `tryRenderTemplate`：缺失当空串 → 取第一个非空值，天然选出“执行过的那个”。

> **面试考点 · 为什么不让 `renderTemplate` 全局改成“缺失当空串”？**
> 因为那会让**真正的配置错误静默通过**：
>
> ```text
> llm1.prompt = "{{ inputs.qustion }}"   // 拼错
> ```
>
> 运行时渲染成 `""`，模型收到空问题，用户只看到“答非所问”，排查成本极高。
> 所以：
>
> - **主干节点**：缺失即报错（快速失败）；
> - **分支节点**：缺失当空串（本来就可能不存在）。
>
> 这是“**对不同上下文采用不同严格度**”的典型例子，不能一刀切。

---

## 4. 图接线

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`runGraph` 节选）

```ts
    // condition 节点：普通出边改为「按 sourceHandle 分派」的条件边
    const conditionNodes = graph.nodes.filter((node) => node.type === 'condition')
    // ...
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
      // ...
      for (const node of conditionNodes) {
        // 路由读节点写回的 `branches[nodeId]`，mapping 由 precheck 保证每个分支都有目标
        builder.addConditionalEdges(
          node.id,
          (state: RunStateValue) => state.branches[node.id] ?? 'else',
          branchTargets(graph, node),
        )
      }
```

两个要点：

1. **必须跳过普通边**：如果既 `addEdge(c1, a1)` 又 `addConditionalEdges(c1, ...)`，LangGraph 会**两条都走**（并行），分支就变成了“全都执行”；
2. **`?? 'else'` 只是防御**：理论上 `runConditionNode` 一定写回，`else` 但状态合并顺序异常时兜底。

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`branchTargets`）

```ts
/** 条件边的路由表：`caseId -> target`，外加 `else -> target`（预检保证每条都存在）。 */
function branchTargets(graph: Graph, node: GraphNode): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const condition of conditionCases(node)) {
    const edge = graph.edges.find(
      (candidate) => candidate.source === node.id && candidate.sourceHandle === condition.id,
    )
    if (edge !== undefined) {
      paths[condition.id] = edge.target
    }
  }
  const elseEdge = graph.edges.find(
    (candidate) => candidate.source === node.id && candidate.sourceHandle === 'else',
  )
  if (elseEdge !== undefined) {
    paths.else = elseEdge.target
  }
  return paths
}
```

`mapping` 的键必须**覆盖 router 所有可能返回值**。预检（规则 8.1.5/8.1.6）保证：

- 每个 `caseId` 都有边 → `paths[caseId]` 存在；
- `else` 有边 → `paths.else` 存在。

如果没预检、`mapping` 缺键，LangGraph 会抛 `InvalidUpdateError` 或走到 `END`（取决于版本）——这属于“运行时才发现的配置错误”，正是预检要消灭的。

> **面试考点 · 多分支汇合（fan-in）是怎么工作的？**
> ```text
> c1 --vip--> a1 --┐
>    --else--> a2 --┴--> aggregator
> ```
> LangGraph 的语义：
>
> - `c1` 只走一条分支（条件边）；
> - 该分支执行完，到 `aggregator` 只有**一条活跃路径**；
> - `aggregator` 在收到这条路径后即可执行（不需要等“另一条永远不会来的路径”）。
>
> 所以**不需要**显式的 join 语义（不像 BPMN 的并行网关）。
> 只有当**同一个节点被多条路径同时到达**（比如两个分支都连到同一个 `end`）时，LangGraph 才会在 superstep 里合并执行——这属于并行分支，本项目不支持（`condition` 只选一条）。

---

## 5. `aggregator` 节点

**完整文件路径：`apps/api-ts/src/engine/nodes/aggregator.node.ts`**

```ts
import type { AggregatorNodeData, GraphNode } from '@mini-dify/contract'

import { tryRenderTemplate, type Pool } from '../template'

/**
 * `aggregator` 节点（阶段 8）：对每个 `name`，按 `values` 顺序用**分支安全**解析取
 * **第一个非空串**；全部为空时取 `""`。
 *
 * 输出为**扁平对象** `{ "<name>": "<值>", ... }`（不做 `outputs` 包装）。
 * 未执行分支的变量在这里不存在，安全解析保证不报错（见 sse-events.md §4.1）。
 */
export function runAggregatorNode(node: GraphNode, pool: Pool): Record<string, unknown> {
  const data = node.data as unknown as AggregatorNodeData
  const output: Record<string, unknown> = {}
  for (const item of data.outputs) {
    let value = ''
    for (const template of item.values) {
      const rendered = tryRenderTemplate(template, pool)
      if (rendered !== '') {
        value = rendered
        break
      }
    }
    output[item.name] = value
  }
  return output
}
```

### 5.1 为什么输出是扁平的

```json
{ "answer": "已为您退款", "source": "vip" }
```

而不是：

```json
{ "outputs": [{ "name": "answer", "value": "..." }] }
```

理由：下游模板要能直接写：

```text
{{ agg1.answer }}
```

扁平结构让变量池的形状与“用户心智”一致。
`outputs` 是**配置结构**（数组、有序、可重复 name），`pool` 是**取值结构**（对象、按键访问）。
**配置与数据用不同形状，是引擎设计的常见做法。**

> **注意**：如果 `outputs` 里有重复 `name`，后面的会覆盖前面的（对象键唯一）。
> 契约没有禁止重复 `name`——这是一个已知缺口，前端应去重，或后端加校验。

### 5.2 “第一个非空”而不是 null 合并

| 方案 | 行为 | 问题 |
| --- | --- | --- |
| 第一个非空串（本项目） | `""` 视为空 | 无法区分“分支显式输出空串”与“分支未执行” |
| 第一个“路径存在”的值 | 判断存在性 | 分支输出空串时会被选中，可能不是用户想要的 |
| 显式 `null` | 需要节点能输出 null | `end.node` 目前只输出字符串 |

本项目的取舍：**空串 = 没有值**。

后果：

- 如果某个分支**真的**输出空串（比如 `end.outputs` 渲染为 `""`），聚合会跳过它；
- 但“分支未执行”也表现为空串，两者不可区分。

> **面试考点 · 这是不是一个设计缺陷？**
> 是**已知限制**，根源是“变量池里没有‘未定义’的表达”。
> 更严谨的做法是：
>
> - 聚合读 `pool` 时判断 `key in pool`（存在性），而不是比较渲染结果；
> - 或给每个分支输出加 `{ executed: true, value: "" }`。
>
> 当前实现选择了**简单且可预测**：模板渲染结果为空即跳过。
> 面试时能指出“存在性 vs 空值”的区别，比说“我的实现完美”更有说服力。

### 5.3 引擎挂载与事件

```ts
      case 'condition':
        return runConditionNode(node, pool, (caseId, label) =>
          queue.emit(branchTaken(node.id, caseId, label)),
        )
      case 'aggregator':
        return runAggregatorNode(node, pool)
```

事件：

```ts
/** 构造 `branch_taken` 事件（`condition` 节点每节点只发一次）。 */
export function branchTaken(nodeId: string, caseId: string, label: string): RunEvent {
  return { event: 'branch_taken', data: { nodeId, caseId, label } }
}
```

事件序：

```text
node_started   c1
branch_taken   { nodeId: "c1", caseId: "vip", label: "VIP 用户" }
node_finished  c1  { matched: "vip" }
node_started   a1
...
```

> **面试考点 · `branch_taken` 为什么每节点只发一次？**
> 因为 `condition` 只选**一条**分支。
> 如果每匹配一个分支就发一次（比如“命中多个也只记日志”），前端就无法用“最后一条 `branch_taken`”判断实际走向。
> **事件语义要与业务语义一致**：`branch_taken` = 实际选择的那条，不是“所有命中的”。

---

## 6. 预检

**完整文件路径：`apps/api-ts/src/engine/engine.service.ts`**（`validateNodeData` 节选）

```ts
    } else if (node.type === 'condition') {
      const data = (node.data ?? {}) as Record<string, unknown>
      if (!Array.isArray(data.conditions)) {
        errors.push(`condition node ${node.id} must have at least one condition`)
      }
    } else if (node.type === 'aggregator') {
      const data = (node.data ?? {}) as Record<string, unknown>
      if (!Array.isArray(data.outputs) || data.outputs.length === 0) {
        errors.push(`aggregator node ${node.id} must have at least one output`)
      }
      // ...
```

注意与**图校验**的分工：

| 检查 | 图校验（保存） | 预检（运行） |
| --- | --- | --- |
| `conditions` 非空 | ✓（并检查出边） | ✓（类型/空） |
| 运算符合法 | ✓ | ✗（图校验已保证） |
| `outputs` 非空 | ✓ | ✓ |

运行时再查一遍类型，是因为 `graph_json` 可能来自旧数据或手工修改。
**预检不信任数据库里的图，只信任自己刚校验过的图。**

---

## 7. 验证

### 7.1 图

```text
start → c1 ─(vip)──→ llm_vip ────┐
          └(else)──→ llm_else ───┴→ agg1 → end1
```

`c1.data.conditions`：

```json
[
  { "id": "vip", "label": "VIP 用户", "variable": "{{ inputs.level }}", "operator": "equals", "value": "vip" },
  { "id": "high", "label": "高额", "variable": "{{ inputs.amount }}", "operator": "gt", "value": "1000" }
]
```

`agg1.data.outputs`：

```json
[
  { "name": "answer", "values": ["{{ llm_vip.text }}", "{{ llm_else.text }}"] },
  { "name": "level", "values": ["{{ inputs.level }}"] }
]
```

### 7.2 三种输入

```powershell
# level=vip → 走 vip
curl.exe -s -N -X POST http://localhost:3001/apps/<APP_ID>/run `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" `
  -d '{"inputs":{"level":"vip","amount":"500"}}'
# 期望：branch_taken caseId=vip，只有 llm_vip 的 token

# level=normal, amount=2000 → 没有匹配 vip（equals 失败），也没有匹配 high？
# 注意：high 的 variable 是 amount，conditions 数组顺序为 [vip, high]
# amount=2000 gt 1000 → 命中 high
curl.exe -s -N ... -d '{"inputs":{"level":"normal","amount":"2000"}}'
# 期望：branch_taken caseId=high

# level=normal, amount=500 → 全部不匹配 → else
curl.exe -s -N ... -d '{"inputs":{"level":"normal","amount":"500"}}'
# 期望：branch_taken caseId=else，label=else
```

### 7.3 输出

`en1.data.outputs`：

```json
[
  { "name": "answer", "value": "{{ agg1.answer }}" },
  { "name": "level", "value": "{{ agg1.level }}" }
]
```

检查 `node_finished(agg1).output`：

```json
{ "answer": "echo: ...", "level": "vip" }
```

**未执行分支的 `llm_else` 没有 token 事件**，`answer` 取的是 `llm_vip.text`。

### 7.4 顺序验证

把 `conditions` 顺序改成 `[high, vip]`，输入 `level=vip, amount=2000`：

- 现在先判断 `high` → 命中 → `caseId=high`；
- **同一张图、同一输入，只改数组顺序，结果不同**——这就是“按数组顺序”的含义。

### 7.5 数字比较

```text
amount = "2000", operator = gt, value = "1000"  → true
amount = "abc",  operator = gt, value = "1000"  → false（NaN）
amount = "",     operator = lte, value = "0"    → true（Number("") === 0，已知坑）
```

### 7.6 与 Python 对比

同一张图分别跑两端，比对：

- `branch_taken` 的 `caseId` 与 `label`；
- 是否只有一条分支产生 `token`；
- `aggregator` 的 `output`；
- 错误图的 400 文案。

---

## 8. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 节点不能返回下一跳 | 节点只改状态，拓扑决定流向；可静态分析 |
| 两段式路由 | 节点写 `branches[nodeId]`，路由函数读它 |
| 为什么单独存 `branches` | 内部状态不污染用户变量池 |
| 必须跳过普通边 | 否则条件边与固定边同时生效 → 并行执行 |
| `mapping` 必须覆盖所有返回值 | 否则运行时 `InvalidUpdateError` |
| 分支安全模板 | 分支未执行时变量不存在；主干仍严格 |
| `Number("") === 0` | 数值比较的空值陷阱；跨语言需明确 |
| `is_empty` 不 trim | 可预测优先；空白字符不等于空 |
| 聚合“第一个非空” | 简单可预测；无法区分“未执行”与“输出空串” |
| 扁平输出 | 配置是数组，数据是对象 |
| 重复 `name` | 后者覆盖前者（已知缺口） |
| `branch_taken` 一次 | 事件表示“实际选择”，不是“所有命中” |
| fan-in 语义 | 条件边只走一条，聚合节点无需等待 |
| 预检再查类型 | 不信任 `graph_json` 历史数据 |

---

## 9. 下一步

- `03-迭代节点与跨语言数值对齐.md`：`iteration` 的 state、`itemIndex/itemCount`、`results/count/joined`，以及 `1.0` → `"1"` 的跨语言分叉。
- `04-前端多出口Handle与分支面板.md`：多 handle 节点渲染、分支编辑、连线校验。
- `05-验收.md`：分支/聚合/迭代用例矩阵。
