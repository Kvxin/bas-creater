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
  bins: '素材箱',
  rootBin: '根目录',
  newBin: '新建素材箱',
  binName: '素材箱名称',
  deleteBinConfirm: '删除素材箱“{name}”？其中的素材和子素材箱将移至上一级。',
  renameResourceDescription: '输入新的素材名称。',
  nameRequired: '请输入名称。',
  newBinTitle: '新建素材箱',
  renameBinTitle: '重命名素材箱',
  renameResourceTitle: '重命名素材',
  deleteBinTitle: '删除素材箱',
  binNameDescription: '输入素材箱名称。',
  binNameRequired: '请输入素材箱名称。',
  moveBin: '移动素材箱',
  moveAsset: '移动所选素材',
  deleteConfirm: '删除素材“{name}”？将同时移除时间轴及所有嵌套片段中的 {count} 处引用。磁盘文件不会删除。',
  relinkMismatch: '所选文件与“{name}”不匹配（原大小 {oldSize} 字节，现为 {newSize} 字节，或文件类型不同）。仍要重链接吗？',
  historyAudioUnavailable: '无法读取或恢复音频“{name}”，撤销或重做已取消。请检查源文件及访问权限后重试。',
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
  bins: 'Bins',
  rootBin: 'Root',
  newBin: 'New bin',
  binName: 'Bin name',
  deleteBinConfirm: 'Delete bin “{name}”? Its assets and child bins will move to its parent.',
  renameResourceDescription: 'Enter a new resource name.',
  nameRequired: 'Enter a name.',
  newBinTitle: 'Create bin',
  renameBinTitle: 'Rename bin',
  renameResourceTitle: 'Rename resource',
  deleteBinTitle: 'Delete bin',
  binNameDescription: 'Enter a name for this bin.',
  binNameRequired: 'Enter a bin name.',
  moveBin: 'Move bin',
  moveAsset: 'Move selected asset',
  deleteConfirm: 'Delete “{name}” and its {count} references in the timeline and nested groups? Files on disk will not be deleted.',
  relinkMismatch: 'The selected file differs from “{name}” (original size {oldSize} bytes, new size {newSize} bytes, or a different file type). Relink anyway?',
  historyAudioUnavailable: 'Audio “{name}” cannot be read or restored. Undo or redo was cancelled. Check the source file and permissions, then retry.',
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
  bins: '素材箱',
  rootBin: 'ルート',
  newBin: '素材箱を作成',
  binName: '素材箱の名前',
  renameResourceDescription: '新しい素材名を入力してください。',
  nameRequired: '名前を入力してください。',
  deleteBinConfirm: '素材箱「{name}」を削除しますか？素材と子の素材箱は親に移動します。',
  moveBin: '素材箱を移動',
  moveAsset: '選択した素材を移動',
  deleteConfirm: '素材「{name}」とタイムラインおよびネスト内の参照 {count} 件を削除しますか？ディスク上のファイルは削除されません。',
  newBinTitle: '素材箱を作成',
  renameBinTitle: '素材箱の名前を変更',
  renameResourceTitle: '素材名を変更',
  deleteBinTitle: '素材箱を削除',
  binNameDescription: '素材箱の名前を入力してください。',
  binNameRequired: '素材箱の名前を入力してください。',
  relinkMismatch: '選択したファイルは「{name}」と異なります（元のサイズ {oldSize} バイト、新しいサイズ {newSize} バイト、または種類が異なります）。再リンクしますか？',
  historyAudioUnavailable: '音声「{name}」を読み込むか復元できないため、元に戻す・やり直しを中止しました。元のファイルとアクセス権を確認して再試行してください。',
}
export default { 'zh-CN': zhCN, en, ja }
