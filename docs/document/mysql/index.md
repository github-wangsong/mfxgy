# MYSQL 
## 连接 MySQL
```bash
# 命令行连接（-u 用户名，-p 密码）
mysql -u root -p

# 连接后显示
mysql>

```
## 数据库操作
```sql
-- 1. 创建数据库（如果不存在则创建）
CREATE DATABASE IF NOT EXISTS `school`;
-- 指定字符集创建（推荐 utf8mb4，支持中文和表情）
CREATE DATABASE IF NOT EXISTS `school` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. 查看所有数据库
SHOW DATABASES;

-- 3. 使用/切换到指定数据库
USE `school`;

-- 4. 查看当前正在使用的数据库
SELECT DATABASE();

-- 5. 修改数据库字符集
ALTER DATABASE `school` CHARACTER SET utf8mb4;

-- 6. 删除数据库（如果存在则删除，慎用！）
DROP DATABASE IF EXISTS `school`;

```

## 表操作
```sql
-- ==================== 表操作（DDL） ====================

-- 1. 创建学生表（包含各种常用数据类型）
-- PRIMARY KEY：主键，唯一标识每一行
-- AUTO_INCREMENT：自动增长，插入时可以不指定值
-- NOT NULL：不能为空
-- UNIQUE：唯一约束，不能重复
-- DEFAULT：默认值
-- COMMENT：字段注释（MySQL 特有）
CREATE TABLE IF NOT EXISTS `students` (
    `id` INT PRIMARY KEY AUTO_INCREMENT COMMENT '学生ID，主键自增',
    `student_no` VARCHAR(20) UNIQUE NOT NULL COMMENT '学号，唯一且不能为空',
    `name` VARCHAR(50) NOT NULL COMMENT '姓名',
    `gender` ENUM('男', '女') DEFAULT '男' COMMENT '性别：男/女',
    `age` INT COMMENT '年龄',
    `birthday` DATE COMMENT '出生日期',
    `height` DECIMAL(5,2) COMMENT '身高（厘米），保留两位小数',
    `enroll_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '入学时间',
    `is_active` BOOLEAN DEFAULT TRUE COMMENT '是否在校，布尔类型实际存储为0/1',
    `memo` TEXT COMMENT '备注信息'
);

-- 2. 查看当前数据库中的所有表
SHOW TABLES;

-- 3. 查看表结构（两种方式等效）
DESC `students`;
DESCRIBE `students`;
SHOW COLUMNS FROM `students`;

-- 4. 查看创建表的完整 SQL 语句
SHOW CREATE TABLE `students`;

-- 5. 添加新列
-- 添加普通列
ALTER TABLE `students` ADD `phone` VARCHAR(15) COMMENT '手机号';
-- 添加到指定位置（AFTER 某列）
ALTER TABLE `students` ADD `wechat` VARCHAR(50) AFTER `phone`;
-- 添加到最前面（FIRST）
ALTER TABLE `students` ADD `temp_column` INT FIRST;

-- 6. 修改列的数据类型
-- MODIFY：只修改类型，不改名
ALTER TABLE `students` MODIFY `age` TINYINT UNSIGNED COMMENT '年龄（0-255）';

-- 7. 修改列名和数据类型（CHANGE）
-- CHANGE：旧列名 新列名 新类型
ALTER TABLE `students` CHANGE `temp_column` `test_column` VARCHAR(20);

-- 8. 删除列
ALTER TABLE students DROP COLUMN `test_column`;

-- 9. 重命名表
ALTER TABLE `students` RENAME TO `student_info`;
-- 或者使用 RENAME 语句
RENAME TABLE `student_info` TO `students`;

-- 10. 修改表的字符集
ALTER TABLE `students` CONVERT TO CHARACTER SET utf8mb4;

-- 11. 删除表（彻底删除）
DROP TABLE IF EXISTS `students`;

-- 12. 清空表数据但保留结构（TRUNCATE：不可回滚，速度更快，自增ID重置）
TRUNCATE TABLE `students`;

