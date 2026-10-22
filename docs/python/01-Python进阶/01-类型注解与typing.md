# 01 · 类型注解与 typing

> 所属：阶段 1 · Python 进阶
> 本篇覆盖：类型注解的运行期语义（只是元数据）、变量/参数/返回值注解、`X | None` 与 `Optional`、内建泛型 `list[int]`/`dict[str, int]`、`Literal`、`Any`、`Callable`、`TypeVar` 与 `Generic`、`TypedDict`、`Protocol`、前向引用与 `from __future__ import annotations`、`Annotated`、mypy/pyright 检查
> **本篇首次教学：类型注解是给工具看而非运行期强制的元数据、PEP 604 `X | None` 与内建泛型下标、`Literal`/`Any`/`Callable` 的取舍、`TypeVar`+`Generic` 泛型函数与类、`TypedDict` 描述 JSON 形状、`Protocol` 结构化子类型（鸭子类型的静态版）、前向引用与延迟注解、`Annotated` 附加元数据**（Pydantic/FastAPI 如何消费注解见 `05-FastAPI核心/01`；`@dataclass` 见 `01-Python进阶/04`）
> 预告：下一篇讲推导式与生成器（`[...]`/`{...}` 推导、`yield`、惰性求值、`itertools`）。

> 项目锚点：`apps/api-py/app/security.py`（完整注解的函数）、`apps/api-py/app/config.py`（`Field(default=...)` 带注解的字段声明）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 给函数、变量、类字段加正确的注解，并说清「注解在运行期**不会**做任何检查」。
2. 用 `X | None`、`list[dict[str, int]]` 这类现代写法替代 `Optional`/`List`。
3. 用 `TypeVar` 写泛型函数，用 `TypedDict` 描述 JSON 结构，用 `Protocol` 约束鸭子类型。
4. 解释 `from __future__ import annotations` 解决什么问题。
5. 用 mypy 或 pyright 跑一遍检查并读懂报错。

**验收标准**

- 能写出「参数是 `str | None`、返回 `list[Item]`」的函数签名。
- 能让 pyright/mypy 在**不运行代码**的情况下发现一处类型错误。
- 能说明 `Any` 与 `object` 的区别，以及为什么 `Any` 要少用。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [00-Python基础/06 面向对象](../00-Python基础/06-面向对象.md)（类、继承、鸭子类型） |
| 已掌握 | 函数、容器类型、类与 `Protocol` 的直觉 |

---

## 3. 类型注解到底是什么

### 3.1 一段带注解的代码

```python
def total_price(prices: list[float], discount: float = 0.0) -> float:
    return sum(prices) * (1 - discount)


print(total_price([100.0, 50.0], 0.1))    # 135.0
print(total_price(["a", "b"]))            # ❌ 运行期不报错 →
# TypeError: unsupported operand type(s) for +: 'int' and 'str'  （在 sum 内部才炸）
```

关键事实：

| 问题 | 答案 |
| --- | --- |
| 注解会在运行期检查吗？ | **不会**。Python 只是把它存进 `__annotations__` |
| 那它有什么用？ | IDE 补全、静态检查（mypy/pyright）、文档、**框架消费**（Pydantic/FastAPI） |
| 能当运行时校验用吗？ | 不能。要运行时校验就用 Pydantic（阶段 5）或手动 `if` |

```python
print(total_price.__annotations__)
# {'prices': list[float], 'discount': float, 'return': float}
```

### 3.2 为什么框架爱用注解

FastAPI 的一句 `def login(body: LoginRequest)` 就能自动完成：

```
注解 → Pydantic 模型 → 请求体解析 → 字段校验 → OpenAPI 文档 → 类型提示
```

这也解释了为什么本项目 `apps/api-py` 几乎**每个函数都有注解**：注解是双栈对齐（TS 有类型、Python 也要有）的基础设施。

---

## 4. 基础语法

### 4.1 变量、参数、返回值

```python
name: str = "api-py"                 # 变量注解
count: int = 0
items: list[str] = []                # 3.9+ 内建泛型可直接下标


def greet(name: str, times: int = 1) -> str:
    return f"hi {name} " * times


def log(msg: str) -> None:           # 无返回值写 None
    print(msg)
```

### 4.2 `None` 与可选值（PEP 604）

```python
def find_user(user_id: str) -> str | None:      # ✅ 现代写法（3.10+）
    ...


from typing import Optional

def find_user_old(user_id: str) -> Optional[str]:   # 旧写法，等价
    ...
```

