# 02 · Composition 声明式装配与层设计

> 所属：阶段 11 · 自主 Agent 运行时
>
> 本篇覆盖：`packages/contract/agent-events.md` §3 的「组合与层语义」；`openapi.yaml` 的 `CompositionLayer` / `Composition` / `CreateAgentRunRequest` 三个 schema；`packages/contract/src/index.ts` 的 `AgentLayerName` / `CompositionLayer` / `Composition` 类型；`apps/api-ts/src/agent/composition.validator.ts` 与 `apps/api-py/app/agent/validator.py`（两端纯函数校验，逐条对齐）；`agent-state.ts` 与 `state.py`（层间共享状态）；两端的 `history` / `prompt` / `tools` / `output` 四层与 `llm` 层的**层接口**；以及执行器里「按数组顺序执行 + 层边界事件」的那段循环。
>
> **本篇首次教学**：① **Composition vs Graph**——工作流用「节点 + 连线」描述拓扑，Agent 运行时用「**有序的层**」描述阶段；讲清**为什么可以不要图**（层间执行顺序固定、变化的只是配置；但 `llm` 层内部仍有图）；② **「声明式装配」到底声明什么**——客户端提交的是**数据**（JSON），服务端把 `name` 映射到实现，**没有连线、没有坐标、没有前端画布**；③ **层的统一契约** `run(state, config)`——只读 `config`、只写自己负责的 `state` 字段；讲清「**状态归层所有、写回显式**」如何避免层之间互相踩；④ **`llm` 层必须恰好一个**——它是**唯一的执行核心**，其它层都是它的**输入准备 / 输出收尾**；⑤ **层的顺序即语义**——`prompt` 必须在 `llm` 之前、`output` 在之后；讲清**顺序错了不会 400，只会结果错**（例如 `output` 提前 → 输出为空）；⑥ **配置校验的分工与顺序**——`composition.validator.ts` 是**纯函数**，按 11 条固定顺序返回错误，两端逐字一致；⑦ **可选层的默认值**——`history` 不写 → 无历史；`tools` 不写 → 无工具；`maxMessages=20` / `compactionThreshold=12` / `keepRecent=6` / `maxRounds=5` **写进契约**；⑧ **砍掉了什么**——`Workspace` / `Binding` / `RuntimeLease` 资源账本与沙箱后端（E2B / OpenShell），以及砍掉后**失去了哪些能力**；⑨ **与工作流引擎的关系**——同一套工具注册表、同一套 `ChatOpenAI` 配置、同一套错误映射；**两个引擎并存**，各自适用不同场景。
>
> （已在前序篇教学、本篇只引用不重讲：OpenAPI 的 `paths` / `$ref` / `enum` / `additionalProperties` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；DTO 与 `ValidationPipe`、Pydantic v2 `BaseModel` / `ConfigDict(extra="forbid")` 见 `01-账号与认证/03-NestJS认证.md`、`00-项目初始化/06-FastAPI起步.md`；「业务规则属契约外、用**纯函数**两端各实现」见 `03-画布/01-图JSON契约与校验.md`；JSONB 存 JSON 文档见 `03-画布/02-Prisma-JSONB与两态.md`；SSE 帧格式与「**先校验、后开流**」的双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；`ChatOpenAI` / `.stream()` / `maxRetries=0` / `mapLlmError` 的 6 条规范文案见 `05-LLM节点/02-真实模型调用与流式.md`、`05-LLM节点/03-LLM错误映射.md`；`ToolDefinition`、`GET /tools` 能力目录、`executeTool` 与 `ToolError` 分类见 `06-工具调用/01-工具契约与内置工具.md`；**ReAct 循环 / LangGraph 条件边与环 /「跳过普通边」的陷阱**见 `06-工具调用/02-NestJS-ReAct循环与条件边.md`；`tryRenderTemplate` 的变量池语义见 `04-执行引擎/03-节点运行时与变量池.md`；「契约砍字段」的取舍见 `10-发布与API/01-发布语义与API-Key契约.md`。）
>
> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 11 的立论：第二个执行核心

阶段 4 到阶段 10，本项目只有一个执行核心：**工作流引擎**。它的输入是一张图（`nodes` + `edges` + `sourceHandle`），执行方式是「编译图 → 按边调度 → 发节点事件」。

阶段 11 加进来一个**并列**的执行核心：**自主 Agent 运行时**。它的输入不是图，而是一份 **`composition`**——一个**有序的层数组**：

```jsonc
{
  "version": "1",
  "layers": [
    { "name": "history", "config": {} },
    { "name": "prompt",  "config": { "system": "...", "template": "Q: {{ input }}" } },
    { "name": "tools",   "config": { "names": ["calculator"] } },
    { "name": "llm",     "config": { "maxRounds": 5 } },
    { "name": "output",  "config": {} }
  ]
}
```

这篇文章只回答一个问题：**为什么「有序的层」能替代「节点 + 连线」，以及这个替代在代码里是怎么落地的。**

### 0.1 一句话记住本篇

> **工作流描述「下一步去哪」，Agent 描述「按什么顺序准备、推理、收尾」。下一步恒定时，图就退化成列表，配置就是全部。**

### 0.2 本篇的四条边界（其它内容属本阶段其它篇）

| 不属本篇 | 去哪看 |
| --- | --- |
| 异步 Run 模型（`202` / `queued` / `running`）、事件持久化与 `Last-Event-ID` 重放、取消 | `01-Run模型与事件重放.md`；唯一真源 `packages/contract/agent-events.md` §1、§2、§4、§5 |
| `llm` 层内部的 ReAct 循环（`StateGraph` / 条件边 / 环 / `ToolMessage`） | `06-工具调用/02-NestJS-ReAct循环与条件边.md`、`03-ReAct循环与上下文压缩.md` |
| 历史压缩的算法细节、模板渲染的路径语义、工具定义与安全 | `03-ReAct循环与上下文压缩.md`；`04-执行引擎/03-节点运行时与变量池.md`、`06-工具调用/01-工具契约与内置工具.md` |
| 前端 Agent 调试面板与 SSE 重连 | `04-前端Agent控制台与SSE重连.md` |

---

## 1. 本篇目标

做完这一篇，你能：

- 说清 **Composition 与 Graph 的三个结构差异**（描述单位、拓扑是否可变、变化的东西），并解释**为什么 Agent 可以不要图**。
- 说清「声明式装配」的四个特征：**提交数据、`name` 分派、无连线/无坐标、校验前置**。
- 写出层的统一契约 `run(state, config)`，并画出**每一层读什么、写什么**的表格。
- 解释「**状态归层所有、写回显式**」的含义，以及它防住了哪一类 bug。
- 解释 **`llm` 层为什么必须恰好一个**；0 个和 2 个分别会发生什么。
- 说出四种典型**错序**的后果（`output` 提前、`prompt` 滞后、`tools` 滞后、`history` 滞后）。
- 按顺序背出**配置校验的 11 条规则**，并说清为什么顺序本身就是契约。
- 背出四个**默认值**（`20` / `12` / `6` / `5`）与 `maxRounds` 的三级回退。
- 说出砍掉的四样东西（`Workspace` / `Binding` / `RuntimeLease` / 沙箱后端）与**失去的三类能力**。
- 说出 Agent 运行时与工作流引擎**共用的三样东西**，以及两者各自适用什么场景。

**验收标准**

1. `POST /agent/runs` 提交一份**默认 5 层** composition，事件流里 `layer_started` 与 `layer_finished` **各 5 次**，且 `index` 从 `1` 到 `5`。
2. `layer_started` 的层顺序**逐字等于** `composition.layers` 的数组顺序（`history → prompt → tools → llm → output`）。
3. 以下 12 条错误文案**逐字命中**（见 §10.1）：`composition version must be 1` / `layer 3 name is required` / `composition must contain exactly one llm layer` / `layer llm appears more than once`（只会与「数量」那条一起出现） / `unknown layer: foo` / `layer history appears more than once` / `prompt layer template is required` / `tools layer references unknown tool: nope` / `history layer maxMessages must be between 1 and 100` / `llm layer maxRounds must be between 1 and 20` / `history layer compactionThreshold must be between 1 and 100` / `history layer keepRecent must be between 1 and 50`。
4. **多条错误**按 §9.6 的固定顺序用 `"; "` 连接；两端（`:3001` / `:8000`）返回的 `statusCode` 与 `message` **逐字节相同**。
5. 把 `output` 层挪到 `llm` 之前，运行**不会报错**，但 `run_finished.output` 为**空串**。
6. `composition` 里不写 `history` 层时，消息数组从空开始；不写 `tools` 层时，模型不会绑定任何工具。
7. 校验失败时 `agent_runs` 表**没有新增行**（400 发生在建 run 之前）。
8. 层配置里把 `maxMessages` 误拼成 `maxMessage`，**不会报错**，实际按默认 `20` 生效（自由结构的代价）。

---

## 2. 前置条件

| 前置 | 状态要求 | 出处 |
| --- | --- | --- |
| 本地中间件 | `docker compose ps` 里 `mini-dify-db` 为 `healthy` | `00-项目初始化/02-本地中间件Docker.md` |
| 契约可编译 | `pnpm run build:contract` 可用；阶段 11 的 `CONTRACT_VERSION` 为 **`0.11.0`** | `00-项目初始化/04`、`10-发布与API/01` |
| 认证就位 | 已能注册 / 登录；`Bearer` 令牌跨端互认 | `01-账号与认证/06`、`07` |
| Agent 表已迁移 | 已有 `agent_runs` / `agent_run_events` 两张表（迁移 `20261023151132_add_agent_runs`） | `01-Run模型与事件重放.md` |
| 工具注册表 | `calculator` / `get_current_time` / `http_get` 三个内置工具可用 | `06-工具调用/01` |
| 两套后端 | api-ts 监听 `:3001`、api-py 监听 `:8000` | `00-项目初始化/08` |
| LLM（可选） | 无真实密钥时，把 `LLM_BASE_URL` 指到 `node tools/mock-llm/server.mjs`（`:11435`） | `05-LLM节点/04-mock-LLM与无密钥自测.md` |

> 本篇的**校验部分完全不需要模型**：`validateComposition` 在创建运行之前执行，失败直接 400。
> 只有「跑一份合法 composition」才需要 provider；用 mock 即可，输出是确定性的（回显最后一条 user 消息，前缀 `echo: `）。

---

## 3. 先看清要做什么

### 3.1 文件地图

```
packages/contract/
   ├── agent-events.md            ← §3「组合与层语义」（唯一真源）                 （本篇 §4.1）
   ├── openapi.yaml               ← CompositionLayer / Composition / CreateAgentRunRequest（本篇 §4.2）
   └── src/index.ts               ← AgentLayerName / CompositionLayer / Composition （本篇 §4.3）

apps/api-ts/src/agent/
   ├── composition.validator.ts   ← 层语义校验（纯函数，11 条固定顺序）            （本篇 §5.1）
   ├── agent-state.ts             ← 层间共享状态 AgentRunState                     （本篇 §6.1）
   ├── layers/
   │    ├── history.layer.ts      ← 载入 + 确定性压缩                              （本篇 §7.1）
   │    ├── prompt.layer.ts       ← 渲染 system / template                         （本篇 §7.2）
   │    ├── tools.layer.ts        ← 声明工具名                                     （本篇 §7.3）
   │    ├── llm.layer.ts          ← ReAct 循环（唯一执行核心）                     （本篇 §8.1 摘录）
   │    └── output.layer.ts       ← 取最后一条 assistant 消息                       （本篇 §7.4）
   └── agent-runner.service.ts    ← 按数组顺序执行 + 层边界事件                     （本篇 §3.4 摘录）

apps/api-py/app/agent/
   ├── validator.py               ← 与 TS 逐条对齐的校验                           （本篇 §5.2）
   ├── state.py                   ← 共享状态（dataclass）                          （本篇 §6.2）
   ├── layers/{history,prompt,tools,llm,output}.py                                （本篇 §7、§8.2）
   └── runner.py                  ← 与 TS 同构的执行循环                           （本篇 §3.4 摘录）
```

### 3.2 一份默认 composition 的「形状」

| 位置 | 表达什么 | 谁来定 |
| --- | --- | --- |
| `layers` 的**数组下标** | 执行顺序 | 客户端（唯一的顺序来源） |
| `layers[].name` | 这一阶段是什么（闭集 5 个） | 客户端，服务端校验 |
| `layers[].config` | 这一阶段的参数 | 客户端，按 `name` 解释 |
| `input` | 本次运行唯一的模板变量来源 | 客户端 |

注意两件事：

1. **没有** `edges` / `position` / `sourceHandle` / `nodes`——这不是「画布的另一种写法」，而是**根本不需要拓扑**。
2. `layer.name` 的取值是**闭集**（`history` / `prompt` / `tools` / `llm` / `output`），但**顺序不受层名约束**；`LAYER_NAMES` 常量只是白名单，不是执行顺序（§9.5 会专门讲这个坑）。

### 3.3 一次请求到执行：composition 的旅程

```
POST /agent/runs  { input, composition }
  │
  ├─ 1. 框架层校验（DTO / Pydantic）
  │      input 1..4000 字符；composition 必须是对象
  │      失败 → 400（§1.1 的通用文案）
  │
  ├─ 2. 纯函数校验（validateComposition / validate_composition）
  │      composition.version / 层 name 必填 / llm 数量 / 未知层 / 重复层 /
  │      prompt.template / tools.names / history 三个范围 / llm.maxRounds
  │      失败 → 400（§11 的专用文案，多条 "; " 连接）——**不建 run**
  │
  ├─ 3. 落库：agent_runs(composition JSONB, input, status='queued')
  │      + agent_run_events(seq=1, run_queued)
  │
  ├─ 4. 立即返回 202 { id, status: 'queued' }
  │
  └─ 5. 后台执行器：**从 DB 读回** composition
         for (const layer of layers) {           ← 顺序完全由数组决定
           layer_started(name, index)
           name → 实现（switch / if-elif）→ run(state, config)
           layer_finished(name, index)
         }
         run_finished(output)
```

第 5 步有一个容易忽略的重点：**执行器不信请求对象，只信 DB 里那份 JSON**。请求对象在 `accept()` 之后就没有用了；执行时读的是 `agent_runs.composition`。这让「这次运行到底用了什么配置」变成一条可审计、可重放的记录——这正是**声明式**的直接收益（§9.2）。

### 3.4 执行器里的「顺序」长什么样

**完整文件路径：`apps/api-ts/src/agent/agent-runner.service.ts`**（摘录 `executeRun` 的循环与 `runLayer`；其余部分见 `01-Run模型与事件重放.md`）

