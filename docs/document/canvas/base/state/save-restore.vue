<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** save / restore：保存与还原绘制状态（含坐标系） */
import { onMounted, ref } from 'vue'

const canvasRef = ref(null)

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')

  // 保存当前状态：填充色、变换矩阵等
  ctx.fillStyle = '#475569'
  ctx.save()

  // 平移 + 旋转 + 换色，只影响 save 到 restore 之间
  ctx.translate(170, 80)
  ctx.rotate(Math.PI / 6)
  ctx.fillStyle = '#d97706'
  ctx.fillRect(-40, -30, 80, 60)

  // restore 后坐标系和填充色都回到保存时的样子
  ctx.restore()

  // 这里还是原来的坐标系、原来的灰色
  ctx.fillRect(30, 40, 70, 50)
})
</script>
