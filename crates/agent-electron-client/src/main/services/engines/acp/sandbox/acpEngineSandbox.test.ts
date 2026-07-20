import { describe, it, expect, vi } from "vitest";
import {
  getAcpEngineSandboxCapabilities,
  isOpencodeAcpEngine,
  OPENCODE_ACP_ENGINE_IDS,
  usesSandboxedMcpAtSession,
} from "./acpEngineSandbox";
import type { SandboxProcessConfig } from "@shared/types/sandbox";

vi.mock("@main/services/system/dependencies", () => ({
  getResourcesPath: vi.fn(() => "/mock/resources"),
}));

const windowsSandbox: SandboxProcessConfig = {
  enabled: true,
  type: "windows-sandbox",
  mode: "strict",
  windowsSandboxHelperPath: "C:\\helper.exe",
};

describe("acpEngineSandbox", () => {
  it("nuwaxcode and codex-cli share opencode-acp family", () => {
    expect(OPENCODE_ACP_ENGINE_IDS.has("nuwaxcode")).toBe(true);
    expect(OPENCODE_ACP_ENGINE_IDS.has("codex-cli")).toBe(true);
    expect(getAcpEngineSandboxCapabilities("nuwaxcode").family).toBe(
      "opencode-acp",
    );
    expect(getAcpEngineSandboxCapabilities("codex-cli").family).toBe(
      "opencode-acp",
    );
    expect(isOpencodeAcpEngine("nuwaxcode")).toBe(true);
    expect(isOpencodeAcpEngine("claude-code")).toBe(false);
  });

  it("claude-code does not use OPENCODE spawn sandbox config", () => {
    const caps = getAcpEngineSandboxCapabilities("claude-code");
    expect(caps.usesOpencodeSpawnConfig).toBe(false);
    expect(caps.usesCompatMcpLayer()).toBe(false);
  });

  it("unknown custom agent id does not use OPENCODE spawn config", () => {
    const caps = getAcpEngineSandboxCapabilities("__custom_agent__");
    expect(caps.family).toBe("unknown");
    expect(caps.usesOpencodeSpawnConfig).toBe(false);
  });

  it("usesSandboxedMcpAtSession: claude-code on Windows uses session MCP", () => {
    expect(usesSandboxedMcpAtSession("claude-code", windowsSandbox)).toBe(true);
  });

  it("usesSandboxedMcpAtSession: OpenCode strict keeps session MCP for cwd-scoped writes", () => {
    expect(usesSandboxedMcpAtSession("nuwaxcode", windowsSandbox)).toBe(true);
  });

  it("usesSandboxedMcpAtSession: disabled when sandbox off", () => {
    expect(
      usesSandboxedMcpAtSession("claude-code", {
        ...windowsSandbox,
        enabled: false,
      }),
    ).toBe(false);
  });
});
