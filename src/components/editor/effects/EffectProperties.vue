<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronUp, ChevronDown, Trash2 } from "lucide-vue-next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { effectCatalog } from "@/effects/registry";
import { effectText, matchesEffect, type EffectInstance, type EffectParams } from "@/effects/types";
import { useTimelineStore } from "@/stores/timeline";

const props = defineProps<{ clipId: string; effect: EffectInstance; first: boolean; last: boolean; locked: boolean }>();
const { t, locale } = useI18n();
const timeline = useTimelineStore();
const plugin = computed(() => effectCatalog.value?.plugins.find(item => matchesEffect(item, props.effect)));
const title = computed(() => (plugin.value ? effectText(plugin.value.title, locale.value) : props.effect.pluginId));
const params = ref<EffectParams>({});
const errorMessage = ref("");
const spanStart = ref(props.effect.span[0]);
const spanDuration = ref(props.effect.span[1] - props.effect.span[0]);
watch(
  () => props.effect,
  effect => {
    params.value = { ...effect.params };
    spanStart.value = effect.span[0];
    spanDuration.value = effect.span[1] - effect.span[0];
    errorMessage.value = "";
  },
  { immediate: true }
);
const changed = computed(() => Object.keys(params.value).some(key => params.value[key] !== props.effect.params[key]));
function applySpan() {
  const start = Number(spanStart.value);
  const duration = Number(spanDuration.value);
  if (!Number.isFinite(start) || !Number.isFinite(duration)) {
    errorMessage.value = t("effects.invalidSpan");
    spanStart.value = props.effect.span[0];
    spanDuration.value = props.effect.span[1] - props.effect.span[0];
    return;
  }
  try {
    timeline.updateEffectSpan(props.clipId, props.effect.id, [start, start + duration]);
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    spanStart.value = props.effect.span[0];
    spanDuration.value = props.effect.span[1] - props.effect.span[0];
  }
}

function apply() {
  if (!plugin.value) return;
  try {
    timeline.updateEffect(props.clipId, props.effect.id, plugin.value, params.value);
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}
</script>

<template>
  <li
    class="space-y-2 py-2"
    :data-effect-instance="effect.id"
    @click="timeline.setEditingEffect(clipId, effect.id)"
  >
    <div class="flex items-center gap-1">
      <span class="min-w-0 flex-1 truncate font-medium" :title="title">{{ title }}</span>
      <button
        type="button"
        class="ui-icon-button"
        :disabled="locked || first"
        :title="t('effects.up')"
        :aria-label="t('effects.up')"
        @click="timeline.moveEffect(clipId, effect.id, -1)"
      >
        <ChevronUp />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        :disabled="locked || last"
        :title="t('effects.down')"
        :aria-label="t('effects.down')"
        @click="timeline.moveEffect(clipId, effect.id, 1)"
      >
        <ChevronDown />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        :disabled="locked"
        :title="t('effects.remove')"
        :aria-label="t('effects.removeNamed', { name: title })"
        @click="timeline.removeEffect(clipId, effect.id)"
      >
        <Trash2 />
      </button>
    </div>
    <form class="space-y-2" @submit.prevent="applySpan">
      <div class="grid grid-cols-[minmax(0,1fr)_minmax(64px,0.9fr)] items-center gap-2">
        <Label :for="effect.id + '-start'" class="text-xs text-muted-foreground">{{ t("effects.start") }}</Label>
        <Input
          :id="effect.id + '-start'"
          v-model.number="spanStart"
          type="number"
          min="0"
          step="1"
          class="h-7 tabular-nums"
          :disabled="locked"
        />
      </div>
      <div class="grid grid-cols-[minmax(0,1fr)_minmax(64px,0.9fr)] items-center gap-2">
        <Label :for="effect.id + '-duration'" class="text-xs text-muted-foreground">{{ t("effects.duration") }}</Label>
        <Input
          :id="effect.id + '-duration'"
          v-model.number="spanDuration"
          type="number"
          min="1"
          step="1"
          class="h-7 tabular-nums"
          :disabled="locked"
        />
      </div>
      <button type="submit" class="ui-button" :disabled="locked">{{ t("effects.applySpan") }}</button>
    </form>
    <form v-if="plugin && Object.keys(plugin.params).length" @submit.prevent="apply">
      <fieldset :disabled="locked" class="space-y-2">
        <div
          v-for="(field, key) in plugin.params"
          :key="key"
          class="grid grid-cols-[minmax(0,1fr)_minmax(64px,0.9fr)] items-center gap-2"
        >
          <Label :for="effect.id + '-' + key" class="text-xs text-muted-foreground">{{
            effectText(field.label, locale)
          }}</Label>
          <Input
            v-if="field.type === 'number'"
            :id="effect.id + '-' + key"
            type="number"
            required
            class="h-7 tabular-nums"
            :step="field.step"
            :min="field.min"
            :max="field.max"
            :model-value="params[key]"
            @update:model-value="value => (params[key] = value === '' ? '' : Number(value))"
          />
          <Input
            v-else
            :id="effect.id + '-' + key"
            :type="field.type === 'color' ? 'color' : 'text'"
            class="h-7"
            :model-value="params[key]"
            @update:model-value="value => (params[key] = String(value))"
          />
        </div>
        <button type="submit" class="ui-button" :disabled="locked || !changed">{{ t("effects.apply") }}</button>
      </fieldset>
    </form>
    <p v-else-if="effectCatalog && !plugin" role="status" class="text-xs text-muted-foreground">
      {{ t("effects.unavailable", { version: effect.pluginVersion }) }}
    </p>
    <p v-if="errorMessage" role="alert" class="text-xs break-words text-destructive">{{ errorMessage }}</p>
  </li>
</template>
