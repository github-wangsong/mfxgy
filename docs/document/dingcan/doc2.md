# 第二部分：从零到一，按功能点开发完整项目

> 本章按真实开发顺序，每个功能都讲清楚：**要做什么、为什么这样做、在哪里建文件、写什么代码**。
> 每个功能点都覆盖"数据库 → 后端 → 前端"全链路。

---

## 阶段一：搭建基础工程

### 步骤 1：创建 Spring Boot 后端项目

**为什么要用 Spring Boot？**

我们需要一个能接收 HTTP 请求、操作数据库、返回数据的服务器程序。
Spring Boot 是 Java 生态最成熟的框架，它把很多复杂配置都自动化了——
原来需要配置一百行 XML 才能启动的服务，现在写几行代码就好。

**在哪里初始化项目？**

访问 [https://start.spring.io](https://start.spring.io)（Spring Initializr），选择：
- Project：Maven
- Language：Java
- Spring Boot：3.2.5
- Group：com.dingcan
- Artifact：dingcan-backend
- Dependencies：Spring Web、MyBatis Plus（需手动添加）、MySQL Driver、Lombok、Validation

下载解压后，项目结构如下：

```
backend/
├── pom.xml                           ← 依赖管理文件（相当于购物清单）
└── src/
    └── main/
        ├── java/com/dingcan/
        │   └── DingcanApplication.java  ← 程序入口
        └── resources/
            └── application.yml          ← 配置文件（数据库连接等）
```

**`DingcanApplication.java` 是整个程序的入口：**

```java
// backend/src/main/java/com/dingcan/DingcanApplication.java

package com.dingcan;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
// 这一个注解包含了三件事：
// @Configuration：这个类可以定义 Bean（配置）
// @EnableAutoConfiguration：自动配置（自动检测 classpath 上的库并配置它们）
// @ComponentScan：自动扫描当前包下所有 @Component、@Service、@Controller 等
public class DingcanApplication {
    public static void main(String[] args) {
        SpringApplication.run(DingcanApplication.class, args);
        // 启动整个 Spring Boot 应用
        // run() 会：启动内置 Tomcat → 初始化 Spring 容器 → 加载所有 Bean
    }
}
```

**配置数据库连接（`application.yml`）：**

```yaml
# backend/src/main/resources/application.yml

server:
  port: 8888     # 后端监听 8888 端口

spring:
  datasource:
    url: jdbc:mysql://localhost:3306/dingcan?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
    username: root
    password: 123456   # ← 改成你自己的 MySQL 密码
    driver-class-name: com.mysql.cj.jdbc.Driver

  jackson:
    date-format: yyyy-MM-dd HH:mm:ss
    time-zone: Asia/Shanghai   # 防止时间差 8 小时

mybatis-plus:
  configuration:
    map-underscore-to-camel-case: true
    # 这行很关键：数据库 order_no → Java orderNo（自动驼峰转换）
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
    # 开发时打印 SQL，调试用
  global-config:
    db-config:
      id-type: auto    # 主键策略：数据库自增
```

**统一响应格式——为什么要建 Result 类？**

前端需要知道请求是成功还是失败，HTTP 状态码（200、404、500）不够用，
因为业务逻辑上的"失败"（如"桌台不存在"）HTTP 状态码也是 200。

所以我们统一用一个 JSON 格式来表达成功/失败：

新建文件：`backend/src/main/java/com/dingcan/common/Result.java`

```java
package com.dingcan.common;

import lombok.Data;
import java.io.Serializable;

@Data
public class Result<T> implements Serializable {

    private int code;      // 200=成功，400=参数错，404=不存在，500=服务错误
    private String message;
    private T data;        // 泛型：可以是任何类型的数据

    // 私有构造函数，强制只能通过静态工厂方法创建
    // 这是一种设计模式，防止随意 new Result() 然后忘记填 code
    private Result(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    // 成功时调用这些方法
    public static <T> Result<T> ok()                 { return new Result<>(200, "操作成功", null); }
    public static <T> Result<T> ok(T data)           { return new Result<>(200, "操作成功", data); }
    public static <T> Result<T> ok(String msg, T d)  { return new Result<>(200, msg, d); }

    // 失败时调用这些方法
    public static <T> Result<T> fail(String msg)     { return new Result<>(500, msg, null); }
    public static <T> Result<T> notFound(String msg) { return new Result<>(404, msg, null); }
    public static <T> Result<T> paramError(String msg){ return new Result<>(400, msg, null); }
}
```

这样前端收到的 JSON 永远是同一个格式：
```json
{ "code": 200, "message": "操作成功", "data": { ... } }
{ "code": 404, "message": "桌台不存在", "data": null }
```
前端只需要判断 `code === 200` 即可，不用处理各种 HTTP 状态码。

---

### 步骤 2：创建 Nuxt 3 管理端

**为什么用 Nuxt 3 而不是普通 Vue？**

管理端有一个特殊需求：它需要**直接操作数据库**（不经过 Spring Boot 后端），
因为如果每个管理操作都要经过 Spring Boot，就需要写很多额外的 Java 接口，
而管理端的操作（菜品增删改、订单确认等）逻辑并不复杂，直接写 SQL 更高效。

Nuxt 3 = Vue 3 前端 + Node.js 后端，可以在同一个项目里写前端页面和后端 API，
并且后端 API 运行在 Node.js 环境里，可以直接用 mysql2 连接 MySQL。

```bash
# 创建 Nuxt 3 项目
npx nuxi@latest init admin
cd admin
npm install

# 安装必要依赖
npm install element-plus @element-plus/icons-vue  # UI 组件库
npm install mysql2                                  # MySQL 驱动
npm install qrcode @types/qrcode                   # 二维码生成
npm install echarts                                 # 图表库
npm install @pinia/nuxt                             # 状态管理
```

---

### 步骤 3：创建 UniApp 用户端

UniApp 用 HBuilderX 工具创建（文件 → 新建 → 项目 → 选择"uni-app"），
或者用命令行：

```bash
npx degit dcloudio/uni-preset-vue#vite-ts frontend
cd frontend
npm install
```

---

## 阶段二：开发第一个功能——菜品浏览

### 功能说明

顾客打开小程序，能看到餐厅的所有菜品，按分类展示（招牌热菜、家常凉菜等），
每道菜显示名称、价格、图片和描述。

**技术方案思考**：
- 菜品数据存在 MySQL，通过 Spring Boot 提供查询接口
- 管理员会修改菜品（涨价、下架），所以用数据库而不是写死在代码里
- 需要分类+菜品两张表，通过 `category_id` 关联

### 数据库层

菜品数据涉及两张表，我们在 `sql/init.sql` 里创建：

```sql
-- 先创建分类表（dish 表的外键依赖它，必须先建）
CREATE TABLE IF NOT EXISTS `category` (
    `id`         INT         NOT NULL AUTO_INCREMENT,
    `name`       VARCHAR(50) NOT NULL,  -- 分类名称，如"招牌热菜"
    `sort_order` INT         NOT NULL DEFAULT 0,  -- 排序值，越小越靠前
    `is_active`  TINYINT     NOT NULL DEFAULT 1,  -- 1=启用，0=禁用
    `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 再创建菜品表
CREATE TABLE IF NOT EXISTS `dish` (
    `id`           INT            NOT NULL AUTO_INCREMENT,
    `category_id`  INT            NOT NULL,  -- 关联 category.id
    `name`         VARCHAR(100)   NOT NULL,
    `description`  TEXT,                     -- 可为空（不是每道菜都需要描述）
    `price`        DECIMAL(10, 2) NOT NULL,  -- 用精确小数，不用 float（有精度误差）
    `image_url`    VARCHAR(500),             -- 图片地址，可为空
    `is_available` TINYINT        NOT NULL DEFAULT 1,  -- 1=上架，0=下架
    `sort_order`   INT            NOT NULL DEFAULT 0,
    `created_at`   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_category_id` (`category_id`),   -- 常按分类查菜品，加索引
    CONSTRAINT `fk_dish_category`
        FOREIGN KEY (`category_id`) REFERENCES `category` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 插入初始测试数据，方便开发时使用
INSERT INTO `category` (`name`, `sort_order`, `is_active`) VALUES
('招牌热菜', 1, 1), ('家常凉菜', 2, 1), ('主食面点', 3, 1), ('饮品', 4, 1);

INSERT INTO `dish` (`category_id`, `name`, `description`, `price`, `is_available`, `sort_order`) VALUES
(1, '红烧肉',   '精选三层五花肉，小火慢炖，色泽红亮', 38.00, 1, 1),
(1, '宫保鸡丁', '鲜嫩鸡胸肉配酥香花生，麻辣适中',   28.00, 1, 2),
(2, '凉拌黄瓜', '新鲜黄瓜，蒜泥调味，清爽解腻',      8.00, 1, 1);
```

### 后端层（Spring Boot）

**第一步：创建实体类**

实体类的作用是：让 Java 知道数据库的一行数据对应哪些字段。

新建文件：`backend/src/main/java/com/dingcan/entity/Dish.java`

```java
package com.dingcan.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data              // Lombok：自动生成所有 getter、setter
@TableName("dish") // 告诉 MyBatis-Plus：这个类对应数据库的 dish 表
public class Dish {

    @TableId(type = IdType.AUTO)
    // @TableId：声明这是主键字段
    // IdType.AUTO：主键由数据库自增，insert 时不需要手动设置 id
    private Integer id;

    private Integer categoryId;
    // MyBatis-Plus 配置了 map-underscore-to-camel-case: true
    // 所以 Java 的 categoryId（驼峰）会自动对应数据库的 category_id（下划线）

    private String name;
    private String description;

    private BigDecimal price;
    // 为什么用 BigDecimal 而不用 double？
    // double 有精度问题：0.1 + 0.2 = 0.30000000000000004
    // BigDecimal 精确计算：0.1 + 0.2 = 0.3
    // 金额计算必须用 BigDecimal，否则会出现财务数据错误

    private String imageUrl;   // 对应 image_url
    private Integer isAvailable; // 对应 is_available
    private Integer sortOrder;   // 对应 sort_order
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

同样创建 `Category.java`：

```java
package com.dingcan.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@TableName("category")
public class Category {
    @TableId(type = IdType.AUTO)
    private Integer id;
    private String name;
    private Integer sortOrder;
    private Integer isActive;
    private LocalDateTime createdAt;
}
```

**第二步：创建 Mapper 接口**

Mapper 是 MyBatis-Plus 操作数据库的接口，只需要继承 `BaseMapper`，
就自动拥有查询、插入、更新、删除等基础方法：

新建文件：`backend/src/main/java/com/dingcan/mapper/DishMapper.java`

```java
package com.dingcan.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.dingcan.entity.Dish;
import org.apache.ibatis.annotations.Mapper;

@Mapper
// @Mapper：告诉 Spring，这是一个 MyBatis Mapper 接口
// Spring 会自动创建它的实现类，不需要手写实现
public interface DishMapper extends BaseMapper<Dish> {
    // extends BaseMapper<Dish>：继承后自动获得：
    // selectById(id)           查一条
    // selectList(queryWrapper) 查多条（带条件）
    // insert(dish)             新增
    // updateById(dish)         按 id 更新
    // deleteById(id)           按 id 删除
    // ... 还有更多

    // 目前不需要写任何代码！BaseMapper 已经够用了
}
```

同理创建 `CategoryMapper.java`（内容相同，把 Dish 换成 Category）。

**第三步：创建 Service 层**

为什么有了 Mapper 还需要 Service？

- Mapper：只负责数据库操作（How to store/retrieve data）
- Service：负责业务逻辑（What to do with data）

好处是业务逻辑变了，只改 Service，不影响 Mapper；数据库换了，只改 Mapper，不影响 Service。

新建文件：`backend/src/main/java/com/dingcan/service/DishService.java`（接口）

```java
package com.dingcan.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.dingcan.entity.Dish;
import java.util.List;

public interface DishService extends IService<Dish> {
    // IService<Dish>：MyBatis-Plus 提供的 Service 接口，包含基础 CRUD

    // 定义业务方法（只定义"能做什么"，不管"怎么做"）
    List<Dish> listAvailableDishes(Integer categoryId);
    // 查询上架菜品，可按分类过滤（categoryId 为 null 则查全部）
}
```

新建文件：`backend/src/main/java/com/dingcan/service/impl/DishServiceImpl.java`（实现）

```java
package com.dingcan.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.dingcan.entity.Dish;
import com.dingcan.mapper.DishMapper;
import com.dingcan.service.DishService;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
// @Service：告诉 Spring，这是一个 Service Bean，可以被其他类注入使用
public class DishServiceImpl extends ServiceImpl<DishMapper, Dish>
        implements DishService {
    // ServiceImpl<DishMapper, Dish>：MyBatis-Plus 提供的 Service 基类
    // 继承后自动实现 IService 里的所有基础方法（save、getById、list 等）

    @Override
    public List<Dish> listAvailableDishes(Integer categoryId) {
        // LambdaQueryWrapper：构建查询条件（类型安全，不用写字符串）
        LambdaQueryWrapper<Dish> wrapper = new LambdaQueryWrapper<Dish>()
            .eq(Dish::getIsAvailable, 1)
            // .eq(列, 值)：生成 WHERE is_available = 1
            // Dish::getIsAvailable 是方法引用，等价于 d -> d.getIsAvailable()
            // 用方法引用的好处：字段名改了，IDE 会提示，不会像字符串"is_available"一样写错了没法发现

            .eq(categoryId != null, Dish::getCategoryId, categoryId)
            // 第一个参数是条件（boolean）：只有 categoryId 不为 null，才加这个 WHERE 条件
            // 实现了"可选过滤"——不传分类ID就查所有菜，传了就只查那个分类

            .orderByAsc(Dish::getSortOrder);
            // ORDER BY sort_order ASC（sort_order 越小越靠前）

        return list(wrapper);
        // list() 方法来自 ServiceImpl，执行查询并返回结果列表
    }
}
```

**第四步：创建 Controller（最外层，对外暴露 HTTP 接口）**

Controller 是用户（前端）和后端之间的"门"：
- 接收 HTTP 请求，取出参数
- 调用 Service 处理业务逻辑
- 把结果包装成统一格式返回

新建文件：`backend/src/main/java/com/dingcan/controller/DishController.java`

```java
package com.dingcan.controller;

import com.dingcan.common.Result;
import com.dingcan.entity.Dish;
import com.dingcan.service.DishService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "菜品", description = "用户端菜品查询接口")
// @Tag：Swagger 文档分组，方便在 /swagger-ui.html 里找到这个接口
@RestController
// @RestController = @Controller + @ResponseBody
// @Controller：声明这是一个控制器
// @ResponseBody：方法返回值自动序列化为 JSON（不用手动转）
@RequestMapping("/api/dishes")
// @RequestMapping：声明这个 Controller 处理的 URL 前缀
// 所有方法的 URL 都以 /api/dishes 开头
@RequiredArgsConstructor
// Lombok：自动生成包含所有 final 字段的构造器（用于依赖注入）
// 相当于：public DishController(DishService dishService) { this.dishService = dishService; }
public class DishController {

    private final DishService dishService;
    // final + @RequiredArgsConstructor = Spring 自动注入 DishServiceImpl

    @Operation(summary = "获取菜品列表", description = "可选按分类过滤，只返回上架菜品")
    @GetMapping
    // @GetMapping：处理 GET 请求
    // 完整路径：GET http://localhost:8888/api/dishes
    // 或带参数：GET http://localhost:8888/api/dishes?categoryId=1
    public Result<List<Dish>> listDishes(
            @RequestParam(required = false) Integer categoryId) {
            // @RequestParam：从 URL 查询参数里取值（?categoryId=1 里的 1）
            // required = false：这个参数可选，不传时 categoryId = null
        return Result.ok(dishService.listAvailableDishes(categoryId));
        // 成功时返回：{ "code": 200, "message": "操作成功", "data": [...菜品列表...] }
    }
}
```

**请求流程梳理**：
```
前端发请求：GET http://localhost:8888/api/dishes?categoryId=1
                              ↓
DishController.listDishes(categoryId=1) 被调用
                              ↓
dishService.listAvailableDishes(1)
                              ↓
DishServiceImpl 构建 SQL：
  SELECT * FROM dish WHERE is_available=1 AND category_id=1 ORDER BY sort_order ASC
                              ↓
MyBatis-Plus 执行 SQL，返回 List<Dish>
                              ↓
Controller 包装：Result.ok(dishes)
                              ↓
Spring 序列化为 JSON 返回给前端：
{ "code": 200, "data": [{"id":1,"name":"红烧肉","price":38.00,...},...] }
```

### 前端层（UniApp）

**在哪里创建文件？**

UniApp 的页面文件放在 `pages/` 目录，每个页面是一个文件夹+`index.vue`：

```
frontend/
├── pages/
│   ├── index/
│   │   └── index.vue   ← 首页（扫码入口）
│   ├── menu/
│   │   └── index.vue   ← 点餐菜单页（本节要做的）
│   └── order/
│       ├── confirm.vue ← 订单确认页
│       └── status.vue  ← 订单状态页
├── store/
│   └── cart.js         ← 购物车状态管理
└── utils/
    ├── config.js        ← 后端 API 地址配置
    └── request.js       ← HTTP 请求封装
```

**第一步：配置后端 API 地址**

新建 `frontend/utils/config.js`：

```javascript
// 把后端地址统一放在这里，以后改地址只改这一处
const config = {
  BASE_URL: 'http://localhost:8888',
  // 微信小程序生产环境必须是 https，且需要在微信公众平台配置合法域名

  WS_BASE_URL: 'ws://localhost:8888',
  // WebSocket 地址（http → ws，https → wss）

  TIMEOUT: 10000,       // 请求超时：10秒
  POLL_INTERVAL: 5000,  // 订单状态轮询间隔：5秒
}

export default config
```

**第二步：封装 HTTP 请求工具**

为什么不直接用 `uni.request`？

每次都写 `uni.request({ url: config.BASE_URL + '/api/dishes', ... })`
太啰嗦，而且每个地方都要处理错误、解析 `data` 字段。

封装一个 `get()` 函数，让代码变成：`const dishes = await get('/api/dishes')`

新建 `frontend/utils/request.js`：

```javascript
import config from './config.js'

// 核心请求函数，返回 Promise（支持 await）
function request(url, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    // Promise 的两个回调：
    // resolve(value)：请求成功，把结果传出去
    // reject(error)：请求失败，把错误传出去

    uni.request({
      url: config.BASE_URL + url,   // 完整 URL = BASE_URL + 接口路径
      method,
      data,
      header: { 'Content-Type': 'application/json' },
      timeout: config.TIMEOUT,

      success: (res) => {
        const body = res.data  // 后端返回的整个 JSON 对象（Result<T>）

        if (res.statusCode !== 200) {
          // HTTP 状态码不是 200（如 500 服务器错误）
          uni.showToast({ title: `请求失败(${res.statusCode})`, icon: 'none' })
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }

        if (body.code !== 200) {
          // HTTP 是 200，但业务逻辑失败（如桌台不存在 → code=404）
          // 自动弹出错误提示（后端的 message 字段）
          uni.showToast({ title: body.message || '操作失败', icon: 'none', duration: 2000 })
          reject(new Error(body.message))
          return
        }

        resolve(body.data)
        // 成功：只把 data 字段传出去（不用每次都写 .data）
        // 调用处：const dishes = await get('/api/dishes')
        // 就直接得到菜品数组，不需要写 .data.data
      },

      fail: (err) => {
        // 网络错误（如没有网络、超时）
        const msg = err.errMsg?.includes('timeout') ? '请求超时' : '网络连接失败'
        uni.showToast({ title: msg, icon: 'none', duration: 2500 })
        reject(err)
      },
    })
  })
}

