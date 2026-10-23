# 01 · 发布语义与 API-Key 契约

> 所属：阶段 10 · 发布与 API
>
> 本篇覆盖：把 `packages/contract/openapi.yaml` 的版本升到 **`0.10.0`**，新增 **4 个接口**（`GET|POST /apps/{id}/api-keys`、`DELETE /api-keys/{id}`、`POST /public/apps/{appId}/run`）、**5 组 schema**（`ApiKeyResponse` / `ApiKeyListResponse` / `CreateApiKeyRequest` / `CreateApiKeyResponse` / `PublicRunRequest`）、**1 个安全方案**（`apiKeyAuth`），并在 `src/index.ts` 同步类型；在 `error-messages.md` 新增 **§10 发布与 API Key**（7 条文案）；用 Prisma 建 `api_keys` 表并生成迁移 `20261023115759_add_api_keys`；Python 侧只做 SQLAlchemy 映射；最后给出 NestJS 的 `api-keys.controller.ts` 与 FastAPI 的 `app/api/api_keys.py`，以及承载「生成 key / 校验 key」的服务片段。
>
> **本篇首次教学**：① **「发布」到底发布什么**——草稿 `graphJson` 与快照 `publishedGraphJson` 是**两份独立数据**，发布 = 把草稿**复制**成快照；② **为什么必须隔离**——搭建者随时改草稿，线上调用不能跟着变，**没有隔离，改一个字就影响所有线上用户**；③ **发布是「复制」而不是「引用」**——快照存的是**当时的完整图**，不是指向草稿的指针（「快照」的本质）；④ **API Key 的四元组**——`name`（人读）/ `prefix`（展示）/ `key_hash`（校验）/ `key`（明文，**只在创建时返回一次**）；⑤ **Key 格式与生成**——`sk-` + 32 位十六进制（`crypto.randomBytes(16)` / `secrets.token_hex(16)`），共 **35 字符**，`prefix = key.slice(0, 11)`；⑥ **为什么 `key_hash` 要 `@unique`**——按 hash 精确查找天然唯一，也杜绝「同一个 key 被重复签发」；⑦ **4 个接口的契约分工**——3 个管理接口（JWT）+ 1 个对外接口（API Key），列表接口**不返回明文**、撤销返回 **204**；⑧ **`apiKeyAuth` 安全方案**——`type: apiKey` / `in: header` / `name: X-API-Key`，与 `bearerAuth` **并列共存于同一份 OpenAPI**；⑨ **`PublicRunRequest` 为什么只有 `inputs`**——对外接口不暴露会话与用户消息，**契约层面就把字段砍掉**，而不是运行期忽略；⑩ **对外运行的校验顺序与 7 条固定文案**（含「未发布是 400、应用不存在是 404」）。
>
> （已在前序篇教学、本篇只引用不重讲：OpenAPI 的 `paths` / `$ref` / `enum` / `additionalProperties` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；`securityScheme`（HTTP Bearer JWT）与「错误信封」见 `01-账号与认证/01-契约扩展.md`；Prisma 三件套、schema-first、迁移即 DDL 版本化、`@unique` / `@@index` / `@map` / `@default` 见 `01-账号与认证/02-Prisma.md`、`02-应用管理/02-Prisma关系建模.md`；SQLAlchemy 2.0 的 `DeclarativeBase` / `Mapped` / `mapped_column` / `relationship` / `passive_deletes` 与「迁移所有权（Prisma 拥有 DDL，SQLAlchemy 只映射）」见 `01-账号与认证/04-SQLAlchemy2.0.md`、`02-应用管理/04-SQLAlchemy关系建模.md`；REST 资源化设计（`{items}` 包装 / `POST` 201 / `DELETE` 204 / 404 而非 403）见 `02-应用管理/01-契约扩展.md`；`iso_z` 时间序列化与 UTC 归一化见 `02-应用管理/07-验收.md`；**JSONB 与「两态」列级建模（草稿 vs 发布快照）**见 `03-画布/02-Prisma-JSONB与两态.md`；SSE 帧格式、「先校验、后开流」与双通道错误见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/05-SSE流式响应实现.md`；`JwtAuthGuard` / `@CurrentUser` / `ValidationPipe` / DTO 见 `01-账号与认证/03-NestJS认证.md`；Pydantic v2 `BaseModel` / `ConfigDict(extra="forbid")` / `field_serializer` 见 `00-项目初始化/06-FastAPI起步.md`、`01-账号与认证/05-FastAPI认证.md`；会话的 `ownerId` 归属与三层校验见 `09-会话与记忆/01-会话契约与数据建模.md`。）
>
> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 10 的立论：从「自己用」到「给别人用」

前九个阶段，所有接口都有一个共同前提：

> **调用者就是登录用户本人。**

`JWT` 认人，`ownerId` 认应用，`POST /apps/{id}/run` 读的是**草稿**图。整个系统像一个「搭建者的工作台」：你搭、你调、你跑。

阶段 10 要打开一扇门——**让别人调用你搭好的应用**。这扇门一开，立刻冒出两个新问题：

| 新问题 | 本阶段的答案 | 对应机制 |
| --- | --- | --- |
| 线上调用的到底是**哪一份图**？ | 已发布快照，不是草稿 | `publishedGraphJson` + `POST /graph/publish` |
| 调用者是谁？他凭什么能调？ | 应用的所有者签发的凭证 | `api_keys` + `X-API-Key` |

这两个问题必须一起回答，而且答案是**正交**的：

- **「跑哪份图」** 属于**发布语义**：快照是草稿的拷贝，草稿怎么改都不影响线上；
- **「谁在调」** 属于**凭证语义**：一把 key 绑定一个应用，只存哈希，撤销立即失效。

### 0.1 一句话记住这个阶段

> **发布 = 把草稿复制成快照；对外调用 = 用快照 + 用 key。**

### 0.2 四条边界（本阶段刻意不做的事）

| 不做 | 原因 |
| --- | --- |
| 对外运行**不支持会话** | 调用方不是登录用户，没有「谁的历史」这一概念；契约里直接把 `conversationId` / `userMessage` 砍掉 |
| 撤销**不做物理删除** | 要保留「曾经签发过什么」的审计痕迹，列表里还要能看见它 |
| 发布**只保留一份快照** | 没有版本历史 / 回滚；每次发布覆盖上一份（回滚是后续阶段的扩展点） |
| **不做限流** | 生产必须做，本阶段只留注释（`PublicController` 里有明确标注） |

---

## 1. 本篇目标

做完这一篇，你能：

- 在契约里新增 4 个接口、5 组 schema、1 个 `apiKeyAuth` 安全方案，并把 `CONTRACT_VERSION` 升到 **`0.10.0`**。
- 说清「发布」到底发布了什么，以及草稿与快照为什么必须是**两份独立数据**。
- 说清为什么发布是「复制」而不是「引用」，以及如果做成指针会发生什么。
- 说清 API Key 的四个字段各自回答什么问题、为什么四个都不能省。
- 说清 key 的格式（`sk-` + 32 hex = 35 字符）与 `prefix` 的取法（前 11 字符）。
- 说清 `key_hash` 为什么必须 `@unique`，以及为什么是 SHA-256 而不是 bcrypt。
- 说清 4 个接口分别用哪套鉴权、为什么列表不返回明文、为什么撤销是 204。
- 说清 `apiKeyAuth` 与 `bearerAuth` 如何**并列**存在于同一份 OpenAPI 里。
- 说清 `PublicRunRequest` 为什么只有 `inputs`，以及「契约砍字段」和「运行期忽略」的区别。
- 说清对外运行的**校验顺序**，并能逐字背出 7 条错误文案。

**验收标准**

1. `pnpm run build:contract` 成功；`packages/contract/src/index.ts` 的 `CONTRACT_VERSION` 与 `openapi.yaml#/info/version` 均为 **`0.10.0`**。
2. `openapi.yaml` 含且仅含这 4 个新操作：`listApiKeys` / `createApiKey` / `revokeApiKey` / `runPublicApp`。
3. `components.securitySchemes` 同时含 `bearerAuth`（`type: http` / `scheme: bearer`）与 `apiKeyAuth`（`type: apiKey` / `in: header` / `name: X-API-Key`）。
4. `CreateApiKeyResponse.required` 比 `ApiKeyResponse` 多一个 **`key`**；`ApiKeyResponse.required` **不含** `key`。
5. `PublicRunRequest.required` 恰为 `[inputs]`，`additionalProperties: false`，且**没有** `conversationId` / `userMessage`。
6. 数据库 `api_keys` 有 **`UNIQUE (key_hash)`**、`app_id` 索引，以及两条 `ON DELETE CASCADE` 外键。
7. 创建响应含明文 `key`：以 `sk-` 开头、长度 **35**、`prefix` 恰为 `key` 的前 **11** 个字符。
8. 列表响应**不含** `key` 字段，条目字段为 `id, appId, name, prefix, createdAt, lastUsedAt, revokedAt`。
9. 撤销后列表仍返回该条（`revokedAt` 非空），但用它调用对外接口 → **401 `Invalid API key`**。
10. 数据库 `key_hash` 为 **64 位十六进制**，表中**不出现**明文 key。
11. 改草稿后不重新发布，对外调用的输出**不变**；重新发布后才变。
12. 7 条错误文案逐字命中（见 §12.10 与 §13）。
13. 删除应用后，该应用的 `api_keys` 行数为 **0**（级联清零）。

---

## 2. 前置条件

| 前置 | 状态要求 | 出处 |
| --- | --- | --- |
| 本地中间件 | `docker compose ps` 里 `mini-dify-db` 为 `healthy` | `00-项目初始化/02-本地中间件Docker.md` |
| 契约可编译 | `pnpm run build:contract` 可用；阶段 9 时是 `0.9.0` | `00-项目初始化/04`、`09-会话与记忆/01` |
| 认证就位 | 已能注册 / 登录；`Bearer` 令牌跨端互认 | `01-账号与认证/06`、`07` |
| 应用管理 | 已能 `POST /apps` 建应用 | `02-应用管理/03` |
| 画布两态 | 应用行上已有 `graph_json` / `published_graph_json` / `published_at` 三列，且 `POST /apps/{id}/graph/publish` 可用 | `03-画布/02`、`03-画布/03` |
| 执行引擎 | 已能 `POST /apps/{id}/run` 拿到 SSE 流 | `04-执行引擎/02`、`05` |
| 两套后端 | api-ts 监听 `:3001`、api-py 监听 `:8000` | `00-项目初始化/08` |

> 本篇**只新增**凭证表、凭证接口与对外运行接口；**不改**草稿运行、会话、RAG、分支等既有行为。
>
> 本篇的验收**不需要任何 LLM 密钥**：示例图是 `start → end`，不调用模型。

---

## 3. 先看清要做什么

### 3.1 文件地图

```
packages/contract/
   ├── openapi.yaml          ← 4 个路径 + apiKeyAuth + 5 组 schema；info.version = 0.10.0   （本篇 §5）
   ├── src/index.ts          ← 同步类型；CONTRACT_VERSION = 0.10.0                          （本篇 §6）
   └── error-messages.md     ← §10 发布与 API Key（7 条文案）                               （本篇 §7）
        ↓ pnpm run build:contract
      dist/index.js + dist/index.d.ts

apps/api-ts/
   ├── prisma/schema.prisma  ← ApiKey + User/App 两条反向关系                              （本篇 §8.1）
   ├── prisma/migrations/20261023115759_add_api_keys/migration.sql                         （本篇 §8.2）
   └── src/
        ├── api-keys/
        │    ├── api-keys.controller.ts        ← 3 个管理接口（JWT）                        （本篇 §10.1）
        │    ├── api-keys.service.ts           ← 生成 key / 校验 key / 撤销                 （本篇 §10.2 摘录）
        │    ├── dto/create-api-key.dto.ts                                                  （本篇 §10.3）
        │    └── api-keys.module.ts                                                         （本篇 §10.4）
        └── public/
             ├── public.controller.ts          ← 1 个对外接口（API Key）                     （本篇 §10.5）
             └── dto/public-run.dto.ts                                                      （本篇 §10.6）

apps/api-py/app/
   ├── models/api_key.py      ← 只映射，不产生 DDL                                         （本篇 §9）
   ├── api/api_keys.py        ← 3 个管理接口（JWT）                                        （本篇 §11.1）
   ├── api_keys/service.py    ← 生成 key / 校验 key / 撤销                                 （本篇 §11.2 摘录）
   └── api/public.py          ← 1 个对外接口（API Key）                                     （本篇 §11.3）
```

### 3.2 4 个 HTTP 接口

| # | 方法与路径 | 鉴权 | 请求体 | 成功响应 | 关键点 |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /apps/{id}/api-keys` | **JWT** | — | `200` `{items:[ApiKey]}` | **含已撤销的**；按 `createdAt` 倒序；**不含明文** |
| 2 | `POST /apps/{id}/api-keys` | **JWT** | `{name}` | `201` `CreateApiKeyResponse` | 明文 `key` **只此一次**；同应用内未撤销的重名冲突 |
| 3 | `DELETE /api-keys/{id}` | **JWT** | — | `204` 无响应体 | **撤销**（置 `revokedAt`），不物理删除 |
| 4 | `POST /public/apps/{appId}/run` | **API Key** | `{inputs}` | `200` SSE | **只读已发布快照**；不支持会话 |

> 3 个管理接口都挂在 **应用所有者** 名下，用 JWT；只有第 4 个对外，用 API Key。**同一个系统里两套认证并存**，这是本阶段最值得记住的结构。

### 3.3 一次对外调用，发生了什么

```
POST /public/apps/{appId}/run  { inputs }   +  X-API-Key: sk-...
  │
  ├─ 1. 取 key（X-API-Key 优先，其次 Authorization: Bearer <key>）
  │       没有 → 401 Missing API key
  ├─ 2. sha256(key) 查 api_keys，且 revokedAt 为空
  │       查不到 / 已撤销 → 401 Invalid API key
  ├─ 3. key.appId === 路径 appId？
  │       否 → 若应用不存在：404 App not found；否则 401 Invalid API key
  ├─ 4. 读 app.publishedGraphJson
  │       为 null → 400 App is not published
  ├─ 5. 用**快照**跑预检（hasConversation = false）
  │       失败 → 400 普通 JSON（与草稿运行的文案一致）
  └─ 6. 执行图 → SSE 流（事件与 POST /apps/{id}/run **完全一致**）
          run_started 不带 conversationId；不写任何会话消息
```

### 3.4 数据库里长什么样

`api_keys` 一行（明文 key 不在表里）：

