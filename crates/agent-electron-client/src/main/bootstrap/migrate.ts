/**
 * 数据目录迁移：~/.nuwax-agent 或 ~/.nuwaxbot → ~/.nuwaclaw
 *
 * 必须在 initDatabase() 之前同步执行，确保 DB 从新路径打开。
 * 仅在旧目录存在且新目录不存在时执行一次性 rename。
 *
 * 优先级：.nuwax-agent > .nuwaxbot（找到第一个存在的旧目录即迁移）
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import { APP_NAME_IDENTIFIER } from '@shared/constants';

interface LegacySource {
  dirName: string;
  dbName: string;
  configName: string | null;
}

const LEGACY_SOURCES: LegacySource[] = [
  { dirName: '.nuwax-agent', dbName: 'nuwax-agent.db', configName: null },
  { dirName: '.nuwaxbot',    dbName: 'nuwaxbot.db',    configName: 'nuwaxbot.json' },
];

export function migrateDataDir(): void {
  const home = app.getPath('home');
  const newDir = path.join(home, `.${APP_NAME_IDENTIFIER}`);

  // 新目录已存在 → 无需迁移
  if (fs.existsSync(newDir)) {
    return;
  }

  // 遍历旧数据源，找到第一个存在的旧目录
  for (const source of LEGACY_SOURCES) {
    const oldDir = path.join(home, source.dirName);
    if (!fs.existsSync(oldDir)) {
      continue;
    }

    log.info(`[Migrate] Found legacy data dir: ${oldDir}, renaming → ${newDir}`);
    try {
      fs.renameSync(oldDir, newDir);
    } catch (e) {
      log.error('[Migrate] Failed to rename data directory:', e);
      return;
    }

    // 重命名 DB 文件
    const newDbName = `${APP_NAME_IDENTIFIER}.db`;
    const oldDb = path.join(newDir, source.dbName);
    const newDb = path.join(newDir, newDbName);
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
        log.info(`[Migrate] Renamed DB: ${source.dbName} → ${newDbName}`);
      } catch (e) {
        log.error('[Migrate] Failed to rename database file:', e);
      }
    }

    // 重命名 config 文件（如果存在）
    if (source.configName) {
      const newConfigName = `${APP_NAME_IDENTIFIER}.json`;
      const oldConfig = path.join(newDir, source.configName);
      const newConfig = path.join(newDir, newConfigName);
      if (fs.existsSync(oldConfig) && !fs.existsSync(newConfig)) {
        try {
          fs.renameSync(oldConfig, newConfig);
          log.info(`[Migrate] Renamed config: ${source.configName} → ${newConfigName}`);
        } catch (e) {
          log.error('[Migrate] Failed to rename config file:', e);
        }
      }
    }

    log.info('[Migrate] Data directory migration completed');
    return; // 只迁移第一个找到的旧目录
  }
}
