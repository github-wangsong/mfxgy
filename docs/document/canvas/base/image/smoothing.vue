<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** imageSmoothingEnabled / imageSmoothingQuality：缩放图片时的平滑开关 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

/** 生成一张 20×20 的小图，放大后能明显看出平滑差异 */
function createSprite () {
  const sprite = document.createElement('canvas')
  sprite.width = 20
  sprite.height = 20
  const sctx = sprite.getContext('2d')
  sctx.fillStyle = '#0d9488'
  sctx.fillRect(0, 0, 20, 20)
  sctx.fillStyle = '#d97706'
  sctx.fillRect(0, 0, 10, 10)
  sctx.fillRect(10, 10, 10, 10)
  return sprite
}

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  const sprite = createSprite()

  // 关闭平滑：放大后是硬边格子
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, 30, 30, 100, 120)

  // 开启平滑 + 高质量：边缘被插值成渐变
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sprite, 150, 30, 100, 120)
})
</script>
