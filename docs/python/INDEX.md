# Python + FastAPI 从入门到化神 · 学习路线大纲

> 定位：一份**可执行的学习路线**，不是知识点罗列。每个阶段有明确的能力目标、篇目拆分与验收标准，后续按此大纲逐篇产出教学笔记。
> 主线：**Python 语言能力 → Web/ASGI → FastAPI 全栈 → 数据层与并发 → 部署与架构 → 项目实战**。
> 对照：全系列以「**与 TypeScript / NestJS 对照**」为暗线（本项目 `apps/api-py` 与 `apps/api-ts` 双栈同构），有 TS 经验可快速建立映射。
> 实战锚点：`d:\user\my_project\github\mini-dify\apps\api-py`（FastAPI + SQLAlchemy 2.0 + 异步引擎 + RAG）。

---

## 一、目录与命名约定（唯一标准）

### 1.1 目录树

```
docs/python/
├── INDEX.md                      ← 本文件（路线大纲 + 写作规范 + 技术点索引，唯一不带编号）
├── 00-Python基础/                ← 阶段目录：目录号 = 阶段号
│   ├── 01-环境与工具链.md
│   └── ...
├── 01-Python进阶/
├── 02-异步与并发/
├── ...
└── 13-化神/
```

### 1.2 编号规则

| 规则 | 说明 |
| --- | --- |
| **① 目录号 = 阶段号** | `00-Python基础`（阶段 0）…`13-化神`（阶段 13），两位数字，不要错位 |
| **② 篇内编号 = 阶段内顺序** | 从 `01` 起递增 |
| **③ 唯一无编号文件是 `INDEX.md`** | 路线、规范、技术点登记都放这里 |

### 1.3 一句话记忆

> **外面看阶段号，里面看篇序号，技术点只在首次出现时讲透。**

---

## 二、写作规范（强制）

### 2.1 定位

每篇都是**完整教学**，不是摘要：没接触过 Python 的人，照着能跑起来并理解为什么这么写。

### 2.2 每篇必须包含

| 组成 | 要求 |
| --- | --- |
| **头部引用块** | `> 所属：阶段 N · 主题` / `> 本篇覆盖：...` / `> **本篇首次教学：...**` / `> 预告：下一篇讲什么` |
| **本篇目标** | 做完能干什么 + 3~5 条验收标准 |
| **前置条件** | 依赖哪些已完成篇目 |
| **正文教学** | 每个技术点**首次出现时**讲透：是什么 → 基本语法 → 本例为什么这么用 |
| **完整代码** | 每个文件给**完整内容**，代码块**上方**标注完整文件路径（相对仓库根） |
| **TS/NestJS 对照** | 关键概念给出一行对照，帮助从 TS 心智迁移 |
| **验收自测** | 可直接复制的命令 + 预期输出 |
| **常见坑** | 现象 + 原因 + 解决 |
| **本篇小结** | 3~5 条要点收束 |

### 2.3 去重规则

- 技术点**首次出现** → 完整教学，并登记到本文件第五节。
- **再次出现** → 一句「见 `NN-阶段/MM-篇.md`」+ 直接使用，**不重讲**。

---

## 三、能力分级总览

| 阶段区间 | 能力等级 | 达成标志 |
| --- | --- | --- |
| 阶段 0 ~ 1 | **入门** | 能读懂并改写 Python 代码，会用类型注解、生成器、装饰器 |
| 阶段 2 ~ 3 | **熟练** | 能写并发代码、组织工程、写测试、跑静态检查 |
| 阶段 4 ~ 6 | **上手 FastAPI** | 能独立开发带数据库的 REST API（含迁移、鉴权） |
| 阶段 7 ~ 9 | **能交付** | 能做认证安全、流式接口、完整测试，接口可被前端消费 |
| 阶段 10 ~ 11 | **能上线** | 能容器化部署、调优、排查线上问题 |
| 阶段 12 ~ 13 | **化神** | 能读懂并改造真实项目后端，做架构取舍与扩展设计 |

---

## 四、阶段详细大纲

### 阶段 0 · Python 基础（6 篇）

> 目标：装好环境，掌握语法与数据模型，能写出 100 行以内的小脚本。
> 化神提示：本阶段的每个语法点都会在后续阶段复现，务必打牢。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | 环境与工具链 | 安装 Python 3.12、`venv`/`uv`、解释器与字节码、`python -m` | Python 是什么、CPython、虚拟环境、pip/uv |
| 02 | 语法最小集与数据类型 | 变量、缩进、`int/float/str/bool/None`、list/dict/set/tuple、切片、f-string | 动态类型、真值规则、可变 vs 不可变、容器操作 |
| 03 | 函数与作用域 | `def`、默认参数、`*args/**kwargs`、闭包雏形、LEGB、lambda | 参数传递机制（对象引用）、作用域规则 |
| 04 | 模块、包与导入 | `import`/`from`、`__init__.py`、相对导入、`if __name__ == "__main__"` | 模块解析顺序、包结构、入口脚本 |
| 05 | 异常与文件 IO | `try/except/else/finally`、自定义异常、`with open`、`pathlib` | 异常传播、异常链、上下文管理雏形、路径处理 |
| 06 | 面向对象 | `class`、`__init__`、实例/类属性、继承、`@property`、`__repr__`、魔术方法 | OOP 模型、方法绑定、魔术方法约定 |

**验收**：能写一个命令行小工具（读文件 → 解析 → 统计 → 输出），并用类封装。

---

### 阶段 1 · Python 进阶（4 篇）

