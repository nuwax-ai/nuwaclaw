# 多平台兼容可执行方案（macOS / Windows / Linux）

本文给出可直接执行的跨平台兼容方案，覆盖设计、接口、工程化落地、测试与发布。**客户端以项目中的 `tauri-client` 为唯一目标实现**。当前 **Tauri 客户端主要在 macOS 上开发调试，Windows/Linux 为目标兼容平台**。**不在项目中直接写代码**，但在本文中提供完整设计与关键代码片段（示例），方便后续按章落地。

## 与 tauri-client 对齐（现有目录与命令）

本方案全部落在 `tauri-client`（即本仓库 `crates/agent-tauri-client`）的前后端与 Tauri 命令层，不引入其它客户端。

- 目录与入口
- 前端入口与页面：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src`
- Tauri 入口：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/main.rs`
- Tauri 命令实现：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs`
- 打包与 CLI 参数：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/tauri.conf.json`

- 已有命令分组（与本方案接口直接对齐）
- 权限相关：`permission_check` / `permission_request` / `permission_open_settings` / `permission_list` / `permission_monitor_start` / `permission_monitor_stop` / `check_disk_access`
- 依赖管理：`dependency_list` / `dependency_summary` / `dependency_install` / `dependency_install_all` / `dependency_uninstall` / `dependency_check`
- Node/npm/uv 与本地依赖：`dependency_npm_install` / `dependency_npm_query_version` / `dependency_npm_reinstall` / `dependency_node_detect` / `dependency_uv_detect` / `dependency_local_env_init` / `dependency_local_check` / `dependency_local_install` / `dependency_local_check_latest`
- Shell 安装器与全局依赖：`dependency_shell_installer_check` / `dependency_shell_installer_install` / `dependency_npm_global_check` / `dependency_npm_global_install`
- 服务与外部二进制：`lanproxy_start` / `lanproxy_stop` / `lanproxy_restart` / `file_server_start` / `file_server_stop` / `file_server_restart` / `rcoder_start` / `rcoder_stop` / `rcoder_restart` / `services_stop_all` / `services_restart_all` / `services_status_all`
- 自动启动：`autolaunch_set` / `autolaunch_get`
- 日志与目录：`app_data_dir_get` / `log_dir_get` / `open_log_directory` / `read_logs` / `dialog_select_directory`
- 其它：`system_greet`

上述命令即为跨平台能力的现实接口层，本文中的“平台抽象/权限/托盘/自动启动/依赖/服务/更新”等设计，**最终都需要落到该命令集合的扩展或补齐**。

### 模块与命令映射表（必须落实）

| 模块 | 目标能力 | 现有命令 | 需要新增/补齐命令 | 主要落点文件 |
| --- | --- | --- | --- | --- |
| 路径与目录 | 统一配置/日志/缓存路径 | `app_data_dir_get` / `log_dir_get` / `open_log_directory` | `cache_dir_get` / `config_dir_get` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| 权限 | 检测/请求/设置入口/监控 | `permission_*` / `check_disk_access` | `permission_requirements` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| 自动启动 | 开/关 + 状态 | `autolaunch_set` / `autolaunch_get` | `autolaunch_diagnose` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| 托盘与窗口 | 统一托盘菜单与关闭行为 | 已存在（`setup_tray` 在 Rust 侧） | `tray_status` / `tray_rebuild` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| 依赖与预检 | 自检/修复/状态汇总 | `dependency_*` | `preflight_check` / `preflight_fix` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| 服务管理 | lanproxy/file/rcoder | `lanproxy_*` / `file_server_*` / `rcoder_*` / `services_*` | `service_health` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| MCP Proxy | 端口/配置/启停 | `mcp_proxy_start` / `mcp_proxy_stop` / `mcp_proxy_restart` | `mcp_proxy_status` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| 网络与防火墙 | 端口占用/防火墙提示 | 无 | `network_port_check` / `firewall_guide` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |
| 更新 | 可用更新检查/提示 | 无 | `update_check` / `update_apply` | `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` |

