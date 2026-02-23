# Agent Development Guide

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

### Main Process Services (13 files)

Located in `src/services/main/`, these services use Node/Electron APIs and can only run in the main process.

| Service | File | Description |
|---------|------|-------------|
| **Engines** | | |
| Unified Agent | `engines/unifiedAgent.ts` | Unified SDK layer for all engines |
| Opencode Engine | `engines/opcodeEngine.ts` | HTTP/SSE client for opencode |
| ACP Engine | `engines/acp/acpEngine.ts` | ACP protocol handler |
| ACP Client | `engines/acp/acpClient.ts` | ACP connection manager |
| Agent Helpers | `engines/agentHelpers.ts` | Agent utilities |
| Engine Manager | `engines/engineManager.ts` | Engine lifecycle, isolation |
| **System** | | |
| Dependencies | `system/dependencies.ts` | Package management, env injection |
| Shell Environment | `system/shellEnv.ts` | Cross-platform shell |
| Workspace Manager | `system/workspaceManager.ts` | Session workspaces |
| **Packages** | | |
| MCP | `packages/mcp.ts` | MCP server management |
| Package Locator | `packages/packageLocator.ts` | Package detection |
| Package Manager | `packages/packageManager.ts` | Package installation |
| **Other** | | |
| Computer Server | `main/computerServer.ts` | HTTP server for /computer/* API |

### Renderer Process Services (13 files)

Located in `src/services/renderer/`, these services are used by React components.

| Service | File | Description |
|---------|------|-------------|
| **Setup** | | |
| Setup | `renderer/setup.ts` | Setup wizard & auth |
| Auth | `renderer/auth.ts` | Authentication, API keys |
| AI | `renderer/ai.ts` | AI configuration |
| **Services** | | |
| File Server | `renderer/fileServer.ts` | Local file service |
| Lanproxy | `renderer/lanproxy.ts` | Intranet penetration |
| Agent Runner | `renderer/agentRunner.ts` | Agent runner proxy |
| **Features** | | |
| Sandbox | `renderer/sandbox.ts` | Cross-platform sandbox |
| Permissions | `renderer/permissions.ts` | Permission rules |
| Skills | `renderer/skills.ts` | Skills sync |
| IM | `renderer/im.ts` | Instant messaging |
| Scheduler | `renderer/scheduler.ts` | Task scheduling |
| Log Service | `renderer/logService.ts` | Logging & export |
| API | `renderer/api.ts` | Backend API client |

### Components (12)

| Component | Description |
|-----------|-------------|
| `SetupWizard.tsx` | 3-step setup wizard |
| `SetupDependencies.tsx` | Dependency detection & auto-install |
| `ClientPage.tsx` | Dashboard (login, services, deps) |
| `SettingsPage.tsx` | Settings UI |
| `DependenciesPage.tsx` | Dependency management UI |
| `AgentSettings.tsx` | Agent configuration |
| `AgentRunnerSettings.tsx` | Runner configuration |
| `MCPSettings.tsx` | MCP management |
| `LanproxySettings.tsx` | Lanproxy config |
| `SkillsSync.tsx` | Skills sync UI |
| `IMSettings.tsx` | IM configuration |
| `TaskSettings.tsx` | Task settings |

---

## Unified Agent Service

### Supported Engines

| Engine | SDK/CLI | Package |
|--------|---------|---------|
| **opencode** | SDK | @nuwax-ai/sdk (vendors/nuwaxcode-sdk) |
| **nuwaxcode** | SDK | @nuwax-ai/sdk (vendors/nuwaxcode-sdk) |
| **claude-code** | CLI | spawn |

### Architecture

```
┌─────────────────────────────────────────────────┐
│            UnifiedAgentService                   │
│         （统一入口，事件总线）                      │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │         OpencodeEngine                  │     │
│  │   @nuwax-ai/sdk (createOpencode)       │     │
│  │   - 完整 Session API (22 方法)          │     │
│  │   - SSE 事件流                          │     │
│  │   - 工具发现 & 选择                     │     │
│  │   - 权限请求/响应                       │     │
│  │   - 文件操作                            │     │
│  │   - Provider 管理                       │     │
│  └────────────────────────────────────────┘     │
│                                                  │
│  ┌────────────────────────────────────────┐     │
│  │       ClaudeCodeEngine                  │     │
│  │   CLI spawn (--print / JSON 模式)      │     │
│  │   - 基本 chat                           │     │
│  │   - 命令执行                            │     │
│  └────────────────────────────────────────┘     │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Usage

```typescript
import { agentService } from './services/main/engines/unifiedAgent';

// Initialize with opencode/nuwaxcode (SDK engine)
await agentService.init({
  engine: 'opencode',  // or 'nuwaxcode' or 'claude-code'
  apiKey: 'xxx',
  model: 'claude-sonnet-4-20250514',
  workspaceDir: '/path/to/workspace',
  // Optional: custom env and MCP servers
  env: { MY_VAR: 'value' },
  mcpServers: {
    'my-mcp': { command: 'npx', args: ['-y', 'my-mcp-server'] },
  },
});

// Create session
const session = await agentService.createSession({ title: 'My Session' });

// Send prompt (blocking)
const result = await agentService.prompt(session.id, [
  { type: 'text', text: 'Hello!' }
]);

// Send prompt (async, results via SSE events)
await agentService.promptAsync(session.id, [
  { type: 'text', text: 'Build a todo app' }
]);

// Listen for SSE events
agentService.on('message.updated', (data) => { /* ... */ });
agentService.on('permission.updated', (data) => { /* ... */ });

