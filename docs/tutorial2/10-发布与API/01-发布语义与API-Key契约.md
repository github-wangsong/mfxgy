# 01 · 发布语义与 API-Key 契约（发布与 API）

> 阶段 10 · 第 1 步
>
> 做完：契约从 `0.9.0` 升到 **`0.10.0`**，新增 **4 个接口**（`GET|POST /apps/{id}/api-keys`、`DELETE /api-keys/{id}`、`POST /public/apps/{appId}/run`）、**5 组 schema**（`ApiKeyResponse` / `ApiKeyListResponse` / `CreateApiKeyRequest` / `CreateApiKeyResponse` / `PublicRunRequest`）、**1 个安全方案**（`apiKeyAuth`）；`error-messages.md` 新增 §10（7 条文案）；数据库新增 **`api_keys`** 表并生成迁移。
>
> **本篇面试考点**：发布为什么是「复制草稿」而不是「引用草稿」 · 快照为什么只保留一份 · API Key 四元组各回答什么问题 · 为什么只存 SHA-256 而不存明文 · 为什么不用 bcrypt 存 key · `prefix` 为什么是 11 字符 · `key_hash` 为什么必须唯一 · 撤销为什么是软删除 · `owner_id` 为什么要冗余 · `PublicRunRequest` 为什么只有 `inputs` · 两套认证方案为什么能并列 · 对外运行为什么先校验 key 再查应用 · 未发布为什么是 400 而不是 404 · `id` 为什么没有数据库默认值。

---

## 1. 前九个阶段的共同前提

前九个阶段，所有接口都有一个隐含前提：

> **调用者就是登录用户本人。**

```text
JWT 认人 ──→ ownerId 认应用 ──→ POST /apps/{id}/run 读草稿
```

整个系统像一张「搭建者的工作台」：你搭、你调、你跑。

阶段 10 第一次打开门，让别人调用你搭好的应用。门一开，立刻出现两个新问题：

| 新问题 | 本阶段的答案 | 对应机制 |
| --- | --- | --- |
| 线上跑的是**哪一份图**？ | 已发布快照，不是草稿 | `apps.published_graph_json` |
| 调用者是谁？他凭什么能调？ | 应用所有者签发的凭证 | `api_keys` + `X-API-Key` |

这两个答案是**正交**的：

```text
                      ┌────────────────────────────────┐
  搭建者（JWT）───────→│ POST /apps/{id}/graph/publish  │
                      └───────────────┬────────────────┘
                                      │ 复制（不是引用）
                                      ▼
                      ┌────────────────────────────────┐
                      │ apps.published_graph_json      │←── 对外运行只读这里
                      └───────────────▲────────────────┘
                                      │
  调用方（API Key）──→ POST /public/apps/{appId}/run
```

一句话记住本阶段：

> **发布 = 把草稿复制成快照；对外调用 = 用快照 + 用 key。**

### 1.1 四条刻意不做的边界

| 不做 | 原因 |
| --- | --- |
| 对外运行**不支持会话** | 调用方不是登录用户，没有「谁的历史」这一概念；契约里直接砍掉 `conversationId` / `userMessage` |
| 撤销**不做物理删除** | 保留「曾经签发过什么」的审计痕迹，列表里还要能看见 |
| 发布**只保留一份快照** | 没有版本历史 / 回滚；每次发布覆盖上一份 |
| **不做限流** | 生产必须做，本阶段只在实现里留注释 |

这四条不是「忘了做」，而是**先把语义定清楚，再决定不做什么**。面试时能说清「为什么不做」比「做了什么」更能体现设计判断。

---

## 2. 九条决策

| # | 决策 | 理由 |
| --- | --- | --- |
| 1 | 发布 = 把草稿**复制**进 `published_graph_json` | 两份独立数据；草稿怎么改都不影响线上 |
| 2 | 对外运行只读快照，不读草稿 | 线上行为必须可预期、可复现 |
| 3 | 只保留一份快照，不做版本历史 | 本阶段范围；回滚是后续扩展点 |
| 4 | key 只存 `sha256(key)` 与 `prefix` | 拖库也拿不到可用 key |
| 5 | 明文 `key` **只在创建响应返回一次** | 服务端没有能力「再显示一次」 |
| 6 | 撤销 = 置 `revoked_at`，不物理删除 | 审计 + 列表可追溯 |
| 7 | 已撤销的 key **立即失效**，无宽限期 | 语义简单；轮换靠「新建 + 撤销旧」 |
| 8 | key 同时绑定 `app_id` 与 `owner_id`，双外键级联 | 单表做归属校验；删应用/用户自动清理 |
| 9 | `PublicRunRequest` 只有 `inputs` | 契约层砍字段，不是运行期忽略 |

