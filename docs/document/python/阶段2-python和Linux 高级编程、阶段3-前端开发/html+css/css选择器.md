# css 选择器

**学习目标**

-   能够说出 css 选择器的种类

* * *

### 1\. css 选择器的定义

css 选择器是用来选择标签的，选出来以后给标签加样式。

### 2\. css 选择器的种类

1.  标签选择器
2.  类选择器
3.  层级选择器(后代选择器)
4.  id选择器
5.  组选择器
6.  伪类选择器

### 3\. 标签选择器

根据标签来选择标签，**以标签开头**，此种选择器影响范围大，一般用来做一些通用设置。

**示例代码**

```html

    p{
        color: red;
    }

hello
hello
```

### 4\. 类选择器

根据类名来选择标签，**以 . 开头**, 一个类选择器可应用于多个标签上，一个标签上也可以使用多个类选择器，多个类选择器需要使用空格分割，应用灵活，可复用，是css中应用最多的一种选择器。

**示例代码**

```
<style type="text/css">
    .blue{color:blue}
    .big{font-size:20px}
    .box{width:100px;height:100px;background:gold} 
</style>

<div class="blue">这是一个div</div>
<h3 class="blue big box">这是一个标题</h3>
<p class="blue box">这是一个段落</p>
```

### 5\. 层级选择器(后代选择器)

根据层级关系选择后代标签，**以选择器1 选择器2开头**，主要应用在标签嵌套的结构中，减少命名。

**示例代码**

```
<style type="text/css">
    div p{
        color: red;
    }
    .con{width:300px;height:80px;background:green}
    .con span{color:red}
    .con .pink{color:pink}
    .con .gold{color:gold}    
</style>

<div>
    <p>hello</p>
</div>

<div class="con">
    <span>哈哈</span>
    <a href="#" class="pink">百度</a>
    <a href="#" class="gold">谷歌</a>
</div>
<span>你好</span>
<a href="#" class="pink">新浪</a>
```

**注意点: 这个层级关系不一定是父子关系，也有可能是祖孙关系，只要有后代关系都适用于这个层级选择器**

### 6\. id选择器

根据id选择标签，以#开头, 元素的id名称不能重复，所以id选择器只能对应于页面上一个元素，不能复用，id名一般给程序使用，所以不推荐使用id作为选择器。

**示例代码**

```
<style type="text/css">
    #box{color:red} 
</style>

<p id="box">这是一个段落标签</p>   <!-- 对应以上一条样式，其它元素不允许应用此样式 -->
<p>这是第二个段落标签</p> <!-- 无法应用以上样式，每个标签只能有唯一的id名 -->
<p>这是第三个段落标签</p> <!-- 无法应用以上样式，每个标签只能有唯一的id名  -->
```

**注意点: 虽然给其它标签设置id=“box”也可以设置样式，但是不推荐这样做，因为id是唯一的，以后js通过id只能获取一个唯一的标签对象。**

### 7\. 组选择器

根据组合的选择器选择不同的标签，**以 , 分割开**, 如果有公共的样式设置，可以使用组选择器。

**示例代码**

```
<style type="text/css">
    .box1,.box2,.box3{width:100px;height:100px}
    .box1{background:red}
    .box2{background:pink}
    .box2{background:gold}
</style>

<div class="box1">这是第一个div</div>
<div class="box2">这是第二个div</div>
<div class="box3">这是第三个div</div>
```

### 8\. 伪类选择器

用于向选择器添加特殊的效果, **以 : 分割开**, 当用户和网站交互的时候改变显示效果可以使用伪类选择器

**示例代码**

```
<style type="text/css">
    .box1{width:100px;height:100px;background:gold;}
    .box1:hover{width:300px;}
</style>

<div class="box1">这是第一个div</div>
```

### 9\. 小结

-   css 选择器就是用来选择标签设置样式的
-   常用的 css 选择器有六种，分别是:
    1.  标签选择器
    2.  类选择器
    3.  层级选择器(后代选择器)
    4.  id选择器
    5.  组选择器
    6.  伪类选择器
