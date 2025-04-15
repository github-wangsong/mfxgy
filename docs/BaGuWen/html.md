  ## 1. h5有哪些新特性?*****
  - 新语义化标签,header/footer/section/nav/aside/article/main
  - 新增表单类型属性:input中的type='color/date/email/month/number/search/tel/time/url/'
  - 音视频标签:audio/video
  - 画布canvas
  - 新事件: ondrag（拖拽）
  - webworker,  websocket
  - 新增本地存储 localStorage和sessionStorage

  ## 2. 什么是语义化(对语义化的理解)？
  - 语义化标签的使用能够让览器更好的读取页面结构，利于SEO。
  - 提高代码可读性，能便于团队开发和维护
  ## 3、块级元素、行内块分别有哪些？***
  - 块元素：div, p, ul, ol, li, dl, dt, dd, h1-h6, table, form;
  - 行内元素：a, b, em, strong, span, i, label
  - 空(void): hr, br, img, input, link, meta
  ## 4、页面导入样式时，link和@import区别？
  - link是HTML标签，@import是css中提供的方式
  - 当页面被加载时，link会同时加载；而@import会等到页面加载完之后才会加载，会闪屏
  - Link无兼容性问题，而@import时h5以上才能识别；
  - Link的权重高于@import;
  - js操作dom修改样式时只能修改ilnk中的
  ## 5、什么是webSocket?
  Websocket是h5下的一种新协议。他实现了浏览器与服务器之间的通信，能够更好的洁身服务器资源和宽带，并且达到实时通讯的目的。\

::: code-group
  ```js [客户端]
    // 1. 创建连接
    const socket = new WebSocket('wss://example.com/chat');

    // 2. 事件监听
    socket.onopen = () => console.log('连接建立');
    socket.onmessage = (event) => {
      console.log('收到消息:', event.data);
    };
    socket.onclose = () => console.log('连接关闭');

    // 3. 发送数据
    socket.send(JSON.stringify({user: 'Alice', msg: 'Hello'}));

    // 4. 关闭连接
    socket.close(1000, '正常关闭');
  ```
  ```js [服务端]
    const WebSocket = require('ws');
    const wss = new WebSocket.Server({ port: 8080 });
    wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        console.log('收到客户端消息:', message);
        ws.send('服务器已接收');
      });

      // 定时推送示例
      const interval = setInterval(() => {
        ws.send(JSON.stringify({time: Date.now()}));
      }, 1000);

      ws.on('close', () => clearInterval(interval));
    });
  ```
