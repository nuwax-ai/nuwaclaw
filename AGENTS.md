# AGENTS.md - Agent Development Guide

## Project Overview

This is the **Nuwax Agent** desktop application - a multi-engine AI assistant that works around the clock.

### Core Features

- **Multi-Agent Engine**: Supports claude-code and nuwaxcode
- **Cross-Platform**: Windows, macOS, Linux
- **Local Execution**: Runs locally with sandbox option
- **IM Integration**: Control via Telegram, Discord, DingTalk, Feishu
- **Persistent Memory**: Remembers user preferences

---

## Architecture

### Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                      │
├─────────────────────────────────────────────────────────────┤
│  - Window lifecycle                                         │
│  - SQLite persistence                                      │
│  - Engine Manager (claude-code/nuwaxcode)                  │
│  - IM Gateways (Telegram/Discord/DingTalk/Feishu)         │
│  - 40+ IPC handlers                                        │
│  - Context isolation enabled, node integration disabled     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ IPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Electron Renderer Process                   │
├─────────────────────────────────────────────────────────────┤
│  - React 18 + Redux Toolkit                                │
│  - UI and business logic                                   │
│  - Communicates via IPC only                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Services

### Core Services

| Service | File | Description |
|---------|------|-------------|
| **Unified Agent** | `unifiedAgent.ts` | SDK-based agent lifecycle, MCP injection |
| **Engine Manager** | `engineManager.ts` | Agent engine lifecycle |
| **Shell Environment** | `shellEnv.ts` | Cross-platform shell |
| **Workspace Manager** | `workspaceManager.ts` | Session workspaces |
| **Dependencies** | `dependencies.ts` | Package management |
| **MCP** | `mcp.ts` | MCP server management |
| **Setup** | `setup.ts` | Setup wizard & auth |
| **File Server** | `fileServer.ts` | Local file service |
| **Lanproxy** | `lanproxy.ts` | Intranet penetration |
| **Skills** | `skills.ts` | Skills sync |
| **IM** | `im.ts` | Instant messaging |
| **Scheduler** | `scheduler.ts` | Task scheduling |
| **Permissions** | `permissions.ts` | Permission control |

### Components

| Component | Description |
|-----------|-------------|
| `SetupWizard.tsx` | 3-step setup wizard |
| `SettingsPage.tsx` | Settings UI |
| `AgentSettings.tsx` | Agent configuration |
| `MCPSettings.tsx` | MCP management |
| `LanproxySettings.tsx` | Lanproxy config |
| `SkillsSync.tsx` | Skills sync UI |
| `IMSettings.tsx` | IM configuration |
| `TaskSettings.tsx` | Task settings |

---

## Agent Engines

### Supported Engines

| Engine | Command | Description |
|--------|---------|-------------|
| **claude-code** | `claude-code --sACP` | Default recommended |
| **nuwaxcode** | `nuwaxcode serve --stdio` | Alternative |

### Engine Isolation

Each engine runs in an isolated environment:

```typescript
{
  // App-internal dependencies injected
  PATH: '~/.nuwax-agent/node_modules/.bin:~/.nuwax-agent/bin:$PATH',
  NODE_PATH: '~/.nuwax-agent/node_modules',

  // Isolated home
  HOME: '/tmp/nuwax-agent-run-xxx',
  XDG_CONFIG_HOME: '/tmp/.../.config',
  CLAUDE_CONFIG_DIR: '/tmp/.../.claude',
  NUWAXCODE_CONFIG_DIR: '/tmp/.../.nuwaxcode',
  ANTHROPIC_API_KEY: 'xxx',
  ANTHROPIC_BASE_URL: 'xxx',
}
```

---

## Dependencies

### Required Dependencies

| Dependency | Type | Description |
|------------|------|-------------|
| **uv** | bundled | Python package manager (>=0.5.0), shipped in extraResources |
| **nuwax-file-server** | npm-local | File service |
| **nuwaxcode** | npm-local | Agent engine |
| **nuwax-mcp-stdio-proxy** | npm-local | MCP protocol aggregation proxy |

### Installation Locations

```
~/.nuwax-agent/
├── engines/           # Agent engines
├── workspaces/       # Session workspaces
├── node_modules/    # Local npm packages
│   ├── .bin/        # Executable symlinks (injected into PATH)
│   └── mcp-servers/ # MCP servers (isolated)
├── bin/              # App binaries
├── logs/             # Application logs
└── nuwax-agent.db   # SQLite database
```

> **Note**: All data is stored under `~/.nuwax-agent/`. The Electron `app.getPath('userData')` path is NOT used.

---

## Session & Workspace

### Rule

- **One Session = One Workspace**
- Workspace directory is **user-specified**
- Each session has independent configuration

### Workflow

```
User creates session
    │
    └── Specify workspace directory
        │
        └── Validate directory
            │
            └── Save to config
                │
                └── Engine uses this directory
```

---

## Development

### Commands

```bash
# Install dependencies
npm install

# Development
npm run electron:dev

# Build
npm run build

# Package
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

### Project Structure

```
nuwax-agent/
├── crates/
│   ├── agent-electron-client/  # Electron client
│   ├── agent-tauri-client/     # Tauri client
│   └── nuwax-agent-core/       # Core (Rust)
│
├── docs/                      # Documentation
├── scripts/                   # Build scripts
└── CHANGELOG.md              # Version history
```

---

## Key Files

- `src/main/main.ts` - Electron main process
- `src/main/preload.ts` - Preload script
- `src/App.tsx` - React root
- `src/services/` - All services
- `src/components/` - All components

---

## API Keys

Store sensitive configuration in SQLite, not in code:

- `anthropic_api_key` - Claude API key
- `default_model` - Default model
- `server_host` - Backend server

---

*Last updated: 2026-02-23*
