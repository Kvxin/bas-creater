import { DEFAULT_WAVEFORM_BUCKET_SIZE } from "./constants";

// ============================================================
// 类型定义
// ============================================================

export interface SampleBucket {
  bucketStart: number;
  bucketEnd: number;
}

export interface SourceWaveformSummary {
  sourceKey: string;
  sampleRate: number;
  totalSamples: number;
  bucketSize: number;
  amplitudes: Float32Array;
}

// ============================================================
// 波形摘要构建
// ============================================================

/** 从 AudioBuffer 的所有通道计算峰值振幅桶 */
function computePeakBuckets(buffer: AudioBuffer, buckets: SampleBucket[]): Float32Array {
  const channels = buffer.numberOfChannels;
  const channelData: Float32Array[] = Array.from({ length: channels }, (_, c) =>
    buffer.getChannelData(c),
  );

  const result = new Float32Array(buckets.length);
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    if (!bucket) continue;
    const { bucketStart, bucketEnd } = bucket;
    let peak = 0;
    for (let c = 0; c < channels; c++) {
      const data = channelData[c];
      for (let j = bucketStart; j < bucketEnd; j++) {
        const abs = Math.abs(data?.[j] ?? 0);
        if (abs > peak) peak = abs;
      }
    }
    result[i] = peak;
  }
  return result;
}

/**
 * 为音频文件构建波形摘要。
 * 将 AudioBuffer 划分为固定大小的桶，每个桶记录峰值振幅。
 */
export function buildSourceWaveformSummary(
  sourceKey: string,
  buffer: AudioBuffer,
  bucketSize = DEFAULT_WAVEFORM_BUCKET_SIZE,
): SourceWaveformSummary {
  const safeBucketSize = Math.max(1, Math.floor(bucketSize));
  const bucketCount = Math.max(1, Math.ceil(buffer.length / safeBucketSize));
  const amplitudes = computePeakBuckets(
    buffer,
    Array.from({ length: bucketCount }, (_, bucketIndex) => {
      const bucketStart = bucketIndex * safeBucketSize;
      const bucketEnd = Math.min(buffer.length, bucketStart + safeBucketSize);
      return { bucketStart, bucketEnd };
    }),
  );

  return {
    sourceKey,
    sampleRate: buffer.sampleRate,
    totalSamples: buffer.length,
    bucketSize: safeBucketSize,
    amplitudes,
  };
}

// ============================================================
// 可视区域采样桶构建
// ============================================================

/**
 * 根据可视区域参数构建采样桶列表。
 * 每个桶对应一个波形条形，确定需要从摘要中读取哪个范围的样本。
 */
export function buildWaveformSampleBuckets(params: {
  clipLeftPx: number;
  clipRightPx: number;
  barCount: number;
  pixelsPerSecond: number;
  clipDurationSec: number;
  sourceStartSec: number;
  sampleRate: number;
  maxSampleExclusive: number;
  barStepPx: number;
}): SampleBucket[] {
  const {
    clipLeftPx,
    clipRightPx,
    barCount,
    pixelsPerSecond,
    clipDurationSec,
    sourceStartSec,
    sampleRate,
    maxSampleExclusive,
    barStepPx,
  } = params;

  return Array.from({ length: barCount }, (_, index) => {
    const bucketLeftPx = clipLeftPx + index * barStepPx;
    const bucketRightPx = Math.min(clipRightPx, bucketLeftPx + barStepPx);
    const clipStartSec = Math.max(0, Math.min(clipDurationSec, bucketLeftPx / pixelsPerSecond));
    const clipEndSec = Math.max(clipStartSec, Math.min(clipDurationSec, bucketRightPx / pixelsPerSecond));
    const sourceBucketStartSec = sourceStartSec + clipStartSec;
    const sourceBucketEndSec = sourceStartSec + clipEndSec;

    return {
      bucketStart: Math.max(0, Math.floor(sourceBucketStartSec * sampleRate)),
      bucketEnd: Math.min(maxSampleExclusive, Math.max(0, Math.ceil(sourceBucketEndSec * sampleRate))),
    };
  });
}

/** 从波形摘要中采样指定桶的峰值振幅 */
export function sampleSourceWaveformSummary(
  summary: SourceWaveformSummary,
  buckets: SampleBucket[],
): number[] {
  return buckets.map(({ bucketStart, bucketEnd }) => {
    if (bucketEnd <= bucketStart) return 0;

    const startIndex = Math.max(0, Math.floor(bucketStart / summary.bucketSize));
    const endIndex = Math.min(
      summary.amplitudes.length,
      Math.max(startIndex + 1, Math.ceil(bucketEnd / summary.bucketSize)),
    );

    let maxAmplitude = 0;
    for (let i = startIndex; i < endIndex; i++) {
      const amplitude = summary.amplitudes[i] ?? 0;
      if (amplitude > maxAmplitude) maxAmplitude = amplitude;
    }
    return maxAmplitude;
  });
}

// ============================================================
// 波形缓存（内存中）
// ============================================================

interface CacheEntry {
  summary: SourceWaveformSummary;
  /** 防止同一 URL 的并发加载 */
  promise: Promise<SourceWaveformSummary> | null;
}

class WaveformCache {
  private cache = new Map<string, CacheEntry>();

  /** 解码音频文件并构建波形摘要（带缓存） */
  async getSourceSummary(audioUrl: string): Promise<SourceWaveformSummary> {
    const existing = this.cache.get(audioUrl);
    if (existing?.summary) return existing.summary;

    // 如果已有正在进行的加载，等待它完成
    if (existing?.promise) return existing.promise;

    const promise = this.loadAndBuild(audioUrl);
    this.cache.set(audioUrl, { summary: null as unknown as SourceWaveformSummary, promise });

    try {
      const summary = await promise;
      this.cache.set(audioUrl, { summary, promise: null });
      return summary;
    } catch (err) {
      // 加载失败，移除缓存条目，下次可重试
      this.cache.delete(audioUrl);
      throw err;
    }
  }

  private async loadAndBuild(audioUrl: string): Promise<SourceWaveformSummary> {
    const audioContext = new AudioContext();
    try {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      return buildSourceWaveformSummary(audioUrl, audioBuffer);
    } finally {
      audioContext.close();
    }
  }

  /** 清除指定 URL 的缓存 */
  invalidate(audioUrl: string): void {
    this.cache.delete(audioUrl);
  }

  /** 清除所有缓存 */
  clear(): void {
    this.cache.clear();
  }
}

/** 全局波形缓存单例 */
export const waveformCache = new WaveformCache();
