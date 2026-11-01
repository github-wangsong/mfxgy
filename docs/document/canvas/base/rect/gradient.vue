<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * createLinearGradient：线性渐变填充矩形
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 从左上到右下的线性渐变
  const gradient = ctx.createLinearGradient(x, y, x + 130, y + 100)
  gradient.addColorStop(0, '#0d9488')
  gradient.addColorStop(1, '#18794e')
  ctx.fillStyle = gradient
  ctx.fillRect(x, y, 130, 100)
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

