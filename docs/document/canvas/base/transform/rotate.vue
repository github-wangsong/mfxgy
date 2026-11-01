<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** rotate：绕原点旋转坐标系，常与 translate 配合 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 未旋转的矩形
  ctx.fillStyle = '#475569'
  ctx.fillRect(30, 60, 80, 60)

  // 平移原点后旋转 30°，再以原点为中心画矩形
  ctx.save()
  ctx.translate(170, 90)
  ctx.rotate(Math.PI / 6)
  ctx.fillStyle = '#d97706'
  ctx.fillRect(-40, -30, 80, 60)
  ctx.restore()
})
</script>