// 封装常用方法
export function get(url, params = {}) {
  // 把 params 对象转成 ?key=value&key2=value2 格式
  const queryStr = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return request(queryStr ? `${url}?${queryStr}` : url, 'GET')
}

export function post(url, data = {}) {
  return request(url, 'POST', data)
}

export function put(url, data = {}) {
  return request(url, 'PUT', data)
}
```

**第三步：开发菜单页面**

新建 `frontend/pages/menu/index.vue`：

```vue
<template>
  <view class="menu-page">
    <!-- 顶部桌台信息栏 -->
    <view class="table-bar">
      <text class="table-bar-icon">🪑</text>
      <text class="table-bar-name">{{ tableNumber || '加载中...' }}</text>
      <!-- || 运算符：tableNumber 为空时显示"加载中..." -->
      <view v-if="activeOrderNo" class="order-status-btn" @tap="goToOrderStatus">
        <text>查看订单</text>
        <!-- v-if：只有存在活跃订单时才显示这个按钮 -->
      </view>
      <text v-else class="table-bar-tip">请点击菜品加入购物车</text>
      <!-- v-else：没有活跃订单时显示提示文字 -->
    </view>

    <view class="content">
      <!-- 左侧分类导航 -->
      <!-- scroll-view：可滚动的视图；scroll-y 表示纵向滚动 -->
      <!-- :scroll-into-view：滚动到指定 id 的元素，用于点击分类时同步右边菜品列表 -->
      <scroll-view class="category-nav" scroll-y :scroll-into-view="'cat-' + activeCategoryId">
        <view
          v-for="cat in categories"
          :key="cat.id"
          :id="'nav-' + cat.id"
          class="cat-item"
          :class="{ active: activeCategoryId === cat.id }"
          @tap="scrollToCategory(cat.id)"
        >
          <text>{{ cat.name }}</text>
          <!-- 该分类有商品在购物车时，显示数量徽章 -->
          <text v-if="getCategoryCartCount(cat.id) > 0" class="cat-badge">
            {{ getCategoryCartCount(cat.id) }}
          </text>
        </view>
      </scroll-view>

      <!-- 右侧菜品列表 -->
      <scroll-view class="dish-list" scroll-y @scroll="onDishScroll" :scroll-into-view="scrollTarget">
        <!-- 遍历分类，每个分类是一个区块 -->
        <view v-for="cat in categories" :key="cat.id" :id="'cat-' + cat.id">
          <view class="category-title">{{ cat.name }}</view>
          <!-- 该分类下的菜品 -->
          <view v-for="dish in getDishByCategory(cat.id)" :key="dish.id" class="dish-item">
            <!-- 菜品图片（兼容两种字段名格式，见后端章节的说明） -->
            <image class="dish-image"
              :src="dish.imageUrl || dish.image_url || '/static/logo.png'"
              mode="aspectFill"
            />
            <view class="dish-info">
              <text class="dish-name">{{ dish.name }}</text>
              <text v-if="dish.description" class="dish-desc">{{ dish.description }}</text>
              <view class="dish-bottom">
                <text class="dish-price">
                  ¥<text class="price-num">{{ parseFloat(dish.price).toFixed(2) }}</text>
                </text>
                <view class="quantity-control">
                  <!-- 只有购物车里有这道菜，才显示减号 -->
                  <view v-if="cartStore.getQuantityById(dish.id) > 0"
                    class="qty-btn minus"
                    @tap="cartStore.removeItem(dish.id)">
                    <text>−</text>
                  </view>
                  <text v-if="cartStore.getQuantityById(dish.id) > 0" class="qty-num">
                    {{ cartStore.getQuantityById(dish.id) }}
                  </text>
                  <!-- 加入购物车按钮 -->
                  <view class="qty-btn plus" @tap="cartStore.addItem(dish)">
                    <text>+</text>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </view>
        <view style="height: 140rpx" /> <!-- 底部空白，防止被购物车栏遮挡 -->
      </scroll-view>
    </view>

    <!-- 购物车悬浮栏（不为空时显示） -->
    <view class="cart-bar safe-area-bottom" v-if="!cartStore.isEmpty">
      <view class="cart-left" @tap="showCartDetail">
        <view class="cart-icon-wrapper">
          <text class="cart-icon">🛒</text>
          <text class="cart-badge">{{ cartStore.totalQuantity }}</text>
        </view>
        <view class="cart-info">
          <text class="cart-total">¥{{ cartStore.totalAmount.toFixed(2) }}</text>
          <text class="cart-min">共 {{ cartStore.totalQuantity }} 件商品</text>
        </view>
      </view>
      <view class="submit-btn" @tap="goToConfirm">去结算</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { useCartStore } from '@/store/cart.js'
