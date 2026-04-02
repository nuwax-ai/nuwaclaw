# nuwax-agent

English | [简体中文](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/soddygo/nuwax-agent/ci.yml?branch=main)](https://github.com/soddygo/nuwax-agent/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

A cross-platform Agent client supporting remote desktop control and AI Agent task execution. Built with [Electron](https://electronjs.org/).

## Features

### Core Features

- **Remote Connection Management** - Establish secure connections with admin via P2P or relay server
- **AI Agent Task Execution** - Receive and execute AI Agent tasks from admin
- **Dependency Management** - Auto-detect and install runtime dependencies like Node.js and npm
- **Secure Communication** - End-to-end encrypted communication based on RustDesk protocol

### UI Features

- **System Tray** - Run in background with quick tray icon operations
- **Client Info** - Display client ID and connection password
- **Settings Management** - Server configuration, security settings, appearance settings
- **Dependency Status** - Visual dependency detection and installation progress
- **Remote Desktop** - Remote desktop viewing and control (In Development)
- **Chat Communication** - Instant messaging with admin (In Development)

### Platform Support

| Platform | Architecture | Status |
|----------|--------------|--------|
| macOS | arm64, x86_64 | ✅ Supported |
| Windows | x86_64 | ✅ Supported |
| Linux | x86_64, arm64 | ✅ Supported |

## Project Architecture

```
nuwax-agent/
├── crates/
│   ├── agent-electron-client/  # Electron client
│   ├── agent-gui-server/       # GUI Agent server (Node.js)
│   └── nuwax-mcp-stdio-proxy/  # MCP proxy (Node.js)
├── docs/                      # Documentation
├── scripts/                   # Build scripts
└── tests/                     # Tests
```

## Quick Start

### Requirements

- Node.js 18+
- pnpm 9+

### Install Dependencies

```bash
pnpm install
```

### Build and Run

```bash
# Prepare dependencies (Node.js, uv, lanproxy, etc.)
make electron-prepare

# Run in development mode
make electron-dev

# Package for release
make electron-bundle
```

## Configuration

Configuration file locations:
- macOS: `~/Library/Application Support/nuwax-agent/config.toml`
- Windows: `%APPDATA%\nuwax-agent\config.toml`
- Linux: `~/.config/nuwax-agent/config.toml`

```toml
[server]
# Signaling server address
hbbs = "your-server:21116"
# Relay server address
hbbr = "your-server:21117"

[security]
# Connection password (encrypted storage)
password_hash = "..."

[general]
# Auto-start on boot
auto_launch = true
# Language setting
language = "en-US"
# Theme mode: light, dark, system
theme = "system"
```

## Features

| Feature | Description |
|---------|-------------|
| **System Tray** | Run in background with quick tray icon operations |
| **AI Agent** | Supports claude-code and nuwaxcode engines |
| **MCP Integration** | Model Context Protocol support |
| **IM Integration** | Telegram, Discord, DingTalk, Feishu support |
| **Dependency Management** | Auto-detect and install runtime dependencies |

## Development Guide

### Directory Structure

```
crates/agent-electron-client/
├── src/
│   ├── main/            # Electron main process
│   │   ├── main.ts     # Entry point
│   │   └── services/   # Services
│   ├── preload/        # Preload script
│   ├── renderer/       # React renderer process
│   └── shared/        # Shared types
└── resources/         # Resources (Node.js, uv, etc.)
```

### Debug Mode

```bash
# Run in development mode (verbose logging)
make electron-dev
```

## Communication Protocol

Client and admin communicate through WebSocket connection:

```
┌─────────────┐      WebSocket       ┌─────────────┐
│   Client    │◄───────────────────►│   Admin     │
│  (Electron) │                      │   Server    │
└─────────────┘                      └─────────────┘
```

### Message Types

- `Handshake` - Handshake protocol for version and capability negotiation
- `AgentTask` - Agent task request/response
- `FileTransfer` - File transfer
- `Chat` - Chat messages
- `Heartbeat` - Heartbeat keep-alive

## Security Mechanisms

- **Password Encryption** - AES-GCM encrypted storage
- **Communication Encryption** - WebSocket TLS encryption
- **Permission Control** - Sensitive operations require confirmation

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

- [Electron](https://electronjs.org/) - Cross-platform desktop application framework
- [React](https://react.dev/) - UI library
- [MCP](https://modelcontextprotocol.io/) - Model Context Protocol
