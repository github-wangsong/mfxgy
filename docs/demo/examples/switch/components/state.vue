<template>
  <div class="demo">
    <mf-switch v-model="checked" disabled active-text="禁用" />
    <mf-switch v-model="checked" loading active-text="加载中" />
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
</style>
