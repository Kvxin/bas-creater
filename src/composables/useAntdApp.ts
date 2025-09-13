import { inject } from 'vue'
import { AntdAppKey } from '@/plugins/antd-app'

export function useAntdApp() {
  const api = inject<any>(AntdAppKey)
  if (!api) throw new Error('useAntdApp() must be used under <AntApp> and <AntdAppProvider>')
  return api
}

