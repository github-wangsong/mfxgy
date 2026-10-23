# 02 · 依赖注入 Depends

> 所属：阶段 5 · FastAPI 核心
> 本篇覆盖：依赖注入要解决的问题、`Depends(func)` 的声明与解析、依赖链（DAG）与**同请求缓存**（`use_cache=False`）、生成器依赖（`yield` 前 setup / 后 teardown）与资源释放、类作为依赖、子依赖、路由级/`APIRouter` 级 `dependencies=`、`Security()` 与 `Depends()` 的区别、`dependency_overrides` 测试替换、同步依赖 vs 异步依赖的线程池差异
> **本篇首次教学：`Depends` 的「声明式注入」语义（参数值 = 依赖函数的返回值）、依赖图与同请求内默认缓存、`use_cache=False` 的场景、生成器依赖的 `yield` 生命周期（含异常路径也清理）、类依赖（`__call__`）与 `__init__` 参数也是依赖、`dependencies=[Depends(...)]` 只执行不注入、`Security()` 与 scopes 预告、`app.dependency_overrides` 在测试中替换依赖、`async def` 依赖与 `def` 依赖的线程池差别**
> 预告：下一篇讲异常处理与错误契约——`HTTPException`、自定义异常、`exception_handler`、统一错误信封。

> 项目锚点：`apps/api-py/app/api/deps.py`（真实文件：`get_db` 生成器依赖、`bearer_scheme = HTTPBearer(auto_error=False)`、`get_current_user` 的三层依赖链、`_unauthorized` 带 `WWW-Authenticate`）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 解释 `id: str = Depends(get_id)` 这一行到底发生了什么。
2. 画出 `get_current_user` 的依赖图，并说明 `get_db` 为什么用 `yield`。
3. 用 `dependencies=[...]` 给整组路由加鉴权而不改函数签名。
4. 用 `dependency_overrides` 在测试里换掉数据库。
5. 说出同步依赖与异步依赖在并发上的区别。

**验收标准**

- 能解释「同一个请求里两次 `Depends(get_db)` 拿到的是同一个 Session」。
- 能说清生成器依赖在**抛异常**时是否执行 `yield` 之后的代码。
- 能写一个「只做副作用、不注入值」的依赖。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [05-FastAPI核心/01 Pydantic v2](./01-Pydantic-v2模型与校验.md)、[04-Web基础/03 路由、参数与响应](../04-Web基础与FastAPI起步/03-路由、参数与响应.md) |
| 已掌握 | 函数是一等公民、闭包、生成器、上下文管理器（[01-Python进阶/02](../01-Python进阶/02-迭代器与生成器.md)、[01-Python进阶/04](../01-Python进阶/04-上下文管理器与dataclass.md)） |

---

## 3. 没有依赖注入时的样子

### 3.1 每个接口自己建 Session

```python
@app.get("/apps")
def list_apps():
    session = SessionLocal()          # 重复
    try:
        apps = session.scalars(select(App)).all()
    finally:
        session.close()               # 容易忘
    return apps
```

| 问题 | 后果 |
| --- | --- |
| 重复样板 | 每个接口 5 行 |
| 容易漏 `close()` | 连接泄漏，池被耗尽 |
| 鉴权逻辑重复 | 每个接口抄一遍解析 token |
| 无法替换 | 测试里没法换成内存库 |
| 隐式全局 | 想在中间件里换实现很难 |

### 3.2 有了依赖注入

```python
@app.get("/apps")
def list_apps(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ...
```

| 收益 | 说明 |
| --- | --- |
| 声明式 | 只写「我要什么」，不写「怎么造」 |
| 可组合 | 依赖可以依赖别的依赖 |
| 生命周期统一 | 生成器依赖负责关闭 |
| 可替换 | `dependency_overrides` 一键换实现 |
| 文档可见 | 依赖的参数会进 OpenAPI |

---

## 4. `Depends` 的基本语义

### 4.1 参数值来自函数返回值

