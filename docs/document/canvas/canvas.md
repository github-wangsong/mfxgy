<div class="canvas-doc">

# Canvas 快速查阅

每个示例都能看到图像；点卡片右上角的代码图标展开源码，点复制图标可直接拷贝整段组件代码。

## 矩形

<div class="demo-grid">

<article class="demo-item">

### 纯色填充 `fillRect`

<preview path="./base/rect/fill.vue" title="fillRect"></preview>

</article>

<article class="demo-item">

### 纯色描边 `strokeRect`

<preview path="./base/rect/stroke.vue" title="strokeRect"></preview>

</article>

<article class="demo-item">

### 线性渐变填充 `createLinearGradient`

<preview path="./base/rect/gradient.vue" title="createLinearGradient + fillRect"></preview>

</article>

<article class="demo-item">

### 虚线描边 `setLineDash`

<preview path="./base/rect/dash.vue" title="setLineDash + strokeRect"></preview>

</article>

<article class="demo-item">

### 阴影 `shadowBlur`

<preview path="./base/rect/shadow.vue" title="shadowBlur + shadowOffsetX/Y"></preview>

</article>

<article class="demo-item">

### 半透明叠加 `globalAlpha`

<preview path="./base/rect/alpha.vue" title="globalAlpha"></preview>

</article>

<article class="demo-item">

### 擦除缺口 `clearRect`

<preview path="./base/rect/clear.vue" title="clearRect"></preview>

</article>

<article class="demo-item">

### 多层描边 `lineWidth`

<preview path="./base/rect/multi-stroke.vue" title="lineWidth + strokeRect"></preview>

</article>

</div>

## 路径

<div class="demo-grid">

<article class="demo-item">

### 多边形

<preview path="./base/path/polygon.vue" title="beginPath + moveTo + lineTo + closePath"></preview>

</article>

<article class="demo-item">

### 折线

<preview path="./base/path/polyline.vue" title="lineTo 连续折线"></preview>

</article>

<article class="demo-item">

### 二次贝塞尔曲线

<preview path="./base/path/quadratic.vue" title="quadraticCurveTo"></preview>

</article>

<article class="demo-item">

### 三次贝塞尔曲线

<preview path="./base/path/bezier.vue" title="bezierCurveTo"></preview>

</article>

<article class="demo-item">

### 填充规则 nonzero / evenodd

<preview path="./base/path/fill-rule.vue" title="fill('nonzero') / fill('evenodd')"></preview>

</article>

<article class="demo-item">

### 圆角矩形

<preview path="./base/path/arc-to.vue" title="arcTo"></preview>

</article>

</div>

## 圆与圆弧

<div class="demo-grid">

<article class="demo-item">

### 圆与圆弧

<preview path="./base/arc/arc.vue" title="arc"></preview>

</article>

<article class="demo-item">

### 扇形

<preview path="./base/arc/sector.vue" title="moveTo + arc + closePath"></preview>

</article>

<article class="demo-item">

### 椭圆

<preview path="./base/arc/ellipse.vue" title="ellipse"></preview>

</article>

</div>

## 线条样式

<div class="demo-grid">

<article class="demo-item">

### 端点样式

<preview path="./base/line/cap.vue" title="lineCap"></preview>

</article>

<article class="demo-item">

### 拐角样式

<preview path="./base/line/join.vue" title="lineJoin"></preview>

</article>

<article class="demo-item">

### 虚线与偏移

<preview path="./base/line/dash-offset.vue" title="lineDashOffset + getLineDash"></preview>

</article>

</div>

## 渐变与图案

<div class="demo-grid">

<article class="demo-item">

### 线性渐变

<preview path="./base/gradient/linear.vue" title="createLinearGradient"></preview>

</article>

<article class="demo-item">

### 径向渐变

<preview path="./base/gradient/radial.vue" title="createRadialGradient"></preview>

</article>

<article class="demo-item">

### 锥形渐变

<preview path="./base/gradient/conic.vue" title="createConicGradient"></preview>

</article>

<article class="demo-item">

### 图案平铺

<preview path="./base/gradient/pattern.vue" title="createPattern"></preview>

</article>

</div>

## 文字

<div class="demo-grid">

<article class="demo-item">

### 填充文字

<preview path="./base/text/fill-text.vue" title="font + fillText"></preview>

</article>

<article class="demo-item">

### 描边文字

<preview path="./base/text/stroke-text.vue" title="strokeText"></preview>

</article>

<article class="demo-item">

### 水平对齐

<preview path="./base/text/align.vue" title="textAlign"></preview>

</article>

<article class="demo-item">

### 垂直基线

<preview path="./base/text/baseline.vue" title="textBaseline"></preview>

</article>

<article class="demo-item">

### 文字测量

<preview path="./base/text/measure.vue" title="measureText"></preview>

</article>

</div>

## 变换与裁剪

<div class="demo-grid">

<article class="demo-item">

### 平移

<preview path="./base/transform/translate.vue" title="translate"></preview>

</article>

<article class="demo-item">

### 旋转

<preview path="./base/transform/rotate.vue" title="rotate"></preview>

</article>

<article class="demo-item">

### 缩放与镜像

<preview path="./base/transform/scale.vue" title="scale"></preview>

</article>

<article class="demo-item">

### 矩阵变换

<preview path="./base/transform/transform.vue" title="setTransform + resetTransform"></preview>

</article>

<article class="demo-item">

### 裁剪

<preview path="./base/transform/clip.vue" title="clip"></preview>

</article>

</div>

## 图片

<div class="demo-grid">

<article class="demo-item">

### 绘制图片

<preview path="./base/image/draw-image.vue" title="drawImage 三参数 / 五参数"></preview>

</article>

<article class="demo-item">

### 裁剪绘制

<preview path="./base/image/draw-image-9.vue" title="drawImage 九参数"></preview>

</article>

<article class="demo-item">

### 图像平滑

<preview path="./base/image/smoothing.vue" title="imageSmoothingEnabled + imageSmoothingQuality"></preview>

</article>

</div>

## 合成与滤镜

<div class="demo-grid">

<article class="demo-item">

### 合成模式

<preview path="./base/composite/composite-op.vue" title="globalCompositeOperation"></preview>

</article>

<article class="demo-item">

### CSS 滤镜

<preview path="./base/composite/filter.vue" title="ctx.filter"></preview>

</article>

</div>

## 像素

<div class="demo-grid">

<article class="demo-item">

### 读取与写回像素

<preview path="./base/pixel/image-data.vue" title="getImageData + putImageData"></preview>

</article>

<article class="demo-item">

### 生成像素图像

<preview path="./base/pixel/create-image-data.vue" title="createImageData"></preview>

</article>

</div>

## 动画

<div class="demo-grid">

<article class="demo-item">

### 逐帧动画

<preview path="./base/animation/raf.vue" title="requestAnimationFrame + cancelAnimationFrame"></preview>

</article>

</div>

## 状态与命中检测

<div class="demo-grid">

<article class="demo-item">

### 保存与还原状态

<preview path="./base/state/save-restore.vue" title="save + restore"></preview>

</article>

<article class="demo-item">

### 命中检测

<preview path="./base/state/hit-test.vue" title="isPointInPath + isPointInStroke"></preview>

</article>

</div>

</div>
