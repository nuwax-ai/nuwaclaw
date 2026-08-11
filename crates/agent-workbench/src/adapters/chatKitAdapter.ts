import type {
  ChatAdapter,
  ChatConversation,
  ChatMessage,
  ChatMessagePart,
  ChatSendCommand,
  ChatStreamEvent,
  ChatToolPart,
} from '@nuwax-ai/chat-kit/core';
import { firstPart, partsToText, partsToThinking, toolParts } from '@nuwax-ai/chat-kit/core';
import type {
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchMessage,
  WorkbenchStreamEvent,
} from '../types';

export function fromChatConversation(source: ChatConversation): WorkbenchConversation {
  return {
    id: source.id,
    agentId: source.agentId,
    title: source.title,
    createdAt: source.createdAt ?? source.updatedAt,
    updatedAt: source.updatedAt,
    status:
      source.status === 'streaming' || source.status === 'executing'
        ? 'active'
        : source.status === 'error'
          ? 'error'
          : 'idle',
    metadata: {
      ...source.metadata,
      ...(source.summary ? { summary: source.summary } : {}),
    },
  };
}

export function fromChatMessage(source: ChatMessage): WorkbenchMessage {
  const text = partsToText(source.parts);
  const thinking = partsToThinking(source.parts);
  const tools = toolParts(source.parts).map((part) => ({
    id: part.id,
    name: part.name,
    status:
      part.status === 'complete'
        ? 'done'
        : part.status === 'error'
          ? 'error'
          : 'executing',
    durationMs: part.durationMs,
    args: part.input,
    output: part.output,
  }));
  const error = firstPart(source.parts, 'error');
  return {
    id: source.id,
    conversationId: source.conversationId,
    role: source.role === 'tool' ? 'assistant' : source.role,
    content: error?.message ?? text,
    createdAt: source.createdAt ?? new Date().toISOString(),
    kind: error ? 'error' : 'text',
    status:
      source.status === 'pending'
        ? 'sending'
        : source.status === 'streaming'
          ? 'streaming'
          : source.status === 'error'
            ? 'error'
            : 'complete',
    // Carry the structured parts verbatim so renderers can consume them
    // directly (lossless round-trip — attachments/thinking/tools survive).
    parts: source.parts,
    metadata: {
      ...source.metadata,
      ...(thinking ? { thinking } : {}),
      ...(tools.length > 0
        ? {
            runOverSteps: tools,
            runOverStatus: source.status === 'error' ? 'error' : source.status === 'complete' ? 'done' : 'running',
          }
        : {}),
    },
  };
}

export function toChatConversation(source: WorkbenchConversation): ChatConversation {
  return {
    id: source.id,
    agentId: source.agentId,
    title: source.title,
    summary:
      typeof source.metadata?.summary === 'string' ? source.metadata.summary : undefined,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    status:
      source.status === 'active'
        ? 'streaming'
        : source.status === 'error'
          ? 'error'
          : 'idle',
    metadata: source.metadata,
  };
}

function toToolPart(raw: unknown, index: number): ChatToolPart | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = String(source.id ?? source.executeId ?? `tool-${index}`);
  const name = String(source.name ?? source.title ?? 'Tool');
  const rawStatus = String(source.status ?? '').toLowerCase();
  const status: ChatToolPart['status'] =
    rawStatus.includes('error') || rawStatus.includes('fail')
      ? 'error'
      : rawStatus.includes('complete') || rawStatus.includes('done') || rawStatus.includes('success')
        ? 'complete'
        : rawStatus.includes('pending')
          ? 'pending'
          : 'running';
  return {
    type: 'tool',
    id,
    name,
    status,
    input: source.input ?? source.args,
    output: source.output ?? source.result,
    durationMs: typeof source.durationMs === 'number' ? source.durationMs : undefined,
  };
}

export function toChatMessage(source: WorkbenchMessage): ChatMessage {
  // Lossless fast path: live messages carry their structured parts verbatim
  // (set by fromChatMessage). Reconstruct only for wire/legacy messages that
  // never had parts.
  if (source.parts) {
    return {
      id: source.id,
      conversationId: source.conversationId,
      role: source.role,
      status:
        source.status === 'sending'
          ? 'pending'
          : source.status === 'streaming'
            ? 'streaming'
            : source.status === 'error'
              ? 'error'
              : 'complete',
      parts: source.parts,
      createdAt: source.createdAt,
      metadata: source.metadata,
    };
  }
  const parts: ChatMessagePart[] = [];
  const thinking = source.metadata?.thinking;
  if (typeof thinking === 'string' && thinking.length > 0) {
    parts.push({
      type: 'thinking',
      text: thinking,
      status: source.status === 'streaming' ? 'streaming' : 'complete',
    });
  }
  if (source.content) parts.push({ type: 'text', text: source.content });
  const tools = source.metadata?.runOverSteps;
  if (Array.isArray(tools)) {
    tools.forEach((tool, index) => {
      const normalized = toToolPart(tool, index);
      if (normalized) parts.push(normalized);
    });
  }
  if (source.kind === 'error' && source.content) {
    parts.push({ type: 'error', message: source.content });
  }
  return {
    id: source.id,
    conversationId: source.conversationId,
    role: source.role,
    status:
      source.status === 'sending'
        ? 'pending'
        : source.status === 'streaming'
          ? 'streaming'
          : source.status === 'error'
            ? 'error'
            : 'complete',
    parts,
    createdAt: source.createdAt,
    metadata: source.metadata,
  };
}

