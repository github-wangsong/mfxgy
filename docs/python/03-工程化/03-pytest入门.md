# 03 · pytest 入门

> 所属：阶段 3 · 工程化
> 本篇覆盖：pytest 与 `unittest` 的差别、测试发现规则、裸 `assert` 与断言重写（assertion rewriting）、运行命令与筛选（`-k`/`-x`/`--lf`/`-s`）、`fixture` 依赖注入与 `yield` 清理、`scope` 四级、`conftest.py` 与 `autouse`、`parametrize` 参数化与 `pytest.param`、异常测试 `pytest.raises(match=)`、`approx` 浮点比较、`tmp_path`、`monkeypatch`（改配置/环境变量/替换函数）、`unittest.mock` 与 `mocker` 的关系、覆盖率 `pytest-cov`、异步测试两条路线
> **本篇首次教学：`fixture` 作为「按需注入的 setup/teardown」（`yield` 之后是清理、`scope` 决定生命周期、`conftest.py` 自动发现）、`autouse` 全局 fixture、`parametrize` 的「一次编写 N 组数据」与 id 命名、`pytest.raises(..., match=...)`、`pytest.approx`、`tmp_path`/`monkeypatch` 内建 fixture、`monkeypatch.setattr` 修改模块级对象（含 `settings` 单例）、覆盖率统计、`pytest-asyncio` 的 `asyncio_mode` 与 `@pytest.mark.asyncio`**
> 预告：下一篇讲静态检查与格式化（`ruff`、`mypy`、pre-commit）。

> 项目锚点：`apps/api-py/app/security.py`（4 个纯函数：`hash_password`/`verify_password`/`create_access_token`/`decode_access_token`——最适合作为第一个被测对象）；`apps/api-py/pyproject.toml` 的 `dev` 组里只有 `pytest` 与 `ruff`，本篇会说明还缺什么。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 写出第一个 `test_*.py` 并让 `uv run pytest` 跑起来。
2. 用 `fixture` + `yield` 管理测试前置与清理，并选对 `scope`。
3. 用 `parametrize` 把同一逻辑的多组数据合并成一个测试。
4. 用 `monkeypatch` 修改配置、环境变量、替换外部调用。
5. 给 `security.py` 写出 8 个有意义的测试。
6. 跑出覆盖率报告并解释哪些行没被覆盖。

**验收标准**

- 能解释 `assert x == 1` 为什么在没有 `--assert=plain` 时能打印出 `x` 的实际值。
- 能说出 `scope="session"` 的 fixture 在多少个测试间共享。
- 能测出「令牌过期」这一分支（提示：需要改时间或改有效期）。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [03-工程化/01 pyproject 与依赖管理](./01-pyproject与依赖管理.md)（`dev` 组、`uv run`）、[03-工程化/02 配置与日志](./02-配置与日志.md)（`settings` 单例，改配置要小心） |
| 已掌握 | 函数、异常、`with`、模块导入 |

---

## 3. 为什么用 pytest

### 3.1 与 `unittest` 对比

```python
# unittest
import unittest


class TestMath(unittest.TestCase):
    def test_add(self):
        self.assertEqual(1 + 1, 2)
```

```python
# pytest
def test_add():
    assert 1 + 1 == 2
```

| 维度 | `unittest` | `pytest` |
| --- | --- | --- |
| 断言 | `self.assertEqual` 等一堆方法 | 原生 `assert` |
| 类要求 | 必须继承 `TestCase` | 普通函数即可 |
| 前置/清理 | `setUp`/`tearDown`（固定顺序） | `fixture`（按需注入） |
| 参数化 | 需 `subTest` | 内置 `parametrize` |
| 失败输出 | 相对简略 | 断言重写，显示变量实际值 |
| 生态 | 标准库 | `pytest-cov`/`pytest-asyncio`/`pytest-mock` 等事实标准 |
| 运行 | `python -m unittest` | `pytest` |

> 结论：**新项目一律 pytest**；遇到老 `unittest` 代码，pytest 也能直接跑（兼容）。

