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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Tag,
  Alert,
  Spin,
  message,
  Form,
  Input,
  Modal,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  GlobalOutlined,
  LogoutOutlined,
  LoginOutlined,
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
} from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import {
  loginAndRegister,
  logout,
  getCurrentAuth,
  getAuthErrorMessage,
} from '../services/auth';

// ======================== Types ========================

type TabKey = 'client' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about';

interface ClientPageProps {
  onNavigate?: (tab: TabKey) => void;
}

interface ServiceItem {
  key: string;
  label: string;
  description: string;
  running: boolean;
  pid?: number;
}

interface AuthState {
  isLoggedIn: boolean;
  username: string | null;
  domain: string | null;
  userId?: number;
}

// ======================== Component ========================

function ClientPage({ onNavigate }: ClientPageProps) {
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
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [batchLoading, setBatchLoading] = useState(false);

  // ---------- Dependencies ----------
  const [depsMissing, setDepsMissing] = useState(false);
  const [depsChecked, setDepsChecked] = useState(false);

  // ---------- Polling ----------
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (!loginUsername || !loginPassword) {
      message.warning('请输入账号和认证码');
      return;
    }
    if (!loginDomain) {
      message.warning('请输入服务域名');
      return;
    }

    setLoginLoading(true);
    try {
      await loginAndRegister(loginUsername, loginPassword, {
        domain: loginDomain,
      });
      setLoginPassword('');
      await loadAuth();
    } catch (error: any) {
      const errorMsg = getAuthErrorMessage(error);
      message.error(errorMsg);
      setLoginPassword('');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    Modal.confirm({
      title: '确认退出登录',
      content: '退出后需要重新登录才能使用在线功能。',
      okText: '退出',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await logout();
          setAuthState({ isLoggedIn: false, username: null, domain: null });
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

  const pollServices = useCallback(async () => {
    try {
      const items: ServiceItem[] = [];

      // Agent
      const agentStatus = await window.electronAPI?.agent.status();
      items.push({
        key: 'agent',
        label: 'Agent 服务',
        description: 'Agent 引擎服务',
        running: agentStatus?.running ?? false,
        pid: agentStatus?.pid,
      });

      // File Server
      const fsStatus = await window.electronAPI?.fileServer.status();
      items.push({
        key: 'fileServer',
        label: '文件服务',
        description: '本地文件服务',
        running: fsStatus?.running ?? false,
        pid: fsStatus?.pid,
      });

      // Lanproxy
      const lpStatus = await window.electronAPI?.lanproxy.status();
      items.push({
        key: 'lanproxy',
        label: 'Lanproxy',
        description: '内网穿透服务',
        running: lpStatus?.running ?? false,
        pid: lpStatus?.pid,
      });

      // Agent Runner
      const arStatus = await window.electronAPI?.agentRunner?.status();
      items.push({
        key: 'agentRunner',
        label: 'Agent Runner',
        description: 'Agent Runner 代理服务',
        running: arStatus?.running ?? false,
        pid: arStatus?.pid,
      });

      setServices(items);
    } catch (error) {
      console.error('[ClientPage] pollServices failed:', error);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  const handleStartService = async (key: string) => {
    try {
      if (key === 'agent') {
        const config = await window.electronAPI?.settings.get('agent_config') as any;
        const result = await window.electronAPI?.agent.start({
          type: config?.type || 'nuwaxcode',
          binPath: config?.binPath || 'opencode',
          env: {},
          apiKey: config?.apiKey,
          apiBaseUrl: config?.apiBaseUrl,
          model: config?.model,
        });
        if (result?.success) {
          message.success('Agent 启动成功');
        } else {
          message.error(`Agent 启动失败: ${result?.error || '未知错误'}`);
        }
      } else if (key === 'fileServer') {
        const step1 = await window.electronAPI?.settings.get('step1_config') as { fileServerPort?: number } | null;
        const result = await window.electronAPI?.fileServer.start(step1?.fileServerPort ?? 8080);
        if (result?.success) {
          message.success('文件服务启动成功');
        } else {
          message.error(`文件服务启动失败: ${result?.error || '未知错误'}`);
        }
      } else if (key === 'lanproxy') {
        message.info('请在设置中配置 Lanproxy 参数后启动');
      } else if (key === 'agentRunner') {
        message.info('请在设置中配置 Agent Runner 参数后启动');
      }
    } catch (error) {
      message.error(`启动失败: ${error}`);
    }
    await pollServices();
  };

  const handleStopService = async (key: string) => {
    try {
      if (key === 'agent') {
        await window.electronAPI?.agent.stop();
        message.success('Agent 已停止');
      } else if (key === 'fileServer') {
        await window.electronAPI?.fileServer.stop();
        message.success('文件服务已停止');
      } else if (key === 'lanproxy') {
        await window.electronAPI?.lanproxy.stop();
        message.success('Lanproxy 已停止');
      } else if (key === 'agentRunner') {
        await window.electronAPI?.agentRunner?.stop();
        message.success('Agent Runner 已停止');
      }
    } catch (error) {
      message.error(`停止失败: ${error}`);
    }
    await pollServices();
  };

  const handleStartAll = async () => {
    setBatchLoading(true);
    try {
      const stopped = services.filter((s) => !s.running);
      for (const svc of stopped) {
        await handleStartService(svc.key);
      }
      if (stopped.length === 0) {
        message.info('所有服务已在运行');
      }
    } finally {
      setBatchLoading(false);
      await pollServices();
    }
  };

  const handleStopAll = async () => {
    setBatchLoading(true);
    try {
      const running = services.filter((s) => s.running);
      for (const svc of running) {
        try {
          if (svc.key === 'agent') await window.electronAPI?.agent.stop();
          else if (svc.key === 'fileServer') await window.electronAPI?.fileServer.stop();
          else if (svc.key === 'lanproxy') await window.electronAPI?.lanproxy.stop();
          else if (svc.key === 'agentRunner') await window.electronAPI?.agentRunner?.stop();
        } catch (error) {
          console.error(`停止 ${svc.label} 失败:`, error);
        }
      }
      if (running.length > 0) {
        message.success('所有服务已停止');
      } else {
        message.info('没有正在运行的服务');
      }
    } finally {
      setBatchLoading(false);
      await pollServices();
    }
  };

  // ======================== Dependencies ========================

  const checkDependencies = useCallback(async () => {
    try {
      const result = await window.electronAPI?.dependencies.checkAll();
      const deps = result?.results || [];
      const hasMissing = deps.some(
        (d) => d.status !== 'installed' && d.status !== 'bundled',
      );
      setDepsMissing(hasMissing);
    } catch (error) {
      console.error('[ClientPage] checkDependencies failed:', error);
    } finally {
      setDepsChecked(true);
    }
  }, []);

  // ======================== Lifecycle ========================

  useEffect(() => {
    loadAuth();
    pollServices();
    checkDependencies();

    // Poll services every 5 seconds
    pollTimer.current = setInterval(pollServices, 5000);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
      }
    };
  }, [loadAuth, pollServices, checkDependencies]);

  // ======================== Render helpers ========================

  const renderLoginSection = () => {
    if (authLoading) {
      return (
        <div style={styles.sectionBody}>
          <Spin size="small" />
        </div>
      );
    }

    if (authState.isLoggedIn) {
      const redirectUrl = getRedirectUrl();
      const isButtonDisabled = !redirectUrl;

      return (
        <div style={styles.sectionBody}>
          <div style={styles.userInfoRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserOutlined style={{ fontSize: 16, color: '#18181b' }} />
              <span style={{ fontSize: 14, fontWeight: 500, color: '#18181b' }}>
                {authState.username || '用户'}
              </span>
              <Tag color="green" style={{ margin: 0, fontSize: 11 }}>
                已登录
              </Tag>
            </div>
          </div>

          {authState.domain && (
            <div style={{ fontSize: 12, color: '#71717a', marginTop: 4, marginBottom: 12 }}>
              <GlobalOutlined style={{ marginRight: 4 }} />
              {authState.domain}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStartSession}
              size="small"
              disabled={isButtonDisabled}
            >
              开始会话
            </Button>
            <Button
              icon={<QrcodeOutlined />}
              onClick={handleShowQrCode}
              size="small"
              disabled={isButtonDisabled}
            >
              扫码使用
            </Button>
            <Button
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              size="small"
              danger
            >
              退出登录
            </Button>
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
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '16px 0',
              }}
            >
              {redirectUrl && <QRCodeSVG value={redirectUrl} size={200} />}
            </div>
          </Modal>
        </div>
      );
    }

    // Not logged in — show login form
    return (
      <div style={styles.sectionBody}>
        <Form layout="vertical" style={{ maxWidth: 360 }}>
          <Form.Item label="服务域名" style={{ marginBottom: 12 }}>
            <Input
              prefix={<GlobalOutlined />}
              value={loginDomain}
              onChange={(e) => setLoginDomain(e.target.value)}
              placeholder="https://agent.nuwax.com"
              size="small"
            />
          </Form.Item>

          <Form.Item label="账号" style={{ marginBottom: 12 }}>
            <Input
              prefix={<UserOutlined />}
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="用户名 / 手机号 / 邮箱"
              autoComplete="username"
              size="small"
            />
          </Form.Item>

          <Form.Item label="动态认证码" style={{ marginBottom: 16 }}>
            <Input.Password
              prefix={<LockOutlined />}
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="请填写动态认证码"
              autoComplete="current-password"
              size="small"
              onPressEnter={handleLogin}
            />
          </Form.Item>

          <Button
            type="primary"
            icon={<LoginOutlined />}
            onClick={handleLogin}
            loading={loginLoading}
            block
            size="small"
          >
            登录
          </Button>
        </Form>
      </div>
    );
  };

  const renderServicesSection = () => {
    if (servicesLoading) {
      return (
        <div style={styles.sectionBody}>
          <Spin size="small" />
        </div>
      );
    }

    return (
      <div style={styles.sectionBody}>
        {services.map((svc) => (
          <div key={svc.key} style={styles.serviceRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              {svc.running ? (
                <CheckCircleOutlined style={{ color: '#16a34a', fontSize: 14 }} />
              ) : (
                <CloseCircleOutlined style={{ color: '#a1a1aa', fontSize: 14 }} />
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: '#18181b' }}>{svc.label}</span>
                  {svc.running ? (
                    <Tag color="green" style={{ margin: 0, fontSize: 11 }}>运行中</Tag>
                  ) : (
                    <Tag style={{ margin: 0, fontSize: 11 }}>已停止</Tag>
                  )}
                  {svc.running && svc.pid && (
                    <span style={{ fontSize: 11, color: '#a1a1aa' }}>PID: {svc.pid}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
                  {svc.description}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4 }}>
              {svc.running ? (
                <Button
                  size="small"
                  danger
                  icon={<PoweroffOutlined />}
                  onClick={() => handleStopService(svc.key)}
                >
                  停止
                </Button>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={() => handleStartService(svc.key)}
                >
                  启动
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDependencyAlert = () => {
    if (!depsChecked || !depsMissing) return null;

    return (
      <Alert
        message="检测到缺失依赖"
        description="部分必需依赖未安装，可能影响服务运行。"
        type="warning"
        showIcon
        icon={<ExclamationCircleOutlined />}
        style={{ marginBottom: 16 }}
        action={
          <Button
            size="small"
            onClick={() => onNavigate?.('dependencies')}
          >
            前往安装
          </Button>
        }
      />
    );
  };

  const renderQuickActions = () => {
    return (
      <div style={styles.sectionBody}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            依赖管理
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
    <div style={styles.page}>
      {/* Dependency alert */}
      {renderDependencyAlert()}

      {/* Login status */}
      <div className="section" style={styles.section}>
        <div style={styles.sectionHeader}>
          <UserOutlined style={{ fontSize: 14, color: '#52525b' }} />
          <span style={styles.sectionTitle}>账号状态</span>
        </div>
        {renderLoginSection()}
      </div>

      {/* Service status */}
      <div className="section" style={styles.section}>
        <div style={{ ...styles.sectionHeader, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PlayCircleOutlined style={{ fontSize: 14, color: '#52525b' }} />
            <span style={styles.sectionTitle}>服务状态</span>
            {!servicesLoading && (() => {
              const runningCount = services.filter((s) => s.running).length;
              const totalCount = services.length;
              const badgeColor = runningCount === totalCount ? 'green'
                : runningCount === 0 ? 'default'
                : 'orange';
              return (
                <Tag color={badgeColor} style={{ margin: 0, fontSize: 11 }}>
                  {runningCount}/{totalCount}
                </Tag>
              );
            })()}
          </div>
          {!servicesLoading && (
            <div style={{ display: 'flex', gap: 4 }}>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => { setServicesLoading(true); pollServices(); }}
              />
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartAll}
                loading={batchLoading}
                disabled={services.every((s) => s.running)}
              >
                全部启动
              </Button>
              <Button
                size="small"
                danger
                icon={<PoweroffOutlined />}
                onClick={handleStopAll}
                loading={batchLoading}
                disabled={services.every((s) => !s.running)}
              >
                全部停止
              </Button>
            </div>
          )}
        </div>
        {renderServicesSection()}
      </div>

      {/* Quick actions */}
      <div className="section" style={styles.section}>
        <div style={styles.sectionHeader}>
          <AppstoreOutlined style={{ fontSize: 14, color: '#52525b' }} />
          <span style={styles.sectionTitle}>快捷操作</span>
        </div>
        {renderQuickActions()}
      </div>
    </div>
  );
}

// ======================== Styles ========================

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 0,
  },
  section: {
    background: '#ffffff',
    border: '1px solid #e4e4e7',
    borderRadius: 8,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 16px',
    borderBottom: '1px solid #f4f4f5',
    background: '#fafafa',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#18181b',
  },
  sectionBody: {
    padding: 16,
  },
  userInfoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  serviceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #f4f4f5',
  },
};

export default ClientPage;
