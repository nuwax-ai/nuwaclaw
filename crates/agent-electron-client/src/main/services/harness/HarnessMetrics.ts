/**
 * HarnessMetrics — Harness 工作流指标采集
 *
 * 指标存入 SQLite harness_metrics 表，用于：
 *   - 任务完成率（衡量引擎质量）
 *   - 平均任务时长（性能基线）
 *   - Checkpoint 通过率（可靠性）
 *   - 审批响应时间（UX 指标）
 *   - 错误类型分布（稳定性诊断）
 */

import { randomUUID } from "crypto";
import { getDb } from "../../db";
import type { HarnessMetric } from "@shared/types/harness";
import { structuredLog } from "../../bootstrap/logConfig";

interface MetricRow {
  id: string;
  metric_name: string;
  value: number;
  labels: string | null;
  recorded_at: number;
}

function rowToMetric(row: MetricRow): HarnessMetric {
  return {
    id: row.id,
    metricName: row.metric_name,
    value: row.value,
    labels: row.labels
      ? (JSON.parse(row.labels) as Record<string, string>)
      : null,
    recordedAt: row.recorded_at,
  };
}

// ==================== 内置指标名常量 ====================

export const METRIC = {
  TASK_COMPLETED: "task.completed",
  TASK_FAILED: "task.failed",
  TASK_CANCELLED: "task.cancelled",
  TASK_DURATION_MS: "task.duration_ms",
  CHECKPOINT_PASSED: "checkpoint.passed",
  CHECKPOINT_FAILED: "checkpoint.failed",
  APPROVAL_RESPONSE_MS: "approval.response_ms",
  APPROVAL_REJECTED: "approval.rejected",
  APPROVAL_APPROVED: "approval.approved",
  RECOVERY_RETRY: "recovery.retry",
  RECOVERY_ABORT: "recovery.abort",
  STEP_COMPLETED: "step.completed",
  STEP_FAILED: "step.failed",
} as const;

export type MetricName = (typeof METRIC)[keyof typeof METRIC];

export class HarnessMetrics {
  // ==================== 记录指标 ====================

