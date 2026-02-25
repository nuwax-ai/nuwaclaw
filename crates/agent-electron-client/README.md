# Nuwax Agent Electron Client

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
