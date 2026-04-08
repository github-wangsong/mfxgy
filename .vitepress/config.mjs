import { defineConfig } from 'vitepress'
import { demoblockPlugin, demoblockVitePlugin } from 'vitepress-theme-demoblock'
import path from 'path'
// import vue from '@vitejs/plugin-vue'
import { containerPreview, componentPreview } from '@vitepress-demo-preview/plugin'
export default defineConfig({
  base: '/mfxgy/',
  title: "MuFengXingGuYing",
  description: "",
  srcDir: './docs',
  outDir: './public',
  themeConfig: {
    siteTitle: 'mfxgy',
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: 'mfxgy-ui', items: [ 
          { text: '指南', link: '/demo/guild/installation.md' },
          { text: '组件', link: '/demo/examples/button' },
        ] 
      }
    ],

    sidebar:  {
      "/": [
        {
          collapsed: false, // 折叠/展开
          text: 'Typescript',
          link: '/typescript.md'
          // items: [
          //   { text: 'Markdown Examples', link: '/markdown-examples' },
          //   { text: 'Runtime API Examples', link: '/api-examples' }
          // ]
        },
        {
          collapsed: false, // 折叠/展开
          text: 'Markdown',
          link: '/markdown.md'
        },
        {
          collapsed: false, // 折叠/展开
          text: '八股文',
          items: [
            { text: '快速', link: '/BaGuWen/kuai.md' },
            { text: 'HTML', link: '/BaGuWen/html.md' },
            { text: 'CSS', link: '/BaGuWen/css.md' },
            { text: 'JavaScript', link: '/BaGuWen/javascript.md' },
            { text: 'vue', link: '/BaGuWen/vue.md' },
            { text: '手写代码', link: '/BaGuWen/write.md' },
            { text: '浏览器', link: '/BaGuWen/browser.md' },
            { text: '工程化', link: '/BaGuWen/engineering.md' },
          ]
        }
      ],
      "/demo/guild/": [
        {
          text: "基础",
          items: [
            {
              text: "安装",
              link: "/demo/guild/installation",
            },
            {
              text: "快速开始",
              link: "/demo/guild/quickstart",
            },
          ],
        },
        {
          text: "进阶",
          items: [
            {
              text: "xx",
              link: "/xx",
            },
          ],
        },
      ],
      "/demo/examples/": [
        {
          text: "基础组件",
          redirect:'button',
          items: [
            {
              
              text: "Button按钮",
              link: "/demo/examples/button/",
            },
          ],
        },
      ],
      "/document/react/": [
        {
          collapsed: false, // 折叠/展开
          text: '使用create-react-app初始化react项目',
          link: '/document/react/index.md'
        },
        {
          collapsed: false, // 折叠/展开
          text: '从vue3学习react',
          link: '/document/react/patch.md'
        },
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/github-wangsong/mfxgy.git' }
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
    },
    resolve: {
      alias: {
        // '@vitepress-demo-preview/component': path.resolve(
        //   __dirname,
        //   'node_modules/@vitepress-demo-preview/component'
        // ),
      },
    },
    plugins: [demoblockVitePlugin()]
  },
  markdown: {
    config: (md) => {
      md.use(demoblockPlugin)
      md.use(containerPreview)
      md.use(componentPreview)
    },
    image: {
      // 开启图片懒加载
      lazyLoading: true
    },
    //行号显示
    lineNumbers: true,
    toc: {level: [1,2,3,4,5,6]},
  },
})
