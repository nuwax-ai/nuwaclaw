import { describe, expect, it } from "vitest";
import {
  pickTtydBundledEnv,
  toBashEnvScript,
  toPowerShellEnvScript,
} from "./ttydBundledEnvExport";

describe("ttydBundledEnvExport", () => {
  it("picks only ttyd-relevant keys", () => {
    const picked = pickTtydBundledEnv({
      PATH: "/a:/b",
      NODE_PATH: "/node_modules",
      UV_TOOL_DIR: "/uv/tools",
      PNPM_HOME: "/pnpm/home",
      NPM_CONFIG_REGISTRY: "https://registry.example.com",
      NUWAXCODE_RIPGREP_DIR: "/rg",
      HOME: "/should-not-be-exported",
      RANDOM: "x",
    });

    expect(picked.PATH).toBe("/a:/b");
    expect(picked.NODE_PATH).toBe("/node_modules");
    expect(picked.UV_TOOL_DIR).toBe("/uv/tools");
    expect(picked.PNPM_HOME).toBe("/pnpm/home");
    expect(picked.NPM_CONFIG_REGISTRY).toBe("https://registry.example.com");
    expect(picked.NUWAXCODE_RIPGREP_DIR).toBe("/rg");
    expect(picked.HOME).toBeUndefined();
    expect(picked.RANDOM).toBeUndefined();
  });

  it("renders bash env script with export lines", () => {
    const script = toBashEnvScript(
      pickTtydBundledEnv({
        PATH: "/a:/b",
        UV_INDEX_URL: "https://pypi.example.com/simple",
      }),
    );
    expect(script).toContain("#!/bin/bash");
    expect(script).toContain("export PATH=");
    expect(script).toContain("export UV_INDEX_URL=");
  });

  it("renders powershell env script with $env assignments", () => {
    const script = toPowerShellEnvScript(
      pickTtydBundledEnv({
        PATH: "C:\\a;C:\\b",
        PNPM_HOME: "C:\\pnpm",
      }),
    );
    expect(script).toContain("$env:PATH =");
    expect(script).toContain("$env:PNPM_HOME =");
  });
});
