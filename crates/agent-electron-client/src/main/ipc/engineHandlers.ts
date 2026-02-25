import { ipcMain } from 'electron';
import log from 'electron-log';

export function registerEngineHandlers(): void {
  const {
    isEngineInstalledLocally,
    isEngineInstalledGlobally,
    getEngineVersion,
    findEngineBinary,
    installEngine,
    startEngine,
    stopEngine,
    getEngineStatus,
    sendToEngine,
    stopAllEngines,
  } = require('../services/engines/engineManager');

  ipcMain.handle('engine:checkLocal', async (_, engine: string) => {
    return isEngineInstalledLocally(engine);
  });

  ipcMain.handle('engine:checkGlobal', async (_, engine: string) => {
    return isEngineInstalledGlobally(engine);
  });

  ipcMain.handle('engine:getVersion', async (_, engine: string) => {
    return getEngineVersion(engine);
  });

  ipcMain.handle('engine:findBinary', async (_, engine: string) => {
    return findEngineBinary(engine);
  });

  ipcMain.handle('engine:install', async (_, engine: string, options?: { registry?: string }) => {
    log.info(`[IPC] Installing engine: ${engine}`);
    return installEngine(engine, options);
  });

  ipcMain.handle('engine:start', async (_, config: {
    engine: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    workspaceDir?: string;
  }) => {
    log.info(`[IPC] Starting engine: ${config.engine}`);
    return startEngine(config);
  });

  ipcMain.handle('engine:stop', async (_, engineId: string) => {
    return stopEngine(engineId);
  });

  ipcMain.handle('engine:status', async (_, engineId?: string) => {
    return getEngineStatus(engineId);
  });

  ipcMain.handle('engine:send', async (_, engineId: string, message: string) => {
    return sendToEngine(engineId, message);
  });

  ipcMain.handle('engine:stopAll', async () => {
    await stopAllEngines();
    return { success: true };
  });
}
