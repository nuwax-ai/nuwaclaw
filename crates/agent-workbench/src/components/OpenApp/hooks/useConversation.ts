/**
 * useConversation — message / conversation state hub for OpenApp.
 *
 * Thin wrapper around chat-kit's headless `useChatSession`: it builds a
 * `ChatAdapter` from the host's `WorkbenchApiAdapter` (`createWorkbenchChatAdapter`),
 * runs the session, and projects chat-kit's structured state back into the
 * workbench shapes consumed by NuwaxOpenApp — `WorkbenchMessage` /`
 * WorkbenchConversation` (carrying `parts` verbatim via `fromChatMessage`) plus
 * the `permissionRequest` / `mcpAskInteraction` views over `pendingInteraction`.
 *
 * Streaming, pagination, and interaction state live entirely in chat-kit's
 * reducer; this hook adds no state machine of its own.
 *
 * Parity surface (consumed by NuwaxOpenApp):
 *   fields: activeConversation, messages, streaming, activeRequestId,
 *           permissionRequest, mcpAskInteraction, hasMoreMessages, loadingMoreMessages
 *   actions: loadConversation, createConversation, sendPrompt,
 *            stopStream, answerPermission, answerMcpAsk, loadMoreMessages, reset
 */

import { useMemo } from 'react';
import { useChatSession } from '@nuwax-ai/chat-kit/react';

import type {
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchMessage,
  WorkbenchPermissionRequest,
  WorkbenchMcpAskInteraction,
  WorkbenchMcpAskRespondPayload,
  WorkbenchSendMessageRequest,
} from '../../../types';
import { nowIso } from '../utils';
import {
  createWorkbenchChatAdapter,
  fromChatConversation,
  fromChatMessage,
  toChatConversation,
} from '../../../adapters/chatKitAdapter';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UseConversationOptions {
  adapter: WorkbenchApiAdapter;
  agentId: string;
  /** Optional initial conversation id to load on mount. */
  initialConversationId?: string;
  /** Page size for `loadMoreMessages`. Defaults to 10 (matches nuwax). */
  messagePageSize?: number;
  /** Error reporter. Defaults to console.error. */
  onError?: (err: unknown, context?: Record<string, unknown>) => void;
}

export type SendPromptParams = Omit<
  WorkbenchSendMessageRequest,
  'agentId' | 'conversationId'
> & {
  /** If omitted, a new conversation is created (using `content.slice(0, 48)` as title). */
  conversationId?: string;
};

export interface UseConversationApi {
  // ----- state -----
  activeConversation: WorkbenchConversation | null;
  messages: WorkbenchMessage[];
  streaming: boolean;
  activeRequestId: string | null;
  permissionRequest: WorkbenchPermissionRequest | null;
  mcpAskInteraction: WorkbenchMcpAskInteraction | null;
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;

  // ----- actions -----
  loadConversation: (conversation: WorkbenchConversation) => Promise<void>;
  createConversation: (title?: string) => Promise<WorkbenchConversation>;
  sendPrompt: (params: SendPromptParams) => Promise<void>;
  stopStream: () => Promise<void>;
  answerPermission: (choiceId: string) => Promise<void>;
  answerMcpAsk: (payload: WorkbenchMcpAskRespondPayload) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversation(opts: UseConversationOptions): UseConversationApi {
  const {
    adapter,
    agentId,
    initialConversationId,
    messagePageSize = 10,
    onError,
  } = opts;
  const chatAdapter = useMemo(() => createWorkbenchChatAdapter(adapter), [adapter]);
  const initialConversation = useMemo(
    () =>
      initialConversationId
        ? {
            id: initialConversationId,
            agentId,
            title: '',
            updatedAt: nowIso(),
            status: 'idle' as const,
          }
        : undefined,
    [agentId, initialConversationId],
  );
  const session = useChatSession({
    adapter: chatAdapter,
    agentId,
    initialConversation,
    messagePageSize,
    onError,
  });

  const activeConversation = useMemo(
    () => (session.conversation ? fromChatConversation(session.conversation) : null),
    [session.conversation],
  );
  const messages = useMemo(
    () => session.messages.map(fromChatMessage),
    [session.messages],
  );
  const permissionRequest =
    session.pendingInteraction?.kind === 'permission'
      ? (session.pendingInteraction.payload as WorkbenchPermissionRequest)
      : null;
  const mcpAskInteraction =
    session.pendingInteraction?.kind === 'question'
      ? (session.pendingInteraction.payload as WorkbenchMcpAskInteraction)
      : null;

  return useMemo<UseConversationApi>(() => ({
    activeConversation,
    messages,
    streaming: session.streaming,
    activeRequestId: session.requestId,
    permissionRequest,
    mcpAskInteraction,
    hasMoreMessages: Boolean(session.olderCursor),
    loadingMoreMessages: session.loadingOlder,
    loadConversation: (conversation) => session.loadConversation(toChatConversation(conversation)),
    createConversation: async (title) =>
      fromChatConversation(await session.createConversation(title)),
    sendPrompt: (params) => session.send({
      conversationId: params.conversationId,
      text: params.content,
      attachments: (params.attachments ?? []).map((attachment) => ({
        key: attachment.key,
        url: attachment.url,
        name: attachment.fileName ?? attachment.url,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      skillIds: params.skillIds ?? [],
      modelId: params.modelId,
      agentMode: params.agentMode,
      selectedComponentIds: params.selectedComponents?.map((component) => component.id),
      variableParams: params.variableParams,
      sandboxId: params.sandboxId,
      metadata: params.metadata,
    }),
    stopStream: session.stop,
    answerPermission: (choiceId) => session.respondInteraction({ choiceId }),
    answerMcpAsk: session.respondInteraction,
    loadMoreMessages: session.loadOlder,
    reset: session.reset,
  }), [
    activeConversation,
    messages,
    session,
    permissionRequest,
    mcpAskInteraction,
  ]);
}
