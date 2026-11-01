<template>
  <canvas ref="canvasRef" width="240" height="200" class="demo-canvas"></canvas>
</template>

<script setup>
/**
 * clearRect：矩形中擦出透明缺口
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240

function draw (ctx) {
  // 130 × 100 的矩形，居中绘制
  const x = (W - 130) / 2
  const y = 50

  // 先铺满一个矩形
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(x, y, 130, 100)

  // 擦掉中间一块，露出画布自身的浅色底
  ctx.clearRect(x + 30, y + 25, 46, 46)
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

