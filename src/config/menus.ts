import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useClipDetailsStore } from "@/stores/clipDetails";

/**
 * =============================================================================
 * 右键菜单配置中心 (Context Menu Configuration)
 * =============================================================================
 *
 * [如何添加新的菜单项?]
 * 1. 确定你要修改的区域 (Key).
 *    - 例如：要给“轨道头部”加按钮，请找到 MENU_REGISTRY['track-header']。
 *    - 例如：要给“时间轴背景”加按钮，请找到 MENU_REGISTRY['timeline-bg']。
 *
 * 2. 在对应的 `items` 数组中添加一个对象：
 *    {
 *      id: 'my-new-action',        // 唯一标识符
 *      labelKey: 'menus.myAction', // 显示的文字：i18n 消息键，取值必须是
 *                                  // src/i18n/messages/menus.ts 中已定义的键
 *      action: 'my.new.command'    // 对应的命令 Key (见下方 GLOBAL_COMMANDS)
 *    }
 *
 * 3. 注册命令逻辑 (可选)：
 *    - 如果这是一个全局通用的功能，请在文件底部的 `GLOBAL_COMMANDS` 对象中添加 'my.new.command' 的实现。
 *    - 如果这是一个特定组件的私有功能，请在组件调用 `contextMenu.show(...)` 时通过 `callbacks` 参数传入。
 *
 * *注意*: 本文件是模块级配置，在 import 时只执行一次，所以**不要在这里调用 t() 做翻译**，
 * 否则菜单文案会被冻结在启动时的语言。这里只存消息键 (labelKey)，统一由
 * `GlobalContextMenu.vue` 在渲染时用 `t(labelKey)` 实时翻译。
 * 通用动词 (复制 / 剪切 / 粘贴 / 删除 / 重命名 / 查看详情) 请直接复用 `common.*`。
 *
 * [分组标签]
 * `MenuConfig.labelKey` 是可选的分组标签，同样存消息键 (例如 'menus.clipActions')；
 * 不显示分组标签的区域直接省略该字段即可。
 *
 * [文案键一览] 每个区域实际使用的译文键 (改文案时到 src/i18n/messages/ 里找)：
 *   track-header        : t('menus.trackDelete')
 *   timeline-clip       : t('menus.clipActions') / t('common.details') /
 *                         t('common.copy') / t('common.cut') / t('common.delete')
 *   timeline-audio-clip : t('menus.audioClipActions') / t('common.copy') /
 *                         t('common.cut') / t('common.delete')
 *   timeline-bg         : t('menus.timelineActions') / t('menus.addTrack') / t('common.paste')
 *   resource-item       : t('menus.resourceActions') / t('menus.addToTrack') /
 *                         t('common.rename') / t('common.delete')
 *   未知的菜单 id        : t('menus.undefined', { menuId })
 *
 * 在 MenuItem 中添加 `children` 属性可以实现二级或者三级菜单：
 * {
 *   id: 'more-actions',
 *   labelKey: 'menus.moreActions',
 *   children: [
 *     { id: 'sub-1', labelKey: 'menus.subA', action: 'sub.action.a' },
 *     { id: 'sub-2', labelKey: 'menus.subB', action: 'sub.action.b' }
 *   ]
 * }
 * *注意*: 目前的 `GlobalContextMenu.vue` 渲染器需要更新以支持递归渲染才能显示子菜单。
 * =============================================================================
 */

// 定义菜单项结构
export interface MenuItem {
  id: string;
  labelKey: string; // 显示文字对应的 i18n 消息键 (渲染时翻译，分隔线用空字符串)
  action?: string; // 要执行的命令键 (如果有子菜单，通常不需要 action)
  disabled?: boolean;
  separator?: boolean;
  class?: string;
  children?: MenuItem[]; // 支持嵌套菜单结构
}

export interface MenuConfig {
  labelKey?: string; // 可选的分组标签的 i18n 消息键 (例如 "menus.clipActions")
  items: MenuItem[];
}

