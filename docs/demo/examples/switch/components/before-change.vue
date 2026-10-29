<template>
  <div class="demo">
    <mf-switch
      v-model="enabled"
      :before-change="beforeChange"
      active-text="已启用"
      inactive-text="已停用"
    />
    <p class="tip">{{ tip }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfSwitch } from 'mfxgy-ui'

const enabled = ref(false)
const tip = ref('点击开关，模拟一次异步保存')

/**
 * 返回 Promise<boolean>：
 * resolve(true) 才真正切换，resolve(false) 或 reject 都会取消
 */
function beforeChange(nextValue) {
  tip.value = '正在保存...'
  return new Promise((resolve) => {
    setTimeout(() => {
      tip.value = nextValue ? '保存成功，已开启' : '保存成功，已关闭'
      resolve(true)
    }, 800)
  })
}
</script>

<style scoped>
.demo {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tip {
  margin: 0;
  color: #909399;
  font-size: 13px;
}
</style>
