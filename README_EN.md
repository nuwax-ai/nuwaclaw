# nuwax-agent

English | [简体中文](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/soddygo/nuwax-agent/ci.yml?branch=main)](https://github.com/soddygo/nuwax-agent/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

A cross-platform Agent client supporting remote desktop control and AI Agent task execution. Built with native UI using [gpui](https://github.com/zed-industries/zed), and secure P2P/Relay communication via [nuwax-rustdesk](https://github.com/rustdesk/rustdesk).

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
│   ├── agent-client/       # Client main program
│   ├── agent-protocol/     # Communication protocol definitions
│   ├── agent-server-admin/ # Admin API service
│   └── data-server/        # Signaling/Relay server wrapper
├── vendors/
│   ├── nuwax-rustdesk/     # RustDesk communication library
│   ├── gpui-component/     # UI component library
│   └── ...
└── tests/
    ├── e2e/                # End-to-end tests
    └── integration/        # Integration tests
```

## Quick Start

### Requirements

- Rust 1.75+
- Node.js 18+ (optional, client will auto-install)
- vcpkg (for nuwax-rustdesk dependencies)

### Install vcpkg Dependencies

```bash
# Clone vcpkg
git clone https://github.com/microsoft/vcpkg /tmp/vcpkg
cd /tmp/vcpkg && ./bootstrap-vcpkg.sh

# Install dependencies (macOS)
./vcpkg install libvpx libyuv opus aom
```

### Build and Run

```bash
# Set vcpkg environment variable
export VCPKG_ROOT=/tmp/vcpkg

# Build client
cargo build -p nuwax-agent

# Run client
cargo run -p nuwax-agent

# Run tests
cargo test -p nuwax-agent
```

### Package for Release

```bash
# Install cargo-packager
cargo install cargo-packager

# Package for macOS (.dmg)
cargo packager --release

# See .github/workflows/release.yml for details
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

## Feature Flags

| Feature | Description | Default |
|---------|-------------|---------|
| `tray` | System tray support | ✅ |
| `auto-launch` | Auto-start on boot | ✅ |
| `dependency-management` | Auto dependency installation | ✅ |
| `remote-desktop` | Remote desktop feature | ❌ |
| `chat-ui` | Chat interface | ❌ |
| `file-transfer` | File transfer | ❌ |
| `dev-mode` | Developer logging | ❌ |

```bash
# Enable all features
cargo build -p nuwax-agent --all-features

# Enable specific features only
cargo build -p nuwax-agent --features "remote-desktop,chat-ui"
```

## Development Guide

### Directory Structure

```
crates/agent-client/src/
├── main.rs              # Program entry
├── app.rs               # Application state management
├── lib.rs               # Library exports
├── components/          # UI components
│   ├── root.rs          # Root component
│   ├── status_bar.rs    # Status bar
│   ├── client_info.rs   # Client info
│   ├── settings.rs      # Settings interface
│   ├── dependency_manager.rs  # Dependency management
│   ├── remote_desktop.rs      # Remote desktop
│   ├── chat.rs          # Chat interface
│   └── about.rs         # About page
├── core/                # Core logic
│   ├── connection/      # Connection management
│   ├── dependency/      # Dependency detection/installation
│   ├── platform/        # Platform adaptation
│   ├── permissions/     # Permission management
│   ├── agent.rs         # Agent task management
│   ├── business_channel.rs  # Business channel
│   ├── crypto.rs        # Encryption utilities
│   └── upgrade.rs       # Upgrade management
├── tray/                # System tray
├── i18n/                # Internationalization
├── message/             # Message handling
└── utils/               # Utility functions
```

### Running Tests

```bash
# Unit tests
cargo test -p nuwax-agent

# Integration tests (requires data-server running)
cargo test --test communication_test -- --ignored

# Code linting
cargo clippy -p nuwax-agent
```

### Debug Mode

```bash
# Enable verbose logging
RUST_LOG=debug cargo run -p nuwax-agent

# Enable development mode
cargo run -p nuwax-agent --features dev-mode
```

## Communication Protocol

Client and admin communicate through data-server (based on RustDesk protocol):

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
│       Signaling (21116) + Relay (21117)         │
└─────────────────────────────────────────────────┘
```

### Message Types

- `Handshake` - Handshake protocol for version and capability negotiation
- `AgentTask` - Agent task request/response
- `FileTransfer` - File transfer
- `Chat` - Chat messages
- `Heartbeat` - Heartbeat keep-alive

## Security Mechanisms

- **Password Encryption** - AES-GCM encrypted storage with key derived from machine ID
- **Communication Encryption** - End-to-end encryption based on RustDesk
- **SHA256 Verification** - Upgrade package integrity verification
- **File Permissions** - Sensitive files set to 0600 permissions (Unix)

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

- [gpui](https://github.com/zed-industries/zed) - GPU-accelerated UI framework
- [RustDesk](https://github.com/rustdesk/rustdesk) - Open source remote desktop
- [gpui-component](https://github.com/longbridge/gpui-component) - gpui component library
