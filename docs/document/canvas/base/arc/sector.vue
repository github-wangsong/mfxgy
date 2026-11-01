<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** arc + moveTo + closePath：绘制饼图扇形 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  const cx = 140
  const cy = 90
  const r = 60
  const sectors = [
    { from: -Math.PI / 2, to: 0.4, color: '#0d9488' },
    { from: 0.4, to: Math.PI * 0.9, color: '#30a46c' },
    { from: Math.PI * 0.9, to: Math.PI * 1.5, color: '#d97706' }
  ]

  sectors.forEach((sector) => {
    ctx.beginPath()
    ctx.moveTo(cx, cy)          // 先连到圆心
    ctx.arc(cx, cy, r, sector.from, sector.to)
    ctx.closePath()
    ctx.fillStyle = sector.color
    ctx.fill()
  })
})
</script>
