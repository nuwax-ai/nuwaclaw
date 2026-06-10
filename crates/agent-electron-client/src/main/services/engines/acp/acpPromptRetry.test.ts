/**
 * 单元测试: acpPromptRetry — 错误分类与 MCP 重连重试
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

vi.mock("./acpClient", () => ({
  isMcpReconnectWindowActive: vi.fn(() => false),
}));

import { ACP_SESSION_CANCELLED_ERROR_CODE } from "@shared/constants";
import { isMcpReconnectWindowActive } from "./acpClient";
import {
  toErrorMessage,
  isPromptCancellationError,
  isPromptCancellation,
  createSessionCancelledError,
  isMcpReconnectErrorMessage,
  isMcpReconnectFailure,
  executePromptWithRetry,
} from "./acpPromptRetry";

describe("toErrorMessage", () => {
  it("Error 取 message", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });
  it("对象走 JSON 序列化", () => {
    expect(toErrorMessage({ code: 1 })).toBe(
      JSON.stringify({ code: 1 }, null, 2),
    );
  });
  it("原始值转字符串", () => {
    expect(toErrorMessage("plain")).toBe("plain");
    expect(toErrorMessage(42)).toBe("42");
  });
});

describe("isPromptCancellationError", () => {
  it.each(["session is terminating", "Session cancelled", "Abort timeout"])(
    "识别取消类文案: %s",
    (msg) => {
      expect(isPromptCancellationError(msg)).toBe(true);
    },
  );
  it("普通错误不误判", () => {
    expect(isPromptCancellationError("transport error")).toBe(false);
    expect(isPromptCancellationError("Request aborted")).toBe(false);
    expect(isPromptCancellationError("user cancelled the request")).toBe(false);
    expect(
      isPromptCancellationError("Aborted fetch due to network timeout"),
    ).toBe(false);
  });
});

describe("isPromptCancellation / createSessionCancelledError", () => {
  it("优先识别 code 字段", () => {
    const err = createSessionCancelledError();
    expect((err as any).code).toBe(ACP_SESSION_CANCELLED_ERROR_CODE);
    expect(isPromptCancellation(err)).toBe(true);
  });
  it("无 code 时回退 message 启发式", () => {
    expect(isPromptCancellation(new Error("session is terminating"))).toBe(
      true,
    );
    expect(isPromptCancellation(new Error("ENOENT"))).toBe(false);
  });
});

describe("isMcpReconnectErrorMessage", () => {
  it.each([
    "SSE stream disconnected",
    "TypeError: terminated",
    "MCP session reconnected",
    "Connection terminated unexpectedly",
  ])("识别重连窗口文案: %s", (msg) => {
    expect(isMcpReconnectErrorMessage(msg)).toBe(true);
  });
  it("普通错误不误判", () => {
    expect(isMcpReconnectErrorMessage("rate limited")).toBe(false);
  });
});

describe("isMcpReconnectFailure", () => {
  const baseCtx = {
    isOpencodeEngine: true,
    acpProcess: null,
    reconnectWindowMs: 4000,
  };
  it("非 OpenCode 引擎恒为 false", () => {
    expect(
      isMcpReconnectFailure("sse stream disconnected", {
        ...baseCtx,
        isOpencodeEngine: false,
      }),
    ).toBe(false);
  });
  it("OpenCode + 重连文案为 true", () => {
    expect(isMcpReconnectFailure("sse stream disconnected", baseCtx)).toBe(
      true,
    );
  });
  it("文案不匹配时回退重连窗口检测", () => {
    vi.mocked(isMcpReconnectWindowActive).mockReturnValueOnce(true);
    expect(isMcpReconnectFailure("other error", baseCtx)).toBe(true);
  });
});

describe("executePromptWithRetry", () => {
  const baseOpts = {
    maxAttempts: 2,
    retryDelayMs: 1,
    logTag: "[test]",
    sessionId: "s1",
    promptStartTime: Date.now(),
    getRetryTelemetry: () => ({}),
  };

  it("首次成功直接返回", async () => {
    const send = vi.fn().mockResolvedValue({ stopReason: "end_turn" });
    const res = await executePromptWithRetry(send, {
      ...baseOpts,
      shouldRetry: () => true,
    });
    expect(res).toEqual({ stopReason: "end_turn" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("不可重试的错误直接抛出", async () => {
    const send = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(
      executePromptWithRetry(send, { ...baseOpts, shouldRetry: () => false }),
    ).rejects.toThrow("fatal");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("可重试错误重试后成功，并触发 onRetry 回调", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("sse stream disconnected"))
      .mockResolvedValueOnce({ stopReason: "end_turn" });
    const onRetry = vi.fn();
    const res = await executePromptWithRetry(send, {
      ...baseOpts,
      shouldRetry: (_e, msg) => isMcpReconnectErrorMessage(msg),
      onRetry,
    });
    expect(res).toEqual({ stopReason: "end_turn" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, nextAttempt: 2 }),
    );
  });

  it("达到 maxAttempts 后不再重试", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new Error("sse stream disconnected"));
    await expect(
      executePromptWithRetry(send, { ...baseOpts, shouldRetry: () => true }),
    ).rejects.toThrow("sse stream disconnected");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
