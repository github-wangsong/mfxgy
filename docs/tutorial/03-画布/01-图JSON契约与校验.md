# 01 · 图 JSON 契约与校验

> 所属：阶段 3 · 画布
> 本篇覆盖：把「画布」这一**数据模型**升格为契约的一等公民——在唯一真源 `packages/contract/openapi.yaml` 里新增 `NodePosition` / `GraphNode` / `GraphEdge` / `Graph` / `PublishGraphResponse` 五个 schema，与 `/apps/{id}/graph`（GET / PUT）、`/apps/{id}/graph/publish`（POST）、`/apps/{id}/graph/published`（GET）四个接口 → 同步 `src/index.ts` 的 TS 类型 → 在 `packages/contract/error-messages.md` 里补一节「图校验错误（400）」的文案规则 → 契约升到 **`0.3.0`** 并编译出 `dist`
> **本篇首次教学：① 把「数据模型」当作契约的一等公民（为什么图要用 schema 显式描述，而不是直接传任意 JSON）；② `GraphNode.data` 用 `additionalProperties: true` 的取舍（唯一放开的字段）；③「恰好一个 start」这类业务规则属于契约之外的应用层校验（为什么 OpenAPI 表达不了、要用纯函数两端各实现）；④ 校验规则的 7 条与文案表、多条错误用 `"; "` 连接；⑤ `null` 语义——草稿为 `null` 时 `GET` 返回合法空图**
> （OpenAPI 规范 / `paths` / `components` / `$ref` / `additionalProperties` / `enum` / `format` 见 `00-项目初始化/04-契约包与TypeScript类型.md`；错误信封、`securityScheme` 见 `01-账号与认证/01-契约扩展.md`；REST 资源化、路径参数 `{id}`、404 惯例见 `02-应用管理/01-契约扩展.md`，本篇只引用不重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 0. 阶段 3 的立论：图 = 数据

在进入正题前，先把阶段 3 的总纲立住，后文所有细节都从这里生长出来：

> **图 = 数据。** 画布不是「一堆前端对象的运行态」，而是一段可以**存下来的 JSON**——也就是 `Graph`。
> 后端只负责**存取**与**校验**：草稿存进数据库、读取时给回、保存/发布时校验一遍。
> 真正把这些 JSON **编译成可执行的图**（把节点变成算子、把边变成数据流）是**阶段 4 执行引擎**的事。

由此引出**两态（草稿 vs 发布）**：

| 态 | 对应字段（本篇之后 02 篇会加列） | 用途 |
| --- | --- | --- |
| **草稿** `graphJson` | 可反复 `PUT` 覆盖 | 编辑中的画布 |
| **发布快照** `publishedGraphJson` | `publish` 时**拷贝**一份冻结 | 线上正在跑的版本，编辑草稿不影响它 |

本篇负责「契约侧」（图长什么样、接口长什么样、校验规则是什么），`02-Prisma-JSONB与两态.md` 负责「存储侧」（这两态怎么落成数据库列）。

---

## 1. 本篇目标

- 用**显式 schema**把「一份图」的结构钉进契约：节点、边、坐标、版本号各是什么形状。
- 定义四个接口：读草稿、存草稿、发布、读已发布——把「图 = 数据」的**存取 + 校验**流程在契约里表达清楚。
- 把「恰好一个 start」「边不能不自环」这类**语义规则**放到契约之外的**应用层纯函数**里，并把错误文案固化成唯一真源。
- 把契约升级到 **`0.3.0`** 并编译成 NestJS / FastAPI / 前端能直接消费的 TS 类型产物。

**验收标准**

1. `pnpm run build:contract` 成功，产出 `packages/contract/dist/index.js` 与 `index.d.ts`。
2. `openapi.yaml` 里能看到 `NodePosition` / `GraphNode` / `GraphEdge` / `Graph` / `PublishGraphResponse` 五个 schema，以及 `GET|PUT /apps/{id}/graph`、`POST /apps/{id}/graph/publish`、`GET /apps/{id}/graph/published` 四个 operation。
3. `src/index.ts` 的 `CONTRACT_VERSION` 为 **`0.3.0`**，且新增类型与 `openapi.yaml` 的 schema **逐字段一致**。
4. `error-messages.md` 里有「图校验错误（HTTP 400）」一节，含 7 条规则与文案、组装细则、`"; "` 连接约定。

**接口清单（契约中的定义）**

