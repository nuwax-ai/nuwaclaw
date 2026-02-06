# nuwax-agent

[English](README_EN.md) | 简体中文

[![CI](https://img.shields.io/github/actions/workflow/status/soddygo/nuwax-agent/ci.yml?branch=main)](https://github.com/soddygo/nuwax-agent/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

跨平台 Agent 客户端，支持远程桌面控制和 AI Agent 任务执行。基于 [Tauri 2.0](https://tauri.app/) 构建原生 UI，通过 [nuwax-rustdesk](https://github.com/rustdesk/rustdesk) 实现安全的 P2P/Relay 通信。

## 功能特性

### 核心功能

- **远程连接管理** - 通过 P2P 或中继服务器与管理端建立安全连接
- **AI Agent 任务执行** - 接收并执行来自管理端的 AI Agent 任务
- **依赖管理** - 自动检测和安装 Node.js、npm 等运行时依赖
- **安全通信** - 基于 RustDesk 协议的端到端加密通信

### UI 功能

- **系统托盘** - 后台运行，托盘图标快速操作
- **客户端信息** - 显示客户端 ID 和连接密码
- **设置管理** - 服务器配置，安全设置，外观设置
- **依赖状态** - 可视化依赖检测和安装进度
- **权限管理** - 系统权限状态查看和引导
- **日志查看** - 实时日志和统计分析

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
│   ├── nuwax-platform/      # 跨平台抽象层（路径、自动启动、托盘、配置）
│   ├── nuwax-agent-core/   # 核心业务逻辑（无 UI 依赖）
│   ├── agent-tauri-client/ # Tauri 客户端实现（React 18 + TypeScript）
│   ├── agent-protocol/     # 通信协议定义
│   ├── agent-server-admin/ # 管理端 API 服务
│   └── data-server/       # 信令/中继服务器封装
├── vendors/
│   ├── nuwax-rustdesk/    # RustDesk 通信库
│   └── ...
└── tests/
    ├── e2e/              # 端到端测试
    └── integration/       # 集成测试
```

## 技术栈

### 客户端 (agent-tauri-client)

- **前端框架**: React 18 + TypeScript
- **UI 组件库**: Ant Design 5
- **桌面框架**: Tauri 2.0
- **包管理器**: pnpm (前端) + cargo (Rust)

### 核心库 (nuwax-agent-core)

- **异步运行时**: Tokio
- **日志**: Tracing
- **序列化**: Serde (JSON, TOML)

## 快速开始

### 环境要求

- Rust 1.75+
- Node.js 18+
- pnpm (用于前端依赖)
- Tauri CLI (`cargo install tauri-cli`)

### 安装依赖

```bash
# 安装 Rust 依赖
cargo fetch

# 安装前端依赖
cd crates/agent-tauri-client
pnpm install
```

### 开发运行

```bash
# 方法1：使用 Makefile（推荐）
unset CI && make tauri-dev

# 方法2：手动运行
cd crates/agent-tauri-client/src-tauri
unset CI && cargo tauri dev
```

### 打包发布

```bash
# 打包当前平台
unset CI && make tauri-bundle

# 查看产物
ls -la target/release/bundle/
```

## 跨平台抽象层 (nuwax-platform)

`nuwax-platform` crate 提供统一的跨平台能力抽象，是整个项目跨平台兼容性的基础。

### 主要模块

| 模块 | 功能 | 支持平台 |
|------|------|---------|
| `paths` | 跨平台路径抽象（配置/日志/缓存/数据） | macOS/Windows/Linux |
| `autostart` | 开机自启动管理 | macOS/Windows/Linux |
| `tray` | 系统托盘图标和菜单类型 | macOS/Windows/Linux |
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

// 使用托盘类型
let menu = tray::TrayMenu::standard();

// 使用配置管理
let config_manager = config::ConfigManager::new()?;
```

## 配置说明

配置文件位于：
- macOS: `~/Library/Application Support/nuwax-agent/config.toml`
- Windows: `%APPDATA%\nuwax-agent\config.toml`
- Linux: `~/.config/nuwax-agent/config.toml`

```toml
[server]
hbbs = "your-server:21116"
hbbr = "your-server:21117"

[security]
password_hash = "..."

[general]
auto_launch = true
language = "zh-CN"
theme = "system"
```

## Feature Flags

| Feature | 说明 | 默认 |
|---------|------|------|
| `auto-launch` | 开机自启动 | ✅ |
| `dependency-management` | 依赖自动安装 | ✅ |
| `http-server` | 内置 HTTP 服务 | ✅ |
| `remote-desktop` | 远程桌面功能 | ❌ |
| `chat-ui` | 聊天界面 | ❌ |
| `file-transfer` | 文件传输 | ❌ |
| `dev-mode` | 开发者日志 | ❌ |

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
├── config.rs           # 配置管理
├── auto_launch.rs      # 自动启动
├── dependency/         # 依赖检测和安装
├── connection/         # 连接管理
├── platform/           # 平台特定代码
├── permissions/         # 权限管理
├── agent/              # Agent 任务管理
└── ...

crates/agent-tauri-client/
├── src/                # React 前端源码
│   ├── components/      # UI 组件
│   ├── pages/         # 页面
│   └── services/       # 服务层
└── src-tauri/         # Tauri/Rust 后端
    └── src/
        └── lib.rs     # Tauri 命令实现
```

### 添加新的 Tauri 命令

1. 在 `src-tauri/src/lib.rs` 中定义命令函数
2. 添加 `#[tauri::command]` 宏
3. 在 `invoke_handler` 中注册

```rust
#[tauri::command]
async fn my_command(state: State<'_, MyState>, param: String) -> Result<String, String> {
    // 命令逻辑
    Ok("result".to_string())
}

// 注册
.invoke_handler(tauri::generate_handler![my_command, ...])
```

### 运行测试

```bash
# 单元测试
cargo test -p nuwax-agent-core
cargo test -p nuwax-platform

# 集成测试
cargo test -p nuwax-agent-core --test integration

# 代码检查
cargo clippy -p nuwax-agent-core
cargo clippy -p nuwax-platform
```

### 调试模式

```bash
# 启用详细日志
TAURI_DEBUG=1 cargo tauri dev

# Rust 日志
RUST_LOG=debug cargo tauri dev
```

## 通信协议

客户端与管理端通过 data-server (基于 RustDesk 协议) 通信：

```
┌─────────────┐     P2P/Relay      ┌─────────────┐
│   Client    │◄──────────────────►│    Admin    │
│(agent-tauri)│                    │  (server)   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  Register/Heartbeat               │
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
2. 创建功能分支 (`git checkout -b feature3. 提交更改 (`git commit -m 'Add/amazing-feature`)
 amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

详见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 相关项目

- [Tauri](https://tauri.app/) - 桌面应用框架
- [RustDesk](https://github.com/rustdesk/rustdesk) - 开源远程桌面
- [React](https://reactjs.org/) - 前端 UI 框架
- [Ant Design](https://ant.design/) - React UI 组件库
