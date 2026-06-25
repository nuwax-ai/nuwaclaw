/**
 * reload + load 链路：SSE 缓冲清理与 load 不回放历史。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) =>
      name === "home" ? "/mock/home" : "/mock/appdata",
    ),
    getVersion: vi.fn(() => "0.0.0-test"),
    isPackaged: false,
  },
}));

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../memory", () => ({
  memoryService: {
    isInitialized: vi.fn(() => false),
    init: vi.fn().mockResolvedValue(undefined),
    ensureMemoryReadyForSession: vi.fn().mockResolvedValue(undefined),
    onSessionEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockFindEngineForStop = vi.fn();
const mockStopEngine = vi.fn();

vi.mock("../engines/unifiedAgent", () => ({
  agentService: {
    findEngineForStop: (...args: unknown[]) => mockFindEngineForStop(...args),
    stopEngine: (...args: unknown[]) => mockStopEngine(...args),
  },
}));

import { reloadEngineForRequest } from "./devcomputerAutoReload";
import {
  clearAllSseEventBuffers,
  getSseEventBufferSize,
  pushSseEvent,
} from "./sseManager";
import { AcpEngine } from "../engines/acp/acpEngine";

describe("devcomputer reload + load SSE hygiene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllSseEventBuffers();
    mockStopEngine.mockResolvedValue(true);
  });

  it("reload 清掉旧 SSE 缓冲，load 期间不写入历史 replay", async () => {
    const sessionId = "sess-history-1";
    pushSseEvent(sessionId, "agentSessionUpdate", {
      sessionId,
      subType: "text",
      data: { role: "assistant", text: "old message" },
    });
    expect(getSseEventBufferSize(sessionId)).toBe(1);

    mockFindEngineForStop.mockReturnValue({
      engine: {
        listSessions: vi.fn().mockResolvedValue([{ id: sessionId }]),
        getIsolatedHome: () => null,
      },
      registryKey: "proj-1",
    });

    const reloaded = await reloadEngineForRequest({
      user_id: "u1",
      project_id: "proj-1",
      session_id: sessionId,
      prompt: "continue",
      agent_config: { auto_reload: { enabled: true } },
    });

    expect(reloaded).toBe(true);
    expect(getSseEventBufferSize(sessionId)).toBe(0);

    const loadSession = vi.fn().mockResolvedValue({
      modes: { currentModeId: "yolo", availableModes: [] },
    });
    const setSessionMode = vi.fn().mockResolvedValue({});
    const prompt = vi.fn().mockResolvedValue({ stopReason: "end_turn" });

    const engine = new AcpEngine("nuwaxcode");
    (engine as any).config = {
      engine: "nuwaxcode",
      workspaceDir: "/workspace/project",
      mcpServers: {},
    };
    (engine as any).agentCapabilities = {
      loadSession: true,
    };
    (engine as any).acpConnection = {
      loadSession,
      setSessionMode,
      newSession: vi.fn(),
      prompt,
      cancel: vi.fn(),
    };

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: sessionId,
      prompt: "continue",
      request_id: "req-2",
      agent_config: { agent_server: { agent_mode: "ask" } },
    });

    expect(result.success).toBe(true);
    expect(loadSession).toHaveBeenCalled();
    expect(setSessionMode).toHaveBeenCalledWith({
      sessionId,
      modeId: "ask",
    });
    expect(getSseEventBufferSize(sessionId)).toBe(0);
  });
});
