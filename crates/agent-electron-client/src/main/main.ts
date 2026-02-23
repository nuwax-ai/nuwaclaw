import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';
import Database from 'better-sqlite3';
import { agentService } from '../services/unifiedAgent';
import type { AgentConfig, ComputerChatRequest, UnifiedSessionMessage } from '../services/unifiedAgent';
import { startComputerServer, stopComputerServer, pushSseEvent } from '../services/computerServer';
import { mcpProxyManager, DEFAULT_MCP_PROXY_CONFIG, DEFAULT_MCP_PROXY_PORT } from '../services/mcp';
import type { McpServersConfig } from '../services/mcp';

// Configure logging — 日志统一写入 ~/.nuwax-agent/logs/
const nuwaxHome = path.join(app.getPath('home'), '.nuwax-agent');
const logDir = path.join(nuwaxHome, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
log.transports.file.resolvePathFn = (variables) =>
  path.join(logDir, variables.fileName || 'main.log');
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('Application starting...');

// Global references
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;
let lanproxyProcess: ChildProcess | null = null;
let agentRunnerProcess: ChildProcess | null = null;
let agentRunnerPorts: { backendPort: number; proxyPort: number } | null = null;
let fileServerProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Database path — 统一使用 ~/.nuwax-agent/
const dbPath = path.join(nuwaxHome, 'nuwax-agent.db');

function initDatabase() {
  try {
    db = new Database(dbPath);
    log.info('Database initialized at:', dbPath);

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        title TEXT,
        model TEXT,
        system_prompt TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    log.info('Database tables created');
  } catch (error) {
    log.error('Database initialization failed:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Nuwax Agent',
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Need to access node for MCP
    },
    show: false,
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:60173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    log.info('Main window shown');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createMenu();
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-session'),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
        {
          label: 'MCP Servers',
          accelerator: 'CmdOrCtrl+M',
          click: () => mainWindow?.webContents.send('menu:mcp-settings'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Nuwax Agent',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Nuwax Agent',
              message: 'Nuwax Agent v0.1.0',
              detail: 'Your AI assistant for productivity.',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  const trayIconPath = path.join(__dirname, '../../public/32x32.png');
  const icon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => mainWindow?.show(),
    },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip('Nuwax Agent');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow?.show();
  });
}

// IPC Handlers
function setupIpcHandlers() {
  // 应用内依赖环境变量 — 所有 spawn 调用共用
  const { getAppEnv, getLanproxyBinPath, setMirrorConfig, getMirrorConfig, MIRROR_PRESETS } = require('../services/dependencies');

  // Helper: 从 SQLite 读取设置项（JSON 自动解析）
  const readSetting = (key: string): unknown => {
    const row = db?.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row?.value) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  };

  // 从 SQLite 恢复镜像配置
  const mirrorConfig = readSetting('mirror_config');
  if (mirrorConfig) {
    try {
      setMirrorConfig(mirrorConfig);
    } catch (e) {
      log.warn('[Mirror] Failed to apply mirror config:', e);
    }
  }

  // Session management
  ipcMain.handle('session:list', () => {
    if (!db) return [];
    const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
    return stmt.all();
  });

  ipcMain.handle('session:create', (_, session: { id: string; title: string; model: string; system_prompt?: string }) => {
    if (!db) return null;
    const now = Date.now();
    const stmt = db.prepare(
      'INSERT INTO sessions (id, created_at, updated_at, title, model, system_prompt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(session.id, now, now, session.title, session.model, session.system_prompt || null);
    return { ...session, created_at: now, updated_at: now };
  });

  ipcMain.handle('session:delete', (_, sessionId: string) => {
    if (!db) return false;
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return true;
  });

  // Message management
  ipcMain.handle('message:list', (_, sessionId: string) => {
    if (!db) return [];
    const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId);
  });

  ipcMain.handle('message:add', (_, message: { id: string; session_id: string; role: string; content: string }) => {
    if (!db) return null;
    const now = Date.now();
    const stmt = db.prepare(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(message.id, message.session_id, message.role, message.content, now);

    // Update session timestamp
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, message.session_id);

    return { ...message, created_at: now };
  });

  // Settings
  ipcMain.handle('settings:get', (_, key: string) => {
    if (!db) return null;
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  });

  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    if (!db) return false;
    if (value === null || value === undefined) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } else {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      );
      stmt.run(key, JSON.stringify(value));
    }
    return true;
  });

  // Mirror / Registry — 动态切换 npm、uv 镜像源
  ipcMain.handle('mirror:get', () => {
    return { success: true, ...getMirrorConfig(), presets: MIRROR_PRESETS };
  });

  ipcMain.handle('mirror:set', (_, config: { npmRegistry?: string; uvIndexUrl?: string }) => {
    try {
      setMirrorConfig(config);
      // 持久化到 SQLite
      if (db) {
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run('mirror_config', JSON.stringify(getMirrorConfig()));
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Window controls
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  // MCP Proxy handlers — 统一代理模式 (mcp-stdio-proxy)

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
    const saved = db?.prepare('SELECT value FROM settings WHERE key = ?').get('mcp_proxy_port') as { value: string } | undefined;
    const port = saved ? parseInt(saved.value, 10) : NaN;
    return Number.isNaN(port) ? DEFAULT_MCP_PROXY_PORT : port;
  });

  // 保存端口
  ipcMain.handle('mcp:setPort', async (_, port: number) => {
    try {
      db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mcp_proxy_port', String(port));
      mcpProxyManager.setPort(port);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Lanproxy handlers - Start
  ipcMain.handle('lanproxy:start', async (_, config: {
    serverIp: string;
    serverPort: number;
    clientKey: string;
    ssl?: boolean;
  }) => {
    const result = startLanproxyProcess(config);
    if (!result.success) return result;
    // Wait for process to stabilize
    return new Promise((resolve) => {
      setTimeout(() => {
        if (lanproxyProcess) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: '进程启动后立即退出' });
        }
      }, 1000);
    });
  });

  // Lanproxy handlers - Stop
  ipcMain.handle('lanproxy:stop', async () => {
    if (lanproxyProcess) {
      lanproxyProcess.kill();
      lanproxyProcess = null;
      return { success: true };
    }
    return { success: true, message: 'Not running' };
  });

  // Lanproxy handlers - Status
  ipcMain.handle('lanproxy:status', () => {
    return {
      running: lanproxyProcess !== null,
      pid: lanproxyProcess?.pid,
    };
  });

  // Agent Runner handlers - Start
  ipcMain.handle('agentRunner:start', async (_, config: {
    binPath: string;
    backendPort: number;
    proxyPort: number;
    apiKey: string;
    apiBaseUrl: string;
    defaultModel: string;
  }) => {
    if (agentRunnerProcess) {
      return { success: true, message: 'Already running' };
    }

    return new Promise((resolve) => {
      try {
        const args = [
          '--backend-port', String(config.backendPort),
          '--proxy-port', String(config.proxyPort),
          '--api-key', config.apiKey,
          '--api-base-url', config.apiBaseUrl,
          '--default-model', config.defaultModel,
        ];

        log.info('Starting agent runner:', config.binPath, args.join(' '));

        agentRunnerProcess = spawn(config.binPath, args, {
          shell: true,
          windowsHide: true,
          env: { ...process.env, ...getAppEnv() },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        agentRunnerProcess.on('error', (error) => {
          log.error('Agent Runner error:', error);
          agentRunnerProcess = null;
          agentRunnerPorts = null;
          resolve({ success: false, error: error.message });
        });

        agentRunnerProcess.on('exit', (code) => {
          log.info(`Agent Runner exited with code ${code}`);
          agentRunnerProcess = null;
          agentRunnerPorts = null;
        });

        // Check after a delay
        setTimeout(() => {
          if (agentRunnerProcess) {
            agentRunnerPorts = { backendPort: config.backendPort, proxyPort: config.proxyPort };
            resolve({ success: true });
          } else {
            resolve({ success: false, error: '进程启动后立即退出' });
          }
        }, 2000);
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
    });
  });

  // Agent Runner handlers - Stop
  ipcMain.handle('agentRunner:stop', async () => {
    if (agentRunnerProcess) {
      agentRunnerProcess.kill();
      agentRunnerProcess = null;
      agentRunnerPorts = null;
      return { success: true };
    }
    return { success: true, message: 'Not running' };
  });

  // Agent Runner handlers - Status
  ipcMain.handle('agentRunner:status', () => {
    return {
      running: agentRunnerProcess !== null,
      pid: agentRunnerProcess?.pid,
      backendUrl: agentRunnerPorts ? `http://127.0.0.1:${agentRunnerPorts.backendPort}` : undefined,
      proxyUrl: agentRunnerPorts ? `http://127.0.0.1:${agentRunnerPorts.proxyPort}` : undefined,
    };
  });

  // Agent (nuwaxcode/claude-code) handlers — Legacy removed, using Unified Agent SDK below

  // ==================== Helper: Start File Server ====================
  const startFileServerProcess = (port: number): Promise<{ success: boolean; error?: string }> => {
    if (fileServerProcess) {
      return Promise.resolve({ success: true, message: 'Already running' });
    }
    return new Promise((resolve) => {
      try {
        const appDataDir = path.join(app.getPath('home'), '.nuwax-agent');
        const serverJsPath = path.join(appDataDir, 'node_modules', 'nuwax-file-server', 'dist', 'server.js');
        const step1Parsed = readSetting('step1_config') as { workspaceDir?: string } | null;
        const baseWorkspace = step1Parsed?.workspaceDir || path.join(appDataDir, 'workspace');
        const logsDir = path.join(appDataDir, 'logs');
        const dirConfig = {
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
        fileServerProcess = spawn(process.execPath, [serverJsPath], {
          windowsHide: true,
          env: {
            ...process.env,
            ...getAppEnv(),
            ...dirConfig,
            PORT: String(port),
            NODE_ENV: 'production',
            ELECTRON_RUN_AS_NODE: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        fileServerProcess.stdout?.on('data', (data: Buffer) => {
          log.info('[FileServer]', data.toString().trim());
        });
        fileServerProcess.stderr?.on('data', (data: Buffer) => {
          log.warn('[FileServer stderr]', data.toString().trim());
        });
        fileServerProcess.on('error', (error) => {
          log.error('File server error:', error);
          fileServerProcess = null;
          resolve({ success: false, error: error.message });
        });
        fileServerProcess.on('exit', (code) => {
          log.info(`File server exited with code ${code}`);
          fileServerProcess = null;
        });
        setTimeout(() => {
          if (fileServerProcess) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: 'Failed to start' });
          }
        }, 3000);
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
    });
  };

  // ==================== Helper: Start Lanproxy ====================
  const startLanproxyProcess = (config: {
    serverIp: string; serverPort: number; clientKey: string; ssl?: boolean;
  }): { success: boolean; error?: string } => {
    if (lanproxyProcess) {
      return { success: true };
    }
    const binPath = getLanproxyBinPath();
    if (!fs.existsSync(binPath)) {
      return { success: false, error: `二进制文件未找到: ${binPath}` };
    }
    const useSsl = config.ssl !== false;
    const args = ['-s', config.serverIp, '-p', String(config.serverPort), '-k', config.clientKey, `--ssl=${useSsl}`];
    const maskedKey = config.clientKey.length > 8
      ? `${config.clientKey.slice(0, 4)}****${config.clientKey.slice(-4)}`
      : '****';
    log.info(`Starting lanproxy: ${binPath} -s ${config.serverIp} -p ${config.serverPort} -k ${maskedKey} --ssl=${useSsl}`);
    try {
      lanproxyProcess = spawn(binPath, args, {
        windowsHide: true,
        env: { ...process.env, ...getAppEnv() },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      lanproxyProcess.on('error', (error) => {
        log.error('Lanproxy error:', error);
        lanproxyProcess = null;
      });
      lanproxyProcess.on('exit', (code) => {
        log.info('Lanproxy exited with code', code);
        lanproxyProcess = null;
      });
      return { success: true };
    } catch (error) {
      log.error('Lanproxy spawn failed:', error);
      lanproxyProcess = null;
      return { success: false, error: `启动失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  // File Server handlers - Start
  ipcMain.handle('fileServer:start', async (_, port: number = 60000) => {
    return startFileServerProcess(port);
  });

  // File Server handlers - Stop
  ipcMain.handle('fileServer:stop', async () => {
    if (fileServerProcess) {
      fileServerProcess.kill();
      fileServerProcess = null;
      return { success: true };
    }
    return { success: true, message: 'Not running' };
  });

  // File Server handlers - Status
  ipcMain.handle('fileServer:status', () => {
    return {
      running: fileServerProcess !== null,
      pid: fileServerProcess?.pid,
    };
  });

  // ==================== Unified Agent SDK handlers ====================

  // Initialize unified agent service
  ipcMain.handle('agent:init', async (_, config: AgentConfig) => {
    log.info('[IPC] Initializing unified agent:', config.engine);
    try {
      // Auto-inject MCP config if MCP proxy is running and no mcpServers provided
      let finalConfig = config;
      if (!config.mcpServers) {
        const mcpConfig = mcpProxyManager.getAgentMcpConfig();
        if (mcpConfig) {
          finalConfig = { ...config, mcpServers: mcpConfig };
          log.info('[IPC] Auto-injected MCP config into agent:', Object.keys(mcpConfig));
        }
      }
      const ok = await agentService.init(finalConfig);

      // 启动 Computer HTTP Server（对齐 rcoder，让 Java 后端通过 lanproxy 访问 /computer/* API）
      const step1Config = readSetting('step1_config') as { agentPort?: number } | null;
      const agentPort = step1Config?.agentPort ?? 60001;
      const serverResult = await startComputerServer(agentPort);
      if (serverResult.success) {
        log.info(`[IPC] Computer HTTP server started on port ${agentPort}`);
      } else {
        log.warn(`[IPC] Computer HTTP server failed: ${serverResult.error}`);
      }

      return {
        success: ok,
        engineType: agentService.getEngineType(),
      };
    } catch (error) {
      log.error('[IPC] agent:init failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get agent service status (replaces legacy agent:status)
  ipcMain.handle('agent:serviceStatus', () => {
    return {
      running: agentService.isReady,
      engineType: agentService.getEngineType(),
    };
  });

  // Destroy unified agent service
  ipcMain.handle('agent:destroy', async () => {
    try {
      await agentService.destroy();
      await stopComputerServer();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get engine type
  ipcMain.handle('agent:getEngineType', () => {
    return agentService.getEngineType();
  });

  // Check if ready
  ipcMain.handle('agent:isReady', () => {
    return agentService.isReady;
  });

  // List SDK sessions
  ipcMain.handle('agent:listSessions', async () => {
    try {
      const sessions = await agentService.listSessions();
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Create SDK session
  ipcMain.handle('agent:createSession', async (_, opts?: { parentID?: string; title?: string }) => {
    try {
      const session = await agentService.createSession(opts);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get SDK session
  ipcMain.handle('agent:getSession', async (_, id: string) => {
    try {
      const session = await agentService.getSession(id);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete SDK session
  ipcMain.handle('agent:deleteSession', async (_, id: string) => {
    try {
      await agentService.deleteSession(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update SDK session
  ipcMain.handle('agent:updateSession', async (_, id: string, title?: string) => {
    try {
      const session = await agentService.updateSession(id, title);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get session status
  ipcMain.handle('agent:getSessionStatus', async () => {
    try {
      const status = await agentService.getSessionStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get messages
  ipcMain.handle('agent:getMessages', async (_, sessionId: string, limit?: number) => {
    try {
      const messages = await agentService.getMessages(sessionId, limit);
      return { success: true, data: messages };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get single message
  ipcMain.handle('agent:getMessage', async (_, sessionId: string, messageId: string) => {
    try {
      const message = await agentService.getMessage(sessionId, messageId);
      return { success: true, data: message };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Prompt (blocking)
  ipcMain.handle('agent:prompt', async (_, sessionId: string, parts: any[], opts?: any) => {
    try {
      const result = await agentService.prompt(sessionId, parts, opts);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Prompt (async, non-blocking - results via SSE events)
  ipcMain.handle('agent:promptAsync', async (_, sessionId: string, parts: any[], opts?: any) => {
    try {
      await agentService.promptAsync(sessionId, parts, opts);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Command
  ipcMain.handle('agent:command', async (_, sessionId: string, cmd: string, args?: string, opts?: any) => {
    try {
      const result = await agentService.command(sessionId, cmd, args, opts);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Shell
  ipcMain.handle('agent:shell', async (_, sessionId: string, cmd: string, agent?: string, model?: any) => {
    try {
      const result = await agentService.shell(sessionId, cmd, agent, model);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Abort session
  ipcMain.handle('agent:abort', async (_, sessionId: string) => {
    try {
      await agentService.abortSession(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Respond to permission request
  ipcMain.handle('agent:respondPermission', async (_, sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject') => {
    try {
      await agentService.respondPermission(sessionId, permissionId, response);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List tools
  ipcMain.handle('agent:listTools', async (_, provider?: string, model?: string) => {
    try {
      const tools = await agentService.listTools(provider, model);
      return { success: true, data: tools };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List providers
  ipcMain.handle('agent:listProviders', async () => {
    try {
      const providers = await agentService.listProviders();
      return { success: true, data: providers };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get session diff
  ipcMain.handle('agent:getSessionDiff', async (_, sessionId: string, messageId?: string) => {
    try {
      const diffs = await agentService.diffSession(sessionId, messageId);
      return { success: true, data: diffs };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Revert session
  ipcMain.handle('agent:revert', async (_, sessionId: string, messageId: string, partId?: string) => {
    try {
      const session = await agentService.revertSession(sessionId, messageId, partId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Unrevert session
  ipcMain.handle('agent:unrevert', async (_, sessionId: string) => {
    try {
      const session = await agentService.unrevertSession(sessionId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Share session
  ipcMain.handle('agent:shareSession', async (_, sessionId: string) => {
    try {
      const session = await agentService.shareSession(sessionId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Fork session
  ipcMain.handle('agent:forkSession', async (_, sessionId: string, messageId?: string) => {
    try {
      const session = await agentService.forkSession(sessionId, messageId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get config
  ipcMain.handle('agent:getConfig', async () => {
    try {
      const config = await agentService.getConfig();
      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Find text
  ipcMain.handle('agent:findText', async (_, pattern: string) => {
    try {
      const results = await agentService.findText(pattern);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Find files
  ipcMain.handle('agent:findFiles', async (_, query: string, dirs?: boolean) => {
    try {
      const results = await agentService.findFiles(query, dirs);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List files
  ipcMain.handle('agent:listFiles', async (_, dirPath: string) => {
    try {
      const results = await agentService.listFiles(dirPath);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Read file
  ipcMain.handle('agent:readFile', async (_, filePath: string) => {
    try {
      const result = await agentService.readFile(filePath);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Claude Code prompt (CLI engine)
  ipcMain.handle('agent:claudePrompt', async (_, message: string) => {
    try {
      const result = await agentService.claudePrompt(message);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // MCP status via SDK
  ipcMain.handle('agent:mcpStatus', async () => {
    try {
      const result = await agentService.mcpStatus();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List agents
  ipcMain.handle('agent:listAgents', async () => {
    try {
      const result = await agentService.listAgents();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List commands
  ipcMain.handle('agent:listCommands', async () => {
    try {
      const result = await agentService.listCommands();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ==================== SSE Event Forwarding ====================

  // Forward all agent SSE events to the renderer
  const sseEventTypes = [
    'message.updated',
    'message.removed',
    'message.part.updated',
    'message.part.removed',
    'permission.updated',
    'permission.replied',
    'session.created',
    'session.updated',
    'session.deleted',
    'session.status',
    'session.idle',
    'session.error',
    'session.diff',
    'file.edited',
    'server.connected',
  ];

  for (const eventType of sseEventTypes) {
    agentService.on(eventType, (data: unknown) => {
      mainWindow?.webContents.send('agent:event', {
        type: eventType,
        data,
      });
    });
  }

  agentService.on('error', (error: Error) => {
    mainWindow?.webContents.send('agent:event', {
      type: 'error',
      data: { message: error.message },
    });
  });

  agentService.on('ready', () => {
    mainWindow?.webContents.send('agent:event', {
      type: 'ready',
      data: {},
    });
  });

  agentService.on('destroyed', () => {
    mainWindow?.webContents.send('agent:event', {
      type: 'destroyed',
      data: {},
    });
  });

  // ==================== computer:* IPC handlers (对齐 rcoder /computer/* API) ====================

  ipcMain.handle('computer:chat', async (_, request: ComputerChatRequest) => {
    const acpEngine = agentService.getAcpEngine();
    if (!acpEngine) return { success: false, project_id: '', session_id: '', error: 'Agent not initialized' };
    return acpEngine.chat(request);
  });

  ipcMain.handle('computer:agentStatus', async (_, request: { user_id: string; project_id?: string }) => {
    const acpEngine = agentService.getAcpEngine();
    if (!acpEngine) return { success: false, status: 'offline' };
    const session = acpEngine.findSessionByProjectId(request.project_id || '');
    return {
      success: true,
      status: session?.status === 'active' ? 'Busy' : 'Idle',
      session_id: session?.id,
      project_id: request.project_id,
    };
  });

  ipcMain.handle('computer:agentStop', async (_, request: { user_id: string; project_id?: string }) => {
    const acpEngine = agentService.getAcpEngine();
    if (!acpEngine) return { success: true, message: 'Not running' };
    if (request.project_id) {
      const session = acpEngine.findSessionByProjectId(request.project_id);
      if (session) await acpEngine.abortSession(session.id);
    } else {
      await acpEngine.abortSession();
    }
    return { success: true, message: 'Stopped' };
  });

  ipcMain.handle('computer:cancelSession', async (_, request: { user_id: string; session_id?: string }) => {
    const acpEngine = agentService.getAcpEngine();
    if (!acpEngine) return { success: false, error: 'Agent not initialized' };
    if (!request.session_id) return { success: false, error: 'session_id is required' };
    await acpEngine.abortSession(request.session_id);
    return { success: true, session_id: request.session_id };
  });

  ipcMain.handle('computer:health', async () => {
    return {
      status: agentService.isReady ? 'healthy' : 'offline',
      engineType: agentService.getEngineType(),
      timestamp: new Date().toISOString(),
    };
  });

  // ==================== computer:* Event Forwarding (rcoder ProgressMessage format, snake_case) ====================

  agentService.on('computer:progress', (data: unknown) => {
    mainWindow?.webContents.send('computer:progress', data);
    // 同时推送到 HTTP SSE 客户端
    const d = data as UnifiedSessionMessage;
    if (d?.session_id) pushSseEvent(d.session_id, 'message', d);
  });

  agentService.on('computer:promptStart', (data: { sessionId: string; requestId?: string }) => {
    const event = {
      session_id: data.sessionId,
      message_type: 'SessionPromptStart',
      sub_type: 'prompt_start',
      data: { request_id: data.requestId },
      timestamp: new Date().toISOString(),
    };
    mainWindow?.webContents.send('computer:progress', event);
    pushSseEvent(data.sessionId, 'message', event);
  });

  agentService.on('computer:promptEnd', (data: { sessionId: string; reason?: string; description?: string }) => {
    const event = {
      session_id: data.sessionId,
      message_type: 'SessionPromptEnd',
      sub_type: data.reason || 'end_turn',
      data: { reason: data.reason, description: data.description },
      timestamp: new Date().toISOString(),
    };
    mainWindow?.webContents.send('computer:progress', event);
    pushSseEvent(data.sessionId, 'message', event);
  });

  // ==================== services:restartAll (对齐 Tauri services_restart_all) ====================

  ipcMain.handle('services:restartAll', async () => {
    log.info('[Services] Restarting all services...');
    const results: Record<string, { success: boolean; error?: string }> = {};

    // 1. Stop existing services first
    try {
      await agentService.destroy();
      await stopComputerServer();
    } catch (e) { log.warn('[Services] Agent destroy error (ignored):', e); }
    if (fileServerProcess) { fileServerProcess.kill(); fileServerProcess = null; }
    if (lanproxyProcess) { lanproxyProcess.kill(); lanproxyProcess = null; }
    mcpProxyManager.stop();

    // 2. Start Agent + Computer HTTP Server
    try {
      const agentConfig = readSetting('agent_config') as any || {};
      const step1Config = readSetting('step1_config') as any || {};
      let finalConfig: AgentConfig = {
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
      await startComputerServer(step1Config.agentPort ?? 60001);
      results.agent = { success: ok };
      log.info('[Services] Agent started');
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error('[Services] Agent start failed:', e);
    }

    // 3. Start File Server (uses extracted helper)
    try {
      const step1Config = readSetting('step1_config') as any || {};
      results.fileServer = await startFileServerProcess(step1Config.fileServerPort ?? 60000);
      log.info('[Services] FileServer started:', results.fileServer);
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
      log.error('[Services] FileServer start failed:', e);
    }

    // 4. Start Lanproxy (uses extracted helper)
    try {
      const clientKey = readSetting('auth.saved_key') as string | null;
      const lpConfig = readSetting('lanproxy_config') as any || {};
      const serverHost = readSetting('lanproxy.server_host') as string | null;
      const serverPortStored = readSetting('lanproxy.server_port') as number | null;
      const serverIp = lpConfig.serverIp || serverHost?.replace(/^https?:\/\//, '');
      const serverPort = lpConfig.serverPort || serverPortStored;

      if (serverIp && clientKey && serverPort) {
        results.lanproxy = startLanproxyProcess({
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

  // ==================== Autolaunch handlers ====================

  ipcMain.handle('autolaunch:get', async () => {
    try {
      const settings = app.getLoginItemSettings();
      return settings.openAtLogin;
    } catch (error) {
      log.error('[IPC] autolaunch:get failed:', error);
      return false;
    }
  });

  ipcMain.handle('autolaunch:set', async (_, enabled: boolean) => {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
      return { success: true };
    } catch (error) {
      log.error('[IPC] autolaunch:set failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ==================== Log handlers ====================

  ipcMain.handle('log:getDir', () => {
    return log.transports.file.getFile().path ? path.dirname(log.transports.file.getFile().path) : app.getPath('logs');
  });

  ipcMain.handle('log:openDir', async () => {
    try {
      const logDir = log.transports.file.getFile().path ? path.dirname(log.transports.file.getFile().path) : app.getPath('logs');
      await shell.openPath(logDir);
      return { success: true };
    } catch (error) {
      log.error('[IPC] log:openDir failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('log:list', async (_, count: number = 200) => {
    try {
      const logPath = log.transports.file.getFile().path;
      if (!logPath || !fs.existsSync(logPath)) {
        return [];
      }
      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const recent = lines.slice(-count);
      return recent.map((line) => {
        // electron-log format: [2024-01-01 12:00:00.000] [level] message
        const match = line.match(/^\[(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3})\]\s\[(\w+)\]\s(.*)$/);
        if (match) {
          return { timestamp: match[1], level: match[2].toLowerCase(), message: match[3] };
        }
        return { timestamp: '', level: 'info', message: line };
      });
    } catch (error) {
      log.error('[IPC] log:list failed:', error);
      return [];
    }
  });

  // ==================== App handlers ====================

  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      // electron-updater integration placeholder
      // When electron-updater is configured, use autoUpdater.checkForUpdates()
      return { hasUpdate: false };
    } catch (error) {
      log.error('[IPC] app:checkUpdate failed:', error);
      return { hasUpdate: false, error: String(error) };
    }
  });

  // ==================== Permissions handlers (macOS) ====================

  ipcMain.handle('permissions:check', async () => {
    if (process.platform !== 'darwin') {
      return [];
    }
    try {
      const { systemPreferences } = require('electron');
      const items = [
        {
          key: 'accessibility',
          name: '辅助功能',
          description: '允许应用控制您的电脑',
          status: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
        },
        {
          key: 'screen_recording',
          name: '屏幕录制',
          description: '允许应用录制屏幕内容',
          status: systemPreferences.getMediaAccessStatus('screen') === 'granted' ? 'granted' : 'denied',
        },
        {
          key: 'file_access',
          name: '全磁盘访问',
          description: '允许应用访问所有文件',
          status: 'unknown' as const,
        },
      ];
      return items;
    } catch (error) {
      log.error('[IPC] permissions:check failed:', error);
      return [];
    }
  });

  ipcMain.handle('permissions:openSettings', async (_, permissionKey: string) => {
    try {
      if (process.platform !== 'darwin') {
        return { success: false, error: 'Not macOS' };
      }
      const urlMap: Record<string, string> = {
        accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
        screen_recording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        file_access: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      };
      const url = urlMap[permissionKey];
      if (url) {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: 'Unknown permission' };
    } catch (error) {
      log.error('[IPC] permissions:openSettings failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ==================== Shell handlers ====================

  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      log.error('[IPC] shell:openExternal failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ==================== Dialog handlers ====================

  ipcMain.handle('dialog:openDirectory', async (_, title?: string) => {
    if (!mainWindow) return { success: false, error: 'No window' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || '选择目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, path: result.filePaths[0] };
  });

  // ==================== Dependency handlers ====================
  
  const {
    checkNodeVersion,
    checkUvVersion,
    detectNpmPackage,
    checkAllDependencies,
    installNpmPackage,
    installMissingDependencies,
    getAppDataDir,
    SETUP_REQUIRED_DEPENDENCIES,
  } = require('../services/dependencies');

  // Dependency - Check all
  ipcMain.handle('dependencies:checkAll', async () => {
    log.info('[IPC] Checking all dependencies...');
    try {
      const results = await checkAllDependencies();
      return { success: true, results };
    } catch (error) {
      log.error('[IPC] Dependency check failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Dependency - Check Node.js
  ipcMain.handle('dependencies:checkNode', async () => {
    try {
      const result = await checkNodeVersion();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Dependency - Check uv
  ipcMain.handle('dependencies:checkUv', async () => {
    try {
      const result = await checkUvVersion();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Dependency - Detect npm package
  ipcMain.handle('dependencies:detectPackage', async (_, packageName: string, binName?: string) => {
    try {
      const result = await detectNpmPackage(packageName, binName);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Dependency - Install npm package
  ipcMain.handle('dependencies:installPackage', async (_, packageName: string, options?: { registry?: string; version?: string }) => {
    log.info(`[IPC] Installing package: ${packageName}`);
    try {
      const result = await installNpmPackage(packageName, options);
      return result;
    } catch (error) {
      log.error('[IPC] Install failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Dependency - Install missing
  ipcMain.handle('dependencies:installMissing', async () => {
    log.info('[IPC] Installing missing dependencies...');
    try {
      const result = await installMissingDependencies();
      return result;
    } catch (error) {
      log.error('[IPC] Install missing failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Dependency - Get app data dir
  ipcMain.handle('dependencies:getAppDataDir', () => {
    return getAppDataDir();
  });

  // Dependency - Get required dependencies list
  ipcMain.handle('dependencies:getRequiredList', () => {
    return SETUP_REQUIRED_DEPENDENCIES;
  });

  // ==================== Engine Manager handlers ====================

  const {
    isEngineInstalledLocally,
    isEngineInstalledGlobally,
    getEngineVersion,
    findEngineBinary,
    installEngine,
    startEngine,
    stopEngine,
    getEngineStatus,
    sendToEngine,
    stopAllEngines,
  } = require('../services/engineManager');

  // Engine - Check local installation
  ipcMain.handle('engine:checkLocal', async (_, engine: string) => {
    return isEngineInstalledLocally(engine);
  });

  // Engine - Check global installation
  ipcMain.handle('engine:checkGlobal', async (_, engine: string) => {
    return isEngineInstalledGlobally(engine);
  });

  // Engine - Get version
  ipcMain.handle('engine:getVersion', async (_, engine: string) => {
    return getEngineVersion(engine);
  });

  // Engine - Find binary path
  ipcMain.handle('engine:findBinary', async (_, engine: string) => {
    return findEngineBinary(engine);
  });

  // Engine - Install
  ipcMain.handle('engine:install', async (_, engine: string, options?: { registry?: string }) => {
    log.info(`[IPC] Installing engine: ${engine}`);
    return installEngine(engine, options);
  });

  // Engine - Start
  ipcMain.handle('engine:start', async (_, config: {
    engine: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    workspaceDir?: string;
  }) => {
    log.info(`[IPC] Starting engine: ${config.engine}`);
    return startEngine(config);
  });

  // Engine - Stop
  ipcMain.handle('engine:stop', async (_, engineId: string) => {
    return stopEngine(engineId);
  });

  // Engine - Status
  ipcMain.handle('engine:status', async (_, engineId?: string) => {
    return getEngineStatus(engineId);
  });

  // Engine - Send message
  ipcMain.handle('engine:send', async (_, engineId: string, message: string) => {
    return sendToEngine(engineId, message);
  });

  // Engine - Stop all
  ipcMain.handle('engine:stopAll', async () => {
    await stopAllEngines();
    return { success: true };
  });

  log.info('IPC handlers registered');
}

// App lifecycle
app.whenReady().then(() => {
  log.info('App ready');
  initDatabase();
  setupIpcHandlers();

  // 初始化 MCP Proxy 配置（从数据库加载）
  try {
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

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Stop MCP Proxy
  mcpProxyManager.cleanup();

  // Stop lanproxy
  if (lanproxyProcess) {
    lanproxyProcess.kill();
    lanproxyProcess = null;
    log.info('Lanproxy stopped');
  }

  // Stop Agent Runner
  if (agentRunnerProcess) {
    agentRunnerProcess.kill();
    agentRunnerProcess = null;
    agentRunnerPorts = null;
    log.info('Agent Runner stopped');
  }

  // Stop File Server
  if (fileServerProcess) {
    fileServerProcess.kill();
    fileServerProcess = null;
    log.info('File Server stopped');
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Stop all child processes before quit
function cleanupAllProcesses(): void {
  log.info('[Cleanup] Stopping all processes...');

  // Stop Computer HTTP Server
  stopComputerServer().catch((e) => {
    log.error('[Cleanup] Computer server stop error:', e);
  });

  // Stop Unified Agent Service
  agentService.destroy().catch((e) => {
    log.error('[Cleanup] Agent service destroy error:', e);
  });

  // Stop Agent Runner
  if (agentRunnerProcess) {
    try {
      agentRunnerProcess.kill();
      log.info('[Cleanup] Agent Runner stopped');
    } catch (e) {
      log.error('[Cleanup] Agent Runner stop error:', e);
    }
    agentRunnerProcess = null;
    agentRunnerPorts = null;
  }

  // Stop Lanproxy
  if (lanproxyProcess) {
    try {
      lanproxyProcess.kill();
      log.info('[Cleanup] Lanproxy stopped');
    } catch (e) {
      log.error('[Cleanup] Lanproxy stop error:', e);
    }
    lanproxyProcess = null;
  }

  // Stop File Server
  if (fileServerProcess) {
    try {
      fileServerProcess.kill();
      log.info('[Cleanup] File Server stopped');
    } catch (e) {
      log.error('[Cleanup] File Server stop error:', e);
    }
    fileServerProcess = null;
  }

  // Stop MCP Proxy
  try {
    mcpProxyManager.cleanup();
    log.info('[Cleanup] MCP Proxy stopped');
  } catch (e) {
    // MCP service might not be loaded
  }

  // Stop all Engine processes
  try {
    const { stopAllEngines } = require('../services/engineManager');
    stopAllEngines();
    log.info('[Cleanup] Engine processes stopped');
  } catch (e) {
    // Engine service might not be loaded
  }

  log.info('[Cleanup] All processes stopped');
}

// Register cleanup handlers
app.on('before-quit', () => {
  log.info('[App] Before quit - starting cleanup');
  cleanupAllProcesses();
  
  if (db) {
    db.close();
    log.info('[App] Database closed');
  }
});

app.on('will-quit', () => {
  log.info('[App] Will quit');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason);
});
