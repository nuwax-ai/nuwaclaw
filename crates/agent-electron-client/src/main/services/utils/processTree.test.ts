/**
 * Unit tests: processTree (process tree kill utility)
 *
 * Covers:
 * 1. killProcessTree on Unix — group kill, descendant fallback, ESRCH
 * 2. killProcessTree on Windows — taskkill args, exit code 128, other errors
 * 3. killProcessTreeGraceful — SIGTERM-only, SIGKILL escalation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────

const mockExecFile = vi.fn();

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("electron-log", () => ({ default: mockLog }));

// ── Helpers ──────────────────────────────────────────────────

/**
 * Set up mockExecFile to handle pgrep calls (return no children by default).
 * Can be overridden by setting up a custom implementation before the test.
 */
function mockPgrepNoChildren() {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      _args: string[],
      cb: (err: Error | null, stdout?: string) => void,
    ) => {
      if (cmd === "pgrep") {
        // No children found
        cb(new Error("no match"), "");
        return;
      }
      cb(null);
    },
  );
}

// ── Tests ──────────────────────────────────────────────────

describe("processTree", () => {
  let processKillSpy: ReturnType<typeof vi.spyOn>;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    processKillSpy = vi.spyOn(process, "kill").mockImplementation(
      // Default: process.kill succeeds (no-op)
      () => true,
    );
    mockPgrepNoChildren();
  });

  afterEach(() => {
    processKillSpy.mockRestore();
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
  }

  // ── killProcessTree (Unix) ──

  describe("killProcessTree (Unix)", () => {
    it("should call process.kill(-pid, signal) for group kill", async () => {
      setPlatform("darwin");

      const { killProcessTree } = await import("./processTree");
      await killProcessTree(1234, "SIGTERM");

      expect(processKillSpy).toHaveBeenCalledWith(-1234, "SIGTERM");
    });

    it("should fall back to descendant kill when group kill fails with non-ESRCH error", async () => {
      setPlatform("darwin");

      const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });
      processKillSpy.mockImplementation(
        (pid: number, _signal?: string | number) => {
          if (pid < 0) throw epermError; // group kill fails
          return true; // direct kill succeeds
        },
      );

      const { killProcessTree } = await import("./processTree");
      await killProcessTree(1234, "SIGTERM");

      // First call: group kill (-1234) — fails with EPERM
      expect(processKillSpy).toHaveBeenCalledWith(-1234, "SIGTERM");
      // Falls back to descendant kill: pgrep returns no children, so kills root directly
      expect(processKillSpy).toHaveBeenCalledWith(1234, "SIGTERM");
    });

    it("should fall back to descendant kill on ESRCH (group doesn't exist but process may be alive)", async () => {
      setPlatform("darwin");

      const esrchError = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      processKillSpy.mockImplementation(
        (pid: number, _signal?: string | number) => {
          if (pid < 0) throw esrchError; // group doesn't exist
          return true; // direct kill succeeds
        },
      );

      const { killProcessTree } = await import("./processTree");
      await killProcessTree(1234, "SIGTERM");

      // Group kill attempted first
      expect(processKillSpy).toHaveBeenCalledWith(-1234, "SIGTERM");
      // Falls back to descendant kill: kills root process directly
      expect(processKillSpy).toHaveBeenCalledWith(1234, "SIGTERM");
    });

    it("should kill descendants found by pgrep", async () => {
      setPlatform("darwin");

      const esrchError = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      processKillSpy.mockImplementation(
        (pid: number, _signal?: string | number) => {
          if (pid < 0) throw esrchError; // group doesn't exist
          return true;
        },
      );

      // pgrep returns children for pid 1234, no grandchildren
      mockExecFile.mockImplementation(
        (
          cmd: string,
          args: string[],
          cb: (err: Error | null, stdout?: string) => void,
        ) => {
          if (cmd === "pgrep" && args[1] === "1234") {
            cb(null, "5555\n6666\n");
            return;
          }
          if (cmd === "pgrep") {
            cb(new Error("no match"), "");
            return;
          }
          cb(null);
        },
      );

      const { killProcessTree } = await import("./processTree");
      await killProcessTree(1234, "SIGTERM");

      // Should kill children (bottom-up: reversed) then root
      expect(processKillSpy).toHaveBeenCalledWith(6666, "SIGTERM");
      expect(processKillSpy).toHaveBeenCalledWith(5555, "SIGTERM");
      expect(processKillSpy).toHaveBeenCalledWith(1234, "SIGTERM");
    });

    it("should use SIGTERM as default signal", async () => {
      setPlatform("darwin");

      const { killProcessTree } = await import("./processTree");
      await killProcessTree(5678);

      expect(processKillSpy).toHaveBeenCalledWith(-5678, "SIGTERM");
    });
  });

  // ── killProcessTree (Windows) ──

  describe("killProcessTree (Windows)", () => {
    it("should call taskkill with correct args", async () => {
      setPlatform("win32");

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
          cb(null);
        },
      );

      const { killProcessTree } = await import("./processTree");
      await killProcessTree(4567);

      expect(mockExecFile).toHaveBeenCalledWith(
        "taskkill",
        ["/T", "/F", "/PID", "4567"],
        expect.any(Function),
      );
    });

    it("should resolve when process not found (exit code 128)", async () => {
      setPlatform("win32");

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
          const err = Object.assign(new Error("process not found"), {
            code: 128,
          });
          cb(err);
        },
      );

      const { killProcessTree } = await import("./processTree");
      await expect(killProcessTree(4567)).resolves.toBeUndefined();
    });

    it("should resolve when process not found (ESRCH code)", async () => {
      setPlatform("win32");

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
          const err = Object.assign(new Error("no such process"), {
            code: "ESRCH",
          });
          cb(err);
        },
      );

      const { killProcessTree } = await import("./processTree");
      await expect(killProcessTree(4567)).resolves.toBeUndefined();
    });

    it("should reject on other errors", async () => {
      setPlatform("win32");

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
          const err = Object.assign(new Error("access denied"), {
            code: 5,
          });
          cb(err);
        },
      );

      const { killProcessTree } = await import("./processTree");
      await expect(killProcessTree(4567)).rejects.toThrow("access denied");
    });
  });

  // ── killProcessTreeGraceful ──

  describe("killProcessTreeGraceful", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should only send SIGTERM when process exits promptly", async () => {
      setPlatform("darwin");

      let killCallCount = 0;
      processKillSpy.mockImplementation(
        (pid: number, signal?: string | number) => {
          killCallCount++;
          // First call: group kill with SIGTERM (succeeds)
          if (killCallCount === 1) {
            expect(pid).toBe(-9999);
            expect(signal).toBe("SIGTERM");
            return true;
          }
          // Second call: waitForExit check with signal 0 → process gone
          if (signal === 0) {
            const err = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
            throw err;
          }
          return true;
        },
      );

      const { killProcessTreeGraceful } = await import("./processTree");
      const promise = killProcessTreeGraceful(9999, 3000);

      // Advance timers to let waitForExit polling run
      await vi.advanceTimersByTimeAsync(0);

      await promise;

      // SIGKILL should NOT have been sent — no log.warn about escalation
      const warnCalls = mockLog.warn.mock.calls.map((c) => c[0]);
      expect(warnCalls).not.toContain(
        expect.stringContaining("sending SIGKILL"),
      );
    });

    it("should escalate to SIGKILL when process does not exit within timeout", async () => {
      setPlatform("darwin");

      let sigkillSent = false;
      processKillSpy.mockImplementation(
        (pid: number, signal?: string | number) => {
          // Group kill calls (negative pid)
          if (pid < 0) {
            if (signal === "SIGKILL") {
              sigkillSent = true;
            }
            return true;
          }
          // waitForExit: signal 0 checks — process stays alive until SIGKILL sent
          if (signal === 0) {
            if (sigkillSent) {
              const err = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
              throw err;
            }
            return true; // still alive
          }
          return true;
        },
      );

      const { killProcessTreeGraceful } = await import("./processTree");
      const promise = killProcessTreeGraceful(9999, 1000);

      // Advance past the timeout to trigger SIGKILL escalation
      // waitForExit polls every 200ms, so we need to advance enough times
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(200);
      }

      await promise;

      expect(sigkillSent).toBe(true);
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("sending SIGKILL"),
      );
    });
  });
});
