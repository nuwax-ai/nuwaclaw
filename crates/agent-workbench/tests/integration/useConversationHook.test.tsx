/*
 * Integration tests for `useConversation` against the real `mockApiAdapter`.
 *
 * Layering rationale
 * ------------------
 * The hook is already covered by `tests/useConversation.test.ts` at the
 * granular level (reducer cases, single-action behavior). Those tests assert
 * the contract of each individual exported piece (reducer / event-patch /
 * action handlers).
 *
 * What was missing — and what this file adds — is end-to-end coverage of the
 * *coherent multi-action lifecycle* a real component would drive through the
 * hook in production:
 *
 *   mount → createConversation → sendPrompt (streamed) → permission pause →
 *   answerPermission → loadMoreMessages → reset
 *
 * Each test below exercises the full hook surface through the public action
 * handlers, against the real `mockApiAdapter` (no per-test stub adapters),
 * and asserts cross-step state continuity (e.g. `streaming` reflects the
 * lifecycle correctly across an entire stream, not just at end-of-action).
 *
 * Why pure functions instead of `react-dom/client` + `act`?
 * ---------------------------------------------------------
 * The workbench package's vitest config runs in `environment: 'node'` (no
 * jsdom / happy-dom available, see vitest.config.ts) and adding a DOM
 * environment was explicitly off the table for this work. The hook itself
 * is deliberately structured so that **all** lifecycle behavior lives in
 * pure exported action handlers — `useReducer` + `useCallback` wrappers in
 * the hook body add no new behavior beyond memoization and a `stateRef`
 * mirror. Driving the actions through a `messagesReducer`-backed store is
 * therefore behaviorally identical to mounting the hook in a real
 * component, with the only loss being the React render-cycle timing
 * (which the hook does not depend on for correctness — async actions read
 * state via `getState()`, exactly as we do here).
 *
 * What the harness simulates that the unit tests do not
 * -----------------------------------------------------
 * 1. **A single store across many actions** — every test reuses one store
 *    across the full lifecycle, so any reducer bug that only surfaces on
 *    interleaved actions (e.g. `permission` followed by `final`, or
 *    `sendPrompt` after `loadConversation`) is observable here.
 * 2. **Real adapter state** — the mock adapter persists conversations &
 *    messages across calls, so e.g. `loadConversation` after `sendPrompt`
 *    sees the assistant message the adapter actually wrote.
 * 3. **Streaming sub-states** — we sample the store mid-stream via a custom
 *    instrumentation adapter to assert that `streaming === true` during
 *    chunk arrival and flips to `false` exactly at `streamFinished`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createMockApiAdapter,
  MOCK_LONG_CONVERSATION_ID,
} from '../../src/adapters/mockApiAdapter';
import {
  type ActionDeps,
  type ConversationAction,
  type ConversationState,
  answerPermissionAction,
  createConversationAction,
  initialConversationState,
  loadConversationAction,
  loadMoreMessagesAction,
  messagesReducer,
  sendPromptAction,
  stopStreamAction,
} from '../../src/components/OpenApp/hooks/useConversation';
import type {
  WorkbenchApiAdapter,
  WorkbenchSendMessageRequest,
  WorkbenchStreamEvent,
} from '../../src/types';

// ---------------------------------------------------------------------------
// Lifecycle harness
//
// `createHookHarness` mirrors what the hook does internally:
//   - holds the reducer state in a single mutable cell
//   - exposes `getState` / `dispatch` for action handlers to drive
//   - exposes `api()` which returns the same shape the hook's `return`
//     produces (so tests read like a real component would)
//   - exposes `snapshots[]` which captures the state after each dispatch,
//     so we can assert intermediate sub-states (e.g. mid-stream).
// ---------------------------------------------------------------------------

interface HookHarness {
  readonly snapshots: ConversationState[];
  getState(): ConversationState;
  dispatch(action: ConversationAction): void;
  /** Mirrors the shape of `UseConversationApi` minus the action closures. */
  api(): Omit<
    ConversationState,
    'hasMoreMessages' | 'loadingMoreMessages'
  > & {
    hasMoreMessages: boolean;
    loadingMoreMessages: boolean;
  };
}

