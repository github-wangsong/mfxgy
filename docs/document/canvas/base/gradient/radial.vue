<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** createRadialGradient：径向（圆形）渐变 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 内圆半径 5，外圆半径 85，同心
  const gradient = ctx.createRadialGradient(140, 90, 5, 140, 90, 85)
  gradient.addColorStop(0, '#d1fae5')
  gradient.addColorStop(0.6, '#30a46c')
  gradient.addColorStop(1, '#18794e')

  ctx.fillStyle = gradient
  ctx.fillRect(40, 5, 200, 170)
})
</script>