### 3.2 测试发现的四条规则

| 规则 | 说明 |
| --- | --- |
| 文件 | `test_*.py` 或 `*_test.py` |
| 函数 | `test_` 开头 |
| 类 | `Test` 开头（**且不能有 `__init__`**） |
| 方法 | 类里的 `test_` 开头 |

```text
apps/api-py/
├── app/
│   └── security.py
└── tests/
    ├── conftest.py          ← 共享 fixture（不叫 test_）
    ├── test_security.py     ← ✅ 会被发现
    └── helpers.py           ← ❌ 不会被当成测试
```

> 类不能有 `__init__` 是常见踩坑点：写了 `__init__` 整个类会被跳过，且**不报错**。

---

## 4. 第一个测试

### 4.1 目录与运行

```powershell
cd apps\api-py
uv run pytest -q
```

若还没装 pytest：

```powershell
uv add --dev pytest
```

### 4.2 最小测试

```python
# tests/test_smoke.py
def test_smoke():
    assert 1 + 1 == 2
```

输出：

```
.
1 passed in 0.02s
```

| 符号 | 含义 |
| --- | --- |
| `.` | 通过 |
| `F` | 失败（断言不成立） |
| `E` | 出错（异常非断言） |
| `s` | 跳过（skip） |
| `x` | xfail（预期失败） |

### 4.3 断言重写：为什么 `assert` 够用

```python
def test_fail():
    result = {"users": [1, 2]}
    assert result["users"] == [1, 2, 3]
```

失败输出（关键部分）：

```
E       assert [1, 2] == [1, 2, 3]
E         At index 2 diff: 3
E         Right contains one more item: 3
```

pytest 在导入测试文件时**重写了 `assert` 语句的字节码**，所以能展示「左值实际是什么」。这是它相对 `unittest` 的最大体验提升。

> 代价：重写只在测试文件里生效；生产代码里的 `assert` 仍是普通断言（且 `-O` 会移除，见 [00-Python基础/05](../00-Python基础/05-异常与文件IO.md) §8）。

### 4.4 常用运行命令

| 命令 | 作用 |
| --- | --- |
| `pytest -q` | 简洁输出 |
| `pytest -v` | 每个用例一行 |
| `pytest -x` | 首个失败立即停止 |
| `pytest --maxfail=3` | 失败 3 个停止 |
| `pytest -k "token and not expired"` | 按名字筛选（支持 `and`/`or`/`not`） |
| `pytest tests/test_security.py::test_hash` | 跑单个用例 |
| `pytest -s` | 不捕获输出（看 `print`） |
| `pytest --lf` | 只跑上次失败的 |
| `pytest --ff` | 先跑上次失败的 |
| `pytest -p no:cacheprovider` | 禁用缓存 |
| `pytest --durations=10` | 显示最慢的 10 个 |

> `-s` 是调试利器：默认 pytest **捕获 stdout**，所以 `print` 看不到；加 `-s` 才能看到。

---

## 5. `fixture`：pytest 的核心

### 5.1 问题：重复的前置代码

```python
def test_one():
    user = create_user()          # 重复
    ...
    cleanup(user)                 # 忘了清理


def test_two():
    user = create_user()          # 重复
    ...
```

`setUp`/`tearDown` 能解决，但它是「所有测试都执行」，不灵活。

### 5.2 `fixture`：按需注入

```python
import pytest


@pytest.fixture
def user():
    u = {"id": "u1", "role": "admin"}      # setup
    yield u                                # ← 交给测试用
    # teardown：yield 之后执行
    print("清理 user")


def test_role(user):                       # ← 参数名 = fixture 名
    assert user["role"] == "admin"
```

执行时序：

```
1. pytest 发现 test_role 需要 fixture `user`
2. 调用 user()，执行到 yield，把值交给测试
3. 测试体执行
4. 测试结束，回到 yield 之后执行清理
```

