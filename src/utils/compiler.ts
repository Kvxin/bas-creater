import type {
  AnimationSegment,
  TimelineClip,
  TimelineKeyframeProperties,
  TimelineTrack,
} from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import {
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
} from "@/utils/keyframes";

const formatValue = (key: string, value: unknown): string => {
  if (value === undefined || value === null) return "";

  if (key.toLowerCase().includes("color") && typeof value === "number") {
    return "0x" + value.toString(16).padStart(6, "0");
  }

  if (typeof value === "string") {
    if (
      (key === "x" || key === "y" || key === "fontSize" || key === "width" || key === "height") &&
      value.trim().endsWith("%")
    ) {
      return value.trim();
    }
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  return String(value);
};

const formatSeconds = (milliseconds: number) =>
  `${Number((Math.max(0, milliseconds) / 1000).toFixed(4))}s`;

const toBasKey = (key: string) => (key === "opacity" ? "alpha" : key);

const formatInlineProperties = (
  properties: Partial<AnyDanmu> | TimelineKeyframeProperties
) => {
  let propsStr = "";

  Object.entries(properties).forEach(([key, value]) => {
    const formatted = formatValue(key, value);
    if (!formatted) return;
    propsStr += ` ${toBasKey(key)} = ${formatted}`;
  });

  return propsStr;
};

const formatSetStatement = (
  command: "set" | "then set",
  varName: string,
  properties: Partial<AnyDanmu> | TimelineKeyframeProperties,
  durationMs: number
) => {
  const propsStr = formatInlineProperties(properties);
  const body = propsStr ? `{${propsStr} }` : "{}";
  return `${command} ${varName} ${body} ${formatSeconds(durationMs)}\n`;
};

const getDefType = (resource: AnyDanmu) => {
  if (resource.type === "button") return "button";
  if (resource.type === "path") return "path";
  return "text";
};

const appendResourceIdentity = (resource: AnyDanmu) => {
  if (resource.type === "text" && resource.content !== undefined) {
    return `    content = ${formatValue("content", resource.content)}\n`;
  }

  if (resource.type === "button" && resource.text !== undefined) {
    return `    text = ${formatValue("text", resource.text)}\n`;
  }

  if (resource.type === "path" && resource.d !== undefined) {
    return `    d = ${formatValue("d", resource.d)}\n`;
  }

  return "";
};

const compileDefinition = (clip: TimelineClip, resource: AnyDanmu) => {
  const varName = `obj_${clip.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const startSec = clip.startTime / 1000;
  const totalDurationSec = (clip.startTime + clip.duration) / 1000;
  const excludeKeys = new Set([
    "id",
    "type",
    "name",
    "durationMs",
    "parentId",
    "content",
    "text",
    "d",
    ...(startSec > 0 ? ["alpha", "opacity"] : []),
  ]);

  let basCode = `def ${getDefType(resource)} ${varName} {\n`;
  basCode += appendResourceIdentity(resource);

  Object.entries(resource).forEach(([key, val]) => {
    if (excludeKeys.has(key) || val === undefined || val === null) return;

    const formatted = formatValue(key, val);
    if (formatted) {
      basCode += `    ${toBasKey(key)} = ${formatted}\n`;
    }
  });

  basCode += `    duration = ${Number(totalDurationSec.toFixed(4))}s\n`;

  if (startSec > 0) {
    basCode += "    alpha = 0\n";
  }

  basCode += "}\n";
  return basCode;
};

const compileKeyframesToBas = (
  clip: TimelineClip,
  resource: AnyDanmu,
  varName: string
) => {
  const keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
  const targetAlpha = resource.opacity ?? 1;
  const startDelayMs = Math.max(0, clip.startTime);

  let basCode = "";
  let command: "set" | "then set" = "set";

  if (startDelayMs > 0) {
    basCode += formatSetStatement("set", varName, {}, startDelayMs);
    basCode += formatSetStatement("then set", varName, { opacity: targetAlpha }, 0);
    command = "then set";
  }

  let previousTimeMs = 0;
  keyframes.forEach((keyframe) => {
    const durationMs = Math.max(0, keyframe.timeMs - previousTimeMs);
    basCode += formatSetStatement(
      command,
      varName,
      pickKeyframePropertiesForResource(resource, keyframe.properties),
      durationMs
    );
    command = "then set";
    previousTimeMs = keyframe.timeMs;
  });

  const holdMs = Math.max(0, clip.duration - previousTimeMs);
  if (holdMs > 0 || basCode.length === 0) {
    basCode += formatSetStatement(command, varName, {}, holdMs);
  }

  return basCode;
};

const compileLegacyAnimationsToBas = (
  clip: TimelineClip,
  resource: AnyDanmu,
  varName: string,
  animations: AnimationSegment[]
) => {
  const targetAlpha = resource.opacity ?? 1;
  let basCode = "";

  if (clip.startTime > 0) {
    basCode += formatSetStatement("set", varName, {}, clip.startTime);
    basCode += formatSetStatement("then set", varName, { opacity: targetAlpha }, 0);
  }

  animations.forEach((animation) => {
    const command = animation.type === "set" ? "set" : "then set";

    if (animation.type === "set" && animation.delay && animation.delay > 0) {
      basCode += formatSetStatement("set", varName, {}, animation.delay);
      basCode += formatSetStatement(
        "then set",
        varName,
        animation.properties,
        animation.duration
      );
      return;
    }

    basCode += formatSetStatement(command, varName, animation.properties, animation.duration);
  });

  return basCode;
};

export const compileClipToBas = (clip: TimelineClip, resource: AnyDanmu): string => {
  const varName = `obj_${clip.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
  const legacyAnimations = clip.animations ?? [];

  let basCode = compileDefinition(clip, resource);

  if (keyframes.length > 0) {
    basCode += compileKeyframesToBas(clip, resource, varName);
    return basCode;
  }

  if (legacyAnimations.length > 0) {
    basCode += compileLegacyAnimationsToBas(clip, resource, varName, legacyAnimations);
    return basCode;
  }

  if (clip.startTime > 0) {
    const targetAlpha = resource.opacity ?? 1;
    basCode += formatSetStatement("set", varName, {}, clip.startTime);
    basCode += formatSetStatement("then set", varName, { opacity: targetAlpha }, 0);
    basCode += formatSetStatement("then set", varName, {}, clip.duration);
  } else {
    basCode += formatSetStatement("set", varName, {}, clip.duration);
  }

  return basCode;
};

export const compileTimelineToBas = (
  tracks: TimelineTrack[],
  resources: AnyDanmu[]
): string => {
  let basCode = "";

  tracks.forEach((track) => {
    if (!track.visible) return;

    track.clips.forEach((clip) => {
      const resource = resources.find((r) => r.id === clip.resourceId);
      if (!resource) return;

      basCode += compileClipToBas(clip, resource);
      basCode += "\n";
    });
  });

  return basCode.replace(/^\s*[\r\n]/gm, "");
};
