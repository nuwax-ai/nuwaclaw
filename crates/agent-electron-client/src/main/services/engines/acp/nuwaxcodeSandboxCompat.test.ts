import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  applyNuwaxcodeSandboxToOpenCodeConfig,
  compareSemver,
  supportsOpencodeConfigSandbox,
  NUWAXCODE_OPENCODE_SANDBOX_CONFIG_MIN_VERSION,
  getSandboxedBashMcpScriptPath,
  getSandboxedFsMcpScriptPath,
  resolveSandboxWritableRoots,
} from "./nuwaxcodeSandboxCompat";

const alwaysExists = () => true;

const existsExceptBash = (p: string) => !p.includes("sandboxed-bash-mcp");

describe("nuwaxcodeSandboxCompat", () => {
  it("compareSemver orders versions", () => {
    expect(compareSemver("1.1.99", "1.2.0")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.1.99")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0", "1.2.0")).toBe(0);
  });

  it("supportsOpencodeConfigSandbox enabled for 1.2.0+", () => {
    expect(supportsOpencodeConfigSandbox("1.1.99")).toBe(false);
    expect(supportsOpencodeConfigSandbox("1.2.0")).toBe(true);
    expect(
      supportsOpencodeConfigSandbox(
        NUWAXCODE_OPENCODE_SANDBOX_CONFIG_MIN_VERSION,
      ),
    ).toBe(true);
  });

  it("1.1.x: no sandbox key, denies built-in bash/edit when MCP scripts exist", () => {
    const configObj: Record<string, unknown> = {
      permission: {
        edit: "allow",
        bash: "allow",
        question: "deny",
      },
    };

    const result = applyNuwaxcodeSandboxToOpenCodeConfig({
      configObj,
      nuwaxcodeVersion: "1.1.99",
      resourcesPath: "/mock/resources",
      workspaceDir: "/workspace",
      fileExists: alwaysExists,
      sandboxConfig: {
        enabled: true,
        type: "windows-sandbox",
        mode: "compat",
        projectWorkspaceDir: "/workspace/project",
        windowsSandboxHelperPath: "C:\\helper\\nuwax-sandbox-helper.exe",
        windowsSandboxMode: "workspace-write",
        networkEnabled: true,
        fallback: "startup-only",
      },
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
    expect(tools.edit).toBe(false);
    expect(tools.apply_patch).toBe(false);
    expect(tools.bash).toBe(false);
  });

  it("1.2.0: injects sandbox config, keeps built-in tools (no MCP deny)", () => {
    const configObj: Record<string, unknown> = {
      permission: { bash: "allow", edit: "allow" },
    };

    const result = applyNuwaxcodeSandboxToOpenCodeConfig({
      configObj,
      nuwaxcodeVersion: "1.2.0",
      resourcesPath: "/mock/resources",
      workspaceDir: "/workspace",
      fileExists: alwaysExists,
      sandboxConfig: {
        enabled: true,
        type: "windows-sandbox",
        mode: "strict",
        projectWorkspaceDir: "/workspace/project",
        windowsSandboxHelperPath: "C:\\helper\\nuwax-sandbox-helper.exe",
        windowsSandboxMode: "workspace-write",
        networkEnabled: true,
        fallback: "startup-only",
      },
    });

    expect(result.usesNativeSandbox).toBe(true);
    expect(result.opencodeSandboxConfigInjected).toBe(true);
    expect(result.builtinBashDenied).toBe(true);
    expect(result.builtinEditDenied).toBe(false);
    const sandbox = configObj.sandbox as Record<string, unknown>;
    expect(sandbox.sandbox_mode).toBe("strict");
    expect(sandbox.helper_path).toContain("nuwax-sandbox-helper");
    expect(sandbox).not.toHaveProperty("writable_roots");
    const perm = configObj.permission as Record<string, string>;
    expect(perm.bash).toBe("deny");
    expect(perm.external_directory).toBe("deny");
    const tools = configObj.tools as Record<string, boolean>;
    expect(tools.bash).toBe(false);
    expect(tools.write).toBeUndefined();
    expect(tools.edit).toBeUndefined();
  });

  it("skips bash deny when helper script missing", () => {
    const configObj: Record<string, unknown> = {
      permission: { bash: "allow", edit: "allow" },
    };

    const result = applyNuwaxcodeSandboxToOpenCodeConfig({
      configObj,
      nuwaxcodeVersion: "1.1.99",
      resourcesPath: "/mock/resources",
      workspaceDir: "/workspace",
      fileExists: existsExceptBash,
      sandboxConfig: {
        enabled: true,
        type: "windows-sandbox",
        mode: "compat",
        projectWorkspaceDir: "/workspace",
        windowsSandboxHelperPath: "C:\\helper.exe",
        networkEnabled: true,
        fallback: "startup-only",
      },
    });

    expect(result.builtinBashDenied).toBe(false);
    expect((configObj.permission as Record<string, string>).bash).toBe("allow");
    expect(result.builtinEditDenied).toBe(true);
    expect(
      existsExceptBash(getSandboxedBashMcpScriptPath("/mock/resources")),
    ).toBe(false);
    expect(alwaysExists(getSandboxedFsMcpScriptPath("/mock/resources"))).toBe(
      true,
    );
  });

  it("resolveSandboxWritableRoots: strict 仅会话目录", () => {
    const roots = resolveSandboxWritableRoots({
      mode: "strict",
      sessionCwd: "C:\\project\\user\\session-1",
      projectWorkspaceDir: "C:\\project",
    });
    expect(roots).toEqual(["C:\\project\\user\\session-1"]);
  });

  it("resolveSandboxWritableRoots: compat 含项目根与会话目录", () => {
    const roots = resolveSandboxWritableRoots({
      mode: "compat",
      sessionCwd: "/project/user/session-1",
      projectWorkspaceDir: "/project",
    });
    expect(roots).toHaveLength(2);
    expect(roots.some((r) => r.endsWith("session-1"))).toBe(true);
    expect(roots.some((r) => r.endsWith("project"))).toBe(true);
  });

  it("getSandboxedMcpScriptPath prefers dist bundle when present", () => {
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
});
