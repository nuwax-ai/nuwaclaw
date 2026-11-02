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
import {
  getGuiMcpEnabled,
  setGuiMcpEnabledFlag,
  syncGuiAgentLocalMcpConfig,
} from "../services/packages/guiMcpLocalConfig";

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
    const previousEnabled = getGuiMcpEnabled();
    try {
      // 先停服务
      if (isWindows()) {
        await stopWindowsMcp();
      } else {
        await stopGuiAgentServer();
      }
      // 保存开关状态，并同步本地 MCP 管理中的 gui-agent 条目
      setGuiMcpEnabledFlag(enabled);
      syncGuiAgentLocalMcpConfig(enabled);
      if (!enabled) {
        return { success: true };
      }

      const startResult = isWindows()
        ? await startWindowsMcp()
        : await startGuiAgentServer();
      if (!startResult.success) {
        // 启动失败时回滚开关与本地 MCP 条目，避免配置与运行态不一致
        setGuiMcpEnabledFlag(previousEnabled);
        syncGuiAgentLocalMcpConfig(previousEnabled);
      }
      return startResult;
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

  // 启动时修复历史配置：guiMcpEnabled 与 mcp_local_config 中 gui-agent 保持一致
  try {
    syncGuiAgentLocalMcpConfig(getGuiMcpEnabled());
  } catch (e) {
    log.warn("[IPC] guiServer initial local MCP sync failed:", e);
  }

  log.info("[IPC] guiServer handlers registered");
}
