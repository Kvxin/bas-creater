# BasDanmaku 源码解析（src/assets/bas.js）

> 版本：打包后的 UMD 库，面向浏览器环境

## 1. 整体概览

### 1.1 功能定位与应用场景
- BasDanmaku（BAS 弹幕/特效）渲染器：接收 BAS DSL 文本，解析为对象定义与时间轴设置，在视频播放器上以 DOM/CSS 动画方式渲染文本（text）、按钮（button）、路径（path）等，并支持交互（点击跳转/seek）。
- 典型场景：B 站视频上的 BAS 特效弹幕（引导按钮、形状动画、字幕特效等）。

### 1.2 核心设计思路
- UMD 导出：对接浏览器/AMD/CommonJS，多端可用。
- 解析与渲染分离：
  - 解析：自带词法/语法分析器（表驱动 DFA/LR），可在 Web Worker 并行解析；主线程提供降级解析。
  - 渲染：主线程 DOM + CSS 动画 + rAF 时钟；按 Set（Unit/Serial/Parallel）组织过渡。
- 安全与兼容：统一 HTML 转义（防 XSS），浏览器嗅探选择 Worker/降级，visibilitychange 事件做时间同步。

---

## 2. 模块与职责

### 2.1 默认导出类：BasDanmaku（class m）
- 负责生命周期与渲染：init、play/pause/toggle、seek、refresh、visible、clear、resize。
- 弹幕管理：add/remove；维护 dmList（全部）、cdmList（当前帧待绘制）；渲染循环 render -> renderDanmaku。
- 解析调度：parse —— Worker 可用则并行解析；不可用/禁用则本地同步解析。
- 时间同步：updateTime；可接入 options.timeSyncFunc（返回毫秒时间戳）。

### 2.2 单条弹幕渲染器（class n）
- 为一条弹幕实例化 DOM（.bas-danmaku-item），组合 CSS 动画（命名 bas-<dmid>-<name>-<idx>）。
- 设置文本/颜色/描边/阴影/变换等样式；绑定 target 交互（av/bangumi/seek）。
- 动画结束回调通知清理测试弹幕项。

### 2.3 解析子系统（词法/语法/AST/归一）
- 词法分析器（类 p/u）：
  - 表驱动 DFA，输出 token：id、number、time、十六进制、字符串分段、符号（+, -, %, (), [], {}, , ; 等）。
- 语法分析器（类 c）：
  - LR Action/Goto 表规约，构建语法结构（def/let/set/apply/then/clone、对象/数组、模板与参数等）。
- AST 助手（类 u/s + 值包装类 h/l）：
  - 构造 DefText/DefButton/DefPath 等对象定义；
  - 模板参数匹配与求值、变量/作用域、键值合并、数值/时间/十六进制/字符串处理；
  - on_Result 汇总 sets 与 defs。
- 归一化（函数 f/h）：
  - 将 AST 规范为 { defs, sets }；
  - 合并默认属性：
    - 通用：x, y, zIndex, scale, duration
    - text：content, alpha, color, anchorX/Y, fontSize, fontFamily, bold, textShadow, strokeWidth/Color, rotateX/Y/Z, parent
    - button：text, fontSize, textColor/Alpha, fillColor/Alpha, target
    - path：d, viewBox, borderColor/Alpha/Width, fillColor/Alpha
  - 全面 HTML 转义/去除危险字符（&<>"'/:/; 和 / 等），保证安全。

### 2.4 Worker 工具（模块 5）
- 以 BlobBuilder/Blob -> URL -> Worker 多级回退；失败则 Data URL；仍失败回主线程解析。

### 2.5 样式注入（模块 1-4）
- 注入 .bas-danmaku 及子元素样式（定位、指针事件、动画填充模式等）。

### 2.6 工具方法（对象 a）
- extend（浅拷贝）、string2DOM（依赖 jQuery）、colorFromInt/rgbaFormat、nowTime；
- htmlEncode：强转义 + 空格/换行处理；
- browser：嗅探 safari/MSE、trident、edge、chrome 版本。

---

## 3. 内部依赖关系与核心调用链

- BasDanmaku.add
  - 若 dm 数组：逐条递归 add -> （解析）-> pretreatDanmaku -> 入队 -> 可选刷新
  - 若单条：
    - parsed=false -> parse：
      - Worker：postMessage(text) -> onmessage 回 defs/sets
      - 降级：本地 f(text) -> c.parse -> 归一
    - 成功后 -> pretreatDanmaku：
      - 构建 def2set：按对象名聚合动画段（Unit/Serial/Parallel），命名 bas-<dmid>-<name>-<idx>
      - 计算 setsIntervals：属性级时间区间冲突检测，跨组重叠时警告并剔除冲突组
      - 计算弹幕 duration
- BasDanmaku.render（rAF 循环）
  - updateTime（timeSyncFunc 漂移校正）
  - refreshCdmList（按时间窗筛选）
  - drawDanmaku：
    - 多条：forEach -> drawDanmaku(单条)
    - 单条：new 渲染器 n -> 生成 DOM/动画；按 blockJudge 控制 visibility；插入 wrap
