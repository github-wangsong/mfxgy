<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** arc(cx, cy, r, startAngle, endAngle)：整圆、圆弧 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 整圆：0 → 2π
  ctx.beginPath()
  ctx.arc(85, 90, 50, 0, Math.PI * 2)
  ctx.fillStyle = '#18794e'
  ctx.fill()

  // 圆弧：0.2π → 1.4π
  ctx.beginPath()
  ctx.arc(195, 90, 50, Math.PI * 0.2, Math.PI * 1.4)
  ctx.strokeStyle = '#d97706'
  ctx.lineWidth = 8
  ctx.lineCap = 'round'
  ctx.stroke()
})
</script>
