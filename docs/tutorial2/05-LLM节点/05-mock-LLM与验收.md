# 05 · mock-LLM 与验收（LLM 节点）

> 阶段 5 · 第 5 步
>
> 做完：一个零依赖、OpenAI 兼容的 mock 服务可独立启动；不配置真实密钥就能跑通完整链路；固定分片让两套后端的 `token` 序列**逐字节可比**；能按需注入 401/429/500/延迟，逐条验证错误映射。
>
> 最终仓库里的 `tools/mock-llm/server.mjs` 还额外支持工具调用（阶段 6）与嵌入向量（阶段 7）；本篇只实现阶段 5 需要的部分。
>
> **本篇面试考点**：为什么 mock 要兼容真实协议而不是自定义接口 · 固定分片为什么按 Unicode 码点 · JS `length` 与码点的差异 · `choices: []` 的 usage 帧 · `[DONE]` 的作用 · 错误注入为什么放在延迟之后 · mock 在 CI 中的定位 · mock 与真实 provider 的差异风险。

---

## 1. 为什么需要 mock

三个现实问题：

1. **CI 没有密钥**：PR 流水线里不该有 `sk-...`；
2. **真实模型不可复现**：同样的 prompt，每次返回都不同，无法做逐字节契约对比；
3. **错误场景难触发**：想测 429 就得把额度打满，想测超时就得等 60 秒。

mock 的定位不是“假装模型很聪明”，而是：

```text
一个遵守 OpenAI 协议、输出完全确定的假 provider，
用来验证「协议层」正确 —— 而不是验证「模型效果」。
```

所以它必须**兼容真实协议**（`/v1/chat/completions`、SSE 分块、`usage` 字段），否则测出来的东西和线上不是一条链路。

> **面试考点 · 为什么不自造一个 `POST /mock/echo` 接口？**
> 自造接口只能验证“代码能跑”，验证不了“代码能对接 OpenAI 协议”。
> 真实的失败模式几乎都在协议细节里：
>
> - 流式首帧要带 `delta.role`；
> - usage 单独一帧且 `choices` 为空；
> - 结尾要 `data: [DONE]`；
> - 错误体是 `{"error":{"message":...}}` 而不是纯文本。
>
> 用兼容协议 mock，等于把“协议适配层”也纳入了测试范围。**替身要替在边界上，不是替在实现里。**

---

## 2. 阶段 5 版 mock 服务

**完整文件路径：`tools/mock-llm/server.mjs`**（阶段 5 版本；阶段 6/7 会追加工具调用与 embeddings）

