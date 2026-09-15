# Anchora V2 项目上下文与架构设计规范

> 本文档描述 `v2-refactor` 分支当前已经落地的架构和行为约束。修改状态机、时间块、Markdown 解析或锁屏功能前，必须保持以下约定一致。

---

## 1. 核心闭环

Anchora 是基于生物钟对齐、认知负荷管理和时间块化的本地桌面管理软件。

核心流程：`安排时间块 -> 项目专注 -> 独立总结 -> 强制锁屏休息 -> Markdown 归档`。

## 2. 数据与 Markdown

- 每日文件格式为 `YYYY-MM-DD(星期X).md`，存放在 Vault 的 `Anchora/Daily` 目录。
- 全局模板位于 `src/time-blocks.ts`，预置 7 个时间块；模板包含时间范围、标题、属性和本地背景资产。
- 当前实例位于 `AppData.timeBlocks`，并通过 `timeBlocksDate` 标记日期。今日实例的修改不会修改全局模板。
- 当前日期优先使用时间块 AST 读写；历史旧文件仍兼容原有三段式分类格式。
- 时间块结构如下：

```markdown
### [6:45~8:10] 清晨美好瞬间 (属性: 美好瞬间)
- [ ] 项目名称
- [x] 已完成项目（用时18分钟完成）

### 工作缓存区
- [ ] 总结内容
```

- AST 解析和序列化实现位于 `src/markdown.ts`，应用状态变化会同步到 LocalStorage，并在连接 Vault 时写入对应日期文件。

## 3. 页面与交互

### 3.1 今日页面

- 今日页面按时间顺序展示时间块卡片。
- 卡片使用 CSS Grid，每行两张；窄屏降为单列。
- 卡片使用本地 SVG 背景资产，支持在卡片内直接添加项目。
- 项目支持卡片内排序和跨卡片拖拽。
- 状态为 `Focusing` 或 `Paused` 的项目 `draggable=false`，并且禁止完成切换；只有 `Idle` 项目允许拖拽。
- 每个未完成项目右侧有独立的“开始专注”按钮，不存在全局“开始专注”入口。

### 3.2 时间轴页面

- 时间轴提供历史日期日历，并按“美好瞬间 / 日常事务 / 工作缓存”分类展示。
- 时间轴继续兼容历史日期文件和旧版记录转发功能。

## 4. 专注状态机

项目记录的 `status` 为：

- `Idle`：空闲，可拖拽、可开始专注。
- `Focusing`：专注倒计时运行中，不可拖拽。
- `Paused`：专注已暂停，不可拖拽；保留暂停时剩余毫秒数。

项目专注会话的 `focusSession.phase` 为：

- `focusing`：项目正在倒计时。
- `paused`：项目暂停，点击继续后按保存的剩余时间恢复。
- `reflecting`：倒计时结束，显示独立总结弹窗；总结时间不挤占专注时间。
- `locked`：提前完成或总结保存后进入 Kiosk 锁屏倒计时。

专注会话包含 `projectId`、开始时间、结束时间、暂停剩余时间和一次性延时标记，并随 `AppData` 持久化，支持异常退出后恢复。

### 4.1 提前完成

点击侧边栏“结束专注”后，当前项目自动完成，追加“用时 X 分钟完成”，同步 Markdown，然后进入锁屏。

### 4.2 超时总结

- 专注倒计时归零后显示屏幕中央总结弹窗。
- 弹窗背景半透明，内容面板、文字、输入框和按钮不透明。
- “再延 5 分钟”按钮每个项目每次专注会话只能使用一次，使用后立即禁用。
- 保存总结后，原项目完成并追加“未完成，已存缓存区”，总结写入工作缓存区，然后进入锁屏。

### 4.3 发送

发送记录后，原项目自动完成并追加“未完成。已转为……，发送于……”，目标记录保留为新的待处理记录。

## 5. 多屏 Kiosk 锁屏

- 主窗口进入全屏、置顶并保持焦点。
- Tauri 检测扩展显示器，为每个非主显示器动态创建 `lock-overlay-*` 无边框窗口，显示纯黑遮罩并忽略鼠标事件。
- 锁屏倒计时结束后关闭锁屏状态和扩展屏遮罩。
- `Ctrl+Alt+Shift+F12` 是当前隐藏紧急退出快捷键，可解除锁屏。
- 锁屏状态下按 `Alt+F4` 直接退出应用进程；普通关闭窗口仍按托盘模式隐藏。

