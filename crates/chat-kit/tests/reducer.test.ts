import { describe, expect, it } from 'vitest';
import {
  chatSessionReducer,
  initialChatSessionState,
  reduceChatStreamEvent,
  type ChatMessage,
} from '../src/core';
import { consumeChatStream } from '../src/react/useChatSession';

const assistant: ChatMessage = {
  id: 'assistant-1',
  conversationId: 'conversation-1',
  role: 'assistant',
  status: 'streaming',
  parts: [],
};

describe('chatSessionReducer', () => {
  it('folds text and thinking deltas into one assistant message', () => {
    const start = { ...initialChatSessionState, streaming: true, messages: [assistant] };
    const thinking = reduceChatStreamEvent(
      start,
      { type: 'thinking-delta', text: 'plan' },
      assistant.id,
    );
    const text = reduceChatStreamEvent(
      thinking,
      { type: 'text-delta', text: 'answer' },
      assistant.id,
    );
    expect(text.messages[0].parts).toEqual([
      { type: 'thinking', text: 'plan', status: 'streaming' },
      { type: 'text', text: 'answer' },
    ]);
  });

  it('deduplicates older pages by message id', () => {
    const state = { ...initialChatSessionState, messages: [assistant], loadingOlder: true };
    const next = chatSessionReducer(state, {
      type: 'older-success',
      messages: [{ ...assistant }, { ...assistant, id: 'older-1' }],
    });
    expect(next.messages.map((message) => message.id)).toEqual(['older-1', 'assistant-1']);
    expect(next.loadingOlder).toBe(false);
  });

  it('closes streaming when an interaction pauses and the stream ends without final', async () => {
    async function* permissionStream() {
      yield {
        type: 'interaction' as const,
        interaction: {
          type: 'interaction' as const,
          id: 'permission-1',
          kind: 'permission',
          status: 'pending' as const,
          payload: {},
        },
      };
    }
    const actions: Array<{ type: string }> = [];
    await consumeChatStream(permissionStream(), assistant.id, (action) => actions.push(action));
    expect(actions.at(-1)?.type).toBe('stream-stop');
  });
});
