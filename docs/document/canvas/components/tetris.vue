<template>
  <div class="tetris-wrap">
    <div class="info">
      <span>分数: {{ score }}</span>
      <span>行数: {{ lines }}</span>
      <span>状态: {{ statusText }}</span>
      <div class="btns">
        <button @click="start" :disabled="status === 'playing'">开始</button>
        <button @click="togglePause" :disabled="status === 'idle' || status === 'over'">
          {{ status === 'paused' ? '继续' : '暂停' }}
        </button>
        <button @click="restart">重新开始</button>
      </div>
    </div>
    <div class="game">
      <canvas ref="canvasRef" width="240" height="480"></canvas>
      <div class="side">
        <div class="box">
          <div class="label">下一个</div>
          <canvas ref="nextRef" width="100" height="100"></canvas>
        </div>
      </div>
    </div>
    <p class="tip">← → 移动，↑ 旋转，↓ 加速，空格 硬降</p>
  </div>
</template>

<script setup>
/**
 * 俄罗斯方块（Tetris）
 * ----------------------------------
 * 核心玩法：7 种方块（I/O/T/S/Z/J/L）从顶部下落，
 * 玩家移动/旋转/加速，方块落底后锁定到棋盘。
 * 填满一整行则消除并加分，消除越多速度越快。
 * 新方块生成时若已碰撞（棋盘堆满）则游戏结束。
 *
 * 棋盘 board[r][c]：0 表示空，否则存放方块类型字符串（如 'I'）。
 * 下落速度 dropInterval 随消除行数递减（最快 250ms）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 响应式状态 ----------
const canvasRef = ref(null) // 主棋盘画布
const nextRef = ref(null)   // 下一个方块预览画布
const score = ref(0)
const lines = ref(0)
// 游戏状态：idle | playing | paused | over
const status = ref('idle')

const statusText = computed(() => {
  return { idle: '待开始', playing: '进行中', paused: '已暂停', over: '已结束' }[status.value]
})

let ctx = null       // 主画布 2D 上下文
let nextCtx = null   // 预览画布 2D 上下文
let rafId = null     // 动画帧 ID

// ---------- 棋盘常量 ----------
const COLS = 10    // 棋盘列数
const ROWS = 20    // 棋盘行数
const BLOCK = 24   // 每个格子像素大小

// 7 种标准方块形状（1 表示该格有方块）
const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]]
}
// 每种方块对应的颜色
const COLORS = {
  I: '#22d3ee', O: '#facc15', T: '#a855f7', S: '#22c55e',
  Z: '#ef4444', J: '#3b82f6', L: '#f97316'
}

// ---------- 游戏状态 ----------
let board = []          // 二维棋盘数组
let current = null      // 当前下落方块
let next = null         // 下一个方块
let dropCounter = 0     // 下落计时器（毫秒）
let dropInterval = 900  // 下落间隔（毫秒），随消行加快
let lastTime = 0        // 上一帧时间戳，用于计算 delta

/** 创建空棋盘：ROWS 行 × COLS 列，初始全 0 */
function createBoard () {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(0))
}

/**
 * 随机生成一个新方块
 * @returns {{ type: string, shape: number[][], x: number, y: number }}
 */
function randomPiece () {
  const keys = Object.keys(SHAPES)
  const type = keys[Math.floor(Math.random() * keys.length)]
  return {
    type,
    shape: SHAPES[type].map(r => [...r]), // 深拷贝形状
    x: Math.floor((COLS - SHAPES[type][0].length) / 2), // 水平居中
    y: 0
  }
}

/**
 * 顺时针旋转 90° 矩阵
 * 原理：新矩阵 res[col][rows-1-row] = old[row][col]
 */
function rotate (shape) {
  const rows = shape.length
  const cols = shape[0].length
  const res = Array.from({ length: cols }, () => Array(rows).fill(0))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      res[c][rows - 1 - r] = shape[r][c]
    }
  }
  return res
}

/**
 * 碰撞检测：检查方块是否与边界或已锁定方块重叠
 * y < 0 的格子（还在屏幕上方外）不与棋盘碰撞
 */
function collide (piece) {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (!piece.shape[r][c]) continue
      const x = piece.x + c
      const y = piece.y + r
      // 左右/底部越界
      if (x < 0 || x >= COLS || y >= ROWS) return true
      // 与已锁定方块重叠
      if (y >= 0 && board[y][x]) return true
    }
  }
  return false
}

