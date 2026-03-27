/**
 * 沙箱服务启动
 *
 * 初始化沙箱服务并注入到 IPC handlers
 *
 * @version 1.1.0
 * @updated 2026-03-27
 */

import log from "electron-log";
import * as os from "os";
import * as path from "path";
import { app } from "electron";
import { DockerSandbox } from "./DockerSandbox";
import { CommandSandbox } from "./CommandSandbox";
import { PermissionManager, DEFAULT_PERMISSION_POLICY } from "./PermissionManager";
import { WorkspaceManager } from "./WorkspaceManager";
import type { SandboxManager } from "./SandboxManager";
import {
  setSandboxControlService,
  setSandboxService,
  setPermissionService,
} from "../../ipc/sandboxHandlers";
import type {
  SandboxConfig,
  SandboxPolicy,
  SandboxCapabilities,
  Platform,
  SandboxType,
} from "@shared/types/sandbox";
import {
  DEFAULT_SANDBOX_POLICY,
  getBundledLinuxBwrapPath,
  getBundledWindowsCodexHelperPath,
  getSandboxCapabilities,
  getSandboxPolicy,
  resolveSandboxType,
  setSandboxPolicy,
} from "./policy";

/**
 * 获取当前平台
 */
function getPlatform(): Platform {
  return os.platform() as Platform;
}

/**
 * 获取沙箱工作区根目录
 */
function getWorkspaceRoot(): string {
  const homeDir = app.getPath("home");
  return path.join(homeDir, ".nuwaclaw", "sandboxes");
}

/**
 * 获取默认沙箱配置
 */
function getDefaultSandboxConfig(
  type: SandboxType,
): SandboxConfig & { dockerImage: string } {
  const platform = getPlatform();

  return {
    type,
    platform,
    enabled: type !== "none",
    workspaceRoot: getWorkspaceRoot(),
    memoryLimit: "2g",
    cpuLimit: 2,
    diskQuota: "10g",
    networkEnabled: true,
    dockerImage: "nuwax/sandbox-base:latest",
    readOnly: false,
  };
}

/**
 * 沙箱服务实例
 */
let workspaceManager: WorkspaceManager | null = null;
let sandboxManager: SandboxManager | null = null;
let permissionManager: PermissionManager | null = null;
let lastPolicy: SandboxPolicy = DEFAULT_SANDBOX_POLICY;
let lastCapabilities: SandboxCapabilities | null = null;
let activeSandboxType: SandboxType = "none";
let degraded: boolean = false;
let degradeReason: string | undefined;

function createSandboxManager(type: SandboxType): SandboxManager {
  const config = getDefaultSandboxConfig(type);
  if (type === "docker") {
    return new DockerSandbox(config);
  }

  return new CommandSandbox(config, {
    linuxBwrapPath: getBundledLinuxBwrapPath() ?? undefined,
    windowsCodexHelperPath: getBundledWindowsCodexHelperPath() ?? undefined,
    windowsCodexMode: lastPolicy.windows.codex.mode,
    windowsCodexPrivateDesktop: lastPolicy.windows.codex.privateDesktop,
  });
}

function setupControlService(): void {
  setSandboxControlService({
    async getPolicy() {
      return getSandboxPolicy();
    },
    async setPolicy(patch) {
      const nextPolicy = setSandboxPolicy(patch);
      await stopSandboxService();
      await startSandboxService();
      return nextPolicy;
    },
    async getCapabilities() {
      return getSandboxCapabilities();
    },
    async setup(params) {
      const mode = params?.windows?.codex?.mode ?? "unelevated";
      const helperPath = getBundledWindowsCodexHelperPath();
      if (!helperPath) {
        return {
          success: false,
          message: "Windows Codex helper 不存在，请先执行 prepare:sandbox-runtime",
        };
      }
      return {
        success: true,
        message: `Windows Codex helper 就绪（mode=${mode}，helper=${helperPath}）`,
      };
    },
  });
}

/**
 * 启动沙箱服务
 */