## 近期功能问题处理清单（基于代码确认）

- 服务与登录流程：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src/services/auth.ts` 已在 `logout()` 调用 `services_stop_all`，要求 Windows/Linux 行为一致。
- 自动重连逻辑：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src/App.tsx` 在无 savedKey 时强制 `stopAllServices()`，需确保三平台启动后不遗留服务。
- 服务重启依赖：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` 的 `services_restart_all` 依赖 store 中端口与目录键，缺失时会返回错误或回退默认 workspace 目录，需确认 Windows/Linux path 兼容。
- MCP Proxy：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs` 新增 `mcp_proxy_*` 命令，`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src/services/setup.ts` 与 `store.ts` 维护配置，需要补充三平台端口占用/防火墙引导。
- 更新检查：`/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src/pages/AboutPage.tsx` 与 `/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src/services/updater.ts` 支持手动与启动检查，需要对 Windows/Linux 产物与签名策略对齐。

## 目标与非目标

- 目标
- 三平台行为一致：托盘、自动启动、权限引导、依赖管理、外部服务、配置路径、更新策略。
- 可重复构建：本地 + CI 输出一致产物。
- 可回归：跨平台最小 smoke test + 关键路径用例。
 - 近期重点：兼顾功能问题修复与跨平台对齐，避免只修 macOS 导致三端分叉。

- 非目标
- 不在本次文档里实现功能代码。
- 不覆盖移动端。

## 关键设计原则

- 平台差异显式化：通过统一接口 + 平台实现（`cfg(target_os)`）隔离差异。
- 容错优先：所有跨平台功能必须有“失败兜底 + 用户修复入口”。
- 可观测：任何失败必须落日志 + 事件上报 + UI提示。
- 可回滚：更新/安装必须支持失败回滚或安全退出。

## 目录结构建议（设计层）

建议增加统一平台抽象层（示意，不落地到代码）：

```
crates/
  platform/
    src/
      lib.rs
      paths.rs
      autostart.rs
      tray.rs
      permissions.rs
      firewall.rs
      services.rs
      updates.rs
      preflight.rs
      os/
        macos/*.rs
        windows/*.rs
        linux/*.rs
```

## 平台能力矩阵（定义“必须一致”的行为）

- 自动启动：开机/登录后后台常驻。
- 托盘：显示状态、开关主窗、退出/重启。
- 权限：自动检测 + 引导 + 可恢复入口。
- 依赖：自检/自动安装/失败提示与重试。
- 目录：配置/日志/缓存路径统一抽象。
- 网络：端口占用检测、防火墙引导。
- 更新：可用更新提示 + 安装/回滚策略。

## 核心接口设计（示例代码）

### 通用错误与结果

```rust
// crates/platform/src/lib.rs
#[derive(Debug)]
pub enum PlatformError {
  Unsupported(&'static str),
  PermissionDenied(&'static str),
  Io(std::io::Error),
  InvalidState(&'static str),
  ExternalCommandFailed { cmd: String, code: i32 },
}

pub type PlatformResult<T> = Result<T, PlatformError>;
```

### 1) 路径与配置

