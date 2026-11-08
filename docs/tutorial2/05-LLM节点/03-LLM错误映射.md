# 03 · LLM 错误映射（LLM 节点）

> 阶段 5 · 第 3 步
>
> 做完：provider 的六类失败被归一为**六条固定文案**，经由 `run_failed.message` 输出；两套后端对同一故障给出完全相同的字符串；失败节点**不发** `node_finished`；前端能根据文案区分“改配置”“等一会”“重试”。
>
> **本篇面试考点**：为什么不透传原始错误 · 状态码判定为什么排在超时之前 · 401 与 403 为什么合并 · 429 该不该在节点内重试 · 异常类名在不同 SDK 里不一致 · 连接失败为什么归 `unknown` · 规范文案与日志原文的分工 · 前端如何按文案决定动作。

---

## 1. 为什么不能透传原始 message

假设直接 `throw new Error(error.message)`，两端会得到：

```text
api-ts: 401 Incorrect API key provided: sk-abc***xyz. You can find your API key at https://platform.openai.com/account/api-keys.
api-py: Error code: 401 - {'error': {'message': 'Incorrect API key provided: sk-abc***xyz...', 'type': 'invalid_request_error'}}
```

问题：

1. **两端不可能逐字节一致**——SDK 包装格式不同；
2. **可能泄露内部信息**——密钥前缀、代理地址、组织 id、请求 id；
3. **前端无法做判断**——要写正则去猜“这是密钥错了还是限流”；
4. **文案不可控**——provider 改一句话，前端逻辑就崩。

所以：**事件里只放规范文案，原始错误只进服务端日志。**

> **面试考点 · 规范文案丢了排查信息，怎么办？**
> 两层分开：
>
> - **对客户端**：`run_failed.message` 只给规范文案（稳定、可判断、可国际化）；
> - **对运维**：服务端日志打印完整异常（含 stack、provider 响应体、`runId`）。
>
> 通过 `runId` 把两者关联：用户报“运行失败”，拿 `runId` 去日志里查原始错误。
> **对外稳定、对内详细**，这是所有 API 错误设计的基本原则。

---

## 2. 六条规范文案

**完整文件路径：`packages/contract/error-messages.md`** §5

| 场景 | 触发条件 | `message` |
| --- | --- | --- |
| 未配置密钥 | `LLM_API_KEY` 为空 | `llm provider not configured: LLM_API_KEY` |
| 未授权 | provider 返回 401 / 403 | `llm request unauthorized` |
| 限流 | provider 返回 429 | `llm rate limited` |
| 超时 | 请求超时 | `llm request timed out` |
| 其它 HTTP 错误 | provider 返回其它非 2xx | `llm request failed: {statusCode}` |
| 无法归类 | 连接失败 / 解析失败 / 其它 | `llm request failed: unknown` |

约束：

- 该节点出错时**不发** `node_finished`（事件序列里 `node_started` 之后直接 `run_failed`）；
- `run_failed.nodeId` 是该 `llm` 节点 id；
- 文案里的 `{statusCode}` 是数字，例如 `llm request failed: 500`。

判定顺序（两端一致）：

```text
1. LLM_API_KEY 为空                → not configured（在发起请求前判断）
2. 异常带 HTTP 状态码
   2.1 401 / 403                  → unauthorized
   2.2 429                        → rate limited
   2.3 其它                       → request failed: {status}
3. 无状态码，且判定为超时          → timed out
4. 其余                            → unknown
```

> **面试考点 · 为什么状态码判定要排在超时之前？**
> 状态码是**确定信号**（provider 明确告诉你发生了什么），超时是**启发式判断**（看异常类名、看 message 里有没有 timeout）。
> 如果先判超时，一个 `504 Gateway Timeout` 的响应会被归成 `timed out`，丢失了“这是网关返回的”这一事实；而 `llm request failed: 504` 保留了状态码，排查时能区分“我的客户端等太久”与“网关自己超时”。
> **先信确定信号，再用模糊信号兜底。**

> **面试考点 · 401 和 403 为什么合并成一条？**
> 语义上不同（未认证 vs 无权限），但对本系统来说**用户动作相同**：去检查/更换 `LLM_API_KEY`。
> 不同 provider 的划分还不一致：有的对无效 key 返回 401，有的返回 403，有的对“额度耗尽”也返回 403。
> 合并的收益：前端只需处理一种情况；代价：排查时少一点区分度——用日志里的原始状态码补回来。
> **错误分类应面向“调用方要做什么”，而不是“服务端发生了什么”。**

> **面试考点 · 429 为什么不在节点内自动重试？**
> 因为节点是**同步执行链的一环**：
>
> - 重试会拉长 `run` 的总时长，前端只能看着转圈；
> - 重试期间无法告知用户“正在等待配额”；
> - 两端的重试策略（次数、退避、抖动）很难完全一致。
>
> 正确位置：上层队列/任务系统按 `llm rate limited` 决定何时重跑整个 run，并可以把“预计等待时间”告诉用户。
> **节点只负责“这一次调用成功或失败”，重试是编排层的职责。**

---

## 3. TypeScript 实现

