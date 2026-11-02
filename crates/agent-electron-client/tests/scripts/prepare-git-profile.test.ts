import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, "..", "..");
const require = createRequire(import.meta.url);
const { patchGitEtcProfile } = require(
  path.join(projectRoot, "scripts", "prepare", "prepare-git.js"),
) as {
  patchGitEtcProfile: (gitRoot?: string) => string[];
};

const GUARD_MARKER = "# [NuwaClaw] MSYS2 stdout guard";

describe("patchGitEtcProfile", () => {
  let tempGitRoot: string;

  beforeEach(() => {
    tempGitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-git-test-"));
    fs.mkdirSync(path.join(tempGitRoot, "etc"), { recursive: true });
    fs.writeFileSync(
      path.join(tempGitRoot, "etc", "profile"),
      "# original profile\nexport FOO=1\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tempGitRoot, { recursive: true, force: true });
  });

  it("injects stdout guard at start and end of etc/profile", () => {
    const patched = patchGitEtcProfile(tempGitRoot);
    expect(patched).toHaveLength(1);

    const content = fs.readFileSync(
      path.join(tempGitRoot, "etc", "profile"),
      "utf-8",
    );
    expect(content.startsWith(GUARD_MARKER)).toBe(true);
    expect(content).toContain("exec 3>&1 4>&2 1>&2");
    expect(content).toContain("# original profile");
    expect(content).toContain(`${GUARD_MARKER} end`);
    expect(content).toContain("exec 1>&3 2>&4 3>&- 4>&-");
  });

  it("is idempotent when run twice", () => {
    patchGitEtcProfile(tempGitRoot);
    const afterFirst = fs.readFileSync(
      path.join(tempGitRoot, "etc", "profile"),
      "utf-8",
    );
    patchGitEtcProfile(tempGitRoot);
    const afterSecond = fs.readFileSync(
      path.join(tempGitRoot, "etc", "profile"),
      "utf-8",
    );
    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond.split(GUARD_MARKER).length - 1).toBe(2);
  });
});
