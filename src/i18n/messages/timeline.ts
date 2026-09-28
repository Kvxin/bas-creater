/**
 * Namespace: timeline
 * ---------------------------------------------------------------------------
 * Timeline panel (TimelinePanel.vue): the track list header, the per-track
 * headers, track type / mute / visibility labels, the playhead snap indicator,
 * the playhead drag hint and the clip drag / resize tooltips. Also the auto
 * generated track name used by stores/timeline.ts.
 *
 * Reuses `common`: keyframeBase / keyframeLabel for the keyframe markers and
 * unknown for a clip without a name.
 *
 * Labels returned by the panel's helpers are resolved through `t()` at call
 * time so they follow the active locale; a track name, in contrast, is a
 * snapshot written when the track is created and keeps its original language.
 *
 * Dev-only console output (TimeRuler.vue, store warnings) is not translated.
 */
const zhCN = {
  trackList: '轨道列表',
  addTrack: '添加轨道',
  /** Header of the animation / keyframe row of an expanded track. */
  keyframes: '动画关键帧',
  track: {
    expand: '展开轨道动画',
    remove: '删除轨道',
    mute: '静音轨道',
    unmute: '取消静音轨道',
    hide: '隐藏轨道',
    show: '显示轨道',
    /** Disabled video track slot on every track header. */
    videoPlaceholder: '视频轨道占位，暂未启用',
    /** Track type labels, derived from the resource first placed on the track. */
    type: {
      audio: '音频轨道',
      danmu: '弹幕轨道',
      empty: '空轨道',
    },
    typeLockedAria: '{type}，轨道类型由首次放入的资源锁定',
    typeLockedTitle: '{type} · 首次放入资源后锁定类型',
  },
  /** Names of the playhead snap candidates and the snap tooltip itself. */
  snap: {
    clipStart: '片段开始',
    clipEnd: '片段结束',
    keyframe: '关键帧',
    indicator: '吸附 · {label}',
  },
  playhead: {
    dragHint: '拖动定位；Shift 暂时关闭片段与关键帧吸附',
  },
  /** Values of the floating tooltips shown while dragging or resizing a clip. */
  tooltip: {
    start: '起点: {time}',
    copyTo: '复制到: {time}',
    resize: '起点: {start} · 时长: {duration} · 终点: {end}',
  },
  /** Auto generated name of a new track; `n` is the 1-based track index. */
  defaultTrackName: '轨道 {n}',
}

const en: typeof zhCN = {
  trackList: 'Track list',
  addTrack: 'Add track',
  keyframes: 'Animation keyframes',
  track: {
    expand: 'Expand track animation',
    remove: 'Delete track',
    mute: 'Mute track',
    unmute: 'Unmute track',
    hide: 'Hide track',
    show: 'Show track',
    videoPlaceholder: 'Video track placeholder, not enabled yet',
    type: {
      audio: 'Audio track',
      danmu: 'Danmaku track',
      empty: 'Empty track',
    },
    typeLockedAria: '{type}. Track type is locked by the first resource placed on it.',
    typeLockedTitle: '{type} · Type is locked once a resource is placed',
  },
  snap: {
    clipStart: 'Clip start',
    clipEnd: 'Clip end',
    keyframe: 'Keyframe',
    indicator: 'Snap · {label}',
  },
  playhead: {
    dragHint: 'Drag to move; hold Shift to temporarily disable clip and keyframe snapping',
  },
  tooltip: {
    start: 'Start: {time}',
    copyTo: 'Copy to: {time}',
    resize: 'Start: {start} · Duration: {duration} · End: {end}',
  },
  defaultTrackName: 'Track {n}',
}

const ja: typeof zhCN = {
  trackList: 'トラック一覧',
  addTrack: 'トラックを追加',
  keyframes: 'アニメーションキーフレーム',
  track: {
    expand: 'トラックのアニメーションを展開',
    remove: 'トラックを削除',
    mute: 'トラックをミュート',
    unmute: 'トラックのミュートを解除',
    hide: 'トラックを非表示',
    show: 'トラックを表示',
    videoPlaceholder: '動画トラックのプレースホルダー（未対応）',
    type: {
      audio: '音声トラック',
      danmu: '弾幕トラック',
      empty: '空のトラック',
    },
    typeLockedAria: '{type}。トラックの種類は最初に配置したリソースで固定されます',
    typeLockedTitle: '{type} · 最初のリソースを配置すると種類が固定されます',
  },
  snap: {
    clipStart: 'クリップ開始',
    clipEnd: 'クリップ終了',
    keyframe: 'キーフレーム',
    indicator: 'スナップ · {label}',
  },
  playhead: {
    dragHint: 'ドラッグで移動；Shift を押すとクリップとキーフレームのスナップを一時的に解除',
  },
  tooltip: {
    start: '開始: {time}',
    copyTo: 'コピー先: {time}',
    resize: '開始: {start} · 長さ: {duration} · 終了: {end}',
  },
  defaultTrackName: 'トラック {n}',
}

export default { 'zh-CN': zhCN, en, ja }
