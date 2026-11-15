<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
  defaultValue?: string | number;
  modelValue?: string | number;
}>();

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void;
}>();

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue
});
</script>

<template>
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="
      cn(
        'border-border placeholder:text-tertiary focus-visible:border-primary aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-sm border bg-input px-2.5 py-2 text-sm transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50',
        props.class
      )
    "
  />
</template>
