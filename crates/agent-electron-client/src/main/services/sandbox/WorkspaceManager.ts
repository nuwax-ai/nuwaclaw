/**
 * 工作区管理器
 *
 * 整合 SandboxManager 和 PermissionManager，提供统一的工作区生命周期管理
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

import { EventEmitter } from "events";
import log from "electron-log";
import type {
  Workspace,
  CreateWorkspaceOptions,
  ExecuteOptions,
  ExecuteResult,
  RetentionPolicy,
  CleanupResult,
  PermissionType,
  PermissionResult,
  PermissionRequest,
  SandboxStatus,
  SandboxConfig,
  FileInfo,
} from "@shared/types/sandbox";
import { SandboxManager } from "./SandboxManager";
import { PermissionManager } from "./PermissionManager";
import {
  SandboxError,
  SandboxErrorCode,
  WorkspaceError,
  toSandboxError,
} from "@shared/errors/sandbox";

/**
 * 工作区管理器配置
 */
export interface WorkspaceManagerConfig {
  /** 沙箱管理器 */
  sandboxManager: SandboxManager;
  /** 权限管理器 */
  permissionManager: PermissionManager;
}

/**
 * 工作区管理器
 *
 * 负责协调沙箱和权限管理，提供统一的工作区操作接口
 */
export class WorkspaceManager extends EventEmitter {
  private sandboxManager: SandboxManager;
  private permissionManager: PermissionManager;
  constructor(config: WorkspaceManagerConfig) {
    super();
    this.sandboxManager = config.sandboxManager;
    this.permissionManager = config.permissionManager;

    // 转发沙箱事件
    this.forwardSandboxEvents();
  }

  // ============================================================================
  // 初始化
  // ============================================================================

