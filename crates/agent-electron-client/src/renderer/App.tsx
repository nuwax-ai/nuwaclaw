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
  Modal,
  Tooltip,
  notification,
  message,
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
  ReloadOutlined,
  ApiOutlined,
  DownloadOutlined,
  LoadingOutlined,
  RocketOutlined,
  CloseOutlined,
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
  isLoggedIn,
} from "./services/core/auth";
import {
  APP_DISPLAY_NAME,
  AUTH_KEYS,
  normalizeAgentEngine,
} from "@shared/constants";
import type { QuickInitConfig } from "@shared/types/quickInit";
import type { UpdateState } from "@shared/types/updateTypes";
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
import { type BrowserTarget } from "./components/pages/BrowserHomePage";
import NuwaxHostWebview, {
  type NuwaxHostWebviewHandle,
} from "./components/pages/NuwaxHostWebview";
import TrafficLightToolbar from "./components/TrafficLightToolbar";
import MCPSettings from "./components/settings/MCPSettings";
import { ModeNavIcon } from "./components/icons/ModeNavIcon";
import { createLogger } from "./services/utils/rendererLog";
import styles from "./styles/components/App.module.css";
import {
  lightTheme,
  darkTheme,
  applyShellTheme,
  type ShellThemePayload,
} from "./styles/theme";
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
  | "mcp"
  | "settings"
  | "dependencies"
  | "permissions"
  | "logs"
  | "about"
  | "model";

/** 主视图模式：浏览器（默认 home）或配置（原侧边栏管理界面） */
type MainViewMode = "browser" | "config";

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

/** macOS/Linux 无 download-progress 时，header tag 用本地模拟进度避免长期显示 0%。 */
const HEADER_SIMULATED_PROGRESS_CAP = 90;
const HEADER_SIMULATED_PROGRESS_INTERVAL_MS = 500;
const HEADER_SIMULATED_DURATION_MS = 45_000;

// 服务状态接口（与 ClientPage 共享）
export interface ServiceItem {
  key: string;
  label: string;
  description: string;
  running: boolean;
  pid?: number;
  port?: number;
  error?: string;
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
  // 启动服务门禁：null=等待中（大 loading）；ok:false=失败屏（可重试）；ok:true 才挂 webview
  const [servicesGate, setServicesGate] = useState<{
    ok: boolean;
    detail?: string[];
    elapsedMs?: number;
  } | null>(null);
  const setupJustCompleted = useRef(false);
  // 内存变量：标记服务是否由登录流程启动（不持久化）
  const loginStartedRef = useRef(false);

