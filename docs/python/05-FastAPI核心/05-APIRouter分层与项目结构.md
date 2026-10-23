# 05 · APIRouter 分层与项目结构

> 所属：阶段 5 · FastAPI 核心
> 本篇覆盖：单文件路由的五个症状、按业务域拆 `APIRouter`、项目真实目录树逐层解释（`api/` 接口层、`models/` ORM、领域服务目录、`engine/`、`rag/`、`tools/`、根级基础设施）、**单向依赖方向**、三种分层风格（薄 api / api + service / router-service-repository）、`include_router` 与前缀拼接、嵌套 router、`__init__.py` 的导出约定、循环导入的规避、何时该拆与**何时不该拆**（避免过度设计）
> **本篇首次教学：`APIRouter` 作为「业务域边界」而非「代码文件夹」、`include_router` 的 `prefix` 拼接规则与「父 router 也带 prefix」的嵌套、`app.include_router` 多次调用的装配模式、**分层依赖方向**（`api → service → models`，禁止反向）、薄 api 层（只做 HTTP 转换）与领域服务层（纯业务）的职责切分、`__init__.py` 收口导出以减少深层导入、拆分的三条判据与「一文件一域」经验法则**
> 预告：阶段 5 收官。阶段 6 开始——下一篇讲 SQLAlchemy 2.0 核心（`DeclarativeBase`、`Mapped`、`select()`、`Session`）。

> 项目锚点：`apps/api-py/app/` 的真实目录（`api/` 9 个接口文件、`models/` 6 个 ORM 模型、`conversations/` 与 `api_keys/` 领域服务、`engine/` 执行引擎、`rag/` 检索、`tools/` 工具、根级 `config.py`/`db.py`/`security.py`/`errors.py`）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 把一个 500 行的 `main.py` 拆成「按业务域」的多个 `APIRouter`。
2. 说清 `api/` 层与领域服务层的职责边界（谁能 `raise HTTPException`）。
3. 解释 `include_router` 的 `prefix` 拼接规则，避免出现 `//apps` 或 `/api/api`。
4. 判断一个模块该不该拆（而不是「目录越多越专业」）。
5. 照着项目的目录结构给一个新业务域落地文件。

**验收标准**

- 能画出请求从 `main.py` → `api/xxx.py` → `service` → `models` 的调用链。
- 能说出「models 里 import api 会有什么后果」。
- 能给 `router` 加二级前缀且不产生重复路径。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [04-Web基础/02 FastAPI 第一个应用](../04-Web基础与FastAPI起步/02-FastAPI第一个应用.md)（`APIRouter` 基础）、[00-Python基础/04 模块、包与导入](../00-Python基础/04-模块、包与导入.md)（包与循环导入） |
| 已掌握 | 装饰器、导入机制、`Depends` |

---

## 3. 单文件为什么撑不住

### 3.1 五个症状

```python
# main.py（800 行）
app = FastAPI()
@app.get("/health") ...
@app.post("/auth/register") ...
@app.post("/auth/login") ...
@app.get("/apps") ...
@app.post("/apps") ...
# ... 60 个路由
```

| 症状 | 后果 |
| --- | --- |
| 文件过长 | 查找靠搜索，合并冲突频繁 |
| 三类关注点混杂 | HTTP 转换、业务规则、SQL 都在一处 |
| 无法按域 Review | 一个 PR 改动覆盖全文件 |
| 复用困难 | 业务逻辑埋在视图里，别处调不到 |
| 测试困难 | 想单测业务必须起 HTTP |

### 3.2 拆分后的目标

```
main.py          只做装配（~50 行）
api/apps.py      HTTP 层：收参数、调服务、返回模型
conversations/service.py   业务层：纯函数 + DB 操作，不依赖 FastAPI
models/app.py    ORM 层：表结构
```

> 核心不是「文件变多」，而是**每层只知道自己该知道的事**。

---

## 4. 项目真实目录树

