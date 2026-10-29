<template>
  <div>
    <mf-button @click="visible = true">自定义头部与底部</mf-button>

    <mf-dialog
      v-model="visible"
      width="480px"
      :close-on-click-modal="false"
      top="12vh"
    >
      <template #header>
        <div class="header">
          <span class="header__title">自定义标题</span>
          <span class="header__badge">Beta</span>
        </div>
      </template>

      <p class="content">
        点击遮罩不会关闭（close-on-click-modal=false），按 Esc 仍然可以关闭。
        关闭后焦点会自动回到触发按钮。
      </p>

      <template #footer>
        <mf-button text @click="visible = false">稍后再说</mf-button>
        <mf-button type="primary" @click="visible = false">知道了</mf-button>
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
.header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header__title {
  font-size: 18px;
  font-weight: 600;
}

.header__badge {
  padding: 2px 6px;
  border-radius: 4px;
  background-color: #ecf5ff;
  color: #409eff;
  font-size: 12px;
}

.content {
  margin: 0;
}
</style>
