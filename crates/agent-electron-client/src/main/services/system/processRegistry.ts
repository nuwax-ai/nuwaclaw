/**
 * ProcessRegistry — 进程注册中心 + 孤儿进程清理
 *
 * Layer 1: Register/Unregister — ACP 进程 spawn 时注册 PID，destroy 时注销
 * Layer 2: Periodic Sweep — 每 60s 扫描注册表，对比活跃引擎，杀掉孤儿进程
 */

import log from "electron-log";
import { killProcessTreeGraceful } from "../utils/processTree";

export interface RegisteredProcess {
  pid: number;
  engineId: string;
  engineType: "claude-code" | "nuwaxcode";
  purpose: "engine" | "warm-pool";
  registeredAt: number;
}

export interface SweepResult {
  scanned: number;
  orphans: number;
  killed: number;
}

class ProcessRegistry {
  private registry = new Map<number, RegisteredProcess>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private getActivePids: (() => Set<number>) | null = null;

  /** Grace period: skip processes registered less than this many ms ago */
  private static readonly GRACE_PERIOD_MS = 30_000;

  // === Register / Unregister ===

  register(
    pid: number,
    info: Omit<RegisteredProcess, "pid" | "registeredAt">,
  ): void {
    const entry: RegisteredProcess = {
      ...info,
      pid,
      registeredAt: Date.now(),
    };
    this.registry.set(pid, entry);
    log.info(
      `[ProcessRegistry] Registered pid=${pid} engine=${info.engineId} type=${info.engineType} purpose=${info.purpose}`,
    );
  }

  unregister(pid: number): void {
    const existed = this.registry.delete(pid);
    if (existed) {
      log.info(`[ProcessRegistry] Unregistered pid=${pid}`);
    }
  }

  // === Active PID binding ===

  bindActivePidsFn(fn: () => Set<number>): void {
    this.getActivePids = fn;
  }

  // === Periodic Sweep ===

  startPeriodicSweep(intervalMs = 300_000): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      this.sweepNow().catch((e) => {
        log.warn("[ProcessRegistry] Sweep error:", e);
      });
    }, intervalMs);
    log.info(
      `[ProcessRegistry] Periodic sweep started (interval=${intervalMs}ms)`,
    );
  }

  stopPeriodicSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
      log.info("[ProcessRegistry] Periodic sweep stopped");
    }
  }

  async sweepNow(skipGracePeriod = false): Promise<SweepResult> {
    const activePids = this.getActivePids?.() ?? new Set<number>();
    const now = Date.now();
    let scanned = 0;
    let orphans = 0;
    let killed = 0;
    const toRemove: number[] = [];

    for (const [pid, entry] of this.registry) {
      scanned++;

      // Grace period: skip recently registered processes (unless explicitly skipped)
      if (
        !skipGracePeriod &&
        now - entry.registeredAt < ProcessRegistry.GRACE_PERIOD_MS
      ) {
        continue;
      }

      // Check if process is still alive
      if (!isProcessAlive(pid)) {
        toRemove.push(pid);
        continue;
      }

      // Alive but not in active set → orphan
      if (!activePids.has(pid)) {
        orphans++;
        log.warn(
          `[ProcessRegistry] Orphan detected: pid=${pid} engine=${entry.engineId} type=${entry.engineType} purpose=${entry.purpose}`,
        );
        try {
          await killProcessTreeGraceful(pid, 5000);
          killed++;
          log.info(`[ProcessRegistry] Killed orphan pid=${pid}`);
        } catch (e) {
          log.warn(`[ProcessRegistry] Failed to kill orphan pid=${pid}:`, e);
        }
        toRemove.push(pid);
      }
    }

    // Clean up dead / killed entries
    for (const pid of toRemove) {
      this.registry.delete(pid);
    }

    if (orphans > 0) {
      log.info(
        `[ProcessRegistry] Sweep complete: scanned=${scanned}, orphans=${orphans}, killed=${killed}`,
      );
    } else {
      log.debug(
        `[ProcessRegistry] Sweep complete: scanned=${scanned}, orphans=0`,
      );
    }

    return { scanned, orphans, killed };
  }

  // === Kill All (app exit) ===

  async killAll(): Promise<void> {
    const pids = [...this.registry.keys()];
    if (pids.length === 0) return;

    log.info(
      `[ProcessRegistry] killAll: cleaning up ${pids.length} registered processes`,
    );

    await Promise.all(
      pids.map(async (pid) => {
        if (isProcessAlive(pid)) {
          try {
            await killProcessTreeGraceful(pid, 3000);
            log.info(`[ProcessRegistry] killAll: killed pid=${pid}`);
          } catch (e) {
            log.warn(
              `[ProcessRegistry] killAll: failed to kill pid=${pid}:`,
              e,
            );
          }
        }
      }),
    );

    this.registry.clear();
    log.info("[ProcessRegistry] killAll: registry cleared");
  }

  /** Kill orphans only (registered but not in active set, no grace period) */
  async killOrphans(): Promise<SweepResult> {
    return this.sweepNow(true);
  }

  /** Get the number of registered processes (for diagnostics) */
  get size(): number {
    return this.registry.size;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const processRegistry = new ProcessRegistry();
