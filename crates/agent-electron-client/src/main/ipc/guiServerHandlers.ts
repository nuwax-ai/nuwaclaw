/**
 * GUI Server IPC Handlers
 *
 * 注册 guiServer:start / guiServer:stop / guiServer:status / guiServer:isEnabled / guiServer:setEnabled IPC handlers，
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
import { readSetting, writeSetting } from "../db";

/** 从 step1_config 读取 guiMcpEnabled 运行时开关 */
function getGuiMcpEnabled(): boolean {
  try {
    const config = readSetting("step1_config") as {
      guiMcpEnabled?: boolean;
    } | null;
    // 兼容老配置：历史 step1_config 可能没有 guiMcpEnabled 字段。
    // 缺省按“启用”处理，避免升级后 GUI MCP 被意外关闭。
    return config?.guiMcpEnabled ?? false;
  } catch {
    return false;
  }
}

/** 写入 guiMcpEnabled 到 step1_config */
function setGuiMcpEnabled(enabled: boolean): void {
  const existing = readSetting("step1_config") as Record<
    string,
    unknown
  > | null;
  writeSetting("step1_config", { ...(existing || {}), guiMcpEnabled: enabled });
}

export function registerGuiServerHandlers(): void {
  // ===== guiServer:isEnabled =====
  ipcMain.handle("guiServer:isEnabled", async () => {
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
      return { enabled: false, reason: "not_available" };
    }
    return { enabled: getGuiMcpEnabled(), reason: "ok" };
  });

  // ===== guiServer:setEnabled =====
  ipcMain.handle("guiServer:setEnabled", async (_, enabled: boolean) => {
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
      return { success: false, error: "GUI Agent Server is not available" };
    }
    try {
      // 先停服务
      if (isWindows()) {
        await stopWindowsMcp();
      } else {
        await stopGuiAgentServer();
      }
      // 保存开关状态
      setGuiMcpEnabled(enabled);
      // 如果是启用，则重新启动
      if (enabled) {
        if (isWindows()) {
          return await startWindowsMcp();
        } else {
          return await startGuiAgentServer();
        }
      }
      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("[IPC] guiServer:setEnabled error:", msg);
      return { success: false, error: msg };
    }
  });

  // ===== guiServer:start =====
  ipcMain.handle("guiServer:start", async () => {
    if (!FEATURES.ENABLE_GUI_AGENT_SERVER) {
      return { success: false, error: "GUI Agent Server is not available" };
    }
    if (!getGuiMcpEnabled()) {
      return { success: false, error: "GUI MCP is disabled in settings" };
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
      return { success: false, error: "GUI Agent Server is not available" };
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
      return { running: false, error: "GUI Agent Server is not available" };
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
