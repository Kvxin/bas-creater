import { createI18n } from 'vue-i18n'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': {
      app: { title: '应用' },
    },
    'en-US': {
      app: { title: 'App' },
    },
  },
})

