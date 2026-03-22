/**
 * 单元测试: ProcessRegistry
 *
 * 测试进程注册、注销、定期扫描和孤儿清理逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock killProcessTreeGraceful
const mockKillProcessTreeGraceful = vi.fn().mockResolvedValue(undefined);
vi.mock("../utils/processTree", () => ({
  killProcessTreeGraceful: (...args: unknown[]) =>
    mockKillProcessTreeGraceful(...args),
}));

// Mock process.kill for isProcessAlive checks
const originalProcessKill = process.kill;

describe("ProcessRegistry", () => {
  let processRegistry: Awaited<
    typeof import("./processRegistry")
  >["processRegistry"];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();

    // Re-import to get a fresh singleton
    const mod = await import("./processRegistry");
    processRegistry = mod.processRegistry;
  });

  afterEach(() => {
    // Ensure sweep timers are stopped
    processRegistry.stopPeriodicSweep();
    vi.useRealTimers();
    process.kill = originalProcessKill;
  });

  // === Register / Unregister ===

  describe("register", () => {
    it("should register a process and increment size", () => {
      expect(processRegistry.size).toBe(0);

      processRegistry.register(1234, {
        engineId: "acp-123-abc",
        engineType: "claude-code",
        purpose: "engine",
      });

      expect(processRegistry.size).toBe(1);
    });

    it("should overwrite an existing entry for the same PID", () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });
      processRegistry.register(1234, {
        engineId: "acp-2",
        engineType: "nuwaxcode",
        purpose: "warm-pool",
      });

      expect(processRegistry.size).toBe(1);
    });

    it("should register multiple different PIDs", () => {
      processRegistry.register(100, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });
      processRegistry.register(200, {
        engineId: "acp-2",
        engineType: "nuwaxcode",
        purpose: "warm-pool",
      });

      expect(processRegistry.size).toBe(2);
    });
  });

  describe("unregister", () => {
    it("should remove a registered process", () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });
      expect(processRegistry.size).toBe(1);

      processRegistry.unregister(1234);
      expect(processRegistry.size).toBe(0);
    });

    it("should be idempotent for non-existent PID", () => {
      processRegistry.unregister(9999);
      expect(processRegistry.size).toBe(0);
    });

    it("should be idempotent when called twice", () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      processRegistry.unregister(1234);
      processRegistry.unregister(1234);
      expect(processRegistry.size).toBe(0);
    });
  });

  // === sweepNow ===

  describe("sweepNow", () => {
    it("should return zeroes when registry is empty", async () => {
      const result = await processRegistry.sweepNow();
      expect(result).toEqual({ scanned: 0, orphans: 0, killed: 0 });
    });

    it("should skip processes within grace period", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      // Don't advance time — still within grace period
      const result = await processRegistry.sweepNow();
      expect(result.scanned).toBe(1);
      expect(result.orphans).toBe(0);
      expect(processRegistry.size).toBe(1);
    });

    it("should remove dead processes after grace period", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      // Advance past grace period
      vi.advanceTimersByTime(31_000);

      // Mock process as dead
      process.kill = vi.fn(() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      const result = await processRegistry.sweepNow();
      expect(result.scanned).toBe(1);
      expect(result.orphans).toBe(0); // Dead, not orphan
      expect(processRegistry.size).toBe(0); // Removed
    });

    it("should detect and kill orphan processes", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      // Advance past grace period
      vi.advanceTimersByTime(31_000);

      // Mock process as alive
      process.kill = vi.fn() as unknown as typeof process.kill;

      // No active PIDs bound (or bound with empty set)
      processRegistry.bindActivePidsFn(() => new Set());

      const result = await processRegistry.sweepNow();
      expect(result.scanned).toBe(1);
      expect(result.orphans).toBe(1);
      expect(result.killed).toBe(1);
      expect(mockKillProcessTreeGraceful).toHaveBeenCalledWith(1234, 5000);
      expect(processRegistry.size).toBe(0);
    });

    it("should not kill active processes", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      vi.advanceTimersByTime(31_000);

      // Mock process as alive
      process.kill = vi.fn() as unknown as typeof process.kill;

      // PID 1234 is active
      processRegistry.bindActivePidsFn(() => new Set([1234]));

      const result = await processRegistry.sweepNow();
      expect(result.scanned).toBe(1);
      expect(result.orphans).toBe(0);
      expect(result.killed).toBe(0);
      expect(mockKillProcessTreeGraceful).not.toHaveBeenCalled();
      expect(processRegistry.size).toBe(1); // Still registered
    });

    it("should handle killProcessTreeGraceful failure gracefully", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      vi.advanceTimersByTime(31_000);
      process.kill = vi.fn() as unknown as typeof process.kill;
      processRegistry.bindActivePidsFn(() => new Set());

      mockKillProcessTreeGraceful.mockRejectedValueOnce(
        new Error("kill failed"),
      );

      const result = await processRegistry.sweepNow();
      expect(result.scanned).toBe(1);
      expect(result.orphans).toBe(1);
      expect(result.killed).toBe(0); // Failed to kill
      expect(processRegistry.size).toBe(0); // Still removed from registry
    });
  });

  // === killOrphans (no grace period) ===

  describe("killOrphans", () => {
    it("should skip grace period and kill orphans immediately", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      // Do NOT advance time — process was just registered
      process.kill = vi.fn() as unknown as typeof process.kill;
      processRegistry.bindActivePidsFn(() => new Set());

      const result = await processRegistry.killOrphans();
      expect(result.orphans).toBe(1);
      expect(result.killed).toBe(1);
      expect(mockKillProcessTreeGraceful).toHaveBeenCalledWith(1234, 5000);
    });

    it("should not kill active processes even without grace period", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      process.kill = vi.fn() as unknown as typeof process.kill;
      processRegistry.bindActivePidsFn(() => new Set([1234]));

      const result = await processRegistry.killOrphans();
      expect(result.orphans).toBe(0);
      expect(processRegistry.size).toBe(1);
    });
  });

  // === killAll ===

  describe("killAll", () => {
    it("should do nothing when registry is empty", async () => {
      await processRegistry.killAll();
      expect(mockKillProcessTreeGraceful).not.toHaveBeenCalled();
    });

    it("should kill all registered processes", async () => {
      processRegistry.register(100, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });
      processRegistry.register(200, {
        engineId: "acp-2",
        engineType: "nuwaxcode",
        purpose: "warm-pool",
      });

      // Mock both as alive
      process.kill = vi.fn() as unknown as typeof process.kill;

      await processRegistry.killAll();

      expect(mockKillProcessTreeGraceful).toHaveBeenCalledTimes(2);
      expect(mockKillProcessTreeGraceful).toHaveBeenCalledWith(100, 3000);
      expect(mockKillProcessTreeGraceful).toHaveBeenCalledWith(200, 3000);
      expect(processRegistry.size).toBe(0);
    });

    it("should skip already-dead processes", async () => {
      processRegistry.register(100, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      // Mock process as dead
      process.kill = vi.fn(() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      await processRegistry.killAll();

      expect(mockKillProcessTreeGraceful).not.toHaveBeenCalled();
      expect(processRegistry.size).toBe(0); // Still cleared
    });
  });

  // === Periodic Sweep ===

  describe("startPeriodicSweep / stopPeriodicSweep", () => {
    it("should not start duplicate timers", () => {
      processRegistry.startPeriodicSweep(60_000);
      processRegistry.startPeriodicSweep(60_000); // Should be a no-op
      processRegistry.stopPeriodicSweep();
    });

    it("should run sweep on interval", async () => {
      // Register an orphan process past grace period
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });
      processRegistry.bindActivePidsFn(() => new Set());

      // Mock process as alive
      process.kill = vi.fn() as unknown as typeof process.kill;

      processRegistry.startPeriodicSweep(1000);

      // Advance past grace period + one sweep interval
      vi.advanceTimersByTime(31_000);

      // Let async sweep complete
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockKillProcessTreeGraceful).toHaveBeenCalledWith(1234, 5000);
    });

    it("stopPeriodicSweep should be safe when no sweep is running", () => {
      processRegistry.stopPeriodicSweep(); // Should not throw
    });
  });

  // === bindActivePidsFn ===

  describe("bindActivePidsFn", () => {
    it("should use empty set when no function is bound", async () => {
      processRegistry.register(1234, {
        engineId: "acp-1",
        engineType: "claude-code",
        purpose: "engine",
      });

      vi.advanceTimersByTime(31_000);
      process.kill = vi.fn() as unknown as typeof process.kill;

      // No bindActivePidsFn called — should treat all as orphans
      const result = await processRegistry.sweepNow();
      expect(result.orphans).toBe(1);
    });
  });
});