| 方法 / 路径 | operationId | 成功 | 失败 |
| --- | --- | --- | --- |
| `GET /apps/{id}/graph` | `getGraph` | `200` → `Graph`（草稿；为 `null` 时返回空图） | `401`（未认证）、`404`（应用不存在或非本人） |
| `PUT /apps/{id}/graph` | `saveGraph` | `200` → `Graph`（保存后的草稿） | `400`（结构或校验失败）、`401`、`404` |
| `POST /apps/{id}/graph/publish` | `publishGraph` | `200` → `PublishGraphResponse` | `400`（校验当前**草稿**不通过）、`401`、`404` |
| `GET /apps/{id}/graph/published` | `getPublishedGraph` | `200` → `Graph`（已发布快照） | `401`、`404`（从未发布） |

---

## 2. 前置条件

- 阶段 2 全部完成：`/apps`、`/apps/{id}` 五个接口与 `AppResponse` 都已在契约里（见 `02-应用管理/01-契约扩展.md`），`apps` 表已由 Prisma 建好。
- 阶段 0 · 04（`packages/contract` 契约包）已完成：`openapi.yaml`、`src/index.ts`、`tsconfig.json`、`build` 脚本都在、能编译。
- `pnpm install` 已执行过。

> 本篇**只改契约**（`openapi.yaml` / `src/index.ts` / `error-messages.md`），不动任何后端源码与数据库。后端实现见后续篇（NestJS / FastAPI 各自的图模块），数据库列见 `02-Prisma-JSONB与两态.md`。

---

## 3. 先看清要做什么

阶段 1、2 的契约里，每个 schema 的字段都是**标量**（`string` / `integer` / `enum`…），而且几乎都来自数据库的某一列。阶段 3 第一次要描述一个**复合的、嵌套的**数据结构——「一张图」：

```
packages/contract/
   ├── openapi.yaml        ← 追加 5 个 schema + 4 个接口（图校验不在此，在应用层）  （本篇 §5）
   ├── src/index.ts        ← 同步追加对应的 TS 类型                              （本篇 §6）
   └── error-messages.md   ← 追加「图校验错误（400）」一节：7 条规则与文案        （本篇 §7）
        ↓ pnpm run build:contract
      dist/index.js + dist/index.d.ts   ← NestJS / FastAPI / 前端统一消费             （本篇 §13）
```

一张图的内部结构（也是后面所有接口的请求 / 响应体）：

```
Graph
 ├─ version: "1"                 ← 图结构版本，将来若改结构可升版本
 ├─ nodes: [ GraphNode ]         ← 节点数组
 │    ├─ id: string
 │    ├─ type: start | end | llm
 │    ├─ position: { x, y }      ← 画布坐标
 │    └─ data: { ...自由... }     ← 每种节点各不相同的配置（唯一放开结构的字段）
 └─ edges: [ GraphEdge ]         ← 连线数组
      ├─ id: string
      ├─ source: string          ← 起点节点 id
      ├─ target: string          ← 终点节点 id
      ├─ sourceHandle?: string | null
      └─ targetHandle?: string | null
```

四个接口的语义：

```
GET    /apps/{id}/graph            带上令牌 → 返回「当前草稿图」（从没存过 → 返回空图）
PUT    /apps/{id}/graph            给一整份 Graph → 校验通过后存为草稿，返回存后的草稿
POST   /apps/{id}/graph/publish    不带图 → 校验「当前草稿」，通过则快照为已发布，返回 publishedAt + 快照
GET    /apps/{id}/graph/published  带上令牌 → 返回「已发布快照」（从没发布过 → 404）
```

**关键点**：后端在这四个接口里**不执行业务、不编译图**——它只做两件事：**存取**（把 JSON 放进去 / 取出来）与**校验**（保存 / 发布时判合法）。「把图跑起来」是阶段 4 的事。这就是「图 = 数据」。

---

## 4. 命令清单（逐条说明）

> 以下命令**全部在仓库根目录** `d:\user\my_project\github\mini-dify` 执行。

| 命令 | 在哪执行 | 目的 | 预期输出 |
| --- | --- | --- | --- |
| `pnpm run build:contract` | 仓库根 | 把 `src/index.ts` 编译成 `dist`（`index.js` + `index.d.ts`），供 NestJS / FastAPI / 前端消费 | 无报错，`packages/contract/dist/` 出现两个文件 |
| `pnpm --filter @mini-dify/api-ts build` | 仓库根 | 顺带验证 NestJS 能读到新类型（可选） | 编译通过 |

