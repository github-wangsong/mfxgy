# 01 · 运行契约与 SSE 事件协议

> 所属：阶段 4 · 执行引擎
> 本篇覆盖：在唯一真源 `packages/contract/openapi.yaml` 里新增 `POST /apps/{id}/run`（body `RunRequest`，成功响应 **`text/event-stream`**）与 `RunRequest` / `RunEvent` 两个 schema → 同步 `src/index.ts` 的 TS 类型与节点数据形状（`StartNodeData` / `LlmNodeData` / `EndNodeData`）→ 新建**事件协议唯一真源** `packages/contract/sse-events.md` → 在 `packages/contract/error-messages.md` 追加「执行引擎文案（§4）」→ 契约升到 **`0.4.0`** 并编译出 `dist`
> **本篇首次教学：① SSE（Server-Sent Events）是什么——单向、HTTP 长连接的文本推送协议，与 WebSocket 的取舍；② SSE 帧格式（`event:` + `data:` + 空行结尾，`data` 必须单行）；③ 6 种事件与固定顺序；④ 为什么把事件协议单独抽成一份「唯一真源」文档（OpenAPI 表达不了 SSE）；⑤ 同一错误有两类通道——**请求级错误走普通 JSON 400，运行期错误走流内 `run_failed` 事件**；⑥ 节点数据形状本阶段正式化（`start/llm/end` 的 `data`）**
> （OpenAPI 规范 / `paths` / `components` / `$ref` / `additionalProperties` / `enum` / `format` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；错误信封 / `securityScheme` 见 `01-账号与认证/01-契约扩展.md`；REST 资源化 / 路径参数 `{id}` / 404 惯例见 `02-应用管理/01-契约扩展.md`；错误文案唯一真源与图校验 7 规则见 `03-画布/01-图JSON契约与校验.md`，本篇只引用不重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 4 的立论：图 = 数据 → 图 = 程序

阶段 3 把「图」定成了**数据**（一份可存取的 JSON）。阶段 4 要做的，是**把这份数据「跑起来」**：

```
阶段 3：Graph（JSON）──存进数据库、读出来、校验           ← 数据
阶段 4：Graph（JSON）──编译成可执行图──按拓扑序执行──流式吐事件   ← 程序
```

一跑起来，就冒出一个新问题：**执行过程怎么「边跑边告诉客户端」？**

- 一次 run 可能耗时数秒（将来接真模型更久），客户端不该干等到结束才拿到结果；
- 但它又**不需要**客户端中途往服务器回推东西（运行输入在开始时一次性给全）。

于是本阶段选了一个比 WebSocket 更「轻」的协议：**SSE（Server-Sent Events）**。本阶段只做**两件事**：

1. **契约侧**（本篇）：把 `POST /apps/{id}/run` 这个接口、以及它吐出的事件流协议，钉进契约的一部分（`openapi.yaml` + 唯一的 `sse-events.md`）。
2. **实现侧**（`02-LangGraph编译图-TS.md`）：用 **LangGraph** 把 `Graph` 编译成 `StateGraph`，按拓扑序执行，把过程事件经 SSE 吐出。

---

## 1. 本篇目标

- 在契约里新增**运行接口** `POST /apps/{id}/run`：body 是 `RunRequest`，成功是 `text/event-stream`（SSE），失败是**普通 JSON 400**。
- 新建**事件协议唯一真源** `packages/contract/sse-events.md`：帧格式、6 种事件、固定顺序、引擎语义。
- 把 `start` / `llm` / `end` 三种节点的 `data` 形状**正式化**（契约 `description` + TS 类型两处）。
- 在 `error-messages.md` 追加「执行引擎文案」：**运行前预检（普通 JSON 400）** 与 **执行中错误（流内 `run_failed`）** 两类。
- 契约升到 **`0.4.0`** 并编译成两端与前端能消费的 TS 类型产物。

**验收标准**

1. `pnpm run build:contract` 成功，产出 `packages/contract/dist/index.js` 与 `index.d.ts`。
2. `openapi.yaml` 里能看到 `POST /apps/{id}/run`（`operationId: runApp`，`200` 的 content 为 `text/event-stream`），以及 `RunRequest` / `RunEvent` 两个新 schema；`info.version` 为 `0.4.0`。
3. `src/index.ts` 的 `CONTRACT_VERSION` 为 **`0.4.0`**，且新增 `GraphNodeType` / `StartNodeData` / `LlmNodeData` / `EndNodeData` / `RunRequest` / `RunEventName` / 各 `*Data` / `RunEvent` 类型。
4. `sse-events.md` 存在，含帧格式、6 事件 payload 表、固定顺序、引擎语义四节。
5. `error-messages.md` 多了 `## 4. 执行引擎文案`（含 4.1 预检、4.2 执行中）。

