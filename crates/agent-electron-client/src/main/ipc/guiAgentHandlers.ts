/**
 * GUI Agent IPC handlers
 *
 * 处理渲染进程与 GUI Agent 服务之间的通信。
 * 自注册 engine hooks（env provider + prompt enhancer）和 cleanup，
 * 核心模块无需直接依赖 GUI Agent。
 */

import { app, ipcMain } from 'electron';
import log from 'electron-log';
import { readSetting, writeSetting } from '../db';
import { STORAGE_KEYS } from '@shared/constants';
import {
  startGuiAgentServer,
  stopGuiAgentServer,
  getGuiAgentStatus,
  getGuiAgentConfig,
  setGuiAgentConfig,
  checkGuiPermissions,
  requestScreenCapturePermission,
  requestAccessibilityPermission,
  openPermissionSettings,
  getToken,
  generateGuiAgentSystemPrompt,
} from '../services/gui';
import type { GuiAgentConfig } from '@shared/types/guiAgentTypes';
import { DEFAULT_GUI_AGENT_CONFIG } from '@shared/types/guiAgentTypes';
import { registerEnvProvider, registerPromptEnhancer } from '../services/engines/engineHooks';

export function registerGuiAgentHandlers(): void {
  // ==================== Self-register engine hooks ====================

  // Inject GUI_AGENT_PORT + GUI_AGENT_TOKEN into engine env
  registerEnvProvider(() => {
    const status = getGuiAgentStatus();
    const token = getToken();
    if (!status.running || !status.port || !token) return undefined;
    return {
      GUI_AGENT_PORT: String(status.port),
      GUI_AGENT_TOKEN: token,
    };
  });

  // Append GUI Agent system prompt when service is running
  registerPromptEnhancer((basePrompt) => {
    const status = getGuiAgentStatus();
    const token = getToken();
    if (!status.running || !status.port || !token) return basePrompt;

    try {
      const guiPrompt = generateGuiAgentSystemPrompt({
        port: status.port,
        token,
        platform: process.platform,
      });
      return basePrompt ? `${basePrompt}\n\n${guiPrompt}` : guiPrompt;
    } catch (e) {
      log.warn('[GuiAgent] Failed to generate system prompt:', e);
      return basePrompt;
    }
  });

  // Self-register cleanup on app quit
  app.on('will-quit', async () => {
    try {
      await stopGuiAgentServer();
    } catch (e) {
      log.error('[GuiAgent] Cleanup error:', e);
    }
  });

  // ==================== IPC Handlers ====================

  // Start GUI Agent server
  ipcMain.handle('guiAgent:start', async (_, config?: Partial<GuiAgentConfig>) => {
    try {
      const saved = readSetting(STORAGE_KEYS.GUI_AGENT_CONFIG) as GuiAgentConfig | null;
      const mergedConfig = { ...DEFAULT_GUI_AGENT_CONFIG, ...saved, ...config };
      const result = await startGuiAgentServer(mergedConfig);
      return result;
    } catch (error) {
      log.error('[GuiAgent IPC] Start failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Stop GUI Agent server
  ipcMain.handle('guiAgent:stop', async () => {
    try {
      await stopGuiAgentServer();
      return { success: true };
    } catch (error) {
      log.error('[GuiAgent IPC] Stop failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get GUI Agent status
  ipcMain.handle('guiAgent:status', () => {
    return getGuiAgentStatus();
  });

  // Get GUI Agent config
  ipcMain.handle('guiAgent:getConfig', () => {
    const saved = readSetting(STORAGE_KEYS.GUI_AGENT_CONFIG) as GuiAgentConfig | null;
    return { ...DEFAULT_GUI_AGENT_CONFIG, ...saved };
  });

  // Set GUI Agent config
  ipcMain.handle('guiAgent:setConfig', async (_, config: Partial<GuiAgentConfig>) => {
    try {
      const saved = readSetting(STORAGE_KEYS.GUI_AGENT_CONFIG) as GuiAgentConfig | null;
      const merged = { ...DEFAULT_GUI_AGENT_CONFIG, ...saved, ...config };
      writeSetting(STORAGE_KEYS.GUI_AGENT_CONFIG, merged);
      setGuiAgentConfig(merged);
      return { success: true };
    } catch (error) {
      log.error('[GuiAgent IPC] SetConfig failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Check GUI permissions
  ipcMain.handle('guiAgent:checkPermissions', () => {
    return checkGuiPermissions();
  });

  // Request permission
  ipcMain.handle('guiAgent:requestPermission', async (_, type: 'screenCapture' | 'accessibility') => {
    try {
      if (type === 'screenCapture') {
        const result = await requestScreenCapturePermission();
        return { success: result };
      }
      if (type === 'accessibility') {
        const result = requestAccessibilityPermission();
        return { success: result };
      }
      return { success: false, error: `Unknown permission type: ${type}` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Open permission settings
  ipcMain.handle('guiAgent:openPermissionSettings', async (_, type: 'screenCapture' | 'accessibility') => {
    try {
      const result = await openPermissionSettings(type);
      return { success: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  log.info('[GuiAgent] IPC handlers + engine hooks registered');
}
