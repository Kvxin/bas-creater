/**
 * Namespace: timeline
 * ---------------------------------------------------------------------------
 * Timeline panel (TimelinePanel.vue): the track list header, the per-track
 * headers, track type / mute / visibility labels, timebase / FPS / BPM grid
 * popover, cue markers, the playhead snap indicator, the playhead drag hint
 * and the clip drag / resize tooltips. Also the auto generated track name used
 * by stores/timeline.ts.
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
  timebase: {
    triggerTitle: '时间基准与节拍网格设置',
    modeLabel: '时间刻度模式',
    modes: {
      frames: '帧 (FPS)',
      milliseconds: '毫秒 (ms)',
      beats: '节拍 (BPM)',
    },
    fpsLabel: '参考帧率',
    customFps: '自定义帧率',
    bpmLabel: '音乐速度 (BPM)',
    beatOffsetLabel: '首拍偏移 (ms)',
    setOffsetFromPlayhead: '取游标位置',
  },
  markers: {
    toggleAtPlayhead: '在游标处添加/移除卡点标记 (M)',
    previous: '上一标记点 ([)',
    next: '下一标记点 (])',
    clearAll: '清空全部标记',
    count: '{n} 个标记',
    itemTitle: '标记点 · {time}（点击跳转，右键或 Alt+点击删除）',
  },
  /** Names of the snap candidates and the snap tooltip itself. */
  snap: {
    toggle: '吸附对齐（拖动时按住 Shift 临时自由微调）',
    playhead: '播放头',
    marker: '标记点',
    clipStart: '片段开始',
    clipEnd: '片段结束',
    keyframe: '关键帧',
    frame: '帧网格',
    beat: '节拍网格',
    indicator: '吸附 · {label}',
  },
  playhead: {
    dragHint: '拖动定位；Shift 暂时关闭吸附',
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
  timebase: {
    triggerTitle: 'Timebase & beat grid settings',
    modeLabel: 'Ruler & timecode mode',
    modes: {
      frames: 'Frames (FPS)',
      milliseconds: 'Milliseconds (ms)',
      beats: 'Beats (BPM)',
    },
    fpsLabel: 'Reference FPS',
    customFps: 'Custom FPS',
    bpmLabel: 'Tempo (BPM)',
    beatOffsetLabel: 'First beat offset (ms)',
    setOffsetFromPlayhead: 'Use playhead',
  },
  markers: {
    toggleAtPlayhead: 'Add/remove cue marker at playhead (M)',
    previous: 'Previous marker ([)',
    next: 'Next marker (])',
    clearAll: 'Clear all markers',
    count: '{n} markers',
    itemTitle: 'Marker · {time} (click to seek, right-click or Alt+click to delete)',
  },
  snap: {
    toggle: 'Snap to grid & targets (hold Shift while dragging to bypass)',
    playhead: 'Playhead',
    marker: 'Marker',
    clipStart: 'Clip start',
    clipEnd: 'Clip end',
    keyframe: 'Keyframe',
    frame: 'Frame grid',
    beat: 'Beat grid',
    indicator: 'Snap · {label}',
  },
  playhead: {
    dragHint: 'Drag to move; hold Shift to temporarily bypass snapping',
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
  timebase: {
    triggerTitle: 'タイムベースとビートグリッド設定',
    modeLabel: '時間目盛りモード',
    modes: {
      frames: 'フレーム (FPS)',
      milliseconds: 'ミリ秒 (ms)',
      beats: 'ビート (BPM)',
    },
    fpsLabel: '基準フレームレート',
    customFps: 'カスタム FPS',
    bpmLabel: 'テンポ (BPM)',
    beatOffsetLabel: '開始拍オフセット (ms)',
    setOffsetFromPlayhead: '再生ヘッド位置を使用',
  },
  markers: {
    toggleAtPlayhead: '再生ヘッド位置にマーカーを追加/削除 (M)',
    previous: '前のマーカー ([)',
    next: '次のマーカー (])',
    clearAll: 'すべてのマーカーを消去',
    count: '{n} 個のマーカー',
    itemTitle: 'マーカー · {time}（クリックで移動、右クリックまたは Alt+クリックで削除）',
  },
  snap: {
    toggle: 'スナップ吸着（ドラッグ中に Shift を押すと一時解除）',
    playhead: '再生ヘッド',
    marker: 'マーカー',
    clipStart: 'クリップ開始',
    clipEnd: 'クリップ終了',
    keyframe: 'キーフレーム',
    frame: 'フレームグリッド',
    beat: 'ビートグリッド',
    indicator: 'スナップ · {label}',
  },
  playhead: {
    dragHint: 'ドラッグで移動；Shift を押すとスナップを一時解除',
  },
  tooltip: {
    start: '開始: {time}',
    copyTo: 'コピー先: {time}',
    resize: '開始: {start} · 長さ: {duration} · 終了: {end}',
  },
  defaultTrackName: 'トラック {n}',
}

export default { 'zh-CN': zhCN, en, ja }
