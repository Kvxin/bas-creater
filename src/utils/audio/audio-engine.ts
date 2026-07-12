import { dBToLinear } from "./audio-math";

// ============================================================
// 类型定义
// ============================================================

export interface ScheduledClip {
  clipId: string;
  buffer: AudioBuffer;
  startTime: number; // 相对于 AudioContext.currentTime 的调度时间（秒）
  offset: number; // 在音频文件中的偏移（秒）
  duration: number; // 播放时长（秒）
  gain: number; // 线性增益
}

export interface GainAutomationPoint {
  time: number; // 相对于片段开始的时间（秒）
  gain: number; // 线性增益
}

// ============================================================
// AudioEngine — Web Audio API 播放引擎
// ============================================================

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeSourceNodes: Map<
    string,
    { source: AudioBufferSourceNode; gainNode: GainNode }
  > = new Map();
  private bufferCache = new Map<string, AudioBuffer>();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  // ---- 初始化 ----

  private getContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  private getMasterGain(): GainNode {
    this.getContext(); // ensure masterGain exists
    return this.masterGain!;
  }

  /** 确保 AudioContext 处于运行状态（需要在用户手势后调用） */
  async ensureResumed(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  }

  // ---- 音频加载 ----

  /** 加载音频文件为 AudioBuffer（带缓存） */
  async loadAudioBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;

    const ctx = this.getContext();
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    this.bufferCache.set(url, audioBuffer);
    return audioBuffer;
  }

  /** 从已解码的 ArrayBuffer 创建 AudioBuffer */
  async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.getContext();
    return ctx.decodeAudioData(arrayBuffer);
  }

  // ---- 片段调度 ----

  /**
   * 调度一个音频片段播放
   * @param clipId - 唯一标识
   * @param buffer - AudioBuffer
   * @param when - 相对于 AudioContext.currentTime 的开始时间（秒）
   * @param offset - 在音频文件中的偏移（秒）
   * @param duration - 播放时长（秒）
   * @param volumeDb - 音量（dB），会转换为线性增益
   * @param playbackRate - 播放速率（1.0 = 正常）
   */
  scheduleClip(
    clipId: string,
    buffer: AudioBuffer,
    when: number,
    offset: number,
    duration: number,
    volumeDb = 0,
    playbackRate = 1.0,
  ): void {
    const ctx = this.getContext();
    const masterGain = this.getMasterGain();

    // 停止已存在的同名片段
    this.stopClip(clipId);

    const gainNode = ctx.createGain();
    gainNode.gain.value = dBToLinear(volumeDb);
    gainNode.connect(masterGain);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(gainNode);

    source.start(when, offset, duration);
    source.onended = () => {
      // A replacement may already be registered for this clip. An old source
      // must not remove the handle used to stop the newer source.
      if (this.activeSourceNodes.get(clipId)?.source === source) {
        this.activeSourceNodes.delete(clipId);
      }
    };

    this.activeSourceNodes.set(clipId, { source, gainNode });
  }

  /**
   * 调度带增益自动化的音频片段
   * @param clipId - 唯一标识
   * @param buffer - AudioBuffer
   * @param when - 相对于 AudioContext.currentTime 的开始时间（秒）
   * @param offset - 在音频文件中的偏移（秒）
   * @param duration - 播放时长（秒）
   * @param gainPoints - 增益自动化点数组
   * @param playbackRate - 播放速率
   */
  scheduleClipWithAutomation(
    clipId: string,
    buffer: AudioBuffer,
    when: number,
    offset: number,
    duration: number,
    gainPoints: GainAutomationPoint[],
    playbackRate = 1.0,
  ): void {
    const ctx = this.getContext();
    const masterGain = this.getMasterGain();

    this.stopClip(clipId);

    const gainNode = ctx.createGain();
    gainNode.gain.value = gainPoints.length > 0 ? (gainPoints[0]?.gain ?? 1) : 1;
    gainNode.connect(masterGain);

    // 设置增益自动化
    for (const point of gainPoints) {
      const absoluteTime = when + point.time;
      if (absoluteTime >= ctx.currentTime) {
        gainNode.gain.linearRampToValueAtTime(point.gain, absoluteTime);
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(gainNode);

    source.start(when, offset, duration);
    source.onended = () => {
      if (this.activeSourceNodes.get(clipId)?.source === source) {
        this.activeSourceNodes.delete(clipId);
      }
    };

    this.activeSourceNodes.set(clipId, { source, gainNode });
  }

  // ---- 控制 ----

  /** 停止所有播放 */
  stopAll(): void {
    for (const [clipId] of this.activeSourceNodes) {
      this.stopClip(clipId);
    }
  }

  /** 停止特定片段 */
  stopClip(clipId: string): void {
    const entry = this.activeSourceNodes.get(clipId);
    if (entry) {
      try {
        entry.source.stop();
      } catch {
        // 可能已经停止
      }
      entry.source.disconnect();
      entry.gainNode.disconnect();
      this.activeSourceNodes.delete(clipId);
    }
  }

  /** 设置主音量（线性增益） */
  setMasterVolume(gain: number): void {
    const mg = this.masterGain;
    if (mg) {
      mg.gain.value = gain;
    }
  }

  /** 获取当前 AudioContext 时间 */
  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  /** 获取 AudioContext 状态 */
  getState(): AudioContextState {
    return this.audioContext?.state ?? "closed";
  }

  /** 清除缓冲区缓存 */
  clearBufferCache(): void {
    this.bufferCache.clear();
  }

  /** 移除指定 URL 的缓冲区缓存 */
  invalidateBuffer(url: string): void {
    this.bufferCache.delete(url);
  }

  /** 销毁引擎 */
  dispose(): void {
    this._isDisposed = true;
    this.stopAll();
    this.bufferCache.clear();
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.masterGain = null;
  }
}

// ============================================================
// 单例
// ============================================================

let instance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!instance || instance.isDisposed) {
    instance = new AudioEngine();
  }
  return instance;
}
