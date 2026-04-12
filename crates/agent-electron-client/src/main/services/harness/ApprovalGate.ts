/**
 * ApprovalGate — Human-in-the-Loop 审批门控
 *
 * 触发条件（参考 v-next 计划）：
 *   - file:delete  删除超过 5 个文件 → high
 *   - command:execute  git push / rm -rf / sudo → high
 *   - network:call  下载外部资源 → medium
 *   - package:install  安装 npm/pip 包 → low
 *
 * 工作流：
 *   1. requestApproval() — 创建审批记录、推送事件到 renderer、启动超时计时器
 *   2. 用户在 UI 点击 approve/reject → respondApproval()
 *   3. waitForApproval() — 挂起直到用户响应或超时
 */

import { randomUUID } from "crypto";
import { BrowserWindow } from "electron";
import log from "electron-log";
import { getDb } from "../../db";
import {
  type ApprovalRequest,
  type ApprovalDecision,
  type ApprovalPriority,
  type ApprovalRule,
} from "@shared/types/harness";

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** 内置审批规则 */
const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  {
    operationType: "command:execute",
    matchPatterns: ["git push", "rm -rf", "rm -r", "sudo ", "mkfs", "format "],
    priority: "high",
    timeoutSeconds: 60,
  },
  {
    operationType: "file:delete",
    thresholdCount: 5,
    priority: "high",
    timeoutSeconds: 60,
  },
  {
    operationType: "network:call",
    matchPatterns: ["download", "wget", "curl "],
    priority: "medium",
    timeoutSeconds: 60,
  },
  {
    operationType: "package:install",
    matchPatterns: ["npm install", "pip install", "yarn add", "pnpm add"],
    priority: "low",
    timeoutSeconds: 30,
  },
];

interface ApprovalRow {
  id: string;
  task_id: string;
  type: string;
  priority: string;
  title: string;
  description: string | null;
  context: string | null;
  status: string;
  decision: string | null;
  created_at: number;
  responded_at: number | null;
  expires_at: number | null;
}

function rowToApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    priority: row.priority as ApprovalPriority,
    title: row.title,
    description: row.description ?? null,
    context: row.context
      ? (JSON.parse(row.context) as Record<string, unknown>)
      : null,
    status: row.status as ApprovalRequest["status"],
    decision: (row.decision as ApprovalDecision | null) ?? null,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

export class ApprovalGate {
  private readonly logTag = "[ApprovalGate]";
  private pending = new Map<string, PendingApproval>();
  private rules: ApprovalRule[] = [...DEFAULT_APPROVAL_RULES];

  // ==================== 规则匹配 ====================

  /**
   * 检查操作是否需要审批，返回匹配的规则（无匹配返回 null）
   */
  matchRule(
    operationType: string,
    description: string,
    fileCount?: number,
  ): ApprovalRule | null {
    for (const rule of this.rules) {
      if (rule.operationType !== operationType) continue;

      // 数量阈值
      if (rule.thresholdCount !== undefined) {
        if ((fileCount ?? 0) >= rule.thresholdCount) return rule;
        continue;
      }

      // 关键词匹配
      if (rule.matchPatterns && rule.matchPatterns.length > 0) {
        if (
          rule.matchPatterns.some((p) =>
            description.toLowerCase().includes(p.toLowerCase()),
          )
        ) {
          return rule;
        }
        continue;
      }

      // 无条件匹配（operationType 相同即触发）
      return rule;
    }
    return null;
  }

  // ==================== 创建审批 ====================

