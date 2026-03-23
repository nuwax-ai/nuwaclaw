# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.0] - 2026-02-23

### Agent Electron Client

#### Added
- **多平台打包** — uv/lanproxy 按平台准备，prepare-sdk 解决 file: 依赖符号链接问题，支持在 macOS 上打包 Windows（清理 Electron 缓存可修复 zip 报错）
- **clean:electron-cache** — 清理 Electron/electron-builder 缓存脚本，修复「zip: not a valid zip file」

#### Changed
- **Vite emptyOutDir: false** — 避免 renderer 构建清空 dist 导致主进程入口缺失
- **prepare-uv 下载** — 使用固定文件名避免重定向 URL 过长

---

## [0.1.x]

### Changed

#### Agent 管理统一走 SDK
- **移除旧版 Agent spawn 方案** — 删除 `agentProcess` 变量及 `agent:start/stop/status/send` 4 个 IPC handler（~170 行），所有 Agent 生命周期统一通过 `UnifiedAgentService`（`agentService`）管理
- **`agent:init` 增强** — 自动从 `McpProxyManager.getAgentMcpConfig()` 注入 MCP 配置；返回值新增 `engineType`
- **新增 `agent:serviceStatus` IPC** — 返回 `{ running, engineType }`，替代旧版 `agent:status`
- **`AgentConfig` 扩展** — 新增 `env`（自定义环境变量）和 `mcpServers`（MCP 服务器配置）字段
- **`OpencodeEngine.init()` 支持 MCP** — 通过 `config.mcp.servers` 将 MCP 配置传入 `createOpencode()`
- **`ClaudeCodeEngine.prompt()` 支持自定义 env** — 合并 `config.env` 到 spawn 环境
- **ClientPage / AgentSettings / setup.ts** — 全部迁移到 `agent.init()` / `agent.destroy()` / `agent.serviceStatus()`
- **preload.ts** — 移除 `start/stop/status/send` bridge，新增 `serviceStatus`
- **electron.d.ts** — 移除旧版类型，新增 `serviceStatus` 和 `env/mcpServers` 字段

### Fixed

#### Process Management
- **Separated `agentProcess` from `agentRunnerProcess`** — `agent:start/stop/status/send` previously shared the same `agentRunnerProcess` variable as `agentRunner:*` handlers, meaning starting either service would clobber the other
- **Never-resolving promises in process start** — `lanproxy:start`, `agentRunner:start`, `agent:start` setTimeout callbacks lacked an else branch; if the process exited within the timeout, the IPC promise would hang forever
- **Hard-coded ports in `agentRunner:status`** — Ports 60001/60002 were hard-coded instead of using the actual ports passed to `agentRunner:start`

#### Dependency Installation
- **npm `--save --no-save` flag contradiction** — `installNpmPackage()` passed both `--save` and `--no-save` to npm; `--no-save` won, so packages weren't tracked in `package.json`, and npm 7+ auto-pruned previously-installed packages during subsequent installs. Only the last-installed package survived.
- **`packageLocator.ts` used `process.cwd()` instead of `os.homedir()`** — In Electron main process, `process.cwd()` points to the app bundle directory, not the user's home. This caused `mcp.ts`'s `isInstalledLocally()` to look for packages in the wrong directory.

#### Settings & Storage
- **`settings:set` stored `"null"` string for null values** — When clearing a setting with `null`, the handler inserted `JSON.stringify(null)` = `"null"` into SQLite. Now uses `DELETE` for null/undefined values.
- **`parseInt` without NaN check** — `mcp:getPort` and MCP initialization parsed port strings without validating the result, potentially passing `NaN` to `setPort()`.

#### MCP Service
- **`getMcpProxyBinPath` returned system fallback instead of null** — When `mcp-proxy` wasn't installed locally, the method returned the bare binary name as fallback, causing the `if (!binPath)` guard in `start()` to never trigger. Now returns `null` to surface clear errors.
- **Shallow copy of `DEFAULT_MCP_PROXY_CONFIG`** — The spread operator `{ ...DEFAULT_MCP_PROXY_CONFIG }` only shallow-copied; the nested `mcpServers` object was shared between the default and the instance. Now uses deep copy.

#### UI
- **Login form validation never fired** — `Form.Item` had `rules` but no `name` prop, so Ant Design validation was silently skipped. Replaced with explicit `message.warning()` for each empty field.

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
| 0.1.1 | 2026-02-23 | Bug fixes: process separation, dependency install, settings storage |
| 0.2.0 | 2026-02-23 | Remove legacy Agent spawn, unify to SDK with MCP injection |
