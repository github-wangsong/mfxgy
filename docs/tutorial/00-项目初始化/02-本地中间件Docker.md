# 02 · 本地中间件（Docker 只跑 PostgreSQL + pgvector）

> 所属：阶段 0 · 项目初始化
> 本篇覆盖：`docker-compose.yml`、`.env.example`、`.env`，以及用 Docker 起数据库的完整流程
> **本篇首次教学：Docker 基础（镜像 / 容器 / 卷 / 端口映射 / healthcheck）、Docker Compose（声明式多容器编排）**（后续笔记只引用，不再重讲）

> 下文所有「完整文件路径」均**相对仓库根** `d:\user\my_project\github\mini-dify`。

---

## 1. 本篇目标

- 只用 Docker 跑**一个**中间件：PostgreSQL + pgvector。
- 三个应用（`api-ts` / `api-py` / `web`）**全部保持本地运行**，不进容器。
- 理解 Docker 的几个核心概念，能看懂这份 Compose 文件的每一行。
- 会用 `psql` 进容器自证「数据库 + 向量扩展都真的可用了」。

**验收标准**：

1. `docker compose ps` 显示 `mini-dify-db` 状态为 **`healthy`**。
2. 容器内 `select version();` 输出以 **`PostgreSQL 16.15`** 开头。
3. `create extension if not exists vector;` 执行成功。
4. 查 `pg_extension` 得到 **`vector 0.8.7`**。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 阶段 0 第一步 | `01-环境准备.md` 已完成（Node / pnpm / uv / Python 就绪） |
| Docker Desktop | 已安装（**含** `docker` CLI 与 `docker compose` 插件），且**能被启动** |
| 网络 | 首次 `up` 需要拉镜像，要能访问镜像仓库 |
| 端口 | 本机 **5432** 没有被别的 PostgreSQL 占用 |

> 本机实测：Docker CLI **27.5.1**、Compose **v2.32.4** 已装好，但**守护进程未运行**——所以本篇第一步不是「装 Docker」，而是「把守护进程拉起来」。

---

## 3. 决策：为什么只容器化中间件（见总纲 §3.11）

总纲 §3.11 的结论：**Docker 只用于中间件，应用全部本地运行。**

| 方案 | 热重载 | 断点调试 | 日志可见性 | Windows 装 PG+pgvector 难度 |
| --- | --- | --- | --- | --- |
| 应用也容器化 | 慢（要重建镜像 / 文件监听穿透容器） | 麻烦（要配端口与调试器attach） | 要 `docker logs` 一层层捞 | —— |
| **中间件容器化、应用本地**（本项目选这个） | 保持原生速度 | 编辑器直接打断点 | 直接打在本地终端 | 官方镜像一行解决 |

三条理由（引自总纲）：

1. **学习目标是亲手写 / 调代码**——容器化应用会拖慢热重载、增加断点调试难度、隐藏日志。
2. **Windows 原生装 PostgreSQL + pgvector 很折磨**——官方 `pgvector/pgvector` 镜像最省事。
3. **与 Dify 自己一致**——Dify 也是「docker 起中间件 + 应用本地开发」。

> 「全容器化」（连应用一起放进 compose）留到将来的**部署**阶段当加分项，**不是学习目标**。

---

## 4. 命令清单（总览）

| 命令 | 在哪执行 | 目的 | 预期输出摘要 |
| --- | --- | --- | --- |
| `docker --version` | 任意目录（PowerShell） | 确认 Docker CLI 存在 | `Docker version 27.5.1, build ...` |
| `docker compose version` | 任意目录 | 确认 Compose v2 插件存在 | `Docker Compose version v2.32.4` |
| `docker ps` | 任意目录 | **探测守护进程**是否在跑 | 未跑 → `... dockerDesktopLinuxEngine ... cannot find the file specified` |
| （启动 Docker Desktop） | 桌面 / 开始菜单 | 拉起守护进程 | 托盘图标变绿、`docker ps` 不再报错 |
| `docker compose config` | 仓库根 | 校验 Compose 文件语法 | 打印合并后的完整配置（无报错） |
| `docker compose up -d db` | 仓库根 | 后台启动数据库容器 | `Container mini-dify-db Started` |
| `docker compose ps` | 仓库根 | 查看状态 | `Up ... (healthy)` |
| `docker compose logs -f db` | 仓库根 | 看初始化 / 启动日志 | PostgreSQL `database system is ready to accept connections` |
| `docker exec mini-dify-db psql -U postgres -d minidify -c "..."` | 仓库根 | 在容器里执行 SQL | 见第 11 节 |
| `docker compose down` | 仓库根 | 停止并删除容器（**保留数据卷**） | `Container mini-dify-db Removed` |

