<template>
  <div class="shooter-wrap">
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
    <canvas ref="canvasRef" width="360" height="520"></canvas>
    <div class="pad">
      <button
        type="button"
        aria-label="左移"
        @pointerdown.prevent="hold('ArrowLeft', true, $event)"
        @pointerup="hold('ArrowLeft', false)"
        @pointerleave="hold('ArrowLeft', false)"
        @pointercancel="hold('ArrowLeft', false)"
      >←</button>
      <button
        type="button"
        aria-label="右移"
        @pointerdown.prevent="hold('ArrowRight', true, $event)"
        @pointerup="hold('ArrowRight', false)"
        @pointerleave="hold('ArrowRight', false)"
        @pointercancel="hold('ArrowRight', false)"
      >→</button>
    </div>
    <p class="tip">← → 移动，自动连发子弹；没有键盘时按住下方按钮</p>
  </div>
</template>

<script setup>
/**
 * 飞机大战（Shooter）
 * ----------------------------------
 * 核心玩法：玩家控制飞机左右移动，自动发射子弹击落敌机。
 * 撞到敌机扣生命，生命归零则游戏结束。
 * 难度随分数缓慢提升：敌机速度加快、生成间隔缩短。
 *
 * 状态机：idle -> playing <-> paused -> over
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

// ---------- 响应式状态 ----------
const canvasRef = ref(null)
const score = ref(0)
const lives = ref(3)
// 游戏状态：idle | playing | paused | over
const status = ref('idle')

const statusText = computed(() => {
  return { idle: '待开始', playing: '进行中', paused: '已暂停', over: '已结束' }[status.value]
})

// ---------- 画布常量 ----------
const W = 360 // 画布宽
const H = 520 // 画布高

// ---------- 游戏实体 ----------
// 玩家飞机：尺寸、位置、移动速度、子弹冷却计数
const player = { w: 40, h: 40, x: W / 2 - 20, y: H - 60, speed: 4, cooldown: 0 }
let bullets = []    // 子弹数组
let enemies = []    // 敌机数组
let particles = []  // 爆炸粒子数组
let keys = {}       // 按键状态表
let ctx = null       // canvas 2D 上下文
let rafId = null     // requestAnimationFrame 返回的帧 ID
let enemyTimer = 0  // 敌机生成倒计时（帧）
let frame = 0       // 帧计数，用于星空背景滚动

/** 重置所有游戏状态到初始值 */
function resetState () {
  score.value = 0
  lives.value = 3
  player.x = W / 2 - 20
  bullets = []
  enemies = []
  particles = []
  enemyTimer = 0
  frame = 0
  keys = {}
}

// ---------- 状态控制 ----------

/** 开始游戏：结束/待开始时先重置，再进入进行中 */
function start () {
  if (status.value === 'playing') return
  if (status.value === 'over' || status.value === 'idle') resetState()
  status.value = 'playing'
  if (!rafId) rafId = requestAnimationFrame(loop)
}

/** 暂停/继续切换 */
function togglePause () {
  if (status.value === 'playing') status.value = 'paused'
  else if (status.value === 'paused') status.value = 'playing'
}

/** 重新开始 */
function restart () {
  resetState()
  status.value = 'playing'
  if (!rafId) rafId = requestAnimationFrame(loop)
}

// ---------- 实体生成 ----------

/**
 * 生成一架敌机：随机尺寸、随机水平位置，速度随分数提升
 */
function spawnEnemy () {
  const size = 28 + Math.random() * 16
  enemies.push({
    x: Math.random() * (W - size), // 随机水平起点
    y: -size,                        // 从画布上方外进入
    w: size,
    h: size,
    // 速度 = 基础 + 随机 + 随分数线性提升
    speed: 0.8 + Math.random() * 1.2 + score.value * 0.001,
    hp: 1
  })
}

/**
 * 在指定位置生成爆炸粒子（12 个方向均匀扩散）
 * @param {number} x 爆炸中心 x
 * @param {number} y 爆炸中心 y
 * @param {string} color 粒子颜色
 */
function createExplosion (x, y, color) {
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12 // 均匀分布 12 个方向角
    particles.push({
      x, y,
      vx: Math.cos(a) * (1 + Math.random() * 2),
      vy: Math.sin(a) * (1 + Math.random() * 2),
      life: 24,   // 粒子存活帧数
      color
    })
  }
}

/**
 * AABB 矩形碰撞检测
 * @returns {boolean} 两矩形是否相交
 */
