import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComputerChatRequest } from "@shared/types/computerTypes";

const mockFindEngineForStop = vi.fn();
const mockStopEngine = vi.fn();
const mockClearSseEventBuffer = vi.fn();

vi.mock("../engines/unifiedAgent", () => ({
  agentService: {
    findEngineForStop: (...args: unknown[]) => mockFindEngineForStop(...args),
    stopEngine: (...args: unknown[]) => mockStopEngine(...args),
    getAgentConfig: () => ({ workspaceDir: "/workspace" }),
  },
}));

vi.mock("./sseManager", () => ({
  clearSseEventBuffer: (...args: unknown[]) => mockClearSseEventBuffer(...args),
}));

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  shouldAutoReload,
  reloadEngineForRequest,
  attachReloadedToChatResult,
  buildChatErrorWithReload,
} from "./devcomputerAutoReload";
import {
  resolveChatEngineKey,
  resolveChatEngineKeyCandidates,
} from "./chatEngineKey";
import {
  resolveProjectSession,
  clearProjectSessionRegistry,
} from "./projectSessionRegistry";

function chatRequest(
  overrides: Partial<ComputerChatRequest> = {},
): ComputerChatRequest {
  return {
    user_id: "u1",
    project_id: "proj-1",
    prompt: "hello",
    agent_config: { auto_reload: { enabled: true } },
    ...overrides,
  };
}

function mockEngine(overrides: Record<string, unknown> = {}) {
  return {
    listSessions: vi.fn().mockResolvedValue([]),
    getIsolatedHome: () => null,
    ...overrides,
  };
}

describe("devcomputerAutoReload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProjectSessionRegistry();
    mockStopEngine.mockResolvedValue(true);
  });

  describe("shouldAutoReload", () => {
    it("returns true for devcomputer with auto_reload enabled", () => {
      expect(shouldAutoReload(chatRequest(), "devcomputer")).toBe(true);
    });

    it("returns false for computer source", () => {
      expect(shouldAutoReload(chatRequest(), "computer")).toBe(false);
    });

    it("returns false when auto_reload.enabled is false", () => {
      expect(
        shouldAutoReload(
          chatRequest({
            agent_config: { auto_reload: { enabled: false } },
          }),
          "devcomputer",
        ),
      ).toBe(false);
    });
  });

  describe("reloadEngineForRequest", () => {
    it("returns false when no engine exists (first dev chat)", async () => {
      mockFindEngineForStop.mockReturnValue(null);

      const reloaded = await reloadEngineForRequest(chatRequest());

      expect(reloaded).toBe(false);
      expect(mockStopEngine).not.toHaveBeenCalled();
      expect(mockClearSseEventBuffer).not.toHaveBeenCalled();
    });

    it("returns false when stopEngine fails", async () => {
      mockFindEngineForStop.mockReturnValue({
        engine: mockEngine({
          listSessions: vi.fn().mockResolvedValue([{ id: "sess-a" }]),
        }),
        registryKey: "proj-1",
      });
      mockStopEngine.mockResolvedValue(false);

      const reloaded = await reloadEngineForRequest(chatRequest());

      expect(reloaded).toBe(false);
      expect(mockStopEngine).toHaveBeenCalledWith("proj-1");
    });

    it("clears SSE buffers and stops engine when engine exists", async () => {
      const listSessions = vi
        .fn()
        .mockResolvedValue([{ id: "sess-a" }, { id: "sess-b" }]);
      mockFindEngineForStop.mockReturnValue({
        engine: mockEngine({ listSessions }),
        registryKey: "proj-1",
      });

      const reloaded = await reloadEngineForRequest(
        chatRequest({ session_id: "sess-a" }),
      );

      expect(reloaded).toBe(true);
      expect(mockClearSseEventBuffer).toHaveBeenCalledWith("sess-a");
      expect(mockClearSseEventBuffer).toHaveBeenCalledWith("sess-b");
      expect(mockStopEngine).toHaveBeenCalledWith("proj-1");
    });

    it("captures session ids to registry before stop", async () => {
      const listSessions = vi
        .fn()
        .mockResolvedValue([{ id: "sess-a" }, { id: "sess-b" }]);
      mockFindEngineForStop.mockReturnValue({
        engine: mockEngine({ listSessions }),
        registryKey: "1553935",
      });

      await reloadEngineForRequest(
        chatRequest({
          project_id: "1553935",
          session_id: "sess-a",
        }),
      );

      expect(resolveProjectSession("1553935")).toBe("sess-a");
    });

    it("uses project_id candidate when session_id absent", async () => {
      mockFindEngineForStop.mockImplementation((key: string) => {
        if (key === "proj-1") {
          return { engine: mockEngine(), registryKey: "proj-1" };
        }
        return null;
      });

      await reloadEngineForRequest(chatRequest());

      expect(mockFindEngineForStop).toHaveBeenCalledWith("proj-1");
      expect(mockStopEngine).toHaveBeenCalledWith("proj-1");
    });

    it("prefers agent_work_dir candidate when both differ", async () => {
      mockFindEngineForStop.mockImplementation((key: string) => {
        if (key === "work-dir-a") {
          return { engine: mockEngine(), registryKey: "work-dir-a" };
        }
        return null;
      });

      await reloadEngineForRequest(
        chatRequest({
          agent_work_dir: "work-dir-a",
          project_id: "proj-b",
        }),
      );

      expect(mockFindEngineForStop).toHaveBeenCalledWith("work-dir-a");
      expect(mockStopEngine).toHaveBeenCalledWith("work-dir-a");
    });

    it("falls back to project_id when engine is registered under project_id only", async () => {
      mockFindEngineForStop.mockImplementation((key: string) => {
        if (key === "work-dir-a") return null;
        if (key === "proj-b") {
          return { engine: mockEngine(), registryKey: "proj-b" };
        }
        return null;
      });

      await reloadEngineForRequest(
        chatRequest({
          agent_work_dir: "work-dir-a",
          project_id: "proj-b",
        }),
      );

      expect(mockFindEngineForStop).toHaveBeenCalledWith("work-dir-a");
      expect(mockFindEngineForStop).toHaveBeenCalledWith("proj-b");
      expect(mockStopEngine).toHaveBeenCalledWith("proj-b");
    });
  });

  describe("resolveChatEngineKey", () => {
    it("matches ensureEngineForRequest key order", () => {
      expect(
        resolveChatEngineKey(
          chatRequest({
            agent_work_dir: "work-a",
            project_id: "proj-b",
            session_id: "sess-c",
          }),
        ),
      ).toBe("work-a");
      expect(
        resolveChatEngineKey(
          chatRequest({ project_id: "proj-b", session_id: "sess-c" }),
        ),
      ).toBe("proj-b");
      expect(
        resolveChatEngineKey(
          chatRequest({ session_id: "sess-c", project_id: undefined }),
        ),
      ).toBe("sess-c");
    });

    it("resolveChatEngineKeyCandidates dedupes", () => {
      expect(
        resolveChatEngineKeyCandidates(
          chatRequest({ project_id: "proj-1", session_id: "sess-a" }),
        ),
      ).toEqual(["proj-1", "sess-a"]);
    });
  });
});

