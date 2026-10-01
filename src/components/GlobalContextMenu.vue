<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "@/components/ui/context-menu";
import { useContextMenuStore } from "@/stores/contextMenu";
import { MENU_REGISTRY } from "@/config/menus";

const { t } = useI18n();
const store = useContextMenuStore();

// 根据当前菜单 ID 动态获取配置
const currentMenu = computed(() => {
  return MENU_REGISTRY[store.menuId] || null;
});
</script>

<template>
  <ContextMenu
    :visible="store.visible"
    :x="store.position.x"
    :y="store.position.y"
    @close="store.hide()"
  >
    <template v-if="currentMenu">
      <!-- 可选的分组标签：仅当 labelKey 存在且不为空字符串时渲染（文案在渲染时翻译） -->
      <ContextMenuLabel v-if="currentMenu.labelKey && currentMenu.labelKey.trim() !== ''">
        {{ t(currentMenu.labelKey) }}
      </ContextMenuLabel>
      
      <!-- 循环渲染菜单项 -->
      <template v-for="item in currentMenu.items" :key="item.id">
        <!-- 分割线 -->
        <ContextMenuSeparator v-if="item.separator" />
        
        <!-- 动作项 -->
        <ContextMenuItem
          v-else
          :class="item.class"
          :disabled="typeof item.disabled === 'function' ? item.disabled(store.data) : item.disabled"
          @click="item.action && store.execute(item.action)"
        >
          {{ t(item.labelKey) }}
        </ContextMenuItem>
      </template>
    </template>
    
    <template v-else>
      <ContextMenuLabel class="text-destructive">{{ t('menus.undefined', { menuId: store.menuId }) }}</ContextMenuLabel>
    </template>
  </ContextMenu>
</template>
