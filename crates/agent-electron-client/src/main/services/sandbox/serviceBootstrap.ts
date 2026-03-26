/**
 * 沙箱服务启动
 *
 * 初始化沙箱服务并注入到 IPC handlers
 *
 * @version 1.0.0
 * @updated 2026-03-27
 */

import log from "electron-log";
import * as os from "os";
import * as path from "path";
import { app } from "electron";
import { DockerSandbox } from "./DockerSandbox";
import { PermissionManager, DEFAULT_PERMISSION_POLICY } from "./PermissionManager";
import { WorkspaceManager } from "./WorkspaceManager";
import { setSandboxService, setPermissionService } from "../../ipc/sandboxHandlers";
import type { SandboxConfig, Platform } from "@shared/types/sandbox";

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
  const platform = getPlatform();
  const homeDir = app.getPath("home");
  
  if (platform === "darwin") {
    return path.join(homeDir, ".nuwaclaw", "sandboxes");
  } else if (platform === "win32") {
    return path.join(homeDir, ".nuwaclaw", "sandboxes");
  } else {
    return path.join(homeDir, ".nuwaclaw", "sandboxes");
  }
}

/**
 * 获取默认沙箱配置
 */
function getDefaultSandboxConfig(): SandboxConfig {
  const platform = getPlatform();
  
  return {
    type: "docker",
    platform,
    enabled: true,
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
let dockerSandbox: DockerSandbox | null = null;
let permissionManager: PermissionManager | null = null;

/**
 * 启动沙箱服务
 */
export async function startSandboxService(): Promise<void> {
  log.info("[SandboxService] Starting sandbox service...");

  try {
    // 1. 创建沙箱管理器
    const config = getDefaultSandboxConfig();
    dockerSandbox = new DockerSandbox(config);
    
    // 2. 初始化沙箱
    await dockerSandbox.init();
    
    // 3. 创建权限管理器
    permissionManager = new PermissionManager(DEFAULT_PERMISSION_POLICY);
    
    // 4. 创建工作区管理器
    workspaceManager = new WorkspaceManager({
      sandboxManager: dockerSandbox,
      permissionManager,
    });
    
    // 5. 注入到 IPC
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
      isAvailable: () => dockerSandbox!.isAvailable(),
      getStatus: () => dockerSandbox!.getStatus(),
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
      deny: (requestId, reason) =>
        permissionManager!.deny(requestId, reason),
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
    
    workspaceManager = null;
    dockerSandbox = null;
    permissionManager = null;
    
    // 清除 IPC 服务注入
    setSandboxService(null as any);
    setPermissionService(null as any);
    
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
} {
  return {
    initialized: workspaceManager !== null,
    available: dockerSandbox?.isInitialized() ?? false,
    type: "docker",
    platform: getPlatform(),
  };
}

/**
 * 导出服务实例（用于高级用例）
 */
export { workspaceManager, dockerSandbox, permissionManager };
