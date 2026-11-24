import type { TimelineClip, TimelineResourceClip, TimelineTrack } from "@/types/timeline";

export const createTimelineId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export const getTimelineDuration = (tracks: TimelineTrack[]): number =>
  tracks.reduce(
    (maximum, track) => track.clips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), maximum),
    0
  );

export const updateGroupDurations = (tracks: TimelineTrack[]): number => {
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.kind === "group") {
        const nextDuration = updateGroupDurations(clip.tracks);
        if (clip.duration !== nextDuration) clip.duration = nextDuration;
      }
    }
  }
  return getTimelineDuration(tracks);
};

export const visitTimelineClips = (tracks: TimelineTrack[], visit: (clip: TimelineClip) => void) => {
  for (const track of tracks) {
    for (const clip of track.clips) {
      visit(clip);
      if (clip.kind === "group") visitTimelineClips(clip.tracks, visit);
    }
  }
};

export const flattenTimelineClips = (tracks: TimelineTrack[], offsetMs = 0): TimelineResourceClip[] => {
  const clips: TimelineResourceClip[] = [];
  for (const track of tracks) {
    if (!track.visible) continue;
    for (const clip of track.clips) {
      const startTime = offsetMs + clip.startTime;
      if (clip.kind === "group") {
        clips.push(...flattenTimelineClips(clip.tracks, startTime));
      } else {
        clips.push({ ...clip, startTime });
      }
    }
  }
  return clips;
};
