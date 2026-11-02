# NuwaClaw

[English](README_EN.md) | 简体中文

[![CI](https://img.shields.io/github/actions/workflow/status/nuwax-ai/nuwaclaw/ci.yml?branch=main)](https://github.com/nuwax-ai/nuwaclaw/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

多引擎 AI 助手桌面客户端，基于 ACP (Agent Client Protocol) 协议，支持任何兼容 ACP 的 Agent 引擎，提供跨平台的本地 AI Agent 执行能力。

本仓直接维护 NuwaClaw 社区版的完整源码、构建系统与发布流程。克隆后即可在仓库根目录开发，无需初始化子模块。Webview 经配置域访问线上部署的 nuwax，无需本地前端。

### 从源码开发

需要 Node.js 24 与 pnpm 9.15.5，在仓库根目录执行：

```bash
git clone https://github.com/nuwax-ai/nuwaclaw.git
cd nuwaclaw
pnpm run build:agent-kit                    # 先构建本地共享包，再安装工作区快照
pnpm install --filter @nuwax-ai/nuwaclaw...
make electron-dev                          # 准备资源并启动开发
```

发布使用 `electron-v*`（stable）/ `prerelease-v*`（beta）tag；构建、签名与 OSS/MinIO 同步均在本仓完成，更新通道保持 `nuwaclaw-electron`。源码迁入记录见 [源码迁移说明](docs/source-import.md)。

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
nuwaclaw/
├── crates/
│   ├── agent-electron-client/   # Electron main, renderer, preload, shared
│   ├── agent-kit/               # Shared ACP primitives (independently built)
│   ├── agent-gui-server/        # GUI Agent MCP server
│   └── windows-sandbox-helper/ # Windows sandbox helper (Rust)
├── scripts/                    # Resource preparation and build tools
├── config/                     # Build resource manifests
├── docs/                       # Project documentation
├── Makefile                    # Development and packaging entry points
└── pnpm-workspace.yaml
```

## 快速开始

### Electron 客户端

完成上面的工作区依赖安装后：

```bash
make electron-dev                           # 准备资源并启动开发
pnpm -C crates/agent-electron-client build   # 构建主进程与渲染进程
make electron-bundle-unsigned               # 当前平台无签名打包，不发布
pnpm -C crates/agent-electron-client prepare:mcp-proxy
pnpm run test:electron                      # 全量测试
pnpm run test:electron:scripts              # 构建与资源脚本测试
```

CI 排除需要真实系统沙箱的 `tests/sandbox-integration/**`。运行同一测试集合：

```bash
pnpm -C crates/agent-electron-client exec vitest run --exclude 'tests/sandbox-integration/**' --exclude '**/node_modules/**'
```

### MCP 代理服务

`@nuwax-ai/mcp-proxy-ts` 通过包依赖安装。执行 `pnpm -C crates/agent-electron-client prepare:mcp-proxy` 准备随包资源，其源码不在本仓本地 crate 中。

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

`@nuwax-ai/mcp-proxy-ts` 是一个 MCP 协议聚合代理，解决多 MCP 服务器集成时的生命周期管理问题。

### 运行模式

| 模式 | 用途 | 命令 |
|------|------|------|
| **stdio** | 聚合多个 MCP 服务器为单个 stdio 接口 | `@nuwax-ai/mcp-proxy-ts --config '...'` |
| **convert** | 将远程 MCP 服务转换为本地 stdio | `@nuwax-ai/mcp-proxy-ts convert <url>` |
| **proxy** | 持久化桥接，预先启动并暴露 HTTP 接口 | `@nuwax-ai/mcp-proxy-ts proxy --port 18099` |

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
cd crates/@nuwax-ai/mcp-proxy-ts
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