---

## 5. 【技术教学 · 首次】Docker 基础

> 规则：本节是 Docker 的**首次教学**，后续笔记遇到 `docker exec` / `docker compose` 只写「见阶段 0·02」并直接使用。

### 5.1 镜像（image）与容器（container）

**镜像 = 只读模板**，由一层层文件系统叠出来（所以拉镜像时会看到 `Pulling fs layer`）。它只是一个「包」，不运行。

**容器 = 镜像的运行实例**。同一个镜像可以起出 N 个容器，每个有自己的进程、网络、可写层。

```
image: pgvector/pgvector:pg16     ← 仓库名 pgvector/pgvector，标签 pg16
        ↓ docker compose up
container: mini-dify-db           ← 正在跑的那个 PostgreSQL 进程
```

**语法要点**：`<仓库>/<镜像名>:<标签>`。`pg16` 是**浮动标签**，表示「PostgreSQL 16 主版本的最新小版本」，所以今天拉到的可能是 16.15，将来可能是 16.x 更高版本。

> 在 Windows 上，Docker Desktop 用 **WSL2 后端**跑的是 **Linux 容器**。你不用装 Linux，也不用装 PostgreSQL。

### 5.2 卷（volume）：数据要靠它活下来

容器被删除时，容器**可写层**里的数据会一起消失。数据库绝不能这样，所以我们把数据目录挂到**卷**上：

```yaml
volumes:
  - db_data:/var/lib/postgresql/data      # 卷名:容器内路径
volumes:
  db_data:                                # 顶层声明这个命名卷
```

两种挂载方式对比：

| 方式 | 写法 | 数据存在哪 | 典型用途 |
| --- | --- | --- | --- |
| **命名卷**（本项目用） | `db_data:/var/lib/postgresql/data` | Docker 管理的目录（你**不用也不该**去手动改文件） | 数据库数据 |
| 绑定挂载（bind mount） | `./data:/var/lib/postgresql/data` | 宿主机上的真实目录 | 源码、配置 |

**为什么用命名卷**：跨平台一致、不受 Windows 文件系统权限影响、由 Docker 统一管生命周期（`docker volume ls` 可查）。

### 5.3 端口映射

```yaml
ports:
  - "5432:5432"        # 宿主机端口:容器端口
```

左边是**你的 Windows** 上的端口，右边是**容器内部** PostgreSQL 监听的端口。因为做了这个映射，本地跑的 `api-ts` / `api-py` 才能用 `localhost:5432` 连进容器里的数据库。

> 记忆：**左宿主机、右容器**。写成 `"5433:5432"` 就是「宿主机用 5433 连进容器 5432」。

### 5.4 healthcheck：让「起来了」不等于「能用了」

PostgreSQL 启动需要一点时间（初始化 + 加载），容器**进程存在**并不代表**已能接受连接**。healthcheck 让 Docker 周期性地在容器内执行探针命令：

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U postgres -d minidify"]
  interval: 5s      # 每 5 秒探测一次
  timeout: 3s       # 单次探测超过 3 秒算失败
  retries: 12       # 连续失败 12 次后标记为 unhealthy
