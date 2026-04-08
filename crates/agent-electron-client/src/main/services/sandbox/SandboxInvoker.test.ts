/**
 * SandboxInvoker 单元测试
 *
 * @version 1.0.0
 * @updated 2026-04-08
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import log from "electron-log";
import type { SandboxType } from "@shared/types/sandbox";
import type { SandboxInvocationParams } from "./SandboxInvoker";

// ============================================================================
// Mock fs module (non-configurable properties require vi.mock)
// ============================================================================

const mockFsExistsSync = vi.fn((p: string) => {
  if (p.includes("sandbox-exec")) return true;
  if (p.includes("nuwax-sandbox-helper")) return true;
  return true;
});
const mockFsRealpathSync = vi.fn((p: string) => p);
const mockFspWriteFile = vi.fn(() => Promise.resolve());
const mockFsMkdirSync = vi.fn();

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockFsExistsSync(...args),
  realpathSync: (...args: unknown[]) => mockFsRealpathSync(...args),
  mkdirSync: (...args: unknown[]) => mockFsMkdirSync(...args),
}));

vi.mock("fs/promises", () => ({
  writeFile: (...args: unknown[]) => mockFspWriteFile(...args),
}));

vi.mock("os", () => ({
  tmpdir: () => "/tmp",
}));

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import { SandboxInvoker } from "./SandboxInvoker";
import { SandboxError, SandboxErrorCode } from "@shared/errors/sandbox";

// ============================================================================
// 测试辅助
// ============================================================================

/** 默认调用参数 */
const defaultParams: SandboxInvocationParams = {
  command: "/usr/bin/node",
  args: ["--version"],
  cwd: "/home/user/project",
  env: { PATH: "/usr/bin:/bin" },
  writablePaths: ["/home/user/project"],
  networkEnabled: false,
};

/** 创建基本参数覆盖的辅助函数 */
function makeParams(
  overrides: Partial<SandboxInvocationParams> = {},
): SandboxInvocationParams {
  return { ...defaultParams, ...overrides };
}

// ============================================================================
// 平台 mock 辅助
// ============================================================================

function withPlatform(platform: NodeJS.Platform, fn: () => void): void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  try {
    fn();
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  }
}

// ============================================================================
// Suite: none 类型
// ============================================================================

describe("SandboxInvoker - none type", () => {
  it("should return unwrapped command and args directly", async () => {
    const invoker = new SandboxInvoker("none");
    const result = await invoker.buildInvocation(makeParams());

    expect(result.command).toBe("/usr/bin/node");
    expect(result.args).toEqual(["--version"]);
  });

  it("should preserve cwd and env", async () => {
    const invoker = new SandboxInvoker("none");
    const params = makeParams({ cwd: "/custom/cwd", env: { FOO: "bar" } });
    const result = await invoker.buildInvocation(params);

    expect(result.cwd).toBe("/custom/cwd");
    expect(result.env).toEqual({ FOO: "bar" });
  });

  it("should not add any sandbox wrapper properties", async () => {
    const invoker = new SandboxInvoker("none");
    const result = await invoker.buildInvocation(makeParams());

    expect(result.seatbeltProfilePath).toBeUndefined();
    expect(result.parseJson).toBeUndefined();
  });
});

// ============================================================================
// Suite: docker 类型
// ============================================================================

