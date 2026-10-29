# Switch 开关

表示两种互斥状态之间的切换，支持异步拦截、加载态和自定义状态值。

## 基础用法

<preview path="./components/basic.vue"></preview>

## 禁用与加载

<preview path="./components/state.vue"></preview>

## 异步拦截

`before-change` 返回 `Promise<boolean>`，在异步请求完成前开关会显示加载态，返回 `false` 则不切换。

<preview path="./components/before-change.vue"></preview>

## 设计要点

- **值与状态解耦**：`modelValue` 可以不是布尔值，而是任意 `activeValue` / `inactiveValue`，组件内部用 `checked` 派生当前状态。
- **异步守卫**：`beforeChange` 的返回值决定是否提交更新，失败时只触发 `error`，不会污染 `v-model`。
- **无障碍**：根节点使用原生 `<button>`，带 `role="switch"`、`aria-checked`、`aria-disabled`，回车 / 空格键天然可用。
- **宽度可配置**：`width` 写入 CSS 变量 `--mf-switch-width`，轨道宽度和滑块位移都从同一个变量计算，避免 JS 计算样式。
- **加载优先**：`loading` 与内部 `switching` 合并为 `actualLoading`，加载期间同样阻止重复点击。

## API

### Switch Props

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| modelValue | 绑定值，支持 `v-model` | boolean / string / number | `false` |
| activeValue | 开启时的值 | boolean / string / number | `true` |
| inactiveValue | 关闭时的值 | boolean / string / number | `false` |
| disabled | 是否禁用 | boolean | `false` |
| loading | 是否显示加载态 | boolean | `false` |
| activeText | 开启时的文字 | string | `''` |
| inactiveText | 关闭时的文字 | string | `''` |
| width | 轨道宽度，数字按 px 处理 | number / string | `''` |
| beforeChange | 切换前的守卫函数，返回 `false` 取消切换 | function | — |

### Switch Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| update:modelValue | 状态变化 | `(value: boolean \| string \| number)` |
| change | 状态变化后触发 | `(value: boolean \| string \| number)` |
| error | `beforeChange` 抛出异常时触发 | `(error: unknown)` |

### Switch Exposes

| 方法 / 属性 | 说明 |
| --- | --- |
| ref | 内部根 `<button>` 元素 |
