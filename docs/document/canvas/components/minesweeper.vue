<template>
  <div class="mine-wrap">
    <div class="info">
      <span>剩余雷数: {{ mineCount }}</span>
      <span>用时: {{ timer }}s</span>
      <span>状态: {{ statusText }}</span>
      <div class="btns">
        <button @click="start" :disabled="status === 'playing'">开始</button>
        <button @click="togglePause" :disabled="status === 'idle' || status === 'over'">
          {{ status === 'paused' ? '继续' : '暂停' }}
        </button>
        <button @click="restart">重新开始</button>
      </div>
    </div>
    <canvas ref="canvasRef" :width="cols * cell" :height="rows * cell"
      @click="onClick" @contextmenu.prevent="onRightClick"></canvas>
    <p class="tip">左键揭开，右键标记旗帜</p>
  </div>
</template>

<script setup>
/**
 * 扫雷（Minesweeper）
 * ----------------------------------
 * 核心玩法：12×12 棋盘，20 颗雷。
 * - 左键揭开格子，数字表示周围 8 格的雷数；点到雷则失败。
 * - 右键标记/取消旗帜，剩余雷数 = 总雷数 - 旗帜数。
 * - 揭开所有非雷格子即获胜。
 * - 首次点击保证安全（雷在首次点击后才布置，且避开点击点周围 3×3）。
 *
 * board[r][c]：-1 表示雷，0~8 表示周围雷数
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 响应式状态 ----------
const canvasRef = ref(null)
const cols = 12        // 列数
const rows = 12        // 行数
const cell = 28        // 每格像素
const mineTotal = 20   // 雷总数

const mineCount = ref(mineTotal) // 剩余雷数（总雷 - 已插旗）
const timer = ref(0)             // 用时（秒）
// 游戏状态：idle | playing | paused | over
const status = ref('idle')

const statusText = computed(() => {
  return { idle: '待开始', playing: '进行中', paused: '已暂停', over: '已结束' }[status.value]
})

// ---------- 非响应式状态 ----------
let ctx = null
let board = []        // 棋盘数据：-1 雷 / 0~8 数字
let revealed = []     // 是否已揭开
let flagged = []      // 是否已插旗
let firstClick = true // 是否首次点击（用于首次点击后才布雷）
let won = false       // 本局是否获胜
let timerId = null    // 计时器 ID

// 数字 1~8 对应的颜色（索引 0 未使用）
const NUM_COLORS = ['', '#1e40af', '#15803d', '#b91c1c', '#6b21a8', '#9a3412', '#0e7490', '#000', '#6b7280']

// ---------- 初始化 ----------

/** 初始化棋盘：全部为空、未揭开、未插旗，重置计时与状态 */
function init () {
  board = Array.from({ length: rows }, () => Array(cols).fill(0))
  revealed = Array.from({ length: rows }, () => Array(cols).fill(false))
  flagged = Array.from({ length: rows }, () => Array(cols).fill(false))
  firstClick = true
  won = false
  mineCount.value = mineTotal
  timer.value = 0
  if (timerId) { clearInterval(timerId); timerId = null }
}

/**
 * 布雷：在棋盘上随机放置 mineTotal 颗雷
 * @param {number} safeR 首次点击的行（避开此格周围 3×3）
 * @param {number} safeC 首次点击的列
 */
function placeMines (safeR, safeC) {
  let placed = 0
  while (placed < mineTotal) {
    const r = Math.floor(Math.random() * rows)
    const c = Math.floor(Math.random() * cols)
    if (board[r][c] === -1) continue // 已有雷，跳过
    if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue // 避开首次点击周围
    board[r][c] = -1
    placed++
  }
  // 计算每个非雷格周围 8 格的雷数
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === -1) continue
      let n = 0
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === -1) n++
        }
      }
      board[r][c] = n
    }
  }
}

// ---------- 计时器 ----------

function startTimer () {
  if (timerId) return
  timerId = setInterval(() => { timer.value++ }, 1000)
}

function stopTimer () {
  if (timerId) { clearInterval(timerId); timerId = null }
}

// ---------- 核心逻辑 ----------

/**
 * 洪水填充揭开：从点 (r,c) 开始递归揭开
 * 若该格数字为 0（周围无雷），则继续揭开相邻 8 格
 */
function flood (r, c) {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return // 越界
  if (revealed[r][c] || flagged[r][c]) return          // 已揭开或已插旗
  revealed[r][c] = true
  if (board[r][c] === 0) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        flood(r + dr, c + dc)
      }
    }
  }
}

/** 游戏结束时揭开所有雷 */
function revealAll () {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === -1) revealed[r][c] = true
    }
  }
}

/** 胜利判定：所有非雷格子都已揭开 */
function checkWin () {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] !== -1 && !revealed[r][c]) return false
    }
  }
  return true
}

// ---------- 状态控制 ----------

/** 开始游戏 */
function start () {
  if (status.value === 'playing') return
  if (status.value === 'over' || status.value === 'idle') init()
  status.value = 'playing'
  draw()
}

/** 暂停/继续：暂停时停止计时器，继续时若已开局则恢复计时 */
function togglePause () {
  if (status.value === 'playing') {
    status.value = 'paused'
    stopTimer()
  } else if (status.value === 'paused') {
    status.value = 'playing'
    if (!firstClick) startTimer()
  }
  draw()
}