**完整文件路径：`apps/api-ts/src/engine/nodes/llm.node.ts`**（错误映射部分）

```ts
/** 异常 → 规范文案（顺序与 error-messages.md §5 一致）。 */
export function mapLlmError(error: unknown): string {
  // 1. 有 HTTP 状态码：优先按状态码归类（确定信号）
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
  // 2. 无状态码：再判断是否超时（启发式）
  if (isTimeout(error)) {
    return 'llm request timed out'
  }
  // 3. 兜底
  return 'llm request failed: unknown'
}

/** 取异常的 HTTP 状态码（OpenAI TS SDK 的 APIError 带 `status`）。 */
function statusCodeOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') {
      return status
    }
  }
  return null
}

/**
 * 判定是否为超时。
 *
 * OpenAI TS SDK 的超时异常 name 是 `APIConnectionTimeoutError`；
 * fetch 层被中止时是 `AbortError`；Node 原生超时是 `TimeoutError`。
 * 最后再用 message 兜底（部分兼容 provider 的包装层会丢掉 name）。
 */
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

调用点（`runLlmStep` 内）：

```ts
  try {
    for await (const chunk of await client.stream(messages)) {
      // ...累积 text、发 token、记录 usage
    }
  } catch (error) {
    // 只抛规范文案；原始 error 不进入事件
    throw new RunError(mapLlmError(error))
  }
```

> **面试考点 · 为什么用 `name` 而不是 `instanceof` 判断异常类型？**
> `instanceof` 依赖**同一个类对象**。以下情况会失效：
>
> - 项目里有多个版本的 `openai` 包（monorepo 的典型问题）；
> - 异常跨了 `vm` / `worker` 边界；
> - 兼容层（one-api、vLLM）自己包装后重新抛出。
>
> 读 `name` 是鸭子类型：只要异常**声称**自己叫什么。代价是可能误判同名异常——对“归到哪条文案”这种场景，误判的代价很低。
> 判断前先用 `typeof error === 'object' && error !== null`，避免 `error.name` 在 `null`/字符串上抛错。

---

## 4. Python 实现

**完整文件路径：`apps/api-py/app/engine/nodes/llm.py`**（错误映射部分）

```python
def map_llm_error(error: Exception) -> str:
    """把 LangChain / 底层异常映射为规范文案（规则与 api-ts 的 `mapLlmError` 一致）。"""
    # 1. 有 HTTP 状态码：优先按状态码归类
    status = _status_code(error)
    if status is not None:
        if status in (401, 403):
            return "llm request unauthorized"
        if status == 429:
            return "llm rate limited"
        return f"llm request failed: {status}"
    # 2. 无状态码：再判断是否超时
    if _is_timeout(error):
        return "llm request timed out"
    # 3. 兜底
    return "llm request failed: unknown"


def _status_code(error: Exception) -> int | None:
    """取 HTTP 状态码。

    注意：**Python 的 openai SDK 用 `status_code`，TS 的用 `status`**。
    这里两个都查，兼容不同版本的包装层。
    """
    for attr in ("status_code", "status"):
        value = getattr(error, attr, None)
        if isinstance(value, int):
            return value
    return None


def _is_timeout(error: Exception) -> bool:
    """判定是否为超时。

    openai Python SDK 的超时异常是 `APITimeoutError`；
    asyncio 层面的超时是 `TimeoutError`；
    httpx 被中止时是 `ReadTimeout` / `ConnectTimeout`（类名含 Timeout）。
    """
    name = type(error).__name__
    if name in ("APITimeoutError", "APIConnectionTimeoutError", "TimeoutError", "AbortError"):
        return True
    if "Timeout" in name:
        return True
    message = str(error).lower()
    return "timed out" in message or "timeout" in message
```

> **面试考点 · 为什么 Python 要查两个属性，TS 只查一个？**
> 这是真实 SDK 差异：
>
> - OpenAI **TS** SDK：`APIError.status`（数字）；
> - OpenAI **Python** SDK：`APIStatusError.status_code`；
> - 某些兼容层（或 LangChain 包装后的异常）会把状态放在另一个属性里。
>
> 上一句只查 `status` 的写法，在 Python 里会把所有 4xx/5xx 都归成 `unknown`——**而且测试很容易漏掉**（因为超时、401 恰好也能靠 message 兜底）。
> **跨语言移植错误映射时，先打印一次 `dir(error)` 和 `vars(error)`，确认字段名，再写判断。**

> **面试考点 · `type(error).__name__` 和 `error.__class__.__name__` 有区别吗？**
> 基本等价。`type(x).__name__` 不触发自定义 `__getattribute__`，更直接。
> 更稳的写法是 `isinstance(error, openai.APITimeoutError)`，但那要求你 import provider 的具体异常类——引擎会耦合到某个 SDK 版本。用类名字符串是**有意的解耦**：换 SDK 只改名单，不改 import。

---

## 5. 逐个触发（用 mock provider）

阶段 5 的 mock 服务支持两种注入方式，二者等价：

- HTTP 头：`x-mock-status: 401` / `x-mock-delay: 5000`
- 消息内容：`[[mock-status:401]]` / `[[mock-delay:5000]]`（LangChain 不方便加自定义头，用它）

```powershell
# 启动 mock（阶段 5 的 05 篇有完整说明）
node tools/mock-llm/server.mjs
```

`.env` 指向 mock：

```dotenv
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=mock-key
LLM_MODEL=mock-model
LLM_TIMEOUT_MS=60000
```

把 `start` 的输入 `topic` 设为下表的值，运行后观察 `run_failed.message`：

| # | `topic` 的值 / 配置 | 期望 `message` |
| --- | --- | --- |
| 1 | `LLM_API_KEY=`（空） | `llm provider not configured: LLM_API_KEY` |
| 2 | `[[mock-status:401]]` | `llm request unauthorized` |
| 3 | `[[mock-status:403]]` | `llm request unauthorized` |
| 4 | `[[mock-status:429]]` | `llm rate limited` |
| 5 | `[[mock-status:500]]` | `llm request failed: 500` |
| 6 | `[[mock-status:503]]` | `llm request failed: 503` |
| 7 | `[[mock-delay:5000]]` + `LLM_TIMEOUT_MS=200` | `llm request timed out` |
| 8 | `LLM_BASE_URL=http://127.0.0.1:1/v1`（拒绝连接） | `llm request failed: unknown` |

