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
  save: '保存',
  saveNow: '立即保存',
  saving: '保存中...',
  saved: '已自动保存',
  unsaved: '未保存更改',
  newProject: '新建工程',
  exportProject: '备份工程',
  importProject: '还原工程',
  confirmNewProject: '确认新建空白工程吗？当前未导出的内容将会被清空。',
}

const en: typeof zhCN = {
  export: 'Export',
  language: 'Language',
  toggleTheme: 'Toggle theme',
  resizeResources: 'Resize resources panel',
  resizeProperties: 'Resize properties panel',
  resizeTimeline: 'Resize timeline panel',
  save: 'Save',
  saveNow: 'Save now',
  saving: 'Saving...',
  saved: 'Auto-saved',
  unsaved: 'Unsaved changes',
  newProject: 'New project',
  exportProject: 'Backup project',
  importProject: 'Restore project',
  confirmNewProject: 'Are you sure you want to create a new project? Current progress will be reset.',
}

const ja: typeof zhCN = {
  export: '書き出し',
  language: '言語',
  toggleTheme: 'テーマを切り替え',
  resizeResources: 'リソースパネルの幅を調整',
  resizeProperties: 'プロパティパネルの幅を調整',
  resizeTimeline: 'タイムラインの高さを調整',
  save: '保存',
  saveNow: '今すぐ保存',
  saving: '保存中...',
  saved: '自動保存済み',
  unsaved: '未保存の変更',
  newProject: '新規プロジェクト',
  exportProject: 'プロジェクトをバックアップ',
  importProject: 'プロジェクトを復元',
  confirmNewProject: '新しいプロジェクトを作成しますか？現在のデータはリセットされます。',
}

export default { 'zh-CN': zhCN, en, ja }
