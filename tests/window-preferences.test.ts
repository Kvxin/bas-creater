import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { useWindowPreferencesStore } from "../src/stores/windowPreferences";

Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
Object.defineProperty(globalThis, "isTauri", { value: true, writable: true, configurable: true });
afterEach(() => clearMocks());

test("uses native Linux decorations and switches shared header controls after successful IPC", async () => {
  setActivePinia(createPinia());
  const calls: string[] = [];
  mockIPC((command, args) => {
    calls.push(command);
    if (command === "get_window_preferences") return { platform: "linux", useAppWindowControls: false };
    if (command === "set_app_window_controls") return { platform: "linux", useAppWindowControls: args?.enabled };
    throw new Error(`Unexpected command: ${command}`);
  });
  const store = useWindowPreferencesStore();
  await store.initialize();
  assert.equal(store.isLinux, true);
  assert.equal(store.hasCustomControls, false);
  assert.equal(store.usesCustomTitleBar, false);
  await store.setCustomControls(true);
  assert.equal(store.hasCustomControls, true);
  assert.equal(store.usesCustomTitleBar, true);
  await store.setCustomControls(false);
  assert.equal(store.hasCustomControls, false);
  assert.deepEqual(calls, ["get_window_preferences", "set_app_window_controls", "set_app_window_controls"]);
});

test("failed native decoration change leaves the displayed preference unchanged", async () => {
  setActivePinia(createPinia());
  mockIPC(command => {
    if (command === "get_window_preferences") return { platform: "linux", useAppWindowControls: false };
    throw new Error("window manager refused decorations");
  });
  const store = useWindowPreferencesStore();
  await store.initialize();
  await store.setCustomControls(true);
  assert.equal(store.hasCustomControls, false);
  assert.equal(store.hasError, true);
  assert.equal(store.isSaving, false);
});

test("macOS retains traffic lights and Windows retains app controls without a Linux toggle", async () => {
  for (const platform of ["macos", "windows"]) {
    setActivePinia(createPinia());
    const calls: string[] = [];
    mockIPC(command => {
      calls.push(command);
      return { platform, useAppWindowControls: platform === "windows" };
    });
    const store = useWindowPreferencesStore();
    await store.initialize();
    assert.equal(store.hasTrafficLights, platform === "macos");
    assert.equal(store.hasCustomControls, platform === "windows");
    assert.equal(store.isLinux, false);
    await store.setCustomControls(true);
    assert.deepEqual(calls, ["get_window_preferences"]);
  }
});

test("web builds have no window controls and never call native IPC", async () => {
  Object.defineProperty(globalThis, "isTauri", { value: false, writable: true, configurable: true });
  try {
    setActivePinia(createPinia());
    mockIPC(() => {
      throw new Error("Web build must not invoke native IPC");
    });
    const store = useWindowPreferencesStore();
    await store.initialize();
    assert.equal(store.preferences.platform, "web");
    assert.equal(store.hasCustomControls, false);
    assert.equal(store.hasTrafficLights, false);
    assert.equal(store.hasError, false);
    // 即使状态中出现桌面偏好，网页也不能显示窗口按钮或 Linux 设置。
    for (const platform of ["linux", "macos", "windows"]) {
      store.preferences = { platform, useAppWindowControls: true };
      assert.equal(store.isLinux, false);
      assert.equal(store.hasCustomControls, false);
      assert.equal(store.hasTrafficLights, false);
      assert.equal(store.usesCustomTitleBar, false);
      await store.setCustomControls(true);
    }
  } finally {
    Object.defineProperty(globalThis, "isTauri", { value: true, writable: true, configurable: true });
  }
});
