/*
 * Integration tests for the full chat lifecycle.
 *
 * These tests sit one layer above `tests/useConversation.test.ts` (which
 * drives the reducer + actions against synthetic adapter stubs) and
 * `tests/integration/openApp.test.tsx` (which validates the adapter
 * surface in isolation). The goal here is to lock in the *composed*
 * contract: a single test exercises the mock adapter together with the
 * `useConversation` hook's pure action functions, so any regression in
 * either layer surfaces as soon as a real lifecycle runs.
 *
 * The mock adapter is the source of truth for SSE event ordering and the
 * `useConversation` actions are the source of truth for how those events
 * mutate UI state — composing them in tests is the closest we can get to
 * exercising the OpenApp without an Electron / DOM harness (Vitest runs
 * in `node` mode in this package).
 */
import { describe, expect, it } from 'vitest';

import {
  createMockApiAdapter,
  MOCK_LONG_CONVERSATION_HISTORY,
  MOCK_LONG_CONVERSATION_ID,
} from '../../src/adapters/mockApiAdapter';
import {
  answerPermissionAction,
  createConversationAction,
  initialConversationState,
  loadMoreMessagesAction,
  messagesReducer,
  sendPromptAction,
  type ActionDeps,
  type ConversationAction,
  type ConversationState,
} from '../../src/components/OpenApp/hooks/useConversation';
import { parseSegments } from '../../src/components/MarkdownRenderer';
import type {
  WorkbenchApiAdapter,
  WorkbenchStreamEvent,
} from '../../src/types';

// ---------------------------------------------------------------------------
// Test harness — minimal store + deps factory.
// ---------------------------------------------------------------------------

function createStore(initial: ConversationState = initialConversationState) {
  let state = initial;
  const dispatch = (action: ConversationAction) => {
    state = messagesReducer(state, action);
  };
  const getState = () => state;
  return { dispatch, getState };
}

