# Duplicate Danmaku After Drag + Play (Root Cause + Solutions)

This document summarizes why a single danmaku is rendered twice after dragging a clip and then clicking play, and provides two detailed fix strategies:
1) App-layer only (no bas.js changes)
2) Patch bas.js directly

---

## 1. Symptom Summary

- Case A (normal): New danmaku -> edit -> drag to timeline -> play
  - DOM shows one `.bas-danmaku-item` for the clip.
- Case B (problem): Drag an existing clip on the timeline -> play
  - DOM shows two `.bas-danmaku-item` nodes with the same object name.
  - One node has a negative `animation-delay` (e.g. `-1.246s`), the other starts at `0s`.

These two nodes are the same danmaku rendered twice, not two different clips.

---

## 2. Files Involved (Key References)

- `src/components/editor/PreviewPanel.vue`
  - `togglePlay()` re-compiles, resets, adds code, then plays.
  - `watch([danmuStore.danmus, timelineStore.tracks])` refreshes preview when paused.
- `src/utils/bas.ts`
  - `reset()` clears DOM + dmList but does not reset BasDanmaku internal time.
  - `addRaw()` currently always triggers BasDanmaku.refresh() via `add()`.
- `src/utils/compiler.ts`
  - `compileClipToBas()` sets `duration = start + duration` and `alpha = 0` for delayed start.
- `public/bas.js`
  - `add()` always calls `refresh()` unless `noRefresh` is set.
  - `refresh()` redraws danmaku based on current time window.
  - `itemsTemplate()` sets `animation-delay = delay - startTime`.

---

## 3. Timeline of Events (Why It Duplicates)

### 3.1 BasDanmaku Rendering Behavior (Important)

In `public/bas.js`:

- `add()` -> `pretreatDanmaku()` -> `dmList.push()` -> `refresh()` (unless `noRefresh`).
- `refresh()` draws all danmaku currently "alive" at time `t = pTime / 1000`.
- `render()` loop later calls `refreshCdmList()` and `drawDanmaku()` again.
- `itemsTemplate()` uses `animation-delay = delay - startTime`.
  - If `startTime` is already > `delay`, `animation-delay` becomes negative.
  - This is how BAS fast-forwards the animation to the middle state.

### 3.2 App Flow (Simplified)

When paused and you drag a clip:

```
watch() -> compile -> reset -> addRaw -> seek(currentTime, true)
```

Key details:
- `reset()` clears DOM and dmList, but does not reset `pTime/cTime`.
- `addRaw()` -> `add()` -> `refresh()` uses stale `pTime/cTime`.
- `seek(..., true)` triggers another `refresh()` at the chosen time.

Then you click play:

```
togglePlay() -> compile -> reset -> addRaw -> play()
```

Key details:
- `addRaw()` again runs `refresh()` while paused.
- Immediately after, `play()` starts the render loop.
- `render()` sees the same danmaku in the active time window and draws again.

Result: the same danmaku is inserted twice.

### 3.3 Why Negative `animation-delay` Appears

From `public/bas.js`:

```
animation-delay = delay - startTime
```

If preview is at time T > 0, then:
- `startTime = T`
- `delay` is the original delay (e.g. 4.52s)
- `delay - startTime` becomes negative if `T > delay`

This is expected for mid-time preview, so you see one node with negative delay (preview refresh), and one node with 0 delay (fresh play).

---

## 4. Root Cause (Summary)

1) **Two draw paths overlap**:
   - `refresh()` draws one node while paused (preview).
   - The `render()` loop draws the same node again when playback starts.

2) **`reset()` does not reset BasDanmaku internal time**:
   - `pTime/cTime` from a previous playback remain.
   - `refresh()` interprets the time as non-zero and draws immediately.

3) **No de-duplication in BasDanmaku**:
   - BasDanmaku does not check if a danmaku is already drawn in DOM.

---

## 5. Solution A: App-Layer Only (No bas.js Changes)

### Goal

Ensure that **only one draw path** runs when switching from preview to play.

### Strategy A1: "Preview builds, Play only resumes"

**Idea**: While paused, allow preview refresh. When user clicks play, do NOT recompile or re-add; just call `play()`.

**How it works**:
- Pause state: build + refresh for preview.
- Play state: just resume the same BasDanmaku instance.
- No second `refresh()`, so no duplicate.

**Implementation outline**:

