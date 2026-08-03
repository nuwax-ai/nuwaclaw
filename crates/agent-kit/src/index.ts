// @nuwax-ai/agent-kit — shared agent/ACP logic for nuwa-cli & nuwaclaw.
//
// First slice: engine (binary) resolution. The codex ACP adapter is resolved
// via require.resolve against the @nuwax-ai/nuwax-codex-acp-ts package, so both
// hosts converge on one strategy instead of one bundling it and the other
// npm-resolving it.

import { createRequire } from "node:module";

// createRequire(import.meta.url) gives a require whose resolution is anchored
// to this module — correct under ESM (native import.meta.url). Under CJS,
// tsup's `shims: true` provides a compatible import.meta.url (based on
// __filename), so the same source works for both build outputs without a
// runtime `typeof require` branch (which misfires on Node 22+ ESM).
const runtimeRequire = createRequire(import.meta.url);

/**
 * Resolve an installed package's entry specifier (e.g.
 * "@nuwax-ai/nuwax-codex-acp-ts/dist/index.js") to an absolute path via
 * `require.resolve`. Safe under both ESM (createRequire) and CJS (esbuild
 * rewrites import.meta.url for the cjs build). Throws a friendly error if the
 * dependency is missing — callers should hint `npm install`.
 */
export function resolvePackageEntry(
  packageName: string,
  entrySpecifier: string,
): string {
  try {
    return runtimeRequire.resolve(entrySpecifier);
  } catch {
    throw new Error(
      `缺少 ${packageName} 依赖入口 ${entrySpecifier}。请重新运行 npm install。`,
    );
  }
}

/** A resolved engine spawn target — structurally compatible with nuwa-cli's
 *  `ResolvedEngine`, so hosts can assign directly. */
export interface EngineResolution {
  command: string;
  args: string[];
  envOverlay?: NodeJS.ProcessEnv;
}

export interface NodePackageResolutionOptions {
  packageName: string;
  entrySpecifier: string;
  /** Absolute bundled entry supplied by a host such as Electron. */
  entryOverride?: string;
}

/**
 * Resolve a Node-hosted package entry into a spawn target. The package owns
 * the invariant `node <absolute-entry>`; hosts only decide whether the entry
 * comes from bundled resources or normal package resolution.
 */
export function resolveNodePackage(
  options: NodePackageResolutionOptions,
): EngineResolution {
  const entry =
    options.entryOverride ??
    resolvePackageEntry(options.packageName, options.entrySpecifier);
  return { command: process.execPath, args: [entry] };
}

export const CODEX_ACP_PACKAGE = "@nuwax-ai/nuwax-codex-acp-ts";
export const CODEX_ACP_ENTRY = `${CODEX_ACP_PACKAGE}/dist/index.js`;
export const CLAUDE_ACP_PACKAGE = "claude-code-acp-ts";
export const CLAUDE_ACP_ENTRY = `${CLAUDE_ACP_PACKAGE}/dist/index.js`;

/**
 * Resolve the codex ACP adapter to a spawn target: `node <entry>`, where entry
 * is require.resolve'd from @nuwax-ai/nuwax-codex-acp-ts. Host-specific env
 * (e.g. nuwa-cli's CODEX_LOG_DIR) is left for the caller to overlay on
 * `envOverlay`.
 *
 * `entryOverride` lets hosts that resolve the adapter by a non-require.resolve
 * mechanism (e.g. nuwaclaw's Electron `resources/` bundling) pass the absolute
 * entry path; defaults to require.resolve for npm-installed hosts (nuwa-cli).
 */
export function resolveCodexAcp(opts?: {
  entryOverride?: string;
}): EngineResolution {
  return resolveNodePackage({
    packageName: CODEX_ACP_PACKAGE,
    entrySpecifier: CODEX_ACP_ENTRY,
    entryOverride: opts?.entryOverride,
  });
}

/**
 * Resolve the Claude ACP adapter. Electron passes its resources entry through
 * `entryOverride`; package-installed hosts use require.resolve by default.
 */
export function resolveClaudeAcp(opts?: {
  entryOverride?: string;
}): EngineResolution {
  return resolveNodePackage({
    packageName: CLAUDE_ACP_PACKAGE,
    entrySpecifier: CLAUDE_ACP_ENTRY,
    entryOverride: opts?.entryOverride,
  });
}

// Health-check primitives (file-server / lanproxy polling, envelope判定,
// process liveness) shared with nuwaclaw. See ./health.ts.
export * from "./health.js";

// PersistentMcpBridge singleton manager (host injects the bridge constructor +
// logger, so agent-kit doesn't depend on @nuwax-ai/mcp-proxy-ts). See ./proxyBridge.ts.
export * from "./proxyBridge.js";

// MCP npx cache warmup state machine. Hosts inject command/env/state adapters.
export * from "./mcpCacheWarmup.js";

// ACP permission subsystem (decision chain + classifier framework +
// tool_approval_rules + notify-resolved protocol + pending state machine).
// See ./permissions/index.ts.
export * from "./permissions/index.js";
