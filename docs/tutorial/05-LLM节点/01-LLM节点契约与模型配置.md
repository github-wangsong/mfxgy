# 01 · LLM 节点契约与模型配置

> 所属：阶段 5 · LLM 节点
> 本篇覆盖：在唯一真源 `packages/contract/openapi.yaml` 里把 `llm` 节点的 `data` 形状**正式化**（新增 `LlmNodeData` schema，`model` 为空回退环境变量 `LLM_MODEL`）→ 同步 `src/index.ts` 的 `LlmNodeData`（补齐 `system?` / `temperature?` / `maxTokens?`）与新增 `LlmNodeOutput`（`{ text, model, usage? }`）→ 更新 `sse-events.md` 的 `llm` 语义（改为**真实模型调用**、**真实流式片段**、`usage` 可选）→ 在 `error-messages.md` 追加「§5 LLM 错误」→ 新增两端 `.env.example` 的 LLM 四键 → 契约升到 **`0.5.0`** 并编译出 `dist`
> **本篇首次教学：① `LlmNodeData` 的形状正式化（`{ title, model, prompt, system?, temperature?, maxTokens? }`）与「`model` 为空回退环境变量 `LLM_MODEL`」的**节点级 vs 全局默认**优先级设计；② `llm` 节点输出 `{ text, model, usage? }` 与**为什么 `usage` 是可选的**（跨实现契约里「可选字段」的意义）；③ LLM 配置放**环境变量**（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS`）与**为什么用「OpenAI 兼容」协议**（`base_url` 的威力：一份代码对接 OpenAI / DeepSeek / 阿里 / 本地 Ollama）；④ LLM 错误文案（`error-messages.md` §5）与「**不**透出库的原始 message」原则；⑤ **为什么密钥不进仓库**（`.env` 已 gitignore、`.env.example` 留空）**
> （OpenAPI 规范 / `$ref` / `additionalProperties` / `enum` / `format` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；`GraphNode.data` 为唯一放开字段与「形状正式化」见 `04-执行引擎/01-运行契约与SSE事件协议.md` §14；SSE 帧格式与事件协议唯一真源见 `04-执行引擎/01-运行契约与SSE事件协议.md`；错误文案目录与「唯一真源」套路见 `02-应用管理/07-验收.md` 与 `04-执行引擎/01-运行契约与SSE事件协议.md` §12；「draft vs published」的**局部覆盖默认**设计见 `03-画布/02-Prisma-JSONB与两态.md`。本篇**只改契约文件与 `.env.example`**，模型调用实现见 `05-LLM节点/02-真实模型调用与流式.md`）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 5 的立论：把「桩」换成「真模型」

阶段 4 的 `llm` 节点是一个**桩**：它不调模型，只把 `prompt` 渲染后**按每 8 个 Unicode 码点切一片**、逐片发 `token`（见 `04-执行引擎/03-节点运行时与变量池.md` §8）。那次切分让**流式通道**先跑通了，但「片」是**本地造的**，不是模型吐的。

阶段 5 要做的，就是把桩换成**真实模型调用**：

```
阶段 4：llm 节点 ── 本地切片（每 8 码点）──▶ token 事件（片 = 自己切的）
阶段 5：llm 节点 ── ChatOpenAI 流式 ────────▶ token 事件（片 = provider 吐的真实增量）
```

换成真模型，会同时牵动四处**契约**（都在本篇定稿）：

| 契约文件 | 阶段 5 改了什么 |
| --- | --- |
| `openapi.yaml` | 新增 `LlmNodeData` schema（`llm.data` 的**正式形状**）；`GraphNode.data` 的 description 改为「见 `LlmNodeData`」；`info.version` → `0.5.0` |
| `src/index.ts` | `LlmNodeData` 补 `system?` / `temperature?` / `maxTokens?`；新增 `LlmNodeOutput`（节点输出形状）；`CONTRACT_VERSION` → `0.5.0` |
| `sse-events.md` | `llm` 语义从「桩」改为「真实模型调用」；`token` 的 `text` 明确为**provider 的真实流式片段**；节点输出改为 `{ text, model, usage? }` |
| `error-messages.md` | 新增「§5 LLM 错误」：把 LangChain / 底层异常归一为 6 条**规范文案** |

外加两端 `.env.example` 各加 4 个 LLM 变量（**全局默认**）。

> 为什么契约要先动？因为本项目「**契约是唯一真源**」——契约不定，两端的 `llm` 节点就会各写各的（一个发 `model`、一个不发；一个必带 `usage`、一个可省）。先把形状钉死，`02` 篇才有「照契约实现」的依据。

---

## 1. 本篇目标

- 把 `llm` 节点的 `data` 形状**正式化**：新增 `LlmNodeData` schema（`{ title, model, prompt, system?, temperature?, maxTokens? }`），并写明 **`model` 为空时回退环境变量 `LLM_MODEL`**。
- 把 `llm` 节点的**输出**形状正式化：`{ text, model, usage? }`（`usage` 可选）。
- 更新 `sse-events.md` 的 `llm` 语义：真实模型调用、`token` 为 provider 真实片段、`usage` 缺省规则、错误走 `run_failed` 且**不**发该节点 `node_finished`。
- 在 `error-messages.md` 追加「§5 LLM 错误」：6 条规范文案 + 「不透出库原始 message」原则。
- 在两端 `.env.example` 里加上 LLM 四键：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS`（**留空密钥**）。
- 契约升到 **`0.5.0`** 并编译成两端与前端能消费的 TS 类型产物。

**验收标准**

1. `pnpm run build:contract` 成功，产出 `packages/contract/dist/index.js` 与 `index.d.ts`。
2. `openapi.yaml` 里 `info.version` 为 **`0.5.0`**，且 `components.schemas` 新增 `LlmNodeData`。
3. `src/index.ts` 的 `CONTRACT_VERSION` 为 **`0.5.0`**；`LlmNodeData` 含 `system?` / `temperature?` / `maxTokens?`；新增 `LlmNodeOutput`。
4. `sse-events.md` §4 的 `llm` 一节写着「阶段 5 起为**真实模型调用**」，`token` 行写明「provider 的真实流式片段」。
5. `error-messages.md` 多了 `## 5. LLM 错误（POST /apps/{id}/run 流内 run_failed）`（6 条文案）。
6. 两端 `.env.example` 各有 `LLM_BASE_URL` / `LLM_API_KEY`（空）/ `LLM_MODEL` / `LLM_TIMEOUT_MS`。

**本阶段契约侧只改「形状与文案」，不改接口路径**：`POST /apps/{id}/run` 的路径、方法、响应形态（`text/event-stream`）与阶段 4 **完全一致**——这正是阶段 4「事件协议一个字都不用改」的兑现（当时预告「阶段 5 换真模型，协议不变」，见 `04-执行引擎/03-节点运行时与变量池.md` §8）。

---

## 2. 前置条件

- 阶段 4 全部完成：`POST /apps/{id}/run`、`RunRequest` / `RunEvent`、`sse-events.md`、`error-messages.md` §4 都已就位（见 `04-执行引擎/01-运行契约与SSE事件协议.md`）。
- 阶段 0 · 04（`packages/contract` 契约包）与 `pnpm install` 已完成，`build:contract` 能用。
- 阶段 5 的模型调用实现（`02-真实模型调用与流式.md`）尚未落地时，本篇也可单独完成（只改契约文件与 `.env.example`）。

> 本篇**只改契约四文件 + 两端 `.env.example`**，不动后端源码。模型调用实现见 `05-LLM节点/02-真实模型调用与流式.md`。

---

## 3. 先看清要做什么

```
packages/contract/
   ├── openapi.yaml        ← info.version 0.5.0；新增 LlmNodeData；GraphNode.data 描述改引 LlmNodeData   （本篇 §5）
   ├── src/index.ts        ← LlmNodeData 补 3 个可选字段；新增 LlmNodeOutput；CONTRACT_VERSION 0.5.0        （本篇 §6）
   ├── sse-events.md       ← §2 token 行 + §4 llm 段改为「真实模型调用」                                      （本篇 §7）
   └── error-messages.md   ← 追加「§5 LLM 错误」（6 条规范文案）                                            （本篇 §8）
        ↓ pnpm run build:contract
      dist/index.js + dist/index.d.ts

apps/api-ts/.env.example   ← 追加 LLM_BASE_URL / LLM_API_KEY（空）/ LLM_MODEL / LLM_TIMEOUT_MS             （本篇 §9）
apps/api-py/.env.example   ← 同上（与 api-ts 同值，两端才连同一个 provider）
```

