/**
 * 托盘管理器 - Electron 客户端
 *
 * 功能：
 * - 动态托盘图标（运行/停止/错误状态）
 * - 服务管理菜单（重启/停止服务）
 * - 开机自启动
 * - IPC 状态同步
 */

import { Tray, Menu, nativeImage, app, dialog } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { APP_DISPLAY_NAME } from '@shared/constants';
import { createAutoLaunchManager, AutoLaunchManager } from './autoLaunchManager';
import { checkForUpdates, downloadUpdate, installUpdate, openReleasesPage, getUpdateState } from '../services/autoUpdater';

// ==================== Types ====================

export type TrayStatus = 'running' | 'stopped' | 'error' | 'starting';

export interface TrayManagerOptions {
  onShowWindow: () => void;
  onRestartServices: () => Promise<void>;
  onStopServices: () => Promise<void>;
}

// ==================== Constants ====================

const TRAY_ICONS = {
  running: 'tray-running.png',
  stopped: 'tray-stopped.png',
  error: 'tray-error.png',
  starting: 'tray-starting.png',
};

// ==================== Tray Manager ====================

export class TrayManager {
  private tray: Tray | null = null;
  private status: TrayStatus = 'stopped';
  private servicesRunning: boolean = false;
  private autoLaunchEnabled: boolean = false;
  private autoLaunchManager: AutoLaunchManager;
  private options: TrayManagerOptions;

  constructor(options: TrayManagerOptions) {
    this.options = options;
    this.autoLaunchManager = createAutoLaunchManager();
  }

  /**
   * 创建托盘
   */
  async create(): Promise<void> {
    const icon = this.createTrayIcon('stopped');

    this.tray = new Tray(icon);
    this.tray.setToolTip(APP_DISPLAY_NAME);

    // 左键点击显示窗口
    this.tray.on('click', () => {
      this.options.onShowWindow();
    });

    // 双击也显示窗口
    this.tray.on('double-click', () => {
      this.options.onShowWindow();
    });

    // 检查自启动状态
    this.autoLaunchEnabled = await this.autoLaunchManager.isEnabled();

    // 构建初始菜单
    this.updateMenu();
    log.info('[Tray] Tray created');
  }

  /**
   * 更新服务状态
   */
  updateServicesStatus(running: boolean): void {
    this.servicesRunning = running;
    this.status = running ? 'running' : 'stopped';
    this.updateIcon();
    this.updateMenu();
  }

  /**
   * 设置状态（用于错误状态）
   */
  setStatus(status: TrayStatus): void {
    this.status = status;
    this.updateIcon();
    this.updateMenu();
  }

  /**
   * 更新托盘图标
   */
  private updateIcon(): void {
    if (!this.tray) return;

    const icon = this.createTrayIcon(this.status);
    this.tray.setImage(icon);

    const statusText: Record<TrayStatus, string> = {
      running: '运行中',
      stopped: '已停止',
      error: '错误',
      starting: '启动中',
    };
    this.tray.setToolTip(`${APP_DISPLAY_NAME} - ${statusText[this.status]}`);
  }

