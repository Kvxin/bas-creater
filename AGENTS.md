# 仓库指南

## 总则

- 本文件中的要求适用于本仓库的开发、测试和维护。
- 用户在当前任务中的明确要求优先于本文件中的一般约定。
- 如果规则之间发生冲突，优先采用更具体、与当前任务更相关的规则。

## 项目结构与模块组织

本仓库是使用 Vite、pnpm、Vue 3 和 TypeScript 构建的应用。

- 视图放在 `src/views`。
- 可复用的 Vue 组件放在 `src/components`。
- Pinia store 放在 `src/stores`。
- 组合式函数放在 `src/composables`。
- 共享辅助函数和类型放在 `src/utils` 与 `src/types`。
- 浏览器持久化逻辑放在 `src/services/storage`。
- 本地化消息放在 `src/i18n/messages`。
- 静态文件放在 `public/`。
- 文档放在 `docs/`。
- 端到端测试场景放在 `e2e/`。
- 生成的输出文件放在 `dist/`，不要将其纳入源码修改。

## Vue 与 TypeScript 规则

- 编写或修改 Vue 代码时，必须遵循 `rule/` 目录下的规则文件。当前规则文件为 `rule/vue3.md`；新增或更新规则文件后，也必须遵循其中的要求。
- 项目使用 Vue 3 Composition API，组件优先使用 `<script setup lang="ts">`。
- 使用 TypeScript 编写应用代码，并根据数据结构选择 `type` 或 `interface`。
- 使用 `ref`、`reactive` 和 `computed` 管理响应式状态；可复用逻辑提取为组合式函数。
- 使用 Pinia 管理跨组件或跨页面共享状态。
- 优先复用项目已有组件、Reka UI、Tailwind CSS 和共享工具函数。
- 目录使用描述性的 kebab-case。
- Vue 组件文件使用 PascalCase，例如 `TimelinePanel.vue`。
- 组合式函数使用 `use` 前缀和 camelCase，例如 `useProjectAutoSave.ts`。
- 函数和变量使用 camelCase，并使用能够表达用途的名称，例如 `isLoading`、`hasError`。
- 优先使用 `@/` 别名导入 `src` 中的模块。
- 注释使用中文，技术术语保留英文；注释应说明必要的原因，不要重复代码本身的含义。

## 编码格式

- 遵循 `.editorconfig`：使用两个空格缩进、LF 换行和 UTF-8 编码。
- JavaScript、TypeScript 和 Vue 文件使用仓库的 Prettier 配置格式化：`printWidth: 120`、使用分号、双引号、不使用尾随逗号。
- 保持现有代码的组织方式和命名风格；修改前先读取当前文件内容。
- 不要为了绕过类型错误而使用不必要的 `any`、类型断言或重复实现。

## 构建、测试与开发命令

使用 Node 20.19+（或 22.12+）和 pnpm。

```sh
pnpm install       # 安装锁定的依赖版本
pnpm dev           # 启动带热更新的 Vite 开发服务器
pnpm type-check    # 运行 vue-tsc 类型检查
pnpm build         # 执行类型检查并创建生产构建
pnpm build-only    # 创建 Vite 构建，不执行类型检查
pnpm preview       # 在本地提供构建结果预览
```

项目当前没有配置 Playwright 依赖，也没有独立的单元测试框架。新增测试工具后，应补充对应的 pnpm 命令。新增端到端测试时，将测试文件放在 `e2e/` 下，并命名为 `*.spec.ts`；相关测试工具加入后，使用获准的测试运行器执行。

## 测试指南

- 测试应覆盖用户可见的编辑器行为，例如加载工作区、主题切换、时间轴交互和资源处理。
- 提交前运行 `pnpm type-check` 和 `pnpm build`。如果项目已经配置单元测试命令，也应一并运行。
- 单独运行的浏览器检查应记录在拉取请求中。
- 当前没有强制的覆盖率阈值。
- 单元测试可以使用必要的 mock 隔离浏览器 API、存储 API 或外部模块，但不得用 mock 掩盖真实的实现错误。
- 测试应验证实际行为，不要添加仅用于通过测试的 workaround。

## 提交与拉取请求指南

- 使用带作用域的 Conventional Commits 前缀，例如 `feat(storage): ...`、`fix(audio): ...` 和 `ci(pages): ...`。
- 提交信息应简短，并聚焦于单一变更。
- 拉取请求应说明用户影响、列出验证命令、关联相关 issue，并为界面变更附上截图或录屏。
- 涉及部署、浏览器存储或本地化的变更应明确说明。

## 配置与数据说明

- 应用使用浏览器 IndexedDB 和 OPFS 存储项目及媒体数据。
- 不要提交用户媒体、生成的构建文件、本地密钥或其他敏感信息。
- 修改依赖时保留 `pnpm-lock.yaml`。
- 编辑 `vite.config.ts` 或部署工作流时，确认 GitHub Pages 的构建路径正确。
- 不要使用 Git 命令丢弃用户已有的修改；需要恢复内容时，先确认目标状态，再使用文件编辑工具进行恢复。

## 开发流程

- 开始修改前，先读取相关文件和规则文件。
- 发现用户已经修改了目标文件时，以当前文件内容为准，不要恢复被用户删除的内容。
- 完成实现后运行相关测试、类型检查和构建；发现问题时继续修复并重新验证。
- 遇到错误时，在能够保留上下文的范围内尽早报告，并提供可执行的修复结果。
