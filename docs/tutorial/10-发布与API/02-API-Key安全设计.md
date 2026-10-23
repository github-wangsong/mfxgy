# 02 · API Key 安全设计

> 所属：阶段 10 · 发布与 API
> 本篇覆盖：把「一把 API Key 从生成、落库、认证、撤销到轮换」的**安全设计**讲透。重点不是接口怎么调，而是**为什么这么设计**：为什么密码用 bcrypt、API Key 却用 SHA-256；为什么明文只返回一次；为什么 `prefix` 可以展示；为什么撤销不删行；为什么「key 不属于这个应用」要返回 `401` 而不是 `403`；为什么哈希查找不怕定时攻击；`lastUsedAt` 的代价是什么；限流为什么本阶段不做；拖库与明文传输分别会怎样。
> **本篇首次教学：API Key 凭证模型（机器生成的高熵长期凭证）· 快哈希与慢哈希的分工（SHA-256 vs bcrypt）与「攻击模型决定哈希选择」· 128 位随机与 `sk-` + 32 位十六进制格式 · 明文只返回一次的服务端设计（哈希不可恢复）· `prefix`（可识别前缀）及其泄露边界 · 哈希索引查找与定时攻击 · `lastUsedAt` 与写放大 · **软撤销的安全论证**（审计 / 恢复 / 轮换）与 key 轮换 · 凭证认证中的 401/404 信息泄露控制 · 存储面 / 传输面威胁模型 · 限流缺失的边界**
> **已教学、只引用**：密码哈希、盐、bcrypt、JWT 见 `01-账号与认证/06-JWT与密码哈希.md`；404 与资源归属见 `02-应用管理/01-契约扩展.md`、`02-应用管理/03-NestJS应用模块.md`；错误文案目录见 `02-应用管理/07-验收.md`；SSE 帧与 `EventSource` 限制见 `04-执行引擎/01-运行契约与SSE事件协议.md`、`04-执行引擎/06-前端SSE客户端与运行面板.md`；发布快照语义与 API Key 契约见本阶段 `01-发布语义与API-Key契约.md`；对外 SSE 接口的双后端对齐见本阶段 `03-对外SSE接口与双后端对齐.md`；一次性密钥的 UI 表现见本阶段 `04-前端发布面板与调用示例.md`——以上**直接使用、不重讲**。

---

## 1. 本篇目标

做完这一篇，你能：

- 用**攻击模型**（而不是「哪个更重要」）解释：为什么人选的密码要 bcrypt，机器生成的 API Key 用 SHA-256 就够了。
- 说清**明文只在创建响应里出现一次**的技术原因：库里只有哈希，**不是「不想给你看」，而是「技术上取不回」**。
- 说清 `prefix`（明文前 11 个字符）的用途、它泄露了多少信息、以及为什么它**不能**被用来认证或探测 key 是否存在。
- 说清**撤销（`revokedAt`）与物理删除**的差别：审计、历史、轮换、误操作恢复，各自付出什么代价。
- 逐条说清**认证顺序**：无 key、key 无效、key 已撤销、key 属于 A 调 B、应用不存在、应用未发布，分别返回什么；以及 **401 / 404 的选择本身就是信息泄露控制**。
- 说清**哈希索引查找**（一次定位）与**遍历比对**（O(n)）的差别，以及**定时攻击**为什么在这里不成立（但另一种「成功鉴权更慢」的旁路仍需注意）。
- 说清 `lastUsedAt` 的用途与**写放大**副作用，并给出生产环境的替代方案。
- 说清**限流为什么本阶段没做**，以及生产要按 key / IP / 应用分别做什么。
- 说清 **key 轮换**的标准步骤：为什么不能直接删旧的、为什么重叠期要用新名字、`lastUsedAt` 如何帮助判断「旧 key 是否还在被调用」。
- 说清**拖库**与**明文传输**两个威胁面：攻击者拿到哈希能做什么、不能做什么；为什么必须 HTTPS。

**验收标准（对齐总纲 §6 阶段 10 与 `error-messages.md` §10）**

| # | 检查 | 预期 |
| --- | --- | --- |
| C1 | key 格式 | `sk-` + 32 位十六进制，共 **35 字符**；`prefix` 为前 **11** 字符（`sk-` + 8 位十六进制） |
| C2 | 落库内容 | `api_keys` 表**只有** `key_hash`（64 位十六进制）与 `key_prefix`，**没有**明文列 |
| C3 | 跨语言摘要 | 同一把 key 在 Node 与 Python 得到的 SHA-256 **逐字符相同** |
| C4 | 一次性明文 | 只有 `POST /apps/{id}/api-keys` 的 **201** 响应带 `key`；列表 / 详情 / 数据库都没有 |
| C5 | 认证顺序 | 无 key `401 Missing API key`；无效 / 已撤销 / 不属于该应用 `401 Invalid API key`；应用不存在 `404 App not found`；未发布 `400 App is not published` |
| C6 | `lastUsedAt` | 鉴权成功即刷新；撤销后再调用不刷新；**应用不匹配 / 未发布**时也会刷新（详见 §6.6） |
| C7 | 两端文案 | **9 组**错误场景逐字节一致（其中 3 组共用 `Invalid API key`；三条名称校验——缺失 / 空串 / 非字符串——与「非归属 + 超长」的边界见 §13.3） |
| C8 | 软撤销 | 撤销后行仍在、`revoked_at` 非空、列表仍返回；再调用立即 `401` |

---

## 2. 前置条件

| 前置 | 状态要求 | 出处 |
| --- | --- | --- |
| DB 容器 | `mini-dify-db` 为 `healthy` | `00-项目初始化/02-本地中间件Docker.md` |
| 契约 | `CONTRACT_VERSION = 0.10.0`；`ApiKeyResponse` / `CreateApiKeyResponse` / `apiKeyAuth` | 本阶段 `01` |
| 迁移 | `20261023115759_add_api_keys` 已应用（`api_keys` 表） | 本阶段 `01` |
| TS 侧 | `ApiKeysService`、`ApiKeysController`、`PublicController` | 本阶段 `01`、`03` |
| Python 侧 | `app/api_keys/service.py`、`app/api/api_keys.py`、`app/api/public.py` | 本阶段 `01`、`03` |
| 一个已发布的图 | 对外运行只读 `published_graph_json`；未发布会 `400` | 本阶段 `01` |
| 用户与 JWT | 注册 / 登录可用；两端令牌互认 | `01-账号与认证/06`、`07` |

启动两套后端（**各占一个终端**）：

```bash
pnpm dev:api-ts     # NestJS  -> http://localhost:3001
pnpm dev:api-py     # FastAPI -> http://localhost:8000
```

> 后文命令默认在 **Git Bash / WSL / macOS / Linux** 下执行。PowerShell 里把行尾的 `\` 换成反引号 `` ` ``，把 `$VAR` 换成 `$env:VAR`，并把 `curl` 写成 **`curl.exe`**（否则会命中 `Invoke-WebRequest` 别名）。
> 若本机 `python` 不在 PATH（Windows 常见），把 `python -c ...` 换成 `uv run --project apps/api-py python -c ...`（见 `00-项目初始化/01-环境准备.md`）。
> 本文所有 key、哈希、时间都是**本地教学环境**的实测值；任何写进文档的 key 都应当视为**已泄露**，真实环境必须撤销并重建。

---

## 3. 一把 key 的一生：先看事实

安全设计最怕「凭感觉」。先把**可观测的事实**摆出来，再解释为什么。

### 3.1 创建：明文只在这一个响应里

**在哪执行**：仓库根（或任意能访问 3001 的 shell）
**目的**：拿到一把 key，并观察响应里到底有什么。

```bash
# 先登录拿 JWT（阶段 1）
TS_TOKEN=$(curl -s -X POST http://127.0.0.1:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"secret123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 建一个应用（或复用已有应用）
APP_ID=$(curl -s -X POST http://127.0.0.1:3001/apps \
  -H "Authorization: Bearer $TS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"stage10-security","mode":"chatflow"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['id'])")

# 创建 API Key，并把响应存进变量
KEY_JSON=$(curl -s -X POST "http://127.0.0.1:3001/apps/$APP_ID/api-keys" \
  -H "Authorization: Bearer $TS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"demo-key"}')
echo "$KEY_JSON" | python -m json.tool

# 取出后续要用的三个值
KEY=$(echo "$KEY_JSON" | python -c "import sys,json;print(json.load(sys.stdin)['key'])")
KEY_ID=$(echo "$KEY_JSON" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
KEY_PREFIX=$(printf '%s' "$KEY" | cut -c1-11)
```

**预期输出（实测口径，示例值；你新建的 key 会不同）**

```
{
  "id": "<uuid>",
  "appId": "<uuid>",
  "name": "demo-key",
  "prefix": "sk-e217e49c",
  "createdAt": "2026-10-23T13:15:51.827Z",
  "lastUsedAt": null,
  "revokedAt": null,
  "key": "sk-e217e49c78f151618cc8d94a1c6eb7a9"
}
```

> 下面的输出示例来自教学库里已存在的 `demo-key`（`sk-e217e49c…`）；你自己的输出会是 `$KEY_PREFIX` 对应的那一行（哈希、时间都会不同）。也可以按 `id = '$KEY_ID'` 查。

**结果解读**：

- `key` 是 **35 字符**：`sk-`（3）+ 32 位十六进制（16 字节 = 128 位随机）。
- `prefix` 是 `sk-e217e49c`，正好是 `key` 的前 **11** 字符。
- `lastUsedAt` / `revokedAt` 初始为 `null`：从未使用、未撤销。
- **这是 `key` 唯一一次出现在任何响应里**。后面的列表、详情、数据库都不会再有它。

### 3.2 落库：只有哈希，没有明文

**在哪执行**：仓库根
**目的**：证明数据库里**没有**那把明文 key。

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c \
  "select name, key_prefix, length(key_hash) as hash_len, key_hash, last_used_at, revoked_at
   from api_keys where key_prefix = '$KEY_PREFIX'"
```

**预期输出（示例为教学库中的 `demo-key`；你的值会不同）**

```
   name   | key_prefix  | hash_len |                             key_hash                             |      last_used_at       | revoked_at
----------+-------------+----------+------------------------------------------------------------------+-------------------------+------------
 demo-key | sk-e217e49c |       64 | 6fb128f90ab7145b332b42b928fa82139505409b32db178bf2060c6940c51a1e | 2026-10-23 13:16:35.538 |
(1 row)
```

**结果解读**：

- 表里只有 `key_hash`，长度 **64**（SHA-256 的十六进制摘要固定 64 字符）。
- 这串哈希正是 `sha256("sk-e217e49c78f151618cc8d94a1c6eb7a9")`（示例；你的 key 会得到另一个 64 位哈希）；Node 与 Python 算出来**逐字符相同**（见 §12）。
- 表里**没有任何一列**能还原出 `sk-e217e49c78f151618cc8d94a1c6eb7a9`。连数据库管理员也取不回明文。

再看表结构：

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c "\d api_keys"
```

**预期输出（实测，节选）**

```
 Column      | Type                           | Nullable | Default
-------------+--------------------------------+----------+-------------------
 id          | text                           | not null |
 app_id      | text                           | not null |
 owner_id    | text                           | not null |
 name        | text                           | not null |
 key_prefix  | text                           | not null |
 key_hash    | text                           | not null |
 created_at  | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
 last_used_at| timestamp(3) without time zone |          |
 revoked_at  | timestamp(3) without time zone |          |
Indexes:
    "api_keys_pkey" PRIMARY KEY, btree (id)
    "api_keys_app_id_idx" btree (app_id)
    "api_keys_key_hash_key" UNIQUE, btree (key_hash)
```

**结果解读**：

- 没有 `key` / `plaintext` / `secret` 之类的列。
- `api_keys_key_hash_key` 是 **UNIQUE B-tree 索引**：认证时按 `key_hash` **一次定位**，不是遍历全表（§6.3）。
- `key_hash` 的类型是 `text`，长度约束来自 SHA-256 的输出，而不是数据库的 `CHECK`。这不影响安全，但意味着应用层必须保证永远写 64 位摘要。

### 3.3 调用：成功后 `lastUsedAt` 被刷新

**在哪执行**：仓库根
**目的**：观察对外运行与 `lastUsedAt`。**前提**：先按本阶段 `01` 把图发布（`POST /apps/{id}/graph/publish`），否则会得到 `400 App is not published`。

