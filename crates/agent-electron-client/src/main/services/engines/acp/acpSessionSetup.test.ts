import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveSessionForChat,
  LOAD_SESSION_TIMEOUT_MS,
  isSessionIdCompatibleWithEngine,
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
    // 默认按 nuwaxcode 测 load；跨引擎用例会覆盖 engineName
    engineName: "nuwaxcode",
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

describe("isSessionIdCompatibleWithEngine", () => {
  it("nuwaxcode only accepts ses_*", () => {
    expect(
      isSessionIdCompatibleWithEngine(
        "ses_010f31944ffe3OywvJ8AmMo0lT",
        "nuwaxcode",
      ),
    ).toBe(true);
    expect(
      isSessionIdCompatibleWithEngine(
        "41c20e6b-f7df-4a9f-beea-cd375bc320eb",
        "nuwaxcode",
      ),
    ).toBe(false);
    expect(isSessionIdCompatibleWithEngine("persisted-sess", "nuwaxcode")).toBe(
      false,
    );
  });

  it("claude-code rejects ses_* but accepts UUID and other ids", () => {
    expect(
      isSessionIdCompatibleWithEngine(
        "ses_010f31944ffe3OywvJ8AmMo0lT",
        "claude-code",
      ),
    ).toBe(false);
    expect(
      isSessionIdCompatibleWithEngine(
        "41c20e6b-f7df-4a9f-beea-cd375bc320eb",
        "claude-code",
      ),
    ).toBe(true);
    expect(
      isSessionIdCompatibleWithEngine("persisted-sess", "claude-code"),
    ).toBe(true);
  });

  it("unknown engines allow load (timeout fallback)", () => {
    expect(
      isSessionIdCompatibleWithEngine(
        "41c20e6b-f7df-4a9f-beea-cd375bc320eb",
        "codex-cli",
      ),
    ).toBe(true);
    expect(isSessionIdCompatibleWithEngine("ses_abc", "codex-cli")).toBe(true);
  });
});

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

  it("calls loadSession when memory miss and agent supports load (nuwaxcode ses_*)", async () => {
    const deps = makeDeps();
    const sesId = "ses_010f31944ffe3OywvJ8AmMo0lT";

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: sesId,
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("load");
    expect(result.isNewSession).toBe(false);
    expect(deps.loadSession).toHaveBeenCalledWith(
      sesId,
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  it("skips loadSession when Claude UUID is passed to nuwaxcode", async () => {
    const deps = makeDeps({ engineName: "nuwaxcode" });
    const claudeUuid = "41c20e6b-f7df-4a9f-beea-cd375bc320eb";

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: claudeUuid,
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("new");
    expect(result.isNewSession).toBe(true);
    expect(deps.loadSession).not.toHaveBeenCalled();
    expect(deps.createSession).toHaveBeenCalled();
  });

  it("skips loadSession when OpenCode ses_* is passed to claude-code", async () => {
    const deps = makeDeps({ engineName: "claude-code" });
    const sesId = "ses_010f31944ffe3OywvJ8AmMo0lT";

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: sesId,
      prompt: "hi",
    });

    expect(result.restoredVia).toBe("new");
    expect(result.isNewSession).toBe(true);
    expect(deps.loadSession).not.toHaveBeenCalled();
    expect(deps.createSession).toHaveBeenCalled();
  });

  it("falls back to newSession when agent does not support loadSession", async () => {
    const deps = makeDeps({
      agentCapabilities: { sessionCapabilities: { resume: {} } },
    });

    const result = await resolveSessionForChat(deps, {
      user_id: "u1",
      project_id: "p1",
      session_id: "ses_supported-but-caps-off",
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
      session_id: "ses_old-sess",
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
        // 永不 resolve，模拟同引擎 load 挂起
        loadSession: vi.fn(() => new Promise(() => {})),
      });

      const pending = resolveSessionForChat(deps, {
        user_id: "u1",
        project_id: "p1",
        session_id: "ses_hung-same-engine",
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
