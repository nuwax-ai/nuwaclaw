/**
 * SSE 事件缓冲与推送管理
 *
 * 职责：
 * - 维护 sseClients（活跃连接）
 * - 维护 sseEventBuffers（无连接时的早期事件缓冲）
 * - 维护 sessionFirstTokenContexts（TTFT 追踪上下文）
 * - 暴露注册/注销/回放/推送 API，供 router.ts 和 index.ts 使用
 */

import * as http from "http";
import log from "electron-log";
import { FEATURES } from "@shared/featureFlags";
import { getPerfLogger } from "../../bootstrap/logConfig";
import { firstTokenTrace } from "../engines/perf/firstTokenTrace";
import { resolveProjectSession } from "./projectSessionRegistry";

// ==================== 常量 ====================

export const SSE_EVENT_BUFFER_MAX = 50;
/** 默认缓冲 TTL；活跃 prompt 期间不 prune（见 activeSsePromptSessions） */
const SSE_EVENT_BUFFER_TTL_MS = 30_000;
/** 长 TTFT / SSE 重连窗口：活跃 prompt 或无客户端时的最大保留时间 */
const SSE_EVENT_BUFFER_ACTIVE_TTL_MS = 10 * 60 * 1000;

const activeSsePromptSessions = new Set<string>();

// ==================== 状态 ====================

export const sseClients: Map<string, http.ServerResponse[]> = new Map();

const sseEventBuffers = new Map<
  string,
  { events: string[]; createdAt: number }
>();

interface SessionFirstTokenContext {
  requestId?: string;
  projectId?: string;
  engine?: string;
  chatReceivedAt: number;
  createdAt: number;
  isNewSession: boolean;
}

const sessionFirstTokenContexts = new Map<string, SessionFirstTokenContext>();

const sseFirstEventSent = new Map<string, number>();
const sseFirstTokenSent = new Map<string, number>();

let _chunkStructureLogged = false;

// ==================== 内部工具 ====================

function pruneExpiredSseEventBuffers(): void {
  const now = Date.now();
  for (const [sessionId, buf] of sseEventBuffers.entries()) {
    const ttlMs = activeSsePromptSessions.has(sessionId)
      ? SSE_EVENT_BUFFER_ACTIVE_TTL_MS
      : SSE_EVENT_BUFFER_TTL_MS;
    if (now - buf.createdAt >= ttlMs && !sseClients.has(sessionId)) {
      sseEventBuffers.delete(sessionId);
      sessionFirstTokenContexts.delete(sessionId);
    }
  }
}

function pruneExpiredSessionFirstTokenContexts(): void {
  const now = Date.now();
  for (const [sessionId, ctx] of sessionFirstTokenContexts.entries()) {
    const ttlMs = activeSsePromptSessions.has(sessionId)
      ? SSE_EVENT_BUFFER_ACTIVE_TTL_MS
      : SSE_EVENT_BUFFER_TTL_MS;
    if (now - ctx.createdAt >= ttlMs && !sseClients.has(sessionId)) {
      sessionFirstTokenContexts.delete(sessionId);
    }
  }
}

