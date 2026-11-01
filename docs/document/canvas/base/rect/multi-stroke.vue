<template>
  <canvas ref="canvasRef" width="240" height="200" class="board"></canvas>
</template>

<script setup>
/**
 * lineWidth：多层描边矩形
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

  drawLabel(ctx, 'lineWidth', '多层描边')
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
