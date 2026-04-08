
# svg

## 绘制矩形, 圆形,椭圆形

- rect
  - width
  - height
  - fill: 填充颜色
  - stroke: 边框颜色
  - stroke-width: 边框宽度
  - x: x坐标
  - y: y坐标
  - stroke-opacity: 边框透明度
  - fill-opacity: 填充透明度
  - opacity: 透明度
  - rx: 圆角
  - ry: 圆角
- circle
  - cx: x坐标
  - cy: y坐标
  - r: 半径
  - fill: 填充颜色
  - stroke: 边框颜色
  - stroke-width: 边框宽度
- ellipse
  - cx: x坐标
  - cy: y坐标
  - rx: 横向半径
  - ry: 纵向半径 
 
```xml

  <svg width="100" height="100">
    <rect width="100" height="100" fill="red" stroke="blue" stroke-width="3" ></rect>
  </svg>
  <svg width="100" height="100">
    <circle cx="50" cy="50" r="50" fill="blue"></circle>
  </svg>
  <svg width="100" height="100">
    <ellipse cx="50" cy="50" rx="30" ry="20" fill="green"></ellipse>
  </svg>

```

## 绘制线条,多边形, 多线条
- line
  - x1: x坐标
  - y1: y坐标
  - x2: x坐标
  - y2: y坐标
- polygon
  - points: x1,y1,x2,y2,x3,y3...
- polyline
  - points: x1,y1,x2,y2,x3,y3... 


```xml
<svg width="100" height="100">
  <line x1="0" y1="0" x2="100" y2="100" stroke="red" stroke-width="3"></line>
</svg>

 <!-- 绘制五角星 -->
<svg width="500" height="210">
  <polygon points="100,10 40,198 198,78 10,78 160,198" fill="yellow" stroke='purple' stroke-width='5'></polygon>
</svg>

<!-- 绘制楼梯剖面图 -->
<svg width="500" height="180">
  <polyline points="0,40 40,40 40,80 80,80 80,120 120,120 120,160" fill="none" stroke='purple' stroke-width='5'></polyline>
</svg>
```

## 绘制文本
- text
  - x: x坐标
  - y: y坐标
  - font-size: 字体大小
  - font-family: 字体
  - font-weight: 字体粗细
  - font-style: 字体样式
  - text-anchor: 文本对齐方式
  - fill: 填充颜色

```xml
<svg width="500" height="180">
  <text x="100" y="100" font-size="30" font-family="Arial" font-weight="bold" font-style="italic" text-anchor="middle" fill="red">Hello World</text>
</svg>
<svg width="200" height="90">
  <text x="10" y="10" fill="red">
    Hello World
    <tspan x="10" y="30">Hello World</tspan>
    <tspan x="10" y="50">Hello World</tspan>
  </text>
</svg>

```
## 绘制路径
- path
  - d: 路径
    -  




 
