import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  chatSessionReducer,
  initialChatSessionState,
  type ChatAdapter,
  type ChatConversation,
  type ChatDraft,
  type ChatMessage,
  type ChatSendCommand,
  type ChatSessionAction,
  type ChatSessionState,
  type ChatStreamEvent,
} from '../core';

export interface UseChatSessionOptions {
  adapter: ChatAdapter;
  agentId: string;
  initialConversation?: ChatConversation;
  messagePageSize?: number;
  createId?: (prefix: string) => string;
  now?: () => string;
  onError?: (error: unknown, context?: Record<string, unknown>) => void;
}

export type UseChatSessionValue = ChatSessionState & {
  loadConversation(conversation: ChatConversation): Promise<void>;
  createConversation(title?: string): Promise<ChatConversation>;
  send(draft: ChatDraft): Promise<void>;
  stop(): Promise<void>;
  loadOlder(): Promise<void>;
  respondInteraction(response: unknown): Promise<void>;
  clearInteraction(): void;
  reset(): void;
};

const defaultCreateId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function consumeChatStream(
  stream: AsyncIterable<ChatStreamEvent>,
  assistantMessageId: string,
  dispatch: (action: ChatSessionAction) => void,
): Promise<void> {
  try {
    for await (const event of stream) {
      dispatch({ type: 'stream-event', event, assistantMessageId });
    }
  } finally {
    // A stream may intentionally end on permission / MCP Ask without a final
    // event. Iterator completion still closes the transport lifecycle while
    // the interaction remains pending for the user.
    dispatch({ type: 'stream-stop' });
  }
}

export function useChatSession({
  adapter,
  agentId,
  initialConversation,
  messagePageSize = 20,
  createId = defaultCreateId,
  now = () => new Date().toISOString(),
  onError,
}: UseChatSessionOptions): UseChatSessionValue {
  const [state, dispatch] = useReducer(chatSessionReducer, initialChatSessionState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reportError = useCallback((error: unknown, context?: Record<string, unknown>) => {
    onError?.(error, context);
  }, [onError]);

  const loadConversation = useCallback(async (conversation: ChatConversation) => {
    dispatch({ type: 'load-start', conversation });
    try {
      const page = await adapter.getConversation(agentId, conversation.id, {
        limit: messagePageSize,
      });
      dispatch({
        type: 'load-success',
        conversation: page.conversation,
        messages: page.items,
        olderCursor: page.nextCursor,
      });
    } catch (error) {
      dispatch({ type: 'failure', error: error instanceof Error ? error.message : String(error) });
      reportError(error, { phase: 'loadConversation', conversationId: conversation.id });
    }
  }, [adapter, agentId, messagePageSize, reportError]);

  const createConversation = useCallback(async (title?: string) => {
    const conversation = await adapter.createConversation(agentId, title);
    dispatch({ type: 'load-success', conversation, messages: [] });
    return conversation;
  }, [adapter, agentId]);

  const send = useCallback(async (draft: ChatDraft) => {
    let conversation = stateRef.current.conversation;
    if (draft.conversationId && conversation?.id !== draft.conversationId) {
      conversation = {
        id: draft.conversationId,
        agentId,
        title: '',
        updatedAt: now(),
        status: 'idle',
      };
    }
    if (!conversation) conversation = await adapter.createConversation(agentId, draft.text.slice(0, 48));
    const createdAt = now();
    const userMessage: ChatMessage = {
      id: createId('user'),
      conversationId: conversation.id,
      role: 'user',
      status: 'complete',
      createdAt,
      parts: [
        { type: 'text', text: draft.text },
        ...draft.attachments.map((attachment) => ({ type: 'attachment' as const, attachment })),
      ],
    };
    const assistantMessage: ChatMessage = {
      id: createId('assistant'),
      conversationId: conversation.id,
      role: 'assistant',
      status: 'streaming',
      createdAt,
      parts: [],
    };
    dispatch({ type: 'load-success', conversation, messages: stateRef.current.messages });
    dispatch({ type: 'append', messages: [userMessage, assistantMessage] });
    dispatch({ type: 'stream-start' });
    const command: ChatSendCommand = { ...draft, agentId, conversationId: conversation.id };
    try {
      await consumeChatStream(adapter.send(command), assistantMessage.id, dispatch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: 'stream-event', event: { type: 'error', error: message }, assistantMessageId: assistantMessage.id });
      reportError(error, { phase: 'send', conversationId: conversation.id });
    }
  }, [adapter, agentId, createId, now, reportError]);

  const stop = useCallback(async () => {
    const current = stateRef.current;
    if (!current.conversation) return;
    const draft: ChatSendCommand = {
      agentId,
      conversationId: current.conversation.id,
      text: '',
      attachments: [],
      skillIds: [],
      requestId: current.requestId ?? undefined,
    };
    await adapter.stop?.(current.requestId ?? current.conversation.id, draft);
    dispatch({ type: 'stream-stop' });
  }, [adapter, agentId]);

  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    if (!current.conversation || !current.olderCursor || current.loadingOlder) return;
    dispatch({ type: 'older-start' });
    try {
      const page = await adapter.getConversation(agentId, current.conversation.id, {
        cursor: current.olderCursor,
        limit: messagePageSize,
      });
      dispatch({ type: 'older-success', messages: page.items, olderCursor: page.nextCursor });
    } catch (error) {
      dispatch({ type: 'failure', error: error instanceof Error ? error.message : String(error) });
      reportError(error, { phase: 'loadOlder', conversationId: current.conversation.id });
    }
  }, [adapter, agentId, messagePageSize, reportError]);

  const respondInteraction = useCallback(async (response: unknown) => {
    const current = stateRef.current;
    if (!current.conversation || !current.pendingInteraction) return;
    await adapter.respondInteraction?.(
      current.pendingInteraction.id,
      response,
      { agentId, conversationId: current.conversation.id },
    );
    dispatch({ type: 'interaction-clear' });
  }, [adapter, agentId]);

  useEffect(() => {
    if (initialConversation) void loadConversation(initialConversation);
  }, [initialConversation?.id]);

  return useMemo(() => ({
    ...state,
    loadConversation,
    createConversation,
    send,
    stop,
    loadOlder,
    respondInteraction,
    clearInteraction: () => dispatch({ type: 'interaction-clear' }),
    reset: () => dispatch({ type: 'reset' }),
  }), [state, loadConversation, createConversation, send, stop, loadOlder, respondInteraction]);
}