  // ============================================
  // 主题状态
  // ============================================
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemIsDark, setSystemIsDark] = useState(false);

  // 计算实际使用的主题。
  // 暗黑模式经环境变量关闭（FEATURES.DARK_THEME，默认 false）：恒浅色，
  // 与 nuwax 女娲主题（亮色体系）保持统一基调，外观设置项随之隐藏。
  const isDarkMode = useMemo(() => {
    if (!FEATURES.DARK_THEME) return false;
    if (themeMode === "system") {
      return systemIsDark;
    }
    return themeMode === "dark";
  }, [themeMode, systemIsDark]);

  // ============================================
  // nuwax 女娲主题 → 壳原生 UI 统一
  // ============================================
  // nuwax 是主题唯一真实源：女娲主题生效/让位时经桥推送（nuwax:theme-sync →
  // main 转发 nuwax:theme-changed）。active 时壳给自己的 antd tokens 叠加同套
  // 米白调色板（设置弹窗等原生 UI 与 webview 统一），并同步 CSS 变量供
  // index.css 侧（.app-sider/.app-content/body 底色）消费；让位即整体回落。
  const [shellTheme, setShellTheme] = useState<ShellThemePayload | null>(null);

  useEffect(() => {
    const onNuwaxThemeChanged = (payload: unknown) => {
      if (payload && typeof payload === "object" && "active" in payload) {
        setShellTheme(payload as ShellThemePayload);
      }
    };
    window.electronAPI?.on("nuwax:theme-changed", onNuwaxThemeChanged as any);
    return () => {
      window.electronAPI?.off(
        "nuwax:theme-changed",
        onNuwaxThemeChanged as any,
      );
    };
  }, []);

  // 启动服务门禁：核心服务 ready 前停在启动 loading（不挂 webview，杜绝页面
  // 首屏 API 抢跑的「服务连接失败」弹窗）。先读缓存（事件可能早于 renderer
  // 挂载已发），再监听后续推送；失败屏的重试经 waitForReady 重跑门禁。
  useEffect(() => {
    void window.electronAPI?.services
      ?.readyState()
      .then((s) => {
        if (s) setServicesGate(s as { ok: boolean; detail?: string[] });
      })
      .catch(() => {});
    const onServicesReady = (payload: unknown) => {
      if (payload && typeof payload === "object" && "ok" in payload) {
        setServicesGate(payload as { ok: boolean; detail?: string[] });
      }
    };
    window.electronAPI?.on("services:ready", onServicesReady as any);
    return () => {
      window.electronAPI?.off("services:ready", onServicesReady as any);
    };
  }, []);

  // 二级页同窗承载（默认形态）：nuwax 经 native:openWindow 请求打开的站内页
  //（智能体编排/工作流详情/网页应用开发详情等）由主 webview 原地导航——沉浸式
  // 避让生效（header-area/page-container 退让），不再新开独立窗口。
  useEffect(() => {
    const onOpenSameWindow = (payload: unknown) => {
      const url = (payload as { url?: string } | null)?.url;
      if (typeof url === "string" && url) {
        nuwaxHostRef.current?.navigate(url);
      }
    };
    window.electronAPI?.on("nuwax:open-same-window", onOpenSameWindow as any);
    return () => {
      window.electronAPI?.off(
        "nuwax:open-same-window",
        onOpenSameWindow as any,
      );
    };
  }, []);

  // nuwax 布局状态 → 工具栏收起按钮显隐：当前页无二级菜单时按钮无意义，隐藏。
  // 默认 false（隐藏）——nuwax 布局挂载后推送真实值；/Login 等无布局页不推或推 false。
  const [secondMenuAvailable, setSecondMenuAvailable] = useState(false);

  // CSS 变量叠加（inline 优先级高于 index.css 的亮/暗定义，removeProperty 即回落）。
  // 与 antd tokens 同步加暗色守卫：壳深色时不叠加，避免米白变量染坏暗色 UI。
  useEffect(() => {
    const root = document.documentElement;
    const active = shellTheme?.active === true && !isDarkMode;
    const vars: Array<[string, string | undefined]> = [
      ["--color-primary", active ? shellTheme?.primary : undefined],
      ["--color-bg-layout", active ? shellTheme?.bgContent : undefined],
      ["--color-bg-container", active ? shellTheme?.bgContent : undefined],
      ["--color-bg-elevated", active ? shellTheme?.bgContent : undefined],
      ["--color-bg-sider", active ? shellTheme?.bgMenu : undefined],
      ["--color-bg-section", active ? shellTheme?.bgContent : undefined],
      [
        "--color-bg-section-header",
        active ? shellTheme?.bgElevated : undefined,
      ],
      ["--color-border", active ? shellTheme?.border : undefined],
      [
        "--color-border-secondary",
        active ? shellTheme?.borderSecondary : undefined,
      ],
      ["--color-bg-hover", active ? shellTheme?.bgItemHover : undefined],
      ["--color-divider", active ? shellTheme?.borderSecondary : undefined],
    ];
    vars.forEach(([name, value]) => {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    });
  }, [shellTheme, isDarkMode]);

  const currentTheme = useMemo(() => {
    const base = isDarkMode ? darkTheme : lightTheme;
    // 女娲主题是亮色体系：仅在壳非深色且 nuwax 报告 active 时叠加
    return !isDarkMode && shellTheme?.active
      ? applyShellTheme(base, shellTheme)
      : base;
  }, [isDarkMode, shellTheme]);

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
  // 默认进入沉浸式 nuwax 主视图；配置外壳经浮动「设置」入口可达
  const [mainViewMode, setMainViewMode] = useState<MainViewMode>("browser");
  const [browserTarget, setBrowserTarget] = useState<BrowserTarget>({
    type: "home",
  });
  const [browserOpenKey, setBrowserOpenKey] = useState(0);
  const browserReloadRef = useRef<(() => void) | null>(null);
  // 沉浸式工具栏所需状态
  const webviewRef = useRef<NuwaxHostWebviewHandle>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // 二级菜单收起态（与 nuwax setIsSecondMenuCollapsed 同步；桌面端唯一触发源是工具栏）
  const [secondMenuCollapsed, setSecondMenuCollapsed] = useState(false);

  // nuwax 布局状态监听：secondMenuAvailable（按钮显隐）+ secondMenuCollapsed
  //（真实收起态，推送为准）：webview reload 后本地态不重置、reload 瞬间的
  // toggle 命令也可能丢失，nuwax 推送值校正失同步。
  useEffect(() => {
    const onNuwaxLayoutChanged = (payload: {
      secondMenuAvailable?: boolean;
      secondMenuCollapsed?: boolean;
    }) => {
      if (payload?.secondMenuAvailable !== undefined) {
        setSecondMenuAvailable(payload.secondMenuAvailable === true);
      }
      if (payload?.secondMenuCollapsed !== undefined) {
        setSecondMenuCollapsed(payload.secondMenuCollapsed === true);
      }
    };
    window.electronAPI?.on("nuwax:layout-changed", onNuwaxLayoutChanged as any);
    return () => {
      window.electronAPI?.off(
        "nuwax:layout-changed",
        onNuwaxLayoutChanged as any,
      );
    };
  }, []);
  // 系统配置浮层（替代原 mainViewMode=config 整页切换，沉浸式下不打断 webview）
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  /** 是否已登录（有 config_key）；未登录时不展示平台切换 */
  const [isAuthLoggedIn, setIsAuthLoggedIn] = useState(false);
  const [username, setUsername] = useState<string>("");
  // 本机电脑名（主机名）。登录统一到 nuwax webview 后，nuwaclaw 侧 username（来自 configKey）
  // 常拿不到，顶栏已登录态用它替代抽象的「已登录」文案，作为这台设备的标识。
  const [computerName, setComputerName] = useState<string>("");
  const [onlineStatus, setOnlineStatus] = useState<boolean | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>("idle");
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [guiMcpEnabled, setGuiMcpEnabled] = useState(false);
  const [pollFailCount, setPollFailCount] = useState(0);
  const [startingServices, setStartingServices] = useState<Set<string>>(
    new Set(),
  );
  const servicesPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * 上一次同步给托盘的整体服务状态（true=有服务在跑 / false=全部停止）。
   * 避免每 5 秒轮询都向主进程发一次 tray:updateServicesStatus IPC。
   * UI 入口（services:restartAll/stopAll 等）走主进程同步，本 ref 仅兜底
   * 渲染端通过逐个 IPC 启动服务（startServicesSequentially）的场景。
   */
  const lastSyncedTrayRunning = useRef<boolean | null>(null);
  /** 递增后通知 ClientPage 刷新账号状态（用户名等），与 reg 返回保持一致 */
  const [authRefreshTrigger, setAuthRefreshTrigger] = useState(0);
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: "idle",
  });
  const [headerSimulatedPercent, setHeaderSimulatedPercent] = useState(0);
  const headerSimulatedIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const statusExpectedKeys = useMemo(() => {
    const keys = ["mcpProxy", "agent", "fileServer", "lanproxy", "ttyd"];
    if (FEATURES.ENABLE_GUI_AGENT_SERVER && guiMcpEnabled) {
      keys.splice(3, 0, "guiServer");
    }
    return keys;
  }, [guiMcpEnabled]);
  const getStartupServiceKeys = useCallback(async (): Promise<string[]> => {
    const keys = ["mcpProxy", "agent", "fileServer", "lanproxy", "ttyd"];
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
        // 注意：quickInit 仍含 step1 serverHost/端口写入（NuwaxHostWebview 路由依赖）
        // 与旧 savedKey/reg 链路；后者随 Phase 3 登录统一到 nuwax webview 一并移除。
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

        // 登录流程已统一到 nuwax webview /Login：外壳不再以 SetupWizard 作为首屏门控，
        // 无论 setup_state 如何，首屏一律展示 nuwax webview（/Login 或已登录业务页）。
        log.info("Setup gate bypassed: login unified to nuwax webview /Login");
        setIsSetupComplete(true);
      } catch (error) {
        log.error("Failed to check setup status:", error);
        setIsSetupComplete(true);
      }
    };
    checkSetup();
  }, []);

  // ============================================
  // 读取本机主机名（顶栏已登录态设备标识，替代「已登录」文案）
  // ============================================
  useEffect(() => {
    window.electronAPI?.app
      ?.getHostname?.()
      .then((name) => {
        if (name) setComputerName(name);
      })
      .catch(() => {
        /* 读取失败忽略，顶栏回退到默认文案 */
      });
  }, []);

  // ============================================
  // 登录态同步（控制平台 Tab 是否展示）
  // ============================================
  const refreshAuthState = useCallback(async () => {
    // isAuthLoggedIn 以 nuwax webview token 为唯一真实源（由 main 推送的 nuwax:authChanged
    // 事件驱动，见下方监听器），此处不再用 configKey 覆盖——否则 nuwaclaw configKey 残留会让
    // 顶栏显示「伪已登录」，与 webview 实际未登录不一致。用户定：以 webview 状态为最优先。
    // 此处 loggedIn 决定 username 显示与默认 tab：以 nuwax webview 登录态
    //（isAuthLoggedIn，nuwax:authChanged 驱动）为最优先——configKey 仅在
    // webview 尚未上报（冷启动早期）时兜底，修「设置里显示未登录不同步」。
    const loggedIn = isAuthLoggedIn || (await isLoggedIn());

    if (!loggedIn) {
      setUsername("");
      // 沉浸式 nuwax 为主视图，鉴权交给 nuwax 自身 /Login 页，
      // 不因 nuwaclaw sandbox 未登录而强制回到 config 外壳
      setActiveTab("client");
      return;
    }

    const user = await authService.getAuthUser();
    if (user) {
      setUsername(
        user.displayName || user.username || t("Claw.App.defaultUsername"),
      );
    }
  }, [isAuthLoggedIn]);

  // ============================================
  // 初始化主界面（setup 完成后执行）
  // ============================================
  useEffect(() => {
    if (isSetupComplete !== true) return;

    const init = async () => {
      await refreshAuthState();

      // 加载在线状态
      const online =
        await window.electronAPI?.settings.get("auth.online_status");
      setOnlineStatus(online as boolean | null);
    };

    init();
  }, [isSetupComplete, refreshAuthState]);

  // reg / 登录后刷新登录态
  useEffect(() => {
    if (isSetupComplete !== true) return;
    void refreshAuthState();
  }, [isSetupComplete, authRefreshTrigger, refreshAuthState]);

  // 顶栏账号状态跟随 nuwax token：监听 main 推送的 nuwax:authChanged 事件
  // （bridge auth:persistToken=登录 / auth:clear=登出·401失效），使顶栏登录态与
  // nuwax webview 一致——未登录时 headerRight 显示「去登录」。Phase 3 configKey 退役前，
  // 该事件优先级高于 refreshAuthState（基于 configKey）的判定。
  useEffect(() => {
    const onNuwaxAuthChanged = (payload: { loggedIn: boolean }) => {
      setIsAuthLoggedIn(payload.loggedIn);
      if (!payload.loggedIn) setUsername("");
    };
    window.electronAPI?.on("nuwax:authChanged", onNuwaxAuthChanged as any);
    return () => {
      window.electronAPI?.off("nuwax:authChanged", onNuwaxAuthChanged as any);
    };
  }, []);

  // ============================================
  // 浏览器模式导航
  // ============================================
  const openInBrowser = useCallback((target: BrowserTarget) => {
    setBrowserTarget(target);
    setBrowserOpenKey((k) => k + 1);
    setMainViewMode("browser");
  }, []);

  const openBrowserHome = useCallback(() => {
    openInBrowser({ type: "home" });
  }, [openInBrowser]);

  const openStartSession = useCallback(() => {
    openInBrowser({ type: "startSession" });
  }, [openInBrowser]);

  const handleBrowserReloadReady = useCallback(
    (reload: (() => void) | null) => {
      browserReloadRef.current = reload;
    },
    [],
  );

  // 刷新 nuwax webview：递增 browserOpenKey → NuwaxHostWebview 的 reloadKey effect → webview.reload()。
  // （旧 browserReloadRef/handleBrowserReloadReady 链路随旧 browser 组件废弃而失效，改走 reloadKey 机制。）
  const handleBrowserRefresh = useCallback(() => {
    setBrowserOpenKey((k) => k + 1);
  }, []);

  // webview 导航能力变化上报（供工具栏后退/前进按钮启用态）
  const handleNavStateChange = useCallback(
    (state: { canGoBack: boolean; canGoForward: boolean }) => {
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    },
    [],
  );
  // 工具栏：收起/展开二级菜单（翻转本地态 + 下发命令到 nuwax）
  const handleToggleMenu = useCallback(() => {
    setSecondMenuCollapsed((prev) => {
      const next = !prev;
      webviewRef.current?.sendHostCommand({
        type: "toggle-second-menu",
        collapsed: next,
      });
      return next;
    });
  }, []);
  const handleToolbarBack = useCallback(() => webviewRef.current?.goBack(), []);
  const handleToolbarForward = useCallback(
    () => webviewRef.current?.goForward(),
    [],
  );
  const handleToolbarReload = useCallback(
    () => webviewRef.current?.reload(),
    [],
  );
  const handleOpenSettings = useCallback(() => setSettingsModalOpen(true), []);

  // ============================================
  // 子组件登录/注销后刷新顶部栏用户名与平台 Tab
  // ============================================
  const handleAuthChange = useCallback(async () => {
    await refreshAuthState();
  }, [refreshAuthState]);

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
      // 任一 status() 抛错不应阻塞其他服务的轮询；用 allSettled 单点隔离。
      // 渲染端 status 不会 reject（handlers 返回 {success, error}），但 IPC 通道缺失等
      // 边缘场景仍可能 reject，统一处理避免冻结尾页 services 列表。
      const settled = await Promise.allSettled([
        window.electronAPI?.fileServer.status(),
        window.electronAPI?.lanproxy.status(),
        window.electronAPI?.agent.serviceStatus(),
        window.electronAPI?.mcp.status(),
        window.electronAPI?.computerServer.status(),
        window.electronAPI?.guiServer?.status(),
        window.electronAPI?.guiServer?.isEnabled(),
        window.electronAPI?.ttyd.status(),
      ]);
      const unwrap = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === "fulfilled" ? (r.value ?? fallback) : fallback;
      const fsStatus = unwrap(settled[0], { running: false });
      const lpStatus = unwrap(settled[1], { running: false });
      const agentSvcStatus = unwrap(settled[2], { running: false });
      const mcpStatus = unwrap(settled[3], { running: false });
      const csStatus = unwrap(settled[4], { running: false });
      const guiStatus = unwrap(settled[5], undefined);
      const guiEnabledRes = unwrap(settled[6], undefined);
      const ttydStatus = unwrap(settled[7], { running: false });
      const isGuiEnabled =
        FEATURES.ENABLE_GUI_AGENT_SERVER && (guiEnabledRes?.enabled ?? false);
      setGuiMcpEnabled(isGuiEnabled);
      items.push({
        key: "mcpProxy",
        label: t("Claw.Service.mcp"),
        description: t("Claw.Service.mcpDesc"),
        running: mcpStatus?.running ?? false,
        error: mcpStatus?.error,
      });

      // ComputerServer 是 Agent 的 HTTP 接口，仅当 Agent 本身在运行时才检查其状态
      const agentRunning = agentSvcStatus?.running ?? false;
      const csRunning = csStatus?.running ?? false;
      let agentError: string | undefined;
      if (agentRunning && !csRunning) {
        agentError = csStatus?.error
          ? t("Claw.App.agentInterfaceFailed", csStatus.error)
          : t("Claw.App.agentInterfaceNotRunning");
      }
      items.push({
        key: "agent",
        label: t("Claw.Service.agent"),
        description: t("Claw.Service.agentDesc"),
        running: agentRunning && csRunning,
        error: agentError,
      });

      items.push({
        key: "fileServer",
        label: t("Claw.Service.file"),
        description: t("Claw.Service.fileDesc"),
        running: fsStatus?.running ?? false,
        pid: fsStatus?.pid,
        error: fsStatus?.error,
      });
      if (isGuiEnabled) {
        items.push({
          key: "guiServer",
          label: t("Claw.Service.guiMcp"),
          description: t("Claw.Service.guiMcpDesc"),
          running: guiStatus?.running ?? false,
          pid: guiStatus?.pid,
          error: guiStatus?.error,
        });
      }
      items.push({
        key: "lanproxy",
        label: t("Claw.Service.proxy"),
        description: t("Claw.Service.proxyDesc"),
        running: lpStatus?.running ?? false,
        pid: lpStatus?.pid,
        error: lpStatus?.error,
      });
      items.push({
        key: "ttyd",
        label: t("Claw.Service.ttyd"),
        description: t("Claw.Service.ttydDesc"),
        running: ttydStatus?.running ?? false,
        pid: ttydStatus?.pid,
        error: ttydStatus?.error,
      });
      setServices(items);
      setPollFailCount(0);

      // 兜底同步托盘：任一服务在跑 → running；全部停止 → stopped。
      // 仅在状态发生变化时发 IPC，避免每 5 秒重复调用。
      // 这里覆盖了 startServicesSequentially 逐个 IPC 启动服务的场景；
      // services:restartAll/stopAll 等批量路径由主进程 processHandlers 直接同步。
      const anyRunning = items.some((s) => s.running);
      if (lastSyncedTrayRunning.current !== anyRunning) {
        lastSyncedTrayRunning.current = anyRunning;
        window.electronAPI?.tray
          .updateServicesStatus(anyRunning)
          .catch((e) => console.warn("[App] Failed to sync tray status:", e));
      }
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
              engine: normalizeAgentEngine(agentConfig?.type),
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
          } else if (key === "ttyd") {
            result = await window.electronAPI?.ttyd.start();
            log.info(
              `ttyd: ${result?.success ? "ok" : "failed"}`,
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
        openBrowserHome();
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
            openBrowserHome();
          } else {
            log.warn("reg failed, using local config");
            notification.info({
              message: t("Claw.App.AutoReconnectFailed"),
              description: t("Claw.App.AutoReconnectFailedDetail"),
              duration: 8,
              placement: "bottomRight",
            });
            await startServicesSequentially(await getStartupServiceKeys());
            openBrowserHome();
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
    openBrowserHome,
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
  // 监听更新状态（header tag 展示）
  // ============================================
  useEffect(() => {
    const handler = (state: UpdateState) => {
      if (state) setUpdateState(state);
    };
    window.electronAPI?.on("update:status", handler as any);
    window.electronAPI?.app?.getUpdateState?.()?.then((state) => {
      if (state) setUpdateState(state);
    });
    return () => {
      window.electronAPI?.off("update:status", handler as any);
    };
  }, []);

  useEffect(() => {
    const isDownloading = updateState.status === "downloading";
    const hasRealProgress = updateState.progress != null;

    if (isDownloading && !hasRealProgress) {
      setHeaderSimulatedPercent(0);
      const increment =
        (HEADER_SIMULATED_PROGRESS_CAP / HEADER_SIMULATED_DURATION_MS) *
        HEADER_SIMULATED_PROGRESS_INTERVAL_MS;
      const id = setInterval(() => {
        setHeaderSimulatedPercent((prev) => {
          const next = prev + increment;
          return next >= HEADER_SIMULATED_PROGRESS_CAP
            ? HEADER_SIMULATED_PROGRESS_CAP
            : next;
        });
      }, HEADER_SIMULATED_PROGRESS_INTERVAL_MS);
      headerSimulatedIntervalRef.current = id;
      return () => {
        clearInterval(id);
        headerSimulatedIntervalRef.current = null;
      };
    }

    if (!isDownloading || hasRealProgress) {
      if (headerSimulatedIntervalRef.current) {
        clearInterval(headerSimulatedIntervalRef.current);
        headerSimulatedIntervalRef.current = null;
      }
      setHeaderSimulatedPercent(0);
    }
  }, [updateState.status, updateState.progress]);

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
      setSettingsModalOpen(true);
    };
    window.electronAPI.on("menu:settings", handleSettings);
    cleanupHandlers.push(() =>
      window.electronAPI?.off("menu:settings", handleSettings),
    );

    // 监听依赖管理菜单
    const handleDependencies = () => {
      console.log("[App] Received menu:dependencies event");
      setActiveTab("dependencies");
      setSettingsModalOpen(true);
    };
    window.electronAPI.on("menu:dependencies", handleDependencies);
    cleanupHandlers.push(() =>
      window.electronAPI?.off("menu:dependencies", handleDependencies),
    );

    // 监听 MCP 设置菜单
    const handleMcpSettings = () => {
      console.log("[App] Received menu:mcp-settings event");
      setActiveTab("settings");
      setSettingsModalOpen(true);
    };
    window.electronAPI.on("menu:mcp-settings", handleMcpSettings);
    cleanupHandlers.push(() =>
      window.electronAPI?.off("menu:mcp-settings", handleMcpSettings),
    );

    // 监听新建会话菜单
    const handleNewSession = () => {
      console.log("[App] Received menu:new-session event");
      openInBrowser({ type: "newSession" });
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
  }, [openInBrowser]);

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
  // 菜单配置（对齐 Tauri 客户端）
  // ============================================
  const menuItems = useMemo(() => {
    const items = [
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
      {
        key: "mcp",
        icon: <ApiOutlined />,
        label: t("Claw.Menu.mcp"),
      },
      {
        key: "settings",
        icon: <SettingOutlined />,
        label: t("Claw.Menu.settings"),
      },
      {
        key: "dependencies",
        icon: <FolderOutlined />,
        label: t("Claw.Menu.dependencies"),
      },
    ];
    if (isMacOS) {
      items.push({
        key: "permissions",
        icon: <SafetyOutlined />,
        label: t("Claw.Menu.authorization"),
      });
    }
    items.push(
      { key: "logs", icon: <FileTextOutlined />, label: t("Claw.Menu.logs") },
      {
        key: "about",
        icon: <InfoCircleOutlined />,
        label: t("Claw.Menu.about"),
      },
    );
    return items;
  }, [isMacOS, i18nLang]);

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
  // 登录已统一到 nuwax webview /Login，外壳首屏直接进 webview，不再渲染 SetupWizard。
  // （handleSetupComplete / setupJustCompleted / <SetupWizard> import 暂作 dormant 入口保留，
  //  随 Phase 3 登录统一收尾一并清理。）
  // ============================================

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
  // 渲染：启动服务门禁——核心服务 ready 前不挂 nuwax webview
  // ============================================
  if (!servicesGate || !servicesGate.ok) {
    return (
      <I18nContext.Provider value={i18nContextValue}>
        <ConfigProvider theme={currentTheme}>
          <div className="app-loading">
            {servicesGate && !servicesGate.ok ? (
              <>
                <div
                  className="app-loading-text"
                  style={{ fontSize: 16, fontWeight: 600 }}
                >
                  本地服务启动失败
                </div>
                <div
                  className="app-loading-text"
                  style={{ maxWidth: 420, textAlign: "center", marginTop: 8 }}
                >
                  未就绪：{(servicesGate.detail ?? []).join("、")}
                </div>
                <Button
                  type="primary"
                  style={{ marginTop: 16 }}
                  onClick={() => {
                    setServicesGate(null);
                    void window.electronAPI?.services?.waitForReady();
                  }}
                >
                  重试
                </Button>
              </>
            ) : (
              <>
                <Spin size="large" />
                <div className="app-loading-text" style={{ marginTop: 4 }}>
                  正在启动本地服务…
                </div>
              </>
            )}
          </div>
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
            {/* 顶部栏：Logo + 模式切换 + 浏览器刷新 + 用户状态 + 升级提示 */}
            {/* 顶栏撤除：沉浸式 webview 顶到窗口上沿。原顶栏的 Segmented 模式切换与账号登录态
                移除；新版本更新入口迁入工具栏 updateEntry（Agent 运行状态不再展示）；
                后退/前进/刷新/收起二级菜单/设置由工具栏承载（见 TrafficLightToolbar，浮于 webview 之上）。 */}
            <TrafficLightToolbar
              menuCollapsed={secondMenuCollapsed}
              menuAvailable={secondMenuAvailable}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onToggleMenu={handleToggleMenu}
              onBack={handleToolbarBack}
              onForward={handleToolbarForward}
              onReload={handleToolbarReload}
              onOpenSettings={handleOpenSettings}
              statusEntry={
                // 服务状态指示器：非绿色（有服务 error→红 / 未全跑→橙）时渲染颜色点，
                // 点击打开设置弹窗并落到 client tab（服务列表页）；全绿或未知（空）不渲染。
                services.length > 0 && !services.every((s) => s.running) ? (
                  <Tooltip title="服务状态异常，点击查看" mouseEnterDelay={0.7}>
                    <Button
                      type="text"
                      size="small"
                      aria-label="服务状态"
                      onClick={() => {
                        setActiveTab("client");
                        setSettingsModalOpen(true);
                      }}
                      style={{ ...({ WebkitAppRegion: "no-drag" } as any) }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          display: "inline-block",
                          // 有服务报错→红；否则（未全跑）→橙
                          background: services.some((s) => s.error)
                            ? "#EF4444"
                            : "#F59E0B",
                        }}
                      />
                    </Button>
                  </Tooltip>
                ) : undefined
              }
              updateEntry={
                // 新版本入口（仅有新版本时渲染）：可用→绿底下载 icon（点击下载，
                // 不支持自动更新时跳 releases 页）；下载中→蓝底进度；已下载→橙底安装 icon。
                updateState.status === "available" ? (
                  <Tooltip
                    title={t("Claw.App.UpdateTag.update")}
                    mouseEnterDelay={0.7}
                  >
                    <Button
                      type="text"
                      size="small"
                      aria-label={t("Claw.App.UpdateTag.update")}
                      onClick={async () => {
                        if (updateState.canAutoUpdate === false) {
                          await window.electronAPI?.app?.openReleasesPage?.();
                          return;
                        }
                        try {
                          setUpdateState((prev) => ({
                            ...prev,
                            status: "downloading",
                            progress: undefined,
                          }));
                          const res =
                            await window.electronAPI?.app?.downloadUpdate?.();
                          if (!res || !res.success) {
                            message.error(
                              res?.error || t("Claw.About.downloadFailed"),
                            );
                            setUpdateState((prev) => ({
                              ...prev,
                              status: "available",
                            }));
                          }
                        } catch {
                          message.error(t("Claw.About.downloadFailed"));
                          setUpdateState((prev) => ({
                            ...prev,
                            status: "available",
                          }));
                        }
                      }}
                      style={{
                        // 绿底白 icon：一眼可辨的"可下载"动作按钮（用户要求的下载 icon + 背景色）
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 26,
                        height: 26,
                        padding: 0,
                        borderRadius: 13,
                        background: "#52c41a",
                        color: "#fff",
                        fontSize: 13,
                      }}
                    >
                      <DownloadOutlined />
                    </Button>
                  </Tooltip>
                ) : updateState.status === "downloading" ? (
                  <div
                    style={{
                      // 蓝底进度胶囊：下载中不可点，展示百分比（真实进度缺失时用模拟进度）
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      height: 26,
                      padding: "0 10px",
                      borderRadius: 13,
                      background: "#2563eb",
                      color: "#fff",
                      fontSize: 12,
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <LoadingOutlined spin />
                    {t("Claw.App.UpdateTag.downloading", {
                      percent: Math.round(
                        updateState.progress?.percent ?? headerSimulatedPercent,
                      ),
                    })}
                  </div>
                ) : updateState.status === "downloaded" ? (
                  <Tooltip
                    title={t("Claw.About.installUpdate")}
                    mouseEnterDelay={0.7}
                  >
                    <Button
                      type="text"
                      size="small"
                      aria-label={t("Claw.About.installUpdate")}
                      onClick={async () => {
                        try {
                          const res =
                            await window.electronAPI?.app?.installUpdate?.();
                          if (res && !res.success) {
                            message.error(
                              res.error || t("Claw.About.installFailed"),
                            );
                          }
                        } catch {
                          message.error(t("Claw.About.installFailed"));
                        }
                      }}
                      style={{
                        // 橙底安装 icon：提示"下载完成，点击重启安装"
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 26,
                        height: 26,
                        padding: 0,
                        borderRadius: 13,
                        background: "#fa8c16",
                        color: "#fff",
                        fontSize: 13,
                      }}
                    >
                      <RocketOutlined />
                    </Button>
                  </Tooltip>
                ) : undefined
              }
            />

            {/* 主体部分：平台 webview 常驻挂载，切换时仅隐藏不重载 */}
            <div className="app-body">
              <div
                className={`app-content app-content-fullwidth ${styles.platformPane}`}
                style={{
                  display: "flex",
                  // 沉浸式：撤除顶栏后 webview 顶到窗口上沿（top:0）整窗满屏；
                  // 工具栏（TrafficLightToolbar）作为独立浮层覆盖顶部，不占文档流。
                  // z-index 1000（高于设置 Modal 同级层）；工具栏 z-index 1100 更高。
                  // （app-container/app-body 无 transform，fixed 定位不被祖先捕获。）
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 1000,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <NuwaxHostWebview
                    ref={webviewRef}
                    reloadKey={browserOpenKey}
                    onNavStateChange={handleNavStateChange}
                  />
                </div>
              </div>

              {/* 系统配置浮层：原 configPane 整页切换 → antd Modal，沉浸式下不打断 webview。
                  关闭钮不走 Modal 默认（绝对定位 top:17 与收紧后的 header 对不齐，且
                  antd 5.29 styles 无 close 语义键），改为 closable=false + title 内 flex 行
                  自渲染，随 header 文档流天然垂直居中。 */}
              <Modal
                open={settingsModalOpen}
                onCancel={() => setSettingsModalOpen(false)}
                footer={null}
                centered
                width={800}
                closable={false}
                title={
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span>客户端配置</span>
                    <span style={{ flex: 1 }} />
                    <Button
                      type="text"
                      size="small"
                      aria-label="关闭"
                      onClick={() => setSettingsModalOpen(false)}
                      style={{
                        width: 24,
                        height: 24,
                        padding: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        // 右移补偿：让 icon 视觉中心对齐 header 16px 右内边距
                        marginInlineEnd: -6,
                        color: "rgba(0, 0, 0, 0.58)",
                      }}
                    >
                      <CloseOutlined />
                    </Button>
                  </div>
                }
                styles={{
                  // 四周外边距收紧
                  content: {
                    padding: "0",
                    borderRadius: "12px",
                    overflow: "hidden",
                  },
                  header: {
                    padding: "10px 16px",
                    marginBottom: "0",
                    borderBottom: "1px solid var(--color-border)",
                  },
                  // 固定尺寸 800×600：外壳不滚，左菜单/右内容在固定高度容器内各自滚动
                  body: {
                    height: 600,
                    boxSizing: "border-box",
                    overflow: "hidden",
                  },
                  // 遮罩：玻璃模糊（低不透明度，透出背景）
                  mask: {
                    background: "rgba(0, 0, 0, 0.3)",
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                  },
                }}
                destroyOnHidden
              >
                <div
                  className={styles.configPane}
                  style={{
                    display: "flex",
                    height: "100%", // 撑满 body 固定高度，左菜单/右内容各自内部滚动
                  }}
                >
                  <div
                    className={
                      i18nLang.toLowerCase().startsWith("en")
                        ? "app-sider app-sider-en"
                        : "app-sider"
                    }
                  >
                    <Menu
                      mode="inline"
                      inlineIndent={0}
                      selectedKeys={[activeTab]}
                      items={menuItems.map((item) => ({
                        key: item.key,
                        icon: item.icon,
                        label: item.label,
                        onClick: () => setActiveTab(item.key as TabKey),
                      }))}
                    />
                  </div>
                  <div className="app-content">
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
                          onNavigate={(tab) => setActiveTab(tab as TabKey)}
                          services={services}
                          servicesLoading={servicesLoading}
                          startingServices={startingServices}
                          setStartingServices={setStartingServices}
                          onRefreshServices={pollServicesStatus}
                          authRefreshTrigger={authRefreshTrigger}
                          onAuthChange={handleAuthChange}
                          onLoginStarted={handleLoginStarted}
                          onLoginComplete={openBrowserHome}
                          onStartSession={openStartSession}
                          isWebviewLoggedIn={isAuthLoggedIn}
                          onGotoLogin={() => setMainViewMode("browser")}
                        />
                      )}
                      {activeTab === "sessions" && (
                        <SessionsPage onOpenInBrowser={openInBrowser} />
                      )}
                      <div
                        style={{
                          display: activeTab === "mcp" ? "contents" : "none",
                        }}
                      >
                        <MCPSettings isOpen={activeTab === "mcp"} />
                      </div>
                      {activeTab === "settings" && <SettingsPage />}
                      {activeTab === "dependencies" && <DependenciesPage />}
                      {activeTab === "permissions" && <PermissionsPage />}
                      {activeTab === "logs" && <LogViewer />}
                      {activeTab === "about" && <AboutPage />}
                    </div>
                  </div>
                </div>
              </Modal>
            </div>
          </div>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </ConfigProvider>
  );
}

export default App;