describe("SandboxInvoker - docker type", () => {
  it("should return unwrapped command and args with warn log", async () => {
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const invoker = new SandboxInvoker("docker");
    const result = await invoker.buildInvocation(makeParams());

    expect(result.command).toBe("/usr/bin/node");
    expect(result.args).toEqual(["--version"]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Docker process-level sandbox not supported"),
    );
    warnSpy.mockRestore();
  });

  it("should preserve cwd and env", async () => {
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const invoker = new SandboxInvoker("docker");
    const params = makeParams({ cwd: "/custom/cwd" });
    const result = await invoker.buildInvocation(params);

    expect(result.cwd).toBe("/custom/cwd");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// Suite: macOS seatbelt
// ============================================================================

describe("SandboxInvoker - macos-seatbelt", () => {
  beforeEach(() => {
    mockFsRealpathSync.mockImplementation((p: string) => p);
    mockFsExistsSync.mockImplementation((p: string) => {
      if (p.includes("sandbox-exec")) return true;
      return true;
    });
    mockFspWriteFile.mockClear();
  });

  it("should build sandbox-exec invocation with profile", async () => {
    const invoker = new SandboxInvoker("macos-seatbelt");
    const result = await invoker.buildInvocation(makeParams());

    expect(result.command).toBe("/usr/bin/sandbox-exec");
    expect(result.args[0]).toBe("-f");
    expect(result.args[1]).toMatch(/nuwaclaw-sandbox-\d+\.sb$/);
    expect(result.args[2]).toBe("/usr/bin/node");
    expect(result.args[3]).toBe("--version");
    expect(result.seatbeltProfilePath).toBeDefined();
    expect(result.seatbeltProfilePath).toMatch(/nuwaclaw-sandbox-\d+\.sb$/);
  });

  describe("seatbelt profile content", () => {
    it("should start with (version 1) and (deny default)", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt");
      await invoker.buildInvocation(makeParams());

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;

      expect(profile).toMatch(/^\(version 1\)/);
      expect(profile).toMatch(/\(deny default\)/);
    });

    it("should include (allow network*) when networkEnabled is true", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt");
      await invoker.buildInvocation(makeParams({ networkEnabled: true }));

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;

      expect(profile).toMatch(/\(allow network\*\)/);
    });

    it("should NOT include network* when networkEnabled is false", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt");
      await invoker.buildInvocation(makeParams({ networkEnabled: false }));

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;

      expect(profile).not.toMatch(/\(allow network\*\)/);
    });

    it("should generate (allow file-write* (subpath path)) for each writablePath", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt");
      const params = makeParams({
        writablePaths: ["/home/user/project", "/tmp/cache"],
      });
      await invoker.buildInvocation(params);

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;

      expect(profile).toMatch(
        /\(allow file-write\* \(subpath "\/home\/user\/project"\)\)/,
      );
      expect(profile).toMatch(
        /\(allow file-write\* \(subpath "\/tmp\/cache"\)\)/,
      );
    });

    it("should add literal /dev/null, /dev/dtracehelper, /dev/urandom writes", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt");
      await invoker.buildInvocation(makeParams());

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;

      expect(profile).toMatch(
        /\(allow file-write\* \(literal "\/dev\/null"\)\)/,
      );
      expect(profile).toMatch(
        /\(allow file-write\* \(literal "\/dev\/dtracehelper"\)\)/,
      );
      expect(profile).toMatch(
        /\(allow file-write\* \(literal "\/dev\/urandom"\)\)/,
      );
    });

    it("should include standard allowed operations", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt");
      await invoker.buildInvocation(makeParams());

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;

      expect(profile).toMatch(/\(allow file-read\*\)/);
      expect(profile).toMatch(/\(allow process-exec \(regex/);
      expect(profile).toMatch(/\(allow process-fork\)/);
      expect(profile).toMatch(/\(allow signal \(target self\)\)/);
      expect(profile).toMatch(/\(allow sysctl-read\)/);
      expect(profile).toMatch(/\(allow mach-lookup\)/);
      expect(profile).toMatch(/\(allow ipc-posix\*\)/);
      expect(profile).toMatch(/\(allow file-lock\)/);
      expect(profile).not.toMatch(/\(allow file-write\*\)\n/);
    });

    it("should include compat startup exec allowlist for absolute command path", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt", { mode: "compat" });
      await invoker.buildInvocation(
        makeParams({
          command: "/mock/resources/node/darwin-arm64/bin/node",
        }),
      );

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;
      expect(profile).toContain(
        '(allow process-exec (literal "/mock/resources/node/darwin-arm64/bin/node"))',
      );
    });

    it("should include command literal but not startup-chain allowlist in strict mode", async () => {
      const invoker = new SandboxInvoker("macos-seatbelt", { mode: "strict" });
      await invoker.buildInvocation(
        makeParams({
          command: "/mock/resources/node/darwin-arm64/bin/node",
          startupExecAllowlist: [
            "/mock/resources/claude-code-acp-ts/dist/index.js",
          ],
        }),
      );

      const writeCall = mockFspWriteFile.mock.calls[0];
      const profile = writeCall[1] as string;
      expect(profile).toContain(
        '(allow process-exec (literal "/mock/resources/node/darwin-arm64/bin/node"))',
      );
      expect(profile).not.toContain(
        '(allow process-exec (literal "/mock/resources/claude-code-acp-ts/dist/index.js"))',
      );
    });
  });

  it("should handle symlink paths for writablePaths by adding both", async () => {
    // Mock fs.realpathSync to return a different path (simulating symlink)
    mockFsRealpathSync.mockImplementation((p: string) => {
      if (p === "/home/user/project") return "/private/home/user/project";
      return p;
    });

    const invoker = new SandboxInvoker("macos-seatbelt");
    await invoker.buildInvocation(
      makeParams({ writablePaths: ["/home/user/project"] }),
    );

    const writeCall = mockFspWriteFile.mock.calls[0];
    const profile = writeCall[1] as string;

    expect(profile).toMatch(
      /\(allow file-write\* \(subpath "\/home\/user\/project"\)\)/,
    );
    expect(profile).toMatch(
      /\(allow file-write\* \(subpath "\/private\/home\/user\/project"\)\)/,
    );
  });

  it("should not duplicate paths that resolve to the same realpath", async () => {
    const invoker = new SandboxInvoker("macos-seatbelt");
    await invoker.buildInvocation(makeParams({ writablePaths: ["/tmp/same"] }));

    const writeCall = mockFspWriteFile.mock.calls[0];
    const profile = writeCall[1] as string;

    // Should only appear once despite realpath returning the same
    const matches = profile.match(
      /\(allow file-write\* \(subpath "\/tmp\/same"\)\)/g,
    );
    expect(matches).toHaveLength(1);
  });

  it("should write profile to temp directory", async () => {
    const invoker = new SandboxInvoker("macos-seatbelt");
    await invoker.buildInvocation(makeParams());

    const writeCall = mockFspWriteFile.mock.calls[0];
    const profilePath = writeCall[0] as string;

    expect(profilePath).toMatch(/^\/tmp\/nuwaclaw-sandbox-\d+\.sb$/);
  });
});

