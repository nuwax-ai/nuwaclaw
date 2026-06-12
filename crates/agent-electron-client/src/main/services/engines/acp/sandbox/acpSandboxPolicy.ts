/**
 * Resolve global sandbox policy → ACP process/session config.
 */

import log from "electron-log";
import {
  getSandboxPolicy,
  resolveSandboxType,
  getBundledLinuxBwrapPath,
  getBundledWindowsSandboxHelperPath,
} from "@main/services/sandbox/policy";
import { SandboxError, SandboxErrorCode } from "@shared/errors/sandbox";
import type { SandboxProcessConfig } from "@shared/types/sandbox";

export type ResolveAcpSandboxConfigResult = {
  config?: SandboxProcessConfig;
  /** Policy enabled but backend unavailable (caller may throw). */
  unavailable?: SandboxError;
};

export async function resolveAcpSandboxProcessConfig(
  workspaceDir: string,
  logTag: string,
): Promise<ResolveAcpSandboxConfigResult> {
  try {
    const policy = getSandboxPolicy();
    if (!policy.enabled) {
      return {};
    }
    const resolved = await resolveSandboxType(policy);
    if (resolved.type === "none") {
      return {};
    }
    const config: SandboxProcessConfig = {
      enabled: true,
      type: resolved.type,
      mode: policy.mode,
      autoFallback: policy.autoFallback,
      projectWorkspaceDir: workspaceDir,
      networkEnabled: true,
      fallback: "degrade_to_off",
      linuxBwrapPath: getBundledLinuxBwrapPath() ?? undefined,
      windowsSandboxHelperPath:
        getBundledWindowsSandboxHelperPath() ?? undefined,
      windowsSandboxMode: policy.windowsMode,
    };
    log.info(`${logTag} Sandbox config resolved:`, {
      type: resolved.type,
      mode: policy.mode,
      autoFallback: policy.autoFallback,
      degraded: resolved.degraded,
    });
    return { config };
  } catch (e) {
    if (
      e instanceof SandboxError &&
      e.code === SandboxErrorCode.SANDBOX_UNAVAILABLE
    ) {
      return { unavailable: e };
    }
    log.warn(
      `${logTag} Sandbox policy parse failed, running without sandbox:`,
      e,
    );
    return {};
  }
}
