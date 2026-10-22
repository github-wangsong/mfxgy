# 02 · NestJS：条件边与变量聚合

> 所属：阶段 8 · 条件 / 变量 / 迭代
> 本篇覆盖：`condition` 节点（判定 + 选中分支）、`aggregator` 节点（多路变量取第一个非空）、`tryRenderTemplate`（分支安全解析）、引擎里的 `branches` 状态与「多出口条件边」建图、`branch_taken` 事件，以及一张「一分二再合」的图的完整实测。
> **本篇首次教学（本阶段的学习核心）：① 同一个 `addConditionalEdges` 的两种用途——阶段 6 的「ReAct 单出口判断」与本篇的「多出口分支」，以及两者 `mapping` 形状的差异；② 多出口条件边的 `mapping = { [caseId]: target, else: elseTarget }`，且每个 key 都必须出现（由预检保证有边）；③ `condition` 节点的普通出边必须跳过（与阶段 6 同类陷阱，但原因不同：`addEdge` 会无视 `sourceHandle` 把每条分支都当并行边）；④ `branches` 状态（`Annotation<Record<nodeId, matched>>` + 合并 reducer）——**节点算结果、条件边只做路由**；⑤ `branch_taken` 为什么必须在节点内发（顺序 + router 保持纯函数）；⑥ `tryRenderTemplate` 与「分支安全的变量解析」（未执行分支的变量必然缺失，严格解析会让 `aggregator` 直接崩）；⑦ 「路径缺失 → `''`」与「值真的是 `null` → `"null"`」的边界；⑧ `aggregator` 的取第一个非空算法与**扁平输出**；⑨ 为什么必须扁平（模板只支持点路径，`resolvePath` 明确拒绝数组下钻）。**
> **不重讲**：`StateGraph` / `Annotation` / reducer / 动态建图见 `04-执行引擎/02-LangGraph编译图-TS.md`；条件边的基本用法、「跳过普通边」的陷阱、环与 `recursionLimit` 见 `06-工具调用/02-NestJS-ReAct循环与条件边.md`；变量池、模板解析与「节点 = 纯函数」见 `04-执行引擎/03-节点运行时与变量池.md`；SSE 帧格式与「先校验、后开流」见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；图语义校验的规则 8/9（文案与顺序）见本阶段第 `01` 篇（契约与校验）；`iteration` 节点见本阶段 Python / 前端篇与迭代专篇。

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 本篇在阶段 8 的位置

阶段 7 之前，图只能「一条路走到底」：`llm` 节点虽然可以靠 ReAct 条件边在「调工具 / 不调工具」之间二选一，但那是**节点内部的出口判断**，不是图上的业务分支。阶段 8 给图加了三种新节点：

| 节点 | 作用 | 一句话 |
| --- | --- | --- |
| `condition` | 按条件把执行流**分到不同下游** | 「如果 topic 含『很好』走好评分支，否则走 else」 |
| `aggregator` | 把**多条可能路径**上的变量**汇总成一个值** | 「好评分支的输出或差评分支的输出，谁有内容取谁」 |
| `iteration` | 对一个数组**逐项**处理（节点内部循环） | 不属于本篇 |

本篇只讲前两个（`iteration` 单独成篇）。它们通常成对出现，构成一张「**一分二、再合流**」的图：

```
                    ┌─ good ─→ llm1  (好评回复) ─┐
start_1 → c1 ───────┤                             ├─→ agg1 → end_1
                    └─ else ─→ else1 (差评回复) ──┘
```

**为什么必须先有 `condition` 才有 `aggregator`**：分支之后，**同一时刻只有一条路被执行**，另一条路上的节点**根本不会写变量池**。所以合流点拿到的池子里，必然有一半变量「不存在」。这正是本篇最重要的工程思想——**分支安全的变量解析**——的由来。

阶段 8 的三件新事在引擎里都只占很小的增量：

| 引擎增量 | 位置 | 本篇小节 |
| --- | --- | --- |
| `branches` 状态 + 多出口条件边 | `engine.service.ts` | §8、§11~§13 |
| `condition` / `aggregator` 分派 | `engine.service.ts` 的 `executeNode` | §8.4 |
| 分支安全解析 | `template.ts` 的 `tryRenderTemplate` | §7、§15 |

---

## 1. 本篇目标

- 能说清「多出口条件边」与阶段 6 的「单出口判断」用的是**同一个 API**，只是 `mapping` 的形状不同。
- 能独立写出 `branchTargets()`，并解释为什么它的 key 集合恰好等于 `{caseIds} ∪ {else}`。
- 能解释「不跳过 `condition` 节点的普通出边」会发生什么，以及为什么原因与阶段 6 不同。
- 能说清 `branches` 这份状态为什么存在、谁写谁读、为什么用「按节点 id 的合并 reducer」。
- 能说清 `branch_taken` 为什么不能在 router 里发（两条理由：事件顺序 + 纯函数）。
- 能解释 `tryRenderTemplate` 与 `renderTemplate` 的**唯一区别**，以及为什么分支场景必须用它。
- 能说清「路径缺失 → `''`」与「值真的是 `null` → `"null"`」为什么必须区分。
- 能独立复述 `aggregator` 的算法（按 `values` 顺序取第一个非空）并解释为什么输出是扁平的。

**验收标准**

1. `pnpm run build:contract` 与 `pnpm --filter @mini-dify/api-ts build` 均通过。
2. `topic="服务很好"` 的运行里，`c1` 的 `branch_taken` 为 `{"nodeId":"c1","caseId":"good","label":"好评"}`，且**只有好评分支的 `llm` 产生事件**，差评分支零事件（§18.1）。
3. `topic="服务很差"` 的运行里，`branch_taken` 的 `caseId`/`label` 都是 `"else"`，且只执行 else 分支（§18.2）。
4. 合流图在两种输入下，`aggregator` 都**不报错**：`node_finished.output` 分别为 `{"answer":"echo: PRAISE 服务很好"}` / `{"answer":"echo: COMPLAIN 服务很差"}`（§18.3）。
5. 两套后端跑同一张图：事件名序列、payload 键集合、`node_finished.output`、`run_finished.outputs` **完全一致**，仅 `runId` / `elapsedMs` / `usage` 的数值不同（§18.4）。

---

## 2. 前置条件

- 阶段 3/4 已完成：`Graph` 的 JSON 模型与 `validateGraph`；`engine.service.ts` 能把图编译成 LangGraph 并输出 SSE。
- 阶段 6 已完成：读过 `addConditionalEdges`、`pathMap`、「跳过普通边」与 `recursionLimit`（本篇只做对照，不重讲）。
- 本阶段第 `01` 篇已完成：契约里有 `condition` / `aggregator` / `iteration` 节点类型、`ConditionCase` 的 12 个运算符、`branch_taken` 事件；`validateGraph` 的规则 8/9（分支边缺失、`else` 边缺失、`sourceHandle` 非法、同一分支多条边）。
- `apps/api-ts/.env` 已能指向 mock LLM（无真实密钥也能跑），配置见阶段 5 · 04：

```dotenv
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=test
LLM_MODEL=mock-model
LLM_TIMEOUT_MS=3000
```

---

## 3. 命令清单

> 除特别注明外，命令均在仓库根 `d:\user\my_project\github\mini-dify` 执行。Windows PowerShell 的续行符是反引号 `` ` ``。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 编译契约（`ConditionNodeData` / `AggregatorNodeData` / `branch_taken`） | 无报错 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 编译 NestJS（条件边、安全解析、两个新节点） | 无报错 |
| `node tools/mock-llm/server.mjs` | 仓库根 | 起 mock provider（**另开一个终端**） | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| `pnpm --filter @mini-dify/api-ts start:dev` | 仓库根 | 启动 api-ts | 监听 `http://localhost:3001` |
| `curl.exe -N -X POST .../apps/{id}/run` | 任一端 | 逐帧看分支与聚合 | `branch_taken` 一帧，只有一个分支的 `llm` 事件 |
| 改 `inputs.topic` 再跑一次 | 任一端 | 验证 else 分支与聚合兜底 | 另一条分支被选中，聚合仍只有一个答案 |

---

## 4. 先看清：一张「一分二再合流」的图

本篇的实测图（**同构于**你要验收的图；`position` 只为画布好看，引擎不读）：

