/**
 * buildNewSessionParams 单测 —— MCP server 名 ACP 下发前规范化。
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) =>
      name === "home" ? "/mock/home" : "/mock/appdata",
    ),
  },
}));

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@main/services/packages/guiAgentServer", () => ({
  getGuiAgentServerUrl: vi.fn(() => null),
}));

vi.mock("@main/services/packages/windowsMcp", () => ({
  getWindowsMcpUrl: vi.fn(() => null),
}));

vi.mock("@main/services/system/dependencies", () => ({
  getResourcesPath: vi.fn(() => "/mock/resources"),
  getRipgrepBinPath: vi.fn(() => "/mock/rg"),
}));

vi.mock("fs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("fs")>();
  return { ...mod, existsSync: vi.fn(() => false) };
});

import { buildNewSessionParams } from "./acpNewSessionParams";
import { MCP_IDENTIFIER_PATTERN } from "@main/services/utils/mcpServerName";
import type { AgentConfig } from "../types";

describe("buildNewSessionParams — MCP name sanitization", () => {
  it("sanitizes Chinese local MCP server names for ACP", () => {
    const config = {
      workspaceDir: "/workspace",
      mcpServers: {
        A股股票查询: {
          command: "node",
          args: ["stock-mcp.js"],
        },
        "chrome-devtools": {
          url: "http://127.0.0.1:9222/mcp",
        },
      },
    } as AgentConfig;

    const { mcpServers } = buildNewSessionParams(undefined, {
      config,
      storedSandboxConfig: null,
      engineName: "deepagents-flow-ts",
      logTag: "[test]",
    });

    const names = mcpServers.map((m) => m.name);
    expect(names).toContain("A");
    expect(names).toContain("chrome-devtools");
    expect(names.every((n) => MCP_IDENTIFIER_PATTERN.test(n))).toBe(true);
  });
});
