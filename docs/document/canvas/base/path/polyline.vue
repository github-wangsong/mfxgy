<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** lineTo 连续折线：不调用 closePath，只描边不填充 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 楼梯折线
  ctx.beginPath()
  ctx.moveTo(40, 150)
  ctx.lineTo(90, 150)
  ctx.lineTo(90, 110)
  ctx.lineTo(140, 110)
  ctx.lineTo(140, 70)
  ctx.lineTo(190, 70)
  ctx.lineTo(190, 30)

  ctx.strokeStyle = '#0d9488'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
})
</script>
