/**
 * 沙箱 IPC 通道
 *
 * 提供沙箱工作区管理的 IPC 接口
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

import { ipcMain } from "electron";
import log from "electron-log";
import type {
  Workspace,
  CreateWorkspaceOptions,
  ExecuteOptions,
  ExecuteResult,
  FileInfo,
  PermissionType,
  PermissionResult,
  PermissionRequest,
  CleanupResult,
  SandboxStatus,
} from "@shared/types/sandbox";
import {
  SandboxError,
  SandboxErrorCode,
  isSandboxError,
} from "@shared/errors/sandbox";

// 服务单例（在服务实现完成后注入）
let sandboxService: {
  createWorkspace(
    sessionId: string,
    options?: CreateWorkspaceOptions,
  ): Promise<Workspace>;
  destroyWorkspace(sessionId: string): Promise<void>;
  listWorkspaces(): Workspace[];
  getWorkspace(sessionId: string): Workspace | undefined;
  execute(
    sessionId: string,
    command: string,
    args: string[],
    options?: ExecuteOptions,
  ): Promise<ExecuteResult>;
  readFile(sessionId: string, path: string): Promise<string>;
  writeFile(sessionId: string, path: string, content: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  getStatus(): Promise<SandboxStatus>;
  cleanup(): Promise<CleanupResult>;
} | null = null;

let permissionService: {
  checkPermission(
    sessionId: string,
    type: PermissionType,
    target: string,
  ): Promise<PermissionResult>;
  requestPermission(
    sessionId: string,
    type: PermissionType,
    target: string,
    reason?: string,
  ): Promise<unknown>;
  getPendingRequests(sessionId?: string): PermissionRequest[];
  approve(
    requestId: string,
    approvedBy?: "user" | "system",
    reason?: string,
  ): Promise<void>;
  deny(requestId: string, reason?: string): Promise<void>;
} | null = null;

/**
 * 设置沙箱服务实例
 */
export function setSandboxService(service: typeof sandboxService): void {
  sandboxService = service;
  log.info("[IPC] Sandbox service injected");
}

/**
 * 设置权限服务实例
 */
export function setPermissionService(service: typeof permissionService): void {
  permissionService = service;
  log.info("[IPC] Permission service injected");
}

/**
 * 获取沙箱服务（带检查）
 */
function getSandboxService(): NonNullable<typeof sandboxService> {
  if (!sandboxService) {
    throw new SandboxError(
      "沙箱服务未初始化",
      SandboxErrorCode.SANDBOX_UNAVAILABLE,
    );
  }
  return sandboxService;
}

/**
 * 获取权限服务（带检查）
 */
function getPermissionService(): NonNullable<typeof permissionService> {
  if (!permissionService) {
    throw new SandboxError("权限服务未初始化", SandboxErrorCode.INTERNAL_ERROR);
  }
  return permissionService;
}

/**
 * 错误处理包装器
 */