export async function startSandboxService(): Promise<void> {
  log.info("[SandboxService] Starting sandbox service...");

  try {
    lastPolicy = getSandboxPolicy();
    lastCapabilities = await getSandboxCapabilities();
    const resolved = await resolveSandboxType(lastPolicy);
    activeSandboxType = resolved.type;
    degraded = resolved.degraded;
    degradeReason = resolved.reason;
    sandboxManager = createSandboxManager(activeSandboxType);
    await sandboxManager.init();

    permissionManager = new PermissionManager(DEFAULT_PERMISSION_POLICY);
    workspaceManager = new WorkspaceManager({
      sandboxManager,
      permissionManager,
    });

    setSandboxService({
      createWorkspace: (sessionId, options) =>
        workspaceManager!.createWorkspace(sessionId, options),
      destroyWorkspace: (sessionId) =>
        workspaceManager!.destroyWorkspace(sessionId),
      listWorkspaces: () => workspaceManager!.listWorkspaces(),
      getWorkspace: (sessionId) => workspaceManager!.getWorkspace(sessionId),
      execute: (sessionId, command, args, options) =>
        workspaceManager!.execute(sessionId, command, args, options),
      readFile: (sessionId, filePath) =>
        workspaceManager!.readFile(sessionId, filePath),
      writeFile: (sessionId, filePath, content) =>
        workspaceManager!.writeFile(sessionId, filePath, content),
      isAvailable: () => sandboxManager!.isAvailable(),
      getStatus: async () => {
        const status = await sandboxManager!.getStatus();
        return {
          ...status,
          backend: lastPolicy.backend,
          degraded,
          reason: degradeReason,
          capabilities: lastCapabilities ?? undefined,
        };
      },
      cleanup: () => workspaceManager!.cleanup(),
    });

    setPermissionService({
      checkPermission: (sessionId, type, target) =>
        permissionManager!.checkPermission(sessionId, type, target),
      requestPermission: (sessionId, type, target, reason) =>
        permissionManager!.requestPermission(sessionId, type, target, reason),
      getPendingRequests: (sessionId) =>
        permissionManager!.getPendingRequests(sessionId),
      approve: (requestId, approvedBy, reason) =>
        permissionManager!.approve(requestId, approvedBy, reason),
      deny: (requestId, reason) => permissionManager!.deny(requestId, reason),
    });

    setupControlService();
    log.info("[SandboxService] backend started:", {
      type: activeSandboxType,
      backend: lastPolicy.backend,
      degraded,
      reason: degradeReason,
    });
    log.info("[SandboxService] Sandbox service started successfully");
  } catch (error) {
    log.error("[SandboxService] Failed to start sandbox service:", error);
    throw error;
  }
}

/**
 * 停止沙箱服务
 */
export async function stopSandboxService(): Promise<void> {
  log.info("[SandboxService] Stopping sandbox service...");

  try {
    if (workspaceManager) {
      await workspaceManager.cleanup();
    }
    if (sandboxManager) {
      await sandboxManager.destroy();
    }

    workspaceManager = null;
    sandboxManager = null;
    permissionManager = null;

    setSandboxService(null);
    setPermissionService(null);
    setupControlService();

    log.info("[SandboxService] Sandbox service stopped");
  } catch (error) {
    log.error("[SandboxService] Failed to stop sandbox service:", error);
    throw error;
  }
}

/**
 * 获取沙箱服务状态
 */
export function getSandboxServiceStatus(): {
  initialized: boolean;
  available: boolean;
  type: string;
  platform: string;
  backend: string;
  degraded: boolean;
  reason?: string;
} {
  return {
    initialized: workspaceManager !== null || sandboxManager !== null,
    available: sandboxManager?.isInitialized() ?? false,
    type: activeSandboxType,
    platform: getPlatform(),
    backend: lastPolicy.backend,
    degraded,
    reason: degradeReason,
  };
}

/**
 * 导出服务实例（用于高级用例）
 */
export { workspaceManager, sandboxManager, permissionManager };
