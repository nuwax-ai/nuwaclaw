import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mockAppData = path.join(
  os.tmpdir(),
  `nuwaclaw-mcp-warmup-test-${process.pid}`,
);

vi.mock("./appPaths", () => ({
  getAppDataDir: () => mockAppData,
}));

vi.mock("./appEnv", () => ({
  getAppEnv: () => ({
    PATH: "/usr/bin",
    NPM_CONFIG_CACHE: path.join(mockAppData, "npm-cache"),
  }),
}));

vi.mock("./shellEnv", () => ({
  isWindows: () => false,
}));

vi.mock("./binaryLocator", () => ({
  getBundledNodeBinDir: vi.fn(() => ""),
  getNodeBinPathWithFallback: vi.fn(() => "/fake/bundled-node"),
}));

vi.mock("./npmCacheMaintenance", () => ({
  getNpmCacheDir: () => path.join(mockAppData, "npm-cache"),
}));

import {
  MCP_WARMUP_SPECS,
  pkgNameFromSpec,
  isPackageInNpxCache,
  resolveWarmupNpxCommand,
  warmupMcpNpxCache,
} from "./mcpCacheWarmup";
import * as binaryLocator from "./binaryLocator";

const npxDir = path.join(mockAppData, "npm-cache", "_npx");
const statePath = path.join(mockAppData, ".mcp-npx-warmup.json");

/** 构造一个「spawn 后即标记命中」的可控句柄集合，精确驱动 warmupOne 流程。 */
function makeSpawnThatCaches() {
  const cached = new Set<string>();
  const kill = vi.fn();
  const spawnNpx = vi.fn((spec: string) => {
    cached.add(pkgNameFromSpec(spec));
    return { kill, onClose: new Promise<number | null>(() => {}) };
  });
  const isCached = vi.fn((_dir: string, pkg: string) => cached.has(pkg));
  return { spawnNpx, isCached, kill, cached };
}

describe("mcpCacheWarmup / pkgNameFromSpec", () => {
  it("strips @latest but keeps @scope", () => {
    expect(pkgNameFromSpec("nuwax-ask-question-mcp@latest")).toBe(
      "nuwax-ask-question-mcp",
    );
    expect(pkgNameFromSpec("@nuwax-ai/openui-mcp@latest")).toBe(
      "@nuwax-ai/openui-mcp",
    );
    expect(pkgNameFromSpec("chrome-devtools-mcp@latest")).toBe(
      "chrome-devtools-mcp",
    );
  });
});

describe("mcpCacheWarmup / isPackageInNpxCache", () => {
  beforeEach(() => {
    if (fs.existsSync(mockAppData))
      fs.rmSync(mockAppData, { recursive: true, force: true });
  });
  afterEach(() => {
    if (fs.existsSync(mockAppData))
      fs.rmSync(mockAppData, { recursive: true, force: true });
  });

  it("returns true when package exists under any hash dir (incl scope)", () => {
    fs.mkdirSync(
      path.join(npxDir, "h1", "node_modules", "@nuwax-ai", "openui-mcp"),
      { recursive: true },
    );
    expect(isPackageInNpxCache(npxDir, "@nuwax-ai/openui-mcp")).toBe(true);
  });

  it("returns false when missing", () => {
    fs.mkdirSync(path.join(npxDir, "h1", "node_modules"), { recursive: true });
    expect(isPackageInNpxCache(npxDir, "nuwax-ask-question-mcp")).toBe(false);
  });

  it("returns false when _npx does not exist", () => {
    expect(isPackageInNpxCache(npxDir, "anything")).toBe(false);
  });
});

describe("mcpCacheWarmup / resolveWarmupNpxCommand", () => {
  it("returns null when node unavailable", () => {
    vi.mocked(binaryLocator.getNodeBinPathWithFallback).mockReturnValue(null);
    expect(resolveWarmupNpxCommand()).toBeNull();
  });

  it("uses PATH npx on non-windows", () => {
    vi.mocked(binaryLocator.getNodeBinPathWithFallback).mockReturnValue(
      "/fake/node",
    );
    const cmd = resolveWarmupNpxCommand();
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("npx");
    expect(cmd!.args("foo@latest")).toEqual(["-y", "foo@latest"]);
  });
});

