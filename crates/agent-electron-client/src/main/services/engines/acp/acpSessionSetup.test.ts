import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveSessionForChat,
  LOAD_SESSION_TIMEOUT_MS,
  type AcpSessionLike,
  type SessionSetupDeps,
} from "./acpSessionSetup";

function makeSession(
  id: string,
  overrides: Partial<AcpSessionLike> = {},
): AcpSessionLike {
  return {
    id,
    acpSessionId: id,
    createdAt: Date.now(),
    status: "idle",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SessionSetupDeps> = {}): SessionSetupDeps {
  const sessions = new Map<string, AcpSessionLike>();
  return {
    logTag: "[test]",
    workspaceDir: "/workspace",
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { resume: {} },
    },
    getSession: (id) => sessions.get(id),
    findSessionByProjectId: (pid) => {
      for (const s of sessions.values()) {
        if (s.projectId === pid || s.id === pid) return s;
      }
      return null;
    },
    createSession: vi.fn(async (opts) => {
      const id = "new-session-id";
      sessions.set(id, makeSession(id, { title: opts.title, cwd: opts.cwd }));
      return { id };
    }),
    loadSession: vi.fn(async (sessionId, opts) => {
      const s = makeSession(sessionId, {
        title: opts.title,
        cwd: opts.cwd,
        projectId: opts.title,
      });
      sessions.set(sessionId, s);
      return s;
    }),
    getSessionRecord: (id) => sessions.get(id)!,
    ...overrides,
  };
}

describe("resolveSessionForChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses session from memory by session_id", async () => {
    const existing = makeSession("sess-1");
    const deps = makeDeps({
      getSession: () => existing,
    });

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: "sess-1",
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("memory");
    expect(result.isNewSession).toBe(false);
    expect(deps.loadSession).not.toHaveBeenCalled();
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  it("calls loadSession when memory miss and agent supports load (nuwaxcode)", async () => {
    const deps = makeDeps();

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: "persisted-sess",
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("load");
    expect(result.isNewSession).toBe(false);
    expect(deps.loadSession).toHaveBeenCalledWith(
      "persisted-sess",
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  it("falls back to newSession when agent does not support loadSession", async () => {
    const deps = makeDeps({
      agentCapabilities: { sessionCapabilities: { resume: {} } },
    });

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: "persisted-sess",
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("new");
    expect(result.isNewSession).toBe(true);
    expect(deps.loadSession).not.toHaveBeenCalled();
    expect(deps.createSession).toHaveBeenCalled();
  });

  it("falls back to newSession when loadSession fails", async () => {
    const deps = makeDeps({
      agentCapabilities: { loadSession: true },
      loadSession: vi.fn(async () => {
        throw new Error("load failed");
      }),
    });

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: "old-sess",
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("new");
    expect(result.isNewSession).toBe(true);
    expect(deps.loadSession).toHaveBeenCalled();
    expect(deps.createSession).toHaveBeenCalled();
  });

  it("falls back to newSession when loadSession exceeds timeout", async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps({
        agentCapabilities: { loadSession: true },
        // 永不 resolve，模拟跨引擎 load 挂起（实测约 65s）
        loadSession: vi.fn(() => new Promise(() => {})),
      });

      const pending = resolveSessionForChat(deps, {
        user_id: "u1",
        project_id: "p1",
        session_id: "foreign-engine-uuid",
        prompt: "hi",
      });

      await vi.advanceTimersByTimeAsync(LOAD_SESSION_TIMEOUT_MS);
      const result = await pending;

      expect(result.restoredVia).toBe("new");
      expect(result.isNewSession).toBe(true);
      expect(deps.loadSession).toHaveBeenCalled();
      expect(deps.createSession).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates new session when no session_id", async () => {
    const deps = makeDeps();

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("new");
    expect(result.isNewSession).toBe(true);
    expect(deps.loadSession).not.toHaveBeenCalled();
    expect(deps.createSession).toHaveBeenCalled();
  });
});
