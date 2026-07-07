import { describe, it, expect, vi } from "vitest";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

const selectMock = vi.fn();
const isCancelMock = vi.fn(() => false);

vi.mock("@clack/prompts", () => ({
  select: (...args: unknown[]) => selectMock(...args),
  isCancel: (...args: unknown[]) => isCancelMock(...args),
}));

const { decidePermission } = await import("../src/core/permissions/policy.js");

function makeRequest(
  options: RequestPermissionRequest["options"],
): RequestPermissionRequest {
  return {
    sessionId: "s1",
    toolCall: { toolCallId: "call-1", title: "do a thing" },
    options,
  };
}

describe("decidePermission", () => {
  it("yolo prefers allow_always over allow_once", async () => {
    const req = makeRequest([
      { optionId: "once", name: "Once", kind: "allow_once" },
      { optionId: "always", name: "Always", kind: "allow_always" },
    ]);
    const result = await decidePermission(req, "yolo");
    expect(result.outcome).toEqual({ outcome: "selected", optionId: "always" });
  });

  it("yolo falls back to allow_once when allow_always is absent", async () => {
    const req = makeRequest([
      { optionId: "once", name: "Once", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ]);
    const result = await decidePermission(req, "yolo");
    expect(result.outcome).toEqual({ outcome: "selected", optionId: "once" });
  });

  it("yolo cancels when there is no allow option at all", async () => {
    const req = makeRequest([
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ]);
    const result = await decidePermission(req, "yolo");
    expect(result.outcome).toEqual({ outcome: "cancelled" });
  });

  it("deny-noninteractive picks a reject option without prompting", async () => {
    const req = makeRequest([
      { optionId: "once", name: "Once", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ]);
    const result = await decidePermission(req, "deny-noninteractive");
    expect(result.outcome).toEqual({ outcome: "selected", optionId: "reject" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("deny-noninteractive cancels when there is no reject option", async () => {
    const req = makeRequest([
      { optionId: "once", name: "Once", kind: "allow_once" },
    ]);
    const result = await decidePermission(req, "deny-noninteractive");
    expect(result.outcome).toEqual({ outcome: "cancelled" });
  });

  it("interactive mode returns the user's selected option", async () => {
    selectMock.mockResolvedValueOnce("once");
    isCancelMock.mockReturnValueOnce(false);
    const req = makeRequest([
      { optionId: "once", name: "Once", kind: "allow_once" },
    ]);
    const result = await decidePermission(req, "interactive");
    expect(result.outcome).toEqual({ outcome: "selected", optionId: "once" });
    expect(selectMock).toHaveBeenCalled();
  });

  it("interactive mode reports cancelled when the user aborts the prompt", async () => {
    const cancelSymbol = Symbol("cancel");
    selectMock.mockResolvedValueOnce(cancelSymbol);
    isCancelMock.mockReturnValueOnce(true);
    const req = makeRequest([
      { optionId: "once", name: "Once", kind: "allow_once" },
    ]);
    const result = await decidePermission(req, "interactive");
    expect(result.outcome).toEqual({ outcome: "cancelled" });
  });
});