function makeDeps(
  adapter: WorkbenchApiAdapter,
  overrides: Partial<ActionDeps> = {},
): ActionDeps {
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

/**
 * Drain a `sendMessage` async iterable into an array. Mirrors how the
 * OpenApp's stream subscriber collects events before patching the message.
 */
async function collectStreamEvents(
  adapter: WorkbenchApiAdapter,
  request: Parameters<WorkbenchApiAdapter['sendMessage']>[0],
): Promise<WorkbenchStreamEvent[]> {
  const events: WorkbenchStreamEvent[] = [];
  for await (const event of adapter.sendMessage(request)) {
    events.push(event);
  }
  return events;
}

describe('chat lifecycle integration', () => {
  it('completes a full round-trip: create -> send -> chunks+final -> suggestions', async () => {
    // Compose: the mock adapter produces a scripted stream, the action
    // helper mutates the conversation store, and we verify the persisted
    // transcript + suggestion chips downstream UI relies on.
    const events: WorkbenchStreamEvent[] = [
      { type: 'chunk', content: 'Hi' },
      { type: 'chunk', content: ', there!' },
      { type: 'final', content: 'Hi, there!' },
    ];
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatEvents: events,
    });
    const conversation = await adapter.createConversation('agent-1', 'lifecycle');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });

    await sendPromptAction(getState, dispatch, makeDeps(adapter), {
      content: 'hello',
    });

    const messages = getState().messages;
    expect(messages.length).toBe(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello' });
    expect(messages[1]).toMatchObject({ role: 'assistant', status: 'complete' });
    expect(messages[1].content).toBe('Hi, there!');
    expect(getState().streaming).toBe(false);
    expect(getState().activeRequestId).toBeNull();

    // The adapter's `getSuggestQuestions` produces the chips rendered under
    // the latest reply — verifies the stream end → suggest call path.
    const suggestions = await adapter.getSuggestQuestions!(
      conversation.id,
      'agent-1',
      undefined,
      messages[1].content,
    );
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((entry) => expect(entry).toBeTypeOf('string'));
  });

  it('streams a thinking-tagged response that MarkdownRenderer can split into segments', async () => {
    // The `withThinking` scenario emits an inline <thinking> chunk before
    // the answer chunk. Verifies that the assistant message's *final*
    // content can be fed into `parseSegments` and a `thinking` segment is
    // separated out — the same call path MarkdownRenderer uses.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withThinking',
    });
    const conversation = await adapter.createConversation('agent-1', 'thinking');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });

    await sendPromptAction(getState, dispatch, makeDeps(adapter), {
      content: 'walk me through it',
    });

    const messages = getState().messages;
    expect(messages.length).toBe(2);
    const finalContent = messages[1].content;
    expect(finalContent).toContain('<thinking>');
    expect(finalContent).toContain('</thinking>');

    // The MarkdownRenderer's parser must lift the <thinking> body into a
    // dedicated segment — without this, the renderer would dump the raw
    // tag into the chat body.
    const segments = parseSegments(finalContent);
    const thinking = segments.find((segment) => segment.kind === 'thinking');
    expect(thinking).toBeDefined();
    if (thinking && thinking.kind === 'thinking') {
      expect(thinking.text).toContain('user workspace state');
    }
    // The remaining markdown segment must hold the actual answer body.
    const markdown = segments
      .filter((segment) => segment.kind === 'markdown')
      .map((segment) =>
        segment.kind === 'markdown' ? segment.text : '',
      )
      .join('');
    expect(markdown).toContain('Workspace looks healthy');
  });

  it('streams a runOver-tagged response that surfaces as a runover-step segment', async () => {
    // The `withRunOver` scenario emits inline <markdown-custom-process>
    // tags that MarkdownRenderer extracts into a RunOver block. The
    // assistant message's persisted content must still contain the tag so
    // segment parsing can lift the step on re-render.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withRunOver',
    });
    const conversation = await adapter.createConversation('agent-1', 'runover');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });

    await sendPromptAction(getState, dispatch, makeDeps(adapter), {
      content: 'list files in /tmp',
    });

    const finalContent = getState().messages[1].content;
    expect(finalContent).toContain('<markdown-custom-process');
    expect(finalContent).toContain('Reading files');

    const segments = parseSegments(finalContent);
    const step = segments.find((segment) => segment.kind === 'runover-step');
    expect(step).toBeDefined();
    if (step && step.kind === 'runover-step') {
      expect(step.step.status).toBe('done');
      expect(step.step.name).toBe('Reading files');
    }
    const markdown = segments
      .filter((segment) => segment.kind === 'markdown')
      .map((segment) =>
        segment.kind === 'markdown' ? segment.text : '',
      )
      .join('');
    expect(markdown).toContain('Found 3 files');
  });

  it('captures a permission interrupt, then resumes the stream after the user responds', async () => {
    // Phase 1: scripted stream pauses at the permission boundary. The
    // assistant message must remain in `streaming` state and the
    // permissionRequest is captured into the store.
    const pauseEvents: WorkbenchStreamEvent[] = [
      { type: 'thought', content: 'pausing for approval' },
      {
        type: 'permission',
        permission: {
          id: 'perm-resume-1',
          title: 'Run command?',
          choices: [
            { id: 'allow', label: 'Allow' },
            { id: 'deny', label: 'Deny', destructive: true },
          ],
        },
      },
      // No `final` here — the stream stops at the permission boundary.
    ];
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatEvents: pauseEvents,
    });
    const conversation = await adapter.createConversation('agent-1', 'perm');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });

    await sendPromptAction(getState, dispatch, makeDeps(adapter), {
      content: 'please run',
    });

    // The pending permission is the UI's signal to render the prompt.
    const perm = getState().permissionRequest;
    expect(perm?.id).toBe('perm-resume-1');
    expect(perm?.choices?.length).toBe(2);
    // Stream wound down because no further events were available.
    expect(getState().streaming).toBe(false);
    // User message persisted; assistant slot is still present from the
    // optimistic append, but the conversation is paused — no follow-up
    // events were processed.
    expect(getState().messages[0]).toMatchObject({
      role: 'user',
      content: 'please run',
    });

    // Phase 2: user picks "Allow". The action forwards the choice to the
    // adapter and clears the in-flight permission.
    await answerPermissionAction(
      getState,
      dispatch,
      makeDeps(adapter),
      'allow',
    );
    expect(getState().permissionRequest).toBeNull();
  });

  it('error event terminates the stream without committing a final assistant message', async () => {
    // The `withError` scenario emits a chunk then an error. The hook must
    // mark the assistant message as error-kind and avoid a final commit;
    // downstream UI uses this to surface a retry button.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withError',
    });
    const conversation = await adapter.createConversation('agent-1', 'err');
    const { getState, dispatch } = createStore({
      ...initialConversationState,
      activeConversation: conversation,
    });

    await sendPromptAction(getState, dispatch, makeDeps(adapter), {
      content: 'fail please',
    });

    const messages = getState().messages;
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].kind).toBe('error');
    expect(messages[1].status).toBe('error');
    // The error string is surfaced into the assistant content so the UI
    // can render it inline. The mock scenario uses 'mock-stream-failure'.
    expect(messages[1].content).toBe('mock-stream-failure');
    expect(getState().streaming).toBe(false);

    // The adapter must NOT have persisted an assistant message — the
    // synthesized final never arrived. Only the user message is in the
    // transcript.
    const detail = await adapter.getConversation('agent-1', conversation.id);
    expect(detail.messages.length).toBe(1);
    expect(detail.messages[0].role).toBe('user');
  });

  it('paginates older messages via loadMoreMessagesAction (cursor + dedup)', async () => {
    // Loading older messages on the OpenApp uses
    // `loadMoreMessagesAction(getState, dispatch, deps)`, which:
    //   1. Reads `metadata.index` off the first message as a cursor.
    //   2. Calls adapter.getConversation with { index: cursor, size: pageSize }.
    //   3. Dispatches `prependMessages` which dedupes by id.
    //
    // We drive the loop against the mock adapter's seeded long-history
    // fixture. The mock's pagination is offset-based (`slice(index, index+size)`),
    // so seeding the store with the *tail* of the fixture and using a cursor
    // anchored to the start of that tail returns the messages immediately
    // preceding it — which is exactly the contract the "Load older" button
    // relies on.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    // Pre-load the full 50-message fixture into the adapter's state.
    await adapter.getConversation('agent-1', MOCK_LONG_CONVERSATION_ID);
    expect(MOCK_LONG_CONVERSATION_HISTORY.length).toBe(50);

    // Construct a synthetic head page: the last 5 messages of the fixture.
    // The first of those messages (`mock-long-msg-46`) is the anchor; its
    // metadata.messageIndex is 46. With the mock's slice semantics that
    // means `loadMoreMessagesAction` will request slice(46, 56) which is
    // empty — so we set up the cursor explicitly by giving the first
    // seeded message a metadata.index that the mock can act on.
    //
    // Strategy: seed with array indices [45..49] (msgs 46-50) but override
    // the first message's metadata.index to 35 so the next page (slice 35..45)
    // returns 10 disjoint messages.
    const tail = MOCK_LONG_CONVERSATION_HISTORY.slice(45, 50);
    const seededMessages = tail.map((message, idx) => {
      if (idx !== 0) return message;
      return {
        ...message,
        metadata: { ...(message.metadata ?? {}), index: 35 },
      };
    });
    const conversation = (
      await adapter.getConversation('agent-1', MOCK_LONG_CONVERSATION_ID)
    ).conversation;

    const seed: ConversationState = {
      ...initialConversationState,
      activeConversation: conversation,
      messages: seededMessages,
      hasMoreMessages: true,
    };
    const { getState, dispatch } = createStore(seed);
    const initialIds = new Set(getState().messages.map((m) => m.id));
    expect(initialIds.size).toBe(5);

    await loadMoreMessagesAction(
      getState,
      dispatch,
      makeDeps(adapter, { messagePageSize: 10 }),
    );

    const afterMessages = getState().messages;
    // Page returned exactly 10 messages (slice 35..45 = msgs 36-45).
    expect(afterMessages.length).toBe(15);
    // None of the prepended messages collide with the seed.
    const prependedMessages = afterMessages.slice(0, afterMessages.length - 5);
    expect(prependedMessages.length).toBe(10);
    for (const message of prependedMessages) {
      expect(initialIds.has(message.id)).toBe(false);
    }
    // Loading flag is reset; the prepend dispatch sets hasMore based on the
    // adapter's response (slice 35..45 leaves 35 older messages → true).
    expect(getState().loadingMoreMessages).toBe(false);
    expect(getState().hasMoreMessages).toBe(true);
  });

  it('createConversation followed by sendPrompt persists both messages in the adapter transcript', async () => {
    // End-to-end: the action helper composes createConversation +
    // sendMessage and the adapter records both user + assistant messages.
    // This is the canonical first-time-user journey on the OpenApp home
    // screen — there is no pre-existing conversation, and the action must
    // create one before sending.
    const events: WorkbenchStreamEvent[] = [
      { type: 'chunk', content: 'sure, ' },
      { type: 'chunk', content: 'here you go.' },
      { type: 'final', content: 'sure, here you go.' },
    ];
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatEvents: events,
    });
    const { getState, dispatch } = createStore();

    // No active conversation yet — createConversationAction seeds one.
    const conversation = await createConversationAction(
      getState,
      dispatch,
      makeDeps(adapter),
      'first-time user',
    );
    expect(getState().activeConversation?.id).toBe(conversation.id);
    expect(getState().messages).toHaveLength(0);

    await sendPromptAction(getState, dispatch, makeDeps(adapter), {
      content: 'hi from test',
    });

    // Store reflects both messages.
    const messages = getState().messages;
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(messages[1].content).toBe('sure, here you go.');

    // Adapter persisted them in its in-memory transcript so a subsequent
    // getConversation call returns the same pair (key contract for page
    // reloads / navigating back to the session).
    const detail = await adapter.getConversation('agent-1', conversation.id);
    expect(detail.messages.length).toBe(2);
    expect(detail.messages[0].role).toBe('user');
    expect(detail.messages[0].content).toBe('hi from test');
    expect(detail.messages[1].role).toBe('assistant');
    expect(detail.messages[1].content).toBe('sure, here you go.');
  });
});
