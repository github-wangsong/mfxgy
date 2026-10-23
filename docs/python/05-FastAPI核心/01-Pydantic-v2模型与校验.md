# 01 · Pydantic v2 模型与校验

> 所属：阶段 5 · FastAPI 核心
> 本篇覆盖：`BaseModel` 声明与实例化、宽松模式（lax）与严格模式（strict）的类型转换、`Field` 的全套约束（`min_length`/`pattern`/`ge`/`default_factory`/`alias`）、`model_config`（`extra`/`str_strip_whitespace`/`populate_by_name`/`from_attributes`/`frozen`/`validate_assignment`）、`field_validator`（`before`/`after`）与 `model_validator`、`Annotated` + `AfterValidator`、`ValidationError` 的错误结构、嵌套模型与递归、序列化（`model_dump`/`model_dump_json`/`exclude_unset`/`field_serializer`/`computed_field`）、`TypeAdapter`、与 FastAPI 的接缝（422 结构、OpenAPI schema、`response_model`）、v1 → v2 迁移对照
> **本篇首次教学：Pydantic v2 的宽松/严格两种校验模式、`Field` 约束参数表与 `default_factory`、`ConfigDict` 的七个常用配置、`@field_validator(mode="before"/"after")` 的时机差异、`@model_validator(mode="after")` 做跨字段校验、`Annotated[T, AfterValidator(...)]` 可复用校验类型、`ValidationError.errors()` 的字段结构（`type`/`loc`/`msg`/`input`）、嵌套模型与自引用递归、`model_dump(mode="json")` 与 `field_serializer`、`computed_field`、`TypeAdapter` 校验非模型数据、`populate_by_name` 与 `alias` 的配合**
> 预告：下一篇讲依赖注入 `Depends`——把「取当前用户」「拿数据库会话」变成可组合的函数。

> 项目锚点：`apps/api-py/app/api/apps.py` 的 `AppResponse`/`CreateAppRequest`/`UpdateAppRequest`/`AppListResponse`（真实文件：`extra="forbid"`、`Field(min_length=1, max_length=64)`、`field_serializer` 输出 `Z` 时间）、`app/api/health.py` 的 `HealthResponse`、`app/config.py` 的 `Settings`（`BaseSettings` 就是 `BaseModel` 的配置化子类）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 写出带完整约束的输入/输出模型，并让 `/docs` 自动展示这些约束。
2. 区分宽松模式与严格模式，知道 `"123"` 会不会变成 `123`。
3. 用 `field_validator` 与 `model_validator` 处理单字段与跨字段规则。
4. 用 `model_dump(exclude_unset=True)` 实现 PATCH 语义（阶段 4 已用，本篇讲透原理）。
5. 用 `field_serializer` 统一时间/枚举的输出格式。
6. 读懂 `ValidationError.errors()` 并据此定制错误响应。
7. 把 v1 的 `class Config` / `validator` / `dict()` 正确迁到 v2 写法。

**验收标准**

- 能解释为什么 `Optional[str]` 在 v2 里不等于「可以不传」。
- 能写出「开始时间必须早于结束时间」的跨字段校验。
- 能说出 `model_dump()` 与 `model_dump(mode="json")` 的区别。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [04-Web基础/02 FastAPI 第一个应用](../04-Web基础与FastAPI起步/02-FastAPI第一个应用.md)（422、`response_model`）、[04-Web基础/03 路由、参数与响应](../04-Web基础与FastAPI起步/03-路由、参数与响应.md)（Body 与 `exclude_unset`） |
| 已掌握 | 类、类型注解、`Annotated`（[01-Python进阶/01](../01-Python进阶/01-类型注解与typing.md)） |

---

## 3. `BaseModel` 基础

### 3.1 最小模型

```python
from pydantic import BaseModel


class User(BaseModel):
    id: str
    name: str
    age: int = 0


u = User(id="u1", name="张三")          # 缺 age 用默认值
print(u)                                # id='u1' name='张三' age=0
print(u.model_dump())                   # {'id': 'u1', 'name': '张三', 'age': 0}
```