| 写法 | 含义 | 建议 |
| --- | --- | --- |
| `str \| None` | 可能是 `str`，也可能是 `None` | **首选**（3.10+） |
| `Optional[str]` | 同上（**不是**「可选参数」的意思） | 老代码常见 |
| `str = None` | 语法上能跑，但类型不匹配 | ❌ 应写 `str \| None = None` |

> 常见误解：`Optional[X]` ≠ 「这个参数可以不传」。参数是否必传由**有没有默认值**决定。

### 4.3 常用容器注解

```python
names: list[str] = ["a", "b"]
scores: dict[str, int] = {"a": 1}
point: tuple[int, int] = (1, 2)
row: tuple[str, ...] = ("a", "b", "c")      # 变长同类型
unique: set[int] = {1, 2}
matrix: list[list[float]] = [[1.0], [2.0]]
```

> `list[str]` 只约束「元素是 str」，**不约束长度**；长度约束要靠 `tuple[str, str]` 或运行时校验。

### 4.4 `Any` 与 `object`

| 类型 | 含义 | 后果 |
| --- | --- | --- |
| `Any` | 「别管我」 | 关闭该处的类型检查，**错误会蔓延** |
| `object` | 「任何对象」 | 使用时必须先窄化（`isinstance`） |

```python
def bad(x: Any) -> Any:        # ❌ 类型信息全丢
    return x.upper()

def good(x: object) -> str:    # ✅ 强制窄化
    if not isinstance(x, str):
        raise TypeError("需要 str")
    return x.upper()
```

原则：**`Any` 只用在边界**（第三方库无类型、JSON 原始数据），并尽快转成具体类型。

---

## 5. `Literal`：值也是类型

```python
from typing import Literal

Mode = Literal["chat", "flow", "agent"]


def create_app(mode: Mode) -> None:
    ...


create_app("chat")        # ✅ 类型检查通过
create_app("other")       # ❌ 静态检查报错（运行期仍会执行）
```

用途：

- 枚举式字符串参数（比 `str` 精确得多）；
- 事件名、状态值、排序方向 `Literal["asc", "desc"]`；
- FastAPI 里能直接生成下拉选项（阶段 5）。

> 与 `enum.Enum` 的分工：`Literal` 零成本、适合简单字符串；需要方法/成员遍历时用 `Enum`。

---

## 6. `Callable`：函数也是类型

```python
from typing import Callable

Handler = Callable[[dict, str], None]      # 参数 (dict, str)，返回 None


def register(name: str, handler: Handler) -> None:
    ...


def on_event(payload: dict, event: str) -> None:
    print(event)


register("run", on_event)      # ✅
register("run", lambda p, e: None)   # ✅
```

> 项目 `tools/registry.py` 的工具注册、`engine/nodes/__init__.py` 的节点注册，本质都是「名字 → 可调用对象」的映射，注解写法与之对应（阶段 12 展开）。

---

## 7. `TypeVar` 与泛型（首次教学）

### 7.1 问题：如何表达「传入什么类型就返回什么类型」

```python
def first(items: list) -> object:          # ❌ 丢了类型信息
    return items[0]

x = first(["a"])      # x 被推断为 object，后面 .upper() 报错
```

### 7.2 用 `TypeVar` 绑定

```python
from typing import TypeVar

T = TypeVar("T")

def first(items: list[T]) -> T:
    return items[0]


a = first(["x", "y"])       # a: str
b = first([1, 2, 3])        # b: int
```

`T` 的意思是「**同一个**类型变量」：`list[T]` → `T` 保证输入输出一致。

### 7.3 约束与上界

```python
from typing import TypeVar

Num = TypeVar("Num", int, float)          # 只能是 int 或 float
Comparable = TypeVar("Comparable", bound="SupportsRichComparison")   # 有上界


def add(a: Num, b: Num) -> Num:
    return a + b
```

### 7.4 泛型类

```python
from typing import Generic, TypeVar

T = TypeVar("T")


class Page(Generic[T]):
    def __init__(self, items: list[T], total: int):
        self.items = items
        self.total = total

    def first(self) -> T | None:
        return self.items[0] if self.items else None


page = Page[dict]([{"id": "1"}], 1)
row = page.first()      # row: dict | None
```

