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

/** 托盘统一图标文件名（所有状态共用同一图标，状态由 tooltip 区分） */
const TRAY_ICON_FILE = '32x32.png';
const TRAY_ICON_FILE_RETINA = '32x32@2x.png';

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
   * 获取托盘图标路径（统一使用 32x32.png，不按状态区分）
   * @param retina - 是否使用 @2x 高分辨率版本（macOS Retina）
   */
  private getIconPath(retina: boolean = false): string {
    const fileName = retina ? TRAY_ICON_FILE_RETINA : TRAY_ICON_FILE;
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'tray', fileName);
    }
    return path.join(process.cwd(), 'public', 'tray', fileName);
  }

  /**
   * 创建托盘图标（统一使用 32x32.png，支持 Retina 与 macOS Template Image）
   * @param _status - 保留参数以兼容调用方，图标不再按状态切换
   */
  private createTrayIcon(_status: TrayStatus): Electron.NativeImage {
    if (process.platform === 'darwin') {
      // macOS: 优先加载 @2x，Electron 会根据文件名识别 Retina
      const retinaPath = this.getIconPath(true);
      const normalPath = this.getIconPath(false);

      log.info('[Tray] Loading unified tray icon:', { retinaPath });

      let icon = nativeImage.createFromPath(retinaPath);
      if (icon.isEmpty()) {
        log.warn('[Tray] Retina icon empty, trying @1x:', normalPath);
        icon = nativeImage.createFromPath(normalPath);
      }

      if (icon.isEmpty()) {
        log.error('[Tray] Tray icon not found (32x32.png / 32x32@2x.png)');
      }

      log.info('[Tray] Icon loaded:', { isEmpty: icon.isEmpty(), size: icon.getSize() });
      icon.setTemplateImage(true);
      return icon;
    }

    // 非 macOS：直接使用 @1x 图标
    const iconPath = this.getIconPath(false);
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