export function toChatStreamEvents(source: WorkbenchStreamEvent): ChatStreamEvent[] {
  if (source.requestId) {
    const request: ChatStreamEvent = { type: 'request', requestId: source.requestId };
    const rest = toChatStreamEvents({ ...source, requestId: undefined });
    return [request, ...rest];
  }
  if (source.type === 'chunk') {
    return [{ type: 'text-delta', messageId: source.messageId, text: source.content ?? '' }];
  }
  if (source.type === 'thought') {
    return [{ type: 'thinking-delta', messageId: source.messageId, text: source.content ?? '' }];
  }
  if (source.type === 'processing') {
    const tool = toToolPart(source.processingData, 0);
    return tool ? [{ type: 'tool-update', messageId: source.messageId, tool }] : [];
  }
  if (source.type === 'permission' && source.permission) {
    return [{
      type: 'interaction',
      messageId: source.messageId,
      interaction: {
        type: 'interaction',
        id: source.permission.id,
        kind: 'permission',
        status: 'pending',
        payload: source.permission,
      },
    }];
  }
  if (source.type === 'mcp_ask' && source.mcpAsk) {
    return [{
      type: 'interaction',
      messageId: source.messageId,
      interaction: {
        type: 'interaction',
        id: source.mcpAsk.input.requestId,
        kind: 'question',
        status: 'pending',
        payload: source.mcpAsk,
      },
    }];
  }
  if (source.type === 'final') {
    return [{ type: 'final', messageId: source.messageId, text: source.content }];
  }
  if (source.type === 'error') {
    return [{ type: 'error', messageId: source.messageId, error: source.error ?? source.content ?? 'Unknown error' }];
  }
  return [];
}

export function createWorkbenchChatAdapter(adapter: WorkbenchApiAdapter): ChatAdapter {
  return {
    async listConversations(agentId, options) {
      const items = await adapter.listConversations(agentId, {
        lastId: options?.cursor,
        limit: options?.limit,
        topic: options?.query,
      });
      return {
        items: items.map(toChatConversation),
        nextCursor:
          options?.limit && items.length >= options.limit ? items.at(-1)?.id ?? null : null,
      };
    },
    async createConversation(agentId, title) {
      return toChatConversation(await adapter.createConversation(agentId, title));
    },
    async getConversation(agentId, conversationId, options) {
      const cursor = options?.cursor ? Number(options.cursor) : undefined;
      const page = await adapter.getConversation(agentId, conversationId, {
        index: Number.isFinite(cursor) ? cursor : undefined,
        size: options?.limit,
      });
      const messages = page.messages.map(toChatMessage);
      const firstIndex = messages[0]?.metadata?.index;
      return {
        conversation: toChatConversation(page.conversation),
        items: messages,
        nextCursor: page.hasMore && firstIndex !== undefined ? String(firstIndex) : null,
      };
    },
    async updateConversation(conversationId, values) {
      if (!adapter.updateConversation) throw new Error('Conversation update is not supported');
      return toChatConversation(await adapter.updateConversation(conversationId, values));
    },
    async deleteConversation(conversationId) {
      if (!adapter.deleteConversation) throw new Error('Conversation deletion is not supported');
      await adapter.deleteConversation(conversationId);
    },
    async shareConversation(conversationId) {
      if (!adapter.shareConversation) throw new Error('Conversation sharing is not supported');
      return adapter.shareConversation(conversationId);
    },
    async *send(command: ChatSendCommand) {
      const stream = adapter.sendMessage({
        agentId: command.agentId,
        conversationId: command.conversationId,
        content: command.text,
        requestId: command.requestId,
        variableParams: command.variableParams,
        modelId: command.modelId,
        agentMode: command.agentMode,
        attachments: command.attachments.map((attachment) => ({
          url: attachment.url,
          key: attachment.key,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
        skillIds: command.skillIds,
        sandboxId: command.sandboxId,
        selectedComponents: command.selectedComponentIds?.map((id) => ({ id, name: id })),
        metadata: command.metadata,
      });
      for await (const event of stream) {
        for (const normalized of toChatStreamEvents(event)) yield normalized;
      }
    },
    async stop(requestIdOrConversationId, command) {
      await adapter.stopChat?.(requestIdOrConversationId, {
        agentId: command.agentId,
        conversationId: command.conversationId,
      });
    },
    async respondInteraction(interactionId, response, context) {
      const value = response as Record<string, unknown> | string;
      if (
        typeof value !== 'string' &&
        (value.source === 'mcp_ask' || value.protocol === 'mcp')
      ) {
        await adapter.respondMcpAsk?.(
          value as unknown as import('../types').WorkbenchMcpAskRespondPayload,
          { agentId: context.agentId },
        );
        return;
      }
      const choiceId =
        typeof value === 'string'
          ? value
          : typeof value?.choiceId === 'string'
            ? value.choiceId
            : undefined;
      if (choiceId) {
        await adapter.respondPermission?.(interactionId, choiceId, context);
      }
    },
  };
}
