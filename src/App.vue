<script setup lang="ts">
import { RouterView } from 'vue-router'
import { App as AntApp, ConfigProvider, theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import enUS from 'ant-design-vue/es/locale/en_US'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark } from '@vueuse/core'
import AntdAppProvider from '@/components/providers/AntdAppProvider.vue'

const isDark = useDark({ selector: 'html', attribute: 'class', valueDark: 'dark', valueLight: 'light' })
const algorithm = computed(() => (isDark.value ? theme.darkAlgorithm : theme.defaultAlgorithm))

const { locale } = useI18n()
const antdLocale = computed(() => (locale.value === 'zh-CN' ? zhCN : enUS))

watch(
  () => locale.value,
  (l) => {
    dayjs.locale(l === 'zh-CN' ? 'zh-cn' : 'en')
  },
  { immediate: true }
)

const colorPrimary = ref('#22c55e')
const colorSuccess = ref('#22c55e')
const colorWarning = ref('#f59e0b')
const colorError = ref('#ef4444')
const colorInfo = ref('#0ea5e9')
const fontFamily = ref('ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, Apple Color Emoji, Segoe UI Emoji')
const radius = ref<number>(6)

function readCssVar(name: string) {
  const root = document.documentElement
  return getComputedStyle(root).getPropertyValue(name).trim()
}

function computeFromCssVars() {
  const p = readCssVar('--primary')
  if (p) colorPrimary.value = `hsl(${p})`

  const r = readCssVar('--radius')
  if (r.endsWith('rem')) {
    radius.value = parseFloat(r) * 16
  } else if (r.endsWith('px')) {
    radius.value = parseFloat(r)
  } else if (r) {
    const v = parseFloat(r)
    if (!Number.isNaN(v)) radius.value = v
  }

  const ff = readCssVar('--font-sans')
  if (ff) fontFamily.value = ff

  const s = readCssVar('--success')
  if (s) colorSuccess.value = `hsl(${s})`
  const w = readCssVar('--warning')
  if (w) colorWarning.value = `hsl(${w})`
  const e = readCssVar('--destructive')
  if (e) colorError.value = `hsl(${e})`
  const i = readCssVar('--info')
  if (i) colorInfo.value = `hsl(${i})`
}

onMounted(() => {
  computeFromCssVars()
})
</script>

<template>
  <AntApp>
    <ConfigProvider :theme="{ algorithm, token: { colorPrimary, colorSuccess, colorWarning, colorError, colorInfo, fontFamily, borderRadius: radius } }" :locale="antdLocale">
      <AntdAppProvider>
        <div class="fixed right-2 top-2 z-50 flex items-center gap-2 rounded border bg-background/60 px-2 py-1 backdrop-blur">
          <a-select v-model:value="locale" size="small" style="width: 120px" :options="[{label: '中文', value: 'zh-CN'}, {label: 'English', value: 'en-US'}]" />
          <a-switch v-model:checked="isDark" size="small" :checked-children="'🌙'" :un-checked-children="'☀️'" />
        </div>
        <RouterView />
      </AntdAppProvider>
    </ConfigProvider>
  </AntApp>
</template>

<style scoped></style>