| 事实 | 说明 |
| --- | --- |
| 模型类本身不是数据 | 实例才持有数据 |
| 构造时即校验 | 不合法立刻抛 `ValidationError` |
| 字段顺序保留 | 声明顺序即输出顺序 |
| 不可序列化字段 | 直接 `json.dumps(u)` 会失败 → 用 `model_dump_json()` |

### 3.2 宽松模式（默认）

```python
class Item(BaseModel):
    count: int
    price: float
    active: bool


Item(count="123", price="9.9", active="true")     # ✅ 全部转换成功
```

| 输入 | 目标 | 结果（lax） |
| --- | --- | --- |
| `"123"` | `int` | `123` |
| `"9.9"` | `float` | `9.9` |
| `"true"` / `"1"` / `"on"` | `bool` | `True` |
| `"2026-10-23T02:00:00Z"` | `datetime` | `datetime(...)` |
| `"abc"` | `int` | ❌ `ValidationError` |

### 3.3 严格模式

```python
Item.model_validate({"count": "123", "price": 9.9, "active": True}, strict=True)
# ❌ count 必须是 int，字符串不接受
```

| 场景 | 用哪个 |
| --- | --- |
| 接收外部 JSON（前端/Hook） | 宽松（默认） |
| 内部函数边界、防止隐式转换掩盖 bug | 严格 |
| 契约要求「不接受 `"1"` 当布尔」 | 严格或用 `StrictBool` |

```python
from pydantic import StrictBool, StrictInt

class Flags(BaseModel):
    enabled: StrictBool          # 只接受 True/False
    retries: StrictInt           # 只接受 int
```

> 宽松模式方便但危险：**`"0"` 转成 `False` 往往不是调用方本意**。对外契约建议显式用 `Strict*` 或 `Literal`。

---

## 4. `Field`：约束与默认值

### 4.1 约束参数

```python
from pydantic import BaseModel, Field


class CreateAppRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=256)
    mode: str = Field(default="chatflow", pattern="^(chatflow|workflow)$")
    max_rounds: int = Field(default=5, ge=1, le=20)
    ratio: float = Field(default=0.5, gt=0, lt=1)
```

| 参数 | 适用类型 | 作用 |
| --- | --- | --- |
| `min_length`/`max_length` | str / list | 长度 |
| `pattern` | str | 正则（完整匹配语义，见坑表） |
| `ge`/`gt`/`le`/`lt` | 数值 | 范围 |
| `multiple_of` | 数值 | 倍数 |
| `default` | 任意 | 默认值 |
| `default_factory` | list/dict/对象 | 每次新建（避免共享可变默认） |
| `alias` | 任意 | 对外字段名 |
| `description`/`examples` | 任意 | 进 `/docs` |
| `deprecated=True` | 任意 | 文档标记废弃 |

> **可变默认值必须用 `default_factory`**：

```python
class Bad(BaseModel):
    tags: list[str] = []                    # ❌ v2 会报错/告警（共享可变对象）

class Good(BaseModel):
    tags: list[str] = Field(default_factory=list)      # ✅
```

原因见 [00-Python基础/03](../00-Python基础/03-函数与作用域.md) §6 的可变默认参数陷阱——Pydantic 只是把它显式拦下来了。

### 4.2 `Optional` 的 v2 语义（高频误解）

```python
class A(BaseModel):
    name: str | None                 # ⚠️ 必填，只是允许 None
    nick: str | None = None          # ✅ 可以不传
```

| 写法 | 不传会怎样 |
| --- | --- |
| `x: str \| None` | ❌ `ValidationError: Field required` |
| `x: str \| None = None` | ✅ 取 `None` |
| `x: str = None` | ❌ v2 类型与默认值不一致（mypy 也会报） |

> v1 里 `Optional[X]` 会自动加 `= None`；**v2 取消了这层隐式行为**。迁移时最容易漏的就是这里。