| 关键点 | 说明 |
| --- | --- |
| 参数名 = fixture 名 | 靠名字匹配，不靠类型 |
| `yield` 前是 setup，后是 teardown | 即使测试失败，teardown 也会执行 |
| 不用 `yield` 则没有 teardown | 适合无状态对象 |
| fixture 可以依赖 fixture | 组成依赖图 |

### 5.3 `scope`：生命周期

| `scope` | 创建时机 | 典型用途 |
| --- | --- | --- |
| `function`（默认） | 每个测试函数一次 | 大多数场景 |
| `class` | 每个测试类一次 | 类内共享 |
| `module` | 每个测试文件一次 | 加载一次大文件 |
| `session` | 整个 pytest 运行一次 | 启动容器、建引擎、加载模型 |

```python
@pytest.fixture(scope="session")
def db_engine():
    engine = create_engine(settings.database_url)
    yield engine
    engine.dispose()
```

> **原则**：`scope` 越大会越快，但**状态污染风险也越大**。测试之间应该互相独立。

### 5.4 `conftest.py`：自动发现的共享 fixture

```text
tests/
├── conftest.py        ← 这里的 fixture 对本目录及子目录全部可见
├── test_a.py
└── api/
    ├── conftest.py    ← 只对 tests/api/ 可见（可覆盖上层）
    └── test_b.py
```

| 特点 | 说明 |
| --- | --- |
| 不需要导入 | pytest 自动加载 |
| 可分层 | 子目录的 `conftest.py` 可覆盖同名 fixture |
| 不该放测试 | 里面没有 `test_` 函数也行 |

```python
# tests/conftest.py
import pytest

from app.config import settings


@pytest.fixture(scope="session")
def jwt_secret() -> str:
    return settings.jwt_secret
```

### 5.5 `autouse`：自动生效

```python
@pytest.fixture(autouse=True)
def isolate_settings(monkeypatch):
    monkeypatch.setattr(settings, "access_token_expires_in", 3600)
    yield
```

| 用途 | 风险 |
| --- | --- |
| 全局重置配置、清缓存、固定时间 | 隐式魔法，难排查 |

> 建议：**只在 `conftest.py` 里用 `autouse`，且只做「重置」不做「造数据」**。

### 5.6 fixture 的返回值 vs 工厂

```python
@pytest.fixture
def make_user():
    created = []

    def _make(role: str = "user"):
        u = {"id": f"u{len(created)}", "role": role}
        created.append(u)
        return u

    yield _make

    for u in created:
        pass          # 批量清理
```

用法：

```python
def test_admin(make_user):
    admin = make_user("admin")
    assert admin["role"] == "admin"
```

> 当测试需要**不同参数**的同类对象时，用「工厂 fixture」比「每个变体一个 fixture」更灵活。

---

## 6. `parametrize`：一次编写，多组数据

### 6.1 基础用法

```python
import pytest


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        (1, 1, 2),
        (2, 3, 5),
        (-1, 1, 0),
        (0, 0, 0),
    ],
)
def test_add(a, b, expected):
    assert a + b == expected
```

输出会展开成 4 个用例：

```
test_math.py::test_add[1-1-2] PASSED
test_math.py::test_add[2-3-5] PASSED
test_math.py::test_add[-1-1-0] PASSED
test_math.py::test_add[0-0-0] PASSED
```

### 6.2 自定义 id

```python
@pytest.mark.parametrize(
    ("raw", "valid"),
    [
        pytest.param("a@b.com", True, id="正常邮箱"),
        pytest.param("a@b", False, id="缺顶级域"),
        pytest.param("", False, id="空串"),
    ],
)
def test_email(raw, valid):
    assert is_email(raw) is valid
```

> 好处：失败时报告显示 `test_email[缺顶级域]`，一眼看出是哪组数据。

### 6.3 多参数叠加（笛卡尔积）

```python
@pytest.mark.parametrize("role", ["admin", "user"])
@pytest.mark.parametrize("active", [True, False])
def test_permission(role, active):
    ...
```

