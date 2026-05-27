/**
 * Intervention 类型定义（v3 跨端方案）
 *
 * Electron Nuwaclaw 作为 ACP Client Host，只透传 ACP 官方 request/response，
 * 不生成 InteractionUISchema。
 *
 * 本文件定义跨端公开契约，不引用 main/ 下的类型。
 */

// === ACP Permission 最小类型（与 acpClient.ts 及官方 schema 对齐） ===

export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface AcpPermissionOption {
  optionId: string;
  kind: AcpPermissionOptionKind;
  name: string;
}

export interface AcpToolCallUpdate {
  toolCallId: string;
  title?: string | null;
  kind?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: Array<{ path: string; line?: number | null }> | null;
  content?: unknown[] | null;
  status?: "pending" | "in_progress" | "completed" | "failed" | null;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCallUpdate;
  options: AcpPermissionOption[];
}

export type AcpPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface AcpPermissionResponse {
  outcome: AcpPermissionOutcome;
}

// === Intervention Kind & Status ===

export type InterventionKind = "approval" | "question";

export type InterventionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "answered"
  | "cancelled"
  | "skipped"
  | "expired"
  | "superseded";

export type InterventionAction = "submit" | "cancel" | "skip" | "timeout";

// === Intervention Request ===

export interface BaseInterventionRequest {
  id: string;
  revision: number;
  kind: InterventionKind;
  status: InterventionStatus;
  /** Nuwaclaw app session id */
  sessionId: string;
  source: "acp_permission" | "mcp_ask";
  timeoutMs?: number;
  createdAt: number;
}

export interface AcpPermissionInterventionRequest extends BaseInterventionRequest {
  kind: "approval";
  source: "acp_permission";
  engine: string;
  protocol: "acp";
  callbackTarget: {
    kind: "electron" | "rcoder";
    targetId: string;
  };
  schemaRef: string;
  acp: {
    method: "session/request_permission";
    request: AcpPermissionRequest;
  };
}

export type InterventionRequest = AcpPermissionInterventionRequest;

// === Intervention Response ===

export interface AcpPermissionInterventionResponse {
  interventionId: string;
  revision: number;
  source: "acp_permission";
  protocol: "acp";
  action: InterventionAction;
  acpResponse: AcpPermissionResponse;
  uiAudit?: { reason?: string };
  receivedAt: number;
}

export type InterventionResponse = AcpPermissionInterventionResponse;

// === Notify-Resolved (Backend → Host callback) ===

export interface NotifyResolvedRequest {
  interventionId: string;
  revision: number;
  source: "acp_permission";
  protocol: "acp";
  action: InterventionAction;
  acpResponse: AcpPermissionResponse;
  resolvedBy: {
    kind: "web" | "mobile";
    userId?: string;
    clientId?: string;
  };
  resolvedAt: number;
}

// === RCoder Permission Request Contract ===

export interface RcoderPermissionToolCall {
  tool_call_id: string;
  kind: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  title: string;
  content: unknown[];
  raw_input: unknown;
  _meta?: Record<string, unknown>;
}

export interface RcoderPermissionOption {
  option_id: string;
  name: string;
  kind: AcpPermissionOptionKind;
  _meta?: Record<string, unknown>;
}

export interface RcoderRequestPermissionRequest {
  session_id: string;
  tool_call: RcoderPermissionToolCall;
  options: RcoderPermissionOption[];
  _meta?: Record<string, unknown>;
}

export interface RcoderPermissionSaveRule {
  suggested_pattern: string;
  rule_type: "allow" | "deny";
  tool_name: string;
}

export interface RcoderPermissionProgressData {
  request_permission_request: RcoderRequestPermissionRequest;
  tool_call_id: string;
  save_rule?: RcoderPermissionSaveRule;
  _meta?: Record<string, unknown>;
}

export type RcoderRequestPermissionOutcome =
  | { Selected: { option_id: string } }
  | { Cancelled: Record<string, never> | null };

export interface RcoderRequestPermissionResponse {
  outcome: RcoderRequestPermissionOutcome;
}

export interface RcoderPermissionResolveRequest {
  request_permission_response: RcoderRequestPermissionResponse;
  session_id: string;
  tool_call_id: string;
  save_rule?: boolean;
}

export interface RcoderNotifyResolvedRequest {
  permission_resolve_request: RcoderPermissionResolveRequest;
  user_id?: string;
  project_id?: string;
  pod_id?: string;
  tenant_id?: string;
  space_id?: string;
  isolation_type?: string;
}

export type NotifyResolvedHostStatus =
  | "resolved"
  | "already_resolved"
  | "superseded"
  | "gone";

export type NotifyResolvedErrorCode =
  | "unauthorized"
  | "forbidden_target"
  | "not_found"
  | "revision_mismatch"
  | "invalid_acp_response"
  | "already_resolved_conflict"
  | "internal_error"
  | "ERR_VALIDATION"
  | "ERR_SESSION_NOT_FOUND"
  | "ERR_PERMISSION_NOT_FOUND"
  | "ERR_PERMISSION_RESOLVE_FAILED"
  | "ERR_PERMISSION_EXPIRED"
  | "ERR_CONTAINER_ERROR";

export interface NotifyResolvedResponse {
  ok: boolean;
  hostStatus?: NotifyResolvedHostStatus;
  error?: {
    code: NotifyResolvedErrorCode;
    message: string;
  };
}

// === Progress Message (SSE 投递) ===

export interface AcpRequestPermissionProgressMessage {
  sessionId: string;
  acpSessionId?: string;
  messageType: "acpRequestPermission";
  subType: "session/request_permission" | "request_permission";
  data: AcpPermissionInterventionRequest | RcoderPermissionProgressData;
  timestamp: string;
}

// === Host 内部 Pending Entry ===

export interface PendingAcpPermission {
  interventionId: string;
  revision: number;
  acpSessionId: string;
  appSessionId: string;
  toolCallId: string;
  request: AcpPermissionRequest;
  options: AcpPermissionOption[];
  status: "pending" | "resolved" | "cancelled" | "expired";
  resolvedResponse?: AcpPermissionResponse;
  resolve: (response: AcpPermissionResponse) => void;
  timer?: ReturnType<typeof setTimeout>;
  createdAt: number;
}
