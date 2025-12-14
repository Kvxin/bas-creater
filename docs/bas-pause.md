## BAS 播放/暂停时间模型与修复方案说明

### 目标
- 解释 bas.js 源码中时间推进、播放与暂停的真实机制
- 复现你遇到的“暂停后等待数秒再播放，弹幕瞬间消失”的原因
- 提供在不修改 bas.js 前提下的可行修复方案（虚拟时钟），并贴出关键实现与每个变量的含义

---

## 一、源码中的时间推进与播放/暂停

### 1.1 时间推进（updateTime）
- 基本公式：cTime = time0 + now - startTime（单位毫秒）
- 每帧前先保存 pTime，上帧时间用于筛选时间窗
- 如果提供了 options.timeSyncFunc（返回毫秒时间戳）：以它为权威时钟，偏差>1000ms 或 NaN 时直接重置并 refresh

关键片段（简化，<10 行）：
````javascript path=src/assets/bas.js mode=EXCERPT
this.pTime = this.cTime;
var e = new Date().getTime();
this.cTime = this.time0 + e - this.startTime;
if ("function" == typeof this.options.timeSyncFunc) {
  var t = this.options.timeSyncFunc();
  if (Math.abs(t - this.cTime) > 1e3 || isNaN(this.cTime)) {
    this.cTime = t; this.pTime = t;
    this.time0 = t; this.startTime = e; this.refresh();
  }
}
````

- 变量说明
  - cTime: 当前帧的“当前时间”（ms）
  - pTime: 上一帧的“当前时间”（ms），用于判断哪些弹幕进入显示窗
  - now(e): 系统当前时间（ms）
  - time0: 时间偏移量（ms），通过 play/pause/seek 维护
  - startTime: 最近一次开始计时的基准时间（ms）
  - timeSyncFunc(): 外部时钟（例如播放器毫秒时间）

### 1.2 播放/暂停

播放（play）：
````javascript path=src/assets/bas.js mode=EXCERPT
play() {
  this.time0 = this.pauseTime;
  this.startTime = new Date().getTime();
  this.pauseTime = 0; this.paused = !1;
  this.wrap && this.wrap.classList.remove("bas-danmaku-pause");
  this.dmList.length && (this.inited || this.init(), this.render());
}
````

暂停（pause）：
````javascript path=src/assets/bas.js mode=EXCERPT
pause() {
  this.paused = !0; this.inited || this.init();
  this.wrap.classList.add("bas-danmaku-pause");
  var e = new Date().getTime();
  this.pauseTime = this.time0 + e - this.startTime;
}
````

- 变量说明
  - paused: 是否处于暂停状态（bool）
  - pauseTime: 暂停时的“累计时间”（ms），用于恢复时设置 time0
  - wrap: 最外层容器，暂停时添加 bas-danmaku-pause 类

CSS 暂停（注入的样式）：
````javascript path=src/assets/bas.js mode=EXCERPT
.bas-danmaku.bas-danmaku-pause .bas-danmaku-item {
  -webkit-animation-play-state: paused; animation-play-state: paused
}
````

- 含义：DOM 的 CSS 动画会真正暂停，恢复播放时继续

### 1.3 为什么暂停后恢复会“瞬间消失”
- 如果提供了 timeSyncFunc（或默认用系统时间差），暂停期间“时间仍在流逝”
- 恢复时 cTime 会直接跳到“当前真实时刻”，4 秒的默认时长已过，自然立即消失

---

## 二、修复方案（不改 bas.js 源码）：虚拟时钟 VirtualClock

核心思路
- 用一个“可暂停的虚拟时钟”作为 timeSyncFunc
- 暂停时钟不再走秒，恢复继续走，seek 时直接设置虚拟时钟
- 保证 bas.js 每帧读到的 timeSyncFunc() 是“暂停冻结”的时间，从而暂停后恢复从原处继续

### 2.1 虚拟时钟实现

虚拟时钟（核心 <10 行）：
````ts path=src/utils/bas.ts mode=EXCERPT
class VirtualClock {
  private baseMs = 0, startPerf = 0, running = false;
  nowMs() { return this.running ? this.baseMs + (performance.now() - this.startPerf) : this.baseMs; }
  play() { if (!this.running) { this.startPerf = performance.now(); this.running = true; } }
  pause() { if (this.running) { this.baseMs = this.nowMs(); this.running = false; } }
  isRunning() { return this.running; }
  seek(ms: number) { this.baseMs = Math.max(0, ms); this.startPerf = performance.now(); }
  set(ms: number) { this.baseMs = Math.max(0, ms); }
}
````

- 变量说明
  - baseMs: 累计到上次暂停/seek 的时间（ms）
  - startPerf: 最近一次开始走时的 performance.now()（ms）
  - running: 当前是否在走时钟
  - nowMs(): 当前虚拟时间（ms），暂停时恒定
  - play()/pause(): 控制时钟走/停
  - seek(ms)/set(ms): 跳转或直接设置虚拟时间

