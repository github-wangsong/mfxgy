<template>
  <div>
    <mf-button>默认按钮</mf-button>
    <mf-button type="primary">主要按钮</mf-button>
    <mf-button type="success">成功按钮</mf-button>
    <mf-button type="info">信息按钮</mf-button>
    <mf-button type="warning">警告按钮</mf-button>
    <mf-button type="danger">危险按钮</mf-button>
    <br />
    <br />
    <mf-button plain>朴素按钮</mf-button>
    <mf-button type="primary" plain>主要按钮</mf-button>
    <mf-button type="success" plain>成功按钮</mf-button>
    <mf-button type="info" plain>信息按钮</mf-button>
    <mf-button type="warning" plain>警告按钮</mf-button>
    <mf-button type="danger" plain>危险按钮</mf-button>
    <br />
    <br />
    <mf-button round>圆角按钮</mf-button>
    <mf-button type="primary" round>主要按钮</mf-button>
    <mf-button type="success" round>成功按钮</mf-button>
    <mf-button type="danger" round>危险按钮</mf-button>
    <mf-button type="primary" circle aria-label="新增">+</mf-button>
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
