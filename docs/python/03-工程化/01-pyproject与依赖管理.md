# 01 · pyproject 与依赖管理

> 所属：阶段 3 · 工程化
> 本篇覆盖：`requirements.txt` 的三个根本缺陷、`pyproject.toml` 作为唯一配置中心的定位、`[project]` 全字段、PEP 621 依赖声明语法（版本约束符、extras、环境标记）、锁文件（`uv.lock`）为什么必须提交、`[dependency-groups]`（PEP 735）与 `optional-dependencies` 的区别、`uv` 完整工作流、src 布局与可编辑安装、构建后端与 wheel/sdist、可复现构建的三条铁律
> **本篇首次教学：`pyproject.toml` 的 `[project]` / `[build-system]` / `[dependency-groups]` 分段职责、版本约束符（`==`/`>=`/`~=`/`!=`/`<`）的真实含义与「Python 没有 `^`」、extras（`uvicorn[standard]`）与 `optional-dependencies`、环境标记 `sys_platform == "win32"`、锁文件与「声明范围 vs 精确版本」的分工、`uv lock`/`uv sync --frozen`/`uv run` 的可复现链路、`dependency-groups` 与 `dev` 组的演进（PEP 735）、src layout 与 editable 安装、`hatchling`/`setuptools` 构建后端**（`venv` 创建、`uv add/sync` 基础命令在 `00-Python基础/01` 已讲，本篇讲工程化决策）
> 预告：下一篇讲配置与日志（`pydantic-settings`、`.env`、`logging` 结构化输出）。

> 项目锚点：`apps/api-py/pyproject.toml`（真实文件，15 个运行依赖 + 2 个开发依赖，无锁文件入库是本节要讨论的工程问题）。

---

## 1. 本篇目标

学完本篇，你应该能：

1. 说清 `requirements.txt` 与 `pyproject.toml` 的本质差别（「装什么」vs「依赖什么」）。
2. 读懂任意一个 `pyproject.toml` 的 `[project]`、`[build-system]`、`[dependency-groups]`。
3. 正确使用 `>=`/`~=`/`==`，并解释为什么不能用 Node 的 `^` 思维写 Python 依赖。
4. 说清「锁文件 + 声明范围」如何共同保证可复现。
5. 在「应用」与「库」两种场景下选择不同的版本策略。
6. 用 `uv sync --frozen` 在 CI 里做可复现安装。

**验收标准**

- 能解释 `fastapi>=0.115.0` 与 `fastapi==0.115.0` 的风险差异。
- 能说明为什么 `uv.lock` 必须提交、`requirements.txt` 不必（或反之）。
- 能写出「Windows 才装某依赖」的声明。
- 能在新机器上 3 条命令复现完全相同的环境。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 前置篇 | [00-Python基础/01 环境与工具链](../00-Python基础/01-环境与工具链.md)（venv、`python -m pip`、`uv` 基础命令） |
| 已掌握 | 虚拟环境、模块与包、`__init__.py` |

---

## 3. 为什么放弃 `requirements.txt`

### 3.1 它其实只是「一份装包清单」

```text
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
sqlalchemy>=2.0.30
```

这份文件能表达的只有「装这些包」。它表达不了：

| 缺失项 | 后果 |
| --- | --- |
| 项目元信息（名字、版本、Python 版本要求） | 无法打包、无法声明最低 Python |
| 依赖分组（运行 vs 开发 vs 测试） | 生产镜像里混进 pytest |
| 环境标记（平台/架构） | Windows 也要装 Linux 专用包 |
| 传递依赖的精确版本 | 每次 `pip install` 都可能装到不同的子依赖 |
| 工具配置（ruff/pytest/mypy） | 需要 `setup.cfg` + `pytest.ini` + `.ruff.toml` 一堆文件 |

### 3.2 一个真实的漂移案例

```
第 1 天：pip install fastapi  → 装到 0.115.0
第 30 天：pip install fastapi → 装到 0.116.3（`>=` 允许）
```