  /**
   * 初始化工作区管理器
   */
  async init(): Promise<void> {
    log.info("[WorkspaceManager] Initializing...");

    try {
      await this.sandboxManager.init();
      log.info("[WorkspaceManager] Initialization complete");
    } catch (error) {
      log.error("[WorkspaceManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * 销毁工作区管理器
   */
  async destroy(): Promise<void> {
    log.info("[WorkspaceManager] Destroying...");

    try {
      await this.cleanupAll();
      await this.sandboxManager.destroy();
      this.removeAllListeners();
      log.info("[WorkspaceManager] Destruction complete");
    } catch (error) {
      log.error("[WorkspaceManager] Destruction failed:", error);
    }
  }

  // ============================================================================
  // 工作区生命周期
  // ============================================================================

  /**
   * 创建工作区
   * @param sessionId 会话 ID
   * @param options 创建选项
   */
  async create(
    sessionId: string,
    options: CreateWorkspaceOptions = {},
  ): Promise<Workspace> {
    log.info("[WorkspaceManager] Creating workspace:", sessionId);

    try {
      // 创建沙箱工作区
      const workspace = await this.sandboxManager.createWorkspace(sessionId);

      // 应用保留策略
      if (options.retention) {
        workspace.retentionPolicy = {
          ...workspace.retentionPolicy,
          ...options.retention,
        };
      }

      // 发出事件
      this.emitEvent("workspace:created", { workspace });

      log.info("[WorkspaceManager] Workspace created successfully:", sessionId);
      return workspace;
    } catch (error) {
      log.error("[WorkspaceManager] Failed to create workspace:", error);
      throw toSandboxError(
        error,
        "工作区创建失败",
        SandboxErrorCode.WORKSPACE_CREATE_FAILED,
        {
          sessionId,
        },
      );
    }
  }

  /**
   * 兼容旧接口：createWorkspace
   */
  async createWorkspace(
    sessionId: string,
    options: CreateWorkspaceOptions = {},
  ): Promise<Workspace> {
    return this.create(sessionId, options);
  }

  /**
   * 销毁工作区
   * @param sessionId 会话 ID
   * @param force 是否强制销毁
   */
  async destroyWorkspace(
    sessionId: string,
    force: boolean = false,
  ): Promise<void> {
    log.info(
      "[WorkspaceManager] Destroying workspace:",
      sessionId,
      "force:",
      force,
    );

    try {
      // 清理会话权限缓存
      this.permissionManager.clearSessionCache(sessionId);

      // 销毁沙箱工作区
      await this.sandboxManager.destroyWorkspace(sessionId);

      // 发出事件
      this.emitEvent("workspace:destroyed", {
        workspaceId: sessionId,
        sessionId,
      });

      log.info(
        "[WorkspaceManager] Workspace destroyed successfully:",
        sessionId,
      );
    } catch (error) {
      log.error("[WorkspaceManager] Failed to destroy workspace:", error);

      if (force) {
        // 强制模式：忽略错误
        log.warn("[WorkspaceManager] Force destroying, ignoring errors");
      } else {
        throw toSandboxError(
          error,
          "工作区销毁失败",
          SandboxErrorCode.WORKSPACE_DESTROY_FAILED,
          {
            sessionId,
          },
        );
      }
    }
  }

  /**
   * 获取工作区
   * @param sessionId 会话 ID
   */
  async get(sessionId: string): Promise<Workspace | undefined> {
    return this.sandboxManager.getWorkspace(sessionId);
  }

  /**
   * 兼容旧接口：getWorkspace（同步）
   */
  getWorkspace(sessionId: string): Workspace | undefined {
    return this.sandboxManager.getWorkspace(sessionId);
  }

  /**
   * 列出所有工作区
   */
  async list(): Promise<Workspace[]> {
    return this.sandboxManager.listWorkspaces();
  }

  /**
   * 兼容旧接口：listWorkspaces（同步）
   */
  listWorkspaces(): Workspace[] {
    return this.sandboxManager.listWorkspaces();
  }

  // ============================================================================
  // 工作区操作（带权限检查）
  // ============================================================================

  /**
   * 读取文件（带权限检查）
   * @param sessionId 会话 ID
   * @param path 文件路径
   */
  async readFile(sessionId: string, path: string): Promise<string> {
    // 检查权限
    await this.checkPermission(sessionId, "file:read", path);

    return this.sandboxManager.readFile(sessionId, path);
  }

  /**
   * 写入文件（带权限检查）
   * @param sessionId 会话 ID
   * @param path 文件路径
   * @param content 文件内容
   */
  async writeFile(
    sessionId: string,
    path: string,
    content: string,
  ): Promise<void> {
    // 检查权限
    await this.checkPermission(sessionId, "file:write", path);

    return this.sandboxManager.writeFile(sessionId, path, content);
  }

  /**
   * 读取目录
   * @param sessionId 会话 ID
   * @param path 目录路径
   */
  async readDir(sessionId: string, path: string): Promise<FileInfo[]> {
    // 读取目录通常视为 file:read 权限
    await this.checkPermission(sessionId, "file:read", path);

    return this.sandboxManager.readDir(sessionId, path);
  }

  /**
   * 删除文件（带权限检查）
   * @param sessionId 会话 ID
   * @param path 文件路径
   */
  async deleteFile(sessionId: string, path: string): Promise<void> {
    // 检查权限
    await this.checkPermission(sessionId, "file:delete", path);

    return this.sandboxManager.deleteFile(sessionId, path);
  }

  /**
   * 执行命令（带权限检查）
   * @param sessionId 会话 ID
   * @param command 命令
   * @param args 参数
   * @param options 执行选项
   */
  async execute(
    sessionId: string,
    command: string,
    args: string[] = [],
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    // 跳过权限检查（如果明确指定）
    if (!options.skipPermissionCheck) {
      const commandStr = `${command} ${args.join(" ")}`.trim();
      try {
        await this.checkPermission(sessionId, "command:execute", commandStr);
      } catch (error) {
        throw error;
      }
    }

    const result = await this.sandboxManager.execute(
      sessionId,
      command,
      args,
      options,
    );

    return result;
  }

  // ============================================================================
  // 权限管理
  // ============================================================================

  /**
   * 检查权限
   * @param sessionId 会话 ID
   * @param type 权限类型
   * @param target 目标资源
   */
  async checkPermission(
    sessionId: string,
    type: PermissionType,
    target: string,
  ): Promise<PermissionResult> {
    // 验证工作区存在
    const workspace = this.sandboxManager.getWorkspace(sessionId);
    if (!workspace) {
      throw new WorkspaceError(
        `工作区未找到: ${sessionId}`,
        SandboxErrorCode.WORKSPACE_NOT_FOUND,
        { sessionId },
      );
    }

    // 检查路径是否在工作区内（对于文件操作）
    if (this.isPathPermission(type)) {
      this.validatePathInWorkspace(workspace, target);
    }

    return this.permissionManager.checkPermission(sessionId, type, target);
  }

  /**
   * 请求权限
   * @param sessionId 会话 ID
   * @param type 权限类型
   * @param target 目标资源
   * @param reason 请求原因
   */
  async requestPermission(
    sessionId: string,
    type: PermissionType,
    target: string,
    reason?: string,
  ): Promise<void> {
    // 验证工作区存在
    const workspace = this.sandboxManager.getWorkspace(sessionId);
    if (!workspace) {
      throw new WorkspaceError(
        `工作区未找到: ${sessionId}`,
        SandboxErrorCode.WORKSPACE_NOT_FOUND,
        { sessionId },
      );
    }

    await this.permissionManager.requestPermission(
      sessionId,
      type,
      target,
      reason,
    );
  }

  /**
   * 批准权限请求
   * @param requestId 请求 ID
   */
  async approvePermission(requestId: string): Promise<void> {
    await this.permissionManager.approve(requestId, "user");
  }

  /**
   * 拒绝权限请求
   * @param requestId 请求 ID
   * @param reason 原因
   */
  async denyPermission(requestId: string, reason?: string): Promise<void> {
    await this.permissionManager.deny(requestId, reason);
  }

  /**
   * 获取待处理的权限请求
   * @param sessionId 可选的会话 ID 过滤
   */
  getPendingPermissionRequests(sessionId?: string): PermissionRequest[] {
    return this.permissionManager.getPendingRequests(sessionId);
  }

  // ============================================================================
  // 清理
  // ============================================================================

  /**
   * 清理过期的工作区
   */
  async cleanupExpired(): Promise<CleanupResult> {
    log.info("[WorkspaceManager] Cleaning expired workspaces...");

    const workspaces = await this.list();
    const now = Date.now();
    const result: CleanupResult = {
      deletedCount: 0,
      freedSpace: 0,
      errors: [],
    };

    for (const workspace of workspaces) {
      const policy = workspace.retentionPolicy;

      // 检查是否过期
      let shouldCleanup = false;

      if (policy.mode === "timeout" && policy.maxAge) {
        const age = now - workspace.lastAccessedAt.getTime();
        if (age > policy.maxAge) {
          shouldCleanup = true;
        }
      }

      // 检查工作区数量限制
      if (policy.maxWorkspaces && workspaces.length > policy.maxWorkspaces) {
        // 按访问时间排序，清理最旧的
        const sorted = [...workspaces].sort(
          (a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime(),
        );
        const toRemove = sorted.slice(
          0,
          workspaces.length - policy.maxWorkspaces,
        );
        if (toRemove.some((w) => w.id === workspace.id)) {
          shouldCleanup = true;
        }
      }

      if (shouldCleanup) {
        try {
          await this.destroyWorkspace(workspace.sessionId);
          result.deletedCount++;
        } catch (error) {
          result.errors.push(`清理工作区失败 ${workspace.sessionId}: ${error}`);
        }
      }
    }

    log.info("[WorkspaceManager] Cleanup complete:", result);
    this.emitEvent("cleanup:complete", { result });

    return result;
  }

  /**
   * 兼容旧接口：cleanup
   */
  async cleanup(): Promise<CleanupResult> {
    return this.cleanupExpired();
  }

  /**
   * 清理所有工作区
   */
  async cleanupAll(): Promise<void> {
    log.info("[WorkspaceManager] Cleaning all workspaces...");

    const workspaces = await this.list();

    for (const workspace of workspaces) {
      try {
        await this.destroyWorkspace(workspace.sessionId, true);
      } catch (error) {
        log.error(
          "[WorkspaceManager] Failed to clean workspace:",
          workspace.sessionId,
          error,
        );
      }
    }

    log.info("[WorkspaceManager] All workspaces cleaned");
  }

  // ============================================================================
  // 保留策略
  // ============================================================================

  /**
   * 设置保留策略
   * @param sessionId 会话 ID
   * @param policy 保留策略
   */
  async setRetentionPolicy(
    sessionId: string,
    policy: Partial<RetentionPolicy>,
  ): Promise<void> {
    const workspace = this.sandboxManager.getWorkspace(sessionId);
    if (!workspace) {
      throw new WorkspaceError(
        `工作区未找到: ${sessionId}`,
        SandboxErrorCode.WORKSPACE_NOT_FOUND,
        { sessionId },
      );
    }

    workspace.retentionPolicy = {
      ...workspace.retentionPolicy,
      ...policy,
    };
  }

  /**
   * 获取保留策略
   * @param sessionId 会话 ID
   */
  async getRetentionPolicy(sessionId: string): Promise<RetentionPolicy> {
    const workspace = this.sandboxManager.getWorkspace(sessionId);
    if (!workspace) {
      throw new WorkspaceError(
        `工作区未找到: ${sessionId}`,
        SandboxErrorCode.WORKSPACE_NOT_FOUND,
        { sessionId },
      );
    }

    return workspace.retentionPolicy;
  }

  // ============================================================================
  // 状态
  // ============================================================================

  /**
   * 获取沙箱状态
   */
  async getStatus(): Promise<SandboxStatus> {
    return this.sandboxManager.getStatus();
  }

  /**
   * 获取沙箱配置
   */
  getConfig(): SandboxConfig {
    return this.sandboxManager.getConfig();
  }

  /**
   * 检查沙箱是否可用
   */
  async isAvailable(): Promise<boolean> {
    return this.sandboxManager.isAvailable();
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 检查是否是路径权限
   */
  private isPathPermission(type: PermissionType): boolean {
    return ["file:read", "file:write", "file:delete"].includes(type);
  }

  /**
   * 验证路径在工作区内
   */
  private validatePathInWorkspace(workspace: Workspace, path: string): void {
    const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
    const normalizedRoot = workspace.rootPath.replace(/\\/g, "/").toLowerCase();

    if (!normalizedPath.startsWith(normalizedRoot)) {
      throw new SandboxError(
        `路径不在工作区内: ${path}`,
        SandboxErrorCode.PERMISSION_DENIED,
        {
          sessionId: workspace.sessionId,
          details: { path, rootPath: workspace.rootPath },
        },
      );
    }
  }

  /**
   * 转发沙箱事件
   */
  private forwardSandboxEvents(): void {
    const events = [
      "workspace:created",
      "workspace:destroyed",
      "workspace:accessed",
      "execute:start",
      "execute:complete",
      "execute:error",
      "cleanup:complete",
      "sandbox:unavailable",
      "sandbox:recovered",
    ];

    for (const event of events) {
      this.sandboxManager.on(event, (data) => {
        this.emitEvent(event, data);
      });
    }

    // 转发权限事件
    const permissionEvents = [
      "permission:requested",
      "permission:approved",
      "permission:denied",
    ];

    for (const event of permissionEvents) {
      this.permissionManager.on(event, (data) => {
        this.emitEvent(event, data);
      });
    }
  }

  /**
   * 发出事件
   */
  private emitEvent<T extends string>(event: T, data?: unknown): void {
    this.emit(event, data);
  }
}

export default WorkspaceManager;
