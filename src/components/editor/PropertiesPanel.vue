<script setup lang="ts">
import { computed } from "vue";
import { Settings } from "lucide-vue-next";
import { useDanmuStore } from "@/stores/danmu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import type { AnyDanmu } from "@/types/danmu";

const danmuStore = useDanmuStore();
const selected = computed(() => danmuStore.selected);

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

// Store (0xRRGGBB 字符串或数字) -> UI (#RRGGBB)
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
      return "#000000"; // 回退方案
    }
  }
  return "#" + hexStr;
};

// UI (#RRGGBB) -> Store
const updateColor = (key: string, htmlHex: string, asNumber: boolean) => {
  const cleanHex = htmlHex.replace("#", "");
  if (asNumber) {
    danmuStore.updateSelected({ [key]: parseInt(cleanHex, 16) } as Partial<AnyDanmu>);
  } else {
    danmuStore.updateSelected({ [key]: "0x" + cleanHex } as Partial<AnyDanmu>);
  }
};
</script>

<template>
  <div
    class="h-full w-full bg-sidebar border-l border-sidebar-border flex flex-col text-sm"
  >
    <!-- 头部 -->
    <div
      class="h-12 border-b border-sidebar-border flex items-center px-4 font-medium text-sidebar-foreground justify-between shrink-0"
    >
      <span>属性设置</span>
      <Settings class="size-4 text-muted-foreground" />
    </div>

    <!-- 内容区 -->
    <div v-if="selected" class="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-custom">
      
      <!-- 公共属性：身份 -->
      <div class="space-y-3 border-b border-sidebar-border/50 pb-4">
        <Label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          基本信息
        </Label>
        <div class="space-y-2">
            <div class="grid grid-cols-[3rem_1fr] items-center gap-2">
            <span class="text-xs text-muted-foreground">名称</span>
            <Input
              :model-value="selected.name"
              @update:model-value="(v) => updateField('name', v)"
              placeholder="自定义名称"
              class="h-7 text-xs"
            />
           </div>
        </div>
      </div>

      <!-- 公共属性：变换 -->
      <div class="space-y-3 border-b border-sidebar-border/50 pb-4">
        <Label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          位置与变换
        </Label>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase">X 坐标</span>
            <Input
              :model-value="selected.x"
              @update:model-value="(v) => updateField('x', v)"
              class="h-7 text-xs font-mono"
            />
          </div>
          <div class="space-y-1">
             <span class="text-[10px] text-muted-foreground uppercase">Y 坐标</span>
            <Input
              :model-value="selected.y"
              @update:model-value="(v) => updateField('y', v)"
              class="h-7 text-xs font-mono"
            />
          </div>
           <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase">缩放倍率</span>
            <Input
              type="number"
              step="0.1"
              :model-value="selected.scale"
              @update:model-value="(v) => updateField('scale', v, true)"
              class="h-7 text-xs font-mono"
            />
          </div>
           <div class="space-y-1">
             <span class="text-[10px] text-muted-foreground uppercase">层级 (Z)</span>
            <Input
              type="number"
               step="1"
              :model-value="selected.zIndex"
              @update:model-value="(v) => updateField('zIndex', v, true)"
              class="h-7 text-xs font-mono"
            />
          </div>
        </div>
      </div>
      
      <!-- 公共属性：外观 -->
       <div class="space-y-3 border-b border-sidebar-border/50 pb-4">
        <Label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          外观与时长
        </Label>
         <div class="space-y-3">
            <div class="space-y-1">
              <div class="flex justify-between items-center mb-1.5">
                 <span class="text-[10px] text-muted-foreground uppercase">不透明度</span>
                 <span class="text-[10px] text-muted-foreground font-mono">{{ ((selected.opacity ?? 1) * 100).toFixed(0) }}%</span>
              </div>
              <Slider
                :model-value="[selected.opacity ?? 1]"
                :max="1"
                :step="0.01"
                @update:model-value="(v) => updateField('opacity', v[0], true)"
                class="w-full"
              />
            </div>
            
             <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">持续时长 (毫秒)</span>
                 <Input
                  type="number"
                  step="100"
                  :model-value="selected.durationMs"
                  @update:model-value="(v) => updateField('durationMs', v, true)"
                  class="h-7 text-xs font-mono"
                />
            </div>
         </div>
      </div>

      <!-- 类型特定：文本 -->
      <div v-if="selected.type === 'text'" class="space-y-3 pb-4">
        <Label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          文本样式
        </Label>
        <div class="space-y-3">
          <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase">文本内容</span>
            <Textarea
              :model-value="(selected as any).content"
              @update:model-value="(v) => updateField('content', v)"
              class="min-h-[60px] text-xs resize-y"
              placeholder="请输入弹幕内容..."
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
             <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">字号</span>
                 <Input
                  :model-value="(selected as any).fontSize"
                  @update:model-value="(v) => updateField('fontSize', v)"
                  class="h-7 text-xs font-mono"
                />
            </div>
             <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">颜色</span>
                 <div class="flex gap-2">
                    <Input
                      type="color"
                      :model-value="toHtmlColor((selected as any).color)"
                      @input="(e: Event) => updateColor('color', (e.target as HTMLInputElement).value, false)"
                      class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer"
                    />
                    <Input
                       :model-value="(selected as any).color"
                       @update:model-value="(v) => updateField('color', v)"
                       class="h-7 text-xs font-mono flex-1"
                    />
                 </div>
            </div>
          </div>
        </div>
      </div>

       <!-- 类型特定：按钮 -->
      <div v-if="selected.type === 'button'" class="space-y-3 pb-4">
        <Label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          按钮样式
        </Label>
        <div class="space-y-3">
           <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase">按钮文字</span>
            <Input
              :model-value="(selected as any).text"
              @update:model-value="(v) => updateField('text', v)"
              class="h-7 text-xs"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
             <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">文字颜色</span>
                 <div class="flex gap-2">
                    <Input
                      type="color"
                      :model-value="toHtmlColor((selected as any).textColor)"
                      @input="(e: Event) => updateColor('textColor', (e.target as HTMLInputElement).value, true)"
                      class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer"
                    />
                     <span class="text-xs font-mono pt-1.5">{{ toHtmlColor((selected as any).textColor) }}</span>
                 </div>
            </div>
             <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">填充颜色</span>
                 <div class="flex gap-2">
                    <Input
                      type="color"
                      :model-value="toHtmlColor((selected as any).fillColor)"
                      @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)"
                      class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer"
                    />
                    <span class="text-xs font-mono pt-1.5">{{ toHtmlColor((selected as any).fillColor) }}</span>
                 </div>
            </div>
          </div>
        </div>
      </div>
      
       <!-- 类型特定：路径 -->
      <div v-if="selected.type === 'path'" class="space-y-3 pb-4">
        <Label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          路径数据
        </Label>
         <div class="space-y-3">
            <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase">SVG 路径数据 (d)</span>
             <Textarea
              :model-value="(selected as any).d"
              @update:model-value="(v) => updateField('d', v)"
              class="min-h-[60px] text-xs font-mono resize-y"
              placeholder="M0 0 L10 10..."
            />
          </div>
           <div class="grid grid-cols-2 gap-3">
             <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">填充颜色</span>
                 <div class="flex gap-2">
                    <Input
                      type="color"
                      :model-value="toHtmlColor((selected as any).fillColor)"
                      @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)"
                      class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer"
                    />
                     <span class="text-xs font-mono pt-1.5">{{ toHtmlColor((selected as any).fillColor) }}</span>
                 </div>
            </div>
             <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">描边颜色</span>
                 <div class="flex gap-2">
                    <Input
                      type="color"
                      :model-value="toHtmlColor((selected as any).borderColor)"
                      @input="(e: Event) => updateColor('borderColor', (e.target as HTMLInputElement).value, true)"
                      class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer"
                    />
                     <span class="text-xs font-mono pt-1.5">{{ toHtmlColor((selected as any).borderColor) }}</span>
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