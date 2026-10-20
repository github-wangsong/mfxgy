# 04 · mock LLM 与无密钥自测

> 所属：阶段 5 · LLM 节点
> 本篇覆盖：一个零依赖、OpenAI 兼容的最小 mock 服务 `tools/mock-llm/server.mjs`——用来在**没有 API Key、离线、结果确定**的条件下自测阶段 5 的 `llm` 节点。**错误映射的规则与文案**见上一篇 `03-LLM错误映射.md`；**LLM 节点的正常调用体**（`ChatOpenAI` 构造、逐 chunk 发 `token`、`usage` 累积）见本阶段 `02-真实模型调用与流式.md`；**契约字段与模型参数**见本阶段 `01-LLM节点契约与模型配置.md`。
> 本篇首次教学：**为什么要为外部依赖造 mock**（LLM 是**付费、不可控、有网络**的第三方；自动验收必须能**无密钥、离线、确定性地**复现）· **OpenAI 兼容协议的请求 / 响应形状**（`POST /v1/chat/completions`、`messages: [{role, content}]`、`stream: true` 时返回 `data: {...}` 分片、以 `data: [DONE]` 结束）· **⚠️「两套 SSE」的区分**（OpenAI 的 SSE 与我们 `/run` 的 SSE 是**两套完全不同的协议**）· **mock 的设计要点**（固定分片、可预测回显、返回 `usage`、**错误注入**）· **为什么错误用例要靠渲染进 prompt 的标记触发**（LangChain 不允许注入自定义头）
> （服务端手写 SSE 帧、帧格式与 `run_failed` 见阶段 4 · 01 / 05；`text/event-stream` 严格 `content-type` 见阶段 4 · 05；`llm` 节点变量池与模板渲染见阶段 4 · 03 / 04 —— 本篇**只引用、不重讲**）

---

## 1. 本篇目标

做完这一篇，你能：

- 讲清楚**为什么要给 LLM 造一个 mock**：真实 provider 付费、不可控、依赖网络，而自动验收需要**离线、确定、无密钥**。
- 讲清楚 **OpenAI 兼容协议**的请求 / 响应形状：`POST /v1/chat/completions`、`messages`、以及 `stream: true` 时的 `data: {...}` / `data: [DONE]` 分片约定。
- **把两套 SSE 分清楚**：mock 吐给 LangChain 的 OpenAI-SSE，与本项目 `/run` 吐给前端的**自有 SSE**，是两个毫不相干的协议。
- 读懂 mock 的四个设计要点：**固定分片**、**可预测回显**、**返回 `usage`**、**错误注入**；并说清「**错误用例为什么靠 prompt 标记**」这个绕法。
- 用 mock **同时验证「成功路径的流式」与「错误映射」**（401 / 429 / 500 / 超时）。
- 知道 mock 的**安全边界**：仅供本地自测，**不要部署**。

**验收标准**

