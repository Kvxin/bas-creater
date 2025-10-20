import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useDark } from '@vueuse/core'


export interface ThemeConfig {
    colorPrimary: string
    colorSuccess: string
    colorWarning: string
    colorError: string
    colorInfo: string
    fontFamily: string
    radius: number
}

export const useThemeStore = defineStore('theme', () => {
    // 暗色模式控制
    const isDark = useDark({
        selector: 'html',
        attribute: 'class',
        valueDark: 'dark',
        valueLight: 'light'
    })

    // 主题配置（统一用 hex 或标准 css 颜色字符串）
    const themeConfig = ref<ThemeConfig>({
        colorPrimary: '#22c55e',
        colorSuccess: '#22c55e',
        colorWarning: '#f59e0b',
        colorError: '#ef4444',
        colorInfo: '#0ea5e9',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, Apple Color Emoji, Segoe UI Emoji',
        radius: 6
    })

    // 预设主题色
    const presetColors = ref([
        { name: '绿色', value: '#22c55e' },
        { name: '蓝色', value: '#3b82f6' },
        { name: '紫色', value: '#8b5cf6' },
        { name: '粉色', value: '#ec4899' },
        { name: '橙色', value: '#f97316' },
        { name: '红色', value: '#ef4444' },
        { name: '青色', value: '#06b6d4' },
        { name: '黄色', value: '#eab308' }
    ])

    // 当前主题配置
    const currentTheme = computed(() => ({
        isDark: isDark.value,
        ...themeConfig.value
    }))



    // 读取 CSS 变量
    function readCssVar(name: string): string {
        const root = document.documentElement
        return getComputedStyle(root).getPropertyValue(name).trim()
    }

    // 从 CSS 变量计算主题配置
    function computeFromCssVars() {
        const p = readCssVar('--primary')
        if (p) themeConfig.value.colorPrimary = p.startsWith('hsl') ? p : p

        const r = readCssVar('--radius')
        if (r.endsWith('rem')) {
            themeConfig.value.radius = parseFloat(r) * 16
        } else if (r.endsWith('px')) {
            themeConfig.value.radius = parseFloat(r)
        } else if (r) {
            const v = parseFloat(r)
            if (!Number.isNaN(v)) themeConfig.value.radius = v
        }

        const ff = readCssVar('--font-sans')
        if (ff) themeConfig.value.fontFamily = ff

        const s = readCssVar('--success')
        if (s) themeConfig.value.colorSuccess = s

        const w = readCssVar('--warning')
        if (w) themeConfig.value.colorWarning = w

        const e = readCssVar('--destructive')
        if (e) themeConfig.value.colorError = e

        const i = readCssVar('--info')
        if (i) themeConfig.value.colorInfo = i
    }

    // 切换暗色模式
    function toggleDark() {
        isDark.value = !isDark.value
    }

    // 设置主题色
    function setPrimaryColor(color: string) {
        themeConfig.value.colorPrimary = color
        updateCssVariables()
    }

    // 设置主题配置
    function setThemeConfig(config: Partial<ThemeConfig>) {
        themeConfig.value = { ...themeConfig.value, ...config }
        updateCssVariables()
    }

    // 更新 CSS 变量（直接写合法颜色值，不裁剪）
    function updateCssVariables() {
        const root = document.documentElement
        root.style.setProperty('--primary', themeConfig.value.colorPrimary)
        root.style.setProperty('--success', themeConfig.value.colorSuccess)
        root.style.setProperty('--warning', themeConfig.value.colorWarning)
        root.style.setProperty('--destructive', themeConfig.value.colorError)
        root.style.setProperty('--info', themeConfig.value.colorInfo)
        root.style.setProperty('--radius', `${themeConfig.value.radius}px`)
        root.style.setProperty('--font-sans', themeConfig.value.fontFamily)
    }

    // 重置为默认主题
    function resetTheme() {
        themeConfig.value = {
            colorPrimary: '#22c55e',
            colorSuccess: '#22c55e',
            colorWarning: '#f59e0b',
            colorError: '#ef4444',
            colorInfo: '#0ea5e9',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, Apple Color Emoji, Segoe UI Emoji',
            radius: 6
        }
        updateCssVariables()
    }

    // 监听主题变化
    watch(
        themeConfig,
        () => updateCssVariables(),
        { deep: true }
    )

    return {
        // 状态
        isDark,
        themeConfig,
        presetColors,

        // 计算属性
        currentTheme,


        // 方法
        toggleDark,
        setPrimaryColor,
        setThemeConfig,
        computeFromCssVars,
        updateCssVariables,
        resetTheme,
        readCssVar
    }
})