第 1、4、9 条是后面两篇的核心；本篇先把**表**和**契约**定下来。

---

## 3. 契约 `0.9.0 → 0.10.0`

### 3.1 文件地图

```text
packages/contract/
   ├── openapi.yaml          ← 4 个路径 + apiKeyAuth + 5 组 schema；info.version = 0.10.0   （本篇 §3）
   ├── src/index.ts          ← 同步类型；CONTRACT_VERSION = 0.10.0                          （本篇 §3.6）
   └── error-messages.md     ← §10 发布与 API Key（7 条文案）                                （本篇 §3.5）
        ↓ pnpm --filter @mini-dify/contract build
      dist/index.js + dist/index.d.ts

apps/api-ts/
   ├── prisma/schema.prisma                                                  （本篇 §4）
   ├── prisma/migrations/20261023115759_add_api_keys/migration.sql          （本篇 §5）
   └── src/
        ├── api-keys/        ← 3 个管理接口（JWT）                          （02 篇）
        └── public/          ← 1 个对外接口（API Key）                      （03 篇）

apps/api-py/app/
   ├── models/api_key.py    ← 只映射，不产生 DDL                            （03 篇）
   ├── api_keys/            ← 3 个管理接口（JWT）                          （03 篇）
   └── api/public.py        ← 1 个对外接口（API Key）                      （03 篇）
```

> 本篇只写**契约 + Prisma 建模 + 迁移**。接口实现分别在第 2、3 篇。

### 3.2 四个接口

| # | 方法与路径 | 鉴权 | 请求体 | 成功响应 | 关键点 |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /apps/{id}/api-keys` | JWT | — | `200 {items:[...]}` | 含已撤销；不含明文 |
| 2 | `POST /apps/{id}/api-keys` | JWT | `{name}` | `201 CreateApiKeyResponse` | 明文只此一次 |
| 3 | `DELETE /api-keys/{id}` | JWT | — | `204` | 撤销（软删除） |
| 4 | `POST /public/apps/{appId}/run` | **API Key** | `{inputs}` | `200` SSE | 只读已发布快照 |

**完整文件路径：`packages/contract/openapi.yaml`**（阶段 10 新增）

```yaml
  # ---------------------------------------------------------------------------
  # 3 个管理接口：登录用户（JWT）管理自己应用的 key
  # ---------------------------------------------------------------------------
  /apps/{id}/api-keys:
    get:
      operationId: listApiKeys                 # 操作 id：前端/生成器以此命名方法
      summary: 列出应用的 API Key
      description: >-
        返回该应用的全部 API Key（**含已撤销的**，`revokedAt` 非空即已撤销，便于展示历史）。
        **不含明文 key**，只有 `prefix`。仅限应用所有者。
      security:
        - bearerAuth: []                       # 管理接口用 JWT，不是 API Key
      parameters:
        - name: id                             # 路径里的应用 id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: API Key 列表
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiKeyListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"   # 应用不存在 / 不属于自己，统一 404
    post:
      operationId: createApiKey
      summary: 创建 API Key
      description: >-
        明文 `key` **只在本次响应中返回一次**；服务端只保存 SHA-256 哈希与 `prefix`（前 11 字符）。
        同一应用内未撤销的 key 不能重名。
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
              $ref: "#/components/schemas/CreateApiKeyRequest"
      responses:
        "201":
          description: 创建成功（含一次性明文 key）
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateApiKeyResponse"
        "400":
          $ref: "#/components/responses/BadRequest"   # 名字过长 / 未撤销的重名
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /api-keys/{id}:
    delete:
      operationId: revokeApiKey
      summary: 撤销 API Key
      description: >-
        **撤销**而非物理删除：把 `revokedAt` 置为当前时间，key 立即失效（不做宽限期）。
        不存在或不属于当前用户时 404。
      security:
        - bearerAuth: []
      parameters:
        - name: id                             # 路径里的 key id，不是应用 id
          in: path
          required: true
          schema:
            type: string
      responses:
        "204":
          description: 撤销成功                 # 无响应体
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  # ---------------------------------------------------------------------------
  # 1 个对外接口：API Key 鉴权，只读已发布快照
  # ---------------------------------------------------------------------------
  /public/apps/{appId}/run:
    post:
      operationId: runPublicApp
      summary: 对外运行应用（API Key 鉴权，只读已发布快照）
      description: >-
        使用 **API Key** 鉴权（`X-API-Key` 头，或 `Authorization: Bearer <key>`），
        以 `text/event-stream`（SSE）流式返回执行过程，事件与 `POST /apps/{id}/run` **完全一致**。
        只执行**已发布快照**（`published_graph_json`），草稿改动不影响线上；
        未发布时返回普通 JSON 400（`App is not published`）。
        对外运行**不支持会话**（请求体没有 `conversationId` / `userMessage`）。
      security:
        - apiKeyAuth: []                       # 这一行把「对外接口」和「管理接口」分开
      parameters:
        - name: appId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PublicRunRequest"
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
          $ref: "#/components/responses/BadRequest"   # 未发布 / 预检失败
        "401":
          $ref: "#/components/responses/Unauthorized" # 缺 key / key 无效 / key 不属于该应用
        "404":
          $ref: "#/components/responses/NotFound"     # 应用不存在
```

