import { defineStore } from "pinia";

export type DanmakuType = "text" | "path" | "button";

export interface DanmakuItem {
  id: string;
  name: string;
  type: DanmakuType;
  start: number;
  duration: number;
}

export const DANMAKU_TYPE_LABELS: Record<DanmakuType, string> = {
  text: "文本弹幕",
  path: "路径弹幕",
  button: "按钮弹幕",
};

const DEFAULT_DURATION = 4;
const DEFAULT_GAP = 1;

export const useDanmakuStore = defineStore("danmaku", {
  state: () => ({
    danmakus: [] as DanmakuItem[],
    nextId: 1,
  }),
  getters: {
    timelineData(state) {
      const types = Object.keys(DANMAKU_TYPE_LABELS) as DanmakuType[];
      const tracks = types
        .map((type) => {
          const clips = state.danmakus
            .filter((item) => item.type === type)
            .map((item) => ({
              id: item.id,
              name: item.name,
              start: item.start,
              duration: item.duration,
              type,
            }));

          return {
            id: `danmaku-track-${type}`,
            type,
            label: DANMAKU_TYPE_LABELS[type],
            clips,
          };
        })
        .filter((track) => track.clips.length > 0);

      return {
        tracks,
      };
    },
    danmakuResources(state) {
      return state.danmakus.map((item) => ({
        id: item.id,
        name: item.name,
        size: `类型：${DANMAKU_TYPE_LABELS[item.type]}`,
        duration: `持续：${item.duration.toFixed(1)}s`,
        startLabel: `开始：${item.start.toFixed(1)}s`,
      }));
    },
  },
  actions: {
    addDanmaku(payload: { name: string; type: DanmakuType }): boolean {
      const trimmedName = payload.name.trim();
      if (!trimmedName) return false;

      const exists = this.danmakus.some(
        (item) => item.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (exists) return false;

      const siblings = this.danmakus.filter(
        (item) => item.type === payload.type
      );
      const lastSibling = siblings[siblings.length - 1];
      const start = lastSibling
        ? lastSibling.start + lastSibling.duration + DEFAULT_GAP
        : 0;
      const duration = DEFAULT_DURATION;
      const id = `danmaku-${this.nextId++}`;

      this.danmakus.push({
        id,
        name: trimmedName,
        type: payload.type,
        start,
        duration,
      });

      return true;
    },
    reset() {
      this.danmakus = [];
      this.nextId = 1;
    },
  },
});
