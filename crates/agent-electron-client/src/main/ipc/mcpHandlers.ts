import { ipcMain } from 'electron';
import { getDb } from '../db';
import { mcpProxyManager, DEFAULT_MCP_PROXY_CONFIG } from '../services/packages/mcp';
import type { McpServersConfig } from '../services/packages/mcp';
import { DEFAULT_MCP_PROXY_PORT } from '../services/constants';
import log from 'electron-log';

export function registerMcpHandlers(): void {
  // 启动 MCP Proxy
  ipcMain.handle('mcp:start', async (_, options?: { port?: number; host?: string; configJson?: string }) => {
    return mcpProxyManager.start(options);
  });

  // 停止 MCP Proxy
  ipcMain.handle('mcp:stop', async () => {
    return mcpProxyManager.stop();
  });

  // 重启 MCP Proxy
  ipcMain.handle('mcp:restart', async (_, options?: { port?: number; host?: string; configJson?: string }) => {
    return mcpProxyManager.restart(options);
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

  // 获取端口
  ipcMain.handle('mcp:getPort', async () => {
    const db = getDb();
    const saved = db?.prepare('SELECT value FROM settings WHERE key = ?').get('mcp_proxy_port') as { value: string } | undefined;
    const port = saved ? parseInt(saved.value, 10) : NaN;
    return Number.isNaN(port) ? DEFAULT_MCP_PROXY_PORT : port;
  });

  // 保存端口
  ipcMain.handle('mcp:setPort', async (_, port: number) => {
    try {
      const db = getDb();
      db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mcp_proxy_port', String(port));
      mcpProxyManager.setPort(port);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
