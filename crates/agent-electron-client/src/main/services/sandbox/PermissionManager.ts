/**
 * 权限管理器
 *
 * 管理沙箱操作权限，包括：
 * - 自动批准策略
 * - 需要确认的操作
 * - 禁止的操作
 * - 用户确认流程
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

import { EventEmitter } from "events";
const uuidv4 = () =>
  Math.random().toString(36).substring(2) + Date.now().toString(36);
import log from "electron-log";
import type {
  PermissionType,
  PermissionPolicy,
  PermissionResult,
  PermissionRequest,
  Permission,
} from "@shared/types/sandbox";
import {
  SandboxError,
  SandboxErrorCode,
  PermissionError,
} from "@shared/errors/sandbox";

/**
 * 默认权限策略
 */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  // 自动批准的权限类型
  autoApprove: ["file:read"],

  // 需要确认的权限类型
  requireConfirm: [
    "file:write",
    "file:delete",
    "command:execute",
    "network:access",
    "network:download",
    "package:install:npm",
    "package:install:python",
  ],

  // 禁止的权限类型
  denyList: ["package:install:system"],

  // 只允许工作区内操作
  workspaceOnly: true,

  // 安全命令白名单
  safeCommands: [
    // Node.js 相关
    "node",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "bun",

    // Python 相关
    "python",
    "python3",
    "pip",
    "pip3",
    "uv",

    // Rust 相关
    "cargo",
    "rustc",
    "rustup",

    // 构建工具
    "make",
    "cmake",

    // Git
    "git",

    // 通用工具
    "ls",
    "cat",
    "head",
    "tail",
    "grep",
    "find",
    "mkdir",
    "touch",
    "cp",
    "mv",
    "echo",
    "pwd",
    "which",
    "env",
    "date",
  ],
};

/**
 * 危险命令黑名单
 * 注意：在沙箱内 rm -rf 是允许的，因为沙箱是隔离的
 */
export const DANGEROUS_COMMANDS = [
  // 权限提升（沙箱内也不允许）
  "sudo",
  "su",
  "chmod 777",
  "chown",

  // 系统包管理（可能需要 root）
  "apt-get install",
  "apt install",
  "yum install",
  "dnf install",
  "brew install",
  "pacman -S",
  "snap install",

  // 网络危险操作
  "nc -l",
  "netcat",
  "nmap",
  "masscan",
];

/**
 * 权限管理器
 */
export class PermissionManager extends EventEmitter {
  private policy: PermissionPolicy;
  private pendingRequests: Map<string, PermissionRequest> = new Map();
  private approvedCache: Map<string, Permission> = new Map();
  private deniedCache: Set<string> = new Set();

  constructor(policy: Partial<PermissionPolicy> = {}) {
    super();
    this.policy = { ...DEFAULT_PERMISSION_POLICY, ...policy };
  }

  // ============================================================================
  // 权限检查
  // ============================================================================

  /**
   * 检查权限
   * @param sessionId 会话 ID
   * @param type 权限类型
   * @param target 目标资源
   * @returns 权限检查结果
   */
  async checkPermission(
    sessionId: string,
    type: PermissionType,
    target: string,
  ): Promise<PermissionResult> {
    log.info("[PermissionManager] Checking permission:", {
      sessionId,
      type,
      target,
    });

    // 检查是否在禁止列表
    if (this.policy.denyList.includes(type)) {
      log.warn("[PermissionManager] Permission denied:", type);
      return {
        allowed: false,
        reason: `权限类型 ${type} 被安全策略禁止`,
      };
    }

    // 检查是否是危险操作
    const dangerCheck = this.checkDangerousOperation(type, target);
    if (dangerCheck.isDangerous) {
      log.warn("[PermissionManager] Dangerous operation detected:", target);
      return {
        allowed: false,
        reason: dangerCheck.reason || "Unknown",
      };
    }

    // 检查缓存
    const cacheKey = this.getCacheKey(sessionId, type, target);

    // 检查是否已批准
    if (this.approvedCache.has(cacheKey)) {
      log.info("[PermissionManager] Using cached approval");
      return { allowed: true, reason: "Approved (cached)" };
    }

    // 检查是否已拒绝
    if (this.deniedCache.has(cacheKey)) {
      log.info("[PermissionManager] Using cached rejection");
      return { allowed: false, reason: "Denied (cached)" };
    }

    // 检查是否在自动批准列表
    if (this.policy.autoApprove.includes(type)) {
      // 如果设置了 workspaceOnly，检查目标是否在工作区内
      if (this.policy.workspaceOnly && this.isPathPermission(type)) {
        // 这个检查由 WorkspaceManager 在执行时进行
      }

      // 自动批准
      const permission = this.createPermission(
        sessionId,
        type,
        target,
        "system",
      );
      this.approvedCache.set(cacheKey, permission);

      log.info("[PermissionManager] Auto-approved:", type);
      return { allowed: true, reason: "Auto-approved" };
    }

    // 检查是否需要确认
    if (this.policy.requireConfirm.includes(type)) {
      // 对于命令执行，检查是否是安全命令
      if (type === "command:execute") {
        const command = target.split(" ")[0];
        if (this.policy.safeCommands.includes(command)) {
          const permission = this.createPermission(
            sessionId,
            type,
            target,
            "policy",
          );
          this.approvedCache.set(cacheKey, permission);

          log.info("[PermissionManager] Safe command auto-approved:", command);
          return { allowed: true, reason: "Safe command" };
        }
      }

      // 需要用户确认
      const request = await this.createRequest(sessionId, type, target);

      log.info("[PermissionManager] User confirmation required:", request.id);
      return {
        allowed: false,
        reason: "需要用户确认",
        requestId: request.id,
      };
    }

    // 默认拒绝
    return {
      allowed: false,
      reason: "权限类型未定义",
    };
  }

