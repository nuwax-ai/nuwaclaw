import { parseSseStream } from '../sse';
import type {
  WorkbenchApiAdapter,
  WorkbenchAgentDetail,
  WorkbenchCustomPageNavItem,
  WorkbenchConversation,
  WorkbenchConversationMessages,
  WorkbenchMessage,
  WorkbenchModelOption,
  WorkbenchSendMessageRequest,
  WorkbenchStreamEvent,
} from '../types';

export interface WebApiAdapterOptions {
  baseUrl: string;
  accessToken: string;
  fetcher?: typeof fetch;
  apiPathPrefix?: string;
}

interface JsonEnvelope<T> {
  data?: T;
  success?: boolean;
  message?: string;
  error?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`;
}

function normalizePrefix(prefix: string | undefined): string {
  return (prefix ?? '/api').replace(/^\/?/, '/').replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapData<T>(payload: unknown): T {
  if (isRecord(payload) && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
}

function createFallbackId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function readString(value: unknown, keys: string[]): string | undefined {
  const record = isRecord(value) ? value : {};
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'string' && raw.trim()) return raw;
    if (typeof raw === 'number') return String(raw);
  }
  return undefined;
}

function readCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ['items', 'list', 'records', 'rows', 'conversations', 'messages', 'suggestions', 'questions']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function normalizeConversation(raw: unknown, agentId: string): WorkbenchConversation {
  const item = isRecord(raw) ? raw : {};
  const id = String(
    item.id ??
      item.conversationId ??
      item.conversation_id ??
      item.sessionId ??
      item.session_id ??
      createFallbackId('conv'),
  );
  const now = new Date().toISOString();
  return {
    id,
    agentId: String(item.agentId ?? item.agent_id ?? agentId),
    title: String(
      item.title ??
        item.name ??
        item.agentName ??
        item.agent_name ??
        item.summary ??
        id.slice(0, 12),
    ),
    createdAt: String(
      item.createdAt ?? item.created_at ?? item.createdTime ?? item.createTime ?? now,
    ),
    updatedAt: String(
      item.updatedAt ??
        item.updated_at ??
        item.lastActivity ??
        item.updateTime ??
        item.modifiedTime ??
        now,
    ),
    status: item.status === 'active' || item.status === 'error' ? item.status : 'idle',
    metadata: item,
  };
}

function normalizeBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (['true', '1', 'yes'].includes(value.toLowerCase())) return true;
    if (['false', '0', 'no'].includes(value.toLowerCase())) return false;
  }
  return undefined;
}

function normalizeCustomPageMenus(raw: unknown): WorkbenchCustomPageNavItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((item) => ({
      name: String(item.name ?? item.title ?? ''),
      path: readString(item, ['path', 'url', 'uri']),
      icon: readString(item, ['icon', 'iconName']),
      selected: normalizeBooleanLike(item.selected),
    }))
    .filter((item) => item.name);
}

function normalizeAgentDetail(raw: unknown, agentId: string): WorkbenchAgentDetail {
  const item = isRecord(raw) ? raw : {};
  const id = String(item.agentId ?? item.id ?? item.agent_id ?? agentId);
  return {
    agentId: id,
    name:
      readString(item, ['name', 'agentName', 'agent_name', 'title']) ??
      `Agent ${id}`,
    icon: readString(item, ['icon', 'avatar', 'logo']),
    description: readString(item, ['description', 'desc', 'summary']),
    openingChatMsg: readString(item, ['openingChatMsg', 'opening_chat_msg']),
    conversationId: readString(item, ['conversationId', 'conversation_id']),
    customPageMenus: normalizeCustomPageMenus(item.customPageMenus ?? item.custom_page_menus),
    guidQuestionDtos: Array.isArray(item.guidQuestionDtos)
      ? (item.guidQuestionDtos as WorkbenchAgentDetail['guidQuestionDtos'])
      : Array.isArray(item.guidQuestions)
        ? (item.guidQuestions as WorkbenchAgentDetail['guidQuestionDtos'])
        : [],
    variables: Array.isArray(item.variables)
      ? (item.variables as WorkbenchAgentDetail['variables'])
      : [],
    pageHomeIndex: readString(item, ['pageHomeIndex', 'page_home_index']),
    expandPageArea: normalizeBooleanLike(item.expandPageArea ?? item.expand_page_area),
    hideChatArea: normalizeBooleanLike(item.hideChatArea ?? item.hide_chat_area),
    hasPermission: normalizeBooleanLike(item.hasPermission ?? item.has_permission),
    allowCopy: item.allowCopy as WorkbenchAgentDetail['allowCopy'],
    allowOtherModel: item.allowOtherModel as WorkbenchAgentDetail['allowOtherModel'],
    sandboxId: readString(item, ['sandboxId', 'sandbox_id']),
    raw: item,
  };
}

function normalizeModelOption(raw: unknown): WorkbenchModelOption {
  const item = isRecord(raw) ? raw : {};
  const id = String(item.id ?? item.modelId ?? item.model_id ?? item.value ?? '');
  return {
    id,
    name: readString(item, ['name', 'modelName', 'model_name', 'label']) ?? id,
    icon: readString(item, ['icon', 'avatar', 'logo']),
    provider: readString(item, ['provider', 'vendor']),
    description: readString(item, ['description', 'desc']),
    raw: item,
  };
}

function normalizeMessage(raw: unknown, conversationId: string): WorkbenchMessage {
  const item = isRecord(raw) ? raw : {};
  const id = String(
    item.id ?? item.messageId ?? item.message_id ?? createFallbackId('msg'),
  );
  const now = new Date().toISOString();
  const rawRole = String(item.role ?? item.sender ?? item.type ?? '').toLowerCase();
  const role = rawRole === 'user' || rawRole === 'system' ? rawRole : 'assistant';
  const kind =
    item.kind === 'thought' || item.kind === 'permission' || item.kind === 'error'
      ? item.kind
      : 'text';
  return {
    id,
    conversationId: String(item.conversationId ?? item.conversation_id ?? conversationId),
    role,
    kind,
    content: String(
      item.content ?? item.text ?? item.message ?? item.answer ?? item.question ?? '',
    ),
    createdAt: String(item.createdAt ?? item.created_at ?? item.createTime ?? now),
    status: item.status === 'streaming' || item.status === 'error' ? item.status : 'complete',
    metadata: item,
  };
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createHeaders(accessToken: string, body?: unknown): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

export function createWebApiAdapter(options: WebApiAdapterOptions): WorkbenchApiAdapter {
  const fetcher = options.fetcher ?? fetch;
  const prefix = normalizePrefix(options.apiPathPrefix);

  async function requestJson<T>(
    path: string,
    init: Omit<RequestInit, 'body' | 'headers'> & { body?: unknown } = {},
  ): Promise<T> {
    const response = await fetcher(joinUrl(options.baseUrl, path), {
      ...init,
      headers: createHeaders(options.accessToken, init.body),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const payload = await readJsonSafely(response);
    if (!response.ok) {
      const envelope = payload as JsonEnvelope<unknown>;
      throw new Error(
        envelope?.error ?? envelope?.message ?? `Request failed: ${response.status}`,
      );
    }
    return unwrapData<T>(payload);
  }

  function apiPath(path: string): string {
    return `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function getPublishedAgent(agentId: string): Promise<Record<string, unknown>> {
    const data = await requestJson<unknown>(
      apiPath(`/published/agent/${encodeURIComponent(agentId)}?withConversationId=true`),
      { method: 'GET' },
    );
    return isRecord(data) ? data : {};
  }