```

- `test` 的第一种写法是数组：`["CMD-SHELL", "..."]` 表示**在容器内用 shell 执行后面的字符串**；等价写法是 `["CMD", "pg_isready", "-U", "postgres"]`（不经过 shell）。
- 探针命令是 `pg_isready`：PostgreSQL 自带的「就绪探测」小工具。退出码有意义——`0` 表示接受连接、`1` 表示拒绝、`2` 表示无响应。**退出码 0 才会被判定为 healthy。**
- 状态机：容器起来后先是 `starting`，探针通过后变 `healthy`，连续失败超限变 `unhealthy`。

**本项目为什么要 healthcheck**：虽然 compose 里只有一个服务（用不到 `depends_on: condition: service_healthy`），但**你**需要在启动后端之前知道「数据库真的能连了」。看到 `(healthy)` 再去跑 `api-ts` / `api-py`，就不会遇到莫名的连接失败。

### 5.5 Docker 常用命令（语法）

```powershell
docker --version                 # CLI 版本
docker ps                        # 正在运行的容器
docker ps -a                     # 含已停止的容器
docker images                    # 本地镜像
docker logs <容器名>              # 看容器日志
docker exec -it <容器名> <命令>    # 进容器执行命令（-i 交互、-t 分配终端）
docker volume ls                 # 卷列表
docker volume inspect db_data    # 看卷的详情（挂载点等）
docker rm <容器名>                # 删容器（compose 管理的容器请用 compose 命令）
```

---

## 6. 【技术教学 · 首次】Docker Compose：声明式编排

### 6.1 是什么

`docker run` 起一个容器要把参数写一长串（镜像、名字、端口、卷、环境变量、重启策略…）。参数一多就没人记得住，也没法**版本化**。

**Compose 把这些参数写进一份 YAML**：文件即「期望状态」，一条 `up` 命令就能拉起来。这就是**声明式**——你描述「要什么样」，Docker 负责「怎么做到」。

### 6.2 语法结构（本文件只有两种顶层键）

```yaml
services:      # 每个键 = 一个容器（键名就是「服务名」，这里是 db）
  db:
    image: ...
    container_name: ...
    ports: [...]
    volumes: [...]
    environment: {...}
    healthcheck: {...}

volumes:       # 顶层「声明」命名卷；下面 services 里的 db_data 必须在此声明
  db_data:
```

- 服务名 `db` 就是你操作时用的名字：`docker compose up -d db`、`docker compose logs db`。
- **注意没有 `version:` 字段**：那是 Compose v1 时代的写法，**v2 已废弃**，写了反而会有警告。本项目直接省略（正确做法）。
- 命令形式是 `docker compose`（**中间是空格**，v2 插件）；老教程里的 `docker-compose`（带横杠）是 v1，本机实测是 v2.32.4，请统一用空格那种。

### 6.3 本例为什么这么用

| 写法 | 目的 |
| --- | --- |
| 只有一个 `db` 服务 | 贯彻「Docker 只跑中间件」（§3）；需要 Redis 时**再往这里加一个服务**，声明式的扩展成本极低 |
| `restart: unless-stopped` | 开机 / Docker Desktop 重启后，除非你手动停过，容器自动回来——省得每次重启电脑后手动 `up` |
| `container_name: mini-dify-db` | 固定容器名，后续 `docker exec mini-dify-db ...`、`docker logs` 都可直接写名字，不用查随机名 |
| `environment: POSTGRES_*` | 官方镜像的初始化参数，值由根 `.env` 做变量替换注入（见 §7 逐项解释） |
| 命名卷 `db_data` | 数据持久化（§5.2） |
| `healthcheck` | 让「healthy」成为可依赖的信号（§5.4） |

---

## 7. 完整代码：`docker-compose.yml`（逐项解释）

**完整文件路径：`docker-compose.yml`（仓库根）**

```yaml
# mini-dify 本地开发中间件
# 只跑数据库；三个应用（api-ts / api-py / web）保持本地运行。
# 后续阶段需要 Redis 时，再往这里加一个 redis 服务。
services:
  db:
    image: pgvector/pgvector:pg16
    container_name: mini-dify-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-difyai123456}
      POSTGRES_DB: ${POSTGRES_DB:-minidify}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-minidify}"]
      interval: 5s
      timeout: 3s
      retries: 12

volumes:
  db_data:
