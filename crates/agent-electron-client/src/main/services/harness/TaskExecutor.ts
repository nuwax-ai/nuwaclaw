/**
 * TaskExecutor — 多步骤任务分解与执行
 *
 * 职责：
 * 1. 将自然语言任务分解为结构化步骤（通过 ACP prompt）
 * 2. 按依赖顺序执行步骤，每步绑定 Checkpoint
 * 3. 支持断点续跑（从上次通过的 Checkpoint 恢复）
 * 4. 集成 ApprovalGate 对高风险步骤请求审批
 */

import { randomUUID } from "crypto";
import log from "electron-log";
import { getDb } from "../../db";
import { checkpointManager } from "./CheckpointManager";
import {
  CheckpointType,
  type HarnessTask,
  type TaskStatus,
} from "@shared/types/harness";

export type StepType = "read" | "write" | "execute" | "review" | "approve";
export type RiskLevel = "low" | "medium" | "high";

export interface TaskStep {
  id: string;
  description: string;
  type: StepType;
  dependsOn: string[];
  checkpoint: CheckpointType;
  riskLevel: RiskLevel;
  /** 步骤执行结果（运行时填充） */
  result?: unknown;
  status?: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface TaskDecomposition {
  steps: TaskStep[];
  estimatedDuration?: number;
}

export interface ExecutionContext {
  taskId: string;
  sessionId: string;
  engineType: string;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  engine_type: string;
  session_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  metadata: string | null;
}

function rowToTask(row: TaskRow): HarnessTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    engineType: row.engine_type,
    sessionId: row.session_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : null,
  };
}

/** 高风险操作的关键词匹配，用于自动提升 riskLevel */
const HIGH_RISK_PATTERNS = [
  /git\s+push/i,
  /rm\s+-r/i,
  /sudo\s/i,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM/i,
  /format\s+(disk|drive)/i,
  /mkfs/i,
];

export class TaskExecutor {
  private readonly logTag = "[TaskExecutor]";

  // ==================== 任务 CRUD ====================

  createTask(
    title: string,
    engineType: string,
    sessionId?: string,
    metadata?: Record<string, unknown>,
  ): HarnessTask {
    const db = getDb();
    if (!db) throw new Error("Database not initialized");

    const now = Date.now();
    const task: HarnessTask = {
      id: randomUUID(),
      title,
      status: "pending",
      engineType,
      sessionId: sessionId ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      metadata: metadata ?? null,
    };

    db.prepare(
      `
      INSERT INTO tasks (id, title, status, engine_type, session_id, created_at, updated_at, completed_at, metadata)
      VALUES (@id, @title, @status, @engineType, @sessionId, @createdAt, @updatedAt, @completedAt, @metadata)
    `,
    ).run({
      id: task.id,
      title: task.title,
      status: task.status,
      engineType: task.engineType,
      sessionId: task.sessionId ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: null,
      metadata: task.metadata ? JSON.stringify(task.metadata) : null,
    });

    // 创建初始检查点序列
    checkpointManager.createInitialCheckpoints(task.id);

    log.info(`${this.logTag} Created task ${task.id}: "${title}"`);
    return task;
  }

  getTask(taskId: string): HarnessTask | null {
    const db = getDb();
    if (!db) return null;

    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | TaskRow
      | undefined;
    return row ? rowToTask(row) : null;
  }

