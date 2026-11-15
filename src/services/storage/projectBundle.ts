import type { BasProjectData, ProjectAsset, SerializedAudioMetadata } from "@/types/storage";
import { isDesktopApp } from "@/utils/desktop";
import { pickDesktopDirectory, readDesktopAudio } from "./desktopProjectFile";
import { pickProjectDirectory } from "./browserProjectFile";
import { projectSessionDirectory } from "./projectStorage";
import { commitBundleTarget, createBundleTarget, readProjectAudio, writeProjectAudio } from "./projectAssets";

type AudioAsset = Extract<ProjectAsset, { type: "audio-file" }>;
type Source = { meta: SerializedAudioMetadata; asset?: AudioAsset };

/** Collect a snapshot without saving or otherwise modifying the open project. */
export async function bundleProject(projectId: string, snapshot: () => BasProjectData): Promise<boolean> {
  // The picker must be invoked before any await so browser user activation is retained.
  const directory = isDesktopApp() ? await pickDesktopDirectory() : await pickProjectDirectory();
  if (!directory) return false;

  const project: BasProjectData = JSON.parse(JSON.stringify(snapshot()));
  const sourceDirectory = projectSessionDirectory(projectId);
  const sources = new Map<string, Source>();
  for (const meta of project.audioMeta) sources.set(meta.id, { meta });
  for (const asset of project.assets) {
    if (asset.type === "audio-file") sources.set(asset.id, { meta: asset.audio, asset });
  }

  // Resolve everything first: an offline source must not produce a successful archive.
  const files: { id: string; file: File; name: string }[] = [];
  for (const [id, { meta, asset }] of sources) {
    const location = asset?.location;
    const external = location?.kind === "external" ? location.path : !location ? meta.sourcePath : undefined;
    const relative = location?.kind === "project" ? location.path : !location ? meta.relativePath : undefined;
    try {
      let file: File;
      if (external && typeof sourceDirectory === "string") file = await readDesktopAudio(external, meta.type);
      else if (relative && sourceDirectory) file = await readProjectAudio(sourceDirectory, relative, meta.type);
      else throw new Error("AUDIO_SOURCE_UNAVAILABLE");
      const extension = /\.([a-z0-9]{1,10})$/i.exec(meta.name)?.[1]?.toLowerCase();
      files.push({ id, file, name: `${crypto.randomUUID()}${extension ? `.${extension}` : ""}` });
    } catch {
      throw new Error(`AUDIO_OFFLINE: ${meta.name || id}`);
    }
  }

  project.id = crypto.randomUUID();
  const now = Date.now();
  project.createdAt = now;
  project.updatedAt = now;
  const paths = new Map(files.map(({ id, name }) => [id, name]));
  for (const meta of project.audioMeta) {
    const name = paths.get(meta.id);
    if (name) { delete meta.sourcePath; meta.relativePath = name; }
  }
  for (const asset of project.assets) {
    if (asset.type !== "audio-file") continue;
    const name = paths.get(asset.id);
    if (name) {
      delete asset.audio.sourcePath;
      asset.audio.relativePath = name;
      asset.location = { kind: "project", path: name };
    }
  }
  const safeName = project.name.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/[. ]+$/, "") || "Project";
  const target = await createBundleTarget(directory, `${safeName} - copy - ${project.id}`, project.id);
  for (const { name, file } of files) await writeProjectAudio(target.assetDirectory, name, file);
  await commitBundleTarget(target, project);
  return true;
}
