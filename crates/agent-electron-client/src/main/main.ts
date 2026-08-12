import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  session,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import log from "electron-log";
import { initDatabase, closeDb, readSetting } from "./db";
import { ManagedProcess } from "./processManager";
import { registerAllHandlers } from "./ipc/index";
import { unregisterEventForwarders } from "./ipc/eventForwarders";
import { runStartupTasks } from "./bootstrap/startup";
import { agentService } from "./services/engines/unifiedAgent";
import { stopComputerServer } from "./services/computerServer";
import { mcpProxyManager } from "./services/packages/mcp";
import { stopGuiAgentServer } from "./services/packages/guiAgentServer";
import { FEATURES } from "@shared/featureFlags";
import { stopWindowsMcp } from "./services/packages/windowsMcp";
import { stopTtydGateway } from "./services/packages/ttydGateway";
import type { HandlerContext } from "@shared/types/ipc";
import { DEFAULT_DEV_SERVER_PORT } from "./services/constants";
import {
  APP_DISPLAY_NAME,
  CLEANUP_TIMEOUT,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_MIN_HEIGHT,
  DEFAULT_WINDOW_MIN_WIDTH,
  DEFAULT_WINDOW_WIDTH,
} from "@shared/constants";
import { initLogging, updateLogLevel } from "./bootstrap/logConfig";
import { initI18n, setMainLang } from "./services/i18n";
import { createTrayManager, TrayStatus } from "./window/trayManager";
import { createServiceManager } from "./window/serviceManager";
import { initAutoUpdater } from "./services/autoUpdater";
import { migrateDataDir, migrateSettingsPaths } from "./bootstrap/migrate";
import { getDeviceId, logSystemInfo } from "./services/system/deviceId";
import { initWebviewPolicy } from "./services/system/webviewPolicy";
import { stopAllEngines } from "./services/engines/engineManager";
import { processRegistry } from "./services/system/processRegistry";
import { APP_DATA_DIR_NAME } from "@shared/constants";

// 处理 EPIPE 错误（社区最佳实践）
// 当 stdout/stderr 的接收端关闭时，写入操作会触发 EPIPE 错误
// 这里静默忽略这些错误，防止 uncaughtException 无限循环
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") return;
  throw err;
});

process.stderr.on("error", (err) => {
  if (err.code === "EPIPE") return;
  throw err;
});

// macOS 26 Tahoe 兼容性：禁用 Fontations 字体后端
// 参考: https://github.com/electron/electron/issues/49522
if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-features", "FontationsFontBackend");
}

// Linux 沙箱处理
// 参考: https://github.com/electron/electron/issues/17972
// 参考: https://github.com/electron-userland/electron-builder/issues/8951
//
// 沙箱启用策略：
// 1. deb/rpm 包：通过 postinst 脚本设置 chrome-sandbox 的 SUID 权限
// 2. AppImage：依赖 unprivileged user namespaces（内核需要支持）
// 3. 开发模式：禁用沙箱以方便调试
// 4. 用户可通过环境变量 ELECTRON_DISABLE_SANDBOX=1 强制禁用
//
// 注意: 此代码在 initLogging() 之前执行，所以使用 console 而不是 log
if (process.platform === "linux") {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const isAppImage = process.env.APPIMAGE !== undefined;
  const disableSandbox = process.env.ELECTRON_DISABLE_SANDBOX === "1";
  const isDev = !app.isPackaged;

  // 警告: 以 root 身份运行存在安全风险
  if (isRoot) {
    console.warn("[Security] Running as root is not recommended.");
    console.warn("[Security] This poses significant security risks.");
  }

  // AppImage 使用 namespace-based sandbox
  if (isAppImage) {
    console.info(
      "[AppImage] Using namespace-based sandbox (requires kernel unprivileged user namespaces)",
    );
  }

  if (disableSandbox) {
    // 用户显式禁用沙箱
    console.warn("[Security] Sandbox disabled by ELECTRON_DISABLE_SANDBOX=1");
    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-setuid-sandbox");
  } else if (isDev) {
    // 开发模式：禁用沙箱
    console.info("[Dev] Sandbox disabled in development mode");
    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-setuid-sandbox");
  } else {
    // 生产模式：默认启用沙箱
    console.info(
      "[Production] Sandbox enabled (SUID for deb/rpm, namespace for AppImage)",
    );
  }
}

// 日志：轮转 + TTL 清理 + 开发/正式差异化（见 logConfig.ts）
initLogging();
initI18n();
log.info("Application starting...");
log.info("[FeatureFlags][main]", FEATURES);

