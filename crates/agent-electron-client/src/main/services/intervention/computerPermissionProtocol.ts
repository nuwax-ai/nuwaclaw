import type {
  AcpPermissionRequest,
  AcpPermissionResponse,
  NotifyResolvedResponse,
  ComputerNotifyResolvedRequest,
  ComputerPermissionProgressData,
  ComputerPermissionSaveRule,
} from "@shared/types/intervention";
import {
  parseComputerPermissionResolveRequest as parseSharedPermissionResolveRequest,
  toComputerPermissionProgressData as toSharedPermissionProgressData,
} from "@nuwax-ai/agent-kit";

export interface ComputerPermissionResolveCommand {
  acpSessionId: string;
  toolCallId: string;
  acpResponse: AcpPermissionResponse;
  saveRule?: boolean;
  projectId?: string;
  userId?: string;
}

export function isComputerPermissionResolveRequest(
  body: unknown,
): body is ComputerNotifyResolvedRequest {
  return (
    !!body && typeof body === "object" && "permission_resolve_request" in body
  );
}

export function validateComputerPermissionResolveRequest(
  body: unknown,
): { ok: true } | { ok: false; message: string } {
  const parsed = parseComputerPermissionResolveRequest(body);
  if (parsed.ok) return { ok: true };
  return { ok: false, message: parsed.response.error?.message ?? "invalid" };
}

export function parseComputerPermissionResolveRequest(
  body: unknown,
):
  | { ok: true; command: ComputerPermissionResolveCommand }
  | { ok: false; response: NotifyResolvedResponse } {
  const parsed = parseSharedPermissionResolveRequest(body);
  if (!parsed.ok) {
    // HTTP response shape is a nuwaclaw host contract. Keep it local while the
    // wire-protocol validation and legacy outcome normalization live in agent-kit.
    return validationError(parsed.body.error.message);
  }

  return { ok: true, command: parsed.command };
}

export function toComputerPermissionProgressData(args: {
  acpRequest: AcpPermissionRequest;
  interventionId?: string;
  revision?: number;
}): ComputerPermissionProgressData {
  const { acpRequest, interventionId, revision } = args;
  // agent-kit 0.2.0 exposes the SDK 0.26 enum for toolCall.kind while
  // nuwaclaw intentionally accepts engine-specific string kinds. The shared
  // mapper only reads the common fields, so keep this compatibility cast at
  // the host boundary until agent-kit's structural request type is released.
  const sharedRequest = acpRequest as unknown as Parameters<
    typeof toSharedPermissionProgressData
  >[0]["request"];
  const base = toSharedPermissionProgressData({
    request: sharedRequest,
  }) as Pick<
    ComputerPermissionProgressData,
    "request_permission_request" | "tool_call_id"
  >;
  const saveRule = buildSaveRuleSuggestion(acpRequest);
  const meta: Record<string, unknown> = {};
  if (interventionId) meta.nuwaclaw_intervention_id = interventionId;
  if (typeof revision === "number") meta.nuwaclaw_revision = revision;

  return {
    ...base,
    ...(saveRule ? { save_rule: saveRule } : {}),
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

function buildSaveRuleSuggestion(
  acpRequest: AcpPermissionRequest,
): ComputerPermissionSaveRule | undefined {
  const command = extractCommand(acpRequest.toolCall.rawInput);
  if (!command) return undefined;

  return {
    suggested_pattern: `^${escapeRegex(command).replace(/\s+/g, "\\s+")}`,
    rule_type: "allow",
    tool_name: inferToolName(acpRequest),
  };
}

function extractCommand(rawInput: unknown): string | null {
  if (typeof rawInput === "string") {
    const command = rawInput.trim();
    return command ? command : null;
  }
  if (!isRecord(rawInput)) return null;

  for (const key of ["command", "cmd", "script"]) {
    const value = rawInput[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function inferToolName(acpRequest: AcpPermissionRequest): string {
  const kind = acpRequest.toolCall.kind ?? "";
  const title = acpRequest.toolCall.title ?? "";
  const marker = `${kind} ${title}`.toLowerCase();
  if (
    marker.includes("terminal") ||
    marker.includes("shell") ||
    marker.includes("bash") ||
    marker.includes("command")
  ) {
    return "terminal";
  }
  return kind || title || "tool";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validationError(message: string): {
  ok: false;
  response: NotifyResolvedResponse;
} {
  return {
    ok: false,
    response: {
      ok: false,
      error: {
        code: "ERR_VALIDATION",
        message,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
