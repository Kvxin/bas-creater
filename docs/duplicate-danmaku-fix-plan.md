# 重复弹幕修复方案（方案 A｜不改 bas.js）

本方案已按“只改预览/播放策略”的思路落地，不修改 `public/bas.js`。目标是避免 `refresh()` 与 `render()` 在播放切换时重复绘制同一弹幕。

---

## 1. 问题回顾（原因简述）

- 暂停预览时：`compile -> reset -> addRaw -> seek(refresh)` 会绘制一次 DOM。
- 点击播放时：`compile -> reset -> addRaw -> play` 又触发一次绘制。
- BasDanmaku 无去重逻辑，因此同一对象被插入两次。
- 负 `animation-delay` 来自“在中间时间点补画”的正常行为，不是根因。

---

## 2. 方案选择

**选择策略 A1：**  
**暂停时编译并刷新预览，播放时只恢复播放，不再重复编译/加载。**

这会让播放阶段只有 `render()` 一条绘制路径，避免重复 DOM。

---

## 3. 具体实现（已修改）

**文件：** `src/components/editor/PreviewPanel.vue`

### 3.1 增加“脏标记”

```ts
const needsRecompile = ref(false);
```

当资源或时间轴变化时，将其标记为需要重新编译。

### 3.2 提取统一编译函数

```ts
const compileAndLoad = (seekToCurrent = true) => {
  if (!basInitialized.value || !basService.isReady()) return false;
  const code = compileTimelineToBas(timelineStore.tracks, danmuStore.danmus);
  basService.reset();
  basService.addRaw(code);
  if (seekToCurrent) {
    basService.seek(timelineStore.currentTime / 1000, true);
  }
  needsRecompile.value = false;
  return true;
};
```

### 3.3 暂停状态下自动刷新预览

```ts
watch([() => danmuStore.danmus, () => timelineStore.tracks], () => {
  needsRecompile.value = true;
  if (!timelineStore.isPlaying && basInitialized.value && basService.isReady()) {
    compileAndLoad(true);
  }
}, { deep: true });
```

### 3.4 播放逻辑改为“有需要才编译”

```ts
if (!timelineStore.isPlaying) {
  if (needsRecompile.value) {
    const compiled = compileAndLoad(true);
    if (!compiled) return;
  }
  basService.play();
  timelineStore.isPlaying = true;
  startSyncLoop();
}
```

### 3.5 额外补偿逻辑

保证在 **暂停时** 或 **初始化完成** 后，如果有脏标记就刷新预览：

```ts
watch(() => timelineStore.isPlaying, (isPlayingNow) => {
  if (!isPlayingNow && needsRecompile.value) {
    compileAndLoad(true);
  }
});

watch(() => basInitialized.value, (ready) => {
  if (ready && !timelineStore.isPlaying && needsRecompile.value) {
    compileAndLoad(true);
  }
});
```

---

## 4. 行为变化说明

- 播放时不再重复编译/加载，避免 DOM 重复插入。
- 播放期间修改弹幕会被标记为 `needsRecompile`，**等暂停或下一次进入暂停状态时刷新预览**。
- 负 `animation-delay` 仍会在中途预览出现，这是正常行为。

---

## 5. 验证步骤

1) 新建弹幕 -> 拖入时间轴 -> 播放  
   - 预期：只渲染一次。
2) 拖动片段 -> 播放  
   - 预期：只渲染一次。
3) 播放中修改内容 -> 暂停  
   - 预期：暂停后预览更新，继续播放不重复。

---

## 6. 影响与注意事项

- 播放中改动不会立刻刷新预览，需暂停后更新。
- 如果一定要“播放前重新编译”，可升级为策略 A2（addRaw 支持 noRefresh）以防重复绘制。

---

# Duplicate Danmaku Fix Plan (Strategy A | No bas.js changes)

This solution is implemented using an app-layer strategy only. We avoid modifying `public/bas.js` and prevent duplicate DOM insertion by ensuring only one render path is active when playback starts.

---

## 1. Root Cause (Short)

- While paused, `compile -> reset -> addRaw -> seek(refresh)` already draws a DOM node.
- On play, `compile -> reset -> addRaw -> play` draws again.
- BasDanmaku has no de-duplication, so the same object is inserted twice.
- Negative `animation-delay` is expected when previewing mid-timeline.

---

## 2. Chosen Strategy

**Strategy A1:**  
**Compile and refresh only while paused. When playing, only resume playback.**

This ensures the DOM is drawn once by the render loop only.

---

## 3. Implementation (Applied)

**File:** `src/components/editor/PreviewPanel.vue`

### 3.1 Add a dirty flag

```ts
const needsRecompile = ref(false);
```

### 3.2 Centralize compilation

```ts
const compileAndLoad = (seekToCurrent = true) => {
  if (!basInitialized.value || !basService.isReady()) return false;
  const code = compileTimelineToBas(timelineStore.tracks, danmuStore.danmus);
  basService.reset();
  basService.addRaw(code);
  if (seekToCurrent) {
    basService.seek(timelineStore.currentTime / 1000, true);
  }
  needsRecompile.value = false;
  return true;
};
```

### 3.3 Auto refresh only when paused

```ts
watch([() => danmuStore.danmus, () => timelineStore.tracks], () => {
  needsRecompile.value = true;
  if (!timelineStore.isPlaying && basInitialized.value && basService.isReady()) {
    compileAndLoad(true);
  }
}, { deep: true });
```

### 3.4 Play only resumes, no extra compile

```ts
if (!timelineStore.isPlaying) {
  if (needsRecompile.value) {
    const compiled = compileAndLoad(true);
    if (!compiled) return;
  }
  basService.play();
  timelineStore.isPlaying = true;
  startSyncLoop();
}
```

### 3.5 Safe refresh when pausing or after init

```ts
watch(() => timelineStore.isPlaying, (isPlayingNow) => {
  if (!isPlayingNow && needsRecompile.value) {
    compileAndLoad(true);
  }
});

watch(() => basInitialized.value, (ready) => {
  if (ready && !timelineStore.isPlaying && needsRecompile.value) {
    compileAndLoad(true);
  }
});
```

---

## 4. Behavior Changes

- Playback no longer re-adds BAS code; only the render loop draws once.
- Changes made during playback are deferred until pause.
- Negative `animation-delay` in preview remains expected.

---

## 5. Verification Steps

1) New danmaku -> drag -> play  
   - Expect: only one DOM node.
2) Drag existing clip -> play  
   - Expect: only one DOM node.
3) Edit while playing -> pause  
   - Expect: preview updates on pause, no duplication on resume.

---

## 6. Notes

- If you must recompile before every play, switch to Strategy A2 (addRaw with `noRefresh`) to avoid duplicate insertion.