```rust
// crates/platform/src/paths.rs
pub struct AppPaths {
  pub config_dir: std::path::PathBuf,
  pub data_dir: std::path::PathBuf,
  pub cache_dir: std::path::PathBuf,
  pub log_dir: std::path::PathBuf,
}

pub fn app_paths(app_name: &str) -> PlatformResult<AppPaths> {
  #[cfg(target_os = "macos")]
  {
    let base = dirs::data_dir().ok_or(PlatformError::InvalidState("no data_dir"))?;
    let config_dir = base.join(app_name);
    let data_dir = base.join(app_name);
    let cache_dir = dirs::cache_dir().ok_or(PlatformError::InvalidState("no cache_dir"))?.join(app_name);
    let log_dir = base.join(app_name).join("logs");
    return Ok(AppPaths { config_dir, data_dir, cache_dir, log_dir });
  }

  #[cfg(target_os = "windows")]
  {
    let base = dirs::data_dir().ok_or(PlatformError::InvalidState("no data_dir"))?;
    let config_dir = base.join(app_name);
    let data_dir = base.join(app_name);
    let cache_dir = dirs::cache_dir().ok_or(PlatformError::InvalidState("no cache_dir"))?.join(app_name);
    let log_dir = base.join(app_name).join("logs");
    return Ok(AppPaths { config_dir, data_dir, cache_dir, log_dir });
  }

  #[cfg(target_os = "linux")]
  {
    let config_dir = dirs::config_dir().ok_or(PlatformError::InvalidState("no config_dir"))?.join(app_name);
    let data_dir = dirs::data_dir().ok_or(PlatformError::InvalidState("no data_dir"))?.join(app_name);
    let cache_dir = dirs::cache_dir().ok_or(PlatformError::InvalidState("no cache_dir"))?.join(app_name);
    let log_dir = data_dir.join("logs");
    return Ok(AppPaths { config_dir, data_dir, cache_dir, log_dir });
  }
}
```

### 2) 自动启动

```rust
// crates/platform/src/autostart.rs
pub enum AutostartBackend {
  LaunchAgents,
  RegistryRun,
  TaskScheduler,
  SystemdUser,
  DesktopEntry,
}

pub struct AutostartStatus {
  pub enabled: bool,
  pub backend: AutostartBackend,
  pub details: String,
}

pub fn set_autostart(enable: bool) -> PlatformResult<()> {
  #[cfg(target_os = "macos")]
  { /* write/remove LaunchAgents plist */ }
  #[cfg(target_os = "windows")]
  { /* registry Run key; fallback to Task Scheduler */ }
  #[cfg(target_os = "linux")]
  { /* systemd --user; fallback to ~/.config/autostart */ }
}

pub fn get_autostart() -> PlatformResult<AutostartStatus> {
  #[cfg(target_os = "macos")]
  { /* read LaunchAgents */ }
  #[cfg(target_os = "windows")]
  { /* read registry + task scheduler */ }
  #[cfg(target_os = "linux")]
  { /* read systemd unit or desktop entry */ }
}
```

### 3) 权限检测与引导

```rust
// crates/platform/src/permissions.rs
pub enum PermissionKind {
  ScreenRecording,
  Accessibility,
  FullDiskAccess,
  Microphone,
  Camera,
}

pub struct PermissionState {
  pub granted: bool,
  pub can_request: bool,
  pub details: String,
}

pub fn check_permission(kind: PermissionKind) -> PlatformResult<PermissionState> {
  #[cfg(target_os = "macos")]
  { /* tccutil / API; returns PermissionState */ }
  #[cfg(target_os = "windows")]
  { /* best-effort: registry / runtime probe */ }
  #[cfg(target_os = "linux")]
  { /* best-effort: always can_request=false + docs */ }
}

pub fn request_permission(kind: PermissionKind) -> PlatformResult<PermissionState> {
  #[cfg(target_os = "macos")]
  { /* prompt user; may require restart */ }
  #[cfg(target_os = "windows")]
  { return Err(PlatformError::Unsupported("no explicit request flow")); }
  #[cfg(target_os = "linux")]
  { return Err(PlatformError::Unsupported("no explicit request flow")); }
}

pub fn open_permission_settings(kind: PermissionKind) -> PlatformResult<()> {
  #[cfg(target_os = "macos")]
  { /* open system settings */ }
  #[cfg(target_os = "windows")]
  { /* open system settings */ }
  #[cfg(target_os = "linux")]
  { /* open docs URL */ }
}
```

### 4) 托盘与窗口行为