/** 将当前方块合并（锁定）到棋盘 */
function merge (piece) {
  piece.shape.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val) {
        const y = piece.y + r
        if (y >= 0) board[y][piece.x + c] = piece.type
      }
    })
  })
}

/**
 * 消除所有已满的行并计分
 * 消行数量 1/2/3/4 对应分数 100/300/500/800
 * 消行后加快下落速度
 */
function clearLines () {
  let cleared = 0
  // 从底向上遍历，消除后上方行下移（splice + unshift）
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(c => c)) {
      board.splice(r, 1)
      board.unshift(Array(COLS).fill(0))
      cleared++
      r++ // 因为 splice 后当前行已变为新行，需重新检查
    }
  }
  if (cleared > 0) {
    const points = [0, 100, 300, 500, 800]
    score.value += points[cleared]
    lines.value += cleared
    // 下落间隔随消行数减少，最低 250ms
    dropInterval = Math.max(250, 900 - lines.value * 20)
  }
}

/** 生成下一个方块；若新方块一出生就碰撞则游戏结束 */
function spawn () {
  current = next || randomPiece()
  next = randomPiece()
  if (collide(current)) {
    status.value = 'over'
  }
  drawNext()
}

/** 水平移动方块，若碰撞则回退 */
function move (dx) {
  current.x += dx
  if (collide(current)) current.x -= dx
}

/** 软降：向下移动一格，碰底则锁定 */
function softDrop () {
  current.y++
  if (collide(current)) {
    current.y--
    lock()
  }
}

/** 硬降：直接落到底部并锁定 */
function hardDrop () {
  while (!collide(current)) current.y++
  current.y--
  lock()
}

/**
 * 旋转当前方块，带 wall-kick（墙踢）：
 * 旋转后若碰撞，尝试左右偏移 1~2 格；都不行则放弃旋转
 */
function rotateCurrent () {
  const old = current.shape
  current.shape = rotate(current.shape)
  let offset = 0
  while (collide(current)) {
    offset = offset >= 0 ? -(offset + 1) : -offset // 交替：0 → -1 → 1 → -2 → 2
    current.x += offset
    if (Math.abs(offset) > 2) {
      current.shape = old // 偏移过头，还原
      return
    }
  }
}

/** 锁定方块的完整流程：合并到棋盘 → 消行 → 生成新方块 */
function lock () {
  merge(current)
  clearLines()
  spawn()
}

// ---------- 渲染 ----------

/**
 * 在指定画布上绘制一个带高光/阴影的方块格子
 * @param {CanvasRenderingContext2D} c 画布上下文
 */
function drawBlock (c, x, y, color, size = BLOCK) {
  c.fillStyle = color
  c.fillRect(x * size, y * size, size, size)
  // 左上高光
  c.fillStyle = 'rgba(255,255,255,0.25)'
  c.fillRect(x * size, y * size, size, size / 6)
  c.fillRect(x * size, y * size, size / 6, size)
  // 右下阴影
  c.fillStyle = 'rgba(0,0,0,0.25)'
  c.fillRect(x * size, y * size + size - size / 6, size, size / 6)
  c.fillRect(x * size + size - size / 6, y * size, size / 6, size)
}

/** 绘制棋盘：背景网格 + 已锁定方块 + 当前下落方块 */
function draw () {
  const canvas = canvasRef.value
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // 绘制网格线
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath()
    ctx.moveTo(x * BLOCK, 0)
    ctx.lineTo(x * BLOCK, ROWS * BLOCK)
    ctx.stroke()
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath()
    ctx.moveTo(0, y * BLOCK)
    ctx.lineTo(COLS * BLOCK, y * BLOCK)
    ctx.stroke()
  }
  // 绘制已锁定方块
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawBlock(ctx, c, r, COLORS[board[r][c]])
    }
  }
  // 绘制当前下落方块
  if (current) {
    current.shape.forEach((row, r) => {
      row.forEach((val, c) => {
        if (val) drawBlock(ctx, current.x + c, current.y + r, COLORS[current.type])
      })
    })
  }
}