-- 13. 清空表数据但保留结构（DELETE：可回滚，自增ID不重置）
DELETE FROM `students`;
```

类型|作用|
-|:-:|
`INT`|整数（±21亿）|
`TINYINT`|小整数（-128~127）|
`BIGINT`|超大整数|
`VARCHAR(n)`|变长字符串（推荐）|
`CHAR(n)`|定长字符串|
`TEXT`|长文本|
`DATE`|日期|
`DATETIME`|日期+时间|
`TIMESTAMP`|时间戳（自动更新）|
`DECIMAL(m,d)`|精确小数（钱）|
`FLOAT/DOUBLE`|浮点数（科学计算）|
`BOOLEAN`|TRUE / FALSE| 
`ENUM`|单选（固定几个值）| 
`JSON`|JSON 格式数据| 

## 约束操作

类型|作用
-|:-:|
`NOT NULL`|这一列不能为空|22
`UNIQUE`|这一列的值不能重复|
`PRIMARY KEY`|唯一标识每一行（= NOT NULL + UNIQUE）|
`FOREIGN KEY`|这一列的值必须在另一张表里存在|
`DEFAULT`|默认值|
`CHECK`|检查值是否符合条件|

```sql
-- ==================== 约束（Constraints） ====================

-- 1. 创建带各种约束的表
CREATE TABLE `courses` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `course_code` VARCHAR(10) UNIQUE NOT NULL,        -- UNIQUE + NOT NULL
    `course_name` VARCHAR(100) NOT NULL,
    `credits` TINYINT CHECK (credits BETWEEN 1 AND 6), -- CHECK 约束（MySQL 8.0+ 生效）
    `teacher_id` INT,
    `status` ENUM('进行中', '已结束') DEFAULT '进行中'
);

-- 2. 添加外键约束（关联到其他表）
-- 先创建教师表
CREATE TABLE `teachers` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL
);

-- 给 courses 表添加外键
ALTER TABLE `courses` ADD CONSTRAINT fk_courses_teacher
FOREIGN KEY (teacher_id) REFERENCES teachers(id)
ON DELETE SET NULL ON UPDATE CASCADE;
-- ON DELETE SET NULL：如果老师删除，课程表的 teacher_id 设为 NULL
-- ON UPDATE CASCADE：如果老师 ID 更新，课程表自动更新

-- 3. 添加主键约束（表已存在时）
ALTER TABLE `students` ADD PRIMARY KEY (id);

-- 4. 删除主键约束
ALTER TABLE `students` DROP PRIMARY KEY;

-- 5. 添加唯一约束
ALTER TABLE `students` ADD UNIQUE INDEX uk_student_no (student_no);

-- 6. 删除唯一约束（需要知道约束名）
SHOW INDEX FROM students;  -- 先查看约束名
ALTER TABLE students DROP INDEX uk_student_no;

-- 7. 添加 NOT NULL 约束
ALTER TABLE `students` MODIFY name VARCHAR(50) NOT NULL;

-- 8. 删除 NOT NULL 约束
ALTER TABLE `students` MODIFY name VARCHAR(50) NULL;

-- 9. 添加默认值约束
ALTER TABLE `students` ALTER is_active SET DEFAULT TRUE;

-- 10. 删除默认值约束
ALTER TABLE `students` ALTER is_active DROP DEFAULT;

-- 11. 添加 CHECK 约束
ALTER TABLE `students` ADD CONSTRAINT chk_age CHECK (age >= 0 AND age <= 120);

-- 12. 删除 CHECK 约束
ALTER TABLE `students` DROP CONSTRAINT chk_age;
```

## 数据插入
```sql
-- ==================== 插入数据（INSERT） ====================

-- 假设已有 students 表，先清空重新开始
TRUNCATE TABLE `students`; truncate

-- 1. 标准插入（指定列名，推荐写法）
INSERT INTO students (student_no, name, gender, age, birthday, height, phone)
VALUES ('20240001', '张三', '男', 18, '2006-05-15', 175.5, '13800138001');

-- 2. 不指定列名（必须按表定义顺序提供所有列的值，NULL 或 DEFAULT 占位）
INSERT INTO students VALUES 
(NULL, '20240002', '李四', '女', 19, '2005-08-20', 165.0, NOW(), 1, NULL, '13800138002', 'wechat002');

-- 3. 批量插入（一次插入多行，效率高）
INSERT INTO students (student_no, name, gender, age, birthday, height, phone) VALUES
('20240003', '王五', '男', 20, '2004-03-10', 180.0, '13800138003'),
('20240004', '赵六', '女', 18, '2006-11-25', 168.5, '13800138004'),
('20240005', '周七', '男', 19, '2005-07-07', 172.0, '13800138005');

-- 4. 插入部分列（未指定的列会用默认值或 NULL）
INSERT INTO students (student_no, name, age) VALUES
('20240006', '吴八', 21),
('20240007', '郑九', 20);

-- 5. INSERT IGNORE：遇到重复键时忽略（不报错，不插入）
INSERT IGNORE INTO students (student_no, name, age) 
VALUES ('20240001', '重复的学号', 99);  -- 学号已存在，这条会被忽略