```ts
    emit('run_started', { runId })
    try {
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]
        // 层边界：开始前检查取消
        await state.checkCancelled()
        emit('layer_started', { layer: layer.name, index: index + 1 })
        await this.runLayer(layer, state, emit)
        emit('layer_finished', { layer: layer.name, index: index + 1 })
      }
      await finish(
        'run_finished',
        { output: state.output, elapsedMs: Date.now() - startedMs },
        { status: 'succeeded', output: state.output, error: null, finishedAt: new Date() },
      )
    } catch (error) {
      if (error instanceof AgentRunCancelled) {
        await finish('run_cancelled', { runId }, { status: 'cancelled', finishedAt: new Date() })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      await finish(
        'run_failed',
        { message },
        { status: 'failed', error: message, finishedAt: new Date() },
      )
    }
  }

  /** 按层名分派（顺序完全由 `composition.layers` 决定）。 */
  private async runLayer(
    layer: CompositionLayer,
    state: AgentRunState,
    emit: AgentEmit,
  ): Promise<void> {
    const config = isPlainObject(layer.config) ? layer.config : {}
    switch (layer.name) {
      case 'history':
        runHistoryLayer(state, config, emit)
        return
      case 'prompt':
        runPromptLayer(state, config, emit)
        return
      case 'tools':
        runToolsLayer(state, config, emit)
        return
      case 'llm':
        await runLlmLayer(state, config, emit)
        return
      case 'output':
        runOutputLayer(state, config, emit)
        return
      default:
        // composition 校验已拦截未知层名，这里只是类型收敛
        return
    }
  }
```

**这段在干什么**

1. **顺序就是 `for` 循环**：没有排序、没有优先级、没有拓扑排序。第 1 个层永远先跑。
2. **层边界事件由执行器发，不由层发**：`layer_started` / `layer_finished` 包住 `runLayer`，所以每层恰好一对；层实现完全不需要知道 SSE 的存在。
3. **`index` 是下标 + 1**：与契约 `agent-events.md` §2 的「`index` 从 1 开始」逐字对应。
4. **层抛错时**：该层不会发 `layer_finished`，直接进入 `run_failed`。终态仍然唯一（§2.1 的「三恰有其一」）。
5. **`switch` 就是「registry」**：`name` 只可能落到一个实现；未知层名在 `accept` 时已被校验拦截，`default` 只是类型收敛。

Python 侧同构：

**完整文件路径：`apps/api-py/app/agent/runner.py`**（摘录 `_execute_run` 的循环与 `_run_layer`）

```python
        await emit("run_started", {"runId": run_id})
        try:
            for index, layer in enumerate(layers):
                # 层边界：开始前检查取消
                await self._assert_not_cancelled(run_id)
                name = layer.get("name") if isinstance(layer, dict) else None
                await emit("layer_started", {"layer": name, "index": index + 1})
                config = (
                    layer.get("config")
                    if isinstance(layer, dict) and isinstance(layer.get("config"), dict)
                    else {}
                )
                await self._run_layer(name, config, state, emit)
                await emit("layer_finished", {"layer": name, "index": index + 1})
            elapsed_ms = int((time.time() - started_ms) * 1000)
            await finish(
                "run_finished",
                {"output": state.output, "elapsedMs": elapsed_ms},
                "succeeded",
                output=state.output,
            )
        except AgentRunCancelled:
            await finish("run_cancelled", {"runId": run_id}, "cancelled")
        except Exception as error:  # noqa: BLE001 - 执行期错误统一归一为 run_failed
            message = str(error)
            await finish("run_failed", {"message": message}, "failed", error=message)

    async def _run_layer(
        self,
        name: Any,
        config: dict[str, Any],
        state: AgentRunState,
        emit: AgentEmit,
    ) -> None:
        """按层名分派（顺序完全由 `composition.layers` 决定）。"""
        if name == "history":
            run_history_layer(state, config)
        elif name == "prompt":
            run_prompt_layer(state, config)
        elif name == "tools":
            run_tools_layer(state, config)
        elif name == "llm":
            await run_llm_layer(state, config, emit)
        elif name == "output":
            run_output_layer(state, config)
        # composition 校验已拦截未知层名，其余情况什么也不做
```

**这段在干什么**

`for index, layer in enumerate(layers)` 与 TS 的 `for (let index = 0; ...)` 是同一件事；`elif` 链与 `switch` 是同一张分派表。**唯一要逐字对齐的是事件名、`index` 起点、以及「先 started 后 finished」的包夹关系**。

---

## 4. 完整代码：契约

### 4.1 `packages/contract/agent-events.md` §3（组合与层语义）

**完整文件路径：`packages/contract/agent-events.md`**（摘录 §3；§1 帧格式、§2 事件表、§4 重放、§5 取消见 `01-Run模型与事件重放.md`）

````markdown
## 3. 组合与层语义

```jsonc
{
  "version": "1",
  "layers": [
    { "name": "history", "config": {} },
    { "name": "prompt",  "config": { "system": "...", "template": "Q: {{ input }}" } },
    { "name": "tools",   "config": { "names": ["calculator"] } },
    { "name": "llm",     "config": { "model": "mock-model", "maxRounds": 5 } },
    { "name": "output",  "config": {} }
  ]
}
```

- `layers` **按数组顺序**执行，层间共享同一份消息数组与工具声明。
- `llm` 层**必须恰好一个**（0 个或多个均 400）；每个层名在数组里**最多出现一次**；
  层名只能是 `history` / `prompt` / `tools` / `llm` / `output`（否则 400，见 §6）。
- 层与层之间不做隐式重排：例如 `prompt` 写在 `history` 之前，则历史消息会排在
  prompt 的 system/user 消息**之后**（由客户端自行决定顺序）。
- 请求体的 `input`（1..4000 字符）是本次运行唯一的模板变量来源。

### 3.1 `history` 层

`config`：

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `messages` | `Array<{role, content}>` | `[]` | 历史消息，`role` 取 `user` / `assistant` / `system` |
| `maxMessages` | integer `1..100` | `20` | 压缩后保留的**最后 N 条** |
| `compactionThreshold` | integer `1..100` | `12` | 超过该条数才触发压缩 |
| `keepRecent` | integer `1..50` | `6` | 压缩时原样保留的**最后 N 条** |

**历史压缩（确定性，两端一致）**，严格按以下两步：

1. 若 `len(messages) > compactionThreshold`：把**前 `len - keepRecent` 条**替换成
   **一条** `{"role": "system", "content": "[compacted] {n} earlier messages omitted"}`，
   其中 `n = len - keepRecent`（被替换的条数），后 `keepRecent` 条原样保留。
2. 再按 `maxMessages` **保留最后 N 条**（不足 N 条时全部保留）。

例：20 条消息、`compactionThreshold = 12`、`keepRecent = 6` →
先变成 `1 + 6 = 7` 条（首条为 `[compacted] 14 earlier messages omitted`），
`maxMessages = 20` 不再截断，最终 7 条。

> 这是「**确定性截断**」而非 LLM 摘要：真实系统通常会调用模型对历史做摘要压缩，
> 但那样无法保证两端逐字节一致、也无法复现。本项目为可复现性选择确定性方案。

压缩后的消息按 `user` / `assistant` / `system` 角色原样进入消息数组（`history` 层自身
不发 `token`；它只影响后续 `llm` 层看到的上下文）。

### 3.2 `prompt` 层

`config`：

| 键 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `system` | string | 否 | system 消息；空字符串或缺失则该层不追加 system 消息 |
| `template` | string | **是** | user 消息模板（缺失或非字符串 → 400） |

- 渲染作用域**只有 `{ "input": <请求里的 input> }`**：`{{ input }}` 被替换为输入文本。
- 复用工作流的**安全模板语义**（`tryRenderTemplate`）：路径不存在时替换为**空串**，
  不抛错；模板其余文本原样保留。
- 渲染后追加 `system`（非空时）与 `user` 消息到共享消息数组。

### 3.3 `tools` 层

`config`：

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `names` | `string[]` | 本轮可用工具名，必须都在注册表（`GET /tools`）中 |

未知工具名在**接受运行前**即 400（`tools layer references unknown tool: {name}`），
不会等到执行期。`names` 缺失或空数组表示不使用工具。

### 3.4 `llm` 层

`config`：

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 环境变量 `LLM_MODEL` | 为空时回退 |
| `maxRounds` | integer `1..20` | `5`（可由 `AGENT_MAX_ROUNDS` 覆盖默认值） | ReAct 工具轮上限 |
| `temperature` | number | — | 透传给 provider |

ReAct 循环用 **LangGraph `StateGraph` + 条件边 + 环**实现（节点 `llm` 与 `tools`），
工作流引擎阶段 6 同技术：

- `llm` 节点：逐 chunk 发 `token`；有 `tool_calls` → 条件边转到 `tools`，否则结束循环。
- `tools` 节点：发 `tool_call` → 执行（复用工具注册表）→ 发 `tool_result` →
  追加 `ToolMessage` → 回到 `llm`。
- `round` 从 1 开始；超过 `maxRounds` → `run_failed`，`message` 为
  `agent rounds exceeded: {max}`。
- provider 错误复用工作流的映射规则（`mapLlmError`，见 `error-messages.md` §5）；
  工具失败为 `tool {name} failed: {reason}`（reason 取值见 §6.2）。

### 3.5 `output` 层

`config`：`{}`（无字段）。取消息数组中**最后一条 assistant 消息**的文本作为最终输出，
写入 `run_finished.output` 与 `AgentRun.output`。没有 assistant 消息时输出为空串。
````

**这段在干什么**

1. 这是**唯一的语义真源**：层的配置键、默认值、执行顺序、压缩算法都写在这里；两端的代码只是它的两份实现。
2. 「`layers` 按数组顺序执行」「不做隐式重排」这两句是**顺序即语义**的契约依据（§9.5）。
3. 「`llm` 必须恰好一个」「每个层名最多一次」是**校验器第一条/第三条规则**的契约依据（§9.6）。
4. 每一层都只描述「读什么、写什么」，没有描述「下一步去哪」——**这就是它为什么不需要图**。

### 4.2 `openapi.yaml` 的三个 schema

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
    CompositionLayer:
      type: object
      additionalProperties: false
      required: [name, config]
      description: 自主 Agent 的一层；各层 `config` 形状与语义见 packages/contract/agent-events.md §3。
      properties:
        name:
          type: string
          enum: [history, prompt, tools, llm, output]
        config:
          type: object
          additionalProperties: true
          description: 该层的配置（自由结构，按 `name` 解释）

    Composition:
      type: object
      additionalProperties: false
      required: [version, layers]
      description: >-
        Agent 运行组合。`layers` **按数组顺序**执行；其中 `llm` 层**必须恰好一个**。
      properties:
        version:
          type: string
          description: 组合结构版本，当前固定为 `"1"`
        layers:
          type: array
          items:
            $ref: "#/components/schemas/CompositionLayer"

    CreateAgentRunRequest:
      type: object
      additionalProperties: false
      required: [input, composition]
      properties:
        input:
          type: string
          minLength: 1
          maxLength: 4000
        composition:
          $ref: "#/components/schemas/Composition"
```

**这段在干什么**

1. `CompositionLayer.name` 用 `enum` 把层名钉成**闭集**；这是契约层面的第一道约束（运行期仍以校验器为准）。
2. `CompositionLayer.config` 是**唯一** `additionalProperties: true` 的对象：层配置是自由结构，按 `name` 解释。**代价**是 OpenAPI 无法替你发现配置拼写错误（§9.7 的坑）。
3. `Composition` 与 `CreateAgentRunRequest` 都是 `additionalProperties: false`：多传 `nodes` / `edges` 会直接 400——契约层面就否定了「用图冒充 composition」。
4. `version` 在 schema 里是 `required`，描述写「当前固定为 `"1"`」；运行期校验器**同样校验**：必须是字符串 `"1"`，否则 400 `composition version must be 1`（§9.6 的规则 0）。

### 4.3 `packages/contract/src/index.ts` 的类型

**完整文件路径：`packages/contract/src/index.ts`**（摘录阶段 11 段落）

```ts
/**
 * 自主 Agent 运行时（阶段 11）。事件协议唯一真源：
 * `packages/contract/agent-events.md`；错误文案见 `error-messages.md` §11。
 */

/** 组合里允许的层名（按数组顺序执行）。 */
export type AgentLayerName = 'history' | 'prompt' | 'tools' | 'llm' | 'output'

/** 组合的一层；`config` 为自由结构，按 `name` 解释（见 agent-events.md §3）。 */
export interface CompositionLayer {
  name: AgentLayerName
  config: Record<string, unknown>
}

/** 组合：`layers` 按数组顺序执行，`llm` 层必须恰好一个。 */
export interface Composition {
  /** 结构版本，当前固定为 `"1"` */
  version: string
  layers: CompositionLayer[]
}

/** POST /agent/runs 请求体。 */
export interface CreateAgentRunRequest {
  /** 1-4000 位 */
  input: string
  composition: Composition
}
```

**这段在干什么**

1. `AgentLayerName` 是**联合字面量类型**，编译期就限制了 `name`；运行期由校验器再兜一次（跨语言只能靠运行期）。
2. `config: Record<string, unknown>` 刻意**不给每层单独建类型**：层的配置是数据，不是 API 形状；这样新增一个配置键不需要改契约类型（但需要改契约文档）。
3. `Composition` 只表达「一份有序的层数组」，**没有任何拓扑字段**。类型本身就在说明「这里不需要边」。

---

## 5. 完整代码：composition 校验（两端）

### 5.1 `apps/api-ts/src/agent/composition.validator.ts`

**完整文件路径：`apps/api-ts/src/agent/composition.validator.ts`**

```ts
import type { AgentLayerName } from '@mini-dify/contract'

import { hasTool } from '../tools/registry'

/** 允许的层名（按 `layers` 数组顺序执行）。 */
const LAYER_NAMES: readonly string[] = ['history', 'prompt', 'tools', 'llm', 'output']

interface ParsedLayer {
  name: unknown
  config: Record<string, unknown>
  /** 该层是否是一个对象（非对象无法携带 `name` / `config`）。 */
  isObject: boolean
}

/**
 * composition 校验（纯函数，唯一真源见 error-messages.md §11）。
 *
 * 返回的错误**按固定顺序**排列（多条用 `"; "` 连接后作为 400 的 `message`）：
 * 0. `composition.version`；1. 层 `name` 必填；2. `llm` 层数量；3. 未知层名；
 * 4. 同层重复；5. `prompt.template`；6. `tools.names`；7. `history.maxMessages`；
 * 8. `history.compactionThreshold`；9. `history.keepRecent`；10. `llm.maxRounds`。
 * 同一规则内按 `layers` 数组顺序；层 `name` 缺失时跳过该层的后续检查。
 */