/** 在右侧小画布绘制"下一个"方块预览 */
function drawNext () {
  const c = nextRef.value
  nextCtx.clearRect(0, 0, c.width, c.height)
  if (!next) return
  const size = 22
  // 居中偏移
  const offX = (c.width - next.shape[0].length * size) / 2
  const offY = (c.height - next.shape.length * size) / 2
  next.shape.forEach((row, r) => {
    row.forEach((val, col) => {
      if (val) {
        nextCtx.fillStyle = COLORS[next.type]
        nextCtx.fillRect(offX + col * size, offY + r * size, size, size)
        nextCtx.strokeStyle = 'rgba(0,0,0,0.3)'
        nextCtx.strokeRect(offX + col * size, offY + r * size, size, size)
      }
    })
  })
}

/** 绘制遮罩（暂停/结束/待开始） */
function drawOverlay (text, sub) {
  const canvas = canvasRef.value
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 26px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 10)
  if (sub) {
    ctx.font = '14px sans-serif'
    ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 18)
  }
}

// ---------- 主循环 ----------

/**
 * 游戏主循环：
 * - playing：根据 delta 时间累积 dropCounter，超过间隔则软降
 * - 非 playing：更新 lastTime 防止暂停后 delta 过大导致瞬降
 */
function loop (time) {
  if (status.value === 'over') {
    drawOverlay('游戏结束', `分数: ${score.value}`)
    rafId = null
    return
  }
  if (status.value === 'playing') {
    const delta = time - lastTime
    lastTime = time
    dropCounter += delta
    if (dropCounter > dropInterval) {
      softDrop()
      dropCounter = 0
    }
  } else {
    lastTime = time // 暂停时同步时间戳
  }
  draw()
  if (status.value === 'paused') drawOverlay('已暂停')
  if (status.value === 'idle') drawOverlay('点击「开始」游戏')
  rafId = requestAnimationFrame(loop)
}

// ---------- 状态控制 ----------

/** 重置棋盘、分数、下落速度、预览方块 */
function resetState () {
  createBoard()
  score.value = 0
  lines.value = 0
  dropInterval = 900
  dropCounter = 0
  next = randomPiece()
  current = null
}

/** 开始游戏 */
function start () {
  if (status.value === 'playing') return
  if (status.value === 'over' || status.value === 'idle') resetState()
  spawn()
  status.value = 'playing'
  lastTime = 0
  if (!rafId) rafId = requestAnimationFrame(loop)
}

/** 暂停/继续 */
function togglePause () {
  if (status.value === 'playing') status.value = 'paused'
  else if (status.value === 'paused') status.value = 'playing'
}

/** 重新开始 */
function restart () {
  resetState()
  spawn()
  status.value = 'playing'
  lastTime = 0
  if (!rafId) rafId = requestAnimationFrame(loop)
}

// ---------- 键盘输入 ----------

function onKeyDown (e) {
  if (status.value !== 'playing') return
  switch (e.key) {
    case 'ArrowLeft': move(-1); break       // 左移
    case 'ArrowRight': move(1); break       // 右移
    case 'ArrowDown': softDrop(); break     // 软降
    case 'ArrowUp': rotateCurrent(); break  // 旋转
    case ' ': hardDrop(); e.preventDefault(); break // 硬降
  }
  if (e.key.startsWith('Arrow')) e.preventDefault()
}

// ---------- 生命周期 ----------

// 组件挂载时：获取主画布与预览画布 2D 上下文，初始化并绘制待开始画面，注册键盘监听
onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  nextCtx = nextRef.value.getContext('2d')
  resetState()
  draw()
  drawNext()
  drawOverlay('点击「开始」游戏')
  window.addEventListener('keydown', onKeyDown)
})

// 组件卸载时：取消动画帧并移除键盘监听，防止内存泄漏
onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.tetris-wrap { display: inline-block; }
.game { display: flex; gap: 12px; }
.tetris-wrap canvas { border: 1px solid #a855f7; background: #0f172a; display: block; }
.info { display: flex; justify-content: space-between; align-items: center; width: 352px; margin-bottom: 6px; color: #475569; font-size: 14px; gap: 8px; }
.btns { display: flex; gap: 6px; }
.info button { cursor: pointer; padding: 2px 10px; border: 1px solid #a855f7; background: #a855f7; color: #fff; border-radius: 4px; }
.info button:disabled { opacity: 0.4; cursor: not-allowed; }
.side .box { border: 1px solid #334155; padding: 6px; }
.label { color: #94a3b8; font-size: 12px; margin-bottom: 4px; }
.tip { color: #94a3b8; font-size: 12px; margin-top: 6px; }
</style>