```bash
curl -i -N -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" \
  -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"inputs":{}}'
```

**预期输出（已发布、start 无必填输入时）**

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: run_started
data: {"runId":"...","appId":"..."}

...
event: run_finished
data: {"runId":"...","elapsedMs":...}
```

随后查库：

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c \
  "select name, last_used_at from api_keys where id = '$KEY_ID'"
```

**预期输出（示例为教学库中的 `demo-key`）**

```
   name   |      last_used_at
----------+-------------------------
 demo-key | 2026-10-23 13:16:35.538
```

**结果解读**：`lastUsedAt` 由服务端在**鉴权成功后**写入；它不是前端算的，也不是运行结束时写的。这个「什么时候写」决定了它的语义与代价（§6.6）。

### 3.4 撤销：行还在，但下一次调用立刻 401

```bash
# KEY_ID 已在 §3.1 的创建响应里取出；也可以从列表里按 prefix 认
curl -s "http://127.0.0.1:3001/apps/$APP_ID/api-keys" \
  -H "Authorization: Bearer $TS_TOKEN" | python -m json.tool

# 撤销
curl -i -X DELETE "http://127.0.0.1:3001/api-keys/$KEY_ID" \
  -H "Authorization: Bearer $TS_TOKEN"
```

**预期输出**

```
HTTP/1.1 204 No Content
```

再调用同一个对外接口：

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "http://127.0.0.1:3001/public/apps/$APP_ID/run" \
  -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' -d '{"inputs":{}}'
```

**预期输出**

```
401
```

再查库：

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c \
  "select name, key_prefix, revoked_at from api_keys where id = '$KEY_ID'"
```

**预期输出（你撤销的那把 key；下面是占位示例）**

```
   name   | key_prefix   |      revoked_at
----------+--------------+---------------------
 demo-key | <YOUR_PREFIX> | <REVOKED_AT>
```

> 实测中撤销时间形如 `2026-10-23 13:16:51.694`（来自另一把测试 key `revoke-me`）；你撤销的 key 会显示自己的 `name` / `prefix` / 时间。**行仍然存在**才是重点。

**结果解读**：

- 行**仍然存在**，只是 `revoked_at` 非空 → 软撤销。
- 下一次请求在**鉴权阶段**就被拒绝（`401 Invalid API key`），不会进入执行引擎。
- `lastUsedAt` 停在撤销前的时间：撤销后的失败请求**不会**执行更新语句。

### 3.5 认证顺序的完整分叉

```text
POST /public/apps/{appId}/run
  │
  ├─ 取 key：X-API-Key 优先，其次 Authorization: Bearer
  │    └─ 两者都没有（或都是空白） ──> 401 Missing API key
  │
  ├─ sha256(key) 查 key_hash
  │    ├─ 查不到 ─────────────────────> 401 Invalid API key
  │    └─ 查到但 revoked_at 非空 ────> 401 Invalid API key
  │
  ├─ key.appId 与路径 appId 不同
  │    ├─ 路径 app 不存在 ───────────> 404 App not found
  │    └─ 路径 app 存在 ─────────────> 401 Invalid API key
  │
  ├─ 路径 app 不存在（理论上此分支已很少见）──> 404 App not found
  │
  ├─ app.published_graph_json 为 null ──────> 400 App is not published
  │
  └─ 已发布 ─────────────────────────────────> 200 text/event-stream
```

这张图是**安全设计的核心**：每一步「先查什么、后查什么」都决定了攻击者能观察到什么。§6.5 会逐条解释。

### 3.6 一张表记住状态

| 输入 | 结果 | 对外文案 |
| --- | --- | --- |
| 没有 key | `401` | `Missing API key` |
| key 格式不对 / 不存在 | `401` | `Invalid API key` |
| key 已撤销 | `401` | `Invalid API key` |
| key 属于 A，路径是 B（B 存在） | `401` | `Invalid API key` |
| key 属于 A，路径是 B（B 不存在） | `404` | `App not found` |
| key 正确，应用未发布 | `400` | `App is not published` |
| key 正确，应用已发布 | `200` | SSE 流 |

> **为什么未发布是 `400` 而不是 `404`**：应用**存在**，只是不满足「可对外运行」的前置条件。用 `404` 会把「存在但未上线」误报成「不存在」，也会让调用方误以为 `appId` 写错；`400 + App is not published` 是更准确的诊断。

---

## 4. 最重要的一节：为什么密码用 bcrypt，API Key 用 SHA-256

> 这是本篇最容易记反的知识点。请先记住一句话：**不是「API Key 更重要，所以保护更强」，而是「两种凭证的攻击模型不同，所以用了不同的哈希」。**

### 4.1 先纠正一个直觉

很多人的直觉是：

> 「密码很重要，用 bcrypt；API Key 也很重要，那当然也该用 bcrypt。」

这个直觉的**前半句对、后半句错**。哈希算法的选择不是按「重要性」排序的，而是按**输入的性质**和**攻击者能做什么**决定的。

先统一三个词：**熵（entropy）** = 一个秘密有多少种等可能取值（128 位熵 ≈ 2^128 种可能）；**彩虹表（rainbow table）** = 预先算好的「常见输入 → 哈希」对照表；**撞库（credential stuffing）** = 拿一批泄露的账号密码去其他站点批量尝试登录。

| 问题 | 密码 | API Key |
| --- | --- | --- |
| 谁生成的？ | **人选**（人脑/习惯） | **机器生成**（CSPRNG） |
| 熵有多高？ | 低（常见 20~40 位，弱密码更低） | 高（本项目 **128 位**随机） |
| 会复用吗？ | 会（同一个人多个站点用同一个密码；泄露后撞库） | 不复用（每个应用/环境独立生成） |
| 有「字典 / 彩虹表」吗？ | 有（海量真实泄露密码） | 对 128 位随机值**没有** |
| 验证频率？ | 登录时（低频） | **每次对外调用**（高频） |
| 泄露后的主要风险 | 撞库、离线爆破 | 被直接冒用、刷额度、DoS（拒绝服务） |
| 需要的哈希 | **慢哈希 + 盐**（bcrypt / argon2） | **快哈希**（SHA-256）即可 |

一句话：**慢哈希是给「低熵、会被复用」的凭证加「时间税」；高熵随机值不需要时间税。**

### 4.2 密码侧：低熵 + 复用 ⇒ 慢哈希 + 盐

密码的问题是**输入空间太小**。一个普通人选的 8 位密码，真实熵往往只有 20~30 位；如果它出现在某次泄露的密码字典里，攻击者甚至不需要「猜」，直接查表。

如果密码用 SHA-256 存：

- SHA-256 是**为速度设计**的：现代 GPU 每秒可以算**十亿级**甚至更多次。
- 一个 20 位熵的密码（约 100 万种可能）在 GPU 上**不到一秒**就能穷举。
- 没有盐时，攻击者可以预先算好「常见密码 → 哈希」的**彩虹表**，一次泄露、多处复用。
- 盐（salt）让同一个密码在不同用户下得到不同哈希，阻止预计算和「一眼看出两个人密码相同」；但它**不能**把弱密码变强，只能让攻击者**逐个**去猜。
- 成本因子（cost）让每次猜测变慢：bcrypt 的 `10` 大约意味着 2^10 轮密钥扩展，本机一次校验约 **44 ms**（§4.5）。这把「每秒十亿次」压到「每秒约 23 次/核」，为强密码争取时间。

> bcrypt 的盐、成本因子、`$2a$10$` / `$2b$10$` 结构已在 `01-账号与认证/06-JWT与密码哈希.md` 讲透，这里不再重复。

关键结论：**密码必须用慢哈希，因为它的熵太低，只能靠「每次猜测都很贵」来抵抗离线爆破。**

### 4.3 API Key 侧：128 位随机 ⇒ 快哈希足够

本项目的 key 是（格式与生成细节见本阶段 `01-发布语义与API-Key契约.md`；这里只讨论**熵**）：

```ts
const key = `sk-${randomBytes(16).toString('hex')}`   // 16 字节 = 128 位
```

- `randomBytes(16)` 是**密码学安全伪随机数生成器**（CSPRNG），输出 128 位。
- 128 位意味着 **2^128 ≈ 3.40 × 10^38** 种可能。
- 即使攻击者每秒能试 **10^12** 次（已经远超普通离线攻击），穷举期望时间约 **1.08 × 10^19 年**——比宇宙年龄（约 1.38 × 10^10 年）还大 **约 7.8 亿倍**。
- 即使按 10^18 次/秒算，也要约 **1.08 × 10^13 年**，仍是宇宙年龄的约 **780 倍**。

所以：

- 对 API Key 来说，**「快」不是缺点，而是优点**：它要在每次请求上验证，不能给每个请求加 44 ms。
- 对 128 位随机值，**彩虹表不可能存在**（需要 2^128 条记录），**字典也没有意义**（没有「常见 API Key」这种东西）。
- 因此 `sha256(key)` 已经足够；加盐不会带来实际收益（每个 key 本来就唯一），加 bcrypt 反而会把系统拖垮。

### 4.4 本机实测：44 ms vs 0.46 µs

**在哪执行**：仓库根（Python 侧用 `uv run --project apps/api-py`）
**目的**：把「慢哈希」与「快哈希」的差距量化。

```bash
uv run --project apps/api-py python -c "
import bcrypt, hashlib, time
p = b'secret123'
t = time.perf_counter(); h = bcrypt.hashpw(p, bcrypt.gensalt(rounds=10)); print('bcrypt hash ms', round((time.perf_counter()-t)*1000, 2))
t = time.perf_counter(); [bcrypt.checkpw(p, h) for _ in range(10)]; print('bcrypt check avg ms', round((time.perf_counter()-t)*100, 2))
k = b'sk-e217e49c78f151618cc8d94a1c6eb7a9'
t = time.perf_counter(); [hashlib.sha256(k).hexdigest() for _ in range(10000)]; print('sha256 avg us', round((time.perf_counter()-t)*1e6/10000, 3))
"
```

**本机实测（示例值；不同 CPU 数值不同，数量级不变）**

| 操作 | 耗时 | 说明 |
| --- | --- | --- |
| bcrypt 生成（rounds=10） | **44.25 ms** | 一次哈希 |
| bcrypt 校验 | **44.19 ms** | 每次登录/校验 |
| SHA-256 摘要 | **0.457 µs** | 每次认证 |
| 倍数 | **约 9.7 万倍** | 44.19 ms ÷ 0.457 µs |

**把数字放到「每次请求都验证」的场景**：

- 假设每秒 **1000** 次对外调用：
  - 用 bcrypt：`1000 × 44.19 ms = 44.19 秒` 的 CPU 时间/秒 → 至少需要 **约 45 个核心**持续跑满，还没算排队带来的延迟。每个请求的鉴权本身就要 44 ms 起步。
  - 用 SHA-256：`1000 × 0.457 µs = 0.457 ms` 的 CPU 时间/秒 → 只占**一个核心的约 0.046%**，可以忽略。
- 这不是「优化」，而是**架构上能不能成立**的问题：用 bcrypt 存 API Key，等于给每个请求加了一道 44 ms 的同步闸门。

> bcrypt 的慢是**故意的**；把它用在「每次请求都要验」的高频凭证上，就是把密码场景的成本模型错误地搬到了机器凭证场景。

### 4.5 没有盐，为什么仍然安全

「SHA-256 存密码必须加盐」是对的；但「SHA-256 存 API Key 不加盐」并不矛盾。盐要解决的问题是：

1. **彩虹表**：预计算「常见输入 → 哈希」。API Key 是 128 位随机值，预计算 2^128 条记录不可能。
2. **相同输入得到相同哈希**：两个用户用同一个密码时，哈希相同，攻击者一眼看出。API Key 每把独立随机，两把相同的概率是 2^-128；而且 `key_hash` 上有 UNIQUE 约束，真出现重复会被数据库拒绝。
3. **批量爆破**：盐让攻击者不能把「一次计算」复用到多个用户。API Key 本来就没有「同一把 key 被多个用户共用」的场景；每把 key 都是一个独立的 128 位挑战。

所以在这里，盐的边际收益接近于零。**安全性来自输入的熵，而不是来自哈希的「慢」或「加盐」。**

