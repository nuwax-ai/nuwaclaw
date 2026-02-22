# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.0] - 2026-02-22

### Added

#### Core Architecture
- **Electron Client** - Cross-platform desktop application
- **Multi-Agent Engine Support** - Support for claude-code and nuwaxcode
- **Session-Based Workspace** - Each conversation has its own workspace

#### Agent Service
- **Unified Agent Service** (`unifiedAgent.ts`)
  - Unified SDK layer for all agent engines
  - Opencode support via @opencode-ai/sdk (npm)
  - Nuwaxcode support via @opencode-ai/sdk (HTTP mode 或 createOpencodeClient)
  - Claude Code support via CLI (sACP mode)
  - Consistent API for session management, chat, command execution

#### SDK
- **@opencode-ai/sdk** (npm)
  - 官方 SDK，用于 opencode；nuwaxcode 可用同一包或 createOpencodeClient 连接已有服务
  - Auto-start server process
  - HTTP API support for both engines

#### Agent Engine Management
- **Engine Manager** (`engineManager.ts`)
  - Local installation of engines
  - Environment variable isolation
  - Configuration isolation
  - HOME/XDG_CONFIG_HOME redirection

- **Shell Environment** (`shellEnv.ts`)
  - Cross-platform support (Windows/macOS/Linux)
  - Shell detection (zsh/bash/PowerShell)
  - Essential tool detection
  - PATH management

- **Workspace Manager** (`workspaceManager.ts`)
  - User-specified workspace directories
  - Workspace validation
  - Configuration persistence

#### Dependency Management
- **Dependencies Service** (`dependencies.ts`)
  - Local npm package management
  - Version detection
  - Required dependencies:
    - uv (Python package manager)
    - nuwax-file-server (File service)
    - nuwaxcode (Agent engine)

#### MCP Management
- **MCP Service** (`mcp.ts`)
  - Local installation (isolated from system)
  - Version detection
  - Package location tracking

#### Sandbox Execution
- **Sandbox Manager** (`sandbox.ts`)
  - Cross-platform sandbox support
  - Docker containers (all platforms)
  - WSL (Windows)
  - Firejail (Linux)
  - macOS App Sandbox

#### Permission System
- **Permissions Service** (`permissions.ts`)
  - Rule-based permission management
  - Pattern matching (wildcards)
  - Session-level approval
  - Config persistence
  - Import/export config

#### Logging
- **Log Service** (`logService.ts`)
  - Log levels: error, warning, success, info
  - Filtering and search
  - Statistics
  - Export (JSON/CSV/TXT)
  - Real-time subscription
  - Integration with electron-log
  - Persistent storage

#### Platform Compatibility
- **Windows Fix**: Add `windowsHide: true` to prevent cmd popup
- **Process Cleanup**: Proper cleanup on app quit
- **Zombie Prevention**: Kill all child processes on exit

#### Services (18 total)
- setup.ts - Setup wizard and auth
- agent.ts - Agent management
- agentRunner.ts - Agent runner
- ai.ts - AI configuration
- dependencies.ts - Dependency management
- engineManager.ts - Engine management
- dependencies.ts - Dependency management
- engineManager.ts - Engine management
- fileServer.ts - File server
- im.ts - Instant messaging
- lanproxy.ts - Intranet penetration
- logService.ts - Logging
- mcp.ts - MCP management
- packageLocator.ts - Package detection
- packageManager.ts - Package management
- permissions.ts - Permissions
- sandbox.ts - Sandbox execution
- scheduler.ts - Task scheduling
- setup.ts - Setup wizard
- shellEnv.ts - Shell environment
- skills.ts - Skills sync
- workspaceManager.ts - Workspace management

#### Components (10 total)
- AgentRunnerSettings.tsx
- AgentSettings.tsx
- IMSettings.tsx
- LanproxySettings.tsx
- MCPSettings.tsx
- PermissionModal.tsx
- SettingsPage.tsx
- SetupWizard.tsx
- SkillsSync.tsx
- TaskSettings.tsx

### Fixed
- Windows cmd popup issue when running as service
- Process cleanup on app quit
- Zombie process prevention
- Port conflict prevention

### Changed
- Removed Zed ACP (rcoder)方案
- Removed claude-code-acp-ts dependency
- Updated dependency list to match Electron architecture

### Technical Details

#### Process Architecture
```
Main Process (Electron)
├── Window Management
├── IPC Handlers (40+)
├── SQLite Database
├── System Tray
└── Process Cleanup on Exit

Renderer Process (React)
├── UI Components
├── State Management
└── Business Logic
```

#### Directory Structure
```
~/.nuwax-agent/
├── engines/           # Agent engines (claude-code, nuwaxcode)
├── workspaces/       # Session workspaces
├── node_modules/    # Local npm packages
│   └── mcp-servers # MCP servers (isolated)
├── logs/            # Application logs
└── nuwax-agent.db   # SQLite database
```

---

## [Future]

### Planned Features
- [ ] Built-in Skills (16 types like LobsterAI)
- [ ] Persistent Memory
- [ ] Auto-launch on startup

### Known Issues
- None currently

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1.0 | 2026-02-22 | Initial Electron client with multi-engine support |
