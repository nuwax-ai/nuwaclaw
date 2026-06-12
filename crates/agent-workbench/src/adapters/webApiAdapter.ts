import { parseSseStream } from '../sse';
import { fromApiId, toApiId } from './idCoercion';
import type {
  WorkbenchApiAdapter,
  WorkbenchAgentComponent,
  WorkbenchAgentDetail,
  WorkbenchCustomPageNavItem,
  WorkbenchConversation,
  WorkbenchConversationMessages,
  WorkbenchGetConversationOptions,
  WorkbenchListConversationsOptions,
  WorkbenchMessage,
  WorkbenchMessageRole,
  WorkbenchModelOption,
  WorkbenchSendMessageRequest,
  WorkbenchSkillListParams,
  WorkbenchSkillListResult,
  WorkbenchSkillListTab,
  WorkbenchSkillOption,
  WorkbenchStreamEvent,
  WorkbenchUploadedAttachment,
  WorkbenchUploadedFile,
  WorkbenchUploadProgress,
} from '../types';

export interface WebApiAdapterOptions {
  baseUrl: string;
  accessToken: string;
  fetcher?: typeof fetch;
  apiPathPrefix?: string;
}

interface JsonEnvelope<T> {
  code?: string | number;
  data?: T;
  success?: boolean;
  message?: string;
  error?: string;
}

/** nuwax 业务成功码，见 codes.constants SUCCESS_CODE */
const NUWAX_SUCCESS_CODE = '0000';

/** OpenApp 侧栏历史会话条数，见 BaseTemplate runHistory({ limit: 8 }) */
const OPENAPP_SIDEBAR_CONVERSATION_LIMIT = 8;

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
  let current = payload;
  // Unwrap up to 2 levels of `{ data: … }` envelopes (nuwax sometimes nests).
  for (let i = 0; i < 2; i++) {
    if (isRecord(current) && 'data' in current) {
      current = (current as Record<string, unknown>).data;
    } else {
      break;
    }
  }
  return current as T;
}

/**
 * 解析 nuwax RequestResponse：HTTP 200 时仍可能 code !== 0000。
 */
function assertBusinessSuccess(payload: unknown, httpStatus: number): void {
  if (!isRecord(payload) || !('code' in payload)) return;
  const code = payload.code;
  if (code === undefined || code === null) return;
  const normalized = String(code);
  if (normalized === NUWAX_SUCCESS_CODE) return;
  const envelope = payload as JsonEnvelope<unknown>;
  throw new Error(
    envelope.message ??
      envelope.error ??
      `Request failed with business code: ${normalized} (HTTP ${httpStatus})`,
  );
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
    if (typeof raw === 'number') return fromApiId(raw);
  }
  return undefined;
}

function readBool(value: unknown, keys: string[]): boolean | undefined {
  const record = isRecord(value) ? value : {};
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'boolean') return raw;
    // Backend may send 0/1 instead of true/false.
    if (typeof raw === 'number') return raw !== 0;
    if (typeof raw === 'string') {
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
    }
  }
  return undefined;
}

function readNumber(value: unknown, keys: string[]): number | undefined {
  const record = isRecord(value) ? value : {};
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

function readCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ['items', 'list', 'records', 'rows', 'conversations', 'messages', 'suggestions', 'questions', 'content', 'data', 'result']) {
    if (Array.isArray(value[key])) return value[key];
  }
  // Generic fallback: return the first array-valued field
  for (const val of Object.values(value)) {
    if (Array.isArray(val)) return val;
  }
  return [];
}