// Global references
let mainWindow: BrowserWindow | null = null;
let trayManager: ReturnType<typeof createTrayManager> | null = null;
let isQuitting = false; // 标志：是否正在真正退出应用
let isInstallingUpdate = false; // 标志：是否正在执行 quitAndInstall 安装更新
let pendingSecondInstanceFocus = false; // 标志：窗口未创建前收到 second-instance 事件

// 单实例保护：Windows 托盘常驻场景下再次启动时，复用当前实例而不是创建新实例
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  log.warn("[App] Another instance is already running, quitting current one");
  app.quit();
}

app.on("second-instance", () => {
  log.info("[App] second-instance event received");
  if (!mainWindow) {
    pendingSecondInstanceFocus = true;
    if (app.isReady()) {
      createWindow();
    }
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
});

// Get icon path (works in both dev and production)
function getIconPath() {
  if (app.isPackaged) {
    // Production: icons in app.asar (Resources)
    if (process.platform === "darwin") {
      return path.join(process.resourcesPath, "icon.icns");
    }
    return path.join(process.resourcesPath, "icon.png");
  }
  // Development: icons in project root
  if (process.platform === "darwin") {
    return path.join(process.cwd(), "public", "icon.icns");
  }
  return path.join(process.cwd(), "public", "icon.png");
}

// Get icon path for Dock (must be PNG - nativeImage cannot load .icns)
function getDockIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon-dock.png");
  }
  return path.join(process.cwd(), "public", "icon-dock.png");
}

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
if (isDev) {
  app.commandLine.appendSwitch("disable-http-cache");
}
const WEBVIEW_PERF_BRIDGE_PRELOAD = path.join(
  __dirname,
  "..",
  "preload",
  "webviewPerfBridge.js",
);
function shouldInjectWebviewPerfBridge(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol);
  } catch {
    return false;
  }
}

// Managed child processes
const lanproxy = new ManagedProcess("lanproxy");
const fileServer = new ManagedProcess("fileServer");
const agentRunner = new ManagedProcess("agentRunner");
const guiServer = new ManagedProcess("gui-agent-server");
const ttyd = new ManagedProcess("ttyd");
let agentRunnerPorts: { backendPort: number; proxyPort: number } | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: DEFAULT_WINDOW_MIN_WIDTH,
    minHeight: DEFAULT_WINDOW_MIN_HEIGHT,
    title: APP_DISPLAY_NAME,
    icon: getIconPath(),
    // 沉浸式无边框：隐藏原生系统标题栏，让 nuwax 内容顶到窗口上沿。
    // mac 保留原生红绿灯（悬浮于内容之上）；Win/Linux 完全无边框，由 renderer 自绘窗口控制按钮。
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : { frame: false, hasShadow: true }),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Need to access node for MCP
      webviewTag: true,
      spellcheck: false, // 禁用拼写检查
    },
    show: false,
  });

  // 为 webview guest 注入轻量 Bridge（NuwaClawBridge）。
  // 当前策略：对所有 http/https 页面注入；真正是否生效由 guest 侧路由+容器二次判断。
  mainWindow.webContents.on(
    "will-attach-webview",
    (_event, webPreferences, params) => {
      const targetUrl = String(params.src || "");
      if (!shouldInjectWebviewPerfBridge(targetUrl)) {
        return;
      }
      webPreferences.preload = WEBVIEW_PERF_BRIDGE_PRELOAD;
      log.info("[WebviewBridge] Injected guest preload for:", targetUrl);
    },
  );

  // Load the app
  if (isDev) {
    const devCacheBust = Date.now();
    const devUrl = `http://localhost:${DEFAULT_DEV_SERVER_PORT}/?_ncd=${devCacheBust}`;
    void mainWindow.webContents.session
      .clearCache()
      .catch((err) => log.warn("[DevCache] clearCache failed:", err))
      .finally(() => {
        void mainWindow?.loadURL(devUrl);
      });
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：dist 目录被打包到 app.asar 中
    // 用 loadFile 让 Electron 内部走 pathToFileURL，避免 Windows 上路径含空格 / 中文 / 反斜杠时
    // 拼出畸形 file:// URL，进而影响 Monaco 等通过 window.location.href 解析相对路径的资源加载
    const indexPath = path.join(
      process.resourcesPath,
      "app.asar",
      "dist",
      "index.html",
    );
    log.info("Loading app from:", indexPath);
    mainWindow.loadFile(indexPath);
  }

  // Handle load failures
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      log.error("Failed to load:", validatedURL, errorCode, errorDescription);
      dialog.showErrorBox(
        "Load Error",
        `Failed to load application: ${errorDescription}\n\nURL: ${validatedURL}`,
      );
    },
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
    log.info("Main window shown (maximized)");
    // macOS 开发模式：窗口显示后再创建托盘，提高菜单栏图标出现概率
    if (process.platform === "darwin" && !app.isPackaged && !trayManager) {
      setTimeout(
        () =>
          initTrayManager().catch((e) =>
            log.warn("[Tray] Delayed init failed:", e),
          ),
        300,
      );
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 所有平台：点击关闭按钮时隐藏到托盘，而不是退出应用
  // 只有从托盘菜单点击"退出"时才真正退出
  mainWindow.on("close", (e) => {
    if (isQuitting) {
      // 正在退出，允许关闭
      return;
    }
    // 阻止关闭，改为隐藏
    e.preventDefault();
    mainWindow?.hide();
    log.info("[App] Window hidden to tray (close intercepted)");
  });

  // Create application menu
  createMenu();
}

