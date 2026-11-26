<script lang="ts">
export const DEFAULT_TRACK_HEIGHT = 40;
const MIN_TRACK_HEIGHT = 36;
const MAX_TRACK_HEIGHT = 160;
const KEYBOARD_STEP = 8;
</script>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  height: number;
  trackName: string;
  controls?: string;
}>();
const emit = defineEmits<{ resize: [height: number] }>();
const { t } = useI18n();
const drag = ref<{ pointerId: number; startY: number; startHeight: number } | null>(null);

const resize = (height: number) => {
  const nextHeight = Math.min(MAX_TRACK_HEIGHT, Math.max(MIN_TRACK_HEIGHT, Math.round(height)));
  if (nextHeight !== props.height) emit("resize", nextHeight);
};

const startResize = (event: PointerEvent) => {
  if (event.button !== 0 || !event.isPrimary || drag.value) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag.value = { pointerId: event.pointerId, startY: event.clientY, startHeight: props.height };
};

const moveResize = (event: PointerEvent) => {
  const active = drag.value;
  if (active?.pointerId !== event.pointerId) return;
  resize(active.startHeight + event.clientY - active.startY);
};

const endResize = (event: PointerEvent) => {
  if (drag.value?.pointerId === event.pointerId) drag.value = null;
};
</script>

<template>
  <div
    class="track-resize-handle absolute inset-x-0 -bottom-1 z-40 h-2 cursor-row-resize select-none touch-pan-x"
    :class="{ 'is-resizing': drag }"
    data-track-resize-handle
    :role="controls ? 'separator' : undefined"
    :tabindex="controls ? 0 : undefined"
    :aria-hidden="controls ? undefined : true"
    :aria-orientation="controls ? 'horizontal' : undefined"
    :aria-controls="controls"
    :aria-label="controls ? t('timeline.track.resize', { name: trackName }) : undefined"
    :aria-valuenow="controls ? height : undefined"
    :aria-valuemin="controls ? MIN_TRACK_HEIGHT : undefined"
    :aria-valuemax="controls ? MAX_TRACK_HEIGHT : undefined"
    :title="t('timeline.track.resizeHint')"
    @pointerdown="startResize"
    @pointermove="moveResize"
    @pointerup="endResize"
    @pointercancel="endResize"
    @lostpointercapture="endResize"
    @mousedown.stop
    @click.stop
    @dblclick.stop="resize(DEFAULT_TRACK_HEIGHT)"
    @keydown.up.stop.prevent="resize(height - KEYBOARD_STEP)"
    @keydown.down.stop.prevent="resize(height + KEYBOARD_STEP)"
    @keydown.home.stop.prevent="resize(MIN_TRACK_HEIGHT)"
    @keydown.end.stop.prevent="resize(MAX_TRACK_HEIGHT)"
    @keydown.enter.stop.prevent="resize(DEFAULT_TRACK_HEIGHT)"
  ></div>
</template>

<style scoped>
.track-resize-handle::after {
  position: absolute;
  inset-inline: 0;
  top: 50%;
  height: 2px;
  background: var(--primary);
  content: "";
  opacity: 0;
  pointer-events: none;
}

.track-resize-handle:hover::after,
.track-resize-handle:focus-visible::after,
.track-resize-handle.is-resizing::after {
  opacity: 1;
}
</style>
