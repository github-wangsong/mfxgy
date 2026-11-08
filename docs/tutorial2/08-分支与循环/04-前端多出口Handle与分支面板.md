# 04 · 前端多出口 Handle 与分支面板（分支与循环）

> 阶段 8 · 第 4 步
>
> 做完：画布上 `condition` 节点每个分支一个右侧 `Handle`；分支可增删、可编辑运算符与比较值；未连线的分支在面板里提前标红。`aggregator` / `iteration` 各有参数面板。
>
> **本篇面试考点**：`Handle` 的 `id` 为什么必须等于 `caseId` · 多 Handle 为什么不能用绝对定位铺满整张卡片 · 删除分支为什么必须同时删边 · 前端为什么**不**阻止“同一分支连两条边” · 为什么前端校验永远只是体验 · `UNARY_OPERATORS` 为什么要隐藏比较值 · `maxIterations` 为什么又用文本态 · `key={index}` 在可删除列表里的问题 · `useMemo` 依赖与 `missingBranches` 的实时性。

---

## 1. 前端要做的四件事

| 动作 | 产物 |
| --- | --- |
| 画布渲染 | `condition` 节点多出口，每个出口有可见的 handle |
| 连线 | 从某个分支 handle 拖到下游，`edge.sourceHandle` 自动带上 `caseId` |
| 编辑 | 分支增删、label/variable/operator/value |
| 预检提示 | 未连线的分支在面板里标红（保存前就知道会 400） |

前端**不负责**的是：分支 id 唯一性、`else` 保留字、运算符合法性（最后一条除外，下拉只给合法值）。

---

## 2. `condition` 节点的多 Handle

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（节点组件）

