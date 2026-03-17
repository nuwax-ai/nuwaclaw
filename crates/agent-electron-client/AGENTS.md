# Agent Development Guide

## Project Overview

**Nuwax Agent** Electron client — multi-engine AI assistant (claude-code / nuwaxcode via ACP). Cross-platform, local + sandbox, IM (Telegram/Discord/DingTalk/Feishu), persistent prefs. Sandbox: Docker / WSL / Firejail.

---

## Architecture

- **Main**: Window, tray, SQLite, Engine Manager (ACP), Sandbox Manager, IM gateways, process cleanup, 40+ IPC, context isolation.
- **Renderer**: React 18 + Ant Design, IPC only. State via React Context + useState + IPC + SQLite (no Redux).

---

## Services

**Main** (`src/main/services/`): Unified Agent `engines/unifiedAgent.ts`, ACP `engines/acp/`, Engine Manager, Dependencies/Shell/Workspace `system/`, MCP/Package Locator/Manager `packages/`, Computer Server `computerServer.ts`.

**Renderer** (`src/renderer/services/`): Setup/Auth/AI, File Server/Lanproxy/Agent Runner, Sandbox/Permissions/Skills/IM/Scheduler/Log/API.

**Components** (`src/renderer/components/`): EmbeddedWebview, SetupWizard, SetupDependencies, ClientPage, SettingsPage, DependenciesPage, AgentSettings, AgentRunnerSettings, MCPSettings, LanproxySettings, SkillsSync, IMSettings, TaskSettings.

---

## Unified Agent & Engines

- **Engines**: claude-code → `claude-code-acp-ts` (npm-local, no args), nuwaxcode → `nuwaxcode acp` (npm-local, args: `['acp']`). Both use ACP/NDJSON over stdin/stdout.
- **Arch**: UnifiedAgentService (unified entry, event bus) → AcpEngine (session, sync/async prompt, permissions, MCP injection, SSE).
- **Usage**: `agentService.init({ engine, apiKey, model, workspaceDir, env?, mcpServers? })` → `createSession` → `prompt` / `promptAsync` → `on('message.updated'|'permission.updated')` → `respondPermission` → `destroy`. See `unifiedAgent.ts`.
- **Isolation**: `PATH`/`NODE_PATH` point to `~/.nuwaclaw`, `HOME` etc. set to `/tmp/nuwaclaw-run-*`, API keys injected via env.

---

## Sandbox & Permissions

- **Sandbox**: macOS Docker/App Sandbox, Windows Docker/WSL, Linux Docker/Firejail. `sandboxManager.init({ enabled, workspaceDir })` → `execute(cmd, args)`. See `sandbox.ts`.
- **Permissions**: tool:read/file:read → Allow; tool:edit/file:write/command:bash/network:http → Prompt. `permissionManager.checkPermission(...)` / `approveRequest(...)`. See `permissions.ts`.

---

## Dependencies & Paths

- **Required**: uv (bundled), nuwax-file-server, claude-code-acp-ts, nuwaxcode, nuwax-mcp-stdio-proxy (npm-local). Node provided by Electron.
- **Data**: `~/.nuwaclaw/` (engines, workspaces, node_modules, bin, logs, nuwaclaw.db). Does NOT use `app.getPath('userData')`.
- **Env**: Child processes get injected `PATH` (includes `.nuwaclaw/node_modules/.bin`, `resources/uv/bin`) and `NODE_PATH`. See `system/dependencies.ts` `getAppEnv()`.
- **Bundled**: `resources/uv/bin/uv` (after packaging: `process.resourcesPath`).

---

## Session & Workspace

One Session = One Workspace. Directory is user-specified, validated before saving to config, then used by the engine.

---

## MCP Proxy & Resilience

- **Log**: MCP proxy writes to `MCP_PROXY_LOG_FILE` (default `~/.nuwaclaw/logs/mcp-proxy.log`). Electron tails it to electron-log via `fs.watchFile`. Controlled in `McpProxyManager.start/stop`.
- **ResilientTransport**: URL-based MCP uses heartbeat 20s, reconnect after 3 consecutive failures, exponential backoff up to 60s, request queue limit 100.

---

## Logging

Uses **electron-log v5** with daily rotation. Config in `src/main/bootstrap/logConfig.ts`.

- **Log directory**: `~/.nuwaclaw/logs/main.YYYY-MM-DD.log` with `latest.log` symlink.
- **Levels**: File → debug/info, Console → debug.
- **Retention**: 7 days (production), 30 days (development).

---

## Reg Sync & Startup

- **Reg**: `POST /api/sandbox/config/reg`, `registerClient()` (core/api.ts), `syncConfigToServer()` (core/auth.ts). Syncs ports etc., returns `serverHost`/`serverPort` written to `lanproxy_config`. **Must be called before lanproxy starts.**
- **Scenarios**: Login → loginAndRegister → start mcpProxy/agent/fileServer → syncConfigToServer → start lanproxy. Start all → non-proxy services first, then sync, then lanproxy. Manual single service → sync then start. Auto-reconnect → App calls reRegisterClient.
- **Reg params**: username, password, savedKey?, sandboxConfigValue. Response: configKey, serverHost/serverPort, online, name.

---

## Process Cleanup

On exit, in order: agentService.destroy, Agent Runner, Lanproxy, File Server, MCP Proxy, engine processes, DB. Main process variables: agentRunnerProcess (`agentRunner:*`), lanproxyProcess (`lanproxy:*`), fileServerProcess (`fileServer:*`). Engine uses IPC `agent:init`/`agent:destroy`/`agent:serviceStatus`.

---

## Testing

Uses **Vitest**. 22+ test files across main, renderer, and shared.

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # With coverage
```

---

## Development

```bash
npm install && npm run dev
npm run build
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

- **Cross-platform packaging (Mac → Win)**: Supported. If `zip: not a valid zip file`, clear caches (`~/Library/Caches/electron`, `electron-builder`, or `node_modules/app-builder-bin`) and retry. Win x64 must be built on Windows/CI (native module cross-compile limitation).
- **CI**: Tag `electron-v*` → `release-electron.yml` (standalone Release). Path changes on push/PR → `ci-electron.yml` (test build). Tauri still uses `v*` → release-tauri. Local OSS sync: `./scripts/sync-oss.sh <tag>` (requires gh, jq).

**Structure**: `src/main/` (main.ts, preload, ipc, services/engines|packages|system|utils), `src/renderer/` (main.tsx, App, components, services, styles), `src/shared/`, `resources/uv/`, `scripts/`. Aliases: `@main/*` → main, `@renderer/*` → renderer, `@shared/*` → shared.

---

## Config & Platform

- **Sensitive config stored in SQLite** (plain text, no encryption): anthropic_api_key, default_model, server_host.
- **Compatibility**: Multi-engine / Sandbox(Docker) / IM / Tray / No cmd popup — all platforms. WSL: Windows only. Firejail: Linux only.

*Last updated: 2026-03-17*