### 3.3 五组 schema

**完整文件路径：`packages/contract/openapi.yaml`**（`components.schemas` 内新增）

```yaml
    # 对外视图：只有 prefix，没有明文 key
    ApiKeyResponse:
      type: object
      additionalProperties: false              # 多一个字段就校验失败
      required: [id, appId, name, prefix, createdAt, lastUsedAt, revokedAt]
      properties:
        id:
          type: string                         # key 的主键
        appId:
          type: string                         # 所属应用
        name:
          type: string                         # 人读名称（同一应用内未撤销的不能重名）
        prefix:
          type: string
          description: 明文 key 的前 11 个字符（如 `sk-1a2b3c4d`），用于辨识；**不是**密钥本身
        createdAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。
        lastUsedAt:
          type: ["string", "null"]             # 可为 null：从未用过
          format: date-time
          description: 最近一次对外运行的时间；从未使用时为 `null`
        revokedAt:
          type: ["string", "null"]             # 可为 null：未撤销
          format: date-time
          description: 撤销时间；未撤销时为 `null`

    ApiKeyListResponse:
      type: object
      additionalProperties: false
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/ApiKeyResponse"

    CreateApiKeyRequest:
      type: object
      additionalProperties: false
      required: [name]
      properties:
        name:
          type: string
          minLength: 1                         # 不允许空串
          maxLength: 60                        # 按码点计；超长由服务层给专用文案

    # 创建响应 = ApiKeyResponse + 一次性明文 key
    CreateApiKeyResponse:
      type: object
      additionalProperties: false
      required: [id, appId, name, prefix, createdAt, lastUsedAt, revokedAt, key]
      properties:
        id:
          type: string
        appId:
          type: string
        name:
          type: string
        prefix:
          type: string
          description: 明文 key 的前 11 个字符（如 `sk-1a2b3c4d`）
        createdAt:
          type: string
          format: date-time
          description: >-
            时间戳。必须为 UTC、ISO-8601、毫秒精度、以 `Z` 结尾
            （形如 2026-10-18T02:36:24.278Z，固定 24 字符）。
        lastUsedAt:
          type: ["string", "null"]
          format: date-time
          description: 最近一次对外运行的时间；新建时必为 `null`
        revokedAt:
          type: ["string", "null"]
          format: date-time
          description: 撤销时间；新建时必为 `null`
        key:
          type: string
          description: >-
            **明文 key，仅此一次返回**（`sk-` + 32 位十六进制，共 35 字符）。
            服务端只保存 SHA-256 哈希，丢失后只能重新创建。

    # 对外运行请求体：比 RunRequest 少了两个字段
    PublicRunRequest:
      type: object
      additionalProperties: false
      required: [inputs]
      properties:
        inputs:
          type: object
          additionalProperties: true
          description: >-
            运行输入，键为输入变量名。**不支持会话**：没有 `conversationId` /
            `userMessage`（对外运行不写会话、不带历史）。
```

三个必须记住的契约细节：

| 细节 | 含义 |
| --- | --- |
| `ApiKeyResponse.required` **不含** `key` | 列表接口永远拿不到明文 |
| `CreateApiKeyResponse.required` **多一个** `key` | 只有创建响应携带一次 |
| `PublicRunRequest.required` **只有** `inputs` | 对外运行从契约层面就不支持会话 |

### 3.4 `apiKeyAuth`：同一份 OpenAPI 里的第二套认证

**完整文件路径：`packages/contract/openapi.yaml`**（`components.securitySchemes`）

```yaml
  securitySchemes:
    # 既有方案：管理接口用 JWT
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    # 新方案：对外运行用 API Key
    apiKeyAuth:
      type: apiKey
      in: header                               # 只声明 header 一种位置
      name: X-API-Key                          # 请求头名字
      description: >-
        对外运行应用的 API Key（创建时返回一次）。也可用
        `Authorization: Bearer <key>` 传递，两者等价。
```