import { get } from '@/utils/request.js'

const cartStore      = useCartStore()  // 全局购物车状态
const tableId        = ref(null)       // 当前桌台ID（从URL参数获取）
const tableNumber    = ref('')         // 桌台名称（显示在顶部）
const categories     = ref([])         // 分类列表
const dishes         = ref([])         // 所有菜品
const activeCategoryId = ref(null)    // 左侧高亮的分类ID
const scrollTarget   = ref('')         // 控制右侧列表滚动位置
const cartVisible    = ref(false)      // 购物车弹窗是否显示
const activeOrderNo  = ref('')         // 该桌是否有进行中的订单

// 防止左右两侧滚动互相干扰
let isScrolling = false
let scrollTimer = null

// 页面加载时执行（options 包含 URL 参数）
onLoad(async (options) => {
  tableId.value     = options.tableId          // 从 URL 取桌台ID
  tableNumber.value = decodeURIComponent(options.tableName || '')
  // decodeURIComponent：URL 里的中文是编码格式（如 %0101%E5%8F%B7%E6%A1%8C），需要解码

  // 如果 cartStore 里还没有桌台信息，设置一下（第一次进来）
  if (!cartStore.tableId && tableId.value) {
    cartStore.setTable(parseInt(tableId.value), tableNumber.value)
  }

  // 连接购物车同步 WebSocket（同桌多设备实时共享购物车）
  cartStore.connectCartSync(parseInt(tableId.value))

  // 查询该桌是否有进行中的订单（决定是否显示"查看订单"按钮）
  fetchActiveOrder()

  // 加载菜单数据
  await loadMenu()
})

// 页面卸载时断开 WebSocket（不然会有内存泄漏）
onUnload(() => {
  cartStore.disconnectCartSync()
})

// 同时加载分类和菜品（Promise.all 并发请求，比顺序请求快）
async function loadMenu() {
  try {
    uni.showLoading({ title: '加载菜单...', mask: true })

    // Promise.all：两个请求同时发出，等两个都完成才继续
    // 如果顺序请求：先等分类（300ms），再等菜品（300ms），总共 600ms
    // Promise.all：600ms → 300ms（只等最慢的那个）
    const [catsData, dishesData] = await Promise.all([
      get('/api/categories'),
      get('/api/dishes'),
    ])

    categories.value = catsData
    dishes.value = dishesData

    // 默认选中第一个分类
    if (catsData.length > 0) activeCategoryId.value = catsData[0].id

  } catch (err) {
    console.error('[Menu] 加载菜单失败', err)
  } finally {
    uni.hideLoading()  // 无论成功失败，都要关闭加载提示
  }
}

// 查询该桌是否有进行中的订单
async function fetchActiveOrder() {
  if (!tableId.value) return
  // 后端对这个接口的设计：无论有没有活跃订单，都返回 HTTP 200
  // 有订单：data = 订单对象；没有订单：data = null
  // 这样前端不会触发错误处理（自动弹 toast），而是静默处理
  const active = await get('/api/orders/active', { tableId: tableId.value })
  activeOrderNo.value = active?.orderNo || active?.order_no || ''
}

function goToOrderStatus() {
  if (!activeOrderNo.value) return
  uni.navigateTo({ url: `/pages/order/status?orderNo=${activeOrderNo.value}` })
}

// 根据分类ID过滤菜品（兼容两种字段名）
function getDishByCategory(categoryId) {
  return dishes.value.filter(
    d => (d.categoryId ?? d.category_id) === categoryId
    // 为什么要兼容两种格式？
    // Spring Boot 返回 camelCase（categoryId）
    // 但如果直接查数据库（Nuxt 管理端接口）返回 snake_case（category_id）
    // ?? 是空值合并：d.categoryId 为 null/undefined 时才用 d.category_id
  )
}

// 获取某分类在购物车里的总数量（显示在分类徽章上）
function getCategoryCartCount(categoryId) {
  const ids = getDishByCategory(categoryId).map(d => d.id)
  return cartStore.items
    .filter(i => ids.includes(i.id))
    .reduce((s, i) => s + i.quantity, 0)
}

// 点击左侧分类，右侧菜品列表滚动到对应位置
function scrollToCategory(categoryId) {
  isScrolling = true
  activeCategoryId.value = categoryId
  scrollTarget.value = 'cat-' + categoryId
  setTimeout(() => { isScrolling = false; scrollTarget.value = '' }, 500)
}

// 右侧菜品滚动时，自动高亮对应的左侧分类
function onDishScroll() {
  if (isScrolling) return  // 如果是手动切换触发的滚动，不处理（避免互相干扰）
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    const query = uni.createSelectorQuery()
    categories.value.forEach(cat => query.select('#cat-' + cat.id).boundingClientRect())
    query.exec((rects) => {
      for (let i = 0; i < rects.length; i++) {
        if (rects[i] && rects[i].top >= -10) {
          activeCategoryId.value = categories.value[i].id
          break  // 找到第一个出现在屏幕顶部的分类就停止
        }
      }
    })
  }, 50)  // 延迟 50ms，避免频繁触发
}

function showCartDetail() { cartVisible.value = !cartVisible.value }

function clearCart() {
  uni.showModal({
    title: '提示', content: '确定清空购物车？',
    success: (res) => {
      if (res.confirm) { cartStore.clearCart(); cartVisible.value = false }
    },
  })
}

function goToConfirm() {
  if (cartStore.isEmpty) { uni.showToast({ title: '购物车为空', icon: 'none' }); return }
  cartVisible.value = false
  uni.navigateTo({ url: '/pages/order/confirm' })
}
</script>
```

---

## 阶段三：购物车

### 功能说明

顾客点 + 号把菜品加入购物车，页面实时显示数量和总价。
同桌多台手机的购物车要同步（通过 WebSocket，详见 WebSocket 章节）。

**为什么不把购物车数据存数据库？**

购物车是"临时数据"，顾客还没下单，随时可能清空。
存数据库太重了，而且这种频繁读写（每次点 +/- 都操作）会造成性能问题。
购物车只需要存在前端内存里（关闭小程序就清空，符合业务逻辑）。

**为什么用全局状态管理（Store）而不是放在组件里？**

购物车数据需要在多个页面共享：
- `menu/index.vue`：展示购物车、添加/删除菜品
- `order/confirm.vue`：展示购物车内容、提交订单
- `order/status.vue`：提交后清空购物车

如果放在组件里，页面跳转时数据就消失了。
放在全局 Store 里，所有页面都能访问同一份数据。

新建文件 `frontend/store/cart.js`：

```javascript
import { reactive } from 'vue'
import config from '@/utils/config.js'

// reactive()：把对象变成响应式
// 意思是：修改 store.items 里的数据，所有用到它的页面都会自动更新
const store = reactive({
  items:       [],    // 购物车商品列表
  tableId:     null,  // 当前桌台 ID（扫码后设置）
  tableNumber: '',    // 桌台名称（显示用）

  // get 关键字定义"计算属性"（getter）
  // 访问 store.totalQuantity 时自动执行这个函数
  // items 变化时，所有使用 totalQuantity 的地方都会自动更新
  get totalQuantity() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0)
    // reduce：累加，从 0 开始，每次加上 item.quantity
  },
  get totalAmount() {
    const total = this.items.reduce(
      (sum, item) => sum + item.price * item.quantity, 0
    )
    return parseFloat(total.toFixed(2))
    // toFixed(2)：保留两位小数（如 38.1 → "38.10"）
    // parseFloat：把字符串 "38.10" 变回数字 38.10
  },
  get isEmpty() {
    return this.items.length === 0
  },
})

// 加入购物车
function addItem(dish) {
  // 先在购物车里找有没有这道菜
  const existing = store.items.find(i => i.id === dish.id)

  if (existing) {
    existing.quantity += 1    // 有：数量 +1
  } else {
    // 没有：新增一条记录
    store.items.push({
      id:       dish.id,
      name:     dish.name,
      price:    parseFloat(dish.price),  // 确保是数字（后端可能返回字符串）
      imageUrl: dish.imageUrl || dish.image_url || '',
      quantity: 1,
    })
  }
  _sendCartState()  // 通知同桌其他设备（WebSocket 功能，后面讲）
}

