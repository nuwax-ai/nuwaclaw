/**
 * 审计日志管理器
 *
 * 记录所有沙箱操作，用于安全审计和回溯
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import log from "electron-log";

/**
 * 安全事件类型
 */
export type SecurityEventType =
  | "path_blocked"
  | "path_allowed"
  | "command_blocked"
  | "command_allowed"
  | "permission_requested"
  | "permission_approved"
  | "permission_denied"
  | "permission_auto_approved"
  | "operation_executed"
  | "operation_failed"
  | "sandbox_created"
  | "sandbox_destroyed";

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  eventType: SecurityEventType;
  operation?: string;
  target?: string;
  allowed: boolean;
  reason?: string;
  approvedBy?: "system" | "user";
  duration?: number;
  error?: string;
}

/**
 * 安全指标
 */
export interface SecurityMetrics {
  totalOperations: number;
  blockedOperations: number;
  allowedOperations: number;
  userConfirmations: number;
  autoApprovals: number;
  pathViolations: number;
  commandViolations: number;
}

/**
 * 审计日志配置
 */
export interface AuditLoggerConfig {
  logDir: string;
  maxLogSize?: number; // 最大日志文件大小 (MB)
  maxLogFiles?: number; // 最大保留日志文件数
  enableConsole?: boolean; // 是否输出到控制台
}

/**
 * 审计日志管理器
 */
export class AuditLogger extends EventEmitter {
  private config: AuditLoggerConfig;
  private logPath: string;
  private metrics: SecurityMetrics;
  private recentEvents: AuditLogEntry[] = [];
  private maxRecentEvents = 100;

  constructor(config: AuditLoggerConfig) {
    super();
    this.config = {
      maxLogSize: 10, // 默认 10MB
      maxLogFiles: 5, // 默认保留 5 个
      enableConsole: true,
      ...config,
    };

    // 确保日志目录存在
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    const date = new Date().toISOString().split("T")[0];
    this.logPath = path.join(this.config.logDir, `audit-${date}.jsonl`);

    this.metrics = {
      totalOperations: 0,
      blockedOperations: 0,
      allowedOperations: 0,
      userConfirmations: 0,
      autoApprovals: 0,
      pathViolations: 0,
      commandViolations: 0,
    };

    log.info("[AuditLogger] Initialized at:", this.logPath);
  }

  /**
   * 记录安全事件
   */
  logEvent(entry: Omit<AuditLogEntry, "id" | "timestamp">): string {
    const id = this.generateId();
    const fullEntry: AuditLogEntry = {
      ...entry,
      id,
      timestamp: new Date().toISOString(),
    };

    // 更新指标
    this.updateMetrics(fullEntry);

    // 保存到最近事件
    this.recentEvents.push(fullEntry);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }

    // 写入日志文件
    this.writeToFile(fullEntry);

    // 发送事件
    this.emit("event", fullEntry);

    if (this.config.enableConsole) {
      const status = fullEntry.allowed ? "✅" : "❌";
      log.info(
        `${status} [Audit] ${fullEntry.eventType}: ${fullEntry.target || fullEntry.operation || "N/A"}`,
      );
    }

