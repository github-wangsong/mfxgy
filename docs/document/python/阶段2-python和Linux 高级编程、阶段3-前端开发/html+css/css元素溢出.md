# css 元素溢出

**学习目标**

-   能够说出元素溢出的解决办法

* * *

### 1\. 什么是 css 元素溢出

当**子元素(标签)的尺寸超过父元素(标签)的尺寸时**，此时需要设置父元素显示溢出的子元素的方式，设置的方法是通过**overflow属性**来完成。

**overflow的设置项：**

1.  visible 默认值, 显示子标签溢出部分。
2.  hidden 隐藏子标签溢出部分。
3.  auto 如果子标签溢出，则可以滚动查看其余的内容。

### 2\. 示例代码

```
<style>
    .box1{
        width: 100px;
        height: 200px;
        background: red;
        /* 在父级上设置子元素溢出的部分如何显示 */
        /* overflow: hidden; */
        overflow: auto;
    }
    .box2{
        width: 50px;
        height: 300px;
        background: yellow;
    }
</style>

<div class="box1">
    <div class="box2">hello</div>
</div>
```

### 3\. 小结

-   overflow样式属性是设置子标签溢出的显示方式
-   常用使用**overflow:hidden;**来解决元素溢出
