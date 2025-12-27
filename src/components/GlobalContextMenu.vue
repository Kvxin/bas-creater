<script setup lang="ts">
import { computed } from 'vue';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "@/components/ui/context-menu";
import { useContextMenuStore } from "@/stores/contextMenu";
import { MENU_REGISTRY } from "@/config/menus";

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
      <!-- 可选的分组标签 -->
      <ContextMenuLabel v-if="currentMenu.label">
        {{ currentMenu.label }}
      </ContextMenuLabel>
      
      <!-- 循环渲染菜单项 -->
      <template v-for="item in currentMenu.items" :key="item.id">
        <!-- 分割线 -->
        <ContextMenuSeparator v-if="item.separator" />
        
        <!-- 动作项 -->
        <ContextMenuItem
          v-else
          :class="item.class"
          :disabled="item.disabled"
          @click="item.action && store.execute(item.action)"
        >
          {{ item.label }}
        </ContextMenuItem>
      </template>
    </template>
    
    <template v-else>
      <ContextMenuLabel class="text-destructive">未定义的菜单: {{ store.menuId }}</ContextMenuLabel>
    </template>
  </ContextMenu>
</template>