### 2.2 与 BasDanmaku 集成

初始化时注入 timeSyncFunc（关键 <10 行）：
````ts path=src/utils/bas.ts mode=EXCERPT
this.bas = new BasDanmaku({
  container: opts.container,
  easing: opts.easing ?? 'linear',
  visible: opts.visible ?? true,
  fontFamily: opts.fontFamily ?? '',
  timeSyncFunc: () => this.clock.nowMs(), // 核心：使用虚拟时钟
});
````

播放/暂停/seek 同步到虚拟时钟（各 <10 行）：
````ts path=src/utils/bas.ts mode=EXCERPT
play() { this.clock.play(); this.bas?.play?.(); }
pause() { this.bas?.pause?.(); this.clock.pause(); }
seek(sec: number, refresh = true) {
  const ms = (sec || 0) * 1000;
  this.clock.seek(ms); this.bas?.seek?.(sec, refresh);
}
````

添加 BAS 文本（stime=-1 让 bas 取 timeSyncFunc 作为起点）：
````ts path=src/utils/bas.ts mode=EXCERPT
addRaw(text: string, options?: {...}) {
  this.bas?.add?.({ dm: { text, stime: -1 }, parsed: false, ...options });
}
````

- 变量说明
  - bas: BasDanmaku 实例（来自 window.BasDanmaku）
  - clock: VirtualClock 实例，提供“暂停可冻结”的时间
  - timeSyncFunc: bas.js 每帧读取的“当前时间”（ms），改为读取 clock.nowMs()

### 2.3 方案效果
- 暂停后等待很久：虚拟时钟不前进，恢复时 bas.js 读到的时间仍在原处，弹幕继续播放，不会瞬间消失
- seek：虚拟时钟与 bas.seek 同步调整，逻辑一致
- 不改 bas.js，完全在上层封装中完成

---

## 三、示例使用（Test.vue）

初始化与交互（摘录 <10 行）：
````ts path=src/views/Test.vue mode=EXCERPT
onMounted(() => {
  if (containerRef.value) {
    bas.init({ container: containerRef.value, easing: 'linear',
      visible: true, timeSyncFunc: () => Date.now() })
  }
});
````

建议将 init 的 timeSyncFunc 留空（由 bas.init 内部的 VirtualClock 驱动），Test.vue 中无需再传自定义 timeSyncFunc。例如：
- 推荐：
  - bas.init({ container: containerRef.value, easing: 'linear', visible: true })
- 播放/暂停：
  - play() { bas.play() }
  - pause() { bas.pause() }

添加 DSL 文本（摘录 <10 行）：
````ts path=src/views/Test.vue mode=EXCERPT
function addFromDSL() {
  bas.addFromDSL(dslText.value)
}
````

说明
- 由于 bas.init 内部已将 timeSyncFunc 指向虚拟时钟，暂停后虚拟时间冻结，因此恢复时不会“超时消失”。

---

## 四、变量对照表

- bas.js（内部变量）
  - time0: “偏移时间”，由 play/pause/seek 维护，构成 cTime 公式的一部分
  - startTime: 开始计时的系统时间（ms），cTime = time0 + now - startTime
  - cTime: 当前帧时间（ms）
  - pTime: 上一帧时间（ms）
  - pauseTime: 暂停时的累计时间（ms）
  - paused: 是否暂停（bool）
  - timeSyncFunc: 外部时钟函数（ms），若提供则优先使用并在漂移时重置内部时间
  - wrap: DOM 容器，暂停时加类名 bas-danmaku-pause（CSS 动画暂停）

- VirtualClock（新增）
  - baseMs: 累计时间（ms），暂停/seek 时更新
  - startPerf: 最近一次开始走时的 performance.now()
  - running: 是否走时
  - nowMs(): 当前虚拟时间（ms），暂停时恒定
  - play()/pause()/seek()/set(): 控制虚拟时钟

- BasService（封装）
  - bas: BasDanmaku 实例
  - clock: VirtualClock 实例
  - init(): 挂载 timeSyncFunc 为 clock.nowMs()
  - play()/pause()/seek(): 同时更新 bas 与 clock，保证一致

---

## 五、注意事项与建议
- 若你的播放器也提供时间，请勿再把它直接作为 timeSyncFunc 传入 bas.init；该方案中 bas 的 timeSyncFunc 由虚拟时钟接管，否则“外部时钟继续流逝”的问题会重现
- toggle 语义在 bas.js 中并未公开 paused 状态，建议在 UI 层用显式 Play/Pause 按钮分别调用 bas.play()/bas.pause()
- DSL 默认持续 4 秒（无 duration 时），可在 DSL 或 sets 中显式配置 duration 以自定义

---

如需我把 Test.vue 的 init 调整为不传 timeSyncFunc、或需要添加一段 DSL 示例（含 duration 明确配置）来验证，请告诉我。
