## 初始化
```sh
  pnpm create vite
```

### 安装eslint

安装
```sh
  pnpm i eslint -D
  pnpm i eslint-plugin-import eslint-plugin-vue eslint-plugin-node eslint-plugin-prettier eslint-config-prettier eslint-plugin-node @babel/eslint-parser -D
```

初始化配置文件
```sh
  npx eslint --init
```
配置忽略文件 .eslintignore
```
/node_modules/**
/dist/**
/public/**
```

package.json配置运行脚本
```json
"scripts": {
  "lint": "eslint src",
  "fix": "eslint src --fix"
}
```
### 安装prettier
```sh
  pnpm i prettier eslint-plugin-prettier eslint-config-prettier -D
```

创建.prettierrc.json
```json

  {
    "singleQuote": true,
    "semi": true,
    "bracketSpacing": true,
    "htmlWhitespaceSensitivity": "ignore",
    "endOfLine": "auto",
    "trailingComma": "all",
    "tabWidth": 2,
  }
  ```

  创建忽略文件.prettierignore
  ```
  /node_modules/**

  ```

  ### 配置stylelint
  安装
  ```sh
  pnpm i sass sass-loader stylelint postcss postcss-scss postcss-html stylelint-config-standard stylelint-config-prettier stylelint-config-recess-order stylelint-config-recommended-scss stylelint-config-standard-vue stylelint-scss stylelint-order stylelint-config-standard-scss -D
  ```

  创建配置文件.stylelintrc.cjs
  ```js
  module.exports = {
    extends: [
      'stylelint-config-standard',
      'stylelint-config-prettier',
      'stylelint-config-html/vue',
      'stylelint-config-standard-scss',
      'stylelint-config-recommended-vue/scss',
      'stylelint-config-recess-order',
      
    ]
  }
  ```
  配置忽略文件 .stylelintignore
  ```
  node_modules
  dist
  .git
  ```


### 配置husky

安装
```sh
pnpm install husky -D
```

执行
```sh
npx husky install
```


