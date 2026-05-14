# 第一部分：从零开始学全栈开发

> 本章假设你从来没写过代码。我们用"扫码点餐系统"这个真实项目来学习，
> 每个概念都有对应的项目代码示例。跟着读完这章，你就有能力看懂整个项目。

---

## 第 1 节：编程到底是什么？

### 1.1 程序就是"菜谱"

想象你是厨师，"做红烧肉"的菜谱是这样的：

```
1. 把五花肉切成 2cm 见方的块
2. 锅里倒油，烧至七成热
3. 放入肉块，翻炒至表面金黄
4. 加入酱油、冰糖、料酒
5. 加水没过肉，小火炖 40 分钟
6. 收汁，出锅
```

计算机程序就是写给**计算机**看的"菜谱"——一步一步告诉它该做什么。

```javascript
// 这是一段 JavaScript 程序，就像菜谱一样，从上到下执行
let price = 38          // 第一步：记住价格是 38
let quantity = 2        // 第二步：记住数量是 2
let total = price * quantity  // 第三步：计算总价
console.log(total)      // 第四步：打印结果 → 76
```

### 1.2 变量：程序的"记事本"

变量就是给一块内存取个名字，用来存放数据：

```javascript
// 声明变量并赋值
let dishName = "红烧肉"   // 字符串（文字）
let price = 38.00        // 数字
let isAvailable = true   // 布尔值（真/假）

// 修改变量的值
price = 42.00            // 价格涨了
console.log(price)       // 打印：42

// 本项目里的变量（frontend/pages/menu/index.vue）：
const categories = ref([])   // 存放分类列表（空数组，待填充）
const tableNumber = ref('')  // 存放桌台名称（空字符串，待填充）
const loading = ref(false)   // 是否正在加载（初始为否）
```

### 1.3 函数：把代码打包起来重复使用

函数就像"子程序"，把一段代码打包起来，需要时调用：

```javascript
// 定义函数（写菜谱）
function add(a, b) {
    return a + b  // 计算并返回结果
}

// 调用函数（按菜谱做）
let result = add(3, 5)  // result = 8

// 本项目里的函数（frontend/pages/menu/index.vue）：
// 定义：加载菜单数据
async function loadMenu() {
    const [catsData, dishesData] = await Promise.all([
        get('/api/categories'),
        get('/api/dishes'),
    ])
    categories.value = catsData
    dishes.value = dishesData
}

// 调用：在页面加载完成时执行
loadMenu()
```

### 1.4 条件判断：程序的"如果……那么……"

```javascript
// if-else：如果……就……否则……
let status = 1

if (status === 0) {
    console.log("待确认")
} else if (status === 1) {
    console.log("制作中")   // ← 执行这里
} else if (status === 2) {
    console.log("已上菜")
} else {
    console.log("其他状态")
}

// 本项目里的条件判断（frontend/pages/order/status.vue）：
// 订单状态 < 3 才继续轮询
if (order.value && order.value.status < 3) {
    fetchOrder()  // 继续查询
}
// 到达终态（结账/取消），停止轮询
if (order.value.status >= 3 && pollTimer) {
    clearInterval(pollTimer)
}
```

### 1.5 循环：重复做同一件事

```javascript
// for 循环：做 3 遍
for (let i = 0; i < 3; i++) {
    console.log("第" + i + "遍")
}
// 输出：第0遍  第1遍  第2遍

// forEach：对数组的每一项做同样的事
let dishes = ["红烧肉", "宫保鸡丁", "麻婆豆腐"]
dishes.forEach(dish => {
    console.log("菜品：" + dish)
})
// 输出：菜品：红烧肉  菜品：宫保鸡丁  菜品：麻婆豆腐

// 本项目里的循环（backend/OrderServiceImpl.java）：
// 遍历购物车里每道菜，计算总金额
for (OrderCreateDTO.OrderItemDTO itemDto : dto.getItems()) {
    Dish dish = dishService.getById(itemDto.getDishId())
    BigDecimal subtotal = dish.getPrice().multiply(...)
    totalAmount = totalAmount.add(subtotal)
}
```

---

## 第 2 节：MySQL 数据库——从零学起

### 2.1 为什么需要数据库？

程序运行时，数据存在内存里。内存有个问题：**断电就消失**。

数据库把数据**永久存到硬盘**上，即使程序关闭、服务器重启，数据还在。

```
没有数据库：
  程序创建订单 → 存在内存 → 程序重启 → 订单丢失！

有了数据库：
  程序创建订单 → 存入 MySQL → 程序重启 → 订单还在 ✓
```

### 2.2 数据库的结构（用 Excel 类比）

```
MySQL（整个软件）= Excel 应用程序本身
数据库 dingcan   = 一个 .xlsx 文件
表（Table）      = 文件里的一张 Sheet
行（Row）        = Sheet 里的一行数据
列（Column）     = Sheet 的列标题
```

本项目的数据库里有这些表：

```
dingcan 数据库
│
├── restaurant_table    桌台表
│   行：01号桌、02号桌、包间A……
│
├── category            菜品分类表
│   行：招牌热菜、家常凉菜、主食面点……
│
├── dish                菜品表
│   行：红烧肉、宫保鸡丁、麻婆豆腐……
│
├── user                微信用户表
│   行：用户A、用户B……
│
├── order               订单主表
│   行：订单001、订单002……
│
└── order_item          订单详情表（每道菜一行）
    行：订单001-红烧肉、订单001-宫保鸡丁……
```

### 2.3 SQL 基础语法：增删改查

SQL 是操作数据库的语言，只有 4 个核心操作：

**① SELECT（查询）——最常用**

