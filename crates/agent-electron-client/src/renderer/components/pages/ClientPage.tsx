/**
 * ClientPage - Dashboard page (Electron version)
 *
 * Adapted from the Tauri client. Replaces Rust invocations with
 * window.electronAPI IPC calls.
 *
 * Sections:
 *   1. Login status — user info, logout, start session
 *   2. Service status — agent / file-server / lanproxy with start/stop
 *   3. Dependency check — alert when deps are missing
 *   4. Quick action buttons — navigate to settings / deps / about
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Tag,
  Alert,
  Spin,
  message,
  Form,
  Input,
  Modal,
  Tooltip,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  GlobalOutlined,
  LogoutOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  SettingOutlined,
  AppstoreOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import {
  loginAndRegister,
  logout,
  getCurrentAuth,
  syncConfigToServer,
} from '../../services/core/auth';
import type { ServiceItem } from '../../App';
import styles from '../../styles/components/ClientPage.module.css';

// ======================== Types ========================

type TabKey = 'client' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about';

interface ClientPageProps {
  onNavigate?: (tab: TabKey) => void;
  services: ServiceItem[];
  servicesLoading: boolean;
  startingServices?: Set<string>;
  setStartingServices?: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRefreshServices: () => Promise<void>;
  /** 当 reg 成功或登录后由父组件递增，用于刷新账号状态（用户名等）以与 reg 返回一致 */
  authRefreshTrigger?: number;
  /** 登录/注销后通知父组件刷新顶部栏用户名等 */
  onAuthChange?: () => void;
}

interface AuthState {
  isLoggedIn: boolean;
  username: string | null;
  domain: string | null;
  userId?: number;
}

// ======================== Component ========================

