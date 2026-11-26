import { defineEffect } from "@/core/effects";

export default defineEffect({
  id: "core.text-outline",
  apiVersion: 2,
  version: "1.0.0",
  category: "style",
  title: { "zh-CN": "文字描边", en: "Text outline", ja: "文字の縁取り" },
  description: {
    "zh-CN": "沿文字轮廓添加描边",
    en: "Outline the letters of a text clip.",
    ja: "文字の輪郭に縁を付けます"
  },
  targets: ["text"],
  params: {
    width: {
      type: "number",
      label: { "zh-CN": "描边宽度", en: "Stroke width", ja: "線幅" },
      default: 2,
      min: 0,
      max: 12,
      step: 0.5
    },
    color: { type: "color", label: { "zh-CN": "描边颜色", en: "Stroke color", ja: "縁の色" }, default: "#334155" }
  },
  build({ params }) {
    return { defStyle: { strokeWidth: params.width, strokeColor: Number.parseInt(params.color.slice(1), 16) } };
  }
});
