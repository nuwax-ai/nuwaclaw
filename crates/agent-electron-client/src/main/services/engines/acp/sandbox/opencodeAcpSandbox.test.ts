import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseSemverTriplet,
  compareSemver,
  supportsOpencodeConfigSandbox,
  usesNativeOpencodeSandbox,
  getSandboxedBashMcpScriptPath,
  getSandboxedFsMcpScriptPath,
  resolveSandboxWritableRoots,
  canInjectSandboxedBashMcp,
  canInjectSandboxedFsMcp,
  applyOpencodeSandboxToOpenCodeConfig,
  isOpencodeNativeSandboxBlockedVersion,
  OPENCODE_NATIVE_SANDBOX_CONFIG_MIN_VERSION,
} from "./opencodeAcpSandbox";
import type { SandboxProcessConfig } from "@shared/types/sandbox";

const alwaysExists = () => true;
const neverExists = () => false;
const existsExceptBash = (p: string) => !p.includes("sandboxed-bash-mcp");

function makeSandboxConfig(
  overrides: Partial<SandboxProcessConfig> = {},
): SandboxProcessConfig {
  return {
    enabled: true,
    type: "windows-sandbox",
    mode: "compat",
    projectWorkspaceDir: "/workspace/project",
    windowsSandboxHelperPath: "C:\\helper\\nuwax-sandbox-helper.exe",
    windowsSandboxMode: "workspace-write",
    networkEnabled: true,
    fallback: "startup-only",
    ...overrides,
  };
}

