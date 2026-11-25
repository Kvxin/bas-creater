import type {
  TimelineClip,
  TimelineKeyframeProperties,
  TimelineTrack
} from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import {
  normalizeKeyframes,
  pickKeyframePropertiesForResource
} from "@/core/keyframes";
import { isDanmuFieldBasDefault, resolveDanmuDefaults } from "@/core/danmuDefaults";
import {
  COLOR_PROPERTY_KEYS,
  DEFINITION_FIELDS_BY_TYPE,
  NUMERIC_PROPERTY_KEYS,
  PERCENTAGE_PROPERTY_KEYS,
  toBasPropertyKey,
  toEditorPropertyKey
} from "@/core/danmuProperties";
import { flattenTimelineClips } from "@/core/timelineGroups";

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

const encodeBasString = (key: string, value: string): string => {
  const normalized = value.replace(/\r\n?/g, "\n");
  const unsupported = normalized.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
  if (unsupported) {
    throw new Error(`Property ${key} contains unsupported control character U+${unsupported[0]!.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return `"${normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
};

const formatValue = (key: string, value: unknown): string => {
  if (value === undefined || value === null) return "";

  const normalizedKey = toEditorPropertyKey(key);
  if (normalizedKey === "target") return formatTargetValue(value);

  if (COLOR_PROPERTY_KEYS.has(normalizedKey) && typeof value === "number") {
    return "0x" + value.toString(16).padStart(6, "0");
  }

  if (typeof value === "boolean") return value ? "1" : "0";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (COLOR_PROPERTY_KEYS.has(normalizedKey)) {
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
      NUMERIC_PROPERTY_KEYS.has(normalizedKey) &&
      (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed) ||
        (PERCENTAGE_PROPERTY_KEYS.has(normalizedKey) &&
          /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%$/i.test(trimmed)))
    ) {
      return trimmed;
    }
    return encodeBasString(key, value);
  }

  return String(value);
};

const formatSeconds = (milliseconds: number) =>
  `${Number((Math.max(0, milliseconds) / 1000).toFixed(4))}s`;

const toBasKey = toBasPropertyKey;

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
  basCode += appendResourceIdentity(resolveDanmuDefaults(resource));

  DEFINITION_FIELDS_BY_TYPE[resource.type].forEach((key) => {
    const value = rawResource[key];
    if (value === undefined || value === null) return;
    if (startSec > 0 && key === "opacity") return;
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
    if (keyframe.easing && keyframe.easing !== "linear") {
      throw new Error(`Unsupported keyframe easing: ${keyframe.easing}`);
    }
    const durationMs = Math.max(0, keyframe.timeMs - previousTimeMs);
    const properties = pickKeyframePropertiesForResource(resource, keyframe.properties);
    const unsupported = Object.keys(keyframe.properties).filter(key => !(key in properties));
    if (unsupported.length) throw new Error(`Unsupported keyframe properties: ${unsupported.join(", ")}`);
    if (durationMs === 0 && Object.keys(properties).length === 0) return;
    // BAS 的文字和字号在 set 开始时切换，不能与前一段渐变共用时间。
    const { content, text, fontSize, ...continuous } = properties;
    if (keyframe.interpolation === "step") {
      if (durationMs > 0) {
        basCode += formatSetStatement(command, varName, {}, durationMs);
        command = "then set";
      }
      basCode += formatSetStatement(command, varName, properties, 0);
    } else {
      if (durationMs > 0 || Object.keys(continuous).length > 0) {
        basCode += formatSetStatement(command, varName, continuous, durationMs);
        command = "then set";
      }
      if (content !== undefined || text !== undefined || fontSize !== undefined) {
        basCode += formatSetStatement(command, varName, { content, text, fontSize }, 0);
      }
    }
    command = "then set";
    previousTimeMs = keyframe.timeMs;
  });

  return basCode;
};

export const basNameForClip = (id: string) => {
  if (/^[A-Za-z0-9_]+$/.test(id) && !id.startsWith("encoded_")) return `obj_${id}`;
  // 保留编码前缀，避免特殊字符 ID 与普通 ID 生成同名对象。
  return `obj_encoded_${Array.from(id, character => character.codePointAt(0)!.toString(16)).join("_") || "empty"}`;
};

