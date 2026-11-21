import { applyOpacityLimits, opacityAt } from "@/effects/opacity";
import type { EffectPoint } from "@/effects/types";
import type {
  AnimationSegment,
  TimelineClip,
  TimelineResourceClip,
  TimelineKeyframeProperties,
  TimelineTrack,
} from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import {
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
} from "@/utils/keyframes";
import { isDanmuFieldBasDefault, resolveDanmuDefaults } from "@/utils/danmuDefaults";
import { flattenTimelineClips, visitTimelineClips } from "@/utils/timelineGroups";

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
    "opacity",
    "anchorX",
    "anchorY",
    "rotateX",
    "rotateY",
    "rotateZ",
    "parentId",
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
    "opacity",
    "anchorX",
    "anchorY",
    "rotateX",
    "rotateY",
    "rotateZ",
    "parentId",
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
    return encodeBasString(key, value);
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
  basCode += appendResourceIdentity(resolveDanmuDefaults(resource));

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


type SetProperties = Partial<AnyDanmu> | TimelineKeyframeProperties;
interface BasUnit {
  command: "set" | "then set";
  properties: SetProperties;
  duration: number;
}
type WriteSet = (command: BasUnit["command"], properties: SetProperties, duration: number) => void;

const appendKeyframeSets = (clip: TimelineClip, resource: AnyDanmu, write: WriteSet) => {
  const keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
  const targetAlpha = resource.opacity ?? 1;
  const startDelayMs = Math.max(0, clip.startTime);

  let command: "set" | "then set" = "set";

  if (startDelayMs > 0) {
    write("set", {}, startDelayMs);
    write("then set", { opacity: targetAlpha }, 0);
    command = "then set";
  }

  let previousTimeMs = 0;
  keyframes.forEach(keyframe => {
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
        write(command, {}, durationMs);
        command = "then set";
      }
      write(command, properties, 0);
    } else {
      if (durationMs > 0 || Object.keys(continuous).length > 0) {
        write(command, continuous, durationMs);
        command = "then set";
      }
      if (content !== undefined || text !== undefined || fontSize !== undefined) {
        write(command, { content, text, fontSize }, 0);
      }
    }
    command = "then set";
    previousTimeMs = keyframe.timeMs;
  });
};

const appendLegacySets = (clip: TimelineClip, resource: AnyDanmu, write: WriteSet, animations: AnimationSegment[]) => {
  const targetAlpha = resource.opacity ?? 1;
  let hasSerialRoot = false;

  if (clip.startTime > 0) {
    write("set", {}, clip.startTime);
    write("then set", { opacity: targetAlpha }, 0);
    hasSerialRoot = true;
  }

  animations.forEach(animation => {
    const allowed = new Set([...DEFINITION_FIELDS_BY_TYPE[resource.type], "content", "text", "d"]);
    const unsupported = Object.keys(animation.properties).filter(key => !allowed.has(key) || key === "parentId");
    if (unsupported.length) throw new Error(`Unsupported animation properties: ${unsupported.join(", ")}`);
    const properties = animation.properties;
    const absoluteDelay = Math.max(0, clip.startTime) + Math.max(0, animation.delay ?? 0);

    if (animation.type === "set" && absoluteDelay > 0) {
      write("set", {}, absoluteDelay);
      write("then set", properties, animation.duration);
      hasSerialRoot = true;
      return;
    }

    if (animation.type === "set") {
      write("set", properties, animation.duration);
      hasSerialRoot = true;
      return;
    }

    const delay = Math.max(0, animation.delay ?? 0);
    if (delay > 0) {
      write(hasSerialRoot ? "then set" : "set", {}, delay);
      hasSerialRoot = true;
    }

    write(hasSerialRoot ? "then set" : "set", properties, animation.duration);
    hasSerialRoot = true;
  });
};

export const basNameForClip = (id: string) => {
  if (/^[A-Za-z0-9_]+$/.test(id) && !id.startsWith("encoded_")) return `obj_${id}`;
  // 保留编码前缀，避免特殊字符 ID 与普通 ID 生成同名对象。
  return `obj_encoded_${Array.from(id, character => character.codePointAt(0)!.toString(16)).join("_") || "empty"}`;
};

function hostSets(clip: TimelineResourceClip, resource: AnyDanmu): BasUnit[] {
  const units: BasUnit[] = [];
  const write: WriteSet = (command, properties, duration) => units.push({ command, properties, duration });
  if (clip.keyframes?.length && clip.animations?.length)
    throw new Error(`Clip ${clip.id} mixes keyframes and legacy animations`);
  if (clip.keyframes?.length) appendKeyframeSets(clip, resource, write);
  else if (clip.animations?.length) appendLegacySets(clip, resource, write, clip.animations);
  else if (clip.startTime > 0) {
    write("set", {}, clip.startTime);
    write("then set", { opacity: resource.opacity ?? 1 }, 0);
  } else if (clip.duration <= 0) write("set", {}, 0);
  return units;
}

const transformKeys = new Set(["x", "y", "rotateX", "rotateY", "rotateZ", "scale"]);

function resolveHostGroups(units: BasUnit[]): BasUnit[][] {
  const groups: BasUnit[][] = [];
  for (const unit of units) {
    if (!groups.length || unit.command === "set") groups.push([]);
    groups[groups.length - 1]!.push(unit);
  }
  if (groups.length < 2) return groups;

  // bas.js 将同一条 then 链中已写入的属性保持到链尾；跨链争用时，后声明的整组生效。
  let active: { units: BasUnit[]; firstWrite: Map<string, number>; end: number }[] = [];
  for (const group of groups) {
    const firstWrite = new Map<string, number>();
    let time = 0;
    for (const { properties, duration } of group) {
      for (const [field, value] of Object.entries(properties)) {
        const key = transformKeys.has(field) ? "transform" : field;
        if (value !== undefined && value !== null && !firstWrite.has(key)) firstWrite.set(key, time);
      }
      const end = time + duration;
      if (duration > 0 && firstWrite.size) {
        active = active.filter(prior => {
          for (const key of firstWrite.keys()) {
            const start = prior.firstWrite.get(key);
            if (start !== undefined && start < end && prior.end > time) return false;
          }
          return true;
        });
      }
      time = end;
    }
    active.push({ units: group, firstWrite, end: time });
  }
  return active.map(group => group.units);
}

