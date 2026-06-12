/**
 * Tests for useConversation (Phase B step 5).
 *
 * The hook is split into:
 *   - A pure reducer (`messagesReducer`) over `ConversationState`.
 *   - Pure SSE event → message-patch translator (`streamEventToMessagePatch`).
 *   - Async action handlers (`*Action`) that take `(getState, dispatch, deps, args)`.
 *   - The hook itself wraps the actions in useCallback and a useReducer.
 *
 * Vitest runs in a `node` environment (no jsdom in this workspace), so the
 * tests exercise the pure pieces directly and drive the async actions
 * against a stub state holder. That gives full coverage of the hook's
 * behavior without requiring a React render harness.
 */
import { describe, expect, it, vi } from 'vitest';

import { createMockApiAdapter } from '../src/adapters/mockApiAdapter';
import {
  ActionDeps,
  ConversationAction,
  ConversationState,
  answerPermissionAction,
  createConversationAction,
  answerMcpAskAction,
  getMessageIndex,
  initialConversationState,
  loadConversationAction,
  loadMoreMessagesAction,
  messagesReducer,
  sendPromptAction,
  stopStreamAction,
  streamEventToMessagePatch,
} from '../src/components/OpenApp/hooks/useConversation';
import type {
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchMcpAskInteraction,
  WorkbenchMcpAskRespondPayload,
  WorkbenchConversationMessages,
  WorkbenchMessage,
  WorkbenchSendMessageRequest,
  WorkbenchStreamEvent,
} from '../src/types';

// ---------------------------------------------------------------------------
// Test harness — a tiny `getState`/`dispatch` pair backed by `messagesReducer`.
// ---------------------------------------------------------------------------

function createStore(initial: ConversationState = initialConversationState) {
  let state = initial;
  const dispatch = (action: ConversationAction) => {
    state = messagesReducer(state, action);
  };
  const getState = () => state;
  return { dispatch, getState };
}

function makeConversation(overrides: Partial<WorkbenchConversation> = {}): WorkbenchConversation {
  return {
    id: 'conv-1',
    agentId: 'agent-1',
    title: 'Test conversation',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    status: 'idle',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<WorkbenchMessage> = {}): WorkbenchMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'assistant',
    content: '',
    createdAt: '2026-05-21T00:00:00.000Z',
    kind: 'text',
    status: 'complete',
    ...overrides,
  };
}

