/**
 * OpenCode-family ACP engines (nuwaxcode, codex-cli, …).
 *
 * Shared OPENCODE_CONFIG_CONTENT.sandbox contract — not tied to a single binary name.
 * Engine-specific bundled paths are resolved via acpEngineSandbox.ts.
 */

import * as fs from "fs";
import * as path from "path";
import type { SandboxProcessConfig } from "@shared/types/sandbox";
import { getResourcesPath } from "@main/services/system/dependencies";

/** Min engine version that accepts `sandbox` in OPENCODE_CONFIG_CONTENT. */
export const OPENCODE_NATIVE_SANDBOX_CONFIG_MIN_VERSION = "1.2.0";

export const OPENCODE_NATIVE_SANDBOX_CONFIG_ENABLED = true;

/**
 * Versions that satisfy semver >= 1.2.0 but reject top-level `sandbox` in
 * OPENCODE_CONFIG_CONTENT (e.g. 1.3.0-beta.* before native sandbox is merged).
 */
export function isOpencodeNativeSandboxBlockedVersion(
  engineVersion?: string | null,
): boolean {
  const v = engineVersion?.trim();
  if (!v) return false;
  return /^1\.3\.0-beta/i.test(v);
}

export function parseSemverTriplet(
  version: string,
): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemverTriplet(a);
  const right = parseSemverTriplet(b);
  if (!left || !right) return -1;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function supportsOpencodeConfigSandbox(
  engineVersion?: string | null,
): boolean {
  if (!OPENCODE_NATIVE_SANDBOX_CONFIG_ENABLED) return false;
  if (!engineVersion?.trim()) return false;
  if (isOpencodeNativeSandboxBlockedVersion(engineVersion)) return false;
  return (
    compareSemver(
      engineVersion.trim(),
      OPENCODE_NATIVE_SANDBOX_CONFIG_MIN_VERSION,
    ) >= 0
  );
}

export function usesNativeOpencodeSandbox(
  engineVersion?: string | null,
): boolean {
  return supportsOpencodeConfigSandbox(engineVersion);
}

