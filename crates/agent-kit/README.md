# @nuwax-ai/agent-kit

Canonical source lives in the nuwaclaw workspace. nuwa-cli consumes published
versions; during the 0.3.0 migration its previous workspace copy remains only as
a release bridge and must be removed after 0.3.0 is published.

Shared logic for `@nuwax-ai/nuwa-cli` and `@nuwax-ai/nuwaclaw`. The single place
to maintain the agent/ACP behaviour both hosts need, so they stay in lockstep.

**Boundary principle.** agent-kit holds *isomorphic primitives + shared-package
adapters*. Hosts keep *process model + env strategy + lifecycle + product
extensions*. Concretely: agent-kit depends on **no** host runtime package — the
codex adapter is a `require.resolve`'d `peerDependency`, and the MCP bridge is
**injected** (`@nuwax-ai/mcp-proxy-ts` is never imported here).

## Status

Shared slices, dual-format (ESM + CJS) build:

- codex engine resolution
- file-server / lanproxy health polling
- `PersistentMcpBridge` singleton lifecycle
- MCP npx cache warmup state machine
- ACP permission decision primitives

## Exports

### Engine resolution (`src/index.ts`)
- `resolvePackageEntry(packageName, entrySpecifier)` — `require.resolve` a dependency entry (ESM+CJS safe via `createRequire(import.meta.url)` + tsup shims).
- `resolveNodePackage({ packageName, entrySpecifier, entryOverride? })` — turn either a bundled override or installed package entry into the canonical `node <entry>` spawn target.
- `resolveCodexAcp({ entryOverride? })` — resolve the codex ACP adapter (`@nuwax-ai/nuwax-codex-acp-ts`) to a spawn target `{ command, args }`. `entryOverride` is for hosts that bundle the adapter by a non-`require.resolve` mechanism (e.g. nuwaclaw's Electron `resources/`); defaults to `require.resolve` for npm-installed hosts (nuwa-cli).
- `resolveClaudeAcp({ entryOverride? })` — the same spawn-target contract for `claude-code-acp-ts`; hosts should supply their installed or bundled entry so the package stays an optional integration.
- `EngineResolution` — type (`{ command; args; envOverlay? }`), structurally compatible with nuwa-cli's `ResolvedEngine`.

### Health primitives (`src/health.ts`)
- `waitForFileServerHealth({ port, fetchImpl?, signal?, … })` — poll `GET /health` until ok / timeout / abort. Default timeout `DEFAULT_FILE_SERVER_HEALTH_TIMEOUT_MS` (20s) for Windows cold start.
- `waitForLanproxyTunnel({ domain, configKey, fetchImpl?, signal?, … })` — poll the cloud tunnel health endpoint.
- `isLanproxyTunnelEnvelopeHealthy(envelope)` — pure predicate; `LANPROXY_OK_CODE` (`"0000"`) exported for the magic code.
- `confirmProcessHealthy({ pid, isAlive, … })` — process liveness across a stabilize window.
- `delay(ms, signal?)` — abortable sleep.

Host differences (`fetch` vs `http.request`; `isPidAlive` vs `process.kill(0)`) are injected via `fetchImpl` / `isAlive`.

### Start retry (`src/startRetry.ts`)
- `withStartRetry(attemptFn, { label, maxAttempts?, backoffMs?, logger?, signal? })` — isomorphic full-start retry (default 3 attempts, 1s/2s/4s backoff). Hosts inject `attemptFn` (spawn → health → cleanup on failure) and an optional logger; agent-kit never owns process lifecycle.

### Persistent bridge (`src/proxyBridge.ts`)
- `createPersistentBridge({ create, logger, … })` — manage one bridge across config changes. Returns a handle with `ensureStarted(servers)` / `stop()` / `isRunning()`.

> **Contract:** the injected bridge's `start(servers)` MUST be idempotent / diff-aware.
> `ensureStarted` forwards every call to `start` (no internal dedup); the host calls it
> on every MCP rewrite, so change-detection lives in the bridge. nuwa-cli's
> `PersistentMcpBridge` satisfies this; a host whose `start` is not idempotent must diff
> before calling `ensureStarted`.

`createPersistentBridge` is generic over the concrete bridge type, so `ensureStarted`'s
parameter is type-checked against exactly what the injected bridge's `start` accepts —
no `any` / host-side casts, and agent-kit still names no host type.

### MCP cache warmup (`src/mcpCacheWarmup.ts`)
- `runMcpCacheWarmup({ version, npxDir, env, spawnNpx, readState, writeState, … })` — shared marker/cache idempotency, serial warming, timeout and TERM/KILL cleanup.
- `packageNameFromSpec(spec)` — remove a version suffix while preserving scoped package names.
- `isPackageInNpxCache(npxDir, packageName)` — scan npm's `_npx/<hash>/node_modules` cache without depending on npm's hash algorithm.
- `MCP_WARMUP_SPECS` and timeout constants — shared defaults consumed by both hosts.

Hosts retain command discovery, environment policy, state-file schema and logging as
adapters. The warmup module never imports Electron or either host runtime.

### ACP permission primitives (`src/permissions/`)
- `parseComputerPermissionResolveRequest` — shared `Selected.option_id` / legacy `optionId` wire parsing; hosts adapt HTTP response envelopes.
- `toComputerPermissionProgressData` — shared SSE payload mapping with host-owned `metadata` and `extensions` (for example nuwaclaw's `save_rule`). Its request contract is structural so ACP SDK enum drift does not leak into hosts.
- `matchToolApprovalRules` / normalization and target extraction — the canonical glob matching implementation used by both hosts.
- `createPendingService` — duplicate-key supersession, option validation, timeout/cancel, optional resolved retention, host-provided IDs and revision lookup. `retentionMs: 0` keeps no resolved entries.

nuwaclaw keeps Electron events, revision response policy, strict sandbox decisions and
product audit logs in its host adapters. nuwa-cli keeps its interactive/serve policy.

## Build

```
npm run build   # tsup → dist/index.js (esm) + dist/index.cjs (cjs) + dist/index.d.ts
```

The dual-format build is guarded by `tests/agentKit.test.ts`, which `require()`s
`dist/index.cjs` — that is nuwaclaw's consumption path. A vitest `globalSetup`
builds the artifact if missing.

## Requirements

- Node `>= 20.3` (uses `AbortSignal.any`, available since 20.3). Both hosts run Node 22+.
- ACP SDK and adapter packages declared as **peerDependencies** are provided by the host.
