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

## 14、display:none;  visibility: hidden:区别
  - visibility:hidden将元素隐藏，但是在网页中该占的位置还是占着。
  - display:none将元素的显示设为无，即在网页中不占任何的位置。

## JS的类型检测?
  <details> <summary>展开</summary>

  ```markdown
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
  ```
  </details>
   
## 6 数组(Array)常用的一些API？
  <details> <summary>展开</summary>

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
  </details>

## 7字符串(String)常用的API?
  <details> <summary>展开</summary>

  ```markdown
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
  ```
  </details>
  


##  object常用api

  <details> <summary>展开</summary>

  | Object.keys() | 获取对象可枚举属性名数组	 | Object.keys({a:1}) → ['a']|
  | :------ | :------- | :------ |
  | Object.values() | 获取对象可枚举属性值数组	 | Object.values({a:1}) → [1]
  | Object.entries() | 获取键值对数组	 | Object.entries({a:1}) → [['a',1]]
  | Object.create() | 以指定原型创建对象	 | const child = Object.create(parent)
  | Object.is() | 增强型比较（解决NaN和±0问题）	 | Object.is(NaN, NaN) → true
  | hasOwnProperty()/ hasOwn() | 是否包含某个属性(仅自身, 和in区别)	 | --
  |Object.assign() | 浅拷贝合并对象	 | Object.assign({}, {a:1})
  |structuredClone() | 深拷贝	 | structuredClone(obj)
  </details>

## 8 ES6新特性？
  <details> <summary>展开</summary>

  ```markdown
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
  ```
  </details>

## 9 谈谈对Promise的理解?
  <details> <summary>展开</summary>

  ```markdown
  - Promise用来处理异步编程，将异步操作以同步操作的流程表达出来，避免了地狱回调。
  - Promise的实例有三个状态：padding、fulfilled、rejected;
  - 从进行状态变成为其他状态就不能更改状态了，其过程不可逆
  - then() 返回新的 Promise，支持链式调用
  - Promise的缺点：
    - 无法取消 Promise，一旦新建它就会立即执行，无法中途取消。
    - 如果不设置回调函数，Promise内部抛出的错误，不会反应到外部。
    - 当处于pending状态时，无法得知目前进展到哪一个阶段（刚刚开始还是即将完成）
  ```
  </details>
  
## 10 Promise静态方法
  <details> <summary>展开</summary>

  ```markdown
  - Promise.all()  全部成功才成功，一个失败则失败
  - Promise.allSettled() 等待所有完成，返回每个的结果状态
  - Promise.race() 只返回最先完成的那个结果
  - Promise.any() 返回第一个成功的，全失败才失败
  - Promise.resolve() 返回一个成功的 Promise
  - Promise.reject() 返回一个失败的 Promise
  ```
  </details>

## 21 对Async/await的理解?
  <details> <summary>展开</summary>

  ```markdown
  async/await其实是Generator 的语法糖，
  会暂停函数执行，等待 Promise 完成。
  返回 Promise 的 resolved 值
  try/catch 捕获异常
  ```
  </details>
  

## 22 闭包？
 <details> <summary>展开</summary>

  ```markdown
  - 函数嵌套（内层函数使用了外层函数的变量）
  - 内层函数被返回或以其他方式保留引用
  - 内存泄漏，量无法被垃圾回收，过度使用会导致内存占用
  - 包内部变量不容易追踪，调试困难
  ```
  </details>
  

## 内存泄漏
  <details> <summary>展开</summary>

  ```markdown
  内存未释放导致持续累积
  - 意外的全局变量，解决方法：严格模式进行检测
  - 未清理的定定时器，及时清除
  - 闭包滥用
  - 未解绑的事件监听
  - dom元素的引用没有被释放
  ```
  </details>
  