> 目标：写出「像 Python 的 Python」，掌握类型系统与函数式工具。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | 类型注解与 typing | `list[int]`/`dict[str, Any]`/`Optional`/`Union`/`Literal`/`TypeVar`/`Protocol`、`TYPE_CHECKING` | 类型注解（运行时不强制）、泛型、结构化子类型 |
| 02 | 迭代器与生成器 | 可迭代协议、`yield`、`yield from`、生成器表达式、惰性求值 | 迭代器协议、生成器状态机、惰性流 |
| 03 | 装饰器与闭包 | 闭包、`functools.wraps`、带参装饰器、类装饰器、`lru_cache` | 函数是一等公民、装饰器执行时机 |
| 04 | 上下文管理器与 dataclass | `__enter__/__exit__`、`contextlib.contextmanager`、`@dataclass`、`field(default_factory=)` | 资源管理模式、数据类 |

**验收**：手写一个带参数的装饰器 + 一个 `@contextmanager` 计时器 + 一个 dataclass 配置对象。

---

### 阶段 2 · 异步与并发（4 篇）

> 目标：理解 GIL，能正确选择线程/进程/协程，能写不阻塞事件循环的异步代码。
> 这是 FastAPI 高性能的根基，也是新手最容易写出「假异步」的地方。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | GIL 与并发模型选择 | GIL 本质、CPU 密集 vs IO 密集、线程/进程/协程选型 | GIL、并发与并行区别、选型决策表 |
| 02 | asyncio 核心 | `async def`/`await`、事件循环、`create_task`/`gather`、`TaskGroup` | 协程、事件循环、任务调度 |
| 03 | 异步实战模式 | `asyncio.sleep` 与阻塞陷阱、`to_thread`、异步锁/信号量/队列、超时取消 | 阻塞调用毒化事件循环、`asyncio.wait_for` |
| 04 | 并发工具箱 | `concurrent.futures`、`ThreadPoolExecutor`、`ProcessPoolExecutor`、线程安全 | 线程池/进程池、共享状态与锁 |

**验收**：把 10 个模拟 IO 请求用串行 / 线程池 / `asyncio.gather` 三种方式实现并对比耗时。

---

### 阶段 3 · 工程化与质量（4 篇）

> 目标：项目结构规范、依赖可复现、日志可排查、测试与静态检查能跑起来。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | pyproject 与依赖管理 | `pyproject.toml`、`uv`/pip、依赖分组、锁文件、可编辑安装 | 现代打包标准（PEP 621）、依赖锁定 |
| 02 | 配置与日志 | `pydantic-settings`、`.env`、多环境配置、`logging` 层级与格式化 | 12-Factor 配置、日志级别与 handler |
| 03 | pytest 入门 | 夹具 fixture、参数化、断言、`monkeypatch`、目录组织 | pytest 模型、fixture 作用域 |
| 04 | 静态检查与格式化 | ruff（lint + format）、mypy 类型检查、pre-commit 钩子 | 静态检查链路、类型检查局限 |

**验收**：新建一个空项目，`uv run pytest` + `ruff check` + `mypy` 三条命令全绿。

---

### 阶段 4 · Web 基础与 FastAPI 起步（3 篇）

> 目标：理解 HTTP/ASGI，能跑起第一个 FastAPI 服务并看懂 OpenAPI 文档。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | HTTP 与 ASGI/WSGI | 请求响应模型、状态码、REST 风格、WSGI vs ASGI、uvicorn | HTTP 语义、ASGI 协议、与 NestJS 对照 |
| 02 | FastAPI 第一个应用 | `FastAPI()`、`uvicorn main:app --reload`、`/docs`、最小可运行 | FastAPI 组成（Starlette + Pydantic）、自动文档 |
| 03 | 路由、参数与响应 | 路径/查询/请求体参数、`Path`/`Query`/`Body`、响应模型、状态码 | 参数来源声明、响应序列化 |

**验收**：写出 3 个 REST 端点（GET 列表 / POST 创建 / GET 详情），`/docs` 可交互调通。

---

### 阶段 5 · FastAPI 核心（5 篇）

> 目标：掌握 FastAPI 的四大件：**Pydantic 校验、Depends 注入、异常契约、路由分层**。
> 项目锚点：`apps/api-py/app/api/`、`app/errors.py`。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | Pydantic v2 模型与校验 | `BaseModel`、字段约束、嵌套模型、`model_validate`、`model_config` | Pydantic v2 校验管线、DTO 设计 |
| 02 | 依赖注入 Depends | `Depends`、依赖嵌套、`yield` 依赖、类依赖、依赖缓存 | DI 容器式思维、与 NestJS Provider 对照 |
| 03 | 异常处理与错误契约 | `HTTPException`、`RequestValidationError`、全局异常处理器、统一错误体 | 错误响应契约、异常分层 |
| 04 | 中间件、CORS 与生命周期 | `@app.middleware`、CORS、`lifespan`、启动/关闭钩子 | ASGI 中间件洋葱模型、生命周期管理 |
| 05 | APIRouter 分层与项目结构 | `APIRouter`、前缀与标签、依赖挂载、按领域拆包 | 分层架构（router/service/model）、与 NestJS Module 对照 |

**验收**：搭出 `main.py + api/ + models/ + schemas/ + services/` 分层骨架，错误体统一。

---

### 阶段 6 · 数据层（4 篇）

