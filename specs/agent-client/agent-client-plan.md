# Agent Client 实现计划文档

> 版本：v2.1.0
> 创建日期：2026-01-29
> 基于设计文档：agent-client-spec.md
> 状态：深度实现计划

---

## 开发阶段说明

### 阶段一：核心通信与 UI（当前优先级）

**目标**：验证 `agent-server-admin` 与 `agent-client` 之间的双向通信能力，确保 `data-server` 的 P2P/TCP/WebSocket 通信正常工作。

**包含 Phase**：
- Phase 1：基础框架（UI、脚手架、托盘、自启动、协议版本、安全存储）
- Phase 2：核心功能（连接管理、业务通道、设置界面、客户端信息、安全机制）
- Phase 3：依赖管理（Node.js、npm 工具）
- Phase 3.5：agent-server-admin 最小实现（用于通信验证）
- Phase 3.6：跨平台打包（cargo-packager、CI/CD）

**验证里程碑**：
- [ ] 客户端可在 macOS/Windows/Linux 打包安装
- [ ] 客户端能连接 data-server（获取 ID）
- [ ] 管理端能发现并连接客户端
- [ ] 双向通信正常
- [ ] 支持 P2P/Relay 模式

### 阶段二：Agent 运行时集成（后续开发）

**目标**：集成 agent_runner，实现 Agent 任务执行等功能。

**包含 Phase**：
- Phase 4：Agent 运行时（AgentManager、任务执行、进度回传）
- Phase 5：增强功能（权限管理、日志、文件传输、远程桌面）
- Phase 6：收尾完善（关于、聊天、升级、国际化）

---

## 文档说明

本文档是 agent-client 技术设计的深度实现计划，专注于回答"如何实现"的问题，包含：
- 完整的代码片段和实现模式
- 详细的架构设计和技术选型
- 跨平台适配的具体方案
- 错误处理和边界条件

---

## 目录

