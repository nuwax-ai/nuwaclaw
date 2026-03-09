/**
 * 初始化向导组件 - 4 阶段流程
 *
 * 阶段 1: 依赖检测/安装（dependenciesReady === false）
 * 阶段 2: 基础设置（currentStep === 1）
 * 阶段 3: 账号登录（currentStep === 2）
 * 阶段 4: 完成（Result + 启动服务）
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Steps,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Result,
  Spin,
  message,
  Alert,
  Typography,
} from 'antd';
import {
  SettingOutlined,
  UserOutlined,
  CheckCircleOutlined,
  RobotOutlined,
  FolderOpenOutlined,
  LockOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { setupService, Step1Config, DEFAULT_STEP1_CONFIG } from '../../services/core/setup';
import {
  loginAndRegister,
  normalizeServerHost,
  isLoggedIn as checkIsLoggedIn,
  getCurrentAuth,
  getAuthErrorMessage,
  logout,
} from '../../services/core/auth';
import { AUTH_KEYS } from '@shared/constants';
import type { QuickInitConfig } from '@shared/types/quickInit';
import SetupDependencies, { type MockDependenciesApi } from './SetupDependencies';

const { Text } = Typography;

import { APP_DISPLAY_NAME } from '@shared/constants';
const APP_NAME = APP_DISPLAY_NAME;

const WIZARD_STEPS = [
  { key: 1, title: '基础设置', icon: <SettingOutlined /> },
  { key: 2, title: '账号登录', icon: <UserOutlined /> },
];

interface SetupWizardProps {
  onComplete: () => void;
  /** 可选：注入 Mock API 用于测试 */
  mockApi?: MockDependenciesApi;
  /** 可选：跳过依赖检测（模拟依赖已就绪） */
  skipDependencyCheck?: boolean;
  /** 可选：模拟已登录状态 */
  mockLoggedIn?: boolean;
}