  /**
   * 请求权限
   * @param sessionId 会话 ID
   * @param type 权限类型
   * @param target 目标资源
   * @param reason 请求原因
   * @returns 权限对象
   */
  async requestPermission(
    sessionId: string,
    type: PermissionType,
    target: string,
    reason?: string,
  ): Promise<Permission> {
    log.info("[PermissionManager] Requesting permission:", {
      sessionId,
      type,
      target,
      reason,
    });

    // 先检查权限
    const result = await this.checkPermission(sessionId, type, target);

    if (result.allowed) {
      // 已批准，返回缓存的权限
      const cacheKey = this.getCacheKey(sessionId, type, target);
      const cached = this.approvedCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      // 创建新的权限对象
      return this.createPermission(sessionId, type, target, "system");
    }

    // 需要用户确认
    const request = await this.createRequest(sessionId, type, target, reason);

    // 等待用户响应
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(
          new PermissionError("权限请求超时", {
            sessionId,
            details: { requestId: request.id },
          }),
        );
      }, 60000); // 60 秒超时

      this.once(`permission:${request.id}`, (permission: Permission) => {
        clearTimeout(timeout);

        if (permission.approvedBy === "denied") {
          reject(
            new PermissionError("权限被拒绝", {
              sessionId,
              details: { requestId: request.id, reason: permission.reason },
            }),
          );
        } else {
          resolve(permission);
        }
      });
    });
  }

  // ============================================================================
  // 权限审批
  // ============================================================================

  /**
   * 批准权限请求
   * @param requestId 请求 ID
   * @param approvedBy 批准来源
   * @param reason 原因
   */
  async approve(
    requestId: string,
    approvedBy: "user" | "system" = "user",
    reason?: string,
  ): Promise<void> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new SandboxError("请求未找到", SandboxErrorCode.PERMISSION_DENIED, {
        details: { requestId },
      });
    }

    // 创建权限对象
    const permission = this.createPermission(
      request.sessionId,
      request.type,
      request.target,
      approvedBy,
      reason,
    );

    // 缓存批准
    const cacheKey = this.getCacheKey(
      request.sessionId,
      request.type,
      request.target,
    );
    this.approvedCache.set(cacheKey, permission);

    // 更新请求状态
    request.status = "approved";

    // 从待处理列表中移除
    this.pendingRequests.delete(requestId);

    // 发出事件
    this.emitEvent("permission:approved", { permission });
    this.emit(`permission:${requestId}`, permission);

    log.info("[PermissionManager] Permission approved:", requestId);
  }

  /**
   * 拒绝权限请求
   * @param requestId 请求 ID
   * @param reason 原因
   */
  async deny(requestId: string, reason?: string): Promise<void> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new SandboxError("请求未找到", SandboxErrorCode.PERMISSION_DENIED, {
        details: { requestId },
      });
    }

    // 缓存拒绝
    const cacheKey = this.getCacheKey(
      request.sessionId,
      request.type,
      request.target,
    );
    this.deniedCache.add(cacheKey);

    // 更新请求状态
    request.status = "denied";

    // 创建拒绝的权限对象
    const permission = this.createPermission(
      request.sessionId,
      request.type,
      request.target,
      "denied",
      reason,
    );

    // 从待处理列表中移除
    this.pendingRequests.delete(requestId);

    // 发出事件
    this.emitEvent("permission:denied", {
      requestId,
      sessionId: request.sessionId,
      reason,
    });
    this.emit(`permission:${requestId}`, permission);

    log.info("[PermissionManager] Permission rejected:", requestId);
  }

  /**
   * 批量批准权限请求
   * @param requestIds 请求 ID 列表
   */
  async approveBatch(requestIds: string[]): Promise<void> {
    for (const requestId of requestIds) {
      await this.approve(requestId, "user");
    }
  }

  // ============================================================================
  // 待处理请求
  // ============================================================================

  /**
   * 获取待处理的权限请求
   * @param sessionId 可选的会话 ID 过滤
   */
  getPendingRequests(sessionId?: string): PermissionRequest[] {
    const requests = Array.from(this.pendingRequests.values());

    if (sessionId) {
      return requests.filter((r) => r.sessionId === sessionId);
    }

    return requests;
  }

  /**
   * 获取待处理请求的数量
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  // ============================================================================
  // 缓存管理
  // ============================================================================

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.approvedCache.clear();
    this.deniedCache.clear();
    log.info("[PermissionManager] Cache cleared");
  }

  /**
   * 清除会话相关的缓存
   * @param sessionId 会话 ID
   */
  clearSessionCache(sessionId: string): void {
    // 清除批准缓存
    for (const [key, permission] of this.approvedCache) {
      if (permission.sessionId === sessionId) {
        this.approvedCache.delete(key);
      }
    }

    // 清除拒绝缓存
    for (const key of this.deniedCache) {
      if (key.startsWith(sessionId)) {
        this.deniedCache.delete(key);
      }
    }

    // 移除待处理请求
    for (const [requestId, request] of this.pendingRequests) {
      if (request.sessionId === sessionId) {
        this.pendingRequests.delete(requestId);
      }
    }

    log.info("[PermissionManager] Session cache cleared:", sessionId);
  }

  // ============================================================================
  // 策略管理
  // ============================================================================

  /**
   * 获取当前策略
   */
  getPolicy(): PermissionPolicy {
    return { ...this.policy };
  }

  /**
   * 更新策略
   * @param policy 新的策略（部分）
   */
  updatePolicy(policy: Partial<PermissionPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    log.info("[PermissionManager] Policy updated");
  }

  /**
   * 添加安全命令
   * @param command 命令
   */
  addSafeCommand(command: string): void {
    if (!this.policy.safeCommands.includes(command)) {
      this.policy.safeCommands.push(command);
      log.info("[PermissionManager] Safe command added:", command);
    }
  }

  /**
   * 移除安全命令
   * @param command 命令
   */
  removeSafeCommand(command: string): void {
    const index = this.policy.safeCommands.indexOf(command);
    if (index !== -1) {
      this.policy.safeCommands.splice(index, 1);
      log.info("[PermissionManager] Safe command removed:", command);
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 创建权限请求
   */
  private async createRequest(
    sessionId: string,
    type: PermissionType,
    target: string,
    reason?: string,
  ): Promise<PermissionRequest> {
    const request: PermissionRequest = {
      id: uuidv4(),
      sessionId,
      type,
      target,
      reason,
      requestedAt: new Date(),
      status: "pending",
    };

    this.pendingRequests.set(request.id, request);

    // 发出请求事件
    this.emitEvent("permission:requested", { request });

    return request;
  }

  /**
   * 创建权限对象
   */
  private createPermission(
    sessionId: string,
    type: PermissionType,
    target: string,
    approvedBy: "system" | "user" | "policy" | "denied",
    reason?: string,
  ): Permission {
    return {
      id: uuidv4(),
      type,
      target,
      sessionId,
      approvedBy,
      timestamp: new Date(),
      reason,
    };
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(
    sessionId: string,
    type: PermissionType,
    target: string,
  ): string {
    return `${sessionId}:${type}:${target}`;
  }

  /**
   * 检查是否是路径权限
   */
  private isPathPermission(type: PermissionType): boolean {
    return ["file:read", "file:write", "file:delete"].includes(type);
  }

  /**
   * 检查危险操作
   */
  private checkDangerousOperation(
    type: PermissionType,
    target: string,
  ): { isDangerous: boolean; reason?: string } {
    const lowerTarget = target.toLowerCase();

    // 检查危险命令
    for (const dangerous of DANGEROUS_COMMANDS) {
      // Check with word boundaries to avoid partial matches
      const escapedDangerous = dangerous.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const dangerousPattern = new RegExp(
        `(^|\\s|/|\\b)${escapedDangerous}(\\s|/|$|\\b)`,
        "i",
      );
      if (dangerousPattern.test(lowerTarget)) {
        return {
          isDangerous: true,
          reason: `检测到危险操作: ${dangerous}`,
        };
      }
    }

    // 检查敏感路径
    if (this.isPathPermission(type)) {
      // 检查 SSH 目录
      if (lowerTarget.includes(".ssh") || lowerTarget.includes("/.ssh")) {
        return {
          isDangerous: true,
          reason: "禁止访问 SSH 目录",
        };
      }

      // 检查系统配置文件
      // Check specific sensitive /etc paths
      const sensitiveEtcPaths = [
        "/etc/passwd",
        "/etc/shadow",
        "/etc/sudoers",
        "/etc/group",
      ];
      if (sensitiveEtcPaths.some((path) => lowerTarget === path)) {
        return {
          isDangerous: true,
          reason: "禁止访问系统配置目录",
        };
      }
    }

    return { isDangerous: false };
  }

  /**
   * 发出事件
   */
  private emitEvent<T extends string>(event: T, data?: unknown): void {
    this.emit(event, data);
  }
}

export default PermissionManager;
