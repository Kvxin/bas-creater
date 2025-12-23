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
  if ((key === "x" || key === "y" || key === "fontSize") && typeof value === "number") {
    return `${value}%`;
  }

  // 字符串加引号
  if (typeof value === "string") {
    // 简单的转义
    return `"${value.replace(/"/g, '\"')}"`;
  }

  return String(value);
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

      // 生成合法的 BAS 变量名 (移除特殊字符)
      const varName = `obj_${clip.id.replace(/[^a-zA-Z0-9]/g, "_")}`;

      // 1. 生成 DEF (定义)
      let defType = "text";
      if (resource.type === "button") defType = "button";
      if (resource.type === "path") defType = "path";

      // 计算总存活时间 = 开始时间 + 持续时间 + 这里的缓冲区(可选)
      const totalDurationSec = (clip.startTime + clip.duration) / 1000;

      basCode += `def ${defType} ${varName} {
`;

      // --- 属性映射 ---
      // 必需属性
      if (resource.type === "text") {
        basCode += `    content = ${formatValue("content", (resource as any).content)}
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
      const excludeKeys = ["id", "type", "name", "durationMs", "parentId", "content", "text", "d"];
      
      Object.entries(resource).forEach(([key, val]) => {
        if (excludeKeys.includes(key)) return;
        // alpha 特殊处理：初始设为 0
        if (key === "opacity" || key === "alpha") return; 
        
        const fmtVal = formatValue(key, val);
        if (fmtVal) {
           // BAS 使用 alpha 而不是 opacity
           const basKey = key === 'opacity' ? 'alpha' : key;
           basCode += `    ${basKey} = ${fmtVal}
`;
        }
      });

      // 强制覆盖属性
      basCode += `    duration = ${totalDurationSec}s
`;
      basCode += `    alpha = 0
`; // 初始隐藏

      basCode += `}
`;

      // 2. 生成 SET (时间轴逻辑)
      const startSec = clip.startTime / 1000;
      const durationSec = clip.duration / 1000;
      const targetAlpha = resource.opacity ?? 1;

      // 阶段1: 等待开始 (Pre-wait)
      if (startSec > 0) {
        basCode += `set ${varName} {} ${startSec}s
`;
        basCode += `then set ${varName} { alpha = ${targetAlpha} } 0s
`;
      } else {
        // 如果 start=0，直接出现
        basCode += `set ${varName} { alpha = ${targetAlpha} } 0s
`;
      }

      // 阶段2: 持续显示 (Hold)
      // 如果有入场动画，这里需要拆分，目前仅做静态显示
      if (durationSec > 0) {
          basCode += `then set ${varName} {} ${durationSec}s
`;
      }

      // 阶段3: 消失 (End)
      // 可以在最后加一个 alpha=0 确保消失，或者依赖 duration 自动销毁
      // 为了平滑，我们在 duration 结束时设为 alpha 0 (0s 动画)
      basCode += `then set ${varName} { alpha = 0 } 0s\n`;

      basCode += "\n";
    });
  });

  // 去除空行，避免 bas 解析器出错
  return basCode.replace(/^\s*[\r\n]/gm, "");
};
