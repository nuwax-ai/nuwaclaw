import { ipcMain, dialog } from "electron";
import { getDb } from "../db";
import {
  mcpProxyManager,
  DEFAULT_MCP_PROXY_CONFIG,
  discoverMcpTools,
} from "../services/packages/mcp";
import type { McpServersConfig } from "../services/packages/mcp";
import log from "electron-log";
import * as fs from "fs";
import * as path from "path";

export function registerMcpHandlers(): void {
  // 启动 MCP Proxy（仅验证 binary 可用性）
  ipcMain.handle("mcp:start", async () => {
    return mcpProxyManager.start();
  });

  // 停止 MCP Proxy（no-op）
  ipcMain.handle("mcp:stop", async () => {
    return mcpProxyManager.stop();
  });

  // 重启 MCP Proxy（仅验证 binary 可用性）
  ipcMain.handle("mcp:restart", async () => {
    return mcpProxyManager.restart();
  });

  // 获取运行状态
  ipcMain.handle("mcp:status", async () => {
    return mcpProxyManager.getStatus();
  });

  // 获取本地配置（仅用户配置的 MCP，不包括 ACP 动态下发的）
  ipcMain.handle("mcp:getConfig", async () => {
    const db = getDb();
    const saved = db
      ?.prepare("SELECT value FROM settings WHERE key = ?")
      .get("mcp_local_config") as { value: string } | undefined;
    if (saved) {
      try {
        return JSON.parse(saved.value);
      } catch (e) {
        log.warn("[McpProxy] Config JSON parse failed, using default:", e);
      }
    }
    // 返回空配置（不包括默认的 chrome-devtools，那是系统级的）
    return { mcpServers: {} };
  });

  // 保存本地配置
  ipcMain.handle("mcp:setConfig", async (_, config: McpServersConfig) => {
    try {
      const db = getDb();
      const configJson = JSON.stringify(config);
      db?.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      ).run("mcp_local_config", configJson);

      // 注意：不再调用 mcpProxyManager.setConfig()
      // 因为 mcpProxyManager 的配置应该由 syncMcpConfigToProxyAndReload() 统一管理

      log.info("[McpProxy] Local config saved");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 发现 MCP 工具
  ipcMain.handle("mcp:discoverTools", async (_, serverId: string) => {
    try {
      const tools = await discoverMcpTools(serverId);
      return { success: true, tools };
    } catch (error) {
      log.error("[McpProxy] Tool discovery failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // 导出配置到文件
  ipcMain.handle("mcp:exportConfig", async () => {
    try {
      const db = getDb();
      const saved = db
        ?.prepare("SELECT value FROM settings WHERE key = ?")
        .get("mcp_local_config") as { value: string } | undefined;

      const config = saved ? JSON.parse(saved.value) : { mcpServers: {} };

      // 打开保存对话框
      const result = await dialog.showSaveDialog({
        title: "导出 MCP 配置",
        defaultPath: `mcp-config-${Date.now()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: "User cancelled" };
      }

      // 写入文件
      fs.writeFileSync(
        result.filePath,
        JSON.stringify(config, null, 2),
        "utf-8",
      );

      // 设置文件权限为 0600（仅所有者可读写）
      try {
        fs.chmodSync(result.filePath, 0o600);
      } catch (chmodError) {
        log.warn("[McpProxy] Failed to set file permissions:", chmodError);
      }

      log.info("[McpProxy] Config exported to:", result.filePath);

      return { success: true, filePath: result.filePath };
    } catch (error) {
      log.error("[McpProxy] Export config failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // 获取端口（deprecated no-op）
  ipcMain.handle("mcp:getPort", async () => {
    return 0;
  });

  // 保存端口（deprecated no-op）
  ipcMain.handle("mcp:setPort", async () => {
    return { success: true };
  });
}