```python
from fastapi import Depends


def get_page_size() -> int:
    return 20


@app.get("/apps")
def list_apps(limit: int = Depends(get_page_size)):
    return {"limit": limit}          # limit == 20
```

展开理解：

```
FastAPI 看到 limit 的默认值是 Depends(get_page_size)
  → 调用 get_page_size()
  → 把返回值赋给 limit
  → 再调用你的视图函数
```

| 事实 | 说明 |
| --- | --- |
| 不写 `Depends(...)` 的默认值 | 那就是普通 Python 默认值 |
| 依赖函数**可以有参数** | 那些参数又会被当依赖/查询参数解析 |
| 依赖不会自动执行 | 只有被引用时才执行 |

### 4.2 依赖也可以带请求参数

```python
def pagination(
    limit: int = 20,
    offset: int = 0,
) -> dict:
    return {"limit": limit, "offset": offset}


@app.get("/apps")
def list_apps(page: dict = Depends(pagination)):
    return page
```

请求 `GET /apps?limit=50&offset=100` → `page == {"limit": 50, "offset": 100}`。

> 关键：**依赖函数的参数同样遵循「参数来源判定」规则**（阶段 4/03）——所以 `limit: int` 自动变成 query 参数，并出现在 `/docs`。

### 4.3 依赖可以返回任意类型

| 返回 | 用途 |
| --- | --- |
| 标量 | `uid: str = Depends(get_uid)` |
| 模型 | `user: User = Depends(get_current_user)` |
| 字典/配置 | `cfg: Settings = Depends(get_settings)` |
| 对象 | `db: Session = Depends(get_db)` |
| `None` | 纯副作用依赖 |

---

## 5. 依赖图与缓存

### 5.1 依赖链

```python
def get_settings_dep() -> Settings:
    return settings


def get_client(cfg: Settings = Depends(get_settings_dep)):
    return create_client(cfg)


@app.get("/x")
def handler(client=Depends(get_client), cfg=Depends(get_settings_dep)):
    ...
```

依赖图：

```
handler
├── get_client
│   └── get_settings_dep
└── get_settings_dep        ← 同一个依赖，被引用了两次
```

### 5.2 同请求内默认只执行一次

**FastAPI 默认会缓存同一请求内相同依赖的结果**（`use_cache=True`）。

| 场景 | 行为 |
| --- | --- |
| `handler` 与 `get_client` 都要 `get_settings_dep` | 只调用一次，共享同一对象 |
| 想每次新建 | `Depends(fn, use_cache=False)` |

```python
def make_request_id() -> str:
    return uuid.uuid4().hex

@app.get("/a")
def a(r1: str = Depends(make_request_id, use_cache=False),
      r2: str = Depends(make_request_id, use_cache=False)):
    return {"r1": r1, "r2": r2}      # 两个不同 id
```

> 这条缓存是**并发安全的正确性保障**：一个请求只应有一个 `Session`、一个「当前用户」。想每次都新造对象时（如每次都要新 ID、新随机数），才关缓存。

---

## 6. 生成器依赖：资源的正确姿势

### 6.1 基本形状

```python
from collections.abc import Iterator

def get_db() -> Iterator[Session]:
    with SessionLocal() as session:        # setup
        yield session                      # 交给视图
        # teardown（yield 之后）由 with 负责关闭
```

FastAPI 对生成器依赖的处理：

```
1. 调用 get_db() → 拿到生成器
2. next() → 执行到 yield，得到 session → 注入视图
3. 视图执行完（无论成功/异常）
4. 继续 next() → 执行 yield 之后的代码 → 关闭 session
```

| 要点 | 说明 |
| --- | --- |
| `yield` 之后一定会执行 | **包括视图抛异常时**（等价 `try/finally`） |
| 只能 `yield` 一次 | 多次 `yield` 会报错 |
| 依赖本身可 `try/except/finally` | 可做回滚、日志、埋点 |
| 类型标注 | `Iterator[X]` 或 `Generator[X, None, None]` |

