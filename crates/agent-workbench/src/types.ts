// ID convention: all IDs (agentId, conversationId, messageId, skillIds, modelId, sandboxId)
// are strings at the workbench boundary. Conversion to/from nuwax API's numeric IDs
// happens exclusively in src/adapters/idCoercion.ts via toApiId/fromApiId.
// Do not introduce number-typed IDs in this file.

import type { CSSProperties, ReactNode } from 'react';
import type { ChatMessagePart } from '@nuwax-ai/chat-kit/core';

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

export interface WorkbenchRemoteUser {
  id?: string;
  userName?: string;
  nickName?: string;
  avatar?: string;
  email?: string;
  raw?: unknown;
}

export interface WorkbenchCreditSummary {
  available: number;
  total?: number;
  frozen?: number;
  raw?: unknown;
}

export interface WorkbenchNotification {
  id: string;
  content: string;
  read: boolean;
  createdAt?: string;
  senderName?: string;
  senderAvatar?: string;
  raw?: unknown;
}

export interface WorkbenchConversationFile {
  id: string;
  name: string;
  isDirectory: boolean;
  binary?: boolean;
  sizeExceeded?: boolean;
  content?: string;
  previewUrl?: string;
  raw?: unknown;
}

export interface WorkbenchTerminalConnection {
  url: string;
  protocols?: string[];
  wireProtocol?: 'ttyd' | 'plain';
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
  /**
   * Structured chat-kit parts, carried verbatim for lossless rendering.
   *
   * The live conversation path hydrates this from `useChatSession` via
   * `fromChatMessage`, so renderers can read parts directly instead of
   * re-deriving them from the flat `content` + `metadata` fields. Wire /
   * legacy messages without parts still use `toChatMessage`'s reconstruction.
   */
  parts?: ChatMessagePart[];
}

export interface WorkbenchPermissionChoice {
  id: string;
  label: string;
  destructive?: boolean;
  /** ACP option kind: allow_once | allow_always | reject_once | reject_always */
  kind?: WorkbenchPermissionOptionKind;
}

export type WorkbenchPermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always';

export type WorkbenchAcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

/**
 * Tool-call context for an ACP permission request. Describes what the agent
 * is asking permission to do (e.g. "edit file X").
 */
export interface WorkbenchAcpToolCall {
  toolCallId?: string;
  title?: string;
  /** Tool action category. */
  kind?: WorkbenchAcpToolKind | string;
  /** File paths / line numbers the tool will touch. */
  locations?: Array<{ path: string; line?: number | null }>;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | string;
  rawInput?: unknown;
}

export interface WorkbenchPermissionRequest {
  id: string;
  title: string;
  description?: string;
  choices?: WorkbenchPermissionChoice[];
  /** ACP tool-call context, if available. */
  toolCall?: WorkbenchAcpToolCall;
  /** ACP option kind for each choice, if the backend sent structured options. */
  metadata?: Record<string, unknown>;
}

export interface WorkbenchCustomPageNavItem {
  name: string;
  path?: string;
  icon?: string;
  selected?: boolean;
}

// ---------------------------------------------------------------------------
// MCP Ask (nuwax_ask_question) — schema-driven form interaction
// Mirrors nuwax feat-2026.6.18 AgentIntervention mcp-ask subsystem.
// ---------------------------------------------------------------------------

export const MCP_ASK_SCHEMA_VERSION = 'nuwaclaw.mcp_ask.v1';
export const MCP_ASK_SCHEMA_VERSION_ALIASES = ['nuwax.mcp_ask.v1'];
export const INTERACTION_UI_SCHEMA_VERSION = 'nuwaclaw.interaction.v1';
export const INTERACTION_UI_SCHEMA_VERSION_ALIASES = ['nuwax.interaction.v1'];

export type WorkbenchMcpAskFieldWidget =
  | 'radio'
  | 'checkboxes'
  | 'select'
  | 'text'
  | 'textarea'
  | 'radio-with-custom'
  | 'list'
  | 'file';

export interface WorkbenchJsonSchemaProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: string[];
  items?: WorkbenchJsonSchemaProperty;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface WorkbenchInteractionUiOptions {
  allowSkip?: boolean;
  skipLabel?: string;
  allowCustom?: boolean;
  otherValue?: string;
  otherField?: string;
  enumNames?: string[];
  placeholder?: string;
  accept?: string;
  multiple?: boolean;
}

