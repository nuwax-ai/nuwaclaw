/**
 * 沙箱管理器抽象基类
 *
 * 定义所有沙箱实现必须遵循的接口规范。
 * 支持的沙箱类型：Docker、macOS Seatbelt、Linux bwrap、Windows Sandbox
 *
 * @version 1.1.0
 * @updated 2026-04-03
 */

import { EventEmitter } from "events";
import type {
  SandboxConfig,
  SandboxType,
  Workspace,
  ExecuteOptions,
  ExecuteResult,
  FileInfo,
  SandboxStatus,
  CleanupResult,
  RetentionPolicy,
} from "@shared/types/sandbox";
import {
  SandboxError,
  SandboxErrorCode,
  WorkspaceError,
  isSandboxError,
} from "@shared/errors/sandbox";
import {
  createPlatformAdapter,
  isSupportedPlatform,
} from "../system/platformAdapter";

/**
 * 沙箱管理器抽象基类
 */
export abstract class SandboxManager extends EventEmitter {
  protected config: SandboxConfig;
  protected workspaces: Map<string, Workspace> = new Map();
  protected initialized: boolean = false;

  constructor(config: SandboxConfig) {
    super();
    this.config = config;
  }

  // ============================================================================
  // 抽象方法 - 子类必须实现
  // ============================================================================

  /**
   * 初始化沙箱
   * - 检查沙箱环境是否可用
   * - 准备必要的资源
   */
  abstract init(): Promise<void>;

  /**
   * 检查沙箱是否可用
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * 创建工作区
   * @param sessionId 会话 ID
   */
  abstract createWorkspace(sessionId: string): Promise<Workspace>;

  /**
   * 销毁工作区
   * @param sessionId 会话 ID
   */
  abstract destroyWorkspace(sessionId: string): Promise<void>;

  /**
   * 在沙箱中执行命令
   * @param sessionId 会话 ID
   * @param command 命令
   * @param args 参数
   * @param options 执行选项
   */
  abstract execute(
    sessionId: string,
    command: string,
    args: string[],
    options?: ExecuteOptions,
  ): Promise<ExecuteResult>;

  /**
   * 读取文件
   * @param sessionId 会话 ID
   * @param path 文件路径
   */
  abstract readFile(sessionId: string, path: string): Promise<string>;

  /**
   * 写入文件
   * @param sessionId 会话 ID
   * @param path 文件路径
   * @param content 文件内容
   */
  abstract writeFile(
    sessionId: string,
    path: string,
    content: string,
  ): Promise<void>;

  /**
   * 读取目录
   * @param sessionId 会话 ID
   * @param path 目录路径
   */
  abstract readDir(sessionId: string, path: string): Promise<FileInfo[]>;

  /**
   * 删除文件
   * @param sessionId 会话 ID
   * @param path 文件路径
   */
  abstract deleteFile(sessionId: string, path: string): Promise<void>;

  /**
   * 清理所有资源
   */
  abstract cleanup(): Promise<CleanupResult>;

  // ============================================================================
  // 具体方法 - 通用实现
  // ============================================================================

  /**
   * 获取工作区
   * @param sessionId 会话 ID
   */
  getWorkspace(sessionId: string): Workspace | undefined {
    return this.workspaces.get(sessionId);
  }

  /**
   * 列出所有工作区
   */
  listWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * 检查工作区是否存在
   * @param sessionId 会话 ID
   */
  hasWorkspace(sessionId: string): boolean {
    return this.workspaces.has(sessionId);
  }

  /**
   * 获取活跃工作区数量
   */
  getActiveWorkspaceCount(): number {
    return this.workspaces.size;
  }

  /**
   * 获取沙箱状态
   */
  async getStatus(): Promise<SandboxStatus> {
    const available = await this.isAvailable();

    return {
      available,
      type: this.config.type,
      platform: this.config.platform,
      activeWorkspaces: this.workspaces.size,
    };
  }

