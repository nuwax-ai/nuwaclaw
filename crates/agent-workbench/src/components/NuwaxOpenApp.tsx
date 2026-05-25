import {
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
  WorkbenchModelOption,
  WorkbenchSkillOption,
  WorkbenchUploadedFile,
} from '../types';
import { useAgentWorkbenchContext } from './AgentWorkbenchProvider';
import { HistoryConversation } from './OpenApp/HistoryConversation';
import { Sidebar } from './OpenApp/BaseTemplate/Sidebar';
import { ChatArea } from './OpenApp/BaseTemplate/ChatArea';
import { PreviewPane } from './OpenApp/BaseTemplate/PreviewPane';
import { useConversation } from './OpenApp/hooks/useConversation';
import { Icon, IconButton } from './OpenApp/icons';
import { en, zh, type Labels } from './OpenApp/labels';
import {
  applyTemplate,
  buildPreviewUrl,
  fallbackAgent,
  nowIso,
} from './OpenApp/utils';

// Re-export for backward compatibility: business-component re-exports and
// extracted subcomponents (Sidebar/ChatArea) historically imported these
// helpers from NuwaxOpenApp.
export { buildPreviewUrl, questionText } from './OpenApp/utils';

export { ChatInputHome } from './ChatInputHome';

// Re-exported so existing consumers (tests, electron-client) keep working
// without churn. The canonical source is now `OpenApp/labels.ts`.
export const nuwaxOpenAppLabelsZh = zh;

type OpenAppView =
  | { name: 'app' }
  | { name: 'chat'; conversationId: string }
  | { name: 'history' };

