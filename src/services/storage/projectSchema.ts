import type { BasProjectData } from "@/types/storage";
import type { TimelineClip, TimelineTrack } from "@/types/timeline";
import { updateGroupDurations } from "@/utils/timelineGroups";

export const PROJECT_VERSION = 2;

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
  if (!isRecord(input) || !Array.isArray(input.danmus) || !Array.isArray(input.tracks)) {
    throw new Error("Invalid project structure");
  }
  const version = input.version ?? 1;
  if (version !== 1 && version !== PROJECT_VERSION) throw new Error("Unsupported project version");
  const data: BasProjectData = JSON.parse(JSON.stringify(input));
  const resourceIds = new Set<string>();
  const audioIds = new Set<string>();
  const nodeIds = new Set<string>();
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
            clip.animations !== undefined || clip.params !== undefined) throw new Error("Invalid group clip");
          validateTracks(clip.tracks, true);
        } else if (clip.kind === "resource") {
          if (!resourceIds.has(clip.resourceId) || clip.tracks !== undefined) throw new Error("Missing clip resource");
          const isAudio = audioIds.has(clip.resourceId);
          if ((insideGroup && isAudio) || (track.type === "audio" && !isAudio) ||
            (track.type === "danmu" && isAudio)) throw new Error("Incompatible clip type");
          validateAnimationData(clip);
        } else {
          throw new Error("Invalid clip kind");
        }
      }
      if (insideGroup && track.type === "audio") throw new Error("Audio tracks are not supported in groups");
    }
  };
  validateTracks(data.tracks, false);
  data.version = PROJECT_VERSION;
  data.id = typeof data.id === "string" ? data.id : crypto.randomUUID();
  data.name = typeof data.name === "string" ? data.name : fallbackName;
  data.createdAt = isTime(data.createdAt) ? data.createdAt : Date.now();
  data.updatedAt = isTime(data.updatedAt) ? data.updatedAt : Date.now();
  data.canvas ??= { width: 800, height: 450 };
  if (!isRecord(data.canvas) || !isTime(data.canvas.width) || !isTime(data.canvas.height) ||
    !data.canvas.width || !data.canvas.height) throw new Error("Invalid canvas size");
  data.timeline = { duration: updateGroupDurations(data.tracks) };
  return data;
};
