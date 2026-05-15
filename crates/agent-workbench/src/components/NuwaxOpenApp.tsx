import {
  FormEvent,
  KeyboardEvent,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildAgentAppRoute,
  buildAgentChatRoute,
  buildAgentHistoryRoute,
  parseAgentWorkbenchRoute,
} from '../routes';
import type {
  WorkbenchAgentDetail,
  WorkbenchConversation,
  WorkbenchGuidQuestion,
  WorkbenchMessage,
  WorkbenchModelOption,
  WorkbenchPermissionRequest,
  WorkbenchStreamEvent,
  WorkbenchVariable,
} from '../types';
import { useAgentWorkbenchContext } from './AgentWorkbenchProvider';
import { MarkdownRenderer } from './MarkdownRenderer';

type OpenAppView =
  | { name: 'app' }
  | { name: 'chat'; conversationId: string }
  | { name: 'history' };

const zh = {
  collapseNav: '收起导航',
  expandNav: '展开导航',
  newConversation: '新建会话',
  historyConversation: '历史会话',
  viewAll: '查看全部',
  firstConversationTip: '还没有看到文件',
  emptyTitle: '和 {name} 开始会话',
  emptySubtitle: '直接输入指令，或从历史会话继续。',
  inputPlaceholder:
    '直接输入指令，可通过Shift+Enter换行，通过回车发送消息；支持输入@唤起技能；支持粘贴图片',
  contentGenerated: '内容由AI生成，请仔细甄别',
  send: '发送',
  stop: '停止',
  searchPlaceholder: '搜索历史会话',
  historyTitle: '历史会话',
  rename: '重命名',
  delete: '删除',
  renamePrompt: '请输入新的会话标题',
  deleteConfirm: '确定删除该会话吗？',
  openEditor: 'Open Editor',
  pagePreview: '页面预览',
  model: '默认模型',
  agentMode: 'Agent 模式',
  askMode: 'Ask',
  yoloMode: 'YOLO',
  mentionSkill: '提及技能',
  uploadAttachment: '上传附件',
  enableTools: '工具',
  refresh: '刷新',
  back: '后退',
  forward: '前进',
  copyLink: '复制链接',
  openInNewWindow: '打开',
  close: '关闭',
  missingToken: '缺少 accessToken，当前使用 mock adapter。',
  mockMode: 'Using mock workbench fallback for integration testing',
  permissionTitle: '权限请求',
  allowOnce: '允许一次',
  reject: '拒绝',
  suggestTitle: '推荐问题',
  variableFormTitle: '会话参数',
  variableSubmit: '开始会话',
  selectModel: '选择模型',
  noModels: '暂无可用模型',
};

const en: typeof zh = {
  collapseNav: 'Collapse navigation',
  expandNav: 'Expand navigation',
  newConversation: 'New conversation',
  historyConversation: 'History',
  viewAll: 'View all',
  firstConversationTip: 'No conversation yet',
  emptyTitle: 'Start a conversation with {name}',
  emptySubtitle: 'Enter a command, or continue from history.',
  inputPlaceholder:
    'Type a command. Shift+Enter for newline, Enter to send. Supports @ skills and pasted images.',
  contentGenerated: 'AI generated content. Review carefully.',
  send: 'Send',
  stop: 'Stop',
  searchPlaceholder: 'Search conversations',
  historyTitle: 'Conversation history',
  rename: 'Rename',
  delete: 'Delete',
  renamePrompt: 'Enter a new conversation title',
  deleteConfirm: 'Delete this conversation?',
  openEditor: 'Open Editor',
  pagePreview: 'Page preview',
  model: 'Default model',
  agentMode: 'Agent mode',
  askMode: 'Ask',
  yoloMode: 'YOLO',
  mentionSkill: 'Mention skill',
  uploadAttachment: 'Upload attachment',
  enableTools: 'Tools',
  refresh: 'Refresh',
  back: 'Back',
  forward: 'Forward',
  copyLink: 'Copy link',
  openInNewWindow: 'Open',
  close: 'Close',
  missingToken: 'Missing accessToken. Mock adapter is active.',
  mockMode: 'Using mock workbench fallback for integration testing',
  permissionTitle: 'Permission request',
  allowOnce: 'Allow once',
  reject: 'Reject',
  suggestTitle: 'Suggested questions',
  variableFormTitle: 'Session parameters',
  variableSubmit: 'Start conversation',
  selectModel: 'Select model',
  noModels: 'No models available',
};

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function fallbackAgent(agentId: string): WorkbenchAgentDetail {
  return {
    agentId,
    name: `Agent ${agentId}`,
    customPageMenus: [],
    guidQuestionDtos: [],
    variables: [],
    hasPermission: true,
  };
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? '').replace(/\/+$/, '');
}

