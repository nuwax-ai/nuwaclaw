# Fix: MCP First-Prompt Readiness + Exit Cleanup

## Background

Two reproducible issues:
1. **MCP not ready on first prompt**: MCP config is passed via `context_servers` in the chat request. After config sync, the ACP engine's mcp-proxy child process hasn't finished connecting/initializing before the prompt is sent.
2. **MCP proxy not cleaned up on exit**: `persistentMcpBridge.stop()` is async but was called fire-and-forget in `cleanupAllProcesses()`. Electron could exit before child processes are killed.

## Root Cause

### Issue 1: MCP Timing Race

**Before fix (first chat request with context_servers):**
```
POST /computer/chat  { agent_config: { context_servers: {...} } }
  |
  ensureEngineForRequest()
    1. Extract context_servers from request
    2. syncMcpConfigToProxyAndReload()    <-- Only saves config to DB
    3. getAgentMcpConfig()                <-- Returns stdio mcp-proxy config (command+args)
    4. getOrCreateEngine() -> engine.init() -> spawn ACP binary
  |
  acpEngine.chat()
    5. createSession({cwd})               <-- ACP newSession: spawns mcp-proxy child
       mcp-proxy needs: start -> parse config -> connect servers -> listTools -> aggregate
    6. promptAsync()                      <-- Sent immediately! mcp-proxy not ready!
```

### Issue 2: Exit Cleanup Not Awaited

`cleanupAllProcesses()` was a sync `void` function. `agentService.destroy()` and `mcpProxyManager.cleanup()` returned Promises that were never awaited.

## Solution

### Fix 1: Pre-start MCP Servers via PersistentMcpBridge

**Strategy**: When `syncMcpConfigToProxyAndReload()` is called, restart `PersistentMcpBridge` and load ALL stdio servers. This blocks until all servers pass the `listTools()` readiness check. Then `getAgentMcpConfig()` returns bridge HTTP URLs instead of stdio configs. ACP connects via HTTP instantly.

**After fix:**
```
POST /computer/chat  { agent_config: { context_servers: {...} } }
  |
  ensureEngineForRequest()
    1. Extract context_servers from request
    2. syncMcpConfigToProxyAndReload()
       -> Save config to DB
       -> Restart PersistentMcpBridge with all servers  <-- BLOCKS until ready
    3. getAgentMcpConfig()                <-- Returns bridge HTTP URLs (servers running!)
    4. getOrCreateEngine() -> engine.init() -> spawn ACP binary (with HTTP URLs)
  |
  acpEngine.chat()
    5. createSession({mcpServers: [HTTP URL]})  <-- ACP connects via HTTP -> instant!
    6. promptAsync()                             <-- MCP ready!
```

### Fix 2: Async Cleanup with Timeout

`cleanupAllProcesses()` is now `async`. `before-quit` uses `e.preventDefault()` + `Promise.race()` with a 5-second hard timeout, then calls `app.exit(0)`.

## Files Changed

| File | Changes |
|------|---------|
| `src/main/services/packages/mcp.ts` | Added `getAllStdioServers()`; `start()` launches all stdio servers; `getAgentMcpConfig()` prefers bridge URL; `syncMcpConfigToProxyAndReload()` restarts bridge; `cleanup()` now async |
| `src/main/services/engines/unifiedAgent.ts` | `AgentConfig.mcpServers` type supports URL entries |
| `src/main/services/engines/acp/acpEngine.ts` | `toAcpMcpServer()` handles URL; nuwaxcode config injection handles URL |
| `src/main/main.ts` | Async cleanup + before-quit timeout + simplified window-all-closed |
| `src/main/services/packages/mcp.test.ts` | Fixed test isolation; updated expectations; added 17 new tests |

## Key Design Decisions

1. **All stdio servers go through bridge** (not just persistent ones). This ensures even temporary servers from `context_servers` are ready before the first prompt.
2. **Bridge URL preference with stdio fallback**: If bridge is running and a server is healthy, use the HTTP URL. If bridge isn't running or a specific server failed, fall back to raw stdio config.
3. **Remote URL servers bypass bridge**: SSE/HTTP servers (`{ url: "..." }`) are passed through unchanged.
4. **`PersistentMcpBridge.start()` is safe to call repeatedly**: It internally calls `stop()` first if already running (bridge.ts line 84-87).
5. **5-second hard timeout on exit**: Prevents the app from hanging if cleanup takes too long.

## Test Coverage (17 new tests)

### `getAllStdioServers` (3 tests)
- Returns all stdio servers (persistent + temporary)
- Excludes remote URL servers
- Returns empty for empty config

### Bridge URL Priority (3 tests)
- All stdio servers use bridge URL when bridge is running
- Partial fallback: healthy servers get URL, unhealthy get stdio config
- Remote servers are unaffected by bridge

### `syncMcpConfigToProxyAndReload` (3 tests)
- Restarts PersistentMcpBridge after config sync
- Skips bridge restart for empty config
- Bridge restart failure doesn't block sync flow

### Cleanup (2 tests)
- `cleanup()` properly awaits `persistentMcpBridge.stop()`
- Bridge stop failure doesn't throw

### `start()` (2 tests)
- Starts bridge with all stdio servers (not just persistent)
- Skips bridge when only remote servers configured

### Real-world Scenarios (4 tests, from production logs)
- Extracts stdio server from uvx bridge entry (markdownify)
- Extracts remote SSE server from bridge entry
- Handles npx-based servers with allowTools
- Full sync with mixed config (uvx + npx + remote URL + default chrome-devtools)

## Verification

1. **MCP first prompt**: Send a chat request with `context_servers`. Logs should show `PersistentMcpBridge 已使用更新配置重启` before the prompt is sent. First prompt should have access to all MCP tools.
2. **Exit cleanup**: Start app with MCP servers, quit app. `ps aux | grep mcp` should show no orphan processes. Logs should show `Cleanup complete, exiting`.
3. **Edge cases**:
   - MCP server connection failure -> bridge retries/falls back to stdio config
   - No MCP config -> no blocking
   - Rapid repeated requests -> bridge handles re-entry via stop-then-start
   - Multiple quit events -> `isCleaningUp` guard prevents duplicate cleanup
