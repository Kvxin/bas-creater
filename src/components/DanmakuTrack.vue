<script setup lang="ts">
import { ref, computed } from "vue";

interface Props {
  parseResult: any;
}

interface Emits {
  (e: "delete-def", index: number): void;
  (e: "delete-keyframe", index: number): void;
  (e: "add-def"): void;
  (e: "add-keyframe"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const expandedAttrs = ref<Set<string>>(new Set());

function toggleAttrs(itemId: string) {
  if (expandedAttrs.value.has(itemId)) {
    expandedAttrs.value.delete(itemId);
  } else {
    expandedAttrs.value.add(itemId);
  }
}

function getTypeColor(type: string) {
  switch (type) {
    case "DefText":
      return "#4CAF50"; // 绿色
    case "DefButton":
      return "#2196F3"; // 蓝色
    case "DefPath":
      return "#FF9800"; // 橙色
    default:
      return "#9E9E9E"; // 灰色
  }
}

function formatAttrValue(attr: any, key?: string | number): string {
  if (typeof attr === "object" && attr !== null) {
    if (attr.numType && attr.value !== undefined) {
      return `${attr.value}${attr.numType === "percent" ? "%" : ""}`;
    }
    return JSON.stringify(attr);
  }
  return String(attr);
}

function isExpandableObject(attr: any, key?: string | number): boolean {
  if (typeof attr !== "object" || attr === null) return false;
  if (attr.numType && attr.value !== undefined) return false;

  // target 字段和其他复杂对象都可以展开
  return String(key) === "target" || Object.keys(attr).length > 1;
}

function getAnimationKeyframes(sets: any[]): any[] {
  if (!sets || sets.length === 0) return [];

  const keyframes: any[] = [];

  sets.forEach((set, index) => {
    if (set.type === "Unit") {
      keyframes.push({
        id: `keyframe-${index}`,
        duration: set.duration || 0,
        target: set.targetName || set.target_name,
        attrs: set.attrs || {},
        easing: set.defaultEasing || set.default_easing?.value || "linear",
        originalIndex: index,
      });
    } else if (set.type === "Serial" && set.items) {
      set.items.forEach((item: any, itemIndex: number) => {
        keyframes.push({
          id: `serial-${index}-${itemIndex}`,
          duration: item.duration || 0,
          target: item.targetName || item.target_name,
          attrs: item.attrs || {},
          easing: item.defaultEasing || item.default_easing?.value || "linear",
          isSerial: true,
          originalIndex: index,
        });
      });
    }
  });

  return keyframes;
}

function deleteDef(index: number) {
  emit("delete-def", index);
}

function deleteKeyframe(keyframe: any) {
  emit("delete-keyframe", keyframe.originalIndex);
}

function addDef() {
  emit("add-def");
}

function addKeyframe() {
  emit("add-keyframe");
}
</script>

<template>
  <div class="timeline-container">
    <div class="timeline-header">
      <h3>弹幕轨道</h3>
    </div>

    <!-- 定义对象轨道 -->
    <div
      v-if="parseResult?.defs && parseResult.defs.length > 0"
      class="track-section"
    >
      <div class="section-header">
        <div class="section-title">对象定义</div>
        <button class="add-btn" @click="addDef">+ 添加对象</button>
      </div>

      <div
        v-for="(def, index) in parseResult.defs"
        :key="`def-${index}`"
        class="track-item"
        :style="{ borderLeftColor: getTypeColor(def.type) }"
      >
        <div class="track-header" @click="toggleAttrs(`def-${index}`)">
          <div
            class="track-type"
            :style="{ backgroundColor: getTypeColor(def.type) }"
          >
            {{ def.obj_type || def.type.replace("Def", "").toLowerCase() }}
          </div>
          <div class="track-name">{{ def.name }}</div>
          <div class="track-actions">
            <button class="delete-btn" @click.stop="deleteDef(index)">×</button>
            <div class="track-expand">
              {{ expandedAttrs.has(`def-${index}`) ? "▼" : "▶" }}
            </div>
          </div>
        </div>

        <div v-if="expandedAttrs.has(`def-${index}`)" class="track-attrs">
          <div v-for="(value, key) in def.attrs" :key="key" class="attr-item">
            <div class="attr-main">
              <span class="attr-key">{{ key }}</span>
              <span v-if="!isExpandableObject(value, key)" class="attr-value">{{
                formatAttrValue(value, key)
              }}</span>
              <span
                v-else
                class="attr-expand"
                @click="toggleAttrs(`def-${index}-${key}`)"
              >
                <span class="attr-value-preview">{{
                  String(key) === "target" ? `类型: ${value.objType}` : "Object"
                }}</span>
                <span class="expand-icon">{{
                  expandedAttrs.has(`def-${index}-${key}`) ? "▼" : "▶"
                }}</span>
              </span>
            </div>

            <!-- 嵌套属性展开 -->
            <div
              v-if="
                isExpandableObject(value, key) &&
                expandedAttrs.has(`def-${index}-${key}`)
              "
              class="nested-attrs"
            >
              <div
                v-for="(nestedValue, nestedKey) in value"
                :key="nestedKey"
                class="nested-attr-item"
              >
                <span class="nested-attr-key">{{ nestedKey }}</span>
                <span class="nested-attr-value">{{
                  formatAttrValue(nestedValue, nestedKey)
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 动画轨道 -->
    <div
      v-if="parseResult?.sets && parseResult.sets.length > 0"
      class="track-section"
    >
      <div class="section-header">
        <div class="section-title">动画关键帧</div>
        <button class="add-btn" @click="addKeyframe">+ 添加动画</button>
      </div>

      <div
        v-for="keyframe in getAnimationKeyframes(parseResult.sets)"
        :key="keyframe.id"
        class="keyframe-item"
        :class="{ 'serial-keyframe': keyframe.isSerial }"
      >
        <div class="keyframe-header">
          <div class="keyframe-type">动画</div>
          <div class="keyframe-target">{{ keyframe.target }}</div>
          <div class="keyframe-duration">{{ keyframe.duration }}ms</div>
          <div class="keyframe-easing">{{ keyframe.easing }}</div>
          <button class="delete-btn" @click="deleteKeyframe(keyframe)">
            ×
          </button>
        </div>

        <div class="keyframe-attrs">
          <div
            v-for="(value, key) in keyframe.attrs"
            :key="key"
            class="attr-item small"
          >
            <span class="attr-key">{{ key }}</span>
            <span class="attr-value">{{ formatAttrValue(value, key) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 专业视频轨道样式 */
.timeline-container {
  margin-top: 20px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.timeline-header {
  margin-bottom: 16px;
}

.timeline-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #2c3e50;
}

.track-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #34495e;
  padding-left: 8px;
  border-left: 3px solid #3498db;
}

.add-btn {
  padding: 4px 8px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.add-btn:hover {
  background: #2980b9;
}

.track-item {
  background: #ffffff;
  border: 1px solid #e1e8ed;
  border-left: 4px solid #3498db;
  margin-bottom: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.track-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.track-header:hover {
  background: #f8f9fa;
}

.track-type {
  padding: 4px 8px;
  border-radius: 12px;
  color: white;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  min-width: 60px;
  text-align: center;
  margin-right: 12px;
}

.track-name {
  font-weight: 600;
  color: #2c3e50;
  flex: 1;
  font-size: 14px;
}

.track-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.delete-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: #e74c3c;
  color: white;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}

.delete-btn:hover {
  background: #c0392b;
}

.track-expand {
  color: #7f8c8d;
  font-size: 12px;
}

.track-attrs {
  padding: 0 16px 16px 16px;
  background: #f8f9fa;
  border-top: 1px solid #e1e8ed;
}

.attr-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #ecf0f1;
}

.attr-item:last-child {
  border-bottom: none;
}

.attr-item.small {
  padding: 4px 0;
  font-size: 12px;
}

.attr-key {
  font-weight: 500;
  color: #34495e;
  font-size: 13px;
}

.attr-value {
  color: #7f8c8d;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 12px;
  background: #ecf0f1;
  padding: 2px 6px;
  border-radius: 3px;
}

/* 动画关键帧样式 */
.keyframe-item {
  background: #ffffff;
  border: 1px solid #e1e8ed;
  border-left: 4px solid #e74c3c;
  margin-bottom: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.keyframe-item.serial-keyframe {
  border-left-color: #f39c12;
}

.keyframe-header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: #fdfdfd;
}

.keyframe-type {
  padding: 3px 8px;
  border-radius: 10px;
  background: #e74c3c;
  color: white;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  margin-right: 12px;
}

.serial-keyframe .keyframe-type {
  background: #f39c12;
}

.keyframe-target {
  font-weight: 600;
  color: #2c3e50;
  margin-right: 12px;
  font-size: 13px;
}

.keyframe-duration {
  color: #7f8c8d;
  font-size: 12px;
  margin-right: 12px;
  font-family: "Consolas", "Monaco", monospace;
}

.keyframe-easing {
  color: #95a5a6;
  font-size: 11px;
  font-style: italic;
  flex: 1;
}

.keyframe-attrs {
  padding: 8px 16px 12px 16px;
  background: #f8f9fa;
}

/* 嵌套属性样式 */
.attr-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.attr-expand {
  display: flex;
  align-items: center;
  cursor: pointer;
  gap: 8px;
}

.attr-value-preview {
  color: #7f8c8d;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 12px;
  background: #ecf0f1;
  padding: 2px 6px;
  border-radius: 3px;
}

.expand-icon {
  color: #95a5a6;
  font-size: 10px;
}

.nested-attrs {
  margin-top: 8px;
  margin-left: 16px;
  padding-left: 12px;
  border-left: 2px solid #ecf0f1;
}

.nested-attr-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid #f8f9fa;
}

.nested-attr-item:last-child {
  border-bottom: none;
}

.nested-attr-key {
  font-weight: 500;
  color: #7f8c8d;
  font-size: 12px;
}

.nested-attr-value {
  color: #95a5a6;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 11px;
  background: #f8f9fa;
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
