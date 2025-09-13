<script setup lang="ts">
import { App as AntApp } from 'ant-design-vue'
import { provide } from 'vue'
import { AntdAppKey } from '@/plugins/antd-app'

const api = AntApp.useApp()
provide(AntdAppKey, api)
</script>

<template>
  <slot />
</template>

