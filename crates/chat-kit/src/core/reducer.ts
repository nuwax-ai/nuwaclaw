import type {
  ChatConversation,
  ChatInteractionPart,
  ChatMessage,
  ChatStreamEvent,
} from './types';

export interface ChatSessionState {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  streaming: boolean;
  requestId: string | null;
  pendingInteraction: ChatInteractionPart | null;
  olderCursor: string | null;
  loadingOlder: boolean;
  error: string | null;
}

export const initialChatSessionState: ChatSessionState = {
  conversation: null,
  messages: [],
  streaming: false,
  requestId: null,
  pendingInteraction: null,
  olderCursor: null,
  loadingOlder: false,
  error: null,
};

export type ChatSessionAction =
  | { type: 'reset' }
  | { type: 'load-start'; conversation: ChatConversation }
  | {
      type: 'load-success';
      conversation: ChatConversation;
      messages: ChatMessage[];
      olderCursor?: string | null;
    }
  | { type: 'older-start' }
  | { type: 'older-success'; messages: ChatMessage[]; olderCursor?: string | null }
  | { type: 'append'; messages: ChatMessage[] }
  | { type: 'stream-start'; requestId?: string | null }
  | { type: 'stream-event'; event: ChatStreamEvent; assistantMessageId: string }
  | { type: 'stream-stop' }
  | { type: 'interaction-clear' }
  | { type: 'failure'; error: string };

function appendUnique(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const ids = new Set(existing.map((message) => message.id));
  return [...existing, ...incoming.filter((message) => !ids.has(message.id))];
}

function prependUnique(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const ids = new Set(existing.map((message) => message.id));
  return [...incoming.filter((message) => !ids.has(message.id)), ...existing];
}

function patchAssistant(
  messages: ChatMessage[],
  id: string,
  patch: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) return messages;
  const next = messages.slice();
  next[index] = patch(next[index]);
  return next;
}

function appendPartText(
  message: ChatMessage,
  type: 'text' | 'thinking',
  text: string,
): ChatMessage {
  const parts = message.parts.slice();
  const index = parts.findIndex((part) => part.type === type);
  if (index < 0) {
    parts.push(type === 'text' ? { type, text } : { type, text, status: 'streaming' });
  } else {
    const part = parts[index];
    if (part.type === 'text' || part.type === 'thinking') {
      parts[index] = { ...part, text: `${part.text}${text}` };
    }
  }
  return { ...message, parts };
}

export function reduceChatStreamEvent(
  state: ChatSessionState,
  event: ChatStreamEvent,
  assistantMessageId: string,
): ChatSessionState {
  if (event.type === 'request') {
    return { ...state, requestId: event.requestId };
  }
  if (event.type === 'text-delta' || event.type === 'thinking-delta') {
    return {
      ...state,
      messages: patchAssistant(state.messages, event.messageId ?? assistantMessageId, (message) =>
        appendPartText(
          { ...message, status: 'streaming' },
          event.type === 'text-delta' ? 'text' : 'thinking',
          event.text,
        ),
      ),
    };
  }
  if (event.type === 'tool-update') {
    return {
      ...state,
      messages: patchAssistant(state.messages, event.messageId ?? assistantMessageId, (message) => {
        const parts = message.parts.filter(
          (part) => part.type !== 'tool' || part.id !== event.tool.id,
        );
        return { ...message, status: 'streaming', parts: [...parts, event.tool] };
      }),
    };
  }
  if (event.type === 'interaction') {
    return { ...state, pendingInteraction: event.interaction };
  }
  if (event.type === 'final') {
    return {
      ...state,
      streaming: false,
      requestId: null,
      messages: patchAssistant(state.messages, event.messageId ?? assistantMessageId, (message) => {
        const patched = event.text ? appendPartText(message, 'text', event.text) : message;
        return {
          ...patched,
          status: 'complete',
          metadata: { ...patched.metadata, ...event.metadata },
        };
      }),
    };
  }
  return {
    ...state,
    streaming: false,
    requestId: null,
    error: event.error,
    messages: patchAssistant(state.messages, event.messageId ?? assistantMessageId, (message) => ({
      ...message,
      status: 'error',
      parts: [...message.parts, { type: 'error', message: event.error }],
    })),
  };
}

export function chatSessionReducer(
  state: ChatSessionState,
  action: ChatSessionAction,
): ChatSessionState {
  switch (action.type) {
    case 'reset':
      return initialChatSessionState;
    case 'load-start':
      return { ...initialChatSessionState, conversation: action.conversation };
    case 'load-success':
      return {
        ...state,
        conversation: action.conversation,
        messages: action.messages,
        olderCursor: action.olderCursor ?? null,
        error: null,
      };
    case 'older-start':
      return { ...state, loadingOlder: true };
    case 'older-success':
      return {
        ...state,
        messages: prependUnique(state.messages, action.messages),
        olderCursor: action.olderCursor ?? null,
        loadingOlder: false,
      };
    case 'append':
      return { ...state, messages: appendUnique(state.messages, action.messages) };
    case 'stream-start':
      return { ...state, streaming: true, requestId: action.requestId ?? null, error: null };
    case 'stream-event':
      return reduceChatStreamEvent(state, action.event, action.assistantMessageId);
    case 'stream-stop':
      return { ...state, streaming: false, requestId: null };
    case 'interaction-clear':
      return { ...state, pendingInteraction: null };
    case 'failure':
      return { ...state, streaming: false, loadingOlder: false, error: action.error };
  }
}