export interface WorkbenchInteractionUiStep {
  id: string;
  title: string;
  description?: string;
  fields: string[];
}

export interface WorkbenchInteractionUiSchema {
  version: string;
  presentation: 'modal' | 'inline' | 'wizard' | 'table';
  title: string;
  description?: string;
  schema: Record<string, unknown>;
  uiSchema?: Record<string, unknown>;
  steps?: WorkbenchInteractionUiStep[];
  initialValue?: Record<string, unknown>;
  submitLabel?: string;
  cancelLabel?: string;
  skipLabel?: string;
}

export interface WorkbenchMcpAskToolInput {
  toolName: 'nuwax_ask_question';
  schemaVersion: string;
  requestId: string;
  revision: number;
  sessionId: string;
  title: string;
  description?: string;
  ui: WorkbenchInteractionUiSchema;
  timeoutMs?: number;
}

export type WorkbenchMcpAskResponseStatus =
  | 'pending'
  | 'submitting'
  | 'submitted'
  | 'cancelled'
  | 'skipped'
  | 'failed';

export interface WorkbenchMcpAskInteraction {
  input: WorkbenchMcpAskToolInput;
  toolCallId: string;
  responseStatus?: WorkbenchMcpAskResponseStatus;
  formData?: Record<string, unknown>;
  errorMessage?: string;
}

export interface WorkbenchParsedMcpAskField {
  name: string;
  property: WorkbenchJsonSchemaProperty;
  widget: WorkbenchMcpAskFieldWidget;
  required: boolean;
  options: WorkbenchInteractionUiOptions;
  enumValues: string[];
  enumLabels: string[];
}

export type WorkbenchMcpAskRespondAction = 'submit' | 'cancel' | 'skip' | 'timeout';

export interface WorkbenchMcpAskRespondPayload {
  interventionId: string;
  toolCallId?: string;
  revision: number;
  source: 'mcp_ask';
  protocol: 'mcp';
  action: WorkbenchMcpAskRespondAction;
  formData?: Record<string, unknown>;
}

export interface WorkbenchGuidQuestion {
  id?: string;
  question?: string;
  content?: string;
  title?: string;
  info?: string;
}

/**
 * A selectable agent component (knowledge base, plugin, etc.) that the user
 * can attach before sending a message. Mirrors nuwax `AgentComponentInfo`.
 */
export interface WorkbenchAgentComponent {
  id: string;
  name: string;
  type?: string;
  icon?: string;
  description?: string;
  selected?: boolean;
}

export interface WorkbenchVariable {
  name: string;
  label?: string;
  require?: boolean;
  systemVariable?: boolean;
  placeholder?: string;
  defaultValue?: string | number;
  /** Optional. Defaults to 'Text' when absent. */
  type?: WorkbenchVariableType;
  /** Required for Select / MultipleSelect. */
  selectConfig?: WorkbenchVariableSelectConfig;
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
  /**
   * Whether @-skill mention is enabled for this agent.
   *
   * Mirrors nuwax `AgentDetail.allowAtSkill`, which arrives over the wire as
   * either the string enum `'Yes' | 'No'` or a boolean. The adapter normalizes
   * both shapes to a boolean here; consumers should treat `undefined` as
   * "use the host default" (matches nuwax behavior when the field is absent).
   */
  allowAtSkill?: boolean;
  /** Selectable components (knowledge bases, plugins) for manual attachment. */
  manualComponents?: WorkbenchAgentComponent[];
  sandboxId?: string;
  raw?: unknown;
}

export type WorkbenchStreamEventType =
  | 'chunk'
  | 'thought'
  | 'processing'
  | 'final'
  | 'error'
  | 'permission'
  | 'mcp_ask';

export interface WorkbenchStreamEvent {
  type: WorkbenchStreamEventType;
  conversationId?: string;
  messageId?: string;
  /** nuwax SSE ConversationChatResponse.requestId，用于 stop 接口 */
  requestId?: string;
  content?: string;
  error?: string;
  permission?: WorkbenchPermissionRequest;
  /** MCP Ask (nuwax_ask_question) interaction request. */
  mcpAsk?: WorkbenchMcpAskInteraction;
  /** Structured payload from nuwax PROCESSING events (processingList entry). */
  processingData?: Record<string, unknown>;
  raw?: unknown;
}

