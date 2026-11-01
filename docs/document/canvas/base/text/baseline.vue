<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** textBaseline：文字与基线的关系 top / middle / alphabetic / bottom */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  const baselines = ['top', 'middle', 'alphabetic', 'bottom']
  ctx.font = '18px sans-serif'
  ctx.textAlign = 'left'

  baselines.forEach((baseline, i) => {
    const y = 35 + i * 35

    // 参考横线：文字按不同的基线贴在这条线上
    ctx.strokeStyle = '#475569'
    ctx.beginPath()
    ctx.moveTo(20, y)
    ctx.lineTo(260, y)
    ctx.stroke()

    ctx.textBaseline = baseline
    ctx.fillStyle = '#0d9488'
    ctx.fillText(baseline, 24, y)
  })
})
</script>