-- 6. REPLACE：如果存在则删除后插入（相当于先删后插）
REPLACE INTO students (id, student_no, name, age)
VALUES (1, '20240001', '张三被替换', 22);  -- id=1 存在，先删除再插入新数据

-- 7. INSERT ... ON DUPLICATE KEY UPDATE：存在则更新，不存在则插入
INSERT INTO students (student_no, name, age, phone)
VALUES ('20240001', '张三更新', 23, '13900139001')
ON DUPLICATE KEY UPDATE 
    name = VALUES(name),      -- VALUES() 表示要插入的值
    age = VALUES(age),
    phone = VALUES(phone);

-- 8. 从另一张表插入数据（假设有 backup_students 表）
-- 先创建备份表
CREATE TABLE students_backup LIKE students;
-- 复制数据到备份表
INSERT INTO students_backup SELECT * FROM students;

-- 9. 插入后获取自动生成的自增 ID
INSERT INTO students (student_no, name) VALUES ('20240099', '获取ID测试');
SELECT LAST_INSERT_ID();  -- 返回最后插入的自增 ID
```

## 数据查询
```sql
-- ==================== 查询数据（SELECT） ====================

-- 1. 基础查询
SELECT * FROM students;                              -- 查询所有列
SELECT name, age, phone FROM students;               -- 查询指定列
SELECT name AS 姓名, age AS 年龄 FROM students;       -- 使用中文别名

-- 2. 去重查询（DISTINCT）
SELECT DISTINCT gender FROM students;                -- 查看有哪些性别
SELECT DISTINCT gender, age FROM students;           -- 组合去重

-- 3. WHERE 条件查询（重点）
-- 比较运算符
SELECT * FROM students WHERE age = 18;               -- 等于
SELECT * FROM students WHERE age <> 18;              -- 不等于
SELECT * FROM students WHERE age != 18;              -- 不等于（另一种写法）
SELECT * FROM students WHERE age > 18;               -- 大于
SELECT * FROM students WHERE age >= 18;              -- 大于等于

-- 逻辑运算符
SELECT * FROM students WHERE age >= 18 AND gender = '男';     -- 且
SELECT * FROM students WHERE age < 18 OR age > 25;            -- 或
SELECT * FROM students WHERE NOT gender = '男';               -- 非（即女）

-- 范围查询（BETWEEN）
SELECT * FROM students WHERE age BETWEEN 18 AND 20;  -- 包含边界，等价于 age>=18 AND age<=20

-- 集合查询（IN）
SELECT * FROM students WHERE name IN ('张三', '李四', '王五');
SELECT * FROM students WHERE age IN (18, 19, 20);

-- 空值判断（IS NULL / IS NOT NULL）
SELECT * FROM students WHERE phone IS NULL;          -- 没有手机号的学生
SELECT * FROM students WHERE phone IS NOT NULL;      -- 有手机号的学生

-- 4. 模糊查询（LIKE）
-- % 代表任意多个字符（包括0个）
SELECT * FROM students WHERE name LIKE '张%';         -- 姓张（张、张三、张三丰...）
SELECT * FROM students WHERE name LIKE '%三%';        -- 名字包含"三"
SELECT * FROM students WHERE name LIKE '%四';         -- 名字以"四"结尾
-- _ 代表一个字符
SELECT * FROM students WHERE name LIKE '张_';         -- 姓张且名字两个字（张三、张四）
SELECT * FROM students WHERE name LIKE '张__';        -- 姓张且名字三个字（张三四）
-- 转义特殊字符（使用 ESCAPE）
SELECT * FROM products WHERE description LIKE '%100\%%' ESCAPE '\';  -- 查询包含"100%"的

-- 5. 排序（ORDER BY）
SELECT * FROM students ORDER BY age;                  -- 升序（默认 ASC）
SELECT * FROM students ORDER BY age ASC;              -- 升序（明确写出）
SELECT * FROM students ORDER BY age DESC;             -- 降序
SELECT * FROM students ORDER BY age DESC, id ASC;     -- 先按年龄降序，再按ID升序

-- 6. 限制行数（LIMIT）- MySQL 特色
SELECT * FROM students LIMIT 3;                       -- 只取前3条
SELECT * FROM students LIMIT 3 OFFSET 2;              -- 跳过2条，取3条
SELECT * FROM students LIMIT 2, 3;                    -- 简写：跳过2条，取3条（OFFSET在前）

