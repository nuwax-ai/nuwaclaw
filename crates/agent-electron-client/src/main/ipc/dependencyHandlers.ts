import { ipcMain } from 'electron';
import log from 'electron-log';
import { isDepsSyncInProgress } from '../bootstrap/startup';

export function registerDependencyHandlers(): void {
  ipcMain.handle('dependencies:checkAll', async (_, options?: { checkLatest?: boolean }) => {
    const { checkAllDependencies } = await import('../services/system/dependencies');
    log.info('[IPC] Checking all dependencies...');
    try {
      const results = await checkAllDependencies(options);
      return { success: true, results, syncInProgress: isDepsSyncInProgress() };
    } catch (error) {
      log.error('[IPC] Dependency check failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:checkNode', async () => {
    const { checkNodeVersion } = await import('../services/system/dependencies');
    try {
      const result = await checkNodeVersion();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:checkUv', async () => {
    const { checkUvVersion } = await import('../services/system/dependencies');
    try {
      const result = await checkUvVersion();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:detectPackage', async (_, packageName: string, binName?: string) => {
    const { detectNpmPackage } = await import('../services/system/dependencies');
    try {
      const result = await detectNpmPackage(packageName, binName);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:installPackage', async (_, packageName: string, options?: { registry?: string; version?: string }) => {
    const { installNpmPackage } = await import('../services/system/dependencies');
    log.info(`[IPC] Installing package: ${packageName}`);
    try {
      const result = await installNpmPackage(packageName, options);
      return result;
    } catch (error) {
      log.error('[IPC] Install failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:installMissing', async () => {
    const { installMissingDependencies } = await import('../services/system/dependencies');
    log.info('[IPC] Installing missing dependencies...');
    try {
      const result = await installMissingDependencies();
      return result;
    } catch (error) {
      log.error('[IPC] Install missing failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:getAppDataDir', async () => {
    const { getAppDataDir } = await import('../services/system/workspaceManager');
    return getAppDataDir();
  });

  ipcMain.handle('dependencies:getRequiredList', async () => {
    const { SETUP_REQUIRED_DEPENDENCIES } = await import('../services/system/dependencies');
    return SETUP_REQUIRED_DEPENDENCIES;
  });
}
