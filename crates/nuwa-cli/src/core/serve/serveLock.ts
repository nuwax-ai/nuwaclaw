import * as fs from "node:fs";
import { cliServeLockPath, writeFileAtomic } from "../../util/paths.js";

export interface ServeLockInfo {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
}

export type ServeStatus =
  | {
      state: "running";
      pid: number;
      port: number;
      host: string;
      startedAt: string;
    }
  | {
      state: "unhealthy";
      pid: number;
      port: number;
      host: string;
      startedAt: string;
    }
  | { state: "stopped"; note?: string };

export function writeServeLock(info: ServeLockInfo): void {
  writeFileAtomic(cliServeLockPath(), JSON.stringify(info, null, 2));
}

export function readServeLock(): ServeLockInfo | null {
  try {
    return JSON.parse(
      fs.readFileSync(cliServeLockPath(), "utf-8"),
    ) as ServeLockInfo;
  } catch {
    return null;
  }
}

export function clearServeLock(): void {
  try {
    fs.unlinkSync(cliServeLockPath());
  } catch {
    // already gone — nothing to do
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process (dead); EPERM = exists but different user (alive)
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Probes `GET /health` — the one route that needs no secret — to confirm a
 * serve is actually answering, not just that a lockfile exists. Returns true
 * only on a 200 whose body looks like `{ status: "ok" }`.
 */
export async function probeServeHealth(
  host: string,
  port: number,
  timeoutMs = 1500,
): Promise<boolean> {
  const probeHost = ["0.0.0.0", "::", "::0"].includes(host)
    ? "127.0.0.1"
    : host;
  try {
    const res = await fetch(`http://${probeHost}:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body?.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Reads the serve lock and probes `/health` to determine the current serve
 * state. If the lock points at a dead PID with no `/health` response, the
 * stale lock is auto-removed so a crashed serve doesn't leave `status`
 * permanently confused.
 */
export async function getServeStatus(): Promise<ServeStatus> {
  const lock = readServeLock();
  if (!lock) return { state: "stopped" };
  if (await probeServeHealth(lock.host, lock.port)) {
    return { state: "running", ...lock };
  }
  if (!isPidAlive(lock.pid)) {
    clearServeLock();
    return {
      state: "stopped",
      note: `已清理残留锁文件（pid ${lock.pid} 已退出）`,
    };
  }
  return { state: "unhealthy", ...lock };
}