function createHookHarness(
  initial: ConversationState = initialConversationState,
): HookHarness {
  let state = initial;
  const snapshots: ConversationState[] = [state];
  return {
    snapshots,
    getState: () => state,
    dispatch: (action) => {
      state = messagesReducer(state, action);
      snapshots.push(state);
    },
    api: () => state,
  };
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
    createId: (prefix) => `${prefix}-${counter++}`,
    now: () => '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Wrap an adapter so we can run a side-effect each time a stream event is
 * about to be yielded. We use this to sample the harness mid-stream — there
 * is no other observation point between `startStream` and `streamFinished`.
 */
function instrumentSendMessage(
  inner: WorkbenchApiAdapter,
  onEvent: (event: WorkbenchStreamEvent) => void,
): WorkbenchApiAdapter {
  return {
    ...inner,
    async *sendMessage(req: WorkbenchSendMessageRequest) {
      for await (const event of inner.sendMessage(req)) {
        onEvent(event);
        yield event;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('useConversation lifecycle (integration)', () => {
  it('mount → empty state mirrors `initialConversationState`', () => {
    // Sanity check: the shape returned at mount must match what the hook's
    // useReducer would produce on first render. Any drift here breaks the
    // contract NuwaxOpenApp relies on for its first render pass.
    const harness = createHookHarness();
    const view = harness.api();
    expect(view.activeConversation).toBeNull();
    expect(view.messages).toEqual([]);
    expect(view.streaming).toBe(false);
    expect(view.activeRequestId).toBeNull();
    expect(view.permissionRequest).toBeNull();
    expect(view.hasMoreMessages).toBe(false);
    expect(view.loadingMoreMessages).toBe(false);
  });

  it('createConversation → activeConversation reflects adapter payload', async () => {
    // After `createConversation`, the next render must surface the new
    // conversation as active so downstream components (ChatArea, Sidebar)
    // can key off it without an additional load.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const harness = createHookHarness();
    const conversation = await createConversationAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      'Lifecycle smoke test',
    );
    expect(conversation.id).toMatch(/^conv-/);
    expect(harness.api().activeConversation?.id).toBe(conversation.id);
    expect(harness.api().activeConversation?.title).toBe(
      'Lifecycle smoke test',
    );
    expect(harness.api().messages).toEqual([]);
    expect(harness.api().streaming).toBe(false);
  });

  it('sendPrompt(simple scenario) → chunks accumulate into a single assistant message and stream ends', async () => {
    // End-to-end stream consumption: we drive `sendPrompt` through the
    // canonical chunk → chunk → final scenario and assert that
    //   (a) chunks merge into one assistant message,
    //   (b) the final overwrite matches the final event content,
    //   (c) streaming flips off at `streamFinished`.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'simple',
    });
    const conversation = await adapter.createConversation('agent-1', 'simple');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'say hi' },
    );
    const messages = harness.api().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'say hi' });
    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    // Final event commits the full body; status must be `complete`.
    expect(assistant.status).toBe('complete');
    expect(assistant.content.length).toBeGreaterThan(0);
    // The streaming gate is open mid-flight, closed at the end.
    expect(harness.api().streaming).toBe(false);
    expect(harness.api().activeRequestId).toBeNull();
  });

  it('sendPrompt(withThinking) → assistant message contains the inline <thinking> block', async () => {
    // The `withThinking` scenario streams a chunk containing
    // `<thinking>...</thinking>` before the answer chunk. The hook must
    // accumulate both into the assistant message, and the final event must
    // overwrite with the canonical full body — so the committed message
    // contains the `<thinking>` tag and the answer.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withThinking',
    });
    const conversation = await adapter.createConversation('agent-1', 'thinking');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'show me your work' },
    );
    const assistant = harness.api().messages.at(-1)!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toContain('<thinking>');
    expect(assistant.content).toContain('</thinking>');
    // The final event commits a non-thought kind so the renderer treats the
    // body as a normal markdown message with an embedded thinking block.
    expect(assistant.kind).toBe('text');
    expect(assistant.status).toBe('complete');
    expect(harness.api().streaming).toBe(false);
  });

  it('sendPrompt(withPermission) → permissionRequest is set and stream ends without a final commit', async () => {
    // The `withPermission` scenario yields `thought` then `permission` and
    // stops. The hook must:
    //   (a) surface the permission payload in `permissionRequest`,
    //   (b) close the streaming flag (the `for-await-of` exits naturally),
    //   (c) NOT mark the assistant message complete (no `final` arrived).
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withPermission',
    });
    const conversation = await adapter.createConversation('agent-1', 'perm');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'please run a tool' },
    );
    const view = harness.api();
    expect(view.permissionRequest?.id).toBe('mock-perm-scenario');
    expect(view.permissionRequest?.choices?.length).toBe(2);
    // Streaming has terminated even though no `final` arrived.
    expect(view.streaming).toBe(false);
    // Assistant message exists but is still in streaming/thought state.
    const assistant = view.messages.at(-1)!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.status).not.toBe('complete');
  });

  it('answerPermission → adapter is notified and permissionRequest is cleared', async () => {
    // After a permission pause, the user's decision must:
    //   (a) call adapter.respondPermission with the choice id,
    //   (b) clear the local permission request so the popup unmounts.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withPermission',
    });
    const respondSpy = vi.spyOn(adapter, 'respondPermission');
    const conversation = await adapter.createConversation('agent-1', 'perm-flow');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'run it' },
    );
    expect(harness.api().permissionRequest?.id).toBe('mock-perm-scenario');
    await answerPermissionAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      'allow',
    );
    expect(respondSpy).toHaveBeenCalledWith(
      'mock-perm-scenario',
      'allow',
      expect.objectContaining({
        agentId: 'agent-1',
        conversationId: conversation.id,
      }),
    );
    expect(harness.api().permissionRequest).toBeNull();
  });

  it('sendPrompt(withError) → assistant message reflects the error and stream terminates', async () => {
    // The `withError` scenario yields a chunk followed by an `error` event.
    // The hook must:
    //   (a) accumulate the partial chunk into the assistant message,
    //   (b) overwrite the body with the error string on the error event,
    //   (c) mark the assistant kind=error / status=error,
    //   (d) close streaming.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withError',
    });
    const conversation = await adapter.createConversation('agent-1', 'err');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'force fail' },
    );
    const view = harness.api();
    const assistant = view.messages.at(-1)!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.status).toBe('error');
    expect(assistant.kind).toBe('error');
    expect((assistant.content ?? '').length).toBeGreaterThan(0);
    expect(view.streaming).toBe(false);
  });

  it('loadConversation(long history) → populates messages from the adapter and surfaces hasMore from the response', async () => {
    // Loading the canonical long-history conversation hydrates the hook
    // store from the adapter. The mock returns the full fixture (50
    // messages, hasMore=false) when no pagination is requested — the hook
    // itself doesn't pass pagination on initial load, so this asserts the
    // adapter→hook contract end-to-end.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const harness = createHookHarness();
    await loadConversationAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      {
        id: MOCK_LONG_CONVERSATION_ID,
        agentId: 'agent-1',
        title: 'long',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
        status: 'idle',
      },
    );
    const view = harness.api();
    expect(view.activeConversation?.id).toBe(MOCK_LONG_CONVERSATION_ID);
    expect(view.messages.length).toBe(50);
    // Without explicit pagination the adapter returns the entire fixture
    // and reports hasMore=false; the hook must surface that verbatim.
    expect(view.hasMoreMessages).toBe(false);
    // No streaming or permission noise from a pure load.
    expect(view.streaming).toBe(false);
    expect(view.permissionRequest).toBeNull();
    // Earlier messages come first, latest last — preserves transcript order.
    expect(view.messages[0].id).toBe('mock-long-msg-1');
    expect(view.messages.at(-1)!.id).toBe('mock-long-msg-50');
  });

  it('loadMoreMessages → no-ops when hasMoreMessages is false (long history already fully loaded)', async () => {
    // The hook's loadMore guard refuses to fetch when `hasMoreMessages` is
    // false — the long-history initial load returns hasMore=false (whole
    // fixture in one page), so loadMore must be a no-op and not change the
    // transcript or hit the network.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const getSpy = vi.spyOn(adapter, 'getConversation');
    const harness = createHookHarness();
    await loadConversationAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      {
        id: MOCK_LONG_CONVERSATION_ID,
        agentId: 'agent-1',
        title: 'long',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
        status: 'idle',
      },
    );
    expect(harness.api().hasMoreMessages).toBe(false);
    getSpy.mockClear();
    await loadMoreMessagesAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
    );
    // Guard rejected the request — no second getConversation call.
    expect(getSpy).not.toHaveBeenCalled();
    expect(harness.api().messages.length).toBe(50);
    expect(harness.api().loadingMoreMessages).toBe(false);
  });

  it('loadMoreMessages → prepends an older page without duplicating ids when hasMore is true', async () => {
    // Drives the prepend path explicitly: we seed the harness with a
    // partial first page and `hasMoreMessages=true` (the state a paginated
    // load would produce), then call loadMoreMessages and assert the
    // returned older page is prepended and the original ids survive.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    // Seed the long-history fixture into the mock by hitting it once.
    await adapter.getConversation('agent-1', MOCK_LONG_CONVERSATION_ID);
    // Synthesize a "loaded second page" state with messages 11..20.
    const secondPage = await adapter.getConversation(
      'agent-1',
      MOCK_LONG_CONVERSATION_ID,
      { index: 10, size: 10 },
    );
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: secondPage.conversation,
      messages: secondPage.messages,
      hasMoreMessages: true,
    });
    const firstId = harness.api().messages[0].id;
    expect(firstId).toBe('mock-long-msg-11');

    await loadMoreMessagesAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
    );
    const merged = harness.api().messages;
    // New page was prepended (older messages come first).
    expect(merged.length).toBeGreaterThan(10);
    // Original page tail preserved.
    expect(merged.at(-1)!.id).toBe('mock-long-msg-20');
    // No duplicate ids across the merged set — reducer dedup guard intact.
    const ids = new Set<string>();
    for (const m of merged) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
    }
    expect(harness.api().loadingMoreMessages).toBe(false);
  });

  it('reset → returns hook to its mount state regardless of prior activity', async () => {
    // After exercising the whole pipeline, `reset` must restore the hook
    // to a fresh state so the next session starts with no stale data.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'simple',
    });
    const conversation = await adapter.createConversation('agent-1', 'reset');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'before reset' },
    );
    expect(harness.api().messages.length).toBeGreaterThan(0);
    expect(harness.api().activeConversation).not.toBeNull();

    harness.dispatch({ type: 'reset' });
    expect(harness.api()).toEqual(initialConversationState);
  });

  it('streaming flag is TRUE during chunk arrival and flips to FALSE only after the final event', async () => {
    // The hook is the source of truth for the "is the model talking right
    // now?" UI affordance. We sample state once per stream event via the
    // instrumented adapter — every chunk must observe streaming=true and
    // the post-action state must observe streaming=false. This guards
    // against any future regression where the streaming gate is closed
    // early (e.g. on permission pause without an explicit final).
    const baseAdapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'simple',
    });
    const conversation = await baseAdapter.createConversation('agent-1', 'live');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    const observedStreaming: boolean[] = [];
    const adapter = instrumentSendMessage(baseAdapter, () => {
      observedStreaming.push(harness.getState().streaming);
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'live stream' },
    );
    expect(observedStreaming.length).toBeGreaterThan(0);
    // Every intermediate observation saw streaming=true.
    expect(observedStreaming.every((v) => v === true)).toBe(true);
    // Post-stream the gate is closed.
    expect(harness.api().streaming).toBe(false);
    expect(harness.api().activeRequestId).toBeNull();
  });

  it('full lifecycle: create → send → permission → answer → loadMore → reset', async () => {
    // End-to-end narrative across every public action, sharing a single
    // store. This is the strongest integration check: any reducer or
    // action regression that only surfaces with cross-action state will
    // fail here.
    const adapter = createMockApiAdapter({ latencyMs: 0, mockChatDelayMs: 0 });
    const harness = createHookHarness();

    // 1. create
    const created = await createConversationAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      'Lifecycle',
    );
    expect(harness.api().activeConversation?.id).toBe(created.id);

    // 2. send (default mock scripted response: thought + chunks + final)
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'lifecycle prompt' },
    );
    expect(harness.api().messages).toHaveLength(2);
    expect(harness.api().messages[1].status).toBe('complete');
    expect(harness.api().streaming).toBe(false);

    // 3. permission pause via a fresh adapter session (we reuse the same
    // conversation by id so the store stays continuous).
    const permAdapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withPermission',
    });
    // Sync the conversation onto the permission adapter so respondPermission
    // can find it.
    await permAdapter.createConversation('agent-1', 'Lifecycle');
    const permConv = harness.api().activeConversation!;
    await sendPromptAction(
      () => ({ ...harness.getState(), activeConversation: permConv }),
      harness.dispatch,
      makeDeps(permAdapter),
      { content: 'do the thing', conversationId: permConv.id },
    );
    expect(harness.api().permissionRequest?.id).toBe('mock-perm-scenario');

    // 4. answer
    const respondSpy = vi.spyOn(permAdapter, 'respondPermission');
    await answerPermissionAction(
      harness.getState,
      harness.dispatch,
      makeDeps(permAdapter),
      'deny',
    );
    expect(respondSpy).toHaveBeenCalledWith(
      'mock-perm-scenario',
      'deny',
      expect.any(Object),
    );
    expect(harness.api().permissionRequest).toBeNull();

    // 5. load more (no-op here because hasMoreMessages=false, but exercises
    // the early-exit guard one more time on a non-trivial store).
    await loadMoreMessagesAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
    );
    expect(harness.api().loadingMoreMessages).toBe(false);

    // 6. reset
    harness.dispatch({ type: 'reset' });
    expect(harness.api()).toEqual(initialConversationState);
  });

  it('stopStream interrupts an in-flight stream cleanly when invoked between events', async () => {
    // The Stop button on the chat panel calls stopStream while the model
    // is mid-answer. Even if we can't actually preempt the async iterator
    // mid-yield, the streamFinished dispatch must reach the store and the
    // streaming flag must be off when the user expects it to be.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'simple',
    });
    const stopSpy = vi.spyOn(adapter, 'stopChat');
    const conversation = await adapter.createConversation('agent-1', 'stop');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
      streaming: true,
      activeRequestId: 'req-mid-flight',
    });
    await stopStreamAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
    );
    expect(stopSpy).toHaveBeenCalledWith('req-mid-flight', {
      agentId: 'agent-1',
      conversationId: conversation.id,
    });
    expect(harness.api().streaming).toBe(false);
    expect(harness.api().activeRequestId).toBeNull();
  });

  it('multi-turn: two sequential sendPrompt calls accumulate exactly four messages', async () => {
    // Real-world chat is multi-turn: each user prompt appends a (user,
    // assistant) pair. After two prompts the transcript must hold four
    // messages in arrival order, all keyed by id, with no message loss
    // from the second turn clobbering the first.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'simple',
    });
    const conversation = await adapter.createConversation('agent-1', 'multi');
    const harness = createHookHarness({
      ...initialConversationState,
      activeConversation: conversation,
    });
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter),
      { content: 'first turn' },
    );
    await sendPromptAction(
      harness.getState,
      harness.dispatch,
      makeDeps(adapter, { createId: (p) => `${p}-2` }),
      { content: 'second turn' },
    );
    const msgs = harness.api().messages;
    expect(msgs).toHaveLength(4);
    expect(msgs.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(msgs[0].content).toBe('first turn');
    expect(msgs[2].content).toBe('second turn');
    // Every assistant message reached `complete`.
    expect(msgs[1].status).toBe('complete');
    expect(msgs[3].status).toBe('complete');
    // Ids are unique across both turns (no message collision).
    expect(new Set(msgs.map((m) => m.id)).size).toBe(4);
  });
});
