<template>
  <canvas ref="canvasRef" width="280" height="180" class="demo-canvas"></canvas>
</template>

<script setup>
/** requestAnimationFrame / cancelAnimationFrame：逐帧动画 */
import { onMounted, onUnmounted, ref } from 'vue'

const canvasRef = ref(null)
let rafId = 0

onMounted(() => {
  const ctx = canvasRef.value.getContext('2d')
  const ball = { x: 60, y: 60, vx: 160, vy: 120, r: 14 }
  let last = performance.now()

  /** 每一帧：按时间差移动小球 → 清屏 → 重新绘制 */
  function frame (time) {
    // 用时间差保证不同刷新率下速度一致，单帧最多 0.05 秒
    const dt = Math.min(0.05, (time - last) / 1000)
    last = time

    ball.x += ball.vx * dt
    ball.y += ball.vy * dt
    if (ball.x < ball.r || ball.x > 280 - ball.r) ball.vx *= -1
    if (ball.y < ball.r || ball.y > 180 - ball.r) ball.vy *= -1

    // 每帧清空画布，露出画布元素自身的浅色底
    ctx.clearRect(0, 0, 280, 180)

    ctx.fillStyle = '#0d9488'
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
    ctx.fill()

    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)
})

onUnmounted(() => cancelAnimationFrame(rafId))
</script>