```jsonc
{
  "version": "1",
  "nodes": [
    { "id": "start_1", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "inputs": [{ "name": "topic", "required": true }] } },

    { "id": "c1", "type": "condition", "position": { "x": 120, "y": 0 },
      "data": {
        "title": "分类",
        "conditions": [
          { "id": "good", "label": "好评",
            "variable": "{{ inputs.topic }}",
            "operator": "contains", "value": "很好" }
        ]
      } },

    { "id": "llm1", "type": "llm", "position": { "x": 240, "y": -60 },
      "data": { "title": "好评回复", "prompt": "PRAISE {{ inputs.topic }}" } },

    { "id": "else1", "type": "llm", "position": { "x": 240, "y": 60 },
      "data": { "title": "差评回复", "prompt": "COMPLAIN {{ inputs.topic }}" } },

    { "id": "agg1", "type": "aggregator", "position": { "x": 360, "y": 0 },
      "data": {
        "title": "汇总",
        "outputs": [
          { "name": "answer", "values": ["{{ llm1.text }}", "{{ else1.text }}"] }
        ]
      } },

    { "id": "end_1", "type": "end", "position": { "x": 480, "y": 0 },
      "data": { "outputs": [{ "name": "result", "value": "{{ agg1.answer }}" }] } }
  ],
  "edges": [
    { "id": "e1", "source": "start_1", "target": "c1" },
    { "id": "e2", "source": "c1", "target": "llm1",  "sourceHandle": "good"  },
    { "id": "e3", "source": "c1", "target": "else1", "sourceHandle": "else"  },
    { "id": "e4", "source": "llm1",  "target": "agg1" },
    { "id": "e5", "source": "else1", "target": "agg1" },
    { "id": "e6", "source": "agg1",  "target": "end_1" }
  ]
}
```

**这张图里藏着的四个关键事实**：

| 事实 | 含义 |
| --- | --- |
| `c1` 有两条「概念上的出边」 | `good`、`else` 各一条；数组里也是两条边（`e2`、`e3`），**`else` 不是条件，没有对应的 `ConditionCase`** |
| 分支靠 `edge.sourceHandle` 标识 | `sourceHandle === "good"` 表示「选中 good 时走这条」；`"else"` 是保留字 |
| `llm1` / `else1` 的普通出边都指向 `agg1` | 它们是**普通边**，照常参与建图 |
| `agg1` 引用了两条分支的变量 | 但运行时只有一条分支有值——这就是 §15 要解决的问题 |

一图两景：

```
topic="服务很好"：start_1 → c1(good) → llm1 → agg1 → end_1     （else1 不执行）
topic="服务很差"：start_1 → c1(else) → else1 → agg1 → end_1    （llm1 不执行）
```

---

## 5. 完整代码：`condition` 节点（condition.node.ts）

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

**逐行读法**：

| 位置 | 做了什么 | 为什么 |
| --- | --- | --- |
| `for (const condition of data.conditions)` | 按**数组顺序**遍历 | 顺序就是优先级；第一条命中即停，后面的条件**不再求值** |
| `matches(...)` 为真 → `emitBranchTaken` + `return { matched: condition.id }` | 选中该分支 | `matched` 是 `caseId`，**恰好等于**该分支出边的 `sourceHandle` |
| 全部不匹配 → `emitBranchTaken('else','else')` | 兜底 | `else` 是**虚拟分支**：不在 `conditions` 里，但必须在图上有边（校验 8.1.6） |
| `tryRenderTemplate(condition.variable, …)` | 分支安全解析左值 | 引用「可能没执行过的节点」时不会抛错（§15） |
| `condition.value === undefined ? '' : …` | `value` 缺省 → 空串 | `is_empty` 这类只关心左值的运算符可以不写 `value` |
| `applyOperator(...)` | 12 个运算符，全部**字符串语义** | 数字比较先 `Number()` 再比；任一侧不是有限数字 → `false` |

**运算符语义表**（两端逐条一致，真源在 `packages/contract/sse-events.md` §4）：

| 运算符 | 语义 | 注意 |
| --- | --- | --- |
| `equals` / `not_equals` | 字符串全等 / 不等 | 不做类型转换，`"1" !== "1.0"` |
| `contains` / `not_contains` | 子串包含 | 大小写敏感 |
| `starts_with` / `ends_with` | 前缀 / 后缀 | 空串永远为真 |
| `is_empty` / `is_not_empty` | 左值是否为 `""` | 只与 `""` 比，不看 `value` |
| `gt` / `gte` / `lt` / `lte` | 转数字后比较 | 任一侧不是有限数字 → `false`（不是抛错） |

> **一个容易忽略的语义**：`Number('')` 是 `0`、`Number('  ')` 是 `0`。所以 `gt` 在某一侧渲染为空串时会**真的按 0 参与比较**（`"" > "-1"` 为真）。这与「非有限数字一律 `false`」不冲突——空串转出来是有限数字。

---

## 6. 完整代码：`aggregator` 节点（aggregator.node.ts）

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

**只有 15 行，但有三层设计要在 §16、§17 讲透**：

1. `tryRenderTemplate` 而不是 `renderTemplate` —— 分支安全（§15）。
2. 「第一个**非空**」而不是「第一个**存在**」 —— `values` 是**优先级列表**（§16）。
3. 输出**扁平** `{ answer: "..." }`，不是 `{ outputs: [{ name, value }] }`（§17）。

---

## 7. 完整代码：模板解析（template.ts，新增 `tryRenderTemplate`）

这个文件在阶段 4 就已经存在，阶段 8 只**加了一个函数**（以及它的内部辅助函数）。为了看清「两个函数唯一的差别」，这里给出完整文件。

**完整文件路径：`apps/api-ts/src/engine/template.ts`**

```ts
import { RunError } from './events'

/**
 * 模板解析（引擎语义，两端必须一致，见 sse-events.md §4）。
 *
 * 变量池 `pool` 初始为 `{ "inputs": <RunRequest.inputs> }`，每个节点执行完把自身输出
 * 写入 `pool[<nodeId>]`。字符串里的 `{{ a.b }}`（花括号内允许空格）按点路径取值并替换。
 */

/** 变量池：键为 `inputs` 或节点 id，值为该键下的 JSON 对象。 */
export type Pool = Record<string, unknown>

/** 匹配 `{{ path }}`：花括号内不含花括号，允许首尾空格。 */
const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

/** 把 `text` 中的模板片段按 `pool` 渲染（模板外的文本原样保留）。 */
export function renderTemplate(text: string, pool: Pool): string {
  return text.replace(TEMPLATE_PATTERN, (_match: string, rawPath: string) =>
    stringifyValue(resolvePath(rawPath.trim(), pool)),
  )
}

/** 按点路径从 `pool` 取值；任一段不存在即抛 `RunError`。 */
export function resolvePath(path: string, pool: Pool): unknown {
  let current: unknown = pool
  for (const segment of path.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      throw new RunError(`template variable not found: ${path}`)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

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

/** 按点路径取值；任一段不存在或当前值不是普通对象时返回 `{ found: false }`。 */
function tryResolvePath(path: string, pool: Pool): { found: boolean; value: unknown } {
  let current: unknown = pool
  for (const segment of path.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      return { found: false, value: undefined }
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}

/** 渲染值转字符串：字符串原样，其余按紧凑 JSON 序列化（与 api-py 对齐）。 */
function stringifyValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
```

**看清「唯一差别」**：

| 环节 | `renderTemplate`（严格） | `tryRenderTemplate`（安全） |
| --- | --- | --- |
| 正则 | 同一个 `TEMPLATE_PATTERN` | 同一个 |
| 逐段走点路径 | `resolvePath` | `tryResolvePath` |
| 路径缺失 | **抛** `RunError('template variable not found: {path}')` | 返回 `{found:false}` → 替换为 `fallback`（默认 `''`） |
| 中途遇到数组 / 非对象 | 抛错 | 视为缺失 |
| 值转字符串 | `stringifyValue` | 同一个 `stringifyValue` |
| 结果 | 缺失即整次运行失败 | 只把该片段换成空串，其余文本保留 |

> **注意**：`tryRenderTemplate` **没有**改动 `renderTemplate`。严格解析仍然是 `llm` / `knowledge` / `end` / `iteration.outputTemplate` 的唯一选择。这是**按节点开启**的开关式设计，与阶段 6 的「按节点开启工具条件边」是同一思路。

---

## 8. 引擎增量（engine.service.ts）

`engine.service.ts` 在阶段 6 已完整给出（见 `06-工具调用/02-NestJS-ReAct循环与条件边.md` §8），这里只列阶段 8 的增量，其余不变。

### 8.1 imports（新增项：`ConditionNodeData`、`branchTaken`、`iterationItem`、三个 `run*` 节点函数）

