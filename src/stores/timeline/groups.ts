import type { TimelineGroupClip, TimelineTrack } from "@/types/timeline";
import { i18n } from "@/i18n";
import { useAudioStore } from "@/stores/audio";
import { useDanmuStore } from "@/stores/danmu";
import { createTimelineId, getTimelineDuration, visitTimelineClips } from "@/core/timelineGroups";
import { clearTrackTypeIfEmpty, cloneClip } from "@/core/timelineTracks";
import type { TimelineStoreContext } from "./context";

export const createTimelineGroups = (ctx: TimelineStoreContext) => {
  const { rootTracks, tracks, selectedClipIds, selectedClipId, findClipLocation, recalculateDuration, setSelectedClip, setSelectedClips } = ctx;


  /**
   * 判断当前编辑层中的片段是否可以放入目标分组。
   *
   * 仅允许未锁定的非音频片段操作，并拒绝把片段放入自身；调用方可据此
   * 同时控制拖拽高亮、投放结果和快捷操作的可用状态。
   *
   * @param clipId 待移动或复制的片段 ID
   * @param groupId 目标分组 ID
   * @returns 片段可以放入目标分组时返回 true，否则返回 false
   */
  const canMoveClipIntoGroup = (clipId: string | null, groupId: string | null) => {
    if (!clipId || !groupId || clipId === groupId) return false;
    const source = findClipLocation(clipId);
    const target = findClipLocation(groupId);
    if (!source || !target || target.clip.kind !== "group") return false;
    if (source.track.locked || target.track.locked || source.track.type === "audio") return false;
    if (source.clip.kind === "resource" && useAudioStore().audioResources.some((resource) => resource.id === source.clip.resourceId)) {
      return false;
    }
    return true;
  };

  /**
   * 将当前编辑层的片段移动到目标分组。
   *
   * 操作会在分组内部创建新的弹幕轨道，并把片段时间转换为相对分组起点的
   * 局部时间；如果片段早于分组起点，则前移分组及其已有内容以保持绝对时间。
   *
   * @param clipId 待移动的片段 ID
   * @param groupId 目标分组 ID
   * @returns 移动成功时返回 true，校验失败或目标不存在时返回 false
   */
  const moveClipIntoGroup = (clipId: string | null, groupId: string | null) => {
    if (!canMoveClipIntoGroup(clipId, groupId)) return false;
    const source = findClipLocation(clipId!);
    const target = findClipLocation(groupId!);
    if (!source || !target || target.clip.kind !== "group") return false;

    const sourceClip = source.clip;
    const group = target.clip;
    const absoluteStart = sourceClip.startTime;

    // 如果素材早于分组开始时间，整体前移分组内容，保证拖入后绝对时间不变。
    if (absoluteStart < group.startTime) {
      const shift = group.startTime - absoluteStart;
      for (const childTrack of group.tracks) {
        for (const childClip of childTrack.clips) childClip.startTime += shift;
      }
      group.startTime = absoluteStart;
    }

    source.track.clips.splice(source.clipIndex, 1);
    clearTrackTypeIfEmpty(source.track);

    const childTrackId = createTimelineId("track");
    sourceClip.trackId = childTrackId;
    sourceClip.startTime = Math.max(0, absoluteStart - group.startTime);
    group.tracks.push({
      id: childTrackId,
      name: i18n.global.t("timeline.defaultTrackName", { n: group.tracks.length + 1 }),
      type: "danmu",
      clips: [sourceClip],
      visible: target.track.visible,
      muted: false,
      locked: false,
      expanded: false,
    });

    recalculateDuration();
    setSelectedClip(group.id);
    return true;
  };

  /**
   * 将当前编辑层的片段复制到目标分组。
   *
   * 复制会递归克隆分组结构、片段 ID、动画、关键帧和弹幕资源，保证副本与
   * 原片段独立编辑；时间换算规则与移动到分组保持一致。
   *
   * @param clipId 待复制的片段 ID
   * @param groupId 目标分组 ID
   * @returns 复制成功时返回 true，校验失败或目标不存在时返回 false
   */
  const copyClipIntoGroup = (clipId: string | null, groupId: string | null) => {
    if (!canMoveClipIntoGroup(clipId, groupId)) return false;
    const source = findClipLocation(clipId!);
    const target = findClipLocation(groupId!);
    if (!source || !target || target.clip.kind !== "group") return false;

    const group = target.clip;
    const absoluteStart = source.clip.startTime;
    const childTrackId = createTimelineId("track");
    const copiedClip = cloneClip(source.clip, childTrackId);
    if (absoluteStart < group.startTime) {
      const shift = group.startTime - absoluteStart;
      for (const childTrack of group.tracks) {
        for (const childClip of childTrack.clips) childClip.startTime += shift;
      }
      group.startTime = absoluteStart;
    }

    copiedClip.startTime = Math.max(0, absoluteStart - group.startTime);
    group.tracks.push({
      id: childTrackId,
      name: i18n.global.t("timeline.defaultTrackName", { n: group.tracks.length + 1 }),
      type: "danmu",
      clips: [copiedClip],
      visible: target.track.visible,
      muted: false,
      locked: false,
      expanded: false,
    });
    recalculateDuration();
    setSelectedClip(group.id);
    return true;
  };

  const canCreateGroup = () => selectedClipIds.value.length > 0 && selectedClipIds.value.every((id) => {
    const location = findClipLocation(id);
    return location && !location.track.locked && location.track.type !== "audio" &&
      (location.clip.kind === "group" || useDanmuStore().danmus.some((resource) => resource.id === location.clip.resourceId));
  });

  const createGroup = (): TimelineGroupClip | null => {
    if (!canCreateGroup()) return null;
    const selectedIds = new Set(selectedClipIds.value);
    const scope = tracks.value;
    const sourceTracks = scope.filter((track) => track.clips.some((clip) => selectedIds.has(clip.id)));
    const sourceClips = sourceTracks.flatMap((track) => track.clips.filter((clip) => selectedIds.has(clip.id)));
    const startTime = Math.min(...sourceClips.map((clip) => clip.startTime));
    const insertIndex = scope.findIndex((track) => track.id === sourceTracks[0]?.id);
    const childTracks: TimelineTrack[] = sourceTracks.map((track) => {
      const childTrackId = createTimelineId("track");
      const clips = track.clips.filter((clip) => selectedIds.has(clip.id));
      for (const clip of clips) {
        clip.startTime -= startTime;
        clip.trackId = childTrackId;
      }
      track.clips = track.clips.filter((clip) => !selectedIds.has(clip.id));
      return { ...track, id: childTrackId, type: "danmu", clips };
    });
    let groupNumber = 1;
    const names = new Set<string>();
    visitTimelineClips(rootTracks.value, (clip) => {
      if (clip.kind === "group" && clip.name) names.add(clip.name);
    });
    while (names.has(i18n.global.t("groups.defaultName", { n: groupNumber }))) groupNumber += 1;
    const name = i18n.global.t("groups.defaultName", { n: groupNumber });
    const groupTrackId = createTimelineId("track");
    const group: TimelineGroupClip = {
      kind: "group", id: createTimelineId("clip"), trackId: groupTrackId,
      name, startTime, duration: getTimelineDuration(childTracks), tracks: childTracks
    };
    scope.splice(insertIndex, 0, {
      id: groupTrackId, name, type: "danmu", clips: [group], visible: true, muted: false, locked: false
    });
    for (const sourceTrack of sourceTracks) {
      if (!sourceTrack.clips.length) scope.splice(scope.indexOf(sourceTrack), 1);
    }
    recalculateDuration();
    setSelectedClip(group.id);
    return group;
  };

  const canUngroupClip = (id = selectedClipId.value) => {
    const location = id ? findClipLocation(id) : null;
    return selectedClipIds.value.length === 1 && location?.clip.kind === "group" && !location.track.locked;
  };

  const ungroupClip = (id = selectedClipId.value) => {
    if (!id || !canUngroupClip(id)) return false;
    const location = findClipLocation(id);
    if (!location || location.clip.kind !== "group") return false;
    const { clip: group, track, clipIndex } = location;
    const insertIndex = tracks.value.indexOf(track);
    track.clips.splice(clipIndex, 1);
    for (const childTrack of group.tracks) {
      childTrack.visible = track.visible && childTrack.visible;
      for (const child of childTrack.clips) child.startTime += group.startTime;
    }
    const childIds = group.tracks.flatMap((childTrack) => childTrack.clips.map((clip) => clip.id));
    tracks.value.splice(insertIndex, track.clips.length ? 0 : 1, ...group.tracks);
    recalculateDuration();
    setSelectedClips(childIds);
    return true;
  };

  return { canMoveClipIntoGroup, moveClipIntoGroup, copyClipIntoGroup, canCreateGroup, createGroup, canUngroupClip, ungroupClip };
};
