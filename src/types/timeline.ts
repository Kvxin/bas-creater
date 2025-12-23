import type { AnyDanmu } from './danmu';

export interface TimelineClip {
  id: string;
  resourceId: string; // 关联到资源库中的 ID
  name?: string;      // 显示名称，默认跟随资源
  startTime: number;  // 在时间轴上的开始时间 (ms)
  duration: number;   // 持续时间 (ms)，默认跟随资源的 durationMs
  trackId: string;    // 所属轨道 ID
  
  // 未来扩展：关键帧、覆写属性
  // properties?: Partial<AnyDanmu>; 
}

export interface TimelineTrack {
  id: string;
  name: string;
  clips: TimelineClip[];
  visible: boolean;
  locked: boolean;
}

export interface TimelineState {
  tracks: TimelineTrack[];
  currentTime: number; // 当前游标位置 (ms)
  isPlaying: boolean;
  duration: number;    // 总时长 (ms)
}
