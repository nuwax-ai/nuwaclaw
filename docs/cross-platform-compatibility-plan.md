# 跨平台兼容性分析与解决计划

本文面向 nuwax-agent 在 macOS / Windows / Linux 的跨平台一致性，给出兼容性分析与落地方案。

## 目标与范围

- 目标：在三大桌面平台上提供一致的核心能力（远程连接、AI Agent 任务、托盘、自动启动、依赖管理、配置与更新），并保证安装、运行、升级体验稳定。
- 范围：客户端（仅 Tauri UI）、本地服务组件、依赖安装与打包发布、系统权限与安全策略、配置路径与文件权限、网络与系统服务能力。

## 当前现状（来自仓库信息）

- 目标平台：macOS（arm64/x86_64）、Windows（x86_64）、Linux（x86_64/arm64）均标记为支持。
- 依赖：vcpkg（如 libvpx/libyuv/opus/aom）、Rustdesk 相关库、Tauri 客户端为主。
- 功能：托盘、自动启动、依赖自动安装、远程桌面（开发中）。
- 配置路径：macOS `~/Library/Application Support/...`；Windows `%APPDATA%/...`；Linux `~/.config/...`。

## 结合当前代码的落点梳理（Tauri）

以下内容直接对应现有实现位置，便于后续改造与排期。

- Tauri 主入口与能力聚合：
  - `crates/agent-tauri-client/src-tauri/src/main.rs`
  - `crates/agent-tauri-client/src-tauri/src/lib.rs`
- 权限管理与监控：
  - `permission_check / permission_request / permission_list / permission_monitor_start` 等命令已在 `crates/agent-tauri-client/src-tauri/src/lib.rs` 中实现，底层依赖 `crates/system-permissions`。
  - macOS 完全磁盘访问检测：`check_disk_access`（同上）。
- 自动启动：
  - `autolaunch_set / autolaunch_get`（使用 `auto_launch`），`crates/agent-tauri-client/src-tauri/src/lib.rs`。
- 系统托盘：
  - `setup_tray` 与托盘菜单事件在 `crates/agent-tauri-client/src-tauri/src/lib.rs`。
- 外部二进制打包与路径：
  - `tauri.conf.json` 中 `bundle.externalBin` 已配置 `binaries/nuwax-lanproxy`。
  - `get_lanproxy_bin_path` 通过平台 `cfg` 处理不同二进制文件名与路径。
- CLI 参数与最小化启动：
  - `tauri.conf.json` 中 `cli.args` 与 `run()` 内 `--tab/--minimized` 处理联动。
- 依赖检测/安装：
  - Rust 依赖统一由 core 层管理：`nuwax_agent_core::dependency::manager::DependencyManager`（`crates/agent-tauri-client/src-tauri/src/lib.rs`）。
  - Node/npm/uv 检测与本地安装逻辑已实现（同上）。
- 配置与日志：
  - 日志路径与读取：`log_dir_get / read_logs / open_log_directory`（`crates/agent-tauri-client/src-tauri/src/lib.rs`）。
  - Store 读写通过 `tauri_plugin_store` 完成（同上）。

## 实现现状评估（基于当前代码）

以下为“已经具备/部分具备/待补齐”的实现评估，用于指导优先级。

### 已具备（可直接复用）

- 权限管理基础能力：
  - `permission_check / permission_request / permission_open_settings / permission_list / permission_monitor_start` 已提供平台抽象。
  - macOS 完全磁盘访问检查 `check_disk_access` 已实现。
- 自动启动：
  - `autolaunch_set / autolaunch_get` 基于 `auto_launch`，且区分 macOS/Windows。
- 托盘与窗口行为：
  - `setup_tray` + 窗口关闭隐藏到托盘，基本行为齐备。
- CLI 参数：
  - `--tab/--minimized` 已通过 `tauri.conf.json` + `run()` 内解析完成。
- 外部二进制路径管理：
  - `get_lanproxy_bin_path` 已处理多平台/架构差异，且与 `bundle.externalBin` 对应。
- 依赖检测框架：
  - `DependencyManager` + `dependency_*` 命令已覆盖基础检测/安装流程。

### 部分具备（需补齐或统一）

- 权限流程与前端联动：
  - 后端接口齐备，但需要在前端形成统一引导流程与可恢复路径。
- Linux 托盘与窗口兼容：
  - 代码层托盘已有实现，但需在不同 DE/Wayland/X11 中验证兼容与回退逻辑。
- 日志与配置路径统一：
  - 目前通过 core 提供日志目录，仍需对配置/缓存路径统一抽象与兜底。