```ts
import type {
  ConditionNodeData,
  Graph,
  GraphNode,
  LlmNodeData,
} from '@mini-dify/contract'
import {
  branchTaken,
  formatSseFrame,
  iterationItem,
  nodeFinished,
  nodeStarted,
  retrieval,
  RunError,
  RunEventQueue,
  runFailed,
  runFinished,
  runStarted,
  token,
  toolCall,
  toolResult,
  type RunEvent,
} from './events'
import { runAggregatorNode } from './nodes/aggregator.node'
import { runConditionNode } from './nodes/condition.node'
import { runIterationNode } from './nodes/iteration.node'
```

### 8.2 `RunState` 新增 `branches` 通道（节选，其余通道不变）

```ts
/**
 * 阶段 8 另加 `branches`（键为 `condition` 节点 id，值为选中的 `caseId` 或 `"else"`），
 * 作为 `condition` 节点条件边的路由依据。
 */
const RunState = Annotation.Root({
  pool: Annotation<Pool>({
    reducer: (previous: Pool, update: Pool) => ({ ...previous, ...update }),
    default: () => ({}),
  }),
  // messages / rounds / toolCalls 不变……
  branches: Annotation<Record<string, string>>({
    reducer: (previous: Record<string, string>, update: Record<string, string>) => ({
      ...previous,
      ...update,
    }),
    default: () => ({}),
  }),
})

type RunStateValue = {
  pool: Pool
  messages: Record<string, BaseMessage[]>
  rounds: Record<string, number>
  toolCalls: Record<string, ToolCallRequest[]>
  branches: Record<string, string>
}
```

### 8.3 建图：收集 `condition` 节点、跳过其普通出边、加多出口条件边（节选，省略处为阶段 6/7 的既有代码）

```ts
    // condition 节点：普通出边改为「按 sourceHandle 分派」的条件边
    const conditionNodes = graph.nodes.filter((node) => node.type === 'condition')
    try {
      const builder = new StateGraph(RunState) as unknown as DynamicStateGraph
      for (const node of graph.nodes) {
        builder.addNode(node.id, this.makeNodeAction(node, context, toolNodes))
      }
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
      const startNode = graph.nodes.find((node) => node.type === 'start') as GraphNode
      builder.addEdge(START, startNode.id)
      for (const node of graph.nodes) {
        if (node.type === 'end') {
          builder.addEdge(node.id, END)
        }
      }
      await builder.compile().invoke(
        { pool: { inputs }, messages: {}, rounds: {}, toolCalls: {}, branches: {} },
        { recursionLimit: Math.max(25, maxRounds * 2 + graph.nodes.length * 3 + 20) },
      )
```

### 8.4 `makeNodeAction`：`condition` 节点把结果写回 `branches`

```ts
        const update: Partial<RunStateValue> = { pool: { [node.id]: output } }
        if (node.type === 'condition') {
          // 供紧随其后的条件边路由（`matched` 即选中分支的 caseId 或 "else"）
          update.branches = { [node.id]: String(output.matched) }
        }
        return update
```

### 8.5 `executeNode`：新增 `condition` / `aggregator` 分派（节选，`knowledge` 分支以注释省略）

```ts
  private async executeNode(
    node: GraphNode,
    pool: Pool,
    queue: RunEventQueue,
  ): Promise<Record<string, unknown>> {
    switch (node.type) {
      case 'start':
        return runStartNode(node, pool)
      case 'llm':
        return runLlmNode(node, pool, (text) => queue.emit(token(node.id, text)))
      case 'knowledge': { /* 不变 */ }
      case 'end':
        return runEndNode(node, pool)
      case 'condition':
        return runConditionNode(node, pool, (caseId, label) =>
          queue.emit(branchTaken(node.id, caseId, label)),
        )
      case 'aggregator':
        return runAggregatorNode(node, pool)
      case 'iteration':
        return runIterationNode(node, pool, (index, total) =>
          queue.emit(iterationItem(node.id, index, total)),
        )
    }
  }
```

对照阶段 6/7：`knowledge` 的分派也是「把 `queue.emit(...)` 作为回调传进节点函数」。这不是巧合——**节点函数保持纯逻辑，事件由引擎注入的 emitter 发**，这样节点可以单测（传一个假的 emitter）。`condition` 用的是同一种模式。

### 8.6 `branchTargets`：从边表生成 `mapping`

```ts
/** `condition` 节点的全部条件（预检已保证非空数组）。 */
function conditionCases(node: GraphNode): ConditionNodeData['conditions'] {
  const data = node.data as unknown as ConditionNodeData
  return Array.isArray(data.conditions) ? data.conditions : []
}

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

### 8.7 `validateNodeData`：两个节点的「字段类型」校验

```ts
    } else if (node.type === 'condition') {
      // 字段类型：条件数组本身（「无语义」的其余规则见 graph.validator.ts §8.1）
      if (!Array.isArray(data.conditions)) {
        errors.push(`condition node ${node.id} must have at least one condition`)
      }
    } else if (node.type === 'aggregator') {
      if (!Array.isArray(data.outputs)) {
        errors.push(`aggregator node ${node.id} must have at least one output`)
        continue
      }
      for (const item of data.outputs) {
        const output = isPlainObject(item) ? item : {}
        if (!Array.isArray(output.values)) {
          const name = typeof output.name === 'string' ? output.name : String(output.name)
          errors.push(`aggregator node ${node.id} output ${name} must have at least one value`)
        }
      }
    }
```

> 这里与 `graph.validator.ts` 的分工：**形状**（是不是数组）在引擎侧 `validateNodeData`；**语义**（条件 id 重复、运算符非法、每条分支必须有边、同一分支只能一条边）在 `validateGraph`。同一条文案只报一次，见 `error-messages.md` §8.1。

### 8.8 没有改的部分

- `RunEventQueue` 与 SSE 帧格式**一字未改**——`branch_taken` 和 `token` 走同一个队列、同一种帧。
- `end` 的输出与 `run_finished.outputs` 的约定未改：`end` 输出 `{ outputs: {...} }`，取拓扑序最后一个。
- 预检仍然「开流前」抛 400：`validateGraph` 的规则 8/9 与 `validateNodeData` 的字段类型一起合并成一条 `message`。

---

## 9. 完整代码：`branch_taken` 构造器（events.ts 增量）

**完整文件路径：`apps/api-ts/src/engine/events.ts`（节选，其余不变）**

```ts
/**
 * 构造 `branch_taken` 事件（`condition` 节点每节点只发一次）。
 */
export function branchTaken(nodeId: string, caseId: string, label: string): RunEvent {
  return { event: 'branch_taken', data: { nodeId, caseId, label } }
}

