/**
 * 托盘管理器 - Electron 客户端
 *
 * 功能：
 * - 统一托盘图标（32x32.png，所有状态共用；状态通过 tooltip 区分）
 * - 服务管理菜单（重启/停止服务）
 * - 开机自启动
 * - IPC 状态同步
 */

import { Tray, Menu, nativeImage, app, dialog } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { APP_DISPLAY_NAME } from '@shared/constants';
import { createAutoLaunchManager, AutoLaunchManager } from './autoLaunchManager';

// ==================== Types ====================

export type TrayStatus = 'running' | 'stopped' | 'error' | 'starting';

export interface TrayManagerOptions {
  onShowWindow: () => void;
  onRestartServices: () => Promise<void>;
  onStopServices: () => Promise<void>;
}

// ==================== Constants ====================

/**
 * 托盘图标文件名（所有状态共用同一图标，状态由 tooltip 区分）
 *
 * macOS: trayTemplate.png / trayTemplate@2x.png — 22x22 / 44x44 黑色剪影，
 *        Electron 根据 "Template" 后缀自动设为 template image（随系统明暗主题变色）。
 * Windows / Linux: tray.png — 32x32 彩色图标。
 */
const TRAY_ICON_MAC = 'trayTemplate.png';
const TRAY_ICON_MAC_RETINA = 'trayTemplate@2x.png';
const TRAY_ICON_DEFAULT = 'tray.png';

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
          const { showUpdateDialogFlow } = require('../services/autoUpdater');
          await showUpdateDialogFlow();
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
  private getIconPath(fileName: string): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'tray', fileName);
    }
    return path.join(process.cwd(), 'public', 'tray', fileName);
  }

  /**
   * 创建托盘图标
   *
   * macOS: 加载 trayTemplate / trayTemplate@2x（黑色剪影），
   *        setTemplateImage(true) 让系统根据明暗主题自动着色。
   * Windows / Linux: 加载 tray.png（彩色图标）。
   */
  private createTrayIcon(_status: TrayStatus): Electron.NativeImage {
    if (process.platform === 'darwin') {
      const retinaPath = this.getIconPath(TRAY_ICON_MAC_RETINA);
      const normalPath = this.getIconPath(TRAY_ICON_MAC);

      let icon = nativeImage.createFromPath(retinaPath);
      if (icon.isEmpty()) {
        log.warn('[Tray] Retina template icon not found, trying @1x:', normalPath);
        icon = nativeImage.createFromPath(normalPath);
      }

      if (icon.isEmpty()) {
        log.error('[Tray] macOS tray icon not found:', retinaPath);
      }

      icon.setTemplateImage(true);
      return icon;
    }

    // Windows / Linux: 彩色图标
    const iconPath = this.getIconPath(TRAY_ICON_DEFAULT);
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      log.error('[Tray] Tray icon not found:', iconPath);
    }
    return icon;
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
