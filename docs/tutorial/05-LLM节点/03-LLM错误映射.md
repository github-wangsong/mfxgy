# 03 · LLM 错误映射

> 所属：阶段 5 · LLM 节点
> 本篇覆盖：`llm` 节点调用**真实模型**失败时，如何把 LangChain / 底层 SDK 的**原始异常**映射成**两端逐字节一致**的规范文案——TS 侧 `apps/api-ts/src/engine/nodes/llm.node.ts` 的 `mapLlmError`，Py 侧 `apps/api-py/app/engine/nodes/llm.py` 的 `map_llm_error`，文案真源 `packages/contract/error-messages.md` §5。**LLM 节点的正常调用**（Prompt 渲染、`ChatOpenAI` 构造、逐 chunk 流式发 `token`、`usage` 累积）见本阶段 `02-真实模型调用与流式.md`；**契约字段与模型参数**见本阶段 `01-LLM节点契约与模型配置.md`；**mock 与无密钥自测**见下一篇 `04-mock-LLM与无密钥自测.md`；**端到端验收**见本阶段 `05-验收.md`。
> 本篇首次教学：**外部依赖的不可靠性**（真实系统与本地练习的分水岭）· **为什么必须把库的原始错误「映射」成自己的规范文案** · **错误发生在「流中」而非「流前」→ 只能走 `run_failed` 事件**（呼应阶段 4 的双通道错误；出错时**不发**该节点的 `node_finished`）· **`maxRetries = 0` 的取舍**（LangChain JS `AsyncCaller` 默认重试 6 次会把 5xx / 超时拖到 30 秒以上；关掉重试才能让两端**错误分类与耗时行为一致**）
> （SSE 帧格式与 `run_failed` 事件 payload 见阶段 4 · 01；「请求级 400 vs 流内 `run_failed`」的双通道错误设计见阶段 4 · 01 / 05；服务端手写流见阶段 4 · 05；节点执行器「节点 = 纯函数」与变量池见阶段 4 · 03 / 04；错误文案目录的建立（`error-messages.md`）见阶段 2 · 07；`RunError` / `run_failed` 的构造见阶段 4 · 02 —— 本篇**只引用、不重讲**）

---

## 1. 本篇目标

做完这一篇，你能：

- 讲清楚**为什么真实系统一定会遭遇「外部依赖失败」**，而本地练习阶段（阶段 0~4）里永远见不到。
- 讲清楚**为什么不能把 LangChain / OpenAI SDK 的原始错误直接透给客户端**，而必须「映射」成自己定义的规范文案。
- 说出本项目 LLM 错误的** 6 条规范文案**及其触发条件（`error-messages.md` §5）。
- 讲清楚 LLM 出错时的**通道选择**：因为连接早已开始，错误**只能走 `run_failed` 事件**（HTTP 仍是 200 的 SSE 流），且**不发**该节点的 `node_finished`。
- 理解 `maxRetries = 0` 这个**真实踩坑**：LangChain JS 默认重试 6 次会毁掉错误演示与两端一致性，并说清「重试该放在哪一层」。
- 读懂映射函数：**状态码优先 → 超时 → unknown** 的判定顺序，以及两端取状态码时**属性名不同**的适配。

**验收标准**

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | 6 个错误用例，两套后端各跑一遍 | 两端的 `run_failed.message` **逐字节一致** |
| 2 | 未配置密钥 | `llm provider not configured: LLM_API_KEY`（HTTP 仍 200 流） |
| 3 | 401 / 403 | `llm request unauthorized` |
| 4 | 429 | `llm rate limited` |
| 5 | 其它 HTTP（如 500） | `llm request failed: 500` |
| 6 | 超时 | `llm request timed out` |
| 7 | 无法归类（端口不可达） | `llm request failed: unknown` |
| 8 | 出错节点的 `node_finished` | **没有**（只有 `node_started` + `run_failed`） |
| 9 | 出错后是否还有 `run_finished` | **没有**（`run_failed` 即收束，流随即结束） |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| Node / pnpm、`pnpm install` 已执行 | 阶段 0 · 01 / 03 |
| PostgreSQL 容器在跑（引擎要读草稿 `graphJson`） | 阶段 0 · 02 |
| 契约包已构建 | 阶段 0 · 04 |
| `POST /apps/{id}/run` 契约 + SSE 事件协议（6 种事件，含 `run_failed`）已冻结 | 阶段 4 · 01 |
| 服务端已能返回 SSE 流（TS `RunController` / Py `run_app`） | 阶段 4 · 05 |
| 引擎已能按拓扑序执行节点、构造事件、在出错时发 `run_failed` | 阶段 4 · 02 / 04 |
| `llm` 节点已从「桩」升级为**真实 `ChatOpenAI` 调用**（`runLlmNode` / `run_llm_node`） | 本阶段 `02-真实模型调用与流式.md` |
| 环境变量 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS` 已进两端配置 | 本阶段 `01-LLM节点契约与模型配置.md` |
| mock LLM 服务可运行（错误用例靠它注入） | 下一篇 `04-mock-LLM与无密钥自测.md` |
| 已注册登录、有一个合法草稿图（`start → llm → end`） | 阶段 1 · 07；阶段 2 · 06；阶段 3 · 06 |

---

## 3. 命令清单（逐条说明）

本篇不新增依赖，主要是**起 mock + 注入错误 + 观察 `run_failed`**。TS 侧命令在仓库根（`mini-dify/`）执行；Py 侧在 `apps/api-py` 目录（或直接用根脚本 `pnpm dev:api-py`）执行。Windows PowerShell 下 `curl` 是 `Invoke-WebRequest` 的别名，请显式用 **`curl.exe`**。

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `node tools/mock-llm/server.mjs` | 仓库根 | 起 mock provider（监听 **11435**） | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| 编辑 `apps/api-ts/.env`：`LLM_BASE_URL=http://127.0.0.1:11435/v1` / `LLM_API_KEY=test` / `LLM_MODEL=mock-model` / `LLM_TIMEOUT_MS=3000` | 编辑器 | 把 provider 指向 mock（无真实密钥） | — |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001） | `api-ts listening on http://localhost:3001` |
| （或）`pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000） | `Uvicorn running on http://127.0.0.1:8000` |
| 把某个应用的 `llm` 节点 `prompt` 改成 `[[mock-status:401]]` 后保存草稿 | 前端画布 | 注入 401 错误（**为什么靠 prompt 标记见 4.4 / 04**） | 草稿保存成功 |
| `curl.exe -N -X POST http://localhost:3001/apps/<APP_ID>/run -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" -d "{\"inputs\":{}}"` | 任意终端 | **观察错误通道**：流里出现 `run_failed`，无该节点 `node_finished` | 见第 6 节实测回放 |
| 把 `prompt` 依次改成 `[[mock-status:429]]` / `[[mock-status:500]]` / `[[mock-delay:10000]]`，重复上一条 | 前端画布 + 终端 | 覆盖 429 / 500 / 超时 三类 | 四类 message 见第 6 节 |
| 把 `apps/api-ts/.env` 的 `LLM_API_KEY=` 置空、重启后端 | 编辑器 + 终端 | 触发「未配置密钥」 | `llm provider not configured: LLM_API_KEY` |
| 把 `LLM_BASE_URL` 指向一个**未监听**端口（如 `http://127.0.0.1:19999/v1`），重启后端 | 编辑器 + 终端 | 触发「无法归类」 | `llm request failed: unknown` |
| 把 `<TOKEN>` / `<APP_ID>` 与 base URL 换成 Py 侧，重复全部用例 | 任意终端 | 验证**两端逐字节一致** | message 与 TS 侧完全相同 |