传递依赖更麻烦：`fastapi` 依赖 `pydantic`，`pydantic` 又依赖 `pydantic-core`。**同一份 `requirements.txt` 在不同日期装出不同版本**，这就是「在我机器上能跑」的根源。

### 3.3 定位对照

| 文件 | 回答的问题 | 是否应提交 |
| --- | --- | --- |
| `requirements.txt` | 「装哪些包」 | 可选（若由锁文件导出则可提交） |
| `pyproject.toml` | 「这个项目是什么、依赖什么范围、用什么工具」 | **必须** |
| `uv.lock` / `poetry.lock` | 「上次验证通过的**精确**版本组合」 | **必须**（对应用） |

> 一句话：**`pyproject.toml` 声明「允许的范围」，锁文件记录「实际用的版本」。**

---

## 4. `[project]` 逐字段

完整文件路径：`apps/api-py/pyproject.toml`（真实内容，节选）

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
    "httpx>=0.28.1",
    "pgvector>=0.5.1",
    "python-multipart>=0.0.32",
    "langchain-text-splitters>=1.1.3",
]

[dependency-groups]
dev = [
    "pytest>=8.3.0",
    "ruff>=0.6.0",
]
```

### 4.1 关键字段表

| 字段 | 必填 | 作用 |
| --- | --- | --- |
| `name` | ✅ | 包名（发布/安装时用；要符合 PEP 508 命名） |
| `version` | ✅（应用可省） | 语义化版本；应用常写 `0.1.0` 不发布 |
| `description` | ❌ | 包描述，`pip show` 可见 |
| `requires-python` | ✅ 强烈建议 | 低于此版本安装会直接报错 |
| `dependencies` | ✅ | 运行期依赖（会被装进生产镜像） |
| `readme` / `license` / `authors` | ❌ | 发布用元信息 |
| `scripts` | ❌ | 命令行入口（`"mini-dify = app.main:cli"`） |
| `classifiers` | ❌ | PyPI 分类标签 |

### 4.2 `requires-python` 为什么重要

```toml
requires-python = ">=3.12"
```

三个作用：

| 作用 | 说明 |
| --- | --- |
| 安装期拦截 | 用 3.10 跑 `uv sync` 会直接报「requires Python >=3.12」 |
| 让解析器选版本 | `numpy` 等库会按 Python 版本选不同的 wheel |
| 明确团队约定 | 避免有人用 3.9 写出不兼容代码 |

> 与 `package.json` 的 `"engines": { "node": ">=20" }` 等价——但 Python 的检查更严格（解析阶段就失败）。

### 4.3 `version` 对应用意味着什么

内部应用（不发布到 PyPI）的 `version` 只是**自述**。它不会自动跟 git tag 同步，也不会影响依赖解析。

| 场景 | 建议 |
| --- | --- |
| 内部服务 | `version = "0.1.0"` 手写，或构建时用 `hatch-vcs` 从 git tag 生成 |
| 要发布的库 | 必须严格语义化版本 |

---

## 5. 依赖声明语法（PEP 508）

### 5.1 版本约束符

| 写法 | 含义 | 实际允许 | 适用 |
| --- | --- | --- | --- |
| `==1.2.3` | 精确等于 | 只有 1.2.3 | 锁文件、极保守 |
| `>=1.2.3` | 大于等于 | 1.2.3 及以上（含 2.0） | **最常用**（应用） |
| `~=1.2.3` | 兼容版（compatible release） | `>=1.2.3, <1.3.0` | 想要小版本更新 |
| `~=1.2` | 同上 | `>=1.2, <2.0` | — |
| `!=1.2.5` | 排除特定版本 | 除 1.2.5 外 | 规避已知 bug 版本 |
| `<2.0` | 上限 | 严格小于 2.0 | 防大版本破坏 |
| `>=1.2,<2.0` | 区间 | 组合 | 最明确 |
| `*` | 任意版本 | 全部 | 几乎不该用 |

**Python 没有 `^`**：

```toml
dependencies = ["requests^2.31"]     # ❌ 无效语法
dependencies = ["requests>=2.31,<3.0"]  # ✅ 等价于 npm 的 ^2.31
```

### 5.2 extras：可选依赖包

```toml
"uvicorn[standard]>=0.30.0"
"psycopg[binary]>=3.2.0"
```

| 写法 | 含义 |
| --- | --- |
| `uvicorn` | 只装核心（纯 Python 实现，慢） |
| `uvicorn[standard]` | 额外装 `uvloop`、`httptools`、`watchfiles` 等（性能与热重载） |
| `psycopg` | 纯 Python 驱动（需要本机有 libpq） |
| `psycopg[binary]` | 附带预编译二进制，免装 libpq（Windows 友好） |

> 对照 Node：extras ≈ `optionalDependencies`，但**由包的作者定义**，不是使用者自选。

### 5.3 环境标记（markers）

```toml
dependencies = [
    "uvloop>=0.19; sys_platform != 'win32'",
    "colorama>=0.4; sys_platform == 'win32'",
]
```

| 常用标记 | 含义 |
| --- | --- |
| `sys_platform == 'win32'` | 仅 Windows |
| `sys_platform == 'linux'` | 仅 Linux |
| `python_version < '3.12'` | 版本条件 |
| `platform_machine == 'arm64'` | 架构条件 |
| `extra == 'dev'` | 属于某 extra 时 |

> 这是 `requirements.txt` 时代最难表达的东西之一（只能拆成多个文件）。

### 5.4 直接引用其他来源

```toml
dependencies = [
    "mylib @ git+https://github.com/org/mylib.git@v1.2.0",
    "localpkg @ file:///d:/work/localpkg",
    "wheelpkg @ https://example.com/wheelpkg-1.0-py3-none-any.whl",
]
```

> 生产环境慎用 `git+`：构建需要网络与 git，且**不可复现性极强**（分支会移动）。要用就打 tag/commit。

---

## 6. 锁文件：可复现的核心

### 6.1 两层结构

```
pyproject.toml  →  「我希望 fastapi >= 0.115.0」（范围）
      ↓ uv lock（解析）
