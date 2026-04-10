import { describe, it, expect, vi } from "vitest";
import { createSandboxEnforcementStrategy } from "./SandboxEnforcementStrategy";
import type { SandboxEnforcementStrategy } from "./SandboxEnforcementStrategy";
import type { SandboxType, SandboxMode } from "@shared/types/sandbox";

// Mock platform-dependent modules
vi.mock("../system/dependencies", () => ({
  getResourcesPath: () => "/mock/resources",
  getAppEnv: () => ({ PATH: "/mock/bin" }),
  getBundledGitBashPath: () => "/mock/git/bin/bash.exe",
}));

const FACTORY_COMBINATIONS: Array<{
  label: string;
  type: SandboxType;
  mode: SandboxMode;
  engine: "claude-code" | "nuwaxcode";
}> = [
  // #1: disabled
  { label: "disabled", type: "none", mode: "compat", engine: "claude-code" },
  // #2: macOS nuwaxcode strict
  {
    label: "macos-nuwax-strict",
    type: "macos-seatbelt",
    mode: "strict",
    engine: "nuwaxcode",
  },
  // #3: macOS nuwaxcode compat
  {
    label: "macos-nuwax-compat",
    type: "macos-seatbelt",
    mode: "compat",
    engine: "nuwaxcode",
  },
  // #4: macOS claude-code strict
  {
    label: "macos-claude-strict",
    type: "macos-seatbelt",
    mode: "strict",
    engine: "claude-code",
  },
  // #5: macOS claude-code permissive
  {
    label: "macos-claude-permissive",
    type: "macos-seatbelt",
    mode: "permissive",
    engine: "claude-code",
  },
  // #6: Windows nuwaxcode strict
  {
    label: "win-nuwax-strict",
    type: "windows-sandbox",
    mode: "strict",
    engine: "nuwaxcode",
  },
  // #7: Windows nuwaxcode compat
  {
    label: "win-nuwax-compat",
    type: "windows-sandbox",
    mode: "compat",
    engine: "nuwaxcode",
  },
  // #8: Windows nuwaxcode permissive
  {
    label: "win-nuwax-permissive",
    type: "windows-sandbox",
    mode: "permissive",
    engine: "nuwaxcode",
  },
  // #9: Windows claude-code strict
  {
    label: "win-claude-strict",
    type: "windows-sandbox",
    mode: "strict",
    engine: "claude-code",
  },
  // #10: Windows claude-code permissive
  {
    label: "win-claude-permissive",
    type: "windows-sandbox",
    mode: "permissive",
    engine: "claude-code",
  },
];

function createStrategy(
  combo: (typeof FACTORY_COMBINATIONS)[number],
): SandboxEnforcementStrategy {
  // Note: we can't actually change process.platform, so we test the logic
  // through the factory + impl which reads process.platform at construction time.
  // For cross-platform testing, we rely on the strategy's internal isWin field.
  return createSandboxEnforcementStrategy(combo.type, combo.mode, combo.engine);
}