// Respond to permission request
await agentService.respondPermission(session.id, permissionId, 'once');

// Destroy
await agentService.destroy();
```

---

## Unified Agent SDK (@nuwax-ai/sdk)

### About

使用 vendor 包 `@nuwax-ai/sdk`（位于 `vendors/nuwaxcode-sdk`，基于 `@opencode-ai/sdk` v1.2.10），提供完整的 22 个 session 方法 + SSE 事件流 + 工具发现 + 权限管理 + 文件操作。

### Supported Engines

| Engine | SDK/CLI | Package |
|--------|---------|---------|
| **opencode** | SDK | @nuwax-ai/sdk (vendors/nuwaxcode-sdk) |
| **nuwaxcode** | SDK | @nuwax-ai/sdk，通过 createOpencodeClient 连接已有服务 |
| **claude-code** | CLI | spawn |

### Usage

```typescript
import { createOpencode, createOpencodeClient } from '@nuwax-ai/sdk';

// 启动 opencode 并创建 client
const { client, server } = await createOpencode({ port: 4096 });

// 或连接已有 opencode/nuwaxcode HTTP 服务
const client = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });
```

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

## Sandbox Execution

### Supported Platforms

| Platform | Sandbox Type | Requirements |
|----------|-------------|--------------|
| **macOS** | Docker / App Sandbox | Docker (optional) |
| **Windows** | Docker / WSL | Docker or WSL |
| **Linux** | Docker / Firejail | Docker or Firejail |

### Usage

```typescript
import { sandboxManager } from './services/renderer/sandbox';

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
import { permissionManager } from './services/renderer/permissions';

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
| **uv** | bundled | Python package manager (>=0.5.0), shipped in extraResources |
| **nuwax-file-server** | npm-local | File service |
| **nuwaxcode** | npm-local | Agent engine |
| **mcp-stdio-proxy** | npm-local | MCP protocol proxy (bin: `mcp-proxy`) |

> **Note**: Node.js is NOT a required dependency — Electron bundles its own Node runtime.

### Installation Locations

```
~/.nuwax-agent/
├── engines/           # Agent engines
├── workspaces/       # Session workspaces
├── node_modules/    # Local npm packages
│   ├── .bin/        # Executable symlinks (injected into PATH)
│   └── mcp-servers  # MCP servers (isolated)
├── bin/              # App binaries
├── logs/             # Application logs
└── nuwax-agent.db   # SQLite database
```

