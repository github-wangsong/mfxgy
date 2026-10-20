# 00 · Python 与 FastAPI 基础

> 所属：阶段 0 · 项目初始化
> 本篇覆盖：**给「只会 TypeScript / NestJS、完全不会 Python」的读者补的 Python 语言最小集 + FastAPI 心智模型**
> **建议在阅读 `01-环境准备.md` 之前或同时阅读本篇**（它是后面所有 `api-py` 篇目的前置）。
> **本篇首次教学：Python 语言基础**——缩进即语法块 · `None` · 类型注解 · f-string · 容器与推导式 · 函数（默认值 / `*args` / `**kwargs`）· `class`/`self` · 异常 · `async def`/`await` · `with` · 装饰器 · `__init__.py` 与模块导入 · `if __name__ == "__main__"`。
> （Pydantic / `APIRouter` / uvicorn / uv 等**框架**概念已在 `06-FastAPI起步.md` 首次教学；`Depends` / 异常处理器已在 `01-账号与认证/05-FastAPI认证.md` 首次教学——本篇只给**心智模型**，不复述细节。）

---

## 1. 本篇目标与读法

### 1.1 为什么有这一篇

你已经跟着 **TypeScript + NestJS** 那条线读完了阶段 0~5。TS 侧有一篇语言基础（`05-NestJS起步.md` 讲了装饰器、DI 这些**语法层面**的东西）。但 Python 侧的笔记**默认你会 Python**，直接从 `Depends`、`yield` 会话依赖、`Mapped[]` 讲起，却从没解释过：

- `async def` / `await` 是什么；
- `x: int` 这种「冒号 + 类型」怎么读；
- `@router.get` 这个 `@` 开头的语法是什么；
- `__init__.py` 有什么用；
- `if __name__ == "__main__":` 在干嘛；
- `with SessionLocal() as session:` 是什么意思。

**本篇的唯一目的**：读完之后，你能**看懂**后续任何一篇 `api-py` 笔记里的 Python 代码——即使你从没写过一行 Python。

### 1.2 读完你应该能做到

| 能力 | 判定 |
| --- | --- |
| 看懂 `apps/api-py/app/` 下任意一个 `.py` 文件 | 能逐行说出每行在做什么 |
| 区分「Python 的注解」与「TS 的注解」在运行期的差异 | 能说出：Python 注解**保留到运行期**，TS 注解**被擦除** |
| 理解 `@router.get(...)` / `@field_serializer(...)` 这类装饰器 | 能说出「装饰器就是普通函数」 |
| 理解 `async def` 路由与 `await` | 能说出「Python 的异步是全链路的」 |
| 通过 `python app/main.py` 与 `uvicorn app.main:app` 两种启动方式的区别 | 能说出 `if __name__ == "__main__"` 的意义 |

### 1.3 怎么读本篇

- 全程用「**你在 TS 里对应的是什么**」来对照——每个 Python 概念都先给你一个 TS 的锚点。
- 代码块**上方**都标了**完整文件路径**；凡是来自项目真实文件的，**逐字照抄、逐行注释**；少数纯语法示例我会明确标注「**最小示例 · 非项目文件**」。
- 每个代码块后面都有「**这段在干什么**」的逐行说明，**不让你猜**。

---

## 2. 前置：你已经会的 TS 知识

你已经掌握（阶段 0~5 学到的）：

- **类型系统**：`interface`、联合类型 `A | B`、字面量类型、**类型擦除**（`04-契约包与TypeScript类型.md`）。
- **装饰器**：`@Module` / `@Controller` / `@Get` / `@Injectable`（`05-NestJS起步.md`）。
- **依赖注入**：构造函数注入、Provider、IoC 容器（`05-NestJS起步.md`）。
- **模块系统**：`imports` / `controllers` / `providers`（`05-NestJS起步.md`）。
- **DTO 与运行期校验**：`class-validator` + `ValidationPipe`（`01-账号与认证/03-NestJS认证.md`）。
- **异常过滤器**：`@Catch` / `ExceptionFilter`（同上）。

**关键结论**：TS 侧靠「**装饰器 + 构造函数 + class-validator**」实现的那些事，Python 侧用「**装饰器 + 函数参数 + Pydantic**」实现。**目标是同一份契约、同一套行为**，只是表达机制不同。本篇就是把这套「不同」讲清楚。

---

## 3. 总对照表：你的 TS 知识如何迁移

先收藏这张表。后面每讲一个概念，都会回到这里的某一行。

| 你在 TS 里写的 | Python 里对应 | 关键差异（务必看） |
| --- | --- | --- |
| `null` / `undefined` | `None`（只有一个） | Python **没有 `undefined`**；「没值」只有 `None` 一种 |
| `x === null` | `x is None` | Python 用 `is` 判断「是不是同一个对象」（身份），`None` 是全局唯一对象 |
| `let x: number = 1` | `x: int = 1` | Python 注解**不做运行期转换**，也不强制；只是「标注」 |
| `interface User { name: string }` | `class User(BaseModel): name: str` | Pydantic 模型**运行期会真正校验**；interface 不会 |
| `` `${x}` ``（模板字符串） | `f"{x}"`（f-string） | 都要在字符串前加标记，Python 是 `f` 前缀 |
| `[x for ...]` → 用 `Array.prototype.map` | `[x for x in xs]`（推导式） | Python 有**原生**的「推导式」语法，比 TS 更常用 |
| `async function` | `async def` | 都是声明异步函数 |
| `await` | `await` | 只能出现在 `async` 函数里 |
| `try { } finally { }` | `with ...:` / `try: ... finally: ...` | `with` 是「自动释放资源」的语法糖 |
| `import { settings } from './config'` | `from app.config import settings` | 路径是**点号路径**（包.模块），不是文件相对路径 |
| `index.ts`（barrel 文件） | `__init__.py` | Python 里它是「**包的标记**」，还能做包初始化 |
| `@Decorator` | `@decorator` | Python 装饰器是**普通函数**，更通用、无框架魔法 |
| `class A { constructor() {...} }` | `class A: def __init__(self): ...` | Python 实例方法**第一个参数是 `self`**，要显式写 |
| `this` | `self` | `self` 是**显式参数**，不是关键字；名字约定俗成叫 `self` |
| `package.json` + `node_modules` + pnpm | `pyproject.toml` + `.venv` + uv | 见 `01-环境准备.md` |
| 程序入口写 `main()` 直接跑 | `if __name__ == "__main__":` | 一个 `.py` 文件**既可被导入、也可被直接运行** |

> 「**身份（identity）**」：Python 里每个对象都有唯一的内存身份。`is` 判断两个名字**是不是同一个对象**，`==` 判断**值是否相等**。`None` 只有一个，所以永远用 `is None`。

---

## 4. Python 语法最小集

### 4.1 缩进就是语法块（对标花括号）

**TS 里**：
```ts
function getHealth(): string {
  if (ok) {          // ← 花括号划出代码块
    return 'yes'
  }
  return 'no'
}
```

**Python 里**：
```python
def get_health() -> str:
    if ok:                 # ← 冒号 + 缩进划出代码块
        return 'yes'       #     这一行缩进 4 空格，属于 if
    return 'no'            #     与 if 对齐，属于函数
```

**这段在干什么**：Python **不用花括号**，而是用**冒号 + 缩进**表示「哪些语句属于这个块」。**缩进量必须一致**（本项目统一 **4 个空格**，不要混 Tab）。缩进错了，程序直接报 `IndentationError`。这是 Python 对新手**最容易踩**的语法差异——把「花括号」换成「对齐」。

### 4.2 变量、`None`、真假值

**TS 里**：`let`/`const` 声明变量；空值是 `null` 或 `undefined`。

**Python 里**：**没有 `let`/`const`**，变量「赋值即声明」：

```python
count = 0            # 直接写名字 = value 就是声明并赋值
name = "mini-dify"
flag = True          # Python 的布尔是 True / False（首字母大写！）
nothing = None       # 「没有值」只有这一个关键字
```

**这段在干什么**：

- Python 变量**不需要声明关键字**，第一次 `=` 就诞生了。
- 布尔字面量是 **`True` / `False`**（大写），不是 TS 的 `true` / `false`。
- `None` ≈ TS 的 `null`；Python **没有 `undefined`**（读取未定义的变量会直接 `NameError`，而不是给个 `undefined`）。

