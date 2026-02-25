import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Menu,
  Badge,
  Spin,
} from 'antd';
import type { PresetStatusColorType } from 'antd/es/_util/colors';
import {
  RobotOutlined,
  SettingOutlined,
  DashboardOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  SafetyOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { setupService, authService } from './services/renderer/setup';
import { syncConfigToServer } from './services/renderer/auth';
import { APP_DISPLAY_NAME } from './commons/constants';
import SetupWizard from './components/SetupWizard';
import ClientPage from './components/ClientPage';
import SettingsPage from './components/SettingsPage';
import DependenciesPage from './components/DependenciesPage';
import AboutPage from './components/AboutPage';
import LogViewer from './components/LogViewer';
import PermissionsPage from './components/PermissionsPage';
import styles from './styles/components/App.module.css';

// Tab 类型定义（对齐 Tauri 客户端）
type TabKey = 'client' | 'settings' | 'dependencies' | 'permissions' | 'logs' | 'about';

// 状态配置（对齐 Tauri 客户端）
const STATUS_CONFIG: Record<string, { status: PresetStatusColorType; text: string }> = {
  idle: { status: 'default', text: '就绪' },
  starting: { status: 'processing', text: '启动中' },
  running: { status: 'success', text: '运行中' },
  busy: { status: 'success', text: '繁忙' },
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
}

function App() {
  // ============================================
  // 初始化向导状态
  // ============================================
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const setupJustCompleted = useRef(false);

  // ============================================
  // 核心状态
  // ============================================
  const [activeTab, setActiveTab] = useState<TabKey>('client');
  const [username, setUsername] = useState<string>('');
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>('idle');
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const servicesPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================
  // 检查初始化向导状态
  // ============================================
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const completed = await setupService.isSetupCompleted();
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
  // 自动重连（对齐 Tauri 客户端）
  // setup 完成后检查 savedKey → syncConfigToServer
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;

    const autoReconnect = async () => {
      // 如果向导刚完成，服务已在向导中启动，跳过自动重连
      if (setupJustCompleted.current) {
        setupJustCompleted.current = false;
        console.log('[App] 初始化向导刚完成，跳过自动重连');
        return;
      }

      // 如果 ClientPage handleLogin 已经启动了服务，跳过自动重连
      // 无论是否命中，都先清除标记，防止 crash 后标记残留导致永久跳过
      const loginStarted = await window.electronAPI?.settings.get('_services_started_by_login');
      await window.electronAPI?.settings.set('_services_started_by_login', false);
      if (loginStarted) {
        console.log('[App] 服务已由登录流程启动，跳过自动重连');
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
            // 重启所有服务（对齐 Tauri services_restart_all）
            try {
              console.log('[App] 重启所有服务...');
              const restartResult = await window.electronAPI?.services.restartAll();
              console.log('[App] 服务重启结果:', restartResult);
            } catch (e) {
              console.error('[App] 服务重启失败:', e);
            }
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
  }, [isSetupComplete]);

  // ============================================
  // 服务状态轮询 & 状态计算（对齐 Tauri 客户端）
  // ============================================
  const pollServicesStatus = useCallback(async () => {
    try {
      const items: ServiceItem[] = [];

      // File Server
      const fsStatus = await window.electronAPI?.fileServer.status();
      items.push({
        key: 'fileServer',
        label: '文件服务',
        description: 'Agent 工作目录文件远程管理服务',
        running: fsStatus?.running ?? false,
        pid: fsStatus?.pid,
      });

      // Lanproxy
      const lpStatus = await window.electronAPI?.lanproxy.status();
      items.push({
        key: 'lanproxy',
        label: '代理服务',
        description: '网络通道',
        running: lpStatus?.running ?? false,
        pid: lpStatus?.pid,
      });

      // Agent
      const agentSvcStatus = await window.electronAPI?.agent.serviceStatus();
      items.push({
        key: 'agent',
        label: 'Agent 服务',
        description: 'Agent 核心服务',
        running: agentSvcStatus?.running ?? false,
      });

      // MCP Proxy
      const mcpStatus = await window.electronAPI?.mcp.status();
      items.push({
        key: 'mcpProxy',
        label: 'MCP 服务',
        description: 'MCP 协议转换工具',
        running: mcpStatus?.running ?? false,
        pid: mcpStatus?.pid,
      });

      setServices(items);
    } catch (error) {
      console.error('[App] pollServicesStatus failed:', error);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  // 根据服务状态计算 Agent 状态（对齐 Tauri 客户端逻辑）
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

    if (runningCount === totalCount && runningCount > 0) {
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
  // 渲染：加载中
  // ============================================
  if (isSetupComplete === null) {
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
  // 渲染：主界面
  // ============================================
  return (
    <div className="app-container">
      {/* 顶部栏 */}
      <div className="app-header">
        <div className="app-header-logo">
          <RobotOutlined style={{ fontSize: 16, color: '#18181b' }} />
          <span className="app-header-title">{APP_DISPLAY_NAME}</span>
        </div>
        <div className={styles.headerRight}>
          {username && (
            <span className={styles.username}>{username}</span>
          )}
          <Badge status={badge.status} text={
            <span className={styles.badgeText}>{badge.text}</span>
          } />
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

        {/* 主内容区 */}
        <div className="app-content">
          {activeTab === 'client' && (
            <ClientPage
              onNavigate={setActiveTab}
              services={services}
              servicesLoading={servicesLoading}
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
  );
}

export default App;
