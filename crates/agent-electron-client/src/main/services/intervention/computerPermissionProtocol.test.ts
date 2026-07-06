import { describe, expect, it } from "vitest";
import {
  parseComputerPermissionResolveRequest,
  toComputerPermissionProgressData,
  validateComputerPermissionResolveRequest,
} from "./computerPermissionProtocol";
import type { AcpPermissionRequest } from "@shared/types/intervention";

function permissionRequest(): AcpPermissionRequest {
  return {
    sessionId: "session_789",
    toolCall: {
      toolCallId: "tool_001",
      kind: "bash",
      status: "pending",
      title: "bash",
      content: [],
      rawInput: { command: "cargo build" },
    },
    options: [
      {
        optionId: "always_allow:terminal",
        name: "始终允许",
        kind: "allow_always",
      },
      { optionId: "allow", name: "允许本次", kind: "allow_once" },
    ],
  };
}

describe("computerPermissionProtocol", () => {
  it("maps ACP permission request to computer SSE payload", () => {
    const payload = toComputerPermissionProgressData({
      acpRequest: permissionRequest(),
      interventionId: "itv_001",
      revision: 1,
    });

    expect(payload).toMatchObject({
      request_permission_request: {
        sessionId: "session_789",
        toolCall: {
          toolCallId: "tool_001",
          kind: "bash",
          status: "pending",
          title: "bash",
          rawInput: { command: "cargo build" },
          locations: [],
        },
        options: [
          {
            optionId: "always_allow:terminal",
            name: "始终允许",
            kind: "allow_always",
          },
          {
            optionId: "allow",
            name: "允许本次",
            kind: "allow_once",
          },
        ],
      },
      tool_call_id: "tool_001",
      save_rule: {
        suggested_pattern: "^cargo\\s+build",
        rule_type: "allow",
        tool_name: "terminal",
      },
      _meta: {
        nuwaclaw_intervention_id: "itv_001",
        nuwaclaw_revision: 1,
      },
    });
  });

  it("maps computer Selected outcome to ACP selected response", () => {
    const parsed = parseComputerPermissionResolveRequest({
      permission_resolve_request: {
        request_permission_response: {
          outcome: {
            Selected: { option_id: "allow" },
          },
        },
        session_id: "session_789",
        tool_call_id: "tool_001",
        save_rule: true,
      },
      user_id: "user_123",
      project_id: "project_456",
    });

    expect(parsed).toEqual({
      ok: true,
      command: {
        acpSessionId: "session_789",
        toolCallId: "tool_001",
        acpResponse: {
          outcome: { outcome: "selected", optionId: "allow" },
        },
        saveRule: true,
        projectId: "project_456",
        userId: "user_123",
      },
    });
  });

  it("passes reject option_id through as selected response", () => {
    const parsed = parseComputerPermissionResolveRequest({
      permission_resolve_request: {
        request_permission_response: {
          outcome: {
            Selected: { option_id: "reject_once" },
          },
        },
        session_id: "session_789",
        tool_call_id: "tool_001",
        save_rule: false,
      },
    });

    expect(parsed).toMatchObject({
      ok: true,
      command: {
        acpResponse: {
          outcome: { outcome: "selected", optionId: "reject_once" },
        },
        saveRule: false,
      },
    });
  });

  it("accepts agent-platform legacy selected outcome", () => {
    const parsed = parseComputerPermissionResolveRequest({
      permission_resolve_request: {
        request_permission_response: {
          outcome: {
            optionId: "reject",
            outcome: "selected",
          },
        },
        session_id: "session_789",
        tool_call_id: "tool_001",
      },
      user_id: "user_123",
      project_id: "49",
    });

    expect(parsed).toEqual({
      ok: true,
      command: {
        acpSessionId: "session_789",
        toolCallId: "tool_001",
        acpResponse: {
          outcome: { outcome: "selected", optionId: "reject" },
        },
        saveRule: undefined,
        projectId: "49",
        userId: "user_123",
      },
    });
  });

  it("maps computer Cancelled outcome to ACP cancelled response", () => {
    const parsed = parseComputerPermissionResolveRequest({
      permission_resolve_request: {
        request_permission_response: {
          outcome: { Cancelled: {} },
        },
        session_id: "session_789",
        tool_call_id: "tool_001",
      },
    });

    expect(parsed).toMatchObject({
      ok: true,
      command: {
        acpResponse: { outcome: { outcome: "cancelled" } },
      },
    });
  });

  it("validates required computer permission fields", () => {
    const validation = validateComputerPermissionResolveRequest({
      permission_resolve_request: {
        request_permission_response: {
          outcome: { Selected: {} },
        },
        session_id: "session_789",
        tool_call_id: "tool_001",
      },
    });

    expect(validation).toEqual({
      ok: false,
      message: "Selected outcome requires option_id",
    });
  });
});
