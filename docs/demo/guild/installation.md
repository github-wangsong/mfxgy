# 安装

`mfxgy-ui` 是一个从零实现的 Vue 3 组件库，当前包含 `Button`、`Input`、`Switch`、`Dialog`、`Message` 五个组件。

## 环境支持

- Vue 3.4+
- 现代浏览器（Chrome / Edge 100+、Firefox 100+、Safari 15.4+）
- 构建工具：Vite 5+、webpack 5 等支持 Vue SFC 的方案

## 版本

当前版本 `1.0.0`，已发布到 npm 官方仓库，可直接从 registry 安装。

## 安装

```sh
npm install mfxgy-ui
# 或
pnpm add mfxgy-ui
# 或
yarn add mfxgy-ui
```

Vue 是 `peerDependency`，需要项目自身安装 Vue 3.4+。

## 本地联调（可选）

包已发布到 npm，正常情况直接使用 `^1.0.0` 即可。若需要同时修改组件库源码，可以临时把依赖换成本地目录：

```json
{
  "dependencies": {
    "mfxgy-ui": "file:../mfxgy-ui"
  }
}
```

先构建组件库：

```sh
cd ../mfxgy-ui
pnpm install
pnpm build
```

再在业务项目执行：

```sh
pnpm install
```

此时 `import { MfButton } from 'mfxgy-ui'` 读取的是组件库的 `dist/` 产物，和正式 npm 包的行为一致。

> `file:` 依赖安装时会复制发布内容。每次修改组件后，需要先在 `mfxgy-ui` 执行 `pnpm build`，再到文档站执行一次 `pnpm install`，才能看到最新产物。

联调结束后切回正式版本：

```json
{
  "dependencies": {
    "mfxgy-ui": "^1.0.0"
  }
}
```

## 引入样式

组件样式在构建时统一抽取到 `dist/style.css`，需要在应用入口引入一次：

```js
import 'mfxgy-ui/style.css'
```

组件代码本身不会自动注入 CSS，忘记引入会出现“结构正确但完全没有样式”的情况。

## 按需引入

```js
import { MfButton, MfInput } from 'mfxgy-ui'
```

## TypeScript 支持

包内自带类型声明（`dist/index.d.ts`），TS 项目开箱即用，无需额外配置：

```ts
import { h } from 'vue'
import { MfButton, type MfButtonProps } from 'mfxgy-ui'

const props: MfButtonProps = { type: 'primary', size: 'large' }

h(MfButton, props)
```

模板 ref 也能拿到组件暴露的方法：

```ts
import { ref } from 'vue'
import type { MfInputInstance } from 'mfxgy-ui'

const inputRef = ref<MfInputInstance>()
inputRef.value?.focus()
```

全量注册后，`$message` 与全局组件名同样有类型提示。

## 全量注册

```js
import { createApp } from 'vue'
import MfUI from 'mfxgy-ui'
import 'mfxgy-ui/style.css'
import App from './App.vue'

createApp(App).use(MfUI).mount('#app')
```

全量注册后可直接使用 `<MfButton>`、`<MfInput>`、`<MfSwitch>`、`<MfDialog>`，同时挂载 `$message`：

```js
this.$message.success('保存成功')
```

## 文档站如何消费 npm 包

本站与组件库是两个独立目录。文档站的 `package.json` 已改为从 npm 安装：

```json
{
  "dependencies": {
    "mfxgy-ui": "^1.0.0"
  }
}
```

需要和源码同步联调时，再临时换回 `file:../mfxgy-ui`。

主题入口引入组件库样式：

```js
// .vitepress/theme/index.mjs
import 'mfxgy-ui/style.css'
```

示例文件统一从包名引入：

```js
import { MfButton, MfInput } from 'mfxgy-ui'
```

不再配置源码 alias，也不直接引用 `packages/` 下的 `.vue` 文件。这样文档站验证的就是最终发布产物。

## 主题

组件通过 CSS 变量读取主题色：

```css
:root {
  --mf-color-primary: #3b82f6;
  --mf-color-success: #22c55e;
  --mf-color-warning: #f59e0b;
  --mf-color-danger: #ef4444;
  --mf-color-info: #909399;
}
```

## 浏览器直接引入

暂不支持 UMD，请通过构建工具使用。