export interface WorkbenchConversationMessages {
  conversation: WorkbenchConversation;
  messages: WorkbenchMessage[];
  /** 是否还有更早的消息可加载 */
  hasMore?: boolean;
}

export interface WorkbenchGetConversationOptions {
  /** 消息游标 index，用于向上分页加载历史 */
  index?: number;
  size?: number;
}

/** 与 nuwax AttachmentFile 对齐的上传结果（发送 chat 前需同时具备 key 与 url） */
export interface WorkbenchUploadedAttachment {
  url: string;
  key?: string;
  fileName?: string;
  mimeType?: string;
}

export interface WorkbenchListConversationsOptions {
  /** 上一页最后一条会话 id，用于翻页 */
  lastId?: string | null;
  /** 返回条数；OpenApp 侧栏默认 8 */
  limit?: number;
  /** 主题模糊搜索 */
  topic?: string;
}

export type WorkbenchSkillListTab = 'all' | 'collect' | 'recent';

export interface WorkbenchSkillOption {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  /** Whether the skill requires payment (subscription). */
  paymentRequired?: boolean;
  /** Whether the current user has already subscribed. */
  subscribed?: boolean;
  /** Price in the tenant's currency, if paymentRequired. */
  price?: number;
}

export interface WorkbenchSendMessageRequest {
  agentId: string;
  conversationId: string;
  content: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  variableParams?: Record<string, unknown>;
  modelId?: string;
  agentMode?: 'ask' | 'yolo';
  attachments?: WorkbenchUploadedFile[];
  skillIds?: string[];
  sandboxId?: string;
  selectedComponents?: WorkbenchAgentComponent[];
}

export interface WorkbenchModelOption {
  id: string;
  name: string;
  icon?: string;
  provider?: string;
  description?: string;
  raw?: unknown;
}

export interface WorkbenchApiAdapter {
  getAgentDetail?(agentId: string): Promise<WorkbenchAgentDetail>;
  listConversations(
    agentId: string,
    options?: WorkbenchListConversationsOptions,
  ): Promise<WorkbenchConversation[]>;
  createConversation(agentId: string, title?: string): Promise<WorkbenchConversation>;
  getConversation(
    agentId: string,
    conversationId: string,
    options?: WorkbenchGetConversationOptions,
  ): Promise<WorkbenchConversationMessages>;
  updateConversation?(
    conversationId: string,
    values: { title?: string; topic?: string },
  ): Promise<WorkbenchConversation>;
  deleteConversation?(conversationId: string): Promise<void>;
  shareConversation?(conversationId: string): Promise<string>;
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
  respondMcpAsk?(
    payload: WorkbenchMcpAskRespondPayload,
    context: { agentId: string },
  ): Promise<void>;
  getSuggestQuestions?(
    conversationId: string,
    agentId: string,
    variableParams?: Record<string, unknown>,
    /** 最近用户消息，对齐 nuwax ConversationChatSuggestParams.message */
    lastMessage?: string,
  ): Promise<string[]>;
  getModelOptions?(agentId: string): Promise<WorkbenchModelOption[]>;
  /** POST /api/file/upload — single file multipart. */
  uploadFile?: (
    file: File,
    opts?: {
      onProgress?: (p: WorkbenchUploadProgress) => void;
      signal?: AbortSignal;
    },
  ) => Promise<WorkbenchUploadedFile>;
  /**
   * Multiplexed skill listing (back-compat).
   *
   * Dispatches to one of three nuwax endpoints based on `tab`:
   * - 'all'     → POST /api/published/skill/list-for-at      (paginated)
   * - 'collect' → POST /api/published/skill/collect/list     (full list)
   * - 'recent'  → POST /api/published/skill/recentlyUsed/list (full list)
   *
   * Returns a flat `WorkbenchSkillOption[]` for back-compat with the current
   * NuwaxOpenApp call site. Phase B will migrate callers to the dedicated
   * methods below (`listRecentSkills` / `listCollectedSkills` /
   * `listSkillsForAtPaged`) which expose pagination metadata.
   */
  listSkillsForAt?(
    agentId: string,
    options?: {
      keyword?: string;
      /** 对齐 nuwax SkillListForAtParams.page */
      page?: number;
      pageSize?: number;
      /** 全部 / 收藏 / 最近使用 */
      tab?: WorkbenchSkillListTab;
    },
  ): Promise<WorkbenchSkillOption[]>;
  /**
   * POST /api/published/skill/list-for-at — paginated/search skill list.
   * Mirrors nuwax `apiSkillListForAt`; returns the full envelope so callers
   * can paginate and surface total counts.
   */
  listSkillsForAtPaged?: (
    params: WorkbenchSkillListParams,
  ) => Promise<WorkbenchSkillListResult>;
  /**
   * POST /api/published/skill/recentlyUsed/list — recently used skills.
   * Mirrors nuwax `apiSkillRecentlyUsedListForAt`; the response is the full
   * list (no pagination), filtered locally by the caller.
   */
  listRecentSkills?: (agentId: string) => Promise<WorkbenchSkillOption[]>;
  /**
   * POST /api/published/skill/collect/list — collected/favorited skills.
   * Mirrors nuwax `apiSkillCollectListForAt`; the response is the full list
   * (no pagination), filtered locally by the caller.
   */
  listCollectedSkills?: (agentId: string) => Promise<WorkbenchSkillOption[]>;
  getCurrentUser?: () => Promise<WorkbenchRemoteUser>;
  getCreditSummary?: () => Promise<WorkbenchCreditSummary>;
  getUnreadNotificationCount?: () => Promise<number>;
  listNotifications?: (options?: { size?: number }) => Promise<WorkbenchNotification[]>;
  clearUnreadNotifications?: () => Promise<void>;
  listConversationFiles?: (conversationId: string) => Promise<WorkbenchConversationFile[]>;
  logout?: () => Promise<void>;
}

