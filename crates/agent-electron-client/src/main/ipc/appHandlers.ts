import { ipcMain, app, dialog, shell, systemPreferences, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import log from 'electron-log';
import type { HandlerContext } from '@shared/types/ipc';
import { LATEST_LOG_BASENAME } from '../bootstrap/logConfig';
import { checkForUpdates, downloadUpdate, installUpdate, getUpdateState, openReleasesPage } from '../services/autoUpdater';
import { getDeviceId } from '../services/system/deviceId';
import { getTrayManager } from '../window/trayManager';
import { getAutoLaunchManager } from '../window/autoLaunchManager';

export function registerAppHandlers(ctx: HandlerContext): void {
  // Autolaunch — 统一通过 AutoLaunchManager 操作，确保 args 一致（Windows 注册表 entry 一致）
  ipcMain.handle('autolaunch:get', async () => {
    try {
      const mgr = getAutoLaunchManager();
      if (mgr) return mgr.isEnabled();
      // fallback: AutoLaunchManager 未初始化时直接读
      const settings = app.getLoginItemSettings({ args: ['--hidden'] });
      return settings.openAtLogin;
    } catch (error) {
      log.error('[IPC] autolaunch:get failed:', error);
      return false;
    }
  });

  ipcMain.handle('autolaunch:set', async (_, enabled: boolean) => {
    try {
      const mgr = getAutoLaunchManager();
      let success = false;
      if (mgr) {
        success = await mgr.setEnabled(enabled);
      } else {
        // fallback
        app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ['--hidden'] });
        success = true;
      }
      if (!success) return { success: false, error: '设置失败' };
      // 同步托盘缓存状态
      getTrayManager()?.refreshAutoLaunchState();
      // 通知所有渲染进程
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('autolaunch:changed', enabled);
        }
      }
      return { success: true };
    } catch (error) {
      log.error('[IPC] autolaunch:set failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Log handlers
  ipcMain.handle('log:getDir', () => {
    return log.transports.file.getFile().path ? path.dirname(log.transports.file.getFile().path) : app.getPath('logs');
  });

  ipcMain.handle('log:openDir', async () => {
    try {
      const currentPath = log.transports.file.getFile().path;
      const logDir = currentPath ? path.dirname(currentPath) : app.getPath('logs');
      const latestPath = path.join(logDir, LATEST_LOG_BASENAME);
      const fileToSelect = fs.existsSync(latestPath) ? latestPath : (currentPath || path.join(logDir, 'main.log'));
      // 打开日志目录并尽量在资源管理器中选中 latest.log（或 main.log），便于用户直接看到当前日志入口
      try {
        if (process.platform === 'darwin') {
          execSync(`open -R "${fileToSelect}"`, { encoding: 'utf-8' });
        } else if (process.platform === 'win32') {
          const winPath = fileToSelect.replace(/\//g, '\\');
          execSync(`explorer /select,"${winPath}"`, { encoding: 'utf-8' });
        } else {
          await shell.openPath(logDir);
        }
      } catch (_) {
        await shell.openPath(logDir);
      }
      return { success: true };
    } catch (error) {
      log.error('[IPC] log:openDir failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // 应用日志列表：默认 2000 条，单次最多 10000 条；offset 为“从最新往前跳过条数”，用于向上滚动加载更多
  const DEFAULT_LOG_LIST = 2000;
  const MAX_LOG_LIST = 10000;
  ipcMain.handle('log:list', async (_, count: number = DEFAULT_LOG_LIST, offset: number = 0) => {
    try {
      const currentPath = log.transports.file.getFile().path;
      const logDir = currentPath ? path.dirname(currentPath) : app.getPath('logs');
      const latestPath = path.join(logDir, LATEST_LOG_BASENAME);
      const logPath = (fs.existsSync(latestPath) ? latestPath : currentPath) || currentPath;
      if (!logPath || !fs.existsSync(logPath)) {
        return [];
      }
      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const limit = Math.min(Math.max(1, count ?? DEFAULT_LOG_LIST), MAX_LOG_LIST);
      const safeOffset = Math.max(0, offset);
      // 取“从文件末尾往前 offset+limit 到 offset”的一段（时间顺序：旧→新）
      const slice =
        safeOffset === 0
          ? lines.slice(-limit)
          : lines.slice(-(safeOffset + limit), -safeOffset);
      return slice.map((line) => {
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

  // App handlers
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getDeviceId', () => {
    return getDeviceId();
  });

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      return await checkForUpdates();
    } catch (error) {
      log.error('[IPC] app:checkUpdate failed:', error);
      return { hasUpdate: false, error: String(error) };
    }
  });

  ipcMain.handle('app:downloadUpdate', async () => {
    try {
      return await downloadUpdate();
    } catch (error) {
      log.error('[IPC] app:downloadUpdate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('app:installUpdate', () => {
    try {
      return installUpdate();
    } catch (error) {
      log.error('[IPC] app:installUpdate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('app:getUpdateState', () => {
    return getUpdateState();
  });

  ipcMain.handle('app:openReleasesPage', async () => {
    await openReleasesPage();
    return { success: true };
  });

  // Permissions (macOS)
  ipcMain.handle('permissions:check', async () => {
    if (process.platform !== 'darwin') {
      return [];
    }
    try {
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

  // Shell
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      log.error('[IPC] shell:openExternal failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Dialog
  ipcMain.handle('dialog:openDirectory', async (_, title?: string) => {
    const mainWindow = ctx.getMainWindow();
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
}