**判断「是不是没值」**：用 `is`，不是 `==`。

```python
if user is None:          # ✅ 推荐：判断身份
    ...
if user == None:          # ⚠️ 能跑但不推荐
```

**`None` 在项目里的真实用法**（`apps\api-py\app\api\deps.py` 第 37~38 行、第 44~45 行）：

```python
if credentials is None:
    _unauthorized("Missing bearer token")
...
if user is None:
    _unauthorized("User no longer exists")
```

**这段在干什么**：`get_current_user` 依赖里，先判断「凭证是不是 `None`」，再判断「查到用户是不是 `None`」；是就抛未认证错误。`is None` 就是 TS 的 `=== null`。

> **真假值（truthiness）**：Python 在 `if` 里会把非布尔值也当条件——`0`、`""`、`[]`、`{}`、`None` 都算「假」，其余算「真」。这点和 JS 类似（JS 里 `0`、`""`、`null`、`undefined` 为假）。项目里常见 `if not isinstance(...)`、`if app is None or app.owner_id != owner_id` 就是靠它。

### 4.3 类型注解（对标 `: number`，但**语义不同**）

**TS 里**：`let age: number = 30`。注解**只在编译期**起作用，编译成 JS 后**被擦除**（`04-契约包与TypeScript类型.md` 讲过「类型擦除」）。

**Python 里**：注解写法一样用冒号，但**运行期保留**：

```python
age: int = 30
name: str = "mini-dify"
enabled: bool = True

def add(a: int, b: int) -> int:   # 参数类型 : 类型；返回类型用 ->
    return a + b
```

**这段在干什么**：

- `age: int = 30`：冒号后写类型，`-> int` 写返回值类型——和 TS 形似。
- **关键差异**：Python 注解**默认不强制、不做运行期类型转换**。下面这段**不会报错**：

```python
x: int = "hello"    # 注解说是 int，但 Python 不会拦你，也不会转成 int
print(type(x))      # <class 'str'> —— 它真的就是个字符串
```

**这段在干什么**：Python 只把 `int` 当作「写在变量上的一句说明」。要真正**靠注解来校验**，得用 **Pydantic**（见 §6.5）或工具（如 `mypy`）——**不是语言本身**。

| 维度 | TypeScript | Python |
| --- | --- | --- |
| 注解在运行期 | **被擦除**，拿不到 | **保留**（可读 `__annotations__`） |
| 语言本身会不会拦类型 | 编译期报错 | **不会**（只是标注） |
| 能不能用注解校验外部数据 | ❌ | ✅（Pydantic 就是读注解来建校验器） |

这就是为什么：**同一份契约，TS 侧只能写「只编译期存在」的 `interface`，Python 侧却能写成「运行期真的校验」的 Pydantic 模型**——底层机制就在这条差异上。

**注解的常见写法**（记住这几条，后面代码就都能读）：

| Python 写法 | 含义 | TS 里对应 |
| --- | --- | --- |
| `str` / `int` / `float` / `bool` | 基本类型 | `string` / `number` / `boolean` |
| `list[str]` | 字符串列表 | `string[]` |
| `dict[str, int]` | 键字符串、值数字的对象 | `Record<string, number>` |
| `dict[str, Any]` | 任意值 | `Record<string, any>` |
| `str \| None` | 字符串或 None | `string \| null` |
| `tuple[str, int]` | 定长元组 | `[string, number]` |
| `Literal["ok"]` | 只能取 `"ok"` | `'ok'`（字面量类型） |
| `Any` | 任意类型（来自 `typing`） | `any` |
| `-> T` | 返回类型 | `: T` |

**项目里的真实注解**（`apps\api-py\app\api\health.py` 第 20~23 行）：

```python
    status: Literal["ok"]
    service: str
    version: str
    time: datetime
```

**这段在干什么**：这是 `HealthResponse` 模型的字段。`Literal["ok"]` 表示 `status` 只能是字符串 `"ok"`（等价契约里的 `enum: [ok]`）；`service`/`version` 是普通字符串；`time` 是 `datetime` 类型。

> `Any` 需要 `from typing import Any` 导入（见 `app/models/app.py` 第 8 行）。`|` 联合类型写法需要 Python 3.10+（本项目 3.12，放心用）。

### 4.4 字符串与 f-string（对标模板字符串）

**TS 里**：`` `你好，${name}` ``——模板字符串，用反引号 + `${}` 插值。

**Python 里**：**f-string**（f 前缀 + `{}` 插值）：

```python
name = "mini-dify"
count = 3

plain = "你好，" + name                 # 拼接
greet = f"你好，{name}"                   # f-string：等价于 `你好，${name}`
report = f"{name} 有 {count} 个应用"       # 可以嵌入表达式
```

**这段在干什么**：`f"..."` 前面的 `f` 表示「这个字符串里 `{}` 会被求值替换」。`f"{name} 有 {count} 个应用"` ≈ TS 的 `` `${name} 有 ${count} 个应用` ``。

**项目里的真实 f-string**（`apps\api-py\app\engine\events.py` 第 20~21 行）：

```python
    payload = json.dumps(event["data"], ensure_ascii=False, separators=(",", ":"))
    return f"event: {event['event']}\ndata: {payload}\n\n"
```

**这段在干什么**：这是拼装 SSE 数据帧。`f"event: {event['event']}\ndata: {payload}\n\n"` 把事件名与 payload 插进模板；`\n` 是换行符（和 TS 一样）。注意 f-string 里嵌 `event['event']` 用的是**单引号**（因为外层是双引号）——Python 单双引号等价，这里是为了不冲突。

### 4.5 容器：`list` / `dict` / `set` / `tuple`

**TS 里**：数组 `[]`、对象 `{}`、`Set`、元组 `[a, b] as const`。

**Python 里**：

```python
items = [1, 2, 3]                       # list（列表）≈ JS 数组
user = {"name": "bob", "age": 30}       # dict（字典）≈ JS 对象/Map
tags = {"a", "b", "a"}                  # set（集合）→ {"a", "b"}（自动去重）
point = (10, 20)                        # tuple（元组）→ 定长不可变
```

**这段在干什么**：

- `list` 可增删改，用 `items.append(4)` 追加（TS 是 `push`）。
- `dict` 用 `user["name"]` 按下标取值；取不存在的键会 `KeyError`，所以常用 `user.get("name")`（等价 TS 的 `?.` 语义）。
- `set` 自动去重，用 `{1, 2}` 创建（注意：`{}` 空的是 dict，空的 set 要写 `set()`）。
- `tuple` 一旦创建不能改，常用作「固定几个值的组合」。

**索引与切片**（这是 Python 很舒服的一点）：

```python
items = [10, 20, 30, 40]
items[0]        # 10（下标从 0 开始，和 JS 一样）
items[-1]       # 40（-1 = 最后一个，JS 没有这个）
items[1:3]      # [20, 30]（切片：从下标 1 到 3 之前，左闭右开）
```

**这段在干什么**：`items[-1]` 取最后一个元素，`items[1:3]` 取「下标 1、2」两个元素。切片是 Python 独有、日常高频的语法（TS 要用 `slice(1, 3)`）。

**项目里的真实字典用法**（`apps\api-py\app\engine\engine.py` 第 33~35 行）：

```python
def _merge_pool(previous: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    """变量池合并 reducer：节点返回 `{"pool": {<nodeId>: <output>}}` 逐步累积。"""
    return {**previous, **update}
```

**这段在干什么**：`{**previous, **update}` 是**字典解包**——把 `previous` 和 `update` 两个字典的键值展开、合并成一个新字典。`**update` 的同名键会覆盖 `previous`。这 ≈ TS 的 `{ ...previous, ...update }`。**注意**：Python 用 `**`，TS 用 `...`。

### 4.6 流程控制：`if` / `for` / `while` / `range` / `enumerate` / `zip`

**`if / elif / else`**（注意是 `elif`，不是 `else if`）：

```python
if score >= 90:
    grade = "A"
elif score >= 60:        # ≈ TS 的 else if
    grade = "B"
else:
    grade = "C"
```

**`for` 循环**（对标 TS 的 `for...of`）：Python 的 `for` 直接**遍历可迭代对象**，不用 `let i`：

```python
for item in items:            # ≈ TS: for (const item of items)
    print(item)

for index, item in enumerate(items):   # 同时拿「下标 + 值」
    print(index, item)                 # ≈ TS: items.forEach((item, index) => ...)

for a, b in zip(names, ages):          # 把两个列表「并排配对」
    print(a, b)                        # ≈ 同时遍历两个数组
```

