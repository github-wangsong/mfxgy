<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** font + fillText + textAlign + textBaseline：填充文字 */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // font 语法：字重 字号 字体
  ctx.font = '700 36px "Microsoft YaHei", sans-serif'
  ctx.fillStyle = '#0d9488'

  // 水平居中 + 垂直居中
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Canvas 文字', 140, 90)
})
</script>