> 可选的生产加固：用 **HMAC-SHA256(server_secret, key)** 或加一个 **pepper**（只存在于服务端的保密常数）代替裸 SHA-256。**HMAC** 是带密钥的哈希（消息认证码）；这样即使只拖走数据库，攻击者没有 pepper 也无法离线验证猜测。代价是：pepper 泄露（应用服务器被攻破）时同样失效；轮换 pepper 需要重新计算所有 key 的哈希（或双读过渡）。本项目为了教学简洁，使用裸 SHA-256。

### 4.6 什么时候 SHA-256 会变成灾难

SHA-256 本身不是「弱哈希」，它只是**快**。快对高熵随机值是优点，对低熵输入是灾难。以下写法会把「快」变成漏洞：

| 错误写法 | 为什么危险 |
| --- | --- |
| 让用户自选 API Key（如 `sk-prod-2026`） | 熵骤降到几十位甚至十几位；SHA-256 太快，字典/暴力瞬间攻破 |
| 用 `Math.random()` / Python `random` 生成 key | 不是 CSPRNG，输出可预测；攻击者可能推算出后续 key |
| key 太短（如 6~8 位） | 搜索空间小；再快的哈希也挡不住穷举 |
| 用时间戳 / 自增 ID / 可猜测的 UUID 变体 | 可枚举；熵不等于「看起来乱」 |
| 把 key 的哈希当成「加密」来用，试图还原 | 哈希是单向的，还原不了；如果你需要还原，说明你用错了工具 |

**结论**：API Key 的安全 = **CSPRNG 生成的 128 位随机数** + **快哈希存储**。哈希算法只是第二道工序；第一道工序（生成）错了，后面全错。

### 4.7 一句话总结

> **密码是人选的、低熵、会复用 → 用慢哈希 + 盐，抵抗离线爆破。
> API Key 是机器生成的、128 位随机、不复用 → 用快哈希，抵抗的是「拖库后被直接冒用」，而不是「被猜出来」。
> 不是 API Key 不重要，而是它面临的攻击模型不同。**
>
> API Key **当然也需要保护**——只是保护手段不是「慢哈希」，而是：**不泄露**（只存哈希、不进日志/前端）、**传输加密**（HTTPS）、**可撤销**（`revokedAt`）、**可轮换**（§7.4）、**最小权限**、**限流与监控**（§10）。把「保护」等同于「用 bcrypt」，是本节要纠正的核心误解。

---

## 5. 创建：明文只返回一次

### 5.1 TS 侧 `create`

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.service.ts`（第 34–60 行，`create`）**

```ts
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
```

**逐行注释**

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 35 | `async create(ownerId, appId, name)` | `ownerId` 来自 JWT 的 `sub`，`appId` 来自路径，`name` 来自请求体；返回创建视图（含一次性 `key`）。 |
| 36 | `await this.assertAppOwned(ownerId, appId)` | 先校验应用**存在且属于当前用户**；不满足一律 `404 App not found`（归属隔离，见阶段 2）。 |
| 37–39 | `[...name].length > 60` | 按**码点**数长度；超过 60 抛 §10 专用文案 `API key name is too long`（不是 §1.1 的通用 `maxLength` 文案）。 |
| 40 | 注释 | 重名检查只针对**未撤销**的 key；已撤销的同名 key 不阻止新建，方便轮换。 |
| 41–44 | `findFirst({ where: { appId, name, revokedAt: null } })` | 在同一应用内找「同名且未撤销」的记录；只取 `id`，不读多余字段。 |
| 45–47 | `if (duplicate !== null)` | 命中则 `400 API key name already exists`。 |
| 49 | `` `sk-${randomBytes(16).toString('hex')}` `` | **生成 128 位随机 key**：16 字节 → 32 位十六进制，前缀 `sk-`，共 35 字符。`randomBytes` 是 CSPRNG。 |
| 50–58 | `prisma.apiKey.create({ data: {...} })` | 只写 `appId` / `ownerId` / `name` / `keyPrefix` / `keyHash`，**不写明文**。 |
| 55 | `key.slice(0, KEY_PREFIX_LENGTH)` | 取前 11 字符作为可展示前缀（`sk-` + 8 位十六进制）。 |
| 56 | `hashKey(key)` | 对**完整明文**做 SHA-256，得到 64 位十六进制摘要。 |
| 59 | `return { ...toApiKeyResponse(created), key }` | 视图字段 + **一次性明文 `key`**；这是明文唯一一次离开服务器的位置。 |

**这段在干什么**：先做归属与名称校验，再用 CSPRNG 生成 128 位随机 key；**明文只用于计算 `prefix` 和 `hash`，随后只把哈希与前缀写进数据库**；最后把明文塞进创建响应，且只在这个响应里。

### 5.2 Python 侧 `create`

**完整文件路径：`apps/api-py/app/api_keys/service.py`（第 64–106 行，`create`）**

```python
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
```

**逐行注释**

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 64–66 | `def create(db, owner_id, app_id, name)` | 返回 `(视图字段, 明文 key)` 二元组；明文只在路由层拼进创建响应。 |
| 67–71 | docstring | 说明顺序与 TS 对齐：名称的「缺失 / 空」在进入服务前等价于 DTO 校验。 |
| 72–75 | `if name is None` | 缺失 / `null` → `400 name is required`（项目约定：缺失统一报 `{field} is required`，与 `/apps`、`/knowledge-bases` 一致）。 |
| 76–77 | `if not isinstance(name, str)` | 存在但非字符串（如 `123`）→ `400 name must be a string`。 |
| 78–79 | `if len(name) < 1` | 空串 → `400 name must be at least 1 characters`。 |
| 81 | `_find_owned_app(...)` | 应用不存在或不属于当前用户 → `404 App not found`。 |
| 83–84 | `len(name) > 60` | 超长 → §10 专用文案 `API key name is too long`（**在归属校验之后**，因此非本人应用一律先 404）。 |
| 86–90 | `select ... where app_id/name/revoked_at is null` | 同一应用内查「同名且未撤销」的记录，`limit(1)`。 |
| 91–92 | `if duplicate is not None` | 命中 → `400 API key name already exists`。 |
| 94 | `secrets.token_hex(16)` | **CSPRNG** 生成 16 字节 → 32 位十六进制；与 TS 的 `randomBytes(16).toString('hex')` 等价。 |
| 95–102 | `ApiKey(... key_prefix=..., key_hash=...)` | 只构造哈希与前缀，**没有明文属性**。 |
| 103–105 | `add` / `commit` / `refresh` | 落库并回读数据库生成的 `created_at` 等字段。 |
| 106 | `return to_response_fields(api_key), key` | 视图 + 一次性明文，交给路由层 `CreateApiKeyResponse(**fields, key=key)`。 |

**这段在干什么**：与 TS 侧**逐步对应**——先校验名称，再校验归属，再查未撤销重名，再用 `secrets` 生成 128 位随机 key，只把前缀与 SHA-256 写库，最后把明文作为第二个返回值交给路由层。

> **名称校验的顺序细节**：TS 的 `@IsString()` / `@MinLength(1)` 在**进入服务前**由 `ValidationPipe` 执行；Python 把这两步放在服务开头。两者对外顺序一致：**先报名称缺失/空，再报应用归属，再报超长/重名**。这也是为什么 TS 的 DTO 故意**不加** `@MaxLength(60)`——否则超长会落到 §1.1 的通用文案，破坏 §10 的专用文案。
> **「完全缺失 `name`」的文案曾两端不一致，现已修复**：修复前 TS 返回 `name is required`（`validationExceptionFactory` 先判 `value === undefined`），Python 返回 `name must be a string`（`name` 默认 `None`，服务层 `not isinstance`）。现在 Python 的 `create()` 开头补了 `if name is None: raise _bad_request("name is required")`——依据项目既有约定「缺失统一报 `{field} is required`」（`/apps`、`/knowledge-bases` 两端本就如此，api-keys 是唯一异常值）。实测两端逐字节相同：`{}` → `400 name is required`。
> **「非归属应用 + 超长名」两端一致（此前曾误记为差异）**：本阶段 `01-发布语义与API-Key契约.md` §12.11 曾称「Python 先报 `API key name is too long`」，核对源码与实测并不成立。Python 的 `service.create` 在 `len(name) > 60` **之前**先调用 `_find_owned_app`，TS 的 `create` 也先 `assertAppOwned`；两端都返回 **404 `App not found`**（实测：`service.create(D(), 'owner', 'not-owned', 'x'*61)` → `404 App not found`）。`01` 的 §12.11 已同步更正。

### 5.3 为什么不能「想再看就再查一次」

因为**库里只有哈希，而哈希是单向的**。

- SHA-256 是**单向函数**：给定 `key` 容易算 `hash`；给定 `hash` 求 `key` 在计算上不可行（预映像抵抗）。
- 服务器能做的是**验证**：把调用方送来的 key 再哈希一次，和库里的 `key_hash` 比。它**不能恢复**原始 key。
- 所以「再查一次明文」不是「接口没开放」，而是**服务端物理上不具备这个能力**。即使你直接登录数据库，也只能看到 64 位十六进制摘要。
- 这也解释了为什么 `ApiKeyResponse` 里根本没有 `key` 字段，只有 `prefix`：契约在类型层面就堵死了「列表返回明文」的可能（前端表现见 `04-前端发布面板与调用示例.md`）。

**如果业务真的需要「再次展示」**，只有三种选择：

1. **存可逆密文**（用 KMS / 信封加密）：能还原，但把「拖库即泄露」变成了「拖库 + 拿到解密密钥才泄露」；密钥管理本身成为高风险面。
2. **存明文**：最差，拖库即全部泄露。
3. **不提供**：本项目选择。代价是「丢了就轮换」——创建新 key、切换调用方、撤销旧的。

> 「哈希可验证但不可恢复」是设计的核心。不要把它误写成「加密」：加密是可逆的，哈希不是。哈希 vs 加密的基础见 `01-账号与认证/06-JWT与密码哈希.md`。

### 5.4 `prefix` 的取舍

`prefix` = 明文 key 的前 **11** 个字符 = `sk-` + **8 位十六进制**。

**它解决什么问题**：

- 列表里有很多 key 时，用户需要认出「线上跑的是哪一把」。显示完整 key 不可能（库里没有），显示 `name` 又可能重名；`prefix` 提供了一个**稳定的短标识**。
- 配合 `lastUsedAt`，可以判断「这把 key 最近有没有被调用」，用于轮换与清理。

**它泄露了什么**：

- 8 位十六进制 = **32 位**密钥材料。攻击者如果拿到 `prefix`，可以把搜索空间从 2^128 降到 **2^96**。
- 2^96 ≈ 7.92 × 10^28；即使按 10^12 次/秒，也要约 **2.5 × 10^9 年**；按 10^18 次/秒，也要约 **2500 年**。仍然远超任何现实攻击窗口。
- 所以 `prefix` 的泄露是**有代价但可接受**的；它不是「零泄露」设计。

**它不能做什么**：

- **不能用来认证**：`authenticate` 只对**完整 key** 做 SHA-256，然后按 `key_hash` 精确匹配；`prefix` 从不参与校验。拿 `sk-e217e49c` 去调用，只会得到 `401 Invalid API key`。
- **不能用来探测 key 是否存在**：对外接口只接受完整 key，且所有失败都返回同一句 `Invalid API key`；没有任何公开接口接受 `prefix` 查询。管理列表接口需要 JWT，且只返回**当前用户自己的** key。
- **不能当唯一标识**：32 位前缀在 key 数量多时会发生碰撞。按生日近似，约 **6.5 万**把 key 时碰撞概率已接近 50%；1 万把时约 **1.2%**。所以身份用 `id`，展示用 `prefix`，**绝不能用 `prefix` 查库**。

**如果你想做到「零密钥材料泄露」**：

- 不要从 key 派生 prefix，而是额外生成一个**独立的随机 `key_id`**（长度足够避免碰撞），只用于展示；
- 或者展示 `sha256(prefix)` 的截断值；
- 代价是多一列、多一次生成，且用户无法从 prefix 直接看出 key 的开头。本项目选择「简单 + 可辨识」，接受 32 位泄露。

**一句话**：`prefix` 是**展示标识**，不是**凭证**；它泄露 32 位，但既不参与认证，也不构成存在性 oracle。

### 5.5 重名规则与轮换的接口

创建时的重名条件是 `(appId, name, revokedAt = null)`：

- **只有未撤销的同名 key 才算冲突**。撤销后可以复用同名——这让「`prod`」这种名字可以跨轮换周期重复使用。
- **重叠轮换时不能复用同名**：旧 key 还没撤销、新 key 又用同一个 `name`，会命中 `400 API key name already exists`。所以重叠期要用新名字（如 `prod-2026-10`），等旧 key 撤销后再考虑改回。
- 重名检查是**按应用**的，不是全局的：两个应用可以有同名的 key。

> **并发边界（源码事实）**：重名检查是「先查后插」，数据库里**没有** `(app_id, name) WHERE revoked_at IS NULL` 的 partial unique index。两个并发创建请求可能同时通过检查，插入两个同名未撤销 key。本阶段不处理；生产可加 partial unique index（`CREATE UNIQUE INDEX ... ON api_keys(app_id, name) WHERE revoked_at IS NULL`），或在事务里加锁。

---

## 6. 认证：一次哈希索引查找

### 6.1 TS 侧 `authenticate`

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.service.ts`（第 84–101 行，`authenticate`）**

