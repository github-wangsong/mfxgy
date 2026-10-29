<style>
.mf-input + .mf-input {
  margin-top: 12px;
}
</style>

# Input 输入框

通过鼠标或键盘输入字符，支持 `v-model`、清空、密码显隐、前后缀和字数统计。

## 基础用法

<preview path="./components/basic.vue"></preview>

## 可清空与密码

<preview path="./components/clearable.vue"></preview>

## 前后缀与字数限制

<preview path="./components/slots.vue"></preview>

## 禁用、只读与尺寸

<preview path="./components/state.vue"></preview>

## 设计要点

- **属性分流**：`inheritAttrs: false` 后，`class` / `style` 留给根容器，`id`、`name`、`aria-*` 等其他属性透传给内部原生 `<input>`。
- **受控组件**：组件只通过 `modelValue` 展示值，通过 `update:modelValue` 请求更新，父组件不更新时输入框仍是"受控"的。
- **输入法兼容**：`compositionstart` 到 `compositionend` 之间不提交值，避免中文拼音阶段触发搜索或校验。
- **焦点保持**：清空、密码显隐按钮使用 `@mousedown.prevent`，点击时不会让输入框失焦。
- **状态用 `computed` 收敛**：`showClear`、`showWordLimit`、`inputType` 都由 props 和局部状态推导，模板只负责渲染。

## API

### Input Props

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| modelValue | 绑定值，支持 `v-model` | string / number | `''` |
| type | 原生输入类型，密码框可配合 `show-password` | string | `text` |
| size | 尺寸，可选 `large`、`small` | string | `''` |
| placeholder | 占位文本 | string | `''` |
| disabled | 是否禁用 | boolean | `false` |
| readonly | 是否只读 | boolean | `false` |
| clearable | 是否显示清空按钮 | boolean | `false` |
| show-password | 是否显示密码显隐按钮（`type="password"` 时生效） | boolean | `false` |
| maxlength | 最大输入长度 | number / string | — |
| show-word-limit | 是否显示字数统计，需配合 `maxlength` | boolean | `false` |
| autocomplete | 原生自动完成属性 | string | `off` |

### Input Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| update:modelValue | 输入值变化 | `(value: string)` |
| input | 输入值变化（与 `update:modelValue` 同时触发） | `(value: string)` |
| change | 原生 `change` 事件 | `(value: string)` |
| focus | 获得焦点 | `(event: FocusEvent)` |
| blur | 失去焦点 | `(event: FocusEvent)` |
| clear | 点击清空按钮 | — |

### Input Slots

| 插槽名 | 说明 |
| --- | --- |
| prefix | 输入框头部内容 |
| suffix | 输入框尾部内容 |

### Input Exposes

| 方法 / 属性 | 说明 |
| --- | --- |
| focus | 让输入框获得焦点 |
| blur | 让输入框失去焦点 |
| select | 选中输入框文本 |
| input | 内部原生 `input` 元素 |
