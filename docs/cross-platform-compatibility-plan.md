# 跨平台兼容性分析与解决计划

本文面向 nuwax-agent 在 macOS / Windows / Linux 的跨平台一致性，给出兼容性分析、结合当前代码的落点梳理，以及“已完成/待补齐”的实现评估。

## 目标与范围

- 目标：在三大桌面平台上提供一致的核心能力（远程连接、AI Agent 任务、托盘、自动启动、依赖管理、配置与更新），并保证安装、运行、升级体验稳定。
- 范围：客户端（仅 Tauri UI）、本地服务组件、依赖安装与打包发布、系统权限与安全策略、配置路径与文件权限、网络与系统服务能力。

## 当前现状（来自仓库信息）

- 目标平台：macOS（arm64/x86_64）、Windows（x86_64）、Linux（x86_64/arm64）均标记为支持。
- 依赖：vcpkg（如 libvpx/libyuv/opus/aom）、Rustdesk 相关库、Tauri 客户端为主。
- 功能：托盘、自动启动、依赖自动安装、远程桌面（开发中）。
- 配置路径：macOS `~/Library/Application Support/...`；Windows `%APPDATA%/...`；Linux `~/.config/...`。

## 结合当前代码的落点梳理（Tauri）

- Tauri 主入口与能力聚合：
  - `crates/agent-tauri-client/src-tauri/src/main.rs`
  - `crates/agent-tauri-client/src-tauri/src/lib.rs`
- 权限管理与监控：
  - `permission_*` 命令已在 `crates/agent-tauri-client/src-tauri/src/lib.rs` 中实现，底层依赖 `crates/system-permissions`。
  - macOS 完全磁盘访问检测：`check_disk_access`（同上）。
- 自动启动：
  - `autolaunch_set / autolaunch_get`（`auto_launch`），`crates/agent-tauri-client/src-tauri/src/lib.rs`。
- 系统托盘：
  - `setup_tray` 与托盘菜单事件在 `crates/agent-tauri-client/src-tauri/src/lib.rs`。
- 外部二进制打包与路径：
  - `tauri.conf.json` 中 `bundle.externalBin` 已配置 `binaries/nuwax-lanproxy`。
  - `get_lanproxy_bin_path` 处理多平台/架构差异与查找路径。
- CLI 参数与最小化启动：
  - `tauri.conf.json` 中 `cli.args` 与 `run()` 内 `--tab/--minimized` 处理联动。
- 依赖检测/安装：
  - `DependencyManager` + `dependency_*` 命令已覆盖基础检测/安装流程。
- 配置与日志：
  - `log_dir_get / read_logs / open_log_directory` 已实现；Store 读写通过 `tauri_plugin_store` 完成。

## 兼容性分析（高风险差异点）

### 1. 构建与依赖

- macOS：vcpkg + SDK 版本差异、arm64/x86_64 双架构。
- Windows：MSVC/Clang 工具链、VCPKG triplet、DLL 运行时路径。
- Linux：glibc 版本、Wayland/X11、发行版系统库差异。
- 风险：构建失败、运行时缺库、ABI 不兼容。

### 2. 窗口/托盘/系统集成

- macOS：托盘与菜单行为严格，权限与签名影响功能。
- Windows：托盘与窗口焦点行为差异明显。
- Linux：DE/桌面环境差异，托盘支持不一致。
- 风险：托盘不可用、窗口行为异常、交互不一致。

### 3. 系统权限与安全

- macOS：辅助功能、屏幕录制、输入监听等权限需显式申请。
- Windows：UAC、注册表/服务权限、防火墙策略。
- Linux：无统一权限系统，需文档指导。
- 风险：功能不可用、首次运行卡住或权限失败。

### 4. 自动启动与后台运行

- macOS：LaunchAgents/登录项。
- Windows：注册表 Run/任务计划。
- Linux：systemd user service / autostart entry。
- 风险：自启动失效或被系统阻止。

### 5. 配置/日志路径与文件权限

- 路径分隔符、大小写敏感性、权限模型差异。
- 风险：配置丢失、日志不可写、升级后丢配置。

### 6. 网络与安全

- 防火墙策略与端口占用差异。
- 代理/证书存储位置差异。
- 风险：连接失败、代理不兼容、证书链错误。

### 7. 打包与更新

