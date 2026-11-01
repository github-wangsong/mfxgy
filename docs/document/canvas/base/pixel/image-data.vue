<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** getImageData + putImageData：读出像素、改写后再写回 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 先画一块渐变色块
  const gradient = ctx.createLinearGradient(40, 30, 240, 150)
  gradient.addColorStop(0, '#0d9488')
  gradient.addColorStop(1, '#18794e')
  ctx.fillStyle = gradient
  ctx.fillRect(40, 30, 200, 120)

  // 读出这块区域的所有像素
  const imageData = ctx.getImageData(40, 30, 200, 120)

  // 每个像素 4 个值（R、G、B、A），把 RGB 反相
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = 255 - imageData.data[i]
    imageData.data[i + 1] = 255 - imageData.data[i + 1]
    imageData.data[i + 2] = 255 - imageData.data[i + 2]
  }

  // 写回原位置
  ctx.putImageData(imageData, 40, 30)
})
</script>
