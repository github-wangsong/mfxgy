<template>
  <div>
    <mf-button type="primary" @click="showPersistent">常驻消息（手动关闭）</mf-button>
    <mf-button @click="showStack">连续弹出三条</mf-button>
  </div>
</template>

<script setup>
import { MfButton, MfMessage } from 'mfxgy-ui'

function showPersistent() {
  MfMessage.success({
    message: '这条消息不会自动关闭',
    duration: 0,
    showClose: true,
  })
}

function showStack() {
  MfMessage.info('第一条')
  setTimeout(() => MfMessage.warning('第二条'), 200)
  setTimeout(() => MfMessage.error('第三条'), 400)
}
</script>