### 6.2 用 `with` 还是 `try/finally`

```python
# 写法 A：靠 with（项目用这个）
def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session

# 写法 B：显式 try/finally
def get_db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
```

两者等价。`with` 更短，且 `Session` 本身就是上下文管理器（[01-Python进阶/04](../01-Python进阶/04-上下文管理器与dataclass.md) §3）。

### 6.3 带事务的依赖

```python
def get_tx_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()          # 视图正常结束才提交
    except Exception:
        session.rollback()        # 异常回滚
        raise                     # ⚠️ 必须重抛，否则异常被吞
    finally:
        session.close()
```

| 要点 | 说明 |
| --- | --- |
| `commit` 放 `yield` 之后 | 视图里不用手动 commit |
| 异常必须 `raise` | 否则 FastAPI 看不到错误，客户端收到 200 |
| 与项目现状的差异 | 项目在视图里显式 `db.commit()`——更直白，适合多写场景 |

> 两种风格都合法：**「依赖管事务」适合简单 CRUD；「视图管事务」适合一个请求里多段独立提交**（如先写 run 再写 event）。

### 6.4 生成器依赖能返回值吗

不能 `return`——只能 `yield`。想在清理时用到视图的结果，用 `try/finally` 包住 `yield` 即可（值在 `yield` 处已交给视图）。

---

## 7. 类作为依赖

### 7.1 可调用对象

```python
class Paginator:
    def __init__(self, limit: int = 20, offset: int = 0):
        self.limit = limit
        self.offset = offset

    def __call__(self) -> dict:
        return {"limit": self.limit, "offset": self.offset}


@app.get("/apps")
def list_apps(page: dict = Depends(Paginator())):
    ...
```

| 写法 | 特点 |
| --- | --- |
| `Depends(Paginator)` | `__init__` 的参数被当依赖/query 解析 |
| `Depends(Paginator())` | 实例已建好，参数不会自动解析 |

> 类依赖的价值：**把配置与行为打包**，还能复用实例状态。

### 7.2 带 `__init__` 依赖的类（更常见）

```python
class CurrentUser:
    def __init__(self, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        self.user = user
        self.db = db

    def require_role(self, role: str) -> None:
        if self.user.role != role:
            raise HTTPException(403, "Forbidden")


@app.get("/admin")
def admin(me: CurrentUser = Depends(CurrentUser)):
    me.require_role("admin")
    return {"ok": True}
```

> 这就是「依赖对象」模式：**一次注入，多次使用内部能力**。

---

## 8. 依赖的三个层级

### 8.1 参数级（函数签名）

```python
def handler(db=Depends(get_db), user=Depends(get_current_user)): ...
```

最常用，值注入到函数里。

### 8.2 路由级（装饰器）

```python
@router.get("/apps", dependencies=[Depends(require_admin)])
def list_apps(): ...
```

| 特点 | 说明 |
| --- | --- |
| 只执行，不注入 | 返回值被丢弃 |
| 适合副作用 | 鉴权、限流、审计日志 |
| 顺序 | 装饰器里的依赖**先于**函数参数依赖执行 |

### 8.3 `APIRouter` 级（整组生效）

```python
router = APIRouter(
    prefix="/apps",
    tags=["apps"],
    dependencies=[Depends(get_current_user)],     # 整组都要登录
)
```

| 层级 | 作用范围 |
| --- | --- |
| `app = FastAPI(dependencies=[...])` | 全局 |
| `APIRouter(dependencies=[...])` | 该 router 下所有路由 |
| `@router.get(..., dependencies=[...])` | 单个路由 |
| 参数 `Depends(...)` | 单个函数，且能拿到值 |

> 项目没有用 router 级依赖，而是在每个视图参数里写 `current_user: User = Depends(get_current_user)`——**因为多数接口需要用户 id 本身**，只执行不注入反而要再取一次。

### 8.4 执行顺序