### 4.3 `alias` 三种

```python
class App(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_id: str = Field(alias="ownerId")                 # 输入输出都用 ownerId
```

| 别名 | 影响输入 | 影响输出 |
| --- | --- | --- |
| `alias` | ✅ | ✅ |
| `validation_alias` | ✅ | ❌ |
| `serialization_alias` | ❌ | ✅ |

```python
class Settings(BaseSettings):
    access_token_expires_in: int = Field(default=3600, validation_alias="JWT_EXPIRES_IN")
```

`populate_by_name=True` 让你**既能用别名也能用字段名**构造：

```python
App(ownerId="u1")        # ✅ 别名
App(owner_id="u1")       # ✅ 字段名（需 populate_by_name=True）
```

> 与项目里的 `validation_alias="JWT_EXPIRES_IN"` 是同一机制（[03-工程化/02](../03-工程化/02-配置与日志.md) §4.5）：**内部命名自由，外部契约固定**。

---

## 5. `model_config`：模型级开关

```python
from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        populate_by_name=True,
        from_attributes=True,
        validate_assignment=True,
        frozen=False,
    )
```

| 配置 | 作用 | 典型用途 |
| --- | --- | --- |
| `extra="ignore"` | 忽略多余字段（默认） | 宽容接入 |
| `extra="forbid"` | 多余字段报错 | **契约严格**（项目全用这个） |
| `extra="allow"` | 保留在 `model_extra` | 透传扩展字段 |
| `str_strip_whitespace=True` | 自动去首尾空白 | 用户输入 |
| `populate_by_name=True` | 允许字段名与别名混用 | 配 alias |
| `from_attributes=True` | 支持从对象属性读取（ORM） | `model_validate(orm_obj)` |
| `validate_assignment=True` | 赋值时也校验 | 可变模型（有性能成本） |
| `frozen=True` | 不可变（可哈希） | 值对象、配置快照 |
| `use_enum_values=True` | 存枚举值而非枚举对象 | 输出干净 |

**`extra="forbid"` 的价值**：

```json
{"name": "x", "nmae": "y"}
```

| extra | 结果 |
| --- | --- |
| `ignore` | 静默丢弃拼错的字段 → 用户以为生效了 |
| `forbid` | `422`：`Extra inputs are not permitted (nmae)` → **立刻发现契约不符** |

> 这就是项目里每个契约模型都写 `extra="forbid"` 的原因：**宁可报错，不要静默**。

### 5.1 ORM 对象转模型

```python
class AppResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str

@app.get("/apps/{id}")
def get(id: str, db=Depends(get_db)):
    app = db.get(App, id)                 # SQLAlchemy 对象
    return AppResponse.model_validate(app)     # 直接从属性读
```

> 项目里没用 `from_attributes`，而是手写 `_to_app_response()` 映射——因为要做 `owner_id → ownerId` 的字段改名。两种做法都合法，**字段名一致时 `from_attributes` 更省代码**。

---

## 6. 校验器

### 6.1 `field_validator`：单字段

```python
from pydantic import BaseModel, field_validator


class User(BaseModel):
    name: str
    email: str

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("名字不能为空")
        return v

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("邮箱格式不正确")
        return v.lower()
```

| 要点 | 说明 |
| --- | --- |
| 必须 `@classmethod` | v2 要求 |
| 参数是「已解析的值」 | 可返回新值做规范化 |
| `raise ValueError` | 被包成 `ValidationError` |
| 一个装饰器可管多字段 | `@field_validator("a", "b")` |

### 6.2 `mode="before"` vs `"after"`

```python
@field_validator("name", mode="before")
@classmethod
def strip_first(cls, v):
    print("before:", repr(v), type(v))        # 原始输入（可能是 None/int）
    return v.strip() if isinstance(v, str) else v

@field_validator("name", mode="after")
@classmethod
def check_after(cls, v: str):
    print("after:", repr(v), type(v))         # 已是 str
    return v
```

