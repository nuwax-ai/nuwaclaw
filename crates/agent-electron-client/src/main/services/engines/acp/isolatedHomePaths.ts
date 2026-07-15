/**
 * ACP isolated HOME 路径解析与生命周期辅助。
 *
 * Computer 路径：~/.nuwaclaw/run/projects/{userId}/{workDirId}/{engine}/home/
 * 其他：run/acp-{timestamp}-{rand}（可删除）
 */

import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { getAppDataDir } from "../../system/appPaths";
import type { AgentEngineType } from "../types";

export type IsolatedHomeScopeKind = "project" | "ephemeral";

export interface IsolatedHomeScope {
  kind: IsolatedHomeScopeKind;
  userId?: string;
  workDirId?: string;
  engine?: AgentEngineType;
}

export const DEFAULT_PROJECT_HOME_RETENTION_DAYS = 7;
/** orphan ephemeral run/acp-* 默认保留天数 */
export const DEFAULT_EPHEMERAL_HOME_RETENTION_DAYS = 1;
/** project home 内可重建缓存（.cache/.npm 等）默认保留天数 */
export const DEFAULT_PROJECT_CACHE_RETENTION_DAYS = 2;
/** project home 内 tmp 默认保留天数（更短，多为 compile-cache） */
export const DEFAULT_PROJECT_TMP_RETENTION_DAYS = 1;

const RUN_SEGMENT = "run";
const PROJECTS_SEGMENT = "projects";
const HOME_SEGMENT = "home";
/** project home 下可安全删除的可重建缓存目录名（不含 tmp，tmp 单独用更短 TTL） */
const PROJECT_CACHE_DIR_NAMES = [".cache", ".npm"] as const;
/** 额外可清理的路径（相对 home）；不碰 opencode.db* 与 flowagents */
const PROJECT_CACHE_RELATIVE_PATHS = [
  path.join(".local", "share", "pnpm"),
  path.join(".local", "share", "uv"),
  path.join(".local", "share", "opencode", "log"),
] as const;

/** 拒绝路径穿越与分隔符，非法字符替换为下划线 */
export function sanitizePathSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return "_";
  return trimmed
    .replace(/[/\\]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[^\w.\-@+]/g, "_");
}

export function getRunRoot(): string {
  return path.join(getAppDataDir(), RUN_SEGMENT);
}

export function getProjectIsolatedHomesRoot(): string {
  return path.join(getAppDataDir(), RUN_SEGMENT, PROJECTS_SEGMENT);
}

export function resolveProjectIsolatedHomeDir(
  scope: IsolatedHomeScope,
): string {
  if (scope.kind !== "project") {
    throw new Error(
      `resolveProjectIsolatedHomeDir requires project scope, got ${scope.kind}`,
    );
  }
  const userId = sanitizePathSegment(scope.userId || "_");
  const workDirId = sanitizePathSegment(scope.workDirId || "_");
  const engine = sanitizePathSegment(scope.engine || "unknown");
  return path.join(
    getProjectIsolatedHomesRoot(),
    userId,
    workDirId,
    engine,
    HOME_SEGMENT,
  );
}