uv.lock         →  「实际装 fastapi 0.115.7 + pydantic 2.9.2 + ...」（精确，含哈希）
      ↓ uv sync
.venv/          →  与 lock 完全一致的已安装环境
```

### 6.2 为什么必须提交

| 场景 | 没有锁文件 | 有锁文件 |
| --- | --- | --- |
| 同事拉代码 | 装到当天的「最新满足范围」版本 | 装到**同一组**版本 |
| CI 构建 | 每次可能不同 → 随机失败 | 完全可复现 |
| 回滚 | 只能回滚代码，依赖仍漂移 | 代码 + 依赖一起回滚 |
| 排查 bug | 不知道线上到底是哪个版本 | `uv.lock` 就是答案 |

### 6.3 `uv sync` 与 `--frozen`

| 命令 | 行为 |
| --- | --- |
| `uv sync` | 若 `pyproject.toml` 与 `uv.lock` 不一致 → **自动重新解析并更新锁** |
| `uv sync --frozen` | **不更新锁**，只按现有 `uv.lock` 安装；不一致则报错 |
| `uv lock` | 只更新锁文件，不改环境 |
| `uv lock --check` | 只检查锁是否与声明一致（CI 用） |

> **CI 与生产必须用 `--frozen`**，本地开发用普通 `uv sync`。否则 CI 会偷偷改锁，可复现性归零。

### 6.4 锁文件要进 git，不要进 `.dockerignore`

```gitignore
.venv/
__pycache__/
*.pyc
# uv.lock  ← 不要写在这里
```

### 6.5 一个易被忽略的坑：锁文件与平台

`uv.lock` 是**跨平台**的（记录了所有平台的候选与标记），所以在 Windows 生成、在 Linux 使用是合法的。但若你在 Windows 上锁定的某个包在 Linux 没有对应 wheel，`uv sync` 会尝试源码构建——需要编译工具链。

> Docker 构建时常踩：`psycopg[binary]` 在 slim 镜像里 OK，`psycopg`（纯 Python）则需要 `libpq-dev`。

---

## 7. `[dependency-groups]` vs `optional-dependencies`

### 7.1 两套机制

```toml
# ① dependency groups（PEP 735，uv 支持）——开发期用，不进包元数据
[dependency-groups]
dev = ["pytest>=8.3.0", "ruff>=0.6.0"]
docs = ["mkdocs>=1.6"]

