# JavaScript对象

**学习目标**

-   能够知道JavaScript对象有两种创建方式

* * *

### 1\. JavaScript对象的介绍

JavaScript 中的所有事物都是对象：字符串、数值、数组、函数等都可以认为是对象，此外，JavaScript 允许自定义对象，对象可以拥有属性和方法。

### 2\. JavaScript创建对象操作

创建自定义javascript对象有两种方式:

-   通过顶级Object类型来实例化一个对象
-   通过对象字面量创建一个对象

**Object类创建对象的示例代码:**

```js
<script>
    var person = new Object();

    // 添加属性：
    person.name = 'tom';
    person.age = '25';

    // 添加方法：
    person.sayName = function(){
        alert(this.name);
    }

    // 调用属性和方法：
    alert(person.age);
    person.sayName();

```

**对象字面量创建对象的示例代码:**

```js
<script>
    var person2 = {
        name:'Rose',
        age: 18,
        sayName:function(){
            alert('My name is' + this.name);
        }
    }

    // 调用属性和方法：
    alert(person2.age);
    person2.sayName();

```

**说明:**

调用属性和方法的操作都是通过点语法的方式来完成，对象的创建推荐使用字面量方式，因为更加简单。

### 3\. 小结

创建自定义javascript对象有两种方式:

-   Object
-   字面量
