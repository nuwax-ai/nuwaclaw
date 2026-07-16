# NuwaClaw

Electron-based desktop client for Nuwax Agent, inspired by LobsterAI architecture.

## Features

- **AI Chat** - Claude models integration via Anthropic API
- **Skills System** - Extensible skill plugins with permission control
- **Permission Approval** - Tool execution requires user approval
- **MCP Servers** - Dynamic MCP server management with China mirrors
- **Local SQLite storage** - Persistent sessions and messages
- **Process isolation** - Secure IPC communication
- **System tray** - Background operation
- **Application menu** - Native menu bar
- **Settings** - Configure API keys and model preferences
- **Session management** - Create, switch, delete chat sessions

## Quick Start

### Prerequisites

- Node.js >= 20
- npm or pnpm

### Install & Run

```bash
cd crates/agent-electron-client
npm install
npm run dev
```

### Build for Production

```bash
npm run dist
```

### 发布与 OSS 同步

本项目的自动更新（OSS 上的 `latest*.yml/json` 等）来自 GitHub Release 资产同步。

#### Stable（`electron-v*` 正式版）发布流程（Windows 需要先手签）

- **前置**：Windows 手签环境请参考 `docs/windows-signing.md`（SimplySign Desktop / Windows SDK / gh）。
- **关键顺序**：先 `sign:win`（把 Release 上的 `*-unsigned` Windows 包签名并上传）→ 再 `sync:oss`（同步到 OSS）。

在本 crate 目录下执行：

```bash
# 1) Windows：对 electron-v{version} Release 执行本地签名并回传（会删除 Release 上的 *-unsigned 产物）
#   - 默认版本来自 crates/agent-electron-client/package.json
#   - 必需环境变量：WINDOWS_CERTIFICATE_SHA1（可选：WINDOWS_TIMESTAMP_URL / WINDOWS_PUBLISHER_NAME）
npm run sign:win

# 2) 触发远端 workflow：从 GitHub Release 同步到 OSS（stable 会强校验已签名产物已存在）
npm run sync:oss
```

指定版本/参数示例：

```bash
# 指定版本签名（等价于 scripts/build/sign-release-win-v2.sh 0.12.6）
npm run sign:win -- 0.12.6

# 仅本地签名，不上传到 GitHub Release（调试用）
npm run sign:win -- 0.12.6 --skip-upload

# 同步指定 tag（默认 channel=stable）
npm run sync:oss -- electron-v0.12.6
```

#### Beta（`prerelease-v*` / `channel=beta`）

beta 渠道 **不做 Windows 签名**（直接发布 unsigned），可直接同步：

```bash
npm run sync:oss -- prerelease-v0.11.34 beta
```

#### 仅同步（手动指定 tag）

将指定 tag 的 Electron 构建产物同步到阿里云 OSS（用于自动更新等）时，可在本 crate 目录下执行：

```bash
./scripts/sync-oss.sh electron-v0.8.0
```

或从仓库根目录：

```bash
./crates/agent-electron-client/scripts/sync-oss.sh electron-v0.8.0
```

依赖：`gh`（GitHub CLI）、`jq`，且需已 `gh auth login`。脚本会触发远端 `sync-electron-to-oss.yml`（workflow_dispatch，仅同步不构建）。

## Skills & Commands

| Command | Description | Requires Permission |
|---------|-------------|-------------------|
| `!command` | Run shell command | ✅ |
| `cat:path` | Read file | ✅ |
| `fetch:url` | Network request | ✅ |
| `search:query` | Web search | ❌ |
| `2+2*3` | Calculator | ❌ |

## MCP Servers

### Supported MCP Servers
- Filesystem - File system access
- Brave Search - Web search
- GitHub - GitHub API
- SQLite - Database queries
- Puppeteer - Browser automation
- Fetch - HTTP requests

### NPM Mirrors (China)
- 🇺🇸 npmjs.org (default)
- 🇨🇳 淘宝镜像 (npmmirror)
- 🇨🇳 腾讯镜像
- 🇨🇳 阿里云镜像

## Architecture

```
src/
├── main/              # Electron main process
│   ├── main.ts        # Main entry
│   ├── preload.ts     # Context bridge
│   ├── ipc/           # IPC handlers
│   └── services/      # Main process services
│       ├── engines/   # Agent engines
│       ├── packages/  # Package management (MCP)
│       └── system/    # System utilities
├── renderer/          # Renderer process (React)
│   ├── main.tsx       # React entry
│   ├── App.tsx        # Main app
│   ├── components/    # React components
│   └── services/      # Renderer services
│       ├── ai.ts      # Anthropic Claude API
│       ├── skills.ts  # Skill system
│       ├── mcp.ts     # MCP management
│       └── permissions.ts # Permission manager
└── shared/            # Shared code
    ├── constants.ts   # Shared constants
    └── types/         # TypeScript definitions
```

## IPC Channels

### Session
- `session:list`, `session:create`, `session:delete`

### Message
- `message:list`, `message:add`

### Settings
- `settings:get`, `settings:set`

### MCP
- `mcp:install`, `mcp:uninstall`, `mcp:start`, `mcp:stop`

## Configuration

1. Open Settings (⚙️ or Cmd+,)
2. Enter your Anthropic API Key
3. Select default model
4. Adjust max tokens and temperature

## License

MIT
