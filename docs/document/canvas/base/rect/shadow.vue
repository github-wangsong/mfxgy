<template>
  <canvas ref="canvasRef" width="240" height="200" class="board"></canvas>
</template>

<script setup>
/**
 * shadowBlur：带阴影的矩形
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

  // 浅色底上用深色投影，阴影才看得出来
  ctx.shadowColor = 'rgba(15, 23, 42, 0.35)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 6
  ctx.shadowOffsetY = 6
  ctx.fillStyle = '#18794e'
  ctx.fillRect(x, y, 130, 100)

  // 画完立刻复位阴影，避免影响标注文字
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  drawLabel(ctx, 'shadowBlur', '阴影')
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
