import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TimelineClip } from '@/types/timeline'

export const useClipDetailsStore = defineStore('clipDetails', () => {
  const visible = ref(false)
  const clip = ref<TimelineClip | null>(null)

  function open(targetClip: TimelineClip) {
    clip.value = targetClip
    visible.value = true
  }

  function close() {
    visible.value = false
    clip.value = null
  }

  return {
    visible,
    clip,
    open,
    close
  }
})
