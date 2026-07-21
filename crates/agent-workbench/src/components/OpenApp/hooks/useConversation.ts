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
import { useChatSession } from '@nuwax-ai/chat-kit/react';

import type {
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchMessage,
  WorkbenchPermissionRequest,
  WorkbenchMcpAskInteraction,
  WorkbenchMcpAskRespondPayload,
  WorkbenchSendMessageRequest,
  WorkbenchStreamEvent,
} from '../../../types';
import type { RunOverStep } from '../../MarkdownRenderer';
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
// Reducer (exported for tests)
// ---------------------------------------------------------------------------

export interface ConversationState {
  activeConversation: WorkbenchConversation | null;
  messages: WorkbenchMessage[];
  streaming: boolean;
  activeRequestId: string | null;
  permissionRequest: WorkbenchPermissionRequest | null;
  mcpAskInteraction: WorkbenchMcpAskInteraction | null;
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;
}

export const initialConversationState: ConversationState = {
  activeConversation: null,
  messages: [],
  streaming: false,
  activeRequestId: null,
  permissionRequest: null,
  mcpAskInteraction: null,
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
  | { type: 'permissionCleared' }
  | { type: 'mcpAskShown'; interaction: WorkbenchMcpAskInteraction }
  | { type: 'mcpAskCleared' }
  | { type: 'mcpAskSubmitting' }
  | {
      type: 'mcpAskFailed';
      error: string;
    };

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
      return {
        ...state,
        activeConversation: action.conversation,
        messages: [],
        hasMoreMessages: false,
        permissionRequest: null,
        mcpAskInteraction: null,
        loadingMoreMessages: false,
        streaming: false,
        activeRequestId: null,
      };
    case 'loadConversationSuccess':
      return {
        ...state,
        activeConversation: action.conversation,
        messages: action.messages,
        hasMoreMessages: action.hasMore,
        permissionRequest: null,
        mcpAskInteraction: null,
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
        mcpAskInteraction: null,
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
    case 'mcpAskShown':
      return { ...state, mcpAskInteraction: action.interaction };
    case 'mcpAskSubmitting':
      return state.mcpAskInteraction
        ? {
            ...state,
            mcpAskInteraction: {
              ...state.mcpAskInteraction,
              responseStatus: 'submitting',
            },
          }
        : state;
    case 'mcpAskFailed':
      return state.mcpAskInteraction
        ? {
            ...state,
            mcpAskInteraction: {
              ...state.mcpAskInteraction,
              responseStatus: 'failed',
              errorMessage: action.error,
            },
          }
        : state;
    case 'mcpAskCleared':
      return { ...state, mcpAskInteraction: null };
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
 * Routing:
 *   - `chunk`      → append to `message.content`
 *   - `thought`    → accumulate in `metadata.thinking` (for ThinkingBlock)
 *   - `processing` → accumulate in `metadata.runOverSteps` (for RunOver)
 *   - `final`      → mark stream complete, set `runOverStatus = 'done'`
 *   - `error`      → mark stream errored
 */
export function streamEventToMessagePatch(
  event: WorkbenchStreamEvent,
): ((msg: WorkbenchMessage) => WorkbenchMessage) | null {
  if (event.type === 'chunk') {
    const delta = event.content ?? '';
    return (message) => ({
      ...message,
      content: `${message.content}${delta}`,
      kind: message.kind ?? 'text',
      status: 'streaming',
    });
  }

  if (event.type === 'thought') {
    const delta = event.content ?? '';
    return (message) => {
      const meta = { ...((message.metadata as Record<string, unknown>) ?? {}) };
      const prev = typeof meta.thinking === 'string' ? meta.thinking : '';
      meta.thinking = `${prev}${delta}`;
      return { ...message, metadata: meta, status: 'streaming' };
    };
  }

  if (event.type === 'processing') {
    return (message) => {
      const meta = { ...((message.metadata as Record<string, unknown>) ?? {}) };
      const steps = Array.isArray(meta.runOverSteps)
        ? ([...meta.runOverSteps] as RunOverStep[])
        : [];
      const step = parseProcessingStep(event, steps.length);
      if (step) {
        // Upsert by id: replace existing step with same id, otherwise append.
        const idx = steps.findIndex((s) => s.id === step.id);
        if (idx >= 0) steps[idx] = step;
        else steps.push(step);
        meta.runOverSteps = steps;
        meta.runOverStatus = 'running';
      }
      return { ...message, metadata: meta, status: 'streaming' };
    };
  }

  if (event.type === 'final') {
    return (message) => {
      const meta = { ...((message.metadata as Record<string, unknown>) ?? {}) };
      if (Array.isArray(meta.runOverSteps) && (meta.runOverSteps as unknown[]).length > 0) {
        meta.runOverStatus = 'done';
      }
      // Extract token usage from the final event's raw payload.
      // nuwax sends it under tokenUsage / usage / token_usage.
      const raw = event.raw as Record<string, unknown> | undefined;
      if (raw) {
        const usage =
          (raw.tokenUsage as Record<string, unknown> | undefined) ??
          (raw.usage as Record<string, unknown> | undefined) ??
          (raw.token_usage as Record<string, unknown> | undefined);
        if (usage) {
          meta.tokenUsage = {
            input: Number(usage.input ?? usage.prompt_tokens ?? usage.promptTokens ?? 0),
            output: Number(usage.output ?? usage.completion_tokens ?? usage.completionTokens ?? 0),
            total: Number(usage.total ?? usage.total_tokens ?? usage.totalTokens ?? 0),
          };
        }
      }
      return {
        ...message,
        content: event.content || message.content,
        status: 'complete',
        kind: 'text',
        metadata: meta,
      };
    };
  }

  if (event.type === 'error') {
    return (message) => {
      const meta = { ...((message.metadata as Record<string, unknown>) ?? {}) };
      if (Array.isArray(meta.runOverSteps) && (meta.runOverSteps as unknown[]).length > 0) {
        meta.runOverStatus = 'error';
      }
      return {
        ...message,
        content: event.error ?? 'Agent stream failed',
        status: 'error',
        kind: 'error',
        metadata: meta,
      };
    };
  }

  return null;
}

/**
 * Convert a `processing` SSE event into a `RunOverStep`.
 *
 * nuwax PROCESSING events carry a `processingList` array in their data
 * payload. Each entry has `{ executeId, name, status, result? }`. When the
 * event wraps a single step we read from the top level; when it carries a
 * list we pick the latest entry.
 */
function parseProcessingStep(
  event: WorkbenchStreamEvent,
  fallbackIndex: number,
): RunOverStep | null {
  const data = event.processingData ?? (event.raw as Record<string, unknown> | undefined);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    // Fallback: synthesise a generic step from the text content.
    const text = (event.content ?? '').trim();
    if (!text) return null;
    return {
      id: `step-${fallbackIndex}`,
      name: text.slice(0, 80),
      status: 'executing',
    };
  }

  const record = data as Record<string, unknown>;
  // If the payload contains a processingList, pick the last entry.
  const list = Array.isArray(record.processingList)
    ? record.processingList
    : Array.isArray(record.processing_list)
      ? record.processing_list
      : null;
  // Empty list = no steps to report; don't create a phantom from the envelope.
  if (list && list.length === 0) return null;
  const source =
    list && list.length > 0
      ? (list[list.length - 1] as Record<string, unknown>)
      : record;

  const id =
    String(source.executeId || source.execute_id || source.id || `step-${fallbackIndex}`);
  const name =
    String(source.name ?? source.title ?? source.tool ?? event.content ?? 'Processing').slice(
      0,
      120,
    );
  const rawStatus = String(source.status ?? 'executing').toLowerCase();
  const status: RunOverStep['status'] =
    rawStatus === 'done' || rawStatus === 'completed' || rawStatus === 'success'
      ? 'done'
      : rawStatus === 'error' || rawStatus === 'failed'
        ? 'error'
        : 'executing';

  let durationMs: number | undefined;
  const result = source.result as Record<string, unknown> | undefined;
  if (result && typeof result.startTime === 'number' && typeof result.endTime === 'number') {
    durationMs = result.endTime - result.startTime;
  }

  return { id, name, status, durationMs };
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

/** Headless state reader used by host adapters outside React. */
export type ConversationGetState = () => ConversationState;
/** Headless dispatcher used by host adapters outside React. */
export type ConversationDispatch = (action: ConversationAction) => void;

export async function loadConversationAction(
  _getState: ConversationGetState,
  dispatch: ConversationDispatch,
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
  _getState: ConversationGetState,
  dispatch: ConversationDispatch,
  deps: ActionDeps,
  title?: string,
): Promise<WorkbenchConversation> {
  const conversation = await deps.adapter.createConversation(deps.agentId, title);
  dispatch({ type: 'setActiveConversation', conversation });
  return conversation;
}

export async function loadMoreMessagesAction(
  getState: ConversationGetState,
  dispatch: ConversationDispatch,
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
  getState: ConversationGetState,
  dispatch: ConversationDispatch,
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
      if (event.type === 'mcp_ask' && event.mcpAsk) {
        dispatch({ type: 'mcpAskShown', interaction: event.mcpAsk });
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
      patch: (msg) => {
        const meta = { ...((msg.metadata as Record<string, unknown>) ?? {}) };
        if (Array.isArray(meta.runOverSteps) && (meta.runOverSteps as unknown[]).length > 0) {
          meta.runOverStatus = 'error';
        }
        return { ...msg, content: message, kind: 'error', status: 'error', metadata: meta };
      },
    });
    deps.reportError(cause, { phase: 'sendMessage' });
  } finally {
    dispatch({ type: 'streamFinished' });
  }
}

export async function stopStreamAction(
  getState: ConversationGetState,
  dispatch: ConversationDispatch,
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
  getState: ConversationGetState,
  dispatch: ConversationDispatch,
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

export async function answerMcpAskAction(
  getState: ConversationGetState,
  dispatch: ConversationDispatch,
  deps: ActionDeps,
  payload: WorkbenchMcpAskRespondPayload,
): Promise<void> {
  const current = getState();
  if (!current.mcpAskInteraction) return;
  dispatch({ type: 'mcpAskSubmitting' });
  try {
    await deps.adapter.respondMcpAsk?.(payload, {
      agentId: deps.agentId,
    });
    dispatch({ type: 'mcpAskCleared' });
  } catch (cause) {
    deps.reportError(cause, {
      phase: 'respondMcpAsk',
      interventionId: payload.interventionId,
    });
    dispatch({
      type: 'mcpAskFailed',
      error: cause instanceof Error ? cause.message : 'Failed to respond',
    });
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
