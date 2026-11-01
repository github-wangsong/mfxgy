<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * shadowBlur：带阴影的矩形
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 浅色底上用深色投影，阴影才看得出来
  ctx.shadowColor = 'rgba(15, 23, 42, 0.35)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 6
  ctx.shadowOffsetY = 6
  ctx.fillStyle = '#18794e'
  ctx.fillRect(x, y, 130, 100)

  // 画完立刻复位阴影，避免影响后续绘制
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

