import log from 'electron-log';
import { getDb, readSetting } from '../db';
import { startComputerServer } from '../services/computerServer';
import { mcpProxyManager, DEFAULT_MCP_PROXY_CONFIG } from '../services/packages/mcp';
import { getConfiguredPorts } from '../services/startupPorts';

export async function runStartupTasks(): Promise<void> {
  // 从 SQLite 恢复镜像配置
  const { setMirrorConfig } = await import('../services/system/dependencies');
  const mirrorConfig = readSetting('mirror_config');
  if (mirrorConfig) {
    try {
      setMirrorConfig(mirrorConfig);
    } catch (e) {
      log.warn('[Mirror] Failed to apply mirror config:', e);
    }
  }

  // 尽早启动 Computer HTTP Server（对齐 rcoder /computer/* API），端口来自聚合配置
  {
    const { agent: agentPort } = getConfiguredPorts();
    startComputerServer(agentPort).then((r) => {
      if (r.success) log.info(`[Init] Computer HTTP server listening on port ${agentPort}`);
      else log.warn(`[Init] Computer HTTP server failed: ${r.error}`);
    });
  }

  // 初始化 MCP Proxy 配置（从数据库加载）
  try {
    const db = getDb();
    const savedConfig = db?.prepare('SELECT value FROM settings WHERE key = ?').get('mcp_proxy_config') as { value: string } | undefined;
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig.value);
        // 合并默认服务器（如 chrome-devtools），确保内置 MCP 服务始终存在
        const merged = {
          ...parsed,
          mcpServers: { ...DEFAULT_MCP_PROXY_CONFIG.mcpServers, ...(parsed.mcpServers || {}) },
        };
        mcpProxyManager.setConfig(merged);
      } catch (e) {
        log.warn('[McpProxy] 初始化配置解析失败:', e);
      }
    }
    log.info('[McpProxy] 配置已加载');
  } catch (e) {
    log.warn('[McpProxy] 初始化配置失败:', e);
  }
}