## 6. 维护与验证

- 本分支当前处于 V2 重构完成后的过渡维护阶段，时间块 AST、项目级专注状态机、总结流程和多显示器 Kiosk 锁屏均已接入应用数据流。
- 修改前端后运行 `npm test` 和 `npm run build`。
- 修改 Tauri 原生逻辑后运行 `cargo check`。
- 不提交 `node_modules`、`dist` 或 `src-tauri/target`。

## Repository layout

- `src/`：React + TypeScript 前端、App 数据流、状态机、Markdown AST、LocalStorage 和样式。
- `src/assets/`：时间块卡片使用的本地 SVG 背景资产。
- `src-tauri/src/`：Rust 原生命令、系统托盘、全局快捷键、显示器检测和多屏锁屏遮罩。
- `src-tauri/tauri.conf.json`：Tauri 窗口、构建和打包配置。
- `src/*.test.ts`：Vitest 单元测试。
- `requirements.md`：产品需求和验收背景。

## Development commands

- `npm ci`：按 `package-lock.json` 安装依赖。
- `npm run dev`：启动 Vite 前端开发服务器。
- `npm test`：运行 Vitest 测试。
- `npm run build`：执行 TypeScript 检查并构建前端。
- `npm run tauri dev`：启动完整 Tauri 桌面应用。
- `cargo check`：在 `src-tauri` 目录检查 Rust 原生代码。

## Implementation rules

- 保持本地优先，继续使用版本化的 `anchora:data:v1` LocalStorage key；新增字段必须提供安全默认值和迁移逻辑。
- 时间块模板与今日实例必须分离；今日实例通过 `timeBlocksDate` 关联日期，不能反向修改全局模板。
- 当前日期使用时间块 AST 读写，历史日期继续兼容旧版三段式 Markdown。
- 专注会话必须保存 `projectId`、时间戳、暂停剩余时间和一次性延时标记，不能只保存易失的倒计时秒数。
- `Focusing` 和 `Paused` 项目禁止完成切换、卡片内拖拽和跨卡片移动。
- 原生能力必须通过 `src-tauri/src/lib.rs` 的 Tauri command 暴露，并兼容浏览器/Vite 模式下 `invoke` 不可用的情况。
- 记录日期和 Markdown 时间使用系统本地时区；发送记录的目标、日期和发送时间必须保留。
- 修改已有 Vault 前先读取并合并文件，不能在未导入前覆盖每日文件。
- 不提交 `node_modules`、`dist`、`src-tauri/target`、日志或临时测试产物。

## Verification

前端或数据层改动至少运行：

```bash
npm test
npm run build
```

Tauri 原生逻辑改动还必须运行：

```bash
cargo check
```

提交前检查 `git status --short --branch`，确认只有预期源码、测试和文档改动。

## Windows packaging

- 应用标识为 `com.timay84.anchora`，产品名为 `Anchora`。
- Windows 打包目标为 NSIS 安装程序和 MSI 安装程序，配置位于 `src-tauri/tauri.conf.json`。
- Windows x64：先安装 `x86_64-pc-windows-msvc` Rust target，再运行：
  `npm run tauri build -- --target x86_64-pc-windows-msvc --bundles nsis,msi`
- Windows ARM64：先安装 `aarch64-pc-windows-msvc` Rust target，再运行：
  `npm run tauri build -- --target aarch64-pc-windows-msvc --bundles nsis,msi`
- 图标位于 `src-tauri/icons/`；不要提交生成的 `src-tauri/target` 目录。

## Obsidian Vault

- 在设置页选择 Obsidian Vault 文件夹后，Anchora 使用 `<vault>/Anchora/Daily/` 作为每日归档目录。
- 文件名为 `YYYY-MM-DD(星期X).md`；当前日期使用时间块 AST，历史旧文件可继续按旧三段式结构解析。
- Vault 连接时先读取已有每日文件，再合并到应用数据；连接失败时不能切换 Vault 或覆盖原文件。
- 应用状态和草稿保存在本地 LocalStorage，Markdown 是与 Obsidian 共享的记录格式。
- 当前同步路径为本机文件读写；尚未实现并发冲突解决，避免多个进程同时编辑同一每日文件。
