import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mockAppData = path.join(
  os.tmpdir(),
  `nuwaclaw-uv-cache-test-${process.pid}`,
);

vi.mock("./appPaths", () => ({
  getAppDataDir: () => mockAppData,
}));

vi.mock("./binaryLocator", () => ({
  getUvBinPath: () => path.join(mockAppData, "fake-uv"),
}));

import {
  getUvCacheDir,
  getDirectorySizeBytes,
  maintainUvPackageCache,
  DEFAULT_UV_CACHE_SOFT_LIMIT_BYTES,
} from "./uvCacheMaintenance";

describe("uvCacheMaintenance", () => {
  afterEach(() => {
    if (fs.existsSync(mockAppData)) {
      fs.rmSync(mockAppData, { recursive: true, force: true });
    }
  });

  it("getUvCacheDir points under app data uv/cache", () => {
    expect(getUvCacheDir()).toBe(path.join(mockAppData, "uv", "cache"));
  });

  it("getDirectorySizeBytes sums nested files", () => {
    const root = path.join(mockAppData, "sized");
    fs.mkdirSync(path.join(root, "a"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "f.txt"), "hello"); // 5 bytes
    fs.writeFileSync(path.join(root, "b.bin"), "world!"); // 6 bytes
    expect(getDirectorySizeBytes(root)).toBe(11);
  });

  it("skips when cache dir missing", () => {
    const result = maintainUvPackageCache({
      runUv: () => ({ status: 0 }),
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/missing/);
    expect(result.pruned).toBe(false);
  });

  it("skips prune when below soft limit", () => {
    const cache = getUvCacheDir();
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "x"), "small");

    const calls: string[][] = [];
    const result = maintainUvPackageCache({
      softLimitBytes: 1024 * 1024,
      runUv: (args) => {
        calls.push(args);
        return { status: 0 };
      },
      getSizeBytes: () => 100,
    });

    expect(result.skipped).toBe(true);
    expect(result.pruned).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("prunes when over soft limit and does not clean if size drops", () => {
    const cache = getUvCacheDir();
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "x"), "x");

    const calls: string[][] = [];
    let size = 3 * 1024 * 1024 * 1024;
    const result = maintainUvPackageCache({
      softLimitBytes: 2 * 1024 * 1024 * 1024,
      runUv: (args) => {
        calls.push(args);
        if (args[0] === "cache" && args[1] === "prune") {
          size = 500 * 1024 * 1024; // prune 后降到 500MiB
        }
        return { status: 0 };
      },
      getSizeBytes: () => size,
    });

    expect(result.skipped).toBe(false);
    expect(result.pruned).toBe(true);
    expect(result.cleaned).toBe(false);
    expect(calls).toEqual([["cache", "prune", "--force"]]);
    expect(result.afterBytes).toBe(500 * 1024 * 1024);
  });

  it("cleans when still over soft limit after prune", () => {
    const cache = getUvCacheDir();
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "x"), "x");

    const calls: string[][] = [];
    let size = 5 * 1024 * 1024 * 1024;
    const result = maintainUvPackageCache({
      softLimitBytes: DEFAULT_UV_CACHE_SOFT_LIMIT_BYTES,
      runUv: (args) => {
        calls.push(args);
        if (args[1] === "prune") size = 3 * 1024 * 1024 * 1024;
        if (args[1] === "clean") size = 10 * 1024 * 1024;
        return { status: 0 };
      },
      getSizeBytes: () => size,
    });

    expect(result.pruned).toBe(true);
    expect(result.cleaned).toBe(true);
    expect(calls).toEqual([
      ["cache", "prune", "--force"],
      ["cache", "clean", "--force"],
    ]);
    expect(result.afterBytes).toBe(10 * 1024 * 1024);
  });

  it("alwaysPrune runs even when below soft limit", () => {
    const cache = getUvCacheDir();
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "x"), "x");

    const calls: string[][] = [];
    const result = maintainUvPackageCache({
      alwaysPrune: true,
      softLimitBytes: 1024 * 1024 * 1024,
      runUv: (args) => {
        calls.push(args);
        return { status: 0 };
      },
      getSizeBytes: () => 100,
    });

    expect(result.skipped).toBe(false);
    expect(result.pruned).toBe(true);
    expect(result.cleaned).toBe(false);
    expect(calls).toEqual([["cache", "prune", "--force"]]);
  });
});
