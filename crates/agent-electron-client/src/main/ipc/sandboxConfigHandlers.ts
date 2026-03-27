/**
 * 沙箱配置 IPC 处理器
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { SandboxConfigManager } from "../services/sandbox/SandboxConfigManager";

const configManager = new SandboxConfigManager();

export function registerSandboxConfigHandlers(): void {
  // 获取配置
  ipcMain.handle("sandbox:get-config", () => {
    return configManager.getConfig();
  });

  // 设置模式
  ipcMain.handle("sandbox:set-mode", (_event, mode) => {
    configManager.setMode(mode);
    log.info(`[SandboxConfig] Mode set to: ${mode}`);
  });

  // 更新配置
  ipcMain.handle("sandbox:update-config", (_event, updates) => {
    configManager.updateConfig(updates);
    log.info("[SandboxConfig] Config updated");
  });

  // 重置配置
  ipcMain.handle("sandbox:reset-config", () => {
    configManager.reset();
    log.info("[SandboxConfig] Config reset to defaults");
  });

  // 获取状态
  ipcMain.handle("sandbox:get-status", () => {
    const config = configManager.getConfig();
    return {
      enabled: configManager.isEnabled(),
      mode: config.mode,
      platform: process.platform,
    };
  });

  log.info("[IPC] Sandbox config handlers registered");
}
