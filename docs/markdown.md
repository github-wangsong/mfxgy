# markdown语法


## 1 标题

```markdown
# h1
## h2
### h3 
#### h4
##### h5
###### h6

```
## 2 分级标题
```markdown
一级标题
===============
二级标题
---------------

```
## 3 根据标题生成目录

[[toc]]

```markdown
[[toc]]

```
## 4 引用

> hello world

>  请问 Markdown 怎么用？  - 小白
>
>>  自己看教程！  -  愤青
>>  
>>>  教程在哪？  -  小白
>>  
>>  我也不知道在哪！  -  愤青
>
>  那你回答个屁。  -  小白
```markdown
> hello world

>  请问 Markdown 怎么用？  -  小白
>
>>  自己看教程！  -  愤青
>>  
>>>  教程在哪？  -  小白
>>  
>>  我也不知道在哪！  -  愤青
>
>  那你回答个屁。  -  小白

```

## 5 字体
*斜体*

**粗体**

~~删除线~~

`高亮`

<u>下划线</u>

<span style="border-bottom:2px dashed yellow;">加下划线用的是html代码</span>
```markdown
  *斜体*
  **粗体** 
  ~~删除线~~
  `高亮`
  <u>下划线</u>
  <span style="border-bottom:2px dashed yellow;
```

## 6 插入链接
[百度1](http://www.baidu.com/ "百度一下")

[百度2][2]

[2]:http://www.baidu.com/

<https://markdown.com.cn>

```markdown
[百度1](http://www.baidu.com/ "百度一下")

[百度2][2]

[2]:http://www.baidu.com/ "百度一下"

<https://markdown.com.cn>

```
## 7 插入图片

![图片1](https://alliance-communityfile-drcn.dbankcdn.com/FileServer/getFile/cmtyPub/011/111/111/0000000000011111111.20231227152826.68978747729929417932749507993929:50001231000000:2800:B44BA8980A3587F0957937999D38C66140AD85390E5F17FC2CB1A661D3E1875C.png?needInitFileName=true?needInitFileName=true?needInitFileName=true?needInitFileName=true?needInitFileName=true)

![图片2][2]
[2]:./img  "描述"

```markdown
![图片1](https://alliance-communityfile-drcn.dbankcdn.com/FileServer/getFile/cmtyPub/011/111/111/0000000000011111111.20231227152826.68978747729929417932749507993929:50001231000000:2800:B44BA8980A3587F0957937999D38C66140AD85390E5F17FC2CB1A661D3E1875C.png?needInitFileName=true?needInitFileName=true?needInitFileName=true?needInitFileName=true?needInitFileName=true)

![图片2][2]
[2]:./img  "描述"

```

## 8 列表
```markdown
* Green （比较推荐）
- Red  （比较好用）
+   Blue

1. First paragraph
2. Second paragraph
3. Third paragraph
```

## 9 任务列表
* [ ] a task list item
  * [x] completed
  * [ ] incomplete
- [ ] list syntax required
- [x] completed

```markdown
* [ ] a task list item
  * [x] completed
  * [ ] incomplete
* [ ] list syntax required
* [x] completed
```

## 10 表格
| 左对齐 | 居中对齐 | 右对齐 |
| :------ | :-------: | ------: |
小明|男|75
小红|女|79
小陆|男|92
```markdown
学号|姓名|分数
-|:-:|-:
小明|男|75
小红|女|79
小陆|男|92
```

## 11 分割线
---
***
___
```markdown
---
***
___
```

## 12 折叠
<details> <summary>Title</summary>
  <pre><code>
    contents ...
  </code></pre>
</details>

```markdown
<details> <summary>Title</summary>
  <pre><code>
    contents ...
  </code></pre>
</details>
```
## 13 容器

::: info
这是一条info，自定义格式：info+空格+自定义文字
:::

::: tip 提示
这是一个提示，自定义格式：tip+空格+自定义文字
:::

::: warning 警告
这是一条警告，自定义格式：warning+空格+自定义文字
:::

::: danger 危险
这是一个危险警告，自定义格式：danger+空格+自定义文字
:::

::: details 点我查看
这是一条详情，自定义格式：details+空格+自定义文字
:::


```markdown
  ::: info
  这是一条info，自定义格式：info+空格+自定义文字
  :::

  ::: tip 提示
  这是一个提示，自定义格式：tip+空格+自定义文字
  :::

  ::: warning 警告
  这是一条警告，自定义格式：warning+空格+自定义文字
  :::

  ::: danger 危险
  这是一个危险警告，自定义格式：danger+空格+自定义文字
  :::

  ::: details 点我查看
  这是一条详情，自定义格式：details+空格+自定义文字
  :::

```

## 14 代码组

::: code-group

```sh [pnpm]
#查询pnpm版本
pnpm -v
```

```sh [yarn]
#查询yarn版本
yarn -v
```

:::

````markdown
  ::: code-group

  ```sh [pnpm]
  #查询pnpm版本
  pnpm -v
  ```

  ```sh [yarn]
  #查询yarn版本
  yarn -v
  ```

  :::

````