| 模式 | 时机 | 适用 |
| --- | --- | --- |
| `before` | 类型转换**之前** | 预处理（去空白、拆字符串、兼容旧格式） |
| `after`（默认） | 类型转换**之后** | 业务规则校验 |

> 顺序：`before` → 类型转换 → `after` → `model_validator`。

### 6.3 `model_validator`：跨字段

```python
from datetime import datetime
from pydantic import BaseModel, model_validator


class TimeRange(BaseModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def check_order(self):
        if self.start >= self.end:
            raise ValueError("start 必须早于 end")
        return self
```

| 模式 | 时机 | 参数 |
| --- | --- | --- |
| `mode="before"` | 整个 dict 校验前 | 收到原始数据 |
| `mode="after"` | 所有字段校验后 | 收到 `self`，**必须 return self** |

> 忘写 `return self` 是最常见的 bug——模型会变成 `None`。

### 6.4 `Annotated` + `AfterValidator`：可复用类型

```python
from typing import Annotated
from pydantic import AfterValidator

def must_be_positive(v: int) -> int:
    if v <= 0:
        raise ValueError("必须为正数")
    return v

PositiveInt = Annotated[int, AfterValidator(must_be_positive)]

class Order(BaseModel):
    count: PositiveInt
    amount: PositiveInt
```

| 对比 | 优点 |
| --- | --- |
| 每个模型写 `field_validator` | 直观，但重复 |
| `Annotated[..., AfterValidator]` | **一次定义，处处复用**，还能用于函数参数 |

> 组合能力：`Annotated[str, Field(min_length=1), AfterValidator(strip)]`。

### 6.5 `ValidationError` 的结构

```python
try:
    User(name="", email="bad")
except ValidationError as e:
    print(e.errors())
```

```python
[
  {"type": "value_error", "loc": ("name",), "msg": "Value error, 名字不能为空", "input": "", "ctx": {...}},
  {"type": "value_error", "loc": ("email",), "msg": "Value error, 邮箱格式不正确", "input": "bad"}
]
```

| 字段 | 说明 |
| --- | --- |
| `type` | 错误类别（`missing`/`value_error`/`string_too_short`…） |
| `loc` | 出错位置（嵌套时是元组，如 `("items", 0, "price")`） |
| `msg` | 人读消息 |
| `input` | 原始输入（**可能含敏感数据，日志要过滤**） |

> FastAPI 把 `errors()` 序列化后放进 `422` 响应的 `detail`。项目用 `errors.py` 再包装成 `{statusCode, message, error}`。

---

## 7. 嵌套与递归

### 7.1 嵌套模型

```python
class Chunk(BaseModel):
    id: str
    score: float

class Retrieval(BaseModel):
    query: str
    hits: list[Chunk]                    # ✅ 自动逐项校验
    meta: dict[str, str] = Field(default_factory=dict)
```

错误定位会带上层级：

```python
Retrieval(query="x", hits=[{"id": "c1", "score": "high"}])
# loc = ("hits", 0, "score")  → 第 0 个 hit 的 score
```

> 读 `.loc` 就能精确告诉前端「哪个数组第几项哪个字段错了」。

### 7.2 自引用（递归树）

```python
class Node(BaseModel):
    name: str
    children: list["Node"] = Field(default_factory=list)      # 用字符串前向引用
```

> 也支持 `model_rebuild()` 处理更复杂的循环；一般自引用直接写字符串即可。

---

## 8. 序列化

### 8.1 `model_dump` 家族

```python
u = User(id="u1", name="张三", age=20)

u.model_dump()                       # dict，datetime 仍是 datetime
u.model_dump(mode="json")            # datetime → ISO 字符串（可 json.dumps）
u.model_dump(exclude={"age"})        # 去掉某字段
u.model_dump(exclude_unset=True)     # 只含「显式设置过」的字段
u.model_dump(exclude_none=True)      # 去掉 None
u.model_dump(exclude_defaults=True)  # 去掉等于默认值的
u.model_dump_json(indent=2)          # 直接给 JSON 字符串
```

