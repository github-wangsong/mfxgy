# 01 · json 与 jsonb 及读写操作符

> 所属：阶段 3 · JSONB 与半结构化数据
> 本篇覆盖：`json` vs `jsonb` 的区别与选型、读取操作符（`->` `->>` `#>` `#>>`）、判断操作符（`@>` `<@` `?` `?|` `?&`）、写与改（`jsonb_set`、`||`、`-`、`#-`）、构造与转换（`jsonb_build_object`、`jsonb_build_array`、`to_jsonb`）、往返一致性
> **本篇首次教学：`jsonb` 类型的完整读写操作符体系与两类型语义差异**（后续篇只引用，不再重讲；GIN 索引在 `02` 篇）
> 预告：GIN 索引与项目画布 `graph` 字段实战见 `03-JSONB与半结构化数据/02-GIN索引与项目实战.md`。

> 练习统一在 `pg_tutorial` 库做；`users` 表来自 `00-03`（已含 `profile jsonb` 列）。psql 连接与元命令见 `02` 篇。

---

## 1. 本篇目标

- 能说清 `json` 和 `jsonb` 的**本质区别**，并给出选型结论：默认用 `jsonb`。
- 会用 `->` / `->>` / `#>` / `#>>` 从 JSON 里**取值**，并分清「返回 jsonb」还是「返回 text」。
- 会用 `@>` / `<@` / `?` / `?|` / `?&` 做**包含与键存在**判断。
- 会用 `jsonb_set`、`||`、`-`、`#-` **修改** JSONB。
- 会用 `jsonb_build_object` / `jsonb_build_array` / `to_jsonb` **构造** JSONB。

**验收标准**：对一张含 `jsonb` 列的表，能独立完成「取值、判断、修改、构造」四类操作，且能解释每次返回结果为何是文本还是 JSON。

---

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| 起点 | 已完成 `00-03`（建了含 `profile jsonb` 的 `users` 表），并对 `00-04` 的 CRUD 有印象 |
| 环境 | psql 已连上 `pg_tutorial` |
| 知识 | `jsonb` 类型名在 `00-03` 见过；本篇是它的完整首次教学 |

---

## 3. json vs jsonb：一句话选型

PG 有两个「存 JSON」的类型，长得像但语义不同：

| 维度 | `json` | `jsonb`（binary） |
| --- | --- | --- |
| 本质 | **原样保存你输入的文本**（只校验是不是合法 JSON） | **解析后按二进制格式存储**（去空格、键排序、去重复键） |
| 是否保真 | 是，逐字符保真（含键顺序、重复键、空格） | 否，会被「规范化」 |
| 写入速度 | 快（不做解析/转换） | 慢一点（要解析） |
| 读取/查询速度 | 慢（每次用都要重新解析文本） | 快（已解析好） |
| 能否建索引 | 不能直接建 GIN | **能建 GIN 索引**（`02` 篇） |
| 是否支持操作符 | 有限 | 完整支持 `->` `@>` 等全套操作符 |

> **结论**：绝大多数场景（存数据 + 查询 + 索引 + 用操作符）都用 `jsonb`。`json` 只在「必须逐字符原样保留原始文本」的罕见场景才用（例如要审计外部系统发来的 JSON 原始字节）。
> 因此本系列（及项目画布 `graph` 字段）一律用 `jsonb`。

---

## 4. 准备：给 users.profile 灌一点真实数据

先把 `00-03` 建的 `users` 表里那条 `alice` 的 `profile` 填上内容（构造操作符 `jsonb_build_object` 第 8 节详解，这里先用）：

```sql
UPDATE users
SET profile = jsonb_build_object(
    'nickname',  'Alice',
    'city',      'Shanghai',
    'age',       28,
    'skills',    jsonb_build_array('sql', 'postgres', 'python'),
    'settings',  jsonb_build_object('theme', 'dark', 'notify', true)
)
WHERE username = 'alice';

SELECT username, profile FROM users WHERE username = 'alice';
```

**预期输出**（jsonb 已规范化，注意键被排序、`true` 保留为布尔）：

```
 username |                                        profile
----------+---------------------------------------------------------------------------------------
 alice    | {"age": 28, "city": "Shanghai", "nickname": "Alice", "settings": {"notify": true, "theme": "dark"}, "skills": ["sql", "postgres", "python"]}
```

