/**
 * 单元测试: sandbox/policy
 *
 * 测试沙箱策略解析与能力探测
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "home") return "/mock/home";
      return "/mock/appdata";
    }),
    getAppPath: vi.fn(() => "/mock/app"),
    emit: vi.fn(),
  },
}));

// Mock electron-log
vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fs - configured per test
const mockExistsSync = vi.fn(() => true);
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// Mock db
const mockReadSetting = vi.fn(() => ({}));
const mockWriteSetting = vi.fn();
vi.mock("../../db", () => ({
  readSetting: (...args: unknown[]) => mockReadSetting(...args),
  writeSetting: (...args: unknown[]) => mockWriteSetting(...args),
}));

// Mock checkCommand
const mockCheckCommand = vi.fn(() => Promise.resolve(true));
vi.mock("../system/shellEnv", () => ({
  checkCommand: (...args: unknown[]) => mockCheckCommand(...args),
}));

// Mock getResourcesPath
vi.mock("../system/dependencies", () => ({
  getResourcesPath: vi.fn(() => "/mock/resources"),
}));

describe("sandbox/policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: all paths exist, commands available
    mockExistsSync.mockReturnValue(true);
    mockCheckCommand.mockResolvedValue(true);
    mockReadSetting.mockReturnValue({});

    // Default platform
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    mockExistsSync.mockRestore?.();
  });

  describe("resolveSandboxType", () => {
    describe("enabled=false", () => {
      it("should return type=none with degraded=false when sandbox is disabled", async () => {
        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: false, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("none");
        expect(result.degraded).toBe(false);
        expect(result.reason).toBe("sandbox policy is disabled");
      });

      it("should ignore backend setting when disabled", async () => {
        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: false, backend: "docker" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("none");
        expect(result.degraded).toBe(false);
      });
    });

    describe("enabled=true but all backends unavailable", () => {
      it("should return degraded=true with type=none when all backends unavailable on darwin", async () => {
        // Make seatbelt unavailable
        mockExistsSync.mockImplementation((p: string) => {
          if (p === "/usr/bin/sandbox-exec") return false;
          return true;
        });
        mockCheckCommand.mockResolvedValue(false);

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("none");
        expect(result.degraded).toBe(true);
        expect(result.reason).toBeTruthy();
        expect(typeof result.reason).toBe("string");
      });

      it("should return degraded=true when docker unavailable", async () => {
        // Make docker unavailable
        mockCheckCommand.mockResolvedValue(false);
        mockExistsSync.mockImplementation((p: string) => {
          if (p === "/usr/bin/sandbox-exec") return false;
          return false;
        });

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "docker" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("none");
        expect(result.degraded).toBe(true);
        expect(result.reason).toContain("docker");
      });

      it("should return degraded=true when linux-bwrap unavailable on linux", async () => {
        Object.defineProperty(process, "platform", {
          value: "linux",
          writable: true,
          configurable: true,
        });

        // Make bwrap unavailable both as command and bundled
        mockCheckCommand.mockResolvedValue(false);
        mockExistsSync.mockImplementation((p: string) => {
          if (p.includes("bwrap")) return false;
          return true;
        });

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "linux-bwrap" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("none");
        expect(result.degraded).toBe(true);
        expect(result.reason).toContain("bwrap");
      });

      it("should return degraded=true when windows-sandbox unavailable on windows", async () => {
        Object.defineProperty(process, "platform", {
          value: "win32",
          writable: true,
          configurable: true,
        });

        // Make sandbox helper unavailable
        mockExistsSync.mockImplementation((p: string) => {
          if (p.includes("nuwax-sandbox-helper")) return false;
          return true;
        });
        mockCheckCommand.mockResolvedValue(true);

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "windows-sandbox" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("none");
        expect(result.degraded).toBe(true);
        expect(result.reason).toContain("windows sandbox helper not found");
      });
    });

    describe("enabled=true and backend available", () => {
      it("should return type=macos-seatbelt with degraded=false on darwin when seatbelt available", async () => {
        // seatbelt exists
        mockExistsSync.mockImplementation((p: string) => {
          if (p === "/usr/bin/sandbox-exec") return true;
          return true;
        });
        mockCheckCommand.mockResolvedValue(false); // docker not needed here

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("macos-seatbelt");
        expect(result.degraded).toBe(false);
      });

      it("should return type=linux-bwrap with degraded=false on linux when bwrap available", async () => {
        Object.defineProperty(process, "platform", {
          value: "linux",
          writable: true,
          configurable: true,
        });

        mockCheckCommand.mockResolvedValue(true); // bwrap command available
        mockExistsSync.mockImplementation((p: string) => {
          if (p.includes("bwrap")) return true;
          return true;
        });

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("linux-bwrap");
        expect(result.degraded).toBe(false);
      });

      it("should return type=linux-bwrap when using bundled bwrap on linux", async () => {
        Object.defineProperty(process, "platform", {
          value: "linux",
          writable: true,
          configurable: true,
        });

        // bwrap command not available, but bundled exists
        mockCheckCommand.mockResolvedValue(false);
        mockExistsSync.mockImplementation((p: string) => {
          if (p === "/usr/bin/bwrap") return false;
          if (p.includes("bwrap")) return true; // bundled path exists
          return true;
        });

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "linux-bwrap" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("linux-bwrap");
        expect(result.degraded).toBe(false);
      });

      it("should return type=docker with degraded=false when docker available", async () => {
        mockCheckCommand.mockResolvedValue(true); // docker available
        mockExistsSync.mockImplementation(() => true);

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "docker" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("docker");
        expect(result.degraded).toBe(false);
      });
    });

    describe("backend=auto degradation logic", () => {
      it("should auto map to macos-seatbelt on darwin", async () => {
        mockExistsSync.mockImplementation((p: string) => {
          if (p === "/usr/bin/sandbox-exec") return true;
          return true;
        });

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("macos-seatbelt");
      });

      it("should auto map to linux-bwrap on linux", async () => {
        Object.defineProperty(process, "platform", {
          value: "linux",
          writable: true,
          configurable: true,
        });

        mockCheckCommand.mockResolvedValue(true);

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("linux-bwrap");
      });

      it("should auto map to windows-sandbox on win32", async () => {
        Object.defineProperty(process, "platform", {
          value: "win32",
          writable: true,
          configurable: true,
        });

        mockExistsSync.mockImplementation((p: string) => {
          if (p.includes("nuwax-sandbox-helper")) return true;
          return true;
        });

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.type).toBe("windows-sandbox");
      });
    });

    describe("fallback result validation", () => {
      it("should always return type=none when degraded, never another available type", async () => {
        // This test verifies the core fallback invariant:
        // when degraded=true, type must be "none", not any other sandbox type

        // Scenario: auto backend on darwin, but seatbelt unavailable
        Object.defineProperty(process, "platform", {
          value: "darwin",
          writable: true,
          configurable: true,
        });

        mockExistsSync.mockImplementation((p: string) => {
          if (p === "/usr/bin/sandbox-exec") return false;
          return true;
        });
        mockCheckCommand.mockResolvedValue(false);

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        // The type must be "none" - not "macos-seatbelt" or any other type
        expect(result.type).toBe("none");
        expect(result.degraded).toBe(true);
        expect(result.reason).toBeTruthy();

        // Ensure it's not accidentally set to another type
        expect(result.type).not.toBe("macos-seatbelt");
        expect(result.type).not.toBe("docker");
        expect(result.type).not.toBe("linux-bwrap");
        expect(result.type).not.toBe("windows-sandbox");
      });

      it("should include non-empty reason when degraded=true", async () => {
        Object.defineProperty(process, "platform", {
          value: "linux",
          writable: true,
          configurable: true,
        });

        // All backends unavailable
        mockCheckCommand.mockResolvedValue(false);
        mockExistsSync.mockReturnValue(false);

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.degraded).toBe(true);
        expect(result.reason).toBeDefined();
        expect(typeof result.reason).toBe("string");
        expect(result.reason!.length).toBeGreaterThan(0);
      });

      it("should not have reason field when not degraded", async () => {
        mockExistsSync.mockImplementation((p: string) => {
          if (p === "/usr/bin/sandbox-exec") return true;
          return true;
        });

        const { resolveSandboxType } = await import("./policy");

        const policy = { enabled: true, backend: "auto" as const };
        const result = await resolveSandboxType(policy);

        expect(result.degraded).toBe(false);
        expect(result.reason).toBeUndefined();
      });
    });
  });

  describe("getSandboxCapabilities", () => {
    it("should detect docker availability", async () => {
      mockCheckCommand.mockResolvedValue(true);

      const { getSandboxCapabilities } = await import("./policy");
      const caps = await getSandboxCapabilities();

      expect(caps.docker.available).toBe(true);
    });

    it("should report docker unavailable when command not found", async () => {
      mockCheckCommand.mockResolvedValue(false);

      const { getSandboxCapabilities } = await import("./policy");
      const caps = await getSandboxCapabilities();

      expect(caps.docker.available).toBe(false);
    });

    it("should detect macos seatbelt on darwin", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === "/usr/bin/sandbox-exec") return true;
        return true;
      });

      const { getSandboxCapabilities } = await import("./policy");
      const caps = await getSandboxCapabilities();

      expect(caps.platform).toBe("darwin");
      expect(caps.macosSeatbelt.available).toBe(true);
    });

    it("should not report macos seatbelt available on linux", async () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        writable: true,
        configurable: true,
      });

      const { getSandboxCapabilities } = await import("./policy");
      const caps = await getSandboxCapabilities();

      expect(caps.platform).toBe("linux");
      expect(caps.macosSeatbelt.available).toBe(false);
      expect(caps.macosSeatbelt.reason).toBe("not on macOS");
    });
  });

  describe("getBundledLinuxBwrapPath", () => {
    it("should return path when bundled bwrap exists", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes("bwrap")) return true;
        return false;
      });

      const { getBundledLinuxBwrapPath } = await import("./policy");
      const result = getBundledLinuxBwrapPath();

      expect(result).toContain("bwrap");
    });

    it("should return null when no bundled bwrap found", async () => {
      mockExistsSync.mockReturnValue(false);

      const { getBundledLinuxBwrapPath } = await import("./policy");
      const result = getBundledLinuxBwrapPath();

      expect(result).toBeNull();
    });
  });

  describe("getBundledSandboxHelperPath", () => {
    it("should return path when helper exists", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes("nuwax-sandbox-helper")) return true;
        return false;
      });

      const { getBundledSandboxHelperPath } = await import("./policy");
      const result = getBundledSandboxHelperPath();

      expect(result).toContain("nuwax-sandbox-helper");
    });

    it("should return null when helper not found", async () => {
      mockExistsSync.mockReturnValue(false);

      const { getBundledSandboxHelperPath } = await import("./policy");
      const result = getBundledSandboxHelperPath();

      expect(result).toBeNull();
    });
  });

  describe("getSandboxPolicy / setSandboxPolicy", () => {
    it("should return default policy when no stored policy", async () => {
      mockReadSetting.mockReturnValue({});

      const { getSandboxPolicy } = await import("./policy");
      const policy = getSandboxPolicy();

      expect(policy.enabled).toBe(true);
      expect(policy.backend).toBe("auto");
      expect(policy.mode).toBe("compat");
      expect(policy.autoFallback).toBe("startup-only");
    });

    it("should persist policy changes via writeSetting", async () => {
      mockReadSetting.mockReturnValue({});

      const { setSandboxPolicy } = await import("./policy");
      setSandboxPolicy({ enabled: false, backend: "docker" });

      expect(mockWriteSetting).toHaveBeenCalledWith(
        "sandbox_policy",
        expect.objectContaining({
          enabled: false,
          backend: "docker",
        }),
      );
    });
  });
});
