# 04 · 上下文管理器与 dataclass

> 所属：阶段 1 · Python 进阶
> 本篇覆盖：`with` 的协议实现（`__enter__`/`__exit__`）、`as` 绑定返回值、`__exit__` 的异常参数与「抑制异常」、手写上下文管理器类、`@contextmanager`（生成器版）、`contextlib.ExitStack`、`async with` 预告、`@dataclass` 自动生成 `__init__`/`__repr__`/`__eq__`、`field`/`default_factory`、`frozen`/`order`/`kw_only`/`slots`、`__post_init__`、dataclass vs Pydantic vs TypedDict
> **本篇首次教学：上下文管理协议与 `__exit__` 三参数（异常抑制的机制）、`@contextmanager` 用生成器写上下文管理器及其等价 `try/finally`、`ExitStack` 动态管理多个资源、`async with`/`__aenter__` 预告、`@dataclass` 全套参数与 `field(default_factory=...)`、`__post_init__` 校验、`frozen` 不可变与 `__hash__`、dataclass 与 Pydantic/TypedDict 的选型**（`with open` 的基础用法在 `00-Python基础/05` 已讲，本篇讲协议实现；Pydantic 校验细节见 `05-FastAPI核心/01`）
> 预告：阶段 1 收官。阶段 2 开始——下一篇讲 GIL 与并发模型选择（为什么 FastAPI 用异步、什么时候用多进程）。

> 项目锚点：`apps/api-py/app/api/deps.py`（`get_db()` 用 `with SessionLocal() as session: yield session` —— 上下文管理器 + 生成器 + FastAPI 依赖生命周期的三合一）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 手写一个上下文管理器类，并解释 `__exit__` 返回值的作用。
2. 用写一个 `@contextmanager` 版本，知道它的等价 `try/finally` 结构。
3. 用 `@dataclass` 替代「手写 `__init__` + `__repr__` + `__eq__`」的样板代码。
4. 正确使用 `field(default_factory=list)` 避开可变默认值错误。
5. 在 dataclass / Pydantic / TypedDict 之间做出正确选择。

**验收标准**

- 能解释 `class Res: def __exit__(self, *exc): return True` 会导致什么。
- 能写出 `@contextmanager` 版的「事务提交/回滚」。
- 能说明 `@dataclass(frozen=True)` 为什么能放进 `set`。
- 能读懂 `deps.py` 的 `get_db()` 在 FastAPI 里何时打开、何时关闭。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [02 迭代器与生成器](./02-迭代器与生成器.md)（`yield` 的执行模型是 `@contextmanager` 的基础）、[03 装饰器与闭包](./03-装饰器与闭包.md)（`@` 语法与 `wraps`）、[00-Python基础/05](../00-Python基础/05-异常与文件IO.md)（`with open` 与 `try/finally`） |
| 已掌握 | `try/finally`、生成器、装饰器、类 |

---

## 3. 上下文管理协议（首次教学）

### 3.1 回顾：`with` 做了什么

```python
with open("data.txt", encoding="utf-8") as f:
    text = f.read()
```

展开为：

```python
f = open("data.txt", encoding="utf-8")
_f = f.__enter__()          # ① 进入：返回值绑定给 as
try:
    text = _f.read()        # ② 使用
finally:
    f.__exit__(None, None, None)   # ③ 退出：一定调用
```

### 3.2 两个魔术方法的签名

```python
class MyRes:
    def __enter__(self):
        """进入：返回什么，as 就拿到什么。"""
        return self

    def __exit__(self, exc_type, exc, tb):
        """退出：exc_type/exc/tb 是异常信息；无异常时三者均为 None。
        返回 True 表示「已处理，抑制异常」；返回 None/False 表示异常继续传播。
        """
        return None
```

| 场景 | `exc_type` | `exc` | `tb` | `__exit__` 返回值的影响 |
| --- | --- | --- | --- | --- |
| 正常结束 | `None` | `None` | `None` | 无影响 |
| 块内抛异常 | 异常类 | 异常实例 | traceback | `None`/`False` → 继续抛；`True` → 吞掉 |
| 块内 `return`/`break` | `None` | `None` | `None` | 正常收尾 |