```ts
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
```

**逐行注释**

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 88 | `async authenticate(rawKey)` | 入参是**明文 key**；返回 `{ appId, ownerId }`。 |
| 89–92 | `findUnique({ where: { keyHash: hashKey(rawKey) } })` | 先对明文做 SHA-256，再用 `key_hash` 的**唯一索引**查一行；只 select 需要的字段。 |
| 93–95 | `found === null \|\| found.revokedAt !== null` | 查不到、或已撤销 → `401 Invalid API key`；两者**同一句文案**。 |
| 96–99 | `update({ data: { lastUsedAt: new Date() } })` | 鉴权成功即刷新最后使用时间（语义与代价见 §6.6）。 |
| 100 | `return { appId, ownerId }` | 把归属信息交给控制器，用于后续的 appId 比对与执行。 |

**这段在干什么**：把「明文 → SHA-256 → 唯一索引查一行 → 未撤销 → 刷新 `lastUsedAt`」串成一次认证。**没有任何遍历、没有逐字符比较明文**。

### 6.2 Python 侧 `authenticate`

**完整文件路径：`apps/api-py/app/api_keys/service.py`（第 124–137 行，`authenticate`）**

```python
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

**逐行注释**

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 124 | `def authenticate(db, raw_key)` | 同步 Session；返回 dict。 |
| 125–129 | docstring | 明确写出「先更新 `last_used_at`，再比对 appId」——这是与 TS 对齐的关键语义。 |
| 130 | `select(ApiKey).where(ApiKey.key_hash == hash_key(raw_key))` | 对明文做 SHA-256，按 `key_hash` 唯一索引查一行。 |
| 131–134 | `api_key is None or revoked_at is not None` | 查不到 / 已撤销 → `401 Invalid API key`。 |
| 135 | `datetime.now(timezone.utc).replace(tzinfo=None)` | 写 **naive-UTC**（列是 `timestamp` 无时区），读取时由 `iso_z` 按 UTC 解释。 |
| 136 | `db.commit()` | 提交 `last_used_at` 更新。 |
| 137 | `return {"appId": ..., "ownerId": ...}` | 归属信息交给路由层。 |

**这段在干什么**：与 TS 等价——哈希、唯一索引查一行、未撤销、刷新时间、返回归属。区别只有语言与 ORM 写法；**语义必须一致**。

### 6.3 哈希查找 vs 遍历比对

**正确做法（本项目）**：

```sql
SELECT id, app_id, owner_id, revoked_at
FROM api_keys
WHERE key_hash = '6fb128f90ab7145b332b42b928fa82139505409b32db178bf2060c6940c51a1e';
```

- `key_hash` 上有 **UNIQUE B-tree 索引**（`api_keys_key_hash_key`），数据库**一次索引定位**就能找到（严格说是 O(log n)，口语常说 O(1)）。
- 行数从 10 涨到 1000 万，查找成本只随索引高度缓慢增长，**不会线性变慢**。
- `findUnique` / `select(...).where(...)` 都会生成参数化查询，不存在 SQL 注入拼接。

**错误做法（反面示例，非项目代码）**：

```ts
// 不要这样写：把全表读进内存，再逐个比较
const all = await prisma.apiKey.findMany()
let found = null
for (const k of all) {
  if (k.keyHash === hashKey(rawKey)) {
    found = k
    break
  }
}
```

问题：

1. **O(n) 时间 + O(n) 内存**：key 越多越慢，攻击者可以用大量请求放大成本。
2. **全表扫描**：数据库无法利用索引；1 万行时可能还「看起来能用」，100 万行时就变成 DoS 向量。
3. **语义错误**：你只需要一行，却把整张表（包含 `owner_id` 等）拉进应用进程，扩大泄露面。
4. **定时差异**：提前 `break` 会让「第几行命中」影响响应时间；见 §6.4。

**为什么不用 `prefix` 查**：

- `prefix` 只有 32 位，**不唯一**；按前缀查可能返回多行，还得再逐个比较完整哈希。
- `prefix` 是展示字段，不是索引身份；用 `id` 或 `key_hash` 才是唯一键。
- 若按前缀查，还会把「前缀存在」变成一个可观察的 oracle（即使返回多行），增加信息泄露面。

### 6.4 定时攻击（timing attack）

**定义**：攻击者通过测量「服务器处理不同输入的时间差」，推断秘密的字节。经典例子是逐字符比较字符串时「第一个字节就不同」比「前 N 个字节都相同」返回得更快，于是可以一个字节一个字节地试。

**为什么本项目不成立**：

1. 应用层比较的是 **SHA-256 摘要**，不是明文 key。攻击者能控制的是「输入 key」，但输入会先经过 SHA-256；改变一个字符会让整个 **256 位摘要（64 位十六进制）雪崩式**变化。想构造「摘要前 N 位相同」的输入，等价于做**部分预映像**，计算上不可行。
2. 数据库比较的是 `key_hash` 索引键，不是逐字符的 `if (stored === input)` 循环；没有「提前退出」的应用层字符串比较。
3. 即使有微秒级的时序信号，也会被网络抖动、连接复用、DB 缓存、查询计划等因素淹没；但**不要只依赖噪声**——真正的防线是 128 位熵与哈希索引。
4. 对 128 位随机 key，即使给攻击者一个完美的「是否有效」oracle，他也需要 2^128 次猜测。

**如果你在别处需要比较原始秘密**：

- Node：`crypto.timingSafeEqual(a, b)`（等长 Buffer）。
- Python：`hmac.compare_digest(a, b)`。
- 这里**不需要**，因为我们从不把明文 key 与库里的值直接比较；比较的是哈希。

> **另一个更现实的旁路**：成功鉴权会多执行一次 `UPDATE last_used_at`（有时还会多一次 app 查询），失败鉴权会提前返回。理论上响应时间可以区分「key 有效」与「key 无效」。本项目没有做恒定时间响应；网络噪声下难以利用，但高安全场景可以把 `last_used_at` 改成**异步/节流更新**（§6.6），顺带抹平这条旁路。

### 6.5 认证顺序与信息泄露

**完整文件路径：`apps/api-ts/src/public/public.controller.ts`（第 52–66 行，认证顺序）**

```ts
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
```

**逐行注释**

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 52 | `extractApiKey(...)` | 从 `X-API-Key` 或 `Authorization: Bearer` 取 key；空白视为未提供。 |
| 53–55 | `rawKey === undefined` | 没有 key → `401 Missing API key`。 |
| 56 | 注释 | 限流的预留位置；本阶段不实现（§10）。 |
| 58 | `authenticate(rawKey)` | 哈希查找 + 未撤销检查 + 刷新 `lastUsedAt`。 |
| 59–66 | `authenticated.appId !== appId` | key 有效但**不属于路径里的应用**：先查 app 是否存在；不存在 → `404 App not found`，存在 → `401 Invalid API key`。 |

**这段在干什么**：先回答「你是谁」（key 是否有效），再回答「你能不能操作这个资源」（key 的 appId 是否匹配），最后才回答「资源在不在」。**顺序本身就是信息泄露控制**。

**Python 侧逐行对应**（`apps/api-py/app/api/public.py` 第 59–74 行）：

```python
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
```

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 59 | `_extract_api_key(...)` | 与 TS 相同的取 key 规则。 |
| 60–63 | `raw_key is None` | 没有 key → `401 Missing API key`。 |
| 64–65 | 注释 + `authenticate` | 先认证并刷新 `last_used_at`。 |
| 66–74 | `appId != app_id` | 应用不存在 → `404`；存在 → `401 Invalid API key`。 |

**这段在干什么**：与 TS **逐句同构**——先取 key、再认证、再比对 appId；两个分支的顺序与文案完全一致。

> **前提：请求体本身合法。** NestJS 的全局 `ValidationPipe` 与 FastAPI 的 Pydantic 都在**进入路由函数之前**校验 body。如果 body 不合法（缺 `inputs`、多了 `conversationId` / `userMessage` 等），框架会先返回 `400`，轮不到 API Key 认证。所以测「无 key → `401 Missing API key`」时必须带一个合法 body（如 `{"inputs":{}}`）；否则你看到的可能是 `400` 的 body 校验错误。

#### 6.5.1 五种情况分别泄露了什么

| 情况 | 返回 | 攻击者能推断什么 | 设计意图 |
| --- | --- | --- | --- |
| 没有 key | `401 Missing API key` | 只知道「请求没带凭证」 | 帮助集成方区分「忘了带」与「带错了」，不泄露 key 有效性 |
| key 不存在 / 格式不对 | `401 Invalid API key` | 只知道「这把 key 不行」 | 与「已撤销」「不属于该应用」合并，不给额外信息 |
| key 已撤销 | `401 Invalid API key` | **不能**知道它是「曾经有效但被撤销」 | 撤销状态只对所有者可见（列表里的 `revokedAt`），不向调用方暴露 |
| key 属于 A，调 B（B 存在） | `401 Invalid API key` | **不能**知道「这把 key 其实有效，只是不属于 B」 | 防止横向探测：不确认 key 的有效性 |
| key 属于 A，调 B（B 不存在） | `404 App not found` | 知道「B 这个应用不存在」 | 仅在**已通过鉴权**的调用方面前暴露；避免把「应用不存在」误报成「key 无效」 |

#### 6.5.2 为什么不是 403

`403 Forbidden` 的语义是：**「我认得你，但你没有权限」**。一旦对「key 不属于该应用」返回 403，就等于告诉调用方：

> 「这把 key 是有效的，只是不能用于这个应用。」

这会带来两个问题：

1. **确认 key 有效**：攻击者拿到一把来路不明的 key，可以用不同 `appId` 试探；403 等于确认「这把 key 是真的」。
2. **横向枚举**：攻击者可以进一步探测「这把 key 属于哪些应用 / 哪些应用存在」。

本项目用 `401 Invalid API key` 把「key 无效」与「key 不属于该应用」**合并成同一个响应**，调用方无法区分。这是**有意的信息隐藏**，不是「HTTP 状态码用错了」。

> 401 与 403 的一般语义、以及资源接口为什么用 404 而不是 403，已在 `02-应用管理/01-契约扩展.md`、`02-应用管理/03-NestJS应用模块.md` 讲过；这里讲的是**凭证认证**场景的取舍。

#### 6.5.3 为什么 404 不泄露给未认证者

关键在**顺序**：

- 代码先 `authenticate`，再比对 `appId`，最后才查应用是否存在。
- 一个**没有有效 key** 的攻击者，在第一步就拿到 `401 Invalid API key`，**根本走不到** 404 分支。
- 因此，未认证者无法用「404 vs 401」来枚举应用是否存在；只有**已经持有一把有效 key** 的调用方，才能观察到 404/401 的差别。

这是「先认证、后查资源」的典型收益。反过来，如果你先查应用、再认证，未认证者就能用 404/401 枚举应用 ID——这是一个常见的信息泄露 bug。

> 代价：持有有效 key 的人可以枚举「哪些 appId 存在」。appId 是 UUID，难以猜；而且此人已经有有效凭证，风险可接受。若你要求「连有效 key 持有者也不能知道应用是否存在」，就把两个分支都返回 `401 Invalid API key`；代价是合法调用方拼错 appId 时得到一个误导性的「key 无效」。

#### 6.5.4 不要在响应体里加 `code`

错误信封只有 `statusCode` / `message` / `error`。**不要**为了「方便调试」加：

```json
{"statusCode":401,"message":"Invalid API key","error":"Unauthorized","code":"KEY_REVOKED"}
```

或 `"reason":"WRONG_APP"`。那会把刚刚合并掉的信息又泄露出去，且破坏两端逐字节一致。调试信息应该进**服务端日志**（并脱敏），不是响应体。

### 6.6 `lastUsedAt`：用途与写放大

**用途**：

- 所有者能看到「这把 key 最近有没有被调用」，判断是否还在使用。
- 轮换时，用旧 key 的 `lastUsedAt` 判断「调用方是否已经切走」，再决定何时撤销（§7.4）。
- 事故响应时，判断一把泄露的 key 是否正在被使用。
- 清理长期未使用的 key（`lastUsedAt` 为空或很久以前）。

**准确的语义：它是「最后一次鉴权成功」，不是「最后一次运行成功」。**

代码在 `authenticate` 里更新，而 `authenticate` 发生在：

1. appId 比对**之前**；
2. 发布状态检查**之前**；
3. 引擎执行**之前**。

因此：

- 拿 A 的 key 调 B（B 存在）→ 鉴权成功、刷新 `lastUsedAt`，然后控制器返回 `401`。**一次以 401 结束的请求也会刷新它。**
- key 正确但应用未发布 → 鉴权成功、刷新 `lastUsedAt`，然后 `400 App is not published`。实测库里的 `unpub-key` 行有 `last_used_at`，而它的应用是未发布状态——这就是证据：

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c \
  "select a.name, (a.published_graph_json is null) as unpublished,
          k.name as key_name, k.last_used_at
   from apps a join api_keys k on k.app_id = a.id
   where k.key_prefix = 'sk-5f929430'"
```

