import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "MuFengXingGuYing",
  description: "",
  outDir: './public',
  themeConfig: {
    siteTitle: 'MF',
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      // { text: 'Github', link: 'https://github.com/NexusLin' },
      // { text: 'About Me', items: [ { text: '介绍和技术栈', link: '/item-1' }, { text: '文章', link: '/item-2' }, { text: '其他', link: '/item-3' } ] }
    ],

    sidebar: [
      {
        collapsed: false, // 折叠/展开
        text: 'Typescript',
        link: '/docs/typescript.md'
        // items: [
        //   { text: 'Markdown Examples', link: '/markdown-examples' },
        //   { text: 'Runtime API Examples', link: '/api-examples' }
        // ]
      },
      {
        collapsed: false, // 折叠/展开
        text: 'Markdown',
        link: '/docs/markdown.md'
      },
      {
        collapsed: false, // 折叠/展开
        text: '八股文',
        items: [
          { text: 'HTML', link: '/docs/BaGuWen/html.md' },
          { text: 'CSS', link: '/docs/BaGuWen/css.md' },
          { text: 'JavaScript', link: '/docs/BaGuWen/javascript.md' },
          { text: 'vue', link: '/docs/BaGuWen/vue.md' },
          { text: '手写代码', link: '/docs/BaGuWen/write.md' },
          { text: '浏览器', link: '/docs/BaGuWen/browser.md' },
          { text: '工程化', link: '/docs/BaGuWen/engineering.md' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ],
    search: {
      provider: "local",
    },
    footer: {
      message: "",
      copyright: "@mfxgy",
    },
  },
  vite: {
    build: {
      emptyOutDir: true, // 构建前清空输出目录
    }
  }
})
