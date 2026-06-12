/**
 * 引擎事件转发与记忆缓冲（从 UnifiedAgentService.forwardEvents 提取）
 *
 * - 把 AcpEngine 的事件按白名单转发到 UnifiedAgentService（事件总线）
 * - 维护 per-session assistant 文本缓冲：promptStart 清空、text part 累积、
 *   promptEnd 时 flush 进 MemoryService、session.idle 触发增量提取
 */

import log from "electron-log";
import { memoryService } from "../memory";
import type { AcpEngine } from "./acp/acpEngine";
import { buildModelConfig } from "./utils/buildModelConfig";

/** 转发宿主：UnifiedAgentService 暴露给转发器的最小接口 */
export interface EngineEventForwardHost {
  emit(event: string, ...args: unknown[]): boolean;
  /** Buffer assistant text chunks per session for memory tracking */
  assistantTextBuffers: Map<string, string>;
}

const FORWARDED_EVENTS = [
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.removed",
  "permission.updated",
  "permission.replied",
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
  "session.diff",
  "file.edited",
  "server.connected",
  "error",
  "ready",
  "destroyed",
  // rcoder-compat events
  "computer:progress",
  "computer:promptStart",
  "computer:promptEnd",
] as const;

export function attachEngineEventForwarders(
  engine: AcpEngine,
  host: EngineEventForwardHost,
): void {
  for (const event of FORWARDED_EVENTS) {
    engine.on(event, (...args: unknown[]) => {
      // Debug: log event forwarding
      if (
        event === "message.part.updated" ||
        event === "message.updated" ||
        event === "computer:progress"
      ) {
        log.debug(
          `[UnifiedAgent] 📤 Forwarding event: ${event}`,
          JSON.stringify(args).substring(0, 200),
        );
      }
      host.emit(event, ...args);
    });
  }

  // --- Memory: buffer assistant text chunks and flush on promptEnd ---

  // Clear buffer on promptStart to prevent stale data
  engine.on("computer:promptStart", (...args: unknown[]) => {
    try {
      const data = args[0] as { sessionId?: string } | undefined;
      const sessionId = data?.sessionId;
      if (sessionId) {
        host.assistantTextBuffers.delete(sessionId);
      }
    } catch {
      /* non-blocking */
    }
  });

  // Accumulate assistant text parts
  engine.on("message.part.updated", (...args: unknown[]) => {
    try {
      const data = args[0] as
        | { sessionId?: string; type?: string; text?: string }
        | undefined;
      if (!data || data.type !== "text" || !data.text) return;
      const sessionId = data.sessionId;
      if (!sessionId) return;
      const existing = host.assistantTextBuffers.get(sessionId) ?? "";
      host.assistantTextBuffers.set(sessionId, existing + data.text);
    } catch {
      /* non-blocking */
    }
  });

  // Flush buffered assistant text to memory on promptEnd
  engine.on("computer:promptEnd", (...args: unknown[]) => {
    try {
      const data = args[0] as
        | { sessionId?: string; openLongMemory?: boolean }
        | undefined;
      const sessionId = data?.sessionId;
      if (!sessionId) return;

      // 检查记忆开关，默认 false
      if (data?.openLongMemory !== true) return;

      // Use engine's current config (may be updated from HTTP request model_provider)
      const engineConfig = engine.currentConfig;
      if (!engineConfig) return;

      const buffered = host.assistantTextBuffers.get(sessionId);
      host.assistantTextBuffers.delete(sessionId);

      if (!buffered || !buffered.trim() || !memoryService.isInitialized())
        return;

      const modelConfig = buildModelConfig(engine.engineName, engineConfig);

      memoryService.handleMessage(
        sessionId,
        { role: "assistant", content: buffered },
        modelConfig,
      );
    } catch (error) {
      log.warn(
        "[UnifiedAgent] Failed to flush assistant text to memory:",
        error,
      );
    }
  });

  // Trigger incremental memory extraction when session becomes idle (after each prompt)
  // Note: This calls onSessionEnd which internally checks getMaxCompletedMsgIndex()
  // to only process new messages that haven't been extracted yet.
  // This provides incremental extraction rather than re-processing all messages.
  engine.on("session.idle", (...args: unknown[]) => {
    try {
      const data = args[0] as
        | { sessionId?: string; openLongMemory?: boolean }
        | undefined;
      const sessionId = data?.sessionId;
      // Use engine's current config (may be updated from HTTP request model_provider)
      const engineConfig = engine.currentConfig;
      // Skip if no sessionId, memory not initialized, or no engine config
      if (!sessionId || !memoryService.isInitialized() || !engineConfig) return;
      // 检查记忆开关，默认 false
      if (data?.openLongMemory !== true) return;
      // Skip if no API key (required for LLM-based extraction)
      if (!engineConfig.apiKey) {
        log.debug(
          "[UnifiedAgent] Skipping incremental extraction: no API key configured",
        );
        return;
      }

      const modelConfig = buildModelConfig(engine.engineName, engineConfig);

      // Trigger incremental extraction (async, non-blocking)
      // This will extract any new messages since the last extraction
      memoryService.onSessionEnd(sessionId, modelConfig).catch((err) => {
        log.warn("[UnifiedAgent] Incremental memory extraction failed:", err);
      });
    } catch (error) {
      log.warn(
        "[UnifiedAgent] Failed to trigger incremental extraction:",
        error,
      );
    }
  });
}
