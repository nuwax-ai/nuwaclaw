import type {
  WorkbenchAgentDetail,
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchConversationMessages,
  WorkbenchMessage,
  WorkbenchSendMessageRequest,
  WorkbenchStreamEvent,
  WorkbenchUploadedFile,
  WorkbenchUploadProgress,
} from '../types';

/**
 * Named pre-canned SSE event sequences used by `sendMessage`.
 *
 * Tests / dev harnesses select one by passing
 * `createMockApiAdapter({ mockChatScenario: 'withThinking' })`. Each preset
 * mirrors a real-world flow the OpenApp UI must render:
 *
 * - `simple`         : chunk → chunk → final (the canonical happy path)
 * - `withThinking`   : chunk containing inline `<thinking>` → chunk (answer) → final.
 *                      Exercises MarkdownRenderer's `extractThinking` extractor
 *                      so the UI separates the trace from the body.
 * - `withRunOver`    : chunk containing `<markdown-custom-process>` tags → final.
 *                      Exercises the tool-execution / RunOver block path.
 * - `withPermission` : thought → permission (the stream pauses here until the
 *                      caller resolves the permission externally via
 *                      `respondPermission`) — there is intentionally no
 *                      `final` event so callers can verify the pause.
 * - `withError`      : chunk (partial) → error. Locks the contract that the
 *                      stream terminates immediately on `error`.
 *
 * The arrays are `readonly` so callers cannot mutate the presets in place.
 */
export const MOCK_CHAT_SCENARIOS = {
  simple: [
    { type: 'chunk', content: 'Hello ' },
    { type: 'chunk', content: 'world!' },
    { type: 'final', content: 'Hello world!' },
  ],
  withThinking: [
    {
      type: 'chunk',
      content: '<thinking>Need to recall the user workspace state first.</thinking>',
    },
    { type: 'chunk', content: 'Workspace looks healthy. Here is a summary.' },
    {
      type: 'final',
      content:
        '<thinking>Need to recall the user workspace state first.</thinking>Workspace looks healthy. Here is a summary.',
    },
  ],
  withRunOver: [
    {
      type: 'chunk',
      content:
        '<markdown-custom-process status="running" title="Reading files">' +
        '{"step":"ls /tmp"}' +
        '</markdown-custom-process>',
    },
    { type: 'chunk', content: '\nFound 3 files in `/tmp`.' },
    {
      type: 'final',
      content:
        '<markdown-custom-process status="done" title="Reading files">' +
        '{"step":"ls /tmp"}' +
        '</markdown-custom-process>\nFound 3 files in `/tmp`.',
    },
  ],
  withPermission: [
    { type: 'thought', content: 'Checking whether I am allowed to run that command.' },
    {
      type: 'permission',
      permission: {
        id: 'mock-perm-scenario',
        title: 'Allow tool execution?',
        description: 'The agent wants to run a simulated workspace tool.',
        choices: [
          { id: 'allow', label: 'Allow once' },
          { id: 'deny', label: 'Deny', destructive: true },
        ],
      },
    },
    // NOTE: no `final` here — the stream "pauses" at the permission boundary.
    // Callers verify the pause by checking the last event is `permission`.
  ],
  withError: [
    { type: 'chunk', content: 'starting... ' },
    { type: 'error', error: 'mock-stream-failure' },
  ],
} as const satisfies Record<string, readonly WorkbenchStreamEvent[]>;

export type MockChatScenarioName = keyof typeof MOCK_CHAT_SCENARIOS;

/**
 * Per-agent mock fixtures returned by `getAgentDetail`.
 *
 * Three agents cover the visible variations the OpenApp UI cares about:
 *   - `agent-1` : full-featured TaskAgent. `allowAtSkill: true`, five
 *                 guidQuestionDtos, no variables. Default fallback used when
 *                 callers request an unknown agentId.
 *   - `agent-2` : minimal BasicAgent. `allowAtSkill: false`, no variables,
 *                 no guidQuestionDtos — exercises the "feature flag off"
 *                 rendering path.
 *   - `agent-3` : agent with a Cascader-typed variable so VariableForm's
 *                 Select / cascader branch can be driven from mock data
 *                 without needing the real nuwax backend.
 *
 * Each fixture omits `agentId` because `getAgentDetail` overrides it with the
 * caller's requested id — that way the renderer always sees the id it asked
 * for, even when we fall back to agent-1's fixture for unknown ids.
 */
