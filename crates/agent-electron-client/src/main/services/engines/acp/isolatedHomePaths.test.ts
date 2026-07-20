import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mockAppData = path.join(
  os.tmpdir(),
  `nuwaclaw-test-appdata-${process.pid}`,
);

vi.mock("../../system/appPaths", () => ({
  getAppDataDir: () => mockAppData,
}));

import {
  sanitizePathSegment,
  resolveProjectIsolatedHomeDir,
  resolveIsolatedHomePath,
  isPersistentIsolatedHome,
  pruneStaleProjectIsolatedHomes,
  pruneOrphanEphemeralIsolatedHomes,
  pruneProjectIsolatedHomeCaches,
  getProjectIsolatedHomesRoot,
  getRunRoot,
} from "./isolatedHomePaths";

describe("isolatedHomePaths", () => {
  afterEach(() => {
    if (fs.existsSync(mockAppData)) {
      fs.rmSync(mockAppData, { recursive: true, force: true });
    }
  });

  it("sanitizePathSegment blocks traversal and separators", () => {
    expect(sanitizePathSegment("../evil")).toBe("__evil");
    expect(sanitizePathSegment("a/b")).toBe("a_b");
    expect(sanitizePathSegment("  ")).toBe("_");
  });

  it("resolveProjectIsolatedHomeDir uses user/workDir/engine segments", () => {
    const home = resolveProjectIsolatedHomeDir({
      kind: "project",
      userId: "u1",
      workDirId: "1553934",
      engine: "nuwaxcode",
    });
    expect(home).toContain(
      path.join("projects", "u1", "1553934", "nuwaxcode", "home"),
    );
  });

  it("resolveIsolatedHomePath ephemeral uses unique run directory", () => {
    const first = resolveIsolatedHomePath({ kind: "ephemeral" });
    const second = resolveIsolatedHomePath({ kind: "ephemeral" });
    expect(first.homeDir).not.toBe(second.homeDir);
    expect(first.runId).toMatch(/^acp-/);
  });

  it("resolveIsolatedHomePath project uses stable path and deterministic runId", () => {
    const { homeDir, runId } = resolveIsolatedHomePath({
      kind: "project",
      userId: "u1",
      workDirId: "1553934",
      engine: "nuwaxcode",
    });
    expect(homeDir).toBe(
      path.join(
        mockAppData,
        "run",
        "projects",
        "u1",
        "1553934",
        "nuwaxcode",
        "home",
      ),
    );
    expect(runId).toBe("project-1553934-nuwaxcode");
  });

  it("isPersistentIsolatedHome detects project paths only", () => {
    const projectHome = resolveProjectIsolatedHomeDir({
      kind: "project",
      userId: "u",
      workDirId: "p",
      engine: "nuwaxcode",
    });
    expect(isPersistentIsolatedHome(projectHome)).toBe(true);
    expect(isPersistentIsolatedHome("/tmp/acp-random")).toBe(false);
  });

  it("pruneStaleProjectIsolatedHomes deletes old homes and skips active paths", () => {
    const projectsRoot = getProjectIsolatedHomesRoot();
    const staleHome = path.join(
      projectsRoot,
      "u1",
      "old-proj",
      "nuwaxcode",
      "home",
    );
    const freshHome = path.join(
      projectsRoot,
      "u1",
      "fresh-proj",
      "nuwaxcode",
      "home",
    );
    fs.mkdirSync(staleHome, { recursive: true });
    fs.mkdirSync(freshHome, { recursive: true });

    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.utimesSync(staleHome, eightDaysAgo / 1000, eightDaysAgo / 1000);

    const deleted = pruneStaleProjectIsolatedHomes(7, {
      skipPaths: new Set([freshHome]),
    });

    expect(deleted).toBe(1);
    expect(fs.existsSync(staleHome)).toBe(false);
    expect(fs.existsSync(freshHome)).toBe(true);
  });

  it("pruneStaleProjectIsolatedHomes keeps homes newer than retention window", () => {
    const projectsRoot = getProjectIsolatedHomesRoot();
    const recentHome = path.join(
      projectsRoot,
      "u1",
      "recent-proj",
      "nuwaxcode",
      "home",
    );
    fs.mkdirSync(recentHome, { recursive: true });
    fs.writeFileSync(path.join(recentHome, "touch.txt"), "x");

    const deleted = pruneStaleProjectIsolatedHomes(7);

    expect(deleted).toBe(0);
    expect(fs.existsSync(recentHome)).toBe(true);
  });

  it("pruneOrphanEphemeralIsolatedHomes deletes stale acp-* and skips active", () => {
    const runRoot = getRunRoot();
    const staleAcp = path.join(runRoot, "acp-1000-stale1");
    const freshAcp = path.join(runRoot, "acp-2000-fresh1");
    const projectsHome = path.join(
      getProjectIsolatedHomesRoot(),
      "u1",
      "p1",
      "nuwaxcode",
      "home",
    );
    fs.mkdirSync(staleAcp, { recursive: true });
    fs.mkdirSync(freshAcp, { recursive: true });
    fs.mkdirSync(projectsHome, { recursive: true });
    fs.writeFileSync(path.join(staleAcp, "x.txt"), "stale");
    fs.writeFileSync(path.join(projectsHome, "keep.txt"), "project");

    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    fs.utimesSync(staleAcp, twoDaysAgo / 1000, twoDaysAgo / 1000);

    const deleted = pruneOrphanEphemeralIsolatedHomes(1, {
      skipPaths: new Set([freshAcp]),
    });

    expect(deleted).toBe(1);
    expect(fs.existsSync(staleAcp)).toBe(false);
    expect(fs.existsSync(freshAcp)).toBe(true);
    // 不得误删 projects/
    expect(fs.existsSync(projectsHome)).toBe(true);
  });

  it("pruneOrphanEphemeralIsolatedHomes keeps acp-* newer than retention window", () => {
    const runRoot = getRunRoot();
    const recentAcp = path.join(runRoot, "acp-3000-recent");
    fs.mkdirSync(recentAcp, { recursive: true });
    fs.writeFileSync(path.join(recentAcp, "x.txt"), "recent");

    const deleted = pruneOrphanEphemeralIsolatedHomes(1);

    expect(deleted).toBe(0);
    expect(fs.existsSync(recentAcp)).toBe(true);
  });

  it("pruneProjectIsolatedHomeCaches deletes rebuildable caches and keeps sessions", () => {
    const projectsRoot = getProjectIsolatedHomesRoot();
    const home = path.join(
      projectsRoot,
      "u1",
      "cache-proj",
      "claude-code",
      "home",
    );
    const cacheDir = path.join(home, ".cache");
    const npmDir = path.join(home, ".npm");
    const tmpDir = path.join(home, "tmp");
    const pnpmShare = path.join(home, ".local", "share", "pnpm");
    const uvShare = path.join(home, ".local", "share", "uv");
    const opencodeLog = path.join(home, ".local", "share", "opencode", "log");
    const opencodeNm = path.join(home, ".config", "opencode", "node_modules");
    const opencodeDb = path.join(home, ".local", "share", "opencode");
    const flowagents = path.join(home, ".flowagents");
    const claude = path.join(home, ".claude");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(npmDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(pnpmShare, { recursive: true });
    fs.mkdirSync(uvShare, { recursive: true });
    fs.mkdirSync(opencodeLog, { recursive: true });
    fs.mkdirSync(opencodeNm, { recursive: true });
    fs.mkdirSync(flowagents, { recursive: true });
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "a"), "1");
    fs.writeFileSync(path.join(npmDir, "b"), "2");
    fs.writeFileSync(path.join(tmpDir, "c"), "3");
    fs.writeFileSync(path.join(pnpmShare, "d"), "4");
    fs.writeFileSync(path.join(uvShare, "python.bin"), "5");
    fs.writeFileSync(path.join(opencodeLog, "app.log"), "log");
    fs.writeFileSync(path.join(opencodeNm, "pkg.js"), "x");
    fs.writeFileSync(path.join(opencodeDb, "opencode.db"), "db");
    fs.writeFileSync(
      path.join(home, ".config", "opencode", "package.json"),
      '{"dependencies":{}}',
    );
    fs.writeFileSync(path.join(flowagents, "sess.json"), "{}");
    fs.writeFileSync(path.join(claude, "settings.json"), "{}");

    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    for (const p of [
      cacheDir,
      npmDir,
      tmpDir,
      pnpmShare,
      uvShare,
      opencodeLog,
      opencodeNm,
    ]) {
      fs.utimesSync(p, threeDaysAgo / 1000, threeDaysAgo / 1000);
    }

    const deleted = pruneProjectIsolatedHomeCaches(2);

    // .cache .npm tmp pnpm uv opencode/log opencode/node_modules → 7
    expect(deleted).toBe(7);
    expect(fs.existsSync(cacheDir)).toBe(false);
    expect(fs.existsSync(npmDir)).toBe(false);
    expect(fs.existsSync(tmpDir)).toBe(false);
    expect(fs.existsSync(pnpmShare)).toBe(false);
    expect(fs.existsSync(uvShare)).toBe(false);
    expect(fs.existsSync(opencodeLog)).toBe(false);
    expect(fs.existsSync(opencodeNm)).toBe(false);
    expect(fs.existsSync(path.join(opencodeDb, "opencode.db"))).toBe(true);
    expect(
      fs.existsSync(path.join(home, ".config", "opencode", "package.json")),
    ).toBe(true);
    expect(fs.existsSync(flowagents)).toBe(true);
    expect(fs.existsSync(claude)).toBe(true);
  });

  it("pruneProjectIsolatedHomeCaches uses shorter TTL for tmp", () => {
    const projectsRoot = getProjectIsolatedHomesRoot();
    const home = path.join(
      projectsRoot,
      "u1",
      "tmp-ttl-proj",
      "nuwaxcode",
      "home",
    );
    const tmpDir = path.join(home, "tmp");
    const cacheDir = path.join(home, ".cache");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "x"), "1");
    fs.writeFileSync(path.join(cacheDir, "y"), "2");

    const thirtyHoursAgo = Date.now() - 30 * 60 * 60 * 1000;
    fs.utimesSync(tmpDir, thirtyHoursAgo / 1000, thirtyHoursAgo / 1000);
    fs.utimesSync(cacheDir, thirtyHoursAgo / 1000, thirtyHoursAgo / 1000);

    // tmp 默认 1d 应删；.cache 默认 2d 应留
    const deleted = pruneProjectIsolatedHomeCaches(2);

    expect(deleted).toBe(1);
    expect(fs.existsSync(tmpDir)).toBe(false);
    expect(fs.existsSync(cacheDir)).toBe(true);
  });

  it("pruneProjectIsolatedHomeCaches keeps caches newer than retention and skips active", () => {
    const projectsRoot = getProjectIsolatedHomesRoot();
    const activeHome = path.join(
      projectsRoot,
      "u1",
      "active-proj",
      "nuwaxcode",
      "home",
    );
    const idleHome = path.join(
      projectsRoot,
      "u1",
      "idle-proj",
      "nuwaxcode",
      "home",
    );
    const activeCache = path.join(activeHome, ".cache");
    const idleCache = path.join(idleHome, ".cache");
    const recentCache = path.join(idleHome, ".npm");
    fs.mkdirSync(activeCache, { recursive: true });
    fs.mkdirSync(idleCache, { recursive: true });
    fs.mkdirSync(recentCache, { recursive: true });

    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    fs.utimesSync(activeCache, threeDaysAgo / 1000, threeDaysAgo / 1000);
    fs.utimesSync(idleCache, threeDaysAgo / 1000, threeDaysAgo / 1000);
    // recentCache 保持当前 mtime，不应被删

    const deleted = pruneProjectIsolatedHomeCaches(2, {
      skipPaths: new Set([activeHome]),
    });

    expect(deleted).toBe(1);
    expect(fs.existsSync(activeCache)).toBe(true);
    expect(fs.existsSync(idleCache)).toBe(false);
    expect(fs.existsSync(recentCache)).toBe(true);
  });
});