**这段在干什么**：

- `for item in items:` 直接遍历——**不用写循环变量声明**，也不用 `i++`。
- `enumerate(items)` 会产出一对对的 `(下标, 值)`，用来在循环里拿到序号（TS 里常用 `map` 的第二个参数 `index`）。
- `zip(a, b)` 把两个列表**成对配对**，循环里一次拿到两边的元素——TS 里没有直接对应，要自己按 `i` 取。

**`range(n)`**：产生 `0..n-1` 的整数序列，等价 TS 的「`for (let i=0; i<n; i++)`」：

```python
for i in range(3):        # i = 0, 1, 2
    print(i)
```

**`while`**（和 TS 几乎一样）：

```python
count = 0
while count < 3:
    count += 1            # 注意：Python 没有 count++，用 += 1
```

**这段在干什么**：`count += 1` 就是「加 1 后再赋值」——**Python 没有 `++` 运算符**，这是从 TS 过来最容易手滑的点。

**项目里的真实 `for` 循环**（`apps\api-py\app\engine\engine.py` 第 100~103 行，节选）：

```python
        for node in graph["nodes"]:
            builder.add_node(node["id"], _make_node_action(node, queue, context))
        for edge in graph["edges"]:
            builder.add_edge(edge["source"], edge["target"])
```

**这段在干什么**：遍历图里的所有节点、所有边，逐个注册到 LangGraph 的 `builder` 上。`graph["nodes"]` 是列表，`for node in ...` 直接遍历元素——和 TS 的 `for (const node of graph.nodes)` 一个意思。

### 4.7 推导式（`[x for x in xs]`）——TS 里没有的语法糖

**TS 里**：过滤 + 映射一般写 `xs.filter(...).map(...)` 或 `for` 循环。

**Python 里**：有**原生的推导式**，一行搞定：

```python
nums = [1, 2, 3, 4, 5]

doubled = [n * 2 for n in nums]              # 列表推导式 → [2, 4, 6, 8, 10]
evens   = [n for n in nums if n % 2 == 0]    # 带过滤 → [2, 4]
squares = {n: n * n for n in nums}           # 字典推导式 → {1:1, 2:4, ...}
uniq    = {n % 3 for n in nums}              # 集合推导式 → {0, 1, 2}（去重）
```

**这段在干什么**：

- `[n * 2 for n in nums]` = 「对每个 `n` 算出 `n*2`，组成新列表」——读法：**`[结果 for 元素 in 来源]`**。
- 加 `if` 就是过滤：`[n for n in nums if n % 2 == 0]` ≈ `nums.filter(n => n % 2 === 0)`。
- 把方括号换成花括号，结果就是 dict / set。

**项目里的真实列表推导式**（`apps\api-py\app\api\apps.py` 第 100 行）：

```python
    return AppListResponse(items=[_to_app_response(app) for app in apps])
```

**这段在干什么**：把数据库查出的 `apps` 列表，逐个用 `_to_app_response(app)` 转成响应对象，再装进 `items`。等价 TS 的 `apps.map(app => toAppResponse(app))`。

**列表解包**（`*`）——把多个列表「摊平」进一个列表（`apps\api-py\app\api\run.py` 第 46 行）：

```python
    errors = [*validate_graph(graph), *validate_node_data(graph)]
```

**这段在干什么**：`*list` 把列表元素展开。这里等价于 TS 的 `[...validateGraph(graph), ...validateNodeData(graph)]`——**Python 用 `*`，TS 用 `...`**。

### 4.8 函数：默认参数、`*args`、`**kwargs`

**TS 里**：`function greet(name: string, greeting = 'hi') {}`。

**Python 里**：

```python
def greet(name, greeting="hi"):        # 默认参数写法一样
    return f"{greeting}, {name}"

def total(*args):                       # *args：接收任意多个位置参数 → 元组
    return sum(args)

def make(**kwargs):                     # **kwargs：接收任意多个关键字参数 → 字典
    return kwargs
```

**这段在干什么**：

- `greeting="hi"`：调用时可省略，用默认值。
- `*args`：把「传进来的若干位置参数」打包成一个 **tuple**（`total(1,2,3)` 时 `args == (1,2,3)`）。
- `**kwargs`：把「传进来的若干 `key=value`」打包成一个 **dict**。
- 二者对应 TS 的 `...args`（不过 TS 只有一个 `...`，Python 区分位置 `*` 与关键字 `**`）。

**关键字专用参数**（`*` 单独出现）：`apps\api-py\app\security.py` 第 31 行：

```python
def create_access_token(*, user_id: str, role: str) -> tuple[str, int]:
```

**这段在干什么**：`*` 单独一个表示「**它之后的所有参数都必须用 `=名字` 传**」（关键字专用）。调用时必须写 `create_access_token(user_id=..., role=...)`，不能只按位置传——这样可读性更好、也更难传错顺序。

**函数可返回多个值**（Python 特性）：该函数返回 `tuple[str, int]`，调用方这样接：

```python
token, expires_in = create_access_token(user_id=user.id, role=user.role)
```

**这段在干什么**：Python 会把 `(token, expires_in)` **自动解包**成两个变量——这 ≈ TS 的解构 `const [token, expiresIn] = ...`，但 Python 里**不需要方括号**，直接逗号分隔。

### 4.9 经典坑：**可变默认参数**

这是 Python 从新手到老手都栽过的坑，务必记住：**默认值用可变对象（`[]` / `{}` / `set()`）会共享同一个对象**。

```python
# ❌ 错误写法
def add_item(item, bucket=[]):     # bucket 是「同一个列表」，每次调用共用
    bucket.append(item)
    return bucket

add_item("a")   # → ["a"]
add_item("b")   # → ["a", "b"]（你以为该是 ["b"]，其实还是同一个列表！）
```

**这段在干什么**：默认值 `[]` **只在函数定义时创建一次**，之后每次调用都复用那一个列表，于是会「累积」。**正确写法用 `None` 占位**：

```python
# ✅ 正确写法
def add_item(item, bucket=None):
    if bucket is None:       # 每次调用时才新建
        bucket = []
    bucket.append(item)
    return bucket
```

**这段在干什么**：用 `None` 当默认值，函数体内判断「没传就新建一个」——就避开了共享。项目里凡是「可选、默认为空容器」的地方都遵循这个约定（如 `Field(default=None)`）。

### 4.10 类、`self` 与 `@dataclass`

**TS 里**：

```ts
class User {
  name: string
  constructor(name: string) {
    this.name = name        // this 是关键字，隐式存在
  }
}
```

**Python 里**：

```python
class User:
    def __init__(self, name):   # __init__ ≈ constructor
        self.name = name        # self 是「显式写出来的第一个参数」

u = User("bob")                 # 创建实例：不用 new
print(u.name)                   # "bob"
```

**这段在干什么**：

- `class User:` 定义类（冒号 + 缩进，不是花括号）。
- `__init__` 是「构造方法」——创建实例时自动调用（≈ TS 的 `constructor`）。注意**前后各有两条下划线**。
- **第一个参数 `self`**：代表「当前这个实例」，相当于 TS 的 `this`。**但 `self` 不是关键字，是要你显式写出来的参数**（名字约定叫 `self`，但你也可以叫别的——别这么干）。
- 创建实例**不用 `new`**，直接 `User("bob")`。

**调用实例方法**（`apps\api-py\app\models\user.py` 里 `User` 类的实例）：

```python
user.email          # 读属性（≈ TS 的 user.email）
user.password_hash  # 读另一个属性
```

**`@dataclass`（数据类）——常用于「只想装数据的类」**：

```python
from dataclasses import dataclass

@dataclass
class Point:
    x: int
    y: int

p = Point(1, 2)          # 自动生成 __init__（不用自己写）
print(p.x, p.y)          # 1 2
```

**这段在干什么**：`@dataclass` 装饰器会**自动替你生成 `__init__`、`__repr__` 等样板方法**——你只需声明字段和类型。它 ≈ TS 里「只声明字段的 `class`」或 `interface`。**注意**：`@dataclass` 的字段**不会做运行期校验**（和普通注解一样只标注）；要校验就用 Pydantic（见 §6.5）。