= 4 个用例（2 × 2）。

### 6.4 用 `marks` 标记某组数据

```python
@pytest.mark.parametrize(
    "url",
    [
        "http://ok",
        pytest.param("http://slow", marks=pytest.mark.slow),
    ],
)
def test_fetch(url):
    ...
```

```powershell
uv run pytest -m "not slow"
```

---

## 7. 异常、近似、跳过

### 7.1 `pytest.raises`

```python
import pytest


def test_wrong_password(security):
    with pytest.raises(ValueError, match="无效"):
        raise ValueError("无效的密码")
```

| 用法 | 说明 |
| --- | --- |
| `pytest.raises(SpecificError)` | 只捕指定异常 |
| `match="正则"` | 断言消息（**正则**，不是子串） |
| `excinfo.value` | 取异常对象 |
| 无异常抛出 | 测试失败（正确行为） |

```python
with pytest.raises(KeyError) as excinfo:
    {}["missing"]
assert excinfo.value.args[0] == "missing"
```

> `match` 用的是 `re.search`，所以 `.`、`(` 等要转义。

### 7.2 `pytest.approx`：浮点比较

```python
def test_float():
    assert 0.1 + 0.2 == pytest.approx(0.3)          # ✅
    # assert 0.1 + 0.2 == 0.3                        # ❌
```

| 参数 | 含义 |
| --- | --- |
| 默认 | 相对误差 `1e-6` |
| `abs=1e-9` | 绝对误差 |
| `rel=1e-3` | 相对误差 |

> 见 [00-Python基础/02](../00-Python基础/02-语法最小集与数据类型.md) §5 的 `0.1 + 0.2` 问题。

### 7.3 跳过与预期失败

```python
import sys
import pytest


@pytest.mark.skip(reason="未实现")
def test_todo():
    ...


@pytest.mark.skipif(sys.platform == "win32", reason="仅 Linux")
def test_uvloop():
    ...


@pytest.mark.xfail(reason="已知 bug #123")
def test_broken():
    assert 1 == 2
```

| 标记 | 行为 |
| --- | --- |
| `skip` | 跳过（不计失败） |
| `skipif` | 条件跳过 |
| `xfail` | 预期失败：失败算通过，意外通过算 `XPASS` |
| `strict=True` | xfail 却通过 → 失败（推荐） |

---

## 8. 内建 fixture：`tmp_path` 与 `monkeypatch`

### 8.1 `tmp_path`：真实文件系统

```python
import json


def test_write_config(tmp_path):
    path = tmp_path / "config.json"           # 每个测试一个独立目录
    path.write_text(json.dumps({"a": 1}), encoding="utf-8")

    assert json.loads(path.read_text(encoding="utf-8"))["a"] == 1
```

| 优点 | 说明 |
| --- | --- |
| 自动清理 | 测试结束删除 |
| 唯一目录 | 并发安全，不会互相覆盖 |
| 真文件 | 能测编码、路径、权限 |

> 对比 `tempfile.mkdtemp()`：手写要自己清理，忘删就是垃圾堆积。

### 8.2 `monkeypatch`：临时改动，自动还原

#### ① 改环境变量

```python
def test_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
```

#### ② 改模块级对象（含 `settings` 单例）

```python
def test_expires(monkeypatch):
    monkeypatch.setattr("app.config.settings.access_token_expires_in", -1)
    # 测试结束自动还原
```

> `settings` 是模块级单例（[02 篇](./02-配置与日志.md) §4.2），直接赋值会**污染后续所有测试**；`monkeypatch.setattr` 保证自动还原。

#### ③ 替换函数

```python
def test_embedding_without_network(monkeypatch):
    async def fake_embed(text: str) -> list[float]:
        return [0.0] * 1536

    monkeypatch.setattr("app.rag.embedding.embed_text", fake_embed)
```

