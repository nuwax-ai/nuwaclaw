/**
 * uv 包缓存维护 — 启动期 GC
 *
 * ~/.nuwaclaw/uv/cache（尤其 archive-v0 整份 venv 归档）会膨胀到数 GB。
 * 策略：
 * 1. 启动后台执行 `uv cache prune`（清不可达对象，相对安全）
 * 2. prune 后若仍超过软上限，再执行 `uv cache clean`（整清，下次重下）
 *
 * 不触碰 UV_PYTHON_INSTALL_DIR（解释器保留）。
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { getAppDataDir } from "./appPaths";
import { getUvBinPath } from "./binaryLocator";

/** uv cache 软上限：超过则 prune 后仍超则 clean（默认 2GiB） */
export const DEFAULT_UV_CACHE_SOFT_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

export type UvCacheRunResult = {
  status: number | null;
  stderr?: string;
  error?: Error;
};

export type UvCacheMaintainOptions = {
  softLimitBytes?: number;
  /** 是否在低于软上限时也执行 prune（默认 false，避免每次启动开销） */
  alwaysPrune?: boolean;
  /** 测试注入：执行 uv 子命令 */
  runUv?: (args: string[], env: NodeJS.ProcessEnv) => UvCacheRunResult;
  /** 测试注入：目录体积 */
  getSizeBytes?: (dir: string) => number;
};

export type UvCacheMaintainResult = {
  skipped: boolean;
  reason?: string;
  pruned: boolean;
  cleaned: boolean;
  beforeBytes: number;
  afterBytes: number;
  cacheDir: string;
};

export function getUvCacheDir(): string {
  return path.join(getAppDataDir(), "uv", "cache");
}

/** 递归统计目录字节数（跨平台；大目录可在后台调用） */
export function getDirectorySizeBytes(dir: string): number {
  let total = 0;
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          total += fs.lstatSync(full).size;
        }
      } catch {
        // 忽略竞态 / 权限错误
      }
    }
  };
  walk(dir);
  return total;
}

function defaultRunUv(
  args: string[],
  env: NodeJS.ProcessEnv,
): UvCacheRunResult {
  const uvBin = getUvBinPath();
  if (!fs.existsSync(uvBin)) {
    return {
      status: null,
      error: new Error(`uv binary not found: ${uvBin}`),
    };
  }
  try {
    const result = spawnSync(uvBin, args, {
      env,
      encoding: "utf8",
      timeout: 120_000,
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

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GiB`;
  }
  if (n >= 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)}MiB`;
  }
  return `${Math.round(n / 1024)}KiB`;
}

/**
 * 维护 ~/.nuwaclaw/uv/cache：必要时 prune，仍超软上限则 clean。
 */
export function maintainUvPackageCache(
  options?: UvCacheMaintainOptions,
): UvCacheMaintainResult {
  const softLimitBytes =
    options?.softLimitBytes ?? DEFAULT_UV_CACHE_SOFT_LIMIT_BYTES;
  const alwaysPrune = options?.alwaysPrune ?? false;
  const runUv = options?.runUv ?? defaultRunUv;
  const getSize = options?.getSizeBytes ?? getDirectorySizeBytes;

  const cacheDir = getUvCacheDir();
  const empty: UvCacheMaintainResult = {
    skipped: true,
    pruned: false,
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

  if (!alwaysPrune && beforeBytes < softLimitBytes) {
    return {
      ...empty,
      reason: `below soft limit (${formatBytes(beforeBytes)} < ${formatBytes(softLimitBytes)})`,
      beforeBytes,
      afterBytes: beforeBytes,
    };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    UV_CACHE_DIR: cacheDir,
  };

  let pruned = false;
  let cleaned = false;

  log.info(
    `[UvCache] Maintaining cache at ${cacheDir} (${formatBytes(beforeBytes)}, softLimit=${formatBytes(softLimitBytes)})`,
  );

  const pruneResult = runUv(["cache", "prune", "--force"], env);
  if (pruneResult.error || pruneResult.status !== 0) {
    log.warn(
      `[UvCache] prune failed: status=${pruneResult.status}, err=${pruneResult.error?.message || pruneResult.stderr || "unknown"}`,
    );
  } else {
    pruned = true;
    log.info("[UvCache] prune completed");
  }

  let afterBytes = getSize(cacheDir);

  if (afterBytes >= softLimitBytes) {
    log.info(
      `[UvCache] Still over soft limit (${formatBytes(afterBytes)}), running cache clean`,
    );
    const cleanResult = runUv(["cache", "clean", "--force"], env);
    if (cleanResult.error || cleanResult.status !== 0) {
      log.warn(
        `[UvCache] clean failed: status=${cleanResult.status}, err=${cleanResult.error?.message || cleanResult.stderr || "unknown"}`,
      );
    } else {
      cleaned = true;
      afterBytes = getSize(cacheDir);
      log.info(`[UvCache] clean completed, now ${formatBytes(afterBytes)}`);
    }
  }

  return {
    skipped: false,
    pruned,
    cleaned,
    beforeBytes,
    afterBytes,
    cacheDir,
  };
}
