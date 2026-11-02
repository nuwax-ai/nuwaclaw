import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mockAppData = path.join(
  os.tmpdir(),
  `nuwaclaw-npm-cache-test-${process.pid}`,
);

vi.mock("./appPaths", () => ({
  getAppDataDir: () => mockAppData,
}));

vi.mock("./binaryLocator", () => ({
  getUvBinPath: () => path.join(mockAppData, "fake-uv"),
}));

vi.mock("./appEnv", () => ({
  getAppEnv: () => ({ PATH: "/usr/bin" }),
}));

vi.mock("./shellEnv", () => ({
  isWindows: () => false,
}));

import {
  getNpmCacheDir,
  maintainNpmPackageCache,
  DEFAULT_NPM_CACHE_SOFT_LIMIT_BYTES,
} from "./npmCacheMaintenance";

describe("npmCacheMaintenance", () => {
  afterEach(() => {
    if (fs.existsSync(mockAppData)) {
      fs.rmSync(mockAppData, { recursive: true, force: true });
    }
  });

  it("getNpmCacheDir points under app data npm-cache", () => {
    expect(getNpmCacheDir()).toBe(path.join(mockAppData, "npm-cache"));
  });

  it("skips when below soft limit", () => {
    const cache = getNpmCacheDir();
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "x"), "small");

    const calls: string[][] = [];
    const result = maintainNpmPackageCache({
      softLimitBytes: 1024 * 1024,
      getSizeBytes: () => 100,
      runNpm: (args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    expect(result.skipped).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("clears _npx when over limit and skips clean if size drops", () => {
    const cache = getNpmCacheDir();
    const npx = path.join(cache, "_npx", "abc");
    fs.mkdirSync(npx, { recursive: true });
    fs.writeFileSync(path.join(npx, "x"), "1");

    const removed: string[] = [];
    const calls: string[][] = [];
    let size = 3 * 1024 * 1024 * 1024;
    const result = maintainNpmPackageCache({
      softLimitBytes: 2 * 1024 * 1024 * 1024,
      getSizeBytes: () => size,
      removePath: (p) => {
        removed.push(p);
        size = 500 * 1024 * 1024;
      },
      runNpm: (args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    expect(result.skipped).toBe(false);
    expect(result.clearedNpx).toBe(true);
    expect(result.cleaned).toBe(false);
    expect(removed.some((p) => p.endsWith("_npx"))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("runs npm cache clean when still over soft limit", () => {
    const cache = getNpmCacheDir();
    fs.mkdirSync(path.join(cache, "_npx"), { recursive: true });
    fs.mkdirSync(path.join(cache, "_cacache"), { recursive: true });

    const calls: string[][] = [];
    let size = 5 * 1024 * 1024 * 1024;
    const result = maintainNpmPackageCache({
      softLimitBytes: DEFAULT_NPM_CACHE_SOFT_LIMIT_BYTES,
      getSizeBytes: () => size,
      removePath: (p) => {
        if (p.endsWith("_npx")) size = 4 * 1024 * 1024 * 1024;
      },
      runNpm: (args) => {
        calls.push(args);
        size = 20 * 1024 * 1024;
        return { status: 0 };
      },
    });

    expect(result.clearedNpx).toBe(true);
    expect(result.cleaned).toBe(true);
    expect(calls).toEqual([["cache", "clean", "--force"]]);
    expect(result.afterBytes).toBe(20 * 1024 * 1024);
  });

  it("falls back to rm _cacache when npm clean fails", () => {
    const cache = getNpmCacheDir();
    fs.mkdirSync(path.join(cache, "_cacache"), { recursive: true });

    const removed: string[] = [];
    let size = 3 * 1024 * 1024 * 1024;
    const result = maintainNpmPackageCache({
      softLimitBytes: 2 * 1024 * 1024 * 1024,
      getSizeBytes: () => size,
      removePath: (p) => {
        removed.push(p);
        if (p.endsWith("_cacache")) size = 5 * 1024 * 1024;
      },
      runNpm: () => ({ status: 1, stderr: "fail" }),
    });

    expect(result.cleaned).toBe(true);
    expect(removed.some((p) => p.endsWith("_cacache"))).toBe(true);
  });
});
