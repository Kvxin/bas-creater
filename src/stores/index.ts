// 导出所有 stores
export { useCounterStore } from './counter'

// 导出 modules 中的所有 stores
export * from './modules'

// 如果需要，可以创建一个组合所有 stores 的函数
import { useThemeStore } from './modules/theme'
import { useCounterStore } from './counter'

export function useStores() {
  return {
    theme: useThemeStore(),
    counter: useCounterStore()
  }
}
