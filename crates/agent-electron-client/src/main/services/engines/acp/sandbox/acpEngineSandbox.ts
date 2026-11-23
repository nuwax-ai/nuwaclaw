/**
 * Per-engine sandbox capabilities for ACP handlers.
 *
 * Engine profiles keep sandbox and permission behavior in one place.
 */

import type { SandboxProcessConfig } from "@shared/types/sandbox";
import {
  applyOpencodeSandboxToOpenCodeConfig,
  readBundledOpencodeEngineVersion,
  usesNativeOpencodeSandbox,
  type ApplyOpencodeSandboxConfigResult,
} from "./opencodeAcpSandbox";

const NO_OPENCODE_SPAWN_SANDBOX_RESULT: ApplyOpencodeSandboxConfigResult = {
  opencodeSandboxConfigInjected: false,
  builtinBashDenied: false,
  builtinEditDenied: false,
  engineVersion: undefined,
  usesNativeSandbox: false,
};

export type AcpEngineSandboxFamily =
  | "opencode-acp"
  | "claude-code-acp"
  | "harness-acp"
  | "unknown";

/** Engines that support OpenCode-specific process and sandbox configuration. */
export const OPENCODE_ACP_ENGINE_IDS = new Set<string>([
  "nuwaxcode",
  "opencode",
]);

const CLAUDE_CODE_ENGINE_IDS = new Set<string>([
  "claude-code",
  "claude-code-acp-ts",
]);

export interface AcpEngineSandboxCapabilities {
  family: AcpEngineSandboxFamily;
  engineId: string;
  /** Inject OPENCODE_CONFIG_CONTENT on process spawn */
  usesOpencodeSpawnConfig: boolean;
  /** MCP compat layer at session/create (pre-native versions) */
  usesCompatMcpLayer(sandboxConfig?: SandboxProcessConfig): boolean;
  /** strictPermissionGuard on permission_request */
  supportsStrictSessionGuard: boolean;
  /** Engine-specific prompt/MCP retry behaviour */
  usesOpencodePromptBehaviors: boolean;
  readBundledVersion(): string | undefined;
  applyOpencodeSpawnSandbox(
    options: Parameters<typeof applyOpencodeSandboxToOpenCodeConfig>[0],
  ): ApplyOpencodeSandboxConfigResult;
}

function createOpencodeCapabilities(
  engineId: string,
): AcpEngineSandboxCapabilities {
  return {
    family: "opencode-acp",
    engineId,
    usesOpencodeSpawnConfig: true,
    usesOpencodePromptBehaviors: true,
    supportsStrictSessionGuard: true,
    readBundledVersion: () => readBundledOpencodeEngineVersion(engineId),
    usesCompatMcpLayer(sandboxConfig?: SandboxProcessConfig) {
      if (!sandboxConfig?.enabled || sandboxConfig.type === "none") {
        return false;
      }
      const version = readBundledOpencodeEngineVersion(engineId);
      return !usesNativeOpencodeSandbox(version);
    },
    applyOpencodeSpawnSandbox: (options) =>
      applyOpencodeSandboxToOpenCodeConfig({
        ...options,
        engineVersion:
          options.engineVersion ?? readBundledOpencodeEngineVersion(engineId),
      }),
  };
}

function createNonOpencodeCapabilities(
  family: "claude-code-acp" | "harness-acp" | "unknown",
  engineId: string,
): AcpEngineSandboxCapabilities {
  return {
    family,
    engineId,
    usesOpencodeSpawnConfig: false,
    usesCompatMcpLayer: (sandboxConfig) =>
      family === "harness-acp" &&
      !!sandboxConfig?.enabled &&
      sandboxConfig.type !== "none",
    supportsStrictSessionGuard: family === "harness-acp",
    usesOpencodePromptBehaviors: false,
    readBundledVersion: () => undefined,
    applyOpencodeSpawnSandbox: () => ({ ...NO_OPENCODE_SPAWN_SANDBOX_RESULT }),
  };
}

const opencodeProfileCache = new Map<string, AcpEngineSandboxCapabilities>();

export function getAcpEngineSandboxCapabilities(
  engineId: string,
): AcpEngineSandboxCapabilities {
  if (engineId === "nuwax-harness") {
    return createNonOpencodeCapabilities("harness-acp", engineId);
  }
  if (CLAUDE_CODE_ENGINE_IDS.has(engineId)) {
    return createNonOpencodeCapabilities("claude-code-acp", engineId);
  }
  if (OPENCODE_ACP_ENGINE_IDS.has(engineId)) {
    let profile = opencodeProfileCache.get(engineId);
    if (!profile) {
      profile = createOpencodeCapabilities(engineId);
      opencodeProfileCache.set(engineId, profile);
    }
    return profile;
  }
  return createNonOpencodeCapabilities("unknown", engineId);
}

export function isOpencodeAcpEngine(engineId: string): boolean {
  return getAcpEngineSandboxCapabilities(engineId).family === "opencode-acp";
}

export function usesNativeSandboxForEngine(
  engineId: string,
  sandboxConfig?: SandboxProcessConfig | null,
): boolean {
  const caps = getAcpEngineSandboxCapabilities(engineId);
  if (!caps.usesOpencodeSpawnConfig || !sandboxConfig?.enabled) return false;
  return usesNativeOpencodeSandbox(caps.readBundledVersion());
}

/**
 * Whether createSession should inject sandboxed-bash/fs MCP (legacy compat + claude-code).
 */
export function usesSandboxedMcpAtSession(
  engineId: string,
  sandboxConfig?: SandboxProcessConfig | null,
): boolean {
  if (!sandboxConfig?.enabled || sandboxConfig.type === "none") {
    return false;
  }
  const nativeSandbox = usesNativeSandboxForEngine(engineId, sandboxConfig);
  const caps = getAcpEngineSandboxCapabilities(engineId);
  if (nativeSandbox && caps.family === "opencode-acp") {
    // Native OpenCode sandbox config is process-scoped. In strict mode, the
    // session cwd is only known at newSession time, so keep the session-level
    // sandboxed MCP replacement for file writes.
    return sandboxConfig.mode === "strict";
  }
  if (nativeSandbox) {
    return false;
  }
  if (caps.usesCompatMcpLayer(sandboxConfig)) {
    return true;
  }
  return (
    caps.family === "claude-code-acp" &&
    sandboxConfig.type === "windows-sandbox" &&
    !!sandboxConfig.windowsSandboxHelperPath
  );
}
