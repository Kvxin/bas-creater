import type { TimelineTrack, TimelineClip } from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";

/**
 * 将值格式化为 BAS 语法字符串
 */
const formatValue = (key: string, value: any): string => {
  if (value === undefined || value === null) return "";

  // 颜色处理: 16777215 -> 0xffffff
  if (key.toLowerCase().includes("color") && typeof value === "number") {
    return "0x" + value.toString(16).padStart(6, "0");
  }

  // 坐标处理: 假设 0-100 的数值代表百分比，除非显式带了 'px'
  if (
    (key === "x" || key === "y" || key === "fontSize") &&
    typeof value === "number"
  ) {
    return `${value}%`;
  }

  // 字符串加引号
  if (typeof value === "string") {
    // 简单的转义
    return `"${value.replace(/"/g, '"')}"`;
  }

  return String(value);
};

export const compileClipToBas = (clip: TimelineClip, resource: AnyDanmu): string => {
      // 生成合法的 BAS 变量名 (移除特殊字符)
      const varName = `obj_${clip.id.replace(/[^a-zA-Z0-9]/g, "_")}`;

      let basCode = "";

      // 1. 生成 DEF (定义)
      let defType = "text";
      if (resource.type === "button") defType = "button";
      if (resource.type === "path") defType = "path";

      // 2. 生成 SET (时间轴逻辑)
      const startSec = clip.startTime / 1000;
      const durationSec = clip.duration / 1000;
      // 计算总存活时间 = 开始时间 + 持续时间
      const totalDurationSec = startSec + durationSec;
      
      const targetAlpha = resource.opacity ?? 1;

      basCode += `def ${defType} ${varName} {
`;

      // --- 属性映射 ---
      // 必需属性
      if (resource.type === "text") {
        basCode += `    content = ${formatValue(
          "content",
          (resource as any).content
        )}
`;
      } else if (resource.type === "button") {
        basCode += `    text = ${formatValue("text", (resource as any).text)}
`;
      } else if (resource.type === "path") {
        basCode += `    d = ${formatValue("d", (resource as any).d)}
`;
      }

      // 通用属性 (遍历 resource 属性)
      // 排除列表：这些由 timeline 控制或有特殊逻辑
      const excludeKeys = [
        "id",
        "type",
        "name",
        "durationMs",
        "parentId",
        "content",
        "text",
        "d",
        // 如果有延迟开始，alpha/opacity 由 def 初始值和 set 动画控制，不在此处输出
        ...(startSec > 0 ? ["alpha", "opacity"] : []),
      ];

      Object.entries(resource).forEach(([key, val]) => {
        if (excludeKeys.includes(key)) return;

        const fmtVal = formatValue(key, val);
        if (fmtVal) {
          // BAS 使用 alpha 而不是 opacity
          const basKey = key === "opacity" ? "alpha" : key;
          basCode += `    ${basKey} = ${fmtVal}
`;
        }
      });

      // 显式设置 duration (BAS 需要秒)
      basCode += `    duration = ${totalDurationSec}s
`;

      // 如果有延迟，初始 alpha 设为 0
      if (startSec > 0) {
        basCode += `    alpha = 0
`;
      }

      basCode += `}
`;

      // 生成 SET (仅当需要延迟显示时)
      if (startSec > 0) {
        // 1. 等待 (保持 alpha = 0)
        basCode += `set ${varName} {} ${startSec}s
`;
        // 2. 显示 (恢复到目标透明度)
        basCode += `then set ${varName} { alpha = ${targetAlpha} } 0s
`;
      }
      
      return basCode;
};

export const compileTimelineToBas = (
  tracks: TimelineTrack[],
  resources: AnyDanmu[]
): string => {
  let basCode = "";

  tracks.forEach((track) => {
    if (!track.visible) return; // 忽略不可见轨道

    track.clips.forEach((clip) => {
      const resource = resources.find((r) => r.id === clip.resourceId);
      if (!resource) return;

      basCode += compileClipToBas(clip, resource);
      basCode += "\n";
    });
  });

  // 去除空行，避免 bas 解析器出错
  return basCode.replace(/^\s*[\r\n]/gm, "");
};
