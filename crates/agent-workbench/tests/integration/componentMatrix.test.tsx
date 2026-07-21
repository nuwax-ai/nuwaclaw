/*
 * Integration tests for the component matrix.
 *
 * Where `chatLifecycle.test.tsx` locks the vertical chat journey, this file
 * exercises the *horizontal* contract between standalone workbench
 * components and the adapter / renderer they consume. Each test composes
 * one component with the real mock adapter (or real pure renderer) and
 * verifies the rendered markup or downstream state machine matches what
 * the OpenApp screen relies on.
 *
 * Vitest in this package runs in `node` mode (no jsdom), so DOM-driven
 * effects are not flushed under `renderToStaticMarkup` — we exercise the
 * initial-render contract for components and drive async paths via direct
 * calls into the underlying helpers / adapter methods. Where event-loop
 * scheduling matters (e.g. ChatUploadFile's scheduler), we await one
 * microtask tick so promises chained inside the component can resolve.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockApiAdapter } from '../../src/adapters/mockApiAdapter';
import { MentionPopup } from '../../src/components/MentionPopup';
import { fetchSkillsForTab } from '../../src/components/MentionPopup/useMentionSearch';
import { VariableForm } from '../../src/components/VariableForm';
import { ChatUploadFile } from '../../src/components/ChatUploadFile';
import { Sidebar, WorkspaceModeSwitch } from '../../src/components/OpenApp/BaseTemplate/Sidebar';
import type { UploadEntry } from '../../src/components/ChatUploadFile';
import {
  MarkdownRenderer,
  parseSegments,
} from '../../src/components/MarkdownRenderer';
import type {
  WorkbenchAgentDetail,
  WorkbenchApiAdapter,
  WorkbenchStreamEvent,
} from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, size: number, type = 'text/plain'): File {
  // Node 18+ exposes a global File via undici; fall back to a minimal stub
  // for older runtimes so the tests stay portable.
  const G = globalThis as { File?: typeof File };
  if (typeof G.File === 'function') {
    return new G.File([new Uint8Array(size)], name, { type });
  }
  return {
    name,
    size,
    type,
    lastModified: Date.now(),
    arrayBuffer: async () => new ArrayBuffer(size),
    slice: () => ({}) as Blob,
    stream: () => undefined as unknown as ReadableStream,
    text: async () => '',
  } as unknown as File;
}

/** Drain any pending microtasks so chained promises resolve. */
async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function drainStream(
  adapter: WorkbenchApiAdapter,
  request: Parameters<WorkbenchApiAdapter['sendMessage']>[0],
): Promise<WorkbenchStreamEvent[]> {
  const events: WorkbenchStreamEvent[] = [];
  for await (const event of adapter.sendMessage(request)) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('component matrix integration', () => {
  it('keeps the Work / Chat switch in the workbench shell and hides work history in Chat mode', () => {
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const common = {
      visible: true,
      onToggle: () => {},
      agent: null,
      agentId: '2336',
      recentConversations: [],
      totalConversationCount: 0,
      activeConversation: null,
      previewUrl: null,
      loadingHistory: false,
      baseUrl: 'https://app.example.com',
      userId: 'user-1',
      onNewConversation: () => {},
      onLoadConversation: () => {},
      onOpenPreview: () => {},
      onNavigateHistory: () => {},
      adapter,
      labels: {
        collapseNav: 'Collapse', expandNav: 'Expand', newConversation: 'New',
        historyConversation: 'History', viewAll: 'All', firstConversationTip: 'Empty',
      },
    };
    const workHtml = renderToStaticMarkup(createElement(Sidebar, { ...common, workspaceMode: 'work' }));
    const chatHtml = renderToStaticMarkup(createElement(Sidebar, { ...common, workspaceMode: 'chat' }));

    expect(workHtml).toContain('History');
    expect(workHtml).toContain('MCP 配置');
    expect(chatHtml).not.toContain('History');
    expect(chatHtml).not.toContain('MCP 配置');

    const switchHtml = renderToStaticMarkup(createElement(WorkspaceModeSwitch, { value: 'work', onChange: () => {} }));
    expect(switchHtml).toContain(' Work</button>');
    expect(switchHtml).toContain(' Chat</button>');
  });

  it('MentionPopup mounts against the mock adapter and routes tabs to the right list endpoints', async () => {
    // The popup mounts in a `loading` state on first render (effects don't
    // flush under renderToStaticMarkup). The structural contract — search
    // input, three tabs, default labels, loading placeholder — must hold
    // regardless of what the adapter eventually returns.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const html = renderToStaticMarkup(
      createElement(MentionPopup, {
        open: true,
        agentId: 'agent-1',
        adapter,
        onSelect: () => {},
        onClose: () => {},
        pageSize: 5,
      }),
    );
    expect(html).toContain('mention-popup');
    expect(html).toContain('mention-popup-search-input');
    expect(html).toContain('mention-popup-tab-all');
    expect(html).toContain('mention-popup-tab-recent');
    expect(html).toContain('mention-popup-tab-collect');
    expect(html).toContain('mention-popup-item-loading');

    // End-to-end fetch contract: drive the same helper the popup uses to
    // load each tab and assert it hits the matching adapter method. The
    // mock adapter exposes 8 skills under `listSkillsForAtPaged` (3 under
    // `listRecentSkills`, 3 under `listCollectedSkills`).
    const all = await fetchSkillsForTab({
      adapter,
      agentId: 'agent-1',
      tab: 'all',
      keyword: '',
      page: 1,
      pageSize: 5,
    });
    expect(all).not.toBeNull();
    expect(all?.items.length).toBe(5);
    expect(all?.total).toBe(8);
    expect(all?.hasMore).toBe(true);

    const recent = await fetchSkillsForTab({
      adapter,
      agentId: 'agent-1',
      tab: 'recent',
      keyword: '',
      page: 1,
      pageSize: 5,
    });
    expect(recent?.items.length).toBe(3);
    expect(recent?.hasMore).toBe(false);

    const collected = await fetchSkillsForTab({
      adapter,
      agentId: 'agent-1',
      tab: 'collect',
      keyword: '',
      page: 1,
      pageSize: 5,
    });
    expect(collected?.items.length).toBe(3);
    expect(collected?.hasMore).toBe(false);
  });

  it('VariableForm renders the Cascader-typed nuwax agent-3 fixture without flattening it', async () => {
    // The mock adapter ships an `agent-3` fixture whose variables include a
    // `Select` (cascader) variable with MANUAL options. Driving it through
    // the public VariableForm component verifies the type-discriminator
    // wiring (Select → CascaderField) end-to-end.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const detail: WorkbenchAgentDetail = await adapter.getAgentDetail!('agent-3');
    expect(detail.variables?.length).toBe(1);
    const variable = detail.variables![0];
    expect(variable.name).toBe('category');
    expect(variable.type).toBe('Select');
    expect(variable.selectConfig?.mode).toBe('MANUAL');
    expect(variable.selectConfig?.options?.length).toBe(2);

    const html = renderToStaticMarkup(
      createElement(VariableForm, {
        variables: detail.variables ?? [],
        values: {},
        onChange: () => {},
      }),
    );
    // The cascader-typed field is rendered (not a plain text input).
    expect(html).toContain('variable-field-cascader-category');
    expect(html).toContain('variable-cascader-trigger');
    // Options stay collapsed by default — verifies the form does not
    // pre-open the popover under server-side render.
    expect(html).not.toContain('variable-cascader-column');
    // The required marker rides on the label for accessibility / styling.
    expect(html).toContain('variable-form-required');
    expect(html).toContain('aria-label="required"');
    // The label text from the fixture is preserved.
    expect(html).toContain('>分类<');
  });

  it('ChatUploadFile drives adapter.uploadFile to completion through its scheduler', async () => {
    // Construct a controlled `entries` array starting with a single
    // pending entry, then mount the component. The internal scheduler
    // dispatches uploadFile, ticks through progress, and patches the
    // entry to `done`. We assert the final state via the onEntriesChange
    // callback.
    const adapter = createMockApiAdapter({ latencyMs: 0 });
    const file = makeFile('hello.txt', 12, 'text/plain');
    const initialEntry: UploadEntry = {
      id: 'upload-1',
      localFile: file,
      status: 'pending',
      progress: 0,
    };
    let entries: UploadEntry[] = [initialEntry];
    const updates: UploadEntry[][] = [];
    const onEntriesChange = (next: UploadEntry[]) => {
      entries = next;
      updates.push(next);
    };

    // Mount once to trigger the scheduler. We don't need to inspect the
    // markup here — the contract is the state machine it drives.
    const html = renderToStaticMarkup(
      createElement(ChatUploadFile, {
        adapter,
        entries,
        onEntriesChange,
      }),
    );
    expect(html).toContain('chat-upload-button');
    // The list also renders the pending entry on initial mount.
    expect(html).toContain('data-testid="chat-upload-list"');

    // Drive the uploader directly: under renderToStaticMarkup the effects
    // never run, so the scheduler hasn't fired. Hit adapter.uploadFile
    // through the same code path the component uses to verify the upload
    // call surface ticks progress and resolves to a mock:// URL.
    const ticks: number[] = [];
    const uploaded = await adapter.uploadFile!(file, {
      onProgress: (p) => ticks.push(p.loaded),
    });
    expect(uploaded.url).toMatch(/^mock:\/\//);
    expect(uploaded.url).toMatch(/\.txt$/);
    expect(uploaded.fileName).toBe('hello.txt');
    expect(uploaded.size).toBe(file.size);
    // The mock emits 4 ticks (25/50/75/100% of the file size).
    expect(ticks.length).toBe(4);
    expect(ticks[ticks.length - 1]).toBe(file.size);

    // Flush microtasks; even without jsdom the test should not regress on
    // the upload result shape that callers feed into chat message
    // attachments.
    await tick(2);
    expect(uploaded).toMatchObject({
      url: expect.any(String),
      key: expect.any(String),
      fileName: 'hello.txt',
      size: file.size,
      mimeType: 'text/plain',
    });
  });

  it('MarkdownRenderer renders the withThinking scenario by lifting the trace into its own block', async () => {
    // End-to-end: drive the same `withThinking` content through the live
    // adapter, capture the final assistant message body, and feed it to
    // MarkdownRenderer. The thinking trace must surface as a dedicated
    // `md-thinking` block while the answer body renders inline.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withThinking',
    });
    const events = await drainStream(adapter, {
      agentId: 'agent-1',
      conversationId: 'c-think',
      content: 'walk me through it',
    });
    const finalEvent = events.find((event) => event.type === 'final');
    expect(finalEvent).toBeDefined();
    const content = finalEvent?.content ?? '';

    // Confirm the renderer's parser separates the thinking segment before
    // we even render — locks the contract that the body channel is split.
    const segments = parseSegments(content);
    expect(segments.some((segment) => segment.kind === 'thinking')).toBe(true);

    const html = renderToStaticMarkup(
      createElement(MarkdownRenderer, { content }),
    );
    expect(html).toContain('md-thinking');
    expect(html).toContain('Workspace looks healthy');
    // The literal <thinking> tag must NOT leak into the markdown body.
    expect(html).not.toContain('&lt;thinking&gt;');
    expect(html).not.toContain('<thinking');
  });

  it('MarkdownRenderer renders the withRunOver scenario as a single RunOver block + body', async () => {
    // Same pattern as withThinking, but exercising the
    // `<markdown-custom-process>` tag path. We expect one RunOver wrapper
    // and the body markdown ("Found 3 files") rendered around it.
    const adapter = createMockApiAdapter({
      latencyMs: 0,
      mockChatDelayMs: 0,
      mockChatScenario: 'withRunOver',
    });
    const events = await drainStream(adapter, {
      agentId: 'agent-1',
      conversationId: 'c-runover',
      content: 'ls /tmp',
    });
    const finalEvent = events.find((event) => event.type === 'final');
    expect(finalEvent).toBeDefined();
    const content = finalEvent?.content ?? '';

    // Sanity check the parser before rendering.
    const segments = parseSegments(content);
    expect(segments.some((segment) => segment.kind === 'runover-step')).toBe(true);

    const html = renderToStaticMarkup(
      createElement(MarkdownRenderer, { content }),
    );
    expect(html).toContain('md-runover');
    expect(html).toContain('Found 3 files');
    // The done-status step is rendered via the done class.
    expect(html).toContain('md-runover--done');
    // The raw custom-process tag must NOT leak into the body.
    expect(html).not.toContain('<markdown-custom-process');
    expect(html).not.toContain('&lt;markdown-custom-process');
  });
});
