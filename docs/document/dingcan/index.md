# 🍜 扫码点餐系统 · 全栈开发教程

> 本教程面向**前端开发小白**，从零开始学会独立开发一个包含前端、后端、数据库的完整全栈项目。
> 阅读完本文，你将掌握：**MySQL 数据库设计 → Java Spring Boot 后端 → Nuxt 3 管理端 → UniApp 小程序前端** 的完整开发链路。

---

## 目录

1. [项目架构总览](#1-项目架构总览)
2. [开发环境准备](#2-开发环境准备)
3. [数据库设计（MySQL）](#3-数据库设计mysql)
4. [后端开发（Spring Boot + Java）](#4-后端开发spring-boot--java)
5. [管理端开发（Nuxt 3）](#5-管理端开发nuxt-3)
6. [用户端开发（UniApp）](#6-用户端开发uniapp)
7. [前后端联调](#7-前后端联调)
8. [常见问题 FAQ](#8-常见问题-faq)

---

## 1. 项目架构总览

```
┌─────────────────────────────────────────────────────┐
│                   扫码点餐系统                        │
├──────────────┬──────────────┬───────────────────────┤
│  用户端       │  管理端       │  后端 API              │
│  UniApp      │  Nuxt 3      │  Spring Boot          │
│  微信小程序   │  Web 后台    │  REST API             │
├──────────────┴──────────────┴───────────────────────┤
│                   MySQL 数据库                        │
└─────────────────────────────────────────────────────┘
```

### 各模块职责

| 模块 | 技术 | 职责 |
|------|------|------|
| `frontend/` | UniApp + Vue 3 | 用户扫码点餐、查看订单状态 |
| `admin/` | Nuxt 3 + Element Plus | 商家管理菜品、处理订单 |
| `backend/` | Spring Boot + MyBatis | 提供 RESTful API 接口 |
| `sql/` | MySQL | 存储所有业务数据 |

### 数据流向

```
用户扫二维码
    ↓
UniApp 读取桌台ID
    ↓
调用 Spring Boot API
    ↓
Spring Boot 查询 MySQL
    ↓
返回菜单数据给 UniApp
    ↓
用户下单 → 写入数据库
    ↓
Nuxt 管理端读取新订单
    ↓
商家处理订单
```

---

## 2. 开发环境准备

### 2.1 必须安装的软件

| 软件 | 版本要求 | 下载地址 | 用途 |
|------|---------|---------|------|
| JDK | 17 或以上 | https://adoptium.net | 运行 Java 代码 |
| Maven | 3.8+ | https://maven.apache.org | Java 项目构建工具 |
| Node.js | 18+ | https://nodejs.org | 运行 JS 工具链 |
| MySQL | 8.0+ | https://dev.mysql.com | 数据库 |
| HBuilderX | 最新版 | https://www.dcloud.io/hbuilderx.html | UniApp 开发工具 |
| IntelliJ IDEA | Community | https://www.jetbrains.com | Java 开发 IDE（可选）|

### 2.2 验证安装

打开命令行，逐一验证：

```bash
# 验证 Java
java -version
# 输出：java version "17.x.x" 即为成功

# 验证 Maven
mvn -version
# 输出：Apache Maven 3.x.x 即为成功

# 验证 Node.js
node -v
# 输出：v18.x.x 即为成功

# 验证 MySQL（需要先启动 MySQL 服务）
mysql -u root -p
# 输入密码后进入 mysql> 提示符即为成功
```

### 2.3 项目目录结构

```
dingcan/
├── sql/            ← 数据库脚本
│   └── init.sql
├── backend/        ← Spring Boot 后端（Java）
├── admin/          ← Nuxt 3 管理端（Node.js）
├── frontendX/      ← UniApp 用户端（HBuilderX 项目）
├── TUTORIAL.md     ← 本教程
└── README.md       ← 快速启动说明
```

---

## 3. 数据库设计（MySQL）

### 3.1 什么是数据库设计？

数据库设计就是**规划数据如何存储**。就像设计一个 Excel 表格：先想好有哪些表（sheet），每张表有哪些列（字段），表与表之间的关联关系。

### 3.2 本项目的 6 张表

```
restaurant_table  餐桌信息
      ↓ 1 对多
    order         订单（每桌可有多个订单）
      ↓ 1 对多
  order_item      订单详情（每个订单包含多道菜）
      ↓ 多对1
     dish         菜品
      ↓ 多对1
   category       菜品分类

     user         微信用户（独立，通过 userId 关联订单）
```

### 3.3 建表 SQL 详解

```sql
-- ============================================
-- 核心概念：
-- PRIMARY KEY  主键，每行的唯一标识符
-- AUTO_INCREMENT 自动递增，不需要手动填写
-- NOT NULL     该字段不能为空
-- DEFAULT      字段的默认值
-- FOREIGN KEY  外键，建立表与表之间的关联
-- ============================================

-- 菜品分类表（最简单，无外键依赖）
CREATE TABLE category (
  id         INT PRIMARY KEY AUTO_INCREMENT,  -- 主键，自动编号：1, 2, 3...
  name       VARCHAR(50) NOT NULL,            -- 分类名，最多50个字符
  sort_order INT DEFAULT 0,                   -- 排序，数字越小越靠前
  is_active  TINYINT DEFAULT 1               -- 是否启用：1=是，0=否
);

-- 菜品表（依赖分类表）
CREATE TABLE dish (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  category_id  INT NOT NULL,               -- 关联 category 表的 id
  name         VARCHAR(100) NOT NULL,
  price        DECIMAL(10, 2) NOT NULL,    -- 价格，如 38.00（10位数字，2位小数）
  is_available TINYINT DEFAULT 1,          -- 是否上架
  
  -- 外键约束：category_id 必须是 category 表中存在的 id
  FOREIGN KEY (category_id) REFERENCES category(id)
);

-- 订单表
CREATE TABLE `order` (                     -- order 是 MySQL 关键字，要加反引号
  id           INT PRIMARY KEY AUTO_INCREMENT,
  order_no     VARCHAR(32) UNIQUE NOT NULL, -- 订单编号，全局唯一
  table_id     INT NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  status       TINYINT DEFAULT 0,          -- 0=待确认 1=制作中 2=已上菜 3=已结账
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 创建时自动填入当前时间
  
  FOREIGN KEY (table_id) REFERENCES restaurant_table(id)
);
```

> 💡 **小白提示**：`DECIMAL(10, 2)` 表示总共 10 位数字、其中 2 位是小数。用于金额字段，比 `FLOAT` 更精确，不会有浮点误差。

### 3.4 初始化数据库

```bash
# 在命令行执行，会创建数据库、建表、插入测试数据
mysql -u root -p123456 --default-character-set=UTF-8 < sql/init.sql

# 验证是否成功
mysql -u root -p123456 -e "USE dingcan; SHOW TABLES;"
# 应该看到 6 张表的列表
```

---

## 4. 后端开发（Spring Boot + Java）

### 4.1 Spring Boot 是什么？

Spring Boot 是 Java 最主流的 Web 框架，让你快速搭建 RESTful API 服务。
- 你写一个函数，它自动变成一个 HTTP 接口
- 数据库查询、参数校验、错误处理都有现成方案

### 4.2 Maven 项目结构

```
backend/
├── pom.xml                    ← 项目配置文件（类似 package.json）
└── src/main/java/com/dingcan/
    ├── DingcanApplication.java ← 程序入口（main 方法）
    ├── entity/                 ← 数据实体（对应数据库表）
    ├── mapper/                 ← 数据库操作接口
    ├── service/                ← 业务逻辑层
    ├── controller/             ← HTTP 接口层
    └── config/                 ← 配置类
```

> 💡 **MVC 三层架构**（后端最重要的设计思路）：
> - **Controller**：接收 HTTP 请求，调用 Service
> - **Service**：处理业务逻辑（如：计算总价）
> - **Mapper**：操作数据库（SQL 查询）

### 4.3 pom.xml 依赖管理

```xml
<!-- pom.xml 相当于 Java 的 package.json -->
<dependencies>
    <!-- Spring Web：提供 HTTP 接口能力 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    
    <!-- MyBatis-Plus：数据库操作 ORM 框架 -->
    <!-- ORM = Object-Relational Mapping，将数据库行自动转换为 Java 对象 -->
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
        <version>3.5.7</version>
    </dependency>
    
    <!-- MySQL 驱动：Java 与 MySQL 通信的桥梁 -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-j</artifactId>
    </dependency>
    
    <!-- Lombok：自动生成 getter/setter，减少重复代码 -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
    </dependency>
</dependencies>
```

### 4.4 配置文件 application.yml

```yaml
# src/main/resources/application.yml
server:
  port: 8888   # 服务启动端口

spring:
  datasource:
    # JDBC URL 格式：jdbc:mysql://主机:端口/数据库名?参数
    url: jdbc:mysql://localhost:3306/dingcan?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai
    username: root
    password: 123456   # 改成你的密码
    driver-class-name: com.mysql.cj.jdbc.Driver

mybatis-plus:
  configuration:
    # 自动将数据库下划线字段映射到 Java 驼峰字段
    # 例如：category_id → categoryId
    map-underscore-to-camel-case: true
```

### 4.5 实体类（Entity）

```java
// 实体类 = 数据库表的 Java 对应
// 每个字段对应表的一列
@Data                          // Lombok：自动生成 getter/setter/toString
@TableName("dish")             // MyBatis-Plus：指定对应的数据库表名
public class Dish {

    @TableId(type = IdType.AUTO)  // 标记主键，且为自增
    private Integer id;
    
    private Integer categoryId;   // 对应 category_id 列（自动映射驼峰）
    private String name;
    private BigDecimal price;      // 用 BigDecimal 存金额，避免浮点精度问题
    private Integer isAvailable;
    private LocalDateTime createdAt;
}
```

> 💡 **为什么不用 double 存金额？**
> `double price = 0.1 + 0.2` 在计算机中等于 `0.30000000000000004`，不精确！
> `BigDecimal` 专门为金融计算设计，精度完全可控。

### 4.6 Mapper 接口（数据库操作）

```java
// Mapper = 数据库查询接口
// 继承 BaseMapper 后，自动获得 insert/delete/update/select 等基础方法
@Mapper
public interface DishMapper extends BaseMapper<Dish> {
    
    // BaseMapper 已经提供的方法（无需自己写）：
    // int insert(Dish dish)              → INSERT INTO dish ...
    // int deleteById(Integer id)         → DELETE FROM dish WHERE id = ?
    // int updateById(Dish dish)          → UPDATE dish SET ... WHERE id = ?
    // Dish selectById(Integer id)        → SELECT * FROM dish WHERE id = ?
    // List<Dish> selectList(wrapper)     → SELECT * FROM dish WHERE ...
    
    // 如果需要自定义 SQL，用 @Select 注解
    @Select("SELECT d.*, c.name AS categoryName " +
            "FROM dish d LEFT JOIN category c ON d.category_id = c.id " +
            "WHERE d.id = #{id}")
    DishWithCategory findWithCategory(Integer id);
}
```

### 4.7 Service 层（业务逻辑）

```java
// Service 层处理业务逻辑
// 继承 IService 后，自动获得 save/update/remove/list 等方法
@Service
public class DishServiceImpl extends ServiceImpl<DishMapper, Dish>
        implements DishService {

    // 查询某分类下的上架菜品（使用 Lambda 条件构造器）
    public List<Dish> listAvailableDishes(Integer categoryId) {
        // LambdaQueryWrapper：构建 WHERE 条件，类型安全
        LambdaQueryWrapper<Dish> wrapper = new LambdaQueryWrapper<Dish>()
            .eq(Dish::getIsAvailable, 1)               // WHERE is_available = 1
            .eq(categoryId != null,                     // 如果传了分类ID，才加这个条件
                Dish::getCategoryId, categoryId)        // AND category_id = ?
            .orderByAsc(Dish::getSortOrder);            // ORDER BY sort_order ASC

        return list(wrapper);  // 执行查询
    }
}
```

### 4.8 Controller 层（HTTP 接口）

```java
// Controller = HTTP 接口的入口
@RestController              // 标记为 REST API 控制器
@RequestMapping("/api/dishes")  // 所有接口路径都以 /api/dishes 开头
public class DishController {

    @Autowired  // Spring 自动注入依赖（不需要手动 new）
    private DishService dishService;

    // GET /api/dishes → 获取所有上架菜品
    @GetMapping
    public Result<List<Dish>> listDishes(
            @RequestParam(required = false) Integer categoryId) {
        // @RequestParam：获取 URL 参数，如 ?categoryId=1
        return Result.ok(dishService.listAvailableDishes(categoryId));
    }

    // GET /api/dishes/5 → 获取 ID 为 5 的菜品
    @GetMapping("/{id}")
    public Result<Dish> getDishById(@PathVariable Integer id) {
        // @PathVariable：获取路径中的变量 {id}
        Dish dish = dishService.getById(id);
        if (dish == null) {
            return Result.notFound("菜品不存在");
        }
        return Result.ok(dish);
    }

    // POST /api/dishes → 创建新菜品（需要传 JSON 请求体）
    @PostMapping
    public Result<String> createDish(@Valid @RequestBody Dish dish) {
        // @RequestBody：从请求体中解析 JSON 为 Java 对象
        // @Valid：触发参数校验（如 @NotNull @Min 等注解）
        dishService.save(dish);
        return Result.ok("创建成功");
    }
}
```

### 4.9 统一响应格式

```java
// 所有接口都返回这个统一格式，前端方便处理
public class Result<T> {
    private int code;       // 200=成功，500=失败
    private String message; // 提示信息
    private T data;         // 实际数据（泛型，可以是任何类型）
    
    // 工厂方法，使用方便
    public static <T> Result<T> ok(T data) {
        return new Result<>(200, "操作成功", data);
    }
    
    public static <T> Result<T> fail(String message) {
        return new Result<>(500, message, null);
    }
}

// 前端收到的 JSON：
// { "code": 200, "message": "操作成功", "data": [...] }
```

### 4.10 启动后端

```bash
cd backend

# 方式一：Maven 命令行启动
mvn spring-boot:run

# 方式二：打包后运行
mvn package -DskipTests
java -jar target/dingcan-backend-1.0.0.jar

# 验证是否启动成功：打开浏览器访问
# http://localhost:8888/swagger-ui.html
# 能看到 Swagger API 文档界面即为成功
```

---

## 5. 管理端开发（Nuxt 3）

### 5.1 Nuxt 3 是什么？

Nuxt 3 是基于 Vue 3 的全栈框架，最大特点是**服务端渲染（SSR）**：
- 页面在服务器上渲染好 HTML，再发给浏览器（更快、利于 SEO）
- 内置 **server/api/** 目录，可以直接写后端接口
- 管理端直接从 `server/api/` 连接 MySQL，不需要单独部署 Java 后端

### 5.2 Nuxt 目录结构

```
admin/
├── nuxt.config.ts       ← 框架配置
├── .env                 ← 环境变量（数据库密码等）
├── pages/               ← 页面文件（自动注册路由）
│   ├── index.vue        → 对应 http://localhost:3000/
│   ├── login.vue        → 对应 http://localhost:3000/login
│   └── orders/
│       └── index.vue    → 对应 http://localhost:3000/orders
├── layouts/             ← 布局模板（如侧边栏）
├── server/api/          ← 服务端 API（直接运行在 Node.js，可访问数据库）
│   ├── dishes/
│   │   ├── index.get.ts ← GET /api/dishes
│   │   └── index.post.ts← POST /api/dishes
│   └── orders/
│       └── index.get.ts ← GET /api/orders
├── server/utils/
│   └── db.ts            ← 数据库连接工具
└── middleware/
    └── auth.global.ts   ← 全局路由守卫（登录验证）
```

> 💡 **文件命名规则**：
> - `index.get.ts` → 处理 GET 请求
> - `index.post.ts` → 处理 POST 请求
> - `[id].put.ts` → 处理 PUT /api/dishes/5 请求（[id] 是动态参数）
> - `[id].delete.ts` → 处理 DELETE 请求

### 5.3 数据库连接（server/utils/db.ts）

```typescript
// Nuxt 管理端直接用 mysql2 连接数据库，不经过 Java 后端
import mysql from 'mysql2/promise'

// 创建连接池（池 = 多个预先创建好的连接，复用而不是每次重新建立）
const pool = mysql.createPool({
    host:     process.env.DB_HOST || 'localhost',
    port:     3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'dingcan',
    connectionLimit: 10,  // 最多同时 10 个连接
})

// 通用查询函数（SELECT 用这个）
export async function query<T>(sql: string, params?: any[]): Promise<T[]> {
    const [rows] = await pool.query(sql, params)  // params 自动转义，防 SQL 注入
    return rows as T[]
}

// 通用执行函数（INSERT/UPDATE/DELETE 用这个）
export async function execute(sql: string, params?: any[]) {
    const [result] = await pool.query(sql, params)
    return result as mysql.ResultSetHeader
    // ResultSetHeader 包含：insertId（新增行ID）、affectedRows（影响行数）
}
```

### 5.4 服务端 API 示例

```typescript
// server/api/dishes/index.get.ts
// 这个文件自动对应 GET /api/dishes 接口

export default defineEventHandler(async (event) => {
    // 1. 验证登录（每个需要保护的接口都要调用）
    requireAuth(event)
    
    // 2. 获取 URL 查询参数
    const { categoryId, page = '1', pageSize = '20' } = getQuery(event)
    
    // 3. 查询数据库
    const dishes = await query(`
        SELECT d.*, c.name AS categoryName
        FROM dish d
        LEFT JOIN category c ON d.category_id = c.id
        WHERE d.is_available = 1
        ${categoryId ? 'AND d.category_id = ?' : ''}
        ORDER BY d.sort_order ASC
        LIMIT ${parseInt(pageSize as string)} OFFSET ${(parseInt(page as string) - 1) * parseInt(pageSize as string)}
    `, categoryId ? [categoryId] : [])
    
    // 4. 返回数据（Nuxt 自动序列化为 JSON）
    return dishes
})
```

```typescript
// server/api/dishes/[id].put.ts
// 对应 PUT /api/dishes/5

export default defineEventHandler(async (event) => {
    requireAuth(event)
    
    // 从 URL 路径中获取 id（对应文件名中的 [id]）
    const id = getRouterParam(event, 'id')
    
    // 从请求体获取数据
    const body = await readBody(event)
    const { name, price, isAvailable } = body
    
    await execute(
        'UPDATE dish SET name = ?, price = ?, is_available = ? WHERE id = ?',
        [name, price, isAvailable, id]
    )
    
    return { message: '更新成功' }
})
```

### 5.5 页面开发（Vue 3 + Element Plus）

```vue
<!-- pages/orders/index.vue -->
<template>
  <div>
    <!-- Element Plus 表格组件 -->
    <el-table :data="orders" v-loading="loading">
      <el-table-column prop="orderNo" label="订单号" />
      <el-table-column prop="tableNumber" label="桌台" />
      <el-table-column prop="totalAmount" label="金额">
        <!-- 自定义列内容 -->
        <template #default="{ row }">
          ¥{{ row.totalAmount }}
        </template>
      </el-table-column>
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button @click="handleOrder(row.id, 1)">接单</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

const loading = ref(false)
const orders = ref([])

// 获取订单列表
async function fetchOrders() {
    loading.value = true
    try {
        // $fetch 是 Nuxt 内置的请求工具，会自动处理 Cookie（登录状态）
        orders.value = await $fetch('/api/orders')
    } catch (err) {
        ElMessage.error('获取订单失败')
    } finally {
        loading.value = false
    }
}

// 更新订单状态
async function handleOrder(orderId: number, status: number) {
    await $fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        body: { status }
    })
    ElMessage.success('操作成功')
    await fetchOrders()  // 刷新列表
}

// 组件挂载后自动加载数据
onMounted(fetchOrders)
</script>
```

### 5.6 全局路由守卫（登录保护）

```typescript
// middleware/auth.global.ts
// 文件名含 .global 表示对所有路由生效

export default defineNuxtRouteMiddleware((to) => {
    // 登录页不需要验证，直接放行
    if (to.path === '/login') return
    
    // useCookie 是 Nuxt 内置 API，读取名为 admin_token 的 Cookie
    const token = useCookie('admin_token')
    
    // 没有 token 则跳转到登录页
    if (!token.value) {
        return navigateTo('/login')
    }
})
```

### 5.7 启动管理端

```bash
cd admin

# 安装依赖
npm install

# 复制并修改环境变量
# 编辑 .env 文件，填写数据库密码

# 开发模式启动（热更新）
npm run dev
# 访问 http://localhost:3000
# 默认密码：admin123（在 .env 中修改）
```

---

## 6. 用户端开发（UniApp）

### 6.1 UniApp 是什么？

UniApp 是**一套代码，多端运行**的框架：
- 写一套 Vue 代码
- 可以发布到：微信小程序、支付宝小程序、H5 网页、App 等
- 使用 HBuilderX 作为开发工具（不是 VS Code）

### 6.2 UniApp vs 普通 Vue 的区别

| 普通 Vue | UniApp |
|---------|--------|
| `<div>` 标签 | `<view>` 标签 |
| `<span>/<p>` | `<text>` 标签 |
| CSS `px` | `rpx`（响应式像素，750rpx = 屏幕宽度）|
| `window.location` | `uni.navigateTo()` |
| `axios` | `uni.request()` |
| `mounted()` | `onLoad()` / `onShow()` |
| Vue Router | `pages.json` 配置路由 |

### 6.3 pages.json 路由配置

```json
{
    "pages": [
        {
            "path": "pages/index/index",
            "style": {
                "navigationBarTitleText": "扫码点餐"
            }
        },
        {
            "path": "pages/menu/index",
            "style": {
                "navigationBarTitleText": "菜单"
            }
        }
    ]
}
```

> ⚠️ **重要**：每次新增页面都要在 `pages.json` 里注册，否则无法导航！修改后需要**重新编译**（不是刷新）。

### 6.4 页面生命周期

```vue
<script setup>
import { ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'

// onLoad：页面加载时触发一次（类似 Vue 的 mounted）
// 可以获取页面传入的参数
onLoad((options) => {
    // options 是路由参数
    // 如：navigateTo({ url: '/pages/menu/index?tableId=1' })
    // 则 options = { tableId: '1' }
    console.log('表台ID:', options.tableId)
})

// onShow：页面显示时触发（每次切回该页面都会触发）
onShow(() => {
    console.log('页面显示了')
})

// onUnload：页面卸载时触发（离开页面时清理资源）
onUnload(() => {
    // 清除定时器、取消请求等
})
</script>
```

### 6.5 封装 HTTP 请求

```javascript
// utils/request.js
// 封装 uni.request，统一处理错误和响应格式

import config from './config.js'

export function get(url, params = {}) {
    // 将参数对象转为 URL 查询字符串
    // { tableId: 1 } → '?tableId=1'
    const queryStr = Object.entries(params)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    
    return request(queryStr ? `${url}?${queryStr}` : url, 'GET')
}

export function post(url, data) {
    return request(url, 'POST', data)
}

function request(url, method, data = {}) {
    return new Promise((resolve, reject) => {
        uni.request({
            url: config.BASE_URL + url,
            method,
            data,
            header: { 'Content-Type': 'application/json' },
            success: (res) => {
                // 统一处理业务响应
                if (res.data.code === 200) {
                    resolve(res.data.data)  // 只返回 data 字段
                } else {
                    uni.showToast({ title: res.data.message, icon: 'none' })
                    reject(new Error(res.data.message))
                }
            },
            fail: (err) => {
                uni.showToast({ title: '网络错误', icon: 'none' })
                reject(err)
            }
        })
    })
}
```

### 6.6 状态管理（购物车）

```javascript
// store/cart.js
// 用 Vue 3 的 reactive 管理全局状态（替代 Pinia）
// .js 文件必须显式 import，不像 .vue 文件有自动注入

import { reactive } from 'vue'

// module 级别的单例，整个 App 生命周期只有一份
const store = reactive({
    items: [],       // 购物车菜品列表
    tableId: null,   // 当前桌台ID
    tableNumber: '', // 当前桌号
    
    // getter 属性：像函数一样计算，但像属性一样访问
    get totalAmount() {
        return this.items.reduce(
            (sum, item) => sum + item.price * item.quantity, 0
        )
    },
    
    get isEmpty() {
        return this.items.length === 0
    }
})

// 暴露操作方法
function addItem(dish) {
    const existing = store.items.find(i => i.id === dish.id)
    if (existing) {
        existing.quantity += 1
    } else {
        store.items.push({ ...dish, quantity: 1 })
    }
}

// Hook 函数：在组件中使用
export function useCartStore() {
    return {
        get items()        { return store.items },
        get tableId()      { return store.tableId },
        get totalAmount()  { return store.totalAmount },
        get isEmpty()      { return store.isEmpty },
        setTable: (id, name) => { store.tableId = id; store.tableNumber = name },
        addItem,
        removeItem: (id) => { /* ... */ },
        clearCart: () => { store.items.splice(0) }
    }
}
```

### 6.7 典型页面开发：菜单页

```vue
<template>
  <view class="menu-page">
    <!-- 左侧分类导航 -->
    <scroll-view scroll-y class="category-nav">
      <view
        v-for="cat in categories"
        :key="cat.id"
        :class="['cat-item', activeCategoryId === cat.id ? 'active' : '']"
        @tap="activeCategoryId = cat.id"
      >
        {{ cat.name }}
      </view>
    </scroll-view>
    
    <!-- 右侧菜品列表 -->
    <scroll-view scroll-y class="dish-list">
      <view v-for="dish in currentDishes" :key="dish.id" class="dish-item">
        <image :src="dish.imageUrl" mode="aspectFill" class="dish-img" />
        <view class="dish-info">
          <text class="dish-name">{{ dish.name }}</text>
          <text class="dish-price">¥{{ dish.price }}</text>
        </view>
        <!-- 加减按钮 -->
        <view class="add-btn" @tap="cartStore.addItem(dish)">+</view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { get } from '@/utils/request.js'
import { useCartStore } from '@/store/cart.js'

const cartStore = useCartStore()
const categories = ref([])
const dishes = ref([])
const activeCategoryId = ref(null)

// 当前分类的菜品（计算属性，自动响应 activeCategoryId 变化）
const currentDishes = computed(() => {
    return dishes.value.filter(d => 
        (d.categoryId ?? d.category_id) === activeCategoryId.value
    )
})

onLoad(async (options) => {
    // 并行请求：两个接口同时发起，节省时间
    const [cats, dishList] = await Promise.all([
        get('/api/categories'),
        get('/api/dishes')
    ])
    
    categories.value = cats
    dishes.value = dishList
    
    // 默认选中第一个分类
    if (cats.length > 0) activeCategoryId.value = cats[0].id
})
</script>
```

### 6.8 页面导航

```javascript
// UniApp 提供四种页面跳转方式

// 1. navigateTo：跳转到新页面，有返回按钮
uni.navigateTo({ url: '/pages/menu/index?tableId=1' })

// 2. redirectTo：替换当前页（无返回按钮，适合登录后跳转）
uni.redirectTo({ url: '/pages/menu/index' })

// 3. reLaunch：关闭所有页面，打开新页面（最彻底）
uni.reLaunch({ url: '/pages/index/index' })

// 4. navigateBack：返回上一页
uni.navigateBack()
```

### 6.9 rpx 单位说明

```css
/* rpx = responsive pixel（响应式像素）*/
/* 设计稿以 750px 宽度为基准 */
/* 在不同屏幕上自动缩放，保持视觉一致性 */

.button {
    width: 375rpx;   /* 占屏幕宽度的一半 */
    height: 80rpx;   /* 在 iPhone 6 上约等于 40px */
    font-size: 28rpx;
    border-radius: 40rpx;
}

/* 对比：px 是固定像素，在不同屏幕密度下显示不一样 */
/* 结论：UniApp 开发统一用 rpx，不用 px */
```

---

## 7. 前后端联调

### 7.1 接口规范约定

本项目 Spring Boot 接口统一返回格式：

```json
{
    "code": 200,
    "message": "操作成功",
    "data": { "具体数据": "在这里" }
}
```

前端拿到 `res.data.data` 才是真正的数据。

### 7.2 字段命名规则

| 层 | 规则 | 示例 |
|----|------|------|
| MySQL 列名 | 下划线 | `category_id` |
| Java 字段 | 驼峰 | `categoryId` |
| JSON（接口返回）| 驼峰 | `categoryId` |
| 前端 JS 变量 | 驼峰 | `categoryId` |

> ⚠️ **常见坑**：前端直接用 `item.category_id` 会是 `undefined`，要用 `item.categoryId`！

### 7.3 跨域问题（CORS）

前端（`localhost:8080`）调用后端（`localhost:8888`）时，浏览器会拦截请求，报 CORS 错误。
解决方法是在 Spring Boot 配置允许跨域：

```java
// config/CorsConfig.java
@Configuration
public class CorsConfig {
    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        config.addAllowedOriginPattern("*");   // 允许所有来源（开发环境）
        config.addAllowedMethod("*");           // 允许所有方法
        config.addAllowedHeader("*");           // 允许所有请求头
        config.setAllowCredentials(true);       // 允许携带 Cookie
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }
}
```

### 7.4 完整启动顺序

```bash
# 第一步：确保 MySQL 服务已启动

# 第二步：启动 Spring Boot 后端（8888 端口）
cd backend && mvn spring-boot:run

# 第三步：启动 Nuxt 管理端（3000 端口）
cd admin && npm run dev

# 第四步：在 HBuilderX 打开 frontendX 项目，运行到浏览器（8080 端口）

# 访问地址：
# 管理端：http://localhost:3000   密码：admin123
# 用户端：http://localhost:8080
# API文档：http://localhost:8888/swagger-ui.html
```

---

## 8. 常见问题 FAQ

### Q1：Spring Boot 启动报 `Unsupported character encoding 'utf8mb4'`

**原因**：JDBC URL 里写的 `utf8mb4` 是 MySQL 的叫法，Java 不认识。

**解决**：将 `characterEncoding=utf8mb4` 改为 `characterEncoding=UTF-8`

---

### Q2：前端调接口返回数据，但页面不显示

**原因**：字段名不匹配，如后端返回 `categoryId`，前端用 `category_id` 取值。

**解决**：打开浏览器 F12 控制台，`console.log(data)` 查看实际字段名。

---

### Q3：`uni.navigateTo` 报 `Cannot read properties of undefined (reading 'push')`

**原因**：HBuilderX H5 模式下，在 async 函数里直接调用路由 API 可能失败。

**解决**：用 `await nextTick()` 等待渲染后再跳转，或改用 `uni.reLaunch`。

---

### Q4：Nuxt 管理端接口报 401 Unauthorized

**原因**：没有登录，Cookie 中没有 `admin_token`。

**解决**：先访问 `http://localhost:3000/login`，输入密码 `admin123` 登录。

---

### Q5：`ref is not defined` / `onLoad is not defined`

**原因**：HBuilderX 这个版本不自动注入这些 API。

**解决**：在文件顶部显式 import：
```javascript
import { ref, computed } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
```

---

### Q6：数据库连接报 `Unknown database 'dingcan'`

**原因**：`dingcan` 数据库还没有创建。

**解决**：执行初始化脚本：
```bash
mysql -u root -p123456 --default-character-set=UTF-8 < sql/init.sql
```

---

### Q7：MyBatis 查询返回 null，但数据库里有数据

**原因**：`application.yml` 没有配置 `map-underscore-to-camel-case: true`，导致数据库 `category_id` 无法映射到 Java 的 `categoryId`。

**解决**：在 `application.yml` 的 `mybatis-plus.configuration` 下添加：
```yaml
map-underscore-to-camel-case: true
```

---

## 总结：全栈项目开发流程

```
1. 需求分析
   └── 画出功能模块图、用户操作流程

2. 数据库设计
   └── 分析业务，设计表结构，定义字段类型和关联关系

3. 后端 API 开发（Spring Boot）
   └── Entity（实体） → Mapper（数据库）→ Service（业务）→ Controller（接口）

4. 管理端开发（Nuxt）
   └── server/api/（数据接口）→ pages/（页面组件）→ 联调测试

5. 用户端开发（UniApp）
   └── pages.json（路由）→ 页面组件 → 请求封装 → 状态管理

6. 联调测试
   └── 接口调试（Swagger/Postman）→ 前后端字段名对齐 → 功能测试

7. 部署上线
   └── 打包 → 服务器部署 → 域名配置 → HTTPS 证书
```

---

> 📚 **延伸学习资源**
> - MySQL 教程：https://www.runoob.com/mysql/mysql-tutorial.html
> - Spring Boot 官方文档：https://spring.io/projects/spring-boot
> - MyBatis-Plus 文档：https://baomidou.com
> - Nuxt 3 文档：https://nuxt.com/docs
> - UniApp 文档：https://uniapp.dcloud.net.cn
> - Vue 3 文档：https://cn.vuejs.org

---

## 进阶篇 A：MySQL 深度学习

### A.1 数据类型选择指南

选错类型会导致存储浪费或精度丢失，以下是常用类型速查：

```sql
-- 整数类型（从小到大）
TINYINT    -- 1字节，范围 -128 ~ 127，适合状态字段（0/1/2）
SMALLINT   -- 2字节，范围 -32768 ~ 32767
INT        -- 4字节，范围约 ±21亿，适合普通 ID
BIGINT     -- 8字节，适合雪花ID等大数字

-- 小数类型
DECIMAL(10, 2)   -- 精确小数，10位总长2位小数，金额必用！
FLOAT / DOUBLE   -- 浮点数，有精度误差，不能用于金额

-- 字符串类型
CHAR(10)         -- 固定长度，不足补空格，适合固定格式（如手机号）
VARCHAR(100)     -- 可变长度，按实际长度存储，最常用
TEXT             -- 长文本（最大65535字节），适合文章内容

-- 时间类型
DATE             -- 只存日期：2024-01-01
TIME             -- 只存时间：12:30:00
DATETIME         -- 日期+时间：2024-01-01 12:30:00，不受时区影响
TIMESTAMP        -- 同上，但会转换为UTC存储，范围到2038年

-- 布尔（MySQL没有真正的布尔类型）
TINYINT(1)       -- 约定用 0=false 1=true
```

### A.2 索引——让查询飞起来

```sql
-- 什么是索引？类比书的目录：没有目录要翻全书，有目录直接翻到页码

-- 主键索引（自动创建）
PRIMARY KEY (id)

-- 唯一索引：保证字段值全局唯一，同时加速查询
CREATE UNIQUE INDEX uk_order_no ON `order`(order_no);
-- 等价写法：UNIQUE KEY uk_order_no (order_no)

-- 普通索引：加速查询，允许重复值
CREATE INDEX idx_category_id ON dish(category_id);
-- 等价写法：KEY idx_category_id (category_id)

-- 联合索引：多个字段组合
CREATE INDEX idx_table_status ON `order`(table_id, status);
-- 注意：联合索引遵循"最左前缀原则"
-- 上面的索引对 WHERE table_id=? 有效
-- 对 WHERE table_id=? AND status=? 有效
-- 对 WHERE status=? 单独查询无效（没用到最左列）

-- 查看表的索引
SHOW INDEX FROM dish;

-- 分析查询是否使用了索引（EXPLAIN 是性能调优必用命令）
EXPLAIN SELECT * FROM dish WHERE category_id = 1;
-- 看 key 列：有值说明用了索引，NULL 说明全表扫描（性能差）
```

### A.3 JOIN 联表查询

```sql
-- 本项目最常用的联表查询示例

-- INNER JOIN：两表都有匹配才返回
SELECT d.name, d.price, c.name AS category_name
FROM dish d
INNER JOIN category c ON d.category_id = c.id
WHERE d.is_available = 1;

-- LEFT JOIN：左表全部返回，右表无匹配则为 NULL
-- 查询所有桌台及其当前订单（没有订单的桌台也要显示）
SELECT t.table_number, o.order_no, o.status
FROM restaurant_table t
LEFT JOIN `order` o ON t.id = o.table_id AND o.status NOT IN (3, 4);

-- 多表联查
SELECT 
    o.order_no,
    t.table_number,
    u.nickname AS customer,
    SUM(oi.subtotal) AS total
FROM `order` o
LEFT JOIN restaurant_table t ON o.table_id = t.id
LEFT JOIN user u ON o.user_id = u.id
LEFT JOIN order_item oi ON o.id = oi.order_id
WHERE o.status = 1
GROUP BY o.id
ORDER BY o.created_at DESC;
```

### A.4 事务——保证数据一致性

```sql
-- 事务：一组操作要么全部成功，要么全部回滚
-- 经典场景：下单时同时插入 order 和 order_item
-- 如果 order 插入成功但 order_item 失败，不能只有主记录没有详情

START TRANSACTION;  -- 开始事务

-- 操作1：插入订单主记录
INSERT INTO `order` (order_no, table_id, total_amount, status)
VALUES ('20240101001', 1, 88.00, 0);

-- 获取刚插入的 ID（用于下一步）
SET @order_id = LAST_INSERT_ID();

-- 操作2：插入订单详情
INSERT INTO order_item (order_id, dish_id, dish_name, price, quantity, subtotal)
VALUES (@order_id, 1, '红烧肉', 38.00, 2, 76.00);

INSERT INTO order_item (order_id, dish_id, dish_name, price, quantity, subtotal)
VALUES (@order_id, 5, '白米饭', 2.00, 6, 12.00);

-- 操作3：更新桌台状态
UPDATE restaurant_table SET status = 1 WHERE id = 1;

COMMIT;   -- 全部成功，提交事务（数据真正写入）

-- 如果中间任何一步出错：
ROLLBACK;  -- 回滚，撤销事务内所有操作
```

### A.5 常用聚合查询

```sql
-- 统计今日营业数据（管理端看板用到）

SELECT
    COUNT(*) AS total_orders,           -- 总订单数
    COUNT(DISTINCT table_id) AS tables, -- 用餐桌台数
    SUM(total_amount) AS revenue,       -- 总营业额
    AVG(total_amount) AS avg_order,     -- 客单价
    MAX(total_amount) AS max_order,     -- 最大单笔
    MIN(total_amount) AS min_order      -- 最小单笔
FROM `order`
WHERE DATE(created_at) = CURDATE()     -- 只统计今天
  AND status = 3;                       -- 只统计已结账

-- 菜品销量排行
SELECT 
    dish_name,
    SUM(quantity) AS total_qty,
    SUM(subtotal) AS total_amount
FROM order_item oi
JOIN `order` o ON oi.order_id = o.id
WHERE o.status IN (1, 2, 3)           -- 有效订单
  AND DATE(o.created_at) = CURDATE()
GROUP BY dish_name                     -- 按菜名分组
ORDER BY total_qty DESC                -- 按销量降序
LIMIT 10;                              -- 取前10名
```

---

## 进阶篇 B：Spring Boot / Java 深度学习

### B.1 Java 基础语法速查（给前端开发者）

```java
// ===== 变量声明（强类型，必须声明类型）=====
int age = 25;              // 整数
double price = 38.5;       // 浮点数（JS 只有 number）
String name = "红烧肉";    // 字符串（注意大写 S）
boolean active = true;     // 布尔值
List<String> list = new ArrayList<>();  // 列表（类似 JS 数组）

// ===== 方法（函数）定义 =====
// 格式：访问修饰符 返回类型 方法名(参数类型 参数名) { }
public String getGreeting(String name) {
    return "你好，" + name;
}

// void = 没有返回值（JS 里返回 undefined 的函数）
public void printLog(String msg) {
    System.out.println(msg);
}

// ===== 条件和循环 =====
if (price > 100) {
    System.out.println("超过100元");
} else if (price > 50) {
    System.out.println("50-100元");
}

// for each 循环（遍历集合）
for (Dish dish : dishes) {          // 类似 JS 的 for...of
    System.out.println(dish.getName());
}

// ===== 空值处理（Java 的 null 非常危险）=====
// 访问 null 对象的方法会抛 NullPointerException（最常见的 Java 错误）
String name = null;
// name.length() // ❌ 会崩溃！

// 安全写法
if (name != null) {
    System.out.println(name.length());
}
// 或使用 Optional（Java 8+）
Optional.ofNullable(name).ifPresent(n -> System.out.println(n.length()));
```

### B.2 Spring Boot 注解速查表

Spring Boot 大量使用**注解**（`@开头`）来替代 XML 配置，理解这些注解是关键：

```java
// ===== 组件注解（告诉 Spring 这个类需要被管理）=====
@Component       // 通用组件
@Service         // 业务逻辑层（语义更清晰）
@Repository      // 数据访问层
@Controller      // MVC 控制器
@RestController  // = @Controller + @ResponseBody，REST API 专用

// ===== 依赖注入 =====
@Autowired       // 自动注入依赖（Spring 帮你 new 对象并传入）
@Qualifier("beanName")  // 当有多个实现时指定注入哪个

// ===== 请求映射 =====
@RequestMapping("/api")      // 映射 URL 路径
@GetMapping("/dishes")       // 只处理 GET 请求
@PostMapping("/dishes")      // 只处理 POST 请求
@PutMapping("/dishes/{id}")  // 只处理 PUT 请求
@DeleteMapping("/{id}")      // 只处理 DELETE 请求

// ===== 参数提取 =====
@PathVariable    // 从 URL 路径提取：/dishes/{id} 中的 id
@RequestParam    // 从 URL 参数提取：/dishes?page=1 中的 page
@RequestBody     // 从请求体提取：POST 的 JSON 数据
@RequestHeader   // 从请求头提取

// ===== 数据校验 =====
@Valid           // 触发嵌套校验
@NotNull         // 不能为 null
@NotBlank        // 不能为空字符串
@Min(1)          // 最小值
@Max(999)        // 最大值
@Size(min=1, max=100)  // 字符串长度范围
@Email           // 邮箱格式

// ===== MyBatis-Plus 实体注解 =====
@TableName("dish")           // 对应的数据库表名
@TableId(type = IdType.AUTO) // 主键，自增
@TableField("create_time")   // 对应的列名（字段名不符合驼峰时用）
@TableField(exist = false)   // 标记该字段不是数据库列（只是 VO 里的附加字段）

// ===== 配置注解 =====
@Configuration   // 配置类
@Bean            // 方法返回值注册为 Spring Bean
@Value("${server.port}")  // 从 application.yml 注入值
```

### B.3 REST API 设计规范

```
好的 API 设计：URL 表示资源，HTTP 方法表示操作

资源（名词）      方法        含义
/api/dishes      GET         获取菜品列表
/api/dishes/5    GET         获取 ID=5 的菜品
/api/dishes      POST        创建新菜品
/api/dishes/5    PUT         完整更新 ID=5 的菜品
/api/dishes/5    PATCH       部分更新 ID=5 的菜品
/api/dishes/5    DELETE      删除 ID=5 的菜品

状态码含义：
200 OK           请求成功
201 Created      创建成功
400 Bad Request  请求参数错误
401 Unauthorized 未登录
403 Forbidden    无权限
404 Not Found    资源不存在
500 Internal Server Error  服务器内部错误
```

### B.4 完整的菜品 CRUD 接口

```java
@RestController
@RequestMapping("/api/dishes")
public class DishController {

    @Autowired
    private DishService dishService;
    
    @Autowired
    private CategoryMapper categoryMapper;

    // ===== 查询列表（支持分页和过滤）=====
    @GetMapping
    public Result<Map<String, Object>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) Integer categoryId,
            @RequestParam(required = false) String keyword) {

        // Page 对象：MyBatis-Plus 的分页工具
        Page<Dish> pageObj = new Page<>(page, pageSize);

        LambdaQueryWrapper<Dish> wrapper = new LambdaQueryWrapper<Dish>()
            .eq(categoryId != null, Dish::getCategoryId, categoryId)
            // LIKE 模糊查询：keyword 不为空时才加此条件
            .like(keyword != null && !keyword.isEmpty(), Dish::getName, keyword)
            .orderByAsc(Dish::getSortOrder);

        Page<Dish> result = dishService.page(pageObj, wrapper);

        // 构建返回数据
        Map<String, Object> data = new HashMap<>();
        data.put("list", result.getRecords());    // 当前页数据
        data.put("total", result.getTotal());      // 总记录数
        data.put("page", page);
        data.put("pageSize", pageSize);

        return Result.ok(data);
    }

    // ===== 查询单条 =====
    @GetMapping("/{id}")
    public Result<Dish> getById(@PathVariable Integer id) {
        Dish dish = dishService.getById(id);
        return dish != null ? Result.ok(dish) : Result.notFound("菜品不存在");
    }

    // ===== 创建 =====
    @PostMapping
    public Result<Dish> create(@Valid @RequestBody DishCreateDTO dto) {
        // 校验分类是否存在
        if (categoryMapper.selectById(dto.getCategoryId()) == null) {
            return Result.fail("分类不存在");
        }
        
        Dish dish = new Dish();
        dish.setCategoryId(dto.getCategoryId());
        dish.setName(dto.getName());
        dish.setPrice(dto.getPrice());
        dish.setIsAvailable(1);
        
        dishService.save(dish);
        return Result.ok(dish);
    }

    // ===== 更新 =====
    @PutMapping("/{id}")
    public Result<String> update(
            @PathVariable Integer id,
            @RequestBody DishUpdateDTO dto) {

        // updateById 只更新非 null 字段（需要配置）
        Dish dish = new Dish();
        dish.setId(id);
        dish.setName(dto.getName());
        dish.setPrice(dto.getPrice());
        dish.setIsAvailable(dto.getIsAvailable());

        dishService.updateById(dish);
        return Result.ok("更新成功");
    }

    // ===== 删除 =====
    @DeleteMapping("/{id}")
    public Result<String> delete(@PathVariable Integer id) {
        dishService.removeById(id);
        return Result.ok("删除成功");
    }

    // ===== 批量上/下架 =====
    @PutMapping("/batch/available")
    public Result<String> batchUpdateAvailable(
            @RequestBody Map<String, Object> body) {
        List<Integer> ids = (List<Integer>) body.get("ids");
        Integer available = (Integer) body.get("isAvailable");

        dishService.update(
            new LambdaUpdateWrapper<Dish>()
                .in(Dish::getId, ids)
                .set(Dish::getIsAvailable, available)
        );
        return Result.ok("操作成功");
    }
}
```

### B.5 全局异常处理

```java
// @RestControllerAdvice = 全局 try-catch
// 所有 Controller 里没有处理的异常，都会到这里统一处理
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    // 处理参数校验失败
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Void> handleValidation(MethodArgumentNotValidException ex) {
        // 收集所有字段的错误信息
        String errors = ex.getBindingResult().getFieldErrors()
            .stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .collect(Collectors.joining("; "));
        log.warn("参数校验失败: {}", errors);
        return Result.paramError(errors);
    }

    // 处理业务异常（自定义异常）
    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusiness(BusinessException ex) {
        log.warn("业务异常: {}", ex.getMessage());
        return Result.fail(ex.getMessage());
    }

    // 处理所有未知异常（兜底）
    @ExceptionHandler(Exception.class)
    public Result<Void> handleAll(Exception ex) {
        log.error("未知异常", ex);          // 打印完整堆栈到日志
        return Result.fail("服务器内部错误，请稍后重试");
        // 注意：不要把异常详情返回给前端，有安全风险
    }
}
```

### B.6 MyBatis-Plus 高级用法

```java
// ===== 条件构造器进阶 =====

// 动态条件（传了才加，不传不加）
LambdaQueryWrapper<Order> wrapper = new LambdaQueryWrapper<Order>()
    .eq(tableId != null, Order::getTableId, tableId)        // tableId 不为 null 才加 =
    .in(statusList != null, Order::getStatus, statusList)   // statusList 不为 null 才加 IN
    .between(startDate != null && endDate != null,          // 两个都不为 null 才加 BETWEEN
             Order::getCreatedAt, startDate, endDate)
    .orderByDesc(Order::getCreatedAt);

// 更新操作（不需要先查再改）
dishService.update(
    new LambdaUpdateWrapper<Dish>()
        .eq(Dish::getId, id)
        .set(Dish::getIsAvailable, 0)    // SET is_available = 0
        .set(Dish::getUpdatedAt, LocalDateTime.now())
);

// 批量插入（性能比循环调 insert 快很多）
List<OrderItem> items = /* ... */;
orderItemService.saveBatch(items);  // 内部会分批批量插入

// 自定义 SQL + Wrapper（复杂查询）
// 在 Mapper.java 中
@Select("SELECT o.*, t.table_number FROM `order` o " +
        "LEFT JOIN restaurant_table t ON o.table_id = t.id " +
        "${ew.customSqlSegment}")   // ${ew.customSqlSegment} 是 Wrapper 生成的 WHERE 子句
List<OrderVO> findWithTable(@Param(Constants.WRAPPER) QueryWrapper<Order> wrapper);

// 在 Service 中调用
QueryWrapper<Order> qw = new QueryWrapper<Order>()
    .eq("o.status", 1)
    .orderByDesc("o.created_at");
List<OrderVO> orders = orderMapper.findWithTable(qw);
```

### B.7 日志记录最佳实践

```java
@Service
@Slf4j  // Lombok 注解，自动创建 log 变量
public class OrderServiceImpl {

    public String createOrder(OrderCreateDTO dto) {
        // debug 级别：详细信息，只在开发时看
        log.debug("创建订单，入参：{}", dto);

        // info 级别：重要业务节点
        log.info("用户在桌台 {} 下单，共 {} 道菜", dto.getTableId(), dto.getItems().size());

        try {
            String orderNo = doCreate(dto);
            log.info("订单创建成功：{}", orderNo);
            return orderNo;
        } catch (Exception e) {
            // error 级别：需要立即关注的错误，会打印完整堆栈
            log.error("订单创建失败，桌台：{}，错误：{}", dto.getTableId(), e.getMessage(), e);
            throw e;
        }
    }
}

// 日志级别从低到高：TRACE < DEBUG < INFO < WARN < ERROR
// 生产环境通常配置 INFO 级别（过滤掉 DEBUG）
// application.yml 配置：
// logging:
//   level:
//     com.dingcan: info   # 只输出 info 及以上级别
//     root: warn          # 框架日志只输出 warn 及以上
```

---

## 进阶篇 C：Nuxt 3 深度学习

### C.1 Nuxt 3 核心概念

```
传统 Vue（CSR，客户端渲染）：
  浏览器 → 下载空 HTML → 下载 JS → JS 执行渲染页面
  问题：首屏白屏时间长，爬虫看不到内容（SEO 差）

Nuxt 3（SSR，服务端渲染）：
  浏览器 → 服务器渲染好完整 HTML → 发给浏览器直接显示
  好处：首屏更快，SEO 友好
  
Nuxt 3 的混合模式：
  - 首次访问：SSR（服务器渲染）
  - 后续页面跳转：CSR（客户端渲染）
  - 两种模式无缝切换，兼具两者优点
```

### C.2 Nuxt 3 数据获取方式对比

```typescript
// ===== 方式1：useAsyncData（推荐，支持 SSR）=====
// 在 SSR 阶段就执行，数据在服务器上准备好，发给浏览器时已有数据
const { data: dishes, pending, error, refresh } = await useAsyncData(
    'dishes',          // 唯一 key，用于缓存
    () => $fetch('/api/dishes')
)
// dishes.value 是数据
// pending.value 是 true/false（加载中）
// refresh() 重新加载

// ===== 方式2：useFetch（useAsyncData 的语法糖）=====
const { data, pending } = await useFetch('/api/dishes', {
    query: { categoryId: 1 },  // URL 参数
    method: 'GET',
    // watch: [categoryId]      // 当 categoryId 变化时自动重新请求
})

// ===== 方式3：$fetch（纯客户端用，在事件处理函数中）=====
// 在按钮点击等事件中使用（不支持 SSR）
async function handleSubmit() {
    const result = await $fetch('/api/orders', {
        method: 'POST',
        body: { tableId: 1, items: [] }
    })
}

// ===== 三者的选择原则 =====
// 页面初始数据（需要 SEO）     → useFetch / useAsyncData
// 用户操作触发的请求           → $fetch
// 需要手动控制的复杂场景       → useAsyncData
```

### C.3 Nuxt 3 状态管理（useState）

```typescript
// Nuxt 3 内置 useState，比 Pinia 更轻量
// 特点：SSR 时服务器和客户端共享状态

// 在 composables/useAuth.ts 中定义
export const useAuth = () => {
    // useState：创建跨组件共享的响应式状态
    // 第一个参数是 key（全局唯一），第二个是初始值
    const isLoggedIn = useState<boolean>('isLoggedIn', () => false)
    const adminName = useState<string>('adminName', () => '')

    function login(name: string) {
        isLoggedIn.value = true
        adminName.value = name
    }

    function logout() {
        isLoggedIn.value = false
        adminName.value = ''
    }

    return { isLoggedIn, adminName, login, logout }
}

// 在任意页面或组件中使用
const { isLoggedIn, login } = useAuth()
```

### C.4 Nuxt 3 服务端 API 完整示例

```typescript
// server/api/orders/[id]/status.put.ts
// 实现：PUT /api/orders/5/status

import { query, execute, transaction } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
    // 1. 验证登录
    requireAuth(event)

    // 2. 获取路径参数
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, message: '缺少订单ID' })

    // 3. 获取请求体
    const { status } = await readBody(event)
    
    // 4. 参数校验
    const VALID_STATUS = [0, 1, 2, 3, 4]
    if (!VALID_STATUS.includes(status)) {
        throw createError({ statusCode: 400, message: '无效的状态值' })
    }

    // 5. 查询订单（验证存在）
    const orders = await query<any>('SELECT * FROM `order` WHERE id = ?', [id])
    if (orders.length === 0) {
        throw createError({ statusCode: 404, message: '订单不存在' })
    }

    // 6. 使用事务执行更新
    await transaction(async (conn) => {
        // 更新订单状态
        await conn.execute(
            'UPDATE `order` SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, id]
        )

        // 结账时同步释放桌台
        if (status === 3) {
            await conn.execute(
                'UPDATE restaurant_table SET status = 0 WHERE id = ?',
                [orders[0].table_id]
            )
        }
    })

    // 7. 返回结果（Nuxt 自动序列化为 JSON）
    return { success: true, message: '状态更新成功' }
})
```

### C.5 Element Plus 常用组件速查

```vue
<template>
  <!-- ===== 表格 ===== -->
  <el-table :data="tableData" border stripe v-loading="loading">
    <el-table-column prop="name" label="名称" sortable />
    <el-table-column prop="price" label="价格" width="100">
      <template #default="{ row }">
        <span style="color: red">¥{{ row.price }}</span>
      </template>
    </el-table-column>
    <el-table-column label="操作" fixed="right" width="150">
      <template #default="{ row }">
        <el-button size="small" @click="handleEdit(row)">编辑</el-button>
        <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
      </template>
    </el-table-column>
  </el-table>

  <!-- ===== 表单 ===== -->
  <el-form :model="form" :rules="rules" ref="formRef" label-width="80px">
    <el-form-item label="菜品名称" prop="name">
      <el-input v-model="form.name" placeholder="请输入菜品名称" />
    </el-form-item>
    <el-form-item label="价格" prop="price">
      <el-input-number v-model="form.price" :min="0.01" :precision="2" />
    </el-form-item>
    <el-form-item label="分类" prop="categoryId">
      <el-select v-model="form.categoryId" placeholder="请选择分类">
        <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.id" />
      </el-select>
    </el-form-item>
    <el-form-item label="是否上架">
      <el-switch v-model="form.isAvailable" :active-value="1" :inactive-value="0" />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" @click="submitForm">提交</el-button>
      <el-button @click="resetForm">重置</el-button>
    </el-form-item>
  </el-form>

  <!-- ===== 弹出确认框 ===== -->
  <el-popconfirm title="确定删除吗？" @confirm="doDelete">
    <template #reference>
      <el-button type="danger">删除</el-button>
    </template>
  </el-popconfirm>

  <!-- ===== 消息提示 ===== -->
  <!-- 在 script 中调用 -->
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const formRef = ref()
const form = reactive({ name: '', price: 0, categoryId: null, isAvailable: 1 })

const rules = {
    name: [
        { required: true, message: '请输入菜品名称', trigger: 'blur' },
        { min: 2, max: 50, message: '名称长度在 2-50 字符之间', trigger: 'blur' }
    ],
    price: [{ required: true, type: 'number', min: 0.01, message: '价格必须大于0', trigger: 'blur' }],
    categoryId: [{ required: true, message: '请选择分类', trigger: 'change' }]
}

async function submitForm() {
    // 触发表单校验
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) return

    try {
        await $fetch('/api/dishes', { method: 'POST', body: form })
        ElMessage.success('创建成功')      // 绿色成功提示
    } catch (err) {
        ElMessage.error('创建失败')        // 红色错误提示
    }
}

// 二次确认弹窗（比 confirm() 更美观）
async function handleDelete(id: number) {
    await ElMessageBox.confirm('确定要删除这道菜品吗？', '提示', { type: 'warning' })
    // 用户点确定后才执行
    await $fetch(`/api/dishes/${id}`, { method: 'DELETE' })
    ElMessage.success('删除成功')
}
</script>
```

### C.6 Nuxt 3 中间件详解

```typescript
// Nuxt 中间件有三类：

// 1. 全局中间件（自动对所有路由生效）
// 文件名：middleware/auth.global.ts
export default defineNuxtRouteMiddleware((to, from) => {
    // to：目标路由
    // from：来源路由
    console.log(`从 ${from.path} 导航到 ${to.path}`)
    
    // 返回 navigateTo 会重定向
    const token = useCookie('admin_token')
    if (!token.value && to.path !== '/login') {
        return navigateTo('/login')
    }
    
    // 什么都不返回 = 放行
})

// 2. 具名中间件（需要在页面中手动声明）
// 文件名：middleware/admin.ts
export default defineNuxtRouteMiddleware(() => {
    // 只有声明使用此中间件的页面才会触发
})

// 在页面中使用：
// definePageMeta({ middleware: 'admin' })

// 3. 服务端中间件（处理所有 HTTP 请求，在 API 路由之前）
// 文件名：server/middleware/logger.ts
export default defineEventHandler((event) => {
    // 记录所有请求日志
    console.log(`[${new Date().toISOString()}] ${event.method} ${event.path}`)
})
```

---

## 进阶篇 D：UniApp 深度学习

### D.1 UniApp 完整生命周期

```
应用生命周期（App.vue 中）：
onLaunch    → 应用启动（只触发一次）
onShow      → 应用从后台进入前台
onHide      → 应用从前台进入后台

页面生命周期（pages/ 中）：
onLoad(options)  → 页面加载，options 是路由参数
onShow           → 页面显示（每次切回都触发）
onReady          → 页面首次渲染完成（DOM 可操作）
onHide           → 页面隐藏（导航到其他页时）
onUnload         → 页面卸载（被关闭时，清理定时器、取消请求）

组件生命周期（components/ 中，普通 Vue 生命周期）：
onMounted   → 组件挂载完成
onUpdated   → 组件更新后
onUnmounted → 组件卸载（清理资源）
```

```vue
<script setup>
import { ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'

let timer = null

onLoad((options) => {
    console.log('页面参数:', options)
    // 在这里加载初始数据
    loadData()
})

onShow(() => {
    // 每次回到此页面都刷新（如从下单页返回后刷新购物车）
    // 注意：不要把耗时操作放这里，否则每次切回都重新加载
})

onUnload(() => {
    // 清理工作，防止内存泄漏
    if (timer) {
        clearInterval(timer)
        timer = null
    }
})
</script>
```

### D.2 网络请求完整封装

```javascript
// utils/request.js

import config from './config.js'

// 请求拦截：每次请求前自动加 Token
function getHeaders() {
    // 从本地存储获取 token（如果有登录功能）
    const token = uni.getStorageSync('token')
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
}

function request(url, method, data = {}) {
    return new Promise((resolve, reject) => {
        // 显示全局加载（可选）
        // uni.showLoading({ title: '加载中...' })

        uni.request({
            url: config.BASE_URL + url,
            method,
            data,
            header: getHeaders(),
            timeout: config.TIMEOUT,

            success(res) {
                // uni.hideLoading()
                
                const body = res.data
                
                // HTTP 层面的错误
                if (res.statusCode === 401) {
                    // token 过期，跳转登录
                    uni.reLaunch({ url: '/pages/index/index' })
                    return reject(new Error('请重新登录'))
                }
                
                if (res.statusCode !== 200) {
                    uni.showToast({ title: `请求失败(${res.statusCode})`, icon: 'none' })
                    return reject(new Error(`HTTP ${res.statusCode}`))
                }
                
                // 业务层面的错误
                if (body.code !== 200) {
                    uni.showToast({ title: body.message || '操作失败', icon: 'none', duration: 2000 })
                    return reject(new Error(body.message))
                }
                
                resolve(body.data)
            },

            fail(err) {
                // uni.hideLoading()
                const isTimeout = err.errMsg?.includes('timeout')
                uni.showToast({
                    title: isTimeout ? '请求超时，请检查网络' : '网络连接失败',
                    icon: 'none'
                })
                reject(err)
            }
        })
    })
}

// 对外暴露简洁的方法
export const get    = (url, params = {}) => {
    const qs = new URLSearchParams(
        Object.entries(params).filter(([,v]) => v != null)
    ).toString()
    return request(qs ? `${url}?${qs}` : url, 'GET')
}
export const post   = (url, data)        => request(url, 'POST', data)
export const put    = (url, data)        => request(url, 'PUT', data)
export const del    = (url)              => request(url, 'DELETE')

export default { get, post, put, del }
```

### D.3 本地数据持久化

```javascript
// UniApp 提供统一的本地存储 API（小程序/H5/App 均可用）

// ===== 同步存储（推荐用于小数据）=====
uni.setStorageSync('key', value)     // 存储（value 会自动 JSON 序列化）
const value = uni.getStorageSync('key')  // 读取
uni.removeStorageSync('key')         // 删除
uni.clearStorageSync()               // 清空所有

// ===== 实际使用示例 =====
// 保存用户登录信息
function saveUserInfo(user) {
    uni.setStorageSync('userInfo', user)
    uni.setStorageSync('token', user.token)
}

// 读取
const userInfo = uni.getStorageSync('userInfo')
if (userInfo) {
    console.log('已登录用户:', userInfo.nickname)
}

// 保存购物车到本地（防止刷新丢失）
function saveCart(items) {
    uni.setStorageSync('cart_items', items)
}

// 应用启动时恢复购物车
function restoreCart() {
    const saved = uni.getStorageSync('cart_items')
    if (saved && Array.isArray(saved)) {
        store.items.push(...saved)
    }
}
```

### D.4 微信小程序专有 API

```javascript
// 以下 API 只在微信小程序环境有效，H5 模式下会不可用

// ===== 扫码（扫描二维码）=====
uni.scanCode({
    onlyFromCamera: true,  // 只允许相机扫码（不允许从相册选图）
    scanType: ['qrCode'],  // 只识别二维码
    success(res) {
        // res.result 是二维码内容（如：pages/menu/index?tableId=1）
        console.log('扫码结果:', res.result)
        
        // 解析 URL 参数
        const url = new URL(res.result)
        const tableId = url.searchParams.get('tableId')
    },
    fail(err) {
        console.error('扫码失败:', err)
    }
})

// ===== 获取用户信息（微信授权）=====
// 注意：微信小程序不再允许直接获取用户信息
// 需要用户主动点击按钮授权

// ===== 微信登录 =====
uni.login({
    provider: 'weixin',
    success(res) {
        // res.code 是临时登录凭证
        // 需要发送到服务器，服务器用 code 换取 openid
        post('/api/users/login', { code: res.code })
    }
})

// ===== 支付（微信支付）=====
uni.requestPayment({
    provider: 'wxpay',
    orderInfo: {
        // 服务端下单后返回的支付参数
        timeStamp, nonceStr, package: packageValue, signType, paySign
    },
    success() { console.log('支付成功') },
    fail(err)  { console.error('支付失败', err) }
})

// ===== 分享 =====
// 在 onLoad 中设置分享内容
onShow(() => {
    uni.showShareMenu({ withShareTicket: true })
})
```

### D.5 小程序发布流程

```
1. 注册微信小程序账号
   → 访问 https://mp.weixin.qq.com 注册
   → 获取 AppID（填入 manifest.json 的 mp-weixin.appid）

2. 在微信公众平台配置合法域名
   → 开发 → 开发管理 → 开发设置 → 服务器域名
   → 添加后端 API 域名（必须 HTTPS）
   
3. 在 HBuilderX 中配置
   → 打开 manifest.json，填写 mp-weixin.appid
   → 运行 → 运行到小程序模拟器 → 微信开发者工具

4. 在微信开发者工具中预览
   → 点击"预览"，用手机微信扫码在真机上测试

5. 上传代码
   → 微信开发者工具 → 上传
   → 填写版本号和备注

6. 提交审核
   → 微信公众平台 → 版本管理 → 提交审核
   → 通过后发布上线
```

---

## 进阶篇 E：部署上线

### E.1 Spring Boot 部署

```bash
# 1. 打包为可执行 jar
cd backend
mvn clean package -DskipTests
# 生成文件：target/dingcan-backend-1.0.0.jar

# 2. 上传到服务器
scp target/dingcan-backend-1.0.0.jar root@your-server:/app/

# 3. 在服务器上运行
# 方式一：前台运行（关闭终端就停止）
java -jar /app/dingcan-backend-1.0.0.jar

# 方式二：后台运行（推荐）
nohup java -jar /app/dingcan-backend-1.0.0.jar > /var/log/dingcan.log 2>&1 &

# 方式三：systemd 服务（最佳实践）
# 创建 /etc/systemd/system/dingcan.service
# [Unit]
# Description=Dingcan Backend
# [Service]
# ExecStart=java -jar /app/dingcan-backend-1.0.0.jar
# [Install]
# WantedBy=multi-user.target
systemctl enable dingcan
systemctl start dingcan
systemctl status dingcan

# 4. 配置生产环境参数（不要把密码写在代码里）
java -jar app.jar \
  --spring.datasource.password=生产数据库密码 \
  --server.port=8888
```

### E.2 Nuxt 3 部署

```bash
# 1. 构建
cd admin
npm run build
# 生成 .output/ 目录

# 2. 上传 .output 到服务器

# 3. 运行（需要 Node.js 环境）
node .output/server/index.mjs

# 4. 使用 PM2 进程守护（自动重启）
npm install -g pm2
pm2 start .output/server/index.mjs --name "dingcan-admin"
pm2 save   # 保存进程列表
pm2 startup  # 设置开机自启

# 5. Nginx 反向代理配置
# /etc/nginx/sites-available/dingcan
# server {
#     listen 80;
#     server_name admin.yourdomain.com;
#     location / {
#         proxy_pass http://localhost:3000;
#         proxy_set_header Host $host;
#     }
# }
```

### E.3 环境变量安全管理

```bash
# ❌ 错误：密码硬编码在代码里（危险！会被 git 看到）
DB_PASSWORD=123456abc  # 在代码里

# ✅ 正确：通过环境变量注入，代码里只有变量名

# Linux 服务器设置环境变量
export DB_PASSWORD="your_strong_password"
export ADMIN_PASSWORD="your_admin_password"

# 或写入 /etc/environment（持久化）
echo 'DB_PASSWORD=your_strong_password' >> /etc/environment

# .env 文件只用于本地开发，务必加入 .gitignore！
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore
```

---

*本教程基于实际项目代码编写，所有示例代码均来自本项目。遇到问题时，对照项目源码是最快的解决方式。*
