<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useBasImportStore } from "@/stores/basImport";
import { useTimelineStore } from "@/stores/timeline";
import { parseBasDSL } from "@/utils/bas";
import {
  convertParsedBas,
  formatStartTimeInput,
  parseStartTimeInput,
  type BasImportResult,
  type BasImportWarning
} from "@/utils/basImport";
import { formatTime } from "@/utils/timeline";

const { t } = useI18n();
const store = useBasImportStore();
const timelineStore = useTimelineStore();

/** 输入防抖：避免每次按键都创建 BAS 解析器实例。 */
const PARSE_DEBOUNCE_MS = 300;

const source = ref("");
const startTimeText = ref("00:00.000");
const createTrack = ref(false);
const parsing = ref(false);
const parseError = ref("");
const importError = ref("");
const preview = ref<BasImportResult | null>(null);
/** 预览对应的输入快照，防止防抖未完成时用旧结果导入。 */
const previewSource = ref("");
const previewStartTime = ref("");

const currentTrack = computed(
  () => timelineStore.tracks.find(track => track.id === store.trackId) ?? null
);
const currentTrackUsable = computed(
  () => !!currentTrack.value && !currentTrack.value.locked && currentTrack.value.type !== "audio"
);
const effectiveCreateTrack = computed(() => createTrack.value || !currentTrackUsable.value);

const startTimeMs = computed(() => parseStartTimeInput(startTimeText.value));
const startTimeInvalid = computed(() => startTimeMs.value === null);
const previewStale = computed(
  () =>
    preview.value !== null &&
    (previewSource.value !== source.value || previewStartTime.value !== startTimeText.value)
);
const canImport = computed(
  () =>
    !parsing.value &&
    !startTimeInvalid.value &&
    !parseError.value &&
    !previewStale.value &&
    (preview.value?.objects.length ?? 0) > 0
);
const objectNames = computed(
  () => preview.value?.objects.map(object => object.name).join(", ") ?? ""
);
/** 导入区间与目标轨道已有片段的重叠数量（时间轴允许重叠，仅作提示）。 */
const overlapCount = computed(() => {
  const result = preview.value;
  const track = currentTrack.value;
  if (!result || effectiveCreateTrack.value || !track) return 0;
  const start = startTimeMs.value ?? 0;
  const end = start + result.durationMs;
  return track.clips.filter(clip => clip.startTime < end && start < clip.startTime + clip.duration).length;
});

let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;

const resetState = () => {
  revision += 1;
  if (timer) clearTimeout(timer);
  source.value = "";
  startTimeText.value = formatStartTimeInput(timelineStore.currentTime);
  createTrack.value = !currentTrackUsable.value;
  parsing.value = false;
  parseError.value = "";
  importError.value = "";
  preview.value = null;
  previewSource.value = "";
  previewStartTime.value = "";
};

const runParse = async () => {
  const text = source.value;
  const revisionAtStart = ++revision;
  parseError.value = "";

  if (!text.trim()) {
    parsing.value = false;
    preview.value = null;
    return;
  }

  parsing.value = true;
  try {
    const parsed = await parseBasDSL(text);
    if (revisionAtStart !== revision) return;
    preview.value = convertParsedBas(parsed, { startTimeMs: startTimeMs.value ?? 0 });
    previewSource.value = text;
    previewStartTime.value = startTimeText.value;
  } catch (error) {
    if (revisionAtStart !== revision) return;
    preview.value = null;
    parseError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (revisionAtStart === revision) parsing.value = false;
  }
};

watch(
  () => store.visible,
  visible => {
    if (visible) resetState();
  }
);

