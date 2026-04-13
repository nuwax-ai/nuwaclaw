/**
 * CheckpointManager — 任务检查点持久化管理
 *
 * 将任务执行划分为 5 个阶段：
 *   CP0_INIT → CP1_PLAN → CP2_EXEC → CP3_VERIFY → CP4_COMPLETE
 *
 * 每个检查点状态持久化到 SQLite task_checkpoints 表，
 * 支持任务中断后从上次成功检查点恢复。
 */

import { randomUUID } from "crypto";
import { getDb } from "../../db";
import { structuredLog } from "../../bootstrap/logConfig";
import {
  CheckpointType,
  type TaskCheckpoint,
  type CheckpointStatus,
} from "@shared/types/harness";

/** 检查点执行顺序 */
const CHECKPOINT_ORDER: CheckpointType[] = [
  CheckpointType.CP0_INIT,
  CheckpointType.CP1_PLAN,
  CheckpointType.CP2_EXEC,
  CheckpointType.CP3_VERIFY,
  CheckpointType.CP4_COMPLETE,
];

interface CheckpointRow {
  id: string;
  task_id: string;
  type: string;
  status: string;
  entered_at: number;
  passed_at: number | null;
  result: string | null;
}

function rowToCheckpoint(row: CheckpointRow): TaskCheckpoint {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type as CheckpointType,
    status: row.status as CheckpointStatus,
    enteredAt: row.entered_at,
    passedAt: row.passed_at ?? null,
    result: row.result
      ? (JSON.parse(row.result) as Record<string, unknown>)
      : null,
  };
}

export class CheckpointManager {
  /**
   * 为任务创建初始检查点序列（全部 pending）
   */
  createInitialCheckpoints(taskId: string): TaskCheckpoint[] {
    const db = getDb();
    if (!db) {
      structuredLog(
        "error",
        "harness",
        "CheckpointManager: DB not initialized",
      );
      return [];
    }

    const now = Date.now();
    const checkpoints: TaskCheckpoint[] = CHECKPOINT_ORDER.map((type) => ({
      id: randomUUID(),
      taskId,
      type,
      status: "pending" as CheckpointStatus,
      enteredAt: now,
      passedAt: null,
      result: null,
    }));

    const insert = db.prepare(`
      INSERT INTO task_checkpoints (id, task_id, type, status, entered_at, passed_at, result)
      VALUES (@id, @taskId, @type, @status, @enteredAt, @passedAt, @result)
    `);

    const insertAll = db.transaction(() => {
      for (const cp of checkpoints) {
        insert.run({
          id: cp.id,
          taskId: cp.taskId,
          type: cp.type,
          status: cp.status,
          enteredAt: cp.enteredAt,
          passedAt: null,
          result: null,
        });
      }
    });

    insertAll();
    structuredLog(
      "info",
      "harness",
      `Created ${checkpoints.length} checkpoints`,
      {
        taskId,
      },
    );
    return checkpoints;
  }

  /**
   * 激活指定检查点（标记为 active）
   */
  enterCheckpoint(taskId: string, type: CheckpointType): TaskCheckpoint | null {
    const db = getDb();
    if (!db) return null;

    const now = Date.now();
    db.prepare(
      `
      UPDATE task_checkpoints
      SET status = 'active', entered_at = ?
      WHERE task_id = ? AND type = ?
    `,
    ).run(now, taskId, type);

    structuredLog("info", "harness", `Entered checkpoint ${type}`, { taskId });
    return this.getCheckpoint(taskId, type);
  }

  /**
   * 标记检查点通过
   */
  passCheckpoint(
    taskId: string,
    type: CheckpointType,
    result?: Record<string, unknown>,
  ): TaskCheckpoint | null {
    const db = getDb();
    if (!db) return null;

    const now = Date.now();
    db.prepare(
      `
      UPDATE task_checkpoints
      SET status = 'passed', passed_at = ?, result = ?
      WHERE task_id = ? AND type = ?
    `,
    ).run(now, result ? JSON.stringify(result) : null, taskId, type);

    structuredLog("info", "harness", `Passed checkpoint ${type}`, { taskId });
    return this.getCheckpoint(taskId, type);
  }

