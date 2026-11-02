/**
 * npm 包缓存维护 — 启动期 GC
 *
 * ~/.nuwaclaw/npm-cache（NPM_CONFIG_CACHE）会随 install/npx 涨到数 GB。
 * 策略（跨平台 Win/macOS/Linux）：
 * 1. 低于软上限：跳过
 * 2. 超限：先删可丢的 `_npx` 残留
 * 3. 仍超限：`npm cache clean --force`（指向 app npm-cache）；失败则直接 rm `_cacache`
 *
 * 不影响会话数据、不影响 run/projects。
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { getAppDataDir } from "./appPaths";
import { getAppEnv } from "./appEnv";
import { isWindows } from "./shellEnv";
import { getDirectorySizeBytes } from "./uvCacheMaintenance";

/** npm-cache 软上限（默认 2GiB） */
export const DEFAULT_NPM_CACHE_SOFT_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

export type NpmCacheRunResult = {
  status: number | null;
  stderr?: string;
  error?: Error;
};

export type NpmCacheMaintainOptions = {
  softLimitBytes?: number;
  /** 测试注入 */
  runNpm?: (args: string[], env: NodeJS.ProcessEnv) => NpmCacheRunResult;
  getSizeBytes?: (dir: string) => number;
  /** 测试注入：删目录 */
  removePath?: (target: string) => void;
};

export type NpmCacheMaintainResult = {
  skipped: boolean;
  reason?: string;
  clearedNpx: boolean;
  cleaned: boolean;
  beforeBytes: number;
  afterBytes: number;
  cacheDir: string;
};

export function getNpmCacheDir(): string {
  return path.join(getAppDataDir(), "npm-cache");
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GiB`;
  }
  if (n >= 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)}MiB`;
  }
  return `${Math.round(n / 1024)}KiB`;
}

function defaultRemovePath(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

function defaultRunNpm(
  args: string[],
  env: NodeJS.ProcessEnv,
): NpmCacheRunResult {
  const npmCmd = isWindows() ? "npm.cmd" : "npm";
  try {
    const result = spawnSync(npmCmd, args, {
      env,
      encoding: "utf8",
      timeout: 120_000,
      shell: isWindows(),
    });
    return {
      status: result.status,
      stderr: result.stderr?.toString() || undefined,
      error: result.error,
    };
  } catch (err) {
    return {
      status: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * 维护 ~/.nuwaclaw/npm-cache：超软上限则清 _npx，仍超则 clean。
 */
export function maintainNpmPackageCache(
  options?: NpmCacheMaintainOptions,
): NpmCacheMaintainResult {
  const softLimitBytes =
    options?.softLimitBytes ?? DEFAULT_NPM_CACHE_SOFT_LIMIT_BYTES;
  const runNpm = options?.runNpm ?? defaultRunNpm;
  const getSize = options?.getSizeBytes ?? getDirectorySizeBytes;
  const removePath = options?.removePath ?? defaultRemovePath;

  const cacheDir = getNpmCacheDir();
  const empty: NpmCacheMaintainResult = {
    skipped: true,
    clearedNpx: false,
    cleaned: false,
    beforeBytes: 0,
    afterBytes: 0,
    cacheDir,
  };

  if (!fs.existsSync(cacheDir)) {
    return { ...empty, reason: "cache dir missing" };
  }

  const beforeBytes = getSize(cacheDir);
  if (beforeBytes <= 0) {
    return { ...empty, reason: "cache empty", beforeBytes, afterBytes: 0 };
  }

  if (beforeBytes < softLimitBytes) {
    return {
      ...empty,
      reason: `below soft limit (${formatBytes(beforeBytes)} < ${formatBytes(softLimitBytes)})`,
      beforeBytes,
      afterBytes: beforeBytes,
    };
  }

  log.info(
    `[NpmCache] Maintaining cache at ${cacheDir} (${formatBytes(beforeBytes)}, softLimit=${formatBytes(softLimitBytes)})`,
  );

  let clearedNpx = false;
  let cleaned = false;

  // 1) 先清 npx 残留（可安全整删）
  const npxDir = path.join(cacheDir, "_npx");
  if (fs.existsSync(npxDir)) {
    try {
      removePath(npxDir);
      clearedNpx = true;
      log.info("[NpmCache] Cleared _npx");
    } catch (err) {
      log.warn("[NpmCache] Failed to clear _npx:", err);
    }
  }

  let afterBytes = getSize(cacheDir);

  // 2) 仍超限则 npm cache clean；失败再硬删 _cacache
  if (afterBytes >= softLimitBytes) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...getAppEnv(),
      NPM_CONFIG_CACHE: cacheDir,
    };
    const cleanResult = runNpm(["cache", "clean", "--force"], env);
    if (cleanResult.error || cleanResult.status !== 0) {
      log.warn(
        `[NpmCache] npm cache clean failed: status=${cleanResult.status}, err=${cleanResult.error?.message || cleanResult.stderr || "unknown"}; falling back to rm _cacache`,
      );
      const cacacheDir = path.join(cacheDir, "_cacache");
      if (fs.existsSync(cacacheDir)) {
        try {
          removePath(cacacheDir);
          cleaned = true;
          log.info("[NpmCache] Removed _cacache via fallback");
        } catch (err) {
          log.warn("[NpmCache] Fallback _cacache remove failed:", err);
        }
      }
    } else {
      cleaned = true;
      log.info("[NpmCache] npm cache clean completed");
    }
    afterBytes = getSize(cacheDir);
  }

  log.info(
    `[NpmCache] Maintain done: clearedNpx=${clearedNpx}, cleaned=${cleaned}, now ${formatBytes(afterBytes)}`,
  );

  return {
    skipped: false,
    clearedNpx,
    cleaned,
    beforeBytes,
    afterBytes,
    cacheDir,
  };
}