> `pnpm dev:api-ts` / `pnpm dev:api-py` 只引用不重讲（见阶段 0 · 05 / 06）。`-N`（`--no-buffer`）关闭 curl 自身缓冲，才能看到逐帧到达（见阶段 4 · 05）。
>
> **内置开发环境的当前配置**：`apps/api-ts/.env` 已把 `LLM_BASE_URL` 指向 mock、`LLM_API_KEY=test`、`LLM_MODEL=mock-model`、`LLM_TIMEOUT_MS=3000`（见 04 篇），所以上面的「编辑 .env」在本地这套配置下多数可跳过，直接改 prompt 标记即可。

---

## 4. 完整代码

本篇涉及三处：**文案真源**（契约文件的一段）+ **两端映射函数**（各一个）。LLM 节点的**正常调用体**（`runLlmNode` / `run_llm_node`）见本阶段 `02-真实模型调用与流式.md`，此处只并列它的**错误映射出口**。

### 4.1 文案真源：`packages/contract/error-messages.md` §5

**完整文件路径：`packages/contract/error-messages.md`（第 5 节）**

```md
## 5. LLM 错误（`POST /apps/{id}/run` 流内 `run_failed`）

`llm` 节点调用 provider 失败时，错误经 `run_failed` 事件的 `message` 传出
（HTTP 状态码不变，仍是 `200` 的 SSE 流；事件协议见 `sse-events.md`）。

两端必须用**同一规则**把 LangChain / 底层异常映射为下列**规范文案**——
**不**透出库的原始 message（否则两端无法逐字节一致）。该节点出错时**不**发
`node_finished`。

| 场景 | 触发条件 | `message` |
| --- | --- | --- |
| 未配置密钥 | `LLM_API_KEY` 为空 | `llm provider not configured: LLM_API_KEY` |
| 未授权 | provider 返回 401 / 403 | `llm request unauthorized` |
| 限流 | provider 返回 429 | `llm rate limited` |
| 超时 | 请求超时 | `llm request timed out` |
| 其它 HTTP 错误 | provider 返回其它非 2xx | `llm request failed: {statusCode}` |
| 无法归类 | 其它异常（如连接失败 / 无法解析） | `llm request failed: unknown` |

- `{VAR}` 为缺失的环境变量名（当前唯一情形是 `LLM_API_KEY`）。
- `{statusCode}` 为 provider 返回的 HTTP 状态码（如 `500`）。

实现位置：

- api-ts：`apps/api-ts/src/engine/nodes/llm.node.ts` 的 `mapLlmError`。
- api-py：`apps/api-py/app/engine/nodes/llm.py` 的 `map_llm_error`。
```

### 4.2 TS 侧映射：`apps/api-ts/src/engine/nodes/llm.node.ts`（摘录）

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`**

「未配置密钥」的短路与「调用失败」的映射出口（`runLlmNode` 内）：

```ts
export async function runLlmNode(
  node: GraphNode,
  pool: Pool,
  emitToken: (text: string) => void,
): Promise<Record<string, unknown>> {
  const data = node.data as unknown as LlmNodeData
  const apiKey = process.env.LLM_API_KEY ?? ''
  if (apiKey === '') {
    throw new RunError('llm provider not configured: LLM_API_KEY')   // ← 未配置密钥：直接短路
  }

  const prompt = renderTemplate(String(data.prompt), pool)
  const model = data.model ? data.model : (process.env.LLM_MODEL ?? '')
  const client = new ChatOpenAI({
    apiKey,
    model,
    configuration: { baseURL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1' },
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
    // 不重试（LangChain AsyncCaller 默认重试 6 次会让 5xx/超时长时间挂起）；两端一致
    maxRetries: 0,
    ...(typeof data.temperature === 'number' ? { temperature: data.temperature } : {}),
    ...(typeof data.maxTokens === 'number' ? { maxTokens: data.maxTokens } : {}),
  })

  // …（构造 messages、逐 chunk 发 token、累积 text / usage，见本阶段 `02-真实模型调用与流式.md`）…

  try {
    for await (const chunk of await client.stream(messages)) {
      // …
    }
  } catch (error) {
    throw new RunError(mapLlmError(error))   // ← 调用失败：映射为规范文案后走 run_failed
  }

  // …（组装输出 { text, model, usage? }）…
}
```

映射函数本体（本篇重点）：

```ts
/**
 * 把 LangChain / 底层异常映射为规范文案（规则与 api-py 的 `map_llm_error` 一致，见 error-messages.md §5）。
 * 映射为纯函数：HTTP 状态码优先，其次超时，最后归入 unknown。
 */
export function mapLlmError(error: unknown): string {
  const status = statusCodeOf(error)
  if (status !== null) {
    if (status === 401 || status === 403) {
      return 'llm request unauthorized'
    }
    if (status === 429) {
      return 'llm rate limited'
    }
    return `llm request failed: ${status}`
  }
  if (isTimeout(error)) {
    return 'llm request timed out'
  }
  return 'llm request failed: unknown'
}

/** 取异常的 HTTP 状态码（OpenAI SDK 的 APIError 带 `status`）。 */
function statusCodeOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') {
      return status
    }
  }
  return null
}