// 从购物车移除
function removeItem(dishId) {
  const index = store.items.findIndex(i => i.id === dishId)
  if (index === -1) return  // 找不到就不处理

  if (store.items[index].quantity > 1) {
    store.items[index].quantity -= 1  // 数量大于1：减1
  } else {
    store.items.splice(index, 1)
    // splice(index, 1)：从 index 位置删除 1 个元素
    // 注意：不能用 store.items = store.items.filter(...)
    // 因为直接替换数组会失去响应式
  }
  _sendCartState()
}

// 清空购物车
function clearCart() {
  store.items.splice(0, store.items.length)
  // 为什么不用 store.items = []？
  // 因为 = [] 会把 reactive 里的数组替换成普通数组，失去响应式！
  // splice(0, length) 是在原数组上操作，保持响应式
  _sendCartState()
}

function setTable(id, number) {
  store.tableId     = id
  store.tableNumber = number
}

function getQuantityById(dishId) {
  const item = store.items.find(i => i.id === dishId)
  return item ? item.quantity : 0
}

// ── WebSocket 相关（购物车多端同步）────────────────────────────
// 这部分代码在"功能：购物车多端同步"章节详细讲解，这里先留占位

let _wsTask         = null  // WebSocket 连接实例
let _reconnectTimer = null  // 断线重连计时器
let _manualClose    = false // 是否是主动关闭（用于区分意外断线和主动断开）
let _connectedTable = null  // 当前连接的桌台ID

function _wsUrl(tableId) {
  const base = (config.WS_BASE_URL || config.BASE_URL.replace(/^http/, 'ws')).replace(/\/$/, '')
  return `${base}/ws/table-cart?tableId=${tableId}`
}

function _applySync(items) {
  // 接收服务端的购物车状态，替换本地（不触发上行推送，避免死循环）
  store.items.splice(0, store.items.length)
  ;(items || []).forEach(item => {
    store.items.push({
      id: item.id, name: item.name,
      price: parseFloat(item.price),
      imageUrl: item.imageUrl ?? item.image_url ?? '',
      quantity: item.quantity,
    })
  })
}

function _sendCartState() {
  if (!_wsTask) return
  try {
    _wsTask.send({
      data: JSON.stringify({
        type: 'cart_update',
        items: store.items.map(i => ({
          id: i.id, name: i.name, price: i.price,
          imageUrl: i.imageUrl, quantity: i.quantity,
        })),
      }),
      fail: () => {},
    })
  } catch (e) {}
}

function connectCartSync(tableId) {
  if (!tableId) return
  if (_wsTask && _connectedTable === tableId) return
  disconnectCartSync()
  _manualClose = false
  _connectedTable = tableId
  _wsTask = uni.connectSocket({ url: _wsUrl(tableId), complete: () => {} })
  _wsTask.onOpen(() => {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  })
  _wsTask.onMessage(res => {
    try {
      const msg = JSON.parse(res.data || '{}')
      if (msg.type === 'cart_sync') _applySync(msg.items)
    } catch (e) {}
  })
  _wsTask.onClose(() => {
    _wsTask = null
    if (!_manualClose && _connectedTable) {
      _reconnectTimer = setTimeout(() => connectCartSync(_connectedTable), 3000)
    }
  })
  _wsTask.onError(() => {
    try { _wsTask && _wsTask.close({}) } catch (e) {}
  })
}

function disconnectCartSync() {
  _manualClose = true
  _connectedTable = null
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  if (_wsTask) { try { _wsTask.close({}) } catch (e) {} _wsTask = null }
}

// 导出 useCartStore 函数，供各页面使用
export function useCartStore() {
  return {
    // 响应式数据（通过 getter 暴露，保证响应式不被破坏）
    get items()         { return store.items },
    get tableId()       { return store.tableId },
    get tableNumber()   { return store.tableNumber },
    get totalQuantity() { return store.totalQuantity },
    get totalAmount()   { return store.totalAmount },
    get isEmpty()       { return store.isEmpty },
    // 方法
    setTable, addItem, removeItem, clearCart, getQuantityById,
    connectCartSync, disconnectCartSync,
  }
}
```

---

## 阶段四：扫码进桌与桌台识别

### 功能说明

顾客扫描桌台上的二维码 → 小程序解析出桌台ID → 验证桌台有效性 →
检查该桌是否有进行中的订单（有则直接跳到订单页，无则进菜单）。

**为什么要检查活跃订单？**

同桌的第二个顾客扫码进来，如果直接进菜单，他会创建一个新订单，
这样同一张桌就有两个独立订单，和真实餐厅场景不符（一桌一单）。
所以扫码时要先查"这张桌有没有正在进行的订单"，有的话直接跳过去共享。

**数据库**：

```sql
-- 查询桌台是否存在（验证 ID 有效性）
SELECT * FROM restaurant_table WHERE id = ?;