```sql
-- 查所有菜品（SELECT * = 查所有列）
SELECT * FROM dish;

-- 只查名字和价格（指定列）
SELECT name, price FROM dish;

-- 加条件（WHERE）
SELECT * FROM dish WHERE is_available = 1;
-- 意思：查 dish 表里，is_available 等于 1 的所有行

-- 排序（ORDER BY）
SELECT * FROM dish ORDER BY price DESC;
-- DESC = 降序（贵的在前）；ASC = 升序（便宜的在前）

-- 限制数量（LIMIT）
SELECT * FROM dish ORDER BY price DESC LIMIT 5;
-- 只要价格最贵的 5 道菜

-- 模糊搜索（LIKE）
SELECT * FROM dish WHERE name LIKE '%鸡%';
-- % 是通配符，表示任意字符。查名字里含"鸡"的菜

-- ★ 本项目中的实际查询（被 Spring Boot 执行）：
SELECT * FROM dish WHERE is_available = 1 ORDER BY sort_order ASC;
-- 查所有上架菜品，按 sort_order 从小到大排序
```

**② INSERT（插入）——新增数据**

```sql
-- 基本语法：INSERT INTO 表名 (列名1, 列名2) VALUES (值1, 值2)
INSERT INTO dish (category_id, name, price, is_available)
VALUES (1, '新菜品', 38.00, 1);

-- ★ 本项目中（管理员添加菜品时执行）：
INSERT INTO dish (category_id, name, description, price, image_url, is_available, sort_order)
VALUES (1, '红烧肉', '精选三层五花肉', 38.00, 'http://xxx.jpg', 1, 1);
```

**③ UPDATE（更新）——修改数据**

```sql
-- 基本语法：UPDATE 表名 SET 列名=新值 WHERE 条件
UPDATE dish SET price = 42.00 WHERE id = 1;
-- ⚠️ 一定要加 WHERE！不加的话会把所有菜品的价格都改掉！

-- 修改多个字段
UPDATE dish SET price = 42.00, is_available = 0 WHERE id = 1;

-- ★ 本项目中（结账时把桌台状态改为空闲）：
UPDATE restaurant_table SET status = 0, updated_at = NOW() WHERE id = 3;
-- NOW() 是 MySQL 函数，返回当前时间
```

**④ DELETE（删除）——删除数据**

```sql
-- 基本语法：DELETE FROM 表名 WHERE 条件
DELETE FROM dish WHERE id = 100;
-- ⚠️ 一定要加 WHERE！不加会删光整张表！

-- ★ 本项目中（删除菜品时）：
DELETE FROM dish WHERE id = 5;
```

### 2.4 数据类型：什么数据用什么类型

```sql
-- 整数
INT          -- 范围约 -21亿 ~ 21亿，占 4 字节
             -- 用途：id（主键）、数量、状态码
TINYINT      -- 范围 -128 ~ 127，占 1 字节
             -- 用途：状态（0/1/2），is_available（0上架/1下架）

-- 文字
VARCHAR(50)  -- 变长字符串，最多 50 个字符
             -- 用途：名称 name、编号 order_no
TEXT         -- 最多 65535 字节的长文字
             -- 用途：详细描述 description

-- 数字（金额专用）
DECIMAL(10,2)-- 精确小数，总10位，小数2位（最大 99999999.99）
             -- 用途：价格 price、金额 total_amount
             -- ⚠️ 不能用 FLOAT/DOUBLE（有精度误差！）

-- 时间
DATETIME     -- 日期+时间：2026-05-14 18:30:00
             -- 用途：created_at、updated_at
```

**为什么金额不能用 FLOAT？**

```python
# 浮点数的坑（Python 验证，Java/JS 同理）
0.1 + 0.2 = 0.30000000000000004  # 不是 0.3！

# 用 DECIMAL 存储，精确计算，不会有这个问题
```

### 2.5 主键与外键：表之间的关联

**主键（PRIMARY KEY）**：每行的唯一标识，不能重复，不能为空。

```sql
CREATE TABLE dish (
    id INT NOT NULL AUTO_INCREMENT,
    -- AUTO_INCREMENT：每次插入自动 +1（1, 2, 3...）
    -- 不需要手动指定 id，数据库自己分配
    name VARCHAR(100) NOT NULL,
    PRIMARY KEY (id)
    -- 声明 id 是主键
);
```

**外键（FOREIGN KEY）**：一张表引用另一张表的主键，建立关联。

```sql
-- 本项目的 dish 表引用 category 表：
CREATE TABLE dish (
    id          INT NOT NULL AUTO_INCREMENT,
    category_id INT NOT NULL,
    -- category_id 存的是 category 表里某行的 id
    -- 比如：category_id = 1 表示这道菜属于"招牌热菜"（id=1的分类）
    name        VARCHAR(100) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_dish_category
        FOREIGN KEY (category_id) REFERENCES category (id)
        -- 外键约束：category_id 必须是 category.id 中存在的值
        -- 防止出现"属于不存在分类"的菜品（脏数据）
        ON DELETE CASCADE
        -- 删除分类时，该分类下的菜品也自动删除
);
```

**查询时用 JOIN 把两张表合并**：

```sql
-- 查订单时，顺便把桌号也查出来
-- （桌号在 restaurant_table 表，不在 order 表）
SELECT
    o.id,                -- 订单 ID（o 是 order 表的别名）
    o.order_no,          -- 订单编号
    o.total_amount,      -- 总金额
    o.status,            -- 状态
    t.table_number       -- 桌号（t 是 restaurant_table 的别名）
FROM `order` o
LEFT JOIN restaurant_table t ON o.table_id = t.id;
-- ON o.table_id = t.id：关联条件
-- 订单的 table_id 等于桌台的 id，就把它们拼在一起

-- 结果示例：
-- id | order_no          | total_amount | status | table_number
-- 1  | 20260514183056xxx | 94.00        | 1      | 03号桌
-- 2  | 20260514190012xxx | 56.00        | 0      | 01号桌
```

**LEFT JOIN vs INNER JOIN 的区别**：

```sql
-- INNER JOIN（内连接）：只返回两表都有匹配的行
-- 如果某订单的 table_id 对应的桌台被删了 → 这条订单不返回

-- LEFT JOIN（左连接）：左表（order）的所有行都返回
-- 就算桌台被删了，订单也会出现，只是 table_number 为 NULL
-- 本项目用 LEFT JOIN，更安全
```

### 2.6 本项目建表脚本完整讲解