  /**
   * 标记检查点失败
   */
  failCheckpoint(
    taskId: string,
    type: CheckpointType,
    reason?: Record<string, unknown>,
  ): TaskCheckpoint | null {
    const db = getDb();
    if (!db) return null;

    db.prepare(
      `
      UPDATE task_checkpoints
      SET status = 'failed', result = ?
      WHERE task_id = ? AND type = ?
    `,
    ).run(reason ? JSON.stringify(reason) : null, taskId, type);

    structuredLog("warn", "harness", `Failed checkpoint ${type}`, { taskId });
    return this.getCheckpoint(taskId, type);
  }

  /**
   * 获取任务的所有检查点
   */
  getCheckpoints(taskId: string): TaskCheckpoint[] {
    const db = getDb();
    if (!db) return [];

    const rows = db
      .prepare(
        "SELECT * FROM task_checkpoints WHERE task_id = ? ORDER BY entered_at ASC",
      )
      .all(taskId) as CheckpointRow[];
    return rows.map(rowToCheckpoint);
  }

  /**
   * 获取指定检查点
   */
  getCheckpoint(taskId: string, type: CheckpointType): TaskCheckpoint | null {
    const db = getDb();
    if (!db) return null;

    const row = db
      .prepare("SELECT * FROM task_checkpoints WHERE task_id = ? AND type = ?")
      .get(taskId, type) as CheckpointRow | undefined;
    return row ? rowToCheckpoint(row) : null;
  }

  /**
   * 查找最后一个成功通过的检查点（断点续跑起点）
   */
  getLastPassedCheckpoint(taskId: string): TaskCheckpoint | null {
    const db = getDb();
    if (!db) return null;

    const checkpoints = this.getCheckpoints(taskId);
    const passed = checkpoints.filter((cp) => cp.status === "passed");
    if (passed.length === 0) return null;

    // 按检查点顺序排序，取最后一个
    passed.sort(
      (a, b) =>
        CHECKPOINT_ORDER.indexOf(a.type) - CHECKPOINT_ORDER.indexOf(b.type),
    );
    return passed[passed.length - 1] ?? null;
  }

  /**
   * 获取任务下一个应进入的检查点类型
   */
  getNextCheckpoint(taskId: string): CheckpointType | null {
    const lastPassed = this.getLastPassedCheckpoint(taskId);
    if (!lastPassed) return CheckpointType.CP0_INIT;

    const currentIdx = CHECKPOINT_ORDER.indexOf(lastPassed.type);
    if (currentIdx === -1 || currentIdx >= CHECKPOINT_ORDER.length - 1)
      return null;
    return CHECKPOINT_ORDER[currentIdx + 1] ?? null;
  }

  /**
   * 重置失败检查点（断点续跑前调用）
   */
  resetFailedCheckpoints(taskId: string, fromType: CheckpointType): void {
    const db = getDb();
    if (!db) return;

    const fromIdx = CHECKPOINT_ORDER.indexOf(fromType);
    const typesToReset = CHECKPOINT_ORDER.slice(fromIdx).map(String);

    const placeholders = typesToReset.map(() => "?").join(",");
    db.prepare(
      `
      UPDATE task_checkpoints
      SET status = 'pending', passed_at = NULL, result = NULL
      WHERE task_id = ? AND type IN (${placeholders}) AND status IN ('failed', 'active')
    `,
    ).run(taskId, ...typesToReset);

    structuredLog("info", "harness", `Reset checkpoints from ${fromType}`, {
      taskId,
    });
  }
}

export const checkpointManager = new CheckpointManager();
