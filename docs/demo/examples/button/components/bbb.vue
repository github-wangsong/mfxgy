<template>
  <div>
    <mf-button disabled>禁用按钮</mf-button>
    <mf-button type="primary" disabled>主要按钮</mf-button>
    <mf-button type="success" disabled>成功按钮</mf-button>
    <mf-button type="info" disabled>信息按钮</mf-button>
    <mf-button type="warning" disabled>警告按钮</mf-button>
    <mf-button type="danger" disabled>危险按钮</mf-button>
    <br />
    <br />
    <mf-button disabled plain>禁用按钮</mf-button>
    <mf-button type="primary" disabled plain>主要按钮</mf-button>
    <mf-button type="success" disabled plain>成功按钮</mf-button>
    <mf-button type="info" disabled plain>信息按钮</mf-button>
    <mf-button type="warning" disabled plain>警告按钮</mf-button>
    <mf-button type="danger" disabled plain>危险按钮</mf-button>
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
