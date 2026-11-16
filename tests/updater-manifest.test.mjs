import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateUpdaterManifest } from "../scripts/generate-updater-manifest.mjs";

const withArtifacts = run => {
  const directory = mkdtempSync(join(tmpdir(), "bas-updater-"));
  try {
    const names = [
      "Windows-x86_64.msi",
      "Windows-x86_64-Setup.exe",
      "Windows-arm64.msi",
      "Windows-arm64-Setup.exe",
      "Linux-x86_64.AppImage",
      "Linux-arm64.AppImage",
      "macOS.app.tar.gz"
    ];
    for (const suffix of names) {
      const name = join(directory, `DanmakuCut-v1.2.3-${suffix}`);
      writeFileSync(name, "installer fixture");
      writeFileSync(`${name}.sig`, Buffer.from(suffix).toString("base64"));
    }
    run({ directory, tag: "v1.2.3", repository: "Kvxin/bas-creater" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("maps Windows installer types separately and both Mac architectures to Universal", () => {
  withArtifacts(options => {
    const result = generateUpdaterManifest(options);
    assert.equal(result.version, "1.2.3");
    assert.equal(Object.keys(result.platforms).length, 10);
    assert.match(result.platforms["windows-aarch64-msi"].url, /Windows-arm64\.msi$/);
    assert.match(result.platforms["windows-x86_64-nsis"].url, /Windows-x86_64-Setup\.exe$/);
    assert.deepEqual(result.platforms["darwin-aarch64"], result.platforms["darwin-x86_64"]);
    assert.match(result.platforms["linux-aarch64"].url, /Linux-arm64\.AppImage$/);
    assert.ok(!Object.values(result.platforms).some(entry => entry.url.includes("Portable")));
  });
});

test("refuses publication when one platform artifact or signature is missing", () => {
  withArtifacts(options => {
    rmSync(join(options.directory, "DanmakuCut-v1.2.3-Windows-arm64.msi.sig"));
    assert.throws(() => generateUpdaterManifest(options));
  });
});

test("rejects empty signatures and malformed release identifiers", () => {
  withArtifacts(options => {
    writeFileSync(join(options.directory, "DanmakuCut-v1.2.3-Linux-x86_64.AppImage.sig"), "");
    assert.throws(() => generateUpdaterManifest(options), /Invalid signature/);
    assert.throws(() => generateUpdaterManifest({ ...options, tag: "main" }), /Invalid release tag/);
    assert.throws(
      () => generateUpdaterManifest({ ...options, repository: "../invalid/repo" }),
      /Invalid release repository/
    );
  });
});
