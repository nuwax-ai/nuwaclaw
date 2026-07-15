import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync,
}));

describe("update command", () => {
  let savedUserAgent: string | undefined;

  beforeEach(() => {
    savedUserAgent = process.env.npm_config_user_agent;
    delete process.env.npm_config_user_agent;
    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which") return { status: 0, stdout: `${args[0]}\n` };
      return { status: 0, stdout: "" };
    });
  });

  afterEach(() => {
    if (savedUserAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = savedUserAgent;
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it("normalizes update targets and install args", async () => {
    const { normalizeUpdateTarget, buildInstallArgs } =
      await import("../src/commands/update.js");
    expect(normalizeUpdateTarget()).toBe("latest");
    expect(normalizeUpdateTarget("v0.2.0")).toBe("0.2.0");
    expect(buildInstallArgs("npm", "@nuwax-ai/nuwa-cli@latest")).toEqual([
      "install",
      "-g",
      "@nuwax-ai/nuwa-cli@latest",
    ]);
    expect(
      buildInstallArgs("pnpm", "@nuwax-ai/nuwa-cli@0.2.0", "https://r.example"),
    ).toEqual([
      "add",
      "-g",
      "@nuwax-ai/nuwa-cli@0.2.0",
      "--registry",
      "https://r.example",
    ]);
  });

  it("infers pnpm from npm_config_user_agent", async () => {
    process.env.npm_config_user_agent = "pnpm/10.0.0 npm/? node/v22";
    const { inferPackageManager } = await import("../src/commands/update.js");
    expect(inferPackageManager()).toBe("pnpm");
  });

  it("prints the install command without running it in dry-run mode", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand(
      "0.2.0",
      { dryRun: true, packageManager: "npm" },
      runner,
    );

    expect(runner).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("升级目标：@nuwax-ai/nuwa-cli@0.2.0");
    expect(printed).toContain("执行：npm install -g @nuwax-ai/nuwa-cli@0.2.0");
  });

  it("checks a remote version without installing", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0, stdout: "0.2.0\n" }));

    await updateCommand(
      undefined,
      { check: true, packageManager: "npm" },
      runner,
    );

    expect(runner).toHaveBeenCalledWith(
      "npm",
      ["view", "@nuwax-ai/nuwa-cli@latest", "version"],
      expect.objectContaining({ stdio: "pipe" }),
    );
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("@nuwax-ai/nuwa-cli@latest：0.2.0");
  });

  it("runs global install through the selected package manager", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand(undefined, { packageManager: "pnpm" }, runner);

    expect(runner).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", "@nuwax-ai/nuwa-cli@latest"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });
});
