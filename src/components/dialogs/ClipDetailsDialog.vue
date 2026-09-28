<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Check } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useClipDetailsStore } from '@/stores/clipDetails'
import { useTimelineStore } from '@/stores/timeline'
import { useDanmuStore } from '@/stores/danmu'
import { compileClipToBas } from '@/utils/compiler'
import { resolveDanmuDefaults } from '@/utils/danmuDefaults'

const { t } = useI18n()

const store = useClipDetailsStore()
const timelineStore = useTimelineStore()
const danmuStore = useDanmuStore()

const currentClip = computed(() => store.clip)
const currentResource = computed(() => {
  if (!currentClip.value) return null
  return danmuStore.danmus.find(r => r.id === currentClip.value?.resourceId)
})
const resolvedCurrentResource = computed(() => {
  if (!currentResource.value) return null
  return resolveDanmuDefaults(currentResource.value)
})
const resolvedResourceColor = computed(() => {
  const resource = resolvedCurrentResource.value
  if (!resource) return undefined
  if (resource.type === 'text') return resource.color
  if (resource.type === 'button') return resource.textColor
  return resource.fillColor
})

const generatedCode = computed(() => {
  if (!currentClip.value || !currentResource.value) return ''
  return compileClipToBas(currentClip.value, currentResource.value)
})

const copied = ref(false)
const handleCopy = async () => {
  if (!generatedCode.value) return
  try {
    await navigator.clipboard.writeText(generatedCode.value)
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

const handleOpenChange = (open: boolean) => {
  if (!open) store.close()
}

// Helpers
const updateResource = (key: string, val: any) => {
    if(!currentResource.value) return
    danmuStore.updateDanmu(currentResource.value.id, { [key]: val })
}
const updateClip = (key: string, val: any) => {
    if(!currentClip.value) return
    timelineStore.updateClip(currentClip.value.id, { [key]: Number(val) })
}

const updateResourceColor = (val: string | number) => {
    if(!currentResource.value) return
    const key = currentResource.value.type === 'text'
        ? 'color'
        : currentResource.value.type === 'button'
          ? 'textColor'
          : 'fillColor'
    updateResource(key, val)
}
</script>

<template>
  <Dialog :open="store.visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-[800px]">
      <DialogHeader>
        <DialogTitle>{{ t('dialogs.title') }}</DialogTitle>
      </DialogHeader>
      
      <div class="grid grid-cols-2 gap-6 py-4">
        <!-- Left: Code Preview -->
        <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
                <Label>{{ t('dialogs.codePreview') }}</Label>
                <button 
                    @click="handleCopy"
                    class="p-1 hover:bg-muted-foreground/10 rounded-md transition-colors cursor-pointer"
                    :title="t('dialogs.copyCode')"
                >
                    <Check v-if="copied" class="w-4 h-4 text-green-500" />
                    <Copy v-else class="w-4 h-4 text-muted-foreground" />
                </button>
            </div>
            <div class="flex-1 bg-muted p-4 rounded-md font-mono text-xs whitespace-pre overflow-auto h-[400px] border border-border">
                {{ generatedCode }}
            </div>
        </div>

        <!-- Right: Properties Editor -->
        <div class="flex flex-col gap-4 h-[400px] overflow-y-auto pr-2">
            <div v-if="currentClip && currentResource">
                
                <h3 class="font-semibold text-sm mb-2 text-primary">{{ t('dialogs.clipSection') }}</h3>
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="space-y-1">
                        <Label>{{ t('dialogs.startTime') }}</Label>
                        <Input type="number" :model-value="currentClip.startTime" @update:model-value="v => updateClip('startTime', v)" />
                    </div>
                    <div class="space-y-1">
                        <Label>{{ t('dialogs.duration') }}</Label>
                        <Input type="number" :model-value="currentClip.duration" @update:model-value="v => updateClip('duration', v)" />
                    </div>
                </div>

                <h3 class="font-semibold text-sm mb-2 text-primary">{{ t('dialogs.resourceSection') }}</h3>
                <div class="space-y-4">
                    <!-- ID / Name -->
                     <div class="space-y-1">
                        <Label>{{ t('dialogs.alias') }}</Label>
                        <Input :model-value="currentResource.name" @update:model-value="v => updateResource('name', v)" />
                    </div>
                    
                    <!-- Content based on type -->
                    <div v-if="currentResource.type === 'text'" class="space-y-1">
                        <Label>{{ t('dialogs.content') }}</Label>
                        <Input :model-value="(resolvedCurrentResource as any)?.content" @update:model-value="v => updateResource('content', v)" />
                    </div>
                    <div v-if="currentResource.type === 'button'" class="space-y-1">
                        <Label>{{ t('dialogs.text') }}</Label>
                        <Input :model-value="(resolvedCurrentResource as any)?.text" @update:model-value="v => updateResource('text', v)" />
                    </div>

                    <!-- Position -->
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1">
                            <Label>{{ t('dialogs.x') }}</Label>
                            <Input :model-value="resolvedCurrentResource?.x" @update:model-value="v => updateResource('x', isNaN(Number(v)) ? v : Number(v))" />
                        </div>
                         <div class="space-y-1">
                            <Label>{{ t('dialogs.y') }}</Label>
                            <Input :model-value="resolvedCurrentResource?.y" @update:model-value="v => updateResource('y', isNaN(Number(v)) ? v : Number(v))" />
                        </div>
                    </div>

                     <!-- Style -->
                    <div class="grid grid-cols-2 gap-4">
                         <div v-if="currentResource.type === 'text' || currentResource.type === 'button'" class="space-y-1">
                            <Label>{{ t('dialogs.fontSize') }}</Label>
                             <Input :model-value="(resolvedCurrentResource as any)?.fontSize" @update:model-value="v => updateResource('fontSize', isNaN(Number(v)) ? v : Number(v))" />
                        </div>
                        <div v-if="currentResource.type === 'text'" class="space-y-1">
                             <Label>{{ t('dialogs.opacity') }}</Label>
                             <Input type="number" step="0.1" min="0" max="1" :model-value="resolvedCurrentResource?.opacity ?? 1" @update:model-value="v => updateResource('opacity', Number(v))" />
                        </div>
                    </div>
                    
                     <div class="grid grid-cols-2 gap-4">
                         <div class="space-y-1">
                            <Label>{{ t('dialogs.color') }}</Label>
                            <Input :model-value="resolvedResourceColor" @update:model-value="updateResourceColor" placeholder="0xFFFFFF" />
                        </div>
                    </div>
                </div>

            </div>
            <div v-else class="text-muted-foreground text-sm">
                {{ t('dialogs.loadFailed') }}
            </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