| 列 | 示例 | 说明 |
| --- | --- | --- |
| `id` | `6f1c…`（uuid） | 应用侧生成 |
| `app_id` | `app_…` | 外键，级联删除 |
| `owner_id` | `user_…` | 外键，级联删除 |
| `name` | `demo-key` | 人读名称 |
| `key_prefix` | `sk-e217e49c` | 11 字符，列表展示 |
| `key_hash` | `3f7a…`（**64 位十六进制**） | `sha256(明文 key)`，唯一 |
| `created_at` | `2026-10-23T11:57:59.000` | 毫秒精度 |
| `last_used_at` | `null` | 最近一次对外运行 |
| `revoked_at` | `null` | 非空即已撤销 |

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行；两个 dev server 各自单开终端。
> Windows PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请写 **`curl.exe`**。

| # | 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- | --- |
| 1 | `pnpm run build:contract` | 仓库根 | 把 `0.10.0` 契约编译进 `dist`，供两端与前端消费 | 无报错；`dist/index.js`、`index.d.ts` 更新 |
| 2 | `pnpm --filter @mini-dify/api-ts exec prisma migrate dev --name add_api_keys` | 仓库根 | 由 schema 生成并应用迁移，建 `api_keys` 表 | 生成 `prisma/migrations/<时间戳>_add_api_keys/migration.sql` 并 `applied` |
| 3 | `pnpm --filter @mini-dify/api-ts db:generate` | 仓库根 | 重新生成 Prisma Client（`apiKey` 模型可用） | `Generated Prisma Client` |
| 4 | `docker exec -i mini-dify-db psql -U postgres -d minidify -c "\d api_keys"` | 仓库根 | 验证列、唯一索引、外键 | 见下方输出 |
| 5 | `pnpm dev:api-ts` | 仓库根（终端 A） | 启动 NestJS | `Nest application successfully started`，监听 `:3001` |
| 6 | `pnpm dev:api-py` | 仓库根（终端 B） | 启动 FastAPI（Python 侧**没有**迁移，只映射同一张表） | `Uvicorn running on http://127.0.0.1:8000` |

第 4 步的预期输出（关键行）：

```text
 id            | text                        | not null |
 app_id        | text                        | not null |
 key_prefix    | text                        | not null |
 key_hash      | text                        | not null |
 last_used_at  | timestamp(3)                |          |
 revoked_at    | timestamp(3)                |          |
Indexes:
    "api_keys_pkey" PRIMARY KEY, btree (id)
    "api_keys_key_hash_key" UNIQUE, btree (key_hash)
    "api_keys_app_id_idx" btree (app_id)
Foreign-key constraints:
    "api_keys_app_id_fkey" FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE ON UPDATE CASCADE
    "api_keys_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
```

**关于第 2 步的两点说明**

1. **仓库现状里迁移目录已经存在**（`20261023115759_add_api_keys`），所以第 2 步通常只做「应用」而不是「新建」，输出可能是 `Already in sync`。从更早阶段跟做时，Prisma 会生成新的时间戳前缀，**内容与 §8.2 相同**即可。
2. **注意 Prisma 可能顺手 DROP 掉阶段 7 的 HNSW 索引**。本阶段的迁移文件里第一条注释就是为此留的：自动生成的 `DROP INDEX "chunks_embedding_hnsw"` 已被**手工删除**。每次 `migrate dev` 后都要检查生成的 SQL（见 `INDEX.md` 的「已知遗留」）。

**为什么 Python 侧没有第 2 步**

阶段 1 定下的规矩：**Prisma 拥有 DDL，SQLAlchemy 只映射**。`apps/api-py` 没有 alembic，启动时只是把 `ApiKey` 类映射到已经存在的表。新增字段的正确流程永远是：

```
改 schema.prisma → prisma migrate dev → Python 模型跟着加 mapped_column → 两端重启
```

---

## 5. 完整代码：契约 `openapi.yaml`

> `openapi.yaml` 是**累积文件**。本篇只贴**新增 / 修改的完整段落**；未变部分与阶段 9 完全一致。

### 5.1 版本号

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
info:
  title: mini-dify API
  version: 0.10.0
  description: >-
    唯一契约（单真源）。NestJS（api-ts）与 FastAPI（api-py）都必须实现本规范，
    并由同一套契约测试校验两者的响应结构、状态码与错误响应体一致。
```

**这段在干什么**

`version` 是**契约版本**，必须与 `src/index.ts` 的 `CONTRACT_VERSION` 同步。本篇新增 4 个路径、5 组 schema、1 个安全方案与 7 条错误文案，属于契约级变更，所以从 `0.9.0` 升到 `0.10.0`。

### 5.2 安全方案 `apiKeyAuth`（与 `bearerAuth` 并列）

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: >-
        对外运行应用的 API Key（创建时返回一次）。也可用
        `Authorization: Bearer <key>` 传递，两者等价。
```

**这段在干什么**

1. `components.securitySchemes` 是**方案清单**，不是「全局开关」。这里同时登记了**两套互不相干的方案**：`bearerAuth` 给登录用户（JWT），`apiKeyAuth` 给外部调用者（应用凭证）。
2. 每个 operation 用 `security: - apiKeyAuth: []` 或 `security: - bearerAuth: []` **二选一**，而不是两个都写。写成 `- apiKeyAuth: []` + `bearerAuth: []`（同一对象里两项）才是「两个都要」，本项目没有这种接口。
3. `type: apiKey` 的语义是「一个不透明字符串，放在指定位置」：`in: header` + `name: X-API-Key` 就完整描述了读取位置。它**不**表达 `Bearer ` 前缀、也不表达 JWT 结构——那是 `type: http` / `scheme: bearer` 的事。
4. 实现额外接受 `Authorization: Bearer <key>`，但 OpenAPI 的一个安全方案**无法表达「两个位置任选其一」**，所以只能写进 `description`（§12.8 会讲为什么不用再加一个方案）。

### 5.3 两个管理路径

```yaml
  /apps/{id}/api-keys:
    get:
      operationId: listApiKeys
      summary: 列出应用的 API Key
      description: >-
        返回该应用的全部 API Key（**含已撤销的**，`revokedAt` 非空即已撤销，便于展示历史）。
        **不含明文 key**，只有 `prefix`。仅限应用所有者。
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
          description: API Key 列表
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiKeyListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
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
          $ref: "#/components/responses/BadRequest"
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
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "204":
          description: 撤销成功
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

**这段在干什么**

1. **两个路径、三个操作**：`/apps/{id}/api-keys` 同时承担「列表 + 创建」，`/api-keys/{id}` 承担「撤销」。key 的 id 是全局唯一的，所以撤销不需要 `appId` 出现在路径里——归属由 `ownerId` 校验。
2. **`security` 全部是 `bearerAuth`**：这三个接口是「所有者在管理自己的凭证」，和 `/apps` 一样属于 JWT 领域。
3. **`POST` 是 201，`DELETE` 是 204**：与阶段 2 的 REST 约定一致（新建资源返回完整体、删除无表示）。
4. **描述里写清了三个不可见约定**：列表含已撤销、明文只返回一次、重名只针对未撤销的 key。这些是**契约的一部分**，不能只留在实现里。

### 5.4 对外运行路径

```yaml
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
        - apiKeyAuth: []
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
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

**这段在干什么**

1. 路径前缀是 **`/public`**：一眼能看出「这是给外部用的」，与 `/apps/{id}/run`（JWT、读草稿）形成对照。
2. `security` 换成 **`apiKeyAuth: []`**——同一个 OpenAPI 文件里第二个认证域，切换只发生在**单个 operation** 上。
3. 参数名从 `{id}` 变成了 **`{appId}`**：因为这里没有「我的应用」这层语境，路径里的 id 就是应用 id，命名更直白。
4. `text/event-stream` 的响应声明与阶段 4 完全一致；`400 / 401 / 404` 都是**普通 JSON**（错误信封 `ErrorResponse`），只有进入执行后才变成流。

### 5.5 五组 schema

```yaml
    ApiKeyResponse:
      type: object
      additionalProperties: false
      required: [id, appId, name, prefix, createdAt, lastUsedAt, revokedAt]
      properties:
        id:
          type: string
        appId:
          type: string
        name:
          type: string
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
          type: ["string", "null"]
          format: date-time
          description: 最近一次对外运行的时间；从未使用时为 `null`
        revokedAt:
          type: ["string", "null"]
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
          minLength: 1
          maxLength: 60

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

**这段在干什么**

1. **`ApiKeyResponse` 与 `CreateApiKeyResponse` 是两份 schema**，而不是「一份加可选字段」。`CreateApiKeyResponse.required` 多一个 `key`，其余七个字段逐字相同——这样「列表永远不会带明文」是**结构上的保证**，不靠实现自觉。
2. `lastUsedAt` / `revokedAt` 写成 `["string", "null"]`（键一定在、值可为空），与 `conversationId?` 的「键可能不存在」是两种不同的 JSON 形状（阶段 9 §12.8 已讲）。
3. `prefix` 的 `description` 写着「**不是**密钥本身」：11 个字符 = `sk-` + 8 位十六进制，只剩 24 位十六进制未公开，**无法还原**。
4. `CreateApiKeyRequest.name` 的 `minLength: 1` / `maxLength: 60` 是契约声明；运行期两端都**不**用 DTO 的上限校验，超过 60 时由服务层给专用文案 `API key name is too long`。校验顺序两端一致：**先应用归属（非本人一律 404 `App not found`），再报超长 400**（§12.11）。
5. `PublicRunRequest` **只有 `inputs`**，且 `additionalProperties: false`：这不是「忽略多余字段」，而是「多余字段直接 400」。

---

## 6. 完整代码：`packages/contract/src/index.ts`

> 只贴**新增 / 修改的段落**；其余类型与阶段 9 一致。

### 6.1 版本号

**完整文件路径：`packages/contract/src/index.ts`**

```ts
/** 契约版本；修改契约时递增，并与 openapi.yaml 的 info.version 保持同步。 */
export const CONTRACT_VERSION = '0.10.0'
```

**这段在干什么**

`CONTRACT_VERSION` 供两端与前端做兼容性自检；必须与 `openapi.yaml#/info/version` 字面相同。阶段 9 是 `0.9.0`，本篇升到 `0.10.0`。

### 6.2 API Key 的类型

```ts
/** API Key 对外视图（**不含明文 key**，只有 `prefix`）。 */
export interface ApiKeyResponse {
  id: string
  appId: string
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
  /** 1-60 位 */
  name: string
}

/** POST /apps/{id}/api-keys 的响应体：在 ApiKeyResponse 之外附带**一次性明文 key**。 */
export interface CreateApiKeyResponse extends ApiKeyResponse {
  /** 明文 key（`sk-` + 32 位十六进制，共 35 字符），**仅此一次返回** */
  key: string
}
```

**这段在干什么**

1. `CreateApiKeyResponse extends ApiKeyResponse`：用**类型继承**表达「创建响应 = 列表条目 + 一次性 `key`」，与 OpenAPI 里那份独立的 `CreateApiKeyResponse` schema 逐字段对应。
2. `lastUsedAt` / `revokedAt` 是 `string | null`，因为它们在数据模型里是**可空列**，对外必须稳定输出这个键。
3. 注释把「35 字符」与「仅此一次」写进了类型——**类型文件本身就是文档**，前端据此知道「不要把 key 存在列表里等下次再取」。

### 6.3 `PublicRunRequest`

```ts
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

**这段在干什么**

这不是「`RunRequest` 的子集」写法（如 `Omit<RunRequest, 'conversationId'>`），而是**独立声明**。独立声明的价值在于：将来 `RunRequest` 加了新字段，`PublicRunRequest` **不会自动跟着长**——对外契约必须是显式决定的结果，而不是继承的副作用。

---

## 7. 完整代码：`packages/contract/error-messages.md`（§10）

**完整文件路径：`packages/contract/error-messages.md`**

````markdown
## 10. 发布与 API Key

阶段 10 起，API Key 管理与对外运行（`POST /public/apps/{appId}/run`）涉及下列错误。
**两端必须逐字节一致**。

| 场景 | HTTP | message |
| --- | --- | --- |
| 未提供 key | 401 | `Missing API key` |
| key 无效 / 已撤销 | 401 | `Invalid API key` |
| 应用未发布（`published_graph_json` 为 null） | 400 | `App is not published` |
| 应用不存在 | 404 | `App not found` |
| key 名称过长 | 400 | `API key name is too long` |
| key 名称重复（同一应用内，未撤销的） | 400 | `API key name already exists` |
| 撤销不存在/不属于自己的 key | 404 | `API key not found` |

认证与校验顺序（对外运行，`POST /public/apps/{appId}/run`）：

1. 取 key：优先 `X-API-Key` 头，其次 `Authorization: Bearer <key>`；两者都没有 → 401 `Missing API key`；
2. 校验 key（哈希匹配且未撤销）→ 失败即 401 `Invalid API key`；
3. 校验 key 所属应用与路径里的 `appId` 一致 → 不一致也是 401 `Invalid API key`；
4. 查应用 → 不存在则 404 `App not found`；
5. 用**已发布快照**执行 → 未发布则 400 `App is not published`。

以上 4xx 都是**普通 JSON**（`ErrorResponse`），不是 SSE 流；进入执行后才走 `text/event-stream`。

### 10.1 发布语义

- **对外运行只读已发布快照**（`published_graph_json`）：草稿（`graph_json`）怎么改都不会影响线上，
  只有再次 `POST /apps/{id}/graph/publish` 才会更新线上行为。
- **API Key 只存哈希**：服务端保存 `sha256(key)`（`key_hash`）与 `prefix`（明文前 11 字符）；
  明文 `key` **只在创建响应里返回一次**，之后任何接口都不再返回。
- **已撤销的 key 立即失效**，不做宽限期：`revokedAt` 非空即视为 `Invalid API key`。
- **撤销不是物理删除**：`DELETE /api-keys/{id}` 只把 `revokedAt` 置为当前时间，
  列表接口仍会返回它（便于展示历史）。
- **对外运行不支持会话**：`PublicRunRequest` 只有 `inputs`，没有 `conversationId` / `userMessage`；
  `run_started` 事件不带 `conversationId`，引擎也不写任何消息。
- 生产环境应在此处加**限流**（本阶段未实现）。

实现位置：

- api-ts：`apps/api-ts/src/api-keys/`（`api-keys.service.ts`、`api-keys.controller.ts`）、
  `apps/api-ts/src/public/public.controller.ts`、`apps/api-ts/src/engine/engine.service.ts`（`runPublished`）。
````

**这段在干什么**

1. **7 条文案 + 5 步顺序**是本阶段唯一真源。顺序本身就是契约：`Missing` 与 `Invalid` 必须是 401，未发布必须是 400 而不是 404——换一个码，调用方的重试逻辑就会错。
2. 「4xx 都是普通 JSON」重申阶段 4 的「**先校验、后开流**」：只要还能在打开流之前发现问题，就不要用 `run_failed` 表达。
3. §10.1 是**语义总纲**：快照隔离、只存哈希、撤销立即失效、撤销不删除、不支持会话。这五条在实现里各有一处对应，读代码时可以逐条对照。

---

## 8. 完整代码：Prisma schema 与迁移

### 8.1 `apps/api-ts/prisma/schema.prisma`

**完整文件路径：`apps/api-ts/prisma/schema.prisma`**

```prisma
/// API Key（阶段 10）：对外运行应用的凭证。**只存哈希**，明文仅在创建时返回一次。
model ApiKey {
  id          String    @id @default(uuid())
  appId       String    @map("app_id")
  ownerId     String    @map("owner_id")
  name        String
  keyPrefix   String    @map("key_prefix")
  keyHash     String    @unique @map("key_hash")
  createdAt   DateTime  @default(now()) @map("created_at")
  // lastUsedAt：最近一次对外运行的时间；revokedAt 非空即「已撤销」（不做物理删除）
  lastUsedAt  DateTime? @map("last_used_at")
  revokedAt   DateTime? @map("revoked_at")

  app   App  @relation(fields: [appId], references: [id], onDelete: Cascade)
  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([appId])
  @@map("api_keys")
}
```

同时，`User` 与 `App` 各加一条反向关系（Prisma 的关系必须双方声明）：

```prisma
model User {
  // …
  apiKeys ApiKey[]
}