/** 判定是否为超时（OpenAI SDK 的 `APIConnectionTimeoutError` / AbortError，或消息含 timeout）。 */
function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const name = (error as { name?: unknown }).name
  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError' || name === 'AbortError') {
    return true
  }
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /timed? ?out|timeout/i.test(message)
}
```

### 4.3 Py 侧映射：`apps/api-py/app/engine/nodes/llm.py`（摘录）

**完整文件路径：`apps/api-py/app/engine/nodes/llm.py`**

「未配置密钥」的短路与「调用失败」的映射出口（`run_llm_node` 内）：

```python
async def run_llm_node(
    node: dict[str, Any], pool: dict[str, Any], emit: EmitToken
) -> dict[str, Any]:
    data: dict[str, Any] = node["data"]
    api_key = settings.llm_api_key
    if not api_key:                                                # ← 空 key 判据：`not api_key`（空串为假）
        raise RunError("llm provider not configured: LLM_API_KEY")   # ← 未配置密钥：调用前直接短路（常量文案）

    prompt = render_template(str(data["prompt"]), pool)
    model = data.get("model") or settings.llm_model
    # …（extra：temperature / max_tokens）…

    client = ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=settings.llm_base_url,
        timeout=settings.llm_timeout_ms / 1000,
        # 不重试（与 api-ts 的 maxRetries: 0 对齐，保证错误快速、归一）
        max_retries=0,                                             # ← 关掉库的隐式重试（§5.5）
        **extra,
    )

    # …（构造 messages、累积 text / usage）…

    try:
        async for chunk in client.astream(messages):               # ← 调用在此发生，错误也在此抛出
            # …
    except Exception as error:  # noqa: BLE001 - 统一映射为规范文案
        raise RunError(map_llm_error(error)) from error            # ← 调用失败：映射为规范文案；from 保留因由
    # …
```

**这段在干什么（按执行顺序）**：

1. `if not api_key:`：`not api_key` 对空串为 `True`（Python 空串是「假值」）。**这是「未配置密钥」的唯一入口**——它在**建 client 之前**，所以**根本不发网络请求**，其文案是常量而非从异常映射出来。
2. `ChatOpenAI(..., max_retries=0)`：建客户端并**显式关掉重试**（§5.5）。
3. `async for chunk in client.astream(messages)`：真正的网络调用在这里；provider 返回 401/429/500/超时等，都会**在这里抛异常**。
4. `except Exception as error:` → `raise RunError(map_llm_error(error)) from error`：捕获**任何**异常 → 交给 `map_llm_error` 归一成规范文案 → 包成 `RunError` 抛出。`from error` 把原始异常**挂在「因由」链**上（排查时能看到根，但对外只出规范文案）。

映射函数本体：

```python
def map_llm_error(error: Exception) -> str:
    """把 LangChain / 底层异常映射为规范文案（规则与 api-ts 的 `mapLlmError` 一致）。"""
    status = _status_code(error)                     # ① 先试着从异常里抠出 HTTP 状态码
    if status is not None:                           #   有状态码 → 按状态码分类
        if status in (401, 403):
            return "llm request unauthorized"        #   401/403 → 未授权
        if status == 429:
            return "llm rate limited"                #   429 → 限流
        return f"llm request failed: {status}"       #   其它（如 500）→ 带状态码
    if _is_timeout(error):                           # ② 没状态码 → 再看是不是超时
        return "llm request timed out"
    return "llm request failed: unknown"             # ③ 都不是 → 兜底 unknown


def _status_code(error: Exception) -> int | None:
    """取异常的 HTTP 状态码（Python openai SDK 的 APIStatusError 带 `status_code`）。"""
    for attr in ("status_code", "status"):           # 依次试两个属性名（Python SDK 主用 status_code）
        value = getattr(error, attr, None)           # 属性不存在 → None（不抛 AttributeError）
        if isinstance(value, int):                   # 只接受整数（挡掉字符串状态码 / None / True 之类）
            return value
    return None                                      # 两个属性都没有 → 返回 None


def _is_timeout(error: Exception) -> bool:
    """判定是否为超时（`APITimeoutError` / `TimeoutError`，或消息含 timeout）。"""
    if type(error).__name__ in ("APITimeoutError", "TimeoutError", "APIConnectionTimeoutError"):
        return True                                  # 判据 A：异常的「类型名」命中超时类
    message = str(error).lower()                     # 判据 B：把消息转小写再找关键词
    return "timed out" in message or "timeout" in message
