import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  ConfigProvider,
  Menu,
  Badge,
  Spin,
  Button,
  notification,
  message,
  Alert,
  Tag,
  Tooltip,
} from "antd";
import type { PresetStatusColorType } from "antd/es/_util/colors";
import {
  SettingOutlined,
  DashboardOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  SafetyOutlined,
  FileTextOutlined,
  TeamOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  OrderedListOutlined,
  CommentOutlined,
  RetweetOutlined,
  CodeOutlined,
  EllipsisOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import {
  setupService,
  authService,
  Step1Config,
  DEFAULT_STEP1_CONFIG,
} from "./services/core/setup";
import {
  syncConfigToServer,
  normalizeServerHost,
  loginAndRegister,
} from "./services/core/auth";
import {
  APP_DISPLAY_NAME,
  AUTH_KEYS,
  STORAGE_KEYS,
  I18N_KEYS,
} from "@shared/constants";
import type { ClientMode } from "@shared/constants";
import type { QuickInitConfig } from "@shared/types/quickInit";
import { t, getCurrentLang } from "./services/core/i18n";
import SetupWizard from "./components/setup/SetupWizard";
import SetupDependencies from "./components/setup/SetupDependencies";
import ClientPage from "./components/pages/ClientPage";
import SettingsPage from "./components/pages/SettingsPage";
import DependenciesPage from "./components/pages/DependenciesPage";
import AboutPage from "./components/pages/AboutPage";
import LogViewer from "./components/pages/LogViewer";
import PermissionsPage from "./components/pages/PermissionsPage";
import SessionsPage from "./components/pages/SessionsPage";
import AppDevPage from "./components/pages/AppDevPage";
import { TasksPage } from "./components/pages/TasksPage";
import type { WebviewHeaderActions } from "./components/pages/SessionsPage";
import PermissionRequestCard from "./components/PermissionRequestCard";
import type { PendingPermission } from "./components/PermissionRequestCard";
import InteractiveQuestionCard from "./components/InteractiveQuestionCard";
import type { PendingQuestion } from "./components/InteractiveQuestionCard";
import { createLogger } from "./services/utils/rendererLog";
import styles from "./styles/components/App.module.css";
import { lightTheme, darkTheme } from "./styles/theme";
import { FEATURES } from "@shared/featureFlags";

// 主题类型
export type ThemeMode = "light" | "dark" | "system";

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
    throw new Error("useTheme must be used within App component");
  }
  return context;
}

// i18n 语言 Context
interface I18nContextValue {
  lang: string;
  updateLang: (lang: string) => void;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18nLang(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18nLang must be used within App component");
  }
  return context;
}

// Tab 类型定义（对齐 Tauri 客户端）
type TabKey =
  | "client"
  | "sessions"
  | "tasks"
  | "settings"
  | "dependencies"
  | "permissions"
  | "logs"
  | "about"
  | "model"
  | "appdev";

// 状态配置（对齐 Tauri 客户端）
// 就绪、繁忙使用橙色（warning）、小点展示
const STATUS_CONFIG: Record<
  string,
  { status: PresetStatusColorType; textKey: string }
> = {
  idle: { status: "warning", textKey: "Claw.Agent.Status.idle" },
  starting: { status: "processing", textKey: "Claw.Agent.Status.starting" },
  running: { status: "success", textKey: "Claw.Agent.Status.running" },
  busy: { status: "warning", textKey: "Claw.Agent.Status.busy" },
  stopped: { status: "default", textKey: "Claw.Agent.Status.stopped" },
  error: { status: "error", textKey: "Claw.Agent.Status.error" },
};

// 服务状态接口（与 ClientPage 共享）
export interface ServiceItem {
  key: string;
  label: string;
  description: string;
  running: boolean;
  pid?: number;
  port?: number;
  error?: string;
  /** 重启次数（可选，由服务提供） */
  restartCount?: number;
  /** 内存占用字节（可选） */
  memoryBytes?: number;
  /** 上次错误时间戳（可选） */
  lastErrorAt?: number;
  /** 健康状态（仅运行中服务有意义） */
  health?: "healthy" | "degraded" | "unhealthy";
  /** 运行时长 ms（来自 ProcessLifecycleManager） */
  uptimeMs?: number;
  /** 最近崩溃时间戳（来自 ProcessLifecycleManager） */
  lastCrashAt?: number;
}

export interface SystemResources {
  /** CPU 使用率（0–100） */
  cpuPct: number;
  /** 已用内存（MB） */
  memUsedMB: number;
  /** 总内存（MB） */
  memTotalMB: number;
}

/** 根据服务运行状态 + 错误 + 重启次数计算健康级别 */
function computeServiceHealth(
  running: boolean,
  error?: string,
  restartCount?: number,
): ServiceItem["health"] {
  if (!running) return error ? "unhealthy" : undefined;
  if (error || (restartCount ?? 0) > 0) return "degraded";
  return "healthy";
}

/**
 * 将 quick init 配置静默写入 DB（覆盖旧值）
 * 用于 setup 已完成时，每次启动优先使用配置文件/环境变量中的值
 */
async function applyQuickInitToDb(config: QuickInitConfig): Promise<void> {
  // 1. 更新 step1 配置
  const step1: Step1Config = {
    ...DEFAULT_STEP1_CONFIG,
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
    await loginAndRegister(config.username, "", {
      suppressToast: true,
      domain,
    });
  } catch (error) {
    // 注册失败不阻塞启动，已有的 auth 信息仍可用
    console.warn("[App] Quick init silent registration failed:", error);
  }
}

