# NuwaClaw

[English](README_EN.md) | 简体中文

[![CI](https://img.shields.io/github/actions/workflow/status/soddygo/nuwax-agent/ci.yml?branch=main)](https://github.com/soddygo/nuwax-agent/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

多引擎 AI 助手桌面客户端，基于 ACP (Agent Client Protocol) 协议，支持任何兼容 ACP 的 Agent 引擎，提供跨平台的本地 AI Agent 执行能力。

## 核心特性

### 多引擎支持

NuwaClaw 采用 [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) 协议与 Agent 引擎通信，支持任何实现了 ACP 协议的 Agent：

| 引擎 | 说明 |
|------|------|
| **Claude Code** | Anthropic 官方 CLI Agent，推荐使用 ⭐ |
| **Codex CLI** | OpenAI 的代码 Agent |
| **Gemini CLI** | Google 的 AI Agent |
| **GitHub Copilot** | GitHub 的 AI 编程助手 |
| **Cline** | 开源自主编程 Agent |
| **Cursor** | Cursor IDE 的 Agent 能力 |
| **Goose** | Block 开源的 AI Agent |
| **Qwen Code** | 阿里通义千问代码 Agent |
| **Junie** | JetBrains 的 AI Agent |
| **OpenCode** | 开源代码 Agent |
| **Nuwaxcode** | 基于 OpenCode 修改的 Agent 引擎 |
| **更多...** | [查看完整列表](https://agentclientprotocol.com/get-started/agents) |

> **ACP 协议**: Agent Client Protocol，标准化编辑器/IDE 与 AI Agent 之间的通信协议，基于 NDJSON 格式。类似 LSP 之于语言服务，ACP 让你可以将任何 ACP 兼容的 Agent 接入到任何支持的客户端。

- 引擎隔离运行，独立环境配置
- 动态切换引擎，无需重启应用
- 避免厂商锁定，自由选择 Agent

### 跨平台客户端
- **Electron 客户端** - 基于 Electron + React 的桌面客户端

### MCP 协议支持
- 动态 MCP 服务器管理
- 多协议支持 (stdio, SSE, Streamable HTTP)
- 弹性连接与自动重连

### 其他特性
- **持久化存储** - SQLite 本地存储
- **系统托盘** - 后台运行，快速操作

## 项目架构

```
nuwax-agent-client/
├── crates/
│   ├── agent-electron-client/   # Electron 客户端 (主要开发)
│   ├── nuwax-mcp-stdio-proxy/   # MCP 协议聚合代理
│   ├── agent-gpui-client/       # GPUI 客户端 (实验性)
│   ├── agent-server-admin/      # 管理端 API 服务
│   ├── agent-protocol/          # 通信协议定义
│   ├── system-permissions/      # 系统权限管理
│   └── nuwax-agent-core/        # 核心逻辑 (Rust)
└── vendors/                     # 第三方依赖
```

## 快速开始

### Electron 客户端

```bash
# 方式一：使用 Makefile（推荐，项目根目录执行）
make electron-dev     # 开发模式
make electron-build   # 构建
make electron-dist    # 打包

# 方式二：进入目录执行 npm 命令
cd crates/agent-electron-client

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 打包
npm run dist:mac      # macOS
npm run dist:win      # Windows
npm run dist:linux    # Linux
```

### MCP 代理服务

```bash
cd crates/nuwax-mcp-stdio-proxy

# 安装依赖
npm install

# 构建
npm run build

# 运行 (stdio 聚合模式)
nuwax-mcp-stdio-proxy --config '{"mcpServers":{...}}'

# 运行 (协议转换模式)
nuwax-mcp-stdio-proxy convert http://remote-mcp-server/sse

# 运行 (持久化桥接模式)
nuwax-mcp-stdio-proxy proxy --port 18099 --config '{"mcpServers":{...}}'
```

## 平台支持

| 平台 | 架构 | 状态 |
|------|------|:----:|
| macOS | arm64, x86_64 | ✅ |
| Windows | x86_64, arm64 | ✅ |
| Linux | x86_64, arm64 | ✅ |

## Electron 客户端详解

### 技术栈
- **主进程**: Electron + TypeScript
- **渲染进程**: React 18 + Ant Design
- **存储**: SQLite (better-sqlite3)
- **构建**: Vite + electron-builder

### 核心服务

| 服务 | 说明 |
|------|------|
| Unified Agent | 统一的 ACP 引擎管理 |
| Engine Manager | 引擎生命周期管理 |
| MCP | MCP 服务器管理 |
| Dependencies | 依赖包管理 |
| Permissions | 权限控制 |

### 数据存储

```
~/.nuwaclaw/
├── engines/           # Agent 引擎
├── workspaces/        # 会话工作空间
├── node_modules/      # 本地 npm 包
│   ├── .bin/         # 可执行文件
│   └── mcp-servers/  # MCP 服务器
├── bin/               # 应用二进制
├── logs/              # 日志文件
│   ├── main.log      # 主进程日志
│   └── mcp-proxy.log # MCP 代理日志
└── nuwaclaw.db        # SQLite 数据库
```

### IPC 通道

| 分类 | 通道 |
|------|------|
| Session | `session:list`, `session:create`, `session:delete` |
| Message | `message:list`, `message:add` |
| Settings | `settings:get`, `settings:set` |
| Agent | `agent:init`, `agent:destroy`, `agent:prompt` |
| MCP | `mcp:install`, `mcp:uninstall`, `mcp:start`, `mcp:stop` |

## MCP 代理服务详解

`nuwax-mcp-stdio-proxy` 是一个 MCP 协议聚合代理，解决多 MCP 服务器集成时的生命周期管理问题。

### 运行模式

| 模式 | 用途 | 命令 |
|------|------|------|
| **stdio** | 聚合多个 MCP 服务器为单个 stdio 接口 | `nuwax-mcp-stdio-proxy --config '...'` |
| **convert** | 将远程 MCP 服务转换为本地 stdio | `nuwax-mcp-stdio-proxy convert <url>` |
| **proxy** | 持久化桥接，预先启动并暴露 HTTP 接口 | `nuwax-mcp-stdio-proxy proxy --port 18099` |

### 核心特性
- **就绪状态检测**: 阻塞等待 MCP 服务器就绪
- **弹性传输**: 心跳检测、指数退避重连、请求队列
- **集中清理**: 优雅终止所有子进程

### 弹性传输参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `pingIntervalMs` | 20000 | 心跳间隔 |
| `maxConsecutiveFailures` | 3 | 连续失败阈值 |
| `maxReconnectDelayMs` | 60000 | 重连延迟上限 |
| `maxQueueSize` | 100 | 请求队列容量 |

## 配置说明

### Electron 客户端配置

首次运行时通过设置向导配置：
1. 输入 Anthropic API Key
2. 选择默认模型
3. 配置 MCP 服务器

敏感配置存储在 SQLite 数据库中，不在代码中硬编码。

### MCP 服务器配置示例

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "github": {
      "url": "https://api.github.com/mcp"
    }
  }
}
```

## 开发指南

### 目录结构

```
crates/agent-electron-client/
├── src/
│   ├── main/              # 主进程
│   │   ├── main.ts        # 入口
│   │   ├── preload.ts     # 预加载脚本
│   │   ├── ipc/           # IPC 处理器
│   │   └── services/      # 主进程服务
│   ├── renderer/          # 渲染进程
│   │   ├── main.tsx       # React 入口
│   │   ├── App.tsx        # 主组件
│   │   ├── components/    # React 组件
│   │   └── services/      # 渲染进程服务
│   └── shared/            # 共享代码
├── resources/             # 打包资源
├── scripts/               # 构建脚本
└── package.json
```

### 运行测试

```bash
# Electron 客户端
cd crates/agent-electron-client
npm run test

# MCP 代理
cd crates/nuwax-mcp-stdio-proxy
npm run test:run
npm run test:coverage
```

### 调试模式

```bash
# 启用详细日志
RUST_LOG=debug npm run dev
```

## GitHub Actions

### CI/CD 工作流

| 工作流 | 触发条件 | 说明 |
|--------|----------|------|
| `ci-electron.yml` | `crates/agent-electron-client/**` 变更 | Electron 测试构建 |
| `release-electron.yml` | 推送 `electron-v*` tag | Electron 发布构建 |

### 发布流程

```bash
# Electron 发布
git tag electron-v0.9.0
git push origin electron-v0.9.0
```

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

- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol
- [Ant Design](https://ant.design/) - React UI 组件库
