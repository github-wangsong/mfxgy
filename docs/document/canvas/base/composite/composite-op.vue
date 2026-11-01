<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** globalCompositeOperation：两个图形的混合方式 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  const modes = ['source-over', 'multiply', 'screen', 'destination-out']

  modes.forEach((mode, i) => {
    const x = 22 + i * 60

    // 切换合成模式后，再画两个重叠的圆
    ctx.globalCompositeOperation = mode

    ctx.fillStyle = '#0d9488'
    ctx.beginPath()
    ctx.arc(x + 20, 70, 26, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#d97706'
    ctx.beginPath()
    ctx.arc(x + 40, 100, 26, 0, Math.PI * 2)
    ctx.fill()
  })

  // 复位成默认模式，避免影响后续绘制
  ctx.globalCompositeOperation = 'source-over'
})
</script>
