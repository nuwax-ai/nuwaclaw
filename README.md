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
│   ├── agent-client/       # 客户端主程序
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
crates/agent-client/src/
├── main.rs              # 程序入口
├── app.rs               # 应用状态管理
├── lib.rs               # 库导出
├── components/          # UI 组件
│   ├── root.rs          # 根组件
│   ├── status_bar.rs    # 状态栏
│   ├── client_info.rs   # 客户端信息
│   ├── settings.rs      # 设置界面
│   ├── dependency_manager.rs  # 依赖管理
│   ├── remote_desktop.rs      # 远程桌面
│   ├── chat.rs          # 聊天界面
│   └── about.rs         # 关于页面
├── core/                # 核心逻辑
│   ├── connection/      # 连接管理
│   ├── dependency/      # 依赖检测/安装
│   ├── platform/        # 平台适配
│   ├── permissions/     # 权限管理
│   ├── agent.rs         # Agent 任务管理
│   ├── business_channel.rs  # 业务通道
│   ├── crypto.rs        # 加密工具
│   └── upgrade.rs       # 升级管理
├── tray/                # 系统托盘
├── i18n/                # 国际化
├── message/             # 消息处理
└── utils/               # 工具函数
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