/** 构造 `iteration_item` 事件（`index` 从 1 开始）。 */
export function iterationItem(nodeId: string, index: number, total: number): RunEvent {
  return { event: 'iteration_item', data: { nodeId, index, total } }
}
```

协议（唯一真源 `packages/contract/sse-events.md` §2）：

| 事件 | 触发时机 | payload |
| --- | --- | --- |
| `branch_taken` | `condition` 节点选中某个分支（**每节点只发一次**） | `nodeId`(string)、`caseId`(string)、`label`(string) |

- `caseId` 是选中的条件 `id`，也就是该分支出边的 `sourceHandle`；
- 全部不匹配时 `caseId === "else"` 且 `label === "else"`；
- `aggregator` **没有**专属事件，事件顺序仍是 `node_started` → `node_finished`。

---

## 10. 【技术教学 · 首次】同一个 `addConditionalEdges`，两种用途

阶段 6 已经讲过条件边的机制（见 `06-工具调用/02-NestJS-ReAct循环与条件边.md` §11）。本篇不重复机制，只把**两次用法**并排摆出来——这是阶段 8 最需要「看穿」的地方。

### 10.1 两份代码并排

**阶段 6（ReAct：单出口判断 + 环）**

```ts
for (const node of toolNodes) {
  const downstream = firstDownstream(graph, node)
  builder.addConditionalEdges(
    node.id,
    (state: RunStateValue) => ((state.toolCalls[node.id] ?? []).length > 0 ? 'tools' : 'continue'),
    { tools: `${node.id}__tools`, continue: downstream },
  )
  builder.addEdge(`${node.id}__tools`, node.id)
}
```

**阶段 8（多出口分支）**

```ts
for (const node of conditionNodes) {
  builder.addConditionalEdges(
    node.id,
    (state: RunStateValue) => state.branches[node.id] ?? 'else',
    branchTargets(graph, node),
  )
}
```

同一个方法、同一个签名（`source`、`router`、`pathMap`），但四个维度全都不一样：

| 维度 | 阶段 6：单出口判断 | 阶段 8：多出口分支 |
| --- | --- | --- |
| `mapping` 的 key 从哪来 | **代码里写死的两个标签**：`tools` / `continue` | **图数据里的 `caseId`** + 保留字 `else` |
| `mapping` 的大小 | 固定 2 个 | `conditions.length + 1`（每个分支一条） |
| `mapping` 的 key 是什么 | 「语义标签」，与节点 id 无关 | 「分支标识」，**必须等于边的 `sourceHandle`** |
| `router` 返回值 | 布尔式判断的结果（调不调工具） | 节点**已经算好**的分支（`branches[nodeId]`） |
| `router` 读什么 | `state.toolCalls[nodeId]`（本轮 LLM 产出） | `state.branches[nodeId]`（本节点刚写入） |
| 目标的性质 | 一个内部节点 / 一个原下游 | 每条分支各自的下游 |
| 图里有环吗 | 有（`__tools → llm`） | 无（阶段 8 的分支是 DAG 上的扇出） |
| 下游个数 | 1（`continue` 只能去一个） | N（一次只走一个，但**可选 N 个**） |

### 10.2 条件边的本质：运行时决定「下一跳」

抛开两段代码的差异，`addConditionalEdges` 只做一件事：

```
source 节点执行完 → 调 router(state) → 得到一个 key → 查 pathMap[key] → 跳到那个节点
```

所以它是「**一张运行时可查的转发表**」，而不是「一个 if 语句」。三个推论：

1. **key 的语义由调用方定义**：阶段 6 叫 `tools`/`continue`，阶段 8 叫 `good`/`else`，框架不关心。
2. **`router` 必须是纯函数**：它只负责「查当前 state、返回一个 key」；做判断、发事件、改状态都不该在这里（§14 会给出更强的理由）。
3. **`pathMap` 必须覆盖 `router` 可能返回的所有 key**：否则运行时会抛 `Branch condition returned unknown or null destination`（阶段 6 实测过）。这正是 §11 要讲的「每个 key 都必须在 mapping 里」。

### 10.3 为什么阶段 8 不继续用「标签式 mapping」

阶段 6 的 `{ tools, continue }` 是**代码写死的**：节点只有两种去向，改图也改不了。而 `condition` 节点的分支数量、名字、目标全部来自**图数据**。如果把 `caseId` 映射成 `case1/case2/...` 之类的固定标签，就得在 router 里把 `caseId → 标签` 再做一次转换，多一层无意义的映射。直接 **`caseId` 即 key** 最省事，也天然与 `edge.sourceHandle` 对齐。

---

## 11. 【技术教学 · 首次】多出口条件边的 `mapping`

### 11.1 形状

```ts
branchTargets(graph, c1)
// => { "good": "llm1", "else": "else1" }
```

规则只有两条：

1. 对每个 `ConditionCase.id`，找一条 `source === c1 && sourceHandle === id` 的边，`paths[caseId] = edge.target`；
2. 找一条 `source === c1 && sourceHandle === "else"` 的边，`paths.else = edge.target`。

**`else` 不是条件**：它不在 `data.conditions` 里，是保留字。`branchTargets` 必须**单独**补上它。

### 11.2 为什么「每个 key 都必须在 mapping 里出现」

`router` 返回的 key 一定是下面两种之一：

- 某个 `caseId`（`runConditionNode` 命中某条条件时返回）；
- `"else"`（全部不命中，或 `branches[nodeId]` 缺失时的兜底）。

所以 `pathMap` 必须同时覆盖 **全部 caseId** 与 **`else`**。漏掉任何一个，都会在运行时变成「未知目的地」。预检把这件事提前变成了 400：

| 校验 | 保证 | 文案 |
| --- | --- | --- |
| 8.1.5 | 每个 `caseId` 都有一条出边 | `condition node {id} case {caseId} has no outgoing edge` |
| 8.1.6 | `else` 有一条出边 | `condition node {id} else branch has no outgoing edge` |
| 8.1.7 | 出边的 `sourceHandle` 只能是 caseId 或 `else` | `edge {edgeId} from condition node {id} has invalid sourceHandle: {handle}` |
| 8.1.8 | 同一分支不能有两条边 | `condition node {id} has duplicate edge for case {caseId}` |
| 8.1.2 | `caseId` 不能重复 | `condition node {id} has duplicate case id: {caseId}` |

这五条合起来，让 `branchTargets` 的返回值**恰好**是 `{caseIds} ∪ {"else"}`：**不多、不少、不重**。

- 8.1.5 / 8.1.6 ⇒ 不会**少**（每个 key 都有目标）；
- 8.1.7 ⇒ 不会**多**（没有来路不明的手柄）；
- 8.1.2 / 8.1.8 ⇒ 不会**重**（`find` 取第一条不会掩盖冲突）。

> 这就是「**预检把运行期的不确定性收敛掉**」：`branchTargets` 里保留了 `if (edge !== undefined)` 的防御，但在通过预检的图上，这些分支**永远**走不到「不写 key」那一路。防御是为了在「绕过 HTTP 直接改库」这种异常场景下也不崩，不是为了让正常路径变复杂。

### 11.3 key 的排序有意义吗

没有。`pathMap` 是**字典**，不是数组：LangGraph 只做 `pathMap[router(state)]` 查找，与插入顺序无关。真正决定「优先级」的是 `data.conditions` 的数组顺序（`runConditionNode` 的第一个 `for`），不是 `mapping` 的键序。

---

## 12. 【技术教学 · 首次】必须跳过普通出边（原因与阶段 6 不同）

### 12.1 现象

阶段 6 已经踩过同一个坑：**普通边 + 条件边会同时生效**，两条路都走（实测 `ran = a,b,c`）。阶段 8 的症状一模一样：

```
不跳过 c1 的普通出边 → 运行 topic="服务很好"
  → llm1  执行（条件边选中 good）
  → else1 也执行（普通边 e3 无条件生效）
  → end_1 可能被执行两次
```

### 12.2 原因不同

| | 阶段 6 | 阶段 8 |
| --- | --- | --- |
| 原图有几条出边 | **1 条**（`llm1 → end_1`） | **N 条**（每个分支一条：`e2`、`e3`） |
| 保留普通边会怎样 | 那 1 条变成无条件分支 → 与条件边二选一失效 | **所有**分支都变成无条件分支 → 扇出变成「全部执行」 |
| 根本原因 | `addEdge` 不认识「这是条件边的下游」 | `addEdge` **完全无视 `sourceHandle`** |

第 3 行是关键：`addEdge(edge.source, edge.target)` 的参数里**根本没有 `sourceHandle`**。框架收到的是「从 `c1` 到 `llm1`」「从 `c1` 到 `else1`」两条**无条件**边——在 LangGraph 里，一个节点有多条无条件出边 = **并行扇出，全部都跑**。

换句话说：**分支信息只存在于 `sourceHandle` 里，而普通边的建图路径把它丢掉了。** 所以必须在 `addEdge` 之前把它们筛掉，再由条件边根据 `sourceHandle` 重新建立路由。

### 12.3 实现

```ts
for (const edge of graph.edges) {
  if (toolNodes.some((node) => node.id === edge.source)) {
    continue
  }
  // condition 节点的出边按 sourceHandle 分派，同样跳过普通边
  if (conditionNodes.some((node) => node.id === edge.source)) {
    continue
  }
  builder.addEdge(edge.source, edge.target)
}
```

注意两个 `continue` 是**并列**的，不是嵌套：一个节点要么是「工具版 llm」，要么是 `condition`，不会同时是两者（类型不同）。把它们写成两条独立规则，是为了让每个理由都可读——而不是合成一个 `isSpecialSource`。

**跳过的只是「这一类源节点的普通边」，不是这些边本身**：`e2`/`e3` 仍然躺在 `graph.edges` 里，`branchTargets` 会把它们读出来当 `mapping` 的目标。边**没丢**，只是换了建图方式。

### 12.4 反过来说：分支下游的普通边必须保留

`llm1 → agg1`、`else1 → agg1` 是**普通边**，**不能**跳过——它们是分支「合流」的路径。判断规则很朴素：

> **只有「源节点是 `condition`」的边走条件边；其余边走普通边。**

---

## 13. 【技术教学 · 首次】`branches` 状态：节点算结果，条件边只做路由

### 13.1 三处代码，一条链路

```ts
// ① 声明：键是 condition 节点 id，值是选中的 caseId / "else"
branches: Annotation<Record<string, string>>({
  reducer: (previous: Record<string, string>, update: Record<string, string>) => ({
    ...previous,
    ...update,
  }),
  default: () => ({}),
}),

// ② 写：condition 节点执行完，把 matched 写进自己的 key
if (node.type === 'condition') {
  update.branches = { [node.id]: String(output.matched) }
},

