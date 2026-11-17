import { createApp } from "vue";
import { createPinia } from "pinia";
import "@/assets/main.css";

import App from "./App.vue";
import router from "./router";
import { i18n } from "./i18n";
import { useWindowPreferencesStore } from "@/stores/windowPreferences";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(i18n);

// 首次渲染前读取窗口模式，避免 Linux 原生按钮和自绘按钮短暂同时出现。
void useWindowPreferencesStore()
  .initialize()
  .then(() => app.mount("#app"));
