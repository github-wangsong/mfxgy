<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** lineCap：线条端点的三种样式 butt / round / square */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  const caps = ['butt', 'round', 'square']
  const colors = ['#0d9488', '#d97706', '#30a46c']

  caps.forEach((cap, i) => {
    ctx.beginPath()
    ctx.moveTo(60, 45 + i * 45)
    ctx.lineTo(220, 45 + i * 45)
    ctx.lineCap = cap
    ctx.lineWidth = 16
    ctx.strokeStyle = colors[i]
    ctx.stroke()
  })
})
</script>
