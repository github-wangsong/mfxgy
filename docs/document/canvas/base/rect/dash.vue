<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * setLineDash：虚线描边矩形
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 虚线描边：12px 实线 + 8px 空隙
  ctx.setLineDash([12, 8])
  ctx.strokeStyle = '#0d9488'
  ctx.lineWidth = 4
  ctx.strokeRect(x + 2, y + 2, 126, 96)
  // 用完复位，避免虚线影响后续绘制
  ctx.setLineDash([])
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