function makeDeps(adapter: WorkbenchApiAdapter, overrides: Partial<ActionDeps> = {}): ActionDeps {
  let counter = 0;
  return {
    adapter,
    agentId: 'agent-1',
    messagePageSize: 10,
    reportError: () => {},
    createId: (prefix: string) => `${prefix}-${counter++}`,
    now: () => '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Reducer
// ---------------------------------------------------------------------------

describe('messagesReducer', () => {
  it('returns initial state by default', () => {
    expect(initialConversationState).toEqual({
      activeConversation: null,
      messages: [],
     streaming: false,
     activeRequestId: null,
     permissionRequest: null,
     mcpAskInteraction: null,
     hasMoreMessages: false,
     loadingMoreMessages: false,
   });
  });

  it('clears messages and flags when switching active conversation', () => {
    const before: ConversationState = {
      ...initialConversationState,
      messages: [makeMessage({ id: 'm-old' })],
      permissionRequest: { id: 'p1', title: 'old' },
      streaming: true,
      activeRequestId: 'req-1',
    };
    const after = messagesReducer(before, {
      type: 'setActiveConversation',
      conversation: makeConversation({ id: 'conv-2' }),
    });
    expect(after.activeConversation?.id).toBe('conv-2');
    expect(after.messages).toHaveLength(0);
    expect(after.hasMoreMessages).toBe(false);
    expect(after.permissionRequest).toBeNull();
    expect(after.streaming).toBe(false);
    expect(after.activeRequestId).toBeNull();
  });

  it('loadConversationSuccess replaces messages and clears permission', () => {
    const before: ConversationState = {
      ...initialConversationState,
      permissionRequest: { id: 'p1', title: 'old' },
      messages: [makeMessage({ id: 'stale' })],
      loadingMoreMessages: true,
    };
    const after = messagesReducer(before, {
      type: 'loadConversationSuccess',
      conversation: makeConversation({ id: 'conv-x' }),
      messages: [makeMessage({ id: 'fresh' })],
      hasMore: true,
    });
    expect(after.activeConversation?.id).toBe('conv-x');
    expect(after.messages.map((m) => m.id)).toEqual(['fresh']);
    expect(after.permissionRequest).toBeNull();
    expect(after.hasMoreMessages).toBe(true);
    expect(after.loadingMoreMessages).toBe(false);
  });

  it('prependMessages de-duplicates by id', () => {
    const before: ConversationState = {
      ...initialConversationState,
      messages: [makeMessage({ id: 'b' }), makeMessage({ id: 'c' })],
    };
    const after = messagesReducer(before, {
      type: 'prependMessages',
      messages: [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })],
      hasMore: false,
    });
    // 'b' already exists and is dropped from the prepend.
    expect(after.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(after.hasMoreMessages).toBe(false);
  });

  it('startStream / streamFinished bracket the streaming flag', () => {
    const mid = messagesReducer(initialConversationState, {
      type: 'startStream',
      requestId: 'req-7',
    });
    expect(mid.streaming).toBe(true);
    expect(mid.activeRequestId).toBe('req-7');
    expect(mid.permissionRequest).toBeNull();

    const done = messagesReducer(mid, { type: 'streamFinished' });
    expect(done.streaming).toBe(false);
    expect(done.activeRequestId).toBeNull();
  });

  it('patchMessage applies the patcher to the matching id only', () => {
    const before: ConversationState = {
      ...initialConversationState,
      messages: [
        makeMessage({ id: 'a', content: 'A' }),
        makeMessage({ id: 'b', content: 'B' }),
      ],
    };
    const after = messagesReducer(before, {
      type: 'patchMessage',
      messageId: 'b',
      patch: (msg) => ({ ...msg, content: `${msg.content}!` }),
    });
    expect(after.messages.find((m) => m.id === 'a')?.content).toBe('A');
    expect(after.messages.find((m) => m.id === 'b')?.content).toBe('B!');
  });

  it('reset returns to initial state regardless of input', () => {
    const before: ConversationState = {
      activeConversation: makeConversation(),
      messages: [makeMessage()],
     streaming: true,
     activeRequestId: 'req',
     permissionRequest: { id: 'p', title: 't' },
     mcpAskInteraction: null,
     hasMoreMessages: true,
     loadingMoreMessages: true,
    };
    expect(messagesReducer(before, { type: 'reset' })).toEqual(
      initialConversationState,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Stream event → message patch
// ---------------------------------------------------------------------------

describe('streamEventToMessagePatch', () => {
  it('appends content for chunk events and marks streaming', () => {
    const patch = streamEventToMessagePatch({ type: 'chunk', content: 'hi ' });
    expect(patch).toBeTypeOf('function');
    const msg = makeMessage({ id: 'a', content: 'Hello, ', status: 'streaming' });
    const next = patch!(msg);
    expect(next.content).toBe('Hello, hi ');
    expect(next.status).toBe('streaming');
    expect(next.kind).toBe('text');
  });

  it('accumulates thought events into metadata.thinking (not content)', () => {
    const patch = streamEventToMessagePatch({ type: 'thought', content: 'hmm…' });
    const next = patch!(makeMessage({ content: '' }));
    expect(next.content).toBe('');
    expect(next.status).toBe('streaming');
    const meta = next.metadata as Record<string, unknown>;
    expect(meta.thinking).toBe('hmm…');
  });

  it('appends consecutive thought events to existing thinking', () => {
    const msg = makeMessage({
      content: '',
      metadata: { thinking: 'first part ' },
    });
    const patch = streamEventToMessagePatch({ type: 'thought', content: 'second part' });
    const next = patch!(msg);
    expect((next.metadata as Record<string, unknown>).thinking).toBe('first part second part');
  });

  it('accumulates processing events into metadata.runOverSteps', () => {
    const msg = makeMessage({ content: '', status: 'streaming' });
    const patch = streamEventToMessagePatch({
      type: 'processing',
      content: 'Reading files',
      processingData: {
        processingList: [{ executeId: 'e1', name: 'Read file', status: 'executing' }],
      },
    });
    const next = patch!(msg);
    const meta = next.metadata as Record<string, unknown>;
    expect(meta.runOverStatus).toBe('running');
    const steps = meta.runOverSteps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe('Read file');
    expect(steps[0].status).toBe('executing');
  });

  it('appends multiple processing steps across events', () => {
    const msg = makeMessage({
      content: '',
      status: 'streaming',
      metadata: {
        runOverSteps: [{ id: 'e1', name: 'Read file', status: 'done' }],
        runOverStatus: 'running',
      },
    });
    const patch = streamEventToMessagePatch({
      type: 'processing',
      processingData: {
        processingList: [{ executeId: 'e2', name: 'Write file', status: 'executing' }],
      },
    });
    const next = patch!(msg);
    const steps = (next.metadata as Record<string, unknown>).runOverSteps as Array<
      Record<string, unknown>
    >;
    expect(steps).toHaveLength(2);
    expect(steps[1].name).toBe('Write file');
  });

  it('synthesises a step from content when processingData is absent', () => {
    const patch = streamEventToMessagePatch({
      type: 'processing',
      content: 'Running tool',
    });
    const next = patch!(makeMessage({ content: '', status: 'streaming' }));
    const steps = (next.metadata as Record<string, unknown>).runOverSteps as Array<
      Record<string, unknown>
    >;
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe('Running tool');
    expect(steps[0].status).toBe('executing');
  });

  it('marks runOverStatus as done on final event when steps exist', () => {
    const msg = makeMessage({
      content: 'partial',
      status: 'streaming',
      metadata: {
        runOverSteps: [{ id: 'e1', name: 'Read', status: 'done' }],
        runOverStatus: 'running',
      },
    });
    const patch = streamEventToMessagePatch({ type: 'final', content: 'done' });
    const next = patch!(msg);
    expect(next.status).toBe('complete');
    expect((next.metadata as Record<string, unknown>).runOverStatus).toBe('done');
  });

  it('marks runOverStatus as error on error event when steps exist', () => {
    const msg = makeMessage({
      content: 'partial',
      status: 'streaming',
      metadata: {
        runOverSteps: [{ id: 'e1', name: 'Read', status: 'executing' }],
        runOverStatus: 'running',
      },
    });
    const patch = streamEventToMessagePatch({ type: 'error', error: 'boom' });
    const next = patch!(msg);
    expect(next.status).toBe('error');
    expect((next.metadata as Record<string, unknown>).runOverStatus).toBe('error');
  });

  it('handles mixed sequence: thought → processing → chunk → final', () => {
    const base = makeMessage({ content: '', status: 'streaming' });
    const thoughtPatch = streamEventToMessagePatch({ type: 'thought', content: 'reasoning…' });
    const afterThought = thoughtPatch!(base);
    expect((afterThought.metadata as Record<string, unknown>).thinking).toBe('reasoning…');

    const procPatch = streamEventToMessagePatch({
      type: 'processing',
      processingData: { processingList: [{ executeId: 'e1', name: 'Bash', status: 'done' }] },
    });
    const afterProc = procPatch!(afterThought);
    const procMeta = afterProc.metadata as Record<string, unknown>;
    expect(procMeta.runOverStatus).toBe('running');
    expect((procMeta.runOverSteps as unknown[]).length).toBe(1);

    const chunkPatch = streamEventToMessagePatch({ type: 'chunk', content: 'Here is the result.' });
    const afterChunk = chunkPatch!(afterProc);
    expect(afterChunk.content).toBe('Here is the result.');

    const finalPatch = streamEventToMessagePatch({ type: 'final', content: 'Here is the result.' });
    const afterFinal = finalPatch!(afterChunk);
    expect(afterFinal.status).toBe('complete');
    expect((afterFinal.metadata as Record<string, unknown>).runOverStatus).toBe('done');
    expect((afterFinal.metadata as Record<string, unknown>).thinking).toBe('reasoning…');
  });

  it('overwrites content on final and marks complete', () => {
    const patch = streamEventToMessagePatch({ type: 'final', content: 'final answer' });
    const next = patch!(makeMessage({ content: 'partial' }));
    expect(next.content).toBe('final answer');
    expect(next.status).toBe('complete');
    expect(next.kind).toBe('text');
  });

  it('preserves existing content when final.content is empty', () => {
    const patch = streamEventToMessagePatch({ type: 'final', content: '' });
    const next = patch!(makeMessage({ content: 'streamed text' }));
    expect(next.content).toBe('streamed text');
    expect(next.status).toBe('complete');
  });

  it('marks errors with the error string and error kind', () => {
    const patch = streamEventToMessagePatch({ type: 'error', error: 'boom' });
    const next = patch!(makeMessage({ content: 'partial' }));
    expect(next.content).toBe('boom');
    expect(next.kind).toBe('error');
    expect(next.status).toBe('error');
  });

  it('returns null for events that do not target the assistant body (permission)', () => {
    expect(
      streamEventToMessagePatch({
        type: 'permission',
        permission: { id: 'p', title: 't' },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. getMessageIndex
// ---------------------------------------------------------------------------

describe('getMessageIndex', () => {
  it('reads numeric `index` from metadata', () => {
    expect(getMessageIndex(makeMessage({ metadata: { index: 42 } }))).toBe(42);
  });
  it('falls back to `messageIndex` and `message_index`', () => {
    expect(getMessageIndex(makeMessage({ metadata: { messageIndex: 3 } }))).toBe(3);
    expect(getMessageIndex(makeMessage({ metadata: { message_index: 7 } }))).toBe(7);
  });
  it('parses numeric strings', () => {
    expect(getMessageIndex(makeMessage({ metadata: { index: '12' } }))).toBe(12);
  });
  it('returns undefined when no usable cursor is present', () => {
    expect(getMessageIndex(makeMessage({ metadata: undefined }))).toBeUndefined();
    expect(getMessageIndex(makeMessage({ metadata: { index: 'NaN' } }))).toBeUndefined();
    expect(getMessageIndex(makeMessage({ metadata: { other: 1 } }))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. createConversationAction / loadConversationAction
// ---------------------------------------------------------------------------

describe('createConversationAction', () => {
  it('calls adapter.createConversation and stores the result as active', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const { getState, dispatch } = createStore();
    const conversation = await createConversationAction(
      getState,
      dispatch,
      makeDeps(adapter),
      'My new chat',
    );
    expect(conversation.id).toMatch(/^conv-/);
    expect(getState().activeConversation?.id).toBe(conversation.id);
    expect(getState().activeConversation?.title).toBe('My new chat');
  });
});

describe('loadConversationAction', () => {
  it('sets active conversation immediately and replaces messages on resolve', async () => {
    const conversation = makeConversation({ id: 'conv-load' });
    const messages = [makeMessage({ id: 'm-1', role: 'user', content: 'hi' })];
    const adapter: WorkbenchApiAdapter = {
      async listConversations() {
        return [];
      },
      async createConversation() {
        return conversation;
      },
      async getConversation(): Promise<WorkbenchConversationMessages> {
        return { conversation, messages, hasMore: true };
      },
      async *sendMessage() {},
    };
    const { getState, dispatch } = createStore();
    await loadConversationAction(getState, dispatch, makeDeps(adapter), conversation);
    expect(getState().activeConversation?.id).toBe('conv-load');
    expect(getState().messages).toEqual(messages);
    expect(getState().hasMoreMessages).toBe(true);
  });

  it('reports errors via the deps.reportError callback', async () => {
    const reportError = vi.fn();
    const adapter: WorkbenchApiAdapter = {
      async listConversations() {
        return [];
      },
      async createConversation() {
        return makeConversation();
      },
      async getConversation() {
        throw new Error('network down');
      },
      async *sendMessage() {},
    };
    const { getState, dispatch } = createStore();
    await loadConversationAction(
      getState,
      dispatch,
      makeDeps(adapter, { reportError }),
      makeConversation({ id: 'broken' }),
    );
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError.mock.calls[0][1]).toMatchObject({
      phase: 'getConversation',
      conversationId: 'broken',
    });
  });
});

// ---------------------------------------------------------------------------
// 5. sendPromptAction
// ---------------------------------------------------------------------------

describe('sendPromptAction', () => {
  it('optimistically appends user + assistant messages and consumes the stream', async () => {
    const events: WorkbenchStreamEvent[] = [
      { type: 'chunk', content: 'Hello' },
      { type: 'chunk', content: ', world' },
      { type: 'final', content: 'Hello, world!' },
    ];
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatEvents: events,
    });
    const conversation = await adapter.createConversation('agent-1', 'seed');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      getState,
      dispatch,
      makeDeps(adapter),
      { content: 'ping' },
    );
    const messages = getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'ping' });
    expect(messages[1]).toMatchObject({ role: 'assistant' });
    expect(messages[1].content).toBe('Hello, world!');
    expect(messages[1].status).toBe('complete');
    expect(getState().streaming).toBe(false);
    expect(getState().activeRequestId).toBeNull();
  });

  it('throws when called while a stream is already in progress', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      streaming: true,
      activeRequestId: 'req-1',
      activeConversation: makeConversation(),
    });
    await expect(
      sendPromptAction(getState, dispatch, makeDeps(adapter), { content: 'hi' }),
    ).rejects.toThrow(/stream already in progress/);
  });

  it('creates a fresh conversation when no active one is set', async () => {
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatEvents: [{ type: 'final', content: 'done' }],
    });
    const createSpy = vi.spyOn(adapter, 'createConversation');
    const { getState, dispatch } = createStore();
    await sendPromptAction(
      getState,
      dispatch,
      makeDeps(adapter),
      { content: 'a fresh prompt' },
    );
    expect(createSpy).toHaveBeenCalledWith('agent-1', 'a fresh prompt');
    expect(getState().activeConversation).not.toBeNull();
  });

  it('captures permission events into permissionRequest and continues the stream', async () => {
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatEvents: [
        { type: 'chunk', content: 'thinking…' },
        {
          type: 'permission',
          permission: {
            id: 'perm-9',
            title: 'Run file?',
            choices: [
              { id: 'once', label: 'Once' },
              { id: 'reject', label: 'No', destructive: true },
            ],
          },
        },
        { type: 'final', content: 'done' },
      ],
    });
    const conversation = await adapter.createConversation('agent-1', 'seed');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      getState,
      dispatch,
      makeDeps(adapter),
      { content: 'do it' },
    );
    expect(getState().permissionRequest?.id).toBe('perm-9');
    // The final event still completed the assistant message after permission.
    expect(getState().messages.at(-1)?.status).toBe('complete');
    expect(getState().streaming).toBe(false);
  });

  it('marks the assistant message as error when the stream throws', async () => {
    const reportError = vi.fn();
    const adapter: WorkbenchApiAdapter = {
      async listConversations() {
        return [];
      },
      async createConversation() {
        return makeConversation({ id: 'c-err' });
      },
      async getConversation() {
        return { conversation: makeConversation({ id: 'c-err' }), messages: [] };
      },
      // eslint-disable-next-line require-yield
      async *sendMessage(_req: WorkbenchSendMessageRequest) {
        throw new Error('upstream blew up');
      },
    };
    const conversation = await adapter.createConversation('agent-1');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      getState,
      dispatch,
      makeDeps(adapter, { reportError }),
      { content: 'go' },
    );
    const assistant = getState().messages.find((m) => m.role === 'assistant');
    expect(assistant?.status).toBe('error');
    expect(assistant?.content).toBe('upstream blew up');
    expect(getState().streaming).toBe(false);
    expect(reportError).toHaveBeenCalled();
  });

  it('returns early for empty / whitespace prompts', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const sendSpy = vi.spyOn(adapter, 'sendMessage');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: makeConversation(),
    });
    await sendPromptAction(getState, dispatch, makeDeps(adapter), { content: '   ' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(getState().messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. stopStreamAction
// ---------------------------------------------------------------------------

describe('stopStreamAction', () => {
  it('clears the streaming flag and calls adapter.stopChat with the active request id', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const stopSpy = vi.spyOn(adapter, 'stopChat');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      streaming: true,
      activeRequestId: 'req-99',
      activeConversation: makeConversation({ id: 'conv-stop' }),
    });
    await stopStreamAction(getState, dispatch, makeDeps(adapter));
    expect(stopSpy).toHaveBeenCalledWith('req-99', {
      agentId: 'agent-1',
      conversationId: 'conv-stop',
    });
    expect(getState().streaming).toBe(false);
    expect(getState().activeRequestId).toBeNull();
  });

  it('no-ops cleanly when there is no active request', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const stopSpy = vi.spyOn(adapter, 'stopChat');
    const { getState, dispatch } = createStore();
    await stopStreamAction(getState, dispatch, makeDeps(adapter));
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('still clears streaming even when stopChat throws', async () => {
    const reportError = vi.fn();
    const adapter: WorkbenchApiAdapter = {
      async listConversations() {
        return [];
      },
      async createConversation() {
        return makeConversation();
      },
      async getConversation() {
        return { conversation: makeConversation(), messages: [] };
      },
      async *sendMessage() {},
      async stopChat() {
        throw new Error('cannot stop');
      },
    };
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      streaming: true,
      activeRequestId: 'req-x',
      activeConversation: makeConversation(),
    });
    await stopStreamAction(getState, dispatch, makeDeps(adapter, { reportError }));
    expect(getState().streaming).toBe(false);
    expect(reportError).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. answerPermissionAction
// ---------------------------------------------------------------------------

describe('answerPermissionAction', () => {
  it('forwards the choice to the adapter and clears permissionRequest', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const respondSpy = vi.spyOn(adapter, 'respondPermission');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: makeConversation({ id: 'conv-p' }),
      permissionRequest: { id: 'perm-1', title: 'Run' },
    });
    await answerPermissionAction(getState, dispatch, makeDeps(adapter), 'once');
    expect(respondSpy).toHaveBeenCalledWith('perm-1', 'once', {
      agentId: 'agent-1',
      conversationId: 'conv-p',
    });
    expect(getState().permissionRequest).toBeNull();
  });

  it('does nothing when there is no pending permission', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const respondSpy = vi.spyOn(adapter, 'respondPermission');
    const { getState, dispatch } = createStore();
    await answerPermissionAction(getState, dispatch, makeDeps(adapter), 'once');
    expect(respondSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7b. answerMcpAskAction
// ---------------------------------------------------------------------------

function makeMcpAskInteraction(): WorkbenchMcpAskInteraction {
  return {
    input: {
      toolName: 'nuwax_ask_question',
      schemaVersion: 'nuwax.mcp_ask.v1',
      requestId: 'req-1',
      revision: 1,
      sessionId: 'sess-1',
      title: 'Choose an option',
      ui: {
        version: '1',
        presentation: 'inline',
        title: 'Choose an option',
        schema: {},
      },
    },
    toolCallId: 'tc-1',
    responseStatus: 'pending',
  };
}

describe('answerMcpAskAction', () => {
  it('sets submitting state then clears after success', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const respondSpy = vi.spyOn(adapter, 'respondMcpAsk');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      mcpAskInteraction: makeMcpAskInteraction(),
    });
    const payload: WorkbenchMcpAskRespondPayload = {
      interventionId: 'req-1',
      toolCallId: 'tc-1',
      revision: 1,
      source: 'mcp_ask',
      protocol: 'mcp',
      action: 'submit',
      formData: { foo: 'bar' },
    };
    await answerMcpAskAction(getState, dispatch, makeDeps(adapter), payload);
    expect(respondSpy).toHaveBeenCalledOnce();
    expect(getState().mcpAskInteraction).toBeNull();
  });

  it('does nothing when there is no pending mcpAskInteraction', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const respondSpy = vi.spyOn(adapter, 'respondMcpAsk');
    const { getState, dispatch } = createStore();
    await answerMcpAskAction(
      getState,
      dispatch,
      makeDeps(adapter),
      {
        interventionId: 'req-1',
        revision: 1,
        source: 'mcp_ask',
        protocol: 'mcp',
        action: 'submit',
      },
    );
    expect(respondSpy).not.toHaveBeenCalled();
  });

  it('marks the interaction as failed when the adapter throws', async () => {
    const adapter = {
      ...createMockApiAdapter({ latencyMs: 0 }),
      async respondMcpAsk() {
        throw new Error('boom');
      },
    };
    const reportError = vi.fn();
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      mcpAskInteraction: makeMcpAskInteraction(),
    });
    await answerMcpAskAction(
      getState,
      dispatch,
      makeDeps(adapter, { reportError }),
      {
        interventionId: 'req-1',
        revision: 1,
        source: 'mcp_ask',
        protocol: 'mcp',
        action: 'submit',
      },
    );
    expect(getState().mcpAskInteraction?.responseStatus).toBe('failed');
    expect(getState().mcpAskInteraction?.errorMessage).toBe('boom');
  });
});

// ---------------------------------------------------------------------------
// 8. loadMoreMessagesAction
// ---------------------------------------------------------------------------

describe('loadMoreMessagesAction', () => {
  it('prepends older messages using the first message index as cursor', async () => {
    const conversation = makeConversation({ id: 'conv-page' });
    const olderMessages = [
      makeMessage({ id: 'old-1', metadata: { index: 0 } }),
      makeMessage({ id: 'old-2', metadata: { index: 1 } }),
    ];
    const getConversationSpy = vi.fn().mockResolvedValue({
      conversation,
      messages: olderMessages,
      hasMore: false,
    });
    const adapter: WorkbenchApiAdapter = {
      async listConversations() {
        return [];
      },
      async createConversation() {
        return conversation;
      },
      getConversation: getConversationSpy,
      async *sendMessage() {},
    };
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
      hasMoreMessages: true,
      messages: [
        makeMessage({ id: 'newest', metadata: { index: 5 } }),
        makeMessage({ id: 'second', metadata: { index: 6 } }),
      ],
    });
    await loadMoreMessagesAction(getState, dispatch, makeDeps(adapter));
    expect(getConversationSpy).toHaveBeenCalledWith('agent-1', 'conv-page', {
      index: 5,
      size: 10,
    });
    expect(getState().messages.map((m) => m.id)).toEqual([
      'old-1',
      'old-2',
      'newest',
      'second',
    ]);
    expect(getState().hasMoreMessages).toBe(false);
    expect(getState().loadingMoreMessages).toBe(false);
  });

  it('no-ops when hasMoreMessages is false', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const getSpy = vi.spyOn(adapter, 'getConversation');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: makeConversation(),
      messages: [makeMessage()],
      hasMoreMessages: false,
    });
    await loadMoreMessagesAction(getState, dispatch, makeDeps(adapter));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('does not double-fetch while already loading', async () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const getSpy = vi.spyOn(adapter, 'getConversation');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: makeConversation(),
      messages: [makeMessage()],
      hasMoreMessages: true,
      loadingMoreMessages: true,
    });
    await loadMoreMessagesAction(getState, dispatch, makeDeps(adapter));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('reports error and clears the loading flag on failure', async () => {
    const reportError = vi.fn();
    const adapter: WorkbenchApiAdapter = {
      async listConversations() {
        return [];
      },
      async createConversation() {
        return makeConversation();
      },
      async getConversation() {
        throw new Error('offline');
      },
      async *sendMessage() {},
    };
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: makeConversation(),
      hasMoreMessages: true,
      messages: [makeMessage({ metadata: { index: 3 } })],
    });
    await loadMoreMessagesAction(
      getState,
      dispatch,
      makeDeps(adapter, { reportError }),
    );
    expect(reportError).toHaveBeenCalledOnce();
    expect(getState().loadingMoreMessages).toBe(false);
  });
});