model App {
  // …
  apiKeys ApiKey[]
}
```

**这段在干什么**

Prisma 的关系必须**双方声明**：`ApiKey.app` / `ApiKey.owner` 写了 `@relation`，对应的 `App` / `User` 就必须有反向字段，否则 `prisma validate` 直接报错。反向字段同时也是「按应用 / 按用户列出 key」的查询入口。

**这段在干什么（逐个字段）**

1. **`keyHash @unique`**：唯一索引既是「按 hash 精确查找」的性能保障，也是「同一把 key 不会被重复签发」的结构保证（§12.6）。
2. **没有 `plainKey` 列**：明文从不落库。`keyPrefix` 只存 11 字符，用于列表辨识。
3. **`name` 上没有 `@@unique([appId, name])`**：因为撤销后允许复用同名（轮换场景），数据库唯一约束会把这种合法操作也挡掉。重名检查放在服务层，且只查 `revokedAt: null`（§12.7）。
4. **`lastUsedAt` / `revokedAt` 都可空**：前者「从未用过」、后者「未撤销」，都用 `null` 表达。
5. **两条 `onDelete: Cascade`**：删应用 / 删用户都会带走 key，不会留下「无主凭证」。
6. `@@index([appId])`：列表接口按 `appId` 过滤（外键需要索引，阶段 2 已讲）。
7. **`keyHash` 上不再单独加 `@@index`**：`@unique` 已经建了唯一索引，再加就是冗余。

### 8.2 `apps/api-ts/prisma/migrations/20261023115759_add_api_keys/migration.sql`

**完整文件路径：`apps/api-ts/prisma/migrations/20261023115759_add_api_keys/migration.sql`**

```sql
-- 注意：Prisma 自动生成的 `DROP INDEX "chunks_embedding_hnsw"` 已手工移除。
-- 该 HNSW 索引由 migration `add_knowledge_base` 创建、由 `prisma/sql/hnsw.sql` 维护，
-- 不属于 Prisma 的 schema，不能让 `migrate dev` 顺手删掉。

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_app_id_idx" ON "api_keys"("app_id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**这段在干什么（按行）**

1. **第一段注释是「已知坑」的教科书式处理**：Prisma 不认识手工建的 HNSW 索引，`migrate dev` 会生成 `DROP INDEX`；这里把它删掉并**写明原因**，避免后来者「重新生成」时又加回去。
2. **`TEXT` 主键**：id 由应用侧生成（Prisma 的 `uuid()` 是**客户端**默认值）。
3. **`key_hash` 上没有长度限制**：SHA-256 十六进制恒为 64 字符，但用 `TEXT` 便于跨语言（Python 侧 `String`）。
4. **`UNIQUE INDEX "api_keys_key_hash_key"`**：全局唯一，不按应用划分——两把不同的 key 哈希撞车的概率可以忽略，但约束让「撞车」变成显式失败而不是静默覆盖。
5. **`api_keys_app_id_idx`**：`GET /apps/{id}/api-keys` 的过滤列。
6. **两条 `ON DELETE CASCADE`**：删应用 → 它的 key 全部消失；删用户 → 他签发的 key 全部消失。这是验收标准第 13 条的来源。
7. **`TIMESTAMP(3)`**：毫秒精度，与契约的 24 字符 `...Z` 时间序列化配套；`last_used_at` / `revoked_at` 可空，与 Prisma 的 `DateTime?` 对齐。

---

## 9. 完整代码：`apps/api-py/app/models/api_key.py`

**完整文件路径：`apps/api-py/app/models/api_key.py`**

```python
"""`api_keys` 表模型（阶段 10）。

重要：该表的 DDL 由 TS 侧 Prisma 迁移拥有
（`apps/api-ts/prisma/migrations/20261023115759_add_api_keys`）。
Python 只做**映射与读写**、不产生 DDL，以免两套迁移系统互相冲突。

安全要点：表里只存 `sha256(明文 key)`（`key_hash`，唯一）与 `key_prefix`；
明文 key 只在创建响应里返回一次。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    # id 由应用侧生成（Prisma 的 uuid() 是客户端默认值，数据库没有默认）
    id: Mapped[str] = mapped_column(String, primary_key=True)
    app_id: Mapped[str] = mapped_column(
        String, ForeignKey("apps.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    key_prefix: Mapped[str] = mapped_column(String, nullable=False)
    key_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    # 物理列均为 timestamp(3)（无时区），写入时按 UTC 取 naive 值
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    app: Mapped["App"] = relationship("App", back_populates="api_keys")
    owner: Mapped["User"] = relationship("User", back_populates="api_keys")
```

**这段在干什么（按区块）**

1. **只映射，不建表**：模块 docstring 写死迁移所有权，防止有人给 Python 再加一套 alembic。
2. **列与 Prisma 一一对应**：`String` → `TEXT`，`DateTime` → `TIMESTAMP(3)`（无时区，即「naive UTC」）。
3. **`key_hash` 的 `unique=True` 与 Prisma 的 `@unique` 对应**：SQLAlchemy 侧不产生 DDL，但声明唯一能让人读到「这列是唯一的」，也让 `db.scalar(select(...))` 的语义更明确。
4. **`last_used_at` / `revoked_at` 用 `DateTime()`**：显式写出「无时区」，与 Prisma 生成的 `TIMESTAMP(3)` 对齐。写入时用 `datetime.now(timezone.utc).replace(tzinfo=None)` 取 naive-UTC（§12.11）。
5. **双向关系 + `passive_deletes`**：`App.api_keys` / `User.api_keys` 在对应模型里都有 `back_populates` 与 `passive_deletes=True`，删父行时交给数据库级联，避免 ORM 先置 `NULL`（阶段 7 的 `NotNullViolation` 教训）。

---

## 10. 完整代码：NestJS 侧

### 10.1 `apps/api-ts/src/api-keys/api-keys.controller.ts`

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.controller.ts`**

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import type { ApiKeyListResponse, CreateApiKeyResponse } from '@mini-dify/contract'

import { CurrentUser } from '../auth/current-user.decorator'
import { JwtAuthGuard, type JwtPayload } from '../auth/jwt-auth.guard'
import { ApiKeysService } from './api-keys.service'
import { CreateApiKeyDto } from './dto/create-api-key.dto'

/**
 * API Key 管理接口（JWT 鉴权）。契约见 packages/contract/openapi.yaml 的
 * `/apps/{id}/api-keys` 与 `/api-keys/{id}`。
 *
 * 对外运行（`/public/apps/{appId}/run`）走 API Key 鉴权，见 `PublicController`。
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get('apps/:id/api-keys')
  list(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<ApiKeyListResponse> {
    return this.apiKeysService.list(payload.sub, id)
  }

  @Post('apps/:id/api-keys')
  create(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreateApiKeyResponse> {
    return this.apiKeysService.create(payload.sub, id, dto.name)
  }

  @Delete('api-keys/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.apiKeysService.revoke(payload.sub, id)
  }
}
```

**这段在干什么（按装饰器）**

1. `@Controller()` **不带前缀**：三个路由分属两棵前缀树（`apps/:id/api-keys` 与 `api-keys/:id`），没法用统一前缀表达。
2. `@UseGuards(JwtAuthGuard)` 放类上：三个接口都要求登录；`@CurrentUser()` 取 `JwtPayload`，用 `payload.sub` 当 `ownerId`。
3. `@Post` 不写 `@HttpCode`：NestJS 对 POST 默认返回 **201**，与契约一致。
4. `@Delete` 显式 `@HttpCode(204)`：NestJS 对 DELETE 默认返回 **200**，必须显式改；这与阶段 2 的应用删除、阶段 9 的会话删除是同一处约定。
5. 控制器只做参数搬运，**归属校验、重名检查、key 生成、撤销语义都在 service**。

### 10.2 `api-keys.service.ts` 的关键片段

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.service.ts`**（摘录 `create` 与 `authenticate`；文件其余部分见源码）

```ts
/** key 名称长度上限（字符数，契约 `CreateApiKeyRequest.name.maxLength`）。 */
const MAX_API_KEY_NAME_LENGTH = 60

/** `prefix` 长度：明文 key 的前 11 个字符（`sk-` + 8 位十六进制）。 */
const KEY_PREFIX_LENGTH = 11

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /apps/{id}/api-keys：校验归属 → 同名检查 → 生成并保存（返回一次性明文 key）。 */
  async create(ownerId: string, appId: string, name: string): Promise<CreateApiKeyResponse> {
    await this.assertAppOwned(ownerId, appId)
    if ([...name].length > MAX_API_KEY_NAME_LENGTH) {
      throw new BadRequestException('API key name is too long')
    }
    // 只有「未撤销」的重名才算冲突：撤销后可复用同名，便于轮换
    const duplicate = await this.prisma.apiKey.findFirst({
      where: { appId, name, revokedAt: null },
      select: { id: true },
    })
    if (duplicate !== null) {
      throw new BadRequestException('API key name already exists')
    }

    const key = `sk-${randomBytes(16).toString('hex')}`
    const created = await this.prisma.apiKey.create({
      data: {
        appId,
        ownerId,
        name,
        keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
        keyHash: hashKey(key),
      },
    })
    return { ...toApiKeyResponse(created), key }
  }

  /**
   * 校验明文 key（对外运行用）：哈希匹配且未撤销才算通过。
   * 命中后顺手更新 `lastUsedAt`，返回该 key 所属的应用与用户。
   */
  async authenticate(rawKey: string): Promise<AuthenticatedApiKey> {
    const found = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashKey(rawKey) },
      select: { id: true, appId: true, ownerId: true, revokedAt: true },
    })
    if (found === null || found.revokedAt !== null) {
      throw new UnauthorizedException('Invalid API key')
    }
    await this.prisma.apiKey.update({
      where: { id: found.id },
      data: { lastUsedAt: new Date() },
    })
    return { appId: found.appId, ownerId: found.ownerId }
  }
}

/** `sha256(明文 key)` 的十六进制摘要（64 字符）。 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
```

**这段在干什么（按方法）**

1. **`create` 的四步顺序**：`assertAppOwned`（应用必须属于你，否则 404 `App not found`）→ 长度检查（>60 → 400 专用文案）→ 未撤销重名检查（→ 400）→ 生成并落库。
2. **`randomBytes(16)`**：16 字节 = 128 位随机，转十六进制后是 32 个字符；加 `sk-` 前缀共 **35** 字符。
3. **`key.slice(0, 11)`**：只截 `sk-` + 8 位十六进制作为 `prefix`；剩下 24 位**永不外露**。
4. **`hashKey`**：SHA-256 十六进制，64 字符。落库的是它，不是明文。
5. **`authenticate` 只有一条查询**：`findUnique({ where: { keyHash } })`——这正是 `key_hash` 必须 `@unique` 的直接原因（Prisma 的 `findUnique` 只能用在唯一字段上）。
6. **`found === null || revokedAt !== null` 合并成同一句** `Invalid API key`：调用方无法区分「不存在」与「已撤销」，不泄露 key 的存在性。
7. **`lastUsedAt` 在返回之前更新**：`GET` 列表时能看到「最近一次对外运行」，运维据此判断某把 key 是否还在用。

### 10.3 `apps/api-ts/src/api-keys/dto/create-api-key.dto.ts`

**完整文件路径：`apps/api-ts/src/api-keys/dto/create-api-key.dto.ts`**

```ts
import { IsString, MinLength } from 'class-validator'

/**
 * POST /apps/{id}/api-keys 请求体 —— 对应契约 `CreateApiKeyRequest`。
 *
 * 名字的「过长」由服务层给出契约文案（见 error-messages.md §10）：
 * 这里**不**加 `@MaxLength(60)`，否则会落到 §1.1 的通用文案
 * `name must be at most 60 characters`，与 §10 的 `API key name is too long` 冲突。
 */
export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  name!: string
}
```

**这段在干什么**

1. DTO 只校验「是字符串且非空」，**不校验上限**。这是阶段 9 标题长度那套做法的复用：契约指定了专用文案，就不能让 `ValidationPipe` 抢先产出通用文案。
2. `@MinLength(1)` 的产出是 `name must be at least 1 characters`（契约 §1.1 规则），与 Python 服务层的手写文案一致。
3. 注意：**缺失 `name`** 时 TS 走的是 `name is required`（工厂里 `value === undefined` 分支），Python 曾在服务层报 `name must be a string`；现已修复——Python `service.create()` 开头补了 `if name is None: raise _bad_request("name is required")`，两端都是 400 `name is required`（理由与实测见 §12.11）。

### 10.4 `apps/api-ts/src/api-keys/api-keys.module.ts`

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.module.ts`**

```ts
import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ApiKeysController } from './api-keys.controller'
import { ApiKeysService } from './api-keys.service'

/**
 * API Key 模块（阶段 10）。`PrismaService` 来自全局 `PrismaModule`，
 * `JwtAuthGuard` 由 `AuthModule` 提供并导出。
 * `ApiKeysService` 同时被 `PublicModule` 复用（对外运行的 key 校验）。
 */
@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
```

