import { describe, expect, it, vi } from "vitest";
import {
  applySessionMode,
  resolveEngineModeInfo,
  resolvePlanModeId,
  syncBusinessModeToEngine,
  type EngineModeInfo,
  type SessionModeChannel,
} from "../src/sessionMode.js";
import { buildClientCapabilities } from "../src/clientCapabilities.js";

describe("resolveEngineModeInfo", () => {
  it("prefers the modes field from session responses (claude-code shape)", () => {
    const info = resolveEngineModeInfo({
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "plan", name: "Plan Mode", description: "Planning only" },
        ],
      },
      configOptions: [],
    });
    expect(info.source).toBe("modes");
    expect(info.currentModeId).toBe("default");
    expect(info.availableModes.map((m) => m.id)).toEqual(["default", "plan"]);
  });

  it("falls back to the mode config option (nuwaxcode shape)", () => {
    const info = resolveEngineModeInfo({
      modes: null,
      configOptions: [
        {
          id: "model",
          type: "select",
          currentValue: "anthropic/claude",
          options: [{ value: "anthropic/claude", name: "Claude" }],
        },
        {
          id: "mode",
          type: "select",
          currentValue: "build",
          options: [
            { value: "build", name: "build" },
            {
              value: "plan",
              name: "plan",
              description: "Plan mode. Disallows all edit tools.",
            },
          ],
        },
      ],
    });
    expect(info.source).toBe("config_option");
    expect(info.currentModeId).toBe("build");
    expect(info.availableModes.map((m) => m.id)).toEqual(["build", "plan"]);
    expect(info.availableModes[1].description).toContain("Disallows");
  });

  it("unwraps grouped select options", () => {
    const info = resolveEngineModeInfo({
      configOptions: [
        {
          id: "mode",
          type: "select",
          options: [
            {
              group: "primary",
              name: "Primary",
              options: [
                { value: "build", name: "build" },
                { value: "plan", name: "plan" },
              ],
            },
          ],
        },
      ],
    });
    expect(info.availableModes.map((m) => m.id)).toEqual(["build", "plan"]);
  });

  it("returns empty info when neither channel carries modes", () => {
    const info = resolveEngineModeInfo({
      modes: { availableModes: [], currentModeId: null },
      configOptions: [{ id: "model", type: "select", options: [] }],
    });
    expect(info.source).toBe("none");
    expect(info.availableModes).toEqual([]);
    expect(info.currentModeId).toBeNull();
  });
});

describe("resolvePlanModeId", () => {
  it("finds the exact plan id", () => {
    expect(
      resolvePlanModeId([{ id: "default" }, { id: "plan" }]),
    ).toBe("plan");
  });

  it("falls back to an id containing plan", () => {
    expect(resolvePlanModeId([{ id: "build" }, { id: "planning" }])).toBe(
      "planning",
    );
  });

  it("returns null when the engine has no plan mode", () => {
    expect(
      resolvePlanModeId([{ id: "read-only" }, { id: "agent" }]),
    ).toBeNull();
  });
});

