## 1 var、let、const区别？*******
  - var存在变量提升；可以重复定义相同的变量；无作用域，定义的变量是顶层对象（window）属性
  - let、const:无法进行变量提升，无法重复定义会报错；拥有块级作用域，暂时性死区
  - const定义后无法修改，否则会报错(引用类型可以更改里面的数据)

## 2 js有那些数据类型？
  - 基本数据类型：Number,String, Null, Undefind, syboml，Boolean。BigInt
  - 引用类型：Object;
  - 基本: 操作值
  - 引用: 操作堆内存空间地址

## 3 null和undefined区别?
  - undefined 代表的含义是未定义，一般变量声明了但还没有定义的时候会返回 undefined，typeof为undefined
  - null 代表的含义是空对象，null主要用于赋值给一些可能会返回对象的变量，作为初始化，typeof为object

## 4 JS的类型检测?
  - typeof，对象类型不详细，无法检测array；不能检测null；返回的是字符串
  - instanceof 检测当前实例是否属于这个类；只要当前类出现在实例的原型链上，结果是true；原型指向可以修改，结果不准确；不能检测基本数据类型
  - constructor 可以检测基本数据类型；原型指向可以修改，结果不准确
  - Object.prototype.toString.call()  标准的检测方法
  - Array.isArray() 判断是否是数组
  
  一些其他：
  - object.hasOwnProperty(proName) 函数方法是返回一个布尔值，判断是否是该对象的私有属性。
  - Array.prototype.slice.call(fakeArray) 将数组转化为真正的Array对象。
  - Array.from(arr)  伪数组转真数组 

## 5 为什么0.1+0.2 ! == 0.3，如何让其相等
  因为浮点数运算的精度问题。在计算机运行过程中，需要将数据转化成二进制，然后再进行计算。 因为浮点数自身小数位数的限制而截断的二进制在转化为十进制，就变成0.30000000000000004，所以在计算时会产生误差

  解决方案: 将其先转换成整数，再相加之后转回小数。具体做法为先乘10相加后除以10

## 6 数组(Array)常用的一些API？
  - Push：向数组尾部添加一个元素，并返回数组的长度；
  - Pop: 删除最后一个元素，并返回删除的元素
  - Unshift: 向数组头部添加一个元素，并返回数组长度;
  - Shift: 删除并返回删除的元素
  - splice: 替换(添加或者删除)，返回被删除元素组成的数组，会改变
  - reverse：反转数组，会改变
  - sort ：排序，默认按照unicode从小到大排，会改变
  - concat: 合并并返回新的数组，不改变
  - slice:提取数组，返回新数组，不改变原数组
  - join：数组转字符串，不改变
  - indexOf: 查询指定元素，有返回下标，否则返回-1;
  - includes: 查询指定元素，并Boolean值;
  - every/some：全为真返回真/有一个真返回真
  - find/findIndex：找到第一个满足条件的元素/索引值
  - forEach: 遍历元素;
  - filter: 根据条件来返回符合规范的元素，不改变原数组;
  - map: 返回处理后的数组元素，不改变原数组;
  - reduce：累加，第一个参数是上一次的返回值

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
  - Promise的实例有两个过程：
    - pending -> fulfilled : Resolved（已完成）

    - pending -> rejected：Rejected（已拒绝）
    - 一旦从进行状态变成为其他状态就永远不能更改状态了，其过程是不可逆的。
  - Promise构造函数接收一个带有resolve和reject参数的回调函数。
    - resolve的作用是将Promise状态从pending变为fulfilled，在异步操作成功时调用，并将异步结果返回，作为参数传递出去
    - reject的作用是将Promise状态从pending变为rejected，在异步操作失败后，将异步操作错误的结果，作为参数传递出去
  - Promise的缺点：

    - 无法取消 Promise，一旦新建它就会立即执行，无法中途取消。
    - 如果不设置回调函数，Promise内部抛出的错误，不会反应到外部。
    - 当处于pending状态时，无法得知目前进展到哪一个阶段（刚刚开始还是即将完成）

