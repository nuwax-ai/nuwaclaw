import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const mockAppData = path.join(
  os.tmpdir(),
  `nuwaclaw-opencode-plugin-share-${process.pid}`,
);
const mockResources = path.join(mockAppData, "resources");

vi.mock("../../system/appPaths", () => ({
  getAppDataDir: () => mockAppData,
  getResourcesPath: () => mockResources,
}));

vi.mock("../../system/appEnv", () => ({
  getAppEnv: () => ({ PATH: process.env.PATH || "" }),
}));

const mockIsWindows = vi.fn(() => false);
vi.mock("../../system/shellEnv", () => ({
  isWindows: () => mockIsWindows(),
}));

import {
  sanitizeVersionSegment,
  getSharedOpencodePluginDir,
  linkSharedOpencodePluginNodeModules,
  resolveOpencodePluginVersion,
} from "./opencodePluginShare";

describe("opencodePluginShare", () => {
  beforeEach(() => {
    mockIsWindows.mockReturnValue(false);
    fs.mkdirSync(path.join(mockResources, "nuwaxcode"), { recursive: true });
    fs.writeFileSync(
      path.join(mockResources, "nuwaxcode", ".version"),
      "1.17.6\n",
    );
  });

  afterEach(() => {
    if (fs.existsSync(mockAppData)) {
      fs.rmSync(mockAppData, { recursive: true, force: true });
    }
  });

  it("sanitizeVersionSegment blocks path traversal", () => {
    expect(sanitizeVersionSegment("1.17.6")).toBe("1.17.6");
    expect(sanitizeVersionSegment("../evil")).toBe("__evil");
  });

  it("resolveOpencodePluginVersion reads bundled .version", () => {
    expect(resolveOpencodePluginVersion()).toBe("1.17.6");
  });

  it("links with dir symlink on Unix and preserves package.json", () => {
    const version = "1.17.6";
    const sharedDir = getSharedOpencodePluginDir(version);
    const sharedNm = path.join(
      sharedDir,
      "node_modules",
      "@opencode-ai",
      "plugin",
    );
    fs.mkdirSync(sharedNm, { recursive: true });
    fs.writeFileSync(path.join(sharedNm, "index.js"), "module.exports={}");

    const home = path.join(mockAppData, "run", "home-unix");
    const result = linkSharedOpencodePluginNodeModules(home, sharedDir);

    expect(result.ok).toBe(true);
    expect(result.linkType).toBe("dir");
    const linkPath = path.join(home, ".config", "opencode", "node_modules");
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(
      fs.existsSync(path.join(linkPath, "@opencode-ai", "plugin", "index.js")),
    ).toBe(true);
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(home, ".config", "opencode", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.dependencies["@opencode-ai/plugin"]).toBe(version);
  });

  it("uses junction type on Windows", () => {
    mockIsWindows.mockReturnValue(true);
    const version = "1.17.6";
    const sharedDir = getSharedOpencodePluginDir(version);
    const sharedNm = path.join(
      sharedDir,
      "node_modules",
      "@opencode-ai",
      "plugin",
    );
    fs.mkdirSync(sharedNm, { recursive: true });
    fs.writeFileSync(path.join(sharedNm, "index.js"), "ok");

    const home = path.join(mockAppData, "run", "home-win");
    const result = linkSharedOpencodePluginNodeModules(home, sharedDir);

    // Node：非 Windows 上 type=junction 等价于 dir symlink，仍应成功
    expect(result.ok).toBe(true);
    expect(result.linkType).toBe("junction");
    const linkPath = path.join(home, ".config", "opencode", "node_modules");
    expect(
      fs.existsSync(path.join(linkPath, "@opencode-ai", "plugin", "index.js")),
    ).toBe(true);
  });

  it("replaces real node_modules directory with link", () => {
    const version = "1.17.6";
    const sharedDir = getSharedOpencodePluginDir(version);
    const sharedNm = path.join(
      sharedDir,
      "node_modules",
      "@opencode-ai",
      "plugin",
    );
    fs.mkdirSync(sharedNm, { recursive: true });
    fs.writeFileSync(path.join(sharedNm, "index.js"), "shared");

    const home = path.join(mockAppData, "run", "home-replace");
    const linkPath = path.join(home, ".config", "opencode", "node_modules");
    fs.mkdirSync(linkPath, { recursive: true });
    fs.writeFileSync(path.join(linkPath, "legacy.js"), "old-copy");

    const result = linkSharedOpencodePluginNodeModules(home, sharedDir);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(linkPath, "legacy.js"))).toBe(false);
    expect(
      fs.existsSync(path.join(linkPath, "@opencode-ai", "plugin", "index.js")),
    ).toBe(true);
  });

  it("is idempotent when already linked to shared", () => {
    const version = "1.17.6";
    const sharedDir = getSharedOpencodePluginDir(version);
    const sharedNmRoot = path.join(sharedDir, "node_modules");
    const sharedNm = path.join(sharedNmRoot, "@opencode-ai", "plugin");
    fs.mkdirSync(sharedNm, { recursive: true });
    fs.writeFileSync(path.join(sharedNm, "index.js"), "shared");

    const home = path.join(mockAppData, "run", "home-idemp");
    const first = linkSharedOpencodePluginNodeModules(home, sharedDir);
    const second = linkSharedOpencodePluginNodeModules(home, sharedDir);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
  });
});