  return {
    async getAgentDetail(agentId) {
      const data = await getPublishedAgent(agentId);
      return normalizeAgentDetail(data, agentId);
    },

    async listConversations(agentId) {
      const [publishedAgent, data] = await Promise.all([
        getPublishedAgent(agentId).catch(() => ({})),
        requestJson<unknown>(apiPath('/agent/conversation/list'), {
          method: 'POST',
          body: { agentId },
        }),
      ]);
      const items = readCollection(data);
      const conversations = items.map((item) => normalizeConversation(item, agentId));
      const publishedConversationId = readString(publishedAgent, [
        'conversationId',
        'conversation_id',
        'sessionId',
        'session_id',
      ]);
      if (conversations.length === 0 && publishedConversationId) {
        return [
          normalizeConversation(
            {
              ...publishedAgent,
              id: publishedConversationId,
              title:
                readString(publishedAgent, ['title', 'name', 'agentName', 'agent_name']) ??
                'Current session',
            },
            agentId,
          ),
        ];
      }
      return conversations;
    },

    async createConversation(agentId, title) {
      const data = await requestJson<unknown>(apiPath('/agent/conversation/create'), {
        method: 'POST',
        body: { agentId, title },
      });
      return normalizeConversation(data, agentId);
    },

    async updateConversation(conversationId, values) {
      const data = await requestJson<unknown>(apiPath('/agent/conversation/update'), {
        method: 'POST',
        body: {
          id: conversationId,
          topic: values.topic ?? values.title,
        },
      });
      return normalizeConversation(data, '');
    },

    async deleteConversation(conversationId) {
      await requestJson<unknown>(
        apiPath(`/agent/conversation/delete/${encodeURIComponent(conversationId)}`),
        {
          method: 'POST',
        },
      );
    },

    async getConversation(agentId, conversationId): Promise<WorkbenchConversationMessages> {
      const data = await requestJson<unknown>(
        apiPath('/agent/conversation/message/list'),
        {
          method: 'POST',
          body: { agentId, conversationId },
        },
      );
      const record = isRecord(data) ? data : {};
      const conversation = normalizeConversation(
        record.conversation ?? { id: conversationId, agentId, title: conversationId },
        agentId,
      );
      const rawMessages = readCollection(data);
      return {
        conversation,
        messages: rawMessages.map((message) => normalizeMessage(message, conversation.id)),
      };
    },

    async *sendMessage(
      request: WorkbenchSendMessageRequest,
    ): AsyncGenerator<WorkbenchStreamEvent> {
      const response = await fetcher(
        joinUrl(options.baseUrl, apiPath('/agent/conversation/chat')),
        {
          method: 'POST',
          headers: createHeaders(options.accessToken, request),
          body: JSON.stringify({
            agentId: request.agentId,
            conversationId: request.conversationId,
            content: request.content,
            message: request.content,
            prompt: request.content,
            requestId: request.requestId,
            metadata: request.metadata,
            variableParams: request.variableParams,
            modelId: request.modelId,
            agent_config: request.agentMode
              ? { agent_server: { agent_mode: request.agentMode } }
              : undefined,
            attachments: request.attachments,
            skillIds: request.skillIds,
            sandboxId: request.sandboxId,
          }),
        },
      );

      if (!response.ok) {
        const payload = await readJsonSafely(response);
        const envelope = payload as JsonEnvelope<unknown>;
        throw new Error(
          envelope?.error ?? envelope?.message ?? `Send failed: ${response.status}`,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (response.body && contentType.includes('text/event-stream')) {
        yield* parseSseStream(response.body);
        return;
      }

      const payload = await readJsonSafely(response);
      const data = unwrapData<Record<string, unknown>>(payload);
      const streamUrl =
        isRecord(data) && typeof (data.streamUrl ?? data.stream_url) === 'string'
          ? String(data.streamUrl ?? data.stream_url)
          : null;

      if (streamUrl) {
        const streamResponse = await fetcher(
          streamUrl.startsWith('http') ? streamUrl : joinUrl(options.baseUrl, streamUrl),
          {
            method: 'GET',
            headers: createHeaders(options.accessToken),
          },
        );
        if (!streamResponse.ok || !streamResponse.body) {
          throw new Error(`Stream failed: ${streamResponse.status}`);
        }
        yield* parseSseStream(streamResponse.body);
        return;
      }

      const events = isRecord(data) && Array.isArray(data.events) ? data.events : [];
      for (const event of events as WorkbenchStreamEvent[]) {
        yield event;
      }
      if (events.length === 0) {
        yield {
          type: 'final',
          conversationId: request.conversationId,
          content: isRecord(data) ? String(data.content ?? data.message ?? '') : '',
          raw: data,
        };
      }
    },

    async stopChat(requestIdOrConversationId, context) {
      const stopId = requestIdOrConversationId || context.conversationId;
      await requestJson(
        apiPath(`/agent/conversation/chat/stop/${encodeURIComponent(stopId)}`),
        {
          method: 'POST',
          body: {
            agentId: context.agentId,
            conversationId: context.conversationId,
            requestId: requestIdOrConversationId,
          },
        },
      );
    },

    async respondPermission(permissionId, choiceId, context) {
      await requestJson(
        apiPath(
          `/agent/conversation/permission/${encodeURIComponent(permissionId)}`,
        ),
        {
          method: 'POST',
          body: {
            agentId: context.agentId,
            conversationId: context.conversationId,
            choiceId,
          },
        },
      );
    },

    async getSuggestQuestions(conversationId, agentId, variableParams) {
      const data = await requestJson<unknown>(
        apiPath('/agent/conversation/chat/suggest'),
        {
          method: 'POST',
          body: { conversationId, agentId, variableParams },
        },
      );
      if (Array.isArray(data)) return data.map(String);
      const record = isRecord(data) ? data : {};
      const items = readCollection(data);
      return items.map(String);
    },

    async getModelOptions(agentId) {
      const data = await requestJson<unknown>(
        apiPath(`/agent/conversation/model/options/${encodeURIComponent(agentId)}`),
        { method: 'GET' },
      );
      const items = Array.isArray(data) ? data : readCollection(data);
      return items.map(normalizeModelOption);
    },
  };
}