为什么能并列：

- `securitySchemes` 只是**方案声明表**，可以放任意多个；
- 每个 operation 用 `security` 选择用哪一个：
  - `bearerAuth: []` → 管理接口；
  - `apiKeyAuth: []` → 对外运行；
- OpenAPI 的 `apiKey` 方案只能声明**一个位置**（`in: header` + `name`）。所以契约里只写 `X-API-Key`；`Authorization: Bearer <key>` 是**实现层的兼容传法**，写进 `description`，不写进 `security`。

> **面试考点 · 为什么不让对外接口也支持 JWT？**
> 因为两类调用者的信任模型不同：
>
> - JWT 是「用户登录态」，会过期、能访问该用户的全部资源；
> - API Key 是「应用级凭证」，只对**一个应用**有效，可以单独撤销。
>
> 把两者混在一个接口里，会让「这把 key 到底能干什么」变得不可推理。**鉴权方式跟着资源边界走**，而不是跟着方便走。

### 3.5 `PublicRunRequest` 为什么只有 `inputs`

对比草稿运行的 `RunRequest`：

| 字段 | `RunRequest`（草稿） | `PublicRunRequest`（对外） |
| --- | --- | --- |
| `inputs` | ✅ | ✅ |
| `conversationId` | ✅ 可选 | ❌ |
| `userMessage` | ✅ 可选 | ❌ |

为什么要在**契约层**砍掉，而不是运行期忽略：

| 做法 | 后果 |
| --- | --- |
| 契约保留字段、实现里忽略 | 生成 SDK / 文档会出现这些字段；调用方以为支持，传了却不生效；测试要覆盖「传了但没用」 |
| 契约直接不声明（本项目） | 调用方**看不到**这些字段；传了会被 `additionalProperties: false` 拒绝；实现不需要分支 |

这就是「契约即文档」的价值：**能力边界写在 schema 里，而不是写在注释里**。

对应到运行期：

- `run_started` 事件**不带** `conversationId`；
- 不写任何 `messages` 行；
- 不读 `pool.conversation`，`useHistory: true` 的节点在对外运行里拿不到历史（等价于没有会话）。

### 3.6 错误文案

**完整文件路径：`packages/contract/error-messages.md`**（新增 §10）

| 场景 | HTTP | message |
| --- | --- | --- |
| 未提供 key | 401 | `Missing API key` |
| key 无效 / 已撤销 | 401 | `Invalid API key` |
| 应用未发布（`published_graph_json` 为 null） | 400 | `App is not published` |
| 应用不存在 | 404 | `App not found` |
| key 名称过长 | 400 | `API key name is too long` |
| key 名称重复（同一应用内，未撤销的） | 400 | `API key name already exists` |
| 撤销不存在 / 不属于自己的 key | 404 | `API key not found` |

对外运行的**校验顺序**（顺序决定文案，不能随意调换）：

```text
POST /public/apps/{appId}/run  { inputs }  +  X-API-Key: sk-...
  │
  ├─ 1. 取 key：X-API-Key 优先，其次 Authorization: Bearer <key>
  │       都没有 → 401 Missing API key
  ├─ 2. sha256(key) 查 api_keys，且 revoked_at 为空
  │       查不到 / 已撤销 → 401 Invalid API key
  ├─ 3. key.app_id === 路径 appId？
  │       否 → 先查 app 是否存在：
  │             不存在 → 404 App not found
  │             存在   → 401 Invalid API key
  ├─ 4. 读 app.published_graph_json
  │       为 null → 400 App is not published
  └─ 5. 执行图 → SSE 流
```

两个容易写错的点：

1. **先 key 后 app**：没有 key 就直接 401，不查应用，避免「用 404/400 的差异探测某个 appId 是否存在」。
2. **key 不属于该 app 时**：不是无条件 401。如果 `appId` 根本不存在，应给 404 `App not found`；只有应用存在、但 key 不属于它，才是 401 `Invalid API key`。

### 3.7 TS 类型

**完整文件路径：`packages/contract/src/index.ts`**（阶段 10 新增）