> 目标：用 SQLAlchemy 2.0 + Alembic 管理数据，异步访问 PostgreSQL。
> 项目锚点：`app/db.py`、`app/models/`、`apps/api-ts/prisma` 的 DDL 归属。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | SQLAlchemy 2.0 核心 | `DeclarativeBase`、`Mapped`/`mapped_column`、表映射、关系定义 | ORM 心智模型、2.0 声明式语法 |
| 02 | Session 生命周期与依赖 | `Session`/`AsyncSession`、`sessionmaker`、`get_db` 依赖、事务边界 | Unit of Work、会话作用域 |
| 03 | 关系、级联与查询 | 一对多/多对多、`select`/`join`/`options`、N+1 问题、`passive_deletes` | 关系加载策略、N+1 与预加载 |
| 04 | Alembic 迁移与异步驱动 | `alembic init`、`autogenerate`、手写迁移、`asyncpg`、原生 SQL 逃生口 | 迁移版本管理、异步驱动、DDL 归属原则 |

**验收**：为「应用 + 图」两张表建模型、生成迁移、用异步 Session 完成增删查。

---

### 阶段 7 · 认证与安全（3 篇）

> 目标：实现可上线的登录鉴权，接口有统一身份与权限边界。
> 项目锚点：`app/security.py`、`app/api/deps.py`、`app/api/auth.py`。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | 密码哈希 | `passlib`/`bcrypt`、加盐、时序安全比较 | 密码存储原则、哈希算法选择 |
| 02 | JWT 与 OAuth2 密码流 | 签发/校验、`OAuth2PasswordBearer`、过期与刷新、`sub` 声明 | JWT 结构、无状态鉴权 |
| 03 | 权限守卫与安全加固 | `Depends` 守卫、当前用户依赖、RBAC、CORS/限流/安全响应头 | 鉴权依赖链、最小权限 |

**验收**：注册 → 登录拿 token → 带 token 访问受保护接口，无 token 返回 401。

---

### 阶段 8 · 流式响应与外部调用（4 篇）

> 目标：能调用第三方 API、做 SSE 流式输出、后台任务与容错。
> 项目锚点：`app/engine/`、`app/api/run.py`、`packages/contract/sse-events.md`。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | httpx 异步客户端 | `AsyncClient`、连接池、超时、重试、流式读取 | 异步 HTTP 客户端、超时分层 |
| 02 | SSE 流式响应 | `StreamingResponse`、`text/event-stream`、事件格式、断连处理 | SSE 协议、流式生成器 |
| 03 | 后台任务与队列 | `BackgroundTasks`、任务幂等、简单队列方案 | 后台任务边界、幂等设计 |
| 04 | 容错与降级 | 重试退避、熔断、降级、错误映射 | 容错模式、错误码映射 |

**验收**：实现一个 SSE 端点，前端能逐字收到事件；外部调用失败时有统一错误体。

---

### 阶段 9 · 测试与质量保障（3 篇）

> 目标：接口、数据库、异步逻辑都有测试，CI 可一键跑通。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | TestClient 与异步测试 | `TestClient`、`pytest-asyncio`、`AsyncClient` + ASGITransport | 应用内测试、异步测试夹具 |
| 02 | 数据库测试与隔离 | 测试库、事务回滚夹具、工厂函数 | 测试数据隔离、夹具设计 |
| 03 | 契约测试与覆盖率 | 与前端契约对齐、快照测试、覆盖率报告 | 契约一致性、覆盖率阈值 |

**验收**：`pytest --cov` 覆盖核心接口，测试间数据互不污染。

---

### 阶段 10 · 部署与运维（3 篇）

> 目标：能容器化上线，知道进程模型与常见线上问题排查入口。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | Docker 镜像与多阶段构建 | Dockerfile、依赖层缓存、非 root 用户、`.dockerignore` | 镜像分层、构建优化 |
| 02 | 进程模型与反向代理 | uvicorn worker、gunicorn+uvicorn worker、Nginx 反代、健康检查 | worker 模型、优雅重启 |
| 03 | 可观测性 | 结构化日志、请求 ID、指标、健康/就绪探针 | 可观测三支柱、探针设计 |

**验收**：`docker compose up` 起服务，`/health` 通过，日志可按请求 ID 串联。

---

### 阶段 11 · 性能与架构（3 篇）

> 目标：定位瓶颈、做缓存与限流、把代码组织成可演进的架构。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | 性能分析与优化 | `cProfile`/`py-spy`、慢查询、异步阻塞排查、内存占用 | profiling 方法、瓶颈定位 |
| 02 | 缓存与限流 | Redis 缓存、缓存穿透/雪崩、令牌桶限流 | 缓存策略、限流算法 |
| 03 | 分层架构与可演进设计 | 依赖方向、领域边界、DTO 转换、双栈契约一致 | 分层原则、契约驱动 |

**验收**：对慢接口做一次 profiling，给出优化前后对比数据。

---

### 阶段 12 · 综合实战：mini-dify 后端（3 篇）

> 目标：读懂并复刻真实项目 `apps/api-py`，把前面所有能力串起来。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | api-py 全貌与启动链路 | 目录结构、`main.py`、配置、路由挂载、与 api-ts 的职责划分 | 服务启动链路、双栈分工 |
| 02 | 图执行引擎与 SSE | 节点运行时、变量池、事件协议、流式推送 | 引擎架构、事件驱动执行 |
| 03 | RAG 与工具调用 | 知识库检索、embedding、工具注册表、ReAct 循环 | 检索增强、工具调用编排 |

**验收**：能画出 api-py 的请求→引擎→SSE 全链路图，并说明每个模块职责。

---

### 阶段 13 · 化神（选修，3 篇）

> 目标：从「会用」走到「能设计、能扩展、能改源码」。

