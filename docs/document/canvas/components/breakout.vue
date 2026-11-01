<template>
  <div class="breakout-wrap">
    <div class="info">
      <span>分数: {{ score }}</span>
      <span>生命: {{ lives }}</span>
      <span>状态: {{ statusText }}</span>
      <div class="btns">
        <button @click="start" :disabled="status === 'playing'">开始</button>
        <button @click="togglePause" :disabled="status === 'idle' || status === 'over'">
          {{ status === 'paused' ? '继续' : '暂停' }}
        </button>
        <button @click="restart">重新开始</button>
      </div>
    </div>
    <canvas ref="canvasRef" width="480" height="320"></canvas>
    <div class="pad">
      <button
        type="button"
        aria-label="左移挡板"
        @pointerdown.prevent="hold('ArrowLeft', true, $event)"
        @pointerup="hold('ArrowLeft', false)"
        @pointerleave="hold('ArrowLeft', false)"
        @pointercancel="hold('ArrowLeft', false)"
      >←</button>
      <button
        type="button"
        aria-label="右移挡板"
        @pointerdown.prevent="hold('ArrowRight', true, $event)"
        @pointerup="hold('ArrowRight', false)"
        @pointerleave="hold('ArrowRight', false)"
        @pointercancel="hold('ArrowRight', false)"
      >→</button>
    </div>
    <p class="tip">← → 或 A / D 移动挡板；没有键盘时按住下方按钮</p>
  </div>
</template>

<script setup>
/**
 * 打砖块游戏（Breakout）
 * ----------------------------------
 * 核心玩法：玩家控制底部挡板，将球反弹到上方的砖块区域，
 * 消除全部砖块即通关；球落出底部则扣生命，生命归零则游戏结束。
 *
 * 状态机：idle(待开始) -> playing(进行中) <-> paused(已暂停) -> over(结束)
 * 主循环：requestAnimationFrame(loop) → playing 时 update()+draw()，否则仅 draw()
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 响应式状态 ----------
const canvasRef = ref(null) // canvas 元素引用
const score = ref(0)        // 当前分数
const lives = ref(3)        // 剩余生命
// 游戏状态：idle | playing | paused | over
const status = ref('idle')

// 状态文本映射，用于界面显示
const statusText = computed(() => {
  return { idle: '待开始', playing: '进行中', paused: '已暂停', over: '已结束' }[status.value]
})

// ---------- 非响应式游戏变量 ----------
let ctx = null     // canvas 2D 上下文
let rafId = null   // requestAnimationFrame 返回的帧 ID，用于取消循环

// 挡板对象：宽高、位置(x 左上角,y 左上角)、移动速度
const paddle = { w: 100, h: 12, x: 190, y: 300, speed: 7 }
// 球对象：圆心坐标、半径、x/y 方向速度分量
const ball = { x: 240, y: 290, r: 7, dx: 2.5, dy: -2.5 }

// 砖块矩阵常量：行数、列数、单块宽高、间距、整体偏移
const BRICK_ROWS = 5
const BRICK_COLS = 8
const BRICK_W = 52
const BRICK_H = 18
const BRICK_PAD = 6
const BRICK_TOP = 40
const BRICK_LEFT = 22
// 每一行砖块的颜色（共 5 行，对应 5 种颜色）
const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6']

// 砖块二维数组（bricks[r][c] = { alive: boolean }）
let bricks = []
// 按键状态表：keys['ArrowLeft'] = true 表示该键当前被按下
let keys = {}

/**
 * 初始化砖块矩阵：全部标记为存活
 */
function initBricks () {
  bricks = []
  for (let r = 0; r < BRICK_ROWS; r++) {
    bricks[r] = []
    for (let c = 0; c < BRICK_COLS; c++) {
      bricks[r][c] = { alive: true }
    }
  }
}

/**
 * 重置球的位置与速度：回到挡板上方，水平方向随机
 */
function resetBall () {
  ball.x = 240
  ball.y = 290
  // 随机选择向左或向右发射
  ball.dx = 2.5 * (Math.random() > 0.5 ? 1 : -1)
  ball.dy = -2.5
}

