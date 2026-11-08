# 02 · API-Key 安全设计（发布与 API）

> 阶段 10 · 第 2 步
>
> 做完：NestJS 的 `ApiKeysModule` 可用——`POST /apps/{id}/api-keys` 生成 key、`GET /apps/{id}/api-keys` 列表、`DELETE /api-keys/{id}` 撤销；服务端只存 `sha256(key)`，明文只在创建响应出现一次。
>
> **本篇面试考点**：为什么用 `randomBytes(16)` 而不是 `uuid()` · 为什么是 `sk-` + 32 hex · 为什么 `prefix` 取 11 字符 · 为什么用 SHA-256 而不是 bcrypt · `findUnique(keyHash)` 为什么依赖唯一索引 · 哈希查找是否还需要恒定时间比较 · 明文 key 的生命周期有几处可能泄露 · 重名规则为什么只算「未撤销」 · 撤销并发窗口 · `lastUsedAt` 为什么是写热点 · 为什么管理接口 404、对外接口 401 · 限流应该放在哪一步。

---

## 1. 这一篇造什么

阶段 10 有四个接口，本篇只做**三个管理接口**：

| 接口 | 鉴权 | 本篇 |
| --- | --- | --- |
| `GET /apps/{id}/api-keys` | JWT | ✅ |
| `POST /apps/{id}/api-keys` | JWT | ✅ |
| `DELETE /api-keys/{id}` | JWT | ✅ |
| `POST /public/apps/{appId}/run` | API Key | 03 篇 |

```text
调用者（JWT）                      ApiKeysService                 PostgreSQL
    │                                    │                          │
    ├─ POST /apps/{id}/api-keys ────────→│ 1. 校验应用归属 ────────→│ apps
    │                                    │ 2. 校验名称长度            │
    │                                    │ 3. 查未撤销的重名 ──────→│ api_keys
    │                                    │ 4. 生成 key                │
    │                                    │ 5. 存 sha256(key) ──────→│ api_keys
    │←──── 201 { ..., key } ─────────────│    （明文只在内存里）      │
    │                                    │                          │
    ├─ GET /apps/{id}/api-keys ─────────→│ 查全部（含已撤销）───────→│
    │←──── 200 { items:[...] } ──────────│    （不含明文）            │
    │                                    │                          │
    └─ DELETE /api-keys/{id} ───────────→│ 置 revoked_at ──────────→│
         ←──── 204 ──────────────────────│                          │
```

---

## 2. 十条安全决策

| # | 决策 | 理由 |
| --- | --- | --- |
| 1 | key 用 `randomBytes(16)` 生成 | 128 bit 密码学随机数，不依赖时间/自增 |
| 2 | 格式 `sk-` + 32 hex（35 字符） | 有前缀便于识别；定长便于校验 |
| 3 | 只存 `sha256(key)` | 拖库拿不到可用 key |
| 4 | `prefix` 取前 11 字符 | `sk-` + 8 hex，够辨识；剩余 96 bit 熵 |
| 5 | 明文只返回一次 | 服务端没有「再显示一次」的能力 |
| 6 | `key_hash` 唯一 | `findUnique` 依赖唯一索引；兜底防重复 |
| 7 | 重名只算未撤销的 | 撤销后可复用同名，便于轮换 |
| 8 | 撤销置 `revoked_at` | 可审计；列表可见历史 |
| 9 | 归属校验统一 404 | 不泄露「应用/key 是否存在」 |
| 10 | `lastUsedAt` 认证通过后更新 | 给管理界面「最近使用」；接受写放大 |

第 1、3、5、7 条在本篇有完整实现；第 8、10 条在 03 篇对外运行时才会真正被调用。

---

## 3. 文件地图

```text
apps/api-ts/src/
├── api-keys/
│   ├── dto/create-api-key.dto.ts     ← 请求体校验（本篇 §4）
│   ├── api-keys.service.ts           ← 生成 / 哈希 / 列表 / 撤销 / 认证（本篇 §5）
│   ├── api-keys.controller.ts        ← 3 个管理接口（本篇 §6）
│   └── api-keys.module.ts            ← 模块接线，导出 Service 给 PublicModule（本篇 §7）
├── app.module.ts                     ← 注册 ApiKeysModule（本篇 §7.2）
└── public/                           ← 对外运行（03 篇）
```

---

## 4. DTO：为什么不在 DTO 上写 `@MaxLength(60)`

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
  /** 名称：必须是字符串，至少 1 个字符（按码点计） */
  @IsString()
  @MinLength(1)
  name!: string
}
```

为什么长度上限不放在 DTO：

```text
DTO 校验失败
   ↓
ValidationPipe.exceptionFactory
   ↓
通用文案：name must be at most 60 characters     ← 与契约 §10 不一致

服务层校验失败
   ↓