1. [项目结构](#1-项目结构)
2. [Phase 1：基础框架](#phase-1基础框架p0)
3. [Phase 2：核心功能](#phase-2核心功能p0)
4. [Phase 3：依赖管理](#phase-3依赖管理p0)
5. [Phase 4：Agent 运行时](#phase-4agent-运行时p1) *后续开发*
6. [Phase 5：增强功能](#phase-5增强功能p1) *后续开发*
7. [Phase 6：收尾完善](#phase-6收尾完善p2) *后续开发*
8. [安全与网络实现](#8安全与网络实现)
9. [国际化与会话管理](#9国际化与会话管理)
10. [系统集成](#10系统集成)
11. [验收标准](#验收标准)

---

## 1. 项目结构

### 1.1 完整目录结构

```
nuwax-agent/                                   # 项目根目录
├── Cargo.toml                                 # Workspace 配置
├── Cargo.lock
│
├── crates/                                    # Crates 目录
│   ├── agent-client/                          # 主应用 crate
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs                       # 程序入口 (约 80 行)
│   │   │   ├── lib.rs                       # 库入口，导出公共 API
│   │   │   ├── app.rs                       # 应用状态管理 (约 150 行)
│   │   │   │
│   │   │   ├── components/                  # UI 组件模块
│   │   │   │   ├── mod.rs                   # 组件模块导出
│   │   │   │   ├── root.rs                  # 根组件，主布局 (约 200 行)
│   │   │   │   ├── status_bar.rs            # 状态栏组件 (约 150 行)
│   │   │   │   ├── client_info.rs           # 客户端信息 Tab (ID/密码)
│   │   │   │   ├── settings.rs              # 设置界面
│   │   │   │   │   ├── mod.rs               # 设置模块入口
│   │   │   │   │   ├── server.rs            # 服务器配置子页面
│   │   │   │   │   ├── security.rs          # 安全设置子页面
│   │   │   │   │   ├── general.rs           # 常规设置子页面
│   │   │   │   │   ├── appearance.rs        # 外观设置子页面
│   │   │   │   │   └── logging.rs           # 日志设置子页面
│   │   │   │   ├── dependency_manager.rs    # 依赖管理 Tab
│   │   │   │   ├── permissions.rs           # 权限设置 Tab
│   │   │   │   ├── about.rs                 # 关于界面
│   │   │   │   ├── remote_desktop.rs        # 远程桌面 Tab
│   │   │   │   └── chat.rs                  # 聊天界面
│   │   │   │
│   │   │   ├── core/                        # 核心逻辑模块
│   │   │   │   ├── mod.rs                   # 核心模块导出
│   │   │   │   ├── config.rs                # 配置管理 (约 200 行)
│   │   │   │   ├── connection.rs            # 连接管理 (约 300 行)
│   │   │   │   ├── agent.rs                 # Agent 管理 (约 250 行)
│   │   │   │   ├── dependency.rs            # 依赖管理核心 (约 300 行)
│   │   │   │   ├── file_transfer.rs         # 文件传输
│   │   │   │   ├── business_channel.rs      # 业务通道
│   │   │   │   ├── logger.rs                # 日志管理
│   │   │   │   │
│   │   │   │   └── platform/                # 平台适配层
│   │   │   │       ├── mod.rs               # 平台模块导出
│   │   │   │       ├── permissions.rs       # 权限检测
│   │   │   │       ├── auto_launch.rs       # 自启动管理
│   │   │   │       ├── directories.rs       # 跨平台目录
│   │   │   │       ├── windows.rs           # Windows 特定实现
│   │   │   │       ├── macos.rs             # macOS 特定实现
│   │   │   │       └── linux.rs             # Linux 特定实现
│   │   │   │
│   │   │   ├── message/                     # 消息协议模块
│   │   │   │   ├── mod.rs                   # 消息模块导出
│   │   │   │   ├── proto.rs                 # Protobuf 定义
│   │   │   │   ├── converter.rs             # 消息转换器
│   │   │   │   └── codec.rs                 # 消息编解码
│   │   │   │
│   │   │   ├── tray/                        # 系统托盘模块
│   │   │   │   ├── mod.rs                   # 托盘模块导出
│   │   │   │   ├── menu.rs                  # 托盘菜单
│   │   │   │   └── icon.rs                  # 图标加载
│   │   │   │
│   │   │   └── utils/                       # 工具函数
│   │   │       ├── mod.rs
│   │   │       ├── clipboard.rs             # 剪贴板操作
│   │   │       ├── version.rs               # 版本处理
│   │   │       ├── path.rs                  # 路径处理
│   │   │       └── notification.rs          # 通知工具
│   │   │
│   │   └── assets/                          # 资源文件
│   │       ├── icons/                       # 图标资源
│   │       │   ├── app.icns                 # macOS 图标
│   │       │   ├── app.ico                  # Windows 图标
│   │       │   ├── app.png                  # Linux 图标
│   │       │   ├── tray_macos.png           # macOS 托盘图标
│   │       │   ├── tray_windows.ico         # Windows 托盘图标
│   │       │   └── tray_linux.png           # Linux 托盘图标
│   │       │
│   │       └── locales/                     # 国际化资源
│   │           ├── en.json                  # 英文翻译
│   │           └── zh.json                  # 中文翻译
│   │
│   ├── agent-server-admin/                   # 服务器管理端
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── api/                         # HTTP API
│   │   │   │   ├── mod.rs
│   │   │   │   ├── client.rs                # 客户端管理 API
│   │   │   │   └── task.rs                  # 任务管理 API
│   │   │   ├── sse/                         # SSE 推送
│   │   │   │   ├── mod.rs
│   │   │   │   └── handler.rs               # SSE 处理器
│   │   │   ├── client_manager/              # 客户端管理
│   │   │   │   ├── mod.rs
│   │   │   │   └── manager.rs               # 客户端管理器
│   │   │   ├── ws/                          # WebSocket
│   │   │   │   ├── mod.rs
│   │   │   │   └── handler.rs               # WebSocket 处理器
│   │   │   └── config.rs                    # 服务配置
│   │   └── tests/
│   │       └── integration_tests.rs
│   │
│   ├── data-server/                          # 数据中转服务器
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs                      # 基于 rustdesk-server 封装
│   │   │   ├── relay.rs                     # 中继服务
│   │   │   ├── rendezvous.rs                # 信令服务
│   │   │   └── router.rs                    # 消息路由
│   │   └── tests/
│   │       └── relay_tests.rs
│   │
│   └── agent-protocol/                       # 共享协议 crate
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs                       # 库入口
│       │   ├── proto/                       # Protobuf 定义
│       │   │   ├── mod.rs                   # 模块导出
│       │   │   ├── message.proto            # 消息协议定义
│       │   │   ├── common.proto             # 公共消息定义
│       │   │   └── business.proto           # 业务消息定义
│       │   └── generated/                   # 生成的代码
│       │       └── mod.rs                   # 生成代码导出
│       ├── build.rs                         # Proto 编译脚本
│       └── tests/
│           └── proto_tests.rs
│
├── vendors/                                  # 第三方库（路径依赖）
│   ├── nuwax-rustdesk/                       # RustDesk fork
│   ├── rustdesk-server/                      # RustDesk Server fork
│   ├── gpui-component/                       # UI 组件库
│   ├── rcoder/                               # AI Agent 运行时
│   ├── auto-launch/                          # 开机自启动库
│   ├── tray-icon/                            # 系统托盘库
│   ├── muda/                                 # 菜单库
│   ├── enigo/                                # 输入模拟库
│   └── cargo-packager/                       # 打包工具
│
└── specs/                                    # 规格文档
    ├── agent-client.md                       # 需求文档
    ├── agent-client-spec.md                  # 技术规格
    ├── agent-client-plan.md                  # 实现计划
    ├── agent-client-task.md                  # 任务分解
    └── vendorsdoc/                           # 第三方库文档
```

### 1.2 Workspace Cargo.toml 完整配置

```toml
# Cargo.toml
[workspace]
members = [
    "crates/agent-client",
    "crates/agent-server-admin",
    "crates/data-server",
    "crates/agent-protocol",
]
resolver = "2"

# 排除不需要构建的目录
exclude = [
    "vendors",
    "specs",
    "assets",
]

# 统一版本管理
[workspace.package]
version = "1.0.0"
edition = "2021"
rust-version = "1.75"
authors = ["nuwax <dev@nuwax.com>"]

# 依赖版本锁定
[workspace.dependencies]
# Async 运行时
tokio = { version = "1.38", features = ["full"] }
async-trait = "0.1"

# 序列化
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
toml = "0.8"

# 错误处理
thiserror = "2.0"
anyhow = "1.0"

# 日志
tracing = "0.1"
tracing-subscriber = "0.3"
tracing-appender = "0.2"

# 工具库
dirs = "5.0"
url = "2.5"
uuid = { version = "1.10", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
regex = "1.10"

# 并发
dashmap = "6.1"
tokio-stream = "0.1"
futures = "0.3"

# 网络
reqwest = { version = "0.12", features = ["json"] }
tokio-tar = "0.3"

[patch.crates-io]
# 本地路径补丁
gpui = { git = "https://github.com/zed-industries/gpui", branch = "main" }
```

### 1.3 agent-client/Cargo.toml 完整配置

```toml
# agent-client/Cargo.toml
[package]
name = "nuwax-agent"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
description = "跨平台 Agent 客户端，支持远程桌面和 Agent 任务执行"
repository = "https://github.com/nuwax/nuwax-agent"
license = "MIT"

[lib]
name = "nuwax_agent"
crate-type = ["cdylib", "rlib"]

[[bin]]
name = "nuwax-agent"
path = "src/main.rs"

# Feature 控制表
[features]
default = ["tray", "auto-launch", "dependency-management"]
# 系统托盘
tray = ["dep:tray-icon", "dep:muda", "dep:image"]
# 开机自启动
auto-launch = ["dep:auto-launch"]
# 依赖管理界面
dependency-management = ["dep:reqwest", "dep:tokio-tar"]
# 远程桌面功能
remote-desktop = ["dep:scrap", "dep:enigo"]
# 聊天界面
chat-ui = []
# 文件传输
file-transfer = []
# 开发者模式日志
dev-mode = ["dep:tracing-subscriber/dev-filter", "dep:env_filter"]

[dependencies]
# Workspace 依赖
agent-protocol = { path = "../agent-protocol" }
tokio = { workspace = true, features = ["full"] }
async-trait = { workspace = true }
serde = { workspace = true, features = ["derive"] }
serde_json = { workspace = true }
toml = { workspace = true }
thiserror = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
tracing-appender = { workspace = true }
dashmap = { workspace = true }
tokio-stream = { workspace = true }
futures = { workspace = true }
dirs = { workspace = true }
url = { workspace = true }
uuid = { workspace = true, features = ["v4"] }
chrono = { workspace = true }
regex = { workspace = true }

# UI 框架
gpui = { git = "https://github.com/zed-industries/gpui", branch = "main" }
gpui-component = { path = "../../vendors/gpui-component" }

# 系统托盘 (可选)
tray-icon = { path = "../../vendors/tray-icon", optional = true }
muda = { path = "../../vendors/muda", optional = true }
image = { version = "0.24", optional = true }

# 开机自启动 (可选)
auto-launch = { path = "../../vendors/auto-launch", optional = true }

# 通信库 - nuwax-rustdesk
librustdesk = { path = "../../vendors/nuwax-rustdesk" }

# Agent 运行时 - rcoder/agent_runner
agent_runner = { path = "../../vendors/rcoder/crates/agent_runner" }

# 远程桌面
scrap = { path = "../../vendors/nuwax-rustdesk/libs/scrap", optional = true }
enigo = { version = "0.1", optional = true }

# 依赖管理
reqwest = { version = "0.12", optional = true }
tokio-tar = { version = "0.3", optional = true }
zip = { version = "0.6" }

# 平台特定
[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.9"
security-framework = "2"

[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"

[build-dependencies]
prost-build = "0.12"
tonic-build = "0.10"
vergen = { version = "9", features = ["build", "git"] }

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = true

[profile.dev]
debug = true
split-debuginfo = "unpacked"

[package.metadata]
# cargo-binstall 支持
bins = [
    { name = "nuwax-agent", src = "src/main.rs" }
]
```

### 1.4 agent-protocol/Cargo.toml 完整配置

```toml
# agent-protocol/Cargo.toml
[package]
name = "agent-protocol"
version.workspace = true
edition.workspace = true
authors.workspace = true
description = "Agent 客户端通信协议定义"
repository.workspace = true
license.workspace = true

[dependencies]
prost = "0.12"
prost-types = "0.12"
tokio = { version = "1.38", features = ["sync"] }
bytes = "1.7"
serde = { version = "1.0", features = ["derive", "rc"] }
serde_json = "1.0"
thiserror = "2.0"
anyhow = "1.0"
uuid = { version = "1.10", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }

[dev-dependencies]
prost-build = "0.12"
tempfile = "4.0"

[build-dependencies]
prost-build = "0.12"

[features]
default = []
# 开发模式：包含测试数据生成
dev-mode = []

[package.metadata.protobuf]
# Proto 文件路径
proto-path = "src/proto"
# 输出目录
out-dir = "src/generated"
```

### 1.5 build.rs 完整实现

```rust
// agent-protocol/build.rs
use std::env;
use std::path::PathBuf;

fn main() {
    let proto_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("src/proto");

    // 查找所有 proto 文件
    let mut proto_files = Vec::new();
    collect_proto_files(&proto_dir, &mut proto_files);

    if proto_files.is_empty() {
        eprintln!("No proto files found in {:?}", proto_dir);
        return;
    }

    println!("Found proto files: {:?}", proto_files);

    // 配置 prost-build
    let mut config = prost_build::Config::new();

    // 启用 bytes 支持
    config.bytes(["."]);

    // 启用 wasm 支持（如果需要）
    #[cfg(target_arch = "wasm32")]
    config.enable_wasm_protobuf();

    // 编译 proto 文件
    config
        .compile_protos(&proto_files, &[&proto_dir])
        .expect("Failed to compile proto files");

    // 生成版本信息
    generate_version();
}

fn collect_proto_files(dir: &PathBuf, files: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map(|e| e == "proto").unwrap_or(false) {
                files.push(path);
            } else if path.is_dir() {
                collect_proto_files(&path, files);
            }
        }
    }
}

fn generate_version() {
    // 使用 vergen 生成版本信息
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/index");

    // 手动生成版本信息（不使用 vergen）
    let git_sha = std::process::Command::new("git")
        .args(&["rev-parse", "HEAD"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_else(|| "unknown".to_string());

    let git_describe = std::process::Command::new("git")
        .args(&["describe", "--tags", "--always"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=GIT_SHA={}", git_sha.trim());
    println!("cargo:rustc-env=GIT_DESCRIBE={}", git_describe.trim());
}
```

---

## Phase 1：基础框架（P0）

### 1.6 项目脚手架

#### 1.6.1 main.rs 完整实现（约 80 行）

```rust
// crates/agent-client/src/main.rs

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio::signal;

use nuwax_agent::{App, AppConfig};
use nuwax_agent::core::logger::Logger;
use nuwax_agent::core::config::ConfigManager;

const APP_NAME: &str = "nuwax-agent";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> anyhow::Result<()> {
    // 1. 初始化日志系统
    Logger::init(APP_NAME, VERSION)?;

    tracing::info!("Starting {} v{}", APP_NAME, VERSION);
    tracing::info!("Platform: {}", std::env::consts::OS);
    tracing::info!("Architecture: {}", std::env::consts::ARCH);

    // 2. 加载配置
    let config_manager = Arc::new(ConfigManager::load().await?);
    tracing::info!("Configuration loaded");

    // 3. 应用配置到日志
    if let Some(log_config) = &config_manager.config.logging {
        Logger::configure_level(log_config.level);
    }

    // 4. 创建应用状态
    let (shutdown_tx, shutdown_rx) = mpsc::channel(1);
    let app_state = Arc::new(RwLock::new(App::new(config_manager.clone()).await?));

    // 5. 启动状态同步任务
    let app_state_clone = app_state.clone();
    tokio::spawn(async move {
        sync_app_state(app_state_clone, shutdown_rx).await;
    });

    // 6. 处理信号
    let shutdown_tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        handle_signals(shutdown_tx_clone).await;
    });

    // 7. 运行应用主循环
    let mut app = App::new(config_manager).await?;
    app.run().await?;

    // 8. 清理
    shutdown_tx.send(()).await.ok();
    tracing::info!("Application shutdown complete");

    Ok(())
}

/// 同步应用状态
async fn sync_app_state(app_state: Arc<RwLock<App>>, mut shutdown_rx: mpsc::Receiver<()>) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));

    loop {
        tokio::select! {
            _ = interval.tick() => {
                // 定期同步状态
                let mut state = app_state.write().await;
                state.sync_connection_state().await;
            }
            _ = shutdown_rx.recv() => {
                tracing::debug!("State sync task received shutdown signal");
                break;
            }
        }
    }
}

/// 处理系统信号
async fn handle_signals(mut shutdown_tx: mpsc::Sender<()>) {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::UnixSignalKind::terminate())
            .expect("Failed to install terminate handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            tracing::info!("Received Ctrl+C, initiating shutdown...");
        }
        _ = terminate => {
            tracing::info!("Received terminate signal, initiating shutdown...");
        }
    }

    // 发送关闭信号
    shutdown_tx.send(()).await.ok();
}
```

#### 1.6.2 lib.rs 完整实现（约 100 行）

```rust
// crates/agent-client/src/lib.rs

// 公开所有公共 API
pub use app::App;
pub use core::config::AppConfig;
pub use core::connection::ConnectionManager;
pub use core::agent::AgentManager;
pub use core::dependency::DependencyManager;

// Re-exports
pub use gpui;
pub use gpui_component;

// 内部模块
mod app;
mod components;
mod core;
mod message;
mod tray;
mod utils;

// 库入口
#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[tokio::test]
    async fn test_config_load() {
        // 测试配置加载
    }

    #[rstest]
    #[case("test_value")]
    fn test_config_value(#[case] value: &str) {
        // 参数化测试
    }
}
```

### 1.7 应用状态管理

#### 1.7.1 app.rs 完整实现（约 150 行）

```rust
// crates/agent-client/src/app.rs

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock, broadcast};
use dashmap::DashMap;

use crate::core::config::{AppConfig, ConfigManager};
use crate::core::connection::ConnectionManager;
use crate::core::agent::AgentManager;
use crate::core::dependency::DependencyManager;
use crate::components::{Root, ActiveTab, ConnectionState, AgentState};
use crate::utils::Notification;

/// 应用状态
pub struct App {
    /// 配置管理器
    pub config: Arc<ConfigManager>,

    /// 连接管理器
    pub connection: Arc<RwLock<ConnectionManager>>,

    /// Agent 管理器
    pub agent: Arc<RwLock<AgentManager>>,

    /// 依赖管理器
    pub dependency: Arc<RwLock<DependencyManager>>,

    /// UI 状态
    pub ui_state: AppUiState,

    /// 通知通道
    pub notifications: broadcast::Sender<Notification>,

    /// 活跃任务映射
    pub active_tasks: DashMap<String, TaskInfo>,
}

pub struct AppUiState {
    /// 当前激活的 Tab
    pub active_tab: ActiveTab,

    /// 设置子页面
    pub settings_subtab: SettingsSubTab,

    /// 状态栏状态
    pub status_bar: StatusBarState,

    /// 模态框状态
    pub modal: Option<ModalState>,
}

pub struct StatusBarState {
    pub connection: ConnectionState,
    pub agent: AgentState,
    pub dependency_ok: bool,
    pub current_time: String,
}

pub enum ModalState {
    PasswordChange(PasswordChangeModal),
    FileTransfer(FileTransferModal),
    Notification(String),
}

pub struct TaskInfo {
    pub task_id: String,
    pub session_id: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

impl App {
    /// 创建新应用实例
    pub async fn new(config: Arc<ConfigManager>) -> Result<Self, anyhow::Error> {
        let notifications = broadcast::channel(100).0;

        Ok(Self {
            config: config.clone(),
            connection: Arc::new(RwLock::new(ConnectionManager::new())),
            agent: Arc::new(RwLock::new(AgentManager::new())),
            dependency: Arc::new(RwLock::new(DependencyManager::new(config))),
            ui_state: AppUiState {
                active_tab: ActiveTab::ClientInfo,
                settings_subtab: SettingsSubTab::Server,
                status_bar: StatusBarState {
                    connection: ConnectionState::Disconnected,
                    agent: AgentState::Idle,
                    dependency_ok: false,
                    current_time: String::new(),
                },
                modal: None,
            },
            notifications,
            active_tasks: DashMap::new(),
        })
    }

    /// 运行应用主循环
    pub async fn run(&mut self) -> Result<(), anyhow::Error> {
        tracing::info!("Application starting...");

        // 初始化连接
        self.initialize_connection().await?;

        // 创建 UI
        let window = self.create_window().await?;

        // 运行窗口事件循环
        window.run().await;

        Ok(())
    }

    /// 初始化连接
    async fn initialize_connection(&mut self) -> Result<(), anyhow::Error> {
        let config = self.config.config.read().await;

        if let Some(server) = &config.server {
            let mut connection = self.connection.write().await;
            connection.connect(&server.hbbs_addr, &server.hbbr_addr).await?;
        }

        Ok(())
    }

    /// 创建窗口
    async fn create_window(&mut self) -> Result<gpui::Window, anyhow::Error> {
        let bounds = gpui::Bounds::centered(
            gpui::Size::new(1024.0, 768.0),
            None,
        );

        let window = gpui::WindowBuilder::new()
            .bounds(bounds)
            .title("nuwax-agent")
            .window_id("main".into())
            .resizable(true)
            .min_size(gpui::Size::new(800.0, 600.0))
            .app_id("nuwax-agent")
            .decorations(true)
            .transparent(false)
            .build()?;

        // 初始化根组件
        let root = Root::new();
        window.set_root(root);

        Ok(window)
    }

    /// 切换 Tab
    pub fn switch_tab(&mut self, tab: ActiveTab) {
        self.ui_state.active_tab = tab;
    }

    /// 切换设置子页面
    pub fn switch_settings_subtab(&mut self, subtab: SettingsSubTab) {
        self.ui_state.settings_subtab = subtab;
    }

    /// 显示通知
    pub fn show_notification(&mut self, notification: Notification) {
        let _ = self.notifications.send(notification);
    }
}

// 辅助类型
pub enum SettingsSubTab {
    Server,
    Security,
    General,
    Appearance,
    Logging,
}
```

### 1.8 UI 组件实现

#### 1.8.1 Root 组件完整实现（约 200 行）

```rust
// crates/agent-client/src/components/root.rs

use gpui::{div, Component, Context, Element, IntoElement, Render, div};
use gpui::prelude::*;
use gpui_component::{TabPanel, TabItem, Button, IconButton, IconName};

use crate::components::{
    StatusBar, ConnectionState, AgentState,
    ClientInfo, Settings, DependencyManager,
    Permissions, About, RemoteDesktop, Chat,
};
use crate::app::{App, ActiveTab, SettingsSubTab};

/// 根组件 - 主布局容器
pub struct Root {
    /// 当前激活的 Tab
    active_tab: ActiveTab,

    /// 当前激活的设置子页面
    settings_subtab: SettingsSubTab,

    /// 连接状态
    connection_state: ConnectionState,

    /// Agent 状态
    agent_state: AgentState,

    /// 依赖状态
    dependency_ok: bool,

    /// 是否显示模态框
    show_modal: bool,
}

impl Root {
    /// 创建新根组件
    pub fn new(cx: &mut Context) -> Self {
        Self {
            active_tab: ActiveTab::ClientInfo,
            settings_subtab: SettingsSubTab::Server,
            connection_state: ConnectionState::Disconnected,
            agent_state: AgentState::Idle,
            dependency_ok: true,
            show_modal: false,
        }
    }

    /// 设置连接状态
    pub fn set_connection_state(&mut self, state: ConnectionState, cx: &mut Context) {
        self.connection_state = state;
        cx.notify();
    }

    /// 设置 Agent 状态
    pub fn set_agent_state(&mut self, state: AgentState, cx: &mut Context) {
        self.agent_state = state;
        cx.notify();
    }

    /// 设置依赖状态
    pub fn set_dependency_ok(&mut self, ok: bool, cx: &mut Context) {
        self.dependency_ok = ok;
        cx.notify();
    }

    /// 切换 Tab
    pub fn switch_tab(&mut self, tab: ActiveTab, cx: &mut Context) {
        self.active_tab = tab;
        cx.notify();
    }

    /// 切换设置子页面
    pub fn switch_settings_subtab(&mut self, subtab: SettingsSubTab, cx: &mut Context) {
        self.settings_subtab = subtab;
        cx.notify();
    }
}

impl Component for Root {
    fn render(&mut self, cx: &mut gpui::Context) -> impl IntoElement {
        div()
            .id("root")
            .size_full()
            .bg(cx.theme().background)
            .flex()
            .col()
            .children(self.render_header(cx))
            .children(self.render_tabs(cx))
            .children(self.render_content(cx))
            .children(self.render_status_bar(cx))
    }
}

impl Root {
    /// 渲染顶部标题栏
    fn render_header(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .id("header")
            .h(px(48.0))
            .bg(cx.theme().surface)
            .border_b_1()
            .border_color(cx.theme().border)
            .px_4()
            .flex()
            .items_center()
            .justify_between()
            // 左侧：应用图标和标题
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .w(px(32.0))
                            .h(px(32.0))
                            .bg_blue_500()
                            .rounded_md()
                    )
                    .child(
                        div()
                            .text_lg()
                            .font_bold()
                            .text_color(cx.theme().text)
                            .child("nuwax-agent")
                    )
            )
            // 右侧：设置按钮
            .child(
                IconButton::new("settings-btn", IconName::Settings)
                    .tooltip("设置")
                    .on_click(|_, cx| {
                        // TODO: 打开设置
                    })
            )
    }

    /// 渲染 Tab 面板
    fn render_tabs(&mut self, cx: &mut Context) -> impl IntoElement {
        let tabs = vec![
            TabItem::new("客户端信息", ActiveTab::ClientInfo),
            TabItem::new("依赖管理", ActiveTab::Dependencies),
            TabItem::new("权限设置", ActiveTab::Permissions),
            #[cfg(feature = "remote-desktop")]
            TabItem::new("远程桌面", ActiveTab::RemoteDesktop),
            #[cfg(feature = "chat-ui")]
            TabItem::new("Agent 聊天", ActiveTab::Chat),
            TabItem::new("关于", ActiveTab::About),
        ]
        .into_iter()
        .filter(|tab| {
            // 根据 feature 过滤 Tab
            #[cfg(not(feature = "chat-ui"))]
            if tab.id == ActiveTab::Chat {
                return false;
            }
            true
        })
        .collect();

        TabPanel::new()
            .id("main-tabs")
            .tabs(tabs)
            .active_tab(self.active_tab)
            .height(px(40.0))
            .on_change(|new_tab, cx| {
                if let Some(tab) = new_tab.downcast_ref::<ActiveTab>() {
                    // 处理 Tab 切换
                }
            })
    }

    /// 渲染主内容区域
    fn render_content(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .id("content")
            .flex_1()
            .overflow_hidden()
            .child(match self.active_tab {
                ActiveTab::ClientInfo => ClientInfo::render(cx),
                ActiveTab::Settings => Settings::render(self.settings_subtab, cx),
                ActiveTab::Dependencies => DependencyManager::render(cx),
                ActiveTab::Permissions => Permissions::render(cx),
                ActiveTab::About => About::render(cx),
                #[cfg(feature = "remote-desktop")]
                ActiveTab::RemoteDesktop => RemoteDesktop::render(cx),
                #[cfg(feature = "chat-ui")]
                ActiveTab::Chat => Chat::render(cx),
            })
    }

    /// 渲染状态栏
    fn render_status_bar(&mut self, cx: &mut Context) -> impl IntoElement {
        StatusBar::new()
            .height(px(32.0))
            .connection_state(self.connection_state)
            .agent_state(self.agent_state)
            .dependency_ok(self.dependency_ok)
    }
}
```

#### 1.8.2 StatusBar 组件完整实现（约 150 行）

```rust
// crates/agent-client/src/components/status_bar.rs

use gpui::{div, Component, Context, Element, IntoElement, Render};
use gpui::prelude::*;
use gpui_component::{StatusBar, StatusItem, Icon, IconName, Badge};

use crate::components::ConnectionState;
use crate::app::AgentState;

/// 状态栏组件
pub struct StatusBarComponent {
    /// 连接状态
    connection_state: ConnectionState,

    /// Agent 状态
    agent_state: AgentState,

    /// 依赖是否正常
    dependency_ok: bool,

    /// 当前时间
    current_time: String,
}

impl StatusBarComponent {
    pub fn new() -> Self {
        Self {
            connection_state: ConnectionState::Disconnected,
            agent_state: AgentState::Idle,
            dependency_ok: true,
            current_time: String::new(),
        }
    }

    pub fn set_connection_state(&mut self, state: ConnectionState) {
        self.connection_state = state;
    }

    pub fn set_agent_state(&mut self, state: AgentState) {
        self.agent_state = state;
    }

    pub fn set_dependency_ok(&mut self, ok: bool) {
        self.dependency_ok = ok;
    }

    pub fn set_time(&mut self, time: String) {
        self.current_time = time;
    }
}

impl Component for StatusBarComponent {
    fn render(&mut self, cx: &mut gpui::Context) -> impl IntoElement {
        StatusBar::new()
            .height(px(32.0))
            .items(vec![
                // 左侧：连接状态
                StatusItem::new()
                    .content(self.render_connection_status(cx))
                    .min_width(px(200.0)),
                // 中左：Agent 状态
                StatusItem::new()
                    .content(self.render_agent_status(cx))
                    .flex_grow(1.0)
                    .justify_center(),
                // 中右：依赖状态
                StatusItem::new()
                    .content(self.render_dependency_status(cx))
                    .min_width(px(120.0)),
                // 右侧：时间
                StatusItem::new()
                    .content(self.render_time(cx))
                    .min_width(px(100.0))
                    .justify_end(),
            ])
    }
}

impl StatusBarComponent {
    /// 渲染连接状态
    fn render_connection_status(&mut self, cx: &mut Context) -> impl IntoElement {
        let (icon, color, text, latency) = match self.connection_state {
            ConnectionState::Connected(mode, latency_ms) => {
                let (icon, color, mode_text) = match mode {
                    ConnectionMode::P2P => ("●", "#22c55e", "P2P"),
                    ConnectionMode::Relay => ("◑", "#eab308", "Relay"),
                };
                (icon, color, format!("已连接 ({})", mode_text), Some(latency_ms))
            }
            ConnectionState::Connecting => ("●", "#3b82f6", "连接中...", None),
            ConnectionState::Disconnected => ("●", "#ef4444", "未连接", None),
            ConnectionState::Error(ref msg) => ("⚠️", "#ef4444", format!("错误: {}", msg), None),
        };

        div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_color(color)
                    .child(icon)
            )
            .child(
                div()
                    .text_color(color)
                    .child(text)
            )
            .child(if let Some(latency) = latency {
                div()
                    .text_sm()
                    .text_gray()
                    .child(format!("- {}ms", latency))
            } else {
                div()
            })
    }

    /// 渲染 Agent 状态
    fn render_agent_status(&mut self, cx: &mut Context) -> impl IntoElement {
        let (icon, color, text) = match self.agent_state {
            AgentState::Idle => ("✓", "#6b7280", "Agent: 空闲"),
            AgentState::Active(count) => ("⟳", "#3b82f6", format!("Agent: {} 运行中", count)),
            AgentState::Executing(current, total) => {
                ("⟳", "#3b82f6", format!("Agent: 执行中 ({}/{})", current, total))
            }
            AgentState::Error => ("✗", "#ef4444", "Agent: 错误"),
        };

        div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_color(color)
                    .child(icon)
            )
            .child(text)
    }

    /// 渲染依赖状态
    fn render_dependency_status(&mut self, cx: &mut Context) -> impl IntoElement {
        let (icon, color, text) = if self.dependency_ok {
            ("✓", "#22c55e", "依赖正常")
        } else {
            ("⚠️", "#ef4444", "依赖异常")
        };

        div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_color(color)
                    .child(icon)
            )
            .child(text)
    }

    /// 渲染时间
    fn render_time(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .text_sm()
            .text_gray()
            .child(&self.current_time)
    }
}

/// 连接模式
pub enum ConnectionMode {
    P2P,
    Relay,
}
```

### 1.9 系统托盘

#### 1.9.1 TrayManager 完整实现（约 200 行）

```rust
// crates/agent-client/src/tray/mod.rs

use std::sync::Arc;
use std::path::PathBuf;
use std::fmt::Debug;
use tokio::sync::{mpsc, RwLock, broadcast};
use tracing::error;

use tray_icon::{TrayIconBuilder, icon::Icon, TrayIconEvent};
use muda::{Menu, MenuItem, ContextMenu, IconMenuItem, SeparatorMenuItem, AboutItem};

use crate::utils::Notification;
use crate::components::ConnectionState;
use crate::app::AgentState;

/// 托盘图标路径配置
#[cfg(target_os = "macos")]
const TRAY_ICON: &[u8] = include_bytes!("../assets/icons/tray_macos.png");

#[cfg(target_os = "windows")]
const TRAY_ICON: &[u8] = include_bytes!("../assets/icons/tray_windows.ico");

#[cfg(target_os = "linux")]
const TRAY_ICON: &[u8] = include_bytes!("../assets/icons/tray_linux.png");

/// 托盘管理器
pub struct TrayManager {
    /// 托盘图标实例
    tray_icon: Option<tray_icon::TrayIcon>,

    /// 托盘菜单
    menu: ContextMenu,

    /// 通知发送器
    notification_tx: broadcast::Sender<Notification>,

    /// 连接状态
    connection_state: Arc<RwLock<ConnectionState>>,

    /// Agent 状态
    agent_state: Arc<RwLock<AgentState>>,
}

impl TrayManager {
    /// 创建新的托盘管理器
    pub fn new(
        notification_tx: broadcast::Sender<Notification>,
        connection_state: Arc<RwLock<ConnectionState>>,
        agent_state: Arc<RwLock<AgentState>>,
    ) -> Self {
        let icon = Self::load_icon();
        let menu = Self::create_menu(&notification_tx);

        let tray_icon = TrayIconBuilder::new()
            .with_icon(icon)
            .with_tooltip("nuwax-agent")
            .with_menu(Box::new(menu.clone()))
            .with_menu_on_left_click(true)
            .build()
            .ok();

        Self {
            tray_icon,
            menu,
            notification_tx,
            connection_state,
            agent_state,
        }
    }

    /// 加载托盘图标
    fn load_icon() -> Icon {
        Icon::from_rgba(TRAY_ICON.to_vec(), 32, 32)
            .unwrap_or_else(|e| {
                error!("Failed to load tray icon: {:?}", e);
                // 返回一个默认的空白图标
                Icon::from_rgba(vec![0; 32 * 32 * 4], 32, 32).unwrap()
            })
    }

    /// 创建托盘菜单
    fn create_menu(notification_tx: &broadcast::Sender<Notification>) -> ContextMenu {
        ContextMenu::new()
            // 显示窗口
            .add_item(&MenuItem::with_id(
                "show",
                "显示窗口",
                true,
                None,
            ).unwrap())
            .add_separator()
            // 状态信息（动态更新）
            .add_item(&IconMenuItem::with_id(
                "status",
                "状态: 已连接",
                true,
                None,
                None,
            ).unwrap())
            .add_separator()
            // 功能菜单
            .add_item(&MenuItem::with_id(
                "settings",
                "设置...",
                true,
                None,
            ).unwrap())
            .add_item(&MenuItem::with_id(
                "dependencies",
                "依赖管理",
                true,
                None,
            ).unwrap())
            .add_item(&MenuItem::with_id(
                "permissions",
                "权限设置",
                true,
                None,
            ).unwrap())
            .add_separator()
            // 关于和退出
            .add_item(&MenuItem::with_id(
                "about",
                "关于",
                true,
                None,
            ).unwrap())
            .add_separator()
            .add_item(&MenuItem::with_id(
                "quit",
                "退出",
                true,
                None,
            ).unwrap())
    }

    /// 处理托盘事件
    pub fn handle_event(&self, event: TrayIconEvent) {
        match event {
            TrayIconEvent::Click { button, id: _ } => {
                match button {
                    tray_icon::ClickButton::Left => {
                        self.show_window();
                    }
                    tray_icon::ClickButton::Right => {
                        // 右键点击，显示菜单
                    }
                    _ => {}
                }
            }
            TrayIconEvent::MenuEvent { id } => {
                self.handle_menu_event(id.as_str());
            }
            _ => {}
        }
    }

    /// 处理菜单事件
    fn handle_menu_event(&self, id: &str) {
        match id {
            "show" => {
                self.show_window();
            }
            "settings" => {
                self.open_settings();
            }
            "dependencies" => {
                self.open_dependencies();
            }
            "permissions" => {
                self.open_permissions();
            }
            "about" => {
                self.open_about();
            }
            "quit" => {
                self.quit();
            }
            _ => {
                error!("Unknown tray menu event: {}", id);
            }
        }
    }

    fn show_window(&self) {
        // TODO: 显示主窗口
        let _ = self.notification_tx.send(Notification::info("显示窗口"));
    }

    fn open_settings(&self) {
        let _ = self.notification_tx.send(Notification::info("打开设置"));
    }

    fn open_dependencies(&self) {
        let _ = self.notification_tx.send(Notification::info("打开依赖管理"));
    }

    fn open_permissions(&self) {
        let _ = self.notification_tx.send(Notification::info("打开权限设置"));
    }

    fn open_about(&self) {
        let _ = self.notification_tx.send(Notification::info("打开关于"));
    }

    fn quit(&self) {
        let _ = self.notification_tx.send(Notification::info("退出应用"));
        // TODO: 发送退出信号
    }

    /// 更新状态显示
    pub async fn update_status(&self) {
        let connection = self.connection_state.read().await;
        let agent = self.agent_state.read().await;

        let status_text = match *connection {
            ConnectionState::Connected(_, latency) => {
                format!("已连接 (延迟: {}ms)", latency)
            }
            ConnectionState::Connecting => "连接中...".to_string(),
            ConnectionState::Disconnected => "未连接".to_string(),
            ConnectionState::Error(ref msg) => format!("错误: {}", msg),
        };

        // 更新菜单项
        // TODO: 使用 muda 的 API 更新动态菜单项
    }
}
```

### 1.10 开机自启动

#### 1.10.1 AutoLaunchManager 完整实现（约 150 行）

```rust
// crates/agent-client/src/core/platform/auto_launch.rs

use std::path::PathBuf;
use std::fmt;
use auto_launch::{AutoLaunch, AutoLaunchBuilder, MacOSLaunchMode};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AutoLaunchError {
    #[error("Failed to get app path: {0}")]
    GetPathError(String),

    #[error("AutoLaunch not supported on this platform")]
    NotSupported,

    #[error("Failed to enable auto-launch: {0}")]
    EnableError(String),

    #[error("Failed to check auto-launch status: {0}")]
    CheckError(String),
}

pub struct AutoLaunchManager {
    auto_launch: Option<AutoLaunch>,
    app_name: String,
    app_path: PathBuf,
}

impl AutoLaunchManager {
    /// 创建新的自启动管理器
    pub fn new() -> Result<Self, AutoLaunchError> {
        let app_name = "nuwax-agent".to_string();
        let app_path = Self::get_app_path()?;

        let auto_launch = Self::build_auto_launch(&app_name, &app_path)?;

        Ok(Self {
            auto_launch,
            app_name,
            app_path,
        })
    }

    /// 获取应用路径（跨平台）
    fn get_app_path() -> Result<PathBuf, AutoLaunchError> {
        #[cfg(target_os = "macos")]
        {
            // macOS: /Applications/nuwax-agent.app
            Ok(PathBuf::from("/Applications/nuwax-agent.app"))
        }

        #[cfg(target_os = "windows")]
        {
            // Windows: 当前可执行文件路径
            std::env::current_exe()
                .map_err(|e| AutoLaunchError::GetPathError(e.to_string()))
        }

        #[cfg(target_os = "linux")]
        {
            // Linux: 当前可执行文件路径
            std::env::current_exe()
                .map_err(|e| AutoLaunchError::GetPathError(e.to_string()))
        }
    }

    /// 构建 AutoLaunch 实例
    fn build_auto_launch(app_name: &str, app_path: &PathBuf) -> Result<Option<AutoLaunch>, AutoLaunchError> {
        #[cfg(target_os = "macos")]
        {
            let auto = AutoLaunchBuilder::new()
                .set_app_name(app_name)
                .set_app_path(app_path.to_str().ok_or_else(|| {
                    AutoLaunchError::GetPathError("Invalid path".to_string())
                })?)
                .set_macos_launch_mode(MacOSLaunchMode::SMAppService)
                .build()
                .map_err(|e| AutoLaunchError::EnableError(e.to_string()))?;

            Ok(Some(auto))
        }

        #[cfg(target_os = "windows")]
        {
            let auto = AutoLaunchBuilder::new()
                .set_app_name(app_name)
                .set_app_path(app_path.to_str().ok_or_else(|| {
                    AutoLaunchError::GetPathError("Invalid path".to_string())
                })?)
                .build()
                .map_err(|e| AutoLaunchError::EnableError(e.to_string()))?;

            Ok(Some(auto))
        }

        #[cfg(target_os = "linux")]
        {
            let auto = AutoLaunchBuilder::new()
                .set_app_name(app_name)
                .set_app_path(app_path.to_str().ok_or_else(|| {
                    AutoLaunchError::GetPathError("Invalid path".to_string())
                })?)
                .set_app_arguments(&["--hidden"])
                .build()
                .map_err(|e| AutoLaunchError::EnableError(e.to_string()))?;

            Ok(Some(auto))
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err(AutoLaunchError::NotSupported)
        }
    }

    /// 检查是否已启用
    pub async fn is_enabled(&self) -> Result<bool, AutoLaunchError> {
        match &self.auto_launch {
            Some(auto) => {
                auto.is_enabled()
                    .await
                    .map_err(|e| AutoLaunchError::CheckError(e.to_string()))
            }
            None => Ok(false),
        }
    }

    /// 启用自启动
    pub async fn enable(&self) -> Result<(), AutoLaunchError> {
        match &self.auto_launch {
            Some(auto) => {
                auto.enable()
                    .await
                    .map_err(|e| AutoLaunchError::EnableError(e.to_string()))?;
                Ok(())
            }
            None => Err(AutoLaunchError::NotSupported),
        }
    }

    /// 禁用自启动
    pub async fn disable(&self) -> Result<(), AutoLaunchError> {
        match &self.auto_launch {
            Some(auto) => {
                auto.disable()
                    .await
                    .map_err(|e| AutoLaunchError::EnableError(e.to_string()))?;
                Ok(())
            }
            None => Err(AutoLaunchError::NotSupported),
        }
    }

    /// 切换自启动状态
    pub async fn toggle(&self) -> Result<bool, AutoLaunchError> {
        let is_enabled = self.is_enabled().await?;

        if is_enabled {
            self.disable().await?;
            Ok(false)
        } else {
            self.enable().await?;
            Ok(true)
        }
    }
}
```

---

## Phase 2：核心功能（P0）

### 2.1 nuwax-rustdesk 集成

#### 2.1.1 ConnectionManager 完整实现（约 300 行）

```rust
// crates/agent-client/src/core/connection.rs

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, RwLock, broadcast};
use dashmap::DashMap;
use tracing::{info, warn, error, debug};

use librustdesk::{RendezvousMediator, ConnectionType};
use crate::utils::Notification;

/// 连接管理器
pub struct ConnectionManager {
    /// RendezvousMediator 实例
    mediator: Option<Arc<RendezvousMediator>>,

    /// 当前连接状态
    state: RwLock<ConnectionState>,

    /// 连接事件广播
    event_tx: broadcast::Sender<ConnectionEvent>,

    /// 心跳定时器
    heartbeat_interval: Duration,

    /// 重连配置
    reconnect_config: ReconnectConfig,

    /// 统计信息
    stats: ConnectionStats,
}

#[derive(Clone)]
pub struct ConnectionState {
    pub status: ConnectionStatus,
    pub mode: Option<ConnectionMode>,
    pub latency_ms: u64,
    pub last_error: Option<String>,
    pub connected_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ConnectionMode {
    P2P,
    Relay,
}

pub struct ReconnectConfig {
    /// 最大重试次数
    pub max_retries: u32,

    /// 重试间隔（秒）
    pub retry_interval: u64,

    /// 指数退避因子
    pub backoff_factor: f64,

    /// 最大重试间隔（秒）
    pub max_backoff: u64,
}

pub struct ConnectionStats {
    /// 总连接次数
    pub total_connections: u64,

    /// P2P 连接成功次数
    pub p2p_successes: u64,

    /// Relay 连接成功次数
    pub relay_successes: u64,

    /// 断开连接次数
    pub disconnections: u64,

    /// 平均延迟（毫秒）
    pub avg_latency_ms: f64,

    /// 最后活动时间
    pub last_activity: Option<Instant>,
}

#[derive(Clone, Debug)]
pub enum ConnectionEvent {
    Connected(ConnectionMode, u64),
    Disconnected,
    LatencyUpdated(u64),
    Error(String),
    StateChanged(ConnectionStatus),
}

impl Default for ConnectionState {
    fn default() -> Self {
        Self {
            status: ConnectionStatus::Disconnected,
            mode: None,
            latency_ms: 0,
            last_error: None,
            connected_at: None,
        }
    }
}

impl Default for ReconnectConfig {
    fn default() -> Self {
        Self {
            max_retries: 10,
            retry_interval: 5,
            backoff_factor: 2.0,
            max_backoff: 300,
        }
    }
}

impl ConnectionManager {
    /// 创建新的连接管理器
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(100);

        Self {
            mediator: None,
            state: RwLock::new(ConnectionState::default()),
            event_tx,
            heartbeat_interval: Duration::from_secs(30),
            reconnect_config: ReconnectConfig::default(),
            stats: ConnectionStats {
                total_connections: 0,
                p2p_successes: 0,
                relay_successes: 0,
                disconnections: 0,
                avg_latency_ms: 0.0,
                last_activity: None,
            },
        }
    }

    /// 连接到服务器
    pub async fn connect(
        &mut self,
        hbbs_addr: &str,
        hbbr_addr: &str,
    ) -> Result<(), ConnectionError> {
        info!("Connecting to hbbs: {}, hbbr: {}", hbbs_addr, hbbr_addr);

        // 更新状态为连接中
        self.set_status(ConnectionStatus::Connecting).await;
        self.state.write().await.last_error = None;

        // 创建 RendezvousMediator
        let mediator = Arc::new(RendezvousMediator::new());

        // 配置服务器地址
        mediator.set_id_server(hbbs_addr);
        mediator.set_relay_server(hbbr_addr);

        // 登录
        let login_result = mediator.login().await
            .map_err(|e| ConnectionError::LoginFailed(e.to_string()))?;

        // 处理连接结果
        let (mode, latency) = match login_result.conn_type {
            ConnectionType::P2P => {
                self.stats.p2p_successes += 1;
                (ConnectionMode::P2P, login_result.latency)
            }
            ConnectionType::Relay => {
                self.stats.relay_successes += 1;
                (ConnectionMode::Relay, login_result.latency)
            }
            _ => {
                return Err(ConnectionError::UnknownConnectionType);
            }
        };

        // 更新状态
        self.state.write().await.mode = Some(mode);
        self.state.write().await.latency_ms = latency;
        self.state.write().await.connected_at = Some(chrono::Utc::now());
        self.set_status(ConnectionStatus::Connected).await;

        // 保存 mediator
        self.mediator = Some(mediator.clone());

        // 更新统计
        self.stats.total_connections += 1;
        self.stats.last_activity = Some(Instant::now());

        // 发送连接事件
        let _ = self.event_tx.send(ConnectionEvent::Connected(mode, latency));

        // 启动心跳和状态监听
        self.start_heartbeat(mediator.clone()).await;
        self.start_connection_monitor(mediator.clone()).await;

        info!("Connected successfully, mode: {:?}, latency: {}ms", mode, latency);

        Ok(())
    }

    /// 断开连接
    pub async fn disconnect(&mut self) {
        if let Some(mediator) = &self.mediator {
            mediator.logout().await.ok();
        }

        self.mediator = None;
        self.set_status(ConnectionStatus::Disconnected).await;
        self.stats.disconnections += 1;

        info!("Disconnected from server");
    }

    /// 设置连接状态
    async fn set_status(&self, status: ConnectionStatus) {
        self.state.write().await.status = status.clone();
        let _ = self.event_tx.send(ConnectionEvent::StateChanged(status));
    }

    /// 启动心跳
    async fn start_heartbeat(&self, mediator: Arc<RendezvousMediator>) {
        let event_tx = self.event_tx.clone();
        let mut interval = tokio::time::interval(self.heartbeat_interval);

        tokio::spawn(async move {
            loop {
                interval.tick().await;

                // 发送心跳
                match mediator.send_ping().await {
                    Ok(latency) => {
                        let _ = event_tx.send(ConnectionEvent::LatencyUpdated(latency));
                    }
                    Err(e) => {
                        error!("Heartbeat failed: {:?}", e);
                        let _ = event_tx.send(ConnectionEvent::Error(format!("Heartbeat failed: {}", e)));
                    }
                }
            }
        });
    }

    /// 启动连接监控
    async fn start_connection_monitor(&self, mediator: Arc<RendezvousMediator>) {
        let event_tx = self.event_tx.clone();

        tokio::spawn(async move {
            while let Ok(state) = mediator.on_connection_state_changed().await {
                match state {
                    ConnectionType::P2P | ConnectionType::Relay => {
                        let _ = event_tx.send(ConnectionEvent::Connected(state.into(), 0));
                    }
                    _ => {
                        let _ = event_tx.send(ConnectionEvent::Disconnected);
                    }
                }
            }
        });
    }

    /// 获取当前状态
    pub async fn state(&self) -> ConnectionState {
        self.state.read().await.clone()
    }

    /// 获取事件接收器
    pub fn subscribe(&self) -> broadcast::Receiver<ConnectionEvent> {
        self.event_tx.subscribe()
    }

    /// 获取 Stream
    pub fn get_stream(&self) -> Option<Arc<dyn librustdesk::Stream + Send + Sync>> {
        self.mediator.as_ref()?.get_stream()
    }

    /// 获取统计数据
    pub fn stats(&self) -> &ConnectionStats {
        &self.stats
    }
}

#[derive(Error, Debug)]
pub enum ConnectionError {
    #[error("Login failed: {0}")]
    LoginFailed(String),

    #[error("Unknown connection type")]
    UnknownConnectionType,

    #[error("Not connected")]
    NotConnected,

    #[error("Connection timeout")]
    Timeout,

    #[error("Connection refused")]
    Refused,
}
```

### 2.2 业务数据通道

#### 2.2.1 BusinessChannel 完整实现（200 行）

```rust
// crates/agent-client/src/core/business_channel.rs

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock, broadcast};
use dashmap::DashMap;
use tracing::{info, warn, error, debug};

use librustdesk::{Stream, BusinessChannel, BusinessChannelConfig, BUSINESS_CHANNEL_ID};
use crate::message::proto::{BusinessEnvelope, BusinessMessageType};

/// 业务通道管理器
pub struct BusinessChannelManager {
    /// 业务通道实例
    channel: Option<BusinessChannel>,

    /// 配置
    config: BusinessChannelConfig,

    /// 消息发送器
    message_tx: broadcast::Sender<BusinessMessage>,

    /// 订阅者
    subscribers: Arc<DashMap<String, mpsc::UnboundedSender<BusinessMessage>>>,

    /// 是否已连接
    connected: RwLock<bool>,
}

#[derive(Clone, Debug)]
pub struct BusinessMessage {
    pub message_type: BusinessMessageType,
    pub payload: Vec<u8>,
    pub timestamp: i64,
    pub source_id: Option<String>,
}

impl BusinessChannelManager {
    /// 创建新的业务通道管理器
    pub fn new() -> Self {
        let (message_tx, _) = broadcast::channel(100);

        Self {
            channel: None,
            config: BusinessChannelConfig::default(),
            message_tx,
            subscribers: Arc::new(DashMap::new()),
            connected: RwLock::new(false),
        }
    }

    /// 从 nuwax-rustdesk 的 Stream 创建业务通道
    pub async fn create_from_stream(
        &mut self,
        stream: Arc<dyn Stream + Send + Sync>,
    ) -> Result<(), BusinessChannelError> {
        info!("Creating business channel from stream");

        let channel = BusinessChannel::from_stream(
            stream,
            Some(self.config.clone()),
        ).await?;

        self.channel = Some(channel);
        *self.connected.write().await = true;

        // 启动消息处理循环
        self.start_message_handler().await;

        info!("Business channel created successfully");

        Ok(())
    }

    /// 发送 Agent 任务请求
    pub async fn send_agent_task(&self, task: &[u8]) -> Result<(), BusinessChannelError> {
        self.send_message(BusinessMessageType::AgentTask, task).await
    }

    /// 发送 Agent 取消请求
    pub async fn send_agent_cancel(&self, task_id: &str) -> Result<(), BusinessChannelError> {
        let payload = serde_json::json!({
            "task_id": task_id,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        self.send_message(
            BusinessMessageType::AgentCancel,
            serde_json::to_vec(&payload)?.as_slice(),
        ).await
    }

    /// 发送业务消息
    async fn send_message(
        &self,
        message_type: BusinessMessageType,
        payload: &[u8],
    ) -> Result<(), BusinessChannelError> {
        let channel = self.channel.as_ref()
            .ok_or(BusinessChannelError::NotConnected)?;

        channel.send(message_type, payload).await
            .map_err(|e| BusinessChannelError::SendFailed(e.to_string()))?;

        Ok(())
    }

    /// 启动消息处理循环
    async fn start_message_handler(&self) {
        let mut channel = self.channel.clone();
        let message_tx = self.message_tx.clone();

        tokio::spawn(async move {
            loop {
                let result = match &mut channel {
                    Some(ch) => ch.recv().await,
                    None => break,
                };

                match result {
                    Ok(Some((msg_type, payload))) => {
                        let message = BusinessMessage {
                            message_type: msg_type,
                            payload,
                            timestamp: chrono::Utc::now().timestamp_millis(),
                            source_id: None,
                        };

                        // 广播给所有订阅者
                        let _ = message_tx.send(message.clone());

                        // 发送给内部处理器
                        Self::handle_message(message).await;
                    }
                    Ok(None) => {
                        warn!("Business channel received empty message");
                    }
                    Err(e) => {
                        error!("Business channel error: {:?}", e);
                        break;
                    }
                }
            }
        });
    }

    /// 处理接收到的消息
    async fn handle_message(message: BusinessMessage) {
        debug!("Handling business message: {:?}", message.message_type);

        match message.message_type {
            BusinessMessageType::AgentTask => {
                // TODO任务并执行: 解析
            }
            BusinessMessageType::AgentResponse => {
                // TODO: 处理响应
            }
            BusinessMessageType::AgentProgress => {
                // TODO: 处理进度
            }
            BusinessMessageType::AgentCancel => {
                // TODO: 处理取消
            }
            _ => {
                warn!("Unknown message type: {:?}", message.message_type);
            }
        }
    }

    /// 订阅业务消息
    pub fn subscribe(&self, key: &str) -> broadcast::Receiver<BusinessMessage> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.subscribers.insert(key.to_string(), tx);
        self.message_tx.subscribe()
    }

    /// 取消订阅
    pub fn unsubscribe(&self, key: &str) {
        self.subscribers.remove(key);
    }

    /// 检查是否已连接
    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }
}

#[derive(Error, Debug)]
pub enum BusinessChannelError {
    #[error("Not connected")]
    NotConnected,

    #[error("Send failed: {0}")]
    SendFailed(String),

    #[error("Receive failed: {0}")]
    ReceiveFailed(String),

    #[error("Parse failed: {0}")]
    ParseFailed(String),
}
```

### 2.3 设置界面

#### 2.3.1 Settings 主组件完整实现（300 行）

```rust
// crates/agent-client/src/components/settings.rs

use std::sync::Arc;
use tokio::sync::RwLock;
use gpui::{div, Component, Context, Element, IntoElement, Render};
use gpui::prelude::*;
use gpui_component::{TabPanel, TabItem, Button, Input, IconButton, IconName};

use crate::core::config::{ServerConfig, SecurityConfig, AppConfig};
use crate::core::platform::AutoLaunchManager;
use crate::app::SettingsSubTab;

/// 设置组件
pub struct Settings {
    /// 当前子页面
    active_subtab: SettingsSubTab,

    /// 服务器配置
    server_config: ServerConfig,

    /// 安全配置
    security_config: SecurityConfig,

    /// 是否正在保存
    is_saving: bool,

    /// 保存结果
    save_result: Option<SaveResult>,

    /// 自动启动管理器
    auto_launch: Option<Arc<AutoLaunchManager>>,
}

pub struct SaveResult {
    success: bool,
    message: String,
}

impl Settings {
    pub fn new(cx: &mut Context) -> Self {
        let config = AppConfig::load().unwrap_or_default();
        let server_config = config.server.unwrap_or_default();
        let security_config = config.security.unwrap_or_default();

        Self {
            active_subtab: SettingsSubTab::Server,
            server_config,
            security_config,
            is_saving: false,
            save_result: None,
            auto_launch: None,
        }
    }
}

impl Component for Settings {
    fn render(&mut self, cx: &mut gpui::Context) -> impl IntoElement {
        div()
            .id("settings")
            .size_full()
            .p_4()
            .flex()
            .col()
            .gap_4()
            .child(self.render_header(cx))
            .child(self.render_content(cx))
    }
}

impl Settings {
    /// 渲染标题栏
    fn render_header(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .text_xl()
                    .font_bold()
                    .child("设置")
            )
            .child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        Button::new("save-btn", cx)
                            .label("保存")
                            .disabled(self.is_saving)
                            .on_click(|_, cx| {
                                self.save(cx);
                            })
                    )
                    .child(
                        Button::new("reset-btn", cx)
                            .label("恢复默认")
                            .variant(gpui_component::ButtonVariant::Ghost)
                            .on_click(|_, cx| {
                                self.reset_to_default(cx);
                            })
                    )
            )
    }

    /// 渲染子页面导航
    fn render_content(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .flex_1()
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .size_full()
                    .child(self.render_sidebar(cx))
                    .child(self.render_main(cx))
            )
    }

    /// 渲染侧边栏
    fn render_sidebar(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .w(px(200.0))
            .h_full()
            .bg(cx.theme().surface)
            .border_r_1()
            .border_color(cx.theme().border)
            .p_2()
            .flex()
            .col()
            .gap_1()
            .child(self.render_nav_item("服务器", SettingsSubTab::Server, cx))
            .child(self.render_nav_item("安全", SettingsSubTab::Security, cx))
            .child(self.render_nav_item("常规", SettingsSubTab::General, cx))
            .child(self.render_nav_item("外观", SettingsSubTab::Appearance, cx))
            .child(self.render_nav_item("日志", SettingsSubTab::Logging, cx))
    }

    /// 渲染导航项
    fn render_nav_item(
        &mut self,
        label: &'static str,
        tab: SettingsSubTab,
        cx: &mut Context,
    ) -> impl IntoElement {
        let is_active = self.active_subtab == tab;

        div()
            .p_2()
            .rounded-md()
            .bg(if is_active { cx.theme().primary } else { gpui::Transparent })
            .text_color(if is_active {
                cx.theme().on_primary
            } else {
                cx.theme().text
            })
            .cursor_pointer()
            .on_click(move |_, cx| {
                self.active_subtab = tab;
                cx.notify();
            })
            .child(label)
    }

    /// 渲染主内容区
    fn render_main(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .flex_1()
            .p_4()
            .overflow_auto()
            .child(match self.active_subtab {
                SettingsSubTab::Server => self.render_server_config(cx),
                SettingsSubTab::Security => self.render_security_config(cx),
                SettingsSubTab::General => self.render_general_config(cx),
                SettingsSubTab::Appearance => self.render_appearance_config(cx),
                SettingsSubTab::Logging => self.render_logging_config(cx),
            })
    }

    /// 渲染服务器配置
    fn render_server_config(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .flex()
            .col()
            .gap_4()
            .child(
                div()
                    .text_lg()
                    .font_bold()
                    .child("服务器配置")
            )
            .child(
                div()
                    .text_sm()
                    .text_gray()
                    .child("配置连接到 agent-server-admin 的服务器地址")
            )
            // 信令服务器
            .child(self.render_section("信令服务器 (hbbs)", cx, |cx| {
                div()
                    .flex()
                    .col()
                    .gap_2()
                    .child(
                        Input::new(&mut self.server_config.hbbs_host, cx)
                            .placeholder("例如: hbbs.example.com")
                            .label("主机地址")
                    )
                    .child(
                        Input::new(&mut self.server_config.hbbs_port, cx)
                            .placeholder("21116")
                            .label("端口")
                            .validator(|s| {
                                s.parse::<u16>().map_err(|_| "端口必须是 1-65535".to_string())
                            })
                    )
            }))
            // 中继服务器
            .child(self.render_section("中继服务器 (hbbr)", cx, |cx| {
                div()
                    .flex()
                    .col()
                    .gap_2()
                    .child(
                        Input::new(&mut self.server_config.hbbr_host, cx)
                            .placeholder("例如: relay.example.com")
                            .label("主机地址")
                    )
                    .child(
                        Input::new(&mut self.server_config.hbbr_port, cx)
                            .placeholder("21117")
                            .label("端口")
                            .validator(|s| {
                                s.parse::<u16>().map_err(|_| "端口必须是 1-65535".to_string())
                            })
                    )
            }))
            // API 服务器
            .child(self.render_section("API 服务器", cx, |cx| {
                div()
                    .flex()
                    .col()
                    .gap_2()
                    .child(
                        Input::new(&mut self.server_config.api_host, cx)
                            .placeholder("例如: api.example.com")
                            .label("主机地址")
                    )
                    .child(
                        Input::new(&mut self.server_config.api_port, cx)
                            .placeholder("8080")
                            .label("端口")
                            .validator(|s| {
                                s.parse::<u16>().map_err(|_| "端口必须是 1-65535".to_string())
                            })
                    )
            }))
            // 连接测试按钮
            .child(
                Button::new("test-connection", cx)
                    .label("测试连接")
                    .on_click(|_, cx| {
                        self.test_connection(cx);
                    })
            )
    }

    /// 渲染配置区块
    fn render_section<F>(
        &mut self,
        title: &'static str,
        _cx: &mut Context,
        content: F,
    ) -> impl IntoElement
    where
        F: FnOnce(&mut Context) -> impl IntoElement + 'static,
    {
        div()
            .p_4()
            .border_1()
            .border_gray_300()
            .rounded-lg()
            .child(
                div()
                    .font_bold()
                    .mb_2()
                    .child(title)
            )
            .child(content(_cx))
    }

    /// 保存配置
    fn save(&mut self, cx: &mut Context) {
        self.is_saving = true;
        cx.notify();

        let config = AppConfig {
            server: Some(self.server_config.clone()),
            security: Some(self.security_config.clone()),
            ..Default::default()
        };

        cx.spawn(async move {
            // 保存配置
            if let Err(e) = config.save().await {
                // 显示错误
            }
        });
    }

    /// 重置为默认
    fn reset_to_default(&mut self, cx: &mut Context) {
        self.server_config = ServerConfig::default();
        cx.notify();
    }

    /// 测试连接
    fn test_connection(&mut self, cx: &mut Context) {
        // TODO: 实现连接测试
    }
}
```

---

## Phase 3：依赖管理（P0）

### 3.1 Node.js 自动安装

#### 3.1.1 NodeDetector 完整实现（200 行）

```rust
// crates/agent-client/src/core/dependency/node.rs

use std::path::PathBuf;
use std::process::Command;
use tokio::fs;
use regex::Regex;
use thiserror::Error;

use crate::core::platform::directories::AppDirectories;

const MIN_NODE_VERSION: &str = "18.0.0";

/// Node.js 检测器
pub struct NodeDetector;

#[derive(Debug, Clone)]
pub struct NodeInfo {
    /// 安装来源
    pub source: NodeSource,

    /// 版本号
    pub version: Option<semver::Version>,

    /// 可执行文件路径
    pub path: PathBuf,

    /// 是否有效
    pub is_valid: bool,

    /// 错误信息（如果无效）
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NodeSource {
    /// 系统全局安装
    SystemGlobal(PathBuf),

    /// 客户端隔离目录安装
    ClientDirectory(PathBuf),

    /// 未安装
    NotInstalled,
}

#[derive(Error, Debug)]
pub enum NodeDetectionError {
    #[error("Path is not executable: {0}")]
    NotExecutable(String),

    #[error("Failed to get version: {0}")]
    VersionParseError(String),

    #[error("Version too old: {0}, minimum required: {1}")]
    VersionTooOld(String, String),

    #[error("Node not found")]
    NotFound,
}

impl NodeDetector {
    /// 检测系统全局 Node.js
    pub async fn detect_system_node(&self) -> Result<Option<NodeInfo>, NodeDetectionError> {
        // 1. 检查 PATH 中的 node
        if let Some(path) = self.find_in_path("node") {
            if let Some(info) = self.check_node(&path).await? {
                return Ok(Some(info));
            }
        }

        // 2. 检查平台特定的系统路径
        #[cfg(target_os = "macos")]
        {
            let path = PathBuf::from("/usr/local/bin/node");
            if path.exists() {
                if let Some(info) = self.check_node(&path).await? {
                    return Ok(Some(info));
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            let paths = vec![
                PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
                PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
            ];

            for path in paths {
                if path.exists() {
                    if let Some(info) = self.check_node(&path).await? {
                        return Ok(Some(info));
                    }
                }
            }
        }

        Ok(None)
    }

    /// 检测客户端目录中的 Node.js
    pub async fn detect_client_node(&self) -> Result<Option<NodeInfo>, NodeDetectionError> {
        let install_dir = self.get_client_install_dir();

        #[cfg(target_os = "macos")]
        let node_path = install_dir.join("bin/node");

        #[cfg(target_os = "windows")]
        let node_path = install_dir.join("node.exe");

        #[cfg(target_os = "linux")]
        let node_path = install_dir.join("bin/node");

        if node_path.exists() {
            if let Some(info) = self.check_node(&node_path).await? {
                return Ok(Some(info));
            }
        }

        Ok(None)
    }

    /// 检测并返回最佳可用的 Node.js
    pub async fn detect_best(&self) -> Result<Option<NodeInfo>, NodeDetectionError> {
        // 1. 优先使用系统全局
        if let Some(info) = self.detect_system_node().await? {
            return Ok(Some(info));
        }

        // 2. 检查客户端目录
        if let Some(info) = self.detect_client_node().await? {
            return Ok(Some(info));
        }

        Ok(None)
    }

    /// 检查 Node.js 是否有效
    async fn check_node(&self, path: &PathBuf) -> Result<Option<NodeInfo>, NodeDetectionError> {
        // 检查文件是否存在且可执行
        if !path.exists() {
            return Ok(None);
        }

        // 获取版本
        let version = match self.get_version(path).await {
            Ok(v) => v,
            Err(e) => {
                return Ok(Some(NodeInfo {
                    source: NodeSource::SystemGlobal(path.clone()),
                    version: None,
                    path: path.clone(),
                    is_valid: false,
                    error: Some(e.to_string()),
                }));
            }
        };

        // 检查版本是否满足最低要求
        if let Some(v) = &version {
            if v < &semver::Version::parse(MIN_NODE_VERSION).unwrap() {
                return Ok(Some(NodeInfo {
                    source: NodeSource::SystemGlobal(path.clone()),
                    version: Some(v.clone()),
                    path: path.clone(),
                    is_valid: false,
                    error: Some(format!(
                        "Version {} too old, minimum required: {}",
                        v, MIN_NODE_VERSION
                    )),
                }));
            }
        }

        Ok(Some(NodeInfo {
            source: NodeSource::SystemGlobal(path.clone()),
            version,
            path: path.clone(),
            is_valid: true,
            error: None,
        }))
    }

    /// 从 PATH 中查找可执行文件
    fn find_in_path(&self, command: &str) -> Option<PathBuf> {
        std::env::var_os("PATH").and_then(|paths| {
            paths.to_str().map(|paths_str| {
                paths_str.split(std::path::PATH_SEPARATOR)
                    .filter_map(|dir| {
                        let path = PathBuf::from(dir).join(command);
                        // 检查文件是否存在且不是目录
                        if path.exists() && path.is_file() {
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                if let Ok(metadata) = path.metadata() {
                                    if metadata.permissions().mode() & 0o111 != 0 {
                                        return Some(path);
                                    }
                                }
                            }
                            #[cfg(windows)]
                            {
                                return Some(path);
                            }
                        }
                        None
                    })
                    .next()
            })
        })
    }

    /// 获取 Node.js 版本
    async fn get_version(&self, path: &PathBuf) -> Result<Option<semver::Version>, NodeDetectionError> {
        let output = Command::new(path)
            .arg("--version")
            .output()
            .map_err(|e| NodeDetectionError::VersionParseError(e.to_string()))?;

        if !output.status.success() {
            return Err(NodeDetectionError::VersionParseError(
                String::from_utf8_lossy(&output.stderr).to_string()
            ));
        }

        let version_str = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_string();

        // 解析版本号（去除 'v' 前缀）
        let version_str = version_str.strip_prefix('v').unwrap_or(&version_str);

        // 解析语义化版本
        let version = semver::Version::parse(version_str)
            .map_err(|e| NodeDetectionError::VersionParseError(e.to_string()))?;

        Ok(Some(version))
    }

    /// 获取客户端安装目录
    fn get_client_install_dir(&self) -> PathBuf {
        let dirs = AppDirectories::new();
        dirs.data_dir.join("tools/node")
    }
}

/// 检查命令是否可用
pub fn is_command_available(command: &str) -> bool {
    if let Some(path) = PathBuf::from(command).canonicalize().ok() {
        return path.exists() && path.is_file();
    }

    if let Some(path) = std::env::var_os("PATH") {
        return path.to_str()
            .unwrap_or("")
            .split(std::path::PATH_SEPARATOR)
            .any(|dir| {
                let path = PathBuf::from(dir).join(command);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(metadata) = path.metadata() {
                        return metadata.permissions().mode() & 0o111 != 0;
                    }
                }
                #[cfg(windows)]
                {
                    return path.exists() && path.is_file();
                }
                false
            });
    }

    false
}
```

#### 3.1.2 NodeInstaller 完整实现（250 行）

```rust
// crates/agent-client/src/core/dependency/node_installer.rs

use std::path::{PathBuf, Path};
use std::fs::{self, Permissions};
use std::os::unix::fs::PermissionsExt;
use tokio::sync::mpsc;
use reqwest;
use tracing::{info, warn, error, debug};
use thiserror::Error;

use super::node::NodeDetector;
use crate::core::platform::directories::AppDirectories;
use crate::utils::notification::Notification;

const NODE_VERSION: &str = "20.10.0";

/// Node.js 安装器
pub struct NodeInstaller {
    /// 安装目录
    install_dir: PathBuf,

    /// 版本
    version: String,

    /// 下载 URL
    download_url: String,

    /// 通知发送器
    notification_tx: mpsc::Sender<Notification>,
}

#[derive(Error, Debug)]
pub enum NodeInstallError {
    #[error("Download failed: {0}")]
    DownloadFailed(String),

    #[error("Extract failed: {0}")]
    ExtractFailed(String),

    #[error("Verification failed: {0}")]
    VerificationFailed(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Network error: {0}")]
    NetworkError(String),
}

pub enum InstallProgress {
    Downloading { progress: u8 },
    Extracting,
    Configuring,
    Verifying,
    Completed,
    Failed(String),
}

impl NodeInstaller {
    /// 创建新的安装器
    pub fn new(notification_tx: mpsc::Sender<Notification>) -> Self {
        let version = NODE_VERSION.to_string();
        let install_dir = Self::get_install_dir();
        let download_url = Self::get_download_url(&version);

        Self {
            install_dir,
            version,
            download_url,
            notification_tx,
        }
    }

    /// 获取安装目录
    fn get_install_dir() -> PathBuf {
        let dirs = AppDirectories::new();
        dirs.data_dir.join("tools/node")
    }

    /// 获取下载 URL（跨平台）
    fn get_download_url(version: &str) -> String {
        #[cfg(target_os = "macos")]
        {
            if std::env::consts::ARCH == "aarch64" {
                format!(
                    "https://nodejs.org/dist/{}/node-{}-darwin-arm64.tar.xz",
                    version, version
                )
            } else {
                format!(
                    "https://nodejs.org/dist/{}/node-{}-darwin-x64.tar.xz",
                    version, version
                )
            }
        }

        #[cfg(target_os = "windows")]
        {
            format!(
                "https://nodejs.org/dist/{}/node-{}-win-x64.zip",
                version, version
            )
        }

        #[cfg(target_os = "linux")]
        {
            format!(
                "https://nodejs.org/dist/{}/node-{}-linux-x64.tar.xz",
                version, version
            )
        }
    }

    /// 安装 Node.js
    pub async fn install(&self) -> Result<(), NodeInstallError> {
        info!("Starting Node.js {} installation", self.version);
        self.send_notification("开始下载 Node.js...").await;

        // 1. 创建安装目录
        fs::create_dir_all(&self.install_dir)
            .map_err(|e| NodeInstallError::IoError(e.to_string()))?;

        // 2. 下载压缩包
        let archive_path = self.install_dir.join(format!("node-{}.tar.xz", self.version));
        self.download(&archive_path).await?;

        // 3. 解压
        self.send_notification("正在解压...").await;
        self.extract(&archive_path).await?;

        // 4. 记录版本
        self.record_version().await?;

        // 5. 验证安装
        self.send_notification("正在验证安装...").await;
        self.verify().await?;

        self.send_notification(&format!("Node.js {} 安装完成", self.version)).await;

        Ok(())
    }

    /// 下载 Node.js
    async fn download(&self, archive_path: &PathBuf) -> Result<(), NodeInstallError> {
        info!("Downloading Node.js from {}", self.download_url);

        let response = reqwest::Client::new()
            .get(&self.download_url)
            .send()
            .await
            .map_err(|e| NodeInstallError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(NodeInstallError::DownloadFailed(
                format!("HTTP {}", response.status())
            ));
        }

        let total_size = response
            .content_length()
            .unwrap_or(0);

        let mut file = fs::File::create(archive_path)
            .map_err(|e| NodeInstallError::IoError(e.to_string()))?;

        let mut downloaded: u64 = 0;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk
                .map_err(|e| NodeInstallError::DownloadFailed(e.to_string()))?;

            file.write_all(&chunk)
                .map_err(|e| NodeInstallError::IoError(e.to_string()))?;

            downloaded += chunk.len() as u64;

            // 发送下载进度
            if total_size > 0 {
                let progress = (downloaded as f64 / total_size as f64 * 100.0) as u8;
                self.send_progress(InstallProgress::Downloading { progress }).await;
            }
        }

        info!("Download completed: {} bytes", downloaded);

        Ok(())
    }

    /// 解压压缩包
    async fn extract(&self, archive_path: &PathBuf) -> Result<(), NodeInstallError> {
        info!("Extracting archive");

        // 解压到临时目录
        let temp_dir = self.install_dir.join("temp");
        fs::create_dir_all(&temp_dir)
            .map_err(|e| NodeInstallError::IoError(e.to_string()))?;

        // 使用 tar 解压
        #[cfg(unix)]
        {
            let output = Command::new("tar")
                .args(&[
                    "-xf",
                    archive_path.to_str().unwrap(),
                    "-C",
                    temp_dir.to_str().unwrap(),
                ])
                .output()
                .await
                .map_err(|e| NodeInstallError::ExtractFailed(e.to_string()))?;

            if !output.status.success() {
                return Err(NodeInstallError::ExtractFailed(
                    String::from_utf8_lossy(&output.stderr).to_string()
                ));
            }
        }

        #[cfg(windows)]
        {
            // Windows 使用解压工具
            let output = Command::new("powershell")
                .args(&[
                    "-Command",
                    &format!("Expand-Archive -Path '{}' -DestinationPath '{}'",
                        archive_path.display(),
                        temp_dir.display())
                ])
                .output()
                .await
                .map_err(|e| NodeInstallError::ExtractFailed(e.to_string()))?;

            if !output.status.success() {
                return Err(NodeInstallError::ExtractFailed(
                    String::from_utf8_lossy(&output.stderr).to_string()
                ));
            }
        }

        // 移动内容到安装目录
        let extracted_dir = temp_dir.join(format!("node-{}", self.version));
        if extracted_dir.exists() {
            for entry in fs::read_dir(&extracted_dir)? {
                let entry = entry?;
                let dest = self.install_dir.join(entry.file_name());
                fs::rename(entry.path(), &dest)
                    .map_err(|e| NodeInstallError::IoError(e.to_string()))?;
            }
        }

        // 清理
        fs::remove_dir_all(&temp_dir).ok();
        fs::remove_file(archive_path).ok();

        self.send_progress(InstallProgress::Extracting).await;

        Ok(())
    }

    /// 记录安装版本
    async fn record_version(&self) -> Result<(), NodeInstallError> {
        let version_file = self.install_dir.join("versions.json");

        #[cfg(unix)]
        {
            // 设置 bin 目录权限
            let bin_dir = self.install_dir.join("bin");
            if bin_dir.exists() {
                fs::set_permissions(&bin_dir, fs::Permissions::from_mode(0o755))
                    .map_err(|e| NodeInstallError::IoError(e.to_string()))?;
            }
        }

        // 写入版本信息
        let version_info = serde_json::json!({
            "name": "node",
            "version": self.version,
            "installed_at": chrono::Utc::now().to_rfc3339(),
        });

        fs::write(&version_file, version_info.to_string())
            .map_err(|e| NodeInstallError::IoError(e.to_string()))?;

        Ok(())
    }

    /// 验证安装
    async fn verify(&self) -> Result<(), NodeInstallError> {
        #[cfg(target_os = "macos")]
        let node_path = self.install_dir.join("bin/node");

        #[cfg(target_os = "windows")]
        let node_path = self.install_dir.join("node.exe");

        #[cfg(target_os = "linux")]
        let node_path = self.install_dir.join("bin/node");

        if !node_path.exists() {
            return Err(NodeInstallError::VerificationFailed(
                "Node executable not found".to_string()
            ));
        }

        // 检查版本
        let output = Command::new(&node_path)
            .arg("--version")
            .output()
            .await
            .map_err(|e| NodeInstallError::VerificationFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(NodeInstallError::VerificationFailed(
                "Version check failed".to_string()
            ));
        }

        self.send_progress(InstallProgress::Verifying).await;

        Ok(())
    }

    /// 发送通知
    async fn send_notification(&self, message: &str) {
        let _ = self.notification_tx.send(Notification::info(message)).await;
    }

    /// 发送进度
    async fn send_progress(&self, progress: InstallProgress) {
        let message = match &progress {
            InstallProgress::Downloading { progress } => format!("下载中... {}%", progress),
            InstallProgress::Extracting => "正在解压...",
            InstallProgress::Configuring => "正在配置...",
            InstallProgress::Verifying => "正在验证...",
            InstallProgress::Completed => "安装完成",
            InstallProgress::Failed(e) => return,
        };

        let _ = self.notification_tx.send(Notification::info(message)).await;
    }
}
```

---

## Phase 4：Agent 运行时（P1）

### 4.1 AgentManager 完整实现（250 行）

```rust
// crates/agent-client/src/core/agent.rs

use std::path::PathBuf;
use std::time::Duration;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock, broadcast};
use dashmap::DashMap;
use tracing::{info, warn, error, debug};

use agent_runner::{
    start_agent, cancel_agent, get_agent_status,
    AgentRequest, AgentOutput, AgentStatus,
};
use crate::message::proto::{AgentTaskRequest, AgentTaskOutput};
use crate::utils::Notification;

/// Agent 任务信息
pub struct AgentTaskInfo {
    pub task_id: String,
    pub session_id: String,
    pub status: AgentTaskStatus,
    pub output_tx: mpsc::Sender<AgentOutput>,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AgentTaskStatus {
    Pending,
    Active,
    Completing,
    Completed,
    Error,
}

/// Agent 管理器
pub struct AgentManager {
    /// 活跃任务映射
    tasks: DashMap<String, AgentTaskInfo>,

    /// 消息通道
    message_tx: mpsc::Sender<AgentMessage>,

    /// 消息广播
    event_tx: broadcast::Sender<AgentEvent>,

    /// 工作目录
    work_dir: PathBuf,
}

#[derive(Clone, Debug)]
pub enum AgentMessage {
    Progress {
        task_id: String,
        output: AgentOutput,
    },
    Completed {
        task_id: String,
        output: Option<AgentOutput>,
    },
    Error {
        task_id: String,
        error: String,
    },
}

#[derive(Clone, Debug)]
pub enum AgentEvent {
    TaskStarted(String),
    TaskProgress(String, String),
    TaskCompleted(String),
    TaskFailed(String, String),
    TaskCancelled(String),
}

#[derive(Error, Debug)]
pub enum AgentError {
    #[error("Task not found: {0}")]
    NotFound(String),

    #[error("Start failed: {0}")]
    StartFailed(String),

    #[error("Cancel failed: {0}")]
    CancelFailed(String),

    #[error("Worker stopped")]
    WorkerStopped,
}

impl AgentManager {
    /// 创建新的 Agent 管理器
    pub fn new() -> Self {
        let (message_tx, _) = mpsc::channel(100);
        let (event_tx, _) = broadcast::channel(100);

        let work_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent/workspace");

        Self {
            tasks: DashMap::new(),
            message_tx,
            event_tx,
            work_dir,
        }
    }

    /// 执行 Agent 任务
    pub async fn execute_task(
        &self,
        request: AgentTaskRequest,
    ) -> Result<String, AgentError> {
        let task_id = request.task_id.clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let session_id = uuid::Uuid::new_v4().to_string();

        info!("Starting agent task: {}", task_id);

        // 1. 转换请求
        let agent_request = self.convert_request(request).await;

        // 2. 创建输出通道
        let (output_tx, output_rx) = mpsc::channel(100);

        // 3. 启动任务
        let mut output_stream = start_agent(agent_request)
            .await
            .map_err(|e| AgentError::StartFailed(e.to_string()))?;

        // 4. 注册任务
        let task_info = AgentTaskInfo {
            task_id: task_id.clone(),
            session_id: session_id.clone(),
            status: AgentTaskStatus::Active,
            output_tx: output_tx.clone(),
            started_at: chrono::Utc::now(),
        };
        self.tasks.insert(task_id.clone(), task_info);

        // 5. 发送任务开始事件
        let _ = self.event_tx.send(AgentEvent::TaskStarted(task_id.clone()));

        // 6. 在后台处理输出流
        let tasks = self.tasks.clone();
        let message_tx = self.message_tx.clone();
        let event_tx = self.event_tx.clone();
        let task_id_clone = task_id.clone();

        tokio::spawn(async move {
            while let Some(output) = output_stream.next().await {
                // 发送输出到通道
                let _ = output_tx.send(output.clone()).await;

                // 发送进度消息
                let _ = message_tx.send(AgentMessage::Progress {
                    task_id: task_id_clone.clone(),
                    output: output.clone(),
                }).await;

                // 发送事件
                let content = output.content.clone().unwrap_or_default();
                let _ = event_tx.send(AgentEvent::TaskProgress(
                    task_id_clone.clone(),
                    content,
                )).await;
            }

            // 任务完成
            tasks.remove(&task_id_clone);
            let _ = message_tx.send(AgentMessage::Completed {
                task_id: task_id_clone.clone(),
                output: None,
            }).await;
            let _ = event_tx.send(AgentEvent::TaskCompleted(task_id_clone)).await;
        });

        Ok(task_id)
    }

    /// 取消任务
    pub async fn cancel_task(&self, task_id: &str) -> Result<(), AgentError> {
        info!("Cancelling task: {}", task_id);

        if let Some(info) = self.tasks.get(task_id) {
            // 更新状态
            let mut info = info.clone();
            info.status = AgentTaskStatus::Completing;

            // 调用取消
            cancel_agent(&info.session_id)
                .await
                .map_err(|e| AgentError::CancelFailed(e.to_string()))?;

            // 发送事件
            let _ = self.event_tx.send(AgentEvent::TaskCancelled(task_id.to_string()));

            Ok(())
        } else {
            Err(AgentError::NotFound(task_id.to_string()))
        }
    }

    /// 获取任务状态
    pub async fn get_task_status(&self, task_id: &str) -> Option<AgentTaskStatus> {
        self.tasks.get(task_id).map(|info| info.status)
    }

    /// 获取所有活跃任务
    pub fn get_active_tasks(&self) -> Vec<(String, AgentTaskStatus)> {
        self.tasks
            .iter()
            .map(|info| (info.key().clone(), info.status))
            .collect()
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.event_tx.subscribe()
    }

    /// 转换请求
    async fn convert_request(&self, request: AgentTaskRequest) -> AgentRequest {
        let work_dir = request.work_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| self.work_dir.clone());

        let timeout = if request.timeout_seconds > 0 {
            Some(Duration::from_secs(request.timeout_seconds as u64))
        } else {
            None
        };

        AgentRequest {
            prompt: request.prompt,
            work_dir,
            env: request.env.into_iter().collect(),
            timeout,
            // ... 其他字段
        }
    }

    /// 设置工作目录
    pub fn set_work_dir(&mut self, path: PathBuf) {
        self.work_dir = path;
    }
}
```

---

## Phase 5：增强功能（P1）

### 5.1 权限检测

#### 5.1.1 PermissionManager 完整实现（200 行）

```rust
// crates/agent-client/src/core/platform/permissions.rs

use std::path::PathBuf;
use thiserror::Error;

#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

/// 权限类型
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PermissionType {
    /// 辅助功能（键盘鼠标模拟）
    Accessibility,

    /// 屏幕录制（远程桌面）
    ScreenRecording,

    /// 磁盘访问（文件传输）
    FullDiskAccess,

    /// 麦克风
    Microphone,

    #[cfg(target_os = "linux")]
    Wayland,
}

/// 权限状态
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PermissionStatus {
    /// 已授权
    Granted,

    /// 被拒绝
    Denied,

    /// 尚未确定（首次请求）
    NotDetermined,

    /// 受限制
    Restricted,
}

/// 权限检查结果
pub struct PermissionCheck {
    pub permission_type: PermissionType,
    pub status: PermissionStatus,
    pub description: String,
    pub setting_url: String,
}

#[derive(Error, Debug)]
pub enum PermissionError {
    #[error("Platform not supported")]
    NotSupported,

    #[error("Check failed: {0}")]
    CheckFailed(String),

    #[error("Open settings failed: {0}")]
    OpenSettingsFailed(String),
}

/// 权限管理器
pub struct PermissionManager;

impl PermissionManager {
    /// 检查所有权限
    pub async fn check_all(&self) -> Vec<PermissionCheck> {
        vec![
            self.check_accessibility().await,
            self.check_screen_recording().await,
            self.check_full_disk_access().await,
            self.check_microphone().await,
        ]
    }

    /// 检查辅助功能权限
    pub async fn check_accessibility(&self) -> PermissionCheck {
        #[cfg(target_os = "macos")]
        {
            let status = Self::check_macos_permission("Accessibility");
            PermissionCheck {
                permission_type: PermissionType::Accessibility,
                status,
                description: "用于远程控制时模拟键盘鼠标输入".to_string(),
                setting_url: "x-apple.systempreferences:com.apple.SecurityPrivacy_Accessibility".to_string(),
            }
        }

        #[cfg(target_os = "windows")]
        {
            let status = Self::check_windows_permission("Accessibility");
            PermissionCheck {
                permission_type: PermissionType::Accessibility,
                status,
                description: "用于远程控制时模拟键盘鼠标输入".to_string(),
                setting_url: "ms-settings:privacy-keyboard".to_string(),
            }
        }

        #[cfg(target_os = "linux")]
        {
            PermissionCheck {
                permission_type: PermissionType::Accessibility,
                status: PermissionStatus::NotDetermined,
                description: "用于远程控制时模拟键盘鼠标输入".to_string(),
                setting_url: "".to_string(),
            }
        }
    }

    /// 检查屏幕录制权限
    pub async fn check_screen_recording(&self) -> PermissionCheck {
        #[cfg(target_os = "macos")]
        {
            let status = Self::check_macos_permission("Screen Recording");
            PermissionCheck {
                permission_type: PermissionType::ScreenRecording,
                status,
                description: "用于远程桌面实时画面传输".to_string(),
                setting_url: "x-apple.systempreferences:com.apple.SecurityPrivacy_ScreenRecording".to_string(),
            }
        }

        #[cfg(target_os = "windows")]
        {
            PermissionCheck {
                permission_type: PermissionType::ScreenRecording,
                status: PermissionStatus::Granted,
                description: "用于远程桌面实时画面传输".to_string(),
                setting_url: "ms-settings:privacy-webcam".to_string(),
            }
        }

        #[cfg(target_os = "linux")]
        {
            PermissionCheck {
                permission_type: PermissionType::ScreenRecording,
                status: PermissionStatus::NotDetermined,
                description: "用于远程桌面实时画面传输".to_string(),
                setting_url: "".to_string(),
            }
        }
    }

    /// 打开系统设置页面
    pub fn open_settings(&self, setting_url: &str) -> Result<(), PermissionError> {
        #[cfg(target_os = "macos")]
        {
            open::that(setting_url)
                .map_err(|e| PermissionError::OpenSettingsFailed(e.to_string()))?;
        }

        #[cfg(target_os = "windows")]
        {
            if setting_url.starts_with("ms-settings:") {
                Command::new("cmd")
                    .args(&["/c", "start", setting_url])
                    .spawn()
                    .map_err(|e| PermissionError::OpenSettingsFailed(e.to_string()))?;
            } else {
                open::that(setting_url)
                    .map_err(|e| PermissionError::OpenSettingsFailed(e.to_string()))?;
            }
        }

        #[cfg(target_os = "linux")]
        {
            open::that(setting_url)
                .map_err(|e| PermissionError::OpenSettingsFailed(e.to_string()))?;
        }

        Ok(())
    }

    /// 检查 macOS 权限（使用 tccutil 或直接检查）
    #[cfg(target_os = "macos")]
    fn check_macos_permission(name: &str) -> PermissionStatus {
        // 尝试通过命令行检查
        let output = Command::new("sqlite3")
            .args(&[
                "/Library/Application Support/com.apple.TCC/TCC.db",
                &format!("SELECT auth_value FROM access WHERE client='{}' AND service='{}'",
                    "nuwax-agent", name)
            ])
            .output();

        match output {
            Ok(output) => {
                let result = String::from_utf8_lossy(&output.stdout);
                match result.trim() {
                    "2" => PermissionStatus::Granted,  // kTCCAuthResultAuthorized
                    "1" => PermissionStatus::NotDetermined,
                    "0" => PermissionStatus::Denied,
                    _ => PermissionStatus::NotDetermined,
                }
            }
            Err(_) => PermissionStatus::NotDetermined,
        }
    }

    /// 检查 Windows 权限
    #[cfg(target_os = "windows")]
    fn check_windows_permission(_name: &str) -> PermissionStatus {
        // Windows 权限检查比较复杂，这里简化处理
        // 实际实现需要检查注册表或使用 Windows API
        PermissionStatus::Granted
    }
}
```

---

## Phase 6：收尾完善（P2）

### 6.1 About 组件完整实现（120 行）

```rust
// crates/agent-client/src/components/about.rs

use gpui::{div, Component, Context, Element, IntoElement, Render};
use gpui::prelude::*;
use gpui_component::{Button, Modal, Link};

use crate::VERSION;
use crate::BUILD_INFO;

/// 关于组件
pub struct About;

impl About {
    pub fn render(&mut self, cx: &mut Context) -> impl IntoElement {
        div()
            .id("about")
            .size_full()
            .p_8()
            .flex()
            .col()
            .items_center()
            .gap_6()
            // 应用图标
            .child(
                div()
                    .w(px(96.0))
                    .h(px(96.0))
                    .bg_blue_500()
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        div()
                            .text_4xl()
                            .text_white()
                            .font_bold()
                            .child("A")
                    )
            )
            // 应用名称
            .child(
                div()
                    .text_2xl()
                    .font_bold()
                    .text_color(cx.theme().text)
                    .child("nuwax-agent")
            )
            // 版本信息
            .child(
                div()
                    .text_lg()
                    .text_gray()
                    .child(format!("版本 {} ({})", VERSION, BUILD_INFO.git_sha))
            )
            // 构建信息
            .child(
                div()
                    .text_sm()
                    .text_gray_500()
                    .child(format!(
                        "Rust {}, 构建时间: {}",
                        env!("RUST_VERSION"),
                        BUILD_INFO.build_date
                    ))
            )
            // 许可证
            .child(
                div()
                    .text_sm()
                    .text_gray_500()
                    .child("MIT License")
            )
            // 链接
            .child(
                div()
                    .flex()
                    .gap_4()
                    .mt_4()
                    .child(
                        Link::new("https://docs.example.com")
                            .label("文档")
                    )
                    .child(
                        Link::new("https://github.com/example/issues")
                            .label("问题反馈")
                    )
                    .child(
                        Link::new("https://example.com")
                            .label("官网")
                    )
            )
            // 操作按钮
            .child(
                div()
                    .flex()
                    .gap_4()
                    .mt_8()
                    .child(
                        Button::new("export-logs", cx)
                            .label("导出日志")
                            .on_click(|_, cx| {
                                self.export_logs(cx);
                            })
                    )
                    .child(
                        Button::new("check-update", cx)
                            .label("检查更新")
                            .on_click(|_, cx| {
                                self.check_update(cx);
                            })
                    )
            )
    }

    fn export_logs(&self, cx: &mut Context) {
        // TODO: 实现日志导出
    }

    fn check_update(&self, cx: &mut Context) {
        // TODO: 实现更新检查
    }
}

/// 构建信息
pub struct BuildInfo {
    pub git_sha: String,
    pub git_date: String,
    pub build_date: String,
    pub platform: String,
    pub arch: String,
}

impl BuildInfo {
    pub fn new() -> Self {
        Self {
            git_sha: env!("GIT_SHA").to_string(),
            git_date: env!("GIT_DESCRIBE").to_string(),
            build_date: chrono::Utc::now().to_rfc3339(),
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        }
    }
}
```

---

## 8. 安全与网络实现

### 8.0 协议版本协商

```rust
// crates/agent-protocol/src/version.rs

use semver::Version;
use thiserror::Error;

/// 协议版本
pub const PROTOCOL_VERSION: &str = "1.0.0";

/// 支持的最低版本
pub const MIN_SUPPORTED_VERSION: &str = "1.0.0";

/// 版本协商错误
#[derive(Error, Debug)]
pub enum VersionError {
    #[error("协议版本不兼容: 需要 >= {min}, 实际 {actual}")]
    Incompatible { min: String, actual: String },
    #[error("无效的版本格式: {0}")]
    InvalidFormat(String),
}

/// 版本协商器
pub struct VersionNegotiator {
    /// 当前协议版本
    current: Version,
    /// 最低支持版本
    min_supported: Version,
}

impl VersionNegotiator {
    pub fn new() -> Self {
        Self {
            current: Version::parse(PROTOCOL_VERSION).unwrap(),
            min_supported: Version::parse(MIN_SUPPORTED_VERSION).unwrap(),
        }
    }

    /// 检查版本兼容性
    pub fn check_compatibility(&self, remote_version: &str) -> Result<bool, VersionError> {
        let remote = Version::parse(remote_version)
            .map_err(|_| VersionError::InvalidFormat(remote_version.to_string()))?;

        if remote < self.min_supported {
            return Err(VersionError::Incompatible {
                min: self.min_supported.to_string(),
                actual: remote.to_string(),
            });
        }

        Ok(true)
    }

    /// 获取当前版本
    pub fn current_version(&self) -> &str {
        PROTOCOL_VERSION
    }

    /// 协商版本（返回双方都支持的最高版本）
    pub fn negotiate(&self, remote_version: &str) -> Result<String, VersionError> {
        let remote = Version::parse(remote_version)
            .map_err(|_| VersionError::InvalidFormat(remote_version.to_string()))?;

        // 检查兼容性
        self.check_compatibility(remote_version)?;

        // 返回较低的版本作为协商结果
        let negotiated = if remote < self.current {
            remote
        } else {
            self.current.clone()
        };

        Ok(negotiated.to_string())
    }
}

/// 在握手消息中使用
impl HandshakeRequest {
    pub fn with_version() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION.to_string(),
            // ... 其他字段
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compatible_version() {
        let negotiator = VersionNegotiator::new();
        assert!(negotiator.check_compatibility("1.0.0").is_ok());
        assert!(negotiator.check_compatibility("1.1.0").is_ok());
        assert!(negotiator.check_compatibility("2.0.0").is_ok());
    }

    #[test]
    fn test_incompatible_version() {
        let negotiator = VersionNegotiator::new();
        assert!(negotiator.check_compatibility("0.9.0").is_err());
    }

    #[test]
    fn test_negotiate() {
        let negotiator = VersionNegotiator::new();
        // 远程版本更高，使用本地版本
        assert_eq!(negotiator.negotiate("2.0.0").unwrap(), "1.0.0");
        // 远程版本相同
        assert_eq!(negotiator.negotiate("1.0.0").unwrap(), "1.0.0");
    }
}
```

### 8.0.1 配置文件加密存储

```rust
// crates/agent-client/src/core/security/config_encryption.rs

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use rand::RngCore;
use std::fs;
use std::path::Path;
use thiserror::Error;

/// 加密错误
#[derive(Error, Debug)]
pub enum EncryptionError {
    #[error("加密失败: {0}")]
    EncryptionFailed(String),
    #[error("解密失败: {0}")]
    DecryptionFailed(String),
    #[error("密钥派生失败")]
    KeyDerivationFailed,
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}

/// 配置加密器
pub struct ConfigEncryptor {
    /// 机器唯一标识（用于派生密钥）
    machine_id: String,
}

impl ConfigEncryptor {
    pub fn new() -> Result<Self, EncryptionError> {
        let machine_id = Self::get_machine_id()?;
        Ok(Self { machine_id })
    }

    /// 获取机器唯一标识
    #[cfg(target_os = "macos")]
    fn get_machine_id() -> Result<String, EncryptionError> {
        use std::process::Command;
        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        // 解析 IOPlatformUUID
        for line in stdout.lines() {
            if line.contains("IOPlatformUUID") {
                if let Some(uuid) = line.split('"').nth(3) {
                    return Ok(uuid.to_string());
                }
            }
        }
        Err(EncryptionError::KeyDerivationFailed)
    }

    #[cfg(target_os = "windows")]
    fn get_machine_id() -> Result<String, EncryptionError> {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography")?;
        let guid: String = key.get_value("MachineGuid")?;
        Ok(guid)
    }

    #[cfg(target_os = "linux")]
    fn get_machine_id() -> Result<String, EncryptionError> {
        let id = fs::read_to_string("/etc/machine-id")
            .or_else(|_| fs::read_to_string("/var/lib/dbus/machine-id"))?;
        Ok(id.trim().to_string())
    }

    /// 派生加密密钥
    fn derive_key(&self, salt: &[u8]) -> Result<[u8; 32], EncryptionError> {
        let mut key = [0u8; 32];
        Argon2::default()
            .hash_password_into(self.machine_id.as_bytes(), salt, &mut key)
            .map_err(|_| EncryptionError::KeyDerivationFailed)?;
        Ok(key)
    }

    /// 加密配置
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        // 生成随机盐和 nonce
        let mut salt = [0u8; 16];
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce_bytes);

        // 派生密钥
        let key = self.derive_key(&salt)?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;

        // 加密
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;

        // 格式: salt (16) + nonce (12) + ciphertext
        let mut result = Vec::with_capacity(16 + 12 + ciphertext.len());
        result.extend_from_slice(&salt);
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&ciphertext);

        Ok(result)
    }

    /// 解密配置
    pub fn decrypt(&self, encrypted: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        if encrypted.len() < 28 {
            return Err(EncryptionError::DecryptionFailed("数据太短".to_string()));
        }

        // 解析 salt、nonce 和密文
        let salt = &encrypted[..16];
        let nonce_bytes = &encrypted[16..28];
        let ciphertext = &encrypted[28..];

        // 派生密钥
        let key = self.derive_key(salt)?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;

        // 解密
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;

        Ok(plaintext)
    }

    /// 加密并保存到文件
    pub fn encrypt_to_file(&self, plaintext: &[u8], path: &Path) -> Result<(), EncryptionError> {
        let encrypted = self.encrypt(plaintext)?;
        fs::write(path, encrypted)?;
        Ok(())
    }

    /// 从文件读取并解密
    pub fn decrypt_from_file(&self, path: &Path) -> Result<Vec<u8>, EncryptionError> {
        let encrypted = fs::read(path)?;
        self.decrypt(&encrypted)
    }
}

/// 敏感配置字段标记
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SensitiveConfig {
    /// 连接密码（加密存储）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,

    /// API Token（加密存储）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_token: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let encryptor = ConfigEncryptor::new().unwrap();
        let plaintext = b"sensitive data";

        let encrypted = encryptor.encrypt(plaintext).unwrap();
        let decrypted = encryptor.decrypt(&encrypted).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_different_encryption_each_time() {
        let encryptor = ConfigEncryptor::new().unwrap();
        let plaintext = b"same data";

        let encrypted1 = encryptor.encrypt(plaintext).unwrap();
        let encrypted2 = encryptor.encrypt(plaintext).unwrap();

        // 每次加密结果不同（因为随机 salt 和 nonce）
        assert_ne!(encrypted1, encrypted2);

        // 但解密结果相同
        assert_eq!(
            encryptor.decrypt(&encrypted1).unwrap(),
            encryptor.decrypt(&encrypted2).unwrap()
        );
    }
}
```

### 8.1 密码存储与认证

```rust
// crates/agent-client/src/core/security/password.rs

use argon2::{Argon2, PasswordHash, PasswordVerifier};
use rand::rngs::OsRng;
use rand::RngCore;
use std::sync::Arc;
use thiserror::Error;

/// 密码存储错误
#[derive(Error, Debug)]
pub enum PasswordError {
    #[error("密码哈希失败")]
    HashError(#[from] argon2::Error),
    #[error("密码验证失败")]
    VerificationError,
    #[error("密码强度不足")]
    WeakPassword,
}

/// 密码强度
pub enum PasswordStrength {
    Weak,      // < 8 字符，红色
    Medium,    // >= 8 字符，无特殊字符，黄色
    Strong,    // >= 8 字符 + 特殊字符，绿色
}

/// 密码管理器
pub struct PasswordManager {
    /// Argon2 实例
    argon2: Arc<Argon2<'static>>,
    /// 密码盐长度
    salt_len: usize,
}

impl PasswordManager {
    pub fn new() -> Self {
        Self {
            argon2: Arc::new(Argon2::default()),
            salt_len: 16,
        }
    }

    /// 生成密码盐
    fn generate_salt(&self) -> Vec<u8> {
        let mut salt = vec![0u8; self.salt_len];
        OsRng.fill_bytes(&mut salt);
        salt
    }

    /// 哈希密码
    pub fn hash_password(&self, password: &str) -> Result<String, PasswordError> {
        let salt = self.generate_salt();

        let hash = argon2::Argon2::default()
            .hash_password_into(
                password.as_bytes(),
                &salt,
                &mut [0u8; 32],  // 32 字节输出
            )
            .map_err(PasswordError::HashError)?;

        // 格式: $argon2id$v=19$m=65536,t=3,p=4$salt$hash
        Ok(format!(
            "${}$v=19$m=65536,t=3,p=4${}${}$hash",
            argon2::Algorithm::Argon2id.variant_name().unwrap(),
            base64::encode(&salt),
            base64::encode(&hash)
        ))
    }

    /// 验证密码
    pub fn verify_password(&self, password: &str, hash: &str) -> Result<bool, PasswordError> {
        let parsed_hash = PasswordHash::new(hash)
            .map_err(PasswordError::HashError)?;

        self.argon2
            .verify_password(password.as_bytes(), &parsed_hash)
            .map(|_| true)
            .map_err(|_| PasswordError::VerificationError)
    }

    /// 检查密码强度
    pub fn check_strength(&self, password: &str) -> PasswordStrength {
        let has_letter = password.chars().any(|c| c.is_alphabetic());
        let has_digit = password.chars().any(|c| c.is_digit(10));
        let has_special = password.chars().any(|c| !c.is_alphanumeric());

        if password.len() < 8 {
            PasswordStrength::Weak
        } else if has_letter && has_digit && has_special {
            PasswordStrength::Strong
        } else {
            PasswordStrength::Medium
        }
    }
}

/// Token 管理器
pub struct TokenManager {
    /// Token 有效期（秒）
    const TOKEN_TTL_SECS: u64 = 86400;  // 24 小时
    /// 刷新提前量（秒）
    const REFRESH_AHEAD_SECS: u64 = 3600;  // 1 小时

    /// 密钥（用于 HMAC）
    secret_key: [u8; 32],
    /// 已发放的 Token
    active_tokens: DashMap<String, TokenData>,
}

struct TokenData {
    client_id: String,
    expires_at: DateTime<Utc>,
}

impl TokenManager {
    pub fn new() -> Self {
        Self {
            secret_key: Self::generate_secret_key(),
            active_tokens: DashMap::new(),
        }
    }

    fn generate_secret_key() -> [u8; 32] {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        key
    }

    /// 生成 Token
    pub fn generate_token(&self, client_id: &str) -> String {
        let now = Utc::now();
        let expires_at = now + Duration::seconds(Self::TOKEN_TTL_SECS as i64);

        let payload = json!({
            "client_id": client_id,
            "exp": expires_at.timestamp(),
            "iat": now.timestamp(),
        });

        let token = base64::encode(payload.to_string());
        let signature = self.sign(&token);

        format!("{}.{}", token, signature)
    }

    /// 签名
    fn sign(&self, data: &str) -> String {
        use hmac::{Hmac, Mac};
        type HmacSha256 = Hmac<Sha256>;

        let mut mac = HmacSha256::new_from_slice(&self.secret_key)
            .expect("HMAC initialization failed");
        mac.update(data.as_bytes());
        let result = mac.finalize().into_bytes();

        base64::encode(result)
    }

    /// 验证 Token
    pub fn validate_token(&self, token: &str) -> Option<(String, DateTime<Utc>)> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 2 {
            return None;
        }

        let signature = self.sign(parts[0]);
        if signature != parts[1] {
            return None;
        }

        let payload: serde_json::Value = serde_json::from_str(
            &base64::decode(parts[0]).ok()?.to_string()
        ).ok()?;

        let client_id = payload["client_id"].as_str()?.to_string();
        let expires_at = Utc.timestamp_opt(payload["exp"].as_i64()?, 0).single()?;

        if Utc::now() > expires_at {
            return None;
        }

        Some((client_id, expires_at))
    }
}
```

### 8.2 重连机制实现

```rust
// crates/agent-client/src/core/connection/reconnect.rs

use tokio::time::{sleep, Duration};
use std::sync::Arc;
use tokio::sync::RwLock;

/// 重连策略配置
#[derive(Clone)]
pub struct ReconnectConfig {
    /// 初始延迟（毫秒）
    pub initial_delay_ms: u64,
    /// 最大延迟（毫秒）
    pub max_delay_ms: u64,
    /// 指数退避基数
    pub backoff_base: f64,
    /// 最大重试次数（0 表示无限）
    pub max_retries: u32,
    /// 是否随机抖动
    pub jitter: bool,
}

impl Default for ReconnectConfig {
    fn default() -> Self {
        Self {
            initial_delay_ms: 1000,
            max_delay_ms: 30000,
            backoff_base: 2.0,
            max_retries: 0,  // 无限重试
            jitter: true,
        }
    }
}

/// 重连管理器
pub struct ReconnectManager {
    config: ReconnectConfig,
    retry_count: Arc<RwLock<u32>>,
    last_attempt: Arc<RwLock<DateTime<Utc>>>,
}

impl ReconnectManager {
    pub fn new(config: Option<ReconnectConfig>) -> Self {
        Self {
            config: config.unwrap_or_default(),
            retry_count: Arc::new(RwLock::new(0)),
            last_attempt: Arc::new(RwLock::new(Utc::now())),
        }
    }

    /// 计算重连延迟
    async fn calculate_delay(&self) -> Duration {
        let count = *self.retry_count.read().await;
        let mut delay = (self.config.initial_delay_ms as f64)
            * (self.config.backoff_base.powi(count as i32)) as u64;

        // 限制最大延迟
        if delay > self.config.max_delay_ms {
            delay = self.config.max_delay_ms;
        }

        // 添加随机抖动
        if self.config.jitter {
            let jitter_range = (delay as f64 * 0.1) as u64;
            let jitter = rand::thread_rng().gen_range(0..jitter_range);
            delay += jitter;
        }

        Duration::from_millis(delay)
    }

    /// 等待重连
    pub async fn wait_for_reconnect<F, Fut>(&self, mut connect_fn: F) -> bool
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<bool, ()>>,
    {
        loop {
            // 检查是否达到最大重试次数
            {
                let count = *self.retry_count.read().await;
                if self.config.max_retries > 0 && count >= self.config.max_retries {
                    warn!("已达到最大重试次数 {}，停止重连", count);
                    return false;
                }
            }

            // 计算并等待延迟
            let delay = self.calculate_delay();
            sleep(delay).await;

            // 更新重试计数
            {
                let mut count = self.retry_count.write().await;
                *count += 1;
                *self.last_attempt.write().await = Utc::now();
            }

            info!("尝试重连（第 {} 次）", self.retry_count.read().await);

            // 尝试连接
            match connect_fn().await {
                Ok(true) => {
                    info!("重连成功");
                    // 重置重试计数
                    *self.retry_count.write().await = 0;
                    return true;
                }
                Ok(false) | Err(()) => {
                    warn!("重连失败，继续重试...");
                }
            }
        }
    }

    /// 重置重试计数
    pub fn reset(&self) {
        *self.retry_count.write().await = 0;
    }

    /// 获取当前重试次数
    pub fn retry_count(&self) -> u32 {
        *self.retry_count.blocking_read()
    }
}

/// 离线消息队列
pub struct OfflineMessageQueue {
    /// 队列容量
    capacity: usize,
    /// 消息保留时间
    ttl: Duration,
    /// 待发送消息
    pending: Arc<RwLock<Vec<QueuedMessage>>>,
}

struct QueuedMessage {
    /// 消息内容
    payload: Vec<u8>,
    /// 消息类型
    message_type: u32,
    /// 入队时间
    enqueued_at: DateTime<Utc>,
    /// 重试次数
    retry_count: u32,
}

impl OfflineMessageQueue {
    pub fn new(capacity: usize, ttl_hours: u64) -> Self {
        Self {
            capacity,
            ttl: Duration::hours(ttl_hours as i64),
            pending: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 入队
    pub async fn enqueue(&self, message_type: u32, payload: Vec<u8>) -> bool {
        let mut queue = self.pending.write().await;

        if queue.len() >= self.capacity {
            warn!("离线消息队列已满，丢弃消息");
            return false;
        }

        queue.push(QueuedMessage {
            payload,
            message_type,
            enqueued_at: Utc::now(),
            retry_count: 0,
        });

        true
    }

    /// 出队
    pub async fn dequeue(&self) -> Option<QueuedMessage> {
        let mut queue = self.pending.write().await;

        // 移除过期消息
        let now = Utc::now();
        queue.retain(|msg| now.signed_duration_since(msg.enqueued_at) < self.ttl);

        // 按重试次数排序（优先发送重试次数少的）
        queue.sort_by_key(|msg| msg.retry_count);

        queue.pop()
    }

    /// 增加重试次数
    pub async fn increment_retry(&self, index: usize) {
        let mut queue = self.pending.write().await;
        if let Some(msg) = queue.get_mut(index) {
            msg.retry_count += 1;
        }
    }

    /// 清空队列
    pub async fn clear(&self) {
        self.pending.write().await.clear();
    }

    /// 获取队列长度
    pub async fn len(&self) -> usize {
        self.pending.read().await.len()
    }
}
```

### 8.3 审计日志

```rust
// crates/agent-client/src/core/audit.rs

use serde_json::Value;

/// 审计日志结构
pub struct AuditLog {
    pub timestamp: DateTime<Utc>,
    pub event_type: AuditEventType,
    pub client_id: String,
    pub user_id: String,
    pub action: String,
    pub details: Value,
    pub ip_address: Option<String>,
    pub result: AuditResult,
}

pub enum AuditEventType {
    Connection,
    Authentication,
    TaskExecution,
    FileTransfer,
    ConfigChange,
    SecurityEvent,
}

pub enum AuditResult {
    Success,
    Failure(String),
}

/// 审计日志管理器
pub struct AuditManager {
    /// 审计日志文件路径
    log_path: PathBuf,
    /// 当前日志文件
    current_file: RwLock<Option<File>>,
}

impl AuditManager {
    pub fn new(log_dir: &Path) -> Result<Self> {
        let log_path = log_dir.to_path_buf();
        std::fs::create_dir_all_all(&log_path)?;

        Ok(Self {
            log_path,
            current_file: RwLock::new(None),
        })
    }

    /// 记录审计日志
    pub async fn log(&self, audit: AuditLog) -> Result<()> {
        let timestamp = audit.timestamp.to_rfc3339();
        let event_type = format!("{:?}", audit.event_type);
        let result = match &audit.result {
            AuditResult::Success => "success".to_string(),
            AuditResult::Failure(e) => format!("failure: {}", e),
        };

        let log_line = format!(
            r#"{{"timestamp":"{}","event_type":"{}","client_id":"{}","user_id":"{}","action":"{}","details":{},"ip_address":{:?},"result":"{}"}}"#,
            timestamp,
            event_type,
            audit.client_id,
            audit.user_id,
            audit.action,
            audit.details,
            audit.ip_address,
            result
        );

        // 写入文件
        self.write_to_file(&log_line).await?;

        // 同时发送到服务器
        self.send_to_server(&audit).await?;

        Ok(())
    }

    async fn write_to_file(&self, line: &str) -> Result<()> {
        let mut file = self.current_file.write().await;
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let filename = format!("audit_{}.log", date);
        let filepath = self.log_path.join(&filename);

        let mut open_options = OpenOptions::new();
        open_options.create(true).append(true).write(true);

        if let Some(ref mut f) = *file {
            // 检查是否需要切换文件
            let current_metadata = f.metadata()?;
            if current_metadata.len() > 10 * 1024 * 1024 {  // 10MB
                drop(file);
                let mut new_file = open_options.open(&filepath)?;
                new_file.write_all(line.as_bytes())?;
                new_file.write_all(b"\n")?;
                *file = Some(new_file);
                return Ok(());
            }
        } else {
            *file = Some(open_options.open(&filepath)?);
        }

        if let Some(ref mut f) = *file {
            f.write_all(line.as_bytes())?;
            f.write_all(b"\n")?;
        }

        Ok(())
    }
}

/// 敏感信息脱敏
pub struct SensitiveDataRedactor;

impl SensitiveDataRedactor {
    /// 脱敏敏感数据
    pub fn redact(data: &str) -> String {
        let patterns = [
            (r"(?i)password\s*[:=]\s*([^\s,}]+)", "password: ******"),
            (r"(?i)token\s*[:=]\s*([^\s,}]+)", |caps| {
                let token = caps.get(1).unwrap().as_str();
                if token.len() > 8 {
                    format!("token: {}...{}", &token[..4], &token[token.len()-4..])
                } else {
                    "token: ******".to_string()
                }
            }),
            (r"(?i)api[_-]?key\s*[:=]\s*([^\s,}]+)", |caps| {
                let key = caps.get(1).unwrap().as_str();
                if key.len() > 8 {
                    format!("api_key: {}...{}", &key[..4], &key[key.len()-4..])
                } else {
                    "api_key: ******".to_string()
                }
            }),
            (r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "***.***.***.***"),
        ];

        let mut result = data.to_string();
        for pattern in &patterns {
            result = regex::Regex::new(pattern.0)
                .unwrap()
                .replace_all(&result, |caps: &regex::Captures| {
                    match pattern.1 {
                        regex::Replacer::Static(s) => s.to_string(),
                        regex::Replacer::Fn(f) => f(caps).to_string(),
                    }
                })
                .to_string();
        }

        result
    }
}
```

---

## 9. 国际化与会话管理

### 9.1 国际化基础设施

```rust
// crates/agent-client/src/i18n/mod.rs

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 支持的语言
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    ZhCN,
    EnUS,
    JaJP,
}

impl Language {
    pub fn code(&self) -> &'static str {
        match self {
            Language::ZhCN => "zh-CN",
            Language::EnUS => "en-US",
            Language::JaJP => "ja-JP",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        match code {
            "zh-CN" | "zh" => Some(Language::ZhCN),
            "en-US" | "en" => Some(Language::EnUS),
            "ja-JP" | "ja" => Some(Language::JaJP),
            _ => None,
        }
    }
}

/// 国际化资源
#[derive(Deserialize, Default)]
struct MessageResource {
    #[serde(flatten)]
    entries: HashMap<String, String>,
}

impl MessageResource {
    fn get(&self, key: &str) -> Option<&str> {
        self.entries.get(key).map(|s| s.as_str())
    }
}

/// 国际化管理器
pub struct I18nManager {
    /// 当前语言
    current_lang: RwLock<Language>,
    /// 语言资源缓存
    resources: RwLock<HashMap<Language, MessageResource>>,
    /// 资源文件目录
    resource_dir: PathBuf,
}

impl I18nManager {
    pub fn new(resource_dir: &Path) -> Self {
        Self {
            current_lang: RwLock::new(Language::ZhCN),  // 默认中文
            resources: RwLock::new(HashMap::new()),
            resource_dir: resource_dir.to_path_buf(),
        }
    }

    /// 加载语言资源
    pub async fn load_language(&self, lang: Language) -> Result<()> {
        let resource_file = self.resource_dir.join(format!("{}/messages.toml", lang.code()));

        if !resource_file.exists() {
            warn!("语言资源文件不存在: {:?}", resource_file);
            return Ok(());
        }

        let content = tokio::fs::read_to_string(&resource_file).await?;
        let resource: MessageResource = toml::from_str(&content)?;

        self.resources.write().await.insert(lang, resource);

        Ok(())
    }

    /// 设置当前语言
    pub async fn set_language(&self, lang: Language) {
        *self.current_lang.write().await = lang;
        self.load_language(lang).await.ok();
    }

    /// 获取翻译
    pub fn t(&self, key: &str) -> String {
        let lang = *self.current_lang.blocking_read();
        self.resources
            .blocking_read()
            .get(&lang)
            .and_then(|r| r.get(key))
            .map(|s| s.to_string())
            .unwrap_or_else(|| key.to_string())
    }

    /// 格式化带参数的消息
    pub fn t_with_args(&self, key: &str, args: &[(&str, &str)]) -> String {
        let mut result = self.t(key);
        for (name, value) in args {
            result = result.replace(&format!("{{{}}}", name), value);
        }
        result
    }
}

/// 区域格式化器
pub struct LocaleFormatter {
    locale: Language,
}

impl LocaleFormatter {
    pub fn new(locale: Language) -> Self {
        Self { locale }
    }

    /// 格式化日期
    pub fn format_date(&self, date: &DateTime<Utc>) -> String {
        match self.locale {
            Language::ZhCN => date.format("%Y年%m月%d日").to_string(),
            Language::JaJP => date.format("%Y年%m月%d日").to_string(),
            _ => date.format("%B %d, %Y").to_string(),
        }
    }

    /// 格式化时间
    pub fn format_time(&self, time: &DateTime<Utc>) -> String {
        match self.locale {
            Language::ZhCN | Language::JaJP => time.format("%H:%M:%S").to_string(),
            _ => time.format("%H:%M:%S").to_string(),
        }
    }

    /// 格式化文件大小
    pub fn format_file_size(&self, bytes: u64) -> String {
        const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
        let mut size = bytes as f64;
        let mut unit_index = 0;

        while size >= 1024.0 && unit_index < UNITS.len() - 1 {
            size /= 1024.0;
            unit_index += 1;
        }

        match self.locale {
            Language::ZhCN => format!("{:.1} {}", size, UNITS[unit_index]),
            _ => format!("{} {:.1} {}", size, UNITS[unit_index]),
        }
    }
}
```

### 9.2 会话管理

```rust
// crates/agent-client/src/core/session.rs

/// Agent 任务会话状态
pub enum AgentSessionState {
    /// 空闲
    Idle,
    /// 等待中
    Pending {
        received_at: DateTime<Utc>,
        task_id: String,
    },
    /// 执行中
    Active {
        started_at: DateTime<Utc>,
        session_id: String,
        task_id: String,
    },
    /// 正在停止
    Terminating {
        started_at: DateTime<Utc>,
        reason: String,
    },
    /// 出错
    Error {
        error_type: ErrorType,
        message: String,
    },
}

pub enum ErrorType {
    Timeout,
    PermissionDenied,
    WorkerStopped,
    Unknown,
}

/// 会话管理器
pub struct SessionManager {
    /// 任务超时
    task_timeout: Duration,
    /// 空闲超时
    idle_timeout: Duration,
    /// 最大并发任务数
    max_concurrent: usize,
    /// 活跃会话
    active_sessions: DashMap<String, AgentSessionState>,
    /// 等待队列
    waiting_queue: Arc<RwLock<Vec<TaskRequest>>>,
}

impl SessionManager {
    pub fn new(
        task_timeout_mins: u64,
        idle_timeout_mins: u64,
        max_concurrent: usize,
    ) -> Self {
        Self {
            task_timeout: Duration::minutes(task_timeout_mins as i64),
            idle_timeout: Duration::minutes(idle_timeout_mins as i64),
            max_concurrent,
            active_sessions: DashMap::new(),
            waiting_queue: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 提交任务
    pub async fn submit(&self, request: TaskRequest) -> Result<SubmissionResult> {
        let running_count = self.active_sessions
            .iter()
            .filter(|(_, state)| matches!(state, AgentSessionState::Active { .. }))
            .count();

        if running_count >= self.max_concurrent {
            self.waiting_queue.write().await.push(request);
            return Ok(SubmissionResult::Queued);
        }

        self.start_session(request).await?;
        Ok(SubmissionResult::Accepted)
    }

    /// 开始会话
    async fn start_session(&self, request: TaskRequest) -> Result<()> {
        let session_id = self.generate_session_id();
        let state = AgentSessionState::Active {
            started_at: Utc::now(),
            session_id: session_id.clone(),
            task_id: request.task_id.clone(),
        };

        self.active_sessions.insert(session_id.clone(), state);

        // TODO: 启动实际的任务执行
        Ok(())
    }

    fn generate_session_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }

    /// 完成任务
    pub fn complete_session(&self, session_id: &str) {
        self.active_sessions.remove(session_id);

        // 检查等待队列
        let next = self.waiting_queue.write().await.pop();
        if let Some(request) = next {
            tokio::spawn(async move {
                // self.start_session(request).await?;
                Ok(())
            });
        }
    }

    /// 检查超时
    pub fn check_timeouts(&self) -> Vec<String> {
        let mut timed_out = Vec::new();
        let now = Utc::now();

        for (session_id, state) in self.active_sessions.iter() {
            if let AgentSessionState::Active { started_at, .. } = state {
                if now.signed_duration_since(*started_at) > self.task_timeout {
                    timed_out.push(session_id.clone());
                }
            }
        }

        timed_out
    }
}

pub enum SubmissionResult {
    Accepted,
    Queued,
}

pub struct TaskRequest {
    pub task_id: String,
    pub prompt: String,
    pub attachments: Vec<String>,
    pub timeout: Duration,
}
```

---

## 10. 系统集成

### 10.1 全局快捷键

```rust
// crates/agent-client/src/system/shortcuts.rs

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 快捷键定义
pub struct Shortcut {
    pub modifiers: Vec<ModifierKey>,
    pub key_code: KeyCode,
}

pub enum ModifierKey {
    Ctrl,
    Alt,
    Shift,
    Cmd,  // macOS Command, Windows Meta
}

pub enum KeyCode {
    A, B, C, D, E, F, G, H, I, J, K, L, M,
    N, O, P, Q, R, S, T, U, V, W, X, Y, Z,
    Function(u8),  // F1-F12
    Escape,
    Enter,
    Space,
}

/// 全局快捷键管理器
pub struct GlobalShortcutManager {
    /// 快捷键注册表
    shortcuts: Arc<RwLock<HashMap<Shortcut, ShortcutHandler>>>,
    /// 平台特定实现
    platform_impl: Box<dyn PlatformShortcut + Send + Sync>,
}

impl GlobalShortcutManager {
    pub fn new() -> Result<Self> {
        Ok(Self {
            shortcuts: Arc::new(RwLock::new(HashMap::new())),
            platform_impl: create_platform_impl()?,
        })
    }

    /// 注册快捷键
    pub fn register(
        &self,
        shortcut: Shortcut,
        handler: ShortcutHandler,
    ) -> Result<()> {
        self.platform_impl.register(&shortcut)?;
        self.shortcuts.write().await.insert(shortcut, handler);
        Ok(())
    }

    /// 取消注册
    pub fn unregister(&self, shortcut: &Shortcut) -> Result<()> {
        self.platform_impl.unregister(shortcut)?;
        self.shortcuts.write().await.remove(shortcut);
        Ok(())
    }
}

/// 默认快捷键
pub const DEFAULT_SHORTCUTS: &[(Shortcut, &str)] = &[
    (
        Shortcut {
            modifiers: vec![ModifierKey::Ctrl, ModifierKey::Alt],
            key_code: KeyCode::S,
        },
        "show_window",
    ),
    (
        Shortcut {
            modifiers: vec![ModifierKey::Ctrl, ModifierKey::Alt],
            key_code: KeyCode::H,
        },
        "hide_window",
    ),
    (
        Shortcut {
            modifiers: vec![ModifierKey::Ctrl, ModifierKey::Alt],
            key_code: KeyCode::Q,
        },
        "quick_connect",
    ),
];
```

### 10.2 系统通知

```rust
// crates/agent-client/src/system/notification.rs

use std::path::PathBuf;

/// 系统通知管理器
pub struct SystemNotificationManager {
    /// 平台特定实现
    platform_impl: Box<dyn PlatformNotification + Send + Sync>,
}

impl SystemNotificationManager {
    pub fn new() -> Result<Self> {
        Ok(Self {
            platform_impl: create_platform_notification()?,
        })
    }

    /// 发送通知
    pub async fn send(&self, request: NotificationRequest) -> Result<NotificationId> {
        self.platform_impl.send(request).await
    }

    /// 取消通知
    pub async fn cancel(&self, id: NotificationId) {
        self.platform_impl.cancel(id).await;
    }
}

pub struct NotificationRequest {
    pub title: String,
    pub body: String,
    pub icon: Option<PathBuf>,
    pub urgency: NotificationUrgency,
    pub timeout: Duration,
    pub actions: Vec<NotificationAction>,
}

pub enum NotificationUrgency {
    Low,
    Normal,
    Critical,
}

pub struct NotificationAction {
    pub id: String,
    pub label: String,
}

/// 通知 ID 类型
pub struct NotificationId(u32);
```

### 10.3 系统事件处理

```rust
// crates/agent-client/src/system/events.rs

/// 系统事件监听器
#[async_trait::async_trait]
pub trait SystemEventListener: Send + Sync {
    async fn on_shutdown(&self);
    async fn on_sleep(&self);
    async fn on_wake(&self);
    async fn on_screen_lock(&self);
    async fn on_screen_unlock(&self);
    async fn on_network_change(&self, status: NetworkStatus);
}

/// 系统事件管理器
pub struct SystemEventManager {
    /// 事件监听器
    listeners: Arc<RwLock<Vec<Arc<dyn SystemEventListener>>>>>,
}

impl SystemEventManager {
    pub fn new() -> Self {
        Self {
            listeners: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 添加监听器
    pub fn add_listener(&self, listener: Arc<dyn SystemEventListener>) {
        self.listeners.write().push(listener);
    }

    /// 广播关机事件
    pub async fn broadcast_shutdown(&self) {
        for listener in self.listeners.read().iter() {
            listener.on_shutdown().await;
        }
    }

    /// 广播睡眠事件
    pub async fn broadcast_sleep(&self) {
        for listener in self.listeners.read().iter() {
            listener.on_sleep().await;
        }
    }

    /// 广播唤醒事件
    pub async fn broadcast_wake(&self) {
        for listener in self.listeners.read().iter() {
            listener.on_wake().await;
        }
    }
}
```

---

## 11. 验收标准

### P0 功能（必须实现）

| 功能 | 验收标准 |
|------|----------|
| 跨平台运行 | macOS/Windows/Linux 均可编译运行 |
| 系统托盘 | 右下角显示图标，左键显示窗口 |
| 开机自启动 | 可在设置中开启/关闭 |
| 连接 data-server | 成功连接到 hbbs/hbbr，显示 P2P/Relay 状态 |
| 显示客户端 ID | 客户端信息 Tab 显示 8 位 ID |
| 显示/修改密码 | 可切换显示/隐藏，支持修改 |
| 服务器配置 | 可配置 hbbs/hbbr/api 地址，保存后重连 |
| Node.js 自动安装 | 检测系统 Node.js，未安装时自动下载 |
| 权限检测 | 显示各权限状态，提供授权入口 |

### P1 功能（应该实现）

| 功能 | 验收标准 |
|------|----------|
| Agent 任务执行 | 接收任务，执行并返回结果 |
| 进度实时回传 | 任务执行时实时显示输出 |
| 状态栏显示 | 连接状态、Agent 状态、依赖状态 |
| 文件传输 | 支持发送/接收文件 |
| 日志导出 | 可导出日志文件（脱敏） |
| 远程桌面 | 可查看远程桌面画面 |

### P2 功能（可选实现）

| 功能 | 验收标准 |
|------|----------|
| 客户端升级 | 检查更新，下载并安装 |
| 聊天界面 | 完整的聊天 UI |
| 关于界面 | 版本信息完整，链接可点击 |
