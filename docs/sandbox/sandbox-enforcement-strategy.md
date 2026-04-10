# Sandbox Enforcement Strategy

## Overview

`SandboxEnforcementStrategy` is a unified abstraction that encapsulates all `(platform x engine x mode)` conditional variance for sandbox behavior. It replaces 15+ scattered `isWindows()` / `engineName === "nuwaxcode"` / `sandboxMode === "strict"` inline checks in `acpEngine.ts`.

Created once per `AcpEngine.init()` via `createSandboxEnforcementStrategy()`.

**File:** `src/main/services/sandbox/SandboxEnforcementStrategy.ts`

## Defense-in-Depth Layers

```
Layer 1: OPENCODE_CONFIG injection (nuwaxcode self-sandbox)
Layer 2: OS-level sandbox (Windows restricted token / macOS seatbelt / Linux bwrap)
Layer 3: handlePermissionRequest guard (permission_request from engine)
Layer 4: tool_call_update proactive guard (Windows nuwaxcode strict only)
Layer 5: MCP tool replacement (sandboxed-bash + sandboxed-fs for claude-code)
```

## Sandbox Modes

| Mode | Write Scope | Description |
|------|------------|-------------|
| **strict** | workspace + TEMP only | Minimal write surface |
| **compat** | workspace + TEMP + APPDATA/XDG | Compatible with typical tooling |
| **permissive** | unrestricted | No filesystem protection |

## Platform Backends

| Platform | Backend | Mechanism |
|----------|---------|-----------|
| Windows | `nuwax-sandbox-helper.exe` | Restricted token + DACL ACEs |
| macOS | `sandbox-exec` (seatbelt) | OS kernel-level for all process ops |
| Linux | `bwrap` (bubblewrap) | Namespace isolation |

## Strategy Methods

| Method | Purpose | Notes |
|--------|---------|-------|
| `needsProactiveGuard()` | Intercept tool_call_update for write checking | Windows + nuwaxcode + strict + windows-sandbox only |
| `buildDisallowedTools()` | Return tool names to block in _meta | Empty for nuwaxcode (doesn't read _meta) |
| `buildEngineConfigOverrides()` | Inject sandbox config into OPENCODE_CONFIG | nuwaxcode only, mutates configObj in-place |
| `buildInjectedMcpServers()` | Return sandboxed-bash/sandboxed-fs MCP servers | claude-code only |
| `createTerminalManagerOptions()` | Terminal sandbox constructor options | Windows sandbox only |
| `buildStrictPermissionContext()` | Build context for evaluateStrictWritePermission() | Shared by proactive guard + permission handler |

## Platform x Engine x Mode Matrix

| # | Platform | Engine | Mode | Proactive Guard | Disallowed Tools | MCP Injection | Config Override |
|---|----------|--------|------|----------------|-----------------|---------------|-----------------|
| 1 | any | any | disabled | - | - | - | - |
| 2 | macOS | nuwaxcode | strict | - | - | - | yes |
| 3 | macOS | nuwaxcode | compat | - | - | - | yes |
| 4 | macOS | claude-code | strict | - | Write/Edit/NotebookEdit | sandboxed-fs | - |
| 5 | macOS | claude-code | permissive | - | - | - | - |
| 6 | **Windows** | **nuwaxcode** | **strict** | **yes** | - | - | yes |
| 7 | Windows | nuwaxcode | compat | - | - | - | yes |
| 8 | Windows | nuwaxcode | permissive | - | - | - | yes |
| 9 | Windows | claude-code | strict | - | Bash/Write/Edit/NotebookEdit | sandboxed-bash + sandboxed-fs | - |
| 10 | Windows | claude-code | permissive | - | - | - | - |

## Key Files

| File | Description |
|------|-------------|
| `SandboxEnforcementStrategy.ts` | Strategy interface + implementation + factory |
| `SandboxEnforcementStrategy.test.ts` | 10-combination test matrix (21 tests) |
| `strictPermissionGuard.ts` | Write path evaluation logic |
| `acpTerminalManager.ts` | Per-command terminal sandboxing |
| `SandboxInvoker.ts` | Windows sandbox process wrapping (WRITE_RESTRICTED) |
| `sandboxProcessWrapper.ts` | Sandbox spawn argument builder |

## WRITE_RESTRICTED Engine Gating

`SandboxInvoker` gates `--write-restricted` flag to nuwaxcode only. claude-code spawns MCP servers as child processes via `child_process.spawn()` which requires unrestricted token. nuwaxcode handles MCP internally (no child spawn), so it can run with write-restricted token.

```typescript
const isNuwaxcode = params.engineType === "nuwaxcode";
const serveWriteRestricted =
  subcommand === "serve" && sandboxMode !== "permissive" && isNuwaxcode;
```

## Defense-in-Depth: buildStrictPermissionContext

`buildStrictPermissionContext()` returns `strictEnabled: this.isStrict && this.sandboxEnabled` — this is broader than `needsProactiveGuard()`. This means `handlePermissionRequest()` will also evaluate write restrictions for claude-code strict on macOS/Linux if the engine sends `permission_request` events, providing an extra safety net beyond OS-level sandboxing.