describe("SandboxEnforcementStrategy", () => {
  describe("factory", () => {
    it("creates a strategy for each combination", () => {
      for (const combo of FACTORY_COMBINATIONS) {
        const strategy = createStrategy(combo);
        expect(strategy.sandboxType).toBe(combo.type);
        expect(strategy.sandboxMode).toBe(combo.mode);
        expect(strategy.engineName).toBe(combo.engine);
        expect(strategy.sandboxEnabled).toBe(combo.type !== "none");
      }
    });
  });

  describe("needsProactiveGuard()", () => {
    it("returns true only for Windows nuwaxcode strict", () => {
      // On actual Windows platform
      const isWin = process.platform === "win32";

      for (const combo of FACTORY_COMBINATIONS) {
        const strategy = createStrategy(combo);
        const expected =
          isWin &&
          combo.type === "windows-sandbox" &&
          combo.engine === "nuwaxcode" &&
          combo.mode === "strict";
        expect(
          strategy.needsProactiveGuard(),
          `failed for ${combo.label}`,
        ).toBe(expected);
      }
    });
  });

  describe("buildDisallowedTools()", () => {
    it("returns empty for nuwaxcode", () => {
      for (const combo of FACTORY_COMBINATIONS.filter(
        (c) => c.engine === "nuwaxcode",
      )) {
        const strategy = createStrategy(combo);
        expect(
          strategy.buildDisallowedTools(),
          `failed for ${combo.label}`,
        ).toEqual([]);
      }
    });

    it("returns empty for disabled sandbox", () => {
      const strategy = createStrategy(FACTORY_COMBINATIONS[0]);
      expect(strategy.buildDisallowedTools()).toEqual([]);
    });

    it("includes Write/Edit/NotebookEdit for claude-code strict/compat", () => {
      const isWin = process.platform === "win32";
      for (const combo of FACTORY_COMBINATIONS.filter(
        (c) =>
          c.engine === "claude-code" &&
          c.mode !== "permissive" &&
          c.type !== "none",
      )) {
        const strategy = createStrategy(combo);
        const tools = strategy.buildDisallowedTools();
        expect(tools, `failed for ${combo.label}`).toContain("Write");
        expect(tools, `failed for ${combo.label}`).toContain("Edit");
        expect(tools, `failed for ${combo.label}`).toContain("NotebookEdit");

        // Bash only on Windows
        if (isWin && combo.type === "windows-sandbox") {
          expect(tools, `failed for ${combo.label}`).toContain("Bash");
        } else {
          expect(tools, `failed for ${combo.label}`).not.toContain("Bash");
        }
      }
    });

    it("does not include Write/Edit for permissive claude-code", () => {
      const combo = FACTORY_COMBINATIONS.find(
        (c) => c.label === "macos-claude-permissive",
      )!;
      const strategy = createStrategy(combo);
      const tools = strategy.buildDisallowedTools();
      expect(tools).not.toContain("Write");
      expect(tools).not.toContain("Edit");
    });
  });

  describe("buildEngineConfigOverrides()", () => {
    it("returns null for claude-code", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "strict",
        "claude-code",
      );
      const result = strategy.buildEngineConfigOverrides(
        { permission: {} },
        { projectWorkspaceDir: "/ws", workspaceDir: "/ws" },
      );
      expect(result).toBeNull();
    });

    it("returns null for disabled sandbox", () => {
      const strategy = createSandboxEnforcementStrategy(
        "none",
        "compat",
        "nuwaxcode",
      );
      const result = strategy.buildEngineConfigOverrides(
        { permission: {} },
        { projectWorkspaceDir: "/ws", workspaceDir: "/ws" },
      );
      expect(result).toBeNull();
    });

    it("injects sandbox config for nuwaxcode", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "strict",
        "nuwaxcode",
      );
      const config: Record<string, unknown> = {
        permission: { edit: "allow" },
      };
      const result = strategy.buildEngineConfigOverrides(config, {
        windowsSandboxHelperPath: "/helper.exe",
        projectWorkspaceDir: "/ws",
        workspaceDir: "/ws",
      });
      expect(result).not.toBeNull();
      expect((result!.sandbox as Record<string, unknown>).sandbox_mode).toBe(
        "strict",
      );
      expect((result!.sandbox as Record<string, unknown>).helper_path).toBe(
        "/helper.exe",
      );
      expect(
        (result!.sandbox as Record<string, unknown>).writable_roots,
      ).toEqual(["/ws"]);
    });

    it("sets external_directory=deny in strict mode", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "strict",
        "nuwaxcode",
      );
      const config: Record<string, unknown> = { permission: { edit: "allow" } };
      strategy.buildEngineConfigOverrides(config, {
        projectWorkspaceDir: "/ws",
        workspaceDir: "/ws",
      });
      expect(
        (config.permission as Record<string, string>).external_directory,
      ).toBe("deny");
    });

    it("does not set external_directory in compat mode", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "compat",
        "nuwaxcode",
      );
      const config: Record<string, unknown> = { permission: { edit: "allow" } };
      strategy.buildEngineConfigOverrides(config, {
        projectWorkspaceDir: "/ws",
        workspaceDir: "/ws",
      });
      expect(
        (config.permission as Record<string, string>).external_directory,
      ).toBeUndefined();
    });
  });

  describe("buildStrictPermissionContext()", () => {
    it("sets strictEnabled=true only in strict mode with sandbox enabled", () => {
      const strict = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "strict",
        "nuwaxcode",
      );
      expect(strict.buildStrictPermissionContext({}).strictEnabled).toBe(true);

      const compat = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "compat",
        "nuwaxcode",
      );
      expect(compat.buildStrictPermissionContext({}).strictEnabled).toBe(false);

      const disabled = createSandboxEnforcementStrategy(
        "none",
        "strict",
        "nuwaxcode",
      );
      expect(disabled.buildStrictPermissionContext({}).strictEnabled).toBe(
        false,
      );
    });

    it("passes sandboxMode through", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "strict",
        "nuwaxcode",
      );
      expect(strategy.buildStrictPermissionContext({}).sandboxMode).toBe(
        "strict",
      );
    });

    it("constructs tempDirs without undefined entries", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "compat",
        "nuwaxcode",
      );
      const ctx = strategy.buildStrictPermissionContext({});
      for (const dir of ctx.tempDirs) {
        expect(dir).toBeDefined();
        expect(typeof dir).toBe("string");
      }
    });

    it("includes workspaceDir and projectWorkspaceDir", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "compat",
        "nuwaxcode",
      );
      const ctx = strategy.buildStrictPermissionContext({
        workspaceDir: "/workspace",
        projectWorkspaceDir: "/project",
        isolatedHome: "/isolated",
      });
      expect(ctx.workspaceDir).toBe("/workspace");
      expect(ctx.projectWorkspaceDir).toBe("/project");
      expect(ctx.isolatedHome).toBe("/isolated");
    });
  });

  describe("createTerminalManagerOptions()", () => {
    it("returns empty on non-Windows sandbox types", () => {
      const strategy = createSandboxEnforcementStrategy(
        "macos-seatbelt",
        "strict",
        "claude-code",
      );
      const opts = strategy.createTerminalManagerOptions({
        projectWorkspaceDir: "/ws",
        networkEnabled: true,
      });
      expect(opts.windowsSandboxHelperPath).toBeUndefined();
    });

    it("returns sandboxed options on Windows with helper path", () => {
      // Only tests fully on Windows; on other platforms the isWin check fails.
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "strict",
        "claude-code",
      );
      const opts = strategy.createTerminalManagerOptions({
        windowsSandboxHelperPath: "/helper.exe",
        windowsSandboxMode: "workspace-write",
        projectWorkspaceDir: "/ws",
        networkEnabled: true,
      });
      if (process.platform === "win32") {
        expect(opts.windowsSandboxHelperPath).toBe("/helper.exe");
        expect(opts.mode).toBe("strict");
      } else {
        // On non-Windows, returns empty
        expect(opts.windowsSandboxHelperPath).toBeUndefined();
      }
    });
  });

  describe("buildInjectedMcpServers()", () => {
    it("returns empty for nuwaxcode", () => {
      const strategy = createSandboxEnforcementStrategy(
        "windows-sandbox",
        "strict",
        "nuwaxcode",
      );
      const servers = strategy.buildInjectedMcpServers({
        projectWorkspaceDir: "/ws",
        networkEnabled: true,
      });
      expect(servers).toEqual([]);
    });

    it("returns empty for disabled sandbox", () => {
      const strategy = createSandboxEnforcementStrategy(
        "none",
        "compat",
        "claude-code",
      );
      const servers = strategy.buildInjectedMcpServers({
        projectWorkspaceDir: "/ws",
        networkEnabled: true,
      });
      expect(servers).toEqual([]);
    });

    it("includes sandboxed-fs for claude-code strict/compat", () => {
      const strategy = createSandboxEnforcementStrategy(
        "macos-seatbelt",
        "strict",
        "claude-code",
      );
      const servers = strategy.buildInjectedMcpServers({
        projectWorkspaceDir: "/ws",
        networkEnabled: true,
      });
      expect(servers.some((s) => s.name === "sandboxed-fs")).toBe(true);
    });

    it("does not include sandboxed-fs for permissive", () => {
      const strategy = createSandboxEnforcementStrategy(
        "macos-seatbelt",
        "permissive",
        "claude-code",
      );
      const servers = strategy.buildInjectedMcpServers({
        projectWorkspaceDir: "/ws",
        networkEnabled: true,
      });
      expect(servers.some((s) => s.name === "sandboxed-fs")).toBe(false);
    });
  });
});
