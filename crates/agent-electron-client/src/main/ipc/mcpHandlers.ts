import { ipcMain } from 'electron';
import { getDb } from '../db';
import { mcpProxyManager, DEFAULT_MCP_PROXY_CONFIG } from '../services/packages/mcp';
import type { McpServersConfig } from '../services/packages/mcp';
import log from 'electron-log';

export function registerMcpHandlers(): void {
  // 启动 MCP Proxy（仅验证 binary 可用性）
  ipcMain.handle('mcp:start', async () => {
    return mcpProxyManager.start();
  });

  // 停止 MCP Proxy（no-op）
  ipcMain.handle('mcp:stop', async () => {
    return mcpProxyManager.stop();
  });

  // 重启 MCP Proxy（仅验证 binary 可用性）
  ipcMain.handle('mcp:restart', async () => {
    return mcpProxyManager.restart();
  });

  // 获取运行状态
  ipcMain.handle('mcp:status', async () => {
    return mcpProxyManager.getStatus();
  });

  // 获取配置
  ipcMain.handle('mcp:getConfig', async () => {
    const db = getDb();
    const saved = db?.prepare('SELECT value FROM settings WHERE key = ?').get('mcp_proxy_config') as { value: string } | undefined;
    if (saved) {
      try {
        return JSON.parse(saved.value);
      } catch (e) {
        log.warn('[McpProxy] 配置 JSON 解析失败，使用默认值:', e);
      }
    }
    return DEFAULT_MCP_PROXY_CONFIG;
  });

  // 保存配置
  ipcMain.handle('mcp:setConfig', async (_, config: McpServersConfig) => {
    try {
      const db = getDb();
      const configJson = JSON.stringify(config);
      db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mcp_proxy_config', configJson);
      mcpProxyManager.setConfig(config);
      log.info('[McpProxy] 配置已保存');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 获取端口（deprecated no-op）
  ipcMain.handle('mcp:getPort', async () => {
    return 0;
  });

  // 保存端口（deprecated no-op）
  ipcMain.handle('mcp:setPort', async () => {
    return { success: true };
  });
}