| 篇 | 标题 | 核心内容 | 首次教学点 |
| --- | --- | --- | --- |
| 01 | 插件化与扩展机制 | 注册表模式、动态加载、能力开关 | 插件架构、注册表 |
| 02 | 分布式与水平扩展 | 无状态化、会话外置、任务分发、幂等与一致性 | 水平扩展约束、一致性取舍 |
| 03 | 源码阅读与贡献 | FastAPI/Starlette 源码脉络、调试技巧、提交规范 | 框架源码结构 |

**验收**：能新增一个自定义节点/工具，并通过注册表接入引擎，不改核心代码。

---

## 五、技术点索引（首次教学登记表）

> 每写完一篇，在此登记该篇**首次教学**的技术点；后续篇目只引用不重讲。

| 技术点 | 首次教学位置 |
| --- | --- |
| CPython 解释执行模型（源码→AST→字节码 `.pyc`→虚拟机）、`__pycache__` 缓存机制 | `00-Python基础/01-环境与工具链.md` |
| `venv` 虚拟环境（创建/激活/隔离验证、与 `node_modules` 对照、PowerShell 执行策略处理） | `00-Python基础/01-环境与工具链.md` |
| `pip` 与 `uv` 包管理（`python -m pip` 语义、`uv add/sync/lock/run`、extras 方括号语法） | `00-Python基础/01-环境与工具链.md` |
| `pyproject.toml` PEP 621 结构（`[project]`/`requires-python`/`dependencies`/`[dependency-groups]`）与 `uv.lock` 声明-锁定分层 | `00-Python基础/01-环境与工具链.md` |
| 四种运行方式与 `python -m` 模块运行（`sys.path[0]` 差异） | `00-Python基础/01-环境与工具链.md` |
| Python 变量模型（名字是对象引用、`id/type/value`、可变对象共享）、PEP 8 命名规范、缩进即语法块 | `00-Python基础/02-语法最小集与数据类型.md` |
| 数字类型（`int` 无上限、`float` 精度误差与 `math.isclose`、`/` vs `//` 地板除、`bool` 是 `int` 子类） | `00-Python基础/02-语法最小集与数据类型.md` |
| 字符串（单/双/三引号、`r` 原始串、f-string 格式说明符、不可变性、常用方法） | `00-Python基础/02-语法最小集与数据类型.md` |
| `None` 与真值规则（falsy 全表、`x or default` 吞掉 `0` 的坑、`is None` 判断） | `00-Python基础/02-语法最小集与数据类型.md` |
| 四大容器 `list`/`tuple`/`dict`/`set`（增删改查、`sort` vs `sorted`、可哈希键、集合运算、选型） | `00-Python基础/02-语法最小集与数据类型.md` |
| 切片 `[start:stop:step]`（stop 不含、负数索引、反转、浅拷贝、越界不报错） | `00-Python基础/02-语法最小集与数据类型.md` |
| `==` 与 `is` 的区别（值比较 vs 对象身份、CPython 小整数/短串缓存不可依赖） | `00-Python基础/02-语法最小集与数据类型.md` |
| 解包与星号（多变量赋值、交换、`*rest` 收集、调用时展开）、类型转换与 `ValueError` | `00-Python基础/02-语法最小集与数据类型.md` |
| 函数定义与返回值（docstring、隐式 `None`、元组多返回值、卫语句早返回） | `00-Python基础/03-函数与作用域.md` |
| 对象引用式参数传递（重新绑定不影响调用方、原地修改影响、可变对象拷贝建议） | `00-Python基础/03-函数与作用域.md` |
| 参数五形态与顺序规则（位置/默认/`*args`/仅关键字 `*`/`**kwargs`、调用时 `*`/`**` 展开） | `00-Python基础/03-函数与作用域.md` |
| 可变默认参数陷阱（定义时求值一次、`None` 占位写法） | `00-Python基础/03-函数与作用域.md` |
| LEGB 作用域、`global` 与 `nonlocal`、循环闭包延迟绑定陷阱 | `00-Python基础/03-函数与作用域.md` |
| 函数是一等公民（赋值/传参/返回、注册表雏形、`lambda` 与 `sorted(key=)`、`map`/`filter`） | `00-Python基础/03-函数与作用域.md` |
| 模块与 `__name__`/`__file__`/`__dict__`、`import` 四种写法与命名空间污染 | `00-Python基础/04-模块、包与导入.md` |
| 导入执行流程与 `sys.modules` 缓存（模块级代码只执行一次、配置单例原理） | `00-Python基础/04-模块、包与导入.md` |
| `sys.path` 搜索顺序与 `PYTHONPATH`、`ModuleNotFoundError` 定位方法 | `00-Python基础/04-模块、包与导入.md` |
| 包与 `__init__.py`（标识/初始化/收口 API/`__all__`、保持轻量、命名空间包） | `00-Python基础/04-模块、包与导入.md` |
| 绝对导入 vs 相对导入（`.`/`..` 规则、项目为何统一绝对导入、脚本模式报错） | `00-Python基础/04-模块、包与导入.md` |
| `if __name__ == "__main__"` 双身份、框架对象须放模块级、`uvicorn.run` 用导入字符串的原因 | `00-Python基础/04-模块、包与导入.md` |
| 循环导入成因与三种解法（拆公共模块/延迟导入/`TYPE_CHECKING`） | `00-Python基础/04-模块、包与导入.md` |
| 异常继承体系（`BaseException` vs `Exception`、常见内建异常速查、捕获顺序） | `00-Python基础/05-异常与文件IO.md` |
| `try/except/else/finally` 四段语义、`finally` 与 `return` 的优先级、多异常元组捕获 | `00-Python基础/05-异常与文件IO.md` |
| 裸 `except` 危害、`except ... as e` 作用域（块结束被删除）、最外层兜底须记录日志 | `00-Python基础/05-异常与文件IO.md` |
| `raise` 与异常链 `raise ... from ...`、裸 `raise` 重抛、自定义异常类与结构化字段 | `00-Python基础/05-异常与文件IO.md` |
| EAFP vs LBYL、`assert` 不能用于业务校验（`-O` 会移除） | `00-Python基础/05-异常与文件IO.md` |
| 文件 IO（`open` 模式表、`with` 资源管理、显式 `encoding="utf-8"` 与 Windows GBK 坑、流式逐行读取、`newline=""`） | `00-Python基础/05-异常与文件IO.md` |
| `pathlib` 路径对象（`/` 拼接、`parent`/`suffix`/`stem`、`read_text`/`write_text`、`mkdir`）与 JSON 读写（`ensure_ascii=False`） | `00-Python基础/05-异常与文件IO.md` |
| 类与实例（`__new__` vs `__init__`、`self` 本质、实例属性 vs 类属性查找顺序、可变类属性共享陷阱） | `00-Python基础/06-面向对象.md` |
| 三种方法（实例 / `@classmethod` 工厂 / `@staticmethod` 工具）与装饰器语法初步 | `00-Python基础/06-面向对象.md` |
| 封装（`_` 约定、`__` name mangling）、`@property` 受控属性与计算属性、只读属性 | `00-Python基础/06-面向对象.md` |
| 继承与 `super().__init__()`、方法重写、MRO（C3）、抽象基类 `ABC`/`@abstractmethod` | `00-Python基础/06-面向对象.md` |
| 鸭子类型与多态、`Protocol` 预告、组合优于继承 | `00-Python基础/06-面向对象.md` |
| 魔术方法（`__str__`/`__repr__`、`__eq__`+`__hash__`、`__len__`/`__getitem__`/`__call__`/`__enter__` 一览） | `00-Python基础/06-面向对象.md` |
| 类型注解的本质（运行期元数据、`__annotations__`、不校验；被 IDE/静态检查/框架消费）、现代写法 `list[int]`/`X \| None` vs `Optional`/`List` | `01-Python进阶/01-类型注解与typing.md` |
| `Any` vs `object`、`Literal` 收窄字符串枚举、`Callable[[参数], 返回]` 函数签名 | `01-Python进阶/01-类型注解与typing.md` |
| `TypeVar` 泛型函数（T 一致性、约束与 bound）、`Generic[T]` 泛型类 | `01-Python进阶/01-类型注解与typing.md` |
| `TypedDict` 描述 JSON/dict 形状（`total=False`/`Required`/`NotRequired`）、与 dataclass/Pydantic 的分工 | `01-Python进阶/01-类型注解与typing.md` |
| `Protocol` 结构化子类型（鸭子类型静态版、不继承、`ABC` 对比、`runtime_checkable` 局限） | `01-Python进阶/01-类型注解与typing.md` |
| 前向引用与 `from __future__ import annotations`（延迟注解、`TYPE_CHECKING`）、`Annotated` 附加元数据 | `01-Python进阶/01-类型注解与typing.md` |
| mypy/pyright 静态检查（不运行即发现错误、严格度渐进、`type: ignore` 的正确用法） | `01-Python进阶/01-类型注解与typing.md` |
| 迭代协议（可迭代 vs 迭代器、`__iter__`/`__next__`/`StopIteration`、`for` 的等价展开、手写迭代器类与可重复遍历） | `01-Python进阶/02-迭代器与生成器.md` |
| 生成器函数执行模型（调用不执行、`yield` 暂停/恢复、局部状态保留、`send`/`throw`/`close`、PEP 479 禁止 `raise StopIteration`） | `01-Python进阶/02-迭代器与生成器.md` |
| 惰性求值与内存（列表 vs 生成器对比、何时必须/不该用生成器） | `01-Python进阶/02-迭代器与生成器.md` |
| 生成器表达式（省括号、与 `any`/`all` 短路的优势、嵌套写法）与「只能用一次」陷阱及四种修复 | `01-Python进阶/02-迭代器与生成器.md` |
| `yield from` 委托（转发产出与 `send`/`throw`/`close`、取子生成器 `return` 值）、生成器流水线模式 | `01-Python进阶/02-迭代器与生成器.md` |
| `itertools` 速览（`islice`/`chain`/`groupby`/`count`/`cycle`/`takewhile`/`tee`）与无限生成器 | `01-Python进阶/02-迭代器与生成器.md` |
| 闭包（自由变量、`__closure__` cell 实证、工厂函数、`nonlocal` 状态、闭包 vs 类） | `01-Python进阶/03-装饰器与闭包.md` |
| 装饰器本质（`f = deco(f)`、装配发生在定义/导入时 vs 调用时、无参两层结构） | `01-Python进阶/03-装饰器与闭包.md` |
| `functools.wraps` 必要性（`__name__`/`__doc__`/`__annotations__`、FastAPI 签名解析失效） | `01-Python进阶/03-装饰器与闭包.md` |
| 带参装饰器三层结构（参数→函数→调用参数）与归纳模板 | `01-Python进阶/03-装饰器与闭包.md` |
| 装饰器叠加顺序（洋葱模型：包装自下而上、执行自上而下） | `01-Python进阶/03-装饰器与闭包.md` |
| 实用装饰器（`@timed`、`@retry`、`@cache`/`lru_cache`、`@logged`、单例、权限） | `01-Python进阶/03-装饰器与闭包.md` |
| 类装饰器与 `__call__` 装饰器类（`update_wrapper`）、装饰类（`@dataclass` 原理预告） | `01-Python进阶/03-装饰器与闭包.md` |
| 「注册型」装饰器（`@app.exception_handler`、`@router.get` 只登记函数原样返回）与框架装饰器速查 | `01-Python进阶/03-装饰器与闭包.md` |
| 上下文管理协议（`with` 展开、`__enter__` 返回值绑定、`__exit__` 三参数、`return True` 吞异常、手写 CM 类） | `01-Python进阶/04-上下文管理器与dataclass.md` |
| `@contextmanager`（生成器版 CM、与 `try/finally` 等价、异常在 `yield` 处重抛、只能 `yield` 一次）、`closing`/`suppress` | `01-Python进阶/04-上下文管理器与dataclass.md` |
| 典型 CM 场景（事务 commit/rollback+重抛、临时 chdir、临时改配置、锁）与 `ExitStack`（动态多资源、LIFO） | `01-Python进阶/04-上下文管理器与dataclass.md` |
| `async with`/`__aenter__`/`@asynccontextmanager` 预告（FastAPI lifespan） | `01-Python进阶/04-上下文管理器与dataclass.md` |
| `@dataclass`（自动生成 `__init__`/`__repr__`/`__eq__`、不校验类型）、`field(default_factory=)`、`frozen`/`order`/`kw_only`/`slots`/`repr=False`/`compare=False`、`__post_init__`、继承默认值顺序坑、`replace()` | `01-Python进阶/04-上下文管理器与dataclass.md` |
| 数据结构选型（dataclass / Pydantic / TypedDict / NamedTuple 四方对比与项目实际分工） | `01-Python进阶/04-上下文管理器与dataclass.md` |
| 并发 vs 并行、GIL 成因与释放时机（IO 等待释放、字节码互斥、C 扩展释放、PEP 703 预告）、CPU 密集 vs IO 密集两种实测 | `02-异步与并发/01-GIL与并发模型选择.md` |
| `ThreadPoolExecutor`/`ProcessPoolExecutor`（`submit`/`map`/`as_completed`/`max_workers`、pickle 限制） | `02-异步与并发/01-GIL与并发模型选择.md` |
| 三模型对照（线程/进程/协程：启动与内存成本、隔离、通信、适用规模）与选型决策树 | `02-异步与并发/01-GIL与并发模型选择.md` |
| FastAPI 三层并发（worker 进程 / 事件循环 / 线程池兜底）、`def` vs `async def` 的真实差别、`run_in_threadpool` 救阻塞调用 | `02-异步与并发/01-GIL与并发模型选择.md` |
| 协程函数 vs 协程对象（调用不执行、`never awaited` 告警）、`await` 只能在 `async def` 内、`await` = 让出点、事件循环与 `asyncio.run` 四件事 | `02-异步与并发/02-asyncio核心.md` |
| 串行 `await` 反模式 vs `gather`/`create_task`/`as_completed`、`TaskGroup` 结构化并发与 `ExceptionGroup`/`except*` | `02-异步与并发/02-asyncio核心.md` |
| 超时（`wait_for`/`asyncio.timeout` 会取消任务）、取消语义（`CancelledError` 继承 `BaseException`、必须重抛）、`shield`、`sleep(0)` 让出 | `02-异步与并发/02-asyncio核心.md` |
| 并发限流（`asyncio.Semaphore`、`async with` 获取释放、`map_limited` 封装、分批 chunked gather、为何不无脑 gather 上千） | `02-异步与并发/03-异步实战模式.md` |
| 重试（指数退避 + 随机抖动防惊群、可重试判定表：网络/5xx/429 可重试、4xx 与本地逻辑异常不可、幂等性前提、重试风暴） | `02-异步与并发/03-异步实战模式.md` |
| 双击超时预算（单次超时 vs 整批预算、`asyncio.timeout` 嵌套与取消传播、最坏耗时计算） | `02-异步与并发/03-异步实战模式.md` |
| 连接池复用（`httpx.AsyncClient` 单例、`lifespan` 关闭、`Limits`、`pool` 超时、单例≠单连接） | `02-异步与并发/03-异步实战模式.md` |
| 异步 TTL 缓存（`TTLCache`、`time.monotonic`）与 singleflight 单飞防缓存击穿（`_inflight` + `shield`） | `02-异步与并发/03-异步实战模式.md` |
| 后台任务强引用（`set` + `add_done_callback`、未处理异常、优雅关闭）与 `BackgroundTasks`/队列选型 | `02-异步与并发/03-异步实战模式.md` |
| 竞态条件（`+=` 的 `LOAD/ADD/STORE` 三步非原子、GIL 不保证复合原子）与 `threading.Lock`（`with` 自动释放、不可重入、`RLock`） | `02-异步与并发/04-并发工具箱.md` |
| 线程同步原语（`Event` 信号唤醒、`Condition` 等待/通知与虚假唤醒、线程版 `Semaphore`） | `02-异步与并发/04-并发工具箱.md` |
| `queue.Queue` 生产者-消费者（阻塞/容量、哨兵值结束、`task_done`/`join` 配对、`join` 卡住三原因、多消费者哨兵传递） | `02-异步与并发/04-并发工具箱.md` |
| `asyncio.Queue`（`await put/get`、`QueueFull`/`QueueEmpty`、`join`/`task_done`、不能跨线程、`maxsize` 背压与异步流水线） | `02-异步与并发/04-并发工具箱.md` |
| 线程↔协程桥接（`asyncio.to_thread`、`run_in_executor` 线程池/进程池、`run_in_threadpool`、`call_soon_threadsafe`、`run_coroutine_threadsafe`） | `02-异步与并发/04-并发工具箱.md` |
| `threading.Lock` vs `asyncio.Lock` 混用事故（协程里持线程锁 → 阻塞事件循环且无报错）与判断口诀 | `02-异步与并发/04-并发工具箱.md` |
| 死锁四条件、固定锁顺序/缩小临界区/`acquire(timeout)`、进程间通信简述（`Queue`/`Pipe`/`shared_memory`/Redis） | `02-异步与并发/04-并发工具箱.md` |
| `requirements.txt` 的缺陷与三文件定位（声明 / 清单 / 锁）、`[project]` 字段表与 `requires-python`、`[build-system]` | `03-工程化/01-pyproject与依赖管理.md` |
| PEP 508 依赖语法（`==`/`>=`/`~=`/`!=`/区间、**Python 无 `^`** 与 0.x 语义差异）、extras（`uvicorn[standard]`）、环境标记 `sys_platform`、`pkg @ git+...` | `03-工程化/01-pyproject与依赖管理.md` |
| 锁文件机制（`pyproject` 声明范围 vs `uv.lock` 精确版本、必须提交、`uv sync --frozen`/`--no-dev`、`uv lock --check/--upgrade`、锁 diff 当代码变更审查） | `03-工程化/01-pyproject与依赖管理.md` |
| `[dependency-groups]`（PEP 735）vs `[project.optional-dependencies]`（extras）对照与应用/库选型 | `03-工程化/01-pyproject与依赖管理.md` |
| uv 工作流命令表（`init`/`add --dev`/`remove`/`lock`/`sync`/`run`/`tree`/`python pin`）与「锁提交、CI 冻结、别手改锁」三铁律 | `03-工程化/01-pyproject与依赖管理.md` |
| flat vs src 布局、可编辑安装、`[build-system]` 与 `[tool.uv] package = false` | `03-工程化/01-pyproject与依赖管理.md` |
| 版本策略（应用 `>=`+锁 vs 库宽范围不给 `==`） | `03-工程化/01-pyproject与依赖管理.md` |
| 配置四层优先级（默认值 < `.env` < 环境变量 < 显式入参）、`pydantic-settings` 的 `BaseSettings`/`SettingsConfigDict`、大小写不敏感、`extra` 三策略 | `03-工程化/02-配置与日志.md` |
| `env_file` 绝对路径（`Path(__file__)` 上溯，避免 cwd 依赖）、`validation_alias` 字段名与变量名解耦、类型转换启动即报错、嵌套 `env_nested_delimiter` | `03-工程化/02-配置与日志.md` |
| `SecretStr` 脱敏、`.env`/`.env.example` 提交规范、生产必填项与启动自检断言、`field_validator` 范围校验 | `03-工程化/02-配置与日志.md` |
| `logging` 五件套（logger/handler/formatter/level/propagate）、`getLogger(__name__)` 层级命名、`basicConfig` 只生效一次、`dictConfig`、库模块不配日志 | `03-工程化/02-配置与日志.md` |
| 结构化日志（`extra` 字段、`contextvars` + Filter 注入 `request_id`、JSON formatter、`RotatingFileHandler`、uvicorn 日志接入与重复输出） | `03-工程化/02-配置与日志.md` |
| pytest 与 unittest 差别、四条发现规则（测试类不能有 `__init__`）、裸 `assert` 与断言重写、运行命令（`-k`/`-x`/`--lf`/`-s`/`--durations`） | `03-工程化/03-pytest入门.md` |
| `fixture`（按名注入、`yield` 前 setup 后 teardown、fixture 依赖 fixture、`scope` 四级、`conftest.py` 分层、`autouse`、工厂 fixture） | `03-工程化/03-pytest入门.md` |
| `parametrize`（多参数、笛卡尔积、`pytest.param(id=)`、`marks`）与 `pytest.raises(match=正则)`、`pytest.approx`、`skip`/`skipif`/`xfail` | `03-工程化/03-pytest入门.md` |
| 内建 fixture `tmp_path` 与 `monkeypatch`（`setenv`/`setattr`/`setitem`/`chdir`/`undo`、改 `settings` 单例、patch 使用处而非定义处） | `03-工程化/03-pytest入门.md` |
| mock（`MagicMock`/`AsyncMock`/`patch`、`pytest-mock` 的 `mocker`）与「优先真跑、少 mock」原则、覆盖率 `pytest-cov`（`term-missing`/`html`/`fail-under`）、异步测试 `pytest-asyncio` + `asyncio_mode` | `03-工程化/03-pytest入门.md` |
| 三类检查分工（格式/lint/类型）、`ruff` 替代 flake8+isort+black、`check --fix` 与 `format` 的执行顺序、`--check` 用于 CI | `03-工程化/04-静态检查与格式化.md` |
| ruff 规则码（`E`/`F`/`I`/`B`/`UP`/`SIM`/`C4`/`ANN`）与 `[tool.ruff]`/`[tool.ruff.lint]` 配置、`select` 逐步加、`per-file-ignores`、`# noqa: 码` | `03-工程化/04-静态检查与格式化.md` |
| `mypy` 渐进严格（`check_untyped_defs` → `disallow_untyped_defs` → `strict`）、`# type: ignore[code]` + `warn_unused_ignores`、`pydantic.mypy` 插件、`ignore_missing_imports` | `03-工程化/04-静态检查与格式化.md` |
| `pyright`/`basedpyright` 选型、`pre-commit` 配置（固定 `rev`、`args`、`additional_dependencies`、`run --all-files` 首次全量）、「提交快 CI 严」分层 | `03-工程化/04-静态检查与格式化.md` |