> 注意两点：①`skills` 的值是 JSON **数组** `["sql", ...]`；②键已经按「长度→字典序」被重新排序（`age` 排最前），这是 jsonb 的规范化表现，正文第 10 节会展开。

---

## 5. 取值：`->` 与 `->>`

JSON 里取值和「类型」强相关，PG 用「箭头个数」来区分**取出的东西是 JSON 还是文本**。

### 5.1 `->`：取出「JSON 子对象」（返回 jsonb）

`->` 后面跟**键名（文本）**或**数组下标（整数）**，取出的结果仍是 `jsonb`。

```sql
-- 取一个对象字段（键），结果是 jsonb
SELECT profile -> 'city'        AS city_obj,
       pg_typeof(profile -> 'city') AS city_type
FROM users WHERE username = 'alice';

-- 取数组元素（整数下标，从 0 开始），结果仍是 jsonb
SELECT profile -> 'skills' -> 1 AS second_skill
FROM users WHERE username = 'alice';
```

**预期输出**：

```
 city_obj  | city_type
-----------+-----------
 "Shanghai"| jsonb
```

```
 second_skill
--------------
 "postgres"
```

> 关键：`-> 'city'` 拿到的是 `"Shanghai"`——**带着双引号的 JSON 字符串**，类型是 `jsonb`。所以它不能直接拿来和普通文本比较/拼接。

### 5.2 `->>`：取出「纯文本」（返回 text）

`->>` 和 `->` 的唯一区别是：它把结果**转成文本**（去掉 JSON 的引号），类型是 `text`。

```sql
SELECT profile ->> 'city'          AS city_text,
       pg_typeof(profile ->> 'city') AS city_type,
       profile -> 'skills' ->> 0   AS first_skill
FROM users WHERE username = 'alice';
```

**预期输出**：

```
 city_text | city_type | first_skill
-----------+-----------+-------------
 Shanghai  | text      | sql
```

### 5.3 用一张表记牢

| 写法 | 返回类型 | 例子（`profile`） | 结果 |
| --- | --- | --- | --- |
| `profile -> 'city'` | `jsonb` | 取对象字段 | `"Shanghai"`（带引号） |
| `profile ->> 'city'` | `text` | 取对象字段的文本 | `Shanghai`（无引号） |
| `profile -> 'skills' -> 1` | `jsonb` | 数组下标 1 | `"postgres"` |
| `profile -> 'skills' ->> 1` | `text` | 数组下标 1 的文本 | `postgres` |

> **记忆口诀**：`->` 拿「JSON 里的东西」（还是 jsonb），`->>` 拿「文本」。需要参与字符串比较 / 拼 SQL 时用 `->>`。

---

## 6. 取深层值：`#>` 与 `#>>`

嵌套深的时候，一路 `->` 会写成 `a -> 'x' -> 'y'`。PG 提供了「路径」写法，一次指到位。

`#>` / `#>>` 也用「箭头个数」区分返回 jsonb / text，但**右边跟的是一个路径数组**（`text[]`）。

```sql
-- #> 返回 jsonb：取 profile -> settings -> theme
SELECT profile #> '{settings,theme}'              AS theme_obj,
       pg_typeof(profile #> '{settings,theme}')   AS theme_type
FROM users WHERE username = 'alice';

-- #>> 返回 text：同路径的纯文本
SELECT profile #>> '{settings,theme}' AS theme_text
FROM users WHERE username = 'alice';
```

**预期输出**：

```
 theme_obj | theme_type
-----------+-----------
 "dark"    | jsonb
```

```
 theme_text
------------
 dark
```

### 6.1 路径里也能带数组下标

路径数组的每一段可以是「键」或「数组下标（用字符串写数字）」：

```sql
-- 取 skills 数组的第 2 个字符串（skills 是数组，2 是下标）
SELECT profile #>> '{skills,2}' AS third_skill
FROM users WHERE username = 'alice';
```

**预期输出**：

```
 third_skill
-------------
 python
```

> 对照记忆：`->` 链和 `#>` 路径等价——`profile -> 'settings' -> 'theme'` ≡ `profile #> '{settings,theme}'`。路径写法更适合「路径是动态计算出来的」场景。

---

## 7. 包含与键存在：`@>` `<@` `?` `?|` `?&`