```python
@router.get("/x", dependencies=[Depends(a), Depends(b)])
def handler(c=Depends(c_dep), d=Depends(d_dep)): ...
```

执行顺序：

```
a → b → c_dep → d_dep → handler
```

> 若 `a` 抛异常，后面全部不执行——这是「鉴权放装饰器级」能省一次 DB 查询的原因。

---

## 9. `Security` 与 `Depends`

```python
from fastapi import Security
from fastapi.security import HTTPBearer

bearer = HTTPBearer()

@router.get("/me")
def me(cred=Security(bearer)):
    ...
```

| 对比 | `Depends` | `Security` |
| --- | --- | --- |
| 基本行为 | 一致 | 一致 |
| OpenAPI 安全方案 | 不声明 | ✅ 声明 `securitySchemes` |
| `scopes` | 不支持 | `Security(fn, scopes=["admin"])` |
| `/docs` 里的锁图标 | 无 | 有 |

> **只要涉及认证，就用 `Security`**——`/docs` 才会出现「Authorize」按钮，前端联调更顺（阶段 7 展开）。

---

## 10. 测试时替换依赖

```python
from app.main import app
from app.api.deps import get_db


def fake_db():
    yield FakeSession()


app.dependency_overrides[get_db] = fake_db
```

| 要点 | 说明 |
| --- | --- |
| key 必须是**同一个函数对象** | 用 `from app.api.deps import get_db`，别再包一层 |
| 覆盖是全局的 | 测试结束要清理 |
| 可以覆盖多个 | 逐个设置 |
| 也支持覆盖 `Security` 依赖 | 直接替换 `get_current_user` |

```python
import pytest

@pytest.fixture(autouse=True)
def _override():
    app.dependency_overrides[get_db] = fake_db
    yield
    app.dependency_overrides.clear()
```

> 这是 FastAPI 测试最省事的地方：**不用 mock 框架，只换函数**（阶段 9 写完整测试）。

---

## 11. 同步依赖 vs 异步依赖

```python
def get_db_sync() -> Iterator[Session]:
    with SessionLocal() as s:
        yield s

async def get_db_async() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as s:
        yield s
```

| 依赖类型 | 执行位置 | 阻塞影响 |
| --- | --- | --- |
| `def`（同步） | **线程池**（Starlette 自动 `run_in_threadpool`） | 不阻塞事件循环，但占线程 |
| `async def` | 事件循环 | 绝不能有阻塞调用 |

| 项目现状 | 说明 |
| --- | --- |
| `get_db` 是 `def` + 同步 `Session` | 交给线程池执行，安全但线程数有限 |
| 视图也是 `def` | 整条链路走线程池（SQLAlchemy 同步 ORM） |

> 若把同步 `Session` 用在 `async def` 视图里，会**阻塞事件循环**（[02-异步/01](../02-异步与并发/01-GIL与并发模型选择.md) §7 的三层并发）。项目选择了「全同步视图 + 同步 Session」这条简单路线，是有意取舍。

---

## 12. 项目实战：`deps.py` 逐行

### 12.1 真实文件

`apps/api-py/app/api/deps.py`：

```python
bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def _unauthorized(message: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        _unauthorized("Missing bearer token")
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception:
        _unauthorized("Invalid or expired token")
    user = db.get(User, payload.get("sub"))
    if user is None:
        _unauthorized("User no longer exists")
    return user
```

### 12.2 依赖图

```
get_current_user
├── bearer_scheme（HTTPBearer 实例）
└── get_db
    └── （SessionLocal 连接池）
```

视图侧：

```python
@router.get("", response_model=AppListResponse)
def list_apps(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),        # ← 与 get_current_user 内部共享同一个 Session
) -> AppListResponse:
    ...
```

> **同一个请求里，`get_db` 只执行一次**（§5.2 的缓存）——所以视图拿到的 `db` 与 `get_current_user` 用的是**同一个 Session**。这是「当前用户已在该 Session 的 identity map 里」的前提，也避免了同请求开两条连接。

