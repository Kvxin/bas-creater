import { defineEffect } from "@/core/effects";

export default defineEffect({
  id: "core.fade-in",
  apiVersion: 2,
  version: "1.0.0",
  category: "animation",
  title: { "zh-CN": "淡入", en: "Fade in", ja: "フェードイン" },
  description: { "zh-CN": "让弹幕从透明逐渐显现", en: "Gradually reveal the clip.", ja: "弾幕を徐々に表示します" },
  targets: ["text", "button", "path"],
  params: {
    percent: {
      type: "number",
      label: { "zh-CN": "淡入占片段（%）", en: "Fade length (%)", ja: "フェードの割合（%）" },
      default: 25,
      min: 1,
      max: 100,
      step: 1
    }
  },
  build({ params }) {
    const end = params.percent / 100;
    const opacityLimit = [
      { at: 0, value: 0 },
      { at: end, value: 1 }
    ];
    if (end < 1) opacityLimit.push({ at: 1, value: 1 });
    return { opacityLimit };
  }
});