**接口清单（本阶段新增）**

| 方法 / 路径 | operationId | 成功 | 失败 |
| --- | --- | --- | --- |
| `POST /apps/{id}/run` | `runApp` | `200` → `text/event-stream`（SSE 流，帧格式见 `sse-events.md`） | `400`（**普通 JSON**：草稿为空 / 图不合法 / 节点数据形状非法）、`401`（未认证）、`404`（应用不存在或非本人） |

---

## 2. 前置条件

- 阶段 3 全部完成：`/apps/{id}/graph` 四个接口、`Graph` / `GraphNode` / `GraphEdge` 等 schema、`validateGraph` 纯函数都已在（见 `03-画布/01-图JSON契约与校验.md`）。
- 阶段 0 · 04（`packages/contract` 契约包）与 `pnpm install` 已完成，`build:contract` 能用。
- `apps/api-ts` 已能启动（阶段 2 / 3 模块都在）。

> 本篇**只改契约四文件**（`openapi.yaml` / `src/index.ts` / `sse-events.md` / `error-messages.md`），不动后端源码与数据库。引擎实现见 `02-LangGraph编译图-TS.md`。

---

## 3. 先看清要做什么

```
packages/contract/
   ├── openapi.yaml        ← 追加 POST /apps/{id}/run + RunRequest + RunEvent；节点 data 描述正式化  （本篇 §5）
   ├── src/index.ts        ← 同步追加 TS 类型（运行接口、节点 data、SSE 事件）                        （本篇 §6）
   ├── sse-events.md       ← **新建**：SSE 事件协议唯一真源（帧格式 / 事件 / 顺序 / 引擎语义）        （本篇 §7）
   └── error-messages.md   ← 追加「§4 执行引擎文案」（预检 400 + 流内 run_failed）                    （本篇 §8）
        ↓ pnpm run build:contract
      dist/index.js + dist/index.d.ts
```

新增接口的语义：

```
POST /apps/{id}/run     带令牌 + { inputs: {...} }  → 运行「当前草稿」图
   ├─ 预检通过 → 200 text/event-stream，逐帧吐事件（见 sse-events.md）
   └─ 预检失败 → 400 普通 JSON（草稿为空 / 图不合法 / 节点数据形状非法）
```

**关键点**：`run` 跑的是**当前草稿**（`graphJson`），不是发布快照——这与阶段 3 的 `publish` 校验草稿是同一种「以草稿为准」的口径；本阶段先把「能跑」做出来，发布/线上运行留待后续。

### 3.1 两类错误通道（本阶段最重要的一个设计取舍）

同一个 `POST /run`，**错误的出口有两条**，取决于「错在什么时候」：

| 时机 | 例子 | 出口 | HTTP 形态 |
| --- | --- | --- | --- |
| **打开流之前**（请求级别） | 草稿为空、图不合法、节点数据形状非法 | 抛 `BadRequestException` | **普通 JSON 400** `{statusCode,message,error}` |
| **打开流之后**（运行期） | 缺必填输入、模板取值失败 | 发 `run_failed` 事件 | 仍是 **`200` 流**，错误在**流内** |

原因：SSE 一旦开始写响应头，HTTP 状态码就**已经定格为 200**，后面再想「改成 400」是做不到的。所以凡是「能在开始前发现」的错误，就在**开流前**用普通 JSON 报掉；只有「跑着跑着才出现」的错误，才用流内的 `run_failed` 帧送出（详见 §13）。

### 3.2 节点数据形状本阶段正式化

阶段 3 里 `GraphNode.data` 是**契约唯一放开的自由结构**（`additionalProperties: true`）。本阶段引擎要真去读它，于是把三种节点的 `data` 形状**正式化**（写在契约 `description` 里 + TS 类型里，见 §6 / §14）：

| 节点 | `data` 形状 |
| --- | --- |
| `start` | `{ "inputs": [{ "name": string, "type": "string", "required": boolean }] }` |
| `llm` | `{ "title": string, "model": string, "prompt": string }`（`model` 本阶段不使用，为阶段 5 预留） |
| `end` | `{ "outputs": [{ "name": string, "value": string }] }`（`value` 支持 `{{ path }}` 模板） |

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 把 `src/index.ts` 编译成 `dist`（`index.js` + `index.d.ts`），把新类型发给 NestJS / FastAPI / 前端 | 无报错，`packages/contract/dist/` 出现两个文件 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 顺带验证 NestJS 能读到新类型（可选） | 编译通过 |