-- 7. 分页查询常用模板
-- 第1页，每页10条：LIMIT 0, 10
-- 第2页，每页10条：LIMIT 10, 10
-- 第n页（n从1开始）：LIMIT (n-1)*pageSize, pageSize

-- 8. 聚合函数（统计）
SELECT COUNT(*) FROM students;                        -- 总行数
SELECT COUNT(phone) FROM students;                    -- 非空手机号数量
SELECT COUNT(DISTINCT gender) FROM students;          -- 有多少种性别
SELECT AVG(age) FROM students;                        -- 平均年龄
SELECT SUM(age) FROM students;                        -- 年龄总和
SELECT MAX(age) FROM students;                        -- 最大年龄
SELECT MIN(age) FROM students;                        -- 最小年龄
-- 一次查询多个聚合
SELECT 
    COUNT(*) AS 总人数,
    AVG(age) AS 平均年龄,
    MAX(age) AS 最大年龄,
    MIN(age) AS 最小年龄
FROM students;

-- 9. 分组查询（GROUP BY）
-- 按性别分组，统计每组人数
SELECT gender, COUNT(*) AS count FROM students GROUP BY gender;
-- 按性别分组，统计每组平均年龄
SELECT gender, AVG(age) AS avg_age FROM students GROUP BY gender;
-- 多列分组
SELECT gender, age, COUNT(*) FROM students GROUP BY gender, age;

-- 10. 分组后筛选（HAVING）- 注意 WHERE 在分组前，HAVING 在分组后
-- 查询人数大于2的年龄段
SELECT age, COUNT(*) AS cnt 
FROM students 
GROUP BY age 
HAVING cnt > 2;

-- 完整顺序：WHERE → GROUP BY → HAVING → ORDER BY
SELECT 
    gender, 
    COUNT(*) AS total,
    AVG(age) AS avg_age,
    MAX(height) AS max_height
FROM students
WHERE age >= 18                    -- 筛选成年学生
GROUP BY gender                     -- 按性别分组
HAVING total >= 2                   -- 只显示人数>=2的分组
ORDER BY total DESC;                -- 按人数降序排列

-- 11. GROUP_CONCAT（MySQL 特有）- 将分组内的值拼接成一个字符串
SELECT 
    gender,
    GROUP_CONCAT(name) AS names,                    -- 默认逗号分隔
    GROUP_CONCAT(name SEPARATOR ' | ') AS names2,   -- 自定义分隔符
    GROUP_CONCAT(DISTINCT age ORDER BY age DESC SEPARATOR '-') AS ages
FROM students
GROUP BY gender;

-- 12. 表达式和函数查询
SELECT 
    name,
    age,
    age + 5 AS age_after_5_years,                  -- 算术运算
    CONCAT(name, ' (', age, '岁)') AS intro,       -- 字符串拼接
    IF(age >= 18, '成年', '未成年') AS status,     -- 条件判断
    CASE 
        WHEN age < 18 THEN '少年'
        WHEN age BETWEEN 18 AND 30 THEN '青年'
        ELSE '中年'
    END AS age_group                               -- 多条件判断
FROM students;
```

## 多表查询
```sql
-- ==================== 多表查询（JOIN） ====================

-- 准备数据：创建班级表和成绩表
CREATE TABLE classes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    class_name VARCHAR(50) NOT NULL,
    grade VARCHAR(20) COMMENT '年级'
);

CREATE TABLE scores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id INT,
    subject VARCHAR(30),
    score INT,
    exam_date DATE
);

-- 插入测试数据
INSERT INTO classes (class_name, grade) VALUES
('计算机1班', '大一'),
('计算机2班', '大一'),
('软件工程1班', '大二');

INSERT INTO scores (student_id, subject, score, exam_date) VALUES
(1, '数学', 90, '2024-01-10'),
(1, '英语', 85, '2024-01-12'),
(2, '数学', 78, '2024-01-10'),
(2, '英语', 92, '2024-01-12'),
(3, '数学', 88, '2024-01-10'),
(100, '数学', 75, '2024-01-10');  -- student_id=100 不存在

-- 1. INNER JOIN（内连接）：只返回两边都匹配的记录
SELECT s.name, c.class_name
FROM students s
INNER JOIN classes c ON s.class_id = c.id;
-- 简写
SELECT s.name, c.class_name
FROM students s
JOIN classes c ON s.class_id = c.id;

-- 2. LEFT JOIN（左连接）：左表全返回，右表无匹配返回 NULL
SELECT s.name, sc.subject, sc.score
FROM students s
LEFT JOIN scores sc ON s.id = sc.student_id;