export function validateComposition(composition: unknown): string[] {
  const layers = parseLayers(composition)
  const errors: string[] = []

  const version = isPlainObject(composition) ? composition.version : undefined
  if (version !== '1') {
    errors.push('composition version must be 1')
  }

  // 层必须是对象、`name` 必须是非空字符串；命中后跳过该层的后续检查。
  const named = layers.map(
    (layer) => layer.isObject && typeof layer.name === 'string' && layer.name !== '',
  )
  named.forEach((ok, index) => {
    if (!ok) {
      errors.push(`layer ${index + 1} name is required`)
    }
  })

  const llmCount = layers.filter((layer, index) => named[index] && layer.name === 'llm').length
  if (llmCount !== 1) {
    errors.push('composition must contain exactly one llm layer')
  }

  layers.forEach((layer, index) => {
    if (!named[index]) {
      return
    }
    if (!isLayerName(layer.name)) {
      errors.push(`unknown layer: ${String(layer.name)}`)
    }
  })

  const seen = new Set<string>()
  const reported = new Set<string>()
  for (const layer of layers) {
    if (!isLayerName(layer.name)) {
      continue
    }
    if (seen.has(layer.name) && !reported.has(layer.name)) {
      errors.push(`layer ${layer.name} appears more than once`)
      reported.add(layer.name)
    }
    seen.add(layer.name)
  }

  for (const layer of layers) {
    if (layer.name === 'prompt' && typeof layer.config.template !== 'string') {
      errors.push('prompt layer template is required')
    }
  }

  for (const layer of layers) {
    if (layer.name !== 'tools') {
      continue
    }
    const names = layer.config.names
    if (!Array.isArray(names)) {
      continue
    }
    for (const name of names) {
      if (typeof name !== 'string' || !hasTool(name)) {
        errors.push(`tools layer references unknown tool: ${String(name)}`)
      }
    }
  }

  for (const layer of layers) {
    if (layer.name === 'history' && !inRange(layer.config.maxMessages, 1, 100)) {
      errors.push('history layer maxMessages must be between 1 and 100')
    }
  }
  for (const layer of layers) {
    if (layer.name === 'history' && !inRange(layer.config.compactionThreshold, 1, 100)) {
      errors.push('history layer compactionThreshold must be between 1 and 100')
    }
  }
  for (const layer of layers) {
    if (layer.name === 'history' && !inRange(layer.config.keepRecent, 1, 50)) {
      errors.push('history layer keepRecent must be between 1 and 50')
    }
  }
  for (const layer of layers) {
    if (layer.name === 'llm' && !inRange(layer.config.maxRounds, 1, 20)) {
      errors.push('llm layer maxRounds must be between 1 and 20')
    }
  }

  return errors
}

/** 从 composition 里取出层数组（`layers` 非数组时视为空）。 */
function parseLayers(composition: unknown): ParsedLayer[] {
  if (!isPlainObject(composition) || !Array.isArray(composition.layers)) {
    return []
  }
  return composition.layers.map((item) => {
    if (!isPlainObject(item)) {
      return { name: item, config: {}, isObject: false }
    }
    return {
      name: item.name,
      config: isPlainObject(item.config) ? item.config : {},
      isObject: true,
    }
  })
}

function isLayerName(name: unknown): name is AgentLayerName {
  return typeof name === 'string' && LAYER_NAMES.includes(name)
}

