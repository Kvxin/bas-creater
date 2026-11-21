<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Layers2, Plus } from "lucide-vue-next";
import { draggedEffect, EFFECT_DRAG_TYPE, effectCatalog, loadEffects } from "@/effects/registry";
import { effectText, type EffectPlugin } from "@/effects/types";
import { useTimelineStore } from "@/stores/timeline";

const { t, locale } = useI18n();
const timeline = useTimelineStore();
const errorMessage = ref("");
const target = computed(() =>
  timeline.selectedClipIds.length === 1 ? timeline.getEffectTarget(timeline.selectedClipId) : null
);
onMounted(loadEffects);
onUnmounted(() => {
  draggedEffect.value = null;
});
watch(target, () => {
  errorMessage.value = "";
});

function attach(plugin: EffectPlugin) {
  if (!target.value) return;
  try {
    errorMessage.value = "";
    timeline.attachEffect(target.value.clip.id, plugin);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}
function drag(event: DragEvent, plugin: EffectPlugin) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(EFFECT_DRAG_TYPE, plugin.id);
  event.dataTransfer.effectAllowed = "copy";
  draggedEffect.value = plugin;
}
</script>

<template>
  <section class="min-w-0 flex-1 flex flex-col bg-background" data-ui="effects-library">
    <header class="panel-heading flex items-center px-3 font-semibold">{{ t("effects.title") }}</header>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <p role="status" class="border-b border-divider px-3 py-2 text-xs text-muted-foreground">
        {{
          target
            ? t("effects.target", {
                name: target.clip.name || target.resource.name || t("danmu.type." + target.resource.type)
              })
            : t("effects.hint")
        }}
      </p>
      <p v-if="!effectCatalog" role="status" class="px-3 py-2 text-xs text-muted-foreground">
        {{ t("effects.loading") }}
      </p>
      <template v-else>
        <ul class="divide-y divide-divider">
          <li
            v-for="plugin in effectCatalog.plugins"
            :key="plugin.id"
            class="flex items-center gap-2 px-3 py-2 cursor-grab hover:bg-accent"
            draggable="true"
            :data-effect-plugin="plugin.id"
            @dragstart="drag($event, plugin)"
            @dragend="draggedEffect = null"
          >
            <Layers2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <span class="font-medium">{{ effectText(plugin.title, locale) }}</span>
              <p v-if="plugin.description" class="text-xs text-muted-foreground">
                {{ effectText(plugin.description, locale) }}
              </p>
            </div>
            <button
              type="button"
              class="ui-icon-button shrink-0"
              :data-attach-effect="plugin.id"
              :disabled="!target || !plugin.targets.includes(target.resource.type)"
              :aria-label="t('effects.attach', { name: effectText(plugin.title, locale) })"
              :title="
                target && !plugin.targets.includes(target.resource.type)
                  ? t('effects.supports', { types: plugin.targets.map(type => t('danmu.type.' + type)).join(' / ') })
                  : t('effects.attach', { name: effectText(plugin.title, locale) })
              "
              @click="attach(plugin)"
            >
              <Plus aria-hidden="true" />
            </button>
          </li>
        </ul>
        <p v-if="!effectCatalog.plugins.length" class="p-3 text-xs text-muted-foreground">{{ t("effects.empty") }}</p>
        <p
          v-for="error in effectCatalog.errors"
          :key="error.entry"
          role="alert"
          class="px-3 py-1 break-words text-xs text-destructive"
        >
          {{ error.entry }} · {{ error.message }}
        </p>
      </template>
      <p v-if="errorMessage" role="alert" class="px-3 py-2 text-xs text-destructive">{{ errorMessage }}</p>
    </div>
  </section>
</template>