- 依赖安装体验：
  - Node/npm/uv 本地安装能力已具备，但缺少跨平台错误提示与一键修复 UX。

### 待补齐（优先级较高）

- 打包与签名流程：
  - 目前 `tauri.conf.json` 已开启 bundle，但未固化 macOS 公证/Windows 签名/Linux 产物策略。
- 更新机制：
  - 未看到 updater 的显式配置或回滚策略，需要补充。
- 防火墙与网络策略引导：
  - Windows/macOS/Linux 的防火墙/端口占用提示和引导仍缺失。
- CI 跨平台验证：
  - 当前方案需要落地多平台构建+最小 smoke test。

## 权限实现对齐与后续计划

本节仅聚焦“权限相关能力”，同步当前已实现内容与后续需要补齐的工作。

### 已完成（现有实现）

- 权限命令接口（后端）：
  - `permission_check / permission_request / permission_open_settings / permission_list / permission_monitor_start / permission_monitor_stop`
  - 位置：`crates/agent-tauri-client/src-tauri/src/lib.rs`
- macOS 完全磁盘访问检测：
  - `check_disk_access`（通过访问 `~/Library/Application Support` 判断）
  - 位置：`crates/agent-tauri-client/src-tauri/src/lib.rs`
- 统一权限抽象依赖：
  - `system_permissions` crate 提供 `PermissionManager / PermissionMonitor`
  - 位置：`crates/system-permissions`

### 后续需要处理（补齐与落地）

- 前端权限引导流程：
  - 在 UI 中串联 `permission_list -> permission_request -> permission_open_settings` 的引导路径。
  - 对不可交互申请的权限给出明确提示与“前往系统设置”按钮。
- macOS 权限细化文档：
  - 明确辅助功能、屏幕录制、输入监听、麦克风/摄像头的申请路径与失败提示。
- Windows 权限与防火墙引导：
  - UAC 提权时机与提示文案；必要时引导用户放行防火墙规则。
- Linux 权限与 Wayland/X11 兼容说明：
  - 无统一权限系统时的替代路径与风险提示。
- 权限状态订阅与前端联动：
  - 订阅 `permission_change` 事件，刷新 UI 状态并提示用户重试。

## 兼容性分析

以下为“必须关注”的差异点，影响构建、运行、权限、安全与分发。

### 1. 构建与依赖（Rust + vcpkg + system libs）

- 依赖管理差异：
  - macOS 使用 vcpkg + Homebrew 系统库较多，存在架构与 SDK 版本差异。
  - Windows 需处理 MSVC/Clang 工具链、VCPKG triplet、DLL 运行时路径。
  - Linux 发行版差异大（glibc 版本、Wayland/X11、图形/音视频系统库）。
- 风险：构建失败、运行时缺库、ABI 不兼容。

### 2. 图形与窗口系统（Tauri）

- macOS：窗口、托盘、菜单栏行为与权限要求严格。
- Windows：托盘与窗口焦点行为与 macOS 不同，需要定制处理。
- Linux：Wayland/X11 双体系；托盘支持依赖 DE/桌面环境，表现不一。
- 风险：托盘不可用、窗口行为异常、热键失效。

### 3. 系统权限与安全策略

- macOS：辅助功能、屏幕录制、输入监听等权限需显式申请；沙盒/签名要求严格。
- Windows：UAC、注册表、服务权限；防火墙、驱动与签名。
- Linux：缺少统一权限系统，需要分发文档指导用户配置。
- 风险：功能不可用、首次运行卡住或权限失败。

### 4. 自动启动与后台运行

- macOS：LaunchAgents/LaunchDaemons、App 登录项管理。
- Windows：注册表 Run 项、任务计划、服务模式（可选）。
- Linux：systemd user service 或 autostart desktop entry。
- 风险：自启动失效或被系统阻止。

### 5. 文件系统与路径

- 路径分隔符、编码与大小写敏感性差异。
- 用户目录与配置路径差异已定义，但需要统一接口与回退策略。
- 风险：配置丢失、日志路径不可写、升级后丢配置。

### 6. 网络与安全

- 防火墙策略差异：Windows Defender / macOS PF / Linux 发行版规则不同。
- 端口占用与权限：低端口权限、端口复用与代理设置差异。
- TLS 与证书存储差异：系统证书存储位置不一。
- 风险：连接失败、代理不兼容、证书链错误。

### 7. 打包与更新

