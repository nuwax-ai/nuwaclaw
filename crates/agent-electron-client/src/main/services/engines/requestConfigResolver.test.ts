import { describe, it, expect, vi } from "vitest";
import { buildEffectiveConfig } from "./requestConfigResolver";
import type { AgentConfig } from "./types";
import type { ComputerChatRequest } from "@shared/types/computerTypes";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const base: AgentConfig = {
  engine: "nuwaxcode",
  workspaceDir: "/tmp/workspace",
};

function makeRequest(
  overrides: Partial<ComputerChatRequest> = {},
): ComputerChatRequest {
  return {
    user_id: "user-1",
    project_id: "1553934",
    request_id: "req-1",
    ...overrides,
  } as ComputerChatRequest;
}

describe("buildEffectiveConfig — __isolatedHomeScope", () => {
  it("injects project scope when user_id and project_id are present", () => {
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "nuwaxcode",
      mp: undefined,
      model: "glm-5",
      resolvedEnv: undefined,
      freshMcpServers: undefined,
      request: makeRequest(),
      engineKey: "1553934",
    });

    expect(cfg.__isolatedHomeScope).toEqual({
      kind: "project",
      userId: "user-1",
      workDirId: "1553934",
      engine: "nuwaxcode",
    });
  });

  it("uses agent_work_dir as workDirId when set", () => {
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "claude-code",
      mp: undefined,
      model: "claude-sonnet",
      resolvedEnv: undefined,
      freshMcpServers: undefined,
      request: makeRequest({
        project_id: "1553934",
        agent_work_dir: "custom-work-dir",
      }),
      engineKey: "sess-abc",
    });

    expect(cfg.__isolatedHomeScope).toEqual({
      kind: "project",
      userId: "user-1",
      workDirId: "custom-work-dir",
      engine: "claude-code",
    });
  });

  it("omits scope when user_id is missing", () => {
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "nuwaxcode",
      mp: undefined,
      model: "glm-5",
      resolvedEnv: undefined,
      freshMcpServers: undefined,
      request: makeRequest({ user_id: undefined }),
      engineKey: "1553934",
    });

    expect(cfg.__isolatedHomeScope).toBeUndefined();
  });

  it("omits scope when neither project_id nor agent_work_dir is set", () => {
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "nuwaxcode",
      mp: undefined,
      model: "glm-5",
      resolvedEnv: undefined,
      freshMcpServers: undefined,
      request: makeRequest({
        project_id: undefined,
        agent_work_dir: undefined,
      }),
      engineKey: "default",
    });

    expect(cfg.__isolatedHomeScope).toBeUndefined();
  });
});

describe("buildEffectiveConfig — OPENCODE_PERMISSION", () => {
  it("nuwaxcode 未传 env 时注入代码默认 OPENCODE_PERMISSION", () => {
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "nuwaxcode",
      mp: undefined,
      model: "glm-5",
      resolvedEnv: undefined,
      freshMcpServers: undefined,
      request: makeRequest(),
      engineKey: "1553934",
    });

    expect(cfg.env?.OPENCODE_PERMISSION).toBe(
      '{"bash":"ask","edit":"ask","question":"deny"}',
    );
  });

  it("nuwaxcode chat 传入 OPENCODE_PERMISSION 时原样透传（不自动合并 MCP ask）", () => {
    const custom = '{"bash":"deny","*":"ask","astock_*":"ask"}';
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "nuwaxcode",
      mp: undefined,
      model: "glm-5",
      resolvedEnv: { OPENCODE_PERMISSION: custom },
      freshMcpServers: { astock: { command: "node", args: [] } },
      request: makeRequest({
        agent_config: {
          agent_server: { env: { OPENCODE_PERMISSION: custom } },
        },
      }),
      engineKey: "1553934",
    });

    expect(JSON.parse(cfg.env!.OPENCODE_PERMISSION!)).toEqual({
      bash: "deny",
      "*": "ask",
      "astock_*": "ask",
    });
  });

  it("旧版 nuwaxcode 临时测试：请求可用 *: ask 覆盖 MCP 默认 allow", () => {
    const mcpAskOverride = JSON.stringify({
      bash: "ask",
      edit: "ask",
      question: "deny",
      "*": "ask",
    });
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "nuwaxcode",
      mp: undefined,
      model: "glm-5",
      resolvedEnv: undefined,
      freshMcpServers: { astock: { command: "node", args: [] } },
      request: makeRequest({
        agent_config: {
          agent_server: { env: { OPENCODE_PERMISSION: mcpAskOverride } },
        },
      }),
      engineKey: "1553934",
    });

    expect(cfg.env?.OPENCODE_PERMISSION).toBe(mcpAskOverride);
  });

  it("claude-code 不注入 OPENCODE_PERMISSION", () => {
    const cfg = buildEffectiveConfig({
      base,
      requiredEngine: "claude-code",
      mp: undefined,
      model: "claude-sonnet",
      resolvedEnv: undefined,
      freshMcpServers: undefined,
      request: makeRequest(),
      engineKey: "1553934",
    });

    expect(cfg.env?.OPENCODE_PERMISSION).toBeUndefined();
  });
});
