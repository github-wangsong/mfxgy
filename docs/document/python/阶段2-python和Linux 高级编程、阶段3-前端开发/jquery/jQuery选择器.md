# jQuery选择器

**学习目标**

-   能够使用jQuery选择器获取标签元素

* * *

### 1\. jQuery选择器的介绍

jquery选择器就是快速选择标签元素，获取标签的，选择规则和css样式一样。

### 2\. jQuery选择器的种类

1.  标签选择器
2.  类选择器
3.  id选择器
4.  层级选择器
5.  属性选择器

**示例代码:**

```js
$('#myId') //选择id为myId的标签
$('.myClass') // 选择class为myClass的标签
$('li') //选择所有的li标签
$('#ul1 li span') //选择id为ul1标签下的所有li标签下的span标签
$('input[name=first]') // 选择name属性等于first的input标签
```

**说明:**  
可以使用length属性来判断标签是否选择成功, 如果length大于0表示选择成功，否则选择失败。

```js
$(function(){
    result = $("div").length;
    alert(result);
});
```

### 3\. 小结

-   jQuery选择器就是选择标签的
-   标签选择器是**根据标签名来选择标签**
-   类选择器是**根据类名来选择标签**
-   id选择器是**根据id来选择标签**
-   层级选择器是**根据层级关系来选择标签**
-   属性选择器是**根据属性名来选择标签**
