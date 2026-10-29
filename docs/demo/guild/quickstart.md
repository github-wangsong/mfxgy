# 快速开始

本节介绍如何在 Vue 3 项目中使用 `mfxgy-ui`。

## 按需引入

```vue
<template>
  <MfButton type="primary" @click="handleClick">按钮</MfButton>
</template>

<script setup>
import { MfButton } from 'mfxgy-ui'

function handleClick() {
  console.log('clicked')
}
</script>
```

## 全局注册

```js
import { createApp } from 'vue'
import MfUI from 'mfxgy-ui'
import 'mfxgy-ui/style.css'
import App from './App.vue'

createApp(App).use(MfUI).mount('#app')
```

> 组件样式是独立产物，需要在入口引入一次 `mfxgy-ui/style.css`。

## 使用 Message

`Message` 是函数式组件，不需要写进模板：

```js
import { MfMessage } from 'mfxgy-ui'

MfMessage.success('保存成功')
MfMessage.error({ message: '操作失败，请重试', duration: 0, showClose: true })
```

## 组件命名约定

- 组件统一以 `Mf` 前缀命名，例如 `MfButton`、`MfInput`。
- 模板中既可以使用 `<MfButton>`，也可以使用 `<mf-button>`。
- 每个组件目录结构保持一致：`index.js` 负责导出与安装，`src/index.vue` 负责实现。

## 从哪里开始读源码

组件库自带一套教学文档，位于 `mfxgy-ui/docs/`：

- `docs/01-架构与源码导读.md`
- `docs/02-组件设计模式.md`
- `docs/03-构建与发布到npm.md`
- `docs/04-练习与进阶.md`
- `docs/05-单元测试.md`

推荐按下面的顺序阅读源码：

1. `packages/utils`：`isClient`、`addUnit`、`withInstall`
2. `packages/hook`：`useNamespace`、`useScrollLock`、`useZIndex`、`useFocusTrap`
3. `packages/components/button`：props / emits / slots / BEM
4. `packages/components/input`：受控组件与属性分流
5. `packages/components/switch`：异步守卫与无障碍
6. `packages/components/dialog`：Teleport / 焦点 / 滚动锁
7. `packages/components/message`：函数式调用与渲染队列

## 在文档站中查看示例

所有示例都放在 `docs/demo/examples/<组件名>/components` 下，页面通过 `<preview path="./components/xxx.vue" />` 引入：

```md
<preview path="./components/basic.vue"></preview>
```

示例文件内部再从 `mfxgy-ui` 引入组件，这就是文档站与组件库联调的最小闭环。
