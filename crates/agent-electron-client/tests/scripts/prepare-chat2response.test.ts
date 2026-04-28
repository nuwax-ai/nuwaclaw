import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, "..", "..");
const scriptPath = path.join(
  projectRoot,
  "scripts",
  "prepare",
  "prepare-chat2response.js",
);

describe("prepare-chat2response script contracts", () => {
  it("uses cross-platform copy instead of shell cp", () => {
    const content = fs.readFileSync(scriptPath, "utf8");
    expect(content).toContain("fs.cpSync(");
    expect(content).not.toContain("cp -R");
  });

  it("only skips when runtime chat2response package exists", () => {
    const content = fs.readFileSync(scriptPath, "utf8");
    expect(content).toContain("destRuntimePkgPath");
    expect(content).toContain('"node_modules"');
    expect(content).toContain('"chat2response"');
    expect(content).toContain("fs.existsSync(destRuntimePkgPath)");
  });
});