### 12.3 五个设计决策

| 代码 | 为什么这样写 |
| --- | --- |
| `HTTPBearer(auto_error=False)` | 让「没带 token」由**我们**返回统一错误体；`auto_error=True` 会抛 FastAPI 默认的 403（语义也不对） |
| `credentials is None → 401` | 未认证就是 401，不是 403 |
| `except Exception` 包住 `decode` | 过期/签名错/格式错统一变 401，不泄露具体原因 |
| `db.get(User, payload.get("sub"))` | **查库确认用户仍存在**（token 有效但用户被删） |
| `headers={"WWW-Authenticate": "Bearer"}` | HTTP 规范要求 401 带此头；浏览器/客户端据此触发凭据流程 |

### 12.4 一个可以改进的点

```python
except Exception:            # 当前写法
    _unauthorized("Invalid or expired token")
```

| 风险 | 说明 |
| --- | --- |
| 吞掉所有异常 | `KeyError`/`TypeError` 这类代码 bug 也会被伪装成 401，排查困难 |
| 改进 | 只捕 `jwt.PyJWTError` 子类（`ExpiredSignatureError`/`InvalidSignatureError`） |

```python
import jwt

try:
    payload = decode_access_token(credentials.credentials)
except jwt.PyJWTError:
    _unauthorized("Invalid or expired token")
```

> 这与 [00-Python基础/05](../00-Python基础/05-异常与文件IO.md) §5 的原则一致：**捕获范围要精确**。

### 12.5 `_unauthorized` 为什么返回 `NoReturn`

```python
def _unauthorized(message: str) -> NoReturn:
```

| 作用 | 说明 |
| --- | --- |
| 类型层面告诉 mypy「这里不会返回」 | 之后的 `payload` 才不会被判定为「可能未定义」 |
| 阅读层面表明「必然抛异常」 | 比返回 `None` 更清楚 |

> 这是「用类型系统省掉一个 `return`」的小技巧，`typing.Never`（3.11+）等价。

---

## 13. 与 NestJS 对照

| FastAPI | NestJS | 说明 |
| --- | --- | --- |
| `Depends(get_db)` | 构造函数注入 `@Inject()` | 都是 DI |
| 依赖函数参数 | provider 的构造参数 | 都能继续解析依赖 |
| 同请求缓存 | 默认单例（`Scope.DEFAULT`） | 语义相近 |
| `use_cache=False` | `Scope.TRANSIENT` | 每次新建 |
| 生成器依赖 `yield` | `OnModuleDestroy` / `finally` | 生命周期 |
| `dependencies=[Depends(x)]` | `@UseGuards(AuthGuard)` | 只执行不注入 |
| `APIRouter(dependencies=[...])` | 控制器级 `@UseGuards()` | 整组生效 |
| `Security(bearer)` | `@ApiBearerAuth()` | OpenAPI 声明 |
| `dependency_overrides` | `Test.createTestingModule().overrideProvider()` | 测试替换 |
| `def` 依赖走线程池 | 无对应（Node 单线程） | Python 特有 |

> 心智迁移：**NestJS 的 provider 是「类 + token」，FastAPI 的依赖是「函数 + 返回值」**。前者更重但可全局管理，后者更轻但更贴近普通函数调用。

---

## 14. 验收自测

### 14.1 预测行为

```python
def dep():
    print("dep")
    return 1

@app.get("/x")
def x(a: int = Depends(dep), b: int = Depends(dep)):
    return {"a": a, "b": b}
```

请求一次 `/x`，`dep` 打印几次？

<details>
<summary>答案</summary>

**1 次**——同请求内默认缓存（`use_cache=True`）。

</details>

### 14.2 找错

```python
def get_db():
    session = SessionLocal()
    yield session
    session.close()
```

两个问题：

1. 没 `try/finally`：视图抛异常时 `close()` 可能不被执行（取决于 FastAPI 的实现细节，不能依赖）；
2. 更稳妥的写法是 `with SessionLocal() as session:`，让上下文管理器保证释放。