```powershell
# 7 号场景：把超时调到 200ms 再重启后端
# 运行后应约 0.2s 就返回 run_failed（而不是等 5s）
```

观察要点：

```text
event: node_started
data: {"nodeId":"llm1","nodeType":"llm"}

event: run_failed          ← 直接终态，没有 node_finished
data: {"runId":"...","nodeId":"llm1","message":"llm request unauthorized"}
```

### 5.1 两端逐字节比对

```powershell
$body = '{"inputs":{"topic":"[[mock-status:401]]"}}'

curl.exe -s -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d $body |
  Select-String 'run_failed' -Context 0,1 > ts-err.txt

curl.exe -s -N -X POST "http://localhost:8000/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d $body |
  Select-String 'run_failed' -Context 0,1 > py-err.txt
```

两边的 `message` 必须完全相同：

```text
ts: "message":"llm request unauthorized"
py: "message":"llm request unauthorized"
```

> 比对时只比较 `message`（`runId` 是随机的），不要整行 diff。

---

## 6. 前端如何使用这六条文案

| `message` | 前端建议动作 |
| --- | --- |
| `llm provider not configured: LLM_API_KEY` | “服务未配置模型”，提示联系管理员；不显示“重试” |
| `llm request unauthorized` | “模型凭证无效”，提示检查配置；不显示重试 |
| `llm rate limited` | “请求过于频繁”，显示“稍后重试” |
| `llm request timed out` | 显示“超时，可重试” |
| `llm request failed: 5xx` | 显示“服务异常，可重试” |
| `llm request failed: unknown` | 显示“运行失败”，附带 `runId` 供排查 |

注意：**不要在前端用 `message.includes('timeout')` 去猜**——规范文案是精确匹配的：

```ts
if (message === 'llm rate limited') {
  // 显示“稍后重试”
}
```

> **面试考点 · 为什么不让后端返回错误码，而是返回文案？**
> 更完整的设计确实是**同时**返回：
>
> ```json
> { "code": "llm_rate_limited", "message": "llm rate limited" }
> ```
>
> 前端按 `code` 分支，`message` 只用于展示。本项目为了保持事件 payload 最小、且文案本身就是稳定的机器可读字符串，省掉了 `code`。
> 这是一个**有意识的取舍**，不是最佳实践：一旦需要国际化（同一错误多语言展示），就必须加 `code`，让 `message` 只做展示。
> **能被程序判断的字段，不要只有人类语言。**

---

## 7. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 为什么归一化 | 两端一致、不泄露内部信息、前端可判断、provider 改文案不影响 |
| 判定顺序 | 状态码（确定）→ 超时（启发式）→ unknown |
| 401/403 合并 | 调用方动作相同；provider 划分不一致；细节留给日志 |
| 429 不在节点重试 | 拉长同步链路、无法告知用户、两端策略难一致；交给编排层 |
| `instanceof` vs `name` | 多版本包/跨边界会失效；鸭子类型更稳 |
| Python `status_code` | OpenAI Python SDK 用 `status_code`，TS 用 `status`；移植时必须核对 |
| 超时类名 | TS `APIConnectionTimeoutError`、Python `APITimeoutError`；再匹配 message 兜底 |
| 连接失败 | 无状态码、非超时 → `unknown`；日志里保留 `ECONNREFUSED` |
| 规范文案 vs 日志 | 对外稳定、对内详细，用 `runId` 关联 |
| 文案 vs 错误码 | 需要 i18n 时必须加 `code`；文案只做展示 |

---

## 8. 下一步

- `04-节点参数面板.md`：前端把 `model` / `temperature` / `maxTokens` / `system` 写进节点 `data`，保存后运行验证。
- `05-mock-LLM与验收.md`：mock 服务的完整实现（分片、usage、状态/延迟注入）与阶段 5 验收清单。