export function readBundledOpencodeEngineVersion(
  resourcesSubdir: string,
): string | undefined {
  const versionFile = path.join(
    getResourcesPath(),
    resourcesSubdir,
    ".version",
  );
  try {
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, "utf-8").trim() || undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

const SANDBOXED_BASH_MCP_BASENAME = "sandboxed-bash-mcp";
const SANDBOXED_FS_MCP_BASENAME = "sandboxed-fs-mcp";

function resolveSandboxedMcpScriptPath(
  resourcesPath: string,
  resourceDir: string,
  basename: string,
  exists: FileExistsFn = (p) => fs.existsSync(p),
): string {
  const bundled = path.resolve(
    resourcesPath,
    resourceDir,
    "dist",
    `${basename}.bundle.mjs`,
  );
  if (exists(bundled)) {
    return bundled;
  }
  return path.resolve(resourcesPath, resourceDir, `${basename}.mjs`);
}

export function getSandboxedBashMcpScriptPath(
  resourcesPath: string,
  exists?: FileExistsFn,
): string {
  return resolveSandboxedMcpScriptPath(
    resourcesPath,
    "sandboxed-bash-mcp",
    SANDBOXED_BASH_MCP_BASENAME,
    exists,
  );
}

export function getSandboxedFsMcpScriptPath(
  resourcesPath: string,
  exists?: FileExistsFn,
): string {
  return resolveSandboxedMcpScriptPath(
    resourcesPath,
    "sandboxed-fs-mcp",
    SANDBOXED_FS_MCP_BASENAME,
    exists,
  );
}

export function resolveSandboxWritableRoots(options: {
  mode: "strict" | "compat" | "permissive";
  sessionCwd: string;
  projectWorkspaceDir?: string;
}): string[] {
  const sessionRoot = path.resolve(options.sessionCwd);
  if (options.mode === "strict") {
    return [sessionRoot];
  }
  const roots = new Set<string>([sessionRoot]);
  if (options.projectWorkspaceDir) {
    const projectRoot = path.resolve(options.projectWorkspaceDir);
    if (projectRoot !== sessionRoot) {
      roots.add(projectRoot);
    }
  }
  return [...roots];
}

export type FileExistsFn = (filePath: string) => boolean;

export function canInjectSandboxedBashMcp(
  sandboxConfig: SandboxProcessConfig,
  resourcesPath: string,
  exists: FileExistsFn = (p) => fs.existsSync(p),
): boolean {
  return (
    sandboxConfig.enabled === true &&
    sandboxConfig.type === "windows-sandbox" &&
    !!sandboxConfig.windowsSandboxHelperPath &&
    exists(getSandboxedBashMcpScriptPath(resourcesPath))
  );
}

export function canInjectSandboxedFsMcp(
  sandboxConfig: SandboxProcessConfig,
  resourcesPath: string,
  exists: FileExistsFn = (p) => fs.existsSync(p),
): boolean {
  const mode = sandboxConfig.mode ?? "compat";
  if (mode === "permissive") return false;
  return (
    sandboxConfig.enabled === true &&
    sandboxConfig.type !== "none" &&
    exists(getSandboxedFsMcpScriptPath(resourcesPath))
  );
}

export type ApplyOpencodeSandboxConfigOptions = {
  configObj: Record<string, unknown>;
  sandboxConfig: SandboxProcessConfig;
  workspaceDir: string;
  resourcesPath?: string;
  engineVersion?: string | null;
  sessionCwd?: string;
  fileExists?: FileExistsFn;
};

export type ApplyOpencodeSandboxConfigResult = {
  opencodeSandboxConfigInjected: boolean;
  builtinBashDenied: boolean;
  builtinEditDenied: boolean;
  engineVersion: string | undefined;
  usesNativeSandbox: boolean;
};

export function applyOpencodeSandboxToOpenCodeConfig(
  options: ApplyOpencodeSandboxConfigOptions,
): ApplyOpencodeSandboxConfigResult {
  const {
    configObj,
    sandboxConfig,
    workspaceDir,
    resourcesPath = getResourcesPath(),
    fileExists,
  } = options;
  const engineVersion = options.engineVersion ?? undefined;
  const effectiveMode = sandboxConfig.mode ?? "compat";
  const native = usesNativeOpencodeSandbox(engineVersion);
  const result: ApplyOpencodeSandboxConfigResult = {
    opencodeSandboxConfigInjected: false,
    builtinBashDenied: false,
    builtinEditDenied: false,
    engineVersion,
    usesNativeSandbox: native,
  };

  const perm = (configObj.permission ?? {}) as Record<string, string>;
  configObj.permission = perm;

  if (native) {
    const sandboxObj: Record<string, unknown> = {
      mode: sandboxConfig.windowsSandboxMode ?? "workspace-write",
      network_enabled: sandboxConfig.networkEnabled ?? true,
      sandbox_mode: effectiveMode,
    };
    if (sandboxConfig.windowsSandboxHelperPath) {
      sandboxObj.helper_path = sandboxConfig.windowsSandboxHelperPath;
    }
    if (effectiveMode === "strict") {
      // Spawn-time config does not know the ACP session cwd yet. Do not grant
      // the broader base workspace here; session-scoped writes are provided by
      // sandboxed-fs MCP and strictPermissionGuard after newSession.
      // Note: Windows process-level serve mode still has its own cwd/root
      // compatibility allowances for MCP spawn; this only controls OpenCode's
      // native per-command sandbox config.
      sandboxObj.writable_roots = [];
    } else if (effectiveMode === "compat") {
      sandboxObj.writable_roots = resolveSandboxWritableRoots({
        mode: effectiveMode,
        sessionCwd: options.sessionCwd ?? workspaceDir,
        projectWorkspaceDir: sandboxConfig.projectWorkspaceDir,
      });
    }
    configObj.sandbox = sandboxObj;
    result.opencodeSandboxConfigInjected = true;
    if (effectiveMode === "strict") {
      perm.external_directory = "deny";
      perm.edit = "deny";
      result.builtinEditDenied = true;
      const shouldDenyBuiltinBash = canInjectSandboxedBashMcp(
        sandboxConfig,
        resourcesPath,
        fileExists,
      );
      if (shouldDenyBuiltinBash) {
        perm.bash = "deny";
        result.builtinBashDenied = true;
      }
      const tools = (configObj.tools ?? {}) as Record<string, boolean>;
      configObj.tools = {
        ...tools,
        write: false,
        edit: false,
        apply_patch: false,
        ...(shouldDenyBuiltinBash ? { bash: false } : {}),
      };
    }
    return result;
  }

  const permLegacy = perm;
  if (canInjectSandboxedBashMcp(sandboxConfig, resourcesPath, fileExists)) {
    permLegacy.bash = "deny";
    result.builtinBashDenied = true;
  }

  if (canInjectSandboxedFsMcp(sandboxConfig, resourcesPath, fileExists)) {
    permLegacy.edit = "deny";
    result.builtinEditDenied = true;

    const tools = (configObj.tools ?? {}) as Record<string, boolean>;
    configObj.tools = {
      ...tools,
      write: false,
      edit: false,
      apply_patch: false,
      ...(result.builtinBashDenied ? { bash: false } : {}),
    };
  }

  if (effectiveMode === "strict") {
    permLegacy.external_directory = "deny";
  }

  return result;
}
