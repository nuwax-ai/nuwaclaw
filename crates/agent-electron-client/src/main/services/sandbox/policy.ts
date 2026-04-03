import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { readSetting, writeSetting } from "../../db";
import { checkCommand } from "../system/shellEnv";
import { getResourcesPath } from "../system/dependencies";
import type {
  Platform,
  SandboxBackend,
  SandboxCapabilities,
  SandboxCapabilityItem,
  SandboxPolicy,
  SandboxType,
} from "@shared/types/sandbox";
import { SandboxError, SandboxErrorCode } from "@shared/errors/sandbox";

export const SANDBOX_POLICY_KEY = "sandbox_policy";

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  enabled: true,
  mode: "non-main",
  backend: "auto",
  fallback: "degrade_to_off",
  windows: {
    sandbox: {
      mode: "read-only",
    },
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeSandboxPolicy(input: unknown): SandboxPolicy {
  if (!isObject(input)) {
    return { ...DEFAULT_SANDBOX_POLICY };
  }

  const windows = isObject(input.windows) ? input.windows : {};
  const sandbox = isObject(windows.sandbox) ? windows.sandbox : {};

  const enabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : DEFAULT_SANDBOX_POLICY.enabled;
  const mode =
    input.mode === "off" || input.mode === "non-main" || input.mode === "all"
      ? input.mode
      : DEFAULT_SANDBOX_POLICY.mode;
  const backend: SandboxBackend =
    input.backend === "auto" ||
    input.backend === "docker" ||
    input.backend === "macos-seatbelt" ||
    input.backend === "linux-bwrap" ||
    input.backend === "windows-sandbox"
      ? input.backend
      : DEFAULT_SANDBOX_POLICY.backend;
  const fallback =
    input.fallback === "degrade_to_off" || input.fallback === "fail_closed"
      ? input.fallback
      : DEFAULT_SANDBOX_POLICY.fallback;
  const windowsMode =
    sandbox.mode === "read-only" || sandbox.mode === "workspace-write"
      ? sandbox.mode
      : DEFAULT_SANDBOX_POLICY.windows.sandbox.mode;

  return {
    enabled,
    mode,
    backend,
    fallback,
    windows: {
      sandbox: {
        mode: windowsMode,
      },
    },
  };
}

function mergeSandboxPolicy(
  current: SandboxPolicy,
  patch: Partial<SandboxPolicy>,
): SandboxPolicy {
  const merged: SandboxPolicy = {
    ...current,
    ...patch,
    windows: {
      sandbox: {
        ...current.windows.sandbox,
        ...(patch.windows?.sandbox ?? {}),
      },
    },
  };
  return normalizeSandboxPolicy(merged);
}

export function getSandboxPolicy(): SandboxPolicy {
  return normalizeSandboxPolicy(readSetting(SANDBOX_POLICY_KEY));
}

export function setSandboxPolicy(patch: Partial<SandboxPolicy>): SandboxPolicy {
  const current = getSandboxPolicy();
  const next = mergeSandboxPolicy(current, patch);
  writeSetting(SANDBOX_POLICY_KEY, next);
  log.info("[SandboxPolicy] updated:", next);
  return next;
}

function getPlatform(): Platform {
  return process.platform as Platform;
}

function getSandboxRuntimeDir(): string {
  return path.join(getResourcesPath(), "sandbox-runtime");
}

export function getBundledLinuxBwrapPath(): string | null {
  const runtimeDir = getSandboxRuntimeDir();
  const candidates = [
    path.join(runtimeDir, "bin", "bwrap"),
    path.join(runtimeDir, "linux", "bwrap"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** 仅 Windows：沙箱 helper 可执行文件名（非 win32 上不应探测 .exe 路径）。 */
const WINDOWS_SANDBOX_HELPER_NAME = "nuwax-sandbox-helper.exe" as const;

/**
 * 解析内置 Windows Sandbox helper 路径（场景仅限 Windows 客户端）。
 * 在非 Windows 上始终返回 null，避免无意义的文件探测。
 */
export function getBundledWindowsSandboxHelperPath(): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  const runtimeDir = getSandboxRuntimeDir();
  const helperRoot = path.join(getResourcesPath(), "sandbox-helper");
  const candidates = [
    path.join(runtimeDir, "bin", WINDOWS_SANDBOX_HELPER_NAME),
    path.join(runtimeDir, "windows", WINDOWS_SANDBOX_HELPER_NAME),
    path.join(helperRoot, WINDOWS_SANDBOX_HELPER_NAME),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function unavailable(reason: string): SandboxCapabilityItem {
  return { available: false, reason };
}

function getRecommendedBackend(platform: Platform): SandboxBackend {
  if (platform === "win32") return "windows-sandbox";
  if (platform === "darwin") return "macos-seatbelt";
  return "linux-bwrap";
}

export async function getSandboxCapabilities(): Promise<SandboxCapabilities> {
  const platform = getPlatform();
  const recommendedBackend = getRecommendedBackend(platform);
  const dockerAvailable = await checkCommand("docker");
  const bwrapCmdAvailable =
    platform === "linux" ? await checkCommand("bwrap") : false;
  const bundledBwrap = getBundledLinuxBwrapPath();
  const sandboxHelper = getBundledWindowsSandboxHelperPath();
  const seatbeltPath = "/usr/bin/sandbox-exec";

  const docker: SandboxCapabilityItem = dockerAvailable
    ? { available: true }
    : unavailable("docker command not found");
  const macosSeatbelt: SandboxCapabilityItem =
    platform !== "darwin"
      ? unavailable("not on macOS")
      : fs.existsSync(seatbeltPath)
        ? { available: true, binaryPath: seatbeltPath }
        : unavailable("sandbox-exec not found");
  const linuxBwrap: SandboxCapabilityItem =
    platform !== "linux"
      ? unavailable("not on Linux")
      : bwrapCmdAvailable
        ? { available: true, binaryPath: "bwrap" }
        : bundledBwrap
          ? { available: true, binaryPath: bundledBwrap }
          : unavailable("bwrap not found (system or bundled)");
  const windowsSandbox: SandboxCapabilityItem =
    platform !== "win32"
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
    if (platform === "win32") return "windows-sandbox";
    if (platform === "darwin") return "macos-seatbelt";
    return "linux-bwrap";
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
    case "wsl":
    case "firejail":
      return false;
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
  if (!policy.enabled || policy.mode === "off") {
    log.debug(
      "[SandboxPolicy] resolve: disabled (enabled=%s, mode=%s)",
      policy.enabled,
      policy.mode,
    );
    return {
      type: "none",
      degraded: false,
      reason: "sandbox policy is disabled",
    };
  }

  const caps = await getSandboxCapabilities();
  const selectedType = backendToSandboxType(policy.backend, caps.platform);
  log.debug(
    "[SandboxPolicy] resolve: backend=%s → type=%s, platform=%s",
    policy.backend,
    selectedType,
    caps.platform,
  );

  if (isBackendAvailable(selectedType, caps)) {
    log.debug("[SandboxPolicy] resolve: backend %s available", selectedType);
    return { type: selectedType, degraded: false };
  }

  const reason = getBackendUnavailableReason(selectedType, caps);
  log.debug(
    "[SandboxPolicy] resolve: backend %s unavailable, reason=%s, fallback=%s",
    selectedType,
    reason,
    policy.fallback,
  );

  if (policy.fallback === "degrade_to_off") {
    return { type: "none", degraded: true, reason };
  }

  throw new SandboxError(
    `沙箱后端不可用: ${selectedType}`,
    SandboxErrorCode.SANDBOX_UNAVAILABLE,
    { details: { selectedType, reason } },
  );
}
