<script setup lang="ts">
import { computed } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TreeNodeItem } from "@/components/ui/tree";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const props = defineProps<{
  open: boolean;
  danmakuName: string;
  treeNodes: TreeNodeItem[];
  selectedKeys: Array<string | number>;
  getNodeIcon: (node: TreeNodeItem) => unknown;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "update:danmakuName", value: string): void;
  (e: "update:selectedKeys", value: Array<string | number>): void;
  (e: "confirm"): void;
  (e: "cancel"): void;
}>();

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const danmakuNameModel = computed({
  get: () => props.danmakuName,
  set: (value: string) => emit("update:danmakuName", value),
});

const selectedKeysModel = computed({
  get: () => props.selectedKeys,
  set: (value: Array<string | number>) => emit("update:selectedKeys", value),
});

const danmakuNameError = computed(() => {
  const value = danmakuNameModel.value.trim();
  if (!value) {
    return "弹幕名字不能为空";
  }

  const variablePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!variablePattern.test(value)) {
    return "仅允许字母、数字、下划线，且不能以数字开头";
  }

  return "";
});

const flattenedNodes = computed(() => {
  const collected: TreeNodeItem[] = [];

  function traverse(nodes: TreeNodeItem[]) {
    for (const node of nodes) {
      const hasChildren =
        Array.isArray(node.children) && node.children.length > 0;

      if (!hasChildren) {
        collected.push(node);
      }

      if (hasChildren) {
        traverse(node.children as TreeNodeItem[]);
      }
    }
  }

  traverse(props.treeNodes);

  return collected;
});

function handleCancel() {
  emit("update:open", false);
  emit("cancel");
}

function handleConfirm() {
  if (danmakuNameError.value) {
    return;
  }

  emit("confirm");
}

function toggleSelection(node: TreeNodeItem) {
  const current = [...selectedKeysModel.value];
  const index = current.findIndex((key) => key === node.id);

  if (index === -1) {
    current.splice(0, current.length, node.id);
  } else {
    current.splice(index, 1);
  }

  selectedKeysModel.value = current;
}
</script>

<template>
  <Dialog v-model:open="openModel">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>选择弹幕</DialogTitle>
        <DialogDescription>
          输入弹幕名称并从列表中选择一种弹幕类型。
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-2">
        <Input v-model="danmakuNameModel" placeholder="弹幕名字" />
        <p v-if="danmakuNameError" class="text-xs text-destructive">
          {{ danmakuNameError }}
        </p>
        <div class="grid gap-2 max-h-[60vh] overflow-auto">
          <button
            v-for="node in flattenedNodes"
            :key="node.id"
            type="button"
            class="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left transition hover:bg-accent/10"
            :class="{
              'bg-accent/20 border-primary text-primary':
                selectedKeysModel.includes(node.id),
            }"
            @click="toggleSelection(node)"
          >
            <div class="flex items-center gap-2">
              <component
                :is="getNodeIcon(node)"
                v-if="getNodeIcon(node)"
                class="text-muted-foreground"
                :class="{ 'text-primary': selectedKeysModel.includes(node.id) }"
              />
              <span class="text-sm font-medium">{{ node.label }}</span>
            </div>
            <span
              class="text-xs px-2 py-0.5 rounded-full border"
              :class="[
                selectedKeysModel.includes(node.id)
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground',
              ]"
            >
              {{ selectedKeysModel.includes(node.id) ? "已选择" : "未选择" }}
            </span>
          </button>
        </div>
      </div>
      <DialogFooter class="mt-2">
        <Button variant="ghost" @click="handleCancel">取消</Button>
        <Button
          @click="handleConfirm"
          :disabled="Boolean(danmakuNameError)"
        >
          确认
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