type MockAgentFixture = Omit<WorkbenchAgentDetail, 'agentId'>;

export const MOCK_AGENTS: Record<string, MockAgentFixture> = {
  'agent-1': {
    name: 'Agent agent-1',
    description: 'Mock published agent detail for NuwaClaw integration.',
    openingChatMsg:
      '我是用于联调的 mock 智能体。配置真实 token 和 appAgentId 后会切到 nuwax 远端 API。',
    customPageMenus: [
      {
        name: '页面预览',
        path: '/app/mock-preview',
        icon: 'icons-nav-ecosystem',
      },
    ],
    guidQuestionDtos: [
      { id: 'q1', question: '检查当前 workspace 状态' },
      { id: 'q2', question: '帮我规划下一步修改' },
      { id: 'q3', question: '生成 changelog 摘要' },
      { id: 'q4', question: '总结今天的提交' },
      { id: 'q5', question: '检查测试覆盖率' },
    ],
    variables: [],
    hasPermission: true,
    allowAtSkill: true,
  },
  'agent-2': {
    name: 'Agent agent-2 (Basic)',
    description: 'Minimal BasicAgent fixture: @-skill disabled, no variables.',
    openingChatMsg: 'BasicAgent mock. @-skill 菜单已关闭。',
    customPageMenus: [],
    guidQuestionDtos: [],
    hasPermission: true,
    allowAtSkill: false,
  },
  'agent-3': {
    name: 'Agent agent-3 (Cascader)',
    description: 'Agent with a Cascader-style Select variable for VariableForm tests.',
    openingChatMsg: '选择类别后再开始对话。',
    customPageMenus: [],
    guidQuestionDtos: [{ id: 'q1', question: 'Pick a category to begin' }],
    variables: [
      {
        name: 'category',
        label: '分类',
        require: true,
        type: 'Select',
        selectConfig: {
          mode: 'MANUAL',
          options: [
            {
              value: 'frontend',
              label: 'Frontend',
              children: [
                { value: 'react', label: 'React' },
                { value: 'vue', label: 'Vue' },
              ],
            },
            {
              value: 'backend',
              label: 'Backend',
              children: [
                { value: 'node', label: 'Node.js' },
                { value: 'python', label: 'Python' },
              ],
            },
          ],
        },
      },
    ],
    hasPermission: true,
    allowAtSkill: true,
  },
};

/**
 * Conversation id used by `MOCK_LONG_CONVERSATION_HISTORY`. Exported so tests
 * can opt into the long-history fixture without hard-coding a magic string.
 */
export const MOCK_LONG_CONVERSATION_ID = 'mock-long-conv';

/**
 * 50 fake messages used to exercise the `getConversation(..., { index, size })`
 * pagination path. Messages alternate user / assistant and embed their index
 * into the content so tests can verify that page boundaries do not overlap.
 *
 * The fixture is seeded into the messages map under `MOCK_LONG_CONVERSATION_ID`
 * the first time a caller asks for it.
 */
export const MOCK_LONG_CONVERSATION_HISTORY: readonly WorkbenchMessage[] =
  Array.from({ length: 50 }, (_, idx) => {
    const isUser = idx % 2 === 0;
    // Use a synthetic but stable ISO date so the order is deterministic.
    const ts = new Date(Date.UTC(2026, 0, 1, 0, idx)).toISOString();
    return {
      id: `mock-long-msg-${idx + 1}`,
      conversationId: MOCK_LONG_CONVERSATION_ID,
      role: isUser ? 'user' : 'assistant',
      content: isUser
        ? `User question #${idx + 1}`
        : `Assistant answer #${idx + 1}`,
      createdAt: ts,
      kind: 'text',
      status: 'complete',
      metadata: { messageIndex: idx + 1 },
    };
  });