function handleError(
  error: unknown,
  operation: string,
): { success: false; error: string; code?: string } {
  log.error(`[IPC] sandbox:${operation} failed:`, error);

  if (isSandboxError(error)) {
    return {
      success: false,
      error: error.getUserMessage(),
      code: error.code,
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 注册沙箱 IPC 通道
 */
export function registerSandboxHandlers(): void {
  // ============================================================================
  // 工作区管理
  // ============================================================================

  /**
   * 创建工作区
   * @channel sandbox:create
   * @param sessionId 会话 ID
   * @param options 创建选项
   */
  ipcMain.handle(
    "sandbox:create",
    async (_, sessionId: string, options?: CreateWorkspaceOptions) => {
      log.info("[IPC] sandbox:create:", { sessionId, options });
      try {
        const service = getSandboxService();
        const workspace = await service.createWorkspace(sessionId, options);
        return { success: true, data: workspace };
      } catch (error) {
        return handleError(error, "create");
      }
    },
  );

  /**
   * 销毁工作区
   * @channel sandbox:destroy
   * @param sessionId 会话 ID
   */
  ipcMain.handle("sandbox:destroy", async (_, sessionId: string) => {
    log.info("[IPC] sandbox:destroy:", { sessionId });
    try {
      const service = getSandboxService();
      await service.destroyWorkspace(sessionId);
      return { success: true };
    } catch (error) {
      return handleError(error, "destroy");
    }
  });

  /**
   * 列出所有工作区
   * @channel sandbox:list
   */
  ipcMain.handle("sandbox:list", async () => {
    log.info("[IPC] sandbox:list");
    try {
      const service = getSandboxService();
      const workspaces = service.listWorkspaces();
      return { success: true, data: workspaces };
    } catch (error) {
      return handleError(error, "list");
    }
  });

  /**
   * 获取工作区信息
   * @channel sandbox:info
   * @param sessionId 会话 ID
   */
  ipcMain.handle("sandbox:info", async (_, sessionId: string) => {
    log.info("[IPC] sandbox:info:", { sessionId });
    try {
      const service = getSandboxService();
      const workspace = service.getWorkspace(sessionId);

      if (!workspace) {
        return {
          success: false,
          error: `工作区未找到: ${sessionId}`,
          code: SandboxErrorCode.WORKSPACE_NOT_FOUND,
        };
      }

      return { success: true, data: workspace };
    } catch (error) {
      return handleError(error, "info");
    }
  });

  // ============================================================================
  // 命令执行
  // ============================================================================

  /**
   * 执行命令
   * @channel sandbox:execute
   * @param sessionId 会话 ID
   * @param command 命令
   * @param args 参数
   * @param options 执行选项
   */
  ipcMain.handle(
    "sandbox:execute",
    async (
      _,
      sessionId: string,
      command: string,
      args: string[],
      options?: ExecuteOptions,
    ) => {
      log.info("[IPC] sandbox:execute:", { sessionId, command, args, options });
      try {
        const service = getSandboxService();
        const result = await service.execute(sessionId, command, args, options);
        return { success: true, data: result };
      } catch (error) {
        return handleError(error, "execute");
      }
    },
  );

  // ============================================================================
  // 文件操作
  // ============================================================================

  /**
   * 读取文件
   * @channel sandbox:readFile
   * @param sessionId 会话 ID
   * @param path 文件路径
   */
  ipcMain.handle(
    "sandbox:readFile",
    async (_, sessionId: string, path: string) => {
      log.info("[IPC] sandbox:readFile:", { sessionId, path });
      try {
        const service = getSandboxService();
        const content = await service.readFile(sessionId, path);
        return { success: true, data: content };
      } catch (error) {
        return handleError(error, "readFile");
      }
    },
  );

  /**
   * 写入文件
   * @channel sandbox:writeFile
   * @param sessionId 会话 ID
   * @param path 文件路径
   * @param content 文件内容
   */
  ipcMain.handle(
    "sandbox:writeFile",
    async (_, sessionId: string, path: string, content: string) => {
      log.info("[IPC] sandbox:writeFile:", { sessionId, path });
      try {
        const service = getSandboxService();
        await service.writeFile(sessionId, path, content);
        return { success: true };
      } catch (error) {
        return handleError(error, "writeFile");
      }
    },
  );

  // ============================================================================
  // 权限管理
  // ============================================================================

  /**
   * 检查权限
   * @channel sandbox:checkPermission
   * @param sessionId 会话 ID
   * @param type 权限类型
   * @param target 目标资源
   */
  ipcMain.handle(
    "sandbox:checkPermission",
    async (_, sessionId: string, type: PermissionType, target: string) => {
      log.info("[IPC] sandbox:checkPermission:", { sessionId, type, target });
      try {
        const service = getPermissionService();
        const result = await service.checkPermission(sessionId, type, target);
        return { success: true, data: result };
      } catch (error) {
        return handleError(error, "checkPermission");
      }
    },
  );

  /**
   * 请求权限
   * @channel sandbox:requestPermission
   * @param sessionId 会话 ID
   * @param type 权限类型
   * @param target 目标资源
   * @param reason 请求原因
   */
  ipcMain.handle(
    "sandbox:requestPermission",
    async (
      _,
      sessionId: string,
      type: PermissionType,
      target: string,
      reason?: string,
    ) => {
      log.info("[IPC] sandbox:requestPermission:", {
        sessionId,
        type,
        target,
        reason,
      });
      try {
        const service = getPermissionService();
        const permission = await service.requestPermission(
          sessionId,
          type,
          target,
          reason,
        );
        return { success: true, data: permission };
      } catch (error) {
        return handleError(error, "requestPermission");
      }
    },
  );

  /**
   * 获取待审批权限列表
   * @channel sandbox:getPendingPermissions
   * @param sessionId 可选的会话 ID 过滤
   */
  ipcMain.handle(
    "sandbox:getPendingPermissions",
    async (_, sessionId?: string) => {
      log.info("[IPC] sandbox:getPendingPermissions:", { sessionId });
      try {
        const service = getPermissionService();
        const requests = service.getPendingRequests(sessionId);
        return { success: true, data: requests };
      } catch (error) {
        return handleError(error, "getPendingPermissions");
      }
    },
  );

  /**
   * 批准权限请求
   * @channel sandbox:approvePermission
   * @param requestId 请求 ID
   * @param reason 原因
   */
  ipcMain.handle(
    "sandbox:approvePermission",
    async (_, requestId: string, reason?: string) => {
      log.info("[IPC] sandbox:approvePermission:", { requestId, reason });
      try {
        const service = getPermissionService();
        await service.approve(requestId, "user", reason);
        return { success: true };
      } catch (error) {
        return handleError(error, "approvePermission");
      }
    },
  );

  /**
   * 拒绝权限请求
   * @channel sandbox:denyPermission
   * @param requestId 请求 ID
   * @param reason 原因
   */
  ipcMain.handle(
    "sandbox:denyPermission",
    async (_, requestId: string, reason?: string) => {
      log.info("[IPC] sandbox:denyPermission:", { requestId, reason });
      try {
        const service = getPermissionService();
        await service.deny(requestId, reason);
        return { success: true };
      } catch (error) {
        return handleError(error, "denyPermission");
      }
    },
  );

  // ============================================================================
  // 清理与状态
  // ============================================================================

  /**
   * 清理资源
   * @channel sandbox:cleanup
   */
  ipcMain.handle("sandbox:cleanup", async () => {
    log.info("[IPC] sandbox:cleanup");
    try {
      const service = getSandboxService();
      const result = await service.cleanup();
      return { success: true, data: result };
    } catch (error) {
      return handleError(error, "cleanup");
    }
  });

  /**
   * 获取沙箱状态
   * @channel sandbox:status
   */
  ipcMain.handle("sandbox:status", async () => {
    log.info("[IPC] sandbox:status");
    try {
      const service = getSandboxService();
      const status = await service.getStatus();
      return { success: true, data: status };
    } catch (error) {
      return handleError(error, "status");
    }
  });

  log.info("[IPC] Sandbox handlers registered");
}