| 方法 | 用途 |
| --- | --- |
| `model_dump()` | 给 Python 代码用（保持原类型） |
| `model_dump(mode="json")` | 给 `json.dumps` / 日志用 |
| `model_dump_json()` | 一步到位字符串 |

> 踩坑：`json.dumps(model.model_dump())` 遇到 `datetime`/`UUID`/`Decimal` 会炸——**加 `mode="json"`**。

### 8.2 `field_serializer`：定制输出

```python
from datetime import datetime
from pydantic import BaseModel, field_serializer


class AppResponse(BaseModel):
    id: str
    createdAt: datetime
    updatedAt: datetime

    @field_serializer("createdAt", "updatedAt")
    def _serialize_timestamps(self, value: datetime) -> str:
        return iso_z(value)                 # 统一输出 2026-10-23T02:00:00.000Z
```

| 场景 | 为什么要定制 |
| --- | --- |
| 与另一语言对齐时间格式 | TS 的 `toISOString()` 总是毫秒 + `Z` |
| 枚举输出中文标签 | 契约要 `display` 而非 `value` |
| 脱敏 | 手机号 `138****1234` |
| 金额 | `Decimal` → 字符串（避免浮点误差） |

> 项目正是在这里保证 **Python 与 TS 两套后端返回的时间字符串逐字节一致**——契约测试才可能通过。

### 8.3 `computed_field`：派生字段

```python
from pydantic import BaseModel, computed_field


class LineItem(BaseModel):
    price: float
    qty: int

    @computed_field
    @property
    def total(self) -> float:
        return self.price * self.qty
```

| 特点 | 说明 |
| --- | --- |
| 自动进 `model_dump()` | 无需手动拼 |
| 只读 | 不能赋值 |
| 进 OpenAPI | `/docs` 会显示 |

> 适合「由其他字段算出来、但对外要展示」的值（总价、全名、URL）。

---

## 9. `TypeAdapter`：不建模型也能校验

```python
from pydantic import TypeAdapter

IntList = TypeAdapter(list[int])

IntList.validate_python(["1", 2, 3])        # [1, 2, 3]
IntList.validate_json('["1", 2]')           # [1, 2]
IntList.json_schema()                       # 给 OpenAPI 用
```

| 场景 | 用法 |
| --- | --- |
| 校验 `list[Model]`、`dict[str, int]` | `TypeAdapter(...)` |
| 校验函数返回值 | `TypeAdapter(ReturnType).validate_python(fn())` |
| 不想为一次性结构建模型 | ✅ |

---

## 10. 与 FastAPI 的接缝

| FastAPI 行为 | 背后用的 Pydantic 能力 |
| --- | --- |
| 请求体校验 → 422 | `Model.model_validate(body)` |
| 响应过滤 | `response_model` 再校验一遍 |
| `/docs` 请求示例 | `model_json_schema()` |
| `Field(description=...)` 出现在文档 | schema 的 `description` |
| `extra="forbid"` 拒绝多余字段 | `ConfigDict` |
| `field_serializer` 影响响应 | 序列化阶段 |

> 一句话：**FastAPI 把 Pydantic 的 schema 与校验搬到了 HTTP 边界**，你在模型里写的东西会同时在三个地方生效：运行时校验、文档、响应过滤。

---

## 11. 项目实战：三个模型的分工

### 11.1 真实代码（`apps/api-py/app/api/apps.py`）

```python
class AppResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str | None
    mode: str
    ownerId: str
    createdAt: datetime
    updatedAt: datetime

    @field_serializer("createdAt", "updatedAt")
    def _serialize_timestamps(self, value: datetime) -> str:
        return iso_z(value)


class CreateAppRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=256)
    mode: AppMode | None = None


class UpdateAppRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=256)
    mode: AppMode | None = None
```

### 11.2 设计要点

