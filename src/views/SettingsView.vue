<script setup lang="ts">
import { ArrowLeft, ExternalLink, Github, Languages, Monitor, Moon, Sun } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { SUPPORTED_LOCALES } from "@/i18n";
import { openExternalUrl } from "@/utils/desktop";

const isDark = defineModel<boolean>("isDark", { required: true });
defineEmits<{ close: [] }>();
const { t, locale } = useI18n();
const repositoryUrl = "https://github.com/Kvxin/bas-creater";
</script>

<template>
  <main class="flex-1 min-h-0 overflow-y-auto bg-workspace" data-ui="settings-page">
    <div class="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-12">
      <button
        type="button"
        class="mb-8 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        @click="$emit('close')"
      >
        <ArrowLeft class="size-4" /> {{ t("app.backToEditor") }}
      </button>
      <div class="mb-8">
        <p class="mb-2 text-xs font-medium text-muted-foreground">DanmakuCut</p>
        <h2 class="text-2xl font-semibold tracking-tight">{{ t("app.settings") }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ t("app.settingsDescription") }}</p>
      </div>

      <section class="panel workbench-panel p-5 sm:p-6">
        <div class="mb-5 flex items-center gap-3">
          <div class="flex size-8 items-center justify-center rounded-sm bg-surface text-muted-foreground">
            <Monitor class="size-4" />
          </div>
          <div>
            <h3 class="font-medium">{{ t("app.appearance") }}</h3>
            <p class="text-xs text-muted-foreground">{{ t("app.appearanceDescription") }}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-4 border-t border-border py-4">
          <div>
            <p class="font-medium">{{ t("app.theme") }}</p>
            <p class="mt-1 text-xs text-muted-foreground">{{ t("app.themeDescription") }}</p>
          </div>
          <div class="flex rounded-md border border-border bg-input p-1" role="group" :aria-label="t('app.theme')">
            <button
              type="button"
              class="flex items-center gap-2 h-7 rounded-sm px-3 text-xs transition-colors"
              :class="!isDark ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="!isDark"
              @click="isDark = false"
            >
              <Sun class="size-4" />{{ t("app.lightTheme") }}
            </button>
            <button
              type="button"
              class="flex items-center gap-2 h-7 rounded-sm px-3 text-xs transition-colors"
              :class="isDark ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="isDark"
              @click="isDark = true"
            >
              <Moon class="size-4" />{{ t("app.darkTheme") }}
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <div class="flex items-start gap-3">
            <Languages class="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <label for="settings-language" class="font-medium">{{ t("app.language") }}</label>
              <p class="mt-1 text-xs text-muted-foreground">{{ t("app.languageDescription") }}</p>
            </div>
          </div>
          <select
            id="settings-language"
            v-model="locale"
            class="h-8 min-w-36 rounded-sm border border-border bg-input px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option v-for="item in SUPPORTED_LOCALES" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
      </section>

      <section class="panel workbench-panel mt-4 p-5 sm:p-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="flex size-8 items-center justify-center rounded-sm bg-surface"><Github class="size-4" /></div>
            <div>
              <h3 class="font-medium">{{ t("app.about") }}</h3>
              <p class="text-xs text-muted-foreground">{{ t("app.aboutDescription") }}</p>
            </div>
          </div>
          <a
            :href="repositoryUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="ui-button"
            @click.prevent="openExternalUrl(repositoryUrl)"
            >GitHub <ExternalLink class="size-3.5"
          /></a>
        </div>
      </section>
    </div>
  </main>
</template>