describe("mcpCacheWarmup / warmupMcpNpxCache", () => {
  beforeEach(() => {
    if (fs.existsSync(mockAppData))
      fs.rmSync(mockAppData, { recursive: true, force: true });
    vi.mocked(binaryLocator.getNodeBinPathWithFallback).mockReturnValue(
      "/fake/bundled-node",
    );
  });
  afterEach(() => {
    if (fs.existsSync(mockAppData))
      fs.rmSync(mockAppData, { recursive: true, force: true });
  });

  it("skips when npx unavailable", async () => {
    vi.mocked(binaryLocator.getNodeBinPathWithFallback).mockReturnValue(null);
    const r = await warmupMcpNpxCache({ appVersion: "1.0.0" });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("npx unavailable");
  });

  it("warms up each package: spawns npx, kills after cache hit, writes state", async () => {
    const { spawnNpx, isCached, kill } = makeSpawnThatCaches();
    const r = await warmupMcpNpxCache({
      appVersion: "1.0.0",
      spawnNpx,
      isCached,
      pollIntervalMs: 1,
      killGraceMs: 1,
    });
    expect(r.skipped).toBe(false);
    expect(r.warmed).toEqual([...MCP_WARMUP_SPECS]);
    expect(r.failed).toEqual([]);
    expect(spawnNpx).toHaveBeenCalledTimes(MCP_WARMUP_SPECS.length);
    expect(kill).toHaveBeenCalled();
    // 标记文件写入
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(state.appVersion).toBe("1.0.0");
    expect(state.specs).toEqual([...MCP_WARMUP_SPECS]);
  });

  it("records failure on timeout (never cached)", async () => {
    const kill = vi.fn();
    const spawnNpx = vi.fn(() => ({
      kill,
      onClose: new Promise<number | null>(() => {}),
    }));
    const isCached = vi.fn(() => false);
    const r = await warmupMcpNpxCache({
      appVersion: "1.0.0",
      spawnNpx,
      isCached,
      perPkgTimeoutMs: 10,
      pollIntervalMs: 2,
      killGraceMs: 1,
    });
    expect(r.skipped).toBe(false);
    expect(r.failed).toHaveLength(MCP_WARMUP_SPECS.length);
    expect(r.warmed).toEqual([]);
    expect(kill).toHaveBeenCalled();
    // 失败时不写标记
    expect(fs.existsSync(statePath)).toBe(false);
  });

  it("skips (no spawn) when marker matches and all cached", async () => {
    const { spawnNpx, isCached } = makeSpawnThatCaches();
    fs.mkdirSync(mockAppData, { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        appVersion: "1.0.0",
        npxDir,
        specs: [...MCP_WARMUP_SPECS],
        warmedAt: 1,
      }),
    );
    // 全部已缓存：标记 + 谓词双命中
    const r = await warmupMcpNpxCache({
      appVersion: "1.0.0",
      spawnNpx,
      isCached: () => true,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("already warmed");
    expect(spawnNpx).not.toHaveBeenCalled();
  });

  it("self-heals when marker exists but cache was cleared", async () => {
    const { spawnNpx, isCached } = makeSpawnThatCaches();
    fs.mkdirSync(mockAppData, { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        appVersion: "1.0.0",
        npxDir,
        specs: [...MCP_WARMUP_SPECS],
        warmedAt: 1,
      }),
    );
    // 标记在，但 isCached 初始全 false（模拟 GC 删了 _npx）→ 应重新预热
    const r = await warmupMcpNpxCache({
      appVersion: "1.0.0",
      spawnNpx,
      isCached,
      pollIntervalMs: 1,
      killGraceMs: 1,
    });
    expect(r.skipped).toBe(false);
    expect(spawnNpx).toHaveBeenCalled();
  });
});
