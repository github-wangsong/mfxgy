<template>
  <div>
    <el-button disabled>禁用按钮</el-button>
    <el-button type="primary" disabled>主要按钮</el-button>
    <el-button type="success" disabled>成功按钮</el-button>
    <el-button type="info" disabled>信息按钮</el-button>
    <el-button type="warning" disabled>警告按钮</el-button>
    <el-button type="danger" disabled>危险按钮</el-button>
    <br />
    <br />
    <el-button disabled>禁用按钮</el-button>
    <el-button type="primary" disabled plain>主要按钮</el-button>
    <el-button type="success" disabled plain>成功按钮</el-button>
    <el-button type="info" disabled plain>信息按钮</el-button>
    <el-button type="warning" disabled plain>警告按钮</el-button>
    <el-button type="danger" disabled plain>危险按钮</el-button>
  </div>
</template>
<script setup>
</script>
<style>
.k-el-button {
  margin-right: 10px;
}
</style>