## 10 Promise方法
  - promise.then()  对应resolve成功的处理
  - promise.catch()对应reject失败的处理
  - promise.all()可以完成并行任务，将多个Promise实例数组，包装成一个新的Promise实例，返回的实例就是普通的Promise。有一个失败，代表该Primise失败。当所有的子Promise完成，返回值时全部值的数组
  - promise.race()类似promise.all()，区别在于有任意一个完成就算完成
  - promise.allSettled() 返回一个在所有给定的 promise 都已经 fulfilled 或 rejected 后的 promise ，并带有一个对象数组，每个对象表示对应的promise 结果。
  - 
  一般常用用then,catch,finally，all,race，any这些方法；
  通过then去获取返回的promise里面的内容；catch去捕获reject的一些问题；finally不管状态如何都会执行；all和race可以放入多个promise，都是返回一个数组，区别是race只会返回最快的那个请求，而all是全部返回，但是all如果里面有问题的话，会直接抛异常出来告诉你；


 ## 20 promise.all 和 promise.allsettled 区别

  - all: 只有当所有Promise实例都resolve后，才会resolve返回一个由所有Promise返回值组成的数组。如果有一个Promise实例reject，就会立即被拒绝，并返回拒绝原因。all是团队的成功才算，如果有一个人失败就算失败。
  - allSettled： 等所有Promise执行完毕后，不管成功或失败， 都会吧每个Promise状态信息放到一个数组里面返回。

## 21 对Async/await的理解?
  async/await其实是Generator 的语法糖，它能实现的效果都能用then链来实现，它是为优化then链而开发出来的。通过async关键字声明一个异步函数， await 用于等待一个异步方法执行完成，并且会阻塞执行。
  async 函数返回的是一个 Promise 对象，如果在函数中 return 一个变量，async 会把这个直接量通过 Promise.resolve() 封装成 Promise 对象。如果没有返回值，返回 Promise.resolve(undefined)


## 22 闭包？
  - 一个函数调用时使用了其外层函数的变量，此时形成一个闭包
  - 适当使用闭包可以延长变量的生命周期，节省资源，而且还能让变量无法污染；但是滥用的话，那么js无法回收那些不需要使用的变量，从而会引起内存泄露；

## 23 原型、原型链？
  - 原型：
    - 每个 class都有显示原型 prototype
    - 每个实例都有隐式原型 _ proto_
    - 实例的_ proto_指向对应 class 的 prototype
  - 原型链: 当我们访问一个对象的属性时，如果这个对象内部不存在这个属性，那么它就会去它的原型对象里找这个属性，这个原型对象又会有自己的原型，于是就这样一直找下去，也就是原型链的概念

## 24 JS回收机制？
  js回收机制，简单来说分为两种，一种是引用法、一种是标记法。引用法就是判断一个对象的引用数，如果引用数为0就回收掉，大于0旧不会收；

  但引用法在某种情况下会造成内存泄露的问题；比如说创建两个对象，1对	象.a=2对象；2对象.a=1对象；那么这种相互引用他们得引用数都不小于0；	js旧无法去回收他们；另一种是标记法：标记法就是判断对象是否可达，如	果是得话，那么就不回收。反之回收；那么什么是可达呢？这就要来聊聊可	达性这个问题了。可达性他其实就是从根对象得指针开始，向下搜索子节点。	如果子节点被搜索到了，那么就说明这个子节点得引用对象可达，并标记他；	然后继续进行一个递归搜索得操作，直至遍历完成；这时候所有没有被标记	的节点，会被当成没有被任何地方引用，就会被认为是可以回收释放掉的对	象，可以被垃圾回收器回收。
  首先聊聊Js内存管理：js内存的流程分为3步：
  分配给使用者所需的内存；
  使用者拿到内存后并且使用；
  使用者不需要这些内存后，释放并归还给系统；(使用者就是变量或者实例)
  Js数据类型分为两种：基本数据类型和引用数据类型；
  一般基本数据类型拥有固定的大小，值保存在栈内存里，可以通过值直接访问，由于栈内存是大小固定，所以一般都是操作系统自动分配和释放；而引用数据类型大小是不固定的，栈内存保存指针，指向堆内存中的对象空间，通过引用来访问，由于大小不固定系统无法自动释放需要js引擎手动释放；
  那么为什么要垃圾回收，在chrome中，v8被限制了内存的使用，像刚刚说的栈内存是由操作系统自动分配和释放的，但是堆内存的话需要由js引擎手动释放，当代码写的不规范的时候，会使js引擎无法正确的堆内存释放，从而使浏览器内存不断的增加，进而导致js和应用以及操作系统的性能不断下降；
  垃圾回收算法：太多记不住

