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

```markdown
[TOC]

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

## 5 语法高亮
` hello world`

```markdown
` hello world`
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

- [ ] a task list item
  - [x] completed
  - [ ] incomplete
- [ ] list syntax required
- [x] completed

```markdown
- [ ] a task list item
  - [x] completed
  - [ ] incomplete
- [ ] list syntax required
- [x] completed
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

<a id="test2"></a>