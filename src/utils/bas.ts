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
}

class BasService {
  private bas: any | null = null;
  private clock = new VirtualClock();
  private lastOpts: BasInitOptions | null = null;
  private readonly seekEpsilonSec = 0.000001;

  private refreshPausedFrame() {
    if (!this.bas?.paused) return;
    this.seek(this.clock.nowMs() / 1000, true);
  }

  init(opts: BasInitOptions) {
    this.lastOpts = opts; // Save options for reset
    const BasDanmaku = (window as any).BasDanmaku;
    if (!BasDanmaku)
      throw new Error(
        "BasDanmaku not found. Ensure bas.js is included in index.html"
      );

    this.clock.pause();
    this.clock.seek(0);

    this.bas = new BasDanmaku({
      container: opts.container,
      easing: opts.easing ?? "linear",
      visible: opts.visible ?? true,
      fontFamily: opts.fontFamily ?? "",
      timeSyncFunc: () => this.clock.nowMs(),
    });
    this.bas.workerDisabled = true;
    this.bas.init?.();
    this.bas.pause();
  }

  // 完全重置实例（用于编辑器重新编译运行）
  // 不再使用destroy方法，在bas.js(大概1035行)中destroy是一个空的方法，调用这个方法没有效果
  reset() {
    if (!this.lastOpts) return;
    this.pause();

    if (this.bas) {
      try {
        this.bas.clear?.();
        if (Array.isArray(this.bas.dmList)) this.bas.dmList = [];
        if (Array.isArray(this.bas.testDanmakus)) this.bas.testDanmakus = [];
      } catch (e) {
        console.warn("Clear BAS failed", e);
      }

      this.clock.seek(0);
      return;
    }

    // 重新初始化（首次或异常状态）
    this.init(this.lastOpts);
  }

  isReady() {
    return !!this.bas;
  }
  play() {
    if (this.clock.isRunning()) return;
    const timeSec = this.clock.nowMs() / 1000;
    this.bas?.play?.();
    this.bas?.seek?.(timeSec + this.seekEpsilonSec, true);
    this.clock.play();
  }
  pause() {
    if (!this.clock.isRunning()) return;
    this.clock.pause();
    this.bas?.pause?.();
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
    const safeSec = Number.isFinite(sec) ? Math.max(0, sec) : 0;
    this.clock.seek(safeSec * 1000);
    this.bas?.seek?.(safeSec + (refresh ? this.seekEpsilonSec : 0), refresh);
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
      success: (addedDm: any) => {
        this.refreshPausedFrame();
        options?.success?.(addedDm);
      },
      error: options?.error,
    });
  }

  addParsedAsync(dm: BasDanmakuObj): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.bas) {
        reject(new Error("BAS engine is not initialized"));
        return;
      }
      try {
        this.addParsed(dm, {
          success: () => resolve(),
          error: message => reject(new Error(message || "BAS engine failed to add parsed data"))
        });
      } catch (error) {
        reject(error);
      }
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
      success: (addedDm: any) => {
        this.refreshPausedFrame();
        options?.success?.(addedDm);
      },
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

// 只解析 BAS，预览和导入共用仓库播放器的语法规则。
export async function parseBasDSL(dslText: string): Promise<BasParseResult> {
  const BasDanmaku = (window as any).BasDanmaku;
  if (!BasDanmaku) throw new Error("BasDanmaku not found. Ensure bas.js is included in index.html");
  const parser = new BasDanmaku({
    container: document.createElement("div"),
    easing: "linear",
    visible: false,
    fontFamily: "",
    timeSyncFunc: () => 0
  });
  parser.workerDisabled = true;
  return new Promise((resolve, reject) => {
    parser.parse({
      danmaku: { text: dslText },
      success: ({ defs, sets }: BasParseResult) => resolve({ defs, sets }),
      error: (message?: string) => reject(new Error(message || "BAS parse error"))
    });
  });
}

const basService = new BasService();
export default basService;
