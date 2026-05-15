import type { CSSProperties, ReactNode } from 'react';

export type WorkbenchAdapterMode = 'web' | 'mock' | 'custom';

export type WorkbenchMessageRole = 'user' | 'assistant' | 'system';

export type WorkbenchMessageKind = 'text' | 'thought' | 'permission' | 'error';

export type WorkbenchMessageStatus = 'sending' | 'streaming' | 'complete' | 'error';

export interface WorkbenchConversation {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status?: 'active' | 'idle' | 'error';
  metadata?: Record<string, unknown>;
}

export interface WorkbenchMessage {
  id: string;
  conversationId: string;
  role: WorkbenchMessageRole;
  content: string;
  createdAt: string;
  kind?: WorkbenchMessageKind;
  status?: WorkbenchMessageStatus;
  metadata?: Record<string, unknown>;
}

export interface WorkbenchPermissionChoice {
  id: string;
  label: string;
  destructive?: boolean;
}

export interface WorkbenchPermissionRequest {
  id: string;
  title: string;
  description?: string;
  choices?: WorkbenchPermissionChoice[];
  metadata?: Record<string, unknown>;
}

export interface WorkbenchCustomPageNavItem {
  name: string;
  path?: string;
  icon?: string;
  selected?: boolean;
}

export interface WorkbenchGuidQuestion {
  id?: string | number;
  question?: string;
  content?: string;
  title?: string;
}

export interface WorkbenchVariable {
  name: string;
  label?: string;
  require?: boolean;
  systemVariable?: boolean;
  placeholder?: string;
  defaultValue?: string | number;
}

export interface WorkbenchAgentDetail {
  agentId: string;
  name: string;
  icon?: string;
  description?: string;
  openingChatMsg?: string;
  conversationId?: string;
  customPageMenus?: WorkbenchCustomPageNavItem[];
  guidQuestionDtos?: WorkbenchGuidQuestion[];
  variables?: WorkbenchVariable[];
  pageHomeIndex?: string;
  expandPageArea?: boolean;
  hideChatArea?: boolean;
  hasPermission?: boolean;
  allowCopy?: boolean | number | string;
  allowOtherModel?: boolean | number | string;
  sandboxId?: string;
  raw?: unknown;
}

export type WorkbenchStreamEventType =
  | 'chunk'
  | 'thought'
  | 'final'
  | 'error'
  | 'permission';

export interface WorkbenchStreamEvent {
  type: WorkbenchStreamEventType;
  conversationId?: string;
  messageId?: string;
  content?: string;
  error?: string;
  permission?: WorkbenchPermissionRequest;
  raw?: unknown;
}

export interface WorkbenchConversationMessages {
  conversation: WorkbenchConversation;
  messages: WorkbenchMessage[];
}

export interface WorkbenchSendMessageRequest {
  agentId: string;
  conversationId: string;
  content: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkbenchApiAdapter {
  getAgentDetail?(agentId: string): Promise<WorkbenchAgentDetail>;
  listConversations(agentId: string): Promise<WorkbenchConversation[]>;
  createConversation(agentId: string, title?: string): Promise<WorkbenchConversation>;
  getConversation(
    agentId: string,
    conversationId: string,
  ): Promise<WorkbenchConversationMessages>;
  updateConversation?(
    conversationId: string,
    values: { title?: string; topic?: string },
  ): Promise<WorkbenchConversation>;
  deleteConversation?(conversationId: string): Promise<void>;
  sendMessage(request: WorkbenchSendMessageRequest): AsyncIterable<WorkbenchStreamEvent>;
  stopChat?(
    requestIdOrConversationId: string,
    context: { agentId: string; conversationId: string },
  ): Promise<void>;
  respondPermission?(
    permissionId: string,
    choiceId: string,
    context: { agentId: string; conversationId: string },
  ): Promise<void>;
}

export interface WorkbenchHostBridge {
  onOpenEditor?: (context: {
    agentId: string;
    conversationId?: string;
  }) => void | Promise<void>;
  onExit?: () => void | Promise<void>;
  onNavigate?: (path: string) => void | Promise<void>;
  onError?: (error: Error, context?: Record<string, unknown>) => void;
}

export interface AgentWorkbenchConfig {
  agentId?: string;
  appAgentId?: string;
  baseUrl?: string;
  accessToken?: string;
  workspaceDir?: string;
  locale?: string;
  previewContainer?: 'electron-webview' | string;
  useMock?: boolean;
  apiAdapter?: WorkbenchApiAdapter;
  hostBridge?: WorkbenchHostBridge;
  initialConversationId?: string;
  initialPath?: string;
  userId?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  mockLatencyMs?: number;
}

export interface AgentWorkbenchProviderProps {
  config: AgentWorkbenchConfig;
  children: ReactNode;
}

export interface AgentWorkbenchProps {
  config?: AgentWorkbenchConfig;
  className?: string;
  style?: CSSProperties;
}