> `build:contract` 的定义是 `pnpm --filter @mini-dify/contract build`（见根 `package.json`），最终执行 `tsc -p tsconfig.json`。与阶段 0 · 04 是同一条命令，此处只是「契约变了要重编」。

---

## 5. 完整代码：契约（openapi.yaml）

**完整文件路径：`packages/contract/openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: mini-dify API
  version: 0.3.0
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
          description: 节点各自的配置（自由结构，由各节点类型自行约定）
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
```

**本阶段新增的部分（与阶段 2 相比）**

| 新增 | 类型 | 说明 |
| --- | --- | --- |
| `paths./apps/{id}/graph`（`get` + `put`）、`paths./apps/{id}/graph/publish`（`post`）、`paths./apps/{id}/graph/published`（`get`） | path item | 四个 operation（见 §1 表） |
| `NodePosition` | schema | 节点坐标 `{x, y}` |
| `GraphNode` | schema | 节点 `{id, type, position, data}`；`data` **唯一**放开结构 |
| `GraphEdge` | schema | 连线 `{id, source, target, sourceHandle?, targetHandle?}` |
| `Graph` | schema | 一张图 `{version, nodes[], edges[]}`；草稿与已发布**共用同一结构** |
| `PublishGraphResponse` | schema | `{publishedAt, graph}` |
| `info.version` → `0.3.0` | — | 契约版本与 `CONTRACT_VERSION` 同步递增 |

**读法要点**（只补本阶段特有的几点）：

- **`Graph` 的 `version` 是「图结构版本」**，不是契约版本——当前固定 `"1"`；将来图结构大改（如节点字段变动）时可升，用于兼容旧数据。它是图校验规则 1 的判据（必须是 `"1"`）。
- **`Graph` 被两处复用**：`GET/PUT .../graph`、`GET .../graph/published` 的响应与 body 都是同一份 `Graph`——**草稿与已发布在结构上完全一致**，区别只在「存在哪一列」（见 02 篇）。这正是「两态共用一套模型」的体现。
- **`GraphNode.type` 用 `enum`**（`start` / `end` / `llm`）；而 `data` 是**自由的 JSON 对象**（见 §9）。两者的对比恰好演示了「结构约束到什么程度」的取舍。
- **`PUT` 的 `requestBody` 直接就是 `Graph`**：请求体即一份图，不做 `CreateGraphRequest` 之类的包装——因为「保存草稿」就是「把这份图存下来」，无需额外字段。
- **`publish` 没有 `requestBody`**：发布的是**当前草稿**，不是客户端现传的图——所以 `POST .../publish` 只有响应、没有 body。

---

## 6. 完整代码：TS 类型（src/index.ts）

契约的 YAML 是**给人类和工具看**的；TS 侧还需要一份**与它逐字段对应**的类型文件，才能让 NestJS 编译期拿到类型。

**完整文件路径：`packages/contract/src/index.ts`**

```ts
/**
 * 契约 TS 类型（由 openapi.yaml 派生）。
 *
 * 唯一真源是同仓库根目录下的 `packages/contract/openapi.yaml`；此文件保持与其逐字段一致。
 * 两套后端（NestJS / FastAPI）都必须返回符合本结构的数据。
 */

/** 契约版本；修改契约时递增，并与 openapi.yaml 的 info.version 保持同步。 */
export const CONTRACT_VERSION = '0.3.0'

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
```

**本阶段新增的类型**

| 类型 | 关键点 |
| --- | --- |
| `NodePosition` | `x: number` / `y: number`——对应 YAML `type: number`（TS 的 `number` 对应 OpenAPI 的 `number`，非 `integer`） |
| `GraphNode` | `type: 'start' \| 'end' \| 'llm'`（对应 `enum`）；`position: NodePosition`（`$ref` → 嵌套 interface）；`data: Record<string, unknown>`（**自由的键值对**，见 §9） |
| `GraphEdge` | `source` / `target` 必填；`sourceHandle?` / `targetHandle?` 可选且**可为 `null`**——对应 YAML 的 `type: ["string","null"]` 且不在 `required` |
| `Graph` | `version: string`（注意：**`string` 而非字面量 `'1'`**——契约只要求 `type: string`，值必须为 `"1"` 是**语义校验**的事，见 §10）；`nodes: GraphNode[]` / `edges: GraphEdge[]` |
| `PublishGraphResponse` | `publishedAt: string` + `graph: Graph` |
| `CONTRACT_VERSION` | 由 `'0.2.0'` 改为 `'0.3.0'` |