**实测输出**

```
        name         | unpublished | key_name  |      last_used_at
---------------------+-------------+-----------+-------------------------
 phase10-unpublished | t           | unpub-key | 2026-10-23 13:45:00.982
```

- key 已撤销 / 不存在 → 在更新之前就 `401`，**不会**刷新。所以撤销后 `lastUsedAt` 停在撤销前（`04` 也观察到了这一点）。

> 源码注释有一处措辞不一致：`schema.prisma` 写的是「最近一次对外运行的时间」，而实际语义是「最近一次鉴权成功的时间」。两者在「成功运行」时一致，但在「鉴权成功、随后 400/401」时不一致。以代码行为为准。

**副作用：写放大（write amplification）**

**写放大**：一次逻辑上的「读」请求，额外触发了数据库写入；在高 QPS 下，这些额外写会累积成可观的 I/O、锁与 vacuum 成本。

- 每一次**鉴权成功**的请求，都会对 `api_keys` 执行一次 `UPDATE`。
- 1000 req/s 就是 **1000 次写/秒**，即使都命中同一行：
  - Postgres 的 MVCC 会产生死元组，autovacuum 需要清理；
  - 产生 WAL，增加磁盘 I/O 与复制流量；
  - 同一行的并发更新会竞争行锁；
  - 如果 `last_used_at` 上将来加了索引，更新还会带来索引写放大（当前没有索引）。
- 这还不包括 `authenticate` 本身的索引查找。也就是说，**一次对外调用至少是「一次读 + 一次写」**，而读是必须的，写只是为了一个「大概的时间戳」。

**生产环境的替代方案**：

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| 节流更新 | `UPDATE ... WHERE last_used_at IS NULL OR last_used_at < now() - interval '60 seconds'` | 每 key 每分钟最多一次写；时间精度降到分钟级，通常够用 |
| 异步更新 | 把「key 被使用」事件丢进队列 / 异步任务，批量落库 | 请求路径不再写库；时间有延迟，需要队列可靠性 |
| 采样 | 只对 1% 的请求更新 | 成本最低；时间可能很旧，只适合「是否用过」的粗判断 |
| 独立分析表 | 写 `api_key_usage` 事件表，后台聚合 | 写更多，但可做用量统计/计费；不适合只为「最后使用」 |
| 内存/Redis | 请求内累加，定时 flush 到 DB | 多实例需要共享状态；重启会丢一点精度 |

本项目的取舍：**每次请求精确更新一次**，代码最简单、演示最直观；代价是写放大。教学项目接受，生产不应照搬。

---

## 7. 撤销 vs 删除

### 7.1 代码

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.service.ts`（第 72–82 行，`revoke`）**

```ts
  /** DELETE /api-keys/{id}：撤销（置 `revokedAt`），找不到/不属于自己一律 404。 */
  async revoke(ownerId: string, id: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id } })
    if (apiKey === null || apiKey.ownerId !== ownerId) {
      throw new NotFoundException('API key not found')
    }
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    })
  }
```

**逐行注释**

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 73 | `async revoke(ownerId, id)` | 按 key 的 `id` 撤销；`ownerId` 来自 JWT。 |
| 74 | `findUnique({ where: { id } })` | 按主键查一行。 |
| 75–77 | `null \|\| ownerId !== ownerId` | 不存在 / 不属于当前用户 → `404 API key not found`（不泄露存在性）。 |
| 78–81 | `update({ data: { revokedAt: new Date() } })` | **只置撤销时间，不删行**。 |

**完整文件路径：`apps/api-py/app/api_keys/service.py`（第 114–121 行，`revoke`）**

```python
def revoke(db: Session, owner_id: str, key_id: str) -> None:
    """`DELETE /api-keys/{id}`：撤销（置 `revoked_at`），找不到/不属于自己一律 404。"""
    api_key = db.get(ApiKey, key_id)
    if api_key is None or api_key.owner_id != owner_id:
        raise _not_found("API key not found")
    # 列在 PG 上为 timestamp（无时区）；写 naive-UTC，读取时 iso_z 按 UTC 解释
    api_key.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
```

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 114 | `def revoke(db, owner_id, key_id)` | 同步 Session；无返回值。 |
| 115–118 | `db.get` + 归属判断 | 不存在 / 不属于当前用户 → `404 API key not found`。 |
| 119–120 | `revoked_at = datetime.now(...)` | 写 naive-UTC；只改字段，不删行。 |
| 121 | `db.commit()` | 提交。 |

**这段在干什么**：`DELETE` 这个 HTTP 动词只是**接口语义**；在数据层，它做的是「置 `revoked_at`」，行仍然在。对外的效果是「下一次鉴权失败」，对内的效果是「留下历史」。

### 7.2 为什么软撤销

| | 物理删除 | 软撤销（本项目） |
| --- | --- | --- |
| 数据库 | 行消失 | 行保留，`revoked_at` 置时间 |
| 列表 | 条目消失 | 条目保留，带「已撤销」标记 |
| 审计 | 不能回答「谁在什么时候撤销了哪把 key」 | `revoked_at` 就是审计线索 |
| 历史 | 不能回答「这把 key 曾经存在吗」 | 能 |
| 同名重建 | 行没了，自然可以 | 可以（重名检查只看未撤销的） |
| 误操作恢复 | 不可逆（除非备份） | 数据还在，可人工改回 `NULL`（本项目未提供接口） |
| 对外行为 | 立即失效 | 立即失效（无宽限期） |

> 撤销按钮、条目保留、「已撤销」标记这些 **UI 表现**见本阶段 `04-前端发布面板与调用示例.md`；本篇讲的是**数据层与安全论证**。

**核心原因**：

1. **可审计**：安全事件里，最常问的三个问题是「这把 key 什么时候创建的」「什么时候被撤销的」「撤销前有没有被使用」。软撤销能回答，物理删除不能。
2. **可展示历史**：所有者需要在列表里看到「它曾经存在、什么时候停用」，而不是一片空白。
3. **可区分状态（对所有者/运维）**：物理删除后，连「这把 key 是否存在过」都没有记录；软撤销保留 `revokedAt`，管理界面能明确显示「已撤销」。
4. **可恢复**：误撤销可以人工把 `revoked_at` 改回 `NULL`；误删除只能靠备份。
5. **不改外键/引用**：虽然 key 没有被其他表引用，但保留行对审计、日志关联更友好。

> **对调用方的响应是刻意相同的**：无论是「key 拼错」「key 曾被撤销」「key 属于别的应用」，对外都是 `401 Invalid API key`。所以「区分」发生在**管理面/审计面**，不是响应体。不要把 `revokedAt` 放进公开错误响应，否则又把信息泄露回去了。

**撤销的幂等性（小细节）**：重复 `DELETE` 同一把已撤销的 key，代码仍会再执行一次 `UPDATE`，把 `revokedAt` 刷新成新的时间。它不会报错，也不会「复活」；但审计时间会被覆盖。生产可以加 `if (revokedAt === null)` 保护，或返回 204 不变。本阶段不处理。

### 7.3 「立即失效」的准确含义

- **新请求**：撤销提交后，下一次 `authenticate` 查到的 `revokedAt` 非空 → `401`。没有缓存、没有宽限期。
- **已经在跑的 SSE 流**：鉴权只发生在**请求开始时**。一个已经通过鉴权、正在流式输出的请求，**不会**因为中途撤销而被打断；它会继续把这次运行跑完。
  - 这是「立即失效」的边界：它保证「不能再发起新调用」，但不保证「正在进行的调用立刻停止」。
  - 如果事故响应要求「立刻切断在途请求」，需要在网关/引擎层额外做「按 key 取消流」的能力；本项目没有做。
- **缓存的考虑**：本项目每次都查库，没有把 key 状态缓存到内存/Redis，所以撤销立即生效。如果生产为了性能加了缓存，必须保证撤销时**主动失效缓存**，否则会出现「已撤销但仍能用」的窗口。

### 7.4 key 轮换（rotation）

**轮换**：用一把新 key 替换旧 key，并在调用方切换完成后停用旧 key。

**正常轮换（计划内）**：

1. **建新 key**：`POST /apps/{id}/api-keys`，用一个新名字（如 `prod-2026-10`）。如果旧 key 还没撤销，**不能**复用同名（会 `400 API key name already exists`）。
2. **切换调用方**：把新 key 放进调用方的 secret manager / 环境变量，滚动重启或热加载。
3. **观察旧 key**：看旧 key 的 `lastUsedAt`。等一个完整的流量周期（例如 24 小时 / 7 天，取决于调用频率），确认它不再更新。
4. **撤销旧 key**：`DELETE /api-keys/{id}`，置 `revokedAt`。
5. **保留记录**：旧 key 仍出现在列表里，带撤销时间；需要时可以追溯。生产可按保留期（如 90 天）再物理清理，本项目不清理。

**事故轮换（计划外，key 疑似泄露）**：

1. **先撤销**：立刻 `DELETE` 泄露的 key，切断新请求（在途流见 §7.3）。
2. **再建新 key**：生成替代 key，切换调用方。
3. **审计**：查 `lastUsedAt`、访问日志、用量，判断泄露期间是否被滥用。
4. **复盘**：为什么会泄露（日志？仓库？前端？），补上对应的防护。

**为什么不能直接删旧的**：

- **没有重叠期**：删掉的一瞬间，所有还在用旧 key 的调用方立刻 `401`；你无法平滑切换。
- **没有审计**：删掉后无法回答「它什么时候被撤销」「撤销前有没有被使用」。
- **无法回滚**：如果误删了正确的那把，只能靠备份；软撤销可以改回 `NULL`。
- **无法定位影响面**：`lastUsedAt` + 列表能告诉你「旧 key 是否还在被使用」；物理删除把这些线索一起删掉。
- **「删除」和「撤销」对调用方的响应本来就一样**（都是 `401 Invalid API key`），所以删除并没有带来任何「更安全」的收益，只带来了不可逆。

> 一句话：**撤销是「停用 + 留痕」，删除是「消失 + 无痕」。安全事件里，留痕几乎总是比无痕更有价值。**

---

## 8. 存储面：拖库之后会发生什么

**拖库**：攻击者把数据库（或备份）整体导出/窃取。

**威胁模型**：数据库备份泄露、SQL 注入读到数据、磁盘/快照被拿走、内部人员导出。

**攻击者拿到什么**：

- `key_hash`：64 位十六进制 SHA-256 摘要；
- `key_prefix`：明文前 11 字符（32 位）；
- `name` / `app_id` / `owner_id` / 时间戳等元数据；
- **没有明文 key**。

**攻击者不能做什么**：

1. **不能直接拿哈希当 key 用（pass-the-hash 不成立）**：服务端会对调用方送来的字符串再做一次 SHA-256，然后与 `key_hash` 比较。送 `key_hash` 本身，算出来的是 `sha256(key_hash)`，不等于 `key_hash`。
2. **不能反推明文**：SHA-256 是单向的；64 位摘要没有已知的实用预映像攻击。
3. **不能靠彩虹表**：2^128 的随机空间，没有预计算表能覆盖。没有盐也不影响这一点（§4.5）。

**攻击者能做什么（以及为什么仍然不可行）**：

- **离线爆破**：需要对 128 位空间做穷举；即使 10^18 次/秒也要约 10^13 年。
- **利用 prefix 缩小空间**：拿到 32 位前缀后，剩 96 位；10^12 次/秒仍需约 25 亿年；10^18 次/秒仍需约 2500 年。仍不可行。
- **确认某把 key 是否存在**：如果他能拿到 prefix 列表，可以知道「这些 key 存在」；但**不能**用 prefix 认证，也不能从哈希推出完整 key。

**真正的风险不在密码学，而在别处**：

| 风险 | 说明 | 防护 |
| --- | --- | --- |
| 备份/快照泄露 | 备份往往比主库保护更弱 | 加密备份、限制访问、轮换密钥 |
| 日志泄露 | 创建响应、请求头可能被 APM/网关记录 | 对 `key` / `X-API-Key` / `Authorization` 做脱敏；关闭该接口的 body 日志 |
| 内部人员写库 | 有写权限的人可以插入自己的 `key_hash`（等于铸造一把 key） | 最小权限、审计、双人审批 |
| SQL 注入读库 | 只能读到哈希，读不到明文；但仍泄露元数据 | 参数化查询（本项目已用 Prisma / SQLAlchemy） |
| 应用服务器被攻破 | 攻击者可在内存里看到调用方送来的明文 key（请求处理期间） | 最小权限、隔离、及时修补；key 轮换 |
| 前端/客户端泄露 | 把 key 放进浏览器、移动端、仓库 | 只放服务端 secret manager；不入库、不进前端包 |

**可选的纵深防御**：

- **HMAC / pepper**：用服务端保密常数参与哈希，拖库后没有 pepper 无法离线验证猜测；代价是 pepper 泄露与轮换成本（§4.5）。
- **静态加密**：磁盘/备份加密，防「拿走磁盘」，不防 SQL 注入。
- **审计日志**：记录 key 的创建/撤销/使用（脱敏），便于事故追溯。
- **监控**：异常用量、突然的 401 峰值、同一 key 多地域使用。

---

## 9. 传输面：必须 HTTPS

**核心事实**：`X-API-Key` 和 `Authorization` 都是 **HTTP 头**。HTTP 本身是**明文协议**；如果不加 TLS，链路上的任何一跳（Wi-Fi、代理、网关、抓包工具）都能读到 key，并**原样重放**。

- **HTTPS / TLS**（Transport Layer Security）：在 TCP 之上加密整个 HTTP 请求/响应，**包括请求行、头和 body**。它防的是「链路上被看/被改」。
- 本项目本地开发用 `http://127.0.0.1`，是因为流量不出机器；**生产必须 HTTPS**。
- SSE 也是 HTTP 响应，同样需要 TLS；否则流里的内容（可能含用户数据）也会裸奔。

