<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** isPointInPath / isPointInStroke：判断点是否命中路径或描边 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 圆形填充路径：判断点是否在内部
  ctx.beginPath()
  ctx.arc(100, 90, 60, 0, Math.PI * 2)
  ctx.fillStyle = '#0d9488'
  ctx.fill()

  // (140, 70) 在圆内
  const inPath = ctx.isPointInPath(140, 70)

  // 粗线条路径：判断点是否落在描边上
  ctx.beginPath()
  ctx.moveTo(180, 100)
  ctx.lineTo(260, 100)
  ctx.lineWidth = 20
  ctx.strokeStyle = ctx.isPointInStroke(220, 110) ? '#30a46c' : '#64748b'
  ctx.stroke()

  // 把判断结果写在画布上
  ctx.font = '14px sans-serif'
  ctx.fillStyle = '#334155'
  ctx.fillText(`isPointInPath → ${inPath}`, 20, 168)
})
</script>
