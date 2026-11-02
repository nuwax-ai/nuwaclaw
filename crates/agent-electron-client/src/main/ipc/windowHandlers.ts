import { ipcMain } from 'electron';
import type { HandlerContext } from '@shared/types/ipc';

export function registerWindowHandlers(ctx: HandlerContext): void {
  ipcMain.handle('window:minimize', () => {
    ctx.getMainWindow()?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    const win = ctx.getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    ctx.getMainWindow()?.close();
  });
}
