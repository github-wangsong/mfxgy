# jQuery的用法

**学习目标**

-   能够知道jQuery的引入方式
-   能够说出两种jQuery入口函数的写法

* * *

### 1\. jQuery的引入

```js
<script src="js/jquery-1.12.4.min.js">
```

### 2\. jQuery的入口函数

我们知道使用js获取标签元素，需要页面加载完成以后再获取，我们通过给onload事件属性设置了一个函数来获取标签元素，而jquery提供了**ready函数**来解决这个问题，保证获取标签元素没有问题，**它的速度比原生的 window.onload 更快**。

**入口函数示例代码:**

```js

<script src="js/jquery-1.12.4.min.js">

    window.onload = function(){
        var oDiv = document.getElementById('div01');
        alert('原生就是获取的div：' + oDiv);
    };
    $(document).ready(function(){
        var $div = $('#div01');
        alert('jquery获取的div：' + $div);
    });

这是一个div
```

**入口函数的简写示例代码:**

```js

<script src="js/jquery-1.12.4.min.js">

    window.onload = function(){
        var oDiv = document.getElementById('div01');
        alert('原生就是获取的div：' + oDiv);
    };

    /*
    $(document).ready(function(){
        var $div = $('#div01');
        alert('jquery获取的div：' + $div);
    });
    */

    // 上面ready的写法可以简写成下面的形式：
    $(function(){
        var $div = $('#div01');
        alert('jquery获取的div：' + $div);
    }); 

这是一个div
```

### 3\. 小结

-   引入jQuery
-   获取标签元素需要在入口函数来完成，它的速度比原生的 window.onload 更快
-   jQuery入口函数有两种写法:
    
    ```js
      // 完整写法
      $(document).ready(function(){
           ...
      });
    
      // 简化写法
      $(function(){
           ...
      });
    ```
