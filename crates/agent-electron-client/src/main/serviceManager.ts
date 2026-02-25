/**
 * 服务管理器 - 统一的服务启停逻辑
 *
 * 供 IPC handlers 和 Tray 菜单共同使用
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import type { ManagedProcess } from './processManager';
import { readSetting } from './db';
import { APP_DATA_DIR_NAME, DEFAULT_STARTUP_DELAY } from '../services/main/constants';

export interface ServiceManagerContext {
  lanproxy: ManagedProcess;
  fileServer: ManagedProcess;
  agentRunner: ManagedProcess;
}

export interface ServiceResult {
  success: boolean;
  error?: string;
  message?: string;
}

/**
 * 创建服务管理器
 */
export function createServiceManager(ctx: ServiceManagerContext) {
  const getAppEnv = () => {
    const { getAppEnv: getEnv } = require('../services/main/system/dependencies');
    return getEnv();
  };

  const getLanproxyBinPath = () => {
    const { getLanproxyBinPath: getPath } = require('../services/main/system/dependencies');
    return getPath();
  };

  /**
   * 启动文件服务器
   */
  const startFileServer = async (port: number): Promise<ServiceResult> => {
    if (ctx.fileServer.running) {
      return { success: true, message: 'Already running' };
    }

    const appDataDir = path.join(app.getPath('home'), APP_DATA_DIR_NAME);
    const serverJsPath = path.join(appDataDir, 'node_modules', 'nuwax-file-server', 'dist', 'server.js');
    const step1Parsed = readSetting('step1_config') as { workspaceDir?: string } | null;
    const baseWorkspace = step1Parsed?.workspaceDir || path.join(appDataDir, 'workspace');
    const logsDir = path.join(appDataDir, 'logs');

    const dirConfig: Record<string, string> = {
      INIT_PROJECT_NAME: 'nuwax-template',
      INIT_PROJECT_DIR: path.join(baseWorkspace, 'project_init'),
      UPLOAD_PROJECT_DIR: path.join(baseWorkspace, 'project_zips'),
      PROJECT_SOURCE_DIR: path.join(baseWorkspace, 'project_workspace'),
      DIST_TARGET_DIR: path.join(baseWorkspace, 'project_nginx'),
      COMPUTER_WORKSPACE_DIR: path.join(baseWorkspace, 'computer-project-workspace'),
      LOG_BASE_DIR: path.join(logsDir, 'project_logs'),
      COMPUTER_LOG_DIR: path.join(logsDir, 'computer_logs'),
    };

    for (const dir of Object.values(dirConfig)) {
      if (dir && dir.includes(path.sep)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      }
    }

    log.info('[ServiceManager] Starting file server on port', port);
    return ctx.fileServer.start({
      command: process.execPath,
      args: [serverJsPath],
      env: {
        ...getAppEnv(),
        ...dirConfig,
        PORT: String(port),
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1',
      },
      startupDelayMs: DEFAULT_STARTUP_DELAY,
    });
  };

  /**
   * 启动 Lanproxy
   */
  const startLanproxy = async (config: {
    serverIp: string;
    serverPort: number;
    clientKey: string;
    ssl?: boolean;
  }): Promise<ServiceResult> => {
    if (ctx.lanproxy.running) {
      return { success: true };
    }

    const binPath = getLanproxyBinPath();
    if (!fs.existsSync(binPath)) {
      return { success: false, error: '当前平台暂不支持内网穿透' };
    }

    const useSsl = config.ssl !== false;
    const args = ['-s', config.serverIp, '-p', String(config.serverPort), '-k', config.clientKey, `--ssl=${useSsl}`];

    return ctx.lanproxy.start({
      command: binPath,
      args,
      env: getAppEnv(),
      startupDelayMs: 1000,
    });
  };

  /**
   * 重启所有服务
   */
  const restartAllServices = async (): Promise<{ success: boolean; results: Record<string, ServiceResult> }> => {
    const { agentService } = require('../services/main/engines/unifiedAgent');
    const { mcpProxyManager } = require('../services/main/packages/mcp');
    type AgentConfigType = import('../services/main/engines/unifiedAgent').AgentConfig;

    log.info('[ServiceManager] Restarting all services...');
    const results: Record<string, ServiceResult> = {};

    // 读取配置
    const agentConfig = readSetting('agent_config') as any || {};
    const step1Config = readSetting('step1_config') as any || {};

    // 1. 停止现有服务
    try {
      await agentService.destroy();
    } catch (e) { log.warn('[ServiceManager] Agent destroy error (ignored):', e); }
    ctx.fileServer.stop();
    ctx.lanproxy.stop();
    mcpProxyManager.stop();

    // 2. 启动 Agent
    try {
      let finalConfig: AgentConfigType = {
        engine: agentConfig.type || 'claude-code',
        apiKey: agentConfig.apiKey,
        baseUrl: agentConfig.apiBaseUrl,
        model: agentConfig.model,
        workspaceDir: step1Config.workspaceDir || '',
        port: agentConfig.backendPort || undefined,
        engineBinaryPath: agentConfig.binPath || undefined,
      };
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();
      if (mcpConfig) finalConfig = { ...finalConfig, mcpServers: mcpConfig };
      const ok = await agentService.init(finalConfig);
      results.agent = { success: ok };
      log.info('[ServiceManager] Agent started');
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error('[ServiceManager] Agent start failed:', e);
    }

    // 3. 启动文件服务器
    try {
      results.fileServer = await startFileServer(step1Config.fileServerPort ?? 60000);
      log.info('[ServiceManager] FileServer started');
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
      log.error('[ServiceManager] FileServer start failed:', e);
    }

    // 4. 启动 Lanproxy
    try {
      const clientKey = readSetting('auth.saved_key') as string | null;
      const lpConfig = readSetting('lanproxy_config') as any || {};
      const serverHost = readSetting('lanproxy.server_host') as string | null;
      const serverPortStored = readSetting('lanproxy.server_port') as number | null;
      const serverIp = lpConfig.serverIp || serverHost?.replace(/^https?:\/\//, '');
      const serverPort = lpConfig.serverPort || serverPortStored;

      if (serverIp && clientKey && serverPort) {
        results.lanproxy = await startLanproxy({ serverIp, serverPort, clientKey, ssl: lpConfig.ssl });
        log.info('[ServiceManager] Lanproxy started');
      } else {
        results.lanproxy = { success: false, error: '缺少 lanproxy 配置' };
        log.warn('[ServiceManager] Lanproxy skipped (missing config)');
      }
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
      log.error('[ServiceManager] Lanproxy start failed:', e);
    }

    // 5. 启动 MCP Proxy
    try {
      await mcpProxyManager.start();
      results.mcpProxy = { success: true };
      log.info('[ServiceManager] MCP Proxy started');
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
      log.error('[ServiceManager] MCP Proxy start failed:', e);
    }

    log.info('[ServiceManager] All services restart complete');
    return { success: true, results };
  };

  /**
   * 停止所有服务
   */
  const stopAllServices = async (): Promise<{ success: boolean; results: Record<string, ServiceResult> }> => {
    const { agentService } = require('../services/main/engines/unifiedAgent');
    const { mcpProxyManager } = require('../services/main/packages/mcp');
    const { stopAllEngines } = require('../services/main/engines/engineManager');

    log.info('[ServiceManager] Stopping all services...');
    const results: Record<string, ServiceResult> = {};

    // 停止 Agent
    try {
      await agentService.destroy();
      results.agent = { success: true };
      log.info('[ServiceManager] Agent stopped');
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error('[ServiceManager] Agent stop failed:', e);
    }

    // 停止文件服务器
    try {
      ctx.fileServer.stop();
      results.fileServer = { success: true };
      log.info('[ServiceManager] FileServer stopped');
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
    }

    // 停止 Lanproxy
    try {
      ctx.lanproxy.stop();
      results.lanproxy = { success: true };
      log.info('[ServiceManager] Lanproxy stopped');
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
    }

    // 停止 MCP Proxy
    try {
      mcpProxyManager.stop();
      results.mcpProxy = { success: true };
      log.info('[ServiceManager] MCP Proxy stopped');
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
    }

    // 停止所有引擎
    try {
      stopAllEngines();
      results.engines = { success: true };
      log.info('[ServiceManager] Engines stopped');
    } catch (e) {
      results.engines = { success: false, error: String(e) };
    }

    log.info('[ServiceManager] All services stopped');
    return { success: true, results };
  };

  return {
    startFileServer,
    startLanproxy,
    restartAllServices,
    stopAllServices,
  };
}

export type ServiceManager = ReturnType<typeof createServiceManager>;
