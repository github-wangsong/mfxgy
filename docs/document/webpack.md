# webpack

## webpack打包的原理

webpack其实是一个平台, 在平台中, 我们会安装/融入/配置各种打包规则
  - mode: 打包模式(开发环境development/生产环境production)
  - entry: 入口
  - output: 出口
  - loader: 加载器(一般用于实现代码编译的)
  - plugin: 插件
  - resolve: 解析器
  - optimization: 优化器
  - devServer: 配合webpack-dev-server使用, 在本地启动web服务, 实现项目预览和跨域处理
  - ...

## 安装

```sh
npm install webpack webpack-cli -D

```

## 自定义配置

1. 创建配置文件webpack.config.js
```js
const path = require('path');

module.exports = {
  /* 设置环境变量模式
    获取环境变量 process.env.NODE_ENV
    production 生产环境: 打包后js会自动压缩
    development 开发环境: 打包后js不会压缩 */
  mode: 'development',
  entry: './src/index.js', // 指定入口（相对地址）
  output: {
    // filename: 'bundle.js', // 打包后的文件名字
   /*  [hash]/[hash:8]为打包后的文件创建哈希名
      代码一旦被修改, 生成的文件名哈希值会变化
      有助于强缓存 */
    filename: 'bundle.[hash:8].js', // 打包后的文件名字, 哈希值长度8
    path: path.resolve(__dirname, 'dist') //打包的路径（绝对地址）
  }
}

```
