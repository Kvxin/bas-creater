/**
 * Namespace: audio
 * ---------------------------------------------------------------------------
 * Audio editing widgets: the waveform / volume line overlays of an audio clip
 * and any audio error text that reaches the user.
 *
 * Audit result (see the pre-migration scan):
 *   AudioVolumeLine.vue : '拖动调整片段音量' (title of the draggable hit area)
 *   AudioWaveform.vue   : code comments and dev `console.*` output only — the
 *                         decode failure path is swallowed silently, so there is
 *                         no user visible string to translate.
 *   utils/audio/*       : audio-engine.ts / waveform-cache.ts / audio-cover.ts
 *                         throw nothing that is displayed (audio-cover.ts even
 *                         absorbs its own failure) — nothing to translate.
 */
const zhCN = {
  /** Tooltip of the draggable volume line over an audio clip. */
  volumeDrag: '拖动调整片段音量',
}

const en: typeof zhCN = {
  volumeDrag: 'Drag to adjust clip volume',
}

const ja: typeof zhCN = {
  volumeDrag: 'ドラッグしてクリップの音量を調整',
}

export default { 'zh-CN': zhCN, en, ja }
