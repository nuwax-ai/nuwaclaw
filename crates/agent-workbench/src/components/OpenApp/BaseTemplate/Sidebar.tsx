import { useState } from 'react';
import { ChatConversationList } from '@nuwax-ai/chat-kit/react';
import type { WorkbenchAgentDetail, WorkbenchConversation, WorkbenchCustomPageNavItem } from '../../../types';
import { AgentAvatar, Icon, IconButton } from '../icons';
import { toChatConversation } from '../../../adapters/chatKitAdapter';
import { buildPreviewUrl } from '../utils';
import { AccountDock } from './AccountDock';
import type { WorkbenchApiAdapter, WorkbenchHostBridge } from '../../../types';

export interface SidebarLabels {
  collapseNav: string;
  expandNav: string;
  newConversation: string;
  historyConversation: string;
  viewAll: string;
  firstConversationTip: string;
}

export interface SidebarProps {
  visible: boolean;
  onToggle: (visible: boolean) => void;
  agent: WorkbenchAgentDetail | null;
  agentId: string;
  /** Already-sliced recent conversations to render (caller controls the slice size). */
  recentConversations: WorkbenchConversation[];
  /** Total conversation count, used to decide whether to show the "view all" button. */
  totalConversationCount: number;
  activeConversation: WorkbenchConversation | null;
  previewUrl: string | null;
  loadingHistory: boolean;
  baseUrl: string | undefined;
  userId: string | undefined;
  customPages?: WorkbenchCustomPageNavItem[];
  onNewConversation: () => void | Promise<void>;
  onLoadConversation: (c: WorkbenchConversation) => void | Promise<void>;
  onOpenPreview: (path: string) => void;
  onNavigateHistory: () => void;
  labels: SidebarLabels;
  workspaceMode: 'work' | 'chat';
  adapter: WorkbenchApiAdapter;
  hostBridge?: WorkbenchHostBridge;
  locale?: string;
}

const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function WorkspaceModeSwitch({
  value,
  onChange,
}: {
  value: 'work' | 'chat';
  onChange: (mode: 'work' | 'chat') => void;
}): JSX.Element {
  return (
    <div className="open-app-workspace-switch" role="tablist" aria-label="Workspace mode">
      <button type="button" className={value === 'work' ? 'active' : ''} onClick={() => onChange('work')}>
        <span aria-hidden="true">▣</span> Work
      </button>
      <button type="button" className={value === 'chat' ? 'active' : ''} onClick={() => onChange('chat')}>
        <span aria-hidden="true">◌</span> Chat
      </button>
    </div>
  );
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const {
    visible,
    onToggle,
    agent,
    agentId,
    recentConversations,
    totalConversationCount,
    activeConversation,
    previewUrl,
    loadingHistory,
    baseUrl,
    userId,
    customPages,
    onNewConversation,
    onLoadConversation,
    onOpenPreview,
    onNavigateHistory,
    labels,
    workspaceMode,
    adapter,
    hostBridge,
    locale,
  } = props;

  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <aside className={visible ? 'open-app-sidebar' : 'open-app-sidebar collapsed'}>
      <header className="open-app-sidebar-top">
        <div
 className="open-app-agent-title"
 onClick={() => setDetailOpen((v) => !v)}
 role="button"
 tabIndex={0}
 style={{ cursor: 'pointer' }}
 title={agent?.description ?? agent?.name}
 >
          <AgentAvatar agent={agent} />
          <span>{agent?.name ?? `Agent ${agentId}`}</span>
        </div>
        <IconButton title={labels.collapseNav} icon="sidebar" onClick={() => onToggle(false)} />
      </header>
      {visible && detailOpen && (agent?.description || agent?.openingChatMsg) && (
        <div className="open-app-agent-detail">
          {agent?.description && (
            <p className="open-app-agent-description">{agent.description}</p>
          )}
          {agent?.openingChatMsg && (
            <p className="open-app-agent-opening">{agent.openingChatMsg}</p>
          )}
        </div>
      )}

      {visible && workspaceMode === 'work' ? (
        <>
          <button className="open-app-new-session" type="button" onClick={() => void onNewConversation()}>
            <Icon name="plus" />
            <span>{labels.newConversation}</span>
            <span className="open-app-shortcut">{isMac() ? '⌘' : 'Ctrl'}</span>
            <span className="open-app-shortcut">J</span>
          </button>

          <button
            className="open-app-mcp-config-entry"
            type="button"
            onClick={() => void hostBridge?.onOpenConfigPage?.('mcp')}
          >
            <Icon name="tools" />
            <span>{locale?.toLowerCase().startsWith('en') ? 'MCP configuration' : 'MCP 配置'}</span>
          </button>

          {customPages && customPages.length > 0 && (
            <nav className="open-app-page-nav">
              {customPages.map((item, index) => {
                const url = buildPreviewUrl(baseUrl, item.path ?? '');
                const active = previewUrl === url;
                return (
                  <button
                    key={`${item.name}-${index}`}
                    type="button"
                    className={active ? 'open-app-page-nav-item active' : 'open-app-page-nav-item'}
                    onClick={() => onOpenPreview(item.path ?? '')}
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
            {totalConversationCount > 0 && (
              <button type="button" onClick={onNavigateHistory}>
                {labels.viewAll} &gt;
              </button>
            )}
          </div>
          {loadingHistory ? (
            <div className="open-app-history-list">
              <div className="open-app-history-empty">Loading...</div>
            </div>
          ) : (
            <ChatConversationList
              className="open-app-history-list"
              conversations={recentConversations.map(toChatConversation)}
              activeConversationId={activeConversation?.id}
              empty={<div className="open-app-history-empty">{labels.firstConversationTip}</div>}
              buttonClassName={(conversation) =>
                conversation.id === activeConversation?.id
                  ? 'open-app-conversation-item active'
                  : 'open-app-conversation-item'
              }
              onSelect={(conversation) => {
                const source = recentConversations.find((item) => item.id === conversation.id);
                if (source) void onLoadConversation(source);
              }}
            />
          )}
        </>
      ) : !visible ? (
        <button
          className="open-app-sidebar-expand"
          type="button"
          title={labels.expandNav}
          onClick={() => onToggle(true)}
        >
          <Icon name="sidebar" />
        </button>
      ) : <div className="open-app-sidebar-chat-spacer" />}

      {visible && (
        <AccountDock
          adapter={adapter}
          hostBridge={hostBridge}
          fallbackUserId={userId}
          locale={locale}
          agentId={agentId}
        />
      )}
    </aside>
  );
}