function buildPreviewUrl(baseUrl: string | undefined, path: string): string {
  if (!path) return '';
  if (isAbsoluteUrl(path)) return path;
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

function questionText(item: WorkbenchGuidQuestion): string {
  const raw = item as WorkbenchGuidQuestion & { info?: unknown };
  return String(raw.question ?? raw.content ?? raw.title ?? raw.info ?? '').trim();
}

function agentInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'A';
}

type IconName =
  | 'sidebar'
  | 'plus'
  | 'history'
  | 'page'
  | 'close'
  | 'back'
  | 'forward'
  | 'reload'
  | 'link'
  | 'send'
  | 'stop'
  | 'attachment'
  | 'tools'
  | 'spark';

function Icon({ name }: { name: IconName }) {
  const path = {
    sidebar: 'M4 5.5h16M4 12h16M4 18.5h16M8 5.5v13',
    plus: 'M12 5v14M5 12h14',
    history: 'M4 12a8 8 0 1 0 2.35-5.65M4 5v5h5M12 8v5l3 2',
    page: 'M7 4h7l4 4v12H7zM14 4v5h5',
    close: 'M6 6l12 12M18 6L6 18',
    back: 'M15 6l-6 6 6 6',
    forward: 'M9 6l6 6-6 6',
    reload: 'M19 12a7 7 0 1 1-2.05-4.95M19 5v5h-5',
    link: 'M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10.5 5.43M14 11a5 5 0 0 0-7.07 0l-1.41 1.41a5 5 0 0 0 7.07 7.07l.91-.91',
    send: 'M5 12h13M13 6l6 6-6 6',
    stop: 'M8 8h8v8H8z',
    attachment: 'M21.44 11.05 12.2 20.3a6 6 0 0 1-8.49-8.49l9.19-9.2a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48',
    tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-3-3z',
    spark: 'M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  } satisfies Record<IconName, string>;
  return (
    <svg
      aria-hidden="true"
      className="open-app-svg-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path[name]} />
    </svg>
  );
}

function IconButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: IconName;
  onClick: () => void;
}) {
  return (
    <button className="open-app-icon-button" type="button" title={title} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

function AgentAvatar({ agent }: { agent: WorkbenchAgentDetail | null }) {
  if (agent?.icon) {
    return (
      <img
        className="open-app-agent-avatar"
        src={agent.icon}
        alt=""
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    );
  }
  return <div className="open-app-agent-avatar open-app-agent-avatar-fallback">{agentInitial(agent?.name ?? 'Agent')}</div>;
}

export function ConversationItem({
  item,
  active,
  onClick,
}: {
  item: WorkbenchConversation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? 'open-app-conversation-item active' : 'open-app-conversation-item'}
      onClick={onClick}
    >
      <span className="open-app-conversation-title">{item.title}</span>
      {item.status === 'active' && <span className="open-app-conversation-status" />}
    </button>
  );
}

function ChatMessage({
  message,
  agent,
}: {
  message: WorkbenchMessage;
  agent: WorkbenchAgentDetail | null;
}) {
  const isUser = message.role === 'user';
  return (
    <article className={isUser ? 'open-app-message user' : `open-app-message ${message.kind ?? 'assistant'}`}>
      <div className="open-app-message-avatar">
        {isUser ? <span>U</span> : <AgentAvatar agent={agent} />}
      </div>
      <div className="open-app-message-content">
        <div className="open-app-message-meta">
          <span>{isUser ? 'You' : agent?.name || 'Agent'}</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        <div className="open-app-message-text">
          {!message.content && message.status === 'streaming' && 'Streaming...'}
          {message.content && isUser && <span>{message.content}</span>}
          {message.content && !isUser && <MarkdownRenderer content={message.content} />}
        </div>
      </div>
    </article>
  );
}

function PermissionCard({
  request,
  onRespond,
  labels,
}: {
  request: WorkbenchPermissionRequest;
  onRespond: (choiceId: string) => void;
  labels: typeof zh;
}) {
  const choices =
    request.choices && request.choices.length > 0
      ? request.choices
      : [
          { id: 'once', label: labels.allowOnce },
          { id: 'reject', label: labels.reject, destructive: true },
        ];
  return (
    <div className="open-app-permission-card">
      <div>
        <div className="open-app-permission-kicker">{labels.permissionTitle}</div>
        <div className="open-app-permission-title">{request.title}</div>
        {request.description && <div className="open-app-permission-desc">{request.description}</div>}
      </div>
      <div className="open-app-permission-actions">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={choice.destructive ? 'open-app-btn danger' : 'open-app-btn primary'}
            onClick={() => onRespond(choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatInputHome({
  value,
  disabled,
  streaming,
  labels,
  agentMode,
  selectedModelId,
  modelOptions,
  showModelDropdown,
  onChange,
  onSubmit,
  onStop,
  onModeChange,
  onModelSelect,
  onToggleModelDropdown,
}: {
  value: string;
  disabled: boolean;
  streaming: boolean;
  labels: typeof zh;
  agentMode: 'ask' | 'yolo';
  selectedModelId?: string;
  modelOptions: WorkbenchModelOption[];
  showModelDropdown: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onModeChange: (mode: 'ask' | 'yolo') => void;
  onModelSelect: (modelId: string) => void;
  onToggleModelDropdown: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (streaming) return;
      onSubmit();
    }
  };
  const canSend = !streaming && !disabled && value.trim().length > 0;
  const selectedModel = modelOptions.find((m) => m.id === selectedModelId);
  return (
    <form
      className="open-app-chat-input-home"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (streaming) onStop();
        else onSubmit();
      }}
    >
      <div className="open-app-input-topbar">
        <div style={{ position: 'relative' }}>
          <button
            className="open-app-model-chip"
            type="button"
            disabled={disabled || streaming}
            onClick={onToggleModelDropdown}
          >
            <span>{selectedModel?.name ?? labels.model}</span>
          </button>
          {showModelDropdown && modelOptions.length > 0 && (
            <div className="open-app-model-dropdown">
              {modelOptions.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={model.id === selectedModelId ? 'active' : ''}
                  onClick={() => {
                    onModelSelect(model.id);
                    onToggleModelDropdown();
                  }}
                >
                  {model.name}
                </button>
              ))}
            </div>
          )}
          {showModelDropdown && modelOptions.length === 0 && (
            <div className="open-app-model-dropdown">
              <div className="open-app-model-empty">{labels.noModels}</div>
            </div>
          )}
        </div>
        <div className="open-app-mode-segment" aria-label={labels.agentMode}>
          <button
            type="button"
            className={agentMode === 'ask' ? 'active' : ''}
            disabled={disabled || streaming}
            onClick={() => onModeChange('ask')}
          >
            {labels.askMode}
          </button>
          <button
            type="button"
            className={agentMode === 'yolo' ? 'active' : ''}
            disabled={disabled || streaming}
            onClick={() => onModeChange('yolo')}
          >
            {labels.yoloMode}
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={streaming}
        placeholder={labels.inputPlaceholder}
      />
      <div className="open-app-input-footer">
        <div className="open-app-input-tools">
          <button type="button" title={labels.mentionSkill} disabled={disabled || streaming}>
            @
          </button>
          <button type="button" title={labels.uploadAttachment} disabled={disabled || streaming}>
            <Icon name="attachment" />
          </button>
          <button type="button" title={labels.enableTools} disabled={disabled || streaming}>
            <Icon name="tools" />
          </button>
        </div>
        <button
          className={streaming ? 'open-app-send-button streaming' : 'open-app-send-button'}
          type="submit"
          title={streaming ? labels.stop : labels.send}
          disabled={!streaming && !canSend}
        >
          <Icon name={streaming ? 'stop' : 'send'} />
        </button>
      </div>
    </form>
  );
}

