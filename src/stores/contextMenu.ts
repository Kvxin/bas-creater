import { defineStore } from 'pinia'
import { ref } from 'vue'
import { GLOBAL_COMMANDS } from '@/config/menus'

export interface ContextMenuOptions {
  menuId: string
  x: number
  y: number
  data?: any
  callbacks?: Record<string, (data?: any) => void>
}

export const useContextMenuStore = defineStore('contextMenu', () => {
  const visible = ref(false)
  const position = ref({ x: 0, y: 0 })
  const menuId = ref<string>('')
  const data = ref<any>(null)
  const callbacks = ref<Record<string, (data?: any) => void>>({})

  function show(event: MouseEvent, id: string, contextData?: any, actionCallbacks?: Record<string, (data?: any) => void>) {
    event.preventDefault()
    event.stopPropagation()
    
    menuId.value = id
    data.value = contextData
    callbacks.value = actionCallbacks || {}
    position.value = { x: event.clientX, y: event.clientY }
    visible.value = true
  }

  function hide() {
    visible.value = false
  }

  function execute(action: string) {
    // 1. 尝试执行本地回调 (覆盖)
    if (callbacks.value[action]) {
      callbacks.value[action](data.value)
    } 
    // 2. 执行全局命令
    else if (GLOBAL_COMMANDS[action]) {
      GLOBAL_COMMANDS[action](data.value)
    }
    else {
      console.warn(`[ContextMenu] 未找到操作的处理程序: ${action}`)
    }
    hide()
  }

  return {
    visible,
    position,
    menuId,
    data,
    show,
    hide,
    execute
  }
})