| 设计 | 为什么 |
| --- | --- |
| 三个模型而非一个 | 创建必填、更新全可选、响应只读——**职责不同** |
| `AppResponse` 无 `owner_id` | 不泄露内部字段；对外是 `ownerId` |
| `extra="forbid"` 全部模型 | 契约严格，拼错字段立刻 422 |
| `description: str \| None = None` | 允许显式传 `null` 清空；不传则不改 |
| `mode: AppMode \| None` | `Literal` 限定两个值，非法值 422 |
| `field_serializer` | 时间格式与 TS 端逐字节一致 |

### 11.3 `UpdateAppRequest` 与 `exclude_unset` 的配合

```python
for field, value in body.model_dump(exclude_unset=True).items():
    setattr(app, field, value)
```

三种请求的差异：

| 请求体 | `exclude_unset` 后 | 效果 |
| --- | --- | --- |
| `{"name": "新名"}` | `{"name": "新名"}` | 只改名 |
| `{"description": null}` | `{"description": None}` | **显式清空**描述 |
| `{}` | `{}` | 什么都不改 |

> 这就是「PATCH 的三态语义」：**传值 = 改，传 null = 清空，不传 = 不动**。
> 若模型不写 `= None`，`{"description": null}` 与「不传」就无法区分——这也是 §4.2 那条规则的实际价值。

### 11.4 跑一遍验证

```powershell
uv run python -c "from app.api.apps import CreateAppRequest as M; M(name='x', hack=1)"
```

预期：

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for CreateAppRequest
hack
  Extra inputs are not permitted [type=extra_forbidden, input_value=1, ...]
```

再试：

```powershell
uv run python -c "from app.api.apps import CreateAppRequest as M; print(M(name=''))"
```

预期：

```
name
  String should have at least 1 character [type=string_too_short, ...]
```

> 不用起服务就能验证模型——**模型是纯 Python，可直接单测**（阶段 9 会写这类测试）。

---

## 12. 与 TypeScript 对照

| Pydantic v2 | zod | 说明 |
| --- | --- | --- |
| `BaseModel` | `z.object({...})` | 模型 |
| `Field(min_length=1)` | `.min(1)` | 约束 |
| `extra="forbid"` | 默认行为（`z.object` 会剥掉未知键，`.strict()` 报错） | ⚠️ 默认不同 |
| `field_validator` | `.refine()` / `.transform()` | 单字段 |
| `model_validator(mode="after")` | `.superRefine()` / `.refine` on object | 跨字段 |
| `model_validate` | `.parse()` | 解析 + 校验 |
| `model_dump(mode="json")` | `JSON.parse` 前的 plain object | 序列化 |
| `field_serializer` | `.transform()` 输出 | 定制格式 |
| `model_json_schema()` | `zod-to-json-schema` | 生成 OpenAPI |
| `TypeAdapter` | `z.array(z.number())` | 非对象校验 |
| `ValidationError.errors()` | `error.issues` | 结构近似 |

> 关键差异：**zod 默认丢弃未知键，Pydantic 默认忽略（`ignore`）**，两者都不会报错；要严格都必须显式开（`extra="forbid"` / `.strict()`）。双栈项目应在契约层统一这个行为。

---

## 13. 验收自测

### 13.1 预测结果

```python
class M(BaseModel):
    a: int
    b: str | None

M(a="1", b=None)          # ①
M(a=1)                    # ②
```

<details>
<summary>答案</summary>

① ✅ 成功，`a` 宽松转成 `1`。
② ❌ `ValidationError`：`b` 是必填（`str | None` 只是允许 `None`，没有默认值）。

</details>

### 13.2 找错

```python
class Range(BaseModel):
    start: int
    end: int

    @model_validator(mode="after")
    def check(self):
        if self.start >= self.end:
            raise ValueError("start 必须小于 end")
