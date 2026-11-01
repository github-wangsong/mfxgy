<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** textAlign：left / center / right 水平对齐 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 一条参考竖线，方便对比对齐位置
  ctx.strokeStyle = '#64748b'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(140, 20)
  ctx.lineTo(140, 160)
  ctx.stroke()
  ctx.setLineDash([])

  const aligns = ['left', 'center', 'right']
  ctx.font = '20px sans-serif'
  ctx.fillStyle = '#0d9488'

  aligns.forEach((align, i) => {
    ctx.textAlign = align
    ctx.fillText(align, 140, 45 + i * 45)
  })
})
</script>