> **为什么 `GraphNode.data` 用 `Record<string, unknown>` 而不是 `any`**：`Record<string, unknown>` 明确表示「一个键是字符串、值未知的对象」，编译期能防止把 `data` 当数组 / 字符串误用；`any` 会关掉类型检查。对应 YAML 里 `data` 声明为 `type: object` 且 `additionalProperties: true`（见 §9）。

> **手工同步**：`openapi.yaml` 与 `src/index.ts` 是**两份手工维护、必须一致**的文件。改了 YAML 里的 schema，就要同步改这里的 interface，并递增 `CONTRACT_VERSION`。

---

## 7. 完整代码：错误文案目录（error-messages.md）

阶段 2 引入了「用契约把两套框架的校验方言归一」的唯一真源 `error-messages.md`（见 `02-应用管理/07-验收.md`）。本阶段给它追加**第 3 节：图校验错误**——因为图校验是**应用层**的（契约表达不了，见 §10），它的文案也必须有一个唯一真源，否则两端又会各说各话。

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
````

**本阶段新增的部分**：`## 3. 图校验错误（HTTP 400）` 整节，以及 §2 域错误表里与图相关的新行——「应用画布从未发布过」`Graph not published`（`App not found` 等属阶段 2 已有，此处不重复列举）。

---

## 8. 【技术教学 · 首次】把「数据模型」当作契约的一等公民

### 8.1 问题：为什么不直接把图当「任意 JSON」传？

「图」这个东西，最省事的契约写法是：

```yaml
# 反面写法：图是一个黑盒
Graph:
  type: object
  additionalProperties: true      # ← 随便什么形状都接受
```

这样契约只说了「图是个对象」，里面有什么完全不管。**为什么本项目不这么写？** 因为契约要承担三件事，黑盒写法一件都做不好：

| 契约的职责 | 显式 schema | 黑盒（`type: object`） |
| --- | --- | --- |
| 让两端对「一份图长什么样」达成一致 | 字段名 / 层级 / 必填 / 类型全钉死 | 无从约束，两端可返回任意形状 |
| 让契约测试**机器校验** | 可断言 `version` 是字符串、`nodes` 是数组… | 只能断言「是个对象」，等于没测 |
| 给下游（前端渲染、阶段 4 引擎编译）稳定输入 | 前端可假定 `node.type`、`node.position` 必存在 | 每处使用都得「防御性地猜字段」 |

### 8.2 关键转变：字段从「标量列」变成「复合文档」

阶段 0–2 的每个 schema，字段几乎都是**标量**（`string` / `integer` / `enum`），且多半对应数据库的一列。阶段 3 的 `Graph` 第一次是**复合结构**：

```
Graph（对象）
  ├─ nodes: 数组，元素是对象（GraphNode）
  │     └─ position: 再嵌一层对象（NodePosition）
  └─ edges: 数组，元素是对象（GraphEdge）
```

用 `$ref` 把「对象套数组套对象」拆成一块块命名的 schema，好处是**可复用、可嵌套、可读**：`NodePosition` 被 `GraphNode` 引用一次，`Graph` 被四个接口的响应 / 请求体共引用——一处定义，多处复用（`$ref` 机制见 `00-项目初始化/04-契约包与TypeScript类型.md`）。

### 8.3 结论

> **当「一段数据」本身就是系统的核心资产时（这里是画布），它应当作为契约的一等公民，用显式 schema 描述清楚——而不是塞进一个 `type: object` 的黑盒。** 契约的约束力只到「你描述到的那一层」；描述得越具体，两端与下游的自由度越小、一致性越强。

---

## 9. 【技术教学 · 首次】`GraphNode.data` 用 `additionalProperties: true` 的取舍

### 9.1 全局规矩：一律 `additionalProperties: false`

本项目从阶段 0 起就定了一条规矩：**所有 schema 都写 `additionalProperties: false`**——多一个契约没声明的字段就报错（`{field} should not exist`，见 `error-messages.md` §1.1）。它让「契约之外的字段」无处藏身，两端无法偷偷加字段。