```

**这段在干什么（按执行顺序）**：

1. `status = _status_code(error)`：先尝试取 HTTP 状态码（`_status_code` 内部会试 `status_code`、再试 `status`，且**只认整数**）。
2. `if status is not None:`：**有状态码就走这一支**——401/403 → `llm request unauthorized`；429 → `llm rate limited`；其余 → `llm request failed: {status}`。**注意判定顺序：状态码优先于超时**。
3. 没有状态码，再看 `_is_timeout(error)`（**先看类型名、再看消息关键词**两重判据）→ `llm request timed out`。
4. 都不匹配 → 兜底 `llm request failed: unknown`（如端口不可达）。
5. 三个函数都是**纯函数**：不碰网络、不依赖全局状态，喂一个异常对象就能算出文案——所以可单独测、两端可逐条对齐。

> **为什么 `_status_code` 要「先取属性、再验类型」**：外部 SDK 的异常对象**结构不完全受你控制**——`status_code` 可能是 `int`、也可能不存在。`getattr(error, attr, None)` 提供一个**安全默认值**，`isinstance(value, int)` 再**验证类型**，避免把 `None` 或字符串误当状态码。这是处理外部对象时的通用防御式写法。

### 4.4 错误注入是怎么触发的（与 mock 的约定）

> **为什么错误用例要靠「渲染进 prompt 的标记」触发**：LangChain 封装了底层 HTTP 调用，**不允许**我们往请求上塞自定义头（`x-mock-status`），所以 mock 额外支持「从 **user 消息内容**里读标记」——prompt 渲染成 `[[mock-status:401]]` 后，mock 就返回 401。这个「绕法」是对「客户端不可控时如何测试外部依赖」的常见解法。运行 mock 的命令与注入标记的完整语义见 `04-mock-LLM与无密钥自测.md`。

---

## 5. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 5 · 03」并直接使用。

### 5.1 「外部依赖的不可靠性」是真实系统与本地练习的分水岭

阶段 0~4 里，`llm` 节点是一个**桩**：把渲染后的 `prompt` 按固定码点数切分、立刻吐出来。它对**输入**负责，但**永远不会失败**——它不联网、不付费、不依赖别家公司。

真实 LLM 节点把「确定性代码」变成了「**一次跨网络、跨公司、可能付费的远程调用**」，于是第一次出现了本地练习里**永远遇不到**的一整类情形：

| 故障 | 触发原因（真实世界） | 本地练习里会见到吗 |
| --- | --- | --- |
| **超时** | provider 排队 / 网络抖动 / 模型慢 | 不会（桩不联网） |
| **限流 429** | 配额用尽 / 并发过高 | 不会 |
| **鉴权失败 401/403** | Key 过期 / 拼错 / 无权限访问该模型 | 不会 |
| **服务端 5xx** | provider 自身故障 | 不会 |
| **连不上 / 域名解析失败** | 网络断、base URL 写错、端口不通 | 不会 |
| **未配置密钥** | 部署时漏配环境变量 | 不会 |

**这是本阶段最重要的工程认知**：写「能跑通」的代码容易，写「**跑不通时还能给出可预期行为**」的代码才难。从阶段 5 起，我们的代码开始要对「**别人家的服务**」的可靠性负责。

### 5.2 为什么必须把库的原始错误「映射」成自己的规范文案

一个自然的偷懒做法是：`catch (e) { throw new RunError(e.message) }`——把库的原话透给客户端。**这样做会同时踩三个坑**：

1. **原始文案两端不同，破坏「两端一致」**。
   LangChain（及底层 openai SDK）的报错**在 TS 与 Python 两侧字面不同**：TS 侧可能是 `OpenAI API error: 401 Incorrect API key provided...`，Python 侧可能是 `Error code: 401 - {'error': {'message': 'Incorrect API key provided'}}`——连结构都不一样。只要透出原文，两套后端对同一故障就会给出**不同字节**的 `run_failed.message`，「契约一致」当场破产（阶段 0 · 08 起的那条硬约束）。

2. **原始错误会泄露内部实现细节与密钥信息**。
   provider 的报错常夹带：你请求的 URL、header 快照、模型名、有时甚至 **Key 的前几位或整段**。「把一句话透给客户端，等于把攻击者想知道的东西顺手送出去」。规范文案是**白名单**：只暴露「发生了什么类别的事」，不暴露内幕。

3. **客户端要能稳定地处理——文案是接口的一部分**。
   一旦前端想「遇到限流就提示用户稍后重试、遇到未授权就跳登录」，它就必须**按文案/类别**分支判断。若文案随库版本漂移，前端逻辑就碎掉。把文案**冻结进契约**（`error-messages.md` §5），它就从「实现细节」升级成**接口**，可以像测状态码一样测它。

> **一句话**：把「不可控的外部错误」翻译成「可控的、自己说了算的、两端一致的类别」，是接入任何第三方服务时的**必修课**。本项目把它沉淀成一份 6 条的**映射表**。

### 5.3 规范文案表（6 条，唯一真源 §5）

| 情形 | 判定依据 | 文案 |
| --- | --- | --- |
| 未配置密钥 | `LLM_API_KEY` 为空（**调用前**就判） | `llm provider not configured: LLM_API_KEY` |
| 401 / 403 | 异常带 HTTP 状态码 401 或 403 | `llm request unauthorized` |
| 429 | 异常带状态码 429 | `llm rate limited` |
| 超时 | 异常是超时类 / 名字或消息含 timeout | `llm request timed out` |
| 其它 HTTP | 异常带其它非 2xx 状态码 | `llm request failed: {statusCode}`（如 `…: 500`） |
| 无法归类 | 以上都不匹配（连接失败 / 解析失败 …） | `llm request failed: unknown` |

映射的**判定顺序固定为「状态码 → 超时 → unknown」**（两端一致）：有状态码就先按状态码分类（401/403 → 未授权、429 → 限流、其余 → `failed: {code}`）；没有状态码再看是不是超时；都不是才落 `unknown`。

> 「未配置密钥」是一条**独立短路**：它发生在**构造 client 之前**（`LLM_API_KEY` 为空即 `throw`），根本不会发起网络请求，所以它的文案是**常量**而非从异常映射得来。

### 5.4 错误发生在「流中」：只能走 `run_failed`，且不发 `node_finished`

回顾阶段 4 的**双通道错误**（见阶段 4 · 01 / 05）：

- **请求级错误**（图非法 / 草稿为空 / 未认证 / 归属不符）在**开流之前**发生 → 以普通 JSON 400 / 401 / 404 出去；
- **运行期错误**在**开流之后**发生 → **HTTP 状态码已经发出去了（200）**，改不了，只能把错误塞进**流里的 `run_failed` 帧**。

LLM 调用属于**后者**——而且是最典型的那种：`run_started`、`node_started` 早就发完了，连接正在传输中，此刻 provider 才回 429。**你不可能把已发出的 200 改成 429**，所以：

```
run_started
node_started( llm )
  token …（若已开始流式）