```
apps/api-py/app/
├── main.py                 # 装配：建 app、CORS、错误处理器、挂 8 个 router
├── config.py               # pydantic-settings
├── db.py                   # engine / SessionLocal / Base
├── security.py             # bcrypt + JWT
├── errors.py               # 错误信封归一化
├── json_response.py        # UTF8JSONResponse
├── timefmt.py              # iso_z
│
├── api/                    # ① 接口层：HTTP 边界
│   ├── deps.py             # get_db / get_current_user
│   ├── health.py
│   ├── auth.py
│   ├── apps.py
│   ├── graph.py
│   ├── run.py
│   ├── tools.py
│   ├── kb.py
│   ├── conversations.py
│   ├── api_keys.py
│   └── public.py
│
├── models/                 # ② 数据层：SQLAlchemy 模型
│   ├── base.py
│   ├── user.py
│   ├── app.py
│   ├── knowledge.py
│   ├── conversation.py
│   └── api_key.py
│
├── conversations/          # ③ 领域服务：会话业务
│   ├── service.py
│   └── __init__.py
├── api_keys/               # ③ 领域服务：API Key 业务
│   ├── service.py
│   └── __init__.py
│
├── engine/                 # ④ 执行引擎
│   ├── engine.py
│   ├── events.py
│   ├── template.py
│   └── nodes/              # start / end / llm / condition / iteration / aggregator / knowledge
│
├── rag/                    # ⑤ RAG
│   ├── splitter.py
│   ├── embedding.py
│   └── service.py
│
├── graph/                  # ⑥ 图校验
│   └── validator.py
│
└── tools/                  # ⑦ 工具注册表与内置工具
    ├── registry.py
    ├── calculator.py
    ├── current_time.py
    ├── http_get.py
    └── tool_error.py
```

### 4.1 分层职责表

| 层 | 目录 | 职责 | 不该做的事 |
| --- | --- | --- | --- |
| 装配 | `main.py` | 建 app、中间件、错误处理器、挂 router | 写业务 |
| 接口 | `api/` | 收参数、鉴权、调服务、组装响应 | 写复杂 SQL、写业务规则 |
| 数据 | `models/` | 表结构、关系、索引 | 依赖 HTTP、依赖接口层 |
| 领域服务 | `conversations/`、`api_keys/` | 业务规则 + DB 操作 + 事务 | 依赖 `Request`/`Response` |
| 引擎 | `engine/` | 图执行、节点、事件 | 依赖路由 |
| 检索 | `rag/` | 切分、向量化、检索 | 依赖路由 |
| 基础设施 | `config.py`/`db.py`/`security.py`/`errors.py` | 配置、连接、加密、错误 | 业务逻辑 |

### 4.2 单向依赖（最重要的规则）

```
main.py
  ↓
api/*  ──────────→ 领域服务（conversations/service.py）
  ↓                        ↓
engine/、rag/、graph/     models/
  ↓                        ↓
  └────→ config / db / security / errors ←──┘
```

| 规则 | 违反后果 |
| --- | --- |
| `api` 可以 import 服务 | ✅ |
| 服务可以 import `models` | ✅ |
| `models` import `api` | ❌ 循环导入 + 分层崩坏 |
| `rag` import `api` | ❌ 无法在脚本/任务里复用 |
| `engine` import `api` | ❌ 同上 |

> 判断方法：**「底层模块能不能在没有任何 HTTP 上下文的情况下被调用？」** 如果答案是否，说明分层错了。

### 4.3 项目的实际取舍

| 现状 | 说明 |
| --- | --- |
| 部分业务直接写在 `api/apps.py` | 应用 CRUD 简单，值得 |
| 会话逻辑抽到 `conversations/service.py` | 逻辑复杂 + 引擎也要用 |
| `api/run.py` 只做参数转换，主体在 `engine/` | 引擎可被其他入口复用 |

> 这正是「**按复杂度拆分**」而非「按教条拆分」：简单的留在接口层，复杂的抽出去。

---

## 5. `APIRouter` 的正确用法

### 5.1 一个业务域一个文件

```python
# app/api/apps.py
router = APIRouter(prefix="/apps", tags=["apps"])

@router.get("")                       # GET /apps
@router.get("/{id}")                  # GET /apps/{id}
```

```python
# app/main.py
from app.api.apps import router as apps_router

app.include_router(apps_router)
```

### 5.2 `prefix` 拼接规则

