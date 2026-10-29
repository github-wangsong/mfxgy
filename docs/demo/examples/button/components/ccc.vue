<template>
  <div>
    <mf-button>默认按钮</mf-button>
    <mf-button size="large">大尺寸按钮</mf-button>
    <mf-button size="small">小尺寸按钮</mf-button>
    <mf-button type="primary" size="large">主要按钮</mf-button>
    <mf-button type="primary" size="small">主要按钮</mf-button>
  </div>
</template>

<script setup>
import { MfButton } from 'mfxgy-ui'
</script>

<style scoped>
.mf-button {
  margin: 10px 5px;
}
</style>