# ② optional-dependencies（extras）——发布用，会进包元数据
[project.optional-dependencies]
postgres = ["psycopg[binary]>=3.2.0"]
```

| 维度 | `[dependency-groups]` | `[project.optional-dependencies]` |
| --- | --- | --- |
| 标准 | PEP 735（新） | PEP 621（原有 extras） |
| 是否进包元数据 | ❌ | ✅（别人 `pip install pkg[postgres]` 可用） |
| 用途 | 开发/测试/文档 | 给使用者选装的功能扩展 |
| 安装方式 | `uv sync --group dev` | `uv sync --extra postgres` |
| 默认 | `dev` 组**默认安装** | 默认**不装** |

### 7.2 本项目的选择

```toml
[dependency-groups]
dev = ["pytest>=8.3.0", "ruff>=0.6.0"]
```

含义：`pytest` 与 `ruff` **只在开发时存在**，不会进生产镜像。部署时：

```bash
uv sync --no-dev --frozen
```

或（旧版兼容语法）：

```bash
uv sync --no-group dev --frozen
```

> 对照 Node：`devDependencies` 就是同一个概念，Python 到了 PEP 735 才把它标准化。

---

## 8. `uv` 完整工作流

### 8.1 命令表

| 命令 | 作用 | 类比 npm |
| --- | --- | --- |
| `uv init` | 初始化项目（生成 `pyproject.toml`） | `npm init` |
| `uv add fastapi` | 加依赖 + 更新 `pyproject.toml` + 锁 + 安装 | `npm install fastapi` |
| `uv add --dev pytest` | 加到 dev 组 | `npm i -D pytest` |
| `uv remove ruff` | 移除 | `npm uninstall` |
| `uv lock` | 重新解析锁 | `npm install`（更新 lock） |
| `uv sync` | 按锁同步环境 | `npm ci` 的宽松版 |
| `uv sync --frozen` | 严格按锁 | `npm ci` |
| `uv run python -m app` | 在项目环境里执行 | `npm run`（但无需先激活） |
| `uv pip list` | 列已安装 | `npm ls` |
| `uv python pin 3.12` | 固定项目 Python 版本（写 `.python-version`） | `.nvmrc` |
| `uv tree` | 依赖树 | `npm ls`（树形） |

### 8.2 `uv run` 解决了什么

传统流程：

```bash
.venv\Scripts\Activate.ps1        # 先激活（Windows 还有执行策略问题）
python -m app.main
```

`uv run`：

```bash
uv run python -m app.main          # 自动确保环境与锁一致，然后执行
```

好处：

| 好处 | 说明 |
| --- | --- |
| 无需激活 | 不依赖 shell 状态 |
| 自动同步 | 环境与锁不一致会先同步 |
| CI 友好 | 一行命令即可 |
| 可固定版本 | `uv run --python 3.12 ...` |

### 8.3 三条铁律

| 铁律 | 做法 |
| --- | --- |
| **锁要提交** | `uv.lock` 进 git |
| **CI 用 `--frozen`** | 不在 CI 里改锁 |
| **别手改锁文件** | 只通过 `uv lock`/`uv add` 变更 |

---

## 9. 项目布局与可编辑安装

### 9.1 两种布局

```text
# flat layout（简单脚本/应用）
api-py/
├── pyproject.toml
├── app/
│   ├── __init__.py
│   ├── main.py
│   └── api/
└── .venv/