**`llm` 节点在阶段 5 的完整语义**（先给全景，细节见后续节）：

```
llm 节点
  ├─ 取 data.prompt（字符串，支持 {{ path }} 模板）
  ├─ 渲染 → user 消息；data.system 非空 → 另加 system 消息
  ├─ 模型 = data.model 非空 ? data.model : 环境变量 LLM_MODEL        ← 节点级覆盖全局默认
  ├─ 调 LangChain ChatOpenAI（base_url / api_key / timeout 全来自环境变量）
  ├─ 流式：逐 chunk 取 chunk.content（字符串化）→ 立刻发 token 事件
  ├─ 输出 node_finished.output = { text（累计全文）, model（实际模型名）, usage? }
  └─ 出错：归一为规范文案 → run_failed（不发该节点的 node_finished）
```

**关键点**：`run` 跑的还是**当前草稿**（与阶段 4 一致）；本阶段只把「节点怎么调模型」从桩换成真，**接口与事件协议零改动**。

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 把 `src/index.ts` 编译成 `dist`（`index.js` + `index.d.ts`），把新类型（`LlmNodeData` / `LlmNodeOutput`）发给 NestJS / FastAPI / 前端 | 无报错，`packages/contract/dist/` 出现两个文件 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 顺带验证 NestJS 能读到新类型（可选） | 编译通过 |

> `build:contract` 的定义是 `pnpm --filter @mini-dify/contract build`（见根 `package.json`），最终执行 `tsc -p tsconfig.json`。与阶段 0 · 04 是同一条命令，此处只是「契约变了要重编」。

---

## 5. 完整代码：契约（openapi.yaml）

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: mini-dify API
  version: 0.5.0
  description: >-
    唯一契约（单真源）。NestJS（api-ts）与 FastAPI（api-py）都必须实现本规范，
    并由同一套契约测试校验两者的响应结构、状态码与错误响应体一致。
servers:
  - url: http://localhost:3001
    description: api-ts (NestJS)
  - url: http://localhost:8000
    description: api-py (FastAPI)
paths:
  /health:
    get:
      operationId: getHealth
      summary: 健康检查
      responses:
        "200":
          description: 服务健康
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthResponse"

  /auth/register:
    post:
      operationId: register
      summary: 注册
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/RegisterRequest"
      responses:
        "201":
          description: 注册成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "409":
          $ref: "#/components/responses/Conflict"

  /auth/login:
    post:
      operationId: login
      summary: 登录
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/LoginRequest"
      responses:
        "200":
          description: 登录成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/TokenResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /auth/me:
    get:
      operationId: getCurrentUser
      summary: 当前登录用户
      security:
        - bearerAuth: []
      responses:
        "200":
          description: 当前用户
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /apps:
    get:
      operationId: listApps
      summary: 列出当前用户的应用
      security:
        - bearerAuth: []
      responses:
        "200":
          description: 应用列表
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AppListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
    post:
      operationId: createApp
      summary: 创建应用
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateAppRequest"
      responses:
        "201":
          description: 创建成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AppResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /apps/{id}:
    get:
      operationId: getApp
      summary: 获取应用详情（仅限本人）
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: 应用详情
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AppResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
    patch:
      operationId: updateApp
      summary: 更新应用（仅限本人）
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/UpdateAppRequest"
      responses:
        "200":
          description: 更新成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AppResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
    delete:
      operationId: deleteApp
      summary: 删除应用（仅限本人）
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "204":
          description: 删除成功
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /apps/{id}/graph:
    get:
      operationId: getGraph
      summary: 获取应用画布（草稿）
      description: >-
        返回当前草稿图。若从未保存过（草稿为 null），返回一个合法的空图
        `{"version":"1","nodes":[],"edges":[]}`（读取时不校验，仅 PUT / publish 时才校验）。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: 当前草稿图
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Graph"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
    put:
      operationId: saveGraph
      summary: 保存应用画布（草稿）
      description: 请求体即一份 `Graph`，保存为草稿（可反复编辑）。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Graph"
      responses:
        "200":
          description: 保存成功，返回保存后的草稿图
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Graph"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /apps/{id}/graph/publish:
    post:
      operationId: publishGraph
      summary: 发布应用画布
      description: 把当前草稿快照为已发布图（只读）。校验当前**草稿**，不通过则 400。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: 发布成功
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PublishGraphResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /apps/{id}/graph/published:
    get:
      operationId: getPublishedGraph
      summary: 获取应用已发布画布
      description: 从未发布过时返回 404（message 为 `Graph not published`）。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: 已发布图
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Graph"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /apps/{id}/run:
    post:
      operationId: runApp
      summary: 运行应用（草稿图），返回执行流
      description: >-
        运行当前**草稿**图（`graphJson`），以 `text/event-stream`（SSE）流式返回执行过程。
        运行前先用 `validateGraph` 校验草稿；校验不通过、或草稿为空（`null`）时，
        返回**普通 JSON** 的错误体（HTTP 400），而不是流。
        SSE 事件的种类、payload 与固定顺序见唯一真源 `packages/contract/sse-events.md`。
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/RunRequest"
      responses:
        "200":
          description: SSE 执行流（text/event-stream）
          content:
            text/event-stream:
              schema:
                type: string
                description: >-
                  逐行遵循 `event: <name>\n` + `data: <单行 JSON>\n\n` 的帧格式。
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  responses:
    BadRequest:
      description: 参数校验失败
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    Unauthorized:
      description: 未认证或凭证无效
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    Conflict:
      description: 资源冲突（如邮箱已存在）
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    NotFound:
      description: 资源不存在或不属于当前用户
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"

  schemas:
    HealthResponse:
      type: object
      additionalProperties: false
      required: [status, service, version, time]
      properties:
        status:
          type: string
          enum: [ok]
        service:
          type: string
          description: 服务标识，取值 api-ts 或 api-py
          examples: [api-ts]
        version:
          type: string
          examples: ["0.1.0"]
        time:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。

    RegisterRequest:
      type: object
      additionalProperties: false
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          minLength: 8

    LoginRequest:
      type: object
      additionalProperties: false
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string

    UserResponse:
      type: object
      additionalProperties: false
      required: [id, email, role, createdAt]
      properties:
        id:
          type: string
        email:
          type: string
        role:
          type: string
          enum: [admin, member]
        createdAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。

    TokenResponse:
      type: object
      additionalProperties: false
      required: [accessToken, tokenType, expiresIn, user]
      properties:
        accessToken:
          type: string
        tokenType:
          type: string
          enum: [Bearer]
        expiresIn:
          type: integer
          description: 有效期（秒）
        user:
          $ref: "#/components/schemas/UserResponse"

    AppResponse:
      type: object
      additionalProperties: false
      required: [id, name, mode, ownerId, createdAt, updatedAt]
      properties:
        id:
          type: string
        name:
          type: string
        description:
          type: ["string", "null"]
        mode:
          type: string
          enum: [chatflow, workflow]
        ownerId:
          type: string
        createdAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。
        updatedAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。

    CreateAppRequest:
      type: object
      additionalProperties: false
      required: [name]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 64
        description:
          type: string
          maxLength: 256
        mode:
          type: string
          enum: [chatflow, workflow]

    UpdateAppRequest:
      type: object
      additionalProperties: false
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 64
        description:
          type: string
          maxLength: 256
        mode:
          type: string
          enum: [chatflow, workflow]

    AppListResponse:
      type: object
      additionalProperties: false
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/AppResponse"

    ErrorResponse:
      type: object
      additionalProperties: false
      required: [statusCode, message, error]
      properties:
        statusCode:
          type: integer
          examples: [401]
        message:
          type: string
          examples: [Invalid email or password]
        error:
          type: string
          examples: [Unauthorized]

    NodePosition:
      type: object
      additionalProperties: false
      required: [x, y]
      properties:
        x:
          type: number
        y:
          type: number

    GraphNode:
      type: object
      additionalProperties: false
      required: [id, type, position, data]
      properties:
        id:
          type: string
        type:
          type: string
          enum: [start, end, llm]
        position:
          $ref: "#/components/schemas/NodePosition"
        data:
          type: object
          description: >-
            节点各自的配置（自由结构，由各节点类型自行约定）。
            执行引擎按下列形状解释（见 error-messages.md §4）：
            start → `{ "inputs": [{ "name": string, "type": "string", "required": boolean }] }`；
            llm → `LlmNodeData`（见同文件 components.schemas.LlmNodeData，`model` 为空时回退环境变量 `LLM_MODEL`）；
            end → `{ "outputs": [{ "name": string, "value": string }] }`（`value` 支持模板）。
          additionalProperties: true

    GraphEdge:
      type: object
      additionalProperties: false
      required: [id, source, target]
      properties:
        id:
          type: string
        source:
          type: string
        target:
          type: string
        sourceHandle:
          type: ["string", "null"]
        targetHandle:
          type: ["string", "null"]

    Graph:
      type: object
      additionalProperties: false
      required: [version, nodes, edges]
      properties:
        version:
          type: string
          description: 图结构版本，当前固定为 `"1"`
        nodes:
          type: array
          items:
            $ref: "#/components/schemas/GraphNode"
        edges:
          type: array
          items:
            $ref: "#/components/schemas/GraphEdge"

    PublishGraphResponse:
      type: object
      additionalProperties: false
      required: [publishedAt, graph]
      properties:
        publishedAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。
        graph:
          $ref: "#/components/schemas/Graph"

    RunRequest:
      type: object
      additionalProperties: false
      required: [inputs]
      properties:
        inputs:
          type: object
          additionalProperties: true
          description: 运行输入，键为输入变量名

    LlmNodeData:
      type: object
      additionalProperties: true
      required: [title, model, prompt]
      description: >-
        `llm` 节点的 `data` 形状（引擎按此解释，见 error-messages.md §4）。
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

    RunEvent:
      type: object
      # 仅用于**文档**：SSE 流不是 JSON 响应体，每个事件的真实帧格式见
      # packages/contract/sse-events.md。此处描述事件的种类与 payload 形状。
      additionalProperties: false
      required: [event, data]
      properties:
        event:
          type: string
          enum: [run_started, node_started, token, node_finished, run_finished, run_failed]
          description: 事件名
        data:
          type: object
          additionalProperties: true
          description: 事件 payload（键集合见 packages/contract/sse-events.md）
