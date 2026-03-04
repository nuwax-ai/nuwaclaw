/**
 * 自动更新服务 - 基于 electron-updater
 *
 * - autoDownload = false: 用户控制下载时机
 * - autoInstallOnAppQuit = true: 下载完成后退出时自动安装
 * - 生产模式自动激活，开发模式通过 dev-app-update.yml 激活
 * - Windows: NSIS 安装支持自动更新，MSI 安装引导到 Releases 页面
 */

import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import type { UpdateState, UpdateInfo, UpdateProgress } from '@shared/types/updateTypes';

// ==================== 安装类型检测 ====================

type InstallerType = 'nsis' | 'msi' | 'mac' | 'linux' | 'dev';

/**
 * 检测 Windows 安装类型（NSIS vs MSI）
 *
 * NSIS 安装会在应用目录下创建 `Uninstall {productName}.exe`，
 * MSI 安装由 Windows Installer 管理，不含此文件。
 */
function detectInstallerType(): InstallerType {
  if (!app.isPackaged) return 'dev';
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'linux') return 'linux';

  if (process.platform === 'win32') {
    const appDir = path.dirname(app.getPath('exe'));
    // electron-builder NSIS 会生成 "Uninstall {productName}.exe"
    const productName = app.getName();
    const nsisUninstaller = path.join(appDir, `Uninstall ${productName}.exe`);
    if (fs.existsSync(nsisUninstaller)) {
      log.info(`[AutoUpdater] Windows installer type: NSIS (found ${nsisUninstaller})`);
      return 'nsis';
    }
    log.info('[AutoUpdater] Windows installer type: MSI (no NSIS uninstaller found)');
    return 'msi';
  }

  return 'nsis'; // fallback
}

let cachedInstallerType: InstallerType | undefined;

function getInstallerType(): InstallerType {
  if (!cachedInstallerType) {
    cachedInstallerType = detectInstallerType();
  }
  return cachedInstallerType;
}

/**
 * 当前安装方式是否支持自动更新
 * - NSIS / mac / linux: electron-updater 原生支持
 * - MSI / dev: 不支持
 */
function canAutoUpdate(): boolean {
  const type = getInstallerType();
  return type !== 'msi' && type !== 'dev';
}

// ==================== 更新状态管理 ====================

/**
 * 是否启用更新检查（生产模式始终启用，开发模式也启用以便调试）
 */
function isUpdateEnabled(): boolean {
  return true;
}

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

// ==================== 初始化 ====================

/**
 * 初始化自动更新（应在 app.whenReady 后调用）
 */
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  getMainWindow = getWindow;

  if (!isUpdateEnabled()) {
    log.info('[AutoUpdater] Skipped: updates disabled');
    return;
  }

  const installerType = getInstallerType();
  log.info(`[AutoUpdater] Installer type: ${installerType}, canAutoUpdate: ${canAutoUpdate()}`);

  // MSI 安装只支持检查更新，不支持自动下载/安装
  if (installerType === 'msi') {
    log.info('[AutoUpdater] MSI installation detected: auto-download disabled, will redirect to releases page');
  }

  // CJS 兼容导入 electron-updater
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { autoUpdater } = require('electron-updater');

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = canAutoUpdate();

  // 开发模式：使用 dev-app-update.yml 配置，禁用自动安装（Squirrel.Mac 无法匹配 dev bundle ID）
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.autoInstallOnAppQuit = false;
    log.info('[AutoUpdater] Dev mode: using dev-app-update.yml (autoInstall disabled)');
  }

  // 支持自定义更新源（用于本地测试）
  const customServer = process.env.NUWAX_UPDATE_SERVER;
  if (customServer) {
    log.info(`[AutoUpdater] Using custom update server: ${customServer}`);
    autoUpdater.setFeedURL({ provider: 'generic', url: customServer });
  }

  // -------- 事件监听 --------

  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdater] Checking for update...');
    setState({ status: 'checking', canAutoUpdate: canAutoUpdate() });
  });

  autoUpdater.on('update-available', (info: any) => {
    log.info('[AutoUpdater] Update available:', info.version);
    setState({
      status: 'available',
      version: info.version,
      canAutoUpdate: canAutoUpdate(),
    });
  });

  autoUpdater.on('update-not-available', (_info: any) => {
    log.info('[AutoUpdater] Already up to date');
    setState({ status: 'not-available', canAutoUpdate: canAutoUpdate() });
  });

  autoUpdater.on('download-progress', (progress: UpdateProgress) => {
    log.info(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`);
    setState({
      status: 'downloading',
      progress,
      canAutoUpdate: true,
    });
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    log.info('[AutoUpdater] Update downloaded:', info.version);
    setState({
      status: 'downloaded',
      version: info.version,
      progress: undefined,
      canAutoUpdate: true,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('[AutoUpdater] Error:', err.message);
    setState({
      status: 'error',
      error: err.message,
      progress: undefined,
      canAutoUpdate: canAutoUpdate(),
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

// ==================== 公开 API ====================

/**
 * 手动检查更新
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!isUpdateEnabled()) {
    return { hasUpdate: false };
  }

  try {
    const { autoUpdater } = require('electron-updater');
    setState({ status: 'checking', error: undefined, canAutoUpdate: canAutoUpdate() });
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
    setState({ status: 'error', error: err.message, canAutoUpdate: canAutoUpdate() });
    return { hasUpdate: false, error: err.message };
  }
}

/**
 * 下载更新
 */
export async function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  if (!isUpdateEnabled()) {
    return { success: false, error: 'Updates disabled' };
  }

  // Dev 模式下 Squirrel.Mac 无法处理更新包（bundle ID 不匹配），只允许检查更新
  if (!app.isPackaged) {
    log.warn('[AutoUpdater] Download skipped in dev mode (Squirrel.Mac requires packaged app)');
    return { success: false, error: '开发模式不支持下载更新，请使用打包版本测试' };
  }

  // MSI 安装不支持自动更新，引导到 Releases 页面
  if (getInstallerType() === 'msi') {
    log.info('[AutoUpdater] MSI installation: redirecting to releases page for manual download');
    openReleasesPage();
    return { success: false, error: 'MSI 安装请前往 Releases 页面下载最新 MSI 安装包' };
  }

  try {
    const { autoUpdater } = require('electron-updater');
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err: any) {
    log.error('[AutoUpdater] downloadUpdate error:', err.message);
    setState({ status: 'error', error: err.message, canAutoUpdate: canAutoUpdate() });
    return { success: false, error: err.message };
  }
}

/**
 * 退出并安装更新
 */
export function installUpdate(): { success: boolean; error?: string } {
  if (!isUpdateEnabled()) {
    return { success: false, error: 'Updates disabled' };
  }

  if (!app.isPackaged) {
    return { success: false, error: '开发模式不支持安装更新' };
  }

  if (getInstallerType() === 'msi') {
    openReleasesPage();
    return { success: false, error: 'MSI 安装请前往 Releases 页面下载最新 MSI 安装包' };
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
  return { ...currentState, canAutoUpdate: canAutoUpdate() };
}

/**
 * 打开 GitHub Releases 页面（用于 MSI 用户或签名失败等降级场景）
 */
export function openReleasesPage(): void {
  shell.openExternal('https://github.com/nuwax-ai/nuwax-agent-client/releases');
}