> **`return True` 会静默吞掉异常**，是危险操作。除非你明确在做「抑制特定异常」的事（如 `contextlib.suppress`），否则一律返回 `None`。

### 3.3 手写一个上下文管理器

```python
import time


class Timer:
    """统计代码块耗时。"""

    def __init__(self, label: str = "block"):
        self.label = label
        self.elapsed = 0.0

    def __enter__(self):
        self._start = time.perf_counter()
        return self                     # as 拿到 Timer 实例，可读 elapsed

    def __exit__(self, exc_type, exc, tb):
        self.elapsed = time.perf_counter() - self._start
        print(f"[{self.label}] {self.elapsed * 1000:.2f} ms")
        return None                     # 不抑制异常


with Timer("sleep") as t:
    time.sleep(0.05)

print(t.elapsed > 0)      # True
```

关键：`__enter__` 的返回值决定 `as` 变量拿到什么。返回 `self` 是最常见的做法。

---

## 4. `@contextmanager`：用生成器写（首次教学）

### 4.1 写法

```python
from contextlib import contextmanager


@contextmanager
def timer(label: str = "block"):
    start = time.perf_counter()
    try:
        yield                            # ← 这里就是 with 块的内容
    finally:
        elapsed = (time.perf_counter() - start) * 1000
        print(f"[{label}] {elapsed:.2f} ms")


with timer("sleep"):
    time.sleep(0.05)
```

### 4.2 等价关系（一定要理解）

```
@contextmanager
def cm():
    <前置>
    try:
        yield value        ←→  with cm() as value:  <块内容>
    finally:
        <后置>
```

| 生成器部分 | 对应 `with` 的哪一步 |
| --- | --- |
| `yield` 之前 | `__enter__`（进入时执行） |
| `yield` 出的值 | `as` 绑定的值 |
| `yield` 之后（`finally` 里） | `__exit__`（退出时执行） |
| `yield` 处收到的异常 | 块内抛出的异常会**在 `yield` 处重新抛出** |

> 这就是 [02 篇](./02-迭代器与生成器.md)「生成器可暂停」的实际用途之一。也解释了为什么 `@contextmanager` 必须**恰好 `yield` 一次**：0 次报 `RuntimeError: generator didn't yield`，2 次报 `generator didn't stop`。

### 4.3 异常如何传播

```python
@contextmanager
def safe():
    try:
        yield
    except ValueError as e:
        print("捕获到:", e)         # 处理了异常
    finally:
        print("清理")


with safe():
    raise ValueError("boom")
```

输出：

```
捕获到: boom
清理
```

说明：`@contextmanager` 的异常**表现为在 `yield` 处抛出**，所以可以用普通 `try/except` 处理。`except` 捕获后不再重抛 → 等价于 `__exit__` 返回 `True`（抑制）。

### 4.4 什么时候用哪种

| 方式 | 适用 |
| --- | --- |
| 类 + `__enter__/__exit__` | 需要保存状态、要被多处复用、要实现多个方法 |
| `@contextmanager` | 逻辑简单（一段前置 + 一段后置），代码更短 |
| `contextlib.closing` / `suppress` | 现成工具，别重复造 |

```python
from contextlib import closing, suppress

with closing(open("a.txt", encoding="utf-8")) as f: ...   # 只管关闭
with suppress(FileNotFoundError):                          # 忽略指定异常
    open("maybe-missing.txt")
```

---

## 5. 典型应用场景

### 5.1 事务提交/回滚（最常用的业务场景）

```python
@contextmanager
def transaction(session):
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise                    # 回滚后必须重抛，别吞掉
```

```python
with transaction(db) as tx:
    tx.add(User(email="a@b.com"))
```

要点：

