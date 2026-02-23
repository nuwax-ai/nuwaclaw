import { ipcMain } from 'electron';
import log from 'electron-log';

export function registerDependencyHandlers(): void {
  const {
    checkNodeVersion,
    checkUvVersion,
    detectNpmPackage,
    checkAllDependencies,
    installNpmPackage,
    installMissingDependencies,
    getAppDataDir,
    SETUP_REQUIRED_DEPENDENCIES,
  } = require('../../services/main/system/dependencies');

  ipcMain.handle('dependencies:checkAll', async () => {
    log.info('[IPC] Checking all dependencies...');
    try {
      const results = await checkAllDependencies();
      return { success: true, results };
    } catch (error) {
      log.error('[IPC] Dependency check failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:checkNode', async () => {
    try {
      const result = await checkNodeVersion();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:checkUv', async () => {
    try {
      const result = await checkUvVersion();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:detectPackage', async (_, packageName: string, binName?: string) => {
    try {
      const result = await detectNpmPackage(packageName, binName);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:installPackage', async (_, packageName: string, options?: { registry?: string; version?: string }) => {
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
    log.info('[IPC] Installing missing dependencies...');
    try {
      const result = await installMissingDependencies();
      return result;
    } catch (error) {
      log.error('[IPC] Install missing failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('dependencies:getAppDataDir', () => {
    return getAppDataDir();
  });

  ipcMain.handle('dependencies:getRequiredList', () => {
    return SETUP_REQUIRED_DEPENDENCIES;
  });
}
