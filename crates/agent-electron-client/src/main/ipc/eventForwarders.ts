import { agentService } from "../services/engines/unifiedAgent";
import type { UnifiedSessionMessage } from "../services/engines/unifiedAgent";
import { pushSseEvent } from "../services/computerServer";
import type { HandlerContext } from "@shared/types/ipc";
import log from "electron-log";

/** Stored handlers for cleanup */
const registeredHandlers: Array<{
  event: string;
  handler: (...args: any[]) => void;
}> = [];

/**
 * Unregister all event forwarders from agentService.
 * Call before re-registering or during cleanup.
 */
export function unregisterEventForwarders(): void {
  if (registeredHandlers.length === 0) return;
  for (const { event, handler } of registeredHandlers) {
    agentService.off(event, handler);
  }
  registeredHandlers.length = 0;
  log.info("[EventForwarders] Unregistered all event forwarders");
}

export function registerEventForwarders(ctx: HandlerContext): void {
  // Ensure idempotency: unregister any previous handlers first
  unregisterEventForwarders();

  // Forward all agent SSE events to the renderer
  const sseEventTypes = [
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
  ];

  log.info(
    "[EventForwarders] Registering event forwarders for:",
    sseEventTypes.join(", "),
  );

  for (const eventType of sseEventTypes) {
    const handler = (data: unknown) => {
      // Debug: log message events
      if (eventType.startsWith("message")) {
        log.debug(
          `[EventForwarders] 📨 Received ${eventType}:`,
          JSON.stringify(data).substring(0, 200),
        );
      }
      ctx.getMainWindow()?.webContents.send("agent:event", {
        type: eventType,
        data,
      });
    };
    agentService.on(eventType, handler);
    registeredHandlers.push({ event: eventType, handler });
  }

  const errorHandler = (error: Error) => {
    ctx.getMainWindow()?.webContents.send("agent:event", {
      type: "error",
      data: { message: error.message },
    });
  };
  agentService.on("error", errorHandler);
  registeredHandlers.push({ event: "error", handler: errorHandler });

  const readyHandler = () => {
    ctx.getMainWindow()?.webContents.send("agent:event", {
      type: "ready",
      data: {},
    });
  };
  agentService.on("ready", readyHandler);
  registeredHandlers.push({ event: "ready", handler: readyHandler });

  const destroyedHandler = () => {
    ctx.getMainWindow()?.webContents.send("agent:event", {
      type: "destroyed",
      data: {},
    });
  };
  agentService.on("destroyed", destroyedHandler);
  registeredHandlers.push({ event: "destroyed", handler: destroyedHandler });

  // ==================== computer:* Event Forwarding (rcoder camelCase format) ====================

  const progressHandler = (data: unknown) => {
    log.debug(
      "[EventForwarders] 📨 Received computer:progress:",
      JSON.stringify(data).substring(0, 200),
    );
    ctx.getMainWindow()?.webContents.send("computer:progress", data);
    const d = data as UnifiedSessionMessage;
    if (d?.sessionId) {
      // sessionId is now the ACP protocol UUID — same as acpSessionId
      log.debug(
        `[EventForwarders] 📤 Pushing SSE event: sessionId=${d.sessionId}, subType=${d.subType}`,
      );
      pushSseEvent(d.sessionId, d.subType || "message", d);
    }
  };
  agentService.on("computer:progress", progressHandler);
  registeredHandlers.push({
    event: "computer:progress",
    handler: progressHandler,
  });

  const promptStartHandler = (data: {
    sessionId: string;
    acpSessionId?: string;
    requestId?: string;
  }) => {
    // sessionId is now the ACP protocol UUID
    const event: UnifiedSessionMessage = {
      sessionId: data.sessionId,
      acpSessionId: data.acpSessionId,
      messageType: "sessionPromptStart",
      subType: "prompt_start",
      data: { request_id: data.requestId },
      timestamp: new Date().toISOString(),
    };
    ctx.getMainWindow()?.webContents.send("computer:progress", event);
    pushSseEvent(data.sessionId, "prompt_start", event);
  };
  agentService.on("computer:promptStart", promptStartHandler);
  registeredHandlers.push({
    event: "computer:promptStart",
    handler: promptStartHandler,
  });

  const promptEndHandler = (data: {
    sessionId: string;
    acpSessionId?: string;
    reason?: string;
    description?: string;
  }) => {
    // sessionId is now the ACP protocol UUID
    const event: UnifiedSessionMessage = {
      sessionId: data.sessionId,
      acpSessionId: data.acpSessionId,
      messageType: "sessionPromptEnd",
      subType: data.reason || "end_turn",
      data: { reason: data.reason, description: data.description },
      timestamp: new Date().toISOString(),
    };
    ctx.getMainWindow()?.webContents.send("computer:progress", event);
    pushSseEvent(data.sessionId, data.reason || "end_turn", event);
  };
  agentService.on("computer:promptEnd", promptEndHandler);
  registeredHandlers.push({
    event: "computer:promptEnd",
    handler: promptEndHandler,
  });
}