BadRequestException('API key name is too long')   ← 契约 §10 指定文案
```

两条路径都能返回 400，但**文案不同**。契约要求同一场景两端逐字节一致，所以只能让「过长」走服务层。

那 `@MinLength(1)` 为什么可以留在 DTO：

- 它对应的通用文案 `name must be at least 1 characters` 是项目全局约定（与 `/apps`、`/knowledge-bases` 一致），契约 §10 没有为「空名称」单独规定文案；
- 也就是说：**§10 没有覆盖的场景走通用文案，§10 覆盖的场景走专用文案**。

> **面试考点 · 校验应该放在 DTO 还是 Service？**
> 判断标准不是「哪层更优雅」，而是**错误文案归谁定义**：
>
> - 通用规则（类型、必填、最小长度）→ DTO，走全局 `ValidationPipe`；
> - 业务规则（重名、状态、跨表归属）→ Service，因为 DTO 拿不到数据库；
> - 契约对某个场景规定了专用文案 → 必须放在能抛该文案的那一层。
>
> 同一字段的规则被拆到两层，不是设计缺陷，而是**文案契约优先**的结果。

---

## 5. Service：生成、哈希、列表、撤销、认证

**完整文件路径：`apps/api-ts/src/api-keys/api-keys.service.ts`**

### 5.1 常量与返回类型

```ts
import { createHash, randomBytes } from 'node:crypto'

import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import type { ApiKeyListResponse, ApiKeyResponse, CreateApiKeyResponse } from '@mini-dify/contract'

import { PrismaService } from '../prisma/prisma.service'

/** key 名称长度上限（字符数，契约 `CreateApiKeyRequest.name.maxLength`）。 */
const MAX_API_KEY_NAME_LENGTH = 60

/** `prefix` 长度：明文 key 的前 11 个字符（`sk-` + 8 位十六进制）。 */
const KEY_PREFIX_LENGTH = 11

/** 认证通过后对外运行需要的归属信息。 */
export interface AuthenticatedApiKey {
  /** key 所属应用：对外运行会拿它与路径里的 appId 比对 */
  appId: string
  /** key 所属用户：保留给审计 / 后续限流使用 */
  ownerId: string
}
```

`node:crypto` 的两个函数分工：

| 函数 | 用途 | 为什么是它 |
| --- | --- | --- |
| `randomBytes(16)` | 生成 128 bit 随机数 | 密码学安全伪随机（CSPRNG）；`Math.random()` 可预测 |
| `createHash('sha256')` | 计算哈希 | 定长 64 hex；同一输入永远同一输出，可按索引查找 |

### 5.2 `create`：先校验，再生成，最后只返回一次明文

```ts
/**
 * API Key（阶段 10）读写与校验。
 *
 * 安全要点：
 * - **只存哈希**：`sha256(key)` 落 `key_hash`；明文只在创建响应里返回一次。
 * - `prefix` 只用于辨识（列表展示），泄露它无法还原 key。
 * - 撤销只置 `revokedAt`，不物理删除；已撤销的 key 立即失效（无宽限期）。
 *
 * 归属校验与 `/apps` 一致：查不到、或不属于当前用户，一律 404（不泄露存在性）。
 */
@Injectable()
export class ApiKeysService {
  /** `PrismaService` 由全局 `PrismaModule` 提供 */
  constructor(private readonly prisma: PrismaService) {}

  /** POST /apps/{id}/api-keys：校验归属 → 同名检查 → 生成并保存（返回一次性明文 key）。 */
  async create(ownerId: string, appId: string, name: string): Promise<CreateApiKeyResponse> {
    // 1. 应用必须存在且属于当前用户；否则 404 `App not found`
    await this.assertAppOwned(ownerId, appId)

    // 2. 名称长度按码点计（与契约 maxLength 一致）；超长走 §10 专用文案
    if ([...name].length > MAX_API_KEY_NAME_LENGTH) {
      throw new BadRequestException('API key name is too long')
    }

    // 3. 只有「未撤销」的重名才算冲突：撤销后可复用同名，便于轮换
    const duplicate = await this.prisma.apiKey.findFirst({
      where: { appId, name, revokedAt: null },   // revokedAt: null = 只看未撤销
      select: { id: true },                      // 只查主键，不取整行
    })
    if (duplicate !== null) {
      throw new BadRequestException('API key name already exists')
    }

    // 4. 生成明文 key：`sk-` + 32 位十六进制（16 字节 = 128 bit）
    const key = `sk-${randomBytes(16).toString('hex')}`

    // 5. 落库：只存 prefix 与哈希，明文不写数据库
    const created = await this.prisma.apiKey.create({
      data: {
        appId,
        ownerId,
        name,
        keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),   // 前 11 字符
        keyHash: hashKey(key),                        // 64 位十六进制
      },
    })