  /**
   * 创建审批请求并推送事件到 renderer。
   * 返回审批 ID，调用 waitForApproval() 挂起等待结果。
   */
  createApproval(
    taskId: string,
    rule: ApprovalRule,
    title: string,
    description?: string,
    context?: Record<string, unknown>,
  ): ApprovalRequest {
    const db = getDb();
    if (!db) throw new Error("Database not initialized");

    const now = Date.now();
    const timeoutMs = (rule.timeoutSeconds ?? 60) * 1000;
    const request: ApprovalRequest = {
      id: randomUUID(),
      taskId,
      type: rule.operationType,
      priority: rule.priority,
      title,
      description: description ?? null,
      context: context ?? null,
      status: "pending",
      decision: null,
      createdAt: now,
      respondedAt: null,
      expiresAt: now + timeoutMs,
    };

    db.prepare(
      `
      INSERT INTO approval_requests
        (id, task_id, type, priority, title, description, context, status, decision, created_at, responded_at, expires_at)
      VALUES
        (@id, @taskId, @type, @priority, @title, @description, @context, @status, @decision, @createdAt, @respondedAt, @expiresAt)
    `,
    ).run({
      id: request.id,
      taskId: request.taskId,
      type: request.type,
      priority: request.priority,
      title: request.title,
      description: request.description ?? null,
      context: request.context ? JSON.stringify(request.context) : null,
      status: request.status,
      decision: null,
      createdAt: request.createdAt,
      respondedAt: null,
      expiresAt: request.expiresAt ?? null,
    });

    log.info(
      `${this.logTag} Created approval ${request.id} for task ${taskId}: "${title}" (priority=${rule.priority})`,
    );

    // 推送事件到所有渲染进程
    this.broadcastApprovalEvent(request);

    return request;
  }

  // ==================== 等待审批 ====================

  /**
   * 挂起等待审批结果。
   * 超时自动拒绝并将状态更新为 expired。
   */
  waitForApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const timeoutMs = request.expiresAt
        ? Math.max(0, request.expiresAt - Date.now())
        : 60_000;

      const timer = setTimeout(() => {
        if (this.pending.has(request.id)) {
          log.warn(
            `${this.logTag} Approval ${request.id} timed out, auto-rejecting`,
          );
          this.pending.delete(request.id);
          this.persistDecision(request.id, "reject", "expired");
          resolve("reject");
        }
      }, timeoutMs);

      this.pending.set(request.id, { resolve, timer });
    });
  }

  /**
   * 便捷方法：创建审批并等待结果（一步完成）
   */
  async requestApproval(
    taskId: string,
    rule: ApprovalRule,
    title: string,
    description?: string,
    context?: Record<string, unknown>,
  ): Promise<ApprovalDecision> {
    const request = this.createApproval(
      taskId,
      rule,
      title,
      description,
      context,
    );
    return this.waitForApproval(request);
  }

  // ==================== 响应审批 ====================

  /**
   * 用户通过 UI 响应审批（approve / reject）
   */
  respondApproval(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      log.warn(`${this.logTag} No pending approval found for id=${approvalId}`);
      return false;
    }

    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(approvalId);

    this.persistDecision(approvalId, decision, "pending");
    entry.resolve(decision);

    log.info(`${this.logTag} Approval ${approvalId} responded: ${decision}`);
    return true;
  }

  // ==================== 查询 ====================

  getApproval(approvalId: string): ApprovalRequest | null {
    const db = getDb();
    if (!db) return null;

    const row = db
      .prepare("SELECT * FROM approval_requests WHERE id = ?")
      .get(approvalId) as ApprovalRow | undefined;
    return row ? rowToApproval(row) : null;
  }

  listPendingApprovals(): ApprovalRequest[] {
    const db = getDb();
    if (!db) return [];

    const rows = db
      .prepare(
        "SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY created_at ASC",
      )
      .all() as ApprovalRow[];
    return rows.map(rowToApproval);
  }

  listTaskApprovals(taskId: string): ApprovalRequest[] {
    const db = getDb();
    if (!db) return [];

    const rows = db
      .prepare(
        "SELECT * FROM approval_requests WHERE task_id = ? ORDER BY created_at ASC",
      )
      .all(taskId) as ApprovalRow[];
    return rows.map(rowToApproval);
  }

  // ==================== 私有工具 ====================

  private persistDecision(
    approvalId: string,
    decision: ApprovalDecision,
    statusOverride?: string,
  ): void {
    const db = getDb();
    if (!db) return;

    const now = Date.now();
    const status =
      statusOverride === "expired"
        ? "expired"
        : decision === "approve"
          ? "approved"
          : "rejected";

    db.prepare(
      `
      UPDATE approval_requests
      SET status = ?, decision = ?, responded_at = ?
      WHERE id = ?
    `,
    ).run(status, decision, now, approvalId);
  }

  private broadcastApprovalEvent(request: ApprovalRequest): void {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send("harness:approvalRequested", {
          request,
          taskTitle: "",
        });
      }
    }
  }
}

export const approvalGate = new ApprovalGate();
