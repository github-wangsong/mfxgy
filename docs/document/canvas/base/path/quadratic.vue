<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** quadraticCurveTo：一个控制点的二次贝塞尔曲线 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 起点 (30,140)，控制点 (140,10)，终点 (250,140)
  ctx.beginPath()
  ctx.moveTo(30, 140)
  ctx.quadraticCurveTo(140, 10, 250, 140)

  ctx.strokeStyle = '#30a46c'
  ctx.lineWidth = 5
  ctx.stroke()

  // 标出控制点位置
  ctx.beginPath()
  ctx.arc(140, 10, 6, 0, Math.PI * 2)
  ctx.fillStyle = '#d97706'
  ctx.fill()
})
</script>
