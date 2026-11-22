<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Pipette } from "lucide-vue-next";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";

export type Hsva = { h: number; s: number; v: number; a: number };
type Rgba = { r: number; g: number; b: number; a: number };
type DragMode = "area" | "hue";
type DragState = {
  mode: DragMode;
  pointerId: number;
  target: HTMLElement;
  clientX: number;
  clientY: number;
  lastX: number;
};

const PRESET_COLORS = ["#3478f6", "#9270e8", "#e66aa4", "#e55656", "#ed9141", "#e5b63c", "#65a65a", "#169d83"];
const DROP_PATH = "M20 48C13 39 4 30 4 20a16 16 0 1 1 32 0c0 10-9 19-16 28Z";

type Props = {
  modelValue: string;
  disabled?: boolean;
  ariaLabel?: string;
};

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  ariaLabel: "Choose color"
});

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const isOpen = ref(false);
const draft = ref<Rgba>(parseHex(props.modelValue) ?? { r: 52, g: 120, b: 246, a: 1 });
const hsva = ref(rgbaToHsva(draft.value));
const hexInput = ref(formatHex(draft.value).slice(1));
const dragTilt = ref(0);
const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

// Pointer state changes on every event and is never rendered, so it stays out of Vue reactivity.
let drag: DragState | null = null;
let frameId = 0;
let tiltTimer = 0;

const color = computed(() => formatHex(draft.value));
const hueColor = computed(() => `hsl(${hsva.value.h} 100% 50%)`);
const areaPosition = computed(() => ({ left: `${hsva.value.s}%`, top: `${100 - hsva.value.v}%` }));
const dropStyle = computed(() => ({
  ...areaPosition.value,
  transform: `translate(-50%, calc(-100% - 10px)) rotate(${dragTilt.value}deg)`
}));

