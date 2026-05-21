/**
 * useConversation — message / conversation state hub for OpenApp.
 *
 * State consolidated under useReducer (messagesReducer, exported).
 * SSE events mapped via streamEventToAction (exported).
 * Adapter calls wrapped in useCallback with ref-based getState to avoid
 * stale closures during long-running sendPrompt loops where stopStream /
 * answerPermission may interleave.
 *
 * Parity with nuwax `src/models/conversationInfo.ts`:
 *   fields: activeConversation, messages, streaming, activeRequestId,
 *   permissionRequest, hasMoreMessages, loadingMoreMessages
 *   actions: loadConversation, createConversation, sendPrompt,
 *   stopStream, answerPermission, loadMoreMessages, reset
 *   (conversation list / suggest / model options owned by parent)
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type {
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchMessage,
  WorkbenchPermissionRequest,
  WorkbenchSendMessageRequest,
  WorkbenchStreamEvent,
} from '../../../types';

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
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;

  // ----- actions -----
  loadConversation: (conversation: WorkbenchConversation) => Promise<void>;
  createConversation: (title?: string) => Promise<WorkbenchConversation>;
  sendPrompt: (params: SendPromptParams) => Promise<void>;
  stopStream: () => Promise<void>;
  answerPermission: (choiceId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Reducer (exported for tests)
// ---------------------------------------------------------------------------

export interface ConversationState {
  activeConversation: WorkbenchConversation | null;
  messages: WorkbenchMessage[];
  streaming: boolean;
  activeRequestId: string | null;
  permissionRequest: WorkbenchPermissionRequest | null;
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;
}

export const initialConversationState: ConversationState = {
  activeConversation: null,
  messages: [],
  streaming: false,
  activeRequestId: null,
  permissionRequest: null,
  hasMoreMessages: false,
  loadingMoreMessages: false,
};

export type ConversationAction =
  | { type: 'reset' }
  | { type: 'setActiveConversation'; conversation: WorkbenchConversation | null }
  | {
      type: 'loadConversationSuccess';
      conversation: WorkbenchConversation;
      messages: WorkbenchMessage[];
      hasMore: boolean;
    }
  | {
      type: 'prependMessages';
      messages: WorkbenchMessage[];
      hasMore: boolean;
    }
  | { type: 'setLoadingMore'; value: boolean }
  | { type: 'appendMessages'; messages: WorkbenchMessage[] }
  | { type: 'startStream'; requestId: string | null }
  | { type: 'setActiveRequestId'; requestId: string | null }
  | { type: 'streamFinished' }
  | {
      type: 'patchMessage';
      messageId: string;
      patch: (msg: WorkbenchMessage) => WorkbenchMessage;
    }
  | { type: 'permissionShown'; request: WorkbenchPermissionRequest }
  | { type: 'permissionCleared' };

/**
 * Pure state reducer. Exported for unit tests.
 *
 * IMPORTANT: This reducer never reads from outside its inputs. All side
 * effects (adapter calls, ID generation, time stamps) live in the hook
 * action handlers, which dispatch the appropriate actions.
 */