**这段在干什么**

1. `imports: [AuthModule]` 是为了拿到 `JwtAuthGuard` 依赖的 `JwtService`；`PrismaService` 来自 `@Global()` 的 `PrismaModule`，不必显式 import。
2. `exports: [ApiKeysService]` 是关键：`PublicModule` 要复用同一份 key 校验逻辑，而不是自己再写一遍 `sha256`。

### 10.5 `apps/api-ts/src/public/public.controller.ts`

**完整文件路径：`apps/api-ts/src/public/public.controller.ts`**

```ts
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import type { Response } from 'express'

import { ApiKeysService } from '../api-keys/api-keys.service'
import { EngineService } from '../engine/engine.service'
import { formatSseFrame } from '../engine/events'
import { PrismaService } from '../prisma/prisma.service'
import { PublicRunRequestDto } from './dto/public-run.dto'

/**
 * 对外运行接口（阶段 10）：`POST /public/apps/{appId}/run`。
 *
 * **不用** `JwtAuthGuard`：鉴权改为 API Key（契约里的 `apiKeyAuth`）。
 * 支持的两种传法（`X-API-Key` 优先，其次 `Authorization: Bearer <key>`）。
 *
 * 校验顺序（见 error-messages.md §10）：
 * 1. 没有 key → 401 `Missing API key`；
 * 2. key 无效 / 已撤销 → 401 `Invalid API key`；
 * 3. key 不属于路径里的 `appId` → 401 `Invalid API key`
 *    （但若该 `appId` 根本不存在，则按「应用不存在」给 404 `App not found`）；
 * 4. 走 `EngineService.runPublished`：应用不存在 404、未发布 400。
 *
 * SSE 帧与 `POST /apps/{id}/run` 完全一致（同一套事件构造器与序列化）。
 */
@Controller('public/apps')
export class PublicController {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly engineService: EngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':appId/run')
  @HttpCode(200)
  async run(
    @Param('appId') appId: string,
    @Headers('x-api-key') apiKeyHeader: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PublicRunRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    const rawKey = extractApiKey(apiKeyHeader, authorization)
    if (rawKey === undefined) {
      throw new UnauthorizedException('Missing API key')
    }
    // 生产环境应在此处加限流（按 key / 应用维度），本阶段不实现。

    const authenticated = await this.apiKeysService.authenticate(rawKey)
    if (authenticated.appId !== appId) {
      // 不是这个应用的 key。先确认应用是否存在，避免把「应用不存在」误报成「key 无效」。
      const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } })
      if (app === null) {
        throw new NotFoundException('App not found')
      }
      throw new UnauthorizedException('Invalid API key')
    }

    const events = await this.engineService.runPublished(appId, body.inputs)
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
    for await (const event of events) {
      response.write(formatSseFrame(event))
    }
    response.end()
  }
}

/**
 * 取明文 key：`X-API-Key` 优先，其次 `Authorization: Bearer <key>`。
 * 空白值视为「未提供」（→ `Missing API key`）。
 */
function extractApiKey(
  apiKeyHeader: string | undefined,
  authorization: string | undefined,
): string | undefined {
  const fromApiKeyHeader = apiKeyHeader?.trim()
  if (fromApiKeyHeader !== undefined && fromApiKeyHeader !== '') {
    return fromApiKeyHeader
  }
  if (authorization?.startsWith('Bearer ') === true) {
    const token = authorization.slice(7).trim()
    return token === '' ? undefined : token
  }
  return undefined
}
```

**这段在干什么（按段落）**

1. **完全不挂 `JwtAuthGuard`**：这是本项目唯一用 **API Key** 鉴权的业务接口（注册/登录也不认 JWT，但那属于「尚未登录」的场景，不是另一套凭证）。鉴权是手写的三步（取 key → 校验 → 比对 appId）。
2. **`extractApiKey` 的优先级**：`X-API-Key` 去掉首尾空白后非空才算提供；否则看 `Authorization` 是否以 `Bearer ` 开头。**空白字符串视为未提供**，避免 `X-API-Key: ` 被当成一把空 key 去查库。
3. **appId 不一致时的额外一次查询**：不能直接 401。如果路径里的应用**根本不存在**，正确答案是 404 `App not found`；只有「应用存在、但不是这把 key 的应用」才是 401 `Invalid API key`。两次判断的顺序决定了调用方看到哪个码。
4. **`runPublished` 在打开流之前调用**：它内部完成「应用存在 → 已发布 → 预检」，任何失败都还是普通 JSON 4xx（阶段 4 的「先校验、后开流」）。
5. **`response.flushHeaders()` + 手动写帧**：与 `POST /apps/{id}/run` 用的是同一个 `formatSseFrame`，所以两条流的**帧格式逐字节相同**。
6. **`@HttpCode(200)`**：SSE 是 200 的长响应，不是 201。

### 10.6 `apps/api-ts/src/public/dto/public-run.dto.ts`

**完整文件路径：`apps/api-ts/src/public/dto/public-run.dto.ts`**

```ts
import { IsObject } from 'class-validator'

/**
 * POST /public/apps/{appId}/run 请求体 —— 对应契约 `PublicRunRequest`。
 *
 * **不支持会话**：没有 `conversationId` / `userMessage`；请求里带上它们会被
 * `forbidNonWhitelisted` 判为 `... should not exist`（400）。
 */
export class PublicRunRequestDto {
  /** 运行输入，键为输入变量名（内部键不校验，原样透传给引擎）。 */
  @IsObject()
  inputs!: Record<string, unknown>
}
```

**这段在干什么**

1. DTO 只有 `inputs`，且没有 `@IsOptional()` 的任何字段——「少」是**刻意的**。
2. 全局 `ValidationPipe` 的 `forbidNonWhitelisted` 会把请求体里的 `conversationId` 判为 `conversationId should not exist`（400）。这就是「契约砍字段」在运行期的落点。
3. `inputs` 内部键不校验：输入变量的名字与必填性由图里的 `start` 节点声明（阶段 4 的预检负责）。

---

## 11. 完整代码：FastAPI 侧

### 11.1 `apps/api-py/app/api/api_keys.py`

**完整文件路径：`apps/api-py/app/api/api_keys.py`**

```python
"""`/apps/{id}/api-keys` 与 `/api-keys/{id}` 路由（阶段 10）。

契约见 packages/contract/openapi.yaml；错误文案见 error-messages.md §10。
管理类接口用 JWT 鉴权（复用 `get_current_user`）；对外运行走 API Key，
见 `app/api/public.py`。

创建响应附带**一次性明文 key**；列表响应只有 `prefix`，**没有** `key` 字段。
"""

from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, field_serializer
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.api_keys import service
from app.models.user import User
from app.timefmt import iso_z

router = APIRouter(tags=["api-keys"])


class ApiKeyResponse(BaseModel):
    """对应契约 `ApiKeyResponse`（**无**明文 key）。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    appId: str
    name: str
    prefix: str
    createdAt: datetime
    lastUsedAt: datetime | None
    revokedAt: datetime | None

    @field_serializer("createdAt", "lastUsedAt", "revokedAt")
    def _serialize_timestamps(self, value: datetime | None) -> str | None:
        return None if value is None else iso_z(value)


class ApiKeyListResponse(BaseModel):
    """对应契约 `ApiKeyListResponse`。"""

    model_config = ConfigDict(extra="forbid")

    items: list[ApiKeyResponse]


class CreateApiKeyRequest(BaseModel):
    """对应契约 `CreateApiKeyRequest`。

    `name` 允许缺省为 `None`：缺失时 `name is required`、空串时
    `name must be at least 1 characters`，都由服务层给出（与 api-ts 的 DTO 文案一致）。
    上限 60 也由服务层给出 §10 的专用文案，故此处**不**加 `max_length`。
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class CreateApiKeyResponse(ApiKeyResponse):
    """对应契约 `CreateApiKeyResponse`（含一次性明文 key）。"""

    key: str


@router.get(
    "/apps/{id}/api-keys", response_model=ApiKeyListResponse, operation_id="listApiKeys"
)
def list_api_keys(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiKeyListResponse:
    return ApiKeyListResponse(
        items=[
            ApiKeyResponse(**fields)
            for fields in service.list_api_keys(db, current_user.id, id)
        ]
    )


@router.post(
    "/apps/{id}/api-keys",
    response_model=CreateApiKeyResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="createApiKey",
)
def create_api_key(
    id: str,
    body: CreateApiKeyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CreateApiKeyResponse:
    fields, key = service.create(db, current_user.id, id, body.name)
    return CreateApiKeyResponse(**fields, key=key)


@router.delete(
    "/api-keys/{id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="revokeApiKey"
)
def revoke_api_key(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    service.revoke(db, current_user.id, id)
```

**这段在干什么（按区块）**

1. **两个响应模型是「继承」关系**：`CreateApiKeyResponse(ApiKeyResponse)` 只多一个 `key`。因此列表接口的 `response_model` 是 `ApiKeyListResponse`，**结构上不可能**输出明文——Pydantic 会按模型裁掉多余字段。
2. **`field_serializer` 统一处理三个时间**：`None` 保持 `None`（输出 `null`），否则 `iso_z`（UTC、毫秒、`Z` 结尾）。与 TS 的 `toISOString()` 对齐。
3. **`CreateApiKeyRequest.name: str | None = None`**：名字的「缺失 / 空 / 过长」全部交给服务层，才能产出 §10 的专用文案；这里加 `max_length` 只会得到通用文案。
4. **`@router.post(status_code=201)`**：显式声明 201（FastAPI 默认 200）；`@router.delete(status_code=204)` 并在函数签名里返回 `None`——FastAPI 会返回空体。
5. **`operation_id` 与契约的 `operationId` 逐字相同**：`listApiKeys` / `createApiKey` / `revokeApiKey`，便于生成客户端与契约比对。
6. **`Depends(get_current_user)`**：三个接口都是 JWT 域；`depends` 是阶段 1 的既有依赖（`get_db` 提供会话，`get_current_user` 提供当前用户）。

### 11.2 `apps/api-py/app/api_keys/service.py` 的关键片段

**完整文件路径：`apps/api-py/app/api_keys/service.py`**（摘录 `create` / `authenticate` / `hash_key`；其余见源码）

```python
# key 名称长度上限（契约 `CreateApiKeyRequest.name.maxLength`）
MAX_API_KEY_NAME_LENGTH = 60
# 明文 key 前 11 个字符（`sk-` + 8 位十六进制）
KEY_PREFIX_LENGTH = 11


def hash_key(key: str) -> str:
    """`sha256(明文 key)` 的十六进制摘要（64 字符，与 TS 的 `createHash` 同算法）。"""
    return hashlib.sha256(key.encode()).hexdigest()


def create(
    db: Session, owner_id: str, app_id: str, name: str | None
) -> tuple[dict[str, Any], str]:
    """`POST /apps/{id}/api-keys`：校验归属 → 重名 → 生成 → 存哈希。

    返回 `(视图字段, 一次性明文 key)`。名称的「缺失 / 空」校验顺序与 TS 的
    DTO（`@IsString` + `@MinLength(1)`，在进入服务前执行）保持一致。
    """
    # 缺失（`null`）与「类型不对」要分开：项目约定缺失统一报 `{field} is required`
    # （与 `/apps`、`/knowledge-bases` 两端一致），只有存在但类型不符才报 must be a string。
    if name is None:
        raise _bad_request("name is required")
    if not isinstance(name, str):
        raise _bad_request("name must be a string")
    if len(name) < 1:
        raise _bad_request("name must be at least 1 characters")

    _find_owned_app(db, owner_id, app_id)
    # 超过 60 才是 §10 的专用文案（不能用 DTO 的 maxLength，否则文案会落到 §1.1）
    if len(name) > MAX_API_KEY_NAME_LENGTH:
        raise _bad_request("API key name is too long")
    # 只有「未撤销」的重名才算冲突：撤销后可复用同名，便于轮换
    duplicate = db.scalar(
        select(ApiKey.id)
        .where(ApiKey.app_id == app_id, ApiKey.name == name, ApiKey.revoked_at.is_(None))
        .limit(1)
    )
    if duplicate is not None:
        raise _bad_request("API key name already exists")

    key = f"sk-{secrets.token_hex(16)}"
    api_key = ApiKey(
        id=str(uuid.uuid4()),
        app_id=app_id,
        owner_id=owner_id,
        name=name,
        key_prefix=key[:KEY_PREFIX_LENGTH],
        key_hash=hash_key(key),
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return to_response_fields(api_key), key


def authenticate(db: Session, raw_key: str) -> dict[str, str]:
    """校验明文 key：哈希匹配且未撤销才算通过，并更新 `last_used_at`。

    返回 `{"appId": ..., "ownerId": ...}`。与 TS 一致：**先**更新 `last_used_at`，
    再由调用方比对路径里的 `appId`（因此「拿 A 的 key 调 B」也会刷新该 key 的使用时间）。
    """
    api_key = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_key(raw_key)))
    if api_key is None or api_key.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
        )
    api_key.last_used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"appId": api_key.app_id, "ownerId": api_key.owner_id}
```

**这段在干什么（按方法）**

1. **`secrets.token_hex(16)`**：16 字节 = 32 个十六进制字符，与 TS 的 `randomBytes(16).toString('hex')` **落点完全一致**，因此两端生成的 key **长度相同、字符集相同**。
2. `key[:11]`：Python 切片取前 11 字符，等于 TS 的 `slice(0, 11)`（注意 Python 切片的结束下标是**开区间**，所以 `[:11]` 恰好是 11 个字符）。
3. **`hashlib.sha256(...).hexdigest()`**：与 `createHash('sha256').digest('hex')` 产出同一个 64 字符摘要——**同一把 key 在两端算出同一个 `key_hash`**，这是「跨端能互相校验」的基础。
4. **`db.scalar(select(ApiKey).where(key_hash == ...))`**：按唯一列等值查一行；`db.get(ApiKey, id)` 则用于撤销。
5. **`datetime.now(timezone.utc).replace(tzinfo=None)`**：物理列是无时区的 `timestamp(3)`，必须写 naive-UTC；读取时 `iso_z` 再按 UTC 解释（阶段 3 §5 的同一条惯例）。
6. **`id=str(uuid.uuid4())`**：Prisma 的 `uuid()` 是客户端默认值，数据库没有 `DEFAULT`，Python 必须自己生成。