    // 6. 唯一的明文出口：在响应里附带 `key`
    return { ...toApiKeyResponse(created), key }
  }
}
```

#### 5.2.1 为什么是 `randomBytes(16)`

| 生成方式 | 熵 | 可预测性 | 能否作为凭证 |
| --- | --- | --- | --- |
| `Date.now()` | 毫秒级 | 极高 | ❌ |
| 自增 id | 0 | 完全可枚举 | ❌ |
| `Math.random()` | 约 52 bit | 伪随机，状态可反推 | ❌ |
| `randomBytes(16)` | **128 bit** | CSPRNG | ✅ |

128 bit 意味着即使每秒尝试 $10^9$ 个 key，穷举期望时间也远超宇宙年龄。**key 的安全性来自熵，不来自哈希算法**。

#### 5.2.2 为什么是 `sk-` + 32 hex

```text
sk- 1a2b3c4d5e6f7890a1b2c3d4e5f67890
└┬┘ └──────────────┬──────────────┘
 │                 │
 │                 └─ 32 个十六进制字符 = 16 字节 = 128 bit
 └─ 固定前缀：让人一眼看出这是 secret key
```

- `sk-` 是行业惯例（`sk` = secret key），便于日志/代码中识别；
- 32 hex 是 `randomBytes(16)` 的自然十六进制表示，不需要额外编码（base64 会带 `+/=`，放进 header 要转义）；
- 总长固定 35 字符，便于前端和文档展示。

#### 5.2.3 为什么 `prefix` 是前 11 字符

```text
明文 key：  sk-1a2b3c4d 5e6f7890a1b2c3d4e5f67890
            └────┬────┘
                 └─ prefix = 11 字符（sk- + 8 hex）

剩余部分：  24 个 hex 字符 = 96 bit 熵
```

`prefix` 的用途是**列表辨识**：同一个应用下有三把 key，用户需要知道哪把是「生产」、哪把是「测试」。只显示 id 不够直观，显示完整 key 又等于泄露。

11 字符是折中：

- 太短（如前 6 字符）：多把 key 可能前缀相同，辨识度不够；
- 太长（如前 30 字符）：泄露后剩余熵太少，接近泄露完整 key；
- 11 字符：`sk-` + 8 hex，碰撞概率低，剩余 96 bit 仍不可爆破。

> `prefix` 是**明文的前缀**，不是哈希的前缀。它不参与认证，认证只查 `key_hash`。

#### 5.2.4 重名规则：只算「未撤销」

```text
应用 A 下已有：
  name = "prod", revoked_at = null      ← 占用中
  name = "test", revoked_at = 2026-..   ← 已撤销

再创建 "prod" → 400 API key name already exists
再创建 "test" → 201（允许复用）
```

为什么允许复用已撤销的名字：

- 轮换场景：`prod` 泄露 → 撤销旧的 → 立刻新建一把也叫 `prod`；
- 如果连已撤销的也算重名，用户只能起 `prod-2`、`prod-3`，名字越来越乱；
- 审计不受影响：两行都在表里，靠 `id` / `createdAt` / `revokedAt` 区分。

### 5.3 `list`：含已撤销，不含明文

```ts
  /** GET /apps/{id}/api-keys：返回全部 key（**含已撤销的**），不含明文。 */
  async list(ownerId: string, appId: string): Promise<ApiKeyListResponse> {
    // 先校验归属：应用不存在 / 不属于当前用户 → 404
    await this.assertAppOwned(ownerId, appId)

    // 不过滤 revokedAt：已撤销的也要返回，前端用它渲染「已撤销」标签
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { appId },
      orderBy: { createdAt: 'desc' },            // 最近创建的排前面
    })

    // toApiKeyResponse 只挑契约字段：没有 keyHash，也没有明文 key
    return { items: apiKeys.map((apiKey) => toApiKeyResponse(apiKey)) }
  }
```

返回体里**没有** `keyHash`，也没有 `key`：

```text
数据库行：{ id, appId, ownerId, name, keyPrefix, keyHash, createdAt, lastUsedAt, revokedAt }
                ↓ toApiKeyResponse
响应字段：{ id, appId, name, prefix, createdAt, lastUsedAt, revokedAt }
                              ↑
                     keyPrefix → prefix（改名）
                     keyHash / ownerId 被丢弃