```sql
-- sql/init.sql 第一部分：创建数据库

CREATE DATABASE IF NOT EXISTS `dingcan`
  DEFAULT CHARACTER SET utf8mb4
  -- utf8mb4：支持中文 + emoji（比如 🍜 🪑）
  -- 注意：普通的 utf8 只支持3字节，emoji 需要4字节，必须用 utf8mb4
  COLLATE utf8mb4_unicode_ci;
  -- unicode_ci：排序时不区分大小写，ci = case insensitive

USE `dingcan`;
-- 选择使用这个数据库，后续操作都针对它

-- ─────────────────────────────────────────────────────
-- 桌台表
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `restaurant_table` (
    `id`              INT         NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    -- COMMENT：字段说明，方便看表结构时理解（不影响功能）

    `table_number`    VARCHAR(20) NOT NULL COMMENT '桌号，如：01号桌',
    -- VARCHAR(20)：最多20个字符（一个中文=1个字符，够用了）

    `capacity`        INT         NOT NULL DEFAULT 4 COMMENT '容纳人数',
    -- DEFAULT 4：不传这个字段时，默认值是4

    `is_private_room` TINYINT     NOT NULL DEFAULT 0 COMMENT '0-普通桌台 1-包间',

    `status`          TINYINT     NOT NULL DEFAULT 0 COMMENT '0-空闲 1-用餐中',
    -- 0=空闲，1=用餐中
    -- 用 TINYINT 而不是 INT：省空间（只有0和1两个值）

    `qr_code_url`     VARCHAR(500)         COMMENT '二维码图片URL',
    -- 没有 NOT NULL：可以为空（刚添加桌台时还没有二维码）

    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- DEFAULT CURRENT_TIMESTAMP：插入时自动记录当前时间

    `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
    -- ON UPDATE CURRENT_TIMESTAMP：每次 UPDATE 这行时，自动更新为当前时间

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_table_number` (`table_number`)
    -- UNIQUE KEY：桌号不能重复（不能有两个"01号桌"）
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='餐桌信息表';
-- ENGINE=InnoDB：支持事务和外键（现代 MySQL 必须用这个）

-- ─────────────────────────────────────────────────────
-- 菜品分类表
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `category` (
    `id`         INT         NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `name`       VARCHAR(50) NOT NULL COMMENT '分类名称，如：招牌热菜',
    `sort_order` INT         NOT NULL DEFAULT 0 COMMENT '排序（越小越靠前）',
    `is_active`  TINYINT     NOT NULL DEFAULT 1 COMMENT '1-启用 0-禁用',
    `created_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='菜品分类表';

