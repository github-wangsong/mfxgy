<template>
  <div class="snake-wrap">
    <div class="info">
      <span>状态: {{ statusText }}</span>
      <div class="btns">
        <button @click="start" :disabled="status === 'playing'">开始</button>
        <button @click="togglePause" :disabled="status === 'idle' || status === 'over'">
          {{ status === 'paused' ? '继续' : '暂停' }}
        </button>
        <button @click="restart">重新开始</button>
      </div>
    </div>
    <canvas id='canvas2' style="border: 1px solid #ff0" width="300" height="300"></canvas>
    <div class="pad dir-pad">
      <button type="button" class="up" aria-label="向上" :disabled="status !== 'playing'" @click="setDirection('up')">↑</button>
      <button type="button" class="left" aria-label="向左" :disabled="status !== 'playing'" @click="setDirection('left')">←</button>
      <button type="button" class="down" aria-label="向下" :disabled="status !== 'playing'" @click="setDirection('down')">↓</button>
      <button type="button" class="right" aria-label="向右" :disabled="status !== 'playing'" @click="setDirection('right')">→</button>
    </div>
    <p class="tip">方向键或 WASD 控制方向；没有键盘时点下方按钮</p>
  </div>
</template>
<script setup>
/**
 * 贪吃蛇（Snake）
 * ----------------------------------
 * 核心玩法：蛇按固定步长在网格上移动，吃到食物身体变长，
 * 撞到自己则游戏结束。穿墙（从一边出去从另一边回来）。
 *
 * 采用面向对象设计：
 * - Snake：蛇身数组（每项为 [x, y] 坐标）、方向、移动、吃食
 * - Food：食物坐标生成（避免生成在蛇身上）
 * - Game：组合 Snake + Food，负责每步移动与碰撞检测
 *
 * 移动用 requestAnimationFrame + STEP_INTERVAL 节流，
 * 保证不同设备下蛇移动速度一致。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 响应式状态 ----------
const canvas = ref(null)  // canvas 元素
const ctx = ref(null)     // 2D 上下文
const game = ref(null)    // Game 实例
// 游戏状态：idle | playing | paused | over
const status = ref('idle')

const statusText = computed(() => {
  return { idle: '待开始', playing: '进行中', paused: '已暂停', over: '已结束' }[status.value]
})

// ---------- 游戏常量 ----------
let rafId = null
const STEP_INTERVAL = 160      // 每步移动间隔（毫秒），越小越快
let lastStepTime = 0            // 上一步时间戳
// 反向方向映射：用于防止蛇 180° 掉头撞到自己
const opposites = { right: 'left', left: 'right', up: 'down', down: 'up' }

/**
 * 蛇类
 * body 数组中最后一项为蛇头，第一项为蛇尾
 */
class Snake {
  constructor () {
    this.body = [[10,10], [20,10], [30,10]] // 初始三节
    this.speed = 10                          // 每步移动像素（= 格子大小）
    this.direction = 'right'                 // 初始向右
  }

  /** 绘制蛇身（红色方块） */
  draw () {
    ctx.value.fillStyle = 'red'
    this.body.forEach(item => {
      ctx.value.fillRect(item[0], item[1], 10, 10)
    })
  }

  /**
   * 移动一步：在当前方向前端加一个新头，去掉尾部
   * 边界采用穿墙逻辑
   */
  move () {
    const body = [...this.body]
    const lastIndex = body.length - 1
    let x = body[lastIndex][0]
    let y = body[lastIndex][1]
    // 根据方向计算新蛇头位置
    switch (this.direction) {
      case 'right': x += this.speed; break
      case 'left': x -= this.speed; break
      case 'up': y -= this.speed; break
      case 'down': y += this.speed; break
    }
    // 穿墙：超出边界则从对侧出现
    if (x > canvas.value.width - 10) x = 0
    if (x < 0) x = canvas.value.width - 10
    if (y > canvas.value.height - 10) y = 0
    if (y < 0) y = canvas.value.height - 10
    body.push([x, y]) // 新头入队
    body.shift()      // 尾部出队
    this.body = body
  }

  /**
   * 吃到食物：在尾部再追加一节（变长），并清空食物
   */
  eat (food) {
    this.body.push([this.body[this.body.length - 1][0], this.body[this.body.length - 1][1]])
    this.draw()
    food.body = []
  }
}

/**
 * 食物类：body 为空时随机生成一个不与蛇身重叠的坐标
 */
class Food {
  constructor () {
    this.body = []
  }

  /** 绘制食物（绿色方块） */
  draw () {
    ctx.value.fillStyle = 'green'
    this.body.forEach(item => {
      ctx.value.fillRect(item[0], item[1], 10, 10)
    })
  }

  /** 生成食物：确保不落在蛇身上（最多尝试 100 次） */
  create () {
    if (this.body.length > 0) return
    let x, y
    let attempts = 0
    do {
      x = Math.floor(Math.random() * 30) * 10 // 300/10 = 30 格
      y = Math.floor(Math.random() * 30) * 10
      attempts++
      if (attempts > 100) break
    } while (game.value.snake.body.some(item => item[0] === x && item[1] === y))
    this.body.push([x, y])
  }
}

/**
 * 游戏类：组合蛇与食物，负责每步推进与碰撞检测
 */
class Game {
  constructor () {
    this.snake = new Snake()
    this.food = new Food()
  }

  /** 绘制整个游戏画面：蛇身 + 食物 */
  draw () {
    this.snake.draw()
    this.food.draw()
  }