// ③ 读：紧随其后的条件边，用同一个 key 查表
builder.addConditionalEdges(
  node.id,
  (state: RunStateValue) => state.branches[node.id] ?? 'else',
  branchTargets(graph, node),
)
```

**`?? 'else'` 是防御性兜底**：`condition` 节点在返回前一定写入了 `branches[nodeId]`，正常路径永远走不到 `??`；而 `else` 一定在 `mapping` 里（预检 8.1.6），所以兜底也不会变成「未知目的地」。它防的是「有人绕过 HTTP 直接改库」这类异常场景。

**顺带一提**：`update` 里同时有 `pool: { [node.id]: output }`，所以 `pool.c1 = { matched: "good" }`，模板里写 `{{ c1.matched }}` 是能取到的。但 **router 读的是 `branches`，不是 `pool`**——见 §13.4 的职责分离。

### 13.2 为什么必须是 state

`router` 是**独立函数**，由 LangGraph 在节点执行完之后调用。它拿不到 `runConditionNode` 的局部变量，也拿不到 `makeNodeAction` 里那次执行的 `output` —— 它**只能读 state**。这和阶段 6 的 `toolCalls` 完全同构：

| 状态 | 谁写 | 谁读 | 解决什么 |
| --- | --- | --- | --- |
| `toolCalls[nodeId]` | `makeLlmWithToolsAction` | ReAct 的 router | 「本轮模型还要不要调工具」 |
| `branches[nodeId]` | `makeNodeAction`（由 `runConditionNode` 的返回值驱动） | 分支的 router | 「这次条件节点选了哪个分支」 |

### 13.3 为什么用 `Record<nodeId, ...>` + 合并 reducer

一张图可以有**多个** `condition` 节点。每个节点的路由只能看**自己**的结果：

```ts
state.branches[node.id]   // 只读自己那个 key
```

合并 reducer（`{...previous, ...update}`）保证：

- 写 `branches.c1` 不会擦掉 `branches.c2`；
- 每个节点只写一个 key，语义清楚；
- 与 `pool` / `messages` / `rounds` / `toolCalls` 的 reducer 完全一致，**心智负担为零**。

初始值在 `invoke` 时给 `branches: {}`。如果漏掉这个初始值，`Annotation` 的 `default: () => ({})` 也会兜住；但显式写出来，与 `pool/messages/rounds/toolCalls` 一起读时更整齐。

### 13.4 职责分离：**节点函数算结果、条件边只做路由**

这是本篇最值得带走的设计习惯：

| 角色 | 该做的事 | 不该做的事 |
| --- | --- | --- |
| `runConditionNode`（节点函数） | 读池、按顺序求值、决定 `matched`、发 `branch_taken` | 不知道图长什么样、不知道下游是哪个节点 |
| `branchTargets`（建图期） | 从边表生成 `caseId → 目标` 的字典 | 不知道运行时会发生什么 |
| `router`（运行期） | **查表**：`state.branches[nodeId] ?? 'else'` | **不做判断**、不发事件、不写 state |

好处是三层都能独立测试：

- 节点函数：传一个假 `pool` 和一个假的 `emitBranchTaken`，断言 `{ matched: 'good' }` 与回调参数；
- `branchTargets`：传一张手写图，断言字典；
- `router`：传 `{ branches: { c1: 'good' } }`，断言返回 `'good'`。

如果把「判断」写进 `router`，这层测试就没法做了——因为它还会去读 `pool`、甚至发事件。

**为什么不直接让 router 读 `state.pool[nodeId].matched`**（它在池里确实存在）：

1. **类型**：`pool` 是 `Record<string, unknown>`，取字段要 `as` 断言；`branches` 是 `Record<string, string>`，天然是路由要的类型。
2. **语义分离**：`pool` 是「给模板用的数据」，`branches` 是「给路由用的控制信号」。混在一起后，将来给 `condition` 增加输出字段（比如 `reason`）就得重新审视 router；分开则互不影响。
3. **与阶段 6 同构**：`toolCalls` 也是独立通道，没有塞进 `pool`。两份路由状态保持同一种形状，读代码时不需要两套心智模型。

### 13.5 `String(output.matched)` 为什么不能省

`executeNode` 的返回类型是 `Record<string, unknown>`，`matched` 在静态类型上只是 `unknown`。`branches` 通道声明的是 `Record<string, string>`，直接塞 `unknown` 会破坏类型契约。`String(...)` 是一次**显式的运行时归一**：

- `runConditionNode` 永远返回字符串（`condition.id` 或 `'else'`），所以 `String` 是恒等；
- 万一将来有人改成返回 `{ id: 'good' }`，`String` 会给出 `"[object Object]"` —— 看起来像是「静默错误」，但它至少**不会**让 LangGraph 的 key 查找因为非字符串而抛更晦涩的错；
- 更重要的是：**避免 `as` 断言**。这里用一次 `String()` 换掉一个 `as string`，让类型与运行时都自洽。

---

## 14. 【技术教学 · 首次】`branch_taken` 为什么必须在节点内发

### 14.1 两种「可以发」的位置

```ts
// ✅ 本项目：节点内发（引擎把 emitter 作为回调注入）
case 'condition':
  return runConditionNode(node, pool, (caseId, label) =>
    queue.emit(branchTaken(node.id, caseId, label)),
  )
```

```ts
// ❌ 另一种写法：router 里发（只是举例，本项目没有这么写）
builder.addConditionalEdges(
  node.id,
  (state) => {
    const caseId = state.branches[node.id] ?? 'else'
    queue.emit(branchTaken(node.id, caseId, '...'))   // 副作用
    return caseId
  },
  branchTargets(graph, node),
)
```

### 14.2 理由一：事件顺序会错

一次 `makeNodeAction` 的执行顺序是固定的：

```ts
context.queue.emit(nodeStarted(node.id, node.type))                 // ①
const output = await this.executeNode(node, state.pool, queue)      // ② 内部发 branch_taken
context.queue.emit(nodeFinished(node.id, node.type, output))        // ③
return update                                                       // ④ router 在 ③ 之后才被调用
```

如果在 router 里发，`branch_taken` 会落在 **③ 之后**：

```
node_started(condition)
node_finished(condition)
branch_taken               ← 错位！协议要求 branch_taken 在 node_finished 之前
```

而 `packages/contract/sse-events.md` §3 写死的是：

```
node_started
  （仅 condition 节点：一次 branch_taken）
node_finished
```

两套后端必须逐字节对齐事件序列。位置一错，整个「阶段 8 契约一致」验收就挂了。

### 14.3 理由二：router 必须保持纯函数

`router` 的语义是「**给定 state，返回一个 key**」。它不该：

- 有副作用（发事件、写日志、改 state）；
- 依赖调用次数（框架可能在调试 / 内省 / 重试时多次调用）。

把它写成纯函数，还有一个直接好处：**分支路由可以被离线单测**——给定 `{ branches: { c1: 'good' } }` 就返回 `'good'`，不需要起队列、不需要 LangGraph。

### 14.4 理由三：`label` 只有节点知道

`router` 只负责返回 key（`caseId`）。而 `branch_taken` 的 payload 要带 `label`（展示名）：

```json
{ "nodeId": "c1", "caseId": "good", "label": "好评" }
```

`label` 存在 `data.conditions[].label` 里，`else` 分支则固定为 `"else"`。这些只有 `runConditionNode` 在遍历条件时**顺手**就能拿到；让 router 再去查一遍 `data.conditions` 是重复劳动，还会把「图数据」重新塞进 router。

> 边界（已修复）：`label` 在契约里仍是必填，但图上漏写时两端都**统一降级为空串**——TS 用 `condition.label ?? ''`，Python 用 `condition.get("label") or ""`，所以 `branch_taken.data` 永远是完整的三键，不会出现「TS 省略键 / Python `KeyError`」的分叉。实测同一张「case 缺 `label`」的图，两端 `branch_taken` 均为 `{"nodeId":"c1","caseId":"case1","label":""}`，且整条 SSE 流（归一化 `runId` / `appId` / `elapsedMs` 后）逐字节相同。仍建议配置时写全。

### 14.5 「每节点只发一次」

- `condition` 节点一次运行只执行一次（阶段 8 的分支是 DAG 上的扇出，没有环）；
- 一次执行只选中**一个**分支（第一个 `for` 命中即 `return`）；
- 所以 `branch_taken` 恰好一帧，前端可以按 `nodeId` 直接覆盖渲染。

这与 `retrieval`（每 `knowledge` 节点一次）的约定一致，与 `token`（流式多帧）不同。

---

## 15. 【技术教学 · 首次】`tryRenderTemplate`：分支安全的变量解析（本篇最重要）

### 15.1 问题：分支之后，「变量不存在」是常态

回到那张图：

```
c1 ──good──→ llm1  ──┐
   └─else──→ else1 ───┴→ agg1