// 将宿主已有的透明度与其他属性分开输出，让播放器只收到一条 alpha 链。
function composeOpacity(clip: TimelineResourceClip, resource: AnyDanmu, units: BasUnit[]) {
  const base = resource.opacity ?? 1;
  const output: BasUnit[] = [];
  let alpha: EffectPoint[] = [{ at: 0, value: base }];
  for (const group of resolveHostGroups(units)) {
    let time = 0;
    let previous: number | undefined;
    const curve: EffectPoint[] = [];
    const other = group.map(unit => {
      const { opacity, ...properties } = unit.properties;
      if (opacity !== undefined) {
        curve.push(
          { at: time, value: previous ?? opacityAt(alpha, time) },
          { at: time + unit.duration, value: opacity }
        );
        previous = opacity;
      }
      time += unit.duration;
      return { ...unit, properties };
    });
    if (curve.length) {
      const start = curve[0]!.at;
      const before = opacityAt(alpha, start, true);
      alpha = [...alpha.filter(point => point.at < start), { at: start, value: before }, ...curve];
    }
    if (other.some(unit => Object.keys(unit.properties).length)) {
      if (clip.startTime > 0) {
        output.push({ command: "set", properties: {}, duration: clip.startTime });
        other[0]!.command = "then set";
      }
      output.push(...other);
    }
  }
  const end = opacityAt(alpha, clip.duration);
  alpha = [...alpha.filter(point => point.at <= clip.duration), { at: clip.duration, value: end }];
  const limited = applyOpacityLimits(alpha, clip.effects ?? [], clip.duration);
  const initial = opacityAt(limited, 0);
  let command: BasUnit["command"] = "set";
  const writeAlpha = (properties: SetProperties, duration: number) => {
    output.push({ command, properties, duration });
    command = "then set";
  };
  if (clip.startTime > 0) {
    writeAlpha({}, clip.startTime);
    if (initial !== 0) writeAlpha({ opacity: initial }, 0);
  }
  let previous = { at: 0, value: initial };
  let writtenTime = 0;
  for (const point of limited) {
    if (point.at === 0) continue;
    if (point.value !== previous.value) {
      if (writtenTime < previous.at) writeAlpha({}, previous.at - writtenTime);
      writeAlpha({ opacity: Number(point.value.toFixed(6)) }, point.at - previous.at);
      writtenTime = point.at;
    }
    previous = point;
  }
  // def 的时长维持末值；零时长对象需要显式 set 才不会被播放器扩成 4 秒。
  if (clip.duration === 0 && !output.length) writeAlpha({}, 0);
  return { initial, units: output };
}

const compileResolvedClip = (clip: TimelineResourceClip, resource: AnyDanmu, varName: string): string => {
  for (const effect of clip.effects ?? []) {
    if (effect.patch.style) resource = { ...resource, ...effect.patch.style };
  }
  const usesOpacity = clip.effects?.some(effect => effect.patch.opacityLimit);
  let units = hostSets(usesOpacity ? { ...clip, startTime: 0 } : clip, resource);
  if (usesOpacity) {
    const composed = composeOpacity(clip, resource, units);
    units = composed.units;
    resource = { ...resource, opacity: composed.initial };
  }
  const definition = compileDanmuDefinition(resource, varName, clip.duration, clip.startTime);
  return (
    definition + units.map(unit => formatSetStatement(unit.command, varName, unit.properties, unit.duration)).join("")
  );
};

export const compileClipToBas = (clip: TimelineClip, resource: AnyDanmu): string => {
  if (clip.kind === "group") throw new Error("Cannot compile a group as a single clip");
  if (clip.parentClipId || resource.parentId || clip.overrides?.parentId) {
    throw new Error("A parented clip must be compiled in its timeline");
  }
  return compileResolvedClip(
    clip,
    { ...resource, ...clip.overrides, id: resource.id, type: resource.type } as AnyDanmu,
    basNameForClip(clip.id)
  );
};

function describeClip(tracks: TimelineTrack[], id: string) {
  let label = id;
  visitTimelineClips(tracks, clip => {
    if (clip.id === id && clip.name) label = [id, clip.name].join(" / ");
  });
  return label;
}

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
      const message = `Clip ${describeClip(tracks, clip.id)}: ${error instanceof Error ? error.message : String(error)}`;
      if (!options.onError) throw new Error(message);
      options.onError(message);
      return "";
    }
  }).join("\n");
};

export const formatBasParseError = (
  error: unknown,
  code: string,
  ranges: Array<{ clipId: string; startLine: number; endLine: number }>,
  tracks: TimelineTrack[] = []
) => {
  const message = error instanceof Error ? error.message : String(error);
  const line = Number(message.match(/line\s*[:：]\s*(\d+)/i)?.[1]);
  const range = ranges.find(item => line >= item.startLine && line <= item.endLine);
  if (!range) return message;
  const sourceLine = code.split("\n")[line - 1] ?? "";
  const property = sourceLine.match(/\b([A-Za-z_]\w*)\s*=/)?.[1];
  return `Clip ${describeClip(tracks, range.clipId)}${property ? `, property ${property}` : ""}: ${message}`;
};
