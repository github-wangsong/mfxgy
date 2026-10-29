<template>
  <div class="demo">
    <mf-input v-model="value" placeholder="请输入内容" />
    <p class="tip">当前值：{{ value || '（空）' }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfInput } from 'mfxgy-ui'

const value = ref('')
</script>

<style scoped>
.demo {
  max-width: 360px;
}

.tip {
  margin: 8px 0 0;
  color: #909399;
  font-size: 13px;
}
</style>
