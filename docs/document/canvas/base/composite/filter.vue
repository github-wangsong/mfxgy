<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** ctx.filter：绘图时直接套用 CSS 滤镜 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  ctx.fillStyle = '#0d9488'

  // 无滤镜
  ctx.fillRect(30, 40, 60, 100)

  // 高斯模糊
  ctx.filter = 'blur(6px)'
  ctx.fillRect(110, 40, 60, 100)

  // 灰度
  ctx.filter = 'grayscale(1)'
  ctx.fillRect(190, 40, 60, 100)

  // 复位滤镜
  ctx.filter = 'none'
})
</script>
