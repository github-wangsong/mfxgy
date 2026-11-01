<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** ellipse(cx, cy, rx, ry, rotation, start, end)：椭圆与旋转椭圆 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 水平椭圆
  ctx.beginPath()
  ctx.ellipse(140, 90, 80, 45, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#18794e'
  ctx.fill()

  // 旋转 45° 的椭圆描边
  ctx.beginPath()
  ctx.ellipse(140, 90, 80, 45, Math.PI / 4, 0, Math.PI * 2)
  ctx.strokeStyle = '#d97706'
  ctx.lineWidth = 2
  ctx.stroke()
})
</script>