- 成功 → `commit`；
- 出错 → `rollback` **并重新抛出**（否则调用方以为成功了）；
- 这正是 `try/except/else` 的经典用法（[00-Python基础/05](../00-Python基础/05-异常与文件IO.md)）。

### 5.2 临时切换目录

```python
import os
from contextlib import contextmanager


@contextmanager
def chdir(path):
    old = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)          # 无论是否异常都切回来
```

### 5.3 临时改配置

```python
@contextmanager
def patched(obj, **attrs):
    old = {k: getattr(obj, k) for k in attrs}
    for k, v in attrs.items():
        setattr(obj, k, v)
    try:
        yield obj
    finally:
        for k, v in old.items():
            setattr(obj, k, v)
```

> 测试里改配置、改环境变量（`monkeypatch` 就是这类工具），都靠「进-用-复原」。

### 5.4 锁

```python
import threading

lock = threading.Lock()

with lock:                 # Lock 本身就是上下文管理器
    ...
```

---

## 6. `ExitStack`：动态管理多个资源（了解）

有时资源数量要到运行时才知道：

```python
from contextlib import ExitStack

def process(paths: list[str]) -> list[str]:
    with ExitStack() as stack:
        files = [stack.enter_context(open(p, encoding="utf-8")) for p in paths]
        # 退出 with 时，所有文件按「后进先出」自动关闭
        return [f.readline().strip() for f in files]
```

也常用于「手动注册清理函数」：

```python
with ExitStack() as stack:
    stack.callback(print, "最后执行")
    stack.callback(print, "先执行")      # 后注册的先执行
```

| 能力 | 说明 |
| --- | --- |
| `enter_context(cm)` | 动态进入任意上下文管理器 |
| `callback(fn, *args)` | 注册退出时调用的普通函数 |
| 顺序 | **LIFO**（后进先出） |

---

## 7. `async with` 预告

异步资源（数据库连接池、`httpx.AsyncClient`、文件流）用：

```python
async with httpx.AsyncClient() as client:
    resp = await client.get(url)
```

对应的协议是：

```python
class AsyncRes:
    async def __aenter__(self): ...
    async def __aexit__(self, exc_type, exc, tb): ...
```

`@contextmanager` 的异步版是 `@asynccontextmanager`：

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    # 启动
    yield
    # 关闭
```

> FastAPI 的 `lifespan` 用的就是它（阶段 5/04）。本篇只需知道「同步 `with` 有异步孪生兄弟」。

---

## 8. `@dataclass`（首次教学）

### 8.1 问题：样板代码太多

```python
class Chunk:
    def __init__(self, id: str, content: str, score: float = 0.0):
        self.id = id
        self.content = content
        self.score = score

    def __repr__(self):
        return f"Chunk(id={self.id!r}, content={self.content!r}, score={self.score!r})"

    def __eq__(self, other):
        if not isinstance(other, Chunk):
            return NotImplemented
        return (self.id, self.content, self.score) == (other.id, other.content, other.score)
```

三段样板，改字段要改三处。用 `@dataclass`：

```python
from dataclasses import dataclass


@dataclass
class Chunk:
    id: str
    content: str
    score: float = 0.0


c = Chunk("1", "hello")
print(c)                    # Chunk(id='1', content='hello', score=0.0)
print(c == Chunk("1", "hello"))    # True（自动 __eq__）
```

### 8.2 它生成了什么

`@dataclass` 读取**类属性 + 类型注解**，自动生成：

| 生成项 | 触发条件 |
| --- | --- |
| `__init__` | 总是 |
| `__repr__` | 默认 `repr=True` |
| `__eq__` | 默认 `eq=True` |
| `__hash__` | `eq=True` 且 `frozen=True` 时生成 |
| 排序方法（`<`/`<=`/`>`/`>=`） | `order=True` |

> 注意：**类型注解不校验**。`Chunk(1, "x")` 照样能构造成功——dataclass 不是校验器（[01 篇](./01-类型注解与typing.md) 的结论在这里再次出现）。

### 8.3 可变默认值：`default_factory`

```python
@dataclass
class Bad:
    tags: list[str] = []          # ❌ ValueError: mutable default ...