export function PagePreviewIframe({
  url,
  title,
  labels = zh,
  previewContainer,
  onClose,
}: {
  url: string;
  title: string;
  labels?: typeof zh;
  previewContainer?: string;
  onClose: () => void;
}) {
  const [frameKey, setFrameKey] = useState(0);
  const copyUrl = useCallback(() => {
    void navigator.clipboard?.writeText(url);
  }, [url]);
  const openUrl = useCallback(() => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [url]);
  return (
    <div className="open-app-page-preview">
      <header className="open-app-page-preview-header">
        <span className="open-app-page-preview-title">
          <Icon name="page" />
          {title}
        </span>
        <div className="open-app-page-preview-tools">
          <button type="button" title={labels.back} disabled>
            <Icon name="back" />
          </button>
          <button type="button" title={labels.forward} disabled>
            <Icon name="forward" />
          </button>
          <button type="button" title={labels.refresh} onClick={() => setFrameKey((value) => value + 1)}>
            <Icon name="reload" />
          </button>
          <button type="button" title={labels.copyLink} onClick={copyUrl}>
            <Icon name="link" />
          </button>
          <button type="button" title={labels.openInNewWindow} onClick={openUrl}>
            <Icon name="page" />
          </button>
          <button type="button" title={labels.close} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="open-app-page-preview-body">
        {previewContainer === 'electron-webview'
          ? createElement('webview', {
              key: frameKey,
              className: 'open-app-page-preview-frame',
              src: url,
            })
          : (
              <iframe key={frameKey} className="open-app-page-preview-frame" src={url} title={title} />
            )}
      </div>
    </div>
  );
}

