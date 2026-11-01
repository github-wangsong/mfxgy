<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** setLineDash / lineDashOffset / getLineDash：虚线与偏移 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 18px 实线 + 12px 空白
  ctx.setLineDash([18, 12])
  ctx.lineWidth = 6
  ctx.strokeStyle = '#0d9488'

  // 偏移 0：虚线从起点开始
  ctx.lineDashOffset = 0
  ctx.beginPath()
  ctx.moveTo(40, 60)
  ctx.lineTo(240, 60)
  ctx.stroke()

  // 偏移 15：整条虚线向前错开
  ctx.lineDashOffset = 15
  ctx.beginPath()
  ctx.moveTo(40, 110)
  ctx.lineTo(240, 110)
  ctx.stroke()

  // 读取当前虚线配置
  ctx.font = '14px monospace'
  ctx.fillStyle = '#64748b'
  ctx.fillText(`getLineDash() = [${ctx.getLineDash()}]`, 40, 155)

  // 复位，避免影响后续绘制
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
})
</script>
