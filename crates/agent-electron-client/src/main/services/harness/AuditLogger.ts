/**
 * AuditLogger — 审计日志持久化
 *
 * 将关键操作写入 SQLite audit_logs 表，用于安全审计与问题追溯。
 *
 * 审计事件类型（event_type）约定：
 *   task.created / task.completed / task.failed / task.cancelled
 *   checkpoint.entered / checkpoint.passed / checkpoint.failed
 *   approval.requested / approval.approved / approval.rejected / approval.expired
 *   permission.granted / permission.denied / permission.always
 *   tool.called / tool.blocked
 *   session.started / session.ended
 *   engine.crash / engine.restart
 */

import { randomUUID } from "crypto";
import log from "electron-log";
import { getDb } from "../../db";
import type {
  AuditLogEntry,
  AuditSeverity,
  ActorType,
} from "@shared/types/harness";
import { structuredLog } from "../../bootstrap/logConfig";

interface AuditLogRow {
  id: string;
  event_type: string;
  task_id: string | null;
  session_id: string | null;
  actor_type: string;
  resource_type: string | null;
  resource_path: string | null;
  action: string | null;
  severity: string;
  data: string | null;
  created_at: number;
}

function rowToEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    taskId: row.task_id ?? null,
    sessionId: row.session_id ?? null,
    actorType: row.actor_type as ActorType,
    resourceType: row.resource_type ?? null,
    resourcePath: row.resource_path ?? null,
    action: row.action ?? null,
    severity: row.severity as AuditSeverity,
    data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

export interface AuditEventParams {
  eventType: string;
  actorType?: ActorType;
  taskId?: string;
  sessionId?: string;
  resourceType?: string;
  resourcePath?: string;
  action?: string;
  severity?: AuditSeverity;
  data?: Record<string, unknown>;
}

export class AuditLogger {
  private readonly logTag = "[AuditLogger]";

  // ==================== 写入 ====================

  /**
   * 记录审计事件
   */
  log(params: AuditEventParams): void {
    const db = getDb();
    if (!db) return;

    const now = Date.now();
    const entry: AuditLogEntry = {
      id: randomUUID(),
      eventType: params.eventType,
      actorType: params.actorType ?? "system",
      taskId: params.taskId ?? null,
      sessionId: params.sessionId ?? null,
      resourceType: params.resourceType ?? null,
      resourcePath: params.resourcePath ?? null,
      action: params.action ?? null,
      severity: params.severity ?? "info",
      data: params.data ?? null,
      createdAt: now,
    };

    try {
      db.prepare(
        `
        INSERT INTO audit_logs
          (id, event_type, task_id, session_id, actor_type, resource_type, resource_path, action, severity, data, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        entry.id,
        entry.eventType,
        entry.taskId,
        entry.sessionId,
        entry.actorType,
        entry.resourceType,
        entry.resourcePath,
        entry.action,
        entry.severity,
        entry.data ? JSON.stringify(entry.data) : null,
        entry.createdAt,
      );

      // 高严重度事件同时写入结构化日志
      if (entry.severity === "error" || entry.severity === "critical") {
        structuredLog(
          entry.severity === "critical" ? "error" : "warn",
          "harness",
          `Audit: ${entry.eventType}`,
          {
            taskId: entry.taskId ?? undefined,
            sessionId: entry.sessionId ?? undefined,
            data: entry.data ?? undefined,
          },
        );
      }
    } catch (e) {
      log.warn(`${this.logTag} Failed to write audit log:`, e);
    }
  }

  // ==================== 便捷方法 ====================

  taskCreated(taskId: string, engineType: string, title: string): void {
    this.log({
      eventType: "task.created",
      actorType: "user",
      taskId,
      severity: "info",
      data: { engineType, title },
    });
  }

  taskCompleted(taskId: string, durationMs: number): void {
    this.log({
      eventType: "task.completed",
      actorType: "agent",
      taskId,
      severity: "info",
      data: { durationMs },
    });
  }

  taskFailed(taskId: string, error: string): void {
    this.log({
      eventType: "task.failed",
      actorType: "system",
      taskId,
      severity: "warn",
      data: { error },
    });
  }

  approvalRequested(
    approvalId: string,
    taskId: string,
    operationType: string,
    priority: string,
  ): void {
    this.log({
      eventType: "approval.requested",
      actorType: "system",
      taskId,
      severity: "info",
      data: { approvalId, operationType, priority },
    });
  }

  approvalDecided(
    approvalId: string,
    taskId: string,
    decision: "approved" | "rejected" | "expired",
    respondedBy?: ActorType,
  ): void {
    this.log({
      eventType: `approval.${decision}`,
      actorType: respondedBy ?? "user",
      taskId,
      severity: decision === "rejected" ? "warn" : "info",
      data: { approvalId, decision },
    });
  }

  permissionEvent(
    sessionId: string,
    eventType: "permission.granted" | "permission.denied" | "permission.always",
    toolName?: string,
    resourcePath?: string,
  ): void {
    this.log({
      eventType,
      actorType: "user",
      sessionId,
      resourceType: "tool",
      resourcePath: resourcePath ?? toolName,
      action: toolName,
      severity: eventType === "permission.denied" ? "warn" : "info",
    });
  }

  engineCrash(sessionId: string, engineType: string, error: string): void {
    this.log({
      eventType: "engine.crash",
      actorType: "system",
      sessionId,
      severity: "error",
      data: { engineType, error },
    });
  }

  toolBlocked(sessionId: string, toolName: string, reason: string): void {
    this.log({
      eventType: "tool.blocked",
      actorType: "system",
      sessionId,
      resourceType: "tool",
      action: toolName,
      severity: "warn",
      data: { toolName, reason },
    });
  }

  // ==================== 查询 ====================

  query(options?: {
    eventType?: string;
    taskId?: string;
    sessionId?: string;
    severity?: AuditSeverity;
    sinceMs?: number;
    limit?: number;
  }): AuditLogEntry[] {
    const db = getDb();
    if (!db) return [];

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.eventType) {
      conditions.push("event_type = ?");
      params.push(options.eventType);
    }
    if (options?.taskId) {
      conditions.push("task_id = ?");
      params.push(options.taskId);
    }
    if (options?.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }
    if (options?.severity) {
      conditions.push("severity = ?");
      params.push(options.severity);
    }
    if (options?.sinceMs) {
      conditions.push("created_at >= ?");
      params.push(Date.now() - options.sinceMs);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options?.limit ?? 100;

    const rows = db
      .prepare(
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params, limit) as AuditLogRow[];

    return rows.map(rowToEntry);
  }

  /**
   * 清理 N 天前的旧审计日志
   */
  cleanup(olderThanDays = 90): number {
    const db = getDb();
    if (!db) return 0;

    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const result = db
      .prepare("DELETE FROM audit_logs WHERE created_at < ?")
      .run(cutoff);

    if (result.changes > 0) {
      log.info(
        `${this.logTag} Cleaned up ${result.changes} audit log entries older than ${olderThanDays} days`,
      );
    }
    return result.changes;
  }
}

export const auditLogger = new AuditLogger();