### 9.2 唯一例外：`GraphNode.data`

```yaml
    GraphNode:
      type: object
      additionalProperties: false          # ← 节点顶层，仍然锁死
      required: [id, type, position, data]
      properties:
        data:
          type: object
          description: 节点各自的配置（自由结构，由各节点类型自行约定）
          additionalProperties: true       # ← 只在这一层放开
```

**整个契约里，`data` 是唯一 `additionalProperties: true` 的字段。**

### 9.3 为什么这里要放开

因为节点配置**天然是「每种节点各不相同」的自由结构**：

- `start` 节点的 `data` 可能是空对象或带一个起点标记；
- `llm` 节点的 `data` 带 `model` / `prompt` / `temperature` 等他自己的配置；
- 将来新增节点类型（条件分支、工具调用…）又会带各自的一套配置。

若把 `data` 也锁死成固定字段，就意味着**每新增一种节点配置，都要改一次契约**——而节点类型会随阶段不断膨胀。**放开 `data`**，等于说：「`data` 是**开放式扩展点**，它内部的结构由**各节点类型自己**约定，契约**不再背书**」

### 9.4 什么时候该放开、什么时候不该

| 该放开（`additionalProperties: true`） | 不该放开（保持 `false`） |
| --- | --- |
| 字段是**开放式扩展点**，其形状由「别人」决定（如这里的节点类型） | 字段形状**由契约统一决定**（如 `id` / `type` / `position`） |
| 锁死它只会让契约**频繁变更** | 锁死后能**稳定地**约束两端行为 |
| 必要时（如这里 `data` 的用途：节点各自配置） | 大多数业务字段 |

**代价与边界**：

- 代价：`data` 内部**不受契约保护**——契约测试校验不到 `data` 里的字段。所以两端仍必须在**语义层**保证它是一个**可序列化的 JSON 对象**；`data` 各字段的真正约定，由阶段 4 起的**「节点定义」**去负责，而不是契约。
- 边界：**放开只到 `data` 这一层，不外溢**。`GraphNode` 自己的顶层字段（`id` / `type` / `position` / `data`）依然 `additionalProperties: false` 且全部 `required`。也就是说，「口袋」里面随便装，但「口袋」这四根拉链必须齐全、且不多不少。

> 口诀：**结构约束到「我们知道形状的那一层」为止；不知道形状的那一层（这里是节点配置）就明确放开，并把它交给一个更懂它的角色（节点定义）去管。**

---

## 10. 【技术教学 · 首次】业务规则属于契约之外的应用层校验（「恰好一个 start」）

### 10.1 OpenAPI 能表达什么、表达不了什么

OpenAPI（底层是 JSON Schema）擅长表达**单元素 / 单文档的结构约束**：

- 类型（`type`）、必填（`required`）、长度（`minLength` / `maxLength`）、取值（`enum`）、格式（`format`）、数组元素形状（`items`）……

但它**表达不了跨元素的计数 / 关系约束**，例如：

| 业务规则 | 为什么 Schema 表达不了 |
| --- | --- |
| `nodes` 里 `type === "start"` 的**恰好一个** | 这是「数一数数组里满足条件的元素有几个」，JSON Schema 没有原生的「计数」能力 |
| 边的 `source` / `target` 必须**指向存在的节点 id** | 这是「一个字段的值必须出现在另一个数组的元素里」——文档内部的一致性 |
| 边的 `source !== target` | 这是「同一对象内两个字段不相等」的跨字段约束 |

（理论上硬凑也能写，但会极度晦涩、且很多工具链不支持——得不偿失。）

### 10.2 解决：结构归契约，语义归纯函数

于是本项目把校验拆成两层，分工明确：

```
请求进来
  ├─ ① 结构校验：请求体是不是一份合法 Graph？
  │      （type / required / enum / 数组元素形状……）  ← 交给契约 + 框架（NestJS DTO / Pydantic）
  └─ ② 语义校验：这份图内部自洽吗？
         （恰好一个 start / 边不悬空 / 无自环……）   ← 交给纯函数 validateGraph(graph)
         只有 PUT / publish 才做这一层
```

`validateGraph` 是一段**纯函数**：

- **纯** = 不碰数据库、不碰框架、不依赖请求上下文；输入一份 `Graph`，输出「错误文案列表」。
- **两端各实现一份、但逻辑等价**：TS 侧 `apps/api-ts/src/graph/graph.validator.ts`，Py 侧 `apps/api-py/app/graph/validator.py`。契约（`error-messages.md` §3）用**唯一真源**钉住两端必须产出**逐字节相同**的 `message`。

