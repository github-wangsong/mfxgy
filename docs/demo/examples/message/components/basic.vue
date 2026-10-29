<template>
  <div>
    <mf-button @click="show('info')">信息</mf-button>
    <mf-button type="success" @click="show('success')">成功</mf-button>
    <mf-button type="warning" @click="show('warning')">警告</mf-button>
    <mf-button type="danger" @click="show('error')">错误</mf-button>
  </div>
</template>

<script setup>
import { MfButton, MfMessage } from 'mfxgy-ui'

const messages = {
  info: '这是一条信息提示',
  success: '保存成功',
  warning: '请注意检查输入内容',
  error: '操作失败，请重试',
}

function show(type) {
  MfMessage({ message: messages[type], type })
}
</script>
