/**
 * Namespace: resources
 * ---------------------------------------------------------------------------
 * Resource library panel. Owner files:
 *   src/components/editor/ResourcesPanel.vue
 *   src/components/editor/resources/ResourcesHeader.vue
 *   src/components/editor/resources/ResourcesList.vue
 *   src/components/editor/resources/ResourcesSidebar.vue
 *   src/utils/resourceUtils.ts
 *
 * Covered strings (from the pre-migration audit):
 *   ResourcesHeader.vue  : '弹幕资源', '添加文本弹幕', '添加按钮弹幕',
 *                          '添加路径弹幕', '上传音频文件', '搜索...'
 *   ResourcesSidebar.vue : '全部', '音频资源'; the three danmaku kinds reuse
 *                          danmu.type.*
 *   ResourcesList.vue    : '暂无资源', '拖放音频文件到这里，或点击上方按钮上传',
 *                          `${name} 封面` (cover alt), `${name} (双击编辑)`,
 *                          '添加到新轨道'; the name/type/duration table headers
 *                          reuse common.name / common.type / common.duration and
 *                          the row actions reuse common.delete
 *   ResourcesPanel.vue   : '释放以上传音频文件', '共 N 个项目', '已选中: X',
 *                          '切换为网格布局' / '切换为列表布局'
 *   utils/resourceUtils.ts: '未命名音频' / '未知项目' fallbacks; the type names
 *                          reuse danmu.type.* and the short badges danmu.short.*
 *
 * Shared keys available: see common.ts and danmu.ts.
 */
const zhCN = {
  /** Panel header title. */
  title: '弹幕资源',
  /** Quick-add buttons of the header, one per danmaku kind. */
  addText: '添加文本弹幕',
  addButton: '添加按钮弹幕',
  addPath: '添加路径弹幕',
  uploadAudio: '上传音频文件',
  search: '搜索...',
  /** Sidebar tabs (danmaku kinds reuse danmu.type.*). */
  tabAll: '全部',
  tabAudio: '音频资源',
  /** Empty list placeholder. */
  empty: '暂无资源',
  emptyHint: '拖放音频文件到这里，或点击上方按钮上传',
  /** Overlay shown while an audio file is dragged over the panel. */
  dropOverlay: '释放以上传音频文件',
  /** Footer counters. */
  itemCount: '共 {n} 个项目',
  selected: '已选中: {name}',
  /** Layout toggle button (title + aria-label). */
  viewGrid: '切换为网格布局',
  viewList: '切换为列表布局',
  /** Row action: drop the resource onto a freshly created track. */
  addToNewTrack: '添加到新轨道',
  /** Alt text of the generated audio cover in grid layout. */
  coverAlt: '{name} 封面',
  /** Tooltip of a resource name: hint that a double click renames it. */
  itemTooltip: '{name}（双击编辑）',
  /** Fallback names built by utils/resourceUtils.ts. */
  unnamedAudio: '未命名音频',
  unknownItem: '未知项目',
}

const en: typeof zhCN = {
  title: 'Danmaku resources',
  addText: 'Add text danmaku',
  addButton: 'Add button danmaku',
  addPath: 'Add path danmaku',
  uploadAudio: 'Upload audio file',
  search: 'Search...',
  tabAll: 'All',
  tabAudio: 'Audio',
  empty: 'No resources yet',
  emptyHint: 'Drop audio files here, or use the upload button above',
  dropOverlay: 'Drop to upload audio file',
  itemCount: '{n} items',
  selected: 'Selected: {name}',
  viewGrid: 'Switch to grid layout',
  viewList: 'Switch to list layout',
  addToNewTrack: 'Add to new track',
  coverAlt: '{name} cover',
  itemTooltip: '{name} (double-click to edit)',
  unnamedAudio: 'Untitled audio',
  unknownItem: 'Unknown item',
}

const ja: typeof zhCN = {
  title: '弾幕リソース',
  addText: 'テキスト弾幕を追加',
  addButton: 'ボタン弾幕を追加',
  addPath: 'パス弾幕を追加',
  uploadAudio: '音声ファイルをアップロード',
  search: '検索...',
  tabAll: 'すべて',
  tabAudio: '音声',
  empty: 'リソースがありません',
  emptyHint: 'ここに音声ファイルをドロップするか、上のボタンからアップロードしてください',
  dropOverlay: 'ドロップして音声ファイルをアップロード',
  itemCount: '全 {n} 件',
  selected: '選択中: {name}',
  viewGrid: 'グリッド表示に切り替え',
  viewList: 'リスト表示に切り替え',
  addToNewTrack: '新しいトラックに追加',
  coverAlt: '{name} のカバー',
  itemTooltip: '{name}（ダブルクリックで編集）',
  unnamedAudio: '無題の音声',
  unknownItem: '不明な項目',
}

export default { 'zh-CN': zhCN, en, ja }
