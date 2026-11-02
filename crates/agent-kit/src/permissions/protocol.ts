// @nuwax-ai/agent-kit — ACP permission protocol marshaling (SSE progress + notify-resolved).
//
// Pure data shaping both hosts need IDENTICAL — especially the option_id vs
// optionId legacy-compat surface (Rust-enum-style {Selected:{option_id}} vs
// JS-style {outcome:'selected',optionId}). Divergence here = real bug, so it
// lives in the shared kit.

import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";

/**
 * Wire-level request shape used by the protocol mapper. Deliberately wider
 * than any single ACP SDK release: hosts may accept engine-specific tool kinds
 * while the mapper only needs these stable fields.
 */
export interface ComputerPermissionRequestLike {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    kind?: string | null;
    status?: string | null;
    title?: string | null;
    content?: unknown[] | null;
    rawInput?: unknown;
    locations?: Array<{ path: string; line?: number | null }> | null;
  };
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export interface ComputerPermissionResolveCommand {
  acpSessionId: string;
  toolCallId: string;
  acpResponse: RequestPermissionResponse;
  saveRule?: boolean;
  projectId?: string;
  userId?: string;
}

export type NotifyResolvedParseResult =
  | { ok: true; command: ComputerPermissionResolveCommand }
  | {
      ok: false;
      status: number;
      body: {
        ok: false;
        error: { code: string; message: string };
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validationError(message: string): NotifyResolvedParseResult {
  return {
    ok: false,
    status: 400,
    body: {
      ok: false,
      error: { code: "ERR_VALIDATION", message },
    },
  };
}

/**
 * 解析云端 POST /computer/notify-resolved 的 permission_resolve_request。
 * 兼容 nuwaclaw / RCoder：Selected.option_id 与 legacy outcome/optionId。
 */
export function parseComputerPermissionResolveRequest(
  body: unknown,
): NotifyResolvedParseResult {
  if (!isRecord(body)) {
    return validationError("request body is required");
  }
  if (!("permission_resolve_request" in body)) {
    // 非权限回执（例如旧客户端空 body）——调用方决定是否当 ignored
    return {
      ok: false,
      status: 200,
      body: {
        ok: false,
        error: {
          code: "ERR_NOT_PERMISSION_RESOLVE",
          message: "permission_resolve_request is required",
        },
      },
    };
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
  let acpResponse: RequestPermissionResponse;

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

/** 构造 SSE data：与 nuwaclaw toComputerPermissionProgressData 同构。 */
export function toComputerPermissionProgressData(args: {
  request: ComputerPermissionRequestLike;
  interventionId?: string;
  revision?: number;
  /** Host-owned metadata; avoids baking product prefixes into shared core. */
  metadata?: Record<string, unknown>;
  /** Host-owned top-level extensions such as nuwaclaw's save_rule hint. */
  extensions?: Record<string, unknown>;
}): Record<string, unknown> {
  const { request, interventionId, revision, extensions } = args;
  const toolCall = request.toolCall;
  const toolCallId = toolCall.toolCallId;
  const meta: Record<string, unknown> = { ...args.metadata };
  if (interventionId) meta.nuwa_cli_intervention_id = interventionId;
  if (typeof revision === "number") meta.nuwa_cli_revision = revision;

  return {
    ...extensions,
    request_permission_request: {
      sessionId: request.sessionId,
      toolCall: {
        toolCallId,
        kind: toolCall.kind ?? "tool",
        status: toolCall.status ?? "pending",
        title: toolCall.title ?? toolCall.kind ?? "tool",
        content: Array.isArray(toolCall.content) ? toolCall.content : [],
        rawInput: toolCall.rawInput ?? {},
        locations: toolCall.locations ?? [],
      },
      options: request.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    },
    tool_call_id: toolCallId,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}