**`@dataclass` 在项目里**：本项目**没用到** `@dataclass`——需要「带校验的数据模型」一律用 Pydantic `BaseModel`（见 §6.5），需要 ORM 映射用 SQLAlchemy（见 §7）。这里介绍 `@dataclass` 是为了让你读到**其它 Python 项目**时不懵。

> **`__双下划线__` 约定**：Python 用「前后各两个下划线」的名字表示「特殊/内置用途」（如 `__init__`）；用**单前导下划线** `_name` 表示「内部/私有」（约定，非强制）。项目里到处可见：`_PROJECT_DIR`、`_serialize_time`、`_envelope` 都是「本模块内部用，外部别碰」。

### 4.11 异常：`try` / `except` / `raise`（对标 `try/catch/throw`）

**TS 里**：`try { ... } catch (e) { ... }`，抛错用 `throw new Error(...)`。

**Python 里**：

```python
try:
    risky()
except ValueError as e:        # catch → except；捕获特定异常
    print("出错了：", e)
except Exception as e:         # 兜底（Exception 是所有常规异常的基类）
    print("其它错误", e)
finally:
    cleanup()                  # finally 一样存在
```

**这段在干什么**：

- `except` ≈ TS 的 `catch`；可以写多个 `except` 分别处理不同异常。
- `raise` ≈ TS 的 `throw`：

```python
raise ValueError("Graph is empty")     # 抛出一个异常
```

**这段在干什么**：抛出异常、中断当前流程。**异常也是一种值**——可以带上信息（这里是字符串）。

**项目里的真实用法**（`apps\api-py\app\api\deps.py` 第 25~30 行）：

```python
def _unauthorized(message: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )
```

**这段在干什么**：函数直接 `raise` 一个 `HTTPException`（FastAPI 认识的异常），FastAPI 捕获后自动转成对应的 HTTP 响应（这里 401）。`NoReturn` 是**返回值注解**，表示「这个函数永远不会正常返回（它总是抛错）」——这是给人和工具看的说明。

**捕获 + 兜底**的真实例子（`apps\api-py\app\security.py` 第 24~28 行）：

```python
def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False
```

**这段在干什么**：如果 `bcrypt.checkpw` 因为「哈希格式不对」抛出 `ValueError`，就吞掉它、返回 `False`（而不是让整个请求崩掉）。`password.encode("utf-8")` 把字符串转成字节（bcrypt 只吃字节）。

> **EAFP 风格**：Python 社区偏爱「**先做，出错再处理**」（Easier to Ask Forgiveness than Permission），而非 TS 常见的「先检查能不能做」（LBYL）。项目里 `try: decode_access_token(...) except Exception: _unauthorized(...)`（`deps.py`）就是这个风格。

### 4.12 `async def` / `await`——**全链路异步**

**TS 里**：`async function f() { const x = await g() }`——`await` 只能在 `async` 函数里。

**Python 里**：**同样规则**，只是写法从 `async function` 变成 `async def`：

```python
async def fetch_data():        # ≈ TS: async function fetchData()
    result = await do_io()     # ≈ TS: const result = await doIo()
    return result
```

**这段在干什么**：`async def` 声明「协程函数」（≈ TS 的 async 函数）；`await` 等待另一个协程结束。规则也一样：**`await` 只能出现在 `async def` 里**。

**但有一条 Python 特有的、必须记住的规则**：
> **Python 的异步是「全链路」的——一个普通（同步）函数里不能 `await`。**

```python
def sync_fn():
    await something()      # ❌ 语法错误！同步函数里不能 await

async def async_fn():
    await something()      # ✅
```

**为什么强调**：因为你熟悉的是 TS——在那里 `await` 的限制也存在，但 Python 把这个限制「放到类型层面」更彻底：**同步函数和异步函数是两种不同「种类」的函数**，混用会报错。项目里 API 路由既有 `async def` 也有普通 `def`（见 §6.7），必须在各自内部遵守这条。

**本项目里的真实异步**（`apps\api-py\app\api\health.py` 第 30~31 行）：

```python
@router.get("/health", response_model=HealthResponse, operation_id="getHealth")
async def get_health() -> HealthResponse:
```

**这段在干什么**：这个路由处理函数是 `async def`——FastAPI 会在事件循环里以协程方式调用它。健康检查几乎不做 I/O，用 `async` 或普通 `def` 都行（详见 §6.7）。

**异步生成器 + `await` 的真实场景**（`apps\api-py\app\engine\engine.py` 第 82~87 行，SSE 流）：

```python
    while True:
        event = await queue.get()      # await：等队列里来一个新事件
        if event is None:
            break
        yield format_sse_frame(event)
    await task
```

**这段在干什么**：`await queue.get()` 挂起等待、直到生产者放进一个事件；`yield` 把帧一段段「吐」给调用方（这就是流式响应）。`yield` + `async` 合起来叫「**异步生成器**」——不急着现在理解全部，只要知道「`await` 表示『在这里等』、`yield` 表示『产出一个值、待会儿再回来继续』」。

### 4.13 `with` 上下文管理器（对标 `try/finally`）

**TS 里**没有直接对应（新语法有 `using`，但还少见）。想做「用完自动释放资源」一般写：

```ts
const session = open()
try {
  session.use()
} finally {
  session.close()      // 无论成功失败都关掉
}
```

**Python 里**用 `with` 把「打开 + 关闭」打包成一句：

```python
with open("file.txt") as f:
    data = f.read()
# 离开缩进块时，f 会被自动关闭——不用手写 finally
```

**这段在干什么**：`with ... as x:` 会调用对象的「进入」方法拿到 `x`，并在**离开缩进块时**（含异常路径）自动调用「退出」方法（通常是释放/关闭资源）。这就是「**上下文管理器**（context manager）」——凡是实现了「进入/退出」协议的对象都能这么用。它 ≈ TS 的 `try/finally`，但更省事、也不容易漏。

**项目里的真实用法**（`apps\api-py\app\api\deps.py` 第 20~22 行）：

```python
def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
```

**这段在干什么**：`SessionLocal()` 创建一个数据库会话；`with` 保证这个会话在被使用完之后**自动关闭**。这里的 `yield session` 是关键——它把会话「交给」请求处理函数使用，**函数暂停在这里**，直到请求处理完毕，才回到 `yield` 之后、离开 `with` 块、自动关闭会话。这既是「上下文管理器」又是「**生成器**（generator）」：`get_db` 不是一个普通函数，而是一个「能暂停/恢复」的函数。**这正是 `06-FastAPI起步.md` 与后续认证篇里 `Depends(get_db)` 会话依赖的内核**。

### 4.14 装饰器 `@something`（对标 TS 装饰器，但更基础）

**TS 里**：`@Controller('health')` 贴在类上；需要 `experimentalDecorators`（`05-NestJS起步.md`）。

**Python 里**：`@` 开头一行，贴在**函数或类**上；**装饰器就是普通函数**，本质是：

```python
@decorator
def func():
    ...
```

**等价于**：

```python
def func():
    ...
func = decorator(func)      # 装饰器「吞掉」原函数，返回一个（通常是包装过的）新函数
```

**这段在干什么**：`@decorator` 只是「`func = decorator(func)`」的语法糖——把函数作为**参数**传进去，装饰器返回一个「替换版」，再把名字重新指过去。理解这一点，你就明白为什么它能「给函数附加行为或元数据」。

**带参数的装饰器**（装饰器工厂）：

```python
@router.get("/health", response_model=HealthResponse)
```

**这段在干什么**：`@router.get(...)` 先**调用** `router.get("/health", ...)`——它返回一个真正的装饰器，再把这个装饰器贴到下面的 `async def get_health` 上。这 ≈ TS 的 `@Controller('health')`（也是「先调用工厂、返回装饰器」）。

**与 TS 装饰器最重要的差异**：

| 维度 | TypeScript | Python |
| --- | --- | --- |
| 本质 | 语言特性，需编译器/配置支持 | **就是普通函数**，语言原生支持 |
| 适用范围 | 类 / 方法 / 属性 / 参数 | **任意可调用对象**（函数、类都行） |
| 是否需要配置 | 要开 `experimentalDecorators` | **什么都不用开** |

**项目里你会反复看到的装饰器**：`@router.get` / `@router.post`（注册路由）、`@field_serializer`（自定义字段序列化）、`@app.exception_handler`（注册异常处理器）、`@property`（属性）。它们都只是「普通函数」在起作用。

