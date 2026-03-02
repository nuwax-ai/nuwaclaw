/**
 * 自动更新服务 - 基于 electron-updater
 *
 * - autoDownload = false: 用户控制下载时机
 * - autoInstallOnAppQuit = true: 下载完成后退出时自动安装
 * - 仅在 app.isPackaged 时激活
 */

import { app, BrowserWindow, shell } from 'electron';
import log from 'electron-log';
import type { UpdateState, UpdateInfo, UpdateProgress } from '@shared/types/updateTypes';

/**
 * 语义化版本比较: a > b 返回 1, a < b 返回 -1, 相等返回 0
 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

let currentState: UpdateState = { status: 'idle' };
let getMainWindow: (() => BrowserWindow | null) | null = null;

function sendStatusToRenderer(): void {
  const win = getMainWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update:status', currentState);
  }
}

function setState(patch: Partial<UpdateState>): void {
  currentState = { ...currentState, ...patch };
  sendStatusToRenderer();
}

/**
 * 初始化自动更新（应在 app.whenReady 后调用）
 */
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  getMainWindow = getWindow;

  if (!app.isPackaged) {
    log.info('[AutoUpdater] Skipped: not packaged (dev mode)');
    return;
  }

  // CJS 兼容导入 electron-updater
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { autoUpdater } = require('electron-updater');

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // -------- 事件监听 --------

  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdater] Checking for update...');
    setState({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info: any) => {
    log.info('[AutoUpdater] Update available:', info.version);
    setState({
      status: 'available',
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', (_info: any) => {
    log.info('[AutoUpdater] Already up to date');
    setState({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress: UpdateProgress) => {
    log.info(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`);
    setState({
      status: 'downloading',
      progress,
    });
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    log.info('[AutoUpdater] Update downloaded:', info.version);
    setState({
      status: 'downloaded',
      version: info.version,
      progress: undefined,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('[AutoUpdater] Error:', err.message);
    setState({
      status: 'error',
      error: err.message,
      progress: undefined,
    });
  });

  // 延迟 10s 静默检查一次
  setTimeout(() => {
    log.info('[AutoUpdater] Initial silent check');
    autoUpdater.checkForUpdates().catch((e: Error) => {
      log.warn('[AutoUpdater] Silent check failed:', e.message);
    });
  }, 10_000);
}

/**
 * 手动检查更新
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!app.isPackaged) {
    return { hasUpdate: false };
  }

  try {
    const { autoUpdater } = require('electron-updater');
    setState({ status: 'checking', error: undefined });
    const result = await autoUpdater.checkForUpdates();

    if (result?.updateInfo) {
      const hasUpdate = compareVersions(result.updateInfo.version, app.getVersion()) > 0;
      return {
        hasUpdate,
        version: result.updateInfo.version,
        releaseDate: result.updateInfo.releaseDate,
        releaseNotes: typeof result.updateInfo.releaseNotes === 'string'
          ? result.updateInfo.releaseNotes
          : undefined,
      };
    }

    return { hasUpdate: false };
  } catch (err: any) {
    log.error('[AutoUpdater] checkForUpdates error:', err.message);
    setState({ status: 'error', error: err.message });
    return { hasUpdate: false, error: err.message };
  }
}

/**
 * 下载更新
 */
export async function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  if (!app.isPackaged) {
    return { success: false, error: 'Not packaged' };
  }

  try {
    const { autoUpdater } = require('electron-updater');
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err: any) {
    log.error('[AutoUpdater] downloadUpdate error:', err.message);
    setState({ status: 'error', error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * 退出并安装更新
 */
export function installUpdate(): { success: boolean; error?: string } {
  if (!app.isPackaged) {
    return { success: false, error: 'Not packaged' };
  }

  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err: any) {
    log.error('[AutoUpdater] installUpdate error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 获取当前更新状态
 */
export function getUpdateState(): UpdateState {
  return { ...currentState };
}

/**
 * 打开 GitHub Releases 页面（用于签名失败等降级场景）
 */
export function openReleasesPage(): void {
  shell.openExternal('https://github.com/nuwax-ai/nuwax-agent-client/releases');
}
