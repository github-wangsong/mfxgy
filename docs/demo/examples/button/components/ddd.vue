<template>
  <div>
    <mf-button loading>加载中</mf-button>
    <mf-button type="primary" loading>提交中</mf-button>
    <mf-button type="success" :loading="loading" @click="submit">点击提交</mf-button>
    <p class="tip">loading 期间按钮不可点击，避免重复提交。</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfButton } from 'mfxgy-ui'

const loading = ref(false)

function submit() {
  loading.value = true
  setTimeout(() => {
    loading.value = false
  }, 1500)
}
</script>

<style scoped>
.mf-button {
  margin: 10px 5px;
}

.tip {
  margin-top: 12px;
  color: #909399;
  font-size: 13px;
}
</style>
