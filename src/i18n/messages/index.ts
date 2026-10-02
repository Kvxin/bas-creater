import app from './app'
import audio from './audio'
import common from './common'
import danmu from './danmu'
import dialogs from './dialogs'
import menus from './menus'
import preview from './preview'
import properties from './properties'
import resources from './resources'
import timeline from './timeline'
import groups from './groups'

/**
 * Aggregates every namespace module into the per-locale message tree consumed
 * by `createI18n`.
 *
 * To add a namespace: create `src/i18n/messages/<name>.ts` (see common.ts for
 * the required shape) and add it to the three locale objects below.
 *
 * `MessageSchema` is derived from the zh-CN tree and is what makes `t()` keys
 * type-checked across the whole app (see the module augmentation in
 * `src/i18n/index.ts`), so the three locale trees must stay structurally
 * identical — the per-namespace `typeof zhCN` annotations already guarantee it.
 */
export const messages = {
  'zh-CN': {
    groups: groups['zh-CN'],
    common: common['zh-CN'],
    app: app['zh-CN'],
    danmu: danmu['zh-CN'],
    resources: resources['zh-CN'],
    properties: properties['zh-CN'],
    timeline: timeline['zh-CN'],
    preview: preview['zh-CN'],
    audio: audio['zh-CN'],
    menus: menus['zh-CN'],
    dialogs: dialogs['zh-CN'],
  },
  en: {
    groups: groups.en,
    common: common.en,
    app: app.en,
    danmu: danmu.en,
    resources: resources.en,
    properties: properties.en,
    timeline: timeline.en,
    preview: preview.en,
    audio: audio.en,
    menus: menus.en,
    dialogs: dialogs.en,
  },
  ja: {
    groups: groups.ja,
    common: common.ja,
    app: app.ja,
    danmu: danmu.ja,
    resources: resources.ja,
    properties: properties.ja,
    timeline: timeline.ja,
    preview: preview.ja,
    audio: audio.ja,
    menus: menus.ja,
    dialogs: dialogs.ja,
  },
}

export type MessageSchema = (typeof messages)['zh-CN']
