# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

#### Data Directory Unification
- **Unified data directory** — All data now stored under `~/.nuwax-agent/`
  - SQLite database moved from `app.getPath('userData')` to `~/.nuwax-agent/nuwax-agent.db`
  - Dependencies service (`dependencies.ts`) `getAppDataDir()` now returns `~/.nuwax-agent/`
  - Eliminates split between `~/Library/Application Support/...` and `~/.nuwax-agent/`

#### Bundled uv
- **uv bundled into Electron** — No longer requires system-wide uv installation
  - uv binary shipped via `extraResources` → `resources/uv/bin/`
  - New `getResourcesPath()` resolves `process.resourcesPath` (packaged) or `resources/` (dev)
  - New `getUvBinPath()` returns platform-specific bundled uv path
  - `checkUvVersion()` prefers bundled uv, falls back to system uv
  - uv dependency type changed from `"system"` to `"bundled"` in `SETUP_REQUIRED_DEPENDENCIES`
  - DependenciesPage shows "已集成" when bundled uv is detected

#### Dependency Environment Injection
- **App-internal dependency paths injected into all child processes**
  - New `getAppEnv()` builds env vars with `~/.nuwax-agent/node_modules/.bin`, `~/.nuwax-agent/bin`, and `resources/uv/bin` prepended to `PATH`
  - `NODE_PATH` set to `~/.nuwax-agent/node_modules`
  - Applied to: file server, agent runner, lanproxy, agent, engine manager spawns
  - `engineManager.ts` `createIsolatedEnvironment()` also injects app-internal paths

#### Node.js Detection Removed
- **Node.js no longer checked as system dependency** — Electron bundles its own Node runtime
  - DependenciesPage shows Electron built-in Node.js version with "已集成 (Electron)" status
  - `systemDepsReady` no longer depends on Node.js check

### Added
- `"bundled"` type added to `LocalDependencyType`
- `getResourcesPath()`, `getUvBinPath()`, `getAppEnv()` exported from `dependencies.ts`
- `_checkUvBin()` helper for checking a specific uv binary path
- `checkUvVersion()` now returns `bundled` flag and `binPath`
- **Agent Runner** added to ClientPage service dashboard (4 services total)
- `resources/uv/bin/uv` — bundled uv binary for macOS (CI/CD provides other platforms)
- `package.json` `build.extraResources` includes `resources/uv`

---

## [0.1.0] - 2026-02-22

### Added

#### Core Architecture
- **Electron Client** - Cross-platform desktop application
- **Multi-Agent Engine Support** - Support for claude-code and nuwaxcode
- **Session-Based Workspace** - Each conversation has its own workspace

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

#### Services
- **Setup Wizard** - 3-step configuration
- **Login/Logout** - Authentication with SQLite storage
- **File Server** - Local file service
- **Lanproxy** - Intranet penetration
- **Skills Sync** - Remote skills synchronization
- **IM Integration** - Instant messaging
- **Scheduler** - Task scheduling

### Changed

- Removed Zed ACP (rcoder)方案
- Removed claude-code-acp-ts dependency
- Node.js detection (built into Electron, no separate installation needed)
- Updated dependency list to match Electron architecture

### Technical Details

#### Process Architecture
```
Main Process (Electron)
├── Window Management
├── IPC Handlers (40+)
├── SQLite Database
├── CoworkRunner
└── IM Gateways

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
└── nuwax-agent.db   # SQLite database
```

---

## [Future]

### Planned Features

- [ ] Sandbox execution (Alpine Linux VM)
- [ ] Permission gating
- [ ] Persistent memory
- [ ] Scheduled tasks
- [ ] IM remote control

### Known Issues

- None currently

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1.0 | 2026-02-22 | Initial Electron client with multi-engine support |