### 4.15 `if __name__ == "__main__":`——一个文件两种命运

**TS 里**没有直接对应：一个 `.ts` 文件被编译/执行，要么就是入口，要么就是被 import。

**Python 里**：同一个 `.py` 文件**既能被别的模块导入、也能被直接运行**，靠这个判断来区分：

```python
if __name__ == "__main__":
    # 只有「直接运行这个文件」时才执行这里
    main()
```

**这段在干什么**：

- 每个模块都有一个内置变量 `__name__`。
- 当文件**被导入**时，`__name__` 等于**模块名**（如 `"app.main"`）；当文件**被直接运行**时，`__name__` 等于字符串 `"__main__"`。
- 所以 `if __name__ == "__main__":` 的意思是「**如果我是被直接运行的，就执行下面这段**」——既能让这个文件当「可执行脚本」，又不会在被别人导入时**自动乱跑**。

**项目里的真实用法**（`apps\api-py\app\main.py` 第 37~41 行）：

```python
if __name__ == "__main__":
    import uvicorn

    # 端口从配置读取（PORT，默认 8000），与 api-ts 的 process.env.PORT 同规则。
    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.port, reload=True)
```

**这段在干什么**：如果直接 `python app/main.py`（或 `uv run python app/main.py`），就**在这里启动 uvicorn**；如果 `app.main` 是被 `uvicorn app.main:app` 导入的（不直接运行该文件），这段**不会执行**——因为那时 `__name__ == "app.main"`，不等于 `"__main__"`。

> **对比 `06-FastAPI起步.md` 的启动方式**：`uvicorn app.main:app` 是「**导入** `app.main`、取出其中的 `app` 对象、由 uvicorn 自己监听」——此时 `__name__` 是 `"app.main"`，所以 `__main__` 块被**跳过**。而 `python app/main.py` 是「**直接运行**该文件」——此时 `__name__ == "__main__"`，于是 uvicorn 被启动。两种方式**殊途同归**：都是把 `app` 这个 ASGI 应用跑起来。

---

## 5. Python 工程化：模块 / 包 / 导入 / 虚拟环境

### 5.1 模块与包

| 概念 | 是什么 | TS 里对应 |
| --- | --- | --- |
| **模块（module）** | 一个 `.py` 文件就是一个模块（`config.py` → 模块 `config`） | 一个 `.ts` 文件 |
| **包（package）** | 一个**目录**，里面含 `__init__.py`，就是一个包（`app/` → 包 `app`） | 一个目录（可含 `index.ts`） |
| **`__init__.py`** | 标记「这个目录是包」，也能写包级初始化代码 | `index.ts`（barrel），但**用途更强**：它同时是「包的声明」 |

**`__init__.py` 的关键差异**：在 TS 里，一个目录能不能当模块**取决于**有没有 `index.ts`（导入时才需要它）；在 Python 里，`__init__.py` 是**这个目录被当作「包」来导入的前提**——没有它（在旧式导入规则下）目录就**不是包**。

**项目里的真实 `__init__.py`**（`apps\api-py\app\__init__.py`）：

```python
"""mini-dify Python 后端（api-py）。

契约唯一真源：仓库根目录 `packages/contract/openapi.yaml`。
"""
```

**这段在干什么**：文件里只是一段**文档字符串（docstring）**——用**三引号**包住的字符串，作为这个模块/包的说明（Python 里「三引号字符串紧跟在文件或函数开头」就自动成为文档）。它的**真正作用是**：让 `app/` 目录成为一个**包**，这样 `app.config`、`app.api.health` 这种「点号导入」才能成立。（`app/api/__init__.py` 同理。）

> **docstring 是什么**：Python 惯例是用「紧贴模块/函数/类开头的三引号字符串」写说明，可被 `help()` 读取。它 ≠ 普通注释；项目里每个 `.py` 文件开头都有一段。

### 5.2 导入：点号路径 vs 相对路径

**TS 里**：`import { settings } from './config'`——用**文件相对路径**（`./`、`../`）。

**Python 里**：用**点号路径**（`包.模块.成员`），**从左到右是「从项目根/包根」往下**：

```python
from app.config import settings              # 从包 app.config 里取 settings
from app.api.deps import get_current_user    # 从 app.api.deps 里取函数
from fastapi import APIRouter                # 从第三方包 fastapi 里取 APIRouter
import json                                  # 导入整个模块（用 json.dumps）
```

**这段在干什么**：

- `from 模块 import 名字, 名字`：指定「从哪、取什么」——和 TS 的 `import { } from` 一一对应。
- `import json`：导入整个模块，之后用 `json.dumps(...)` 访问（≈ `import * as json`）。
- **`from ... import ...` 用的是「包路径」，不是「文件路径」**：`app.config` 对应 `app/config.py`，但你要写点号、且**从能解析到 `app` 包的位置开始**。

**项目里的真实导入**（`apps\api-py\app\api\health.py` 第 3~10 行）：

```python
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, field_serializer

from app.config import settings
from app.timefmt import iso_z
```

**这段在干什么**：前两行从**标准库** `datetime`/`typing` 导入；中间从**第三方包** `fastapi`/`pydantic` 导入；最后两行从**本项目包** `app.config`/`app.timefmt` 导入。注意最后两行用了 `app.` 前缀——这就是「包路径」。

### 5.3 关键坑：「从哪个目录启动」决定 `import` 能否成功

这是本项目**真实踩过**的坑（`06-FastAPI起步.md` 第 9 节 / `INDEX.md` 的「已知遗留」）。

**Python 找模块时**，会到「当前工作目录（cwd）+ 一些配置目录」组成的 `sys.path` 里找。所以：

- 若你**在 `apps/api-py` 目录下**运行 `uvicorn app.main:app`，`sys.path` 里有 `apps/api-py`，于是能解析到 `app` 包 → **成功**。
- 若你在**仓库根**运行 `uv run --project apps/api-py uvicorn app.main:app`，`--project` **只切换「用哪个 `.venv`/依赖」，不切换工作目录**——`sys.path` 里没有 `apps/api-py` → 报 `ModuleNotFoundError: No module named 'app'`。

**正确做法**：用 `uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000`——`--directory` 会把**工作目录**切到 `apps/api-py`，`app` 包自然可被导入。仓库根的 `dev:api-py` 脚本就是这么写的（`01-环境准备.md` 第 4 节给出）：

**完整文件路径：`package.json`（仓库根）**

```json
{
  "name": "mini-dify",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@12.10.1",
  "scripts": {
    "build:contract": "pnpm --filter @mini-dify/contract build",
    "dev:web": "pnpm --filter @mini-dify/web dev",
    "dev:api-ts": "pnpm run build:contract && pnpm --filter @mini-dify/api-ts start:dev",
    "dev:api-py": "uv run --directory apps/api-py uvicorn app.main:app --reload --port 8000",
    "build:api-ts": "pnpm run build:contract && pnpm --filter @mini-dify/api-ts build",
    "build:web": "pnpm --filter @mini-dify/web build"
  }
}
```

**这段在干什么**：注意 `dev:api-py` 用的 `--directory`（切工作目录），**不是** `--project`。这就是「Python 的模块导入依赖启动目录」这条规则的直接后果。

> **`sys.path`（模块搜索路径）**：Python 启动时用来找「要导入的模块」的目录列表。**工作目录会被自动放进 `sys.path`**，所以「从哪个目录启动」直接影响能不能 import 到本地包——这与 TS/Node 的「按文件相对路径解析」是两套完全不同的心智。

### 5.4 虚拟环境（`.venv`）——项目的隔离世界

**TS 里**：依赖装在**项目本地**的 `node_modules/`。

**Python 里**：依赖装在**项目本地**的 `.venv/`（虚拟环境，virtual environment）——一个**只属于这个项目**的独立 Python 环境，装什么包都只影响它，不污染全局 Python。

| 文件 / 目录 | 类比 TS 侧 | 作用 |
| --- | --- | --- |
| `pyproject.toml` | `package.json` | 声明项目与依赖（含版本下限） |
| `uv.lock` | `pnpm-lock.yaml` | 锁定整棵依赖树的**精确**版本 |
| `.venv/` | `node_modules/` | 项目私有的隔离环境（**不提交**） |

**命令**（详见 `01-环境准备.md`）：

```bash
uv sync --project apps/api-py                # 按 pyproject/lock 建 .venv 并装齐依赖
uv run --directory apps/api-py <命令>         # 在项目环境 + 项目目录里跑命令
```

