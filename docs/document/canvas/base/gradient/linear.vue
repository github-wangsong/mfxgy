<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** createLinearGradient + addColorStop：线性渐变 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 从左上角到右下角的渐变，支持多个色标
  const gradient = ctx.createLinearGradient(40, 30, 240, 150)
  gradient.addColorStop(0, '#0d9488')
  gradient.addColorStop(0.5, '#18794e')
  gradient.addColorStop(1, '#d97706')

  ctx.fillStyle = gradient
  ctx.fillRect(40, 30, 200, 120)
})
</script>
