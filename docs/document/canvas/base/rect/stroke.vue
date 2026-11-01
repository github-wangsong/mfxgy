<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * strokeRect：纯色描边矩形
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 纯色描边：内缩 3px，避免 6px 宽的描边被裁掉
  ctx.strokeStyle = '#d97706'
  ctx.lineWidth = 6
  ctx.strokeRect(x + 3, y + 3, 124, 94)
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