| 改写方式 | 说明 |
| --- | --- |
| `monkeypatch.setattr("模块路径.属性", 值)` | **字符串路径**，必须指到「被使用处」的那个模块 |
| `monkeypatch.setattr(obj, "attr", 值)` | 直接传对象 |
| `monkeypatch.setitem(dict, key, 值)` | 改字典项 |
| `monkeypatch.chdir(path)` | 切工作目录 |
| `monkeypatch.undo()` | 手动提前还原 |

### 8.3 最容易踩的坑：patch 错了地方

```python
# app/rag/service.py
from app.rag.embedding import embed_text       # ← 直接导入


async def ingest(text):
    return await embed_text(text)              # ← 用的是 service 模块里的名字
```

```python
monkeypatch.setattr("app.rag.embedding.embed_text", fake)    # ❌ 无效
monkeypatch.setattr("app.rag.service.embed_text", fake)      # ✅ 正确
```

原因：`from x import y` 把引用复制到了当前模块。**要 patch「使用它的模块」，而不是「定义它的模块」。**

---

## 9. mock：`unittest.mock` 与 `mocker`

### 9.1 标准库 `unittest.mock`

```python
from unittest.mock import AsyncMock, MagicMock, patch


def test_calls_llm():
    with patch("app.engine.nodes.llm.chat_completion") as mock_fn:
        mock_fn.return_value = "hello"
        result = run_node()
        assert result == "hello"
        mock_fn.assert_called_once()
```

| 对象 | 用途 |
| --- | --- |
| `MagicMock()` | 同步替身（任意属性/调用都能用） |
| `AsyncMock()` | 异步替身（可 `await`） |
| `patch(...)` | 上下文管理器或装饰器，自动还原 |
| `assert_called_once_with(...)` | 断言调用参数 |

### 9.2 `pytest-mock` 的 `mocker`

```python
def test_calls_llm(mocker):
    spy = mocker.patch("app.engine.nodes.llm.chat_completion", new_callable=AsyncMock)
    spy.return_value = "hello"
```

| 优点 | 说明 |
| --- | --- |
| 自动还原 | 不需要 `with` |
| 统一入口 | `mocker.patch`/`mocker.spy` |
| 与 `monkeypatch` 风格一致 | 都不用写 `with` |

> 需额外安装：`uv add --dev pytest-mock`。项目 `dev` 组目前没有，属于建议补充项。

### 9.3 何时不该 mock

| 情况 | 建议 |
| --- | --- |
| 纯函数（如 `security.py`） | **直接真跑**，不要 mock |
| 自己的 DB 层 | 用事务/临时 schema 真跑，比 mock 可靠 |
| 外部 HTTP / LLM / 邮件 | ✅ mock |
| 时间 | `monkeypatch` 或 `freezegun` |

> 经验：**mock 越多，测试越不验证真实行为**。优先「真跑 + 隔离边界」。

---

## 10. 覆盖率

```powershell
uv add --dev pytest-cov
uv run pytest --cov=app --cov-report=term-missing
```

输出：

```
Name                      Stmts   Miss  Cover   Missing
-------------------------------------------------------
app/security.py              18      2    89%   27-28
app/config.py                12      0   100%
-------------------------------------------------------
TOTAL                       120     31    74%
```

| 参数 | 作用 |
| --- | --- |
| `--cov=app` | 只统计 `app/` 包 |
| `--cov-report=term-missing` | 显示未覆盖行号 |
| `--cov-report=html` | 生成 `htmlcov/index.html` |
| `--cov-fail-under=80` | 低于 80% 直接失败（CI 用） |

> 覆盖率是**发现盲区**的工具，不是 KPI。100% 覆盖仍可能测不出 bug（见 §13.4）。

---

## 11. 异步测试

### 11.1 两条路线

| 方案 | 配置 | 写法 |
| --- | --- | --- |
| `pytest-asyncio` | `asyncio_mode = "auto"`（推荐） | 直接 `async def test_...` |
| `anyio` | `anyio_mode` | `@pytest.mark.anyio` 或后端参数化 |

```toml
# pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

```python
import pytest


async def test_async_add():
    assert await add(1, 2) == 3
