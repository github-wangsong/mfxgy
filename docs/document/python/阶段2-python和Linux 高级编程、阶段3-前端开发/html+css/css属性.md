# css 属性

**学习目标**

-   能够知道常用的样式属性

* * *

我们知道 css 作用是美化 HTML 网页和控制页面布局的,接下来我们来学习一下经常使用一些样式属性。

### 1\. 布局常用样式属性

-   width 设置元素(标签)的宽度，如：width:100px;
-   height 设置元素(标签)的高度，如：height:200px;
-   background 设置元素背景色或者背景图片，如：background:gold; 设置元素的背景色, background: url(images/logo.png); 设置元素的背景图片。
-   border 设置元素四周的边框，如：border:1px solid black; 设置元素四周边框是1像素宽的黑色实线
-   以上也可以拆分成四个边的写法，分别设置四个边的：
-   border-top 设置顶边边框，如：border-top:10px solid red;
-   border-left 设置左边边框，如：border-left:10px solid blue;
-   border-right 设置右边边框，如：border-right:10px solid green;
-   border-bottom 设置底边边框，如：border-bottom:10px solid pink;
-   padding 设置元素包含的内容和元素边框的距离，也叫内边距，如padding:20px;padding是同时设置4个边的，也可以像border一样拆分成分别设置四个边:padding-top、padding-left、padding-right、padding-bottom。
-   margin 设置元素和外界的距离，也叫外边距，如margin:20px;margin是同时设置4个边的，也可以像border一样拆分成分别设置四个边:margin-top、margin-left、margin-right、margin-bottom。
-   float 设置元素浮动，浮动可以让块元素排列在一行，浮动分为左浮动：float:left; 右浮动：float:right;

### 2\. 文本常用样式属性

-   color 设置文字的颜色，如： color:red;
-   font-size 设置文字的大小，如：font-size:12px;
-   font-family 设置文字的字体，如：font-family:'微软雅黑';为了避免中文字不兼容，一般写成：font-family:'Microsoft Yahei';
-   font-weight 设置文字是否加粗，如：font-weight:bold; 设置加粗 font-weight:normal 设置不加粗
-   line-height 设置文字的行高，如：line-height:24px; 表示文字高度加上文字上下的间距是24px，也就是每一行占有的高度是24px
-   text-decoration 设置文字的下划线，如：text-decoration:none; 将文字下划线去掉
-   text-align 设置文字水平对齐方式，如text-align:center 设置文字水平居中
-   text-indent 设置文字首行缩进，如：text-indent:24px; 设置文字首行缩进24px

### 3\. 布局常用样式属性示例代码

```html

    .box1{
        width: 200px; 
        height: 200px; 
        background:yellow; 
        border: 1px solid black;
    }

    .box2{
        /* 这里是注释内容 */
        /* 设置宽度 */
        width: 100px;
        /* 设置高度 */
        height: 100px;
        /* 设置背景色 */
        background: red;
        /* 设置四边边框 */
        /* border: 10px solid black; */
        border-top: 10px solid black;
        border-left: 10px solid black;
        border-right: 10px solid black;
        border-bottom: 10px solid black;
        /* 设置内边距， 内容到边框的距离，如果设置四边是上右下左 */
        /* padding: 10px;   */
        padding-left: 10px;
        padding-top: 10px;
        /* 设置外边距，设置元素边框到外界元素边框的距离 */
        margin: 10px;
        /* margin-top: 10px;
        margin-left: 10px; */
        float: left;
    }

    .box3{
        width: 48px; 
        height: 48px; 
        background:pink; 
        border: 1px solid black;
        float: left;
    }

    
        padding 设置元素包含的内容和元素边框的距离
    
    
    

```

### 4\. 文本常用样式属性示例

```html

    p{
       /* 设置字体大小  浏览器默认是 16px */
       font-size:20px;
       /* 设置字体 */
       font-family: "Microsoft YaHei"; 
       /* 设置字体加粗 */
       font-weight: bold;
       /* 设置字体颜色 */
       color: red;
       /* 增加掉下划线 */
       text-decoration: underline;
       /* 设置行高  */
       line-height: 100px;
       /* 设置背景色 */
       background: green;
       /* 设置文字居中 */
       /* text-align: center; */
       text-indent: 40px;
    }

    a{
        /* 去掉下划线 */
        text-decoration: none;
    }

连接标签

    你好，世界!

```

### 5\. 小结

-   设置不同的样式属性会呈现不同网页的显示效果
-   样式属性的表现形式是: **属性名:属性值;**
