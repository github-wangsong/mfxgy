<template>
  <div class="demo">
    <mf-input v-model="keyword" clearable placeholder="输入后可一键清空" />
    <mf-input v-model="password" type="password" show-password placeholder="请输入密码" />
    <p class="tip">keyword：{{ keyword || '（空）' }}，password 长度：{{ password.length }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfInput } from 'mfxgy-ui'

const keyword = ref('mfxgy-ui')
const password = ref('')
</script>

<style scoped>
.demo {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
}

.tip {
  margin: 0;
  color: #909399;
  font-size: 13px;
  word-break: break-all;
}
</style>
