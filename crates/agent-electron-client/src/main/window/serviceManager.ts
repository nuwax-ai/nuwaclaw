/**
 * 服务管理器 - 统一的服务启停逻辑
 *
 * 供 IPC handlers 和 Tray 菜单共同使用
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import type { ManagedProcess } from '../processManager';
import { readSetting } from '../db';
import { APP_DATA_DIR_NAME, DEFAULT_STARTUP_DELAY } from '../services/constants';
import { getConfiguredPorts } from '../services/startupPorts';
import { getAppEnv, getLanproxyBinPath } from '../services/system/dependencies';
import { agentService } from '../services/engines/unifiedAgent';
import type { AgentConfig } from '../services/engines/unifiedAgent';
import { mcpProxyManager } from '../services/packages/mcp';
import { stopAllEngines } from '../services/engines/engineManager';
import { clearAllSseEventBuffers } from '../services/computerServer';

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
    log.info('[ServiceManager] Restarting all services...');
    const results: Record<string, ServiceResult> = {};

    // 读取配置
    const agentConfig = readSetting('agent_config') as Record<string, unknown> || {};
    const step1Config = readSetting('step1_config') as Record<string, unknown> || {};

    // 1. 停止现有服务（先清 SSE 缓冲，再 destroy Agent，避免重启后回放旧事件）
    clearAllSseEventBuffers();
    try {
      await agentService.destroy();
    } catch (e) { log.warn('[ServiceManager] Agent destroy error (ignored):', e); }
    ctx.fileServer.stop();
    ctx.lanproxy.stop();
    mcpProxyManager.stop();

    // 2. 启动 MCP Proxy（必须先于 Agent：Agent 初始化时会连 MCP Proxy 注入 mcpServers）
    try {
      await mcpProxyManager.start();
      results.mcpProxy = { success: true };
      log.info('[ServiceManager] MCP Proxy started');
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
      log.error('[ServiceManager] MCP Proxy start failed:', e);
    }

    // 3. 启动 Agent（依赖 MCP Proxy 已就绪以便 getAgentMcpConfig 对应进程可连）
    try {
      const finalConfig: AgentConfig = {
        engine: (agentConfig.type as AgentConfig['engine']) || 'claude-code',
        apiKey: agentConfig.apiKey as string | undefined,
        baseUrl: agentConfig.apiBaseUrl as string | undefined,
        model: agentConfig.model as string | undefined,
        workspaceDir: (step1Config.workspaceDir as string) || '',
        port: agentConfig.backendPort as number | undefined,
        engineBinaryPath: agentConfig.binPath as string | undefined,
      };
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();
      if (mcpConfig) Object.assign(finalConfig, { mcpServers: mcpConfig });
      const ok = await agentService.init(finalConfig);
      results.agent = { success: ok };
      log.info('[ServiceManager] Agent started');
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error('[ServiceManager] Agent start failed:', e);
    }

    // 4. 启动文件服务器（端口来自聚合配置）
    try {
      const { fileServer: fileServerPort } = getConfiguredPorts();
      results.fileServer = await startFileServer(fileServerPort);
      log.info('[ServiceManager] FileServer started');
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
      log.error('[ServiceManager] FileServer start failed:', e);
    }

    // 5. 启动 Lanproxy
    try {
      const clientKey = readSetting('auth.saved_key') as string | null;
      const lpConfig = readSetting('lanproxy_config') as Record<string, unknown> || {};
      const serverHost = readSetting('lanproxy.server_host') as string | null;
      const serverPortStored = readSetting('lanproxy.server_port') as number | null;
      const serverIp = (lpConfig.serverIp as string) || serverHost?.replace(/^https?:\/\//, '');
      const serverPort = (lpConfig.serverPort as number) || serverPortStored;

      if (serverIp && clientKey && serverPort) {
        results.lanproxy = await startLanproxy({ serverIp, serverPort, clientKey, ssl: lpConfig.ssl as boolean });
        if (!results.lanproxy.success) {
          log.error('[Lanproxy] 批量启动失败', { error: results.lanproxy.error });
        }
      } else {
        results.lanproxy = { success: false, error: '缺少 lanproxy 配置' };
        log.warn('[Lanproxy] 已跳过: 缺少配置', {
          hasServerIp: !!serverIp,
          hasClientKey: !!clientKey,
          hasServerPort: !!serverPort,
          hint: '请配置 server_host / server_port 与 saved_key（或 lanproxy_config）',
        });
      }
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
      log.error('[Lanproxy] 启动异常', { error: String(e), stack: e instanceof Error ? e.stack : undefined });
    }

    log.info('[ServiceManager] All services restart complete');
    return { success: true, results };
  };

  /**
   * 停止所有服务
   */
  const stopAllServices = async (): Promise<{ success: boolean; results: Record<string, ServiceResult> }> => {
    log.info('[ServiceManager] Stopping all services...');
    const results: Record<string, ServiceResult> = {};

    // 停止 Agent 前清除所有 SSE 事件缓冲，避免重启/重连后仍回放旧会话事件
    clearAllSseEventBuffers();

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
      log.info('[Lanproxy] 已停止');
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
      log.error('[Lanproxy] 停止异常', { error: String(e), stack: e instanceof Error ? e.stack : undefined });
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