```

> **面试考点 · 为什么列表不返回 `keyHash`？**
> 哈希本身不能直接当 key 用，但泄露哈希会扩大攻击面：
>
> - 攻击者可以离线比对「某个猜测的 key 的哈希是否等于库里的值」；
> - 虽然 128 bit 随机数不可爆破，但**没有理由把内部校验字段暴露给前端**。
>
> 原则：**响应只包含调用者需要的字段**，不是「数据库有什么就返回什么」。

### 5.4 `revoke`：软删除

```ts
  /** DELETE /api-keys/{id}：撤销（置 `revokedAt`），找不到/不属于自己一律 404。 */
  async revoke(ownerId: string, id: string): Promise<void> {
    // 按主键查；不存在 → 404
    const apiKey = await this.prisma.apiKey.findUnique({ where: { id } })

    // 存在但不属于当前用户 → 也返回 404（不泄露「这把 key 存在」）
    if (apiKey === null || apiKey.ownerId !== ownerId) {
      throw new NotFoundException('API key not found')
    }

    // 软删除：只置时间，不 DELETE
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    })
  }
```

两个实现细节：

1. **先查后写，不在 `update` 里做条件更新**
   当前实现是 `findUnique` + `update` 两条 SQL。并发下如果 key 在两步之间被删除（本项目没有物理删除，所以不会发生），`update` 会抛 `P2025`。本阶段可以接受。

2. **重复撤销会覆盖 `revokedAt`**
   对同一把 key 调两次 `DELETE`，第二次仍然 204，但 `revokedAt` 会被刷新为第二次的时间。如果要求「第一次撤销时间不可变」，应在 `update` 前判断 `revokedAt !== null` 直接返回。本阶段不处理。

> **面试考点 · 为什么撤销不是 `DELETE FROM api_keys`？**
> 三个原因：
>
> 1. **审计**：要回答「这把 key 什么时候签发、什么时候撤销、有没有被用过」；
> 2. **列表可追溯**：前端要展示「已撤销」的历史记录；
> 3. **误删恢复**：物理删除后无法恢复；软删除至少还能在库里查到。
>
> 代价是表会增长。生产环境需要归档策略（比如把 `revoked_at` 超过 90 天的行移到冷表），本阶段不做。

### 5.5 `authenticate`：03 篇的入口，本篇先定义

```ts
  /**
   * 校验明文 key（对外运行用）：哈希匹配且未撤销才算通过。
   * 命中后顺手更新 `lastUsedAt`，返回该 key 所属的应用与用户。
   */
  async authenticate(rawKey: string): Promise<AuthenticatedApiKey> {
    // 1. 对明文做 SHA-256，按唯一索引精确查找
    const found = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashKey(rawKey) },
      select: { id: true, appId: true, ownerId: true, revokedAt: true },
    })

    // 2. 查不到 / 已撤销 → 同一个 401 文案（不区分「不存在」与「已撤销」）
    if (found === null || found.revokedAt !== null) {
      throw new UnauthorizedException('Invalid API key')
    }

    // 3. 认证通过：刷新最近使用时间（给管理界面展示）
    await this.prisma.apiKey.update({
      where: { id: found.id },
      data: { lastUsedAt: new Date() },
    })

    // 4. 返回归属信息；路径里的 appId 由调用方（PublicController）比对
    return { appId: found.appId, ownerId: found.ownerId }
  }
```

注意第 3 步与第 4 步的顺序：**先更新 `lastUsedAt`，再由调用方比对 `appId`**。这意味着「拿 A 的 key 调 B 应用」也会刷新 A 的 `lastUsedAt`。这是当前实现的行为，03 篇会展开。

#### 为什么用 `findUnique({ where: { keyHash } })`

`findUnique` 要求 `where` 里的字段是**唯一字段**。Prisma 能在类型层面接受 `keyHash`，正是因为 schema 里有：

```prisma
keyHash String @unique @map("key_hash")
```

生成的 SQL 是：

```sql
SELECT id, app_id, owner_id, revoked_at
FROM api_keys
WHERE key_hash = $1
LIMIT 1;
```

走 `api_keys_key_hash_key` 唯一索引，复杂度 O(log n)。

如果不用唯一索引，只能：

```ts
// ❌ 错误做法：全表扫描 + 逐行比较
const all = await this.prisma.apiKey.findMany()
const found = all.find((row) => row.keyHash === hashKey(rawKey))
```

问题：

- O(n) 全表扫描；
- 把所有 key 的哈希加载进内存；
- 无法利用数据库索引；
- 并发下没有「唯一命中」的保证。

#### 哈希查找还需要恒定时间比较吗

不需要额外实现 `timingSafeEqual`，原因：

1. 比较的是 **SHA-256 之后的哈希**，不是明文。攻击者无法通过「前缀匹配了多少位」来逐位猜 key——SHA-256 的雪崩效应让输入差 1 bit，输出完全不同；
2. 数据库 B 树查找的耗时与「是否命中」只有极微小的差异，且被网络抖动淹没；
3. key 是 128 bit 随机数，时序攻击的前提（攻击者能控制前缀并观察逐位比较时间）不成立。

**如果**实现是 `storedKey === rawKey`（直接比较明文），才需要担心 `===` 的短路时序；本项目从设计上就避免了这种比较。

### 5.6 辅助函数

```ts
  /** 校验应用存在且属于当前用户；否则 404 `App not found`。 */
  private async assertAppOwned(ownerId: string, appId: string): Promise<void> {
    // 只查 ownerId 一列，不取整行
    const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { ownerId: true } })
    // 不存在 / 不属于自己：统一 404（不泄露存在性）
    if (app === null || app.ownerId !== ownerId) {
      throw new NotFoundException('App not found')
    }
  }
}

