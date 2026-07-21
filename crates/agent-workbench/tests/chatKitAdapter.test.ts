import { describe, expect, it } from 'vitest';
import { toChatConversation, toChatMessage, toChatStreamEvents } from '../src/adapters/chatKitAdapter';

describe('chat-kit adapter', () => {
  it('normalizes workbench conversation and rich message metadata', () => {
    expect(toChatConversation({
      id: 'conversation-1',
      agentId: 'agent-1',
      title: 'Topic',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      status: 'active',
    }).status).toBe('streaming');

    const message = toChatMessage({
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'answer',
      createdAt: '2026-07-20T00:00:00.000Z',
      status: 'streaming',
      metadata: {
        thinking: 'plan',
        runOverSteps: [{ id: 'tool-1', name: 'search', status: 'done' }],
      },
    });
    expect(message.parts.map((part) => part.type)).toEqual(['thinking', 'text', 'tool']);
  });

  it('normalizes request id and content without losing event order', () => {
    expect(toChatStreamEvents({
      type: 'chunk',
      requestId: 'request-1',
      messageId: 'message-1',
      content: 'hello',
    })).toEqual([
      { type: 'request', requestId: 'request-1' },
      { type: 'text-delta', messageId: 'message-1', text: 'hello' },
    ]);
  });
});
