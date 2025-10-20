<template>
  <div class="theme-settings p-4 space-y-4">
    <h3 class="text-lg font-semibold">主题设置</h3>

    <!-- 暗色模式切换 -->
    <div class="flex items-center justify-between">
      <span>暗色模式</span>
      <Switch v-model:checked="themeStore.isDark" />
    </div>

    <!-- 主题色选择 -->
    <div class="space-y-2">
      <span class="text-sm font-medium">主题色</span>
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="color in themeStore.presetColors"
          :key="color.name"
          @click="themeStore.setPrimaryColor(color.value)"
          :class="[
            'w-12 h-12 rounded-lg border-2 transition-all',
            themeStore.themeConfig.colorPrimary === color.value
              ? 'border-gray-800 scale-110'
              : 'border-gray-300 hover:scale-105'
          ]"
          :style="{ backgroundColor: color.value }"
          :title="color.name"
        />
      </div>
    </div>

    <!-- 自定义主题色 -->
    <div class="space-y-2">
      <span class="text-sm font-medium">自定义主题色</span>
      <input
        type="color"
        :value="themeStore.themeConfig.colorPrimary"
        @input="themeStore.setPrimaryColor(($event.target as HTMLInputElement).value)"
        class="w-full h-10 rounded border"
      />
    </div>

    <!-- 圆角设置 -->
    <div class="space-y-2">
      <span class="text-sm font-medium">圆角大小: {{ themeStore.themeConfig.radius }}px</span>
      <input type="range" v-model="themeStore.themeConfig.radius" min="0" max="20" step="1" class="w-full" />
    </div>

    <!-- 重置按钮 -->
    <div class="pt-4">
      <Button class="w-full" @click="themeStore.resetTheme()">
        重置为默认主题
      </Button>
    </div>

    <!-- 当前主题信息 -->
    <div class="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs">
      <div>当前主题: {{ themeStore.isDark ? '暗色' : '亮色' }}</div>
      <div>主题色: {{ themeStore.themeConfig.colorPrimary }}</div>
      <div>圆角: {{ themeStore.themeConfig.radius }}px</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useThemeStore } from '@/stores/modules/theme'

import { Button } from '@/components/ui/button'
import Switch from '@/components/ui/switch/Switch.vue'
const themeStore = useThemeStore()
</script>

<style scoped>
.theme-settings {
  max-width: 300px;
}
</style>
