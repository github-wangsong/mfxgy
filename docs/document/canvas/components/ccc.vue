<template>
  <div class="shooter">
    <div class="info">
      <span>得分: {{ score }}</span>
      <span>生命: {{ lives }}</span>
      <span>等级: {{ level }}</span>
      <span class="buff">伤害 {{ damage }} / 散射 {{ bulletCount }} / 射速 {{ fireInterval }}ms</span>
      <span class="status">{{ statusText }}</span>
    </div>
    <canvas
      id="canvas3"
      ref="canvasRef"
      width="400"
      height="500"
    ></canvas>
    <div class="btns">
      <button @click="startGame">{{ isRunning ? '重新开始' : '开始游戏' }}</button>
      <button @click="togglePause">{{ isPaused ? '继续' : '暂停' }}</button>
    </div>
    <p class="tips">← → / A D 移动 · 空格暂停 · 自动开火</p>
  </div>
</template>c

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const canvasRef = ref(null)
const ctx = ref(null)
const score = ref(0)
const lives = ref(3)
const level = ref(1)
const damage = ref(1)
const bulletCount = ref(1)
const fireInterval = ref(400)
const isRunning = ref(false)
const isPaused = ref(false)
const statusText = ref('点击开始')
let rafId = null

// 玩家飞机
const player = {
  x: 200,
  y: 460,
  w: 30,
  h: 20,
  speed: 1,
  color: '#4fc3f7'
}

// 子弹、砖块、道具、粒子集合
const bullets = []
const bricks = []
const powerups = []
const particles = []

// 控制状态
const keys = { left: false, right: false }
let lastFireTime = 0
let lastBrickTime = 0
let gameTime = 0 // 累计游戏时间(ms)，用于难度递增

// 砖块血量层级表：血量越大颜色越深、体积越大
const brickTiers = [
  { hp: 1, w: 28, h: 16, color: '#fff59d' }, // 淡黄
  { hp: 2, w: 34, h: 18, color: '#ffb74d' }, // 橙
  { hp: 3, w: 40, h: 20, color: '#ff7043' }, // 橙红
  { hp: 5, w: 46, h: 22, color: '#e53935' }, // 红
  { hp: 8, w: 54, h: 24, color: '#8d174e' }  // 深红
]

// 根据游戏时间生成砖块层级（随时间变厚）
function getBrickTierByTime () {
  // 每 12 秒提升一档难度，封顶到最高档
  const tier = Math.min(brickTiers.length - 1, Math.floor(gameTime / 12000))
  // 简单难度：60% 出当前档，30% 低一档，10% 高一档
  const r = Math.random()
  let idx = tier
  if (r < 0.3 && tier > 0) idx = tier - 1
  else if (r > 0.9 && tier < brickTiers.length - 1) idx = tier + 1
  return idx
}

function spawnBrick () {
  const idx = getBrickTierByTime()
  const t = brickTiers[idx]
  bricks.push({
    x: Math.random() * (canvasRef.value.width - t.w),
    y: -t.h,
    w: t.w,
    h: t.h,
    hp: t.hp,
    maxHp: t.hp,
    color: t.color,
    vy: 0.3 + Math.random() * 0.2, // 简单：下落缓慢
    tier: idx
  })
}

// 道具类型
const powerupTypes = [
  { type: 'damage', label: '伤害+1', color: '#e91e63' },
  { type: 'bullet', label: '散射+1', color: '#9c27b0' },
  { type: 'speed', label: '射速+', color: '#00bcd4' }
]

function maybeDropPowerup (x, y) {
  // 30% 概率掉落
  if (Math.random() > 0.3) return
  const t = powerupTypes[Math.floor(Math.random() * powerupTypes.length)]
  powerups.push({ x, y, w: 16, h: 16, vy: 1.5, ...t })
}

// 创建粒子（击中爆炸效果）
function spawnParticles (x, y, color) {
  for (let i = 0; i < 8; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      life: 20,
      color
    })
  }
}