## 内存溢出
  <details> <summary>展开</summary>

  ```markdown
  瞬时内存需求超过上限
  - 超大数据结构 `new Array(Number.MAX_SAFE_INTEGER); // 抛出RangeError`
  - 未清理的定时器与回调
  - DOM引用未释放
  - 闭包滥用
  - 未解绑的事件监听
  ```
  </details>
  
## 23 原型、原型链？
  <details> <summary>展开</summary>

  ```markdown
  - 原型：
    - 每个 class都有显示原型 prototype
    - 每个实例都有隐式原型 _ proto_
    - 实例的_ proto_指向对应 class 的 prototype
  - 原型链: 当我们访问一个对象的属性时，如果这个对象内部不存在这个属性，那么它就会去它的原型对象里找这个属性，这个原型对象又会有自己的原型，于是就这样一直找下去，也就是原型链的概念
  ```
  </details>
  

## 24 JS回收机制？
  js回收机制，简单来说分为两种，一种是引用法、一种是标记法。引用法就是判断一个对象的引用数，如果引用数为0就回收掉，大于0就不会收；

## 25 事件循环(Event loop)?
  <details> <summary>展开</summary>

  ```markdown
  由于js是单线程的，所以在运行代码的时候，耗时的一些内容会存到任务队列里面；
  在运行的时候，简单的变量定义赋值会很快的执行下去，其中一些如定时器、promise之类的内容，比较耗时会存到任务队列等待；
  当所有简单的内容执行完成时，就会执行微任务，微任务执行完成之后，会去执行宏任务，然后宏任务有趣执行微任务。直到所以东西被执行完成后；任务结束，这个过程就叫做事件轮询；其中任务队列又分为宏任务和微任务；宏任务如定时器之类；微任务如promise之类的；
  ```
  </details>
  
## 26 宏任务与微任务？
  - 宏任务：ajax，定时器，文件操作，dom事件, requestAnimationFrame
  - 微任务：Promise.then，process.nextTick，MutationObserver, queueMicrotask


## 38 call / bind/ apply 的区别
  - call / apply改变this指向,调用函数，apply传参是一个数组
  - bind改变this指向，没有调用函数，返回一个新的函数
  - 基于call实现继承
  - 基于apply求数组最大值:  console.log(Math.max.apply(null,arr))
## 39 Object.create（obj）的作用：
  该函数返回了一个新的空对象，但是该空对象的__proto__是指向了obj这个参数
## 40 继承方式
  <details> <summary>展开</summary>

  ```markdown
  - 原型链继承， 子类原型==父类实例，可以重写父类属性和方法
  - 构造函数继承 
  - 实例继承
  - 拷贝继承
  - 组合继承
  - 寄生组合继承
  - 类继承

  寄生组合继承
  ```
  ```js 
  function Parent(name) {
    this.name = name;
    this.colors = ['red', 'green', 'blue'];
  }
  Parent.prototype.sayName = function() {
    console.log(this.name);
  };
  function Child(name, age) {
    // 执行父类构造函数
    Parent.call(this, name);
    this.age = age;
  }
  // 将子类的原型  指向父类
  Child.prototype = Object.create(Parent.prototype);
  // 此时的狗早函数为父类的 需要指回自己
  Child.prototype.constructor = Child;

  Child.prototype.sayAge = function() {
    console.log(this.age);
  };
  var child1 = new Child('Tom', 18);
  child1.sayName(); // 'Tom'
  child1.sayAge(); // 18
  ```
  </details>
  


## 42 设计模式有哪些?
  - 单例模式：保证类只有一个实例，并提供一个访问它的全局访问点。
  - 工厂模式：用来创建对象，根据不同的参数返回不同的对象实例。
  - 策略模式：定义一系列的算法，把它们一个个封装起来，并且使它们可以相互替换。
  - 装饰器模式：在不改变对象原型的基础上，对其进行包装扩展。
  - 观察者模式：定义了对象间一种一对多关系，当目标对象状态发生改变时，所有依赖它对对象都会得到通知。
  - 发布订阅模式： 基于一个主题/事件通道，希望接收通知的对象通过自定义事件订阅主题，被激活事件的对象（通过发布主题事件的方式被通知）。

## 45 new操作符干了那些事?
  - 创建一空对象
  - 给对象设置__proto__, 值为构造函数对象的prototype属性值
  - 通过对象执行构造函数体(给对象添加属性/方法)
  - 返回函数值或者创建的对象
  
## 51 作用域和作用域链
  - 全局作用域、函数作用域、块级作用域
  - 作用域链就是从当前作用域开始一层一层向上寻找某个变量，直到找到全局作用域还是没找到，就宣布放弃。这种一层一层的关系，就是作用域链

# 53 dom相关

  <details> <summary>展开</summary>

  ```markdown
  - 获取dom元素：
    - document.getElementById（'btn'）只能通过id，只能获取一个元素
    - document.getElementsByTagName（'button'）只能通过标签名，返回一个伪数组
    - document.getElementsByClassName（'btn'）只能通过类名，返回一个伪数组
    - document.querySelect()
    - document.querySelectAll()      返回一个伪数组
    - document.documentElement
    - document.body
  - 创建dom元素：
    - document.write()
    - div.appendChild(document.createElement('span'))
    - div.innerHTML = '<span></span>'
    - node.cloneNode(true) true深克隆，false浅克隆
  - 添加dom
    - parentNode.insertBefore(newNode, referenceNode) 在referenceNode前插入节点
    - parentNode.replaceChild(newChild, oldChild) 替换节点
    - parentNode.removeChild(dom)删除节点
    - parentNode.appendChild(dom)追加节点

  - 设置css
    - element.style 内联样式
      - box.style.color = 'red';
      - box.style.setProperty('color', 'blue');
      - box.style.color = ''; 移除单个样式
    - cssText批量设置
      - box.style.cssText = 'color: red;'; 批量设置样式(会覆盖所有内联样式)
      - box.style.cssText = ';color: red;'; 追加方式（保留原有样式）
    - 设置类
      - box.className = 'new-class'; // 设置类名（覆盖）
      - box.className += ' active'; // 追加类名
      - box.className = box.className.replace('old', 'new'); // 替换类名
    - classList（现代推荐，IE10+）
      - box.classList.add('highlight', 'border');  // 添加多个
      - box.classList.remove('highlight', 'border'); // 移除多个
      - box.classList.toggle('visible');  // 切换类（有则删，无则加）
      - box.classList.contains('active'); // 检查是否存在
      - box.classList.replace('old-class', 'new-class'); // 替换类（新API）
      - console.log(box.classList.length); // 获取类名数量
      - console.log(box.classList[0]); // 通过索引获取类名
  - clientX，pageX，offsetX 获取坐标的属性
    - clientX /clientY 鼠标相对浏览器窗口的水平距离和垂直距离，视口左上角为原点
    - pageX/pageY 鼠标相对document页面的水平距离和垂直距离，页面左上角为原点（包括滚动距离）
    - offsetX/offsetY 鼠标相对自身元素的水平距离和垂直距离，自身元素左上角为原点
  - offset，client，scroll
    - offsetWidth/ offsetHeight:：盒子内容+padding+border的大小
    - clientWidth/ clientHeight盒子内容+padding的大小
    - scrollWidt/ scrollHeight当内容比盒子小时，拿的是盒子clientwidth，当内容比盒子大时，拿的是内容offsetwidth+盒子一侧内边距
    - offsetLeft/offsetTop 元素的偏移量，定位的left/top值
    - clientLeft/clientTop盒子左边框/上边框的大小
    - scrollLeft/scrollTop盒子向左/上滚动的距离，可写的
  - document.documentElement.clientWidth视口宽高
  - document.documentElement.clientHeight
  - onmouseover/onmouseout与onmouseenter/onmouseleave区别
    都是鼠标移入移出触发事件
    - onmouseover/onmouseout：鼠标移入父元素里面子元素时事件会移出然后再移入，事件委派时使用这个

    - onmouseenter/onmouseleave：对父元素添加移入移出，当鼠标移入子元素时，不触发移入移出事件.
  ```
  </details>

  