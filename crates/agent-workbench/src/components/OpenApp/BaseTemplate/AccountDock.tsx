import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  WorkbenchApiAdapter,
  WorkbenchHostBridge,
  WorkbenchNotification,
  WorkbenchRemoteUser,
} from '../../../types';

interface AccountDockProps {
  adapter: WorkbenchApiAdapter;
  hostBridge?: WorkbenchHostBridge;
  fallbackUserId?: string;
  locale?: string;
  agentId: string;
}

export function AccountDock({ adapter, hostBridge, fallbackUserId, locale, agentId }: AccountDockProps) {
  const isEnglish = locale?.toLowerCase().startsWith('en') ?? false;
  const [user, setUser] = useState<WorkbenchRemoteUser | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<WorkbenchNotification[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingNotices, setLoadingNotices] = useState(false);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      adapter.getCurrentUser?.(),
      adapter.getCreditSummary?.(),
      adapter.getUnreadNotificationCount?.(),
    ]).then(([userResult, creditResult, unreadResult]) => {
      if (cancelled) return;
      if (userResult.status === 'fulfilled' && userResult.value) setUser(userResult.value);
      if (creditResult.status === 'fulfilled' && creditResult.value) {
        setCredits(creditResult.value.available);
      }
      if (unreadResult.status === 'fulfilled' && typeof unreadResult.value === 'number') {
        setUnread(unreadResult.value);
      }
    });
    return () => { cancelled = true; };
  }, [adapter]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setNoticeOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const openNotices = useCallback(async () => {
    const next = !noticeOpen;
    setNoticeOpen(next);
    setMenuOpen(false);
    if (!next || !adapter.listNotifications) return;
    setLoadingNotices(true);
    setNoticeError(null);
    try {
      const items = await adapter.listNotifications({ size: 100 });
      setNotifications(items);
      await adapter.clearUnreadNotifications?.();
      setUnread(0);
    } catch (cause) {
      setNoticeError(cause instanceof Error ? cause.message : (isEnglish ? 'Failed to load messages' : '消息加载失败'));
    } finally {
      setLoadingNotices(false);
    }
  }, [adapter, noticeOpen]);

  const displayName = user?.nickName || user?.userName || fallbackUserId || (isEnglish ? 'User' : '用户');
  const initial = displayName.slice(0, 1).toUpperCase();
  const navigate = (path: string) => void hostBridge?.onNavigateRemote?.(path);
  const appPath = (suffix: string) => `/app/${encodeURIComponent(agentId)}/${suffix}`;

  return (
    <footer className="open-app-account-dock" ref={rootRef}>
      <button className="open-app-credit-row" type="button" onClick={() => navigate(appPath('my-subscriptions'))}>
        <span>{isEnglish ? 'Credits' : '积分'}</span>
        <strong>{credits === null ? '--' : credits.toLocaleString()}</strong>
        <span className="open-app-credit-add">+</span>
      </button>
      <div className="open-app-account-row">
        <button
          className="open-app-account-user"
          type="button"
          onClick={() => { setMenuOpen((value) => !value); setNoticeOpen(false); }}
        >
          {user?.avatar ? <img src={user.avatar} alt="" /> : <span>{initial}</span>}
          <em>{displayName}</em>
        </button>
        <button className="open-app-notice-button" type="button" title={isEnglish ? 'Messages' : '消息'} onClick={() => void openNotices()}>
          <span aria-hidden="true">◉</span>
          {unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
        </button>
      </div>

      {noticeOpen && (
        <div className="open-app-account-popover open-app-notice-popover">
          <header>{isEnglish ? 'Messages' : '消息通知'}</header>
          {loadingNotices ? (
            <div className="open-app-popover-empty">Loading...</div>
          ) : noticeError ? (
            <div className="open-app-popover-empty">{noticeError}</div>
          ) : notifications.length === 0 ? (
            <div className="open-app-popover-empty">{isEnglish ? 'No messages' : '暂无消息'}</div>
          ) : (
            <div className="open-app-notice-list">
              {notifications.map((item) => (
                <article key={item.id}>
                  <strong>{item.senderName || (isEnglish ? 'System' : '系统消息')}</strong>
                  <p>{item.content}</p>
                  {item.createdAt && <time>{item.createdAt}</time>}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {menuOpen && (
        <div className="open-app-account-popover open-app-user-menu">
          <div className="open-app-user-menu-group-label">{isEnglish ? 'Client configuration' : '客户端配置'}</div>
          <button type="button" onClick={() => void hostBridge?.onOpenConfigPage?.('client')}>{isEnglish ? 'Client' : '客户端'}</button>
          <button type="button" onClick={() => void hostBridge?.onOpenConfigPage?.('sessions')}>{isEnglish ? 'Sessions' : '会话'}</button>
          <button type="button" onClick={() => void hostBridge?.onOpenConfigPage?.('settings')}>{isEnglish ? 'Settings' : '设置'}</button>
          <button type="button" onClick={() => void hostBridge?.onOpenConfigPage?.('dependencies')}>{isEnglish ? 'Dependencies' : '依赖'}</button>
          <button type="button" onClick={() => void hostBridge?.onOpenConfigPage?.('permissions')}>{isEnglish ? 'Permissions' : '权限'}</button>
          <button type="button" onClick={() => void hostBridge?.onOpenConfigPage?.('logs')}>{isEnglish ? 'Logs' : '日志'}</button>
          <button type="button" onClick={() => void hostBridge?.onOpenConfigPage?.('about')}>{isEnglish ? 'About' : '关于'}</button>
          <div className="open-app-user-menu-divider" />
          <button type="button" onClick={() => void hostBridge?.onOpenSettings?.()}>{isEnglish ? 'Personal preferences' : '个人设置'}</button>
          <button type="button" onClick={() => navigate(appPath('my-subscriptions'))}>{isEnglish ? 'Subscriptions' : '我的订阅'}</button>
          <button type="button" onClick={() => navigate(appPath('my-orders'))}>{isEnglish ? 'Orders' : '我的订单'}</button>
          <button type="button" onClick={() => navigate(appPath('usage-stats'))}>{isEnglish ? 'Usage' : '使用统计'}</button>
          <button
            className="danger"
            type="button"
            onClick={async () => {
              await adapter.logout?.();
              await hostBridge?.onLogout?.();
            }}
          >
            {isEnglish ? 'Sign out' : '退出登录'}
          </button>
        </div>
      )}
    </footer>
  );
}
