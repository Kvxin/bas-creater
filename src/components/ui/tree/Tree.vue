<template>
  <div class="w-full space-y-2">
    <!-- Search -->
    <div class="relative">
      <Input v-model="query" placeholder="搜索..." class="pl-9" />
      <span
        class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        <svg
          class="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
    </div>

    <!-- Tree -->
    <div class="rounded-md border bg-background">
      <ul class="p-2">
        <TreeNode
          v-for="n in visibleTree"
          :key="n.id"
          :node="n"
          :level="0"
          :checkable="checkable"
          :expanded-keys="expandedKeysSet"
          :selected-keys="selectedKeysSet"
          :load-children="handleLazyLoad"
          :loading-keys="loadingKeys"
          @toggle-expand="onToggleExpand"
          @toggle-select="onToggleSelect"
        >
          <template #icon="p">
            <slot name="icon" v-bind="p" />
          </template>
          <template #label="p">
            <slot name="label" v-bind="p" />
          </template>
        </TreeNode>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { PropType } from "vue";
import { Input } from "@/components/ui/input";
import TreeNode from "./TreeNode.vue";

export interface TreeNodeItem {
  id: string | number;
  label: string;
  children?: TreeNodeItem[];
  hasChildren?: boolean;
  disabled?: boolean;
  selectable?: boolean;
  icon?: any;
  style?:string|object;
}

const props = defineProps({
  nodes: { type: Array as PropType<TreeNodeItem[]>, default: () => [] },
  selectedKeys: {
    type: Array as PropType<Array<string | number>>,
    default: () => [],
  },
  expandedKeys: {
    type: Array as PropType<Array<string | number>>,
    default: () => [],
  },
  checkable: { type: Boolean, default: true },
  lazyLoad: {
    type: Function as PropType<(node: TreeNodeItem) => Promise<TreeNodeItem[]>>,
    default: undefined,
  },
});

const emit = defineEmits<{
  (e: "update:selectedKeys", v: Array<string | number>): void;
  (e: "update:expandedKeys", v: Array<string | number>): void;
  (e: "node-click", n: TreeNodeItem): void;
  (e: "load-children", n: TreeNodeItem, children: TreeNodeItem[]): void;
}>();

// Internal state
const query = ref("");
const selectedKeysSet = ref(new Set(props.selectedKeys));
const expandedKeysSet = ref(new Set(props.expandedKeys));
const loadingKeys = reactive(new Set<string | number>());

watch(
  () => props.selectedKeys,
  (v) => (selectedKeysSet.value = new Set(v))
);
watch(
  () => props.expandedKeys,
  (v) => (expandedKeysSet.value = new Set(v))
);

// Work on a local deep copy so we can attach lazy children
const treeData = ref<TreeNodeItem[]>([]);
watch(
  () => props.nodes,
  (v) => {
    treeData.value = clone(v);
  },
  { immediate: true, deep: true }
);

function clone(nodes: TreeNodeItem[]): TreeNodeItem[] {
  return nodes.map((n) => ({
    ...n,
    children: n.children ? clone(n.children) : n.children,
  }));
}

// Filtering
const visibleTree = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return treeData.value;
  return filterTree(treeData.value, q);
});

function filterTree(nodes: TreeNodeItem[], q: string): TreeNodeItem[] {
  const res: TreeNodeItem[] = [];
  for (const n of nodes) {
    const labelHit = n.label.toLowerCase().includes(q);
    const kids = n.children ? filterTree(n.children, q) : [];
    if (labelHit || kids.length) {
      const copy: TreeNodeItem = { ...n, children: kids };
      res.push(copy);
      // auto-expand matched branches
      if (kids.length && !expandedKeysSet.value.has(n.id))
        expandedKeysSet.value.add(n.id);
    }
  }
  return res;
}

function syncSelected() {
  emit("update:selectedKeys", Array.from(selectedKeysSet.value));
}
function syncExpanded() {
  emit("update:expandedKeys", Array.from(expandedKeysSet.value));
}

function findNodeById(
  id: string | number,
  nodes: TreeNodeItem[] = treeData.value
): TreeNodeItem | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNodeById(id, n.children);
      if (found) return found;
    }
  }
  return null;
}

function collectLeaves(n: TreeNodeItem): TreeNodeItem[] {
  if (!n.children || n.children.length === 0) return [n];
  let res: TreeNodeItem[] = [];
  for (const c of n.children) res = res.concat(collectLeaves(c));
  return res;
}

function onToggleSelect(id: string | number) {
  const node = findNodeById(id);
  if (!node) return;
  if (!node.children || node.children.length === 0) {
    if (selectedKeysSet.value.has(id)) selectedKeysSet.value.delete(id);
    else selectedKeysSet.value.add(id);
    return syncSelected();
  }
  const leaves = collectLeaves(node);
  if (leaves.length === 0) {
    if (selectedKeysSet.value.has(id)) selectedKeysSet.value.delete(id);
    else selectedKeysSet.value.add(id);
    return syncSelected();
  }
  const allSelected = leaves.every((l) => selectedKeysSet.value.has(l.id));
  if (allSelected) {
    for (const l of leaves) selectedKeysSet.value.delete(l.id);
  } else {
    for (const l of leaves) selectedKeysSet.value.add(l.id);
  }
  syncSelected();
}

function onToggleExpand(id: string | number) {
  if (expandedKeysSet.value.has(id)) expandedKeysSet.value.delete(id);
  else expandedKeysSet.value.add(id);
  syncExpanded();
}

async function handleLazyLoad(node: TreeNodeItem) {
  if (!props.lazyLoad) return;
  if (loadingKeys.has(node.id)) return;
  loadingKeys.add(node.id);
  try {
    const children = await props.lazyLoad(node);
    node.children = children;
    emit("load-children", node, children);
  } finally {
    loadingKeys.delete(node.id);
  }
}
</script>
