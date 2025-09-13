<template>
  <li>
    <div class="flex items-center gap-1 py-1 pl-2" :style="{ paddingLeft: `${level * 14}px` }">
      <span v-if="level > 0" class="relative mx-0.5 h-4 w-3">
        <span class="absolute left-[10px] top-1/2 w-3 h-px bg-border"></span>
      </span>

      <!-- caret / spinner placeholder area -->
      <button
        class="size-5 grid place-items-center rounded hover:bg-accent text-muted-foreground disabled:opacity-50"
        :disabled="!hasChildren"
        @click="toggleExpand"
        aria-label="toggle"
      >
        <svg
          v-if="!loading"
          :class="['size-3 transition-transform', expanded ? 'rotate-90' : '']"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <svg v-else class="size-3 animate-spin" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r="10"
            class="text-muted-foreground/30"
            stroke="currentColor"
            stroke-width="4"
            fill="none"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            stroke-width="4"
            fill="none"
          />
        </svg>
      </button>

      <!-- custom icon slot -->
      <div class="w-4 h-4 mx-1 text-muted-foreground">
        <slot name="icon" :node="node" :expanded="expanded" />
      </div>

      <!-- checkbox -->
      <label
        class="inline-flex items-center gap-2 cursor-pointer select-none text-sm text-foreground/90"
      >
        <input
          v-if="checkable"
          type="checkbox"
          class="size-4 rounded border-input bg-background text-primary focus-visible:ring-2 focus-visible:ring-ring"
          :checked="checked"
          :indeterminate="indeterminate"
          :disabled="node.disabled"
          @change="toggleSelect"
        />
        <slot name="label" :node="node">
          <span :class="node.disabled ? 'opacity-50' : ''">{{
            node.label
          }}</span>
        </slot>
      </label>
    </div>

    <ul v-show="expanded" v-if="hasChildren && node.children?.length" class="relative ml-2 pl-3">
      <div class="absolute left-[10px] top-0 bottom-0 w-px bg-border"></div>
      <TreeNode
        v-for="c in node.children"
        :key="c.id"
        :node="c"
        :level="level + 1"
        :checkable="checkable"
        :expanded-keys="expandedKeys"
        :selected-keys="selectedKeys"
        :load-children="loadChildren"
        :loading-keys="loadingKeys"
        @toggle-expand="$emit('toggle-expand', $event)"
        @toggle-select="$emit('toggle-select', $event)"
      >
        <template #icon="p">
          <slot name="icon" v-bind="p" />
        </template>
        <template #label="p">
          <slot name="label" v-bind="p" />
        </template>
      </TreeNode>
    </ul>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PropType } from "vue";
import type { TreeNodeItem } from "./Tree.vue";

const props = defineProps({
  node: { type: Object as PropType<TreeNodeItem>, required: true },
  level: { type: Number, default: 0 },
  checkable: { type: Boolean, default: true },
  expandedKeys: {
    type: Object as PropType<Set<string | number>>,
    required: true,
  },
  selectedKeys: {
    type: Object as PropType<Set<string | number>>,
    required: true,
  },
  loadChildren: {
    type: Function as PropType<(n: TreeNodeItem) => Promise<void>>,
    default: undefined,
  },
  loadingKeys: {
    type: Object as PropType<Set<string | number>>,
    required: true,
  },
});

const emit = defineEmits<{
  (e: "toggle-expand", id: string | number): void;
  (e: "toggle-select", id: string | number): void;
}>();

const hasChildren = computed(
  () => !!(props.node.children?.length || props.node.hasChildren)
);
const expanded = computed(() => props.expandedKeys.has(props.node.id));

function computeState(n: TreeNodeItem): { all: boolean; some: boolean } {
  if (!n.children || n.children.length === 0) {
    const sel = props.selectedKeys.has(n.id)
    return { all: sel, some: sel }
  }
  let all = true
  let some = false
  for (const c of n.children) {
    const s = computeState(c)
    all = all && s.all
    some = some || s.some
  }
  return { all, some }
}

const state = computed(() => computeState(props.node))
const checked = computed(() => state.value.all)
const indeterminate = computed(() => !state.value.all && state.value.some)

const loading = computed(() => props.loadingKeys.has(props.node.id));

async function toggleExpand() {
  if (!hasChildren.value) return;
  if (
    !props.node.children?.length &&
    props.node.hasChildren &&
    props.loadChildren
  ) {
    await props.loadChildren(props.node);
  }
  emit("toggle-expand", props.node.id);
}

function toggleSelect() {
  if (props.node.disabled) return;
  emit("toggle-select", props.node.id);
}
</script>