/** `sha256(明文 key)` 的十六进制摘要（64 字符）。 */
function hashKey(key: string): string {
  // update 接受 string（默认 utf8）；digest('hex') 输出小写十六进制
  return createHash('sha256').update(key).digest('hex')
}

/** 对外视图：`prefix` 而非 key；时间统一为 UTC ISO-8601。 */
function toApiKeyResponse(apiKey: {
  id: string
  appId: string
  name: string
  keyPrefix: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}): ApiKeyResponse {
  return {
    id: apiKey.id,
    appId: apiKey.appId,
    name: apiKey.name,
    prefix: apiKey.keyPrefix,                    // 字段改名：keyPrefix → prefix
    createdAt: apiKey.createdAt.toISOString(),   // UTC + 毫秒 + Z
    lastUsedAt: apiKey.lastUsedAt === null ? null : apiKey.lastUsedAt.toISOString(),
    revokedAt: apiKey.revokedAt === null ? null : apiKey.revokedAt.toISOString(),
  }
}
```

`toApiKeyResponse` 的入参类型是**手写的结构类型**，不是 Prisma 生成的 `ApiKey`：

- 好处：函数只依赖它真正用到的字段，测试时可以传普通对象；
- 代价：Prisma 模型新增字段时不会自动同步——但这里本来就要「白名单式」输出，不同步反而是保护。

---

## 6. Controller：三个管理接口

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
@Controller()                                   // 无前缀：同一控制器挂两个资源前缀
@UseGuards(JwtAuthGuard)                        // 整个控制器都要 JWT
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  /** GET /apps/{id}/api-keys：列表（含已撤销，不含明文） */
  @Get('apps/:id/api-keys')
  list(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<ApiKeyListResponse> {
    // payload.sub 是 JWT 里的用户 id；绝不从 query/body 取 ownerId
    return this.apiKeysService.list(payload.sub, id)
  }

  /** POST /apps/{id}/api-keys：创建（201，响应含一次性明文 key） */
  @Post('apps/:id/api-keys')
  create(
    @CurrentUser() payload: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreateApiKeyResponse> {
    // NestJS 对 POST 默认返回 201，无需额外装饰器
    return this.apiKeysService.create(payload.sub, id, dto.name)
  }

  /** DELETE /api-keys/{id}：撤销（204，无响应体） */
  @Delete('api-keys/:id')
  @HttpCode(204)                                // DELETE 默认 200，契约要求 204
  async revoke(@CurrentUser() payload: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.apiKeysService.revoke(payload.sub, id)
  }
}
```

三个细节：

1. **`@Controller()` 不写前缀**
   项目里其他控制器通常写 `@Controller('apps')`，然后 `@Get(':id')`。这里一个控制器要同时挂 `/apps/{id}/api-keys` 和 `/api-keys/{id}` 两个**不同的一级资源**，所以用无前缀 + 完整路径。

2. **`@CurrentUser()` 而不是 `@Body()`**
   `ownerId` 永远来自 JWT 的 `sub`。如果从请求体取，调用者可以伪造 `ownerId` 越权。这与阶段 2 的应用归属校验是同一原则。

3. **`@HttpCode(204)` 必须显式写**
   NestJS 的 `DELETE` 默认返回 `200`。契约要求 `204 No Content`，不写装饰器就会多一个 `{}` 响应体，前端/测试都会对不上。

---

## 7. 模块接线

### 7.1 `ApiKeysModule`

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
  imports: [AuthModule],              // JwtAuthGuard 依赖 JwtService，必须导入 AuthModule
  controllers: [ApiKeysController],   // 3 个管理接口
  providers: [ApiKeysService],        // 生成 / 列表 / 撤销 / 认证
  exports: [ApiKeysService],          // 给 PublicModule 用，避免重复实例
})
export class ApiKeysModule {}
```

为什么 `imports: [AuthModule]`：

```text
ApiKeysController
   └─ @UseGuards(JwtAuthGuard)
          └─ JwtAuthGuard 构造器注入 JwtService
                 └─ JwtService 由 AuthModule 提供
```

NestJS 的模块是封闭的：不 import `AuthModule`，`JwtAuthGuard` 在 `ApiKeysModule` 的上下文里解析不到依赖，启动会报 `Nest can't resolve dependencies of the JwtAuthGuard`。

为什么 `exports: [ApiKeysService]`：