```

**逐项解释**

| 配置 | 作用 | 为什么这么写 |
| --- | --- | --- |
| `image: pgvector/pgvector:pg16` | 用的镜像 | 官方 **pgvector** 镜像，内置 PostgreSQL 16 **和** `vector` 扩展，省掉「装 PG + 编译扩展」的痛苦 |
| `container_name: mini-dify-db` | 固定容器名 | 后续命令直接写名字（见实测部分） |
| `restart: unless-stopped` | 重启策略 | 电脑重启后数据库自动回来；`unless-stopped` = 除非你手动停过，否则自动重启 |
| `POSTGRES_USER: ${POSTGRES_USER:-postgres}` | 初始超级用户 | 官方镜像变量；值由根 `.env` 的 `POSTGRES_USER` 注入，未设置时回退默认 `postgres`（与连接串里的用户名一致） |
| `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-difyai123456}` | 初始密码 | 值由根 `.env` 的 `POSTGRES_PASSWORD` 注入，未设置时回退默认 `difyai123456`（对应连接串里的密码，§8） |
| `POSTGRES_DB: ${POSTGRES_DB:-minidify}` | 初始数据库名 | 值由根 `.env` 的 `POSTGRES_DB` 注入，未设置时回退默认 `minidify`；容器首启动时**额外创建**这个库 |
| `ports: "${POSTGRES_PORT:-5432}:5432"` | 端口映射 | 宿主机端口由根 `.env` 的 `POSTGRES_PORT` 注入，默认 `5432`；让本地应用用 `localhost:5432` 连进来 |
| `volumes: db_data:/var/lib/postgresql/data` | 数据持久化 | PostgreSQL 的数据目录就在这个容器路径下 |
| `healthcheck` | 就绪探测 | 见 §5.4；`pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-minidify}` 探测「用户 / 库」是否可连接，取值与上面的 `POSTGRES_*` 同源 |
| 顶层 `volumes: db_data:` | 声明命名卷 | 不声明下面就不能引用 |

> **`${VAR:-默认值}` 是 Compose 的变量替换语法**：启动时先取根 `.env`（见 §8）里的 `POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB / POSTGRES_PORT`，取不到才用 `:-` 后面的默认值。默认值与旧版字面量完全一致，所以**不配根 `.env` 时行为不变**。可用 `docker compose config` 看到替换后的结果。

> **重要**：`POSTGRES_*` 这三个变量只在**首次初始化**（数据卷为空时）生效。若卷里已有数据，改这里**不会**改数据库里已存在的用户/密码/库名——见第 13 节常见坑。

---

## 8. 完整代码：`.env.example` 与 `.env`（仓库根）

分工是「基础设施 vs 应用」：根 `docker-compose.yml` 管**数据库在哪跑**，根 `.env` 只给 compose 提供**基础设施变量**（用户/密码/库名/宿主机端口）；而「应用怎么连数据库」已下放到**各 app 自包含的 `.env`**（`apps/api-py/.env`、`apps/api-ts/.env`）。

**完整文件路径：`.env.example`（仓库根）**

```bash
# 基础设施变量（与根目录 docker-compose.yml 的 db 服务对应）
# 复制为 .env 后即可使用：cp .env.example .env
# 应用的连接串 / 密钥等已下放到各 app 自包含的 .env（apps/api-ts/.env、apps/api-py/.env）
POSTGRES_USER=postgres
POSTGRES_PASSWORD=difyai123456
POSTGRES_DB=minidify
POSTGRES_PORT=5432
```

**完整文件路径：`.env`（仓库根）**

```bash
# 基础设施变量：仅供 docker-compose.yml 做变量替换（各 app 自包含自己的 .env）
# 应用的 DATABASE_URL / JWT_SECRET / JWT_EXPIRES_IN / PORT 已下放到 apps/api-ts/.env 与 apps/api-py/.env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=difyai123456
POSTGRES_DB=minidify
POSTGRES_PORT=5432
```

**`.env.example` vs `.env` 的分工**

| 文件 | 内容 | 是否提交到 git |
| --- | --- | --- |
| `.env.example` | **模板**：只放变量名与示例值（**不含真密码**） | ✅ 提交，给新成员照抄 |
| `.env` | **真值**：本机实际使用的值 | ❌ 不提交（在 `.gitignore` 里） |

**应用层连接串长什么样（已下放到各 app 的 `.env`）**

根 `.env` 不再放 `DATABASE_URL`；两套后端各自读自己目录里的 `.env`：

| 文件 | 键 | 连接串格式 |
| --- | --- | --- |
| `apps/api-py/.env` | `DATABASE_URL` | SQLAlchemy 风格：`postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify`（带 `+psycopg` 驱动后缀） |
| `apps/api-ts/.env` | `DATABASE_URL` | Prisma 风格：`postgresql://postgres:difyai123456@localhost:5432/minidify`（**不带** `+driver` 后缀） |

