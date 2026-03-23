/**
 * 单元测试: eventForwarders — 监听器生命周期管理
 *
 * 覆盖内容：
 * - registerEventForwarders 注册监听器到 agentService
 * - unregisterEventForwarders 移除所有已注册监听器
 * - 重复调用 registerEventForwarders 不会叠加监听器（幂等性）
 * - 事件转发到 renderer webContents
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/computerServer", () => ({
  pushSseEvent: vi.fn(),
}));

// Use dynamic import to get the actual agentService (an EventEmitter) after mocking
// The unifiedAgent module exports agentService as a singleton EventEmitter
vi.mock("../services/engines/unifiedAgent", async () => {
  const { EventEmitter } = await import("events");
  return {
    agentService: new EventEmitter(),
  };
});

import {
  registerEventForwarders,
  unregisterEventForwarders,
} from "./eventForwarders";
import { agentService } from "../services/engines/unifiedAgent";
import type { HandlerContext } from "@shared/types/ipc";

function createMockCtx() {
  const send = vi.fn();
  return {
    ctx: {
      getMainWindow: () => ({ webContents: { send } }) as any,
      lanproxy: {} as any,
      fileServer: {} as any,
      agentRunner: {} as any,
      agentRunnerPorts: null,
      setAgentRunnerPorts: vi.fn(),
    } as HandlerContext,
    send,
  };
}

describe("eventForwarders", () => {
  beforeEach(() => {
    (agentService as any).removeAllListeners();
    unregisterEventForwarders();
    vi.clearAllMocks();
  });

  it("registerEventForwarders registers listeners on agentService", () => {
    const { ctx } = createMockCtx();
    registerEventForwarders(ctx);

    expect(agentService.listenerCount("message.updated")).toBe(1);
    expect(agentService.listenerCount("session.created")).toBe(1);
    expect(agentService.listenerCount("error")).toBe(1);
    expect(agentService.listenerCount("ready")).toBe(1);
    expect(agentService.listenerCount("destroyed")).toBe(1);
    expect(agentService.listenerCount("computer:progress")).toBe(1);
    expect(agentService.listenerCount("computer:promptStart")).toBe(1);
    expect(agentService.listenerCount("computer:promptEnd")).toBe(1);
  });

  it("unregisterEventForwarders removes all registered listeners", () => {
    const { ctx } = createMockCtx();
    registerEventForwarders(ctx);
    unregisterEventForwarders();

    expect(agentService.listenerCount("message.updated")).toBe(0);
    expect(agentService.listenerCount("error")).toBe(0);
    expect(agentService.listenerCount("ready")).toBe(0);
    expect(agentService.listenerCount("destroyed")).toBe(0);
    expect(agentService.listenerCount("computer:progress")).toBe(0);
    expect(agentService.listenerCount("computer:promptStart")).toBe(0);
    expect(agentService.listenerCount("computer:promptEnd")).toBe(0);
  });

  it("registerEventForwarders is idempotent — no listener stacking", () => {
    const { ctx } = createMockCtx();

    registerEventForwarders(ctx);
    registerEventForwarders(ctx);
    registerEventForwarders(ctx);

    expect(agentService.listenerCount("message.updated")).toBe(1);
    expect(agentService.listenerCount("error")).toBe(1);
    expect(agentService.listenerCount("computer:progress")).toBe(1);
  });

  it("unregisterEventForwarders is safe to call when nothing is registered", () => {
    expect(() => unregisterEventForwarders()).not.toThrow();
  });

  it("SSE event forwards to renderer via webContents.send", () => {
    const { ctx, send } = createMockCtx();
    registerEventForwarders(ctx);

    const testData = { sessionId: "test-123", status: "active" };
    agentService.emit("session.created", testData);

    expect(send).toHaveBeenCalledWith("agent:event", {
      type: "session.created",
      data: testData,
    });
  });

  it("error event forwards error message to renderer", () => {
    const { ctx, send } = createMockCtx();
    registerEventForwarders(ctx);

    agentService.emit("error", new Error("test error"));

    expect(send).toHaveBeenCalledWith("agent:event", {
      type: "error",
      data: { message: "test error" },
    });
  });

  it("ready and destroyed events forward to renderer", () => {
    const { ctx, send } = createMockCtx();
    registerEventForwarders(ctx);

    agentService.emit("ready");
    expect(send).toHaveBeenCalledWith("agent:event", {
      type: "ready",
      data: {},
    });

    agentService.emit("destroyed");
    expect(send).toHaveBeenCalledWith("agent:event", {
      type: "destroyed",
      data: {},
    });
  });

  it("after unregister, events no longer forward", () => {
    const { ctx, send } = createMockCtx();
    registerEventForwarders(ctx);
    unregisterEventForwarders();

    agentService.emit("session.created", { test: true });
    // Note: not emitting 'error' here — EventEmitter throws unhandled errors with no listeners
    agentService.emit("ready");

    expect(send).not.toHaveBeenCalled();
  });
});