### 11.3 `apps/api-py/app/api/public.py`

**完整文件路径：`apps/api-py/app/api/public.py`**

```python
"""`POST /public/apps/{appId}/run` 路由（阶段 10）。

契约见 packages/contract/openapi.yaml，鉴权方案为 `apiKeyAuth`（**不用** JWT）。
取 key 的两种传法与 api-ts 的 `PublicController.extractApiKey` 完全一致：
`X-API-Key` 优先（去掉首尾空白后非空才算提供），其次 `Authorization: Bearer <key>`。

校验顺序（见 error-messages.md §10）：
1. 没有 key → 401 `Missing API key`；
2. 哈希不匹配 / 已撤销 → 401 `Invalid API key`；
3. key 不属于路径里的 `appId`：应用不存在 → 404 `App not found`，存在 → 401 `Invalid API key`；
4. 走引擎的 `run_published`：应用不存在 404、未发布 400 `App is not published`。

SSE 帧与 `POST /apps/{id}/run` **完全一致**（同一套事件构造器与序列化）。
"""

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api_keys import service
from app.engine.engine import run_published
from app.models.app import App

router = APIRouter(prefix="/public", tags=["public"])


class PublicRunRequest(BaseModel):
    """对应契约 `PublicRunRequest`：**只有 `inputs`**（不支持会话）。"""

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any]


def _extract_api_key(x_api_key: str | None, authorization: str | None) -> str | None:
    """`X-API-Key` 优先，其次 `Authorization: Bearer <key>`；空白值视为未提供。"""
    if x_api_key is not None:
        trimmed = x_api_key.strip()
        if trimmed != "":
            return trimmed
    if authorization is not None and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        return token if token != "" else None
    return None


@router.post("/apps/{app_id}/run", operation_id="runPublicApp")
async def run_public_app(
    app_id: str,
    body: PublicRunRequest,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    raw_key = _extract_api_key(x_api_key, authorization)
    if raw_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing API key"
        )
    # 与 TS 一致：先认证（并刷新 last_used_at），再比对路径里的 appId
    authenticated = service.authenticate(db, raw_key)
    if authenticated["appId"] != app_id:
        # 不是这个应用的 key。先确认应用是否存在，避免把「应用不存在」误报成「key 无效」。
        if db.get(App, app_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="App not found"
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
        )
    return StreamingResponse(
        await run_published(db, app_id, body.inputs),
        media_type="text/event-stream",
        # 显式给出 content-type，避免 Starlette 追加 `; charset=utf-8`，与 api-ts 的响应头对齐
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
```

**这段在干什么（按区块）**

1. **`Header(alias="X-API-Key")`**：FastAPI 的 `Header` 默认会把参数名转成连字符形式；这里显式 `alias` 保证读的确实是 `X-API-Key`。`authorization` 不写 alias 也能匹配（大小写不敏感）。
2. **`PublicRunRequest` 只有 `inputs`**，且 `ConfigDict(extra="forbid")`：多传 `conversationId` 会被 Pydantic 拒绝（400），与 TS 的 `forbidNonWhitelisted` 行为一致。
3. **`_extract_api_key` 与 TS 的 `extractApiKey` 逐行对应**：`X-API-Key` 优先；`Bearer ` 前缀切掉后 trim；空串算未提供。
4. **认证先于 appId 比对**：因此「拿 A 的 key 调 B」会先刷新 A 的 `last_used_at`，再报 401（或应用不存在时 404）。这是两端一致的**可观察副作用**。
5. **`await run_published(...)` 拿到异步生成器后再构造 `StreamingResponse`**：任何 4xx（应用不存在 / 未发布 / 预检失败）都在这里抛出，此时响应还没开始，所以是普通 JSON——「先校验、后开流」。
6. **显式指定 `Content-Type` 头**：Starlette 的 `media_type` 会追加 `; charset=utf-8`，与 api-ts 的 `text/event-stream` 不一致；这里用 `headers` 覆盖，保证两端的响应头相同（阶段 0 的 `charset` 经验在这里复用）。

---

## 12. 首次技术教学

### 12.1 「发布」到底发布什么：两份独立的数据

**先把两个列摆出来**

| 列 | 含义 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `graph_json`（`graphJson`） | **草稿**：搭建者正在编辑的图 | `PUT /apps/{id}/graph` | 编辑器 `GET /graph`；`POST /apps/{id}/run`（调试） |
| `published_graph_json`（`publishedGraphJson`） | **快照**：上一次发布时的完整图 | `POST /apps/{id}/graph/publish` | `GET /graph/published`；`POST /public/apps/{appId}/run`（线上） |
| `published_at`（`publishedAt`） | 快照的生成时间 | 同上 | 前端展示「何时发布」 |

> 列的建模（为什么用 `Json?` → `jsonb`、为什么可空表示「尚未编辑 / 从未发布」）在 `03-画布/02-Prisma-JSONB与两态.md` 已首次教学；**本篇讲的是这两份数据在「发布语义」上的关系**。

**发布就是一次赋值**

**完整文件路径：`apps/api-ts/src/graph/graph.service.ts`**（`publish` 的核心片段）

```ts
// publish 的核心
const app = await this.findOwned(ownerId, id)
const draft = this.draftOf(app)
this.assertValid(draft)
const updated = await this.prisma.app.update({
  where: { id },
  data: {
    publishedGraphJson: draft as unknown as Prisma.InputJsonValue,
    publishedAt: new Date(),
  },
})
```

**这段在干什么**

1. 取出**当前草稿**（`draftOf`：`graphJson` 为 `null` 时返回合法空图）。
2. 用**草稿**做语义校验（`validateGraph`）——发布校验的是草稿，不是快照。
3. 把草稿**写进另一个列**，同时记录时间。**没有任何删除、没有改动 `graphJson`**。

Python 侧逐行同义：

**完整文件路径：`apps/api-py/app/api/graph.py`**（`publish_graph` 的核心片段）

```python
# publish 的核心
app = _find_owned(db, current_user.id, id)
draft = _draft_of(app)
_assert_valid(draft)
app.published_graph_json = draft
app.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
db.commit()
```

**这段在干什么**

同样是「校验草稿 → 拷进快照列 → 记时间」。两端都不碰草稿，所以**发布是可重复的拷贝**：草稿不变时连按三次发布，快照内容三次相同（`publishedAt` 每次更新），草稿一行不变。

### 12.2 为什么必须隔离：改一个字就影响所有线上用户

**反例：把「发布」实现成一个布尔标记**

很多系统的第一版会这么做：

```
apps 表：  graph_json, is_published
运行 /run 时读 graph_json；is_published 只控制「能不能调」
```

看起来省了一列，但它把「发布」变成了**一个开关**，而不是**一次快照**。后果：

| 场景 | 布尔标记方案 | 快照方案 |
| --- | --- | --- |
| 你昨天发布的版本正在被 100 个外部客户调用 | 今天你在编辑器里改了一个 prompt 里的字，**这 100 个调用立刻变** | 线上仍跑昨天的快照，一个字都不变 |
| 你改到一半（图暂时不合法 / 引用了还没建的知识库） | 线上调用开始 400，客户以为你挂了 | 线上不受影响，只有草稿校验会失败 |
| 你按下发布 | 什么都不发生（`is_published` 早就是 true） | 快照被更新，线上从**下一次调用**开始用新图 |
| 出了问题想回滚 | 做不到，草稿就是线上 | 把旧版本重新 `PUT` 成草稿再发布（本阶段无「一键回滚」） |

> **核心一句**：草稿是**编辑中的工作区**，它允许中间状态、允许错误、允许频繁变动；线上是**对外承诺**，必须稳定、可复现。把两者指向同一份数据，就等于把「工作区」直接暴露给了所有线上用户。

**所以「隔离」不是可选的优化，而是这个功能的定义。** 如果 `POST /public/apps/{appId}/run` 读的是 `graphJson`，那么「发布」这个词就没有任何含义。

**隔离之后，两条运行路径各读各的**

| 接口 | 读哪列 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| `POST /apps/{id}/run` | `graphJson`（草稿） | JWT | 搭建者调试 |
| `POST /public/apps/{appId}/run` | `publishedGraphJson`（快照） | API Key | 对外服务 |

这也是为什么本阶段**不改** `POST /apps/{id}/run` 一行代码：调试仍然跑草稿，线上才跑快照。两条路径共用同一套引擎（`precheck` / `execute`），差别只在**读哪一列**。

### 12.3 「复制」而不是「引用」：快照的本质

**两个词的区别**

| | 引用（指针） | 复制（值） |
| --- | --- | --- |
| 存什么 | 一个指向别处的标识（如 `graph_version_id`、或「读 `graphJson`」这个约定） | **当时那份完整数据** |
| 草稿变了会怎样 | 快照跟着变（因为指向同一个东西） | 快照**纹丝不动** |
| 需要额外的表吗 | 需要「版本表」才能留住旧版本 | 不需要，快照就是一份完整文档 |
| 回滚 | 天然支持（把指针拨回去） | 需要手动把旧内容写回 |

**本项目的快照是「值」**

`publishedGraphJson` 是 `jsonb` 列，存的是**那一时刻整张图的 JSON 文档**（`version` / `nodes` / `edges` 全量）。Postgres 的 `jsonb` 是**值类型**：写入时整份文档进入该行，不是一个指向别处的引用。

```
发布时：  published_graph_json := {version, nodes:[...], edges:[...]}   ← 全量
而不是：  published_graph_json := "指向 graph_json 的 id"              ← 不是这样
```

**为什么「引用」在这里会坏**

1. **没有可引用的稳定对象**：`graph_json` 是**同一个单元格**，每次 `PUT` 原地覆盖。若要引用「某一版草稿」，就得先有「版本表」——那是另一个功能（版本历史），本阶段没有。
2. **引用的语义就是「跟随」**：如果线上读的是「当前草稿」，那么「发布」只是记录了一个时间戳，隔离不成立（回到 §12.2 的反例）。
3. **跨语言/跨进程要求简单**：快照是自包含文档，任何进程只读这一列就能执行，不依赖「另一个列此刻是什么」。

**代价也要说清**

| 代价 | 说明 |
| --- | --- |
| 存储翻倍 | 每行应用多存一份图 JSON。教学项目可以接受；图很大时要考虑压缩/分层存储 |
| 没有历史版本 | 只有「最后一版快照」；发布 N 次就覆盖 N-1 次 |
| 没有一键回滚 | 想回到旧版，得把旧版内容重新 `PUT` 成草稿再发布 |

> **能力边界**：版本历史 / 回滚 / 灰度发布都是后续阶段的扩展点。本阶段先把「隔离」做对——**正确性优先于功能丰富**。

### 12.4 API Key 的四元组

一把 key 在数据库与响应里会以四种形态出现，各回答一个不同的问题：

| 字段 | 回答的问题 | 存在哪 | 谁能看见 | 是否可还原 key |
| --- | --- | --- | --- | --- |
| `name` | 「这把 key 叫什么？」（人读标签） | `api_keys.name` | 列表 / 创建响应 | 否（与 key 无关） |
| `prefix` | 「列表里怎么区分它？」 | `api_keys.key_prefix` | 列表 / 创建响应 | 否（只有 11 字符） |
| `key_hash` | 「这把 key 合法吗？」 | `api_keys.key_hash`（64 hex） | **只有服务端** | 否（单向） |
| `key` | 「明文是什么？」 | **不落库** | **只在创建响应里一次** | — |

**为什么四个都不能省**

- 只留 `key`：明文落库，一次数据库泄露就全丢。
- 只留 `key_hash`：列表里全是 `3f7a…` 这样的哈希，人无法分辨「哪把是给客户的、哪把是我测试用的」。
- 只留 `prefix`：前缀只有 8 位十六进制（32 位），无法作为完整凭证校验。
- 只留 `name`：名字可以重复、可以改，不是秘密。

**一次性明文的具体形状**

```json
{"id":"...","appId":"...","name":"demo-key","prefix":"sk-e217e49c","createdAt":"...","lastUsedAt":null,"revokedAt":null,"key":"sk-e217e49c78f151618cc8d94a1c6eb7a9"}
```

**这段在干什么**

这是创建接口的**实测响应**。注意三件事：

1. `key` 与其它字段**并列**返回，但只有 `POST` 才有它；`GET` 列表的条目**没有这个键**（不是值为 `null`，是键不存在）。
2. `prefix` = `key` 的前 11 个字符，肉眼可核对。
3. `lastUsedAt` / `revokedAt` 新建时必为 `null`，契约的 `description` 里写死了这一点。

### 12.5 Key 的格式与生成

**格式**

```
sk- + 32 位十六进制 = 35 字符
└┬┘   └──────────┬──────────┘
 3          16 字节 × 2
```

实测：

```
"startsWith sk- = True"
"key 长度 = 35"
"prefix == key.slice(0,11) = True"
```

**两端怎么生成**

```ts
// api-ts
const key = `sk-${randomBytes(16).toString('hex')}`
key.slice(0, 11)   // "sk-" + 8 hex
```

**这段在干什么**

TS 侧用 Node 的 `crypto.randomBytes(16)` 取 16 字节随机，再 `.toString('hex')` 转成 32 个十六进制字符；拼上 `sk-` 后截前 11 字符作为 `prefix`。

```python
# api-py
key = f"sk-{secrets.token_hex(16)}"
key[:11]           # "sk-" + 8 hex
```

**这段在干什么**

Python 侧用 `secrets.token_hex(16)`（密码学安全的随机源）一步得到 32 个十六进制字符，其余完全相同。两段合起来看：

1. 两端都取 **16 字节 = 128 位**随机，转成 **小写十六进制** 后正好 32 字符。库不同、**输出形状完全相同**。
2. `sk-` 是前缀约定：读代码/日志时一眼能认出「这是一把 secret key」，也方便密钥扫描工具（secret scanning）识别并拦截误提交。
3. `prefix = key.slice(0, 11)` 取到 `sk-` + 8 位十六进制，**故意保留 24 位不公开**。

**为什么是十六进制而不是 base64**

| 方案 | 35 字符能装多少熵 | 字符集 | 复制粘贴风险 |
| --- | --- | --- | --- |
| 十六进制（本项目） | 128 位 | `0-9a-f` | 无歧义，不易看错 |
| base64url | 约 192 位 | `A-Za-z0-9-_` | `l` / `1` / `I`、`0` / `O` 易混淆 |

128 位已经远超暴力枚举（`2^128`），没有必要为了多 64 位而牺牲可读性。

**为什么用 SHA-256 而不是 bcrypt**

这是本篇最重要的一条安全推理：