// ============================================================================
// Suite: Linux bwrap
// ============================================================================

describe("SandboxInvoker - linux-bwrap", () => {
  beforeEach(() => {
    mockFsExistsSync.mockReturnValue(true);
  });

  it("should build bwrap invocation", async () => {
    withPlatform("linux", async () => {
      const invoker = new SandboxInvoker("linux-bwrap");
      const result = await invoker.buildInvocation(makeParams());

      expect(result.command).toBe("bwrap");
      expect(result.cwd).toBe("/home/user/project");
    });
  });

  describe("bwrap args structure", () => {
    it("should include --ro-bind / / by default", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const result = await invoker.buildInvocation(makeParams());

        expect(result.args).toContain("--ro-bind");
        expect(result.args).toContain("/");
        // Should have --ro-bind / / as consecutive args
        const idx = result.args.indexOf("--ro-bind");
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(result.args[idx + 1]).toBe("/");
        expect(result.args[idx + 2]).toBe("/");
      });
    });

    it("should include --tmpfs /tmp by default", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const result = await invoker.buildInvocation(makeParams());

        const idx = result.args.indexOf("--tmpfs");
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(result.args[idx + 1]).toBe("/tmp");
      });
    });

    it("should include minimal /dev allowlist by default", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const result = await invoker.buildInvocation(makeParams());

        expect(result.args).toContain("/dev/null");
        expect(result.args).toContain("/dev/urandom");
        expect(result.args).toContain("/dev/zero");
        const fullDevIdx = result.args.findIndex(
          (arg, i) =>
            arg === "--dev-bind" &&
            result.args[i + 1] === "/dev" &&
            result.args[i + 2] === "/dev",
        );
        expect(fullDevIdx).toBe(-1);
      });
    });

    it("should include --unshare-net when networkEnabled is false", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        await invoker.buildInvocation(makeParams({ networkEnabled: false }));

        const result = (invoker as any).buildBwrap(
          makeParams({ networkEnabled: false }),
        );
        expect(result.args).toContain("--unshare-net");
      });
    });

    it("should NOT include --unshare-net when networkEnabled is true", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const result = (invoker as any).buildBwrap(
          makeParams({ networkEnabled: true }),
        );
        expect(result.args).not.toContain("--unshare-net");
      });
    });

    it("should bind each writablePath", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const params = makeParams({
          writablePaths: ["/home/user/project", "/tmp/cache"],
        });
        const result = (invoker as any).buildBwrap(params);

        const projectIdx = result.args.indexOf("/home/user/project");
        expect(projectIdx).toBeGreaterThanOrEqual(0);
        expect(result.args[projectIdx - 1]).toBe("--bind");
        expect(result.args[projectIdx + 1]).toBe("/home/user/project");
      });
    });

    it("should place --chdir before -- separator", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const result = (invoker as any).buildBwrap(makeParams());

        const chdirIdx = result.args.indexOf("--chdir");
        const separatorIdx = result.args.indexOf("--");

        expect(chdirIdx).toBeGreaterThanOrEqual(0);
        expect(separatorIdx).toBeGreaterThanOrEqual(0);
        expect(chdirIdx).toBeLessThan(separatorIdx);
      });
    });

    it("should place original command and args after -- separator at end", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const params = makeParams({
          command: "/usr/bin/node",
          args: ["--version"],
        });
        const result = (invoker as any).buildBwrap(params);

        const separatorIdx = result.args.indexOf("--");
        expect(separatorIdx).toBeGreaterThanOrEqual(0);

        // Everything after -- should be the original command and args
        const afterSeparator = result.args.slice(separatorIdx + 1);
        expect(afterSeparator[0]).toBe("/usr/bin/node");
        expect(afterSeparator[1]).toBe("--version");
      });
    });

    it("should use custom bwrap path when provided", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap", {
          linuxBwrapPath: "/usr/local/bin/bwrap",
        });
        const result = await invoker.buildInvocation(makeParams());

        expect(result.command).toBe("/usr/local/bin/bwrap");
      });
    });

    it("should include all required bwrap flags", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap");
        const result = (invoker as any).buildBwrap(makeParams());

        const requiredFlags = [
          "--die-with-parent",
          "--new-session",
          "--unshare-user-try",
          "--unshare-pid",
          "--unshare-uts",
          "--unshare-cgroup-try",
          "--ro-bind",
          "--dev-bind",
          "--proc",
          "/proc",
        ];

        for (const flag of requiredFlags) {
          expect(result.args).toContain(flag);
        }
      });
    });

    it("should use permissive mode when explicitly configured", async () => {
      withPlatform("linux", async () => {
        const invoker = new SandboxInvoker("linux-bwrap", {
          mode: "permissive",
        });
        const result = (invoker as any).buildBwrap(makeParams());
        expect(result.args).toContain("--bind");
        expect(result.args).toContain("/dev");
        expect(result.args).not.toContain("--unshare-pid");
      });
    });
  });
});

