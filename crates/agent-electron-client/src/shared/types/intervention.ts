export type AgentMode = "ask" | "yolo";

export function isAgentMode(value: unknown): value is AgentMode {
  return value === "ask" || value === "yolo";
}

export function normalizeAgentMode(value: unknown): AgentMode {
  if (value === undefined || value === null || value === "") return "yolo";
  return isAgentMode(value) ? value : "ask";
}

export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface PermissionOption {
  optionId: string;
  kind: PermissionOptionKind;
  name: string;
  _meta?: Record<string, unknown> | null;
}

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export interface ToolCallUpdate {
  toolCallId: string;
  title?: string | null;
  kind?: ToolKind | string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: Array<{ path: string; line?: number | null }> | null;
  content?: unknown[] | null;
  status?: "pending" | "in_progress" | "completed" | "failed" | string | null;
}

export interface RequestPermissionRequest {
  sessionId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  _meta?: Record<string, unknown> | null;
}

export type RequestPermissionOutcome =
  | {
      outcome: "selected";
      optionId: string;
      _meta?: Record<string, unknown> | null;
    }
  | { outcome: "cancelled"; _meta?: Record<string, unknown> | null };

export interface RequestPermissionResponse {
  outcome: RequestPermissionOutcome;
  _meta?: Record<string, unknown> | null;
}

export type InterventionKind = "approval";
export type InterventionAction = "submit" | "cancel" | "skip" | "timeout";
export type AgentEngineId = "claude-code" | "nuwaxcode" | "codex";

export interface CallbackTarget {
  kind: "electron" | "rcoder";
  targetId: string;
}

export interface AcpPermissionInterventionRequest {
  id: string;
  revision: number;
  kind: InterventionKind;
  status: "pending";
  sessionId: string;
  source: "acp_permission";
  engine: AgentEngineId;
  protocol: "acp";
  callbackTarget: CallbackTarget;
  schemaRef: "https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json";
  acp: {
    method: "session/request_permission";
    request: RequestPermissionRequest;
  };
  timeoutMs?: number;
  createdAt: number;
}

export interface NotifyResolvedRequest {
  interventionId: string;
  revision: number;
  source: "acp_permission";
  protocol: "acp";
  action: InterventionAction;
  acpResponse: RequestPermissionResponse;
  resolvedBy: {
    kind: "web" | "mobile";
    userId?: string;
    clientId?: string;
  };
  resolvedAt: number;
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
  | "internal_error";

export interface NotifyResolvedResponse {
  ok: boolean;
  hostStatus?: NotifyResolvedHostStatus;
  error?: {
    code: NotifyResolvedErrorCode;
    message: string;
  };
}

const VALID_ACTIONS = new Set<InterventionAction>([
  "submit",
  "cancel",
  "skip",
  "timeout",
]);

export function isValidAcpPermissionResponse(
  response: unknown,
  options: Array<{ optionId: string }>,
): response is RequestPermissionResponse {
  if (!response || typeof response !== "object") return false;
  const outcome = (response as RequestPermissionResponse).outcome;
  if (!outcome || typeof outcome !== "object") return false;
  if (outcome.outcome === "cancelled") return true;
  if (outcome.outcome !== "selected") return false;
  return (
    typeof outcome.optionId === "string" &&
    options.some((option) => option.optionId === outcome.optionId)
  );
}

export function sameAcpPermissionResponse(
  a: RequestPermissionResponse | undefined,
  b: RequestPermissionResponse | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.outcome.outcome !== b.outcome.outcome) return false;
  if (a.outcome.outcome === "cancelled") return true;
  if (b.outcome.outcome !== "selected") return false;
  return a.outcome.optionId === b.outcome.optionId;
}

export function isValidNotifyResolvedRequest(
  payload: unknown,
): payload is NotifyResolvedRequest {
  if (!payload || typeof payload !== "object") return false;
  const body = payload as NotifyResolvedRequest;
  return (
    typeof body.interventionId === "string" &&
    body.interventionId.length > 0 &&
    typeof body.revision === "number" &&
    Number.isInteger(body.revision) &&
    body.source === "acp_permission" &&
    body.protocol === "acp" &&
    VALID_ACTIONS.has(body.action) &&
    !!body.acpResponse &&
    typeof body.acpResponse === "object" &&
    !!body.resolvedBy &&
    (body.resolvedBy.kind === "web" || body.resolvedBy.kind === "mobile") &&
    typeof body.resolvedAt === "number"
  );
}