function createMenu() {
  if (process.platform === "darwin") {
    // macOS: 保留最小菜单，确保 Cmd+C/V/Q 等快捷键正常
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: "appMenu" },
      { role: "editMenu" },
      { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux: 去掉菜单栏，功能由界面和系统托盘提供
    Menu.setApplicationMenu(null);
  }
}

async function initTrayManager() {
  // 创建服务管理器
  const serviceManager = createServiceManager({
    lanproxy,
    fileServer,
    agentRunner,
    ttyd,
  });

  trayManager = createTrayManager({
    onShowWindow: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        // 窗口不存在时重新创建
        createWindow();
      }
    },
    onRestartServices: async () => {
      log.info("[Tray] Restarting all services...");
      await serviceManager.restartAllServices();
      trayManager?.updateServicesStatus(true);
    },
    onStopServices: async () => {
      log.info("[Tray] Stopping all services...");
      await serviceManager.stopAllServices();
      trayManager?.updateServicesStatus(false);
      log.info("[Tray] All services stopped");
    },
  });

  await trayManager.create();
  log.info("[Tray] TrayManager initialized");
}

// IPC handler for tray status updates from renderer
ipcMain.handle("tray:updateStatus", (_, status: TrayStatus) => {
  if (trayManager) {
    trayManager.setStatus(status);
  }
});

ipcMain.handle("tray:updateServicesStatus", (_, running: boolean) => {
  if (trayManager) {
    trayManager.updateServicesStatus(running);
  }
});

async function cleanupAllProcesses(): Promise<void> {
  log.info("[Cleanup] Stopping all processes...");

  const stepTimeoutMs = Math.max(1500, Math.floor(CLEANUP_TIMEOUT / 6));
  const runCleanupStep = async (
    label: string,
    fn: () => Promise<void> | void,
  ): Promise<void> => {
    let completed = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const task = (async () => {
      try {
        await fn();
      } catch (e) {
        log.error(`[Cleanup] ${label} error:`, e);
      } finally {
        completed = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      }
    })();
    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          if (!completed) {
            log.warn(`[Cleanup] ${label} timed out after ${stepTimeoutMs}ms`);
          }
          timeoutHandle = null;
          resolve();
        }, stepTimeoutMs);
      }),
    ]);
  };

  await runCleanupStep("Computer server stop", async () => {
    await stopComputerServer();
  });

  await runCleanupStep("ttyd gateway stop", async () => {
    await stopTtydGateway();
  });

  await runCleanupStep("Event forwarders unregister", () => {
    unregisterEventForwarders();
  });

  await runCleanupStep("Agent service destroy", async () => {
    await agentService.destroy();
  });

  await runCleanupStep("MCP proxy cleanup", async () => {
    await mcpProxyManager.cleanup();
  });

  // Windows：windows-mcp（uv/python）由独立 ManagedProcess 管理
  await runCleanupStep("Windows MCP stop", async () => {
    await stopWindowsMcp();
  });

  // 非 Windows：agent-gui-server 进程
  if (FEATURES.ENABLE_GUI_AGENT_SERVER) {
    await runCleanupStep("GUI Agent server stop", async () => {
      await stopGuiAgentServer();
    });
  }

  await runCleanupStep("Engine processes stop", () => {
    stopAllEngines();
    log.info("[Cleanup] Engine processes stopped");
  });

  await runCleanupStep("Process registry killAll", async () => {
    await processRegistry.killAll();
    log.info("[Cleanup] Process registry cleared");
  });

  // Last-resort force kill for legacy managed processes.
  // NOTE: guiServer is a legacy placeholder and typically not started directly.
  agentRunner.kill();
  lanproxy.kill();
  fileServer.kill();
  guiServer.kill();
  ttyd.kill();

  log.info("[Cleanup] All processes stopped");
}