function ClientPage({ onNavigate, services, servicesLoading, startingServices, setStartingServices, onRefreshServices, authRefreshTrigger, onAuthChange }: ClientPageProps) {
  // ---------- Auth state ----------
  const [authState, setAuthState] = useState<AuthState>({
    isLoggedIn: false,
    username: null,
    domain: null,
  });
  const [authLoading, setAuthLoading] = useState(true);

  // ---------- Login form ----------
  const [loginDomain, setLoginDomain] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // ---------- Services ----------
  const [stoppingServices, setStoppingServices] = useState<Set<string>>(new Set());
  const isAnyStarting = (startingServices?.size ?? 0) > 0;
  const isAnyStopping = stoppingServices.size > 0;
  const isAnyOperating = isAnyStarting || isAnyStopping;

  // ---------- Dependencies ----------
  const [missingDeps, setMissingDeps] = useState<{ name: string; displayName: string }[]>([]);
  const [depsChecked, setDepsChecked] = useState(false);

  // ---------- QR Code ----------
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // ======================== Auth ========================

  const loadAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const auth = await getCurrentAuth();
      setAuthState({
        isLoggedIn: auth.isLoggedIn,
        username: auth.userInfo?.displayName || auth.username || null,
        domain: auth.userInfo?.currentDomain || null,
        userId: auth.userInfo?.id,
      });
      if (!auth.isLoggedIn) {
        // Pre-fill domain from step1 config
        const step1 = await window.electronAPI?.settings.get('step1_config') as { serverHost?: string } | null;
        if (step1?.serverHost) {
          setLoginDomain(step1.serverHost);
        }
      }
    } catch (error) {
      console.error('[ClientPage] loadAuth failed:', error);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    if (!loginDomain) { message.warning('请输入服务域名'); return; }
    if (!loginUsername) { message.warning('请输入账号'); return; }
    if (!loginPassword) { message.warning('请填写动态认证码'); return; }

    setLoginLoading(true);
    try {
      await loginAndRegister(loginUsername, loginPassword, {
        domain: loginDomain,
      });
      setLoginPassword('');
      await loadAuth();
      // 标记服务已由登录流程启动，防止 App.tsx 自动重连再次启动
      await window.electronAPI?.settings.set('_services_started_by_login', true);
      // 登录成功后自动启动服务（先启动非代理服务，同步配置后再启动代理服务）
      const preProxyServices = ['mcpProxy', 'agent', 'fileServer'];
      let agentFailed = false;
      for (const key of preProxyServices) {
        const success = await handleStartService(key, true);
        if (key === 'agent' && !success) agentFailed = true;
      }
      // 先同步配置到后端（更新端口映射），再启动代理服务
      try {
        await syncConfigToServer({ suppressToast: true });
        console.log('[ClientPage] 登录后 reg 同步成功');
      } catch (e) {
        console.error('[ClientPage] 登录后 reg 同步失败:', e);
      }
      // reg 完成后（无论成败）通知父组件刷新顶部栏用户名/电脑名称
      onAuthChange?.();
      if (!agentFailed) {
        await handleStartService('lanproxy', true);
      }
      await onRefreshServices();
    } catch {
      // 错误提示由 loginAndRegister 内部统一展示，此处不再重复 toast
      setLoginPassword('');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    Modal.confirm({
      title: '确认退出登录',
      content: '退出后将停止所有运行中的服务，需要重新登录才能使用在线功能。',
      okText: '退出',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          // 停止所有运行中或处于 error 状态的服务（error 状态进程可能仍驻留）
          const toStop = services.filter((s) => s.running || !!s.error);
          for (const svc of toStop) {
            try {
              if (svc.key === 'agent') await window.electronAPI?.agent.destroy();
              else if (svc.key === 'fileServer') await window.electronAPI?.fileServer.stop();
              else if (svc.key === 'lanproxy') await window.electronAPI?.lanproxy.stop();
              else if (svc.key === 'mcpProxy') await window.electronAPI?.mcp.stop();
            } catch (e) {
              console.error(`停止 ${svc.label} 失败:`, e);
            }
          }
          // computerServer 不在 services 列表中，需单独停止，避免进程残留导致端口冲突
          await window.electronAPI?.computerServer.stop().catch((e: unknown) => {
            console.error('停止 computerServer 失败:', e);
          });

          await logout();
          setAuthState({ isLoggedIn: false, username: null, domain: null });
          onAuthChange?.();
        } catch {
          message.error('退出登录失败');
        }
      },
    });
  };

  const getRedirectUrl = useCallback(() => {
    if (!authState.domain || !authState.userId) return '';
    const normalizedDomain = authState.domain.replace(/\/+$/, '');
    return `${normalizedDomain}/api/sandbox/config/redirect/${authState.userId}`;
  }, [authState.domain, authState.userId]);

  const handleStartSession = async () => {
    const url = getRedirectUrl();
    if (!url) {
      message.warning('登录信息不完整，请重新登录');
      return;
    }
    try {
      await window.electronAPI?.shell.openExternal(url);
    } catch {
      message.error('无法打开浏览器');
    }
  };

  const handleShowQrCode = () => {
    const url = getRedirectUrl();
    if (!url) {
      message.warning('无法获取会话地址');
      return;
    }
    setQrModalVisible(true);
  };

  // ======================== Services ========================

  const handleStartService = async (key: string, silent = false): Promise<boolean> => {
    setStartingServices?.(prev => new Set(prev).add(key));
    try {
      let result: { success: boolean; error?: string } | undefined;

      if (key === 'agent') {
        const agentConfig = await window.electronAPI?.settings.get('agent_config') as any;
        const step1 = await window.electronAPI?.settings.get('step1_config') as { workspaceDir?: string } | null;
        result = await window.electronAPI?.agent.init({
          engine: agentConfig?.type || 'claude-code',
          apiKey: agentConfig?.apiKey,
          baseUrl: agentConfig?.apiBaseUrl,
          model: agentConfig?.model,
          workspaceDir: step1?.workspaceDir || '',
          port: agentConfig?.backendPort || undefined,
          engineBinaryPath: agentConfig?.binPath || undefined,
        });
        // ComputerServer 是 Agent 的 HTTP 接口，随 Agent 一起启动
        await window.electronAPI?.computerServer.start().catch(() => undefined);
      } else if (key === 'fileServer') {
        const step1 = await window.electronAPI?.settings.get('step1_config') as { fileServerPort?: number } | null;
        result = await window.electronAPI?.fileServer.start(step1?.fileServerPort ?? 60000);
      } else if (key === 'lanproxy') {
        const clientKey = await window.electronAPI?.settings.get('auth.saved_key') as string | null;
        const lpConfig = await window.electronAPI?.settings.get('lanproxy_config') as {
          serverIp?: string;
          serverPort?: number;
          ssl?: boolean;
        } | null;
        const serverIp = lpConfig?.serverIp
          || ((await window.electronAPI?.settings.get('lanproxy.server_host') as string | null)?.replace(/^https?:\/\//, ''));
        const serverPort = lpConfig?.serverPort
          || (await window.electronAPI?.settings.get('lanproxy.server_port') as number | null);
        if (!serverIp || !clientKey || !serverPort) {
          if (!silent) message.info('请先登录以获取代理服务配置');
          await onRefreshServices();
          return false;
        }
        result = await window.electronAPI?.lanproxy.start({
          serverIp,
          serverPort,
          clientKey,
          ssl: lpConfig?.ssl,
        });
      } else if (key === 'mcpProxy') {
        result = await window.electronAPI?.mcp.start();
      }

      await onRefreshServices();
      return result?.success ?? false;
    } catch (error) {
      console.error(`[ClientPage] 启动 ${key} 失败:`, error);
      await onRefreshServices();
      return false;
    } finally {
      setStartingServices?.(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  const handleStopService = async (key: string) => {
    setStoppingServices(prev => new Set(prev).add(key));
    try {
      if (key === 'agent') {
        await window.electronAPI?.agent.destroy();
        await window.electronAPI?.computerServer.stop().catch(() => {});
      } else if (key === 'fileServer') await window.electronAPI?.fileServer.stop();
      else if (key === 'lanproxy') await window.electronAPI?.lanproxy.stop();
      else if (key === 'mcpProxy') await window.electronAPI?.mcp.stop();
    } catch (error) {
      message.error(`停止失败: ${error}`);
    } finally {
      setStoppingServices(prev => { const next = new Set(prev); next.delete(key); return next; });
      await onRefreshServices();
    }
  };

  const handleStartAll = async () => {
    // 未登录时禁止启动全部服务，避免 agent 无 apiKey / lanproxy 无 clientKey 的半启动状态
    if (!authState.isLoggedIn) {
      message.warning('请先登录后再启动服务');
      return;
    }
    if (missingDeps.length > 0) {
      message.warning('存在缺失依赖，请先安装');
      return;
    }

    try {
      // 先启动非代理服务，同步配置后再启动代理服务
      const preProxyServices = ['mcpProxy', 'agent', 'fileServer'];
      const proxyServices = ['lanproxy'];
      let startedCount = 0;

      for (const key of preProxyServices) {
        const svc = services.find((s) => s.key === key);
        if (svc && !svc.running) {
          await handleStartService(key);
          startedCount++;
        }
      }

      // 先同步配置到后端（更新端口映射），再启动代理服务
      try {
        await syncConfigToServer({ suppressToast: true });
      } catch (e) {
        console.error('[ClientPage] 同步失败:', e);
      }

      for (const key of proxyServices) {
        const svc = services.find((s) => s.key === key);
        if (svc && !svc.running) {
          await handleStartService(key);
          startedCount++;
        }
      }

      if (startedCount === 0) {
        message.info('所有可自动启动的服务已在运行');
      }
    } finally {
      await onRefreshServices();
    }
  };

  const handleStopAll = async () => {
    const toStop = services.filter((s) => s.running || !!s.error);
    setStoppingServices(new Set(toStop.map(s => s.key)));
    try {
      for (const svc of toStop) {
        try {
          if (svc.key === 'agent') await window.electronAPI?.agent.destroy();
          else if (svc.key === 'fileServer') await window.electronAPI?.fileServer.stop();
          else if (svc.key === 'lanproxy') await window.electronAPI?.lanproxy.stop();
          else if (svc.key === 'mcpProxy') await window.electronAPI?.mcp.stop();
        } catch (error) {
          console.error(`停止 ${svc.label} 失败:`, error);
        }
      }
      await window.electronAPI?.computerServer.stop().catch(() => {});
    } finally {
      setStoppingServices(new Set());
      await onRefreshServices();
    }
  };

  // ======================== Dependencies ========================

  const checkDependencies = useCallback(async () => {
    try {
      const result = await window.electronAPI?.dependencies.checkAll();
      const deps = result?.results || [];
      const syncInProgress = result?.syncInProgress ?? false;
      // 依赖同步进行中时不显示缺失提示（升级后正在自动安装新版本）
      if (syncInProgress) {
        setMissingDeps([]);
      } else {
        // 与 App.tsx 保持一致：outdated 视为"已安装"，不阻断服务启动
        // 仅 missing / error 才视为缺失依赖
        const missing = deps.filter(
          (d: any) => d.required && (d.status === 'missing' || d.status === 'error'),
        );
        setMissingDeps(
          missing.map((d: any) => ({ name: d.name, displayName: d.displayName || d.name })),
        );
      }
    } catch (error) {
      console.error('[ClientPage] checkDependencies failed:', error);
    } finally {
      setDepsChecked(true);
    }
  }, []);

  // ======================== Lifecycle ========================

  useEffect(() => {
    loadAuth();
    onRefreshServices();
    checkDependencies();

    // 监听依赖同步完成事件（客户端升级后自动安装新版本依赖），重新检测
    const handleDepsSyncCompleted = () => {
      console.log('[ClientPage] deps:syncCompleted, re-checking dependencies');
      checkDependencies();
    };
    window.electronAPI?.on('deps:syncCompleted', handleDepsSyncCompleted as any);
    return () => {
      window.electronAPI?.off('deps:syncCompleted', handleDepsSyncCompleted as any);
    };
  }, [loadAuth, onRefreshServices, checkDependencies]);

  // reg 成功或登录后父组件递增 authRefreshTrigger，刷新账号状态（用户名等）以与 reg 返回一致
  useEffect(() => {
    if (authRefreshTrigger != null && authRefreshTrigger > 0) {
      loadAuth();
    }
  }, [authRefreshTrigger, loadAuth]);

  // ======================== Render helpers ========================

  const renderLoginSection = () => {
    if (authLoading) {
      return (
        <div className={styles.sectionBody}>
          <Spin size="small" />
        </div>
      );
    }

    if (authState.isLoggedIn) {
      const redirectUrl = getRedirectUrl();
      // 与 Tauri 一致：服务未全部启动时禁用「开始会话」「扫码使用」
      const allServicesRunning =
        services.length > 0 && services.every((s) => s.running);
      const isButtonDisabled = !redirectUrl || !allServicesRunning;

      return (
        <div className={styles.sectionBody}>
          {/* 左右布局：左侧用户信息 + 右侧按钮 */}
          <div className={styles.loggedInContainer}>
            {/* 左侧：用户信息 */}
            <div className={styles.userInfo}>
              <CheckCircleOutlined style={{ color: 'var(--color-success)', fontSize: 14 }} />
              <div className={styles.userInfoText}>
                <span className={styles.username}>
                  {authState.username || '用户'}
                </span>
                <div className={styles.domain}>
                  {authState.domain || ''}
                </div>
              </div>
            </div>

            {/* 右侧：操作按钮（服务未全部启动时禁用，与 Tauri 行为一致） */}
            <div className={styles.actionButtons}>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartSession}
                size="small"
                disabled={isButtonDisabled}
                title={!allServicesRunning ? '请先启动全部服务' : undefined}
              >
                开始会话
              </Button>
              <Button
                icon={<QrcodeOutlined />}
                onClick={handleShowQrCode}
                size="small"
                disabled={isButtonDisabled}
                title={!allServicesRunning ? '请先启动全部服务' : undefined}
              >
                扫码使用
              </Button>
              <Button
                type="text"
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                size="small"
                danger
              >
                退出
              </Button>
            </div>
          </div>

          {/* 二维码弹窗 */}
          <Modal
            title="扫码使用"
            open={qrModalVisible}
            onCancel={() => setQrModalVisible(false)}
            footer={null}
            centered
            width={320}
          >
            <div className={styles.qrCodeContainer}>
              {redirectUrl && <QRCodeSVG value={redirectUrl} size={200} />}
            </div>
          </Modal>
        </div>
      );
    }

    // Not logged in — show login form
    return (
      <div className={styles.sectionBody}>
        <Form layout="vertical" size="small" onFinish={handleLogin}>
          <Form.Item
            style={{ marginBottom: 10 }}
          >
            <Input
              prefix={<GlobalOutlined />}
              value={loginDomain}
              onChange={(e) => setLoginDomain(e.target.value)}
              placeholder="服务域名（例如：https://agent.nuwax.com）"
              allowClear
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>

          <Form.Item
            style={{ marginBottom: 10 }}
          >
            <Input
              prefix={<UserOutlined />}
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="用户名 / 手机号 / 邮箱"
              autoComplete="username"
              allowClear
            />
          </Form.Item>

          <Form.Item
            style={{ marginBottom: 12 }}
          >
            <Input.Password
              prefix={<LockOutlined />}
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="请输入密码或动态认证码（在浏览器打开你的域名登录，然后在用户资料中查看）"
              autoComplete="current-password"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            loading={loginLoading}
            block
          >
            登录
          </Button>
        </Form>

        <div className={styles.loginHint}>
          <span className={styles.loginHintText}>
            支持用户名、邮箱、手机号
          </span>
        </div>
      </div>
    );
  };

  const renderServicesSection = () => {
    // 首次加载中
    if (servicesLoading && services.length === 0) {
      return (
        <div className={styles.sectionBody}>
          <Spin size="small" />
        </div>
      );
    }

    return (
      <div className={styles.sectionBody} style={{ padding: '0 16px' }}>
        {/* 服务列表 */}
        {services.map((svc) => {
          const isStarting = startingServices?.has(svc.key);
          const isStopping = stoppingServices.has(svc.key);
          const hasError = !svc.running && !!svc.error;
          return (
            <div key={svc.key} className={styles.serviceRow}>
              <div className={styles.serviceInfo}>
                {(isStarting || isStopping) ? (
                  <LoadingOutlined style={{ color: 'var(--color-info)', fontSize: 14 }} />
                ) : svc.running ? (
                  <CheckCircleOutlined style={{ color: 'var(--color-success)', fontSize: 14 }} />
                ) : hasError ? (
                  <Tooltip title={svc.error}>
                    <ExclamationCircleOutlined style={{ color: 'var(--color-error)', fontSize: 14 }} />
                  </Tooltip>
                ) : (
                  <CloseCircleOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }} />
                )}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={styles.serviceLabel}>{svc.label}</span>
                    {isStarting ? (
                      <Tag color="processing" style={{ margin: 0, fontSize: 11 }}>启动中</Tag>
                    ) : isStopping ? (
                      <Tag color="processing" style={{ margin: 0, fontSize: 11 }}>停止中</Tag>
                    ) : svc.running ? (
                      <Tag color="green" style={{ margin: 0, fontSize: 11 }}>运行中</Tag>
                    ) : hasError ? (
                      <Tooltip title={svc.error}>
                        <Tag color="error" style={{ margin: 0, fontSize: 11, cursor: 'help' }}>启动失败</Tag>
                      </Tooltip>
                    ) : (
                      <Tag style={{ margin: 0, fontSize: 11 }}>已停止</Tag>
                    )}
                  </div>
                  <div className={styles.serviceDescription}>
                    {svc.description}
                  </div>
                </div>
              </div>

              <div className={styles.serviceActions}>
                {isStarting ? (
                  <Button size="small" disabled loading>启动中</Button>
                ) : isStopping ? (
                  <Button size="small" disabled loading>停止中</Button>
                ) : svc.running ? (
                  <Button
                    size="small"
                    danger
                    className={styles.dangerButton}
                    icon={<PoweroffOutlined />}
                    onClick={() => handleStopService(svc.key)}
                    disabled={isAnyOperating}
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleStartService(svc.key)}
                    disabled={isAnyOperating}
                  >
                    启动
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDependencyAlert = () => {
    if (!depsChecked || missingDeps.length === 0) return null;

    const allStopped = services.length > 0 && services.every((s) => !s.running);

    return (
      <Alert
        message="缺少必需依赖，无法启动服务"
        description={
          <div>
            <div style={{ marginBottom: 8 }}>
              {missingDeps.map((dep) => (
                <Tag key={dep.name} color="error" style={{ marginBottom: 4 }}>
                  {dep.displayName}
                </Tag>
              ))}
            </div>
            <Button
              size="small"
              type="primary"
              onClick={() => onNavigate?.('dependencies')}
            >
              前往安装
            </Button>
          </div>
        }
        type={allStopped ? 'error' : 'warning'}
        showIcon
        icon={<ExclamationCircleOutlined />}
        style={{ marginBottom: 16 }}
      />
    );
  };

  const renderQuickActions = () => {
    return (
      <div className={styles.sectionBody}>
        <div className={styles.quickActions}>
          <Button
            icon={<SettingOutlined />}
            onClick={() => onNavigate?.('settings')}
            size="small"
          >
            设置
          </Button>
          <Button
            icon={<AppstoreOutlined />}
            onClick={() => onNavigate?.('dependencies')}
            size="small"
          >
            依赖
          </Button>
          <Button
            icon={<InfoCircleOutlined />}
            onClick={() => onNavigate?.('about')}
            size="small"
          >
            关于
          </Button>
        </div>
      </div>
    );
  };

  // ======================== Main render ========================

  return (
    <div className={styles.page}>
      {/* Dependency alert */}
      {renderDependencyAlert()}

      {/* Login status */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <UserOutlined style={{ fontSize: 14, color: 'var(--color-text-secondary)' }} />
          <span className={styles.sectionTitle}>账号状态</span>
        </div>
        {renderLoginSection()}
      </div>

      {/* Service status */}
      <div className={styles.section}>
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <PlayCircleOutlined style={{ fontSize: 14, color: 'var(--color-text-secondary)' }} />
            <span className={styles.sectionTitle}>服务</span>
            {!servicesLoading && (() => {
              const runningCount = services.filter((s) => s.running).length;
              const totalCount = services.length;
              const hasErrors = services.some((s) => !!s.error);
              const badgeColor = hasErrors ? 'error'
                : runningCount === totalCount ? 'success'
                : runningCount === 0 ? 'default'
                : 'warning';
              return (
                <Tag color={badgeColor} style={{ margin: 0, fontSize: 11 }}>
                  {runningCount}/{totalCount}
                </Tag>
              );
            })()}
          </div>
          {!servicesLoading && (
            <div className={styles.servicesHeaderActions}>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => onRefreshServices()}
              >
                刷新
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartAll}
                loading={isAnyStarting}
                disabled={!depsChecked || missingDeps.length > 0 || services.every((s) => s.running) || isAnyStopping}
              >
                启动全部
              </Button>
              <Button
                size="small"
                danger
                className={styles.dangerButton}
                icon={<PoweroffOutlined />}
                onClick={handleStopAll}
                loading={isAnyStopping}
                disabled={services.every((s) => !s.running && !s.error) || isAnyStarting}
              >
                停止全部
              </Button>
            </div>
          )}
        </div>
        {renderServicesSection()}
      </div>

      {/* Quick actions */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <AppstoreOutlined style={{ fontSize: 14, color: 'var(--color-text-secondary)' }} />
          <span className={styles.sectionTitle}>快捷操作</span>
        </div>
        {renderQuickActions()}
      </div>
    </div>
  );
}

export default ClientPage;