-- ─────────────────────────────────────────────────────
-- 菜品表
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `dish` (
    `id`           INT            NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `category_id`  INT            NOT NULL COMMENT '所属分类ID，关联 category.id',

    `name`         VARCHAR(100)   NOT NULL COMMENT '菜品名称',
    `description`  TEXT                    COMMENT '描述（可为空）',
    -- 没有 NOT NULL：允许为空（不是所有菜品都需要描述）
    -- TEXT：比 VARCHAR 能存更多文字

    `price`        DECIMAL(10, 2) NOT NULL COMMENT '售价（元）',
    -- DECIMAL(10, 2)：最多10位数字，其中2位是小数
    -- 最大值：99999999.99（不会有菜品这么贵）

    `image_url`    VARCHAR(500)            COMMENT '菜品图片URL（可为空）',
    -- 500 个字符：够存很长的 URL

    `is_available` TINYINT        NOT NULL DEFAULT 1 COMMENT '1-上架 0-下架',
    `sort_order`   INT            NOT NULL DEFAULT 0 COMMENT '分类内排序',
    `created_at`   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_category_id` (`category_id`),
    -- KEY（普通索引）：按分类查菜品很常见，加索引加速查询

    CONSTRAINT `fk_dish_category`
        FOREIGN KEY (`category_id`) REFERENCES `category` (`id`)
        ON DELETE CASCADE
        -- 删除分类时，该分类下的菜品一起删除
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='菜品表';

-- ─────────────────────────────────────────────────────
-- 订单主表（注意：order 是 MySQL 保留字，必须加反引号）
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `order` (
    `id`           INT            NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `order_no`     VARCHAR(32)    NOT NULL COMMENT '订单编号（给顾客看的）',
    -- 格式：时间戳+随机数，如 202605141830567890123456
    -- 为什么不直接用 id？因为 id 是纯数字，容易被猜到订单总数

    `table_id`     INT            NOT NULL COMMENT '餐桌ID',
    `user_id`      INT                     COMMENT '用户ID（允许为空，支持匿名点餐）',
    `total_amount` DECIMAL(10, 2) NOT NULL COMMENT '订单总金额（元）',
    `status`       TINYINT        NOT NULL DEFAULT 0
        COMMENT '状态: 0-待确认 1-制作中 2-已上菜 3-已结账 4-已取消',

    `remark`       VARCHAR(255)            COMMENT '顾客备注，如：少辣、不要香菜',
    `created_at`   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下单时间',
    `updated_at`   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),    -- 订单编号全局唯一
    KEY `idx_table_id` (`table_id`),           -- 按桌台查订单很常见
    KEY `idx_status` (`status`),               -- 按状态过滤（如查所有待处理订单）
    KEY `idx_created_at` (`created_at`),       -- 按日期范围查历史订单

    CONSTRAINT `fk_order_table`
        FOREIGN KEY (`table_id`) REFERENCES `restaurant_table` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单主表';

-- ─────────────────────────────────────────────────────
-- 订单详情表（每道菜一行）
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `order_item` (
    `id`        INT            NOT NULL AUTO_INCREMENT,
    `order_id`  INT            NOT NULL COMMENT '所属订单ID',
    `dish_id`   INT            NOT NULL COMMENT '菜品ID',

    `dish_name` VARCHAR(100)   NOT NULL COMMENT '下单时的菜名（冗余存储）',
    -- 为什么要冗余存储菜名？
    -- 如果只存 dish_id，以后菜品改名了，历史订单显示的菜名也会变！
    -- 冗余存储"下单那一刻"的菜名，历史订单永远正确

    `price`     DECIMAL(10, 2) NOT NULL COMMENT '下单时的单价（冗余存储）',
    -- 同理：菜品可能涨价，冗余存储下单时的价格

    `quantity`  INT            NOT NULL COMMENT '数量',
    `subtotal`  DECIMAL(10, 2) NOT NULL COMMENT '小计 = price × quantity',
    -- 小计也冗余存储，查询时不用再计算

    PRIMARY KEY (`id`),
    KEY `idx_order_id` (`order_id`),
    CONSTRAINT `fk_item_order`
        FOREIGN KEY (`order_id`) REFERENCES `order` (`id`)
        ON DELETE CASCADE
        -- 删订单时，所有关联的菜品明细也一起删除
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单详情表';
```

### 2.7 索引：让查询变快的"目录"

**没有索引**：查"今日订单"要翻整张表，就像在没有目录的书里找内容——从第一页翻到最后一页。

**有了索引**：数据库先在索引里定位，再直接跳到目标数据，就像查字典——先找笔画，再定位到那一页。

```sql
-- 本项目加了 idx_created_at 索引：
KEY `idx_created_at` (`created_at`)

-- 有了这个索引，这个查询会非常快：
SELECT * FROM `order`
WHERE created_at >= '2026-05-14 00:00:00'
  AND created_at <  '2026-05-15 00:00:00';
-- 数据库直接用索引定位到 5月14日的数据，不用扫描其他日期

-- ⚠️ 索引失效的常见坑：
-- 如果在列上套函数，索引就失效了！
SELECT * FROM `order` WHERE DATE(created_at) = '2026-05-14';
-- DATE() 函数包住了 created_at，数据库无法用索引，变成全表扫描！
-- 这就是为什么我们用范围比较而不是 DATE() 函数
```

---

## 第 3 节：Java 与 Spring Boot——后端是怎么工作的

### 3.1 Java 基础：从变量到类

**变量和类型**：

```java
// Java 是强类型语言：每个变量必须声明类型
String name = "红烧肉";      // 字符串
int quantity = 2;            // 整数
double price = 38.0;         // 浮点数（有精度问题，金额不用这个）
BigDecimal amount = new BigDecimal("38.00");  // 精确小数（金额专用）
boolean isAvailable = true;  // 布尔值
```

**类（Class）**：把相关的数据和方法打包在一起：

```java
// 定义一个"菜品"类
public class Dish {
    // 字段（数据）
    private Integer id;
    private String name;
    private BigDecimal price;
    private Integer isAvailable;  // 0=下架，1=上架

    // 方法（行为）
    public boolean isOnSale() {
        return isAvailable == 1;  // 返回是否上架
    }
}

// 使用这个类创建对象（对象是类的实例）
Dish redBraisedPork = new Dish();  // new 创建一个 Dish 对象
redBraisedPork.setName("红烧肉");   // 设置名字（setter 方法）
redBraisedPork.setPrice(new BigDecimal("38.00"));

System.out.println(redBraisedPork.getName()); // 输出：红烧肉
System.out.println(redBraisedPork.isOnSale()); // 输出：true（假设已设置）
```

**Lombok 注解——省掉样板代码**：

```java
// 没有 Lombok，一个 Dish 类需要写 100 多行 getter/setter：
public class Dish {
    private String name;
    public String getName() { return name; }  // getter
    public void setName(String name) { this.name = name; }  // setter
    // ... 每个字段都要写一遍，非常啰嗦
}

// 有了 Lombok，一个 @Data 搞定：
@Data  // 自动生成所有 getter、setter、toString、equals 方法
public class Dish {
    private String name;
    private BigDecimal price;
    // 不需要写 getter/setter，@Data 会自动生成
}

// 使用时和以前一样：
dish.getName()  // 自动生成的 getter
dish.setName("红烧肉")  // 自动生成的 setter
```

### 3.2 Spring Boot 核心：注解驱动

Spring Boot 大量使用**注解**（`@` 开头的标签），框架看到注解就自动处理：

```java
// @RestController：告诉 Spring，这个类是 REST API 控制器
// Spring 会自动把它的方法暴露为 HTTP 接口
@RestController
@RequestMapping("/api/dishes")  // 所有方法的 URL 前缀
public class DishController {

    // @GetMapping：处理 GET 请求
    // 完整 URL：GET http://localhost:8888/api/dishes
    @GetMapping
    public Result<List<Dish>> listDishes() {
        // ... 返回菜品列表
    }

    // @GetMapping("/{id}")：URL 里的 {id} 是变量
    // 完整 URL：GET http://localhost:8888/api/dishes/1
    @GetMapping("/{id}")
    public Result<Dish> getDish(@PathVariable Integer id) {
        // @PathVariable：从 URL 路径 /api/dishes/1 里提取 1 赋给 id
    }

    // @PostMapping：处理 POST 请求（通常用于创建数据）
    @PostMapping
    public Result<String> createOrder(@RequestBody OrderCreateDTO dto) {
        // @RequestBody：从请求体里读取 JSON 并转换为 Java 对象
    }
}
```

**依赖注入——不需要手动 new 对象**：

```java
// 传统写法（手动创建对象，耦合度高）：
public class DishController {
    private DishService dishService = new DishServiceImpl();
    // 问题：如果 DishServiceImpl 需要其他依赖，很难管理
}

// Spring 依赖注入（推荐写法）：
@RestController
@RequiredArgsConstructor  // Lombok：自动生成构造器
public class DishController {
    private final DishService dishService;
    // Spring 自动找到实现了 DishService 接口的类（DishServiceImpl）
    // 并注入进来，你不需要关心怎么创建的
}

// 为什么用 private final？
// final 表示这个字段只赋值一次（在构造器里），不会被意外修改
// private 表示外部不能直接访问（封装）
```

### 3.3 MyBatis-Plus：操作数据库的工具

**没有 MyBatis-Plus**，查一个菜品需要写很多代码：

```java
// 原始 JDBC 写法（非常繁琐）：
String sql = "SELECT * FROM dish WHERE id = ?";
PreparedStatement stmt = connection.prepareStatement(sql);
stmt.setInt(1, id);
ResultSet rs = stmt.executeQuery();
Dish dish = new Dish();
if (rs.next()) {
    dish.setId(rs.getInt("id"));
    dish.setName(rs.getString("name"));
    dish.setPrice(rs.getBigDecimal("price"));
    // ... 每个字段都要手动设置
}
```

**有了 MyBatis-Plus**，同样的功能只需一行：

```java
// 继承 BaseMapper 后，自动获得所有基础操作
public interface DishMapper extends BaseMapper<Dish> {
    // 不需要写任何代码！BaseMapper 已经提供：
    // selectById(id)   → SELECT * FROM dish WHERE id = ?
    // insert(dish)     → INSERT INTO dish (...) VALUES (...)
    // updateById(dish) → UPDATE dish SET ... WHERE id = ?
    // deleteById(id)   → DELETE FROM dish WHERE id = ?
}

// 使用
Dish dish = dishMapper.selectById(1);  // 一行代码！
System.out.println(dish.getName());    // 输出：红烧肉
```

**LambdaQueryWrapper——类型安全的查询条件**：

```java
// 查询上架菜品，按排序升序
List<Dish> dishes = dishMapper.selectList(
    new LambdaQueryWrapper<Dish>()
        .eq(Dish::getIsAvailable, 1)
        // .eq(列, 值) → WHERE is_available = 1
        // Dish::getIsAvailable 是方法引用，比写字符串"is_available"更安全
        // （字符串拼错了编译时发现不了，方法引用写错了编译就报错）

        .eq(categoryId != null, Dish::getCategoryId, categoryId)
        // 第一个参数是条件：只有 categoryId 不为空时，才加这个 WHERE 条件
        // 实现了"可选过滤"

        .orderByAsc(Dish::getSortOrder)
        // ORDER BY sort_order ASC
);
```

### 3.4 事务：保证数据一致性

**场景**：顾客下单，需要同时做 3 件事：
1. 写入订单主记录
2. 写入所有菜品明细
3. 更新桌台状态为"用餐中"

如果第 2 步失败，第 1 步的数据要不要撤销？**当然要！**否则就有一条"没有菜品"的订单。

这就是**事务**：多个操作要么全部成功，要么全部失败。

```java
@Transactional(rollbackFor = Exception.class)
// 这个注解加在方法上，方法里的所有数据库操作都在同一个事务里
// rollbackFor = Exception.class：任何异常都回滚（包括受检异常）
// 默认只回滚 RuntimeException，加上这个更安全

public String createOrder(OrderCreateDTO dto) {
    // 步骤 1：保存订单
    save(order);  // INSERT INTO `order` ...

    // 步骤 2：保存每道菜
    for (OrderItem item : items) {
        orderItemMapper.insert(item);  // INSERT INTO order_item ...
    }
    // 如果这里抛出异常，步骤 1 的 INSERT 会自动回滚！

    // 步骤 3：更新桌台状态
    tableMapper.updateStatus(dto.getTableId(), 1);  // UPDATE restaurant_table ...

    return orderNo;
    // 三步都成功，事务提交，数据永久保存
}
```

### 3.5 本项目后端目录结构详解

```
backend/src/main/java/com/dingcan/

controller/    ← 接收 HTTP 请求，返回 HTTP 响应（最外层）
│  ├── DishController.java       GET /api/dishes
│  ├── OrderController.java      POST /api/orders, GET /api/orders/{orderNo}
│  ├── TableController.java      GET /api/tables/{id}
│  ├── OrderNotifyController.java POST /api/order-events/status（WebSocket 触发）
│  └── UserController.java       POST /api/users/login

service/       ← 业务逻辑层（Controller 调用这层）
│  ├── OrderService.java         接口（定义"能做什么"）
│  └── impl/
│      ├── OrderServiceImpl.java  实现（具体怎么做）
│      └── DishServiceImpl.java

mapper/        ← 数据库操作层（Service 调用这层）
│  ├── OrderMapper.java           extends BaseMapper<Order>
│  ├── OrderItemMapper.java
│  ├── DishMapper.java
│  └── TableMapper.java

entity/        ← 与数据库表一一对应的 Java 类
│  ├── Order.java                 对应 order 表
│  ├── OrderItem.java             对应 order_item 表
│  ├── Dish.java                  对应 dish 表
│  ├── Category.java              对应 category 表
│  └── RestaurantTable.java       对应 restaurant_table 表

dto/           ← 数据传输对象（接收前端参数，或封装返回数据）
│  ├── OrderCreateDTO.java        前端下单时传来的数据结构
│  ├── AddOrderItemsDTO.java      加菜时传来的数据结构
│  ├── OrderDetailVO.java         返回给前端的订单详情（含桌号和菜品列表）
│  └── OrderStatusNotifyDTO.java  管理端触发 WebSocket 推送的参数

config/        ← 配置类
│  ├── WebSocketConfig.java       注册 WebSocket 处理器
│  └── CorsConfig.java            跨域配置

websocket/     ← WebSocket 处理器
│  ├── OrderStatusWebSocketHandler.java  订单状态推送
│  └── TableCartWebSocketHandler.java    购物车同步

util/
│  └── OrderNoUtil.java           生成唯一订单编号

common/
│  └── Result.java                统一 API 响应格式
```

---

## 第 4 节：TypeScript 与 Nuxt 3——管理端是怎么工作的

### 4.1 TypeScript 为什么比 JavaScript 好？

JavaScript 是动态类型语言，写错了运行时才发现：

```javascript
// JavaScript（没有类型检查）
let price = "38元"   // 字符串，不是数字！
let total = price * 2  // NaN（Not a Number）
// 程序运行了才发现问题，可能已经造成了数据错误
```

TypeScript 在编译时就发现错误：

```typescript
// TypeScript（有类型检查）
let price: number = "38元"  // ❌ 编译时报错：不能把字符串赋给 number 类型
let price: number = 38      // ✅ 正确
let total: number = price * 2  // ✅ total = 76
```

本项目管理端用 TypeScript，后缀是 `.ts`。

### 4.2 TypeScript 核心语法

```typescript
// ① 基本类型
let name: string = "红烧肉"
let price: number = 38.00
let isAvailable: boolean = true
let items: any[] = []           // any：任意类型（不推荐滥用）
let orders: string[] = []       // string 数组

// ② 接口（定义对象的"形状"）
interface Dish {
    id: number
    name: string
    price: number
    imageUrl?: string  // ? 表示可选（可以没有这个字段）
}

// ③ 类型断言
const row = data[0] as any    // 告诉编译器：我知道这是 any 类型
const order = data[0] as Dish // 告诉编译器：这是 Dish 类型

// ④ 可选链操作符 ?.
const tableNumber = order?.tableNumber  // 如果 order 是 null/undefined，不报错，返回 undefined
// 等价于：
const tableNumber = order != null ? order.tableNumber : undefined

// ⑤ 空值合并运算符 ??
const name = dish.name ?? "未知菜品"
// 如果 dish.name 是 null 或 undefined，返回 "未知菜品"
// 注意：0 和 "" 不触发 ??（只有 null/undefined 才触发）
// 对比 ||：dish.name || "未知" 会在 name 为 "" 时也返回 "未知菜品"
```

### 4.3 async/await：异步操作的正确写法

**问题背景**：查询数据库、发 HTTP 请求都需要时间，不能让程序停下来等。

```javascript
// ❌ 错误理解（同步思维）：
const data = fetch('/api/dishes')  // 这行不等请求完成就继续
console.log(data)  // 输出：Promise {}（请求还没完成！）

// ✅ 正确方式（使用 async/await）：
async function loadDishes() {
    // await 会等待这行完成，然后再继续
    const data = await fetch('/api/dishes')
    console.log(data)  // 这时候数据已经回来了
}

// 错误处理（async/await 配合 try/catch）：
async function fetchOrders() {
    loading.value = true
    try {
        // await：等待请求完成
        const res = await $fetch('/api/orders')
        orders.value = res.list    // 请求成功，更新数据
    } catch (err) {
        // 请求失败（网络错误、401未授权等）
        ElMessage.error('获取订单失败')
    } finally {
        // 无论成功还是失败，都执行这里
        loading.value = false       // 关闭加载状态
    }
}
```

### 4.4 Nuxt 3 的文件即路由

Nuxt 3 根据文件位置自动生成 URL 路由，不需要手动配置：

```
admin/pages/
├── index.vue              → 访问 http://localhost:3000/
├── login.vue              → 访问 http://localhost:3000/login
├── orders/
│   └── index.vue          → 访问 http://localhost:3000/orders
└── menu/
    ├── dishes.vue         → 访问 http://localhost:3000/menu/dishes
    └── categories.vue     → 访问 http://localhost:3000/menu/categories
```

同样，服务端 API 也是文件即路由：

```
admin/server/api/
├── orders/
│   ├── index.get.ts       → GET  /api/orders
│   ├── admin.post.ts      → POST /api/orders/admin
│   └── [id]/
│       └── status.put.ts  → PUT  /api/orders/:id/status
└── dishes/
    ├── index.get.ts       → GET  /api/dishes
    ├── index.post.ts      → POST /api/dishes
    └── [id].put.ts        → PUT  /api/dishes/:id
```

**一个完整的 Nuxt 服务端 API 长什么样**：

```typescript
// admin/server/api/orders/index.get.ts
// 文件名决定：GET 方法，路径 /api/orders

import { query } from '~/server/utils/db'     // 引入数据库工具（~ = 项目根目录）
import { requireAuth } from '~/server/utils/auth'  // 引入认证工具

export default defineEventHandler(async (event) => {
    // defineEventHandler：Nuxt/Nitro 的固定写法，声明这是一个 HTTP 处理器
    // async：异步函数，里面可以用 await

    requireAuth(event)
    // 检查 Cookie 里有没有登录 token
    // 没有则抛出 401 错误，后面的代码不执行

    const q = getQuery(event)
    // getQuery：读取 URL 查询参数
    // 请求 /api/orders?status=1&page=2
    // q = { status: '1', page: '2' }（注意都是字符串！）

    const status = q.status
    const page   = parseInt((q.page as string) || '1')
    // parseInt：字符串转整数（'2' → 2）
    // || '1'：如果 page 参数不存在，默认是 '1'

    const rows = await query(
        'SELECT * FROM `order` WHERE status = ? ORDER BY created_at DESC',
        [status]
        // [status]：参数化查询（防止 SQL 注入）
        // ? 是占位符，mysql2 会把 [status] 里的值安全地填进去
    )

    return rows
    // 直接返回数据，Nuxt 自动序列化为 JSON 响应
})
```

### 4.5 数据库工具 db.ts 详解

```typescript
// admin/server/utils/db.ts 逐行讲解

import mysql from 'mysql2/promise'
// mysql2/promise：MySQL 的 Node.js 驱动，/promise 版本支持 async/await

let pool: mysql.Pool | null = null
// pool：数据库连接池（全局单例）
// Pool 是一组提前建好的数据库连接，避免每次查询都重新连接（连接很耗时）
// | null：初始值是 null，第一次调用时才创建

function getPool(): mysql.Pool {
    if (!pool) {  // 如果还没创建连接池
        const config = useRuntimeConfig()
        // useRuntimeConfig()：读取 nuxt.config.ts 里的 runtimeConfig
        // 从 .env 文件读取数据库连接信息

        pool = mysql.createPool({
            host:     config.db.host,      // 'localhost'
            port:     parseInt(config.db.port),  // 3306
            user:     config.db.user,      // 'root'
            password: config.db.password,  // '123456'
            database: config.db.database,  // 'dingcan'
            connectionLimit: 10,   // 最多同时建 10 个连接
            // 10 个连接可以支持 10 个并发数据库操作，对餐厅场景够用
            timezone: '+08:00',    // 东八区（北京时间）
            // 重要：不设置的话时间会差 8 小时！
        })
        console.log('[DB] 数据库连接池已初始化')
    }
    return pool
}

// query 函数：执行 SELECT 查询
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const pool = getPool()
    const [rows] = await pool.query(sql, params)
    // pool.query 返回 [rows, fields]
    // 解构赋值：只取第一个元素 rows（查询结果数组）
    return rows as T[]
}

// execute 函数：执行 INSERT/UPDATE/DELETE
export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
    const pool = getPool()
    const [result] = await pool.execute(sql, params)
    return result as mysql.ResultSetHeader
    // ResultSetHeader 包含：
    // result.insertId：INSERT 时新增记录的主键 ID
    // result.affectedRows：受影响的行数（UPDATE/DELETE 时有用）
}

// transaction 函数：事务（多个操作要么全成功要么全失败）
export async function transaction<T>(
    callback: (connection: mysql.PoolConnection) => Promise<T>
): Promise<T> {
    const connection = await getPool().getConnection()
    // 从连接池拿一个连接（专用于这个事务）

    try {
        await connection.beginTransaction()  // 开始事务
        const result = await callback(connection)  // 执行传入的操作
        await connection.commit()            // 全部成功，提交
        return result
    } catch (error) {
        await connection.rollback()          // 有错误，全部回滚
        throw error                          // 继续抛出错误，让调用者知道失败了
    } finally {
        connection.release()                 // 无论如何，把连接归还给连接池
        // finally 里的代码一定会执行（即使 throw 了）
    }
}
```

---

## 第 5 节：Vue 3 与 UniApp——前端是怎么工作的

### 5.1 Vue 3 核心：响应式

**响应式**是 Vue 最核心的概念：**数据变了，页面自动更新。**

```javascript
// 普通变量（不是响应式）：
let count = 0
count++               // 修改了，但页面不更新！

// ref()：让变量变成响应式
import { ref } from 'vue'
const count = ref(0)  // 包装成响应式

// 在 JS 里访问，要加 .value
count.value++         // 修改
console.log(count.value)  // 读取

// 在 template 里，不需要 .value（Vue 自动处理）
// <text>{{ count }}</text> ← 直接用 count，不用 count.value
```

**本项目中 ref 的使用**：

```javascript
// frontend/pages/menu/index.vue
const categories = ref([])  // 分类列表，初始为空数组
const loading    = ref(false)  // 是否加载中

// 当调用 categories.value = catsData 时
// 页面上用到 categories 的地方全部自动更新！
```

**reactive()：让整个对象都响应式**：

```javascript
// reactive 包装整个对象，不需要 .value
import { reactive } from 'vue'

const dishForm = reactive({
    name:  '',
    price: 0,
})

// 直接修改属性（不需要 .value）
dishForm.name = "红烧肉"
dishForm.price = 38

// 本项目中的例子：
// frontend/store/cart.js
const store = reactive({
    items:       [],
    tableId:     null,
    tableNumber: '',
    get totalAmount() {
        // computed getter：items 变化时自动重新计算
        return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0)
    }
})
```

### 5.2 计算属性（computed）

计算属性像"自动更新的公式"：依赖的数据变了，结果自动重新计算：

```javascript
import { ref, computed } from 'vue'

const price    = ref(38)
const quantity = ref(2)

// computed：基于 price 和 quantity 计算，任一改变就自动重算
const total = computed(() => price.value * quantity.value)

console.log(total.value)  // 76
price.value = 42
console.log(total.value)  // 84（自动重新计算！）

// 本项目中的例子（frontend/pages/order/status.vue）：
const statusInfo = computed(() => {
    if (!order.value) return {}
    return STATUS_MAP[order.value.status] || { text: '未知', emoji: '❓' }
    // order.value.status 变化时，statusInfo 自动更新
    // 页面上显示的状态文字和 emoji 就会同步变化
})
```

### 5.3 模板语法——让 HTML 动起来

```vue
<template>
  <!-- ① {{ }}：插值，显示变量值 -->
  <text>{{ tableNumber }}</text>
  <!-- tableNumber 变化时，文字自动更新 -->

  <!-- ② v-if：条件渲染（符合条件才渲染） -->
  <view v-if="!cartStore.isEmpty" class="cart-bar">
    购物车不为空时，才显示这个购物车栏
  </view>
  <!-- cartStore.isEmpty 变为 false 时，这个 view 才会出现 -->

  <!-- ③ v-else-if / v-else：配合 v-if 使用 -->
  <view v-if="order.status === 0">待确认</view>
  <view v-else-if="order.status === 1">制作中</view>
  <view v-else>其他状态</view>

  <!-- ④ v-for：列表渲染（循环） -->
  <view v-for="dish in dishes" :key="dish.id">
    <!-- v-for 遍历 dishes 数组，每个 dish 生成一个 view -->
    <!-- :key 必须填，帮助 Vue 追踪每个元素（用唯一值如 id） -->
    <text>{{ dish.name }}</text>
    <text>¥{{ dish.price }}</text>
  </view>

  <!-- ⑤ :（v-bind）：动态绑定属性 -->
  <image :src="dish.imageUrl || '/static/logo.png'" />
  <!-- :src 是动态的（根据 dish.imageUrl 的值变化） -->
  <!-- 如果不加冒号：src="dish.imageUrl" 这是字符串"dish.imageUrl"，不是变量值 -->

  <!-- ⑥ @（v-on）：绑定事件 -->
  <view @tap="cartStore.addItem(dish)">+</view>
  <!-- @tap：点击时调用 addItem 函数（UniApp 用 tap，浏览器用 click） -->

  <!-- ⑦ 动态 class：根据条件添加 CSS 类 -->
  <view :class="{ active: activeCategoryId === cat.id }">
    <!-- 当 activeCategoryId === cat.id 为 true 时，添加 active 类 -->
  </view>

  <!-- ⑧ v-model：双向绑定（输入框） -->
  <textarea v-model="remark" placeholder="备注（选填）" />
  <!-- 用户输入时，remark 自动更新；remark 被代码改变时，输入框也更新 -->
</template>
```

### 5.4 组件生命周期

```javascript
// Vue 3 组合式 API 生命周期
import { onMounted, onUnmounted } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'  // UniApp 专用

// onMounted：组件挂载到页面后执行（浏览器端）
onMounted(() => {
    fetchDishes()      // 请求数据
    timer = setInterval(fetchOrders, 30000)  // 启动定时器
    connectWebSocket() // 建立 WebSocket 连接
})

// onUnmounted：组件从页面移除时执行（清理工作）
onUnmounted(() => {
    clearInterval(timer)  // 清除定时器（非常重要！不清除会内存泄漏）
    ws?.close()           // 关闭 WebSocket 连接
})

// UniApp 的页面生命周期（功能相同，名字不同）
onLoad((options) => {
    // 页面加载时执行
    // options 包含 URL 参数，如 /status?orderNo=xxx → options.orderNo = 'xxx'
    orderNo.value = options.orderNo
    fetchOrder()
    pollTimer = setInterval(fetchOrder, 5000)
})

onUnload(() => {
    // 页面卸载时执行
    if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
    }
})
```

### 5.5 UniApp 与普通 Vue 的区别

UniApp 是一套代码可以运行在微信小程序、H5、App 的框架。语法基本和 Vue 相同，但组件名不同：

```vue
<!-- 普通 HTML/浏览器 Vue：               UniApp 中写法： -->
<div>                                      <view>
<span>                                     <text>
<img src="...">                            <image :src="...">
<input>                                    <input>
<button @click="fn">                       <button @tap="fn">
<a href="/page">链接</a>                   <navigator url="/pages/xxx">链接</navigator>

<!-- 路由跳转 -->
router.push('/menu/index')                 uni.navigateTo({ url: '/pages/menu/index' })
router.replace('/status')                  uni.redirectTo({ url: '/pages/order/status' })
window.location.href = '/login'            uni.reLaunch({ url: '/pages/index/index' })

<!-- HTTP 请求 -->
fetch('/api/dishes')                       uni.request({ url: '...', success: fn })
```

**本项目封装的请求工具**（`frontend/utils/request.js`）：

```javascript
// 不用每次都写 uni.request，封装后更简洁
// 封装做了：统一加 BASE_URL，统一处理错误，自动解析 data 字段

// 使用封装后的请求：
import { get, post } from '@/utils/request.js'

// 请求菜品列表
const dishes = await get('/api/dishes')
// 等同于：fetch('http://localhost:8888/api/dishes').then(res => res.json()).then(res => res.data)

// 提交订单
const orderNo = await post('/api/orders', {
    tableId: 3,
    items: [{ dishId: 1, quantity: 2 }]
})
```

---

## 第 6 节：开发环境搭建与项目启动

### 6.1 安装所需工具

```bash
# 1. 安装 JDK 17（Java 运行环境）
# 下载：https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html
# 验证：
java -version
# 应输出：java version "17.x.x"

# 2. 安装 Maven（Java 包管理工具，Spring Boot 用它）
# 下载：https://maven.apache.org/download.cgi
# 验证：
mvn -v
# 应输出：Apache Maven 3.x.x

# 3. 安装 Node.js（Nuxt 管理端和 UniApp 需要）
# 下载：https://nodejs.org/（选 LTS 版本）
# 验证：
node -v    # 应输出：v18.x.x 或更高
npm -v     # 应输出：10.x.x

# 4. 安装 MySQL 8.0
# 下载：https://dev.mysql.com/downloads/mysql/
# 验证：
mysql -V   # 应输出：Ver 8.0.xx
```

### 6.2 项目初始化

```bash
# ① 初始化数据库（在 MySQL 中执行 init.sql）
mysql -u root -p < sql/init.sql
# 输入 MySQL 密码后，自动创建 dingcan 数据库和所有表

# 验证：
mysql -u root -p -e "USE dingcan; SHOW TABLES;"
# 应显示：category, dish, order, order_item, restaurant_table, user

# ② 启动后端（Spring Boot，端口 8888）
cd backend
mvn spring-boot:run
# 看到 "Started DingcanApplication in X.XXX seconds" 就成功了

# ③ 启动管理端（Nuxt 3，端口 3000）
cd admin
npm install          # 第一次运行需要安装依赖（下载 node_modules）
npm run dev          # 启动开发服务器

# ④ 启动用户端（H5 模式，端口 5173 或 8080）
cd frontend
npm install
# 在 HBuilderX 里打开，运行到浏览器或微信开发者工具
# 或修改 utils/config.js 里的 BASE_URL，然后用 npm run dev:h5
```

### 6.3 验证各端是否正常

```bash
# 测试后端 API
curl http://localhost:8888/api/dishes
# 应返回菜品列表 JSON

# 浏览器访问管理端
# http://localhost:3000
# 应显示登录页，输入密码 admin123 登录

# Swagger API 文档（方便测试后端接口）
# http://localhost:8888/swagger-ui.html
# 可以在网页上直接调用各个 API 测试
```

### 6.4 常见启动问题

**问题 1：端口被占用**
```bash
# 报错：Port 8888 is already in use

# 解决：改 backend/src/main/resources/application.yml 里的端口
server:
  port: 8889  # 改成其他端口
```

**问题 2：MySQL 连接失败**
```bash
# 报错：Communications link failure

# 检查 MySQL 是否启动：
net start mysql  # Windows
brew services start mysql  # macOS

# 检查密码是否正确：
# backend/application.yml 里的 password 是否与 MySQL 密码一致
```

**问题 3：npm install 很慢**
```bash
# 设置国内镜像加速：
npm config set registry https://registry.npmmirror.com

# 或者使用 cnpm：
npm install -g cnpm --registry=https://registry.npmmirror.com
cnpm install  # 代替 npm install
```

**问题 4：管理端登录 401 错误**
```bash
# 检查 admin/.env 文件里的密码：
ADMIN_PASSWORD=admin123  # 默认密码

# 确认登录页输入的密码与这里一致
```