-- 3. RIGHT JOIN（右连接）：右表全返回，左表无匹配返回 NULL
SELECT s.name, sc.subject, sc.score
FROM students s
RIGHT JOIN scores sc ON s.id = sc.student_id;

-- 4. 多表连接（三张表）
SELECT 
    s.name AS 学生,
    c.class_name AS 班级,
    sc.subject AS 科目,
    sc.score AS 分数
FROM students s
LEFT JOIN classes c ON s.class_id = c.id
LEFT JOIN scores sc ON s.id = sc.student_id
ORDER BY s.name, sc.subject;

-- 5. 自连接（自己连接自己）
-- 示例：查询学生和同班同学（假设要找同班的）
SELECT 
    a.name AS 学生1,
    b.name AS 同班同学
FROM students a
JOIN students b ON a.class_id = b.class_id AND a.id != b.id;

-- 6. 连接时添加条件
SELECT s.name, sc.subject, sc.score
FROM students s
JOIN scores sc ON s.id = sc.student_id AND sc.score >= 90;  -- 只查90分以上的

-- 7. USING 简化（当两表字段名相同时）
-- 假设 classes 表有 student_id 字段
SELECT s.name, sc.subject, sc.score
FROM students s
JOIN scores sc USING (id);  -- 等价于 ON s.id = sc.id
```

## 子查询
```sql
-- ==================== 子查询 ====================

-- 1. WHERE 子查询（标量子查询：返回单个值）
-- 查询年龄大于平均年龄的学生
SELECT name, age FROM students
WHERE age > (SELECT AVG(age) FROM students);

-- 2. IN 子查询（返回一列值）
-- 查询有过成绩记录的学生
SELECT name FROM students
WHERE id IN (SELECT DISTINCT student_id FROM scores);

-- 3. NOT IN 子查询
-- 查询没有成绩记录的学生
SELECT name FROM students
WHERE id NOT IN (SELECT DISTINCT student_id FROM scores);
-- 注意：如果子查询返回 NULL，NOT IN 会有问题，可用 NOT EXISTS 替代

-- 4. EXISTS 子查询（性能通常比 IN 好）
-- 查询有过成绩记录的学生
SELECT name FROM students s
WHERE EXISTS (SELECT 1 FROM scores sc WHERE sc.student_id = s.id);

-- 5. NOT EXISTS 子查询
-- 查询没有成绩记录的学生
SELECT name FROM students s
WHERE NOT EXISTS (SELECT 1 FROM scores sc WHERE sc.student_id = s.id);

-- 6. ANY / SOME 子查询（任意一个满足即可）
-- 查询比任意一个大一学生年龄大的学生
SELECT name, age FROM students
WHERE age > ANY (SELECT age FROM students WHERE grade = '大一');

-- 7. ALL 子查询（所有都满足）
-- 查询比所有大一学生年龄都大的学生
SELECT name, age FROM students
WHERE age > ALL (SELECT age FROM students WHERE grade = '大一');

-- 8. FROM 子查询（派生表/临时表）
-- 每个学生自己的平均分
SELECT s.name, t.avg_score
FROM students s
JOIN (
    SELECT student_id, AVG(score) AS avg_score
    FROM scores
    GROUP BY student_id
) AS t ON s.id = t.student_id;

-- 9. SELECT 子查询（标量子查询）
SELECT 
    name,
    age,
    (SELECT AVG(age) FROM students) AS avg_age_all,   -- 所有人的平均年龄
    (SELECT AVG(score) FROM scores WHERE student_id = students.id) AS my_avg_score
FROM students;

-- 10. 相关子查询（依赖外层查询）
-- 查询成绩高于该科目平均分的学生成绩
SELECT s.name, sc.subject, sc.score, t.avg_score
FROM scores sc
JOIN students s ON s.id = sc.student_id
JOIN (
    SELECT subject, AVG(score) AS avg_score
    FROM scores
    GROUP BY subject
) t ON sc.subject = t.subject
WHERE sc.score > t.avg_score;
```
## 联合查询
```sql
-- ==================== 联合查询（UNION） ====================

-- 1. UNION：合并结果，自动去重
SELECT name FROM students WHERE age <= 18
UNION
SELECT name FROM students WHERE gender = '女';
-- 结果：满足任意条件的名字（重复的只显示一次）

-- 2. UNION ALL：合并结果，保留重复
SELECT name FROM students WHERE age <= 18
UNION ALL
SELECT name FROM students WHERE gender = '女';
-- 结果：所有结果，不去重（性能更好）

