<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** lineJoin：折线拐角的三种样式 miter / round / bevel */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  const joins = ['miter', 'round', 'bevel']
  const colors = ['#d97706', '#0d9488', '#30a46c']
  const xs = [60, 140, 220]

  joins.forEach((join, i) => {
    ctx.beginPath()
    ctx.moveTo(xs[i] - 30, 140)
    ctx.lineTo(xs[i], 40)
    ctx.lineTo(xs[i] + 30, 140)
    ctx.lineJoin = join
    ctx.lineWidth = 16
    ctx.strokeStyle = colors[i]
    ctx.stroke()
  })
})
</script>