export function resolveEphemeralIsolatedHomeDir(): string {
  const runId = `acp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  return path.join(getAppDataDir(), RUN_SEGMENT, runId);
}

export function resolveIsolatedHomePath(scope: IsolatedHomeScope): {
  homeDir: string;
  runId: string;
} {
  switch (scope.kind) {
    case "project": {
      const homeDir = resolveProjectIsolatedHomeDir(scope);
      const workDirId = sanitizePathSegment(scope.workDirId || "unknown");
      const engine = sanitizePathSegment(scope.engine || "unknown");
      return {
        homeDir,
        runId: `project-${workDirId}-${engine}`,
      };
    }
    case "ephemeral": {
      const homeDir = resolveEphemeralIsolatedHomeDir();
      return {
        homeDir,
        runId: path.basename(homeDir),
      };
    }
    default: {
      const _exhaustive: never = scope.kind;
      throw new Error(`Unknown isolated home scope: ${_exhaustive}`);
    }
  }
}

/** 是否为应跨进程保留的 project 稳定 HOME */
export function isPersistentIsolatedHome(
  homeDir: string | null | undefined,
): boolean {
  if (!homeDir) return false;
  const normalized = path.normalize(homeDir);
  const projectsRoot = path.normalize(getProjectIsolatedHomesRoot());
  return (
    normalized === projectsRoot ||
    normalized.startsWith(projectsRoot + path.sep)
  );
}

function removeEmptyParentsUpTo(dir: string, stopAt: string): void {
  let current = dir;
  const stop = path.normalize(stopAt);
  while (current.startsWith(stop) && current !== stop) {
    try {
      if (fs.readdirSync(current).length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

function shouldSkipHomeForPrune(
  homeDir: string,
  skipPaths?: Set<string>,
): boolean {
  if (!skipPaths || skipPaths.size === 0) return false;
  const normalized = path.normalize(homeDir);
  for (const skip of skipPaths) {
    const normalizedSkip = path.normalize(skip);
    if (
      normalized === normalizedSkip ||
      normalized.startsWith(normalizedSkip + path.sep) ||
      normalizedSkip.startsWith(normalized + path.sep)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 清理 mtime 超过 maxAgeDays 的 project isolated home。
 * 扫描 run/projects 下各层 home 目录，跳过活跃引擎路径。
 */
export function pruneStaleProjectIsolatedHomes(
  maxAgeDays = DEFAULT_PROJECT_HOME_RETENTION_DAYS,
  options?: { skipPaths?: Set<string> },
): number {
  const projectsRoot = getProjectIsolatedHomesRoot();
  if (!fs.existsSync(projectsRoot)) return 0;

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deleted = 0;

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.name === HOME_SEGMENT) {
        const parentEngineDir = path.dirname(fullPath);
        if (shouldSkipHomeForPrune(fullPath, options?.skipPaths)) {
          continue;
        }
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(fullPath).mtimeMs;
        } catch {
          continue;
        }
        if (now - mtimeMs <= maxAgeMs) continue;

        try {
          fs.rmSync(parentEngineDir, { recursive: true, force: true });
          deleted++;
          log.info(
            `[IsolatedHome] Pruned stale project home (>${maxAgeDays}d): ${fullPath}`,
          );
          removeEmptyParentsUpTo(path.dirname(parentEngineDir), projectsRoot);
        } catch (err) {
          log.warn(`[IsolatedHome] Prune failed for ${fullPath}:`, err);
        }
        continue;
      }

      walk(fullPath);
    }
  };

  walk(projectsRoot);

  if (deleted > 0) {
    log.info(
      `[IsolatedHome] Prune complete: deleted ${deleted} stale engine home(s)`,
    );
  }
  return deleted;
}

/**
 * 清理 mtime 超过 maxAgeDays 的 orphan ephemeral 目录（run/acp-*）。
 * 不碰 run/projects/；跳过活跃引擎路径。
 */
export function pruneOrphanEphemeralIsolatedHomes(
  maxAgeDays = DEFAULT_EPHEMERAL_HOME_RETENTION_DAYS,
  options?: { skipPaths?: Set<string> },
): number {
  const runRoot = getRunRoot();
  if (!fs.existsSync(runRoot)) return 0;

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deleted = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runRoot, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // 仅 GC 临时 run：acp-{timestamp}-{rand}
    if (!entry.name.startsWith("acp-")) continue;

    const fullPath = path.join(runRoot, entry.name);
    if (shouldSkipHomeForPrune(fullPath, options?.skipPaths)) {
      continue;
    }

    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(fullPath).mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs <= maxAgeMs) continue;

    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      deleted++;
      log.info(
        `[IsolatedHome] Pruned orphan ephemeral home (>${maxAgeDays}d): ${fullPath}`,
      );
    } catch (err) {
      log.warn(`[IsolatedHome] Ephemeral prune failed for ${fullPath}:`, err);
    }
  }

  if (deleted > 0) {
    log.info(
      `[IsolatedHome] Ephemeral prune complete: deleted ${deleted} orphan dir(s)`,
    );
  }
  return deleted;
}

function tryPruneCachePath(
  cachePath: string,
  maxAgeMs: number,
  now: number,
  maxAgeDays: number,
): boolean {
  let mtimeMs = 0;
  try {
    if (!fs.existsSync(cachePath)) return false;
    mtimeMs = fs.statSync(cachePath).mtimeMs;
  } catch {
    return false;
  }
  if (now - mtimeMs <= maxAgeMs) return false;

  try {
    fs.rmSync(cachePath, { recursive: true, force: true });
    log.info(
      `[IsolatedHome] Pruned project cache (>${maxAgeDays}d): ${cachePath}`,
    );
    return true;
  } catch (err) {
    log.warn(
      `[IsolatedHome] Project cache prune failed for ${cachePath}:`,
      err,
    );
    return false;
  }
}

/**
 * 清理 project home 内可重建缓存。
 * - .cache / .npm / .local/share/{pnpm,uv} / opencode/log：默认 maxAgeDays
 * - tmp：默认更短 TTL（tmpMaxAgeDays）
 * 保留 .claude、.nuwaxcode、.flowagents、.config、opencode.db* 等会话数据。
 */
export function pruneProjectIsolatedHomeCaches(
  maxAgeDays = DEFAULT_PROJECT_CACHE_RETENTION_DAYS,
  options?: { skipPaths?: Set<string>; tmpMaxAgeDays?: number },
): number {
  const projectsRoot = getProjectIsolatedHomesRoot();
  if (!fs.existsSync(projectsRoot)) return 0;

  const tmpMaxAgeDays =
    options?.tmpMaxAgeDays ?? DEFAULT_PROJECT_TMP_RETENTION_DAYS;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const tmpMaxAgeMs = tmpMaxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deleted = 0;

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.name === HOME_SEGMENT) {
        if (shouldSkipHomeForPrune(fullPath, options?.skipPaths)) {
          continue;
        }

        for (const name of PROJECT_CACHE_DIR_NAMES) {
          if (
            tryPruneCachePath(
              path.join(fullPath, name),
              maxAgeMs,
              now,
              maxAgeDays,
            )
          ) {
            deleted++;
          }
        }
        // tmp 使用更短 TTL：多为 node-compile-cache / tsx 等可重建内容
        if (
          tryPruneCachePath(
            path.join(fullPath, "tmp"),
            tmpMaxAgeMs,
            now,
            tmpMaxAgeDays,
          )
        ) {
          deleted++;
        }
        for (const rel of PROJECT_CACHE_RELATIVE_PATHS) {
          if (
            tryPruneCachePath(
              path.join(fullPath, rel),
              maxAgeMs,
              now,
              maxAgeDays,
            )
          ) {
            deleted++;
          }
        }
        continue;
      }

      walk(fullPath);
    }
  };

  walk(projectsRoot);

  if (deleted > 0) {
    log.info(
      `[IsolatedHome] Project cache prune complete: deleted ${deleted} cache dir(s)`,
    );
  }
  return deleted;
}