```tsx
/**
 * condition 节点：右侧**每个分支一个 source Handle**，`id` 即该分支的 `caseId`，
 * 末尾固定追加一个 `id="else"` 的 Handle。连线时 React Flow 会把被拖出的 handle id
 * 写入 `connection.sourceHandle`，保存时随 `edges[].sourceHandle` 落到后端。
 */
function ConditionNode({ data, selected }: NodeProps) {
  // `data.conditions` 来自图 JSON：不可信输入，逐项过 Zod；失败项丢弃而不是整块崩掉
  const conditions = parseArrayOrEmpty(data.conditions, conditionCaseSchema)
  // 渲染行 = 用户分支 + 「否则」；label 为空时退回显示 id，避免出现空白行
  const rows = [
    ...conditions.map((item) => ({ id: item.id, label: item.label === '' ? item.id : item.label })),
    { id: 'else', label: '否则' },
  ]
  return (
    <div className={`node-card${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-card-head">
        <span className="node-dot" style={{ background: NODE_ACCENT.condition }} />
        <span className="truncate">{String(data.title ?? '条件分支')}</span>
      </div>
      <div className="node-meta">condition · {conditions.length} 个分支</div>
      {/* 每个分支一个 source Handle：行需要定位上下文，Handle 贴在该行右端。 */}
      <div className="stack stack--sm">
        {rows.map((row) => (
          <div key={row.id} className="row" style={{ position: 'relative', paddingRight: 16 }}>
            <span className="truncate">{row.label}</span>
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

### 2.1 三个关键点

**① `id={row.id}` 就是 `caseId`**

React Flow 在连线时把 `handle.id` 写进 `connection.sourceHandle`：

```text
从「VIP 用户」这个 handle 拖出 → edge.sourceHandle === "vip"
```

保存时 `buildGraph` 原样带上：

```ts
sourceHandle: edge.sourceHandle ?? null
```

后端条件边路由查的就是它。**前端 handle id 与后端路由键是同一个字符串**，中间没有任何映射。

> **面试考点 · 为什么不给 handle 起一个 UI 专用 id（如 `handle-1`），保存时再映射？**
> 映射需要一张表，而这张表：
>
> - 存在哪？前端 state 还是节点 data？两者都要跟图一起持久化；
> - 后端校验 `sourceHandle === caseId` 时还得反查；
> - 分支 id 改名时（本项目不允许改 id）要同步映射。
>
> 直接用 `caseId` 做 handle id，**把“映射”消灭在数据结构里**。
> 这是“数据结构选对了，代码就少了”的典型例子。

**② 每行 `position: relative`，Handle 绝对定位在行内**

```tsx
<div className="row" style={{ position: 'relative', paddingRight: 16 }}>
  <span>{row.label}</span>
  <Handle type="source" id={row.id} position={Position.Right} style={{ right: 0, top: '50%' }} />
</div>
```

React Flow 的 `Handle` 默认 `position: absolute`：

- 父元素没有定位 → 相对最近的定位祖先（可能是整张卡片）；
- 结果所有 handle 叠在卡片右侧同一位置，**无法分辨拖的是哪个分支**。

**③ `else` 固定追加**

```tsx
{ id: 'else', label: '否则' }
```

- 用户不能删、不能改名（否则与保留字规则冲突）；
- 即使后端不检查，前端也要保证“兜底分支永远存在”，避免用户画出一张“可能走进死路”的图。

> **面试考点 · 为什么不把 `else` 也放进 `conditions`？**
> 因为 `else` 的语义不同：
>
> - `conditions` 是**有序的判断列表**，每个都有 `variable/operator/value`；
> - `else` 是**兜底**，没有任何判断条件。
>
> 混在一起会导致：
>
> - 数据结构里出现“没有 operator 的 condition”，类型变宽；
> - 用户可能把 `else` 拖到中间，产生“兜底之后再判断”的奇怪语义。
>
> **用“列表 + 保留分支”表达穷尽性**，比把所有东西塞进一个列表更清晰。

### 2.2 `initialData`

```tsx
function initialData(type: NodeType): Record<string, unknown> {
  // ...
  if (type === 'condition') {
    return {
      title: '条件分支',
      conditions: [
        { id: 'case1', label: '分支 1', variable: '{{ inputs.topic }}', operator: 'contains', value: '' },
      ],
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
  // ...
}
```

新增节点时给一份“**能直接跑**”的默认值：

- `condition` 默认一个 `contains` 分支 → 图保存能过校验（前提是连了 `else`）；
- `aggregator` 默认一个 `answer` 输出 → 不会一加就 400；
- `iteration` 默认 `{{ inputs.items }}` + `{{ item }}` → 用户只需改输入名。

> **面试考点 · 默认值该“空”还是“能跑”？**
> 选“能跑”：
>
> - 用户加节点是为了用，不是为了看红字；
> - 默认值同时也是**示例**（告诉用户 `variable` 长什么样）；
> - 但默认值必须**明显是占位**（`{{ inputs.topic }}`、`case1`），用户会主动改。
>
> 反例：默认 `name: ""` 会让用户加完节点直接保存失败，体验很差。

---

## 3. 连线

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（`onConnect`）

```tsx
const onConnect = useCallback(
  (connection: Connection) => {
    // `connection.sourceHandle` 由 React Flow 从被拖出的 Handle 自动填入；
    // 从节点主体拖出时为 null（本项目的 condition 节点只有显式 Handle，不会出现）
    setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds))
  },
  [],
)
```

### 3.1 前后端分工

| 检查 | 前端 | 后端 |
| --- | --- | --- |
| 分支有没有连线 | 面板提示（`missingBranches`） | 保存时 400 |
| 同一分支连了两条边 | **不阻止** | 保存时 400 |
| `sourceHandle` 为空 | 不阻止 | 保存时 400 |
| 连到不存在的分支 | 不可能（handle 是渲染出来的） | 保存时 400 |
| 自环 / 重复 id | 不阻止 | 保存时 400 |

> **面试考点 · 为什么前端不阻止“同一分支连两条边”？**
> 三个原因：
>
> 1. **React Flow 的交互限制**：用户可能先连一条，再想改；如果前端在 `onConnect` 里拒绝，用户会以为“拖拽坏了”，没有反馈；
> 2. **规则会变**：今天禁止两条边，明天可能支持“分支后并行”；把规则写进前端交互，改规则要改两处；
> 3. **权威在后端**：前端即使拦截了，用户仍可直接调 API。安全与正确性不能依赖客户端。
>
> 前端可以做的是**提前提示**（`missingBranches` 标红），而不是**阻止操作**。
> **“引导”和“强制”要分开：引导放前端，强制放后端。**

### 3.2 `missingBranches`

```tsx
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
```

依赖三项：

- `selectedNode`：切换选中节点要重算；
- `selectedConditions`：增删分支要重算；
- `edges`：连线/删边要重算。

漏掉 `edges` 的典型 bug：**连完线，红字不消失**——因为 `useMemo` 认为依赖没变。

> **面试考点 · 为什么不用 `useEffect` + state？**
> 因为 `missingBranches` 是 `nodes/edges` 的**纯派生值**：
>
> - 用 `useMemo`：渲染时算，永远不会“慢一拍”；
> - 用 `useEffect`：先渲染旧值，再 setState 触发一次渲染，中间会闪一下，且多一份状态要同步。
>
> **能从现有 state 算出来的，就不要再存一份 state。**

### 3.3 面板里的提示

```tsx
<div className="faint">每个分支（含「否则」）都需要连线，否则保存会失败。</div>
{missingBranches.length > 0 && (
  <div className="alert alert-error">
    缺少出边：{missingBranches.map((branch) => branch.label).join('、')}
  </div>
)}
```

注意：

- 提示用 **label**（用户看得懂），不是 `id`；
- 只说“缺少出边”，不列举后端全部规则（重复 id、非法 handle 等交给保存时的 400 文案）；
- 这条提示**不阻止保存**——用户仍可点保存，看到后端的完整错误。

---

## 4. 分支编辑面板

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（`condition` 面板节选）

```tsx
{selectedNode.type === 'condition' && (
  <div className="stack stack--sm">
    <div className="label">条件分支（按顺序取第一个匹配）</div>
    {selectedConditions.map((item, index) => (
      <div key={item.id} className="card">
        <div className="card-body stack stack--sm">
          <div className="faint">
            分支 id：<code>{item.id}</code>（出边 sourceHandle）
          </div>
          <div className="field">
            <label className="label">分支名（label）</label>
            <input
              className="input"
              value={item.label}
              onChange={(e) =>
                updateNodeData(selectedNode.id, {
                  conditions: selectedConditions.map((cur, i) =>
                    i === index ? { ...cur, label: e.target.value } : cur,
                  ),
                })
              }
            />
          </div>
          <div className="field">
            <label className="label">变量（模板）</label>
            <input
              className="input input-mono"
              value={item.variable}
              placeholder="{{ inputs.topic }}"
              onChange={(e) =>
                updateNodeData(selectedNode.id, {
                  conditions: selectedConditions.map((cur, i) =>
                    i === index ? { ...cur, variable: e.target.value } : cur,
                  ),
                })
              }
            />
          </div>
          <div className="field">
            <label className="label">运算符</label>
            <select
              className="select"
              value={item.operator}
              onChange={(e) => {
                // 下拉值来自 DOM：先按契约枚举校验，再写回节点 data。
                const parsed = conditionOperatorSchema.safeParse(e.target.value)
                if (!parsed.success) return
                updateNodeData(selectedNode.id, {
                  conditions: selectedConditions.map((cur, i) =>
                    i === index ? { ...cur, operator: parsed.data } : cur,
                  ),
                })
              }}
            >
              {OPERATOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {!UNARY_OPERATORS.includes(item.operator) && (
            <div className="field">
              <label className="label">比较值（字面量或模板）</label>
              <input
                className="input input-mono"
                value={item.value ?? ''}
                onChange={(e) =>
                  updateNodeData(selectedNode.id, {
                    conditions: selectedConditions.map((cur, i) =>
                      i === index ? { ...cur, value: e.target.value } : cur,
                    ),
                  })
                }
              />
            </div>
          )}
          <button className="btn btn-sm btn-danger" onClick={() => removeCondition(selectedNode.id, item.id)}>
            删除分支
          </button>
        </div>
      </div>
    ))}
    <button className="btn btn-sm" onClick={() => addCondition(selectedNode.id)}>
      新增分支
    </button>
    <div className="faint">每个分支（含「否则」）都需要连线，否则保存会失败。</div>
    {missingBranches.length > 0 && (
      <div className="alert alert-error">
        缺少出边：{missingBranches.map((branch) => branch.label).join('、')}
      </div>
    )}
  </div>
)}
```

### 4.1 分支 id 不可编辑

```tsx
<div className="faint">
  分支 id：<code>{item.id}</code>（出边 sourceHandle）
</div>
```

`caseId` 只读，原因：

- 它是**边的路由键**（`edge.sourceHandle`）；
- 改 id 必须同步改所有相关边的 `sourceHandle`；
- 一旦漏改，图就从“合法”变成“非法”，而且用户看不出原因。

> **面试考点 · 那用户想改名字怎么办？**
> 改 `label`：
>
> - `id` 是**机器标识**（路由用）；
> - `label` 是**人类名称**（展示用）。
>
> 这是标识与显示分离的经典做法（数据库主键 vs 名称、变量名 vs 标题）。
> 如果非要支持改 id，正确做法是“改 id + 级联改所有边”，并且要检测冲突——成本远高于收益。

### 4.2 `UNARY_OPERATORS` 隐藏比较值

```tsx
{!UNARY_OPERATORS.includes(item.operator) && (
  <div className="field">...比较值...</div>
)}
```

`is_empty` / `is_not_empty` 只需要一个操作数：

- 显示“比较值”输入框会让用户以为要填；
- 后端 `matches()` 对这两个运算符**忽略** `value`；
- 隐藏字段后，旧数据里的 `value` 仍保留在 JSON 里（引擎不看），不会丢失。

> **面试考点 · 隐藏字段要不要顺手删掉 `data.value`？**
> 不删：
>
> - 用户切到 `equals` 再切回来，之前填的值还在；
> - 删除字段需要“读旧值再写回”，多一次合并逻辑；
> - 引擎对一元运算符本来就忽略它，留着无害。
>
> **UI 的可见性与数据的存废是两件事**。只隐藏，不销毁，能避免“手滑切一下就丢配置”。

### 4.3 增删分支

```tsx
/** 新增 condition 分支：自动生成节点内唯一的 `case{N}`（不覆盖已有 id）。 */
function addCondition(id: string): void {
  setNodes((nds) =>
    nds.map((node) => {
      if (node.id !== id) return node
      const conditions = parseArrayOrEmpty(node.data.conditions, conditionCaseSchema)
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
      const conditions = parseArrayOrEmpty(node.data.conditions, conditionCaseSchema)
      return { ...node, data: { ...node.data, conditions: conditions.filter((item) => item.id !== caseId) } }
    }),
  )
  setEdges((eds) => eds.filter((edge) => !(edge.source === id && edge.sourceHandle === caseId)))
}
```

`nextCaseId`：

```tsx
/** 生成节点内唯一的分支 id：`case1`、`case2`…，跳过已用的。 */
function nextCaseId(conditions: ConditionCase[]): string {
  const used = new Set(conditions.map((item) => item.id))
  let index = conditions.length + 1
  while (used.has(`case${index}`)) {
    index += 1
  }
  return `case${index}`
}
```

为什么不用 `crypto.randomUUID()`：

- `caseId` 会出现在**错误文案**里（`case case3 has no outgoing edge`），UUID 不可读；
- 它还要作为 `sourceHandle` 出现在边的 JSON 里，短 id 便于手改与调试；
- 唯一性只需“节点内唯一”，不需要全局唯一。

> **面试考点 · `nextCaseId` 为什么从 `conditions.length + 1` 开始，而不是 1？**
> 避免每次新增都从头扫描：
>
> - 已有 `[case1, case2]` → 从 `case3` 开始，一次命中；
> - 删掉 `case1` 后是 `[case2]` → 从 `case2` 开始，`case2` 已用 → `case3`；
> - 极端情况（`[case2, case3]`）会得到 `case3`？→ `used` 有 `case3`，继续到 `case4`。
>
> 逻辑上从 1 开始也能得到正确结果，但从 `length+1` 开始**平均更少循环**，且生成的 id 单调递增，便于人读。

**删除分支必须删边**：

```tsx
setEdges((eds) => eds.filter((edge) => !(edge.source === id && edge.sourceHandle === caseId)))
```

如果只删 `conditions` 而不删边：

- 图上留下一条 `sourceHandle: "case3"` 的边；
- 保存时校验规则 8.1.7 报 `invalid sourceHandle: case3`；
- 用户会困惑：“我明明把分支删了，为什么还说 case3 非法？”

**删数据要连带删引用**——图模型里，`conditions[].id` 与 `edges[].sourceHandle` 是一对引用关系。

> **面试考点 · 为什么不靠保存时的校验兜底，前端就省事了？**
> 校验只能“拒绝”，不能“修复”。
> 用户删了分支，结果保存失败，还得自己去找那条看不见的边（边在画布上可能被折叠/遮挡）。
> 前端在删除动作里同步清理，是**让非法状态无法被构造出来**，而不是事后拒绝。
> 这是 “make illegal states unrepresentable” 的工程思想在 UI 上的应用。

---

## 5. `aggregator` 面板

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（`aggregator` 面板节选）

```tsx
{selectedNode.type === 'aggregator' && (
  <div className="stack stack--sm">
    <div className="label">输出聚合</div>
    <div className="faint">每个输出按 values 顺序取第一个非空值（解析失败的模板视为空串）。</div>
    {selectedAggregatorOutputs.map((item, index) => (
      <div key={index} className="card">
        <div className="card-body stack stack--sm">
          <input
            className="input"
            placeholder="输出名，如 answer"
            value={item.name}
            onChange={(e) =>
              updateNodeData(selectedNode.id, {
                outputs: selectedAggregatorOutputs.map((cur, i) =>
                  i === index ? { ...cur, name: e.target.value } : cur,
                ),
              })
            }
          />
          {item.values.map((value, valueIndex) => (
            <div key={valueIndex} className="row">
              <input
                className="input input-mono grow"
                placeholder="值，如 {{ llm1.text }}"
                value={value}
                onChange={(e) =>
                  updateNodeData(selectedNode.id, {
                    outputs: selectedAggregatorOutputs.map((cur, i) =>
                      i === index
                        ? {
                            ...cur,
                            values: cur.values.map((v, vi) => (vi === valueIndex ? e.target.value : v)),
                          }
                        : cur,
                    ),
                  })
                }
              />
              <button
                className="btn btn-sm"
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
          <button className="btn btn-sm" onClick={/* 追加 "" */}>
            新增取值
          </button>
          <button className="btn btn-sm btn-danger" onClick={/* 删除整条 output */}>
            删除输出
          </button>
        </div>
      </div>
    ))}
    <button className="btn btn-sm" onClick={/* 追加 { name: '', values: [''] } */}>
      新增输出
    </button>
  </div>
)}
```

要点：

1. **`values` 至少保留一项**：`disabled={item.values.length <= 1}`——后端校验要求 `minItems: 1`；
2. **`outputs` 可以删到 0**？——前端允许，但保存会 400（后端要求至少一个输出）。这里**没有**禁用“删除输出”到 0，属于体验缺口（可以用 `missingBranches` 同款提示，但当前没做）；
3. `key={index}` 而不是 `key={item.name}`：`name` 可编辑且可能重复，用 `name` 做 key 会导致输入框错位。

> **面试考点 · `key={index}` 真的没问题吗？**
> 在**可删除**的列表里，`index` 作为 key 有经典问题：
>
> ```text
> [A, B, C] 删掉 B → [A, C]
> React 认为 index 1 从 B 变成了 C（复用 DOM），index 2 被卸载
> ```
>
> 如果每行有**内部 state**（如未受控输入、焦点、展开状态），会串位。
> 本面板的输入是**完全受控**（`value` 来自 `outputs`），所以删中间项不会串值；但**焦点**可能跳到相邻行。
> 更稳妥：给每个 output 一个稳定 id（像 `condition.id` 那样）。当前为了简洁用了 `index`，属于可接受的小瑕疵。

---

## 6. `iteration` 面板

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（`iteration` 面板节选）

```tsx
{selectedNode.type === 'iteration' && (
  <div className="stack stack--sm">
    <div className="field">
      <label className="label">输入数组（inputArray，模板）</label>
      <input
        className="input input-mono"
        value={String(selectedNode.data.inputArray ?? '')}
        placeholder="{{ inputs.items }}"
        onChange={(e) => updateNodeData(selectedNode.id, { inputArray: e.target.value })}
      />
    </div>
    <div className="faint">模板解析结果必须是 JSON 数组，如 ["A","B"]。</div>
    <div className="field">
      <label className="label">当前项变量名（itemName）</label>
      <input
        className="input"
        value={String(selectedNode.data.itemName ?? 'item')}
        onChange={(e) => updateNodeData(selectedNode.id, { itemName: e.target.value })}
      />
    </div>
    <div className="field">
      <label className="label">最大迭代次数（1-100）</label>
      <input
        className="input"
        type="number"
        min="1"
        max="100"
        value={maxIterationsText}
        onChange={(e) => changeMaxIterations(selectedNode.id, e.target.value)}
        onBlur={() => commitMaxIterations(selectedNode.id)}
      />
    </div>
    <div className="field">
      <label className="label">输出模板（outputTemplate，每项渲染一次）</label>
      <textarea
        className="textarea textarea-mono"
        value={String(selectedNode.data.outputTemplate ?? '')}
        placeholder="第{{ itemIndex }}/{{ itemCount }}项: {{ item }}"
        onChange={(e) => updateNodeData(selectedNode.id, { outputTemplate: e.target.value })}
        rows={4}
      />
    </div>
    <div className="faint">可用 {'{{ item }}'}、{'{{ itemIndex }}'}、{'{{ itemCount }}'}。</div>
  </div>
)}
```

### 6.1 `maxIterations` 又是文本态

与阶段 5 的 `temperature` / `maxTokens` 同样的理由：

```tsx
const [maxIterationsText, setMaxIterationsText] = useState('20')
```

- `<input type="number">` 在用户输入 `1` 后想输 `10`，中途会出现空串 → `Number('') === 0`；
- 清空输入框时，如果直接写回 `0`，会立刻变成非法值（1-100）；
- 用文本态 + 合法才写回：

```tsx
/** iteration 的 maxIterations：合法整数（1-100）时写回；失焦时钳制并回填。 */
function changeMaxIterations(id: string, raw: string): void {
  setMaxIterationsText(raw)
  const parsed = Number(raw)
  if (raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
    updateNodeData(id, { maxIterations: parsed })
  }
}

/** 失焦时把非法/越界值钳制到合法区间并回填输入框。 */
function commitMaxIterations(id: string): void {
  const parsed = Number(maxIterationsText)
  const clamped = Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.trunc(parsed))) : 20
  setMaxIterationsText(String(clamped))
  updateNodeData(id, { maxIterations: clamped })
}
```

行为：

| 用户输入 | onChange 时写回 | 失焦后回填 |
| --- | --- | --- |
| `5` | 5 | `5` |
| `0` | 不写（非法） | `1` |
| `200` | 不写 | `100` |
| `abc` | 不写 | `20`（默认） |
| `5.7` | 不写（非整数） | `5` |
| 空 | 不写 | `20` |

> **面试考点 · 为什么 onChange 不直接钳制？**
> 因为钳制会**打断输入**：
>
> - 用户想输 `100`，输入 `1` 时被钳到 1（没问题），继续输 `0` → 变 10，再输 `0` → 100；
> - 但如果上限是 20，用户输 `2` 时被钳到 2，输 `0` → 20，再输 `0` → 还是 20，用户会以为键盘坏了。
>
> **输入过程宽松，提交时机严格**：
> - `onChange`：只记录文本 + 合法才写回；
> - `onBlur`：钳制并回填。
>
> 这与表单库的 `mode: onBlur` 是同一思路。

### 6.2 提示可用变量

```tsx
<div className="faint">可用 {'{{ item }}'}、{'{{ itemIndex }}'}、{'{{ itemCount }}'}。</div>
```

注意：`item` 实际是 `itemName` 的默认值。如果用户把 `itemName` 改成 `topic`，提示应显示 `{{ topic }}`。当前是硬编码文案，属于小瑕疵（正确做法是拼接 `selectedNode.data.itemName`）。

---

## 7. 事件展示

**完整文件路径：`apps/web/app/apps/[id]/page.tsx`**（运行日志节选）

```tsx
/**
 * 把一帧 SSE 压缩成一行日志：
 * - `branch_taken` → `条件 c1 → vip（VIP 用户）`
 * - `iteration_item` → `迭代 i1 2/3`
 */
function summarizeFrame(name: string, data: string): string {
  // ...
  if (name === 'branch_taken') {
    const parsed = parseEventData(data, branchTakenEventSchema)
    if (parsed === null) return data
    return `条件 ${parsed.nodeId ?? ''} → ${parsed.caseId ?? ''}（${parsed.label ?? ''}）`
  }
  if (name === 'iteration_item') {
    const parsed = parseEventData(data, iterationItemEventSchema)
    if (parsed === null) return data
    return `迭代 ${parsed.nodeId ?? ''} ${parsed.index ?? '?'}/${parsed.total ?? '?'}`
  }
  return data
}
```

面板底部还有一个独立的“迭代进度”区：

```tsx
{iterationEvents.length > 0 && (
  <div className="stack stack--sm">
    <div className="label">迭代进度（iteration_item）</div>
    {iterationEvents.map((item, index) => (
      <div key={index} className="faint">
        <span className="event-name">iteration</span> {item.nodeId} {item.index}/{item.total}
      </div>
    ))}
  </div>
)}
```

为什么单独展示：

- 日志区会混入 `token`，迭代进度容易被淹没；
- 进度是“结构化状态”（当前第几项），不只是文本；
- 将来可以做进度条（`index / total`）。

> **面试考点 · 为什么事件都要过 Zod，而不是 `JSON.parse` 后直接用？**
> 因为 SSE `data` 是**服务端文本**：
>
> - 字段可能缺失（阶段 4 的 schema 全 optional）；
> - 类型可能不对（`index` 是字符串）；
> - 未来版本可能加字段。
>
> `parseEventData` + `safeParse` 保证：
>
> - 解析失败 → 返回 `null`，日志显示原始文本，**页面不崩**；
> - 字段缺失 → 用 `?? '?'` 兜底展示。
>
> 这就是阶段 0 讲的“**前端所有响应都是不可信输入**”在 SSE 上的延续。

---

## 8. 验证

### 8.1 多出口渲染

1. 新建 `condition` 节点 → 卡片里出现「分支 1」+「否则」两行，右侧各有一个小圆点；
2. 从「分支 1」圆点拖到某个下游节点 → 连线起点在**该行右侧**（不是卡片底部）；
3. 从「否则」圆点拖到另一个节点 → 两条边分别来自不同行。

### 8.2 分支增删

1. 面板点「新增分支」→ 卡片多一行「分支 2」，面板多一张卡片；
2. 把「分支 2」连到一个节点 → 保存成功；
3. 点「删除分支」→ 该行消失，**相关边同时消失**；
4. 再保存 → 成功（不是 400 `invalid sourceHandle`）。

### 8.3 未连线提示

1. 新增分支但不连线 → 面板出现红字「缺少出边：分支 2」；
2. 连上线 → 红字消失（验证 `edges` 在 `useMemo` 依赖里）；
3. 删除该边 → 红字重新出现。

### 8.4 保存校验

故意构造后端会拒绝的图：

```text
① 给「分支 1」连两条边 → 保存 400：duplicate edge for case case1
② 手工把某条边的 sourceHandle 改成 null（改库或旧图）→ 400：invalid sourceHandle: null
③ 删掉「否则」的边 → 400：else branch has no outgoing edge
```

前端**不会**阻止 ①，只会在保存时展示后端文案——这正是设计意图。

### 8.5 聚合

1. 建 `c1` 两分支分别连 `llm_a` / `llm_b`；
2. 两者都连到 `agg1`；
3. 面板配 `answer: ["{{ llm_a.text }}", "{{ llm_b.text }}"]`；
4. 运行 → `node_finished(agg1).output.answer` 是**实际执行分支**的文本，另一条为空但被跳过；
5. 保存时把 `values` 清空 → 面板禁止删到 0 项（按钮 disabled）。

### 8.6 迭代

1. 新建 `iteration` 节点 → 默认 `{{ inputs.items }}`、`{{ item }}`、`20`；
2. 输入 `[1.0, 2.5]` → 日志出现 `迭代 i1 1/2`、`2/2`；
3. 输出 `joined` 为 `"1\n2.5"`（TS 侧）；
4. 把最大次数改成 `1` → 运行 `run_failed exceeded max iterations: 1`；
5. 把输入改成 `2.5`（非整数）→ 失焦后回填 `2`（`Math.trunc`）；
6. 清空 → 失焦后回填 `20`。

### 8.7 事件展示

日志里应看到：

```text
条件 c1 → vip（VIP 用户）
迭代 i1 1/3
迭代 i1 2/3
迭代 i1 3/3
```

---

## 9. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| handle id 用 `caseId` | 消灭 UI id ↔ 路由键的映射表；边直接可用 |
| 多 handle 布局 | 每行 `position: relative`，否则 handle 全叠在卡片右侧 |
| `else` 固定在 UI 末尾 | 不可删/不可改名；语义是兜底，不是普通分支 |
| 删除分支必须删边 | 否则保存 400 `invalid sourceHandle`；让非法状态不可构造 |
| 前端不阻止重复边 | 引导而非强制；权威在后端；规则可能演进 |
| `missingBranches` 用 `useMemo` | 纯派生值，避免 `useEffect` 晚一拍 |
| 依赖漏 `edges` | 连完线红字不消失的经典 bug |
| 分支 id 只读 | 机器标识 vs 人类名称分离；改 id 要级联改边 |
| 一元运算符隐藏 value | 只隐藏不删除；切回时配置还在 |
| `nextCaseId` | 节点内唯一、可读、短；不用 UUID |
| `key={index}` | 受控输入不串值；但焦点可能跳；更稳是稳定 id |
| `maxIterations` 文本态 | `Number('')`/中途输入；onChange 宽松、onBlur 钳制 |
| 事件过 Zod | 不可信输入；失败显示原文不崩页面 |
| 默认值“能跑” | 同时是示例；避免加完节点就红 |

---

## 10. 下一步

- `05-验收.md`：阶段 8 的用例矩阵（分支顺序、`else`、聚合取值、迭代超限、`1.0` 跨端一致、前端连线）。
