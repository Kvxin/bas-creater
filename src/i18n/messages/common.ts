/**
 * Namespace: common
 * ---------------------------------------------------------------------------
 * Generic, reusable labels shared by more than one screen.
 * Keep this list small and truly generic — feature specific wording belongs in
 * the matching feature namespace (properties, timeline, resources, ...).
 *
 * Every namespace file uses the same shape:
 *   const zhCN = { ... }            <- the reference schema
 *   const en: typeof zhCN = { ... } <- must contain exactly the same keys
 *   const ja: typeof zhCN = { ... } <- must contain exactly the same keys
 * A missing or misspelled key is a TypeScript error, so all locales stay in
 * sync automatically.
 */
const zhCN = {
  close: '关闭',
  copy: '复制',
  cut: '剪切',
  delete: '删除',
  details: '查看详情',
  duration: '时长',
  name: '名称',
  paste: '粘贴',
  rename: '重命名',
  type: '类型',
  unknown: '未知',
  /** Name of the auto generated copy of a resource, e.g. "文本弹幕 副本". */
  duplicateName: '{name} 副本',
  /** First entry of a keyframe list (the resource's base state). */
  keyframeBase: '基态',
  /** Nth animated keyframe; the base state counts as #1. */
  keyframeLabel: '关键帧 {n}',
}

const en: typeof zhCN = {
  close: 'Close',
  copy: 'Copy',
  cut: 'Cut',
  delete: 'Delete',
  details: 'View details',
  duration: 'Duration',
  name: 'Name',
  paste: 'Paste',
  rename: 'Rename',
  type: 'Type',
  unknown: 'Unknown',
  duplicateName: '{name} copy',
  keyframeBase: 'Base state',
  keyframeLabel: 'Keyframe {n}',
}

const ja: typeof zhCN = {
  close: '閉じる',
  copy: 'コピー',
  cut: '切り取り',
  delete: '削除',
  details: '詳細を表示',
  duration: '長さ',
  name: '名前',
  paste: '貼り付け',
  rename: '名前を変更',
  type: '種類',
  unknown: '不明',
  duplicateName: '{name} のコピー',
  keyframeBase: '基本状態',
  keyframeLabel: 'キーフレーム {n}',
}

export default { 'zh-CN': zhCN, en, ja }