function VariableForm({
  variables,
  labels,
  onSubmit,
  onCancel,
}: {
  variables: WorkbenchVariable[];
  labels: typeof zh;
  onSubmit: (params: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of variables) {
      if (v.defaultValue != null) init[v.name] = String(v.defaultValue);
    }
    return init;
  });

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const params: Record<string, unknown> = {};
    for (const v of variables) {
      const val = values[v.name]?.trim();
      if (val) params[v.name] = val;
    }
    onSubmit(params);
  };

  const missingRequired = variables.some(
    (v) => v.require && !values[v.name]?.trim(),
  );

  return (
    <form className="open-app-variable-form" onSubmit={handleSubmit}>
      <div className="open-app-variable-title">{labels.variableFormTitle}</div>
      {variables.map((v) => (
        <label key={v.name} className="open-app-variable-field">
          <span>
            {v.label ?? v.name}
            {v.require && <span className="open-app-variable-required">*</span>}
          </span>
          <input
            type="text"
            value={values[v.name] ?? ''}
            placeholder={v.placeholder ?? v.label ?? v.name}
            onChange={(e) => handleChange(v.name, e.target.value)}
          />
        </label>
      ))}
      <div className="open-app-variable-actions">
        <button type="button" className="open-app-btn" onClick={onCancel}>
          {labels.close}
        </button>
        <button type="submit" className="open-app-btn primary" disabled={missingRequired}>
          {labels.variableSubmit}
        </button>
      </div>
    </form>
  );
}

function AgentChatEmpty({
  agent,
  labels,
  agentId,
}: {
  agent: WorkbenchAgentDetail | null;
  labels: typeof zh;
  agentId: string;
}) {
  const name = agent?.name ?? `Agent ${agentId}`;
  return (
    <div className="open-app-chat-empty">
      <AgentAvatar agent={agent} />
      <h1>{name}</h1>
      <p>{agent?.openingChatMsg || applyTemplate(labels.emptyTitle, { name })}</p>
    </div>
  );
}