```

> `auto` 模式下**所有 `async def test_` 自动被处理**，不用逐个加 `@pytest.mark.asyncio`。

### 11.2 异步 fixture

```python
@pytest.fixture
async def client():
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

> FastAPI 的完整测试在阶段 5（`TestClient`/`ASGITransport`），这里只需知道「异步 fixture 同样用 `yield`」。

### 11.3 缺 `pytest-asyncio` 时的报错

```
async def functions are not natively supported.
You need to install a suitable plugin for your async test framework...
```

> 这是最容易误判为「代码问题」的配置问题。

---

## 12. 项目实战：给 `security.py` 写测试

### 12.1 被测代码（真实文件）

`apps/api-py/app/security.py`：

| 函数 | 需要测的分支 |
| --- | --- |
| `hash_password` | 输出是 str、每次盐不同 |
| `verify_password` | 正确密码 True、错误密码 False、**非法哈希 → `ValueError` → False** |
| `create_access_token` | 返回 `(token, expires_in)`、token 可解码、载荷字段齐全 |
| `decode_access_token` | 密钥不符 → 抛异常、过期 → 抛异常 |

### 12.2 完整测试文件

```python
# tests/test_security.py
from datetime import datetime, timezone

import jwt
import pytest

from app import security
from app.config import settings


# ---------- 密码 ----------

def test_hash_password_returns_str():
    h = security.hash_password("s3cret")
    assert isinstance(h, str)
    assert h != "s3cret"                    # 不是明文


def test_hash_is_salted():
    a = security.hash_password("s3cret")
    b = security.hash_password("s3cret")
    assert a != b                           # 每次盐不同


def test_verify_password_ok():
    h = security.hash_password("s3cret")
    assert security.verify_password("s3cret", h) is True


def test_verify_password_wrong():
    h = security.hash_password("s3cret")
    assert security.verify_password("wrong", h) is False


def test_verify_password_invalid_hash():
    # bcrypt 遇到非法哈希会抛 ValueError，函数内部兜底为 False
    assert security.verify_password("s3cret", "not-a-bcrypt-hash") is False


# ---------- JWT ----------

def test_create_access_token_returns_pair():
    token, expires_in = security.create_access_token(user_id="u1", role="admin")
    assert isinstance(token, str)
    assert expires_in == settings.access_token_expires_in


def test_token_roundtrip():
    token, _ = security.create_access_token(user_id="u1", role="admin")
    payload = security.decode_access_token(token)

    assert payload["sub"] == "u1"
    assert payload["role"] == "admin"
    assert set(payload) == {"sub", "role", "iat", "exp"}


def test_token_wrong_secret():
    token, _ = security.create_access_token(user_id="u1", role="admin")
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, "another-secret", algorithms=["HS256"])


def test_token_expired(monkeypatch):
    # 有效期设为 -1 秒 → 签发即过期
    monkeypatch.setattr(settings, "access_token_expires_in", -1)
    token, _ = security.create_access_token(user_id="u1", role="user")

    with pytest.raises(jwt.ExpiredSignatureError):
        security.decode_access_token(token)


def test_token_exp_matches_now(monkeypatch):
    monkeypatch.setattr(settings, "access_token_expires_in", 60)
    token, _ = security.create_access_token(user_id="u1", role="user")
    payload = security.decode_access_token(token)

    now = int(datetime.now(timezone.utc).timestamp())
    assert payload["exp"] - payload["iat"] == 60
    assert abs(payload["iat"] - now) <= 2
```

### 12.3 逐个测试在教什么

| 测试 | 教学点 |
| --- | --- |
| `test_hash_password_returns_str` | 断类型 + 断「不是明文」 |
| `test_hash_is_salted` | 断言**两次结果不同**（很多新手写 `assert a == b`） |
| `test_verify_password_invalid_hash` | 覆盖 `try/except ValueError` 分支 |
| `test_token_roundtrip` | 用 `set(payload)` 断字段集合，防止多/少字段 |
| `test_token_wrong_secret` | 用 `pytest.raises(SpecificError)`，不用裸 `Exception` |
| `test_token_expired` | **`monkeypatch.setattr(settings, ...)` 改单例**，且自动还原 |
| `test_token_exp_matches_now` | 时间断言用 `abs(...) <= 2`，容忍执行延迟 |

