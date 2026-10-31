import { defineConfig } from 'vitepress'
import { demoblockPlugin, demoblockVitePlugin } from 'vitepress-theme-demoblock'
import { fileURLToPath } from 'node:url'
// import vue from '@vitejs/plugin-vue'
import { containerPreview, componentPreview } from '@vitepress-demo-preview/plugin'

// 文档站通过 npm 包名引入 mfxgy-ui；发布前使用 file: 本地依赖。
// 如果包管理工具把本地依赖建成了软链，需要放行组件库所在的工作区目录。
const mfxgyRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  base: '/mfxgy/',
  title: "MuFengXingGuYing",
  description: "",
  srcDir: './docs',
  outDir: './public',
  themeConfig: {
    siteTitle: 'mfxgy',
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: 'mfxgy-ui', items: [ 
          { text: '指南', link: '/demo/guild/installation.md' },
          { text: '组件', link: '/demo/examples/button' },
        ] 
      },
      { text: '教程笔记', items: [
          { text: '开发总纲', link: '/tutorial/000-开发总纲' },
          { text: '索引与写作规范', link: '/tutorial/INDEX' },
          { text: '阶段 0 · 项目初始化', link: '/tutorial/00-项目初始化/01-环境准备' },
          { text: '阶段 1 · 账号与认证', link: '/tutorial/01-账号与认证/01-契约扩展' },
          { text: '阶段 2 · 应用管理', link: '/tutorial/02-应用管理/01-契约扩展' },
          { text: '阶段 3 · 画布', link: '/tutorial/03-画布/01-图JSON契约与校验' },
          { text: '阶段 4 · 执行引擎', link: '/tutorial/04-执行引擎/01-运行契约与SSE事件协议' },
          { text: '阶段 5 · LLM 节点', link: '/tutorial/05-LLM节点/01-LLM节点契约与模型配置' },
          { text: '阶段 6 · 工具调用', link: '/tutorial/06-工具调用/01-工具契约与内置工具' },
          { text: '阶段 7 · 知识库 RAG', link: '/tutorial/07-知识库RAG/01-知识库契约与pgvector建模' },
          { text: '阶段 8 · 分支与循环', link: '/tutorial/08-分支与循环/01-分支节点的契约与图校验' },
          { text: '阶段 9 · 会话与记忆', link: '/tutorial/09-会话与记忆/01-会话契约与数据建模' },
          { text: '阶段 10 · 发布与 API', link: '/tutorial/10-发布与API/01-发布语义与API-Key契约' },
          { text: '阶段 11 · 自主 Agent 运行时', link: '/tutorial/11-自主Agent运行时/01-Run模型与事件重放' },
        ]
      },
      { text: 'PostgreSQL', items: [
          { text: '系列首页', link: '/pgsql/index' },
          { text: '总大纲与技术点索引', link: '/pgsql/INDEX' },
          { text: '学习总结', link: '/pgsql/学习总结' },
          { text: '阶段 0 · 认识 PG 与环境上手', link: '/pgsql/00-认识PostgreSQL与环境上手/01-PostgreSQL是什么' },
          { text: '阶段 3 · JSONB 与半结构化数据', link: '/pgsql/03-JSONB与半结构化数据/01-json与jsonb及读写操作符' },
          { text: '阶段 8 · pgvector 向量检索', link: '/pgsql/08-扩展生态与pgvector/02-pgvector向量检索' },
          { text: '阶段 11 · 综合实战', link: '/pgsql/11-综合实战-mini-dify数据层/01-ORM的PG特性实战' },
        ]
      },
      { text: 'Python + FastAPI', items: [
          { text: '大纲与写作规范', link: '/python/INDEX' },
          { text: '阶段 0 · Python 基础', link: '/python/00-Python基础/01-环境与工具链' },
          { text: '阶段 1 · Python 进阶', link: '/python/01-Python进阶/01-类型注解与typing' },
          { text: '阶段 2 · 异步与并发', link: '/python/02-异步与并发/01-GIL与并发模型选择' },
          { text: '阶段 3 · 工程化', link: '/python/03-工程化/01-pyproject与依赖管理' },
        ]
      },
      { text: '计算机基础', items: [
          { text: '总览与复习路线', link: '/cs-basics/INDEX' },
          { text: '01 计算机基础', link: '/cs-basics/01-计算机基础' },
          { text: '02 计算机网络', link: '/cs-basics/02-计算机网络' },
          { text: '03 操作系统', link: '/cs-basics/03-操作系统' },
          { text: '04 数据结构', link: '/cs-basics/04-数据结构' },
          { text: '05 数据库与存储', link: '/cs-basics/05-数据库与存储' },
          { text: '06 系统设计与分布式', link: '/cs-basics/06-系统设计与分布式' },
        ]
      }
    ],

    sidebar:  {
      "/": [
        {
          collapsed: false, // 折叠/展开
          text: 'Typescript',
          link: '/typescript.md'
          // items: [
          //   { text: 'Markdown Examples', link: '/markdown-examples' },
          //   { text: 'Runtime API Examples', link: '/api-examples' }
          // ]
        },
        {
          collapsed: false, // 折叠/展开
          text: 'Markdown',
          link: '/markdown.md'
        },
        {
          collapsed: false, // 折叠/展开
          text: '八股文',
          items: [
            { text: '快速', link: '/BaGuWen/kuai.md' },
            { text: 'HTML', link: '/BaGuWen/html.md' },
            { text: 'CSS', link: '/BaGuWen/css.md' },
            { text: 'JavaScript', link: '/BaGuWen/javascript.md' },
            { text: 'vue', link: '/BaGuWen/vue.md' },
            { text: '手写代码', link: '/BaGuWen/write.md' },
            { text: '浏览器', link: '/BaGuWen/browser.md' },
            { text: '工程化', link: '/BaGuWen/engineering.md' },
          ]
        },
      ],
      "/demo/guild/": [
        {
          text: "基础",
          items: [
            {
              text: "安装",
              link: "/demo/guild/installation",
            },
            {
              text: "快速开始",
              link: "/demo/guild/quickstart",
            },
          ],
        },
        {
          text: "进阶",
          items: [
            {
              text: "xx",
              link: "/xx",
            },
          ],
        },
      ],
      "/demo/examples/": [
        {
          text: "基础组件",
          items: [
            {
              text: "Button 按钮",
              link: "/demo/examples/button/",
            },
            {
              text: "Input 输入框",
              link: "/demo/examples/input/",
            },
            {
              text: "Switch 开关",
              link: "/demo/examples/switch/",
            },
          ],
        },
        {
          text: "反馈组件",
          items: [
            {
              text: "Dialog 对话框",
              link: "/demo/examples/dialog/",
            },
            {
              text: "Message 消息提示",
              link: "/demo/examples/message/",
            },
          ],
        },
      ],
      "/document/react/": [
        {
          collapsed: false, // 折叠/展开
          text: 'react语法查询',
          link: '/document/react/doc.md'
        },
        {
          collapsed: false, // 折叠/展开
          text: '使用create-react-app初始化react项目',
          link: '/document/react/index.md'
        },
        {
          collapsed: false, // 折叠/展开
          text: '从vue3学习react',
          link: '/document/react/patch.md'
        },
      ],
      "/document/mysql/": [
        {
          collapsed: false, // 折叠/展开
          text: 'MYSQL',
          link: '/document/mysql/index.md'
        },
      ],
      "/document/vibeCoding/": [
        {
          collapsed: false, // 折叠/展开
          text: 'vibeCoding',
          link: '/document/vibeCoding/index.md'
        },
      ],
      "/document/weiQianDuan/": [
        {
          collapsed: false, // 折叠/展开
          text: '微前端',
          link: '/document/weiQianDuan/index.md'
        },
      ],
      "/document/vue/": [
        {
          collapsed: false, // 折叠/展开
          text: '手写vue3',
          link: '/document/vue/handwrite.md'
        },
      ],
      "/python/": [
        {
          collapsed: false,
          text: '大纲与写作规范',
          link: '/python/INDEX'
        },
        {
          collapsed: false,
          text: '阶段 0 · Python 基础',
          items: [
            { text: '01 环境与工具链', link: '/python/00-Python基础/01-环境与工具链' },
            { text: '02 语法最小集与数据类型', link: '/python/00-Python基础/02-语法最小集与数据类型' },
            { text: '03 函数与作用域', link: '/python/00-Python基础/03-函数与作用域' },
            { text: '04 模块、包与导入', link: '/python/00-Python基础/04-模块、包与导入' },
            { text: '05 异常与文件 IO', link: '/python/00-Python基础/05-异常与文件IO' },
            { text: '06 面向对象', link: '/python/00-Python基础/06-面向对象' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 1 · Python 进阶',
          items: [
            { text: '01 类型注解与 typing', link: '/python/01-Python进阶/01-类型注解与typing' },
            { text: '02 迭代器与生成器', link: '/python/01-Python进阶/02-迭代器与生成器' },
            { text: '03 装饰器与闭包', link: '/python/01-Python进阶/03-装饰器与闭包' },
            { text: '04 上下文管理器与 dataclass', link: '/python/01-Python进阶/04-上下文管理器与dataclass' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 2 · 异步与并发',
          items: [
            { text: '01 GIL 与并发模型选择', link: '/python/02-异步与并发/01-GIL与并发模型选择' },
            { text: '02 asyncio 核心', link: '/python/02-异步与并发/02-asyncio核心' },
            { text: '03 异步实战模式', link: '/python/02-异步与并发/03-异步实战模式' },
            { text: '04 并发工具箱', link: '/python/02-异步与并发/04-并发工具箱' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 3 · 工程化',
          items: [
            { text: '01 pyproject 与依赖管理', link: '/python/03-工程化/01-pyproject与依赖管理' },
            { text: '02 配置与日志', link: '/python/03-工程化/02-配置与日志' },
            { text: '03 pytest 入门', link: '/python/03-工程化/03-pytest入门' },
            { text: '04 静态检查与格式化', link: '/python/03-工程化/04-静态检查与格式化' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 4 · Web 基础与 FastAPI 起步',
          items: [
            { text: '01 HTTP 与 ASGI/WSGI', link: '/python/04-Web基础与FastAPI起步/01-HTTP与ASGI-WSGI' },
            { text: '02 FastAPI 第一个应用', link: '/python/04-Web基础与FastAPI起步/02-FastAPI第一个应用' },
            { text: '03 路由、参数与响应', link: '/python/04-Web基础与FastAPI起步/03-路由、参数与响应' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 5 · FastAPI 核心',
          items: [
            { text: '01 Pydantic v2 模型与校验', link: '/python/05-FastAPI核心/01-Pydantic-v2模型与校验' },
            { text: '02 依赖注入 Depends', link: '/python/05-FastAPI核心/02-Depends依赖注入' },
            { text: '03 异常处理与错误契约', link: '/python/05-FastAPI核心/03-异常处理与错误契约' },
            { text: '04 中间件、CORS 与生命周期', link: '/python/05-FastAPI核心/04-中间件、CORS与生命周期' },
            { text: '05 APIRouter 分层与项目结构', link: '/python/05-FastAPI核心/05-APIRouter分层与项目结构' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 6 · 数据层',
          items: [
            { text: '01 SQLAlchemy 2.0 核心', link: '/python/06-数据层/01-SQLAlchemy2.0核心' },
            { text: '02 Session 生命周期与依赖', link: '/python/06-数据层/02-Session生命周期与依赖' },
            { text: '03 关系、级联与查询', link: '/python/06-数据层/03-关系、级联与查询' },
            { text: '04 Alembic 迁移与异步驱动', link: '/python/06-数据层/04-Alembic迁移与异步驱动' },
            { text: '05 索引、执行计划与查询优化', link: '/python/06-数据层/05-索引、执行计划与查询优化' },
            { text: '06 事务、隔离级别与并发控制', link: '/python/06-数据层/06-事务、隔离级别与并发控制' },
          ]
        },
      ],
      "/pgsql/": [
        {
          collapsed: false,
          text: '首页与索引',
          items: [
            { text: '系列首页', link: '/pgsql/index' },
            { text: '总大纲与技术点索引', link: '/pgsql/INDEX' },
            { text: '学习总结', link: '/pgsql/学习总结' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 0 · 认识 PG 与环境上手',
          items: [
            { text: '01 PostgreSQL 是什么', link: '/pgsql/00-认识PostgreSQL与环境上手/01-PostgreSQL是什么' },
            { text: '02 环境搭建与基础操作', link: '/pgsql/00-认识PostgreSQL与环境上手/02-环境搭建与基础操作' },
            { text: '03 数据类型与建表语法', link: '/pgsql/00-认识PostgreSQL与环境上手/03-数据类型与建表语法' },
            { text: '04 增删改查', link: '/pgsql/00-认识PostgreSQL与环境上手/04-增删改查' },
            { text: '05 聚合函数与 GROUP BY', link: '/pgsql/00-认识PostgreSQL与环境上手/05-聚合函数与GROUP BY' },
            { text: '06 多表连接与子查询', link: '/pgsql/00-认识PostgreSQL与环境上手/06-多表连接与子查询' },
            { text: '07 事务与事务性 DDL', link: '/pgsql/00-认识PostgreSQL与环境上手/07-事务与事务性DDL' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 2 · 与 MySQL 差异专题',
          items: [
            { text: '01 标识符、引号与大小写', link: '/pgsql/02-与MySQL差异专题/01-标识符、引号与大小写' },
            { text: '02 高频语法差异', link: '/pgsql/02-与MySQL差异专题/02-高频语法差异' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 3 · JSONB 与半结构化数据',
          items: [
            { text: '01 json/jsonb 及读写操作符', link: '/pgsql/03-JSONB与半结构化数据/01-json与jsonb及读写操作符' },
            { text: '02 GIN 索引与项目实战', link: '/pgsql/03-JSONB与半结构化数据/02-GIN索引与项目实战' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 4 · 查询进阶',
          items: [
            { text: '01 JOIN 全家桶与子查询', link: '/pgsql/04-查询进阶/01-JOIN全家桶与子查询' },
            { text: '02 窗口函数、CTE 与 PG 特色', link: '/pgsql/04-查询进阶/02-窗口函数、CTE与PG特色' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 5 · 事务、MVCC 与并发',
          items: [
            { text: '02 MVCC、锁与 VACUUM', link: '/pgsql/05-事务MVCC与并发/02-MVCC锁与VACUUM' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 6 · 索引与执行计划',
          items: [
            { text: '01 索引类型与设计', link: '/pgsql/06-索引与执行计划/01-索引类型与设计' },
            { text: '02 EXPLAIN 与查询优化', link: '/pgsql/06-索引与执行计划/02-EXPLAIN与查询优化' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 7 · 体系结构、Schema 与权限',
          items: [
            { text: '01 Database / Schema / Role 三层', link: '/pgsql/07-体系结构Schema与权限/01-Database_Schema_Role三层' },
            { text: '02 系统目录与监控', link: '/pgsql/07-体系结构Schema与权限/02-系统目录与监控' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 8 · 扩展生态与 pgvector',
          items: [
            { text: '01 扩展机制与常用扩展', link: '/pgsql/08-扩展生态与pgvector/01-扩展机制与常用扩展' },
            { text: '02 pgvector 向量检索', link: '/pgsql/08-扩展生态与pgvector/02-pgvector向量检索' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 9 · 全文检索（选修）',
          items: [
            { text: '01 tsvector 体系与中文方案', link: '/pgsql/09-全文检索/01-tsvector体系与中文方案' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 10 · 备份、复制与运维（选修）',
          items: [
            { text: '01 逻辑备份与恢复', link: '/pgsql/10-备份复制与运维/01-逻辑备份与恢复' },
            { text: '02 WAL、复制与监控调优', link: '/pgsql/10-备份复制与运维/02-WAL复制与监控调优' },
          ]
        },
        {
          collapsed: true,
          text: '阶段 11 · 综合实战：mini-dify 数据层',
          items: [
            { text: '01 ORM 的 PG 特性实战', link: '/pgsql/11-综合实战-mini-dify数据层/01-ORM的PG特性实战' },
            { text: '02 事件表 + 向量检索闭环', link: '/pgsql/11-综合实战-mini-dify数据层/02-事件表+向量检索闭环' },
          ]
        },
      ],
      "/tutorial/": [
        {
          collapsed: false,
          text: '开发总纲',
          link: '/tutorial/000-开发总纲'
        },
        {
          collapsed: false,
          text: '索引与写作规范',
          link: '/tutorial/INDEX'
        },
        {
          collapsed: false,
          text: '阶段 0 · 项目初始化',
          items: [
            { text: '00 Python 与 FastAPI 基础', link: '/tutorial/00-项目初始化/00-Python与FastAPI基础' },
            { text: '01 环境准备：Node / pnpm / uv / Python', link: '/tutorial/00-项目初始化/01-环境准备' },
            { text: '02 本地中间件：Docker 只跑 PostgreSQL+pgvector', link: '/tutorial/00-项目初始化/02-本地中间件Docker' },
            { text: '03 monorepo 与 pnpm workspace', link: '/tutorial/00-项目初始化/03-monorepo与pnpm-workspace' },
            { text: '04 契约包与 TypeScript 类型', link: '/tutorial/00-项目初始化/04-契约包与TypeScript类型' },
            { text: '05 NestJS 起步（装饰器 / DI）', link: '/tutorial/00-项目初始化/05-NestJS起步' },
            { text: '06 FastAPI 起步（Pydantic）', link: '/tutorial/00-项目初始化/06-FastAPI起步' },
            { text: '07 Next.js 起步（React 组件）', link: '/tutorial/00-项目初始化/07-NextJS起步' },
            { text: '08 验收：两套后端 /health + 前端切换', link: '/tutorial/00-项目初始化/08-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 1 · 账号与认证',
          items: [
            { text: '01 契约扩展：注册 / 登录 / 当前用户 + 错误信封', link: '/tutorial/01-账号与认证/01-契约扩展' },
            { text: '02 Prisma：schema / migrate / Client', link: '/tutorial/01-账号与认证/02-Prisma' },
            { text: '03 NestJS 认证：Guard / 装饰器 / ValidationPipe', link: '/tutorial/01-账号与认证/03-NestJS认证' },
            { text: '04 SQLAlchemy 2.0：模型映射 / Session', link: '/tutorial/01-账号与认证/04-SQLAlchemy2.0' },
            { text: '05 FastAPI 认证：Depends / HTTPBearer', link: '/tutorial/01-账号与认证/05-FastAPI认证' },
            { text: '06 JWT 与密码哈希', link: '/tutorial/01-账号与认证/06-JWT与密码哈希' },
            { text: '07 验收：跨后端令牌互认 + 错误信封一致', link: '/tutorial/01-账号与认证/07-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 2 · 应用管理',
          items: [
            { text: '01 契约扩展：应用 CRUD', link: '/tutorial/02-应用管理/01-契约扩展' },
            { text: '02 Prisma 关系建模', link: '/tutorial/02-应用管理/02-Prisma关系建模' },
            { text: '03 NestJS 应用模块', link: '/tutorial/02-应用管理/03-NestJS应用模块' },
            { text: '04 SQLAlchemy 关系建模', link: '/tutorial/02-应用管理/04-SQLAlchemy关系建模' },
            { text: '05 FastAPI 应用模块', link: '/tutorial/02-应用管理/05-FastAPI应用模块' },
            { text: '06 前端应用列表页', link: '/tutorial/02-应用管理/06-前端应用列表页' },
            { text: '07 验收：归属隔离 / 跨后端同表一致性', link: '/tutorial/02-应用管理/07-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 3 · 画布',
          items: [
            { text: '01 图 JSON 契约与校验', link: '/tutorial/03-画布/01-图JSON契约与校验' },
            { text: '02 Prisma JSONB 与两态', link: '/tutorial/03-画布/02-Prisma-JSONB与两态' },
            { text: '03 NestJS 图模块', link: '/tutorial/03-画布/03-NestJS图模块' },
            { text: '04 SQLAlchemy JSONB 映射', link: '/tutorial/03-画布/04-SQLAlchemy-JSONB映射' },
            { text: '05 FastAPI 图模块', link: '/tutorial/03-画布/05-FastAPI图模块' },
            { text: '06 ReactFlow 画布', link: '/tutorial/03-画布/06-ReactFlow画布' },
            { text: '07 验收：跨后端契约一致', link: '/tutorial/03-画布/07-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 4 · 执行引擎',
          items: [
            { text: '01 运行契约与 SSE 事件协议', link: '/tutorial/04-执行引擎/01-运行契约与SSE事件协议' },
            { text: '02 LangGraph 编译图（TS）', link: '/tutorial/04-执行引擎/02-LangGraph编译图-TS' },
            { text: '03 节点运行时与变量池', link: '/tutorial/04-执行引擎/03-节点运行时与变量池' },
            { text: '04 LangGraph 与引擎（Python）', link: '/tutorial/04-执行引擎/04-LangGraph与引擎-Python' },
            { text: '05 SSE 流式响应实现', link: '/tutorial/04-执行引擎/05-SSE流式响应实现' },
            { text: '06 前端 SSE 客户端与运行面板', link: '/tutorial/04-执行引擎/06-前端SSE客户端与运行面板' },
            { text: '07 验收', link: '/tutorial/04-执行引擎/07-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 5 · LLM 节点',
          items: [
            { text: '01 LLM 节点契约与模型配置', link: '/tutorial/05-LLM节点/01-LLM节点契约与模型配置' },
            { text: '02 真实模型调用与流式', link: '/tutorial/05-LLM节点/02-真实模型调用与流式' },
            { text: '03 LLM 错误映射', link: '/tutorial/05-LLM节点/03-LLM错误映射' },
            { text: '04 mock LLM 与无密钥自测', link: '/tutorial/05-LLM节点/04-mock-LLM与无密钥自测' },
            { text: '05 验收', link: '/tutorial/05-LLM节点/05-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 6 · 工具调用',
          items: [
            { text: '01 工具契约与内置工具', link: '/tutorial/06-工具调用/01-工具契约与内置工具' },
            { text: '02 NestJS：ReAct 循环与条件边', link: '/tutorial/06-工具调用/02-NestJS-ReAct循环与条件边' },
            { text: '03 Python 工具与 ReAct 对齐', link: '/tutorial/06-工具调用/03-Python工具与ReAct对齐' },
            { text: '04 前端工具选择面板', link: '/tutorial/06-工具调用/04-前端工具选择面板' },
            { text: '05 验收', link: '/tutorial/06-工具调用/05-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 7 · 知识库 RAG',
          items: [
            { text: '01 知识库契约与 pgvector 建模', link: '/tutorial/07-知识库RAG/01-知识库契约与pgvector建模' },
            { text: '02 文档切分与向量化', link: '/tutorial/07-知识库RAG/02-文档切分与向量化' },
            { text: '03 NestJS 检索与检索节点', link: '/tutorial/07-知识库RAG/03-NestJS检索与检索节点' },
            { text: '04 Python 对齐与前端知识库页', link: '/tutorial/07-知识库RAG/04-Python对齐与前端知识库页' },
            { text: '05 验收', link: '/tutorial/07-知识库RAG/05-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 8 · 分支与循环',
          items: [
            { text: '01 分支节点的契约与图校验', link: '/tutorial/08-分支与循环/01-分支节点的契约与图校验' },
            { text: '02 NestJS 条件边与变量聚合', link: '/tutorial/08-分支与循环/02-NestJS条件边与变量聚合' },
            { text: '03 迭代节点与跨语言数值对齐', link: '/tutorial/08-分支与循环/03-迭代节点与跨语言数值对齐' },
            { text: '04 前端多出口 Handle 与分支面板', link: '/tutorial/08-分支与循环/04-前端多出口Handle与分支面板' },
            { text: '05 验收', link: '/tutorial/08-分支与循环/05-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 9 · 会话与记忆',
          items: [
            { text: '01 会话契约与数据建模', link: '/tutorial/09-会话与记忆/01-会话契约与数据建模' },
            { text: '02 历史加载与上下文注入（NestJS）', link: '/tutorial/09-会话与记忆/02-历史加载与上下文注入-NestJS' },
            { text: '03 checkpointer 与自建消息表', link: '/tutorial/09-会话与记忆/03-checkpointer与自建消息表' },
            { text: '04 Python 对齐与前端会话面板', link: '/tutorial/09-会话与记忆/04-Python对齐与前端会话面板' },
            { text: '05 验收', link: '/tutorial/09-会话与记忆/05-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 10 · 发布与 API',
          items: [
            { text: '01 发布语义与 API Key 契约', link: '/tutorial/10-发布与API/01-发布语义与API-Key契约' },
            { text: '02 API Key 安全设计', link: '/tutorial/10-发布与API/02-API-Key安全设计' },
            { text: '03 对外 SSE 接口与双后端对齐', link: '/tutorial/10-发布与API/03-对外SSE接口与双后端对齐' },
            { text: '04 前端发布面板与调用示例', link: '/tutorial/10-发布与API/04-前端发布面板与调用示例' },
            { text: '05 验收', link: '/tutorial/10-发布与API/05-验收' },
          ]
        },
        {
          collapsed: false,
          text: '阶段 11 · 自主 Agent 运行时',
          items: [
            { text: '01 Run 模型与事件重放', link: '/tutorial/11-自主Agent运行时/01-Run模型与事件重放' },
            { text: '02 Composition 声明式装配与层设计', link: '/tutorial/11-自主Agent运行时/02-Composition声明式装配与层设计' },
            { text: '03 ReAct 循环与上下文压缩', link: '/tutorial/11-自主Agent运行时/03-ReAct循环与上下文压缩' },
            { text: '04 前端 Agent 控制台与 SSE 重连', link: '/tutorial/11-自主Agent运行时/04-前端Agent控制台与SSE重连' },
            { text: '05 验收', link: '/tutorial/11-自主Agent运行时/05-验收' },
          ]
        },
      ],
      "/cs-basics/": [
        {
          collapsed: false,
          text: '总览与复习路线',
          link: '/cs-basics/INDEX'
        },
        {
          collapsed: false,
          text: '知识篇',
          items: [
            { text: '01 计算机基础', link: '/cs-basics/01-计算机基础' },
            { text: '02 计算机网络', link: '/cs-basics/02-计算机网络' },
            { text: '03 操作系统', link: '/cs-basics/03-操作系统' },
            { text: '04 数据结构', link: '/cs-basics/04-数据结构' },
            { text: '05 数据库与存储', link: '/cs-basics/05-数据库与存储' },
            { text: '06 系统设计与分布式', link: '/cs-basics/06-系统设计与分布式' },
          ]
        },
      ],
      "/document/canvas/": [
        {
          collapsed: false,
          text: '基本绘制',
          link: '/document/canvas/canvas'
        },
        {
          collapsed: false,
          text: '小游戏',
          items: [
            { text: '贪吃蛇', link: '/document/canvas/snake' },
            { text: '飞机游戏', link: '/document/canvas/aircraft' },
            { text: '砖块游戏', link: '/document/canvas/breakout' },
            { text: '扫雷游戏', link: '/document/canvas/minesweeper' },
            { text: '俄罗斯方块游戏', link: '/document/canvas/tetris' },
          ]
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/github-wangsong/mfxgy.git' }
    ],
    search: {
      provider: "local",
    },
    footer: {
      message: "",
      copyright: "@mfxgy",
    },
  },
  vite: {
    build: {
      emptyOutDir: true, // 构建前清空输出目录
    },
    resolve: {
      dedupe: ['vue'],
    },
    server: {
      fs: {
        // 本地 file: 依赖可能指向 mfxgy 根目录之外的组件库
        allow: [mfxgyRoot, workspaceRoot],
      },
    },
    plugins: [demoblockVitePlugin()]
  },
  markdown: {
    config: (md) => {
      md.use(demoblockPlugin)
      md.use(containerPreview)
      md.use(componentPreview)

      // 行内代码里的 `{{ }}`（如 JSX 的 style={{ ... }}）会被 Vue 当成插值表达式解析，
      // 导致构建报错。这里给所有行内代码加上 v-pre，让 Vue 跳过编译、原样输出。
      const codeInline = md.renderer.rules.code_inline
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
        tokens[idx].attrSet('v-pre', '')
        return codeInline(tokens, idx, options, env, self)
      }
    },
    image: {
      // 开启图片懒加载
      lazyLoading: true
    },
    //行号显示
    lineNumbers: true,
    toc: {level: [1,2,3,4,5,6]},
  },
  optimizeDeps: {
    include: ['pdf'],
    exclude: [],
  },
  // 教程笔记中会引用本地开发服务器地址（localhost:3000 / localhost:8000）
  // 以及仓库根 docs/ 下的说明性链接，这些都不是站内页面，跳过死链检查。
  ignoreDeadLinks: [
    /^https?:\/\/localhost/,
    /^\.\/docs\//,
  ],
})
