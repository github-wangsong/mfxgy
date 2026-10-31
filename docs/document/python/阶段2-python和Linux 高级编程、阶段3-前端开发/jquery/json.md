# json

**学习目标**

-   能够知道json的格式

* * *

### 1\. json的介绍

json是 JavaScript Object Notation 的首字母缩写，翻译过来就是javascript对象表示法，这里说的json就是**类似于javascript对象的字符串**，它同时是一种**数据格式**，目前这种数据格式比较流行，逐渐替换掉了传统的xml数据格式。

### 2\. json的格式

json有两种格式：

1.  对象格式
2.  数组格式

**对象格式:**

对象格式的json数据，使用一对大括号({})，大括号里面放入key:value形式的键值对，多个键值对使用逗号分隔。

**对象格式的json数据:**

```json
{
    "name":"tom",
    "age":18
}
```

**格式说明:**

json中的(key)属性名称和字符串值需要用**双引号**引起来，用单引号或者不用引号会导致读取数据错误。

**数组格式:**

数组格式的json数据，使用一对中括号(\[\])，中括号里面的数据使用逗号分隔。

**数组格式的json数据:**

```json
["tom",18,"programmer"]
```

**实际开发的json格式比较复杂,例如:**

```json
{
    "name":"jack",
    "age":29,
    "hobby":["reading","travel","photography"]
    "school":{
        "name":"Merrimack College",
        "location":"North Andover, MA"
    }
}
```

### 3\. json数据转换成JavaScript对象

**json本质上是字符串**，如果在js中操作json数据，可以将json字符串转化为JavaScript对象。

**示例代码:**

```json
var sJson = '{"name":"tom","age":18}';
var oPerson = JSON.parse(sJson);

// 操作属性
alert(oPerson.name);
alert(oPerson.age);
```

### 4\. 小结

-   json就是一个javascript对象表示法，json本质上是一个字符串。
-   json有两种格式：1. 对象格式, 2. 数组格式
