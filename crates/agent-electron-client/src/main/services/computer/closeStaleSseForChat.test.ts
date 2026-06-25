import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerResponse } from "http";

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../bootstrap/logConfig", () => ({
  getPerfLogger: () => ({ info: vi.fn() }),
}));

vi.mock("../engines/perf/firstTokenTrace", () => ({
  firstTokenTrace: { trace: vi.fn() },
}));

import {
  sseClients,
  registerSseClient,
  bindSessionFirstTokenContext,
} from "./sseManager";
import {
  collectStaleSseSessionIds,
  closeStaleSseBeforeChat,
} from "./closeStaleSseForChat";
import {
  rememberProjectSession,
  clearProjectSessionRegistry,
} from "./projectSessionRegistry";

function mockResponse(): ServerResponse {
  return { end: vi.fn(), write: vi.fn() } as unknown as ServerResponse;
}

describe("collectStaleSseSessionIds", () => {
  beforeEach(() => {
    clearProjectSessionRegistry();
  });

  it("includes session_id from body, registry, and engine lookup", () => {
    rememberProjectSession("1553934", "ses-from-registry");
    const acpEngine = {
      findSessionByProjectId: vi.fn((key: string) =>
        key === "1553934" ? { id: "ses-from-engine" } : null,
      ),
    };

    const ids = collectStaleSseSessionIds(
      {
        user_id: "6",
        project_id: "1553934",
        session_id: "ses-from-body",
        prompt: "hi",
      },
      acpEngine,
    );

    expect(ids).toEqual(
      expect.arrayContaining([
        "ses-from-body",
        "ses-from-registry",
        "ses-from-engine",
      ]),
    );
    expect(ids).toHaveLength(3);
  });
});

describe("closeStaleSseBeforeChat", () => {
  const sessionId = "ses-stale-chat";

  beforeEach(() => {
    clearProjectSessionRegistry();
    sseClients.clear();
  });

  it("closes registered SSE clients for the project session", () => {
    rememberProjectSession("proj-1", sessionId);
    const res = mockResponse();
    registerSseClient(sessionId, res);

    closeStaleSseBeforeChat(
      {
        user_id: "1",
        project_id: "proj-1",
        prompt: "hello",
      },
      { findSessionByProjectId: () => null },
    );

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(sseClients.has(sessionId)).toBe(false);
  });

  it("closes orphan SSE when TTFT context matches project but registry rotated", () => {
    const orphanId = "ses-orphan-old";
    const res = mockResponse();
    registerSseClient(orphanId, res);
    bindSessionFirstTokenContext(orphanId, {
      requestId: "rid-1",
      projectId: "proj-1",
      engine: "nuwaxcode",
      chatReceivedAt: Date.now(),
      isNewSession: false,
    });
    rememberProjectSession("proj-1", "ses-new-registry");

    closeStaleSseBeforeChat(
      {
        user_id: "1",
        project_id: "proj-1",
        session_id: "ses-new-registry",
        prompt: "hello",
      },
      { findSessionByProjectId: () => ({ id: "ses-new-registry" }) },
    );

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(sseClients.has(orphanId)).toBe(false);
  });
});
