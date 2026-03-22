# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### 会话过滤回归测试
- **unifiedAgent.test.ts** — 新增 `listAllSessionsDetailed` 过滤非 ready 引擎的测试
- **acpEngine.test.ts** — 新增 `listSessionsDetailed` title 透传测试

### Changed

#### 会话列表过滤
- **unifiedAgent.ts** — `listAllSessionsDetailed()` 仅返回 `isReady` 为 true 的引擎会话，避免崩溃/终止的 ACP 进程污染「活跃会话」列表

#### 服务启动流程优化
- **ClientPage.tsx** — `handleStartAll` 先调用 reg 接口，返回后再 step by step 启动服务
- **ClientPage.tsx** — `handleStartServiceManual` 简化为直接启动，不调用 reg
- **ClientPage.tsx** — 服务启动失败时错误信息常驻显示在服务描述区域

#### 文档同步
- **AGENTS.md** — 更新注册同步与启动顺序章节
- **docs/REG-FLOW.md** — 新增 reg 调用流程说明文档

---

### Added (Previous)

#### 内置 Node.js 24 和 Git 集成
- **prepare-node.js** - 下载 Node.js 24 到 resources/node/
- **prepare-git.js** - 下载 PortableGit 到 resources/git/
- **内置 Node.js 24** - resources/node/bin 包含 node/npm/npx
- **内置 Git** - resources/git/bin 包含 bash.exe（Windows 必须）
- **PATH 优先级优化** - 内置 Node.js > Electron > 内置 Git > 应用内 > uv > 系统
- **Windows 环境变量优化**（参考 LobsterAI）：
  - 关键系统变量（SystemRoot, windir, COMSPEC, SYSTEMDRIVE）
  - Windows 系统目录（System32, Wbem, PowerShell, OpenSSH）
  - 注册表读取最新 PATH（解决后安装工具不在 PATH 问题）
  - MSYS2_PATH_TYPE=inherit（git-bash 正确继承 PATH）
  - ORIGINAL_PATH（POSIX 格式供 git-bash 使用）
- **环境变量前缀**：
  - NUWAXCODE_NODE_DIR / CLAUDE_CODE_NODE_DIR
  - NUWAXCODE_GIT_BASH_PATH / CLAUDE_CODE_GIT_BASH_PATH

#### 系统托盘功能
- **TrayManager** (`src/main/trayManager.ts`)
  - 动态托盘图标（运行中/已停止/错误/启动中状态）
  - 服务管理菜单（重启/停止服务）
  - 开机自启动复选框
  - 设置和依赖管理快捷入口
  - IPC 状态同步（`tray:updateStatus`, `tray:updateServicesStatus`）
- **AutoLaunchManager** (`src/main/autoLaunchManager.ts`)
  - 跨平台开机自启动支持
  - macOS/Windows: 使用 Electron 原生 `app.setLoginItemSettings()`
  - Linux: 使用 `auto-launch` 库（可选依赖）
- **ServiceManager** (`src/main/serviceManager.ts`)
  - 统一的服务启停逻辑
  - 供 IPC handlers 和 Tray 菜单共同使用
  - 支持文件服务器、Lanproxy、Agent、MCP Proxy 管理

#### 跨平台子进程启动方案
- **spawnNoWindow 工具模块** (`src/main/services/utils/spawnNoWindow.ts`)
  - 解决 Windows CMD 窗口弹出问题（使用 ELECTRON_RUN_AS_NODE=1 + windowsHide）
  - 解决 macOS Dock 图标问题（使用系统 node 而非 Electron bundled Node）
  - `spawnJsFile()` - 跨平台无窗口启动 JS 文件
  - `spawnNpmPackage()` - 自动解析 npm 包入口并启动
  - `resolveNpmPackageEntry()` - 从 package.json 解析入口文件
  - `findSystemNode()` - 从用户 shell PATH 查找系统 node
  - `resetCache()` - 重置内部缓存（测试用）
- **完整技术文档** (`docs/electron-spawn-no-window-solution.md`)
  - 问题根因分析
  - 社区方案对比
  - 实现代码示例
  - 测试验证步骤

### Fixed

#### 手动启动单个服务时补充 reg 同步
- **ClientPage.tsx** - 新增 `handleStartServiceManual` 包装函数，用户点击单个服务「启动」按钮时先调用 `syncConfigToServer()`（即 `/api/sandbox/config/reg`）获取最新的 `serverHost`/`serverPort`，再启动目标服务
- 此前仅「登录」和「启动全部」会在启动服务前调用 reg，手动启动单个服务（特别是 lanproxy）可能使用过期的后端配置
- 三种启动场景（登录/启动全部/手动单个）现在均保证 reg 在服务启动之前完成