watch(
  () => props.modelValue,
  value => {
    const parsed = parseHex(value);
    if (parsed && !isOpen.value) setDraft(parsed);
  }
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseHex(input: string): Rgba | null {
  const match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length <= 4) hex = [...hex].map(char => char + char).join("");
  const channel = (index: number) => Number.parseInt(hex.slice(index, index + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: 1 };
}

function formatHex(value: Rgba): string {
  const channel = (input: number) => Math.round(input).toString(16).padStart(2, "0");
  return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}`;
}

function rgbaToHsva(value: Rgba, previous?: Hsva): Hsva {
  const red = value.r / 255;
  const green = value.g / 255;
  const blue = value.b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = previous?.h ?? 0;
  if (delta) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? (delta / max) * 100 : (previous?.s ?? 0), v: max * 100, a: 1 };
}

function hsvaToRgba(value: Hsva): Rgba {
  const saturation = value.s / 100;
  const brightness = value.v / 100;
  const channel = (offset: number) => {
    const k = (offset + value.h / 60) % 6;
    return brightness - brightness * saturation * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: channel(5) * 255, g: channel(3) * 255, b: channel(1) * 255, a: 1 };
}

function setDraft(next: Rgba, nextHsva = rgbaToHsva(next, hsva.value)) {
  draft.value = next;
  hsva.value = nextHsva;
  hexInput.value = formatHex(next).slice(1);
}

function commitColor(next: Rgba, nextHsva?: Hsva) {
  setDraft(next, nextHsva);
  const value = formatHex(next);
  const current = parseHex(props.modelValue);
  // Dragging often lands on the same 8-bit color; skipping it avoids redundant store writes.
  if (!current || formatHex(current) !== value) emit("update:modelValue", value);
}

function applyPointer() {
  frameId = 0;
  if (!drag) return;
  const rect = drag.target.getBoundingClientRect();
  const x = clamp((drag.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((drag.clientY - rect.top) / rect.height, 0, 1);
  if (drag.mode === "hue") {
    const next = { ...hsva.value, h: x * 360 };
    commitColor(hsvaToRgba(next), next);
    return;
  }
  dragTilt.value = clamp((drag.clientX - drag.lastX) * 1.8, -18, 18);
  drag.lastX = drag.clientX;
  window.clearTimeout(tiltTimer);
  tiltTimer = window.setTimeout(() => (dragTilt.value = 0), 90);
  const next = { ...hsva.value, s: x * 100, v: (1 - y) * 100 };
  commitColor(hsvaToRgba(next), next);
}

function startPointer(event: PointerEvent, mode: DragMode) {
  if (props.disabled || event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  drag = {
    mode,
    pointerId: event.pointerId,
    target,
    clientX: event.clientX,
    clientY: event.clientY,
    lastX: event.clientX
  };
  applyPointer();
}

function movePointer(event: PointerEvent) {
  if (drag?.pointerId !== event.pointerId) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  // Pointer events can fire far faster than the display refreshes; render and emit at most once per frame.
  if (!frameId) frameId = window.requestAnimationFrame(applyPointer);
}

function stopPointer(event: PointerEvent) {
  if (drag?.pointerId !== event.pointerId) return;
  if (frameId) {
    window.cancelAnimationFrame(frameId);
    applyPointer();
  }
  drag = null;
  window.clearTimeout(tiltTimer);
  dragTilt.value = 0;
}

function handleOpenChange(open: boolean) {
  if (open) {
    const parsed = parseHex(props.modelValue);
    if (parsed) setDraft(parsed);
  }
  isOpen.value = open;
}

function commitHex() {
  const parsed = parseHex(hexInput.value);
  if (parsed) commitColor(parsed);
  else hexInput.value = color.value.slice(1);
}

function applyPreset(value: string) {
  const parsed = parseHex(value);
  if (parsed) commitColor(parsed);
}

// Tauri Windows 端的 WebView2 157+ 默认开启未公开特性 msWebView2EnableMinimalWindow，会让 EyeDropper 点击后无响应
// （https://github.com/MicrosoftEdge/WebView2Feedback/issues/5810）。src-tauri/tauri.conf.json 的
// additionalBrowserArgs 因此禁用了该特性；设置该字段会替换 wry 默认参数，所以同时保留了
// msWebOOUI、msPdfOOUI、msSmartScreenProtection。微软修复后可移除 msWebView2EnableMinimalWindow。
async function useEyeDropper() {
  const EyeDropper = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } })
    .EyeDropper;
  if (!EyeDropper) return;
  // open() rejects when the user cancels with Escape.
  const result = await new EyeDropper().open().catch(() => null);
  if (result) applyPreset(result.sRGBHex);
}

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frameId);
  window.clearTimeout(tiltTimer);
});
</script>

<template>
  <PopoverRoot :open="isOpen" @update:open="handleOpenChange">
    <PopoverTrigger
      :aria-label="props.ariaLabel"
      :disabled="props.disabled"
      class="size-8 shrink-0 rounded-md border border-border bg-surface p-1 transition-colors hover:border-ring/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span class="block size-full rounded-[3px] border border-black/10" :style="{ backgroundColor: color }" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="start"
        :side-offset="8"
        :collision-padding="8"
        :aria-label="props.ariaLabel"
        class="z-50 w-[300px] rounded-[14px] border border-border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
        @open-auto-focus.prevent
      >
        <div
          class="relative h-40 cursor-crosshair touch-none rounded-[10px]"
          :style="{
            backgroundColor: hueColor,
            backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)'
          }"
          @pointerdown="startPointer($event, 'area')"
          @pointermove="movePointer"
          @pointerup="stopPointer"
          @pointercancel="stopPointer"
        >
          <svg
            class="pointer-events-none absolute z-10 h-[50px] w-10 origin-bottom overflow-visible drop-shadow-[0_2px_4px_rgb(0_0_0/0.45)] transition-transform duration-150 ease-out"
            viewBox="0 0 40 50"
            :style="dropStyle"
            aria-hidden="true"
          >
            <path :d="DROP_PATH" :fill="color" stroke="#fff" stroke-width="3" stroke-linejoin="round" />
          </svg>
          <span
            class="pointer-events-none absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.4)]"
            :style="{ ...areaPosition, backgroundColor: color }"
          />
        </div>

        <div class="mt-3 flex items-center gap-3">
          <button
            v-if="hasEyeDropper"
            type="button"
            aria-label="Pick color from screen"
            class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @click="useEyeDropper"
          >
            <Pipette class="size-4" />
          </button>
          <div
            class="relative flex h-6 flex-1 cursor-pointer touch-none items-center"
            @pointerdown="startPointer($event, 'hue')"
            @pointermove="movePointer"
            @pointerup="stopPointer"
            @pointercancel="stopPointer"
          >
            <span class="h-3 w-full rounded-full bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]" />
            <span
              class="pointer-events-none absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.4)]"
              :style="{ left: `${hsva.h / 3.6}%`, backgroundColor: hueColor }"
            />
          </div>
        </div>

        <div class="mt-3 flex h-9 items-center gap-2">
          <span
            class="flex h-full items-center rounded-lg border border-border px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Hex
          </span>
          <label
            class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-input px-2.5 font-mono text-xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          >
            <span class="text-muted-foreground">#</span>
            <input
              v-model="hexInput"
              aria-label="Hex color"
              maxlength="9"
              spellcheck="false"
              class="min-w-0 flex-1 bg-transparent font-semibold uppercase outline-none"
              @keydown.enter="commitHex"
              @blur="commitHex"
            />
          </label>
          <span
            class="size-9 shrink-0 rounded-lg border border-border"
            :style="{ backgroundColor: color }"
            aria-hidden="true"
          />
        </div>

        <div class="mt-3 flex items-center justify-between">
          <button
            v-for="preset in PRESET_COLORS"
            :key="preset"
            type="button"
            :aria-label="`Use ${preset}`"
            class="size-6 rounded-full border border-white/15 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :style="{ backgroundColor: preset }"
            @click="applyPreset(preset)"
          />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