function rectHit (a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// ---------- 渲染 ----------

/** 绘制玩家飞机（三角形机身 + 矩形驾驶舱） */
function drawPlayer () {
  ctx.fillStyle = '#22d3ee'
  ctx.beginPath()
  ctx.moveTo(player.x + player.w / 2, player.y)         // 机头顶点
  ctx.lineTo(player.x + player.w, player.y + player.h)  // 右下角
  ctx.lineTo(player.x, player.y + player.h)             // 左下角
  ctx.closePath()
  ctx.fill()
  // 驾驶舱装饰
  ctx.fillStyle = '#0e7490'
  ctx.fillRect(player.x + player.w / 2 - 3, player.y + 8, 6, 16)
}

// ---------- 游戏逻辑更新 ----------

/**
 * 每帧更新逻辑：
 * - 玩家移动与边界钳制
 * - 自动发射子弹（冷却控制）
 * - 子弹上移并清理出界
 * - 敌机生成、下移、与玩家碰撞
 * - 子弹与敌机碰撞检测（命中加分+爆炸）
 * - 粒子更新与生命周期管理
 */
function update () {
  frame++

  // 玩家左右移动
  if (keys['ArrowLeft'] || keys['a']) player.x -= player.speed
  if (keys['ArrowRight'] || keys['d']) player.x += player.speed
  player.x = Math.max(0, Math.min(W - player.w, player.x))

  // 子弹自动连发：冷却归零后发射一枚并重置冷却
  player.cooldown--
  if (player.cooldown <= 0) {
    bullets.push({ x: player.x + player.w / 2 - 2, y: player.y, w: 4, h: 12, speed: 8 })
    player.cooldown = 10
  }

  // 子弹上移，移除飞出画布顶部的子弹
  bullets = bullets.filter(b => {
    b.y -= b.speed
    return b.y + b.h > 0
  })

  // 敌机生成计时：间隔随分数缩短（下限 45 帧）
  enemyTimer--
  if (enemyTimer <= 0) {
    spawnEnemy()
    enemyTimer = Math.max(45, 90 - Math.floor(score.value / 80))
  }

  // 敌机下移；飞出底部则移除；撞到玩家则扣命并移除
  enemies = enemies.filter(e => {
    e.y += e.speed
    if (e.y > H) return false
    if (rectHit(e, player)) {
      createExplosion(e.x + e.w / 2, e.y + e.h / 2, '#ef4444')
      lives.value--
      if (lives.value <= 0) status.value = 'over'
      return false
    }
    return true
  })

  // 子弹与敌机碰撞检测（反向遍历避免删除导致索引错位）
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j]
      if (rectHit(b, e)) {
        bullets.splice(j, 1)  // 子弹消失
        createExplosion(e.x + e.w / 2, e.y + e.h / 2, '#f59e0b')
        enemies.splice(i, 1)  // 敌机销毁
        score.value += 10
        break // 一枚子弹只命中一架敌机
      }
    }
  }

  // 粒子移动并衰减生命，移除死亡粒子
  particles = particles.filter(p => {
    p.x += p.vx
    p.y += p.vy
    p.life--
    return p.life > 0
  })
}

/** 绘制一帧：星空背景 + 玩家 + 子弹 + 敌机 + 粒子 */
function draw () {
  // 深色背景
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, W, H)
  // 星空背景：40 个随帧滚动的小点，模拟飞行感
  ctx.fillStyle = '#334155'
  for (let i = 0; i < 40; i++) {
    const sx = (i * 53 + frame * 0.5) % W
    const sy = (i * 97 + frame * 1.2) % H
    ctx.fillRect(sx, sy, 2, 2)
  }

  drawPlayer()

  // 子弹（黄色矩形）
  ctx.fillStyle = '#fde047'
  bullets.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h))

  // 敌机（红色机身 + 深色尾翼）
  enemies.forEach(e => {
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(e.x, e.y, e.w, e.h)
    ctx.fillStyle = '#7f1d1d'
    ctx.fillRect(e.x + 4, e.y + e.h - 6, e.w - 8, 4)
  })

  // 粒子：按生命比例设置透明度，形成渐隐效果
  particles.forEach(p => {
    ctx.globalAlpha = p.life / 24
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
  })
  ctx.globalAlpha = 1 // 恢复不透明度
}

/** 绘制遮罩文字（暂停/结束/待开始用） */
function drawOverlay (text, sub) {
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 30px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, W / 2, H / 2 - 10)
  if (sub) {
    ctx.font = '16px sans-serif'
    ctx.fillText(sub, W / 2, H / 2 + 22)
  }
}

// ---------- 主循环 ----------

function loop () {
  if (status.value === 'over') {
    drawOverlay('游戏结束', `得分: ${score.value}`)
    rafId = null
    return
  }
  if (status.value === 'playing') update()
  draw()
  if (status.value === 'paused') drawOverlay('已暂停')
  if (status.value === 'idle') drawOverlay('点击「开始」游戏')
  rafId = requestAnimationFrame(loop)
}

// ---------- 键盘输入 ----------

function onKeyDown (e) {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
}
function onKeyUp (e) { keys[e.key] = false }

/**
 * 屏幕按钮：按下/松开时同步按键状态
 * 按下时捕获指针，手指滑出按钮后松开也能正确复位，不会一直移动
 */
function hold (key, down, e) {
  if (down && e?.currentTarget?.setPointerCapture) {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  keys[key] = down
}

// ---------- 生命周期 ----------

// 组件挂载时：获取 2D 上下文，重置状态，绘制待开始画面，注册键盘监听
onMounted(() => {
  const canvas = canvasRef.value
  ctx = canvas.getContext('2d')
  resetState()
  draw()
  drawOverlay('点击「开始」游戏')
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

// 组件卸载时：取消动画帧并移除键盘监听，防止内存泄漏
onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  keys = {}
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<style scoped>
.shooter-wrap { display: inline-block; text-align: center; }
.shooter-wrap canvas { border: 1px solid #22d3ee; background: #0f172a; display: block; }
.info { display: flex; justify-content: space-between; align-items: center; width: 360px; margin-bottom: 6px; color: #475569; font-size: 14px; gap: 8px; }
.btns { display: flex; gap: 6px; }
.info button { cursor: pointer; padding: 2px 10px; border: 1px solid #22d3ee; background: #22d3ee; color: #0f172a; border-radius: 4px; }
.info button:disabled { opacity: 0.4; cursor: not-allowed; }
.pad { display: flex; justify-content: center; gap: 12px; margin-top: 8px; }
.pad button {
  min-width: 96px;
  height: 40px;
  font-size: 18px;
  color: #0f172a;
  background: #22d3ee;
  border: 1px solid #22d3ee;
  border-radius: 6px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.pad button:active { filter: brightness(0.9); }
.tip { color: #94a3b8; font-size: 12px; margin-top: 6px; }
</style>
