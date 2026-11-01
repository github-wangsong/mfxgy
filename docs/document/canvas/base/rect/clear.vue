<template>
  <canvas ref="canvasRef" width="240" height="200" class="board"></canvas>
</template>

<script setup>
/**
 * clearRect：矩形中擦出透明缺口
 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)
const W = 240
const H = 200

/** 在矩形下方居中画出 API 名与说明 */
function drawLabel (ctx, api, desc) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#334155'
  ctx.font = '600 13px Menlo, Consolas, monospace'
  ctx.fillText(api, W / 2, H - 33)
  ctx.fillStyle = '#64748b'
  ctx.font = '13px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText(desc, W / 2, H - 14)
  ctx.restore()
}

function draw (ctx) {
  // 130 × 100 的矩形，水平居中
  const x = (W - 130) / 2
  const y = 30

  // 先铺满一个矩形
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(x, y, 130, 100)

  // 擦掉中间一块，露出 canvas 元素自身的深色底
  ctx.clearRect(x + 30, y + 25, 46, 46)

  drawLabel(ctx, 'clearRect', '擦除缺口')
}

onMounted(() => draw(canvasRef.value.getContext('2d')))
</script>

<style scoped>
.board {
  display: block;
  width: 100%;
  max-width: 220px;
  height: auto;
  margin: 0 auto;
  background: #fff;
  border: 1px solid var(--vp-c-divider, #e2e8f0);
  border-radius: 6px;
}
</style>
