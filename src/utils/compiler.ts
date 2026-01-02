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
      // 必需属性 (改为按需输出)
      if (resource.type === "text" && (resource as any).content !== undefined) {
        basCode += `    content = ${formatValue(
          "content",
          (resource as any).content
        )}
`;
      } else if (resource.type === "button" && (resource as any).text !== undefined) {
        basCode += `    text = ${formatValue("text", (resource as any).text)}
`;
      } else if (resource.type === "path" && (resource as any).d !== undefined) {
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
        if (val === undefined || val === null) return; // 跳过空值

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
        // 如果没有自定义动画，或者第一个动画不是 'set' (并行)，我们需要一个 'then set' 来显示它
        // 但是如果有 animations，我们将在下面处理
        if (!clip.animations || clip.animations.length === 0) {
           basCode += `then set ${varName} { alpha = ${targetAlpha} } 0s
`;
        } else {
             // 如果有动画，且第一个动画有延迟或者是 'then' 类型，我们需要先显示出来吗？
             // 实际上，如果第一个动画是 'set' 且 startDelay=0，它会与 "等待" 结束同时发生。
             // 但我们需要把 alpha 设回来。
             // 简单起见，我们总是添加一个瞬间的显示指令，除非动画明确处理了 alpha
             // 但这可能会冲突。
             // 更好的策略：如果 startSec > 0，我们已经把 def alpha = 0 了。
             // 如果第一个动画包含 alpha，那就用动画的。如果没有，我们需要显式显示。
             
             // 暂时保留旧逻辑：先显示出来。
             // 注意：这里的 0s 可能会导致瞬间闪烁如果后面紧接动画
             basCode += `then set ${varName} { alpha = ${targetAlpha} } 0s
`;
        }
      }

      // 3. 生成动画序列
      if (clip.animations && clip.animations.length > 0) {
          clip.animations.forEach(anim => {
              const cmd = anim.type === 'set' ? 'set' : 'then set';
              let propsStr = '';
              Object.entries(anim.properties).forEach(([k, v]) => {
                  const basKey = k === 'opacity' ? 'alpha' : k;
                  const val = formatValue(k, v);
                  if (val) propsStr += ` ${basKey} = ${val}`;
              });
              
              const durationStr = `${anim.duration / 1000}s`;
              
              // 对于 'set'，如果有 delay
              // BAS 语法：set object { ... } duration
              // 并没有直接的 "delay" 参数。
              // set 是并行启动的。如果需要 delay，通常是先 set {} delay then set ...
              // 或者使用 timeline 逻辑。
              // 这里简化处理：如果是 'set' 且有 delay，我们先插入一个空 set
              if (anim.type === 'set' && anim.delay && anim.delay > 0) {
                  // 这会产生并行线程
                  // set object {} delay
                  // then set object { ... } duration
                  basCode += `set ${varName} {} ${anim.delay / 1000}s
then set ${varName} {${propsStr} } ${durationStr}
`;
              } else {
                  basCode += `${cmd} ${varName} {${propsStr} } ${durationStr}
`;
              }
          });
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
