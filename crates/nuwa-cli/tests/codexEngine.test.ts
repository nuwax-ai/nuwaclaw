import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

vi.mock("../src/core/engines/packageResolve.js", () => ({
  resolveInstalledPackageEntry: vi
    .fn()
    .mockReturnValue("/fake/nuwax-codex-acp.js"),
}));

describe("codexEngine.resolve", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-codex-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("throws a clear error before resolving the adapter when ~/.codex/auth.json is missing", async () => {
    const { codexEngine } = await import("../src/core/engines/codex.js");
    await expect(codexEngine.resolve()).rejects.toThrow(/auth\.json/);
  });

  it("resolves via the package dependency adapter once ~/.codex/auth.json exists", async () => {
    const authFile = path.join(tmpHome, ".codex", "auth.json");
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, "{}");
    const { codexEngine } = await import("../src/core/engines/codex.js");
    const resolved = await codexEngine.resolve();
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args).toEqual(["/fake/nuwax-codex-acp.js"]);
  });
});
