/**
 * 托盘管理器 - Electron 客户端
 *
 * 功能：
 * - 统一托盘图标（32x32.png，所有状态共用；状态通过 tooltip 区分）
 * - 服务管理菜单（重启/停止服务）
 * - 开机自启动
 * - IPC 状态同步
 */

import { Tray, Menu, nativeImage, app, dialog, BrowserWindow } from 'electron';
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
   * 刷新自启动缓存状态（当外部修改了自启动设置时调用）
   */
  async refreshAutoLaunchState(): Promise<void> {
    this.autoLaunchEnabled = await this.autoLaunchManager.isEnabled();
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
            // 通知渲染进程同步状态
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) {
                win.webContents.send('autolaunch:changed', newEnabled);
              }
            }
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
   * 开发模式：使用 __dirname 相对路径，避免 process.cwd() 在 monorepo 或从其他目录启动时指向错误目录导致图标加载失败、托盘不显示。
   * 编译后 main 在 dist/main/，window 在 dist/main/window/，故 ../../../ 为包根目录。
   */
  private getIconPath(fileName: string): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'tray', fileName);
    }
    const devPath = path.join(__dirname, '..', '..', '..', 'public', 'tray', fileName);
    return devPath;
  }

  /**
   * 创建托盘图标
   *
   * macOS 开发模式：从终端运行时 template 图标常不显示，故一律使用彩色图标 tray.png，
   *        并缩放到 22x22 以符合菜单栏尺寸，保证托盘可见。
   * macOS 打包后：使用 trayTemplate / trayTemplate@2x + setTemplateImage(true)。
   * Windows / Linux: 使用彩色图标，优先高清版，并缩放到合适尺寸。
   */
  private createTrayIcon(_status: TrayStatus): Electron.NativeImage {
    if (process.platform === 'darwin') {
      const isDev = !app.isPackaged;

      if (isDev) {
        // 开发模式：始终用彩色图标，避免 template 在菜单栏不显示
        const path22 = this.getIconPath(TRAY_ICON_DEFAULT);
        const path44 = this.getIconPath('tray@2x.png');
        let icon = nativeImage.createFromPath(path44);
        if (icon.isEmpty()) icon = nativeImage.createFromPath(path22);
        if (!icon.isEmpty()) {
          const size = icon.getSize();
          if (size.width > 22 || size.height > 22) {
            icon = icon.resize({ width: 22, height: 22 });
          }
          log.info('[Tray] macOS dev: using non-template icon (menu bar visibility):', icon.getSize().width > 22 ? path44 : path22);
          return icon;
        }
        // 最后兜底：生成 22x22 占位图，确保 Tray 收到非空图
        icon = this.createPlaceholderTrayImage(22);
        log.warn('[Tray] macOS dev: tray icon files not found, using placeholder');
        return icon;
      }

      // 打包后：template 图标
      const retinaPath = this.getIconPath(TRAY_ICON_MAC_RETINA);
      const normalPath = this.getIconPath(TRAY_ICON_MAC);
      let icon = nativeImage.createFromPath(retinaPath);
      if (icon.isEmpty()) {
        log.warn('[Tray] Retina template icon not found, trying @1x:', normalPath);
        icon = nativeImage.createFromPath(normalPath);
      }
      if (icon.isEmpty()) {
        log.error('[Tray] macOS tray icon not found. Paths tried:', { retinaPath, normalPath });
        return this.createPlaceholderTrayImage(22);
      }
      log.info('[Tray] macOS tray icon loaded from:', icon.getSize().width ? retinaPath : normalPath);
      icon.setTemplateImage(true);
      return icon;
    }

    // Windows / Linux: 彩色图标，参考 macOS 的处理方式
    const targetSize = process.platform === 'win32' ? 16 : 22; // Windows 托盘图标标准尺寸 16x16
    const pathNormal = this.getIconPath(TRAY_ICON_DEFAULT);
    const pathRetina = this.getIconPath('tray@2x.png');

    // 优先使用高清图标
    let icon = nativeImage.createFromPath(pathRetina);
    if (icon.isEmpty()) {
      icon = nativeImage.createFromPath(pathNormal);
    }

    if (!icon.isEmpty()) {
      const size = icon.getSize();
      // 如果图标尺寸过大，缩放到目标尺寸
      if (size.width > targetSize || size.height > targetSize) {
        icon = icon.resize({ width: targetSize, height: targetSize });
      }
      log.info(`[Tray] ${process.platform} tray icon loaded, size:`, icon.getSize());
      return icon;
    }

    // 兜底：生成占位图
    log.error('[Tray] Tray icon not found. Paths tried:', { pathNormal, pathRetina });
    return this.createPlaceholderTrayImage(targetSize);
  }

  /** 生成灰色占位图（1x1 PNG 放大），用于图标缺失时保证 Tray 收到非空图 */
  private createPlaceholderTrayImage(size: number): Electron.NativeImage {
    const s = Math.max(16, Math.min(22, size));
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const img = nativeImage.createFromDataURL(dataUrl);
    return img.isEmpty() ? img : img.resize({ width: s, height: s });
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
