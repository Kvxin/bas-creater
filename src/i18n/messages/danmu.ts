/**
 * Namespace: danmu
 * ---------------------------------------------------------------------------
 * Danmaku domain vocabulary: the three danmaku kinds plus the default values
 * written into a freshly created resource (utils/danmuDefaults.ts,
 * utils/danmuFactory.ts) and the short labels used by resource helpers.
 *
 * NOTE: `defaultText` / `defaultButtonText` become *data* — they are stored in
 * the resource and in the generated BAS code. They are resolved on creation,
 * so switching the language afterwards does not rewrite existing resources.
 */
const zhCN = {
  type: {
    text: '文本弹幕',
    button: '按钮弹幕',
    path: '路径弹幕',
  },
  /** Short badges used in dense lists (resource type column, chips). */
  short: {
    text: '文本',
    button: '按钮',
    path: '路径',
    audio: '音频',
    unknown: '未知',
  },
  defaultText: '请输入内容',
  defaultButtonText: '按钮',
}

const en: typeof zhCN = {
  type: {
    text: 'Text danmaku',
    button: 'Button danmaku',
    path: 'Path danmaku',
  },
  short: {
    text: 'Text',
    button: 'Button',
    path: 'Path',
    audio: 'Audio',
    unknown: 'Unknown',
  },
  defaultText: 'Enter content',
  defaultButtonText: 'Button',
}

const ja: typeof zhCN = {
  type: {
    text: 'テキスト弾幕',
    button: 'ボタン弾幕',
    path: 'パス弾幕',
  },
  short: {
    text: 'テキスト',
    button: 'ボタン',
    path: 'パス',
    audio: '音声',
    unknown: '不明',
  },
  defaultText: '内容を入力してください',
  defaultButtonText: 'ボタン',
}

export default { 'zh-CN': zhCN, en, ja }