/** 字段缺省（`undefined`）视为合法（取默认值）；提供了则必须是闭区间内的整数。 */
function inRange(value: unknown, min: number, max: number): boolean {
  if (value === undefined) {
    return true
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

**这段在干什么（按 11 条规则）**

0. **先查 `composition.version`**：必须严格等于字符串 `"1"`（`!==` 比较，缺失 / 数字 `1` / `null` 都不通过）→ `composition version must be 1`。放在**最前**，因为它约束的是整份文档。
1. **再查每一层的 `name`**：层不是对象、`name` 不是字符串、或 `name` 为空串 → `layer {index} name is required`（`index` 从 1）。**先于「未知层名」**，且命中后**跳过该层的后续检查**（`named[]` 掩码）。
2. **再数 `llm`**：只统计 `named` 为真的层，`!== 1` → 一条错误。这是唯一一条「关心全局」的规则。
3. **再扫未知层名**：只对 `named` 的层、按数组顺序逐个报 `unknown layer: {name}`。
4. **再查重复**：`seen` / `reported` 两个集合，保证同一个层名**只报一次**（在第二次出现时报）。
5. **`prompt.template` 必填**：`typeof !== 'string'` 即报错（空串是合法字符串，会渲染成空 user 消息）。
6. **`tools.names`**：先要求是数组（缺失/非数组**跳过**，意为不用工具）；再逐个查注册表 `hasTool`。
7–9. **`history` 三个范围**：`maxMessages 1..100`、`compactionThreshold 1..100`、`keepRecent 1..50`。
10. **`llm.maxRounds 1..20`**。

**三个实现细节**

- `parseLayers` 对「`layers` 不是数组」返回 `[]` → 于是「`llm` 数量」规则必然命中（数量为 0）。**空 composition 也是一条清楚的 400**，而不是崩溃；若 `version` 缺失，还会多一条 `composition version must be 1`。
- `inRange(undefined)` 返回 `true`：**字段缺省合法**，因为每一层都有默认值（§9.7）。
- 校验器只做「结构 + 范围」，**不做层序语义检查**（`prompt` 是否在 `llm` 前、`output` 是否在后都不管）。这是契约 §3 的明确选择：顺序由客户端决定。

### 5.2 `apps/api-py/app/agent/validator.py`

**完整文件路径：`apps/api-py/app/agent/validator.py`**

```python
"""composition 校验（纯函数，唯一真源见 error-messages.md §11）。

与 api-ts 的 `composition.validator.ts` 逐条对齐。返回的错误**按固定顺序**排列
（多条用 `"; "` 连接后作为 400 的 `message`）：
0. `composition.version`；1. 层 `name` 必填；2. `llm` 层数量；3. 未知层名；
4. 同层重复；5. `prompt.template`；6. `tools.names`；7. `history.maxMessages`；
8. `history.compactionThreshold`；9. `history.keepRecent`；10. `llm.maxRounds`。
同一规则内按 `layers` 数组顺序；层 `name` 缺失时跳过该层的后续检查。
"""

from typing import Any

from app.agent.state import js_string
from app.tools.registry import has_tool

# 允许的层名（按 `layers` 数组顺序执行）
LAYER_NAMES: tuple[str, ...] = ("history", "prompt", "tools", "llm", "output")


def validate_composition(composition: Any) -> list[str]:
    layers = _parse_layers(composition)
    errors: list[str] = []

    version = composition.get("version") if _is_plain_object(composition) else None
    if version != "1":
        errors.append("composition version must be 1")

    # 层必须是对象、`name` 必须是非空字符串；命中后跳过该层的后续检查。
    named = [
        layer["is_object"] and isinstance(layer["name"], str) and layer["name"] != ""
        for layer in layers
    ]
    for index, ok in enumerate(named):
        if not ok:
            errors.append(f"layer {index + 1} name is required")

    llm_count = sum(1 for layer, ok in zip(layers, named) if ok and layer["name"] == "llm")
    if llm_count != 1:
        errors.append("composition must contain exactly one llm layer")

    for layer, ok in zip(layers, named):
        if ok and not _is_layer_name(layer["name"]):
            errors.append(f"unknown layer: {layer['name']}")

    seen: set[str] = set()
    reported: set[str] = set()
    for layer in layers:
        name = layer["name"]
        if not _is_layer_name(name):
            continue
        if name in seen and name not in reported:
            errors.append(f"layer {name} appears more than once")
            reported.add(name)
        seen.add(name)

    for layer in layers:
        if layer["name"] == "prompt" and not isinstance(layer["config"].get("template"), str):
            errors.append("prompt layer template is required")

    for layer in layers:
        if layer["name"] != "tools":
            continue
        names = layer["config"].get("names")
        if not isinstance(names, list):
            continue
        for name in names:
            if not isinstance(name, str) or not has_tool(name):
                errors.append(f"tools layer references unknown tool: {js_string(name)}")

    for layer in layers:
        if layer["name"] == "history" and not _field_in_range(
            layer["config"], "maxMessages", 1, 100
        ):
            errors.append("history layer maxMessages must be between 1 and 100")
    for layer in layers:
        if layer["name"] == "history" and not _field_in_range(
            layer["config"], "compactionThreshold", 1, 100
        ):
            errors.append("history layer compactionThreshold must be between 1 and 100")
    for layer in layers:
        if layer["name"] == "history" and not _field_in_range(
            layer["config"], "keepRecent", 1, 50
        ):
            errors.append("history layer keepRecent must be between 1 and 50")
    for layer in layers:
        if layer["name"] == "llm" and not _field_in_range(
            layer["config"], "maxRounds", 1, 20
        ):
            errors.append("llm layer maxRounds must be between 1 and 20")

    return errors


def _parse_layers(composition: Any) -> list[dict[str, Any]]:
    """从 composition 里取出层数组（`layers` 非数组时视为空）。"""
    if not _is_plain_object(composition) or not isinstance(composition.get("layers"), list):
        return []
    return [
        {
            "name": item.get("name"),
            "config": item.get("config") if _is_plain_object(item.get("config")) else {},
            "is_object": True,
        }
        if _is_plain_object(item)
        else {"name": item, "config": {}, "is_object": False}
        for item in composition["layers"]
    ]


def _is_layer_name(name: Any) -> bool:
    return isinstance(name, str) and name in LAYER_NAMES


def _field_in_range(config: dict[str, Any], key: str, minimum: int, maximum: int) -> bool:
    """字段缺省（键不存在）视为合法；显式提供了（含 `null`）则必须是闭区间内的整数。"""
    if key not in config:
        return True
    value = config[key]
    return _is_integer(value) and minimum <= value <= maximum


def _is_integer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and value.is_integer()


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)
```

**这段在干什么**

与 TS 逐行同构。三个**专门为对齐而存在**的细节：

1. `js_string(...)` 在 `tools.names` 的文案里替代 Python 的 `str(...)`：它模拟 JS `String(value)` 的标量表现（`None → "null"`、`True → "true"`、整数值的 `float → "1"`、`dict → "[object Object]"`）。这样「工具名是数字 / 布尔 / 对象」时，两端文案仍然一样。注意：**层名不再需要它**——非字符串 / 空串的 `name` 已在第 1 条规则被 `layer {index} name is required` 拦下，能走到「未知层名」的 `name` 一定是字符串。
2. `_is_integer` **显式排除 `bool`**：Python 里 `isinstance(True, int)` 是 `True`，若不排除，`maxRounds: true` 会被当成 `1` 而放行；TS 的 `typeof true !== 'number'` 天然拒绝。这是跨语言校验最常见的坑之一。
3. `version != "1"` 用**严格不等**（而不是 `isinstance(str)` 后放行）：缺失、数字 `1`、`null`、`"2"` 全部落到同一条文案，与 TS 的 `version !== '1'` 逐字节对齐。

### 5.3 两段并读：逐条对齐表

| # | 规则 | TS（`composition.validator.ts`） | Py（`validator.py`） | 文案 |
| --- | --- | --- | --- | --- |
| 0 | `composition.version` | `version !== '1'` | `version != "1"` | `composition version must be 1` |
| 1 | 层 `name` 必填 | `layer.isObject && typeof name === 'string' && name !== ''` → `named[]` | `layer["is_object"] and isinstance(name, str) and name != ""` → `named[]` | `layer {index} name is required` |
| 2 | `llm` 数量 | `filter((l, i) => named[i] && l.name === 'llm').length !== 1` | `sum(1 for l, ok in zip(layers, named) if ok and ...) != 1` | `composition must contain exactly one llm layer` |
| 3 | 未知层名 | `!isLayerName` → `String(name)` | `not _is_layer_name` → `f"{name}"`（已保证是字符串） | `unknown layer: {name}` |
| 4 | 同层重复 | `seen` / `reported` | `seen` / `reported` | `layer {name} appears more than once` |
| 5 | `prompt.template` | `typeof !== 'string'` | `not isinstance(..., str)` | `prompt layer template is required` |
| 6 | `tools.names` | `Array.isArray` + `hasTool` | `isinstance(list)` + `has_tool` | `tools layer references unknown tool: {name}` |
| 7 | `history.maxMessages` | `inRange(..., 1, 100)` | `_field_in_range(..., 1, 100)` | `history layer maxMessages must be between 1 and 100` |
| 8 | `history.compactionThreshold` | `inRange(..., 1, 100)` | `_field_in_range(..., 1, 100)` | `history layer compactionThreshold must be between 1 and 100` |
| 9 | `history.keepRecent` | `inRange(..., 1, 50)` | `_field_in_range(..., 1, 50)` | `history layer keepRecent must be between 1 and 50` |
| 10 | `llm.maxRounds` | `inRange(..., 1, 20)` | `_field_in_range(..., 1, 20)` | `llm layer maxRounds must be between 1 and 20` |

**实测**：同一批非法 composition 分别打 `:3001` 与 `:8000`，两端的 `{statusCode, message, error}` **逐字节相同**，比对结果为 `BYTE_EQUAL=True`（含 `composition version must be 1` 与 `layer 3 name is required`）。

**「同一规则内按数组顺序」的含义**

- 规则 1：`layers` 里有三个不合格的层时，按数组顺序报三条 `layer {index} name is required`。
- 规则 3：`layers` 里有三个未知层时，按数组顺序报三条。
- 规则 4：同一个层名重复三次，只报**一次**（在第二次出现时）。
- 规则 6：`names` 里两个未知工具，按 `names` 数组顺序报两条。

**「越界」的判定边界（两端一致）**

| 输入 | TS | Py | 是否报错 |
| --- | --- | --- | --- |
| 键缺省 | `undefined` → `true` | 键不存在 → `true` | 否（取默认值） |
| `null` | 不是 `number` → `false` | 不是 `int` / `int-valued float` → `false` | 是 |
| `5` | `Number.isInteger(5)` → 是 | `isinstance(5, int)` → 是 | 否 |
| `5.0` | `Number.isInteger(5.0)` → 是 | `float.is_integer()` → 是 | 否 |
| `true` | `typeof !== 'number'` → 否 | 显式排除 `bool` → 否 | 是 |
| `1.5` | `Number.isInteger` → 否 | `is_integer()` → 否 | 是 |

---

## 6. 完整代码：层间共享状态

### 6.1 `apps/api-ts/src/agent/agent-state.ts`

**完整文件路径：`apps/api-ts/src/agent/agent-state.ts`**

```ts
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { LlmNodeData } from '@mini-dify/contract'

/** `llm` 层的运行参数（来自该层 `config`，缺省值见 agent-events.md §3.4）。 */
export interface AgentLlmConfig {
  model?: string
  maxRounds: number
  temperature?: number
}

/**
 * 一次 Agent 运行在各层之间共享的状态。
 *
 * `messages` 是**唯一的上下文载体**：`history` 载入、`prompt` 追加、`llm` 在其上
 * 做 ReAct 循环（含 `ToolMessage`），`output` 取最后一条 assistant 消息。
 */
export interface AgentRunState {
  input: string
  messages: BaseMessage[]
  toolNames: string[]
  llm: AgentLlmConfig
  output: string
  /** 层边界 / 工具轮边界调用；已请求取消时抛 `AgentRunCancelled`。 */
  checkCancelled: () => Promise<void>
}

/** 把契约里的历史消息（`{role, content}`）转成 LangChain 消息；未知角色丢弃。 */
export function toLangChainMessage(role: unknown, content: unknown): BaseMessage | null {
  const text = typeof content === 'string' ? content : String(content ?? '')
  if (role === 'user') {
    return new HumanMessage(text)
  }
  if (role === 'assistant') {
    return new AIMessage(text)
  }
  if (role === 'system') {
    return new SystemMessage(text)
  }
  return null
}

/** 组装 `runLlmStep` 需要的 `LlmNodeData`（模型为空时由它回退到 `LLM_MODEL`）。 */
export function llmNodeDataOf(state: AgentRunState): LlmNodeData {
  const data: LlmNodeData = {
    title: '',
    model: state.llm.model ?? '',
    prompt: '',
    tools: state.toolNames,
  }
  if (state.llm.temperature !== undefined) {
    data.temperature = state.llm.temperature
  }
  return data
}

/** 取消息的文本内容（字符串原样；内容分片数组拼接 text；其余紧凑 JSON）。 */
export function messageText(message: BaseMessage): string {
  const content: unknown = message.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        const text = (part as unknown as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      })
      .join('')
  }
  if (content === null || content === undefined) {
    return ''
  }
  return JSON.stringify(content)
}
```

### 6.2 `apps/api-py/app/agent/state.py`

**完整文件路径：`apps/api-py/app/agent/state.py`**

```python
"""Agent 运行期共享状态（对应 api-ts 的 `agent-state.ts`）。

`messages` 是**唯一的上下文载体**：`history` 载入、`prompt` 追加、`llm` 在其上
做 ReAct 循环（含 `ToolMessage`）、`output` 取最后一条 assistant 消息。
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage


@dataclass
class AgentLlmConfig:
    """`llm` 层的运行参数（来自该层 `config`，缺省值见 agent-events.md §3.4）。"""

    model: str | None = None
    max_rounds: int = 5
    temperature: float | None = None


CheckCancelled = Callable[[], Awaitable[None]]


@dataclass
class AgentRunState:
    """一次 Agent 运行在各层之间共享的状态。"""

    input: str
    messages: list[BaseMessage] = field(default_factory=list)
    tool_names: list[str] = field(default_factory=list)
    llm: AgentLlmConfig = field(default_factory=AgentLlmConfig)
    output: str = ""
    # 层边界 / 工具轮边界调用；已请求取消时抛 `AgentRunCancelled`
    check_cancelled: CheckCancelled | None = None


def js_string(value: Any) -> str:
    """对齐 JS `String(value)` 的常见标量表现（用于错误文案与历史内容转换）。"""
    if isinstance(value, str):
        return value
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        # JS `Array.prototype.join(',')`：null / undefined 变成空串
        return ",".join("" if item is None else js_string(item) for item in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def nullish_string(value: Any) -> str:
    """对齐 JS `String(value ?? '')`：`None` 视为空串（与 `js_string` 不同）。"""
    return "" if value is None else js_string(value)


def to_langchain_message(role: Any, content: Any) -> BaseMessage | None:
    """把契约里的历史消息（`{role, content}`）转成 LangChain 消息；未知角色丢弃。"""
    text = content if isinstance(content, str) else nullish_string(content)
    if role == "user":
        return HumanMessage(text)
    if role == "assistant":
        return AIMessage(text)
    if role == "system":
        return SystemMessage(text)
    return None


def llm_node_data_of(state: AgentRunState) -> dict[str, Any]:
    """组装 `run_llm_step` 需要的节点数据（模型为空时由它回退到 `LLM_MODEL`）。"""
    data: dict[str, Any] = {
        "title": "",
        "model": state.llm.model or "",
        "prompt": "",
        "tools": state.tool_names,
    }
    if state.llm.temperature is not None:
        data["temperature"] = state.llm.temperature
    return data


def message_text(message: BaseMessage) -> str:
    """取消息的文本内容（字符串原样；内容分片数组拼接 text；其余紧凑 JSON）。"""
    content: Any = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False, separators=(",", ":"))
```

### 6.3 并读：状态契约

| 概念 | TS | Py | 说明 |
| --- | --- | --- | --- |
| 输入文本 | `input: string` | `input: str` | 由执行器从 `agent_runs.input` 写入，层只读 |
| 消息数组 | `messages: BaseMessage[]` | `messages: list[BaseMessage]` | **唯一的上下文载体** |
| 工具名 | `toolNames: string[]` | `tool_names: list[str]` | `tools` 层写、`llm` 层读 |
| LLM 配置 | `llm: AgentLlmConfig` | `llm: AgentLlmConfig` | `llm` 层写、其它层不碰 |
| 最终输出 | `output: string` | `output: str` | 只有 `output` 层写 |
| 取消钩子 | `checkCancelled: () => Promise<void>`（必填） | `check_cancelled: CheckCancelled \| None = None`（可选） | 执行器注入；层在边界调用 |

> 注意「共享状态」这四个字：这里**不是**每层一个自己的 state 副本，也不是 LangGraph 那种「节点返回 `Partial<State>`、由 reducer 合并」的模型。层的函数直接改同一个对象。为什么可以这样，见 §9.3。

---

## 7. 完整代码：四个「非执行」层（两端）

> 这四层的共同点：**同步、无 I/O、不发事件**。它们只做「准备输入」或「收尾输出」。`llm` 层是唯一的例外（§8）。

### 7.1 `history` 层

**完整文件路径：`apps/api-ts/src/agent/layers/history.layer.ts`**

```ts
import type { AgentEmit } from '../agent-events'
import { toLangChainMessage, type AgentRunState } from '../agent-state'

/** `history` 层默认值（见 agent-events.md §3.1）。 */
const DEFAULT_MAX_MESSAGES = 20
const DEFAULT_COMPACTION_THRESHOLD = 12
const DEFAULT_KEEP_RECENT = 6

interface HistoryEntry {
  role: string
  content: string
}

/**
 * `history` 层：载入历史消息并做**确定性压缩**（两端逐字节一致）。
 *
 * 1. `len > compactionThreshold` 时，把前 `len - keepRecent` 条替换成一条
 *    `{"role":"system","content":"[compacted] {n} earlier messages omitted"}`；
 * 2. 再按 `maxMessages` 保留最后 N 条。
 *
 * 真实系统会用模型做摘要，本项目为**可复现**选择确定性截断。
 */
export function runHistoryLayer(
  state: AgentRunState,
  config: Record<string, unknown>,
  _emit: AgentEmit,
): void {
  const raw = Array.isArray(config.messages) ? config.messages : []
  const maxMessages = integerOr(config.maxMessages, DEFAULT_MAX_MESSAGES)
  const compactionThreshold = integerOr(config.compactionThreshold, DEFAULT_COMPACTION_THRESHOLD)
  const keepRecent = integerOr(config.keepRecent, DEFAULT_KEEP_RECENT)

  let messages: HistoryEntry[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue
    }
    messages.push({
      role: String(item.role ?? ''),
      content: typeof item.content === 'string' ? item.content : String(item.content ?? ''),
    })
  }

  if (messages.length > compactionThreshold) {
    const keep = Math.min(keepRecent, messages.length)
    const omitted = messages.length - keep
    if (omitted > 0) {
      messages = [
        { role: 'system', content: `[compacted] ${omitted} earlier messages omitted` },
        ...messages.slice(omitted),
      ]
    }
  }
  if (messages.length > maxMessages) {
    messages = messages.slice(messages.length - maxMessages)
  }

  for (const message of messages) {
    const converted = toLangChainMessage(message.role, message.content)
    if (converted !== null) {
      state.messages.push(converted)
    }
  }
}

/** 取整数配置项；缺失 / 非法时回退默认值（非法值已由 composition 校验拦截）。 */
function integerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

**完整文件路径：`apps/api-py/app/agent/layers/history.py`**

```python
"""`history` 层：载入历史消息并做**确定性压缩**（两端逐字节一致）。

1. `len > compactionThreshold` 时，把前 `len - keepRecent` 条替换成一条
   `{"role":"system","content":"[compacted] {n} earlier messages omitted"}`；
2. 再按 `maxMessages` 保留最后 N 条。
"""

from typing import Any

from app.agent.state import AgentRunState, nullish_string, to_langchain_message

# `history` 层默认值（见 agent-events.md §3.1）
DEFAULT_MAX_MESSAGES = 20
DEFAULT_COMPACTION_THRESHOLD = 12
DEFAULT_KEEP_RECENT = 6


def run_history_layer(state: AgentRunState, config: dict[str, Any]) -> None:
    raw = config.get("messages")
    if not isinstance(raw, list):
        raw = []
    max_messages = _integer_or(config.get("maxMessages"), DEFAULT_MAX_MESSAGES)
    compaction_threshold = _integer_or(
        config.get("compactionThreshold"), DEFAULT_COMPACTION_THRESHOLD
    )
    keep_recent = _integer_or(config.get("keepRecent"), DEFAULT_KEEP_RECENT)

    messages: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        messages.append(
            {
                "role": nullish_string(item.get("role")),
                "content": item["content"]
                if isinstance(item.get("content"), str)
                else nullish_string(item.get("content")),
            }
        )

    if len(messages) > compaction_threshold:
        keep = min(keep_recent, len(messages))
        omitted = len(messages) - keep
        if omitted > 0:
            messages = [
                {"role": "system", "content": f"[compacted] {omitted} earlier messages omitted"},
                *messages[omitted:],
            ]
    if len(messages) > max_messages:
        messages = messages[len(messages) - max_messages :]

    for message in messages:
        converted = to_langchain_message(message["role"], message["content"])
        if converted is not None:
            state.messages.append(converted)


def _integer_or(value: Any, fallback: int) -> int:
    """取整数配置项；缺失 / 非法时回退默认值（非法值已由 composition 校验拦截）。"""
    if isinstance(value, bool):
        return fallback
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return fallback
```

**这段在干什么**

1. **数据来源是 `config.messages`**，不是数据库的 `messages` 表。Agent 运行**不读写会话**：历史由客户端在 composition 里递进来（§9.7 会强调这一点）。
2. 三个默认值 `20 / 12 / 6` 与契约 §3.1 逐字一致。
3. `integerOr` / `_integer_or` 只是**兜底**：真正的非法值（`0`、`101`、`true`）已在 `accept` 时被 400 拦掉，根本进不到这里。
4. 压缩算法本身（阈值、保留条数、占位消息）的语义与两端逐字节对齐细节，见 `03-ReAct循环与上下文压缩.md`；本篇只关心它的**配置面与默认值**。

### 7.2 `prompt` 层

**完整文件路径：`apps/api-ts/src/agent/layers/prompt.layer.ts`**

```ts
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

import { tryRenderTemplate } from '../../engine/template'
import type { AgentEmit } from '../agent-events'
import type { AgentRunState } from '../agent-state'

/**
 * `prompt` 层：渲染 `system` 与 `template` 并追加为消息。
 *
 * 模板作用域**只有 `{ input }`**（agent-events.md §3.2）；路径不存在时按
 * `tryRenderTemplate` 的安全语义替换为空串，不抛错。空字符串 system 不追加。
 */
export function runPromptLayer(
  state: AgentRunState,
  config: Record<string, unknown>,
  _emit: AgentEmit,
): void {
  const scope = { input: state.input }
  if (typeof config.system === 'string' && config.system !== '') {
    state.messages.push(new SystemMessage(tryRenderTemplate(config.system, scope)))
  }
  const template = typeof config.template === 'string' ? config.template : ''
  state.messages.push(new HumanMessage(tryRenderTemplate(template, scope)))
}
```

**完整文件路径：`apps/api-py/app/agent/layers/prompt.py`**

```python
"""`prompt` 层：渲染 `system` 与 `template` 并追加为消息。

模板作用域**只有 `{ input }`**（agent-events.md §3.2）；路径不存在时按
`try_render_template` 的安全语义替换为空串，不抛错。空字符串 system 不追加。
"""

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.state import AgentRunState
from app.engine.template import try_render_template


def run_prompt_layer(state: AgentRunState, config: dict[str, Any]) -> None:
    scope = {"input": state.input}
    system = config.get("system")
    if isinstance(system, str) and system != "":
        state.messages.append(SystemMessage(try_render_template(system, scope)))
    template = config.get("template") if isinstance(config.get("template"), str) else ""
    state.messages.append(HumanMessage(try_render_template(template, scope)))
```

**这段在干什么**

1. **只读 `state.input`，只追加两条消息**（`system` 可选、`user` 必有一条）。
2. 模板作用域只有 `{ input }`：Agent 的 prompt 不能引用历史、不能引用工具结果——**历史是消息，不是模板变量**。这是与工作流变量池的关键区别（阶段 4 的 `pool` 在这里不存在）。
3. 复用了工作流的 `tryRenderTemplate` / `try_render_template`：路径不存在时替换为空串、不抛错（阶段 8 已讲「安全解析」）。
4. 注意 `template` 为空串时**仍会追加一条空 `HumanMessage`**：`template` 的必填校验只要求「是字符串」，不要求非空。

### 7.3 `tools` 层

**完整文件路径：`apps/api-ts/src/agent/layers/tools.layer.ts`**

```ts
import type { AgentEmit } from '../agent-events'
import type { AgentRunState } from '../agent-state'

/**
 * `tools` 层：声明本轮可用工具（名字已在接受运行前校验存在于注册表）。
 * 只写共享状态，不发事件。
 */
export function runToolsLayer(
  state: AgentRunState,
  config: Record<string, unknown>,
  _emit: AgentEmit,
): void {
  const names = Array.isArray(config.names) ? config.names : []
  state.toolNames = names.filter((name): name is string => typeof name === 'string')
}
```

**完整文件路径：`apps/api-py/app/agent/layers/tools.py`**

```python
"""`tools` 层：声明本轮可用工具（名字已在接受运行前校验存在于注册表）。

只写共享状态，不发事件。
"""

from typing import Any

from app.agent.state import AgentRunState


def run_tools_layer(state: AgentRunState, config: dict[str, Any]) -> None:
    names = config.get("names")
    if not isinstance(names, list):
        names = []
    state.tool_names = [name for name in names if isinstance(name, str)]
```

**这段在干什么**

1. 这是最短的一层：**把 `config.names` 搬进 `state.toolNames`**，仅此而已。
2. 它**不执行工具**、也不校验工具是否存在——存在性在 `accept` 时由校验器查注册表（`hasTool` / `has_tool`）。执行发生在 `llm` 层的 ReAct 循环里（`executeTool` / `execute_tool`）。
3. `names` 缺失/非数组 → 空数组 = 不用工具。这就是「`tools` 层不写 → 无工具」的实现落点。
4. **只写 `toolNames`，不碰 `messages`**：工具声明是「能力集合」，不是对话内容。

### 7.4 `output` 层

**完整文件路径：`apps/api-ts/src/agent/layers/output.layer.ts`**

```ts
import type { AgentEmit } from '../agent-events'
import { messageText, type AgentRunState } from '../agent-state'

/**
 * `output` 层：取消息数组中**最后一条 assistant 消息**的文本作为最终输出。
 * 没有 assistant 消息时为空串（见 agent-events.md §3.5）。
 */
export function runOutputLayer(
  state: AgentRunState,
  _config: Record<string, unknown>,
  _emit: AgentEmit,
): void {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index]
    if (message.getType() === 'ai') {
      state.output = messageText(message)
      return
    }
  }
  state.output = ''
}
```

**完整文件路径：`apps/api-py/app/agent/layers/output.py`**

```python
"""`output` 层：取消息数组中**最后一条 assistant 消息**的文本作为最终输出。

没有 assistant 消息时为空串（见 agent-events.md §3.5）。
"""

