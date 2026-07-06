/**
 * Diagnostics for nuwaxcode/OpenCode session/load failures.
 * OpenCode persists sessions under isolated HOME (XDG_DATA_HOME/opencode), not project cwd.
 */

import * as fs from "fs";
import * as path from "path";

export interface OpencodePersistenceSnapshot {
  isolatedHome: string | null;
  projectDir: string;
  opencodeDataDir: string | null;
  opencodeDataExists: boolean;
  dbFiles: Array<{ name: string; bytes: number }>;
  sessionInfoJsonCount: number;
  flowagentsSessionsInProject: boolean;
  flowagentsSessionsInIsolated: boolean;
}

export function getOpencodeDataDir(isolatedHome: string): string {
  return path.join(isolatedHome, ".local", "share", "opencode");
}

function countSessionInfoJson(dataDir: string): number {
  const infoDir = path.join(dataDir, "storage", "session", "info");
  if (!fs.existsSync(infoDir)) return 0;
  try {
    return fs.readdirSync(infoDir).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function listDbFiles(dataDir: string): Array<{ name: string; bytes: number }> {
  if (!fs.existsSync(dataDir)) return [];
  try {
    return fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith(".db"))
      .map((name) => {
        const full = path.join(dataDir, name);
        const st = fs.statSync(full);
        return { name, bytes: st.size };
      });
  } catch {
    return [];
  }
}

function hasFlowagentsSessions(root: string | null): boolean {
  if (!root) return false;
  const dir = path.join(root, ".flowagents", "sessions");
  if (!fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export function snapshotOpencodePersistence(
  isolatedHome: string | null | undefined,
  projectDir: string,
): OpencodePersistenceSnapshot {
  const home = isolatedHome ?? null;
  const opencodeDataDir = home ? getOpencodeDataDir(home) : null;
  const opencodeDataExists = opencodeDataDir
    ? fs.existsSync(opencodeDataDir)
    : false;

  return {
    isolatedHome: home,
    projectDir,
    opencodeDataDir,
    opencodeDataExists,
    dbFiles: opencodeDataDir ? listDbFiles(opencodeDataDir) : [],
    sessionInfoJsonCount: opencodeDataDir
      ? countSessionInfoJson(opencodeDataDir)
      : 0,
    flowagentsSessionsInProject: hasFlowagentsSessions(projectDir),
    flowagentsSessionsInIsolated: hasFlowagentsSessions(home),
  };
}

/** Extract ACP / SDK error fields for logging without dumping huge stacks. */
export function formatAcpLoadError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") {
    return { message: String(err) };
  }
  const e = err as Record<string, unknown>;
  const out: Record<string, unknown> = {
    name: e.name,
    message: e.message,
    code: e.code,
  };
  if ("data" in e && e.data !== undefined) out.data = e.data;
  if ("details" in e && e.details !== undefined) out.details = e.details;
  return out;
}
