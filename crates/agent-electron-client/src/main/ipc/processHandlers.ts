import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import type { HandlerContext } from '../../types/ipc';
import { readSetting } from '../db';
import { ManagedProcess } from '../processManager';
import { APP_DATA_DIR_NAME, DEFAULT_STARTUP_DELAY } from '../../services/main/constants';

export function registerProcessHandlers(ctx: HandlerContext): void {
  const { getAppEnv, getLanproxyBinPath } = require('../../services/main/system/dependencies');

  // ==================== Helper: Start File Server ====================
  const startFileServerProcess = (port: number): Promise<{ success: boolean; error?: string }> => {
    if (ctx.fileServer.running) {
      return Promise.resolve({ success: true, message: 'Already running' } as any);
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
    log.info('Starting file server:', 'node', serverJsPath, `PORT=${port}`, dirConfig);
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

  // ==================== Helper: Start Lanproxy ====================
  const startLanproxyProcess = (config: {
    serverIp: string; serverPort: number; clientKey: string; ssl?: boolean;
  }): Promise<{ success: boolean; error?: string }> => {
    if (ctx.lanproxy.running) {
      return Promise.resolve({ success: true });
    }
    const binPath = getLanproxyBinPath();
    if (!fs.existsSync(binPath)) {
      return Promise.resolve({ success: false, error: '当前平台暂不支持内网穿透（未找到 lanproxy 二进制，请使用带 lanproxy 的安装包或从 Tauri 构建获取）' });
    }
    const useSsl = config.ssl !== false;
    const args = ['-s', config.serverIp, '-p', String(config.serverPort), '-k', config.clientKey, `--ssl=${useSsl}`];
    const maskedKey = config.clientKey.length > 8
      ? `${config.clientKey.slice(0, 4)}****${config.clientKey.slice(-4)}`
      : '****';
    log.info(`Starting lanproxy: ${binPath} -s ${config.serverIp} -p ${config.serverPort} -k ${maskedKey} --ssl=${useSsl}`);
    return ctx.lanproxy.start({
      command: binPath,
      args,
      env: getAppEnv(),
      startupDelayMs: 1000,
    });
  };

  // Lanproxy handlers
  ipcMain.handle('lanproxy:start', async (_, config: {
    serverIp: string;
    serverPort: number;
    clientKey: string;
    ssl?: boolean;
  }) => {
    return startLanproxyProcess(config);
  });

  ipcMain.handle('lanproxy:stop', async () => {
    return ctx.lanproxy.stop();
  });

  ipcMain.handle('lanproxy:status', () => {
    return ctx.lanproxy.status();
  });

  /** 供设置页判断是否可显示「启动」并提示不可用原因 */
  ipcMain.handle('lanproxy:isAvailable', () => {
    const binPath = getLanproxyBinPath();
    return { available: fs.existsSync(binPath) };
  });

  // Agent Runner handlers
  ipcMain.handle('agentRunner:start', async (_, config: {
    binPath: string;
    backendPort: number;
    proxyPort: number;
    apiKey: string;
    apiBaseUrl: string;
    defaultModel: string;
  }) => {
    if (ctx.agentRunner.running) {
      return { success: true, message: 'Already running' };
    }

    const args = [
      '--backend-port', String(config.backendPort),
      '--proxy-port', String(config.proxyPort),
      '--api-key', config.apiKey,
      '--api-base-url', config.apiBaseUrl,
      '--default-model', config.defaultModel,
    ];

    // 仅记录端口与 URL，不记录 apiKey，避免敏感信息写入日志
    log.info('Starting agent runner:', config.binPath, '--backend-port', config.backendPort, '--proxy-port', config.proxyPort, '--api-base-url', config.apiBaseUrl);

    const result = await ctx.agentRunner.start({
      command: config.binPath,
      args,
      shell: true,
      env: getAppEnv(),
      startupDelayMs: 2000,
    });

    if (result.success) {
      ctx.setAgentRunnerPorts({ backendPort: config.backendPort, proxyPort: config.proxyPort });
    }
    return result;
  });

  ipcMain.handle('agentRunner:stop', async () => {
    const result = ctx.agentRunner.stop();
    ctx.setAgentRunnerPorts(null);
    return result;
  });

  ipcMain.handle('agentRunner:status', () => {
    const st = ctx.agentRunner.status();
    return {
      ...st,
      backendUrl: ctx.agentRunnerPorts ? `http://127.0.0.1:${ctx.agentRunnerPorts.backendPort}` : undefined,
      proxyUrl: ctx.agentRunnerPorts ? `http://127.0.0.1:${ctx.agentRunnerPorts.proxyPort}` : undefined,
    };
  });

  // File Server handlers
  ipcMain.handle('fileServer:start', async (_, port: number = 60000) => {
    return startFileServerProcess(port);
  });

  ipcMain.handle('fileServer:stop', async () => {
    return ctx.fileServer.stop();
  });

  ipcMain.handle('fileServer:status', () => {
    return ctx.fileServer.status();
  });

  // ==================== services:restartAll ====================

  ipcMain.handle('services:restartAll', async () => {
    const { agentService } = require('../../services/main/engines/unifiedAgent');
    const { mcpProxyManager } = require('../../services/main/packages/mcp');
    type AgentConfigType = import('../../services/main/engines/unifiedAgent').AgentConfig;

    log.info('[Services] Restarting all services...');
    const results: Record<string, { success: boolean; error?: string }> = {};

    // 预读共用配置
    const agentConfig = readSetting('agent_config') as any || {};
    const step1Config = readSetting('step1_config') as any || {};

    // 1. Stop existing services first
    try {
      await agentService.destroy();
    } catch (e) { log.warn('[Services] Agent destroy error (ignored):', e); }
    ctx.fileServer.stop();
    ctx.lanproxy.stop();
    mcpProxyManager.stop();

    // 2. Start Agent
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
      log.info('[Services] Agent started');
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error('[Services] Agent start failed:', e);
    }

    // 3. Start File Server
    try {
      results.fileServer = await startFileServerProcess(step1Config.fileServerPort ?? 60000);
      log.info('[Services] FileServer started:', results.fileServer);
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
      log.error('[Services] FileServer start failed:', e);
    }

    // 4. Start Lanproxy
    try {
      const clientKey = readSetting('auth.saved_key') as string | null;
      const lpConfig = readSetting('lanproxy_config') as any || {};
      const serverHost = readSetting('lanproxy.server_host') as string | null;
      const serverPortStored = readSetting('lanproxy.server_port') as number | null;
      const serverIp = lpConfig.serverIp || serverHost?.replace(/^https?:\/\//, '');
      const serverPort = lpConfig.serverPort || serverPortStored;

      if (serverIp && clientKey && serverPort) {
        results.lanproxy = await startLanproxyProcess({
          serverIp, serverPort, clientKey, ssl: lpConfig.ssl,
        });
        log.info('[Services] Lanproxy started');
      } else {
        results.lanproxy = { success: false, error: '缺少 lanproxy 配置' };
        log.warn('[Services] Lanproxy skipped (missing config)');
      }
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
      log.error('[Services] Lanproxy start failed:', e);
    }

    // 5. Start MCP Proxy
    try {
      await mcpProxyManager.start();
      results.mcpProxy = { success: true };
      log.info('[Services] MCP Proxy started');
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
      log.error('[Services] MCP Proxy start failed:', e);
    }

    log.info('[Services] All services restart complete:', results);
    return { success: true, results };
  });
}