| | 密码（阶段 1） | API Key（本阶段） |
| --- | --- | --- |
| 来源 | **人选的**，熵低，会被字典/撞库 | **机器生成的 128 位随机**，无字典可查 |
| 校验方式 | 取出该用户那一行，用盐重算再比较 | **按 hash 直接定位一行**（`where key_hash = ?`） |
| 需要的哈希 | 慢哈希 + 每行随机盐（bcrypt） | **快哈希、无盐、确定性**（SHA-256） |
| 用 bcrypt 会怎样 | 正确 | **不可行**：bcrypt 每行盐不同，无法用 `key_hash = ?` 查找；只能全表扫描逐行比对 |

> 结论：**「需要按摘要精确查找」这个需求，直接排除了加盐慢哈希。** 高熵随机 secret + 无盐 SHA-256，是行业通行做法（GitHub PAT、Stripe key 都是这个思路）。

### 12.6 为什么 `key_hash` 要 `@unique`

**三个理由，按重要性排序**

1. **它是查找键**：`authenticate` 用 `findUnique({ where: { keyHash } })`（TS）/ `where key_hash == ...`（Py）。Prisma 的 `findUnique` **只允许用在唯一字段**上；没有 `@unique`，代码根本写不出来，只能退化成 `findFirst`。
2. **它是索引**：`UNIQUE` 自动建 B-tree 索引，认证是 `O(log n)` 而不是全表扫。认证发生在**每一次对外调用**上，这是热路径。
3. **它保证「同一把 key 不会被签发两次」**：128 位随机撞车概率极低，但约束把「极低」变成「不可能」——即使有人手工插库、或随机源退化，数据库也会拒绝第二行。

**它顺带回答了一个容易混淆的问题**

`name` 为什么不加 `@@unique([appId, name])`？

| 字段 | 是否唯一 | 为什么 |
| --- | --- | --- |
| `key_hash` | **全局唯一** | 一把 key 只能对应一行；哈希本身就是身份 |
| `(appId, name)` | **不**建唯一约束 | 撤销后允许复用同名（轮换场景）；唯一性由服务层按「未撤销」判定 |

如果给 `(appId, name)` 建唯一约束，那么「撤销旧 key 后用同名再签发一把」会直接被数据库挡住——而这恰恰是**最正常的轮换操作**。

### 12.7 4 个接口的契约分工

**3 + 1 的结构**

| # | 接口 | 认证域 | 成功码 | 关键语义 |
| --- | --- | --- | --- | --- |
| 1 | `GET /apps/{id}/api-keys` | JWT（`bearerAuth`） | 200 | 含已撤销；不含明文 |
| 2 | `POST /apps/{id}/api-keys` | JWT | 201 | 明文只此一次；未撤销重名冲突 |
| 3 | `DELETE /api-keys/{id}` | JWT | 204 | 撤销（置时间），不删除 |
| 4 | `POST /public/apps/{appId}/run` | API Key（`apiKeyAuth`） | 200 | 只读快照；无会话 |

**为什么列表接口不返回明文**

1. **服务端根本没有明文**：只存了 `key_hash`，物理上无法返回。这不是「不想返回」，而是「返回不了」——这是最好的安全设计：**不可实现，胜过约定不做**。
2. **列表会被前端反复拉取**：如果列表带明文，明文就会进入浏览器缓存、日志、截图、前端 state、错误上报。泄露面从「一次响应」扩大到「无数次响应」。
3. **契约用两份 schema 把它钉死**：`ApiKeyResponse` 没有 `key`，`CreateApiKeyResponse` 才有。任何人不小心给列表加了 `key`，契约比对就会失败。

**为什么撤销返回 204**

- 删除/撤销的语义是「状态已改变，没有有意义的响应体」；204 是阶段 2 就定下的惯例（应用删除、会话删除同款）。
- 返回 200 + 一个对象，会让调用方误以为「撤销后还能拿到什么有用信息」——实际上它只能拿到「我已经知道的那个 key」。
- 前端只需要看状态码；`204` 也顺手避免了「响应体里带 `key` 字段」这种危险可能。

**为什么撤销不是物理删除**

| 物理删除 | 撤销（`revokedAt`） |
| --- | --- |
| 列表里消失，管理员看不到「曾经发给谁」 | 列表仍可见，带撤销时间 |
| 审计链断裂 | 保留签发/撤销的完整历史 |
| 「同名复用」变得随意 | 重名检查只针对未撤销，语义清晰 |

代价是表会增长；对一个教学项目可以接受，生产可以加定期归档。

**为什么创建是 201**

资源由服务端创建并分配了 `id`，响应返回完整体——与阶段 2 的 `POST /apps`、阶段 9 的 `POST /conversations` 一致。

### 12.8 `apiKeyAuth`：两套认证方案共存于一份 OpenAPI

**两种安全方案的语义差异**

| | `bearerAuth` | `apiKeyAuth` |
| --- | --- | --- |
| `type` | `http` | `apiKey` |
| 子字段 | `scheme: bearer` + `bearerFormat: JWT` | `in: header` + `name: X-API-Key` |
| 表达什么 | 「按 HTTP 规范，用 `Authorization: Bearer <token>` 传一个 token」 | 「把一段不透明字符串放在指定位置」 |
| 本项目用途 | 登录用户的 JWT | 外部调用者的应用凭证 |

**共存的方式是「按 operation 选」**

```yaml
paths:
  /apps/{id}/api-keys:
    get:
      security:
        - bearerAuth: []       # 这个操作要 JWT
  /public/apps/{appId}/run:
    post:
      security:
        - apiKeyAuth: []       # 这个操作要 API Key
```

**这段在干什么**

1. `security` 是**每个 operation 的局部声明**，`components.securitySchemes` 只是**方案清单**。所以一份 OpenAPI 里有几套认证方案都正常——每个接口声明自己用哪套。
2. `security` 是**数组**：数组的每个元素是一个「**与**」组合，元素之间是「**或**」。所以单个元素里写多个方案 = 两个都要；写多个元素 = 任选其一。`- apiKeyAuth: []` 是最常见的形式（只要这一个方案）；若要「两个都要」，写成同一个 list item 里的两项。本项目没有这种接口。
3. 顶层**没有** `security` 全局默认；每个受保护接口都显式声明，避免「忘了覆盖全局」导致公开接口被误加认证。

**为什么不用 `bearerAuth` 描述 API Key**

- 语义上错：API Key 不是 JWT，声明成 `scheme: bearer` + `bearerFormat: JWT` 会让生成的客户端、API 文档、网关配置全部误解。
- 安全审计上错：审计工具看到 `bearerAuth` 会按 JWT 规则检查（过期、签名），而 API Key 是「长期有效、按需撤销」的另一种模型。
- 两者并存不冲突：**不同的安全域本来就该有不同的方案**。

**那 `Authorization: Bearer <key>` 怎么办**

实现同时接受它（便于兼容只支持标准头的客户端），但 OpenAPI 的单个 `apiKey` 方案**无法表达「header 或 bearer 任选其一」**。本项目的处理是：

- 契约只声明**规范形式** `X-API-Key`（生成客户端会用它）；
- 兼容形式写进 `description`（人读）；
- 两端实现按同一优先级解析（`X-API-Key` 优先）。

另一种写法是再声明一个 `bearerAsApiKey`（`type: http` / `scheme: bearer`），然后 `security` 里写两个 list item 表示「任选」。本项目没有这么做：**一个规范形态 + 一段说明**更简单，也避免调用方以为有两种不同的凭证。

### 12.9 `PublicRunRequest` 为什么只有 `inputs`

**阶段 9 的 `RunRequest` 有三个字段**

```ts
export interface RunRequest {
  inputs: Record<string, unknown>
  conversationId?: string
  userMessage?: string
}
```

**对外接口只有一个**

```ts
export interface PublicRunRequest {
  inputs: Record<string, unknown>
}
```

**为什么不是「运行期忽略」**

| 方案 | 调用方看到什么 | 问题 |
| --- | --- | --- |
| 复用 `RunRequest`，运行期忽略 `conversationId` | 请求成功，但会话没生效 | **静默失效**：调用方以为自己在用会话，实际每次都是全新上下文，问题极难排查 |
| 复用 `RunRequest`，运行期报错 | 一个奇怪的「不支持」错误 | 契约说支持、运行期说不支持，文档与行为矛盾 |
| **独立 `PublicRunRequest`**（本项目） | `400 conversationId should not exist` | 契约即真相：字段不存在，所以「不支持」在**类型层**就说清楚了 |

**这条设计的一条通用原则**

> **能力边界应该写在契约里，而不是写在运行期的 `if` 里。**

运行期的 `if` 只会把「不支持」变成「不生效」；契约里的字段缺失会把「不支持」变成「编译/校验期的显式错误」。

**为什么不支持会话（产品理由）**

| 理由 | 说明 |
| --- | --- |
| 归属 | 会话有 `ownerId`（阶段 9 的三层校验），对外调用者**不是某个登录用户** |
| 语义 | API Key 代表**应用**，不代表**某个人**；「这把 key 的对话历史」没有定义 |
| 复杂度 | 要做对外会话，得先定义「按 key 分会话」「跨 key 隔离」「历史清理」——超出本阶段 |
| 成本 | 无会话意味着对外运行天然**无状态**，更容易水平扩展、更容易做限流与重试 |

**一个直接后果**

如果已发布的图里有 `llm` 节点设了 `useHistory: true`，对外运行会在**预检**失败：

```
400  llm node llm1 useHistory requires a conversation
```

因为 `runPublished` 调用预检时传的是 `hasConversation = false`。这不是 bug，而是「发布时校验草稿、运行时不提供会话」两条规则的必然交点。搭对外应用时**不要开 `useHistory`**（或者在发布前把它关掉）。

### 12.10 对外运行的校验顺序与 7 条文案

**5 步顺序（错误面）**

| 步 | 检查 | 失败时 | 为什么在这个位置 |
| --- | --- | --- | --- |
| 1 | 有没有提供 key | 401 `Missing API key` | 最先，且**不查库**——最便宜的拒绝 |
| 2 | 哈希匹配且未撤销 | 401 `Invalid API key` | 认证必须在授权之前 |
| 3 | key 的 `appId` 是否等于路径 `appId` | 401 `Invalid API key`（应用不存在则 404 `App not found`） | 一把 key 只能调它所属的应用 |
| 4 | 是否已发布 | 400 `App is not published` | 只有认证通过的人，才配知道「这个应用没发布」 |
| 5 | 图预检（含 `useHistory` 需会话） | 400 普通 JSON | 与草稿运行同一套 `precheck`，失败在开流前 |

**第 3 步内部：为什么要先查应用是否存在**

实现里是这样写的：

```
key 校验通过，但 key.appId !== 路径 appId
   ├─ 先查路径 appId 的应用是否存在
   │    ├─ 不存在 → 404 App not found
   │    └─ 存在   → 401 Invalid API key
```

如果反过来（先无条件 401），那么「用一个合法 key 探测某个 appId 是否存在」就永远得到 401，调用方无法区分「我 key 拿错了」和「这个应用 id 根本不存在」——运维排查会非常痛苦。先查存在性，把两种失败区分开。

**其余 3 条（管理接口）**

| 场景 | HTTP | message | 触发位置 |
| --- | --- | --- | --- |
| 名字 > 60 字符 | 400 | `API key name is too long` | `create` 的服务层 |
| 同应用内未撤销的重名 | 400 | `API key name already exists` | `create` 的服务层 |
| 撤销不存在 / 不属于自己 | 404 | `API key not found` | `revoke` 的归属校验 |

**为什么这 3 条不交给 DTO / Pydantic**

`max_length` 会产生通用文案 `name must be at most 60 characters`（§1.1 规则），而 §10 指定了专用文案。这是阶段 2 起的同一原则：**契约文案优先于框架默认文案**。所以两端都把「过长」放在服务层手写。

**一个可观察的细节**

`authenticate` 在**比对 appId 之前**就更新了 `last_used_at`。因此「拿 A 应用的 key 去调 B 应用」也会刷新 A 的 `last_used_at`，然后才返回 401。两端一致，Python 的 docstring 里明确写了这一点。

### 12.11 两端对照与「曾存在的差异」

**同一张表，两套 ORM（与前几个阶段同一套规矩）**

| 事实 | Prisma（api-ts） | SQLAlchemy（api-py） |
| --- | --- | --- |
| DDL 归属 | **拥有**（`prisma migrate`） | **不产生**（无 alembic） |
| 表/列名 | `@@map("api_keys")` / `@map("key_hash")` | `__tablename__` / `mapped_column` |
| `id` 生成 | `@default(uuid())`（**客户端**） | `str(uuid.uuid4())`（服务层显式） |
| key 生成 | `randomBytes(16).toString('hex')` | `secrets.token_hex(16)` |
| 哈希 | `createHash('sha256').digest('hex')` | `hashlib.sha256(...).hexdigest()` |
| 查找 | `findUnique({ where: { keyHash } })` | `select(...).where(ApiKey.key_hash == ...)` |
| 撤销写入 | `update({ data: { revokedAt: new Date() } })` | 赋 naive-UTC 后 `commit()` |
| 时间输出 | `toISOString()` | `iso_z()`（阶段 2 已收口） |
| 级联删除 | `onDelete: Cascade`（迁移里是数据库外键） | `passive_deletes=True`，交给数据库 |

**两处曾被记录为「两端不一致」的校验：现已两端一致**

| 情形 | api-ts | api-py | 现状 |
| --- | --- | --- | --- |
| 请求体**缺失** `name` | 400 `name is required`（校验工厂的 `value === undefined` 分支） | 400 `name is required`（服务层 `if name is None`） | **曾不一致，已修复**，逐字节相同 |
| 同时「应用不属于你」+「name 过长」 | 先 `assertAppOwned` → **404 `App not found`** | 先 `_find_owned_app` → **404 `App not found`** | **本来就一致**（此前「Py 先报超长 400」的记述是错的） |

**第一条：缺失 `name` 曾经确实不一致，已按项目约定收口**

修复前：TS `name is required`、Py `name must be a string`。修复点：`apps/api-py/app/api_keys/service.py` 的 `create()` 开头新增

```python
if name is None:
    raise _bad_request("name is required")
```

（其后保留 `not isinstance(name, str)` → `name must be a string`、`len(name) < 1` → `name must be at least 1 characters`。）

理由：项目既有约定是「**缺失统一报 `{field} is required`**」——`/apps`、`/knowledge-bases` 两端都如此；Py 的 api-keys 是唯一的异常值，所以补的是 Python 而不是把 TS 改掉。

