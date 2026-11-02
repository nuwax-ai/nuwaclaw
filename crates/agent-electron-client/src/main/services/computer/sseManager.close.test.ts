/**
 * SSE session close on prompt turn end
 */

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
  closeSseClientsForSession,
  collectOpenSseSessionIdsForProjectKeys,
  shouldCloseSseAfterPromptEnd,
  getSseEventBufferSize,
  pushSseEvent,
  sseClients,
  registerSseClient,
  bindSessionFirstTokenContext,
  closeAndClearAllSseClients,
} from "./sseManager";

function mockResponse(): ServerResponse {
  return { end: vi.fn(), write: vi.fn() } as unknown as ServerResponse;
}

describe("shouldCloseSseAfterPromptEnd", () => {
  it.each([
    "end_turn",
    "max_tokens",
    "max_turn_requests",
    "refusal",
    "cancelled",
    "error",
  ])("returns true for terminal reason %s", (reason) => {
    expect(shouldCloseSseAfterPromptEnd(reason)).toBe(true);
  });

  it("returns true when reason is undefined (defaults to end_turn)", () => {
    expect(shouldCloseSseAfterPromptEnd(undefined)).toBe(true);
  });

  it("returns false for mcp_reconnecting", () => {
    expect(shouldCloseSseAfterPromptEnd("mcp_reconnecting")).toBe(false);
  });

  it("returns true for unknown stop reasons", () => {
    expect(shouldCloseSseAfterPromptEnd("custom_stop")).toBe(true);
  });
});

describe("closeSseClientsForSession", () => {
  const sessionId = "ses-close-test";

  beforeEach(() => {
    sseClients.clear();
  });

  it("ends all registered clients and removes session from map", () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    registerSseClient(sessionId, res1);
    registerSseClient(sessionId, res2);

    closeSseClientsForSession(sessionId);

    expect(res1.end).toHaveBeenCalledTimes(1);
    expect(res2.end).toHaveBeenCalledTimes(1);
    expect(sseClients.has(sessionId)).toBe(false);
  });

  it("clears buffered events for the session", () => {
    pushSseEvent(sessionId, "prompt_start", { sessionId });
    expect(getSseEventBufferSize(sessionId)).toBe(1);

    closeSseClientsForSession(sessionId);

    expect(getSseEventBufferSize(sessionId)).toBe(0);
  });

  it("is a no-op for empty sessionId", () => {
    expect(() => closeSseClientsForSession("")).not.toThrow();
  });
});

describe("collectOpenSseSessionIdsForProjectKeys", () => {
  beforeEach(() => {
    closeAndClearAllSseClients();
  });

  it("finds open SSE via TTFT projectId even when registry points elsewhere", () => {
    const orphan = "ses-orphan";
    registerSseClient(orphan, mockResponse());
    bindSessionFirstTokenContext(orphan, {
      requestId: "r1",
      projectId: "1553934",
      engine: "nuwaxcode",
      chatReceivedAt: Date.now(),
      isNewSession: false,
    });

    const ids = collectOpenSseSessionIdsForProjectKeys(["1553934"]);
    expect(ids).toContain(orphan);
  });
});
