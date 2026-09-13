<template>
  <div>
    <canvas  id='canvas2' style="border: 1px solid #ff0" width="300" height="300"></canvas>
  </div>
</template>
<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
const canvas = ref(null)
const ctx = ref(null)
const game = ref(null)
let rafId = null
// 蛇移动间隔（毫秒），数值越小速度越快
const STEP_INTERVAL = 120
let lastStepTime = 0
// 方向反向映射，用于阻止直接调头
const opposites = { right: 'left', left: 'right', up: 'down', down: 'up' }
class Snake {
  constructor () {
    this.body = [[10,10], [20,10], [30,10]]
    this.speed = 10
    this.direction = 'right'
  }
  draw () {
    ctx.value.fillStyle = 'red'
    const body = [...this.body]
    body.forEach(item => {
      ctx.value.fillRect(item[0], item[1], 10, 10)
    })
  }
  move () {
    const body = [...this.body]
    const lastIndex = body.length - 1
    let x = body[lastIndex][0]
    let y = body[lastIndex][1]
    switch (this.direction) {
      case 'right':
        x += this.speed
        break
      case 'left':
        x -= this.speed
        break
      case 'up':
        y -= this.speed
        break
      case 'down':
        y += this.speed
        break
    }
    if (x > canvas.value.width - 10) {
      x = 0
    }
    if (x < 0) {
      x = canvas.value.width - 10
    }
    if (y > canvas.value.height - 10) {
      y = 0
    }
    if (y < 0) {
      y = canvas.value.height - 10
    }
    body.push([x, y])
    body.shift()
    this.body = body
  }
  eat (food) {
    this.body.push([this.body[this.body.length - 1][0], this.body[this.body.length - 1][1]])
    this.draw()
    food.body = []
  }
}
class Food {
  constructor () {
    this.body = []
    this.startTime = Date.now()
  }
  draw () {
    ctx.value.fillStyle = 'green'
    const body = [...this.body]
    body.forEach(item => {
      ctx.value.fillRect(item[0], item[1], 10, 10)
    })
  }
  create () {
    // if (Date.now() - this.startTime < 5000) {
    //   this.draw()
    //   return
    // }
    if (this.body.length > 0) {
      return
    }
    this.startTime = Date.now()
    // 避免食物生成在蛇身上
    let x, y
    let attempts = 0
    do {
      x = Math.floor(Math.random() * 30) * 10
      y = Math.floor(Math.random() * 30) * 10
      attempts++
      if (attempts > 100) break
    } while (game.value.snake.body.some(item => item[0] === x && item[1] === y))
    this.x = x
    this.y = y
    this.body.push([this.x, this.y])
  }
}
class Game {
  constructor () {
    this.snake = new Snake()
    this.food = new Food()
    this.end = false
  }
  draw () {
    this.snake.draw()
    this.food.draw()
  }
  move () {
    if (this.end) {
      return
    }
    this.snake.move()
    this.food.create()
    ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height)
    this.draw()
    this.checkCollision()
  }
  // 碰撞检测
  checkCollision () {
    const head = this.snake.body[this.snake.body.length - 1]
    // 如果碰到自己
    if (this.snake.body.some((item, index) => {
      if (index === this.snake.body.length - 1) {
        return false
      }
      return item[0] === head[0] && item[1] === head[1]
    })) {
      this.end = true
      // 停止动画循环
      cancelAnimationFrame(rafId)
      rafId = null
      alert('游戏结束')
      return true
    }
    // 如果碰到食物
    if (this.food.body.some(item => item[0] === head[0] && item[1] === head[1])) {
      this.snake.eat(this.food)
      return true
    }
    return false
  }
}
function animate (timestamp) {
  // 游戏结束后停止循环
  if (game.value.end) {
    return
  }
  // 基于时间戳控制移动速度，与帧率解耦
  if (timestamp - lastStepTime >= STEP_INTERVAL) {
    lastStepTime = timestamp
    game.value.move()
  }

  rafId = requestAnimationFrame(animate)
}
function handleKeyDown (e) {
  const keyMap = {
    d: 'right',
    a: 'left',
    w: 'up',
    s: 'down',
    ArrowRight: 'right',
    ArrowLeft: 'left',
    ArrowUp: 'up',
    ArrowDown: 'down'
  }
  const newDir = keyMap[e.key]
  if (!newDir) return
  // 阻止方向键滚动页面
  if (e.key.startsWith('Arrow')) e.preventDefault()
  // 阻止直接调头
  if (opposites[game.value.snake.direction] === newDir) return
  game.value.snake.direction = newDir
}
onMounted(() => {
  canvas.value = document.querySelector("#canvas2")
  ctx.value = canvas.value.getContext("2d")
  game.value = new Game()
  game.value.draw()
  animate()
  // 键盘监听
  document.addEventListener('keydown', handleKeyDown)
})
onUnmounted(() => {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  document.removeEventListener('keydown', handleKeyDown)
})

</script>