| # | 检查项 | 预期 |
| --- | --- | --- |
| 1 | `node tools/mock-llm/server.mjs` 启动 | 监听 **11435**，打印 `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| 2 | 直连 mock（`curl.exe` 打 `/v1/chat/completions`） | 收到 `data: {...}` 分片，以 `data: [DONE]` 结束 |
| 3 | 后端把 `LLM_BASE_URL` 指向 mock 后跑 `/run` | **无真实密钥**也能拿到完整 SSE、逐步出现 `token` |
| 4 | mock 实测 `token` 序列 | `["echo:"," Hell","o min","i-dif","y"]`（**每 5 字符一片**） |
| 5 | mock 实测 `usage` | `{"promptTokens":15,"completionTokens":21,"totalTokens":36}` |
| 6 | prompt 含 `[[mock-status:401]]` | 流内 `run_failed.message = llm request unauthorized`（见 03 篇） |
| 7 | prompt 含 `[[mock-delay:10000]]` 且 `LLM_TIMEOUT_MS=3000` | 流内 `run_failed.message = llm request timed out` |

---

## 2. 前置条件

| 依赖 | 来自 |
| --- | --- |
| Node / pnpm、`pnpm install` 已执行（mock 只用 Node 内置模块，**零依赖**） | 阶段 0 · 01 / 03 |
| PostgreSQL 容器在跑（引擎读草稿） | 阶段 0 · 02 |
| 契约包已构建 | 阶段 0 · 04 |
| SSE 事件协议（含 `run_failed`）已冻结 | 阶段 4 · 01 |
| 服务端能返回 SSE 流 | 阶段 4 · 05 |
| `llm` 节点已从桩升级为真实 `ChatOpenAI` 调用；`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS` 已进两端配置 | 本阶段 `02-真实模型调用与流式.md`、`01-LLM节点契约与模型配置.md` |
| 已读过错误映射规则 | 上一篇 `03-LLM错误映射.md` |
| 已注册登录、有一个合法草稿图（`start → llm → end`） | 阶段 1 · 07；阶段 2 · 06；阶段 3 · 06 |

> **零依赖**：`server.mjs` 只 `import http from 'node:http'`，**不需要** `npm install` 任何东西，也不需要联网。

---

## 3. 命令清单（逐条说明）

所有命令在**仓库根**（`mini-dify/`）执行。Windows PowerShell 下 `curl` 是 `Invoke-WebRequest` 的别名，请显式用 **`curl.exe`**。

| 命令 | 在哪执行 | 目的 | 预期 |
| --- | --- | --- | --- |
| `node tools/mock-llm/server.mjs` | 仓库根 | 起 mock provider，**监听 11435** | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| 设 `apps/api-ts/.env`：`LLM_BASE_URL=http://127.0.0.1:11435/v1` / `LLM_API_KEY=test` / `LLM_MODEL=mock-model` / `LLM_TIMEOUT_MS=3000` | 编辑器 | 把后端 provider 指向 mock（**无真实密钥**） | — |
| （Py 侧同值改 `apps/api-py/.env`） | 编辑器 | 让 Py 后端也指向 mock | — |
| `curl.exe -N -X POST http://127.0.0.1:11435/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"mock-model\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Hello mini-dify\"}]}"` | 任意终端 | **直接观察 OpenAI-SSE**（不经过后端） | 若干 `data: {...}` 分片 + `data: [DONE]` |
| `pnpm dev:api-ts` | 仓库根 | 起 NestJS（3001），指向 mock | `api-ts listening on http://localhost:3001` |
| （或）`pnpm dev:api-py` | 仓库根 | 起 FastAPI（8000），指向 mock | `Uvicorn running on http://127.0.0.1:8000` |
| `curl.exe -N -X POST http://localhost:3001/apps/<APP_ID>/run -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" -d "{\"inputs\":{}}"` | 任意终端 | **无密钥自测**：走完整 `/run` SSE | 逐条 `token` 帧 + `run_finished`，见第 6 节 |
| prompt 改 `[[mock-status:401]]` 后再 run | 前端画布 + 终端 | 用 mock 验错误映射 | 流内 `run_failed`（见 03 篇） |

> `pnpm dev:api-ts` / `pnpm dev:api-py` 只引用不重讲（见阶段 0 · 05 / 06）。`-N` 关闭 curl 缓冲，才能看到逐帧到达（阶段 4 · 05）。`MOCK_LLM_PORT` 可覆盖 mock 端口（默认 11435）。

---

## 4. 完整代码

本步**新增一个文件**（零依赖的 mock 服务），全文照录。

### 4.1 `tools/mock-llm/server.mjs`（新增）

**完整文件路径：`tools/mock-llm/server.mjs`**