```ts
/** 契约版本：与 openapi.yaml 的 info.version 必须一致。 */
export const CONTRACT_VERSION = '0.10.0'

/** API Key 对外视图（**不含明文 key**，只有 `prefix`）。 */
export interface ApiKeyResponse {
  /** key 主键 */
  id: string
  /** 所属应用 */
  appId: string
  /** 人读名称 */
  name: string
  /** 明文 key 的前 11 个字符（如 `sk-1a2b3c4d`），用于辨识；不是密钥本身 */
  prefix: string
  /** 时间戳：UTC、ISO-8601、毫秒精度、以 `Z` 结尾（24 字符） */
  createdAt: string
  /** 最近一次对外运行的时间；从未使用时为 `null` */
  lastUsedAt: string | null
  /** 撤销时间；未撤销时为 `null` */
  revokedAt: string | null
}

/** GET /apps/{id}/api-keys 的响应体（含已撤销的，便于展示历史）。 */
export interface ApiKeyListResponse {
  items: ApiKeyResponse[]
}

/** POST /apps/{id}/api-keys 请求体。 */
export interface CreateApiKeyRequest {
  /** 1-60 位（按码点计） */
  name: string
}

/** POST /apps/{id}/api-keys 的响应体：在 ApiKeyResponse 之外附带**一次性明文 key**。 */
export interface CreateApiKeyResponse extends ApiKeyResponse {
  /** 明文 key（`sk-` + 32 位十六进制，共 35 字符），**仅此一次返回** */
  key: string
}

/**
 * POST /public/apps/{appId}/run 请求体。
 *
 * **不支持会话**：没有 `conversationId` / `userMessage`（对外运行不写会话、不带历史）。
 */
export interface PublicRunRequest {
  /** 运行输入，键为输入变量名 */
  inputs: Record<string, unknown>
}
```

`CreateApiKeyResponse extends ApiKeyResponse` 是 TS 侧的写法；映射到 OpenAPI 就是「required 多一个 `key`、properties 多一个 `key`」。**两边字段集合必须一致**，否则生成的客户端会出现「有的语言有 key、有的没有」。

---

## 4. Prisma 建模

### 4.1 `ApiKey` 模型

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**（阶段 10 新增）

```prisma
/// API Key（阶段 10）：对外运行应用的凭证。**只存哈希**，明文仅在创建时返回一次。
model ApiKey {
  /// 主键：由 Prisma 客户端生成 uuid（数据库没有 DEFAULT，见迁移）
  id          String    @id @default(uuid())
  /// 所属应用：外键，删应用级联删 key
  appId       String    @map("app_id")
  /// 所属用户：冗余字段，便于单表做归属校验（见 §4.5）
  ownerId     String    @map("owner_id")
  /// 人读名称：同一应用内「未撤销」的 key 不能重名
  name        String
  /// 明文 key 的前 11 个字符（`sk-` + 8 位十六进制），仅用于列表辨识
  keyPrefix   String    @map("key_prefix")
  /// sha256(明文 key) 的 64 位十六进制；唯一，按它精确查找
  keyHash     String    @unique @map("key_hash")
  /// 创建时间：数据库默认 CURRENT_TIMESTAMP
  createdAt   DateTime  @default(now()) @map("created_at")
  /// 最近一次对外运行的时间：认证通过后顺手刷新；从未使用为 null
  lastUsedAt  DateTime? @map("last_used_at")
  /// 撤销时间：非空即已撤销（软删除），不做物理删除
  revokedAt   DateTime? @map("revoked_at")

  /// 多对一：删除应用时，该应用的 key 一并删除
  app   App  @relation(fields: [appId], references: [id], onDelete: Cascade)
  /// 多对一：删除用户时，其签发的 key 一并删除
  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  /// 列表查询：WHERE app_id = ? ORDER BY created_at DESC
  @@index([appId])
  @@map("api_keys")
}
```

### 4.2 两侧反向关系

```prisma
model User {
  // ... 既有字段
  /// 该用户签发的全部 API Key（阶段 10）
  apiKeys ApiKey[]
}

model App {
  // ... 既有字段
  /// 该应用名下的全部 API Key（阶段 10）
  apiKeys ApiKey[]
}
```

Prisma 要求关系**两端都声明**；少了反向字段，`prisma validate` 会直接报错。这也是为什么只加 `ApiKey` 模型不够，必须同时改 `User` / `App`。

### 4.3 API Key 的四元组

| 字段 | 回答的问题 | 存在哪 | 谁能看到 |
| --- | --- | --- | --- |
| `name` | 人怎么称呼它 | `api_keys.name` | 列表 / 创建响应 |
| `prefix` | 列表里怎么认出它 | `api_keys.key_prefix` | 列表 / 创建响应 |
| `key_hash` | 服务端怎么校验 | `api_keys.key_hash` | 只有数据库 |
| `key`（明文） | 调用方拿什么发请求 | **不存** | 只在创建响应出现一次 |

四个字段缺一不可：

- 没有 `name`：列表里三把 key 长得一样，人无法管理；
- 没有 `prefix`：列表只能显示 id，用户不知道哪把是正在用的；
- 没有 `key_hash`：服务端无法在不存明文的前提下校验；
- 没有明文 `key`：调用方拿不到凭证。