- 解析子系统流水线
  - 词法 p/u -> 语法 c + AST 助手 u/s -> 值包装 h/l -> 归一 f/h -> { defs, sets }

---

## 4. 对外 API 一览

### 4.1 构造
``` js
  new BasDanmaku(options?: {
  container?: HTMLElement;      // 默认 document.getElementById('player')
  easing?: string;              // 默认 'linear'
  visible?: boolean;            // 默认 true
  fontFamily?: string;          // 全局字体（文本元素）
  timeSyncFunc?: () => number;  // 返回毫秒时间戳
}, player?: any)
```
### 4.2 实例方法
- `init(): void`
- `add(params): void`
  - 单条：`{ dm, parsed?, test?, noRefresh?, success?(dm), error?(msg) }`
  - 批量：`{ dm: dm[], parsed?, test?, noRefresh?, success?, error? }`
- `remove(dmid: string|number): void`
- `play(): void`
- `pause(): void`
- `toggle(): void`
- `seek(timeSec: number, refresh = true): void`
- `refresh(): void`
- `visible(show: boolean): void`
- `clear(): void`
- `resize(width: number, height: number): void`

### 4.3 事件/回调
- add: success/error
- 渲染器 n: `animationEndCallback`

### 4.4 依赖环境
- 浏览器 DOM、requestAnimationFrame、Web Worker（可选）
- jQuery（用于 `$(html)[0]` 与 `$.extend`）

---

## 5. 关键实现技巧
- 表驱动解析：DFA/LR 表（transTable/finalTable + action/goto），运行期分支少，可在 Worker 高并发解析。
- Worker 策略：多级回退（BlobBuilder/Blob/DataURL），并结合浏览器嗅探禁用低兼容环境。
- 安全转义：统一 htmlEncode，先去除危险字符再实体化，空格与换行分别转为 `&nbsp;` 与 `<br>`。
- 动画组织：def2set 命名片段 + setsIntervals 冲突检测，保证同属性任时刻唯一来源，避免样式竞态。
- 时间同步：支持外部 timeSyncFunc；visibilitychange 恢复时触发一次 seek 同步。

---

## 6. 潜在优化点（性能/维护/安全）
- 依赖精简：用原生 API 替代 jQuery（DOM 解析、深拷贝）。
- Worker 构建：将内嵌 Worker 代码拆分独立文件/模块，便于缓存与调试；或使用更紧凑的 parser 实现。
- 内存/性能：减少深拷贝与重复转义；批量 DOM 插入使用 DocumentFragment；必要时虚拟化大规模弹幕渲染。
- 安全策略：htmlEncode 可考虑“仅转义不删除”或提供配置开关，减少语义改变风险。
- 类型定义：补充 TypeScript 声明，明确 dm/defs/sets/options 类型约束。
- 渲染 API：考虑 Web Animations API 或 GPU 友好属性（will-change）。

---

## 7. 依赖调用关系（文本化）
- BasDanmaku
  - init → render(rAF) → renderDanmaku → drawDanmaku
  - add → parse(Worker/降级) → pretreatDanmaku → dmList 入队 → refresh（可选）
  - play/pause/toggle/seek/refresh/visible/clear/resize
- 解析
  - Lexer(p/u) → Parser(c) + AST Helper(u/s) + Value(h/l) → 归一(f/h) → {defs, sets}
- 渲染
  - drawDanmaku(单条) → new 渲染器 n → DOM + CSS 动画 + 交互

---

## 8. API 表格

| API 名称 | 参数 | 返回值 | 功能说明 |
|----------|------|--------|----------|
| new BasDanmaku | options?: {container?, easing?, visible?, fontFamily?, timeSyncFunc?}, player? | 实例 | 创建弹幕渲染器，配置容器/缓动/可见性/字体/时间同步 |
| init | 无 | void | 初始化容器与渲染循环（懒触发） |
| add | { dm, parsed?, test?, noRefresh?, success?, error? } 或批量 | void | 添加弹幕；未解析时传 dm.text（BAS 文本），解析为 defs/sets 后入队 |
| remove | dmid | void | 移除指定弹幕并刷新 |
| play | 无 | void | 开始/恢复播放 |
| pause | 无 | void | 暂停播放并保留时间进度 |
| toggle | 无 | void | 切换播放/暂停 |
| seek | timeSec, refresh? | void | 跳转至指定秒；可选是否立即补画 |
| refresh | 无 | void | 以当前时间补画仍在播放窗口内的弹幕 |
| visible | show | void | 显隐弹幕层；显时 refresh+render，隐时 clear |
| clear | 无 | void | 清空已绘制 DOM（不清空队列） |
| resize | width, height | void | 设置逻辑分辨率并自适应容器比例 |

> 解析内部 API（parse/pretreatDanmaku/drawDanmaku 等）为库内部使用，通常不直接对外暴露。