```

`agg1` 的配置是：

```json
{ "name": "answer", "values": ["{{ llm1.text }}", "{{ else1.text }}"] }
```

运行 `topic="服务很好"` 时：

```
pool = {
  inputs: { topic: "服务很好" },
  start_1: { inputs: {...} },
  c1:     { matched: "good" },
  llm1:   { text: "echo: PRAISE 服务很好", ... }
  // ← 没有 else1！因为 else1 从未执行
}
```

如果 `aggregator` 用严格解析：

```
renderTemplate("{{ else1.text }}", pool)
→ resolvePath("else1.text", pool)
→ segment "else1": 池里没有这个键
→ throw RunError("template variable not found: else1.text")
→ run_failed，nodeId = agg1
```

**「合流点必然引用未执行分支的变量」**——这不是配置错误，而是**分支拓扑的固有结果**。用严格解析，任何「一分二再合流」的图，只要走到了另一条分支就必崩。

### 15.2 解决：只把「缺失」换成空串

```ts
export function tryRenderTemplate(text: string, pool: Pool, fallback = ''): string {
  return text.replace(TEMPLATE_PATTERN, (_match: string, rawPath: string) => {
    const resolved = tryResolvePath(rawPath.trim(), pool)
    return resolved.found ? stringifyValue(resolved.value) : fallback
  })
}
```

- 正则、遍历方式、字符串化规则**全部复用**；
- 唯一变化：**找不到路径时返回 `fallback`（默认 `''`）**，而不是抛错；
- 模板的其余文本原样保留（`"你好 {{ a.b }}!"` → `"你好 !"`）。

### 15.3 这不是「放松校验」，而是承认分支的现实

| 场景 | 严格解析的结论 | 安全解析的结论 | 谁对 |
| --- | --- | --- | --- |
| `llm.prompt` 里写了不存在的变量 | **配置错误**，应该失败 | 会把提示词悄悄变空 | 严格 ✅ |
| `aggregator.values[1]` 指向未执行分支 | **不是错误**，是拓扑的必然 | 空串，继续下一个候选 | 安全 ✅ |
| `condition.variable` 指向未执行分支 | **不是错误** | 空串参与比较（`is_empty` 为真） | 安全 ✅ |

所以安全解析的**适用范围是精确划定的**：

| 字段 | 解析函数 | 缺失时 |
| --- | --- | --- |
| `condition.conditions[].variable` / `value` | `tryRenderTemplate` | `''` |
| `aggregator.outputs[].values[]` | `tryRenderTemplate` | `''` |
| `iteration.inputArray` | `tryRenderTemplate` | `''`（但随后必须 `JSON.parse` 成数组，否则仍报错） |
| `llm.prompt` / `llm.system` | `renderTemplate` | `RunError` |
| `knowledge.query` | `renderTemplate` | `RunError` |
| `end.outputs[].value` | `renderTemplate` | `RunError` |
| `iteration.outputTemplate` | `renderTemplate` | `RunError` |

一句话：**「这个变量可能不存在」是分支的语义时用安全解析；「这个变量必须有」是配置的语义时用严格解析。**

### 15.4 边界：只有「路径缺失」才 fallback，真实 `null` 仍序列化为 `"null"`

这是最容易写错的地方。看 `tryResolvePath` 与 `stringifyValue` 的配合：

```ts
const resolved = tryResolvePath(rawPath.trim(), pool)
return resolved.found ? stringifyValue(resolved.value) : fallback
```

`tryResolvePath` 返回 `{ found: true, value: current }` 的条件是「**每一段都存在**」。**值本身是什么，它不管**。所以：

| `pool` 里的情况 | `found` | 输出 | 说明 |
| --- | --- | --- | --- |
| 键不存在 | `false` | `''` | 未执行分支 / 写错路径 |
| 中间段是数组（如 `llm1.chunks.0`） | `false` | `''` | 数组不支持下钻（与严格解析的拒绝规则一致） |
| 值是 `""` | `true` | `''` | 变量**存在**，只是空串 |
| 值是 `null` | `true` | `"null"` | **不是**空串！`JSON.stringify(null)` |
| 值是 `0` / `false` | `true` | `"0"` / `"false"` | 非字符串一律紧凑 JSON |
| 值是对象 | `true` | `{"a":1}` | 紧凑 JSON |

**为什么必须保留 `"null"`**：

1. **语义区分**：「没有这个变量」和「这个变量确实是 `null`」是两件事。前者是分支的常态，后者往往意味着上游出了状况（比如某个 API 返回了空值）。
2. **运算符正确性**：如果 `null` 也映射成 `''`，那么 `condition` 里的 `is_empty` 会对一个「明确的 null」判真——把「缺失」和「为空」混为一谈。
3. **聚合正确性**：`aggregator` 会把 `null` 误判为「没有内容」而跳到下一个候选，**掩盖上游的真实空值**。
4. **与严格解析一致**：`renderTemplate` 对存在但为 `null` 的值也输出 `"null"`（同一个 `stringifyValue`）。如果两套函数在这一点上分叉，同一张图在 `llm.prompt` 与 `aggregator.values` 里会渲染出不同的字符串，两端口径就对不上了。

> 一句话：**`tryRenderTemplate` 只放宽「缺失」，不放宽「值」。**

### 15.5 为什么 `condition.variable` 也需要它

上一节讲的例子都是 `aggregator`。那 `condition` 呢？条件节点通常在最前面，它的变量不是应该都存在吗？

不一定。`condition` 节点可以出现在**任何位置**，包括另一个分支的下游：

```
c1 ──good──→ c2 ──→ ...
   └─else──→ ...
```

如果 `c2` 的 `variable` 是 `{{ else_side.text }}`，而这次走的是 good 分支，`else_side` 就不存在。在 `c1` 的另一侧同理。**只要 `condition` 的输入来自「可能没执行的节点」，就必须安全解析。**

反过来，如果引用的是 `{{ inputs.topic }}` 这种「运行开始就一定有」的变量，安全解析与严格解析的结果**完全相同**——所以统一用安全解析，不会有额外代价。

---

## 16. 【技术教学 · 首次】`aggregator` 的算法：按顺序取第一个非空

### 16.1 伪代码

```
for 每个 output:
  value = ''
  for 每个 template in output.values:      ← 顺序 = 优先级
    rendered = tryRenderTemplate(template) ← 缺失 → ''
    if rendered !== '':
      value = rendered
      break                                ← 命中第一个非空就停
  output[name] = value                     ← 扁平写入