## 25 事件循环(Event loop)?
  由于js是单线程的，所以在运行代码的时候，耗时的一些内容会存到任务队列里面；在运行的时候，简单的变量定义赋值会很快的执行下去，其中一些如定时器、promise之类的内容，比较耗时会存到任务队列等待；当所有简单的内容执行完成时，就会执行微任务，微任务执行完成之后，会去执行宏任务，然后宏任务有趣执行微任务。直到所以东西被执行完成后；任务结束，这个过程就叫做事件轮询；其中任务队列又分为宏任务和微任务；宏任务如定时器之类；微任务如promise之类的；


## 26 宏任务与微任务？
  - 宏任务：ajax，定时器，文件操作，dom事件
  - 微任务：Promise.then，process.nextTick，MutationObserver

## 27普通函数和箭头函数？
  主要解决This的指向问题(继承上级，本身没有this)，普通函数指向全局也就是window,但是箭头函数指向他的上级； 



## 28 Map、Set区别？
  - Set
    - 创建：  new Set([1, 1, 2, 3, 3, 4, 2])
    - add(value)：添加某个值，返回Set结构本身。
    - delete(value)：删除某个值，返回一个布尔值，表示删除是否成功。
    - has(value)：返回一个布尔值，表示该值是否为Set的成员。
    - clear()：清除所有成员，没有返回值。
  - Map
    - set(key, val): 向Map中添加新元素
    - get(key): 通过键值查找特定的数值并返回
    - has(key): 判断Map对象中是否有Key所对应的值，有返回true,否则返回false
    - delete(key): 通过键值从Map中移除对应的数据
    - clear(): 将这个Map中的所有元素删除
  - 区别
    - Map是一种键值对的集合，和对象不同的是，键可以是任意值
    - Map可以遍历，可以和各种数据格式转换
    - Set是类似数组的一种的数据结构，类似数组的一种集合，但在Set中没有重复的值, set去重：newArr = […new set(arr)]

## 29 map和Object的区别?
  map和Object都是用键值对来存储数据，区别如下：
  - 键的类型：Map 的键可以是任意数据类型（包括对象、函数、NaN 等），而 Object 的键只能是字符串或者 Symbol 类型。
  - 键值对的顺序：Map中的键值对是按照插入的顺序存储的，而对象中的键值对则没有顺序。
  - 键值对的遍例：Map 的键值对可以使用 for...of 进行遍历，而 Object 的键值对需要手动遍历键值对。
  - 继承关系：Map 没有继承关系，而 Object 是所有对象的基类。

## 30 map和weakMap的区别
  它们是 JavaScript 中的两种不同的键值对集合，主要区别如下：

  - map的键可以是任意类型，weakMap键只能是对象类型。
  - map 使用常规的引用来管理键和值之间的关系，因此即使键不再使用，map 仍然会保留该键的内存。weakMap 使用弱引用来管理键和值之间的关系，因此如果键不再有其他引用，垃圾回收机制可以自动回收键值对。

## 31 数组方法Map、filter、forEach区别?
  都不会改变原对象；但是map和filter都需要return处理好的元素；forEcho不会；他们都不会被return打断；如果像打断，使用trycatch包括起来抛异常


## 32 三种弹窗的单词以及三种弹窗的功能
  - console.log()控制台输出
  - console.dir()输出一个对象详细键值对信息
  - console.table() 把一个多维数组按照表格方式输出
  - alert（ ）  弹框
  - confirm （ ）询问框
  - prompt （ ）输入框
  - document.write（ ）页面写入
## 33 例举3种强制类型转换和2种隐式类型转换?
  - 强制（parseInt(),parseFloat(),Number()）
  - 隐式（== ,!!）
## 34 基础数据类型与变量对象
  函数运行时，会创建一个执行环境，这个执行环境叫作执行上下文（ Execution Context ） 在执行上下文中，会创建一个叫作变量对象（ VO ）的特殊对象 基础数据类型往往都保存在变量对象中
  变量对象也存在于堆内存中 ，但是由于变量对象有特殊职能，因此在理解时， 建议仍然将其与堆内存空间区分开来


