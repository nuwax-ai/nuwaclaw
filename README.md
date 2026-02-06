# nuwax-agent

[English](README_EN.md) | 简体中文

[![CI](https://img.shields.io/github/actions/workflow/status/soddygo/nuwax-agent/ci.yml?branch=main)](https://github.com/soddygo/nuwax-agent/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

跨平台 Agent 客户端，支持远程桌面控制和 AI Agent 任务执行。基于 [gpui](https://github.com/zed-industries/zed) 构建原生 UI，通过 [nuwax-rustdesk](https://github.com/rustdesk/rustdesk) 实现安全的 P2P/Relay 通信。

## 功能特性

### 核心功能

- **远程连接管理** - 通过 P2P 或中继服务器与管理端建立安全连接
- **AI Agent 任务执行** - 接收并执行来自管理端的 AI Agent 任务
- **依赖管理** - 自动检测和安装 Node.js、npm 等运行时依赖
- **安全通信** - 基于 RustDesk 协议的端到端加密通信

### UI 功能

- **系统托盘** - 后台运行，托盘图标快速操作
- **客户端信息** - 显示客户端 ID 和连接密码
- **设置管理** - 服务器配置、安全设置、外观设置
- **依赖状态** - 可视化依赖检测和安装进度
- **远程桌面** - 远程桌面查看和控制（开发中）
- **聊天通信** - 与管理端的即时消息（开发中）

### 平台支持

| 平台 | 架构 | 状态 |
|------|------|------|
| macOS | arm64, x86_64 | ✅ 支持 |
| Windows | x86_64 | ✅ 支持 |
| Linux | x86_64, arm64 | ✅ 支持 |

## 项目架构

```
nuwax-agent/
├── crates/
│   ├── nuwax-platform/     # 跨平台抽象层（路径、自动启动、托盘、配置）
│   ├── nuwax-agent-core/  # 核心业务逻辑（无 UI 依赖）
│   ├── agent-gpui-client/ # GPUI 客户端实现
│   ├── agent-tauri-client/ # Tauri 客户端实现
│   ├── agent-protocol/     # 通信协议定义
│   ├── agent-server-admin/ # 管理端 API 服务
│   └── data-server/        # 信令/中继服务器封装
├── vendors/
│   ├── nuwax-rustdesk/     # RustDesk 通信库
│   ├── gpui-component/     # UI 组件库
│   └── ...
└── tests/
    ├── e2e/                # 端到端测试
    └── integration/        # 集成测试
```

## 跨平台抽象层 (nuwax-platform)

`nuwax-platform` crate 提供统一的跨平台能力抽象，是整个项目跨平台兼容性的基础。

### 主要模块

| 模块 | 功能 | 支持平台 |
|------|------|---------|
| `paths` | 跨平台路径抽象（配置/日志/缓存/数据） | macOS/Windows/Linux |
| `autostart` | 开机自启动管理 | macOS/Windows/Linux |
| `tray` | 系统托盘图标和菜单 | macOS/Windows/Linux |
| `config` | 统一配置管理（TOML 格式） | macOS/Windows/Linux |

### 平台能力检测

```rust
use nuwax_platform::{Platform, check_capability, PlatformCapability, get_all_capabilities};

// 获取当前平台
let platform = nuwax_platform::current_platform();

// 检查特定能力
let tray_status = nuwax_platform::check_capability(PlatformCapability::Tray);

// 获取所有能力状态
let capabilities = nuwax_platform::get_all_capabilities();
```

### 使用示例

```rust
use nuwax_platform::{paths, autostart, tray, config};

// 使用路径抽象
let config_path = paths::get_path(paths::PathType::Config)?;

// 使用自动启动
let autostart = autostart::PlatformAutostart::new();
autostart.enable()?;

// 使用托盘
let tray_manager = tray::PlatformTray::new()?;

// 使用配置管理
let config_manager = config::ConfigManager::new()?;
```

## 快速开始

### 环境要求

- Rust 1.75+
- Node.js 18+ (可选，客户端会自动安装)
- vcpkg (用于 nuwax-rustdesk 依赖)

### 安装 vcpkg 依赖

推荐使用 Makefile 安装（默认安装到 `$HOME/vcpkg`）。安装完成后会自动在项目根创建软链接 `vcpkg`，之后 `make build` 与 `cargo build` 均可直接使用：

```bash
make setup-vcpkg
```

本仓库通过 `.cargo/config.toml` 将构建时的 VCPKG_ROOT 设为项目根下的 `vcpkg`；若你已自行设置环境变量 VCPKG_ROOT，则不会被覆盖。

也可手动克隆并安装依赖（将路径替换为你的 vcpkg 目录，并在项目根创建软链接 `vcpkg` 指向该目录）：

```bash
git clone https://github.com/microsoft/vcpkg /path/to/vcpkg
cd /path/to/vcpkg && ./bootstrap-vcpkg.sh
# macOS: ./vcpkg install libvpx libyuv opus aom --triplet arm64-osx 或 x64-osx
```

### 编译运行

```bash
# 方式一：使用 make（自动设置 VCPKG_ROOT）
make build
make run

# 方式二：直接使用 cargo（需已执行 ln -s $HOME/vcpkg vcpkg 或已设置 export VCPKG_ROOT=...）
cargo build -p nuwax-gpui-agent
cargo run -p nuwax-gpui-agent
cargo test -p nuwax-gpui-agent
```

### 打包发布

```bash
# 安装 cargo-packager
cargo install cargo-packager

# macOS 打包 (.dmg)
cargo packager --release

# 详见 .github/workflows/release.yml
```

## 配置说明

配置文件位于：
- macOS: `~/Library/Application Support/nuwax-agent/config.toml`
- Windows: `%APPDATA%\nuwax-agent\config.toml`
- Linux: `~/.config/nuwax-agent/config.toml`

```toml
[server]
# 信令服务器地址
hbbs = "your-server:21116"
# 中继服务器地址
hbbr = "your-server:21117"

[security]
# 连接密码（加密存储）
password_hash = "..."

[general]
# 开机自启动
auto_launch = true
# 语言设置
language = "zh-CN"
# 主题模式: light, dark, system
theme = "system"
```

## Feature Flags

| Feature | 说明 | 默认 |
|---------|------|------|
| `tray` | 系统托盘支持 | ✅ |
| `auto-launch` | 开机自启动 | ✅ |
| `dependency-management` | 依赖自动安装 | ✅ |
| `remote-desktop` | 远程桌面功能 | ❌ |
| `chat-ui` | 聊天界面 | ❌ |
| `file-transfer` | 文件传输 | ❌ |
| `dev-mode` | 开发者日志 | ❌ |

```bash
# 启用所有功能
cargo build -p nuwax-agent --all-features

# 仅启用特定功能
cargo build -p nuwax-agent --features "remote-desktop,chat-ui"
```

## 开发指南

### 目录结构

```
crates/nuwax-platform/src/
├── lib.rs              # 模块入口和平台枚举
├── paths/mod.rs        # 跨平台路径抽象
├── autostart/mod.rs    # 开机自启动管理
├── tray/mod.rs         # 系统托盘抽象
└── config/mod.rs       # 统一配置管理

crates/nuwax-agent-core/src/
├── lib.rs              # 核心库导出
├── config.rs           # 配置管理（使用 nuwax-platform）
├── auto_launch.rs      # 自动启动（使用 nuwax-platform）
├── dependency/          # 依赖检测和安装
├── connection/         # 连接管理
├── platform/           # 平台特定代码
├── permissions/        # 权限管理（使用 system-permissions）
├── agent.rs            # Agent 任务管理
└── ...

crates/agent-gpui-client/src/
├── main.rs             # 程序入口
├── app.rs              # 应用状态管理
├── lib.rs              # 库导出
├── components/          # UI 组件
│   ├── root.rs         # 根组件
│   ├── status_bar.rs   # 状态栏
│   └── ...
├── tray/               # 托盘（使用 nuwax-platform）
└── ...
```

### 运行测试

```bash
# 单元测试
cargo test -p nuwax-agent

# 集成测试 (需要 data-server 运行)
cargo test --test communication_test -- --ignored

# 代码检查
cargo clippy -p nuwax-agent
```

### 调试模式

```bash
# 启用详细日志
RUST_LOG=debug cargo run -p nuwax-agent

# 启用开发模式
cargo run -p nuwax-agent --features dev-mode
```

## 通信协议

客户端与管理端通过 data-server (基于 RustDesk 协议) 通信：

```
┌─────────────┐     P2P/Relay      ┌─────────────┐
│   Client    │◄──────────────────►│    Admin    │
│ (agent-cli) │                    │  (server)   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  Register/Heartbeat              │
       ▼                                  ▼
┌─────────────────────────────────────────────────┐
│              data-server (hbbs/hbbr)            │
│         信令服务 (21116) + 中继服务 (21117)      │
└─────────────────────────────────────────────────┘
```

### 消息类型

- `Handshake` - 握手协议，协商版本和能力
- `AgentTask` - Agent 任务请求/响应
- `FileTransfer` - 文件传输
- `Chat` - 聊天消息
- `Heartbeat` - 心跳保活

## 安全机制

- **密码加密** - 使用 AES-GCM 加密存储，密钥由机器 ID 派生
- **通信加密** - 基于 RustDesk 的端到端加密
- **SHA256 校验** - 升级包完整性验证
- **权限文件** - 敏感文件设置 0600 权限 (Unix)

## 许可证

[Apache License 2.0](LICENSE)

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

详见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 相关项目

- [gpui](https://github.com/zed-industries/zed) - GPU 加速 UI 框架
- [RustDesk](https://github.com/rustdesk/rustdesk) - 开源远程桌面
- [gpui-component](https://github.com/longbridge/gpui-component) - gpui 组件库
