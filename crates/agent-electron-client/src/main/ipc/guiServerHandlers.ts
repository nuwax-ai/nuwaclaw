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
import { FEATURES } from "@shared/featureFlags";

function invalidArgs(channel: string, error: unknown) {
  log.warn(`[IPC] ${channel} invalid args:`, error);
}

export function registerGuiServerHandlers(): void {
  // ===== guiServer:start =====
  ipcMain.handle("guiServer:start", async () => {
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
      return { success: false, error: "GUI Agent Server is disabled" };
    }
    try {
      // 手动点击启动：先 stop 再 start，尽量清掉残留 uv/python 进程并释放 GUI MCP 端口
      if (isWindows()) {
        try {
          await stopWindowsMcp();
        } catch (preStopErr) {
          log.warn("[IPC] guiServer:start pre-stop Windows MCP:", preStopErr);
        }
        return await startWindowsMcp();
      }
      try {
        await stopGuiAgentServer();
      } catch (preStopErr) {
        log.warn("[IPC] guiServer:start pre-stop GUI Agent:", preStopErr);
      }
      return await startGuiAgentServer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("[IPC] guiServer:start error:", msg);
      return { success: false, error: msg };
    }
  });

  // ===== guiServer:stop =====
  ipcMain.handle("guiServer:stop", async () => {
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
      return { success: false, error: "GUI Agent Server is disabled" };
    }
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
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
      return { running: false, error: "GUI Agent Server is disabled" };
    }
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
