## 速览

## 页面导入样式时，link和@import区别？
  <details> <summary>展开</summary>

  ```markdown
  - 类型：link是HTML标签，@import是css语法
  - 加载时机：当页面被加载时，link会同时加载（并行加载）；而@import会等到页面加载完之后才会加载（串行加载），会闪屏
  - 兼容性：Link无兼容性问题，而@import时h5以上才能识别；
  - 优先级：Link的权重高于@import;
  - DOM 控制：js操作dom修改样式时只能修改ilnk中的
  ```
  </details>

  ## script标签中defer和async的区别?
  <details> <summary>展开</summary>

  ```markdown
  - 无属性时，同步加载 + 阻塞解析
  - defer：异步加载 + 不阻塞解析, 文档解析完成后才执行, 按先后顺序加载.
  - async：异步加载 + 不阻塞解析, 下载后会立即执行, 不保证先后加载顺序
  ```
  </details>
 
  ## 6. 水平垂直居中的方法有哪些？

  <details> <summary>展开</summary>

  ::: code-group
  
  ```css [Flexbox 布局]
  .parent {
      display: flex;
      justify-content: center;
      align-items: center;
  }
  ```
  ```css [Grid 布局]
  .parent {
    display: grid;
    place-items: center;
  }
  ```
  ```css [绝对定位 + transform（宽高未知）]
  .parent {
      position: relative;
  }
  .child {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
  }
  ```
  ```css [表格布局]
  .parent {
      display: table-cell;
      text-align: center;
      vertical-align: middle;
  }
  .child {
      display: inline-block;
  }
  ```
  :::
  </details>
  - position（定位）有两种
  - display：flex弹性盒
  - display：table-cell
  - overflow：hidden和margin配合
  ## 7	两栏布局、三栏布局、水平垂直居中*****
  - float浮动
  - grid栅格
  - flex弹性盒 

## 14、display:none;  visibility: hidden:区别
  - visibility:hidden将元素隐藏，但是在网页中该占的位置还是占着。
  - display:none将元素的显示设为无，即在网页中不占任何的位置。

## JS的类型检测?
  - typeof，对象类型不详细，无法检测array；不能检测null；返回的是字符串
  - instanceof 检测当前实例是否属于这个类；只要当前类出现在实例的原型链上，结果是true；原型指向可以修改，结果不准确；不能检测基本数据类型
  - constructor 支持检测基本数据类型；原型指向可以修改，结果不准确
  - Object.prototype.toString.call()  标准的检测方法
  - Array.isArray() 判断是否是数组
  - Number.isNaN(NaN); 是否是NAN
  - Number.isSafeInteger(42); 是否是安全整数
  
  一些其他：
  - object.hasOwnProperty(proName) 函数方法是返回一个布尔值，判断是否是该对象的私有属性。
  - Array.prototype.slice.call(fakeArray) 将数组转化为真正的Array对象。
  - Array.from(arr)  伪数组转真数组 

## 6 数组(Array)常用的一些API？
| push() | 末尾添加元素 | 改变原数组 | 返回数组的长度|
| :------ | :------- | :------ |:----|
pop() | 删除末尾元素 | 改变原数组 | 返删除数据
unshift() | 开头添加元素 | 改变原数组 | 返回数组的长度
shift() | 删除开头元素 | 改变原数组 | 返删除数据
splice() | 删除/替换元素 | 改变原数组 | 返回被删除元素组成的数组
reverse() | 反转数组 | 改变原数组 | 返回反转的数组
sort() | 排序 | 改变 | `arr.sort((a,b) => a - b)`
slice() | 截取子数组 | 不改变 | 新数组
join() | 数组转字符串 | 不改变 | 字符串
forEach() | 简单遍历 | 不改变 | undefined
map() | 映射新数组 | 不改变 | 新数组
filter() | 过滤元素 | 不改变 | 新数组
find() | 查找首个符合条件的元素 | 不改变 | 元素/undefined
findIndex() | 查找首个符合元素索引 | 不改变 | 索引/-1
every() | 全部为真返回真 | 不改变 | boolean
some() | 一个为真返回真 | 不改变 | boolean
reduce() |累加 | 不改变 | `const sum = [1,2,3].reduce((acc, cur) => acc + cur, 0); // 6`
includes() |是否包含 | 不改变 | boolean
flat() |数组扁平化 | 不改变 | 新数组
flatMap() |映射后扁平化 | 不改变 | 新数组
at() |支持负索引访问 | 不改变 | 索引指向的元素
findLast() |倒序查找元素 | 不改变 | 元素/undefined
Array.from() |类数组转数组 | -- | 新数组
Array.of() |参数转数组 | -- | 新数组
Array.isArray() |类型检测 | -- | boolean

## 7 字符串(String)常用的API?
  - indexOf/lastIndexOf: 从左/右开始查询指定元素，有返回下标，否则返回-1;
  - includes()：返回布尔值，表示是否找到了参数字符串。
  - startsWith()：返回布尔值，表示参数字符串是否在原字符串的头部。
  - endsWith()：返回布尔值，表示参数字符串是否在原字符串的尾部。
  - charAt：获取指定位置字符
  - at()方法接受一个整数作为参数，返回参数指定位置的字符，支持负索引
  - replace: 根据正则表达式替换指定内容，并返回的的字符串;
  - match：按照正则规则获取指定字符串
  - subStr/ substring/ slice: 字符串截取
  - concat:字符串拼接
  - repeat:重复字符串
  - split：字符串转数组
  - trim: 去除两边空白;
  - toLowerCase/toUpperCase：转小写/转大写
  - toString: 转为字符串;
