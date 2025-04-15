## 圣杯布局

::: details 点我查看
```html
  <!DOCTYPE html>
  <html>

  <head>
    <meta charset="utf-8">
  </head>
  <style>
    body {
      min-width: 550px;  /* 2x leftContent width + rightContent width */
      font-weight: bold;
      font-size: 20px;
    }

    #header, #footer {
      background: rgba(29, 27, 27, 0.726);
      text-align: center;
      height: 60px;
      line-height: 60px;
      clear: both;
    }
    #container{
        padding: 0 200px;
        overflow: hidden;
    }
    .column{
        height: 200px;
        float: left;
        position: relative;
    }
    #left{
        width: 200px;
        margin-left: -100%;
        left: -200px;
        background-color: aqua;
    }
    #right{
        width: 200px;
        margin-left: -200px;
        right: -200px;
        background-color: wheat;
    }
    #center{
        width: 100%;
        background-color: tomato;
    }
  </style>

  <body>
    <div id="header">#header</div>
    <div id="container">
      <div id="center" class="column">#center</div>
      <div id="left" class="column">#left</div>
      <div id="right" class="column">#right</div>
    </div>
    <div id="footer">#footer</div>
  </body>

  </html>
```
:::


## 设计模式

:::: details 点我查看

  ::: code-group

  ```js [工厂模式]
  // 工厂模式主要是为创建实例提供了接口，将new操作进行单独封装

  class jQuery {
    constructor(selector) {
      // ...
    }
    append() {}
    addClass() {}
    // ...
  }

  window.$ = function (selector) {
    return new jQuery(selector)
  }
  ```
  ```js [单例模式]
  // 系统中被唯一使用的一个类只有一个示例, 如vuex

  class SingleObject {
    constructor() {
      this.isLogin = false
    }
    login () {
      this.isLogin = true
    }
  }

  SingleObject.getInstance = (function () {
    let instance
    // 利用闭包把外部函数的变量保存在内存中
    return function () {
      // 如果不存在实例，新建一个实例
      if (!instance) {
        instance = new SingleObject()
      }
      // 如果存在，则直接返回
      return instance
    }
  })()

  const a = SingleObject.getInstance()
  const b = SingleObject.getInstance()
  // a进行登录操作
  a.login();
  // 单例模式，无论创建多少个实例，都是一模一样的
  console.log(a === b) // true
  // 由于a已登录，b和a一样，b也已登录
  console.log(b.isLogin) // true
  ```

  ```js [适配器模式]

  // 本来的不适合使用的方法，转成适合的, 如vue中的计算属性
  class Iphone {
    getName() {
      return '我是iphone插头'
    }
  }


  class Target {
    constructor() {
      this.t = new Iphone()
    }
    getName() {
      return `${this.t.getName()},已转接成andorid插头`
    }
  }


  const target = new Target()
  console.log(target.getName()) // 我是iphone插头,已转接成andorid插头

  ```

  ```js [装饰器模式]

  // 为对象添加新功能, 不改变原有的结构和功能
  // 将现有对象和装饰器进行分离，两者独立存在

  class Circle {
    draw () {
      console.log('画圆')
    }
  }

  class Decorator {
    // 传入circle实例
    constructor(circle) {
      this.circle = circle
    }
    setBorder () {
      console.log('设置边框')
    }
    draw () {
      this.circle.draw()
      // 画圆之后设置边框
      this.setBorder()
    }

  }

  let c = new Circle()
  let decorator = new Decorator(c)
  decorator.draw()
  ```

  ```js [代理模式]
  // 使用者无权访问目标对象, 中间加代理，通过代理做授权控制
  const data = {
    name: 'a',
    age: 18,
    likes: []
  }

  // 为data创建一个代理
  const proxyData = new Proxy(data, {
    get(target, key, receiver) {
      const result = Reflect.get(target, key, receiver)
      console.log('get')
      return result
    },
    set(target, key, value, receiver) {
      const result = Reflect.set(target, key, value, receiver)
      console.log('set')
      return result
    }
  })

  // 通过改变proxyData而不是data，进行代理
  proxyData.name = '2'
  proxyData.likes.push('eat')
  // 打印data
  console.log(data) // 'set' 'get' { age: 18, likes: ["eat"], name: "2" }

  ```

  ```js [观察者模式]

  // 一对多

  // 主题类
  class Subject {
    constructor() {
      // 设置一个state和观察者数组
      this.state = 0
      this.observers = []
    }
    getState() {
      return this.state
    }
    setState(state) {
      this.state = state
      // 赋值的时候调用通知的方法
      this.notify()
    }
    notify() {
      // 通知各个观察者更新
      this.observers.forEach(observer => {
        observer.update()
      })
    }
    // 传入观察者实例，绑定观察者
    attach(observer) {
      this.observers.push(observer)
    }
  }

  // 观察者类
  class Observer {
    constructor(name, subject) {
      this.name = name
      // 传入主题实例
      this.subject = subject
      // 在此观察者实例上传入主题
      this.subject.attach(this)
    }
    update() {
      console.log(`${this.name} update, state:${this.subject.getState()}`)
    }
  }

  const s = new Subject()

  // 一对多 绑定多个观察者
  const o1 = new Observer('o1', s)
  const o2 = new Observer('o2', s)
  s.setState(1234) // "o1 update, state:1234" "o2 update, state:1234"

  ```
  :::
::::


## 性能优化



### 启用前端缓存 

  -  浏览器缓存
    - localStorage,sessionStorage,cookie
  -  http缓存
    - 强制缓存
      - 设置响应头的Expires字段一个时间去实现强缓存(本地时间和服务器时间不同步, 已废弃)
      - 设置Cache-Control
    - 协商缓存
      - 基于last-modified的协商缓存
      - 基础ETag的协商缓存

### 开启GZIP压缩

- 安装compression-webpack-plugin插件
- 配置webpack文件，开启gzip压缩功能
- Nginx开启gzip功能配置, conf目录下的nginx.conf ,开启gzip并设置gzip_types的类型

### 使用函数节流和函数防抖

### 异步加载script文件或将script文件放在最后加载
- 浏览器在下载和解析script文件的时候会停止html的解析和 CSSOM 的构建
- 们通常喜欢把< script >标签放在html的最后面, 或者在script标签中加上defer属性即可。

### 减少重排和重绘
重绘不一定会引起重排。重排一定会导致重绘。

### 使用服务端渲染

### 图片
- 将png/jpg/gif图片替换为webp格式图片
- 图片压缩
- 图片分割
- sprite(精灵图/雪碧图)
- 使用iconfont(字体图标)

### 合并请求
- 使用精灵图（合并静态图片资源请求）
- 合理合并get请求,在适当的情况下，我们可以将一些可以合并的get请求合并为一个

### 启用事件委托（事件代理）
### 尽量使用CSS完成动画效果
- 不占用主线程（js是需要占用的）
- 可以利用硬件加速
- 在不可见时动画不会持续执行

### 使用懒加载

### 使用骨架屏

### moment.js换成day.js
- day.js的体积比moment.js小

### tree shaking（摇树）

webpack构建优化中重要一环。摇树用于清除我们项目中的一些无用代码，它依赖于ES中的模块语法

### split chunks（分包）

### CDN (内容分发网络)
静态资源度建议放在CDN上，可以加快资源加载的速度。

### 逻辑后移
  
### 算法复杂度

### 组件渲染

### web worker

为 JavaScript 创造多线程环境，允许主线程创建 Worker 线程，将一些任务分配给后者运行