```rust
// crates/platform/src/tray.rs
pub struct TrayState {
  pub connected: bool,
  pub service_ok: bool,
}

pub fn setup_tray(app: &tauri::AppHandle) -> PlatformResult<()> {
  // 统一菜单：打开主窗、最小化、重启服务、退出
  // Linux: 若托盘不可用，回退到“关闭=最小化到后台”
}

pub fn tray_update_state(app: &tauri::AppHandle, state: TrayState) -> PlatformResult<()> {
  // 根据状态刷新托盘菜单与提示
}

pub fn on_window_close(app: &tauri::AppHandle) -> PlatformResult<()> {
  // 关闭=隐藏，保留托盘
}
```

### 5) 依赖自检与修复

```rust
// crates/platform/src/preflight.rs
pub struct PreflightItem {
  pub id: &'static str,
  pub ok: bool,
  pub fixable: bool,
  pub message: String,
  pub details: String,
}

pub fn preflight_check() -> Vec<PreflightItem> {
  // 统一依赖清单 + 平台特化检查
  // 示例项：node/uv/lanproxy/ports/permissions/log_dir_writable
  vec![]
}

pub fn preflight_fix(id: &str) -> PlatformResult<()> {
  // 安装/修复依赖
  Ok(())
}
```

### 6) 防火墙/网络端口

```rust
// crates/platform/src/firewall.rs
pub struct PortCheck {
  pub port: u16,
  pub in_use: bool,
  pub process_hint: Option<String>,
}

pub fn ensure_firewall_rules() -> PlatformResult<()> {
  #[cfg(target_os = "macos")]
  { /* best-effort; return Unsupported if no privilege */ }
  #[cfg(target_os = "windows")]
  { /* netsh advfirewall; return PermissionDenied on UAC */ }
  #[cfg(target_os = "linux")]
  { /* ufw/firewalld best-effort; fallback to docs */ }
}

pub fn port_in_use(port: u16) -> PlatformResult<PortCheck> {
  // cross-platform check via std::net bind probe + process hint
}
```

### 7) 更新策略

```rust
// crates/platform/src/updates.rs
pub enum UpdateChannel { Stable, Beta }

pub struct UpdatePlan {
  pub current_version: String,
  pub available_version: Option<String>,
  pub mandatory: bool,
  pub release_notes: Option<String>,
}

pub enum UpdateAction {
  Noop,
  DownloadAndInstall,
}

pub fn check_update(channel: UpdateChannel) -> PlatformResult<UpdatePlan> {
  // 统一检查策略 + 平台差异处理
}

pub fn apply_update(plan: UpdatePlan) -> PlatformResult<UpdateAction> {
  // 允许用户延迟更新，强制更新需带 reason
}
```

## 前端交互协议（Tauri Command 示例）

> 仅作为设计与协议定义，不修改现有代码。

```rust
// src-tauri commands (示意)
#[tauri::command]
fn platform_preflight_check() -> Vec<PreflightItem> {}

#[tauri::command]
fn platform_preflight_fix(id: String) -> Result<(), String> {}

#[tauri::command]
fn platform_autostart_set(enable: bool) -> Result<(), String> {}

#[tauri::command]
fn platform_permission_open(kind: String) -> Result<(), String> {}
```

前端按流程：

- 启动 -> `preflight_check` -> 展示结果 -> 允许一键修复。
- 权限缺失 -> 显示引导页 -> `permission_open_settings`。
- 自动启动开关 -> `autostart_set`。

与现有命令对齐建议：

- `platform_preflight_check` 对应现有 `dependency_*` 聚合能力，必要时新增 `preflight_check`。
- `platform_autostart_set` 对应 `autolaunch_set`，前端直接调用即可。
- `platform_permission_open` 对应 `permission_open_settings`，前端直接调用即可。

## 构建与打包策略

### macOS

- 二进制：`universal2`（arm64 + x86_64）。
- 签名：Developer ID + `codesign`。
- 公证：`notarytool`。
- 产物：DMG/PKG 任选，建议 DMG。

### Windows

