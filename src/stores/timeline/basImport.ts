import type { TimelineClip, TimelineGroupClip, TimelineResourceClip, TimelineTrack } from "@/types/timeline";
import type { BasImportObject } from "@/core/basImport";
import { i18n } from "@/i18n";
import { useDanmuStore } from "@/stores/danmu";
import { compileTimelineToBas } from "@/core/compiler";
import { BASE_KEYFRAME_ID, createKeyframeId } from "@/core/keyframes";
import { createTimelineId, getTimelineDuration, visitTimelineClips } from "@/core/timelineGroups";
import { applyTrackType } from "@/core/timelineTracks";
import type { TimelineStoreContext } from "./context";

export const createTimelineBasImport = (ctx: TimelineStoreContext) => {
  const { rootTracks, tracks, selectedKeyframeId, addTrack, recalculateDuration, setSelectedClip } = ctx;


  /** 生成不与现有分组重名的默认分组名（`BAS 导入 n`）。 */
  const nextBasImportGroupName = () => {
    const names = new Set<string>();
    visitTimelineClips(rootTracks.value, (clip) => {
      if (clip.kind === "group" && clip.name) names.add(clip.name);
    });
    let index = 1;
    while (names.has(i18n.global.t("dialogs.basImport.groupName", { n: index }))) index += 1;
    return i18n.global.t("dialogs.basImport.groupName", { n: index });
  };

  /**
   * 导入 BAS 转换结果：创建资源、片段与关键帧，并解析父子关系。
   *
   * 多对象时生成一个分组片段（每个对象一条子轨道），保证「一段 BAS = 一个可
   * 整体移动/复制的单元」，父子关系也不会跨组丢失。写入前会用
   * `compileTimelineToBas` 回编译一次，失败则回滚本次新增的轨道/片段/资源，
   * 避免时间轴留下预览阶段才报错的数据。
   *
   * @param objects `convertParsedBas` 的输出
   * @param options `trackId` 目标轨道、`createTrack` 新建轨道、`startTimeMs` 起点
   * @returns 落点轨道、新增片段 ID，多对象时附带分组片段 ID
   */
  const importBasObjects = (
    objects: BasImportObject[],
    options: { trackId?: string | null; createTrack?: boolean; startTimeMs?: number } = {}
  ) => {
    if (objects.length === 0) throw new Error(i18n.global.t("dialogs.basImport.errors.empty"));

    const startTimeMs = Math.max(0, Math.round(options.startTimeMs ?? 0));
    const createTrack = options.createTrack === true;
    const targetTrack = createTrack
      ? null
      : tracks.value.find((track) => track.id === options.trackId) ?? null;

    if (!createTrack && !targetTrack) {
      throw new Error(i18n.global.t("dialogs.basImport.errors.trackMissing"));
    }
    if (targetTrack?.locked) throw new Error(i18n.global.t("dialogs.basImport.errors.trackLocked"));
    if (targetTrack?.type === "audio") {
      throw new Error(i18n.global.t("dialogs.basImport.errors.trackType"));
    }

    const danmuStore = useDanmuStore();
    const createdResourceIds: string[] = [];
    /** 回滚时用于还原被 `applyTrackType` 改成弹幕轨道的空轨道。 */
    const trackTypeBefore = targetTrack?.type;
    let inserted: { kind: "track"; trackId: string } | { kind: "clip"; trackId: string; clipId: string } | null =
      null;

    try {
      const created = objects.map((object) => {
        const resource = danmuStore.add(object.resource.type, { ...object.resource }, { select: false });
        createdResourceIds.push(resource.id);
        return { object, resource };
      });

      const clips: TimelineResourceClip[] = created.map(({ object, resource }) => ({
        kind: "resource",
        id: createTimelineId("clip"),
        resourceId: resource.id,
        name: object.name,
        startTime: 0,
        duration: object.durationMs,
        trackId: "",
        keyframes: object.keyframes.map((keyframe) => ({ ...keyframe, id: createKeyframeId() })),
      }));

      // 第二遍转换父子关系：clipId 需要等所有片段都创建完才有。
      const clipIdByName = new Map(created.map(({ object }, index) => [object.name, clips[index]!.id]));
      created.forEach(({ object }, index) => {
        if (!object.parentName) return;
        const parentId = clipIdByName.get(object.parentName);
        const parent = created.find((item) => item.object.name === object.parentName);
        if (!parentId || !parent || parent.resource.type !== "text") {
          throw new Error(
            i18n.global.t("dialogs.basImport.errors.parent", { object: object.name, parent: object.parentName })
          );
        }
        clips[index]!.parentClipId = parentId;
      });

      let importedClip: TimelineClip;
      if (clips.length === 1) {
        const clip = clips[0]!;
        clip.startTime = startTimeMs;
        const trackId = targetTrack?.id ?? addTrack();
        const track = trackId ? tracks.value.find((item) => item.id === trackId) : null;
        if (!track || !trackId) throw new Error(i18n.global.t("dialogs.basImport.errors.trackMissing"));

        applyTrackType(track, "danmu");
        clip.trackId = trackId;
        track.clips.push(clip);
        track.clips.sort((left, right) => left.startTime - right.startTime);
        inserted = targetTrack ? { kind: "clip", trackId, clipId: clip.id } : { kind: "track", trackId };
        importedClip = clip;
      } else {
        const groupName = nextBasImportGroupName();
        const childTracks: TimelineTrack[] = created.map(({ object }, index) => {
          const childTrackId = createTimelineId("track");
          const clip = clips[index]!;
          clip.trackId = childTrackId;
          clip.startTime = 0;
          return {
            id: childTrackId,
            name: object.name,
            type: "danmu",
            clips: [clip],
            visible: true,
            muted: false,
            locked: false,
            expanded: false,
          };
        });
        const groupTrackId = createTimelineId("track");
        const group: TimelineGroupClip = {
          kind: "group",
          id: createTimelineId("clip"),
          trackId: groupTrackId,
          name: groupName,
          startTime: startTimeMs,
          duration: getTimelineDuration(childTracks),
          tracks: childTracks,
        };

        if (targetTrack) {
          applyTrackType(targetTrack, "danmu");
          targetTrack.clips.push(group);
          targetTrack.clips.sort((left, right) => left.startTime - right.startTime);
          inserted = { kind: "clip", trackId: targetTrack.id, clipId: group.id };
        } else {
          tracks.value.push({
            id: groupTrackId,
            name: groupName,
            type: "danmu",
            clips: [group],
            visible: true,
            muted: false,
            locked: false,
            expanded: false,
          });
          inserted = { kind: "track", trackId: groupTrackId };
        }
        importedClip = group;
      }

      recalculateDuration();

      const errors: string[] = [];
      compileTimelineToBas(rootTracks.value, danmuStore.danmus, {
        onError: (message) => errors.push(message),
      });
      const importedClipIds = clips.map((clip) => clip.id);
      const failure = errors.find((message) =>
        importedClipIds.some((clipId) => message.includes(clipId))
      );
      if (failure) throw new Error(failure);

      setSelectedClip(importedClip.id);
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
      return {
        trackId: importedClip.trackId,
        clipIds: importedClipIds,
        groupClipId: importedClip.kind === "group" ? importedClip.id : null,
      };
    } catch (error) {
      const rollback = inserted;
      if (rollback?.kind === "track") {
        const index = tracks.value.findIndex((track) => track.id === rollback.trackId);
        if (index !== -1) tracks.value.splice(index, 1);
      } else if (rollback?.kind === "clip") {
        const track = tracks.value.find((item) => item.id === rollback.trackId);
        const clipIndex = track ? track.clips.findIndex((clip) => clip.id === rollback.clipId) : -1;
        if (track && clipIndex !== -1) track.clips.splice(clipIndex, 1);
      }
      if (targetTrack && targetTrack.type !== trackTypeBefore && targetTrack.clips.length === 0) {
        targetTrack.type = trackTypeBefore;
      }
      for (const resourceId of createdResourceIds) danmuStore.remove(resourceId);
      recalculateDuration();
      throw error;
    }
  };

  return { importBasObjects };
};
