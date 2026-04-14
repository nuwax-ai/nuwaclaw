# NuwaClaw

English | [简体中文](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/soddygo/nuwax-agent/ci.yml?branch=main)](https://github.com/soddygo/nuwax-agent/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Multi-engine AI assistant desktop client based on ACP (Agent Client Protocol), supporting any ACP-compatible Agent engine with cross-platform local AI Agent execution capabilities.

## Core Features

### Multi-Engine Support

NuwaClaw uses [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) to communicate with Agent engines, supporting any ACP-compatible Agent:

| Engine | Description |
|--------|-------------|
| **Claude Code** | Anthropic's official CLI Agent, recommended ⭐ |
| **Codex CLI** | OpenAI's code Agent |
| **Gemini CLI** | Google's AI Agent |
| **GitHub Copilot** | GitHub's AI coding assistant |
| **Cline** | Open-source autonomous coding Agent |
| **Cursor** | Cursor IDE's Agent capability |
| **Goose** | Block's open-source AI Agent |
| **Qwen Code** | Alibaba's Qwen code Agent |
| **Junie** | JetBrains' AI Agent |
| **OpenCode** | Open-source code Agent |
| **Nuwaxcode** | Agent engine based on OpenCode |
| **More...** | [View full list](https://agentclientprotocol.com/get-started/agents) |

> **ACP Protocol**: Agent Client Protocol standardizes communication between code editors/IDEs and AI coding agents. Similar to how LSP works for language services, ACP lets you connect any ACP-compatible Agent to any supporting client.

- Isolated engine execution with independent environment configuration
- Dynamic engine switching without app restart
- Avoid vendor lock-in, choose your Agent freely

### Cross-Platform Clients
- **Electron Client** - Desktop client based on Electron + React

### MCP Protocol Support
- Dynamic MCP server management
- Multi-protocol support (stdio, SSE, Streamable HTTP)
- Resilient connection with automatic reconnection

### Other Features
- **Persistent Storage** - SQLite local storage
- **System Tray** - Background operation with quick actions

## Project Architecture

```
nuwax-agent-client/
├── crates/
│   ├── agent-electron-client/   # Electron client (primary development)
│   ├── nuwax-mcp-stdio-proxy/   # MCP protocol aggregation proxy
│   ├── agent-gpui-client/       # GPUI client (experimental)
│   ├── agent-server-admin/      # Admin API service
│   ├── agent-protocol/          # Communication protocol definitions
│   ├── system-permissions/      # System permission management
│   └── nuwax-agent-core/        # Core logic (Rust)
└── vendors/                     # Third-party dependencies
```

## Quick Start

### Electron Client

```bash
# Option 1: Using Makefile (recommended, run from project root)
make electron-dev     # Development mode
make electron-build   # Build
make electron-dist    # Package

# Option 2: Using npm commands in the crate directory
cd crates/agent-electron-client

# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Package
npm run dist:mac      # macOS
npm run dist:win      # Windows
npm run dist:linux    # Linux
```

### MCP Proxy Service

```bash
cd crates/nuwax-mcp-stdio-proxy

# Install dependencies
npm install

# Build
npm run build

# Run (stdio aggregation mode)
nuwax-mcp-stdio-proxy --config '{"mcpServers":{...}}'

# Run (protocol conversion mode)
nuwax-mcp-stdio-proxy convert http://remote-mcp-server/sse

# Run (persistent bridge mode)
nuwax-mcp-stdio-proxy proxy --port 18099 --config '{"mcpServers":{...}}'
```

## Platform Support

| Platform | Architecture | Status |
|----------|--------------|:------:|
| macOS | arm64, x86_64 | ✅ |
| Windows | x86_64, arm64 | ✅ |
| Linux | x86_64, arm64 | ✅ |

## Electron Client Details

### Tech Stack
- **Main Process**: Electron + TypeScript
- **Renderer Process**: React 18 + Ant Design
- **Storage**: SQLite (better-sqlite3)
- **Build**: Vite + electron-builder

### Core Services

| Service | Description |
|---------|-------------|
| Unified Agent | Unified ACP engine management |
| Engine Manager | Engine lifecycle management |
| MCP | MCP server management |
| Dependencies | Package management |
| Permissions | Permission control |

### Data Storage

```
~/.nuwaclaw/
├── engines/           # Agent engines
├── workspaces/        # Session workspaces
├── node_modules/      # Local npm packages
│   ├── .bin/         # Executables
│   └── mcp-servers/  # MCP servers
├── bin/               # App binaries
├── logs/              # Log files
│   ├── main.log      # Main process log
│   └── mcp-proxy.log # MCP proxy log
└── nuwaclaw.db        # SQLite database
```

### IPC Channels

| Category | Channels |
|----------|----------|
| Session | `session:list`, `session:create`, `session:delete` |
| Message | `message:list`, `message:add` |
| Settings | `settings:get`, `settings:set` |
| Agent | `agent:init`, `agent:destroy`, `agent:prompt` |
| MCP | `mcp:install`, `mcp:uninstall`, `mcp:start`, `mcp:stop` |

## MCP Proxy Service Details

`nuwax-mcp-stdio-proxy` is an MCP protocol aggregation proxy that solves lifecycle management issues when integrating multiple MCP servers.

### Running Modes

| Mode | Purpose | Command |
|------|---------|---------|
| **stdio** | Aggregate multiple MCP servers into single stdio interface | `nuwax-mcp-stdio-proxy --config '...'` |
| **convert** | Convert remote MCP service to local stdio | `nuwax-mcp-stdio-proxy convert <url>` |
| **proxy** | Persistent bridge, pre-start and expose HTTP interface | `nuwax-mcp-stdio-proxy proxy --port 18099` |

### Core Features
- **Readiness Detection**: Block until MCP servers are ready
- **Resilient Transport**: Heartbeat detection, exponential backoff reconnection, request queue
- **Centralized Cleanup**: Gracefully terminate all child processes

### Resilient Transport Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `pingIntervalMs` | 20000 | Heartbeat interval |
| `maxConsecutiveFailures` | 3 | Consecutive failure threshold |
| `maxReconnectDelayMs` | 60000 | Reconnection delay cap |
| `maxQueueSize` | 100 | Request queue capacity |

## Configuration

### Electron Client Configuration

Configure through setup wizard on first run:
1. Enter Anthropic API Key
2. Select default model
3. Configure MCP servers

Sensitive configuration is stored in SQLite database, not hardcoded.

### MCP Server Configuration Example

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

## Development Guide

### Directory Structure

```
crates/agent-electron-client/
├── src/
│   ├── main/              # Main process
│   │   ├── main.ts        # Entry point
│   │   ├── preload.ts     # Preload script
│   │   ├── ipc/           # IPC handlers
│   │   └── services/      # Main process services
│   ├── renderer/          # Renderer process
│   │   ├── main.tsx       # React entry
│   │   ├── App.tsx        # Main component
│   │   ├── components/    # React components
│   │   └── services/      # Renderer services
│   └── shared/            # Shared code
├── resources/             # Packaged resources
├── scripts/               # Build scripts
└── package.json
```

### Running Tests

```bash
# Electron client
cd crates/agent-electron-client
npm run test

# MCP proxy
cd crates/nuwax-mcp-stdio-proxy
npm run test:run
npm run test:coverage
```

### Debug Mode

```bash
# Enable verbose logging
RUST_LOG=debug npm run dev
```

## GitHub Actions

### CI/CD Workflows

| Workflow | Trigger | Description |
|----------|---------|-------------|
| `ci-electron.yml` | `crates/agent-electron-client/**` changes | Electron test build |
| `release-electron.yml` | Push `electron-v*` tag | Electron release build |

### Release Process

```bash
# Electron release
git tag electron-v0.9.0
git push origin electron-v0.9.0
```

## License

[Apache License 2.0](LICENSE)

## Contributing

Issues and Pull Requests are welcome!

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Related Projects

- [Electron](https://www.electronjs.org/) - Cross-platform desktop app framework
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol
- [Ant Design](https://ant.design/) - React UI component library