```js
#!/usr/bin/env node
/**
 * tools/mock-llm/server.mjs
 *
 * 用途：**无 API Key 时自测与验收**（mini-dify 阶段 5 的 `llm` 节点）。
 * 一个零依赖、OpenAI 兼容的最小 mock 服务：
 *   - `POST /v1/chat/completions`，支持 `stream: true`（SSE）与 `stream: false`（普通 JSON）。
 *   - 回复确定可预测：把收到的**最后一条 user 消息**原样回显并加固定前缀 `echo: `；
 *     分片固定为**每 5 个字符**一片（按 Unicode 码点），以便两端 token 序列可逐字节比对。
 *   - 返回 `usage`（`prompt_tokens` / `completion_tokens` / `total_tokens`）。
 *   - **错误 / 延迟注入**（用于验证错误映射），两种触发方式等价：
 *       · HTTP 头：`x-mock-status: 401`、`x-mock-delay: 10000`
 *       · 请求内容（供 LangChain 这类不设自定义头的客户端）：user 消息里含
 *         `[[mock-status:401]]` 或 `[[mock-delay:10000]]`
 *   - 监听端口默认 **11435**（可用环境变量 `MOCK_LLM_PORT` 覆盖）。
 *
 * 运行：`node tools/mock-llm/server.mjs`
 */
import http from 'node:http'

const PORT = Number(process.env.MOCK_LLM_PORT || 11435)
const CHUNK_SIZE = 5
const PREFIX = 'echo: '

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !(req.url || '').startsWith('/v1/chat/completions')) {
    return sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } })
  }

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

  const usage = {
    prompt_tokens: messages.reduce((n, m) => n + String(m.content ?? '').length, 0),
    completion_tokens: [...echo].length,
    total_tokens: 0,
  }
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens

  const status = injectedStatus(req, userContent)
  const delayMs = injectedDelay(req, userContent)
  if (delayMs > 0) {
    await sleep(delayMs)
  }
  if (status >= 400) {
    return sendJson(res, status, errorBody(status))
  }

  if (payload.stream === true) {
    streamResponse(res, echo, usage, payload.model)
  } else {
    sendJson(res, 200, {
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload.model || 'mock-model',
      choices: [
        { index: 0, message: { role: 'assistant', content: echo }, finish_reason: 'stop' },
      ],
      usage,
    })
  }
})

/** SSE 流式回复：若干 content 片段 + finish + usage，最后 `data: [DONE]`（OpenAI 的 SSE 格式）。 */
function streamResponse(res, text, usage, model) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const base = {
    id: 'mock-' + Date.now(),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model || 'mock-model',
  }
  res.write(sse({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }))
  for (const piece of chunkText(text, CHUNK_SIZE)) {
    res.write(sse({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }))
  }
  res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))
  res.write(sse({ ...base, choices: [], usage }))
  res.write('data: [DONE]\n\n')
  res.end()
}

/** 按 Unicode 码点固定切分（与两端按码点处理一致）。 */
function chunkText(text, size) {
  const codePoints = [...text]
  const chunks = []
  for (let i = 0; i < codePoints.length; i += size) {
    chunks.push(codePoints.slice(i, i + size).join(''))
  }
  return chunks
}

function lastUserContent(messages) {
  let content = ''
  for (const message of messages) {
    if (message && message.role === 'user') {
      content = typeof message.content === 'string' ? message.content : String(message.content ?? '')
    }
  }
  return content
}

function injectedStatus(req, userContent) {
  const header = String(req.headers['x-mock-status'] || '')
  if (/^\d+$/.test(header)) return Number(header)
  const found = userContent.match(/\[\[mock-status:(\d+)\]\]/)
  return found ? Number(found[1]) : 0
}

function injectedDelay(req, userContent) {
  const header = String(req.headers['x-mock-delay'] || '')
  if (/^\d+$/.test(header)) return Number(header)
  const found = userContent.match(/\[\[mock-delay:(\d+)\]\]/)
  return found ? Number(found[1]) : 0
}

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

function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`mock-llm listening on http://127.0.0.1:${PORT}/v1/chat/completions\n`)
})
```

**逐项解释**

- `http.createServer` + `server.listen(PORT, '127.0.0.1')`：用 Node **内置** `node:http` 起一个极小 HTTP 服务，只监听本机回环地址 `127.0.0.1`（**不对外暴露**，见 5.7）。
- 路由判断：只接受 `POST` 且 `url` 以 `/v1/chat/completions` 开头——其余一律 404 JSON（用 OpenAI 的错误形状）。
- `for await (const chunk of req) raw += chunk`：**手动收全请求体**（Node `http` 的请求体是流），再 `JSON.parse`；解析失败退化为 `{}`（不崩）。
- `lastUserContent(messages)`：**取最后一条 `role === 'user'` 的消息**作为「用户输入」，这是 mock 回显的依据（因为 LLM 请求的 `messages` 里可能还有 system 消息）。
- `echo = PREFIX + userContent`：回显 = 固定前缀 `echo: ` + 用户输入 → **内容完全可预测**（5.4）。
- `usage`：`prompt_tokens` = 所有消息 `content` 长度之和；`completion_tokens` = 回显文的**码点数**；`total_tokens` = 两者之和（对齐 OpenAI 语义）。
- `injectedStatus` / `injectedDelay`：**错误 / 延迟注入**，先看 HTTP 头、再看请求内容标记（5.5）。
- `streamResponse`：`stream: true` 时 **像 OpenAI 一样**分片（5.2）；`stream: false` 时返回一条普通 JSON completion。
- `chunkText`：按 **Unicode 码点**每 5 个切一片（与两端按码点处理一致，5.4）。
- `errorBody`：401 / 429 / 500 返回 OpenAI 形状的错误 JSON（**消息故意「像真的」**，用来验证我们**不会**把它透出去，见 03 篇）。

---

## 5. 【技术教学 · 首次】

> 规则：以下技术均为本项目**首次出现**，本节讲透；后续笔记只写「见阶段 5 · 04」并直接使用。

### 5.1 为什么要为外部依赖造 mock

阶段 0~4 的验收都只靠「本地代码 + 本地数据库」，成本为零、结果确定。到了阶段 5，`llm` 节点却第一次依赖一个**付费、不可控、需要联网**的第三方：

| 真实 provider 的问题 | 对「自动验收」的伤害 |
| --- | --- |
| **要钱**：每次调用都计费 | CI / 反复自测会烧钱，不现实 |
| **要联网、要 Key**：Key 可能过期、缺失 | 无 Key、离线环境**根本跑不起来** |
| **不确定**：模型每次回答都可能不同 | 无法断言「输出的具体内容」，验收退化成「看起来差不多」 |
| **有故障**：会超时、限流、5xx | 想复现某个错误得**碰运气**，无法稳定重放 |

所以工程上要为这类依赖造一个 **mock（替身服务）**：它**在本地、免费、离线可用、行为确定**，从而让「自动验收」能在**无 API Key** 的条件下反复跑。这也是「**依赖注入 / 依赖指向可配置**」的动机——本项目没有改代码，只把 `LLM_BASE_URL` 指到 mock，就完成了替换（这正是把 `baseURL` 做成环境变量的价值）。

> **mock ≠ 只测成功**：好的 mock 还能**确定性地制造故障**（超时 / 限流 / 鉴权失败）——这正是 03 篇那 6 条错误文案能被**逐一复现并逐字节比对**的前提。

### 5.2 OpenAI 兼容协议的请求 / 响应形状

mock 之所以能冒充 OpenAI，是因为它实现了 **OpenAI 的 `/v1/chat/completions` 兼容协议**。它对 LangChain 意味着：**只要 base URL 指向它，`ChatOpenAI` 毫不知情**。形状如下：

**请求**（`POST /v1/chat/completions`）：

```json
{
  "model": "mock-model",
  "stream": true,
  "messages": [
    { "role": "system", "content": "…" },
    { "role": "user", "content": "Hello mini-dify" }
  ]
}
```

- `messages` 是 `[{ role, content }]` 数组，`role` ∈ `system` / `user` / `assistant`。
- `stream: true` 表示要**流式**返回。

**响应（流式）**：Content-Type 为 `text/event-stream`，body 是一串：

```
data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" Hell"},"finish_reason":null}],…}\n\n
…
data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"finish_reason":"stop"}}]}\n\n
data: {"object":"chat.completion.chunk","choices":[],"usage":{…}}\n\n
data: [DONE]\n\n
```

要点：

- 每个 `data:` 后面是一段 **delta chunk**，增量文本在 `choices[0].delta.content`；
- 第一片常是 `delta: { role: 'assistant', content: '' }`（**空内容**，只声明角色）；
- 结束时先给一个 `finish_reason: 'stop'` 的 chunk，再给一个**带 `usage` 的 chunk**，最后以 `data: [DONE]` 收尾；
- **响应（非流式）** `stream: false`：一次性返回 `choices[0].message.content` 的完整文本。

LangChain 的 `ChatOpenAI` 负责把上面这堆 chunk **归一**成它自己的 `AIMessageChunk`：`chunk.content`（增量文本）与 `chunk.usage_metadata`（`input_tokens` / `output_tokens` / `total_tokens`）——于是本项目节点里只看到「干净的 `content` + `usage_metadata`」，看不到 `delta` 这些原始字段（见本阶段 `02-真实模型调用与流式.md`）。

> `client.stream(messages)`（TS）/ `client.astream(messages)`（Py）拿到的就是这些归一后的 chunk；本项目对**空 `content` 的 chunk 直接跳过**（`if piece !== ''`），所以开头那片空 delta 不会变成空的 `token` 事件。

### 5.3 ⚠️ 一个极易混淆的点：项目里同时有「两套 SSE」

这是本阶段最容易搞混的地方，务必分清：

| | **OpenAI 的 SSE**（mock / 真实 provider） | **本项目的 `/run` SSE** |
| --- | --- | --- |
| 谁产生 | LLM provider（mock 或 OpenAI…） | 我们自己的执行引擎 |
| 谁消费 | **LangChain**（`ChatOpenAI` 内部解析） | **我们的前端**（`fetch` + `getReader`，见阶段 4 · 06） |
| 帧内容 | `data: {"object":"chat.completion.chunk",…}`（**OpenAI 的私有分片格式**） | `event: <name>\n` + `data: <我们的 payload>`（**契约里的 6 种事件**） |
| 结束标记 | `data: [DONE]` | `run_finished` / `run_failed` 事件 |
| 事件名 | 无（只有 `data:` 行） | `run_started` / `node_started` / `token` / `node_finished` / `run_finished` / `run_failed` |

**两者唯一的共同点**是都用 `Content-Type: text/event-stream` 这个「传输外衣」；**内容、帧结构、语义完全相同于「零」。**

**数据是怎么流的（务必记住这条链路）**：

```
前端  ← 我们的 /run SSE（6 种事件）──  执行引擎  ←(ChatOpenAI 归一后的 chunk)──  LangChain
                                              │
                                              └── HTTP(OpenAI-SSE) ──▶ mock / provider