function normalizeConversation(raw: unknown, agentId: string): WorkbenchConversation {
  const item = isRecord(raw) ? raw : {};
  const rawId =
    item.id ??
    item.conversationId ??
    item.conversation_id ??
    item.sessionId ??
    item.session_id;
  const id =
    fromApiId(rawId as number | string | null | undefined) || createFallbackId('conv');
  const now = new Date().toISOString();
  return {
    id,
    agentId:
      fromApiId((item.agentId ?? item.agent_id) as number | string | null | undefined) ||
      agentId,
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

/**
 * Normalize a `GuidQuestion` payload from nuwax into the workbench shape.
 *
 * Nuwax has sent this field in two distinct shapes over time:
 *   - `string[]` — bare list of questions
 *   - `Array<{ question?: string; content?: string; title?: string; info?: string; id?: string | number }>` —
 *     object list (current `guidQuestionDtos` shape)
 *
 * Field-name variants seen on the wire: `guidQuestionDtos`, `guidQuestions`,
 * `guide_questions`. The adapter accepts all of them; consumers always see
 * `WorkbenchGuidQuestion[]`.
 */
function normalizeGuidQuestionDtos(raw: unknown): WorkbenchAgentDetail['guidQuestionDtos'] {
  if (!Array.isArray(raw)) return [];
  const result: NonNullable<WorkbenchAgentDetail['guidQuestionDtos']> = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (text) result.push({ question: text });
      continue;
    }
    if (!isRecord(entry)) continue;
    const question = readString(entry, ['question', 'content', 'title', 'info', 'text']);
    if (!question) continue;
    const rawId = entry.id;
    const id =
      typeof rawId === 'string' || typeof rawId === 'number'
        ? fromApiId(rawId)
        : undefined;
    result.push({
      ...(id ? { id } : {}),
      question,
      ...(typeof entry.content === 'string' ? { content: entry.content } : {}),
      ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
      ...(typeof entry.info === 'string' ? { info: entry.info } : {}),
    });
  }
  return result;
}

function normalizeManualComponents(raw: unknown): WorkbenchAgentComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): WorkbenchAgentComponent | null => {
      const item = isRecord(entry) ? entry : {};
      const id = fromApiId(
        (item.id ?? item.componentId ?? item.component_id) as number | string | null | undefined,
      );
      if (!id) return null;
      return {
        id,
        name: readString(item, ['name', 'componentName', 'component_name']) ?? '',
        type: readString(item, ['type', 'componentType', 'component_type']),
        icon: readString(item, ['icon', 'avatar', 'logo']),
        description: readString(item, ['description', 'desc']),
        selected: normalizeBooleanLike(item.selected ?? item.isSelected),
      };
    })
    .filter((item): item is WorkbenchAgentComponent => item !== null);
}

function normalizeAgentDetail(raw: unknown, agentId: string): WorkbenchAgentDetail {
  const item = isRecord(raw) ? raw : {};
  const id =
    fromApiId(
      (item.agentId ?? item.id ?? item.agent_id) as number | string | null | undefined,
    ) || agentId;
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
    guidQuestionDtos: normalizeGuidQuestionDtos(
      item.guidQuestionDtos ?? item.guidQuestions ?? item.guide_questions,
    ),
    variables: Array.isArray(item.variables)
      ? (item.variables as WorkbenchAgentDetail['variables'])
      : [],
    pageHomeIndex: readString(item, ['pageHomeIndex', 'page_home_index']),
    expandPageArea: normalizeBooleanLike(item.expandPageArea ?? item.expand_page_area),
    hideChatArea: normalizeBooleanLike(item.hideChatArea ?? item.hide_chat_area),
    hasPermission: normalizeBooleanLike(item.hasPermission ?? item.has_permission),
    allowCopy: item.allowCopy as WorkbenchAgentDetail['allowCopy'],
    allowOtherModel: item.allowOtherModel as WorkbenchAgentDetail['allowOtherModel'],
    // nuwax sends `allowAtSkill` as 'Yes' | 'No' (string enum) or a boolean.
    // `normalizeBooleanLike` already maps both shapes (it accepts 'yes'/'no'
    // case-insensitively and passes booleans through unchanged).
    allowAtSkill: normalizeBooleanLike(item.allowAtSkill ?? item.allow_at_skill),
    manualComponents: normalizeManualComponents(
      item.manualComponents ?? item.manual_components ?? item.components,
    ),
    sandboxId: readString(item, ['sandboxId', 'sandbox_id']),
    raw: item,
  };
}

const MESSAGE_PAGE_SIZE = 10;