- 工具链：MSVC。
- 签名：EV 证书或标准代码签名。
- 产物：MSI 或 NSIS/EXE。

### Linux

- 产物：优先 AppImage；同时提供 DEB。
- 运行时：glibc 2.28+ 兼容。

## CI 构建矩阵（GitHub Actions 示例）

```yaml
name: build-matrix
on:
  push:
    branches: [ main ]
  pull_request:

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-22.04]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Build
        run: cargo build --release
      - name: Smoke test
        run: cargo test -p agent-tauri-client -- --nocapture
```

说明：

- 上述 `cargo test -p agent-tauri-client` 需与实际 workspace/crate 名称一致，落地前请核对。

## 最小化跨平台测试用例（Smoke Test）

- 启动应用：主窗可打开、托盘可见。
- 自动启动开关：开/关后状态可回读。
- 权限检测：权限缺失时提示文案正确。
- 依赖自检：无依赖时提示并可修复。
- 日志读写：日志目录存在且可写。
- 服务启动：外部服务（如 lanproxy）可启动。
- MCP Proxy：`mcp_proxy_start` 可启动，端口占用提示可用。
- 更新检查：手动检查能给出一致的提示与错误信息。

## macOS -> Windows/Linux Bring-up 清单（必做）

- Windows 首次构建：在 `windows-latest` 完成 `cargo build --release`。
- Windows 首次运行：`tauri-client` 主窗可打开，托盘可见。
- Windows 自启动：`autolaunch_set(true)` 生效，重启后状态可回读。
- Windows 权限：`permission_list` 能返回结果并提示缺失项。
- Windows 防火墙：首次服务启动时有提示或指导文案。

- Linux 首次构建：在 `ubuntu-22.04` 完成 `cargo build --release`。
- Linux 首次运行：主窗可打开，托盘可见或触发降级策略。
- Linux 自启动：systemd user 或 desktop entry 生效。
- Linux 权限：`permission_list` 返回 best-effort 结果。
- Linux 依赖：`dependency_*` 可检测并提示修复路径。

## 执行步骤（按里程碑）

### 里程碑 0：近期功能问题处理与同步（持续）

- 每个修复必须确认：是否涉及 `tauri-client` 的跨平台行为。
- 修复策略：先在 `tauri-client` 抽象层或命令层修复，再验证 macOS 通过，随后同步验证 Windows/Linux。
- 对新增修复，补充到“模块与命令映射表”与 smoke test 用例中。
- 以“近期功能问题处理清单（基于代码确认）”为基线，每周复核一次并更新。

### 里程碑 1：平台抽象与基础能力对齐（2 周）

- 确认接口清单（paths/autostart/permissions/tray/preflight）。
- 写出每个平台的最小实现伪代码与流程。
- 输出开发任务拆分与负责人。

### 里程碑 2：权限与系统集成（2-3 周）

- 完成权限引导 UI 设计与文案。
- Windows 防火墙 / UAC 引导方案与脚本。
- Linux Wayland/X11 文档与测试覆盖。

### 里程碑 3：发布链路与更新（2-3 周）

- 签名与公证流程固化（macOS/Windows）。
- Linux 产物与更新策略确定。
- 更新回滚方案落地。

### 里程碑 4：稳定性与回归（持续）

- CI 矩阵稳定化。
- 用户级回归 checklist。
- 发布后监控与告警。

## 风险与对策

- 依赖安装失败：提供离线包或手动安装文档。
- Linux 桌面环境差异：统一托盘替代（AppIndicator）+ 降级方案。
- Windows 权限阻挡：UAC 提示 + 运行时提示。
- macOS 权限拒绝：检测失败后必须提供可恢复入口。

## 交付物清单

- 设计文档（本文）。
- 平台抽象层接口定义与伪代码。
- CI 构建矩阵。
- Smoke Test 用例清单。
- 发布与签名流程说明。

---

如需，我可以按本文结构继续输出具体的任务分解表（Jira/Notion）、负责人建议与时间排期。