-- 3. 使用条件：两个查询的列数必须相同，对应列的类型应该兼容
SELECT id, name, age FROM students
UNION
SELECT id, class_name, NULL FROM classes;  -- 用 NULL 补齐列数
```

## 数据更新
```sql
-- ==================== 更新数据（UPDATE） ====================

-- ⚠️ 警告：不加 WHERE 会更新整张表！先 SELECT 验证条件再 UPDATE

-- 1. 更新单条数据
UPDATE students SET phone = '13900139001' WHERE name = '张三';

-- 2. 更新多条数据
UPDATE students SET age = age + 1 WHERE age < 20;  -- 所有小于20岁的年龄+1

-- 3. 更新多个字段
UPDATE students 
SET height = 176.5, phone = '13700137001' 
WHERE student_no = '20240001';

-- 4. 使用表达式更新
UPDATE students SET age = TIMESTAMPDIFF(YEAR, birthday, CURDATE());  -- 根据生日计算年龄

-- 5. 使用子查询更新
-- 给每个学生设置班级名称（假设有班级表）
UPDATE students s 
SET class_id = (SELECT id FROM classes WHERE class_name = '计算机1班')
WHERE s.name = '张三';

-- 6. 多表更新（MySQL 特有语法）
UPDATE students s, classes c
SET s.class_name = c.class_name
WHERE s.class_id = c.id;

-- 7. 按顺序更新（配合 ORDER BY 和 LIMIT）
UPDATE students SET score = score + 5 
ORDER BY score ASC 
LIMIT 3;  -- 给分数最低的3个学生加5分

-- 8. 更新时使用 CASE WHEN
UPDATE students 
SET grade = CASE 
    WHEN score >= 90 THEN 'A'
    WHEN score >= 80 THEN 'B'
    WHEN score >= 60 THEN 'C'
    ELSE 'D'
END;
```
## 数据删除

```sql
-- ==================== 删除数据（DELETE） ====================

-- ⚠️ 警告：不加 WHERE 会删除整张表！先 SELECT 确认条件

-- 1. 删除指定行
DELETE FROM students WHERE name = '周七';

-- 2. 删除符合条件的所有行
DELETE FROM students WHERE age > 25;

-- 3. 带排序和限制的删除（删除最老的3个学生）
DELETE FROM students 
ORDER BY age DESC 
LIMIT 3;

-- 4. 多表删除（MySQL 特有）
-- 删除没有成绩记录的学生
DELETE s FROM students s
LEFT JOIN scores sc ON s.id = sc.student_id
WHERE sc.id IS NULL;

-- 5. 使用子查询删除
DELETE FROM students 
WHERE id IN (SELECT student_id FROM (SELECT student_id FROM scores GROUP BY student_id HAVING AVG(score) < 60) AS t);

-- 6. DELETE vs TRUNCATE 对比
-- DELETE：可以加 WHERE，逐行删除，速度慢，不重置自增ID，可以回滚
-- TRUNCATE：不能加 WHERE，清空全表，速度快，重置自增ID，不可回滚
```
## 高级查询
```sql
-- ==================== 窗口函数（MySQL 8.0+） ====================

-- 1. 排名函数
SELECT 
    name,
    age,
    ROW_NUMBER() OVER (ORDER BY age DESC) AS row_num,        -- 1,2,3,4...
    RANK() OVER (ORDER BY age DESC) AS rank_num,            -- 1,2,2,4...（有间隔）
    DENSE_RANK() OVER (ORDER BY age DESC) AS dense_rank_num -- 1,2,2,3...（无间隔）
FROM students;

-- 2. 分组内排名（PARTITION BY）
SELECT 
    name,
    gender,
    age,
    RANK() OVER (PARTITION BY gender ORDER BY age DESC) AS rank_in_gender
FROM students;

-- 3. NTILE：将数据分成 N 组
SELECT 
    name,
    score,
    NTILE(4) OVER (ORDER BY score DESC) AS quartile  -- 分成4组（四分位数）
FROM students;

-- 4. LAG / LEAD：获取前后行的值
SELECT 
    name,
    exam_date,
    score,
    LAG(score, 1) OVER (ORDER BY exam_date) AS prev_score,     -- 上一次考试成绩
    LEAD(score, 1) OVER (ORDER BY exam_date) AS next_score,    -- 下一次考试成绩
    score - LAG(score, 1) OVER (ORDER BY exam_date) AS improvement  -- 进步分数
