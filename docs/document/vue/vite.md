# vite相关
## 1.格式化插件
在vite + vue3项目中,我们尽可能的使用'vue language features(Volar)' 插件来实现代码的格式化处理
 - 在项目根目录下配置.vscode/extensions.json 文件
 - 在这个文件中让其支持vue.volar
   ```json
   {
    "recommendations": [
      "Vue.volar",
      "Vue.vscode-typescript-vue-plugin"
    ]
   }
   ```


## 2. 目录结构

- public 存放一些无需进行打包编译的静态资源,打包时会直接拷贝到打包目录
- src 项目代码编写处
- .eslintrc,cjs eslint 配置文件
- index.html spa单页面, 和@vue/cli不同,不在public目录下
- package.json 项目配置文件
- ...
## 3. vite为什么这么快
- 开发环境下
  - 在执行$yarn dev时,只负责创建和启动一个本地web服务器, 没有进行任何的打包操作
  - 在视图预览中再按需进行编译加载(浏览器支持ES6Module规范)
- 生产环境下
  - 需要像webpack一样,把代码合并/压缩/打包/编译
  - 最后部署到服务器的一定是编译后的[不依赖ESM规范]
  - vite不是基于webpack完成这一步的,而是基于rollup来处理
    - rollup vs webpack
      - rollup使用更加简单
      - rollup按照ESM规范进行打包,而weboacj实现ESM和CommonJS的混淆
      - rollup打包文件体积和速度更快
      - webpack功能更加强大
