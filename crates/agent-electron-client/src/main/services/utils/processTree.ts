/**
 * Process tree kill utility.
 *
 * Kills a process and all its descendants to prevent zombie processes.
 *
 * Strategy (Unix):
 * 1. Try process group kill (-pid) — works when spawned with detached: true
 *    and setsid() succeeds (PGID = pid).
 * 2. Fall back to recursive descendant kill via `pgrep -P` — handles the case
 *    where detached: true didn't create a new process group (e.g. dev mode
 *    under make → Electron, where all processes share the terminal's PGID).
 * 3. Kill the root process directly.
 *
 * Windows: Uses taskkill /T /F /PID for tree kill.
 */

import { execFile } from "child_process";
import log from "electron-log";

const isWindows = process.platform === "win32";

/**
 * Kill a process tree (the process and all its descendants).
 *
 * @param pid - Process ID to kill
 * @param signal - Signal to send (default: SIGTERM). Ignored on Windows (always force-kills).
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (isWindows) {
    return killProcessTreeWindows(pid);
  }
  return killProcessTreeUnix(pid, signal);
}

/**
 * Kill a process tree with graceful escalation:
 * 1. Send SIGTERM to the process tree
 * 2. Wait up to `timeoutMs` for the root process to exit
 * 3. If still alive, send SIGKILL to the process tree
 *
 * @param pid - Process ID to kill
 * @param timeoutMs - Time to wait before escalating to SIGKILL (default: 5000ms)
 */
export async function killProcessTreeGraceful(
  pid: number,
  timeoutMs = 5000,
): Promise<void> {
  // Step 1: Send SIGTERM to the entire tree
  try {
    await killProcessTree(pid, "SIGTERM");
  } catch (e) {
    log.warn(`[processTree] SIGTERM failed for pid ${pid}:`, e);
  }

  // Step 2: Wait for root process to exit
  const alive = await waitForExit(pid, timeoutMs);

  // Step 3: Escalate to SIGKILL if still alive
  if (alive) {
    log.warn(
      `[processTree] Process ${pid} still alive after ${timeoutMs}ms, sending SIGKILL`,
    );
    try {
      await killProcessTree(pid, "SIGKILL");
    } catch (e) {
      log.warn(`[processTree] SIGKILL failed for pid ${pid}:`, e);
    }
  }
}

// ==================== Internal ====================

function killProcessTreeWindows(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("taskkill", ["/T", "/F", "/PID", String(pid)], (err) => {
      if (err) {
        // taskkill returns exit code 128 if process not found — treat as success
        const code = (err as any).code;
        if (code === 128 || code === "ESRCH") {
          resolve();
        } else {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  });
}

/**
 * Kill a process and all its descendants on Unix.
 *
 * Two strategies, tried in order:
 * 1. Process group kill: `kill(-pid, signal)` — fast, kills all processes whose
 *    PGID equals `pid`. Works when child was spawned with `detached: true` and
 *    setsid() actually created a new process group.
 * 2. Recursive descendant kill: walks the process tree using `pgrep -P` and
 *    kills each descendant bottom-up. This handles the case where the process
 *    group was NOT changed (e.g. Electron dev mode under make, where all
 *    processes share the terminal's PGID).
 */
async function killProcessTreeUnix(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  let groupKillWorked = false;

  // Strategy 1: Try process group kill
  try {
    process.kill(-pid, signal);
    groupKillWorked = true;
    log.info(`[processTree] Sent ${signal} to process group -${pid}`);
  } catch (e: any) {
    if (e.code === "ESRCH") {
      // ESRCH from group kill means no process with PGID=pid exists.
      // But the process itself may still be alive with a different PGID
      // (e.g. dev mode where detached: true didn't create a new group).
      log.info(
        `[processTree] No process group -${pid}, falling back to descendant kill`,
      );
    } else {
      log.warn(`[processTree] Group kill failed for pid ${pid}:`, e.message);
    }
  }

  // Strategy 2: Recursive descendant kill (always run as safety net)
  if (!groupKillWorked) {
    const descendants = await getDescendants(pid);
    if (descendants.length > 0) {
      log.info(
        `[processTree] Killing ${descendants.length} descendant(s) of pid ${pid}: ${descendants.join(",")}`,
      );
    }
    // Kill bottom-up (children first, then parent)
    for (const childPid of descendants.reverse()) {
      try {
        process.kill(childPid, signal);
      } catch {
        // ESRCH — already dead, ignore
      }
    }
    // Kill root process
    try {
      process.kill(pid, signal);
    } catch (e: any) {
      if (e.code !== "ESRCH") {
        log.warn(`[processTree] Direct kill failed for pid ${pid}:`, e.message);
      }
    }
  }
}

/**
 * Get all descendant PIDs of a process (children, grandchildren, etc.)
 * using `pgrep -P`. Returns PIDs in depth-first order.
 */
async function getDescendants(pid: number): Promise<number[]> {
  const result: number[] = [];
  const children = await getChildPids(pid);
  for (const child of children) {
    result.push(child);
    const grandchildren = await getDescendants(child);
    result.push(...grandchildren);
  }
  return result;
}

/**
 * Get direct child PIDs of a process using `pgrep -P`.
 */
function getChildPids(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile("pgrep", ["-P", String(pid)], (err, stdout) => {
      if (err || !stdout.trim()) {
        // No children or pgrep failed
        resolve([]);
        return;
      }
      const pids = stdout
        .trim()
        .split("\n")
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));
      resolve(pids);
    });
  });
}

/**
 * Check if a process is still alive, polling until timeout.
 * Returns true if still alive, false if exited.
 */
function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      try {
        // signal 0 doesn't kill, just checks if process exists
        process.kill(pid, 0);
        // Still alive
        if (Date.now() - start >= timeoutMs) {
          resolve(true);
        } else {
          setTimeout(check, 200);
        }
      } catch {
        // Process gone
        resolve(false);
      }
    };
    check();
  });
}