  listTasks(filter?: { status?: TaskStatus; limit?: number }): HarnessTask[] {
    const db = getDb();
    if (!db) return [];

    let sql = "SELECT * FROM tasks";
    const params: unknown[] = [];

    if (filter?.status) {
      sql += " WHERE status = ?";
      params.push(filter.status);
    }
    sql += " ORDER BY created_at DESC";
    if (filter?.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    const rows = db.prepare(sql).all(...params) as TaskRow[];
    return rows.map(rowToTask);
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const db = getDb();
    if (!db) return;

    const now = Date.now();
    const completedAt =
      status === "completed" || status === "failed" || status === "cancelled"
        ? now
        : null;

    db.prepare(
      `
      UPDATE tasks SET status = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `,
    ).run(status, now, completedAt, taskId);

    log.info(`${this.logTag} Task ${taskId} status → ${status}`);
  }

  cancelTask(taskId: string): void {
    this.updateTaskStatus(taskId, "cancelled");
  }

  // ==================== 步骤分解 ====================

  /**
   * 将任务描述分解为结构化执行步骤。
   * 当前实现：基于规则的启发式分解，后续可接入 LLM 规划。
   */
  decompose(task: string): TaskDecomposition {
    // 启发式分解：按句子拆分，分配类型和风险级别
    const sentences = task
      .split(/[。.！!？?；;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const steps: TaskStep[] = sentences.map((sentence, idx) => {
      const type = this.inferStepType(sentence);
      const riskLevel = this.inferRiskLevel(sentence, type);
      // 简单线性依赖：每步依赖前一步
      const dependsOn = idx > 0 ? [String(idx - 1)] : [];
      // 映射到检查点：前 20% → CP1_PLAN，后 20% → CP3_VERIFY，中间 → CP2_EXEC
      const ratio = idx / Math.max(sentences.length - 1, 1);
      let checkpoint: CheckpointType;
      if (ratio <= 0.2) checkpoint = CheckpointType.CP1_PLAN;
      else if (ratio >= 0.8) checkpoint = CheckpointType.CP3_VERIFY;
      else checkpoint = CheckpointType.CP2_EXEC;

      return {
        id: String(idx),
        description: sentence,
        type,
        dependsOn,
        checkpoint,
        riskLevel,
        status: "pending",
      };
    });

    log.info(`${this.logTag} Decomposed task into ${steps.length} step(s)`);
    return { steps };
  }

  private inferStepType(text: string): StepType {
    if (/读取|查看|获取|列出|搜索|read|get|list|search|find/i.test(text))
      return "read";
    if (/写入|创建|生成|新建|write|create|generate/i.test(text)) return "write";
    if (/执行|运行|启动|execute|run|start|deploy/i.test(text)) return "execute";
    if (/审核|检查|验证|review|check|verify/i.test(text)) return "review";
    if (/确认|批准|approve|confirm/i.test(text)) return "approve";
    return "execute";
  }

  private inferRiskLevel(text: string, type: StepType): RiskLevel {
    if (type === "read") return "low";
    // 检查高风险关键词
    if (HIGH_RISK_PATTERNS.some((p) => p.test(text))) return "high";
    if (type === "execute" || type === "approve") return "medium";
    return "low";
  }

  // ==================== 断点续跑 ====================

  /**
   * 获取任务的断点续跑起点。
   * 返回 null 表示任务已完成或无法续跑。
   */
  getResumePoint(taskId: string): CheckpointType | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    if (task.status === "completed" || task.status === "cancelled") return null;

    return checkpointManager.getNextCheckpoint(taskId);
  }

  /**
   * 标记任务从指定检查点续跑（重置后续失败检查点）
   */
  resumeFrom(taskId: string, fromCheckpoint: CheckpointType): void {
    const task = this.getTask(taskId);
    if (!task) {
      log.warn(`${this.logTag} resumeFrom: task ${taskId} not found`);
      return;
    }

    checkpointManager.resetFailedCheckpoints(taskId, fromCheckpoint);
    this.updateTaskStatus(taskId, "running");
    log.info(
      `${this.logTag} Task ${taskId} resuming from checkpoint ${fromCheckpoint}`,
    );
  }

  // ==================== 步骤执行（框架） ====================

  /**
   * 执行单个步骤（框架实现，实际执行由 ACP Engine 完成）。
   * 返回步骤结果，调用方根据结果决定是否继续或请求审批。
   */
  async executeStep(
    step: TaskStep,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    log.info(
      `${this.logTag} Executing step ${step.id} (${step.type}, risk=${step.riskLevel}) for task ${ctx.taskId}`,
    );

    // 进入对应检查点
    checkpointManager.enterCheckpoint(ctx.taskId, step.checkpoint);

    try {
      // 实际执行由上层（ACP Engine）完成，此处返回 pending 结果
      // 上层在执行完成后调用 completeStep()
      return {
        stepId: step.id,
        success: true,
        output: { status: "dispatched", checkpoint: step.checkpoint },
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      checkpointManager.failCheckpoint(ctx.taskId, step.checkpoint, {
        error,
        stepId: step.id,
      });
      return { stepId: step.id, success: false, error };
    }
  }

  /**
   * 标记步骤完成，更新检查点状态。
   */
  completeStep(taskId: string, step: TaskStep, result?: unknown): void {
    checkpointManager.passCheckpoint(taskId, step.checkpoint, {
      stepId: step.id,
      output: result,
    });
    log.info(`${this.logTag} Step ${step.id} completed for task ${taskId}`);
  }

  /**
   * 标记步骤失败，更新检查点状态。
   */
  failStep(taskId: string, step: TaskStep, error: string): void {
    checkpointManager.failCheckpoint(taskId, step.checkpoint, {
      stepId: step.id,
      error,
    });
    this.updateTaskStatus(taskId, "failed");
    log.warn(
      `${this.logTag} Step ${step.id} failed for task ${taskId}: ${error}`,
    );
  }
}

export const taskExecutor = new TaskExecutor();
