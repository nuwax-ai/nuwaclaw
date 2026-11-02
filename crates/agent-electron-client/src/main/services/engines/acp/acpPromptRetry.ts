/**
 * ACP prompt 错误分类与 MCP 重连自动重试
 *
 * 从 AcpEngine 提取：
 * - 错误消息归一化（toErrorMessage）
 * - 取消类错误识别（isPromptCancellation*，createSessionCancelledError）
 * - MCP 重连窗口识别（isMcpReconnectErrorMessage / isMcpReconnectFailure）
 * - prompt 发送的重试循环（executePromptWithRetry）
 */

import log from "electron-log";
import type { ChildProcess } from "child_process";
import { ACP_SESSION_CANCELLED_ERROR_CODE } from "@shared/constants";
import { isMcpReconnectWindowActive } from "./acpClient";
import { safeStringify } from "../utils/safeStringify";

export function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null
      ? safeStringify(error)
      : String(error);
}

/**
 * 根据错误 message 判断是否为用户取消 / 中止类（启发式，兼容历史英文与其它来源文案）。
 * 用户主动 abort 时优先使用 {@link createSessionCancelledError}，其 `code` 为
 * {@link ACP_SESSION_CANCELLED_ERROR_CODE}，由 {@link isPromptCancellation} 优先识别。
 */
export function isPromptCancellationError(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase();
  return (
    lower === "session is terminating" ||
    lower === "session cancelled" ||
    lower === "abort timeout"
  );
}

/**
 * 判断 prompt 失败是否属于「取消」而非可重试的 MCP 波动。
 * 先检查 {@link ACP_SESSION_CANCELLED_ERROR_CODE}，再回退到 message 启发式。
 */
export function isPromptCancellation(error: unknown): boolean {
  if (
    error !== null &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === ACP_SESSION_CANCELLED_ERROR_CODE
  ) {
    return true;
  }
  return isPromptCancellationError(toErrorMessage(error));
}

/**
 * 用户取消会话时 reject 用的 Error：`message` 随主进程当前语言，`code` 固定。
 */
export function createSessionCancelledError(): Error {
  const err = new Error("Session cancelled"); // 这个不要走 i18n
  Object.assign(err, { code: ACP_SESSION_CANCELLED_ERROR_CODE });
  return err;
}

export function isMcpReconnectErrorMessage(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase();
  return (
    (lower.includes("transport error") &&
      (lower.includes("sse stream disconnected") ||
        lower.includes("typeerror: terminated"))) ||
    lower.includes("sse stream disconnected") ||
    lower.includes("typeerror: terminated") ||
    lower.includes("mcp session reconnected") ||
    lower.includes("connection terminated") ||
    lower.includes("stream disconnected")
  );
}

export interface McpReconnectContext {
  /** 仅 OpenCode 系引擎存在 MCP 重连窗口语义 */
  isOpencodeEngine: boolean;
  acpProcess: ChildProcess | null;
  reconnectWindowMs: number;
}

export function isMcpReconnectFailure(
  errorMsg: string,
  ctx: McpReconnectContext,
): boolean {
  if (!ctx.isOpencodeEngine) return false;
  return (
    isMcpReconnectErrorMessage(errorMsg) ||
    isMcpReconnectWindowActive(ctx.acpProcess, ctx.reconnectWindowMs)
  );
}

export interface ExecutePromptWithRetryOptions {
  maxAttempts: number;
  retryDelayMs: number;
  logTag: string;
  sessionId: string;
  /** prompt 发出的时间戳，用于日志耗时统计 */
  promptStartTime: number;
  /** 是否可重试（调用方组合取消识别 + MCP 重连窗口判断） */
  shouldRetry: (error: unknown, errorMsg: string) => boolean;
  /** 重试时采集 MCP transport 遥测（仅日志用） */
  getRetryTelemetry: () => unknown;
  /** 重试发生时的埋点回调（firstTokenTrace 等留在调用方） */
  onRetry?: (info: {
    attempt: number;
    nextAttempt: number;
    delayMs: number;
    error: string;
    telemetry: unknown;
  }) => void;
}

export async function executePromptWithRetry<T>(
  send: () => Promise<T>,
  opts: ExecutePromptWithRetryOptions,
): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      const res = await send();
      log.info(
        `${opts.logTag} 📥 ACP prompt resolved (${Date.now() - opts.promptStartTime}ms, attempt=${attempt}):`,
        safeStringify(res),
      );
      return res;
    } catch (err) {
      const errMsg = toErrorMessage(err);
      const canRetry =
        attempt < opts.maxAttempts && opts.shouldRetry(err, errMsg);

      if (!canRetry) {
        log.error(
          `${opts.logTag} 📥 ACP prompt rejected (${Date.now() - opts.promptStartTime}ms, attempt=${attempt}):`,
          err,
        );
        throw err;
      }

      const telemetry = opts.getRetryTelemetry();
      log.warn(
        `${opts.logTag} ⚠️ MCP reconnect window detected, auto-retrying prompt (attempt=${attempt + 1}/${opts.maxAttempts})`,
        {
          sessionId: opts.sessionId,
          error: errMsg,
          telemetry,
        },
      );
      opts.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        delayMs: opts.retryDelayMs,
        error: errMsg,
        telemetry,
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, opts.retryDelayMs);
      });
      attempt += 1;
    }
  }
}