function normalizeSkillOption(raw: unknown): WorkbenchSkillOption | null {
  const item = isRecord(raw) ? raw : {};
  const id = fromApiId(
    (item.id ?? item.skillId ?? item.skill_id) as number | string | null | undefined,
  );
  if (!id) return null;
  return {
    id,
    name: readString(item, ['name', 'skillName', 'skill_name', 'title']) ?? id,
    description: readString(item, ['description', 'desc', 'summary']),
    icon: readString(item, ['icon', 'avatar', 'logo']),
    paymentRequired: readBool(item, ['paymentRequired', 'payment_required']),
    subscribed: readBool(item, ['subscribed']),
    price: readNumber(item, ['price']),
  };
}

/**
 * Normalize the `/api/file/upload` response into a `WorkbenchUploadedFile`.
 *
 * Falls back to the local `File` for `fileName`, `mimeType`, and `size` when
 * the server response omits them. Server field aliases handled: `url` /
 * `fileUrl` / `file_url` / `link`, `key` / `fileKey` / `file_key`,
 * `fileName` / `file_name` / `name`, `mimeType` / `mime_type` / `type`.
 */
function normalizeUploadedFile(raw: unknown, file: File): WorkbenchUploadedFile {
  const item = isRecord(raw) ? raw : {};
  const url = readString(item, ['url', 'fileUrl', 'file_url', 'link']) ?? '';
  const sizeRaw = item.size ?? item.fileSize ?? item.file_size;
  const size =
    typeof sizeRaw === 'number'
      ? sizeRaw
      : typeof sizeRaw === 'string' && sizeRaw.trim() !== ''
        ? Number(sizeRaw)
        : file.size;
  return {
    url,
    key: readString(item, ['key', 'fileKey', 'file_key']),
    fileName: readString(item, ['fileName', 'file_name', 'name']) ?? file.name,
    size: Number.isFinite(size) ? size : file.size,
    mimeType:
      readString(item, ['mimeType', 'mime_type', 'type']) ??
      (file.type ? file.type : undefined),
  };
}

function normalizeModelOption(raw: unknown): WorkbenchModelOption {
  const item = isRecord(raw) ? raw : {};
  const id = fromApiId(
    (item.id ?? item.modelId ?? item.model_id ?? item.value) as
      | number
      | string
      | null
      | undefined,
  );
  return {
    id,
    name: readString(item, ['name', 'modelName', 'model_name', 'label']) ?? id,
    icon: readString(item, ['icon', 'avatar', 'logo']),
    provider: readString(item, ['provider', 'vendor']),
    description: readString(item, ['description', 'desc']),
    raw: item,
  };
}

function normalizeMessageRole(raw: unknown): WorkbenchMessageRole {
  const value = String(raw ?? '').toUpperCase();
  if (value === 'USER') return 'user';
  if (value === 'SYSTEM') return 'system';
  if (value === 'ASSISTANT') return 'assistant';
  const lower = value.toLowerCase();
  if (lower === 'user') return 'user';
  if (lower === 'system') return 'system';
  return 'assistant';
}

function normalizeMessage(raw: unknown, conversationId: string): WorkbenchMessage {
  const item = isRecord(raw) ? raw : {};
  const id =
    fromApiId(
      (item.id ?? item.messageId ?? item.message_id) as number | string | null | undefined,
    ) || createFallbackId('msg');
  const now = new Date().toISOString();
  const role = normalizeMessageRole(item.role ?? item.sender);
  const thinkText = readString(item, ['think']);
  const text = readString(item, ['text', 'content', 'message', 'answer', 'question']) ?? '';
  const kind =
    item.kind === 'thought' || item.kind === 'permission' || item.kind === 'error'
      ? item.kind
      : thinkText && !text
        ? 'thought'
        : 'text';
  return {
    id,
    conversationId:
      fromApiId(
        (item.conversationId ?? item.conversation_id) as
          | number
          | string
          | null
          | undefined,
      ) || conversationId,
    role,
    kind,
    content: text || thinkText || '',
    createdAt: String(item.createdAt ?? item.created_at ?? item.createTime ?? now),
    status: item.status === 'streaming' || item.status === 'error' ? item.status : 'complete',
    metadata: item,
  };
}

