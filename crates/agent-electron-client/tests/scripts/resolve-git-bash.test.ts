import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("resolve-git-bash.mjs", () => {
  const originalEnv = { ...process.env };
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "nuwaclaw-git-"));
    process.env = { ...originalEnv };
    delete process.env.NUWAX_SANDBOX_GIT_BASH_PATH;
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("prefers NUWAX_SANDBOX_GIT_BASH_PATH when set", async () => {
    const custom = path.join(tmpDir, "custom-bash.exe");
    await fs.promises.writeFile(custom, "");
    process.env.NUWAX_SANDBOX_GIT_BASH_PATH = custom;

    const { resolveGitBashPath } = await import(
      path.resolve(
        process.cwd(),
        "resources/sandboxed-bash-mcp/resolve-git-bash.mjs",
      )
    );
    expect(resolveGitBashPath()).toBe(custom);
  });

  it("discovers bundled bash next to extraResources when prepare:git has run", async () => {
    const expectedBash = path.resolve(
      process.cwd(),
      "resources/git/bin/bash.exe",
    );
    if (!fs.existsSync(expectedBash)) {
      return;
    }

    const { resolveGitBashPath } = await import(
      path.resolve(
        process.cwd(),
        "resources/sandboxed-bash-mcp/resolve-git-bash.mjs",
      )
    );
    expect(resolveGitBashPath()).toBe(expectedBash);
  });
});
