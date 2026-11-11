<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useDark } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { ArrowDown, Grid2X2, List, MessageSquareText, Plus, Search, Settings } from "lucide-vue-next";
import WindowControls from "@/components/editor/WindowControls.vue";
import SettingsView from "@/views/SettingsView.vue";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTitleBarDrag } from "@/composables/useTitleBarDrag";
import { createProject, createFolderProject, createDesktopFolderProject, deleteProject, getProjectLocationLabel, listProjectBackups, restoreProjectBackup, openSelectedProjectDirectory, listProjects, prepareProjectOpen } from "@/services/storage/projectStorage";
import { pickDesktopDirectory } from "@/services/storage/desktopProjectFile";
import { pickProjectDirectory } from "@/services/storage/browserProjectFile";
import type { BasProjectData } from "@/types/storage";
import { isDesktopApp, isMacOS } from "@/utils/desktop";

const emit = defineEmits<{ open: [id: string] }>();
const { t, locale } = useI18n();
const isDark = useDark({ initialValue: "dark" });
const isDesktop = isDesktopApp();
const hasControls = isDesktop && !isMacOS();
const titleBarListeners = isDesktop ? useTitleBarDrag() : {};
const projects = ref<BasProjectData[]>([]);
const search = ref("");
const selected = ref<string[]>([]);
const view = ref<"grid" | "list">("grid");
const descending = ref(true);
const isLoading = ref(true);
const error = ref("");
const isCreating = ref(false);
const isCreateOpen = ref(false);
const isSettingsOpen = ref(false);
const isRemoveOpen = ref(false);
const backupProjectId = ref("");
const backupNames = ref<string[]>([]);
const isBackupOpen = ref(false);
const deleteDiskFiles = ref(false);
const removeLocations = ref<Record<string, string>>({});
const name = ref("");
const directory = ref<FileSystemDirectoryHandle | null>(null);
const desktopDirectory = ref<string | null>(null);
const supportsFolder = isDesktop || "showDirectoryPicker" in window;
const filtered = computed(() => projects.value.filter((project) => project.name.toLowerCase().includes(search.value.trim().toLowerCase()))
  .sort((a, b) => descending.value ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt));
const allSelected = computed(() => filtered.value.length > 0 && filtered.value.every((p) => selected.value.includes(p.id)));
const formatDate = (timestamp: number) => new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "short", day: "numeric" }).format(timestamp);
const refresh = async () => {
  isLoading.value = true;
  error.value = "";
  try { projects.value = await listProjects(); }
  catch (cause) { console.error("[Projects] Failed to load", cause); error.value = t("projects.listFailed"); }
  finally { isLoading.value = false; }
};
onMounted(refresh);
const showCreate = () => { name.value = ""; directory.value = null; desktopDirectory.value = null; isCreateOpen.value = true; };
const selectDirectory = async () => {
  try { if (isDesktop) desktopDirectory.value = await pickDesktopDirectory(); else directory.value = await pickProjectDirectory(); }
  catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) { console.error(cause); window.alert(t("projects.folderFailed")); } }
};
const openExisting = async () => {
  try {
    const chosen = isDesktop ? await pickDesktopDirectory() : await pickProjectDirectory();
    if (!chosen) return;
    const project = await openSelectedProjectDirectory(chosen);
    emit("open", project.id);
  } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) { console.error(cause); window.alert(t("projects.openFailed")); } }
};
const open = async (id: string) => {
  try { await prepareProjectOpen(id); emit("open", id); }
  catch (cause) { console.error("[Projects] Failed to open", cause); window.alert(t("projects.openFailed")); }
};
const create = async () => {
  const projectName = name.value.trim();
  if (!projectName || isCreating.value || (supportsFolder && !(isDesktop ? desktopDirectory.value : directory.value))) return;
  isCreating.value = true;
  try {
    const trackName = t("timeline.defaultTrackName", { n: 1 });
    const project = desktopDirectory.value ? await createDesktopFolderProject(projectName, trackName, desktopDirectory.value) : directory.value ? await createFolderProject(projectName, trackName, directory.value) : await createProject(projectName, trackName);
    isCreateOpen.value = false;
    emit("open", project.id);
  } catch (cause) { console.error("[Projects] Failed to create", cause); window.alert(t("projects.createFailed")); }
  finally { isCreating.value = false; }
};
const showBackups = async (id: string) => {
  try { backupNames.value = await listProjectBackups(id); backupProjectId.value = id; isBackupOpen.value = true; }
  catch (cause) { console.error(cause); window.alert(t("projects.backupFailed")); }
};
const restoreBackup = async (name: string) => {
  if (!window.confirm(t("projects.confirmRestore"))) return;
  try { await restoreProjectBackup(backupProjectId.value, name); isBackupOpen.value = false; await refresh(); }
  catch (cause) { console.error(cause); window.alert(t("projects.backupFailed")); }
};
const toggleAll = () => {
  const ids = new Set(filtered.value.map((p) => p.id));
  selected.value = allSelected.value ? selected.value.filter((id) => !ids.has(id)) : Array.from(new Set([...selected.value, ...ids]));
};
const removeSelected = async () => {
  if (!selected.value.length) return;
  const locations = await Promise.all(selected.value.map(async (id) => [id, await getProjectLocationLabel(id)] as const));
  removeLocations.value = Object.fromEntries(locations.map(([id, path]) => [id, path || t("projects.storedInternally")]));
  deleteDiskFiles.value = false;
  isRemoveOpen.value = true;
};
const confirmRemove = async () => {
  if (deleteDiskFiles.value && !window.confirm(t("projects.confirmFileDelete"))) return;
  try {
    for (const id of [...selected.value]) { await deleteProject(id, deleteDiskFiles.value); selected.value = selected.value.filter((item) => item !== id); }
    isRemoveOpen.value = false;
    await refresh();
  } catch (cause) { console.error("[Projects] Failed to delete", cause); window.alert(t("projects.deleteFailed")); await refresh(); }
};
</script>