/** 重新开始 */
function restart () {
  init()
  status.value = 'playing'
  draw()
}

// ---------- 输入处理 ----------

/**
 * 左键点击：揭开格子
 * - 首次点击：布雷（保证安全）+ 启动计时器
 * - 点到雷：揭开所有雷，游戏失败
 * - 点到数字：洪水填充揭开
 */
function onClick (e) {
  if (status.value !== 'playing') return
  const rect = canvasRef.value.getBoundingClientRect()
  const c = Math.floor((e.clientX - rect.left) / cell)
  const r = Math.floor((e.clientY - rect.top) / cell)
  if (r < 0 || r >= rows || c < 0 || c >= cols) return
  if (flagged[r][c] || revealed[r][c]) return // 已插旗或已揭开的不处理

  if (firstClick) {
    placeMines(r, c) // 首次点击后布雷
    firstClick = false
    startTimer()
  }

  if (board[r][c] === -1) {
    // 踩雷：揭开所有雷，失败
    revealAll()
    status.value = 'over'
    won = false
    stopTimer()
  } else {
    flood(r, c)
    if (checkWin()) {
      status.value = 'over'
      won = true
      stopTimer()
    }
  }
  draw()
}

/** 右键点击：切换旗帜标记，更新剩余雷数 */
function onRightClick (e) {
  if (status.value !== 'playing') return
  const rect = canvasRef.value.getBoundingClientRect()
  const c = Math.floor((e.clientX - rect.left) / cell)
  const r = Math.floor((e.clientY - rect.top) / cell)
  if (r < 0 || r >= rows || c < 0 || c >= cols) return
  if (revealed[r][c]) return // 已揭开的不能插旗
  flagged[r][c] = !flagged[r][c]
  // 重新统计旗帜数
  let flags = 0
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (flagged[i][j]) flags++
  mineCount.value = mineTotal - flags
  draw()
}

// ---------- 渲染 ----------

/** 绘制单个格子 */
function drawCell (r, c) {
  const x = c * cell
  const y = r * cell
  if (revealed[r][c]) {
    // 已揭开：雷显示红色背景+黑圆，数字按颜色显示
    ctx.fillStyle = board[r][c] === -1 ? '#fca5a5' : '#e2e8f0'
    ctx.fillRect(x, y, cell, cell)
    if (board[r][c] === -1) {
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.arc(x + cell / 2, y + cell / 2, cell / 4, 0, Math.PI * 2)
      ctx.fill()
    } else if (board[r][c] > 0) {
      ctx.fillStyle = NUM_COLORS[board[r][c]]
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(board[r][c]), x + cell / 2, y + cell / 2)
    }
  } else {
    // 未揭开：3D 凸起效果（左上亮、右下暗）
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(x, y, cell, cell)
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(x, y, cell, 3)
    ctx.fillRect(x, y, 3, cell)
    ctx.fillStyle = '#475569'
    ctx.fillRect(x, y + cell - 3, cell, 3)
    ctx.fillRect(x + cell - 3, y, 3, cell)
    // 旗帜（红色三角旗）
    if (flagged[r][c]) {
      ctx.fillStyle = '#dc2626'
      ctx.fillRect(x + cell / 2 - 1, y + 6, 2, cell - 12) // 旗杆
      ctx.beginPath()
      ctx.moveTo(x + cell / 2 + 1, y + 6)
      ctx.lineTo(x + cell / 2 + 10, y + 11)
      ctx.lineTo(x + cell / 2 + 1, y + 16)
      ctx.closePath()
      ctx.fill()
    }
  }
  // 格子边框
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'
  ctx.strokeRect(x, y, cell, cell)
}

/** 绘制遮罩文字 */
function drawOverlay (text, sub) {
  const canvas = canvasRef.value
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 26px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 6)
  if (sub) {
    ctx.font = '14px sans-serif'
    ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 22)
  }
}

/** 绘制全部格子 + 状态遮罩 */
function draw () {
  const canvas = canvasRef.value
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) drawCell(r, c)
  }
  if (status.value === 'over') {
    drawOverlay(won ? '胜利！' : '踩雷了', `用时 ${timer.value} 秒`)
  } else if (status.value === 'paused') {
    drawOverlay('已暂停')
  } else if (status.value === 'idle') {
    drawOverlay('点击「开始」游戏')
  }
}

// ---------- 生命周期 ----------

// 组件挂载时：获取 2D 上下文，初始化棋盘并绘制
onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  init()
  draw()
})

// 组件卸载时：停止计时器
onUnmounted(() => {
  stopTimer()
})
</script>

<style scoped>
.mine-wrap { display: inline-block; text-align: center; }
.mine-wrap canvas { border: 1px solid #475569; display: block; cursor: pointer; }
.info { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; color: #475569; font-size: 14px; gap: 8px; }
.btns { display: flex; gap: 6px; }
.info button { cursor: pointer; padding: 2px 10px; border: 1px solid #475569; background: #475569; color: #fff; border-radius: 4px; }
.info button:disabled { opacity: 0.4; cursor: not-allowed; }
.tip { color: #94a3b8; font-size: 12px; margin-top: 6px; }
</style>
