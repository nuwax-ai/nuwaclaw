import React, { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from 'react';
import {
  ConfigProvider,
  Menu,
  Badge,
  Spin,
  Button,
  notification,
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
import { lightTheme, darkTheme } from './styles/theme';

// 主题类型
export type ThemeMode = 'light' | 'dark' | 'system';

// 主题 Context
interface ThemeContextValue {
  themeMode: ThemeMode;
  isDarkMode: boolean;
  setThemeMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

// Hook to use theme context
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within App component');
  }
  return context;
}

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

  // ============================================
  // 主题状态
  // ============================================
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [systemIsDark, setSystemIsDark] = useState(false);

  // 计算实际使用的主题
  const isDarkMode = useMemo(() => {
    if (themeMode === 'system') {
      return systemIsDark;
    }
    return themeMode === 'dark';
  }, [themeMode, systemIsDark]);

  const currentTheme = useMemo(() => isDarkMode ? darkTheme : lightTheme, [isDarkMode]);

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemIsDark(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // 加载保存的主题设置
  useEffect(() => {
    const loadThemeSetting = async () => {
      try {
        const saved = await window.electronAPI?.settings.get('theme_mode') as ThemeMode | null;
        if (saved && ['light', 'dark', 'system'].includes(saved)) {
          setThemeMode(saved);
        }
      } catch (e) {
        console.warn('[App] 加载主题设置失败:', e);
      }
    };
    loadThemeSetting();
  }, []);

  // 保存主题设置
  const handleSetThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeMode(mode);
    try {
      await window.electronAPI?.settings.set('theme_mode', mode);
    } catch (e) {
      console.warn('[App] 保存主题设置失败:', e);
    }
  }, []);

  // 应用主题到 body
  useEffect(() => {
    document.body.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  /**
   * 主界面下「必需依赖未完全安装」时是否强制进入依赖安装流程。
   * - null: 进入主界面后尚未完成检查
   * - true: 存在 missing/error 的必需依赖，全屏显示依赖安装，完成后回到主界面
   * - false: 必需依赖均已安装（含 outdated，以当前真实安装版本为准，不强制重装）
   */
  const [needsRequiredDepsReinstall, setNeedsRequiredDepsReinstall] = useState<boolean | null>(null);
  /** 主进程初始化依赖同步是否仍在进行（客户端升级后后台安装新版本依赖） */
  const [depsSyncInProgress, setDepsSyncInProgress] = useState<boolean>(false);

  /**
   * 重启所有服务（使新安装的依赖/二进制生效）。
   * restartAll 内部已包含停止逻辑，无需额外调用 stopAll。
   *
   * 重启前先调 reg 接口，将本次返回的最新 serverHost/serverPort 写入配置，
   * 确保 lanproxy 使用最新服务端地址，而不是 SQLite 里的旧缓存值。
   */
  const restartAllServices = useCallback(async () => {
    try {
      // 先 reg 拿最新 serverHost/serverPort 写入配置，成功后再重启服务。
      // reg 失败（网络不通/token 过期）时中止重启，并弹出通知让用户手动重试。
      await syncConfigToServer({ suppressToast: true });
    } catch (e) {
      console.error('[App] reg 同步失败，中止重启服务:', e);
      const notifKey = 'restartRegFailed';
      notification.error({
        key: notifKey,
        message: '配置同步失败',
        description: '无法连接到服务器获取最新配置，服务未重启。请检查网络后重试。',
        duration: 0,
        placement: 'bottomRight',
        btn: (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              notification.destroy(notifKey);
              restartAllServices();
            }}
          >
            重试
          </Button>
        ),
      });
      return;
    }

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
  /** 递增后通知 ClientPage 刷新账号状态（用户名等），与 reg 返回保持一致 */
  const [authRefreshTrigger, setAuthRefreshTrigger] = useState(0);

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
  // 子组件登录/注销后刷新顶部栏用户名
  // ============================================
  const handleAuthChange = useCallback(async () => {
    const user = await authService.getAuthUser();
    if (user) {
      setUsername(user.displayName || user.username || '用户');
    } else {
      setUsername('');
    }
  }, []);

  // ============================================
  // 主界面下必需依赖检查：仅当存在「未安装」或「错误」时进入依赖安装
  // 版本以当前真实安装为准，outdated 不触发（用户可在依赖 Tab 手动升级）
  // 同时检测主进程初始化依赖同步状态，避免服务启动时依赖尚未安装完成
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;
    let cancelled = false;

    // 先注册事件监听，再做 checkAll，避免事件在 checkAll 返回前触发而丢失
    const handleDepsSyncCompleted = () => {
      console.log('[App] deps:syncCompleted, 依赖同步完成');
      setDepsSyncInProgress(false);
    };
    window.electronAPI?.on('deps:syncCompleted', handleDepsSyncCompleted as any);

    const checkRequiredDeps = async () => {
      try {
        const result = await window.electronAPI?.dependencies.checkAll();
        if (cancelled) return;
        const deps = result?.results ?? [];
        // 仅当存在 missing 或 error 时需要重新进入依赖安装；outdated 视为已安装，不强制
        const hasMissingOrError = deps.some(
          (d: { status: string }) => d.status === 'missing' || d.status === 'error',
        );
        setNeedsRequiredDepsReinstall(hasMissingOrError);
        // 记录主进程初始化依赖同步状态
        if (result?.syncInProgress) {
          setDepsSyncInProgress(true);
          // 防竞态：checkAll 返回 syncInProgress=true 但事件可能已经在 checkAll IPC 期间触发过了，
          // 再次确认主进程当前真实状态，避免 depsSyncInProgress 永远卡在 true
          const recheck = await window.electronAPI?.dependencies.checkAll();
          if (cancelled) return;
          if (!recheck?.syncInProgress) {
            setDepsSyncInProgress(false);
          }
        }
      } catch (error) {
        console.error('[App] 必需依赖检查失败:', error);
        if (!cancelled) setNeedsRequiredDepsReinstall(false);
      }
    };

    checkRequiredDeps();

    return () => {
      cancelled = true;
      window.electronAPI?.off('deps:syncCompleted', handleDepsSyncCompleted as any);
    };
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
  // 自动重连（等待依赖检查及同步完成后再执行，避免竞态）
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;
    // 等待依赖检查完成；若有缺失依赖则跳过（依赖安装完成后会通过 restartAll 启动服务）
    if (needsRequiredDepsReinstall !== false) return;
    // 等待主进程初始化依赖同步完成，避免服务使用旧版本二进制
    if (depsSyncInProgress) {
      console.log('[App] 主进程依赖同步中，延迟自动启动服务');
      return;
    }

    // 重新打开客户端时：若有 savedKey，先调 reg 接口，仅当 reg 成功返回后才启动服务。
    // 因 reg 返回内容可能会变化（如 serverHost/serverPort 等），必须先拿到本次最新结果并写入配置，再启动服务，避免用到旧配置。
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
          // 用户已退出登录时（configKey 被清除），不自动重连，需用户手动登录
          const configKey = await window.electronAPI?.settings.get('auth.config_key');
          if (!configKey) {
            console.log('[App] 检测到 savedKey 但用户已退出登录，跳过自动重连');
            return;
          }
          console.log('[App] 检测到 savedKey，自动重连（先调 reg 接口）...');
          // 必须等待 reg 成功返回后再启动服务；syncConfigToServer 会把本次 reg 返回的 serverHost/serverPort 等写入配置，供后续启动使用
          const result = await syncConfigToServer({ suppressToast: true });
          if (result) {
            console.log('[App] reg 成功，使用本次返回配置启动服务');
            setOnlineStatus(result.online);
            // 更新用户名显示（顶部栏）
            const user = await authService.getAuthUser();
            if (user) {
              setUsername(user.displayName || user.username || '用户');
            }
            // 通知客户端 Tab 刷新账号状态（用户名等）以与 reg 返回一致
            setAuthRefreshTrigger((t) => t + 1);
            // reg 已成功，此时再启动所有服务（顺序：先 MCP，最后 Lanproxy）
            await startServicesSequentially(['mcpProxy', 'agent', 'fileServer', 'lanproxy']);
          } else {
            // 配置同步失败：reg 请求失败（网络断开 / 服务器不可达 / token 过期等）。仍使用本地已保存的配置尝试启动服务，避免 Windows 等环境下完全无法使用。
            console.warn('[App] 配置同步失败，使用本地已保存配置尝试启动服务');
            notification.info({
              message: '自动重连失败',
              description:
                '无法连接到服务器。正在使用本地已保存的配置尝试启动服务；若需最新配置请检查网络后重新登录。',
              duration: 8,
              placement: 'bottomRight',
            });
            // 使用本地已保存的 lanproxy_config / step1_config 等尝试启动，保证至少能尝试拉起服务（含 Windows 客户端）
            await startServicesSequentially(['mcpProxy', 'agent', 'fileServer', 'lanproxy']);
          }
        } else {
          console.log('[App] 未检测到 savedKey，跳过自动重连');
        }
      } catch (error) {
        console.error('[App] 自动重连失败:', error);
      }
    };

    autoReconnect();
  }, [isSetupComplete, needsRequiredDepsReinstall, depsSyncInProgress, startServicesSequentially]);

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
      <ConfigProvider theme={currentTheme}>
        <div className="app-loading">
          <Spin size="large" />
          <div className="app-loading-text">
            正在加载...
          </div>
        </div>
      </ConfigProvider>
    );
  }

  // ============================================
  // 渲染：初始化向导
  // ============================================
  if (!isSetupComplete) {
    return (
      <ConfigProvider theme={currentTheme}>
        <SetupWizard onComplete={handleSetupComplete} />
      </ConfigProvider>
    );
  }

  // ============================================
  // 渲染：主界面下必需依赖未满足 → 全屏依赖安装，完成后重启服务回到主界面
  // ============================================
  if (needsRequiredDepsReinstall === true) {
    return (
      <ConfigProvider theme={currentTheme}>
        <SetupDependencies
          onComplete={async () => {
            // 先回到主界面，再在后台重启服务（使新安装的依赖生效）
            setNeedsRequiredDepsReinstall(false);
            await restartAllServices();
          }}
        />
      </ConfigProvider>
    );
  }

  // ============================================
  // 渲染：主界面
  // ============================================
  return (
    <ConfigProvider theme={currentTheme}>
      <ThemeContext.Provider value={{ themeMode, isDarkMode, setThemeMode: handleSetThemeMode }}>
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
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-layout)' }}>
            {activeTab === 'client' && (
              <ClientPage
                onNavigate={setActiveTab}
                services={services}
                servicesLoading={servicesLoading}
                startingServices={startingServices}
                setStartingServices={setStartingServices}
                onRefreshServices={pollServicesStatus}
                authRefreshTrigger={authRefreshTrigger}
                onAuthChange={handleAuthChange}
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
      </ThemeContext.Provider>
    </ConfigProvider>
  );
}

export default App;