> **Important**: All data is stored under `~/.nuwax-agent/`. The Electron `app.getPath('userData')` path is NOT used.

### Environment Injection

All child processes (engines, file server, lanproxy, agent runner) receive injected environment variables:

```typescript
{
  PATH: '~/.nuwax-agent/node_modules/.bin:~/.nuwax-agent/bin:resources/uv/bin:$PATH',
  NODE_PATH: '~/.nuwax-agent/node_modules',
}
```

This ensures app-internal dependencies are always found first. Provided by `getAppEnv()` in `system/dependencies.ts`.

### Bundled Resources

```
resources/
└── uv/
    └── bin/
        └── uv          # Bundled uv binary (platform-specific)
```

In packaged mode, these are accessible via `process.resourcesPath`. In dev mode, via `resources/` relative to project root.

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
    ├── Stop Unified Agent Service (agentService.destroy())
    ├── Stop Agent Runner
    ├── Stop Lanproxy
    ├── Stop File Server
    ├── Stop MCP Proxy
    ├── Stop Engine processes
    └── Close database
```

### Process Variables

Main process manages 3 independent child process variables:

| Variable | IPC Prefix | Description |
|----------|-----------|-------------|
| `agentRunnerProcess` | `agentRunner:*` | Agent Runner proxy |
| `lanproxyProcess` | `lanproxy:*` | Lanproxy tunnel |
| `fileServerProcess` | `fileServer:*` | File server |

> **Note**: Agent engine lifecycle is managed by `UnifiedAgentService` (not a raw `ChildProcess`). Use `agent:init` / `agent:destroy` / `agent:serviceStatus` IPC.

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

### 在 macOS 上打 Windows 包（跨平台构建）

**可以。** electron-builder 支持在 Mac 上打包 Windows（会下载 win32 版 Electron 并打包）。若出现：

```text
zip: not a valid zip file
```

多为 **Electron 的 win32 zip 缓存损坏**。处理步骤：

1. **清掉 Electron 相关缓存后重试：**
   ```bash
   # macOS 上 Electron 缓存
   rm -rf ~/Library/Caches/electron
   rm -rf ~/Library/Caches/electron-builder
   # 然后重新打包
   CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:electron -- --win
   ```
2. 若仍报错，可删掉项目内 builder 缓存再试：
   ```bash
   rm -rf node_modules/app-builder-bin
   npm install
   CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:electron -- --win
   ```
3. **Windows x64** 在 Mac 上会触发 native 模块（如 better-sqlite3）交叉编译，node-gyp 不支持，故在 Mac 上一般只打 **Windows arm64**；要 **Windows x64** 请在 Windows 本机或 CI（如 GitHub Actions `windows-latest`）上执行 `npm run dist:win`。

### Project Structure

```
crates/agent-electron-client/
├── src/
│   ├── main/        # Electron main process
│   │   ├── main.ts
│   │   └── preload.ts
│   ├── services/    # Services organized by process type
│   │   ├── main/    # Main process services (Node/Electron APIs)
│   │   │   ├── engines/
│   │   │   │   ├── acp/
│   │   │   │   └── ...
│   │   │   ├── system/
│   │   │   └── packages/
│   │   └── renderer/ # Renderer process services
│   ├── components/  # React components
│   │   └── dev/     # Dev-only tools (DevToolsPanel)
│   └── types/       # TypeScript definitions
├── resources/       # Bundled resources (extraResources)
│   └── uv/          # uv 多平台：prepare-uv 按当前平台复制或下载
│       ├── bin/     # 打包用（prepare-uv 生成，不提交）
│       ├── .cache/  # 下载缓存（不提交）
│       └── <platform-arch>/  # 可选：提交各平台到 darwin-arm64、win32-x64 等
├── scripts/
│   └── prepare-uv.js # 构建前准备 uv（复制或从 GitHub Release 下载）
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

*Last updated: 2026-02-24*