### 10.3 为什么「纯函数 + 两端各写一份」是好选择

| 好处 | 说明 |
| --- | --- |
| **可测试** | 纯函数不依赖环境，喂一份图进去就能断言输出，不需要起服务、连数据库 |
| **可复用** | 阶段 4 的执行引擎在**编译图之前**可以复用同一套规则，避免「能存的图却跑不起来」 |
| **两端好对齐** | 规则与文案都写死在文档里，两端照着写，验收时对比响应体即可 |

> 一句话：**契约（OpenAPI）管「形状对不对」，应用层纯函数管「业务上合不合法」。** 不是所有规则都能塞进 Schema——塞不进去的，就用一段可测、可复用、两端一致的纯逻辑来管。

---

## 11. 【技术教学 · 首次】校验规则的 7 条、文案表与 `"; "` 连接

### 11.1 7 条规则（顺序即优先级）

`validateGraph` 按**固定顺序**跑 7 条规则（完整表见 §7 的 `error-messages.md` §3）：

| 序 | 规则 | 触发条件 | 文案模板 |
| --- | --- | --- | --- |
| 1 | version | `version !== "1"` | `graph version must be 1` |
| 2 | 节点 id 唯一 | 有重复节点 id | `node id must be unique: {id}` |
| 3 | 恰好一个 start | `start` 节点数 ≠ 1 | `graph must contain exactly one start node` |
| 4 | 至少一个 end | `end` 节点数 0 | `graph must contain at least one end node` |
| 5 | 边 id 唯一 | 有重复边 id | `edge id must be unique: {id}` |
| 6 | 边端点存在 | 边指向不存在的节点 | `edge {edgeId} references unknown node: {nodeId}` |
| 7 | 禁止自环 | `source === target` | `edge {edgeId} must not connect a node to itself` |

**顺序为什么重要**：`validateGraph` 是「先扫完规则 1，再扫规则 2…」，这样**同一份非法图，两端产出的错误顺序必然一致**。若各扫各的、顺序随机，两端 `message` 就无法逐字节相同——契约测试会红。规则 2 / 5 还规定「每个重复 id 只报一次」（首次检测到就报），规则 6 规定「先查 `source` 再查 `target`」，都是为了**消除歧义、锁定唯一输出**。

### 11.2 多条错误如何组装成一条 `message`

错误信封的 `message` 是**单个字符串**（见 `01-账号与认证/01-契约扩展.md` 的错误信封）。多条错误用 `"; "`（分号 + 空格）连接：

```
"graph version must be 1; graph must contain exactly one start node"
    └── 规则 1 的错误 ──┘ └── 规则 3 的错误 ─────────────────────┘
```

- **为什么用 `"; "` 而不是数组**：错误信封的形状（`{statusCode, message, error}`）是阶段 1 定死的，`message` 必须是一个字符串；用 `"; "` 拼接既保持了形状，又能塞进多条信息。
- **为什么和 §1.2 用同一个分隔符**：请求校验错误（§1.2）也用 `"; "`。**全项目统一一个分隔符**，客户端就只学一种解析规则，不用区分「这是结构错误还是图错误」。
- **顺序确定性**：由于规则顺序固定、规则内按数组顺序，同一条错误串**在任何一端、任何一次运行**都完全相同（可逐字节比对）。

### 11.3 例

```json
// version 是 "2" 且没有 start 节点
{"statusCode":400,"message":"graph version must be 1; graph must contain exactly one start node","error":"Bad Request"}
```

---

## 12. 【技术教学 · 首次】`null` 语义：草稿为 `null` 时 `GET` 返回空图

### 12.1 存储层的 `null` vs 接口层的「空图」

数据库里，**没编辑过**的应用，草稿列是 `NULL`（见 02 篇）。但**接口**不能让客户端拿到 `null`——`GET /apps/{id}/graph` 必须返回一份**可渲染的图**。于是规定：

```
存储层：graph_json IS NULL          （从未编辑）
              │
              │ GET（读取时不校验）
              ▼
接口层：{"version":"1","nodes":[],"edges":[]}   （合法空图）
```

**为什么返回空图而不是 404 / null**：

