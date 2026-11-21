import type { BasProjectData } from "@/types/storage";
import { MAX_CLIP_EFFECTS, validateInstance } from "@/effects/validation";
import type { TimelineClip, TimelineTrack } from "@/types/timeline";
import { updateGroupDurations } from "@/utils/timelineGroups";

export const PROJECT_VERSION = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * 校验并迁移工程数据到当前持久化版本。
 *
 * 除了补齐旧版本片段的 kind 字段，还会递归验证分组轨道、资源引用、动画
 * 节点和 ID 唯一性；任何结构异常都会在写入 Store 前抛出，避免污染当前工程。
   *
   * @param input 待校验和迁移的工程数据
   * @param fallbackName 输入数据缺少工程名称时使用的默认名称
   * @returns 已校验并迁移到当前版本的工程数据
   * @throws 当工程结构、资源引用或 ID 不合法时抛出错误
 */
export const normalizeProjectData = (input: unknown, fallbackName = "DanmakuProject"): BasProjectData => {
  if (!isRecord(input) || !Array.isArray(input.tracks)) throw new Error("Invalid project structure");
  const version = input.version ?? 1;
  const legacy = version === 1 || version === 2;
  if (!legacy && version !== 3 && version !== 4 && version !== PROJECT_VERSION) throw new Error("Unsupported project version");
  if (legacy && !Array.isArray(input.danmus)) throw new Error("Invalid project structure");
  const data: BasProjectData = JSON.parse(JSON.stringify(input));
  if (legacy) {
    data.audioMeta ??= [];
    if (!Array.isArray(data.audioMeta)) throw new Error("Invalid audio metadata");
    data.assets = [
      ...data.danmus.map((danmu) => ({ id: danmu.id, type: danmu.type, binId: null, danmu })),
      ...data.audioMeta.map((audio) => ({
        id: audio.id, type: "audio-file" as const, binId: null, audio,
        ...(audio.sourcePath ? { location: { kind: "external" as const, path: audio.sourcePath } } :
          audio.relativePath ? { location: { kind: "project" as const, path: audio.relativePath } } : {}),
      })),
    ];
    data.bins = [];
  }
  if (!Array.isArray(data.assets) || !Array.isArray(data.bins)) throw new Error("Invalid assets or bins");
  const binIds = new Set<string>();
  for (const bin of data.bins) {
    if (!isRecord(bin) || typeof bin.name !== "string" || !bin.name.trim() ||
      (bin.parentId !== null && typeof bin.parentId !== "string")) throw new Error("Invalid bin");
    if (typeof bin.id !== "string" || !bin.id || binIds.has(bin.id)) throw new Error("Invalid or duplicate bin ID");
    binIds.add(bin.id);
  }
  const binMap = new Map(data.bins.map((bin) => [bin.id, bin]));
  for (const bin of data.bins) {
    const seen = new Set([bin.id]);
    let parent = bin.parentId;
    while (parent !== null) {
      if (seen.has(parent) || !binMap.has(parent)) throw new Error("Invalid bin hierarchy");
      seen.add(parent);
      parent = binMap.get(parent)!.parentId;
    }
  }
  const assetIds = new Set<string>();
  for (const asset of data.assets) {
    if (!isRecord(asset) || typeof asset.id !== "string" || !asset.id || assetIds.has(asset.id) ||
      (asset.binId !== null && (typeof asset.binId !== "string" || !binIds.has(asset.binId)))) throw new Error("Invalid asset");
    assetIds.add(asset.id);
    if (asset.type === "audio-file") {
      if (!isRecord(asset.audio) || asset.audio.id !== asset.id || typeof asset.audio.name !== "string") throw new Error("Invalid audio asset");
      if (asset.location !== undefined && (!isRecord(asset.location) ||
        !["external", "project"].includes(String(asset.location.kind)) || typeof asset.location.path !== "string" ||
        !asset.location.path || (asset.location.kind === "project" &&
          (/^(?:[a-z]:|[/\\])/i.test(asset.location.path) || asset.location.path.split(/[/\\]/).includes(".."))))) {
        throw new Error("Invalid asset location");
      }
    } else if (!["text", "button", "path"].includes(String(asset.type)) || !isRecord(asset.danmu) ||
      asset.danmu.id !== asset.id || asset.danmu.type !== asset.type) throw new Error("Invalid danmaku asset");
  }
  data.danmus = data.assets.flatMap((asset) => asset.type === "audio-file" ? [] : [asset.danmu]);
  data.audioMeta = data.assets.flatMap((asset) => asset.type === "audio-file" ? [asset.audio] : []);
  const danmuTypes = new Map(data.danmus.map(item => [item.id, item.type]));
  const resourceIds = new Set<string>();
  const audioIds = new Set<string>();
  const nodeIds = new Set<string>();
  const clipsById = new Map<string, Extract<TimelineClip, { kind: "resource" }>>();
  const clipsByResource = new Map<string, Extract<TimelineClip, { kind: "resource" }>[]>();
  const registerId = (id: unknown, ids: Set<string>) => {
    if (typeof id !== "string" || !id || ids.has(id)) throw new Error("Invalid or duplicate project ID");
    ids.add(id);
  };
  for (const resource of data.danmus) {
    if (!isRecord(resource) || !["text", "button", "path"].includes(String(resource.type))) {
      throw new Error("Invalid danmaku resource");
    }
    registerId(resource.id, resourceIds);
  }
  data.audioMeta ??= [];
  if (!Array.isArray(data.audioMeta)) throw new Error("Invalid audio metadata");
  for (const audio of data.audioMeta) {
    if (!isRecord(audio) || typeof audio.name !== "string") throw new Error("Invalid audio metadata");
    registerId(audio.id, resourceIds);
    audioIds.add(audio.id);
  }
  const validateAnimationData = (clip: TimelineClip) => {
    if (clip.kind !== "resource") return;
    if (clip.keyframes !== undefined) {
      if (!Array.isArray(clip.keyframes)) throw new Error("Invalid keyframes");
      for (const keyframe of clip.keyframes) {
        if (!isRecord(keyframe) || !isTime(keyframe.timeMs) || !isRecord(keyframe.properties)) {
          throw new Error("Invalid keyframe");
        }
        registerId(keyframe.id, nodeIds);
      }
    }
    if (clip.animations !== undefined) {
      if (!Array.isArray(clip.animations)) throw new Error("Invalid animations");
      for (const animation of clip.animations) {
        if (!isRecord(animation) || !["set", "then"].includes(String(animation.type)) ||
          !isTime(animation.duration) || !isRecord(animation.properties) ||
          (animation.delay !== undefined && !isTime(animation.delay))) {
          throw new Error("Invalid animation");
        }
        registerId(animation.id, nodeIds);
      }
    }
    if (clip.keyframes?.length && clip.animations?.length) {
      throw new Error(`Clip ${clip.id} contains both keyframes and legacy animations; preserve the original project and restore or save a corrected copy`);
    }
  };
  /**
   * 递归校验轨道及其片段，并限制分组内部不能出现音频轨道或音频片段。
   *
   * @param tracks 待校验的轨道列表
   * @param insideGroup 当前轨道列表是否位于分组内部
   * @returns 无返回值；发现非法结构时直接抛出错误
   * @throws 当轨道、片段、资源引用或分组层级不合法时抛出错误
   */
  const validateTracks = (tracks: TimelineTrack[], insideGroup: boolean) => {
    if (!Array.isArray(tracks)) throw new Error("Invalid group tracks");
    for (const track of tracks) {
      if (!isRecord(track) || !Array.isArray(track.clips) || typeof track.name !== "string" ||
        typeof track.visible !== "boolean" || typeof track.locked !== "boolean" ||
        (track.type !== undefined && track.type !== "audio" && track.type !== "danmu")) {
        throw new Error("Invalid timeline track");
      }
      registerId(track.id, nodeIds);
      for (const clip of track.clips) {
        if (!isRecord(clip) || clip.trackId !== track.id || !isTime(clip.startTime) || !isTime(clip.duration) ||
          (clip.name !== undefined && typeof clip.name !== "string")) {
          throw new Error("Invalid timeline clip");
        }
        registerId(clip.id, nodeIds);
        if (version === 1 && !Object.prototype.hasOwnProperty.call(clip, "kind")) {
          Object.assign(clip, { kind: "resource" });
        }
        if (clip.kind === "group") {
          if (track.type === "audio" || clip.resourceId !== undefined || clip.keyframes !== undefined ||
            clip.animations !== undefined || clip.params !== undefined || clip.overrides !== undefined ||
            clip.parentClipId !== undefined || clip.sourceInMs !== undefined) throw new Error("Invalid group clip");
          validateTracks(clip.tracks, true);
          if (clip.effects !== undefined) throw new Error("Groups cannot own attached effects");
          if ("effect" in clip) {
            // v4 的生成组没有宿主 ID，保留实际子轨和素材即可重现旧画面。
            if (version !== 4) throw new Error("Invalid legacy effect group");
            delete clip.effect;
          }
        } else if (clip.kind === "resource") {
          if (!resourceIds.has(clip.resourceId) || clip.tracks !== undefined) throw new Error("Missing clip resource");
          if ("effect" in clip) throw new Error("Invalid legacy effect metadata");
          const isAudio = audioIds.has(clip.resourceId);
          if (clip.effects !== undefined) {
            const type = danmuTypes.get(clip.resourceId);
            if (!type || version !== PROJECT_VERSION || !Array.isArray(clip.effects) || clip.effects.length > MAX_CLIP_EFFECTS)
              throw new Error("Invalid clip effects");
            for (const effect of clip.effects) {
              validateInstance(effect, type);
              registerId(effect.id, nodeIds);
            }
          }
          if ((insideGroup && isAudio) || (track.type === "audio" && !isAudio) ||
            (track.type === "danmu" && isAudio)) throw new Error("Incompatible clip type");
          if (clip.sourceInMs !== undefined && (!isAudio || !isTime(clip.sourceInMs))) throw new Error("Invalid source offset");
          if (legacy && isAudio && clip.sourceInMs === undefined) clip.sourceInMs = 0;
          if (clip.overrides !== undefined && (isAudio || !isRecord(clip.overrides) ||
            (clip.overrides.id !== undefined && clip.overrides.id !== clip.resourceId) ||
            (clip.overrides.type !== undefined && clip.overrides.type !== data.danmus.find((item) => item.id === clip.resourceId)?.type))) {
            throw new Error("Invalid clip overrides");
          }
          if (clip.parentClipId !== undefined && (isAudio || typeof clip.parentClipId !== "string" || !clip.parentClipId)) throw new Error("Invalid parent clip");
          if (legacy && !isAudio) {
            const source = data.danmus.find((item) => item.id === clip.resourceId)!;
            clip.overrides = { ...source };
          }
          clipsById.set(clip.id, clip);
          const instances = clipsByResource.get(clip.resourceId) ?? [];
          instances.push(clip);
          clipsByResource.set(clip.resourceId, instances);
          validateAnimationData(clip);
        } else {
          throw new Error("Invalid clip kind");
        }
      }
      if (insideGroup && track.type === "audio") throw new Error("Audio tracks are not supported in groups");
    }
  };
  validateTracks(data.tracks, false);
  for (const clip of clipsById.values()) {
    if (legacy && clip.overrides?.parentId) {
      const parents = clipsByResource.get(clip.overrides.parentId) ?? [];
      if (parents.length !== 1 || parents[0]!.id === clip.id) throw new Error("Ambiguous or missing legacy parent clip");
      clip.parentClipId = parents[0]!.id;
    }
    if (legacy && clip.overrides) delete clip.overrides.parentId;
  }
  for (const clip of clipsById.values()) {
    const seen = new Set([clip.id]);
    let parent = clip.parentClipId;
    while (parent !== undefined) {
      const target = clipsById.get(parent);
      if (!target || audioIds.has(target.resourceId) || seen.has(parent)) throw new Error("Invalid parent clip hierarchy");
      seen.add(parent);
      parent = target.parentClipId;
    }
  }
  if (legacy) {
    for (const danmu of data.danmus) delete danmu.parentId;
  }
  data.version = PROJECT_VERSION;
  data.id = typeof data.id === "string" ? data.id : crypto.randomUUID();
  data.name = typeof data.name === "string" ? data.name : fallbackName;
  data.createdAt = isTime(data.createdAt) ? data.createdAt : Date.now();
  data.updatedAt = isTime(data.updatedAt) ? data.updatedAt : Date.now();
  data.canvas ??= { width: 800, height: 450 };
  if (!isRecord(data.canvas) || !isTime(data.canvas.width) || !isTime(data.canvas.height) ||
    !data.canvas.width || !data.canvas.height) throw new Error("Invalid canvas size");
  data.timeline = { ...data.timeline, duration: updateGroupDurations(data.tracks) };
  return data;
};

/** Produce the on-disk representation, with runtime projections removed. */
export const serializeProjectData = (project: BasProjectData): Omit<BasProjectData, "danmus" | "audioMeta"> => {
  const { danmus: _danmus, audioMeta: _audioMeta, ...serialized } = normalizeProjectData(project);
  return serialized;
};
