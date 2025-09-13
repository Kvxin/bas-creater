<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import bas, { parseBasDSL } from "@/utils/bas";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import DanmakuTrack from "@/components/DanmakuTrack.vue";

const containerRef = ref<HTMLDivElement | null>(null);
const dslText = ref<string>(`def text c {
    content = "bilibili"
    fontSize = 10%
    x = 50%
    y = 50%
    anchorX = 0.5
    anchorY = 0.5
}`);
const exampleText = ref<string>("Hello BAS");
const seekSec = ref<number>(0);
const parseResult = ref<any>(null);

onMounted(() => {
  if (containerRef.value) {
    bas.init({
      container: containerRef.value,
      easing: "linear",
      visible: true,
      timeSyncFunc: () => Date.now(), // 与系统时钟同步（毫秒）
    });
  }
});

function addExample() {
  bas.addTextExample(exampleText.value || "Hello BAS");
}

function addButton() {
  bas.addButtonExample("点击我");
}

function addFromDSL() {
  bas.addFromDSL(dslText.value);
}

function play() {
  bas.play();
}
function pause() {
  bas.pause();
}
function toggle() {
  bas.toggle();
}
function clearAll() {
  bas.clear();
}
function seekNow() {
  bas.seek(Number(seekSec.value) || 0, true);
}

async function parseDanmaku() {
  try {
    const res = await parseBasDSL(dslText.value);
    console.log("BAS parse result:", JSON.stringify(res));
    parseResult.value = res;
  } catch (err) {
    console.error("BAS parse error:", err);
    parseResult.value = null;
  }
}

// 增删弹幕功能
function deleteDef(index: number) {
  if (parseResult.value?.defs) {
    parseResult.value.defs.splice(index, 1);
  }
}

function deleteKeyframe(index: number) {
  if (parseResult.value?.sets) {
    parseResult.value.sets.splice(index, 1);
  }
}

function addDef() {
  if (!parseResult.value) {
    parseResult.value = { defs: [], sets: [] };
  }
  if (!parseResult.value.defs) {
    parseResult.value.defs = [];
  }

  // 添加一个默认的文本对象
  const newDef = {
    type: "DefText",
    obj_type: "text",
    name: `text_${parseResult.value.defs.length + 1}`,
    attrs: {
      content: "新文本",
      alpha: { numType: "number", value: 1 },
      color: 16777215,
      anchorX: { numType: "number", value: 0.5 },
      anchorY: { numType: "number", value: 0.5 },
      fontSize: { numType: "percent", value: 5 },
      fontFamily: "SimHei",
      bold: { numType: "number", value: 1 },
      textShadow: { numType: "number", value: 1 },
      strokeWidth: { numType: "number", value: 0 },
      strokeColor: 16777215,
      rotateX: { numType: "number", value: 0 },
      rotateY: { numType: "number", value: 0 },
      rotateZ: { numType: "number", value: 0 },
      x: { numType: "percent", value: 50 },
      y: { numType: "percent", value: 50 },
      zIndex: { numType: "number", value: 0 },
      scale: { numType: "number", value: 1 }
    },
    _reg_order: parseResult.value.defs.length
  };

  parseResult.value.defs.push(newDef);
}

function addKeyframe() {
  if (!parseResult.value) {
    parseResult.value = { defs: [], sets: [] };
  }
  if (!parseResult.value.sets) {
    parseResult.value.sets = [];
  }

  // 添加一个默认的动画关键帧
  const newKeyframe = {
    type: "Unit",
    duration: 1000,
    target_name: "text_1",
    attrs: {
      x: { numType: "percent", value: 80 },
      y: { numType: "percent", value: 80 }
    },
    targetName: "text_1"
  };

  parseResult.value.sets.push(newKeyframe);
}
</script>

<template>
  <div class="page">
    <div class="panel">
      <div class="row">
        <label>示例文本</label>
        <Input v-model="exampleText" placeholder="Hello BAS" />
        <button class="btn" @click="addExample">添加示例文本</button>
        <button class="btn" @click="addButton">添加示例按钮</button>
      </div>

      <div class="row">
        <label>DSL 文本</label>
        <Textarea v-model="dslText" />
        <button class="btn" @click="addFromDSL">通过 DSL 添加</button>
      </div>

      <div class="row">
        <label>Seek 秒</label>
        <Input v-model="seekSec" type="number" />
        <button class="btn" @click="seekNow">跳转</button>
      </div>

      <div class="row">
        <button class="btn" @click="play">播放</button>
        <button class="btn" @click="pause">暂停</button>
        <button class="btn" @click="toggle">切换</button>
        <button class="btn" @click="clearAll">清空</button>
      </div>

      <div class="row">
        <Button class="btn" @click="parseDanmaku">解析弹幕</Button>
        <Textarea v-model="dslText" />
      </div>
    </div>

    <div ref="containerRef" class="stage"></div>
  </div>

  <!-- 使用新的 DanmakuTrack 组件 -->
  <DanmakuTrack
    v-if="parseResult"
    :parseResult="parseResult"
    @delete-def="deleteDef"
    @delete-keyframe="deleteKeyframe"
    @add-def="addDef"
    @add-keyframe="addKeyframe"
  />
</template>

<style scoped>
.page {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 16px;
  padding: 16px;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: grid;
  grid-template-columns: 84px 1fr auto auto auto;
  gap: 8px;
  align-items: center;
}
label {
  font-size: 12px;
  color: #666;
}
.btn {
  padding: 6px 10px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
}
.stage {
  position: relative;
  width: 100%;
  min-height: 420px;
  background: #111;
}


</style>