```

即：**provider 的 OpenAI-SSE → LangChain 解析 → 引擎发我们的 `token` 事件 → 前端渲染**。中间**没有任何一步**会把 provider 的原始帧透传出去——每过一层都**重新包装**。想清楚这条链路，就不会把「`data: [DONE]`」误当成「我们的流结束」。

> **一句话辨析**：`data: [DONE]` 属于**上游**（provider→LangChain）；`run_finished` 属于**下游**（引擎→前端）。同一个项目里两种 SSE 各司其职，只是恰好都长着 `text/event-stream` 的外壳。

### 5.4 mock 的设计要点

mock 的每一处设计都在服务「**可逐字节比对**」这个目标：

1. **分片规则固定（每 5 个字符一片，按 Unicode 码点）**
   真实模型怎么切 token 是它说了算、且不可预测；mock 必须**确定**：`chunkText` 按**码点**（`[...text]`，而非 `substring`，避免把多字节字符切坏）每 `CHUNK_SIZE = 5` 切一片。这样两套后端从同一 mock 拿到的 `token` 文本序列**逐字节相同**，可断言。

   > 实测：回显 `echo: Hello mini-dify`（21 个码点）切成 `["echo:"," Hell","o min","i-dif","y"]`。

2. **回复内容可预测（`echo: <user内容>`）**
   `echo = 'echo: ' + lastUserContent(messages)`：给定请求，输出**完全确定**（不调用任何模型）。验收时可以精确断言 `text === 'echo: Hello mini-dify'`。

3. **返回 `usage`**
   给 `usage` 让下游能验证 `usage_metadata` 的归一与 `node_finished.output.usage` 的组装。语义对齐 OpenAI：`prompt_tokens` = 消息长度和、`completion_tokens` = 回显码点数、`total_tokens` = 二者之和。

   > 实测：`{"promptTokens":15,"completionTokens":21,"totalTokens":36}`（用户输入 `Hello mini-dify` 15 字符 → prompt 15；回显 21 码点 → completion 21）。

4. **错误注入（两种等价方式）**
   - **HTTP 头**：`x-mock-status: 401` / `x-mock-delay: 10000`；
   - **请求内容标记**：user 消息里含 `[[mock-status:401]]` / `[[mock-delay:10000]]`。

   两者**等价**（先看头、再看标记）。`status >= 400` 就返回对应错误 JSON；`delay` 则先 `await sleep(delayMs)` 制造超时。

### 5.5 为什么错误用例要靠「渲染进 prompt 的标记」触发

上面第 4 点有**两种**注入方式，为什么本项目偏偏选「请求内容标记」？因为：

> **LangChain 封装了底层 HTTP 调用，我们无法往请求上注入自定义头**（`x-mock-status`）。

也就是说，`ChatOpenAI` 只让我们配置 `apiKey` / `baseURL` / `model` / `temperature` 等**协议内**字段，**没有**给我们「加一个任意 header」的口子。于是想触发 401，只能换成：**把标记写进 `prompt` → 渲染成 user 消息内容 → mock 从请求体里读到它**。

实践上就是：把 `llm` 节点的 `prompt` 改成 `[[mock-status:401]]` 并存草稿，run 时 mock 就会返回 401（见 03 篇的用例 2）。

**这个「绕法」本身很有教学价值**：它示范了「**当被测系统的客户端不可控时，如何把测试信号送进去**」——不能改头，就改**它能看到的输入（消息内容）**。写测试时常会遇到这类「入口受限」问题，能想到「借道它本来就传递的数据」是一种通用思路。（`x-mock-status` 头仍然保留，供**我们自己**用 curl 直连 mock 时使用，两种方式并存。）

### 5.6 mock 在验收中的角色

mock 不是「成功路径专用」，它**同时**承担两类验收：

| 验收目标 | 怎么用 mock |
| --- | --- |
| **成功路径的流式** | `LLM_BASE_URL → mock`、无真实 Key，跑 `/run`：断言 `token` 序列 `["echo:"," Hell","o min","i-dif","y"]`、`node_finished.output.text`、`usage`。两套后端跑同一 mock → 结果是**确定性可比**的 |
| **错误映射（401 / 429 / 500 / 超时）** | prompt 里塞 `[[mock-status:401]]` 等标记：断言流内 `run_failed.message` 为**规范文案**，且**不透出** mock 故意给的「像真的」错误话术（如 `Incorrect API key provided`）——见 03 篇 |

这正是「**一物两用**」：mock 既当「好的 provider」（验证 happy path 的流式与 usage），又当「坏的 provider」（验证我们**扛得住故障**）。**这也让 03 篇那 6 条错误文案全部可在无密钥条件下复现。**

### 5.7 安全提醒：mock 仅供本地自测

- mock **只监听 `127.0.0.1`**（回环地址），**不对外暴露**；即便如此，它也**没有**任何鉴权 / 限流 / 隔离——**不要部署到任何多人可见或公网环境**。
- 它**不是** LLM：不会推理、不会计费、回显固定内容。**只能**用于本地自测与验收断言。
- 真实密钥**仍走环境变量**（`LLM_API_KEY`），**绝不**写进代码或 mock；mock 场景下把 `LLM_API_KEY` 填成任意非空值（如 `test`）即可，它**不校验真伪**。
- 别把 mock 的 `baseURL` 配置**误提交**到生产 `.env`——`.env` 不进版本库（阶段 0 · 02 的约定）。

---

## 6. 验收自测

**准备**：起 `node tools/mock-llm/server.mjs`（11435）；`apps/api-ts/.env` 用 mock 配置（`LLM_BASE_URL=http://127.0.0.1:11435/v1`、`LLM_API_KEY=test`、`LLM_MODEL=mock-model`、`LLM_TIMEOUT_MS=3000`）；起 `pnpm dev:api-ts`（3001）；准备 `start → llm → end` 草稿图，`llm` 节点的 `prompt` 为 `Hello mini-dify`；登录拿 `<TOKEN>` / `<APP_ID>`。