```

**本阶段新增/修改的部分（与阶段 4 相比）**

| 变更 | 类型 | 说明 |
| --- | --- | --- |
| `LlmNodeData` | schema（**新增**） | `llm` 节点的 `data` 正式形状：`required: [title, model, prompt]` + `system?` / `temperature?` / `maxTokens?`；`additionalProperties: true` |
| `GraphNode.data` 的 `description` | 字段说明 | 把 `llm` 那一行从「内联形状」改为「见 `LlmNodeData`」，并补「`model` 为空时回退 `LLM_MODEL`」 |
| `info.version` → `0.5.0` | — | 契约版本与 `CONTRACT_VERSION` 同步递增 |

**读法要点**：

- **为什么给 `llm.data` 单开一个 schema（而 `start` / `end` 仍是内联形状）**：`llm` 的配置字段明显要**长大**（阶段 5 就多了 3 个），单独抽成 schema 便于逐字段加 `description`，也便于 `src/index.ts` 直接对应一个 `LlmNodeData` 类型。`start` / `end` 字段少，留在 description 里更省。
- **`LlmNodeData` 仍是 `additionalProperties: true`**：理由与阶段 4 §14.3 完全相同——`data` 是**开放式扩展点**（将来还会有 `topP`、`stop`…）。抽成 schema **不等于**锁死结构：契约只**写清约定字段**，额外字段一律忽略。
- **`required: [title, model, prompt]` 但引擎只真读 `model` / `prompt`**：`title` 是画布上给节点起的人类可读名字，图数据里总会有；把它列为 required，是为了让「一份合法的 `llm` 节点」在**结构上**就带全。可选的是 `system?` / `temperature?` / `maxTokens?`——引擎没读到就用 provider 默认。

---

## 6. 完整代码：TS 类型（src/index.ts）

**完整文件路径：`packages/contract/src/index.ts`**

```ts
/**
 * 契约 TS 类型（由 openapi.yaml 派生）。
 *
 * 唯一真源是同仓库根目录下的 `packages/contract/openapi.yaml`；此文件保持与其逐字段一致。
 * 两套后端（NestJS / FastAPI）都必须返回符合本结构的数据。
 */

/** 契约版本；修改契约时递增，并与 openapi.yaml 的 info.version 保持同步。 */
export const CONTRACT_VERSION = '0.5.0'

/** GET /health 的响应体。 */
export interface HealthResponse {
  /** 固定为 'ok' */
  status: 'ok'
  /** 服务标识：api-ts | api-py */
  service: string
  /** 服务版本 */
  version: string
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  time: string
}

/** POST /auth/register 请求体。 */
export interface RegisterRequest {
  email: string
  /** 至少 8 位 */
  password: string
}

/** POST /auth/login 请求体。 */
export interface LoginRequest {
  email: string
  password: string
}

/** 用户对外视图（**绝不包含密码哈希**）。 */
export interface UserResponse {
  id: string
  email: string
  role: 'admin' | 'member'
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  createdAt: string
}

/** POST /auth/login 的响应体。 */
export interface TokenResponse {
  accessToken: string
  tokenType: 'Bearer'
  /** 有效期（秒） */
  expiresIn: number
  user: UserResponse
}

/** 应用对外视图（只暴露契约字段，不含内部实现细节）。 */
export interface AppResponse {
  id: string
  name: string
  /** 空描述统一序列化为 `null` */
  description: string | null
  mode: 'chatflow' | 'workflow'
  /** 归属用户 id */
  ownerId: string
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  createdAt: string
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  updatedAt: string
}

/** POST /apps 请求体。 */
export interface CreateAppRequest {
  /** 1-64 位 */
  name: string
  /** 最多 256 位 */
  description?: string
  mode?: 'chatflow' | 'workflow'
}

/** PATCH /apps/{id} 请求体（字段均可选）。 */
export interface UpdateAppRequest {
  /** 1-64 位 */
  name?: string
  /** 最多 256 位 */
  description?: string
  mode?: 'chatflow' | 'workflow'
}

/** GET /apps 的响应体。 */
export interface AppListResponse {
  items: AppResponse[]
}

/**
 * 统一错误响应体。
 *
 * 两套后端必须产出**同一形状**的错误体：NestJS 默认就是该形状，
 * FastAPI 需要自定义异常处理器把默认的 `{detail}` 归一化过来。
 */
export interface ErrorResponse {
  statusCode: number
  message: string
  error: string
}

/** 画布节点坐标。 */
export interface NodePosition {
  x: number
  y: number
}

/** 画布节点。`data` 为节点各自的配置（自由结构）。 */
export interface GraphNode {
  id: string
  type: 'start' | 'end' | 'llm'
  position: NodePosition
  data: Record<string, unknown>
}