```js
#!/usr/bin/env node
/**
 * 零依赖、OpenAI 兼容的最小 mock 服务（阶段 5）。
 *
 * 行为：
 * - `POST /v1/chat/completions`，支持 `stream: true`（SSE）与 `stream: false`（普通 JSON）；
 * - 回显**最后一条 user 消息**，加固定前缀 `echo: `；
 * - 分片固定为**每 5 个 Unicode 码点**一片，使两端 token 序列可逐字节比对；
 * - 返回 `usage`；
 * - 错误 / 延迟注入（两种方式等价）：
 *     · HTTP 头：`x-mock-status: 401`、`x-mock-delay: 5000`
 *     · 消息内容：`[[mock-status:401]]`、`[[mock-delay:5000]]`
 *
 * 运行：`node tools/mock-llm/server.mjs`
 */
import http from 'node:http'

/** 监听端口（可用 MOCK_LLM_PORT 覆盖）。 */
const PORT = Number(process.env.MOCK_LLM_PORT || 11435)
/** 每片包含的 Unicode 码点数。 */
const CHUNK_SIZE = 5
/** 回显前缀。 */
const PREFIX = 'echo: '

const server = http.createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0]

  // 只实现一个接口；路径不匹配统一 404（与 OpenAI 的错误体形状一致）
  if (req.method !== 'POST' || path !== '/v1/chat/completions') {
    return sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } })
  }

  // 读完请求体（真实服务也需要，只是解析更严格）
  let raw = ''
  for await (const chunk of req) raw += chunk
  let payload = {}
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    payload = {}
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const userContent = lastUserContent(messages)
  const echo = PREFIX + userContent

  // usage 口径：prompt = 所有消息内容长度之和；completion = 回显文本的码点数
  const usage = {
    prompt_tokens: messages.reduce((n, m) => n + String(m.content ?? '').length, 0),
    completion_tokens: [...echo].length,
    total_tokens: 0,
  }
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens

  // 先取注入值，再决定「延迟 → 错误 → 正常」
  const status = injectedStatus(req, userContent)
  const delayMs = injectedDelay(req, userContent)
  if (delayMs > 0) {
    await sleep(delayMs)
  }
  if (status >= 400) {
    return sendJson(res, status, errorBody(status))
  }

  const model = payload.model || 'mock-model'
  if (payload.stream === true) {
    streamResponse(res, echo, usage, model)
  } else {
    sendJson(res, 200, completion(model, echo, usage))
  }
})

/** 取最后一条 user 消息的文本。 */
function lastUserContent(messages) {
  let content = ''
  for (const message of messages) {
    if (message && message.role === 'user') {
      content = typeof message.content === 'string' ? message.content : String(message.content ?? '')
    }
  }
  return content
}

/** 读 `x-mock-status` 头或内容里的 `[[mock-status:N]]`。 */
function injectedStatus(req, userContent) {
  const header = String(req.headers['x-mock-status'] || '')
  if (/^\d+$/.test(header)) return Number(header)
  const found = userContent.match(/\[\[mock-status:(\d+)\]\]/)
  return found ? Number(found[1]) : 0
}

/** 读 `x-mock-delay` 头或内容里的 `[[mock-delay:N]]`（毫秒）。 */
function injectedDelay(req, userContent) {
  const header = String(req.headers['x-mock-delay'] || '')
  if (/^\d+$/.test(header)) return Number(header)
  const found = userContent.match(/\[\[mock-delay:(\d+)\]\]/)
  return found ? Number(found[1]) : 0
}

/** 错误体形状与 OpenAI 一致：外层 error 对象。 */
function errorBody(status) {
  if (status === 401) {
    return { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }
  }
  if (status === 429) {
    return { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } }
  }
  if (status === 500) {
    return { error: { message: 'Internal server error', type: 'server_error' } }
  }
  return { error: { message: `mock status ${status}`, type: 'invalid_request_error' } }
}

/** 非流式响应体。 */
function completion(model, text, usage) {
  return {
    id: 'mock-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage,
  }
}

/**
 * SSE 流式回复，严格按 OpenAI 的形状：
 * 1. 首帧：delta.role = assistant、content = ''、finish_reason = null
 * 2. 若干帧：delta.content = 片段
 * 3. 结束帧：delta = {}、finish_reason = stop
 * 4. usage 帧：choices = []（**没有 choice**，只有 usage）
 * 5. data: [DONE]
 */
function streamResponse(res, text, usage, model) {
  writeSseHead(res)
  const base = chunkBase(model)
  res.write(sse({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }))
  for (const piece of chunkText(text, CHUNK_SIZE)) {
    res.write(sse({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }))
  }
  res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))
  res.write(sse({ ...base, choices: [], usage }))
  res.write('data: [DONE]\n\n')
  res.end()
}

/** 每个 chunk 的公共字段。 */
function chunkBase(model) {
  return {
    id: 'mock-' + Date.now(),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
  }
}

/** 写 SSE 响应头（LangChain 靠 `text/event-stream` 判定为流）。 */
function writeSseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
}

/** 按 Unicode 码点固定切分。 */
function chunkText(text, size) {
  const codePoints = [...text]
  const chunks = []
  for (let i = 0; i < codePoints.length; i += size) {
    chunks.push(codePoints.slice(i, i + size).join(''))
  }
  return chunks
}

/** 单个 SSE 帧。 */
function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`
}