查询 JSONB 时，除了取值，还常要「判断」。

### 7.1 `@>`：左边是否**包含**右边（左包含右）

「包含」的含义：右边的每个键值对、每个数组元素，都在左边出现过。是**最常用**的查询操作符（也是 GIN 索引加速的主力，`02` 篇）。

```sql
-- 判断 profile 是否包含 {"city":"Shanghai"}（通常放在 WHERE 里）
SELECT username
FROM users
WHERE profile @> '{"city": "Shanghai"}'::jsonb;

-- 数组包含判断：skills 是否包含 "postgres"
SELECT username
FROM users
WHERE profile -> 'skills' @> '["postgres"]';
```

**预期输出**：返回 `alice`（两行都命中）。

> 注意两个「@> 右边的值」要写成**合法 JSON**：对象用 `{"k":v}`、数组用 `[...]`，且比较前用 `::jsonb` 显式转换，避免歧义。

### 7.2 `<@`：右边是否包含左边（是 `@>` 的反向）

```sql
SELECT profile <@ '{"age": 28, "city": "Shanghai", "nickname": "Alice",
                    "settings": {"notify": true, "theme": "dark"},
                    "skills": ["sql", "postgres", "python"]}'::jsonb AS is_subset
FROM users WHERE username = 'alice';
```

**预期输出**：`t`（`alice` 的 profile 确实被这个大对象包含）。

### 7.3 `?`：**顶层**是否存在某个键

```sql
SELECT profile ? 'city' AS has_city,
       profile ? 'email' AS has_email
FROM users WHERE username = 'alice';
```

**预期输出**：`t | f`。

> 注意 `?` 只看**顶层键**，不看嵌套。要判断深层键，先 `->` 下去再 `?`，例如 `profile -> 'settings' ? 'theme'`。

### 7.4 `?|` / `?&`：任意一个键存在 / 全部键都存在

右边跟一个**文本数组**：

```sql
-- 任意一个存在（city 或 email 至少有一个）→ t
SELECT profile ?| array['city', 'email'] AS any_exist;
-- 全部存在（city 和 age 都要有）→ t
SELECT profile ?& array['city', 'age']    AS all_exist
FROM users WHERE username = 'alice';
```

**预期输出**：`any_exist = t`，`all_exist = t`（`city`、`age` 都有）。

---

## 8. 写入与修改：`jsonb_set`、`||`、`-`、`#-`

jsonb 是**不可变**的：所有「修改」实际上都生成一个新的 jsonb，你要把它 `UPDATE` 回列里或 `SELECT` 出来。

### 8.1 `jsonb_set`：按路径改/增一个值

```sql
jsonb_set(目标 jsonb, 路径 text[], 新值 jsonb [, create_missing 默认 true])
```

- 路径写不存在的键时，`create_missing = true`（默认）会**新建**；`false` 则不改。
- **关键坑**：`新值`必须是合法 JSON —— 字符串要写 `'"Dark"'`（带双引号），数字写 `'30'`，布尔写 `'false'`。

```sql
-- 把 city 改成 Beijing，再把 age 改成 30
SELECT jsonb_set(
           jsonb_set(profile, '{city}', '"Beijing"'),
           '{age}',  '30'
       ) AS updated
FROM users WHERE username = 'alice';
```

**预期输出**（注意层次：嵌套 jsonb_set 从内向外执行）：

```
 {"city": "Beijing", "age": 30, ... 其余字段不变 ...}
```

### 8.2 `||`：拼接两个 jsonb（后者覆盖前者同键）

```sql
-- 用一个「补丁对象」覆盖原 profile 的昵称与城市
SELECT profile || '{"nickname": "Neo", "vip": true}'::jsonb AS merged
FROM users WHERE username = 'alice';
```

**预期输出**：原 `nickname` 被覆盖为 `Neo`，并新增了顶层键 `vip`。

> 这里的 `||` 是 jsonb 的**拼接/合并**语义；而在 MySQL 里 `||` 默认是「逻辑或」，两者要分清（差异已在 `02-差异专题/02` 讲过拼接对照，此处是 jsonb 专用合并）。

### 8.3 `-` / `#-`：删除键或数组元素

```sql
-- 删除顶层键 city
SELECT profile - 'city' AS removed_key;
-- 删除 skills 数组下标 0 的元素
SELECT profile #- '{skills,0}' AS removed_elem
FROM users WHERE username = 'alice';
```