/**
 * 重置整个游戏状态：分数、生命、挡板、砖块、球
 */
function resetState () {
  score.value = 0
  lives.value = 3
  paddle.x = 190
  initBricks()
  resetBall()
  keys = {}
}

// ---------- 状态控制 ----------

/** 开始游戏：若处于结束或待开始状态则先重置，然后进入进行中并启动循环 */
function start () {
  if (status.value === 'playing') return
  if (status.value === 'over' || status.value === 'idle') {
    resetState()
  }
  status.value = 'playing'
  if (!rafId) rafId = requestAnimationFrame(loop)
}

/** 暂停/继续切换 */
function togglePause () {
  if (status.value === 'playing') {
    status.value = 'paused'
  } else if (status.value === 'paused') {
    status.value = 'playing'
  }
}

/** 重新开始：重置状态后直接进入进行中 */
function restart () {
  resetState()
  status.value = 'playing'
  if (!rafId) rafId = requestAnimationFrame(loop)
}

// ---------- 渲染 ----------

/** 绘制一帧：挡板 + 球 + 存活砖块 */
function draw () {
  const canvas = canvasRef.value
  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 绘制挡板（紫色矩形）
  ctx.fillStyle = '#6366f1'
  ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h)

  // 绘制球（橙色圆形）
  ctx.beginPath()
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
  ctx.fillStyle = '#f59e0b'
  ctx.fill()

  // 绘制所有存活砖块，按行取色
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      const b = bricks[r][c]
      if (!b.alive) continue
      // 计算砖块左上角坐标
      const x = BRICK_LEFT + c * (BRICK_W + BRICK_PAD)
      const y = BRICK_TOP + r * (BRICK_H + BRICK_PAD)
      ctx.fillStyle = colors[r]
      ctx.fillRect(x, y, BRICK_W, BRICK_H)
    }
  }
}

// ---------- 游戏逻辑更新 ----------

/** 每帧更新：挡板移动、球移动与边界碰撞、挡板/砖块碰撞 */
function update () {
  const canvas = canvasRef.value

  // 挡板左右移动（方向键或 A/D），并钳制在画布范围内
  if (keys['ArrowLeft'] || keys['a'] || keys['A']) paddle.x -= paddle.speed
  if (keys['ArrowRight'] || keys['d'] || keys['D']) paddle.x += paddle.speed
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.w, paddle.x))

  // 球按速度分量移动
  ball.x += ball.dx
  ball.y += ball.dy

  // 左右墙碰撞：水平速度反向
  if (ball.x - ball.r < 0 || ball.x + ball.r > canvas.width) ball.dx = -ball.dx
  // 上墙碰撞：垂直速度反向
  if (ball.y - ball.r < 0) ball.dy = -ball.dy
  // 下墙（球落出底部）：扣一条命
  if (ball.y + ball.r > canvas.height) {
    lives.value--
    if (lives.value <= 0) {
      status.value = 'over' // 生命归零，游戏结束
      return
    }
    resetBall() // 还有命，重置球继续
  }

  // 挡板碰撞检测：球心在挡板矩形范围内且正在向下运动
  if (
    ball.y + ball.r >= paddle.y &&
    ball.y - ball.r <= paddle.y + paddle.h &&
    ball.x >= paddle.x &&
    ball.x <= paddle.x + paddle.w &&
    ball.dy > 0
  ) {
    ball.dy = -ball.dy
    // 根据击中挡板的位置调整水平速度：
    // hit ∈ [-1, 1]，击中左端偏左飞，击中右端偏右飞，增加可玩性
    const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2)
    ball.dx = hit * 3.5
  }

  // 砖块碰撞检测（遍历所有存活砖块，AABB 碰撞）
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      const b = bricks[r][c]
      if (!b.alive) continue
      const bx = BRICK_LEFT + c * (BRICK_W + BRICK_PAD)
      const by = BRICK_TOP + r * (BRICK_H + BRICK_PAD)
      if (
        ball.x + ball.r > bx &&
        ball.x - ball.r < bx + BRICK_W &&
        ball.y + ball.r > by &&
        ball.y - ball.r < by + BRICK_H
      ) {
        b.alive = false     // 消除该砖块
        ball.dy = -ball.dy  // 球垂直反弹
        score.value += 10   // 加分
        // 检查是否全部砖块已消除（通关）
        const allDead = bricks.flat().every(x => !x.alive)
        if (allDead) status.value = 'over'
      }
    }
  }
}