/** 发 JSON 响应。 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

/** 延迟工具。 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`mock-llm listening on http://127.0.0.1:${PORT}/v1/chat/completions\n`)
})
```

> **面试考点 · `chunkText` 为什么用 `[...text]` 而不是 `text.slice`？**
> JS 字符串的 `length` 与 `slice` 按 **UTF-16 码元**操作：
>
> ```js
> '你好'.length          // 2（BMP 内，恰好等于码点数）
> '😀'.length            // 2（代理对，一个字符占两个码元）
> '😀'.slice(0, 1)       // "\ud83d" —— 半个字符，乱码
> [...'😀'].length       // 1（按码点）
> ```
>
> 用 `[...text]` 展开成码点数组再切，emoji 不会被劈开。
> 严格说码点也不等于“用户感知字符”（grapheme cluster，如 `👨👩👧` 由多个码点 + ZWJ 组成），但对我们“固定分片、两端一致”的目标，码点已经足够——**关键是两端用同一口径**。

> **面试考点 · usage 帧为什么 `choices: []`？**
> OpenAI 的流式协议里，token 用量要到生成结束才知道。它把 usage 放在**最后一个 chunk**，并且该 chunk **不带任何 choice**（`choices: []`），避免客户端把它当成一次内容增量。
> 如果 mock 把 usage 塞进最后一个内容帧（`choices[0].delta.usage`），LangChain 的解析路径可能读不到——**协议细节错一个字段，客户端就静默拿不到 usage**。
> 这也是为什么 mock 必须照抄真实协议：它不是“随便返回点什么”。

> **面试考点 · `data: [DONE]` 是必须的吗？**
> 对 OpenAI SDK 是。它标志着流正常结束（区别于“连接被断开”）。SDK 收到 `[DONE]` 后才会结束迭代并返回最终结果。
> 少这一行，部分 SDK 会一直等下一个事件，直到超时——表现是“模型答完了但前端一直转圈”。
> **流的“结束”需要显式信号，不能只靠 TCP 关闭。**

> **面试考点 · 错误注入为什么放在 `sleep` 之后？**
> ```js
> if (delayMs > 0) await sleep(delayMs)
> if (status >= 400) return sendJson(res, status, errorBody(status))
> ```
> 顺序决定了能测什么：
>
> - **先延迟再报错**：可以模拟“provider 迟迟不响应，最后超时/报错”。把客户端超时设为 200ms、延迟 5000ms，就能稳定触发 `llm request timed out`；
> - 反过来先报错，延迟永远不会发生，就测不了超时。
>
> 一个注入点，两种故障组合——这是 mock 设计里很实用的小技巧。

> **面试考点 · mock 与真实 provider 的差异，会不会让测试“假过”？**
> 会，所以要明确 mock 能验证与不能验证的边界：
>
> | 能验证 | 不能验证 |
> | --- | --- |
> | 协议解析（SSE 帧、usage、错误体） | 模型输出质量 |
> | 流式链路（逐 token、结束信号） | provider 特有的字段/怪癖 |
> | 错误映射（401/429/500/超时） | 真实限流策略、并发行为 |
> | 两端行为一致性 | 真实延迟分布 |
>
> 因此 CI 用 mock，**发布前必须至少跑一次真实 provider 的冒烟测试**。
> mock 保证“代码没退化”，真实调用保证“协议没变”。

---

## 3. 启动与直连验证

```powershell
node tools/mock-llm/server.mjs
```

预期 stderr：

```text
mock-llm listening on http://127.0.0.1:11435/v1/chat/completions
```

### 3.1 非流式

```powershell
curl.exe -s -X POST "http://127.0.0.1:11435/v1/chat/completions" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"mock-model\",\"messages\":[{\"role\":\"user\",\"content\":\"你好世界\"}]}"
```

预期（格式化后）：

```json
{
  "object": "chat.completion",
  "model": "mock-model",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "echo: 你好世界" }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 4, "completion_tokens": 10, "total_tokens": 14 }
}
```

`completion_tokens: 10` = `"echo: 你好世界"` 的码点数（`echo:` 5 + 空格 1 + 4 个汉字）。

### 3.2 流式

```powershell
curl.exe -s -N -X POST "http://127.0.0.1:11435/v1/chat/completions" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"mock-model\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"你好世界\"}]}"
```

预期帧序：

```text
data: {"...","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"...","choices":[{"index":0,"delta":{"content":"echo: "},"finish_reason":null}]}

data: {"...","choices":[{"index":0,"delta":{"content":"你好世界"},"finish_reason":null}]}

data: {"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: {"...","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":10,"total_tokens":14}}

data: [DONE]
```

### 3.3 错误注入

```powershell
# HTTP 头方式
curl.exe -s -i -X POST "http://127.0.0.1:11435/v1/chat/completions" `
  -H "Content-Type: application/json" -H "x-mock-status: 429" `
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"

# 内容方式（LangChain 不能加自定义头时用这个）
curl.exe -s -X POST "http://127.0.0.1:11435/v1/chat/completions" `
  -H "Content-Type: application/json" `
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"[[mock-status:401]]\"}]}"
```

预期 `HTTP/1.1 429` / `HTTP/1.1 401`，响应体：

```json
{"error":{"message":"Rate limit reached","type":"requests","code":"rate_limit_exceeded"}}
```

---

## 4. 接入两套后端

`.env`（两端同值）：

```dotenv
LLM_BASE_URL=http://127.0.0.1:11435/v1
LLM_API_KEY=mock-key
LLM_MODEL=mock-model
LLM_TIMEOUT_MS=60000
```

> `LLM_API_KEY` 不能留空——留空会在创建客户端前直接失败（阶段 5 的 `02` 篇）。mock 不校验 key，填任意非空值即可。

### 4.1 正常链路：两端逐字节一致

这是阶段 5 最强的一条验收：mock 的分片是**确定**的，所以两套后端的 `token` 帧序列应当完全相同。

```powershell
$body = '{"inputs":{"topic":"你好世界"}}'

curl.exe -s -N -X POST "http://localhost:3001/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d $body > ts.txt

curl.exe -s -N -X POST "http://localhost:8000/apps/<APP_ID>/run" `
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d $body > py.txt
```

比较 `token` 行：

```powershell
Compare-Object `
  (Select-String -Path ts.txt -Pattern '"text"' | ForEach-Object { $_.Line.Trim() }) `
  (Select-String -Path py.txt -Pattern '"text"' | ForEach-Object { $_.Line.Trim() })
```

预期无输出。

> 注意：`run_started` / `run_finished` 里的 `runId`、`elapsedMs` 是随机的，**不要整文件 diff**；只比较 `token` 行与 `node_finished.output.text`。

预期 `node_finished`：

```text
{"nodeId":"llm1","nodeType":"llm","output":{"text":"echo: 请用一句话介绍 你好世界","model":"mock-model","usage":{"promptTokens":31,"completionTokens":17,"totalTokens":48}}}
```

（`promptTokens` 取决于你的 prompt 与 system 文本长度，以实际为准。）

### 4.2 错误映射逐条验证

重复阶段 5 `03` 篇的表：

| `topic` / 配置 | 期望 `message` |
| --- | --- |
| `LLM_API_KEY=` | `llm provider not configured: LLM_API_KEY` |
| `[[mock-status:401]]` | `llm request unauthorized` |
| `[[mock-status:403]]` | `llm request unauthorized` |
| `[[mock-status:429]]` | `llm rate limited` |
| `[[mock-status:500]]` | `llm request failed: 500` |
| `[[mock-delay:5000]]` + `LLM_TIMEOUT_MS=200` | `llm request timed out` |
| `LLM_BASE_URL=http://127.0.0.1:1/v1` | `llm request failed: unknown` |

> `[[mock-status:...]]` 必须出现在 **user 消息**里。因为 prompt 模板会把 `topic` 渲染进去，所以把标记填进 `topic` 即可。

---

## 5. 阶段 5 验收清单

| # | 检查项 | 期望 |
| --- | --- | --- |
| 1 | 真实 provider：`token` 多帧 | 逐段出现，不是一次性 |
| 2 | 真实 provider：`output.text` | 等于所有 `token.text` 拼接 |
| 3 | `output.model` | 实际模型名（空串回退后） |
| 4 | `usage` | provider 返回时存在，数值合理 |
| 5 | 无密钥 | 无 `token`、无 `node_finished`，直接 `run_failed` |
| 6 | 401/403 | `llm request unauthorized` |
| 7 | 429 | `llm rate limited` |
| 8 | 500/503 | `llm request failed: <status>` |
| 9 | 超时 | `llm request timed out`，约在设定时间返回 |
| 10 | 拒连 | `llm request failed: unknown` |
| 11 | mock 正常链路 | 两端 `token` 行完全一致 |
| 12 | 前端 | 流式输出实时增长；失败显示 `message` |
| 13 | 构建 | `pnpm --filter @mini-dify/api-ts build`、`pnpm --filter @mini-dify/web build` 通过 |

---

## 6. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 为什么要 mock | CI 无密钥、输出可复现、错误场景可注入 |
| 为什么兼容 OpenAI 协议 | 协议细节才是真实故障源；替身要在边界上 |
| 固定 5 码点 | 两端 token 序列可逐字节比对 |
| `[...text]` vs `slice` | `slice` 按 UTF-16 码元会劈开代理对 |
| `choices: []` usage 帧 | 避免被当成内容增量；SDK 从该帧读 usage |
| `[DONE]` | 显式结束信号；缺失会导致客户端等到超时 |
| 延迟在错误之前 | 才能组合出“超时”场景 |
| mock 的局限 | 验证协议与链路，不验证模型质量与真实限流 |
| CI + 冒烟 | CI 用 mock，发布前跑真实 provider |
| 比对粒度 | 只比 `token` 与最终文本，不比含随机值的整帧 |

---

## 7. 下一步

阶段 6「工具调用」：

- `01-工具契约与内置工具.md`：`ToolDefinition`、`GET /tools`、calculator / current_time / http_get；
- `02-NestJS-ReAct循环与条件边.md`：`tools` 字段、`tool_call` / `tool_result` 事件、LLM ↔ 工具的条件边与环；
- `03-Python工具与ReAct对齐.md`：同一循环的 Python 实现；
- `04-前端工具选择面板.md`：勾选工具写入 `data.tools`；
- `05-验收.md`：mock 的 `[[call:...]]` 标记驱动多轮工具调用。