function extractAgentChunkText(data: unknown): string {
  const text = (data as { data?: { content?: { text?: unknown } } })?.data
    ?.content?.text;
  if (!_chunkStructureLogged) {
    _chunkStructureLogged = true;
    log.debug(
      `[PERF] sse.firstChunk structure sample: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return typeof text === "string" ? text : "";
}

/** 开发排查：打印完整 SSE wire payload（event + data 行），受 LOG_SSE_PAYLOAD 控制 */
export function logSseWirePayloadForDebug(payload: string): void {
  if (FEATURES.LOG_SSE_PAYLOAD) {
    log.debug(`[SSE] payload:\n${payload}`);
  }
}

// ==================== 首字追踪上下文 API ====================

export function bindSessionFirstTokenContext(
  sessionId: string,
  context: Omit<SessionFirstTokenContext, "createdAt">,
): void {
  sessionFirstTokenContexts.set(sessionId, {
    ...context,
    createdAt: Date.now(),
  });
}

export function clearSessionFirstTokenContext(sessionId: string): void {
  sessionFirstTokenContexts.delete(sessionId);
}

/** 标记 session 正在执行 prompt，延长 SSE 事件缓冲 TTL 直至 end_turn */
export function markSsePromptActive(sessionId: string): void {
  if (!sessionId) return;
  activeSsePromptSessions.add(sessionId);
}

export function clearSsePromptActive(sessionId: string): void {
  if (!sessionId) return;
  activeSsePromptSessions.delete(sessionId);
}

// ==================== 客户端注册 API ====================

/** 注册 SSE 客户端连接 */
export function registerSseClient(
  sessionId: string,
  res: http.ServerResponse,
): void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, []);
  }
  sseClients.get(sessionId)!.push(res);
}

/** 注销 SSE 客户端连接（关闭时调用） */
export function unregisterSseClient(
  sessionId: string,
  res: http.ServerResponse,
): void {
  const clients = sseClients.get(sessionId);
  if (clients) {
    const idx = clients.indexOf(res);
    if (idx >= 0) clients.splice(idx, 1);
    if (clients.length === 0) sseClients.delete(sessionId);
  }
}

/**
 * 回放 session 的缓冲事件到新建立的 SSE 连接。
 * 保留缓冲供断线重连（lanproxy 抖动时 Java 可再次连接并收到完整流）。
 */
export function replayBufferedEvents(
  sessionId: string,
  res: http.ServerResponse,
): number {
  const buffered = sseEventBuffers.get(sessionId);
  if (!buffered) return 0;
  let replayed = 0;
  for (const eventPayload of buffered.events) {
    try {
      res.write(eventPayload);
      replayed++;
    } catch {
      break;
    }
  }
  return replayed;
}

/** 清理 session 的 perf 首事件状态（SSE 连接关闭时调用，防止 Map 泄漏） */
export function clearSseTimers(sessionId: string): void {
  sseFirstEventSent.delete(sessionId);
  sseFirstTokenSent.delete(sessionId);
  clearSessionFirstTokenContext(sessionId);
}

// ==================== 缓冲管理公共 API ====================

/**
 * 返回某 session 当前缓冲的 SSE 事件条数（仅用于单测，勿在生产逻辑中依赖）。
 */
export function getSseEventBufferSize(sessionId: string): number {
  return sseEventBuffers.get(sessionId)?.events.length ?? 0;
}

/**
 * 返回某 session 的首字追踪上下文是否存在（仅用于单测，勿在生产逻辑中依赖）。
 */
export function hasSessionFirstTokenContext(sessionId: string): boolean {
  return sessionFirstTokenContexts.has(sessionId);
}

/**
 * 设置首字追踪上下文（仅用于单测）。
 */
export function setSessionFirstTokenContextForTest(
  sessionId: string,
  context: Omit<SessionFirstTokenContext, "createdAt">,
): void {
  bindSessionFirstTokenContext(sessionId, context);
}

/**
 * 清除指定 session 的 SSE 事件缓冲（cancel/stop 接口调用，避免取消后重连仍回放旧事件）。
 */
export function clearSseEventBuffer(sessionId: string): void {
  if (!sessionId) return;
  sseEventBuffers.delete(sessionId);
  clearSessionFirstTokenContext(sessionId);
  clearSsePromptActive(sessionId);
}

/**
 * 清除所有 SSE 事件缓冲（客户端停止/重启所有服务时调用，避免重启后仍回放旧会话事件）。
 */
export function clearAllSseEventBuffers(): void {
  sseEventBuffers.clear();
  sessionFirstTokenContexts.clear();
  activeSsePromptSessions.clear();
}

/**
 * 关闭所有活跃 SSE 连接并清空所有 SSE 相关状态（服务停止时调用）。
 */
export function closeAndClearAllSseClients(): void {
  for (const [, clients] of sseClients) {
    for (const client of clients) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
  }
  sseClients.clear();
  sseEventBuffers.clear();
  sseFirstEventSent.clear();
  sseFirstTokenSent.clear();
  sessionFirstTokenContexts.clear();
  activeSsePromptSessions.clear();
}

/**
 * Whether progress SSE should close after sessionPromptEnd for the given reason.
 * Keeps the connection open during transient MCP reconnect retries only.
 */
export function shouldCloseSseAfterPromptEnd(reason?: string): boolean {
  return reason !== "mcp_reconnecting";
}

/**
 * Open progress SSE session_ids tied to project keys (registry, TTFT context, live clients).
 * Covers zombie connections whose session_id no longer matches registry after session rotation.
 */
export function collectOpenSseSessionIdsForProjectKeys(
  keys: Iterable<string>,
): string[] {
  const keySet = new Set<string>();
  for (const key of keys) {
    if (key) keySet.add(key);
  }
  if (keySet.size === 0) return [];

  const ids = new Set<string>();

  for (const key of keySet) {
    const remembered = resolveProjectSession(key);
    if (remembered) ids.add(remembered);
  }

  for (const [sessionId, ctx] of sessionFirstTokenContexts) {
    if (ctx.projectId && keySet.has(ctx.projectId)) {
      ids.add(sessionId);
    }
  }

  for (const [sessionId, clients] of sseClients) {
    if (clients.length === 0) continue;
    const ctx = sessionFirstTokenContexts.get(sessionId);
    if (ctx?.projectId && keySet.has(ctx.projectId)) {
      ids.add(sessionId);
    }
  }

  return [...ids];
}

/**
 * Close all active progress SSE connections for a session and clear related state.
 * Stops the router heartbeat interval via `req.on("close")` when clients disconnect.
 */
export function closeSseClientsForSession(sessionId: string): void {
  if (!sessionId) return;

  const clients = sseClients.get(sessionId);
  if (clients && clients.length > 0) {
    log.info(
      `[SSE] Closing ${clients.length} client(s): session_id=${sessionId}`,
    );
    for (const client of [...clients]) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
  }

  sseClients.delete(sessionId);
  clearSseEventBuffer(sessionId);
  clearSseTimers(sessionId);
}

// ==================== SSE 推送 ====================

/**
 * 向 SSE 客户端推送事件。
 *
 * 对齐 rcoder SSE 格式：使用 subType 作为 SSE event name
 *   event: <eventName>\n
 *   data: <json>\n\n
 *
 * 若当前无客户端连接（chat 响应先于 SSE 连接建立），则先写入缓冲，
 * 等 GET /computer/progress/{session_id} 连接时回放，避免丢失 prompt_start 等早期事件。
 */
export function pushSseEvent(
  sessionId: string,
  eventName: string,
  data: unknown,
) {
  const clients = sseClients.get(sessionId);
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const now = Date.now();

  const isAgentChunk = eventName === "agent_message_chunk";
  const isFirstMessage = isAgentChunk && !sseFirstEventSent.has(sessionId);
  const chunkText = isAgentChunk ? extractAgentChunkText(data) : "";
  const isFirstToken =
    isAgentChunk && !!chunkText.trim() && !sseFirstTokenSent.has(sessionId);
  const isEndTurn = eventName === "end_turn";

  if (isFirstMessage) {
    sseFirstEventSent.set(sessionId, now);
    firstTokenTrace.trace("sse.first_chunk", { sessionId });
    getPerfLogger().info(`[PERF] sse.firstChunk  session=${sessionId}`);
  }
  if (isFirstToken) {
    sseFirstTokenSent.set(sessionId, now);
    firstTokenTrace.trace("sse.first_token", { sessionId });
    getPerfLogger().info(`[PERF] sse.firstToken  session=${sessionId}`);
    const firstTokenCtx = sessionFirstTokenContexts.get(sessionId);
    if (firstTokenCtx) {
      const ttftMs = Math.max(0, now - firstTokenCtx.chatReceivedAt);
      const rid = firstTokenCtx.requestId?.slice(0, 8) || "(none)";
      const project = firstTokenCtx.projectId || "(none)";
      getPerfLogger().info(
        `[PERF] /chat.firstToken: ${ttftMs}ms  rid=${rid}  session=${sessionId}  project=${project}  isNewSession=${firstTokenCtx.isNewSession}`,
      );
      if (firstTokenCtx.isNewSession) {
        getPerfLogger().info(
          `[PERF] /chat.newSession.firstToken: ${ttftMs}ms  rid=${rid}  session=${sessionId}  project=${project}`,
        );
      }
      firstTokenTrace.trace(
        "chat.first_token.returned",
        {
          requestId: firstTokenCtx.requestId,
          sessionId,
          projectId: firstTokenCtx.projectId,
          engine: firstTokenCtx.engine,
        },
        {
          ttftMs,
          isNewSession: firstTokenCtx.isNewSession,
        },
      );
    }
  }
  if (isEndTurn) {
    firstTokenTrace.trace("sse.end_turn", { sessionId });
    const firstChunkTime = sseFirstEventSent.get(sessionId);
    const firstTokenTime = sseFirstTokenSent.get(sessionId);
    sseFirstEventSent.delete(sessionId);
    sseFirstTokenSent.delete(sessionId);
    clearSessionFirstTokenContext(sessionId);

    const streamingMs =
      firstChunkTime !== undefined ? now - firstChunkTime : -1;
    const firstTokenMs =
      firstTokenTime !== undefined ? now - firstTokenTime : -1;

    getPerfLogger().info(
      `[PERF] sse.end${streamingMs >= 0 ? `: ${streamingMs}ms streaming` : ""}  session=${sessionId}`,
    );
    if (firstTokenMs >= 0) {
      getPerfLogger().info(
        `[PERF] sse.end.fromFirstToken: ${firstTokenMs}ms  session=${sessionId}`,
      );
    }
  }

  log.debug(
    `[SSE] pushSseEvent: sessionId=${sessionId}, eventName=${eventName}, time=${now}, clients=${clients?.length || 0}`,
  );
  logSseWirePayloadForDebug(payload);

  if (!clients || clients.length === 0) {
    pruneExpiredSseEventBuffers();
    pruneExpiredSessionFirstTokenContexts();
    if (!sseEventBuffers.has(sessionId)) {
      sseEventBuffers.set(sessionId, { events: [], createdAt: Date.now() });
    }
    const buf = sseEventBuffers.get(sessionId)!;
    if (buf.events.length < SSE_EVENT_BUFFER_MAX) {
      buf.events.push(payload);
    }
    return;
  }

  for (const client of clients) {
    try {
      const written = client.write(payload);
      if (!written) {
        log.warn(
          `[ComputerServer] ⚠ SSE write returned false (buffer full): sessionId=${sessionId}`,
        );
      }
    } catch (e) {
      log.warn(`[ComputerServer] ⚠ SSE write failed:`, e);
    }
  }
}
