<script setup lang="ts">
import { computed, reactive } from "vue";
import { Settings, ChevronRight, ChevronDown, Plus, Trash2, ArrowLeft } from "lucide-vue-next";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import type { AnyDanmu } from "@/types/danmu";
import type { AnimationSegment } from "@/types/timeline";

const danmuStore = useDanmuStore();
const timelineStore = useTimelineStore();
const selected = computed(() => danmuStore.selected);

const selectedClip = computed(() => {
    if (!timelineStore.selectedClipId) return null;
    for (const track of timelineStore.tracks) {
        const clip = track.clips.find(c => c.id === timelineStore.selectedClipId);
        if (clip) return clip;
    }
    return null;
});

const selectedAnimation = computed(() => {
    if (!selectedClip.value || !timelineStore.selectedAnimationId) return null;
    return selectedClip.value.animations?.find(a => a.id === timelineStore.selectedAnimationId);
});

// 动画属性更新
const updateAnimationField = (key: keyof AnimationSegment, value: any) => {
    if (!selectedClip.value || !selectedAnimation.value) return;
    timelineStore.updateClipAnimation(selectedClip.value.id, selectedAnimation.value.id, { [key]: value });
};

const updateAnimationProperty = (key: string, value: any, asNumber = true) => {
    if (!selectedClip.value || !selectedAnimation.value) return;
    const props = { ...selectedAnimation.value.properties };
    
    if (value === '' || value === undefined) {
        delete (props as any)[key];
    } else {
        (props as any)[key] = asNumber ? Number(value) : value;
    }
    
    timelineStore.updateClipAnimation(selectedClip.value.id, selectedAnimation.value.id, { properties: props });
};

const addAnimation = () => {
    if (!selectedClip.value) return;
    const newAnim: AnimationSegment = {
        id: `anim_${Date.now()}`,
        type: 'then',
        duration: 1000,
        properties: {}
    };
    timelineStore.addClipAnimation(selectedClip.value.id, newAnim);
};

const removeAnimation = () => {
    if (!selectedClip.value || !selectedAnimation.value) return;
    timelineStore.removeClipAnimation(selectedClip.value.id, selectedAnimation.value.id);
};

const backToClip = () => {
    timelineStore.setSelectedAnimation(null);
}

// 折叠状态管理
const sectionState = reactive({
  identity: true,
  transform: false,
  style: false
});

const toggleSection = (key: keyof typeof sectionState) => {
  sectionState[key] = !sectionState[key];
};

// ... (Existing helpers remain the same) ...
// 类型名称映射
const typeNames: Record<string, string> = {
  text: "文本弹幕",
  button: "按钮弹幕",
  path: "路径弹幕",
};

// 更新字段的辅助函数
const updateField = (key: string, value: any, asNumber: boolean = false) => {
  if (asNumber) {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      danmuStore.updateSelected({ [key]: parsed } as Partial<AnyDanmu>);
    }
  } else {
    danmuStore.updateSelected({ [key]: value } as Partial<AnyDanmu>);
  }
};

// --- 颜色辅助函数 ---
const toHtmlColor = (val: string | number | undefined): string => {
  if (val === undefined) return "#000000";
  let hexStr = "";
  if (typeof val === "number") {
    hexStr = val.toString(16).padStart(6, "0");
  } else if (typeof val === "string") {
    if (val.startsWith("0x") || val.startsWith("0X")) {
      hexStr = val.slice(2);
    } else if (val.startsWith("#")) {
      return val;
    } else {
      return "#000000";
    }
  }
  return "#" + hexStr;
};

const updateColor = (key: string, htmlHex: string, asNumber: boolean) => {
  const cleanHex = htmlHex.replace("#", "");
  if (asNumber) {
    danmuStore.updateSelected({ [key]: parseInt(cleanHex, 16) } as Partial<AnyDanmu>);
  } else {
    danmuStore.updateSelected({ [key]: "0x" + cleanHex } as Partial<AnyDanmu>);
  }
};

const updateButtonAV = (val: string | number) => {
  const av = typeof val === 'string' ? parseInt(val) : val;
  if (!isNaN(av)) {
      danmuStore.updateSelected({
          target: { av: { av, page: 1, timeMs: 0 } }
      } as Partial<AnyDanmu>);
  }
}