## 35 引用数据类型与堆内存空间
  引用数据类型（ Object ）的值是保存在堆内存空间中的对象 JavaScript 中，不允许直接访问堆内存空间中的数据，因此不能直接操作对象的堆内存空间 。在操作对象时，实际上是在操作对象的引用而不是实际的对象 ，因此，引用数据类型都是按引用访问的，这里的引用，可以理解为保存在变量对象中的一个地址，该地址与堆内存中的对象相关联

## 36 垃圾回收机制
  JavaScript 的垃圾回收实现主要依靠“引用”的概念 当一块内存空间中的数据能够被访问 时，垃圾回收器就认为“该数据能够被获得”。 不能够被获得的数据，就会被打上标记，并回收内存空间，这种方式叫作标记清除算法。
  这个算法会设置一个全局对象，并定期地从全局对象开始查找，垃圾回收器会找到所有可获得与不能够被获得的数据，因此当我们将变量设置为 null 时，那么刚开始分配的值 ，就无法被访问到了，而是很快会被自动回收
  在局部作用域中，当函数执行完毕后，局部变量也就没有存在的必要了，因此垃圾收集器很容易做出判断并回收 但是在全局中，变量什么时候需妥自动释放内存空间则很难判断， 因此我们在开发时，应尽量避免使用全局变量 如果使用了全局变量，则建议不再使用它时，通 a= null 这样的方式释放引用，以确保能够及时回收内存空间
  闭包会阻止垃圾回收机制回收
  ```js
  function f1 () { 
    var n = 999; 
    Add = function() { n += 1; } 
    return function f2 () { 
      console.log(n);
    }
  }
  var result = f1 ();
  result(); // ①
  Add(); 
  result(); // ②

  //①	999  ②10000

  ```


## 37 事件循环机制
  每一个 JavaScript 程序都拥有唯一的事件循环，大多数代码的执行顺序是可以根据函数调用栈的规则执行的，而 setTimeout/setlnterval 或者不同的事件绑定（ click mousedown 等）中的代码，则通过队列来执行。
  set Timeout 为任务源，或者任务分发器，由它们将不同的任务分发到不同的任务队列中去 每一个任务源都有对应的任务队列
  任务队列又分为宏任务（ macro-task ）与微任务（ micro-task ）两种
  它从 macro-task 中的 script 开始第 1次循环 此时全局上下文进入函数调用栈， 直到调用栈清空（只剩下全局上下文），在这个过程中，如果遇到任务分发器就会将任务放入对应队列中去次循环时， macro-task 中其实只有 script ，因此函数调用栈清空之后，会直接执行所有的 micro-task 当所有可执行的 micro-task 执行完毕之后，就表示第一次事件循环已经结束次循环会再次从 macro-task 开始执行 此时 macro-task 中的 script 队列中已经没有任务 了，但是可能会有其他的队列任务，而 micro-task 中暂时还没有任务 此时会先选择其中一个宏任务队列，例如 setTimeout ，将该队列中的所有任务全部执行完毕，然后再执行此过程中可能产生的微任务 微任务执行完毕之后，再回过头来执行其他宏任务队列中的任务 依次类推，直到 所有宏任务队列中的任务都被执行一遍，并且清空了微任务，第二次循环就会结束
  如果在第二次循环过程中，产生了新的宏任务队列，或者之前宏任务队列中的的任务暂时没 有满足执行条件，例如延迟时间不够或者事件没有触发，那么将会继续以同样的顺序重复循环

## 38 call / bind/ apply 的区别
  - call / apply改变this指向,调用函数，apply传参是一个数组
  - bind改变this指向，没有调用函数，返回一个新的函数
  - 基于call实现继承
  - 基于apply求数组最大值:  console.log(Math.max.apply(null,arr))
## 39 Object.create（obj）的作用：
  该函数返回了一个新的空对象，但是该空对象的__proto__是指向了obj这个参数
## 40 继承方式
  - 原型链继承， 子类原型==父类实例，可以重写父类属性和方法
  - 构造函数继承 
  - 实例继承
  - 拷贝继承
  - 组合继承
  - 寄生组合继承
  - 类继承

  寄生组合继承
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

