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
import { isDanmuFieldBasDefault } from "@/utils/danmuDefaults";

const PERCENTAGE_VALUE_KEYS = new Set(["x", "y", "fontSize", "width", "height"]);

const NUMERIC_VALUE_KEYS = new Set([
  "x",
  "y",
  "zIndex",
  "scale",
  "opacity",
  "alpha",
  "anchorX",
  "anchorY",
  "fontSize",
  "bold",
  "textShadow",
  "strokeWidth",
  "rotateX",
  "rotateY",
  "rotateZ",
  "textAlpha",
  "fillAlpha",
  "borderWidth",
  "borderAlpha",
  "width",
  "height",
]);

const COLOR_VALUE_KEYS = new Set([
  "color",
  "strokeColor",
  "textColor",
  "fillColor",
  "borderColor",
]);

const DEFINITION_FIELDS_BY_TYPE: Record<AnyDanmu["type"], readonly string[]> = {
  text: [
    "x",
    "y",
    "zIndex",
    "scale",
    "opacity",
    "color",
    "anchorX",
    "anchorY",
    "fontSize",
    "fontFamily",
    "bold",
    "textShadow",
    "strokeWidth",
    "strokeColor",
    "rotateX",
    "rotateY",
    "rotateZ",
    "parentId",
  ],
  button: [
    "x",
    "y",
    "zIndex",
    "scale",
    "fontSize",
    "textColor",
    "textAlpha",
    "fillColor",
    "fillAlpha",
    "target",
  ],
  path: [
    "x",
    "y",
    "zIndex",
    "scale",
    "viewBox",
    "borderWidth",
    "borderColor",
    "borderAlpha",
    "fillColor",
    "fillAlpha",
    "width",
    "height",
  ],
};

const formatTargetValue = (value: unknown): string => {
  if (!value || typeof value !== "object") return "";

  const target = value as Record<string, unknown>;
  const type = "av" in target ? "av" : "bangumi" in target ? "bangumi" : null;
  if (!type) return "";

  const payload = target[type];
  if (!payload || typeof payload !== "object") return "";

  const lines = Object.entries(payload as Record<string, unknown>)
    .filter(([, item]) => item !== undefined && item !== null)
    .map(([key, item]) => {
      if (key === "timeMs" && typeof item === "number") {
        return `        time = ${Number((item / 1000).toFixed(4))}s`;
      }
      return `        ${key} = ${String(item)}`;
    });

  return `${type} {\n${lines.join("\n")}\n    }`;
};

const formatValue = (key: string, value: unknown): string => {
  if (value === undefined || value === null) return "";

  if (key === "target") return formatTargetValue(value);

  if (COLOR_VALUE_KEYS.has(key) && typeof value === "number") {
    return "0x" + value.toString(16).padStart(6, "0");
  }

  if (typeof value === "boolean") return value ? "1" : "0";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (COLOR_VALUE_KEYS.has(key)) {
      const shortHex = trimmed.match(/^#([\da-f]{3})$/i)?.[1];
      if (shortHex) {
        return `0x${shortHex
          .split("")
          .map((character) => character.repeat(2))
          .join("")}`;
      }
      if (/^#[\da-f]{6}$/i.test(trimmed)) return `0x${trimmed.slice(1)}`;
      if (/^0x[\da-f]+$/i.test(trimmed)) return trimmed;
      if (/^\d+$/.test(trimmed)) return trimmed;
    }
    if (
      NUMERIC_VALUE_KEYS.has(key) &&
      (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed) ||
        (PERCENTAGE_VALUE_KEYS.has(key) &&
          /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%$/i.test(trimmed)))
    ) {
      return trimmed;
    }
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  return String(value);
};

const formatSeconds = (milliseconds: number) =>
  `${Number((Math.max(0, milliseconds) / 1000).toFixed(4))}s`;

const toBasKey = (key: string) => {
  if (key === "opacity") return "alpha";
  if (key === "parentId") return "parent";
  return key;
};

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

export const compileDanmuDefinition = (
  resource: AnyDanmu,
  varName: string,
  durationMs: number,
  startTimeMs = 0
) => {
  const startSec = startTimeMs / 1000;
  const totalDurationSec = (startTimeMs + durationMs) / 1000;
  const rawResource = resource as unknown as Record<string, unknown>;

  let basCode = `def ${getDefType(resource)} ${varName} {\n`;
  basCode += appendResourceIdentity(resource);

  DEFINITION_FIELDS_BY_TYPE[resource.type].forEach((key) => {
    const value = rawResource[key];
    if (value === undefined || value === null) return;
    if (startSec > 0 && (key === "alpha" || key === "opacity")) return;
    if (isDanmuFieldBasDefault(resource, key, value)) return;

    const formatted = formatValue(key, value);
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

const compileDefinition = (clip: TimelineClip, resource: AnyDanmu) =>
  compileDanmuDefinition(
    resource,
    `obj_${clip.id.replace(/[^a-zA-Z0-9]/g, "_")}`,
    clip.duration,
    clip.startTime
  );

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
  let hasSerialRoot = false;

  if (clip.startTime > 0) {
    basCode += formatSetStatement("set", varName, {}, clip.startTime);
    basCode += formatSetStatement("then set", varName, { opacity: targetAlpha }, 0);
    hasSerialRoot = true;
  }

  animations.forEach((animation) => {
    const properties = pickKeyframePropertiesForResource(resource, animation.properties);
    const absoluteDelay = Math.max(0, clip.startTime) + Math.max(0, animation.delay ?? 0);

    if (animation.type === "set" && absoluteDelay > 0) {
      basCode += formatSetStatement("set", varName, {}, absoluteDelay);
      basCode += formatSetStatement(
        "then set",
        varName,
        properties,
        animation.duration
      );
      hasSerialRoot = true;
      return;
    }

    if (animation.type === "set") {
      basCode += formatSetStatement("set", varName, properties, animation.duration);
      hasSerialRoot = true;
      return;
    }

    const delay = Math.max(0, animation.delay ?? 0);
    if (delay > 0) {
      basCode += formatSetStatement(hasSerialRoot ? "then set" : "set", varName, {}, delay);
      hasSerialRoot = true;
    }

    basCode += formatSetStatement(
      hasSerialRoot ? "then set" : "set",
      varName,
      properties,
      animation.duration
    );
    hasSerialRoot = true;
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
  } else if (clip.duration <= 0) {
    // BAS only creates a duration hold for truthy def.duration values. Keep an
    // explicit zero-length unit so a zero-duration clip does not fall back to 4s.
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