> **面试考点 · 为什么 `prefix` 不算泄露？**
> `prefix` 是明文 key 的**前 11 个字符**（`sk-` + 8 hex），而 key 总长 35 字符（`sk-` + 32 hex）。
> 剩下 24 个 hex 字符 = 96 bit 熵，暴力枚举不可行。
>
> 反过来，如果 prefix 取太长（比如前 30 字符），泄露后就只剩 2 个 hex 可猜——**prefix 的长度是安全性与可辨识性的折中**。

### 4.4 `key_hash` 为什么唯一，为什么用 SHA-256

`@unique` 的两个作用：

1. **按哈希精确查找**：对外运行必须能用一条索引查询命中，`findUnique({ where: { keyHash } })` 依赖唯一约束；
2. **兜底防重复**：128 bit 随机数碰撞概率极低，但数据库约束让「同一 key 被签发两次」在物理上不可能。

为什么不用 bcrypt / argon2：

| 维度 | 密码 | API Key |
| --- | --- | --- |
| 熵 | 低（用户可猜） | 高（`randomBytes(16)` = 128 bit） |
| 威胁 | 拖库后离线爆破 | 拖库后直接使用 |
| 需要慢哈希 | ✅ 提高爆破成本 | ❌ 无意义 |
| 需要按哈希查 | ❌ 可以全表扫 | ✅ 必须走索引 |

关键结论：

- **慢哈希防的是「猜密码」，不是「偷 key」**。key 是 128 bit 随机数，爆破空间是 $2^{128}$，SHA-256 已经足够；
- bcrypt 每次哈希带随机盐，**同一个 key 每次结果不同**，无法用 `WHERE key_hash = ?` 查询——只能全表逐行 `compare`，O(n) 且无法走索引；
- 如果 key 泄露，攻击者直接拿明文调用，哈希再慢也拦不住。**该做的是撤销 + 轮换，不是换哈希算法**。

### 4.5 `owner_id` 为什么要冗余

`api_keys.app_id → apps.owner_id → users.id` 已经能推出归属用户，为什么还存一份：

| 方案 | 列表 / 撤销时的归属校验 | 应用转移所有者 |
| --- | --- | --- |
| 只存 `app_id` | 需要 join `apps` | 自动跟随 |
| 存 `owner_id`（本项目） | 单表比较 | **需要同步更新** |

取舍与 `conversations.owner_id` 完全一致：**读多写少，用冗余换查询简单**；代价是「应用转移」时要同步，而本项目没有转移功能。

> 数据库层面无法保证 `api_keys.owner_id === apps.owner_id`。这靠**写入只走 Service**（`ownerId` 从 token 取，不允许客户端传）来保证。

### 4.6 撤销为什么是软删除

`DELETE /api-keys/{id}` 只把 `revoked_at` 置为当前时间：

| 做法 | 优点 | 问题 |
| --- | --- | --- |
| 物理 `DELETE` | 表干净 | 无法回答「这把 key 什么时候被删的」；列表看不到历史 |
| 软删除（本项目） | 可审计、可展示、可追溯 | 表会增长；查询要带 `revoked_at IS NULL` |

三个相关规则：

1. **已撤销立即失效**：认证查询必须同时满足 `key_hash = ?` 且 `revoked_at IS NULL`；
2. **重名只算未撤销的**：撤销后可以复用同名，便于轮换（这是服务层规则，02 篇展开）；
3. **列表包含已撤销的**：前端用 `revokedAt` 是否为空渲染「已撤销」标签。

### 4.7 为什么 `id` 没有数据库默认值

Prisma 的 `@default(uuid())` 是**客户端默认值**：生成的 SQL 是 `INSERT ... VALUES ($1, ...)`，`id` 由 Prisma Client 在 Node 进程里生成，数据库列上**没有** `DEFAULT gen_random_uuid()`。

后果：

- 直接写 SQL 插入 `api_keys` 时必须自己提供 `id`；
- Python 侧映射也没有 `server_default`，写入时用 `uuid4()`（03 篇）。

这与 `created_at` 不同：`created_at` 的 `@default(now())` 会生成数据库默认值 `CURRENT_TIMESTAMP`，直接 SQL 插入可以省略。

---

## 5. 迁移

**完整文件路径：`apps/api-ts/prisma/migrations/20261023115759_add_api_keys/migration.sql`**

