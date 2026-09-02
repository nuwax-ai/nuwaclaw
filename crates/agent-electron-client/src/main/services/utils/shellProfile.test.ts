import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  windowsPathToPosix,
  generatePathExport,
  generatePathSanitizeScript,
  buildShellProfileContent,
  buildBundledDevShellProfileContent,
  collectBundledDevPathEntries,
  writeShellProfiles,
  writeBundledDevShellProfiles,
} from "./shellProfile";
import { isWindows } from "../system/shellEnv";

describe("shellProfile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shellProfile-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("windowsPathToPosix", () => {
    it("should convert Windows paths to POSIX format on Windows", () => {
      expect(windowsPathToPosix("C:\\foo\\bar")).toBe("/c/foo/bar");
      expect(windowsPathToPosix("D:\\Program Files\\Tool")).toBe(
        "/d/Program Files/Tool",
      );
      expect(windowsPathToPosix("E:\\tools\\ripgrep\\bin")).toBe(
        "/e/tools/ripgrep/bin",
      );
    });

    it("should handle lowercase drive letters", () => {
      expect(windowsPathToPosix("c:\\foo")).toBe("/c/foo");
      expect(windowsPathToPosix("d:\\tools")).toBe("/d/tools");
    });

    it("should return POSIX paths unchanged", () => {
      expect(windowsPathToPosix("/usr/local/bin")).toBe("/usr/local/bin");
      expect(windowsPathToPosix("/home/user/tools")).toBe("/home/user/tools");
    });
  });

  describe("generatePathExport", () => {
    it("should generate a shell export line", () => {
      const result = generatePathExport("/c/tools/bin");
      expect(result).toBe('export PATH="/c/tools/bin:$PATH"\n');
    });

    it("should handle paths with spaces", () => {
      const result = generatePathExport("/c/Program Files/Tool");
      expect(result).toBe('export PATH="/c/Program Files/Tool:$PATH"\n');
    });
  });

  describe("generatePathSanitizeScript", () => {
    it("should include NuwaClaw PATH sanitize marker", () => {
      const script = generatePathSanitizeScript();
      expect(script).toContain("[NuwaClaw]");
      expect(script).toContain("Creating*");
      expect(script).toContain("_nuwaclaw_clean_path");
    });
  });

  describe("buildShellProfileContent", () => {
    it("should prepend bundled ripgrep bin so Bash tool can resolve rg", () => {
      const content = buildShellProfileContent([
        "/c/Program Files/NuwaClaw/resources/ripgrep/bin",
      ]);
      expect(content).toContain(
        'export PATH="/c/Program Files/NuwaClaw/resources/ripgrep/bin:$PATH"',
      );
      expect(content).toContain("ripgrep/bin");
    });

    it("should include sanitize script on Windows only", () => {
      const content = buildShellProfileContent(["/c/tools/bin"]);
      if (isWindows()) {
        expect(content).toContain("[NuwaClaw] Sanitize PATH");
      } else {
        expect(content).not.toContain("[NuwaClaw] Sanitize PATH");
        expect(content).toBe('export PATH="/c/tools/bin:$PATH"\n');
      }
    });
  });

  describe("writeShellProfiles", () => {
    it("should write .bash_profile and .bashrc files", () => {
      writeShellProfiles(tempDir, ["/c/tools/bin"]);

      const expected = buildShellProfileContent(["/c/tools/bin"]);
      const bashProfile = fs.readFileSync(
        path.join(tempDir, ".bash_profile"),
        "utf-8",
      );
      const bashrc = fs.readFileSync(path.join(tempDir, ".bashrc"), "utf-8");

      expect(bashProfile).toBe(expected);
      expect(bashrc).toBe(expected);
    });

    it("should handle multiple path entries", () => {
      writeShellProfiles(tempDir, ["/c/tools/bin", "/c/node/bin"]);

      const bashProfile = fs.readFileSync(
        path.join(tempDir, ".bash_profile"),
        "utf-8",
      );

      expect(bashProfile).toBe(
        buildShellProfileContent(["/c/tools/bin", "/c/node/bin"]),
      );
    });

    it("should convert Windows paths to POSIX format", () => {
      writeShellProfiles(tempDir, ["C:\\tools\\ripgrep\\bin"]);
      const bashProfile = fs.readFileSync(
        path.join(tempDir, ".bash_profile"),
        "utf-8",
      );
      expect(bashProfile).toBe(
        buildShellProfileContent(["C:\\tools\\ripgrep\\bin"]),
      );
      expect(bashProfile).toContain("/c/tools/ripgrep/bin");
    });

    it("should not write files when pathEntries is empty", () => {
      writeShellProfiles(tempDir, []);

      expect(fs.existsSync(path.join(tempDir, ".bash_profile"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, ".bashrc"))).toBe(false);
    });

    it("should not throw when directory does not exist", () => {
      const nonExistentDir = path.join(tempDir, "non-existent");

      // Should not throw, just silently fail
      expect(() => {
        writeShellProfiles(nonExistentDir, ["/c/tools/bin"]);
      }).not.toThrow();
    });
  });

  describe("collectBundledDevPathEntries", () => {
    it("should collect node, pnpm, uv, ripgrep dirs from appEnv", () => {
      const entries = collectBundledDevPathEntries({
        NUWAXCODE_NODE_DIR: "C:\\app\\resources\\node\\bin",
        PNPM_HOME: "C:\\Users\\demo\\.nuwaclaw\\pnpm\\global",
        UV_TOOL_BIN_DIR: "C:\\Users\\demo\\.nuwaclaw\\uv\\tools\\bin",
        CLAUDE_CODE_RIPGREP_DIR: "C:\\app\\resources\\ripgrep\\bin",
        NODE_PATH: "C:\\Users\\demo\\.nuwaclaw\\node_modules",
        PATH: "C:\\app\\resources\\node\\bin;C:\\Program Files\\nodejs",
      });

      expect(entries).toContain("C:\\app\\resources\\node\\bin");
      expect(entries).toContain("C:\\Users\\demo\\.nuwaclaw\\pnpm\\global");
      expect(entries).toContain("C:\\Users\\demo\\.nuwaclaw\\uv\\tools\\bin");
      expect(entries).toContain("C:\\app\\resources\\ripgrep\\bin");
      expect(entries).toContain(
        "C:\\Users\\demo\\.nuwaclaw\\node_modules\\.bin",
      );
      expect(entries).not.toContain("C:\\Program Files\\nodejs");
    });
  });

  describe("buildBundledDevShellProfileContent", () => {
    const sampleAppEnv = {
      NUWAXCODE_NODE_DIR: "C:\\app\\resources\\node\\bin",
      PNPM_HOME: "C:\\Users\\demo\\.nuwaclaw\\pnpm\\global",
      UV_TOOL_BIN_DIR: "C:\\Users\\demo\\.nuwaclaw\\uv\\tools\\bin",
      CLAUDE_CODE_RIPGREP_DIR: "C:\\app\\resources\\ripgrep\\bin",
      NODE_PATH: "C:\\Users\\demo\\.nuwaclaw\\node_modules",
      NPM_CONFIG_REGISTRY: "https://registry.example.com",
      MSYS2_PATH_TYPE: "inherit",
    };

    it("should export NUWACLAW_RUNTIME and PNPM_HOME", () => {
      const content = buildBundledDevShellProfileContent(sampleAppEnv);
      expect(content).toContain("export NUWACLAW_RUNTIME='1'");
      expect(content).toContain(
        "export PNPM_HOME='C:\\Users\\demo\\.nuwaclaw\\pnpm\\global'",
      );
      expect(content).toContain("export UV_TOOL_BIN_DIR=");
    });

    it("should prepend bundled paths before $PATH", () => {
      const content = buildBundledDevShellProfileContent(sampleAppEnv);
      expect(content).toContain("/app/resources/node/bin");
      expect(content).toContain("/app/resources/ripgrep/bin");
      expect(content).toMatch(/export PATH="[^"]+:\$PATH"/);
    });

    it("should place PATH sanitize before bundled exports on Windows", () => {
      const content = buildBundledDevShellProfileContent(sampleAppEnv);
      if (!isWindows()) {
        expect(content).not.toContain("[NuwaClaw] Sanitize PATH");
        return;
      }
      const sanitizeIdx = content.indexOf("[NuwaClaw] Sanitize PATH");
      const exportIdx = content.indexOf("export NUWACLAW_RUNTIME=");
      expect(sanitizeIdx).toBeGreaterThanOrEqual(0);
      expect(exportIdx).toBeGreaterThan(sanitizeIdx);
    });

    it("should collect ttyd bin from PATH segments", () => {
      const entries = collectBundledDevPathEntries({
        PATH: "C:\\app\\resources\\ttyd\\bin;C:\\Windows\\System32",
      });
      expect(entries).toContain("C:\\app\\resources\\ttyd\\bin");
      expect(entries).not.toContain("C:\\Windows\\System32");
    });
  });

  describe("writeBundledDevShellProfiles", () => {
    it("should write bundled profile even without explicit pathEntries arg", () => {
      writeBundledDevShellProfiles(tempDir, {
        NUWAXCODE_NODE_DIR: "C:\\app\\resources\\node\\bin",
        PNPM_HOME: "C:\\Users\\demo\\.nuwaclaw\\pnpm\\global",
        NPM_CONFIG_REGISTRY: "https://registry.example.com",
      });

      const bashProfile = fs.readFileSync(
        path.join(tempDir, ".bash_profile"),
        "utf-8",
      );
      expect(bashProfile).toContain("export NUWACLAW_RUNTIME='1'");
      expect(bashProfile).toContain("export PNPM_HOME=");
    });
  });
});
