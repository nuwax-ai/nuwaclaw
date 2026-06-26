import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalInterventionService } from "./approvalInterventionService";
import type { AcpPermissionRequest } from "../engines/acp/acpClient";

vi.mock("electron-log/main", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../system/deviceId", () => ({
  getDeviceId: () => "device-test",
}));

function createRequest(
  overrides: Partial<AcpPermissionRequest> = {},
): AcpPermissionRequest {
  return {
    sessionId: "acp-session-1",
    toolCall: {
      toolCallId: "tool-call-1",
      kind: "bash",
      title: "bash",
      rawInput: { command: "cargo build" },
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
    ...overrides,
  };
}

function createComputerPermissionResolve(optionId = "allow") {
  return {
    permission_resolve_request: {
      request_permission_response: {
        outcome: {
          Selected: {
            option_id: optionId,
          },
        },
      },
      session_id: "acp-session-1",
      tool_call_id: "tool-call-1",
      save_rule: true,
    },
    project_id: "project-1",
    user_id: "user-1",
  };
}

describe("ApprovalInterventionService computer permission callbacks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves pending permission by ACP session id and tool call id", async () => {
    const service = new ApprovalInterventionService();
    const { acpResponsePromise } = service.createPending({
      engine: "nuwaxcode",
      appSessionId: "app-session-1",
      acpSessionId: "acp-session-1",
      acpRequest: createRequest(),
    });

    const result = service.resolveFromComputerPermissionCallback(
      createComputerPermissionResolve(),
    );

    expect(result).toEqual({ ok: true, hostStatus: "resolved" });
    await expect(acpResponsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
    expect(service.pendingCount).toBe(0);
  });

  it("rejects option_id that is not in the pending ACP options", () => {
    const service = new ApprovalInterventionService();
    service.createPending({
      engine: "nuwaxcode",
      appSessionId: "app-session-1",
      acpSessionId: "acp-session-1",
      acpRequest: createRequest(),
    });

    const result = service.resolveFromComputerPermissionCallback(
      createComputerPermissionResolve("unknown-option"),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ERR_VALIDATION",
      },
    });
    expect(service.pendingCount).toBe(1);
    service.destroy();
  });

  it("cancels all pending permissions by ACP session id", async () => {
    const service = new ApprovalInterventionService();
    const first = service.createPending({
      engine: "nuwaxcode",
      appSessionId: "app-session-1",
      acpSessionId: "acp-session-1",
      acpRequest: createRequest(),
    });
    const second = service.createPending({
      engine: "nuwaxcode",
      appSessionId: "app-session-1",
      acpSessionId: "acp-session-1",
      acpRequest: createRequest({
        toolCall: {
          toolCallId: "tool-call-2",
          kind: "bash",
          title: "bash",
          rawInput: { command: "cargo test" },
        },
      }),
    });

    service.cancelByAcpSession("acp-session-1");

    await expect(first.acpResponsePromise).resolves.toEqual({
      outcome: { outcome: "cancelled" },
    });
    await expect(second.acpResponsePromise).resolves.toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(service.pendingCount).toBe(0);
  });

  it("reports pending permissions for an ACP session", () => {
    const service = new ApprovalInterventionService();
    expect(service.hasPendingForAcpSession("acp-session-1")).toBe(false);

    service.createPending({
      engine: "nuwaxcode",
      appSessionId: "app-session-1",
      acpSessionId: "acp-session-1",
      acpRequest: createRequest(),
    });

    expect(service.hasPendingForAcpSession("acp-session-1")).toBe(true);
    expect(service.hasPendingForAcpSession("acp-session-2")).toBe(false);
    service.destroy();
  });

  it("cleans the ACP permission key when a pending request times out", async () => {
    vi.useFakeTimers();
    const service = new ApprovalInterventionService();
    const { acpResponsePromise } = service.createPending({
      engine: "nuwaxcode",
      appSessionId: "app-session-1",
      acpSessionId: "acp-session-1",
      acpRequest: createRequest(),
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(11);

    await expect(acpResponsePromise).resolves.toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(service.pendingCount).toBe(0);

    const result = service.resolveFromComputerPermissionCallback(
      createComputerPermissionResolve(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ERR_PERMISSION_NOT_FOUND",
      },
    });
  });
});