---

## 六、进度状态表

| 阶段 | 篇 | 标题 | 状态 |
| --- | --- | --- | --- |
| 0 | 01 | 环境与工具链 | ✅ |
| 0 | 02 | 语法最小集与数据类型 | ✅ |
| 0 | 03 | 函数与作用域 | ✅ |
| 0 | 04 | 模块、包与导入 | ✅ |
| 0 | 05 | 异常与文件 IO | ✅ |
| 0 | 06 | 面向对象 | ✅ |
| 1 | 01 | 类型注解与 typing | ✅ |
| 1 | 02 | 迭代器与生成器 | ✅ |
| 1 | 03 | 装饰器与闭包 | ✅ |
| 1 | 04 | 上下文管理器与 dataclass | ✅ |
| 2 | 01 | GIL 与并发模型选择 | ✅ |
| 2 | 02 | asyncio 核心 | ✅ |
| 2 | 03 | 异步实战模式 | ✅ |
| 2 | 04 | 并发工具箱 | ✅ |
| 3 | 01 | pyproject 与依赖管理 | ✅ |
| 3 | 02 | 配置与日志 | ✅ |
| 3 | 03 | pytest 入门 | ✅ |
| 3 | 04 | 静态检查与格式化 | ✅ |
| 4 | 01 | HTTP 与 ASGI/WSGI | ⬜ |
| 4 | 02 | FastAPI 第一个应用 | ⬜ |
| 4 | 03 | 路由、参数与响应 | ⬜ |
| 5 | 01 | Pydantic v2 模型与校验 | ⬜ |
| 5 | 02 | 依赖注入 Depends | ⬜ |
| 5 | 03 | 异常处理与错误契约 | ⬜ |
| 5 | 04 | 中间件、CORS 与生命周期 | ⬜ |
| 5 | 05 | APIRouter 分层与项目结构 | ⬜ |
| 6 | 01 | SQLAlchemy 2.0 核心 | ⬜ |
| 6 | 02 | Session 生命周期与依赖 | ⬜ |
| 6 | 03 | 关系、级联与查询 | ⬜ |
| 6 | 04 | Alembic 迁移与异步驱动 | ⬜ |
| 7 | 01 | 密码哈希 | ⬜ |
| 7 | 02 | JWT 与 OAuth2 密码流 | ⬜ |
| 7 | 03 | 权限守卫与安全加固 | ⬜ |
| 8 | 01 | httpx 异步客户端 | ⬜ |
| 8 | 02 | SSE 流式响应 | ⬜ |
| 8 | 03 | 后台任务与队列 | ⬜ |
| 8 | 04 | 容错与降级 | ⬜ |
| 9 | 01 | TestClient 与异步测试 | ⬜ |
| 9 | 02 | 数据库测试与隔离 | ⬜ |
| 9 | 03 | 契约测试与覆盖率 | ⬜ |
| 10 | 01 | Docker 镜像与多阶段构建 | ⬜ |
| 10 | 02 | 进程模型与反向代理 | ⬜ |
| 10 | 03 | 可观测性 | ⬜ |
| 11 | 01 | 性能分析与优化 | ⬜ |
| 11 | 02 | 缓存与限流 | ⬜ |
| 11 | 03 | 分层架构与可演进设计 | ⬜ |
| 12 | 01 | api-py 全貌与启动链路 | ⬜ |
| 12 | 02 | 图执行引擎与 SSE | ⬜ |
| 12 | 03 | RAG 与工具调用 | ⬜ |
| 13 | 01 | 插件化与扩展机制 | ⬜ |
| 13 | 02 | 分布式与水平扩展 | ⬜ |
| 13 | 03 | 源码阅读与贡献 | ⬜ |

