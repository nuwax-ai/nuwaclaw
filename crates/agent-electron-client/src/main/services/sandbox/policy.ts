import * as fs from "fs";
import log from "electron-log";
import { app } from "electron";
import { readSetting, writeSetting } from "../../db";
import { checkCommand } from "../system/shellEnv";
import { getResourcesPath } from "../system/dependencies";
import {
  createPlatformAdapter,
  getCurrentPlatform,
} from "../system/platformAdapter";
import type {
  SandboxAutoFallback,
  Platform,
  SandboxBackend,
  SandboxCapabilities,
  SandboxCapabilityItem,
  SandboxMode,
  SandboxPolicy,
  SandboxType,
  WindowsSandboxMode,
} from "@shared/types/sandbox";
import { SandboxError, SandboxErrorCode } from "@shared/errors/sandbox";
import { setCachedSandboxPolicy } from "./policyCache";

export const SANDBOX_POLICY_KEY = "sandbox_policy";

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  enabled: true,
  backend: "auto",
  mode: "compat",
  autoFallback: "startup-only",
  windowsMode: "workspace-write",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeSandboxPolicy(input: unknown): SandboxPolicy {
  if (!isObject(input)) {
    return { ...DEFAULT_SANDBOX_POLICY };
  }

  const enabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : DEFAULT_SANDBOX_POLICY.enabled;

  const backend: SandboxBackend =
    input.backend === "auto" ||
    input.backend === "docker" ||
    input.backend === "macos-seatbelt" ||
    input.backend === "linux-bwrap" ||
    input.backend === "windows-sandbox"
      ? input.backend
      : DEFAULT_SANDBOX_POLICY.backend;

  const mode: SandboxMode =
    input.mode === "strict" ||
    input.mode === "compat" ||
    input.mode === "permissive"
      ? input.mode
      : DEFAULT_SANDBOX_POLICY.mode;

  const autoFallback: SandboxAutoFallback =
    input.autoFallback === "startup-only" ||
    input.autoFallback === "session" ||
    input.autoFallback === "manual"
      ? input.autoFallback
      : DEFAULT_SANDBOX_POLICY.autoFallback;

  // 兼容旧格式：windows.sandbox.mode → windowsMode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyWindowsMode = (input.windows as any)?.sandbox?.mode as
    | string
    | undefined;
  const rawWindowsMode = input.windowsMode ?? legacyWindowsMode;
  const windowsMode: WindowsSandboxMode =
    rawWindowsMode === "read-only" || rawWindowsMode === "workspace-write"
      ? rawWindowsMode
      : DEFAULT_SANDBOX_POLICY.windowsMode;

  return { enabled, backend, mode, autoFallback, windowsMode };
}

function mergeSandboxPolicy(
  current: SandboxPolicy,
  patch: Partial<SandboxPolicy>,
): SandboxPolicy {
  return normalizeSandboxPolicy({ ...current, ...patch });
}

export function getSandboxPolicy(): SandboxPolicy {
  const policy = normalizeSandboxPolicy(readSetting(SANDBOX_POLICY_KEY));
  setCachedSandboxPolicy(policy);
  return policy;
}

export function setSandboxPolicy(patch: Partial<SandboxPolicy>): SandboxPolicy {
  const current = getSandboxPolicy();
  const next = mergeSandboxPolicy(current, patch);
  writeSetting(SANDBOX_POLICY_KEY, next);
  setCachedSandboxPolicy(next);
  log.info("[SandboxPolicy] updated:", next);
  return next;
}

function getPlatform(): Platform {
  return getCurrentPlatform();
}

export function getBundledLinuxBwrapPath(): string | null {
  const adapter = createPlatformAdapter();
  return adapter.resolveBundledLinuxBwrapPath(getResourcesPath());
}

/**
 * 解析内置 Sandbox helper 路径（跨平台）。
 * Windows: nuwax-sandbox-helper.exe
 * macOS/Linux: nuwax-sandbox-helper
 */
export function getBundledSandboxHelperPath(): string | null {
  const adapter = createPlatformAdapter();
  return adapter.resolveBundledSandboxHelperPath(getResourcesPath());
}

/**
 * 解析内置 Windows Sandbox helper 路径。
 * 仅在 Windows 上返回有效路径，其他平台返回 null。
 * @deprecated 使用 getBundledSandboxHelperPath() 代替
 */
export function getBundledWindowsSandboxHelperPath(): string | null {
  const adapter = createPlatformAdapter();
  if (!adapter.isWindows) {
    return null;
  }
  return getBundledSandboxHelperPath();
}

function unavailable(reason: string): SandboxCapabilityItem {
  return { available: false, reason };
}

function getRecommendedBackend(platform: Platform): SandboxBackend {
  return createPlatformAdapter(platform).getRecommendedSandboxBackend();
}

