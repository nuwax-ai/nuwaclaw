import { agentService } from '../services/engines/unifiedAgent';
import type { UnifiedSessionMessage } from '../services/engines/unifiedAgent';
import { pushSseEvent } from '../services/computerServer';
import type { HandlerContext } from '@shared/types/ipc';
import log from 'electron-log';

export function registerEventForwarders(ctx: HandlerContext): void {
  // Forward all agent SSE events to the renderer
  const sseEventTypes = [
    'message.updated',
    'message.removed',
    'message.part.updated',
    'message.part.removed',
    'permission.updated',
    'permission.replied',
    'session.created',
    'session.updated',
    'session.deleted',
    'session.status',
    'session.idle',
    'session.error',
    'session.diff',
    'file.edited',
    'server.connected',
  ];

  log.info('[EventForwarders] Registering event forwarders for:', sseEventTypes.join(', '));

  for (const eventType of sseEventTypes) {
    agentService.on(eventType, (data: unknown) => {
      // Debug: log message events
      if (eventType.startsWith('message')) {
        log.debug(`[EventForwarders] 📨 Received ${eventType}:`, JSON.stringify(data).substring(0, 200));
      }
      ctx.getMainWindow()?.webContents.send('agent:event', {
        type: eventType,
        data,
      });
    });
  }

  agentService.on('error', (error: Error) => {
    ctx.getMainWindow()?.webContents.send('agent:event', {
      type: 'error',
      data: { message: error.message },
    });
  });

  agentService.on('ready', () => {
    ctx.getMainWindow()?.webContents.send('agent:event', {
      type: 'ready',
      data: {},
    });
  });

  agentService.on('destroyed', () => {
    ctx.getMainWindow()?.webContents.send('agent:event', {
      type: 'destroyed',
      data: {},
    });
  });

  // ==================== computer:* Event Forwarding (rcoder camelCase format) ====================

  agentService.on('computer:progress', (data: unknown) => {
    log.debug('[EventForwarders] 📨 Received computer:progress:', JSON.stringify(data).substring(0, 200));
    ctx.getMainWindow()?.webContents.send('computer:progress', data);
    const d = data as UnifiedSessionMessage;
    if (d?.sessionId) {
      // sessionId is now the ACP protocol UUID — same as acpSessionId
      log.debug(`[EventForwarders] 📤 Pushing SSE event: sessionId=${d.sessionId}, subType=${d.subType}`);
      pushSseEvent(d.sessionId, d.subType || 'message', d);
    }
  });

  agentService.on('computer:promptStart', (data: { sessionId: string; acpSessionId?: string; requestId?: string }) => {
    // sessionId is now the ACP protocol UUID
    const event: UnifiedSessionMessage = {
      sessionId: data.sessionId,
      acpSessionId: data.acpSessionId,
      messageType: 'sessionPromptStart',
      subType: 'prompt_start',
      data: { request_id: data.requestId },
      timestamp: new Date().toISOString(),
    };
    ctx.getMainWindow()?.webContents.send('computer:progress', event);
    pushSseEvent(data.sessionId, 'prompt_start', event);
  });

  agentService.on('computer:promptEnd', (data: { sessionId: string; acpSessionId?: string; reason?: string; description?: string }) => {
    // sessionId is now the ACP protocol UUID
    const event: UnifiedSessionMessage = {
      sessionId: data.sessionId,
      acpSessionId: data.acpSessionId,
      messageType: 'sessionPromptEnd',
      subType: data.reason || 'end_turn',
      data: { reason: data.reason, description: data.description },
      timestamp: new Date().toISOString(),
    };
    ctx.getMainWindow()?.webContents.send('computer:progress', event);
    pushSseEvent(data.sessionId, data.reason || 'end_turn', event);
  });
}
