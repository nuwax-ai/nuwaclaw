/**
 * i18n IPC 通道
 *
 * 提供主进程语言同步的 IPC 接口
 *
 * @version 1.0.0
 * @updated 2026-04-07
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { setMainLang, getMainLang } from "../services/i18n";
import { getTrayManager } from "../window/trayManager";

/**
 * 注册 i18n IPC 通道
 */
export function registerI18nHandlers(): void {
  /**
   * 获取当前主进程语言
   * @channel i18n:getLang
   */
  ipcMain.handle("i18n:getLang", () => {
    return getMainLang();
  });

  /**
   * 切换主进程语言
   * @channel i18n:setLang
   * @param lang 语言代码
   */
  ipcMain.handle("i18n:setLang", async (_event, lang: string) => {
    try {
      setMainLang(lang);
      // 通知托盘刷新菜单和 tooltip
      getTrayManager()?.refresh();
      log.info(`[IPC i18n] Language changed to: ${lang}`);
      return { success: true };
    } catch (error) {
      log.error("[IPC i18n] Failed to change language:", error);
      return { success: false, error: String(error) };
    }
  });

  log.info("[IPC] i18n handlers registered");
}
