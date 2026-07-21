export type ChatId = string;

export type ChatConversationStatus =
  | 'idle'
  | 'streaming'
  | 'executing'
  | 'error';

export interface ChatConversation {
  id: ChatId;
  agentId: ChatId;
  title: string;
  summary?: string;
  createdAt?: string;
  updatedAt: string;
  status?: ChatConversationStatus;
  metadata?: Record<string, unknown>;
}

export interface ChatTextPart {
  type: 'text';
  text: string;
}

export interface ChatThinkingPart {
  type: 'thinking';
  text: string;
  status?: 'streaming' | 'complete';
}

export interface ChatAttachmentPart {
  type: 'attachment';
  attachment: ChatAttachment;
}

export interface ChatToolPart {
  type: 'tool';
  id: ChatId;
  name: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  input?: unknown;
  output?: unknown;
  durationMs?: number;
}

export interface ChatErrorPart {
  type: 'error';
  message: string;
}

export interface ChatInteractionPart {
  type: 'interaction';
  id: ChatId;
  kind: 'permission' | 'question' | string;
  status?: 'pending' | 'submitting' | 'complete' | 'error';
  payload: unknown;
}

export type ChatMessagePart =
  | ChatTextPart
  | ChatThinkingPart
  | ChatAttachmentPart
  | ChatToolPart
  | ChatErrorPart
  | ChatInteractionPart;

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'stopped';

export interface ChatMessage {
  id: ChatId;
  conversationId: ChatId;
  role: ChatMessageRole;
  status: ChatMessageStatus;
  parts: ChatMessagePart[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatAttachment {
  id?: ChatId;
  key?: string;
  url: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export interface ChatDraft {
  /** Optional existing conversation target; omitted to create/use the active conversation. */
  conversationId?: ChatId;
  text: string;
  attachments: ChatAttachment[];
  skillIds: ChatId[];
  modelId?: ChatId;
  agentMode?: 'ask' | 'yolo';
  selectedComponentIds?: ChatId[];
  variableParams?: Record<string, unknown>;
  sandboxId?: ChatId;
  metadata?: Record<string, unknown>;
}

export interface ChatSendCommand extends ChatDraft {
  agentId: ChatId;
  conversationId: ChatId;
  requestId?: ChatId;
}

export type ChatStreamEvent =
  | { type: 'request'; requestId: ChatId }
  | { type: 'text-delta'; messageId?: ChatId; text: string }
  | { type: 'thinking-delta'; messageId?: ChatId; text: string }
  | { type: 'tool-update'; messageId?: ChatId; tool: ChatToolPart }
  | { type: 'interaction'; messageId?: ChatId; interaction: ChatInteractionPart }
  | { type: 'final'; messageId?: ChatId; text?: string; metadata?: Record<string, unknown> }
  | { type: 'error'; messageId?: ChatId; error: string };

export interface ChatConversationPage {
  items: ChatConversation[];
  nextCursor?: string | null;
}

export interface ChatMessagePage {
  conversation: ChatConversation;
  items: ChatMessage[];
  nextCursor?: string | null;
}

export interface ChatListOptions {
  cursor?: string | null;
  limit?: number;
  query?: string;
}

export interface ChatMessageListOptions {
  cursor?: string | null;
  limit?: number;
}

export interface ChatAdapter {
  listConversations(
    agentId: ChatId,
    options?: ChatListOptions,
  ): Promise<ChatConversationPage>;
  createConversation(agentId: ChatId, title?: string): Promise<ChatConversation>;
  getConversation(
    agentId: ChatId,
    conversationId: ChatId,
    options?: ChatMessageListOptions,
  ): Promise<ChatMessagePage>;
  updateConversation?(
    conversationId: ChatId,
    values: { title?: string },
  ): Promise<ChatConversation>;
  deleteConversation?(conversationId: ChatId): Promise<void>;
  shareConversation?(conversationId: ChatId): Promise<string>;
  send(command: ChatSendCommand): AsyncIterable<ChatStreamEvent>;
  stop?(requestIdOrConversationId: ChatId, command: ChatSendCommand): Promise<void>;
  respondInteraction?(
    interactionId: ChatId,
    response: unknown,
    context: { agentId: ChatId; conversationId: ChatId },
  ): Promise<void>;
}
