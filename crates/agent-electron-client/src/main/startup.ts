import log from 'electron-log';
import { getDb, readSetting } from './db';
import { startComputerServer } from '../services/computerServer';
import { mcpProxyManager } from '../services/mcp';

export async function runStartupTasks(): Promise<void> {
  // 从 SQLite 恢复镜像配置
  const { setMirrorConfig } = require('../services/dependencies');
  const mirrorConfig = readSetting('mirror_config');
  if (mirrorConfig) {
    try {
      setMirrorConfig(mirrorConfig);
    } catch (e) {
      log.warn('[Mirror] Failed to apply mirror config:', e);
    }
  }

  // 尽早启动 Computer HTTP Server（对齐 rcoder /computer/* API）
  {
    const s1 = readSetting('step1_config') as { agentPort?: number } | null;
    const agentPort = s1?.agentPort ?? 60001;
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
        mcpProxyManager.setConfig(JSON.parse(savedConfig.value));
      } catch (e) {
        log.warn('[McpProxy] 初始化配置解析失败:', e);
      }
    }
    const savedPort = db?.prepare('SELECT value FROM settings WHERE key = ?').get('mcp_proxy_port') as { value: string } | undefined;
    if (savedPort) {
      const port = parseInt(savedPort.value, 10);
      if (!Number.isNaN(port)) {
        mcpProxyManager.setPort(port);
      }
    }
    log.info('[McpProxy] 配置已加载');
  } catch (e) {
    log.warn('[McpProxy] 初始化配置失败:', e);
  }
}
