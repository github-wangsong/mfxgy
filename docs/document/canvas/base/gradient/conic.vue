<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** createConicGradient：锥形（围绕中心旋转）渐变 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 老浏览器不支持锥形渐变，直接返回
  if (typeof ctx.createConicGradient !== 'function') return

  // 起始角 0，围绕圆心 (140, 90)
  const gradient = ctx.createConicGradient(0, 140, 90)
  gradient.addColorStop(0, '#0d9488')
  gradient.addColorStop(0.25, '#30a46c')
  gradient.addColorStop(0.5, '#d97706')
  gradient.addColorStop(0.75, '#d97706')
  gradient.addColorStop(1, '#0d9488')

  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(140, 90, 80, 0, Math.PI * 2)
  ctx.fill()
})
</script>