- `PublicModule` 的 `PublicController` 也要用 `authenticate`；
- 导出后两个模块共享**同一个 provider 实例**（NestJS 默认单例），不会创建两份；
- 如果 `PublicModule` 自己 `providers: [ApiKeysService]`，会得到另一个实例——虽然无状态，但依赖图会变得混乱。

### 7.2 根模块注册

**完整文件路径：`apps/api-ts/src/app.module.ts`**（阶段 10 增量）

```ts
import { ApiKeysModule } from './api-keys/api-keys.module'
import { PublicModule } from './public/public.module'

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AppsModule,
    GraphModule,
    EngineModule,
    ToolsModule,
    KbModule,
    ConversationsModule,
    ApiKeysModule,      // 阶段 10：API Key 管理
    PublicModule,       // 阶段 10：对外运行
    AgentModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
```

`PrismaModule` 没有出现在 `ApiKeysModule` 的 `imports` 里，是因为它是 `@Global()` 模块（阶段 1 已设置）。全局模块只需在根模块注册一次，其他模块可以直接注入 `PrismaService`。

---

## 8. 安全细节

### 8.1 明文 key 的生命周期

```text
randomBytes(16)
   ↓
key = "sk-..."                    ← 只在 create() 的局部变量里
   ↓
key.slice(0, 11)  → key_prefix    ← 落库（可公开）
key              → 响应 body      ← 只此一次
sha256(key)      → key_hash       ← 落库（不可逆）
   ↓
函数返回 → 局部变量 key 被 GC     ← 内存中也不保留
```

四处可能泄露，逐一看：

| 位置 | 风险 | 本项目的处理 |
| --- | --- | --- |
| 数据库 | 拖库 | 只存哈希，不存明文 |
| 应用日志 | `console.log(created)` | 不加日志；NestJS 默认不打印响应体 |
| 错误信息 | 异常里带 key | `authenticate` 的错误文案固定为 `Invalid API key`，不回显输入 |
| 前端 | 刷新后再次显示 | 只显示一次；刷新只能重新创建 |

> **面试考点 · 为什么不能「加密存储、需要时解密」？**
> 因为服务端**永远不需要**知道明文 key：
>
> - 认证是「拿请求里的 key 算哈希，与库里的哈希比」；
> - 不需要把库里的值还原成明文；
> - 加密存储意味着密钥管理、轮换、泄露后全量重加密——复杂度高，收益为零。
>
> **不可逆存储（哈希）比可逆存储（加密）更适合凭证校验**。

### 8.2 错误信息与信息泄露

| 场景 | 返回 | 是否泄露 |
| --- | --- | --- |
| 管理接口：应用不存在 | 404 `App not found` | 不泄露（与「不属于你」同一文案） |
| 管理接口：应用不属于你 | 404 `App not found` | 不泄露 |
| 管理接口：key 不存在 | 404 `API key not found` | 不泄露（与「不属于你」同一文案） |
| 管理接口：重名 | 400 `API key name already exists` | 泄露「同名 key 存在」——但调用者已是应用所有者，可接受 |
| 对外接口：没带 key | 401 `Missing API key` | 不泄露 |
| 对外接口：key 无效 / 已撤销 | 401 `Invalid API key` | 不泄露（两者同一文案） |

原则：

- **对外接口**：任何「key 不对」的情况都收敛成同一个 401，不给攻击者区分「不存在 / 已撤销 / 不属于该应用」的信号；
- **管理接口**：调用者已经通过 JWT 认证，且是资源所有者，可以给出更具体的业务文案（重名、过长）。

### 8.3 `lastUsedAt` 的写放大

`authenticate` 每次成功都执行：

```sql
UPDATE api_keys SET last_used_at = $1 WHERE id = $2;
```

高频调用下的问题：

- 同一行被反复更新 → 行锁竞争；
- PostgreSQL 的 MVCC 会产生大量死元组，需要 autovacuum 清理；
- 这个字段只用于「展示最近使用时间」，精度要求很低。

优化方向（本阶段不做）：

| 方案 | 做法 |
| --- | --- |
| 采样更新 | 只有 `now - lastUsedAt > 1 分钟` 才更新 |
| 异步批量 | 把 `(keyId, timestamp)` 丢进队列，定时批量写 |
| 降级为日粒度 | 只记录日期，不记录毫秒 |

> **面试考点 · 为什么「读接口」会写库？**
> 因为 `lastUsedAt` 是**读时产生的副作用**。这类字段要单独评估：
>
> - 它不影响业务正确性，可以容忍丢失/延迟；
> - 它是高频写，不能和核心写路径一个待遇；
> - 最合适的做法是「异步、采样、可丢」。

### 8.4 撤销与认证的并发窗口

