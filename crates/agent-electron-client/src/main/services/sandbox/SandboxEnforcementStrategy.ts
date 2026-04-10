/**
 * SandboxEnforcementStrategy — unified abstraction for per-platform/per-engine sandbox behavior.
 *
 * Encapsulates all (platform × engine × mode) conditional variance so that acpEngine.ts
 * calls strategy methods instead of inline `isWindows()`, `engineName === "nuwaxcode"`,
 * and `sandboxMode === "strict"` checks.
 *
 * Created once per AcpEngine.init() via `createSandboxEnforcementStrategy()`.
 */

import * as os from "os";
import * as path from "path";
import type { AcpMcpServer } from "../engines/acp/acpClient";
import type { AcpTerminalManagerOptions } from "../engines/acp/acpTerminalManager";
import type { StrictPermissionContext } from "../engines/acp/strictPermissionGuard";
import {
  getResourcesPath,
  getAppEnv,
  getBundledGitBashPath,
} from "../system/dependencies";
import type {
  SandboxMode,
  SandboxType,
  WindowsSandboxMode,
} from "@shared/types/sandbox";
import { APP_DATA_DIR_NAME } from "../constants";

// === Interface ===

export interface SandboxEnforcementStrategy {
  readonly sandboxType: SandboxType;
  readonly sandboxMode: SandboxMode;
  readonly engineName: "claude-code" | "nuwaxcode";
  readonly sandboxEnabled: boolean;

  /**
   * Whether tool_call_update events should be intercepted for proactive strict
   * write checking. True only for Windows + nuwaxcode + strict mode.
   */
  needsProactiveGuard(): boolean;

  /**
   * Return tool names to include in _meta.claudeCode.options.disallowedTools.
   * Empty for nuwaxcode (does not read _meta).
   */
  buildDisallowedTools(): string[];

  /**
   * Mutate the OPENCODE_CONFIG_CONTENT JSON object in-place with sandbox-related
   * fields. Returns the mutated object, or null if no injection needed.
   */
  buildEngineConfigOverrides(
    configObj: Record<string, unknown>,
    params: EngineConfigParams,
  ): Record<string, unknown> | null;

  /**
   * Return additional MCP servers to inject into the ACP session.
   * (sandboxed-bash for Windows claude-code, sandboxed-fs for strict/compat claude-code)
   */
  buildInjectedMcpServers(params: SandboxStrategyParams): AcpMcpServer[];

  /**
   * Return constructor options for AcpTerminalManager.
   */
  createTerminalManagerOptions(
    params: SandboxStrategyParams,
  ): AcpTerminalManagerOptions;

  /**
   * Build StrictPermissionContext for evaluateStrictWritePermission().
   * Centralizes workspaceDir, projectWorkspaceDir, isolatedHome, appDataDir, tempDirs.
   */
  buildStrictPermissionContext(
    params: StrictContextParams,
  ): StrictPermissionContext;
}

// === Parameter Types ===

export interface EngineConfigParams {
  windowsSandboxHelperPath?: string;
  windowsSandboxMode?: WindowsSandboxMode;
  projectWorkspaceDir: string;
  workspaceDir: string;
}

/** Shared params for MCP injection and Terminal Manager construction. */
export interface SandboxStrategyParams {
  windowsSandboxHelperPath?: string;
  windowsSandboxMode?: WindowsSandboxMode;
  projectWorkspaceDir: string;
  networkEnabled: boolean;
}

/** @deprecated Use SandboxStrategyParams */
export type McpInjectionParams = SandboxStrategyParams;
/** @deprecated Use SandboxStrategyParams */
export type TerminalManagerParams = SandboxStrategyParams;

export interface StrictContextParams {
  workspaceDir?: string;
  projectWorkspaceDir?: string;
  isolatedHome?: string | null;
}

// === Implementation ===

class SandboxEnforcementStrategyImpl implements SandboxEnforcementStrategy {
  readonly sandboxEnabled: boolean;
  private readonly isWin: boolean;
  private readonly isNuwax: boolean;
  private readonly isStrict: boolean;
  private readonly isStrictOrCompat: boolean;