1) Track a `needsRecompile` flag in `PreviewPanel.vue`.
2) In watch:
   - If paused: compile -> reset -> addRaw -> seek(currentTime, true)
   - Set `needsRecompile = false`
3) In `togglePlay()`:
   - If `needsRecompile` is false: just `basService.play()`
   - If true: compile + add, then play (see Strategy A2)

**Pros**
- Minimal changes.
- Keeps preview accurate.
- No bas.js changes.

**Cons**
- Requires state tracking in preview component.

### Strategy A2: "Compile before play, but do NOT refresh"

**Idea**: If playback must recompile, add the BAS code without refresh, then start play.

**Required change**: Expose `noRefresh` support in `basService.addRaw`.

**Implementation outline**:

1) Extend `src/utils/bas.ts`:

```
addRaw(text, options) {
  this.bas?.add?.({
    dm: { text, stime: 0 },
    parsed: false,
    noRefresh: options?.noRefresh,
    success: options?.success,
    error: options?.error,
  });
}
```

2) In `togglePlay()`:

```
const code = compileTimelineToBas(...);
basService.reset();
basService.addRaw(code, { noRefresh: true });
basService.seek(timelineStore.currentTime / 1000, false);
basService.play();
```

**Why it fixes the issue**
- No refresh happens during add -> no DOM nodes drawn.
- Only the `render()` loop inserts the danmaku once.

**Pros**
- Deterministic; avoids duplicate draw.
- Works even if you recompile before every play.

**Cons**
- Requires small API change in `bas.ts`.
- If you expected preview to show immediately after play without render loop, you must call `play()` right away.

### Strategy A3: "Two BasDanmaku instances" (optional)

**Idea**: Use one instance for paused preview and another for play.

**Pros**: Completely isolates preview from playback.
**Cons**: More code and memory; usually unnecessary if A1/A2 is applied.

---

## 6. Solution B: Patch bas.js

### Goal

Prevent BasDanmaku from drawing the same danmaku twice when `refresh()` is followed by `render()`.

### Strategy B1: Sync `pTime` after `refresh()`

**Idea**: After `refresh()` draws at time `t`, set `pTime = cTime` so the next frame does not re-add the same danmaku into `cdmList`.

**Patch location**: `public/bas.js`, method `e.prototype.refresh`.

**Patch (conceptual)**:

```
e.prototype.refresh = function () {
  this.clear();
  // ... existing draw logic ...
  this.pTime = this.cTime; // new line
};
```

**Why it works**
- `refreshCdmList()` only adds danmaku when `stime` is between `pTime` and `cTime`.
- If `pTime == cTime` right after refresh, the window size is 0, so nothing is re-added next frame.

**Pros**
- Minimal change in bas.js.
- Keeps existing app logic unchanged.

**Cons**
- Affects global behavior of BasDanmaku.
- Must re-test cases where `refresh()` is expected to allow immediate re-entry.

### Strategy B2: Add a de-duplication guard (more invasive)

**Idea**: Track drawn `dmid` or `def` and skip if already in DOM.

**Pros**
- Strong guarantee against duplicates.

**Cons**
- Requires lifecycle tracking (remove on animation end).
- More invasive and higher risk of regressions.

---

## 7. Recommendation Matrix

| Strategy | Code Change Scope | Risk | Recommended When |
|---|---|---|---|
| A1 (Play resumes only) | App only | Low | You can tolerate compile-on-pause workflow |
| A2 (Add without refresh) | App only | Low-Medium | You must recompile on play |
| B1 (Refresh sync) | bas.js | Medium | Need a library-level fix |
| B2 (De-dupe) | bas.js | High | You need a hard guarantee in library |

Default recommendation: **A1 or A2**, unless you need a universal fix inside bas.js.

---

## 8. Validation Checklist

After applying any fix:

1) Repro steps:
   - Play, pause, drag clip, play again.
   - Confirm DOM contains only one `.bas-danmaku-item--obj_xxx`.
2) Preview check:
   - Seek to mid time while paused, verify preview still shows correct state.
3) Multiple clips:
   - Add 2+ danmaku, check no duplication across all clips.
4) Animation timing:
   - Ensure negative delay still allowed in preview (this is expected).

---

## 9. Notes on `animation-delay` Negative Values

Negative `animation-delay` is a **feature**, not a bug:
- It fast-forwards the animation to the correct time offset for preview.
- If you force it to 0, preview at mid-time will be wrong.

So the fix should avoid duplicate rendering, not remove negative delay.

