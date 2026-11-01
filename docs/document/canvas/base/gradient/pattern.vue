<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** createPattern：用图片 / canvas 平铺成图案 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 用离屏 canvas 生成 20×20 的棋盘格图块
  const tile = document.createElement('canvas')
  tile.width = 20
  tile.height = 20
  const tileCtx = tile.getContext('2d')
  tileCtx.fillStyle = '#d1fae5'
  tileCtx.fillRect(0, 0, 20, 20)
  tileCtx.fillStyle = '#0d9488'
  tileCtx.fillRect(0, 0, 10, 10)
  tileCtx.fillRect(10, 10, 10, 10)

  // repeat 表示两个方向都平铺
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')
  ctx.fillRect(20, 20, 240, 140)
})
</script>