### 14.3 动手题

写一个 `require_role(role)` 工厂依赖：返回一个函数，校验当前用户角色，不符则 403；再用 `dependencies=[...]` 挂到 `/admin` 路由上。

<details>
<summary>参考</summary>

```python
def require_role(role: str):
    def checker(user: User = Depends(get_current_user)) -> None:
        if user.role != role:
            raise HTTPException(status_code=403, detail="Forbidden")
    return checker


@router.get("/admin", dependencies=[Depends(require_role("admin"))])
def admin_only():
    return {"ok": True}
```

要点：外层接收配置（`role`），内层才是真正的依赖函数——这就是「依赖工厂」。

</details>

---

## 15. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 依赖没执行 | 只在签名里写了类型注解，没写 `Depends` | `x = Depends(fn)` |
| 依赖函数里的参数变成必填 query | 依赖参数同样参与解析 | 给默认值或用 `Query`/`Header` |
| 一个请求开了两条连接 | 不同请求各自创建；同请求已缓存 | 别在依赖里手动 `SessionLocal()` |
| 想每次新建却拿到同一个 | 默认缓存 | `use_cache=False` |
| 资源没释放 | 生成器依赖只 `yield` 没清理 | `with` 或 `try/finally` |
| 生成器依赖写了两个 `yield` | 协议只支持一次 | 只保留一个 |
| `dependency_overrides` 不生效 | key 与路由里用的不是同一对象 | 用同一个导入路径的函数对象 |
| 测试间互相污染 | 覆盖后没清理 | fixture 里 `clear()` |
| 装饰器依赖拿不到返回值 | `dependencies=` 只执行不注入 | 需要值就写参数 |
| 401 被浏览器当成 403 | 缺 `WWW-Authenticate` | 补响应头 |
| 403 与 401 混用 | 语义混淆 | 未认证 401、无权限 403 |
| 同步依赖阻塞事件循环 | 在 `async def` 依赖里做阻塞 IO | 改 `def`（走线程池）或全异步 |
| 依赖里 `except Exception` 掩盖 bug | 捕获过宽 | 捕具体异常类型 |
| 全局依赖里抛异常导致全站 500 | 依赖在每次请求都执行 | 确认依赖的作用范围 |

---

## 16. 本篇小结

- **`Depends(fn)` 的语义**：调用 `fn`，把**返回值**注入参数；`fn` 自己的参数继续参与解析。
- **依赖可组合**：依赖可以依赖依赖，形成 DAG。
- **同请求默认缓存**：同一个依赖只执行一次 → 一个请求一个 `Session`、一个当前用户。
- **`use_cache=False`** 用于「每次都要新对象」的场景。
- **生成器依赖管生命周期**：`yield` 前 setup、后 teardown，**异常路径也会清理**。
- **事务可以放依赖里**，但异常必须 `raise`，否则错误被吞。
- **三个层级**：参数级（注入值）→ 路由级（只执行）→ router 级（整组）。
- **执行顺序**：装饰器依赖先于参数依赖；鉴权放前面能省掉后续查询。
- **认证用 `Security`**，`/docs` 才有 Authorize 按钮与安全方案。
- **测试用 `dependency_overrides`**：key 必须是同一个函数对象，用完清理。
- **同步依赖走线程池**给同步 ORM 兜底；`async def` 里绝不能阻塞。
- **项目范式**：`get_db`（生成器 + `with`）+ `get_current_user`（`HTTPBearer(auto_error=False)` → 401 带 `WWW-Authenticate` → 查库确认用户存在）。
- **改进点**：`except Exception` 应收窄到 `jwt.PyJWTError`；`_unauthorized` 用 `NoReturn` 让类型检查知道「此处必抛」。
- **下一步**：异常处理与错误契约——把 `HTTPException`、校验错误、未捕获异常统一成同一个响应信封。
