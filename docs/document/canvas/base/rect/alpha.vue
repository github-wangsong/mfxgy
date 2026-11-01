<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * globalAlpha：半透明矩形叠加
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 底层不透明矩形
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(x, y, 130, 100)

  // 上面叠两个 60% 不透明的矩形
  ctx.globalAlpha = 0.6
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(x + 12, y + 16, 72, 64)
  ctx.fillStyle = '#d97706'
  ctx.fillRect(x + 46, y + 28, 72, 64)
  // 复位透明度
  ctx.globalAlpha = 1
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

