# Message 消息提示

常用于主动操作后的反馈，支持函数式调用、自动关闭、悬停暂停和手动关闭。

## 基础用法

<preview path="./components/basic.vue"></preview>

## 常驻与堆叠

`duration: 0` 表示不自动关闭；多条消息会自动纵向堆叠。

<preview path="./components/closable.vue"></preview>

## 设计要点

- **函数式组件**：`MfMessage()` 内部用 `h()` 创建 VNode、`render()` 渲染到临时容器，调用方不需要在模板里声明组件。
- **响应式队列**：模块级 `reactive([])` 保存消息列表，容器组件渲染这个列表，增删消息会自动更新视图。
- **生命周期闭环**：消息关闭后不立即删除，等 `Transition` 的 `after-leave` 再派发 `destroy`，保证离场动画完整播放。
- **悬停暂停**：`mouseenter` 清除定时器，`mouseleave` 重新计时，用户阅读时不会被突然关闭。
- **SSR 安全**：函数内部先判断 `isClient`，在服务端渲染阶段返回空句柄，不会访问 `document`。
- **主题色**：每种类型只覆盖一个 `--mf-message-color`，图标、边框等样式共享同一套结构。

## API

### MfMessage 选项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| message | 消息正文 | string | `''` |
| type | 消息类型，可选 `success`、`warning`、`info`、`error` | string | `info` |
| duration | 自动关闭时间（毫秒），`0` 表示不自动关闭 | number | `3000` |
| showClose | 是否显示关闭按钮 | boolean | `false` |
| onClose | 消息关闭时的回调 | function | — |

### MfMessage 方法

| 方法 | 说明 | 参数 |
| --- | --- | --- |
| `MfMessage(options)` | 创建一条消息 | 选项对象或字符串 |
| `MfMessage.success(options)` | 创建成功消息 | 选项对象或字符串 |
| `MfMessage.warning(options)` | 创建警告消息 | 选项对象或字符串 |
| `MfMessage.info(options)` | 创建信息消息 | 选项对象或字符串 |
| `MfMessage.error(options)` | 创建错误消息 | 选项对象或字符串 |
| `MfMessage.closeAll()` | 关闭当前所有消息 | — |

### 返回值

| 属性 | 说明 |
| --- | --- |
| close | 手动关闭当前消息 |
| id | 当前消息的唯一 id |
