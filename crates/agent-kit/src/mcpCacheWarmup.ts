// @nuwax-ai/agent-kit — shared MCP npx cache warmup state machine.
//
// Hosts inject their npx invocation, environment and state persistence. The
// package owns the behaviour that must stay aligned: cache discovery,
// marker+cache idempotency, serial warming, timeout and TERM/KILL cleanup.

import * as fs from "node:fs";
import * as path from "node:path";

export const MCP_WARMUP_SPECS = [
  "nuwax-ask-question-mcp@latest",
  "@nuwax-ai/openui-mcp@latest",
  "chrome-devtools-mcp@latest",
] as const;

export const MCP_WARMUP_PER_PKG_TIMEOUT_MS = 300_000;
export const MCP_WARMUP_POLL_INTERVAL_MS = 500;
export const MCP_WARMUP_KILL_GRACE_MS = 3_000;

export interface McpCacheWarmupProcess {
  kill(signal?: NodeJS.Signals): void;
  onClose: Promise<number | null>;
}

export type McpCacheWarmupSpawn = (
  packageSpec: string,
  env: NodeJS.ProcessEnv,
) => McpCacheWarmupProcess;

export interface McpCacheWarmupState {
  version: string;
  npxDir: string;
  specs: string[];
  warmedAt: number;
}

export interface McpCacheWarmupResult {
  skipped: boolean;
  reason?: string;
  warmed: string[];
  failed: Array<{ spec: string; error: string }>;
  npxDir: string;
}

export interface RunMcpCacheWarmupOptions {
  version: string;
  npxDir: string;
  env: NodeJS.ProcessEnv;
  /** null means the host cannot resolve a compatible npx invocation. */
  spawnNpx: McpCacheWarmupSpawn | null;
  readState: () => McpCacheWarmupState | null;
  writeState: (state: McpCacheWarmupState) => void;
  specs?: readonly string[];
  isCached?: (npxDir: string, packageName: string) => boolean;
  now?: () => number;
  perPackageTimeoutMs?: number;
  pollIntervalMs?: number;
  killGraceMs?: number;
  force?: boolean;
  onDone?: (result: McpCacheWarmupResult) => void;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Strip the version suffix while preserving a scoped package name. */
export function packageNameFromSpec(spec: string): string {
  if (spec.startsWith("@")) {
    const index = spec.indexOf("@", 1);
    return index === -1 ? spec : spec.slice(0, index);
  }
  const index = spec.lastIndexOf("@");
  return index === -1 ? spec : spec.slice(0, index);
}

/** Find a package below any npm `_npx/<hash>/node_modules` directory. */
export function isPackageInNpxCache(
  npxDir: string,
  packageName: string,
): boolean {
  if (!npxDir || !fs.existsSync(npxDir)) return false;
  let hashes: string[];
  try {
    hashes = fs.readdirSync(npxDir);
  } catch {
    return false;
  }
  return hashes.some((hash) =>
    fs.existsSync(path.join(npxDir, hash, "node_modules", packageName)),
  );
}

async function warmOne(
  spec: string,
  packageName: string,
  options: {
    env: NodeJS.ProcessEnv;
    npxDir: string;
    spawnNpx: McpCacheWarmupSpawn;
    isCached: (npxDir: string, packageName: string) => boolean;
    now: () => number;
    perPackageTimeoutMs: number;
    pollIntervalMs: number;
    killGraceMs: number;
  },
): Promise<boolean> {
  const handle = options.spawnNpx(spec, options.env);
  const deadline = options.now() + options.perPackageTimeoutMs;
  let closed = false;
  void handle.onClose.then(() => {
    closed = true;
  });

  try {
    while (options.now() < deadline) {
      if (options.isCached(options.npxDir, packageName)) return true;
      if (closed) return options.isCached(options.npxDir, packageName);
      await sleep(options.pollIntervalMs);
    }
    return false;
  } finally {
    handle.kill("SIGTERM");
    await Promise.race([handle.onClose, sleep(options.killGraceMs)]);
    handle.kill("SIGKILL");
  }
}

/**
 * Run the host-independent warmup workflow. Best-effort: individual spawn and
 * persistence failures are recorded or ignored; the workflow never throws.
 */
export async function runMcpCacheWarmup(
  options: RunMcpCacheWarmupOptions,
): Promise<McpCacheWarmupResult> {
  const specs = [...(options.specs ?? MCP_WARMUP_SPECS)];
  const isCached = options.isCached ?? isPackageInNpxCache;
  const now = options.now ?? Date.now;
  const perPackageTimeoutMs =
    options.perPackageTimeoutMs ?? MCP_WARMUP_PER_PKG_TIMEOUT_MS;
  const pollIntervalMs =
    options.pollIntervalMs ?? MCP_WARMUP_POLL_INTERVAL_MS;
  const killGraceMs = options.killGraceMs ?? MCP_WARMUP_KILL_GRACE_MS;

  const skipped = (reason: string): McpCacheWarmupResult => ({
    skipped: true,
    reason,
    warmed: [],
    failed: [],
    npxDir: options.npxDir,
  });

  if (!options.spawnNpx) return skipped("npx unavailable");

  if (!options.force) {
    let state: McpCacheWarmupState | null = null;
    try {
      state = options.readState();
    } catch {
      // A corrupt/unreadable marker is equivalent to a cache miss.
    }
    const markerMatches =
      state?.version === options.version &&
      state.npxDir === options.npxDir &&
      specs.every((spec) => state.specs.includes(spec));
    if (
      markerMatches &&
      specs.every((spec) =>
        isCached(options.npxDir, packageNameFromSpec(spec)),
      )
    ) {
      return skipped("already warmed");
    }
  }

  const warmed: string[] = [];
  const failed: Array<{ spec: string; error: string }> = [];
  for (const spec of specs) {
    const packageName = packageNameFromSpec(spec);
    if (isCached(options.npxDir, packageName)) {
      warmed.push(spec);
      continue;
    }
    try {
      const ok = await warmOne(spec, packageName, {
        env: options.env,
        npxDir: options.npxDir,
        spawnNpx: options.spawnNpx,
        isCached,
        now,
        perPackageTimeoutMs,
        pollIntervalMs,
        killGraceMs,
      });
      if (ok) warmed.push(spec);
      else failed.push({ spec, error: "timeout or not cached after spawn" });
    } catch (error) {
      failed.push({
        spec,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failed.length === 0) {
    try {
      options.writeState({
        version: options.version,
        npxDir: options.npxDir,
        specs: warmed,
        warmedAt: now(),
      });
    } catch {
      // Marker persistence is an optimisation; cache contents remain valid.
    }
  }

  const result: McpCacheWarmupResult = {
    skipped: false,
    warmed,
    failed,
    npxDir: options.npxDir,
  };
  try {
    options.onDone?.(result);
  } catch {
    // Observability must not turn best-effort warmup into a startup failure.
  }
  return result;
}