function App() {
  // ============================================
  // 初始化向导状态
  // ============================================
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const setupJustCompleted = useRef(false);
  // 内存变量：标记服务是否由登录流程启动（不持久化）
  const loginStartedRef = useRef(false);

  // ============================================
  // 主题状态
  // ============================================
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemIsDark, setSystemIsDark] = useState(false);

  // 计算实际使用的主题
  const isDarkMode = useMemo(() => {
    if (themeMode === "system") {
      return systemIsDark;
    }
    return themeMode === "dark";
  }, [themeMode, systemIsDark]);

  const currentTheme = useMemo(
    () => (isDarkMode ? darkTheme : lightTheme),
    [isDarkMode],
  );

  // ============================================
  // i18n 语言状态（响应式，供 Context 下发）
  // ============================================
  const [i18nLang, setI18nLang] = useState(getCurrentLang());
  const handleI18nLangChange = useCallback((lang: string) => {
    setI18nLang(lang);
  }, []);

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemIsDark(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // 加载保存的主题设置
  useEffect(() => {
    const loadThemeSetting = async () => {
      try {
        const saved = (await window.electronAPI?.settings.get(
          "theme_mode",
        )) as ThemeMode | null;
        if (saved && ["light", "dark", "system"].includes(saved)) {
          setThemeMode(saved);
        }
      } catch (e) {
        console.warn("[App] Failed to load theme settings:", e);
      }
    };
    loadThemeSetting();
  }, []);

  // 保存主题设置
  const handleSetThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeMode(mode);
    try {
      await window.electronAPI?.settings.set("theme_mode", mode);
    } catch (e) {
      console.warn("[App] Failed to save theme settings:", e);
    }
  }, []);

  // ============================================
  // 客户端模式状态（chat / general / code）
  // ============================================
  const [clientMode, setClientMode] = useState<ClientMode>("general");

  useEffect(() => {
    window.electronAPI?.settings
      .get(STORAGE_KEYS.CLIENT_MODE)
      .then((v) => {
        if (v && ["chat", "general", "code"].includes(v as string)) {
          setClientMode(v as ClientMode);
        }
      })
      .catch(() => {});
  }, []);

  const handleModeChange = useCallback((mode: ClientMode) => {
    setClientMode(mode);
    window.electronAPI?.settings
      .set(STORAGE_KEYS.CLIENT_MODE, mode)
      .catch(() => {});
  }, []);

  // 应用主题到 body
  useEffect(() => {
    document.body.setAttribute("data-theme", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  /**
   * 主界面下「必需依赖未完全安装」时是否强制进入依赖安装流程。
   * - null: 进入主界面后尚未完成检查
   * - true: 存在 missing/error 的必需依赖，全屏显示依赖安装，完成后回到主界面
   * - false: 必需依赖均已安装（含 outdated，以当前真实安装版本为准，不强制重装）
   */
  const [needsRequiredDepsReinstall, setNeedsRequiredDepsReinstall] = useState<
    boolean | null
  >(null);
  /** 主进程初始化依赖同步是否仍在进行（客户端升级后后台安装新版本依赖） */
  const [depsSyncInProgress, setDepsSyncInProgress] = useState<boolean>(false);

  // 启动日志：便于快速确认渲染进程 feature flags 是否生效
  useEffect(() => {
    console.info("[FeatureFlags][renderer]", FEATURES);
    window.electronAPI?.log
      .write("info", "[FeatureFlags][renderer]", FEATURES)
      .catch(() => {});
  }, []);

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
      console.error("[App] Reg sync failed, aborting service restart:", e);
      const notifKey = "restartRegFailed";
      notification.error({
        key: notifKey,
        message: t("Claw.App.ConfigSyncFailed"),
        description: t("Claw.App.ConfigSyncFailedDetail"),
        duration: 0,
        placement: "bottomRight",
        btn: (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              notification.destroy(notifKey);
              restartAllServices();
            }}
          >
            {t("Claw.App.Retry")}
          </Button>
        ),
      });
      return;
    }

    try {
      message.loading({
        content: t("Claw.App.RestartingServices"),
        key: "restart-services",
      });
      await window.electronAPI?.services.restartAll();
      message.success({
        content: t("Claw.App.RestartSuccess"),
        key: "restart-services",
      });
    } catch (e) {
      console.error("[App] Failed to restart services:", e);
      message.error({
        content: t("Claw.App.RestartFailed"),
        key: "restart-services",
      });
    }
  }, []);

  // ============================================
  // 核心状态
  // ============================================
  const [activeTab, setActiveTab] = useState<TabKey>("client");
  const [sessionsAutoOpen, setSessionsAutoOpen] = useState(false);
  const [webviewActions, setWebviewActions] =
    useState<WebviewHeaderActions | null>(null);
  const [username, setUsername] = useState<string>("");
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>("idle");
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [systemResources, setSystemResources] =
    useState<SystemResources | null>(null);
  const [guiMcpEnabled, setGuiMcpEnabled] = useState(false);
  const [pollFailCount, setPollFailCount] = useState(0);
  const [startingServices, setStartingServices] = useState<Set<string>>(
    new Set(),
  );
  const servicesPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 代理服务通道健康检查错误 */
  const lanproxyHealthErrorRef = useRef<string | undefined>(undefined);
  /** 递增后通知 ClientPage 刷新账号状态（用户名等），与 reg 返回保持一致 */
  const [authRefreshTrigger, setAuthRefreshTrigger] = useState(0);
  /** 待确认权限队列（来自 ACP permission.updated 事件） */
  const [pendingPermissions, setPendingPermissions] = useState<
    PendingPermission[]
  >([]);
  /** 待确认问题队列（来自 ACP question.requested 事件） */
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>(
    [],
  );
  /** 待确认模型切换请求（来自 ACP confirm.modelSwitch 事件） */
  const [pendingModelSwitch, setPendingModelSwitch] = useState<{
    requestId: string;
    currentModel: string;
    newModel: string;
  } | null>(null);
  /** T3.5 — 待确认检查点（来自 ACP confirm.checkpoint 事件） */
  const [pendingCheckpoint, setPendingCheckpoint] = useState<{
    sessionId: string;
    toolCallsSoFar: number;
    reason: "tool_count" | "time";
  } | null>(null);
  /** Harness 审批请求（来自 harness:approvalRequested 事件） */
  const [pendingApproval, setPendingApproval] = useState<{
    approvalId: string;
    title: string;
    description?: string | null;
    priority: "low" | "medium" | "high" | "critical";
  } | null>(null);
  const statusExpectedKeys = useMemo(() => {
    const keys = ["mcpProxy", "agent", "fileServer", "lanproxy"];
    if (FEATURES.ENABLE_GUI_AGENT_SERVER && guiMcpEnabled) {
      keys.splice(3, 0, "guiServer");
    }
    return keys;
  }, [guiMcpEnabled]);
  const getStartupServiceKeys = useCallback(async (): Promise<string[]> => {
    const keys = ["mcpProxy", "agent", "fileServer", "lanproxy"];
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) return keys;
    try {
      const guiEnabledRes = await window.electronAPI?.guiServer?.isEnabled();
      if (guiEnabledRes?.enabled) {
        keys.splice(3, 0, "guiServer");
      }
    } catch (e) {
      console.warn("[App] Failed to read GUI MCP enabled status:", e);
    }
    return keys;
  }, []);

  // ============================================
  // 检查初始化向导状态（每次启动优先读取 quick init 配置）
  // ============================================
  useEffect(() => {
    const log = createLogger("SetupCheck");
    const checkSetup = async () => {
      try {
        const completed = await setupService.isSetupCompleted();

        // 每次启动优先读取 quick init 配置
        if (completed) {
          try {
            const qiConfig = await window.electronAPI?.quickInit.getConfig();
            if (qiConfig) {
              log.info("Applying quick init config");
              await applyQuickInitToDb(qiConfig);
            }
          } catch (error) {
            log.warn("Failed to read quick init config:", error);
          }
        }

        log.info("isSetupComplete:", completed);
        setIsSetupComplete(completed);
      } catch (error) {
        log.error("Failed to check setup status:", error);
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
        setUsername(
          user.displayName || user.username || t("Claw.App.defaultUsername"),
        );
      }

      // 加载在线状态
      const online =
        await window.electronAPI?.settings.get("auth.online_status");
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
      setUsername(
        user.displayName || user.username || t("Claw.App.defaultUsername"),
      );
    } else {
      setUsername("");
    }
  }, []);

  // 标记服务由登录流程启动（内存变量，不持久化）
  const handleLoginStarted = useCallback(() => {
    loginStartedRef.current = true;
  }, []);

  // ============================================
  // 主界面下必需依赖检查：仅当存在「未安装」或「错误」时进入依赖安装
  // 版本以当前真实安装为准，outdated 不触发（用户可在依赖 Tab 手动升级）
  // 同时检测主进程初始化依赖同步状态，避免服务启动时依赖尚未安装完成
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;
    const log = createLogger("DepsCheck");
    let cancelled = false;

    // 先注册事件监听，再做 checkAll，避免事件在 checkAll 返回前触发而丢失
    const handleDepsSyncCompleted = () => {
      log.info("syncCompleted");
      setDepsSyncInProgress(false);
    };
    window.electronAPI?.on(
      "deps:syncCompleted",
      handleDepsSyncCompleted as any,
    );

    const checkRequiredDeps = async () => {
      try {
        const result = await window.electronAPI?.dependencies.checkAll();
        if (cancelled) return;

        const deps = result?.results ?? [];
        const hasMissingOrError = deps.some(
          (d: { status: string }) =>
            d.status === "missing" || d.status === "error",
        );
        const missingDeps = deps
          .filter(
            (d: { status: string }) =>
              d.status === "missing" || d.status === "error",
          )
          .map((d: { name: string; status: string }) => d.name);

        log.info("result:", {
          hasMissingOrError,
          missingDeps: missingDeps.length > 0 ? missingDeps : undefined,
          syncInProgress: result?.syncInProgress,
        });

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
        log.error("failed:", error);
        if (!cancelled) {
          setNeedsRequiredDepsReinstall(false);
        }
      }
    };

    checkRequiredDeps();

    return () => {
      cancelled = true;
      window.electronAPI?.off(
        "deps:syncCompleted",
        handleDepsSyncCompleted as any,
      );
    };
  }, [isSetupComplete]);

  // ============================================
  // 服务状态轮询
  // ============================================
  const pollServicesStatus = useCallback(async () => {
    try {
      const items: ServiceItem[] = [];
      const [
        fsStatus,
        lpStatus,
        agentSvcStatus,
        mcpStatus,
        csStatus,
        guiStatus,
        guiEnabledRes,
      ] = await Promise.all([
        window.electronAPI?.fileServer.status(),
        window.electronAPI?.lanproxy.status(),
        window.electronAPI?.agent.serviceStatus(),
        window.electronAPI?.mcp.status(),
        window.electronAPI?.computerServer.status(),
        window.electronAPI?.guiServer?.status(),
        window.electronAPI?.guiServer?.isEnabled(),
      ]);
      const isGuiEnabled =
        FEATURES.ENABLE_GUI_AGENT_SERVER && (guiEnabledRes?.enabled ?? false);
      setGuiMcpEnabled(isGuiEnabled);
      {
        const running = mcpStatus?.running ?? false;
        const error = mcpStatus?.error;
        items.push({
          key: "mcpProxy",
          label: t("Claw.Service.mcp"),
          description: t("Claw.Service.mcpDesc"),
          running,
          error,
          health: computeServiceHealth(running, error),
        });
      }

      // ComputerServer 是 Agent 的 HTTP 接口，仅当 Agent 本身在运行时才检查其状态
      const agentRunning = agentSvcStatus?.running ?? false;
      const csRunning = csStatus?.running ?? false;
      let agentError: string | undefined;
      if (agentRunning && !csRunning) {
        agentError = csStatus?.error
          ? t("Claw.App.agentInterfaceFailed", csStatus.error)
          : t("Claw.App.agentInterfaceNotRunning");
      }
      {
        const running = agentRunning && csRunning;
        items.push({
          key: "agent",
          label: t("Claw.Service.agent"),
          description: t("Claw.Service.agentDesc"),
          running,
          error: agentError,
          health: computeServiceHealth(running, agentError),
        });
      }

      {
        const running = fsStatus?.running ?? false;
        const error = fsStatus?.error;
        items.push({
          key: "fileServer",
          label: t("Claw.Service.file"),
          description: t("Claw.Service.fileDesc"),
          running,
          pid: fsStatus?.pid,
          error,
          health: computeServiceHealth(running, error),
        });
      }
      if (isGuiEnabled) {
        const running = guiStatus?.running ?? false;
        const error = guiStatus?.error;
        items.push({
          key: "guiServer",
          label: t("Claw.Service.guiMcp"),
          description: t("Claw.Service.guiMcpDesc"),
          running,
          pid: guiStatus?.pid,
          error,
          health: computeServiceHealth(running, error),
        });
      }
      {
        const running = lpStatus?.running ?? false;
        const error = lanproxyHealthErrorRef.current ?? lpStatus?.error;
        items.push({
          key: "lanproxy",
          label: t("Claw.Service.proxy"),
          description: t("Claw.Service.proxyDesc"),
          running,
          pid: lpStatus?.pid,
          // 优先显示健康检查错误，其次显示进程错误
          error,
          health: computeServiceHealth(running, error),
        });
      }
      // 合并 ProcessLifecycleManager 的 uptime / lastCrashAt / restartCount
      try {
        const lcRes = await window.electronAPI?.services.lifecycleStats();
        if (lcRes?.success && Array.isArray(lcRes.stats)) {
          const statsMap = new Map(
            (
              lcRes.stats as Array<{
                key: string;
                uptimeMs?: number;
                lastCrashAt?: number;
                restartCount: number;
              }>
            ).map((s) => [s.key, s]),
          );
          for (const item of items) {
            const lc = statsMap.get(item.key);
            if (!lc) continue;
            item.uptimeMs = lc.uptimeMs;
            item.lastCrashAt = lc.lastCrashAt;
            if (lc.restartCount > 0) {
              item.restartCount = lc.restartCount;
              item.health = computeServiceHealth(
                item.running,
                item.error,
                lc.restartCount,
              );
            }
          }
        }
      } catch {
        // lifecycle stats 获取失败不影响主流程
      }

      setServices(items);
      setPollFailCount(0);
    } catch (error) {
      console.error("[App] pollServicesStatus failed:", error);
      setPollFailCount((count) => count + 1);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  // ============================================
  // 逐个启动服务（实时更新状态）
  // ============================================
  const startServicesSequentially = useCallback(
    async (serviceKeys: string[]) => {
      const log = createLogger("StartServices");
      for (const key of serviceKeys) {
        setStartingServices((prev) => new Set(prev).add(key));
        try {
          let result: { success: boolean; error?: string } | undefined;

          if (key === "agent") {
            const agentConfig = (await window.electronAPI?.settings.get(
              "agent_config",
            )) as any;
            const step1 = (await window.electronAPI?.settings.get(
              "step1_config",
            )) as { workspaceDir?: string } | null;
            result = await window.electronAPI?.agent.init({
              engine: agentConfig?.type || "claude-code",
              apiKey: agentConfig?.apiKey,
              baseUrl: agentConfig?.apiBaseUrl,
              model: agentConfig?.model,
              workspaceDir: step1?.workspaceDir || "",
            });
            log.info(
              `agent: ${result?.success ? "ok" : "failed"}`,
              result?.error,
            );
            // ComputerServer 是 Agent 的 HTTP 接口，随 Agent 一起启动
            await window.electronAPI?.computerServer
              .start()
              .catch(() => undefined);
          } else if (key === "fileServer") {
            const step1 = (await window.electronAPI?.settings.get(
              "step1_config",
            )) as { fileServerPort?: number } | null;
            const port = step1?.fileServerPort ?? 60000;
            result = await window.electronAPI?.fileServer.start(port);
            log.info(
              `fileServer: ${result?.success ? "ok" : "failed"}`,
              result?.error,
            );
          } else if (key === "guiServer") {
            result = await window.electronAPI?.guiServer?.start();
          } else if (key === "lanproxy") {
            const clientKey = (await window.electronAPI?.settings.get(
              "auth.saved_key",
            )) as string | null;
            const lpConfig = (await window.electronAPI?.settings.get(
              "lanproxy_config",
            )) as any;
            const serverIp =
              lpConfig?.serverIp ||
              (
                (await window.electronAPI?.settings.get(
                  "lanproxy.server_host",
                )) as string
              )?.replace(/^https?:\/\//, "");
            const serverPort =
              lpConfig?.serverPort ||
              (await window.electronAPI?.settings.get("lanproxy.server_port"));
            if (serverIp && clientKey && serverPort) {
              result = await window.electronAPI?.lanproxy.start({
                serverIp,
                serverPort,
                clientKey,
                ssl: lpConfig?.ssl,
              });
              log.info(
                `lanproxy: ${result?.success ? "ok" : "failed"}`,
                result?.error,
              );
            } else {
              log.warn("lanproxy: skipped (missing config)");
            }
          } else if (key === "mcpProxy") {
            result = await window.electronAPI?.mcp.start();
            log.info(
              `mcpProxy: ${result?.success ? "ok" : "failed"}`,
              result?.error,
            );
          }

          await pollServicesStatus();
        } catch (e) {
          log.error(`${key} failed:`, e);
        } finally {
          setStartingServices((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      }
      log.info("completed");
    },
    [pollServicesStatus],
  );

  // ============================================
  // 自动重连（等待依赖检查及同步完成后再执行，避免竞态）
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;
    if (needsRequiredDepsReinstall !== false) return;
    if (depsSyncInProgress) return;

    const log = createLogger("AutoReconnect");
    const autoReconnect = async () => {
      // 如果 ClientPage handleLogin 已经启动了服务，跳过自动重连
      if (loginStartedRef.current) {
        loginStartedRef.current = false;
        log.info("skipped (login flow)");
        return;
      }

      // 如果向导刚完成，启动所有服务
      if (setupJustCompleted.current) {
        setupJustCompleted.current = false;
        log.info("setup completed, starting services");
        await startServicesSequentially(await getStartupServiceKeys());
        return;
      }

      try {
        const savedKey =
          await window.electronAPI?.settings.get("auth.saved_key");

        if (savedKey) {
          // 用户已退出登录时（configKey 被清除），不自动重连
          const configKey =
            await window.electronAPI?.settings.get("auth.config_key");
          if (!configKey) {
            log.info("skipped (logged out)");
            return;
          }

          const result = await syncConfigToServer({ suppressToast: true });

          if (result) {
            log.info("reg ok, starting services");
            setOnlineStatus(result.online);
            const user = await authService.getAuthUser();
            if (user) {
              setUsername(
                user.displayName ||
                  user.username ||
                  t("Claw.App.defaultUsername"),
              );
            }
            setAuthRefreshTrigger((v) => v + 1);
            await startServicesSequentially(await getStartupServiceKeys());
          } else {
            log.warn("reg failed, using local config");
            notification.info({
              message: t("Claw.App.AutoReconnectFailed"),
              description: t("Claw.App.AutoReconnectFailedDetail"),
              duration: 8,
              placement: "bottomRight",
            });
            await startServicesSequentially(await getStartupServiceKeys());
          }
        } else {
          log.info("skipped (no savedKey)");
        }
      } catch (error) {
        log.error("failed:", error);
      }
    };

    autoReconnect();
  }, [
    isSetupComplete,
    needsRequiredDepsReinstall,
    depsSyncInProgress,
    startServicesSequentially,
    getStartupServiceKeys,
  ]);

  // ============================================
  // 根据服务状态计算 Agent 状态
  // ============================================
  // 根据服务状态计算 Agent 状态（对齐 Tauri 客户端逻辑）
  useEffect(() => {
    // 如果正在加载，保持当前状态不变（避免初始加载时的闪烁）
    if (servicesLoading) {
      return;
    }

    if (statusExpectedKeys.length === 0) {
      setAgentStatus("idle");
      return;
    }

    const serviceMap = new Map(services.map((s) => [s.key, s]));
    const trackedServices = statusExpectedKeys.map((key) =>
      serviceMap.get(key),
    );
    const runningCount = trackedServices.filter((s) => s?.running).length;
    const totalCount = statusExpectedKeys.length;
    const hasErrors = trackedServices.some((s) => !!s?.error);
    const hasStartingServices = Array.from(startingServices).some((key) =>
      statusExpectedKeys.includes(key),
    );
    const hasStaleServiceStatus = pollFailCount >= 2;

    if (hasStaleServiceStatus) {
      // 连续轮询失败时，避免继续展示可能过期的 running 状态。
      setAgentStatus("busy");
    } else if (hasErrors) {
      setAgentStatus("error");
    } else if (hasStartingServices) {
      setAgentStatus("starting");
    } else if (runningCount === totalCount && runningCount > 0) {
      setAgentStatus("running");
    } else if (runningCount > 0 && runningCount < totalCount) {
      setAgentStatus("busy");
    } else if (runningCount === 0) {
      setAgentStatus("stopped");
    } else {
      setAgentStatus("idle");
    }
  }, [
    services,
    servicesLoading,
    startingServices,
    statusExpectedKeys,
    pollFailCount,
  ]);

  // 启动服务状态轮询
  // 主要通过 service:health 事件驱动（每 30s 主进程推送），此处保留 30s 兜底轮询
  useEffect(() => {
    if (isSetupComplete !== true) return;

    // 立即执行一次
    pollServicesStatus();

    // 30s 兜底轮询（主更新由 service:health 事件驱动，见下方 useEffect）
    servicesPollTimer.current = setInterval(pollServicesStatus, 30_000);

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
      console.log("[App] Received menu:settings event");
      setActiveTab("settings");
    };
    window.electronAPI.on("menu:settings", handleSettings);
    cleanupHandlers.push(() =>
      window.electronAPI?.off("menu:settings", handleSettings),
    );

    // 监听依赖管理菜单
    const handleDependencies = () => {
      console.log("[App] Received menu:dependencies event");
      setActiveTab("dependencies");
    };
    window.electronAPI.on("menu:dependencies", handleDependencies);
    cleanupHandlers.push(() =>
      window.electronAPI?.off("menu:dependencies", handleDependencies),
    );

    // 监听 MCP 设置菜单
    const handleMcpSettings = () => {
      console.log("[App] Received menu:mcp-settings event");
      setActiveTab("settings");
    };
    window.electronAPI.on("menu:mcp-settings", handleMcpSettings);
    cleanupHandlers.push(() =>
      window.electronAPI?.off("menu:mcp-settings", handleMcpSettings),
    );

    // 监听新建会话菜单
    const handleNewSession = () => {
      console.log("[App] Received menu:new-session event");
      setSessionsAutoOpen(true);
      setActiveTab("sessions");
    };
    window.electronAPI.on("menu:new-session", handleNewSession);
    cleanupHandlers.push(() =>
      window.electronAPI?.off("menu:new-session", handleNewSession),
    );

    // 监听 Admin Server 服务正在重启
    const handleServicesRestarting = () => {
      console.log("[App] Received admin:servicesRestarting event");
      message.loading({
        content: t("Claw.App.ServicesRestarting"),
        key: "admin-restart",
        duration: 0,
      });
    };
    window.electronAPI.on("admin:servicesRestarting", handleServicesRestarting);
    cleanupHandlers.push(() =>
      window.electronAPI?.off(
        "admin:servicesRestarting",
        handleServicesRestarting,
      ),
    );

    // 监听 Admin Server 服务重启完成
    const handleServicesRestarted = (data: {
      success: boolean;
      results: Record<string, { success: boolean; error?: string }>;
    }) => {
      console.log("[App] Received admin:servicesRestarted event", data);
      if (data.success) {
        message.success({
          content: t("Claw.App.ServicesRestartSuccess"),
          key: "admin-restart",
          duration: 3,
        });
      } else {
        const failed = Object.entries(data.results)
          .filter(([, v]) => !v.success)
          .map(([k]) => k)
          .join(", ");
        message.error({
          content: t("Claw.App.serviceRestartFailed", failed),
          key: "admin-restart",
          duration: 5,
        });
      }
    };
    window.electronAPI.on(
      "admin:servicesRestarted",
      handleServicesRestarted as any,
    );
    cleanupHandlers.push(() =>
      window.electronAPI?.off(
        "admin:servicesRestarted",
        handleServicesRestarted as any,
      ),
    );

    return () => {
      cleanupHandlers.forEach((fn) => fn());
    };
  }, []);

  // ============================================
  // 监听 Agent 事件（permission.updated / permission.replied）
  // ============================================
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleAgentEvent = (event: {
      type: string;
      data: Record<string, unknown>;
    }) => {
      if (event.type === "permission.updated") {
        const d = event.data as {
          sessionId: string;
          permissionId: string;
          toolCall: PendingPermission["toolCall"];
          options: PendingPermission["options"];
        };
        setPendingPermissions((prev) => {
          // 避免重复添加相同 permissionId
          if (prev.some((p) => p.permissionId === d.permissionId)) return prev;
          return [
            ...prev,
            {
              sessionId: d.sessionId,
              permissionId: d.permissionId,
              toolCall: d.toolCall,
              options: d.options,
              arrivedAt: Date.now(),
            },
          ];
        });
      } else if (event.type === "permission.replied") {
        const d = event.data as { permissionId?: string };
        if (d.permissionId) {
          setPendingPermissions((prev) =>
            prev.filter((p) => p.permissionId !== d.permissionId),
          );
        }
      } else if (event.type === "session.crashed") {
        // 引擎崩溃时清除该引擎相关的待确认权限
        const d = event.data as { sessionIds?: string[] };
        if (d.sessionIds && d.sessionIds.length > 0) {
          const crashedSet = new Set(d.sessionIds);
          setPendingPermissions((prev) =>
            prev.filter((p) => !crashedSet.has(p.sessionId)),
          );
          // 显示崩溃恢复提示
          message.warning(
            t("Claw.Session.crashedRecovery", d.sessionIds.length.toString()),
          );
        }
        // 崩溃时也清除模型切换确认（自动允许已在主进程超时）
        setPendingModelSwitch(null);
        // 引擎崩溃时立即刷新服务状态（事件驱动，替代等待下次轮询）
        void pollServicesStatus();
      } else if (event.type === "question.requested") {
        const d = event.data as {
          sessionId: string;
          questionId: string;
          title?: string;
          options: PendingQuestion["options"];
          rawInput?: unknown;
        };
        setPendingQuestions((prev) => {
          // 避免重复添加相同 questionId
          if (prev.some((q) => q.questionId === d.questionId)) return prev;
          return [
            ...prev,
            {
              sessionId: d.sessionId,
              questionId: d.questionId,
              title: d.title,
              options: d.options,
              rawInput: d.rawInput,
              arrivedAt: Date.now(),
            },
          ];
        });
      } else if (event.type === "confirm.modelSwitch") {
        const d = event.data as {
          requestId: string;
          currentModel: string;
          newModel: string;
        };
        setPendingModelSwitch({
          requestId: d.requestId,
          currentModel: d.currentModel,
          newModel: d.newModel,
        });
      } else if (event.type === "confirm.checkpoint") {
        const d = event.data as {
          sessionId: string;
          toolCallsSoFar: number;
          reason: "tool_count" | "time";
        };
        setPendingCheckpoint({
          sessionId: d.sessionId,
          toolCallsSoFar: d.toolCallsSoFar,
          reason: d.reason,
        });
      }
    };

    window.electronAPI.on("agent:event", handleAgentEvent as any);
    return () => {
      window.electronAPI?.off("agent:event", handleAgentEvent as any);
    };
  }, []);

  const handlePermissionRespond = useCallback(
    async (
      sessionId: string,
      permissionId: string,
      response: "once" | "always" | "reject",
    ) => {
      // 乐观更新：立即从队列中移除
      setPendingPermissions((prev) =>
        prev.filter((p) => p.permissionId !== permissionId),
      );
      // 同时移除对应的 question（如果有）
      setPendingQuestions((prev) =>
        prev.filter((q) => q.questionId !== permissionId),
      );
      try {
        await window.electronAPI?.agent.respondPermission(
          sessionId,
          permissionId,
          response,
        );
      } catch (e) {
        console.error("[App] respondPermission failed:", e);
      }
    },
    [],
  );

  const handleQuestionRespond = useCallback(
    async (sessionId: string, questionId: string, optionId: string) => {
      // 乐观更新：立即从队列中移除
      setPendingQuestions((prev) =>
        prev.filter((q) => q.questionId !== questionId),
      );
      // 同时移除对应的 permission（如果有）
      setPendingPermissions((prev) =>
        prev.filter((p) => p.permissionId !== questionId),
      );
      try {
        // question 响应也通过 respondPermission 处理
        await window.electronAPI?.agent.respondPermission(
          sessionId,
          questionId,
          optionId.includes("always") ? "always" : "once",
        );
      } catch (e) {
        console.error("[App] respondQuestion failed:", e);
      }
    },
    [],
  );

  const handleModelSwitchRespond = useCallback(
    async (requestId: string, approved: boolean) => {
      setPendingModelSwitch(null);
      try {
        await window.electronAPI?.agent.respondModelSwitch(requestId, approved);
      } catch (e) {
        console.error("[App] respondModelSwitch failed:", e);
      }
    },
    [],
  );

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
  const isMacOS = navigator.platform.toUpperCase().includes("MAC");

  // ============================================
  // 菜单配置（模式感知 + 「更多」SubMenu）
  // ============================================
  const menuItems = useMemo(() => {
    const core = [
      {
        key: "client",
        icon: <DashboardOutlined />,
        label: t("Claw.Menu.client"),
      },
      {
        key: "sessions",
        icon: <TeamOutlined />,
        label: t("Claw.Menu.session"),
      },
      ...(clientMode !== "chat"
        ? [
            {
              key: "tasks",
              icon: <OrderedListOutlined />,
              label: t("Claw.Menu.tasks"),
            },
          ]
        : []),
      ...(clientMode === "code"
        ? [
            {
              key: "appdev",
              icon: <AppstoreOutlined />,
              label: t("Claw.Menu.appdev"),
            },
          ]
        : []),
    ];

    const moreChildren = [
      {
        key: "settings",
        icon: <SettingOutlined />,
        label: t("Claw.Menu.settings"),
      },
      ...(clientMode !== "chat"
        ? [
            {
              key: "dependencies",
              icon: <FolderOutlined />,
              label: t("Claw.Menu.dependencies"),
            },
          ]
        : []),
      ...(isMacOS && clientMode !== "chat"
        ? [
            {
              key: "permissions",
              icon: <SafetyOutlined />,
              label: t("Claw.Menu.authorization"),
            },
          ]
        : []),
      { key: "logs", icon: <FileTextOutlined />, label: t("Claw.Menu.logs") },
      {
        key: "about",
        icon: <InfoCircleOutlined />,
        label: t("Claw.Menu.about"),
      },
    ];

    return [
      ...core,
      { type: "divider" as const },
      {
        key: "more-group",
        icon: <EllipsisOutlined />,
        label: t(I18N_KEYS.Menu.MORE),
        children: moreChildren,
      },
    ];
  }, [clientMode, isMacOS, i18nLang]);

  // ============================================
  // i18n Context value
  // ============================================
  const i18nContextValue = useMemo(
    () => ({ lang: i18nLang, updateLang: handleI18nLangChange }),
    [i18nLang, handleI18nLangChange],
  );

  // ============================================
  // 渲染：加载中（含等待依赖检查完成）
  // ============================================
  if (
    isSetupComplete === null ||
    (isSetupComplete && needsRequiredDepsReinstall === null)
  ) {
    return (
      <I18nContext.Provider value={i18nContextValue}>
        <ConfigProvider theme={currentTheme}>
          <div className="app-loading">
            <Spin size="large" />
            <div className="app-loading-text">{t("Claw.App.Loading")}</div>
          </div>
        </ConfigProvider>
      </I18nContext.Provider>
    );
  }

  // ============================================
  // 渲染：初始化向导
  // ============================================
  if (!isSetupComplete) {
    return (
      <I18nContext.Provider value={i18nContextValue}>
        <ConfigProvider theme={currentTheme}>
          <SetupWizard onComplete={handleSetupComplete} />
        </ConfigProvider>
      </I18nContext.Provider>
    );
  }

  // ============================================
  // 渲染：主界面下必需依赖未满足 → 全屏依赖安装，完成后重启服务回到主界面
  // ============================================
  if (needsRequiredDepsReinstall === true) {
    return (
      <I18nContext.Provider value={i18nContextValue}>
        <ConfigProvider theme={currentTheme}>
          <SetupDependencies
            onComplete={async () => {
              // 先回到主界面，再在后台重启服务（使新安装的依赖生效）
              setNeedsRequiredDepsReinstall(false);
              await restartAllServices();
            }}
          />
        </ConfigProvider>
      </I18nContext.Provider>
    );
  }

  // ============================================
  // 渲染：主界面
  // ============================================
  return (
    <ConfigProvider theme={currentTheme}>
      <I18nContext.Provider value={i18nContextValue}>
        <ThemeContext.Provider
          value={{ themeMode, isDarkMode, setThemeMode: handleSetThemeMode }}
        >
          <div className="app-container">
            {/* 顶部栏 */}
            <div className="app-header">
              {webviewActions ? (
                <div className={styles.headerWebviewActions}>
                  <Button
                    size="small"
                    icon={<ArrowLeftOutlined />}
                    onClick={webviewActions.onBack}
                  >
                    {t("Claw.App.back")}
                  </Button>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={webviewActions.onReload}
                  >
                    {t("Claw.App.refresh")}
                  </Button>
                </div>
              ) : (
                <div className="app-header-logo">
                  <img
                    src="./32x32.png"
                    alt=""
                    style={{ width: 16, height: 16 }}
                  />
                  <span className="app-header-title">{APP_DISPLAY_NAME}</span>
                </div>
              )}
              <div className={styles.headerRight}>
                {username && (
                  <span className={styles.username}>{username}</span>
                )}
                <Tag style={{ fontSize: 11, margin: 0, cursor: "default" }}>
                  {t(
                    I18N_KEYS.Mode[
                      clientMode.toUpperCase() as keyof typeof I18N_KEYS.Mode
                    ],
                  )}
                </Tag>
                <Badge
                  status={badge.status}
                  className={
                    agentStatus === "idle" || agentStatus === "busy"
                      ? styles.badgeIdle
                      : undefined
                  }
                  text={
                    <span className={styles.badgeText}>{t(badge.textKey)}</span>
                  }
                />
              </div>
            </div>

            {/* 主体部分 */}
            <div className="app-body">
              {/* 左侧边栏 (hidden when webview is active) */}
              {!webviewActions && (
                <div
                  className={
                    i18nLang.toLowerCase().startsWith("en")
                      ? "app-sider app-sider-en"
                      : "app-sider"
                  }
                >
                  {/* 模式切换 icon tabs */}
                  <div className="mode-tabs">
                    <Tooltip title={t(I18N_KEYS.Mode.CHAT)} placement="right">
                      <button
                        className={`mode-tab${clientMode === "chat" ? " mode-tab-active" : ""}`}
                        onClick={() => handleModeChange("chat")}
                      >
                        <CommentOutlined />
                      </button>
                    </Tooltip>
                    <Tooltip
                      title={t(I18N_KEYS.Mode.GENERAL)}
                      placement="right"
                    >
                      <button
                        className={`mode-tab${clientMode === "general" ? " mode-tab-active" : ""}`}
                        onClick={() => handleModeChange("general")}
                      >
                        <RetweetOutlined />
                      </button>
                    </Tooltip>
                    <Tooltip title={t(I18N_KEYS.Mode.CODE)} placement="right">
                      <button
                        className={`mode-tab${clientMode === "code" ? " mode-tab-active" : ""}`}
                        onClick={() => handleModeChange("code")}
                      >
                        <CodeOutlined />
                      </button>
                    </Tooltip>
                  </div>
                  <Menu
                    mode="inline"
                    inlineIndent={0}
                    selectedKeys={[activeTab]}
                    defaultOpenKeys={["more-group"]}
                    onSelect={({ key }) => {
                      if (key !== "more-group") {
                        setActiveTab(key as TabKey);
                      }
                    }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    items={menuItems as any}
                  />
                </div>
              )}

              {/* 主内容区：flex 子撑满，便于日志等页占满高度 */}
              <div
                className={
                  webviewActions
                    ? "app-content app-content-fullwidth"
                    : "app-content"
                }
              >
                {/* T3.3 模型切换确认横幅 */}
                {pendingModelSwitch && !webviewActions && (
                  <Alert
                    type="warning"
                    showIcon
                    message={t(
                      "Claw.Agent.modelSwitchRequest",
                      pendingModelSwitch.newModel,
                    )}
                    description={t(
                      "Claw.Agent.modelSwitchDetail",
                      pendingModelSwitch.currentModel,
                      pendingModelSwitch.newModel,
                    )}
                    style={{ marginBottom: 12 }}
                    action={
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button
                          size="small"
                          onClick={() =>
                            handleModelSwitchRespond(
                              pendingModelSwitch.requestId,
                              false,
                            )
                          }
                        >
                          {t("Claw.Common.cancel")}
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() =>
                            handleModelSwitchRespond(
                              pendingModelSwitch.requestId,
                              true,
                            )
                          }
                        >
                          {t("Claw.Common.confirm")}
                        </Button>
                      </div>
                    }
                  />
                )}
                {/* Harness 审批请求横幅 */}
                {pendingApproval && !webviewActions && (
                  <Alert
                    type={
                      pendingApproval.priority === "high" ||
                      pendingApproval.priority === "critical"
                        ? "warning"
                        : "info"
                    }
                    showIcon
                    message={pendingApproval.title}
                    description={pendingApproval.description ?? undefined}
                    style={{ marginBottom: 12 }}
                    action={
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button
                          size="small"
                          danger
                          onClick={() => {
                            const id = pendingApproval.approvalId;
                            setPendingApproval(null);
                            void window.electronAPI?.harness.respondApproval(
                              id,
                              "reject",
                            );
                          }}
                        >
                          {t("Claw.Common.cancel")}
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => {
                            const id = pendingApproval.approvalId;
                            setPendingApproval(null);
                            void window.electronAPI?.harness.respondApproval(
                              id,
                              "approve",
                            );
                          }}
                        >
                          {t("Claw.Common.confirm")}
                        </Button>
                      </div>
                    }
                  />
                )}
                {/* T3.5 — 长任务检查点确认横幅 */}
                {pendingCheckpoint && !webviewActions && (
                  <Alert
                    type="info"
                    showIcon
                    message={t("Claw.Agent.checkpointTitle")}
                    description={t(
                      "Claw.Agent.checkpointDesc",
                      pendingCheckpoint.toolCallsSoFar,
                    )}
                    style={{ marginBottom: 12 }}
                    action={
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          const sid = pendingCheckpoint.sessionId;
                          setPendingCheckpoint(null);
                          void window.electronAPI?.agent.respondCheckpoint(sid);
                        }}
                      >
                        {t("Claw.Agent.checkpointContinue")}
                      </Button>
                    }
                  />
                )}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    background: "var(--color-bg-layout)",
                  }}
                >
                  {activeTab === "client" && (
                    <ClientPage
                      onNavigate={(tab) => {
                        if (tab === "sessions") setSessionsAutoOpen(true);
                        setActiveTab(tab);
                      }}
                      services={services}
                      servicesLoading={servicesLoading}
                      startingServices={startingServices}
                      setStartingServices={setStartingServices}
                      onRefreshServices={pollServicesStatus}
                      authRefreshTrigger={authRefreshTrigger}
                      onAuthChange={handleAuthChange}
                      onLoginStarted={handleLoginStarted}
                      systemResources={systemResources ?? undefined}
                    />
                  )}
                  {activeTab === "sessions" && (
                    <SessionsPage
                      autoOpen={sessionsAutoOpen}
                      onAutoOpenConsumed={() => setSessionsAutoOpen(false)}
                      onWebviewChange={setWebviewActions}
                    />
                  )}
                  {activeTab === "appdev" && (
                    <AppDevPage onWebviewChange={setWebviewActions} />
                  )}
                  {activeTab === "tasks" && <TasksPage />}
                  {activeTab === "settings" && <SettingsPage />}
                  {activeTab === "dependencies" && <DependenciesPage />}
                  {activeTab === "permissions" && <PermissionsPage />}
                  {activeTab === "logs" && <LogViewer />}
                  {activeTab === "about" && <AboutPage />}
                </div>
                {/* 权限确认浮动卡片：覆盖在主内容区底部 */}
                {pendingPermissions.length > 0 && (
                  <PermissionRequestCard
                    pending={pendingPermissions}
                    onRespond={handlePermissionRespond}
                  />
                )}
                {/* 交互式问题卡片 */}
                {pendingQuestions.length > 0 && (
                  <InteractiveQuestionCard
                    questions={pendingQuestions}
                    onRespond={handleQuestionRespond}
                  />
                )}
              </div>
            </div>
          </div>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </ConfigProvider>
  );
}

export default App;
