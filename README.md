# DanmakuCut (bas-creater)

BAS 弹幕时间轴编辑器，基于 [Tauri 2](https://v2.tauri.app/) + Vue 3 + TypeScript 构建的桌面客户端，同时保留纯 Web 版本（GitHub Pages）。

项目结构与打包方式参考 [cc-switch](https://github.com/farion1231/cc-switch)。

## 项目结构

```
├── src/                 # 前端（Vue 3 + Vite）
├── public/              # 静态资源（bas.js、vendor/jquery 等）
├── src-tauri/           # Tauri 2 Rust 端
│   ├── src/main.rs      # 入口
│   ├── src/lib.rs       # 应用构建、插件注册
│   ├── src/commands.rs  # 前端可调用的 Tauri commands
│   ├── capabilities/    # 窗口权限声明
│   ├── icons/           # 应用图标（由 assets/app-icon.svg 生成）
│   └── tauri.conf.json  # Tauri 配置（版本号读取 package.json）
├── assets/              # 图标源文件
├── rust-toolchain.toml  # Rust 工具链版本
└── .github/workflows/   # CI、Release 打包、Pages 部署
```

## 环境要求

- Node 20.19+ / 22.12+，pnpm（版本见 `package.json` 的 `packageManager`）
- Rust（版本见 `rust-toolchain.toml`）
- 各平台 Tauri 系统依赖，见 [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)
  - Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libsoup-3.0-dev`

## 开发命令

```sh
pnpm install           # 安装依赖
pnpm dev               # 启动桌面客户端（tauri dev，自动拉起 Vite）
pnpm dev:renderer      # 仅启动 Web 前端（浏览器调试）
pnpm type-check        # vue-tsc 类型检查
pnpm build:renderer    # 类型检查 + 构建前端到 dist/
pnpm build             # 打包桌面客户端（tauri build）
pnpm tauri icon assets/app-icon.svg -o src-tauri/icons  # 重新生成图标
```

打包产物位于 `src-tauri/target/release/bundle/`。

## 发布

1. 同步修改 `package.json` 与 `src-tauri/Cargo.toml` 中的 `version`
2. 推送 `v<版本号>` tag（如 `v0.1.0`），`Release` workflow 会构建：
   - Windows x86_64 / ARM64：`.msi`、NSIS `-Setup.exe`、`-Portable.zip`
   - macOS Universal：`.dmg`、`.zip`
   - Linux x86_64 / ARM64：`.AppImage`、`.deb`、`.rpm`
3. 产物上传到草稿（draft）GitHub Release，确认后手动发布

手动触发 `Release` workflow 为干跑，仅在 workflow artifacts 中保留产物。

macOS 签名/公证为可选项：在仓库 secrets 中配置 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`（以及公证用的 `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`）后自动启用。

## 数据存储

项目与媒体数据保存在 WebView 的 IndexedDB / OPFS 中（不支持 OPFS 写入时自动回退到 IndexedDB）。导出 `.basproj` 与 TXT 时，桌面端使用系统保存对话框，Web 端使用浏览器下载。
