# Dialog 对话框

在保留当前页面状态的前提下，承载提示、表单或确认操作。

## 基础用法

使用 `v-model` 控制显隐，`title` 设置标题，默认插槽是内容区。

<preview path="./components/basic.vue"></preview>

## 自定义头部与底部

`header`、`default`、`footer` 三个插槽可以自由组合。

<preview path="./components/custom.vue"></preview>

## 设计要点

- **Teleport**：内容渲染到 `body`，避免被父元素的 `overflow: hidden`、`transform` 或 `z-index` 裁切。
- **焦点管理**：打开时记录触发元素并把焦点移入弹层，`Tab` 在弹层内循环，关闭后焦点回到原处。
- **滚动锁计数**：`useScrollLock` 用引用计数管理 `body.overflow`，多个弹层叠加时只有最后一个关闭才恢复滚动。
- **层级自增**：每次打开通过 `useZIndex` 取一个新的 `z-index`，后打开的弹层一定在上层。
- **过渡与事件**：`Transition` 的 `after-enter` / `after-leave` 分别派发 `opened` / `closed`，适合做动画结束后的副作用。
- **受控显隐**：内部只派发 `update:modelValue`，真正的显隐由父组件的 `v-model` 决定。

## API

### Dialog Props

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| modelValue | 是否显示，支持 `v-model` | boolean | `false` |
| title | 标题文本 | string | `''` |
| width | 对话框宽度，数字按 px 处理 | number / string | `50%` |
| top | 距离视口顶部的距离 | number / string | `15vh` |
| showClose | 是否显示右上角关闭按钮 | boolean | `true` |
| closeOnClickModal | 点击遮罩是否关闭 | boolean | `true` |
| closeOnPressEscape | 按 Esc 是否关闭 | boolean | `true` |
| lockScroll | 打开时是否锁定 body 滚动 | boolean | `true` |

### Dialog Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| update:modelValue | 请求更新显隐状态 | `(visible: boolean)` |
| open | 开始打开时触发 | — |
| opened | 打开动画结束时触发 | — |
| close | 开始关闭时触发 | — |
| closed | 关闭动画结束时触发 | — |

### Dialog Slots

| 插槽名 | 说明 |
| --- | --- |
| default | 对话框内容 |
| header | 自定义头部，会替换默认标题 |
| footer | 底部操作区 |

### Dialog Exposes

| 方法 / 属性 | 说明 |
| --- | --- |
| dialogRef | 内部对话框 DOM 元素 |
| handleClose | 请求关闭（派发 `update:modelValue(false)`） |