**预期输出**：第一个结果 `city` 键消失；第二个结果 `skills` 变成 `["postgres", "python"]`。

---

## 9. 构造与转换

### 9.1 `jsonb_build_object` / `jsonb_build_array`

把「PG 里已有的值」打包成 JSONB。用于 `UPDATE` 里给 jsonb 列赋结构化值（第 4 节已用过）。

```sql
SELECT jsonb_build_object('id', 1, 'name', 'alice', 'tags', jsonb_build_array('a', 'b', 'c'));
```

**预期输出**：

```
 {"id": 1, "name": "alice", "tags": ["a", "b", "c"]}
```

### 9.2 `to_jsonb` / `to_json`：把「任意类型的值/行」转成 JSON

- 对单个标量：`to_jsonb('hello')` → `"hello"`。
- 对整行：`to_jsonb(row)` 或简写 `to_jsonb(t.*)`。

```sql
-- 把整行转成 JSONB（表单里的常见操作）
SELECT to_jsonb(u) AS row_json
FROM users u
WHERE username = 'alice';
```

**预期输出**：一整个 JSON 对象，键是列名，值是对应列值（含 `id`、`created_at` 等全部列）。

### 9.3 字面量 + `::jsonb`

直接把字符串文本转成 jsonb（第 7 节 `@>` 里就是这么用的）：

```sql
SELECT '{"a": 1, "b": [1, 2, 3]}'::jsonb;
```

> 三者区别：`::jsonb` 从「字符串字面量」转；`jsonb_build_object` 从「散落的列/值」拼；`to_jsonb` 从「PG 类型值/整行」转。用哪个取决于你手里是什么。

---

## 10. 往返一致性：jsonb 会"整理"你的 JSON

这是 `json` 和 `jsonb` 最直观的行为差异，也是「为什么 `\d` 里看到的 jsonb 和你写的不一样」的根源。

> 「往返一致性」：你 `INSERT` 进去的 JSON 文本，再 `SELECT` 出来是否与原始完全一致。

### 10.1 `json` 逐字符保真

```sql
SELECT '{"b":1,"a":2}'::json AS j;   -- 原样：键序 b,a 保持不变
```

**预期输出**：`{"b":1,"a":2}` —— 完全是你写的顺序。

### 10.2 `jsonb` 规范化：去空格、键排序、去重复键

```sql
SELECT '{"b":1,"a":2}'::jsonb     AS sorted,          -- 键排序 → {"a": 2, "b": 1}
       ' { "a" : 1 } '::jsonb     AS no_space,        -- 去空格 → {"a": 1}
       '{"a":1,"a":2}'::jsonb     AS dedup;           -- 重复键留最后一个 → {"a": 2}
```

**预期输出**：

```
 sorted      | no_space   | dedup
-------------+------------+--------
 {"a": 2, "b": 1} | {"a": 1} | {"a": 2}
```

| 现象 | `json` | `jsonb` |
| --- | --- | --- |
| 空格/换行 | 保留 | 去除 |
| 键顺序 | 保留写序 | 按「长度 → 字典序」重排 |
| 重复键 | 保留全部 | 只保留最后出现的那个 |
| 数字 | 原样文本 | 按 `numeric` 规范化 |

> **实战意义**：不要依赖 jsonb 的键顺序（它不是你插入的顺序）——需要「顺序」的语义（如字段展示顺序）请用数组或单独列，别用对象键序。
> 若你的业务必须**逐字节保真**（例如存档外部原始报文），才退回用 `json`。

---

## 11. 与 MySQL 对照

| 维度 | MySQL | PostgreSQL |
| --- | --- | --- |
| 存 JSON 的类型 | `JSON`（5.7+，本质是 `LONGTEXT` + 校验，二进制存储） | `json`（文本）/ `jsonb`（二进制，**默认推荐**） |
| 取值函数 | `JSON_EXTRACT(col, '$.a')`、`->>`、`->` | `col -> 'a'`、`col ->> 'a'`、`#>`、`#>>` |
| 是否区分「取 JSON vs 取文本」 | `->` 取 JSON、`->>` 取文本（同 PG） | 同左，另加 `#>`/`#>>` 路径写法 |
| 包含判断 | `JSON_CONTAINS(a, b)` 函数 | `@>` / `<@` 操作符（可被 GIN 索引加速） |
| 键存在 | `JSON_CONTAINS_PATH` 函数 | `?` / `?|` / `?&` 操作符 |
| 修改 | `JSON_SET` / `JSON_REPLACE` / `JSON_REMOVE` 函数 | `jsonb_set`、`||` 合并、`-`/`#-` 删除 |
| 索引 | 5.7 起可用**生成列 + 索引**间接加速 | **原生 GIN 索引**直接加速 `@>`/`?`（`02` 篇） |