**必须遵守的规则**：

1. **不要把 key 放进 URL 查询串**（`?api_key=...`）。URL 会进入：
   - 服务器/代理的访问日志；
   - 浏览器历史、书签；
   - `Referer` 头（跳到第三方时可能带出去）；
   - 监控/APM 的 URL 维度。
   本项目只用请求头，这是正确做法。
2. **日志脱敏**：反向代理、API 网关、APM 可能默认记录请求头。把 `X-API-Key` / `Authorization` 加入脱敏列表；创建接口的响应体（含一次性 key）不要进 body 日志。
3. **只在服务端使用**：API Key 是**机器凭证**，应该放在服务端的环境变量 / secret manager 里，由后端调用。**不要**把它打进浏览器 JS、移动端包、Electron 客户端——这些环境里的「秘密」都可以被用户提取。
4. **不要让浏览器直连**：如果浏览器需要流式结果，让浏览器调你自己的 **BFF（Backend for Frontend，为前端专门加的一层后端代理）**，由 BFF 持 key 调 `/public/apps/{appId}/run`，再把 SSE 转发给浏览器。`EventSource` 本身也不能带自定义头（见 `04-执行引擎/06-前端SSE客户端与运行面板.md`），这更说明它不适合直接持有 API Key。
5. **校验证书**：客户端不要关闭 TLS 校验（`-k` / `rejectUnauthorized: false`）；生产用受信任 CA，开启 HSTS。
6. **内部跳也要考虑**：TLS 通常在网关终止；网关到应用服务器之间如果是不可信网络，也要加密（mTLS / 内网 TLS），否则 key 在内网段仍可能被嗅探。
7. **轮换与撤销**：HTTPS 只保护「传输中」；如果 key 已经泄露（日志、仓库、截图），传输加密救不了，必须撤销（§7.4）。

**两种头的取舍**：

- `X-API-Key: <key>`：语义明确，专门用于 API Key；本项目优先取它。
- `Authorization: Bearer <key>`：复用标准 Authorization 头，适合某些只允许该头的网关/客户端。
- 两者等价；同时出现时 **`X-API-Key` 优先**。如果 `X-API-Key` 是空/空白，会继续看 `Authorization`。

**取 key 的代码（TS）**：

**完整文件路径：`apps/api-ts/src/public/public.controller.ts`（第 84–97 行，`extractApiKey`）**

```ts
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

| 行 | 代码 | 在做什么 |
| --- | --- | --- |
| 84–87 | 函数签名 | 两个头都可能不存在；返回 `undefined` 表示「未提供」。 |
| 88–91 | `apiKeyHeader?.trim()` + 非空 | `X-API-Key` 去掉首尾空白后非空 → 直接用它（**优先**）。 |
| 92–95 | `authorization?.startsWith('Bearer ')` | 否则看 `Authorization` 是否以 `Bearer ` 开头；取第 7 位之后的 token 并 trim。 |
| 96 | `return undefined` | 两者都没有 → 未提供。 |

**这段在干什么**：用一个明确的优先级（`X-API-Key` > `Authorization: Bearer`）把两种传法归一成一个 `rawKey`；空白值视为未提供，避免「空头」被当成有效输入。

> **细节**：`Bearer ` 的判断是**大小写敏感**的。按 HTTP 规范，认证方案名不区分大小写；因此 `bearer <key>` 在本实现里会被当成「未提供」→ `401 Missing API key`。这是一个小的规范偏差，不影响安全；如果接入方可能发小写，改成正则 `/^Bearer\s+/i` 即可（两端要同时改，保持文案/行为一致）。

---

## 10. 限流：本阶段为什么没做

**限流（rate limiting）**：限制单位时间内的请求数/并发；**令牌桶** 是常见实现——以固定速率往桶里放令牌，每个请求消耗一个，没令牌就拒绝（通常返回 `429 Too Many Requests`）。

**源码事实**：TS 侧在取 key 之后留了一行注释：

**完整文件路径：`apps/api-ts/src/public/public.controller.ts`（第 56 行）**

```ts
    // 生产环境应在此处加限流（按 key / 应用维度），本阶段不实现。
```

Python 侧目前**没有**同款注释，但行为一致：没有任何限流。这是一个「注释缺失」的小不一致，不影响运行。

**为什么不做**：

- 本阶段的重点是「凭证模型 + 认证顺序 + 双后端一致」；限流是横切关注点，需要一个共享的计数器（通常是 Redis），会引入额外依赖与配置。
- 暴力破解**不是**主要理由：128 位随机 key 已经让「猜 key」不可行（§4.3）。限流真正防的是：
  - **泄露后的滥用**：一把泄露的 key 被用来刷 LLM 额度、跑大量任务；
  - **成本攻击**：每次运行都可能调用付费模型/嵌入；
  - **DoS / 噪声邻居**：大量并发把 DB/引擎打满；
  - **异常检测**：突然的调用尖峰、异常 401 峰值。

**生产应该做什么**：

| 维度 | 目的 | 常见做法 |
| --- | --- | --- |
| 按 key | 防单把 key 被滥用；便于配额/计费 | 令牌桶：N 次/分钟、并发 M；超限 `429` + `Retry-After` |
| 按应用 | 防一个应用拖垮整个实例 | 每应用 QPS/并发上限；与应用套餐绑定 |
| 按 IP | 防未认证/无效 key 的洪水 | 在鉴权前做 IP 级限流；注意 NAT 后多人共享 IP |
| 全局 | 保护实例本身 | 全局并发/队列长度上限；过载时快速失败 |
| 成本 | 防额度耗尽 | 按 token/调用计费预算；超预算暂停 |

**顺序与信息泄露**：

- **IP 级限流放在鉴权前**：无效 key 的洪水在进入 DB 前就被挡住。
- **key 级限流放在鉴权后**：只有有效 key 才有「按 key 的桶」。
- **注意不要制造新的 oracle**：如果无效 key 返回 `401`、有效 key 超限返回 `429`，攻击者就能用 `429 vs 401` 判断 key 是否有效。解决方式：
  - 对同一 IP 的请求先做统一限流，超限一律 `429`，不区分 key 有效性；
  - 或者对无效 key 也返回统一的 `429`（在达到阈值后），不要暴露「你通过了鉴权」。
- **分布式限流需要共享状态**：多实例部署时，内存计数器各自为政，实际限额会变成「实例数 × 限额」；用 Redis / 网关集中限流。

> 本阶段没有限流，意味着**任何拿到有效 key 的人都可以按机器速度调用**。这是教学项目的已知边界，不是「安全设计完成」的状态。

---

## 11. 写错会怎样

下面每一条都是**真实会发生的后果**，不是理论恐吓。

| # | 错误写法 | 直接后果 | 为什么会这样 | 正确做法 |
| --- | --- | --- | --- | --- |
| 1 | 把明文 key 存进数据库（加 `key` 列 / 存 JSON） | **拖库即全部泄露**：攻击者拿到可直接使用的 key，不需要破解 | 明文是可逆的、可直接重放的凭证；数据库/备份/注入任一环节泄露都等于交出所有 key | 只存 SHA-256 摘要 + prefix；明文只在创建响应出现一次（§5） |
| 2 | 用 bcrypt 存 API Key | 每次调用多 **44 ms**；1000 req/s 需要约 **45 个核心**；延迟与队列爆炸，形成天然的 DoS 放大 | bcrypt 是为「低频、低熵密码」设计的慢哈希；API Key 是「高频、高熵」凭证，每次请求都验，慢哈希的成本模型不成立 | API Key 用快哈希（SHA-256）；bcrypt 只用于密码（§4） |
| 3 | 用 SHA-256 存密码 | 弱密码可被 GPU **秒级**爆破；彩虹表/字典直接命中；盐和成本因子都缺失 | 密码熵低、会复用；快哈希把「每次猜测」的成本压到极低，离线攻击可行 | 密码用 bcrypt/argon2 + 盐 + 足够成本因子（见 `01-账号与认证/06`）；API Key 才用 SHA-256 |
| 4 | 撤销时物理删除行 | 失去审计与历史；无法回答「何时撤销/是否用过」；误删不可回滚；调用方在响应上只看到 `Invalid API key`，无法区分「拼错」「被撤销/删除」「从未存在」；所有者也失去定位依据 | 删除把「状态」和「证据」一起抹掉；软撤销保留 `revokedAt` 才能审计与恢复 | `revoked_at` 软撤销；列表保留历史；需要清理时按保留期归档（§7） |
| 5 | 对「key 不属于该应用」返回 `403` | **泄露 key 有效性**：403 等于告诉攻击者「这把 key 是真的，只是不属于这个应用」；可被用来验证来路不明的 key、横向探测应用 | 403 的语义是「已认证但无权限」，天然确认了认证成功 | 返回 `401 Invalid API key`，与「key 无效/已撤销」合并；403 留给真正的「已认证但角色不够」场景（§6.5） |
| 6 | 只存/只校验 `prefix`，或按 `prefix` 查 key | 32 位空间可被穷举/碰撞；攻击者伪造一个前缀相同的 key 就可能通过；prefix 不唯一，查库会返回多行 | prefix 是展示标识，不是凭证；它只泄露 32 位，但也只有 32 位 | 认证必须对**完整 key** 做 SHA-256；prefix 只用于展示（§5.4） |
| 7 | 把 key 放进 URL、日志、前端包 | 访问日志/代理/浏览器历史/`Referer`/APM 都可能记录；XSS（跨站脚本）或客户端提取即可拿到；可被重放 | URL 和日志是「默认会被记录」的通道；前端/客户端环境没有真正的秘密 | 只用请求头；日志脱敏；只放服务端 secret manager；浏览器走 BFF（§9） |
| 8 | 遍历所有 key 做 `===` 比较 | O(n) 时间/内存；key 越多越慢；可被大量请求放大成 DoS；提前 `break` 带来时序差异 | 没有利用唯一索引；把「一行查找」退化成「全表扫描」 | 对完整 key 做 SHA-256，按 `key_hash` 唯一索引一次查找（§6.3） |
| 9 | 用 HTTP 明文传输 key | 链路上的 Wi-Fi/代理/网关可读、可改、可重放；SSE 内容也泄露 | HTTP 头不加密；TLS 才加密整个请求 | 生产强制 HTTPS；校验证书；内部跳加密；HSTS（§9） |
| 10 | 撤销后不轮换、不监控 | 泄露的 key 可能已被复制；撤销只挡住「这把」，不挡住已经外流的副本 | 撤销针对的是数据库里的那一行，不针对攻击者手里的副本 | 撤销 + 建新 key + 审计用量 + 排查泄露源（§7.4） |

> 第 1、2、3 条尤其容易「看起来都能用」：本地测试都通过，问题只在拖库、流量上来或密码泄露时才爆发。安全设计要看**最坏情况**，不是看 happy path。

---

## 12. 与 TS 侧的对照

两套后端在**同一张表**上做同一件事，密码学原语必须逐位一致；否则同一把 key 在两端会得到不同哈希，认证直接失败。

### 12.1 密码学原语

| 关注点 | api-ts | api-py | 说明 |
| --- | --- | --- | --- |
| 随机生成 | `randomBytes(16).toString('hex')` | `secrets.token_hex(16)` | 都是 CSPRNG；16 字节 = 128 位 → 32 位十六进制 |
| 摘要 | `createHash('sha256').update(key).digest('hex')` | `hashlib.sha256(key.encode()).hexdigest()` | 同一算法、同一编码（UTF-8）、同一十六进制小写 |
| 前缀 | `key.slice(0, 11)` | `key[:11]` | 都是「前 11 个字符」 |
| 撤销时间 | `new Date()`（Prisma 写 UTC） | `datetime.now(timezone.utc).replace(tzinfo=None)` | 列是 `timestamp(3)` 无时区；Python 写 naive-UTC |
| 时间出参 | `toISOString()` | `iso_z()` | 都是 UTC、毫秒、`Z` 结尾（见 `02-应用管理/07-验收.md`） |
| 唯一索引 | `@unique` → `api_keys_key_hash_key` | `unique=True`（DDL 由 Prisma 拥有） | Python 只映射，不产生 DDL（迁移所有权见 `01-账号与认证/04-SQLAlchemy2.0.md`） |
| 401 | `new UnauthorizedException('Invalid API key')` | `HTTPException(401, detail="Invalid API key")` | 文案由 `error-messages.md` §10 统一 |
| 404 | `new NotFoundException('API key not found')` | `_not_found("API key not found")` | 同上 |
| 创建返回 | `{ ...toApiKeyResponse(created), key }` | `return to_response_fields(api_key), key` | 都是「视图 + 一次性明文」 |

### 12.2 实测：同一把 key，两端哈希一致

```bash
# Node
node -e "const {createHash}=require('node:crypto'); const k='sk-e217e49c78f151618cc8d94a1c6eb7a9'; console.log(k.length, createHash('sha256').update(k).digest('hex'))"

