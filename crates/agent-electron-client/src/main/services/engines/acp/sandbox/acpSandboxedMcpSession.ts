/**
 * Session-level sandboxed-bash / sandboxed-fs MCP injection (shared by ACP engines).
 */

import * as path from "path";
import log from "electron-log";
import {
  getAppEnv,
  getBundledGitBashPath,
} from "@main/services/system/dependencies";
import type { SandboxProcessConfig } from "@shared/types/sandbox";
import type { AcpEnvVariable, AcpMcpServer } from "../acpClient";
import {
  canInjectSandboxedBashMcp,
  canInjectSandboxedFsMcp,
  getSandboxedBashMcpScriptPath,
  getSandboxedFsMcpScriptPath,
  resolveSandboxWritableRoots,
} from "./opencodeAcpSandbox";
import {
  usesNativeSandboxForEngine,
  usesSandboxedMcpAtSession,
} from "./acpEngineSandbox";

export type InjectSandboxedMcpSessionOptions = {
  engineId: string;
  logTag: string;
  sandboxConfig: SandboxProcessConfig | null | undefined;
  sessionCwd: string;
  mcpServers: AcpMcpServer[];
  resourcesPath: string;
  nodePath?: string;
};

export type InjectSandboxedMcpSessionResult = {
  sandboxedBashInjected: boolean;
  sandboxedFsInjected: boolean;
  nativeSandboxSkipped: boolean;
};

function toElectronNodeEnv(
  pairs: Array<{ name: string; value: string } | undefined>,
): AcpEnvVariable[] {
  return pairs.filter((p): p is AcpEnvVariable => !!p);
}

export function injectSandboxedMcpForSession(
  options: InjectSandboxedMcpSessionOptions,
): InjectSandboxedMcpSessionResult {
  const {
    engineId,
    logTag,
    sandboxConfig,
    sessionCwd,
    mcpServers,
    resourcesPath,
    nodePath = process.execPath,
  } = options;

  const result: InjectSandboxedMcpSessionResult = {
    sandboxedBashInjected: false,
    sandboxedFsInjected: false,
    nativeSandboxSkipped: false,
  };

  const sandboxEnabled = sandboxConfig?.enabled === true;
  if (!sandboxEnabled || !sandboxConfig) {
    return result;
  }

  const nativeSandbox = usesNativeSandboxForEngine(engineId, sandboxConfig);
  const useSandboxedMcpAtSession = usesSandboxedMcpAtSession(
    engineId,
    sandboxConfig,
  );
  const sandboxMode = sandboxConfig.mode ?? "compat";
  const isStrictOrCompat = sandboxMode !== "permissive";
  const mcpWritableRoots = isStrictOrCompat
    ? resolveSandboxWritableRoots({
        mode: sandboxMode,
        sessionCwd,
        projectWorkspaceDir: sandboxConfig.projectWorkspaceDir,
      })
    : [];

  if (nativeSandbox) {
    result.nativeSandboxSkipped = true;
    if (useSandboxedMcpAtSession) {
      log.info(
        `${logTag} Using native OpenCode sandbox (engine=${engineId}); session-scoped sandboxed MCP remains enabled`,
      );
    } else {
      log.info(
        `${logTag} Using native OpenCode sandbox (engine=${engineId}); sandboxed-bash/fs MCP skipped`,
      );
    }
  }

  log.info(
    `${logTag} 🔍 Sandbox check: engine=${engineId}, sandboxEnabled=${sandboxConfig.enabled}, type=${sandboxConfig.type}, helperPath=${sandboxConfig.windowsSandboxHelperPath ?? "(none)"}, nativeSandbox=${nativeSandbox}, sandboxedMcpAtSession=${useSandboxedMcpAtSession}`,
  );

  if (!useSandboxedMcpAtSession) {
    return result;
  }

  if (
    sandboxConfig.type === "windows-sandbox" &&
    sandboxConfig.windowsSandboxHelperPath
  ) {
    const resolvedScriptPath = path.resolve(
      getSandboxedBashMcpScriptPath(resourcesPath),
    );
    if (!canInjectSandboxedBashMcp(sandboxConfig, resourcesPath)) {
      log.warn(`${logTag} Sandboxed Bash MCP unavailable, skip injection`, {
        scriptPath: resolvedScriptPath,
      });
    } else {
      const appEnv = getAppEnv({ includeSystemPath: false });
      const gitBashPath = getBundledGitBashPath();
      if (!gitBashPath) {
        log.warn(
          `${logTag} Bundled Git Bash not found (run npm run prepare:git); sandboxed-bash MCP may fall back to PowerShell. Script files (.sh/.ps1/.js/.py…) may fail or show Windows open-with dialog.`,
        );
      }
      mcpServers.push({
        name: "sandboxed-bash",
        command: nodePath,
        args: [resolvedScriptPath],
        env: toElectronNodeEnv([
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          {
            name: "NUWAX_SANDBOX_HELPER_PATH",
            value: sandboxConfig.windowsSandboxHelperPath,
          },
          {
            name: "NUWAX_SANDBOX_MODE",
            value: sandboxConfig.windowsSandboxMode ?? "workspace-write",
          },
          {
            name: "NUWAX_SANDBOX_POLICY_MODE",
            value: sandboxMode,
          },
          {
            name: "NUWAX_SANDBOX_NETWORK_ENABLED",
            value: (sandboxConfig.networkEnabled ?? true) ? "1" : "0",
          },
          {
            name: "NUWAX_SANDBOX_WRITABLE_ROOTS",
            value: JSON.stringify(mcpWritableRoots),
          },
          ...(appEnv.PATH
            ? [{ name: "NUWAX_SANDBOX_PATH", value: appEnv.PATH }]
            : []),
          ...(gitBashPath
            ? [{ name: "NUWAX_SANDBOX_GIT_BASH_PATH", value: gitBashPath }]
            : []),
        ]),
      });
      result.sandboxedBashInjected = true;
      log.info(
        `${logTag} 🔒 Sandboxed Bash MCP injected (Windows, mode=${sandboxConfig.windowsSandboxMode ?? "workspace-write"}, script=${path.basename(resolvedScriptPath)})`,
      );
    }
  }

  if (sandboxConfig.type !== "none" && isStrictOrCompat) {
    const resolvedFsScriptPath = path.resolve(
      getSandboxedFsMcpScriptPath(resourcesPath),
    );
    if (!canInjectSandboxedFsMcp(sandboxConfig, resourcesPath)) {
      log.warn(`${logTag} Sandboxed FS MCP unavailable, skip injection`, {
        scriptPath: resolvedFsScriptPath,
        sandboxMode,
      });
    } else {
      mcpServers.push({
        name: "sandboxed-fs",
        command: nodePath,
        args: [resolvedFsScriptPath],
        env: toElectronNodeEnv([
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          { name: "NUWAX_SANDBOX_MODE", value: sandboxMode },
          {
            name: "NUWAX_SANDBOX_WRITABLE_ROOTS",
            value: JSON.stringify(mcpWritableRoots),
          },
          { name: "NUWAX_SANDBOX_SESSION_CWD", value: sessionCwd },
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
        ]),
      });
      result.sandboxedFsInjected = true;
      log.info(
        `${logTag} 🔒 Sandboxed FS MCP injected (cross-platform, mode=${sandboxMode}, writableRoots=${mcpWritableRoots.length}, script=${path.basename(resolvedFsScriptPath)})`,
        { writableRoots: mcpWritableRoots },
      );
    }
  }

  return result;
}