:::
  ## 6、Webworker?
  - webWorker拥有与主线程完全隔离的JavaScript执行环境
  - 因线程安全限制，无法操作DOM或使用window对象
  - 基于postMessage和onmessage的异步消息传递
  
  类型 | 生命周期 |共享范围|应用场景|
  | :------ | :------- | :------ |:---
  Dedicated Worker | 随创建页面关闭而终止 | 仅创建它的页面 | 复杂计算、大数据处理
  Shared Worker | 需显式关闭或所有页面关闭	| 同源跨页面共享 | 多Tab协同（如状态同步）
  Service Worker | 可独立于页面存在 | 控制同源所有页 | PWA、离线缓存、网络代理

  ## 7、XHTML和HTML的区别？
  维度 | HTML | XHTML
  | :------ | :------- | :------
   语法基础 | SGML应用 | XML应用
   设计目标 | 容错性强（宽松语法） | 	严格规范（强制良好格式）
   MIME类型 | text/html | application/xhtml+xml

  -  xhtml 要求正确嵌套
  -  xhtml 所有元素必须关闭
  -  xhtml 区分大小写 
  -  xhtml 属性值要用双引号
  -  xhtml 用 id 属性代替 name 属性 
  -  xhtml 特殊字符的处理
 
  ## 8、图片格式区别？如.jpg，.png？ 
  - jpeg（jpg）  支持颜色比较多，不支持透明效果；适合显示照片
  - gif  支持的颜色比较少，支持简单透明，支持动图
  - png  支持的颜色的丰富，支持复杂透明
  - webp  google专门为网页设计一种图片格式，颜色丰富，复杂透明，支持动图，内存小，兼容性差，主要是对于IE
  - 通过base64编码的图片（特殊情况使用）
    - 减少HTTP请求, 增加HTML/CSS体积,是原来的4/3,适合小资源(<2kb)
    - 避免资源加载阻塞, 无法利用浏览器缓存
  ## 9、严格模式和混杂模式？
  1. 严格模式应该称为标准模式，演示按照标准执行代码，使浏览器根据规范呈现页面、排版和js运作模式，以浏览器最高标准来运行；
  2. 混杂模式也被成为怪异模式，是一种比较宽松的向后兼容模式，通常模拟老浏览器的操作行为，避免老站点无法运转，但由于各个浏览器解析代码的方式不一样，所以也称为混杂模式；
  ## 10、div+css与table布局？
  - div+css布局相对与table布局来说比较好维护和改版；在编写时更容易检查和维护；
  - table必须整体加载，而div+css边加载边显示
  ## 11、DOM和BOM的区别？
  - DOM：是处理网页内容的方法和接口，文档对象模型把文档当作对象来对待，这个对象主要定义了处理网页的内容和接口；
  - BOM：是浏览器交互的方法和对象；浏览器对象模型，将浏览器当作一个对象来对待，其主要定义了与浏览器进行交互的方法和接口；核心是window,而window是一个双重角色，及时js访问浏览器窗口的一个接口，又是一个全局对象，这就意味着网页中定义的任何对象、变量、和函数、都会作为全局对象的一个属性或者方法存在；
  ## 12、如何进行Seo优化?
  Seo通常方便浏览器搜索引擎爬取的。
  - 使用语义化标签，设置title
  - Meta标签优化,确定主关键词
  ```
  <meta name="keywords" content="关键词"> 
  <meta name="description" content="描述">  
  ```
  ## 13、src和href的区别?
  src和href都是用来加载外部资源，区别如下
    
  - src当浏览器解析到该元素时，会暂停其他资源的加载和处理，直到该资源加载完成。
  - src会将资源内容嵌入到当前标签所在的位置，将其指向的资源下载应用到文档内，如js脚本等。常用在img、script、iframe等标签。
  - href指向外部资源所在的位置，和当前元素位置建立链接，当浏览器解识别到它指向的位置，将其下载的时候不会阻止其他资源的加载解析。常用在a 、 link标
  ## 14、iframe有那些优点和缺点?

  `iframe`通常用来加载外部链接，不会影响网页内容的加载。
  - 优点:
    - 可以将网页原封不动的加载进来
    - 增加代码的可用性
    - 用来加载显示较慢的内容，如广告、视频等
  - 缺点:
    - 阻塞onload事件
    - 加载内容无法被浏览器引擎识别, 不利于seo优化
    - 增加http请求数，页面加载缓慢
  ## 15、Label的作用是什么？是怎么用的？
  label标签来定义表单控制间的关系,当用户选择该标签时，
  会自动将焦点转到和标签相关的表单控件上
  ```
  显式关联:
  <input type='checkbox' name='basket' id='basketball'>   
  <label for="basketball">篮球</label>

  隐式关联:
  <label>点击我可以使文本框获得焦点
      <input type='text' name='theinput' id='theinput'>
  </label>
  ```
  ## 16、常见的浏览器兼容问题？
  - 不同浏览器有各自的默认样式
  - ie6双边距
  - ie9以下不能用opacity
  - ie下event有srcElement属性，Firefox下，event对象有target
  - ie事件绑定用dom.attachEvent(), 其他是dom.addEventListener()
  - ie9以下不能操作tr的innerHTML
  - IE的ajax ：ActiveXObject  其他：xmlHttpRquest


  ## DOCTYPE(⽂档类型) 的作⽤?

  DOCTYPE是HTML5中一种标准通用标记语言的文档类型声明，是用来告诉浏览器的解析器，该用什么样的方式去加载识别文档。

  ## Canvas和SVG的区别?

  - canvas画布，是通过javascript来绘制2d图，是逐像素进行渲染。
  - SVG矢量图，是基于XML描述的2D图形语言，每个元素都是可用的，可以为其添加事件。

  ## script标签中defer和async的区别?

  他俩都是表示异步加载外部JS脚本，不会阻碍页面的加载解析。 **区别:**
  - 执行顺序：有多个async标签不能保证先后加载顺序，而多个defer标签可以按先后顺序加载。
  - 是否立即执行：async加载完脚本后会立即执行，defer是要等文档解析完成后才执行
  ``` 
    <script async src="script.js"></script>
    <script defer src="myscript.js"></script>
  ```

  ## 怎样添加、移除、移动、复制、创建和查找节点

  - 添加节点document.appendChild(dom)
  - 移除节点document.removeChild(dom)
  - 移动节点document.appendChild(targetDom)
  - 复制节点dom.cloneNode(true)，参数true表示是否复制子节点
  - 创建节点document.createElement(dom)
  - 查找节点:
    - document.getElementById("elementId")
    - document.getElementsByClassName("className")
    - document.getElementsByTagName("tagName")
    - document.querySelector("selector")
    - document.querySelectorAll("selector")
------