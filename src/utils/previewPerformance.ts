export type PreviewMeasurement = {
  requestedAt: number;
  compileMs?: number;
  parseMs?: number;
  loadMs?: number;
  nextPaintMs?: number;
  outcome?: "loaded" | "unchanged" | "error" | "superseded";
};

declare global {
  interface Window {
    basPreviewPerformance?: {
      samples: () => PreviewMeasurement[];
      reset: () => void;
    };
  }
}

// 仅在开发环境保留有限样本；布局耗时应通过浏览器 Performance 面板单独观察。
const samples: PreviewMeasurement[] = [];
const MAX_SAMPLES = 200;

if (import.meta.env.DEV && typeof window !== "undefined") {
  window.basPreviewPerformance = {
    samples: () => samples.map(sample => ({ ...sample })),
    reset: () => { samples.length = 0; }
  };
}

export const startPreviewMeasurement = (requestedAt: number): PreviewMeasurement | undefined => {
  if (!import.meta.env.DEV) return undefined;
  const sample: PreviewMeasurement = { requestedAt };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();
  return sample;
};

export const measurePreviewPaint = (sample: PreviewMeasurement | undefined) => {
  if (!sample) return;
  // 第二帧回调发生在浏览器有机会绘制上一帧之后，并非实际绘制完成的精确时间。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sample.nextPaintMs = performance.now() - sample.requestedAt;
  }));
};
