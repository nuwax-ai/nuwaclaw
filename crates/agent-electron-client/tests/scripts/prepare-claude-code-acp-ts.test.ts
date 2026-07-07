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
  needsDarwinX64CrossArchBundling,
  DARWIN_X64_SDK_PACKAGE,
  resolveClaudeAgentSdkPlatformPackageVersion,
  getInstalledClaudeAgentSdkPlatformPackages,
  verifyClaudeAgentSdkPlatformPackage,
} = require(
  path.join(
    projectRoot,
    "scripts",
    "prepare",
    "prepare-claude-code-acp-ts.js",
  ),
) as {
  needsDarwinX64CrossArchBundling: (options?: {
    platform?: string;
    hostArch?: string;
    targetArch?: string;
  }) => boolean;
  DARWIN_X64_SDK_PACKAGE: string;
  resolveClaudeAgentSdkPlatformPackageVersion: (
    baseDir: string,
    platformPackage: string,
  ) => string;
  getInstalledClaudeAgentSdkPlatformPackages: (baseDir: string) => string[];
  verifyClaudeAgentSdkPlatformPackage: (
    baseDir: string,
    platformPackage: string,
  ) => void;
};

describe("prepare-claude-code-acp-ts helpers", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("only enables darwin-x64 cross-arch fix for arm64 host building x64", () => {
    expect(
      needsDarwinX64CrossArchBundling({
        platform: "darwin",
        hostArch: "arm64",
        targetArch: "x64",
      }),
    ).toBe(true);

    expect(
      needsDarwinX64CrossArchBundling({
        platform: "darwin",
        hostArch: "arm64",
        targetArch: "arm64",
      }),
    ).toBe(false);

    expect(
      needsDarwinX64CrossArchBundling({
        platform: "win32",
        hostArch: "x64",
        targetArch: "x64",
      }),
    ).toBe(false);

    expect(
      needsDarwinX64CrossArchBundling({
        platform: "linux",
        hostArch: "arm64",
        targetArch: "arm64",
      }),
    ).toBe(false);
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
      verifyClaudeAgentSdkPlatformPackage(baseDir, DARWIN_X64_SDK_PACKAGE),
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
      verifyClaudeAgentSdkPlatformPackage(baseDir, DARWIN_X64_SDK_PACKAGE),
    ).toThrow(/多余平台包/);
  });

  it("reads platform package version from claude-agent-sdk optionalDependencies", () => {
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
      JSON.stringify({
        name: "@anthropic-ai/claude-agent-sdk",
        version: "0.3.191",
        optionalDependencies: {
          [DARWIN_X64_SDK_PACKAGE]: "0.3.191",
        },
      }),
      "utf8",
    );

    expect(
      resolveClaudeAgentSdkPlatformPackageVersion(
        baseDir,
        DARWIN_X64_SDK_PACKAGE,
      ),
    ).toBe("0.3.191");
  });
});