**这段在干什么**：`uv sync` 读 `pyproject.toml`，创建 `apps/api-py/.venv`、装好依赖；`uv run` 保证用的是这份 `.venv` 再执行命令（不用手动 `activate`）。`.venv` 就像 `node_modules`：**每个项目一份、不入库**。

### 5.5 `pyproject.toml`（对标 `package.json`）

**完整文件路径：`apps/api-py/pyproject.toml`**

```toml
[project]
name = "mini-dify-api-py"
version = "0.1.0"
description = "mini-dify Python 后端（FastAPI + SQLAlchemy 2.0），与 api-ts 实现同一份契约。"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.5.0",
    "email-validator>=2.2.0",
    "sqlalchemy>=2.0.30",
    "psycopg[binary]>=3.2.0",
    "pyjwt>=2.9.0",
    "bcrypt>=4.2.0",
    "langgraph>=1.2.16",
    "langchain-openai>=1.0.0",
]

[dependency-groups]
dev = [
    "httpx>=0.27.0",
    "pytest>=8.3.0",
    "ruff>=0.6.0",
]
```

**这段在干什么**（与 `package.json` 对照）：

- `[project]` ≈ `package.json` 顶层：`name`/`version`/`description` 是项目元数据。
- `requires-python = ">=3.12"`：**约束解释器版本**（≈ `engines.node`），低于 3.12 直接拒绝。
- `dependencies = [...]` ≈ `dependencies`：运行期依赖。写法 `包名>=下限`（PEP 508）。例如 `uvicorn[standard]` 的 `[standard]` 是**可选依赖组**（会多带 `watchfiles` 等，支撑 `--reload`）。
- `[dependency-groups] dev` ≈ `devDependencies`：只在开发时需要（`uv sync` 默认一并装上）。**注意**：`dev` 依赖**不会**写进 `dependencies`，这与 npm 的 `devDependencies` 是同一思路。

---

## 6. FastAPI 心智模型（与 NestJS 对照）

这一节**只讲「这套机制和 NestJS 有什么不同」**——Pydantic / `APIRouter` / uvicorn / uv 的语法细节已在 `06-FastAPI起步.md` 讲透，`Depends` / 异常处理器已在 `01-账号与认证/05-FastAPI认证.md` 讲透，本篇不复述。

### 6.1 一张总表

| 你熟悉的 NestJS | FastAPI | **重点差异** |
| --- | --- | --- |
| `@Controller('health')` | `APIRouter(tags=["health"])` | 分组作用类似 |
| `@Get()` | `@router.get("/health")` | 路由装饰器类似 |
| 构造函数注入 `constructor(private x: S)` | **函数参数上写 `Depends`** | ⭐ 注入方式完全不同（见 6.4） |
| DTO + `class-validator` + `ValidationPipe` | Pydantic `BaseModel` | ⭐ 校验时机/机制不同（见 6.5） |
| 异常过滤器 `@Catch` + `ExceptionFilter` | `@app.exception_handler` | 作用类似（见 6.6） |
| 方法几乎总是同步签名 | 路由可 `async def` 也可 `def` | ⭐ Python 区分「同步/异步函数」（见 6.7） |
| `NestFactory.create()` + `app.listen()` | `FastAPI()` 应用对象 + uvicorn | ⭐ 「框架对象」与「服务器」分离（见 6.2） |
| Module 的 `imports`/`providers` 登记 | `app.include_router(...)` | Nest 靠模块装配、FastAPI 靠显式 include |

### 6.2 ASGI 应用对象 `app` 是什么

你在 `main.ts` 里写 `NestFactory.create(AppModule)` 得到一个应用实例，然后 `app.listen(3001)`——**Nest 自己就是服务器**（底层用 Express）。

FastAPI 则把「**处理请求的规则**」和「**监听端口**」拆成两层：

- `app = FastAPI(...)` 创建的是一个 **ASGI 应用对象**——它定义了「收到请求后怎么处理」，但**自己不监听任何端口**。
- 真正监听端口的是 **ASGI 服务器**（本项目用 **uvicorn**）。

**ASGI**（Asynchronous Server Gateway Interface）：Python 世界里「服务器 ↔ 应用」之间的**标准接口**——只要你的对象符合这个接口，就能被任意 ASGI 服务器（uvicorn / hypercorn…）承载。

**项目里的真实应用对象**（`apps\api-py\app\main.py` 第 18 行）：

```python
app = FastAPI(title="mini-dify api-py", version=settings.version)
```

**这段在干什么**：创建 ASGI 应用对象，`title`/`version` 只是文档元信息。之后 `app.include_router(...)` 把路由挂上、`app.add_middleware(...)` 加中间件——**都不涉及端口**。端口由启动命令里的 uvicorn 决定（`--port 8000`）。

> **对照 API 名**：uvicorn 启动命令 `uvicorn app.main:app` 里的 `app.main:app` = 「导入模块 `app.main`，取其中名为 `app` 的对象」。冒号后那个 `app` 就是这个 `FastAPI` 实例。（三者同名纯属巧合，别混淆。）

### 6.3 `APIRouter`（对标 `@Controller`）

`APIRouter` 把「一组同类路由」收拢到一个对象里，`app.include_router(router)` 再挂到应用上——≈ 把 Controller 登记进 Module。

**项目里的真实路由分组**（`apps\api-py\app\api\apps.py` 第 21 行）：

```python
router = APIRouter(prefix="/apps", tags=["apps"])
```

**这段在干什么**：建一个路由组，`prefix="/apps"` 表示「这组路由的公共前缀是 `/apps`」——所以下面 `@router.get("")` 最终是 `GET /apps`，`@router.get("/{id}")` 最终是 `GET /apps/{id}`。`tags` 只影响自动文档分组。**不 `include_router` 到 `app` 上，这组路由不生效**（见 `main.py` 第 31~35 行的 `app.include_router(...)`）。

### 6.4 `Depends`——按「函数参数」注入（vs NestJS 的构造函数注入）

**NestJS**：你写 `constructor(private healthService: HealthService) {}`——依赖**声明在类的构造参数**上，Nest 读装饰器元数据后自动创建并传入。

**FastAPI**：依赖**声明在每个处理函数的参数**上，用 `Depends(某个可调用对象)` 标注——FastAPI 在调用该函数前，先自动执行这个依赖、把结果作为实参传进来。

**项目里的真实用法**（`apps\api-py\app\api\apps.py` 第 92~96 行）：

```python
@router.get("", response_model=AppListResponse, operation_id="listApps")
def list_apps(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AppListResponse:
```

**这段在干什么**：

- 参数 `current_user: User = Depends(get_current_user)`：意思是「**在调用 `list_apps` 之前，先执行 `get_current_user`，把它的返回值作为 `current_user`**」。`get_current_user` 会解析请求头里的 JWT、查出用户（见 `deps.py`）。
- 参数 `db: Session = Depends(get_db)`：同理，先执行 `get_db` 拿到一个数据库会话。
- **依赖还可以依赖依赖**：`get_current_user` 自己又 `Depends(get_db)` 与 `Depends(bearer_scheme)`（`deps.py`）。FastAPI 会自动按需解析这一层层依赖，你**不用手写任何装配代码**。

**为什么这个差异重要**：

| | NestJS | FastAPI |
| --- | --- | --- |
| 声明位置 | **类的构造参数** | **每个函数的参数** |
| 注入粒度 | 整个类共享同一份依赖 | **每个函数各自声明要什么** |
| 权限控制 | 「Guard 贴在 Controller/方法上」 | 「把鉴权做成一个依赖函数，需要它的路由就 `Depends(get_current_user)`」 |
| 类比 | IoC 容器管类 | 「**函数级中间件/前置步骤**」按需注入 |

> 对照笔记：`01-账号与认证/05-FastAPI认证.md` 把 `get_db`（会话依赖）、`get_current_user`（鉴权依赖）讲透了。这里只强调**心智差异**：Nest 按「类」注入、FastAPI 按「函数参数」注入；FastAPI 的 `Depends` 天生就是「可组合的前置逻辑」。

### 6.5 Pydantic 模型（对标 DTO + `class-validator`）

**NestJS**：`interface` 只管编译期；要**运行期**校验就写 DTO 类 + `class-validator` 装饰器，再靠 `ValidationPipe` 生效（`01-账号与认证/03-NestJS认证.md`）。