-- 查询该桌是否有活跃订单（status 不是已结账3 也不是已取消4）
SELECT o.*, t.table_number
FROM `order` o
LEFT JOIN restaurant_table t ON o.table_id = t.id
WHERE o.table_id = ? AND o.status NOT IN (3, 4)
ORDER BY o.created_at DESC;
-- 只取最新的一条（LIMIT 1 在 Java 里处理）
```

**后端层**：

新建 `backend/src/main/java/com/dingcan/entity/RestaurantTable.java`：

```java
@Data
@TableName("restaurant_table")
public class RestaurantTable {
    @TableId(type = IdType.AUTO)
    private Integer id;
    private String tableNumber;      // table_number → tableNumber（自动转换）
    private Integer capacity;
    private Integer isPrivateRoom;   // 0=普通桌台，1=包间
    private Integer status;          // 0=空闲，1=用餐中
    private String qrCodeUrl;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

新建 `backend/src/main/java/com/dingcan/controller/TableController.java`：

```java
@RestController
@RequestMapping("/api/tables")
@RequiredArgsConstructor
public class TableController {

    private final TableMapper tableMapper;

    // GET /api/tables/{id}（如：/api/tables/3）
    @GetMapping("/{id}")
    public Result<RestaurantTable> getTableById(@PathVariable Integer id) {
        // @PathVariable：从 URL 路径里提取变量
        // /api/tables/3 → id = 3
        RestaurantTable table = tableMapper.selectById(id);
        if (table == null) {
            return Result.notFound("桌台不存在，请重新扫码");
        }
        return Result.ok(table);
    }
}
```

**OrderController 新增活跃订单查询接口**：

在 `OrderController.java` 里新增：

```java
// GET /api/orders/active?tableId=3
@GetMapping("/active")
public Result<OrderDetailVO> getActiveOrderByTable(
        @RequestParam @NotNull Integer tableId) {
    // @NotNull：如果不传 tableId，Spring Validation 直接返回 400 错误

    OrderDetailVO active = orderService.getActiveOrderByTable(tableId);

    // 重要设计决策：无论有没有活跃订单，都返回 HTTP 200
    // 有订单：data = 订单详情对象
    // 没订单：data = null
    //
    // 如果返回 404，前端的 request.js 会自动弹出错误 toast
    // 但"没有活跃订单"不是错误，是正常情况，不应该弹 toast
    // 所以统一返回 200，前端判断 data 是否为 null 即可

    return Result.ok(active);
}
```

**前端层（UniApp 首页扫码逻辑）**：

新建 `frontend/pages/index/index.vue` 的关键部分：

```vue
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useCartStore } from '@/store/cart.js'
import { get } from '@/utils/request.js'
import { nextTick } from 'vue'

const cartStore = useCartStore()
const debugTableId = ref('1')  // 开发调试用，直接输入桌台ID

// 扫码进入时，options 里会有 tableId 参数
// 小程序二维码格式：/pages/index/index?tableId=3
onLoad(async (options) => {
  const tableId = options?.tableId || options?.scene
  // options.tableId：普通链接参数
  // options.scene：微信扫码时，参数会编码在 scene 字段里

  if (tableId) {
    await initTable(tableId)
  }
})

async function initTable(tableId) {
  try {
    uni.showLoading({ title: '加载中...', mask: true })
    // mask: true：加载时遮住整个页面，防止用户在加载过程中重复操作

    // 第一步：验证桌台
    const table = await get(`/api/tables/${tableId}`)
    const tableNumber = table.tableNumber || table.table_number || `${tableId}号桌`
    // 兼容两种格式：Spring Boot 返回 tableNumber，直查 DB 返回 table_number
    cartStore.setTable(table.id, tableNumber)

    // 第二步：查是否有活跃订单
    const activeOrder  = await get('/api/orders/active', { tableId: table.id })
    const activeOrderNo = activeOrder?.orderNo || activeOrder?.order_no || null
    // ?. 可选链：如果 activeOrder 是 null，不会报错，返回 undefined

    uni.hideLoading()
    await nextTick()
    // nextTick：等 Vue 完成当前渲染周期后再跳转
    // 防止在 H5 模式下 router 还没就绪就跳转导致的报错

    if (activeOrderNo) {
      // 有活跃订单：提示并跳到订单状态页
      uni.showToast({ title: '已有进行中的订单', icon: 'none', duration: 1500 })
      uni.reLaunch({ url: `/pages/order/status?orderNo=${activeOrderNo}` })
      // reLaunch：清空所有页面栈，用新页面替换
      // 适合扫码这种场景：用户直接到订单页，不保留历史页面
    } else {
      // 没有活跃订单：进入点餐菜单
      uni.reLaunch({
        url: `/pages/menu/index?tableId=${table.id}&tableName=${encodeURIComponent(tableNumber)}`,
        // encodeURIComponent：把"03号桌"编码为 URL 安全格式
        // 不编码的话，中文在 URL 里会乱码
      })
    }
  } catch (err) {
    console.error('[Index] 桌台加载失败', err)
    uni.hideLoading()
    uni.showToast({ title: '桌台不存在，请重新扫码', icon: 'none' })
  }
}
</script>
```

---

## 阶段五：提交订单

### 功能说明

顾客在确认页查看购物车内容，填写备注，点击提交。
后端需要验证菜品价格（防止前端篡改），写入数据库，更新桌台状态。

**为什么价格必须由后端查数据库？**

```
前端发来的数据：
{ tableId: 3, items: [{ dishId: 1, quantity: 2, price: 0.01 }] }
                                              ↑
                                         用户改成了1分钱！

后端正确做法：
只接受 dishId 和 quantity，自己去数据库查 price
所以用户改 price 也没用，后端不会用它
```

**数据库**（需要操作三张表）：

```sql
-- 在事务里执行，保证原子性

-- 1. 插入订单主记录
INSERT INTO `order` (order_no, table_id, total_amount, status, remark)
VALUES ('202605141830xxx', 3, 94.00, 0, '少辣');

-- 2. 插入每道菜的明细（假设 INSERT 后拿到 orderId=42）
INSERT INTO order_item (order_id, dish_id, dish_name, price, quantity, subtotal)
VALUES (42, 1, '红烧肉', 38.00, 1, 38.00);
INSERT INTO order_item (order_id, dish_id, dish_name, price, quantity, subtotal)
VALUES (42, 2, '宫保鸡丁', 28.00, 2, 56.00);

-- 3. 更新桌台状态为"用餐中"
UPDATE restaurant_table SET status = 1 WHERE id = 3;
```

**后端层（订单创建的完整实现）**：

首先创建 DTO（Data Transfer Object，数据传输对象），专门用于接收前端传来的参数：

新建 `backend/src/main/java/com/dingcan/dto/OrderCreateDTO.java`：

```java
package com.dingcan.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import java.util.List;

@Data
public class OrderCreateDTO {
    // 为什么要专门建一个 DTO？
    // 因为前端传来的数据结构不一定和数据库实体类一样
    // 比如：前端不传 price（服务端自己查），不传 status（默认0），不传 createdAt
    // DTO 专门描述"前端应该传什么"

    @NotNull(message = "桌台ID不能为空")
    private Integer tableId;

    private Integer userId;    // 可选（允许匿名点餐）
    private String remark;     // 可选

    @NotEmpty(message = "订单菜品不能为空")
    @Valid  // 触发列表内每个元素的校验
    private List<OrderItemDTO> items;

    @Data
    public static class OrderItemDTO {
        @NotNull(message = "菜品ID不能为空")
        private Integer dishId;

        @NotNull(message = "菜品数量不能为空")
        @Min(value = 1, message = "数量至少为1")
        private Integer quantity;
        // 注意：没有 price 字段！后端自己查，不信任前端传的价格
    }
}
```

新建 `backend/src/main/java/com/dingcan/dto/OrderDetailVO.java`：

```java
package com.dingcan.dto;

// VO（View Object）：专门用于返回给前端的数据结构
// 继承 Order，但额外添加了联表查询得到的字段（桌号、菜品列表、状态文字）

@Data
@EqualsAndHashCode(callSuper = true)
public class OrderDetailVO extends Order {
    private String tableNumber;    // 从 restaurant_table 表 JOIN 得到
    private List<OrderItem> items; // 从 order_item 表查出来的菜品列表
    private String statusText;     // 状态码转文字（如 1 → "制作中"）
}
```

在 `OrderServiceImpl.java` 里实现创建订单：

```java
@Override
@Transactional(rollbackFor = Exception.class)
// @Transactional 必须放在 public 方法上，且该方法要被 Spring 代理调用才生效
// rollbackFor = Exception.class：任何异常（包括受检异常）都回滚
public String createOrder(OrderCreateDTO dto) {

    // ── 第一步：校验输入 ─────────────────────────────────────────
    RestaurantTable table = tableMapper.selectById(dto.getTableId());
    if (table == null) {
        throw new RuntimeException("桌台不存在，tableId=" + dto.getTableId());
        // 抛出异常 → Spring 捕获 → 事务回滚 → Controller 的 catch 捕获 → 返回失败响应
    }

    // 防重复下单：同桌已有活跃订单时拒绝新建
    List<OrderDetailVO> active = baseMapper.findActiveOrdersByTable(dto.getTableId());
    if (active != null && !active.isEmpty()) {
        throw new RuntimeException("该桌台已有进行中的订单：" + active.get(0).getOrderNo());
    }

    // ── 第二步：从数据库查菜品价格，构建订单详情 ─────────────────
    List<OrderItem> items = new ArrayList<>();
    BigDecimal totalAmount = BigDecimal.ZERO;

    for (OrderCreateDTO.OrderItemDTO itemDto : dto.getItems()) {
        Dish dish = dishService.getById(itemDto.getDishId());
        if (dish == null || dish.getIsAvailable() != 1) {
            throw new RuntimeException("菜品不存在或已下架，dishId=" + itemDto.getDishId());
        }

        // 用数据库里的价格计算，不用前端传来的价格（安全）
        BigDecimal subtotal = dish.getPrice()
                .multiply(BigDecimal.valueOf(itemDto.getQuantity()));
        totalAmount = totalAmount.add(subtotal);

        OrderItem item = new OrderItem();
        item.setDishId(dish.getId());
        item.setDishName(dish.getName());  // 冗余：记录下单时的菜名
        item.setPrice(dish.getPrice());    // 冗余：记录下单时的价格
        item.setQuantity(itemDto.getQuantity());
        item.setSubtotal(subtotal);
        items.add(item);
    }

    // ── 第三步：生成订单编号 ─────────────────────────────────────
    String orderNo = OrderNoUtil.generate();
    // 格式：时间戳(17位) + 随机数(6位) = 23位，基本不会重复
    log.info("创建订单，桌台：{}，订单编号：{}", table.getTableNumber(), orderNo);

    // ── 第四步：保存到数据库（事务保护）────────────────────────────
    Order order = new Order();
    order.setOrderNo(orderNo);
    order.setTableId(dto.getTableId());
    order.setUserId(dto.getUserId());
    order.setTotalAmount(totalAmount);
    order.setStatus(0);  // 初始状态：待确认
    order.setRemark(dto.getRemark());
    save(order);
    // save() 来自 ServiceImpl，执行 INSERT INTO `order` ...
    // 执行后，order.getId() 会自动填入数据库分配的主键 ID（MyBatis-Plus 特性）

    for (OrderItem item : items) {
        item.setOrderId(order.getId());  // 关联到刚插入的订单 ID
        orderItemMapper.insert(item);
    }

    tableMapper.updateStatus(dto.getTableId(), 1);  // 桌台 → 用餐中

    // 通知所有在此桌的设备：购物车已清空（WebSocket 推送，见后面章节）
    tableCartWebSocketHandler.clearAndBroadcastEmpty(dto.getTableId());

    return orderNo;
    // 事务提交：三个数据库操作全部成功，数据永久保存
    // 如果任何一步抛出异常，@Transactional 会自动回滚所有操作
}
```

**前端层（确认页）**：

新建 `frontend/pages/order/confirm.vue`：

```vue
<template>
  <view class="confirm-page">
    <!-- 就餐信息 -->
    <view class="section">
      <view class="section-title">就餐信息</view>
      <view class="info-row">
        <text class="info-label">餐桌</text>
        <text class="info-value">{{ cartStore.tableNumber }}</text>
      </view>
    </view>

    <!-- 已选菜品 -->
    <view class="section">
      <view class="section-title">已选菜品</view>
      <view v-for="item in cartStore.items" :key="item.id" class="dish-row">
        <view class="dish-left">
          <text class="dish-name">{{ item.name }}</text>
          <text class="dish-price">¥{{ item.price.toFixed(2) }} × {{ item.quantity }}</text>
        </view>
        <text class="dish-subtotal">¥{{ (item.price * item.quantity).toFixed(2) }}</text>
      </view>
    </view>

    <!-- 备注 -->
    <view class="section">
      <view class="section-title">备注</view>
      <textarea
        class="remark-input"
        v-model="remark"
        placeholder="如：少放辣、不要香菜（选填）"
        maxlength="100"
        auto-height
      />
    </view>

    <!-- 底部提交区 -->
    <view class="submit-area safe-area-bottom">
      <view class="total-info">
        <text class="total-label">合计</text>
        <text class="total-amount">¥{{ cartStore.totalAmount.toFixed(2) }}</text>
      </view>
      <view
        class="submit-btn"
        :class="{ loading: submitting }"
        @tap="submitOrder"
      >
        {{ submitting ? '提交中...' : '提交订单' }}
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { useCartStore } from '@/store/cart.js'
import { get, post } from '@/utils/request.js'

const cartStore  = useCartStore()
const remark     = ref('')
const submitting = ref(false)  // 防止重复提交

async function submitOrder() {
  if (cartStore.isEmpty)  { uni.showToast({ title: '购物车为空', icon: 'none' }); return }
  if (!cartStore.tableId) { uni.showToast({ title: '请先扫描桌台二维码', icon: 'none' }); return }

  submitting.value = true  // 防止用户重复点击提交按钮
  try {
    // 先查有没有活跃订单（继续点餐场景：已有订单时改为"加菜"）
    const active = await get('/api/orders/active', { tableId: cartStore.tableId })
    const activeOrderNo = active?.orderNo || active?.order_no || null

    // 构建菜品列表（只传 dishId 和 quantity，后端自己查价格）
    const orderItems = cartStore.items.map(item => ({
      dishId:   item.id,
      quantity: item.quantity,
      // 注意：没有 price！这是关键安全设计
    }))

    let targetOrderNo

    if (activeOrderNo) {
      // 已有活跃订单：加菜（不新建订单）
      await post(`/api/orders/${activeOrderNo}/items`, { items: orderItems })
      targetOrderNo = activeOrderNo
      uni.showToast({ title: '加菜成功！', icon: 'success', duration: 1500 })
    } else {
      // 没有活跃订单：创建新订单
      targetOrderNo = await post('/api/orders', {
        tableId: cartStore.tableId,
        remark:  remark.value.trim() || null,
        items:   orderItems,
      })
      uni.showToast({ title: '下单成功！', icon: 'success', duration: 1500 })
    }

    cartStore.clearCart()  // 清空购物车（同时通过 WebSocket 通知同桌其他设备）

    // 1.5秒后跳转（等 toast 显示完）
    setTimeout(() => {
      uni.redirectTo({ url: `/pages/order/status?orderNo=${targetOrderNo}` })
      // redirectTo：替换当前页面（不保留确认页，防止用户返回重复提交）
    }, 1500)

  } catch (err) {
    console.error('[Confirm] 提交失败', err)
    // request.js 里已经处理了 toast，这里只需要打印日志
  } finally {
    submitting.value = false  // 无论成功失败，解除提交锁定
  }
}
</script>
```

---

## 阶段六：订单状态实时追踪

### 功能说明

顾客下单后跳到状态页，看到订单当前是"待确认/制作中/已上菜"，
状态变化时自动更新（不需要手动刷新）。

**技术方案：双重保障**

1. **WebSocket 推送（主要）**：管理员操作订单时，后端主动推送状态变更，实时响应
2. **轮询（兜底）**：万一 WebSocket 断线，每 5 秒主动查询一次，保证不漏状态

为什么要两种方式都用？
- 只用 WebSocket：网络不稳定时可能漏推，顾客看不到最新状态
- 只用轮询：最多有 5 秒延迟，且浪费服务器资源
- 两者结合：快 + 可靠

**数据库**（查询订单详情）：

```sql
-- 联表查询：订单 + 桌号（用 JOIN）
SELECT o.*, t.table_number
FROM `order` o
LEFT JOIN restaurant_table t ON o.table_id = t.id
WHERE o.order_no = '202605141830xxx';

-- 查询该订单的所有菜品明细
SELECT * FROM order_item
WHERE order_id = 42
ORDER BY id ASC;
```

**前端层（订单状态页）**：

新建 `frontend/pages/order/status.vue`：

```vue
<template>
  <view class="status-page">
    <view v-if="loading && !order" class="loading-area">
      <view class="loading-spinner" />
      <text class="loading-text">加载订单信息...</text>
    </view>

    <template v-else-if="order">
      <!-- 状态头部：颜色和内容随状态动态变化 -->
      <view class="status-header" :style="{ borderColor: statusInfo.color }">
        <text class="status-emoji">{{ statusInfo.emoji }}</text>
        <text class="status-text">{{ statusInfo.text }}</text>
        <text class="status-desc">{{ statusInfo.desc }}</text>
        <!-- 制作中时显示跳动动画 -->
        <view v-if="order.status === 1" class="cooking-animation">
          <text v-for="(dot, i) in 3" :key="i" class="cooking-dot"
                :style="{ animationDelay: i * 0.3 + 's' }">●</text>
        </view>
      </view>

      <!-- 订单基本信息 -->
      <view class="section">
        <view class="row">
          <text class="row-label">桌号</text>
          <text class="row-value">{{ order.tableNumber }}</text>
        </view>
        <view class="row">
          <text class="row-label">下单时间</text>
          <text class="row-value">{{ formatTime(order.createdAt) }}</text>
        </view>
      </view>

      <!-- 菜品明细 -->
      <view class="section">
        <view class="section-title">菜品明细</view>
        <view v-for="item in order.items" :key="item.id" class="dish-row">
          <text class="dish-name">{{ item.dishName }}</text>
          <text class="dish-qty">× {{ item.quantity }}</text>
          <text class="dish-price">¥{{ parseFloat(item.subtotal).toFixed(2) }}</text>
        </view>
      </view>

      <!-- 合计 -->
      <view class="total-section">
        <text class="total-label">合计</text>
        <text class="total-amount">¥{{ parseFloat(order.totalAmount).toFixed(2) }}</text>
      </view>

      <!-- 操作区域 -->
      <view class="action-area safe-area-bottom">
        <!-- status < 3 表示未完成（0待确认、1制作中、2已上菜），显示"继续点餐" -->
        <view v-if="order.status < 3" class="action-btn secondary" @tap="goBackToMenu">
          继续点餐
        </view>
        <view v-if="order.status === 3" class="checkout-tip">🎉 感谢惠顾，欢迎再来！</view>
        <view class="action-btn primary" @tap="fetchOrder">刷新状态</view>
      </view>
    </template>

    <view v-else class="empty-area">
      <text class="empty-icon">📋</text>
      <text class="empty-text">订单不存在</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { get } from '@/utils/request.js'
import config from '@/utils/config.js'
import { useCartStore } from '@/store/cart.js'

const cartStore = useCartStore()
const orderNo   = ref('')
const order     = ref(null)
const loading   = ref(false)
let pollTimer   = null

// 状态码对应的显示配置（颜色、文字、表情、描述）
// 用对象映射替代 if-else，代码更简洁
const STATUS_MAP = {
  0: { text: '待确认', color: '#e6a23c', desc: '已收到订单，等待商家确认...', emoji: '⏳' },
  1: { text: '制作中', color: '#409eff', desc: '厨房正在精心制作，请稍候...', emoji: '👨‍🍳' },
  2: { text: '已上菜', color: '#67c23a', desc: '菜品已上桌，请慢用！',       emoji: '🍽️' },
  3: { text: '已结账', color: '#909399', desc: '感谢光临，欢迎再来！',       emoji: '✅' },
  4: { text: '已取消', color: '#f56c6c', desc: '订单已取消',               emoji: '❌' },
}

// computed：依赖 order.value.status，status 变化时自动重新计算
// 不用在每个用到状态显示的地方都写一遍判断逻辑
const statusInfo = computed(() => {
  if (!order.value) return {}
  return STATUS_MAP[order.value.status] || { text: '未知', color: '#909399', desc: '', emoji: '❓' }
})

onLoad((options) => {
  orderNo.value = options.orderNo || ''
  if (!orderNo.value) {
    uni.showToast({ title: '订单编号无效', icon: 'none' })
    return
  }

  fetchOrder()  // 立即查询一次

  // 启动轮询（兜底：WebSocket 断线时也能更新）
  pollTimer = setInterval(() => {
    // 只有订单未完成时才继续轮询
    if (order.value && order.value.status < 3) {
      fetchOrder()
    }
  }, config.POLL_INTERVAL)  // 每 5 秒查一次
})

onUnload(() => {
  // 页面销毁时清除定时器（非常重要！）
  // 如果不清除，用户离开这个页面后，定时器仍在后台运行，一直发请求，造成内存泄漏
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
})

async function fetchOrder() {
  loading.value = true
  try {
    order.value = await get(`/api/orders/${orderNo.value}`)

    // 关键细节：刷新页面后 cartStore 内存状态丢失（JavaScript 内存不持久）
    // 从订单数据里恢复桌台信息，防止"继续点餐"功能失效
    const tid   = order.value.tableId   ?? order.value.table_id
    const tname = order.value.tableNumber ?? order.value.table_number ?? ''
    if (tid && !cartStore.tableId) {
      cartStore.setTable(tid, tname)
    }

    // 达到终态：停止轮询（已结账或已取消，不需要再查了）
    if (order.value.status >= 3 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  } catch (err) {
    console.error('[Status] 查询订单失败', err)
  } finally {
    loading.value = false
  }
}

// "继续点餐"按钮的处理
// 特殊情况：刷新页面后 cartStore.tableId 为 null（内存清空了）
// 解决：用订单数据里的桌台信息作为兜底
function goBackToMenu() {
  // 三级兜底：1. cartStore中有 → 2. 订单里驼峰格式 → 3. 订单里下划线格式
  const tid   = cartStore.tableId
                || order.value?.tableId
                || order.value?.table_id

  const tname = cartStore.tableNumber
                || order.value?.tableNumber
                || order.value?.table_number
                || ''

  if (tid) {
    if (!cartStore.tableId) cartStore.setTable(tid, tname)
    uni.navigateTo({
      url: `/pages/menu/index?tableId=${tid}&tableName=${encodeURIComponent(tname)}`
    })
  } else {
    uni.navigateBack()  // 实在没有桌台信息，就返回上一页
  }
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const p = n => n.toString().padStart(2, '0')  // 补零：1 → 01
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>
```

---

## 阶段七：管理端基础工程

### 功能说明

商家通过浏览器访问管理端（localhost:3000），登录后可以管理菜品和处理订单。

**Nuxt 3 管理端的架构特点**：

```
browser (vue) ←→ Nuxt server (node.js) ←→ MySQL
     前端渲染      服务端API（直连数据库）
```

与 Spring Boot 相比，Nuxt 服务端直接操作数据库，无需中间层。
适合管理端这类操作频繁但逻辑简单的场景。

**第一步：配置文件**

新建 `admin/.env`（不要提交到 git，里面有密码）：

```bash
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456   # ← 改成你的 MySQL 密码
DB_NAME=dingcan

ADMIN_PASSWORD=admin123  # 管理端登录密码

BACKEND_API_BASE=http://localhost:8888  # Spring Boot 后端地址（WebSocket 推送用）
NUXT_PUBLIC_WS_BASE_URL=ws://localhost:8888
```

**第二步：数据库工具类**

Nuxt 服务端 API 都会用到数据库，把数据库操作封装成工具函数：

新建 `admin/server/utils/db.ts`：（见文件，前面已有完整代码）

**第三步：认证工具**

新建 `admin/server/utils/auth.ts`：

```typescript
// 简单的 Cookie 认证（生产环境建议用 JWT）
import { H3Event, getCookie, createError } from 'h3'

export const AUTH_COOKIE = 'admin_token'
const VALID_TOKEN = 'dingcan_admin_logged_in'

export function requireAuth(event: H3Event): void {
  const token = getCookie(event, AUTH_COOKIE)
  if (token !== VALID_TOKEN) {
    throw createError({
      statusCode: 401,
      statusMessage: '未登录，请先登录',
    })
    // createError + throw：抛出 HTTP 错误
    // Nitro 自动返回 { statusCode: 401, statusMessage: '...' } 响应
    // 函数立即终止，后面的代码不执行
  }
}

export function getValidToken(): string { return VALID_TOKEN }
```

**第四步：全局路由中间件（拦截所有未登录访问）**

新建 `admin/middleware/auth.global.ts`：

```typescript
// .global 后缀：全局中间件，每次路由跳转都会执行
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/login') return
  // 登录页不拦截（防止无限重定向）

  const token = useCookie('admin_token')
  if (!token.value) {
    return navigateTo('/login')
    // 没有 token → 跳转到登录页
  }
})
```

**第五步：登录接口**

新建 `admin/server/api/auth/login.post.ts`：

```typescript
import { setCookie } from 'h3'
import { getValidToken, AUTH_COOKIE } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const { password } = await readBody(event)
  const config = useRuntimeConfig()

  if (password !== config.adminPassword) {
    throw createError({ statusCode: 401, statusMessage: '密码错误' })
  }

  setCookie(event, AUTH_COOKIE, getValidToken(), {
    httpOnly: true,              // JS 无法读取（防 XSS）
    maxAge: 60 * 60 * 24 * 7,   // 7天有效期
    path: '/',
    sameSite: 'lax',             // 防 CSRF
  })

  return { message: '登录成功' }
})
```

---

## 阶段八：管理端菜品管理

### 功能说明

商家可以查看所有菜品列表，添加新菜品，编辑菜品信息（涨价、改描述），
切换上下架状态，删除不需要的菜品，以及上传菜品图片。

**Nuxt 服务端 API 的开发模式**：

每个 API 对应一个 `.ts` 文件，文件名决定路由和方法：

```
server/api/dishes/index.get.ts   → GET  /api/dishes  （查询列表）
server/api/dishes/index.post.ts  → POST /api/dishes  （新增菜品）
server/api/dishes/[id].put.ts    → PUT  /api/dishes/:id （修改菜品）
server/api/dishes/[id].delete.ts → DELETE /api/dishes/:id （删除菜品）
```

新建 `admin/server/api/dishes/index.get.ts`（查询菜品列表）：

```typescript
import { query } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const q = getQuery(event)
  const categoryId = q.categoryId     // 可选：按分类过滤
  const page       = parseInt((q.page as string) || '1')
  const pageSize   = parseInt((q.pageSize as string) || '50')
  // parseInt 注意：'1a' → 1（只取数字部分），不是 NaN
  // 所以加 || '1' 确保在参数缺失时有默认值

  const offset = (page - 1) * pageSize

  // 动态 SQL：条件可选
  let sql = `
    SELECT d.*, c.name AS category_name
    FROM dish d
    LEFT JOIN category c ON d.category_id = c.id
  `
  // 联表查询：同时拿到分类名称，前端直接用，不用二次查询

  const params: any[] = []
  if (categoryId) {
    sql += ' WHERE d.category_id = ?'
    params.push(categoryId)
  }

  sql += ' ORDER BY d.category_id ASC, d.sort_order ASC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)

  const dishes = await query(sql, params)

  // 查总数（分页控件需要）
  let countSql = 'SELECT COUNT(*) AS total FROM dish'
  const countParams: any[] = []
  if (categoryId) { countSql += ' WHERE category_id = ?'; countParams.push(categoryId) }
  const countResult = await query(countSql, countParams)
  const total = (countResult[0] as any).total

  return { list: dishes, total, page, pageSize }
})
```

新建 `admin/server/api/dishes/index.post.ts`（新增菜品）：

```typescript
import { execute } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody(event)
  // readBody：解析请求体的 JSON 数据
  const { categoryId, name, price, description, imageUrl, sortOrder } = body

  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: '菜品名称不能为空' })
  if (!categoryId)   throw createError({ statusCode: 400, statusMessage: '请选择分类' })
  if (!price || price <= 0) throw createError({ statusCode: 400, statusMessage: '价格无效' })

  const result = await execute(
    `INSERT INTO dish (category_id, name, description, price, image_url, is_available, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    // ? 占位符（防 SQL 注入）：
    // 所有参数通过 mysql2 安全处理，特殊字符自动转义
    // 不能写：`...VALUES (${categoryId}, '${name}'...)`（危险！会被 SQL 注入）
    [categoryId, name.trim(), description || null, parseFloat(price), imageUrl || null, sortOrder || 0]
  )

