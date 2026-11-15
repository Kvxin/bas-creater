<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { ref } from "vue";
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

const props = defineProps<{
  defaultValue?: string | number;
  modelValue?: string | number;
  class?: HTMLAttributes["class"];
}>();

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void;
}>();

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue
});

const inputRef = ref<HTMLInputElement | null>(null);

// 暴露方法给父组件
defineExpose({
  focus: () => inputRef.value?.focus(),
  select: () => inputRef.value?.select(),
  blur: () => inputRef.value?.blur(),
  el: inputRef
});
</script>

<template>
  <input
    ref="inputRef"
    v-model="modelValue"
    :class="
      cn(
        'flex h-8 w-full rounded-sm border border-border bg-input px-2.5 py-1 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-tertiary focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
        props.class
      )
    "
  />
</template>
