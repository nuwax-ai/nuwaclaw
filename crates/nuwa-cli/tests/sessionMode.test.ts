import { describe, it, expect, vi } from "vitest";
import type { ClientContext, ActiveSession } from "@agentclientprotocol/sdk";
import { applySessionMode } from "../src/core/acp/sessionMode.js";

function fakeSession(availableModeIds: string[]): ActiveSession {
  return {
    sessionId: "s1",
    modes: {
      currentModeId: availableModeIds[0],
      availableModes: availableModeIds.map((id) => ({ id, name: id })),
    },
  } as unknown as ActiveSession;
}

function fakeCtx(): { ctx: ClientContext; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn().mockResolvedValue(undefined);
  return { ctx: { request } as unknown as ClientContext, request };
}

describe("applySessionMode", () => {
  it("does nothing when neither --mode nor --yolo is set", async () => {
    const { ctx, request } = fakeCtx();
    await applySessionMode(
      ctx,
      fakeSession(["default", "bypassPermissions"]),
      undefined,
      false,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("sets the explicitly requested mode when it's available", async () => {
    const { ctx, request } = fakeCtx();
    await applySessionMode(
      ctx,
      fakeSession(["default", "acceptEdits"]),
      "acceptEdits",
      false,
    );
    expect(request).toHaveBeenCalledWith("session/set_mode", {
      sessionId: "s1",
      modeId: "acceptEdits",
    });
  });

  it("warns and skips when the requested mode isn't available", async () => {
    const { ctx, request } = fakeCtx();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await applySessionMode(
      ctx,
      fakeSession(["default"]),
      "no-such-mode",
      false,
    );
    expect(request).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("no-such-mode"),
    );
    errSpy.mockRestore();
  });

  it("--yolo picks the first mode from its preference list that the engine offers (claude-style)", async () => {
    const { ctx, request } = fakeCtx();
    await applySessionMode(
      ctx,
      fakeSession(["default", "acceptEdits", "bypassPermissions"]),
      undefined,
      true,
    );
    expect(request).toHaveBeenCalledWith("session/set_mode", {
      sessionId: "s1",
      modeId: "bypassPermissions",
    });
  });

  it("--yolo falls back further down its preference list for engines without bypassPermissions (codex-style)", async () => {
    const { ctx, request } = fakeCtx();
    await applySessionMode(
      ctx,
      fakeSession(["read-only", "auto", "full-access"]),
      undefined,
      true,
    );
    expect(request).toHaveBeenCalledWith("session/set_mode", {
      sessionId: "s1",
      modeId: "full-access",
    });
  });

  it("--yolo is a silent no-op when no preferred mode is available", async () => {
    const { ctx, request } = fakeCtx();
    await applySessionMode(ctx, fakeSession(["read-only"]), undefined, true);
    expect(request).not.toHaveBeenCalled();
  });

  it("an explicit --mode takes priority over --yolo's preference list", async () => {
    const { ctx, request } = fakeCtx();
    await applySessionMode(
      ctx,
      fakeSession(["default", "acceptEdits", "bypassPermissions"]),
      "acceptEdits",
      true,
    );
    expect(request).toHaveBeenCalledWith("session/set_mode", {
      sessionId: "s1",
      modeId: "acceptEdits",
    });
  });
});