**先直连 mock 看 OpenAI-SSE（不经过后端）**

```powershell
curl.exe -N -X POST http://127.0.0.1:11435/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"mock-model\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Hello mini-dify\"}]}"
```

预期（片段，分片固定）：

```text
data: {"id":"mock-…","object":"chat.completion.chunk","created":…,"model":"mock-model","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{"content":"echo:"},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{"content":" Hell"},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{"content":"o min"},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{"content":"i-dif"},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{"content":"y"},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: {"…","choices":[],"usage":{"prompt_tokens":15,"completion_tokens":21,"total_tokens":36}}

data: [DONE]
```

**再走后端 `/run`（无密钥成功的完整 SSE）**

```powershell
curl.exe -N -X POST http://localhost:3001/apps/<APP_ID>/run `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <TOKEN>" `
  -d "{\"inputs\":{}}"
```

**实测回放（照实记录）**

```text
event: run_started
data: {"runId":"…","appId":"…"}

event: node_started
data: {"nodeId":"n-start","nodeType":"start"}

event: node_finished
data: {"nodeId":"n-start","nodeType":"start","output":{"inputs":{}}}

event: node_started
data: {"nodeId":"n-llm","nodeType":"llm"}

event: token
data: {"nodeId":"n-llm","text":"echo:"}