export function NuwaxOpenApp() {
  const { adapter, config, mode, missingConfig } = useAgentWorkbenchContext();
  const agentId = (config.appAgentId ?? config.agentId ?? '').trim();
  const labels = config.locale?.toLowerCase().startsWith('en') ? en : zh;
  const initialRoute = useMemo<OpenAppView>(() => {
    const path =
      config.initialPath ??
      (typeof window !== 'undefined' ? window.location.pathname : '');
    const parsed = path ? parseAgentWorkbenchRoute(path) : null;
    if (!parsed || parsed.agentId !== agentId) return { name: 'app' } as OpenAppView;
    if (parsed.view === 'chat' && parsed.conversationId) {
      return { name: 'chat', conversationId: parsed.conversationId };
    }
    if (parsed.view === 'history') return { name: 'history' };
    return { name: 'app' };
  }, [agentId, config.initialPath]);

  const [view, setView] = useState<OpenAppView>(initialRoute);
  const [agent, setAgent] = useState<WorkbenchAgentDetail | null>(null);
  const [conversations, setConversations] = useState<WorkbenchConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<WorkbenchConversation | null>(null);
  const [messages, setMessages] = useState<WorkbenchMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<WorkbenchPermissionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<'ask' | 'yolo'>('ask');
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined);
  const [modelOptions, setModelOptions] = useState<WorkbenchModelOption[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [suggestQuestions, setSuggestQuestions] = useState<string[]>([]);
  const [variableParams, setVariableParams] = useState<Record<string, unknown>>({});
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.42);
  const [isDragging, setIsDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  const onSplitDragStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setIsDragging(true);
      const container = splitContainerRef.current;
      if (!container) return;

      const onMove = (e: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        setSplitRatio(Math.min(0.75, Math.max(0.25, ratio)));
      };
      const onUp = () => {
        setIsDragging(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [],
  );
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Close model dropdown on outside click
  useEffect(() => {
    if (!showModelDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.open-app-model-chip') && !target.closest('.open-app-model-dropdown')) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelDropdown]);

  const reportError = useCallback(
    (cause: unknown, fallbackMessage: string, context: Record<string, unknown>) => {
      const nextError = cause instanceof Error ? cause.message : fallbackMessage;
      setError(nextError);
      config.hostBridge?.onError?.(cause instanceof Error ? cause : new Error(nextError), context);
      return nextError;
    },
    [config.hostBridge],
  );

  const navigate = useCallback(
    async (next: OpenAppView) => {
      setView(next);
      if (!agentId) return;
      let path = buildAgentAppRoute(agentId);
      if (next.name === 'chat') path = buildAgentChatRoute(agentId, next.conversationId);
      if (next.name === 'history') path = buildAgentHistoryRoute(agentId);
      await config.hostBridge?.onNavigate?.(path);
    },
    [agentId, config.hostBridge],
  );

  const refreshHistory = useCallback(async () => {
    if (!agentId) return;
    setLoadingHistory(true);
    try {
      const list = await adapter.listConversations(agentId);
      setConversations(list);
    } catch (cause) {
      reportError(cause, 'Failed to load conversations', { phase: 'listConversations' });
    } finally {
      setLoadingHistory(false);
    }
  }, [adapter, agentId, reportError]);

  const loadConversation = useCallback(
    async (conversation: WorkbenchConversation) => {
      setActiveConversation(conversation);
      setMessages([]);
      setPermissionRequest(null);
      setError(null);
      try {
        const detail = await adapter.getConversation(agentId, conversation.id);
        setActiveConversation(detail.conversation);
        setMessages(detail.messages);
        await navigate({ name: 'chat', conversationId: detail.conversation.id });
      } catch (cause) {
        reportError(cause, 'Failed to open conversation', {
          phase: 'getConversation',
          conversationId: conversation.id,
        });
      }
    },
    [adapter, agentId, navigate, reportError],
  );

  const createConversation = useCallback(
    async (title?: string) => {
      const conversation = await adapter.createConversation(agentId, title);
      setConversations((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]);
      setActiveConversation(conversation);
      setMessages([]);
      setPermissionRequest(null);
      await navigate({ name: 'chat', conversationId: conversation.id });
      return conversation;
    },
    [adapter, agentId, navigate],
  );

  const openNewConversation = useCallback(async () => {
    try {
      await createConversation(labels.newConversation);
    } catch (cause) {
      reportError(cause, 'Failed to create conversation', { phase: 'createConversation' });
    }
  }, [createConversation, labels.newConversation, reportError]);

  useEffect(() => {
    if (!agentId) return;
    setLoadingDetail(true);
    setError(null);
    (adapter.getAgentDetail?.(agentId) ?? Promise.resolve(fallbackAgent(agentId)))
      .then((detail) => {
        setAgent(detail);
        if (detail.conversationId) {
          setActiveConversation((current) => current ?? {
            id: detail.conversationId as string,
            agentId,
            title: detail.name,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            status: 'idle',
          });
        }
      })
      .catch((cause) => {
        setAgent(fallbackAgent(agentId));
        reportError(cause, 'Failed to load agent detail', { phase: 'getAgentDetail' });
      })
      .finally(() => setLoadingDetail(false));
  }, [adapter, agentId, reportError]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!agentId || !adapter.getModelOptions) return;
    adapter
      .getModelOptions(agentId)
      .then((options) => {
        setModelOptions(options);
        if (options.length > 0 && !selectedModelId) {
          setSelectedModelId(options[0].id);
        }
      })
      .catch(() => {});
  }, [adapter, agentId, selectedModelId]);

  useEffect(() => {
    if (view.name !== 'chat') return;
    if (activeConversation?.id === view.conversationId && messages.length > 0) return;
    const target = conversations.find((item) => item.id === view.conversationId);
    if (target) {
      void loadConversation(target);
    }
  }, [activeConversation?.id, conversations, loadConversation, messages.length, view]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, permissionRequest]);

  const updateAssistantMessage = useCallback((messageId: string, event: WorkbenchStreamEvent) => {
    setMessages((items) =>
      items.map((message) => {
        if (message.id !== messageId) return message;
        if (event.type === 'chunk') {
          return {
            ...message,
            content: `${message.content}${event.content ?? ''}`,
            status: 'streaming',
          };
        }
        if (event.type === 'final') {
          return {
            ...message,
            content: event.content || message.content,
            status: 'complete',
          };
        }
        if (event.type === 'error') {
          return {
            ...message,
            content: event.error ?? 'Agent stream failed',
            status: 'error',
            kind: 'error',
          };
        }
        return message;
      }),
    );
  }, []);

  const sendPrompt = useCallback(
    async (overridePrompt?: string) => {
      if (!agentId || streaming) return;
      const content = (overridePrompt ?? prompt).trim();
      if (!content) return;

      // Check if variable form should be shown first
      if (
        !overridePrompt &&
        agent?.variables &&
        agent.variables.length > 0 &&
        messages.length === 0 &&
        !showVariableForm
      ) {
        setShowVariableForm(true);
        return;
      }

      setPrompt('');
      setError(null);
      setPermissionRequest(null);
      setSuggestQuestions([]);
      setShowVariableForm(false);
      setStreaming(true);

      let assistantId: string | null = null;
      try {
        const conversation =
          activeConversation ?? (await createConversation(content.slice(0, 48)));
        const userMessage: WorkbenchMessage = {
          id: createLocalId('user'),
          conversationId: conversation.id,
          role: 'user',
          content,
          createdAt: nowIso(),
          kind: 'text',
          status: 'complete',
        };
        assistantId = createLocalId('assistant');
        const assistantMessage: WorkbenchMessage = {
          id: assistantId,
          conversationId: conversation.id,
          role: 'assistant',
          content: '',
          createdAt: nowIso(),
          kind: 'text',
          status: 'streaming',
        };
        setMessages((items) => [...items, userMessage, assistantMessage]);

        const requestId = createLocalId('req');
        setActiveRequestId(requestId);
        for await (const streamEvent of adapter.sendMessage({
          agentId,
          conversationId: conversation.id,
          content,
          requestId,
          variableParams: Object.keys(variableParams).length > 0 ? variableParams : undefined,
          modelId: selectedModelId,
          agentMode,
        })) {
          if (streamEvent.type === 'thought') {
            setMessages((items) => [
              ...items,
              {
                id: createLocalId('thought'),
                conversationId: conversation.id,
                role: 'assistant',
                content: streamEvent.content ?? '',
                createdAt: nowIso(),
                kind: 'thought',
                status: 'complete',
              },
            ]);
            continue;
          }
          if (streamEvent.type === 'permission' && streamEvent.permission) {
            setPermissionRequest(streamEvent.permission);
            continue;
          }
          updateAssistantMessage(assistantId, streamEvent);
        }
        setConversations((items) =>
          items.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  title:
                    item.title === labels.newConversation || item.title === 'Untitled session'
                      ? content.slice(0, 48)
                      : item.title,
                  updatedAt: nowIso(),
                }
              : item,
          ),
        );

        // Fetch suggest questions after stream completes
        if (adapter.getSuggestQuestions) {
          try {
            const suggestions = await adapter.getSuggestQuestions(
              conversation.id,
              agentId,
              Object.keys(variableParams).length > 0 ? variableParams : undefined,
            );
            if (suggestions.length > 0) setSuggestQuestions(suggestions);
          } catch {}
        }
      } catch (cause) {
        const nextError = reportError(cause, 'Send failed', { phase: 'sendMessage' });
        if (assistantId) {
          setMessages((items) =>
            items.map((message) =>
              message.id === assistantId
                ? { ...message, content: nextError, kind: 'error', status: 'error' }
                : message,
            ),
          );
        }
      } finally {
        setStreaming(false);
        setActiveRequestId(null);
      }
    },
    [
      activeConversation,
      adapter,
      agent,
      agentId,
      agentMode,
      createConversation,
      labels.newConversation,
      messages.length,
      prompt,
      reportError,
      selectedModelId,
      showVariableForm,
      streaming,
      updateAssistantMessage,
      variableParams,
    ],
  );

  const stopStream = useCallback(async () => {
    if (!agentId || !activeConversation) return;
    try {
      await adapter.stopChat?.(activeRequestId ?? activeConversation.id, {
        agentId,
        conversationId: activeConversation.id,
      });
    } catch (cause) {
      reportError(cause, 'Stop failed', { phase: 'stopChat' });
    }
  }, [activeConversation, activeRequestId, adapter, agentId, reportError]);

  const answerPermission = useCallback(
    async (choiceId: string) => {
      if (!permissionRequest || !activeConversation) return;
      try {
        await adapter.respondPermission?.(permissionRequest.id, choiceId, {
          agentId,
          conversationId: activeConversation.id,
        });
        setPermissionRequest(null);
      } catch (cause) {
        reportError(cause, 'Permission response failed', {
          phase: 'respondPermission',
          permissionId: permissionRequest.id,
        });
      }
    },
    [activeConversation, adapter, agentId, permissionRequest, reportError],
  );

  const openPreview = useCallback(
    (path: string) => {
      const url = buildPreviewUrl(config.baseUrl, path);
      if (url) setPreviewUrl(url);
    },
    [config.baseUrl],
  );

  useEffect(() => {
    if (!agent || previewUrl) return;
    const autoOpenKey = `openApp:autoOpenedDefaultPage:${agentId}`;
    if (sessionStorage.getItem(autoOpenKey)) return;
    const defaultPage = agent.customPageMenus?.find((item) => item.selected && item.path);
    if (defaultPage?.path) {
      sessionStorage.setItem(autoOpenKey, '1');
      openPreview(defaultPage.path);
    }
  }, [agent, agentId, openPreview, previewUrl]);

  const openEditor = useCallback(async () => {
    await config.hostBridge?.onOpenEditor?.({
      agentId,
      conversationId: activeConversation?.id,
    });
  }, [activeConversation?.id, agentId, config.hostBridge]);

  const renameConversation = useCallback(
    async (conversation: WorkbenchConversation) => {
      const nextTitle = window.prompt(labels.renamePrompt, conversation.title)?.trim();
      if (!nextTitle) return;
      try {
        const updated =
          (await adapter.updateConversation?.(conversation.id, { topic: nextTitle })) ?? {
            ...conversation,
            title: nextTitle,
          };
        setConversations((items) =>
          items.map((item) =>
            item.id === conversation.id ? { ...item, ...updated, title: updated.title || nextTitle } : item,
          ),
        );
      } catch (cause) {
        reportError(cause, 'Rename failed', { phase: 'updateConversation' });
      }
    },
    [adapter, labels.renamePrompt, reportError],
  );

  const deleteConversation = useCallback(
    async (conversation: WorkbenchConversation) => {
      if (!window.confirm(labels.deleteConfirm)) return;
      try {
        await adapter.deleteConversation?.(conversation.id);
        setConversations((items) => items.filter((item) => item.id !== conversation.id));
        if (activeConversation?.id === conversation.id) {
          setActiveConversation(null);
          setMessages([]);
          await navigate({ name: 'app' });
        }
      } catch (cause) {
        reportError(cause, 'Delete failed', { phase: 'deleteConversation' });
      }
    },
    [activeConversation?.id, adapter, labels.deleteConfirm, navigate, reportError],
  );

  const filteredConversations = useMemo(() => {
    const keyword = historyKeyword.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [conversations, historyKeyword]);

  if (!agentId) {
    return (
      <div className="nuwax-open-app">
        <div className="open-app-missing">Agent configuration missing</div>
      </div>
    );
  }

  const showHome = view.name === 'app' && messages.length === 0;
  const currentMessages = messages;

  return (
    <div className="nuwax-open-app">
      {mode === 'mock' && (
        <div className="open-app-mode-notice">
          {missingConfig.length > 0 ? labels.missingToken : labels.mockMode}
        </div>
      )}
      <div className="open-app-base-template">
        <aside className={sidebarVisible ? 'open-app-sidebar' : 'open-app-sidebar collapsed'}>
          <header className="open-app-sidebar-top">
            <div className="open-app-agent-title">
              <AgentAvatar agent={agent} />
              <span>{agent?.name ?? `Agent ${agentId}`}</span>
            </div>
            <IconButton title={labels.collapseNav} icon="sidebar" onClick={() => setSidebarVisible(false)} />
          </header>

          {sidebarVisible ? (
            <>
              <button className="open-app-new-session" type="button" onClick={openNewConversation}>
                <Icon name="plus" />
                <span>{labels.newConversation}</span>
                <span className="open-app-shortcut">
                  {typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'}
                </span>
                <span className="open-app-shortcut">J</span>
              </button>

              {agent?.customPageMenus && agent.customPageMenus.length > 0 && (
                <nav className="open-app-page-nav">
                  {agent.customPageMenus.map((item, index) => {
                    const url = buildPreviewUrl(config.baseUrl, item.path ?? '');
                    const active = previewUrl === url;
                    return (
                      <button
                        key={`${item.name}-${index}`}
                        type="button"
                        className={active ? 'open-app-page-nav-item active' : 'open-app-page-nav-item'}
                        onClick={() => openPreview(item.path ?? '')}
                      >
                        <span className="open-app-page-icon">
                          <Icon name="page" />
                        </span>
                        <span>{item.name}</span>
                      </button>
                    );
                  })}
                </nav>
              )}

              <div className="open-app-history-title">
                <span>
                  <span className="open-app-section-icon">
                    <Icon name="history" />
                  </span>
                  {labels.historyConversation}
                </span>
                {conversations.length > 0 && (
                  <button type="button" onClick={() => void navigate({ name: 'history' })}>
                    {labels.viewAll} &gt;
                  </button>
                )}
              </div>
              <div className="open-app-history-list">
                {loadingHistory && <div className="open-app-history-empty">Loading...</div>}
                {!loadingHistory && conversations.length === 0 && (
                  <div className="open-app-history-empty">{labels.firstConversationTip}</div>
                )}
                {conversations.slice(0, 8).map((item) => (
                  <ConversationItem
                    key={item.id}
                    item={item}
                    active={activeConversation?.id === item.id}
                    onClick={() => void loadConversation(item)}
                  />
                ))}
              </div>
            </>
          ) : (
            <button
              className="open-app-sidebar-expand"
              type="button"
              title={labels.expandNav}
              onClick={() => setSidebarVisible(true)}
            >
              <Icon name="sidebar" />
            </button>
          )}

          <footer className="open-app-user-area">
            <div className="open-app-user-avatar">U</div>
            <span>{config.userId ?? 'User'}</span>
          </footer>
        </aside>

        <main className="open-app-main">
          {view.name === 'history' ? (
            <section className="open-app-history-page">
              <button className="open-app-close-history" type="button" onClick={() => void navigate({ name: 'app' })}>
                x
              </button>
              <h1>{labels.historyTitle}</h1>
              <input
                value={historyKeyword}
                onChange={(event) => setHistoryKeyword(event.target.value)}
                placeholder={labels.searchPlaceholder}
              />
              <div className="open-app-history-page-list">
                {filteredConversations.map((item) => (
                  <div className="open-app-history-page-item" key={item.id} onClick={() => void loadConversation(item)}>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.metadata && typeof item.metadata.summary === 'string' ? item.metadata.summary : ''}</p>
                    </div>
                    <div className="open-app-history-page-actions">
                      <span>{formatTime(item.updatedAt)}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void renameConversation(item);
                        }}
                      >
                        {labels.rename}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteConversation(item);
                        }}
                      >
                        {labels.delete}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="open-app-chat-shell">
              <header className="open-app-chat-header">
                {!sidebarVisible && (
                  <IconButton title={labels.expandNav} icon="sidebar" onClick={() => setSidebarVisible(true)} />
                )}
                <span>
                  {loadingDetail
                    ? 'Loading...'
                    : applyTemplate(labels.emptyTitle, { name: agent?.name ?? `Agent ${agentId}` })}
                </span>
                <button type="button" onClick={() => void openEditor()} disabled={!config.hostBridge?.onOpenEditor}>
                  {labels.openEditor}
                </button>
              </header>
              {error && <div className="open-app-error">{error}</div>}
              <div
                ref={splitContainerRef}
                className={previewUrl ? 'open-app-chat-preview-split' : 'open-app-chat-preview-split no-preview'}
                style={
                  previewUrl
                    ? {
                        gridTemplateColumns: `${splitRatio}fr ${1 - splitRatio}fr`,
                        cursor: isDragging ? 'col-resize' : undefined,
                        userSelect: isDragging ? 'none' : undefined,
                      }
                    : undefined
                }
              >
                <div className="open-app-chat-left">
                  <div className="open-app-chat-body" ref={transcriptRef}>
                    {currentMessages.length > 0 ? (
                      currentMessages.map((message) => (
                        <ChatMessage key={message.id} message={message} agent={agent} />
                      ))
                    ) : (
                      <AgentChatEmpty agent={agent} labels={labels} agentId={agentId} />
                    )}
                    {agent?.guidQuestionDtos && agent.guidQuestionDtos.length > 0 && messages.length === 0 && (
                      <div className="open-app-recommend-list">
                        {agent.guidQuestionDtos.map((item, index) => {
                          const text = questionText(item);
                          if (!text) return null;
                          return (
                            <button key={`${text}-${index}`} type="button" onClick={() => void sendPrompt(text)}>
                              {text}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {permissionRequest && (
                    <PermissionCard request={permissionRequest} labels={labels} onRespond={answerPermission} />
                  )}
                  {showVariableForm && agent?.variables && agent.variables.length > 0 && (
                    <VariableForm
                      variables={agent.variables}
                      labels={labels}
                      onSubmit={(params) => {
                        setVariableParams(params);
                        setShowVariableForm(false);
                        void sendPrompt();
                      }}
                      onCancel={() => setShowVariableForm(false)}
                    />
                  )}
                  {suggestQuestions.length > 0 && (
                    <div className="open-app-recommend-list">
                      {suggestQuestions.map((text, index) => (
                        <button key={`${text}-${index}`} type="button" onClick={() => void sendPrompt(text)}>
                          {text}
                        </button>
                      ))}
                    </div>
                  )}
                  <ChatInputHome
                    value={prompt}
                    labels={labels}
                    disabled={!agent || agent.hasPermission === false}
                    streaming={streaming}
                    agentMode={agentMode}
                    selectedModelId={selectedModelId}
                    modelOptions={modelOptions}
                    showModelDropdown={showModelDropdown}
                    onChange={setPrompt}
                    onSubmit={() => void sendPrompt()}
                    onStop={() => void stopStream()}
                    onModeChange={setAgentMode}
                    onModelSelect={setSelectedModelId}
                    onToggleModelDropdown={() => setShowModelDropdown((v) => !v)}
                  />
                  <div className="open-app-ai-notice">{labels.contentGenerated}</div>
                </div>
                {previewUrl && (
                  <>
                    <div
                      className="open-app-split-handle"
                      onMouseDown={onSplitDragStart}
                    />
                    <div className="open-app-chat-right">
                    <PagePreviewIframe
                      url={previewUrl}
                      title={labels.pagePreview}
                      labels={labels}
                      previewContainer={config.previewContainer}
                      onClose={() => setPreviewUrl(null)}
                    />
                  </div>
                  </>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
