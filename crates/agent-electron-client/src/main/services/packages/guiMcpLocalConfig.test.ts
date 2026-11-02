/**
 * 单元测试：GUI MCP 与本地 mcp_local_config 联动
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GUI_MCP_SERVER_ID } from "@shared/constants";

const mockGet = vi.fn();
const mockRun = vi.fn();

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockReadSetting = vi.fn();
const mockWriteSetting = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: mockGet,
      run: mockRun,
    })),
  })),
  readSetting: (...args: unknown[]) => mockReadSetting(...args),
  writeSetting: (...args: unknown[]) => mockWriteSetting(...args),
}));

vi.mock("@shared/featureFlags", () => ({
  FEATURES: { ENABLE_GUI_AGENT_SERVER: true },
}));

vi.mock("./guiAgentServer", () => ({
  getGuiMcpPort: vi.fn(() => 60008),
}));

import {
  syncGuiAgentLocalMcpConfig,
  buildGuiMcpLocalUrl,
  applyGuiMcpLocalConfigPolicy,
} from "./guiMcpLocalConfig";
import { isGuiMcpManagedServerId } from "@shared/guiMcp";

describe("guiMcpLocalConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue(undefined);
    mockReadSetting.mockReturnValue({ guiMcpEnabled: false });
  });

  it("buildGuiMcpLocalUrl 应使用 guiMcpPort 构建本地 URL", () => {
    expect(buildGuiMcpLocalUrl()).toBe("http://127.0.0.1:60008/mcp");
  });

  it("isGuiMcpManagedServerId 应忽略大小写匹配 gui-agent", () => {
    expect(isGuiMcpManagedServerId("gui-agent")).toBe(true);
    expect(isGuiMcpManagedServerId("GUI-Agent")).toBe(true);
    expect(isGuiMcpManagedServerId("filesystem")).toBe(false);
  });

  it("开启时应 upsert gui-agent 并强制 enabled", () => {
    syncGuiAgentLocalMcpConfig(true);
    expect(mockRun).toHaveBeenCalledWith(
      "mcp_local_config",
      expect.any(String),
    );
    const saved = JSON.parse(mockRun.mock.calls[0][1] as string);
    expect(saved.mcpServers[GUI_MCP_SERVER_ID]).toEqual({
      url: "http://127.0.0.1:60008/mcp",
      transport: "streamable-http",
      enabled: true,
    });
  });

  it("关闭时应从 mcp_local_config 移除 gui-agent 并保留其他条目", () => {
    mockGet.mockReturnValue({
      value: JSON.stringify({
        mcpServers: {
          [GUI_MCP_SERVER_ID]: {
            url: "http://127.0.0.1:60008/mcp",
            enabled: true,
          },
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            enabled: false,
          },
        },
      }),
    });

    syncGuiAgentLocalMcpConfig(false);

    const saved = JSON.parse(mockRun.mock.calls[0][1] as string);
    expect(saved.mcpServers[GUI_MCP_SERVER_ID]).toBeUndefined();
    expect(saved.mcpServers.filesystem).toBeDefined();
  });

  it("applyGuiMcpLocalConfigPolicy 在关闭时应剥离 gui-agent", () => {
    mockReadSetting.mockReturnValue({ guiMcpEnabled: false });
    const result = applyGuiMcpLocalConfigPolicy({
      mcpServers: {
        [GUI_MCP_SERVER_ID]: {
          url: "http://127.0.0.1:60008/mcp",
          enabled: true,
        },
        filesystem: { command: "npx", args: [], enabled: true },
      },
    });
    expect(result.mcpServers[GUI_MCP_SERVER_ID]).toBeUndefined();
    expect(result.mcpServers.filesystem).toBeDefined();
  });

  it("applyGuiMcpLocalConfigPolicy 在开启时应强制 gui-agent 为 enabled", () => {
    mockReadSetting.mockReturnValue({ guiMcpEnabled: true });
    const result = applyGuiMcpLocalConfigPolicy({
      mcpServers: {
        [GUI_MCP_SERVER_ID]: {
          url: "http://127.0.0.1:60008/mcp",
          enabled: false,
        },
      },
    });
    expect(result.mcpServers[GUI_MCP_SERVER_ID]?.enabled).toBe(true);
  });
});