##  object常用api

| Object.keys() | 获取对象可枚举属性名数组	 | Object.keys({a:1}) → ['a']|
| :------ | :------- | :------ |
| Object.values() | 获取对象可枚举属性值数组	 | Object.values({a:1}) → [1]
| Object.entries() | 获取键值对数组	 | Object.entries({a:1}) → [['a',1]]
| Object.create() | 以指定原型创建对象	 | const child = Object.create(parent)
| Object.is() | 增强型比较（解决NaN和±0问题）	 | Object.is(NaN, NaN) → true
| hasOwnProperty()/ hasOwn() | 是否包含某个属性(仅自身, 和in区别)	 | --
|Object.assign() | 浅拷贝合并对象	 | Object.assign({}, {a:1})
|structuredClone() | 深拷贝	 | structuredClone(obj)
## 8 ES6新特性？
  - 新的变量定义方式：let/cost/import/class
  - 结构赋值：数组/对象/字符串/数值和布尔/函数参数， 
  - 字符串扩展：可使用for...of循环遍历，模板字符串
  - 字符串新增方法：includes/startsWith/endsWith/ repeat/at
  - 数值拓展：Number.isFinite(), Number.isNaN()/Math.trunc()去除小数部分
  - 函数拓展：参数默认值（函数的 length 属性失真），rest参数
  - 箭头函数：没有this，不能当构造函数，不能使用arguments，
  - 数组拓展：Array.from() Array.of() find() fill() includes() flat()，flatMap() at()
  - 对象拓展：Object.assign()，super 关键字，Object.is() Object.values和Object.entries
  - 对象遍历：for...in、Object.keys(obj)、Object.getOwnPropertyNames(obj)，Object.getOwnPropertySymbols
  - 指数运算符 **
  - set：它类似于数组，但是成员的值都是唯一的，没有重复的值
  - WeakSet 结构与 Set 类似，也是不重复的值的集合。但是，它与 Set 有两个区别。
  首先，WeakSet 的成员只能是对象，而不能是其他类型的值。
  - 模板字符串、拓展运算符、Promise、函数形参默认值、asysn/await、syboml、- map、set、箭头函数；

## 9 谈谈对Promise的理解?
  - Promise用来处理异步编程，将异步操作以同步操作的流程表达出来，避免了地狱回调。

  - Promise的实例有三个状态：padding、fulfilled、rejected;
  - 从进行状态变成为其他状态就不能更改状态了，其过程不可逆
  - then() 返回新的 Promise，支持链式调用
  - Promise的缺点：
    - 无法取消 Promise，一旦新建它就会立即执行，无法中途取消。
    - 如果不设置回调函数，Promise内部抛出的错误，不会反应到外部。
    - 当处于pending状态时，无法得知目前进展到哪一个阶段（刚刚开始还是即将完成）

## 10 Promise静态方法
  - Promise.all()  全部成功才成功，一个失败则失败
  - Promise.allSettled() 等待所有完成，返回每个的结果状态
  - Promise.race() 只返回最先完成的那个结果
  - Promise.any() 返回第一个成功的，全失败才失败
  - Promise.resolve() 返回一个成功的 Promise
  - Promise.reject() 返回一个失败的 Promise

## 21 对Async/await的理解?
  async/await其实是Generator 的语法糖，
  会暂停函数执行，等待 Promise 完成。
  返回 Promise 的 resolved 值
  try/catch 捕获异常

## 22 闭包？
  - 函数嵌套（内层函数使用了外层函数的变量）
  - 内层函数被返回或以其他方式保留引用
  - 内存泄漏，量无法被垃圾回收，过度使用会导致内存占用
  - 包内部变量不容易追踪，调试困难

## 内存泄漏
  内存未释放导致持续累积
  - 意外的全局变量
  - 未清理的定时器与回调
  - DOM引用未释放
  - 闭包滥用
  - 未解绑的事件监听
## 内存溢出
  瞬时内存需求超过上限
  - 超大数据结构 `new Array(Number.MAX_SAFE_INTEGER); // 抛出RangeError`
  - 未清理的定时器与回调
  - DOM引用未释放
  - 闭包滥用
  - 未解绑的事件监听

## 23 原型、原型链？
  - 原型：
    - 每个 class都有显示原型 prototype
    - 每个实例都有隐式原型 _ proto_
    - 实例的_ proto_指向对应 class 的 prototype
  - 原型链: 当我们访问一个对象的属性时，如果这个对象内部不存在这个属性，那么它就会去它的原型对象里找这个属性，这个原型对象又会有自己的原型，于是就这样一直找下去，也就是原型链的概念

## 24 JS回收机制？
  js回收机制，简单来说分为两种，一种是引用法、一种是标记法。引用法就是判断一个对象的引用数，如果引用数为0就回收掉，大于0就不会收；

## 25 事件循环(Event loop)?
  由于js是单线程的，所以在运行代码的时候，耗时的一些内容会存到任务队列里面；
  在运行的时候，简单的变量定义赋值会很快的执行下去，其中一些如定时器、promise之类的内容，比较耗时会存到任务队列等待；
  当所有简单的内容执行完成时，就会执行微任务，微任务执行完成之后，会去执行宏任务，然后宏任务有趣执行微任务。直到所以东西被执行完成后；任务结束，这个过程就叫做事件轮询；其中任务队列又分为宏任务和微任务；宏任务如定时器之类；微任务如promise之类的；


## 26 宏任务与微任务？
  - 宏任务：ajax，定时器，文件操作，dom事件, requestAnimationFrame
  - 微任务：Promise.then，process.nextTick，MutationObserver, queueMicrotask