```text
T1（对外运行）                      T2（撤销）
   │                                  │
   ├─ SELECT ... revoked_at IS NULL   │
   │  → 命中，未撤销                   │
   │                                  ├─ UPDATE revoked_at = now()
   │                                  │  → 提交
   ├─ UPDATE last_used_at             │
   ├─ 继续执行图 ─────────────────────→ 这一次调用成功
```

结果：撤销提交后，仍可能有**一次**正在进行的调用成功。这是 `READ COMMITTED` 隔离级别的正常现象，不是 bug。

如果要求「撤销后零调用」，需要：

- 认证时 `SELECT ... FOR UPDATE` 锁行，撤销也锁同一行（串行化）；
- 或者维护一个「已撤销 key」的内存缓存，每请求检查；
- 代价是吞吐下降。

本阶段接受这个窗口：撤销的语义是「之后的调用失败」，不是「立刻中断正在跑的调用」。

### 8.5 限流应该放在哪一步

当前 `authenticate` 的固定成本：

```text
1 次 SHA-256（CPU）
1 次唯一索引查询（DB）
1 次 UPDATE last_used_at（DB 写）
```

没有限流时，攻击者可以用：

- 无效 key 高频请求 → 每次都打一次 DB 查询；
- 有效 key 高频请求 → 每次都打一次 DB 写。

生产建议：

| 位置 | 限流维度 | 目的 |
| --- | --- | --- |
| 最外层（网关 / 中间件） | IP | 挡无差别洪水 |
| `authenticate` 之前 | key 前缀 / 原始 key | 挡单 key 滥用 |
| 执行图之前 | appId / ownerId | 挡单应用耗尽 LLM 配额 |

本项目在 `PublicController` 里留了注释，但**没有实现**——这是阶段 10 的明确边界。

---

## 9. 验证

> 本篇只验证三个管理接口。`authenticate` 与对外运行在 03 篇验证。
> 命令都在仓库根目录执行；先确保 `docker compose ps` 里数据库是 `healthy`，api-ts 监听 `:3001`。

### 9.1 启动

```powershell
pnpm --filter @mini-dify/api-ts start:dev
```

启动日志里应该能看到 `ApiKeysController` 的路由映射（`/apps/:id/api-keys`、`/api-keys/:id`）。

### 9.2 创建：201 + 一次性明文

```powershell
# 登录取 token
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType "application/json" `
  -Body '{"email":"alice@example.com","password":"password123"}'
$token = $login.accessToken

# 建一个测试应用
$app = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/apps `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"name":"key-demo"}').id

# 创建 key
$created = Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/$app/api-keys" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"name":"demo-key"}'

$created | ConvertTo-Json
```

预期：

```json
{
  "id": "…",
  "appId": "…",
  "name": "demo-key",
  "prefix": "sk-1a2b3c4d",
  "createdAt": "2026-…Z",
  "lastUsedAt": null,
  "revokedAt": null,
  "key": "sk-1a2b3c4d5e6f7890a1b2c3d4e5f67890"
}
```

逐项断言：

```powershell
$created.key.Length                          # 35
$created.prefix.Length                       # 11
$created.key.StartsWith('sk-')               # True
$created.prefix -eq $created.key.Substring(0, 11)   # True
$created.lastUsedAt                          # 空（null）
$created.revokedAt                           # 空（null）
```

### 9.3 数据库：没有明文，只有 64 位哈希

```powershell
docker compose exec -T db psql -U mini_dify -d mini_dify -c `
  "SELECT id, name, key_prefix, length(key_hash) AS hash_len, revoked_at FROM api_keys WHERE app_id = '$app';"
```

预期：

```text
                  id                  |   name    |  key_prefix  | hash_len | revoked_at
--------------------------------------+-----------+--------------+----------+------------
 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx | demo-key  | sk-1a2b3c4d  |       64 |
```

`hash_len = 64` 说明存的是 `sha256` 的十六进制摘要；表中**没有** `key` 列。

### 9.4 列表：不含 `key`

```powershell
$list = Invoke-RestMethod -Method Get -Uri "http://localhost:3001/apps/$app/api-keys" `
  -Headers @{ Authorization = "Bearer $token" }

$list | ConvertTo-Json -Depth 5

# 断言：条目里没有 key / keyHash 字段
$list.items[0].PSObject.Properties.Name -contains 'key'       # False
$list.items[0].PSObject.Properties.Name -contains 'keyHash'   # False
```

预期：`items` 里每条包含 `id, appId, name, prefix, createdAt, lastUsedAt, revokedAt`。

### 9.5 重名：未撤销才算冲突