**第二条：「Py 先校验长度」的说法不成立**

`create()` 里名称的「缺失 / 空 / 类型」校验确实在归属校验之前，但**超长（> 60）检查在归属校验之后**。所以「非本人应用 + 超长名」两端都先撞上归属：`_find_owned_app()` / `assertAppOwned` → **404 `App not found`**，不会返回 400。

**实测（两端逐字节相同）**

| 请求 | 结果 |
| --- | --- |
| `{}` | `400 {"statusCode":400,"message":"name is required","error":"Bad Request"}` |
| `{"name":""}` | `400 …"name must be at least 1 characters"…` |
| `{"name":"<61 个 x>"}`（本人应用） | `400 …"API key name is too long"…` |
| 非本人应用 + 超长名 | `404 {"statusCode":404,"message":"App not found","error":"Not Found"}` |

---

## 13. 验收自测

> 前提：`mini-dify-db` 为 `healthy`；两套后端已启动；`pnpm run build:contract` 已成功；已注册 / 登录。
> PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，请写 **`curl.exe`**。
> 所有 JSON 请求体必须是 **UTF-8 无 BOM**。

### 13.1 准备账号、应用与一张最简图

```powershell
# 仓库根
curl.exe -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3001/auth/register `
  -H 'Content-Type: application/json' -d '{"email":"bob@example.com","password":"secret123"}'

$TOKEN = (curl.exe -s -X POST http://127.0.0.1:3001/auth/login `
  -H 'Content-Type: application/json' -d '{"email":"bob@example.com","password":"secret123"}' `
  | ConvertFrom-Json).accessToken

$APP_ID = (curl.exe -s -X POST http://127.0.0.1:3001/apps `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  -d '{"name":"public-demo","description":null,"mode":"workflow"}' | ConvertFrom-Json).id