> `build:contract` 的定义是 `pnpm --filter @mini-dify/contract build`（见根 `package.json`），最终执行 `tsc -p tsconfig.json`。与阶段 0 · 04 是同一条命令，此处只是「契约变了要重编」。

---

## 5. 完整代码：契约（openapi.yaml）

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: mini-dify API
  version: 0.4.0
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
            llm → `{ "title": string, "model": string, "prompt": string }`（`model` 本阶段不使用）；
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

**本阶段新增的部分（与阶段 3 相比）**

| 新增 | 类型 | 说明 |
| --- | --- | --- |
| `paths./apps/{id}/run`（`post`） | path item | 运行接口；`200` 的 content 是 **`text/event-stream`**（schema 为 `type: string`），失败走 `400` 普通 JSON |
| `RunRequest` | schema | 运行输入 `{ inputs: object }`；`inputs` 内部 `additionalProperties: true`（键即变量名，由图的 `start.data.inputs` 约定） |
| `RunEvent` | schema | **仅供文档**：列出 6 种事件名与「payload 是对象」；SSE 真实帧格式不在 OpenAPI 里描述（见 §12） |
| `GraphNode.data` 的 `description` | 字段说明 | 从「自由结构」升级为「引擎按 start/llm/end 各自的形状解释」（§14） |
| `info.version` → `0.4.0` | — | 契约版本与 `CONTRACT_VERSION` 同步递增 |

**读法要点**：

- **`200` 的 media type 是 `text/event-stream`，schema 写成 `type: string`**：OpenAPI 的 `content` 是「按 media type 描述响应体」，而 SSE 响应体是一串**按约定格式拼接的文本行**，没有通用的 JSON 结构可描述——所以契约只能声明「它是文本」，把**真正的格式**交给 `sse-events.md`（§12）。
- **`RunRequest.inputs` 里的 `additionalProperties: true`**：`inputs` 的键是**运行时才知道的变量名**（由所选图的 `start` 节点声明），无法在契约里枚举。这属阶段 3 学过的「开放式扩展点」取舍——**形状由别人（图）决定的字段就放开**（见 `03-画布/01-图JSON契约与校验.md` §9）。
- **`RunEvent` 不是响应体**：它在本契约里**只做文档**（注释已写明）。它存在的意义是「让读契约的人知道有哪 6 种事件」，真正的协议真源仍是 `sse-events.md`。

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
export const CONTRACT_VERSION = '0.4.0'

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

