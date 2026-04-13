# nuwax-agent

[English](README_EN.md) | 简体中文

[![CI](https://img.shields.io/github/actions/workflow/status/soddygo/nuwax-agent/ci.yml?branch=main)](https://github.com/soddygo/nuwax-agent/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

跨平台 Agent 客户端，支持远程桌面控制和 AI Agent 任务执行。基于 Electron 构建桌面应用。

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
│   ├── agent-electron-client/  # Electron 客户端
│   ├── agent-gui-server/      # GUI Agent 服务 (Node.js)
│   └── nuwax-mcp-stdio-proxy/ # MCP 协议代理 (Node.js)
├── docs/                      # 文档
├── scripts/                   # 构建脚本
└── tests/                     # 测试
```

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 9+

### 安装依赖

```bash
pnpm install
```

### 编译运行

```bash
# 准备依赖（Node.js、uv、lanproxy 等）
make electron-prepare

# 开发模式运行
make electron-dev

# 打包发布
make electron-bundle
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

## 功能特性

| 功能 | 说明 |
|------|------|
| **系统托盘** | 后台运行，托盘图标快速操作 |
| **AI Agent** | 支持 claude-code 和 nuwaxcode 引擎 |
| **MCP 集成** | MCP 协议支持 |
| **IM 集成** | 支持 Telegram、Discord、钉钉、飞书 |
| **依赖管理** | 自动检测和安装运行时依赖 |

## 开发指南

### 目录结构

```
crates/agent-electron-client/
├── src/
│   ├── main/            # Electron 主进程
│   │   ├── main.ts     # 入口
│   │   └── services/   # 服务
│   ├── preload/        # 预加载脚本
│   ├── renderer/       # React 渲染进程
│   └── shared/        # 共享类型
└── resources/         # 资源文件（Node.js、uv 等）
```

### 调试模式

```bash
# 开发模式运行（详细日志）
make electron-dev
```

## 通信协议

客户端与管理端通过 WebSocket 连接进行通信：

```
┌─────────────┐      WebSocket       ┌─────────────┐
│   Client    │◄───────────────────►│   Admin     │
│  (Electron) │                      │   Server    │
└─────────────┘                      └─────────────┘
```

### 消息类型

- `Handshake` - 握手协议，协商版本和能力
- `AgentTask` - Agent 任务请求/响应
- `FileTransfer` - 文件传输
- `Chat` - 聊天消息
- `Heartbeat` - 心跳保活

## 安全机制

- **密码加密** - 使用 AES-GCM 加密存储
- **通信加密** - WebSocket TLS 加密
- **权限控制** - 敏感操作需要确认

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

- [Electron](https://electronjs.org/) - 跨平台桌面应用框架
- [React](https://react.dev/) - UI 库
- [MCP](https://modelcontextprotocol.io/) - 模型上下文协议
