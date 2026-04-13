/**
 * harnessHandlers — Harness 工作流 IPC handlers
 *
 * IPC channels:
 *   harness:createTask          创建任务
 *   harness:getTask             获取任务详情
 *   harness:listTasks           列出任务（可按状态过滤）
 *   harness:cancelTask          取消任务
 *   harness:resumeTask          断点续跑
 *   harness:respondApproval     响应审批请求
 *   harness:getApproval         获取审批详情
 *   harness:listPendingApprovals 列出待处理审批
 *   harness:getCheckpoints      获取任务检查点历史
 *   harness:decompose           分解任务为步骤
 */

import { ipcMain } from "electron";
import { z } from "zod";
import { structuredLog } from "../bootstrap/logConfig";
import { taskExecutor } from "../services/harness/TaskExecutor";
import { approvalGate } from "../services/harness/ApprovalGate";
import { checkpointManager } from "../services/harness/CheckpointManager";
import type { TaskStatus } from "@shared/types/harness";
import { CheckpointType } from "@shared/types/harness";

function invalidArgs(channel: string, issues: unknown) {
  structuredLog("warn", "ipc", `${channel} invalid args`, {
    data: { channel, issues: String(issues) },
  });
  return { success: false as const, error: `Invalid arguments for ${channel}` };
}

const taskStatusSchema = z.enum([
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

const checkpointTypeSchema = z.nativeEnum(CheckpointType);
const approvalDecisionSchema = z.enum(["approve", "reject"]);

export function registerHarnessHandlers(): void {
  // ---- 任务 ----

  ipcMain.handle(
    "harness:createTask",
    (
      _,
      title: unknown,
      engineType: unknown,
      sessionId?: unknown,
      metadata?: unknown,
    ) => {
      const parsed = z
        .object({
          title: z.string().min(1),
          engineType: z.string().min(1),
          sessionId: z.string().optional(),
          metadata: z.record(z.unknown()).optional(),
        })
        .safeParse({ title, engineType, sessionId, metadata });

      if (!parsed.success)
        return invalidArgs("harness:createTask", parsed.error.issues);

      try {
        const task = taskExecutor.createTask(
          parsed.data.title,
          parsed.data.engineType,
          parsed.data.sessionId,
          parsed.data.metadata,
        );
        return { success: true as const, data: task };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        structuredLog("error", "ipc", "harness:createTask error", {
          data: { error: err },
        });
        return { success: false as const, error: err };
      }
    },
  );

  ipcMain.handle("harness:getTask", (_, taskId: unknown) => {
    const parsed = z.string().min(1).safeParse(taskId);
    if (!parsed.success)
      return invalidArgs("harness:getTask", parsed.error.issues);

    const task = taskExecutor.getTask(parsed.data);
    if (!task) return { success: false as const, error: "Task not found" };
    return { success: true as const, data: task };
  });

  ipcMain.handle("harness:listTasks", (_, filter?: unknown) => {
    const parsed = z
      .object({
        status: taskStatusSchema.optional(),
        limit: z.number().int().positive().max(200).optional(),
      })
      .optional()
      .safeParse(filter);

    if (!parsed.success)
      return invalidArgs("harness:listTasks", parsed.error.issues);

    const tasks = taskExecutor.listTasks(
      parsed.data
        ? {
            status: parsed.data.status as TaskStatus | undefined,
            limit: parsed.data.limit,
          }
        : undefined,
    );
    return { success: true as const, data: tasks };
  });

  ipcMain.handle("harness:cancelTask", (_, taskId: unknown) => {
    const parsed = z.string().min(1).safeParse(taskId);
    if (!parsed.success)
      return invalidArgs("harness:cancelTask", parsed.error.issues);

    taskExecutor.cancelTask(parsed.data);
    structuredLog("info", "ipc", "harness:cancelTask", {
      taskId: parsed.data,
    });
    return { success: true as const };
  });

  ipcMain.handle(
    "harness:resumeTask",
    (_, taskId: unknown, fromCheckpoint?: unknown) => {
      const parsed = z
        .object({
          taskId: z.string().min(1),
          fromCheckpoint: checkpointTypeSchema.optional(),
        })
        .safeParse({ taskId, fromCheckpoint });

      if (!parsed.success)
        return invalidArgs("harness:resumeTask", parsed.error.issues);

      const resumeFrom =
        parsed.data.fromCheckpoint ??
        taskExecutor.getResumePoint(parsed.data.taskId);

      if (!resumeFrom) {
        return { success: false as const, error: "No resume point available" };
      }

      taskExecutor.resumeFrom(parsed.data.taskId, resumeFrom);
      structuredLog("info", "ipc", "harness:resumeTask", {
        taskId: parsed.data.taskId,
        data: { resumeFrom },
      });
      return { success: true as const, data: { resumeFrom } };
    },
  );

  // ---- 检查点 ----

  ipcMain.handle("harness:getCheckpoints", (_, taskId: unknown) => {
    const parsed = z.string().min(1).safeParse(taskId);
    if (!parsed.success)
      return invalidArgs("harness:getCheckpoints", parsed.error.issues);

    const checkpoints = checkpointManager.getCheckpoints(parsed.data);
    return { success: true as const, data: checkpoints };
  });

  // ---- 审批 ----

  ipcMain.handle(
    "harness:respondApproval",
    (_, approvalId: unknown, decision: unknown) => {
      const parsed = z
        .object({
          approvalId: z.string().min(1),
          decision: approvalDecisionSchema,
        })
        .safeParse({ approvalId, decision });

      if (!parsed.success)
        return invalidArgs("harness:respondApproval", parsed.error.issues);

      const ok = approvalGate.respondApproval(
        parsed.data.approvalId,
        parsed.data.decision,
      );

      if (!ok) {
        return {
          success: false as const,
          error: "Approval not found or already resolved",
        };
      }

      structuredLog(
        "info",
        "ipc",
        `harness:respondApproval → ${parsed.data.decision}`,
        {
          data: {
            approvalId: parsed.data.approvalId,
            decision: parsed.data.decision,
          },
        },
      );
      return { success: true as const };
    },
  );

  ipcMain.handle("harness:getApproval", (_, approvalId: unknown) => {
    const parsed = z.string().min(1).safeParse(approvalId);
    if (!parsed.success)
      return invalidArgs("harness:getApproval", parsed.error.issues);

    const approval = approvalGate.getApproval(parsed.data);
    if (!approval)
      return { success: false as const, error: "Approval not found" };
    return { success: true as const, data: approval };
  });

  ipcMain.handle("harness:listPendingApprovals", () => {
    const approvals = approvalGate.listPendingApprovals();
    return { success: true as const, data: approvals };
  });

  // ---- 任务分解 ----

  ipcMain.handle("harness:decompose", (_, taskDescription: unknown) => {
    const parsed = z.string().min(1).safeParse(taskDescription);
    if (!parsed.success)
      return invalidArgs("harness:decompose", parsed.error.issues);

    const decomposition = taskExecutor.decompose(parsed.data);
    return { success: true as const, data: decomposition };
  });

  structuredLog("info", "ipc", "Harness handlers registered");
}
