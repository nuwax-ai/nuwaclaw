/**
 * Harness 工作流类型定义
 *
 * 包含：任务、检查点、审批请求、指标、恢复策略
 */

// ==================== 任务 ====================

export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface HarnessTask {
  id: string;
  title: string;
  status: TaskStatus;
  engineType: string;
  sessionId?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  metadata?: Record<string, unknown> | null;
}

// ==================== 检查点 ====================

export enum CheckpointType {
  CP0_INIT = "CP0_INIT",
  CP1_PLAN = "CP1_PLAN",
  CP2_EXEC = "CP2_EXEC",
  CP3_VERIFY = "CP3_VERIFY",
  CP4_COMPLETE = "CP4_COMPLETE",
}

export type CheckpointStatus = "pending" | "active" | "passed" | "failed";

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  type: CheckpointType;
  status: CheckpointStatus;
  enteredAt: number;
  passedAt?: number | null;
  result?: Record<string, unknown> | null;
}

// ==================== 审批请求 ====================

export type ApprovalPriority = "low" | "medium" | "high" | "critical";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type ApprovalDecision = "approve" | "reject";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  type: string;
  priority: ApprovalPriority;
  title: string;
  description?: string | null;
  context?: Record<string, unknown> | null;
  status: ApprovalStatus;
  decision?: ApprovalDecision | null;
  createdAt: number;
  respondedAt?: number | null;
  expiresAt?: number | null;
}

/** 审批触发规则 */
export interface ApprovalRule {
  /** 触发条件的操作类型，如 'file:delete', 'command:execute' */
  operationType: string;
  /** 匹配条件（可选，如 'git push', 'rm -rf', 'sudo'） */
  matchPatterns?: string[];
  /** 超过此数量时触发（可选） */
  thresholdCount?: number;
  priority: ApprovalPriority;
  /** 超时秒数（默认 60s） */
  timeoutSeconds?: number;
}

// ==================== 指标 ====================

export interface HarnessMetric {
  id: string;
  metricName: string;
  value: number;
  labels?: Record<string, string> | null;
  recordedAt: number;
}

// ==================== 审计日志 ====================

export type AuditSeverity = "debug" | "info" | "warn" | "error" | "critical";
export type ActorType = "user" | "agent" | "system";

export interface AuditLogEntry {
  id: string;
  eventType: string;
  taskId?: string | null;
  sessionId?: string | null;
  actorType: ActorType;
  resourceType?: string | null;
  resourcePath?: string | null;
  action?: string | null;
  severity: AuditSeverity;
  data?: Record<string, unknown> | null;
  createdAt: number;
}

// ==================== 恢复策略 ====================

export type RecoveryAction =
  | "retry"
  | "wait"
  | "escalate"
  | "abort"
  | "pause"
  | "skip";

export interface RecoveryStrategy {
  errorType: string;
  action: RecoveryAction;
  maxRetries?: number;
  /** 等待秒数（用于 retry / wait 策略） */
  delaySeconds?: number;
}

// ==================== IPC 事件类型 ====================

export interface ApprovalRequestedEvent {
  request: ApprovalRequest;
  taskTitle: string;
}

export interface TaskStatusChangedEvent {
  taskId: string;
  previousStatus: TaskStatus;
  currentStatus: TaskStatus;
}
