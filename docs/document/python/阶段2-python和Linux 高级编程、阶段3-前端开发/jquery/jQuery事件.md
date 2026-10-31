# jQuery事件

**学习目标**

-   能够说出两个常用的jQuery事件

* * *

### 1\. 常用事件

-   click() 鼠标单击
-   blur() 元素失去焦点
-   focus() 元素获得焦点
-   mouseover() 鼠标进入（进入子元素也触发）
-   mouseout() 鼠标离开（离开子元素也触发）
-   ready() DOM加载完成

**示例代码:**

```js
<script>
    $(function(){
        var $li = $('.list li');
        var $button = $('#button1')
        var $text = $("#text1");
        var $div = $("#div1")

        //  鼠标点击
        $li.click(function(){             
            // this指的是当前发生事件的对象，但是它是一个原生js对象
            // this.style.background = 'red';

            // $(this) 指的是当前发生事件的jquery对象
            $(this).css({'background':'gold'});
            // 获取jquery对象的索引值,通过index() 方法
            alert($(this).index());
        });

        //  一般和按钮配合使用
        $button.click(function(){
            alert($text.val());
        });

        //  获取焦点
        $text.focus(function(){
            $(this).css({'background':'red'});

        });

        //  失去焦点
        $text.blur(function(){
            $(this).css({'background':'white'});

        });

        //  鼠标进入
        $div.mouseover(function(){
            $(this).css({'background':'gold'});

        });

        //  鼠标离开
        $div.mouseout(function() {
            $(this).css({'background':'white'});
        });
    });

    
        列表文字
        列表文字
        列表文字
    

    
    

```

**说明:**

-   this指的是当前发生事件的对象，但是它是一个原生js对象
-   $(this) 指的是当前发生事件的jquery对象

### 2\. 小结

jQuery常用事件:

-   click() 鼠标单击
-   blur() 元素失去焦点
-   focus() 元素获得焦点
-   mouseover() 鼠标进入（进入子元素也触发）
-   mouseout() 鼠标离开（离开子元素也触发）
-   ready() DOM加载完成