- `GET .../graph` 是**读取草稿**。该应用**存在且属于你**（否则前面就 404 了），所以「读取」这件事应**永远成功**——不该因为「还没存过内容」而失败。
- 前端打开画布编辑器时，需要一个**能立刻渲染的初始图**；给 `null` 会逼前端到处判空，给空图则「有节点数组、有边数组，只是都空」，编辑器逻辑统一。
- 空图是**契约里的合法 `Graph`**（`version` 有值、`nodes`/`edges` 是空数组），可直接通过结构校验。

### 12.2 关键区分：「读取」不校验，「保存 / 发布」才校验

空图 `{"version":"1","nodes":[],"edges":[]}` **不通过**校验规则 3（没有 start）和 4（没有 end）——它是**非法**的「可发布图」。但：

| 操作 | 是否校验 | 结论 |
| --- | --- | --- |
| `GET /apps/{id}/graph` | **不校验** | 草稿为空 → 返回空图，**允许**（空图是合法的存储状态 / 读取结果） |
| `PUT /apps/{id}/graph` | **校验** | 传空图进来 → `400`（空图不是合法的**保存输入**） |
| `POST .../publish` | **校验当前草稿** | 草稿为空图 → `400` |

> 所以「空图」这件事有两面：它是**合法的读取结果**，却不是**合法的保存 / 发布输入**。**校验只发生在「写」这一侧（PUT / publish），读（GET）永远放行**——这条「读写对校验的待遇不同」的原则，很多系统都遵循。

### 12.3 与「未发布」的对比

| 接口 | 数据为「空 / 无」时 |
| --- | --- |
| `GET .../graph`（草稿） | 草稿为 `null` → 返回**空图**（有「空」这个概念） |
| `GET .../graph/published`（发布态） | 从未发布 → **404 `Graph not published`**（发布态没有「空」的概念，没发布就是「没有」，走 404 惯例） |

两者待遇不同，是因为**草稿态**天然有「空图」这个可表达的状态，而**发布态**只有「有快照」和「没有快照」两种——「没有」就是资源不存在 → 404。

---

## 13. 编译并验证

**命令（在仓库根执行）**

```bash
pnpm run build:contract
```

**目的**：把 `src/index.ts` 编译成 `dist/index.js`（运行时代码）+ `dist/index.d.ts`（类型声明），供 NestJS / FastAPI / 前端消费新类型。

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

**验证 NestJS 能消费新类型（可选）**

```bash
pnpm --filter @mini-dify/api-ts build
```

若 `apps/api-ts` 里能 `import type { Graph, GraphNode } from '@mini-dify/contract'` 且编译通过，说明契约包被正确链接（机制见 `00-项目初始化/03-monorepo与pnpm-workspace.md`）。

---

## 14. 验收自测

| 检查项 | 命令 / 做法 | 预期 |
| --- | --- | --- |
| 契约可编译 | `pnpm run build:contract` | 无报错 |
| 产物齐全 | `ls packages/contract/dist` | 同时有 `index.js` 与 `index.d.ts` |
| 版本已升 | 看 `openapi.yaml#/info/version` 与 `src/index.ts#CONTRACT_VERSION` | 二者均为 `0.3.0` |
| 五 schema 齐备 | 阅读 `openapi.yaml#/components/schemas` | `NodePosition` / `GraphNode` / `GraphEdge` / `Graph` / `PublishGraphResponse` |
| 四接口齐备 | 阅读 `openapi.yaml#/paths` | `/apps/{id}/graph`(GET/PUT)、`/apps/{id}/graph/publish`(POST)、`/apps/{id}/graph/published`(GET) |
| `data` 是唯一放开字段 | 搜索 `additionalProperties: true`（契约内） | 契约中**只有** `GraphNode.data` 一处为 `true`，其余全为 `false` |
| 顶层仍锁死 | 看 `GraphNode` / `Graph` / `GraphEdge` | 均 `additionalProperties: false`，且 `required` 齐全 |
| `publish` 无请求体 | 看 `post.…/publish` | 只有 `responses`，**无 `requestBody`** |
| 文案唯一真源已补 | 看 `error-messages.md` | 有 `## 3. 图校验错误（HTTP 400）`，7 条规则 + 组装细则 |
| 类型一致 | 人工比对 `openapi.yaml` 与 `src/index.ts` | 字段逐项对应（`data` → `Record<string,unknown>`、`sourceHandle` → `string \| null` 可选） |

