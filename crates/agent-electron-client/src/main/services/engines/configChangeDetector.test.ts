/**
 * 单元测试: configChangeDetector — 引擎配置变更检测
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { detectEngineConfigChange } from "./configChangeDetector";
import type { AgentConfig } from "./types";

const baseConfig: AgentConfig = {
  engine: "nuwaxcode",
  workspaceDir: "/tmp/ws",
  model: "model-a",
  apiKey: "key-a",
  baseUrl: "https://api.a",
  env: { FOO: "1" },
};

function stored(overrides?: Partial<AgentConfig>) {
  return {
    projectId: "p1",
    currentConfig: { ...baseConfig, ...overrides },
    storedRawMcp: undefined,
  };
}

const noChangeParams = {
  requiredEngine: null,
  resolvedEnv: undefined,
  model: undefined,
  mp: undefined,
  requestMcpServersEarly: {},
};

describe("detectEngineConfigChange", () => {
  it("无任何变化时返回 false", () => {
    expect(detectEngineConfigChange(stored(), noChangeParams)).toBe(false);
  });

  it("引擎切换返回 true", () => {
    expect(
      detectEngineConfigChange(stored(), {
        ...noChangeParams,
        requiredEngine: "claude-code",
      }),
    ).toBe(true);
  });

  it("引擎相同不触发", () => {
    expect(
      detectEngineConfigChange(stored(), {
        ...noChangeParams,
        requiredEngine: "nuwaxcode",
      }),
    ).toBe(false);
  });

  it("model 变更返回 true", () => {
    expect(
      detectEngineConfigChange(stored(), {
        ...noChangeParams,
        model: "model-b",
      }),
    ).toBe(true);
  });

  it("apiKey / baseUrl 变更返回 true", () => {
    expect(
      detectEngineConfigChange(stored(), {
        ...noChangeParams,
        mp: { api_key: "key-b" } as any,
      }),
    ).toBe(true);
    expect(
      detectEngineConfigChange(stored(), {
        ...noChangeParams,
        mp: { base_url: "https://api.b" } as any,
      }),
    ).toBe(true);
  });

  it("env 内容变更返回 true，相同（不同 key 顺序）不触发", () => {
    expect(
      detectEngineConfigChange(stored({ env: { FOO: "1", BAR: "2" } }), {
        ...noChangeParams,
        resolvedEnv: { BAR: "2", FOO: "1" },
      }),
    ).toBe(false);
    expect(
      detectEngineConfigChange(stored(), {
        ...noChangeParams,
        resolvedEnv: { FOO: "changed" },
      }),
    ).toBe(true);
  });

  it("MCP 列表与存量快照不同返回 true，相同不触发", () => {
    const mcp = { srv: { command: "uvx", args: ["tool"] } };
    expect(
      detectEngineConfigChange(
        { ...stored(), storedRawMcp: mcp },
        { ...noChangeParams, requestMcpServersEarly: mcp },
      ),
    ).toBe(false);
    expect(
      detectEngineConfigChange(
        { ...stored(), storedRawMcp: undefined },
        { ...noChangeParams, requestMcpServersEarly: mcp },
      ),
    ).toBe(true);
  });
});
