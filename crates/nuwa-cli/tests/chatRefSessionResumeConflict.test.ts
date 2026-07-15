import { describe, it, expect, vi } from "vitest";

describe("chatCommand --resume + --ref-session conflict", () => {
  it("rejects conflicting context modes before touching the engine registry or any session-history file", async () => {
    const { getEngine } = await import("../src/core/engines/registry.js");
    const registrySpy = vi.spyOn(
      await import("../src/core/engines/registry.js"),
      "getEngine",
    );

    const { chatCommand } = await import("../src/commands/chat.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalExitCode = process.exitCode;

    await chatCommand({
      engine: "claude",
      resume: "some-session-id",
      refSession: "codex:some-other-session-id",
    });

    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "--resume、--ref-session、--handoff 不能同时使用",
      ),
    );
    // Proves this is a true fail-fast: the check must run before any engine
    // lookup / local-history file read, not just happen to fail for some
    // unrelated reason further down the pipeline.
    expect(registrySpy).not.toHaveBeenCalled();

    process.exitCode = originalExitCode;
    errSpy.mockRestore();
    registrySpy.mockRestore();
    void getEngine; // referenced only to keep the import from being elided
  });

  it("also rejects --ref-session + --handoff as ambiguous new-session context", async () => {
    const registrySpy = vi.spyOn(
      await import("../src/core/engines/registry.js"),
      "getEngine",
    );

    const { chatCommand } = await import("../src/commands/chat.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalExitCode = process.exitCode;

    await chatCommand({
      engine: "claude",
      refSession: "claude:s1",
      handoff: "codex:s2",
    });

    expect(process.exitCode).toBe(1);
    expect(registrySpy).not.toHaveBeenCalled();

    process.exitCode = originalExitCode;
    errSpy.mockRestore();
    registrySpy.mockRestore();
  });

  it("still allows --resume alone and --ref-session alone (only the combination is rejected)", async () => {
    vi.resetModules();
    const { resolveRefSessionReminder } =
      await import("../src/commands/chat.js");
    // --ref-session alone must still reach the normal resolver (and fail
    // there for an unrelated, expected reason: no such local session) rather
    // than being rejected by the new mutual-exclusion check.
    await expect(
      resolveRefSessionReminder("codex:does-not-exist-anywhere"),
    ).rejects.toThrow(/does-not-exist-anywhere/);
  });
});