  constructor(
    public readonly sandboxType: SandboxType,
    public readonly sandboxMode: SandboxMode,
    public readonly engineName: "claude-code" | "nuwaxcode",
  ) {
    this.sandboxEnabled = sandboxType !== "none";
    this.isWin = process.platform === "win32";
    this.isNuwax = engineName === "nuwaxcode";
    this.isStrict = sandboxMode === "strict";
    this.isStrictOrCompat = sandboxMode !== "permissive";
  }

  // --- E. Proactive Guard ---

  needsProactiveGuard(): boolean {
    return (
      this.isWin &&
      this.isNuwax &&
      this.isStrict &&
      this.sandboxEnabled &&
      this.sandboxType === "windows-sandbox"
    );
  }

  // --- D. Disallowed Tools ---

  buildDisallowedTools(): string[] {
    if (!this.sandboxEnabled || this.isNuwax) return [];

    const disallowed: string[] = [];
    // Bash only blocked on Windows (replaced by sandboxed-bash MCP).
    // macOS/Linux: process-level seatbelt/bwrap already restricts shell commands.
    if (this.isWin && this.sandboxType === "windows-sandbox") {
      disallowed.push("Bash");
    }
    if (this.isStrictOrCompat) {
      disallowed.push("Write", "Edit", "NotebookEdit");
    }
    return disallowed;
  }

  // --- B. Engine Config Injection ---

  buildEngineConfigOverrides(
    configObj: Record<string, unknown>,
    params: EngineConfigParams,
  ): Record<string, unknown> | null {
    if (!this.sandboxEnabled || !this.isNuwax) return null;

    const sandboxObj: Record<string, unknown> = {
      mode: params.windowsSandboxMode ?? "workspace-write",
      network_enabled: true,
      sandbox_mode: this.sandboxMode,
      writable_roots: params.projectWorkspaceDir
        ? [params.projectWorkspaceDir]
        : [params.workspaceDir],
    };

    // Only set helper_path on Windows where the helper exe exists.
    if (params.windowsSandboxHelperPath) {
      sandboxObj.helper_path = params.windowsSandboxHelperPath;
    }

    configObj.sandbox = sandboxObj;

    // In strict mode, deny external_directory writes.
    if (this.isStrict) {
      const perm = configObj.permission as Record<string, string> | undefined;
      if (perm) {
        perm.external_directory = "deny";
      }
    }

    return configObj;
  }

  // --- C. MCP Server Injection ---