export interface WorkbenchHostBridge {
  onOpenEditor?: (context: {
    agentId: string;
    conversationId?: string;
  }) => void | Promise<void>;
  onExit?: () => void | Promise<void>;
  onNavigate?: (path: string) => void | Promise<void>;
  onNavigateRemote?: (path: string) => void | Promise<void>;
  onOpenSettings?: () => void | Promise<void>;
  onOpenConfigPage?: (
    page: 'client' | 'sessions' | 'mcp' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about',
  ) => void | Promise<void>;
  onLogout?: () => void | Promise<void>;
  onError?: (error: Error, context?: Record<string, unknown>) => void;
  /** Electron 宿主在加载页面预览前同步 ticket cookie（与 defaultSession 共享） */
  onBeforePreviewLoad?: (url: string) => void | Promise<void>;
  /** 可选：为 electron-webview 设置 userAgent */
  getPreviewUserAgent?: () => string | Promise<string>;
  /** Returns absolute path to webview preload script. Optional. */
  getPreviewPreloadPath?: () => string | undefined | Promise<string | undefined>;
  /** Called when webview triggers a download. */
  onPreviewDownload?: (info: { url: string; filename?: string }) => void;
  /** Called when webview attempts to open a new window. */
  onPreviewNewWindow?: (url: string) => 'allow' | 'deny' | 'open-external';
  /**
   * Called when user clicks a task-result file card in chat.
   * The host resolves the file URL and returns a descriptor for the workbench
   * to render in the preview pane. Return void/undefined to signal "not handled".
   */
  onFilePreview?: (
    fileId: string,
    context?: { conversationId?: string },
  ) => FilePreviewDescriptor | Promise<FilePreviewDescriptor | void> | void;
  getTerminalConnection?: (
    context: { conversationId: string },
  ) => WorkbenchTerminalConnection | Promise<WorkbenchTerminalConnection>;
}

/**
 * Descriptor returned by the host bridge's `onFilePreview`.
 * Contains everything the workbench's FilePreview component needs to render a file.
 */
export interface FilePreviewDescriptor {
  /** Full URL to fetch the file content. */
  src: string;
  /** Display name (e.g. "report.pdf"). Also used for extension-based type detection. */
  fileName: string;
  /** Optional inline text content (bypasses fetch for text/markdown). */
  content?: string;
  /** Optional file type override. Auto-detected from fileName extension when absent. */
  fileType?: import('./components/business-component/FilePreview/fileTypes').FileType;
  /** Base path for resolving relative image URLs inside markdown files. */
  staticFileBasePath?: string;
}

/**
 * Discriminated union for the preview pane state.
 * Replaces the previous `previewUrl: string | null`.
 */