| 父 prefix | 子路径 | 结果 |
| --- | --- | --- |
| `/apps` | `""` | `/apps` ✅ |
| `/apps` | `"/"` | `/apps/`（会 307） |
| `/apps` | `"/{id}"` | `/apps/{id}` ✅ |
| `/apps/` | `"/{id}"` | `/apps//{id}` ❌ 双斜杠 |

> 记住两点：**prefix 不以 `/` 结尾**、**子路径要么写 `""` 要么以 `/` 开头**。

### 5.3 嵌套 router（二级前缀）

```python
# app/api/kb.py
kb_router = APIRouter(prefix="/kb", tags=["kb"])

@kb_router.get("")                     # GET /kb

docs_router = APIRouter(prefix="/{kb_id}/documents", tags=["kb"])

@docs_router.get("")                   # GET /kb/{kb_id}/documents
async def list_docs(kb_id: str): ...

kb_router.include_router(docs_router)  # 挂到父 router
```

```python
# app/main.py
app.include_router(kb_router)
```

路径拼接：`/kb` + `/{kb_id}/documents` + `""` = `/kb/{kb_id}/documents`。

| 好处 | 说明 |
| --- | --- |
| 子资源归属清晰 | 文档永远在某个知识库下 |
| 父级 `tags` 继承 | `/docs` 里同组展示 |
| 父级 `dependencies` 继承 | 鉴权一次配好 |

### 5.4 `include_router` 的常用参数

```python
app.include_router(
    apps_router,
    prefix="/api",                 # 再叠一层
    tags=["v1"],                   # 追加标签
    dependencies=[Depends(require_user)],
    responses={404: {"description": "Not found"}},
)
```

| 参数 | 作用 |
| --- | --- |
| `prefix` | 追加前缀（适合版本化 `/api`） |
| `tags` | 追加标签（会与 router 自身的合并） |
| `dependencies` | 追加整组依赖 |
| `responses` | 追加共享响应文档 |

> 项目没有加 `/api` 前缀——因为契约里路径本身就是 `/apps`、`/auth/login`。**前缀由契约决定，不能凭喜好加**。

### 5.5 `main.py` 的装配顺序

```python
app = FastAPI(...)
app.add_middleware(CORSMiddleware, ...)
register_error_handlers(app)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(apps_router)
app.include_router(graph_router)
app.include_router(run_router)
app.include_router(tools_router)
app.include_router(kb_router)
app.include_router(conversations_router)
```

| 顺序 | 说明 |
| --- | --- |
| `health` 放最前 | 无依赖、最先可用 |
| 其余按业务重要性 | 无功能影响 |
| 顺序影响 | **只影响 `openapi.json` 里的排列**（文档顺序） |

> 路由匹配顺序是**按注册顺序**（阶段 4/03 §3.3）——所以跨 router 的路径冲突也要靠注册顺序解决。项目里各域前缀不同，不存在冲突。

---

## 6. `__init__.py` 的收口作用

### 6.1 减少深层导入

```python
# app/models/__init__.py
from app.models.app import App
from app.models.api_key import ApiKey
from app.models.conversation import Conversation, Message
from app.models.knowledge import Chunk, KnowledgeBase
from app.models.user import User

__all__ = ["App", "ApiKey", "Conversation", "Message", "Chunk", "KnowledgeBase", "User"]
```

之后：

```python
from app.models import App, User          # ✅ 短
from app.models.app import App            # 也可以，但可读性差
```

| 好处 | 说明 |
| --- | --- |
| 导入路径稳定 | 模型换文件不用改调用方 |
| 一次性注册所有模型 | SQLAlchemy `metadata` 需要全部模型被导入过 |
| 便于 `__all__` 管理 | 明确对外 API |

> **副作用**：`__init__.py` 里 import 模型会触发模型模块执行——如果模型之间互相引用，必须用字符串前向引用（`relationship("App")`）。

### 6.2 领域服务的 `__init__.py`

```python
# app/conversations/__init__.py
from app.conversations.service import (
    append_message,
    create_conversation,
    get_history,
    list_conversations,
)

__all__ = ["append_message", "create_conversation", "get_history", "list_conversations"]
```

调用方：

```python
from app.conversations import get_history
```

> 收口的好处：**接口层不需要知道服务内部怎么拆的**（一个 `service.py` 还是三个文件）。

