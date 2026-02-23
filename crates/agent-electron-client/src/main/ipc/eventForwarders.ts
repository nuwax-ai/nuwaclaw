import { agentService } from '../../services/unifiedAgent';
import type { UnifiedSessionMessage } from '../../services/unifiedAgent';
import { pushSseEvent } from '../../services/computerServer';
import type { HandlerContext } from '../../types/ipc';

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

  for (const eventType of sseEventTypes) {
    agentService.on(eventType, (data: unknown) => {
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
    ctx.getMainWindow()?.webContents.send('computer:progress', data);
    const d = data as UnifiedSessionMessage;
    if (d?.sessionId) pushSseEvent(d.sessionId, d.subType || 'message', d);
  });

  agentService.on('computer:promptStart', (data: { sessionId: string; requestId?: string }) => {
    const event: UnifiedSessionMessage = {
      sessionId: data.sessionId,
      messageType: 'sessionPromptStart',
      subType: 'prompt_start',
      data: { request_id: data.requestId },
      timestamp: new Date().toISOString(),
    };
    ctx.getMainWindow()?.webContents.send('computer:progress', event);
    pushSseEvent(data.sessionId, 'prompt_start', event);
  });

  agentService.on('computer:promptEnd', (data: { sessionId: string; reason?: string; description?: string }) => {
    const event: UnifiedSessionMessage = {
      sessionId: data.sessionId,
      messageType: 'sessionPromptEnd',
      subType: data.reason || 'end_turn',
      data: { reason: data.reason, description: data.description },
      timestamp: new Date().toISOString(),
    };
    ctx.getMainWindow()?.webContents.send('computer:progress', event);
    pushSseEvent(data.sessionId, data.reason || 'end_turn', event);
  });
}