## 41 深克隆/浅克隆?
  - 浅拷贝：拷贝基本数据类型时，不受任何影响，当拷贝引用类型时，源对象也会被修改。
  - 深拷贝：深拷贝就是完完全全拷贝一份新的对象，它会在内存的堆区域重新开辟空间，修改拷贝对象就不会影响到源对象
  即深浅拷贝是针对于引用数据类型
  - 浅拷贝的现象有：
  newObj  =  Object.assign（{}，obj）或者 newobj = {…obj}
  数组拷贝，newArr = arr.slice()或者newArr = arr. concat ()
  - 深拷贝方式：
    展开运算符，
  JSON.parse(JSON.stringify(obj))，无法拷贝值为function，undefined，symbol；值为BigInt类型会报错
  jquery中 $extend（）添加true就是深拷贝
  手写递归


## 42 设计模式有哪些?
  - 单例模式：保证类只有一个实例，并提供一个访问它的全局访问点。
  - 工厂模式：用来创建对象，根据不同的参数返回不同的对象实例。
  - 策略模式：定义一系列的算法，把它们一个个封装起来，并且使它们可以相互替换。
  - 装饰器模式：在不改变对象原型的基础上，对其进行包装扩展。
  - 观察者模式：定义了对象间一种一对多关系，当目标对象状态发生改变时，所有依赖它对对象都会得到通知。
  - 发布订阅模式： 基于一个主题/事件通道，希望接收通知的对象通过自定义事件订阅主题，被激活事件的对象（通过发布主题事件的方式被通知）。

## 43 三点运算符:
  - 拓展运算符（结构赋值）
  - 展开运算符（传递参数）
  - 剩余运算符（接收实参）

## 44 dom0 和dom2的区别
  - 1书写语法上不同
  - 2运行机制上不同
    dom0就是给元素某个属性添加方法
    dom2是基于事件池机制完成的
  - 3 dom2中可以给一些特殊事件添加方法
    DomContentLoaded     dom结构加载完触发
    transitionend      transition结束后触发

## 45 new操作符干了那些事?
  - 创建一空对象
  - 给对象设置__proto__, 值为构造函数对象的prototype属性值
  - 通过对象执行构造函数体(给对象添加属性/方法)
## 46 理解闭包?
  1. 函数嵌套函数 
  2. 函数内部可以引用外部的参数和变量 
  3. 3.参数和变量不会被垃圾回收机制回收
## 47 内存泄露的几种情况
  - 意外的全局变量，解决方法：严格模式进行检测
  - 定时器，及时清除
  - 闭包
  - 事件监听
  - dom元素的引用没有被释放
## 48 移动端的兼容问题

  单击穿透是什么?
  单击蒙版，触发了蒙版下面元素的click事件
  单击按钮，如果下面有一个href属性的a标签，会跳转
  单击按钮跳转新页面，新页面对应位置元素click事件触发
  解决
  使用touch事件
  click事件增加300ms延迟
  如何实现自适应布局
  媒体查询做响应式
  栅格系统
  弹性盒
  如何解决长时间按住页面出现闪退的问题
      element {-webkit-touch-callout:none；}
  如何解决 iPhone及iPad下输入框的默认内阴影问题
      element { -webkit-appearance:none；}
  在iOS和 Android下，如何实现触摸元素时出现半透明灰色遮罩
      element {-webkit-tap-highiight-color:rgba （255， 255， 255， 0）}
  在旋转屏幕时，如何解决字体大小自动调整的问题
  html, body, form, fieldset, p, div, hl, h2， h3， h4， h5， h6 {-webkit-text-size-adjust：100%;}
  如何解决 Android手机圆角失效问题
  通过 background-clip:padding-box为失效的元素设置样式
  如何解决i0S中 input键盘事件 keyup失效问题
  ```html
  <input type='text' id='testInput">
  <script type="text/javascript">
    document.getElementById('testInput').addEventListener('input',function(e){var value = e.target.value})
  </script>
  ```