describe("attachReloadedToChatResult", () => {
  const body = chatRequest({ session_id: "sess-1" });

  it("sets reloaded on successful result.data", () => {
    const result = {
      code: "0000",
      message: "success",
      success: true,
      tid: null,
      data: {
        project_id: "proj-1",
        session_id: "sess-1",
      },
    };
    attachReloadedToChatResult(result, body, true);
    expect(result.data?.reloaded).toBe(true);
  });

  it("sets reloaded=false on success when engine was not reloaded", () => {
    const result = {
      code: "0000",
      message: "success",
      success: true,
      tid: null,
      data: {
        project_id: "proj-1",
        session_id: "sess-1",
      },
    };
    attachReloadedToChatResult(result, body, false);
    expect(result.data?.reloaded).toBe(false);
  });

  it("creates data with reloaded when chat failed but engine was reloaded", () => {
    const result = {
      code: "5000",
      message: "prompt failed",
      success: false,
      tid: null,
      data: null,
    };
    attachReloadedToChatResult(result, body, true);
    expect(result.data?.reloaded).toBe(true);
    expect(result.data?.error).toBe("prompt failed");
    expect(result.data?.session_id).toBe("sess-1");
  });

  it("no-op when engineReloaded is false", () => {
    const result = {
      code: "5000",
      message: "err",
      success: false,
      tid: null,
      data: null,
    };
    attachReloadedToChatResult(result, body, false);
    expect(result.data).toBeNull();
  });
});

describe("buildChatErrorWithReload", () => {
  it("includes reloaded in data when engine was stopped", () => {
    const err = buildChatErrorWithReload(
      chatRequest({ session_id: "sess-1" }),
      "5000",
      "Engine switch failed",
      true,
    );
    expect(err.success).toBe(false);
    expect(err.data?.reloaded).toBe(true);
    expect(err.data?.error).toBe("Engine switch failed");
  });

  it("keeps data null when no reload happened", () => {
    const err = buildChatErrorWithReload(
      chatRequest(),
      "5000",
      "Engine switch failed",
      false,
    );
    expect(err.data).toBeNull();
  });
});
