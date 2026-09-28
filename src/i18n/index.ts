import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages, type MessageSchema } from './messages'

/**
 * =============================================================================
 * vue-i18n setup
 * =============================================================================
 *
 * Composition API mode (`legacy: false`) on top of the official `vue-i18n`
 * package:
 *
 *   components / setup code : `import { useI18n } from 'vue-i18n'`
 *                             `const { t, locale } = useI18n()`
 *   stores, utils, config   : `import { i18n } from '@/i18n'`
 *                             `i18n.global.t('danmu.defaultText')`
 *
 * Message keys are type-checked: `MessageSchema` is derived from the zh-CN
 * namespace tree and registered as vue-i18n's `DefineLocaleMessage` below, so a
 * typo in `t('...')` fails `pnpm run type-check`. The reverse direction (all
 * locales defining the same keys) is enforced inside each namespace module by
 * annotating `en`/`ja` with `typeof zhCN`.
 *
 * Locale selection is persisted in localStorage and mirrored onto
 * `<html lang>` for accessibility and native controls.
 * =============================================================================
 */

export type Locale = 'zh-CN' | 'en' | 'ja'

export interface LocaleOption {
  /** BCP 47 tag used for `vue-i18n` and `<html lang>`. */
  value: Locale
  /** Name of the language written in that language. */
  label: string
}

export const SUPPORTED_LOCALES: readonly LocaleOption[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
]

/** Locale used when nothing matches, and the fallback for missing messages. */
export const FALLBACK_LOCALE: Locale = 'zh-CN'

const STORAGE_KEY = 'bas-locale'

const isLocale = (value: unknown): value is Locale =>
  SUPPORTED_LOCALES.some(option => option.value === value)

/** `zh-Hans-CN` -> `zh`, `en-GB` -> `en` (empty string when absent). */
const primarySubtag = (tag: string): string => tag.split('-')[0] ?? ''

/**
 * Priority: explicit user choice (localStorage) > browser languages > fallback.
 * Browser tags are matched exactly first, then by primary subtag so that
 * `zh-Hans-CN` or `en-GB` resolve to a supported locale.
 */
function detectLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (isLocale(stored)) return stored
    } catch {
      // Storage can be unavailable (private mode / blocked cookies): ignore.
    }
  }

  if (typeof navigator !== 'undefined') {
    const candidates = [navigator.language, ...(navigator.languages ?? [])]
    const exact = candidates.find(isLocale)
    if (exact) return exact

    for (const candidate of candidates) {
      const primary = candidate ? primarySubtag(candidate).toLowerCase() : ''
      if (!primary) continue
      const matched = SUPPORTED_LOCALES.find(
        option => primarySubtag(option.value).toLowerCase() === primary
      )
      if (matched) return matched.value
    }
  }

  return FALLBACK_LOCALE
}

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
}

export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(),
  fallbackLocale: FALLBACK_LOCALE,
  messages,
})

/** Writable global locale ref — `v-model` friendly for language switchers. */
export const locale = i18n.global.locale

/** Switch the active language and remember it for the next visit. */
export function setLocale(value: Locale): void {
  if (isLocale(value)) locale.value = value
}

// Keep storage and the document language in sync with the active locale.
// Created eagerly at module scope so it covers programmatic changes too.
watch(
  locale,
  value => {
    if (typeof document !== 'undefined') document.documentElement.lang = value
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Persisting is best effort: never break rendering over it.
    }
  },
  { immediate: true }
)
