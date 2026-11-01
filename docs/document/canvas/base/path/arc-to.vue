<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** arcTo：用圆弧连接两条相切线，常用来画圆角矩形 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

/** 四段 arcTo 拼出圆角矩形路径 */
function roundRectPath (ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 圆角矩形
  roundRectPath(ctx, 60, 30, 160, 120, 30)
  ctx.fillStyle = '#18794e'
  ctx.fill()
})
</script>
