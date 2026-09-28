/**
 * Namespace: app
 * ---------------------------------------------------------------------------
 * Application shell: header actions, language switcher and the resize handles
 * of the editor layout (EditorLayout.vue).
 */
const zhCN = {
  export: '导出',
  language: '语言',
  toggleTheme: '切换主题',
  resizeResources: '调整资源面板宽度',
  resizeProperties: '调整属性面板宽度',
  resizeTimeline: '调整时间轴高度',
}

const en: typeof zhCN = {
  export: 'Export',
  language: 'Language',
  toggleTheme: 'Toggle theme',
  resizeResources: 'Resize resources panel',
  resizeProperties: 'Resize properties panel',
  resizeTimeline: 'Resize timeline panel',
}

const ja: typeof zhCN = {
  export: '書き出し',
  language: '言語',
  toggleTheme: 'テーマを切り替え',
  resizeResources: 'リソースパネルの幅を調整',
  resizeProperties: 'プロパティパネルの幅を調整',
  resizeTimeline: 'タイムラインの高さを調整',
}

export default { 'zh-CN': zhCN, en, ja }
