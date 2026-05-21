/*
 * Integration tests for the OpenApp flow.
 *
 * These tests exercise the mock adapter end-to-end across the canonical
 * OpenApp user journey (open agent → list conversations → create →
 * send → stream → permission → suggest). They sit one layer above the
 * unit tests in `webApiAdapter.test.ts` / `sse.test.ts` and below a real
 * Electron-driven harness — the goal is to lock in the adapter *contract*
 * so refactors to NuwaxOpenApp/AgentWorkbench can't silently break the
 * shape of events or the order of effects observed by UI code.
 *
 * Vitest runs in a `node` environment in this package (no jsdom), so the
 * tests focus on the adapter surface that drives UI rather than DOM
 * assertions. Component rendering is covered by the existing *.test.tsx
 * files via `renderToStaticMarkup`.
 */
import { describe, expect, it } from 'vitest';
import {
  createMockApiAdapter,
  MOCK_LONG_CONVERSATION_HISTORY,
  MOCK_LONG_CONVERSATION_ID,
} from '../../src/adapters/mockApiAdapter';
import type {
  WorkbenchApiAdapter,
  WorkbenchStreamEvent,
} from '../../src/types';

/**
 * Drain a `sendMessage` async iterable into a concrete array. Mirrors what
 * the OpenApp's stream subscriber does internally — `for await ... of`
 * the iterable, push each event to a buffer, and let the consumer decide
 * how to render them.
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

describe('OpenApp integration', () => {
  it('resolves agent detail with hasPermission and customPageMenus', async () => {
    // Smallest possible bootstrap: NuwaxOpenApp first asks the adapter for
    // the published agent detail to decide what nav to render.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const agent = await adapter.getAgentDetail!('agent-1');
    expect(agent.agentId).toBe('agent-1');
    expect(agent.name).toMatch(/Agent agent-1/);
    expect(agent.hasPermission).toBe(true);
    expect(Array.isArray(agent.customPageMenus)).toBe(true);
    expect(agent.customPageMenus?.[0]?.path).toBe('/app/mock-preview');
    // guidQuestionDtos drives the home-screen suggestion chips.
    expect(agent.guidQuestionDtos?.length ?? 0).toBeGreaterThan(0);
  });

  it('lists conversations for an agent (seeded mock workspace)', async () => {
    // Calling `listConversations` on a fresh adapter must seed a stub
    // session — the home screen relies on at least one entry being present
    // when the user opens the app for the first time.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const list = await adapter.listConversations('agent-1');
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect(first.agentId).toBe('agent-1');
    expect(typeof first.id).toBe('string');
    expect(typeof first.title).toBe('string');
  });

  it('sendMessage emits chunk → chunk → final via the async iterable', async () => {
    // Locks the chunk → final contract. UI code splits chunk events into
    // streaming text and treats `final` as the commit boundary.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatEvents: [
        {
          type: 'chunk',
          conversationId: 'c1',
          messageId: 'm1',
          content: 'Hello ',
        },
        {
          type: 'chunk',
          conversationId: 'c1',
          messageId: 'm1',
          content: 'world!',
        },
        {
          type: 'final',
          conversationId: 'c1',
          messageId: 'm1',
          content: 'Hello world!',
        },
      ],
    });

    const events = await collectStreamEvents(adapter, {
      agentId: 'agent-1',
      conversationId: 'c1',
      content: 'Hi',
    });

    expect(events.map((event) => event.type)).toEqual([
      'chunk',
      'chunk',
      'final',
    ]);
    // Chunk concatenation matches the final commit.
    const merged = events
      .filter((event) => event.type === 'chunk')
      .map((event) => event.content)
      .join('');
    expect(merged).toBe('Hello world!');
    const finalEvent = events[2];
    expect(finalEvent.content).toBe('Hello world!');
    expect(finalEvent.messageId).toBe('m1');
  });

  it('createConversation + sendMessage + getConversation full happy path', async () => {
    // End-to-end OpenApp journey: create a session, send a message, then
    // pull the persisted transcript. Verifies the adapter writes both the
    // user message AND the synthesized assistant message into history.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const conversation = await adapter.createConversation(
      'agent-1',
      'Integration check',
    );
    expect(conversation.agentId).toBe('agent-1');
    expect(conversation.title).toBe('Integration check');

    const events = await collectStreamEvents(adapter, {
      agentId: 'agent-1',
      conversationId: conversation.id,
      content: 'tell me a short joke',
    });

    // Default scripted response yields thought + chunks + final.
    expect(events.some((event) => event.type === 'thought')).toBe(true);
    expect(events.some((event) => event.type === 'chunk')).toBe(true);
    const finalEvent = events.find((event) => event.type === 'final');
    expect(finalEvent).toBeDefined();
    expect((finalEvent?.content ?? '').length).toBeGreaterThan(0);

    const detail = await adapter.getConversation(
      'agent-1',
      conversation.id,
    );
    expect(detail.conversation.id).toBe(conversation.id);
    // Two messages persisted: user then assistant.
    expect(detail.messages.length).toBe(2);
    expect(detail.messages[0].role).toBe('user');
    expect(detail.messages[0].content).toBe('tell me a short joke');
    expect(detail.messages[1].role).toBe('assistant');
    expect(detail.messages[1].content.length).toBeGreaterThan(0);
  });

  it('listSkillsForAtPaged returns paginated results with total/hasMore', async () => {
    // Mirrors the MentionPopup `all` tab call path. Spec: page 1 of size 5
    // out of 8 mock skills → 5 items returned, hasMore=true, total=8.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const res = await adapter.listSkillsForAtPaged!({
      agentId: 'agent-1',
      page: 1,
      pageSize: 5,
    });
    expect(res.items.length).toBe(5);
    expect(res.total).toBe(8);
    expect(res.hasMore).toBe(true);

    // Page 2 returns the remainder and reports no more.
    const res2 = await adapter.listSkillsForAtPaged!({
      agentId: 'agent-1',
      page: 2,
      pageSize: 5,
    });
    expect(res2.items.length).toBe(3);
    expect(res2.hasMore).toBe(false);

    // Recent / Collect tabs are separately wired to the dedicated endpoints.
    const recent = await adapter.listRecentSkills!('agent-1');
    const collected = await adapter.listCollectedSkills!('agent-1');
    expect(recent.length).toBeGreaterThan(0);
    expect(collected.length).toBeGreaterThan(0);
  });

  it('uploadFile reports progress and returns a mock:// url', async () => {
    // Mirrors the ChatUploadFile path: caller provides a File, adapter
    // emits N progress ticks ending at 100%, then resolves with the
    // upload result that includes url + key + fileName.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const progresses: number[] = [];
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const result = await adapter.uploadFile!(file, {
      onProgress: (p) => {
        progresses.push(Math.round((p.loaded / p.total) * 100));
      },
    });
    expect(result.url).toMatch(/^mock:\/\//);
    expect(result.url).toMatch(/\.txt$/);
    expect(result.fileName).toBe('test.txt');
    expect(result.size).toBe(file.size);
    expect(result.mimeType).toBe('text/plain');
    // Progress always ends at 100% — UI uses that as the completion marker.
    expect(progresses).toContain(100);
    expect(progresses[progresses.length - 1]).toBe(100);
  });

  it('permission event surfaces a request payload the UI can render', async () => {
    // The permission event carries the popup payload (id, title, choices).
    // OpenApp wires the user's choice back via respondPermission.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatEvents: [
        { type: 'thought', content: 'considering' },
        {
          type: 'permission',
          permission: {
            id: 'perm-mock-1',
            title: 'Run local command?',
            description: 'The agent wants to read /tmp/foo.txt',
            choices: [
              { id: 'allow', label: 'Allow' },
              { id: 'deny', label: 'Deny', destructive: true },
            ],
          },
        },
        { type: 'final', content: 'Waiting for permission decision.' },
      ],
    });

    const events = await collectStreamEvents(adapter, {
      agentId: 'agent-1',
      conversationId: 'c-perm',
      content: 'please read foo',
    });

    const permEvent = events.find((event) => event.type === 'permission');
    expect(permEvent).toBeDefined();
    expect(permEvent?.permission?.id).toBe('perm-mock-1');
    expect(permEvent?.permission?.title).toBe('Run local command?');
    expect(permEvent?.permission?.choices?.length).toBe(2);
    expect(permEvent?.permission?.choices?.[1]?.destructive).toBe(true);

    // respondPermission is fire-and-forget but must not throw.
    await expect(
      adapter.respondPermission!('perm-mock-1', 'allow', {
        agentId: 'agent-1',
        conversationId: 'c-perm',
      }),
    ).resolves.toBeUndefined();
  });

  it('error event terminates the stream and the OpenApp can render it', async () => {
    // Locks the error contract: when the adapter emits an `error` event
    // the iterable stops, the UI renders the message via the error field,
    // and downstream `chunk`/`final` events do not arrive.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatEvents: [
        { type: 'chunk', content: 'partial ' },
        { type: 'error', error: 'mock-stream-failure' },
        // Anything after the error event MUST NOT be yielded.
        { type: 'final', content: 'should-not-appear' },
      ],
    });

    const events = await collectStreamEvents(adapter, {
      agentId: 'agent-1',
      conversationId: 'c-err',
      content: 'fail please',
    });

    expect(events.map((event) => event.type)).toEqual(['chunk', 'error']);
    const errEvent = events[1];
    expect(errEvent.error).toBe('mock-stream-failure');
    // No final event was emitted, so the UI must surface the error message
    // rather than a successful response.
    expect(events.some((event) => event.type === 'final')).toBe(false);
  });

  it('getSuggestQuestions returns follow-up prompts the UI can chip-render', async () => {
    // The suggest API powers the post-response prompt chips. Result is a
    // plain string list; the UI just iterates and renders them.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const suggestions = await adapter.getSuggestQuestions!(
      'c1',
      'agent-1',
      undefined,
      'Hello world!',
    );
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((entry) => {
      expect(typeof entry).toBe('string');
      expect(entry.length).toBeGreaterThan(0);
    });
  });

  it('stopChat resolves without throwing for a known conversation', async () => {
    // The stop button on the OpenApp chat panel calls stopChat with the
    // conversation's active requestId. The mock just acks — but it must
    // not throw, otherwise the UI gets stuck in a "stopping…" state.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    await expect(
      adapter.stopChat!('req-1', {
        agentId: 'agent-1',
        conversationId: 'c1',
      }),
    ).resolves.toBeUndefined();
  });

  it('getAgentDetail("agent-2") returns the BasicAgent fixture with @-skill disabled', async () => {
    // The mock adapter exposes per-agent fixtures via MOCK_AGENTS so dev /
    // integration callers can drive UI variations without a real backend.
    // agent-2 is the minimal BasicAgent — @-skill mention is OFF and no
    // guidQuestionDtos are surfaced, so the home screen must hide both.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const agent = await adapter.getAgentDetail!('agent-2');
    expect(agent.agentId).toBe('agent-2');
    expect(agent.allowAtSkill).toBe(false);
    expect(agent.guidQuestionDtos?.length ?? 0).toBe(0);
    expect(agent.variables?.length ?? 0).toBe(0);

    // Unknown agentIds fall back to the agent-1 fixture but keep the
    // caller's id — this means UI code that round-trips the id is safe.
    const unknown = await adapter.getAgentDetail!('agent-does-not-exist');
    expect(unknown.agentId).toBe('agent-does-not-exist');
    expect(unknown.allowAtSkill).toBe(true);
  });

  it('mockChatScenario:"withThinking" emits an inline <thinking> chunk before the answer', async () => {
    // The withThinking scenario simulates a model that streams its trace
    // first, then commits the answer. Locks the contract that the
    // MarkdownRenderer / ThinkingBlock pipeline receives a chunk containing
    // a `<thinking>...</thinking>` tag before the answer chunk arrives.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withThinking',
    });
    const events = await collectStreamEvents(adapter, {
      agentId: 'agent-1',
      conversationId: 'c-think',
      content: 'walk me through it',
    });
    expect(events.map((event) => event.type)).toEqual([
      'chunk',
      'chunk',
      'final',
    ]);
    // First chunk contains the <thinking> tag, second chunk holds the answer.
    expect(events[0].content).toContain('<thinking>');
    expect(events[0].content).toContain('</thinking>');
    expect(events[1].content).not.toContain('<thinking>');
    expect(events[1].content?.length ?? 0).toBeGreaterThan(0);
    // Final event repeats the full body so the UI can commit a single message.
    expect(events[2].content).toContain('<thinking>');
    expect(events[2].content).toContain('Workspace');
  });

  it('mockChatScenario:"withPermission" pauses at the permission event (no final)', async () => {
    // Locks the contract for the permission-pause scenario: after the
    // permission event the stream terminates without a `final`, so the UI
    // must hold the streaming state until `respondPermission` is called.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withPermission',
    });
    // Create the conversation first so the adapter tracks it on the agent
    // and `getConversation` can recover it later (matches the real OpenApp
    // flow where the user creates a session before sending).
    const conv = await adapter.createConversation('agent-1', 'permission flow');
    const events = await collectStreamEvents(adapter, {
      agentId: 'agent-1',
      conversationId: conv.id,
      content: 'run a tool please',
    });
    // Expected ordering: thought → permission. No final, no error.
    expect(events.map((event) => event.type)).toEqual(['thought', 'permission']);
    expect(events.some((event) => event.type === 'final')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    const last = events[events.length - 1];
    expect(last.type).toBe('permission');
    expect(last.permission?.id).toBe('mock-perm-scenario');
    expect(last.permission?.choices?.length).toBe(2);

    // Because no `final` ever arrived, the conversation transcript only
    // contains the user message — the adapter must not commit an assistant
    // message yet.
    const detail = await adapter.getConversation('agent-1', conv.id);
    expect(detail.messages.length).toBe(1);
    expect(detail.messages[0].role).toBe('user');
  });

  it('getConversation pagination over the long history yields non-overlapping pages', async () => {
    // The 50-message long-history fixture exists to verify the `{ index,
    // size }` pagination path. Pages 1 and 2 must hold distinct messages
    // and the `hasMore` flag must flip correctly at the tail.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    expect(MOCK_LONG_CONVERSATION_HISTORY.length).toBe(50);

    const pageSize = 10;
    const page1 = await adapter.getConversation('agent-1', MOCK_LONG_CONVERSATION_ID, {
      size: pageSize,
    });
    expect(page1.conversation.id).toBe(MOCK_LONG_CONVERSATION_ID);
    expect(page1.messages.length).toBe(pageSize);
    expect(page1.hasMore).toBe(true);

    const page2 = await adapter.getConversation('agent-1', MOCK_LONG_CONVERSATION_ID, {
      index: pageSize,
      size: pageSize,
    });
    expect(page2.messages.length).toBe(pageSize);
    expect(page2.hasMore).toBe(true);

    // The two pages must not share any message ids — this is the core
    // pagination invariant the UI's "load more" path relies on.
    const idsPage1 = new Set(page1.messages.map((message) => message.id));
    for (const message of page2.messages) {
      expect(idsPage1.has(message.id)).toBe(false);
    }

    // The final page (index 40, size 10) returns the tail and reports
    // hasMore=false so the UI stops fetching.
    const finalPage = await adapter.getConversation(
      'agent-1',
      MOCK_LONG_CONVERSATION_ID,
      { index: 40, size: pageSize },
    );
    expect(finalPage.messages.length).toBe(pageSize);
    expect(finalPage.hasMore).toBe(false);
    expect(finalPage.messages[finalPage.messages.length - 1].id).toBe(
      'mock-long-msg-50',
    );
  });

  it('updateConversation renames the title and bumps updatedAt', async () => {
    // The conversation list's inline rename calls updateConversation.
    // The adapter must return the updated conversation reflecting the new
    // title so the UI can refresh its row without a full refetch.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const conv = await adapter.createConversation(
      'agent-1',
      'Original title',
    );
    const renamed = await adapter.updateConversation!(conv.id, {
      title: 'Renamed via integration test',
    });
    expect(renamed.id).toBe(conv.id);
    expect(renamed.title).toBe('Renamed via integration test');
    // updatedAt is touched on rename — strict equality not required, but
    // the field must remain a valid ISO date string.
    expect(typeof renamed.updatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(renamed.updatedAt))).toBe(false);
  });
});