```sql
-- 注意：Prisma 自动生成的 `DROP INDEX "chunks_embedding_hnsw"` 已手工移除。
-- 该 HNSW 索引由 migration `add_knowledge_base` 创建、由 `prisma/sql/hnsw.sql` 维护，
-- 不属于 Prisma 的 schema，不能让 `migrate dev` 顺手删掉。

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,                                      -- 应用侧生成 uuid，无 DEFAULT
    "app_id" TEXT NOT NULL,                                  -- 所属应用
    "owner_id" TEXT NOT NULL,                                -- 所属用户（冗余）
    "name" TEXT NOT NULL,                                    -- 人读名称
    "key_prefix" TEXT NOT NULL,                              -- 明文前 11 字符
    "key_hash" TEXT NOT NULL,                                -- sha256 十六进制（64 字符）
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),                             -- 可空：从未使用
    "revoked_at" TIMESTAMP(3),                               -- 可空：未撤销

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_app_id_idx" ON "api_keys"("app_id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_app_id_fkey"
  FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

三个索引分别支撑什么：

| 索引 | 支撑的查询 |
| --- | --- |
| `api_keys_pkey`（主键） | 按 `id` 撤销 / 查详情 |
| `api_keys_key_hash_key`（唯一） | 对外运行：`WHERE key_hash = sha256(key)` |
| `api_keys_app_id_idx` | 列表：`WHERE app_id = ? ORDER BY created_at DESC` |

> 注意：这里**没有**为 `owner_id` 建索引。撤销接口按主键 `id` 查，再比较 `owner_id`，不需要 `WHERE owner_id = ?` 的扫描；如果以后要做「列出我签发的全部 key」，才需要补索引。

### 5.1 执行

```powershell
# 1. 由 schema 生成并应用迁移（名字带时间戳前缀）
pnpm --filter @mini-dify/api-ts db:migrate -- --name add_api_keys

# 2. 重新生成 Prisma Client（让 `prisma.apiKey` 可用）
pnpm --filter @mini-dify/api-ts db:generate
```

预期：

```text
✔ Generated Prisma Client
The following migration(s) have been created and applied from new schema changes:
migrations/
  └─ 20261023115759_add_api_keys/
    └─ migration.sql
```

---

## 6. 验证

> 以下命令都在仓库根目录 `d:\user\my_project\github\mini-dify` 执行。
> Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，需要时请写 `curl.exe`。

### 6.1 契约构建与版本

```powershell
# 编译契约包（openapi.yaml 本身不参与编译，但类型文件会产出 dist）
pnpm --filter @mini-dify/contract build

# 版本号必须两处一致
Select-String -Path packages/contract/openapi.yaml -Pattern 'version: 0.10.0'
Select-String -Path packages/contract/src/index.ts -Pattern "CONTRACT_VERSION = '0.10.0'"

# 4 个操作必须都在
Select-String -Path packages/contract/openapi.yaml -Pattern 'operationId: (listApiKeys|createApiKey|revokeApiKey|runPublicApp)'

# 安全方案必须两个都在
Select-String -Path packages/contract/openapi.yaml -Pattern '(bearerAuth|apiKeyAuth):'
```

预期：每条命令都有命中；`listApiKeys` / `createApiKey` / `revokeApiKey` / `runPublicApp` 各出现一次。

### 6.2 表结构

```powershell
docker compose exec -T db psql -U mini_dify -d mini_dify -c "\d api_keys"
```

预期关键行：

```text
 Column      | Type         | Nullable | Default
-------------+--------------+----------+-----------------------------
 id          | text         | not null |
 app_id      | text         | not null |
 owner_id    | text         | not null |
 name        | text         | not null |
 key_prefix  | text         | not null |
 key_hash    | text         | not null |
 created_at  | timestamp(3) | not null | CURRENT_TIMESTAMP
 last_used_at| timestamp(3) |          |
 revoked_at  | timestamp(3) |          |
Indexes:
    "api_keys_pkey" PRIMARY KEY, btree (id)
    "api_keys_key_hash_key" UNIQUE, btree (key_hash)
    "api_keys_app_id_idx" btree (app_id)
Foreign-key constraints:
    "api_keys_app_id_fkey" FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    "api_keys_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
```

> `id` 的 `Default` 必须是**空**——这是「Prisma 客户端生成 uuid」的证据。

### 6.3 `key_hash` 唯一约束

先取一个已有的应用与用户：

```powershell
# 登录拿 token / userId
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType "application/json" `
  -Body '{"email":"alice@example.com","password":"password123"}'
$token = $login.accessToken
$userId = $login.user.id

# 建一个临时应用（验证完会删掉）
$tempApp = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"name":"api-key-test"}').id
```

插入两条同 `key_hash` 的记录：

