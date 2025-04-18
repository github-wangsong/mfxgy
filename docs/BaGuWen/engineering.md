
  ## 常用git命令
  <details> <summary>答案</summary>
      <ul>
        <li>git clone：克隆远程仓库到本地。</li>
        <li>git init：在当前目录初始化一个新的Git仓库。</li>
        <li>git add ：将文件添加到暂存区，准备提交。</li>
        <li>git commit -m "commit_message"：提交暂存区的改动到本地仓库，附带提交信息。</li>
        <li>git status：查看工作区、暂存区的状态，显示文件的修改情况。</li>
        <li>git diff：显示工作区与暂存区之间的差异。</li>
        <li>git diff --staged：显示暂存区与最后一次提交之间的差异。</li>
        <li>git log：显示提交日志，包括提交哈希、作者、日期等信息。</li>
        <li>git branch：列出所有分支，当前分支前会有一个星号。</li>
        <li>git checkout ：切换到指定分支。</li>
        <li>git merge ：将指定分支合并到当前分支。</li>
        <li>git pull ：拉取远程仓库的更新并合并到当前分支。</li>
        <li>git push ：将本地分支的更新推送到远程仓库。</li>
      </ul>
  </details>

  ## git rebase和git merge的区别
  
  `git rebase` 和 `git merge` 都是用于合并分支的 Git 命令，这两个命令都能将一个分支合并到另一个分支，但两者合并方式有很大不同
  - **git merge:** 将一个分支的更改合并到另一个分支，创建一个新的`merge commit`，将两个分支的历史合并在一起，这个`merge commit`会在分支历史中保留，可以清晰的看到那些分支合并到了柱分枝，合并后形成分叉结构。
  - **git rebase：** 两个分支在合并到时候，会将整个分支和合并到另一个分支的顶端。首先找到两个分支的共同`commit`记录，然后提取之后所有的`commit`，然后将这个`commit`记录添加到另一个分支的最前面，两个分支合并后的`commit`记录就变成线性记录


  ## webpack配置有那些

  - entry：入口文件
  - output：输出文件配置
  - resolve：用来配置模块的解析方式
  - module：用来配置模块如何被解析
  - plugins：插件
  - devServer：开发服务器配置
  - devtool：调试工具
  - optimization：优化相关配置
  - externals：外部扩展的配置
  - performance：性能相关配置
  - target：构建的目标环境
  

  ## 常见的loader和plugin

  - Loader
    - image-loader : 加载并且压缩图片文件
    - css-loader : 加载 CSS，支持模块化、压缩、文件导入等特性
    - style-loader : 把 CSS 代码注入到 JavaScript 中，通过 DOM 操作去加载 CSS
    - file-loader：解析文件路径，将文件赋值到输出目录，并返回文件路径。
    - url-loader：类似于file-loader，但是可以将小于指定大小的文件转成base64编码的Data URL格式
    - eslint-loader : 通过 ESLint 检查 JavaScript 代码
    - tslint-loader : 通过 TSLint检查 TypeScript 代码
    - babel-loader : 把 ES6 转换成 ES5
    - vue-loader：将Vue单文件组件编译成JavaScript代码
  - Plugin
    - define-plugin : 定义环境变量
    - html-webpack-plugin : 简化 HTML 文件创建
    - CleanWebpackPlugin：清除输出目录。
    - webpack-parallel-uglify-plugin : 多进程执行代码压缩，提升构建速度
    - webpack-bundle-analyzer : 可视化 Webpack 输出文件的体积
    - speed-measure-webpack-plugin : 可以看到每个 Loader 和 Plugin 执行耗时 (整个打包耗时、每个 Plugin 和 - Loader 耗时)
    - mini-css-extract-plugin : 分离样式文件，CSS 提取为独立文件，支持按需加载


  ## 那你再说一说Loader和Plugin的区别？
  - 功能不同：
    - Loader本质是一个函数，它是一个转换器。webpack只能解析原生js文件，对于其他类型文件就需要用loader进行转换。
    - Plugin它是一个插件，用于增强webpack功能。webpack在运行的生命周期中会广播出许多事件，Plugin 可以监听这些事件，在合适的时机通过 webpack 提供的 API 改变输出结果。
  - 用法不同：

    - Loader的配置是在module.rules下进行。类型为数组，每⼀项都是⼀个 Object ，⾥⾯描述了对于什么类型的⽂件（ test ），使⽤什么加载( loader )和使⽤的参数（ options ）
    - Plugin的配置在plugins下。类型为数组，每一项是一个 Plugin 的实例，参数都通过构造函数传入。



    ## webpack的构建流程

    - 初始化参数：从配置文件或者shell语句中读取合并参数
    - 开始编译：用参数初始化Compiler对象，加载所有配置的插件，执行run方法。
    - 确定入口：根据entry参数找到入口文件
    - 编译模块：从⼊⼝⽂件出发，调⽤所有配置的 Loader 对模块进⾏翻译，再找出该模块依赖的模块，再递归本步骤直到所有- ⼊⼝依赖的⽂件都经过了本步骤的处理；
    - 完成模块编译：在经过第4步使⽤ Loader 翻译完所有模块后，得到了每个模块被翻译后的最终内容以及它们之间的依赖关系；
    - 输出资源：根据⼊⼝和模块之间的依赖关系，组装成⼀个个包含多个模块的 Chunk，再把每个 Chunk 转换成⼀个单独的⽂件- 加⼊到输出列表，这步是可以修改输出内容的最后机会；
    - 输出完成：在确定好输出内容后，根据配置确定输出的路径和⽂件名，把⽂件内容写⼊到⽂件系统

    总结就是三个阶段：

    - 初始化：启动构建，读取与合并配置参数，加载 Plugin，实例化 Compiler
    - 编译：从 Entry 出发，针对每个 Module 串行调用对应的 Loader 去翻译文件的内容，再找到该 Module 依赖的 Module，递归地进行编译处理
    - 输出：将编译后的 Module 组合成 Chunk，将 Chunk 转换成文件，输出到文件系统中


    ## 什么是Webpack的热更新（Hot Module Replacement）？原理是什么？
    Webpack的热更新（Hot Module Replacement，简称HMR），在不刷新页面的前提下，将新代码替换掉旧代码。
    HRM的原理实际上是 webpack-dev-server（WDS）和浏览器之间维护了一个websocket服务。当本地资源发生变化后，webpack会先将打包生成新的模块代码放入内存中，然后WDS向浏览器推送更新，并附带上构建时的hash，让客户端和上一次资源进行对比。客户端对比出差异后会向WDS发起Ajax请求获取到更改后的内容（文件列表、hash），通过这些信息再向WDS发起jsonp请求获取到最新的模块代码。
    bundle，chunk，module是什么？

    bundle 捆绑包： 它是构建过程的最终产物，由说有需要的chunk和module组成。
    chunk 代码块：一个chunk由多个模块组合而成，用于代码的合并和分割，在构建过程中一起被打包到一个文件中。
    module 模块：是代码的基本单位，可以是一个文件、一个组件、一个库等。在编译的时候会从entry中递归寻找出所有依赖的模块。

    ## 什么是Code Splitting？
    Code Splitting代码分割，是一种优化技术。它允许将一个大的chunk拆分成多个小的chunk，从而实现按需加载，减少初始加载时间，并提高应用程序的性能。
    通常Webopack会将所有代码打包到一个单独的bundle中，然后在页面加载时一次性加载整个bundle。这样的做法可能导致初始加载时间过长，尤其是在大型应用程序中，因为用户需要等待所有代码加载完成才能访问应用程序。
    Code Splitting 解决了这个问题，它将应用程序的代码划分为多个代码块，每个代码块代表不同的功能或路由。这些代码块可以在需要时被动态加载，使得页面只加载当前所需的功能，而不必等待整个应用程序的所有代码加载完毕。
    在Webpack中通过optimization.splitChunks配置项来开启代码分割。
    ## Webpack的Source Map是什么？如何配置生成Source Map？
    Source Map是一种文件，它建立了构建后的代码与原始源代码之间的映射关系。通常在开发阶段开启，用来调试代码，帮助找到代码问题所在。
    可以在Webpack配置文件中的devtool选项中指定devtool: 'source-map'来开启。
    ## Webpack的Tree Shaking原理
    Tree Shaking 也叫摇树优化，是一种通过移除多于代码，从而减小最终生成的代码体积，生产环境默认开启。
    原理：

    ES6 模块系统：Tree Shaking的基础是ES6模块系统，它具有静态特性，意味着模块的导入和导出关系在编译时就已经确定，不会受到程序运行时的影响。
    静态分析：在Webpack构建过程中，Webpack会通过静态分析依赖图，从入口文件开始，逐级追踪每个模块的依赖关系，以及模块之间的导入和导出关系。
    标记未使用代码： 在分析模块依赖时，Webpack会标记每个变量、函数、类和导入，以确定它们是否被实际使用。如果一个导入的模块只是被导入而没有被使用，或者某个模块的部分代码没有被使用，Webpack会将这些未使用的部分标记为"unused"。
    删除未使用代码: 在代码标记为未使用后，Webpack会在最终的代码生成阶段，通过工具（如UglifyJS等）删除这些未使用的代码。这包括未使用的模块、函数、变量和导入。

    ## 如何提高webpack的打包速度

    利用缓存：利用Webpack的持久缓存功能，避免重复构建没有变化的代码。可以使用cache: true选项启用缓存。
    使用多进程/多线程构建 ：使用thread-loader、happypack等插件可以将构建过程分解为多个进程或线程，从而利用多核处理器加速构建。
    使用DllPlugin和HardSourceWebpackPlugin： DllPlugin可以将第三方库预先打包成单独的文件，减少构建时间。HardSourceWebpackPlugin可以缓存中间文件，加速后续构建过程。
    使用Tree Shaking: 配置Webpack的Tree Shaking机制，去除未使用的代码，减小生成的文件体积
    移除不必要的插件: 移除不必要的插件和配置，避免不必要的复杂性和性能开销。

    ## 如何减少打包后的代码体积

    代码分割（Code Splitting）：将应用程序的代码划分为多个代码块，按需加载。这可以减小初始加载的体积，使页面更快加载。
    Tree Shaking：配置Webpack的Tree Shaking机制，去除未使用的代码。这可以从模块中移除那些在项目中没有被引用到的部分。
    压缩代码：使用工具如UglifyJS或Terser来压缩JavaScript代码。这会删除空格、注释和不必要的代码，减小文件体积。
    使用生产模式：在Webpack中使用生产模式，通过设置mode: 'production'来启用优化。这会自动应用一系列性能优化策略，包括代码压缩和Tree Shaking。
    使用压缩工具：使用现代的压缩工具，如Brotli和Gzip，来对静态资源进行压缩，从而减小传输体积。
    利用CDN加速：将项目中引用的静态资源路径修改为CDN上的路径，减少图片、字体等静态资源等打包。

    ## vite比webpack快在哪里
    他们都是前端构建工具，但vite构建速度相对于webpack还是有一些速度优势

    - 冷启动速度：vite是利用浏览器的原生ES moudle，采用按需加载的当时，而不是将整个项目打包。而webpack是将整个项目打包成一个或多个bundle，构建过程复杂。
    - HMR热更新： vite使用浏览器内置的ES模块功能，使得在开发模式下的热模块替换更加高效，那个文件更新就加载那个文件。它通过WebSocket在模块级别上进行实时更新，而不是像Webpack那样在热更新时重新加载整个包。
    - 构建速度： 在生产环境下，Vite的构建速度也通常比Webpack快，因为Vite的按需加载策略避免了将所有代码打包到一个大文件中。而且，Vite对于缓存、预构建等方面的优化也有助于减少构建时间。
    - 缓存策略： Vite利用浏览器的缓存机制，将依赖的模块存储在浏览器中，避免重复加载。这使得页面之间的切换更加迅速。
    - 不需要预编译： Vite不需要预编译或生成中间文件，因此不会产生大量的临时文件，减少了文件IO操作，进一步提升了速度。

    ## 说一下你对Monorepo的理解
    Monorepo是一种将多个项目代码存储在一个仓库的代码管理方式，将不同的项目代码放在一个仓库中，优缺点如下：
    优点：

    更好的实现代码复用，方便代码管理
    可以复用项目基础设施，不需要每个项目都建立一遍
    更好的CR
    子项目模块之间的关系更加透明，可以实现一次命令完成所有部署。
    管理依赖变得更加简单，可以在一个统一的环境中处理依赖库的版本和更新。
    一种开放，透明，共享的组织文化，这有利于开发者成长，代码质量的提升

    缺点：

    代码权限管理变得很复杂
    项目上手学习成本高，需要了解子项目之间的依赖关系
    项目基础建设、依赖管理、代码搜索、分支模型等技术要求会很高
    所以代码放在一次，会导致项目仓库体积过大，clone等操作会变很慢

    ## 你在项目是怎么做Monorepo？
    常见的Monorepo实现：

    yarn/pnpm/npm包管理工具下使用workspace功能，在package.josn下声明workspace
    lerna具备基本的任务调度能力，支持一键构建、发布等，但是不支持按需构建、不支持离线缓存
    rush stack：微软开源的 monorepo 管理工具
    nx
    bazel

    ## 为什么pnpm快？
    npm的问题
    在npm@3之前安装依赖时会出现依赖之间互相嵌套，就像树结构一样一层一层，过深的层级嵌套会带来大量重复的文件，有些依赖会重复安装，占用磁盘空间。
    json复制代码node_modules
    └─ a
      ├─ index.js
      ├─ package.json
      └─ node_modules
          └─ b
            ├─ index.js
            └─ package.json

    而在npm@3时出现了yarn，它们的出现是为了解决2之前的问题，这时候开始引入扁平化处理依赖嵌套，也就是将所有的依赖都放在一个node_modules下，依赖在统一层级下互相引用，这样是解决了之前的一些问题，但也导致了新的问题出现就是幽灵依赖。
    json复制代码node_modules
    ├─ a
    |  ├─ index.js
    |  └─ package.json
    └─ b
      ├─ index.js
      └─ package.json

    幽灵依赖是指项目中使用了一些没有在package.json中定义的包。比如A库依赖B库，那么这两个库都会平铺到node_modules下。如果项目中使用了B库，然后在package.json定义了进行安装，所以可以直接访问。假如某天项目不需要A库或者将A库删除，此时B库就会因为找不到A库而跑不起来。
    pnpm
    pnpm 是一种替代 npm 和 Yarn 的包管理器，用于管理 JavaScript 项目中的依赖关系。与传统的 npm 和 Yarn 不同，pnpm 提供了一种更为创新的方式来管理依赖项。
    在项目安装依赖时，pnpm会将所有的依赖包存储在磁盘的某一个位置简称pnpm store【查看存储位置】，下次遇到相同的包时会，如果pnpm store中已经存在这个包，就会从pnpm store创建一个硬连接到node_modules/.pnpm下对应的依赖。这样即使多个项目都依赖一个包，也只会在本地存一份代码，不会占用额外的磁盘空间。
    而且pnpm的node_module并不是平铺的，通过package.json安装的依赖通过软连接到./.pnpm中，并且在安装时会判断pnpm store中是否有相对应的包，如果有就创建硬连接到./.pnpm
    json复制代码node_modules
    ```
    ├── a -> ./.pnpm/a@1.0.0/node_modules/a
    └── .pnpm
        ├── b@1.0.0
        │   └── node_modules
        │       └── b -> <store>/b
        └── a@1.0.0
            └── node_modules
                ├── a -> <store>/                         foo
                └── b -> ../../bar@1.0.0/node_modules/bar
    ``` 
    这样做带来的好处就是：

    节约磁盘空间： pnpm 的链接依赖方式可以减少磁盘占用。相同的依赖包在不同项目中共享，不会造成重复存储。
    提升安装速度：由于依赖都是同一管理在pnpm store中，所以相同依赖不需要重复下载，这样使得pnpm 的安装和构建速度相对更快，特别是在项目中存在大量依赖项时。
    创建非扁平的node_modules目录：由于npm和yarn安装依赖时所有包都会提升到根目录下，会造成幽灵依赖和依赖安全问题，而pnpm采用非扁平的形式，有效解决。

  