  /**
   * 记录单个指标值
   */
  record(
    metricName: string,
    value: number,
    labels?: Record<string, string>,
  ): void {
    const db = getDb();
    if (!db) return;

    const now = Date.now();
    try {
      db.prepare(
        `
        INSERT INTO harness_metrics (id, metric_name, value, labels, recorded_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        randomUUID(),
        metricName,
        value,
        labels ? JSON.stringify(labels) : null,
        now,
      );

      structuredLog(
        "debug",
        "harness",
        `Metric recorded: ${metricName}=${value}`,
        {
          data: { metricName, value, labels },
        },
      );
    } catch (e) {
      structuredLog(
        "warn",
        "harness",
        `Failed to record metric: ${metricName}`,
        {
          data: {
            metricName,
            error: e instanceof Error ? e.message : String(e),
          },
        },
      );
    }
  }

  /**
   * 记录计数（值 +1）
   */
  increment(metricName: string, labels?: Record<string, string>): void {
    this.record(metricName, 1, labels);
  }

  // ==================== 任务生命周期指标 ====================

  recordTaskCompleted(
    taskId: string,
    engineType: string,
    durationMs: number,
  ): void {
    this.increment(METRIC.TASK_COMPLETED, { taskId, engineType });
    this.record(METRIC.TASK_DURATION_MS, durationMs, { taskId, engineType });
    structuredLog("info", "harness", "Task completed", {
      taskId,
      data: { engineType, durationMs },
    });
  }

  recordTaskFailed(
    taskId: string,
    engineType: string,
    errorType?: string,
  ): void {
    this.increment(METRIC.TASK_FAILED, {
      taskId,
      engineType,
      ...(errorType ? { errorType } : {}),
    });
    structuredLog("warn", "harness", "Task failed", {
      taskId,
      data: { engineType, errorType },
    });
  }

  recordTaskCancelled(taskId: string): void {
    this.increment(METRIC.TASK_CANCELLED, { taskId });
  }

  // ==================== 检查点指标 ====================

  recordCheckpointPassed(taskId: string, checkpointType: string): void {
    this.increment(METRIC.CHECKPOINT_PASSED, { taskId, checkpointType });
  }

  recordCheckpointFailed(taskId: string, checkpointType: string): void {
    this.increment(METRIC.CHECKPOINT_FAILED, { taskId, checkpointType });
  }

  // ==================== 审批指标 ====================

  recordApprovalApproved(
    approvalId: string,
    responseMs: number,
    priority: string,
  ): void {
    this.increment(METRIC.APPROVAL_APPROVED, { approvalId, priority });
    this.record(METRIC.APPROVAL_RESPONSE_MS, responseMs, {
      approvalId,
      priority,
      decision: "approve",
    });
  }

  recordApprovalRejected(
    approvalId: string,
    responseMs: number,
    priority: string,
  ): void {
    this.increment(METRIC.APPROVAL_REJECTED, { approvalId, priority });
    this.record(METRIC.APPROVAL_RESPONSE_MS, responseMs, {
      approvalId,
      priority,
      decision: "reject",
    });
  }

  // ==================== 恢复指标 ====================

  recordRecoveryRetry(taskId: string, errorType: string): void {
    this.increment(METRIC.RECOVERY_RETRY, { taskId, errorType });
  }

  recordRecoveryAbort(taskId: string, errorType: string): void {
    this.increment(METRIC.RECOVERY_ABORT, { taskId, errorType });
  }

  // ==================== 查询 ====================

  /**
   * 查询最近 N 条指标记录
   */
  query(
    metricName?: string,
    options?: { limit?: number; sinceMs?: number },
  ): HarnessMetric[] {
    const db = getDb();
    if (!db) return [];

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (metricName) {
      conditions.push("metric_name = ?");
      params.push(metricName);
    }
    if (options?.sinceMs) {
      conditions.push("recorded_at >= ?");
      params.push(Date.now() - options.sinceMs);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options?.limit ?? 100;

    const rows = db
      .prepare(
        `SELECT * FROM harness_metrics ${where} ORDER BY recorded_at DESC LIMIT ?`,
      )
      .all(...params, limit) as MetricRow[];

    return rows.map(rowToMetric);
  }

  /**
   * 按指标名汇总：计数、总和、平均值
   */
  summarize(
    metricName: string,
    sinceMs?: number,
  ): { count: number; sum: number; avg: number; min: number; max: number } {
    const db = getDb();
    if (!db) return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };

    const params: unknown[] = [metricName];
    let where = "WHERE metric_name = ?";
    if (sinceMs) {
      where += " AND recorded_at >= ?";
      params.push(Date.now() - sinceMs);
    }

    const row = db
      .prepare(
        `SELECT COUNT(*) as count, SUM(value) as sum, AVG(value) as avg,
                MIN(value) as min, MAX(value) as max
         FROM harness_metrics ${where}`,
      )
      .get(...params) as {
      count: number;
      sum: number | null;
      avg: number | null;
      min: number | null;
      max: number | null;
    };

    return {
      count: row.count,
      sum: row.sum ?? 0,
      avg: row.avg ?? 0,
      min: row.min ?? 0,
      max: row.max ?? 0,
    };
  }

  /**
   * 清理 N 天前的旧指标（防止 DB 无限增长）
   */
  cleanup(olderThanDays = 30): number {
    const db = getDb();
    if (!db) return 0;

    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const result = db
      .prepare("DELETE FROM harness_metrics WHERE recorded_at < ?")
      .run(cutoff);

    if (result.changes > 0) {
      structuredLog(
        "info",
        "harness",
        `Cleaned up ${result.changes} metric records`,
        {
          data: { deletedCount: result.changes, olderThanDays },
        },
      );
    }
    return result.changes;
  }
}

export const harnessMetrics = new HarnessMetrics();