```

### 16.2 「第一个非空」≠「第一个存在」

这个区别是本节点唯一的业务语义：

| 语义 | 后果 |
| --- | --- |
| 取「第一个**存在**」的变量 | 未执行分支的变量「不存在」→ 跳过；但**已执行但输出为空串**的变量会被取到，汇总出一个空值 |
| 取「第一个**非空**」的变量（本项目） | 缺失与空串都跳过；只要 `values` 里还有候选，就一定拿到有内容的那条 |

为什么后者更合适：`aggregator` 的使用场景是「**多路合流，总有一路有货**」。把「渲染出空串」也当作「没有货」，才能让 `values` 真正发挥「优先候选列表」的作用。

代价：**顺序即语义**。`["{{ llm1.text }}", "{{ else1.text }}"]` 与反过来是两种行为。这一点必须在图配置里被清楚地表达（前端「变量聚合」面板的列表顺序就是优先级顺序）。

### 16.3 全部为空 → `""`，不是 `null`

```ts
let value = ''
for (const template of item.values) { ... }
output[item.name] = value
```

`value` 在循环外初始化为 `''`，所以：

- 所有候选都缺失 → `''`；
- 所有候选都存在但都是空串 → `''`；
- 混合 → `''`。

输出永远是字符串，**不会出现 `null`**。这让下游 `end` 的 `{{ agg1.answer }}` 一定能渲染（至少是空串），不会因为「聚合结果不存在」而 `run_failed`。

### 16.4 它不认识「分支」

`runAggregatorNode` 里没有 `condition`、没有 `branches`、也没有任何「哪条分支被选中」的信息。它只做一件事：**按优先级取第一个非空**。

这带来一个很好的性质：**`aggregator` 不依赖分支机制**。你可以把它放在**没有分支**的图里（比如「优先用知识库的 context，没有就用用户原问题」），它照样工作。分支只是它最常见的使用场景。

### 16.5 事件顺序

`aggregator` **没有专属事件**（不像 `condition` 有 `branch_taken`、`knowledge` 有 `retrieval`）。所以：

```
node_started(aggregator)
node_finished(aggregator, output={"answer": "..."})
```

两帧之间没有任何东西。前端要看「聚合到了什么」，直接读 `node_finished.output` 即可——它本身就是最终结果，没有「过程」需要观察。

---

## 17. 【技术教学 · 首次】为什么输出必须是扁平的

### 17.1 模板只支持点路径，且**明确拒绝数组**

`resolvePath` / `tryResolvePath` 里这一行是关键：

```ts
typeof current !== 'object' || current === null || Array.isArray(current) || !(segment in current)
```

**`Array.isArray(current)` 一旦为真，就直接判定为「不可下钻」**（严格解析抛错，安全解析返回缺失）。也就是说：

| 写法 | 结果 |
| --- | --- |
| `{{ agg1.answer }}` | ✅ 对象取键，正常 |
| `{{ agg1.outputs }}` | ⚠️ 能取到，但会把整个数组序列化成一坨 JSON |
| `{{ agg1.outputs.0.value }}` | ❌ 数组不支持下钻 → 缺失 / 抛错 |

### 17.2 如果输出是嵌套的

假设 `aggregator` 输出成：

```json
{ "outputs": [ { "name": "answer", "value": "echo: PRAISE 服务很好" } ] }
```

下游 `end` 想取值，只有两条路：

1. `{{ agg1.outputs }}` → 拿到 `[{"name":"answer","value":"echo: PRAISE ..."}]` 这么一坨 JSON 字符串，作为最终答案显然不行；
2. `{{ agg1.outputs.0.value }}` → **语法上就取不到**（数组段被拒绝）。

两条路都不通。所以**扁平输出不是风格选择，而是模板能力的必然结果**：

```json
{ "answer": "echo: PRAISE 服务很好" }
```

`{{ agg1.answer }}` 一步到位。

### 17.3 扁平输出把「节点输出」当成一个小对象

```json
{
  "name": "answer",                 ← 来自 aggregator.outputs[].name
  "values": ["...", "..."]          ← 只是候选列表，不进输出
}
```
↓
```json
{ "answer": "..." }
```

设计上的等价关系：

- `aggregator` 的 `outputs[].name` ≈ 「这个节点会暴露哪些字段」；
- 与 `llm` 的 `{ text, model, usage }`、`knowledge` 的 `{ chunks, context }` 是同一层概念：**节点输出是一个扁平对象，字段名由节点配置决定**。

这也让 `end` 的写法非常自然：

```json
{ "outputs": [{ "name": "result", "value": "{{ agg1.answer }}" }] }
```

### 17.4 名字冲突的边界

`outputs` 里两个条目重名会怎样？后写的覆盖先写的（`output[item.name] = value` 逐条赋值）。预检**不检查** aggregator 的 `name` 是否重复（规则 8.1.9/8.1.10 只管非空）。所以配置时请保证 `name` 唯一——这是一个「契约没管、要靠自觉」的小边界。

---

## 18. 实测

以下结果在 Windows + `apps/api-ts` + `tools/mock-llm`（`LLM_BASE_URL=http://127.0.0.1:11435/v1`）上实跑得到。图为 §4 那张「`c1` 一分二 → `agg1` 合流 → `end_1`」。

### 18.1 `topic="服务很好"`：只走好评分支

请求：

```
POST /apps/<APP_ID>/run
{"inputs":{"topic":"服务很好"}}
```

SSE（节选，`token` 用省略号表示多帧）：

```text
event: run_started
data: {"runId":"...","appId":"..."}

event: node_started
data: {"nodeId":"start_1","nodeType":"start"}

event: node_finished
data: {"nodeId":"start_1","nodeType":"start","output":{"inputs":{"topic":"服务很好"}}}

event: node_started
data: {"nodeId":"c1","nodeType":"condition"}

event: branch_taken
data: {"nodeId":"c1","caseId":"good","label":"好评"}

event: node_finished
data: {"nodeId":"c1","nodeType":"condition","output":{"matched":"good"}}

event: node_started
data: {"nodeId":"llm1","nodeType":"llm"}

event: token
data: {"nodeId":"llm1","text":"echo:"}

...（其余 token 帧）

event: node_finished
data: {"nodeId":"llm1","nodeType":"llm","output":{"text":"echo: PRAISE 服务很好","model":"mock-model","usage":{...}}}

event: node_started
data: {"nodeId":"agg1","nodeType":"aggregator"}

event: node_finished
data: {"nodeId":"agg1","nodeType":"aggregator","output":{"answer":"echo: PRAISE 服务很好"}}

event: node_started
data: {"nodeId":"end_1","nodeType":"end"}

event: node_finished
data: {"nodeId":"end_1","nodeType":"end","output":{"outputs":{"result":"echo: PRAISE 服务很好"}}}

event: run_finished
data: {"runId":"...","outputs":{"result":"echo: PRAISE 服务很好"},"elapsedMs":...}
```

**要点**：

- `branch_taken` 的 `caseId` 为 `"good"`、`label` 为 `"好评"`——与图的配置逐字一致；
- **整条流里没有任何 `else1` 的事件**（没有 `node_started`、没有 `token`、没有 `node_finished`）——条件边真的只走了一条路；
- `c1` 的 `node_finished.output` 是 `{"matched":"good"}`，与 `branch_taken.caseId` 相同；
- `agg1` 输出扁平对象 `{"answer":"..."}`。

### 18.2 `topic="服务很差"`：只走 else 分支

```text
event: node_started
data: {"nodeId":"c1","nodeType":"condition"}

event: branch_taken
data: {"nodeId":"c1","caseId":"else","label":"else"}

event: node_finished
data: {"nodeId":"c1","nodeType":"condition","output":{"matched":"else"}}

event: node_started
data: {"nodeId":"else1","nodeType":"llm"}
... token ...
event: node_finished
data: {"nodeId":"else1","nodeType":"llm","output":{"text":"echo: COMPLAIN 服务很差","model":"mock-model","usage":{...}}}

event: node_started
data: {"nodeId":"agg1","nodeType":"aggregator"}
event: node_finished
data: {"nodeId":"agg1","nodeType":"aggregator","output":{"answer":"echo: COMPLAIN 服务很差"}}

event: run_finished
data: {"runId":"...","outputs":{"result":"echo: COMPLAIN 服务很差"},"elapsedMs":...}
```

- `caseId` 与 `label` **都是** `"else"`（契约规定的固定值）；
- 这次 `llm1` **零事件**。

### 18.3 聚合：未执行分支的变量缺失 → 不报错

`topic="服务很好"` 时：

| 候选 | `tryRenderTemplate` 结果 | 是否命中 |
| --- | --- | --- |
| `{{ llm1.text }}` | `echo: PRAISE 服务很好` | ✅ 第一个非空，取它 |
| `{{ else1.text }}`（`else1` 从未执行） | `''`（路径缺失） | 不参与 |

最终 `agg1` 输出 `{"answer":"echo: PRAISE 服务很好"}`，**没有任何报错**。

反过来 `topic="服务很差"`：`llm1.text` 缺失 → `''`，`else1.text` 有值 → `{"answer":"echo: COMPLAIN 服务很差"}`。

**反证**：如果把 `runAggregatorNode` 里的 `tryRenderTemplate` 换成 `renderTemplate`，两次运行都会在 `agg1` 处失败：

```
// topic="服务很好"（else1 没执行）
event: run_failed
data: {"runId":"...","nodeId":"agg1","message":"template variable not found: else1.text"}

// topic="服务很差"（llm1 没执行）
event: run_failed
data: {"runId":"...","nodeId":"agg1","message":"template variable not found: llm1.text"}
```

并且**不会**有 `agg1` 的 `node_finished`（出错节点不发 `node_finished`，这是阶段 5 定下的规则）。

### 18.4 两端同图对比

同一张图、同一组输入，在 `api-ts` 与 `api-py` 上各跑一次，逐项比较：

| 维度 | 结果 |
| --- | --- |
| 事件名序列 | **完全一致**（含 `branch_taken` 的位置：夹在 `node_started(c1)` 与 `node_finished(c1)` 之间） |
| 每条事件的 payload **键集合** | **完全一致** |
| `node_finished.output` | **完全一致**（含 `{"matched":"good"}`、扁平聚合结果） |
| `run_finished.outputs` | **完全一致** |
| `runId` | 不同（每次运行随机） |
| `elapsedMs` | 不同（耗时） |
| `usage` | 数值不同（provider 侧计量），**键集合一致** |

> 这是阶段 8 新增的一致层次：**分支的「路径」与聚合的「值」都必须是确定性的**。只要条件运算符、数组顺序、安全解析规则、扁平输出形状在两端一致，同一张图的**行为**就一致——而不只是「响应体形状」一致。

