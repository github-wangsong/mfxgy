<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** scale：放大、缩小，甚至用负数做镜像 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 原始尺寸
  ctx.fillStyle = '#475569'
  ctx.fillRect(30, 70, 60, 40)

  // 放大 1.8 倍
  ctx.save()
  ctx.translate(90, 60)
  ctx.scale(1.8, 1.8)
  ctx.fillStyle = '#d97706'
  ctx.fillRect(0, 0, 60, 40)
  ctx.restore()

  // 水平镜像（scale 传负数）
  ctx.save()
  ctx.translate(280, 40)
  ctx.scale(-1, 1)
  ctx.fillStyle = '#0d9488'
  ctx.font = '700 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('镜像', 60, 60)
  ctx.restore()
})
</script>