  buildInjectedMcpServers(params: SandboxStrategyParams): AcpMcpServer[] {
    if (!this.sandboxEnabled || this.isNuwax) return [];

    const servers: AcpMcpServer[] = [];

    // Sandboxed Bash MCP — Windows + claude-code only.
    if (
      this.isWin &&
      this.sandboxType === "windows-sandbox" &&
      params.windowsSandboxHelperPath
    ) {
      const nodePath = process.execPath;
      const scriptPath = path.join(
        getResourcesPath(),
        "sandboxed-bash-mcp",
        "sandboxed-bash-mcp.mjs",
      );

      const appEnv = getAppEnv({ includeSystemPath: false });
      const gitBashPath = getBundledGitBashPath();

      const envVars: Array<{ name: string; value: string }> = [
        { name: "ELECTRON_RUN_AS_NODE", value: "1" },
        {
          name: "NUWAX_SANDBOX_HELPER_PATH",
          value: params.windowsSandboxHelperPath,
        },
        {
          name: "NUWAX_SANDBOX_MODE",
          value: params.windowsSandboxMode ?? "workspace-write",
        },
        {
          name: "NUWAX_SANDBOX_NETWORK_ENABLED",
          value: params.networkEnabled ? "1" : "0",
        },
        {
          name: "NUWAX_SANDBOX_WRITABLE_ROOTS",
          value: JSON.stringify(
            params.projectWorkspaceDir ? [params.projectWorkspaceDir] : [],
          ),
        },
        ...(appEnv.PATH
          ? [{ name: "NUWAX_SANDBOX_PATH", value: appEnv.PATH }]
          : []),
        ...(gitBashPath
          ? [{ name: "NUWAX_SANDBOX_GIT_BASH_PATH", value: gitBashPath }]
          : []),
      ];

      servers.push({
        name: "sandboxed-bash",
        command: nodePath,
        args: [path.resolve(scriptPath)],
        env: envVars,
      });
    }

    // Sandboxed FS MCP — all platforms, strict/compat modes, claude-code only.
    if (this.isStrictOrCompat) {
      const nodePath = process.execPath;
      const fsScriptPath = path.join(
        getResourcesPath(),
        "sandboxed-fs-mcp",
        "sandboxed-fs-mcp.mjs",
      );

      const fsEnv: Array<{ name: string; value: string }> = [
        { name: "ELECTRON_RUN_AS_NODE", value: "1" },
        { name: "NUWAX_SANDBOX_MODE", value: this.sandboxMode },
        {
          name: "NUWAX_SANDBOX_WRITABLE_ROOTS",
          value: JSON.stringify(
            params.projectWorkspaceDir ? [params.projectWorkspaceDir] : [],
          ),
        },
        ...(process.env.TEMP
          ? [{ name: "TEMP", value: process.env.TEMP }]
          : []),
        ...(process.env.TMP ? [{ name: "TMP", value: process.env.TMP }] : []),
        ...(process.env.APPDATA
          ? [{ name: "APPDATA", value: process.env.APPDATA }]
          : []),
        ...(process.env.LOCALAPPDATA
          ? [{ name: "LOCALAPPDATA", value: process.env.LOCALAPPDATA }]
          : []),
      ];

      servers.push({
        name: "sandboxed-fs",
        command: nodePath,
        args: [path.resolve(fsScriptPath)],
        env: fsEnv,
      });
    }

    return servers;
  }

  // --- F. Terminal Manager ---

  createTerminalManagerOptions(
    params: SandboxStrategyParams,
  ): AcpTerminalManagerOptions {
    if (
      !this.sandboxEnabled ||
      !this.isWin ||
      this.sandboxType !== "windows-sandbox" ||
      !params.windowsSandboxHelperPath
    ) {
      return {};
    }

    return {
      windowsSandboxHelperPath: params.windowsSandboxHelperPath,
      windowsSandboxMode: params.windowsSandboxMode,
      networkEnabled: params.networkEnabled,
      writablePaths: params.projectWorkspaceDir
        ? [params.projectWorkspaceDir]
        : [],
      mode: this.sandboxMode,
    };
  }

  // --- G. Strict Permission Context ---

  buildStrictPermissionContext(
    params: StrictContextParams,
  ): StrictPermissionContext {
    return {
      // Defense-in-depth: evaluate strict write permission for ALL strict sandbox modes,
      // not just Windows nuwaxcode. On macOS/Linux, handlePermissionRequest() will also
      // enforce write restrictions if the engine sends permission_request events.
      strictEnabled: this.isStrict && this.sandboxEnabled,
      sandboxMode: this.sandboxMode,
      workspaceDir: params.workspaceDir,
      projectWorkspaceDir: params.projectWorkspaceDir,
      isolatedHome: params.isolatedHome,
      appDataDir: path.join(os.homedir(), APP_DATA_DIR_NAME),
      tempDirs: [
        os.tmpdir(),
        process.env.TMPDIR,
        process.env.TMP,
        process.env.TEMP,
      ].filter(Boolean) as string[],
    };
  }
}

// === Factory ===

export function createSandboxEnforcementStrategy(
  sandboxType: SandboxType,
  sandboxMode: SandboxMode,
  engineName: "claude-code" | "nuwaxcode",
): SandboxEnforcementStrategy {
  return new SandboxEnforcementStrategyImpl(
    sandboxType,
    sandboxMode,
    engineName,
  );
}
