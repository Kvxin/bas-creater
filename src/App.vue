<script setup lang="ts">
import {RouterView} from 'vue-router'



import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import { onMounted, watch } from 'vue'
import {useI18n} from 'vue-i18n'

import {useThemeStore} from '@/stores/modules/theme'

// 使用主题 store
const themeStore = useThemeStore()

const {locale} = useI18n()


watch(
    () => locale.value,
    (l) => {
      dayjs.locale(l === 'zh-CN' ? 'zh-cn' : 'en')
    },
    {immediate: true}
)

onMounted(() => {
  themeStore.computeFromCssVars()
})
</script>

<template>
  <RouterView/>
</template>

<style scoped></style>