**`DATABASE_URL` 逐段拆解**（以 `apps/api-py/.env` 的 SQLAlchemy 风格 DSN 为例）：

```
postgresql+psycopg://postgres:difyai123456@localhost:5432/minidify
└────┬───┘ └──┬──┘   └──┬──┘ └────┬────┘ └─┬─┘ └┬┘ └──┬───┘
  方言/驱动   用户名     密码       主机     端口   库名
```

| 片段 | 含义 | 与本文其它文件的关系 |
| --- | --- | --- |
| `postgresql` | 数据库方言 | 与 compose 的镜像（PostgreSQL 16）对应 |
| `+psycopg` | **指定驱动**为 psycopg（即 `psycopg[binary]>=3.2.0`，见 `apps/api-py/pyproject.toml`） | 「方言+驱动」是 SQLAlchemy 的连接串格式；纯 `postgresql://` 会走默认驱动（Prisma 就是这种），写清楚可避免歧义 |
| `postgres` | 用户名 | = 根 `.env` 的 `POSTGRES_USER` |
| `difyai123456` | 密码 | = 根 `.env` 的 `POSTGRES_PASSWORD` |
| `localhost` | 主机 | 因为做了端口映射；`localhost` 偶有解析竞态，见 §13 |
| `5432` | 端口 | = 根 `.env` 的 `POSTGRES_PORT`（映射到 compose 的宿主机侧端口） |
| `minidify` | 库名 | = 根 `.env` 的 `POSTGRES_DB` |

> **四处必须一致**：根 `.env` 的 `POSTGRES_USER/PASSWORD/DB/PORT`、`apps/api-py/.env` 的 `DATABASE_URL`、`apps/api-ts/.env` 的 `DATABASE_URL`。改一处就要同步改其它处。

> `JWT_SECRET` / `JWT_EXPIRES_IN` 是**阶段 1（账号与认证）**才用到的（见 `01-账号与认证/`），现已分别写进 `apps/api-py/.env` 与 `apps/api-ts/.env`。此处只提醒：两处必须同值，否则两套后端签发的令牌不能互认。

---

## 9. 步骤一（实测）：确认 CLI 存在，并把守护进程拉起来

### 9.1 先看「装了什么」

**命令**

```powershell
docker --version
docker compose version
```

| 项 | 值 |
| --- | --- |
| 在哪执行 | 任意目录，PowerShell |
| 目的 | 确认 Docker CLI 与 Compose 插件都已安装（安装与运行是两件事） |
| 预期输出 | 各自的版本行 |

**实测输出**

```
Docker version 27.5.1, build ...
Docker Compose version v2.32.4
```

### 9.2 再探测守护进程：此时会失败

**命令**

```powershell
docker ps
```

| 项 | 值 |
| --- | --- |
| 在哪执行 | 任意目录 |
| 目的 | 判断 Docker **守护进程（daemon）**是否在运行 |
| 预期输出 | 守护进程在跑 → 打印容器表格（可能为空）；未跑 → 连接错误 |

**实测输出（故障现象）**

