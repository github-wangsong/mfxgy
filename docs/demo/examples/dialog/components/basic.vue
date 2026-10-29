<template>
  <div>
    <mf-button type="primary" @click="visible = true">打开对话框</mf-button>

    <mf-dialog v-model="visible" title="提示" width="420px">
      <p class="content">
        这是一个通过 Teleport 渲染到 body 的对话框，支持遮罩、焦点管理、Esc 关闭和滚动锁定。
      </p>
      <template #footer>
        <mf-button @click="visible = false">取消</mf-button>
        <mf-button type="primary" @click="visible = false">确定</mf-button>
      </template>
    </mf-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MfButton, MfDialog } from 'mfxgy-ui'

const visible = ref(false)
</script>

<style scoped>
.content {
  margin: 0;
}
</style>
