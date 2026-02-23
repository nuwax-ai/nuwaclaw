import { app, BrowserWindow, Menu, Tray, nativeImage, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { initDatabase, closeDb } from './db';
import { ManagedProcess } from './processManager';
import { registerAllHandlers } from './ipc/index';
import { runStartupTasks } from './startup';
import { agentService } from '../services/unifiedAgent';
import { stopComputerServer } from '../services/computerServer';
import { mcpProxyManager } from '../services/mcp';
import type { HandlerContext } from '../types/ipc';

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

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Managed child processes
const lanproxy = new ManagedProcess('lanproxy');
const fileServer = new ManagedProcess('fileServer');
const agentRunner = new ManagedProcess('agentRunner');
let agentRunnerPorts: { backendPort: number; proxyPort: number } | null = null;

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

function cleanupAllProcesses(): void {
  log.info('[Cleanup] Stopping all processes...');

  stopComputerServer().catch((e) => {
    log.error('[Cleanup] Computer server stop error:', e);
  });

  agentService.destroy().catch((e) => {
    log.error('[Cleanup] Agent service destroy error:', e);
  });

  agentRunner.kill();
  lanproxy.kill();
  fileServer.kill();

  try {
    mcpProxyManager.cleanup();
    log.info('[Cleanup] MCP Proxy stopped');
  } catch (e) {
    // MCP service might not be loaded
  }

  try {
    const { stopAllEngines } = require('../services/engineManager');
    stopAllEngines();
    log.info('[Cleanup] Engine processes stopped');
  } catch (e) {
    // Engine service might not be loaded
  }

  log.info('[Cleanup] All processes stopped');
}

// App lifecycle
app.whenReady().then(async () => {
  log.info('App ready');
  initDatabase();

  const ctx: HandlerContext = {
    getMainWindow: () => mainWindow,
    lanproxy,
    fileServer,
    agentRunner,
    get agentRunnerPorts() { return agentRunnerPorts; },
    setAgentRunnerPorts: (ports) => { agentRunnerPorts = ports; },
  };

  registerAllHandlers(ctx);
  await runStartupTasks();

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  mcpProxyManager.cleanup();
  lanproxy.kill();
  agentRunner.kill();
  agentRunnerPorts = null;
  fileServer.kill();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  log.info('[App] Before quit - starting cleanup');
  cleanupAllProcesses();
  closeDb();
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
