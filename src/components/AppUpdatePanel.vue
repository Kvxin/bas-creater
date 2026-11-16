<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAppUpdateStore } from "@/stores/appUpdate";
import { Switch } from "@/components/ui/switch";
import { isDesktopApp, openExternalUrl, RELEASES_URL } from "@/utils/desktop";

defineProps<{ compact?: boolean }>();
const updates = useAppUpdateStore();
const { t } = useI18n();
const isDesktop = isDesktopApp();
const percent = computed(() =>
  updates.progress.total
    ? Math.min(100, Math.round((updates.progress.downloaded / updates.progress.total) * 100))
    : null
);
</script>

<template>
  <section aria-live="polite" :aria-busy="updates.isBusy" class="space-y-3">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="font-medium">{{ t("updates.title") }}</h3>
        <p v-if="updates.status" class="mt-1 text-xs text-muted-foreground">
          {{ t("updates.currentVersion", { version: updates.status.currentVersion }) }}
        </p>
      </div>
      <button v-if="compact" type="button" class="ui-button" :disabled="updates.isBusy" @click="updates.dismiss">
        {{ t("updates.later") }}
      </button>
    </div>
    <p v-if="updates.status?.availableVersion" class="text-sm">
      {{ t("updates.available", { version: updates.status.availableVersion }) }}
    </p>
    <p v-else-if="updates.hasChecked && !updates.error" class="text-sm text-muted-foreground">
      {{ t("updates.upToDate") }}
    </p>
    <p
      v-if="updates.status?.notes && !compact"
      class="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground"
    >
      {{ updates.status.notes }}
    </p>
    <div v-if="isDesktop && !compact" class="flex items-center justify-between gap-4">
      <label for="auto-download-updates" class="text-sm">{{ t("updates.autoDownload") }}</label>
      <Switch
        id="auto-download-updates"
        :model-value="updates.autoDownload"
        :disabled="updates.isBusy || !updates.status?.supported"
        @update:model-value="updates.setAutoDownload"
      />
    </div>
    <p v-if="!isDesktop" class="text-xs text-muted-foreground">{{ t("updates.webOnly") }}</p>
    <p v-else-if="updates.status && !updates.status.supported" class="text-xs text-muted-foreground">
      {{ t("updates.manualOnly") }}
    </p>
    <p v-else-if="updates.status?.ready" class="text-xs text-muted-foreground">{{ t("updates.ready") }}</p>
    <p v-if="updates.isDownloading" class="text-sm">
      {{ t("updates.downloading") }}{{ percent === null ? "" : ` ${percent}%` }}
    </p>
    <p v-if="updates.error" role="alert" class="text-sm text-destructive">{{ t(updates.error) }}</p>
    <details v-if="updates.error && updates.errorDetail && !compact" class="text-xs text-muted-foreground">
      <summary>{{ t("updates.errorDetails") }}</summary>
      <p class="mt-2 break-words">{{ updates.errorDetail }}</p>
    </details>
    <div class="flex flex-wrap gap-2">
      <button
        v-if="isDesktop && !compact"
        type="button"
        class="ui-button"
        :disabled="updates.isBusy"
        @click="updates.check"
      >
        {{ t(updates.isChecking ? "updates.checking" : "updates.check") }}
      </button>
      <button
        v-if="updates.status?.supported && updates.status.availableVersion"
        type="button"
        class="ui-button"
        :disabled="updates.isBusy"
        @click="updates.status.ready ? updates.install() : updates.download()"
      >
        {{ t(updates.status.ready ? "updates.install" : "updates.download") }}
      </button>
      <button
        v-if="!compact || !updates.status?.supported"
        type="button"
        class="ui-button"
        :disabled="updates.isInstalling"
        @click="openExternalUrl(RELEASES_URL)"
      >
        {{ t("updates.downloadPage") }}
      </button>
    </div>
  </section>
</template>