```powershell
# 64 个 a：模拟 sha256 的十六进制摘要
$hash = 'a' * 64

# 第一条：成功
docker compose exec -T db psql -U mini_dify -d mini_dify -c `
  "INSERT INTO api_keys (id, app_id, owner_id, name, key_prefix, key_hash) VALUES ('k-test-1', '$tempApp', '$userId', 'demo', 'sk-12345678', '$hash');"

# 第二条：同 key_hash，必须失败
docker compose exec -T db psql -U mini_dify -d mini_dify -c `
  "INSERT INTO api_keys (id, app_id, owner_id, name, key_prefix, key_hash) VALUES ('k-test-2', '$tempApp', '$userId', 'demo2', 'sk-87654321', '$hash');"
```

预期第二条：

```text
ERROR:  duplicate key value violates unique constraint "api_keys_key_hash_key"
DETAIL:  Key (key_hash)=(aaaa...aaaa) already exists.
```

> 这说明「按 hash 精确查找」在数据库层是唯一命中，不会出现「一把 key 查到两行」。

### 6.4 级联删除

```powershell
# 删掉临时应用
docker compose exec -T db psql -U mini_dify -d mini_dify -c `
  "DELETE FROM apps WHERE id = '$tempApp';"

# 该应用名下的 key 必须一并消失
docker compose exec -T db psql -U mini_dify -d mini_dify -c `
  "SELECT count(*) FROM api_keys WHERE app_id = '$tempApp';"
```

预期：

```text
 count
-------
     0
```

> 用户删除同理：`DELETE FROM users WHERE id = '...'` 会级联删掉其签发的全部 key。

### 6.5 客户端 uuid 与哈希长度

```powershell
# id 无默认值；created_at 有默认值
docker compose exec -T db psql -U mini_dify -d mini_dify -c `
  "SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'api_keys' AND column_name IN ('id', 'created_at');"
```

预期：

```text
 column_name |        column_default
-------------+------------------------------
 id          |
 created_at  | CURRENT_TIMESTAMP
```

如果还要验证哈希长度，可以在 02 篇接口就位后执行：

```sql
SELECT length(key_hash) FROM api_keys;   -- 必须是 64
```

---

## 7. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| 发布到底发布了什么 | 把草稿 JSON **复制**进 `published_graph_json`，并记录 `published_at` |
| 为什么不是指针 | 草稿一改线上就变，无法复现线上行为；复制后两份独立 |
| 为什么只留一份快照 | 本阶段不做版本历史；回滚是扩展点，代价是每次发布覆盖 |
| API Key 四元组 | `name` 人读、`prefix` 辨识、`key_hash` 校验、`key` 一次性明文 |
| 为什么不存明文 | 拖库即全部泄露；只存哈希，服务端也无法还原 |
| 为什么 SHA-256 不是 bcrypt | key 是 128 bit 随机数，不需要慢哈希；且必须按哈希走唯一索引查询 |
| `prefix` 为什么 11 字符 | `sk-` + 8 hex，够辨识；剩余 96 bit 熵不可爆破 |
| `key_hash` 为什么唯一 | `findUnique` 依赖唯一约束；同时兜底防重复签发 |
| 撤销为什么软删除 | 审计、列表可追溯；已撤销立即失效，重名只算未撤销的 |
| `owner_id` 为什么冗余 | 单表做归属校验；代价是应用转移时要同步 |
| `PublicRunRequest` 为什么只有 `inputs` | 对外调用没有「谁的历史」；契约层砍字段而不是运行期忽略 |
| 两套认证为什么能并列 | `securitySchemes` 是声明表，每个 operation 用 `security` 选一个 |
| 为什么先校验 key 再查应用 | 避免用 401/404 的差异探测 appId 是否存在 |
| key 不属于该应用为什么可能是 404 | 应用不存在给 404；应用存在但 key 不匹配才是 401 |
| 未发布为什么是 400 不是 404 | 应用存在、只是没有可运行的快照；是「状态不满足」而非「资源不存在」 |
| `id` 为什么没有 DEFAULT | Prisma `@default(uuid())` 是客户端默认值，DDL 里不带 `DEFAULT` |

---

## 8. 下一步

- `02-API-Key安全设计.md`：`ApiKeysService` 的生成、哈希、校验、重名规则、撤销、`lastUsedAt`、时序比较与限流边界。
- `03-对外SSE接口与双后端对齐.md`：`PublicController`、`EngineService.runPublished`、Python 的 `api_keys` / `public`、校验顺序与文案逐字节一致。
- `04-前端发布面板与调用示例.md`：发布按钮、key 列表、一次性明文提示、`curl` 调用示例。
- `05-验收.md`：快照隔离、key 生命周期、跨端一致、回归清单。