from typing import Any

from app.agent.state import AgentRunState, message_text


def run_output_layer(state: AgentRunState, config: dict[str, Any]) -> None:
    for index in range(len(state.messages) - 1, -1, -1):
        message = state.messages[index]
        if message.type == "ai":
            state.output = message_text(message)
            return
    state.output = ""
```

**这段在干什么**

1. **从后往前**找第一条 `ai` 消息（`getType() === 'ai'` / `message.type == "ai"`），找到就写 `state.output` 并返回。
2. 找不到就写**空串**——不是 `null`、不是抛错。这解释了「`output` 放在 `llm` 之前 → 输出为空」的全部机制。
3. 它**不读 config**（`{}`）、**不发事件**、**不改 messages**。

---

## 8. `llm` 层的层接口（摘录）

> `llm` 层内部的 ReAct 循环（`StateGraph` / 条件边 / 环 / `ToolMessage` / `parseArgsOrFail`）在 `06-工具调用/02-NestJS-ReAct循环与条件边.md` 已首次教学，这里**只讲它作为「层」的接口**。

### 8.1 TS：签名与状态写入

**完整文件路径：`apps/api-ts/src/agent/layers/llm.layer.ts`**（摘录；循环体见源码与阶段 6）

```ts
/** `maxRounds` 默认值与上限（见 agent-events.md §3.4）。 */
const DEFAULT_MAX_ROUNDS = 5
const MAX_ROUNDS_LIMIT = 20

/**
 * `llm` 层：ReAct 循环（LangGraph `StateGraph` + 条件边 + 环，节点 `llm` 与 `tools`）。
 *
 * - 每轮逐 chunk 发 `token`；
 * - 有 `tool_calls` → 发 `tool_call` → 执行（复用 `executeTool`）→ 发 `tool_result`
 *   → 追加 `ToolMessage` → 回到 `llm`；
 * - `round` 超过 `maxRounds` → 抛 `agent rounds exceeded: {max}`。
 *
 * 取消在**工具轮边界**检查（每轮 LLM 调用前后、每个工具执行前），
 * 抛出后由执行器发唯一一帧 `run_cancelled`。
 */
export async function runLlmLayer(
  state: AgentRunState,
  config: Record<string, unknown>,
  emit: AgentEmit,
): Promise<void> {
  const maxRounds = resolveMaxRounds(config.maxRounds)
  state.llm = {
    model: typeof config.model === 'string' && config.model !== '' ? config.model : undefined,
    maxRounds,
    temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
  }
  // …（构造 llm / tools 两个节点、条件边与环、invoke）
  state.messages = result.messages
}

/** `maxRounds`：层配置优先，其次环境变量 `AGENT_MAX_ROUNDS`，最后默认 5。 */
function resolveMaxRounds(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ROUNDS_LIMIT) {
    return value
  }
  const fromEnv = Number(process.env.AGENT_MAX_ROUNDS ?? DEFAULT_MAX_ROUNDS)
  if (Number.isInteger(fromEnv) && fromEnv >= 1 && fromEnv <= MAX_ROUNDS_LIMIT) {
    return fromEnv
  }
  return DEFAULT_MAX_ROUNDS
}
```

### 8.2 Python：签名与状态写入

**完整文件路径：`apps/api-py/app/agent/layers/llm.py`**（摘录；循环体见源码与阶段 6）

```python
# `maxRounds` 默认值与上限（见 agent-events.md §3.4）
DEFAULT_MAX_ROUNDS = 5
MAX_ROUNDS_LIMIT = 20


async def run_llm_layer(
    state: AgentRunState, config: dict[str, Any], emit: AgentEmit
) -> None:
    max_rounds = _resolve_max_rounds(config.get("maxRounds"))
    model = config.get("model")
    temperature = config.get("temperature")
    state.llm = AgentLlmConfig(
        model=model if isinstance(model, str) and model != "" else None,
        max_rounds=max_rounds,
        temperature=(
            float(temperature)
            if isinstance(temperature, (int, float)) and not isinstance(temperature, bool)
            else None
        ),
    )
    # …（构造 llm / tools 两个节点、条件边与环、ainvoke）
    state.messages = result["messages"]


def _resolve_max_rounds(value: Any) -> int:
    """`maxRounds`：层配置优先，其次环境变量 `AGENT_MAX_ROUNDS`，最后默认 5。"""
    if _valid_rounds(value):
        return int(value)
    from_env = settings.agent_max_rounds
    if _valid_rounds(from_env):
        return int(from_env)
    return DEFAULT_MAX_ROUNDS
```

### 8.3 它和其它四层哪里不一样

| 维度 | `history` / `prompt` / `tools` / `output` | `llm` |
| --- | --- | --- |
| 同步/异步 | 同步函数 | `async`（要等 provider） |
| 是否用 `emit` | 不用（TS 用 `_emit` 占位） | 用：`token` / `tool_call` / `tool_result` |
| 是否访问外部 | 不访问 | 访问 LLM provider + 工具 |
| 对 `messages` 的操作 | 追加 | **整体替换**（`state.messages = result.messages`） |
| 写入 `state.llm` | 不写 | 写（缓存本次解析后的模型/轮数/温度） |
| 失败 | 基本不会失败 | 超轮数 / provider 错误 / 工具失败 → 抛错 → `run_failed` |

> 这一行是理解「层契约」的关键：**所有层的名义契约都是 `run(state, config)`**；`emit` 是「需要发事件的层」才用的第三参（Python 只给 `llm` 传，TS 统一传但多数层忽略）。统一的是**形状**，不是**能力**。

---

## 9. 首次技术教学

### 9.1 Composition vs Graph：为什么可以不要图

**先摆出两种描述方式**

| 维度 | 工作流（Graph） | Agent（Composition） |
| --- | --- | --- |
| 描述单位 | 节点 + 边 | **有序的层** |
| 拓扑是否可变 | 用户任意连（分支 / 环 / 迭代） | **固定线性**（层间没有分支、没有环） |
| 变化的东西 | **拓扑** + 节点配置 | **只有配置** |
| 前端形态 | ReactFlow 画布、坐标、`Handle`、连线 | 一份 JSON（表单 / 文本框） |
| 校验对象 | 图校验（连通性、预检、分支 8 类） | 层校验（数量、重复、范围、工具名） |
| 执行方式 | 编译图 → 按边调度 | `for` 循环 → 层内再调图 |
| 过程事件 | `node_started` / `node_finished` | `layer_started` / `layer_finished` |

**为什么「不要图」是成立的**

图存在的唯一理由是**表达「下一步去哪」**。它带来三种能力：

1. **分支**：下一步由条件决定（阶段 8 的 `condition` + `sourceHandle`）。
2. **环**：回到之前的节点（阶段 6 的 ReAct、阶段 8 的迭代）。
3. **并行/汇合**：多条边同时前进。

Agent 的**层间**一个都不需要：

- `history` 之后永远是 `prompt`（如果客户端这么排）；
- `prompt` 之后永远是 `tools`；
- `tools` 之后永远是 `llm`；
- `llm` 之后永远是 `output`。

这四行的顺序是**默认骨架**，客户端可以改（§9.5），但无论怎么改，**下一层永远是数组里的下一个**：没有任何条件能决定「这一层跑不跑」或「跳到第几层」。这就是「图退化成列表」的精确含义。

因为 Agent 的骨架是**固定**的：

```
准备上下文（历史 / 提示 / 工具声明） → 推理（可能调工具） → 收尾（取输出）
```

真正会变的是**参数**：用哪个模型、system 写什么、开哪些工具、历史保留多少、最多几轮。**参数是配置，不是拓扑。** 拓扑恒定时，图就退化成一份列表——此时再保留图，付出的全是净成本：

| 图带来的成本 | 在 Agent 里换来什么 |
| --- | --- |
| 画布坐标与连线（前端） | 无（用户不连线） |
| 边校验、连通性预检、分支 8 类预检（后端） | 无（没有边） |
| 拓扑编译与调度（执行器） | 无（一个 `for` 循环足够） |
| 节点级事件与高亮（观测） | 无（层事件更粗，但够用） |

**但图并没有消失——它下沉了**

`llm` 层内部仍然是 LangGraph 的 `StateGraph`：

```
START → llm ──(有 tool_calls)──→ tools ──→ llm ──(无 tool_calls)──→ END
```

因为**层内真的有拓扑**：有一个环（`tools → llm`）和一个条件路由（「有没有待执行的工具调用」）。这正是阶段 6 教过的能力，原样复用。

所以准确的说法是：

> **层间线性，层内有图。**
>
> 「不要图」指的是**不要用图描述层与层的关系**；不是「这个系统里没有图」。

**什么时候图会回来**

如果将来要做：多 Agent 协作、并行子任务、可编排的子流程、人工介入点（HITL）——那时层间就真的有了拓扑，图（或等价的分支描述）会重新变得必要。本阶段不做，所以不做。

### 9.2 「声明式装配」到底声明什么

**四个特征**

| # | 特征 | 在本项目里的落点 |
| --- | --- | --- |
| 1 | 客户端提交的是**数据**，不是代码 | `POST /agent/runs` 的 `composition` 是一个 JSON 对象 |
| 2 | 服务端把 `name` 映射到实现 | 执行器的 `switch` / `if-elif`；`hasTool` 查工具注册表 |
| 3 | **没有连线、没有坐标、没有画布** | `Composition` 只有 `version` + `layers`；层只有 `name` + `config` |
| 4 | **校验前置**：数据先过纯函数，再进入执行 | `accept` 里先 `validateComposition`，失败不建 run |

**命令式 vs 声明式**

| | 命令式（写代码） | 声明式（提交数据） |
| --- | --- | --- |
| 谁决定顺序 | 代码里的调用顺序 | `layers` 数组顺序 |
| 谁决定参数 | 代码里的字面量 / 环境变量 | `layers[].config` |
| 换一种 Agent | 改代码、重新部署 | 改 JSON、下一次运行立即生效 |
| 校验发生在 | 编译期（类型）+ 运行期 | **提交时**（纯函数） |
| 需要的额外投入 | 类型系统 | **自建校验器**（否则错误延后到执行期） |

**「registry」在本项目的真实形态**

严格说，层的「registry」是**手写分派表**：TS 是 `switch (layer.name)`，Python 是 `if name == ... / elif ...`。它与 `Map<string, Layer>` 语义等价：一个 `name` 只能落到一个实现，未知 `name` 在校验阶段就被拒绝。

真正的**动态注册表**在工具侧：`hasTool(name)` / `has_tool(name)` 查能力目录，`executeTool` / `execute_tool` 按名字执行。这也是「同一套工具注册表」的含义（§9.9）。

**为什么要「先落库、再执行」**

`accept()` 把 `composition` 写进 `agent_runs.composition`（JSONB），执行器再从 DB 读回来。这带来三个直接好处：

1. **可审计**：这次运行到底用了什么配置，是一次查询就能看到的事实。
2. **可复核**：事件流与落库的 `composition` 来自同一次运行，排查时不会出现「读到的配置和当时跑的不一样」。
3. **可并发**：执行器不持有请求对象，多个 run 之间没有共享的可变请求状态。

代价也很直接：**执行前必须完整校验**。如果配置是非法数据，它会被持久化成一条永远失败或语义奇怪的 run。所以校验器不是「顺手加的检查」，而是声明式装配的**必要组成部分**。

### 9.3 层的统一契约：`run(state, config)`

**签名**

```ts
// TS（emit 是可选能力，多数层忽略）
type Layer = (state: AgentRunState, config: Record<string, unknown>, emit: AgentEmit) => void | Promise<void>
```

```python
# Python（只有 llm 层需要 emit）
run_history_layer(state, config)
run_prompt_layer(state, config)
run_tools_layer(state, config)
await run_llm_layer(state, config, emit)
run_output_layer(state, config)
```

统一的**形状**是 `(state, config)`；`emit` 是「需要发事件的层」才有的第三参。

**两条规矩**

| 规矩 | 含义 | 在本项目里的体现 |
| --- | --- | --- |
| **只读 `config`** | 层不能改自己的配置，也不能改别人的 | 所有层都只从 `config` 取值；`config` 由执行器传入，同一份 JSON 可被重放 |
| **只写自己负责的 `state` 字段** | 每个字段有**唯一**的写者 | 见下表 |

**读写面（本篇最重要的一张表）**

| 层 | 读 | 写 | 发事件 |
| --- | --- | --- | --- |
| `history` | `config.messages` / 三个数字配置 | `state.messages`（**追加**） | 无 |
| `prompt` | `state.input`、`config.system` / `config.template` | `state.messages`（**追加**） | 无 |
| `tools` | `config.names` | `state.toolNames`（**赋值**） | 无 |
| `llm` | `state.messages`、`state.toolNames`、`config` | `state.llm`（赋值）、`state.messages`（**整体替换**） | `token` / `tool_call` / `tool_result` |
| `output` | `state.messages` | `state.output`（**赋值**） | 无 |
| （执行器） | — | `state.input`、`state.checkCancelled` | `run_*` / `layer_*` |

**「状态归层所有」到底防住了什么**

假设没有这条规矩，最常见的坏味道是：

- `prompt` 层顺手改了 `state.toolNames`（「我想让模板里能选工具」）；
- `tools` 层顺手往 `state.messages` 里塞一条「你现在可以使用 calculator」；
- `output` 层顺手把 `state.messages` 截断到最后 10 条。

结果：**同一份 composition、同样的输入，两端的输出会不一样**（因为实现者各自发挥了「顺手」），而且排查时无法从代码里看出「这条消息到底是谁加的」。更糟的是，**事件序列也会不一样**（有人偷偷发了事件）。

规矩把「谁写什么」变成**静态可读**的事实：

- `messages` 只由 `history` / `prompt` 追加、`llm` 替换；
- `toolNames` 只由 `tools` 写；
- `output` 只由 `output` 写；
- 层的边界事件只由执行器发。

于是跨端对齐可以**逐层做**：只要保证 `history` 的两份实现等价、`prompt` 的两份等价……整体就等价。这就是「层」这个抽象的真正价值。

**「写回显式」的两个具体例子**

1. `llm` 层内部用 LangGraph 的 reducer 合并状态（`messages` 的 reducer 是「新值覆盖旧值」），但**出层时只有一句显式回写**：

```ts
state.messages = result.messages
```

```python
state.messages = result["messages"]
```

内部怎么合并是 `llm` 层的私事；跨层边界只有这一次可见的写。

2. `output` 层不 `return` 任何东西，而是：

```ts
state.output = ''
```

```python
state.output = ""
```

**返回值被丢弃**是刻意的：如果层靠返回值合并，就需要一个 reducer 规则；而跨层没有拓扑，引入 reducer 只会让「顺序执行」变得不直观。直接写共享状态 + 明确的写入面，更简单。

**为什么跨层不用 `StateGraph`**

`llm` 层内部用图，是因为那里有**环和条件路由**；跨层用 `for` 循环，是因为那里只有**顺序**。用图的运行时去表达一个纯顺序列表，等于用拓扑排序跑一个已经排好的数组——多出来的机制换不来任何能力。

### 9.4 `llm` 层必须恰好一个

**校验位置**

它是 `validateComposition` 的**第一条**规则，先于未知层、重复层、所有范围检查：

```ts
if (llmCount !== 1) {
  errors.push('composition must contain exactly one llm layer')
}
```

**0 个会怎样**

- `accept` 直接 400，**不会建 run**、不会发任何事件。
- 如果（假设）绕过校验进入执行：没有任何层发 `token`，`state.messages` 里没有 `ai` 消息，`output` 层取不到东西 → `run_finished.output` 为 `""`。
- 语义上：**这次「运行」没有发生**。一份没有执行核心的 composition，不是「一个什么都不做的 Agent」，而是「一份无效配置」。

**2 个会怎样**

- 同样 400，但此时会报**两条**错误（顺序固定）：

```
composition must contain exactly one llm layer; layer llm appears more than once
```

- 为什么不能「跑两次」：
  - **成本翻倍**：两次完整的模型调用（还可能有工具轮）。
  - **事件序列超出契约范围**：`agent-events.md` §2.1 描述的是「一个 `llm` 层的 token/tool 序列」；两段直接串联后 `round` 会从头计数，消费者无法从事件里区分它属于哪一层。
  - **输出取哪一条**：`output` 只取**最后一条** `ai` 消息，第一次调用的结果被静默丢弃——这不是「多阶段推理」，只是浪费。
  - **`state.llm` 被覆盖**：第二次会覆盖第一次的 model / maxRounds / temperature，第一次的配置连痕迹都不留。

**为什么其它层可以缺省，唯独它不行**

因为层分两类：

| 类别 | 层 | 缺省的含义 |
| --- | --- | --- |
| **输入准备** | `history` / `prompt` / `tools` | 「不做这件事」有明确语义：无历史、无提示、无工具 |
| **执行核心** | `llm` | 「不做这件事」= **没有推理**，整个运行时失去意义 |
| **输出收尾** | `output` | 「不做这件事」= 输出为空（合法但无用） |

换句话说，composition 的真实形状是：

```
(准备层)* + llm + (收尾层)*
```

`llm` 是**唯一不可省的中项**。注意：执行器**不会**强制这个形状的**位置**（`prompt` 写在 `llm` 后面也合法），只强制**数量**——这直接引出下一节。

### 9.5 层的顺序即语义

**顺序的唯一来源**

```
composition.layers[0] → layers[1] → … → layers[n-1]
```

没有排序、没有优先级、没有「层名的固有顺序」。`LAYER_NAMES` 常量里的 `['history', 'prompt', 'tools', 'llm', 'output']` **只是白名单**，不是执行顺序；Python 的 `LAYER_NAMES` 元组同理。

**标准顺序下的数据流**

```
history ──append──┐
prompt  ──append──┼──→ state.messages ──read──→ llm ──replace──→ state.messages ──read──→ output
tools   ──set─────┘                              ↑
                                          state.toolNames