/** `llm` 节点的 `data` 形状。`model` 本阶段不使用，为阶段 5 预留。 */
export interface LlmNodeData {
  title: string
  model: string
  prompt: string
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

**本阶段新增的类型**

| 类型 | 关键点 |
| --- | --- |
| `GraphNodeType` | `GraphNode['type']`，即 `'start' \| 'end' \| 'llm'` 的别名——事件里的 `nodeType` 复用它，避免重复写联合 |
| `StartNodeData` | `inputs: Array<{ name; type: 'string'; required }>`——`start` 节点声明的输入列表 |
| `LlmNodeData` | `{ title; model; prompt }`——注意 `title` / `model` 本阶段**不参与执行**，只有 `prompt` 被渲染 |
| `EndNodeData` | `outputs: Array<{ name; value }>`——`value` 是**模板字符串**，执行时按 `{{ path }}` 渲染 |
| `RunRequest` | `{ inputs: Record<string, unknown> }` |
| `RunEventName` | 6 种事件名的**字面量联合** |
| `RunStartedData` / `NodeStartedData` / `TokenData` / `NodeFinishedData` / `RunFinishedData` / `RunFailedData` | 六种事件各自的 payload 形状 |
| `RunEvent` | `{ event: RunEventName; data: 上面六者之一 }`——**逻辑表示**；它只描述「事件名 + payload」，**不描述帧文本**（帧由两端各写一份，见 §12） |
| `CONTRACT_VERSION` | 由 `'0.3.0'` 改为 `'0.4.0'` |

> **为什么 `RunEvent.data` 是六者的联合**：六种事件的 payload 键完全不同（`token` 有 `text`、`run_finished` 有 `outputs`/`elapsedMs`…）。用**类型擦除**前的编译期联合（见 `00-项目初始化/04-契约包与TypeScript类型.md`），能让消费方 `switch (event.event)` 后精确拿到对应 payload 类型。

---

## 7. 完整代码：SSE 事件协议唯一真源（sse-events.md）

OpenAPI 表达不了 SSE 的**逐帧文本格式**（见 §12），所以本阶段新建一份专门文档。

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
| `token` | `llm` 节点流式产出一片文本 | `nodeId`(string)、`text`(string) |
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
- **`llm`**（本阶段为**桩**）：把 `data.prompt` 用池渲染，输出 `{ "text": <渲染后文本> }`；
  并将该文本按**每个 Unicode 码点 8 个字符**一片，逐片发出 `token` 事件。
- **`end`**：把 `data.outputs[].value` 逐条渲染，得到 `{ name: 渲染值 }`，作为
  `run_finished` 的 `outputs`。若被执行了多个 `end` 节点，取**拓扑序最后一个**的输出。
- **事件产生方式**：`node_started` / `token` / `node_finished` 由各节点在执行过程中发出；
  `run_started` 于执行前发出，`run_finished` / `run_failed` 于执行结束后发出。
````

**本阶段新增**：整个文件（阶段 4 新建）。

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
````

**本阶段新增**：`## 4. 执行引擎文案` 整节（4.1 预检、4.2 执行中）。

---

## 9. 【技术教学 · 首次】SSE 是什么，以及它与 WebSocket 的取舍

### 9.1 问题：服务器怎么「边算边推」？

客户端收到一个 HTTP 响应，传统模型是「**发一个请求 → 等一个完整响应**」。但「运行一张图」是**长时间、分步**的过程，客户端想**看到中间过程**（哪个节点在跑、LLM 吐了几个字…）。有两条主流路子：

- **WebSocket**：一次 HTTP 握手后升级成**全双工**长连接，双方随时互发消息。
- **SSE（Server-Sent Events）**：**单向**的服务器→客户端推送，就是一个「永不结束的 HTTP 响应」（`Content-Type: text/event-stream`），服务器持续往里写文本行。

本项目的 run 场景里，客户端**不需要**中途往回发消息（输入在开始时一次性给全）——**只需要服务器单向推送**。这正是 SSE 的主场。

### 9.2 SSE 与 WebSocket 对比

| 维度 | SSE | WebSocket |
| --- | --- | --- |
| 方向 | **单向**（服务器 → 客户端） | 双向 |
| 协议 | 就是普通 HTTP；`Content-Type: text/event-stream` | 需 `ws://`/`wss://` 握手升级，非 HTTP 响应 |
| 消息格式 | **文本**（UTF-8，约定按行） | 二进制或文本帧 |
| 断线重连 | **浏览器 `EventSource` 原生自动重连**，并用 `Last-Event-ID` 请求头带上「最后收到的事件 id」 | 需自己实现心跳与重连 |
| 实现成本 | 低（写文本行即可） | 高（帧、心跳、连接管理） |
| 适用 | 日志流、进度、LLM token 流、通知 | 聊天、协同编辑、游戏等双向实时 |

**结论**：run 只需要单向推送，SSE「更简单、走普通 HTTP、天然断线重连」；WebSocket 的双向能力在本场景是**用不上的复杂度**。所以选 SSE。

> 本阶段还**用不到** SSE 的重连语义（`Last-Event-ID` / `id:` 行），帧里只发 `event:` 与 `data:`；但它「断线可由浏览器自动重连」这一特性，是未来「跑长任务不丢线」的天然基础，这也是选它的原因之一。

---

## 10. 【技术教学 · 首次】SSE 帧格式：`event:` + `data:` + 空行结尾

SSE 把「一条消息」编码成**若干文本行 + 一个空行**。本项目的每种事件就是一个**固定两行的帧**：

```
event: <name>\n
data: <单行 JSON>\n\n
```

逐字节看：

```
event: node_started\n      ← 第 1 行：事件名
data: {"nodeId":"start_1","nodeType":"start"}\n   ← 第 2 行：payload（单行 JSON）
\n                         ← 第 3 行：空行，标志「本帧结束」
```

发送时就是把这些字符串**首尾相接**地写进响应体（连帧之间不需要额外分隔，因为空行就是分隔）：

```
event: run_started\ndata: {"runId":"...","appId":"..."}\n\nevent: node_started\ndata: {...}\n\n...
```

**规则要点**：

1. **`event:` 行在前、`data:` 行在后**，两行之间恰好一个 `\n`。
2. **帧以空行结束**（`\n\n` 的后一个 `\n`）。SSE 规范：一行若为空（只有换行），则「前面的若干行构成一条消息」——所以**空行是消息边界**，没有它接收方就会一直等下一行。
3. **`data:` 必须是单行 JSON**（不含任何换行）。原因：SSE 里**每个 `data:` 行都是一段数据**，多个 `data:` 行会被**拼接**（用 `\n`）成一条消息的数据。若把带换行的 JSON 直接塞进去，接收方会把 JSON 拆成多条 `data:` 行拼回来——**大多数情况下也错不了**，但为了「逐字节固定、两端可比对」，本项目**规定 payload 必须紧凑成单行**（`JSON.stringify(obj)` 默认就是单行）。
4. **`event:` 的名字决定客户端如何处理**（见 §11 的 6 种）。默认事件名是 `message`，本项目总是显式给 `event:`。

**最小实现长这样**（本项目 api-ts 的写法，完整代码见 `02-LangGraph编译图-TS.md`）：

```ts
function formatSseFrame(event: RunEvent): string {
  return `event: ${event.event}\n` + `data: ${JSON.stringify(event.data)}\n\n`
}
```

> 一句话：**`event:` 说「这是什么事件」，`data:` 说「内容」，空行说「我说完了」。**

---

## 11. 【技术教学 · 首次】6 种事件与固定顺序

### 11.1 6 种事件

| 事件 | 时机 | payload |
| --- | --- | --- |
| `run_started` | 流开始、执行之前 | `runId`、`appId` |
| `node_started` | 某节点开始执行 | `nodeId`、`nodeType` |
| `token` | `llm` 节点吐出一片文本 | `nodeId`、`text` |
| `node_finished` | 某节点执行结束 | `nodeId`、`nodeType`、`output` |
| `run_finished` | 整图成功结束 | `runId`、`outputs`、`elapsedMs` |
| `run_failed` | 中途出错并终止 | `runId`、`nodeId`、`message` |

### 11.2 固定顺序

```
run_started                                  ← 最先发一帧，宣告这次 run
  for 每个（按拓扑序的）节点:
    node_started                             ← 该节点开始
    （仅 llm：若干 token）                    ← 流式片段，穿插在 start/finish 之间
    node_finished                            ← 该节点结束
run_finished                                 ← 整图成功
```

出错时：已发的帧**不动**，末尾**追加一帧** `run_failed`，**不再**发 `run_finished`，流结束。

**为什么顺序要这么严**：本项目要求 api-ts 与 api-py **完全一致**（契约测试逐条比对），所以事件序列里「谁先谁后」不能各写各的——写死在 `sse-events.md` §3。

### 11.3 实测事件序列（start → llm → end 的一张图）

```
run_started
node_started(start_1)   →  node_finished(start_1)
node_started(llm_1)     →  token("Hello mi") → token("ni-dify") → node_finished(llm_1)
node_started(end_1)     →  node_finished(end_1)
run_finished(outputs={"result":"Hello mini-dify"})
```

- `start` 节点先跑（拓扑序起点）；`llm` 节点在 `started` 与 `finished` **之间**穿插 2 个 `token`；`end` 节点最后跑。
- 两个 token 拼起来正是 `"Hello mini-dify"`——因为 `llm` 的 `prompt` 渲染后就是这句话，按**每 8 个 Unicode 码点一片**切开（见 `sse-events.md` §4，实现在 `02` 篇）。

---

## 12. 【技术教学 · 首次】为什么把事件协议抽成「唯一真源」文档

### 12.1 OpenAPI 描述不了 SSE

OpenAPI 的 `responses.200.content` 是「按 **media type** 描述响应体结构」，它期望一个**结构化**的媒体类型（`application/json` → schema 描述对象；`text/plain` / `text/event-stream` → 顶多声明「是字符串」）。而 SSE 的响应体是**一串按「行 + 空行」拼接的文本**，它的「结构」是**帧级**的，OpenAPI 的 schema 词汇（`type` / `properties` / `items`…）根本表达不了「第 1 行是 `event:`、第 2 行是 `data:`、第 3 行空行」。

所以本项目在 `openapi.yaml` 里对 `200` **只能声明**：

```yaml
"200":
  description: SSE 执行流（text/event-stream）
  content:
    text/event-stream:
      schema:
        type: string        # ← 只能说「是一串文本」
        description: 逐行遵循 `event: <name>\n` + `data: <单行 JSON>\n\n` 的帧格式。
```

真正的协议细节（6 种事件、payload 键、顺序、引擎语义）放不进 schema。

### 12.2 于是抽出独立真源 `sse-events.md`

和阶段 2/3 处理「错误文案」用的是**同一个套路**（见 `02-应用管理/07-验收.md`：错误文案抽成 `error-messages.md`）：**OpenAPI 表达不了的东西，就抽成一份独立的「唯一真源」文档，并规定「改协议必须同步改本文件与两端实现」。**

| 真源文档 | 管什么 | 为什么不在 OpenAPI 里 |
| --- | --- | --- |
| `openapi.yaml` | 接口、请求/响应**结构**、状态码 | —— |
| `error-messages.md` | 错误 `message` 的**逐字节文案** | schema 只能约束形状，约束不了「文案字符串」 |
| `sse-events.md`（本篇新增） | SSE **帧格式、事件种类、顺序、引擎语义** | OpenAPI 表达不了「按行拼帧」的文本协议 |

**收益**：两端引擎各自 `formatSseFrame`（TS）/ 等价实现（Py），但**产出必须逐字节一致**；契约测试拿到的流可以**逐帧比对**。

### 12.3 `RunEvent` 在 OpenAPI 里只是「文档」

注意 `openapi.yaml` 的 `RunEvent` schema 注释：

```yaml
    RunEvent:
      type: object
      # 仅用于**文档**：SSE 流不是 JSON 响应体，每个事件的真实帧格式见
      # packages/contract/sse-events.md。此处描述事件的种类与 payload 形状。
```

它是**给读契约的人看的**——「有这么 6 种事件，payload 是个对象」。它**不是** `run` 的响应体（响应体是 `text/event-stream` 的字符串）。真正可用的类型描述在 `src/index.ts` 的 `RunEvent`（§6）与 `sse-events.md`。

> 口诀：**OpenAPI 管「形状正常的接口」，管不了的「文本型协议 / 精确文案」各归其唯一真源文档。**

---

## 13. 【技术教学 · 首次】同一错误的两类通道：JSON 400 vs 流内 `run_failed`

### 13.1 关键约束：SSE 一旦开写，状态码就定死了

HTTP 状态码写在**响应头**里，而**响应头必须在响应体之前发出**。SSE 一旦 `flushHeaders()` / 写了第一帧，状态码就固定为 `200` 了——**之后再想「改成 400」是不可能的**。

所以问题的本质是：**错误发生在「响应头已发」之前还是之后？**

| 错误发生的时机 | 例子 | 能改状态码吗 | 走哪条通道 |
| --- | --- | --- | --- |
| **开流之前**（响应头还没发） | 草稿为空、图不合法、节点数据形状非法 | 能 | **抛异常 → 普通 JSON 400** |
| **开流之后**（已发 `200` + 帧） | 缺必填输入、模板取值失败 | 不能 | **流内 `run_failed` 事件** |

### 13.2 设计：先「预检」，再「开流」

本项目 api-ts 的实现把这件事拆成两步（完整代码见 `02` 篇的 `engine.service.ts`）：

```
EngineService.run()                    ← 开流之前
  ① 查应用归属（不属本人 → 404）
  ② 草稿为空？          → BadRequestException('Graph is empty')
  ③ validateGraph + 节点数据校验 → BadRequestException(errors.join('; '))
  ────────────────────────────────────────────
  全部通过后，才把「事件异步生成器」交出去 → 控制器 setHeader + flushHeaders → 开始写帧
  ④ 运行期出错（缺输入 / 模板取不到值）→ 发 run_failed，流正常结束（仍是 200）
```

**好处**：

- **预检错误**返回的是**普通 JSON**（`application/json`），客户端按老规矩解析 `{statusCode,message,error}` 即可——与阶段 1–3 的错误信封**完全一致**，前端不需要为 run 单独写一套错误解析。
- **运行期错误**用统一的 `run_failed` 事件传出，`message` 与预检错误共享同一份文案真源（`error-messages.md` §4），**错误语义不因「发生在哪条通道」而分裂**。

### 13.3 实测

```
草稿为空           → 400 {"statusCode":400,"message":"Graph is empty","error":"Bad Request"}
图不合法           → 400 {"statusCode":400,"message":"…图校验文案…","error":"Bad Request"}
模板变量不存在     → 200 流内：event: run_failed  data: {"runId":"...","nodeId":"llm_1","message":"template variable not found: inputs.nope"}
缺必填输入         → 200 流内：event: run_failed  data: {"runId":"...","nodeId":"start_1","message":"missing required input: topic"}
```

> 注意 `run_failed` 的 `nodeId`：能定位到具体节点（如 `llm_1` / `start_1`）就给出来，定位不了给 `null`。

---

## 14. 【技术教学 · 首次】节点数据形状本阶段正式化

阶段 3 里，`GraphNode.data` 被定成**唯一放开的自由结构**（`additionalProperties: true`），契约**不背书**它的内部形状（见 `03-画布/01-图JSON契约与校验.md` §9）。本阶段引擎要真去读 `data`，于是把它**正式化**。

### 14.1 三个节点各自的 `data`

| 节点 | `data` 形状 | 引擎怎么用 |
| --- | --- | --- |
| `start` | `{ inputs: [{ name: string, type: 'string', required: boolean }] }` | 校验运行输入：`required` 为真且缺失 → `missing required input: {name}`；输出 `{ inputs: {...} }` |
| `llm` | `{ title: string, model: string, prompt: string }` | 用**变量池**渲染 `prompt`；输出 `{ text }`；按 8 码点切片发 `token`。`title` / `model` 本阶段**不参与执行**（`model` 为阶段 5 接真模型预留） |
| `end` | `{ outputs: [{ name: string, value: string }] }` | 逐条渲染 `value`（模板），得到 `{ name: 渲染值 }`，即 `run_finished.outputs` |

### 14.2 正式化落在三处

1. **契约 `description`**（`openapi.yaml` 的 `GraphNode.data`）：把上述形状写成一段给人看的说明——**契约仍宣告 `additionalProperties: true`**（形状由节点类型自行约定），但**把约定写清楚**。
2. **TS 类型**（`src/index.ts`）：新增 `StartNodeData` / `LlmNodeData` / `EndNodeData`，让引擎能 `node.data as unknown as StartNodeData` 取用。
3. **文案真源**（`error-messages.md` §4.1）：规定「节点数据形状非法」时的文案（如 `start node {id} inputs must be an array`）。

### 14.3 为什么「形状正式化」却仍保持 `additionalProperties: true`

- **正式化**：引擎需要**确定的**字段去执行（读 `prompt`、读 `inputs[].required`）——这些字段必须两端一致，否则跑法就不一致。
- **仍放开**：`data` 是**开放式扩展点**（见阶段 3 §9）——`llm` 将来会加 `temperature`、节点类型会继续膨胀。若锁死 `additionalProperties: false`，**每加一个配置字段都要改契约**。
- **折中做法**：契约**写清「约定字段」（description）**，但**不锁死结构**；引擎只**校验约定字段的形状**（§4.1 的 4.1.3–4.1.8），**额外字段一律忽略**。这样「约定」稳定、扩展也不撞契约。

> 口诀：**放开的那一层，用「文档约定 + 引擎按约定读取」来管，而不是用 `additionalProperties: false` 去锁。**

---

## 15. 编译并验证

**命令（在仓库根执行）**

```bash
pnpm run build:contract
```

**目的**：把 `src/index.ts` 编译成 `dist/index.js`（运行时代码）+ `dist/index.d.ts`（类型声明），把新类型（运行接口、节点 data、SSE 事件）发给 NestJS / FastAPI / 前端。

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

## 16. 验收自测

| 检查项 | 命令 / 做法 | 预期 |
| --- | --- | --- |
| 契约可编译 | `pnpm run build:contract` | 无报错 |
| 产物齐全 | `ls packages/contract/dist` | 同时有 `index.js` 与 `index.d.ts` |
| 版本已升 | 看 `openapi.yaml#/info/version` 与 `src/index.ts#CONTRACT_VERSION` | 二者均为 `0.4.0` |
| 运行接口齐备 | 阅读 `openapi.yaml#/paths/apps/{id}/run` | `post`，`operationId: runApp`，body `$ref: RunRequest`，`200` 的 content 为 `text/event-stream` |
| 两个新 schema | 阅读 `openapi.yaml#/components/schemas` | 有 `RunRequest`、`RunEvent` |
| `RunEvent` 仅为文档 | 看 `RunEvent` 的注释 | 注明「SSE 流不是 JSON 响应体，真实帧格式见 sse-events.md」 |
| 事件真源已建 | 阅读 `packages/contract/sse-events.md` | 有 §1 帧格式、§2 事件表、§3 顺序、§4 引擎语义 |
| 引擎文案已补 | 阅读 `error-messages.md` | 有 `## 4. 执行引擎文案`（§4.1 预检、§4.2 执行中） |
| 节点 data 已正式化 | 看 `GraphNode.data` 的 `description` 与 `src/index.ts` | description 写了 start/llm/end 形状；TS 有 `StartNodeData` / `LlmNodeData` / `EndNodeData` |
| 类型一致 | 人工比对 `openapi.yaml` 与 `src/index.ts` | `RunRequest` / `RunEventName` / 六种 `*Data` 逐项对应 |

**契约测试视角**：对同一份草稿为空的应用，两端 `POST /apps/{id}/run` 都应返回**逐字节相同**的普通 JSON 400：

```jsonc
{ "statusCode": 400, "message": "Graph is empty", "error": "Bad Request" }
```

且响应 `Content-Type` 应为 `application/json`（**不是** `text/event-stream`）——这证明「预检失败不走流」。

---

## 17. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 想在流里「中途改成 400」 | 报错却仍是 `200` | SSE 一旦发响应头，状态码就定死。**凡是开流前能发现的错误，就在开流前用普通 JSON 400 报掉**（§13） |
| 把运行期错误也做成 400 | 客户端收到 200 流却要按 400 解析 | 运行期错误只能走**流内 `run_failed`**；两类通道别混（§13） |
| `data:` 里塞了多行 JSON | 接收方把 JSON 拆行、比对失败 | payload **必须单行**：用 `JSON.stringify(obj)`（默认单行）；帧以**空行**结尾（§10） |
| 忘了帧尾空行 / 少一个 `\n` | 接收方一直等「消息结束」 | 帧格式固定为 `event: …\n` + `data: …\n\n`——**两个 `\n` 结尾**（§10） |
| 以为 SSE 就是 WebSocket | 想双向通信、引入 socket 库 | run 只需**单向推送**，SSE 足够且更简单（§9） |
| 试图用 OpenAPI 表达 SSE 帧格式 | schema 写不出「按行拼帧」 | OpenAPI 表达不了文本型协议；抽 `sse-events.md` 做唯一真源（§12） |
| 把 `RunEvent` 当成 run 的响应体 | 契约里找不到 `RunEvent` 与响应体的对应 | `RunEvent` 在 OpenAPI 里**仅文档**；响应体是 `text/event-stream` 的字符串（§12.3） |
| 锁死 `GraphNode.data` 为 `additionalProperties: false` | 每加一个节点配置字段都要改契约 | 保持放开；用 description 约定 + 引擎按约定读取并只校验约定字段（§14） |
| `RunRequest.inputs` 想枚举键 | 契约里写死变量名 | `inputs` 的键由图的 `start` 节点决定，运行期才知道——`additionalProperties: true`（§5） |
| 只改 YAML 忘了改 TS / 忘了递增版本 | 后端拿不到新类型 / 版本对不上 | 四份文件（`openapi.yaml`、`src/index.ts`、`sse-events.md`、`error-messages.md`）手工同步，版本升 `0.4.0` |
| 忘了重编译契约 | 后端编译用的还是旧 `dist` | 契约改完必须 `pnpm run build:contract` |

---

## 18. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| **SSE（Server-Sent Events）**：单向、基于 HTTP 长连接的文本推送协议；与 WebSocket 的取舍（更简单、走普通 HTTP、天然断线重连；不能双向） | **首次教学于本篇** |
| **SSE 帧格式**：`event: <name>\n` + `data: <单行 JSON>\n\n`；空行是消息边界；`data` 必须单行 | **首次教学于本篇** |
| **6 种事件与固定顺序**：`run_started → (node_started → [token] → node_finished)* → run_finished`；出错追加 `run_failed` 不发 `run_finished` | **首次教学于本篇** |
| **SSE 协议抽成「唯一真源」文档**（`sse-events.md`）：OpenAPI 表达不了「按行拼帧」的文本协议；`RunEvent` 在 OpenAPI 里仅作文档 | **首次教学于本篇** |
| **同一错误的两类通道**：请求级错误走普通 JSON 400（开流前），运行期错误走流内 `run_failed`（开流后，状态码已定死 200） | **首次教学于本篇** |
| **节点数据形状正式化**：`start` / `llm` / `end` 的 `data` 形状写进契约 description + TS 类型；契约仍 `additionalProperties: true`，引擎只校验约定字段 | **首次教学于本篇** |
| 契约新增 `POST /apps/{id}/run`（`text/event-stream`）、`RunRequest`、`RunEvent`；版本升 `0.4.0` | 本篇 |

> 已在前序篇教学、本篇仅引用不重讲的：OpenAPI 规范（`paths` / `components` / `$ref` / `additionalProperties` / `enum` / `format`）见 `00-项目初始化/04-契约包与TypeScript类型.md`；错误信封 / `securityScheme`（HTTP Bearer JWT）见 `01-账号与认证/01-契约扩展.md`；REST 资源化、路径参数 `{id}`、404 惯例见 `02-应用管理/01-契约扩展.md`；「唯一真源」错误文案目录与图校验 7 规则见 `03-画布/01-图JSON契约与校验.md`；「开放式扩展点的 `additionalProperties: true` 取舍」见 `03-画布/01-图JSON契约与校验.md` §9；`Record<string, unknown>` 见 `03-画布/01-图JSON契约与校验.md` §6。

> 引擎实现（LangGraph 编译图、事件队列、节点桩、模板解析、SSE 帧的写出）见 `04-执行引擎/02-LangGraph编译图-TS.md`。