  /**
   * 更新托盘菜单
   */
  private updateMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => this.options.onShowWindow(),
      },
      { type: 'separator' },
      {
        label: '重启服务',
        click: async () => {
          log.info('[Tray] Restarting services...');
          try {
            await this.options.onRestartServices();
          } catch (e) {
            log.error('[Tray] Restart services failed:', e);
          }
        },
      },
      {
        label: '停止服务',
        enabled: this.servicesRunning,
        click: async () => {
          log.info('[Tray] Stopping services...');
          try {
            await this.options.onStopServices();
          } catch (e) {
            log.error('[Tray] Stop services failed:', e);
          }
        },
      },
      { type: 'separator' },
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: this.autoLaunchEnabled,
        click: async () => {
          const newEnabled = !this.autoLaunchEnabled;
          const success = await this.autoLaunchManager.setEnabled(newEnabled);
          if (success) {
            this.autoLaunchEnabled = newEnabled;
            this.updateMenu();
          } else {
            dialog.showErrorBox('错误', '设置开机自启动失败');
          }
        },
      },
      {
        label: '检查更新',
        click: async () => {
          try {
            const result = await checkForUpdates();
            if (result.hasUpdate) {
              const state = getUpdateState();
              if (state.canAutoUpdate === false) {
                const { response } = await dialog.showMessageBox({
                  type: 'info',
                  title: '发现新版本',
                  message: `发现新版本 v${result.version}`,
                  detail: '当前安装方式不支持自动更新，请前往 Releases 页面下载最新安装包。',
                  buttons: ['前往下载页', '稍后再说'],
                  defaultId: 0,
                  cancelId: 1,
                });
                if (response === 0) {
                  openReleasesPage();
                }
              } else {
                const { response } = await dialog.showMessageBox({
                  type: 'info',
                  title: '发现新版本',
                  message: `发现新版本 v${result.version}`,
                  detail: '是否立即下载更新？',
                  buttons: ['下载更新', '稍后再说'],
                  defaultId: 0,
                  cancelId: 1,
                });
                if (response === 0) {
                  const dlResult = await downloadUpdate();
                  if (dlResult.success) {
                    const { response: installResponse } = await dialog.showMessageBox({
                      type: 'info',
                      title: '更新已下载',
                      message: '更新已下载完成',
                      detail: '是否立即重启安装？',
                      buttons: ['重启安装', '退出时安装'],
                      defaultId: 0,
                      cancelId: 1,
                    });
                    if (installResponse === 0) {
                      installUpdate();
                    }
                  } else {
                    dialog.showErrorBox('下载失败', dlResult.error || '下载更新时出错，请稍后重试');
                  }
                }
              }
            } else {
              dialog.showMessageBox({
                type: 'info',
                title: '检查更新',
                message: '当前已是最新版本',
              });
            }
          } catch (e: any) {
            log.error('[Tray] Check update failed:', e);
            dialog.showErrorBox('检查更新失败', e.message || '请稍后重试');
          }
        },
      },
      { type: 'separator' },
      {
        label: `关于 ${APP_DISPLAY_NAME} v${app.getVersion()}`,
        enabled: false,
      },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * 获取托盘图标路径
   */
  private getIconPath(status: TrayStatus, retina: boolean = false): string {
    const iconName = TRAY_ICONS[status] || TRAY_ICONS.stopped;
    const fileName = retina ? iconName.replace('.png', '@2x.png') : iconName;

    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'tray', fileName);
    }
    return path.join(process.cwd(), 'public', 'tray', fileName);
  }

  /**
   * 创建托盘图标 (支持 Retina 和 Template Image)
   */
  private createTrayIcon(status: TrayStatus): Electron.NativeImage {
    if (process.platform === 'darwin') {
      // macOS: load @2x icon directly - Electron auto-detects @2x from filename
      // Do NOT resize, as Electron already treats it as 22pt (Retina)
      const retinaPath = this.getIconPath(status, true);
      const normalPath = this.getIconPath(status, false);

      log.info('[Tray] Loading icon:', { status, retinaPath });

      let icon = nativeImage.createFromPath(retinaPath);
      if (icon.isEmpty()) {
        log.warn('[Tray] Retina icon empty, trying @1x:', normalPath);
        icon = nativeImage.createFromPath(normalPath);
      }

      if (icon.isEmpty()) {
        log.error('[Tray] All tray icons empty!');
      }

      log.info('[Tray] Icon loaded:', { isEmpty: icon.isEmpty(), size: icon.getSize() });
      icon.setTemplateImage(true);
      return icon;
    }

    // Non-macOS: use @1x icon directly
    const iconPath = this.getIconPath(status);
    return nativeImage.createFromPath(iconPath);
  }

  /**
   * 销毁托盘
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  /**
   * 获取托盘实例
   */
  getTray(): Tray | null {
    return this.tray;
  }
}

// ==================== Singleton ====================

let trayManager: TrayManager | null = null;

export function createTrayManager(options: TrayManagerOptions): TrayManager {
  if (trayManager) {
    trayManager.destroy();
  }
  trayManager = new TrayManager(options);
  return trayManager;
}

export function getTrayManager(): TrayManager | null {
  return trayManager;
}