```

**四种典型错序，各自会怎样**

| 错序 | 会不会 400 | 实际结果 | 原因 |
| --- | --- | --- | --- |
| `output` 在 `llm` 之前 | **不会** | `run_finished.output` 为 `""`；流里仍能看到 `token` | `output` 执行时消息数组里还没有 `ai` 消息 |
| `prompt` 在 `llm` 之后 | **不会** | 模型看不到本次的 user 指令（只能看到它之前已入队的消息，通常只有 history）；之后追加的 user 消息无人读 | `llm` 只读「执行到它那一刻」的消息数组 |
| `tools` 在 `llm` 之后 | **不会** | 模型不会绑定任何工具；后写的 `toolNames` 无人读 | `llm` 用 `llmNodeDataOf(state).tools` 决定 `bindTools` |
| `history` 在 `prompt` 之后 | **不会** | 历史消息排在模板消息**之后**；若历史以 `user` 结尾，模型看到的最后一条 user 是历史而不是模板 | 契约 §3 明确「不做隐式重排」 |

> 记住这一句：**顺序错了不会被拦住，只会「结果不对」**。校验器只看数量/重复/范围，不看顺序；顺序是客户端的自由，也是客户端的责任。

**为什么不做隐式重排**

如果服务端偷偷把 `prompt` 移到 `llm` 前、`output` 移到 `llm` 后，会发生两件事：

1. **`layer_started` 的 `index` 与实际执行不一致**：契约说事件按 `layers` 数组顺序发，重排会让事件和请求对不上。
2. **客户的意图被覆盖**：有人故意把 `output` 放在 `llm` 前（例如想要「只输出历史里的最后一条」），重排会让他拿不到想要的结果，而且没有任何提示。

所以契约选择「**不重排、不判断、只执行**」：简单、可预测、可对齐。

### 9.6 配置校验的分工与顺序

**三层分工**

| 层 | 负责什么 | 失败文案 | 位置 |
| --- | --- | --- | --- |
| 框架层（DTO / Pydantic） | `input` 1..4000；`composition` 必须是对象 | §1.1 通用文案 | `create-agent-run.dto.ts` / `api/agent.py` |
| **纯函数校验器** | `composition.version`、层 `name` 必填、层名闭集、`llm` 数量、同层重复、`prompt.template`、`tools.names`、四个数值范围 | **§11 专用文案** | `composition.validator.ts` / `validator.py` |
| 执行期兜底 | 配置缺省时取默认值（`integerOr` / `_integer_or` / `resolveMaxRounds`） | 不产错误（非法值已进不来） | 各层实现 |

**为什么必须分层**

- 如果把这些规则写进 DTO：`config` 是自由结构，DTO 要为每层每种写法建嵌套类，等于把校验器重写一遍，而且会产出框架的通用文案（`maxRounds must not be greater than 20`），与契约 §11 冲突。这条「**契约文案优先于框架默认文案**」的原则从阶段 2 就定了（见 `02-应用管理/07-验收.md`）。
- 如果写进执行期：校验失败会变成「run 已经建了，然后在流里 `run_failed`」。**声明式的错误应该发生在接受之前**（400 普通 JSON），而不是执行之中（200 + SSE）。

**11 条规则的固定顺序**

| 序 | 规则 | 产出文案 |
| --- | --- | --- |
| 0 | `composition.version` ≠ 字符串 `"1"`（缺失也算） | `composition version must be 1` |
| 1 | 层不是对象 / `name` 非字符串 / 空串（按数组顺序，index 从 1） | `layer {index} name is required` |
| 2 | `llm` 层数量 ≠ 1（只数 `name` 合格的层） | `composition must contain exactly one llm layer` |
| 3 | 未知层名（按数组顺序，只查 `name` 合格的层） | `unknown layer: {name}` |
| 4 | 同层重复（按数组顺序，同层名只报一次） | `layer {name} appears more than once` |
| 5 | `prompt` 缺 `template` | `prompt layer template is required` |
| 6 | `tools` 引用未知工具（按 `names` 顺序） | `tools layer references unknown tool: {name}` |
| 7 | `history.maxMessages` 越界 | `history layer maxMessages must be between 1 and 100` |
| 8 | `history.compactionThreshold` 越界 | `history layer compactionThreshold must be between 1 and 100` |
| 9 | `history.keepRecent` 越界 | `history layer keepRecent must be between 1 and 50` |
| 10 | `llm.maxRounds` 越界 | `llm layer maxRounds must be between 1 and 20` |

**顺序为什么是这样**

1. **先 `version`**：它约束的是整份文档，不依赖 `layers` 的任何内容；放在最前，客户端拿到第一条文案就知道「结构版本不对，后面的细节先别看了」。
2. **再 `name` 必填**：`name` 是分派键，缺了它连「这是哪一层」都不知道。命中后**跳过该层的后续检查**（不再报未知层、不参与重复/范围），避免一条坏数据引发一串噪声。
3. **再数量**：只数 `name` 合格的层，它是最全局的约束。
4. **再未知**：先知道哪些层名不合法，下一步的重复检测才能**只对合法层名**做（未知层重复没有意义）。
5. **再重复**：有了合法层名集合，才能判断「同一个合法层出现两次」。
6. **再逐层查必填/范围**：`prompt` → `tools` → `history` → `llm`，基本按「层出现的自然顺序 + 配置复杂度」排列。

**为什么顺序本身就是契约**

多条错误会被拼成**一条** `message`：

```ts
throw new BadRequestException(errors.join('; '))
```

```python
raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors))
```

`error-messages.md` §11 明文写死了这 11 步顺序。于是「两端逐字节一致」才有意义：如果一端先报范围、另一端先报重复，即使每条文案都对，拼接结果也不一样。**顺序不是实现细节，是对拍的一部分。**

**「校验失败不建 run」的证据**

`accept` 的顺序是（摘录）：

```ts
const errors = validateComposition(composition)
if (errors.length > 0) {
  throw new BadRequestException(errors.join('; '))
}
const run = await this.prisma.agentRun.create({ … })
```

```python
errors = validate_composition(composition)
if errors:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(errors))
run_id = str(uuid.uuid4())
with SessionLocal() as session, session.begin():
    session.add(AgentRun(…))
```

所以 `agent_runs` 里**不会留下**一次非法配置的痕迹（验收标准 7）。

**三条边界（如实记录）**

| 边界 | 实际行为 | 后果 |
| --- | --- | --- |
| `composition.version` | **已校验**：必须严格是字符串 `"1"`，否则 400 `composition version must be 1` | 版本演进（未来出现 `"2"`）时必须同步改契约与两端校验器，否则所有请求都会 400 |
| `layers[].config` 的未知键 | **不校验**（`additionalProperties: true`，校验器只看 11 条规则里的键） | `maxMessage` 这类拼写错误**静默**按默认值生效 |
| 层对象不是对象 / 缺 `name` / `name` 非字符串 / 空串 | **已统一**：两端都报 `layer {index} name is required`（index 从 **1**），且**先于**未知层检查、命中后跳过该层后续检查 | 不再是「边界差异」：实测两端逐字节相同（`BYTE_EQUAL=True`） |

> 为什么命中后要跳过该层后续检查：`name` 是分派键，缺了它，「未知层 / 重复层 / 层配置范围」都无从谈起。硬查下去只会产生一串二次错误，把真正的病因埋在噪声里。

### 9.7 可选层的默认值

**「不写」有两种含义，别混**

| 写法 | 含义 | 结果 |
| --- | --- | --- |
| 整个层**不出现** | 这个阶段不发生 | `history` 不出现 → 没有历史；`tools` 不出现 → 没有工具 |
| 层出现，但**字段不写** | 这个阶段发生，用默认值 | `history` 层写 `{}` → 用 `20 / 12 / 6` |

**默认值表（四个，写进契约）**

| 层 | 键 | 默认 | 契约出处 | 代码常量 |
| --- | --- | --- | --- | --- |
| `history` | `maxMessages` | `20` | `agent-events.md` §3.1 | `DEFAULT_MAX_MESSAGES` |
| `history` | `compactionThreshold` | `12` | §3.1 | `DEFAULT_COMPACTION_THRESHOLD` |
| `history` | `keepRecent` | `6` | §3.1 | `DEFAULT_KEEP_RECENT` |
| `llm` | `maxRounds` | `5` | §3.4 | `DEFAULT_MAX_ROUNDS` |

**`maxRounds` 的三级回退**

```
layers[llm].config.maxRounds（1..20 的整数）
        ↓ 缺失/非法
process.env.AGENT_MAX_ROUNDS / settings.agent_max_rounds（1..20）
        ↓ 缺失/非法
5
```

> 注意：`AGENT_MAX_ROUNDS` **已写进两端 `.env.example`**（`AGENT_MAX_ROUNDS=5`），与 `config.py` 的 `Settings`、TS 的 `process.env` 读取一一对应。不改环境变量时，默认 `5` 生效；要调上限，改这一行即可。

**为什么默认值必须进契约**

因为「两端一致」比的是**行为**，而默认值是行为的一部分：

- 同一份 `{ "name": "history", "config": {} }`，如果一端默认保留 20 条、另一端默认 50 条，历史压缩的结果就不同；
- 默认值改动 = **契约变更**，要同步 `agent-events.md` 与两端常量，而不是「只改我这边」。

代码常量只是契约的镜像；**读代码前先读契约表**，是这一阶段的对齐顺序。

**一个容易忽略的事实：Agent 的历史不来自数据库**

`history` 层的唯一数据源是 `config.messages`。它**不读** `messages` 表、**不写**会话、**不产生** `conversationId`。这与阶段 9 的工作流会话是两套东西：

| | 工作流会话（阶段 9） | Agent 历史（阶段 11） |
| --- | --- | --- |
| 历史存哪 | `messages` 表（按 `conversationId`） | 请求里的 `composition.layers[history].config.messages` |
| 谁负责写回 | 引擎在 `run_finished` 前落库 | **没有人写回**：这是一次性的输入 |
| 跨运行记忆 | 有（同一会话） | **无**（每次运行自己带） |

这也是 §9.8 里「没有 Workspace / Binding」的一个直接后果：没有平台级的记忆与资源绑定，历史只能由调用方自己递进来。

### 9.8 砍掉了什么（如实写）

**砍掉的四样东西**

| 砍掉 | 它原本是什么 | 为什么砍 | 砍掉后失去了什么 |
| --- | --- | --- | --- |
| `Workspace` | 多租户命名空间：把模型、知识库、工具凭证、运行按租户隔离 | 平台运维，不是 Agent 开发 | **多租户隔离与配额**：所有 run 平铺在同一个库里，只按 `ownerId` 归属 |
| `Binding` | 把 workspace 的资源**绑定**到某个 Agent / 某次运行（用哪套凭证、哪个知识库） | 同上；本项目的资源解析走全局环境变量 | **资源编排**：无法为不同 Agent 指定不同的 provider / 知识库 |
| `RuntimeLease` | 运行期**租约与账本**：并发上限、资源占用、超时回收、崩溃回收 | 同上；需要调度器与后台回收器 | **资源回收与限流**：没有并发上限、没有配额扣减、没有 reaper |
| 沙箱后端（E2B / OpenShell） | 在隔离沙箱里执行工具/代码（文件、网络、进程隔离） | 需要外部服务与 SDK，教学信号低 | **隔离执行**：工具直接在 API 进程内跑 |

**砍掉之后的真实后果（不美化）**

1. **没有多租户配额**：同一用户可以并发提交任意多个 run；每个 run 都会真的去调 provider。生产环境必须在这里加限流与配额。
2. **没有隔离执行**：`http_get` / `calculator` 等工具在 API 进程里执行。缓解手段是阶段 6 已有的**工具侧安全**（禁 `eval`、SSRF 防护、超时与体积上限），但那不是沙箱级隔离。
3. **没有资源回收**：执行器把 run 置为 `running` 后就开始跑；如果进程在执行中途崩溃，这条 run 会**永远停在 `running`**（没有租约过期、没有 reaper 来回收）。取消也是「协作式」的——只在层边界 / 工具轮边界检查标记。
4. **没有运行期账本**：无法回答「这个 Agent 这个月花了多少 token」「哪个租户占满了并发」。

**保留了什么（本阶段的真正学习点）**

| 保留 | 说明 |
| --- | --- |
| 异步 Run 模型 | `202` + `queued` → 后台执行 → 轮询 / 事件流 |
| 事件持久化与重放 | `agent_run_events(seq)` + `Last-Event-ID` |
| 协作式取消 | 层边界 / 工具轮边界检查 |
| ReAct 循环 | `llm` 层内的 `StateGraph` + 条件边 + 环 |
| 工具调用 | 复用阶段 6 的注册表与错误分类 |
| 历史与**上下文压缩** | 确定性截断（可复现、可对齐） |
| **Composition 声明式装配** | 本篇的主题 |

> 一句话边界：**这是一个「单租户教学运行时」，不是「多租户 Agent 平台」。** 砍掉的四样都属于平台侧；留下来的才是 Agent 开发本身。

### 9.9 与工作流引擎的关系

**共用的三样东西**

| 共用 | 具体位置 | 为什么可以共用 |
| --- | --- | --- |
| **工具注册表** | `hasTool` / `has_tool`（校验期）、`executeTool` / `execute_tool`（执行期）、`ToolError` 分类 | 工具是「能力」，与「谁编排」无关 |
| **`ChatOpenAI` 配置** | Agent 的 `llm` 层直接调用 `runLlmStep` / `run_llm_step` | 同一套 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS` / `maxRetries=0` |
| **错误映射** | `mapLlmError` / `map_llm_error` 的 6 条规范文案；工具失败 `tool {name} failed: {reason}` | 外部依赖的失败面是同一批，文案必须一致 |

