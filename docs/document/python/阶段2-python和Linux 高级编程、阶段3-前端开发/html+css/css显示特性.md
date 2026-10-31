# css 显示特性

**学习目标**

-   能够说出标签隐藏设置

* * *

### 1\. display 属性的使用

display 属性是用来设置元素的类型及隐藏的，常用的属性有：

-   none 元素隐藏且不占位置
-   inline 元素以行内元素显示
-   block 元素以块元素显示

### 2\. 示例代码

```
<style>
    .box{
        /* 将块元素转化为行内元素 */
        display:inline;
    } 

    .link01{
        /* 将行内元素转化为块元素 */
        display:block;
        background: red;

    }

    .con{
        width:200px;
        height:200px;
        background:gold;

        /* 将元素隐藏 */
        display:none;
    }

</style>

<div class="con"></div>
<div class="box">这是第一个div</div>
<div class="box">这是第二个div</div>
<a href="#" class="link01">这是第一个链接</a>
<a href="#" class="link01">这是第二个链接</a>
```

**说明:**

行内元素不能设置宽高， 块元素或者行内块元素可以设置宽高。

### 3\. 小结

-   通常隐藏元素使用 `display:none`
