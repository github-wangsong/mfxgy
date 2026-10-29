<template>
  <div class="demo">
    <div class="row">
      <mf-switch v-model="checked" />
      <span class="tip">当前状态：{{ checked ? '开启' : '关闭' }}</span>
    </div>
    <div class="row">
      <mf-switch v-model="checked" active-text="开启" inactive-text="关闭" />
      <span class="tip">文字会跟随状态切换</span>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfSwitch } from 'mfxgy-ui'

const checked = ref(true)
</script>

<style scoped>
.demo {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tip {
  color: #909399;
  font-size: 13px;
}
</style>
