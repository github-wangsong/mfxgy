<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** transform / setTransform / resetTransform：直接操作变换矩阵 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // transform(a, b, c, d, e, f)：这里加了水平斜切和平移
  ctx.setTransform(1, -0.2, 0.4, 1, 60, 40)
  ctx.fillStyle = '#d97706'
  ctx.fillRect(0, 0, 80, 80)

  // resetTransform：回到默认矩阵再画
  ctx.resetTransform()
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(170, 20, 80, 80)
})
</script>