/** nuwax AttachmentFile，见 conversationInfo.AttachmentFile */
interface NuwaxAttachmentFile {
  fileKey: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
}

function toNuwaxAttachment(
  item: WorkbenchUploadedAttachment,
  fallbackMime?: string,
): NuwaxAttachmentFile | null {
  const fileKey = item.key?.trim();
  const fileUrl = item.url?.trim();
  if (!fileKey || !fileUrl) return null;
  return {
    fileKey,
    fileUrl,
    fileName: item.fileName?.trim() || 'attachment',
    mimeType: item.mimeType?.trim() || fallbackMime || 'application/octet-stream',
  };
}

/**
 * 对齐 nuwax ConversationChatParams（OpenApp onMessageSend）。
 */
function toNuwaxChatBody(request: WorkbenchSendMessageRequest): Record<string, unknown> {
  const attachments = (Array.isArray(request.attachments) ? request.attachments : [])
    .map((raw) => {
      if (!isRecord(raw)) {
        const uploaded = raw as WorkbenchUploadedAttachment;
        return toNuwaxAttachment(uploaded);
      }
      const uploaded: WorkbenchUploadedAttachment = {
        url: readString(raw, ['url', 'fileUrl', 'file_url', 'link']) ?? '',
        key: readString(raw, ['key', 'fileKey', 'file_key']),
        fileName: readString(raw, ['fileName', 'file_name', 'name']),
        mimeType: readString(raw, ['mimeType', 'mime_type', 'type']),
      };
      return toNuwaxAttachment(uploaded);
    })
    .filter((item): item is NuwaxAttachmentFile => Boolean(item));

  const skillIds = request.skillIds
    ?.map((id) => toApiId(id))
    .filter((id) => (typeof id === 'number' ? Number.isFinite(id) : id !== ''));

  const body: Record<string, unknown> = {
    conversationId: toApiId(request.conversationId),
    message: request.content,
    attachments,
    selectedComponents: (request.selectedComponents ?? []).map((c) => ({
      id: toApiId(c.id),
      name: c.name,
      type: c.type,
    })),
    debug: false,
  };

  if (request.variableParams && Object.keys(request.variableParams).length > 0) {
    body.variableParams = request.variableParams;
  }
  if (skillIds && skillIds.length > 0) {
    body.skillIds = skillIds;
  }
  if (request.modelId) {
    body.modelId = toApiId(request.modelId);
  }
  if (request.sandboxId) {
    body.sandboxId = request.sandboxId;
  }

  return body;
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

function createHeaders(
  accessToken: string,
  init?: { body?: unknown; accept?: string },
): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (init?.accept) {
    headers.Accept = init.accept;
  }
  if (init?.body !== undefined) {
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
      headers: createHeaders(options.accessToken, { body: init.body }),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const payload = await readJsonSafely(response);
    if (!response.ok) {
      const envelope = payload as JsonEnvelope<unknown>;
      throw new Error(
        envelope?.error ?? envelope?.message ?? `Request failed: ${response.status}`,
      );
    }
    assertBusinessSuccess(payload, response.status);
    return unwrapData<T>(payload);
  }

  /** POST 无 body（如 chat/stop），与 nuwax apiAgentConversationChatStop 一致 */
  async function requestPostNoBody(path: string): Promise<void> {
    const response = await fetcher(joinUrl(options.baseUrl, path), {
      method: 'POST',
      headers: createHeaders(options.accessToken),
    });
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      const envelope = payload as JsonEnvelope<unknown>;
      throw new Error(
        envelope?.error ?? envelope?.message ?? `Request failed: ${response.status}`,
      );
    }
    assertBusinessSuccess(payload, response.status);
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

    async listConversations(agentId, listOptions?: WorkbenchListConversationsOptions) {
      const listBody: Record<string, unknown> = {
        agentId: toApiId(agentId),
        limit: listOptions?.limit ?? OPENAPP_SIDEBAR_CONVERSATION_LIMIT,
      };
      // Truthy check intentionally skips '' (fromApiId null-sentinel).
      // No current caller passes lastId; empty string is meaningless as cursor.
      if (listOptions?.lastId) {
        listBody.lastId = toApiId(listOptions.lastId);
      }
      if (listOptions?.topic) {
        listBody.topic = listOptions.topic;
      }

      const [publishedAgent, data] = await Promise.all([
        getPublishedAgent(agentId).catch(() => ({})),
        requestJson<unknown>(apiPath('/agent/conversation/list'), {
          method: 'POST',
          body: listBody,
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
        body: { agentId: toApiId(agentId), title },
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
    async shareConversation(conversationId) {
      const payload = await requestJson<unknown>(
        apiPath('/agent/conversation/share'),
        {
          method: 'POST',
          body: { id: toApiId(conversationId) },
        },
      );
      const data = unwrapData<unknown>(payload);
      const record = isRecord(data) ? data : {};
      const url =
        readString(record, ['url', 'shareUrl', 'share_url']) ?? '';
      return url;
    },

    async getConversation(
      agentId,
      conversationId,
      options?: WorkbenchGetConversationOptions,
    ): Promise<WorkbenchConversationMessages> {
      const size = options?.size ?? MESSAGE_PAGE_SIZE;
      const body: Record<string, unknown> = {
        conversationId: toApiId(conversationId),
        size,
      };
      if (options?.index !== undefined) {
        body.index = options.index;
      }
      const data = await requestJson<unknown>(
        apiPath('/agent/conversation/message/list'),
        {
          method: 'POST',
          body,
        },
      );
      const record = isRecord(data) ? data : {};
      const conversation = normalizeConversation(
        record.conversation ?? { id: conversationId, agentId, title: conversationId },
        agentId,
      );
      const rawMessages = readCollection(data);
      const messages = rawMessages.map((message) =>
        normalizeMessage(message, conversation.id),
      );
      const hasMoreFlag = record.hasMore ?? record.has_more;
      const hasMore =
        typeof hasMoreFlag === 'boolean'
          ? hasMoreFlag
          : messages.length >= size;
      return {
        conversation,
        messages,
        hasMore,
      };
    },

    async *sendMessage(
      request: WorkbenchSendMessageRequest,
    ): AsyncGenerator<WorkbenchStreamEvent> {
      const chatBody = toNuwaxChatBody(request);
      const response = await fetcher(
        joinUrl(options.baseUrl, apiPath('/agent/conversation/chat')),
        {
          method: 'POST',
          headers: createHeaders(options.accessToken, {
            body: chatBody,
            accept: 'application/json, text/plain, */*',
          }),
          body: JSON.stringify(chatBody),
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
            headers: createHeaders(options.accessToken, {}),
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

    async stopChat(requestIdOrConversationId) {
      const stopId = requestIdOrConversationId?.trim();
      if (!stopId) {
        throw new Error('stopChat requires requestId from SSE stream');
      }
      await requestPostNoBody(
        apiPath(`/agent/conversation/chat/stop/${encodeURIComponent(stopId)}`),
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

    async getSuggestQuestions(conversationId, _agentId, variableParams, lastMessage) {
      const data = await requestJson<unknown>(
        apiPath('/agent/conversation/chat/suggest'),
        {
          method: 'POST',
          body: {
            conversationId: toApiId(conversationId),
            message: lastMessage ?? '',
            attachments: [],
            selectedComponents: [],
            debug: false,
            ...(variableParams && Object.keys(variableParams).length > 0
              ? { variableParams }
              : {}),
          },
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

    async uploadFile(
      file: File,
      uploadOpts?: {
        onProgress?: (p: WorkbenchUploadProgress) => void;
        signal?: AbortSignal;
      },
    ): Promise<WorkbenchUploadedFile> {
      const formData = new FormData();
      formData.append('file', file, file.name);
      // nuwax ChatInputHome / OpenApp 上传临时文件
      formData.append('type', 'tmp');

      // NOTE: progress is best-effort. The injectable `fetcher` (native fetch)
      // does not expose upload progress events; only XMLHttpRequest does. To
      // keep the adapter test-injectable through `fetcher`, we skip progress
      // wiring here and emit a terminal 100% callback on completion so
      // callers always see a final state. TODO: gate behind a custom XHR
      // adapter when streamed progress becomes a hard requirement.
      const response = await fetcher(joinUrl(options.baseUrl, apiPath('/file/upload')), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
        },
        body: formData,
        signal: uploadOpts?.signal,
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const envelope = payload as JsonEnvelope<unknown>;
        throw new Error(
          envelope?.error ?? envelope?.message ?? `Upload failed: ${response.status}`,
        );
      }
      assertBusinessSuccess(payload, response.status);
      const data = unwrapData<unknown>(payload);
      const uploaded = normalizeUploadedFile(data, file);
      if (uploadOpts?.onProgress) {
        const total = file.size;
        uploadOpts.onProgress({ loaded: total, total });
      }
      return uploaded;
    },

    async listSkillsForAt(_agentId, listOptions) {
      const tab: WorkbenchSkillListTab = listOptions?.tab ?? 'all';
      const baseParams = {
        page: listOptions?.page ?? 1,
        pageSize: listOptions?.pageSize ?? 20,
        kw: listOptions?.keyword ?? '',
        targetType: 'Skill',
      };

      const pathByTab: Record<WorkbenchSkillListTab, string> = {
        all: '/published/skill/list-for-at',
        collect: '/published/skill/collect/list',
        recent: '/published/skill/recentlyUsed/list',
      };

      const data = await requestJson<unknown>(apiPath(pathByTab[tab]), {
        method: 'POST',
        body: baseParams,
      });
      const items = readCollection(data);
      return items
        .map(normalizeSkillOption)
        .filter((item): item is WorkbenchSkillOption => Boolean(item));
    },

    async listSkillsForAtPaged(
      params: WorkbenchSkillListParams,
    ): Promise<WorkbenchSkillListResult> {
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      // nuwax SkillListForAtParams: kw + targetType + usageScenarios + page/pageSize
      const body: Record<string, unknown> = {
        page,
        pageSize,
        kw: params.keyword ?? '',
        targetType: 'Skill',
      };
      if (params.usageScenarios && params.usageScenarios.length > 0) {
        body.usageScenarios = params.usageScenarios;
      }

      const data = await requestJson<unknown>(
        apiPath('/published/skill/list-for-at'),
        { method: 'POST', body },
      );

      // nuwax returns Page<SkillInfoForAt> = { records, total, ... }
      const records = readCollection(data);
      const totalRaw = isRecord(data) ? data.total : undefined;
      const total =
        typeof totalRaw === 'number'
          ? totalRaw
          : typeof totalRaw === 'string'
            ? Number(totalRaw) || records.length
            : records.length;
      const items = records
        .map(normalizeSkillOption)
        .filter((item): item is WorkbenchSkillOption => Boolean(item));
      // Mirror nuwax MentionPopup.loadAllTabData hasMore logic
      const hasMore =
        total > 0 ? page * pageSize < total : items.length >= pageSize;
      return { items, total, hasMore };
    },

    async listRecentSkills(_agentId: string): Promise<WorkbenchSkillOption[]> {
      // nuwax MentionPopup.loadRecentTabData → POST with targetType only.
      const data = await requestJson<unknown>(
        apiPath('/published/skill/recentlyUsed/list'),
        {
          method: 'POST',
          body: { targetType: 'Skill' },
        },
      );
      const items = readCollection(data);
      return items
        .map(normalizeSkillOption)
        .filter((item): item is WorkbenchSkillOption => Boolean(item));
    },

    async listCollectedSkills(_agentId: string): Promise<WorkbenchSkillOption[]> {
      // nuwax MentionPopup.loadFavoriteTabData → POST with targetType only.
      const data = await requestJson<unknown>(
        apiPath('/published/skill/collect/list'),
        {
          method: 'POST',
          body: { targetType: 'Skill' },
        },
      );
      const items = readCollection(data);
      return items
        .map(normalizeSkillOption)
        .filter((item): item is WorkbenchSkillOption => Boolean(item));
    },
  };
}