// ============================================================================
// Suite: Windows sandbox
// ============================================================================

describe("SandboxInvoker - windows-sandbox", () => {
  const fakeHelperPath = "C:\\tools\\nuwax-sandbox-helper.exe";

  beforeEach(() => {
    mockFsExistsSync.mockImplementation((p: string) => {
      if (p.includes("nuwax-sandbox-helper")) return true;
      return true;
    });
  });

  it("should throw SANDBOX_UNAVAILABLE when helper does not exist", async () => {
    mockFsExistsSync.mockImplementation((p: string) => {
      if (p.includes("nuwax-sandbox-helper")) return false;
      return true;
    });

    withPlatform("win32", async () => {
      const invoker = new SandboxInvoker("windows-sandbox", {
        windowsSandboxHelperPath: fakeHelperPath,
      });

      await expect(invoker.buildInvocation(makeParams())).rejects.toThrow(
        expect.objectContaining({ code: SandboxErrorCode.SANDBOX_UNAVAILABLE }),
      );
    });

    // Reset mock
    mockFsExistsSync.mockImplementation((p: string) => {
      if (p.includes("nuwax-sandbox-helper")) return true;
      return true;
    });
  });

  it("should throw when windowsSandboxHelperPath is not provided", async () => {
    withPlatform("win32", async () => {
      const invoker = new SandboxInvoker("windows-sandbox", {});

      await expect(invoker.buildInvocation(makeParams())).rejects.toThrow(
        expect.objectContaining({ code: SandboxErrorCode.SANDBOX_UNAVAILABLE }),
      );
    });
  });

  describe("helper invocation args", () => {
    it("should build helper invocation with --policy-json", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
        });
        const result = await invoker.buildInvocation(makeParams());

        expect(result.args).toContain("--policy-json");
      });
    });

    it("should include network_access: false when networkEnabled is false", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
        });
        await invoker.buildInvocation(makeParams({ networkEnabled: false }));

        const result = await invoker.buildInvocation(
          makeParams({ networkEnabled: false }),
        );
        const policyArgIdx = result.args.indexOf("--policy-json");
        const policyStr = result.args[policyArgIdx + 1];
        const policy = JSON.parse(policyStr);

        expect(policy.network_access).toBe(false);
      });
    });

    it("should include network_access: true when networkEnabled is true", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
          networkEnabled: true,
        });
        const result = await invoker.buildInvocation(
          makeParams({ networkEnabled: true }),
        );

        const policyArgIdx = result.args.indexOf("--policy-json");
        const policyStr = result.args[policyArgIdx + 1];
        const policy = JSON.parse(policyStr);

        expect(policy.network_access).toBe(true);
      });
    });

    it("should include writable_roots in workspace-write mode with writablePaths", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
          windowsSandboxMode: "workspace-write",
        });
        const params = makeParams({
          writablePaths: ["C:\\projects", "D:\\temp"],
        });
        const result = await invoker.buildInvocation(params);

        const policyArgIdx = result.args.indexOf("--policy-json");
        const policyStr = result.args[policyArgIdx + 1];
        const policy = JSON.parse(policyStr);

        expect(policy.type).toBe("workspace-write");
        expect(policy.writable_roots).toEqual(["C:\\projects", "D:\\temp"]);
      });
    });

    it("should use read-only mode when specified", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
          windowsSandboxMode: "read-only",
        });
        const result = await invoker.buildInvocation(makeParams());

        const policyArgIdx = result.args.indexOf("--policy-json");
        const policyStr = result.args[policyArgIdx + 1];
        const policy = JSON.parse(policyStr);

        expect(policy.type).toBe("read-only");
      });
    });

    it("should set parseJson to true for run subcommand", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
        });
        const result = await invoker.buildInvocation(
          makeParams({ subcommand: "run" }),
        );

        expect(result.parseJson).toBe(true);
      });
    });

    it("should set parseJson to undefined for serve subcommand", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
        });
        const result = await invoker.buildInvocation(
          makeParams({ subcommand: "serve" }),
        );

        // parseJson is false for "serve" (since subcommand !== "run")
        expect(result.parseJson).toBe(false);
      });
    });

    it("should include --cwd with correct path", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
        });
        const result = await invoker.buildInvocation(
          makeParams({ cwd: "C:\\projects\\myapp" }),
        );

        const cwdIdx = result.args.indexOf("--cwd");
        expect(cwdIdx).toBeGreaterThanOrEqual(0);
        expect(result.args[cwdIdx + 1]).toBe("C:\\projects\\myapp");
      });
    });

    it("should include --mode with correct mode", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
          windowsSandboxMode: "workspace-write",
        });
        const result = await invoker.buildInvocation(makeParams());

        const modeIdx = result.args.indexOf("--mode");
        expect(modeIdx).toBeGreaterThanOrEqual(0);
        expect(result.args[modeIdx + 1]).toBe("workspace-write");
      });
    });

    it("should place original command and args after -- separator", async () => {
      withPlatform("win32", async () => {
        const invoker = new SandboxInvoker("windows-sandbox", {
          windowsSandboxHelperPath: fakeHelperPath,
        });
        const params = makeParams({ command: "node.exe", args: ["--version"] });
        const result = await invoker.buildInvocation(params);

        const separatorIdx = result.args.indexOf("--");
        expect(separatorIdx).toBeGreaterThanOrEqual(0);

        const afterSeparator = result.args.slice(separatorIdx + 1);
        expect(afterSeparator[0]).toBe("node.exe");
        expect(afterSeparator[1]).toBe("--version");
      });
    });
  });
});