**契约测试视角**：对同一份非法图，两侧后端 `PUT .../graph` 应返回**逐字节相同**的 400：

```jsonc
// version 是 "2" 且无 start 节点
{ "statusCode": 400, "message": "graph version must be 1; graph must contain exactly one start node", "error": "Bad Request" }
```

---

## 15. 常见坑

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 把 `Graph` 写成 `type: object` 黑盒 | 契约测试无从校验、前端拿到的图结构不可预期 | 图是一等公民，必须用显式 schema + `$ref` 描述到「我们知道形状的那一层」（§8） |
| `data` 也锁死 `additionalProperties: false` | 每新增一种节点类型就得改契约 | `data` 是**唯一放开的字段**，用 `additionalProperties: true`；放开只到这一层，节点顶层仍 `false`（§9） |
| 试图用 Schema 表达「恰好一个 start」 | 写不出 / 工具不支持、校验不生效 | 计数、跨元素关系这类规则**表达不了**，交给应用层纯函数 `validateGraph`（§10） |
| 两端 `validateGraph` 校验顺序不同 | 同图两端 `message` 不一致、契约测试红 | 规则顺序、重复 id 只报一次、先 source 后 target——全部写在 `error-messages.md` §3，两端照做（§11） |
| 多条错误用数组或换行拼接 | 与错误信封形状冲突 / 两端不一致 | `message` 是字符串，多条用 `"; "` 连接，与请求校验错误同分隔符（§11.2） |
| `GET .../graph` 对「没存过」返回 404 或 `null` | 前端得反复判空、编辑器无法渲染 | 草稿为 `null` 时返回**合法空图** `{"version":"1","nodes":[],"edges":[]}`；读取不校验（§12） |
| 以为 `GET` 也校验、把空图判为非法 | 新应用一打开画布就报 400 | 只有 `PUT` / `publish` 校验；`GET` 永远放行（§12.2） |
| `Graph.version` 在 TS 里写成字面量 `'1'` | 与 YAML `type: string` 不符 | 契约只约束「是字符串」；「必须为 `"1"`」是**语义校验**（纯函数）的事，TS 用 `string`（§6） |
| `publish` 也假设有请求体 | 前端传图却被忽略 / 校验对象搞错 | 发布的是**当前草稿**，`POST .../publish` **无 `requestBody`**；校验对象是库里已有的草稿 |
| 只改 YAML 忘了改 TS / 忘了递增版本 | 后端拿不到新类型 / 版本对不上 | 三份文件（`openapi.yaml`、`src/index.ts`、`error-messages.md`）手工同步，版本升到 `0.3.0` |
| 忘了重编译契约 | 后端编译用的还是旧 `dist` | 契约改完必须 `pnpm run build:contract`（`dev:api-ts` / `build:api-ts` 已自动包含此步） |

---

## 16. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| 把「数据模型」当作契约的一等公民（复合/嵌套数据用显式 schema + `$ref` 描述，而非 `type: object` 黑盒） | **首次教学于本篇** |
| `additionalProperties: true` 的取舍：`GraphNode.data` 为唯一放开字段（开放式扩展点的形状由「谁」决定 → 放开；结构约束到知道形状的那一层为止） | **首次教学于本篇** |
| 业务规则属于契约之外的应用层校验：「恰好一个 start」/ 边不悬空等 JSON Schema 表达不了 → 纯函数 `validateGraph` 两端各实现一份、逻辑等价 | **首次教学于本篇** |
| 图校验 7 条规则与文案表（`error-messages.md` §3）；多条错误用 `"; "` 连接的组装细则（顺序确定、重复 id 只报一次） | **首次教学于本篇** |
| `null` 语义：草稿为 `null` 时 `GET` 返回合法空图；空图不是合法保存输入；读取不校验 / 写入才校验 | **首次教学于本篇** |

> 已在前序篇教学、本篇仅引用不重讲的：OpenAPI 规范（`paths` / `components` / `$ref` / `additionalProperties` / `enum` / `format`）见 `00-项目初始化/04-契约包与TypeScript类型.md`；错误信封 / `securityScheme`（HTTP Bearer JWT）见 `01-账号与认证/01-契约扩展.md`；REST 资源化、路径参数 `{id}`、404 而非 403 见 `02-应用管理/01-契约扩展.md`；错误文案目录（唯一真源）见 `02-应用管理/07-验收.md`。
