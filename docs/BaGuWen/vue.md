

  ## 为什么使用vue?
  - 优点：
    - 单页面开发，高效率；单向数据流；渐进式编程(周边衍生工具库，如Vuex, Vue-Router)；响应式编程；虚拟DOM；数据与视图分开;易用, 灵活, 高效,组件化 
  - 缺点：不利于SEO、不兼容IE(10以上才行，vue3好像的12以上)、首屏加载过长；
  ## vue的生命周期？分别作用？
  Vue 实例从创建到销毁的过程，就是生命周期
  - beforeCreate: `实例创建之初`，未初始化和响应式数据
  - created：`组件创建完成`, 已初始化和响应式数据；
  - beforMount：`组件挂载之前`, 调用render函数生成Vnode，为挂载到真实DOM；
  - mounted：`组件挂载之后`, Vnode挂载到真实DOM完成；
  - beforupdate：`数据变化更新之前`，新Vnode生成；
  - updated：`数据变化更新之后`, 新旧Vnode对比，打补丁，然后更新到真实DOM；
  - befordesitory：`实例销毁之前`, 可以访问数据；（vue3，是beforeunmount）
  - desitoryed：`实例销毁后`，子实例销毁，指令解绑，解绑本实例事件; （vue3，是 unmounted）
  - activeted: keep-alive 组件激活
  - deactivated: keep-alive 组件停用
  - errorCaptured: 捕获实例的错误
  ## 调用接口在那个生命周期？
  create和mount都可以(听说mount调用会存在线程阻塞的问题)
  ## 获取DOM在那个生命周期？
  Mount？因为在beforeCreated和created以及beforeMounted这几个钩子上都还没挂在到实例上，所以一般在mount钩子中去获取DOM；
  ## 双向绑定原理？
    采用数据劫持结合发布者-订阅者模式的方式，data数据在初始化的时候，会实例化一个Observe类，在它会将data数据进行递归遍历，并通过Object.defineProperty方法，给每个值添加上一个getter和一个setter。在数据读取的时候会触发getter进行依赖（Watcher）收集，当数据改变时，会触发setter，对刚刚收集的依赖进行触发，并且更新watcher通知视图进行渲染。
  ## 虚拟DOM(Vnode)?
  Vnode是一个对象，他将真实的DOM节点转换成一个对象，在Vue中每次数据更新时，新旧Vnode都会相互进行同层对比;（用js对象的形式去添加dom，更适合批量修改dom）
  而diff算法会在这时去做一个优化； 
  ## Diff算法？
  调用patch方法，传入新旧Vnode，开始同层对比；然后调用isSameNode方法，对比新旧Vnode是否属于同类型节点；如果不同，新节点就会替换掉旧节点；如果相同，调用patchNode进行对比节点；如果就节点没有但新节点有就新增上去，反之删除；
  ## 谈谈对MVVM的理解?
  MVVM是一种软件架构模式，MVVM 分为 Model、View、ViewModel：

  - Model代表数据模型，数据和业务逻辑都在Model层中定义；
  - View代表UI视图，负责数据的展示；
  - ViewModel负责监听Model中数据的改变并且控制视图的更新，处理用户交互操作；

  Model和View并无直接关联，而是通过ViewModel来进行联系的，Model和ViewModel之间有着双向数据绑定的联系。因此当Model中的数据改变时会触发View层的刷新，View中由于用户交互操作而改变的数据也会在Model中同步。
  ## 什么MVVM?和MVC有什么区别？
  MVC模型：包括view视图层、controller控制层、model数据层。各部分之间的通信都是单向的；
          View 传送指令到 Controller Controller 完成业务逻辑后，要求 Model 改变状态 Model 将新的数据发送到 View，用户得到反馈
  MVVM：包括view视图层、model数据层、viewmodel层。各部分通信都是双向的；
      
  viewModel通过双向数据绑定把view层和Model层连接了起来

  ## Computed和watch区别？
  - computed计算属性，通过对已有的属性值进行计算得到一个新值。它需要依赖于其他的数据，当数据发生变化时，computed会自动计算更新。computed属性值会被缓存，只有当依赖数据发生变化时才会重新计算，这样可以避免重复计算提高性能。
  - watch用于监听数据的变化，并在变化时执行一些操作。它可以监听单个数据或者数组，当数据发生变化时会执行对应的回调函数，和computed不同的是watch不会有缓存。
  - Computed依赖多个属性进行计算，具备缓存,在依赖值不变的情况下可以复用;只能同步；
  - Watch通常监听一个数变化，可以使用异步；
  ## vue组件通信？
  - 父传子：子组件通过props来接收父组件传过来的值；
  - 子传父：子组件通过$emit对父组件进行传值;
  - 父子之间通过$parent和$children获取实例进行通信；
  - 兄弟组件: EventbBus
  - 隔代传: $attrs $listeners 
  - Vuex进行状态管理；
  - 路由传值；
  - LocalStorage，sessionStorage；
  - 通过provide和inject(官方不建议使用);
  - $ref获取实例，进行传值；

  ```
    class Bus {
      constructor () {
        this.callback = {} //存放事件的名称
      }

      $on (name, fn) {
        this.callback[name] = this.callback[name] || []
        this.callback[name].push(fn)
      }

      $emit (name, args) {
        if (this.callback[name]) {
          this.callback[name].forEach((item) => {
            item(args)
          })
        }
      } 
    }


  ```

  ## v-if和v-show的区别？
  两者都是判断是否显示元素的东西；
  但是v-show是通过display：none这样一个东西，只做显示隐藏，dom只会渲染一次；
  而v-if显示渲染页面节点，隐藏删除页面节点。
  一般不频繁的显隐操作用v-show，反之用v-if；
  ## v-if和v-for？
  for遍历数组元素，if是判断数组元素；官方文档不建议两者同时在一个元素上作用；
  因为for的优先级比if高，这样每一次遍历都要去判断一下这个if，比较浪费资源；
  可以在使用template标签包在v-for外面，使用v-if
  ## vue2和vue3的区别？
  - Vue2使用的是optionsAPI ，Vue3使用composition API，更好的组织代码，提高代码可维护性
  - Vue3使用Proxy代理实现了新的响应式系统，比Vue2(Object.defindProroties())有着更好的性能和更准确的数据变化追踪能力。
  - Vue3引入了Teleprot组件，可以将DOM元素渲染到DOM数的其他位置，用于创建模态框、弹出框等。
  - Vue3全局API名称发生了变化，同时新增了watchEffect、Hooks等功能
  - Vue3对TypeScript的支持更加友好
  - Vue3核心库的依赖更少，减少打包体积
  - Vue3支持更好的Tree Shanking，可以更加精确的按需要引入模块
  封装组件有没有遇到过什么难点？
  ## 常用属性/指令/事件修饰符有哪些？
  属性：
    data：用于定义组件的初始数据。
    props：用于传递数据给子组件。
    computed：用于定义计算属性。
    methods：用于定义组件的方法。
    watch：用于监听组件的数据变化。
    components：用于注册子组件。可以通过 components 属性将其他组件注册为当前组件的子组件，从而在模板中使用这些子组件。
  指令：

  v-if：条件渲染指令，根据表达式的真假来决定是否渲染元素。
  v-show：条件显示指令，根据表达式的真假来决定元素的显示和隐藏。
  v-for：列表渲染指令，用于根据数据源循环渲染元素列表。
  v-bind：属性绑定指令，用于动态绑定元素属性到 Vue 实例的数据。
  v-on：事件绑定指令，用于监听 DOM 事件，并执行对应的 Vue 方法。
  v-model：双向数据绑定指令，用于在表单元素和 Vue 实例的数据之间建立双向绑定关系。
  v-text：文本插值指令，用于将数据插入到元素的文本内容中。
  v-html：HTML 插值指令，用于将数据作为 HTML 解析并插入到元素中。

  修饰符
  .Stop: 阻止冒泡
  .capture: 与事件冒泡的方向相反，事件捕获由外到内；
  .prevent：阻止默认事件
  .once：只运行一次；
  .self: 只会触发自己范围内的事件，不包含子元素

  .number:转数字
  .trim：去除首位空格
  .native：绑定在自定义组件上时，确保能执行
  .sync：建华子修父值的步骤；
  ## Data为什么是个函数？
  为了防止组件在多个页面使用时造成变量污染；
  因为组件是可以复用的,如果组件 data 是一个对象,那么子组件中的 data 属性值会互相污染,产生副作用。

  因为对象是一个引用类型，如果data是一个对象的情况下会造成多个组件共用一个data，data为一个函数，每个组件都会有自己的私有数据空间，不会干扰其他组件的运行。

  ## Scope？
  style上加scoped, 组件内的样式只在当前vue组件生效,实现组件的私有化，不对全局造成样式污染
  原理：在此组件的标签上加上一个随机生成的data-v开头的属性,而且必须是当前组件的元素, 才会有这个自定义属性, 
  ## Vue的目录结构？
  Vue.config.js;src;public;package.json;readme.md;node_modules;
  ## V-for为什么要使用key?
  key的作用是为了在diff算法执行时更快的找到对应的节点，提高diff速度，更高效的更新虚拟DOM;
  ## SSR?
  SSR(服务端渲染，框架有个neuxt，好像是叫这个名字)；
  由于是在服务端将数据填充进HTML之后在推送到浏览器，所以有利于SEO的爬取；而且首屏加载比较块；
  ## $nextTick原理及作用?
  Vue 的 nextTick 其本质是对 JavaScript 执行原理 EventLoop 的一种应用。
  nextTick是将回调函数放到一个异步队列中，保证在异步更新DOM的watcher后面，从而获取到更新后的DOM。
  因为在created()钩子函数中，页面的DOM还未渲染，这时候也没办法操作DOM，所以，此时如果想要操作DOM，必须将操作的代码放在nextTick()的回调函数中。
  ## V-model原理？
  - 当作用在表单上：通过v-bind:value绑定数据，v-on:input来监听数据变化并修改value
  - 当作用在组件上：本质上是一个父子通信语法糖，通过props和$emit实现。
  ## 说说你对 SPA 单页面的理解，它的优缺点分别是什么？
  SPA（ single-page application ）
  仅在 Web 页面初始化时加载相应的 HTML、JavaScript 和 CSS。
  一旦页面加载完成，SPA 不会因为用户的操作而进行页面的重新加载或跳转；
  取而代之的是利用路由机制实现 HTML 内容的变换，UI 与用户的交互，
  避免页面的重新加载
  优点：
  •	用户体验好、避免了不必要的跳转和重复渲染；
  •	SPA 相对对服务器压力小；
  •	前后端职责分离，架构清晰，前端进行交互逻辑，后端负责数据处理；
  缺点：
  •	初次加载耗时多：部分页面按需加载；
  •	前进后退路由管理：不能使用浏览器的前进后退功能，所有的页面切换需要自己建立堆栈管理；
  •	SEO 难度较大：

  ## SPA和多页面有什么区别

  - 区别
    - **页面加载方式**：在多页面应用中，每个页面都是独立的 HTML 文件，每次导航时需要重新加载整个页面。而在 SPA 中，初始加载时只加载一个 HTML 页面，后续的导航通过 JavaScript 动态地更新页面内容，无需重新加载整个页面。
    - **用户体验**：SPA 提供了流畅、快速的用户体验，因为页面切换时无需等待整个页面的重新加载，只有需要的数据和资源会被加载，减少了页面刷新的延迟。多页面应用则可能会有页面刷新的延迟，给用户带来较长的等待时间。
    - **代码复用**：SPA 通常采用组件化开发的方式，可以在不同的页面中复用组件，提高代码的可维护性和可扩展性。多页面应用的每个页面都是独立的，组件复用的机会较少。
    - **路由管理**：在多页面应用中，页面之间的导航和路由由服务器处理，每个页面对应一个不同的 URL。而在 SPA 中，前端负责管理页面的导航和路由，通过前端路由库（如 React Router 或 Vue Router）来管理不同路径对应的组件。
    - **SEO（搜索引擎优**：由于多页面应用的每个页面都是独立的 HTML 文件，搜索引擎可以直接索引和抓取每个页面的内容，有利于搜索引擎优化。相比之下，SPA 的内容是通过 JavaScript 动态生成的，搜索引擎的爬虫可能无法正确地获取和索引页面的内容，需要采取额外的优化措施。
    - **服务器负载**：SPA 只需初始加载时获取 HTML、CSS 和 JavaScript 文件，后续的页面更新和数据获取通常通过 API 请求完成，减轻了服务器的负载。而多页面应用每次导航都需要从服务器获取整个页面的内容。
  - 优点
    - 用户体验：SPA 提供了流畅、快速的用户体验，在页面加载后，只有需要的数据和资源会被加载，减少了页面刷新的延迟。
    - 响应式交互：由于 SPA 依赖于异步数据加载和前端路由，可以实现实时更新和动态加载内容，使用户可以快速地与应用程序交互。
    - 代码复用：SPA 通常采用组件化开发的方式，提高了代码的可维护性和可扩展性。
    服务器负载较低：由于只有初始页面加载时需要从服务器获取 HTML、CSS 和 JavaScript 文件，减轻了服务器的负载。

  - 缺点：

    - 首次加载时间：SPA 首次加载时需要下载较大的 JavaScript 文件，这可能导致初始加载时间较长。
    - SEO（搜索引擎优化）问题：由于 SPA 的内容是通过 JavaScript 动态生成的，搜索引擎的爬虫可能无法正确地获取和索引页面的内容。
    - 内存占用：SPA 在用户浏览应用程序时保持单个页面的状态，这可能导致较高的内存占用。
    - 安全性：由于 SPA 通常使用 API 进行数据获取，因此需要特别注意安全性。
  
  ## 父子组件渲染过程调用的钩子？
  父beforeCreated->父created->父beforeMounted->子beforeCreated->子created->子beforeMounted->子mount->父mount
  如何计算白屏时间跟首屏时间？
  白屏时间：输入url回车->浏览器第一个元素出现；
  首屏时间：输入url回车->浏览器第一屏渲染完成；
  ## 单线数据流？
  父子 prop 之间形成了一个单向下行绑定，父级 prop 的更新会向下流动到子组件中，额外的，每次父级组件发生变更时，子组件中所有的 prop 都将会刷新为最新的值。
  ## Package.jons里面有些什么？
  Name: 项目名；script：运行的脚本；version：版本号；dependencies：生产环境配置包；devDependencies：开发环境配置包；private：发布到npm的配置字段(避免私有库发布到npm)
  ## 为什么使用vuex?
  是 Vue 全局状态管理的一个工具(现在又新出了Pinia)；
  进行统一的状态管理，解决不同组件共享数据的问题。
  不同视图需要变更同一状态的问题。
  使用vuex之后，状态变化更加清晰。
  ## vuex属性？
  - State: 一些公共的参数定义的地方；
  - Mutation： 用于修改State里面的状态；只能同步
  - Action：用于异步提交；
  - Modules：模块化管理；
  ## 1.	Vuex中数据丢失？
  可以把一些数据存入到localStoreage里面；或者使用插件做数据持久化；如：vuex-persistedstate、vuex-along等等;
  ## 2.	Action和mutation？
  Action可以异步操作也可以同步，mutation只能同步操作；
  ## 3.	与pinia区别？
  没用过，主要区别就是将vuex的action和mutations合并；不在区别；
  ## 4.	Mutation和action为什么分开？
  为了代码更容易管理(其实之前vuex对这两块有些歧义，原因是必须得返回一个数据，如果返回得是promise，那么不知道是用这个promise作为数据还是等promise成功之后。其实pinia已经解决了，现在可以同步也可以异步)

  响应式属性vs非响应式属性
  响应式属性
    组件实例化初就有的属性：data， props， computed
    响应式属性的改变会触发视图的更新
    响应式属性在定义的时候有setter监视属性
  非响应式属性
    组件实力初始化的时候没有，后期添加的属性：
    通常是给data中的某一对象添加的属性
    属性的改变不会触发视图的更新
    非响应式属性没有setter方法
  如何定义一个响应式属性
    Vue.set(target, propertyName,value)
  this.$set(target, propertyName,value)

  ## vue和react的区别?
  - 不同：

    - 模版语法不同，react采用JSX语法，vue使用基于HTML的模版语法
    - 数据绑定不同，vue 使用双向数据绑定，react 则需要手动控制组件的状态和属性。
    - 状态管理不同，vue使用vuex状态管理，react使用redux状态管理
    - 组件通信不同，vue使用props和事件的方式进行父子组件通信，react则通过props和回调函数的方式进行通信。
    - 生命周期不同，vue有8个生命周期钩子，react有10个
    - 响应式原理不同，vue使用双向绑定来实现数据更新，react则通过单向数据流来实现

  - 相同：

    - 组件化开发：Vue 和 React 都采用了组件化开发的方式，将用户界面划分为独立、可复用的组件，从而使代码更加模块化、可维护和可扩展。
    - 虚拟 DOM：Vue 和 React 都使用虚拟 DOM 技术，通过在 JavaScript 和真实 DOM 之间建立一个轻量级的虚拟 DOM 层，实现高效的 DOM 更新和渲染。
    - 响应式更新：Vue 和 React 都支持响应式更新，即当数据发生变化时，会自动更新相关的组件和视图，以保持用户界面的同步性。
    - 集成能力：Vue 和 React 都具有良好的集成能力，可以与其他库和框架进行整合，例如 Vue 可以与 Vuex、Vue Router 等配套使用，React 可以与 Redux、React Router 等配套使用。

  ## vue中key值的作用?
  key 是为 Vue 中 vnode 的唯一标记，
  通过这个 key，我们的 diff 操作可以更准确、更快速

  ## ref的作用
  获取dom元素 this.$refs.box
  获取子组件中的data  this.$refs.box.msg
  调用子组件中的方法   this.$refs.box.open() 

  ## vue路由的两种模式?
  - hash模式
  
    - 开发中默认的模式，地址栏URL后携带#，后面为路由。
    - 原理是通过onhashchange()事件监听hash值变化，在页面hash值发生变化后，window就可以监听到事件改变，并按照规则加载相应的代码。hash值变化对应的URL都会被记录下来，这样就能实现浏览器历史页面前进后退。
  - history模式

    - history模式中URL没有#，这样相对hash模式更好看，但是需要后台配置支持。
    - history原理是使用HTML5 history提供的pushState、replaceState两个API，用于浏览器记录历史浏览栈，并且在修改URL时不会触发页面刷新和后台数据请求。
  ## 路由传参方式

  query
  params，必须使用占位符声明接收params参数，传参时使用对象写法，只能用name不能用path
  路由中的props配置
  props:{id:‘666’}      只能传递死数据
  props：true，    只能使用pramas传参有效
  props($route){return { id:$router.query.id}}   可以使用query传参
  ## 如何设置动态路由

  params传参

    路由配置： /index/:id
    路由跳转：this.$router.push({name: 'index', params: {id: "zs"}});
    路由参数获取：$route.params.id
    最后形成的路由：/index/zs


  query传参

    路由配置：/index正常的路由配置
    路由跳转：this.$rouetr.push({path: 'index', query:{id: "zs"}});
    路由参数获取：$route.query.id
    最后形成的路由：/index?id=zs

  区别

    获取参数方式不一样，一个通过$route.params，一个通过 $route.query
    参数的生命周期不一样，query参数在URL地址栏中显示不容易丢失，params参数不会在地址栏显示，刷新后会消失

  ## $router和$route的区别?
  - $route是 `路由信息对象`,包括path, params, hash, query, fullPath, matched, name等路由信息参数
  - $router是`路由实例对象`包括路由的跳转方法,钩子函数等

  ## Vue模版编译原理

  模版编译主要过程：template ---> ast ---> render，分别对象三个方法

  parse 函数解析 template
  optimize 函数优化静态内容
  generate 函数创建 render 函数字符串

  调用parse方法，将template转化为AST（抽象语法树），AST定义了三种类型，一种html标签，一种文本，一种插值表达式，并且通过 children 这个字段层层嵌套形成了树状的结构。
  optimize方法对AST树进行静态内容优化，分析出哪些是静态节点，给其打一个标记，为后续更新渲染可以直接跳过静态节点做优化。
  generate将AST抽象语法树编译成 render字符串，最后通过new Function(render)生成可执行的render函数
  Vuex
  ## Vuex 的原理
  Vuex是专门为Vue设计的状态管理，当Vue从store中读取数据后，数据发生改变，组件中的数据也会发生变化。


  Vue Components 负责接收用户操作交互行为，执行dispatch触发对应的action进行回应
  dispatch唯一能执行action的方法
  action用来接收components的交互行为，包含异步同步操作
  commit对mutation进行提交，唯一能执行mutation的方法
  mutation唯一可以修改state状态的方法
  state页面状态管理容器，用于存储状态
  getters读取state方法

  Vue组件接收交互行为，调用dispatch方法触发action相关处理，若页面状态需要改变，则调用commit方法提交mutation修改state，通过getters获取到state新值，重新渲染Vue Components，界面随之更新。
  ## Vuex中action和mutation的区别

  mutation更专注于修改state，必须是同步执行。
  action提交的是mutation，而不是直接更新数据，可以是异步的，如业务代码，异步请求。
  action可以包含多个mutation

  ## Vuex 和 localStorage 的区别

  Vuex存储在内存中，页面关闭刷新就会消失。而localstorage存储在本地，读取内存比读取硬盘速度要快
  Vuex应用于组件之间的传值，localstorage主要用于不同页面之间的传递
  Vuex是响应式的，localstorage需要刷新

  虚拟DOM
  ## 对虚拟DOM的理解
  虚拟DOM就是用JS对象来表述DOM节点，是对真实DOM的一层抽象。可以通过一些列操作使这个棵树映射到真实DOM上。
  如在Vue中，会把代码转换为虚拟DOM，在最终渲染到页面，在每次数据发生变化前，都会缓存一份虚拟DOM，通过diff算法来对比新旧虚拟DOM记录到一个对象中按需更新，最后创建真实DOM，从而提升页面渲染性能。
  ## 虚拟DOM就一定比真实DOM更快吗
  虚拟DOM不一定比真实DOM更快，而是在特定情况下可以提供更好的性能。
  在复杂情况下，虚拟DOM可以比真实DOM操作更快，因为它是在内存中维护一个虚拟的DOM树，将真实DOM操作转换为对虚拟DOM的操作，然后通过diff算法找出需要更新的部分，最后只变更这部分到真实DOM就可以。在频繁变更下，它可以批量处理这些变化从而减少对真实DOM的访问和操作，减少浏览器的回流重绘，提高页面渲染性能。
  而在一下简单场景下，直接操作真实DOM可能会更快，当更新操作很少或者只是局部改变时，直接操作真实DOM比操作虚拟DOM更高效，省去了虚拟DOM的计算、对比开销。
  ## 虚拟DOM的解析过程

  首先对将要插入到文档中的 DOM 树结构进行分析，使用 js 对象将其表示出来，比如一个元素对象，包含 TagName、props 和 Children 这些属性。然后将这个 js 对象树给保存下来，最后再将 DOM 片段插入到文档中。
  当页面的状态发生改变，需要对页面的 DOM 的结构进行调整的时候，首先根据变更的状态，重新构建起一棵对象树，然后将这棵新的对象树和旧的对象树进行比较，记录下两棵树的的差异。
  最后将记录的有差异的地方应用到真正的 DOM 树中去，这样视图就更新了。

  ## DIFF算法原理
  diff的目的是找出差异，最小化的更新视图。
  diff算法发生在视图更新阶段，当数据发生变化的时候，diff会对新旧虚拟DOM进行对比，只渲染有变化的部分。

  对比是不是同类型标签，不是同类型直接替换
  如果是同类型标签，执行patchVnode方法，判断新旧vnode是否相等。如果相等，直接返回。
  新旧vnode不相等，需要比对新旧节点，比对原则是以新节点为主，主要分为以下几种。

  newVnode 和 oldVnode都有文本节点，用新节点替换旧节点。
  newVnode有子节点，oldVnode没有，新增newVnode的子节点。
  newVnode没有子节点，oldVnode有子节点，删除oldVnode中的子节点。
  newVnode和oldVnode都有子节点，通过updateChildren对比子节点。



  ## 双端diff
  updateChildren方法用来对比子节点是否相同，将新旧节点同级进行比对，减少比对次数。会创建4个指针，分别指向新旧两个节点的首尾，首和尾指针向中间移动。
  每次对比下两个头指针指向的节点、两个尾指针指向的节点，头和尾指向的节点，是不是 key是一样的，也就是可复用的。如果是重复的，直接patch更新一下，如果是头尾节点，需要进行移动位置，结果以新节点的为主。
  如果都没有可以复用的节点，就从旧的vnode中查找，然后进行移动，没有找到就插入一个新节点。
  当比对结束后，此时新节点还有剩余，就批量增加，如果旧节点有剩余就批量删除。
  
  ## vue-router  路由守卫/  导航钩子有哪些?
  全局守卫
  1.	router.beforeEach 全局前置守卫 进入路由之前
  2.	router.beforeResolve 全局解析守卫(2.5.0+) 在beforeRouteEnter调用之后调用
  3.	router.afterEach 全局后置钩子 进入路由之后

    局部单个路由 beforeEnter

    组件的钩子函数
    beforeRouterEnter进入路由前
    beforeRouterUpdate路由复用同一个组件时
    beforeRouterLeave离开当前路由时
    to 即将进入的目标对象
    from 当导航要离开的导航对象
    next 调用resolve 执行下一步

  ## vuex的流程? 
  Vuex 是一个专为 Vue.js 应用程序开发的状态管理模式
  为了解决组件间状态共享的问题, 便于维护, 便于解耦
  Vuex 的 状态存储是响应式的
  •	State：保存共有的数据, 响应式的。
  •	Getter：对state进行计算操作,主要用于过滤一些数据
  •	Mutation：是唯一更改 store 中的数据，且必须是同步函数。
  •	Action：用于提交 mutation，而不是直接变更状态，可以包含任意异步操作。
  •	Module：模块化vuex。
  使用vuex中的数据和方法：
  第一种mapState/mapGetter/mapMutations/mapActions
  第二种this.$store.state/this.$store.getter/this.$store.commite/this.$store.dispatch

  自定义作用域插槽
  ```
    <template  slot-scope=’scope’>{{scope.row}}</template>
  ```

  ## axios是什么?怎么用,,使用流程?
  基于promise, 用于浏览器和node.js的一个http客户端
  主要用于向后台发起请求的
    支持promise
    拦截器
    提供支持csrf

  ## vue中的性能优化

  **编码阶段**
  - v-if和v-for不一起使用
  - v-for保证key的唯一性
  - 使用keep-alive缓存组件
  - v-if和v-show酌情使用
  - 路由懒加载、异步组件
  - 图片懒加载
  - 节流防抖
  - 第三方模块按需引入
  - 服务端与渲染
  - key
  - v-show/v-if
  - 按需加载
  - 路由懒加载
  
  **打包优化**
  - 压缩代码
  - 使用CDN加载第三方模块
  - 抽离公共文件
  **用户体验**
  - 骨架屏
  - 客户端缓存
  **SEO优化**
  - 预渲染
  - 服务端渲染
  - 合理使用 meta 标签



  vue.extend 和vue.component

  scoped下修改第三方样式数据(深度选择器)

  1.	使用深度选择器: 原生css样式--  >>>,  
  2.	在stylus，sass，less中使用 /deep/或::v-deep

  ## params传参刷新参数丢失问题
  如果在注册路由的时候没有使用占位符进行注册: ‘/home/:id’,
  首次路由跳转可以获取params参数，再次刷新页面params数据丢失
  注册路由的时候写好占位符
  ## vue-loader
  一个加载器, 能把 .vue 组件转化成js模块

  ## keep-alive的作用
  include /  exclude, 允许组件有条件的缓存

  keep-alive是Vue.js的一个内置组件。它能够将不活动的组件实例保存在内存中，而不是直接将其销毁，它是一个抽象组件，不会被渲染到真实DOM中，也不会出现在父组件链中。

  include 字符串或正则表达式，只有名称匹配的组件会被匹配；
  exclude 字符串或正则表达式，任何名称匹配的组件都不会被缓存；
  max 数字，最多可以缓存多少组件实例。

  2 个生命周期 activated ， deactivated

  activated：当缓存的组件被激活时，该钩子函数被调用。可以在该钩子函数中进行一些状态恢复、数据更新等操作。
  deactivated：当缓存的组件被停用时，该钩子函数被调用。可以在该钩子函数中进行一些状态保存、数据清理等操作。

  keep-alive内部其实是一个函数式组件，没有template标签。在render中通过获取组件的name和include、exclude进行匹配。匹配不成功，则不需要进行缓存，直接返回该组件的vnode。
  匹配成功就进行缓存，获取组件的key在cache中进行查找，如果存在，则将他原来位置上的 key 给移除，同时将这个组件的 key 放到数组最后面（LRU）也就实现了max功能。
  不存在的话，就需要对组件进行缓存。将当前组件push(key)添加到尾部，然后再判断当前缓存的max是否超出指定个数，如果超出直接将第一个组件销毁（缓存淘汰策略LRU）。

  ## 请说一下`Vue2`及`Vue3`响应式数据的理解

  ## 1、 什么叫响应式数据，可以拦截用户的获取数据的操作和设置数据的操作

  ## 2、vue2中响应式原理 
    Object.defineProperty对属性的读取、修改进行拦截来实现的 （缺点就是需要将整个对象递归的增加get和set`针对的属性`）。 vue中对象采用了defineProperty，
  数组并没有采用（重写数组的7个方法），因为可能会有性能问题.
  新增属性、删除属性页面不会更新
  直接通过下标修改数组不会更新

  -3、Vue3：
    采用了proxy针对的是对象，而且不用重写某个属性 性能高 （缺点兼容性不好） 
  -4、优化：
    vue2中减少层级数据嵌套
    不需要响应式不要放在data中，合理使用object.freeze
    尽量缓存使用过的变量
    

  ## 双向数据绑定的原理

  采用数据劫持结合发布者-订阅者模式的方式，data数据在初始化的时候，会实例化一个Observe类，在它会将data数据进行递归遍历，并通过Object.
  ## 使用 Object.defineProperty() 来进行数据劫持有什么缺点？
  该方法只能监听到数据的修改，监听不到数据的新增和删除，从而不能触发组件更新渲染。vue2中会对数组的新增删除方法push、pop、shift、unshift、splice、sort、reserve通过重写的形式，在拦截里面进行手动收集触发依赖更新。
  ## 和Vue3相比有什么区别

  Vue3采用了Proxy代理的方式，Proxy是ES6引入的一个新特性，它提供了一个用于创建代理对象的构造函数。它是对整个对象的监听和拦截，可以对对象所有操作进行处理。而Object.defineProperty只能监听单个属性的读写，无法监听新增、删除等操作。
  ## Vue是如何收集依赖的？

  依赖收集发生在defineReactive()方法中，在方法内new Dep()实例化一个Dep()实例，然后在getter中通过dep.depend()方法对数据依赖进行收集，然后在settter中通过dep.notify()通知更新。整个Dep其实就是一个观察者，吧收集的依赖存储起来，在需要的时候进行调用。在收集数据依赖的时候，会为数据创建一个Watcher，当数据发生改变通知每个Watcher，由Wathcer进行更新渲染。
  ## slot是什么？有什么作用？原理是什么？

  slot插槽，一般在封装组件的时候使用，在组件内不知道以那种形式来展示内容时，可以用slot来占据位置，最终展示形式由父组件以内容形式传递过来，主要分为三种：

  - 默认插槽：又名匿名插槽，当slot没有指定name属性值的时候一个默认显示插槽，一个组件内只有有一个匿名插槽。
  - 具名插槽：带有具体名字的插槽，也就是带有name属性的slot，一个组件可以出现多个具名插槽。
  - 作用域插槽：默认插槽、具名插槽的一个变体，可以是匿名插槽，也可以是具名插槽，该插槽的不同点是在子组件渲染作用域插槽时，可以将子组件内部的数据传递给父组件，让父组件根据子组件的传递过来的数据决定如何渲染该插槽。

  实现原理：当子组件vm实例化时，获取到父组件传入的slot标签的内容，存放在vm.$slot中，默认插槽为vm.$slot.default，具名插槽为vm.$slot.xxx，xxx 为插槽名，当组件执行渲染函数时候，遇到slot标签，使用$slot中的内容进行替换，此时可以为插槽传递数据，若存在数据，则可称该插槽为作用域插槽。

  ## ref和reactive区别
  ref：基本数据类型（object.definepropty），也可以定义对象或数组(内部也是reactive对象)，操作数据需要.value
  reactive:对象或数组（proxy），不需要.value
  setup函数
  在beforecreate之前执行一次，this是undefined
  setup参数
    props值为对象，组件外部传来，内部声明了的
    context 
      attrs值为对象，组件外部传来，没有内部声明的属性
      slots插槽内容，相当于this.$slots
      emit 分发定义事件函数，相当于this.$emit
  ## Vue`中如何检测数组变化?
  -1、Vue2
    中采用的是重写数组的方法  通过创建一个对象，实现原型链继承。在对象身上重写了7个方法，如果在vue中定义了数组对象，我会让这个数组通过链找到我们饿创建的这个对象。 用户在数组上调用方法会触发我们重写的方法。就可以监控到数组的变化  缺陷就是没有监控数组的索引，也没有监控length属性 在vue中改变索引和长度是无法实现响应式更新页面的
  -2、Vue3中的proxy天生就支持数组的拦截，所以不会出现这个问题




  ## `Vue.mixin`的使用场景和原理
  - 核心在于就是抽离公共逻辑， vuex和vue-router 给每个组件都增添一个$store $router 这时候就可以使用mixin ， 还有一些公共方法 都可以放在mixin里面 ， 开可以通过mixin属性来注入。 缺陷数据来源不明确，而且会产生命名冲突。
  - 在React中最早都采用的是高阶组件，hook  
  - Vue3 来说 就是compositionApi 组合式api  （组合由于继承） Vue3中依旧可以使用mixin




  ## 谈一谈对Vue组件化的理解 
  vue组件化的目的 ， 为了能实现组件化更新，每个组件都有一个watcher. 
  可以实现组件的复用
  维护起来比较方便

---------- 