  return { id: result.insertId, message: '菜品创建成功' }
  // result.insertId：MySQL 分配的新菜品 ID（返回给前端，方便后续操作）
})
```

新建 `admin/server/api/dishes/[id].put.ts`（编辑菜品）：

```typescript
import { execute, query } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const id   = getRouterParam(event, 'id')
  // getRouterParam：从 URL 路径里取变量
  // PUT /api/dishes/5 → id = '5'

  const body = await readBody(event)
  const { categoryId, name, description, price, imageUrl, isAvailable, sortOrder } = body

  // 检查菜品存在
  const rows = await query('SELECT id FROM dish WHERE id = ?', [id])
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: '菜品不存在' })

  // COALESCE(?, column)：如果 ? 是 NULL，保持原列的值不变
  // 这是"部分更新"的技巧：只更新传了的字段，不传的字段保持原值
  // 例如：只传 isAvailable=0（下架），其他字段不传 → 只改上下架状态
  await execute(
    `UPDATE dish SET
      category_id  = COALESCE(?, category_id),
      name         = COALESCE(?, name),
      description  = ?,
      price        = COALESCE(?, price),
      image_url    = ?,
      is_available = COALESCE(?, is_available),
      sort_order   = COALESCE(?, sort_order),
      updated_at   = NOW()
     WHERE id = ?`,
    [
      categoryId ?? null,         // ?? null：如果没传，设为 null，COALESCE 保持原值
      name?.trim() ?? null,
      description !== undefined ? description : undefined,  // 描述允许清空（传空字符串）
      price != null ? parseFloat(price) : null,
      imageUrl !== undefined ? imageUrl : undefined,
      isAvailable ?? null,
      sortOrder ?? null,
      id
    ]
  )

  return { message: '更新成功' }
})
```

**前端层（管理端菜品页核心逻辑）**：

管理端前端页面放在 `admin/pages/menu/dishes.vue`，关键逻辑：

```typescript
// 打开编辑弹窗时，把现有数据填入表单
function openDialog(dish?: any) {
  editingDish.value = dish || null

  if (dish) {
    // 编辑模式：用现有菜品数据填充表单
    Object.assign(dishForm, {
      categoryId:  dish.category_id,  // 列表接口返回下划线格式
      name:        dish.name,
      price:       parseFloat(dish.price),
      description: dish.description || '',
      imageUrl:    dish.image_url || '',
      sortOrder:   dish.sort_order || 0,
    })
  } else {
    // 新增模式：清空表单
    Object.assign(dishForm, { categoryId: null, name: '', price: 0, description: '', imageUrl: '', sortOrder: 0 })
  }
  dialogVisible.value = true
}

