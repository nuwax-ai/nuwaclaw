import {
  ipcMain,
  app,
  dialog,
  shell,
  session as electronSession,
  systemPreferences,
  BrowserWindow,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import log from "electron-log";
import type { HandlerContext } from "@shared/types/ipc";
import { LATEST_LOG_BASENAME } from "../bootstrap/logConfig";
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateState,
  openReleasesPage,
} from "../services/autoUpdater";
import { getDeviceId } from "../services/system/deviceId";
import { getTrayManager } from "../window/trayManager";
import { getAutoLaunchManager } from "../window/autoLaunchManager";
import { APP_DISPLAY_NAME } from "@shared/constants";

// WebView 窗口缓存
let webviewWindow: BrowserWindow | null = null;

export function registerAppHandlers(ctx: HandlerContext): void {
  // Autolaunch — 统一通过 AutoLaunchManager 操作，确保 args 一致（Windows 注册表 entry 一致）
  ipcMain.handle("autolaunch:get", async () => {
    try {
      const mgr = getAutoLaunchManager();
      if (mgr) return mgr.isEnabled();
      // fallback: AutoLaunchManager 未初始化时直接读
      const settings = app.getLoginItemSettings({ args: ["--hidden"] });
      return settings.openAtLogin;
    } catch (error) {
      log.error("[IPC] autolaunch:get failed:", error);
      return false;
    }
  });

  ipcMain.handle("autolaunch:set", async (_, enabled: boolean) => {
    try {
      const mgr = getAutoLaunchManager();
      let success = false;
      if (mgr) {
        success = await mgr.setEnabled(enabled);
      } else {
        // fallback
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true,
          args: ["--hidden"],
        });
        success = true;
      }
      if (!success) return { success: false, error: "设置失败" };
      // 同步托盘缓存状态
      getTrayManager()?.refreshAutoLaunchState();
      // 通知所有渲染进程
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("autolaunch:changed", enabled);
        }
      }
      return { success: true };
    } catch (error) {
      log.error("[IPC] autolaunch:set failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // Log handlers
  ipcMain.handle("log:getDir", () => {
    return log.transports.file.getFile().path
      ? path.dirname(log.transports.file.getFile().path)
      : app.getPath("logs");
  });

  // Renderer 进程写入日志到主进程日志文件
  ipcMain.handle(
    "log:write",
    async (
      _,
      level: "info" | "warn" | "error",
      message: string,
      ...args: unknown[]
    ) => {
      switch (level) {
        case "error":
          log.error(message, ...args);
          break;
        case "warn":
          log.warn(message, ...args);
          break;
        default:
          log.info(message, ...args);
      }
    },
  );

  ipcMain.handle("log:openDir", async () => {
    try {
      const currentPath = log.transports.file.getFile().path;
      const logDir = currentPath
        ? path.dirname(currentPath)
        : app.getPath("logs");
      const latestPath = path.join(logDir, LATEST_LOG_BASENAME);
      const fileToSelect = fs.existsSync(latestPath)
        ? latestPath
        : currentPath || path.join(logDir, "main.log");
      // 打开日志目录并尽量在资源管理器中选中 latest.log（或 main.log），便于用户直接看到当前日志入口
      try {
        if (process.platform === "darwin") {
          execSync(`open -R "${fileToSelect}"`, { encoding: "utf-8" });
        } else if (process.platform === "win32") {
          const winPath = fileToSelect.replace(/\//g, "\\");
          execSync(`explorer /select,"${winPath}"`, { encoding: "utf-8" });
        } else {
          await shell.openPath(logDir);
        }
      } catch (_) {
        await shell.openPath(logDir);
      }
      return { success: true };
    } catch (error) {
      log.error("[IPC] log:openDir failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // 应用日志列表：默认 2000 条，单次最多 10000 条；offset 为“从最新往前跳过条数”，用于向上滚动加载更多
  const DEFAULT_LOG_LIST = 2000;
  const MAX_LOG_LIST = 10000;
  ipcMain.handle(
    "log:list",
    async (_, count: number = DEFAULT_LOG_LIST, offset: number = 0) => {
      try {
        const currentPath = log.transports.file.getFile().path;
        const logDir = currentPath
          ? path.dirname(currentPath)
          : app.getPath("logs");
        const latestPath = path.join(logDir, LATEST_LOG_BASENAME);
        const logPath =
          (fs.existsSync(latestPath) ? latestPath : currentPath) || currentPath;
        if (!logPath || !fs.existsSync(logPath)) {
          return [];
        }
        const content = fs.readFileSync(logPath, "utf-8");
        const lines = content.split("\n").filter(Boolean);
        const limit = Math.min(
          Math.max(1, count ?? DEFAULT_LOG_LIST),
          MAX_LOG_LIST,
        );
        const safeOffset = Math.max(0, offset);
        // 取“从文件末尾往前 offset+limit 到 offset”的一段（时间顺序：旧→新）
        const slice =
          safeOffset === 0
            ? lines.slice(-limit)
            : lines.slice(-(safeOffset + limit), -safeOffset);
        return slice.map((line) => {
          const match = line.match(
            /^\[(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3})\]\s\[(\w+)\]\s(.*)$/,
          );
          if (match) {
            return {
              timestamp: match[1],
              level: match[2].toLowerCase(),
              message: match[3],
            };
          }
          return { timestamp: "", level: "info", message: line };
        });
      } catch (error) {
        log.error("[IPC] log:list failed:", error);
        return [];
      }
    },
  );

  // App handlers
  ipcMain.handle("app:getVersion", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:getDeviceId", () => {
    return getDeviceId();
  });

  ipcMain.handle("app:checkUpdate", async () => {
    try {
      return await checkForUpdates();
    } catch (error) {
      log.error("[IPC] app:checkUpdate failed:", error);
      return { hasUpdate: false, error: String(error) };
    }
  });

  ipcMain.handle("app:downloadUpdate", async () => {
    try {
      return await downloadUpdate();
    } catch (error) {
      log.error("[IPC] app:downloadUpdate failed:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle("app:installUpdate", () => {
    try {
      return installUpdate();
    } catch (error) {
      log.error("[IPC] app:installUpdate failed:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle("app:getUpdateState", () => {
    return getUpdateState();
  });

  ipcMain.handle("app:openReleasesPage", async () => {
    await openReleasesPage();
    return { success: true };
  });

  // Permissions (macOS)
  ipcMain.handle("permissions:check", async () => {
    if (process.platform !== "darwin") {
      return [];
    }
    try {
      const items = [
        {
          key: "accessibility",
          name: "辅助功能",
          description: "允许应用控制您的电脑",
          status: systemPreferences.isTrustedAccessibilityClient(false)
            ? "granted"
            : "denied",
        },
        {
          key: "screen_recording",
          name: "屏幕录制",
          description: "允许应用录制屏幕内容",
          status:
            systemPreferences.getMediaAccessStatus("screen") === "granted"
              ? "granted"
              : "denied",
        },
        {
          key: "file_access",
          name: "全磁盘访问",
          description: "允许应用访问所有文件",
          status: "unknown" as const,
        },
      ];
      return items;
    } catch (error) {
      log.error("[IPC] permissions:check failed:", error);
      return [];
    }
  });

  ipcMain.handle(
    "permissions:openSettings",
    async (_, permissionKey: string) => {
      try {
        if (process.platform !== "darwin") {
          return { success: false, error: "Not macOS" };
        }
        const urlMap: Record<string, string> = {
          accessibility:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          screen_recording:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
          file_access:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        };
        const url = urlMap[permissionKey];
        if (url) {
          await shell.openExternal(url);
          return { success: true };
        }
        return { success: false, error: "Unknown permission" };
      } catch (error) {
        log.error("[IPC] permissions:openSettings failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  // Shell
  ipcMain.handle("shell:openExternal", async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      log.error("[IPC] shell:openExternal failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // Dialog
  ipcMain.handle("dialog:openDirectory", async (_, title?: string) => {
    const mainWindow = ctx.getMainWindow();
    if (!mainWindow) return { success: false, error: "No window" };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || "选择目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, path: result.filePaths[0] };
  });

  // ========== Session / Cookie ==========

  ipcMain.handle(
    "session:setCookie",
    async (
      _,
      params: {
        url: string;
        name: string;
        value: string;
        domain: string;
        httpOnly?: boolean;
        secure?: boolean;
      },
    ) => {
      try {
        await electronSession.defaultSession.cookies.set({
          url: params.url,
          name: params.name,
          value: params.value,
          domain: params.domain,
          httpOnly: params.httpOnly ?? true,
          secure: params.secure ?? true,
          sameSite: "no_restriction" as const,
        });
        log.info("[IPC] session:setCookie success for domain:", params.domain);
        return { success: true };
      } catch (error) {
        log.error("[IPC] session:setCookie failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  // ========== WebView Window ==========

  const WEBVIEW_BOUNDS_KEY = "webview_window_bounds";

  /**
   * 打开独立的 WebView 窗口
   * 使用 defaultSession，与主窗口共享 Cookie
   * 首次最大化，记住用户调整后的尺寸
   */
  ipcMain.handle(
    "webview:openWindow",
    async (
      _,
      params: {
        url: string;
        title?: string;
      },
    ) => {
      try {
        const { url, title } = params;

        // 如果窗口已存在，聚焦并导航
        if (webviewWindow && !webviewWindow.isDestroyed()) {
          webviewWindow.loadURL(url);
          webviewWindow.focus();
          if (title) webviewWindow.setTitle(title);
          log.info(
            "[IPC] webview:openWindow - reused existing window for:",
            url,
          );
          return { success: true, reused: true };
        }

        // 获取图标路径
        const getIconPath = () => {
          if (app.isPackaged) {
            if (process.platform === "darwin") {
              return path.join(process.resourcesPath, "icon.icns");
            }
            return path.join(process.resourcesPath, "icon.png");
          }
          if (process.platform === "darwin") {
            return path.join(process.cwd(), "public", "icon.icns");
          }
          return path.join(process.cwd(), "public", "icon.png");
        };

        // 读取上次保存的窗口尺寸
        let savedBounds: {
          width: number;
          height: number;
          x?: number;
          y?: number;
          maximized?: boolean;
        } | null = null;
        try {
          const saved = await ctx
            .getMainWindow()
            ?.webContents?.executeJavaScript(
              `localStorage.getItem('${WEBVIEW_BOUNDS_KEY}')`,
            );
          if (saved && typeof saved === "string") {
            savedBounds = JSON.parse(saved);
          }
        } catch {
          // 忽略读取错误
        }

        // 创建新窗口
        webviewWindow = new BrowserWindow({
          width: savedBounds?.width || 1200,
          height: savedBounds?.height || 800,
          x: savedBounds?.x,
          y: savedBounds?.y,
          minWidth: 600,
          minHeight: 400,
          title: title || `${APP_DISPLAY_NAME} - 会话浏览器`,
          icon: getIconPath(),
          webPreferences: {
            // 使用 defaultSession，与主窗口共享 Cookie
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false, // 直接加载 URL，不需要 webview tag
            spellcheck: false, // 禁用拼写检查
          },
          show: false,
          backgroundColor: "#ffffff",
        });

        // 首次打开时最大化（没有保存的尺寸时）
        if (!savedBounds) {
          webviewWindow.maximize();
        } else if (savedBounds.maximized) {
          webviewWindow.maximize();
        }

        // 加载 URL
        await webviewWindow.loadURL(url);

        // 窗口显示
        webviewWindow.once("ready-to-show", () => {
          webviewWindow?.show();
          log.info("[IPC] webview:openWindow - window shown for:", url);
        });

        // 保存窗口尺寸（防抖）
        let saveBoundsTimeout: NodeJS.Timeout | null = null;
        const saveBounds = () => {
          if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
          saveBoundsTimeout = setTimeout(() => {
            if (webviewWindow && !webviewWindow.isDestroyed()) {
              const bounds = webviewWindow.getBounds();
              const isMaximized = webviewWindow.isMaximized();
              const data = JSON.stringify({
                ...bounds,
                maximized: isMaximized,
              });
              // 写入 localStorage（通过主窗口）
              ctx
                .getMainWindow()
                ?.webContents?.executeJavaScript(
                  `localStorage.setItem('${WEBVIEW_BOUNDS_KEY}', '${data}')`,
                )
                .catch(() => {});
            }
          }, 500);
        };

        // 监听窗口调整和移动
        webviewWindow.on("resize", saveBounds);
        webviewWindow.on("move", saveBounds);
        webviewWindow.on("maximize", saveBounds);
        webviewWindow.on("unmaximize", saveBounds);

        // 窗口关闭时清理引用
        webviewWindow.on("closed", () => {
          webviewWindow = null;
          if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
          log.info("[IPC] webview:openWindow - window closed");
        });

        return { success: true, reused: false };
      } catch (error) {
        log.error("[IPC] webview:openWindow failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  /**
   * 关闭 WebView 窗口
   */
  ipcMain.handle("webview:closeWindow", async () => {
    try {
      if (webviewWindow && !webviewWindow.isDestroyed()) {
        webviewWindow.close();
        webviewWindow = null;
      }
      return { success: true };
    } catch (error) {
      log.error("[IPC] webview:closeWindow failed:", error);
      return { success: false, error: String(error) };
    }
  });

  /**
   * 检查 WebView 窗口是否打开
   */
  ipcMain.handle("webview:isWindowOpen", async () => {
    return webviewWindow !== null && !webviewWindow.isDestroyed();
  });
}
