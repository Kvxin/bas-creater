import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// Tauri CLI 在执行 beforeDevCommand / beforeBuildCommand 时会注入 TAURI_ENV_PLATFORM
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM)

// https://vite.dev/config/
export default defineConfig({
  // 桌面客户端从应用根路径加载；纯 Web 构建（GitHub Pages）仍部署在 /bas-creater/ 子路径下
  base: isTauri ? '/' : '/bas-creater/',
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'moveable': fileURLToPath(new URL('./node_modules/.pnpm/node_modules/moveable', import.meta.url))
    },
  },
  define: {
    // vue-i18n feature flags: we only use the Composition API and ship the
    // global `$t` injection, so the legacy API can be dropped from the bundle.
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  // Tauri 开发模式需要固定端口，且不清屏以保留 Rust 端日志
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
})