event: token
data: {"nodeId":"n-llm","text":" Hell"}

event: token
data: {"nodeId":"n-llm","text":"o min"}

event: token
data: {"nodeId":"n-llm","text":"i-dif"}

event: token
data: {"nodeId":"n-llm","text":"y"}

event: node_finished
data: {"nodeId":"n-llm","nodeType":"llm","output":{"text":"echo: Hello mini-dify","model":"mock-model","usage":{"promptTokens":15,"completionTokens":21,"totalTokens":36}}}

event: node_started
data: {"nodeId":"n-end","nodeType":"end"}

event: node_finished
data: {"nodeId":"n-end","nodeType":"end","output":{"outputs":{"result":"echo: Hello mini-dify"}}}

event: run_finished
data: {"runId":"…","outputs":{"result":"echo: Hello mini-dify"},"elapsedMs":…}
```

| 检查项 | 操作 | 预期（**实测**） |
| --- | --- | --- |
| mock 启动 | `node tools/mock-llm/server.mjs` | `mock-llm listening on http://127.0.0.1:11435/v1/chat/completions` |
| OpenAI-SSE 形状 | 直连 mock | `data: {...}` 分片，以 `data: [DONE]` 结束 |
| **无密钥跑通** | 后端指向 mock 跑 `/run` | 拿到完整 `/run` SSE（**未使用任何真实 Key**） |
| `token` 序列 | 数 `token` 帧 | `["echo:"," Hell","o min","i-dif","y"]`（**每 5 字符一片**） |
| `usage` | 看 `node_finished(n-llm).output.usage` | `{"promptTokens":15,"completionTokens":21,"totalTokens":36}` |
| 空 delta 不产生空 token | 数 `token` 帧条数 | 开头那片空内容 chunk **未**变成 `token` 帧（`if piece !== ''`） |
| 成功收束 | 末帧 | `run_finished`，`outputs.result = "echo: Hello mini-dify"` |
| 错误映射（借 mock） | prompt = `[[mock-status:401]]` 后 run | 流内 `run_failed.message = llm request unauthorized`（见 03 篇） |
| 超时（借 mock） | prompt = `[[mock-delay:10000]]`（`LLM_TIMEOUT_MS=3000`） | 流内 `run_failed.message = llm request timed out`（见 03 篇） |
| 跨后端一致 | base 换 8000 重跑 | 事件序列与 `token` 分片**逐字节相同** |

