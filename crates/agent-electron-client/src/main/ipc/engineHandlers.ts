import { ipcMain } from 'electron';
import log from 'electron-log';
import type { AgentEngine } from '../services/engines/engineManager';

export function registerEngineHandlers(): void {
  ipcMain.handle('engine:checkLocal', async (_, engine: string) => {
    const { isEngineInstalledLocally } = await import('../services/engines/engineManager');
    return isEngineInstalledLocally(engine as AgentEngine);
  });

  ipcMain.handle('engine:checkGlobal', async (_, engine: string) => {
    const { isEngineInstalledGlobally } = await import('../services/engines/engineManager');
    return isEngineInstalledGlobally(engine as AgentEngine);
  });

  ipcMain.handle('engine:getVersion', async (_, engine: string) => {
    const { getEngineVersion } = await import('../services/engines/engineManager');
    return getEngineVersion(engine as AgentEngine);
  });

  ipcMain.handle('engine:findBinary', async (_, engine: string) => {
    const { findEngineBinary } = await import('../services/engines/engineManager');
    return findEngineBinary(engine as AgentEngine);
  });

  ipcMain.handle('engine:install', async (_, engine: string, options?: { registry?: string }) => {
    const { installEngine } = await import('../services/engines/engineManager');
    log.info(`[IPC] Installing engine: ${engine}`);
    return installEngine(engine as AgentEngine, options);
  });

  ipcMain.handle('engine:start', async (_, config: {
    engine: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    workspaceDir?: string;
  }) => {
    const { startEngine } = await import('../services/engines/engineManager');
    log.info(`[IPC] Starting engine: ${config.engine}`);
    return startEngine({ ...config, engine: config.engine as AgentEngine });
  });

  ipcMain.handle('engine:stop', async (_, engineId: string) => {
    const { stopEngine } = await import('../services/engines/engineManager');
    return stopEngine(engineId);
  });

  ipcMain.handle('engine:status', async (_, engineId?: string) => {
    const { getEngineStatus } = await import('../services/engines/engineManager');
    return getEngineStatus(engineId);
  });

  ipcMain.handle('engine:send', async (_, engineId: string, message: string) => {
    const { sendToEngine } = await import('../services/engines/engineManager');
    return sendToEngine(engineId, message);
  });

  ipcMain.handle('engine:stopAll', async () => {
    const { stopAllEngines } = await import('../services/engines/engineManager');
    await stopAllEngines();
    return { success: true };
  });
}
