<template>
  <div class="demo">
    <mf-input v-model="value" disabled placeholder="禁用状态" />
    <mf-input v-model="value" readonly placeholder="只读状态" />
    <mf-input v-model="value" size="large" placeholder="大尺寸" />
    <mf-input v-model="value" size="small" placeholder="小尺寸" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfInput } from 'mfxgy-ui'

const value = ref('mfxgy-ui')
</script>

<style scoped>
.demo {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 360px;
}
</style>