# src layout（要打包/发布的库）
mylib/
├── pyproject.toml
├── src/
│   └── mylib/
│       ├── __init__.py
│       └── core.py
└── tests/
```

| 布局 | 优点 | 缺点 |
| --- | --- | --- |
| flat | 简单，`app` 直接在根目录 | 测试时可能误导入源码目录而非安装版；多了 `app` 这种通用名容易和别家撞 |
| src | 强制「先安装再导入」，测试更真实 | 多一层目录 |

> 本项目用 **flat layout**（`apps/api-py/app/`），因为它是一个**应用**，不发布。这是合理的取舍。

### 9.2 `[build-system]` 与可编辑安装

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

| 概念 | 说明 |
| --- | --- |
| 构建后端 | 负责把源码打成 `.whl`/`.tar.gz`（`hatchling`、`setuptools`、`poetry-core`、`flit`） |
| 可编辑安装 | `uv pip install -e .`：把「当前目录」以链接形式装进环境，改代码立即生效 |
| 为什么应用常省 `[build-system]` | 只 `uv sync` 装依赖、直接用 `uvicorn app.main:app` 运行，不需要「安装自己」 |

> 若 `uv sync` 报「package 需要 build-system」，说明它认为你要安装本包——加 `[build-system]` 或设 `[tool.uv] package = false`（应用常用）。

### 9.3 作为应用的正确配置

```toml
[tool.uv]
package = false          # 声明「这是应用，不是可安装包」，跳过构建
```

> 好处：`uv sync` 不会尝试构建本包，也不需要 `[build-system]`。很多应用模板漏了这行，导致莫名其妙的构建错误。

---

## 10. 版本策略：应用 vs 库

| 问题 | 应用（部署） | 库（被依赖） |
| --- | --- | --- |
| 依赖写法 | `>=` + 锁文件精确控制 | 宽松范围（`>=x,<y`），**绝不锁死** |
| 锁文件 | 必须提交 | 通常不提交（由使用者决定） |
| 上限约束 | 可选 | 建议给（防大版本破坏） |
| 升级节奏 | 定期 `uv lock --upgrade` | 跟随上游 |

> **库如果把 `==` 写进 `dependencies`，会害死所有使用者**（依赖地狱）。应用则相反：靠锁文件兜住一切。

### 10.1 定期升级的正确姿势

```bash
uv lock --upgrade                       # 全部升到允许范围内的最新
uv lock --upgrade-package fastapi       # 只升一个
uv sync
uv run pytest                           # 跑测试验证
git diff uv.lock                        # 审查 diff
```

> 把锁文件 diff 当作 PR 的一部分审查：**依赖变更 = 代码变更**。

---

## 11. 项目实战：读懂这份 `pyproject.toml`

### 11.1 依赖清单的读法（按层）

| 层 | 包 | 作用 |
| --- | --- | --- |
| Web 框架 | `fastapi`、`uvicorn[standard]` | 应用与服务器 |
| 配置与校验 | `pydantic`、`pydantic-settings`、`email-validator` | 模型与 `.env` |
| 数据层 | `sqlalchemy`、`psycopg[binary]`、`pgvector` | ORM + 驱动 + 向量类型 |
| 认证 | `pyjwt`、`bcrypt` | Token 与密码哈希 |
| 编排/LLM | `langgraph`、`langchain-openai`、`langchain-text-splitters` | 图引擎与 RAG |
| 网络 | `httpx` | 异步 HTTP |
| 上传 | `python-multipart` | 文件表单解析 |

### 11.2 可以从这份文件读出的设计决策

| 观察 | 推论 |
| --- | --- |
| 全部用 `>=`，无上限 | 处于快速迭代期，靠 `uv.lock` 兜底可复现性 |
| `psycopg[binary]` | 明确要「免编译」，优先开发体验（Windows 团队） |
| `uvicorn[standard]` | 要用 `uvloop`/`watchfiles`（注意 `uvloop` 在 Windows 不可用，extras 会自动跳过） |
| `pydantic >= 2.9` | 明确用 Pydantic v2（v1 到 v2 是破坏性升级，所以下限卡得较高） |
| 没有 `[build-system]` | 纯应用，不打包发布 |
| 没有 `[tool.ruff]` 段 | ruff 用默认规则（下一篇/04 会讲配置） |
| `dev` 组只有 `pytest` + `ruff` | 没有 `mypy`——说明类型检查靠 IDE 而非 CI |

### 11.3 一个改进建议（教学用）

```toml
[tool.uv]
package = false                # 明确「应用」定位，避免 sync 时尝试构建
```

```toml
[dependency-groups]
dev = ["pytest>=8.3.0", "ruff>=0.6.0", "mypy>=1.11"]
```

> 是否加要团队决定；本篇只示范「怎么看得懂、怎么改得对」。

### 11.4 首次环境复现（3 条命令）

```powershell
cd apps\api-py
uv sync --frozen          # 严格按锁安装（若已有 uv.lock）
uv run uvicorn app.main:app --reload
```

若无 `uv.lock`：

```powershell
uv lock                   # 生成锁（首次）
uv sync
```

> 注意 PowerShell 下要用 `uv.cmd`（若执行策略挡了 `.ps1`，见 [00-Python基础/01](../00-Python基础/01-环境与工具链.md) §5.5）。

---

## 12. 与 pnpm / `package.json` 对照

| Python | Node/pnpm | 说明 |
| --- | --- | --- |
| `pyproject.toml` | `package.json` | 项目清单 |
| `[project].dependencies` | `dependencies` | 运行依赖 |
| `[dependency-groups].dev` | `devDependencies` | 开发依赖 |
| `uv.lock` | `pnpm-lock.yaml` | 锁文件（都提交） |
| `uv sync --frozen` | `pnpm install --frozen-lockfile` | CI 严格安装 |
| `uv add` | `pnpm add` | 加依赖 |
| `uv run` | `pnpm exec` / `pnpm run` | 环境内执行 |
| `requires-python` | `engines.node` | 版本要求 |
| `uvicorn[standard]` | 无直接对应（可选依赖由库定义） | extras |
| 环境标记 | `os`/`cpu` 字段（如 `esbuild`） | 条件依赖 |
| `^2.31` | `>=2.31,<3.0` | **Python 无 `^`** |
| `.venv/` | `node_modules/` | 都不提交 |

> 心智迁移：**`uv.lock` ≈ `pnpm-lock.yaml`**，`uv sync --frozen` ≈ `pnpm install --frozen-lockfile`。掌握了 pnpm 就掌握了 uv 的核心工作流。

---

## 13. 验收自测

### 13.1 判读题

```toml
dependencies = ["httpx>=0.28,<1.0"]
```

问：会装到 `1.0.0` 吗？会装到 `0.28.0` 吗？

<details>
<summary>答案</summary>

不会装 `1.0.0`（`<1.0` 排除）。会装 `0.28.0` 或更高但 `<1.0` 的版本。等价于 npm 的 `^0.28`（在 0.x 语义下略有差异，见下）。

</details>

> 补充：Node 的 `^0.28` 允许 `0.28.x` 但不允许 `0.29`；Python 的 `>=0.28,<1.0` 允许 `0.29`。**0.x 版本的 caret 语义与 Python 区间不等价**，迁移时别想当然。

### 13.2 找错

```toml
[project]
name = "myapp"
dependencies = ["requests^2.31", "flask"]
```

三处问题：

1. `^2.31` 是 npm 语法，Python 不支持 → `>=2.31,<3.0`；
2. `flask` 无版本下限，可能装到不兼容版本 → 至少 `>=3.0`；
3. 缺 `requires-python`（且缺 `version`，虽应用可省）。

### 13.3 动手题

给项目加一个「仅 Linux 才装」的 `uvloop`，并让它不进生产镜像的 dev 组装 `pytest`。

<details>
<summary>参考</summary>

```toml
[project]
dependencies = [
    "uvloop>=0.19; sys_platform != 'win32'",
]