> 阶段 6/01 的 SQLAlchemy 2.0 `select()` 返回 `ScalarResult[T]`、FastAPI 的 `response_model`、Pydantic 的 `BaseModel` 都是泛型的实际消费者。**理解 `T` 的「一致性约束」比记语法更重要。**

---

## 8. `TypedDict`：描述 JSON 的形状（首次教学）

普通 `dict[str, Any]` 无法表达「有哪些键、各是什么类型」。

```python
from typing import TypedDict


class Chunk(TypedDict):
    id: str
    content: str
    score: float


def format_chunk(c: Chunk) -> str:
    return f"[{c['score']:.2f}] {c['content']}"


format_chunk({"id": "1", "content": "hello", "score": 0.9})     # ✅
format_chunk({"id": "1"})            # ❌ 静态检查报错（缺 content/score）
```

### 8.1 可选键与只读

```python
from typing import NotRequired, Required, TypedDict


class GraphNode(TypedDict, total=False):      # total=False：默认全部可选
    id: Required[str]                          # 只有 id 必填
    title: str
    config: dict


node: GraphNode = {"id": "n1"}
```

### 8.2 `TypedDict` vs 数据类 vs Pydantic

| 工具 | 运行期存在 | 校验 | 适用 |
| --- | --- | --- | --- |
| `TypedDict` | 是普通 `dict` | ❌ 无 | 描述**已有 dict/JSON** 的形状 |
| `@dataclass` | 是类实例 | ❌ 无（除简单默认） | 内部数据结构 |
| Pydantic `BaseModel` | 是类实例 | ✅ 完整校验 + 转换 | **接口边界**（请求体/响应体/配置） |

> 本项目：接口边界全用 Pydantic（`apps/api-py/app/models` 里的请求模型），SSE 事件载荷这类「内部传递的 dict」适合 `TypedDict`（阶段 12）。

---

## 9. `Protocol`：鸭子类型的静态版（首次教学）

### 9.1 为什么需要它

鸭子类型在运行期工作，但静态检查器不知道「`node` 有没有 `run` 方法」。

```python
from typing import Protocol


class Runnable(Protocol):
    def run(self, inputs: dict) -> dict: ...


class StartNode:
    def run(self, inputs: dict) -> dict:
        return inputs


def execute(node: Runnable) -> dict:
    return node.run({})


execute(StartNode())      # ✅ StartNode 没继承 Runnable，但「结构上满足」
```

要点：

- **不需要显式继承**（`Protocol` 是结构化子类型）；
- 只在类型检查期生效，运行期无开销；
- 与 `ABC` 的区别：`ABC` 要求**显式继承**并强制实现，`Protocol` 只要求**长得像**。

### 9.2 何时用哪种

| 需求 | 选择 |
| --- | --- |
| 内部扩展点，希望不侵入实现类 | `Protocol` |
| 需要共享实现/默认方法 | `ABC` 基类 |
| 需要在实例化时强制实现 | `ABC` + `@abstractmethod` |

### 9.3 运行期检查（了解）

```python
from typing import runtime_checkable

@runtime_checkable
class Runnable(Protocol): ...

print(isinstance(StartNode(), Runnable))    # True（只查方法名是否存在）
```

> 运行期 `isinstance` 只检查**方法名存在**，不检查签名，且性能较差——生产代码靠静态检查即可。

---

## 10. 前向引用与延迟注解

### 10.1 类引用自身或互相引用

```python
class TreeNode:
    def __init__(self, value: int, children: list["TreeNode"] | None = None):
        self.value = value
        self.children = children or []
```

`"TreeNode"` 写成字符串是**前向引用**：注解求值时该类还没定义完。

### 10.2 `from __future__ import annotations`（首次教学）

```python
from __future__ import annotations      # 必须放在文件最顶部（docstring 之后）

class TreeNode:
    def __init__(self, children: list[TreeNode] | None = None):   # 不用写引号
        ...
```

作用：把所有注解**延迟成字符串**，不再在定义时求值。好处：

| 好处 | 说明 |
| --- | --- |
| 免写引号 | 前后引用都能直接写类名 |
| 启动更快 | 注解不求值 |
| 新语法可用 | 3.9 上也能写 `list[int]`/`X \| None` |

> 代价：运行期读 `__annotations__` 拿到的是**字符串**。这正是 Pydantic/FastAPI 需要 `get_type_hints()` 解析的原因（框架已自行处理，你不用管）。

