import { ipcMain, app, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import type { HandlerContext } from '../../types/ipc';

export function registerAppHandlers(ctx: HandlerContext): void {
  // Autolaunch
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

  // Log handlers
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

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      return { hasUpdate: false };
    } catch (error) {
      log.error('[IPC] app:checkUpdate failed:', error);
      return { hasUpdate: false, error: String(error) };
    }
  });

  // Permissions (macOS)
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
