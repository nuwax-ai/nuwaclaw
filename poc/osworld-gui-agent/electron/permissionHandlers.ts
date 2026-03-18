/**
 * NuwaClaw GUI Agent - 权限检查 IPC Handler (Electron Main Process)
 * 处理权限检查和系统设置打开
 */

import { ipcMain, shell } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 检查屏幕录制权限
 */
async function checkScreenRecordingPermission(): Promise<boolean> {
  try {
    // 尝试截图来检查权限
    const { default: screenshot } = await import('screenshot-desktop');
    await screenshot();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 检查辅助功能权限
 */
async function checkAccessibilityPermission(): Promise<boolean> {
  try {
    // 尝试使用 pyautogui 检查
    const { stdout } = await execAsync(
      'python3 -c "import pyautogui; print(pyautogui.position())"',
      { timeout: 5000 }
    );
    return stdout.includes(',');
  } catch (error) {
    return false;
  }
}

/**
 * 打开系统设置（屏幕录制）
 */
function openScreenRecordingSettings(): void {
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  );
}

/**
 * 打开系统设置（辅助功能）
 */
function openAccessibilitySettings(): void {
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  );
}

/**
 * 注册权限检查 IPC Handlers
 */
export function registerPermissionHandlers(): void {
  // 检查所有权限
  ipcMain.handle('gui:checkPermissions', async () => {
    const [screen_recording, accessibility] = await Promise.all([
      checkScreenRecordingPermission(),
      checkAccessibilityPermission(),
    ]);

    return {
      screen_recording,
      accessibility,
    };
  });

  // 打开权限设置
  ipcMain.handle('gui:openPermissionSettings', async (_, permissionType: string) => {
    if (permissionType === 'screen_recording') {
      openScreenRecordingSettings();
    } else if (permissionType === 'accessibility') {
      openAccessibilitySettings();
    }
  });

  // 检查单个权限
  ipcMain.handle('gui:checkPermission', async (_, permissionType: string) => {
    if (permissionType === 'screen_recording') {
      return checkScreenRecordingPermission();
    } else if (permissionType === 'accessibility') {
      return checkAccessibilityPermission();
    }
    return false;
  });
}

/**
 * 移除权限检查 IPC Handlers
 */
export function unregisterPermissionHandlers(): void {
  ipcMain.removeHandler('gui:checkPermissions');
  ipcMain.removeHandler('gui:openPermissionSettings');
  ipcMain.removeHandler('gui:checkPermission');
}