export function PagePreviewIframe({
  url,
  title,
  labels = zh,
  previewContainer,
  hostBridge,
  onClose,
}: {
  url: string;
  title: string;
  labels?: Labels;
  previewContainer?: string;
  hostBridge?: import('../types').WorkbenchHostBridge;
  onClose: () => void;
}) {
  const [frameKey, setFrameKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userAgent, setUserAgent] = useState<string | undefined>();
  const [previewPreload, setPreviewPreload] = useState<string | undefined>();
  const webviewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ua = await hostBridge?.getPreviewUserAgent?.();
      if (!cancelled && ua) setUserAgent(ua);
      const preload = await hostBridge?.getPreviewPreloadPath?.();
      if (!cancelled && typeof preload === 'string' && preload.length > 0) {
        setPreviewPreload(preload);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostBridge]);

  useEffect(() => {
    if (previewContainer !== 'electron-webview') return;
    const el = webviewRef.current as
      | (HTMLElement & {
          addEventListener: (type: string, listener: (e: unknown) => void) => void;
          removeEventListener: (type: string, listener: (e: unknown) => void) => void;
        })
      | null;
    if (!el) return;

    const onFailLoad = (event: unknown) => {
      const e = event as { errorCode?: number; errorDescription?: string };
      if (e.errorCode && e.errorCode !== -3) {
        setLoadError(e.errorDescription ?? `Load failed (${e.errorCode})`);
      }
    };
    const onStartLoading = () => setLoadError(null);
    const onWillDownload = (event: unknown) => {
      const e = event as { url?: string; filename?: string };
      if (!e.url) return;
      hostBridge?.onPreviewDownload?.({ url: e.url, filename: e.filename });
    };
    const onNewWindow = (event: unknown) => {
      const e = event as { url?: string; preventDefault?: () => void };
      if (!e.url) return;
      const decision = hostBridge?.onPreviewNewWindow?.(e.url) ?? 'open-external';
      if (decision === 'deny' || decision === 'open-external') {
        try {
          e.preventDefault?.();
        } catch {
          // ignore
        }
        if (decision === 'open-external') {
          hostBridge?.onPreviewDownload?.({ url: e.url });
        }
      }
    };

    el.addEventListener('did-fail-load', onFailLoad);
    el.addEventListener('did-start-loading', onStartLoading);
    el.addEventListener('will-download', onWillDownload);
    el.addEventListener('new-window', onNewWindow);
    return () => {
      el.removeEventListener('did-fail-load', onFailLoad);
      el.removeEventListener('did-start-loading', onStartLoading);
      el.removeEventListener('will-download', onWillDownload);
      el.removeEventListener('new-window', onNewWindow);
    };
  }, [frameKey, previewContainer, url, hostBridge]);

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
      {loadError ? (
        <div className="open-app-page-preview-error" role="alert">
          {loadError}
        </div>
      ) : null}
      <div className="open-app-page-preview-body">
        {previewContainer === 'electron-webview'
          ? createElement('webview', {
              key: frameKey,
              ref: webviewRef,
              className: 'open-app-page-preview-frame',
              src: url,
              useragent: userAgent,
              allowpopups: 'true',
              // 持久化命名 partition：与主窗口 defaultSession 隔离，但 cookie/LS 跨重启留存。
              // partition 由 hostBridge 决定，host 不提供时回退到固定常量。
              partition: 'persist:workbench-preview',
              // preload 路径由 host 通过 IPC 提供，缺省时 webview 仍可用，
              // 只是失去 cookie 注入 / 下载拦截能力。
              preload: previewPreload,
            })
          : (
              <iframe key={frameKey} className="open-app-page-preview-frame" src={url} title={title} />
            )}
      </div>
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

  const urlParams = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const search = new URLSearchParams(window.location.search);
    const raw = search.get('params');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
      } catch {
        return null;
      }
    }
    if (search.has('prompt') || search.has('message')) {
      return Object.fromEntries(search.entries());
    }
    return null;
  }, []);

  const [view, setView] = useState<OpenAppView>(initialRoute);
  const [agent, setAgent] = useState<WorkbenchAgentDetail | null>(null);
  const [conversations, setConversations] = useState<WorkbenchConversation[]>([]);
  const [prompt, setPrompt] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
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
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<WorkbenchSkillOption[]>([]);
  const [splitRatio, setSplitRatio] = useState(0.42);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------
  // Conversation state hub — owns messages / streaming / permission /
  // pagination cursor. Phase B step 5 hook; see OpenApp/hooks/useConversation.
  // ---------------------------------------------------------------------
  const reportErrorRef = useRef<(cause: unknown, msg: string, ctx: Record<string, unknown>) => string>(
    () => '',
  );
  const conv = useConversation({
    adapter,
    agentId,
    onError: (cause, context) =>
      reportErrorRef.current(cause, 'Conversation action failed', context ?? {}),
  });
  const {
    activeConversation,
    messages,
    streaming,
    permissionRequest,
    hasMoreMessages,
    loadingMoreMessages,
  } = conv;

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

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
  // Keep the ref in sync so useConversation's onError can route through the
  // same `reportError` without forcing the hook to depend on its identity.
  useEffect(() => {
    reportErrorRef.current = reportError;
  }, [reportError]);

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

  // Wrap the hook's loadConversation to also navigate to the chat route and
  // clear any local error banner. The hook owns the messages/cursor state.
  const loadConversation = useCallback(
    async (conversation: WorkbenchConversation) => {
      setError(null);
      await conv.loadConversation(conversation);
      // After hook load, the activeConversation in state may be the rehydrated
      // detail; navigate to the original conversation id which is stable.
      await navigate({ name: 'chat', conversationId: conversation.id });
    },
    [conv, navigate],
  );

  // Skill listing is now driven by MentionPopup inside ChatInputHome, which
  // calls adapter.listSkillsForAtPaged / listRecentSkills / listCollectedSkills
  // directly. NuwaxOpenApp only retains the currently-selected skill ids/objects.

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = transcriptRef.current;
    if (!sentinel || !root || view.name !== 'chat') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void conv.loadMoreMessages();
        }
      },
      { root, rootMargin: '0px', threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [conv, view.name]);

  // Wrap hook.createConversation so the parent's conversations list and the
  // route are also updated. The hook itself only owns the active conversation.
  const createConversation = useCallback(
    async (title?: string) => {
      const conversation = await conv.createConversation(title);
      setConversations((items) => [
        conversation,
        ...items.filter((item) => item.id !== conversation.id),
      ]);
      await navigate({ name: 'chat', conversationId: conversation.id });
      return conversation;
    },
    [conv, navigate],
  );

  const openNewConversation = useCallback(async () => {
    try {
      await createConversation(labels.newConversation);
    } catch (cause) {
      console.error('[NuwaxOpenApp] createConversation failed:', cause);
      reportError(cause, 'Failed to create conversation', { phase: 'createConversation' });
    }
  }, [agentId, createConversation, labels.newConversation, reportError]);

  useEffect(() => {
    if (!agentId) return;
    // Skip if same agent already loaded to avoid redundant fetch
    if ((agent?.agentId ?? null) === agentId) return;
    setLoadingDetail(true);
    setError(null);
    (adapter.getAgentDetail?.(agentId) ?? Promise.resolve(fallbackAgent(agentId)))
      .then((detail) => {
        setAgent(detail);
        const existingConversationId = detail.conversationId;
        // If the agent detail surfaces an existing conversation id and no
        // route is already targeting one, route to it so the hook's chat
        // load effect picks it up uniformly. Use the functional updater so
        // we read the latest view without putting it in the deps array.
        if (existingConversationId) {
          setView((current) =>
            current.name === 'chat'
              ? current
              : { name: 'chat', conversationId: existingConversationId },
          );
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
        if (options.length > 0) {
          setSelectedModelId((current) => current ?? options[0].id);
        }
      })
      .catch((err) => {
        console.warn('[agent-workbench] Failed to load model options:', err);
      });
  }, [adapter, agentId]);

  const urlParamsAppliedRef = useRef(false);
  useEffect(() => {
    if (!urlParams || urlParamsAppliedRef.current || !agent) return;
    urlParamsAppliedRef.current = true;
    const { prompt: urlPrompt, message: urlMessage, ...rest } = urlParams as Record<string, unknown>;
    const vars = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined && v !== null),
    );
    if (Object.keys(vars).length > 0) {
      setVariableParams(vars);
    }
    const autoText = typeof urlPrompt === 'string'
      ? urlPrompt
      : typeof urlMessage === 'string'
        ? urlMessage
        : '';
    if (autoText) {
      setPrompt(autoText);
    }
  }, [agent, urlParams]);

  const loadedConversationRef = useRef<string | null>(null);
  useEffect(() => {
    if (view.name !== 'chat') return;
    if (loadedConversationRef.current === view.conversationId) return;
    if (activeConversation?.id === view.conversationId && messages.length > 0) {
      loadedConversationRef.current = view.conversationId;
      return;
    }
    const target = conversations.find((item) => item.id === view.conversationId);
    if (target) {
      loadedConversationRef.current = view.conversationId;
      void loadConversation(target);
    }
  }, [activeConversation?.id, conversations, loadConversation, messages.length, view]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, permissionRequest]);

  // sendPrompt wraps the hook's sendPrompt action with the parent-level
  // concerns: variable-form gating, input/skill reset, conversations list
  // bookkeeping, suggest-question fetch, and attachment validation. The
  // hook owns the message stream + activeRequestId + permission state.
  const sendPrompt = useCallback(
    async (
      overridePrompt?: string,
      overrideVariableParams?: Record<string, unknown>,
      overrideUploaded?: WorkbenchUploadedFile[],
    ) => {
      if (!agentId || streaming) return;
      const content = (overridePrompt ?? prompt).trim();
      if (!content) return;

      // Variable form gating mirrors the legacy behaviour: when the agent
      // declares required variables, show the form first and let the user
      // fill it in. Submitting the form re-enters this function with
      // `overrideVariableParams`.
      if (
        !overridePrompt &&
        !overrideVariableParams &&
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
      setSuggestQuestions([]);
      setShowVariableForm(false);
      const currentSkillIds = selectedSkillIds.length > 0 ? selectedSkillIds : undefined;
      setSelectedSkillIds([]);
      setSelectedSkills([]);

      // ChatInputHome's ChatUploadFile component returns already-uploaded
      // files; we never re-upload here. Validate the wire shape (key + url)
      // before forwarding, mirroring nuwax's AttachmentFile contract.
      const attachmentPayload: WorkbenchUploadedFile[] | undefined =
        overrideUploaded && overrideUploaded.length > 0 ? overrideUploaded : undefined;
      if (attachmentPayload) {
        const incomplete = attachmentPayload.some(
          (item) => !item.key?.trim() || !item.url?.trim(),
        );
        if (incomplete) {
          reportError(
            new Error(labels.attachmentUploadIncomplete),
            'Send failed',
            { phase: 'sendMessage', reason: 'attachmentIncomplete' },
          );
          return;
        }
      }

      // Ensure we have a target conversation before kicking off the stream.
      // The hook can create one for us, but the parent needs the id up
      // front so the conversations list can be updated optimistically.
      const conversation =
        activeConversation ?? (await createConversation(content.slice(0, 48)));

      const mergedVariableParams = (() => {
        const params = overrideVariableParams ?? variableParams;
        return Object.keys(params).length > 0 ? params : undefined;
      })();

      try {
        await conv.sendPrompt({
          content,
          conversationId: conversation.id,
          variableParams: mergedVariableParams,
          modelId: selectedModelId,
          agentMode,
          attachments: attachmentPayload,
          skillIds: currentSkillIds,
        });

        // Update the conversation list: rename if still on the placeholder
        // title and bump updatedAt so the sidebar reflects activity.
        setConversations((items) =>
          items.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  title:
                    item.title === labels.newConversation || item.title === labels.untitledSession
                      ? content.slice(0, 48)
                      : item.title,
                  updatedAt: nowIso(),
                }
              : item,
          ),
        );

        // Fetch suggest questions after stream completes. Failures here are
        // non-fatal — the empty-state remains rendered.
        if (adapter.getSuggestQuestions) {
          try {
            const suggestions = await adapter.getSuggestQuestions(
              conversation.id,
              agentId,
              mergedVariableParams,
              content,
            );
            if (suggestions.length > 0) setSuggestQuestions(suggestions);
          } catch (err) {
            console.warn('[agent-workbench] Failed to load suggest questions:', err);
          }
        }
      } catch (cause) {
        // The hook also calls onError (which goes through reportError via
        // the ref); we still surface the banner explicitly so the user sees
        // the failure even if the hook's stream loop already finished.
        reportError(cause, 'Send failed', { phase: 'sendMessage' });
      }
    },
    [
      activeConversation,
      adapter,
      agent,
      agentId,
      agentMode,
      conv,
      createConversation,
      labels.attachmentUploadIncomplete,
      labels.newConversation,
      labels.untitledSession,
      messages.length,
      prompt,
      reportError,
      selectedModelId,
      selectedSkillIds,
      showVariableForm,
      streaming,
      variableParams,
    ],
  );

  const stopStream = useCallback(() => conv.stopStream(), [conv]);

  const answerPermission = useCallback(
    (choiceId: string) => conv.answerPermission(choiceId),
    [conv],
  );

  const openPreview = useCallback(
    async (path: string) => {
      const url = buildPreviewUrl(config.baseUrl, path);
      if (!url) return;
      try {
        await config.hostBridge?.onBeforePreviewLoad?.(url);
      } catch (cause) {
        reportError(cause, 'Preview auth sync failed', { phase: 'onBeforePreviewLoad', url });
      }
      setPreviewUrl(url);
    },
    [config.baseUrl, config.hostBridge, reportError],
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

  const handleFilePreview = useCallback(
    (fileId: string, context?: { conversationId?: string }) => {
      void config.hostBridge?.onFilePreview?.(fileId, context);
    },
    [config.hostBridge],
  );

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
          // Clear the hook's messages/active conversation/permission so the
          // chat view doesn't render against the deleted conversation.
          conv.reset();
          await navigate({ name: 'app' });
        }
      } catch (cause) {
        reportError(cause, 'Delete failed', { phase: 'deleteConversation' });
      }
    },
    [activeConversation?.id, adapter, conv, labels.deleteConfirm, navigate, reportError],
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

  return (
    <div className="nuwax-open-app">
      {mode === 'mock' && (
        <div className="open-app-mode-notice">
          {missingConfig.length > 0 ? labels.missingToken : labels.mockMode}
        </div>
      )}
      <div className="open-app-base-template">
        <Sidebar
          visible={sidebarVisible}
          onToggle={setSidebarVisible}
          agent={agent}
          agentId={agentId}
          recentConversations={conversations.slice(0, 8)}
          totalConversationCount={conversations.length}
          activeConversation={activeConversation}
          previewUrl={previewUrl}
          loadingHistory={loadingHistory}
          baseUrl={config.baseUrl}
          userId={config.userId}
          customPages={agent?.customPageMenus}
          onNewConversation={openNewConversation}
          onLoadConversation={loadConversation}
          onOpenPreview={openPreview}
          onNavigateHistory={() => void navigate({ name: 'history' })}
          labels={{
            collapseNav: labels.collapseNav,
            expandNav: labels.expandNav,
            newConversation: labels.newConversation,
            historyConversation: labels.historyConversation,
            viewAll: labels.viewAll,
            firstConversationTip: labels.firstConversationTip,
          }}
        />

        <main className="open-app-main">
          {view.name === 'history' ? (
            <HistoryConversation
              conversations={conversations}
              historyKeyword={historyKeyword}
              onKeywordChange={setHistoryKeyword}
              onLoadConversation={loadConversation}
              onRenameConversation={renameConversation}
              onDeleteConversation={deleteConversation}
              onClose={() => void navigate({ name: 'app' })}
              filteredConversations={filteredConversations}
              labels={{
                historyTitle: labels.historyTitle,
                searchPlaceholder: labels.searchPlaceholder,
                rename: labels.rename,
                delete: labels.delete,
                firstConversationTip: labels.firstConversationTip,
              }}
            />
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
                      }
                    : undefined
                }
              >
                <ChatArea
                  agent={agent}
                  agentId={agentId}
                  adapter={adapter}
                  activeConversation={activeConversation}
                  messages={messages}
                  streaming={streaming}
                  permissionRequest={permissionRequest}
                  hasMoreMessages={hasMoreMessages}
                  loadingMoreMessages={loadingMoreMessages}
                  suggestQuestions={suggestQuestions}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  modelOptions={modelOptions}
                  selectedModelId={selectedModelId}
                  onSelectedModelIdChange={setSelectedModelId}
                  showModelDropdown={showModelDropdown}
                  onToggleModelDropdown={() => setShowModelDropdown((v) => !v)}
                  agentMode={agentMode}
                  onAgentModeChange={setAgentMode}
                  selectedSkillIds={selectedSkillIds}
                  onSelectedSkillIdsChange={setSelectedSkillIds}
                  selectedSkills={selectedSkills}
                  onSelectedSkillsChange={setSelectedSkills}
                  showVariableForm={showVariableForm}
                  onSendPrompt={(text) => void sendPrompt(text)}
                  onSubmitWithUploads={(uploaded) =>
                    void sendPrompt(undefined, undefined, uploaded)
                  }
                  onStopStream={() => void stopStream()}
                  onAnswerPermission={answerPermission}
                  onLoadMoreMessages={() => void conv.loadMoreMessages()}
                  onSubmitVariableForm={(params) => {
                    setVariableParams(params);
                    setShowVariableForm(false);
                    void sendPrompt(undefined, params);
                  }}
                  onCancelVariableForm={() => setShowVariableForm(false)}
                  transcriptRef={transcriptRef}
                  loadMoreSentinelRef={loadMoreSentinelRef}
                  onFilePreview={handleFilePreview}
                  conversationId={activeConversation?.id}
                  labels={labels}
                />
                <PreviewPane
                  previewUrl={previewUrl}
                  splitRatio={splitRatio}
                  onSplitRatioChange={setSplitRatio}
                  onClose={() => setPreviewUrl(null)}
                  containerRef={splitContainerRef}
                  hostBridge={config.hostBridge}
                  previewContainer={config.previewContainer}
                  labels={labels}
                />
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