// App lifecycle
app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  log.info("App ready");
  logSystemInfo();

  // Dev mode: fix CORS duplicate header issue
  // Server returns both specific origin and '*', causing browser to reject.
  // Strip duplicate Access-Control-Allow-Origin values.
  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders;
      if (headers) {
        const acoKey = Object.keys(headers).find(
          (k) => k.toLowerCase() === "access-control-allow-origin",
        );
        if (acoKey && headers[acoKey] && headers[acoKey].length > 1) {
          // Keep only the specific origin (not '*')
          const specific = headers[acoKey].find((v) => v !== "*");
          headers[acoKey] = [specific || "*"];
          // 仅在确实修改了 ACO 时才回传 responseHeaders，
          // 避免无条件替换导致 Set-Cookie 被 Chromium 网络服务丢弃
          callback({ responseHeaders: headers });
          return;
        }
      }
      // 未修改任何 header → 不传 responseHeaders，Chromium 原样传递
      callback({});
    });
    log.info("Dev CORS fix enabled");
  }

  // 为所有 http/https 出站请求注入客户端标识头，供 nuwax 后端识别「桌面客户端内」环境，
  // 后端凭该头在登录响应里返回 token（nuwax 用 Authorization 头鉴权）。值非敏感
  // （客户端身份本就体现在 UA 中），对所有域生效，避免漏掉 nuwax 后端域名导致识别失败。
  //
  // 但当请求「来源 origin」是 nuwax 本地开发调试服务(localhost / 127.0.0.1)时跳过注入：
  // 后端为前端调试设计——凭 origin=localhost 即返回 token，无需此头；且注入这个自定义头
  // 会使跨域请求触发 CORS preflight（后端 CORS 未放行 x-client-type）而被拦下、请求发不出。
  // 生产 webview 加载 nuwax 线上域(origin 非 localhost)，正常注入、凭头识别。
  // 注意：判断维度是「nuwax dev server 的来源 origin」，不是 electron 客户端自身的 isDev。
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      const origin =
        details.requestHeaders["Origin"] ||
        details.requestHeaders["origin"] ||
        "";
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(origin)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      details.requestHeaders["x-client-type"] = "nuwaclaw";
      callback({ requestHeaders: details.requestHeaders });
    },
  );
  log.info(
    "x-client-type header injection enabled (skipped for localhost/127.0.0.1 dev origin)",
  );

  // Set Dock icon on macOS (development mode needs this)
  if (process.platform === "darwin" && app.dock) {
    const iconPath = getDockIconPath();
    log.info("Setting Dock icon from:", iconPath);
    try {
      const iconImage = nativeImage.createFromPath(iconPath);
      log.info(
        "Icon image size:",
        iconImage.getSize(),
        "isEmpty:",
        iconImage.isEmpty(),
      );
      if (!iconImage.isEmpty()) {
        app.dock.setIcon(iconImage);
        log.info("Dock icon set successfully");
      } else {
        log.warn("Icon image is empty");
      }
    } catch (e) {
      log.warn("Failed to set Dock icon:", e);
    }
  }

  migrateDataDir();
  initDatabase();
  migrateSettingsPaths();
  getDeviceId();

  // 数据库就绪后，根据更新通道设置日志级别
  const updateChannel = readSetting("update_channel") as string | undefined;
  updateLogLevel(updateChannel || "stable");

  // 数据库就绪后，同步语言到主进程 i18n
  // 优先级：本地保存 > Electron 系统语言 > 英文兜底
  const savedLang = readSetting("i18n.active_lang") as string | undefined;
  if (savedLang) {
    setMainLang(savedLang);
  } else {
    // 无本地偏好：用 Electron 系统语言（app.ready 后可靠）
    setMainLang(app.getLocale() || "en");
  }

  const ctx: HandlerContext = {
    getMainWindow: () => mainWindow,
    lanproxy,
    fileServer,
    agentRunner,
    guiServer,
    ttyd,
    get agentRunnerPorts() {
      return agentRunnerPorts;
    },
    setAgentRunnerPorts: (ports) => {
      agentRunnerPorts = ports;
    },
  };

  registerAllHandlers(ctx);
  await runStartupTasks();

  // 须在 createWindow 之前初始化，否则主窗口 webContents 会错过 did-attach-webview 监听
  initWebviewPolicy(() => mainWindow);

  createWindow();
  if (pendingSecondInstanceFocus && mainWindow) {
    pendingSecondInstanceFocus = false;
    mainWindow.show();
    mainWindow.focus();
  }

  // 非 macOS 或已打包：立即创建托盘。macOS 开发模式改为在 ready-to-show 后创建
  if (!(process.platform === "darwin" && !app.isPackaged)) {
    if (process.platform === "darwin" && app.dock) app.dock.show();
    await initTrayManager();
  }

  initAutoUpdater(
    () => mainWindow,
    cleanupAllProcesses,
    () => {
      // 在 quitAndInstall 前被调用：
      // - isQuitting=true 防止窗口 close 事件被拦截到托盘
      // - isInstallingUpdate=true 让 before-quit 跳过 e.preventDefault()，
      //   保留 Squirrel.Mac 的正常退出流程
      isQuitting = true;
      isInstallingUpdate = true;
      log.info(
        "[App] Update install flagged: isQuitting=true, isInstallingUpdate=true",
      );
    },
  );
});