export async function getSandboxCapabilities(): Promise<SandboxCapabilities> {
  const platform = getPlatform();
  const adapter = createPlatformAdapter(platform);
  const recommendedBackend = getRecommendedBackend(platform);
  const dockerAvailable = await checkCommand("docker");
  const bwrapCmdAvailable = adapter.isLinux
    ? await checkCommand("bwrap")
    : false;
  const bundledBwrap = getBundledLinuxBwrapPath();
  const sandboxHelper = getBundledWindowsSandboxHelperPath();
  const seatbeltPath = adapter.getSeatbeltPath();

  const docker: SandboxCapabilityItem = dockerAvailable
    ? { available: true }
    : unavailable("docker command not found");
  const macosSeatbelt: SandboxCapabilityItem = !adapter.isMacOS
    ? unavailable("not on macOS")
    : seatbeltPath && fs.existsSync(seatbeltPath)
      ? { available: true, binaryPath: seatbeltPath }
      : unavailable("sandbox-exec not found");
  const linuxBwrap: SandboxCapabilityItem = !adapter.isLinux
    ? unavailable("not on Linux")
    : bwrapCmdAvailable
      ? { available: true, binaryPath: "bwrap" }
      : bundledBwrap
        ? { available: true, binaryPath: bundledBwrap }
        : unavailable("bwrap not found (system or bundled)");
  const windowsSandbox: SandboxCapabilityItem = !adapter.isWindows
    ? unavailable("not on Windows")
    : sandboxHelper
      ? { available: true, binaryPath: sandboxHelper }
      : unavailable("windows sandbox helper not found");

  return {
    platform,
    recommendedBackend,
    docker,
    macosSeatbelt,
    linuxBwrap,
    windowsSandbox,
  };
}

function backendToSandboxType(
  backend: SandboxBackend,
  platform: Platform,
): SandboxType {
  if (backend === "auto") {
    return createPlatformAdapter(platform).getRecommendedSandboxType();
  }
  if (backend === "docker") return "docker";
  if (backend === "macos-seatbelt") return "macos-seatbelt";
  if (backend === "linux-bwrap") return "linux-bwrap";
  return "windows-sandbox";
}

function isBackendAvailable(
  type: SandboxType,
  caps: SandboxCapabilities,
): boolean {
  switch (type) {
    case "docker":
      return caps.docker.available;
    case "macos-seatbelt":
      return caps.macosSeatbelt.available;
    case "linux-bwrap":
      return caps.linuxBwrap.available;
    case "windows-sandbox":
      return caps.windowsSandbox.available;
    case "none":
      return true;
    default:
      return true;
  }
}

function getBackendUnavailableReason(
  type: SandboxType,
  caps: SandboxCapabilities,
): string {
  switch (type) {
    case "docker":
      return caps.docker.reason ?? "docker unavailable";
    case "macos-seatbelt":
      return caps.macosSeatbelt.reason ?? "macos seatbelt unavailable";
    case "linux-bwrap":
      return caps.linuxBwrap.reason ?? "linux bwrap unavailable";
    case "windows-sandbox":
      return caps.windowsSandbox.reason ?? "Windows Sandbox unavailable";
    default:
      return "backend unavailable";
  }
}

export async function resolveSandboxType(
  policy: SandboxPolicy,
): Promise<{ type: SandboxType; degraded: boolean; reason?: string }> {
  const autoFallback = policy.autoFallback ?? "startup-only";
  if (!policy.enabled) {
    log.debug("[SandboxPolicy] resolve: disabled");
    return {
      type: "none",
      degraded: false,
      reason: "sandbox policy is disabled",
    };
  }

  const caps = await getSandboxCapabilities();
  const selectedType = backendToSandboxType(policy.backend, caps.platform);
  log.debug(
    "[SandboxPolicy] resolve: backend=%s → type=%s platform=%s",
    policy.backend,
    selectedType,
    caps.platform,
  );

  if (isBackendAvailable(selectedType, caps)) {
    log.debug("[SandboxPolicy] resolve: backend %s available", selectedType);
    return { type: selectedType, degraded: false };
  }

  const reason = getBackendUnavailableReason(selectedType, caps);
  log.warn(
    "[SandboxPolicy] resolve: backend %s unavailable, reason=%s, fallback=%s",
    selectedType,
    reason,
    autoFallback,
  );

  // Emit sandbox:unavailable event so UI can notify the user
  app.emit("sandbox:unavailable", {
    reason,
    backend: selectedType,
    fallback: autoFallback,
  });

  if (autoFallback === "manual") {
    throw new SandboxError(
      `sandbox backend unavailable (manual fallback required): ${reason}`,
      SandboxErrorCode.SANDBOX_UNAVAILABLE,
    );
  }

  // 后端不可用时始终降级为 off（不阻断执行）
  return { type: "none", degraded: true, reason };
}