> 一句话：MySQL 主要靠**函数**操作 JSON，PG 主要靠**操作符**（更简洁、且操作符能被 GIN 索引识别）。这也是 PG 处理半结构化数据更顺的原生优势。

---

## 12. 验收自测

> 都过了才算完成本篇。

### 12.1 能取对值

```sql
SELECT profile ->> 'city'        AS a,   -- 预期 Shanghai（text）
       profile #>> '{settings,theme}' AS b,   -- 预期 dark（text）
       profile -> 'skills' ->> 2 AS c    -- 预期 python（text）
FROM users WHERE username = 'alice';
```

### 12.2 能判断

```sql
-- 三句话：city 存在？包含 {"age":28}？skills 包含 "sql"？
SELECT profile ? 'city',
       profile @> '{"age": 28}',
       profile -> 'skills' @> '["sql"]'
FROM users WHERE username = 'alice';
-- 预期：t | t | t
```

### 12.3 能改

```sql
-- 把 age 改成 30，且新增顶层键 vip=true
SELECT profile || jsonb_build_object('age', 30, 'vip', true)
FROM users WHERE username = 'alice';
-- 预期：age 变 30，出现 vip
```

### 12.4 能解释往返一致性

口头说清：为什么 `SELECT '{"b":1,"a":2}'::jsonb` 出来是 `{"a": 2, "b": 1}`，而 `::json` 保持原样。

---

## 13. 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `-> 'city'` 结果是 `"Shanghai"` 带引号，和 `'Shanghai'` 比不相等 | `->` 返回的是 jsonb，不是文本 | 用 `->>` 取文本 |
| `jsonb_set` 后想改列，但 `SELECT` 有变化、表没变 | jsonb 不可变，函数只是返回新值 | `UPDATE ... SET col = jsonb_set(...)` 回写 |
| `jsonb_set(...,'"Dark"')` 报类型错 | 新值要写合法 JSON（字符串要带双引号），不能裸 `'Dark'` | 字符串写 `'"Dark"'`，数字写 `'30'` |
| `profile ? 'theme'` 返回 `f`，明明 settings 里有 theme | `?` 只看**顶层**键 | 先 `-> 'settings'` 再 `?` |
| `@>` 右边没加 `::jsonb` 报错或歧义 | 右边字符串被当成 text 而非 jsonb | 写 `'{...}'::jsonb` |
| 奇怪为什么 jsonb 键序变了 | jsonb 会规范化（键排序） | 别依赖键序；要顺序用数组 |
| 依赖重复键去重后「只有最后一个」跑错逻辑 | jsonb 遇到重复键只留最后一个 | 别在生产 JSON 里写重复键 |

---

## 14. 小结

- **选型**：默认 `jsonb`（先解析、支持操作符与 GIN 索引）；`json` 仅用于逐字节保真存档。
- **取值**：`->`/`#>` 返回 jsonb，`->>`/`#>>` 返回 text；`#>`/`#>>` 用路径数组一次到位。
- **判断**：`@>` 左包含右（最常用查询）、`<@` 反向、`?` 顶层键存在、`?|`/`?&` 任意/全部键存在。
- **修改**：jsonb 不可变，用 `jsonb_set` / `||` / `-` / `#-` 生成新值后回写。
- **构造**：`jsonb_build_object` / `jsonb_build_array` 从值拼，`to_jsonb` 从值/整行转，`::jsonb` 从字符串字面量转。
- **往返**：`json` 保真、`jsonb` 规范化（去空格、键排序、去重复键）。

下一篇 `02` 将把这些操作符（尤其 `@>`、`?`）接到 **GIN 索引**上，并对项目画布 `graph` 字段做「节点查询走索引」的实战验证。