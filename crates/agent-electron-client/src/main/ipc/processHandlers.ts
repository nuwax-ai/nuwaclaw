import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import type { HandlerContext } from '@shared/types/ipc';
import { readSetting } from '../db';
import { APP_DATA_DIR_NAME, DEFAULT_STARTUP_DELAY } from '../services/constants';

export function registerProcessHandlers(ctx: HandlerContext): void {

  // ==================== Helper: Start File Server ====================
  const startFileServerProcess = async (port: number): Promise<{ success: boolean; error?: string }> => {
    const { getAppEnv } = await import('../services/system/dependencies');

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
  const startLanproxyProcess = async (config: {
    serverIp: string; serverPort: number; clientKey: string; ssl?: boolean;
  }): Promise<{ success: boolean; error?: string }> => {
    const { getAppEnv, getLanproxyBinPath } = await import('../services/system/dependencies');

    if (ctx.lanproxy.running) {
      log.info('[Lanproxy] 已在运行，跳过启动');
      return Promise.resolve({ success: true });
    }
    const binPath = getLanproxyBinPath();
    if (!fs.existsSync(binPath)) {
      const msg = '当前平台暂不支持内网穿透（未找到 lanproxy 二进制，请使用带 lanproxy 的安装包或从 Tauri 构建获取）';
      log.warn('[Lanproxy] 启动失败: 二进制不存在', { binPath, reason: msg });
      return Promise.resolve({ success: false, error: msg });
    }
    const useSsl = config.ssl !== false;
    const args = ['-s', config.serverIp, '-p', String(config.serverPort), '-k', config.clientKey, `--ssl=${useSsl}`];
    const maskedKey = config.clientKey.length > 8
      ? `${config.clientKey.slice(0, 4)}****${config.clientKey.slice(-4)}`
      : '****';
    log.info('[Lanproxy] 正在启动', { server: config.serverIp, port: config.serverPort, keyMasked: maskedKey, ssl: useSsl });
    const result = await ctx.lanproxy.start({
      command: binPath,
      args,
      env: getAppEnv(),
      startupDelayMs: 1000,
    });
    if (result.success) {
      log.info('[Lanproxy] 已启动', { server: config.serverIp, port: config.serverPort });
    } else {
      log.error('[Lanproxy] 启动失败', { error: result.error, server: config.serverIp, port: config.serverPort });
    }
    return result;
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
  ipcMain.handle('lanproxy:isAvailable', async () => {
    const { getLanproxyBinPath } = await import('../services/system/dependencies');
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
    const { getAppEnv } = await import('../services/system/dependencies');

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

  // Computer Server handlers (Agent HTTP 接口服务，对齐 rcoder /computer/* API)
  ipcMain.handle('computerServer:status', async () => {
    const { getComputerServerStatus } = await import('../services/computerServer');
    return getComputerServerStatus();
  });

  ipcMain.handle('computerServer:start', async (_, port?: number) => {
    const { startComputerServer } = await import('../services/computerServer');
    const { getConfiguredPorts } = await import('../services/startupPorts');
    const resolvedPort = port ?? getConfiguredPorts().agent;
    return startComputerServer(resolvedPort);
  });

  ipcMain.handle('computerServer:stop', async () => {
    const { stopComputerServer } = await import('../services/computerServer');
    await stopComputerServer();
    return { success: true };
  });

  // ==================== services:restartAll ====================

  ipcMain.handle('services:restartAll', async () => {
    const [{ agentService }, { mcpProxyManager }] = await Promise.all([
      import('../services/engines/unifiedAgent'),
      import('../services/packages/mcp'),
    ]);
    type AgentConfigType = import('../services/engines/unifiedAgent').AgentConfig;

    log.info('[Services] Restarting all services...');
    const results: Record<string, { success: boolean; error?: string }> = {};

    // 预读共用配置
    const agentConfig = readSetting('agent_config') as any || {};
    const step1Config = readSetting('step1_config') as any || {};

    // 1. Stop existing services first
    try {
      await agentService.destroy();
    } catch (e) { log.warn('[Services] Agent destroy error (ignored):', e); }
    try {
      const { stopComputerServer } = await import('../services/computerServer');
      await stopComputerServer();
    } catch (e) { log.warn('[Services] ComputerServer stop error (ignored):', e); }
    ctx.fileServer.stop();
    ctx.lanproxy.stop();

    // 2. Verify MCP Proxy binary + 启动 PersistentMcpBridge（持久化 servers）
    try {
      await mcpProxyManager.start();
      results.mcpProxy = { success: true };
      log.info('[Services] MCP Proxy verified');

      // 非阻塞预热：app 启动时提前启动 PersistentMcpBridge（chrome-devtools-mcp 等持久化 MCP）。
      // 使用 fire-and-forget 模式——若失败只记录警告，不阻断其他服务启动。
      // 这样第一次发起会话时 bridge 已就绪，消除会话侧的 30 秒启动延迟。
      mcpProxyManager.ensureBridgeStarted().catch((e) =>
        log.warn('[Services] PersistentMcpBridge 预热失败（将在首次会话时重试）:', e),
      );
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
      log.error('[Services] MCP Proxy verify failed:', e);
    }

    // 3. Start Agent（MCP 配置通过 getAgentMcpConfig 注入，无需等 proxy 进程）
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

    // 4. Start Computer Server（Agent HTTP 接口服务）
    try {
      const { startComputerServer } = await import('../services/computerServer');
      const { getConfiguredPorts } = await import('../services/startupPorts');
      const { agent: agentPort } = getConfiguredPorts();
      results.computerServer = await startComputerServer(agentPort);
      log.info('[Services] ComputerServer started:', results.computerServer);
    } catch (e) {
      results.computerServer = { success: false, error: String(e) };
      log.error('[Services] ComputerServer start failed:', e);
    }

    // 5. Start File Server（端口来自聚合配置）
    try {
      const { getConfiguredPorts } = await import('../services/startupPorts');
      const { fileServer: fileServerPort } = getConfiguredPorts();
      results.fileServer = await startFileServerProcess(fileServerPort);
      log.info('[Services] FileServer started:', results.fileServer);
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
      log.error('[Services] FileServer start failed:', e);
    }

    // 6. Start Lanproxy
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

    log.info('[Services] All services restart complete:', results);
    return { success: true, results };
  });

  // ==================== services:stopAll ====================

  ipcMain.handle('services:stopAll', async () => {
    const [{ agentService }, { stopAllEngines }] = await Promise.all([
      import('../services/engines/unifiedAgent'),
      import('../services/engines/engineManager'),
    ]);

    log.info('[Services] Stopping all services...');
    const results: Record<string, { success: boolean; error?: string }> = {};

    // Stop Agent
    try {
      await agentService.destroy();
      results.agent = { success: true };
      log.info('[Services] Agent stopped');
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error('[Services] Agent stop failed:', e);
    }

    // Stop Computer Server
    try {
      const { stopComputerServer } = await import('../services/computerServer');
      await stopComputerServer();
      results.computerServer = { success: true };
      log.info('[Services] ComputerServer stopped');
    } catch (e) {
      results.computerServer = { success: false, error: String(e) };
    }

    // Stop File Server
    try {
      ctx.fileServer.stop();
      results.fileServer = { success: true };
      log.info('[Services] FileServer stopped');
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
    }

    // Stop Lanproxy
    try {
      ctx.lanproxy.stop();
      results.lanproxy = { success: true };
      log.info('[Lanproxy] 已停止');
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
      log.error('[Lanproxy] 停止异常', { error: String(e), stack: e instanceof Error ? e.stack : undefined });
    }

    // Stop MCP Proxy（清除 running 状态标记 + 停止 PersistentMcpBridge）
    try {
      const { mcpProxyManager } = await import('../services/packages/mcp');
      results.mcpProxy = await mcpProxyManager.stop();
      log.info('[Services] MCP Proxy stopped');
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
    }

    // Stop all engines
    try {
      stopAllEngines();
      results.engines = { success: true };
      log.info('[Services] Engines stopped');
    } catch (e) {
      results.engines = { success: false, error: String(e) };
    }

    log.info('[Services] All services stopped:', results);
    return { success: true, results };
  });
}