// ---------- 主循环 ----------

/**
 * 游戏主循环：
 * - over：绘制结束画面后停止请求下一帧
 * - playing：执行 update() 推进逻辑
 * - paused/idle：仅绘制，不推进逻辑
 */
function loop () {
  if (status.value === 'over') {
    drawGameOver()
    rafId = null
    return
  }
  if (status.value === 'playing') {
    update()
  }
  draw()
  if (status.value === 'paused') drawPause()
  rafId = requestAnimationFrame(loop)
}

/** 绘制暂停遮罩 */
function drawPause () {
  const canvas = canvasRef.value
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('已暂停', canvas.width / 2, canvas.height / 2)
}

/** 绘制游戏结束画面（区分通关/失败） */
function drawGameOver () {
  const canvas = canvasRef.value
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  // 判断是否通关：所有砖块都被消除
  const win = bricks.flat().every(x => !x.alive)
  ctx.fillText(win ? '通关！' : '游戏结束', canvas.width / 2, canvas.height / 2 - 10)
  ctx.font = '16px sans-serif'
  ctx.fillText(`得分: ${score.value}`, canvas.width / 2, canvas.height / 2 + 20)
}

// ---------- 键盘输入 ----------

/** 按键按下：记录按键状态，阻止方向键导致页面滚动 */
function onKeyDown (e) {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
}
/** 按键抬起：清除按键状态 */
function onKeyUp (e) {
  keys[e.key] = false
}

/**
 * 屏幕按钮：按下/松开时同步按键状态
 * 按下时捕获指针，手指滑出按钮后松开也能正确复位，挡板不会一直移动
 */
function hold (key, down, e) {
  if (down && e?.currentTarget?.setPointerCapture) {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  keys[key] = down
}

// ---------- 生命周期 ----------

// 组件挂载时：获取 2D 上下文，初始化砖块与球，绘制待开始画面，注册键盘监听
onMounted(() => {
  const canvas = canvasRef.value
  ctx = canvas.getContext('2d')
  initBricks()
  resetBall()
  draw()
  drawIdle() // 默认显示待开始提示
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

/** 绘制待开始遮罩 */
function drawIdle () {
  const canvas = canvasRef.value
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('点击「开始」游戏', canvas.width / 2, canvas.height / 2)
}

onUnmounted(() => {
  // 组件卸载时取消动画帧并移除键盘监听，防止内存泄漏
  if (rafId) cancelAnimationFrame(rafId)
  keys = {}
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<style scoped>
.breakout-wrap { display: inline-block; text-align: center; }
.breakout-wrap canvas { border: 1px solid #6366f1; background: #0f172a; display: block; }
.info { display: flex; justify-content: space-between; align-items: center; width: 480px; margin-bottom: 6px; color: #475569; font-size: 14px; gap: 8px; }
.btns { display: flex; gap: 6px; }
.info button { cursor: pointer; padding: 2px 10px; border: 1px solid #6366f1; background: #6366f1; color: #fff; border-radius: 4px; }
.info button:disabled { opacity: 0.4; cursor: not-allowed; }
.pad { display: flex; justify-content: center; gap: 12px; margin-top: 8px; }
.pad button {
  min-width: 140px;
  height: 40px;
  font-size: 18px;
  color: #fff;
  background: #6366f1;
  border: 1px solid #6366f1;
  border-radius: 6px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.pad button:active { filter: brightness(0.9); }
.tip { color: #94a3b8; font-size: 12px; margin-top: 6px; }
</style>