### 10.3 `TYPE_CHECKING` 打破循环

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.app import App      # 只给类型检查器看


def handle(app: "App") -> None: ...
```

结合 [00-Python基础/04](../00-Python基础/04-模块、包与导入.md) 的循环导入解法③。

---

## 11. `Annotated`：给类型附加元数据

```python
from typing import Annotated
from pydantic import Field

class CreateAppRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=64)]
    description: Annotated[str, Field(max_length=500)] = ""
```

语义：**类型是 `str`，附加约束是 `min_length=1`**。

相比旧写法 `name: str = Field(min_length=1)`，`Annotated` 更清晰地把「类型」和「约束」分开，也是 FastAPI 官方推荐的现代写法。

> 项目里的 `Field(default=3600, validation_alias="JWT_EXPIRES_IN")` 就是元数据的另一种用法（默认值 + 环境变量别名）。

---

## 12. 静态检查：mypy / pyright

### 12.1 装一个

```powershell
uv add --dev mypy
# 或
uv add --dev pyright
```

### 12.2 跑起来

```powershell
uv run mypy app
uv run pyright app
```

典型报错：

```
app/security.py:12: error: Argument 1 to "verify_password" has incompatible type "None"; expected "str"
```

**不用运行程序**就能发现「可能传 `None` 进 `str` 参数」——这就是注解最大的价值。

### 12.3 渐进式严格度

| 模式 | 说明 |
| --- | --- |
| 弱 | 只检查显式注解的函数 |
| `--strict` | 禁止隐式 `Any`、要求全部注解 |
| `--disallow-untyped-defs` | 所有函数必须有注解 |

建议：新项目直接 `--strict`；老项目先 `--check-untyped-defs` 起步（阶段 3/03 讲工程化配置）。

---

## 13. 项目实战：读 security.py 的注解

完整文件路径：`apps/api-py/app/security.py`（节选）

```python
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            password_hash.encode("utf-8"),
        )
    except ValueError:
        return False


def create_access_token(
    subject: str,
    *,
    secret: str,
    algorithm: str = "HS256",
    expires_in: int = 3600,
) -> str:
    ...
    return jwt.encode(payload, secret, algorithm=algorithm)


def decode_access_token(token: str, *, secret: str, algorithm: str = "HS256") -> str:
    ...
```

注解解读：

| 签名 | 表达的信息 |
| --- | --- |
| `password: str` → `-> str` | 纯函数式密码哈希：字符串进、字符串出，无副作用 |
| `... -> bool` | 显式承认「可能失败」，把异常转成布尔（配合 [05 篇](../00-Python基础/05-异常与文件IO.md)） |
| `*, secret: str` | **仅关键字**：调用方必须写 `secret=...`，防止位置参数传错 |
| `algorithm: str = "HS256"` | 有默认值 → 可选；但 `str` 太宽，用 `Literal["HS256", "RS256"]` 更精确 |
| `decode_access_token(...) -> str` | 返回 `sub`，语义上「解析成功才返回」，失败抛异常 |

一个可以改进的点（教学用）：

```python
from typing import Literal

Algorithm = Literal["HS256", "RS256"]

def decode_access_token(token: str, *, secret: str, algorithm: Algorithm = "HS256") -> str:
    ...
```

> 这体现了注解的迭代方式：**先能跑 → 再加宽泛注解 → 最后收紧成 `Literal`/`TypedDict`/`Protocol`**。

再看配置字段：

```python
access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")
```

`int` 注解在这里**不是装饰**：Pydantic 会用它在运行期把 `.env` 里的字符串 `"3600"` **转换**成整数，失败则报错。这是「注解被框架消费」的直接例子。

---

## 14. 与 TypeScript 对照

| Python | TypeScript | 差异 |
| --- | --- | --- |
| `x: int = 0` | `let x: number = 0` | 一致 |
| `str \| None` | `string \| null` / `undefined` | 一致（PEP 604 起） |
| `list[int]` | `number[]` | 语法不同 |
| `dict[str, int]` | `Record<string, number>` | 语义一致 |
| `Literal["a","b"]` | `"a" \| "b"` | 一致 |
| `Callable[[int], str]` | `(x: number) => string` | 一致 |
| `TypeVar("T")` | `<T>` | 一致 |
| `TypedDict` | `interface` / `type` | TS 接口零成本，Python `TypedDict` 也是零成本 |
| `Protocol` | `interface`（结构类型） | TS 默认结构化，Python 需显式声明 |
| 注解运行期不检查 | 类型编译后擦除 | 都是「编译期/检查期」概念 |
| `from __future__ import annotations` | 无对应 | Python 特有（注解延迟求值） |
| mypy / pyright | `tsc` | 都是静态检查器 |

> 心智迁移要点：**TS 的类型在运行期完全消失；Python 的注解在运行期仍然存在（是元数据），但不做检查**。所以 FastAPI 能拿它做校验，而 Express 不能拿 TS 类型做校验（需要 zod/class-validator）。

---

## 15. 验收自测

### 15.1 判断正误

1. `def f(x: int) -> int: return x`，调用 `f("abc")` 会立刻抛 `TypeError` → **错**，注解不检查，只有函数体内部用到 `int` 语义时才可能出错。
2. `Optional[str]` 表示「这个参数可以不传」 → **错**，表示「值可以是 `str` 或 `None`」。
3. `TypedDict` 会做运行期校验 → **错**，它是普通 dict，零运行期成本。
4. `Protocol` 要求显式继承 → **错**，那是 `ABC`。

### 15.2 改写成现代注解

```python
from typing import List, Dict, Optional