```

错误信息：

```
ValueError: mutable default <class 'list'> for field tags is not allowed: use default_factory
```

正确写法：

```python
from dataclasses import dataclass, field


@dataclass
class Good:
    tags: list[str] = field(default_factory=list)
    meta: dict[str, str] = field(default_factory=dict)
```

原理：等价于 [00-Python基础/03](../00-Python基础/03-函数与作用域.md) 的可变默认参数陷阱——默认值在**定义时求值一次**，所有实例共享。`default_factory` 每次实例化时**调用一次工厂**，各得一份新的。

### 8.4 `frozen`、`order`、`kw_only`、`slots`

```python
@dataclass(frozen=True, order=True)
class Point:
    x: int
    y: int


p = Point(1, 2)
# p.x = 3                      # ❌ FrozenInstanceError
print(Point(1, 2) < Point(1, 3))     # True（order 生成比较）
print({Point(1, 2), Point(1, 2)})    # 可哈希 → 能进 set
```

| 参数 | 作用 |
| --- | --- |
| `frozen=True` | 不可变；自动生成 `__hash__`；可作 `dict` 键/进 `set` |
| `order=True` | 按字段顺序生成比较方法 |
| `kw_only=True` | 所有字段只能关键字传参（避免位置参数错位） |
| `slots=True` | 用 `__slots__` 省内存、禁动态属性（3.10+） |
| `eq=False` | 不生成 `__eq__`（退化为身份比较） |
| `repr=False` | 不生成 `__repr__` |

```python
@dataclass(slots=True)
class Node:
    id: str
    weight: float = 0.0
```

> `slots=True` 在节点这类「创建成千上万个」的场景能明显降内存。

### 8.5 `field()` 的常用选项

```python
@dataclass
class Task:
    name: str
    retries: int = field(default=3, repr=False)         # 不出现在 repr
    cache_key: str = field(compare=False, default="")    # 不参与 ==
    created_at: str = field(default="", init=False)      # 不进 __init__
```

### 8.6 `__post_init__`：构造后处理

dataclass 不能像 Pydantic 那样声明式校验，但可以在这里补：

```python
@dataclass
class SplitConfig:
    chunk_size: int
    chunk_overlap: int = 0

    def __post_init__(self):
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap 必须小于 chunk_size")
        self.chunk_overlap = max(0, self.chunk_overlap)
```

> **注意**：`frozen=True` 时 `__post_init__` 里不能用 `self.x = ...`，需用 `object.__setattr__(self, "x", ...)`。

### 8.7 dataclass 继承

```python
@dataclass
class Node:
    id: str
    title: str = ""


@dataclass
class LlmNode(Node):
    model: str = "gpt-4o-mini"