```
error during connect: ... open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

**为什么**：`docker --version` 只读本地 CLI 文件，**不需要**守护进程；而 `docker ps` 要和守护进程通信。Windows 上的守护进程跑在 **Docker Desktop** 里（WSL2 后端，通过命名管道 `dockerDesktopLinuxEngine` 提供接口）。**Docker Desktop 没启动，就没有这个管道文件**，于是报 `cannot find the file specified`。

**解决**：启动 Docker Desktop。

### 9.3 启动 Docker Desktop

| 项 | 值 |
| --- | --- |
| 在哪执行 | 开始菜单 / 桌面图标，双击 **Docker Desktop** |
| 目的 | 拉起 Linux 虚拟机 + Docker 守护进程 |
| 预期输出 | 托盘图标停止转圈、界面显示 `Engine running`（首次启动可能较慢） |

**验证（等它就绪后再执行）**

```powershell
docker ps
docker info
```

预期：`docker ps` 不再报错（首次可能显示空表，只有表头 `CONTAINER ID  IMAGE  ...`）；`docker info` 能打印 `Server:` 一段信息，说明已经连上守护进程。

> **顺序很重要**：一定要**确认守护进程就绪**再执行 compose 命令，否则第 10 步也会报同样的错。

---

## 10. 步骤二（实测）：启动数据库容器

### 10.1 先校验文件（可选但推荐）

```powershell
docker compose config
```

| 项 | 值 |
| --- | --- |
| 在哪执行 | **仓库根** `d:\user\my_project\github\mini-dify` |
| 目的 | 让 Compose 解析并打印合并后的配置，**提前暴露 YAML 语法错误** |
| 预期输出 | 打印完整配置（含 `services.db.image: pgvector/pgvector:pg16` 等），无报错 |

> Compose 会自动在**当前目录**找 `docker-compose.yml` / `compose.yaml`，所以必须在仓库根执行，或显式 `-f` 指定文件。

### 10.2 启动

**命令**

```powershell
docker compose up -d db
```

| 项 | 值 |
| --- | --- |
| 在哪执行 | 仓库根 |
| 目的 | 按声明拉起 `db` 服务：没有镜像先拉，然后后台启动容器 |
| 预期输出 | `[+] Running ...` 与 `Container mini-dify-db  Started` |

**实测输出（首次）**

```
[+] Running ...
 ✔ db Pulled
 ✔ Container mini-dify-db  Started
```

命令拆解：

- `up`：创建并启动服务。
- `-d` = detached：**后台运行**，不占用当前终端（不加 `-d` 会占着终端刷日志）。
- `db`：只操作名为 `db` 的服务（不写则操作文件里全部服务）。

### 10.3 看状态与日志

```powershell
docker compose ps
```

**实测输出**

```
NAME            IMAGE                    COMMAND                  SERVICE   CREATED          STATUS                    PORTS
mini-dify-db    pgvector/pgvector:pg16   "docker-entrypoint.s…"   db        ... seconds ago  Up ... (healthy)          0.0.0.0:5432->5432/tcp
```

关键点：

- `STATUS` 里的 **`(healthy)`** 就是 §5.4 的 healthcheck 通过。
- `PORTS` 里的 **`0.0.0.0:5432->5432/tcp`** 就是端口映射生效（左宿主/右容器）。
- 刚启动时可能显示 `Up ... (health: starting)`，等几秒再查一次即可。

```powershell
docker compose logs -f db
```

| 项 | 值 |
| --- | --- |
| 目的 | 看容器启动 / 初始化日志（`-f` 跟随输出，`Ctrl+C` 退出） |
| 预期输出 | 出现 `database system is ready to accept connections` |

---

## 11. 步骤三（实测）：在容器里验证 PostgreSQL 与 pgvector

### 11.1 先讲一下 `docker exec` 与 `psql`

- `docker exec` = **在正在运行的容器里**执行一条命令。`-i`（交互）让 stdin 保持打开，`-t` 分配一个伪终端；`-it` 一起用即「像 SSH 进去一样」。
- `psql` = PostgreSQL 的官方命令行客户端，**镜像里已经带了**，不需要在本机安装。

语法骨架：

```powershell
docker exec <容器名> psql -U <用户名> -d <库名> -c "<SQL>"
```

- `-U postgres`：用哪个角色连接（= compose 的 `POSTGRES_USER`）。
- `-d minidify`：连哪个库（= compose 的 `POSTGRES_DB`）。
- `-c "<SQL>"`：执行完 SQL 就退出（一次性模式）；不加 `-c` 则进入交互式会话。

### 11.2 验证一：PostgreSQL 版本

```powershell
docker exec mini-dify-db psql -U postgres -d minidify -c "select version();"
```

| 项 | 值 |
| --- | --- |
| 在哪执行 | 任意目录（PowerShell；容器名是固定的 `mini-dify-db`） |
| 目的 | 证明容器里跑的是 PostgreSQL 16 的具体小版本 |
| 预期输出 | 以 `PostgreSQL 16.15` 开头的一行 |

**实测输出（关键 substring）**

```
PostgreSQL 16.15 (Debian ...) on x86_64-pc-linux-gnu, compiled by gcc ...
```

> 这行同时告诉你：镜像基于 **Debian**、运行在 **`x86_64-pc-linux-gnu`**（说明是 Linux 容器，不是 Windows 容器）。

### 11.3 验证二：创建 `vector` 扩展

pgvector 镜像只是把扩展**文件**准备好了，**每个库仍要自己启用一次**：

```powershell
docker exec mini-dify-db psql -U postgres -d minidify -c "create extension if not exists vector;"
```

| 项 | 值 |
| --- | --- |
| 目的 | 在 `minidify` 库里启用向量类型与向量索引能力 |
| 预期输出 | `CREATE EXTENSION` |

**实测结果**：**执行成功**（`CREATE EXTENSION`）。

语法点：

- `create extension`：PostgreSQL 的扩展机制，把额外类型/函数装进当前库。
- `if not exists`：**幂等**——已装过就不报错、也不重复装。写它是为了这条命令可以反复执行。

### 11.4 验证三：查扩展版本

```powershell
docker exec mini-dify-db psql -U postgres -d minidify -c "select extname, extversion from pg_extension where extname='vector';"
```

**实测输出**

```
 extname | extversion
