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

const RUN_SEGMENT = "run";
const PROJECTS_SEGMENT = "projects";
const HOME_SEGMENT = "home";

/** 拒绝路径穿越与分隔符，非法字符替换为下划线 */
export function sanitizePathSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return "_";
  return trimmed
    .replace(/[/\\]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[^\w.\-@+]/g, "_");
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
