/**
 * Namespace: dialogs
 * ---------------------------------------------------------------------------
 * Clip details dialog (src/components/dialogs/ClipDetailsDialog.vue): the BAS
 * code preview and the clip / resource field editors.
 *
 * `*Section` labels name the data model being edited (Clip / Resource) and keep
 * that token in every locale; the pure translation glosses of the zh-CN labels
 * ('内容 (Content)', '字号 (FontSize)', ...) are dropped in en/ja.
 *
 * Shared keys available: common.ts — reuse where the meaning matches exactly.
 */
const zhCN = {
  title: '弹幕详情与编辑',
  codePreview: 'BAS 代码预览',
  copyCode: '复制完整代码',
  clipSection: '时间轴属性 (Clip)',
  startTime: '开始时间 (ms)',
  duration: '持续时长 (ms)',
  resourceSection: '弹幕属性 (Resource)',
  alias: '名称 (Alias)',
  content: '内容 (Content)',
  text: '文本 (Text)',
  x: 'X 坐标',
  y: 'Y 坐标',
  fontSize: '字号 (FontSize)',
  opacity: '透明度 (Opacity)',
  color: '颜色 (Color/Hex)',
  loadFailed: '无法加载弹幕数据',
}

const en: typeof zhCN = {
  title: 'Danmaku details & editing',
  codePreview: 'BAS code preview',
  copyCode: 'Copy full code',
  clipSection: 'Timeline properties (Clip)',
  startTime: 'Start time (ms)',
  duration: 'Duration (ms)',
  resourceSection: 'Danmaku properties (Resource)',
  alias: 'Name',
  content: 'Content',
  text: 'Text',
  x: 'X position',
  y: 'Y position',
  fontSize: 'Font size',
  opacity: 'Opacity',
  color: 'Color (hex)',
  loadFailed: 'Could not load danmaku data',
}

const ja: typeof zhCN = {
  title: '弾幕の詳細と編集',
  codePreview: 'BAS コードプレビュー',
  copyCode: 'コード全体をコピー',
  clipSection: 'タイムライン属性 (Clip)',
  startTime: '開始時間 (ms)',
  duration: '継続時間 (ms)',
  resourceSection: '弾幕プロパティ (Resource)',
  alias: '名前',
  content: '内容',
  text: 'テキスト',
  x: 'X 座標',
  y: 'Y 座標',
  fontSize: 'フォントサイズ',
  opacity: '不透明度',
  color: '色 (16 進数)',
  loadFailed: '弾幕データを読み込めません',
}

export default { 'zh-CN': zhCN, en, ja }
