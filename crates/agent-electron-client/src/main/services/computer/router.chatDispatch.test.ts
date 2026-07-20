/**
 * handleComputerChat — promptDispatched 与 project session registry 守卫
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import type { AcpChatHttpResult } from "@shared/types/computerTypes";

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../bootstrap/logConfig", () => ({
  getPerfLogger: () => ({ info: vi.fn() }),
}));

vi.mock("../engines/perf/firstTokenTrace", () => ({
  firstTokenTrace: { trace: vi.fn() },
}));

vi.mock("../startupPorts", () => ({
  getConfiguredPorts: () => ({ fileServer: 18080, computer: 60006 }),
}));

vi.mock("../packages/fileServerHealth", () => ({
  checkFileServerHealth: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./devcomputerAutoReload", () => ({
  shouldAutoReload: vi.fn(() => false),
  reloadEngineForRequest: vi.fn(),
  attachReloadedToChatResult: vi.fn((result: unknown) => result),
}));

vi.mock("./ensureChatSessionId", () => ({
  ensureSessionIdFromRegistry: vi.fn(),
}));

vi.mock("./closeStaleSseForChat", () => ({
  closeStaleSseBeforeChat: vi.fn(),
}));

const mockEnsureEngine = vi.fn();
const mockChat = vi.fn();

vi.mock("../engines/unifiedAgent", () => ({
  agentService: {
    ensureEngineForRequest: (...args: unknown[]) => mockEnsureEngine(...args),
  },
}));

const mockRememberProjectSession = vi.fn();
vi.mock("./projectSessionRegistry", () => ({
  rememberProjectSession: (...args: unknown[]) =>
    mockRememberProjectSession(...args),
}));

const mockBindSessionFirstTokenContext = vi.fn();
vi.mock("./sseManager", () => ({
  bindSessionFirstTokenContext: (...args: unknown[]) =>
    mockBindSessionFirstTokenContext(...args),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

import * as fs from "fs";
import { handleComputerChat } from "./router";
import { chatDispatchCoordinator } from "./chatDispatchCoordinator";

function mockResponse(): ServerResponse & { body?: string } {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(function (this: { body?: string }, chunk?: string) {
      this.body = chunk;
    }),
  } as unknown as ServerResponse & { body?: string };
  return res;
}

const baseChatBody = {
  user_id: "6",
  project_id: "proj-router-001",
  session_id: "ses_router_test",
  request_id: "rid-router-001",
  prompt: "hello",
};

describe("handleComputerChat promptDispatched", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatDispatchCoordinator.reset();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockEnsureEngine.mockResolvedValue({
      engineName: "nuwaxcode",
      chat: mockChat,
    });
  });

  it("promptDispatched false 时不更新 project session registry", async () => {
    mockChat.mockResolvedValue({
      code: "0000",
      message: "success",
      data: {
        project_id: "proj-router-001",
        session_id: "ses_superseded",
        request_id: "rid-router-001",
      },
      tid: null,
      success: true,
      promptDispatched: false,
    } satisfies AcpChatHttpResult);

    const res = mockResponse();
    await handleComputerChat(
      {} as IncomingMessage,
      res,
      { ...baseChatBody },
      "computer",
    );

    expect(mockRememberProjectSession).not.toHaveBeenCalled();
    expect(mockBindSessionFirstTokenContext).not.toHaveBeenCalled();
  });

  it("promptDispatched true 时更新 registry 与 first-token 上下文", async () => {
    mockChat.mockResolvedValue({
      code: "0000",
      message: "success",
      data: {
        project_id: "proj-router-001",
        session_id: "ses_dispatched",
        request_id: "rid-router-001",
      },
      tid: null,
      success: true,
      promptDispatched: true,
    } satisfies AcpChatHttpResult);

    const res = mockResponse();
    await handleComputerChat(
      {} as IncomingMessage,
      res,
      { ...baseChatBody },
      "computer",
    );

    expect(mockRememberProjectSession).toHaveBeenCalledWith(
      "proj-router-001",
      "ses_dispatched",
    );
    expect(mockBindSessionFirstTokenContext).toHaveBeenCalledWith(
      "ses_dispatched",
      expect.objectContaining({
        requestId: "rid-router-001",
        projectId: "proj-router-001",
        engine: "nuwaxcode",
      }),
    );
  });

  it("HTTP JSON 响应不包含 promptDispatched 内部字段", async () => {
    mockChat.mockResolvedValue({
      code: "0000",
      message: "success",
      data: {
        project_id: "proj-router-001",
        session_id: "ses_dispatched",
        request_id: "rid-router-001",
      },
      tid: null,
      success: true,
      promptDispatched: true,
    } satisfies AcpChatHttpResult);

    const res = mockResponse();
    await handleComputerChat(
      {} as IncomingMessage,
      res,
      { ...baseChatBody },
      "computer",
    );

    expect(res.body).toBeDefined();
    const parsed = JSON.parse(res.body!);
    expect(parsed.promptDispatched).toBeUndefined();
    expect(parsed.data.session_id).toBe("ses_dispatched");
  });
});