**不同的地方**

| 维度 | 工作流引擎 | Agent 运行时 |
| --- | --- | --- |
| 输入 | 图（`nodes` + `edges`） | `composition`（`layers`） |
| 控制权 | **人**连边决定路径 | **固定骨架**决定阶段；层内由模型决定是否调工具 |
| 状态载体 | 变量池（`pool`）+ 节点输出 | 消息数组（`messages`） |
| 过程事件 | `node_started` / `node_finished` / `token` … | `layer_started` / `layer_finished` / `token` … |
| 事件持久化 | 不持久化（流断即丢） | 持久化到 `agent_run_events`，支持重放 |
| SSE 帧 | `event:` + `data:` | **多一行 `id:`**（`seq`） |
| 表 | `apps` / `conversations` / `messages` | `agent_runs` / `agent_run_events` |
| 入口 | `/apps/{id}/run`、`/public/apps/{appId}/run` | `/agent/runs` |

**两个引擎并存，不是替换**

- 阶段 11 **没有**改工作流的任何行为：`POST /apps/{id}/run` 仍读草稿、`/public/...` 仍读快照。
- Agent 运行时是独立模块（`agent/` / `app/agent/`）、独立 controller、独立表。
- 两者共享的是**底层原语**（工具、模型客户端、错误映射、模板渲染），不是**执行模型**。

**为什么不在图里加一个 Agent 节点**

阶段 6 已经论证过「**这一阶段不该加**」：复用 `llm` 节点 + 条件边，能把「循环机制」教透；加一个黑盒 Agent 节点会把环藏起来（见 `06-工具调用/05-验收.md` §5）。

阶段 11 另开运行时，不是推翻那个结论，而是**需求变了**：

| 需求 | 合适的描述方式 |
| --- | --- |
| 「在固定流程里嵌一段自主循环」 | 图 + `llm` 节点 + 条件边（阶段 6） |
| 「整次运行都由配置驱动的对话式 Agent」 | Composition + 层（阶段 11） |

一句话：

> **图适合「人编排的流程」，层适合「模型自主的回合」。两者共享工具与模型，但不共享拓扑。**

### 9.10 与总纲 / 源码的措辞差异（如实记录）

| 常见措辞 | 源码实际 | 影响 |
| --- | --- | --- |
| 「服务端用 registry 把 `name` 映射到模块」 | 层分派是**手写 `switch` / `if-elif`**；真正的动态注册表在工具侧 | 语义等价，不影响结论 |
| 「每层自包含 `Config` + `State`」 | `Config` 是**自由 JSON**（不是每层一个类）；`State` 是**一份共享状态**（不是每层一个对象） | 「状态归层所有」体现为**写入面归属**，不是「每层持有副本」 |
| 「每层统一 `run(state, config)`」 | TS 恒有第三参 `emit`（多数层忽略）；Python 只有 `llm` 层传 `emit` | 统一的是形状，能力按需 |
| 「`version` 固定为 `"1"`」 | 校验器**已检查**：严格等于字符串 `"1"` | 契约与运行期一致 |
| 「两端校验完全一致」 | 层不是对象 / 缺 `name` / `name` 为空串时，两端都报 `layer {index} name is required` | 已统一，实测 `BYTE_EQUAL=True` |

---

## 10. 验收自测

> 前提：`mini-dify-db` 为 `healthy`；两套后端已启动；`pnpm run build:contract` 已成功；已注册 / 登录。
> PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请写 **`curl.exe`**。
> 所有 JSON 请求体必须是 **UTF-8 无 BOM**；下面的 `Write-Utf8` 负责这件事。

### 10.0 准备：账号、令牌、写文件函数

```powershell
# 仓库根
curl.exe -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3001/auth/register `
  -H 'Content-Type: application/json' -d '{"email":"agent@example.com","password":"secret123"}'

$TOKEN = (curl.exe -s -X POST http://127.0.0.1:3001/auth/login `
  -H 'Content-Type: application/json' -d '{"email":"agent@example.com","password":"secret123"}' `
  | ConvertFrom-Json).accessToken

function Write-Utf8([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

$TOKEN.Length
```

**预期**：`$TOKEN` 非空（长度 > 100）。若注册返回 `409` 可忽略（已注册）。

### 10.1 校验：12 条文案 + 固定顺序

先写一个「打一次坏 composition，打印状态码与 `message`」的函数：

```powershell
function Test-Bad([string]$Json) {
  Write-Utf8 "$PWD\case.json" $Json
  $code = curl.exe -s -o err.json -w '%{http_code}' -X POST http://127.0.0.1:3001/agent/runs `
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary '@case.json'
  $msg = (Get-Content err.json -Encoding UTF8 -Raw | ConvertFrom-Json).message
  "$code  $msg"
}
```

逐条跑 12 个用例：

```powershell
# 1) composition.version 不是 "1"
Test-Bad '{"version":"2","layers":[{"name":"llm","config":{}}]}'

# 2) 第 3 层缺 name
Test-Bad '{"version":"1","layers":[{"name":"llm","config":{}},{"name":"output","config":{}},{"config":{}}]}'

# 3) 缺 llm 层
Test-Bad '{"version":"1","layers":[{"name":"history","config":{}},{"name":"prompt","config":{"template":"Q"}},{"name":"output","config":{}}]}'

# 4) 两个 llm 层（同时命中「数量」与「重复」两条）
Test-Bad '{"version":"1","layers":[{"name":"llm","config":{}},{"name":"llm","config":{}},{"name":"output","config":{}}]}'

# 5) 未知层名
Test-Bad '{"version":"1","layers":[{"name":"llm","config":{}},{"name":"foo","config":{}}]}'

# 6) history 重复
Test-Bad '{"version":"1","layers":[{"name":"history","config":{}},{"name":"history","config":{}},{"name":"llm","config":{}}]}'

# 7) prompt 缺 template
Test-Bad '{"version":"1","layers":[{"name":"prompt","config":{}},{"name":"llm","config":{}}]}'

# 8) tools 引用未知工具
Test-Bad '{"version":"1","layers":[{"name":"tools","config":{"names":["nope"]}},{"name":"llm","config":{}}]}'

# 9) history.maxMessages 越界
Test-Bad '{"version":"1","layers":[{"name":"history","config":{"maxMessages":0}},{"name":"llm","config":{}}]}'

# 10) llm.maxRounds 越界
Test-Bad '{"version":"1","layers":[{"name":"llm","config":{"maxRounds":21}}]}'

# 11) history.compactionThreshold 越界
Test-Bad '{"version":"1","layers":[{"name":"history","config":{"compactionThreshold":101}},{"name":"llm","config":{}}]}'

# 12) history.keepRecent 越界
Test-Bad '{"version":"1","layers":[{"name":"history","config":{"keepRecent":51}},{"name":"llm","config":{}}]}'
```

**预期输出（本篇实测文案，逐字）**：

```text
400  composition version must be 1
400  layer 3 name is required
400  composition must contain exactly one llm layer
400  composition must contain exactly one llm layer; layer llm appears more than once
400  unknown layer: foo
400  layer history appears more than once
400  prompt layer template is required
400  tools layer references unknown tool: nope
400  history layer maxMessages must be between 1 and 100
400  llm layer maxRounds must be between 1 and 20
400  history layer compactionThreshold must be between 1 and 100
400  history layer keepRecent must be between 1 and 50
```

**顺序的两个组合用例**

```powershell
# A) 规则顺序：未知层（规则 3）在重复层（规则 4）之前
Test-Bad '{"version":"1","layers":[{"name":"history","config":{}},{"name":"history","config":{}},{"name":"llm","config":{}},{"name":"foo","config":{}}]}'

# B) 规则顺序：prompt（规则 5）在 history.maxMessages（规则 7）之前
Test-Bad '{"version":"1","layers":[{"name":"prompt","config":{}},{"name":"history","config":{"maxMessages":0}},{"name":"llm","config":{}}]}'
```

**预期**：

```text
400  unknown layer: foo; layer history appears more than once
400  prompt layer template is required; history layer maxMessages must be between 1 and 100
```

> 这两条验证的是「**顺序即契约**」：换一端实现，只要顺序错，拼接出的 `message` 就不同。

**校验失败不建 run**

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "select count(*) as runs from agent_runs;"
```

**预期**：计数与跑校验前**相同**（12 次 400 没有留下任何行）。

### 10.2 默认 5 层运行：`layer_started` / `layer_finished` 各 5 次

先准备一份默认 composition（`model` 省略 → 回退 `LLM_MODEL`）：

```powershell
$RUN = '{"input":"hello","composition":{"version":"1","layers":[{"name":"history","config":{}},{"name":"prompt","config":{"system":"You are a helpful assistant.","template":"Q: {{ input }}"}},{"name":"tools","config":{"names":["calculator","get_current_time"]}},{"name":"llm","config":{"maxRounds":5}},{"name":"output","config":{}}]}}'
Write-Utf8 "$PWD\run-default.json" $RUN
```

提交并拿 `runId`：

```powershell
$CREATED = curl.exe -s -X POST http://127.0.0.1:3001/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  --data-binary '@run-default.json' | ConvertFrom-Json

$CREATED | ConvertTo-Json -Compress
$RUN_ID = $CREATED.id
```

**预期**：`{"id":"...","status":"queued"}`（HTTP 202）。

抓完整事件流（流会在终态事件后自行关闭）：

```powershell
curl.exe -sN --max-time 60 "http://127.0.0.1:3001/agent/runs/$RUN_ID/events" `
  -H "Authorization: Bearer $TOKEN" -o events.txt

$EV = Get-Content events.txt -Encoding UTF8
"layer_started  = $(($EV | Select-String '^event: layer_started$').Count)"
"layer_finished = $(($EV | Select-String '^event: layer_finished$').Count)"
"terminal       = $(($EV | Select-String '^event: (run_finished|run_failed|run_cancelled)$').Count)"
```

**预期**（本篇实测）：

```text
layer_started  = 5
layer_finished = 5
terminal       = 1
```

看层顺序与 `index`：

```powershell
$EV | Select-String '^event: layer_started$' -Context 0,1 | ForEach-Object { $_.Context.PostContext[0] }
```

**预期**：

```text
data: {"layer":"history","index":1}
data: {"layer":"prompt","index":2}
data: {"layer":"tools","index":3}
data: {"layer":"llm","index":4}
data: {"layer":"output","index":5}
```

看最终输出：

```powershell
$EV | Select-String '^event: run_finished$' -Context 0,1
```

**预期**（mock provider）：

```text
event: run_finished
data: {"output":"echo: Q: hello","elapsedMs":...}
```

> `echo: ` 是 mock 的固定前缀；`Q: hello` 是 `template` 渲染后的**最后一条 user 消息**。换成真实模型时输出不同，但**层顺序与事件计数不变**。
>
> **前提是 provider 可用**：若 `LLM_API_KEY` 为空且没接 mock，`llm` 层会在开始时直接抛 `llm provider not configured: LLM_API_KEY`。此时 `layer_started = 4`（history/prompt/tools/llm）、`layer_finished = 3`（只有前三层）、终态是 `run_failed` 而不是 `run_finished`——因为抛错的层不发 `layer_finished`（本篇 §3.4 的执行器循环）。先按 `05-LLM节点/04-mock-LLM与无密钥自测.md` 接上 mock，再跑本节。

### 10.3 顺序实验：把 `output` 挪到 `llm` 之前

```powershell
$BAD_ORDER = '{"input":"hello","composition":{"version":"1","layers":[{"name":"prompt","config":{"template":"Q: {{ input }}"}},{"name":"output","config":{}},{"name":"llm","config":{}}]}}'
Write-Utf8 "$PWD\bad-order.json" $BAD_ORDER

