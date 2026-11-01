<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * fillRect：纯色填充矩形
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 纯色填充
  ctx.fillStyle = '#18794e'
  ctx.fillRect(x, y, 130, 100)
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