run_failed            ← message = 规范文案；此节点【不】发 node_finished
（流结束，无 run_finished）
```

**为什么出错时「不发该节点的 `node_finished`」**：`node_finished` 的语义是「这个节点**成功**产出了 `output`」。失败了就没有可信的 output 可报，若照样发一条，前端会误以为该节点成功（并按 `output.text` 去渲染半截文本）。因此引擎的做法是：**成功才发 `node_finished`，失败改发 `run_failed`**。两端实现（阶段 4 · 02 / 04）：

```ts
// engine.service.ts：executeNode 成功 → nodeFinished；失败 → 记录 failedNodeId 后抛出
context.queue.emit(nodeStarted(node.id, node.type))
try {
  const output = await this.executeNode(node, state.pool, context.queue)
  context.queue.emit(nodeFinished(node.id, node.type, output))   // ← 只有成功才发
  // …
} catch (error) {
  context.failedNodeId = node.id
  throw error
}
// 顶层：catch → queue.emit(runFailed(runId, context.failedNodeId, messageOf(error)))
```

```python
# engine.py：同样「成功 node_finished / 失败记 failed_node_id 后抛出」
await queue.put(node_started(node["id"], node["type"]))
try:
    output = await _execute_node(node, state["pool"], queue)
    await queue.put(node_finished(node["id"], node["type"], output))   # ← 只有成功才发
    # …
except Exception:
    context["failed_node_id"] = node["id"]
    raise
# 顶层：except → await queue.put(run_failed(run_id, context["failed_node_id"], str(error)))
```

`mapLlmError` / `map_llm_error` 产出的**规范文案**，正是经由 `RunError(…)` → `messageOf(error)` / `str(error)` → `run_failed.message` 一路传出去的。所以**映射函数就是 `run_failed.message` 的唯一来源**——这解释了为什么它值得单列一篇、值得逐字节测。

### 5.5 `maxRetries = 0` 的取舍（真实踩坑）

LangChain JS 的 `ChatOpenAI` 内部走 `AsyncCaller`，**默认会自动重试 6 次**。这不是无害的「更健壮」，而会在本场景造成两个具体麻烦：

1. **耗时行为失控**：遇到 5xx 或超时，重试 6 次（每次还可能叠加退避等待）会把一次本该「秒级返回错误」的调用拖到 **30 秒以上**。调试时你看到的是「界面卡死半分钟」，而不是「干净利落地报错」。
2. **两端不一致**：TS 侧的隐式重试与 Python 侧默认行为**对不齐**，同一故障两端的**耗时**与**最终分类**都可能不同——这会破坏「两端一致」里最容易被忽略的一维：**行为的时间形状**。

所以两端都**显式关掉重试**：

```ts
maxRetries: 0,      // TS：关掉 LangChain JS 的隐式重试
```
```python
max_retries=0,      # Py：与 api-ts 的 maxRetries: 0 对齐，保证错误快速、归一
```

**关键认知——「重试该放在哪一层」**：
- 重试是一种**策略**（重几次？间隔多久？哪些错误才重？是否对用户可见？），它依赖调用者的语义，**不该由底层库替你隐式决定**。
- 正确的位置是**执行引擎 / 上层业务策略**：由引擎决定「这个节点失败要不要重跑、要不要换模型、要不要降级」——那时重试对「事件流」有明确含义（可以发 `node_started` 又发一次，或发专门的重试事件）。
- 把重试关进库里（默认 6 次）等于**把策略藏进黑盒**，既不可观测，又不可两端对齐。本项目的取舍是：**先关掉，把策略留给上层**。

> 这也是「**显式优于隐式**」这条工程准则的一个具体落点。

### 5.6 映射实现细节：两端取状态码的属性名不同

映射规则两端**完全相同**，但「从异常对象里抠出 HTTP 状态码」这一步，**两个 SDK 的属性名不一样**——这正是「原始错误不可直接透出」的另一个佐证（连属性都不同）：

| | TypeScript（`@langchain/openai` → `openai` JS SDK） | Python（`langchain_openai` → `openai` Py SDK） |
| --- | --- | --- |
| 状态码属性 | `error.status`（`APIError.status`） | `error.status_code`（`APIStatusError`），兜底再试 `error.status` |
| 超时判定 | `name` ∈ `APIConnectionTimeoutError` / `TimeoutError` / `AbortError`，或 `message` 匹配 `/timed? ?out\|timeout/i` | `type(error).__name__` ∈ `APITimeoutError` / `TimeoutError` / `APIConnectionTimeoutError`，或 `str(error)` 含 `timed out` / `timeout` |
| 兜底 | 无状态码且非超时 → `unknown` | 同上 |

两端都写成**纯函数**（不依赖全局状态），便于单测与推理；判定顺序都锁定为**状态码 → 超时 → unknown**，保证同一异常在两端落入同一文案。

> `statusCodeOf` / `_status_code` 里那句 `if (typeof status === 'number')` / `if isinstance(value, int)` 很重要：它**只接受整数**，避免把 `str` 型状态码或空值误判。这类「先取属性再验证类型」的防御式写法，是处理**结构不完全受你控制的外部对象**时的通用手段。

### 5.7 对照表：TS 与 Python 的映射代码并排

| 环节 | TypeScript（`llm.node.ts`） | Python（`llm.py`） |
| --- | --- | --- |
| 未配置密钥 | `process.env.LLM_API_KEY ?? ''` 为空 → `throw new RunError('…LLM_API_KEY')` | `settings.llm_api_key` 为假 → `raise RunError('…LLM_API_KEY')` |
| 关重试 | `new ChatOpenAI({ …, maxRetries: 0 })` | `ChatOpenAI(…, max_retries=0)` |
| 调用失败出口 | `catch { throw new RunError(mapLlmError(error)) }` | `except Exception as error: raise RunError(map_llm_error(error)) from error` |
| 映射函数 | `mapLlmError(error: unknown): string` | `map_llm_error(error: Exception) -> str` |
| 取状态码 | `statusCodeOf`（读 `error.status`） | `_status_code`（读 `status_code`，兜底 `status`） |
| 判超时 | `isTimeout`（`name` 或 `message` 正则） | `_is_timeout`（`type().__name__` 或 `str(error)` 包含） |
| 文案产出 | 6 条字面量，与 §5 **逐字节相同** | 同左 |

### 5.8 【加厚 · 本篇首次出现的 Python 机制】异常的类层次与 `except` 的匹配顺序

**术语先立住**：**异常（exception）** = Python 里表示「出错」的**对象**；**异常类** = 描述某类错误的一个 class；**继承** = 「子类是一种父类」；**`except`** ≈ TS 的 `catch`；**`raise`** ≈ TS 的 `throw`。

**① 异常是「类」，有层次结构**

Python 的异常都是 `class`，天然构成一棵**继承树**（子类「是一种」父类）。本项目相关的一棵（简化）：

```
BaseException
└── Exception                      # 几乎所有「常规错误」的基类
    ├── RunError                   # 本项目自定义（apps/api-py/app/engine/events.py）
    ├── ValueError  /  TypeError / KeyError / ...   # 内置
    └── HTTPException              # FastAPI 的（阶段 1 用过）
