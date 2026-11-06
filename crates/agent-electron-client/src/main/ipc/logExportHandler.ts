import { app, dialog, ipcMain } from "electron";
import type { HandlerContext } from "@shared/types/ipc";
import type { LogExportResult } from "@shared/types/electron";
import {
  APP_NAME_IDENTIFIER,
  I18N_KEYS,
  LOGS_DIR_NAME,
} from "@shared/constants";
import path from "node:path";
import log from "electron-log";
import { getAppDataDir } from "../services/system/appPaths";
import { t } from "../services/i18n";
import { exportLogArchive } from "../services/utils/logArchive";
import type { IpcMainInvokeEvent, WebContents } from "electron";

// 只允许壳的本地主框架，网页和子框架不能通过持有桥对象导出应用日志。
function isLogExportSender(
  event: IpcMainInvokeEvent,
  host: WebContents | undefined,
): boolean {
  if (!host || event.sender !== host || event.senderFrame !== host.mainFrame)
    return false;
  try {
    const url = new URL(host.getURL());
    return (
      url.protocol === "file:" ||
      url.protocol === "app:" ||
      (!app.isPackaged &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        ["http:", "https:"].includes(url.protocol))
    );
  } catch {
    return false;
  }
}

export function registerLogExportHandler(ctx: HandlerContext): void {
  let exporting = false;
  ipcMain.handle("log:exportZip", async (event): Promise<LogExportResult> => {
    const host = ctx.getMainWindow();
    if (!isLogExportSender(event, ctx.getMainWindow()?.webContents)) {
      return { success: false, error: "Host renderer required" };
    }
    if (exporting)
      return { success: false, error: "Log export already in progress" };
    exporting = true;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const saved = await dialog.showSaveDialog(host!, {
        title: t(I18N_KEYS.Pages.LogViewer.EXPORT),
        defaultPath: path.join(
          app.getPath("downloads"),
          `${APP_NAME_IDENTIFIER}-logs-${timestamp}.zip`,
        ),
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (saved.canceled || !saved.filePath)
        return { success: false, canceled: true };
      if (!isLogExportSender(event, ctx.getMainWindow()?.webContents)) {
        return { success: false, error: "Host renderer required" };
      }
      const destination = saved.filePath.toLowerCase().endsWith(".zip")
        ? saved.filePath
        : `${saved.filePath}.zip`;
      await exportLogArchive(
        path.join(getAppDataDir(), LOGS_DIR_NAME),
        destination,
      );
      return { success: true, filePath: destination };
    } catch (error) {
      log.error("[IPC] log:exportZip failed:", error);
      return { success: false, error: String(error) };
    } finally {
      exporting = false;
    }
  });
}