<template>
  <div class="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground font-sans" data-ui="projects-shell">
    <header v-if="isDesktop" class="dark h-[3.4rem] shrink-0 flex items-center justify-between border-b border-border pl-3 select-none" :class="{ 'pl-[5.5rem]': isMacOS(), 'pr-3': !hasControls }" v-on="titleBarListeners" data-ui="title-bar">
      <span class="text-sm font-medium">DanmakuCut</span>
      <div class="h-full flex items-center gap-2">
        <button class="size-8 flex items-center justify-center rounded-sm hover:bg-accent" :title="t('app.settings')" :aria-label="t('app.settings')" @click="isSettingsOpen = !isSettingsOpen"><Settings class="size-4" /></button>
        <WindowControls v-if="hasControls" />
      </div>
    </header>
    <SettingsView v-if="isSettingsOpen" v-model:is-dark="isDark" @close="isSettingsOpen = false" />
    <main v-else class="flex-1 overflow-y-auto px-5 sm:px-9">
      <div class="min-h-[76px] flex flex-wrap items-center justify-between gap-3 py-3">
        <div class="flex items-center gap-5">
          <h1 class="text-sm font-semibold">{{ t("projects.title") }}</h1>
          <div class="flex gap-0.5 rounded-md border border-border p-1" :aria-label="t('projects.title')">
            <button class="size-8 rounded-sm flex items-center justify-center" :class="view === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'" :aria-label="t('projects.grid')" :aria-pressed="view === 'grid'" @click="view = 'grid'"><Grid2X2 class="size-4" /></button>
            <button class="size-8 rounded-sm flex items-center justify-center" :class="view === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent'" :aria-label="t('projects.list')" :aria-pressed="view === 'list'" @click="view = 'list'"><List class="size-4" /></button>
          </div>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <label class="h-10 flex items-center gap-2 rounded-md border border-border px-3 text-muted-foreground"><Search class="size-4" /><input v-model="search" type="search" :aria-label="t('projects.search')" :placeholder="t('projects.search')" class="w-36 sm:w-48 bg-transparent text-foreground text-sm outline-none" /></label>
          <button v-if="supportsFolder" class="h-10 px-4 rounded-md border border-border text-sm hover:bg-accent" @click="openExisting">{{ t("projects.openExisting") }}</button>
          <button class="h-10 px-4 rounded-md bg-foreground text-background font-medium flex items-center gap-2 hover:opacity-90" @click="showCreate"><Plus class="size-4" />{{ t("projects.newProject") }}</button>
          <button v-if="!isDesktop" class="size-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent" :title="t('app.settings')" :aria-label="t('app.settings')" @click="isSettingsOpen = true"><Settings class="size-4" /></button>
        </div>
      </div>
      <div class="h-12 flex items-center justify-between border-b border-border text-muted-foreground text-xs">
        <div class="flex items-center gap-4"><label class="flex items-center gap-2"><input type="checkbox" :checked="allSelected" :disabled="!filtered.length" @change="toggleAll" />{{ t("projects.selectAll") }}</label><span class="h-4 border-l border-border"></span><button class="flex items-center gap-2 hover:text-foreground" @click="descending = !descending">{{ t("projects.modified") }} <ArrowDown class="size-3.5" :class="{ 'rotate-180': !descending }" /></button><button v-if="selected.length" class="text-destructive" @click="removeSelected">{{ t("projects.remove") }}</button></div>
        <span>{{ t("projects.count", { count: projects.length }) }}</span>
      </div>
      <p v-if="error" role="alert" class="mt-10 text-destructive">{{ error }}</p>
      <div v-else-if="!isLoading && !filtered.length" class="min-h-[430px] flex flex-col justify-center items-center text-center -translate-y-4">
        <div class="size-[70px] rounded-full bg-accent flex items-center justify-center text-muted-foreground mb-6"><MessageSquareText class="size-7" /></div>
        <h2 class="text-lg font-semibold">{{ search.trim() && projects.length ? t("projects.noResults") : t("projects.empty") }}</h2>
        <p class="mt-2 mb-6 text-sm text-muted-foreground">{{ search.trim() && projects.length ? t("projects.noResultsDescription") : t("projects.emptyDescription") }}</p>
        <button class="h-10 px-4 rounded-md bg-foreground text-background font-medium flex items-center gap-2 hover:opacity-90" @click="showCreate"><Plus class="size-4" />{{ t("projects.createFirst") }}</button>
      </div>
      <div v-else class="py-6" :class="view === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4' : 'flex flex-col'">
        <article v-for="project in filtered" :key="project.id" class="border border-border overflow-hidden hover:border-muted-foreground/60" :class="view === 'grid' ? 'rounded-lg' : 'flex border-x-0 border-t-0 items-center'">
          <div class="relative bg-accent flex justify-center items-center text-muted-foreground" :class="view === 'grid' ? 'h-36' : 'w-24 h-16 my-2 rounded-md shrink-0'">
            <input v-model="selected" type="checkbox" :value="project.id" :aria-label="`${t('projects.selectAll')}: ${project.name}`" class="absolute top-3 left-3" /><MessageSquareText class="size-8 opacity-60" />
          </div>
          <button class="m-2 p-2 text-xs text-muted-foreground hover:text-foreground" @click="showBackups(project.id)">{{ t("projects.backups") }}</button>
          <button class="p-4 text-left min-w-0 flex-1 w-full" @click="open(project.id)"><span class="block truncate font-medium">{{ project.name }}</span><span class="block mt-2 text-xs text-muted-foreground">{{ t("projects.modified") }} · {{ formatDate(project.updatedAt) }}</span></button>
        </article>
      </div>
    </main>
    <Dialog :open="isBackupOpen" @update:open="isBackupOpen = $event"><DialogContent class="sm:max-w-[520px]"><DialogHeader><DialogTitle>{{ t("projects.backups") }}</DialogTitle><DialogDescription>{{ t("projects.confirmRestore") }}</DialogDescription></DialogHeader><p v-if="!backupNames.length" class="text-sm text-muted-foreground">{{ t("projects.noBackups") }}</p><ul v-else class="max-h-64 overflow-auto space-y-2"><li v-for="name in backupNames" :key="name" class="flex items-center justify-between gap-3 text-sm"><span class="break-all">{{ name }}</span><button class="underline" @click="restoreBackup(name)">{{ t("projects.restoreBackup") }}</button></li></ul></DialogContent></Dialog>
    <Dialog :open="isRemoveOpen" @update:open="isRemoveOpen = $event">
      <DialogContent class="sm:max-w-[520px]">
        <DialogHeader><DialogTitle>{{ t("projects.removeTitle") }}</DialogTitle><DialogDescription>{{ t("projects.removeDescription") }}</DialogDescription></DialogHeader>
        <ul class="max-h-44 overflow-auto text-sm space-y-2"><li v-for="id in selected" :key="id" class="break-all"><strong>{{ projects.find(p => p.id === id)?.name }}</strong><br /><span class="text-muted-foreground">{{ removeLocations[id] }}</span></li></ul>
        <label class="flex gap-2 text-sm"><input v-model="deleteDiskFiles" type="radio" :value="false" />{{ t("projects.listOnly") }}</label>
        <label class="flex gap-2 text-sm"><input v-model="deleteDiskFiles" type="radio" :value="true" />{{ t("projects.deleteFiles") }}</label>
        <DialogFooter><button type="button" class="h-9 px-3 rounded-sm border border-border" @click="isRemoveOpen = false">{{ t("app.cancel") }}</button><button type="button" class="h-9 px-3 rounded-sm bg-destructive text-white" @click="confirmRemove">{{ t("projects.remove") }}</button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog :open="isCreateOpen" @update:open="isCreateOpen = $event"><DialogContent class="sm:max-w-[440px]"><DialogHeader><DialogTitle>{{ t("projects.createTitle") }}</DialogTitle><DialogDescription>{{ t("projects.createDescription") }}</DialogDescription></DialogHeader><form @submit.prevent="create"><Label for="project-name">{{ t("projects.name") }}</Label><Input id="project-name" v-model="name" class="mt-2" :placeholder="t('projects.placeholder')" maxlength="60" required /><div v-if="supportsFolder" class="mt-4"><button type="button" class="h-9 px-3 rounded-sm border border-border hover:bg-accent" @click="selectDirectory">{{ t("projects.selectFolder") }}</button><span class="ml-3 text-muted-foreground">{{ desktopDirectory || directory?.name || t("projects.emptyFolder") }}</span></div><DialogFooter class="mt-6"><button type="button" class="h-9 px-3 rounded-sm border border-border hover:bg-accent" @click="isCreateOpen = false">{{ t("app.cancel") }}</button><button type="submit" :disabled="isCreating || !name.trim() || (supportsFolder && !(isDesktop ? desktopDirectory : directory))" class="h-9 px-3 rounded-sm bg-foreground text-background disabled:opacity-50">{{ t("projects.create") }}</button></DialogFooter></form></DialogContent></Dialog>
  </div>
</template>