## 47 如何解决iOS设置中 input按钮样式会被默认样式覆盖的问题
  input,textarea { border:0；-webkit-appearance:none；}
  如何解决通过 transform进行skew变形、 rotate旋转会出现锯齿现象的问题
  -webkit-transform:rotate（-4deg） skew（10deg） translateZ（0）；
  transform:rotate（-4deg） skew（10deg） translateZ（0）;
  outline:lpx solid rgba（255， 255， 255， 0）;
  在iOS中，以中文输入法输入英文时，如何解决字母之间可能会出现六分之一空格的问题？
  this .value =this .value .replace ( / \u2006/g，' ')
  如何解决移动端HTML5音频标签audio的 autoplay属性失效问题
  document addEventListener (' touchstart'， function( ) {
  //播放音频
  document .getElementsByTagName ('audio ) [0]. play ( );
  //暂停音频
  document getElementsByTagName ('audio) [0]. pause ( )；
  })；
  如何解决移动端HTML5中date类型的input标签不支持 placeholder属性的问题
  < input placeholder = "请输入日期 " type="text" onfocus="（this .type='date'）" name="date">
  如何通过HTML5调用 Android或iOS的拨号功能
  拨打固定电话的代码如下。

  ```html
  <a href="te1:021-12345678">单击拨打021-12345678</a>
  ```
  拨打手机号码的代码如下。

  ```html
  <a href="te1:12345678901">单击拨打12345678901</a>
  ```
  如何解决上下拖动滚动条时的卡顿问题
  body {
  -webkit-overflow-scrolling:touch;
  overflow-scrolling:touch；}
  如何禁止复制或选中文本
  Element {-webkit-user-select:none；-moz-user-select:none ；-khtml-user-select:none ；user-select:none；
  如何解决 Android手机的默认浏览器不支持 websocket的问题
  解决办法就是把通信层的websocket改成websocket+http双协议，对外封装成Net。业务层对 websocket的调用都改成对Net的调用。
  Net默认连接websocket，如果不攴持，就自动切换到http长轮询。
  http的长轮询在使用的时候会有卡顿现象。
    给移动端点击事件会有300ms的延迟,需要引入一个fastclick.js文件
      一般在移动端用ontouchstart/ontouchmove/ontouchend
    圆角bug,  background-clip:padding-box;
    防止手机中网页放大和缩小, meta中viewport设置用户禁止缩放


## 48 js中的同步/异步以及js的事件流
  - 同步: 同一时间粒做一件事
  - 异步: 同一时间粒做多个事,js是单线程的每次只能做一件事情, js运行在浏览器中, 浏览器是多线程,可以同时执行多个任务
## 49 事件的传播机制：
  先捕获，然后是目标阶段 然后再去冒泡，我们可以利用事件的冒泡来进行事件委托，、也就是可以在父元素上绑定事件，通过事件对象 e 来判断点击的具体元素；可以提供性能；
  我们可以利用的 e.stopPropagation()来阻止冒泡；利用 e.preventDefault()来阻止默认事件；
## 50 js中常见的异步任务 
  因为js是单线程的。浏览器遇到setTimeout 和 setInterval会先执行完当前的代码块，在此之前会把定时器推入浏览器的待执行时间队列里面，等到浏览器执行完当前代码之后会看下事件队列里有没有任务，有的话才执行定时器里的代码
      常用的方式：setTimeout setIntervel ajax Promise  asyc/await
  宏任务(marcotask)微任务(microtask) 的执行顺序
  先执行微任务，然后在执行宏任务；
  JS中的宏任务：setTimeout setIntervel ajax
  JS中的微任务：Promise.then  Promise.catch   await(可以理解成Promise.then)
## 51 作用域和作用域链
  - 全局作用域、函数作用域、块级作用域
  - 作用域链就是从当前作用域开始一层一层向上寻找某个变量，直到找到全局作用域还是没找到，就宣布放弃。这种一层一层的关系，就是作用域链
## 52 this指向?
  - 全局作用域下的this指向window
  - 如果给元素的事件行为绑定函数，那么函数中的this指向当前被绑定的那个元素
  - 函数中的this，要看函数执行前有没有点, 有点的话，点前面是谁，this就指向谁，如果没有点，指向window
  - 自执行函数中的this永远指向window
  - 定时器中函数的this指向window
  - 构造函数中的this指向当前的实例
  - call、apply、bind可以改变函数的this指向
  - 箭头函数中没有this，如果输出this，就会输出箭头函数定义时所在的作用域中的this
## 53 dom相关

  - 获取dom元素：
    - document.getElementById（‘btn’）,只能通过id，只能获取一个元素
    - document.getElementsByTagName（‘button’）只能通过标签名，返回一个伪数组
    - document.getElementsByClassName（‘btn’）只能通过类名，返回一个伪数组
    - document.querySelect()
    - document.querySelectAll()      返回一个伪数组
    - document.documentElement
    - document.body
  - 创建dom元素：
    - document.write()
    - div.appendChild(document.createElement(‘span’))
    - div.innerHTML = ‘<span></span>’
  - 其他
    - insertBefore插入节点
    - replaceChild替换节点
    - removeChild删除节点
    - appendChild追加节点
  - clientX，pageX，offsetX
    - clientX /clientY鼠标相对浏览器窗口的水平距离和垂直距离，视口左上角为原点
    - pageX/pageY鼠标相对document页面的水平距离和垂直距离，页面左上角为原点
    - offsetX/offsetY鼠标相对自身元素的水平距离和垂直距离，自身元素左上角为原点
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

  ## ES6模块和CommonJS模块有什么区别?
    - 语法不同：
      ES6 模块使用 import 和 export 关键字来导入和导出模块，而 CommonJS 模块使用 require 和 module.exports 或 exports 来导入和导出模块。
    - 异步加载:
      ES6 模块支持动态导入（dynamic import），可以异步加载模块。这使得在需要时按需加载模块成为可能，从而提高了性能。CommonJS 模块在设计时没有考虑异步加载的需求，通常在模块的顶部进行同步加载。
  ```js
  // ES6 模块
  import { foo } from './module';
  export const bar = 'bar';

  // CommonJS 模块
  const foo = require('./commonjs');
  exports.bar = 'bar';
  ```
  ## 对AJAX的理解，实现一个AJAX请求

  AJAX是 Asynchronous JavaScript and XML 的缩写，指的是通过 JavaScript 的 异步通信，从服务器获取 XML 文档从中提取数据，再更新当前网页的对应部分，而不用刷新整个网页。
  创建AJAX请求的步骤：

  - 创建一个 XMLHttpRequest 对象。
  - 在这个对象上使用 open 方法创建一个 HTTP 请求，open 方法所需要的参数是请求的方法、请求的地址、是否异步和用户的认证信息。
  - 在发起请求前，可以为这个对象添加一些信息和监听函数。比如说可以通过 setRequestHeader 方法来为请求添加头信息。还可以为这个对象添加一个状态监听函数。一个 XMLHttpRequest 对象一共有 5 个状态，当它的状态变化时会触发onreadystatechange 事件，可以通过设置监听函数，来处理请求成功后的结果。当对象的 readyState 变为 4 的时候，代表服务器返回的数据接收完成，这个时候可以通过判断请求的状态，如果状态是 2xx 或者 304 的话则代表返回正常。这个时候就可以通过 response 中的数据来对页面进行更新了。
  - 当对象的属性和监听函数设置完成后，最后调用 send 方法来向服务器发起请求，可以传入参数作为发送的数据体。

  ```js
  const SERVER_URL = "/server";
  let xhr = new XMLHttpRequest();
  // 创建 Http 请求
  xhr.open("GET", url, true);
  // 设置状态监听函数
  xhr.onreadystatechange = function() {
    if (this.readyState !== 4) return;
    // 当请求成功时
    if (this.status === 200) {
      handle(this.response);
    } else {
      console.error(this.statusText);
    }
  };
  // 设置请求失败时的监听函数
  xhr.onerror = function() {
    console.error(this.statusText);
  };
  // 设置请求头信息
  xhr.responseType = "json";
  xhr.setRequestHeader("Accept", "application/json");
  // 发送 Http 请求
  xhr.send(null);

  ```
  ## ajax、axios、fetch的区别

  - ajax
    
    - 基于原生XHR开发，XHR本身架构不清晰。
    - 针对MVC编程，不符合现在前端MVVM的浪潮。
    - 多个请求之间如果有先后关系的话，就会出现回调地狱
    - 配置和调用方式非常混乱，而且基于事件的异步模型不友好。

  - axios
    - 支持PromiseAPI
    - 从浏览器中创建XMLHttpRequest
    - 从 node.js 创建 http 请求
    - 支持请求拦截和响应拦截
    - 自动转换JSON数据
    - 客服端支持防止CSRF/XSRF

  - fetch

    - 浏览器原生实现的请求方式，ajax的替代品
    - 基于标准 Promise 实现，支持async/await
    - fetchtch只对网络请求报错，对400，500都当做成功的请求，需要封装去处理
    - 默认不会带cookie，需要添加配置项
    - fetch没有办法原生监测请求的进度，而XHR可以。

----------------