---------+------------
 vector  | 0.8.7
(1 row)
```

**实测结论：`vector 0.8.7`**——与 PostgreSQL 16.15 一起，构成后面做 RAG / 向量检索的基础。（阶段 0 只验证「可用」，建表与向量列要到后续阶段。）

### 11.5 交互式玩一下（可选）

```powershell
docker exec -it mini-dify-db psql -U postgres -d minidify
```

进去后可用 psql 的元命令：

```
\dx        -- 列出已安装扩展
\l         -- 列出所有数据库
\dt        -- 列出当前库的表
\q         -- 退出
```

---

## 12. 验收自测

在**仓库根**依次执行（PowerShell）：

```powershell
docker compose ps
docker exec mini-dify-db psql -U postgres -d minidify -c "select version();"
docker exec mini-dify-db psql -U postgres -d minidify -c "create extension if not exists vector;"
docker exec mini-dify-db psql -U postgres -d minidify -c "select extname, extversion from pg_extension where extname='vector';"
```

| 检查项 | 预期结果 |
| --- | --- |
| 容器状态 | `mini-dify-db` 的 `STATUS` 含 **`(healthy)`** |
| 端口映射 | `PORTS` 含 `0.0.0.0:5432->5432/tcp` |
| PostgreSQL 版本 | 输出以 **`PostgreSQL 16.15`** 开头 |
| 扩展启用 | 返回 **`CREATE EXTENSION`**（重复执行也返回 `CREATE EXTENSION`，因为 `if not exists` 幂等） |
| 扩展版本 | `vector | 0.8.7` |

**收尾命令（想停就停，数据不丢）**

```powershell
docker compose down          # 停并删容器；命名卷 db_data 保留，数据还在
docker compose up -d db      # 再次启动，数据仍在（端口仍是 5432）
```

**危险命令（会清空数据，只在想重来时用）**

```powershell
docker compose down -v       # 额外删除命名卷 → 数据（含 minidify 库与 vector 扩展）全部丢失
```

---

## 13. 常见坑

| 坑 | 现象 | 原因 | 解决 |
| --- | --- | --- | --- |
| 守护进程未启动 | `docker ps` / `docker compose up` 报 `... dockerDesktopLinuxEngine ... The system cannot find the file specified` | `docker --version` 只读 CLI，不需要守护进程；而 `ps`/`up` 要和 Docker Desktop 里的守护进程通信，管道文件不存在即报此错 | 启动 **Docker Desktop**，等界面显示 Engine running / 托盘就绪，再执行 compose 命令 |
| 首次拉镜像很慢 | 长时间停在 `Pulling fs layer` / `Downloading` | 镜像要从仓库下载（`pgvector/pgvector:pg16` 体积不小），属**正常现象** | 耐心等；之后会复用本地镜像，秒起。想确认没卡死可另开终端 `docker images` 看层是否在增加 |
| 5432 端口被占用 | `Bind for 0.0.0.0:5432 failed: port is already allocated` | 本机已装过 PostgreSQL，或别的容器占了 5432 | 停掉本机 PostgreSQL 服务；或把根 `.env` 的 `POSTGRES_PORT` 改成 `5433`（映射即变成 `5433:5432`），并**同步**改 `apps/api-py/.env` 与 `apps/api-ts/.env` 里 `DATABASE_URL` 的端口 |
| 改了密码却不生效 | 改了根 `.env` 的 `POSTGRES_PASSWORD`（经 compose 替换），容器里的密码没变 | `POSTGRES_*` 只在**首次初始化**（卷为空）时生效；已有数据时镜像会跳过初始化 | 用 `psql` 走 `ALTER ROLE postgres WITH PASSWORD '...';`，或 `docker compose down -v` 后重来（**会清空数据**） |
| `localhost` 解析竞态 | 连接偶尔失败 / 有时连上有时候连不上 | Windows 上 `localhost` 可能先被解析成 IPv6 `::1`，而映射/客户端只覆盖 IPv4，形成解析竞态 | 把各 app `.env` 里 `DATABASE_URL` 的主机改成 **`127.0.0.1`** 更稳；本项目两处 `.env` 现写的是 `localhost`（实测可用），**遇到偶发失败再改**，且注意 `apps/api-py/.env` 与 `apps/api-ts/.env` 要同步 |
| 以为容器在跑就能连 | 容器 `Up`，但应用连不上 | 可能还在 `health: starting`，PostgreSQL 尚未接受连接 | 以 `(healthy)` 为准；`docker compose logs -f db` 看到 `ready to accept connections` 再启动后端 |
| 在错的目录执行 compose | `no configuration file provided: not found` | compose 只在**当前目录**找 `docker-compose.yml` | 切到仓库根执行，或 `docker compose -f d:\user\my_project\github\mini-dify\docker-compose.yml up -d db` |
| 把 `docker-compose` 写成带横杠 | `docker-compose: command not found` | 那是 Compose v1 的老命令；本机是 v2 插件（v2.32.4） | 用 `docker compose`（**中间空格**） |
| 用了 `version:` 字段 | 启动时出现「`version` is obsolete」警告 | Compose v2 已废弃该字段 | 删掉它（本项目文件里没有，属正确写法） |
| 顺手把应用也容器化 | 热重载变慢、断点难打、日志被 `docker logs` 吞掉 | 与总纲 §3.11 的决策相悖 | 阶段 0 保持「**中间件容器化 + 应用本地**」；全容器化留到部署阶段 |
| 在本机也装了 PostgreSQL/pgvector | 与容器端口冲突、混淆连的是哪个 | 两个 PostgreSQL 抢 5432 | 学习阶段**只用容器**，本机不需要装 PostgreSQL |

---

## 14. 本篇技术点登记（同步到 `docs/tutorial/INDEX.md`）

| 技术点 | 说明 |
| --- | --- |
| Docker 基础概念（镜像 / 容器 / 命名卷 / 端口映射 / healthcheck） | **首次教学于本篇** |
| Docker Compose（声明式多容器编排：`services` / `volumes` / `up -d` / `ps` / `logs` / `down`） | **首次教学于本篇** |
| `docker exec` 与容器内 `psql` 自检 | **首次教学于本篇** |
| PostgreSQL 扩展机制（`create extension if not exists` / `pg_extension`） | **首次教学于本篇** |
| 根 `.env.example` 与 `.env` 的分工（只放基础设施变量，供 compose 做变量替换）；应用层变量下放到各 app 的 `.env`；SQLAlchemy 风格连接串 `dialect+driver://user:pass@host:port/db` | **首次教学于本篇**（配置读取的实现见 `06-FastAPI起步.md`） |
| 「中间件容器化、应用本地运行」的取舍（总纲 §3.11） | **首次教学于本篇** |
