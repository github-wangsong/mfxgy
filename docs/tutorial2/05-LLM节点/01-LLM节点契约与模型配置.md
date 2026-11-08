# 01 · LLM 节点契约与模型配置（LLM 节点）

> 阶段 5 · 第 1 步
>
> 做完：`llm` 节点的 `data` 形状正式进契约（`LlmNodeData`）；输出形状 `{ text, model, usage? }` 写进 TS 类型；两端 `.env` 增加四个 LLM 配置键；契约版本 `0.5.0 → 0.6.0`。
>
> 本篇不写调用代码，只定「哪些配置属于节点、哪些属于部署环境」——这个边界定错，后面要么泄露密钥，要么无法给不同用户配不同模型。
>
> **本篇面试考点**：节点级配置 vs 部署级配置 · 为什么 API Key 绝不能进图 JSON · OpenAI 兼容层是什么 · 模型名的三层回退 · 预检只做「本地可判定」的校验 · `temperature` / `maxTokens` 的范围由谁负责 · 超时为什么是环境变量 · 配置在模块加载时读还是调用时读。

---

## 1. 配置的分层

一个 `llm` 节点需要这些东西才能跑起来：

| 配置 | 粒度 | 放在哪 | 谁能改 |
| --- | --- | --- | --- |
| `model` | 每个节点可不同 | 节点 `data.model` | 应用作者 |
| `temperature` | 每个节点可不同 | 节点 `data.temperature` | 应用作者 |
| `maxTokens` | 每个节点可不同 | 节点 `data.maxTokens` | 应用作者 |
| `system` / `prompt` | 每个节点不同 | 节点 `data` | 应用作者 |
| `baseURL` | **整个部署** | `LLM_BASE_URL` | 运维 |
| `apiKey` | **整个部署** | `LLM_API_KEY` | 运维 |
| 默认模型 | **整个部署** | `LLM_MODEL` | 运维 |
| 超时 | **整个部署** | `LLM_TIMEOUT_MS` | 运维 |

分界线：**节点级配置是“这个节点想怎么算”，部署级配置是“这台服务器拿什么凭证去算”。**

密钥绝不能进节点 `data`，因为：

- `data` 会存进 `apps.graph_json`（JSONB），任何能查库/备份的人都看得到；
- 画布保存、发布快照、运行事件都可能把它带出去；
- 用户复制一个应用，密钥就跟着复制走了。

> **面试考点 · 为什么密钥不能像模型名一样放节点里？**
> 模型名是**业务配置**，密钥是**凭证**。凭证有三个额外要求：不可读回、可轮换、按部署隔离。
> 一旦写进业务数据：
>
> - 读接口要额外做脱敏（漏一处就泄露）；
> - 轮换密钥要改所有应用（几百条 JSONB 记录）；
> - 多租户场景下无法给不同用户用不同的 provider 账号。
>
> **凭证只存在于运行环境，业务数据只引用“用哪个能力”，不引用“用谁的账号”。**

---

## 2. 契约：`LlmNodeData`

**完整文件路径：`packages/contract/openapi.yaml`**（阶段 5 新增 schema）

```yaml
    LlmNodeData:
      type: object
      additionalProperties: true
      required: [title, model, prompt]
      description: >-
        `llm` 节点的 `data` 形状（引擎按此解释，见 error-messages.md §5）。
        `model` 为空字符串时回退到环境变量 `LLM_MODEL`。
      properties:
        title:
          type: string
        model:
          type: string
        prompt:
          type: string
          description: 支持 `{{ path }}` 模板
        system:
          type: string
          description: 可选的 system 消息
        temperature:
          type: number
        maxTokens:
          type: integer
```

约定：

1. `title` 必填，只用于画布展示，不参与运行；
2. `model` 必填但**允许空字符串**——空串表示“用部署默认值”；
3. `prompt` 必填，支持 `{{ path }}` 模板；
4. `system` / `temperature` / `maxTokens` 可选；
5. `additionalProperties: true`——节点 `data` 允许携带前端 UI 状态（如折叠、备注），引擎只读自己认识的键。

> **面试考点 · 为什么 `model` 必填却允许空串，而不是“可选”？**
> 两种语义不同：
>
> - **可选**（不传）：前端可能忘记传，序列化后字段消失，引擎无法区分“没配”和“用默认”；
> - **必填 + 空串**：字段一定存在，空串明确表示“回退”。
>
> 前者把“缺字段”和“显式默认”混在一起；后者用一个确定的哨兵值表达意图。
> 这与 `description` 用 `null` 表示“空”是同一个思路：**状态要能被明确表达，而不是靠“字段不在”来暗示。**

---

## 3. 输出形状

`node_finished.output` 里 `llm` 节点的形状：

```ts
{
  text: string          // 模型返回的完整文本（所有 token 拼接）
  model: string         // 实际使用的模型名（回退后）
  usage?: {             // provider 提供时才有
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}
```

