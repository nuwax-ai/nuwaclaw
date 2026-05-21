import type { WorkbenchAgentDetail, WorkbenchConversation, WorkbenchCustomPageNavItem } from '../../../types';
import { AgentAvatar, Icon, IconButton } from '../icons';
import { ConversationItem } from './ConversationItem';
import { buildPreviewUrl } from '../utils';

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
}

const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
  } = props;

  return (
    <aside className={visible ? 'open-app-sidebar' : 'open-app-sidebar collapsed'}>
      <header className="open-app-sidebar-top">
        <div className="open-app-agent-title">
          <AgentAvatar agent={agent} />
          <span>{agent?.name ?? `Agent ${agentId}`}</span>
        </div>
        <IconButton title={labels.collapseNav} icon="sidebar" onClick={() => onToggle(false)} />
      </header>

      {visible ? (
        <>
          <button className="open-app-new-session" type="button" onClick={() => void onNewConversation()}>
            <Icon name="plus" />
            <span>{labels.newConversation}</span>
            <span className="open-app-shortcut">{isMac() ? '⌘' : 'Ctrl'}</span>
            <span className="open-app-shortcut">J</span>
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
          <div className="open-app-history-list">
            {loadingHistory && <div className="open-app-history-empty">Loading...</div>}
            {!loadingHistory && totalConversationCount === 0 && (
              <div className="open-app-history-empty">{labels.firstConversationTip}</div>
            )}
            {recentConversations.map((item) => (
              <ConversationItem
                key={item.id}
                item={item}
                active={activeConversation?.id === item.id}
                onClick={() => void onLoadConversation(item)}
              />
            ))}
          </div>
        </>
      ) : (
        <button
          className="open-app-sidebar-expand"
          type="button"
          title={labels.expandNav}
          onClick={() => onToggle(true)}
        >
          <Icon name="sidebar" />
        </button>
      )}

      <footer className="open-app-user-area">
        <div className="open-app-user-avatar">U</div>
        <span>{userId ?? 'User'}</span>
      </footer>
    </aside>
  );
}
