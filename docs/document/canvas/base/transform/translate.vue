<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** translate：平移坐标系原点 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 平移前：以左上角为原点
  ctx.fillStyle = '#475569'
  ctx.fillRect(20, 20, 60, 60)

  // 平移原点后再画，坐标都相对新原点
  ctx.translate(130, 60)
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(0, 0, 60, 60)
})
</script>
