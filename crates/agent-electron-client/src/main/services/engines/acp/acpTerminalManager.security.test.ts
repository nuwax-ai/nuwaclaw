import { describe, expect, it } from "vitest";
import {
  buildTerminalSandboxEnv,
  resolveSandboxCwdWithFallback,
  resolveSandboxCwdWithinRoots,
  TERMINAL_SANDBOX_SAFE_ENV_KEYS,
} from "./acpTerminalManager";

describe("AcpTerminalManager security helpers", () => {
  it("should only keep safe env keys in sandbox env", () => {
    const hostEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      TEMP: "/tmp",
      ANTHROPIC_API_KEY: "secret-key",
      OPENAI_API_KEY: "secret-openai",
      HOME: "/Users/demo",
    };

    const env = buildTerminalSandboxEnv(hostEnv, [
      { name: "CUSTOM", value: "1" },
    ]);

    expect(env.PATH).toBe("/usr/bin");
    expect(env.TEMP).toBe("/tmp");
    expect(env.HOME).toBe("/Users/demo");
    expect(env.CUSTOM).toBe("1");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();

    for (const key of Object.keys(env)) {
      if (key === "CUSTOM") continue;
      expect(
        (TERMINAL_SANDBOX_SAFE_ENV_KEYS as readonly string[]).includes(key),
      ).toBe(true);
    }
  });

  it("should allow cwd within writable root", () => {
    const cwd = resolveSandboxCwdWithinRoots("/workspace/project/subdir", [
      "/workspace/project",
    ]);
    expect(cwd).toBe("/workspace/project/subdir");
  });

  it("should reject cwd outside writable roots", () => {
    expect(() =>
      resolveSandboxCwdWithinRoots("/outside/path", ["/workspace/project"]),
    ).toThrow(/outside writable roots/i);
  });

  it("should fallback to first writable root when cwd is omitted", () => {
    const result = resolveSandboxCwdWithFallback(
      undefined,
      ["/workspace/project", "/workspace/cache"],
      "/outside/host-cwd",
    );
    expect(result).toEqual({
      cwd: "/workspace/project",
      usedFallback: true,
    });
  });

  it("should fallback to first writable root when cwd is outside writable roots", () => {
    const result = resolveSandboxCwdWithFallback(
      "/outside/path",
      ["/workspace/project", "/workspace/cache"],
      "/outside/host-cwd",
    );
    expect(result).toEqual({
      cwd: "/workspace/project",
      usedFallback: true,
    });
  });

  it("should keep cwd when it is within writable roots", () => {
    const result = resolveSandboxCwdWithFallback(
      "/workspace/project/subdir",
      ["/workspace/project", "/workspace/cache"],
      "/outside/host-cwd",
    );
    expect(result).toEqual({
      cwd: "/workspace/project/subdir",
      usedFallback: false,
    });
  });
});