// --- 1. 菜单定义 (结构) ---
export const MENU_REGISTRY: Record<string, MenuConfig> = {
  // 轨道列表相关右键菜单区域
  "track-header": {
    // 该区域当前不显示分组标签 (如需启用请添加 labelKey 并在 src/i18n/messages/menus.ts 中补键)
    items: [
      {
        id: "del",
        labelKey: "menus.trackDelete",
        action: "track.delete",
        class: "text-destructive",
      },
    ],
  },
  // 轨道列表中的片段右键菜单区域（弹幕片段）
  "timeline-clip": {
    labelKey: "menus.clipActions",
    items: [
      { id: "detail", labelKey: "common.details", action: "clip.viewDetails" },
      { id: "sep0", separator: true, labelKey: "" },
      { id: "copy", labelKey: "common.copy", action: "clip.copy" },
      { id: "cut", labelKey: "common.cut", disabled: true, action: "clip.cut" },
      { id: "sep2", separator: true, labelKey: "" },
      {
        id: "del",
        labelKey: "common.delete",
        action: "clip.delete",
        class: "text-destructive",
      },
    ],
  },
  // 音频片段右键菜单（不包含"查看详情"——仅弹幕适用）
  "timeline-audio-clip": {
    labelKey: "menus.audioClipActions",
    items: [
      { id: "copy", labelKey: "common.copy", action: "clip.copy" },
      { id: "cut", labelKey: "common.cut", disabled: true, action: "clip.cut" },
      { id: "sep2", separator: true, labelKey: "" },
      {
        id: "del",
        labelKey: "common.delete",
        action: "clip.delete",
        class: "text-destructive",
      },
    ],
  },
  // 轨道列表中的轨道背景右键菜单区域
  "timeline-bg": {
    labelKey: "menus.timelineActions",
    items: [
      { id: "add", labelKey: "menus.addTrack", action: "track.add" },
      { id: "paste", labelKey: "common.paste", action: "track.paste" },
    ],
  },
  // 弹幕资源区域的弹幕列表的右键菜单区域
  "resource-item": {
    labelKey: "menus.resourceActions",
    items: [
      { id: "add", labelKey: "menus.addToTrack", action: "resource.addToTrack" },
      { id: "rename", labelKey: "common.rename", action: "resource.rename" },
      { id: "sep2", separator: true, labelKey: "" },
      {
        id: "del",
        labelKey: "common.delete",
        action: "resource.delete",
        class: "text-destructive",
      },
    ],
  },
};

// --- 2. 全局命令处理程序 (逻辑) ---
// 这些直接使用 Stores。本地组件状态 (如 React refs) 可以通过 show() 中的 'callbacks' 参数进行覆盖。
export const GLOBAL_COMMANDS: Record<string, (data: any) => void> = {
  // 轨道命令
  "track.delete": (data) => {
    const store = useTimelineStore();
    store.removeTrack(data.id);
  },
  "track.add": () => {
    const store = useTimelineStore();
    store.addTrack();
  },

  // 片段命令
  "clip.viewDetails": (clip) => {
    const store = useClipDetailsStore();
    store.open(clip);
  },
  "clip.delete": (clip) => {
    const store = useTimelineStore();
    store.removeClip(clip.id);
  },
  "clip.copy": (clip) => {
    const store = useTimelineStore();
    store.copyClipToClipboard(clip);
    console.log("[命令] 复制片段:", clip?.name || clip?.id);
  },

  "track.paste": (data) => {
    const store = useTimelineStore();
    const trackId = data?.trackId;
    const time = data?.time ?? store.currentTime;
    if (!trackId) {
      console.warn("[命令] 粘贴失败：未指定目标轨道");
      return;
    }
    if (!store.hasClipboardClip()) {
      console.warn("[命令] 粘贴失败：剪贴板为空");
      return;
    }
    store.pasteClipFromClipboard(trackId, time);
  },

  // 资源命令
  "resource.addToTrack": (item) => {
    const store = useTimelineStore();
    const trackId = store.addTrack();
    store.addClip(item, trackId, 0);
  },
  "resource.delete": (item) => {
    // 默认全局删除
    const danmuStore = useDanmuStore();
    const timelineStore = useTimelineStore();

    danmuStore.remove(item.id);
    timelineStore.removeClipsByResourceId(item.id);
  },
  "resource.rename": (item) => {
    console.log("[命令] 重命名请求 (通常通过 override 在本地处理)", item);
  },
};
