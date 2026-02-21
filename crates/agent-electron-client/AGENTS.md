# AGENTS.md - Agent Development Guide

## Project Overview

This is the **Nuwax Agent** Electron client - a multi-engine AI assistant desktop application.

### Core Features

- **Multi-Agent Engine**: Supports claude-code and nuwaxcode
- **Cross-Platform**: Windows, macOS, Linux
- **Local Execution**: Runs locally with sandbox option
- **IM Integration**: Control via Telegram, Discord, DingTalk, Feishu
- **Persistent Memory**: Remembers user preferences
- **Sandbox Execution**: Docker/WSL/Firejail isolation

---

## Architecture

### Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                      │
├─────────────────────────────────────────────────────────────┤
│  - Window lifecycle                                         │
│  - System tray                                              │
│  - SQLite persistence                                       │
│  - Engine Manager (claude-code/nuwaxcode)                   │
│  - Sandbox Manager (Docker/WSL/Firejail)                   │
│  - IM Gateways (Telegram/Discord/DingTalk/Feishu)          │
│  - Process cleanup on exit                                  │
│  - IPC handlers (40+)                                      │
│  - Context isolation enabled                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ IPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Electron Renderer Process                   │
├─────────────────────────────────────────────────────────────┤
│  - React 18 + Ant Design                                   │
│  - UI and business logic                                   │
│  - Communicates via IPC only                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Services

### Core Services (19)

| Service | File | Description |
|---------|------|-------------|
| **Engine Manager** | `engineManager.ts` | Agent engine lifecycle, isolation |
| **Shell Environment** | `shellEnv.ts` | Cross-platform shell |
| **Workspace Manager** | `workspaceManager.ts` | Session workspaces |
| **Sandbox** | `sandbox.ts` | Cross-platform sandbox |
| **Dependencies** | `dependencies.ts` | Package management |
| **MCP** | `mcp.ts` | MCP server management |
| **Permissions** | `permissions.ts` | Permission rules |
| **Setup** | `setup.ts` | Setup wizard & auth |
| **File Server** | `fileServer.ts` | Local file service |
| **Lanproxy** | `lanproxy.ts` | Intranet penetration |
| **Skills** | `skills.ts` | Skills sync |
| **IM** | `im.ts` | Instant messaging |
| **Scheduler** | `scheduler.ts` | Task scheduling |
| **Log Service** | `logService.ts` | Logging & export |
| **Agent** | `agent.ts` | Agent management |
| **Agent Runner** | `agentRunner.ts` | Agent runner |
| **AI** | `ai.ts` | AI configuration |
| **Package Locator** | `packageLocator.ts` | Package detection |
| **Package Manager** | `packageManager.ts` | Package management |

### Components (10)

| Component | Description |
|-----------|-------------|
| `SetupWizard.tsx` | 3-step setup wizard |
| `SettingsPage.tsx` | Settings UI |
| `AgentSettings.tsx` | Agent configuration |
| `AgentRunnerSettings.tsx` | Runner configuration |
| `MCPSettings.tsx` | MCP management |
| `LanproxySettings.tsx` | Lanproxy config |
| `SkillsSync.tsx` | Skills sync UI |
| `IMSettings.tsx` | IM configuration |
| `TaskSettings.tsx` | Task settings |
| `PermissionModal.tsx` | Permission approval |

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
  HOME: '/tmp/nuwax-agent-run-xxx',
  XDG_CONFIG_HOME: '/tmp/.../.config',
  CLAUDE_CONFIG_DIR: '/tmp/.../.claude',
  NUWAXCODE_CONFIG_DIR: '/tmp/.../.nuwaxcode',
  ANTHROPIC_API_KEY: 'xxx',
  ANTHROPIC_BASE_URL: 'xxx',
}
```

---

## Sandbox Execution

### Supported Platforms

| Platform | Sandbox Type | Requirements |
|----------|-------------|--------------|
| **macOS** | Docker / App Sandbox | Docker (optional) |
| **Windows** | Docker / WSL | Docker or WSL |
| **Linux** | Docker / Firejail | Docker or Firejail |

### Usage

```typescript
import { sandboxManager } from './services/sandbox';

// Initialize
await sandboxManager.init({
  enabled: true,
  workspaceDir: '/path/to/workspace'
});

// Execute in sandbox
const result = await sandboxManager.execute('npm', ['install', 'package']);
```

---

## Permissions

### Default Rules

| Pattern | Action |
|---------|--------|
| `tool:read` | Allow |
| `tool:edit` | Prompt |
| `command:bash` | Prompt |
| `file:read` | Allow |
| `file:write` | Prompt |
| `network:http` | Prompt |

### Usage

```typescript
import { permissionManager } from './services/permissions';

// Check permission
const { allowed, requiresPrompt } = permissionManager.checkPermission({
  type: 'command',
  sessionId: 'xxx',
  title: 'Run command',
  description: 'Execute npm install',
  details: { command: 'npm' }
});

// Approve request
permissionManager.approveRequest(requestId, alwaysAllow);
```

---

## Dependencies

### Required Dependencies

| Dependency | Type | Description |
|------------|------|-------------|
| **uv** | system | Python package manager (>=0.5.0) |
| **nuwax-file-server** | npm-local | File service |
| **nuwaxcode** | npm-local | Agent engine |

### Installation Locations

```
~/.nuwax-agent/
├── engines/           # Agent engines
├── workspaces/       # Session workspaces
├── node_modules/    # Local npm packages
│   └── mcp-servers # MCP servers (isolated)
├── logs/             # Application logs
└── nuwax-agent.db   # SQLite database
```

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

## Process Cleanup

### Exit Flow

```
App quit requested
    │
    ├── Stop Agent Runner
    ├── Stop Lanproxy
    ├── Stop File Server
    ├── Stop MCP servers
    ├── Stop Engine processes
    └── Close database
```

### Prevents

- Zombie processes
- Port conflicts
- Resource leaks

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
crates/agent-electron-client/
├── src/
│   ├── main/        # Electron main process
│   │   ├── main.ts
│   │   └── preload.ts
│   ├── services/    # All services (19)
│   ├── components/  # All components (10)
│   └── types/       # TypeScript definitions
├── package.json
└── vite.config.ts
```

---

## API Keys

Store sensitive configuration in SQLite, not in code:

- `anthropic_api_key` - Claude API key
- `default_model` - Default model
- `server_host` - Backend server

---

## Platform Compatibility

| Feature | macOS | Windows | Linux |
|---------|:-----:|:-------:|:-----:|
| Multi-engine | ✅ | ✅ | ✅ |
| Sandbox (Docker) | ✅ | ✅ | ✅ |
| Sandbox (WSL) | - | ✅ | - |
| Sandbox (Firejail) | - | - | ✅ |
| IM Integration | ✅ | ✅ | ✅ |
| System Tray | ✅ | ✅ | ✅ |
| No cmd popup | ✅ | ✅ | ✅ |

---

*Last updated: 2026-02-22*