---

## 7. 常见坑

| # | 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- | --- |
| 1 | **把 OpenAI-SSE 当成我们的 `/run` SSE** | 想找 `event:` 行、或把 `data: [DONE]` 当成流结束 | 那是**两套协议**（第 5.3 节）：`[DONE]` 属上游（provider→LangChain），`run_finished` 属下游（引擎→前端） |
| 2 | **以为 mock 记得住「模型」** | 换了模型名结果一样 | mock **不推理**，只回显；它和真实模型行为无关（第 5.7 节） |
| 3 | **忘了把 `LLM_BASE_URL` 指到 mock** | 仍打真实 OpenAI，报鉴权 / 计费 | `.env` 改 `LLM_BASE_URL=http://127.0.0.1:11435/v1` 并**重启后端**（改 .env 不重启不生效） |
| 4 | **`LLM_API_KEY` 留空** | 节点直接 `llm provider not configured: LLM_API_KEY`，压根没到 mock | mock 场景填任意非空值（如 `test`）；它不校验真伪（第 5.7 节） |
| 5 | **拿自定义头注入错误（对 LangChain 无效）** | `x-mock-status` 设了没反应 | LangChain 不允许注入自定义头；改用**渲染进 prompt 的标记** `[[mock-status:NNN]]`（第 5.5 节） |
| 6 | **以为 mock 的 `data: {…usage}` 会变成 `token`** | token 序列里多出一条奇怪文本 | 那是一个 `choices: []` 的 **usage chunk**，不是内容增量；LangChain 把它归一进 `usage_metadata` |
| 7 | **分片用 `substring` 切** | 多字节字符被切坏 | mock 用 `[...text]` 按**码点**切（第 5.4 节）；两端也按码点处理，才逐字节可比 |
| 8 | **超时设太大** | `[[mock-delay:10000]]` 等 10 s 才报超时 | 把 `LLM_TIMEOUT_MS` 调小（如 3000）让超时**快速**触发 |
| 9 | **端口 `11435` 被占 / 绑不上** | `EADDRINUSE`；或 `An attempt was made to access a socket in a way forbidden by its access permissions` | 见下条；也可用 `MOCK_LLM_PORT` 换端口 |
| 10 | **`3000`/`3001` 绑不上（Windows 特有）** | 报 `EADDRINUSE`，或 `An attempt was made to access a socket in a way forbidden by its access permissions` | Windows（Hyper-V / Docker）会把**一段端口动态保留**，落在这段里的端口**无法绑定**——本机曾出现保留段 `2957–3056`（含 3000/3001）。**临时自救**：改用其它端口。**根治（需管理员）**：`net stop winnat` + `net start winnat`，或重启机器 |