print(LlmNode("n1", "标题", "gpt-4o"))
# LlmNode(id='n1', title='标题', model='gpt-4o')
```

规则：**父类有默认值的字段 → 子类新增字段也必须给默认值**（否则 `TypeError: non-default argument follows default argument`）。这是 dataclass 继承最常见的坑。

---

## 9. 选型：dataclass / Pydantic / TypedDict / NamedTuple

| 工具 | 运行期校验 | 可变性 | 开销 | 用在哪 |
| --- | --- | --- | --- | --- |
| `@dataclass` | ❌（可手写 `__post_init__`） | 默认可变，`frozen` 可不可变 | 低 | **内部数据结构**（引擎内部状态、配置容器） |
| Pydantic `BaseModel` | ✅ 完整校验 + 类型转换 | 默认可变 | 中（校验有成本） | **接口边界**（请求/响应/配置） |
| `TypedDict` | ❌ | 就是 dict | 几乎为零 | 描述已有 dict/JSON 的形状 |
| `NamedTuple` | ❌ | 不可变、可索引 | 低 | 需要元组语义（解包、索引） |

本项目实际分工：

| 位置 | 用什么 | 为什么 |
| --- | --- | --- |
| `app/config.py` → `Settings(BaseSettings)` | Pydantic | 要读 `.env` 并转换类型 |
| `app/api/*.py` 的请求体 | Pydantic | 要校验并生成 OpenAPI |
| `app/engine/` 内部状态 | 普通 dict / dataclass | 高频创建，不需要校验 |
| SSE 事件载荷 | dict（`TypedDict` 可加注解） | 每帧都要序列化，开销敏感 |

> 一句话：**边界用 Pydantic，内部用 dataclass，纯字典用 TypedDict。**

---

## 10. 项目实战：`get_db()` 的三重身份

完整文件路径：`apps/api-py/app/api/deps.py`

```python
def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
```

短短两行，同时用了三个知识点：

| 元素 | 作用 |
| --- | --- |
| `SessionLocal()` | SQLAlchemy `sessionmaker` 产出的 `Session`，**本身就是上下文管理器** |
| `with ... as session` | 进入时 `__enter__`（实际建立连接/事务），退出时 `__exit__`（关闭/归还连接） |
| `yield session` | 把函数变成**生成器**，供 FastAPI 的 `Depends` 在请求期间「挂起」使用 |

### 10.1 FastAPI 的执行时序

```
请求进来
  → Depends(get_db) 调用 get_db()
  → 执行到 with 进入、yield session（此时 session 交给路由函数）
  → 路由函数使用 session 查询
  → 响应生成完毕
  → FastAPI 恢复生成器 → with 块退出 → session 关闭（归还连接）
```

对比如果写成普通函数：

```python
def get_db_bad():
    session = SessionLocal()
    return session            # ❌ 永远没人 close → 连接泄漏
```

**`with` + 生成器**在这里的价值：把「打开资源—交出资源—保证关闭」写在一处，且关闭时机由框架的请求生命周期决定。

### 10.2 等价的 `@contextmanager` 写法

```python
from contextlib import contextmanager

@contextmanager
def db_session():
    with SessionLocal() as session:
        yield session
```

> FastAPI 的 `Depends` 对「生成器函数」的处理，本质上就是把它当作一个 `@contextmanager` 来驱动。理解了本篇的 `@contextmanager`，就理解了依赖注入的资源管理（阶段 5/02 展开 `Depends`）。

### 10.3 一个对照：TS 侧怎么写

NestJS 用 `PrismaService` + `OnModuleInit`/`OnModuleDestroy` 管理生命周期，粒度是**应用级**；FastAPI 的 `get_db` 粒度是**请求级**。

| 维度 | FastAPI `get_db` | NestJS 全局 PrismaService |
| --- | --- | --- |
| 连接创建 | 每请求（来自连接池） | 应用启动一次 |
| 释放 | 请求结束自动 `close` | 应用关闭时 `$disconnect` |
| 隔离性 | 每个请求独立 Session | 共享同一个客户端 |

> 两者都不矛盾：连接**池**是应用级，**会话/事务**是请求级。FastAPI 的 `SessionLocal` 每次从池里借一条连接，`with` 退出时归还。

---

## 11. 与 TypeScript 对照

| Python | TypeScript | 说明 |
| --- | --- | --- |
| `with res as x:` | `using x = res`（新规范）/ `try/finally` | Python 更普及 |
| `__enter__`/`__exit__` | `[Symbol.dispose]` | 协议名不同 |
| `@contextmanager` | 无直接对应（多用手写） | 生成器化的资源管理 |
| `async with` | `await using` | 都是异步资源 |
| `@dataclass` | `class` + 构造参数简写 | TS 语法更短，但需手写 `equals` |
| `frozen=True` | `readonly` | 都是不可变 |
| `default_factory=list` | `= []`（每次构造新建） | TS 天然每实例独立 |
| `@dataclass` 校验 | 无（需 zod/class-validator） | 都需外部库 |
| Pydantic `BaseModel` | zod schema | 校验在边界 |

> 心智迁移：TS 里 `using` 和装饰器都是新特性，未必普及；Python 的 `with` 与 `@dataclass` 是**标准库级、处处可用**的工具，务必熟练。

---

## 12. 验收自测

### 12.1 预测输出

```python
from contextlib import contextmanager


@contextmanager
def demo():
    print("enter")
    try:
        yield "value"
    finally:
        print("exit")


with demo() as v:
    print("body", v)
```

<details>
<summary>答案</summary>

```
enter
body value
exit
```
`yield` 前 = 进入，`yield` 的值 = `as` 绑定，`finally` = 退出。

</details>

### 12.2 找错

```python
@dataclass
class Cart:
    items: list[str] = []
```

问题：可变默认值。修复：

```python
@dataclass
class Cart:
    items: list[str] = field(default_factory=list)
```

### 12.3 动手题

写一个 `@contextmanager` 版 `transaction(session)`：

- 块内正常结束 → `commit`
- 块内抛异常 → `rollback` 并**重新抛出**

参考实现：

```python
from contextlib import contextmanager


@contextmanager
def transaction(session):
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    else:
        session.commit()
```

> 用 `else` 而不是把 `commit` 写在 `try` 里，可以避免「commit 本身抛异常时又被 rollback」的混乱。

---

## 13. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 异常被静默吞掉 | `__exit__` 返回 `True` | 返回 `None`/`False` |
| `RuntimeError: generator didn't yield` | `@contextmanager` 函数没执行到 `yield` | 检查提前 `return`/异常 |
| `generator didn't stop` | `yield` 了两次 | 只 `yield` 一次 |
| 资源没释放 | 没用 `with` / 手动 `close` 漏了异常分支 | 一律 `with` |
| `ValueError: mutable default` | dataclass 字段默认 `[]`/`{}` | `field(default_factory=list)` |
| dataclass 字段顺序报错 | 子类新增无默认字段在父类默认字段之后 | 新字段也给默认值，或用 `kw_only=True` |
| `TypeError: non-default argument follows default argument` | 同上 | 同上 |
| `FrozenInstanceError` | `frozen=True` 后赋值 | 用 `dataclasses.replace(obj, x=...)` |
| 以为 dataclass 会校验类型 | 它只生成方法 | 用 Pydantic，或在 `__post_init__` 校验 |
| `with` 里 `return` 后资源没关 | 会关（`finally` 语义） | 但注意 `__exit__` 仍执行，别在里面对已销毁对象操作 |
| 异步函数里用 `with open` 阻塞 | 同步 IO 阻塞事件循环 | 用 `async with` 的异步库，或丢进线程池（阶段 2/03） |

---

## 14. 本篇小结

- **上下文管理器 = `__enter__` + `__exit__`**：进入返回值绑定 `as`，退出**一定**执行。
- **`__exit__` 返回 `True` 会吞异常**——除刻意抑制，一律返回 `None`。
- **`@contextmanager` 是生成器版**：`yield` 前=进入，`yield` 值=`as`，`yield` 后（`finally`）=退出；异常在 `yield` 处重新抛出。
- **资源管理三原则**：一定 `with`、`finally` 里做清理、出错时「回滚 + 重抛」。
- **`ExitStack`** 动态管理多个资源（LIFO 顺序）。
- **`async with` / `@asynccontextmanager`** 是异步孪生版（FastAPI `lifespan` 用它）。
- **`@dataclass` 消除样板**：从「注解 + 类属性」生成 `__init__`/`__repr__`/`__eq__`，**但不校验类型**。
- **可变默认必须 `default_factory`**；`frozen` 带来不可变 + 可哈希；`slots` 省内存；`order` 生成比较。
- **继承要小心默认值顺序**：父类有默认值时，子类新字段也得有默认值。
- **选型口诀**：边界 Pydantic、内部 dataclass、纯字典 TypedDict、要元组语义 NamedTuple。
- **项目范式**：`get_db()` 用 `with` + `yield` 把「借连接—交出—归还」交给 FastAPI 的请求生命周期管理。
- **阶段 1 收官**，下一步进入阶段 2：GIL 与并发模型选择。
