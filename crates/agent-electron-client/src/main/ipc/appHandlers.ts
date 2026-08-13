import {
  ipcMain,
  app,
  dialog,
  shell,
  systemPreferences,
  BrowserWindow,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
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
import {
  openMacPrivacySettings,
  isMacPrivacyPane,
} from "../services/system/macPermissions";
import { getTrayManager } from "../window/trayManager";
import { getAutoLaunchManager } from "../window/autoLaunchManager";
import { t } from "../services/i18n";

export function registerAppHandlers(ctx: HandlerContext): void {
  // Autolaunch
  ipcMain.handle("autolaunch:get", async () => {
    try {
      const mgr = getAutoLaunchManager();
      if (mgr) return mgr.isEnabled();
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
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true,
          args: ["--hidden"],
        });
        success = true;
      }
      if (!success)
        return {
          success: false,
          error: t("Claw.Settings.messages.settingFailed"),
        };
      getTrayManager()?.refreshAutoLaunchState();
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

  // 本机电脑名（主机名），供顶栏已登录态作为这台设备的标识展示
  ipcMain.handle("app:getHostname", () => {
    return os.hostname();
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
      const result = await downloadUpdate();
      log.info(
        `[IPC] app:downloadUpdate → success=${result.success}, error="${result.error}"`,
      );
      return result;
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

  ipcMain.handle("app:getUpdateDebugInfo", async () => {
    try {
      const { getInstallerType, canAutoUpdate } =
        await import("../services/autoUpdater");
      const installerType = getInstallerType();
      const canUpdate = canAutoUpdate();

      let appFiles: string[] = [];
      if (process.platform === "win32") {
        try {
          const appDir = path.dirname(app.getPath("exe"));
          appFiles = require("fs").readdirSync(appDir);
        } catch (e) {
          log.error("[IPC] Failed to read app directory for debug:", e);
        }
      }

      const uninstallers = appFiles.filter((f) => {
        const lower = f.toLowerCase();
        return lower.startsWith("uninstall") || lower.startsWith("unins");
      });

      return {
        success: true,
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
        appVersion: app.getVersion(),
        appName: app.getName(),
        appPath: app.getAppPath(),
        exePath: app.getPath("exe"),
        installerType,
        canAutoUpdate: canUpdate,
        appDir:
          process.platform === "win32"
            ? path.dirname(app.getPath("exe"))
            : null,
        uninstallerFiles: uninstallers,
        totalAppFiles: appFiles.length,
      };
    } catch (error) {
      log.error("[IPC] app:getUpdateDebugInfo failed:", error);
      return { success: false, error: String(error) };
    }
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
          name: t("Claw.PermissionsPage.macosAccessibility"),
          description: t("Claw.PermissionsPage.macosAccessibilityDesc"),
          status: systemPreferences.isTrustedAccessibilityClient(false)
            ? "granted"
            : "denied",
        },
        {
          key: "screen_recording",
          name: t("Claw.PermissionsPage.macosScreenRecording"),
          description: t("Claw.PermissionsPage.macosScreenRecordingDesc"),
          status:
            systemPreferences.getMediaAccessStatus("screen") === "granted"
              ? "granted"
              : "denied",
        },
        {
          key: "file_access",
          name: t("Claw.PermissionsPage.macosFullDiskAccess"),
          description: t("Claw.PermissionsPage.macosFullDiskAccessDesc"),
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
        if (!isMacPrivacyPane(permissionKey)) {
          return { success: false, error: "Unknown permission" };
        }
        const ok = await openMacPrivacySettings(permissionKey);
        return ok
          ? { success: true }
          : { success: false, error: "Not macOS or failed to open" };
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

  ipcMain.handle("shell:openPath", async (_, targetPath: string) => {
    try {
      if (!targetPath || typeof targetPath !== "string") {
        return { success: false, error: "Path is required" };
      }
      const openResult = await shell.openPath(targetPath);
      if (openResult) {
        return { success: false, error: openResult };
      }
      return { success: true };
    } catch (error) {
      log.error("[IPC] shell:openPath failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // Dialog
  ipcMain.handle("dialog:openDirectory", async (_, title?: string) => {
    const mainWindow = ctx.getMainWindow();
    if (!mainWindow) return { success: false, error: "No window" };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || t("Claw.Settings.workspace.selectDir"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, path: result.filePaths[0] };
  });
}
