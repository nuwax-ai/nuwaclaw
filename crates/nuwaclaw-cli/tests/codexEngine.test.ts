import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

// Isolates the auth.json gate from the real network download, which is
// covered separately by the manual smoke test against the real GitHub release.
vi.mock("../src/core/engines/codexDownload.js", () => ({
  ensureCodexAcpBinary: vi.fn().mockResolvedValue("/fake/nuwax-codex-acp"),
}));

describe("codexEngine.resolve", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwaclaw-codex-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("throws a clear error before attempting any download when ~/.codex/auth.json is missing", async () => {
    const { codexEngine } = await import("../src/core/engines/codex.js");
    await expect(codexEngine.resolve()).rejects.toThrow(/auth\.json/);
  });

  it("resolves via the (mocked) binary downloader once ~/.codex/auth.json exists", async () => {
    const authFile = path.join(tmpHome, ".codex", "auth.json");
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, "{}");
    const { codexEngine } = await import("../src/core/engines/codex.js");
    const resolved = await codexEngine.resolve();
    expect(resolved.command).toBe("/fake/nuwax-codex-acp");
    expect(resolved.args).toEqual([]);
  });
});