function SetupWizard({ onComplete, mockApi, skipDependencyCheck, mockLoggedIn }: SetupWizardProps) {
  const [dependenciesReady, setDependenciesReady] = useState<boolean | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [step1Config, setStep1Config] = useState<Step1Config>(DEFAULT_STEP1_CONFIG);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [completed, setCompleted] = useState(false);
  const [domain, setDomain] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [retryCooldown, setRetryCooldown] = useState(0);
  const [isAlreadyLoggedIn, setIsAlreadyLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [quickIniting, setQuickIniting] = useState(false);
  const quickInitAttempted = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        // 如果指定跳过依赖检查，直接进入配置步骤
        if (skipDependencyCheck) {
          console.log('[SetupWizard] 跳过依赖检查 (skipDependencyCheck=true)');
          setDependenciesReady(true);
          const state = await setupService.getSetupState();
          if (state.completed) {
            setCompleted(true);
            onCompleteRef.current();
          } else {
            setCurrentStep(state.step1Completed ? 2 : 1);
          }
          const config = await setupService.getStep1Config();
          setStep1Config(config);
          setLoading(false);
          return;
        }

        // 检测所有依赖状态（支持 mock API）
        const checkAllApi = mockApi?.checkAll || window.electronAPI?.dependencies.checkAll;
        const result = await checkAllApi?.();
        const deps = result?.results || [];
        const allInstalled = deps.every(
          (d) => d.status === 'installed' || d.status === 'bundled',
        );
        console.log(
          '[SetupWizard] 依赖检测:',
          deps.map((d) => `${d.name}:${d.status}`).join(', '),
          mockApi ? '(mock)' : '(real)',
        );

        if (allInstalled) {
          // 所有依赖就绪，跳过安装阶段
          setDependenciesReady(true);
          // 加载已保存的步骤
          const state = await setupService.getSetupState();
          if (state.completed) {
            setCompleted(true);
            onComplete();
          } else {
            // 依赖已就绪、setup 未完成 → 优先尝试快捷初始化
            if (!quickInitAttempted.current) {
              quickInitAttempted.current = true;
              try {
                const qiConfig = await window.electronAPI?.quickInit.getConfig();
                if (qiConfig) {
                  console.log('[SetupWizard] 启动时检测到快捷初始化配置，开始自动配置');
                  // 先加载已保存的配置（用于回退时显示）
                  const savedConfig = await setupService.getStep1Config();
                  setStep1Config(savedConfig);
                  setLoading(false);
                  performQuickInit(qiConfig);
                  return; // performQuickInit 内部处理 loading 和 step
                }
              } catch (error) {
                console.warn('[SetupWizard] 启动时读取快捷配置失败:', error);
              }
            }
            setCurrentStep(state.step1Completed ? 2 : 1);
          }
        } else {
          // 有依赖缺失，进入安装流程
          setDependenciesReady(false);
        }

        // 加载已保存的配置
        const config = await setupService.getStep1Config();
        setStep1Config(config);
      } catch (error) {
        console.error('[SetupWizard] 初始化失败:', error);
        setDependenciesReady(false);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  /**
   * Quick Init: 使用预置配置自动完成初始化
   * 失败时回退到正常向导流程
   */
  const performQuickInit = useCallback(async (config: QuickInitConfig) => {
    setQuickIniting(true);
    try {
      // 1. 保存 step1 配置
      const step1: Step1Config = {
        serverHost: normalizeServerHost(config.serverHost),
        agentPort: config.agentPort,
        fileServerPort: config.fileServerPort,
        workspaceDir: config.workspaceDir,
      };
      await setupService.saveStep1Config(step1);
      setStep1Config(step1);

      // 2. 预存 savedKey 到 DB
      const domain = normalizeServerHost(config.serverHost);
      await window.electronAPI?.settings.set(AUTH_KEYS.SAVED_KEY, config.savedKey);
      if (config.username) {
        try {
          const domainKey = `${AUTH_KEYS.SAVED_KEYS_PREFIX}${new URL(domain).hostname}_${config.username}`;
          await window.electronAPI?.settings.set(domainKey, config.savedKey);
        } catch {
          // domain 解析失败时跳过域名级 savedKey 存储
        }
      }

      // 3. 调用 loginAndRegister（password 传空字符串，函数内部从 DB 取 savedKey）
      await loginAndRegister(config.username, '', {
        suppressToast: true,
        domain,
      });

      // 4. 完成 step2 + setup
      await setupService.completeStep2();
      await setupService.completeSetup();

      // 5. 触发完成
      setQuickIniting(false);
      setCompleted(true);
      console.log('[SetupWizard] Quick init 完成');
      setTimeout(() => onComplete(), 1000);
    } catch (error) {
      console.error('[SetupWizard] Quick init 失败，回退到手动向导:', error);
      setQuickIniting(false);
      // step1 可能已保存，从 step1 或 step2 继续
      const state = await setupService.getSetupState();
      setCurrentStep(state.step1Completed ? 2 : 1);
    }
  }, [onComplete]);

  const handleDepsComplete = useCallback(async () => {
    setDependenciesReady(true);

    // 检查是否有快捷配置
    if (!quickInitAttempted.current) {
      quickInitAttempted.current = true;
      try {
        const config = await window.electronAPI?.quickInit.getConfig();
        if (config) {
          console.log('[SetupWizard] 检测到快捷初始化配置，开始自动配置');
          performQuickInit(config);
          return;
        }
      } catch (error) {
        console.warn('[SetupWizard] 读取快捷配置失败:', error);
      }
    }

    setCurrentStep(1);
  }, [performQuickInit]);

  // Check login status when entering step 2
  const checkLoginStatus = useCallback(async () => {
    setCheckingAuth(true);
    try {
      const auth = await getCurrentAuth();
      if (auth.isLoggedIn && auth.userInfo) {
        setIsAlreadyLoggedIn(true);
        setDomain(auth.userInfo.currentDomain || '');
      }
      if (auth.username) {
        setUsername(auth.username);
      }
    } catch (error) {
      console.error('[SetupWizard] 检查登录状态失败:', error);
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    if (currentStep === 2) {
      checkLoginStatus();
    }
  }, [currentStep, checkLoginStatus]);

  // Retry cooldown timer
  useEffect(() => {
    if (retryCooldown <= 0) return;
    const timer = setInterval(() => {
      setRetryCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryCooldown]);

  const handleStep1Submit = async () => {
    if (!step1Config.fileServerPort) {
      message.warning('请输入文件服务端口');
      return;
    }
    if (!step1Config.agentPort) {
      message.warning('请输入 Agent 端口');
      return;
    }
    if (!step1Config.workspaceDir) {
      message.warning('请选择工作区目录');
      return;
    }
    setLoading(true);
    try {
      await setupService.saveStep1Config(step1Config);
      setCurrentStep(2);
      message.success('基础配置已保存');
    } catch (error) {
      message.error('保存配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!username || !password) {
      message.warning('请输入账号和动态认证码');
      return;
    }

    const loginDomain = domain || step1Config.serverHost;
    if (!loginDomain) {
      message.warning('请输入服务域名');
      return;
    }

    setLoginLoading(true);
    setLoginError('');
    try {
      await loginAndRegister(username, password, {
        suppressToast: true,
        domain: loginDomain,
      });
      setLoginError('');
      await setupService.completeStep2();
      await setupService.completeSetup();
      setCompleted(true);
      message.success('登录成功');
      setTimeout(() => onComplete(), 2000);
    } catch (error: any) {
      const errorMessage = getAuthErrorMessage(error);
      message.error(errorMessage);
      setLoginError(errorMessage);
      setPassword('');
      setRetryCooldown(3);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleContinueLoggedIn = async () => {
    try {
      await setupService.completeStep2();
      await setupService.completeSetup();
      setCompleted(true);
      setTimeout(() => onComplete(), 1000);
    } catch {
      onComplete();
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setIsAlreadyLoggedIn(false);
      setDomain('');
    } catch {
      message.error('退出登录失败');
    }
  };

  const handleSelectWorkspaceDir = async () => {
    const result = await window.electronAPI?.dialog.openDirectory('选择工作区目录');
    if (result?.success && result.path) {
      setStep1Config({ ...step1Config, workspaceDir: result.path });
    }
  };

  const handleStepClick = useCallback(
    (step: number) => {
      if (step < currentStep - 1) {
        setCurrentStep(step + 1);
      }
    },
    [currentStep],
  );

  const renderStepContent = () => {
    if (completed) {
      return (
        <Result
          icon={<CheckCircleOutlined style={{ color: 'var(--color-success)' }} />}
          title="初始化完成"
          subTitle="正在进入主界面..."
          extra={<Spin size="small" />}
        />
      );
    }

    switch (currentStep) {
      case 1:
        return (
          <Form layout="vertical">
            <Alert
              message="基础设置"
              description="完成配置后即可使用，进度自动保存"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Form.Item label="文件服务端口" required>
              <InputNumber
                value={step1Config.fileServerPort}
                onChange={(value) =>
                  setStep1Config({
                    ...step1Config,
                    fileServerPort: value as number,
                  })
                }
                style={{ width: '100%' }}
                min={1024}
                max={65535}
              />
            </Form.Item>

            <Form.Item label="Agent 端口" required>
              <InputNumber
                value={step1Config.agentPort}
                onChange={(value) =>
                  setStep1Config({ ...step1Config, agentPort: value as number })
                }
                style={{ width: '100%' }}
                min={1024}
                max={65535}
              />
            </Form.Item>

            <Form.Item
              label="工作区目录"
              required
              validateStatus={!step1Config.workspaceDir ? 'error' : ''}
              help={!step1Config.workspaceDir ? '请选择工作区目录' : ''}
            >
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={step1Config.workspaceDir}
                  readOnly
                  placeholder="点击右侧按钮选择目录"
                  style={{ cursor: 'pointer' }}
                  onClick={handleSelectWorkspaceDir}
                />
                <Button
                  icon={<FolderOpenOutlined />}
                  onClick={handleSelectWorkspaceDir}
                >
                  选择
                </Button>
              </Space.Compact>
            </Form.Item>

            <Button
              type="primary"
              onClick={handleStep1Submit}
              loading={loading}
              block
            >
              下一步：账号登录
            </Button>
          </Form>
        );

      case 2:
        if (checkingAuth) {
          return (
            <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin size="small" />
            </div>
          );
        }

        if (isAlreadyLoggedIn) {
          return (
            <Result
              icon={<CheckCircleOutlined style={{ color: 'var(--color-success)' }} />}
              title="已登录"
              subTitle={`当前域名：${domain || '-'}`}
              extra={
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <Button onClick={handleLogout} size="small">
                    退出登录
                  </Button>
                  <Button type="primary" onClick={handleContinueLoggedIn}>
                    下一步
                  </Button>
                </div>
              }
              style={{ padding: '16px 0' }}
            />
          );
        }

        return (
          <Form layout="vertical">
            {loginError && (
              <Alert
                message="登录失败"
                description={
                  <Text
                    copyable={{ text: loginError }}
                    style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}
                  >
                    {loginError}
                  </Text>
                }
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
              />
            )}

            <Form.Item label="服务域名" required>
              <Input
                prefix={<GlobalOutlined />}
                value={domain || step1Config.serverHost}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="例如：https://agent.nuwax.com"
                autoComplete="off"
                spellCheck={false}
              />
            </Form.Item>

            <Form.Item label="账号" required>
              <Input
                prefix={<UserOutlined />}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名 / 手机号 / 邮箱"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item label="动态认证码" required>
              <Input.Password
                prefix={<LockOutlined />}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码或动态认证码（在浏览器打开你的域名登录，然后在用户资料中查看）"
                autoComplete="current-password"
              />
            </Form.Item>

            <Space style={{ width: '100%' }} direction="vertical">
              <Space>
                <Button onClick={() => setCurrentStep(1)}>上一步</Button>
                <Button
                  type="primary"
                  onClick={handleLogin}
                  loading={loginLoading}
                  disabled={retryCooldown > 0}
                >
                  {retryCooldown > 0 ? `请稍后 (${retryCooldown}s)` : '登录'}
                </Button>
              </Space>
              <div style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  支持用户名、邮箱、手机号登录
                </Text>
              </div>
            </Space>
          </Form>
        );

      default:
        return null;
    }
  };

  // 初始加载中
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>
          <Spin size="small" />
        </div>
      </div>
    );
  }

  // 阶段 1: 依赖检测/安装
  if (!dependenciesReady) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'center',
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600 }}>{APP_NAME}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
            检查和安装必需依赖
          </div>
        </div>

        <div style={styles.content}>
          <SetupDependencies onComplete={handleDepsComplete} mockApi={mockApi} />
        </div>

        <div style={styles.footer}>
          <Text style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{APP_NAME}</Text>
        </div>
      </div>
    );
  }

  // Quick Init 进行中
  if (quickIniting) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>
          <Space direction="vertical" align="center">
            <Spin size="default" />
            <Text style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>正在自动配置...</Text>
          </Space>
        </div>
      </div>
    );
  }

  // 阶段 2-4: 配置步骤
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'center',
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>初始化向导</span>
        </div>
        <div style={{ fontSize: 12, color: '#a1a1aa', textAlign: 'center' }}>
          完成配置后即可使用
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto 12px', padding: '0 8px' }}>
        <Steps
          current={currentStep - 1}
          size="small"
          onChange={handleStepClick}
          items={WIZARD_STEPS.map((step) => ({
            title: step.title,
            icon: step.icon,
            disabled: step.key > currentStep,
          }))}
        />
      </div>

      <div style={styles.content}>{renderStepContent()}</div>

      <div style={styles.footer}>
        {/* 版本号由 Vite 在构建时从 crates/agent-electron-client/package.json 的 version 注入；
            修改版本后需重启开发服务器或重新打包才能生效 */}
        <Text style={{ fontSize: 11, color: '#a1a1aa' }}>
          {APP_NAME} v{__APP_VERSION__} · 进度自动保存
        </Text>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--color-bg-layout)',
    padding: 16,
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  header: {
    marginBottom: 12,
  },
  content: {
    flex: 1,
    maxWidth: 640,
    width: '100%',
    margin: '0 auto',
    overflowY: 'auto',
    background: 'var(--color-bg-container)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: 20,
  },
  footer: {
    textAlign: 'center',
    marginTop: 8,
  },
};

export default SetupWizard;
