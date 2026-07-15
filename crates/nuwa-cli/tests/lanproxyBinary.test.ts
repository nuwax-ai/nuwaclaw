import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveLanproxyBinary } from "../src/core/serve/lanproxyBinary.js";

let tmpDir: string;

describe("resolveLanproxyBinary", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-lanproxy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when the path doesn't exist", () => {
    expect(() => resolveLanproxyBinary(path.join(tmpDir, "nope"))).toThrow(
      /不存在/,
    );
  });

  it("returns the path directly when it's already a file", () => {
    const file = path.join(tmpDir, "my-lanproxy-binary");
    fs.writeFileSync(file, "");
    expect(resolveLanproxyBinary(file)).toBe(file);
  });

  it("finds the platform binary directly inside a directory", () => {
    const platformKey = `${process.platform}-${process.arch}`;
    if (
      ![
        "darwin-arm64",
        "darwin-x64",
        "win32-x64",
        "linux-x64",
        "linux-arm64",
      ].includes(platformKey)
    ) {
      return; // unsupported platform for this test's assumptions — skip
    }
    const targetMap: Record<string, string> = {
      "darwin-arm64": "aarch64-apple-darwin",
      "darwin-x64": "x86_64-apple-darwin",
      "win32-x64": "x86_64-pc-windows-msvc",
      "linux-x64": "x86_64-unknown-linux-gnu",
      "linux-arm64": "aarch64-unknown-linux-gnu",
    };
    const ext = process.platform === "win32" ? ".exe" : "";
    const binaryName = `nuwax-lanproxy-${targetMap[platformKey]}${ext}`;
    fs.writeFileSync(path.join(tmpDir, binaryName), "");
    expect(resolveLanproxyBinary(tmpDir)).toBe(path.join(tmpDir, binaryName));
  });

  it("finds the platform binary inside a binaries/ subdirectory (Electron client's resources layout)", () => {
    const platformKey = `${process.platform}-${process.arch}`;
    if (platformKey !== "darwin-arm64") return; // keep this test focused on the dev machine's actual platform
    fs.mkdirSync(path.join(tmpDir, "binaries"));
    fs.writeFileSync(
      path.join(tmpDir, "binaries", "nuwax-lanproxy-aarch64-apple-darwin"),
      "",
    );
    expect(resolveLanproxyBinary(tmpDir)).toBe(
      path.join(tmpDir, "binaries", "nuwax-lanproxy-aarch64-apple-darwin"),
    );
  });

  it("falls back to the universal darwin binary when the arm64-specific one is absent", () => {
    if (process.platform !== "darwin" || process.arch !== "arm64") return;
    fs.writeFileSync(
      path.join(tmpDir, "nuwax-lanproxy-universal-apple-darwin"),
      "",
    );
    expect(resolveLanproxyBinary(tmpDir)).toBe(
      path.join(tmpDir, "nuwax-lanproxy-universal-apple-darwin"),
    );
  });

  it("throws a clear error when the directory has no matching binary", () => {
    fs.mkdirSync(path.join(tmpDir, "empty"));
    expect(() => resolveLanproxyBinary(path.join(tmpDir, "empty"))).toThrow(
      /nuwa-cli\/resources\/lanproxy/,
    );
  });
});