```

**为什么这点重要**：`except Exception` 会**匹配它的所有子类**——`RunError`、`ValueError`、`HTTPException` 都在其下。所以「捕获谁」= 「捕获谁及其子孙」。

**② `except` 从上到下匹配——顺序不能反**

多个 `except` 时，Python **从上往下**找**第一个能匹配**的，匹配上就进那一支、**其余不再看**。于是「宽泛的写在前面」会把「具体的写在后面」**全部挡掉**：

```python
# ❌ 顺序写反：具体的 except 永远到不了
try:
    risky()
except Exception:            # 这行把「所有 Exception 子类」都先接住
    print("兜底")
except ValueError:           # ⚠ 永远走不到这里（已被上面吃掉）
    print("值错误")

# ✅ 正确：具体在前、宽泛在后
try:
    risky()
except ValueError as e:      # 先接住具体的
    print("值错误：", e)
except Exception as e:       # 再兜底
    print("其它：", e)
```

**TS 里对应什么**：TS 只有**一个** `catch (e)`，要区分类型得在 catch 里手写「`instanceof` / `if-else` 链」：

```ts
try { risky() }
catch (e) {
  if (e instanceof RangeError) { ... }   // ← 手写判断顺序
  else { ... }
}
```
Python 把「判断顺序」**搬到了 `except` 子句的结构**里——**写 `except` 的顺序就是判断顺序**。这正是 Python 里「except 顺序写反」成为经典坑的原因（TS 侧没这个坑，因为有顺序的 `if` 是你显式写的）。

**③ `raise ... from error`——保留「因由」链**

本项目的出口是 `raise RunError(map_llm_error(error)) from error`：

- `raise X`：抛出新异常 `X`。
- `from error`：把**原始异常** `error` 记为 `X` 的「直接原因（`__cause__`）」。排查时能看到「是哪个底层异常导致的」，但**对外的文案仍然是规范文案**（`RunError` 的 message）。
- **TS 里对应什么**：`new Error(msg, { cause: err })`——语义同。

**为什么本项目要这么做（讲透）**：既要「对外只出**规范文案**（两端一致、不泄露内幕）」，又要「对内保留**原始错误**便于排查」——`from error` 正好两全：message 是我们自己定的，原因链挂在暗处。

> 顺带：**别写裸 `except:`**（不带异常类型的 `except`）。它会连 `KeyboardInterrupt`（Ctrl-C）一起吞掉，导致程序杀不掉。本项目统一写 `except Exception`（只接常规错误）。

### 5.9 【加厚 · 与 TS 侧的对照】异常与「取状态码」的语言机制

映射规则两端**完全相同**，但**语言机制**不同。逐条对照：

| 机制 | TypeScript | Python（本项目） | 关键差异 |
| --- | --- | --- | --- |
| 捕获 | `try { } catch (e) { }`——**一个** catch | `try: ... except A: ... except B: ...`——**多个** except | ⭐ Python 按**书写顺序**从上到下匹配；TS 要自己写 `instanceof` 链 |
| 泛化捕获 | `catch (e)`（什么都接） | `except Exception as e:`（接所有常规错误） | 都别用「吞掉一切」的写法（Python 别写裸 `except:`） |
| 判类型 | `e instanceof APIError` | `isinstance(e, SomeError)` | 语义同（都是「是不是某类及其子类」） |
| 取 HTTP 状态码 | `e.status`（JS SDK 的 `APIError`） | `e.status_code`（Py SDK 的 `APIStatusError`），兜底再试 `e.status` | ⭐ **属性名不同**（这正是「原始错误不可直接透出」的佐证之一） |
| 判超时（类型） | `e.name === 'APIConnectionTimeoutError'` 等 | `type(e).__name__ in ('APITimeoutError', …)` | 都要「看类/名字」 |
| 判超时（消息兜底） | `/timed? ?out|timeout/i.test(e.message)` | `"timeout" in str(e).lower()` | 语义同 |
| 「只接受整数」 | `typeof status === 'number'` | `isinstance(value, int)` | ⚠ Python `bool` 是 `int` 子类：`isinstance(True, int)` 为 `True` |
| 因果链 | `new Error(msg, { cause: err })` | `raise RunError(msg) from err` | 语义同 |
| 出错「不发」某事件 | try/catch 里控制 | `except` 里 `raise` 后由上层决定 | 见 §5.4 |

**两个必须记住的点**：

1. **「取状态码」这步两端属性名不同**：TS 读 `error.status`，Python 读 `error.status_code`（再兜底 `status`）。这也是为什么本项目坚持「不透出库原始错误」——连**属性都不同**，原文若要透出，两端必然不一致。
2. **Python 的 `except` 顺序 = 判断顺序**：写映射/兜底逻辑时，**具体异常类在前、`Exception` 在后**（§5.8）。

### 5.10 【加厚】写错会怎样（异常相关，尤其 `except` 顺序）

| 错误 | 症状 | 原因 / 正解 |
| --- | --- | --- |
| **`except` 顺序写反**（宽泛在前、具体在后） | 具体异常**永远不被专门处理**，全落进兜底支 | `except` **从上到下**匹配第一个命中；**具体在前、`Exception` 在后**（§5.8）。 |
| **写裸 `except:`** | 连 `KeyboardInterrupt`（Ctrl-C）都被吞，进程杀不掉 / 错误被静默 | 只接你要的类型，或至少写 `except Exception`。 |
| **`except` 里忘 `raise`**（把异常吃掉） | 错误被静默；`run_failed` 发不出来、流照常「成功」收尾 | 若目的是「转成规范文案」，就 `raise RunError(map_llm_error(error)) from error`；别默默 `pass`。 |
| **直接透出 `str(原始异常)`** | `run_failed.message` 两端不一致，且泄露 Key / URL | 必须经 `map_llm_error` 归一（§5.2）。 |
| **`getattr` 忘给默认值** | 属性不存在的异常直接抛 `AttributeError` | `getattr(error, attr, None)`（第三参是默认值）（§5.6）。 |
| **状态码字段名两端混用** | TS 读 `status_code` 读不到（或反之） | TS 读 `status`；Python 读 `status_code` 兜底 `status`（§5.6）。 |

> **一句话**：`except` 的**顺序就是类型判断的顺序**——这是 Python 与 TS 在异常处理上最实打实的机制差异，也是映射函数必须「状态码 → 超时 → unknown」这一固定顺序在**代码层**（`if/return`）与**捕获层**（`except` 子句）都要遵守的原因。

---

## 6. 验收自测

**准备**：仓库根起 `node tools/mock-llm/server.mjs`；`apps/api-ts/.env` 用内置的 mock 配置（`LLM_BASE_URL=http://127.0.0.1:11435/v1`、`LLM_API_KEY=test`、`LLM_MODEL=mock-model`、`LLM_TIMEOUT_MS=3000`）；起 `pnpm dev:api-ts`（3001）；准备一个 `start → llm → end` 的合法草稿图；登录拿到 `<TOKEN>` 与 `<APP_ID>`。