### 12.4 运行

```powershell
uv run pytest tests/test_security.py -v
```

预期：

```
tests/test_security.py::test_hash_password_returns_str PASSED
tests/test_security.py::test_hash_is_salted PASSED
...
10 passed in 1.84s
```

> bcrypt 成本因子 10，每次哈希约数十毫秒——10 个测试近 2 秒是正常的。若要提速，把 `BCRYPT_ROUNDS` 在测试中 `monkeypatch` 到 4。

### 12.5 用参数化合并「非法输入」

```python
@pytest.mark.parametrize(
    ("password", "stored"),
    [
        pytest.param("abc", "not-a-hash", id="非法哈希"),
        pytest.param("", "", id="空哈希"),
        pytest.param("abc", "$2b$10$invalid", id="截断哈希"),
    ],
)
def test_verify_password_all_invalid(password, stored):
    assert security.verify_password(password, stored) is False
```

> 三个输入一个测试——这就是 `parametrize` 的核心价值。

### 12.6 建议补充的 dev 依赖

```toml
[dependency-groups]
dev = [
    "pytest>=8.3.0",
    "pytest-cov>=5.0.0",
    "pytest-asyncio>=0.24.0",
    "pytest-mock>=3.14.0",
    "ruff>=0.6.0",
]
```

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-q"
```

> 项目现状只有 `pytest` + `ruff`，跑同步测试够用；一旦要测异步接口与覆盖率，上面几项必须加。

---

## 13. 与 TypeScript 对照

| pytest | Vitest / Jest | 说明 |
| --- | --- | --- |
| `test_*.py` 发现规则 | `*.test.ts` / `*.spec.ts` | 都是约定 |
| `assert` | `expect(x).toBe(y)` | pytest 用原生断言 + 重写 |
| `fixture` | `beforeEach` / `beforeAll` | pytest 更灵活（按需注入 + 依赖图） |
| `conftest.py` | `setupFiles` | 自动加载 |
| `scope="session"` | `beforeAll`（文件级）/ `globalSetup` | 生命周期 |
| `parametrize` | `test.each([...])` | 一致 |
| `pytest.raises` | `expect(fn).toThrow()` | 一致 |
| `pytest.approx` | `toBeCloseTo` | 一致 |
| `tmp_path` | `os.tmpdir()` + 手清 | pytest 更省心 |
| `monkeypatch` | `vi.spyOn` / `jest.spyOn` | 都需自动还原 |
| `MagicMock` | `vi.fn()` | 一致 |
| `--cov` | `--coverage`（c8/istanbul） | 一致 |
| `pytest-asyncio` | 原生支持 | Node 无此问题 |

> 心智迁移：**fixture = 可注入、可组合、有生命周期的 `beforeEach`**。理解这一点，pytest 就通了 70%。

---

## 14. 验收自测

### 14.1 预测输出

```python
import pytest


@pytest.fixture(scope="module")
def counter():
    print("创建")
    return {"n": 0}


def test_a(counter):
    counter["n"] += 1


def test_b(counter):
    assert counter["n"] == 1
```

问：「创建」打印几次？`test_b` 通过吗？

<details>
<summary>答案</summary>

打印 **1 次**（`scope="module"`，同文件共享）。`test_b` **通过**，因为 `counter` 是同一个可变 dict。

⚠️ 这正是「`scope` 过大的状态污染风险」——测试之间产生了顺序依赖。

</details>

### 14.2 找错

```python
def test_login(monkeypatch):
    monkeypatch.setattr(settings.jwt_secret, "test", "xxx")     # ①
    ...