```powershell
# 同名、未撤销 → 400 API key name already exists
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/$app/api-keys" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" `
    -Body '{"name":"demo-key"}'
} catch {
  $_.ErrorDetails.Message
}
```

预期：

```json
{"statusCode":400,"message":"API key name already exists","error":"Bad Request"}
```

### 9.6 名称长度与空名

```powershell
# 61 个字符 → 400 API key name is too long（服务层 §10 文案）
$long = 'x' * 61
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/$app/api-keys" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" `
    -Body (@{ name = $long } | ConvertTo-Json)
} catch {
  $_.ErrorDetails.Message
}

# 空串 → 400 name must be at least 1 characters（DTO 通用文案）
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/$app/api-keys" `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType "application/json" `
    -Body '{"name":""}'
} catch {
  $_.ErrorDetails.Message
}
```

两条文案不同，是**有意**的：

- 空名不在 §10 的专用文案范围内 → 走全局 `@MinLength(1)` 文案；
- 过长在 §10 有专用文案 → 必须走服务层。

### 9.7 越权：统一 404

```powershell
# bob 的 token 访问 alice 的应用
$bob = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login `
  -ContentType "application/json" `
  -Body '{"email":"bob@example.com","password":"password123"}').accessToken

try {
  Invoke-RestMethod -Method Get -Uri "http://localhost:3001/apps/$app/api-keys" `
    -Headers @{ Authorization = "Bearer $bob" }
} catch {
  $_.ErrorDetails.Message
}
```

预期：404 `App not found`（不是 403，也不是「不属于你」）。

### 9.8 撤销：204 + 软删除 + 可复用同名

```powershell
# 撤销
$status = (Invoke-WebRequest -Method Delete -Uri "http://localhost:3001/api-keys/$($created.id)" `
  -Headers @{ Authorization = "Bearer $token" }).StatusCode
$status        # 204

# 列表里仍然能看到它，revokedAt 非空
$list = Invoke-RestMethod -Method Get -Uri "http://localhost:3001/apps/$app/api-keys" `
  -Headers @{ Authorization = "Bearer $token" }
$list.items | Where-Object { $_.id -eq $created.id } | Select-Object id, prefix, revokedAt

# 同名可以再次创建（旧的已撤销，不算冲突）
$created2 = Invoke-RestMethod -Method Post -Uri "http://localhost:3001/apps/$app/api-keys" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"name":"demo-key"}'
$created2.id -ne $created.id       # True：两把不同的 key
```

### 9.9 撤销不存在 / 不属于自己的 key

```powershell
# 不存在的 id → 404 API key not found
try {
  Invoke-RestMethod -Method Delete -Uri "http://localhost:3001/api-keys/not-exist" `
    -Headers @{ Authorization = "Bearer $token" }
} catch {
  $_.ErrorDetails.Message
}
```

预期：404 `API key not found`。

---

## 10. 面试考点汇总

| 问题 | 答案要点 |
| --- | --- |
| key 为什么用 `randomBytes(16)` | CSPRNG，128 bit 熵；`Math.random()` 可预测 |
| 为什么是 35 字符 | `sk-` 3 + 32 hex；定长便于展示与校验 |
| `prefix` 为什么 11 | `sk-` + 8 hex，可辨识；剩余 96 bit 不可爆破 |
| 为什么 SHA-256 不是 bcrypt | key 高熵，不需要慢哈希；bcrypt 带盐无法按哈希查索引 |
| `findUnique` 为什么能按 `keyHash` | schema 里 `@unique`，Prisma 类型层面才允许 |
| 还需要恒定时间比较吗 | 比较的是哈希不是明文；时序攻击前提不成立 |
| 明文 key 存在哪 | 只在 create 的局部变量与响应里，数据库/日志都不留 |
| 为什么不能加密存储 | 服务端不需要还原明文；哈希不可逆更安全 |
| 重名为什么只算未撤销 | 轮换时可复用同名；审计靠 id/时间而非名字 |
| 重复撤销会怎样 | 当前实现覆盖 `revokedAt`；要幂等需先判断 |
| 撤销并发窗口 | `READ COMMITTED` 下可能有一次在途调用成功 |
| `lastUsedAt` 为什么是写热点 | 每次认证都 UPDATE 同一行；应采样/异步/可丢 |
| 管理接口为什么 404 | 不泄露应用/key 是否存在 |
| 对外接口为什么统一 401 | 不区分「不存在/已撤销/不属于该应用」 |
| 限流放哪 | 网关 IP → authenticate 前按 key → 执行前按 app |
| `@HttpCode(204)` 为什么必须写 | NestJS DELETE 默认 200；契约要求 204 |

---

## 11. 下一步

`03-对外SSE接口与双后端对齐.md`：

- `PublicController`：取 key、`authenticate`、比对 `appId`、读已发布快照、写 SSE；
- `EngineService.runPublished`：与草稿运行的差异（不写会话、`run_started` 不带 `conversationId`）；
- Python 的 `app/api_keys/service.py`、`app/api/api_keys.py`、`app/api/public.py`：同一套生成/哈希/校验/文案；
- 跨端验证：同一把 key 在两端都能用，错误文案逐字节一致。
