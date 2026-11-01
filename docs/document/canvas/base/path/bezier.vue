<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** bezierCurveTo：两个控制点的三次贝塞尔曲线 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 两段三次曲线拼成一条波浪
  ctx.beginPath()
  ctx.moveTo(40, 120)
  ctx.bezierCurveTo(40, 20, 120, 20, 140, 100)
  ctx.bezierCurveTo(160, 20, 240, 20, 240, 120)

  ctx.strokeStyle = '#d97706'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.stroke()
})
</script>
