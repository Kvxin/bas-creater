<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Layers2, Plus } from "lucide-vue-next";
import { draggedEffect, EFFECT_DRAG_TYPE, effectCatalog, loadEffects } from "@/effects/registry";
import { effectText, type EffectCategory, type EffectPlugin } from "@/core/effects";
import { useTimelineStore } from "@/stores/timeline";

const { t, locale } = useI18n();
const timeline = useTimelineStore();
const errorMessage = ref("");
const activeCategory = ref<"all" | EffectCategory>("all");
const categories = computed(() => [
  { id: "all" as const, label: t("effects.categoryAll") },
  { id: "animation" as const, label: t("effects.categoryAnimation") },
  { id: "style" as const, label: t("effects.categoryStyle") }
]);
const filteredPlugins = computed(() => {
  const list = effectCatalog.value?.plugins ?? [];
  if (activeCategory.value === "all") return list;
  return list.filter(plugin => (plugin.category ?? "animation") === activeCategory.value);
});
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
    <header class="panel-heading flex items-center justify-between gap-2 px-3 font-semibold">
      <span>{{ t("effects.title") }}</span>
      <div class="flex items-center gap-1 text-xs font-normal" role="tablist">
        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          role="tab"
          :aria-selected="activeCategory === cat.id"
          :data-effect-category="cat.id"
          class="rounded-sm px-1.5 py-0.5 transition-colors"
          :class="
            activeCategory === cat.id
              ? 'bg-primary/15 text-primary font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          "
          @click="activeCategory = cat.id"
        >
          {{ cat.label }}
        </button>
      </div>
    </header>
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
            v-for="plugin in filteredPlugins"
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
        <p v-if="!filteredPlugins.length" class="p-3 text-xs text-muted-foreground">{{ t("effects.empty") }}</p>
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
