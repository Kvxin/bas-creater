import type { AnyDanmu } from './danmu';

export interface AnimationSegment {
  id: string;
  type: 'set' | 'then'; // 'set' = 并行/初始 (从 0 开始或指定时间), 'then' = 串行 (接在上一个之后)
  duration: number;     // 毫秒
  properties: Partial<AnyDanmu>; // 变更的属性
  // 仅对 type='set' 有效，相对于 Clip 开始时间的延迟。
  // 对于 type='then'，延迟通常为 0 (紧接上一个)，但也可以有间隔。
  delay?: number; 
}

export interface TimelineClip {
  id: string;
  resourceId: string; // 关联到资源库中的 ID
  name?: string;      // 显示名称，默认跟随资源
  startTime: number;  // 在时间轴上的开始时间 (ms)
  duration: number;   // 持续时间 (ms)，默认跟随资源的 durationMs
  trackId: string;    // 所属轨道 ID
  
  animations?: AnimationSegment[]; // 动画片段列表
}

export interface TimelineTrack {
  id: string;
  name: string;
  clips: TimelineClip[];
  visible: boolean;
  locked: boolean;
  expanded?: boolean; // 是否展开显示动画详情
}

export interface TimelineState {
  tracks: TimelineTrack[];
  currentTime: number; // 当前游标位置 (ms)
  isPlaying: boolean;
  duration: number;    // 总时长 (ms)
}