// 发射子弹（支持散射）
function fire () {
  const cx = player.x
  const cy = player.y
  const n = bulletCount.value
  // 散射角度：n 发均匀分布在 -30°~30°
  for (let i = 0; i < n; i++) {
    const angle = n === 1 ? 0 : (-30 + (60 / (n - 1)) * i) * Math.PI / 180
    bullets.push({
      x: cx,
      y: cy,
      vx: Math.sin(angle) * 5,
      vy: -Math.cos(angle) * 5,
      r: 3,
      dmg: damage.value
    })
  }
}

// 更新玩家
function updatePlayer () {
  if (keys.left) player.x = Math.max(player.w / 2, player.x - player.speed)
  if (keys.right) player.x = Math.min(canvasRef.value.width - player.w / 2, player.x + player.speed)
}

// 更新子弹
function updateBullets () {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.x += b.vx
    b.y += b.vy
    if (b.y < -10 || b.x < -10 || b.x > canvasRef.value.width + 10) {
      bullets.splice(i, 1)
    }
  }
}

// 更新砖块 + 碰撞
function updateBricks () {
  for (let i = bricks.length - 1; i >= 0; i--) {
    const br = bricks[i]
    br.y += br.vy

    // 出底部：扣血
    if (br.y > canvasRef.value.height) {
      bricks.splice(i, 1)
      lives.value -= 1
      if (lives.value <= 0) {
        gameOver('游戏结束')
        return
      }
      continue
    }

    // 与子弹碰撞
    for (let j = bullets.length - 1; j >= 0; j--) {
      const bu = bullets[j]
      if (
        bu.x + bu.r > br.x &&
        bu.x - bu.r < br.x + br.w &&
        bu.y + bu.r > br.y &&
        bu.y - bu.r < br.y + br.h
      ) {
        br.hp -= bu.dmg
        bullets.splice(j, 1)
        spawnParticles(bu.x, bu.y, br.color)
        if (br.hp <= 0) {
          score.value += br.maxHp * 10
          maybeDropPowerup(br.x + br.w / 2, br.y + br.h / 2)
          bricks.splice(i, 1)
        }
        break
      }
    }
  }
}

// 更新道具
function updatePowerups () {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i]
    p.y += p.vy
    // 接住
    if (
      p.x > player.x - player.w / 2 &&
      p.x < player.x + player.w / 2 &&
      p.y > player.y - player.h / 2 &&
      p.y < player.y + player.h / 2
    ) {
      applyPowerup(p.type)
      powerups.splice(i, 1)
      continue
    }
    if (p.y > canvasRef.value.height) powerups.splice(i, 1)
  }
}

function applyPowerup (type) {
  if (type === 'damage') damage.value = Math.min(10, damage.value + 1)
  else if (type === 'bullet') bulletCount.value = Math.min(5, bulletCount.value + 1)
  else if (type === 'speed') fireInterval.value = Math.max(80, fireInterval.value - 40)
}

// 更新粒子
function updateParticles () {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.x += p.vx
    p.y += p.vy
    p.life--
    if (p.life <= 0) particles.splice(i, 1)
  }
}

// ========== 绘制 ==========
function draw () {
  const c = ctx.value
  c.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)

  // 砖块（按血量显示血条）
  bricks.forEach(br => {
    c.fillStyle = br.color
    c.fillRect(br.x, br.y, br.w, br.h)
    // 高光
    c.fillStyle = 'rgba(255,255,255,0.25)'
    c.fillRect(br.x, br.y, br.w, 3)
    // 血量条（受伤时显示）
    if (br.hp < br.maxHp) {
      const ratio = br.hp / br.maxHp
      c.fillStyle = 'rgba(0,0,0,0.5)'
      c.fillRect(br.x, br.y - 4, br.w, 2)
      c.fillStyle = '#4caf50'
      c.fillRect(br.x, br.y - 4, br.w * ratio, 2)
    }
  })

  // 子弹
  c.fillStyle = '#ffeb3b'
  bullets.forEach(b => {
    c.beginPath()
    c.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    c.fill()
  })

  // 道具
  powerups.forEach(p => {
    c.fillStyle = p.color
    c.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h)
    c.fillStyle = '#fff'
    c.font = '10px Arial'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(p.label, p.x, p.y)
  })

  // 粒子
  particles.forEach(p => {
    c.fillStyle = p.color
    c.globalAlpha = p.life / 20
    c.fillRect(p.x, p.y, 3, 3)
  })
  c.globalAlpha = 1

  // 玩家飞机（三角）
  const px = player.x, py = player.y, w = player.w, h = player.h
  c.fillStyle = player.color
  c.beginPath()
  c.moveTo(px, py - h / 2)
  c.lineTo(px - w / 2, py + h / 2)
  c.lineTo(px - w / 4, py + h / 4)
  c.lineTo(px + w / 4, py + h / 4)
  c.lineTo(px + w / 2, py + h / 2)
  c.closePath()
  c.fill()
  c.fillStyle = '#0277bd'
  c.fillRect(px - 2, py - h / 2 - 4, 4, 6)
}

