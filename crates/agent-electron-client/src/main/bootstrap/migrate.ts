/**
 * 数据目录迁移：~/.nuwax-agent → ~/.nuwaxbot
 *
 * 必须在 initDatabase() 之前同步执行，确保 DB 从新路径打开。
 * 仅在旧目录存在且新目录不存在时执行一次性 rename。
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import { APP_NAME_IDENTIFIER } from '@shared/constants';

const OLD_DIR_NAME = '.nuwax-agent';
const OLD_DB_NAME = 'nuwax-agent.db';

export function migrateDataDir(): void {
  const home = app.getPath('home');
  const oldDir = path.join(home, OLD_DIR_NAME);
  const newDir = path.join(home, `.${APP_NAME_IDENTIFIER}`);

  // 旧目录不存在或新目录已存在 → 无需迁移
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) {
    return;
  }

  log.info(`[Migrate] Renaming ${oldDir} → ${newDir}`);
  try {
    fs.renameSync(oldDir, newDir);
  } catch (e) {
    log.error('[Migrate] Failed to rename data directory:', e);
    return;
  }

  // 重命名 DB 文件：nuwax-agent.db → nuwaxbot.db
  const oldDb = path.join(newDir, OLD_DB_NAME);
  const newDb = path.join(newDir, `${APP_NAME_IDENTIFIER}.db`);
  if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
    try {
      fs.renameSync(oldDb, newDb);
      // WAL / SHM 附属文件一并迁移
      for (const suffix of ['-wal', '-shm']) {
        const oldAux = oldDb + suffix;
        const newAux = newDb + suffix;
        if (fs.existsSync(oldAux)) {
          fs.renameSync(oldAux, newAux);
        }
      }
      log.info(`[Migrate] Renamed DB: ${OLD_DB_NAME} → ${APP_NAME_IDENTIFIER}.db`);
    } catch (e) {
      log.error('[Migrate] Failed to rename database file:', e);
    }
  }

  log.info('[Migrate] Data directory migration completed');
}
