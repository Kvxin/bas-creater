/**
 * Namespace: menus
 * ---------------------------------------------------------------------------
 * Context menu registry (src/config/menus.ts) rendered by
 * src/components/GlobalContextMenu.vue.
 *
 * IMPORTANT: MENU_REGISTRY is a module level config evaluated once at import
 * time, so it stores wording as message KEYS (`MenuItem.labelKey` /
 * `MenuConfig.labelKey`) instead of literals; GlobalContextMenu.vue resolves
 * them with `t()` while rendering, which keeps the labels reactive.
 *
 * Only context-menu specific wording lives here. The generic verbs are reused
 * from `common.*` (details / copy / cut / paste / delete / rename) and are NOT
 * duplicated in this namespace.
 *
 * Wording covered (from the pre-migration audit):
 *   '删除轨道', '片段操作', '音频片段操作', '时间轴', '添加轨道',
 *   '资源操作', '添加到轨道', '未定义的菜单: {menuId}'
 */
const zhCN = {
  trackDelete: '删除轨道',
  /** Group labels of the registry entries (rendered as the menu header). */
  clipActions: '片段操作',
  splitElement: '拆分元素',
  splitLeft: '拆分并删除左侧',
  splitRight: '拆分并删除右侧',
  audioClipActions: '音频片段操作',
  timelineActions: '时间轴',
  addTrack: '添加轨道',
  resourceActions: '资源操作',
  addToTrack: '添加到轨道',
  /** Fallback for a menu id that has no entry in MENU_REGISTRY. */
  undefined: '未定义的菜单: {menuId}',
}

const en: typeof zhCN = {
  trackDelete: 'Delete track',
  clipActions: 'Clip actions',
  splitElement: 'Split element',
  splitLeft: 'Split left',
  splitRight: 'Split right',
  audioClipActions: 'Audio clip actions',
  timelineActions: 'Timeline',
  addTrack: 'Add track',
  resourceActions: 'Resource actions',
  addToTrack: 'Add to track',
  undefined: 'Undefined menu: {menuId}',
}

const ja: typeof zhCN = {
  trackDelete: 'トラックを削除',
  clipActions: 'クリップの操作',
  splitElement: '要素を分割',
  splitLeft: '分割して左側を削除',
  splitRight: '分割して右側を削除',
  audioClipActions: '音声クリップの操作',
  timelineActions: 'タイムライン',
  addTrack: 'トラックを追加',
  resourceActions: 'リソースの操作',
  addToTrack: 'トラックに追加',
  undefined: '未定義のメニュー: {menuId}',
}

export default { 'zh-CN': zhCN, en, ja }
