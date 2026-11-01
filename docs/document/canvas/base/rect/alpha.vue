<template>
  <canvas ref="canvasRef" width="240" height="200" class="board"></canvas>
</template>

<script setup>
/**
 * globalAlpha：半透明矩形叠加
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

  // 底层不透明矩形
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(x, y, 130, 100)

  // 上面叠两个 60% 不透明的矩形
  ctx.globalAlpha = 0.6
  ctx.fillStyle = '#0d9488'
  ctx.fillRect(x + 12, y + 16, 72, 64)
  ctx.fillStyle = '#d97706'
  ctx.fillRect(x + 46, y + 28, 72, 64)
  // 复位透明度
  ctx.globalAlpha = 1

  drawLabel(ctx, 'globalAlpha', '半透明叠加')
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
