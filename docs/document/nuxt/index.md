
# SPA
即单页面应用， 一般也称为客户端渲染CSR。整个网站由一个HTML页面构成， 所有内容都是通过js动态加载和渲染的。页面只有第一次加载会进行资源请求， 之后都是通过ajax异步请求获取并更新页面。

- 首屏加载慢
- seo不友好
- 内存占用高

# SSR
SSR是一种将服务端渲染和客户端渲染结合起来的技术， 可以在服务端生成HTML代码

# 创建项目

```bush
git clone -b v3 https://github.com/nuxt/starter.git nuxt3-app
```
