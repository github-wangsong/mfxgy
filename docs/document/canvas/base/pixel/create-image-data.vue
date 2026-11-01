<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** createImageData + putImageData：不画图，直接逐像素生成图像 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 新建一块 200×120 的空像素数据
  const imageData = ctx.createImageData(200, 120)

  for (let y = 0; y < 120; y++) {
    for (let x = 0; x < 200; x++) {
      // 每个像素在数组里的起始下标
      const i = (y * 200 + x) * 4
      const bright = (x + y) % 20 < 10

      imageData.data[i] = bright ? 48 : 24       // R
      imageData.data[i + 1] = bright ? 164 : 121 // G
      imageData.data[i + 2] = bright ? 108 : 78  // B
      imageData.data[i + 3] = 255                // A
    }
  }

  ctx.putImageData(imageData, 40, 30)
})
</script>