$TOKEN.Length; $APP_ID
```

**预期**：`$TOKEN` 非空（长度 > 100），`$APP_ID` 为 uuid。

**这段在干什么**

用一条注册命令（已注册时返回 409，可忽略）+ 登录拿 JWT + 建一个 `workflow` 应用。后面所有「管理接口」都用 `$TOKEN`，只有「对外运行」用 key。

准备一个「写 UTF-8 无 BOM 文件」的函数与两份图（`v1` 与 `v2` 只差输出模板）：

```powershell
function Write-Utf8([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Utf8 "$PWD\graph-v1.json" '{"version":"1","nodes":[{"id":"s1","type":"start","position":{"x":0,"y":0},"data":{"inputs":[{"name":"topic","type":"string","required":true}]}},{"id":"e1","type":"end","position":{"x":220,"y":0},"data":{"outputs":[{"name":"answer","value":"线上：{{ inputs.topic }}"}]}}],"edges":[{"id":"e_s_e","source":"s1","target":"e1"}]}'

Write-Utf8 "$PWD\graph-v2.json" '{"version":"1","nodes":[{"id":"s1","type":"start","position":{"x":0,"y":0},"data":{"inputs":[{"name":"topic","type":"string","required":true}]}},{"id":"e1","type":"end","position":{"x":220,"y":0},"data":{"outputs":[{"name":"answer","value":"草稿：{{ inputs.topic }}"}]}}],"edges":[{"id":"e_s_e","source":"s1","target":"e1"}]}'
```

**这段在干什么**

两张图结构完全相同，只有 `end` 的输出模板不同：`v1` 输出「线上：…」，`v2` 输出「草稿：…」。这正是检验「发布隔离」的最小实验：发布 `v1` → 改成 `v2` 草稿 → 线上仍应输出「线上：…」。

### 13.2 保存草稿并发布

```powershell
curl.exe -s -o out.json -w '%{http_code}\n' -X PUT "http://127.0.0.1:3001/apps/$APP_ID/graph" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary '@graph-v1.json'

curl.exe -s -X POST "http://127.0.0.1:3001/apps/$APP_ID/graph/publish" `
  -H "Authorization: Bearer $TOKEN" | ConvertFrom-Json | Select-Object publishedAt
```

**预期**：第一次 `200`；发布返回 `publishedAt`（24 字符、`Z` 结尾）。

**这段在干什么**

先 `PUT` 把 `v1` 写进**草稿**列，再 `POST publish` 把草稿**拷进快照**列。这两步完成后，`graph_json` 与 `published_graph_json` 内容相同、但彼此独立。

### 13.3 创建 API Key 并断言格式

```powershell
$CREATED = curl.exe -s -X POST "http://127.0.0.1:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  -d '{"name":"demo-key"}' | ConvertFrom-Json

$KEY_ID = $CREATED.id
$KEY    = $CREATED.key

$CREATED | Select-Object id, appId, name, prefix, lastUsedAt, revokedAt
"startsWith sk- = $($KEY.StartsWith('sk-'))"
"key 长度 = $($KEY.Length)"
"prefix == key.slice(0,11) = $($CREATED.prefix -eq $KEY.Substring(0,11))"
```

**预期**（本篇实测）：

```text
"startsWith sk- = True"
"key 长度 = 35"
"prefix == key.slice(0,11) = True"
```

创建响应的形状（实测）：

```json
{"id":"...","appId":"...","name":"demo-key","prefix":"sk-e217e49c","createdAt":"2026-10-23T...Z","lastUsedAt":null,"revokedAt":null,"key":"sk-e217e49c78f151618cc8d94a1c6eb7a9"}
```

**这段在干什么**

一次请求同时验证四件事：`sk-` 前缀、35 字符、`prefix` 与前 11 字符相等、`lastUsedAt` / `revokedAt` 为 `null`。这三条断言是验收标准第 7 条的直接编码。

### 13.4 列表不返回明文

```powershell
$LIST = curl.exe -s "http://127.0.0.1:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" | ConvertFrom-Json

$LIST.items[0].PSObject.Properties.Name -join ','
"has key field = $($null -ne $LIST.items[0].PSObject.Properties['key'])"
```

**预期**：

```text
id,appId,name,prefix,createdAt,lastUsedAt,revokedAt
"has key field = False"
```

**这段在干什么**

第一行列出条目**实际存在的键**；第二行做显式断言。注意 `prefix` 在、`key` **不在**——不是 `key: null`，而是这个键压根不存在（验收标准第 8 条）。

### 13.5 对外运行成功（SSE）

```powershell
Write-Utf8 "$PWD\pub-run.json" '{"inputs":{"topic":"AI"}}'

curl.exe -sN -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" `
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' `
  --data-binary '@pub-run.json' -o pub1.txt

Get-Content pub1.txt -TotalCount 2
Get-Content pub1.txt -Encoding UTF8 | Select-String 'run_finished' -Context 0,1
```

**预期**：第一帧是 `run_started`，`data` 里**只有** `runId` / `appId`（对外运行无会话，所以没有 `conversationId` 键）；最后一帧附近有：

```text
event: run_finished
data: {"runId":"...","outputs":{"answer":"线上：AI"},"elapsedMs":...}
```

**这段在干什么**

用 API Key（而不是 JWT）跑通一次完整执行，并确认输出是发布版 `v1` 的模板。`run_finished.outputs.answer` 是后面判断「隔离是否生效」的唯一依据。

### 13.6 核心验证：改草稿不影响线上

```powershell
# 1) 把草稿改成 v2（输出「草稿：…」）
curl.exe -s -o out.json -w '%{http_code}\n' -X PUT "http://127.0.0.1:3001/apps/$APP_ID/graph" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary '@graph-v2.json'

# 2) 不发布，直接对外调用
curl.exe -sN -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" `
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' `
  --data-binary '@pub-run.json' -o pub2.txt

Get-Content pub2.txt -Encoding UTF8 | Select-String 'run_finished' -Context 0,1
```

**预期**：仍然是 `{"answer":"线上：AI"}`——**草稿改了，线上没变**。

**这段在干什么**

这是本篇最重要的一次实测。它直接验证了「快照是独立数据」：`PUT /graph` 只写 `graph_json`，对外运行只读 `published_graph_json`，两者互不影响。

### 13.7 重新发布，线上才变

```powershell
curl.exe -s -o out.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/apps/$APP_ID/graph/publish" `
  -H "Authorization: Bearer $TOKEN"

curl.exe -sN -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" `
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' `
  --data-binary '@pub-run.json' -o pub3.txt

Get-Content pub3.txt -Encoding UTF8 | Select-String 'run_finished' -Context 0,1

# 已发布图应该等于 v2
curl.exe -s "http://127.0.0.1:3001/apps/$APP_ID/graph/published" `
  -H "Authorization: Bearer $TOKEN" | ConvertFrom-Json | Select-Object -ExpandProperty nodes |
  Select-Object -Last 1 | Select-Object -ExpandProperty data
```

**预期**：`run_finished` 的输出变成 `{"answer":"草稿：AI"}`；`graph/published` 的 `end.data.outputs[0].value` 为 `草稿：{{ inputs.topic }}`。

**这段在干什么**

同一把 key、同一张图，只多了一次发布，输出就变了。两段对照（§13.6 不变、§13.7 变）合起来证明了：**线上行为只在 `publish` 时更新**。

### 13.8 撤销后立即失效，但列表仍在

```powershell
curl.exe -s -o /dev/null -w '%{http_code}\n' -X DELETE "http://127.0.0.1:3001/api-keys/$KEY_ID" `
  -H "Authorization: Bearer $TOKEN"

$LIST2 = curl.exe -s "http://127.0.0.1:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" | ConvertFrom-Json

"count = $($LIST2.items.Count)"
$LIST2.items[0] | Select-Object name, prefix, revokedAt

curl.exe -s -o err.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" `
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' `
  --data-binary '@pub-run.json'
Get-Content err.json -Encoding UTF8
```

**预期**：

```text
204
count = 1
name      prefix       revokedAt
demo-key  sk-e217e49c  2026-10-23T...Z
401
{"statusCode":401,"message":"Invalid API key","error":"Unauthorized"}
```

**这段在干什么**

三件事一次验证：撤销返回 **204**；列表**仍返回**该条（带 `revokedAt`）；用已撤销的 key 立刻得到 **401 `Invalid API key`**（无宽限期）。这是验收标准第 9 条。

### 13.9 错误文案逐字（7 条）

```powershell
# 先签发一把**有效**的 key（上一节的 $KEY 已被撤销，不能再用）
$KEY3 = (curl.exe -s -X POST "http://127.0.0.1:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  -d '{"name":"probe-key"}' | ConvertFrom-Json).key

# (a) 不带 key → 401 Missing API key
curl.exe -s -o err.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" `
  -H 'Content-Type: application/json' --data-binary '@pub-run.json'
Get-Content err.json -Encoding UTF8

# (b) 伪造 key → 401 Invalid API key
curl.exe -s -o err.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" `
  -H 'X-API-Key: sk-00000000000000000000000000000000' `
  -H 'Content-Type: application/json' --data-binary '@pub-run.json'
Get-Content err.json -Encoding UTF8

# (c) 用**有效** key 调一个不存在的应用 → 404 App not found
curl.exe -s -o err.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/public/apps/00000000-0000-0000-0000-000000000000/run" `
  -H "X-API-Key: $KEY3" -H 'Content-Type: application/json' --data-binary '@pub-run.json'
Get-Content err.json -Encoding UTF8
```

**预期**：

```text
401  {"statusCode":401,"message":"Missing API key","error":"Unauthorized"}
401  {"statusCode":401,"message":"Invalid API key","error":"Unauthorized"}
404  {"statusCode":404,"message":"App not found","error":"Not Found"}
```

接着验证「未发布」：用同一个账号再建一个**不发布**的应用，用它的 key 调用：

```powershell
$APP2 = (curl.exe -s -X POST http://127.0.0.1:3001/apps `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  -d '{"name":"unpublished","description":null,"mode":"workflow"}' | ConvertFrom-Json).id

$KEY2 = (curl.exe -s -X POST "http://127.0.0.1:3001/apps/$APP2/api-keys" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' `
  -d '{"name":"draft-key"}' | ConvertFrom-Json).key

curl.exe -s -o err.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/public/apps/$APP2/run" `
  -H "X-API-Key: $KEY2" -H 'Content-Type: application/json' --data-binary '@pub-run.json'
Get-Content err.json -Encoding UTF8
```

**预期**：

```text
400  {"statusCode":400,"message":"App is not published","error":"Bad Request"}
```

最后是 3 条管理接口文案：

```powershell
# 名字过长（61 个字符）→ 400 API key name is too long
$LONG = '{"name":"' + ('a' * 61) + '"}'
Write-Utf8 "$PWD\long-key.json" $LONG
curl.exe -s -o err.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary '@long-key.json'
Get-Content err.json -Encoding UTF8

# 重名（demo-key 已撤销，可以复用；先建 demo-key 再建一次 demo-key）
curl.exe -s -o out.json -X POST "http://127.0.0.1:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"demo-key"}' > $null
curl.exe -s -o err.json -w '%{http_code}\n' -X POST "http://127.0.0.1:3001/apps/$APP_ID/api-keys" `
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"demo-key"}'
Get-Content err.json -Encoding UTF8

# 撤销不存在的 key → 404 API key not found
curl.exe -s -o err.json -w '%{http_code}\n' -X DELETE "http://127.0.0.1:3001/api-keys/00000000-0000-0000-0000-000000000000" `
  -H "Authorization: Bearer $TOKEN"
Get-Content err.json -Encoding UTF8
```

**预期**：

```text
400  {"statusCode":400,"message":"API key name is too long","error":"Bad Request"}
400  {"statusCode":400,"message":"API key name already exists","error":"Bad Request"}
404  {"statusCode":404,"message":"API key not found","error":"Not Found"}
```

> 注意第二条：撤销前的 `demo-key` 不算冲突，所以第一次重建**成功**（这也验证了「撤销后允许复用同名」）；第二次才 400。

**这段在干什么**

把 7 条文案按**触发路径**分组实测：前四条是「对外运行」（缺 key / 无效 key / 应用不存在 / 未发布），后三条是「管理接口」（名称过长 / 重名 / 撤销归属）。每条都核对 `statusCode`、`message`、`error` 三个字段——契约比对的就是这三件套，而不是只看状态码。

### 13.10 数据库自检：哈希 64 位、明文不落库

```powershell
docker exec -i mini-dify-db psql -U postgres -d minidify -c "select name, key_prefix, length(key_hash) as hash_len, left(key_hash, 8) as hash_head from api_keys order by created_at;"

docker exec -i mini-dify-db psql -U postgres -d minidify -c "select count(*) as plaintext_rows from api_keys where key_hash like 'sk-%';"
```

**预期**（行数取决于前面建了几把 key，重点是 `hash_len` 与明文 0 行）：

```text
 name       | key_prefix  | hash_len | hash_head
------------+-------------+----------+-----------
 demo-key   | sk-e217e49c |       64 | 3f7a...
 probe-key  | sk-9b2c17d0 |       64 | 8c41...
------------+-------------+----------+-----------
 plaintext_rows
----------------
              0
```

**这段在干什么**

`hash_len = 64` 证明存的是 SHA-256 十六进制；`plaintext_rows = 0` 证明没有任何一行的 `key_hash` 长得像明文。这是验收标准第 10 条。

### 13.11 删除应用后 key 级联清零

```powershell
curl.exe -s -o /dev/null -w '%{http_code}\n' -X DELETE "http://127.0.0.1:3001/apps/$APP2" `
  -H "Authorization: Bearer $TOKEN"

docker exec -i mini-dify-db psql -U postgres -d minidify -c "select count(*) as keys_of_app2 from api_keys where app_id = '$APP2';"
```

**预期**：`204`；`keys_of_app2 = 0`。

**这段在干什么**

验证 `ON DELETE CASCADE`：删应用会带走它的 key，不留「无主凭证」。这也是为什么 `api_keys` 同时有 `app_id` 和 `owner_id` 两条外键——删应用、删用户都能清理干净。

### 13.12 验收清单

| # | 检查项 | 做法 | 预期 |
| --- | --- | --- | --- |
| 1 | 契约编译 | `pnpm run build:contract` | 无报错 |
| 2 | 版本一致 | `openapi.yaml#/info/version` 与 `CONTRACT_VERSION` | 均为 `0.10.0` |
| 3 | 4 个操作 | `openapi.yaml` | `list/create/revoke/runPublic` 各一 |
| 4 | 两套安全方案 | `components.securitySchemes` | `bearerAuth` + `apiKeyAuth` |
| 5 | `key` 只在创建响应 | 对比两份 schema 的 `required` | 列表无、创建有 |
| 6 | 唯一索引 | `\d api_keys` | `UNIQUE (key_hash)` |
| 7 | 外键级联 | `\d api_keys` | 两条 `ON DELETE CASCADE` |
| 8 | key 格式 | §13.3 | `True` / `35` / `True` |
| 9 | 列表无明文 | §13.4 | `has key field = False` |
| 10 | 对外运行 | §13.5 | `run_finished.outputs.answer = 线上：AI` |
| 11 | 隔离 | §13.6 | 改草稿后仍是「线上：AI」 |
| 12 | 发布生效 | §13.7 | 重新发布后变「草稿：AI」 |
| 13 | 撤销 | §13.8 | `204` + 列表仍有一条 + `401 Invalid API key` |
| 14 | 4 条对外文案 | §13.9 (a)(b)(c) + 未发布 | `Missing` / `Invalid` / `App not found` / `App is not published` |
| 15 | 3 条管理文案 | §13.9 后段 | `too long` / `already exists` / `API key not found` |
| 16 | 哈希 | §13.10 | `hash_len = 64`、明文 0 行 |
| 17 | 级联 | §13.11 | 应用删除后 key 计数 0 |

---

## 14. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 用「发布标记 + 读草稿」实现发布 | 改一个字的草稿，所有线上调用跟着变 | 发布必须是**快照**，不是开关（§12.2） |
| 把 `publishedGraphJson` 当作「指向草稿的指针」 | 草稿一改，线上跟着变；或者根本不知道「什么时候的图」 | 快照存的是**当时的完整图**，不是引用（§12.3） |
| 以为发布是「追加一个版本」 | 连发两次，找不到第一版 | 每次发布**覆盖**上一份，只保留最后一版；无回滚（§12.3 的代价表） |
| 对外接口复用 `RunRequest` | 传了 `conversationId` 也“成功”，但历史没生效 | 用独立的 `PublicRunRequest`，多传字段直接 400（§12.9） |
| 把 `key` 明文存进数据库 | 一次泄露全部凭证失效 | 只存 `sha256`（60+ 字符的 hex）+ `prefix`（§12.4） |
| 用 `bcrypt` 存 key | 认证时无法按哈希查找，只能全表扫描 | 高熵随机 secret 用无盐 SHA-256；bcrypt 只适合人选密码（§12.5） |
| 给 `key_hash` 不加唯一索引 | Prisma 的 `findUnique` 用不了；认证退化成全表扫 | `@unique` 同时提供「唯一」与「索引」（§12.6） |
| 给 `(app_id, name)` 加唯一约束 | 撤销后想用同名重新签发，被数据库挡住 | 唯一性只在服务层按 `revoked_at IS NULL` 判定（§12.6） |
| 列表接口返回 `key` | 明文进入缓存/日志/截图 | 列表用 `ApiKeyResponse`（无 `key`）；只有 `CreateApiKeyResponse` 有（§12.7） |
| 撤销做成物理删除 | 历史记录消失，审计断链 | 置 `revokedAt`，列表仍返回（§12.7） |
| 以为撤销有宽限期 | 调用方还能用一会儿 | 本项目**立即失效**，`revoked_at` 非空即 `Invalid API key`（§12.7） |
| 重名检查把已撤销的也算上 | 轮换 key 时无法复用名字 | 只查 `revoked_at IS NULL`（§12.6） |
| 用 `bearerAuth` 描述 API Key | 生成的客户端/文档以为这是 JWT | 用 `type: apiKey` / `in: header` / `name: X-API-Key`（§12.8） |
| 以为 `security` 里写两个方案 = 两个都要 | 文档语义错 | 选一个写；同一对象内两项才是「都要」（§12.8） |
| 用 JWT 调 `/public/...` | 401 `Invalid API key` | 两套认证域互不通用；JWT 不是 API Key（§12.10） |
| 用别人的 `appId` + 自己的 key | 应用存在 → 401 `Invalid API key`；应用不存在 → 404 `App not found` | 先认证、再比对 appId、并区分应用是否存在（§12.10） |
| 未发布就直接调 | 400 `App is not published`（不是 404） | 未发布是「状态问题」，不是「资源不存在」（§12.10） |
| 把「未发布」记成 404 | 调用方以为应用被删了 | 文案与码由 §10 固定（§12.10） |
| 对外运行期望有会话 | `400 llm node X useHistory requires a conversation` | `runPublished` 传 `hasConversation=false`；发布前关掉 `useHistory`（§12.9） |
| 在对外请求体里带 `conversationId` | `400 conversationId should not exist` | `PublicRunRequest` 只有 `inputs` + `forbidNonWhitelisted`（§12.9） |
| 改完草稿就以为线上变了 | 对外输出没变，以为发布坏了 | 必须再 `POST /graph/publish`（§13.6、§13.7） |
| 以为 `publishedAt` 非空就一定有快照 | 出现 `graph: null` | 两列同时写；判断是否发布**只看 `publishedGraphJson === null`** |
| 把 `prefix` 当凭证调用 | 401 `Invalid API key` | `prefix` 只有 11 字符，不是 key（§12.4） |
| `X-API-Key` 传空串 | 期望 401 `Invalid API key`，实际是 `Missing API key` | 两端都把「trim 后为空」视为未提供（§12.10） |
| 删应用后 key 还能用 | 期望 401，实际已经查不到 | `ON DELETE CASCADE`；这是验收标准第 13 条（§13.11） |
| Prisma 迁移顺手删了 HNSW 索引 | 向量检索变慢 / 报错 | 迁移文件里手工删掉 `DROP INDEX`；每次 `migrate dev` 后检查（§8.2） |
| Python 侧自己建 `api_keys` 表 | 两套 DDL 冲突、列漂移 | Prisma 拥有 DDL，Python 只映射（§9） |
| Python 插入 key 不生成 UUID | 主键 `NULL` / 重复 | Prisma 的 `uuid()` 是客户端默认值；`str(uuid.uuid4())`（§11.2） |
| Python 写 `revoked_at` 用 aware datetime | 时区/精度漂移 | 列是无时区 `timestamp(3)`，写 `datetime.now(timezone.utc).replace(tzinfo=None)`（§11.2） |
| 以为「缺 `name`」两端文案不同 | 旧文档写 TS `name is required` vs Py `name must be a string` | 已修复：Py 服务层补 `if name is None`，两端均 400 `name is required`（§12.11） |

---

## 15. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 | 登记 |
| --- | --- | --- |
| **发布语义：草稿与快照是两份独立数据** | `graphJson`（草稿，`PUT /graph` 写、`POST /run` 读）与 `publishedGraphJson`（快照，`publish` 写、`public run` 读）互不影响；`publishedAt` 记录快照时间。发布 = 校验**草稿** → 把它写进**另一个列**，不修改草稿；连发多次是幂等覆盖 | **首次教学于本篇** |
| **为什么发布必须隔离** | 草稿是编辑中的工作区（允许中间态、允许错误、频繁变动），线上是稳定承诺。若线上读草稿/或「布尔发布标记」，改一个字就影响所有线上用户，且改到一半会让线上 400。隔离不是优化，是功能的定义 | **首次教学于本篇** |
| **快照的本质：复制而非引用** | `publishedGraphJson` 是 `jsonb` 值，存**当时完整图**（version/nodes/edges 全量），不是指向 `graphJson` 的指针。引用方案需要版本表、且语义就是「跟随」⇒ 隔离不成立。代价：存储翻倍、无历史版本、无一键回滚（版本/回滚/灰度是扩展点） | **首次教学于本篇** |
| **API Key 四元组** | `name`（人读标签，未撤销内唯一）/ `prefix`（11 字符展示，无法还原）/ `key_hash`（64 hex，校验用，落库）/ `key`（明文，**仅创建响应返回一次**，不落库）。少任何一个都会在「可辨识」或「不可泄露」上出问题 | **首次教学于本篇** |
| **Key 格式与生成** | `sk-` + 32 位十六进制 = **35 字符**；`crypto.randomBytes(16)` / `secrets.token_hex(16)` 都是 128 位随机；`prefix = key.slice(0, 11)` / `key[:11]` = `sk-` + 8 hex。选 hex 而非 base64 是为了可读、无歧义；**为什么用无盐 SHA-256 而不用 bcrypt**：认证需要 `where key_hash = ?` 精确查找，加盐慢哈希无法定位行，且 key 是高熵随机、无字典风险 | **首次教学于本篇** |
| **`key_hash @unique` 的三重作用** | ① 让 Prisma `findUnique` 可用（认证热路径）；② 提供 B-tree 索引（O(log n)）；③ 保证同一把 key 不会被签发两次。反例：不要给 `(appId, name)` 加唯一约束，否则撤销后无法复用同名；重名由服务层按 `revokedAt: null` 判定 | **首次教学于本篇** |
| **4 个接口的 3+1 契约分工** | 3 个管理接口（JWT：列表/创建/撤销）+ 1 个对外接口（API Key：运行）。列表用 `ApiKeyResponse`（结构上无 `key`，且服务端根本没有明文）；创建用 `CreateApiKeyResponse`（多 `key`，201）；撤销 204、置 `revokedAt` 而非物理删除（保留审计、列表可见、可复用同名） | **首次教学于本篇** |
| **`apiKeyAuth` 与 `bearerAuth` 并列共存** | `type: apiKey` / `in: header` / `name: X-API-Key` 表达「不透明字符串放在指定位置」；`type: http` / `scheme: bearer` / `bearerFormat: JWT` 表达 Bearer 令牌。两者同在 `components.securitySchemes`，**按 operation 的 `security` 二选一**；同一 list item 内写两项才是「都要」。不用 `bearerAuth` 描述 API Key（语义/审计都会错）；兼容的 `Authorization: Bearer <key>` 只能写进 `description` | **首次教学于本篇** |
| **`PublicRunRequest` 只有 `inputs`：契约砍字段** | 对外运行不支持会话，所以**契约层面**去掉 `conversationId` / `userMessage`，配 `additionalProperties: false` + `forbidNonWhitelisted` ⇒ 多传即 400 `... should not exist`。对比「运行期忽略」：后者是静默失效。通用原则：**能力边界写在契约里，不写在运行期的 if 里**。后果：已发布图里 `useHistory: true` 会在预检 400 | **首次教学于本篇** |
| **对外运行的校验顺序与 7 条文案** | `Missing API key`(401) → `Invalid API key`(401，含已撤销) → appId 不符时区分「应用不存在 404 `App not found`」/「存在但非本 key 401」 → `App is not published`(400) → 预检 400。4xx 全为普通 JSON（先校验后开流）。管理侧 3 条：`API key name is too long` / `API key name already exists` / `API key not found`（撤销 204） | **首次教学于本篇** |
| **API Key 表的两端映射** | Prisma 拥有 DDL（`20261023115759_add_api_keys`），SQLAlchemy 只映射；`randomBytes` ↔ `secrets.token_hex`、`createHash(sha256)` ↔ `hashlib.sha256`、`findUnique(keyHash)` ↔ `where key_hash ==`、`toISOString()` ↔ `iso_z()`、`onDelete: Cascade` ↔ `passive_deletes=True`、`uuid()` ↔ `uuid4()`；写入 `last_used_at` / `revoked_at` 用 naive-UTC。**缺失 `name` 统一报 `{field} is required`，两端一致**（Py 曾为 `name must be a string`，已修复）；「非本人应用 + 名字过长」两端都先校验归属、返 404 | **首次教学于本篇** |

> 本阶段后续篇目首次教学、本篇仅引用：对外运行的前端调试面板、发布按钮与「已发布 / 草稿」状态展示等属本阶段 UI 篇目。
>
> 已在前序篇教学、本篇仅引用不重讲：OpenAPI `paths` / `$ref` / `enum` / `additionalProperties` 见 `00-项目初始化/04`；`securityScheme` 与错误信封见 `01-账号与认证/01`；Prisma 迁移与关系见 `01-账号与认证/02`、`02-应用管理/02`；SQLAlchemy 映射与迁移所有权见 `01-账号与认证/04`、`02-应用管理/04`；JSONB 与「两态」列级建模见 `03-画布/02`；`{items}` / 201 / 204 / 404 惯例见 `02-应用管理/01`；`iso_z` 见 `02-应用管理/07`；SSE 帧与「先校验、后开流」见 `04-执行引擎/01`、`04-执行引擎/05`；`JwtAuthGuard` / `@CurrentUser` / `ValidationPipe` 见 `01-账号与认证/03`；Pydantic v2 / `field_serializer` 见 `00-项目初始化/06`、`01-账号与认证/05`；会话归属与三层校验见 `09-会话与记忆/01`。
