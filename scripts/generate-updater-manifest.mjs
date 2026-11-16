import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const generateUpdaterManifest = ({ directory, tag, repository, prefix = "DanmakuCut" }) => {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? "")) throw new Error("Invalid release tag");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid release repository");
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  const assets = {
    "windows-x86_64-msi": "Windows-x86_64.msi",
    "windows-x86_64-nsis": "Windows-x86_64-Setup.exe",
    "windows-aarch64-msi": "Windows-arm64.msi",
    "windows-aarch64-nsis": "Windows-arm64-Setup.exe",
    "linux-x86_64": "Linux-x86_64.AppImage",
    "linux-aarch64": "Linux-arm64.AppImage",
    "darwin-x86_64": "macOS.app.tar.gz",
    "darwin-aarch64": "macOS.app.tar.gz"
  };
  const platforms = {};
  for (const [platform, suffix] of Object.entries(assets)) {
    const name = `${prefix}-${tag}-${suffix}`;
    if (!statSync(join(directory, name)).isFile() || statSync(join(directory, name)).size === 0) {
      throw new Error(`Missing or empty update artifact: ${name}`);
    }
    const signature = readFileSync(join(directory, `${name}.sig`), "utf8").trim();
    if (!signature || !/^[A-Za-z0-9+/=]+$/.test(signature)) throw new Error(`Invalid signature: ${name}`);
    platforms[platform] = { url: `${base}/${name}`, signature };
  }
  // 未带安装形式标识的客户端仅用于检查；正式安装版优先匹配 msi / nsis 专用键。
  platforms["windows-x86_64"] = platforms["windows-x86_64-nsis"];
  platforms["windows-aarch64"] = platforms["windows-aarch64-nsis"];
  return {
    version: tag.slice(1),
    notes: `DanmakuCut ${tag}\nhttps://github.com/${repository}/releases/tag/${tag}`,
    pub_date: new Date().toISOString(),
    platforms
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? "release-assets";
  const manifest = generateUpdaterManifest({
    directory,
    tag: process.env.RELEASE_TAG,
    repository: process.env.RELEASE_REPOSITORY,
    prefix: process.env.APP_ASSET_PREFIX
  });
  writeFileSync(join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated latest.json for ${manifest.version} (${Object.keys(manifest.platforms).length} targets)`);
}
