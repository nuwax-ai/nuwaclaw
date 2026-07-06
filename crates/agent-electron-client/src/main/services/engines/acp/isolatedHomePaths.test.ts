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
  getProjectIsolatedHomesRoot,
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
});