### 配置commitlint
安装
```sh
pnpm install @commitlint/cli @commitlint/config-conventional -D
```
添加配置文件commitlint.config.cjs
```js
module.exports = { extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', //  修复bug
        'docs', // 文档修改
        'style', // 样式修改
        'refactor', // 重构
        'perf', // 性能优化
        'test', // 测试
        'build', // 构建
        'ci', // 持续集成
        'chore', // 构建流程或辅助工具修改
        'revert', // 回退

      ]
    ],
    'type-case': [0],
    'type-empty': [0],
    'scope-empty': [0],
    'scope-case': [0],
    'subject-full-stop': [0, 'never'],
    'subject-case': [0, 'never'],
    'header-max-length': [0, 'always', 72]
  }
 }
 ```
 配置husky
 ```sh
 npx husky add .husky/commit-msg
 ```


 ### 强制使用pnpm
 创建scripts/preinstall.js
 ```js
  if (!/pnpm/.test(process.env.npm_execpath || '')) {
    console.warn(
      `\u001b[33mThank you for using pnpm. To reduce unexpected bugs, we recommend not using npm or yarn to install pnpm.\u001b[39m\n`
    )
    process.exit(1)
  }

```
package.json中配置
```json
"scripts": {
  "preinstall": "node ./scripts/preinstall.js"
}
```
完整scripts
```json
"scripts": {
  "dev": "vite --open",
  "build": "vue-tsc && vite build",
  "preview": "vite preview",
  "lint": "eslint src",
  "fix": "eslint --fix src",
  "format": "prettier --write \"./**/*.{html,vue,js,ts,json,md}\"",
  "lint:eslint": "eslint src/**/*.{ts,vue} --cache --fix",
  "lint:style": "stylelint src/**/*.{css,scss,vue} --cache --fix",
  "prepare": "husky install",
  "commitlint": "commitlint --config .commitlintrc.config.cjs -e -V",
  "preinstall": "node ./scripts/preinstall.js"
}
```
### element-plus配置

安装
```sh
pnpm i element-plus
```

配置
```ts
// main.ts
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
// @ts-ignore
import zhCn from 'element-plus/es/locale/lang/zh-cn'

const app = createApp(App)

app.use(ElementPlus, {
  locale: zhCn,
})

app.use(ElementPlus)
app.mount('#app')
```

### 其他配置

#### 配置路径别名
```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})
```
配置ts.config.json文件
```json
{
  "compilerOptions": {
    "baseUrl": "./",
    "paths": {
      "@/*": [
        "src/*"
      ]
    }
  }
}
```

#### 环境变量配置

创建.env.development文件
```env
# 变量必须以VITE_开头
NODE_ENV='development'
VITE_APP_TITLE = 'vue3+vite'
VITE_APP_BASE_API = '/dev-api'
VITE_SERVE = 'http://localhost:8080'
```

创建.env.production文件
```env
# 变量必须以VITE_开头
NODE_ENV='production'
VITE_APP_TITLE = 'vue3+vite'
VITE_APP_BASE_API = '/prod-api'
VITE_SERVE = 'http://localhost:8080'
```
创建.env.test文件
```env
# 变量必须以VITE_开头
NODE_ENV='test'
VITE_APP_TITLE = 'vue3+vite'
VITE_APP_BASE_API = '/test-api'
VITE_SERVE = 'http://localhost:8080'
```

配置package.json
```json
"scripts": {
  "build:test": "vue-tsc & vite build --mode test",
  "build:prod": "vue-tsc & vite build --mode production"
}
```

通过 `import.meta.env` 获取环境变量

#### svg图标配置

安装
```sh
pnpm install vite-plugin-svg-icons -D
```
配置vite.config.ts
```ts
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
export default defineConfig({
  plugins: [
    createSvgIconsPlugin({
      iconDirs: [path.resolve(process.cwd(), 'src/icons/svg')],
      symbolId: 'icon-[dir]-[name]'
    })
  ]
})
```

入口文件main.ts导入
```ts
import 'virtual:svg-icons-register'
```

创建全局组件, 新建components/SvgIcon/index.vue
```vue
<template>
  <svg :style="{'width': size + 'px', 'height': size + 'px'}" aria-hidden="true">
    <use :xlink:href="prefix + name" :fill="color"></use>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isExternal } from '@/utils/is'
const props = defineProps({
  iconClass: {
    type: String,
  },
  iconStyle: {
    type: Object,
    default: () => ({})
  },
  prefix: {
    type: String,
    default: '#icon-'
  },
  name: {
    type: String,
    default: ''
  },
  color: {
    type: String,
    default: ''
  },
  size: {
    type: [String, Number],
    default: 16
  }
})
</script>
```
main.ts全局引入
```ts

import { createApp } from 'vue'
import App from '@/App.vue'
import SvgIcon from '@/components/SvgIcon.vue'
createApp(App).component('SvgIcon', SvgIcon).mount('#app')
```


#### 配置sass
创建src/styles/reset.scss
```scss

  * {
    box-sizing: border-box;
    background-repeat: no-repeat;
    -webkit-tap-highlight-color: rgba(0,0,0,0);
  }

  body {
    margin: 0;
    line-height: 1;
  }

  article,
  aside,
  footer,
  header,
  nav,
  section,
  main,
  figcaption,
  figure,
  menu,
  details {
    display: block;
  }

  audio,
  canvas,
  video {
    display: inline-block;
  }

  img {
    display: block;
    border: 0;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0;
    padding: 0;
    font-weight: normal;
  }

  p {
    margin: 0;
    padding: 0;
  }

  address,
  cite,
  dfn,
  em,
  var {
    font-style: normal;
  }

  ul,
  ol {
    margin: 0;
    padding: 0;
    list-style-type: none;
  }

  a {
    background-color: transparent;
    font-size: inherit;
    color: inherit;
    text-decoration: none;

    &:active,
    &:hover {
      outline: 0;
    }
  }

  :focus {
    outline: 0;
  }

  button,
  input,
  select,
  textarea {
    margin: 0;
    font-size: inherit;
  }

  button,
  html [type="button"],
  [type="reset"],
  [type="submit"] {
    padding: 0;
    border: 0;
    color: inherit;
    background-color: transparent;
    -webkit-appearance: button;
    cursor: pointer;
  }

  button::-moz-focus-inner,
  input::-moz-focus-inner {
    border: 0;
    padding: 0;
  }

  input {
    padding: 0;
    line-height: normal;

    &::-webkit-input-placeholder {
      font-weight: 300;
    }

    &::-ms-input-placeholder {
      font-weight: 300;
    }

    &::-moz-placeholder {
      font-weight: 300;
    }
  }

  [type="number"] {
    -moz-appearance: textfield;

    &::-webkit-inner-spin-button,
    &::-webkit-outer-spin-button {
      margin: 0;
      height: auto;
      -webkit-appearance: none;
    }
  }

  [type="search"] {
    -webkit-appearance: textfield;

    &::-webkit-search-cancel-button,
    &::-webkit-search-decoration {
      -webkit-appearance: none;
    }
  }

  textarea {
    overflow: auto;
    resize: none;
    -webkit-appearance: none;
  }

  select {
    -webkit-appearance: none;
    background-color: #fff;
  }

  table {
    border-collapse: collapse;
    border-spacing: 0;
  }
```
创建src/styles/variables.scss
```scss
$color-primary: #007bff;
```
配置vite.config.js
```js
import { defineConfig } from 'vite'
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "./variables.scss";`
      }
    }
  }
})
```


创建src/styles/index.scss
```scss
// 引入重置样式
@import './reset.scss';

// 配置scss全局变量
@import './variables.scss';

```
main.ts全局引入
```ts
import '@/styles/index.scss'
```

#### moke数据

安装
```sh
pnpm i mockjs vite-plugin-mock -D
```
修改vite.config.ts
```ts
import { defineConfig } from 'vite'
import { viteMockServe } from 'vite-plugin-mock'
export default defineConfig(({ command })) => {
  return {
    plugins: [
      viteMockServe({
        localEnabled: command === 'serve'
      })
    ]
  }
})
```
创建mock文件夹


#### 封装axios

### scale实现数据大屏适配
