**完整文件路径：`packages/contract/src/index.ts`**（阶段 5 新增）

```ts
/** `llm` 节点的 `data` 形状（见 openapi.yaml `LlmNodeData`）。 */
export interface LlmNodeData {
  /** 画布展示名（必填，不参与运行） */
  title: string
  /** 模型名；为空字符串时回退到环境变量 `LLM_MODEL` */
  model: string
  /** 支持 `{{ path }}` 模板 */
  prompt: string
  /** 可选的 system 消息 */
  system?: string
  temperature?: number
  maxTokens?: number
}

/**
 * `llm` 节点输出形状（`node_finished.output`）。
 * provider 未给 usage 时省略 `usage`（不是返回 `null`）。
 */
export interface LlmNodeOutput {
  text: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}
```

```ts
export const CONTRACT_VERSION = '0.6.0'
```

> **面试考点 · `usage` 为什么是“可选字段”，而不是 `null`？**
> 契约里“字段缺失”和“字段为 null”是两种语义：
>
> - 缺失：provider 没提供这个信息（例如某些兼容实现不返回 usage）；
> - `null`：明确表示“没有值”。
>
> 前端渲染时，缺失可以直接 `if (usage)` 跳过；`null` 还要额外判断。更重要的是**跨语言序列化**：Python 里 `None` 会变成 `null`，而“不设置这个键”才是真正省略。选一个并写进契约，两端照做。

> **面试考点 · 为什么 `model` 要回显“实际使用的模型名”？**
> 节点里 `model` 可能是空串（用部署默认值）。如果输出原样回显空串，调用方就不知道这次到底用了什么模型：
>
> - 排查“为什么两个应用效果不同”时无从下手；
> - 计费/审计无法按模型归类。
>
> **配置可以回退，事实不能回退。** 返回的永远是真正执行时用的值。

---

## 4. 环境变量

**完整文件路径：`apps/api-ts/.env.example`**（LLM 节选）

```dotenv
# LLM（阶段 5）：OpenAI 兼容 provider；两端读同一组键（api-py 的 .env 同值）
# 本地无密钥自测：把 BASE_URL 指到 `node tools/mock-llm/server.mjs`（默认 http://127.0.0.1:11435/v1），API_KEY 随意填非空
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
# 单次 LLM 请求超时（毫秒）
LLM_TIMEOUT_MS=60000
```

**完整文件路径：`apps/api-py/.env.example`**（LLM 节选，值与 TS 侧完全一致）

```dotenv
# LLM（阶段 5）：OpenAI 兼容 provider；两端读同一组键（api-ts 的 .env 同值）
# 本地无密钥自测：把 BASE_URL 指到 `node tools/mock-llm/server.mjs`（默认 http://127.0.0.1:11435/v1），API_KEY 随意填非空
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
# 单次 LLM 请求超时（毫秒）
LLM_TIMEOUT_MS=60000
```

要点：

1. `LLM_API_KEY` **留空**——仓库里不提交真实密钥；
2. `LLM_BASE_URL` 指向 OpenAI 兼容接口（`/v1` 结尾），不是 OpenAI 专用；
3. 两端读**同一组键名**，否则“切后端”时行为会悄悄变化；
4. `LLM_TIMEOUT_MS` 用毫秒，和 Node/Python 的 HTTP 客户端单位一致。

> **面试考点 · 什么是“OpenAI 兼容层”？**
> 大量模型服务（Azure OpenAI、DeepSeek、Moonshot、vLLM、Ollama、one-api 网关）都实现了同一套 HTTP 接口：
>
> ```text
> POST {baseURL}/chat/completions
> Authorization: Bearer <key>
> { "model": "...", "messages": [...], "stream": true }
> ```
>
> 只要代码按这个形状调用，换 provider 只需改 `LLM_BASE_URL` + `LLM_MODEL` + `LLM_API_KEY`，**业务代码一行不改**。
> 这也是本地 mock 服务能无缝替换真实模型的原因（阶段 5 的 `04` 篇）。
> **选型时优先看“是否有 OpenAI 兼容接口”，它决定了你的供应商锁定成本。**

> **面试考点 · 配置在模块加载时读，还是每次调用时读？**
> 本项目的写法是**每次调用时读** `process.env`：
>
> ```ts
> const apiKey = process.env.LLM_API_KEY ?? ''
> const model = data.model ? data.model : (process.env.LLM_MODEL ?? '')
> ```
>
> 好处：
>
> - 测试里可以临时改环境变量，不用重新加载模块；
> - 同一进程内不同请求可以走不同配置（未来多租户）；
> - 不会因为模块加载顺序导致读到空值。
>
> 代价：每次多几次对象属性查找（可忽略）。
> 反面写法是在文件顶部 `const API_KEY = process.env.LLM_API_KEY`——一旦在 `dotenv` 加载之前 import，就永远是 `undefined`。
> **配置读取的时机，是“为什么本地能跑、部署就空”这类问题的高发区。**