---

## 19. 验收自测

| 检查项 | 做法 | 预期 |
| --- | --- | --- |
| 契约编译 | `pnpm run build:contract` | 无报错 |
| 引擎编译 | `pnpm --filter @mini-dify/api-ts build` | 无报错 |
| 好评分支 | §18.1 的请求 | `branch_taken {caseId:"good",label:"好评"}`，`else1` 零事件 |
| else 分支 | `topic="服务很差"` | `branch_taken {caseId:"else",label:"else"}`，`llm1` 零事件 |
| 合流不报错 | 看 `agg1` 的 `node_finished` | `{"answer":"..."}`，无 `run_failed` |
| 聚合值 | 对比 `end_1` 的 `outputs.result` | 与 `agg1.answer` 相同 |
| `c1` 输出 | 看 `node_finished.output` | `{"matched":"<caseId 或 else>"}` |
| 事件顺序 | `curl.exe -N` 逐帧看 | `node_started(c1)` → `branch_taken` → `node_finished(c1)` |
| 多分支不并行 | 统计 `llm1` / `else1` 的 `node_started` 次数 | 恰好一个节点出现一次 |
| 缺分支边 | 删掉 `c1 → else1` 的边再运行 | 开流前 400 `condition node c1 else branch has no outgoing edge` |
| 非法 sourceHandle | 把 `e2.sourceHandle` 改成 `foo` | 开流前 400 `edge e2 from condition node c1 has invalid sourceHandle: foo` |
| 条件为空 | `conditions: []` | 开流前 400 `condition node c1 must have at least one condition` |
| 聚合 values 空 | `values: []` | 开流前 400 `aggregator node agg1 output answer must have at least one value` |
| 严格解析对照 | 临时把 `aggregator` 改成 `renderTemplate` | `run_failed ... template variable not found: else1.text`，无 `node_finished` |
| 两端一致 | 同一图、同一输入各跑一次 | 事件序列 / 键集合 / 输出 / `run_finished.outputs` 相同 |

**可复现的最小命令序列**：

```powershell
# 1) mock provider（另开一个终端，常驻）
node tools/mock-llm/server.mjs

# 2) 启动 api-ts
pnpm --filter @mini-dify/api-ts start:dev

# 3) 写入 §4 的图（PUT 草稿），再运行
curl.exe -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"服务很好\"}}"

# 4) 换输入再跑一次
curl.exe -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"inputs\":{\"topic\":\"服务很差\"}}"
```

---

## 20. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| **没跳过 `condition` 的普通出边** | 两个分支的 `llm` 都执行，`end` 可能跑两次 | `addEdge` 无视 `sourceHandle`，多条无条件出边 = 并行扇出；在建图循环里筛掉（§12） |
| **把「跳过」写成跳过所有出边** | 分支目标不存在，`mapping` 为空，运行报未知目的地 | `branchTargets` 只读边、不建边；边必须还在 `graph.edges` 里（§12.3） |
| **`mapping` 漏掉 `else`** | `Branch condition returned unknown or null destination` | `else` 不在 `conditions` 里，必须单独补（§11.1）；预检 8.1.6 会先拦 |
| **`caseId` 起名 `else`** | 不报错，但条件与兜底分支被合并；`branch_taken` 语义含糊 | `else` 是保留字；预检不禁止，靠命名自觉（§11.2） |
| **把判断逻辑写进 router** | 事件顺序错、难以单测 | router 只查表；判断在 `runConditionNode`（§13.4） |
| **在 router 里发 `branch_taken`** | `branch_taken` 出现在 `node_finished` 之后 | `node_finished` 在 `executeNode` 之后立即发，router 更晚（§14.2） |
| **`aggregator` 用 `renderTemplate`** | `run_failed: template variable not found: ...`，无 `node_finished` | 未执行分支的变量必然缺失；必须用 `tryRenderTemplate`（§15） |
| **把 `null` 当成空串** | `is_empty` 对真实 `null` 判真、聚合跳过真实空值 | 只有「路径缺失」才 fallback；`null` 序列化为 `"null"`（§15.4） |
| **`aggregator.values` 顺序写反** | 聚合结果取了次要来源 | `values` 是优先级列表，第一个非空胜出（§16.2） |
| **指望 `aggregator` 合并对象** | 拿到一大串 JSON | 它只产出字符串；对象会被紧凑 JSON 序列化（§17.3） |
| **写成嵌套输出 `{outputs:[{name,value}]}`** | 下游 `{{ agg1.outputs.0.value }}` 取不到 | 模板拒绝数组下钻；输出必须扁平（§17.1） |
| **`condition.value` 忘写 + `equals`** | 只有左值为空时才匹配 | `value === undefined` 时按 `''` 参与比较（§5） |
| **条件顺序写反** | 走了「更宽」的那条分支 | 数组顺序即优先级，第一条命中即停（§5） |
| **在 `llm.prompt` 里引用未执行分支** | `run_failed: template variable not found: ...` | 安全解析只作用于 `condition` / `aggregator` / `iteration.inputArray`（§15.3） |
| **`aggregator` 输出重名** | 后一个覆盖前一个 | 预检不检查 `name` 唯一，配置时自行保证（§17.4） |
| **`c1` 的 `nodeType` 写错** | 前端画布渲染成未知节点，运行期仍按 `type` 分派 | 契约只认 `condition` / `aggregator` / `iteration`（`sse-events.md` §2） |

---

## 21. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **同一个 `addConditionalEdges` 的两种用途** | 阶段 6 = ReAct 单出口判断（`{tools, continue}` 写死在代码里）；阶段 8 = 多出口分支（key 来自图数据的 `caseId`）。本质都是「运行时决定下一跳」 | **首次教学于本篇** |
| **多出口条件边的 `mapping`** | `{ [caseId]: target, else: elseTarget }`；key = 边的 `sourceHandle`；预检 8.1.2/8.1.5/8.1.6/8.1.7/8.1.8 共同保证「不多不少不重」 | **首次教学于本篇** |
| **`condition` 节点必须跳过普通出边** | `addEdge` 无视 `sourceHandle`，多条无条件出边 = 并行扇出，所有分支都会执行；与阶段 6 原因不同（阶段 6 是单出口被破坏） | **首次教学于本篇** |
| **`branches` 状态** | `Annotation<Record<nodeId, matched>>` + 合并 reducer；`condition` 节点写、router 读；职责分离「节点算结果、条件边只路由」 | **首次教学于本篇** |
| **`branch_taken` 在节点内发** | 顺序要求 `node_started → branch_taken → node_finished`；router 必须是纯函数；`label` 只有节点知道；每节点恰一次 | **首次教学于本篇** |
| **`tryRenderTemplate`（分支安全解析）** | 唯一差别是「路径缺失 → `fallback`（默认 `''`）」，其余（正则、逐段遍历、字符串化）与严格解析完全一致 | **首次教学于本篇** |
| **「路径缺失」与「值为 `null`」的边界** | 只有缺失才 fallback；`null` 仍序列化为 `"null"`；避免把「没有变量」与「变量确实为空」混为一谈 | **首次教学于本篇** |
| **分支安全解析的适用范围** | `condition.variable/value`、`aggregator.values[]`、`iteration.inputArray`；其余（`llm` / `knowledge` / `end` / `iteration.outputTemplate`）保持严格 | **首次教学于本篇** |
| **`aggregator` 算法** | 按 `values` 顺序取**第一个非空**；全空 → `''`；输出扁平 `{ "<name>": "<值>" }`；不依赖分支机制 | **首次教学于本篇** |
| **为什么扁平输出** | `resolvePath` / `tryResolvePath` 明确拒绝数组下钻，`{{ agg1.outputs.0.value }}` 不可用；扁平是模板能力下的唯一可行形状 | **首次教学于本篇** |
| **`condition` 运算符语义** | 12 个运算符；`equals` 全等、`contains` 子串、`is_empty` 只比 `""`、数值比较任一侧非有限数字 → `false`；`value` 缺省按 `''` | 本篇（契约定义见 `sse-events.md` §4） |

> 已在前序篇教学、本篇仅引用不重讲的：`Annotation` / reducer / 动态建图见 `04-执行引擎/02-LangGraph编译图-TS.md`；条件边基本用法、「跳过普通边」的陷阱、环与 `recursionLimit` 见 `06-工具调用/02-NestJS-ReAct循环与条件边.md`；模板解析与变量池见 `04-执行引擎/03-节点运行时与变量池.md`；SSE 帧格式与「先校验、后开流」见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；图语义校验的规则 8/9 与错误文案见本阶段第 `01` 篇与 `packages/contract/error-messages.md` §8。
