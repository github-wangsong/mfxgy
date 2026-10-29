<template>
  <div class="demo">
    <mf-input v-model="account" maxlength="20" show-word-limit placeholder="请输入账号">
      <template #prefix>ID</template>
      <template #suffix>@mfxgy</template>
    </mf-input>
    <p class="tip">前缀、后缀、字数统计都是独立插槽 / 计算状态。</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfInput } from 'mfxgy-ui'

const account = ref('mfxgy-ui')
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