FROM scores
WHERE student_id = 1
ORDER BY exam_date;

-- 5. 累积和（SUM OVER）
SELECT 
    name,
    score,
    SUM(score) OVER (ORDER BY id) AS cumulative_sum,           -- 累积和（所有历史）
    SUM(score) OVER (PARTITION BY gender ORDER BY id) AS cumulative_by_gender  -- 分组内累积
FROM students;

-- 6. 移动平均
SELECT 
    date,
    amount,
    AVG(amount) OVER (ORDER BY date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS moving_avg_3day
FROM sales;

-- 7. FIRST_VALUE / LAST_VALUE
SELECT 
    name,
    gender,
    age,
    FIRST_VALUE(name) OVER (PARTITION BY gender ORDER BY age DESC) AS oldest_in_gender,
    LAST_VALUE(name) OVER (PARTITION BY gender ORDER BY age DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS youngest_in_gender
FROM students;
```

## 事务操作
```sql
-- ==================== 事务（Transaction） ====================

-- 1. 基础事务（转账示例）
START TRANSACTION;                        -- 开始事务

UPDATE accounts SET balance = balance - 100 WHERE user_id = 1;
UPDATE accounts SET balance = balance + 100 WHERE user_id = 2;

-- 检查是否有误（比如余额是否变负数）
-- 如果正确，提交
COMMIT;

-- 如果有误，回滚
ROLLBACK;

-- 2. 带保存点的事务
START TRANSACTION;

UPDATE accounts SET balance = balance - 100 WHERE user_id = 1;
SAVEPOINT after_deduct;                   -- 设置保存点

UPDATE accounts SET balance = balance + 100 WHERE user_id = 2;

-- 如果第二步出错，回滚到保存点
ROLLBACK TO SAVEPOINT after_deduct;

-- 继续其他操作...
UPDATE accounts SET balance = balance - 50 WHERE user_id = 3;

COMMIT;  -- 提交所有（从保存点之后的操作也会被提交？实际上 ROLLBACK TO 之后保存点后的操作被撤销）

-- 3. 释放保存点
RELEASE SAVEPOINT after_deduct;

-- 4. 自动提交设置（MySQL 默认自动提交）
SET autocommit = 0;   -- 关闭自动提交，需要手动 COMMIT
SET autocommit = 1;   -- 开启自动提交

-- 5. 查看事务隔离级别
SELECT @@transaction_isolation;

-- 6. 设置事务隔离级别
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```
## 索引操作
```sql
-- ==================== 索引 ====================

-- 1. 创建普通索引
CREATE INDEX idx_name ON students(name);

-- 2. 创建唯一索引（不允许重复值）
CREATE UNIQUE INDEX idx_student_no ON students(student_no);

-- 3. 创建复合索引（多列组合）
CREATE INDEX idx_name_age ON students(name, age);

-- 4. 创建全文索引（用于全文搜索，MyISAM 或 InnoDB 5.6+）
CREATE FULLTEXT INDEX idx_content ON articles(content);

-- 5. 创建表时指定索引
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    category_id INT,
    price DECIMAL(10,2),
    INDEX idx_category (category_id),
    INDEX idx_price (price)
);

-- 6. 查看表中的索引
SHOW INDEX FROM students;
-- 或者
SHOW KEYS FROM students;

-- 7. 删除索引
DROP INDEX idx_name ON students;

-- 8. 删除主键索引（特殊）
ALTER TABLE students DROP PRIMARY KEY;

-- 9. 修改表添加索引
ALTER TABLE students ADD INDEX idx_age (age);
ALTER TABLE students ADD UNIQUE INDEX idx_phone (phone);

-- 10. 查看查询是否使用索引（执行计划）
EXPLAIN SELECT * FROM students WHERE name = '张三';
-- type=ref 或 range 表示用到索引，type=ALL 表示全表扫描

-- 11. 强制使用索引（不推荐，让优化器自己判断）
SELECT * FROM students FORCE INDEX (idx_name) WHERE name = '张三';

-- 12. 忽略索引
SELECT * FROM students IGNORE INDEX (idx_name) WHERE name = '张三';
```
## 视图操作
```sql
-- ==================== 视图（View） ====================

-- 1. 创建视图（虚拟表，不存储数据）
CREATE VIEW student_score_view AS
SELECT 
    s.id,
    s.name,
    s.student_no,
    sc.subject,
    sc.score
FROM students s
LEFT JOIN scores sc ON s.id = sc.student_id;

-- 2. 使用视图（就像使用普通表一样）
SELECT * FROM student_score_view;
SELECT name, AVG(score) FROM student_score_view GROUP BY name;

-- 3. 创建带检查选项的视图（保证插入/更新符合视图条件）
CREATE VIEW adult_students AS
SELECT * FROM students WHERE age >= 18
WITH CHECK OPTION;  -- 通过这个视图插入/更新的数据，age 必须 >=18

-- 4. 查看所有视图
SHOW FULL TABLES WHERE Table_type = 'VIEW';

-- 5. 查看视图创建语句
SHOW CREATE VIEW student_score_view;

-- 6. 修改视图（替换）
CREATE OR REPLACE VIEW student_score_view AS
SELECT s.id, s.name, AVG(sc.score) AS avg_score
FROM students s
LEFT JOIN scores sc ON s.id = sc.student_id
GROUP BY s.id, s.name;

-- 7. 修改视图（另一种方式）
ALTER VIEW student_score_view AS
SELECT s.id, s.name, COUNT(sc.score) AS exam_count
FROM students s
LEFT JOIN scores sc ON s.id = sc.student_id
GROUP BY s.id, s.name;

-- 8. 删除视图
DROP VIEW student_score_view;

-- 9. 删除视图（不存在也不报错）
DROP VIEW IF EXISTS student_score_view;
```

## 存储过程操作
```sql
-- ==================== 存储过程 ====================

DELIMITER //  -- 临时改变语句结束符，因为存储过程内部包含分号

-- 1. 无参数存储过程
CREATE PROCEDURE get_all_students()
BEGIN
    SELECT * FROM students;
END //

-- 2. 带输入参数的存储过程（IN）
CREATE PROCEDURE get_students_by_age(IN min_age INT, IN max_age INT)
BEGIN
    SELECT * FROM students WHERE age BETWEEN min_age AND max_age;
END //

-- 3. 带输出参数的存储过程（OUT）
CREATE PROCEDURE get_student_count(OUT total INT)
BEGIN
    SELECT COUNT(*) INTO total FROM students;
END //

-- 4. 带输入输出参数的存储过程（INOUT）
CREATE PROCEDURE double_number(INOUT num INT)
BEGIN
    SET num = num * 2;
END //

-- 5. 带条件判断的存储过程
CREATE PROCEDURE update_student_score(
    IN student_id INT,
    IN new_score INT,
    OUT message VARCHAR(100)
)
BEGIN
    DECLARE old_score INT;
    
    -- 查询旧分数
    SELECT score INTO old_score FROM scores WHERE id = student_id;
    
    -- 判断新分数是否有效
    IF new_score BETWEEN 0 AND 100 THEN
        UPDATE scores SET score = new_score WHERE id = student_id;
        SET message = CONCAT('更新成功，旧分数：', old_score, '，新分数：', new_score);
    ELSE
        SET message = '分数无效，必须在0-100之间';
    END IF;
END //

-- 6. 带循环的存储过程
CREATE PROCEDURE batch_insert(IN n INT)
BEGIN
    DECLARE i INT DEFAULT 1;
    WHILE i <= n DO
        INSERT INTO students (student_no, name, age) 
        VALUES (CONCAT('BATCH', LPAD(i, 5, '0')), CONCAT('批量', i), 18 + i % 10);
        SET i = i + 1;
    END WHILE;
END //

-- 7. 调用存储过程
CALL get_all_students();
CALL get_students_by_age(18, 22);
CALL get_student_count(@total);
SELECT @total;  -- 查看输出参数
CALL double_number(@num);
SET @num = 10;
CALL double_number(@num);
SELECT @num;  -- 20

-- 8. 查看所有存储过程
SHOW PROCEDURE STATUS WHERE Db = 'school';

-- 9. 查看存储过程定义
SHOW CREATE PROCEDURE get_all_students;

-- 10. 删除存储过程
DROP PROCEDURE get_all_students;
DROP PROCEDURE IF EXISTS get_all_students;

DELIMITER ;  -- 恢复默认结束符
```

## 触发器
```sql

-- ==================== 触发器（Trigger） ====================

-- 1. 创建日志表（记录操作历史）
CREATE TABLE students_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id INT,
    action VARCHAR(20),
    old_data TEXT,
    new_data TEXT,
    operator VARCHAR(50),
    operate_time DATETIME
);

DELIMITER //

-- 2. BEFORE INSERT 触发器（插入前触发）
CREATE TRIGGER before_student_insert
BEFORE INSERT ON students
FOR EACH ROW
BEGIN
    -- 自动设置入学时间
    SET NEW
```
