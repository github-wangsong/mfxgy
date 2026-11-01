<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** measureText：测量文字宽度，用于精确居中或加框 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  ctx.font = '600 28px sans-serif'
  ctx.textBaseline = 'middle'

  const text = 'measureText'
  const width = ctx.measureText(text).width

  // 按测量出的宽度画外框并让文字居中
  ctx.strokeStyle = '#d97706'
  ctx.lineWidth = 2
  ctx.strokeRect((280 - width) / 2, 60, width, 60)

  ctx.fillStyle = '#0d9488'
  ctx.fillText(text, (280 - width) / 2, 90)
})
</script>