def process(items: List[Dict[str, int]], tag: Optional[str] = None) -> Dict[str, int]:
    ...
```

<details>
<summary>答案</summary>

```python
def process(items: list[dict[str, int]], tag: str | None = None) -> dict[str, int]:
    ...
```
（3.9+ 内建泛型、3.10+ `X | None`；若需兼容更早版本则在文件顶部加 `from __future__ import annotations`。）

</details>

### 15.3 动手题

为 SSE 事件写类型：

```python
# 事件形如：{"event": "token", "data": {"delta": "你"}}
# event 只能是 "start" | "token" | "end"
```

参考实现：

```python
from typing import Literal, TypedDict


class TokenData(TypedDict):
    delta: str


class SSEEvent(TypedDict):
    event: Literal["start", "token", "end"]
    data: TokenData
```

> 阶段 12 会看到项目里 `engine/events.py` 如何生成这类事件。

---

## 16. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 以为加了注解就会校验 | 注解只是元数据 | 用 Pydantic 或手写校验 |
| `TypeError: 'type' object is not subscriptable` | 老版本用 `list[int]` | 升到 3.9+，或 `from __future__ import annotations` |
| `NameError: name 'X' is not defined`（注解里） | 前向引用未加引号 | 加引号或启用延迟注解 |
| `Any` 越用越多，类型检查形同虚设 | 用 `Any` 逃避报错 | 边界处 `Any` + 尽快窄化 |
| 可选参数写成 `x: str = None` | 类型与默认值不一致 | 写 `x: str \| None = None` |
| `TypedDict` 缺键但运行不报错 | 无运行期校验 | 需要校验就用 Pydantic |
| `isinstance(x, Protocol)` 结果意外 | 只检查方法名 | 别依赖运行期协议检查 |
| mypy 报「库没有类型信息」 | 第三方库无 stub | 安装 `types-xxx`，或局部 `# type: ignore` |
| 全部 `# type: ignore` 消除报错 | 掩盖真实问题 | 只对确定无误处用，并写原因 |

---

## 17. 本篇小结

- **注解是元数据，不是运行时约束**；价值在 IDE、静态检查、文档、框架消费（Pydantic/FastAPI）。
- **现代写法优先**：`list[int]`、`dict[str, int]`、`X | None`；`Optional` 只用于读老代码。
- **`Literal` 收紧字符串枚举**，`Callable` 描述函数签名，`Any` 仅限边界且要尽快窄化。
- **`TypeVar` 表达「同类型进出」**；`Generic` 让类也泛型化（`Page[T]`）。
- **`TypedDict` 描述 dict/JSON 形状**（零成本无校验）；接口边界用 Pydantic（有校验）。
- **`Protocol` 是鸭子类型的静态版**：不继承，只看结构；需要强制实现时用 `ABC`。
- **前向引用两招**：字符串注解、`from __future__ import annotations`；循环引用用 `TYPE_CHECKING`。
- **`Annotated[str, Field(...)]`** 把类型与约束分离，是 FastAPI 的现代推荐写法。
- **静态检查器（mypy/pyright）不运行代码就能抓错**，新项目建议直接严格模式。
- **下一步**：推导式与生成器——惰性求值、`yield`、`itertools`。