**FastAPI**：直接写一个继承 `BaseModel` 的类，字段就是**类型注解**——Pydantic 会在**运行期**按注解**真正校验**、并在失败时抛错。

**项目里的真实模型**（`apps\api-py\app\api\apps.py` 第 44~51 行）：

```python
class CreateAppRequest(BaseModel):
    """对应契约 `CreateAppRequest`。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=256)
    mode: AppMode | None = None
```

**这段在干什么**：

- `class CreateAppRequest(BaseModel)`：定义一个**请求体模型**（≈ DTO）。
- `model_config = ConfigDict(extra="forbid")`：**禁止多余字段**（≈ 契约的 `additionalProperties: false`）。
- `name: str = Field(min_length=1, max_length=64)`：字段 + 约束（≈ `@IsString()` + `@MinLength(1)` + `@MaxLength(64)` 的组合）。
- `description: str | None = Field(default=None, ...)`：可空字段（`str | None`，见 §4.3），默认 `None`。
- 当路由声明 `body: CreateAppRequest` 时，FastAPI 会自动：**解析 JSON → 用这个模型校验 → 通过才把模型实例交给你**。非法输入立刻被拦（默认 422，本项目已改成 400，见 6.6）。

**两个必须记住的差异**：

1. **校验是「运行期」的**：Pydantic 用你写在字段上的**注解**（运行期保留，见 §4.3）在**每次请求**时真正校验——这补上了 TS「类型被擦除」留下的缺口。
2. **错误码 422 → 400**：FastAPI 默认对校验失败返回 **422 Unprocessable Entity**；但本项目的契约要求与 TS 侧**逐字节一致**（TS 侧是 **400**），所以 `apps/api-py/app/errors.py` 里把 `RequestValidationError` **改成了 400**（见 6.6）。

### 6.6 异常处理器 `@app.exception_handler`（对标异常过滤器）

**NestJS**：`@Catch(SomeException)` + 实现 `ExceptionFilter`，再全局注册（`01-账号与认证/03-NestJS认证.md`）。

**FastAPI**：用 `@app.exception_handler(异常类型)` **注册一个处理函数**——某个异常被抛出时，用这个函数决定返回什么响应。

**完整文件路径：`apps\api-py\app\errors.py`（节选，逐字）**

```python
def register_error_handlers(app: FastAPI) -> None:
    """注册异常处理器（须在创建 app 之后、提供服务之前调用）。"""

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return _envelope(exc.status_code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _envelope(status.HTTP_400_BAD_REQUEST, _build_message(exc.errors()))
```

**这段在干什么**：

- `register_error_handlers(app)` 是一个**普通函数**，里面用 `@app.exception_handler(...)` **注册了两个处理器**——装饰器的作用是「把下面这个函数登记为「遇到某类异常时要调用的处理函数」」。
- 第一个处理 `StarletteHTTPException`（HTTP 异常，如路由里 `raise HTTPException(...)` 抛出的）：把默认的 `{detail}` 归一成契约要求的 `{statusCode, message, error}`（靠 `_envelope(...)`）。
- 第二个处理 `RequestValidationError`（**Pydantic 校验失败**）：**关键是它把状态码从 FastAPI 默认的 422 改成了 400**，并且把错误消息按契约文案规则重组成一条字符串。
- 两个处理函数都是 `async def`（FastAPI 用协程调用处理器）。

> `_envelope` 里的 `_REASON_PHRASES`（400→"Bad Request" 等）和 `_build_message`（按「字段顺序 + 规则顺序」拼消息）见该文件完整内容——它们是「让两套后端错误体逐字节一致」的核心，细节见 `01-账号与认证/05-FastAPI认证.md` 与 `02-应用管理/07-验收.md`。

**心智差异**：Nest 的过滤器是「**一个类实现接口 + 装饰器声明捕获哪些异常**」；FastAPI 是「**一个函数 + `@app.exception_handler(异常类型)` 登记**」——同样是「异常 → 响应」的映射，表达成函数更轻。

### 6.7 `async def` 路由 vs `def` 路由——何时用哪个

**NestJS**：Controller 方法几乎总是同步签名（`getHealth(): HealthResponse`）——Node 的事件循环在框架层处理异步。

**FastAPI**：路由处理函数**两种都能写**：

- `async def`：FastAPI 会把它当**协程**，直接在事件循环里调度。**适合内部有 `await`（异步 I/O）** 的处理。
- 普通 `def`：FastAPI 会把它丢进**线程池**执行，不阻塞事件循环。**适合内部是同步阻塞调用**（比如本项目里同步的 SQLAlchemy `db.commit()`）。

**项目里的实际选择**：

- `health.py` 用 `async def get_health()`——只是「无 I/O 的简单返回」，两种都行；
- `apps.py` 的 `list_apps`/`create_app` 等用**普通 `def`**——因为内部是同步的 SQLAlchemy 调用（`db.get` / `db.commit`）。FastAPI 会把它们放线程池跑，避免卡住事件循环。
- `run.py` 的 `run_app` 用 `async def`——因为它要返回 `StreamingResponse`、异步产出 SSE 帧。

**记住一句话**：**`await` 只能写在 `async def` 里（§4.12）；用 `def` 时，里面的同步阻塞代码由 FastAPI 用线程池兜住**。选哪个看「函数体内是不是真在 `await` 异步 I/O」。

### 6.8 运行期「对象 → JSON」是怎么发生的

NestJS 里你 `return {...}` 就直接被序列化成 JSON。FastAPI 则用 `response_model` **显式声明返回值形状**：

**项目里的真实声明**（`apps\api-py\app\api\health.py` 第 30 行）：

```python
@router.get("/health", response_model=HealthResponse, operation_id="getHealth")
```

**这段在干什么**：`response_model=HealthResponse` 告诉 FastAPI「这个路由的返回值必须符合 `HealthResponse` 模型」——FastAPI 会**按模型校验并序列化**，字段多一个/少一个/类型不对都会暴露；同时用它生成 OpenAPI 文档。`operation_id="getHealth"` 对应契约里的 `operationId`。

---

## 7. 项目里这些概念出现在哪（指路）

读后续篇目时，回到这张表查「这个 Python 概念在哪篇讲过 / 在哪用到」：

| 概念 | 本项目出现处 | 讲透处 |
| --- | --- | --- |
| 缩进 / `None` / `is None` | `app/api/deps.py` | **本篇 §4.1~4.2** |
| 类型注解 / `Literal` / `str \| None` | `app/api/health.py`、`app/models/app.py` | 本篇 §4.3；`06-FastAPI起步.md` |
| f-string | `app/engine/events.py` | 本篇 §4.4 |
| 容器 / 推导式 / 解包 | `app/api/apps.py`、`app/api/run.py`、`app/engine/engine.py` | 本篇 §4.5~4.7 |
| 函数默认值 / `*` 关键字专用 | `app/security.py` | 本篇 §4.8 |
| `class` / `self` | 各 Pydantic 模型、`app/models/*` | 本篇 §4.10 |
| 异常 `raise` / `try-except` | `app/api/deps.py`、`app/security.py` | 本篇 §4.11 |
| `async def` / `await` / `yield` | `app/api/health.py`、`app/engine/engine.py` | 本篇 §4.12；引擎篇见 `04-执行引擎/04-LangGraph与引擎-Python.md` |
| `with` / 会话依赖 `get_db` | `app/api/deps.py` | 本篇 §4.13；`01-账号与认证/05-FastAPI认证.md` |
| 装饰器（`@router.get` / `@field_serializer` / `@app.exception_handler`） | `app/api/*`、`app/errors.py` | 本篇 §4.14 |
| `if __name__ == "__main__"` | `app/main.py` | 本篇 §4.15 |
| 模块 / 包 / `__init__.py` / 导入 | `app/__init__.py`、`app/api/__init__.py` | 本篇 §5.1~5.3 |
| 虚拟环境 / uv / `pyproject.toml` | 根 `package.json`、`apps/api-py/pyproject.toml` | 本篇 §5.4~5.5；`01-环境准备.md` |
| Pydantic 模型 / `extra="forbid"` | `app/api/*.py` | 本篇 §6.5；`06-FastAPI起步.md` |
| `APIRouter` / `include_router` | `app/main.py`、`app/api/*.py` | 本篇 §6.3；`06-FastAPI起步.md` |
| `Depends` | `app/api/deps.py`、`app/api/apps.py` | 本篇 §6.4；`01-账号与认证/05-FastAPI认证.md` |
| 异常处理器 / 422→400 | `app/errors.py` | 本篇 §6.6；`01-账号与认证/05-FastAPI认证.md` |
| ASGI 应用对象 / uvicorn | `app/main.py` | 本篇 §6.2；`06-FastAPI起步.md` |
| SQLAlchemy `Mapped[]` / `mapped_column` | `app/models/user.py`、`app/models/app.py` | `01-账号与认证/04-SQLAlchemy2.0.md`、`02-应用管理/04-SQLAlchemy关系建模.md` |

