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

项目以 `<项目名>.basproj` 保存在用户选定的目录，不要求目录为空；同名项目文件不会被覆盖。已有的 `project.basproj` 仍可打开。桌面端近期项目列表保存在 Tauri 应用配置目录的 `recent-projects.json`。Web 端在 localStorage 保存近期列表，并在 IndexedDB 中仅保存项目文件夹句柄；项目内容和素材仍保存在文件系统。重新打开时会检查文件夹权限；如原文件夹不可用，可通过“打开本地项目”重新选择。

工程文件记录文字、按钮、Path 和音频资产、虚拟素材箱及时间轴编辑数据。素材箱只改变工程内分类，不移动磁盘文件。桌面端导入音频默认引用原文件的绝对路径；Web 端受浏览器限制，将音频复制到项目辅助目录。原文件移动或删除后，可在素材离线提示中重新链接。删除素材或时间轴片段不会删除原始音频；删除项目文件时也保留素材和备份。

素材箱的新建、重命名、删除确认及素材右键重命名使用应用内对话框。名称不能为空；可按回车提交，或按 Esc 取消。

桌面端和 Web 端统一使用 `.<项目文件名>.danmakucut` 作为辅助目录，保存备份和项目内素材。打开旧版 Web 项目时，程序会将旧 `.danmakucut-<项目 ID>` 目录中的数据复制到统一目录；旧目录不会被自动删除，同名文件内容冲突时也不会覆盖。工作台可通过“集中打包工程”创建包含音频的独立副本，不修改原项目和原始素材。BAS 文本导出包含可编译的文字、按钮和 Path，音频仅用于编辑预览，不写入 BAS。

旧版本项目在打开时转换为当前工程格式；自动保存前保留历史备份。项目在切回工作台及保存前检查外部更改，发现冲突时提示用户并拒绝覆盖；浏览器无法完全阻止检查与写入之间发生跨进程更改。Web 项目需要支持 File System Access API 的浏览器，文件夹内的同名文件不会被有意覆盖，但浏览器无法完全阻止其他程序同时创建或修改文件。
