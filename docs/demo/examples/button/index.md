<style>
.mf-button {
  margin: 10px 5px;
}

details > summary:first-of-type {
  font-size: 10px;
  padding: 8px 0;
  cursor: pointer;
  color: #1989fa;
}
</style>

# Button 按钮

常用的操作按钮。本页示例全部来自自研组件库 `mfxgy-ui`，不再依赖 Element Plus。

## 基础用法

使用 `type`、`plain`、`round`、`circle` 组合出不同的按钮形态。

<preview path="./components/aaa.vue"></preview>

## 禁用状态

`disabled` 会拦截点击，同时输出 `aria-disabled`，让屏幕阅读器也能感知状态。

<preview path="./components/bbb.vue"></preview>

## 调整尺寸

内置 `large`、默认、`small` 三种尺寸。

<preview path="./components/ccc.vue"></preview>

## 加载状态

`loading` 会渲染旋转指示器，并让按钮暂时不可点击，常用于表单提交。

<preview path="./components/ddd.vue"></preview>

## 设计要点

- **BEM 命名**：统一通过 `useNamespace('button')` 生成 `mf-button`、`mf-button__icon`、`mf-button--primary` 等类名，避免样式冲突。
- **视觉类型与原生类型分离**：`type` 表示外观，`nativeType` 才是原生 `button` 的 `type`，避免两个语义互相污染。
- **属性透传**：`inheritAttrs: false` 后把 `$attrs` 显式绑定到根节点，既能让 `class`、`style` 自动合并，也能把 `aria-*`、`autofocus` 等原生属性交给按钮。
- **状态优先级**：`disabled || loading` 统一收敛成 `isDisabled`，点击、原生 `disabled`、`aria-disabled` 都读同一份状态。
- **主题变量**：主色读取 `--mf-color-primary`，每种类型再用 `--mf-button-main` 等局部变量覆盖，改主题只需要覆盖 CSS 变量。

## API

### Button Props

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| type | 按钮视觉类型，可选 `primary`、`success`、`warning`、`danger`、`info` | string | `''` |
| size | 按钮尺寸，可选 `large`、`small` | string | `''` |
| plain | 是否为朴素按钮 | boolean | `false` |
| round | 是否为圆角按钮 | boolean | `false` |
| circle | 是否为圆形按钮 | boolean | `false` |
| text | 是否为文字按钮 | boolean | `false` |
| link | 是否为链接按钮 | boolean | `false` |
| disabled | 是否禁用 | boolean | `false` |
| loading | 是否处于加载状态 | boolean | `false` |
| native-type | 原生 `type` 属性 | string | `button` |
| tag | 渲染的标签名 | string | `button` |

### Button Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| click | 点击按钮且未禁用时触发 | `(event: MouseEvent)` |

### Button Slots

| 插槽名 | 说明 |
| --- | --- |
| default | 按钮内容 |
| icon | 按钮图标，和默认插槽同时存在时自动留出间距 |