  /** 每步：蛇移动 → 生成食物 → 清屏重绘 → 碰撞检测 */
  move () {
    this.snake.move()
    this.food.create()
    ctx.value.clearRect(0, 0, canvas.value.width, canvas.value.height)
    this.draw()
    this.checkCollision()
  }

  /**
   * 碰撞检测：
   * - 蛇头撞到自身 → 游戏结束
   * - 蛇头吃到食物 → 蛇变长
   */
  checkCollision () {
    const head = this.snake.body[this.snake.body.length - 1]
    // 自身碰撞（排除蛇头自身）
    if (this.snake.body.some((item, index) => {
      if (index === this.snake.body.length - 1) return false
      return item[0] === head[0] && item[1] === head[1]
    })) {
      status.value = 'over'
      return true
    }
    // 吃到食物
    if (this.food.body.some(item => item[0] === head[0] && item[1] === head[1])) {
      this.snake.eat(this.food)
      return true
    }
    return false
  }
}

// ---------- 状态控制 ----------

/** 开始游戏：结束/待开始时新建 Game 实例 */
function start () {
  if (status.value === 'playing') return
  if (status.value === 'over' || status.value === 'idle') {
    game.value = new Game()
  }
  status.value = 'playing'
  if (!rafId) {
    lastStepTime = 0
    rafId = requestAnimationFrame(animate)
  }
}

/** 暂停/继续 */
function togglePause () {
  if (status.value === 'playing') status.value = 'paused'
  else if (status.value === 'paused') status.value = 'playing'
}

/** 重新开始 */
function restart () {
  game.value = new Game()
  status.value = 'playing'
  if (!rafId) {
    lastStepTime = 0
    rafId = requestAnimationFrame(animate)
  }
}

/** 绘制遮罩文字 */
function drawOverlay (text) {
  const c = canvas.value
  ctx.value.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.value.fillRect(0, 0, c.width, c.height)
  ctx.value.fillStyle = '#fff'
  ctx.value.font = 'bold 26px sans-serif'
  ctx.value.textAlign = 'center'
  ctx.value.fillText(text, c.width / 2, c.height / 2)
}

/**
 * 动画循环：每帧检查是否到达 STEP_INTERVAL，到达则推进一步
 * 非 playing 状态不推进，仅绘制遮罩
 */
function animate (timestamp) {
  if (status.value === 'over') {
    drawOverlay('游戏结束')
    rafId = null
    return
  }
  if (status.value === 'playing') {
    if (timestamp - lastStepTime >= STEP_INTERVAL) {
      lastStepTime = timestamp
      game.value.move()
    }
  }
  if (status.value === 'paused') drawOverlay('已暂停')
  if (status.value === 'idle') drawOverlay('点击「开始」游戏')
  rafId = requestAnimationFrame(animate)
}

// ---------- 键盘输入 ----------

/**
 * 设置蛇的移动方向：仅进行中有效，禁止 180° 反向（会立即撞到自己）
 * 键盘与屏幕按钮共用这一入口
 */
function setDirection (newDir) {
  if (status.value !== 'playing') return
  if (opposites[game.value.snake.direction] === newDir) return
  game.value.snake.direction = newDir
}

/**
 * 方向键或 WASD 控制蛇的方向
 */
function handleKeyDown (e) {
  const keyMap = {
    d: 'right', a: 'left', w: 'up', s: 'down',
    ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down'
  }
  const newDir = keyMap[e.key]
  if (!newDir) return
  if (e.key.startsWith('Arrow')) e.preventDefault()
  setDirection(newDir)
}

// ---------- 生命周期 ----------

// 组件挂载时：获取 canvas/ctx，初始化游戏并绘制待开始遮罩，注册键盘监听
onMounted(() => {
  canvas.value = document.querySelector("#canvas2")
  ctx.value = canvas.value.getContext("2d")
  game.value = new Game()
  game.value.draw()
  drawOverlay('点击「开始」游戏')
  document.addEventListener('keydown', handleKeyDown)
})

// 组件卸载时：取消动画帧并移除键盘监听，防止内存泄漏
onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  document.removeEventListener('keydown', handleKeyDown)
})
</script>
<style scoped>
.snake-wrap { display: inline-block; text-align: center; }
#canvas2 { display: block; }
.info { display: flex; justify-content: space-between; align-items: center; width: 300px; margin-bottom: 6px; color: #475569; font-size: 14px; gap: 8px; }
.btns { display: flex; gap: 6px; }
.info button { cursor: pointer; padding: 2px 10px; border: 1px solid #eab308; background: #eab308; color: #0f172a; border-radius: 4px; }
.info button:disabled { opacity: 0.4; cursor: not-allowed; }
.pad { display: flex; justify-content: center; gap: 8px; margin-top: 8px; }
.pad button {
  min-width: 52px;
  height: 40px;
  font-size: 18px;
  color: #0f172a;
  background: #eab308;
  border: 1px solid #eab308;
  border-radius: 6px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.pad button:active { filter: brightness(0.9); }
.pad button:disabled { opacity: 0.4; cursor: not-allowed; }
.dir-pad {
  display: grid;
  grid-template-columns: repeat(3, 52px);
  grid-template-rows: repeat(2, 40px);
  justify-content: center;
}
.dir-pad .up { grid-column: 2; grid-row: 1; }
.dir-pad .left { grid-column: 1; grid-row: 2; }
.dir-pad .down { grid-column: 2; grid-row: 2; }
.dir-pad .right { grid-column: 3; grid-row: 2; }
.tip { color: #94a3b8; font-size: 12px; margin-top: 6px; }
</style>