  /**
   * 获取沙箱配置
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 更新工作区最后访问时间
   * @param sessionId 会话 ID
   */
  protected updateLastAccessed(sessionId: string): void {
    const workspace = this.workspaces.get(sessionId);
    if (workspace) {
      workspace.lastAccessedAt = new Date();
    }
  }

  /**
   * 验证工作区存在
   * @param sessionId 会话 ID
   * @throws WorkspaceError 如果工作区不存在
   */
  protected validateWorkspaceExists(sessionId: string): Workspace {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      throw new WorkspaceError(
        `工作区未找到: ${sessionId}`,
        SandboxErrorCode.WORKSPACE_NOT_FOUND,
        { sessionId },
      );
    }
    return workspace;
  }

  /**
   * 验证路径在工作区内
   * @param workspace 工作区
   * @param path 要验证的路径
   * @throws SandboxError 如果路径在工作区外
   */
  protected validatePathInWorkspace(workspace: Workspace, path: string): void {
    const normalizedPath = this.normalizePath(path);
    const normalizedRoot = this.normalizePath(workspace.rootPath);

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
   * 规范化路径
   * @param path 路径
   */
  protected normalizePath(path: string): string {
    // 子类可以覆盖此方法以处理平台特定的路径规范化
    return path.replace(/\\/g, "/").toLowerCase();
  }

  /**
   * 生成工作区 ID
   * @param sessionId 会话 ID
   */
  protected generateWorkspaceId(sessionId: string): string {
    return `workspace-${sessionId}-${Date.now()}`;
  }

  /**
   * 创建默认保留策略
   */
  protected createDefaultRetentionPolicy(): RetentionPolicy {
    return {
      mode: "timeout",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
      maxWorkspaces: 10,
      preserveOnError: false,
    };
  }

  /**
   * 发出事件
   */
  protected emitEvent<T extends string>(event: T, data?: unknown): void {
    this.emit(event, data);
  }

  /**
   * 销毁（清理所有资源）
   */
  async destroy(): Promise<void> {
    try {
      await this.cleanup();
      this.workspaces.clear();
      this.initialized = false;
      this.removeAllListeners();
    } catch (error) {
      // 记录错误但不抛出，确保清理继续
      console.error("[SandboxManager] Destroy error:", error);
    }
  }

  // ============================================================================
  // 静态工具方法
  // ============================================================================

  /**
   * 检测当前平台
   */
  static detectPlatform(): NodeJS.Platform {
    if (isSupportedPlatform(process.platform)) {
      return createPlatformAdapter(process.platform).platform;
    }
    return process.platform;
  }

  /**
   * 获取推荐的沙箱类型（按平台）
   */
  static getRecommendedSandboxType(): SandboxType {
    if (!isSupportedPlatform(process.platform)) {
      return "none";
    }
    return createPlatformAdapter(process.platform).getRecommendedSandboxType();
  }

  /**
   * 解析内存限制字符串
   * @param memoryLimit 内存限制（如 "2g", "512m"）
   * @returns 字节数
   */
  static parseMemoryLimit(memoryLimit: string): number {
    const match = memoryLimit.match(/^(\d+(?:\.\d+)?)([kmg]?)$/i);
    if (!match) {
      return 0;
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case "k":
        return Math.floor(value * 1024);
      case "m":
        return Math.floor(value * 1024 * 1024);
      case "g":
        return Math.floor(value * 1024 * 1024 * 1024);
      default:
        return Math.floor(value);
    }
  }

  /**
   * 格式化内存大小
   * @param bytes 字节数
   * @returns 格式化字符串（如 "2 GB"）
   */
  static formatMemory(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * 判断是否为沙箱错误
   */
  static isSandboxError(error: unknown): error is SandboxError {
    return isSandboxError(error);
  }
}

/**
 * 沙箱管理器类型
 */
export type SandboxManagerType = typeof SandboxManager;

export default SandboxManager;
