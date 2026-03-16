/**
 * Process tree kill utility.
 *
 * Kills a process and all its descendants to prevent zombie processes.
 * - Unix: Uses process group kill (-pid) when spawned with detached: true
 * - Windows: Uses taskkill /T /F /PID for tree kill
 * - Fallback: SIGTERM → wait → SIGKILL
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
 * 1. Send SIGTERM (or specified signal) to the process tree
 * 2. Wait up to `timeoutMs` for the process to exit
 * 3. If still alive, send SIGKILL to the process tree
 *
 * @param pid - Process ID to kill
 * @param timeoutMs - Time to wait before escalating to SIGKILL (default: 5000ms)
 */
export async function killProcessTreeGraceful(
  pid: number,
  timeoutMs = 5000,
): Promise<void> {
  // Step 1: Send SIGTERM
  try {
    await killProcessTree(pid, "SIGTERM");
  } catch (e) {
    log.warn(`[processTree] SIGTERM failed for pid ${pid}:`, e);
  }

  // Step 2: Wait for process to exit
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

function killProcessTreeUnix(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      // Try process group kill first (requires detached: true on spawn)
      process.kill(-pid, signal);
      log.info(`[processTree] Sent ${signal} to process group -${pid}`);
    } catch (e: any) {
      if (e.code === "ESRCH") {
        // Process already gone
        log.info(`[processTree] Process group -${pid} already exited`);
      } else {
        // Process group kill failed, try direct kill
        log.warn(
          `[processTree] Group kill failed, trying direct kill for pid ${pid}:`,
          e.message,
        );
        try {
          process.kill(pid, signal);
        } catch (e2: any) {
          if (e2.code !== "ESRCH") {
            log.warn(
              `[processTree] Direct kill also failed for pid ${pid}:`,
              e2.message,
            );
          }
        }
      }
    }
    resolve();
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