- macOS：DMG/PKG、签名与公证。
- Windows：MSI/EXE、签名与 Smartscreen。
- Linux：DEB/RPM/AppImage/Flatpak 选择。
- 风险：安装/更新失败、系统安全拦截。

## 实现现状评估（按模块：已完成 / 待补齐）

### 权限

- 已完成：
  - `permission_check / permission_request / permission_open_settings / permission_list / permission_monitor_start / permission_monitor_stop`。
  - macOS 完全磁盘访问检测 `check_disk_access`。
  - `system_permissions` 提供统一权限抽象。
- 待补齐：
  - 前端权限引导流程与可恢复路径。
  - macOS 权限细化文档（辅助功能/屏幕录制/输入监听/麦克风/摄像头）。
  - Windows 防火墙/UAC 引导；Linux Wayland/X11 权限说明。
  - 订阅 `permission_change` 事件并联动 UI。

### 托盘与窗口行为

- 已完成：
  - `setup_tray` 与托盘菜单事件。
  - 窗口关闭时隐藏到托盘。
- 待补齐：
  - Linux 不同 DE/Wayland/X11 兼容测试与回退策略。
  - Windows 托盘焦点/显示行为一致性处理。

### 自动启动

- 已完成：
  - `autolaunch_set / autolaunch_get` 基于 `auto_launch`。
  - macOS 与 Windows 平台特化配置。
- 待补齐：
  - Linux systemd/autostart 实测验证与文档。
  - 启动失败时错误提示与用户修复入口。

### 依赖检测与安装

- 已完成：
  - `DependencyManager` + `dependency_*` 命令。
  - Node/npm/uv 检测与本地安装能力。
- 待补齐：
  - 统一依赖清单与平台错误提示策略。
  - 安装失败的可恢复引导（重试/替代方案）。

### 外部二进制与服务管理

- 已完成：
  - `get_lanproxy_bin_path` 多平台路径与架构处理。
  - `bundle.externalBin` 已配置。
  - `services_*` 与 `lanproxy_*` 服务命令。
- 待补齐：
  - 各平台二进制签名/权限策略确认。
  - 二进制缺失/权限失败的前端提示与修复路径。

### 配置与日志

- 已完成：
  - `log_dir_get / read_logs / open_log_directory`。
  - Store 读写基于 `tauri_plugin_store`。
- 待补齐：
  - 配置/缓存/日志路径统一抽象与兜底策略。
  - 跨平台权限与可写性检测。

### 打包与更新

- 已完成：
  - `tauri.conf.json` 启用 bundle、图标与外部二进制配置。
- 待补齐：
  - macOS 公证流程、Windows 签名、Linux 产物策略固化。
  - updater 配置、更新回滚策略。

### CI 与跨平台测试

- 已完成：
  - 基础结构存在，但未见跨平台构建矩阵与 smoke test 的落地。
- 待补齐：
  - macOS/Windows/Linux 构建矩阵与最小 smoke test。
  - 安装/升级/权限/托盘/自动启动/依赖修复的用例覆盖。

## 解决计划（分阶段）

### 阶段 1：基础能力一致化（2-3 周）

- 平台抽象层对齐：`paths / autostart / tray`。
- 依赖清单与自检流程对齐 `DependencyManager`。
- 配置与日志路径统一抽象 + 兜底策略。

### 阶段 2：权限与系统集成（3-4 周）

- 权限引导流程打通（前端联动）。
- macOS 权限申请与文档。
- Windows 防火墙/UAC 引导。
- Linux Wayland/X11 兼容说明。

### 阶段 3：打包与更新（3-4 周）

- macOS 公证/签名，Windows 签名，Linux 产物策略。
- updater 与回滚策略。

### 阶段 4：回归测试与稳定性（持续）

- 多平台构建矩阵与 smoke test。
- 安装/卸载/升级/权限/托盘/自启动/依赖修复覆盖。

## 近期执行建议（可直接排期）

1. 建立平台抽象模块与接口清单（paths/autostart/tray）。
2. 整理依赖清单与自检逻辑（与 `DependencyManager` 对齐）。
3. 完成 macOS 权限检测与前端引导。
4. 完成 Windows 自动启动与防火墙引导。
5. 完成 Linux AppImage 或 DEB 打包方案。
6. 搭建 CI 跨平台构建与最小 smoke test。