    return id;
  }

  /**
   * 记录路径被阻止
   */
  logPathBlocked(sessionId: string, target: string, reason: string): string {
    return this.logEvent({
      sessionId,
      eventType: "path_blocked",
      target,
      allowed: false,
      reason,
    });
  }

  /**
   * 记录命令被阻止
   */
  logCommandBlocked(
    sessionId: string,
    command: string,
    reason: string,
  ): string {
    return this.logEvent({
      sessionId,
      eventType: "command_blocked",
      operation: command,
      allowed: false,
      reason,
    });
  }

  /**
   * 记录权限请求
   */
  logPermissionRequested(
    sessionId: string,
    operation: string,
    target: string,
  ): string {
    return this.logEvent({
      sessionId,
      eventType: "permission_requested",
      operation,
      target,
      allowed: false,
    });
  }

  /**
   * 记录权限批准
   */
  logPermissionApproved(
    sessionId: string,
    operation: string,
    target: string,
    approvedBy: "system" | "user",
  ): string {
    return this.logEvent({
      sessionId,
      eventType:
        approvedBy === "system"
          ? "permission_auto_approved"
          : "permission_approved",
      operation,
      target,
      allowed: true,
      approvedBy,
    });
  }

  /**
   * 记录权限拒绝
   */
  logPermissionDenied(
    sessionId: string,
    operation: string,
    target: string,
    reason?: string,
  ): string {
    return this.logEvent({
      sessionId,
      eventType: "permission_denied",
      operation,
      target,
      allowed: false,
      reason,
    });
  }

  /**
   * 记录操作执行
   */
  logOperationExecuted(
    sessionId: string,
    operation: string,
    target: string,
    duration?: number,
  ): string {
    return this.logEvent({
      sessionId,
      eventType: "operation_executed",
      operation,
      target,
      allowed: true,
      duration,
    });
  }

  /**
   * 记录操作失败
   */
  logOperationFailed(
    sessionId: string,
    operation: string,
    target: string,
    error: string,
  ): string {
    return this.logEvent({
      sessionId,
      eventType: "operation_failed",
      operation,
      target,
      allowed: false,
      error,
    });
  }

  /**
   * 获取安全指标
   */
  getMetrics(): SecurityMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取最近事件
   */
  getRecentEvents(limit?: number): AuditLogEntry[] {
    if (limit) {
      return this.recentEvents.slice(-limit);
    }
    return [...this.recentEvents];
  }

  /**
   * 获取特定会话的事件
   */
  getSessionEvents(sessionId: string): AuditLogEntry[] {
    return this.recentEvents.filter((e) => e.sessionId === sessionId);
  }

  /**
   * 导出日志到指定路径
   */
  async exportLogs(
    outputPath: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<number> {
    const entries: AuditLogEntry[] = [];

    // 读取今天和昨天的日志
    const dates = this.getLogDates(startDate, endDate);

    for (const date of dates) {
      const filePath = path.join(this.config.logDir, `audit-${date}.jsonl`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AuditLogEntry;
            if (this.shouldInclude(entry, startDate, endDate)) {
              entries.push(entry);
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }

    // 写入导出文件
    fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2));
    log.info(
      `[AuditLogger] Exported ${entries.length} entries to ${outputPath}`,
    );

    return entries.length;
  }

  /**
   * 清理过期日志
   */
  cleanup(): void {
    if (!fs.existsSync(this.config.logDir)) return;

    const files = fs
      .readdirSync(this.config.logDir)
      .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();

    // 删除超过保留数量的旧文件
    const toDelete = files.slice(this.config.maxLogFiles!);
    for (const file of toDelete) {
      const filePath = path.join(this.config.logDir, file);
      fs.unlinkSync(filePath);
      log.info("[AuditLogger] Deleted old log:", file);
    }

    // 检查并轮转当前日志文件
    this.rotateIfNeeded();
  }

  // =========================================================================
  // 私有方法
  // =========================================================================

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private updateMetrics(entry: AuditLogEntry): void {
    this.metrics.totalOperations++;

    if (!entry.allowed) {
      this.metrics.blockedOperations++;
    } else {
      this.metrics.allowedOperations++;
    }

    switch (entry.eventType) {
      case "path_blocked":
        this.metrics.pathViolations++;
        break;
      case "command_blocked":
        this.metrics.commandViolations++;
        break;
      case "permission_approved":
        this.metrics.userConfirmations++;
        break;
      case "permission_auto_approved":
        this.metrics.autoApprovals++;
        break;
    }
  }

  private writeToFile(entry: AuditLogEntry): void {
    try {
      const line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(this.logPath, line, "utf-8");
    } catch (error) {
      log.error("[AuditLogger] Failed to write to file:", error);
    }
  }

  private getLogDates(startDate?: Date, endDate?: Date): string[] {
    const dates: string[] = [];
    const now = new Date();
    const start = startDate || new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const end = endDate || now;

    let current = new Date(start);
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  private shouldInclude(
    entry: AuditLogEntry,
    startDate?: Date,
    endDate?: Date,
  ): boolean {
    const entryDate = new Date(entry.timestamp);

    if (startDate && entryDate < startDate) return false;
    if (endDate && entryDate > endDate) return false;

    return true;
  }

  private rotateIfNeeded(): void {
    if (!fs.existsSync(this.logPath)) return;

    const stats = fs.statSync(this.logPath);
    const maxSize = (this.config.maxLogSize || 10) * 1024 * 1024; // MB to bytes

    if (stats.size > maxSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rotatedPath = this.logPath.replace(".jsonl", `-${timestamp}.jsonl`);

      fs.renameSync(this.logPath, rotatedPath);
      log.info("[AuditLogger] Rotated log to:", rotatedPath);
    }
  }
}

export default AuditLogger;