---

## 7. 接口层 vs 服务层：职责怎么切

### 7.1 一个对照

```python
# ❌ 业务写在接口层（简单场景可接受）
@router.post("")
def create_app(body: CreateAppRequest, user=Depends(get_current_user), db=Depends(get_db)):
    app = App(id=str(uuid.uuid4()), owner_id=user.id, name=body.name, ...)
    db.add(app)
    db.commit()
    db.refresh(app)
    return _to_app_response(app)
```

```python
# ✅ 抽到服务层（复杂场景必要）
# app/conversations/service.py
def create_conversation(db: Session, app_id: str, owner_id: str, title: str | None) -> Conversation:
    ...

# app/api/conversations.py
@router.post("")
def create(app_id: str, body: CreateConversationRequest, user=Depends(get_current_user), db=Depends(get_db)):
    conversation = create_conversation(db, app_id, user.id, body.title)
    return _to_response(conversation)
```

### 7.2 分工表

| 职责 | 接口层 `api/` | 服务层 `xxx/service.py` |
| --- | --- | --- |
| 参数校验 | ✅（Pydantic） | ❌ |
| 鉴权 | ✅（`Depends`） | 只接收 `owner_id` |
| 组装响应模型 | ✅ | 返回 ORM 对象或领域对象 |
| 业务规则 | ❌ | ✅ |
| 事务与并发重试 | ❌（或简单 commit） | ✅ |
| `raise HTTPException` | ✅ | ⚠️ 尽量抛自定义异常 |
| SQL 查询 | ❌ | ✅ |

> 项目里的 `conversations/service.py` 顶部注释明确写了「归属校验一律 404」——这类规则属于服务层，**两套后端必须一致**。

### 7.3 谁可以 `raise HTTPException`

| 方案 | 适用 |
| --- | --- |
| 服务层直接抛 `HTTPException` | 小项目、单后端（项目现状） |
| 服务层抛 `NotFound`/`Conflict` 自定义异常，接口层/全局映射 | 大项目、要复用服务 |
| 接口层自己判断并抛 | 简单 CRUD |

> 项目选择了第一种（`conversations/service.py` 里 `raise HTTPException(404, ...)`）——好处是少一层映射，代价是服务层耦合 FastAPI。**规模变大后建议迁到第二种**（阶段 5/03 §6.2 已讲）。

---

## 8. 该不该拆：三条判据

| 判据 | 该拆 | 不该拆 |
| --- | --- | --- |
| 行数 | 文件 > 300~400 行 | < 150 行 |
| 复用 | 逻辑要被「引擎/脚本/另一个接口」调用 | 只被一个接口用一次 |
| 变化频率 | 业务规则会独立变化 | 纯 CRUD 转手 |
| 团队 | 多人同时改同一文件 | 一个人维护 |

反面教材：

```
app/utils/helpers.py       ← 「什么都能放」的垃圾桶
app/services/              ← 所有服务挤在一个目录，没有域边界
app/api/v1/v2/common/...   ← 目录层级比业务复杂度还深
```

> **过度设计也是债**：四个文件的域被拆成 `router.py` + `schema.py` + `service.py` + `repository.py` + `mapper.py`，改一个字段要动 5 个文件，收益却是 0。

---

## 9. 与 NestJS 模块对照

| FastAPI | NestJS | 说明 |
| --- | --- | --- |
| `APIRouter(prefix, tags)` | `@Controller('apps')` | 域边界 |
| `api/apps.py` | `apps.controller.ts` | 接口层 |
| `conversations/service.py` | `conversations.service.ts` | 服务层 |
| `models/app.py` | Prisma schema / entity | 数据层 |
| `app.include_router(...)` | `@Module({ controllers, providers })` | 装配 |
| `conversations/__init__.py` 导出 | `index.ts` barrel | 收口 |
| `APIRouter(dependencies=[...])` | `@UseGuards()` | 组级 |
| 无显式 module | `@Module` 声明 imports/providers | **Nest 的模块是显式的** |
| 单向依赖靠约定 | 靠 module 依赖图强制 | Nest 更严格 |

