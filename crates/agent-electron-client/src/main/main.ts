import { app, BrowserWindow, Menu, Tray, nativeImage, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { initDatabase, closeDb } from './db';
import { ManagedProcess } from './processManager';
import { registerAllHandlers } from './ipc/index';
import { runStartupTasks } from './startup';
import { agentService } from '../services/main/engines/unifiedAgent';
import { stopComputerServer } from '../services/main/computerServer';
import { mcpProxyManager } from '../services/main/packages/mcp';
import type { HandlerContext } from '../types/ipc';
import { APP_DATA_DIR_NAME, LOGS_DIR_NAME, DEFAULT_DEV_SERVER_PORT } from '../services/main/constants';
import { APP_DISPLAY_NAME } from '../commons/constants';

// Configure logging — 日志统一写入 ~/.nuwax-agent/logs/
const nuwaxHome = path.join(app.getPath('home'), APP_DATA_DIR_NAME);
const logDir = path.join(nuwaxHome, LOGS_DIR_NAME);
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

// Get icon path (works in both dev and production)
function getIconPath() {
  if (app.isPackaged) {
    // Production: icons in app.asar (Resources)
    if (process.platform === 'darwin') {
      return path.join(process.resourcesPath, 'icon.icns');
    }
    return path.join(process.resourcesPath, 'icon.png');
  }
  // Development: icons in project root
  if (process.platform === 'darwin') {
    return path.join(process.cwd(), 'public', 'icon.icns');
  }
  return path.join(process.cwd(), 'public', 'icon.png');
}

// Get tray icon path (works in both dev and production)
function getTrayIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, '32x32.png');
  }
  return path.join(process.cwd(), 'public', '32x32.png');
}

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
    title: APP_DISPLAY_NAME,
    icon: getIconPath(),
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
    mainWindow.loadURL(`http://localhost:${DEFAULT_DEV_SERVER_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：dist 目录被打包到 app.asar 中
    // 使用 file:// 协议直接加载 asar 内的文件
    const indexUrl = `file://${process.resourcesPath}/app.asar/dist/index.html`;
    log.info('Loading app from:', indexUrl);
    mainWindow.loadURL(indexUrl);
  }

  // Handle load failures
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error('Failed to load:', validatedURL, errorCode, errorDescription);
    dialog.showErrorBox(
      'Load Error',
      `Failed to load application: ${errorDescription}\n\nURL: ${validatedURL}`
    );
  });

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
          label: `About ${APP_DISPLAY_NAME}`,
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: `About ${APP_DISPLAY_NAME}`,
              message: `${APP_DISPLAY_NAME} v${app.getVersion()}`,
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
  const trayIconPath = getTrayIconPath();
  const icon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => mainWindow?.webContents.send('menu:settings'),
    },
    {
      label: '依赖管理',
      click: () => mainWindow?.webContents.send('menu:dependencies'),
    },
    { type: 'separator' },
    {
      label: '关于',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: `About ${APP_DISPLAY_NAME}`,
          message: `${APP_DISPLAY_NAME} v${app.getVersion()}`,
          detail: 'Your AI assistant for productivity.',
        });
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip(APP_DISPLAY_NAME);
  tray.setContextMenu(contextMenu);

  // 左键点击显示窗口
  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // 双击也显示窗口
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
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
    const { stopAllEngines } = require('../services/main/engines/engineManager');
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
