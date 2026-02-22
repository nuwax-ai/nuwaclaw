import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';
import Database from 'better-sqlite3';
import { agentService } from '../services/unifiedAgent';
import type { AgentConfig } from '../services/unifiedAgent';

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('Application starting...');

// Global references
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;
let mcpProcesses: Map<string, ChildProcess> = new Map();
let lanproxyProcess: ChildProcess | null = null;
let agentRunnerProcess: ChildProcess | null = null;
let fileServerProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Database path
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'nuwax-agent.db');

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
    mainWindow.loadURL('http://localhost:5173');
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
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    );
    stmt.run(key, JSON.stringify(value));
    return true;
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

  // MCP handlers - Install package
  ipcMain.handle('mcp:install', async (_, { packageName, registry }: { packageName: string; registry?: string }) => {
    return new Promise((resolve) => {
      const registryArg = registry && registry !== 'https://registry.npmjs.org/' ? `--registry=${registry}` : '';
      const cmd = `npm install -g ${packageName} ${registryArg}`;
      log.info('Installing MCP package:', cmd);

      const proc = spawn('npm', ['install', '-g', packageName, registryArg].filter(Boolean), {
        shell: true,
        windowsHide: true,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        log.error('MCP install error:', error);
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          log.info('MCP package installed:', packageName);
          resolve({ success: true });
        } else {
          log.error('MCP install failed:', stderr);
          resolve({ success: false, error: stderr || 'Install failed' });
        }
      });
    });
  });

  // MCP handlers - Uninstall package
  ipcMain.handle('mcp:uninstall', async (_, packageName: string) => {
    return new Promise((resolve) => {
      const cmd = `npm uninstall -g ${packageName}`;
      log.info('Uninstalling MCP package:', cmd);

      const proc = spawn('npm', ['uninstall', '-g', packageName], {
        shell: true,
        windowsHide: true,
        env: { ...process.env },
      });

      let stderr = '';

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        log.error('MCP uninstall error:', error);
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          log.info('MCP package uninstalled:', packageName);
          resolve({ success: true });
        } else {
          log.error('MCP uninstall failed:', stderr);
          resolve({ success: false, error: stderr || 'Uninstall failed' });
        }
      });
    });
  });

  // MCP handlers - Check if package is installed
  ipcMain.handle('mcp:isInstalled', async (_, packageName: string) => {
    return new Promise((resolve) => {
      const proc = spawn('npm', ['list', '-g', '--depth=0', packageName], {
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      let stdout = '';
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        resolve(code === 0 && stdout.includes(packageName));
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  });

  // MCP handlers - Start MCP server
  ipcMain.handle('mcp:start', async (_, { id, command, args, env }: { id: string; command: string; args: string[]; env?: Record<string, string> }) => {
    if (mcpProcesses.has(id)) {
      return { success: true, message: 'Already running' };
    }

    return new Promise((resolve) => {
      try {
        const proc = spawn(command, args, {
          env: { ...process.env, ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.on('error', (error) => {
          log.error(`MCP server ${id} error:`, error);
          mcpProcesses.delete(id);
          resolve({ success: false, error: error.message });
        });

        proc.on('exit', (code) => {
          log.info(`MCP server ${id} exited with code ${code}`);
          mcpProcesses.delete(id);
        });

        mcpProcesses.set(id, proc);
        log.info(`MCP server ${id} started`);
        resolve({ success: true });
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
    });
  });

  // MCP handlers - Stop MCP server
  ipcMain.handle('mcp:stop', async (_, id: string) => {
    const proc = mcpProcesses.get(id);
    if (proc) {
      proc.kill();
      mcpProcesses.delete(id);
      return { success: true };
    }
    return { success: false, error: 'Not running' };
  });

  // MCP handlers - Get running servers
  ipcMain.handle('mcp:running', () => {
    return Array.from(mcpProcesses.keys());
  });

  // Lanproxy handlers - Start
  ipcMain.handle('lanproxy:start', async (_, config: {
    binPath: string;
    serverIp: string;
    serverPort: number;
    clientKey: string;
    localPort: number;
  }) => {
    if (lanproxyProcess) {
      return { success: true, message: 'Already running' };
    }

    return new Promise((resolve) => {
      try {
        const args = [
          '-s', config.serverIp,
          '-p', String(config.serverPort),
          '-k', config.clientKey,
          '-l', String(config.localPort),
        ];

        log.info('Starting lanproxy:', config.binPath, args.join(' '));

        lanproxyProcess = spawn(config.binPath, args, {
          shell: true,
        windowsHide: true,
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        lanproxyProcess.on('error', (error) => {
          log.error('Lanproxy error:', error);
          lanproxyProcess = null;
          resolve({ success: false, error: error.message });
        });

        lanproxyProcess.on('exit', (code) => {
          log.info(`Lanproxy exited with code ${code}`);
          lanproxyProcess = null;
        });

        // Check if it's running after a short delay
        setTimeout(() => {
          if (lanproxyProcess) {
            resolve({ success: true });
          }
        }, 1000);
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
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
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        agentRunnerProcess.on('error', (error) => {
          log.error('Agent Runner error:', error);
          agentRunnerProcess = null;
          resolve({ success: false, error: error.message });
        });

        agentRunnerProcess.on('exit', (code) => {
          log.info(`Agent Runner exited with code ${code}`);
          agentRunnerProcess = null;
        });

        // Check after a delay
        setTimeout(() => {
          if (agentRunnerProcess) {
            resolve({ success: true });
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
      return { success: true };
    }
    return { success: true, message: 'Not running' };
  });

  // Agent Runner handlers - Status
  ipcMain.handle('agentRunner:status', () => {
    return {
      running: agentRunnerProcess !== null,
      pid: agentRunnerProcess?.pid,
      backendUrl: agentRunnerProcess ? `http://127.0.0.1:60001` : undefined,
      proxyUrl: agentRunnerProcess ? `http://127.0.0.1:60002` : undefined,
    };
  });

  // Agent (nuwaxcode/claude-code) handlers
  ipcMain.handle('agent:start', async (_, config: {
    type: 'nuwaxcode' | 'claude-code';
    binPath: string;
    env: Record<string, string>;
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
  }) => {
    if (agentRunnerProcess) {
      return { success: true, message: 'Already running' };
    }

    return new Promise((resolve) => {
      try {
        const args = config.type === 'nuwaxcode' 
          ? ['serve', '--stdio'] 
          : ['--sACP'];

        const env = {
          ...process.env,
          ...config.env,
          ...(config.apiKey && { ANTHROPIC_API_KEY: config.apiKey }),
          ...(config.apiBaseUrl && { ANTHROPIC_BASE_URL: config.apiBaseUrl }),
          ...(config.model && { ANTHROPIC_MODEL: config.model }),
        };

        log.info(`Starting agent (${config.type}):`, config.binPath, args.join(' '));

        agentRunnerProcess = spawn(config.binPath, args, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        agentRunnerProcess.on('error', (error) => {
          log.error(`Agent (${config.type}) error:`, error);
          agentRunnerProcess = null;
          resolve({ success: false, error: error.message });
        });

        agentRunnerProcess.on('exit', (code) => {
          log.info(`Agent (${config.type}) exited with code ${code}`);
          agentRunnerProcess = null;
        });

        setTimeout(() => {
          if (agentRunnerProcess) {
            resolve({ success: true });
          }
        }, 2000);
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
    });
  });

  // Agent handlers - Stop
  ipcMain.handle('agent:stop', async () => {
    if (agentRunnerProcess) {
      agentRunnerProcess.kill();
      agentRunnerProcess = null;
      return { success: true };
    }
    return { success: true, message: 'Not running' };
  });

  // Agent handlers - Status
  ipcMain.handle('agent:status', () => {
    return {
      running: agentRunnerProcess !== null,
      pid: agentRunnerProcess?.pid,
    };
  });

  // File Server handlers - Start
  ipcMain.handle('fileServer:start', async (_, port: number = 8080) => {
    if (fileServerProcess) {
      return { success: true, message: 'Already running' };
    }

    return new Promise((resolve) => {
      try {
        // Try nuwax-file-server or fallback to a simple server
        const serverCmd = 'nuwax-file-server';
        const args = ['--port', String(port)];

        log.info('Starting file server:', serverCmd, args.join(' '));

        fileServerProcess = spawn(serverCmd, args, {
          shell: true,
        windowsHide: true,
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
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
        }, 2000);
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
    });
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

  // Agent handlers - Send message
  ipcMain.handle('agent:send', async (_, message: string) => {
    if (!agentRunnerProcess) {
      return { success: false, error: 'Agent not running' };
    }

    const stdin = agentRunnerProcess.stdin;
    const stdout = agentRunnerProcess.stdout;
    
    if (!stdin || !stdout) {
      return { success: false, error: 'Agent streams not available' };
    }
    
    return new Promise((resolve) => {
      const response: string[] = [];
      
      const onData = (data: Buffer) => {
        response.push(data.toString());
      };

      stdout.on('data', onData);

      stdin.write(message + '\n', (error) => {
        setTimeout(() => {
          stdout.off('data', onData);
          resolve({ success: true, response: response.join('') });
        }, 5000);
      });
    });
  });

  // ==================== Unified Agent SDK handlers ====================

  // Initialize unified agent service
  ipcMain.handle('agent:init', async (_, config: AgentConfig) => {
    log.info('[IPC] Initializing unified agent:', config.engine);
    try {
      const ok = await agentService.init(config);
      return { success: ok };
    } catch (error) {
      log.error('[IPC] agent:init failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Destroy unified agent service
  ipcMain.handle('agent:destroy', async () => {
    try {
      await agentService.destroy();
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
  
  // Import dependency functions
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
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Stop all MCP processes
  for (const [id, proc] of mcpProcesses) {
    proc.kill();
    log.info(`MCP server ${id} stopped`);
  }
  mcpProcesses.clear();

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

  // Stop all MCP servers
  try {
    const { stopAllMcpServers } = require('../services/mcp');
    stopAllMcpServers();
    log.info('[Cleanup] MCP servers stopped');
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
