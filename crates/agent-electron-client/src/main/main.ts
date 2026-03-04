import { app, BrowserWindow, Menu, dialog, ipcMain, Tray, nativeImage } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { initDatabase, closeDb } from './db';
import { ManagedProcess } from './processManager';
import { registerAllHandlers } from './ipc/index';
import { runStartupTasks } from './bootstrap/startup';
import { agentService } from './services/engines/unifiedAgent';
import { stopComputerServer } from './services/computerServer';
import { mcpProxyManager } from './services/packages/mcp';
import type { HandlerContext } from '@shared/types/ipc';
import { DEFAULT_DEV_SERVER_PORT } from './services/constants';
import { APP_DISPLAY_NAME } from '@shared/constants';
import { initLogging } from './bootstrap/logConfig';
import { createTrayManager, TrayStatus } from './window/trayManager';
import { createServiceManager } from './window/serviceManager';
import { initAutoUpdater } from './services/autoUpdater';
import { migrateDataDir } from './bootstrap/migrate';

// macOS 26 Tahoe 兼容性：禁用 Fontations 字体后端
// 参考: https://github.com/electron/electron/issues/49522
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'FontationsFontBackend');
}

// 日志：轮转 + TTL 清理 + 开发/正式差异化（见 logConfig.ts）
initLogging();
log.info('Application starting...');

// Global references
let mainWindow: BrowserWindow | null = null;
let trayManager: ReturnType<typeof createTrayManager> | null = null;

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

// Get icon path for Dock (must be PNG - nativeImage cannot load .icns)
function getDockIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon-dock.png');
  }
  return path.join(process.cwd(), 'public', 'icon-dock.png');
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
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
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
  if (process.platform === 'darwin') {
    // macOS: 保留最小菜单，确保 Cmd+C/V/Q 等快捷键正常
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux: 去掉菜单栏，功能由界面和系统托盘提供
    Menu.setApplicationMenu(null);
  }
}

async function initTrayManager() {
  // 创建服务管理器
  const serviceManager = createServiceManager({ lanproxy, fileServer, agentRunner });

  trayManager = createTrayManager({
    onShowWindow: () => {
      mainWindow?.show();
      mainWindow?.focus();
    },
    onRestartServices: async () => {
      log.info('[Tray] Restarting all services...');
      await serviceManager.restartAllServices();
      trayManager?.updateServicesStatus(true);
    },
    onStopServices: async () => {
      log.info('[Tray] Stopping all services...');
      await serviceManager.stopAllServices();
      trayManager?.updateServicesStatus(false);
      log.info('[Tray] All services stopped');
    },
  });

  await trayManager.create();
  log.info('[Tray] TrayManager initialized');
}

// IPC handler for tray status updates from renderer
ipcMain.handle('tray:updateStatus', (_, status: TrayStatus) => {
  if (trayManager) {
    trayManager.setStatus(status);
  }
});

ipcMain.handle('tray:updateServicesStatus', (_, running: boolean) => {
  if (trayManager) {
    trayManager.updateServicesStatus(running);
  }
});

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
    // 停止 PersistentMcpBridge（kill 持久化 MCP server 子进程）
    mcpProxyManager.cleanup();
  } catch (e) {
    // MCP service might not be loaded
  }

  try {
    const { stopAllEngines } = require('./services/engines/engineManager');
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

  // Set Dock icon on macOS (development mode needs this)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = getDockIconPath();
    log.info('Setting Dock icon from:', iconPath);
    try {
      const iconImage = nativeImage.createFromPath(iconPath);
      log.info('Icon image size:', iconImage.getSize(), 'isEmpty:', iconImage.isEmpty());
      if (!iconImage.isEmpty()) {
        app.dock.setIcon(iconImage);
        log.info('Dock icon set successfully');
      } else {
        log.warn('Icon image is empty');
      }
    } catch (e) {
      log.warn('Failed to set Dock icon:', e);
    }
  }

  migrateDataDir();
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
  await initTrayManager();
  initAutoUpdater(() => mainWindow, cleanupAllProcesses);
});

app.on('window-all-closed', () => {
  // 停止 PersistentMcpBridge + 清除代理状态
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
