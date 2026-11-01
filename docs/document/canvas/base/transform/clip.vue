<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** clip：把后续绘制限制在指定路径内部 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 圆形裁剪区
  ctx.beginPath()
  ctx.arc(140, 90, 70, 0, Math.PI * 2)
  ctx.clip()

  // 裁剪生效：条纹只出现在圆内
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `hsl(${160 + i * 4}, 60%, ${68 - i * 2}%)`
    ctx.fillRect(60 + i * 12, 10, 12, 160)
  }
})
</script>
