import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlatformAdapter,
  getCurrentPlatform,
  isSupportedPlatform,
} from "./platformAdapter";

describe("platformAdapter", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it("should expose Windows probe and sandbox traits", () => {
    const adapter = createPlatformAdapter("win32");

    expect(adapter.isWindows).toBe(true);
    expect(adapter.pathDelimiter).toBe(";");
    expect(adapter.sandboxHelperName).toBe("nuwax-sandbox-helper.exe");
    expect(adapter.getCommandProbe("git")).toEqual({
      command: "where",
      args: ["git"],
    });
    expect(adapter.getRecommendedSandboxBackend()).toBe("windows-sandbox");
    expect(adapter.getRecommendedSandboxType()).toBe("windows-sandbox");
  });

  it("should expose Unix probe and seatbelt traits for macOS", () => {
    const adapter = createPlatformAdapter("darwin");

    expect(adapter.isMacOS).toBe(true);
    expect(adapter.pathDelimiter).toBe(":");
    expect(adapter.sandboxHelperName).toBe("nuwax-sandbox-helper");
    expect(adapter.getCommandProbe("git")).toEqual({
      command: "which",
      args: ["git"],
    });
    expect(adapter.getSeatbeltPath()).toBe("/usr/bin/sandbox-exec");
    expect(adapter.getRecommendedSandboxBackend()).toBe("macos-seatbelt");
  });

  it("should resolve Linux bundled bwrap path from candidates", () => {
    const adapter = createPlatformAdapter("linux");
    const resourcesRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "platform-adapter-test-"),
    );
    const bundledBwrap = path.join(
      resourcesRoot,
      "sandbox-runtime",
      "linux",
      "bwrap",
    );

    try {
      fs.mkdirSync(path.dirname(bundledBwrap), { recursive: true });
      fs.writeFileSync(bundledBwrap, "");

      const resolved = adapter.resolveBundledLinuxBwrapPath(resourcesRoot);
      expect(resolved).toBe(bundledBwrap);
    } finally {
      fs.rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });

  it("should include Windows helper candidates with windows-specific path priority", () => {
    const adapter = createPlatformAdapter("win32");
    const candidates =
      adapter.getBundledSandboxHelperCandidates("/mock/resources");

    expect(candidates).toEqual([
      path.join(
        "/mock/resources",
        "sandbox-runtime",
        "bin",
        "nuwax-sandbox-helper.exe",
      ),
      path.join(
        "/mock/resources",
        "sandbox-runtime",
        "windows",
        "nuwax-sandbox-helper.exe",
      ),
      path.join(
        "/mock/resources",
        "sandbox-helper",
        "nuwax-sandbox-helper.exe",
      ),
    ]);
  });

  it("should classify supported platforms and fallback current platform", () => {
    expect(isSupportedPlatform("darwin")).toBe(true);
    expect(isSupportedPlatform("linux")).toBe(true);
    expect(isSupportedPlatform("win32")).toBe(true);
    expect(isSupportedPlatform("freebsd")).toBe(false);

    Object.defineProperty(process, "platform", {
      value: "freebsd",
      writable: true,
      configurable: true,
    });
    expect(getCurrentPlatform()).toBe("linux");
  });
});