- macOS：DMG/PKG、签名与公证（Notarization）。
- Windows：MSI/EXE、代码签名与 Smartscreen。
- Linux：DEB/RPM/AppImage/Flatpak 的选择与维护成本。
- 风险：安装失败、更新失败、系统安全拦截。

## 解决计划（分阶段）

### 阶段 1：基础能力一致化（2-3 周）

目标：统一路径、配置、日志、依赖检测、托盘基本能力。

- 抽象平台层（platform module）：
  - `paths`：统一配置、日志、缓存路径生成（对齐 `log_dir_get` 与 app 数据目录逻辑）。
  - `autostart`：统一自动启动接口（复用 `autolaunch_set / autolaunch_get`）。
  - `tray`：统一托盘 API（在 `setup_tray` 基础上补齐平台差异）。
- 依赖检查/安装：
  - 统一依赖清单（vcpkg libs + runtime），与 `DependencyManager` 输出一致。
  - 启动时进行依赖自检（复用 `dependency_summary / dependency_list`），失败时落地提示与可修复指南。
- 配置与日志路径：
  - 使用 `dirs` crate，添加平台兜底策略。
  - 严格避免硬编码路径。

交付物：
- 平台适配层（代码）
- 依赖检查与修复指引（文档）
- 最小可用托盘与自动启动

### 阶段 2：权限与系统集成（3-4 周）

目标：权限流程可用、文档齐全、首次运行体验清晰。

- macOS：
  - 辅助功能、屏幕录制、输入监听权限申请流程（已在 `permission_*` 命令中具备基础能力）。
  - 启动时检测权限状态并提示打开系统设置（落在前端 + `permission_open_settings`）。
- Windows：
  - UAC 权限提示策略（按需提权）。
  - 防火墙规则引导或自动配置。
- Linux：
  - 提供 DE/发行版差异的文档指引。
  - Wayland/X11 的兼容策略。

交付物：
- 权限检测与提示机制
- 跨平台权限/防火墙配置指南
- 错误码与可读提示

### 阶段 3：打包与更新（3-4 周）

目标：可稳定发布与升级，减少系统拦截与安装失败。

- macOS：
  - 统一签名与公证流程，发布 DMG/PKG（与 `tauri.conf.json` 的 bundle 配置一致）。
- Windows：
  - MSI/EXE 包策略与签名。
  - Smartscreen 提示优化（签名、发布渠道）。
- Linux：
  - 优先 AppImage 或 DEB；扩展 RPM 或 Flatpak（视目标用户）。
- 更新：
  - 提供统一更新策略（增量/全量）。
  - 更新失败回滚策略。

交付物：
- 跨平台打包流程
- 更新策略文档
- 自动化发布 pipeline

### 阶段 4：回归测试与稳定性（持续）

目标：形成可持续的跨平台回归体系。

- 构建矩阵：macOS arm64/x86_64、Windows x86_64、Linux x86_64/arm64。
- 用例覆盖：
  - 安装/卸载/升级。
  - 自动启动、托盘操作、后台运行。
  - 依赖安装与缺失修复。
  - 网络连接、代理、断网恢复。
  - 权限申请与失败提示。
- 自动化：CI 集成多平台构建 + smoke test。

交付物：
- 跨平台测试用例清单
- CI 构建与发布流水线

## 平台专项处理清单（重点事项）

### macOS

- 代码签名与公证。
- 权限：辅助功能、屏幕录制、输入监听。
- ARM/x86 双架构构建与依赖一致性。

### Windows

- MSVC/clang 工具链统一与运行时 DLL 管理。
- UAC 与防火墙策略。
- 托盘与窗口焦点行为兼容。

### Linux

- Wayland/X11 兼容策略与托盘支持差异。
- glibc 与系统库兼容，优先选择 AppImage 或发行版包。

## 风险与缓解

- 构建环境分裂：统一 vcpkg + CI 预构建缓存。
- 权限问题导致功能不可用：启动检测 + 引导文档。
- Linux 桌面环境差异：提供最小能力回退和分发说明。
- 远程桌面依赖复杂：提前锁定依赖版本与 ABI。

## 近期执行建议（可直接排期）

1. 建立平台抽象模块与接口清单。
2. 整理依赖清单与自检逻辑（对齐 `DependencyManager` 与 Tauri 命令）。
3. 完成 macOS 权限检测与引导（基于 `permission_*` 与 `check_disk_access`）。
4. 完成 Windows 自动启动与防火墙引导（基于 `autolaunch_*`）。
5. 完成 Linux AppImage 或 DEB 打包方案（对齐 `tauri.conf.json` bundle 设置）。
6. 搭建 CI 跨平台构建与最小 smoke test。
