/**
 * Unit tests for sandboxProcessWrapper
 *
 * Tests buildSandboxedSpawnArgs() behavior:
 * - enabled=false: returns original command/args with NOOP_CLEANUP
 * - docker type: logs warning and returns original command/args
 * - macos-seatbelt type: returns sandbox-exec command
 * - linux-bwrap type: returns bwrap command
 * - error handling: re-throws errors from SandboxInvoker.buildInvocation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { SandboxInvoker } from "./SandboxInvoker";
import { buildSandboxedSpawnArgs } from "./sandboxProcessWrapper";
import type { SandboxProcessConfig } from "@shared/types/sandbox";

// =============================================================================
// Mock electron-log
// =============================================================================

const mockLogWarn = vi.fn();
const mockLogInfo = vi.fn();
const mockLogError = vi.fn();

vi.mock("electron-log", () => ({
  default: {
    warn: (...args: unknown[]) => mockLogWarn(...args),
    info: (...args: unknown[]) => mockLogInfo(...args),
    error: (...args: unknown[]) => mockLogError(...args),
  },
}));

// =============================================================================
// Mock fs
// =============================================================================

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockRealpathSync = vi.fn();

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  realpathSync: (...args: unknown[]) => mockRealpathSync(...args),
}));

// =============================================================================
// Mock SandboxInvoker
// =============================================================================

const mockBuildInvocation = vi.fn();

vi.mock("./SandboxInvoker", () => ({
  SandboxInvoker: vi.fn().mockImplementation(() => ({
    buildInvocation: mockBuildInvocation,
  })),
}));

// =============================================================================
// Test helpers
// =============================================================================

const NOOP_CLEANUP = () => {};

const createBaseConfig = (): SandboxProcessConfig => ({
  enabled: true,
  type: "macos-seatbelt",
  projectWorkspaceDir: "/tmp/ws",
  networkEnabled: false,
  fallback: "degrade_to_off",
});

// =============================================================================
// Tests
// =============================================================================

describe("buildSandboxedSpawnArgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true); // Default: paths exist
    mockMkdirSync.mockReturnValue(undefined);
    mockUnlinkSync.mockReturnValue(undefined);
    mockRealpathSync.mockImplementation((p: string) => p);
    mockBuildInvocation.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Test: enabled=false returns original command/args with NOOP_CLEANUP
  // ---------------------------------------------------------------------------
  describe("when enabled is false", () => {
    it("should return original command and args unchanged", async () => {
      const config: SandboxProcessConfig = {
        enabled: false,
        type: "macos-seatbelt",
        projectWorkspaceDir: "/tmp/ws",
        networkEnabled: false,
        fallback: "degrade_to_off",
      };

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      expect(result.command).toBe("/bin/ls");
      expect(result.args).toEqual(["-la"]);
    });

    it("should return NOOP_CLEANUP function", async () => {
      const config: SandboxProcessConfig = {
        enabled: false,
        type: "macos-seatbelt",
        projectWorkspaceDir: "/tmp/ws",
        networkEnabled: false,
        fallback: "degrade_to_off",
      };

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      // cleanupSandbox should be a noop function (truthy and returns undefined)
      expect(typeof result.cleanupSandbox).toBe("function");
      expect(result.cleanupSandbox()).toBeUndefined();
    });

    it("should not call SandboxInvoker when disabled", async () => {
      const config: SandboxProcessConfig = {
        enabled: false,
        type: "macos-seatbelt",
        projectWorkspaceDir: "/tmp/ws",
        networkEnabled: false,
        fallback: "degrade_to_off",
      };

      await buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config);

      expect(SandboxInvoker).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Test: docker type logs warning and returns original command/args
  // ---------------------------------------------------------------------------
  describe("when type is docker", () => {
    it("should log warning about docker not supported", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "docker",
      };

      await buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config);

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining("Docker process-level sandbox not supported"),
      );
    });

    it("should return original command and args unchanged", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "docker",
      };

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      expect(result.command).toBe("/bin/ls");
      expect(result.args).toEqual(["-la"]);
    });

    it("should return NOOP_CLEANUP", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "docker",
      };

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      // cleanupSandbox should be a noop function (truthy and returns undefined)
      expect(typeof result.cleanupSandbox).toBe("function");
      expect(result.cleanupSandbox()).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Test: macos-seatbelt type returns sandbox-exec command
  // ---------------------------------------------------------------------------
  describe("when type is macos-seatbelt", () => {
    it("should return sandbox-exec command", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "macos-seatbelt",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/sandbox-exec",
        args: ["-f", "/tmp/profile.sb", "/bin/ls", "-la"],
        cwd: "/tmp",
        seatbeltProfilePath: "/tmp/nuwaclaw-sandbox-123.sb",
      });

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      expect(result.command).toBe("/usr/bin/sandbox-exec");
      expect(result.args[0]).toBe("-f");
      expect(result.args[2]).toBe("/bin/ls");
    });

    it("should create workspace directory if it does not exist", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        projectWorkspaceDir: "/tmp/nonexistent-ws",
      };

      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/tmp/nonexistent-ws") return false;
        return true;
      });

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/sandbox-exec",
        args: ["-f", "/tmp/profile.sb", "/bin/ls", "-la"],
        cwd: "/tmp",
        seatbeltProfilePath: "/tmp/nuwaclaw-sandbox-123.sb",
      });

      await buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config);

      expect(mockMkdirSync).toHaveBeenCalledWith("/tmp/nonexistent-ws", {
        recursive: true,
      });
    });

    it("should return a cleanup function that deletes seatbelt profile", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "macos-seatbelt",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/sandbox-exec",
        args: ["-f", "/tmp/profile.sb", "/bin/ls", "-la"],
        cwd: "/tmp",
        seatbeltProfilePath: "/tmp/nuwaclaw-sandbox-123.sb",
      });

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      // cleanupSandbox should be a function (not NOOP_CLEANUP)
      expect(typeof result.cleanupSandbox).toBe("function");
      expect(result.cleanupSandbox).not.toBe(NOOP_CLEANUP);

      // Calling cleanup should delete the profile file
      result.cleanupSandbox();
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        "/tmp/nuwaclaw-sandbox-123.sb",
      );
    });

    it("should handle cleanup gracefully when profile file does not exist", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "macos-seatbelt",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/sandbox-exec",
        args: ["-f", "/tmp/profile.sb", "/bin/ls", "-la"],
        cwd: "/tmp",
        seatbeltProfilePath: "/tmp/nuwaclaw-sandbox-123.sb",
      });

      mockUnlinkSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file");
      });

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      // Should not throw
      expect(() => result.cleanupSandbox()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Test: linux-bwrap type returns bwrap command
  // ---------------------------------------------------------------------------
  describe("when type is linux-bwrap", () => {
    it("should return bwrap command", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "linux-bwrap",
        projectWorkspaceDir: "/tmp/ws",
        linuxBwrapPath: "/usr/bin/bwrap",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/bwrap",
        args: [
          "--die-with-parent",
          "--new-session",
          "--unshare-user-try",
          "--unshare-pid",
          "--unshare-uts",
          "--unshare-cgroup-try",
          "--dev-bind",
          "/dev",
          "/dev",
          "--proc",
          "/proc",
          "--tmpfs",
          "/tmp",
          "--ro-bind",
          "/",
          "/",
          "--bind",
          "/tmp/ws",
          "/tmp/ws",
          "--chdir",
          "/tmp",
          "--",
          "/bin/ls",
          "-la",
        ],
        cwd: "/tmp",
      });

      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        config,
      );

      expect(result.command).toBe("/usr/bin/bwrap");
      expect(result.args).toContain("--bind");
      expect(result.args).toContain("/tmp/ws");
    });

    it("should pass writablePaths to SandboxInvoker", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "linux-bwrap",
        projectWorkspaceDir: "/tmp/ws",
        linuxBwrapPath: "/usr/bin/bwrap",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/bwrap",
        args: ["--die-with-parent", "--", "/bin/ls", "-la"],
        cwd: "/tmp",
      });

      await buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config, [
        "/tmp/extra-writable",
      ]);

      expect(mockBuildInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          writablePaths: ["/tmp/ws", "/tmp/extra-writable"],
        }),
      );
    });

    it("should filter out empty writablePaths", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "linux-bwrap",
        projectWorkspaceDir: "/tmp/ws",
        linuxBwrapPath: "/usr/bin/bwrap",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/bwrap",
        args: ["--die-with-parent", "--", "/bin/ls", "-la"],
        cwd: "/tmp",
      });

      // Only truly empty strings (length 0) are filtered; whitespace strings pass through
      await buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config, [
        "",
        "/tmp/valid-path",
      ]);

      expect(mockBuildInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          writablePaths: ["/tmp/ws", "/tmp/valid-path"],
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test: error handling - re-throws errors from SandboxInvoker.buildInvocation
  // ---------------------------------------------------------------------------
  describe("error handling", () => {
    it("should re-throw errors from SandboxInvoker.buildInvocation", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "macos-seatbelt",
      };

      const expectedError = new Error("Sandbox invocation failed");
      mockBuildInvocation.mockRejectedValue(expectedError);

      await expect(
        buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config),
      ).rejects.toThrow("Sandbox invocation failed");
    });

    it("should log error before re-throwing", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "linux-bwrap",
      };

      const expectedError = new Error("bwrap not found");
      mockBuildInvocation.mockRejectedValue(expectedError);

      await expect(
        buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config),
      ).rejects.toThrow();

      expect(mockLogError).toHaveBeenCalledWith(
        "[SandboxProcessWrapper] Sandbox wrapping failed:",
        expectedError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test: extraWritablePaths parameter
  // ---------------------------------------------------------------------------
  describe("extraWritablePaths parameter", () => {
    it("should include extraWritablePaths in writable paths", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "macos-seatbelt",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/sandbox-exec",
        args: ["-f", "/tmp/profile.sb", "/bin/ls", "-la"],
        cwd: "/tmp",
        seatbeltProfilePath: "/tmp/nuwaclaw-sandbox-123.sb",
      });

      await buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config, [
        "/tmp/extra1",
        "/tmp/extra2",
      ]);

      expect(mockBuildInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          writablePaths: ["/tmp/ws", "/tmp/extra1", "/tmp/extra2"],
        }),
      );
    });

    it("should handle empty extraWritablePaths", async () => {
      const config: SandboxProcessConfig = {
        ...createBaseConfig(),
        type: "macos-seatbelt",
      };

      mockBuildInvocation.mockResolvedValue({
        command: "/usr/bin/sandbox-exec",
        args: ["-f", "/tmp/profile.sb", "/bin/ls", "-la"],
        cwd: "/tmp",
        seatbeltProfilePath: "/tmp/nuwaclaw-sandbox-123.sb",
      });

      await buildSandboxedSpawnArgs("/bin/ls", ["-la"], "/tmp", config, []);

      expect(mockBuildInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          writablePaths: ["/tmp/ws"],
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test: sandboxConfig undefined (same as enabled=false)
  // ---------------------------------------------------------------------------
  describe("when sandboxConfig is undefined", () => {
    it("should return original command and args", async () => {
      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        undefined,
      );

      expect(result.command).toBe("/bin/ls");
      expect(result.args).toEqual(["-la"]);
    });

    it("should return NOOP_CLEANUP", async () => {
      const result = await buildSandboxedSpawnArgs(
        "/bin/ls",
        ["-la"],
        "/tmp",
        undefined,
      );

      // cleanupSandbox should be a noop function (truthy and returns undefined)
      expect(typeof result.cleanupSandbox).toBe("function");
      expect(result.cleanupSandbox()).toBeUndefined();
    });
  });
});