/** 画布连线。 */
export interface GraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/** 画布图（草稿与已发布共用同一结构）。 */
export interface Graph {
  /** 图结构版本，当前固定为 `"1"` */
  version: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** POST /apps/{id}/graph/publish 的响应体。 */
export interface PublishGraphResponse {
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  publishedAt: string
  graph: Graph
}

/** 节点类型别名（便于执行引擎引用）。 */
export type GraphNodeType = GraphNode['type']

/** `start` 节点的 `data` 形状（引擎按此解释，见 error-messages.md §4）。 */
export interface StartNodeData {
  inputs: Array<{ name: string; type: 'string'; required: boolean }>
}

/** `llm` 节点的 `data` 形状（见 openapi.yaml `LlmNodeData`）。 */
export interface LlmNodeData {
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

/** `llm` 节点输出形状（`node_finished.output`）：provider 未给 usage 时省略 `usage`。 */
export interface LlmNodeOutput {
  text: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** `end` 节点的 `data` 形状。`value` 支持 `{{ path }}` 模板。 */
export interface EndNodeData {
  outputs: Array<{ name: string; value: string }>
}

/** POST /apps/{id}/run 的请求体。 */
export interface RunRequest {
  /** 运行输入，键为输入变量名 */
  inputs: Record<string, unknown>
}

/**
 * SSE 事件协议（唯一真源：`packages/contract/sse-events.md`）。
 *
 * 帧格式固定为 `event: <name>\n` + `data: <单行 JSON>\n\n`。
 * 下列类型描述各事件的 payload 形状，供两端执行引擎与前端消费方使用。
 */
export type RunEventName =
  | 'run_started'
  | 'node_started'
  | 'token'
  | 'node_finished'
  | 'run_finished'
  | 'run_failed'

export interface RunStartedData {
  runId: string
  appId: string
}

export interface NodeStartedData {
  nodeId: string
  nodeType: GraphNodeType
}

export interface TokenData {
  nodeId: string
  text: string
}

export interface NodeFinishedData {
  nodeId: string
  nodeType: GraphNodeType
  output: Record<string, unknown>
}

export interface RunFinishedData {
  runId: string
  outputs: Record<string, unknown>
  elapsedMs: number
}

export interface RunFailedData {
  runId: string
  nodeId: string | null
  message: string
}

/** 单个 SSE 事件的逻辑表示（`event` + `data`），帧序列化由两端分别完成。 */
export interface RunEvent {
  event: RunEventName
  data:
    | RunStartedData
    | NodeStartedData
    | TokenData
    | NodeFinishedData
    | RunFinishedData
    | RunFailedData
}
```

**本阶段新增/修改的类型**

| 类型 | 变更 | 关键点 |
| --- | --- | --- |
| `LlmNodeData` | 改 | 阶段 4 只有 `{ title; model; prompt }`；本阶段补 `system?` / `temperature?` / `maxTokens?`（**可选**），并注明 `model` 为空回退 `LLM_MODEL` |
| `LlmNodeOutput` | **新增** | `{ text; model; usage? }`；`node_finished.output` 中 `llm` 节点的形状（`usage` 可选，见 §11） |
| `CONTRACT_VERSION` | 改 | 由 `'0.4.0'` 改为 `'0.5.0'` |

> `LlmNodeOutput` 与 `NodeFinishedData.output`（`Record<string, unknown>`）的关系：事件里的 `output` **类型上仍是开放对象**（不要把事件协议锁死到某一种节点），而 `LlmNodeOutput` 是**给实现方和消费方看的精确形状**——`02` 篇两端引擎都按它构造 `llm` 的输出。这与阶段 4「`RunEvent` 仅作文档」是同一种「精确形状另立类型、事件壳保持开放」的做法。

---

## 7. 完整代码：SSE 事件协议唯一真源（sse-events.md）

**完整文件路径：`packages/contract/sse-events.md`**

````markdown
# SSE 事件协议（唯一真源）

`POST /apps/{id}/run` 以 `text/event-stream`（SSE）返回执行过程。
两套后端（`apps/api-ts` 与 `apps/api-py`）必须产出**逐字节相同**的帧格式与**完全一致**的
事件序列（事件名 + `nodeId` + payload 键集合）。本文档是事件协议的唯一真源，
修改事件或顺序时，必须同步更新本文件与两端实现。

> 注意：本接口只有在**通过运行前校验**后才返回 SSE 流。
> 校验失败（草稿为空、图不合法、节点数据形状非法）时返回**普通 JSON** 400
> （见 `error-messages.md`），**不返回流**；未认证 401、归属不符 404 亦同。

## 1. 帧格式（固定）

每个事件一个帧，格式**逐字节固定**为：

```
event: <name>\n
data: <单行 JSON>\n\n
```

- `event:` 行在前，`data:` 行在后，两行之间以单个 `\n` 分隔，帧以空行（`\n\n` 的第二个 `\n`）结束。
- `<name>` 为事件名（见下表）。
- `<单行 JSON>` 为 payload 的 JSON 序列化，**必须是单行**（不含换行）。
  键的顺序为实现细节，不要求两端一致；两端以「**解析后的 JSON 相等**」为准比对。

## 2. 事件类型与 payload

| 事件 | 触发时机 | payload 键 |
| --- | --- | --- |
| `run_started` | 流开始、编译/执行之前 | `runId`(string)、`appId`(string) |
| `node_started` | 某节点开始执行 | `nodeId`(string)、`nodeType`("start"\|"end"\|"llm") |
| `token` | `llm` 节点流式产出一片文本（provider 的真实流式片段） | `nodeId`(string)、`text`(string) |
| `node_finished` | 某节点执行结束 | `nodeId`(string)、`nodeType`(...)、`output`(object) |
| `run_finished` | 整图执行成功结束 | `runId`(string)、`outputs`(object)、`elapsedMs`(number) |
| `run_failed` | 执行中途出错并终止 | `runId`(string)、`nodeId`(string \| null)、`message`(string) |

`node_started` / `node_finished` 的 `nodeType` 取值为 `start` / `end` / `llm`。

## 3. 事件顺序（固定）

```
run_started
  （对每个按拓扑序执行的节点，依次：）
    node_started
    （仅 llm 节点：若干 token）
    node_finished
run_finished
```

- 节点按**拓扑序**执行，每个节点执行**一次**；从 `start` 节点出发，仅执行可达节点。
- 若中途出错：已发出的帧保持原样，随后追加一帧 `run_failed`（`nodeId` 为出错节点，
  无法归属节点时为 `null`），**不再**发 `run_finished`，流随即结束。

## 4. 引擎语义（两端必须一致）

以下语义由 `apps/api-ts/src/engine` 与 `apps/api-py/app/engine` 共同实现。

- **变量池 `pool`**：初始为 `{ "inputs": <RunRequest.inputs> }`；每个节点执行完成后，
  把自身输出写入 `pool[<nodeId>]`。
- **模板解析**：字符串中形如 `{{ a.b }}`（花括号内允许空格）的片段，按**点路径**从
  `pool` 取值并替换；取值失败抛错，走 `run_failed`，`message` 为
  `template variable not found: {path}`。
- **`start`**：按 `start.data.inputs` 逐条校验 `RunRequest.inputs`（`required` 为真且缺失
  则报错，`message` 为 `missing required input: {name}`）；输出为 `{ "inputs": {...} }`。
- **`llm`**（阶段 5 起为**真实模型调用**）：把 `data.prompt` 用池渲染后作为 user 消息
  （若 `data.system` 非空，另加一条 system 消息），调用 LangChain `ChatOpenAI`。
  - **模型**：`data.model` 非空则用它，否则回退环境变量 `LLM_MODEL`。
  - **流式**：逐 chunk 取 `chunk.content`（字符串化后）**立即**发出 `token` 事件
    （`text` 为 **provider 的真实流式片段**，不再按固定码点数切分）。两端同一 provider、
    同一请求下应得到**逐字节相同**的 `token` 文本序列。
  - **节点输出** `node_finished.output` 为 `{ "text": string, "model": string, "usage"?: object }`：
    `text` 为累计全文，`model` 为实际使用的模型名；`usage` 为
    `{ "promptTokens": number, "completionTokens": number, "totalTokens": number }`，
    **provider 未返回 usage 时省略 `usage` 字段**（两端行为一致）。
  - **错误**：任何 LLM 调用错误都映射为规范文案后走 `run_failed`（见 `error-messages.md` §5），
    **不**透出库的原始 message，也**不**发该节点的 `node_finished`。
- **`end`**：把 `data.outputs[].value` 逐条渲染，得到 `{ name: 渲染值 }`，作为
  `run_finished` 的 `outputs`。若被执行了多个 `end` 节点，取**拓扑序最后一个**的输出。
- **事件产生方式**：`node_started` / `token` / `node_finished` 由各节点在执行过程中发出；
  `run_started` 于执行前发出，`run_finished` / `run_failed` 于执行结束后发出。
````

**本阶段改动（与阶段 4 相比）**

| 变更 | 说明 |
| --- | --- |
| §2 `token` 行 | 由「`llm` 节点流式产出一片文本」改为「（**provider 的真实流式片段**）」 |
| §4 `llm` 段 | 整段重写：从「本阶段为**桩**，每 8 码点切一片」改为「阶段 5 起为**真实模型调用**」，并补 `model` 回退、真实流式、`usage` 可选、错误走 `run_failed` 且不发 `node_finished` |

> 注意：**页眉那句「阶段 5 换真模型，协议不变」在这里兑现**——`sse-events.md` 改的是 `llm` 的**语义描述**（片从哪来、输出多两个键），**帧格式、6 种事件、事件顺序一个字没动**。所以前端消费方（`04-执行引擎/06-前端SSE客户端与运行面板.md`）**完全不用改**。

---

## 8. 完整代码：错误文案目录（error-messages.md）

**完整文件路径：`packages/contract/error-messages.md`**

````markdown
# 错误文案目录（唯一真源）

两套后端（`apps/api-ts` 与 `apps/api-py`）对**同一组**非法请求必须返回**逐字节相同**的
`{ statusCode, message, error }`。本文档是 `message` 文案的唯一真源，
修改校验规则或域错误文案时，必须同步更新本文件与两端实现。

## 1. 请求校验错误（HTTP 400）

`statusCode` 固定为 `400`，`error` 固定为 `Bad Request`。

### 1.1 单条规则

| 规则 | 触发条件（契约） | 文案模板 |
| --- | --- | --- |
| `required` | 必填字段缺失 | `{field} is required` |
| `email` | `format: email` 校验失败 | `{field} must be a valid email` |
| `minLength(N)` | 字符串短于最小长度 N | `{field} must be at least {N} characters` |
| `maxLength(N)` | 字符串长于最大长度 N | `{field} must be at most {N} characters` |
| `enum(a, b)` | 取值不在枚举 `[a, b]` 内 | `{field} must be one of: a, b` |
| `unknown` | 出现契约未声明的额外字段（`additionalProperties: false`） | `{field} should not exist` |

`{field}` 一律用**契约里的字段名**（camelCase，如 `email`、`password`、`name`、`description`、`mode`）。
`{N}` 为契约中声明的整数长度。

> 注：`email` 规则的**接受/拒绝集合**两端已对齐 —— 接受 `a@b.c`（单字符 TLD），
> 拒绝 `a@b`（域名不含点）。api-ts 用自定义 `IsEmailFormat`（见
> `apps/api-ts/src/common/is-email.decorator.ts`）对齐 Python 的 `EmailStr`。

### 1.2 多条错误的组装

- 按**字段在请求模型中的声明顺序**排列；
- 同一字段内按上表**规则顺序**排列；
- 各条之间用 `"; "`（分号 + 空格）连接成一个字符串，作为 `message`。

例：

```json
{"statusCode":400,"message":"email must be a valid email; password is required","error":"Bad Request"}
```

### 1.3 两端实现位置

- api-ts：`apps/api-ts/src/common/validation-exception-factory.ts`（`ValidationPipe` 的 `exceptionFactory`），
  由 `apps/api-ts/src/main.ts` 注入；最终由 `apps/api-ts/src/common/http-error.filter.ts` 包成 `ErrorResponse`。
- api-py：`apps/api-py/app/errors.py` 的 `RequestValidationError` 处理器。

## 2. 域错误文案（手写）

`statusCode` 与 `error` 由状态码决定（见下表），`message` 由业务逻辑显式给定。

| 场景 | statusCode | error | message |
| --- | --- | --- | --- |
| 注册时邮箱已存在 | `409` | `Conflict` | `Email already registered` |
| 登录凭据错误 | `401` | `Unauthorized` | `Invalid email or password` |
| 缺失 Bearer 令牌 | `401` | `Unauthorized` | `Missing bearer token` |
| 令牌无效或过期 | `401` | `Unauthorized` | `Invalid or expired token` |
| 令牌有效但用户已不存在 | `401` | `Unauthorized` | `User no longer exists` |
| 应用不存在或不属于当前用户 | `404` | `Not Found` | `App not found` |
| 应用画布从未发布过 | `404` | `Not Found` | `Graph not published` |

实现位置：

- api-ts：`AuthService`、`JwtAuthGuard`、`AppsService`、`GraphService`（抛出 `HttpException`），由 `HttpErrorFilter` 统一包装。
- api-py：`app/api/auth.py`、`app/api/deps.py`、`app/api/apps.py`、`app/api/graph.py`（抛出 `HTTPException`），由 `app/errors.py` 统一包装。

## 3. 图校验错误（HTTP 400）

`PUT /apps/{id}/graph` 与 `POST /apps/{id}/graph/publish` 在通过请求体结构校验后，
还要用纯函数 `validateGraph` 做**语义校验**；不通过则返回 `400`，
`statusCode` 固定 `400`、`error` 固定 `Bad Request`。

校验规则（**按下列顺序**，多条错误用 `"; "` 连接成一个 `message`）：

| 序 | 规则 | 触发条件 | 文案模板 |
| --- | --- | --- | --- |
| 1 | version | `version !== "1"` | `graph version must be 1` |
| 2 | 节点 id 唯一 | 存在重复的节点 id | `node id must be unique: {id}` |
| 3 | 恰好一个 start | `start` 节点数 ≠ 1 | `graph must contain exactly one start node` |
| 4 | 至少一个 end | `end` 节点数为 0 | `graph must contain at least one end node` |
| 5 | 边 id 唯一 | 存在重复的边 id | `edge id must be unique: {id}` |
| 6 | 边端点存在 | 边的 `source`/`target` 指向不存在的节点 | `edge {edgeId} references unknown node: {nodeId}` |
| 7 | 禁止自环 | 边的 `source === target` | `edge {edgeId} must not connect a node to itself` |

组装细则（两端必须一致）：

- 规则按上表顺序逐条执行：先扫完规则 1，再扫规则 2，依此类推；同一条规则内部按数组顺序。
- 规则 2 / 5：按数组顺序遍历，**每个重复的 id 只报一次**（首次检测到重复时报告）。
- 规则 6：按边的数组顺序，先检查 `source` 再检查 `target`；某端指向未知节点时各报一条。
- 规则 7：按边的数组顺序。

例（`version` 为 `"2"` 且无 `start` 节点）：

```json
{"statusCode":400,"message":"graph version must be 1; graph must contain exactly one start node","error":"Bad Request"}
```

实现位置：

- api-ts：`apps/api-ts/src/graph/graph.validator.ts` 的 `validateGraph`。
- api-py：`apps/api-py/app/graph/validator.py` 的 `validate_graph`。

> 注：「草稿为 `null`」只表示**尚未编辑**，此时 `GET /apps/{id}/graph` 返回合法的空图
> `{"version":"1","nodes":[],"edges":[]}`，**不做**上述校验；只有 `PUT` / `publish` 才校验。

## 4. 执行引擎文案（`POST /apps/{id}/run`）

### 4.1 运行前预检错误（HTTP 400，**普通 JSON**，不是 SSE 流）

`statusCode` 固定 `400`、`error` 固定 `Bad Request`。`message` 由下列文案用 `"; "` 连接：

组装顺序：先跑 §3 的图校验（保持其内部顺序），再跑下表的节点数据校验
（按 `nodes` 数组顺序，同一节点内按下表顺序）。

| 序 | 规则 | 触发条件 | 文案模板 |
| --- | --- | --- | --- |
| 4.1.1 | 草稿为空 | 运行前草稿（`graphJson`）为 `null` | `Graph is empty` |
| 4.1.2 | 图校验 | 见 §3（`validateGraph` / `validate_graph`） | 同 §3 |
| 4.1.3 | start 数据 | `start.data.inputs` 不是数组 | `start node {id} inputs must be an array` |
| 4.1.4 | start 数据 | 某个输入项缺字符串 `name` | `start node {id} input must have a name` |
| 4.1.5 | llm 数据 | `llm.data.prompt` 不是字符串 | `llm node {id} prompt must be a string` |
| 4.1.6 | end 数据 | `end.data.outputs` 不是数组 | `end node {id} outputs must be an array` |
| 4.1.7 | end 数据 | 某个输出项缺字符串 `name` | `end node {id} output must have a name` |
| 4.1.8 | end 数据 | 某个输出项缺字符串 `value` | `end node {id} output must have a value` |

注：`4.1.1` 单独出现（草稿为空即短路，不再跑其它规则）；`4.1.2` 与 `4.1.3`~`4.1.8`
同时命中时合并为一条 `message`。节点数据校验只针对**契约已声明的字段形状**，
`data` 里的额外字段一律忽略（契约中 `data` 为自由结构）。

### 4.2 执行中错误（SSE 流内的 `run_failed` 事件）

不改变 HTTP 状态码（已是 `200` 流），错误经 `run_failed` 事件的 `message` 传出
（事件协议见 `sse-events.md`）：

| 场景 | 触发条件 | `message` |
| --- | --- | --- |
| 缺必填输入 | `start` 声明的必填输入在 `RunRequest.inputs` 中缺失 | `missing required input: {name}` |
| 模板取值失败 | 模板点路径在变量池 `pool` 中不存在 | `template variable not found: {path}` |

实现位置：

- api-ts：`apps/api-ts/src/engine`（`engine.service.ts` 预检、`nodes/` 与 `template.ts` 执行）。
- api-py：`apps/api-py/app/engine`（`engine.py` 预检、`nodes/` 与 `template.py` 执行）。

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
````

**本阶段新增**：`## 5. LLM 错误` 整节（6 条规范文案 + 「不透出库原始 message」原则）。

---

## 9. 完整代码：两端 .env.example

**完整文件路径：`apps/api-ts/.env.example`**

```bash
# api-ts 环境变量样例（复制为 .env 后使用）
# 注意：Prisma 使用 postgresql:// 方案，不带 SQLAlchemy 的 +driver 后缀
DATABASE_URL="postgresql://postgres:difyai123456@localhost:5432/minidify"
# 与 apps/api-py/.env 同值：双方签发的 JWT 才能互认
JWT_SECRET="dev-jwt-secret-change-me-please"
# 令牌有效期（秒）；两端读同一个键
JWT_EXPIRES_IN=3600
PORT=3001
# LLM（阶段 5）：OpenAI 兼容 provider；两端读同一组键（api-py 的 .env 同值）
# 本地无密钥自测：把 BASE_URL 指到 `node tools/mock-llm/server.mjs`（默认 http://127.0.0.1:11435/v1），API_KEY 随意填非空
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
# 单次 LLM 请求超时（毫秒）
LLM_TIMEOUT_MS=60000
```

**完整文件路径：`apps/api-py/.env.example`**

```bash
# api-py 环境变量样例（复制为 .env 后使用）
# 注意：SQLAlchemy 连接串带 +psycopg 驱动后缀
DATABASE_URL=postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify
# 与 apps/api-ts/.env 同值：双方签发的 JWT 才能互认
JWT_SECRET=dev-jwt-secret-change-me-please
# 令牌有效期（秒）；两端读同一个键
JWT_EXPIRES_IN=3600
PORT=8000
# LLM（阶段 5）：OpenAI 兼容 provider；两端读同一组键（api-ts 的 .env 同值）
# 本地无密钥自测：把 BASE_URL 指到 `node tools/mock-llm/server.mjs`（默认 http://127.0.0.1:11435/v1），API_KEY 随意填非空
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
# 单次 LLM 请求超时（毫秒）
LLM_TIMEOUT_MS=60000
```

**本阶段新增的四个键**

| 键 | 含义 | 例 |
| --- | --- | --- |
| `LLM_BASE_URL` | provider 的 OpenAI 兼容端点（**`base_url` 的威力**见 §12） | `https://api.openai.com/v1` |
| `LLM_API_KEY` | 密钥（**样例里留空**；真实值只在本机 `.env`） | `sk-...` |
| `LLM_MODEL` | **全局默认模型**（节点 `data.model` 为空时用它） | `gpt-4o-mini` |
| `LLM_TIMEOUT_MS` | 单次请求超时（**毫秒**） | `60000` |

> Python 侧的 `config.py` 用 `pydantic-settings` 把这四个键读成带类型字段（`llm_base_url` / `llm_api_key` / `llm_model` / `llm_timeout_ms`，见 §12.4），TS 侧直接 `process.env.LLM_*` 读。

---

## 10. 【技术教学 · 首次】`LlmNodeData` 的形状正式化：节点级配置 vs 全局默认

阶段 4 §14 已经讲过「**节点数据形状正式化**」这件事本身（`GraphNode.data` 是唯一放开字段，用 description 约定形状、引擎按约定读取）。这里**不重讲**那套原则，只讲阶段 5 新增的两点：**`llm.data` 抽成独立 schema**，以及 **`model` 为空回退环境变量**。

### 10.1 `LlmNodeData` 的字段与「谁是必填、谁是可选」

```yaml
LlmNodeData:
  type: object
  additionalProperties: true
  required: [title, model, prompt]
  properties:
    title:       { type: string }
    model:       { type: string }                    # 为空字符串时回退 LLM_MODEL
    prompt:      { type: string }                    # 支持 {{ path }} 模板
    system:      { type: string }                    # 可选
    temperature: { type: number }                    # 可选
    maxTokens:   { type: integer }                   # 可选
```

```ts
export interface LlmNodeData {
  title: string
  model: string
  prompt: string
  system?: string
  temperature?: number
  maxTokens?: number
}
```

对照阶段 4 的 `LlmNodeData`（当时只有 `{ title; model; prompt }`，且 `model` **不参与执行**，见 `04-执行引擎/01` §6 / §14.1）：本阶段 `model` 变成**真用**的字段，并新增三个**可选**调参字段。

**为什么 `temperature` / `maxTokens` 是可选而非必填**（一条通用规则）：**「引擎没读到就该走 provider 默认」的字段，标可选**。若把 `temperature` 写成必填，那每份图都必须显式写温度——用户只想用 provider 默认时反而被迫编一个值。这与 §11 讲的「`usage` 可选」是同一条契约设计原则：**能保证的才 required，不能/不必保证的标 optional**。

**为什么 `title` 仍 required**：它是画布节点的人类可读名（`03-画布/06-ReactFlow画布.md` 里每个节点都会带），图数据里总是有；列为 required 只是保证「结构完整的 `llm` 节点」在形状上就带全，引擎其实**不读**它。

### 10.2 `model` 为空 → 回退环境变量 `LLM_MODEL`：**节点级 vs 全局默认**

这是本篇的第一个「设计模式」教学点。规则一句话：

```
实际模型名 = data.model 非空 ? data.model : 环境变量 LLM_MODEL
```

- **节点级**：`llm.data.model`（画布上这个节点自己指定的模型）——填了就**优先**用它；
- **全局默认**：环境变量 `LLM_MODEL`——节点**留空**时兜底。

**为什么要这样分层**（而不是「到处都得写模型名」）：

| 只有全局默认 | 只有节点级 | 本项目（节点级 + 全局默认） |
| --- | --- | --- |
| 想给某个节点单独换模型，只能改环境变量（牵连所有节点） | 每个节点都必须写模型名，忘了就报错 | **默认走全局**（省事），**个别节点**想特殊就填 `data.model`（灵活） |

这与本项目**一以贯之的「局部覆盖默认」模式**完全同构——回顾：

| 阶段 | 「默认」 | 「局部覆盖」 |
| --- | --- | --- |
| 阶段 3 | 草稿（draft）随时可改 | 发布（published）是草稿的**只读快照**（见 `03-画布/02-Prisma-JSONB与两态.md`） |
| 阶段 5 | 环境变量 `LLM_MODEL`（全局默认模型） | 节点 `data.model`（该节点覆盖） |

> 一句话：**全局默认负责「开箱即用」，节点级配置负责「个别特例」。** 把默认放在环境变量（部署环境可变、不进仓库），把特例放在图数据（用户在图里编辑），各就各位。这条「局部覆盖默认」的思路，和阶段 3 的「草稿覆盖发布快照」是同一个脑子想出来的。

### 10.3 为什么 `LlmNodeData` 抽成 schema 却仍 `additionalProperties: true`

抽成 schema **是为把每个字段的 `description` 写清楚**（`system` / `temperature` / `maxTokens` 各自什么含义），不是为锁死结构。理由与阶段 4 §14.3 一致：`data` 是**开放式扩展点**，将来还会加 `topP` / `stop` / `seed`… 锁成 `additionalProperties: false` 就会「**每加一个配置字段都要改契约**」。正确做法仍是：**契约写清约定字段、放开额外字段、引擎只校验约定字段**（本阶段引擎只对 `prompt` 做形状校验，见 `error-messages.md` §4.1.5）。

---

## 11. 【技术教学 · 首次】`llm` 输出 `{ text, model, usage? }`：为什么 `usage` 是可选的

### 11.1 输出形状

```ts
/** llm 节点输出形状（node_finished.output）：provider 未给 usage 时省略 usage。 */
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

- `text`：**累计全文**（所有流式片段拼起来）；
- `model`：**实际使用的模型名**（回退后的那个，不是 `data.model` 原值）；
- `usage`：**可选**，用 provider 返回的 token 用量。

它在事件流里出现在 `node_finished(llm)` 的 `output`：

```
event: node_finished
data: {"nodeId":"llm_1","nodeType":"llm","output":{"text":"echo: Hello mini-dify","model":"mock-model","usage":{"promptTokens":15,"completionTokens":21,"totalTokens":36}}}
```

### 11.2 为什么 `usage` 是**可选**的

**背景**：`usage`（token 用量）由 **provider** 决定给不给。同一个 LangChain `ChatOpenAI`，指向不同 provider 时表现不同：

| provider 情形 | `usage_metadata` | 我们的输出 |
| --- | --- | --- |
| 返回 usage（OpenAI、多数兼容实现） | 有 | `output.usage = {...}` |
| 流式时不返回 usage（部分本地 / 自建实现） | 无 | **省略** `output.usage` |

**如果 `usage` 写成必填会怎样**：某 provider 不给用量时，实现方要么**伪造**一个假数字（在契约里撒谎），要么**抛错**（本来能跑好的请求被契约逼崩）。两者都糟。

**所以契约写 `usage?`**——它诚实表达了「**并非所有实现都能保证提供这个字段**」：给了就带上，没给就没有，**两端行为一致**（都遵循「有则带、无则省」）。消费方（如前端展示 token 数）必须**先判空**再读。

### 11.3 「可选字段」在跨实现契约里的通用意义

把 §11.2 拔高成一条**通用契约设计原则**（这是本篇要你记住的）：

| | `required` 字段 | **可选**（`?`）字段 |
| --- | --- | --- |
| 语义 | **每一个**实现都保证提供 | **并非每个**实现/每次调用都能提供 |
| 消费方 | 直接读 | 必须**判空** |
| 误用后果 | —— | 若强行 required，实现被迫「伪造数据」或「抛错」 |
| 本项目例 | `text` / `model`（一定算得出来） | `usage?`（看 provider） |

> 与阶段 2 的「`AppResponse.description` 可为 `null`」是同一类思路：**契约要如实描述「哪些字段可能缺席」**，而不是把所有字段都写成「一定有」。一句口诀：**能保证的 required，不能保证的 optional。**

### 11.4 键序与「解析后相等」

`sse-events.md` §1 已规定：payload 的**键顺序不要求两端一致**，以「**解析后的 JSON 相等**」为准比对。所以 `usage` 的键顺序（`promptTokens` / `completionTokens` / `totalTokens`）两端各写各的没关系——只要解析出来 `usage.totalTokens === 36` 等值相等即可（阶段 4 §1 已讲）。

---

## 12. 【技术教学 · 首次】LLM 配置放环境变量，以及「OpenAI 兼容」协议的威力

### 12.1 四个环境变量各是什么

| 键 | 类型 | 作用 | 默认（样例 / `config.py`） |
| --- | --- | --- | --- |
| `LLM_BASE_URL` | string | provider 的 **OpenAI 兼容端点**：`…/v1` | `https://api.openai.com/v1` |
| `LLM_API_KEY` | string | 密钥；**为空即视为未配置**（见 §12.5） | `""`（空） |
| `LLM_MODEL` | string | **全局默认模型**（节点 `data.model` 为空时用它） | `gpt-4o-mini` |
| `LLM_TIMEOUT_MS` | int | 单次请求超时（**毫秒**） | `60000` |

**为什么这些是「环境变量」而不是「图数据 / 代码常量」**：

| 放环境变量 | 放图数据 / 代码 |
| --- | --- |
| 密钥、端点随**部署环境**变（本机、CI、生产各不同）——环境变量天生为此 | 密钥若写进图数据或代码，会跟着仓库泄露 |
| 与阶段 0 · 06 学的「`pydantic-settings` 把环境变量读成带类型配置」同一套机制 | 改环境就能换模型，**不碰代码、不碰图** |

### 12.2 为什么用「OpenAI 兼容」协议

问题：世界上的 LLM provider 那么多（OpenAI、DeepSeek、阿里通义、智谱、本地 Ollama…），**难道每家写一套调用代码？**

**答案：不。** 因为绝大多数 provider 都提供一套 **OpenAI 兼容（OpenAI-compatible）** 的 HTTP 接口，形如：

```
POST {base_url}/chat/completions
Authorization: Bearer {api_key}
{ "model": "...", "messages": [...], "stream": true }
```

只要一个客户端会讲这套「OpenAI 方言」，就能连**任何**支持它的 provider——**只改 `base_url`（和 key、model）**。

### 12.3 `base_url` 的威力：一份代码，N 个 provider

```
                     ┌──────────────────────────────┐
LangChain            │  ChatOpenAI(base_url=…)      │
ChatOpenAI  ────────▶│  讲的都是「OpenAI 方言」      │
（同一份代码）        └──────────────┬───────────────┘
                                    │ 只换 base_url / api_key / model
        ┌───────────────┬───────────┼───────────┬──────────────┐
        ▼               ▼           ▼           ▼              ▼
   OpenAI           DeepSeek     阿里 DashScope  本地 Ollama   我们的 mock
 api.openai.com/v1  api.deepseek.com/v1  …      http://localhost:11434/v1   127.0.0.1:11435/v1
```

| provider | `LLM_BASE_URL` 例 |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 阿里通义（兼容模式） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 本地 Ollama | `http://localhost:11434/v1` |
| 本项目自测 mock | `http://127.0.0.1:11435/v1` |

> 这正是本阶段能**用同一个 mock 服务验两端**的根：mock（`tools/mock-llm/server.mjs`）实现的就是这个 OpenAI 兼容端点（见 `05-LLM节点/02-真实模型调用与流式.md`）。**换 provider 只改 `LLM_BASE_URL` 一行**——这就是「OpenAI 兼容」最实用的收益。

### 12.4 Python 侧怎么读这四个键（`pydantic-settings`）

**完整文件路径：`apps/api-py/app/config.py`**（本阶段新增 4 行 `llm_*`）

```python
"""应用配置（pydantic-settings）。

环境变量名大小写不敏感：`database_url` 对应 `DATABASE_URL`。
`access_token_expires_in` 由 `JWT_EXPIRES_IN`（秒）读取，默认 3600。
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# 本项目目录（apps/api-py）：无论从哪个 cwd 启动，都读这一份 .env
_PROJECT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_PROJECT_DIR / ".env", extra="ignore")

    service_name: str = "api-py"
    version: str = "0.1.0"
    database_url: str = "postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify"
    # 与 TS 侧保持同一密钥，双方签发的 JWT 才能互认（见总纲 §5.6）
    jwt_secret: str = "dev-jwt-secret-change-me-please"
    # 令牌有效期（秒）：读同一个 JWT_EXPIRES_IN，默认 3600
    access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")
    # LLM（阶段 5）：OpenAI 兼容 provider，与 api-ts 共读同一组键
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_timeout_ms: int = 60000


settings = Settings()
```

**读法要点**：

- `pydantic-settings` 把环境变量名**大小写不敏感**地映射到字段：`llm_base_url` ↔ `LLM_BASE_URL`、`llm_timeout_ms` ↔ `LLM_TIMEOUT_MS`（这套机制阶段 0 · 06 已教，此处只是**加字段**）。
- `extra="ignore"`：`.env` 里有 Python 不认识的键（如 `LLM_*` 之外的应用变量）也不报错。
- **TS 侧对照**：TS 无 `pydantic-settings` 这类层，直接 `process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1'` 读（见 `02` 篇的 `llm.node.ts`）——两边**读同一组键名**，因此**值一致**。

### 12.5 「未配置密钥」是怎样被识别的

规则（两端一致）：**`LLM_API_KEY` 为空（空串）即视为「未配置」**，`llm` 节点在真正发请求**之前**就抛 `RunError('llm provider not configured: LLM_API_KEY')`（TS 侧 `apiKey === ''`；Python 侧 `not api_key`）。这条文案登记在 `error-messages.md` §5。**它不消耗任何网络时间**——空 key 立刻失败，这与「provider 网不通」是两码事。

---

## 13. 【技术教学 · 首次】为什么密钥不进仓库

### 13.1 现象与做法

- **`.env` 已被 `.gitignore` 忽略**：本机真实密钥写在 `apps/api-ts/.env` / `apps/api-py/.env`（**不进 Git**）。
- **`.env.example` 里 `LLM_API_KEY=` 留空**：只示范「**有哪些键、什么格式**」，**不填真值**。别人 clone 后 `cp .env.example .env` 再自己填。
- **`.env.example` 里的 `LLM_BASE_URL` 可给默认值**（`https://api.openai.com/v1`）——因为**端点不是秘密**；`LLM_MODEL` 同理（`gpt-4o-mini` 是公开名字）。

### 13.2 为什么

| 若密钥进仓库 | 若密钥只在本地 `.env` |
| --- | --- |
| Git 历史里永久留存，泄露后**无法真正删除**（要改写历史） | 每位开发者各自持有，不进版本库 |
| CI / 他人 clone 后能直接用你的账号额度 | CI 通过 **secret** 注入，权限最小化 |
| 契约/样例面向所有人可见，密钥就暴露给所有人 | `.env.example` 只暴露**结构**不暴露**值** |

**判据一句话**：**「值是否因部署环境而异、且泄露有代价」→ 放环境变量、不进仓库；「只是结构/格式」→ 进 `.env.example`。** 本项目从阶段 0（`DATABASE_URL` / `JWT_SECRET`）起就是这个规矩，阶段 5 的 `LLM_API_KEY` 只是**又一项**照办。

> 顺带：README / 契约 / 图数据里**绝不放密钥**。图数据里的 `llm.data` 只有 `model` / `prompt` / 参数，**没有** `api_key` 字段（见 §10.1）——这正是「密钥归环境、配置归图」的边界。

---

## 14. 编译并验证

**命令（在仓库根执行）**

```bash
pnpm run build:contract
```

**目的**：把 `src/index.ts` 编译成 `dist/index.js`（运行时代码）+ `dist/index.d.ts`（类型声明），把新类型（`LlmNodeData` / `LlmNodeOutput`）发给 NestJS / FastAPI / 前端。

**预期输出**

```
$ pnpm --filter @mini-dify/contract build
$ tsc -p tsconfig.json
```

**验证产物存在**

```bash
ls packages/contract/dist
# index.d.ts  index.js
```

---

## 15. 验收自测

| 检查项 | 命令 / 做法 | 预期 |
| --- | --- | --- |
| 契约可编译 | `pnpm run build:contract` | 无报错 |
| 产物齐全 | `ls packages/contract/dist` | 同时有 `index.js` 与 `index.d.ts` |
| 版本已升 | 看 `openapi.yaml#/info/version` 与 `src/index.ts#CONTRACT_VERSION` | 二者均为 `0.5.0` |
| `LlmNodeData` 已建 | 阅读 `openapi.yaml#/components/schemas/LlmNodeData` | `required: [title, model, prompt]`；含 `system` / `temperature` / `maxTokens`；`model` 描述含「为空回退 `LLM_MODEL`」 |
| `GraphNode.data` 已改引 | 看 `GraphNode.data` 的 description | `llm` 一行写着「见同文件 `components.schemas.LlmNodeData`」 |
| TS `LlmNodeData` 同步 | 阅读 `src/index.ts` | 有 `system?` / `temperature?` / `maxTokens?`；注释含「为空字符串时回退到环境变量 `LLM_MODEL`」 |
| 输出形状已建 | 阅读 `src/index.ts` | 有 `LlmNodeOutput`（`usage?` 可选） |
| `sse-events.md` 已更新 | 看 §2 `token` 行与 §4 `llm` 段 | `token` 写「provider 的真实流式片段」；`llm` 段写「阶段 5 起为真实模型调用」、`usage` 可选、错误走 `run_failed` |
| `error-messages.md` 已补 | 看 §5 | 有 `## 5. LLM 错误`，6 条文案（含 `llm provider not configured: LLM_API_KEY`） |
| 环境变量样例已加 | 看两端 `.env.example` | 各有 `LLM_BASE_URL` / `LLM_API_KEY=`（空）/ `LLM_MODEL` / `LLM_TIMEOUT_MS` |
| 两端口径一致 | 比对两端 `.env.example` 的 LLM 四键 | 键名与默认值一致（**同值才能连同一个 provider**） |

**关键验证（照抄）**：契约版本必须是 **`0.5.0`**——这是本阶段契约侧的硬指标：

```bash
# 仓库根执行：确认三处版本号一致
# 1) openapi.yaml 的 info.version
# 2) src/index.ts 的 CONTRACT_VERSION
# 3) 编译产物中的 CONTRACT_VERSION
```

预期：`openapi.yaml` 的 `version: 0.5.0`、`src/index.ts` 的 `export const CONTRACT_VERSION = '0.5.0'`。

---

## 16. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 只改了 `openapi.yaml` 忘了同步 `src/index.ts` | 编译能过，但两端引擎拿不到 `LlmNodeData` / `LlmNodeOutput` | 契约四文件手工同步；改完必须 `pnpm run build:contract`（§4、§14） |
| 忘了升 `CONTRACT_VERSION` | 契约与 TS 版本对不上 | `openapi.yaml` 的 `info.version` 与 `src/index.ts` 的 `CONTRACT_VERSION` **必须同时**升到 `0.5.0`（§15） |
| 把 `LlmNodeData` 锁成 `additionalProperties: false` | 加一个 `topP` 就要改契约 | `data` 是开放式扩展点，保持 `true`，只用 description 约定字段（§10.3） |
| `temperature` / `maxTokens` 写成必填 | 用户想用 provider 默认却被逼填值 | 标**可选**；引擎没读到就不传（§10.1） |
| 把 `usage` 写成必填 | provider 不给用量时被迫伪造 / 抛错 | 标**可选**，有则带、无则省（§11.2） |
| 在 `.env.example` 里填了真密钥 | 密钥随仓库泄露 | 样例只留结构，`LLM_API_KEY=` 留空（§13） |
| `LLM_BASE_URL` 两端写成不同值 | 两端 token 序列可能不同（连的不是同一个 provider） | 两端 `.env` 的 `LLM_BASE_URL` / `LLM_MODEL` **必须同值**（§12.3、§15） |
| 以为「换个模型」要改代码 | 改代码 / 改图 | 改 `LLM_MODEL`（全局）或节点 `data.model`（局部）即可（§10.2） |
| 把 `usage` 的键顺序当成契约要求 | 两端为键顺序较劲 | `sse-events.md` §1 只要求「解析后 JSON 相等」（§11.4） |
| 在 OpenAPI 里给 `run` 加 `LlmNodeOutput` 响应体 | 契约里找不到对应 | `llm` 输出只出现在 `node_finished.output`（流内），不是 HTTP 响应体；`LlmNodeOutput` 是 TS 侧的**精确形状类型**（§6） |

---

## 17. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **`LlmNodeData` 形状正式化 + `model` 回退 `LLM_MODEL`** | `llm.data = { title, model, prompt, system?, temperature?, maxTokens? }`；`model` 为空时用全局默认 `LLM_MODEL`。**节点级 vs 全局默认**的优先级设计（同「草稿覆盖发布快照」的「局部覆盖默认」模式） | **首次教学于本篇** |
| **`llm` 输出 `{ text, model, usage? }` 与「`usage` 为什么可选」** | 输出形状 `LlmNodeOutput`；`usage` 可选是因为**并非所有 provider 都返回用量**；「能保证的 required、不能保证的 optional」是跨实现契约的通用原则 | **首次教学于本篇** |
| **LLM 配置放环境变量 + 「OpenAI 兼容」协议 + `base_url` 的威力** | `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS`；一份 OpenAI 兼容客户端只改 `base_url` 即可对接 OpenAI / DeepSeek / 阿里 / 本地 Ollama / mock | **首次教学于本篇** |
| **LLM 错误文案（`error-messages.md` §5）+ 不透出库原始 message** | 把 LangChain / 底层异常归一为 6 条规范文案（未配置 / 未授权 / 限流 / 超时 / 其它 HTTP / unknown）；出错不发该节点 `node_finished` | **首次教学于本篇** |
| **密钥不进仓库** | `.env` gitignore、`.env.example` 留空；「值因环境而异且泄露有代价 → 环境变量；只结构 → `.env.example`」 | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：OpenAPI 规范 / `$ref` / `additionalProperties` / `enum` / `format` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；「节点数据形状正式化」与「`GraphNode.data` 为唯一放开字段」见 `04-执行引擎/01-运行契约与SSE事件协议.md` §14；SSE 帧格式、6 事件、双通道错误、事件协议即唯一真源见 `04-执行引擎/01-运行契约与SSE事件协议.md`；「唯一真源」错误文案目录见 `02-应用管理/07-验收.md`；`pydantic-settings`（环境变量 → 带类型配置）见 `00-项目初始化/06-FastAPI起步.md`；「draft vs published」的局部覆盖默认见 `03-画布/02-Prisma-JSONB与两态.md`。

> 模型调用实现（`ChatOpenAI` 用法、真实流式、`usage` 来源、重试关闭、错误映射函数）见 `05-LLM节点/02-真实模型调用与流式.md`。
