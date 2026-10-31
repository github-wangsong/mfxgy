# ajax请求数据渲染个人中心页面

**学习目标**

-   能够知道使用ajax发送请求获取个人中心的数据

* * *

### 1\. 根据用户请求返回个人中心空模板文件数据

```py
# 获取个人中心数据
@route("/center.html")
def center():
    # 响应状态
    status = "200 OK"
    # 响应头
    response_header = [("Server", "PWS2.0")]

    # 打开模板文件，读取数据
    with open("template/center.html", "r") as file:
        file_data = file.read()

    # 替换模板文件中的模板遍历
    result = file_data.replace("{%content%}", "")

    return status, response_header, result
```

### 2\. 在个人中心模板文件添加ajax请求获取个人中心数据

```js
// 发送ajax请求获取个人中心页面数据
// 路径写成 center_data.html，发送ajax的时候路径其实是http://ip地址:端口号/center.data.html
$.get("center_data.html", function (data) {
        alert(data);
    }
}, "json");
```

### 3\. 将个人中心数据在页面完成展示

```js
// 发送ajax请求获取个人中心页面数据
$.get("center_data.html", function (data) {

    var data_array = data;

    // 获取table标签对象
    var $table = $(".table")
    for(var i = 0; i < data_array.length; i++){
        // 获取每一条对象
        var center_obj = data_array[i];
        var row_html = '' +
            ''+ center_obj.code +'' +
            ''+ center_obj.short +'' +
            ''+ center_obj.chg +'' +
            ''+ center_obj.turnover +'' +
            ''+ center_obj.price +'' +
            ''+ center_obj.highs +'' +
            ''+ center_obj.note_info +'' +
            '  修改 ';
        // 为table标签添加每一行组装的html数据
        $table.append(row_html);
    }

}, "json");
```

### 4\. 小结

-   根据用户请求返回个人中心空模板文件数据
-   在个人中心模板文件添加ajax请求获取个人中心数据
-   将个人中心数据在页面完成展示
