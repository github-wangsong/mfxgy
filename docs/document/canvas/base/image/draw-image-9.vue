<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** drawImage 九参数：先裁剪源图的一块，再缩放画到目标区域 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

/** 用离屏 canvas 生成一张 80×60 的示例图片 */
function createSprite () {
  const sprite = document.createElement('canvas')
  sprite.width = 80
  sprite.height = 60
  const sctx = sprite.getContext('2d')
  sctx.fillStyle = '#0d9488'
  sctx.fillRect(0, 0, 80, 60)
  sctx.fillStyle = '#ffffff'
  sctx.beginPath()
  sctx.arc(40, 30, 18, 0, Math.PI * 2)
  sctx.fill()
  return sprite
}

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  const sprite = createSprite()

  // 九参数：只取源图左半边，放大到 100×120
  ctx.drawImage(sprite, 0, 0, 40, 60, 40, 30, 100, 120)

  // 对比：完整图按原尺寸画在右边
  ctx.drawImage(sprite, 170, 60)
})
</script>
