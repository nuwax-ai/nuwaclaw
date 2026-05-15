import type {
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchConversationMessages,
  WorkbenchMessage,
  WorkbenchSendMessageRequest,
  WorkbenchStreamEvent,
} from '../types';

export interface MockApiAdapterOptions {
  latencyMs?: number;
  now?: () => Date;
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
  const conversations = new Map<string, WorkbenchConversation[]>();
  const messages = new Map<string, WorkbenchMessage[]>();

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
      return {
        agentId,
        name: `Agent ${agentId}`,
        description: 'Mock published agent detail for NuwaClaw integration.',
        openingChatMsg: '我是用于联调的 mock 智能体。配置真实 token 和 appAgentId 后会切到 nuwax 远端 API。',
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
        ],
        variables: [],
        hasPermission: true,
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

    async getConversation(agentId, conversationId): Promise<WorkbenchConversationMessages> {
      await sleep(latencyMs);
      const conversation =
        listForAgent(agentId).find((item) => item.id === conversationId) ??
        makeConversation(agentId, 'Recovered session', now());
      return {
        conversation,
        messages: [...(messages.get(conversation.id) ?? [])],
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

    async stopChat() {
      await sleep(Math.max(20, Math.floor(latencyMs / 2)));
    },
  };
}