---

## 8. 自测题（10 道，含答案）

> 先自己答，再对照答案。

**Q1.** TS 的 `null` 在 Python 里对应什么？判断「是不是它」该用哪个运算符？

**Q2.** 下面这行会报错吗？为什么？`x: int = "hello"`

**Q3.** 把 TS 的 `` `你好，${name}` `` 翻译成 Python。

**Q4.** `[n * 2 for n in nums]` 等价 TS 的什么操作？

**Q5.** 为什么不能写 `def f(items=[])`？正确写法是什么？

**Q6.** Python 里 `User("bob")` 前面为什么不用 `new`？`self` 是什么？

**Q7.** 为什么下面会报错？`def f(): await g()`

**Q8.** `with SessionLocal() as session:` 里的 `with` 帮我们做了什么？等价 TS 的什么？

**Q9.** `if __name__ == "__main__":` 的意义是什么？用 `uvicorn app.main:app` 启动时它会被执行吗？

**Q10.** `Depends(get_current_user)` 和 NestJS 的构造函数注入，最本质的差异是什么？

<details>
<summary>展开答案</summary>

**A1.** 对应 `None`（Python 没有 `undefined`）。判断用 `is`：`x is None`（≈ TS 的 `x === null`）。

**A2.** **不会报错**。Python 的注解默认**不强制、不转换**——`x` 真的就是个字符串 `"hello"`。要靠注解校验得用 Pydantic。

**A3.** `f"你好，{name}"`。前面加 `f`，用 `{}` 插值。

**A4.** 等价 `nums.map(n => n * 2)`（列表推导式 = 映射；带 `if` 就是先 `filter` 再 `map`）。

**A5.** 因为默认值 `[]` **只在定义时创建一次**，所有调用**共用同一个列表**，会互相污染。正确写法：`def f(items=None):` 然后在函数体里 `if items is None: items = []`。

**A6.** Python 创建实例**不用 `new`**，直接调用类名。`self` 是实例方法**第一个显式参数**，代表当前实例（≈ TS 的 `this`，但必须写出来）。

**A7.** 会报**语法错误**。因为 **Python 的异步是全链路的：同步函数（`def`）里不能 `await`**——必须写成 `async def f():`。

**A8.** `with` 是**上下文管理器**：进入时拿到 `session`，**离开缩进块时（含异常）自动释放/关闭**资源。等价 TS 的 `try { ... } finally { session.close() }`（更好用的语法糖）。

**A9.** 意义：同一份 `.py` **既能被导入、也能被直接运行**；`__name__ == "__main__"` 表示「我这次是被**直接运行**的」，于是执行该块。用 `uvicorn app.main:app` 时是「**导入**模块」，此时 `__name__ == "app.main"` ≠ `"__main__"`，所以 **不会执行**。

**A10.** NestJS 依赖声明在**类的构造参数**、由容器按类装配；FastAPI 依赖声明在**每个函数的参数**上、按函数**按需注入**——粒度从「类级」降到「函数级」，且 `Depends` 天生就是可组合的前置逻辑（鉴权、会话等）。

</details>

---

## 9. 常见坑（TS → Python）

| 坑 | 现象 | 原因 / 解决 |
| --- | --- | --- |
| 用花括号划代码块 | `SyntaxError` | Python 用**冒号 + 缩进**（统一 4 空格），不用 `{}` |
| 写 `true/false/null` | `NameError: name 'true' is not defined` | Python 是 **`True`/`False`/`None`**（首字母大写） |
| 用 `count++` | 语法错误 | Python **没有 `++`**，用 `count += 1` |
| 用 `===` / `!=` | 语法错误 | Python 是 `==`；「是不是 None」用 **`is None`** |
| 以为注解会拦类型 | 传错类型也不报错 | 注解**默认不强制**；要校验用 **Pydantic** |
| `else if` | 语法错误 | Python 是 **`elif`** |
| 默认参数写 `[]`/`{}` | 多次调用结果「累积」 | **可变默认值会共享**；改用 `None` + 函数内新建（§4.9） |
| 在 `def` 里 `await` | 语法错误 | 异步是全链路的：**要 `await` 就得 `async def`**（§4.12） |
| 把 TS 的 `...` 当解包 | 语法错误 | Python 解包：列表用 `*`、字典用 `**`（`[...a, ...b]` → `[*a, *b]`、`{...a}` → `{**a}`） |
| 用文件相对路径导入 | `ModuleNotFoundError` | Python 用**点号包路径**（`from app.config import settings`）；且**从哪个目录启动**会影响能否解析到 `app` 包（§5.3） |
| 从仓库根跑 `uv run --project apps/api-py uvicorn ...` | `No module named 'app'` | `--project` **不切工作目录**；要用 **`--directory apps/api-py`**（§5.3） |
| 忘了 `__init__.py` | 目录不被当包、点号导入失败 | 包目录里要有 `__init__.py`（§5.1） |
| 期望校验失败返回 422「也对」 | 契约测试报不一致 | 本项目已把校验失败**归一为 400**（`app/errors.py`，§6.5~6.6） |

---

## 10. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

> 说明：本篇是**语言基础**篇，登记的是「Python 语言最小集」——与 INDEX 里已登记的**框架**技术点（Pydantic / `APIRouter` / uvicorn / uv / `Depends` / 异常处理器）**不冲突、不重复**。

| 技术点 | 说明 |
| --- | --- |
| Python 缩进即语法块 / 变量与 `None` / `is None` / 真假值 | **首次教学于本篇** |
| Python 类型注解（**运行期保留、默认不强制、不转换**）与 TS 擦除的对照 | **首次教学于本篇** |
| f-string（`f"{x}"`） | **首次教学于本篇** |
| 容器 `list`/`dict`/`set`/`tuple`、索引与切片、字典/列表解包（`**`/`*`） | **首次教学于本篇** |
| 推导式（列表/字典/集合）、`range` / `enumerate` / `zip` | **首次教学于本篇** |
| 函数：默认参数、`*args` / `**kwargs`、关键字专用 `*`、多返回值解包 | **首次教学于本篇** |
| 可变默认参数坑（`[]`/`{}` 共享）与 `None` 占位写法 | **首次教学于本篇** |
| `class` / `self` / `__init__` / 不需要 `new` / `_name` 私有约定 / `__dunder__` | **首次教学于本篇** |
| `@dataclass`（对照 Pydantic；讲清「只标注不校验」） | **首次教学于本篇**（概念） |
| 异常处理 `try` / `except` / `raise` / `finally` 与 EAFP 风格 | **首次教学于本篇** |
| `async def` / `await`（**Python 异步是全链路的**：同步函数不能 `await`） | **首次教学于本篇** |
| `with` 上下文管理器（对标 `try/finally`）；`yield` 生成器（`get_db` 会话依赖内核） | **首次教学于本篇** |
| 装饰器是**普通函数**（`@d` ≡ `f = d(f)`）；与 TS 装饰器的差异 | **首次教学于本篇** |
| `if __name__ == "__main__":`（导入 vs 直接运行） | **首次教学于本篇** |
| 模块 / 包 / `__init__.py` / 点号导入 / `sys.path` 与**启动目录决定导入** | **首次教学于本篇** |
| 虚拟环境 `.venv`、`pyproject.toml` ↔ `package.json`（语言基础视角） | 框架细节见 `01-环境准备.md` |
| FastAPI 心智模型：ASGI 应用对象、`APIRouter`、`Depends`（函数级注入 vs Nest 构造函数注入）、Pydantic（运行期校验 vs DTO+class-validator）、异常处理器（422→400）、`async def` vs `def` 路由 | 心智对照**本篇**；细节见 `06-FastAPI起步.md`、`01-账号与认证/05-FastAPI认证.md` |
