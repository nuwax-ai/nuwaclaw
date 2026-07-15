import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveClaude: vi.fn(),
  resolveCodex: vi.fn(),
}));

vi.mock("../src/core/engines/registry.js", () => ({
  getEngine: (id: string) => {
    if (id === "claude") return { resolve: mocks.resolveClaude };
    if (id === "codex") return { resolve: mocks.resolveCodex };
    throw new Error(`unknown ${id}`);
  },
}));

describe("selectEngine", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveClaude.mockReset();
    mocks.resolveCodex.mockReset();
    mocks.resolveClaude.mockResolvedValue({
      command: "node",
      args: ["claude-acp"],
    });
    mocks.resolveCodex.mockResolvedValue({
      command: "node",
      args: ["codex-acp"],
    });
  });

  it("uses an explicitly requested available engine", async () => {
    const { selectEngine } = await import("../src/core/engines/probe.js");
    await expect(selectEngine("codex")).resolves.toMatchObject({
      engine: "codex",
    });
  });

  it("fails when the explicit engine is unavailable", async () => {
    mocks.resolveCodex.mockRejectedValue(new Error("missing auth"));
    const { selectEngine } = await import("../src/core/engines/probe.js");
    await expect(selectEngine("codex")).rejects.toThrow(/codex 不可用/);
  });

  it("selects the only available engine", async () => {
    mocks.resolveClaude.mockRejectedValue(new Error("missing claude"));
    const { selectEngine } = await import("../src/core/engines/probe.js");
    await expect(selectEngine()).resolves.toMatchObject({
      engine: "codex",
    });
  });

  it("randomly selects one of multiple available engines", async () => {
    const { selectEngine } = await import("../src/core/engines/probe.js");
    await expect(selectEngine(undefined, () => 0.75)).resolves.toMatchObject({
      engine: "codex",
    });
  });

  it("fails when no engine is available", async () => {
    mocks.resolveClaude.mockRejectedValue(new Error("missing claude"));
    mocks.resolveCodex.mockRejectedValue(new Error("missing codex"));
    const { selectEngine } = await import("../src/core/engines/probe.js");
    await expect(selectEngine()).rejects.toThrow(/未找到可用 Agent 引擎/);
  });
});
