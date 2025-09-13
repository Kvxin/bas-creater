<script setup lang="ts">
</script>

<template>
  <div class="min-h-screen bg-background p-8">
    <div class="max-w-4xl mx-auto space-y-8">
      <div class="text-center space-y-4">
        <h1 class="text-4xl font-bold">Vue Video Editor</h1>
        <p class="text-muted-foreground text-lg">Successfully migrated from React + Next.js to Vue 3 + Vite</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="p-6 border rounded-lg space-y-4">
          <h2 class="text-2xl font-semibold">Video Editor</h2>
          <p class="text-muted-foreground">
            完整的视频编辑界面，包含三面板布局、时间轴、播放控制等功能。
          </p>
          <router-link to="/editor" class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
            Go to Editor
          </router-link>
        </div>

        <div class="p-6 border rounded-lg space-y-4">
          <h2 class="text-2xl font-semibold">UI Components</h2>
          <p class="text-muted-foreground">
            查看所有 47+ 个已迁移的 shadcn-vue 组件演示。
          </p>
          <router-link to="/components" class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2">
            View Components
          </router-link>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-2xl font-semibold">Migration Summary</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <h3 class="font-semibold text-green-800 dark:text-green-200">Framework</h3>
            <p class="text-sm text-green-600 dark:text-green-400">React → Vue 3</p>
          </div>
          <div class="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <h3 class="font-semibold text-blue-800 dark:text-blue-200">Build Tool</h3>
            <p class="text-sm text-blue-600 dark:text-blue-400">Next.js → Vite</p>
          </div>
          <div class="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
            <h3 class="font-semibold text-purple-800 dark:text-purple-200">UI Library</h3>
            <p class="text-sm text-purple-600 dark:text-purple-400">shadcn/ui → shadcn-vue</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