describe("applySessionMode", () => {
  it("applies via session/set_mode when available", async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    const connection: SessionModeChannel = { setSessionMode };
    const outcome = await applySessionMode({
      sessionId: "s1",
      modeId: "plan",
      connection,
    });
    expect(outcome).toEqual({
      status: "applied",
      modeId: "plan",
      via: "set_mode",
    });
    expect(setSessionMode).toHaveBeenCalledWith({
      sessionId: "s1",
      modeId: "plan",
    });
  });

  it("falls back to the mode config option when set_mode is unimplemented", async () => {
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn().mockRejectedValue(
        Object.assign(new Error("Method not found"), { code: -32601 }),
      ),
      setSessionConfigOption: vi.fn().mockResolvedValue({
        configOptions: [],
      }),
    };
    const outcome = await applySessionMode({
      sessionId: "s1",
      modeId: "plan",
      connection,
    });
    expect(outcome).toEqual({
      status: "applied",
      modeId: "plan",
      via: "config_option",
    });
    expect(connection.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "s1",
      configId: "mode",
      value: "plan",
    });
  });

  it("reports failed when both channels reject", async () => {
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn().mockRejectedValue(new Error("Method not found")),
      setSessionConfigOption: vi
        .fn()
        .mockRejectedValue(new Error("Invalid mode: plan")),
    };
    const outcome = await applySessionMode({
      sessionId: "s1",
      modeId: "plan",
      connection,
    });
    expect(outcome).toEqual({
      status: "failed",
      modeId: "plan",
      reason: "Invalid mode: plan",
    });
  });

  it("reports the set_mode error when no config channel exists", async () => {
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const outcome = await applySessionMode({
      sessionId: "s1",
      modeId: "plan",
      connection,
    });
    expect(outcome).toEqual({
      status: "failed",
      modeId: "plan",
      reason: "boom",
    });
  });

  it("reports unsupported when the agent exposes no channel", async () => {
    const outcome = await applySessionMode({
      sessionId: "s1",
      modeId: "plan",
      connection: {},
    });
    expect(outcome).toEqual({
      status: "unsupported",
      modeId: "plan",
      reason: "no_channel",
    });
  });
});

describe("buildClientCapabilities", () => {
  it("declares plan support with terminal when requested", () => {
    expect(buildClientCapabilities({ terminal: true })).toEqual({
      terminal: true,
      plan: {},
    });
  });

  it("declares plan support alone for headless hosts", () => {
    expect(buildClientCapabilities()).toEqual({ plan: {} });
  });
});

describe("syncBusinessModeToEngine", () => {
  const info: EngineModeInfo = {
    availableModes: [
      { id: "default" },
      { id: "plan", name: "Plan Mode" },
    ],
    currentModeId: "default",
    source: "modes",
  };

  it("plan dispatches set_mode and reports the new mirror", async () => {
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn().mockResolvedValue({}),
    };
    const result = await syncBusinessModeToEngine({
      sessionId: "s1",
      desired: "plan",
      info,
      currentModeId: "default",
      connection,
    });
    expect(result.currentModeId).toBe("plan");
    expect(result.outcome).toEqual({
      status: "applied",
      modeId: "plan",
      via: "set_mode",
    });
    expect(connection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "s1",
      modeId: "plan",
    });
  });

  it("plan is a no-op when already in plan mode", async () => {
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn(),
    };
    const result = await syncBusinessModeToEngine({
      sessionId: "s1",
      desired: "plan",
      info,
      currentModeId: "plan",
      connection,
    });
    expect(result.currentModeId).toBe("plan");
    expect(result.outcome).toBeUndefined();
    expect(connection.setSessionMode).not.toHaveBeenCalled();
  });

  it("plan keeps the engine default when no plan mode is advertised", async () => {
    const noPlanInfo: EngineModeInfo = {
      availableModes: [{ id: "read-only" }, { id: "agent" }],
      currentModeId: "agent",
      source: "modes",
    };
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn(),
    };
    const result = await syncBusinessModeToEngine({
      sessionId: "s1",
      desired: "plan",
      info: noPlanInfo,
      currentModeId: "agent",
      connection,
    });
    expect(result.currentModeId).toBe("agent");
    expect(connection.setSessionMode).not.toHaveBeenCalled();
  });

  it("leaving plan restores the engine's initial mode", async () => {
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn().mockResolvedValue({}),
    };
    const result = await syncBusinessModeToEngine({
      sessionId: "s1",
      desired: "yolo",
      info,
      currentModeId: "plan",
      connection,
    });
    expect(result.currentModeId).toBe("default");
    expect(connection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "s1",
      modeId: "default",
    });
  });

  it("ask/yolo is a no-op when the engine is not in plan", async () => {
    const connection: SessionModeChannel = {
      setSessionMode: vi.fn(),
    };
    const result = await syncBusinessModeToEngine({
      sessionId: "s1",
      desired: "ask",
      info,
      currentModeId: "default",
      connection,
    });
    expect(result.currentModeId).toBe("default");
    expect(connection.setSessionMode).not.toHaveBeenCalled();
  });
});
