/**
 * GUI Server IPC Handlers
 *
 * 注册 guiServer:start / guiServer:stop / guiServer:status IPC handlers，
 * 委托给 guiAgentServer.ts（非 Windows）和 windowsMcp.ts（Windows）实现。
 */

import { ipcMain } from "electron";
import log from "electron-log";
import {
  startGuiAgentServer,
  stopGuiAgentServer,
  getGuiAgentServerStatus,
} from "../services/packages/guiAgentServer";
import {
  startWindowsMcp,
  stopWindowsMcp,
  getWindowsMcpStatus,
} from "../services/packages/windowsMcp";
import { isWindows } from "../services/system/shellEnv";

function invalidArgs(channel: string, error: unknown) {
  log.warn(`[IPC] ${channel} invalid args:`, error);
}

export function registerGuiServerHandlers(): void {
  // ===== guiServer:start =====
  ipcMain.handle("guiServer:start", async () => {
    try {
      if (isWindows()) {
        return await startWindowsMcp();
      } else {
        return await startGuiAgentServer();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("[IPC] guiServer:start error:", msg);
      return { success: false, error: msg };
    }
  });

  // ===== guiServer:stop =====
  ipcMain.handle("guiServer:stop", async () => {
    try {
      if (isWindows()) {
        return await stopWindowsMcp();
      } else {
        return await stopGuiAgentServer();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("[IPC] guiServer:stop error:", msg);
      return { success: false, error: msg };
    }
  });

  // ===== guiServer:status =====
  ipcMain.handle("guiServer:status", async () => {
    try {
      if (isWindows()) {
        return getWindowsMcpStatus();
      } else {
        return getGuiAgentServerStatus();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("[IPC] guiServer:status error:", msg);
      return { running: false, error: msg };
    }
  });

  log.info("[IPC] guiServer handlers registered");
}
