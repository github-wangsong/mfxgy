<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** strokeText + lineWidth：描边文字 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  ctx.font = '700 40px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 先填充再描边，文字更饱满
  ctx.fillStyle = '#0d9488'
  ctx.fillText('strokeText', 140, 90)

  ctx.strokeStyle = '#d97706'
  ctx.lineWidth = 2
  ctx.strokeText('strokeText', 140, 90)
})
</script>
