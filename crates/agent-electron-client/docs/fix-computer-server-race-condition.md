# Fix: Computer HTTP Server Race Condition

**Date**: 2026-04-08
**Author**: dongdada29
**Commit**: `9880646`

---

## Problem

Computer HTTP Server (`startComputerServer`) starts **asynchronously** in `bootstrap/startup.ts`, but `agentService.init()` is only called after the user completes the Setup Wizard.

When a request from the Java backend arrives **before** Setup Wizard is completed:

```
T0: startup.ts → startComputerServer() async (fire-and-forget)
T1: Computer HTTP Server listening on port 60001 (isReady = false)
T2: Request arrives → baseConfig == null
T3: Setup Wizard completes → agentService.init() → baseConfig set
```

The request would fail with "Agent not initialized" error because `agentService.getOrCreateEngine()` throws when `baseConfig` is null.

---

## Solution

Added early readiness check in `computerServer.ts` `handleRequest()`:

```typescript
if (pathname.startsWith("/computer/") && !agentService.isReady) {
  log.warn(`[HTTP] Agent not ready, rejecting request: ${method} ${pathname}`);
  sendJson(res, 503, httpError("SERVICE_NOT_READY", "Agent service is not initialized yet"));
  return;
}
```

Returns **HTTP 503** with `SERVICE_NOT_READY` error code, allowing the client to retry once the agent is ready.

---

## Files Changed

- `crates/agent-electron-client/src/main/services/computerServer.ts` (+15 lines)

---

## Verification

1. Start app, observe Setup Wizard
2. Send request to `POST /computer/chat` → should get 503 `SERVICE_NOT_READY`
3. Complete Setup Wizard
4. Send request again → should succeed

---

## Related

- `bootstrap/startup.ts` — where Computer HTTP Server starts asynchronously
- `serviceManager.ts` — where `agentService.init()` is called after Setup
- `unifiedAgent.ts` — `isReady` getter returns `this.baseConfig !== null`