[dependency-groups]
dev = ["pytest>=8.3.0", "ruff>=0.6.0"]
```

部署：

```bash
uv sync --no-dev --frozen
```

</details>

---

## 14. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 「我机器能跑，CI 报错」 | 没提交锁文件 / CI 没用 `--frozen` | 提交 `uv.lock`，CI 加 `--frozen` |
| `uv sync` 悄悄改了锁 | 用了非 `--frozen` | CI 一律 `--frozen` |
| 生产镜像装了 pytest | 没用 `--no-dev` | 部署命令带 `--no-dev` |
| `psycopg` 在 slim 镜像装不上 | 纯 Python 版要 `libpq-dev` | 用 `psycopg[binary]` 或装系统依赖 |
| `uvloop` 在 Windows 报错 | 平台不支持 | 加 `sys_platform != 'win32'` 标记 |
| 写 `^2.31` 报解析错误 | Python 无 caret | `>=2.31,<3.0` |
| 库项目锁死 `==` | 把应用习惯带到库 | 库用范围，锁交给使用者 |
| `uv sync` 尝试构建本包失败 | 应用被当成包 | `[tool.uv] package = false` |
| 手改 `uv.lock` | 绕过解析器 | 只改 `pyproject.toml` 后 `uv lock` |
| `--reload` 频繁重启 | `watchfiles` 未装 | `uvicorn[standard]` 已含 |
| 依赖循环/版本冲突 | 无上限叠加 | `uv tree` 定位，必要时加 `<` 上限 |
| `.venv` 进了 git | `.gitignore` 漏了 | 加 `.venv/` |
| 用系统 Python 装包 | 忘了虚拟环境 | 一律 `uv run` 或激活 `.venv` |

---

## 15. 本篇小结

- **`requirements.txt` 只回答「装什么」**；`pyproject.toml` 回答「项目是什么、依赖什么范围、用什么工具」。
- **`[project]`** 管元信息与运行依赖；**`[build-system]`** 管打包；**`[dependency-groups]`** 管开发依赖（PEP 735）。
- **声明范围 + 锁文件**分工：`pyproject.toml` 写 `>=`，`uv.lock` 记精确版本与哈希。
- **`uv.lock` 必须提交**；**CI/生产必须 `uv sync --frozen`**，本地开发才允许自动更新锁。
- **Python 没有 `^`**；`^2.31` ≈ `>=2.31,<3.0`，但 0.x 版本语义与 Node 不同。
- **extras（`uvicorn[standard]`）** 是包作者定义的选装，环境标记（`sys_platform`）解决平台差异。
- **应用 vs 库的版本策略相反**：应用靠锁兜住，库给宽范围。
- **`uv run`** 免激活、自动同步，是 CI 与脚本的首选；`uv tree` 用来定位冲突。
- **应用用 `[tool.uv] package = false`** 跳过无意义的自包构建；flat layout 对应用合理。
- **升级依赖 = 代码变更**：`uv lock --upgrade` 后必须跑测试并审查 `uv.lock` diff。
- **项目范式**：`apps/api-py/pyproject.toml` 用 15 个 `>=` 依赖 + 2 个 dev 依赖，靠锁文件保证可复现；缺 `[build-system]` 与 `package = false` 是可选改进点。
- **下一步**：配置与日志——`pydantic-settings`、`.env` 优先级、`logging` 结构化输出。