export interface MockApiAdapterOptions {
  latencyMs?: number;
  now?: () => Date;
  /**
   * Pre-canned event sequence used by `sendMessage`. When provided, the mock
   * yields these events instead of the default chunk/final generator. Useful
   * for integration tests that need to assert specific event orderings (e.g.
   * permission → final, or error-only flows).
   *
   * The events are yielded in order with `mockChatDelayMs` between each one.
   * The mock still records a user message and stores a synthetic assistant
   * message (from the last 'final' or 'chunk' event content) so subsequent
   * `getConversation` calls return a realistic transcript.
   *
   * Takes precedence over `mockChatScenario` when both are supplied.
   */
  mockChatEvents?: WorkbenchStreamEvent[];
  /**
   * Selects one of the named presets in `MOCK_CHAT_SCENARIOS`. Convenient
   * shorthand for tests / dev harnesses that don't need to hand-author an
   * event list. Ignored when `mockChatEvents` is also provided.
   */
  mockChatScenario?: MockChatScenarioName;
  /** Delay between mocked chat events in ms. Defaults to 0 for fast tests. */
  mockChatDelayMs?: number;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function makeConversation(agentId: string, title: string, now: Date): WorkbenchConversation {
  return {
    id: createId('conv'),
    agentId,
    title,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: 'idle',
  };
}

export function createMockApiAdapter(options: MockApiAdapterOptions = {}): WorkbenchApiAdapter {
  const latencyMs = options.latencyMs ?? 180;
  const now = options.now ?? (() => new Date());
  // `mockChatEvents` (caller-supplied) wins over `mockChatScenario` (preset).
  // Both legacy callers and tests that hand-author event arrays keep working.
  const scenarioEvents = options.mockChatScenario
    ? MOCK_CHAT_SCENARIOS[options.mockChatScenario]
    : undefined;
  const mockChatEvents = options.mockChatEvents ?? scenarioEvents;
  const mockChatDelayMs = options.mockChatDelayMs ?? 0;
  const conversations = new Map<string, WorkbenchConversation[]>();
  const messages = new Map<string, WorkbenchMessage[]>();

  /**
   * Lazily seed the long-history fixture under `MOCK_LONG_CONVERSATION_ID`.
   *
   * The seed runs at most once per adapter instance and only when a caller
   * actually asks for the long conversation. This keeps the default tests
   * (which don't touch this id) free of unrelated state.
   */
  function ensureLongHistorySeeded(agentId: string): void {
    if (messages.has(MOCK_LONG_CONVERSATION_ID)) return;
    const seededConv: WorkbenchConversation = {
      id: MOCK_LONG_CONVERSATION_ID,
      agentId,
      title: 'Mock long history (50 messages)',
      createdAt: MOCK_LONG_CONVERSATION_HISTORY[0]?.createdAt ?? now().toISOString(),
      updatedAt:
        MOCK_LONG_CONVERSATION_HISTORY[MOCK_LONG_CONVERSATION_HISTORY.length - 1]
          ?.createdAt ?? now().toISOString(),
      status: 'idle',
    };
    const existingList = conversations.get(agentId) ?? [];
    if (!existingList.some((item) => item.id === MOCK_LONG_CONVERSATION_ID)) {
      conversations.set(agentId, [seededConv, ...existingList]);
    }
    messages.set(MOCK_LONG_CONVERSATION_ID, [...MOCK_LONG_CONVERSATION_HISTORY]);
  }

  function listForAgent(agentId: string): WorkbenchConversation[] {
    if (!conversations.has(agentId)) {
      const seeded = makeConversation(agentId, 'Mock workspace check', now());
      conversations.set(agentId, [seeded]);
      messages.set(seeded.id, [
        {
          id: createId('msg'),
          conversationId: seeded.id,
          role: 'assistant',
          content:
            'This mock conversation is local to the workbench package. Configure baseUrl and accessToken to connect a remote agent service.',
          createdAt: seeded.createdAt,
          kind: 'text',
          status: 'complete',
        },
      ]);
    }
    return conversations.get(agentId) ?? [];
  }

  function touch(conversation: WorkbenchConversation): WorkbenchConversation {
    const updated = { ...conversation, updatedAt: now().toISOString() };
    const list = conversations.get(conversation.agentId) ?? [];
    const index = list.findIndex((item) => item.id === conversation.id);
    if (index >= 0) list[index] = updated;
    return updated;
  }

  return {
    async getAgentDetail(agentId) {
      await sleep(latencyMs);
      // Look up a per-agent fixture; fall back to agent-1 for unknown ids so
      // dev harnesses that pass arbitrary ids still get a usable detail. The
      // agentId passed in always wins so the caller sees its own id back.
      const fixture = MOCK_AGENTS[agentId] ?? MOCK_AGENTS['agent-1'];
      return {
        ...fixture,
        agentId,
      };
    },

    async listConversations(agentId) {
      await sleep(latencyMs);
      return [...listForAgent(agentId)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    },

    async createConversation(agentId, title) {
      await sleep(latencyMs);
      const conversation = makeConversation(
        agentId,
        title?.trim() || 'Untitled session',
        now(),
      );
      conversations.set(agentId, [conversation, ...listForAgent(agentId)]);
      messages.set(conversation.id, []);
      return conversation;
    },

    async updateConversation(conversationId, values) {
      await sleep(latencyMs);
      for (const list of conversations.values()) {
        const found = list.find((item) => item.id === conversationId);
        if (found) {
          found.title = values.topic ?? values.title ?? found.title;
          return touch(found);
        }
      }
      return {
        id: conversationId,
        agentId: 'mock',
        title: values.topic ?? values.title ?? conversationId,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
        status: 'idle',
      };
    },

    async deleteConversation(conversationId) {
      await sleep(latencyMs);
      for (const [agentId, list] of conversations.entries()) {
        conversations.set(
          agentId,
          list.filter((item) => item.id !== conversationId),
        );
      }
      messages.delete(conversationId);
    },

    async getConversation(
      agentId,
      conversationId,
      paginationOptions,
    ): Promise<WorkbenchConversationMessages> {
      await sleep(latencyMs);
      // Lazily seed the long-history fixture so tests that ask for it get a
      // 50-message transcript without affecting unrelated conversations.
      if (conversationId === MOCK_LONG_CONVERSATION_ID) {
        ensureLongHistorySeeded(agentId);
      }
      const conversation =
        listForAgent(agentId).find((item) => item.id === conversationId) ??
        makeConversation(agentId, 'Recovered session', now());
      const allMessages = [...(messages.get(conversation.id) ?? [])];

      // Pagination: when callers pass `{ index, size }`, treat `index` as a
      // numeric offset into the message list (interpretation that's simple for
      // mock purposes and sufficient to verify non-overlapping pages from the
      // UI). When `index` is undefined we return the head of the list up to
      // `size`. This matches the "load latest, then page back" model used by
      // OpenApp's useConversation hook in practice.
      const size = paginationOptions?.size;
      const index = paginationOptions?.index;
      let pagedMessages = allMessages;
      let hasMore = false;
      if (typeof size === 'number' && size > 0) {
        const start = typeof index === 'number' && index > 0 ? index : 0;
        pagedMessages = allMessages.slice(start, start + size);
        hasMore = start + pagedMessages.length < allMessages.length;
      }

      return {
        conversation,
        messages: pagedMessages,
        hasMore,
      };
    },

    async *sendMessage(request: WorkbenchSendMessageRequest): AsyncGenerator<WorkbenchStreamEvent> {
      const list = messages.get(request.conversationId) ?? [];
      const userMessage: WorkbenchMessage = {
        id: createId('msg'),
        conversationId: request.conversationId,
        role: 'user',
        content: request.content,
        createdAt: now().toISOString(),
        kind: 'text',
        status: 'complete',
      };
      list.push(userMessage);
      messages.set(request.conversationId, list);

      // When the test supplies a pre-canned event stream, yield those events
      // verbatim instead of the default scripted response. The mock still
      // touches/stores the assistant message so getConversation reflects it.
      if (mockChatEvents && mockChatEvents.length > 0) {
        let assistantTextFromEvents = '';
        // Widen the iteration variable: `MOCK_CHAT_SCENARIOS` arrays are `as
        // const` so individual literals lose access to optional fields like
        // `conversationId`. Re-typing here keeps the preset arrays strict at
        // their declaration site while letting us treat each event as the
        // full union when forwarding it through the stream.
        for (const event of mockChatEvents as readonly WorkbenchStreamEvent[]) {
          if (mockChatDelayMs > 0) await sleep(mockChatDelayMs);
          // Default conversationId to the request's when callers omit it.
          const normalized: WorkbenchStreamEvent = {
            ...event,
            conversationId: event.conversationId ?? request.conversationId,
          };
          if (event.type === 'chunk' && typeof event.content === 'string') {
            assistantTextFromEvents += event.content;
          }
          if (event.type === 'final' && typeof event.content === 'string') {
            assistantTextFromEvents = event.content;
          }
          yield normalized;
          if (event.type === 'error') {
            // After an error event, no further bookkeeping makes sense.
            return;
          }
        }
        if (assistantTextFromEvents) {
          list.push({
            id: createId('msg'),
            conversationId: request.conversationId,
            role: 'assistant',
            content: assistantTextFromEvents,
            createdAt: now().toISOString(),
            kind: 'text',
            status: 'complete',
          });
        }
        return;
      }

      await sleep(latencyMs);
      yield {
        type: 'thought',
        conversationId: request.conversationId,
        content: 'Checking local mock context and shaping a response.',
      };

      if (request.content.toLowerCase().includes('permission')) {
        await sleep(latencyMs);
        yield {
          type: 'permission',
          conversationId: request.conversationId,
          permission: {
            id: createId('perm'),
            title: 'Mock permission request',
            description: 'The agent wants to run a simulated workspace action.',
            choices: [
              { id: 'once', label: 'Allow once' },
              { id: 'reject', label: 'Reject', destructive: true },
            ],
          },
        };
      }

      const response =
        request.content.trim().length > 0
          ? `Mock agent response for "${request.content.trim()}". The package is running without Electron APIs.`
          : 'Mock agent response. Enter a prompt to continue.';
      const chunks = response.match(/.{1,28}(\s|$)/g) ?? [response];
      let assistantText = '';

      for (const chunk of chunks) {
        await sleep(Math.max(20, Math.floor(latencyMs / 3)));
        assistantText += chunk;
        yield {
          type: 'chunk',
          conversationId: request.conversationId,
          content: chunk,
        };
      }

      await sleep(Math.max(20, Math.floor(latencyMs / 3)));
      yield {
        type: 'final',
        conversationId: request.conversationId,
        content: assistantText,
      };

      const conversation = listForAgent(request.agentId).find(
        (item) => item.id === request.conversationId,
      );
      if (conversation) {
        conversation.title =
          conversation.title === 'Untitled session'
            ? request.content.slice(0, 48) || conversation.title
            : conversation.title;
        touch(conversation);
      }
      list.push({
        id: createId('msg'),
        conversationId: request.conversationId,
        role: 'assistant',
        content: assistantText,
        createdAt: now().toISOString(),
        kind: 'text',
        status: 'complete',
      });
    },

   async respondPermission() {
     await sleep(Math.max(20, Math.floor(latencyMs / 2)));
   },

    async respondMcpAsk() {
      await sleep(Math.max(20, Math.floor(latencyMs / 2)));
    },

   async stopChat() {
      await sleep(Math.max(20, Math.floor(latencyMs / 2)));
    },

    async getSuggestQuestions() {
      await sleep(latencyMs);
      return [
        'Can you explain that in more detail?',
        'What are the next steps?',
        'Show me an example.',
      ];
    },

    async getModelOptions() {
      await sleep(latencyMs);
      return [
        { id: 'mock-default', name: 'Default Model', provider: 'mock' },
        { id: 'mock-fast', name: 'Fast Model', provider: 'mock' },
      ];
    },

    async uploadFile(
      file: File,
      uploadOpts?: {
        onProgress?: (p: WorkbenchUploadProgress) => void;
        signal?: AbortSignal;
      },
    ): Promise<WorkbenchUploadedFile> {
      // Simulate ~200ms upload split into 4 progress ticks (25/50/75/100).
      const totalDelay = Math.max(40, latencyMs);
      const step = Math.max(10, Math.floor(totalDelay / 4));
      const total = file.size;
      const ticks: WorkbenchUploadProgress[] = [
        { loaded: Math.floor(total * 0.25), total },
        { loaded: Math.floor(total * 0.5), total },
        { loaded: Math.floor(total * 0.75), total },
        { loaded: total, total },
      ];
      for (const tick of ticks) {
        if (uploadOpts?.signal?.aborted) {
          throw new DOMException('Upload aborted', 'AbortError');
        }
        await sleep(step);
        uploadOpts?.onProgress?.(tick);
      }
      const random = createId('file');
      const dotIndex = file.name.lastIndexOf('.');
      const ext = dotIndex >= 0 ? file.name.slice(dotIndex + 1) : 'bin';
      return {
        url: `mock://files/${random}.${ext}`,
        key: random,
        fileName: file.name,
        size: file.size,
        mimeType: file.type || undefined,
      };
    },

    async listSkillsForAt(_agentId, listOptions) {
      await sleep(latencyMs);
      const tab = listOptions?.tab ?? 'all';
      if (tab === 'recent') return [...MOCK_RECENT_SKILLS];
      if (tab === 'collect') return [...MOCK_COLLECTED_SKILLS];
      const kw = (listOptions?.keyword ?? '').trim().toLowerCase();
      if (!kw) return [...MOCK_ALL_SKILLS];
      return MOCK_ALL_SKILLS.filter(
        (skill) =>
          skill.name.toLowerCase().includes(kw) ||
          (skill.description?.toLowerCase().includes(kw) ?? false),
      );
    },

    async listSkillsForAtPaged(params) {
      await sleep(latencyMs);
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      const kw = (params.keyword ?? '').trim().toLowerCase();
      const filtered = kw
        ? MOCK_ALL_SKILLS.filter(
            (skill) =>
              skill.name.toLowerCase().includes(kw) ||
              (skill.description?.toLowerCase().includes(kw) ?? false),
          )
        : [...MOCK_ALL_SKILLS];
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize);
      return {
        items,
        total: filtered.length,
        hasMore: start + items.length < filtered.length,
      };
    },

    async listRecentSkills() {
      await sleep(latencyMs);
      return [...MOCK_RECENT_SKILLS];
    },

    async listCollectedSkills() {
      await sleep(latencyMs);
      return [...MOCK_COLLECTED_SKILLS];
    },
  };
}

/**
 * Mock fixtures for the @-skill popup. 8 entries in the "all" tab cover the
 * common categories (web/code/data/file). Recent and collect tabs reuse
 * subsets so the UI integration tests can verify cross-tab transitions.
 */
const MOCK_ALL_SKILLS = [
  {
    id: 'mock-skill-search',
    name: 'Search Web',
    description: 'Search the web for up-to-date information.',
    icon: 'search',
  },
  {
    id: 'mock-skill-browse',
    name: 'Browse Page',
    description: 'Open a URL and extract its readable content.',
    icon: 'browser',
  },
  {
    id: 'mock-skill-code-review',
    name: 'Code Review',
    description: 'Review a code diff and suggest improvements.',
    icon: 'code',
  },
  {
    id: 'mock-skill-sql',
    name: 'SQL Query',
    description: 'Run a SQL query against the connected database.',
    icon: 'database',
  },
  {
    id: 'mock-skill-summarize',
    name: 'Summarize Document',
    description: 'Summarize a long document into key bullet points.',
    icon: 'file-text',
  },
  {
    id: 'mock-skill-translate',
    name: 'Translate Text',
    description: 'Translate text between languages.',
    icon: 'globe',
  },
  {
    id: 'mock-skill-image',
    name: 'Image Caption',
    description: 'Generate a caption for an uploaded image.',
    icon: 'image',
  },
  {
    id: 'mock-skill-calendar',
    name: 'Calendar Lookup',
    description: 'Look up upcoming events on the calendar.',
    icon: 'calendar',
  },
] as const;

const MOCK_RECENT_SKILLS = [
  MOCK_ALL_SKILLS[0],
  MOCK_ALL_SKILLS[2],
  MOCK_ALL_SKILLS[4],
];

const MOCK_COLLECTED_SKILLS = [
  MOCK_ALL_SKILLS[1],
  MOCK_ALL_SKILLS[3],
  MOCK_ALL_SKILLS[7],
];