# Python
uv run --project apps/api-py python -c "import hashlib; k='sk-e217e49c78f151618cc8d94a1c6eb7a9'; print(len(k), hashlib.sha256(k.encode()).hexdigest())"
```

**实测输出（两端逐字符相同）**

```
35 6fb128f90ab7145b332b42b928fa82139505409b32db178bf2060c6940c51a1e
35 6fb128f90ab7145b332b42b928fa82139505409b32db178bf2060c6940c51a1e
```

**结果解读**：

- 35 = key 长度；64 = 哈希长度。
- 两端结果一致，所以同一把 key 在 api-ts 落库、在 api-py 认证也能通过（同一张表、同一哈希）。
- 如果一端用了 `sha256(key)`、另一端用了 `sha256(key + salt)`，或用了不同的字符编码/大小写，哈希就会不同，跨后端认证立刻失败。**密码学原语是契约的一部分。**

### 12.3 实现差异（不影响安全语义）

| 点 | TS | Python | 说明 |
| --- | --- | --- | --- |
| 名称校验位置 | DTO（`@IsString` / `@MinLength(1)`）+ 服务层 >60 | 服务层统一做 | 对外顺序一致；见 §5.2 的注 |
| 重名查询 | `findFirst(... select: { id: true })` | `select(ApiKey.id).limit(1)` | 都只取 id |
| 创建返回 | 对象展开 | 二元组 | 路由层负责拼 `key` |
| 限流注释 | 有 TODO 注释 | 无 | 行为一致；注释缺失，建议补上 |
| `Bearer` 解析 | `startsWith('Bearer ')` | `startswith("Bearer ")` | 两端都大小写敏感，见 §9 |

---

## 13. 两端错误文案：9 组逐字节一致

### 13.1 契约原文（逐字照抄）

**完整文件路径：`packages/contract/error-messages.md`（§10）**

```markdown
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
```

### 13.2 9 组对外 / 管理错误

阶段 10 的 API Key 相关接口有 **9 组错误场景**（与 `05-验收.md` 的 L6 完全一致）：

| # | 场景 | HTTP | `error` | `message` | 触发点 |
| --- | --- | --- | --- | --- | --- |
| 1 | 未提供 key | `401` | `Unauthorized` | `Missing API key` | 对外运行，取不到 key |
| 2 | key 不存在（随机串） | `401` | `Unauthorized` | `Invalid API key` | `authenticate` 查不到 |
| 3 | key 已撤销 | `401` | `Unauthorized` | `Invalid API key` | `revokedAt` 非空 |
| 4 | key 属于别的应用（目标 app 存在） | `401` | `Unauthorized` | `Invalid API key` | 鉴权成功但 `appId` 不匹配 |
| 5 | 有效 key，但 `appId` 不存在 | `404` | `Not Found` | `App not found` | 路径 app 不存在 |
| 6 | 有效 key，应用未发布 | `400` | `Bad Request` | `App is not published` | `published_graph_json` 为 null |
| 7 | key 名称 61 字符 | `400` | `Bad Request` | `API key name is too long` | 创建，名称 > 60 |
| 8 | 同名且未撤销 | `400` | `Bad Request` | `API key name already exists` | 创建，同应用同名未撤销 |
| 9 | 撤销不存在 / 别人的 key | `404` | `Not Found` | `API key not found` | `revoke` 查不到或 owner 不匹配 |

> 第 2、3、4 行**故意**共用同一句 `Invalid API key`：key 不存在、已撤销、不属于该应用，在响应上不可区分。这是信息泄露控制（§6.5），不是文案重复的疏忽。
> 计数口径：§10 有 **7 条文案**；其中 `Invalid API key` 被拆成 3 个场景（不存在 / 已撤销 / 不属于该应用），所以是 **7 + 2 = 9 组场景**。

### 13.3 补充：创建接口的三条名称校验

这三条**不计入上面的 9 组**，但创建接口会返回它们，也必须两端一致：

| 场景 | HTTP | `error` | `message` | 触发点 |
| --- | --- | --- | --- | --- |
| `name` 缺失（`{}`）或显式 `null` | `400` | `Bad Request` | `name is required` | 创建（TS 由工厂的 `value === undefined` 分支；Py 由服务层 `if name is None`） |
| `name` 存在但非字符串（如 `{"name":123}`） | `400` | `Bad Request` | `name must be a string` | 创建 |
| `name` 是空串 | `400` | `Bad Request` | `name must be at least 1 characters` | 创建，`{"name":""}` |

> 这三条来自通用校验文案（TS 由 `@IsString` / `@MinLength` 经 `apps/api-ts/src/common/validation-exception-factory.ts` 产生，Python 在服务层复刻）。

> **「完全缺失 `name`」曾两端不一致，现已修复**：修复前 api-ts 返回 `400 name is required`，api-py 返回 `400 name must be a string`（`name` 默认 `None`，服务层 `not isinstance` 命中）。修复点：`apps/api-py/app/api_keys/service.py` 的 `create()` 开头新增 `if name is None: raise _bad_request("name is required")`，依据项目约定「缺失统一报 `{field} is required`」（`/apps`、`/knowledge-bases` 两端一致）。实测两端逐字节相同：`{}` → `{"statusCode":400,"message":"name is required","error":"Bad Request"}`。
> **「非归属应用 + 超长名」两端一致**：`create()` 的超长检查在归属校验**之后**，两端都返回 `404 App not found`（此前误记为 Py 先报 400）。

**错误信封示例（按文案去重）**

> 第 2/3/4 组共用同一个 `Invalid API key` 示例；§13.3 的三条名称校验也一并列出。

```json
{"statusCode":401,"message":"Missing API key","error":"Unauthorized"}
```

```json
{"statusCode":401,"message":"Invalid API key","error":"Unauthorized"}
```

```json
{"statusCode":400,"message":"App is not published","error":"Bad Request"}
```

```json
{"statusCode":404,"message":"App not found","error":"Not Found"}
```

```json
{"statusCode":400,"message":"API key name is too long","error":"Bad Request"}
```

```json
{"statusCode":400,"message":"API key name already exists","error":"Bad Request"}
```

```json
{"statusCode":404,"message":"API key not found","error":"Not Found"}
```

```json
{"statusCode":400,"message":"name is required","error":"Bad Request"}
```

```json
{"statusCode":400,"message":"name must be a string","error":"Bad Request"}
```

```json
{"statusCode":400,"message":"name must be at least 1 characters","error":"Bad Request"}
```

**为什么必须逐字节一致**：

- 同一份契约、同一张表、两套后端；调用方可能今天打 3001、明天打 8000（或做灰度/双写）。
- 如果两端文案不同，调用方的错误处理、前端提示、E2E 断言都会分叉；「契约一致」的验收就失败。
- 错误信封的结构、`Content-Type: application/json; charset=utf-8`、时间格式等也在验收范围内（见 `02-应用管理/07-验收.md`、`07-知识库RAG/05-验收.md` 的 charset 修复）。

---

## 14. 验收自测

下面命令**逐条可复制**。预期值是本地教学环境的实测口径；你的 UUID / 时间会不同。

### C1：key 格式

```bash
KEY_JSON=$(curl -s -X POST "http://127.0.0.1:3001/apps/$APP_ID/api-keys" \
  -H "Authorization: Bearer $TS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"format-check"}')
KEY=$(echo "$KEY_JSON" | python -c "import sys,json;print(json.load(sys.stdin)['key'])")
printf '%s' "$KEY" | wc -c   # 35
printf '%s' "$KEY" | cut -c1-11     # sk-xxxxxxxx
```

**预期**：`wc -c` 为 **35**；前缀为 `sk-` + 8 位十六进制；`key` 只含小写十六进制。

### C2：库里只有哈希

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c \
  "select name, key_prefix, length(key_hash) as hash_len, key_hash
   from api_keys where name = 'format-check'"
```

**预期**：`hash_len = 64`；没有明文列；`key_prefix` 为前 11 字符。

### C3：跨语言摘要一致

```bash
node -e "const {createHash}=require('node:crypto'); console.log(createHash('sha256').update(process.argv[1]).digest('hex'))" "$KEY"
uv run --project apps/api-py python -c "import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$KEY"
```

**预期**：两行完全相同（64 位十六进制小写）。

### C4：明文只返回一次

```bash
# 列表：不应出现 "key" 字段
curl -s "http://127.0.0.1:3001/apps/$APP_ID/api-keys" \
  -H "Authorization: Bearer $TS_TOKEN" | python -m json.tool | grep -c '"key"'
```

**预期**：`0`（列表里没有 `key` 字段；只有 `prefix`）。

### C5：六种认证结果

```bash
# 1) 无 key
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://127.0.0.1:3001/public/apps/$APP_ID/run" \
  -H 'Content-Type: application/json' -d '{"inputs":{}}'

# 2) 无效 key
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://127.0.0.1:3001/public/apps/$APP_ID/run" \
  -H 'X-API-Key: sk-00000000000000000000000000000000' \
  -H 'Content-Type: application/json' -d '{"inputs":{}}'

# 3) 已撤销 key（先撤销上面创建的 key）
# 4) key 属于 A，调 B（B 存在）
# 5) key 属于 A，调一个不存在的 UUID
# 6) key 正确，但应用未发布
```

**预期**：

| 场景 | 状态 | 文案 |
| --- | --- | --- |
| 无 key | `401` | `Missing API key` |
| 无效 key | `401` | `Invalid API key` |
| 已撤销 | `401` | `Invalid API key` |
| 不属于该应用 | `401` | `Invalid API key` |
| 应用不存在 | `404` | `App not found` |
| 应用未发布 | `400` | `App is not published` |

### C6：`lastUsedAt` 的语义

```bash
# 成功调用后
docker exec mini-dify-db psql -U postgres -d minidify -c \
  "select name, last_used_at from api_keys where name = 'format-check'"

# 撤销后再调用（预期 401），再查：last_used_at 不应变化
```

**预期**：成功调用后 `last_used_at` 非空；撤销后调用返回 `401`，`last_used_at` 停在撤销前。

> 另测「鉴权成功但应用未发布」：创建一把属于未发布应用的 key，调用得到 `400`，但 `last_used_at` **会**被刷新。这证明它是「最后鉴权成功」而不是「最后运行成功」。

### C7：9 组文案两端逐字节一致

```bash
BASE_TS=http://127.0.0.1:3001
BASE_PY=http://127.0.0.1:8000

# 以「无 key」为例；其它 8 组按 §13.2 的场景换 URL/方法/body 即可
curl -s "$BASE_TS/public/apps/$APP_ID/run" -X POST \
  -H 'Content-Type: application/json' -d '{"inputs":{}}' > /tmp/ts.json
curl -s "$BASE_PY/public/apps/$APP_ID/run" -X POST \
  -H 'Content-Type: application/json' -d '{"inputs":{}}' > /tmp/py.json

cmp /tmp/ts.json /tmp/py.json && echo "byte-identical"
```

**预期**：输出 `byte-identical`；`cat /tmp/ts.json` 为
`{"statusCode":401,"message":"Missing API key","error":"Unauthorized"}`。

> 两端的 JSON 键顺序、`Content-Type` 的 `charset=utf-8`、时间格式都必须一致；否则 `cmp` 会失败。§13.2 的 9 组全部跑一遍，结果应全部为 `byte-identical`。
> §13.3 的三条名称校验（缺失 / 空串 / 非字符串）要单独跑，两端应全部为 `byte-identical`：`{}` → `name is required`（曾不一致，已修复）、`{"name":""}` → `name must be at least 1 characters`、`{"name":123}` → `name must be a string`。

### C8：软撤销

```bash
docker exec mini-dify-db psql -U postgres -d minidify -c \
  "select name, key_prefix, revoked_at from api_keys where name = 'format-check'"
```

**预期**：行仍在；`revoked_at` 非空；列表接口仍返回该条目（带 `revokedAt` 时间）。

### C9（可选）：本阶段没有限流

```bash
# 小流量验证：连续 20 次无效 key 请求，观察是否出现 429
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    "http://127.0.0.1:3001/public/apps/$APP_ID/run" \
    -H 'X-API-Key: sk-00000000000000000000000000000000' \
    -H 'Content-Type: application/json' -d '{"inputs":{}}'
done | sort | uniq -c
```

**预期**：全部 `401`，没有 `429`。这是已知边界，不是 bug；生产必须补限流（§10）。

---

## 15. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 关闭创建弹窗后，再也找不到明文 key | 库里只有哈希，明文只返回一次；不是 UI 藏起来了 | 重新创建一把，切换调用方后撤销旧的；把「一次性」写进接入文档 |
| 用 `prefix` 拼成完整 key 去调用 | `prefix` 只有 11 字符，不是凭证；认证按完整 key 的哈希匹配 | 从创建响应/secret manager 取完整 key；不要用列表里的 `prefix` 冒充 |
| 复制 key 时多了换行/空格 | shell 变量、剪贴板、文件末尾可能带空白 | 两端都会 `trim()` 头值，但仍建议复制后检查；不要把 key 写进带 BOM 的文件 |
| `X-API-Key` 和 `Authorization` 都带了，结果 401 | `X-API-Key` **优先**；如果它写错了，不会回退到 `Authorization` | 只保留一个头，或确保 `X-API-Key` 正确；空白的 `X-API-Key` 才会回退 |
| 用 `bearer <key>`（小写）被当成没带 key | 实现用 `startsWith('Bearer ')`，大小写敏感 | 用 `Bearer `（首字母大写）；或两端同时改成大小写不敏感 |
| 撤销后 `lastUsedAt` 没更新，以为撤销失败 | 撤销后的请求在鉴权阶段就 401，不会执行更新 | 看 `revokedAt` 是否非空；`lastUsedAt` 停在撤销前是正常现象 |
| 应用未发布，`lastUsedAt` 却有值 | `lastUsedAt` 在鉴权成功后更新，早于发布检查 | 这是「最后鉴权成功」的语义；不要拿它当「最后成功运行」 |
| 拿 A 的 key 调 B，返回 401，但 `lastUsedAt` 更新了 | 鉴权成功、appId 不匹配；更新发生在比对之前 | 同上；轮换时它可以作为「key 仍被使用」的信号 |
| 重名创建在并发下出现两条 | 重名检查是「先查后插」，没有 partial unique index | 生产加 `(app_id, name) WHERE revoked_at IS NULL` 的唯一索引，或事务加锁 |
| 重复撤销同一把 key，`revokedAt` 变了 | `revoke` 没有判断「是否已撤销」，每次都会写当前时间 | 审计上通常可接受；要严格可加 `if (revokedAt === null)` |
| 删除应用后，key 也没了 | `api_keys.app_id` 外键 `ON DELETE CASCADE` | 这是预期行为；删除应用前确认线上是否还在用它的 key |
| 时间显示相差 8 小时 | DB 是 `timestamp` 无时区，Python 写 naive-UTC；前端按本地时区格式化 | 存储/传输统一 UTC，展示层再转本地；见 `02-应用管理/07-验收.md` |
| 把 `404 App not found` 当成「key 无效」 | 404 只在「已通过鉴权、但路径 app 不存在」时出现 | 先确认 key 的 appId 与路径一致；不要用 404/401 去反推 key 有效性 |
| 在浏览器里直接放 API Key | 前端包/DevTools/用户都能提取；XSS 直接读 | 只放服务端；浏览器走 BFF 代理（§9） |
| 通过 HTTP 调用内网服务 | 头是明文，可被嗅探/重放 | 强制 HTTPS；内网也加密；校验证书 |
| 把 key 写进 URL 方便调试 | 访问日志、浏览器历史、`Referer` 都会记录 | 只用 `X-API-Key` / `Authorization` 头 |
| 用 `Math.random()` 生成 key | 不是 CSPRNG，输出可预测 | 用 `crypto.randomBytes` / `secrets.token_hex`（§4.6） |
| 用 bcrypt 存 key，压测时 CPU 打满 | 每次调用 44 ms 慢哈希 | 改用 SHA-256；bcrypt 只给密码（§4） |
| 用 SHA-256 存密码，觉得「加了盐就行」 | 盐只防预计算，不防弱密码的逐用户爆破；SHA-256 太快 | 用 bcrypt/argon2 + 成本因子；密码策略同样重要（§4.2） |
| 只把 key 存在 localStorage 图方便 | 长期留存、XSS 可读、共用电脑泄露 | API Key 不进浏览器；JWT 的存储取舍见 `02-应用管理/06-前端应用列表页.md` |

---

## 16. 安全清单（速查）

- [ ] key 由 **CSPRNG** 生成，至少 **128 位**随机；格式 `sk-` + 32 位十六进制（35 字符）。
- [ ] 数据库只存 **SHA-256 摘要**（64 位十六进制）与 **prefix**；没有明文列。
- [ ] 创建响应是明文唯一一次出现的地方；列表/详情/日志都不返回明文。
- [ ] 列表接口需要 JWT，且只返回当前用户/当前应用自己的 key。
- [ ] 认证按 `key_hash` **唯一索引**一次查找，不遍历、不按 prefix 查。
- [ ] 无效 / 已撤销 / 不属于该应用 → **统一的 `401 Invalid API key`**，不用 403。
- [ ] 先认证、后查应用存在性；未认证者拿不到 404/401 的区分。
- [ ] 错误信封只有 `statusCode` / `message` / `error`，不加 `code` / `reason`。
- [ ] 撤销用 `revoked_at` 软撤销；列表保留历史；撤销立即对**新请求**生效。
- [ ] `lastUsedAt` 语义是「最后鉴权成功」，不是「最后运行成功」；接受写放大或改成节流/异步。
- [ ] 重名检查只针对未撤销的 key；重叠轮换用新名字。
- [ ] 轮换：建新 → 切换 → 观察旧 key 的 `lastUsedAt` → 撤销旧 → 留痕。
- [ ] 生产强制 **HTTPS**；key 只走请求头，不进 URL/日志/前端包。
- [ ] 日志对 `X-API-Key` / `Authorization` / 创建响应体脱敏。
- [ ] 生产补**限流**（按 key / 应用 / IP / 全局）与配额/告警；注意不要制造 429/401 oracle。
- [ ] 数据库最小权限、备份加密、审计 key 的创建/撤销/使用。
- [ ] 泄露预案：先撤销、再新建、再审计；考虑在途 SSE 流的处置。

---

## 17. 小结

1. **哈希选择由攻击模型决定**：密码低熵、复用 → bcrypt/argon2 + 盐；API Key 128 位随机、不复用 → SHA-256。不是「API Key 不重要」。
2. **API Key 的安全性来自生成**：CSPRNG + 128 位；如果让用户自选或用了弱随机，SHA-256 也救不了。
3. **明文只返回一次**：库里只有哈希，技术上取不回；丢失即轮换。
4. **`prefix` 是展示标识，不是凭证**：泄露 32 位、不参与认证、不构成存在性 oracle；不要用它查库或认证。
5. **认证顺序就是信息泄露控制**：先认证、再比对 appId、最后查应用；无效/撤销/错应用统一 `401 Invalid API key`，不用 403。
6. **哈希索引查找是 O(log n) 的一次定位**：不遍历、不逐字符比较；定时攻击在这里不成立，但「成功鉴权更慢」的旁路可以用异步 `lastUsedAt` 抹平。
7. **`lastUsedAt` 是「最后鉴权成功」**：会在 400/401（应用不匹配/未发布）时也刷新；每次请求一次 UPDATE 是写放大，生产应节流/异步。
8. **软撤销优于物理删除**：可审计、可展示历史、可恢复、可轮换；对外仍然是立即 401（对在途流不打断）。
9. **轮换要重叠**：建新 → 切换 → 看旧 key 的 `lastUsedAt` → 撤销旧；不要直接删旧的。
10. **拖库后明文不存在**：哈希不能直接冒用，128 位不可爆破；prefix 只泄露 32 位；真正的风险在备份、日志、内部权限与传输。
11. **传输必须 HTTPS**：头是明文；不进 URL、不进日志、不进前端包；浏览器走 BFF。
12. **本阶段没有限流**：这是明确的边界；生产要按 key / 应用 / IP / 全局补上，并注意不要用 429/401 制造新的 key 有效性 oracle。

---

> **与相邻篇目的分工**：契约字段、四元组与 `apiKeyAuth` 见本阶段 `01-发布语义与API-Key契约.md`；`precheck()`、`runPublished`、双认证头与校验顺序的**实现**见 `03-对外SSE接口与双后端对齐.md`；一次性密钥的**前端 UX**、撤销按钮与 curl 示例见 `04-前端发布面板与调用示例.md`；分层验收见 `05-验收.md`。本篇只负责**凭证安全的设计与论证**。
