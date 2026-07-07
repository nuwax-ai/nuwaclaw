import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, "..", "..");
const require = createRequire(import.meta.url);
const {
  resolveClaudeAgentSdkPlatformPackage,
  getInstalledClaudeAgentSdkPlatformPackages,
  verifyClaudeAgentSdkPlatformPackage,
  buildRuntimePackageJson,
} = require(
  path.join(
    projectRoot,
    "scripts",
    "prepare",
    "prepare-claude-code-acp-ts.js",
  ),
) as {
  resolveClaudeAgentSdkPlatformPackage: (options?: {
    platform?: string;
    targetArch?: string;
  }) => string;
  getInstalledClaudeAgentSdkPlatformPackages: (baseDir: string) => string[];
  verifyClaudeAgentSdkPlatformPackage: (
    baseDir: string,
    platformPackage: string,
  ) => void;
  buildRuntimePackageJson: (sourcePackageJson: Record<string, unknown>) => Record<string, unknown>;
};

describe("prepare-claude-code-acp-ts helpers", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("maps macOS target arch to the matching Claude SDK platform package", () => {
    expect(
      resolveClaudeAgentSdkPlatformPackage({
        platform: "darwin",
        targetArch: "x64",
      }),
    ).toBe("@anthropic-ai/claude-agent-sdk-darwin-x64");

    expect(
      resolveClaudeAgentSdkPlatformPackage({
        platform: "darwin",
        targetArch: "arm64",
      }),
    ).toBe("@anthropic-ai/claude-agent-sdk-darwin-arm64");
  });

  it("lists installed Claude SDK platform packages under @anthropic-ai", () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "prepare-claude-code-acp-ts-"),
    );
    tempDirs.push(baseDir);

    fs.mkdirSync(
      path.join(
        baseDir,
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk-darwin-x64",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(
        baseDir,
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk-darwin-arm64",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(baseDir, "node_modules", "@anthropic-ai", "sdk"),
      { recursive: true },
    );

    expect(getInstalledClaudeAgentSdkPlatformPackages(baseDir)).toEqual([
      "@anthropic-ai/claude-agent-sdk-darwin-arm64",
      "@anthropic-ai/claude-agent-sdk-darwin-x64",
    ]);
  });

  it("accepts exactly one matching platform package", () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "prepare-claude-code-acp-ts-"),
    );
    tempDirs.push(baseDir);

    fs.mkdirSync(
      path.join(baseDir, "node_modules", "@anthropic-ai", "claude-agent-sdk"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        baseDir,
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk",
        "package.json",
      ),
      JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "0.0.0" }),
      "utf8",
    );
    fs.mkdirSync(
      path.join(
        baseDir,
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk-darwin-x64",
      ),
      { recursive: true },
    );

    expect(() =>
      verifyClaudeAgentSdkPlatformPackage(
        baseDir,
        "@anthropic-ai/claude-agent-sdk-darwin-x64",
      ),
    ).not.toThrow();
  });

  it("rejects mixed platform packages so cross-arch bundles fail fast", () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "prepare-claude-code-acp-ts-"),
    );
    tempDirs.push(baseDir);

    fs.mkdirSync(
      path.join(baseDir, "node_modules", "@anthropic-ai", "claude-agent-sdk"),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        baseDir,
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk",
        "package.json",
      ),
      JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "0.0.0" }),
      "utf8",
    );
    fs.mkdirSync(
      path.join(
        baseDir,
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk-darwin-x64",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(
        baseDir,
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk-darwin-arm64",
      ),
      { recursive: true },
    );

    expect(() =>
      verifyClaudeAgentSdkPlatformPackage(
        baseDir,
        "@anthropic-ai/claude-agent-sdk-darwin-x64",
      ),
    ).toThrow(/多余平台包/);
  });

  it("builds a runtime-only package manifest for staging install", () => {
    const runtimePkg = buildRuntimePackageJson({
      name: "claude-code-acp-ts",
      version: "0.52.0",
      description: "runtime",
      main: "dist/lib.js",
      types: "dist/lib.d.ts",
      bin: { "claude-code-acp-ts": "./dist/index.js" },
      type: "module",
      exports: { ".": "./dist/lib.js" },
      engines: { node: ">=22" },
      dependencies: { zod: "^4.0.0" },
      devDependencies: { vitest: "^2.0.0" },
      scripts: { build: "tsc" },
      files: ["dist/"],
    });

    expect(runtimePkg).toEqual({
      name: "claude-code-acp-ts",
      version: "0.52.0",
      description: "runtime",
      main: "dist/lib.js",
      types: "dist/lib.d.ts",
      bin: { "claude-code-acp-ts": "./dist/index.js" },
      type: "module",
      exports: { ".": "./dist/lib.js" },
      engines: { node: ">=22" },
      dependencies: { zod: "^4.0.0" },
    });
  });
});