// 切换上下架（乐观更新：先改本地，再同步服务器）
async function toggleAvailable(dish: any) {
  const newStatus = dish.is_available === 1 ? 0 : 1
  try {
    await $fetch(`/api/dishes/${dish.id}`, {
      method: 'PUT',
      body: { isAvailable: newStatus },
      // 只传这一个字段，其他字段 COALESCE 保持不变
    })
    dish.is_available = newStatus
    // 乐观更新：不重新请求列表，直接修改本地数据
    // 如果请求失败（catch 了），可以把 dish.is_available 改回来
    ElMessage.success(newStatus === 1 ? '已上架' : '已下架')
  } catch {
    ElMessage.error('操作失败')
  }
}
```

---

## 阶段九：管理端订单管理

### 功能说明

商家查看订单列表，执行"接单→出餐→结账"流程。
支持今日订单/历史订单分 Tab，分页，状态筛选，日期范围筛选。

**"今日"和"历史"为什么要分 Tab？**

- 今日 Tab：商家最关心的是"现在"有哪些单要处理，默认查今天，实时刷新
- 历史 Tab：查账用，看过去某段时间的数据，不需要实时刷新

分 Tab 的好处：
1. 今日 Tab 数据量小（就今天几十单），查询很快
2. 历史 Tab 只在需要时查，不浪费资源

**Nuxt 服务端 API**：

新建 `admin/server/api/orders/index.get.ts`（查询订单列表）：

```typescript
import { query } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/auth'

const STATUS_TEXT: Record<number, string> = {
  0: '待确认', 1: '制作中', 2: '已上菜', 3: '已结账', 4: '已取消',
}