describe("opencodeAcpSandbox", () => {
  // ── parseSemverTriplet ──────────────────────────────────────────────
  describe("parseSemverTriplet", () => {
    it("parses valid semver", () => {
      expect(parseSemverTriplet("1.2.3")).toEqual([1, 2, 3]);
    });

    it("strips leading/trailing whitespace", () => {
      expect(parseSemverTriplet("  2.0.1  ")).toEqual([2, 0, 1]);
    });

    it("ignores pre-release suffix", () => {
      expect(parseSemverTriplet("1.2.3-beta.4")).toEqual([1, 2, 3]);
    });

    it("returns null for invalid input", () => {
      expect(parseSemverTriplet("abc")).toBeNull();
      expect(parseSemverTriplet("")).toBeNull();
      expect(parseSemverTriplet("1.2")).toBeNull();
    });
  });

  // ── compareSemver ───────────────────────────────────────────────────
  describe("compareSemver", () => {
    it("orders versions correctly", () => {
      expect(compareSemver("1.1.99", "1.2.0")).toBeLessThan(0);
      expect(compareSemver("1.2.0", "1.1.99")).toBeGreaterThan(0);
      expect(compareSemver("1.2.0", "1.2.0")).toBe(0);
    });

    it("returns -1 for unparseable versions (treats unknown as lower)", () => {
      expect(compareSemver("bad", "1.0.0")).toBeLessThan(0);
      expect(compareSemver("1.0.0", "bad")).toBeLessThan(0);
    });
  });

  // ── supportsOpencodeConfigSandbox / usesNativeOpencodeSandbox ───────
  describe("supportsOpencodeConfigSandbox", () => {
    it("returns false below min version", () => {
      expect(supportsOpencodeConfigSandbox("1.1.99")).toBe(false);
    });

    it("returns true at min version", () => {
      expect(
        supportsOpencodeConfigSandbox(
          OPENCODE_NATIVE_SANDBOX_CONFIG_MIN_VERSION,
        ),
      ).toBe(true);
    });

    it("returns true above min version", () => {
      expect(supportsOpencodeConfigSandbox("2.0.0")).toBe(true);
    });

    it("returns false for 1.3.0-beta line (schema rejects sandbox key)", () => {
      expect(isOpencodeNativeSandboxBlockedVersion("1.3.0-beta.8")).toBe(true);
      expect(supportsOpencodeConfigSandbox("1.3.0-beta.8")).toBe(false);
      expect(usesNativeOpencodeSandbox("1.3.0-beta.8")).toBe(false);
    });

    it("returns false for null/empty/whitespace", () => {
      expect(supportsOpencodeConfigSandbox(null)).toBe(false);
      expect(supportsOpencodeConfigSandbox(undefined)).toBe(false);
      expect(supportsOpencodeConfigSandbox("  ")).toBe(false);
    });

    it("usesNativeOpencodeSandbox delegates to supportsOpencodeConfigSandbox", () => {
      expect(usesNativeOpencodeSandbox("1.2.0")).toBe(true);
      expect(usesNativeOpencodeSandbox("1.1.0")).toBe(false);
    });
  });

  // ── resolveSandboxWritableRoots ─────────────────────────────────────
  describe("resolveSandboxWritableRoots", () => {
    it("strict: only session cwd", () => {
      const roots = resolveSandboxWritableRoots({
        mode: "strict",
        sessionCwd: "/project/user/session-1",
        projectWorkspaceDir: "/project",
      });
      expect(roots).toEqual(["/project/user/session-1"]);
    });

    it("compat: includes session cwd and project workspace", () => {
      const roots = resolveSandboxWritableRoots({
        mode: "compat",
        sessionCwd: "/project/user/session-1",
        projectWorkspaceDir: "/project",
      });
      expect(roots).toHaveLength(2);
      expect(roots.some((r) => r.endsWith("session-1"))).toBe(true);
      expect(roots.some((r) => r.endsWith("project"))).toBe(true);
    });

    it("compat: deduplicates when session cwd equals project workspace", () => {
      const roots = resolveSandboxWritableRoots({
        mode: "compat",
        sessionCwd: "/project",
        projectWorkspaceDir: "/project",
      });
      expect(roots).toEqual(["/project"]);
    });

    it("permissive: same as compat — includes both roots", () => {
      const roots = resolveSandboxWritableRoots({
        mode: "permissive",
        sessionCwd: "/session",
        projectWorkspaceDir: "/project",
      });
      expect(roots).toHaveLength(2);
    });
  });

  // ── sandboxed MCP script paths ──────────────────────────────────────
  describe("getSandboxedMcpScriptPath", () => {
    it("prefers dist bundle when present", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nuwaclaw-mcp-"));
      const bashDir = path.join(tmp, "sandboxed-bash-mcp");
      const fsDir = path.join(tmp, "sandboxed-fs-mcp");
      fs.mkdirSync(path.join(bashDir, "dist"), { recursive: true });
      fs.mkdirSync(path.join(fsDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(bashDir, "sandboxed-bash-mcp.mjs"), "// src");
      fs.writeFileSync(
        path.join(bashDir, "dist", "sandboxed-bash-mcp.bundle.mjs"),
        "// bundle",
      );
      fs.writeFileSync(path.join(fsDir, "sandboxed-fs-mcp.mjs"), "// src");
      fs.writeFileSync(
        path.join(fsDir, "dist", "sandboxed-fs-mcp.bundle.mjs"),
        "// bundle",
      );

      expect(getSandboxedBashMcpScriptPath(tmp)).toBe(
        path.join(bashDir, "dist", "sandboxed-bash-mcp.bundle.mjs"),
      );
      expect(getSandboxedFsMcpScriptPath(tmp)).toBe(
        path.join(fsDir, "dist", "sandboxed-fs-mcp.bundle.mjs"),
      );

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("falls back to plain .mjs when no bundle exists", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nuwaclaw-mcp-"));
      const bashDir = path.join(tmp, "sandboxed-bash-mcp");
      fs.mkdirSync(bashDir, { recursive: true });
      fs.writeFileSync(path.join(bashDir, "sandboxed-bash-mcp.mjs"), "// src");

      expect(getSandboxedBashMcpScriptPath(tmp)).toBe(
        path.join(bashDir, "sandboxed-bash-mcp.mjs"),
      );

      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  // ── canInjectSandboxedBashMcp / canInjectSandboxedFsMcp ─────────────
  describe("canInjectSandboxed*", () => {
    it("canInjectSandboxedBashMcp: requires windows-sandbox + helper + script", () => {
      const cfg = makeSandboxConfig();
      expect(canInjectSandboxedBashMcp(cfg, "/res", alwaysExists)).toBe(true);
      expect(canInjectSandboxedBashMcp(cfg, "/res", neverExists)).toBe(false);
    });

    it("canInjectSandboxedBashMcp: returns false when disabled", () => {
      const cfg = makeSandboxConfig({ enabled: false });
      expect(canInjectSandboxedBashMcp(cfg, "/res", alwaysExists)).toBe(false);
    });

    it("canInjectSandboxedBashMcp: returns false without helper path", () => {
      const cfg = makeSandboxConfig({ windowsSandboxHelperPath: undefined });
      expect(canInjectSandboxedBashMcp(cfg, "/res", alwaysExists)).toBe(false);
    });

    it("canInjectSandboxedFsMcp: returns false in permissive mode", () => {
      const cfg = makeSandboxConfig({ mode: "permissive" });
      expect(canInjectSandboxedFsMcp(cfg, "/res", alwaysExists)).toBe(false);
    });

    it("canInjectSandboxedFsMcp: returns true when enabled and script exists", () => {
      const cfg = makeSandboxConfig({ mode: "compat" });
      expect(canInjectSandboxedFsMcp(cfg, "/res", alwaysExists)).toBe(true);
    });
  });

  // ── applyOpencodeSandboxToOpenCodeConfig ─────────────────────────────
  describe("applyOpencodeSandboxToOpenCodeConfig", () => {
    it("1.2.0 strict native: injects sandbox config, denies bash/edit", () => {
      const configObj: Record<string, unknown> = {
        permission: { bash: "allow", edit: "allow" },
      };

      const result = applyOpencodeSandboxToOpenCodeConfig({
        configObj,
        sandboxConfig: makeSandboxConfig({ mode: "strict" }),
        resourcesPath: "/mock/resources",
        workspaceDir: "/workspace",
        engineVersion: "1.2.0",
        fileExists: alwaysExists,
      });

      expect(result.usesNativeSandbox).toBe(true);
      expect(result.opencodeSandboxConfigInjected).toBe(true);
      expect(result.builtinBashDenied).toBe(true);
      expect(result.builtinEditDenied).toBe(true);

      const sandbox = configObj.sandbox as Record<string, unknown>;
      expect(sandbox.sandbox_mode).toBe("strict");
      expect(sandbox.writable_roots).toEqual([]);
      expect(sandbox.helper_path).toContain("nuwax-sandbox-helper");

      const perm = configObj.permission as Record<string, string>;
      expect(perm.bash).toBe("deny");
      expect(perm.edit).toBe("deny");
      expect(perm.external_directory).toBe("deny");

      const tools = configObj.tools as Record<string, boolean>;
      expect(tools.bash).toBe(false);
      expect(tools.write).toBe(false);
      expect(tools.edit).toBe(false);
      expect(tools.apply_patch).toBe(false);
    });

    it("1.2.0 strict on macOS: keeps built-in bash when no sandboxed-bash replacement", () => {
      const configObj: Record<string, unknown> = {
        permission: { bash: "allow", edit: "allow" },
      };

      const result = applyOpencodeSandboxToOpenCodeConfig({
        configObj,
        sandboxConfig: makeSandboxConfig({
          type: "macos-seatbelt",
          mode: "strict",
          windowsSandboxHelperPath: undefined,
        }),
        resourcesPath: "/mock/resources",
        workspaceDir: "/workspace",
        engineVersion: "1.2.0",
        fileExists: alwaysExists,
      });

      expect(result.usesNativeSandbox).toBe(true);
      expect(result.builtinBashDenied).toBe(false);
      expect(result.builtinEditDenied).toBe(true);
      expect((configObj.permission as Record<string, string>).bash).toBe(
        "allow",
      );

      const tools = configObj.tools as Record<string, boolean>;
      expect(tools.bash).toBeUndefined();
      expect(tools.write).toBe(false);
    });

    it("1.1.x legacy: no sandbox key, denies bash/edit via MCP scripts", () => {
      const configObj: Record<string, unknown> = {
        permission: { edit: "allow", bash: "allow", question: "deny" },
      };

      const result = applyOpencodeSandboxToOpenCodeConfig({
        configObj,
        sandboxConfig: makeSandboxConfig({ mode: "compat" }),
        resourcesPath: "/mock/resources",
        workspaceDir: "/workspace",
        engineVersion: "1.1.99",
        fileExists: alwaysExists,
      });

      expect(result.opencodeSandboxConfigInjected).toBe(false);
      expect(configObj).not.toHaveProperty("sandbox");
      expect(result.builtinBashDenied).toBe(true);
      expect(result.builtinEditDenied).toBe(true);

      const perm = configObj.permission as Record<string, string>;
      expect(perm.bash).toBe("deny");
      expect(perm.edit).toBe("deny");
      expect(perm.question).toBe("deny");

      const tools = configObj.tools as Record<string, boolean>;
      expect(tools.write).toBe(false);
      expect(tools.bash).toBe(false);
    });

    it("legacy: skips bash deny when sandboxed-bash script missing", () => {
      const configObj: Record<string, unknown> = {
        permission: { bash: "allow", edit: "allow" },
      };

      const result = applyOpencodeSandboxToOpenCodeConfig({
        configObj,
        sandboxConfig: makeSandboxConfig({ mode: "compat" }),
        resourcesPath: "/mock/resources",
        workspaceDir: "/workspace",
        engineVersion: "1.1.99",
        fileExists: existsExceptBash,
      });

      expect(result.builtinBashDenied).toBe(false);
      expect((configObj.permission as Record<string, string>).bash).toBe(
        "allow",
      );
      expect(result.builtinEditDenied).toBe(true);
    });

    it("1.2.0 compat native: writable_roots include session cwd and project dir", () => {
      const configObj: Record<string, unknown> = {};

      applyOpencodeSandboxToOpenCodeConfig({
        configObj,
        sandboxConfig: makeSandboxConfig({ mode: "compat" }),
        resourcesPath: "/mock/resources",
        workspaceDir: "/workspace",
        engineVersion: "1.2.0",
        sessionCwd: "/workspace/session-1",
        fileExists: neverExists,
      });

      const sandbox = configObj.sandbox as Record<string, unknown>;
      const roots = sandbox.writable_roots as string[];
      expect(roots.some((r) => r.endsWith("session-1"))).toBe(true);
      expect(roots.some((r) => r.endsWith("project"))).toBe(true);
    });
  });
});