用 `llm` 节点的 **prompt 文本**注入错误（每次改完存草稿再 run）：

```powershell
curl.exe -N -X POST http://localhost:3001/apps/<APP_ID>/run `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <TOKEN>" `
  -d "{\"inputs\":{}}"
```

**实测回放（照实记录，`-N`）**

```text
# prompt = "[[mock-status:401]]"
event: run_started
data: {"runId":"…","appId":"…"}

event: node_started
data: {"nodeId":"n-start","nodeType":"start"}

event: node_finished
data: {"nodeId":"n-start","nodeType":"start","output":{"inputs":{}}}

event: node_started
data: {"nodeId":"n-llm","nodeType":"llm"}

event: run_failed
data: {"runId":"…","nodeId":"n-llm","message":"llm request unauthorized"}

# ← 该节点的 node_finished 没有出现；也没有 run_finished；流到此结束
```

**6 个错误用例（两端 message 逐字节一致，实测）**

| # | 注入 | `run_failed.message`（TS 与 Py **完全相同**） |
| --- | --- | --- |
| 1 | `LLM_API_KEY` 置空 | `llm provider not configured: LLM_API_KEY` |
| 2 | prompt = `[[mock-status:401]]` | `llm request unauthorized` |
| 3 | prompt = `[[mock-status:429]]` | `llm rate limited` |
| 4 | prompt = `[[mock-status:500]]` | `llm request failed: 500` |
| 5 | prompt = `[[mock-delay:10000]]` + `LLM_TIMEOUT_MS=3000` | `llm request timed out` |
| 6 | `LLM_BASE_URL` 指向**未监听**端口（如 `http://127.0.0.1:19999/v1`） | `llm request failed: unknown` |

| 检查项 | 操作 | 预期（**实测**） |
| --- | --- | --- |
| 未授权 | 用例 2 | `401` 时 `llm request unauthorized`（**不透出** `Incorrect API key provided` 那句原文） |
| 限流 | 用例 3 | `llm rate limited`（**不透出** `Rate limit reached`） |
| 其它 HTTP | 用例 4 | `llm request failed: 500`（状态码是模板变量，随 provider 返回值变化） |
| 超时 | 用例 5 | `llm request timed out`（在 `LLM_TIMEOUT_MS` 之后**快速**返回，不因库默认重试而挂 30 s+） |
| 无法归类 | 用例 6 | `llm request failed: unknown`（端口不可达被归入 unknown） |
| 通道正确 | 任一用例 | HTTP 仍为 **200**，`content-type: text/event-stream`；错误在流里的 `run_failed` 帧 |
| 不发 node_finished | 任一用例 | 只有 `node_started(n-llm)` + `run_failed`，**无** `node_finished(n-llm)` |
| 无 run_finished | 任一用例 | 无 `run_finished`；流以 `run_failed` 收束 |
| 跨后端一致 | 把 base 换成 8000 重跑全部 6 例 | 两端 `run_failed.message` **逐字节相同** |

---