export function messagesReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'reset':
      return initialConversationState;
    case 'setActiveConversation':
      return { ...state, activeConversation: action.conversation };
    case 'loadConversationSuccess':
      return {
        ...state,
        activeConversation: action.conversation,
        messages: action.messages,
        hasMoreMessages: action.hasMore,
        permissionRequest: null,
        loadingMoreMessages: false,
      };
    case 'prependMessages': {
      const existing = new Set(state.messages.map((m) => m.id));
      const older = action.messages.filter((m) => !existing.has(m.id));
      return {
        ...state,
        messages: [...older, ...state.messages],
        hasMoreMessages: action.hasMore,
        loadingMoreMessages: false,
      };
    }
    case 'setLoadingMore':
      return { ...state, loadingMoreMessages: action.value };
    case 'appendMessages':
      return { ...state, messages: [...state.messages, ...action.messages] };
    case 'startStream':
      return {
        ...state,
        streaming: true,
        activeRequestId: action.requestId,
        permissionRequest: null,
      };
    case 'setActiveRequestId':
      return { ...state, activeRequestId: action.requestId };
    case 'streamFinished':
      return { ...state, streaming: false, activeRequestId: null };
    case 'patchMessage':
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === action.messageId ? action.patch(msg) : msg,
        ),
      };
    case 'permissionShown':
      return { ...state, permissionRequest: action.request };
    case 'permissionCleared':
      return { ...state, permissionRequest: null };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Stream event → message patch (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Translate a single SSE event into the message-patch closure that should
 * be applied to the streaming assistant message. Returns `null` for
 * events that do not target the assistant message body (e.g. `permission`).
 *
 * Mirrors the inline `updateAssistantMessage` logic in NuwaxOpenApp.tsx.
 */
export function streamEventToMessagePatch(
  event: WorkbenchStreamEvent,
): ((msg: WorkbenchMessage) => WorkbenchMessage) | null {
  if (event.type === 'chunk' || event.type === 'thought') {
    const delta = event.content ?? '';
    return (message) => ({
      ...message,
      content: `${message.content}${delta}`,
      kind: event.type === 'thought' ? 'thought' : message.kind ?? 'text',
      status: 'streaming',
    });
  }
  if (event.type === 'final') {
    return (message) => ({
      ...message,
      content: event.content || message.content,
      status: 'complete',
      kind: 'text',
    });
  }
  if (event.type === 'error') {
    return (message) => ({
      ...message,
      content: event.error ?? 'Agent stream failed',
      status: 'error',
      kind: 'error',
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pagination cursor helper (exported for tests)
// ---------------------------------------------------------------------------

/** Reads the nuwax `index` cursor from a message's metadata bag. */
export function getMessageIndex(message: WorkbenchMessage): number | undefined {
  const meta = message.metadata;
  if (!meta || typeof meta !== 'object') return undefined;
  const raw =
    (meta as Record<string, unknown>).index ??
    (meta as Record<string, unknown>).messageIndex ??
    (meta as Record<string, unknown>).message_index;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Local id / timestamp helpers (exported for tests / parity with NuwaxOpenApp)
// ---------------------------------------------------------------------------

export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Pure action handlers (exported for tests)
//
// These take `(getState, dispatch, deps, args)` so they can be exercised
// without a React render. The hook wraps them in `useCallback` and supplies
// `getState`/`dispatch` from the local reducer.
// ---------------------------------------------------------------------------

export interface ActionDeps {
  adapter: WorkbenchApiAdapter;
  agentId: string;
  messagePageSize: number;
  reportError: (err: unknown, context?: Record<string, unknown>) => void;
  /** Generators are injected so tests can produce deterministic IDs/times. */
  createId?: (prefix: string) => string;
  now?: () => string;
}

type GetState = () => ConversationState;
type Dispatch = (action: ConversationAction) => void;

export async function loadConversationAction(
  _getState: GetState,
  dispatch: Dispatch,
  deps: ActionDeps,
  conversation: WorkbenchConversation,
): Promise<void> {
  dispatch({ type: 'setActiveConversation', conversation });
  try {
    const detail = await deps.adapter.getConversation(deps.agentId, conversation.id);
    dispatch({
      type: 'loadConversationSuccess',
      conversation: detail.conversation,
      messages: detail.messages,
      hasMore: detail.hasMore === true,
    });
  } catch (cause) {
    deps.reportError(cause, {
      phase: 'getConversation',
      conversationId: conversation.id,
    });
  }
}

export async function createConversationAction(
  _getState: GetState,
  dispatch: Dispatch,
  deps: ActionDeps,
  title?: string,
): Promise<WorkbenchConversation> {
  const conversation = await deps.adapter.createConversation(deps.agentId, title);
  dispatch({ type: 'setActiveConversation', conversation });
  return conversation;
}

export async function loadMoreMessagesAction(
  getState: GetState,
  dispatch: Dispatch,
  deps: ActionDeps,
): Promise<void> {
  const current = getState();
  if (
    !current.activeConversation ||
    current.loadingMoreMessages ||
    !current.hasMoreMessages
  ) {
    return;
  }
  if (current.messages.length === 0) {
    // Nothing to anchor against — pretend the list is done.
    dispatch({ type: 'prependMessages', messages: [], hasMore: false });
    return;
  }
  const cursor = getMessageIndex(current.messages[0]) ?? 0;
  dispatch({ type: 'setLoadingMore', value: true });
  try {
    const detail = await deps.adapter.getConversation(
      deps.agentId,
      current.activeConversation.id,
      { index: cursor, size: deps.messagePageSize },
    );
    dispatch({
      type: 'prependMessages',
      messages: detail.messages,
      hasMore: detail.hasMore === true,
    });
  } catch (cause) {
    deps.reportError(cause, {
      phase: 'getConversation',
      conversationId: current.activeConversation.id,
      index: cursor,
    });
    dispatch({ type: 'setLoadingMore', value: false });
  }
}

export async function sendPromptAction(
  getState: GetState,
  dispatch: Dispatch,
  deps: ActionDeps,
  params: SendPromptParams,
): Promise<void> {
  if (!deps.agentId) return;
  const current = getState();
  if (current.streaming) {
    throw new Error('useConversation: stream already in progress');
  }

  const content = params.content.trim();
  if (!content) return;

  const makeId = deps.createId ?? createLocalId;
  const ts = deps.now ?? nowIso;

  // Materialize the target conversation (create one if needed).
  let conversation: WorkbenchConversation;
  if (
    params.conversationId &&
    current.activeConversation?.id === params.conversationId
  ) {
    conversation = current.activeConversation;
  } else if (params.conversationId) {
    conversation = {
      id: params.conversationId,
      agentId: deps.agentId,
      title: '',
      createdAt: ts(),
      updatedAt: ts(),
      status: 'idle',
    };
    dispatch({ type: 'setActiveConversation', conversation });
  } else if (current.activeConversation) {
    conversation = current.activeConversation;
  } else {
    conversation = await deps.adapter.createConversation(
      deps.agentId,
      content.slice(0, 48),
    );
    dispatch({ type: 'setActiveConversation', conversation });
  }

  const userMessage: WorkbenchMessage = {
    id: makeId('user'),
    conversationId: conversation.id,
    role: 'user',
    content,
    createdAt: ts(),
    kind: 'text',
    status: 'complete',
  };
  const assistantId = makeId('assistant');
  const assistantMessage: WorkbenchMessage = {
    id: assistantId,
    conversationId: conversation.id,
    role: 'assistant',
    content: '',
    createdAt: ts(),
    kind: 'text',
    status: 'streaming',
  };
  dispatch({
    type: 'appendMessages',
    messages: [userMessage, assistantMessage],
  });

  const localRequestId = params.requestId ?? makeId('req');
  dispatch({ type: 'startStream', requestId: localRequestId });

  try {
    const request: WorkbenchSendMessageRequest = {
      ...params,
      agentId: deps.agentId,
      conversationId: conversation.id,
      requestId: localRequestId,
    };
    for await (const event of deps.adapter.sendMessage(request)) {
      if (event.requestId) {
        dispatch({ type: 'setActiveRequestId', requestId: event.requestId });
      }
      if (event.type === 'permission' && event.permission) {
        dispatch({ type: 'permissionShown', request: event.permission });
        continue;
      }
      const patch = streamEventToMessagePatch(event);
      if (patch) {
        dispatch({ type: 'patchMessage', messageId: assistantId, patch });
      }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Send failed';
    dispatch({
      type: 'patchMessage',
      messageId: assistantId,
      patch: (msg) => ({
        ...msg,
        content: message,
        kind: 'error',
        status: 'error',
      }),
    });
    deps.reportError(cause, { phase: 'sendMessage' });
  } finally {
    dispatch({ type: 'streamFinished' });
  }
}

export async function stopStreamAction(
  getState: GetState,
  dispatch: Dispatch,
  deps: ActionDeps,
): Promise<void> {
  const current = getState();
  if (
    !current.streaming ||
    !current.activeConversation ||
    !current.activeRequestId
  ) {
    return;
  }
  try {
    await deps.adapter.stopChat?.(current.activeRequestId, {
      agentId: deps.agentId,
      conversationId: current.activeConversation.id,
    });
  } catch (cause) {
    deps.reportError(cause, {
      phase: 'stopChat',
      requestId: current.activeRequestId,
    });
  } finally {
    // The adapter's response is advisory; we always clear the local
    // streaming flag so the UI can recover even if the stop call fails.
    dispatch({ type: 'streamFinished' });
  }
}

export async function answerPermissionAction(
  getState: GetState,
  dispatch: Dispatch,
  deps: ActionDeps,
  choiceId: string,
): Promise<void> {
  const current = getState();
  if (!current.permissionRequest || !current.activeConversation) return;
  try {
    await deps.adapter.respondPermission?.(
      current.permissionRequest.id,
      choiceId,
      {
        agentId: deps.agentId,
        conversationId: current.activeConversation.id,
      },
    );
  } catch (cause) {
    // Permission response is optional API — log but do not surface.
    deps.reportError(cause, {
      phase: 'respondPermission',
      permissionId: current.permissionRequest.id,
    });
  } finally {
    dispatch({ type: 'permissionCleared' });
  }
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

  const [state, dispatch] = useReducer(messagesReducer, initialConversationState);

  // Keep a live ref so async loops can read up-to-date state without
  // re-binding every iteration.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reportError = useCallback(
    (err: unknown, context?: Record<string, unknown>) => {
      if (onError) onError(err, context);
      else console.error('[useConversation]', err, context);
    },
    [onError],
  );

  const deps = useMemo<ActionDeps>(
    () => ({ adapter, agentId, messagePageSize, reportError }),
    [adapter, agentId, messagePageSize, reportError],
  );

  const getState: GetState = useCallback(() => stateRef.current, []);

  const loadConversation = useCallback(
    (conversation: WorkbenchConversation) =>
      loadConversationAction(getState, dispatch, deps, conversation),
    [deps, getState],
  );

  const createConversation = useCallback(
    (title?: string) => createConversationAction(getState, dispatch, deps, title),
    [deps, getState],
  );

  const sendPrompt = useCallback(
    (params: SendPromptParams) => sendPromptAction(getState, dispatch, deps, params),
    [deps, getState],
  );

  const stopStream = useCallback(
    () => stopStreamAction(getState, dispatch, deps),
    [deps, getState],
  );

  const answerPermission = useCallback(
    (choiceId: string) =>
      answerPermissionAction(getState, dispatch, deps, choiceId),
    [deps, getState],
  );

  const loadMoreMessages = useCallback(
    () => loadMoreMessagesAction(getState, dispatch, deps),
    [deps, getState],
  );

  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  // Auto-load the initial conversation, if provided.
  const initialLoadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialConversationId || initialLoadRef.current === initialConversationId) {
      return;
    }
    initialLoadRef.current = initialConversationId;
    // Synthesize a stub conversation; loadConversation will refetch full detail.
    void loadConversation({
      id: initialConversationId,
      agentId,
      title: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'idle',
    });
  }, [agentId, initialConversationId, loadConversation]);

  return useMemo<UseConversationApi>(
    () => ({
      activeConversation: state.activeConversation,
      messages: state.messages,
      streaming: state.streaming,
      activeRequestId: state.activeRequestId,
      permissionRequest: state.permissionRequest,
      hasMoreMessages: state.hasMoreMessages,
      loadingMoreMessages: state.loadingMoreMessages,
      loadConversation,
      createConversation,
      sendPrompt,
      stopStream,
      answerPermission,
      loadMoreMessages,
      reset,
    }),
    [
      state,
      loadConversation,
      createConversation,
      sendPrompt,
      stopStream,
      answerPermission,
      loadMoreMessages,
      reset,
    ],
  );
}