export type PreviewState =
  | { kind: 'none' }
  | { kind: 'page'; url: string }
  | { kind: 'file'; descriptor: FilePreviewDescriptor }
  | { kind: 'files'; conversationId: string; selectedFileId?: string }
  | { kind: 'terminal'; conversationId: string };

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
  /** Controlled workspace surface. Hosts can place the Work / Chat switch in their own chrome. */
  workspaceMode?: 'work' | 'chat';
  onWorkspaceModeChange?: (mode: 'work' | 'chat') => void;
}

/**
 * Request params for the @-skill list endpoints.
 *
 * Aligns with nuwax `SkillListForAtParams` (atSkill.ts) but uses workbench
 * naming (`keyword` instead of `kw`). The adapter layer is responsible for
 * mapping `keyword` → `kw` when calling the real API. `agentId` is kept on
 * the params even though nuwax's endpoint is global, so adapters that want
 * to filter by agent (or audit which agent issued the call) can do so.
 */
export interface WorkbenchSkillListParams {
  agentId: string;
  /** Search keyword; mapped to nuwax `kw` field at the adapter boundary. */
  keyword?: string;
  /** 1-based page index; nuwax default is 1. */
  page?: number;
  /** Page size; nuwax MentionPopup default is 20. */
  pageSize?: number;
  /**
   * Restrict to specific usage scenarios (Agent type filter).
   * Mirrors nuwax `usageScenarios` (AgentTypeEnum[]).
   */
  usageScenarios?: string[];
}

/**
 * Paginated result for `listSkillsForAt`.
 *
 * Normalizes nuwax `Page<SkillInfoForAt>` (records + total) into a
 * workbench-shaped envelope. `hasMore` is derived at the adapter layer so
 * UI code does not need to know about page math.
 */
export interface WorkbenchSkillListResult {
  items: WorkbenchSkillOption[];
  total: number;
  hasMore: boolean;
}

/**
 * Result of a successful single-file upload via `uploadFile`.
 *
 * Mirrors nuwax `/api/file/upload` response shape: `{ url, key, fileName }`.
 * `size` and `mimeType` are populated from the local `File` when the server
 * does not echo them. The adapter is responsible for normalizing field aliases
 * (`fileUrl`, `file_url`, `link`, etc.) before returning.
 *
 * `fileName` is typed as optional to stay structurally compatible with the
 * legacy `WorkbenchUploadedAttachment` shape used by `NuwaxOpenApp`'s upload
 * pipeline. The adapter implementation always populates it (falling back to
 * the local `File.name`) so callers can rely on it being present in practice.
 */
export interface WorkbenchUploadedFile {
  url: string;
  key?: string;
  fileName?: string;
  size?: number;
  mimeType?: string;
}

/**
 * Upload progress event for `uploadFile.onProgress`.
 *
 * `loaded` and `total` are in bytes. Progress is best-effort: native `fetch`
 * does not expose upload progress, so adapters that only have `fetch` may
 * never invoke the callback. Use `loaded === total` as the completion marker.
 */
export interface WorkbenchUploadProgress {
  loaded: number;
  total: number;
}

/**
 * Variable input type discriminator. Mirrors nuwax `InputTypeEnum`
 * (src/types/enums/agent.ts) — only the user-facing variants are exposed
 * here; HTTP plugin types (Query/Body/Header/Path) live outside the
 * workbench variable form contract.
 */
export type WorkbenchVariableType =
  | 'Text'
  | 'Paragraph'
  | 'Number'
  | 'Select'
  | 'MultipleSelect'
  | 'AutoRecognition';

/**
 * `selectConfig.mode` for Select / MultipleSelect variables.
 *
 * - `MANUAL`: option tree is bundled with the variable definition.
 * - `PLUGIN`: option tree must be resolved at runtime via the host bridge
 *   (see `VariableFormProps.resolvePluginOptions`).
 */
export type WorkbenchSelectConfigMode = 'MANUAL' | 'PLUGIN';

/**
 * Tree node for cascader-style selects. Aligns with antd's Cascader option
 * shape used by nuwax `BindConfigWithSub.selectConfig.options`.
 */
export interface WorkbenchCascaderOption {
  value: string | number;
  label: string;
  children?: WorkbenchCascaderOption[];
}

/**
 * Configuration for Select / MultipleSelect variables.
 */
export interface WorkbenchVariableSelectConfig {
  mode: WorkbenchSelectConfigMode;
  /** For MANUAL: hard-coded option tree. */
  options?: WorkbenchCascaderOption[];
  /** For PLUGIN: identifier the host adapter can resolve to dynamic data. */
  pluginId?: string;
}