> **面试考点 · 为什么 `main.ts` 第一行必须是 `import 'dotenv/config'`？**
> ES Module 的 `import` 会被提升：所有 import 在模块体执行前完成。如果 `dotenv` 的加载晚于某个模块读取 `process.env`，那个模块拿到的是空值。
> 把 `import 'dotenv/config'` 放在**第一行**，是保证“环境变量先于任何业务模块初始化”的最简单手段。
> 更严格的做法是用 `@nestjs/config` 的 `ConfigModule.forRoot()` 并注入 `ConfigService`，本项目的配置项少，直接读 `process.env` 足够。

---

## 5. 预检边界

阶段 5 的 `validateNodeData` 对 `llm` 节点只加一条：

```ts
} else if (node.type === 'llm') {
  // prompt 必须是字符串：模板渲染的前提
  if (typeof data.prompt !== 'string') {
    errors.push(`llm node ${node.id} prompt must be a string`)
  }
}
```

**不**在预检里做的事：

| 不校验 | 原因 |
| --- | --- |
| `model` 是否存在 | 只有 provider 知道；预检发一次请求去问，等于把运行成本翻倍 |
| `temperature` 范围 | 不同 provider 支持范围不同；交给 provider 报错并映射成规范文案 |
| `maxTokens` 上限 | 同上，且会随模型变化 |
| `LLM_API_KEY` 是否有效 | 只有真正调用才知道；但**是否为空**可以在调用时立刻判断（见 `03-LLM错误映射.md`） |

> **面试考点 · 预检到底该校验什么？**
> 一条实用标准：**能在本地、无网络、O(1) 时间内判定的错误，才放进预检。**
>
> - `prompt` 是不是字符串 → 本地可判定；
> - 图里有没有环、边是否悬空 → 本地可判定；
> - 模型名是否合法 → 需要网络，且结果可能随 provider 变化；
> - API Key 是否有效 → 需要网络。
>
> 把需要网络的校验放进预检，会让每次运行都多一次往返；把本地可判定的错误留到运行时，则会让用户拿到 200 流之后才发现“图是坏的”。
> **预检不是“越多越好”，而是“只做确定的事”。**

---

## 6. 验证

```powershell
# 1. 契约构建
pnpm --filter @mini-dify/contract build

# 2. 版本与 schema 存在性
Select-String -Path packages/contract/openapi.yaml -Pattern 'version: 0.6.0'
Select-String -Path packages/contract/openapi.yaml -Pattern 'LlmNodeData'
Select-String -Path packages/contract/src/index.ts -Pattern "CONTRACT_VERSION = '0.6.0'"
```

预期三行都能匹配到。

```powershell
# 3. 两端 .env 的 LLM 键一致
Compare-Object `
  (Select-String -Path apps/api-ts/.env.example -Pattern '^LLM_' | ForEach-Object { $_.Line }) `
  (Select-String -Path apps/api-py/.env.example -Pattern '^LLM_' | ForEach-Object { $_.Line })
```

预期无输出（键与值完全相同）。

```powershell
# 4. TypeScript 类型可用
pnpm --filter @mini-dify/api-ts exec tsc --noEmit
```

预期无报错。

```powershell
# 5. 运行一个 model 为空串的 llm 节点（阶段 5 的 02 篇实现后）
```

输出事件的 `node_finished.output.model` 应为 `.env` 里的 `LLM_MODEL`（如 `gpt-4o-mini`），而不是空串。

---

## 7. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 节点级 vs 部署级配置 | 业务选择放节点；凭证/端点/超时放环境 |
| 密钥为什么不能进图 | JSONB 可被读取/备份/复制；轮换成本高；无法按租户隔离 |
| OpenAI 兼容层 | 同一 `/chat/completions` 形状，换 provider 只改三个环境变量 |
| `model` 为什么必填可空 | 空串是明确哨兵，避免“字段缺失”与“显式默认”混淆 |
| 输出为什么回显实际 model | 配置可回退，事实不能；排查与计费都需要真实值 |
| `usage` 为什么可选 | 部分 provider 不返回；缺失 ≠ null |
| 预检边界 | 只做本地、无网络、O(1) 可判定的校验 |
| 配置读取时机 | 调用时读，避免 import 提升导致的空值；`dotenv` 必须最先加载 |
| 超时为什么放环境 | 与部署的网络/额度有关，不是单个应用的业务选择 |

---

## 8. 下一步

- `02-真实模型调用与流式.md`：把阶段 4 的回显占位换成 `ChatOpenAI` / LangChain `astream`，`token` 来自 provider 的真实片段，`usage` 汇总。
- `03-LLM错误映射.md`：六条规范文案，两端逐字节一致。
- `04-节点参数面板.md`：前端编辑 `model` / `temperature` / `maxTokens` / `system` / `prompt`。
- `05-mock-LLM与验收.md`：本地 mock 服务 + 无密钥端到端验收。
