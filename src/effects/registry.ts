import { shallowRef } from "vue";
import { defaultEffectParams, type EffectPlugin } from "./types";
import { assertPlugin, validateEffectParams } from "./validation";

type EntryPoints = Record<string, () => Promise<unknown>>;
interface Catalog {
  plugins: EffectPlugin[];
  errors: { entry: string; message: string }[];
}

export async function discoverEffects(entries: EntryPoints): Promise<Catalog> {
  const paths = Object.keys(entries).sort();
  const results = await Promise.allSettled(
    paths.map(async path => {
      const plugin = await entries[path]!();
      assertPlugin(plugin);
      validateEffectParams(plugin, defaultEffectParams(plugin));
      return plugin;
    })
  );
  const catalog: Catalog = { plugins: [], errors: [] };
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.status === "fulfilled") counts.set(result.value.id, (counts.get(result.value.id) ?? 0) + 1);
  }
  results.forEach((result, index) => {
    const entry = paths[index]!;
    if (result.status === "rejected") {
      catalog.errors.push({ entry, message: String(result.reason) });
    } else if (counts.get(result.value.id)! > 1) {
      catalog.errors.push({ entry, message: `Duplicate plugin ID: ${result.value.id}` });
    } else {
      catalog.plugins.push(result.value);
    }
  });
  return catalog;
}

export const effectCatalog = shallowRef<Catalog | null>(null);
let pending: Promise<Catalog> | undefined;
export function loadEffects() {
  pending ??= discoverEffects(import.meta.glob("./plugins/*/index.ts", { import: "default" })).then(catalog => {
    effectCatalog.value = catalog;
    return catalog;
  });
  return pending;
}

// 浏览器在 dragover 阶段保护载荷；本地拖动状态只用于相容目标的高亮。
export const EFFECT_DRAG_TYPE = "application/x-bas-clip-effect";
export const draggedEffect = shallowRef<EffectPlugin | null>(null);