// ============================================================================
// Suite: checkAvailable
// ============================================================================

describe("SandboxInvoker - checkAvailable", () => {
  it("none type always returns true", async () => {
    const invoker = new SandboxInvoker("none");
    await expect(invoker.checkAvailable()).resolves.toBe(true);
  });

  it("docker type always returns false (not supported)", async () => {
    const invoker = new SandboxInvoker("docker");
    await expect(invoker.checkAvailable()).resolves.toBe(false);
  });

  it("macos-seatbelt checkAvailable does not throw", async () => {
    const invoker = new SandboxInvoker("macos-seatbelt");
    const result = await invoker.checkAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("unknown type returns false", async () => {
    // Use an invalid type that doesn't exist in SandboxType union
    const invoker = new SandboxInvoker("completely-invalid-type" as any);
    await expect(invoker.checkAvailable()).resolves.toBe(false);
  });
});

// ============================================================================
// Suite: 错误处理
// ============================================================================

describe("SandboxInvoker - error handling", () => {
  it("should throw for unsupported sandbox type", async () => {
    const mockType = "invalid-type" as any;
    const invoker = new SandboxInvoker(mockType);

    await expect(invoker.buildInvocation(makeParams())).rejects.toThrow(
      SandboxError,
    );
    await expect(invoker.buildInvocation(makeParams())).rejects.toMatchObject({
      code: SandboxErrorCode.CONFIG_INVALID,
    });
  });
});
