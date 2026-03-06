import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Menu,
  Badge,
  Spin,
} from 'antd';
import type { PresetStatusColorType } from 'antd/es/_util/colors';
import {
  SettingOutlined,
  DashboardOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  SafetyOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { setupService, authService, Step1Config } from './services/core/setup';
import { syncConfigToServer, normalizeServerHost, loginAndRegister } from './services/core/auth';
import { APP_DISPLAY_NAME, AUTH_KEYS } from '@shared/constants';
import type { QuickInitConfig } from '@shared/types/quickInit';
import SetupWizard from './components/setup/SetupWizard';
import SetupDependencies from './components/setup/SetupDependencies';
import ClientPage from './components/pages/ClientPage';
import SettingsPage from './components/pages/SettingsPage';
import DependenciesPage from './components/pages/DependenciesPage';
import AboutPage from './components/pages/AboutPage';
import LogViewer from './components/pages/LogViewer';
import PermissionsPage from './components/pages/PermissionsPage';
import styles from './styles/components/App.module.css';

// Tab 类型定义（对齐 Tauri 客户端）
type TabKey = 'client' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about';

// 状态配置（对齐 Tauri 客户端）
// 就绪、繁忙使用橙色（warning）、小点展示
const STATUS_CONFIG: Record<string, { status: PresetStatusColorType; text: string }> = {
  idle: { status: 'warning', text: '就绪' },
  starting: { status: 'processing', text: '启动中' },
  running: { status: 'success', text: '运行中' },
  busy: { status: 'warning', text: '繁忙' },
  stopped: { status: 'default', text: '已停止' },
  error: { status: 'error', text: '错误' },
};

// 服务状态接口（与 ClientPage 共享）
export interface ServiceItem {
  key: string;
  label: string;
  description: string;
  running: boolean;
  pid?: number;
  error?: string;
}

/**
 * 将 quick init 配置静默写入 DB（覆盖旧值）
 * 用于 setup 已完成时，每次启动优先使用配置文件/环境变量中的值
 */
async function applyQuickInitToDb(config: QuickInitConfig): Promise<void> {
  // 1. 更新 step1 配置
  const step1: Step1Config = {
    serverHost: normalizeServerHost(config.serverHost),
    agentPort: config.agentPort,
    fileServerPort: config.fileServerPort,
    workspaceDir: config.workspaceDir,
  };
  await setupService.saveStep1Config(step1);

  // 2. 更新 savedKey
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

  // 3. 静默重新注册（更新服务端设备信息）
  try {
    await loginAndRegister(config.username, '', {
      suppressToast: true,
      domain,
    });
  } catch (error) {
    // 注册失败不阻塞启动，已有的 auth 信息仍可用
    console.warn('[App] Quick init 静默注册失败:', error);
  }
}

function App() {
  // ============================================
  // 初始化向导状态
  // ============================================
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const setupJustCompleted = useRef(false);

  /**
   * 主界面下「必需依赖未完全安装」时是否强制进入依赖安装流程。
   * - null: 进入主界面后尚未完成检查
   * - true: 存在 missing/error 的必需依赖，全屏显示依赖安装，完成后回到主界面
   * - false: 必需依赖均已安装（含 outdated，以当前真实安装版本为准，不强制重装）
   */
  const [needsRequiredDepsReinstall, setNeedsRequiredDepsReinstall] = useState<boolean | null>(null);

  /**
   * 重启所有服务（使新安装的依赖/二进制生效）。
   * restartAll 内部已包含停止逻辑，无需额外调用 stopAll。
   */
  const restartAllServices = useCallback(async () => {
    try {
      await window.electronAPI?.services.restartAll();
    } catch (e) {
      console.error('[App] 重启服务失败:', e);
    }
  }, []);

  // ============================================
  // 核心状态
  // ============================================
  const [activeTab, setActiveTab] = useState<TabKey>('client');
  const [username, setUsername] = useState<string>('');
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>('idle');
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [startingServices, setStartingServices] = useState<Set<string>>(new Set());
  const servicesPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================
  // 检查初始化向导状态（每次启动优先读取 quick init 配置）
  // ============================================
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const completed = await setupService.isSetupCompleted();

        // 每次启动优先读取 quick init 配置
        // 有配置 → 写入 DB（覆盖旧值），再走后续流程
        // 无配置 → 使用 DB 中已有的值
        if (completed) {
          try {
            const qiConfig = await window.electronAPI?.quickInit.getConfig();
            if (qiConfig) {
              console.log('[App] 检测到快捷配置，静默更新 DB');
              await applyQuickInitToDb(qiConfig);
            }
          } catch (error) {
            console.warn('[App] 读取快捷配置失败:', error);
          }
        }

        setIsSetupComplete(completed);
      } catch (error) {
        console.error('[App] 检查初始化状态失败:', error);
        setIsSetupComplete(true);
      }
    };
    checkSetup();
  }, []);

  // ============================================
  // 初始化主界面（setup 完成后执行）
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;

    const init = async () => {
      // 加载用户信息
      const user = await authService.getAuthUser();
      if (user) {
        setUsername(user.displayName || user.username || '用户');
      }

      // 加载在线状态
      const online = await window.electronAPI?.settings.get('auth.online_status');
      setOnlineStatus(online as boolean | null);
    };

    init();
  }, [isSetupComplete]);

  // ============================================
  // 主界面下必需依赖检查：仅当存在「未安装」或「错误」时进入依赖安装
  // 版本以当前真实安装为准，outdated 不触发（用户可在依赖 Tab 手动升级）
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;

    const checkRequiredDeps = async () => {
      try {
        const result = await window.electronAPI?.dependencies.checkAll();
        const deps = result?.results ?? [];
        // 仅当存在 missing 或 error 时需要重新进入依赖安装；outdated 视为已安装，不强制
        const hasMissingOrError = deps.some(
          (d: { status: string }) => d.status === 'missing' || d.status === 'error',
        );
        setNeedsRequiredDepsReinstall(hasMissingOrError);
      } catch (error) {
        console.error('[App] 必需依赖检查失败:', error);
        setNeedsRequiredDepsReinstall(false);
      }
    };

    checkRequiredDeps();
  }, [isSetupComplete]);

  // ============================================
  // 服务状态轮询
  // ============================================
  const pollServicesStatus = useCallback(async () => {
    try {
      const items: ServiceItem[] = [];
      const [fsStatus, lpStatus, agentSvcStatus, mcpStatus, csStatus] = await Promise.all([
        window.electronAPI?.fileServer.status(),
        window.electronAPI?.lanproxy.status(),
        window.electronAPI?.agent.serviceStatus(),
        window.electronAPI?.mcp.status(),
        window.electronAPI?.computerServer.status(),
      ]);
      items.push({ key: 'mcpProxy', label: 'MCP 服务', description: 'MCP 协议聚合代理', running: mcpStatus?.running ?? false, error: mcpStatus?.error });

      // ComputerServer 是 Agent 的 HTTP 接口，仅当 Agent 本身在运行时才检查其状态
      const agentRunning = agentSvcStatus?.running ?? false;
      const csRunning = csStatus?.running ?? false;
      let agentError: string | undefined;
      if (agentRunning && !csRunning) {
        agentError = csStatus?.error
          ? `Agent 接口服务启动失败: ${csStatus.error}`
          : 'Agent 接口服务未运行';
      }
      items.push({
        key: 'agent', label: 'Agent 服务', description: 'Agent 核心服务',
        running: agentRunning && csRunning,
        error: agentError,
      });

      items.push({ key: 'fileServer', label: '文件服务', description: 'Agent 工作目录文件远程管理服务', running: fsStatus?.running ?? false, pid: fsStatus?.pid, error: fsStatus?.error });
      items.push({ key: 'lanproxy', label: '代理服务', description: '网络通道', running: lpStatus?.running ?? false, pid: lpStatus?.pid, error: lpStatus?.error });
      setServices(items);
    } catch (error) {
      console.error('[App] pollServicesStatus failed:', error);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  // ============================================
  // 逐个启动服务（实时更新状态）
  // ============================================
  const startServicesSequentially = useCallback(async (serviceKeys: string[]) => {
    for (const key of serviceKeys) {
      setStartingServices(prev => new Set(prev).add(key));
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
          });
          // ComputerServer 是 Agent 的 HTTP 接口，随 Agent 一起启动
          await window.electronAPI?.computerServer.start().catch(() => undefined);
        } else if (key === 'fileServer') {
          const step1 = await window.electronAPI?.settings.get('step1_config') as { fileServerPort?: number } | null;
          result = await window.electronAPI?.fileServer.start(step1?.fileServerPort ?? 60000);
        } else if (key === 'lanproxy') {
          const clientKey = await window.electronAPI?.settings.get('auth.saved_key') as string | null;
          const lpConfig = await window.electronAPI?.settings.get('lanproxy_config') as any;
          const serverIp = lpConfig?.serverIp || (await window.electronAPI?.settings.get('lanproxy.server_host') as string)?.replace(/^https?:\/\//, '');
          const serverPort = lpConfig?.serverPort || await window.electronAPI?.settings.get('lanproxy.server_port');
          if (serverIp && clientKey && serverPort) {
            result = await window.electronAPI?.lanproxy.start({ serverIp, serverPort, clientKey, ssl: lpConfig?.ssl });
          }
        } else if (key === 'mcpProxy') {
          result = await window.electronAPI?.mcp.start();
        }

        await pollServicesStatus();
      } catch (e) {
        console.error(`[App] 启动 ${key} 失败:`, e);
      } finally {
        setStartingServices(prev => { const next = new Set(prev); next.delete(key); return next; });
      }
    }
  }, [pollServicesStatus]);

  // ============================================
  // 自动重连（等待依赖检查完成后再执行，避免竞态）
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;
    // 等待依赖检查完成；若有缺失依赖则跳过（依赖安装完成后会通过 restartAll 启动服务）
    if (needsRequiredDepsReinstall !== false) return;

    const autoReconnect = async () => {
      // 如果 ClientPage handleLogin 已经启动了服务，跳过自动重连
      // 无论是否命中，都先清除标记，防止 crash 后标记残留导致永久跳过
      const loginStarted = await window.electronAPI?.settings.get('_services_started_by_login');
      await window.electronAPI?.settings.set('_services_started_by_login', false);
      if (loginStarted) {
        console.log('[App] 服务已由登录流程启动，跳过自动重连');
        return;
      }

      // 如果向导刚完成，启动所有服务
      if (setupJustCompleted.current) {
        setupJustCompleted.current = false;
        console.log('[App] 初始化向导刚完成，启动所有服务...');
        // 顺序：先 MCP 服务（Agent 依赖），最后代理服务（Lanproxy）
        await startServicesSequentially(['mcpProxy', 'agent', 'fileServer', 'lanproxy']);
        return;
      }

      try {
        const savedKey = await window.electronAPI?.settings.get('auth.saved_key');
        if (savedKey) {
          console.log('[App] 检测到 savedKey，自动重连...');
          const result = await syncConfigToServer({ suppressToast: true });
          if (result) {
            console.log('[App] 重连成功');
            setOnlineStatus(result.online);
            // 更新用户名显示
            const user = await authService.getAuthUser();
            if (user) {
              setUsername(user.displayName || user.username || '用户');
            }
            // 启动所有服务（顺序：先 MCP，最后 Lanproxy）
            console.log('[App] 启动所有服务...');
            await startServicesSequentially(['mcpProxy', 'agent', 'fileServer', 'lanproxy']);
          } else {
            console.warn('[App] 配置同步失败');
          }
        } else {
          console.log('[App] 未检测到 savedKey，跳过自动重连');
        }
      } catch (error) {
        console.error('[App] 自动重连失败:', error);
      }
    };

    autoReconnect();
  }, [isSetupComplete, needsRequiredDepsReinstall, startServicesSequentially]);

  // ============================================
  // 根据服务状态计算 Agent 状态
  // ============================================
  // 根据服务状态计算 Agent 状态（对齐 Tauri 客户端逻辑）
  useEffect(() => {
    // 如果正在加载，保持当前状态不变（避免初始加载时的闪烁）
    if (servicesLoading) {
      return;
    }

    if (services.length === 0) {
      setAgentStatus('idle');
      return;
    }

    const runningCount = services.filter((s) => s.running).length;
    const totalCount = services.length;
    const hasErrors = services.some((s) => !!s.error);

    if (hasErrors) {
      setAgentStatus('error');
    } else if (runningCount === totalCount && runningCount > 0) {
      setAgentStatus('running');
    } else if (runningCount > 0 && runningCount < totalCount) {
      setAgentStatus('busy');
    } else if (runningCount === 0) {
      setAgentStatus('stopped');
    } else {
      setAgentStatus('idle');
    }
  }, [services, servicesLoading]);

  // 启动服务状态轮询
  useEffect(() => {
    if (isSetupComplete !== true) return;

    // 立即执行一次
    pollServicesStatus();

    // 每 5 秒轮询一次
    servicesPollTimer.current = setInterval(pollServicesStatus, 5000);

    return () => {
      if (servicesPollTimer.current) {
        clearInterval(servicesPollTimer.current);
      }
    };
  }, [isSetupComplete]);

  // ============================================
  // 监听托盘/菜单事件
  // ============================================
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanupHandlers: (() => void)[] = [];

    // 监听设置菜单
    const handleSettings = () => {
      console.log('[App] 收到 menu:settings 事件');
      setActiveTab('settings');
    };
    window.electronAPI.on('menu:settings', handleSettings);
    cleanupHandlers.push(() => window.electronAPI?.off('menu:settings', handleSettings));

    // 监听依赖管理菜单
    const handleDependencies = () => {
      console.log('[App] 收到 menu:dependencies 事件');
      setActiveTab('dependencies');
    };
    window.electronAPI.on('menu:dependencies', handleDependencies);
    cleanupHandlers.push(() => window.electronAPI?.off('menu:dependencies', handleDependencies));

    // 监听 MCP 设置菜单
    const handleMcpSettings = () => {
      console.log('[App] 收到 menu:mcp-settings 事件');
      setActiveTab('settings');
    };
    window.electronAPI.on('menu:mcp-settings', handleMcpSettings);
    cleanupHandlers.push(() => window.electronAPI?.off('menu:mcp-settings', handleMcpSettings));

    // 监听新建会话菜单
    const handleNewSession = () => {
      console.log('[App] 收到 menu:new-session 事件');
      setActiveTab('client');
    };
    window.electronAPI.on('menu:new-session', handleNewSession);
    cleanupHandlers.push(() => window.electronAPI?.off('menu:new-session', handleNewSession));

    return () => {
      cleanupHandlers.forEach(fn => fn());
    };
  }, []);

  // ============================================
  // 向导完成回调
  // ============================================
  const handleSetupComplete = () => {
    setupJustCompleted.current = true;
    setIsSetupComplete(true);
  };

  // ============================================
  // 状态 Badge
  // ============================================
  const badge = STATUS_CONFIG[agentStatus] || STATUS_CONFIG.idle;

  // ============================================
  // 平台检测
  // ============================================
  const isMacOS = navigator.platform.toUpperCase().includes('MAC');

  // ============================================
  // 菜单配置（对齐 Tauri 客户端）
  // ============================================
  const menuItems = useMemo(() => {
    const items = [
      { key: 'client', icon: <DashboardOutlined />, label: '客户端' },
      { key: 'settings', icon: <SettingOutlined />, label: '设置' },
      { key: 'dependencies', icon: <FolderOutlined />, label: '依赖' },
    ];
    if (isMacOS) {
      items.push({ key: 'permissions', icon: <SafetyOutlined />, label: '授权' });
    }
    items.push(
      { key: 'logs', icon: <FileTextOutlined />, label: '日志' },
      { key: 'about', icon: <InfoCircleOutlined />, label: '关于' },
    );
    return items;
  }, [isMacOS]);

  // ============================================
  // 渲染：加载中（含等待依赖检查完成）
  // ============================================
  if (isSetupComplete === null || (isSetupComplete && needsRequiredDepsReinstall === null)) {
    return (
      <div className="app-loading">
        <Spin size="large" />
        <div className="app-loading-text">
          正在加载...
        </div>
      </div>
    );
  }

  // ============================================
  // 渲染：初始化向导
  // ============================================
  if (!isSetupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  // ============================================
  // 渲染：主界面下必需依赖未满足 → 全屏依赖安装，完成后重启服务回到主界面
  // ============================================
  if (needsRequiredDepsReinstall === true) {
    return (
      <SetupDependencies
        onComplete={async () => {
          // 先回到主界面，再在后台重启服务（使新安装的依赖生效）
          setNeedsRequiredDepsReinstall(false);
          await restartAllServices();
        }}
      />
    );
  }

  // ============================================
  // 渲染：主界面
  // ============================================
  return (
    <div className="app-container">
      {/* 顶部栏 */}
      <div className="app-header">
        <div className="app-header-logo">
          <img src="./32x32.png" alt="" style={{ width: 16, height: 16 }} />
          <span className="app-header-title">{APP_DISPLAY_NAME}</span>
        </div>
        <div className={styles.headerRight}>
          {username && (
            <span className={styles.username}>{username}</span>
          )}
          <Badge
            status={badge.status}
            className={agentStatus === 'idle' || agentStatus === 'busy' ? styles.badgeIdle : undefined}
            text={
              <span className={styles.badgeText}>{badge.text}</span>
            }
          />
        </div>
      </div>

      {/* 主体部分 */}
      <div className="app-body">
        {/* 左侧边栏 */}
        <div className="app-sider">
          <Menu
            mode="inline"
            selectedKeys={[activeTab]}
            items={menuItems.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              onClick: () => setActiveTab(item.key as TabKey),
            }))}
          />
        </div>

        {/* 主内容区：flex 子撑满，便于日志等页占满高度 */}
        <div className="app-content">
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'client' && (
            <ClientPage
              onNavigate={setActiveTab}
              services={services}
              servicesLoading={servicesLoading}
              startingServices={startingServices}
              setStartingServices={setStartingServices}
              onRefreshServices={pollServicesStatus}
            />
          )}
          {activeTab === 'settings' && <SettingsPage />}
          {activeTab === 'dependencies' && <DependenciesPage />}
          {activeTab === 'permissions' && <PermissionsPage />}
          {activeTab === 'logs' && <LogViewer />}
          {activeTab === 'about' && <AboutPage />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
