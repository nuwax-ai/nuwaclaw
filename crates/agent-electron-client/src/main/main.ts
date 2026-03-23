import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  Tray,
  nativeImage,
  session,
} from "electron";
import * as path from "path";
import log from "electron-log";
import { initDatabase, closeDb } from "./db";
import { ManagedProcess } from "./processManager";
import { registerAllHandlers } from "./ipc/index";
import { unregisterEventForwarders } from "./ipc/eventForwarders";
import { runStartupTasks } from "./bootstrap/startup";
import { agentService } from "./services/engines/unifiedAgent";
import { stopComputerServer } from "./services/computerServer";
import { mcpProxyManager } from "./services/packages/mcp";
import type { HandlerContext } from "@shared/types/ipc";
import { DEFAULT_DEV_SERVER_PORT } from "./services/constants";
import { APP_DISPLAY_NAME, CLEANUP_TIMEOUT } from "@shared/constants";
import { initLogging } from "./bootstrap/logConfig";
import { createTrayManager, TrayStatus } from "./window/trayManager";
import { createServiceManager } from "./window/serviceManager";
import { initAutoUpdater } from "./services/autoUpdater";
import { migrateDataDir, migrateSettingsPaths } from "./bootstrap/migrate";
import { getDeviceId } from "./services/system/deviceId";
import { initWebviewPolicy } from "./services/system/webviewPolicy";

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
log.info("Application starting...");

// Global references
let mainWindow: BrowserWindow | null = null;
let trayManager: ReturnType<typeof createTrayManager> | null = null;
let isQuitting = false; // 标志：是否正在真正退出应用
let isInstallingUpdate = false; // 标志：是否正在执行 quitAndInstall 安装更新

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

// Managed child processes
const lanproxy = new ManagedProcess("lanproxy");
const fileServer = new ManagedProcess("fileServer");
const agentRunner = new ManagedProcess("agentRunner");
let agentRunnerPorts: { backendPort: number; proxyPort: number } | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: APP_DISPLAY_NAME,
    icon: getIconPath(),
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

  // Load the app
  if (isDev) {
    mainWindow.loadURL(`http://localhost:${DEFAULT_DEV_SERVER_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：dist 目录被打包到 app.asar 中
    // 使用 file:// 协议直接加载 asar 内的文件
    const indexUrl = `file://${process.resourcesPath}/app.asar/dist/index.html`;
    log.info("Loading app from:", indexUrl);
    mainWindow.loadURL(indexUrl);
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
    mainWindow?.show();
    log.info("Main window shown");
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

  try {
    await stopComputerServer();
  } catch (e) {
    log.error("[Cleanup] Computer server stop error:", e);
  }

  try {
    unregisterEventForwarders();
  } catch (e) {
    log.error("[Cleanup] Event forwarders unregister error:", e);
  }

  try {
    await agentService.destroy();
  } catch (e) {
    log.error("[Cleanup] Agent service destroy error:", e);
  }

  agentRunner.kill();
  lanproxy.kill();
  fileServer.kill();

  try {
    await mcpProxyManager.cleanup();
  } catch (e) {
    log.warn("[Cleanup] MCP proxy cleanup error:", e);
  }

  try {
    const { stopAllEngines } = require("./services/engines/engineManager");
    stopAllEngines();
    log.info("[Cleanup] Engine processes stopped");
  } catch (e) {
    // Engine service might not be loaded
  }

  // Final safety net: kill all registered ACP processes
  try {
    const { processRegistry } = require("./services/system/processRegistry");
    await processRegistry.killAll();
    log.info("[Cleanup] Process registry cleared");
  } catch (e) {
    log.warn("[Cleanup] Process registry cleanup error:", e);
  }

  log.info("[Cleanup] All processes stopped");
}

// App lifecycle
app.whenReady().then(async () => {
  log.info("App ready");

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
        }
      }
      callback({ responseHeaders: headers });
    });
    log.info("Dev CORS fix enabled");
  }

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

  const ctx: HandlerContext = {
    getMainWindow: () => mainWindow,
    lanproxy,
    fileServer,
    agentRunner,
    get agentRunnerPorts() {
      return agentRunnerPorts;
    },
    setAgentRunnerPorts: (ports) => {
      agentRunnerPorts = ports;
    },
  };

  registerAllHandlers(ctx);
  await runStartupTasks();

  createWindow();
  initWebviewPolicy(() => mainWindow);

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

  Promise.race([
    cleanupAllProcesses(),
    new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT)),
  ]).finally(() => {
    closeDb();
    log.info("[App] Cleanup complete, exiting");
    app.exit(0);
  });
});

app.on("will-quit", () => {
  log.info("[App] Will quit");
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
});