watch([source, startTimeText], () => {
  if (!store.visible) return;
  if (timer) clearTimeout(timer);
  parseError.value = "";
  timer = setTimeout(() => void runParse(), PARSE_DEBOUNCE_MS);
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

const handleOpenChange = (open: boolean) => {
  if (!open) store.close();
};

const handleImport = () => {
  if (!canImport.value || !preview.value) return;
  importError.value = "";
  try {
    timelineStore.importBasObjects(preview.value.objects, {
      trackId: store.trackId,
      createTrack: effectiveCreateTrack.value,
      startTimeMs: startTimeMs.value ?? 0
    });
    store.close();
  } catch (error) {
    importError.value = error instanceof Error ? error.message : String(error);
  }
};

/** 警告文案按 code 映射到 i18n，纯函数侧只返回结构化数据。 */
const warningText = (warning: BasImportWarning) => {
  const params = warning.params ?? {};
  switch (warning.code) {
    case "easingApproximated":
      return t("dialogs.basImport.warnings.easingApproximated", params);
    case "unsupportedAnimation":
      return t("dialogs.basImport.warnings.unsupportedAnimation", params);
    case "unsupportedTarget":
      return t("dialogs.basImport.warnings.unsupportedTarget", params);
    case "unknownObject":
      return t("dialogs.basImport.warnings.unknownObject", params);
    case "unknownNode":
      return t("dialogs.basImport.warnings.unknownNode");
    case "invalidParent":
      return t("dialogs.basImport.warnings.invalidParent", params);
    case "noObjects":
      return t("dialogs.basImport.warnings.noObjects");
    default:
      return warning.code;
  }
};
</script>

<template>
  <Dialog :open="store.visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-[680px]">
      <DialogHeader>
        <DialogTitle>{{ t("dialogs.basImport.title") }}</DialogTitle>
        <DialogDescription>{{ t("dialogs.basImport.description") }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 space-y-1">
            <Label>{{ t("dialogs.basImport.targetTrack") }}</Label>
            <p class="truncate text-sm text-muted-foreground">
              {{
                effectiveCreateTrack
                  ? t("dialogs.basImport.targetNew")
                  : currentTrack?.name ?? t("dialogs.basImport.targetNew")
              }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2 pt-5">
            <Label for="bas-import-new-track" class="text-xs font-normal text-muted-foreground">
              {{ t("dialogs.basImport.targetNew") }}
            </Label>
            <Switch
              id="bas-import-new-track"
              :model-value="effectiveCreateTrack"
              :disabled="!currentTrackUsable"
              @update:model-value="value => (createTrack = value === true)"
            />
          </div>
        </div>
        <p v-if="!currentTrackUsable" class="text-xs text-caution">
          {{ t("dialogs.basImport.targetUnavailable") }}
        </p>

        <div class="space-y-1">
          <Label for="bas-import-start-time">{{ t("dialogs.basImport.startTime") }}</Label>
          <Input
            id="bas-import-start-time"
            v-model="startTimeText"
            class="font-mono"
            autocomplete="off"
            spellcheck="false"
          />
          <p class="text-xs" :class="startTimeInvalid ? 'text-destructive' : 'text-muted-foreground'">
            {{ startTimeInvalid ? t("dialogs.basImport.startTimeInvalid") : t("dialogs.basImport.startTimeHint") }}
          </p>
        </div>

        <div class="space-y-1">
          <Label for="bas-import-source">{{ t("dialogs.basImport.source") }}</Label>
          <Textarea
            id="bas-import-source"
            v-model="source"
            class="h-52 resize-y font-mono text-xs leading-relaxed"
            :placeholder="t('dialogs.basImport.sourcePlaceholder')"
            spellcheck="false"
          />
        </div>

        <div class="space-y-1 rounded-sm border border-border bg-input/40 p-3 text-xs">
          <p v-if="parsing" class="text-muted-foreground">{{ t("dialogs.basImport.parsing") }}</p>
          <p v-else-if="parseError" role="alert" class="whitespace-pre-wrap break-words text-destructive">
            {{ parseError }}
          </p>
          <template v-else-if="preview">
            <p class="text-foreground">
              {{ t("dialogs.basImport.objectCount", { n: preview.objects.length }) }} ·
              {{ t("dialogs.basImport.durationText", { duration: formatTime(preview.durationMs).str }) }}
            </p>
            <p v-if="objectNames" class="break-words text-muted-foreground">{{ objectNames }}</p>
            <p v-if="overlapCount > 0" class="text-caution">
              {{ t("dialogs.basImport.overlapHint", { n: overlapCount }) }}
            </p>
            <div v-if="preview.warnings.length" class="space-y-1 pt-1">
              <p class="text-caution">{{ t("dialogs.basImport.warningTitle", { n: preview.warnings.length }) }}</p>
              <ul class="list-disc space-y-0.5 pl-4 text-caution">
                <li v-for="(warning, index) in preview.warnings" :key="`${warning.code}-${index}`">
                  {{ warningText(warning) }}
                </li>
              </ul>
            </div>
          </template>
          <p v-else class="text-muted-foreground">—</p>
        </div>

        <p v-if="importError" role="alert" class="break-words text-sm text-destructive">
          {{ t("dialogs.basImport.importFailed", { message: importError }) }}
        </p>
      </div>

      <DialogFooter>
        <button type="button" class="ui-button" @click="store.close()">{{ t("app.cancel") }}</button>
        <button type="button" class="ui-button ui-button-primary" :disabled="!canImport" @click="handleImport">
          {{ t("dialogs.basImport.import") }}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
