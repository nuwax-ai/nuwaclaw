import { ipcMain } from 'electron';
import { getDb, readSetting } from '../db';
import log from 'electron-log';
import { readQuickInitConfig } from '../bootstrap/quickInit';

export function registerSettingsHandlers(): void {
  // Settings
  ipcMain.handle('settings:get', (_, key: string) => {
    const db = getDb();
    if (!db) return null;
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  });

  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    const db = getDb();
    if (!db) return false;
    if (value === null || value === undefined) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } else {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
      );
      stmt.run(key, JSON.stringify(value));
    }
    return true;
  });

  // Mirror / Registry — 动态切换 npm、uv 镜像源
  ipcMain.handle('mirror:get', async () => {
    const { getMirrorConfig, MIRROR_PRESETS } = await import('../services/system/dependencies');
    return { success: true, ...getMirrorConfig(), presets: MIRROR_PRESETS };
  });

  ipcMain.handle('mirror:set', async (_, config: { npmRegistry?: string; uvIndexUrl?: string }) => {
    const { setMirrorConfig, getMirrorConfig } = await import('../services/system/dependencies');
    try {
      setMirrorConfig(config);
      // 持久化到 SQLite
      const db = getDb();
      if (db) {
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run('mirror_config', JSON.stringify(getMirrorConfig()));
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Quick Init — 读取 ~/.nuwaclaw/nuwaclaw.json 快捷配置
  ipcMain.handle('quickInit:getConfig', () => {
    return readQuickInitConfig();
  });
}
