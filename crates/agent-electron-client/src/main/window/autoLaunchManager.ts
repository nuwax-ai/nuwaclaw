/**
 * 开机自启动管理器
 *
 * 跨平台支持：
 * - Windows: 使用 app.setLoginItemSettings() 巻加注册表项
 * - macOS: 使用 app.setLoginItemSettings() 添加 LaunchAgent
 * - Linux: 使用 auto-launch 库创建 .desktop 文件
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import { APP_DISPLAY_NAME } from '@shared/constants';

// auto-launch 库用于 Linux 支持
let AutoLaunch: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AutoLaunch = require('auto-launch');
} catch (e) {
  log.warn('[AutoLaunch] auto-launch module not available:', e);
}

export interface AutoLaunchStatus {
  enabled: boolean;
  supported: boolean;
}

export class AutoLaunchManager {
  private enabled: boolean = false;
  private supported: boolean = true;

  /** Windows 需要 args 一致才能正确匹配注册表项 */
  private readonly loginItemArgs = ['--hidden'];

  /**
   * 检查是否支持自启动
   */
  isSupported(): boolean {
    return this.supported;
  }

  /**
   * 检查自启动状态
   */
  async isEnabled(): Promise<boolean> {
    try {
      if (process.platform === 'linux') {
        // Linux: 使用 auto-launch 库
        if (!AutoLaunch) {
          this.supported = false;
          return false;
        }

        const autoLauncher = new AutoLaunch({
          name: APP_DISPLAY_NAME,
          path: process.execPath,
          isHiddenOnLaunch: true,
        });

        this.enabled = await autoLauncher.isEnabled();
        return this.enabled;
      } else {
        // Windows/macOS: 使用 Electron 原生 API
        const settings = app.getLoginItemSettings({
          args: this.loginItemArgs,
        });
        this.enabled = settings.openAtLogin;
        return this.enabled;
      }
    } catch (e) {
      log.error('[AutoLaunchManager] Failed to check status:', e);
      return false;
    }
  }

  /**
   * 设置自启动
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    try {
      if (process.platform === 'linux') {
        // Linux: 使用 auto-launch 库
        if (!AutoLaunch) {
          this.supported = false;
          return false;
        }

        const autoLauncher = new AutoLaunch({
          name: APP_DISPLAY_NAME,
          path: process.execPath,
          isHiddenOnLaunch: true,
        });

        if (enabled) {
          await autoLauncher.enable();
          log.info('[AutoLaunchManager] Auto-launch enabled');
        } else {
          await autoLauncher.disable();
          log.info('[AutoLaunchManager] Auto-launch disabled');
        }

        this.enabled = enabled;
        return true;
      } else {
        // Windows/macOS: 使用 Electron 原生 API
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true, // macOS: 启动时隐藏
          args: this.loginItemArgs,
        });

        this.enabled = enabled;
        log.info(`[AutoLaunchManager] Auto-launch ${enabled ? 'enabled' : 'disabled'}`);
        return true;
      }
    } catch (e) {
      log.error('[AutoLaunchManager] Failed to set auto-launch:', e);
      return false;
    }
  }

  /**
   * 切换自启动状态
   */
  async toggle(): Promise<boolean> {
    const currentState = await this.isEnabled();
    return this.setEnabled(!currentState);
  }
}

// ==================== Singleton ====================

let autoLaunchManager: AutoLaunchManager | null = null;

export function createAutoLaunchManager(): AutoLaunchManager {
  // 直接创建新实例，保留用户设置
  autoLaunchManager = new AutoLaunchManager();
  return autoLaunchManager;
}

export function getAutoLaunchManager(): AutoLaunchManager | null {
  return autoLaunchManager;
}
