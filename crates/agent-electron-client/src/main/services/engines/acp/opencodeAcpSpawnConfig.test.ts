import { describe, it, expect } from "vitest";
import {
  buildOpencodeSpawnConfig,
  buildOpencodeMcpSection,
  describeOpencodeSandboxActive,
} from "./opencodeAcpSpawnConfig";
import type { SandboxProcessConfig } from "@shared/types/sandbox";

describe("opencodeAcpSpawnConfig", () => {
  it("buildOpencodeMcpSection maps stdio and http servers", () => {
    const mcp = buildOpencodeMcpSection({
      local: { command: "node", args: ["a.js"], env: { FOO: "1" } },
      remote: { url: "http://localhost/mcp", type: "sse" },
    });
    expect(mcp).toMatchObject({
      local: {
        type: "local",
        command: ["node", "a.js"],
        environment: { FOO: "1" },
      },
      remote: { type: "sse", url: "http://localhost/mcp" },
    });
  });

  it("buildOpencodeSpawnConfig applies sandbox via callback", () => {
    const sandboxConfig: SandboxProcessConfig = {
      enabled: true,
      type: "windows-sandbox",
      mode: "strict",
    };
    const { configObj, sandboxApply } = buildOpencodeSpawnConfig({
      sandboxConfig,
      workspaceDir: "/ws",
      applySandbox: ({ configObj: obj }) => {
        obj.sandbox = { mode: "strict" };
        return {
          opencodeSandboxConfigInjected: true,
          builtinBashDenied: true,
          builtinEditDenied: false,
          engineVersion: "1.2.0",
          usesNativeSandbox: true,
        };
      },
    });
    expect(configObj.sandbox).toEqual({ mode: "strict" });
    expect(sandboxApply?.engineVersion).toBe("1.2.0");
    expect(describeOpencodeSandboxActive(sandboxApply)).toMatchObject({
      path: "opencode-config-sandbox",
    });
  });
});