// ⚠️ 关键函数：addDays 必须用本地日期，不能用 toISOString()
// toISOString() 返回 UTC 时间，在 UTC+8 机器上会差 8 小时！
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)  // 本地时间构造
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
}

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const q = getQuery(event)
  const status   = q.status
  const dateFrom = q.dateFrom as string | undefined
  const dateTo   = q.dateTo   as string | undefined
  const page     = Math.max(1, parseInt((q.page as string) || '1'))
  const pageSize = Math.max(1, parseInt((q.pageSize as string) || '20'))

  const where: string[] = []
  const params: any[]   = []

  // 状态筛选（支持单选 "3" 和多选 "3,4"）
  if (status && status !== '') {
    const statusStr = status as string
    if (statusStr.includes(',')) {
      // 多选：WHERE status IN (3, 4)
      const values = statusStr.split(',').map(s => parseInt(s)).filter(n => !isNaN(n))
      where.push(`o.status IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    } else {
      where.push('o.status = ?')
      params.push(parseInt(statusStr))
    }
  }

  // 日期范围筛选
  // ✅ 用范围比较（走 idx_created_at 索引）
  // ❌ 不用 DATE() 函数（会让索引失效，全表扫描）
  if (dateFrom) {
    where.push('o.created_at >= ?')
    params.push(`${dateFrom} 00:00:00`)     // 当天开始
  }
  if (dateTo) {
    where.push('o.created_at < ?')
    params.push(`${addDays(dateTo, 1)} 00:00:00`)  // 下一天开始（包含当天全天）
  }

  const whereSql = where.length > 0 ? ' WHERE ' + where.join(' AND ') : ''

  // 先查总数（分页需要）
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM \`order\` o${whereSql}`, params) as any[]

  // 再查分页数据
  const offset   = (page - 1) * pageSize
  const listRows = await query(
    `SELECT o.*, t.table_number
     FROM \`order\` o
     LEFT JOIN restaurant_table t ON o.table_id = t.id
     ${whereSql}
     ORDER BY o.created_at DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  )

  // 为每个订单附加菜品明细和状态文字
  const list = await Promise.all(
    listRows.map(async (order: any) => {
      const items = await query(
        'SELECT * FROM order_item WHERE order_id = ? ORDER BY id ASC',
        [order.id]
      )
      return { ...order, items, statusText: STATUS_TEXT[order.status] ?? '未知' }
    })
  )

  return { total, list, page, pageSize }
})
```

新建 `admin/server/api/orders/[id]/status.put.ts`（更新订单状态）：

```typescript
import { query, transaction } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const runtimeConfig = useRuntimeConfig()

  const id = getRouterParam(event, 'id')
  const { status } = await readBody(event)

  if (![0, 1, 2, 3, 4].includes(status)) {
    throw createError({ statusCode: 400, statusMessage: '无效的状态值' })
  }

  const orders = await query('SELECT * FROM `order` WHERE id = ?', [id])
  if (!orders.length) throw createError({ statusCode: 404, statusMessage: '订单不存在' })
  const order = orders[0] as any

  // 使用事务：结账时需要同时更新订单状态 + 桌台状态
  // 必须是原子操作，防止一个成功一个失败的脏数据
  await transaction(async (conn) => {
    await conn.execute(
      'UPDATE `order` SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, id]
    )
    if (status === 3) {  // 结账：桌台 → 空闲
      await conn.execute(
        'UPDATE restaurant_table SET status = 0, updated_at = NOW() WHERE id = ?',
        [order.table_id]
      )
    }
  })

  // 通知 Spring Boot 后端：通过 WebSocket 推送状态变化给用户端
  // 用 try/catch 包裹：推送失败不影响主流程（状态已成功更新）
  try {
    await $fetch(`${runtimeConfig.backendApiBase}/api/order-events/status`, {
      method: 'POST',
      body: { orderNo: order.order_no, status },
    })
  } catch (err) {
    console.warn('[notify] WebSocket 推送失败，忽略')
  }

  return { message: '状态更新成功' }
})
```

---

## 阶段十：WebSocket 实时推送

### 功能说明

管理员点击"接单"按钮后，顾客手机上的订单状态几乎立刻变为"制作中"，
无需手动刷新，体验流畅。

**工作原理**：

```
管理员点击"接单"
  ↓
Nuxt API 更新数据库（status: 0 → 1）
  ↓
Nuxt API 调用 Spring Boot 的 /api/order-events/status
  ↓
Spring Boot 的 OrderNotifyController 接收
  ↓
调用 OrderStatusWebSocketHandler.broadcastOrderStatus()
  ↓
推送消息给所有已连接的客户端：
  - 管理端（role=admin）：刷新订单列表
  - 订阅该订单的用户端（role=user&orderNo=xxx）：更新状态显示
```

**为什么订单状态推送走 Spring Boot 而不是 Nuxt？**

因为 WebSocket 连接需要一个**持久的服务端**来维护。
Nuxt 在开发模式下会热重载（代码改了自动重启），重启后 WebSocket 连接就断了。
Spring Boot 更稳定，适合维护长连接。

另外，用户端（UniApp）直接连接 Spring Boot 的 WebSocket，
而管理端更新订单后通知 Spring Boot 触发推送。这样两边都用同一个 WebSocket 服务。

后端代码在 `backend/src/main/java/com/dingcan/websocket/` 下，
详细代码见 `docs/03-后端核心.md`。

**管理端 WebSocket 客户端代码**（在 `admin/pages/orders/index.vue` 里）：

```typescript
let ws: WebSocket | null = null

function connectWebSocket() {
  // 必须检查 window 对象！
  // Nuxt 3 有 SSR（服务端渲染），在 Node.js 服务端执行时没有 window
  // WebSocket 只在浏览器（客户端）才有
  if (typeof window === 'undefined') return
  if (ws) return  // 已连接，不重复连接

  ws = new WebSocket('ws://localhost:8888/ws/orders?role=admin')

  ws.onopen = () => {
    // 连接成功后清除重连计时器（如果有的话）
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  }

  ws.onmessage = () => {
    // 收到任何消息，刷新订单列表
    // 消息类型可以是：新订单、订单状态变更
    if (activeTab.value === 'today') {
      fetchOrders()
      // 只有查看今日数据时才自动刷新
      // 查看历史数据时，新消息不应该影响（避免打断分析历史数据）
    }
  }

  ws.onclose = () => {
    ws = null
    if (!manuallyClosed) {
      // 非主动关闭（意外断线）：3秒后自动重连
      reconnectTimer = setTimeout(connectWebSocket, 3000)
    }
  }

  ws.onerror = () => { ws?.close() }
}

// 页面加载时建立连接
onMounted(() => {
  fetchOrders()
  pollTimer = setInterval(fetchOrders, 30_000)  // 30秒轮询兜底
  connectWebSocket()
})

// 页面销毁时断开连接（释放资源）
onUnmounted(() => {
  if (pollTimer) { clearInterval(pollTimer) }
  manuallyClosed = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (ws) { ws.close(); ws = null }
})
```

---

## 阶段十一：菜品图片上传

### 功能说明

管理员在添加/编辑菜品时，可以上传菜品图片（JPG/PNG/WebP，最大5MB）。
图片保存在管理端服务器，顾客通过绝对 URL 访问图片。

**为什么图片 URL 要存绝对路径（包含域名）？**

图片保存在 Nuxt 管理端（localhost:3000），
但顾客手机请求图片时走的是 Spring Boot（localhost:8888）。

如果数据库存的是相对路径 `/uploads/xxx.jpg`，
顾客手机会去请求 `localhost:8888/uploads/xxx.jpg`，
但 Spring Boot 服务器根本没有这个文件！

所以必须存绝对路径：`http://localhost:3000/uploads/xxx.jpg`，
这样无论从哪里请求，都能找到文件。

**文件上传 API**（`admin/server/api/upload/image.post.ts`）：

```typescript
import { readMultipartFormData } from 'h3'
// readMultipartFormData：解析上传的文件（multipart/form-data 格式）
import { writeFile, mkdir } from 'fs/promises'  // 文件系统操作（写文件、创建目录）
import { join, extname } from 'path'             // 路径操作
import { requireAuth } from '~/server/utils/auth'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_SIZE      = 5 * 1024 * 1024  // 5MB = 5 × 1024 × 1024 字节

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const parts = await readMultipartFormData(event)
  // parts 是一个数组，包含所有上传的字段
  // 格式：[{ name: 'file', filename: 'dish.jpg', type: 'image/jpeg', data: Buffer }]

  const file = parts?.find(p => p.name === 'file')
  // 找到字段名为 'file' 的文件（和前端 el-upload 的 name="file" 对应）

  // 校验
  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: '请上传图片文件' })
  if (!ALLOWED_TYPES.has(file.type ?? '')) {
    throw createError({ statusCode: 400, statusMessage: '只支持 JPG/PNG/WebP/GIF 格式' })
  }
  if (file.data.length > MAX_SIZE) {
    throw createError({ statusCode: 400, statusMessage: '图片不能超过 5MB' })
  }

  // 生成唯一文件名（防止同名文件覆盖）
  const ext      = extname(file.filename ?? '.jpg') || '.jpg'
  // extname('dish.jpg') → '.jpg'
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`
  // Date.now()：13位时间戳（毫秒）
  // Math.random().toString(36)：如 '0.k4j5m'，slice(2) 去掉 '0.'
  // 结果如：1715676543123_k4j5m.jpg

  // 保存到 public/uploads/dishes/ 目录
  const uploadDir = join(process.cwd(), 'public', 'uploads', 'dishes')
  // process.cwd()：当前工作目录（admin/ 文件夹）
  // join：拼接路径（自动处理 / 分隔符）

  await mkdir(uploadDir, { recursive: true })
  // recursive: true：父目录不存在时自动创建，且不报错（幂等）

  await writeFile(join(uploadDir, filename), file.data)
  // file.data 是 Buffer（二进制数据），直接写入文件

  // 返回完整 URL（包含域名）
  const siteUrl = process.env.NUXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
    || `${getRequestProtocol(event)}://${getRequestHost(event)}`
  // getRequestHost(event)：从请求 Header 里取 Host，如 'localhost:3000'

  return { url: `${siteUrl}/uploads/dishes/${filename}` }
  // 返回如：{ url: 'http://localhost:3000/uploads/dishes/1715676543123_k4j5m.jpg' }
})
```

**为什么还需要 `server/routes/uploads/[...slug].get.ts`？**

Nuxt 3 开发模式下，Vite 的静态文件服务在启动时扫描 `public/` 目录。
**运行时上传的新文件不在扫描范围内**，请求会穿透到 Vue Router，
Router 找不到对应路由，就报 "No match found" 的警告，图片无法访问。

解决方案：自己写一个路由来提供文件，每次请求都读磁盘：

新建 `admin/server/routes/uploads/[...slug].get.ts`：

```typescript
import { readFile } from 'fs/promises'
import { join, extname } from 'path'

// MIME 类型映射：告诉浏览器这是什么类型的文件
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.webp': 'image/webp', '.gif': 'image/gif',
}

export default defineEventHandler(async (event) => {
  // 从 URL 取文件路径（catch-all 路由）
  // URL: /uploads/dishes/xxx.jpg → slug = 'dishes/xxx.jpg'
  const slug = (event.context.params as any)?.slug as string | string[]
  if (!slug) throw createError({ statusCode: 404 })

  const relativePath = Array.isArray(slug) ? slug.join('/') : slug
  const filePath     = join(process.cwd(), 'public', 'uploads', relativePath)

  try {
    const data        = await readFile(filePath)  // 读取文件为 Buffer
    const contentType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'

    setHeader(event, 'Content-Type', contentType)  // 设置文件类型
    setHeader(event, 'Cache-Control', 'public, max-age=86400')  // 浏览器缓存 1 天
    return data  // 返回 Buffer，Nitro 自动作为二进制响应
  } catch {
    throw createError({ statusCode: 404, statusMessage: '文件不存在' })
  }
})
```

---

## 阶段十二：数据看板与趋势图

### 功能说明

商家打开看板页，看到今日营业额、订单数、各状态分布，以及近期营业趋势图。
趋势图可以切换"近30天/近12月/近8季度/近5年"维度。

**ECharts 图表库**

ECharts 是百度开源的 JavaScript 图表库，功能强大。
在 Nuxt 3 中使用有个陷阱：ECharts 需要操作 DOM（浏览器里的节点），
但 Nuxt 3 会在 Node.js 服务端渲染（SSR），服务端没有 DOM，会报错。

解决方案：把图表组件命名为 `RevenueChart.client.vue`。
`.client` 后缀是 Nuxt 的特殊约定：这个组件只在浏览器（客户端）渲染，服务端跳过。

新建 `admin/components/RevenueChart.client.vue`：

```vue
<template>
  <div ref="chartEl" class="chart-container" />
  <!-- ref="chartEl"：模板引用，JavaScript 里通过 chartEl.value 访问这个 DOM 元素 -->
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts/core'

// 按需引入（不是 import * from 'echarts'，减少打包体积）
import { LineChart, BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, BarChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer])

const props = defineProps<{
  labels:  string[]   // X 轴标签（日期）
  revenue: number[]   // 营业额数据
  orders:  number[]   // 订单数据
  period:  string     // 周期（day/month/quarter/year）
}>()

const chartEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

function buildOption() {
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      data: ['营业额（元）', '订单数'],
      left: 'center',  // 图例居中
      top: 4,
    },
    grid: { left: 70, right: 60, top: 40, bottom: 40 },
    xAxis: {
      type: 'category',
      data: props.labels,
      axisLabel: { rotate: props.labels.length > 12 ? 30 : 0 },
      // 标签太多时旋转 30 度，防止重叠
    },
    yAxis: [
      {
        // 左轴：营业额（红色）
        type: 'value', name: '营业额（元）', position: 'left',
        axisLabel: { formatter: (v: number) => `¥${v}`, color: '#f56c6c' },
        axisLine: { show: true, lineStyle: { color: '#f56c6c' } },
        splitLine: { lineStyle: { type: 'dashed', color: '#f5f5f5' } },
      },
      {
        // 右轴：订单数（蓝色）
        type: 'value', name: '订单数', position: 'right',
        axisLabel: { color: '#409eff' },
        axisLine: { show: true, lineStyle: { color: '#409eff' } },
        splitLine: { show: false },  // 只显示左轴的网格线，右轴不显示（避免双重格线）
        minInterval: 1,  // 最小刻度为 1（订单数是整数）
      },
    ],
    series: [
      {
        name: '营业额（元）', type: 'line', yAxisIndex: 0,
        data: props.revenue, smooth: true,  // smooth: 平滑曲线
        lineStyle: { color: '#f56c6c', width: 2.5 },
        areaStyle: {
          // 渐变填充
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(245,108,108,0.35)' },  // 顶部颜色
            { offset: 1, color: 'rgba(245,108,108,0.02)' },  // 底部颜色
          ]),
        },
      },
      {
        name: '订单数', type: 'bar', yAxisIndex: 1,
        data: props.orders, barMaxWidth: 28,
        itemStyle: { color: 'rgba(64,158,255,0.7)', borderRadius: [3,3,0,0] },
        // borderRadius：柱子顶部圆角，更好看
      },
    ],
  }
}

onMounted(() => {
  // nextTick：等 DOM 渲染完成后再初始化图表（否则 chartEl.value 可能还是 null）
  nextTick(() => {
    chart = echarts.init(chartEl.value!)
    chart.setOption(buildOption())
  })
  // 窗口大小变化时重新计算图表尺寸
  window.addEventListener('resize', () => chart?.resize())
})

// 数据变化时更新图表
watch(
  () => [props.labels, props.revenue, props.orders],
  async () => {
    await nextTick()
    if (chart) {
      chart.setOption(buildOption(), true)
      // true：清除旧数据（防止数据堆积）
    }
  }
)

onUnmounted(() => {
  window.removeEventListener('resize', () => chart?.resize())
  chart?.dispose()  // 销毁图表实例，释放 canvas 内存
  chart = null
})
</script>

<style scoped>
.chart-container { width: 100%; height: 320px; }
</style>
```