```

问题：**忘了 `return self`** → 校验通过的模型会变成 `None`，后续访问字段报 `AttributeError`。

### 13.3 动手题

定义 `Chunk` 模型：`id` 非空、`content` 至少 1 字符、`score` 在 0~1、`tags` 默认空列表；再加一个 `score` 为 0 时 `content` 不允许为空的跨字段规则。

<details>
<summary>参考</summary>

```python
class Chunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    content: str = Field(min_length=1)
    score: float = Field(ge=0, le=1)
    tags: list[str] = Field(default_factory=list)

    @field_validator("id", "content")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def check(self):
        if self.score == 0 and not self.content.strip():
            raise ValueError("score 为 0 时 content 不能为空")
        return self
```

</details>

---

## 14. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 「传了字段却说 required」 | `X \| None` 没给默认值 | 加 `= None` |
| 拼接字段拼错但没报错 | `extra="ignore"`（默认） | 契约模型用 `forbid` |
| 字段改名后前端 422 | 用了 `alias` 但没写 `serialization_alias`/注释 | 明确三类别名 |
| `alias` 生效后字段名构造失败 | 未开 `populate_by_name` | 加 `ConfigDict(populate_by_name=True)` |
| 校验器不执行 | 忘了 `@classmethod` 或没写 `@field_validator` | 检查装饰器顺序 |
| 校验通过的模型变 `None` | `model_validator` 没 `return self` | 补 return |
| `before` 里报 `AttributeError` | 输入还不是目标类型 | 先判断类型再处理 |
| `json.dumps(model.model_dump())` 报错 | 含 `datetime`/`UUID` | `mode="json"` |
| 响应时间格式与 TS 不一致 | 未定制序列化 | `field_serializer` + `iso_z` |
| PATCH 把没传的字段清空 | 未用 `exclude_unset` | `model_dump(exclude_unset=True)` |
| 想清空字段却清不掉 | 误用 `exclude_none` | 用 `exclude_unset` |
| `default=[]` 报错/共享 | 可变默认 | `Field(default_factory=list)` |
| `pattern` 匹配了子串 | 正则未锚定 | 写 `^...$` |
| 嵌套错误定位不清 | 没看 `loc` 元组 | 按 `loc` 逐层展示 |
| `422` 日志泄露用户输入 | `errors()` 含 `input` | 记录前脱敏 |
| v1 写法 `class Config` | v2 已改 | 用 `model_config = ConfigDict(...)` |

---

## 15. 本篇小结

- **Pydantic v2 是 FastAPI 的「数据边界」**：请求校验、响应过滤、OpenAPI 三处同时生效。
- **默认宽松模式会做类型转换**（`"1"` → `1`、`"true"` → `True`）；要防隐式转换用 `strict=True` 或 `Strict*`。
- **`X | None` 不等于「可以不传」**；必须 `= None` 才是可选。
- **`Field` 承担约束 + 文档**；可变默认必须 `default_factory`。
- **`model_config` 七个常用开关**；契约模型一律 `extra="forbid"`（静默丢弃字段是最贵的 bug）。
- **校验器分工**：`before` 做预处理、`after` 做业务规则、`model_validator` 做跨字段（**必须 `return self`**）。
- **`Annotated[T, AfterValidator(...)]`** 把校验做成可复用类型。
- **`model_dump(mode="json")`** 才能安全 `json.dumps`；`exclude_unset` 是 PATCH 的核心语义。
- **`field_serializer`** 保证跨语言时间/枚举/金额格式一致；`computed_field` 输出派生值。
- **`TypeAdapter`** 校验非模型数据（`list[int]`、`dict[str, Model]`）。
- **`ValidationError.errors()`** 的 `loc` 是嵌套定位的关键；`input` 含用户数据，日志要脱敏。
- **v1 → v2**：`validator` → `field_validator`、`parse_obj` → `model_validate`、`dict()` → `model_dump()`、`class Config` → `model_config`。
- **项目范式**：`Create*` / `Update*` / `*Response` 三分、全部 `extra="forbid"`、`field_serializer` 对齐 TS、`exclude_unset` 实现 PATCH 三态。
- **下一步**：依赖注入 `Depends`——把「取当前用户」「拿会话」变成可组合的声明。
