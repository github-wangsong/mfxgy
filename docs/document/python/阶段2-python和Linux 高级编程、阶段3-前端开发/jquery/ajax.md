# ajax

**学习目标**

-   能够知道ajax的作用

* * *

### 1\. ajax的介绍

ajax 是 Asynchronous JavaScript and XML的简写，ajax一个前后台配合的技术，它可以**让 javascript 发送异步的 http 请求，与后台通信进行数据的获取**，ajax 最大的优点是**实现局部刷新**，ajax可以发送http请求，当获取到后台数据的时候更新页面显示数据实现局部刷新，在这里大家只需要记住，**当前端页面想和后台服务器进行数据交互就可以使用ajax了。**

这里提示一下大家, **在html页面使用ajax需要在web服务器环境下运行, 一般向自己的web服务器发送ajax请求。**

### 2\. ajax的使用

jquery将它封装成了一个方法$.ajax()，我们可以直接用这个方法来执行ajax请求。

**示例代码:**

```js
<script>
    $.ajax({
    // 1.url 请求地址
    url:'http://t.weather.sojson.com/api/weather/city/101010100',
    // 2.type 请求方式，默认是'GET'，常用的还有'POST'
    type:'GET',
    // 3.dataType 设置返回的数据格式，常用的是'json'格式
    dataType:'JSON',
    // 4.data 设置发送给服务器的数据, 没有参数不需要设置
​
    // 5.success 设置请求成功后的回调函数
    success:function (response) {
        console.log(response);    
    },
    // 6.error 设置请求失败后的回调函数
    error:function () {
        alert("请求失败,请稍后再试!");
    },
    // 7.async 设置是否异步，默认值是'true'，表示异步，一般不用写
    async:true
});

```

**ajax方法的参数说明:**

1.  url 请求地址
2.  type 请求方式，默认是'GET'，常用的还有'POST'
3.  dataType 设置返回的数据格式，常用的是'json'格式
4.  data 设置发送给服务器的数据，没有参数不需要设置
5.  success 设置请求成功后的回调函数
6.  error 设置请求失败后的回调函数
7.  async 设置是否异步，默认值是'true'，表示异步，一般不用写
8.  同步和异步说明
    -   同步是一个ajax请求完成另外一个才可以请求，需要等待上一个ajax请求完成，好比线程同步。
    -   异步是多个ajax同时请求，不需要等待其它ajax请求完成， 好比线程异步。

**ajax的简写方式:**

$.ajax按照请求方式可以简写成$.get或者$.post方式

**ajax简写方式的示例代码:**

```js
 <script>
    $(function(){
        /*
         1. url 请求地址
         2. data 设置发送给服务器的数据, 没有参数不需要设置
         3. success 设置请求成功后的回调函数
         4. dataType 设置返回的数据格式，常用的是'json'格式, 默认智能判断数据格式
        */ 
        $.get("http://t.weather.sojson.com/api/weather/city/101010100", function(dat,status){
            console.log(dat);
            console.log(status);
            alert(dat);
        }).error(function(){
            alert("网络异常");
        });

        /*
         1. url 请求地址
         2. data 设置发送给服务器的数据, 没有参数不需要设置
         3. success 设置请求成功后的回调函数
         4. dataType 设置返回的数据格式，常用的是'json'格式, 默认智能判断数据格式
        */ 
        $.post("test.php", {"func": "getNameAndTime"}, function(data){
            alert(data.name); 
            console.log(data.time); 
        }, "json").error(function(){
            alert("网络异常");
        }); 
    });

```

**$.get和$.post方法的参数说明:**

$.get(url,data,success(data, status, xhr),dataType).error(func)  
$.post(url,data,success(data, status, xhr),dataType).error(func)

1.  url 请求地址
2.  data 设置发送给服务器的数据，没有参数不需要设置
3.  success 设置请求成功后的回调函数
    -   data 请求的结果数据
    -   status 请求的状态信息, 比如: "success"
    -   xhr 底层发送http请求XMLHttpRequest对象
4.  dataType 设置返回的数据格式
    -   "xml"
    -   "html"
    -   "text"
    -   "json"
5.  error 表示错误异常处理
    -   func 错误异常回调函数

### 3\. 小结

-   ajax 是发送http请求获取后台服务器数据的技术
-   ajax的简写方式可以使用$.get和$.post方法来完成