// ========== 主循环（关键帧 + 时间控制）==========
let lastFrameTime = 0
function loop (timestamp) {
  if (!isRunning.value || isPaused.value) return
  const dt = timestamp - lastFrameTime
  lastFrameTime = timestamp
  gameTime += dt

  // 等级随时间提升
  const newLevel = Math.floor(gameTime / 12000) + 1
  if (newLevel !== level.value) level.value = newLevel

  // 玩家移动
  updatePlayer()

  // 自动开火
  if (timestamp - lastFireTime >= fireInterval.value) {
    lastFireTime = timestamp
    fire()
  }

  // 砖块生成节奏（前期稀疏，随时间逐步加快）
  const spawnInterval = Math.max(800, 2500 - Math.floor(gameTime / 1000) * 20)
  if (timestamp - lastBrickTime >= spawnInterval) {
    lastBrickTime = timestamp
    spawnBrick()
  }

  updateBullets()
  updateBricks()
  updatePowerups()
  updateParticles()
  draw()

  rafId = requestAnimationFrame(loop)
}

// ========== 控制 ==========
function onKeydown (e) {
  if (e.code === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true
  if (e.code === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true
  if (e.code === 'Space') {
    e.preventDefault()
    togglePause()
  }
}
function onKeyup (e) {
  if (e.code === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false
  if (e.code === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false
}

// ========== 游戏控制 ==========
function resetGame () {
  score.value = 0
  lives.value = 3
  level.value = 1
  damage.value = 1
  bulletCount.value = 1
  fireInterval.value = 400
  bricks.length = 0
  bullets.length = 0
  powerups.length = 0
  particles.length = 0
  player.x = canvasRef.value.width / 2
  gameTime = 0
  lastFireTime = 0
  lastBrickTime = 0
  statusText.value = '点击开始'
}

function startGame () {
  cancelAnimationFrame(rafId)
  resetGame()
  isRunning.value = true
  isPaused.value = false
  statusText.value = '进行中'
  lastFrameTime = performance.now()
  rafId = requestAnimationFrame(loop)
}

function togglePause () {
  if (!isRunning.value) return
  isPaused.value = !isPaused.value
  statusText.value = isPaused.value ? '已暂停' : '进行中'
  if (!isPaused.value) {
    lastFrameTime = performance.now()
    rafId = requestAnimationFrame(loop)
  }
}

function gameOver (text) {
  statusText.value = text
  isRunning.value = false
  cancelAnimationFrame(rafId)
}

onMounted(() => {
  ctx.value = canvasRef.value.getContext('2d')
  resetGame()
  draw()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
})
</script>

<style scoped>
.shooter {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: Arial, sans-serif;
}
#canvas3 {
  border: 1px solid #ddd;
  background: #0a1929;
  display: block;
}
.info {
  width: 400px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
  color: #333;
}
.buff { color: #1976d2; font-size: 12px; }
.status { font-weight: bold; color: #ff5252; }
.btns { margin-top: 8px; display: flex; gap: 8px; }
.btns button { padding: 4px 12px; cursor: pointer; }
.tips { margin: 6px 0 0; font-size: 12px; color: #999; }
</style>