const updateBoolean = (key: string, value: boolean) => {
  danmuStore.updateSelected({ [key]: value ? 1 : 0 } as Partial<AnyDanmu>);
};

const getButtonAV = (item: any): number | undefined => {
    if (item.target && 'av' in item.target) {
        return item.target.av.av;
    }
    return undefined;
}
</script>

<template>
  <div
    class="h-full w-full bg-sidebar border-l border-sidebar-border flex flex-col text-sm"
  >
    <!-- 头部 -->
    <div
      class="h-12 border-b border-sidebar-border flex items-center px-4 font-medium text-sidebar-foreground justify-between shrink-0"
    >
      <div class="flex items-center gap-2">
          <button v-if="selectedAnimation" @click="backToClip" class="hover:bg-sidebar-accent p-1 rounded-md transition-colors">
              <ArrowLeft class="size-4" />
          </button>
          <span>{{ selectedAnimation ? '动画设置' : '属性设置' }}</span>
      </div>
      <Settings class="size-4 text-muted-foreground" />
    </div>

    <!-- 动画编辑模式 -->
    <div v-if="selectedAnimation" class="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-custom">
        <div class="space-y-4 border-b border-sidebar-border/50 pb-5">
            <div class="flex items-center justify-between">
                <Label class="text-xs font-semibold text-primary uppercase tracking-wider">基础配置</Label>
                <button @click="removeAnimation" class="text-destructive hover:bg-destructive/10 p-1 rounded transition-colors" title="删除动画">
                    <Trash2 class="size-4" />
                </button>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <Label class="text-[10px] text-muted-foreground uppercase">类型</Label>
                    <select 
                        :value="selectedAnimation.type" 
                        @change="(e: any) => updateAnimationField('type', e.target.value)"
                        class="h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                        <option value="then">串行 (Then Set)</option>
                        <option value="set">并行 (Set)</option>
                    </select>
                </div>
                 <div class="space-y-1">
                    <Label class="text-[10px] text-muted-foreground uppercase">时长 (ms)</Label>
                    <Input type="number" step="100" :model-value="selectedAnimation.duration" @update:model-value="v => updateAnimationField('duration', Number(v))" class="h-8 text-xs font-mono" />
                </div>
            </div>
            
            <div v-if="selectedAnimation.type === 'set'" class="space-y-1">
                <Label class="text-[10px] text-muted-foreground uppercase">延迟 (Delay ms)</Label>
                 <Input type="number" step="100" :model-value="selectedAnimation.delay" @update:model-value="v => updateAnimationField('delay', Number(v))" class="h-8 text-xs font-mono" />
            </div>
        </div>
        
        <div class="space-y-4">
             <Label class="text-xs font-semibold text-primary uppercase tracking-wider block mb-2">属性变更 (Properties)</Label>
             <p class="text-[10px] text-muted-foreground mb-4">仅填写需要变化的属性，留空则保持不变。</p>
             
             <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-1">
                    <Label class="text-[10px] text-muted-foreground uppercase">X 坐标</Label>
                    <Input :model-value="selectedAnimation.properties.x" @update:model-value="v => updateAnimationProperty('x', v)" class="h-7 text-xs font-mono" placeholder="保持不变" />
                </div>
                <div class="space-y-1">
                    <Label class="text-[10px] text-muted-foreground uppercase">Y 坐标</Label>
                    <Input :model-value="selectedAnimation.properties.y" @update:model-value="v => updateAnimationProperty('y', v)" class="h-7 text-xs font-mono" placeholder="保持不变" />
                </div>
                <div class="space-y-1">
                    <Label class="text-[10px] text-muted-foreground uppercase">不透明度 (Opacity)</Label>
                    <Input type="number" step="0.1" :model-value="selectedAnimation.properties.opacity" @update:model-value="v => updateAnimationProperty('opacity', v)" class="h-7 text-xs font-mono" placeholder="保持不变" />
                </div>
                <div class="space-y-1">
                    <Label class="text-[10px] text-muted-foreground uppercase">缩放 (Scale)</Label>
                    <Input type="number" step="0.1" :model-value="selectedAnimation.properties.scale" @update:model-value="v => updateAnimationProperty('scale', v)" class="h-7 text-xs font-mono" placeholder="保持不变" />
                </div>
             </div>
             
              <div class="grid grid-cols-3 gap-2 pt-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">旋转 X</span>
                    <Input type="number" :model-value="selectedAnimation.properties.rotateX" @update:model-value="(v) => updateAnimationProperty('rotateX', v)" class="h-7 text-xs font-mono" placeholder="-" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">旋转 Y</span>
                    <Input type="number" :model-value="selectedAnimation.properties.rotateY" @update:model-value="(v) => updateAnimationProperty('rotateY', v)" class="h-7 text-xs font-mono" placeholder="-" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">旋转 Z</span>
                    <Input type="number" :model-value="selectedAnimation.properties.rotateZ" @update:model-value="(v) => updateAnimationProperty('rotateZ', v)" class="h-7 text-xs font-mono" placeholder="-" />
                </div>
            </div>
             
             <!-- Color -->
             <div class="space-y-1 pt-2">
                 <Label class="text-[10px] text-muted-foreground uppercase">颜色</Label>
                  <div class="flex gap-2">
                     <!-- Helper input for color picker, simplified logic -->
                    <Input type="text" :model-value="(selectedAnimation.properties as any).color || (selectedAnimation.properties as any).textColor" @update:model-value="v => updateAnimationProperty('color', v, false)" class="h-7 text-[10px] font-mono flex-1" placeholder="0xFFFFFF" />
                </div>
             </div>
        </div>
    </div>

    <!-- 常规资源编辑模式 -->
    <div v-else-if="selected" class="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-custom">
      
      <!-- 添加动画入口 -->
      <div v-if="selectedClip" class="mb-2">
          <button 
            @click="addAnimation"
            class="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-dashed border-sidebar-border hover:bg-sidebar-accent hover:text-primary transition-colors text-xs text-muted-foreground"
          >
              <Plus class="size-3.5" />
              添加动画片段 (Animation)
          </button>
      </div>
      
      <!-- 第一阶段：内容与身份 (根据类型自适应) -->
      <div class="space-y-4 border-b border-sidebar-border/50 pb-5">
        <div 
          class="flex items-center justify-between cursor-pointer group select-none"
          @click="toggleSection('identity')"
        >
            <Label class="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-2 cursor-pointer">
            <span class="w-1 h-3 bg-primary rounded-full"></span>
            内容与标识
            </Label>
            <component :is="sectionState.identity ? ChevronDown : ChevronRight" class="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        
        <div v-show="sectionState.identity" class="space-y-3 pt-1">
          <!-- 公共：自定义名称 -->
          <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase font-medium">资源名称 (Identity Name)</span>
            <Input
              :model-value="selected.name"
              @update:model-value="(v) => updateField('name', v)"
              placeholder="用于资源列表显示的名称"
              class="h-8 text-xs"
            />
          </div>

          <!-- 文本特有：内容 -->
          <div v-if="selected.type === 'text'" class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase font-medium">文本内容 (Content)</span>
            <Textarea
              :model-value="(selected as any).content"
              @update:model-value="(v) => updateField('content', v)"
              class="min-h-20 text-xs resize-y leading-extended"
              placeholder="请输入弹幕文本..."
            />
          </div>

          <!-- 按钮特有：文本与跳转 -->
          <template v-if="selected.type === 'button'">
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">按钮文字 (Display Text)</span>
              <Input
                :model-value="(selected as any).text"
                @update:model-value="(v) => updateField('text', v)"
                class="h-8 text-xs"
                placeholder="按钮上显示的文字"
              />
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">跳转 AV 号 (Target AV)</span>
              <Input
                type="number"
                :model-value="getButtonAV(selected)"
                @update:model-value="updateButtonAV"
                class="h-8 text-xs font-mono"
                placeholder="例如: 1714157"
              />
            </div>
          </template>

          <!-- 路径特有：路径与画布 -->
          <template v-if="selected.type === 'path'">
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">SVG 路径 (Path Data - d)</span>
              <Textarea
                :model-value="(selected as any).d"
                @update:model-value="(v) => updateField('d', v)"
                class="min-h-20 text-xs font-mono resize-y"
                placeholder="M0 0 L10 10..."
              />
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">画布范围 (ViewBox)</span>
              <Input
                :model-value="(selected as any).viewBox"
                @update:model-value="(v) => updateField('viewBox', v)"
                class="h-8 text-xs font-mono"
                placeholder="0 0 100 100"
              />
            </div>
          </template>
        </div>
      </div>

      <!-- 第二阶段：几何变换 (Transform) -->
      <div class="space-y-4 border-b border-sidebar-border/50 pb-5">
        <div 
          class="flex items-center justify-between cursor-pointer group select-none"
          @click="toggleSection('transform')"
        >
            <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 cursor-pointer">
            <span class="w-1 h-3 bg-muted-foreground/50 rounded-full"></span>
            几何变换
            </Label>
            <component :is="sectionState.transform ? ChevronDown : ChevronRight" class="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
        
        <div v-show="sectionState.transform" class="space-y-3 pt-1">
            <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">X 坐标</span>
                <Input :model-value="selected.x" @update:model-value="(v) => updateField('x', v)" class="h-7 text-xs font-mono bg-sidebar-accent/30" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">Y 坐标</span>
                <Input :model-value="selected.y" @update:model-value="(v) => updateField('y', v)" class="h-7 text-xs font-mono bg-sidebar-accent/30" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">缩放 (Scale)</span>
                <Input type="number" step="0.1" :model-value="selected.scale" @update:model-value="(v) => updateField('scale', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">层级 (Z-Index)</span>
                <Input type="number" step="1" :model-value="selected.zIndex" @update:model-value="(v) => updateField('zIndex', v, true)" class="h-7 text-xs font-mono" />
            </div>
            </div>

            <div class="grid grid-cols-2 gap-4 pt-1">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">锚点 X (0-1)</span>
                <Input type="number" step="0.1" :model-value="selected.anchorX" @update:model-value="(v) => updateField('anchorX', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">锚点 Y (0-1)</span>
                <Input type="number" step="0.1" :model-value="selected.anchorY" @update:model-value="(v) => updateField('anchorY', v, true)" class="h-7 text-xs font-mono" />
            </div>
            </div>

            <div class="grid grid-cols-3 gap-2 pt-1">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">旋转 X</span>
                <Input type="number" :model-value="selected.rotateX" @update:model-value="(v) => updateField('rotateX', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">旋转 Y</span>
                <Input type="number" :model-value="selected.rotateY" @update:model-value="(v) => updateField('rotateY', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">旋转 Z</span>
                <Input type="number" :model-value="selected.rotateZ" @update:model-value="(v) => updateField('rotateZ', v, true)" class="h-7 text-xs font-mono" />
            </div>
            </div>
        </div>
      </div>

      <!-- 第三阶段：外观、样式与时间 -->
      <div class="space-y-4 pb-10">
        <div 
          class="flex items-center justify-between cursor-pointer group select-none"
          @click="toggleSection('style')"
        >
            <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 cursor-pointer">
            <span class="w-1 h-3 bg-muted-foreground/50 rounded-full"></span>
            样式与外观
            </Label>
            <component :is="sectionState.style ? ChevronDown : ChevronRight" class="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>

        <div v-show="sectionState.style" class="space-y-4 pt-1">
            <!-- 通用：不透明度与时长 -->
            <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[10px] text-muted-foreground uppercase">不透明度</span>
                    <span class="text-[10px] text-muted-foreground font-mono">{{ ((selected.opacity ?? 1) * 100).toFixed(0) }}%</span>
                </div>
                <Slider
                    :model-value="[selected.opacity ?? 1]" :max="1" :step="0.01"
                    @update:model-value="(v) => v && updateField('opacity', v[0], true)"
                    class="w-full h-7"
                />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">持续时间 (ms)</span>
                    <Input type="number" step="100" :model-value="selected.durationMs" @update:model-value="(v) => updateField('durationMs', v, true)" class="h-7 text-xs font-mono" />
                </div>
            </div>

            <!-- 文本样式 -->
            <div v-if="selected.type === 'text'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">字号</span>
                    <Input :model-value="(selected as any).fontSize" @update:model-value="(v) => updateField('fontSize', v)" class="h-7 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">字体</span>
                    <Input :model-value="(selected as any).fontFamily" @update:model-value="(v) => updateField('fontFamily', v)" class="h-7 text-xs" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">文字颜色</span>
                    <div class="flex gap-2">
                        <Input type="color" :model-value="toHtmlColor((selected as any).color)" @input="(e: Event) => updateColor('color', (e.target as HTMLInputElement).value, false)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                        <Input :model-value="(selected as any).color" @update:model-value="(v) => updateField('color', v)" class="h-7 text-[10px] font-mono flex-1" />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">粗体</span>
                    <div class="h-7 flex items-center">
                        <button
                            type="button"
                            role="switch"
                            :aria-checked="!!(selected as any).bold"
                            @click="updateBoolean('bold', !(selected as any).bold)"
                            class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                            :class="!!(selected as any).bold ? 'bg-primary' : 'bg-input'"
                        >
                            <span
                            class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform"
                            :class="!!(selected as any).bold ? 'translate-x-4' : 'translate-x-0'"
                            />
                        </button>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">阴影</span>
                    <div class="h-7 flex items-center">
                        <button
                            type="button"
                            role="switch"
                            :aria-checked="!!(selected as any).textShadow"
                            @click="updateBoolean('textShadow', !(selected as any).textShadow)"
                            class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                            :class="!!(selected as any).textShadow ? 'bg-primary' : 'bg-input'"
                        >
                            <span
                            class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform"
                            :class="!!(selected as any).textShadow ? 'translate-x-4' : 'translate-x-0'"
                            />
                        </button>
                    </div>
                </div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边颜色</span>
                    <div class="flex gap-2">
                        <Input type="color" :model-value="toHtmlColor((selected as any).strokeColor)" @input="(e: Event) => updateColor('strokeColor', (e.target as HTMLInputElement).value, false)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                        <Input :model-value="(selected as any).strokeColor" @update:model-value="(v) => updateField('strokeColor', v)" class="h-7 text-[10px] font-mono flex-1" />
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边宽度</span>
                    <Input type="number" step="0.5" :model-value="(selected as any).strokeWidth" @update:model-value="(v) => updateField('strokeWidth', v, true)" class="h-7 text-xs font-mono" />
                </div>
            </div>
            </div>

            <!-- 按钮样式 -->
            <div v-if="selected.type === 'button'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">字号</span>
                    <Input type="number" :model-value="(selected as any).fontSize" @update:model-value="(v) => updateField('fontSize', v, true)" class="h-7 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">文字颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).textColor)" @input="(e: Event) => updateColor('textColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).textColor) }}</span>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).fillColor)" @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).fillColor) }}</span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">文字透</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).textAlpha" @update:model-value="(v) => updateField('textAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充透</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).fillAlpha" @update:model-value="(v) => updateField('fillAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                </div>
            </div>
            </div>

            <!-- 路径样式 -->
            <div v-if="selected.type === 'path'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">宽度 (Width)</span>
                    <Input :model-value="(selected as any).width" @update:model-value="(v) => updateField('width', v)" class="h-7 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">高度 (Height)</span>
                    <Input :model-value="(selected as any).height" @update:model-value="(v) => updateField('height', v)" class="h-7 text-xs font-mono" />
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).fillColor)" @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).fillColor) }}</span>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充透明度</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).fillAlpha" @update:model-value="(v) => updateField('fillAlpha', v, true)" class="h-7 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).borderColor)" @input="(e: Event) => updateColor('borderColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).borderColor) }}</span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边宽</span>
                    <Input type="number" step="0.5" :model-value="(selected as any).borderWidth" @update:model-value="(v) => updateField('borderWidth', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边透</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).borderAlpha" @update:model-value="(v) => updateField('borderAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                </div>
            </div>
            </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
      <div class="size-12 rounded-full bg-sidebar-accent flex items-center justify-center mb-3">
        <Settings class="size-6 opacity-50" />
      </div>
      <span class="font-medium">未选中</span>
      <span class="text-xs mt-1">在左侧列表中选择一个项目进行编辑</span>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-custom::-webkit-scrollbar {
  width: 4px;
}

.scrollbar-custom::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-custom::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.2);
  border-radius: 20px;
}

.scrollbar-custom::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.4);
}
</style>