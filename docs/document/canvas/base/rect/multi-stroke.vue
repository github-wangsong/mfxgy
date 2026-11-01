<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * lineWidth：多层描边矩形
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 三层描边，线宽依次递增、颜色依次变淡
  ctx.strokeStyle = '#18794e'
  ctx.lineWidth = 2
  ctx.strokeRect(x + 10.5, y + 10.5, 109, 79)

  ctx.strokeStyle = '#30a46c'
  ctx.lineWidth = 6
  ctx.strokeRect(x + 10, y + 10, 110, 80)

  ctx.strokeStyle = 'rgba(48, 164, 108, 0.35)'
  ctx.lineWidth = 14
  ctx.strokeRect(x + 10, y + 10, 110, 80)
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