```

三处问题：

1. `settings.jwt_secret` 是 `str`，不能作为 `setattr` 的目标；
2. 应写 `monkeypatch.setattr(settings, "jwt_secret", "xxx")`；
3. 若代码在 import 时已把 `jwt_secret` 复制到别处，还要 patch 使用处。

### 14.3 动手题

给 `decode_access_token` 写一个「令牌被篡改」的测试。

<details>
<summary>参考</summary>

```python
def test_token_tampered():
    token, _ = security.create_access_token(user_id="u1", role="user")
    head, payload, sig = token.split(".")
    tampered = f"{head}.{payload}.{'A' * len(sig)}"

    with pytest.raises(jwt.InvalidSignatureError):
        security.decode_access_token(tampered)
```

</details>

---

## 15. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 一个测试都没被发现 | 文件名/函数名不符合 `test_*` | 检查发现规则 |
| 测试类被整体跳过 | 类里写了 `__init__` | 删掉 `__init__` |
| `print` 看不到 | pytest 捕获 stdout | `-s` |
| fixture 找不到 | 不在 `conftest.py` 或没导入 | 放 `conftest.py` |
| fixture 状态串到别的测试 | `scope` 过大 + 可变对象 | 改 `scope="function"` |
| `monkeypatch` 改完没生效 | patch 了定义处而非使用处 | patch `from ... import` 后的名字 |
| `monkeypatch` 后其他测试异常 | 用了直接赋值而非 `monkeypatch` | 一律用 `monkeypatch.setattr` |
| `pytest.raises` 没捕到 | 异常类型写太窄/太宽 | 用具体异常 |
| `match` 匹配失败 | 它是正则 | 转义特殊字符 |
| 浮点断言偶发失败 | 精度 | `pytest.approx` |
| 异步测试报「not natively supported」 | 缺 `pytest-asyncio` | 装插件 + `asyncio_mode="auto"` |
| 测试很慢 | bcrypt 成本高 / 真连 DB | 降成本因子、用事务隔离 |
| 测试顺序一变就失败 | 测试间共享状态 | 每个测试独立造数据 |
| 覆盖率 100% 仍有 bug | 只覆盖了执行路径，未覆盖断言 | 补边界与异常断言 |
| 测试连到开发数据库 | `settings` 默认值被用 | 测试用独立 DB / `monkeypatch` |
| `pytest` 命令找不到 | 没用 `uv run` | `uv run pytest` |

---

## 16. 本篇小结

- **pytest 用原生 `assert`**：断言重写会打印实际值，无需 `assertEqual` 家族。
- **发现规则**：`test_*.py` + `test_*` 函数；测试类不能有 `__init__`。
- **`fixture` 是核心**：按名字注入、`yield` 前 setup 后 teardown、可依赖其他 fixture。
- **`scope` 决定生命周期**：`function`（默认，最安全）→ `session`（最快，最易污染）。
- **`conftest.py`** 自动发现、可分层覆盖；`autouse` 只用于「重置」，不用于「造数据」。
- **`parametrize`** 把多组数据合成一个测试，配合 `pytest.param(id=...)` 让报告可读。
- **`pytest.raises(SpecificError, match=...)`**：异常类型要具体，`match` 是正则。
- **`tmp_path`** 给真实文件系统且自动清理；**`monkeypatch`** 改环境变量/模块对象/函数且自动还原。
- **patch 的位置**：`from x import y` 之后要 patch **使用处的名字**。
- **优先真跑，少 mock**：纯函数与本地 DB 层尽量真测，只在外部边界 mock。
- **覆盖率是找盲区的工具**，不是 KPI；`--cov-fail-under` 可用于 CI 卡线。
- **异步测试**需 `pytest-asyncio` + `asyncio_mode = "auto"`。
- **项目范式**：`security.py` 的 4 个纯函数最适合当第一个被测对象；`settings` 单例必须用 `monkeypatch.setattr` 改，否则污染全局。
- **下一步**：静态检查与格式化——`ruff`（lint + format）、`mypy`、pre-commit。
