# 快速安装与配置 (Vue 3 + Vite)

## 1.安装依赖
```bash
# 安装核心包和 Vite 插件
npm install tailwindcss @tailwindcss/vite
```
## 2. 配置 Vite
打开 `vite.config.ts` (或 `vite.config.js`)，引入并添加插件：
```js

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite' // 引入插件

export default defineConfig({
  plugins: [
    tailwindcss(), // 添加到插件列表
    // ...其他插件
  ],
})

```

## 3. 引入 CSS
在你的主 CSS 文件（通常是 `src/style.css` 或 `src/assets/main.css`）顶部添加以下代码：
```css

@import "tailwindcss";
```

# 核心概念与基础用法

## 速查表
功能	| 类名示例	| 说明
| :------ | :-------: | ------: |
布局 |	flex, grid, block, hidden	| 对应 display 属性
间距 |	p-4, m-2, px-10, gap-4	p=padding, m=margin, | x=水平
尺寸 |	w-full, h-screen, max-w-md	w=width, h=height
排版 |	text-center, text-xl, font-bold	| 文字对齐、大小、粗细
颜色 |	text-white, bg-blue-500	| 文字颜色、背景颜色
圆角 |	rounded, rounded-full	| 圆角大小
阴影 |	shadow, shadow-lg	| 阴影深度

## 1. 响应式设计 (移动端优先)
Tailwind 默认是移动端优先。使用 sm:, md:, lg: 前缀来针对大屏幕调整样式。

```html
<!-- 手机上宽全屏，平板上宽一半，电脑上宽三分之一 -->
<div class="w-full md:w-1/2 lg:w-1/3"></div>

<!-- 手机上单列，平板上双列 -->
<div class="grid grid-cols-1 md:grid-cols-2"></div>
```

## 2. 状态变体 (悬停、聚焦、暗黑模式)
直接在类名前加状态前缀。
- 悬停变色：bg-blue-500 hover:bg-blue-700
- 暗黑模式：bg-white dark:bg-black text-black dark:text-white
  - 注：需在 html 标签上手动切换 class="dark" 来启用暗黑模式。
- 焦点状态：outline-none focus:ring-2 focus:ring-blue-400
## 3. 任意值 (JIT 模式)
如果预设的值（如 w-96）不够用，你可以使用中括号 [] 直接写 CSS 值，无需写额外配置文件。
```html
<!-- 自定义宽度 100px -->
<div class="w-[100px]"></div>

<!-- 自定义背景色 -->
<div class="bg-[#1da1f2]"></div>

<!-- 自定义字体大小 -->
<div class="text-[14px]"></div>
```
