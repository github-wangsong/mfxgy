<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** beginPath / moveTo / lineTo / closePath：绘制多边形 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 三角形路径：起点 → 两个顶点 → 闭合
  ctx.beginPath()
  ctx.moveTo(70, 145)
  ctx.lineTo(140, 30)
  ctx.lineTo(210, 145)
  ctx.closePath()

  ctx.fillStyle = '#d97706'
  ctx.fill()
})
</script>
