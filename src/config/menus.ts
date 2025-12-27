import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";

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
 *      id: 'my-new-action',     // 唯一标识符
 *      label: '我的新功能',      // 显示的文字
 *      action: 'my.new.command' // 对应的命令 Key (见下方 GLOBAL_COMMANDS)
 *    }
 *
 * 3. 注册命令逻辑 (可选)：
 *    - 如果这是一个全局通用的功能，请在文件底部的 `GLOBAL_COMMANDS` 对象中添加 'my.new.command' 的实现。
 *    - 如果这是一个特定组件的私有功能，请在组件调用 `contextMenu.show(...)` 时通过 `callbacks` 参数传入。
 *
 * 在 MenuItem 中添加 `children` 属性可以实现二级或者三级菜单：
 * {
 *   id: 'more-actions',
 *   label: '更多操作...',
 *   children: [
 *     { id: 'sub-1', label: '子选项 A', action: 'sub.action.a' },
 *     { id: 'sub-2', label: '子选项 B', action: 'sub.action.b' }
 *   ]
 * }
 * *注意*: 目前的 `GlobalContextMenu.vue` 渲染器需要更新以支持递归渲染才能显示子菜单。
 * =============================================================================
 */

// 定义菜单项结构
export interface MenuItem {
  id: string;
  label: string;
  action?: string; // 要执行的命令键 (如果有子菜单，通常不需要 action)
  disabled?: boolean;
  separator?: boolean;
  class?: string;
  children?: MenuItem[]; // 支持嵌套菜单结构
}

export interface MenuConfig {
  label?: string; // 可选的分组标签 (例如 "轨道操作")
  items: MenuItem[];
}

// --- 1. 菜单定义 (结构) ---
export const MENU_REGISTRY: Record<string, MenuConfig> = {
  "track-header": {
    // label: "轨道操作",
    items: [
      {
        id: "del",
        label: "删除轨道",
        action: "track.delete",
        class: "text-destructive",
      },
    ],
  },
  "timeline-clip": {
    label: "片段操作",
    items: [
      { id: "copy", label: "复制", action: "clip.copy" },
      { id: "cut", label: "剪切", disabled: true, action: "clip.cut" },
      { id: "sep2", separator: true, label: "" },
      {
        id: "del",
        label: "删除",
        action: "clip.delete",
        class: "text-destructive",
      },
    ],
  },
  "timeline-bg": {
    label: "时间轴",
    items: [
      { id: "add", label: "添加轨道", action: "track.add" },
      { id: "paste", label: "粘贴", disabled: true, action: "track.paste" },
    ],
  },
  "resource-item": {
    label: "资源操作",
    items: [
      { id: "add", label: "添加到轨道", action: "resource.addToTrack" },
      { id: "rename", label: "重命名", action: "resource.rename" },
      { id: "sep2", separator: true, label: "" },
      {
        id: "del",
        label: "删除",
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
  "clip.delete": (clip) => {
    const store = useTimelineStore();
    store.removeClip(clip.id);
  },
  "clip.copy": (clip) => {
    console.log("[命令] 复制片段:", clip);
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
