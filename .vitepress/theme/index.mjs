import DefaultTheme from 'vitepress/theme'
import "element-plus/dist/index.css";
import elementplus from "element-plus"

import './style/index.css'
// 导入主题样式
import 'vitepress-theme-demoblock/dist/theme/styles/index.css'
// 导入插件的主题
import { useComponents } from './useComponents'
export default {
  ...DefaultTheme,
  enhanceApp: async ({ app, router, siteData }) => {
    // app is the Vue 3 app instance from `createApp()`. router is VitePress'
    // custom router. `siteData`` is a `ref`` of current site-level metadata.
      app.use(elementplus);
      useComponents(app)
  },
}