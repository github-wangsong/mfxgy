import{_ as a,c as i,o as n,ag as t}from"./chunks/framework.DyIQiYOb.js";const u=JSON.parse('{"title":"","description":"","frontmatter":{},"headers":[],"relativePath":"docs/BaGuWen/javascript.md","filePath":"docs/BaGuWen/javascript.md"}'),l={name:"docs/BaGuWen/javascript.md"};function s(r,e,o,h,p,c){return n(),i("div",null,e[0]||(e[0]=[t(`<h2 id="_1-var、let、const区别" tabindex="-1">1 var、let、const区别？******* <a class="header-anchor" href="#_1-var、let、const区别" aria-label="Permalink to &quot;1 var、let、const区别？*******&quot;">​</a></h2><ul><li>var存在变量提升；可以重复定义相同的变量；无作用域，定义的变量是顶层对象（window）属性</li><li>let、const:无法进行变量提升，无法重复定义会报错；拥有块级作用域，暂时性死区</li><li>const定义后无法修改，否则会报错(引用类型可以更改里面的数据)</li></ul><h2 id="_2-js有那些数据类型" tabindex="-1">2 js有那些数据类型？ <a class="header-anchor" href="#_2-js有那些数据类型" aria-label="Permalink to &quot;2 js有那些数据类型？&quot;">​</a></h2><ul><li>基本数据类型：Number,String, Null, Undefind, syboml，Boolean。BigInt</li><li>引用类型：Object;</li><li>基本: 操作值</li><li>引用: 操作堆内存空间地址</li></ul><h2 id="_3-null和undefined区别" tabindex="-1">3 null和undefined区别? <a class="header-anchor" href="#_3-null和undefined区别" aria-label="Permalink to &quot;3 null和undefined区别?&quot;">​</a></h2><ul><li>undefined 代表的含义是未定义，一般变量声明了但还没有定义的时候会返回 undefined，typeof为undefined</li><li>null 代表的含义是空对象，null主要用于赋值给一些可能会返回对象的变量，作为初始化，typeof为object</li></ul><h2 id="_4-js的类型检测" tabindex="-1">4 JS的类型检测? <a class="header-anchor" href="#_4-js的类型检测" aria-label="Permalink to &quot;4 JS的类型检测?&quot;">​</a></h2><ul><li>typeof，对象类型不详细，无法检测array；不能检测null；返回的是字符串</li><li>instanceof 检测当前实例是否属于这个类；只要当前类出现在实例的原型链上，结果是true；原型指向可以修改，结果不准确；不能检测基本数据类型</li><li>constructor 可以检测基本数据类型；原型指向可以修改，结果不准确</li><li>Object.prototype.toString.call() 标准的检测方法</li><li>Array.isArray() 判断是否是数组</li></ul><p>一些其他：</p><ul><li>object.hasOwnProperty(proName) 函数方法是返回一个布尔值，判断是否是该对象的私有属性。</li><li>Array.prototype.slice.call(fakeArray) 将数组转化为真正的Array对象。</li><li>Array.from(arr) 伪数组转真数组</li></ul><h2 id="_5-为什么0-1-0-2-0-3-如何让其相等" tabindex="-1">5 为什么0.1+0.2 ! == 0.3，如何让其相等 <a class="header-anchor" href="#_5-为什么0-1-0-2-0-3-如何让其相等" aria-label="Permalink to &quot;5 为什么0.1+0.2 ! == 0.3，如何让其相等&quot;">​</a></h2><p>因为浮点数运算的精度问题。在计算机运行过程中，需要将数据转化成二进制，然后再进行计算。 因为浮点数自身小数位数的限制而截断的二进制在转化为十进制，就变成0.30000000000000004，所以在计算时会产生误差</p><p>解决方案: 将其先转换成整数，再相加之后转回小数。具体做法为先乘10相加后除以10</p><h2 id="_6-数组-array-常用的一些api" tabindex="-1">6 数组(Array)常用的一些API？ <a class="header-anchor" href="#_6-数组-array-常用的一些api" aria-label="Permalink to &quot;6 数组(Array)常用的一些API？&quot;">​</a></h2><ul><li>Push：向数组尾部添加一个元素，并返回数组的长度；</li><li>Pop: 删除最后一个元素，并返回删除的元素</li><li>Unshift: 向数组头部添加一个元素，并返回数组长度;</li><li>Shift: 删除并返回删除的元素</li><li>splice: 替换(添加或者删除)，返回被删除元素组成的数组，会改变</li><li>reverse：反转数组，会改变</li><li>sort ：排序，默认按照unicode从小到大排，会改变</li><li>concat: 合并并返回新的数组，不改变</li><li>slice:提取数组，返回新数组，不改变原数组</li><li>join：数组转字符串，不改变</li><li>indexOf: 查询指定元素，有返回下标，否则返回-1;</li><li>includes: 查询指定元素，并Boolean值;</li><li>every/some：全为真返回真/有一个真返回真</li><li>find/findIndex：找到第一个满足条件的元素/索引值</li><li>forEach: 遍历元素;</li><li>filter: 根据条件来返回符合规范的元素，不改变原数组;</li><li>map: 返回处理后的数组元素，不改变原数组;</li><li>reduce：累加，第一个参数是上一次的返回值</li></ul><h2 id="_7-字符串-string-常用的api" tabindex="-1">7 字符串(String)常用的API? <a class="header-anchor" href="#_7-字符串-string-常用的api" aria-label="Permalink to &quot;7 字符串(String)常用的API?&quot;">​</a></h2><ul><li>indexOf/lastIndexOf: 从左/右开始查询指定元素，有返回下标，否则返回-1;</li><li>includes()：返回布尔值，表示是否找到了参数字符串。</li><li>startsWith()：返回布尔值，表示参数字符串是否在原字符串的头部。</li><li>endsWith()：返回布尔值，表示参数字符串是否在原字符串的尾部。</li><li>charAt：获取指定位置字符</li><li>at()方法接受一个整数作为参数，返回参数指定位置的字符，支持负索引</li><li>replace: 根据正则表达式替换指定内容，并返回的的字符串;</li><li>match：按照正则规则获取指定字符串</li><li>subStr/ substring/ slice: 字符串截取</li><li>concat:字符串拼接</li><li>repeat:重复字符串</li><li>split：字符串转数组</li><li>trim: 去除两边空白;</li><li>toLowerCase/toUpperCase：转小写/转大写</li><li>toString: 转为字符串;</li></ul><h2 id="_8-es6新特性" tabindex="-1">8 ES6新特性？ <a class="header-anchor" href="#_8-es6新特性" aria-label="Permalink to &quot;8 ES6新特性？&quot;">​</a></h2><ul><li>新的变量定义方式：let/cost/import/class</li><li>结构赋值：数组/对象/字符串/数值和布尔/函数参数，</li><li>字符串扩展：可使用for...of循环遍历，模板字符串</li><li>字符串新增方法：includes/startsWith/endsWith/ repeat/at</li><li>数值拓展：Number.isFinite(), Number.isNaN()/Math.trunc()去除小数部分</li><li>函数拓展：参数默认值（函数的 length 属性失真），rest参数</li><li>箭头函数：没有this，不能当构造函数，不能使用arguments，</li><li>数组拓展：Array.from() Array.of() find() fill() includes() flat()，flatMap() at()</li><li>对象拓展：Object.assign()，super 关键字，Object.is() Object.values和Object.entries</li><li>对象遍历：for...in、Object.keys(obj)、Object.getOwnPropertyNames(obj)，Object.getOwnPropertySymbols</li><li>指数运算符 **</li><li>set：它类似于数组，但是成员的值都是唯一的，没有重复的值</li><li>WeakSet 结构与 Set 类似，也是不重复的值的集合。但是，它与 Set 有两个区别。 首先，WeakSet 的成员只能是对象，而不能是其他类型的值。</li><li>模板字符串、拓展运算符、Promise、函数形参默认值、asysn/await、syboml、- map、set、箭头函数；</li></ul><h2 id="_9-谈谈对promise的理解" tabindex="-1">9 谈谈对Promise的理解? <a class="header-anchor" href="#_9-谈谈对promise的理解" aria-label="Permalink to &quot;9 谈谈对Promise的理解?&quot;">​</a></h2><ul><li><p>Promise用来处理异步编程，将异步操作以同步操作的流程表达出来，避免了地狱回调。</p></li><li><p>Promise的实例有三个状态：padding、fulfilled、rejected;</p></li><li><p>Promise的实例有两个过程：</p><ul><li><p>pending -&gt; fulfilled : Resolved（已完成）</p></li><li><p>pending -&gt; rejected：Rejected（已拒绝）</p></li><li><p>一旦从进行状态变成为其他状态就永远不能更改状态了，其过程是不可逆的。</p></li></ul></li><li><p>Promise构造函数接收一个带有resolve和reject参数的回调函数。</p><ul><li>resolve的作用是将Promise状态从pending变为fulfilled，在异步操作成功时调用，并将异步结果返回，作为参数传递出去</li><li>reject的作用是将Promise状态从pending变为rejected，在异步操作失败后，将异步操作错误的结果，作为参数传递出去</li></ul></li><li><p>Promise的缺点：</p><ul><li>无法取消 Promise，一旦新建它就会立即执行，无法中途取消。</li><li>如果不设置回调函数，Promise内部抛出的错误，不会反应到外部。</li><li>当处于pending状态时，无法得知目前进展到哪一个阶段（刚刚开始还是即将完成）</li></ul></li></ul><h2 id="_10-promise方法" tabindex="-1">10 Promise方法 <a class="header-anchor" href="#_10-promise方法" aria-label="Permalink to &quot;10 Promise方法&quot;">​</a></h2><ul><li>promise.then() 对应resolve成功的处理</li><li>promise.catch()对应reject失败的处理</li><li>promise.all()可以完成并行任务，将多个Promise实例数组，包装成一个新的Promise实例，返回的实例就是普通的Promise。有一个失败，代表该Primise失败。当所有的子Promise完成，返回值时全部值的数组</li><li>promise.race()类似promise.all()，区别在于有任意一个完成就算完成</li><li>promise.allSettled() 返回一个在所有给定的 promise 都已经 fulfilled 或 rejected 后的 promise ，并带有一个对象数组，每个对象表示对应的promise 结果。</li><li></li></ul><p>一般常用用then,catch,finally，all,race，any这些方法； 通过then去获取返回的promise里面的内容；catch去捕获reject的一些问题；finally不管状态如何都会执行；all和race可以放入多个promise，都是返回一个数组，区别是race只会返回最快的那个请求，而all是全部返回，但是all如果里面有问题的话，会直接抛异常出来告诉你；</p><h2 id="_20-promise-all-和-promise-allsettled-区别" tabindex="-1">20 promise.all 和 promise.allsettled 区别 <a class="header-anchor" href="#_20-promise-all-和-promise-allsettled-区别" aria-label="Permalink to &quot;20 promise.all 和 promise.allsettled 区别&quot;">​</a></h2><ul><li>all: 只有当所有Promise实例都resolve后，才会resolve返回一个由所有Promise返回值组成的数组。如果有一个Promise实例reject，就会立即被拒绝，并返回拒绝原因。all是团队的成功才算，如果有一个人失败就算失败。</li><li>allSettled： 等所有Promise执行完毕后，不管成功或失败， 都会吧每个Promise状态信息放到一个数组里面返回。</li></ul><h2 id="_21-对async-await的理解" tabindex="-1">21 对Async/await的理解? <a class="header-anchor" href="#_21-对async-await的理解" aria-label="Permalink to &quot;21 对Async/await的理解?&quot;">​</a></h2><p>async/await其实是Generator 的语法糖，它能实现的效果都能用then链来实现，它是为优化then链而开发出来的。通过async关键字声明一个异步函数， await 用于等待一个异步方法执行完成，并且会阻塞执行。 async 函数返回的是一个 Promise 对象，如果在函数中 return 一个变量，async 会把这个直接量通过 Promise.resolve() 封装成 Promise 对象。如果没有返回值，返回 Promise.resolve(undefined)</p><h2 id="_22-闭包" tabindex="-1">22 闭包？ <a class="header-anchor" href="#_22-闭包" aria-label="Permalink to &quot;22 闭包？&quot;">​</a></h2><ul><li>一个函数调用时使用了其外层函数的变量，此时形成一个闭包</li><li>适当使用闭包可以延长变量的生命周期，节省资源，而且还能让变量无法污染；但是滥用的话，那么js无法回收那些不需要使用的变量，从而会引起内存泄露；</li></ul><h2 id="_23-原型、原型链" tabindex="-1">23 原型、原型链？ <a class="header-anchor" href="#_23-原型、原型链" aria-label="Permalink to &quot;23 原型、原型链？&quot;">​</a></h2><ul><li>原型： <ul><li>每个 class都有显示原型 prototype</li><li>每个实例都有隐式原型 _ proto_</li><li>实例的_ proto_指向对应 class 的 prototype</li></ul></li><li>原型链: 当我们访问一个对象的属性时，如果这个对象内部不存在这个属性，那么它就会去它的原型对象里找这个属性，这个原型对象又会有自己的原型，于是就这样一直找下去，也就是原型链的概念</li></ul><h2 id="_24-js回收机制" tabindex="-1">24 JS回收机制？ <a class="header-anchor" href="#_24-js回收机制" aria-label="Permalink to &quot;24 JS回收机制？&quot;">​</a></h2><p>js回收机制，简单来说分为两种，一种是引用法、一种是标记法。引用法就是判断一个对象的引用数，如果引用数为0就回收掉，大于0旧不会收；</p><p>但引用法在某种情况下会造成内存泄露的问题；比如说创建两个对象，1对 象.a=2对象；2对象.a=1对象；那么这种相互引用他们得引用数都不小于0； js旧无法去回收他们；另一种是标记法：标记法就是判断对象是否可达，如 果是得话，那么就不回收。反之回收；那么什么是可达呢？这就要来聊聊可 达性这个问题了。可达性他其实就是从根对象得指针开始，向下搜索子节点。 如果子节点被搜索到了，那么就说明这个子节点得引用对象可达，并标记他； 然后继续进行一个递归搜索得操作，直至遍历完成；这时候所有没有被标记 的节点，会被当成没有被任何地方引用，就会被认为是可以回收释放掉的对 象，可以被垃圾回收器回收。 首先聊聊Js内存管理：js内存的流程分为3步： 分配给使用者所需的内存； 使用者拿到内存后并且使用； 使用者不需要这些内存后，释放并归还给系统；(使用者就是变量或者实例) Js数据类型分为两种：基本数据类型和引用数据类型； 一般基本数据类型拥有固定的大小，值保存在栈内存里，可以通过值直接访问，由于栈内存是大小固定，所以一般都是操作系统自动分配和释放；而引用数据类型大小是不固定的，栈内存保存指针，指向堆内存中的对象空间，通过引用来访问，由于大小不固定系统无法自动释放需要js引擎手动释放； 那么为什么要垃圾回收，在chrome中，v8被限制了内存的使用，像刚刚说的栈内存是由操作系统自动分配和释放的，但是堆内存的话需要由js引擎手动释放，当代码写的不规范的时候，会使js引擎无法正确的堆内存释放，从而使浏览器内存不断的增加，进而导致js和应用以及操作系统的性能不断下降； 垃圾回收算法：太多记不住</p><h2 id="_25-事件循环-event-loop" tabindex="-1">25 事件循环(Event loop)? <a class="header-anchor" href="#_25-事件循环-event-loop" aria-label="Permalink to &quot;25 事件循环(Event loop)?&quot;">​</a></h2><p>由于js是单线程的，所以在运行代码的时候，耗时的一些内容会存到任务队列里面；在运行的时候，简单的变量定义赋值会很快的执行下去，其中一些如定时器、promise之类的内容，比较耗时会存到任务队列等待；当所有简单的内容执行完成时，就会执行微任务，微任务执行完成之后，会去执行宏任务，然后宏任务有趣执行微任务。直到所以东西被执行完成后；任务结束，这个过程就叫做事件轮询；其中任务队列又分为宏任务和微任务；宏任务如定时器之类；微任务如promise之类的；</p><h2 id="_26-宏任务与微任务" tabindex="-1">26 宏任务与微任务？ <a class="header-anchor" href="#_26-宏任务与微任务" aria-label="Permalink to &quot;26 宏任务与微任务？&quot;">​</a></h2><ul><li>宏任务：ajax，定时器，文件操作，dom事件</li><li>微任务：Promise.then，process.nextTick，MutationObserver</li></ul><h2 id="_27普通函数和箭头函数" tabindex="-1">27普通函数和箭头函数？ <a class="header-anchor" href="#_27普通函数和箭头函数" aria-label="Permalink to &quot;27普通函数和箭头函数？&quot;">​</a></h2><p>主要解决This的指向问题(继承上级，本身没有this)，普通函数指向全局也就是window,但是箭头函数指向他的上级；</p><h2 id="_28-map、set区别" tabindex="-1">28 Map、Set区别？ <a class="header-anchor" href="#_28-map、set区别" aria-label="Permalink to &quot;28 Map、Set区别？&quot;">​</a></h2><ul><li>Set <ul><li>创建： new Set([1, 1, 2, 3, 3, 4, 2])</li><li>add(value)：添加某个值，返回Set结构本身。</li><li>delete(value)：删除某个值，返回一个布尔值，表示删除是否成功。</li><li>has(value)：返回一个布尔值，表示该值是否为Set的成员。</li><li>clear()：清除所有成员，没有返回值。</li></ul></li><li>Map <ul><li>set(key, val): 向Map中添加新元素</li><li>get(key): 通过键值查找特定的数值并返回</li><li>has(key): 判断Map对象中是否有Key所对应的值，有返回true,否则返回false</li><li>delete(key): 通过键值从Map中移除对应的数据</li><li>clear(): 将这个Map中的所有元素删除</li></ul></li><li>区别 <ul><li>Map是一种键值对的集合，和对象不同的是，键可以是任意值</li><li>Map可以遍历，可以和各种数据格式转换</li><li>Set是类似数组的一种的数据结构，类似数组的一种集合，但在Set中没有重复的值, set去重：newArr = […new set(arr)]</li></ul></li></ul><h2 id="_29-map和object的区别" tabindex="-1">29 map和Object的区别? <a class="header-anchor" href="#_29-map和object的区别" aria-label="Permalink to &quot;29 map和Object的区别?&quot;">​</a></h2><p>map和Object都是用键值对来存储数据，区别如下：</p><ul><li>键的类型：Map 的键可以是任意数据类型（包括对象、函数、NaN 等），而 Object 的键只能是字符串或者 Symbol 类型。</li><li>键值对的顺序：Map中的键值对是按照插入的顺序存储的，而对象中的键值对则没有顺序。</li><li>键值对的遍例：Map 的键值对可以使用 for...of 进行遍历，而 Object 的键值对需要手动遍历键值对。</li><li>继承关系：Map 没有继承关系，而 Object 是所有对象的基类。</li></ul><h2 id="_30-map和weakmap的区别" tabindex="-1">30 map和weakMap的区别 <a class="header-anchor" href="#_30-map和weakmap的区别" aria-label="Permalink to &quot;30 map和weakMap的区别&quot;">​</a></h2><p>它们是 JavaScript 中的两种不同的键值对集合，主要区别如下：</p><ul><li>map的键可以是任意类型，weakMap键只能是对象类型。</li><li>map 使用常规的引用来管理键和值之间的关系，因此即使键不再使用，map 仍然会保留该键的内存。weakMap 使用弱引用来管理键和值之间的关系，因此如果键不再有其他引用，垃圾回收机制可以自动回收键值对。</li></ul><h2 id="_31-数组方法map、filter、foreach区别" tabindex="-1">31 数组方法Map、filter、forEach区别? <a class="header-anchor" href="#_31-数组方法map、filter、foreach区别" aria-label="Permalink to &quot;31 数组方法Map、filter、forEach区别?&quot;">​</a></h2><p>都不会改变原对象；但是map和filter都需要return处理好的元素；forEcho不会；他们都不会被return打断；如果像打断，使用trycatch包括起来抛异常</p><h2 id="_32-三种弹窗的单词以及三种弹窗的功能" tabindex="-1">32 三种弹窗的单词以及三种弹窗的功能 <a class="header-anchor" href="#_32-三种弹窗的单词以及三种弹窗的功能" aria-label="Permalink to &quot;32 三种弹窗的单词以及三种弹窗的功能&quot;">​</a></h2><ul><li>console.log()控制台输出</li><li>console.dir()输出一个对象详细键值对信息</li><li>console.table() 把一个多维数组按照表格方式输出</li><li>alert（ ） 弹框</li><li>confirm （ ）询问框</li><li>prompt （ ）输入框</li><li>document.write（ ）页面写入</li></ul><h2 id="_33-例举3种强制类型转换和2种隐式类型转换" tabindex="-1">33 例举3种强制类型转换和2种隐式类型转换? <a class="header-anchor" href="#_33-例举3种强制类型转换和2种隐式类型转换" aria-label="Permalink to &quot;33 例举3种强制类型转换和2种隐式类型转换?&quot;">​</a></h2><ul><li>强制（parseInt(),parseFloat(),Number()）</li><li>隐式（== ,!!）</li></ul><h2 id="_34-基础数据类型与变量对象" tabindex="-1">34 基础数据类型与变量对象 <a class="header-anchor" href="#_34-基础数据类型与变量对象" aria-label="Permalink to &quot;34 基础数据类型与变量对象&quot;">​</a></h2><p>函数运行时，会创建一个执行环境，这个执行环境叫作执行上下文（ Execution Context ） 在执行上下文中，会创建一个叫作变量对象（ VO ）的特殊对象 基础数据类型往往都保存在变量对象中 变量对象也存在于堆内存中 ，但是由于变量对象有特殊职能，因此在理解时， 建议仍然将其与堆内存空间区分开来</p><h2 id="_35-引用数据类型与堆内存空间" tabindex="-1">35 引用数据类型与堆内存空间 <a class="header-anchor" href="#_35-引用数据类型与堆内存空间" aria-label="Permalink to &quot;35 引用数据类型与堆内存空间&quot;">​</a></h2><p>引用数据类型（ Object ）的值是保存在堆内存空间中的对象 JavaScript 中，不允许直接访问堆内存空间中的数据，因此不能直接操作对象的堆内存空间 。在操作对象时，实际上是在操作对象的引用而不是实际的对象 ，因此，引用数据类型都是按引用访问的，这里的引用，可以理解为保存在变量对象中的一个地址，该地址与堆内存中的对象相关联</p><h2 id="_36-垃圾回收机制" tabindex="-1">36 垃圾回收机制 <a class="header-anchor" href="#_36-垃圾回收机制" aria-label="Permalink to &quot;36 垃圾回收机制&quot;">​</a></h2><p>JavaScript 的垃圾回收实现主要依靠“引用”的概念 当一块内存空间中的数据能够被访问 时，垃圾回收器就认为“该数据能够被获得”。 不能够被获得的数据，就会被打上标记，并回收内存空间，这种方式叫作标记清除算法。 这个算法会设置一个全局对象，并定期地从全局对象开始查找，垃圾回收器会找到所有可获得与不能够被获得的数据，因此当我们将变量设置为 null 时，那么刚开始分配的值 ，就无法被访问到了，而是很快会被自动回收 在局部作用域中，当函数执行完毕后，局部变量也就没有存在的必要了，因此垃圾收集器很容易做出判断并回收 但是在全局中，变量什么时候需妥自动释放内存空间则很难判断， 因此我们在开发时，应尽量避免使用全局变量 如果使用了全局变量，则建议不再使用它时，通 a= null 这样的方式释放引用，以确保能够及时回收内存空间 闭包会阻止垃圾回收机制回收</p><div class="language-js vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">js</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">function</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> f1</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> () { </span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  var</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> n </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">=</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> 999</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">; </span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">  Add</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> function</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">() { n </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">+=</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> 1</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">; } </span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">  return</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> function</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> f2</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> () { </span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    console.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">log</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(n);</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  }</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">var</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> result </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">=</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> f1</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> ();</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">result</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(); </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// ①</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">Add</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(); </span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">result</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(); </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// ②</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//①	999  ②10000</span></span></code></pre></div><h2 id="_37-事件循环机制" tabindex="-1">37 事件循环机制 <a class="header-anchor" href="#_37-事件循环机制" aria-label="Permalink to &quot;37 事件循环机制&quot;">​</a></h2><p>每一个 JavaScript 程序都拥有唯一的事件循环，大多数代码的执行顺序是可以根据函数调用栈的规则执行的，而 setTimeout/setlnterval 或者不同的事件绑定（ click mousedown 等）中的代码，则通过队列来执行。 set Timeout 为任务源，或者任务分发器，由它们将不同的任务分发到不同的任务队列中去 每一个任务源都有对应的任务队列 任务队列又分为宏任务（ macro-task ）与微任务（ micro-task ）两种 它从 macro-task 中的 script 开始第 1次循环 此时全局上下文进入函数调用栈， 直到调用栈清空（只剩下全局上下文），在这个过程中，如果遇到任务分发器就会将任务放入对应队列中去次循环时， macro-task 中其实只有 script ，因此函数调用栈清空之后，会直接执行所有的 micro-task 当所有可执行的 micro-task 执行完毕之后，就表示第一次事件循环已经结束次循环会再次从 macro-task 开始执行 此时 macro-task 中的 script 队列中已经没有任务 了，但是可能会有其他的队列任务，而 micro-task 中暂时还没有任务 此时会先选择其中一个宏任务队列，例如 setTimeout ，将该队列中的所有任务全部执行完毕，然后再执行此过程中可能产生的微任务 微任务执行完毕之后，再回过头来执行其他宏任务队列中的任务 依次类推，直到 所有宏任务队列中的任务都被执行一遍，并且清空了微任务，第二次循环就会结束 如果在第二次循环过程中，产生了新的宏任务队列，或者之前宏任务队列中的的任务暂时没 有满足执行条件，例如延迟时间不够或者事件没有触发，那么将会继续以同样的顺序重复循环</p><h2 id="_38-call-bind-apply-的区别" tabindex="-1">38 call / bind/ apply 的区别 <a class="header-anchor" href="#_38-call-bind-apply-的区别" aria-label="Permalink to &quot;38 call / bind/ apply 的区别&quot;">​</a></h2><ul><li>call / apply改变this指向,调用函数，apply传参是一个数组</li><li>bind改变this指向，没有调用函数，返回一个新的函数</li><li>基于call实现继承</li><li>基于apply求数组最大值: console.log(Math.max.apply(null,arr))</li></ul><h2 id="_39-object-create-obj-的作用" tabindex="-1">39 Object.create（obj）的作用： <a class="header-anchor" href="#_39-object-create-obj-的作用" aria-label="Permalink to &quot;39 Object.create（obj）的作用：&quot;">​</a></h2><p>该函数返回了一个新的空对象，但是该空对象的__proto__是指向了obj这个参数</p><h2 id="_40-继承方式" tabindex="-1">40 继承方式 <a class="header-anchor" href="#_40-继承方式" aria-label="Permalink to &quot;40 继承方式&quot;">​</a></h2><ul><li>原型链继承， 子类原型==父类实例，可以重写父类属性和方法</li><li>构造函数继承</li><li>实例继承</li><li>拷贝继承</li><li>组合继承</li><li>寄生组合继承</li><li>类继承</li></ul><p>寄生组合继承</p><div class="language-js vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">js</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">function</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Parent</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">name</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">) {</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">  this</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.name </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">=</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> name;</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">  this</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.colors </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">=</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> [</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;red&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;green&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;blue&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">];</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">Parent</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">prototype</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">sayName</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> function</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">() {</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  console.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">log</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">this</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.name);</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">};</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">function</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Child</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">name</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">age</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">) {</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">  // 执行父类构造函数</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Parent.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">call</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">this</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, name);</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">  this</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.age </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">=</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> age;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 将子类的原型  指向父类</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">Child</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">prototype</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> Object.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">create</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">Parent</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">prototype</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">);</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 此时的狗早函数为父类的 需要指回自己</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">Child</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">prototype</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">constructor</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> Child;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">Child</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">prototype</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">sayAge</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> =</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> function</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">() {</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  console.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">log</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">this</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">.age);</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">};</span></span>
<span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">var</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> child1 </span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">=</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> new</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Child</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;Tom&#39;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">18</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">);</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">child1.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">sayName</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(); </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// &#39;Tom&#39;</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">child1.</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">sayAge</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">(); </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 18</span></span></code></pre></div><h2 id="_41-深克隆-浅克隆" tabindex="-1">41 深克隆/浅克隆? <a class="header-anchor" href="#_41-深克隆-浅克隆" aria-label="Permalink to &quot;41 深克隆/浅克隆?&quot;">​</a></h2><ul><li>浅拷贝：拷贝基本数据类型时，不受任何影响，当拷贝引用类型时，源对象也会被修改。</li><li>深拷贝：深拷贝就是完完全全拷贝一份新的对象，它会在内存的堆区域重新开辟空间，修改拷贝对象就不会影响到源对象 即深浅拷贝是针对于引用数据类型</li><li>浅拷贝的现象有： newObj = Object.assign（{}，obj）或者 newobj = {…obj} 数组拷贝，newArr = arr.slice()或者newArr = arr. concat ()</li><li>深拷贝方式： 展开运算符， JSON.parse(JSON.stringify(obj))，无法拷贝值为function，undefined，symbol；值为BigInt类型会报错 jquery中 $extend（）添加true就是深拷贝 手写递归</li></ul><h2 id="_42-设计模式有哪些" tabindex="-1">42 设计模式有哪些? <a class="header-anchor" href="#_42-设计模式有哪些" aria-label="Permalink to &quot;42 设计模式有哪些?&quot;">​</a></h2><ul><li>单例模式：保证类只有一个实例，并提供一个访问它的全局访问点。</li><li>工厂模式：用来创建对象，根据不同的参数返回不同的对象实例。</li><li>策略模式：定义一系列的算法，把它们一个个封装起来，并且使它们可以相互替换。</li><li>装饰器模式：在不改变对象原型的基础上，对其进行包装扩展。</li><li>观察者模式：定义了对象间一种一对多关系，当目标对象状态发生改变时，所有依赖它对对象都会得到通知。</li><li>发布订阅模式： 基于一个主题/事件通道，希望接收通知的对象通过自定义事件订阅主题，被激活事件的对象（通过发布主题事件的方式被通知）。</li></ul><h2 id="_43-三点运算符" tabindex="-1">43 三点运算符: <a class="header-anchor" href="#_43-三点运算符" aria-label="Permalink to &quot;43 三点运算符:&quot;">​</a></h2><ul><li>拓展运算符（结构赋值）</li><li>展开运算符（传递参数）</li><li>剩余运算符（接收实参）</li></ul><h2 id="_44-dom0-和dom2的区别" tabindex="-1">44 dom0 和dom2的区别 <a class="header-anchor" href="#_44-dom0-和dom2的区别" aria-label="Permalink to &quot;44 dom0 和dom2的区别&quot;">​</a></h2><ul><li>1书写语法上不同</li><li>2运行机制上不同 dom0就是给元素某个属性添加方法 dom2是基于事件池机制完成的</li><li>3 dom2中可以给一些特殊事件添加方法 DomContentLoaded dom结构加载完触发 transitionend transition结束后触发</li></ul><h2 id="_45-new操作符干了那些事" tabindex="-1">45 new操作符干了那些事? <a class="header-anchor" href="#_45-new操作符干了那些事" aria-label="Permalink to &quot;45 new操作符干了那些事?&quot;">​</a></h2><ul><li>创建一空对象</li><li>给对象设置__proto__, 值为构造函数对象的prototype属性值</li><li>通过对象执行构造函数体(给对象添加属性/方法)</li></ul><h2 id="_46-理解闭包" tabindex="-1">46 理解闭包? <a class="header-anchor" href="#_46-理解闭包" aria-label="Permalink to &quot;46 理解闭包?&quot;">​</a></h2><ol><li>函数嵌套函数</li><li>函数内部可以引用外部的参数和变量</li><li>3.参数和变量不会被垃圾回收机制回收</li></ol><h2 id="_47-内存泄露的几种情况" tabindex="-1">47 内存泄露的几种情况 <a class="header-anchor" href="#_47-内存泄露的几种情况" aria-label="Permalink to &quot;47 内存泄露的几种情况&quot;">​</a></h2><ul><li>意外的全局变量，解决方法：严格模式进行检测</li><li>定时器，及时清除</li><li>闭包</li><li>事件监听</li><li>dom元素的引用没有被释放</li></ul><h2 id="_48-移动端的兼容问题" tabindex="-1">48 移动端的兼容问题 <a class="header-anchor" href="#_48-移动端的兼容问题" aria-label="Permalink to &quot;48 移动端的兼容问题&quot;">​</a></h2><p>单击穿透是什么? 单击蒙版，触发了蒙版下面元素的click事件 单击按钮，如果下面有一个href属性的a标签，会跳转 单击按钮跳转新页面，新页面对应位置元素click事件触发 解决 使用touch事件 click事件增加300ms延迟 如何实现自适应布局 媒体查询做响应式 栅格系统 弹性盒 如何解决长时间按住页面出现闪退的问题 element {-webkit-touch-callout:none；} 如何解决 iPhone及iPad下输入框的默认内阴影问题 element { -webkit-appearance:none；} 在iOS和 Android下，如何实现触摸元素时出现半透明灰色遮罩 element {-webkit-tap-highiight-color:rgba （255， 255， 255， 0）} 在旋转屏幕时，如何解决字体大小自动调整的问题 html, body, form, fieldset, p, div, hl, h2， h3， h4， h5， h6 {-webkit-text-size-adjust：100%;} 如何解决 Android手机圆角失效问题 通过 background-clip:padding-box为失效的元素设置样式 如何解决i0S中 input键盘事件 keyup失效问题</p><div class="language-html vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">html</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">input</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> type</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">=</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;text&#39;</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> id</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">=</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&#39;testInput&quot;&gt;</span></span>
<span class="line"><span style="--shiki-light:#B31D28;--shiki-light-font-style:italic;--shiki-dark:#FDAEB7;--shiki-dark-font-style:italic;">&lt;</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">script type=&quot;text/javascript&quot;&gt;</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  document.getElementById(&#39;</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">testInput</span><span style="--shiki-light:#B31D28;--shiki-light-font-style:italic;--shiki-dark:#FDAEB7;--shiki-dark-font-style:italic;">&#39;).addEventListener(&#39;input&#39;,function(e){var</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> value</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> = </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">e.target.value})</span></span>
<span class="line"><span style="--shiki-light:#B31D28;--shiki-light-font-style:italic;--shiki-dark:#FDAEB7;--shiki-dark-font-style:italic;">&lt;/script</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;</span></span></code></pre></div><h2 id="_47-如何解决ios设置中-input按钮样式会被默认样式覆盖的问题" tabindex="-1">47 如何解决iOS设置中 input按钮样式会被默认样式覆盖的问题 <a class="header-anchor" href="#_47-如何解决ios设置中-input按钮样式会被默认样式覆盖的问题" aria-label="Permalink to &quot;47 如何解决iOS设置中 input按钮样式会被默认样式覆盖的问题&quot;">​</a></h2><p>input,textarea { border:0；-webkit-appearance:none；} 如何解决通过 transform进行skew变形、 rotate旋转会出现锯齿现象的问题 -webkit-transform:rotate（-4deg） skew（10deg） translateZ（0）； transform:rotate（-4deg） skew（10deg） translateZ（0）; outline:lpx solid rgba（255， 255， 255， 0）; 在iOS中，以中文输入法输入英文时，如何解决字母之间可能会出现六分之一空格的问题？ this .value =this .value .replace ( / \\u2006/g，&#39; &#39;) 如何解决移动端HTML5音频标签audio的 autoplay属性失效问题 document addEventListener (&#39; touchstart&#39;， function( ) { //播放音频 document .getElementsByTagName (&#39;audio ) [0]. play ( ); //暂停音频 document getElementsByTagName (&#39;audio) [0]. pause ( )； })； 如何解决移动端HTML5中date类型的input标签不支持 placeholder属性的问题 &lt; input placeholder = &quot;请输入日期 &quot; type=&quot;text&quot; onfocus=&quot;（this .type=&#39;date&#39;）&quot; name=&quot;date&quot;&gt; 如何通过HTML5调用 Android或iOS的拨号功能 拨打固定电话的代码如下。</p><div class="language-html vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">html</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">a</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> href</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">=</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&quot;te1:021-12345678&quot;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;单击拨打021-12345678&lt;/</span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">a</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;</span></span></code></pre></div><p>拨打手机号码的代码如下。</p><div class="language-html vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">html</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">a</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> href</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">=</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&quot;te1:12345678901&quot;</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;单击拨打12345678901&lt;/</span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">a</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;</span></span></code></pre></div><p>如何解决上下拖动滚动条时的卡顿问题 body { -webkit-overflow-scrolling:touch; overflow-scrolling:touch；} 如何禁止复制或选中文本 Element {-webkit-user-select:none；-moz-user-select:none ；-khtml-user-select:none ；user-select:none； 如何解决 Android手机的默认浏览器不支持 websocket的问题 解决办法就是把通信层的websocket改成websocket+http双协议，对外封装成Net。业务层对 websocket的调用都改成对Net的调用。 Net默认连接websocket，如果不攴持，就自动切换到http长轮询。 http的长轮询在使用的时候会有卡顿现象。 给移动端点击事件会有300ms的延迟,需要引入一个fastclick.js文件 一般在移动端用ontouchstart/ontouchmove/ontouchend 圆角bug, background-clip:padding-box; 防止手机中网页放大和缩小, meta中viewport设置用户禁止缩放</p><h2 id="_48-js中的同步-异步以及js的事件流" tabindex="-1">48 js中的同步/异步以及js的事件流 <a class="header-anchor" href="#_48-js中的同步-异步以及js的事件流" aria-label="Permalink to &quot;48 js中的同步/异步以及js的事件流&quot;">​</a></h2><ul><li>同步: 同一时间粒做一件事</li><li>异步: 同一时间粒做多个事,js是单线程的每次只能做一件事情, js运行在浏览器中, 浏览器是多线程,可以同时执行多个任务</li></ul><h2 id="_49-事件的传播机制" tabindex="-1">49 事件的传播机制： <a class="header-anchor" href="#_49-事件的传播机制" aria-label="Permalink to &quot;49 事件的传播机制：&quot;">​</a></h2><p>先捕获，然后是目标阶段 然后再去冒泡，我们可以利用事件的冒泡来进行事件委托，、也就是可以在父元素上绑定事件，通过事件对象 e 来判断点击的具体元素；可以提供性能； 我们可以利用的 e.stopPropagation()来阻止冒泡；利用 e.preventDefault()来阻止默认事件；</p><h2 id="_50-js中常见的异步任务" tabindex="-1">50 js中常见的异步任务 <a class="header-anchor" href="#_50-js中常见的异步任务" aria-label="Permalink to &quot;50 js中常见的异步任务&quot;">​</a></h2><p>因为js是单线程的。浏览器遇到setTimeout 和 setInterval会先执行完当前的代码块，在此之前会把定时器推入浏览器的待执行时间队列里面，等到浏览器执行完当前代码之后会看下事件队列里有没有任务，有的话才执行定时器里的代码 常用的方式：setTimeout setIntervel ajax Promise asyc/await 宏任务(marcotask)微任务(microtask) 的执行顺序 先执行微任务，然后在执行宏任务； JS中的宏任务：setTimeout setIntervel ajax JS中的微任务：Promise.then Promise.catch await(可以理解成Promise.then)</p><h2 id="_51-作用域和作用域链" tabindex="-1">51 作用域和作用域链 <a class="header-anchor" href="#_51-作用域和作用域链" aria-label="Permalink to &quot;51 作用域和作用域链&quot;">​</a></h2><ul><li>全局作用域、函数作用域、块级作用域</li><li>作用域链就是从当前作用域开始一层一层向上寻找某个变量，直到找到全局作用域还是没找到，就宣布放弃。这种一层一层的关系，就是作用域链</li></ul><h2 id="_52-this指向" tabindex="-1">52 this指向? <a class="header-anchor" href="#_52-this指向" aria-label="Permalink to &quot;52 this指向?&quot;">​</a></h2><ul><li>全局作用域下的this指向window</li><li>如果给元素的事件行为绑定函数，那么函数中的this指向当前被绑定的那个元素</li><li>函数中的this，要看函数执行前有没有点, 有点的话，点前面是谁，this就指向谁，如果没有点，指向window</li><li>自执行函数中的this永远指向window</li><li>定时器中函数的this指向window</li><li>构造函数中的this指向当前的实例</li><li>call、apply、bind可以改变函数的this指向</li><li>箭头函数中没有this，如果输出this，就会输出箭头函数定义时所在的作用域中的this</li></ul><h2 id="_53-dom相关" tabindex="-1">53 dom相关 <a class="header-anchor" href="#_53-dom相关" aria-label="Permalink to &quot;53 dom相关&quot;">​</a></h2><ul><li><p>获取dom元素：</p><ul><li>document.getElementById（‘btn’）,只能通过id，只能获取一个元素</li><li>document.getElementsByTagName（‘button’）只能通过标签名，返回一个伪数组</li><li>document.getElementsByClassName（‘btn’）只能通过类名，返回一个伪数组</li><li>document.querySelect()</li><li>document.querySelectAll() 返回一个伪数组</li><li>document.documentElement</li><li>document.body</li></ul></li><li><p>创建dom元素：</p><ul><li>document.write()</li><li>div.appendChild(document.createElement(‘span’))</li><li>div.innerHTML = ‘<span></span>’</li></ul></li><li><p>其他</p><ul><li>insertBefore插入节点</li><li>replaceChild替换节点</li><li>removeChild删除节点</li><li>appendChild追加节点</li></ul></li><li><p>clientX，pageX，offsetX</p><ul><li>clientX /clientY鼠标相对浏览器窗口的水平距离和垂直距离，视口左上角为原点</li><li>pageX/pageY鼠标相对document页面的水平距离和垂直距离，页面左上角为原点</li><li>offsetX/offsetY鼠标相对自身元素的水平距离和垂直距离，自身元素左上角为原点</li></ul></li><li><p>offset，client，scroll</p></li><li><p>offsetWidth/ offsetHeight:：盒子内容+padding+border的大小</p></li><li><p>clientWidth/ clientHeight盒子内容+padding的大小</p></li><li><p>scrollWidt/ scrollHeight当内容比盒子小时，拿的是盒子clientwidth，当内容比盒子大时，拿的是内容offsetwidth+盒子一侧内边距</p></li><li><p>offsetLeft/offsetTop 元素的偏移量，定位的left/top值</p></li><li><p>clientLeft/clientTop盒子左边框/上边框的大小</p></li><li><p>scrollLeft/scrollTop盒子向左/上滚动的距离，可写的</p></li><li><p>document.documentElement.clientWidth视口宽高</p></li><li><p>document.documentElement.clientHeight</p></li><li><p>onmouseover/onmouseout与onmouseenter/onmouseleave区别 都是鼠标移入移出触发事件</p></li><li><p>onmouseover/onmouseout：鼠标移入父元素里面子元素时事件会移出然后再移入，事件委派时使用这个</p></li><li><p>onmouseenter/onmouseleave：对父元素添加移入移出，当鼠标移入子元素时，不触发移入移出事件.</p></li></ul><h2 id="es6模块和commonjs模块有什么区别" tabindex="-1">ES6模块和CommonJS模块有什么区别? <a class="header-anchor" href="#es6模块和commonjs模块有什么区别" aria-label="Permalink to &quot;ES6模块和CommonJS模块有什么区别?&quot;">​</a></h2><pre><code>- 语法不同：ES6 模块使用 import 和 export 关键字来导入和导出模块，而 CommonJS 模块使用 require 和 module.exports 或 exports 来导入和导出模块。
- 异步加载: ES6 模块支持动态导入（dynamic import），可以异步加载模块。这使得在需要时按需加载模块成为可能，从而提高了性能。CommonJS 模块在设计时没有考虑异步加载的需求，通常在模块的顶部进行同步加载。
</code></pre><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>// ES6 模块</span></span>
<span class="line"><span>import { foo } from &#39;./module&#39;;</span></span>
<span class="line"><span>export const bar = &#39;bar&#39;;</span></span>
<span class="line"><span></span></span>
<span class="line"><span>// CommonJS 模块</span></span>
<span class="line"><span>const foo = require(&#39;./commonjs&#39;);</span></span>
<span class="line"><span>exports.bar = &#39;bar&#39;;</span></span></code></pre></div><h2 id="对ajax的理解-实现一个ajax请求" tabindex="-1">对AJAX的理解，实现一个AJAX请求 <a class="header-anchor" href="#对ajax的理解-实现一个ajax请求" aria-label="Permalink to &quot;对AJAX的理解，实现一个AJAX请求&quot;">​</a></h2><p>AJAX是 Asynchronous JavaScript and XML 的缩写，指的是通过 JavaScript 的 异步通信，从服务器获取 XML 文档从中提取数据，再更新当前网页的对应部分，而不用刷新整个网页。 创建AJAX请求的步骤：</p><ul><li>创建一个 XMLHttpRequest 对象。</li><li>在这个对象上使用 open 方法创建一个 HTTP 请求，open 方法所需要的参数是请求的方法、请求的地址、是否异步和用户的认证信息。</li><li>在发起请求前，可以为这个对象添加一些信息和监听函数。比如说可以通过 setRequestHeader 方法来为请求添加头信息。还可以为这个对象添加一个状态监听函数。一个 XMLHttpRequest 对象一共有 5 个状态，当它的状态变化时会触发onreadystatechange 事件，可以通过设置监听函数，来处理请求成功后的结果。当对象的 readyState 变为 4 的时候，代表服务器返回的数据接收完成，这个时候可以通过判断请求的状态，如果状态是 2xx 或者 304 的话则代表返回正常。这个时候就可以通过 response 中的数据来对页面进行更新了。</li><li>当对象的属性和监听函数设置完成后，最后调用 send 方法来向服务器发起请求，可以传入参数作为发送的数据体。</li></ul><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>const SERVER_URL = &quot;/server&quot;;</span></span>
<span class="line"><span>let xhr = new XMLHttpRequest();</span></span>
<span class="line"><span>// 创建 Http 请求</span></span>
<span class="line"><span>xhr.open(&quot;GET&quot;, url, true);</span></span>
<span class="line"><span>// 设置状态监听函数</span></span>
<span class="line"><span>xhr.onreadystatechange = function() {</span></span>
<span class="line"><span>  if (this.readyState !== 4) return;</span></span>
<span class="line"><span>  // 当请求成功时</span></span>
<span class="line"><span>  if (this.status === 200) {</span></span>
<span class="line"><span>    handle(this.response);</span></span>
<span class="line"><span>  } else {</span></span>
<span class="line"><span>    console.error(this.statusText);</span></span>
<span class="line"><span>  }</span></span>
<span class="line"><span>};</span></span>
<span class="line"><span>// 设置请求失败时的监听函数</span></span>
<span class="line"><span>xhr.onerror = function() {</span></span>
<span class="line"><span>  console.error(this.statusText);</span></span>
<span class="line"><span>};</span></span>
<span class="line"><span>// 设置请求头信息</span></span>
<span class="line"><span>xhr.responseType = &quot;json&quot;;</span></span>
<span class="line"><span>xhr.setRequestHeader(&quot;Accept&quot;, &quot;application/json&quot;);</span></span>
<span class="line"><span>// 发送 Http 请求</span></span>
<span class="line"><span>xhr.send(null);</span></span></code></pre></div><h2 id="ajax、axios、fetch的区别" tabindex="-1">ajax、axios、fetch的区别 <a class="header-anchor" href="#ajax、axios、fetch的区别" aria-label="Permalink to &quot;ajax、axios、fetch的区别&quot;">​</a></h2><ul><li><p>ajax</p><ul><li>基于原生XHR开发，XHR本身架构不清晰。</li><li>针对MVC编程，不符合现在前端MVVM的浪潮。</li><li>多个请求之间如果有先后关系的话，就会出现回调地狱</li><li>配置和调用方式非常混乱，而且基于事件的异步模型不友好。</li></ul></li><li><p>axios</p><ul><li>支持PromiseAPI</li><li>从浏览器中创建XMLHttpRequest</li><li>从 node.js 创建 http 请求</li><li>支持请求拦截和响应拦截</li><li>自动转换JSON数据</li><li>客服端支持防止CSRF/XSRF</li></ul></li><li><p>fetch</p><ul><li>浏览器原生实现的请求方式，ajax的替代品</li><li>基于标准 Promise 实现，支持async/await</li><li>fetchtch只对网络请求报错，对400，500都当做成功的请求，需要封装去处理</li><li>默认不会带cookie，需要添加配置项</li><li>fetch没有办法原生监测请求的进度，而XHR可以。</li></ul></li></ul><hr><h2 id="vueId">VUE</h2><h2 id="为什么使用vue" tabindex="-1">为什么使用vue? <a class="header-anchor" href="#为什么使用vue" aria-label="Permalink to &quot;为什么使用vue?&quot;">​</a></h2><ul><li>优点： <ul><li>单页面开发，高效率；单向数据流；渐进式编程(周边衍生工具库，如Vuex, Vue-Router)；响应式编程；虚拟DOM；数据与视图分开;易用, 灵活, 高效,组件化</li></ul></li><li>缺点：不利于SEO、不兼容IE(10以上才行，vue3好像的12以上)、首屏加载过长；</li></ul><h2 id="vue的生命周期-分别作用" tabindex="-1">vue的生命周期？分别作用？ <a class="header-anchor" href="#vue的生命周期-分别作用" aria-label="Permalink to &quot;vue的生命周期？分别作用？&quot;">​</a></h2><p>Vue 实例从创建到销毁的过程，就是生命周期</p><ul><li>beforeCreate: <code>实例创建之初</code>，未初始化和响应式数据</li><li>created：<code>组件创建完成</code>, 已初始化和响应式数据；</li><li>beforMount：<code>组件挂载之前</code>, 调用render函数生成Vnode，为挂载到真实DOM；</li><li>mounted：<code>组件挂载之后</code>, Vnode挂载到真实DOM完成；</li><li>beforupdate：<code>数据变化更新之前</code>，新Vnode生成；</li><li>updated：<code>数据变化更新之后</code>, 新旧Vnode对比，打补丁，然后更新到真实DOM；</li><li>befordesitory：<code>实例销毁之前</code>, 可以访问数据；（vue3，是beforeunmount）</li><li>desitoryed：<code>实例销毁后</code>，子实例销毁，指令解绑，解绑本实例事件; （vue3，是 unmounted）</li><li>activeted: keep-alive 组件激活</li><li>deactivated: keep-alive 组件停用</li><li>errorCaptured: 捕获实例的错误</li></ul><h2 id="调用接口在那个生命周期" tabindex="-1">调用接口在那个生命周期？ <a class="header-anchor" href="#调用接口在那个生命周期" aria-label="Permalink to &quot;调用接口在那个生命周期？&quot;">​</a></h2><p>create和mount都可以(听说mount调用会存在线程阻塞的问题)</p><h2 id="获取dom在那个生命周期" tabindex="-1">获取DOM在那个生命周期？ <a class="header-anchor" href="#获取dom在那个生命周期" aria-label="Permalink to &quot;获取DOM在那个生命周期？&quot;">​</a></h2><p>Mount？因为在beforeCreated和created以及beforeMounted这几个钩子上都还没挂在到实例上，所以一般在mount钩子中去获取DOM；</p><h2 id="双向绑定原理" tabindex="-1">双向绑定原理？ <a class="header-anchor" href="#双向绑定原理" aria-label="Permalink to &quot;双向绑定原理？&quot;">​</a></h2><pre><code>采用数据劫持结合发布者-订阅者模式的方式，data数据在初始化的时候，会实例化一个Observe类，在它会将data数据进行递归遍历，并通过Object.defineProperty方法，给每个值添加上一个getter和一个setter。在数据读取的时候会触发getter进行依赖（Watcher）收集，当数据改变时，会触发setter，对刚刚收集的依赖进行触发，并且更新watcher通知视图进行渲染。
</code></pre><h2 id="虚拟dom-vnode" tabindex="-1">虚拟DOM(Vnode)? <a class="header-anchor" href="#虚拟dom-vnode" aria-label="Permalink to &quot;虚拟DOM(Vnode)?&quot;">​</a></h2><p>Vnode是一个对象，他将真实的DOM节点转换成一个对象，在Vue中每次数据更新时，新旧Vnode都会相互进行同层对比;（用js对象的形式去添加dom，更适合批量修改dom） 而diff算法会在这时去做一个优化；</p><h2 id="diff算法" tabindex="-1">Diff算法？ <a class="header-anchor" href="#diff算法" aria-label="Permalink to &quot;Diff算法？&quot;">​</a></h2><p>调用patch方法，传入新旧Vnode，开始同层对比；然后调用isSameNode方法，对比新旧Vnode是否属于同类型节点；如果不同，新节点就会替换掉旧节点；如果相同，调用patchNode进行对比节点；如果就节点没有但新节点有就新增上去，反之删除；</p><h2 id="谈谈对mvvm的理解" tabindex="-1">谈谈对MVVM的理解? <a class="header-anchor" href="#谈谈对mvvm的理解" aria-label="Permalink to &quot;谈谈对MVVM的理解?&quot;">​</a></h2><p>MVVM是一种软件架构模式，MVVM 分为 Model、View、ViewModel：</p><ul><li>Model代表数据模型，数据和业务逻辑都在Model层中定义；</li><li>View代表UI视图，负责数据的展示；</li><li>ViewModel负责监听Model中数据的改变并且控制视图的更新，处理用户交互操作；</li></ul><p>Model和View并无直接关联，而是通过ViewModel来进行联系的，Model和ViewModel之间有着双向数据绑定的联系。因此当Model中的数据改变时会触发View层的刷新，View中由于用户交互操作而改变的数据也会在Model中同步。</p><h2 id="什么mvvm-和mvc有什么区别" tabindex="-1">什么MVVM?和MVC有什么区别？ <a class="header-anchor" href="#什么mvvm-和mvc有什么区别" aria-label="Permalink to &quot;什么MVVM?和MVC有什么区别？&quot;">​</a></h2><p>MVC模型：包括view视图层、controller控制层、model数据层。各部分之间的通信都是单向的； View 传送指令到 Controller Controller 完成业务逻辑后，要求 Model 改变状态 Model 将新的数据发送到 View，用户得到反馈 MVVM：包括view视图层、model数据层、viewmodel层。各部分通信都是双向的；</p><p>viewModel通过双向数据绑定把view层和Model层连接了起来</p><h2 id="computed和watch区别" tabindex="-1">Computed和watch区别？ <a class="header-anchor" href="#computed和watch区别" aria-label="Permalink to &quot;Computed和watch区别？&quot;">​</a></h2><ul><li>computed计算属性，通过对已有的属性值进行计算得到一个新值。它需要依赖于其他的数据，当数据发生变化时，computed会自动计算更新。computed属性值会被缓存，只有当依赖数据发生变化时才会重新计算，这样可以避免重复计算提高性能。</li><li>watch用于监听数据的变化，并在变化时执行一些操作。它可以监听单个数据或者数组，当数据发生变化时会执行对应的回调函数，和computed不同的是watch不会有缓存。</li><li>Computed依赖多个属性进行计算，具备缓存,在依赖值不变的情况下可以复用;只能同步；</li><li>Watch通常监听一个数变化，可以使用异步；</li></ul><h2 id="vue组件通信" tabindex="-1">vue组件通信？ <a class="header-anchor" href="#vue组件通信" aria-label="Permalink to &quot;vue组件通信？&quot;">​</a></h2><ul><li>父传子：子组件通过props来接收父组件传过来的值；</li><li>子传父：子组件通过$emit对父组件进行传值;</li><li>父子之间通过$parent和$children获取实例进行通信；</li><li>兄弟组件: EventbBus</li><li>隔代传: $attrs $listeners</li><li>Vuex进行状态管理；</li><li>路由传值；</li><li>LocalStorage，sessionStorage；</li><li>通过provide和inject(官方不建议使用);</li><li>$ref获取实例，进行传值；</li></ul><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>  class Bus {</span></span>
<span class="line"><span>    constructor () {</span></span>
<span class="line"><span>      this.callback = {} //存放事件的名称</span></span>
<span class="line"><span>    }</span></span>
<span class="line"><span></span></span>
<span class="line"><span>    $on (name, fn) {</span></span>
<span class="line"><span>      this.callback[name] = this.callback[name] || []</span></span>
<span class="line"><span>      this.callback[name].push(fn)</span></span>
<span class="line"><span>    }</span></span>
<span class="line"><span></span></span>
<span class="line"><span>    $emit (name, args) {</span></span>
<span class="line"><span>      if (this.callback[name]) {</span></span>
<span class="line"><span>        this.callback[name].forEach((item) =&gt; {</span></span>
<span class="line"><span>          item(args)</span></span>
<span class="line"><span>        })</span></span>
<span class="line"><span>      }</span></span>
<span class="line"><span>    } </span></span>
<span class="line"><span>  }</span></span></code></pre></div><h2 id="v-if和v-show的区别" tabindex="-1">v-if和v-show的区别？ <a class="header-anchor" href="#v-if和v-show的区别" aria-label="Permalink to &quot;v-if和v-show的区别？&quot;">​</a></h2><p>两者都是判断是否显示元素的东西； 但是v-show是通过display：none这样一个东西，只做显示隐藏，dom只会渲染一次； 而v-if显示渲染页面节点，隐藏删除页面节点。 一般不频繁的显隐操作用v-show，反之用v-if；</p><h2 id="v-if和v-for" tabindex="-1">v-if和v-for？ <a class="header-anchor" href="#v-if和v-for" aria-label="Permalink to &quot;v-if和v-for？&quot;">​</a></h2><p>for遍历数组元素，if是判断数组元素；官方文档不建议两者同时在一个元素上作用； 因为for的优先级比if高，这样每一次遍历都要去判断一下这个if，比较浪费资源； 可以在使用template标签包在v-for外面，使用v-if</p><h2 id="vue2和vue3的区别" tabindex="-1">vue2和vue3的区别？ <a class="header-anchor" href="#vue2和vue3的区别" aria-label="Permalink to &quot;vue2和vue3的区别？&quot;">​</a></h2><ul><li>Vue2使用的是optionsAPI ，Vue3使用composition API，更好的组织代码，提高代码可维护性</li><li>Vue3使用Proxy代理实现了新的响应式系统，比Vue2(Object.defindProroties())有着更好的性能和更准确的数据变化追踪能力。</li><li>Vue3引入了Teleprot组件，可以将DOM元素渲染到DOM数的其他位置，用于创建模态框、弹出框等。</li><li>Vue3全局API名称发生了变化，同时新增了watchEffect、Hooks等功能</li><li>Vue3对TypeScript的支持更加友好</li><li>Vue3核心库的依赖更少，减少打包体积</li><li>Vue3支持更好的Tree Shanking，可以更加精确的按需要引入模块 封装组件有没有遇到过什么难点？</li></ul><h2 id="常用属性-指令-事件修饰符有哪些" tabindex="-1">常用属性/指令/事件修饰符有哪些？ <a class="header-anchor" href="#常用属性-指令-事件修饰符有哪些" aria-label="Permalink to &quot;常用属性/指令/事件修饰符有哪些？&quot;">​</a></h2><p>属性： data：用于定义组件的初始数据。 props：用于传递数据给子组件。 computed：用于定义计算属性。 methods：用于定义组件的方法。 watch：用于监听组件的数据变化。 components：用于注册子组件。可以通过 components 属性将其他组件注册为当前组件的子组件，从而在模板中使用这些子组件。 指令：</p><p>v-if：条件渲染指令，根据表达式的真假来决定是否渲染元素。 v-show：条件显示指令，根据表达式的真假来决定元素的显示和隐藏。 v-for：列表渲染指令，用于根据数据源循环渲染元素列表。 v-bind：属性绑定指令，用于动态绑定元素属性到 Vue 实例的数据。 v-on：事件绑定指令，用于监听 DOM 事件，并执行对应的 Vue 方法。 v-model：双向数据绑定指令，用于在表单元素和 Vue 实例的数据之间建立双向绑定关系。 v-text：文本插值指令，用于将数据插入到元素的文本内容中。 v-html：HTML 插值指令，用于将数据作为 HTML 解析并插入到元素中。</p><p>修饰符 .Stop: 阻止冒泡 .capture: 与事件冒泡的方向相反，事件捕获由外到内； .prevent：阻止默认事件 .once：只运行一次； .self: 只会触发自己范围内的事件，不包含子元素</p><p>.number:转数字 .trim：去除首位空格 .native：绑定在自定义组件上时，确保能执行 .sync：建华子修父值的步骤；</p><h2 id="data为什么是个函数" tabindex="-1">Data为什么是个函数？ <a class="header-anchor" href="#data为什么是个函数" aria-label="Permalink to &quot;Data为什么是个函数？&quot;">​</a></h2><p>为了防止组件在多个页面使用时造成变量污染； 因为组件是可以复用的,如果组件 data 是一个对象,那么子组件中的 data 属性值会互相污染,产生副作用。</p><p>因为对象是一个引用类型，如果data是一个对象的情况下会造成多个组件共用一个data，data为一个函数，每个组件都会有自己的私有数据空间，不会干扰其他组件的运行。</p><h2 id="scope" tabindex="-1">Scope？ <a class="header-anchor" href="#scope" aria-label="Permalink to &quot;Scope？&quot;">​</a></h2><p>style上加scoped, 组件内的样式只在当前vue组件生效,实现组件的私有化，不对全局造成样式污染 原理：在此组件的标签上加上一个随机生成的data-v开头的属性,而且必须是当前组件的元素, 才会有这个自定义属性,</p><h2 id="vue的目录结构" tabindex="-1">Vue的目录结构？ <a class="header-anchor" href="#vue的目录结构" aria-label="Permalink to &quot;Vue的目录结构？&quot;">​</a></h2><p>Vue.config.js;src;public;package.json;readme.md;node_modules;</p><h2 id="v-for为什么要使用key" tabindex="-1">V-for为什么要使用key? <a class="header-anchor" href="#v-for为什么要使用key" aria-label="Permalink to &quot;V-for为什么要使用key?&quot;">​</a></h2><p>key的作用是为了在diff算法执行时更快的找到对应的节点，提高diff速度，更高效的更新虚拟DOM;</p><h2 id="ssr" tabindex="-1">SSR? <a class="header-anchor" href="#ssr" aria-label="Permalink to &quot;SSR?&quot;">​</a></h2><p>SSR(服务端渲染，框架有个neuxt，好像是叫这个名字)； 由于是在服务端将数据填充进HTML之后在推送到浏览器，所以有利于SEO的爬取；而且首屏加载比较块；</p><h2 id="nexttick原理及作用" tabindex="-1">$nextTick原理及作用? <a class="header-anchor" href="#nexttick原理及作用" aria-label="Permalink to &quot;$nextTick原理及作用?&quot;">​</a></h2><p>Vue 的 nextTick 其本质是对 JavaScript 执行原理 EventLoop 的一种应用。 nextTick是将回调函数放到一个异步队列中，保证在异步更新DOM的watcher后面，从而获取到更新后的DOM。 因为在created()钩子函数中，页面的DOM还未渲染，这时候也没办法操作DOM，所以，此时如果想要操作DOM，必须将操作的代码放在nextTick()的回调函数中。</p><h2 id="v-model原理" tabindex="-1">V-model原理？ <a class="header-anchor" href="#v-model原理" aria-label="Permalink to &quot;V-model原理？&quot;">​</a></h2><ul><li>当作用在表单上：通过v-bind:value绑定数据，v-on:input来监听数据变化并修改value</li><li>当作用在组件上：本质上是一个父子通信语法糖，通过props和$emit实现。</li></ul><h2 id="说说你对-spa-单页面的理解-它的优缺点分别是什么" tabindex="-1">说说你对 SPA 单页面的理解，它的优缺点分别是什么？ <a class="header-anchor" href="#说说你对-spa-单页面的理解-它的优缺点分别是什么" aria-label="Permalink to &quot;说说你对 SPA 单页面的理解，它的优缺点分别是什么？&quot;">​</a></h2><p>SPA（ single-page application ） 仅在 Web 页面初始化时加载相应的 HTML、JavaScript 和 CSS。 一旦页面加载完成，SPA 不会因为用户的操作而进行页面的重新加载或跳转； 取而代之的是利用路由机制实现 HTML 内容的变换，UI 与用户的交互， 避免页面的重新加载 优点： • 用户体验好、避免了不必要的跳转和重复渲染； • SPA 相对对服务器压力小； • 前后端职责分离，架构清晰，前端进行交互逻辑，后端负责数据处理； 缺点： • 初次加载耗时多：部分页面按需加载； • 前进后退路由管理：不能使用浏览器的前进后退功能，所有的页面切换需要自己建立堆栈管理； • SEO 难度较大：</p><h2 id="spa和多页面有什么区别" tabindex="-1">SPA和多页面有什么区别 <a class="header-anchor" href="#spa和多页面有什么区别" aria-label="Permalink to &quot;SPA和多页面有什么区别&quot;">​</a></h2><ul><li><p>区别</p><ul><li><strong>页面加载方式</strong>：在多页面应用中，每个页面都是独立的 HTML 文件，每次导航时需要重新加载整个页面。而在 SPA 中，初始加载时只加载一个 HTML 页面，后续的导航通过 JavaScript 动态地更新页面内容，无需重新加载整个页面。</li><li><strong>用户体验</strong>：SPA 提供了流畅、快速的用户体验，因为页面切换时无需等待整个页面的重新加载，只有需要的数据和资源会被加载，减少了页面刷新的延迟。多页面应用则可能会有页面刷新的延迟，给用户带来较长的等待时间。</li><li><strong>代码复用</strong>：SPA 通常采用组件化开发的方式，可以在不同的页面中复用组件，提高代码的可维护性和可扩展性。多页面应用的每个页面都是独立的，组件复用的机会较少。</li><li><strong>路由管理</strong>：在多页面应用中，页面之间的导航和路由由服务器处理，每个页面对应一个不同的 URL。而在 SPA 中，前端负责管理页面的导航和路由，通过前端路由库（如 React Router 或 Vue Router）来管理不同路径对应的组件。</li><li><strong>SEO（搜索引擎优</strong>：由于多页面应用的每个页面都是独立的 HTML 文件，搜索引擎可以直接索引和抓取每个页面的内容，有利于搜索引擎优化。相比之下，SPA 的内容是通过 JavaScript 动态生成的，搜索引擎的爬虫可能无法正确地获取和索引页面的内容，需要采取额外的优化措施。</li><li><strong>服务器负载</strong>：SPA 只需初始加载时获取 HTML、CSS 和 JavaScript 文件，后续的页面更新和数据获取通常通过 API 请求完成，减轻了服务器的负载。而多页面应用每次导航都需要从服务器获取整个页面的内容。</li></ul></li><li><p>优点</p><ul><li>用户体验：SPA 提供了流畅、快速的用户体验，在页面加载后，只有需要的数据和资源会被加载，减少了页面刷新的延迟。</li><li>响应式交互：由于 SPA 依赖于异步数据加载和前端路由，可以实现实时更新和动态加载内容，使用户可以快速地与应用程序交互。</li><li>代码复用：SPA 通常采用组件化开发的方式，提高了代码的可维护性和可扩展性。 服务器负载较低：由于只有初始页面加载时需要从服务器获取 HTML、CSS 和 JavaScript 文件，减轻了服务器的负载。</li></ul></li><li><p>缺点：</p><ul><li>首次加载时间：SPA 首次加载时需要下载较大的 JavaScript 文件，这可能导致初始加载时间较长。</li><li>SEO（搜索引擎优化）问题：由于 SPA 的内容是通过 JavaScript 动态生成的，搜索引擎的爬虫可能无法正确地获取和索引页面的内容。</li><li>内存占用：SPA 在用户浏览应用程序时保持单个页面的状态，这可能导致较高的内存占用。</li><li>安全性：由于 SPA 通常使用 API 进行数据获取，因此需要特别注意安全性。</li></ul></li></ul><h2 id="父子组件渲染过程调用的钩子" tabindex="-1">父子组件渲染过程调用的钩子？ <a class="header-anchor" href="#父子组件渲染过程调用的钩子" aria-label="Permalink to &quot;父子组件渲染过程调用的钩子？&quot;">​</a></h2><p>父beforeCreated-&gt;父created-&gt;父beforeMounted-&gt;子beforeCreated-&gt;子created-&gt;子beforeMounted-&gt;子mount-&gt;父mount 如何计算白屏时间跟首屏时间？ 白屏时间：输入url回车-&gt;浏览器第一个元素出现； 首屏时间：输入url回车-&gt;浏览器第一屏渲染完成；</p><h2 id="单线数据流" tabindex="-1">单线数据流？ <a class="header-anchor" href="#单线数据流" aria-label="Permalink to &quot;单线数据流？&quot;">​</a></h2><p>父子 prop 之间形成了一个单向下行绑定，父级 prop 的更新会向下流动到子组件中，额外的，每次父级组件发生变更时，子组件中所有的 prop 都将会刷新为最新的值。</p><h2 id="package-jons里面有些什么" tabindex="-1">Package.jons里面有些什么？ <a class="header-anchor" href="#package-jons里面有些什么" aria-label="Permalink to &quot;Package.jons里面有些什么？&quot;">​</a></h2><p>Name: 项目名；script：运行的脚本；version：版本号；dependencies：生产环境配置包；devDependencies：开发环境配置包；private：发布到npm的配置字段(避免私有库发布到npm)</p><h2 id="为什么使用vuex" tabindex="-1">为什么使用vuex? <a class="header-anchor" href="#为什么使用vuex" aria-label="Permalink to &quot;为什么使用vuex?&quot;">​</a></h2><p>是 Vue 全局状态管理的一个工具(现在又新出了Pinia)； 进行统一的状态管理，解决不同组件共享数据的问题。 不同视图需要变更同一状态的问题。 使用vuex之后，状态变化更加清晰。</p><h2 id="vuex属性" tabindex="-1">vuex属性？ <a class="header-anchor" href="#vuex属性" aria-label="Permalink to &quot;vuex属性？&quot;">​</a></h2><ul><li>State: 一些公共的参数定义的地方；</li><li>Mutation： 用于修改State里面的状态；只能同步</li><li>Action：用于异步提交；</li><li>Modules：模块化管理；</li></ul><h2 id="_1-vuex中数据丢失" tabindex="-1">1. Vuex中数据丢失？ <a class="header-anchor" href="#_1-vuex中数据丢失" aria-label="Permalink to &quot;1.	Vuex中数据丢失？&quot;">​</a></h2><p>可以把一些数据存入到localStoreage里面；或者使用插件做数据持久化；如：vuex-persistedstate、vuex-along等等;</p><h2 id="_2-action和mutation" tabindex="-1">2. Action和mutation？ <a class="header-anchor" href="#_2-action和mutation" aria-label="Permalink to &quot;2.	Action和mutation？&quot;">​</a></h2><p>Action可以异步操作也可以同步，mutation只能同步操作；</p><h2 id="_3-与pinia区别" tabindex="-1">3. 与pinia区别？ <a class="header-anchor" href="#_3-与pinia区别" aria-label="Permalink to &quot;3.	与pinia区别？&quot;">​</a></h2><p>没用过，主要区别就是将vuex的action和mutations合并；不在区别；</p><h2 id="_4-mutation和action为什么分开" tabindex="-1">4. Mutation和action为什么分开？ <a class="header-anchor" href="#_4-mutation和action为什么分开" aria-label="Permalink to &quot;4.	Mutation和action为什么分开？&quot;">​</a></h2><p>为了代码更容易管理(其实之前vuex对这两块有些歧义，原因是必须得返回一个数据，如果返回得是promise，那么不知道是用这个promise作为数据还是等promise成功之后。其实pinia已经解决了，现在可以同步也可以异步)</p><p>响应式属性vs非响应式属性 响应式属性 组件实例化初就有的属性：data， props， computed 响应式属性的改变会触发视图的更新 响应式属性在定义的时候有setter监视属性 非响应式属性 组件实力初始化的时候没有，后期添加的属性： 通常是给data中的某一对象添加的属性 属性的改变不会触发视图的更新 非响应式属性没有setter方法 如何定义一个响应式属性 Vue.set(target, propertyName,value) this.$set(target, propertyName,value)</p><h2 id="vue和react的区别" tabindex="-1">vue和react的区别? <a class="header-anchor" href="#vue和react的区别" aria-label="Permalink to &quot;vue和react的区别?&quot;">​</a></h2><ul><li><p>不同：</p><ul><li>模版语法不同，react采用JSX语法，vue使用基于HTML的模版语法</li><li>数据绑定不同，vue 使用双向数据绑定，react 则需要手动控制组件的状态和属性。</li><li>状态管理不同，vue使用vuex状态管理，react使用redux状态管理</li><li>组件通信不同，vue使用props和事件的方式进行父子组件通信，react则通过props和回调函数的方式进行通信。</li><li>生命周期不同，vue有8个生命周期钩子，react有10个</li><li>响应式原理不同，vue使用双向绑定来实现数据更新，react则通过单向数据流来实现</li></ul></li><li><p>相同：</p><ul><li>组件化开发：Vue 和 React 都采用了组件化开发的方式，将用户界面划分为独立、可复用的组件，从而使代码更加模块化、可维护和可扩展。</li><li>虚拟 DOM：Vue 和 React 都使用虚拟 DOM 技术，通过在 JavaScript 和真实 DOM 之间建立一个轻量级的虚拟 DOM 层，实现高效的 DOM 更新和渲染。</li><li>响应式更新：Vue 和 React 都支持响应式更新，即当数据发生变化时，会自动更新相关的组件和视图，以保持用户界面的同步性。</li><li>集成能力：Vue 和 React 都具有良好的集成能力，可以与其他库和框架进行整合，例如 Vue 可以与 Vuex、Vue Router 等配套使用，React 可以与 Redux、React Router 等配套使用。</li></ul></li></ul><h2 id="vue中key值的作用" tabindex="-1">vue中key值的作用? <a class="header-anchor" href="#vue中key值的作用" aria-label="Permalink to &quot;vue中key值的作用?&quot;">​</a></h2><p>key 是为 Vue 中 vnode 的唯一标记， 通过这个 key，我们的 diff 操作可以更准确、更快速</p><h2 id="ref的作用" tabindex="-1">ref的作用 <a class="header-anchor" href="#ref的作用" aria-label="Permalink to &quot;ref的作用&quot;">​</a></h2><p>获取dom元素 this.$refs.box 获取子组件中的data this.$refs.box.msg 调用子组件中的方法 this.$refs.box.open()</p><h2 id="vue路由的两种模式" tabindex="-1">vue路由的两种模式? <a class="header-anchor" href="#vue路由的两种模式" aria-label="Permalink to &quot;vue路由的两种模式?&quot;">​</a></h2><ul><li><p>hash模式</p><ul><li>开发中默认的模式，地址栏URL后携带#，后面为路由。</li><li>原理是通过onhashchange()事件监听hash值变化，在页面hash值发生变化后，window就可以监听到事件改变，并按照规则加载相应的代码。hash值变化对应的URL都会被记录下来，这样就能实现浏览器历史页面前进后退。</li></ul></li><li><p>history模式</p><ul><li>history模式中URL没有#，这样相对hash模式更好看，但是需要后台配置支持。</li><li>history原理是使用HTML5 history提供的pushState、replaceState两个API，用于浏览器记录历史浏览栈，并且在修改URL时不会触发页面刷新和后台数据请求。</li></ul></li></ul><h2 id="路由传参方式" tabindex="-1">路由传参方式 <a class="header-anchor" href="#路由传参方式" aria-label="Permalink to &quot;路由传参方式&quot;">​</a></h2><p>query params，必须使用占位符声明接收params参数，传参时使用对象写法，只能用name不能用path 路由中的props配置 props:{id:‘666’} 只能传递死数据 props：true， 只能使用pramas传参有效 props($route){return { id:$router.query.id}} 可以使用query传参</p><h2 id="如何设置动态路由" tabindex="-1">如何设置动态路由 <a class="header-anchor" href="#如何设置动态路由" aria-label="Permalink to &quot;如何设置动态路由&quot;">​</a></h2><p>params传参</p><pre><code>路由配置： /index/:id
路由跳转：this.$router.push({name: &#39;index&#39;, params: {id: &quot;zs&quot;}});
路由参数获取：$route.params.id
最后形成的路由：/index/zs
</code></pre><p>query传参</p><pre><code>路由配置：/index正常的路由配置
路由跳转：this.$rouetr.push({path: &#39;index&#39;, query:{id: &quot;zs&quot;}});
路由参数获取：$route.query.id
最后形成的路由：/index?id=zs
</code></pre><p>区别</p><pre><code>获取参数方式不一样，一个通过$route.params，一个通过 $route.query
参数的生命周期不一样，query参数在URL地址栏中显示不容易丢失，params参数不会在地址栏显示，刷新后会消失
</code></pre><h2 id="router和-route的区别" tabindex="-1">$router和$route的区别? <a class="header-anchor" href="#router和-route的区别" aria-label="Permalink to &quot;$router和$route的区别?&quot;">​</a></h2><ul><li>$route是 <code>路由信息对象</code>,包括path, params, hash, query, fullPath, matched, name等路由信息参数</li><li>$router是<code>路由实例对象</code>包括路由的跳转方法,钩子函数等</li></ul><h2 id="vue模版编译原理" tabindex="-1">Vue模版编译原理 <a class="header-anchor" href="#vue模版编译原理" aria-label="Permalink to &quot;Vue模版编译原理&quot;">​</a></h2><p>模版编译主要过程：template ---&gt; ast ---&gt; render，分别对象三个方法</p><p>parse 函数解析 template optimize 函数优化静态内容 generate 函数创建 render 函数字符串</p><p>调用parse方法，将template转化为AST（抽象语法树），AST定义了三种类型，一种html标签，一种文本，一种插值表达式，并且通过 children 这个字段层层嵌套形成了树状的结构。 optimize方法对AST树进行静态内容优化，分析出哪些是静态节点，给其打一个标记，为后续更新渲染可以直接跳过静态节点做优化。 generate将AST抽象语法树编译成 render字符串，最后通过new Function(render)生成可执行的render函数 Vuex</p><h2 id="vuex-的原理" tabindex="-1">Vuex 的原理 <a class="header-anchor" href="#vuex-的原理" aria-label="Permalink to &quot;Vuex 的原理&quot;">​</a></h2><p>Vuex是专门为Vue设计的状态管理，当Vue从store中读取数据后，数据发生改变，组件中的数据也会发生变化。</p><p>Vue Components 负责接收用户操作交互行为，执行dispatch触发对应的action进行回应 dispatch唯一能执行action的方法 action用来接收components的交互行为，包含异步同步操作 commit对mutation进行提交，唯一能执行mutation的方法 mutation唯一可以修改state状态的方法 state页面状态管理容器，用于存储状态 getters读取state方法</p><p>Vue组件接收交互行为，调用dispatch方法触发action相关处理，若页面状态需要改变，则调用commit方法提交mutation修改state，通过getters获取到state新值，重新渲染Vue Components，界面随之更新。</p><h2 id="vuex中action和mutation的区别" tabindex="-1">Vuex中action和mutation的区别 <a class="header-anchor" href="#vuex中action和mutation的区别" aria-label="Permalink to &quot;Vuex中action和mutation的区别&quot;">​</a></h2><p>mutation更专注于修改state，必须是同步执行。 action提交的是mutation，而不是直接更新数据，可以是异步的，如业务代码，异步请求。 action可以包含多个mutation</p><h2 id="vuex-和-localstorage-的区别" tabindex="-1">Vuex 和 localStorage 的区别 <a class="header-anchor" href="#vuex-和-localstorage-的区别" aria-label="Permalink to &quot;Vuex 和 localStorage 的区别&quot;">​</a></h2><p>Vuex存储在内存中，页面关闭刷新就会消失。而localstorage存储在本地，读取内存比读取硬盘速度要快 Vuex应用于组件之间的传值，localstorage主要用于不同页面之间的传递 Vuex是响应式的，localstorage需要刷新</p><p>虚拟DOM</p><h2 id="对虚拟dom的理解" tabindex="-1">对虚拟DOM的理解 <a class="header-anchor" href="#对虚拟dom的理解" aria-label="Permalink to &quot;对虚拟DOM的理解&quot;">​</a></h2><p>虚拟DOM就是用JS对象来表述DOM节点，是对真实DOM的一层抽象。可以通过一些列操作使这个棵树映射到真实DOM上。 如在Vue中，会把代码转换为虚拟DOM，在最终渲染到页面，在每次数据发生变化前，都会缓存一份虚拟DOM，通过diff算法来对比新旧虚拟DOM记录到一个对象中按需更新，最后创建真实DOM，从而提升页面渲染性能。</p><h2 id="虚拟dom就一定比真实dom更快吗" tabindex="-1">虚拟DOM就一定比真实DOM更快吗 <a class="header-anchor" href="#虚拟dom就一定比真实dom更快吗" aria-label="Permalink to &quot;虚拟DOM就一定比真实DOM更快吗&quot;">​</a></h2><p>虚拟DOM不一定比真实DOM更快，而是在特定情况下可以提供更好的性能。 在复杂情况下，虚拟DOM可以比真实DOM操作更快，因为它是在内存中维护一个虚拟的DOM树，将真实DOM操作转换为对虚拟DOM的操作，然后通过diff算法找出需要更新的部分，最后只变更这部分到真实DOM就可以。在频繁变更下，它可以批量处理这些变化从而减少对真实DOM的访问和操作，减少浏览器的回流重绘，提高页面渲染性能。 而在一下简单场景下，直接操作真实DOM可能会更快，当更新操作很少或者只是局部改变时，直接操作真实DOM比操作虚拟DOM更高效，省去了虚拟DOM的计算、对比开销。</p><h2 id="虚拟dom的解析过程" tabindex="-1">虚拟DOM的解析过程 <a class="header-anchor" href="#虚拟dom的解析过程" aria-label="Permalink to &quot;虚拟DOM的解析过程&quot;">​</a></h2><p>首先对将要插入到文档中的 DOM 树结构进行分析，使用 js 对象将其表示出来，比如一个元素对象，包含 TagName、props 和 Children 这些属性。然后将这个 js 对象树给保存下来，最后再将 DOM 片段插入到文档中。 当页面的状态发生改变，需要对页面的 DOM 的结构进行调整的时候，首先根据变更的状态，重新构建起一棵对象树，然后将这棵新的对象树和旧的对象树进行比较，记录下两棵树的的差异。 最后将记录的有差异的地方应用到真正的 DOM 树中去，这样视图就更新了。</p><h2 id="diff算法原理" tabindex="-1">DIFF算法原理 <a class="header-anchor" href="#diff算法原理" aria-label="Permalink to &quot;DIFF算法原理&quot;">​</a></h2><p>diff的目的是找出差异，最小化的更新视图。 diff算法发生在视图更新阶段，当数据发生变化的时候，diff会对新旧虚拟DOM进行对比，只渲染有变化的部分。</p><p>对比是不是同类型标签，不是同类型直接替换 如果是同类型标签，执行patchVnode方法，判断新旧vnode是否相等。如果相等，直接返回。 新旧vnode不相等，需要比对新旧节点，比对原则是以新节点为主，主要分为以下几种。</p><p>newVnode 和 oldVnode都有文本节点，用新节点替换旧节点。 newVnode有子节点，oldVnode没有，新增newVnode的子节点。 newVnode没有子节点，oldVnode有子节点，删除oldVnode中的子节点。 newVnode和oldVnode都有子节点，通过updateChildren对比子节点。</p><h2 id="双端diff" tabindex="-1">双端diff <a class="header-anchor" href="#双端diff" aria-label="Permalink to &quot;双端diff&quot;">​</a></h2><p>updateChildren方法用来对比子节点是否相同，将新旧节点同级进行比对，减少比对次数。会创建4个指针，分别指向新旧两个节点的首尾，首和尾指针向中间移动。 每次对比下两个头指针指向的节点、两个尾指针指向的节点，头和尾指向的节点，是不是 key是一样的，也就是可复用的。如果是重复的，直接patch更新一下，如果是头尾节点，需要进行移动位置，结果以新节点的为主。 如果都没有可以复用的节点，就从旧的vnode中查找，然后进行移动，没有找到就插入一个新节点。 当比对结束后，此时新节点还有剩余，就批量增加，如果旧节点有剩余就批量删除。</p><h2 id="vue-router-路由守卫-导航钩子有哪些" tabindex="-1">vue-router 路由守卫/ 导航钩子有哪些? <a class="header-anchor" href="#vue-router-路由守卫-导航钩子有哪些" aria-label="Permalink to &quot;vue-router  路由守卫/  导航钩子有哪些?&quot;">​</a></h2><p>全局守卫</p><ol><li>router.beforeEach 全局前置守卫 进入路由之前</li><li>router.beforeResolve 全局解析守卫(2.5.0+) 在beforeRouteEnter调用之后调用</li><li>router.afterEach 全局后置钩子 进入路由之后</li></ol><pre><code>局部单个路由 beforeEnter

组件的钩子函数
beforeRouterEnter进入路由前
beforeRouterUpdate路由复用同一个组件时
beforeRouterLeave离开当前路由时
to 即将进入的目标对象
from 当导航要离开的导航对象
next 调用resolve 执行下一步
</code></pre><h2 id="vuex的流程" tabindex="-1">vuex的流程? <a class="header-anchor" href="#vuex的流程" aria-label="Permalink to &quot;vuex的流程?&quot;">​</a></h2><p>Vuex 是一个专为 Vue.js 应用程序开发的状态管理模式 为了解决组件间状态共享的问题, 便于维护, 便于解耦 Vuex 的 状态存储是响应式的 • State：保存共有的数据, 响应式的。 • Getter：对state进行计算操作,主要用于过滤一些数据 • Mutation：是唯一更改 store 中的数据，且必须是同步函数。 • Action：用于提交 mutation，而不是直接变更状态，可以包含任意异步操作。 • Module：模块化vuex。 使用vuex中的数据和方法： 第一种mapState/mapGetter/mapMutations/mapActions 第二种this.$store.state/this.$store.getter/this.$store.commite/this.$store.dispatch</p><p>自定义作用域插槽</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>  &lt;template  slot-scope=’scope’&gt;{{scope.row}}&lt;/template&gt;</span></span></code></pre></div><h2 id="axios是什么-怎么用-使用流程" tabindex="-1">axios是什么?怎么用,,使用流程? <a class="header-anchor" href="#axios是什么-怎么用-使用流程" aria-label="Permalink to &quot;axios是什么?怎么用,,使用流程?&quot;">​</a></h2><p>基于promise, 用于浏览器和node.js的一个http客户端 主要用于向后台发起请求的 支持promise 拦截器 提供支持csrf</p><h2 id="vue中的性能优化" tabindex="-1">vue中的性能优化 <a class="header-anchor" href="#vue中的性能优化" aria-label="Permalink to &quot;vue中的性能优化&quot;">​</a></h2><p><strong>编码阶段</strong></p><ul><li>v-if和v-for不一起使用</li><li>v-for保证key的唯一性</li><li>使用keep-alive缓存组件</li><li>v-if和v-show酌情使用</li><li>路由懒加载、异步组件</li><li>图片懒加载</li><li>节流防抖</li><li>第三方模块按需引入</li><li>服务端与渲染</li><li>key</li><li>v-show/v-if</li><li>按需加载</li><li>路由懒加载</li></ul><p><strong>打包优化</strong></p><ul><li>压缩代码</li><li>使用CDN加载第三方模块</li><li>抽离公共文件 <strong>用户体验</strong></li><li>骨架屏</li><li>客户端缓存 <strong>SEO优化</strong></li><li>预渲染</li><li>服务端渲染</li><li>合理使用 meta 标签</li></ul><p>vue.extend 和vue.component</p><p>scoped下修改第三方样式数据(深度选择器)</p><ol><li>使用深度选择器: 原生css样式-- &gt;&gt;&gt;,</li><li>在stylus，sass，less中使用 /deep/或::v-deep</li></ol><h2 id="params传参刷新参数丢失问题" tabindex="-1">params传参刷新参数丢失问题 <a class="header-anchor" href="#params传参刷新参数丢失问题" aria-label="Permalink to &quot;params传参刷新参数丢失问题&quot;">​</a></h2><p>如果在注册路由的时候没有使用占位符进行注册: ‘/home/:id’, 首次路由跳转可以获取params参数，再次刷新页面params数据丢失 注册路由的时候写好占位符</p><h2 id="vue-loader" tabindex="-1">vue-loader <a class="header-anchor" href="#vue-loader" aria-label="Permalink to &quot;vue-loader&quot;">​</a></h2><p>一个加载器, 能把 .vue 组件转化成js模块</p><h2 id="keep-alive的作用" tabindex="-1">keep-alive的作用 <a class="header-anchor" href="#keep-alive的作用" aria-label="Permalink to &quot;keep-alive的作用&quot;">​</a></h2><p>include / exclude, 允许组件有条件的缓存</p><p>keep-alive是Vue.js的一个内置组件。它能够将不活动的组件实例保存在内存中，而不是直接将其销毁，它是一个抽象组件，不会被渲染到真实DOM中，也不会出现在父组件链中。</p><p>include 字符串或正则表达式，只有名称匹配的组件会被匹配； exclude 字符串或正则表达式，任何名称匹配的组件都不会被缓存； max 数字，最多可以缓存多少组件实例。</p><p>2 个生命周期 activated ， deactivated</p><p>activated：当缓存的组件被激活时，该钩子函数被调用。可以在该钩子函数中进行一些状态恢复、数据更新等操作。 deactivated：当缓存的组件被停用时，该钩子函数被调用。可以在该钩子函数中进行一些状态保存、数据清理等操作。</p><p>keep-alive内部其实是一个函数式组件，没有template标签。在render中通过获取组件的name和include、exclude进行匹配。匹配不成功，则不需要进行缓存，直接返回该组件的vnode。 匹配成功就进行缓存，获取组件的key在cache中进行查找，如果存在，则将他原来位置上的 key 给移除，同时将这个组件的 key 放到数组最后面（LRU）也就实现了max功能。 不存在的话，就需要对组件进行缓存。将当前组件push(key)添加到尾部，然后再判断当前缓存的max是否超出指定个数，如果超出直接将第一个组件销毁（缓存淘汰策略LRU）。</p><h2 id="请说一下vue2及vue3响应式数据的理解" tabindex="-1">请说一下<code>Vue2</code>及<code>Vue3</code>响应式数据的理解 <a class="header-anchor" href="#请说一下vue2及vue3响应式数据的理解" aria-label="Permalink to &quot;请说一下\`Vue2\`及\`Vue3\`响应式数据的理解&quot;">​</a></h2><h2 id="_1、-什么叫响应式数据-可以拦截用户的获取数据的操作和设置数据的操作" tabindex="-1">1、 什么叫响应式数据，可以拦截用户的获取数据的操作和设置数据的操作 <a class="header-anchor" href="#_1、-什么叫响应式数据-可以拦截用户的获取数据的操作和设置数据的操作" aria-label="Permalink to &quot;1、 什么叫响应式数据，可以拦截用户的获取数据的操作和设置数据的操作&quot;">​</a></h2><h2 id="_2、vue2中响应式原理" tabindex="-1">2、vue2中响应式原理 <a class="header-anchor" href="#_2、vue2中响应式原理" aria-label="Permalink to &quot;2、vue2中响应式原理&quot;">​</a></h2><pre><code>Object.defineProperty对属性的读取、修改进行拦截来实现的 （缺点就是需要将整个对象递归的增加get和set\`针对的属性\`）。 vue中对象采用了defineProperty，
</code></pre><p>数组并没有采用（重写数组的7个方法），因为可能会有性能问题. 新增属性、删除属性页面不会更新 直接通过下标修改数组不会更新</p><p>-3、Vue3： 采用了proxy针对的是对象，而且不用重写某个属性 性能高 （缺点兼容性不好） -4、优化： vue2中减少层级数据嵌套 不需要响应式不要放在data中，合理使用object.freeze 尽量缓存使用过的变量</p><h2 id="双向数据绑定的原理" tabindex="-1">双向数据绑定的原理 <a class="header-anchor" href="#双向数据绑定的原理" aria-label="Permalink to &quot;双向数据绑定的原理&quot;">​</a></h2><p>采用数据劫持结合发布者-订阅者模式的方式，data数据在初始化的时候，会实例化一个Observe类，在它会将data数据进行递归遍历，并通过Object.</p><h2 id="使用-object-defineproperty-来进行数据劫持有什么缺点" tabindex="-1">使用 Object.defineProperty() 来进行数据劫持有什么缺点？ <a class="header-anchor" href="#使用-object-defineproperty-来进行数据劫持有什么缺点" aria-label="Permalink to &quot;使用 Object.defineProperty() 来进行数据劫持有什么缺点？&quot;">​</a></h2><p>该方法只能监听到数据的修改，监听不到数据的新增和删除，从而不能触发组件更新渲染。vue2中会对数组的新增删除方法push、pop、shift、unshift、splice、sort、reserve通过重写的形式，在拦截里面进行手动收集触发依赖更新。</p><h2 id="和vue3相比有什么区别" tabindex="-1">和Vue3相比有什么区别 <a class="header-anchor" href="#和vue3相比有什么区别" aria-label="Permalink to &quot;和Vue3相比有什么区别&quot;">​</a></h2><p>Vue3采用了Proxy代理的方式，Proxy是ES6引入的一个新特性，它提供了一个用于创建代理对象的构造函数。它是对整个对象的监听和拦截，可以对对象所有操作进行处理。而Object.defineProperty只能监听单个属性的读写，无法监听新增、删除等操作。</p><h2 id="vue是如何收集依赖的" tabindex="-1">Vue是如何收集依赖的？ <a class="header-anchor" href="#vue是如何收集依赖的" aria-label="Permalink to &quot;Vue是如何收集依赖的？&quot;">​</a></h2><p>依赖收集发生在defineReactive()方法中，在方法内new Dep()实例化一个Dep()实例，然后在getter中通过dep.depend()方法对数据依赖进行收集，然后在settter中通过dep.notify()通知更新。整个Dep其实就是一个观察者，吧收集的依赖存储起来，在需要的时候进行调用。在收集数据依赖的时候，会为数据创建一个Watcher，当数据发生改变通知每个Watcher，由Wathcer进行更新渲染。</p><h2 id="slot是什么-有什么作用-原理是什么" tabindex="-1">slot是什么？有什么作用？原理是什么？ <a class="header-anchor" href="#slot是什么-有什么作用-原理是什么" aria-label="Permalink to &quot;slot是什么？有什么作用？原理是什么？&quot;">​</a></h2><p>slot插槽，一般在封装组件的时候使用，在组件内不知道以那种形式来展示内容时，可以用slot来占据位置，最终展示形式由父组件以内容形式传递过来，主要分为三种：</p><ul><li>默认插槽：又名匿名插槽，当slot没有指定name属性值的时候一个默认显示插槽，一个组件内只有有一个匿名插槽。</li><li>具名插槽：带有具体名字的插槽，也就是带有name属性的slot，一个组件可以出现多个具名插槽。</li><li>作用域插槽：默认插槽、具名插槽的一个变体，可以是匿名插槽，也可以是具名插槽，该插槽的不同点是在子组件渲染作用域插槽时，可以将子组件内部的数据传递给父组件，让父组件根据子组件的传递过来的数据决定如何渲染该插槽。</li></ul><p>实现原理：当子组件vm实例化时，获取到父组件传入的slot标签的内容，存放在vm.$slot中，默认插槽为vm.$slot.default，具名插槽为vm.$slot.xxx，xxx 为插槽名，当组件执行渲染函数时候，遇到slot标签，使用$slot中的内容进行替换，此时可以为插槽传递数据，若存在数据，则可称该插槽为作用域插槽。</p><h2 id="ref和reactive区别" tabindex="-1">ref和reactive区别 <a class="header-anchor" href="#ref和reactive区别" aria-label="Permalink to &quot;ref和reactive区别&quot;">​</a></h2><p>ref：基本数据类型（object.definepropty），也可以定义对象或数组(内部也是reactive对象)，操作数据需要.value reactive:对象或数组（proxy），不需要.value setup函数 在beforecreate之前执行一次，this是undefined setup参数 props值为对象，组件外部传来，内部声明了的 context attrs值为对象，组件外部传来，没有内部声明的属性 slots插槽内容，相当于this.$slots emit 分发定义事件函数，相当于this.$emit</p><h2 id="vue-中如何检测数组变化" tabindex="-1">Vue\`中如何检测数组变化? <a class="header-anchor" href="#vue-中如何检测数组变化" aria-label="Permalink to &quot;Vue\`中如何检测数组变化?&quot;">​</a></h2><p>-1、Vue2 中采用的是重写数组的方法 通过创建一个对象，实现原型链继承。在对象身上重写了7个方法，如果在vue中定义了数组对象，我会让这个数组通过链找到我们饿创建的这个对象。 用户在数组上调用方法会触发我们重写的方法。就可以监控到数组的变化 缺陷就是没有监控数组的索引，也没有监控length属性 在vue中改变索引和长度是无法实现响应式更新页面的 -2、Vue3中的proxy天生就支持数组的拦截，所以不会出现这个问题</p><h2 id="vue-mixin的使用场景和原理" tabindex="-1"><code>Vue.mixin</code>的使用场景和原理 <a class="header-anchor" href="#vue-mixin的使用场景和原理" aria-label="Permalink to &quot;\`Vue.mixin\`的使用场景和原理&quot;">​</a></h2><ul><li>核心在于就是抽离公共逻辑， vuex和vue-router 给每个组件都增添一个$store $router 这时候就可以使用mixin ， 还有一些公共方法 都可以放在mixin里面 ， 开可以通过mixin属性来注入。 缺陷数据来源不明确，而且会产生命名冲突。</li><li>在React中最早都采用的是高阶组件，hook</li><li>Vue3 来说 就是compositionApi 组合式api （组合由于继承） Vue3中依旧可以使用mixin</li></ul><h2 id="谈一谈对vue组件化的理解" tabindex="-1">谈一谈对Vue组件化的理解 <a class="header-anchor" href="#谈一谈对vue组件化的理解" aria-label="Permalink to &quot;谈一谈对Vue组件化的理解&quot;">​</a></h2><p>vue组件化的目的 ， 为了能实现组件化更新，每个组件都有一个watcher. 可以实现组件的复用 维护起来比较方便</p><hr><h2 id="handwirteId">手写代码</h2> [go](https://juejin.cn/post/7272737742307065914?searchId=2024031016580610DF51F50356EE3F7A5C) <h2 id="实现一个new操作符" tabindex="-1">实现一个new操作符 <a class="header-anchor" href="#实现一个new操作符" aria-label="Permalink to &quot;实现一个new操作符&quot;">​</a></h2><details><summary>实现一个new操作符</summary><pre><code>
      /** 手写 new 操作符
      * 用法：创建一个实例化对象
      * 思路：
      *  1、判断传入的 fn 是否为 function
      *  2、创建一个空对象
      *  3、将这个空对象的原型设置为构造函数的 prototype 属性。
      *  4、使用 apply 执行构造函数 并传入参数 arguments 获取函数的返回值
      *  5、判断这个返回值 如果返回的是 Object || Function 类型 就返回该对象 否则返回创建的对象
      * @param {Function} fn 构造函数
      * @return {*}
      */
      function myNew(fn, ...args) {
        // 判断 fn 是否为函数
        if (typeof fn !== &#39;function&#39;) {
          return new TypeError(&#39;fn must be a function&#39;)
        }
        // 创建一个空的对象
        let obj = null
        // 将这个空对象的原型设置为构造函数的 prototype 属性。
        obj = Object.create(fn.prototype)
        // 通过 apply 执行构造函数 传入参数 获取返回值
        let result = fn.apply(obj, args)
        // 判断这个返回值 如果返回的是 Object || Function 类型 就返回该对象 否则返回创建的对象
        const flag = result &amp;&amp; (typeof result === &#39;object&#39; || typeof result === &#39;function&#39;)
        return flag ? result : obj
      }
    </code></pre></details><h2 id="实现一个intanceof操作符" tabindex="-1">实现一个intanceof操作符 <a class="header-anchor" href="#实现一个intanceof操作符" aria-label="Permalink to &quot;实现一个intanceof操作符&quot;">​</a></h2><details><summary>实现一个intanceof操作符</summary><pre><code>
      /** 手写 instanceof 方法
      * 用法：instanceof 运算符用于检测构造函数的 prototype 属性是否出现在某个实例对象的原型链上。
      * 思路：
      *  1、通过 Object.getPrototypeOf 获取 obj 的原型
      *  2、循环判断 objProtoType 是否和 constructor 的原型相等
      *    2.1、如果相等就返回 true
      *    2.2、如果不相等 就重新赋值一下 obj 的原型 进入下一次循环
      *  3、判断是 objProtoType 是否为空 如果为空就说明不存在 返回 false
      * @param {Object} obj 需要判断的数据
      * @param {Object} constructor
      * @return {*}
      */
      function myInstanceof(obj, type) {
        let objPrototype = Object.getPrototypeOf(obj)
        while (true) {
          if (!objPrototype) return false
          if (objPrototype === type.prototype) return true
          objPrototype = Object.getPrototypeOf(objPrototype)
        }
      }
    </code></pre></details><h2 id="手写-object-create" tabindex="-1">手写 Object.create <a class="header-anchor" href="#手写-object-create" aria-label="Permalink to &quot;手写 Object.create&quot;">​</a></h2><details><summary>手写 Object.create</summary><pre><code>
        /** 手写 Object.create
        * 用法：创建一个新的对象，将传入的对象原型指向新对象并返回
        * 思路：
        *  1、将原型写入到一个函数里面，然后将函数返回
        * @param {*} obj
        * @return {*} 
        */
      function myCreate(obj) {
        function F() {}
        F.prototype = obj
        return new F()
      }
    </code></pre></details><h2 id="手写-浅拷贝" tabindex="-1">手写 浅拷贝 <a class="header-anchor" href="#手写-浅拷贝" aria-label="Permalink to &quot;手写 浅拷贝&quot;">​</a></h2><details><summary>手写 浅拷贝</summary><pre><code>
      /** 浅拷贝
      * 用法：浅拷贝是指，一个新的对象对原始对象的属性值进行精确地拷贝，如果拷贝的是基本数据类型，拷贝的就是基本数据类型的值，如果是引用数据类型，拷贝的就是内存地址。如果其中一个对象的引用内存地址发生改变，另一个对象也会发生变化。
      * 思路：
      *  1、判断是否为对象
      *  2、根据obj类型创建一个新的对象
      *  3、for in 遍历对象 拿到 key
      *  4、判断 key 是否在 obj 中
      *  5、将 key 作为新对象的key 并赋值 value
      *
      * @param {*} obj
      * @return {*} 
      */
    function shallowCopy(obj) {
      // 只拷贝对象
      if (!obj || typeof obj !== &#39;object&#39;) {
        return obj
      }
      // 新的对象
      const newObj = Array.isArray(obj) ? [] : {}
      // 循环遍历 obj 将 key 作为 newObj 的 key 并赋值value
      for (const key in obj) {
        // 判断 key 是否在 obj 中
        if (obj.hasOwnProperty(key)) {
          newObj[key] = obj[key]
        }
      }
      return newObj
    }
    </code></pre></details><h2 id="手写-深拷贝" tabindex="-1">手写 深拷贝 <a class="header-anchor" href="#手写-深拷贝" aria-label="Permalink to &quot;手写 深拷贝&quot;">​</a></h2><details><summary>手写 深拷贝</summary><pre><code>
      /** 深拷贝
      * 用法：拷贝一个对象的属性值 如果遇到属性值为引用类型的时候，它新建一个引用类型并将对应的值复制给它，因此对象获得的一个新的引用类型而不是一个原有类型的引用
      * 思路：
      *  1、判断是否为对象
      *  2、判段对象是否在 map 中 如果存在就不需要操作
      *  3、将 obj 放入 map 中 避免重复引用
      *  4、for in 遍历对象 拿到 key 判断 key 是否在 obj 中
      *  5、value 如果为对象 就递归拷贝 否则就赋值
      * @param {*} obj
      * @param {*} [map=new Map()]
      * @return {*} 
      */
    function deepCopy(obj, map = new Map()){
      if (!obj || typeof obj !== &#39;object&#39;){
        return obj
      }
      // 判断 obj 是否在 map 中存在 如果存在就不需要递归调用 直接返回数据
      if (map.get(obj)) {
        return map.get(obj)
      }
      const newObj = Array.isArray(obj) ? [] : {}
      // 放入 map 中 记录当前对象 避免重复拷贝 循环引用
      map.set(obj, newObj)
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          // 如果 value 还是一个对象 递归获取 否则就赋值
          newObj[key] = typeof obj[key] === &#39;object&#39; ? deepCopy(obj[key], map) : obj[key]
        }
      }
      return newObj
    }
    </code></pre></details><h2 id="手写-节流" tabindex="-1">手写 节流 <a class="header-anchor" href="#手写-节流" aria-label="Permalink to &quot;手写 节流&quot;">​</a></h2><details><summary>手写 节流</summary><pre><code>
      /** 手写节流
      * 用法：函数在 n 秒内只执行一次，如果多次触发，则忽略执行。
      * 思路：
      *  1、记录函数上一次执行的时间戳 startTime
      *  2、返回一个闭包函数 当被调用时会记录一下执行时间 nowTime
      *  3、比较两次执行时间间隔 是否超过了 wait 时间
      *  4、如果是大于 wait 时间 说明已经过了一个 wait 时间 可以执行函数
      *    4.1、更新 startTime 方便下次对比
      *    4.2、通过 apply 执行函数fn 传入 arguments 参数
      *  5、如果没有超过 wait 时间  说明是在 wait 时间内又执行了一次  忽略
      * @param {Function} fn 执行函数
      * @param {Number} wait 等待时间
      * @return {*} 
      */
    function throttle(fn, wait) {
      let startTime = Date.now()
      return function () {
        const nowTime = Date.now()
        // 计算两次执行的间隔时间 是否大于 wait 时间
        if (nowTime - startTime &gt;= wait) {
          startTime = nowTime
          return fn.apply(this, arguments)
        }
      }
    }
    </code></pre></details><h2 id="手写-防抖" tabindex="-1">手写 防抖 <a class="header-anchor" href="#手写-防抖" aria-label="Permalink to &quot;手写 防抖&quot;">​</a></h2><details><summary>手写 防抖</summary><pre><code>
    /** 手写防抖
      * 用法：函数在 n 秒后再执行，如果 n 秒内被触发，重新计时，保证最后一次触发事件 n 秒后才执行。
      * 思路：
      *  1、保存一个变量 timer
      *  2、返回一个闭包函数 函数内判断一下 timer 是否有值
      *    2.1、如果有值 说明 定时器已经开启 需要将定时器清空
      *  3、设置定时器 等待 wait 后执行 将定时器赋值给 timer 记录
      *  4、通过 apply 执行函数 传入 arguments
      * @param {*} fn
      * @param {*} wait
      * @param {boolean} [immediate=false]
      * @return {*} 
      */
    function debounce(fn, wait, immediate = false) {
      let timer = null
      return function () {
        // 存在定时器 清空
        if (timer) {
          clearInterval(timer)
          timer = null
        }
        // 立即执行
        if (immediate) {
          // 判断是否执行过  如果执行过 timer 不为空
          const flag = !timer
          // 执行函数
          flag &amp;&amp; fn.apply(this, arguments)
          // n 秒后清空定时器
          timer = setTimeout(() =&gt; {
            timer = null
          }, wait)
        } else {
          timer = setTimeout(() =&gt; {
            fn.apply(this, arguments)
          }, wait)
        }
      }
    }
    </code></pre></details><h2 id="函数柯里化" tabindex="-1">函数柯里化 <a class="header-anchor" href="#函数柯里化" aria-label="Permalink to &quot;函数柯里化&quot;">​</a></h2><details><summary>函数柯里化</summary><pre><code>
      /** 函数柯里化
      * 用法：函数柯里化是一种将接受多个参数的函数转换为接受一系列单一参数的函数的技术
      * 思路：
      *  1、使用 fn.length 获取函数的形参数量
      *  2、如果没有传入初始参数数组 则将其初始化为空数组 在递归的时候会接受上一次的形参
      *  3、返回一个闭包函数 接受函数的实参 将 args 中的形参和当前的形参进行合并 得到 newArgs
      *  4、如果新的参数数组 newArgs 长度大于等于 length 函数的形参数量 调用 apply 执行函数 传入 newArgs
      *  5、如果新的参数数组长度小于函数的形参数量 则再次调用 curry 函数 将新的参数数组作为初始参数传入 返回一个新的闭包函数
      * @param {*} fn
      * @param {*} args
      * @return {*} 
      */
    function curry(fn, args) {
      // 获取 fn 获取 add 函数的形参数量
      const length = fn.length
      // 递归执行时传递的上一次参数 第一次执行 [] 第二次执行 [1]
      args = args || []
      return function () {
        // 将上一次参数和这次的参数进行合并  得到新的参数数组
        const newArgs = [...args, ...arguments]
        // 判断 newArgs 长度是否和 add 函数形参长度一致 如果超过就执行 fn 函数 传递 newArgs
        if (newArgs.length &gt;= length) {
          return fn.apply(this, newArgs)
        } else {
          // 小于 add 函数形参长度 递归调用 curry 函数 累积参数 传递 newArgs
          return curry(fn, newArgs)
        }
      }
    }
    </code></pre></details><h2 id="手写-call" tabindex="-1">手写 call <a class="header-anchor" href="#手写-call" aria-label="Permalink to &quot;手写 call&quot;">​</a></h2><details><summary>手写 call</summary><pre><code>
      /** 手写 call
      * 用法：call 方法用于调用一个函数，并指定函数内部 this 的指向，传入一个对象
      * 思路：
      *  1、判断 this 是否指向一个函数  只有函数才可以执行
      *  2、获取传入的 context 上下文 也就是我们要指向的 如果不存在就指向 window
      *  3、将当前 this 也就是外部需要执行的函数 绑定到 context 上 然后执行获取 result 传入 ...args 确保参数位置正确
      *  4、删除 context 对象的 fn 属性 并将 result 返回
      */
    Function.prototype.myCall = function (context, ...args) {
      if (typeof this !== &#39;function&#39;) {
        return new TypeError(&#39;type error&#39;)
      }
      context = context || window
      // 缓存this
      context.fn = this
      const result = context.fn(...args)
      delete context.fn
      return result
    }
    </code></pre></details><h2 id="手写-promise" tabindex="-1">手写 Promise <a class="header-anchor" href="#手写-promise" aria-label="Permalink to &quot;手写 Promise&quot;">​</a></h2><details><summary>手写 Promise</summary><pre><code>
      class MyPromise {
        constructor(executor) {
          this.state = &#39;pending&#39;
          this.value
          this.reason
          this.onResolveCallbacks = []
          this.onRejectCallbacks = []
          const resolve = (value) =&gt; {
            if (this.state === &#39;pending&#39;) {
              this.value = value
              this.state = &#39;fulfilled&#39;
              this.onResolveCallbacks.forEach((fn) =&gt; fn())
            }
          }
          const reject = (reason) =&gt; {
            if (this.state === &#39;pending&#39;) {
              this.reason = reason
              this.state = &#39;rejected&#39;
              this.onRejectCallbacks.forEach((fn) =&gt; fn())
            }
          }
          try {
            executor(resolve, reject)
          } catch (error) {
            reject(error)
          }
        }
        then(onFulfilled, onRejected) {
          // 判断类型
          onFulfilled = typeof onFulfilled === &#39;function&#39; ? onFulfilled : (value) =&gt; value
          onRejected =
            typeof onRejected === &#39;function&#39;
              ? onRejected
              : (reason) =&gt; {
                  throw reason
                }
          const p2 = new MyPromise((resolve, reject) =&gt; {
            // 执行成功
            // 执行失败
            // pending状态放入任务队列
            if (this.state === &#39;fulfilled&#39;) {
              setTimeout(() =&gt; {
                try {
                  const x = onFulfilled(this.value)
                  this.resolvePromise(p2, x, resolve, reject)
                } catch (error) {
                  reject(error)
                }
              }, 0)
            } else if (this.state === &#39;rejected&#39;) {
              setTimeout(() =&gt; {
                try {
                  const x = onRejected(this.reason)
                  this.resolvePromise(p2, x, resolve, reject)
                } catch (error) {
                  reject(error)
                }
              }, 0)
            } else {
              this.onResolveCallbacks.push(() =&gt; {
                setTimeout(() =&gt; {
                  try {
                    const x = onFulfilled(this.value)
                    this.resolvePromise(p2, x, resolve, reject)
                  } catch (error) {
                    reject(error)
                  }
                }, 0)
              })
              this.onRejectCallbacks.push(() =&gt; {
                setTimeout(() =&gt; {
                  try {
                    const x = onRejected(this.reason)
                    this.resolvePromise(p2, x, resolve, reject)
                  } catch (error) {
                    reject(error)
                  }
                }, 0)
              })
            }
          })
          return p2
        }
        resolvePromise(p2, x, resolve, reject) {
          // 判断 p2 和x是否相等
          if (p2 === x) {
            return reject(new TypeError(&#39;type error&#39;))
          }
          // 执行锁 确保执行一次完resolve或者reject后 不再执行
          let called = false
          // 判断x数据类型  如果是函数 对象 需要递归执行  如果是值类型 直接resolve
          if (x !== null &amp;&amp; (typeof x === &#39;object&#39; || typeof x === &#39;function&#39;)) {
            try {
              // 判断 then是否为函数
              const then = x.then
              if (typeof then === &#39;function&#39;) {
                then.call(
                  x,
                  (y) =&gt; {
                    if (called) return
                    called = true
                    this.resolvePromise(p2, y, resolve, reject)
                  },
                  (r) =&gt; {
                    if (called) return
                    called = true
                    reject(r)
                  },
                )
              } else {
                resolve(x)
              }
            } catch (error) {
              if (called) return
              called = true
              reject(error)
            }
          } else {
            resolve(x)
          }
        }
      }
    </code></pre></details><h2 id="手写-promise-all" tabindex="-1">手写 Promise.all() <a class="header-anchor" href="#手写-promise-all" aria-label="Permalink to &quot;手写 Promise.all()&quot;">​</a></h2><details><summary>手写 Promise.all()</summary><pre><code>
        /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
    all(array) {
      return new MyPromise((resolve, reject) =&gt; {
        if (!Array.isArray(array)) {
          throw new TypeError(&#39;You must pass an array to all.&#39;)
        }
        const result = []
        let count = 0
        // 遍历 array 拿到每一条数据
        array.forEach((promise, index) =&gt; {
          MyPromise.resolve(promise).then(
            (value) =&gt; {
              result[index] = value
              count++
              // 判断 result 结果值的长度 和 array参数的长度相等  执行最外面的 resolve 返回 all 结果
              if (count === array.length) {
                resolve(array)
              }
            },
            (err) =&gt; {
              reject(err)
            },
          )
        })
      })
    }
    </code></pre></details><h2 id="手写-promise-race" tabindex="-1">手写 Promise.race() <a class="header-anchor" href="#手写-promise-race" aria-label="Permalink to &quot;手写 Promise.race()&quot;">​</a></h2><details><summary>手写 Promise.race()</summary><pre><code>
          /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
    race(array) {
      return new MyPromise((resolve, reject) =&gt; {
        if (!Array.isArray(array)) {
          throw new TypeError(&#39;You must pass an array to all.&#39;)
        }
        array.forEach((promise) =&gt; {
          MyPromise.resolve(promise).then(
            (value) =&gt; {
              resolve(value)
            },
            (reason) =&gt; {
              reject(reason)
            },
          )
        })
      })
    }
      </code></pre></details><h2 id="数组扁平化" tabindex="-1">数组扁平化 <a class="header-anchor" href="#数组扁平化" aria-label="Permalink to &quot;数组扁平化&quot;">​</a></h2><details><summary>数组扁平化</summary><pre><code>
          /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
      let arr = [1, [2, [3, 4, 5]]]
      // 递归
      function flatten(arr) {
        let newArr = []
        // 递归获取数据
        for (let index = 0; index &lt; arr.length; index++) {
          const element = arr[index]
          Array.isArray(element) ? (newArr = newArr.concat(flatten(element))) : newArr.push(element)
        }
        return newArr
      }
      // 栈
      function flatten(arr) {
        const stack = [...arr]
        const result = []
        while (stack.length) {
          const next = stack.pop()
          if (Array.isArray(next)) {
            stack.push(...next)
          } else {
            result.push(next)
          }
        }
        return result.reverse()
      }
      // es6结构赋值
      function flatten(arr) {
        while (arr.some((item) =&gt; Array.isArray(item))) {
          arr = [].concat(...arr)
        }
        return arr
      }
    </code></pre></details><h2 id="数组去重" tabindex="-1">数组去重 <a class="header-anchor" href="#数组去重" aria-label="Permalink to &quot;数组去重&quot;">​</a></h2><details><summary>数组去重</summary><pre><code>
      // set
      const arr = [1, 2, 3, 5, 1, 5, 9, 1, 2, 8]
      const uniqueArr = [...new Set(arr)]
      // 使用 filter 和 indexOf
      const uniqueArr = arr.filter((item, index) =&gt; {
        return arr.indexOf(item) === index
      })
      // 使用map存储
      function uniqueArray(array) {
        let map = {}
        let res = []
        for (var i = 0; i &lt; array.length; i++) {
          if (!map.hasOwnProperty([array[i]])) {
            map[array[i]] = 1
            res.push(array[i])
          }
        }
        return res
      }
            </code></pre></details><h2 id="数组方法" tabindex="-1">数组方法 <a class="header-anchor" href="#数组方法" aria-label="Permalink to &quot;数组方法&quot;">​</a></h2><details><summary>数组方法</summary><pre><code>
        // reduce方法
        function myReduce(arr, callback, initialValue) {
          let accumulator = initialValue !== undefined ? initialValue : arr[0];
          const startIndex = initialValue !== undefined ? 0 : 1;
          for (let i = startIndex; i &lt; arr.length; i++) {
            accumulator = callback(accumulator, arr[i], i, arr);
          }
          return accumulator;
        }
          // push方法
        Array.prototype.myPush = function () {
          // 循环遍历 arguments.length 也就是传入的参数个数
          for (let index = 0; index &lt; arguments.length; index++) {
            // this.length 指向调用这个方法的数组 获取数组的长度 将当前元素放入最后一个
            this[this.length] = arguments[index]
          }
          return this.length
        }
        // let arr = [1,2,3]
        // arr.myPush(6, 4, 5)
        Array.prototype.myFilter = function (callback) {
          if (!callback || typeof callback !== &#39;function&#39;) {
            throw Error(&#39;callback must be a function &#39;)
          }
          const res = []
          // this.length 指向调用方法的数组
          for (let index = 0; index &lt; this.length; index++) {
            // 执行 callback 函数传入数据 如果函数返回 true 就将当前数据放入 res 中
            callback(this[index], index) &amp;&amp; res.push(this[index])
          }
          return res
        }
      // let arr = [1, 2, 3]
      // console.log(
      //   arr.myFilter((item, index) =&gt; {
      //     console.log(&#39;item&#39;, item)
      //     console.log(&#39;index&#39;, index)
      //     return item &gt; 2
      //   })
      // )
        // 实现数组map的方法
        Array.prototype.myMap = function (callback) {
          if (!callback || typeof callback !== &#39;function&#39;) {
            throw Error(&#39;callback must be a function &#39;)
          }
          const result = []
          // this.length 指向调用方法的数组
          for (let index = 0; index &lt; this.length; index++) {
            result.push(callback(this[index], index))
          }
          return result
        }
        // const map1 = array1.map((x) =&gt; x * 2)
        // console.log(map1)
    </code></pre></details><h2 id="将数字每千位用逗号隔开" tabindex="-1">将数字每千位用逗号隔开 <a class="header-anchor" href="#将数字每千位用逗号隔开" aria-label="Permalink to &quot;将数字每千位用逗号隔开&quot;">​</a></h2><details><summary>将数字每千位用逗号隔开</summary><pre><code>
        //不带小数
        function format(num) {
          if (!num &amp;&amp; typeof num !== &#39;number&#39;) {
            return num
          }
          let str = num.toString()
          let len = str.length
          // 长度是否超过3
          if (len &lt;= 3) {
            return num
          } else {
            // 判断是否为 3 的倍数
            let remainder = len % 3
            // 不是 3 的整倍数
            if (remainder &gt; 0) {
              //  则根据数字长度对字符串进行拆分，每3位一组，最后再用逗号拼接起来
              // 被 3 整除余下的 也就是最前面第一个数字 如 1234567 最前面就是 1
              const firstNum = str.slice(0, remainder)
              // 获取剩下的数组 每 3 个用 , 拼接  也就是从 remainder 位置到最后一位
              const surplus = str.slice(remainder, len).match(/\\d{3}/g)
              // 组合起来  第一位后面加上 ,
              return firstNum + &#39;,&#39; + surplus
            } else {
              // 是 3 的倍数 上面操作去掉第一位数据操作就是  直接用正则匹配数据 然后 join 拼接 ,
              return str.match(/\\d{3}/g).join(&#39;,&#39;)
            }
          }
        }
        // 带小数
        function format1(num) {
          if (!num &amp;&amp; typeof num !== &#39;number&#39;) {
            return num
          }
          let str = num.toString()
          let len = str.length
          let decimals = &#39;&#39;
          // 获取小数
          str.includes(&#39;.&#39;) ? (decimals = str.split(&#39;.&#39;)[1]) : decimals
          // 长度是否超过3
          if (len &lt;= 3) {
            return num
          } else {
            // 判断是否为 3 的倍数
            let remainder = len % 3
            // 不是 3 的整倍数
            if (remainder &gt; 0) {
              //  则根据数字长度对字符串进行拆分，每3位一组，最后再用逗号拼接起来
              // 被 3 整除余下的 也就是最前面第一个数字 如 1234567 最前面就是 1
              const firstNum = str.slice(0, remainder)
              // 获取剩下的数组 每 3 个用 , 拼接  也就是从 remainder 位置到最后一位
              const surplus = str.slice(remainder, len).match(/\\d{3}/g)
              // 组合起来  第一位后面加上 ,  顺便带上小数
              return firstNum + &#39;,&#39; + surplus + &#39;.&#39; + decimals
            } else {
              // 是 3 的倍数 上面操作去掉第一位数据操作就是  直接用正则匹配数据 然后 join 拼接 , 顺便带上小数
              return str.match(/\\d{3}/g).join(&#39;,&#39;) + &#39;.&#39; + decimals
            }
          }
        }
    </code></pre></details><h2 id="数组转树" tabindex="-1">数组转树 <a class="header-anchor" href="#数组转树" aria-label="Permalink to &quot;数组转树&quot;">​</a></h2><details><summary>数组转树</summary><pre><code>
        function arrToTree(arr) {
          const map = {}
          const result = []
          for (const item of arr) {
            map[item.id] = item
          }
          for (let i = 0; i &lt; arr.length; i++) {
            // 获取 pid  看是否在 map 中查询得到对应的
            const pid = arr[i].pid
            if (map[pid]) {
              // 当前 pid 在 map 中存在 将当前节点作为 map 中节点的子节点
              map[pid].children = map.children || []
              map[pid].children.push(arr[i])
            } else {
              // 不在 map 中 说明是根节点
              result.push(arr[i])
            }
          }
          return result
        }
    </code></pre></details><h2 id="树转数组" tabindex="-1">树转数组 <a class="header-anchor" href="#树转数组" aria-label="Permalink to &quot;树转数组&quot;">​</a></h2><details><summary>数转数组</summary><pre><code>
        function treeToArr(arr) {
          let stack = [...arr]
          const result = []
          while (stack.length) {
            // 从数组中获取第一个
            const first = stack.shift()
            // 判断它有没有children
            if (first[&#39;children&#39;] &amp;&amp; first.children.length) {
              // 有 children 将它展开再放入到栈中
              stack.push(...first.children)
              // 删除 children 属性
              delete first.children
            }
            result.push(first)
          }
          return result
        }
    </code></pre></details><h2 id="发布订阅模式" tabindex="-1">发布订阅模式 <a class="header-anchor" href="#发布订阅模式" aria-label="Permalink to &quot;发布订阅模式&quot;">​</a></h2><details><summary>发布订阅模式</summary><pre><code>
        class EventCenter {
          constructor() {
            // 事件中心
            this.events = {}
          }
          /**
          * 订阅事件
          *
          * @param {string} eventName
          * @param {function} callback
          * @memberof EventCenter
          */
          subscribe(eventName, callback) {
            // 确保当前 eventName 在事件中心是唯一的
            if (!this.events[eventName]) {
              // 创建事件容器
              this.events[eventName] = []
            }
            // 存放事件
            this.events[eventName].push(callback)
          }
          /**
          * 取消订阅
          *
          * @param {string} eventName
          * @param {function} callback
          * @return {*}
          * @memberof EventCenter
          */
          unSubscribe(eventName, callback) {
            // 事件中心里没有这个事件
            if (!this.events[eventName]) {
              return new Error(&#39;not find event &#39; + eventName)
            }
            // 只有事件名 移除事件
            if (!callback) {
              delete this.events[eventName]
            } else {
              // 找到索引
              const index = this.events[eventName].findIndex((el) =&gt; el === callback)
              if (index !== -1) {
                return new Error(&#39;not find callback&#39;)
              }
              // 移除事件下的某个函数
              this.events[eventName].splice(index, 1)
              // 查看事件容器是否为空 如果为空移除事件
              if (this.events[eventName].length === 0) {
                delete this.events[eventName]
              }
            }
          }
          /**
          * 触发事件
          *
          * @param {string} eventName
          * @param {Array} args
          * @return {*}
          * @memberof EventCenter
          */
          dispatch(eventName, ...args) {
            if (!this.events[eventName]) {
              return new Error(&#39;not find event &#39; + eventName)
            }
            // 触发事件
            this.events[eventName].forEach((el) =&gt; {
              el(...args)
            })
          }
        }
        const eventCenter = new EventCenter()
        // 订阅事件
        eventCenter.subscribe(&#39;click&#39;, (x, y) =&gt; {
          console.log(\`clicked at (\${x}, \${y})\`)
        })
        // 发布事件
        eventCenter.dispatch(&#39;click&#39;, 10, 20) // 输出：clicked at (10, 20)
    </code></pre></details><h2 id="排序算法" tabindex="-1">排序算法 <a class="header-anchor" href="#排序算法" aria-label="Permalink to &quot;排序算法&quot;">​</a></h2><details><summary>冒泡排序</summary><pre><code>
          // 冒泡排序
          从数组的第一个元素开始，依次比较相邻的两个元素，如果前一个元素大于后一个元素，就交换它们的位置，这样大的元素会逐步“冒泡”到数组的末尾。经过一轮比较，最大的元素会位于数组的最后一个位置。然后继续进行下一轮比较，但已经排序好的元素不再参与比较。
          function bubbleSort(arr) {
            const n = arr.length;
            for (let i = 0; i &lt; n - 1; i++) {
              for (let j = 0; j &lt; n - i - 1; j++) {
                if (arr[j] &gt; arr[j + 1]) {
                  [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
                }
              }
            }
            return arr;
          }
          // 选择排序
          在未排序部分选择最小的元素，然后将其与未排序部分的第一个元素交换，以此逐步构建已排序部分。在每一轮遍历中，算法会找到未排序部分的最小元素的索引，然后与当前轮的第一个元素交换位置，这样当前轮的第一个元素会是已排序部分的最小元素。
          与冒泡排序不同，选择排序每轮只进行一次交换操作，因此交换次数相对较少，性能稍优。
          function selectionSort(arr) {
            const n = arr.length;
            for (let i = 0; i &lt; n - 1; i++) {
              let minIndex = i;
              for (let j = i + 1; j &lt; n; j++) {
                if (arr[j] &lt; arr[minIndex]) {
                  minIndex = j;
                }
              }
              [arr[i], arr[minIndex]] = [arr[minIndex], arr[i]];
            }
            return arr;
          }
          // 插入排序
          将数组划分为已排序和未排序两个部分，初始状态下，第一个元素被视为已排序部分。然后从未排序部分逐个选择元素插入到已排序部分的正确位置，以此逐步构建有序数组。
          对于每个待插入元素 current，算法会从已排序部分从后往前遍历，将比 current 大的元素往后移动一个位置，直到找到合适的位置插入 current。
          function insertionSort(arr) {
            const n = arr.length;
            for (let i = 1; i &lt; n; i++) {
              let current = arr[i];
              let j = i - 1;
              while (j &gt;= 0 &amp;&amp; arr[j] &gt; current) {
                arr[j + 1] = arr[j];
                j--;
              }
              arr[j + 1] = current;
            }
            return arr;
          }
          // 希尔排序
          function shellSort(arr) {
            const n = arr.length;
            for (let gap = Math.floor(n / 2); gap &gt; 0; gap = Math.floor(gap / 2)) {
              for (let i = gap; i &lt; n; i++) {
                let temp = arr[i];
                let j = i;
                while (j &gt;= gap &amp;&amp; arr[j - gap] &gt; temp) {
                  arr[j] = arr[j - gap];
                  j -= gap;
                }
                arr[j] = temp;
              }
            }
            return arr;
          }
          // 并归排序
          function mergeSort(arr) {
            if (arr.length &lt;= 1) {
              return arr;
            }
            const middle = Math.floor(arr.length / 2);
            const left = arr.slice(0, middle);
            const right = arr.slice(middle);
            return merge(mergeSort(left), mergeSort(right));
          }
          function merge(left, right) {
            let result = [];
            let leftIndex = 0;
            let rightIndex = 0;
            while (leftIndex &lt; left.length &amp;&amp; rightIndex &lt; right.length) {
              if (left[leftIndex] &lt; right[rightIndex]) {
                result.push(left[leftIndex]);
                leftIndex++;
              } else {
                result.push(right[rightIndex]);
                rightIndex++;
              }
            }
            return result.concat(left.slice(leftIndex)).concat(right.slice(rightIndex));
          }
          //快速排序
          function quickSort(arr) {
            if (arr.length &lt;= 1) {
              return arr;
            }
            const pivot = arr[0];
            const left = [];
            const right = [];
            for (let i = 1; i &lt; arr.length; i++) {
              if (arr[i] &lt; pivot) {
                left.push(arr[i]);
              } else {
                right.push(arr[i]);
              }
            }
            return quickSort(left).concat(pivot, quickSort(right));
          }
          // 堆排序
          function heapSort(arr) {
            const n = arr.length;
            for (let i = Math.floor(n / 2) - 1; i &gt;= 0; i--) {
              heapify(arr, n, i);
            }
            for (let i = n - 1; i &gt; 0; i--) {
              [arr[0], arr[i]] = [arr[i], arr[0]];
              heapify(arr, i, 0);
            }
            return arr;
          }
          function heapify(arr, n, i) {
            let largest = i;
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            if (left &lt; n &amp;&amp; arr[left] &gt; arr[largest]) {
              largest = left;
            }
            if (right &lt; n &amp;&amp; arr[right] &gt; arr[largest]) {
              largest = right;
            }
            if (largest !== i) {
              [arr[i], arr[largest]] = [arr[largest], arr[i]];
              heapify(arr, n, largest);
            }
          }
          // 计数排序
          function countingSort(arr) {
            const max = Math.max(...arr);
            const min = Math.min(...arr);
            const range = max - min + 1;
            const countArr = new Array(range).fill(0);
            const output = new Array(arr.length);
            for (let i = 0; i &lt; arr.length; i++) {
              countArr[arr[i] - min]++;
            }
            for (let i = 1; i &lt; range; i++) {
              countArr[i] += countArr[i - 1];
            }
            for (let i = arr.length - 1; i &gt;= 0; i--) {
              output[countArr[arr[i] - min] - 1] = arr[i];
              countArr[arr[i] - min]--;
            }
            for (let i = 0; i &lt; arr.length; i++) {
              arr[i] = output[i];
            }
            return arr;
          }
          // 桶排序
          function bucketSort(arr, bucketSize = 5) {
            if (arr.length === 0) {
              return arr;
            }
            const minValue = Math.min(...arr);
            const maxValue = Math.max(...arr);
            const bucketCount = Math.floor((maxValue - minValue) / bucketSize) + 1;
            const buckets = new Array(bucketCount);
            for (let i = 0; i &lt; bucketCount; i++) {
              buckets[i] = [];
            }
            for (let i = 0; i &lt; arr.length; i++) {
              const bucketIndex = Math.floor((arr[i] - minValue) / bucketSize);
              buckets[bucketIndex].push(arr[i]);
            }
            arr.length = 0;
            for (let i = 0; i &lt; bucketCount; i++) {
              insertionSort(buckets[i]);
              arr.push(...buckets[i]);
            }
            return arr;
          }
          // 基数排序
          function radixSort(arr) {
            const maxDigit = getMaxDigit(arr);
            for (let digit = 0; digit &lt; maxDigit; digit++) {
              const bucketList = Array.from({ length: 10 }, () =&gt; []);
              for (let i = 0; i &lt; arr.length; i++) {
                const digitValue = getDigitValue(arr[i], digit);
                bucketList[digitValue].push(arr[i]);
              }
              arr = bucketList.flat();
            }
            return arr;
          }
          function getMaxDigit(arr) {
            let max = 0;
            for (let i = 0; i &lt; arr.length; i++) {
              max = Math.max(max, arr[i].toString().length);
            }
            return max;
          }
          function getDigitValue(num, digit) {
            return Math.floor(Math.abs(num) / Math.pow(10, digit)) % 10;
          }
    </code></pre></details><h2 id="chromeId">浏览器</h2><h2 id="xss-跨站脚本攻击" tabindex="-1">XSS（跨站脚本攻击） <a class="header-anchor" href="#xss-跨站脚本攻击" aria-label="Permalink to &quot;XSS（跨站脚本攻击）&quot;">​</a></h2><ul><li>XSS 攻击指的是跨站脚本攻击，是一种代码注入攻击。攻击者通过在网站注入恶意脚本，使之在用户的浏览器上运行，从而盗取用户的信息如 cookie 等。</li><li>避免方式 <ul><li>不用服务器端拼接后返回（不使用服务端渲染）。</li><li>对一些敏感信息进行保护，比如 cookie 使用 http-only，使得脚本无法获取。</li><li>对用户输入的地方和变量都需要仔细检查长度和对 ”&lt;”,”&gt;”,”;”,”’” 等字符做过滤</li></ul></li></ul><h2 id="csrf-跨站请求伪造" tabindex="-1">CSRF（跨站请求伪造） <a class="header-anchor" href="#csrf-跨站请求伪造" aria-label="Permalink to &quot;CSRF（跨站请求伪造）&quot;">​</a></h2><ul><li>CSRF 攻击的本质是利用 cookie 会在同源请求中携带发送给服务器的特点，以此来实现用户的冒充。</li><li>避免方式 <ul><li>添加验证码验证</li><li>使用token验证</li><li>限制 cookie 不能作为被第三方使用</li><li>进行同源检测</li></ul></li></ul><h2 id="什么进程和线程-有什么区别" tabindex="-1">什么进程和线程？有什么区别 <a class="header-anchor" href="#什么进程和线程-有什么区别" aria-label="Permalink to &quot;什么进程和线程？有什么区别&quot;">​</a></h2><details><summary>Title</summary><pre>    <b>进程（Process）</b>
      进程是计算机中正在运行的程序的实例，一个进程就是一个程序运行实例。它拥有独立的内存空间、代码和数据，并且由操作系统负责调度和管理。每个进程在执行时都会分配独立的内存空间，不同进程之间的内存是隔离的，一个进程的错误不会直接影响其他进程。 进程之间通过进程间通信（IPC）机制来交换数据和进行通信，常见的IPC方式包括管道、消息队列、共享内存等。进程的切换开销较大，因为需要保存和恢复进程的完整状态，涉及到内存保护和虚拟内存的切换。
    <b>线程（Thread）</b>
      线程是进程的子任务，一个进程可以包含多个线程。它们共享相同的代码和数据，但拥有独立的执行栈和寄存器集合。多个线程可以在同一进程内并发执行，共享进程的资源，如内存空间、打开的文件等。线程间的通信和数据交换比进程间的通信更加方便，因为它们共享相同的地址空间。线程的切换开销较小，因为线程共享进程的地址空间，切换时不需要切换内存页表，速度较快。
    <b>区别</b>
      进程和线程都可以实现并发执行，但进程是独立的执行实体，而线程是依赖于进程的。
      进程之间资源相互隔离，线程共享所属进程的资源。
      创建和销毁线程的开销较小，而创建和销毁进程的开销较大。
      多线程程序的编程复杂度通常比单线程程序高，但多线程可以更好地利用多核处理器来提高程序的执行效率。
    </pre></details><h2 id="浏览器有哪些进程" tabindex="-1">浏览器有哪些进程 <a class="header-anchor" href="#浏览器有哪些进程" aria-label="Permalink to &quot;浏览器有哪些进程&quot;">​</a></h2><ul><li>主进程：负责处理用户输入、渲染页面等主要任务。</li><li>渲染进程：渲染进程负责解析HTML、CSS和JavaScript，并将网页渲染成可视化内容。</li><li>GPU进程：负责处理浏览器中的GPU加速任务。</li><li>网络线程：网络进程负责处理浏览器中的网络请求和响应，包括下载网页和资源等。</li><li>插件进程：负责浏览器插件运行。</li></ul><h2 id="协商缓存和强缓存的区别" tabindex="-1">协商缓存和强缓存的区别 <a class="header-anchor" href="#协商缓存和强缓存的区别" aria-label="Permalink to &quot;协商缓存和强缓存的区别&quot;">​</a></h2><details><summary>Title</summary><pre>        如果设置强缓存，无需发起请求，直接使用缓存内容。如果没有命中强缓存，设置了协商缓存，也不需要发起请求，使用缓存。
    命中协商缓存条件：
      Cache-Control: no-cache
      max-age时间过期
    在使用协商缓存时，会先向服务器发送一个请求，如果资源没有发生修改，则请求返回304状态，让浏览器使用本地缓存。如果资源发生修改，则返回修改后的内容
    在request headers中的Etag属性和Last-Modified属性，来进行设置。其中，ETage优先于Last-Modified。
    Etag文件改动
      服务器在返回资源的时候，在头信息中添加Etag属性，这个属性是资源的唯一标识符。当资源改变，这个值也会改变。下次请求资源时，会在请求头中添加If-None-Match属性，为上一次请求的资源的Etag值。服务端会通过这个属性和资源最后一次修改时间进行对比，以此来判断资源是否修改。这种方式比Last-Modified更加准确。
    Last-Modified 上次修改时间
      服务器通过在响应头上添加Last-Modified属性，来指出资源最后一次修改时间。当浏览器发起请求时，会在请求头上添加一个IF-Modified-Since属性，值为上一次资源请求的Last-Modified的值。服务区会通过这个属性和最后修改时间来进行比较，以此来判断资源是否修改。如果没有资源修改，返回304状态，使用本地缓存。如果资源修改，就返回最新资源，200状态。
    这种方式有个缺点，Last-Modified标记的时间只能精确到1秒，如果文件在1秒内修改，但是 Last-Modified 却没有改变，这样会造成缓存命中的不准确。
    区别
      强缓存优先级高于协商缓存
      协商缓存不论命中与否都会发送一次请求
      强缓存返回200，协商缓存命中返回304
      Ctrl+F5 会强制刷新会跳过所有缓存，而F5刷新跳过强缓存，但是会检查协商缓存。
    </pre></details><h2 id="常见浏览器所用内核" tabindex="-1">常见浏览器所用内核 <a class="header-anchor" href="#常见浏览器所用内核" aria-label="Permalink to &quot;常见浏览器所用内核&quot;">​</a></h2><ul><li>IE浏览器内核，Trident 内核，也是俗称的IE内核；</li><li>Chrome 浏览器内核，以前是 Webkit 内核，现在是 Blink内核；</li><li>Firefox 浏览器内核：Gecko 内核，俗称 Firefox 内核；</li><li>Safari 浏览器内核：Webkit 内核；</li><li>360浏览器、猎豹浏览器内核：IE + Chrome 双内核；</li></ul><h2 id="浏览器的渲染过程" tabindex="-1">浏览器的渲染过程 <a class="header-anchor" href="#浏览器的渲染过程" aria-label="Permalink to &quot;浏览器的渲染过程&quot;">​</a></h2><ul><li>解析文档，生成DOM树</li><li>解析CSS，根据CSS规则生成CSSOM规则树</li><li>在CSSOM树和DOM树生成完后，合并DOM、CSSOM树构建渲染树</li><li>渲染树构建完成后，开始计算元素大小和位置【回流发生在这个阶段】</li><li>根据计算好的位置信息将内容渲染到屏幕上【重绘发生在这个阶段】</li></ul><h2 id="浏览器渲染优化" tabindex="-1">浏览器渲染优化 <a class="header-anchor" href="#浏览器渲染优化" aria-label="Permalink to &quot;浏览器渲染优化&quot;">​</a></h2><ul><li><p>优化javaScript，JavaScript会阻塞HTML的解析，改变JavaScrip加载方式。</p><ul><li>将JavaScript放到body最后面</li><li>尽量使用异步加载JS资源，这样不会阻塞DOM解析，如defer、async</li></ul></li><li><p>优化CSS加载，</p><ul><li>CSS样式少，使用内嵌样式</li><li>导入外部样式使用link，而不是@import，因为它会阻塞渲染。</li></ul></li><li><p>减少回流重绘</p><ul><li>避免频繁操作样式</li><li>避免频繁操作DOM</li><li>复杂动画使用定位脱离文当流</li><li>使用transform替代动画</li></ul></li></ul><h2 id="cookie、localstorage、sessionstorage区别" tabindex="-1">Cookie、LocalStorage、SessionStorage区别 <a class="header-anchor" href="#cookie、localstorage、sessionstorage区别" aria-label="Permalink to &quot;Cookie、LocalStorage、SessionStorage区别&quot;">​</a></h2><ul><li><p>Cookie</p><ul><li>大小只有4kb</li><li>跨域不能共享</li><li>不安全，容易被劫持</li><li>只存在请求头中</li></ul></li><li><p>SessionStorage</p><ul><li>存储在内存中，体积相对较大</li><li>页面关闭，数据会消失</li><li>相对Cookie安全</li></ul></li><li><p>LocalStorage</p><ul><li>体积大，可以存储更多内容。</li><li>生命周期长，除非手动删除，不然会一直存在</li><li>存储在硬盘中，不会像Cookie一样被请求携带</li></ul></li></ul><h2 id="如何解决跨越问题" tabindex="-1">如何解决跨越问题 <a class="header-anchor" href="#如何解决跨越问题" aria-label="Permalink to &quot;如何解决跨越问题&quot;">​</a></h2><ul><li>CORS：服务器开启跨域资源共享</li><li>JSONP：利用<code>&lt;script&gt;</code>标签不存在跨域限制，只支持GET请求，且不安全。</li><li>nginx代理跨域</li><li>nodejs 中间件代理跨域，通过node开启一个代理服务器。</li></ul><h2 id="事件流" tabindex="-1">事件流 <a class="header-anchor" href="#事件流" aria-label="Permalink to &quot;事件流&quot;">​</a></h2><ul><li>捕获阶段：事件从最外层的节点，也就是文档对象开始，逐级向下传播，直到事件的目标节点上。</li><li>目标阶段：事件到达目标节点，触发目标节点上的事件处理函数。</li><li>冒泡阶段：事件从目标节点开始，逐级向上传播，直到到达最外层节点（文档对象）</li></ul><h2 id="事件冒泡和捕获的区别" tabindex="-1">事件冒泡和捕获的区别？ <a class="header-anchor" href="#事件冒泡和捕获的区别" aria-label="Permalink to &quot;事件冒泡和捕获的区别？&quot;">​</a></h2><p>事件冒泡和事件捕获是两种不同的事件传播方式，默认是冒泡，它们的区别在于传播方向不同：</p><ul><li>事件冒泡是从自下而上，从子元素冒泡到父元素，执行父元素上的事件处理。</li><li>事件捕获是事件从文档的根元素开始，逐级向下传播到较为具体的元素（即从父元素到子元素）。</li><li>阻止冒泡 <ul><li>普通浏览器：event.stopPropagation()</li><li>IE浏览器：event.cancelBubble = true;</li></ul></li></ul><h2 id="对事件委托的理解" tabindex="-1">对事件委托的理解 <a class="header-anchor" href="#对事件委托的理解" aria-label="Permalink to &quot;对事件委托的理解&quot;">​</a></h2><p>利用浏览器事件冒泡机制。事件在冒泡的过程中会传到父节点，并且父节点可以通过事件对象获取到目标节点，可以吧子节点的监听函数定义在父节点上，由父节点的监听函数统一处理多个子元素的事件</p><h2 id="回流与重绘" tabindex="-1">回流与重绘 <a class="header-anchor" href="#回流与重绘" aria-label="Permalink to &quot;回流与重绘&quot;">​</a></h2><ul><li><p>回流 当DOM变化影响了元素，比如元素的尺寸、布局、显示隐藏等改变了，需要重写构建。每个页面至少需要一次回流，就是在页面第一次加载的时候，这个时候一定会发生回流。</p></li><li><p>重绘 当一个元素的外观发生变化，但是没有改变布局，重新渲染元素的外观。比如background-color、color</p></li><li><p>如何避免回流重绘：</p><ul><li>避免使用table布局</li><li>尽可能在DOM树的最末端改变class</li><li>不要频繁的操作元素的样式</li><li>避免设置多层内联样式</li><li>开启GPU加速</li><li>使用absolute或者fixed，脱离标准文档流</li></ul></li><li><p>回流必将引起重绘，而重绘不一定会引起回流</p></li></ul><h2 id="对浏览器事件循环的理解" tabindex="-1">对浏览器事件循环的理解 <a class="header-anchor" href="#对浏览器事件循环的理解" aria-label="Permalink to &quot;对浏览器事件循环的理解&quot;">​</a></h2><ul><li>执行顺序 <ul><li>执行宏任务中的同步代码，遇到宏任务或微任务，分别放入对应的任务队列，等待执行。</li><li>当所有同步任务执行完毕后，执行栈为空，首先执行微任务队列中的任务</li><li>微任务执行完毕后，检查这次执行中是否产生新的微任务，如果存在，重复执行步骤，直到微任务执行完毕。</li></ul></li><li>开始下一轮Event Loop，执行宏任务中的代码</li></ul><details><summary>Title</summary><pre>      事件循环是一种机制，它会不断的轮询任务队列，并将队列中的任务依此执行。
      JavaScript的任务分为两种同步和异步：
      同步任务：在主线程上排队执行的任务，只有一个任务执行完毕，才能执行下一个任务，
      异步任务：不进入主线程，而是放在任务队列中，若有多个异步任务则需要在任务队列中排队等待，任务队列类似于缓冲区，任务下一步会被移到执行栈然后主线程执行调用栈的任务。
      因为js是单线程，在执行代码的时候将所有函数压入执行栈中。同步任务会按照后进先出的原则以此执行。遇到异步任务时，将其放入任务队列中。当前执行栈里事件执行完毕后，就会从任务队列中取出对应异步任务的回调函数放入执行栈中继续执行。
      宏观任务(MacroTask|Task)、微观任务(MicorTask)。
      宏任务：script全部代码、setTimeout、setInterval、I/O、UI渲染
      微任务：Promise.then、Process.nexTick(Node独有)、MutationObserver
      任务队列中的任务分为宏任务和微任务，当执行栈清空后，会先检查任务队列中是否有微任务，如果有就按照先进先出的原则，压入执行栈中执行。微任务中产生了新的微任务不会推迟到下一个循环中，而是在当前循环中继续执行。 当执行这一轮的微任务完毕后，开启下一轮循环，执行任务队列中的宏任务。
      一次 Eventloop 循环会处理一个宏任务和所有这次循环中产生的微任务。
  </pre></details><h2 id="对node事件循环的理解" tabindex="-1">对node事件循环的理解 <a class="header-anchor" href="#对node事件循环的理解" aria-label="Permalink to &quot;对node事件循环的理解&quot;">​</a></h2><details><summary>Title</summary><pre>      Node事件循环分为6个阶段，每进入一个阶段，都会去对应的回调队列中取出函数执行。
      Timers阶段：执行timer（setTimeout、setInterval）的回调，由poll阶段控制；
      I/O callbacks阶段：系统调用相关的回调
      idle prepare阶段：Nodejs内部执行，可以忽略
      poll阶段：轮询
      在该阶段如果没有timer的话，会出现一下情况
      poll队列不为空，会遍历回调队列并同步执行，直到队列为空或者达到系统限制；
      poll队列对空，会出现以下两种情况
      如果有 setImmediate 回调需要执行，poll 阶段会停止并且进入到 check 阶段执行回调；
      如果没有 setImmediate 回调需要执行，就会等待回调被天加到队列中，然后立即执行。
      如果设置里有timer，并且 poll 队列为空，就会判断是否有 timer 超时，如果有就回到 timers 阶段执行回调。
      check阶段：执行 setImmediate 回调
      colse callbacks阶段：执行一些关闭回调，比如socket.on(&#39;close&#39;, ...)等。
  </pre></details>`,371)]))}const m=a(l,[["render",s]]);export{u as __pageData,m as default};
