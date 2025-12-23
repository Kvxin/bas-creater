/* Bas 工具库：封装 BasDanmaku 使用（依赖 index.html 全局引入的 BasDanmaku 与 jQuery） */

export type BasInitOptions = {
  container: HTMLElement;
  easing?: string;
  visible?: boolean;
  fontFamily?: string;
  timeSyncFunc?: () => number; // 返回毫秒
};

export type BasDanmakuObj = {
  dmid?: string;
  stime?: number; // 开始时间（秒）
  text?: string; // BAS DSL 源文本
  defs?: any[];
  sets?: any[];
  duration?: number;
};

export type BasParseResult = { defs: any[]; sets: any[] };

class VirtualClock {
  private baseMs = 0;
  private startPerf = 0;
  private running = false;

  nowMs() {
    return this.running
      ? this.baseMs + (performance.now() - this.startPerf)
      : this.baseMs;
  }
  play() {
    if (!this.running) {
      this.startPerf = performance.now();
      this.running = true;
    }
  }
  pause() {
    if (this.running) {
      this.baseMs = this.nowMs();
      this.running = false;
    }
  }
  isRunning() {
    return this.running;
  }
  seek(ms: number) {
    this.baseMs = Math.max(0, ms);
    this.startPerf = performance.now();
  }
  set(ms: number) {
    this.baseMs = Math.max(0, ms);
  }
}

class BasService {
  private bas: any | null = null;
  private clock = new VirtualClock();
  private lastOpts: BasInitOptions | null = null;

  init(opts: BasInitOptions) {
    this.lastOpts = opts; // Save options for reset
    const BasDanmaku = (window as any).BasDanmaku;
    if (!BasDanmaku)
      throw new Error(
        "BasDanmaku not found. Ensure bas.js is included in index.html"
      );

    this.clock.set(0);
    this.clock.play();

    this.bas = new BasDanmaku({
      container: opts.container,
      easing: opts.easing ?? "linear",
      visible: opts.visible ?? true,
      fontFamily: opts.fontFamily ?? "",
      timeSyncFunc: () => this.clock.nowMs(),
    });
    this.bas.init?.();
  }

  // 完全重置实例（用于编辑器重新编译运行）
  reset() {
    if (!this.lastOpts) return;
    this.pause();
    
    // 尝试销毁旧实例 (如果有 destroy 方法)
    try {
        if (this.bas && typeof this.bas.destroy === 'function') {
            this.bas.destroy();
        }
    } catch (e) {
        console.warn("Destroy BAS failed", e);
    }
    this.bas = null;
    
    // 清空容器内容
    if (this.lastOpts.container) {
      this.lastOpts.container.innerHTML = "";
    }

    // 重新初始化
    this.init(this.lastOpts);
  }

  isReady() {
    return !!this.bas;
  }
  play() {
    this.clock.play();
    this.bas?.play?.();
  }
  pause() {
    this.bas?.pause?.();
    this.clock.pause();
  }
  toggle() {
    if (!this.bas) return;
    // 简单根据内部 flag 判断：调用 pause/play 前后同步虚拟时钟
    // 由于 bas 没有公开 paused 状态，这里采用“先暂停再恢复”的策略：
    // 调用 pause 后立刻调用 play 会破坏暂停，这里用 try 方式：
    // 推荐直接在 UI 用显式按钮分别调用 play/pause。
    this.pause();
    this.play();
  }
  clear() {
    this.bas?.clear?.();
  }
  visible(show: boolean) {
    this.bas?.visible?.(show);
  }
  resize(width: number, height: number) {
    this.bas?.resize?.(width, height);
  }
  seek(sec: number, refresh = true) {
    const ms = (sec || 0) * 1000;
    this.clock.seek(ms);
    this.bas?.seek?.(sec, refresh);
  }
  
  getCurrentTime() {
    return this.clock.nowMs();
  }

  remove(dmid: string | number) {
    this.bas?.remove?.(dmid);
  }

  addParsed(
    dm: BasDanmakuObj,
    options?: {
      test?: boolean;
      success?: (dm: any) => void;
      error?: (msg?: string) => void;
    }
  ) {
    this.bas?.add?.({
      dm,
      parsed: true,
      test: options?.test,
      success: options?.success,
      error: options?.error,
    });
  }

  addRaw(
    text: string,
    options?: {
      test?: boolean;
      success?: (dm: any) => void;
      error?: (msg?: string) => void;
    }
  ) {
    this.bas?.add?.({
      dm: { text, stime: 0 },
      parsed: false,
      test: options?.test,
      success: options?.success,
      error: options?.error,
    });
  }

  addFromDSL(
    dslText: string,
    options?: {
      test?: boolean;
      success?: (dm: any) => void;
      error?: (msg?: string) => void;
    }
  ) {
    this.addRaw(dslText, options);
  }
}

// 仅解析 DSL：返回 { defs, sets }
export function parseBasDSL(dslText: string): Promise<BasParseResult> {
  const BasDanmaku = (window as any).BasDanmaku;
  if (!BasDanmaku)
    return Promise.reject(
      new Error("BasDanmaku not found. Ensure bas.js is included in index.html")
    );

  // 创建一个轻量实例，仅用于解析（不需要 init/render）
  const basInst = new BasDanmaku({
    container: document.createElement("div"),
    easing: "linear",
    visible: false,
    fontFamily: "",
    timeSyncFunc: () => 0,
  });
  // 强制使用同步解析，避免 Worker 构建依赖
  (basInst as any).workerDisabled = true;

  return new Promise<BasParseResult>((resolve, reject) => {
    try {
      basInst.parse({
        danmaku: { text: dslText },
        success: (dm: any) => {
          resolve({ defs: dm.defs, sets: dm.sets });
        },
        error: (msg?: string) => {
          reject(new Error(msg || "BAS parse error"));
        },
      });
    } catch (err: any) {
      reject(new Error(err?.message || "BAS parse error"));
    }
  });
}

const basService = new BasService();
export default basService;