const compileResolvedClip = (clip: TimelineClip, resource: AnyDanmu, varName: string): string => {
  if (clip.kind === "group") throw new Error("Cannot compile a group as a single clip");
  const keyframes = normalizeKeyframes(clip.keyframes, clip.duration);

  let basCode = compileDanmuDefinition(resource, varName, clip.duration, clip.startTime);

  if (keyframes.length > 0) {
    basCode += compileKeyframesToBas(clip, resource, varName);
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

export const compileClipToBas = (clip: TimelineClip, resource: AnyDanmu): string => {
  if (clip.kind === "group") throw new Error("Cannot compile a group as a single clip");
  if (clip.parentClipId || resource.parentId || clip.overrides?.parentId) {
    throw new Error("A parented clip must be compiled in its timeline");
  }
  return compileResolvedClip(clip, { ...resource, ...clip.overrides, id: resource.id, type: resource.type } as AnyDanmu, basNameForClip(clip.id));
};

export const compileTimelineToBas = (
  tracks: TimelineTrack[],
  resources: AnyDanmu[],
  options: { audioResourceIds?: Iterable<string>; onError?: (message: string) => void; onRange?: (clipId: string, startLine: number, endLine: number) => void } = {}
): string => {
  const audioResourceIds = new Set(options.audioResourceIds);
  const audioIds = new Set<string>();
  const collectAudio = (scope: TimelineTrack[]) => {
    for (const track of scope) for (const clip of track.clips) {
      if (clip.kind === "group") collectAudio(clip.tracks);
      else if (track.type === "audio") audioIds.add(clip.id);
    }
  };
  collectAudio(tracks);
  const clips = flattenTimelineClips(tracks).filter(clip => !audioIds.has(clip.id) && !audioResourceIds.has(clip.resourceId));
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  if (byId.size !== clips.length) {
    const message = "Duplicate timeline clip ID";
    if (!options.onError) throw new Error(message);
    options.onError(message);
    return "";
  }
  const names = new Map(clips.map(clip => [clip.id, basNameForClip(clip.id)]));
  const resourceById = new Map<string, AnyDanmu>();
  for (const resource of resources) {
    if (!resourceById.has(resource.id)) resourceById.set(resource.id, resource);
  }
  let line = 1;
  return clips.map(clip => {
    try {
    const resource = resourceById.get(clip.resourceId);
    if (!resource) throw new Error(`Missing resource for clip ${clip.id}`);
    const resolved = { ...resource, ...clip.overrides, id: resource.id, type: resource.type } as AnyDanmu;
    if (resolved.parentId && !clip.parentClipId) throw new Error(`Unresolved parent for clip ${clip.id}`);
    let parentId = clip.parentClipId;
    const seen = new Set([clip.id]);
    while (parentId) {
      if (seen.has(parentId)) throw new Error(`Cyclic parent for clip ${clip.id}`);
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) throw new Error(`Missing or hidden parent clip ${parentId}`);
      const parentResource = resourceById.get(parent.resourceId);
      if (!parentResource) throw new Error(`Missing resource for parent clip ${parent.id}`);
      if (parentResource.type !== "text") throw new Error(`Parent clip ${parent.id} must be text`);
      parentId = parent.parentClipId;
    }
    resolved.parentId = clip.parentClipId ? names.get(clip.parentClipId) : undefined;
    const code = compileResolvedClip(clip, resolved, names.get(clip.id)!);
    const lineCount = code.split("\n").length;
    options.onRange?.(clip.id, line, line + lineCount - 1);
    line += lineCount;
    return code;
    } catch (error) {
      if (!options.onError) throw new Error(`Clip ${clip.id}: ${error instanceof Error ? error.message : String(error)}`);
      options.onError(`Clip ${clip.id}: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  }).join("\n");
};

export const formatBasParseError = (
  error: unknown,
  code: string,
  ranges: Array<{ clipId: string; startLine: number; endLine: number }>
) => {
  const message = error instanceof Error ? error.message : String(error);
  const line = Number(message.match(/line\s*[:：]\s*(\d+)/i)?.[1]);
  const range = ranges.find(item => line >= item.startLine && line <= item.endLine);
  if (!range) return message;
  const sourceLine = code.split("\n")[line - 1] ?? "";
  const property = sourceLine.match(/\b([A-Za-z_]\w*)\s*=/)?.[1];
  return `Clip ${range.clipId}${property ? `, property ${property}` : ""}: ${message}`;
};