## 7. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **直接透出库原始 message** | 两端 `run_failed.message` 不一样；顺带泄露 Key / URL | 必须走 `mapLlmError` / `map_llm_error` 映射成规范文案（第 5.2 节）。这是硬约束 |
| 2 | **没关重试** | 遇到 5xx / 超时要**挂 30 秒以上**才报错 | LangChain JS `AsyncCaller` 默认重试 6 次；两端显式 `maxRetries: 0` / `max_retries=0`（第 5.5 节） |
| 3 | **先发了 `node_finished` 再报错** | 前端先渲染半截文本，又看到错误 | 成功才发 `node_finished`；失败改 `run_failed`（第 5.4 节） |
| 4 | **以为该发 `run_finished`** | 前端一直等不到收束 | 出错时**不发** `run_finished`，`run_failed` 即终止（`sse-events.md` §3） |
| 5 | **错误想改成 HTTP 状态码** | 想返回 429/401，但客户端拿到的是 200 流 | 连接早开始、状态码已发出，**改不了**；只能走 `run_failed`（阶段 4 · 05） |
| 6 | **超时判据只认 `name`** | 某些超时被错归为 `unknown` | 双判据：异常**名** + **消息**包含 `timeout`（两端都做，第 5.6 节） |
| 7 | **状态码属性名两端混用** | TS 侧读 `status_code` 读不到（或反之） | TS 读 `status`；Py 先读 `status_code` 兜底 `status`（第 5.6 节） |
| 8 | **`LLM_API_KEY` 被设成空串** | 以为是「鉴权失败」，实际是「未配置」 | 空串在**调用前**短路，文案是 `llm provider not configured: LLM_API_KEY`；要测 401 必须让 mock 返回 401（用例 2） |
| 9 | **用 LangChain 想加自定义头注入错误** | 加不上 / 不生效 | LangChain 不允许塞自定义头；错误用例改用**渲染进 prompt 的标记** `[[mock-status:NNN]]`（4.4 / 04 篇） |
| 10 | **`3000`/`3001` 端口绑不上** | `EADDRINUSE` 或 `An attempt was made to access a socket in a way forbidden by its access permissions` | Windows 可能把一段端口**动态保留**给 Hyper-V/Docker（本机曾见保留段 `2957–3056`）。临时自救：换端口；根治（需管理员）：`net stop winnat` + `net start winnat`，或重启机器。详见 `04-mock-LLM与无密钥自测.md` 第 7 节 |

---

## 8. 本篇复盘与知识点

**一句话总结本篇**：真实 LLM 节点把「确定性代码」变成了「**一次可能失败的外部调用**」。所以我们必须把库的各路原始异常**映射**成一组**两端逐字节一致**的规范文案（`error-messages.md` §5 的 6 条），并且因为这些错误**发生在流已经开始之后**，它们只能经 **`run_failed` 事件**传出、且出错节点**不发 `node_finished`**；为了让错误「**快速且两端行为一致**」，还必须显式关掉库的隐式重试（`maxRetries = 0`）。

**本篇学到的工程要点**

1. **外部依赖不可靠**：超时 / 限流 / 鉴权 / 5xx / 连不上 / 漏配密钥——本地练习里一个都遇不到，真实系统里全都会遇到。
2. **必须映射**：理由有三——两端库文案不同会破坏契约一致、原始错误泄露内幕、文案是客户端要依赖的接口。
3. **6 条规范文案**：未配置 / 未授权(401·403) / 限流(429) / 超时 / 其它 HTTP(`failed: {code}`) / 未知。
4. **通道是 `run_failed`**：错误在流中发生，状态码改不了；出错时**不发**该节点 `node_finished`、**不发** `run_finished`。
5. **`maxRetries = 0`**：库的隐式重试会把 5xx/超时拖到 30 s+ 并破坏两端行为一致；重试是**上层策略**，应由引擎决定而非库隐藏。
6. **映射即纯函数**：判定顺序锁定「状态码 → 超时 → unknown」，两端取状态码的**属性名不同**（`status` vs `status_code`），需各自适配。

**遗留 / 后续**

- 「重试 / 降级 / 换模型」的策略层尚未实现——留待后续阶段由执行引擎统一承载（本阶段只先把库的隐式重试关掉）。
- 面向用户的**错误可观测性**（LangSmith trace / 结构化日志）不在本阶段。

---

## 9. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| 外部依赖的不可靠性（真实系统与本地练习的分水岭） | **首次教学于本篇** |
| 把库原始异常**映射**成自有规范文案的三条理由（两端差异 / 泄露内幕 / 文案是接口） | **首次教学于本篇** |
| LLM 错误的 6 条规范文案与判定顺序（状态码 → 超时 → unknown） | **首次教学于本篇** |
| 错误发生在流中 → 只能走 `run_failed`，且出错节点不发 `node_finished` | **首次教学于本篇** |
| `maxRetries = 0` 的取舍：库的隐式重试会破坏耗时行为与两端一致；重试应属上层策略 | **首次教学于本篇** |
| 两端取 HTTP 状态码的属性名差异（TS `status` vs Py `status_code`）与超时双判据 | **首次教学于本篇** |
| **Python 异常类层次与 `except` 的匹配顺序** | 异常是 class 树（`RunError`/`ValueError`/`HTTPException` 都在 `Exception` 下）；`except` **从上到下**匹配第一个命中，具体在前、`Exception` 在后；`raise X from err` 保留因由链（§5.8） | **首次教学于本篇（加厚）** |
| **与 TS 侧的异常语言机制对照** | 一个 `catch` + `instanceof` 链 ↔ 多个 `except` 按写法顺序匹配；`e.status` ↔ `e.status_code`（兜底 `status`）；`getattr(x,name,None)` 兜底；`isinstance(x,int)`（`bool` 是 `int` 子类）（§5.9） | **首次教学于本篇（加厚）** |
| **写错会怎样（异常）** | `except` 顺序写反致具体异常永不被处理、裸 `except:` 吞掉 Ctrl-C、`except` 里忘 `raise` 静默错误、`getattr` 忘默认值抛 `AttributeError`（§5.10） | **首次教学于本篇（加厚）** |