app.on("window-all-closed", () => {
  // 窗口已隐藏到托盘，此事件不应触发
  // 如果触发，说明窗口被意外关闭，不退出应用
  log.info(
    "[App] window-all-closed event fired (should not happen with tray mode)",
  );
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

let isCleaningUp = false;

app.on("before-quit", (e) => {
  if (isCleaningUp) return;
  isCleaningUp = true;
  isQuitting = true; // 通知窗口 close 事件允许关闭

  if (isInstallingUpdate) {
    // quitAndInstall 场景（macOS Squirrel.Mac / Windows NSIS / Linux AppImage 均走此路径）：
    // - cleanup 已在 installUpdate() 中先行触发，无需重复执行
    // - 不能调用 e.preventDefault()：各平台安装器依赖 app.quit() 的正常退出流程；
    //   若阻止退出再 app.exit(0)，安装器可能已经失去对退出时机的感知，导致安装失败
    // 只关闭数据库后直接 return，让 Electron 正常完成退出，安装器接管
    log.info(
      "[App] Before quit - update install in progress, skipping preventDefault to allow installer",
    );
    closeDb();
    return;
  }

  // 普通退出流程：阻止立即退出，异步清理完成后再调用 app.exit(0)
  e.preventDefault();

  log.info("[App] Before quit - starting cleanup");

  void (async () => {
    const start = Date.now();
    try {
      await cleanupAllProcesses();
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed > CLEANUP_TIMEOUT) {
        log.warn(
          `[App] Cleanup exceeded budget (${elapsed}ms > ${CLEANUP_TIMEOUT}ms), forcing exit`,
        );
      }
      closeDb();
      log.info("[App] Cleanup complete, exiting");
      app.exit(0);
    }
  })();
});

app.on("will-quit", () => {
  log.info("[App] Will quit");
});

/**
 * 直接写入错误日志到文件，完全绕过 electron-log 的 transport 机制
 * 这样可以彻底避免 EPIPE 错误导致的无限循环
 */
function writeErrorLog(errorType: string, error: unknown): void {
  try {
    // 获取日志目录（使用预先导入的模块，避免在异常处理器中 require）
    const nuwaxHome = path.join(app.getPath("home"), APP_DATA_DIR_NAME);
    const logDir = path.join(nuwaxHome, "logs");
    // 使用本地时间，与 logConfig.ts 中的 todayDateStr() 保持一致
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const logFile = path.join(logDir, `main.${today}.log`);

    // 确保目录存在
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // 格式化错误信息
    const timestamp = new Date().toISOString();
    const errorMsg =
      error instanceof Error ? error.stack || error.message : String(error);
    const logEntry = `[${timestamp}] ERROR ${errorType}: ${errorMsg}\n`;

    // 直接追加到文件
    fs.appendFileSync(logFile, logEntry, { encoding: "utf8" });

    // 同时尝试写入控制台（如果失败则忽略）
    try {
      process.stderr.write(logEntry);
    } catch {
      // 忽略 stderr 写入失败
    }
  } catch {
    // 如果文件写入也失败，尝试最后的手段
    try {
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[FATAL] ${errorType}: ${errorMsg}\n`);
    } catch {
      // 完全失败，无法记录错误
    }
  }
}

// Handle uncaught exceptions - 使用直接文件写入，完全绕过 electron-log 的 transport 机制
process.on("uncaughtException", (error) => {
  writeErrorLog("uncaughtException", error);
});

// Handle unhandled rejections - 使用直接文件写入，避免可能的无限循环
process.on("unhandledRejection", (reason) => {
  writeErrorLog("unhandledRejection", reason);
});