### 端口保留段的排查（Windows）

若 `3001` 之类端口绑不上，可查「谁占了 / 是否落在保留段」：

```powershell
netstat -ano | findstr :3001              # 看是否有进程在 LISTENING
netsh interface ipv4 show excludedportrange protocol=tcp   # 看被保留（不可绑定）的端口段
```

`show excludedportrange` 若显示某段（如 `2957–3056`）含你的端口，就是**被系统保留**——此时进程会报 `An attempt was made to access a socket in a way forbidden by its access permissions`。解决（**需管理员**）：`net stop winnat` → `net start winnat`（重启 Windows NAT 服务，重建保留段）；或重启机器。**临时自救**：把 api-ts 的 `PORT` 或 mock 的 `MOCK_LLM_PORT` 改到保留段之外的端口。

---

## 8. 本篇复盘与知识点

**一句话总结本篇**：真实 LLM 是**付费、不可控、联网**的外部依赖，自动验收需要一个**离线、免费、确定**的替身——`tools/mock-llm/server.mjs`。它实现 **OpenAI 兼容协议**（`/v1/chat/completions`，`stream: true` 返回 `data: {...}` 分片、以 `data: [DONE]` 结束），用「**每 5 字符一片 + 回显 `echo: <输入>` + 返回 `usage` + 错误注入**」让结果可预测、可逐字节比对；通过把 `LLM_BASE_URL` 指向它，就在**无密钥**条件下同时跑通了「成功流式」与「错误映射」。

**本篇学到的工程要点**

1. **给外部依赖造 mock**：付费 / 联网 / 不确定 → 自动验收必须能离线、确定、无密钥地跑。
2. **OpenAI 协议形状**：`POST /v1/chat/completions`、`messages: [{role, content}]`、`stream: true` 的 `data: {...}` / `data: [DONE]`。
3. **两套 SSE 别混**：provider 的 OpenAI-SSE（→LangChain）与 `/run` 的自有 SSE（→前端）是**两套协议**，只是共用 `text/event-stream` 外衣。
4. **mock 的四个设计点**：固定分片、可预测回显、返回 `usage`、错误注入。
5. **错误注入绕法**：LangChain 不允许自定义头 → 把标记写进 prompt，借「它能看到的输入」传测试信号。
6. **mock 一物两用**：既验成功流式，也验错误映射；**安全上仅供本地，不部署、不写真实密钥**。

**遗留 / 后续**

- mock 只覆盖单轮、无工具调用；工具调用 / Agent 场景（阶段 6）需扩展 mock（如模拟 `tool_calls` 分片）。
- 「脱机 CI 用 mock 跑契约测试」尚未自动化——留待后续。

---

## 9. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| 为什么要为外部依赖造 mock（付费 / 联网 / 不确定 → 需离线、确定、无密钥的验收） | **首次教学于本篇** |
| OpenAI 兼容协议的请求 / 响应形状（`/v1/chat/completions`、`messages`、`data: {...}` / `data: [DONE]`） | **首次教学于本篇** |
| 项目内「两套 SSE」的区分（provider 的 OpenAI-SSE vs 本项目 `/run` 的 6 事件 SSE） | **首次教学于本篇** |
| mock 设计要点（固定码点分片、可预测回显、返回 `usage`、错误 / 延迟注入） | **首次教学于本篇** |
| 错误注入绕法（LangChain 不允许自定义头 → 渲染进 prompt 的 `[[mock-status]]` 标记） | **首次教学于本篇** |
| mock 的安全边界（仅本地回环、不部署、真实密钥仍走环境变量） | **首次教学于本篇** |
| Windows 端口「保留段」导致无法绑定（`winnat` / 换端口） | **首次教学于本篇** |