$ID2 = (curl.exe -s -X POST http://127.0.0.1:3001/agent/runs `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  --data-binary '@bad-order.json' | ConvertFrom-Json).id

curl.exe -sN --max-time 60 "http://127.0.0.1:3001/agent/runs/$ID2/events" `
  -H "Authorization: Bearer $TOKEN" -o bad-events.txt

$EV2 = Get-Content bad-events.txt -Encoding UTF8
$EV2 | Select-String '^event: layer_started$' -Context 0,1 | ForEach-Object { $_.Context.PostContext[0] }
$EV2 | Select-String '^event: run_finished$' -Context 0,1
```

**预期**：

```text
data: {"layer":"prompt","index":1}
data: {"layer":"output","index":2}
data: {"layer":"llm","index":3}

event: run_finished
data: {"output":"","elapsedMs":...}
```

> 本节同样需要 provider 可用：`output` 提前只会让输出为空，**不会**让 `llm` 跳过执行；若 model 调用失败，终态仍是 `run_failed`，看不到 `run_finished`。

**这段在干什么**

三步验证「顺序即语义」：

1. `output` 在 `llm` 之前 → **不会 400**（校验器不看顺序）。
2. `layer_started` 的顺序**就是数组顺序**（没有隐式重排）。
3. `run_finished.output` 是**空串**：`output` 执行时消息数组里只有 `HumanMessage`，没有 `ai` 消息。

### 10.4 两端一致：同一批请求打 `:3001` 与 `:8000`

```powershell
$CASES = @(
  '{"version":"1","layers":[{"name":"llm","config":{}},{"name":"llm","config":{}}]}',
  '{"version":"1","layers":[{"name":"history","config":{}},{"name":"history","config":{}},{"name":"llm","config":{}},{"name":"foo","config":{}}]}',
  '{"version":"1","layers":[{"name":"prompt","config":{}},{"name":"history","config":{"maxMessages":0}},{"name":"llm","config":{}}]}',
  '{"version":"1","layers":[{"name":"tools","config":{"names":["nope"]}},{"name":"llm","config":{"maxRounds":21}}]}'
)

foreach ($json in $CASES) {
  Write-Utf8 "$PWD\case.json" $json
  foreach ($port in 3001, 8000) {
    $code = curl.exe -s -o err.json -w '%{http_code}' -X POST "http://127.0.0.1:$port/agent/runs" `
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary '@case.json'
    $msg = (Get-Content err.json -Encoding UTF8 -Raw | ConvertFrom-Json).message
    "${port}  $code  $msg"
  }
}
```

**预期**：每对端口的 `code` 与 `msg` **逐字节相同**。第 4 个用例应特别检查规则 5 与规则 9 的先后：

```text
3001  400  tools layer references unknown tool: nope; llm layer maxRounds must be between 1 and 20
8000  400  tools layer references unknown tool: nope; llm layer maxRounds must be between 1 and 20
```

### 10.5 静态检查（不启动服务也能做）

```powershell
# 两端的允许层名（白名单，不是执行顺序）
Select-String -Path apps\api-ts\src\agent\composition.validator.ts `
  -Pattern "const LAYER_NAMES" -Context 0,1
Select-String -Path apps\api-py\app\agent\validator.py `
  -Pattern "LAYER_NAMES" -Context 0,1

# 11 条文案在两端各出现一次（英文文案逐字相同）
Select-String -Path apps\api-ts\src\agent\composition.validator.ts,apps\api-py\app\agent\validator.py `
  -Pattern 'must be between|appears more than once|unknown layer|exactly one llm|template is required|unknown tool|version must be 1|name is required'
```

**预期**：两端的 `LAYER_NAMES` 顺序相同（`history, prompt, tools, llm, output`）；每条文案在两侧都能找到，且**没有任何改写**。

### 10.6 验收清单

| # | 检查项 | 做法 | 预期 |
| --- | --- | --- | --- |
| 1 | 契约编译 | `pnpm run build:contract` | 无报错；版本 `0.11.0` |
| 2 | 默认 5 层 | §10.2 | `layer_started = 5` / `layer_finished = 5` |
| 3 | `index` | §10.2 | `1..5`，与数组顺序一致 |
| 4 | 终态唯一 | §10.2 | `terminal = 1` |
| 5 | `version` / 层 `name` | §10.1 #1–#2 | 400 `composition version must be 1` / `layer 3 name is required`（两端同一文案） |
| 6 | 缺 `llm` | §10.1 #3 | 400 `composition must contain exactly one llm layer` |
| 7 | 两个 `llm` | §10.1 #4 | 400 两条错误，`; ` 连接 |
| 8 | 未知 / 重复 / 必填 / 工具 / 四个范围 | §10.1 #5–#12 | 8 条文案逐字命中 |
| 9 | 规则顺序 | §10.1 A/B | 两条组合文案逐字命中 |
| 10 | 校验不建 run | §10.1 末尾 | `agent_runs` 计数不变 |
| 11 | 错序不报错、输出为空 | §10.3 | 200 SSE + `output: ""` |
| 12 | 两端一致 | §10.4 | `statusCode` 与 `message` 逐字节相同 |
| 13 | 不带 `history` | 删掉该层跑一次 | 仍成功；消息数组从空开始 |
| 14 | 不带 `tools` | 删掉该层跑一次 | 仍成功；不发生 `tool_call` |

---

## 11. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 以为 `LAYER_NAMES` 的顺序就是执行顺序 | 调整常量顺序后行为没变 | `LAYER_NAMES` 只是白名单；顺序只由 `layers` 数组决定（§9.5） |
| 把 `output` 写在 `llm` 前 | 不报错，但 `run_finished.output` 是空串 | `output` 看不到 `ai` 消息；顺序是客户端的责任（§9.5） |
| 把 `tools` 写在 `llm` 后 | 模型不调用任何工具 | `llm` 读 `toolNames` 时它还是空；后写的值无人读（§9.5） |
| 把 `prompt` 写在 `llm` 后 | 模型答非所问 / 没有指令 | `llm` 只读执行到它那一刻的消息数组（§9.5） |
| 以为服务端会「帮忙排序」 | 事件顺序与预期不符 | 契约明确「不做隐式重排」（§9.5） |
| 写两个 `llm` 层 | 400，且文案是两条拼接 | 数量规则在前、重复规则在后（§9.4、§9.6） |
| 缺 `llm` 层 | 400，不建 run | 没有执行核心就没有「运行」（§9.4） |
| 把 `llm` 当成可选层 | 期望「不写就不推理」 | 它不是装饰层，是唯一执行核心（§9.4） |
| 配置键拼错（`maxMessage`） | 不报错，实际用默认 `20` | `config` 是自由结构，校验器只认 11 条规则里的键（§9.6） |
| 以为 `composition.version` 不校验 | 传 `"999"` / 数字 `1` / 缺 `version` 都 400 `composition version must be 1` | 校验器第一条就查它（§9.6、§9.10） |
| 以为 400 会留下一条 run 记录 | `agent_runs` 里找不到 | `validate` 在 `create` 之前（§9.6） |
| 未配置 `LLM_API_KEY` 就提交 | `202` 成功，随后流里 `run_failed` | 校验只覆盖 composition，不覆盖 provider；这是执行期错误（阶段 4 的双通道） |
| 层抛错时期望有 `layer_finished` | 只看到 `run_failed` | `layer_finished` 在 `runLayer` 之后发；抛错就跳过（本篇 §3.4） |
| 以为 `history` 不写 = `maxMessages: 0` | 消息数组为空，且没有压缩 | 是「整层不存在」，不是「窗口为 0」（§9.7） |
| 以为 Agent 会读写会话 | 数据库里没有 `messages` 新行 | `history` 只读 `config.messages`，不碰会话表（§9.7） |
| 以为 `tools` 层会执行工具 | 找不到工具执行痕迹 | 它只声明 `toolNames`；执行在 `llm` 层（§7.3） |
| 层缺 `name` / `name` 为空串 / 层不是对象 | 400 `layer {index} name is required`（index 从 1） | 两端同一文案（实测 `BYTE_EQUAL=True`）；命中后跳过该层后续检查（§9.6） |
| 用图的字段拼 composition（`nodes` / `edges`） | 400 `... should not exist` | `Composition` / `CompositionLayer` 都是 `additionalProperties: false`（§4.2） |
| 以为 Agent 与工作流的工具不同 | 工具行为不一致的错觉 | 共用同一注册表与 `ToolError`（§9.9） |
| 以为 Agent 的事件也能直接套工作流客户端 | 帧解析失败 | Agent 帧**多一行 `id:`**，需按 `agent-events.md` §1 解析 |
| 以为砍掉 `RuntimeLease` 不影响什么 | 并发提交后 provider 被打满；崩溃后 run 卡在 `running` | 没有配额、没有 reaper、取消是协作式（§9.8） |

---

## 12. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 | 登记 |
| --- | --- | --- |
| **Composition vs Graph：为什么 Agent 可以不要图** | 工作流用节点 + 连线描述「下一步去哪」；Agent 的层间顺序固定（历史 → 提示 → 工具 → 推理 → 输出），变化的是**参数**而不是**拓扑**，图退化成列表。图的三种能力（分支/环/并行）在层间一个都不需要；但图的成本（画布、边校验、拓扑调度）全部存在 ⇒ 纯开销。**图并未消失：`llm` 层内部仍是 `StateGraph`（llm ↔ tools 环 + 条件边）** ⇒ 「层间线性，层内有图」 | **首次教学于本篇** |
| **声明式装配的四个特征** | ① 提交**数据**（JSON）而非代码；② 服务端把 `name` 映射到实现（本项目是 `switch` / `if-elif`，动态注册表在工具侧）；③ **无连线、无坐标、无画布**（`Composition` 只有 `version` + `layers`）；④ **校验前置**（纯函数先过，失败不建 run）。另：`composition` 随 run 落库（JSONB），执行器**从 DB 读回**，所以可审计/可重放/不持有请求对象 | **首次教学于本篇** |
| **层的统一契约 `run(state, config)`** | 统一形状 `(state, config)`；`emit` 只在需要发事件的层出现（Python 仅 `llm`，TS 恒传但多数层忽略）。**只读 `config`、只写自己负责的 `state` 字段**：`messages` 由 history/prompt 追加、llm 替换；`toolNames` 仅 tools 写；`output` 仅 output 写；`input` / `checkCancelled` 由执行器写。**写回显式**（`state.messages = result.messages`、`state.output = ...`），跨层不用 reducer。层边界事件由执行器统一发 | **首次教学于本篇** |
| **`llm` 层必须恰好一个** | 它是**唯一执行核心**（调用 provider、发 token、跑 ReAct、产出 `ai` 消息）；其它层是**输入准备**（history/prompt/tools）与**输出收尾**（output）。0 个 → 400 且「运行没有发生」；≥2 → 400，且同时命中「数量」与「重复」两条；双份调用会导致成本翻倍、事件序列无定义、`output` 只取最后一条、`state.llm` 被覆盖。composition 的真实形状是 `(准备层)* + llm + (收尾层)*`，但执行器只强制**数量**、不强制**位置** | **首次教学于本篇** |
| **层的顺序即语义** | 顺序唯一来源是 `layers` 数组下标；`LAYER_NAMES` 只是白名单，不是顺序。四种错序**都不会 400**：output 提前 → 输出空串；prompt 滞后 → 模型没有指令；tools 滞后 → 不绑定工具；history 滞后 → 历史排在模板之后。契约明确「不做隐式重排」，因为重排会让 `layer_started.index` 与请求对不上，并覆盖客户意图 | **首次教学于本篇** |
| **配置校验：纯函数 + 11 条固定顺序** | 分工三层：框架层（input 长度 / composition 是对象，通用文案）→ 纯函数校验器（层语义，§11 专用文案）→ 执行期兜底（默认值，不产错误）。11 条顺序：`composition.version` → 层 `name` 必填 → llm 数量 → 未知层 → 同层重复 → prompt.template → tools.names → history.maxMessages → history.compactionThreshold → history.keepRecent → llm.maxRounds；同规则内按数组顺序，多条用 `"; "` 连接。**顺序本身是契约**（逐字节对拍）；校验在 `agentRun.create` 之前 ⇒ 400 不建 run。边界：`version` **已校验**（必须 `"1"`）、层 `name` 缺失/非对象**已统一**为 `layer {index} name is required`（两端实测 `BYTE_EQUAL=True`）；仅 `config` 未知键仍不校验 | **首次教学于本篇** |
| **可选层与默认值写进契约** | 「不写」有两种：整层不出现（该阶段不发生）vs 字段不写（用默认值）。默认值 `maxMessages=20` / `compactionThreshold=12` / `keepRecent=6` / `maxRounds=5` 同时写进 `agent-events.md` 与两端常量；`maxRounds` 三级回退（层配置 → `AGENT_MAX_ROUNDS` → 5）。Agent 历史只来自 `config.messages`，**不读写会话表**（与阶段 9 的会话语义不同） | **首次教学于本篇** |
| **砍掉的范围与真实代价** | 砍掉 `Workspace`（多租户命名空间）、`Binding`（资源绑定）、`RuntimeLease`（运行期租约/账本）、沙箱后端（E2B / OpenShell），理由：**平台运维 ≠ Agent 开发**。失去：多租户配额与限流、隔离执行（工具在 API 进程内跑，仅有阶段 6 的工具侧安全）、资源回收（无 reaper，崩溃后 run 可能永远 `running`）、运行期账本。保留：异步 Run、事件持久化与重放、协作式取消、ReAct、工具、上下文压缩 | **首次教学于本篇** |
| **两个引擎并存：Agent 运行时 vs 工作流引擎** | 共用：工具注册表（`hasTool` / `executeTool` / `ToolError`）、`ChatOpenAI` 配置（`runLlmStep` / `run_llm_step`、`maxRetries=0`、env）、错误映射（6 条文案 + `tool {name} failed: {reason}`）。不同：输入（图 vs 层）、控制权（人连边 vs 固定骨架 + 模型决定调工具）、状态（变量池 vs 消息数组）、事件（节点 vs 层；Agent 持久化且帧多 `id:`）、表（apps/conversations vs agent_runs）。**并存不替换**；阶段 6「不加 Agent 节点」的结论仍然成立，阶段 11 是需求变化后的第二个执行核心 | **首次教学于本篇** |

> 本阶段后续篇目首次教学、本篇仅引用：异步 Run 状态机（`queued` / `running` / 终态）、`agent_run_events` 的 `seq` 与 `UNIQUE(run_id, seq)`、`Last-Event-ID` 重放算法、取消标记与收尾见 `01-Run模型与事件重放.md`；历史压缩的逐字节算法与 ReAct 循环细节见 `03-ReAct循环与上下文压缩.md`；前端 Agent 面板见 `04-前端Agent控制台与SSE重连.md`。
>
> 已在前序篇教学、本篇仅引用不重讲：OpenAPI 的 `paths` / `$ref` / `enum` / `additionalProperties` 见 `00-项目初始化/04`；DTO / `ValidationPipe` / Pydantic v2 见 `01-账号与认证/03`、`00-项目初始化/06`；纯函数业务规则与契约文案目录见 `03-画布/01`、`02-应用管理/07`；JSONB 见 `03-画布/02`；SSE 帧与「先校验、后开流」见 `04-执行引擎/01`、`04-执行引擎/05`；`ChatOpenAI` / `maxRetries=0` / 错误映射见 `05-LLM节点/02`、`05-LLM节点/03`；工具注册表与工具安全见 `06-工具调用/01`；ReAct 与条件边见 `06-工具调用/02`；模板安全解析见 `04-执行引擎/03`；会话与历史注入见 `09-会话与记忆/02`；「契约砍字段」见 `10-发布与API/01`。
