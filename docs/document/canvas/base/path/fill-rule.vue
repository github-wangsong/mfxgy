<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** fill('nonzero') / fill('evenodd')：路径填充规则 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

/** 画一个五角星路径（线条自交） */
function starPath (ctx, cx, cy, r) {
  ctx.beginPath()
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 4 / 5
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // nonzero：中心也被填满
  starPath(ctx, 80, 90, 55)
  ctx.fillStyle = '#0d9488'
  ctx.fill('nonzero')

  // evenodd：中心区域被镂空
  starPath(ctx, 200, 90, 55)
  ctx.fillStyle = '#d97706'
  ctx.fill('evenodd')
})
</script>
