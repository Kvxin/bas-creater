# DanmakuCut 仓库协作指南

DanmakuCut 是 Vue 3、TypeScript、Vite、Pinia、Tauri 2 和 Rust 项目，同时提供 Web 和桌面端入口。

本文件只记录项目级约束和不容易从代码中推断出的协作规则。业务模型、字段说明和实现细节以源码、类型、测试与 `docs/` 为准。


## Repository Rules

- 禁止修改bas.js文件，只允许阅读和分析bas.js。
- 修改前检查 `git status` 和目标文件，保留用户已有修改。不要使用 Git 命令批量丢弃、覆盖或恢复无关内容。
- 不要修改或提交 `dist/`、`src-tauri/target/`、`node_modules/` 等生成目录，也不要提交用户媒体、临时工程、密钥或签名密码。
- 项目处于开发阶段，可以按需求破坏性调整代码、工程格式和界面 API。已有工程数据必须明确处理迁移、拒绝或兼容行为，不要静默损坏或丢弃。
- 前端和 Rust 都是正式代码入口。修改共享数据或公共 API 时，先查找调用方、测试和文档，再决定影响范围。
- 修改依赖时保留并更新 `pnpm-lock.yaml`。仓库没有 Changesets 流程，不要添加 `.changeset/`。

## Preserve Existing Behavior

业务行为优先于架构美观。除非当前任务明确要求，否则：

- 不要改变现有编辑器交互、快捷键、项目打开与保存、导入导出、撤销重做、资源处理或更新流程的可观察行为。
- 不要擅自改变现有组件、composable、store、service、Tauri command、路由、持久化格式或本地化消息的公共契约。
- 不要因为重构目录、替换实现或引入新抽象而改变参数、返回值、错误处理、权限边界或 Web/Tauri 分支行为。
- 如果发现已有缺陷，先记录问题、影响范围和复现方式。除非任务包含修复要求，不要在无关重构中顺手改变业务逻辑。
- 开发阶段允许破坏性调整，但必须由任务明确驱动，并同步处理受影响的调用方、已有工程数据、测试和文档。

## KISS && YAGNI

保持实现简单，优先使用项目已有能力。
只实现当前任务需要的能力。

- 优先使用 Vue、Pinia、浏览器 API、Tauri API、Rust 标准能力和现有项目工具，不为了统一形式重新封装一套框架。
- 不为了迁移到更“规整”的架构而复制现有逻辑、搬运目录或改变正常入口。
- 只有在复用、边界隔离或确实降低复杂度时才抽取抽象。简单逻辑保持在使用处。
- 不为了假设性的格式、平台或第三方运行时增加兼容层、适配层和配置项。
- 不创建没有实际调用方的通用组件、工具库、抽象接口或迁移机制。
- 不扩大现有权限、存储范围、工程格式或公共 API 的能力边界。确有需求时，先确认现有调用方和验证方式。

## Project Boundaries

- Vue 代码遵循 `rule/vue3.md`。
- Web 和 Tauri 都必须可用。新增或修改桌面能力时保留 Web 回退，并同步检查 Tauri command 注册、前端调用和 `src-tauri/capabilities/` 权限。
- 修改 `vite.config.ts`、路由或资源路径时同时验证 Tauri 的 `/` 和 GitHub Pages 的 `/bas-creater/`。
- 持久化代码应经过现有 storage 和 schema 边界。修改工程格式时同步更新版本处理、迁移、序列化和测试，不在组件中复制存储实现。
- `public/` 中的第三方运行时属于现有兼容边界。修改加载方式或调用协议前，先检查入口和使用方。

## Development

Node 和 pnpm 版本遵循 `package.json` 的 `engines` 与 `packageManager`。

```sh
pnpm install
pnpm dev
pnpm dev:renderer
pnpm type-check
pnpm build:renderer
pnpm build-only
pnpm preview
pnpm build
```

CI 安装依赖使用 `pnpm install --frozen-lockfile`。`pnpm dev:renderer` 用于 Web 入口，`pnpm dev` 用于 Tauri 入口，`pnpm build:renderer` 是前端类型检查和构建的主要入口。

## Style Guide

- 优先复用现有组件、store、composable、service、工具和类型。保持逻辑在使用处，只有在复用、边界隔离或确实降低复杂度时才抽取 helper。
- 在拥有数据边界的位置校验未知输入，进入内部逻辑后使用已经确认的类型。避免新增 `any`、无必要的类型断言、重复校验和并行抽象。
- 遵循仓库现有的 Vue、TypeScript、命名和 Prettier 风格。代码使用两个空格、双引号、分号和 120 列宽。
- 用户可见文案放在 `src/i18n/messages`，新增消息时维护现有语言结构。
- 注释说明非显而易见的原因、兼容限制或数据约束，不重复代码行为。
- 不要为了理论上的低概率并发或安全问题静默增加复杂度。需要引入明显复杂度时，先说明具体失败路径和影响。

## Testing

按改动范围运行聚焦测试。

```sh
pnpm test:effects
pnpm test:storage
pnpm test:updater
pnpm test:window-controls
```

- 前端改动至少运行 `pnpm type-check`。涉及构建、路由、资源路径、国际化或桌面边界时运行 `pnpm build:renderer`。
- 修改 Rust 端时，先确保存在前端 `dist/`，再运行：

```sh
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

- 测试应验证真实实现和用户可见行为，避免复制实现逻辑或使用过度 mock 制造通过结果。
- 当前 `e2e/` 不是默认测试入口。只有补充依赖和脚本后，新的端到端场景才纳入常规验证。

## Commits and Releases

- 提交信息使用 `type(scope): summary` 格式。类型使用 `feat`、`fix`、`docs`、`chore`、`refactor` 或 `test`，scope 使用实际受影响的区域。
- 修改版本时同步检查 `package.json` 和 `src-tauri/Cargo.toml`。发布流程以现有 GitHub Actions 和 tag 约定为准。

## Workflow

1. 读取目标文件、直接调用方、相关规则和现有测试。
2. 使用现有入口完成修改，保持 Web、Tauri 和持久化边界一致。
3. 为公共行为或数据格式的改动更新必要的测试和文档。
4. 运行与改动匹配的测试、类型检查和构建。
5. 检查 `git diff`、`git diff --check` 和 `git status`，确认结果只包含任务相关内容。