> 图例：⬜ 未开始 · 🚧 进行中 · ✅ 已完成

---

## 七、里程碑验收

| 里程碑 | 完成阶段 | 可交付成果 |
| --- | --- | --- |
| **M1 能写脚本** | 0 ~ 1 | 一个带类型注解、用生成器处理大文件的命令行工具 |
| **M2 能写服务** | 2 ~ 3 | 一个结构规范、有测试、有日志的小型 FastAPI 服务 |
| **M3 能交付接口** | 4 ~ 7 | 带数据库、迁移、JWT 鉴权的完整 CRUD API |
| **M4 能上线** | 8 ~ 11 | 容器化部署 + SSE 流式接口 + 监控与压测报告 |
| **M5 化神** | 12 ~ 13 | 可复刻 mini-dify 后端，能新增节点/工具并做架构说明 |

---

## 八、学习节奏建议

1. **不要跳阶段**：0~1 是地基，2~3 决定代码质量，4~6 是 FastAPI 主战场。
2. **每篇必做验收**：验收不过不进入下一篇，防止「看懂 ≠ 写得出」。
3. **优先跑通再优化**：先让代码跑起来，再用类型检查、测试、profiling 逐层加固。
4. **对照项目读代码**：每完成一个阶段，回到 `apps/api-py` 找对应实现，验证「我学的就是项目在用的」。
5. **化神靠改源码**：阶段 13 一定要动手新增一个节点/工具，否则只是「会用」。