> 关键差异：NestJS 用 `@Module` **强制**声明依赖，FastAPI 没有模块系统——**分层全靠团队约定 + 代码评审**。所以「依赖方向」这条规则必须写进文档（本篇就是）。

---

## 10. 验收自测

### 10.1 拼路径

```python
parent = APIRouter(prefix="/kb")
child = APIRouter(prefix="/{kb_id}/documents")

@child.get("")
def list_docs(kb_id: str): ...

parent.include_router(child)
app.include_router(parent)
```

最终路径？

<details>
<summary>答案</summary>

`GET /kb/{kb_id}/documents`。若 `child` 写成 `prefix="/documents/"` 就会变成 `/kb/{kb_id}/documents/` 并触发 307。

</details>

### 10.2 找错

```python
# app/models/app.py
from app.api.apps import AppResponse        # ← 想复用响应模型

class App(Base):
    ...
```

两个问题：

1. **反向依赖**：`models` 依赖 `api`，分层崩坏；
2. 大概率**循环导入**（`api/apps.py` 又 import `models`）。

正确做法：响应模型属于接口层，ORM 模型不应知道它；需要共享时放到独立 `schema.py` 或 contracts 包。

### 10.3 动手题

给「标签（tag）」业务落地文件：列表、创建、删除三个接口，要求有独立前缀与标签，并在 `main.py` 装配。

<details>
<summary>参考</summary>

```python
# app/api/tags.py
from fastapi import APIRouter, Depends

router = APIRouter(prefix="/tags", tags=["tags"])

@router.get("", operation_id="listTags")
def list_tags(): ...

@router.post("", status_code=201, operation_id="createTag")
def create_tag(): ...

@router.delete("/{id}", status_code=204, operation_id="deleteTag")
def delete_tag(id: str) -> None: ...
```

```python
# app/main.py
from app.api.tags import router as tags_router
app.include_router(tags_router)
```

</details>

---

## 11. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 路径变成 `//apps` | `prefix` 以 `/` 结尾 | 去掉尾部 `/` |
| 出现 307 | 子路径写 `"/"` | 写 `""` |
| `include_router` 后接口 404 | 忘了 `app.include_router` | 检查装配 |
| 两个 router 都有 `/health` | 路径冲突 | 前缀区分 |
| `openapi.json` 顺序乱 | 注册顺序决定 | 按业务排 |
| 循环导入 | 模型 import 接口 | 保持单向依赖 |
| 模型没被注册到 metadata | 没 import 过 | `models/__init__.py` 收口 |
| `/docs` 分组混乱 | 没写 `tags` | 每个 router 加 `tags` |
| 鉴权漏配 | 每个视图手写依赖 | router 级 `dependencies` |
| 服务层拿到 `Request` | 业务耦合 HTTP | 只传必要参数 |
| `main.py` 又变 500 行 | 只拆了文件没拆职责 | 业务下沉到服务层 |
| 为了「架构」拆 5 个文件 | 过度设计 | 按 §8 三条判据 |

---

## 12. 本篇小结

- **拆分的目标是职责隔离**，不是文件数量。
- **`APIRouter` 是业务域边界**：一个域一个文件，配 `prefix` + `tags`。
- **`prefix` 不以 `/` 结尾**；子路径写 `""` 或 `"/x"`，否则双斜杠/307。
- **嵌套 router** 让子资源路径归属清晰，且继承父级 `tags`/`dependencies`。
- **`include_router` 的前缀由契约决定**，不要凭喜好加 `/api`。
- **单向依赖**：`api → service → models`；底层模块必须能在没有 HTTP 上下文时被调用。
- **接口层管 HTTP，服务层管业务**；复杂逻辑抽出去，简单 CRUD 留在接口层。
- **`__init__.py` 收口**：稳定导入路径 + 确保模型全被导入。
- **拆分三判据**：行数、复用、变化频率——不满足就别拆。
- **NestJS 有 `@Module` 强制依赖图，FastAPI 只有约定**，所以分层规则必须写进文档、靠 Review 守住。
- **项目范式**：`main.py` 只装配 8 个 router；`api/` 薄；`conversations/` 有独立服务层；`engine`/`rag`/`tools` 与 HTTP 解耦。
- **阶段 5 收官**，下一步进入阶段 6：SQLAlchemy 2.0 核心。
