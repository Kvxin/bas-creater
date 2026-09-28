/**
 * Namespace: preview
 * ---------------------------------------------------------------------------
 * Preview / stage panel (src/components/editor/PreviewPanel.vue): the zoom and
 * fullscreen overlay, the playback transport bar and the canvas resolution
 * menu. Also holds the screen-reader labels of the transform handles drawn on
 * top of the stage (src/components/editor/controls/TransformControls.vue).
 *
 * Deliberately NOT translated (they are data, not prose):
 *   - canvas preset labels / aspects: '800×450', '16:9', … (CANVAS_PRESETS)
 *   - zoom preset numbers: 25% … 200%
 *
 * Shared keys available: common.ts — reuse where the meaning matches exactly.
 * Dev-only console output does not need translation.
 */
const zhCN = {
  zoom: {
    /** Tooltip of the "+" button in the stage overlay. */
    in: '放大',
    /** Tooltip of the "−" button in the stage overlay. */
    out: '缩小',
    /** Tooltip of the percentage button that rescales the canvas to the viewport. */
    fitToWindow: '点击适配窗口',
    /** Zoom level shown while the canvas is scaled to fit the whole viewport. */
    fit: '适应',
    /** Tooltip of the zoom dropdown in the bottom toolbar. */
    menu: '视图缩放',
  },
  fullscreen: {
    enter: '全屏',
    exit: '退出全屏',
  },
  playback: {
    play: '播放',
    pause: '暂停',
    /** Restart playback from time 0. */
    fromStart: '从头播放',
    /** Seek back to time 0, keeping the paused state. */
    seekToStart: '回到开头',
    /** Jump forward by a fixed step. */
    skipForward: '快进',
  },
  resolution: {
    /** Tooltip of the canvas resolution dropdown. */
    menu: '画布分辨率',
    /** Label of the custom canvas width field. */
    width: '宽',
    /** Label of the custom canvas height field. */
    height: '高',
    canvasWidth: '画布宽度',
    canvasHeight: '画布高度',
    applyCustomSize: '应用自定义尺寸',
  },
  /** Screen-reader labels of the transform handles; `{corner}` is nw/ne/se/sw. */
  transform: {
    scaleHandle: '缩放 {corner}',
    rotateHandle: '旋转',
    anchorHandle: '移动变换锚点',
  },
}

const en: typeof zhCN = {
  zoom: {
    in: 'Zoom in',
    out: 'Zoom out',
    fitToWindow: 'Click to fit the window',
    fit: 'Fit',
    menu: 'View zoom',
  },
  fullscreen: {
    enter: 'Fullscreen',
    exit: 'Exit fullscreen',
  },
  playback: {
    play: 'Play',
    pause: 'Pause',
    fromStart: 'Play from start',
    seekToStart: 'Back to start',
    skipForward: 'Skip forward',
  },
  resolution: {
    menu: 'Canvas resolution',
    width: 'Width',
    height: 'Height',
    canvasWidth: 'Canvas width',
    canvasHeight: 'Canvas height',
    applyCustomSize: 'Apply custom size',
  },
  transform: {
    scaleHandle: 'Scale {corner}',
    rotateHandle: 'Rotate',
    anchorHandle: 'Move transform anchor',
  },
}

const ja: typeof zhCN = {
  zoom: {
    in: '拡大',
    out: '縮小',
    fitToWindow: 'クリックでウィンドウに合わせる',
    fit: 'フィット',
    menu: '表示ズーム',
  },
  fullscreen: {
    enter: '全画面表示',
    exit: '全画面表示を終了',
  },
  playback: {
    play: '再生',
    pause: '一時停止',
    fromStart: '最初から再生',
    seekToStart: '先頭に戻る',
    skipForward: '早送り',
  },
  resolution: {
    menu: 'キャンバス解像度',
    width: '幅',
    height: '高さ',
    canvasWidth: 'キャンバス幅',
    canvasHeight: 'キャンバス高',
    applyCustomSize: 'カスタムサイズを適用',
  },
  transform: {
    scaleHandle: '拡大縮小 {corner}',
    rotateHandle: '回転',
    anchorHandle: '変形の基準点を移動',
  },
}

export default { 'zh-CN': zhCN, en, ja }