#### Lanproxy 切换账号后会话显示客户端离线
- **processHandlers.ts** - `startLanproxyProcess` 在 lanproxy 已运行时先停止旧进程再用本次传入的新 config（含新 clientKey/serverIp/serverPort）重启，而非直接跳过
- **processManager.ts** - 新增 `stopAsync()` 方法，发送 SIGTERM 并等待进程退出（5s 超时后 SIGKILL），确保端口/资源释放后再重启；含 stdio 监听器清理防止 Windows 句柄泄漏
- 覆盖场景：不退出登录直接切换账号 / 退出后用新账号登录 / 任何路径调用 `lanproxy:start`

### Changed

#### 子进程启动重构
- **mcp.ts** - 使用 `spawnJsFile` 和 `resolveNpmPackageEntry` 替代原有 spawn
- **engineManager.ts** - 使用 `spawnJsFile` 和 `resolveNpmPackageEntry` 启动引擎
- **acpClient.ts** - 使用 `spawnJsFile` 和 `resolveNpmPackageEntry` 启动 ACP 进程

---

## [0.2.0] - 2026-02-23

### Added

#### 多平台打包与构建
- **uv 多平台集成** — `scripts/prepare-uv.js` 按当前平台从 `resources/uv/<platform-arch>/` 复制或从 GitHub Release 下载最新 uv，支持 darwin/win32/linux 的 x64 与 arm64
- **lanproxy 多平台** — `scripts/prepare-lanproxy.js` 从 Tauri binaries 按平台准备 nuwax-lanproxy
- **prepare-sdk** — `scripts/prepare-sdk.js` 打包前将 `vendors/nuwaxcode-sdk` 复制到 `node_modules/@nuwax-ai/sdk`，避免 electron-builder 因 file: 符号链接报错
- **clean:electron-cache** — `npm run clean:electron-cache` 与 `scripts/clean-electron-cache.js`，用于修复「zip: not a valid zip file」等缓存损坏问题
- **release/** 加入 .gitignore，忽略打包产物

### Changed

#### 构建与打包
- **Vite emptyOutDir: false** — 保留主进程 `dist/main/` 输出，避免 renderer 构建清空导致入口缺失
- **prepare-uv 下载文件名** — 使用 `preferredFilename` 避免重定向后 URL 过长导致 ENAMETOOLONG
- **AGENTS.md** — 增加「在 macOS 上打 Windows 包」与 zip 报错处理说明

#### SDK Migration
- **Rename vendors/opencode-sdk to vendors/nuwaxcode-sdk**
- **Upgrade @nuwax-ai/sdk to v1.2.10** (based on @opencode-ai/sdk v1.2.10)
  - Full API surface: 22 session methods, SSE events, tools, permissions, files
  - Pre-compiled dist from @opencode-ai/sdk

#### Unified Agent Service Rewrite
- **Complete rewrite of `unifiedAgent.ts`** with full SDK integration
  - `OpencodeEngine`: 30+ methods covering sessions, messages, prompt/promptAsync, permissions, tools, files, providers, MCP, agents, commands
  - `ClaudeCodeEngine`: CLI wrapper (claude --print --output-format json)
  - `UnifiedAgentService`: Event bus + engine proxy pattern
  - SSE event stream with auto-reconnect for real-time updates
  - Type-safe imports from @nuwax-ai/sdk

#### IPC Layer Enhancement
- **30 new IPC handlers** in main.ts for SDK operations
  - Session CRUD: listSessions, createSession, getSession, deleteSession, updateSession
  - Messages: getMessages, getMessage
  - Prompt/Command: prompt, promptAsync, command, shell
  - Permissions: respondPermission
  - Session ops: abort, revert, unrevert, shareSession, forkSession, getSessionDiff
  - Tools/Providers: listTools, listProviders, getConfig
  - Files: findText, findFiles, listFiles, readFile
  - MCP/Agents: mcpStatus, listAgents, listCommands
- **SSE event forwarding** from main process to renderer via `agent:event` channel
- **Updated preload.ts** with complete agent API surface
- **Updated electron.d.ts** with AgentAPI type definitions

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
  - Opencode/Nuwaxcode support via @nuwax-ai/sdk (vendors/nuwaxcode-sdk)
  - Claude Code support via CLI (sACP mode)
  - Consistent API for session management, chat, command execution

#### SDK
- **@nuwax-ai/sdk** (vendors/nuwaxcode-sdk)
  - 基于 @opencode-ai/sdk v1.2.10 的完整 SDK
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
~/.nuwaxbot/
├── engines/           # Agent engines (claude-code, nuwaxcode)
├── workspaces/       # Session workspaces
├── node_modules/    # Local npm packages
│   └── mcp-servers # MCP servers (isolated)
├── logs/            # Application logs
└── nuwaxbot.db   # SQLite database
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
