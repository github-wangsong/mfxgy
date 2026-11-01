<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** drawImage 三参数 / 五参数：原尺寸绘制与缩放绘制 */
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

  // 三参数：按图片原始尺寸绘制
  ctx.drawImage(sprite, 30, 60)

  // 五参数：拉伸到 100×75
  ctx.drawImage(sprite, 150, 50, 100, 75)
})
</script>
