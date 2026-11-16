import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { useAppUpdateStore } from "../src/stores/appUpdate";
import { registerUpdatePreparation } from "../src/services/updatePreparation";
import type { AppUpdateStatus } from "../src/types/appUpdate";

// 仅隔离 Tauri IPC；检查、下载、保存门禁及安装状态运行真实 store 实现。
Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });

const available: AppUpdateStatus = {
  currentVersion: "1.0.0",
  supported: true,
  availableVersion: "1.1.0",
  notes: "Update",
  ready: false
};

afterEach(() => clearMocks());

test("automatic download checks once and makes the verified package ready", async () => {
  setActivePinia(createPinia());
  const calls: string[] = [];
  mockIPC(command => {
    calls.push(command);
    if (command === "check_app_update") return available;
    if (command === "download_app_update") return { ...available, ready: true };
    throw new Error(`Unexpected command: ${command}`);
  });
  const store = useAppUpdateStore();
  store.autoDownload = true;
  await store.check();
  assert.deepEqual(calls, ["check_app_update", "download_app_update"]);
  assert.equal(store.status?.ready, true);
  assert.equal(store.isBusy, false);
});

test("portable and unsupported builds cannot download or invoke installation", async () => {
  setActivePinia(createPinia());
  const calls: string[] = [];
  mockIPC(command => {
    calls.push(command);
    return { ...available, supported: false };
  });
  const store = useAppUpdateStore();
  store.autoDownload = true;
  await store.check();
  await store.download();
  store.status = { ...available, supported: false, ready: true };
  await store.install();
  assert.deepEqual(calls, ["check_app_update"]);
});

test("failed project save prevents the native installer from running", async () => {
  setActivePinia(createPinia());
  const calls: string[] = [];
  mockIPC(command => {
    calls.push(command);
  });
  const unregister = registerUpdatePreparation(async () => false);
  try {
    const store = useAppUpdateStore();
    store.status = { ...available, ready: true };
    await store.install();
    assert.deepEqual(calls, []);
    assert.equal(store.error, "updates.saveFailed");
    assert.equal(store.isInstalling, false);
  } finally {
    unregister();
  }
});

test("installation waits for project save and reports native installation errors", async () => {
  setActivePinia(createPinia());
  const calls: string[] = [];
  mockIPC(command => {
    calls.push(command);
    throw new Error("installer failed");
  });
  const unregister = registerUpdatePreparation(async () => {
    calls.push("save");
    return true;
  });
  try {
    const store = useAppUpdateStore();
    store.status = { ...available, ready: true };
    await store.install();
    assert.deepEqual(calls, ["save", "install_app_update"]);
    assert.equal(store.error, "updates.installFailed");
    assert.equal(store.isBusy, false);
  } finally {
    unregister();
  }
});

test("failed verification never enables the install action", async () => {
  setActivePinia(createPinia());
  mockIPC(command => {
    if (command === "check_app_update") return available;
    if (command === "download_app_update") throw new Error("signature mismatch");
    throw new Error(`Unexpected command: ${command}`);
  });
  const store = useAppUpdateStore();
  store.autoDownload = true;
  await store.check();
  assert.equal(store.status?.ready, false);
  assert.equal(store.error, "updates.downloadFailed");
  await store.install();
  assert.equal(store.isInstalling, false);
});
