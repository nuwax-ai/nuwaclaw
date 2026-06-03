import type {
  AcpPermissionRequest,
  AcpPermissionResponse,
  NotifyResolvedResponse,
  ComputerNotifyResolvedRequest,
  ComputerPermissionProgressData,
  ComputerPermissionSaveRule,
} from "@shared/types/intervention";

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
  if (!isRecord(body)) {
    return validationError("request body is required");
  }
  if (!isComputerPermissionResolveRequest(body)) {
    return validationError("permission_resolve_request is required");
  }

  const request = body.permission_resolve_request;
  if (!isRecord(request)) {
    return validationError("permission_resolve_request must be an object");
  }

  if (typeof request.session_id !== "string" || !request.session_id) {
    return validationError("permission_resolve_request.session_id is required");
  }
  if (typeof request.tool_call_id !== "string" || !request.tool_call_id) {
    return validationError(
      "permission_resolve_request.tool_call_id is required",
    );
  }

  const response = request.request_permission_response;
  if (!isRecord(response)) {
    return validationError(
      "permission_resolve_request.request_permission_response is required",
    );
  }
  if (!isRecord(response.outcome)) {
    return validationError("request_permission_response.outcome is required");
  }

  const outcome = response.outcome;
  let acpResponse: AcpPermissionResponse;
  if ("Selected" in outcome) {
    const selected = outcome.Selected;
    if (!isRecord(selected)) {
      return validationError("Selected outcome must be an object");
    }
    if (typeof selected.option_id !== "string" || !selected.option_id) {
      return validationError("Selected outcome requires option_id");
    }
    acpResponse = {
      outcome: { outcome: "selected", optionId: selected.option_id },
    };
  } else if ("Cancelled" in outcome) {
    acpResponse = { outcome: { outcome: "cancelled" } };
  } else if (outcome.outcome === "selected") {
    const optionId =
      typeof outcome.optionId === "string" ? outcome.optionId : undefined;
    if (!optionId) {
      return validationError("Legacy selected outcome requires optionId");
    }
    acpResponse = {
      outcome: { outcome: "selected", optionId },
    };
  } else if (outcome.outcome === "cancelled") {
    acpResponse = { outcome: { outcome: "cancelled" } };
  } else {
    return validationError("outcome must be Selected or Cancelled");
  }

  return {
    ok: true,
    command: {
      acpSessionId: request.session_id,
      toolCallId: request.tool_call_id,
      acpResponse,
      saveRule:
        typeof request.save_rule === "boolean" ? request.save_rule : undefined,
      projectId:
        typeof body.project_id === "string" ? body.project_id : undefined,
      userId: typeof body.user_id === "string" ? body.user_id : undefined,
    },
  };
}

export function toComputerPermissionProgressData(args: {
  acpRequest: AcpPermissionRequest;
  interventionId?: string;
  revision?: number;
}): ComputerPermissionProgressData {
  const { acpRequest, interventionId, revision } = args;
  const toolCall = acpRequest.toolCall;
  const toolCallId = toolCall.toolCallId;
  const saveRule = buildSaveRuleSuggestion(acpRequest);
  const meta: Record<string, unknown> = {};
  if (interventionId) meta.nuwaclaw_intervention_id = interventionId;
  if (typeof revision === "number") meta.nuwaclaw_revision = revision;

  return {
    request_permission_request: {
      session_id: acpRequest.sessionId,
      tool_call: {
        tool_call_id: toolCallId,
        kind: toolCall.kind ?? "tool",
        status: toolCall.status ?? "pending",
        title: toolCall.title ?? toolCall.kind ?? "tool",
        content: Array.isArray(toolCall.content) ? toolCall.content : [],
        raw_input: toolCall.rawInput ?? {},
        _meta: {},
      },
      options: acpRequest.options.map((option) => ({
        option_id: option.optionId,
        name: option.name,
        kind: option.kind,
        _meta: {},
      })),
      _meta: {},
    },
    tool_call_id: toolCallId,
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
